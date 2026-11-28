use std::collections::{HashMap, HashSet};
use std::sync::atomic::Ordering;

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::model::{Rating, Revlog, StudyCard};
use crate::scheduling::{CardPhase, CardState, Interval, SchedContext};
use crate::undo::UndoAction;
use crate::Collection;

/// Minimum time a just-answered card is kept out of resurfacing, in ms.
/// Matches the shortest default learning step, so a card never reappears
/// sub-minute purely because it was the only thing left to show.
const GRACE_MS: i64 = 60_000;

/// Proportional-merge decision for interleaving new and review cards: pick a new
/// card when its stream is no further ahead (by fraction completed) than the
/// review stream. `*_done` are today's studied counts; `*_remaining` are the
/// cards left in each stream. Callers guarantee both streams are non-empty.
fn prefer_new(new_done: u32, new_remaining: u32, rev_done: u32, rev_remaining: u32) -> bool {
    let new_total = new_done + new_remaining;
    let rev_total = rev_done + rev_remaining;
    // Fraction of each stream already completed; smaller = further behind.
    let new_frac = f64::from(new_done) / f64::from(new_total.max(1));
    let rev_frac = f64::from(rev_done) / f64::from(rev_total.max(1));
    new_frac <= rev_frac
}

/// Precomputed non-filtered deck hierarchy and remaining daily allowances for
/// one pass over a study subtree or deck list.
pub(crate) struct StudySubtreePlan {
    parents: HashMap<i64, Option<i64>>,
    children: HashMap<i64, Vec<i64>>,
    filtered: HashSet<i64>,
    subtree_studied: HashMap<i64, (u32, u32)>,
    subtree_remaining: HashMap<i64, (u32, u32)>,
}

impl StudySubtreePlan {
    pub(crate) fn build(collection: &Collection) -> CoreResult<Self> {
        let decks = collection.storage.list_decks()?;
        let all_limits = collection.storage.all_deck_limits()?;
        let studied = collection
            .storage
            .all_today_studied(collection.today_start_ms())?;
        let extra_new = collection.storage.all_day_extra_new(collection.today())?;

        let mut parents: HashMap<i64, Option<i64>> = HashMap::with_capacity(decks.len());
        let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
        let mut filtered: HashSet<i64> = HashSet::new();
        for d in &decks {
            if d.is_filtered {
                filtered.insert(d.id);
                continue;
            }
            parents.insert(d.id, d.parent_id);
            if let Some(pid) = d.parent_id {
                children.entry(pid).or_default().push(d.id);
            }
        }

        let mut subtree_studied = HashMap::with_capacity(decks.len());
        for d in &decks {
            Self::compute_subtree_studied(
                d.id,
                &children,
                &filtered,
                &studied,
                &mut subtree_studied,
            );
        }

        let mut subtree_remaining = HashMap::with_capacity(decks.len());
        for d in &decks {
            if d.is_filtered {
                // Filtered decks are governed by their gather limit, never by
                // Default (`config_id = 1`) daily new/review limits.
                subtree_remaining.insert(d.id, (u32::MAX, u32::MAX));
                continue;
            }
            let (new_per_day, rev_per_day) =
                all_limits.get(&d.config_id).copied().unwrap_or((20, 200));
            let extra = extra_new.get(&d.id).copied().unwrap_or(0);
            let (new_done, rev_done) = subtree_studied.get(&d.id).copied().unwrap_or((0, 0));
            subtree_remaining.insert(
                d.id,
                (
                    (new_per_day + extra).saturating_sub(new_done),
                    rev_per_day.saturating_sub(rev_done),
                ),
            );
        }

        Ok(Self {
            parents,
            children,
            filtered,
            subtree_studied,
            subtree_remaining,
        })
    }

    /// Remaining `(new, review)` cap imposed by every non-filtered ancestor above `deck_id`
    /// (Anki v3 `rslib/src/scheduler/queue/builder.rs` deck-tree limits).
    fn ancestor_cap(&self, deck_id: i64) -> (u32, u32) {
        if self.filtered.contains(&deck_id) {
            return (u32::MAX, u32::MAX);
        }
        let mut cap = (u32::MAX, u32::MAX);
        let mut seen = HashSet::new();
        let mut curr = self.parents.get(&deck_id).copied().flatten();
        while let Some(pid) = curr {
            if !seen.insert(pid) || self.filtered.contains(&pid) {
                break;
            }
            if let Some(&(n, r)) = self.subtree_remaining.get(&pid) {
                cap = (cap.0.min(n), cap.1.min(r));
            }
            curr = self.parents.get(&pid).copied().flatten();
        }
        cap
    }

