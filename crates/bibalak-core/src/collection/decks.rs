use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{DeckConfig, DeckSummary, FilteredDeckConfig};
use crate::model::Deck;
use crate::undo::UndoAction;
use crate::Collection;

use super::study::StudySubtreePlan;

impl Collection {
    /// Decks with per-type card counts `(new, learning, review)`, capped by
    /// daily limits (including ancestor deck limits along each deck's
    /// non-filtered subtree, matching `count_due_by_type`). Filtered decks
    /// report only their own counts in isolation.
    #[allow(clippy::type_complexity)]
    pub fn list_decks_with_counts(&self) -> CoreResult<Vec<(Deck, (u32, u32, u32))>> {
        let decks = self.storage.list_decks()?;
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
        self.storage
            .set_deck_limits(deck.config_id, new_per_day, rev_per_day, self.now_ms())
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
        for sub_id in subtree {
            let current = self.storage.day_extra_new(sub_id, today)?;
            self.storage
                .set_day_extra_new(sub_id, today, current.saturating_add(extra_new))?;
        }
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
        if cfg.starting_ease_milli < 1300 || cfg.starting_ease_milli > 9999 {
            return Err(CoreError::Invalid("starting ease must be 1300–9999".into()));
        }
        if cfg.desired_retention < 0.5 || cfg.desired_retention > 0.99 {
            return Err(CoreError::Invalid(
                "desired retention must be 0.50–0.99".into(),
            ));
        }
        if cfg.interval_modifier < 0.01 || cfg.interval_modifier > 9.99 {
            return Err(CoreError::Invalid(
                "interval modifier must be 0.01–9.99".into(),
            ));
        }
        if cfg.graduating_interval_days < 1 {
            return Err(CoreError::Invalid("graduating interval must be ≥ 1".into()));
        }
        if cfg.maximum_interval_days < 1 {
            return Err(CoreError::Invalid("max interval must be ≥ 1".into()));
        }
        if cfg.fsrs_weights.len() != 21 {
            return Err(CoreError::Invalid(
                "FSRS weights must have exactly 21 elements".into(),
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
        self.storage
            .set_deck_config(deck.config_id, &sched, self.now_ms())?;
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
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("deck name is empty".into()));
        }
        let deck = self.storage.create_filtered_deck(
            name,
            search,
            order,
            limit,
            self.today(),
            self.clock.now_ms(),
        )?;
        let id = deck.id;
        self.events.emit(DomainEvent::DeckChanged { deck_id: id });
        Ok(DeckSummary::from(deck))
    }

    pub fn rebuild_filtered(&self, deck_id: i64) -> CoreResult<u32> {
        let n = self
            .storage
            .rebuild_filtered(deck_id, self.today(), self.clock.now_ms())?;
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(n)
    }

    pub fn empty_filtered(&self, deck_id: i64) -> CoreResult<()> {
        self.storage.empty_filtered(deck_id, self.clock.now_ms())?;
        self.events.emit(DomainEvent::DeckChanged { deck_id });
        Ok(())
    }

    pub fn get_filtered_config(&self, deck_id: i64) -> CoreResult<Option<FilteredDeckConfig>> {
        self.storage.get_filtered_config(deck_id)
    }

    pub fn list_decks(&self) -> CoreResult<Vec<Deck>> {
        self.storage.list_decks()
    }

    pub fn create_deck(&self, name: &str) -> CoreResult<Deck> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("deck name is empty".into()));
        }
        if self.storage.deck_by_name(name)?.is_some() {
            return Err(CoreError::Invalid(format!(
                "a deck named \"{name}\" already exists"
            )));
        }
        let deck = self.storage.create_deck(name, self.clock.now_ms())?;
        let id = deck.id;
        self.record_undo(
            UndoAction::CreateDeck {
                name: name.to_string(),
            },
            move |s, now| s.remove_deck(id, now).map(|_| ()),
        );
        self.events.emit(DomainEvent::DeckChanged { deck_id: id });
        Ok(deck)
    }

    pub fn rename_deck(&self, id: i64, name: &str) -> CoreResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("deck name is empty".into()));
        }
        let old = self
            .storage
            .deck_by_id(id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {id}")))?;
        self.storage.rename_deck(id, name, self.clock.now_ms())?;
        let old_name = old.name;
        self.record_undo(
            UndoAction::RenameDeck {
                name: name.to_string(),
            },
            move |s, now| s.rename_deck(id, &old_name, now),
        );
        self.events.emit(DomainEvent::DeckChanged { deck_id: id });
        Ok(())
    }

    pub fn remove_deck(&self, id: i64) -> CoreResult<()> {
        let deck = self
            .storage
            .deck_by_id(id)?
            .ok_or_else(|| CoreError::NotFound(format!("deck {id}")))?;
        // Return gathered cards before deleting a filtered deck.
        if deck.is_filtered {
            self.storage.empty_filtered(id, self.clock.now_ms())?;
        }
        // Cascades to sub-decks + their cards; the returned snapshot drives undo.
        let removed = self.storage.remove_deck(id, self.clock.now_ms())?;
        self.record_undo(UndoAction::DeleteDeck { name: deck.name }, move |s, now| {
            s.restore_deck(&removed, now)
        });
        self.events.emit(DomainEvent::DeckChanged { deck_id: id });
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
