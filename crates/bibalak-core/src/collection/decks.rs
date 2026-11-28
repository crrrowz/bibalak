use crate::deck_name::{deck_ancestors, is_same_or_below, normalise_deck_name, sort_decks_as_tree};
use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{DeckConfig, DeckSummary, FilteredDeckConfig};
use crate::model::Deck;
use crate::ports::Storage;
use crate::undo::UndoAction;
use crate::Collection;

use super::study::StudySubtreePlan;

/// Undo helper: remove decks a create/rename made as missing parents, deepest
/// first, but only while they are still empty (no subdeck, no card) so an
/// undo never deletes anything added since.
fn remove_empty_decks(s: &dyn Storage, ids: &[i64], now_ms: i64) -> CoreResult<()> {
    for &id in ids.iter().rev() {
        if s.deck_by_id(id)?.is_none() {
            continue;
        }
        let has_child = s.list_decks()?.iter().any(|d| d.parent_id == Some(id));
        if has_child || !s.deck_card_ids(&[id])?.is_empty() {
            continue;
        }
        s.remove_deck(id, now_ms)?;
    }
    Ok(())
}

impl Collection {
    /// Decks with per-type card counts `(new, learning, review)`, capped by
    /// daily limits (including ancestor deck limits along each deck's
    /// non-filtered subtree, matching `count_due_by_type`). Filtered decks
    /// report only their own counts in isolation.
    #[allow(clippy::type_complexity)]
    pub fn list_decks_with_counts(&self) -> CoreResult<Vec<(Deck, (u32, u32, u32))>> {
        self.maybe_unbury_day_rollover()?;
        let decks = self.list_decks()?;
        let raw_counts =
            self.storage
                .deck_due_counts(self.today(), self.now_ms(), self.today_end_ms())?;
        let plan = StudySubtreePlan::build(self)?;

        decks
            .into_iter()
            .map(|d| {
                let id = d.id;
                let capped = plan.map_subtree(
                    id,
                    (u32::MAX, u32::MAX),
                    &mut |sub_id, (new_limit, review_limit)| {
                        let (n, l, r) = raw_counts.get(&sub_id).copied().unwrap_or((0, 0, 0));
                        Ok((n.min(new_limit), l, r.min(review_limit)))
                    },
                    &StudySubtreePlan::combine_counts,
                )?;
                Ok((d, capped))
            })
            .collect()
    }