    fn compute_subtree_studied(
        deck_id: i64,
        children: &HashMap<i64, Vec<i64>>,
        filtered: &HashSet<i64>,
        studied: &HashMap<i64, (u32, u32)>,
        memo: &mut HashMap<i64, (u32, u32)>,
    ) -> (u32, u32) {
        if let Some(&cached) = memo.get(&deck_id) {
            return cached;
        }
        let mut total = studied.get(&deck_id).copied().unwrap_or((0, 0));
        if !filtered.contains(&deck_id) {
            if let Some(kids) = children.get(&deck_id) {
                for &kid in kids {
                    let (n, r) =
                        Self::compute_subtree_studied(kid, children, filtered, studied, memo);
                    total.0 += n;
                    total.1 += r;
                }
            }
        }
        memo.insert(deck_id, total);
        total
    }

    pub(crate) fn children_of(&self, deck_id: i64) -> &[i64] {
        if self.filtered.contains(&deck_id) {
            return &[];
        }
        self.children.get(&deck_id).map_or(&[], Vec::as_slice)
    }

    pub(crate) fn studied_of(&self, deck_id: i64) -> (u32, u32) {
        self.subtree_studied
            .get(&deck_id)
            .copied()
            .unwrap_or((0, 0))
    }

    /// Accumulate per-deck study data across `deck_id`'s non-filtered subtree
    /// under Anki v3 daily limits: every deck's effective limit is capped by its
    /// own remaining allowance and every ancestor's up to the root (including
    /// ancestors above `deck_id`), and each subtree total is capped by its root's allowance.
    pub(crate) fn map_subtree<T, F, C>(
        &self,
        deck_id: i64,
        parent_cap: (u32, u32),
        fetch: &mut F,
        combine: &C,
    ) -> CoreResult<T>
    where
        F: FnMut(i64, (u32, u32)) -> CoreResult<T>,
        C: Fn(T, Vec<T>, (u32, u32)) -> T,
    {
        let anc = self.ancestor_cap(deck_id);
        let root_parent_cap = (parent_cap.0.min(anc.0), parent_cap.1.min(anc.1));
        self.map_subtree_inner(deck_id, root_parent_cap, fetch, combine)
    }

    fn map_subtree_inner<T, F, C>(
        &self,
        deck_id: i64,
        parent_cap: (u32, u32),
        fetch: &mut F,
        combine: &C,
    ) -> CoreResult<T>
    where
        F: FnMut(i64, (u32, u32)) -> CoreResult<T>,
        C: Fn(T, Vec<T>, (u32, u32)) -> T,
    {
        let (own_new_rem, own_rev_rem) = self
            .subtree_remaining
            .get(&deck_id)
            .copied()
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        let my_cap = (parent_cap.0.min(own_new_rem), parent_cap.1.min(own_rev_rem));
        let own = fetch(deck_id, my_cap)?;
        let kids = self.children_of(deck_id);
        let mut child_vals = Vec::with_capacity(kids.len());
        for &kid in kids {
            child_vals.push(self.map_subtree_inner(kid, my_cap, fetch, combine)?);
        }
        Ok(combine(own, child_vals, my_cap))
    }

    pub(crate) fn combine_counts(
        own: (u32, u32, u32),
        children: Vec<(u32, u32, u32)>,
        cap: (u32, u32),
    ) -> (u32, u32, u32) {
        let mut total = own;
        for (n, l, r) in children {
            total.0 += n;
            total.1 += l;
            total.2 += r;
        }
        (total.0.min(cap.0), total.1, total.2.min(cap.1))
    }
}