    /// Current `(new_per_day, review_per_day)` limit for a deck.
    pub fn get_deck_options(&self, deck_id: i64) -> CoreResult<(u32, u32)> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        self.storage.deck_limits(deck.config_id)
    }

    /// Persist updated daily limits for a deck.
    pub fn set_deck_options(
        &self,
        deck_id: i64,
        new_per_day: u32,
        rev_per_day: u32,
    ) -> CoreResult<()> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        let (prev_new, prev_rev) = self.storage.deck_limits(deck.config_id)?;
        let config_id = deck.config_id;
        self.storage
            .set_deck_limits(config_id, new_per_day, rev_per_day, self.now_ms())?;
        self.record_undo(UndoAction::ChangeDeckOptions, move |s, now| {
            s.set_deck_limits(config_id, prev_new, prev_rev, now)
        });
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }

    /// Current extra new-card allowance for `deck_id` for today, if any.
    pub fn get_today_extra_new(&self, deck_id: i64) -> CoreResult<u32> {
        self.storage.day_extra_new(deck_id, self.today())
    }

    /// Temporarily raise today's new-card limit for `deck_id` (and each
    /// non-filtered subdeck in its subtree) by `extra_new` cards, stacking on
    /// top of any earlier increase made today. Only applies for today
    /// (`Collection::today()`); it lapses on its own at the next day rollover
    /// since the override is keyed by day number. The parent's own cap still
    /// keeps the combined subtree total bounded.
    pub fn increase_today_new_limit(&self, deck_id: i64, extra_new: u32) -> CoreResult<()> {
        let subtree = self.study_subtree(deck_id)?;
        let today = self.today();
        let mut prev = Vec::with_capacity(subtree.len());
        for &sub_id in &subtree {
            let current = self.storage.day_extra_new(sub_id, today)?;
            prev.push((sub_id, current));
            self.storage
                .set_day_extra_new(sub_id, today, current.saturating_add(extra_new))?;
        }
        self.record_undo(UndoAction::IncreaseTodayLimit, move |s, _| {
            for (sub_id, prev_extra) in prev {
                s.set_day_extra_new(sub_id, today, prev_extra)?;
            }
            Ok(())
        });
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }

    /// All card IDs in `deck_id` (optionally including non-filtered subdecks),
    /// ordered deterministically by card id.
    pub fn deck_card_ids(&self, deck_id: i64, include_subdecks: bool) -> CoreResult<Vec<i64>> {
        self.storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        let deck_ids = if include_subdecks {
            self.study_subtree(deck_id)?
        } else {
            vec![deck_id]
        };
        self.storage.deck_card_ids(&deck_ids)
    }

    /// Full scheduling config for a deck, for the options dialog (M14).
    pub fn get_deck_config(&self, deck_id: i64) -> CoreResult<DeckConfig> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        let s = self.storage.get_deck_config(deck.config_id)?;
        Ok(DeckConfig {
            deck_id,
            config_id: deck.config_id,
            algorithm: s.algorithm,
            new_per_day: s.new_per_day,
            review_per_day: s.review_per_day,
            learning_steps_min: s.learning_steps_min,
            graduating_interval_days: s.graduating_interval_days,
            easy_interval_days: s.easy_interval_days,
            starting_ease_milli: s.starting_ease_milli,
            easy_bonus: s.easy_bonus,
            hard_interval_factor: s.hard_interval_factor,
            interval_modifier: s.interval_modifier,
            maximum_interval_days: s.maximum_interval_days,
            relearning_steps_min: s.relearning_steps_min,
            lapse_interval_factor: s.lapse_interval_factor,
            minimum_interval_days: s.minimum_interval_days,
            leech_threshold: s.leech_threshold,
            fsrs_weights: s.fsrs_weights.to_vec(),
            desired_retention: s.desired_retention,
        })
    }

    /// Persist full scheduling config for a deck. Validates bounds.
    pub fn set_deck_config(&self, cfg: &DeckConfig) -> CoreResult<()> {
        if cfg.new_per_day > 9999 {
            return Err(CoreError::Invalid("new cards/day must be 0–9999".into()));
        }
        if cfg.review_per_day > 9999 {
            return Err(CoreError::Invalid("reviews/day must be 0–9999".into()));
        }
        if cfg.learning_steps_min.len() > 32
            || cfg
                .learning_steps_min
                .iter()
                .any(|&s| !(1..=525_600).contains(&s))
        {
            return Err(CoreError::Invalid(
                "learning steps must be 1–525,600 minutes".into(),
            ));
        }
        if cfg.relearning_steps_min.len() > 32
            || cfg
                .relearning_steps_min
                .iter()
                .any(|&s| !(1..=525_600).contains(&s))
        {
            return Err(CoreError::Invalid(
                "relearning steps must be 1–525,600 minutes".into(),
            ));
        }
        if !(1300..=9999).contains(&cfg.starting_ease_milli) {
            return Err(CoreError::Invalid("starting ease must be 1300–9999".into()));
        }
        if !(cfg.desired_retention.is_finite() && (0.5..=0.99).contains(&cfg.desired_retention)) {
            return Err(CoreError::Invalid(
                "desired retention must be 0.50–0.99".into(),
            ));
        }
        if !(cfg.interval_modifier.is_finite() && (0.01..=9.99).contains(&cfg.interval_modifier)) {
            return Err(CoreError::Invalid(
                "interval modifier must be 0.01–9.99".into(),
            ));
        }
        if !(cfg.easy_bonus.is_finite() && (1.0..=5.0).contains(&cfg.easy_bonus)) {
            return Err(CoreError::Invalid("easy bonus must be 1.00–5.00".into()));
        }
        if !(cfg.hard_interval_factor.is_finite()
            && (0.05..=5.0).contains(&cfg.hard_interval_factor))
        {
            return Err(CoreError::Invalid(
                "hard interval factor must be 0.05–5.00".into(),
            ));
        }
        if !(cfg.lapse_interval_factor.is_finite()
            && (0.0..=1.0).contains(&cfg.lapse_interval_factor))
        {
            return Err(CoreError::Invalid(
                "lapse interval factor must be 0.00–1.00".into(),
            ));
        }
        if !(1..=36_500).contains(&cfg.graduating_interval_days) {
            return Err(CoreError::Invalid(
                "graduating interval must be 1–36,500".into(),
            ));
        }
        if !(1..=36_500).contains(&cfg.easy_interval_days) {
            return Err(CoreError::Invalid("easy interval must be 1–36,500".into()));
        }
        if !(1..=36_500).contains(&cfg.minimum_interval_days) {
            return Err(CoreError::Invalid(
                "minimum interval must be 1–36,500".into(),
            ));
        }
        if !(1..=36_500).contains(&cfg.maximum_interval_days) {
            return Err(CoreError::Invalid("max interval must be 1–36,500".into()));
        }
        if cfg.minimum_interval_days > cfg.maximum_interval_days {
            return Err(CoreError::Invalid(
                "minimum interval cannot exceed maximum interval".into(),
            ));
        }
        if cfg.leech_threshold > 999 {
            return Err(CoreError::Invalid("leech threshold must be 0–999".into()));
        }
        if cfg.fsrs_weights.len() != 21
            || cfg
                .fsrs_weights
                .iter()
                .any(|w| !w.is_finite() || !(-100.0..=100.0).contains(w))
        {
            return Err(CoreError::Invalid(
                "FSRS weights must have 21 finite values in -100..=100".into(),
            ));
        }
        let deck = self
            .storage
            .deck_by_id(cfg.deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {}", cfg.deck_id)))?;
        let mut arr = crate::scheduling::FSRS6_DEFAULT_WEIGHTS;
        for (i, &w) in cfg.fsrs_weights.iter().enumerate().take(21) {
            arr[i] = w;
        }
        let sched = crate::scheduling::SchedConfig {
            algorithm: cfg.algorithm,
            new_per_day: cfg.new_per_day,
            review_per_day: cfg.review_per_day,
            learning_steps_min: cfg.learning_steps_min.clone(),
            relearning_steps_min: cfg.relearning_steps_min.clone(),
            graduating_interval_days: cfg.graduating_interval_days,
            easy_interval_days: cfg.easy_interval_days,
            starting_ease_milli: cfg.starting_ease_milli,
            easy_bonus: cfg.easy_bonus,
            hard_interval_factor: cfg.hard_interval_factor,
            interval_modifier: cfg.interval_modifier,
            lapse_interval_factor: cfg.lapse_interval_factor,
            minimum_interval_days: cfg.minimum_interval_days,
            maximum_interval_days: cfg.maximum_interval_days,
            leech_threshold: cfg.leech_threshold,
            fsrs_weights: arr,
            desired_retention: cfg.desired_retention,
        };
        let config_id = deck.config_id;
        let prev_sched = self.storage.get_deck_config(config_id)?;
        self.storage
            .set_deck_config(config_id, &sched, self.now_ms())?;
        self.record_undo(UndoAction::ChangeDeckOptions, move |s, now| {
            s.set_deck_config(config_id, &prev_sched, now)
        });
        self.events.emit(DomainEvent::DeckChanged {
            deck_id: cfg.deck_id,
        });
        Ok(())
    }

    /// `SchedConfig` for a deck — used by the study commands for per-deck scheduling.
    pub fn get_sched_config(&self, deck_id: i64) -> CoreResult<crate::scheduling::SchedConfig> {
        let deck = self
            .storage
            .deck_by_id(deck_id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {deck_id}")))?;
        self.storage.get_deck_config(deck.config_id)
    }

    pub fn create_filtered_deck(
        &self,
        name: &str,
        search: &str,
        order: u8,
        limit: u32,
    ) -> CoreResult<DeckSummary> {
        let name = normalise_deck_name(name)?;
        self.ensure_name_free(&name, None)?;
        let missing = self.missing_ancestors(&name)?;
        let deck = self.storage.create_filtered_deck(
            &name,
            search,
            order,
            limit,
            self.today(),
            self.clock.now_ms(),
        )?;
        let id = deck.id;
        self.clear_undo();
        for deck_id in self.ids_by_name(&missing)?.into_iter().chain([id]) {
            self.events.emit(DomainEvent::DeckChanged { deck_id });
        }
        Ok(DeckSummary::from(deck))
    }

    pub fn rebuild_filtered(&self, deck_id: i64) -> CoreResult<u32> {
        let n = self
            .storage
            .rebuild_filtered(deck_id, self.today(), self.clock.now_ms())?;
        self.clear_undo();
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(n)
    }

    pub fn empty_filtered(&self, deck_id: i64) -> CoreResult<()> {
        self.storage.empty_filtered(deck_id, self.clock.now_ms())?;
        self.clear_undo();
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }

    pub fn get_filtered_config(&self, deck_id: i64) -> CoreResult<Option<FilteredDeckConfig>> {
        self.storage.get_filtered_config(deck_id)
    }

    /// All decks in tree order (each subdeck right after its parent, SUB1 F7).
    pub fn list_decks(&self) -> CoreResult<Vec<Deck>> {
        let mut decks = self.storage.list_decks()?;
        sort_decks_as_tree(&mut decks, |d| d.name.as_str());
        Ok(decks)
    }

    /// Create a deck. The name is normalised per `::` segment and any missing
    /// parent deck is created too (Anki rule, SUB1); undo removes the deck and
    /// the parents this call made.
    pub fn create_deck(&self, name: &str) -> CoreResult<Deck> {
        let name = normalise_deck_name(name)?;
        self.ensure_name_free(&name, None)?;
        let missing = self.missing_ancestors(&name)?;
        let deck = self.storage.create_deck(&name, self.clock.now_ms())?;
        let id = deck.id;
        let made = self.ids_by_name(&missing)?;
        let undo_made = made.clone();
        self.record_undo(UndoAction::CreateDeck { name }, move |s, now| {
            if s.deck_by_id(id)?.is_some() {
                s.remove_deck(id, now)?;
            }
            remove_empty_decks(s, &undo_made, now)
        });
        for deck_id in made.into_iter().chain([id]) {
            self.events.emit(DomainEvent::DeckChanged { deck_id });
        }
        Ok(deck)
    }

    /// Rename a deck and move its whole subtree with it: every subdeck gets
    /// the new prefix, and a `X::Y` name moves the deck under `X` (created if
    /// missing). Undo restores all names and parents in one step.
    pub fn rename_deck(&self, id: i64, name: &str) -> CoreResult<()> {
        let name = normalise_deck_name(name)?;
        let old = self
            .storage
            .deck_by_id(id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {id}")))?;
        if name == old.name {
            return Ok(());
        }
        if is_same_or_below(&name, &old.name) {
            return Err(CoreError::Invalid(
                "a deck cannot be moved into its own subdeck".into(),
            ));
        }
        self.ensure_name_free(&name, Some(id))?;
        let missing = self.missing_ancestors(&name)?;
        let subtree = self.deck_and_descendants(id)?;
        self.storage.rename_deck(id, &name, self.clock.now_ms())?;
        let made = self.ids_by_name(&missing)?;
        let undo_made = made.clone();
        let old_name = old.name;
        self.record_undo(UndoAction::RenameDeck { name }, move |s, now| {
            s.rename_deck(id, &old_name, now)?;
            remove_empty_decks(s, &undo_made, now)
        });
        for deck_id in made.into_iter().chain(subtree) {
            self.events.emit(DomainEvent::DeckChanged { deck_id });
        }
        Ok(())
    }

    /// Refuse `name` when another deck (not `except`) already has it.
    fn ensure_name_free(&self, name: &str, except: Option<i64>) -> CoreResult<()> {
        match self.storage.deck_by_name(name)? {
            Some(d) if Some(d.id) != except => Err(CoreError::Invalid(format!(
                "a deck named \"{name}\" already exists"
            ))),
            _ => Ok(()),
        }
    }

    /// Ancestors of `name` that do not exist yet (top level first). Refuses a
    /// filtered ancestor: filtered decks cannot hold subdecks (Anki rule).
    fn missing_ancestors(&self, name: &str) -> CoreResult<Vec<String>> {
        let mut missing = Vec::new();
        for ancestor in deck_ancestors(name) {
            match self.storage.deck_by_name(ancestor)? {
                Some(d) if d.is_filtered => {
                    return Err(CoreError::Invalid(format!(
                        "\"{ancestor}\" is a filtered deck and cannot have subdecks"
                    )))
                }
                Some(_) => {}
                None => missing.push(ancestor.to_string()),
            }
        }
        Ok(missing)
    }

    fn ids_by_name(&self, names: &[String]) -> CoreResult<Vec<i64>> {
        let mut ids = Vec::with_capacity(names.len());
        for n in names {
            if let Some(d) = self.storage.deck_by_name(n)? {
                ids.push(d.id);
            }
        }
        Ok(ids)
    }

    pub fn remove_deck(&self, id: i64) -> CoreResult<()> {
        let deck = self
            .storage
            .deck_by_id(id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {id}")))?;
        // Return gathered cards before deleting any filtered deck in the subtree.
        let now_ms = self.clock.now_ms();
        let today = self.today();
        let sub_ids = self.deck_and_descendants(id)?;
        let filtered_ids: Vec<i64> = self
            .storage
            .list_decks()?
            .into_iter()
            .filter(|d| d.is_filtered && sub_ids.contains(&d.id))
            .map(|d| d.id)
            .collect();
        for fid in &filtered_ids {
            self.storage.empty_filtered(*fid, now_ms)?;
        }
        // Cascades to sub-decks + their cards; the returned snapshot drives undo.
        let removed = self.storage.remove_deck(id, now_ms)?;
        let is_filtered = deck.is_filtered;
        self.record_undo(UndoAction::DeleteDeck { name: deck.name }, move |s, now| {
            s.restore_deck(&removed, now)?;
            if is_filtered {
                let _ = s.rebuild_filtered(id, today, now)?;
            }
            Ok(())
        });
        // A3-03 rule: removing a deck deletes its revlog rows, so quest progress can
        // drop. Already-earned XP stays in `progress_ledger`, while quest bonuses
        // that no longer hold are revoked (same rule as answer undo; unlike F1 full
        // deck reset, which wipes the deck's earned XP).
        let _ = self.reconcile_motivation(true)?;
        self.events.emit(DomainEvent::DeckChanged { deck_id: id });
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn set_deck_collapsed(&self, deck_id: i64, collapsed: bool) -> CoreResult<()> {
        self.storage.set_deck_collapsed(deck_id, collapsed)?;
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collection::fake_storage::{collection, deck, FakeStorage};
    use crate::ports::FixedClock;
    use std::sync::Arc;

    #[test]
    fn create_then_list() {
        let c = collection();
        c.create_deck("Spanish").unwrap();
        let decks = c.list_decks().unwrap();
        assert_eq!(decks.len(), 1);
        assert_eq!(decks[0].name, "Spanish");
    }

    #[test]
    fn rejects_blank_and_duplicate_names() {
        let c = collection();
        c.create_deck("Spanish").unwrap();
        assert!(c.create_deck("   ").is_err());
        assert!(c.create_deck("Spanish").is_err());
    }

    #[test]
    fn undo_reverses_create_rename_delete() {
        let c = collection();
        let deck = c.create_deck("Spanish").unwrap();
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::CreateDeck {
                name: "Spanish".into()
            })
        );

        c.rename_deck(deck.id, "Español").unwrap();
        assert_eq!(c.list_decks().unwrap()[0].name, "Español");
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::RenameDeck {
                name: "Español".into()
            })
        );

        // undo rename
        assert_eq!(
            c.undo().unwrap(),
            Some(UndoAction::RenameDeck {
                name: "Español".into()
            })
        );
        assert_eq!(c.list_decks().unwrap()[0].name, "Spanish");

        // undo create
        assert_eq!(
            c.undo().unwrap(),
            Some(UndoAction::CreateDeck {
                name: "Spanish".into()
            })
        );
        assert!(c.list_decks().unwrap().is_empty());

        // nothing left
        assert!(c.undo().unwrap().is_none());
    }

    #[test]
    fn undo_restores_deleted_deck() {
        let c = collection();
        let deck = c.create_deck("Spanish").unwrap();
        c.remove_deck(deck.id).unwrap();
        assert!(c.list_decks().unwrap().is_empty());
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::DeleteDeck {
                name: "Spanish".into()
            })
        );
        assert_eq!(
            c.undo().unwrap(),
            Some(UndoAction::DeleteDeck {
                name: "Spanish".into()
            })
        );
        assert_eq!(c.list_decks().unwrap()[0].name, "Spanish");
    }

    #[test]
    fn list_decks_with_counts_rolls_up_subdecks() {
        let storage = FakeStorage::default();
        storage.decks.lock().unwrap().extend([
            deck(1, "Spanish", None, false),
            deck(2, "Spanish::Verbs", Some(1), false),
            deck(3, "Cram", Some(1), true), // filtered: excluded from parent rollup
        ]);
        {
            let mut counts = storage.due_counts.lock().unwrap();
            counts.insert(1, (2, 0, 0));
            counts.insert(2, (5, 1, 3));
            counts.insert(3, (9, 9, 9));
        }

        let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();
        let by_id: std::collections::HashMap<i64, (u32, u32, u32)> = c
            .list_decks_with_counts()
            .unwrap()
            .into_iter()
            .map(|(d, counts)| (d.id, counts))
            .collect();

        assert_eq!(
            by_id[&1],
            (7, 1, 3),
            "parent rolls up its own + child's counts"
        );
        assert_eq!(by_id[&2], (5, 1, 3), "child counts are unaffected");
        assert_eq!(
            by_id[&3],
            (9, 9, 9),
            "filtered deck reports only its own counts"
        );
    }

    #[test]
    fn add_note_rejects_filtered_deck() {
        let storage = FakeStorage::default();
        storage
            .decks
            .lock()
            .unwrap()
            .push(deck(1, "Filtered", None, true));
        let c = Collection::new(Box::new(storage), Arc::new(FixedClock(1_000))).unwrap();

        let err = c
            .add_note(1, 1, &["front".into(), "back".into()], &[])
            .unwrap_err();
        match err {
            crate::error::CoreError::Invalid(msg) => {
                assert!(msg.contains("filtered deck"));
            }
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn set_deck_collapsed_persists_and_emits_event() {
        let c = collection();
        let deck = c.create_deck("Parent").unwrap();
        assert!(!deck.collapsed);

        c.set_deck_collapsed(deck.id, true).unwrap();
        let updated = c.list_decks().unwrap();
        assert!(updated[0].collapsed);

        c.set_deck_collapsed(deck.id, false).unwrap();
        let updated = c.list_decks().unwrap();
        assert!(!updated[0].collapsed);
    }
}