impl Collection {
    /// `deck_id` plus every non-filtered subdeck under it, or just `deck_id`
    /// alone if it is itself a filtered deck (filtered decks pull cards from
    /// elsewhere and are always studied in isolation, never as part of a
    /// parent's subtree).
    pub(crate) fn study_subtree(&self, deck_id: i64) -> CoreResult<Vec<i64>> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        if deck.is_filtered {
            return Ok(vec![deck_id]);
        }
        let filtered_ids: HashSet<i64> = self
            .storage
            .list_decks()?
            .into_iter()
            .filter(|d| d.is_filtered)
            .map(|d| d.id)
            .collect();
        Ok(self
            .deck_and_descendants(deck_id)?
            .into_iter()
            .filter(|id| *id == deck_id || !filtered_ids.contains(id))
            .collect())
    }

    /// Count of studyable cards by type `(new, learning, review)` across
    /// `deck_id` and its non-filtered subtree, capped by every ancestor's
    /// remaining daily limit up to (and including) `deck_id`.
    pub fn count_due_by_type(&self, deck_id: i64) -> CoreResult<(u32, u32, u32)> {
        let plan = StudySubtreePlan::build(self)?;
        let today = self.today();
        let now_ms = self.now_ms();
        let today_end_ms = self.today_end_ms();
        plan.map_subtree(
            deck_id,
            (u32::MAX, u32::MAX),
            &mut |id, (new_limit, review_limit)| {
                self.storage.count_due_by_type(
                    id,
                    today,
                    now_ms,
                    today_end_ms,
                    new_limit,
                    review_limit,
                )
            },
            &StudySubtreePlan::combine_counts,
        )
    }

    /// Total count of studyable cards in `deck_id` and its subtree right now.
    pub fn count_due(&self, deck_id: i64) -> CoreResult<u32> {
        let (n, l, r) = self.count_due_by_type(deck_id)?;
        Ok(n + l + r)
    }

    /// The next card to study in a deck (or its non-filtered subtree), if any,
    /// capped by every ancestor's remaining daily limit up to (and including)
    /// `deck_id`.
    ///
    /// Order: learning cards due now across the subtree (time-critical,
    /// soonest first), then a proportional interleave of new and review cards
    /// so new cards surface throughout the session, then — only if nothing
    /// else is due — the soonest learn-ahead card.
    pub fn next_card(&self, deck_id: i64) -> CoreResult<Option<StudyCard>> {
        match self.next_card_id(deck_id)? {
            Some(id) => self.storage.study_card(id),
            None => Ok(None),
        }
    }

    /// Pick the id of the next card to study, applying the queue ordering and
    /// Anki v3 ancestor-capped daily limits across `deck_id`'s non-filtered
    /// subtree.
    pub(crate) fn next_card_id(&self, deck_id: i64) -> CoreResult<Option<i64>> {
        let plan = StudySubtreePlan::build(self)?;
        let single_deck = plan.children_of(deck_id).is_empty();
        let today = self.today();
        let now_ms = self.now_ms();
        let today_end_ms = self.today_end_ms();

        let queue = plan.map_subtree(
            deck_id,
            (u32::MAX, u32::MAX),
            &mut |id, (new_limit, review_limit)| {
                self.storage
                    .study_queue(id, today, now_ms, today_end_ms, new_limit, review_limit)
            },
            &|mut own, children, cap| {
                for child in children {
                    own.learning.extend(child.learning);
                    own.new.extend(child.new);
                    own.review.extend(child.review);
                    own.learning_ahead.extend(child.learning_ahead);
                }
                own.new.truncate(cap.0 as usize);
                own.review.truncate(cap.1 as usize);
                own
            },
        )?;
        let learning = queue.learning;
        let new = queue.new;
        let review = queue.review;
        let learning_ahead = queue.learning_ahead;

        // If an answer was just undone, return that undone card next when it is
        // still eligible in this deck's subtree (Anki rslib/src/scheduler/answering/undo.rs).
        if let Some(undone_id) = self.last_undone_card_id() {
            if self.is_undone_card_eligible(
                undone_id,
                deck_id,
                &plan,
                today,
                now_ms,
                today_end_ms,
                &learning,
                &new,
                &review,
                &learning_ahead,
            )? {
                return Ok(Some(undone_id));
            }
        }

        // A just-answered card must not resurface immediately — but only while
        // some other card can be shown instead. Look up last-answered times
        // once for every candidate that could be affected (due-now learning
        // cards plus learn-ahead candidates) and treat anything answered within
        // `GRACE_MS` as deferred, not blocked.
        let grace_candidates: Vec<i64> = learning
            .iter()
            .chain(learning_ahead.iter())
            .copied()
            .collect();
        let last_answered = self.storage.cards_last_answered(&grace_candidates)?;
        let in_grace = |id: &i64| {
            last_answered
                .get(id)
                .is_some_and(|&last| now_ms - last < GRACE_MS)
        };
        // A due-now learning card is only skipped for the single answer right
        // after it was answered; once another card is answered, it is due and
        // must resurface instead of starving behind the new/review streams.
        let latest_answered = if learning.is_empty() {
            None
        } else {
            self.storage.latest_answered_card_id()?
        };
        let due_in_grace = |id: &i64| latest_answered == Some(*id) && in_grace(id);

        // 1. Learning due now — soonest first across the whole subtree,
        //    skipping a card just answered (once) while another card is due. A
        //    single deck's queue is already sorted by due; merging several
        //    needs an explicit due lookup.
        let due_ms = if single_deck {
            None
        } else {
            Some(self.storage.cards_due_ms(&learning)?)
        };
        let soonest_due = |ids: &[i64]| -> Option<i64> {
            match &due_ms {
                Some(due) => ids
                    .iter()
                    .min_by_key(|id| due.get(id).copied().unwrap_or(i64::MAX))
                    .copied(),
                None => ids.first().copied(),
            }
        };
        let learning_ready: Vec<i64> = learning
            .iter()
            .copied()
            .filter(|id| !due_in_grace(id))
            .collect();
        if !learning_ready.is_empty() {
            return Ok(soonest_due(&learning_ready));
        }

        // 2. Proportional interleave of new vs review. Today's studied counts
        //    across the whole subtree pace the ratio: pick whichever stream is
        //    proportionally behind. The queue is rebuilt each call and
        //    `today_studied` advances after every answer, so the running ratio
        //    stays even without session state.
        let next_new = new.first().copied();
        let next_review = review.first().copied();
        match (next_new, next_review) {
            (Some(n), Some(r)) => {
                let (new_done, rev_done) = plan.studied_of(deck_id);
                let take_new =
                    prefer_new(new_done, new.len() as u32, rev_done, review.len() as u32);
                Ok(Some(if take_new { n } else { r }))
            }
            (Some(n), None) => Ok(Some(n)),
            (None, Some(r)) => Ok(Some(r)),
            // 3. Nothing else due — fall back to the soonest learn-ahead card
            //    (or a due-now card deferred above for being in grace),
            //    preferring one that's out of grace. If every candidate is
            //    still in grace, it's the only thing left to show, so show it
            //    anyway rather than dead-ending the session.
            (None, None) => {
                let fallback: Vec<i64> = learning_ahead
                    .iter()
                    .chain(learning.iter())
                    .copied()
                    .collect();
                if fallback.is_empty() {
                    return Ok(None);
                }
                let due = self.storage.cards_due_ms(&fallback)?;
                let pick_soonest = |ids: &[i64]| -> Option<i64> {
                    ids.iter()
                        .copied()
                        .min_by_key(|id| due.get(id).copied().unwrap_or(i64::MAX))
                };
                let ready: Vec<i64> = fallback
                    .iter()
                    .copied()
                    .filter(|id| !in_grace(id))
                    .collect();
                Ok(pick_soonest(&ready).or_else(|| pick_soonest(&fallback)))
            }
        }
    }

    /// Return true when `undone_id` can be served next for `deck_id`.
    #[allow(clippy::too_many_arguments)]
    fn is_undone_card_eligible(
        &self,
        undone_id: i64,
        deck_id: i64,
        plan: &StudySubtreePlan,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        learning: &[i64],
        new: &[i64],
        review: &[i64],
        learning_ahead: &[i64],
    ) -> CoreResult<bool> {
        if learning.contains(&undone_id)
            || new.contains(&undone_id)
            || review.contains(&undone_id)
            || learning_ahead.contains(&undone_id)
        {
            return Ok(true);
        }
        let Some(card) = self.storage.study_card(undone_id)? else {
            return Ok(false);
        };
        if self.storage.card_queue(undone_id)?.is_some_and(|q| q < 0) {
            return Ok(false);
        }
        let subtree = self.study_subtree(deck_id)?;
        if !subtree.contains(&card.deck_id) {
            return Ok(false);
        }
        let is_filtered = plan.filtered.contains(&deck_id);
        let anc = plan.ancestor_cap(card.deck_id);
        let own_rem = plan
            .subtree_remaining
            .get(&card.deck_id)
            .copied()
            .unwrap_or((0, 0));
        let eff = (anc.0.min(own_rem.0), anc.1.min(own_rem.1));
        let q = self.storage.card_queue(undone_id)?.unwrap_or(0);
        match card.state.phase {
            CardPhase::New => Ok(eff.0 > 0),
            CardPhase::Review => Ok(eff.1 > 0 && (is_filtered || card.due <= i64::from(today))),
            CardPhase::Learning | CardPhase::Relearning => {
                if is_filtered {
                    return Ok(true);
                }
                if q == 3 {
                    Ok(card.due <= i64::from(today))
                } else {
                    Ok(card.due <= now_ms.saturating_add(20 * 60_000) && card.due < today_end_ms)
                }
            }
        }
    }

    /// Unbury all buried cards if the day has rolled over since the last unbury.
    /// Returns `true` if an unbury was executed.
    pub fn maybe_unbury_day_rollover(&self) -> CoreResult<bool> {
        let today = self.today();
        let last = self.last_unbury_day.load(Ordering::Relaxed);
        if last != today {
            let now_ms = self.clock.now_ms();
            self.storage.unbury_all(now_ms)?;
            self.last_unbury_day.store(today, Ordering::Relaxed);
            let _ = self.storage.set_last_unbury_day(today, now_ms);
            self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
            return Ok(true);
        }
        Ok(false)
    }

    fn mark_bury_day_initialized(&self, now_ms: i64) {
        let today = self.today();
        if self
            .last_unbury_day
            .compare_exchange(i32::MIN, today, Ordering::Relaxed, Ordering::Relaxed)
            .is_ok()
        {
            let _ = self.storage.set_last_unbury_day(today, now_ms);
        }
    }

    /// Prepare a study session for `deck_id` (unburies only when the study day
    /// has rolled over).
    pub fn start_study_session(&self, _deck_id: i64) -> CoreResult<()> {
        self.maybe_unbury_day_rollover()?;
        Ok(())
    }

    /// Explicitly unbury all buried cards in `deck_id` and its subtree on demand.
    pub fn unbury_deck(&self, deck_id: i64) -> CoreResult<()> {
        let now_ms = self.clock.now_ms();
        for id in self.study_subtree(deck_id)? {
            self.storage.unbury_deck(id, now_ms)?;
        }
        self.clear_undo();
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }

    /// Render inputs + scheduling state for a specific card.
    pub fn study_card(&self, card_id: i64) -> CoreResult<Option<StudyCard>> {
        self.storage.study_card(card_id)
    }

    /// Scheduling config for `card_id`, using its home deck (`original_deck_id`)
    /// when the card is currently gathered in a filtered deck.
    pub fn get_sched_config_for_card(
        &self,
        card_id: i64,
        fallback_deck_id: i64,
    ) -> CoreResult<crate::scheduling::SchedConfig> {
        let deck_id = self
            .storage
            .card_home_deck_id(card_id)?
            .unwrap_or(fallback_deck_id);
        self.get_sched_config(deck_id)
    }

    /// Answer a card: load card + deck config, run the configured [`SchedulerSet`],
    /// apply interval fuzz, build [`Revlog`], and persist via [`Collection::apply_answer`].
    /// Returns `true` if a leech fired.
    pub fn answer_card(&self, card_id: i64, rating: Rating, time_ms: i64) -> CoreResult<bool> {
        let scheduler_set = self.scheduler_set.as_ref().ok_or_else(|| {
            CoreError::Invalid("scheduler_set is not configured on Collection".into())
        })?;
        let card = self
            .study_card(card_id)?
            .ok_or_else(|| CoreError::NotFound(format!("card {card_id}")))?;
        if self.storage.card_queue(card_id)?.is_some_and(|q| q < 0) {
            return Err(CoreError::Invalid(
                "cannot answer a suspended or buried card".into(),
            ));
        }
        let raw_ease = self.storage.card_raw_ease_factor(card_id)?;
        let config = self.get_sched_config_for_card(card_id, card.deck_id)?;
        let leech_threshold = config.leech_threshold;
        let algorithm = config.algorithm;
        let today = self.today();
        let min_ivl = config.minimum_interval_days.max(1);
        let max_ivl = config.maximum_interval_days.max(min_ivl);
        let ctx = SchedContext { today, config };
        let outcome = scheduler_set.answer(algorithm, &card.state, rating, &ctx);

        let now = self.clock.now_ms();
        let due = match outcome.interval {
            Interval::Days(days) => {
                let fuzzed = scheduler_set
                    .fuzz_days(days, card_id)
                    .clamp(min_ivl.min(days), max_ivl);
                i64::from(today) + i64::from(fuzzed)
            }
            Interval::Minutes(minutes) => now + i64::from(minutes) * 60_000,
        };
        let review_kind = match card.state.phase {
            CardPhase::Review => 1,
            CardPhase::Relearning => 2,
            _ => 0,
        };
        let log = Revlog {
            id: now,
            card_id,
            usn: -1,
            ease: rating as i64,
            interval: i64::from(outcome.next.interval_days),
            last_interval: i64::from(card.state.interval_days),
            ease_factor: i64::from(outcome.next.ease_milli),
            taken_ms: time_ms.clamp(0, 60_000),
            review_kind,
        };
        let mut prev_state = card.state;
        if raw_ease == Some(0) {
            prev_state.ease_milli = 0;
        }
        self.apply_answer(
            card_id,
            card.note_id,
            &prev_state,
            card.due,
            &outcome.next,
            due,
            &log,
            leech_threshold,
        )
    }

    /// Persist an answered card's new state + review log.
    /// Also buries siblings and, if lapses crossed the leech threshold, tags the
    /// note with "leech" and suspends the card. Returns `true` if a leech fired.
    /// Records an undo action in `UndoLog`.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_answer(
        &self,
        card_id: i64,
        note_id: i64,
        prev: &CardState,
        prev_due: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        leech_threshold: u32,
    ) -> CoreResult<bool> {
        let now_ms = self.clock.now_ms();
        let today = self.today();
        let source_key = crate::progress::review_source_key(card_id, today);
        let reward = crate::progress::reward_for_revlog(log.ease, log.review_kind).map(|r| {
            crate::progress::RewardGrant {
                id: crate::progress::ledger_id(crate::progress::NIL_USER_ID, &source_key),
                user_id: crate::progress::NIL_USER_ID.to_string(),
                source_key: source_key.clone(),
                xp: r.xp as i64,
                gold_cents: r.gold_cents as i64,
                now_ms,
            }
        });
        let tz_offset = self.tz_offset_minutes.load(Ordering::Relaxed);
        let rollover = self.rollover_hour.load(Ordering::Relaxed);
        let ctx = crate::game_depth::GameEvalContext {
            user_id: crate::progress::NIL_USER_ID.to_string(),
            today,
            awarded_day: today,
            now_ms,
            tz_offset_minutes: tz_offset,
            rollover_hour: rollover,
            created_ms: self.created_ms,
            card_is_mature: crate::progress::is_mature_card(
                crate::scheduling::CardPhase::Review as i64,
                if next.phase == crate::scheduling::CardPhase::Review {
                    2
                } else {
                    0
                },
                i64::from(next.interval_days),
            ) && next.phase == crate::scheduling::CardPhase::Review,
        };
        // Leech detection: only fire when this answer recorded a new lapse.
        let is_leech = leech_threshold > 0
            && next.lapses > prev.lapses
            && next.lapses.is_multiple_of(leech_threshold);
        let outcome = self.storage.apply_answer_atomic(
            card_id,
            note_id,
            next,
            due,
            log,
            reward.as_ref(),
            is_leech,
            &ctx,
        )?;
        let granted = outcome.reward_granted;
        let buried_siblings = outcome.buried_siblings;
        if !buried_siblings.is_empty() {
            self.mark_bury_day_initialized(now_ms);
        }
        let added_leech_tag = outcome.added_leech_tag;
        if is_leech {
            self.events.emit(DomainEvent::NoteUpdated { note_id });
        }
        let revlog_id = outcome.revlog_id;
        let prev_state = *prev;
        let leech_note = added_leech_tag.then_some(note_id);
        let undo_reward_key = granted.then_some(source_key);
        let answer_day = today;
        let day_start_ms = self.day_start_end_ms(answer_day).0;
        let day_end_ms = day_start_ms + crate::progress::MS_PER_DAY;
        let created_ms = self.created_ms;
        let created_day = crate::progress::created_epoch_day(created_ms, tz_offset, rollover);
        self.set_last_undone_card_id(None);
        self.record_undo_for_card(UndoAction::AnswerCard, card_id, move |s, now| {
            s.undo_answer(
                card_id,
                &prev_state,
                prev_due,
                revlog_id,
                &buried_siblings,
                leech_note,
                undo_reward_key.as_deref(),
                now,
            )?;
            s.revoke_streak_freeze_if_inactive(answer_day, tz_offset, rollover, created_ms, now)?;
            let undo_today =
                crate::progress::day_index_for_ms(now, tz_offset, rollover, created_day) as i32;
            if crate::progress::is_habit_day_reward_eligible(answer_day, undo_today) {
                let _ = super::productivity::sync_deck_linked_habits_on_storage(
                    s,
                    answer_day,
                    undo_today,
                    day_start_ms,
                    day_end_ms,
                    now,
                    tz_offset,
                    rollover,
                    created_ms,
                )?;
            }
            Ok(())
        });
        let _ = self.sync_deck_linked_habits_for_day(today)?;
        let _ = self.reconcile_motivation(false)?;
        self.events.emit(DomainEvent::CardAnswered { card_id });
        if outcome.game_changed {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(is_leech)
    }

    /// Read-only summary of the user's progress (level, XP, gold, today's totals, and daily task cap, ADR-019 §2.7 / §4.6).
    pub fn progress_summary(&self) -> CoreResult<crate::progress::ProgressSummaryDto> {
        let totals = self.storage.progress_totals(
            crate::progress::NIL_USER_ID,
            self.today_start_ms(),
            self.today_end_ms(),
            self.today(),
        )?;
        let spent_gold_cents = self
            .storage
            .spent_gold_cents(crate::progress::NIL_USER_ID)?;
        let lvl = crate::progress::level_from_xp(totals.total_xp);
        Ok(crate::progress::ProgressSummaryDto {
            level: lvl.level,
            xp_into_level: lvl.xp_into_level,
            xp_to_next_level: lvl.xp_to_next_level,
            total_xp: totals.total_xp,
            gold_cents: crate::game::available_gold_cents(totals.gold_cents, spent_gold_cents),
            today_xp: totals.today_xp,
            today_gold_cents: totals.today_gold_cents,
            tasks_rewarded_today: totals.tasks_rewarded_today,
            task_reward_daily_cap: crate::progress::TASK_DAILY_REWARD_CAP,
        })
    }

    /// Daily XP/gold history ordered by day ascending (ADR-019 §3).
    pub fn progress_history(&self) -> CoreResult<Vec<crate::progress::ProgressDay>> {
        self.progress_history_with_skipped().map(|(days, _)| days)
    }

    /// Daily XP/gold history plus count of skipped malformed `source_key` rows.
    pub fn progress_history_with_skipped(
        &self,
    ) -> CoreResult<(Vec<crate::progress::ProgressDay>, usize)> {
        self.storage.progress_history(
            crate::progress::NIL_USER_ID,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )
    }

    /// Last `limit` study days (default 30, max 365) ordered newest first (ADR-019 §3).
    pub fn study_days(&self, limit: Option<u32>) -> CoreResult<Vec<crate::progress::StudyDay>> {
        self.study_days_with_skipped(limit).map(|(days, _)| days)
    }

    /// Last `limit` study days plus count of skipped malformed `source_key` rows.
    pub fn study_days_with_skipped(
        &self,
        limit: Option<u32>,
    ) -> CoreResult<(Vec<crate::progress::StudyDay>, usize)> {
        let clamped = limit.unwrap_or(30).min(365);
        self.storage.study_days(
            crate::progress::NIL_USER_ID,
            clamped,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )
    }

    /// Per-top-deck progress rollup for decks that contain cards (ADR-019 §3).
    pub fn progress_by_deck(&self) -> CoreResult<Vec<crate::progress::DeckProgress>> {
        self.progress_by_deck_with_skipped().map(|(rows, _)| rows)
    }

    /// Per-top-deck progress rollup plus count of skipped malformed `source_key` rows.
    pub fn progress_by_deck_with_skipped(
        &self,
    ) -> CoreResult<(Vec<crate::progress::DeckProgress>, usize)> {
        self.storage.progress_by_deck(
            crate::progress::NIL_USER_ID,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.clock.now_ms(),
            self.created_ms,
        )
    }

    fn record_cards_restore_undo(&self, action: UndoAction, prev: Vec<crate::model::Card>) {
        if prev.len() == 1 {
            let card_id = prev[0].id;
            self.record_undo_for_card(action, card_id, move |s, now| s.restore_cards(&prev, now));
        } else {
            self.record_undo(action, move |s, now| s.restore_cards(&prev, now));
        }
    }

    /// Suspend cards (sets `queue = -1`). Records one undo step and emits one event.
    pub fn suspend_cards(&self, card_ids: &[i64]) -> CoreResult<()> {
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let prev = self.storage.cards_by_ids(card_ids)?;
        self.storage.suspend_cards(card_ids, now_ms)?;
        if !prev.is_empty() {
            if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_cards_restore_undo(UndoAction::SuspendCards { count }, prev);
        }
        self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        Ok(())
    }

    /// Unsuspend cards. Records one undo step and emits one event.
    pub fn unsuspend_cards(&self, card_ids: &[i64]) -> CoreResult<()> {
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let prev = self.storage.cards_by_ids(card_ids)?;
        self.storage.unsuspend_cards(card_ids, now_ms)?;
        if !prev.is_empty() {
            if prev.len() == 1 {
                self.set_last_undone_card_id(Some(prev[0].id));
            } else if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_cards_restore_undo(UndoAction::UnsuspendCards { count }, prev);
        }
        self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        Ok(())
    }

    /// Manually bury cards (sets `queue = -2`). Records one undo step and emits one event.
    pub fn bury_cards(&self, card_ids: &[i64]) -> CoreResult<()> {
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        self.mark_bury_day_initialized(now_ms);
        let prev = self.storage.cards_by_ids(card_ids)?;
        self.storage.bury_cards(card_ids, now_ms)?;
        if !prev.is_empty() {
            if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_cards_restore_undo(UndoAction::BuryCards { count }, prev);
        }
        self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        Ok(())
    }

    /// Restore buried cards (`queue IN (-2, -3)`) to their natural queue.
    /// Records one undo step and emits one event.
    pub fn unbury_cards(&self, card_ids: &[i64]) -> CoreResult<()> {
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let prev = self.storage.cards_by_ids(card_ids)?;
        self.storage.unbury_cards(card_ids, now_ms)?;
        if !prev.is_empty() {
            if prev.len() == 1 {
                self.set_last_undone_card_id(Some(prev[0].id));
            } else if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_cards_restore_undo(UndoAction::UnburyCards { count }, prev);
        }
        self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        Ok(())
    }

    /// Set the flag (0–7) on a list of cards. Records one undo step and emits one event.
    pub fn set_card_flag(&self, card_ids: &[i64], flag: u8) -> CoreResult<()> {
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let prev = self.storage.cards_by_ids(card_ids)?;
        self.storage.set_card_flag(card_ids, flag, now_ms)?;
        if !prev.is_empty() {
            if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_undo(UndoAction::SetCardFlag { count }, move |s, now| {
                s.restore_cards(&prev, now)
            });
        }
        self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        Ok(())
    }

    /// Reset `card_ids` to the new queue (`type = 0, queue = 0`), optionally clearing
    /// `reps` and `lapses`. Runs in one transaction, records one undo step, and emits
    /// one event for the batch.
    pub fn forget_cards(&self, card_ids: &[i64], reset_counts: bool) -> CoreResult<()> {
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let (prev, revlog_ids) =
            self.storage
                .forget_cards_with_revlog(card_ids, reset_counts, now_ms)?;
        if !prev.is_empty() {
            if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_undo(UndoAction::ForgetCards { count }, move |s, now| {
                s.restore_cards(&prev, now)?;
                s.delete_revlogs(&revlog_ids)
            });
            self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        }
        Ok(())
    }

    /// Perform a full deck-level progress reset (F1): resets cards in `deck_id` (and
    /// non-filtered subdecks), wipes their `revlog` rows, soft-deletes their review
    /// XP/gold ledger grants, revokes pet credits, clears today's extra-new override,
    /// invalidates XP caches, and reconciles motivation. Undo restores everything.
    pub fn reset_deck_progress(&self, deck_id: i64) -> CoreResult<u32> {
        self.reset_deck_progress_scoped(deck_id, true)
    }

    /// Variant of [`Collection::reset_deck_progress`] allowing the UI dialog to choose
    /// whether non-filtered subdecks are included.
    pub fn reset_deck_progress_scoped(
        &self,
        deck_id: i64,
        include_subdecks: bool,
    ) -> CoreResult<u32> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        if deck.is_filtered {
            return Err(CoreError::Invalid(
                "cannot reset progress of a filtered deck".into(),
            ));
        }
        let deck_ids = if include_subdecks {
            self.study_subtree(deck_id)?
        } else {
            vec![deck_id]
        };
        let now_ms = self.clock.now_ms();
        let today = self.today();
        let snap = self.storage.reset_deck_progress(&deck_ids, today, now_ms)?;
        let count = snap.cards.len() as u32;
        if let Some(undone_id) = self.last_undone_card_id() {
            if snap.cards.iter().any(|c| c.id == undone_id) {
                self.set_last_undone_card_id(None);
            }
        }
        let _ = self.reconcile_motivation(true)?;
        if count > 0 || !snap.day_limit_overrides.is_empty() {
            self.record_undo(
                UndoAction::ResetDeckProgress {
                    name: deck.name,
                    count,
                },
                move |s, now| s.restore_deck_reset(&snap, now),
            );
        }
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        self.events.emit(DomainEvent::SchemaChanged);
        self.events.emit(DomainEvent::GameChanged);
        Ok(count)
    }

    /// Reschedule `card_ids` using an Anki relative due-date string (`"0"`, `"3"`, `"1-7"`).
    /// Review cards keep their interval; new/learning cards become reviews. Runs in one
    /// transaction, records one undo step, and emits one event for the batch.
    pub fn set_due_date(&self, card_ids: &[i64], spec: &str) -> CoreResult<()> {
        let (min_days, max_days) = crate::ipc::parse_due_date_spec(spec)?;
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let today = self.today();
        let prev = self
            .storage
            .set_due_date(card_ids, min_days, max_days, today, now_ms)?;
        if !prev.is_empty() {
            if self
                .last_undone_card_id()
                .is_some_and(|id| card_ids.contains(&id))
            {
                self.set_last_undone_card_id(None);
            }
            let count = prev.len() as u32;
            self.record_undo(UndoAction::SetDueDate { count }, move |s, now| {
                s.restore_cards(&prev, now)
            });
            self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        }
        Ok(())
    }

    /// Reposition selected new cards (`start`, `step`, optional `shuffle` and
    /// `shift_existing`). Runs in one transaction, records one undo step, and emits
    /// one event for the batch.
    pub fn reposition_new_cards(
        &self,
        card_ids: &[i64],
        start: i64,
        step: i64,
        shuffle: bool,
        shift_existing: bool,
    ) -> CoreResult<()> {
        if start < 0 {
            return Err(CoreError::Invalid(
                "start position must be non-negative".into(),
            ));
        }
        if step < 1 {
            return Err(CoreError::Invalid("step must be at least 1".into()));
        }
        if card_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let prev = self.storage.reposition_new_cards(
            card_ids,
            start,
            step,
            shuffle,
            shift_existing,
            now_ms,
        )?;
        let id_set: HashSet<i64> = card_ids.iter().copied().collect();
        let affected_count = prev.iter().filter(|c| id_set.contains(&c.id)).count() as u32;
        if !prev.is_empty() {
            self.record_undo(
                UndoAction::RepositionCards {
                    count: affected_count,
                },
                move |s, now| s.restore_cards(&prev, now),
            );
            self.events.emit(DomainEvent::DeckChanged { deck_id: 0 });
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "study_tests.rs"]
mod tests;
