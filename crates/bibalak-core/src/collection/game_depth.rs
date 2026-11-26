//! `Collection` methods for Game depth: deterministic unlocks, pets & mounts,
//! Level-10 cosmetic paths, achievements, and one-time backfill (ADR-026, R4-1).

use std::sync::atomic::Ordering;

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::game_depth::{BackfillOutcomeDto, GameDepthStateDto, GamePathId};
use crate::progress::NIL_USER_ID;

use super::Collection;

impl Collection {
    pub fn get_game_depth_state(&self) -> CoreResult<GameDepthStateDto> {
        let now_ms = self.clock.now_ms();
        let (state, backfill_granted_any) = self.storage.load_game_depth_state(
            NIL_USER_ID,
            now_ms,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )?;
        if backfill_granted_any {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(state)
    }

    pub fn choose_game_path(&self, path_id: GamePathId) -> CoreResult<GameDepthStateDto> {
        let now_ms = self.clock.now_ms();
        self.storage
            .choose_game_path(NIL_USER_ID, path_id, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        self.get_game_depth_state()
    }

    pub fn set_active_pet(
        &self,
        pet_id: Option<&str>,
        mounted: bool,
    ) -> CoreResult<GameDepthStateDto> {
        let clean_pet_id = match pet_id {
            Some(id) => {
                let trimmed = id.trim();
                if trimmed.is_empty() {
                    return Err(CoreError::Invalid("pet_id must not be empty".into()));
                }
                Some(trimmed)
            }
            None => None,
        };
        if clean_pet_id.is_none() && mounted {
            return Err(CoreError::Invalid(
                "cannot mount without an active pet".into(),
            ));
        }
        let now_ms = self.clock.now_ms();
        self.storage
            .set_active_pet(NIL_USER_ID, clean_pet_id, mounted, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        self.get_game_depth_state()
    }

    pub fn acknowledge_unlocks(&self, unlock_ids: &[String]) -> CoreResult<()> {
        if unlock_ids.len() > 500 {
            return Err(CoreError::Invalid(
                "cannot acknowledge more than 500 unlocks at once".into(),
            ));
        }
        for id in unlock_ids {
            if id.trim().is_empty() || id.len() > 128 {
                return Err(CoreError::Invalid("invalid unlock id".into()));
            }
        }
        if unlock_ids.is_empty() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        self.storage
            .acknowledge_unlocks(NIL_USER_ID, unlock_ids, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        Ok(())
    }

    pub fn run_unlock_backfill(&self) -> CoreResult<BackfillOutcomeDto> {
        let now_ms = self.clock.now_ms();
        let outcome = self.storage.run_unlock_backfill(
            NIL_USER_ID,
            now_ms,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )?;
        if !outcome.already_applied
            && (outcome.pets_granted > 0
                || outcome.cosmetics_granted > 0
                || outcome.achievements_granted > 0)
        {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(outcome)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::collection::fake_storage::FakeStorage;
    use crate::error::CoreError;
    use crate::game_depth::{GamePathId, MAX_PET_GROWTH};
    use crate::model::Revlog;
    use crate::ports::TestClock;
    use crate::progress::{ledger_id, ProgressLedgerEntry, NIL_USER_ID};
    use crate::scheduling::CardState;
    use crate::Collection;

    fn make_collection(now_ms: i64) -> (Collection, Arc<TestClock>) {
        let clock = Arc::new(TestClock::new(now_ms));
        let c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();
        (c, clock)
    }

    #[test]
    fn unlock_keys_grant_once_across_undo_and_reanswer() {
        let base = 1_795_341_600_000;
        let (c, clock) = make_collection(base);
        // Seed 49 reviews before card 50
        {
            let fs = c.storage();
            for i in 1..=49_i64 {
                fs.apply_answer(
                    i,
                    &CardState::new(2500),
                    0,
                    &Revlog {
                        id: base + i,
                        card_id: i,
                        usn: -1,
                        ease: 3,
                        interval: 1,
                        last_interval: 0,
                        ease_factor: 2500,
                        taken_ms: 500,
                        review_kind: 1,
                    },
                    None,
                )
                .unwrap();
            }
        }

        // 50th review via Collection::apply_answer
        c.apply_answer(
            50,
            50,
            &CardState::new(2500),
            0,
            &CardState::new(2500),
            1,
            &Revlog {
                id: base + 50,
                card_id: 50,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();

        let state1 = c.get_game_depth_state().unwrap();
        assert!(state1
            .pets
            .iter()
            .any(|p| p.species_key == "owl" && p.variant_key == "classic"));
        assert!(state1
            .pets
            .iter()
            .any(|p| p.species_key == "fox" && p.variant_key == "classic"));
        assert!(state1
            .achievements
            .iter()
            .any(|a| a.achievement_key == "ach:reviews_50" && a.unlocked));

        // Undo 50th review -> unlocks & achievements are NEVER revoked
        clock.advance_ms(1_000);
        c.undo().unwrap();
        let state2 = c.get_game_depth_state().unwrap();
        assert!(state2
            .pets
            .iter()
            .any(|p| p.species_key == "fox" && p.variant_key == "classic"));
        assert!(state2
            .achievements
            .iter()
            .any(|a| a.achievement_key == "ach:reviews_50" && a.unlocked));

        // Re-answer -> no duplicate pets/unlocks
        clock.advance_ms(1_000);
        c.apply_answer(
            50,
            50,
            &CardState::new(2500),
            0,
            &CardState::new(2500),
            1,
            &Revlog {
                id: base + 5000,
                card_id: 50,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();
        let state3 = c.get_game_depth_state().unwrap();
        assert_eq!(state3.pets.len(), state1.pets.len());
    }

    #[test]
    fn pet_credits_cannot_be_farmed_by_undo_and_mount_unlocks_at_50() {
        let base = 1_795_341_600_000;
        let (c, clock) = make_collection(base);

        // Answer card 1 -> unlocks owl (active) and credits +1
        c.apply_answer(
            1,
            1,
            &CardState::new(2500),
            0,
            &CardState::new(2500),
            1,
            &Revlog {
                id: base + 1,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();
        assert_eq!(c.get_game_depth_state().unwrap().pets[0].growth_points, 1);

        // Undo -> credit revoked (0); re-answer -> back to 1 (not 2!)
        clock.advance_ms(100);
        c.undo().unwrap();
        assert_eq!(c.get_game_depth_state().unwrap().pets[0].growth_points, 0);

        clock.advance_ms(100);
        c.apply_answer(
            1,
            1,
            &CardState::new(2500),
            0,
            &CardState::new(2500),
            1,
            &Revlog {
                id: base + 300,
                card_id: 1,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 500,
                review_kind: 1,
            },
            8,
        )
        .unwrap();
        assert_eq!(c.get_game_depth_state().unwrap().pets[0].growth_points, 1);

        let pet_id = c.get_game_depth_state().unwrap().active_pet_id.unwrap();
        // Cannot mount below 50
        assert!(c.set_active_pet(Some(&pet_id), true).is_err());

        // Reach 50 via 49 more unique cards
        for i in 2..=50_i64 {
            clock.advance_ms(10);
            c.apply_answer(
                i,
                i,
                &CardState::new(2500),
                0,
                &CardState::new(2500),
                1,
                &Revlog {
                    id: base + 10_000 + i,
                    card_id: i,
                    usn: -1,
                    ease: 3,
                    interval: 1,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                8,
            )
            .unwrap();
        }
        let s = c.get_game_depth_state().unwrap();
        let active = s.pets.iter().find(|p| p.id == pet_id).unwrap();
        assert_eq!(active.growth_points, MAX_PET_GROWTH);
        assert!(active.mount_unlocked);

        // Mount succeeds at 50; undo of card 50 drops credits to 49 but mount_unlocked stays true
        let mounted = c.set_active_pet(Some(&pet_id), true).unwrap();
        assert!(mounted.mounted);
        c.undo().unwrap();
        let after_undo = c.get_game_depth_state().unwrap();
        let active_after = after_undo.pets.iter().find(|p| p.id == pet_id).unwrap();
        assert_eq!(active_after.growth_points, 49);
        assert!(active_after.mount_unlocked);
    }

    #[test]
    fn choose_game_path_requires_level_10_and_charges_switch_fee() {
        let base = 1_795_341_600_000;
        let (c, _) = make_collection(base);
        // Below level 10 -> rejected
        let err = c.choose_game_path(GamePathId::Sage).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));

        // Reach level 10 (2,700 XP) and give 15,000 gold_cents
        c.storage()
            .apply_answer(
                1,
                &CardState::new(2500),
                0,
                &Revlog {
                    id: base,
                    card_id: 1,
                    usn: -1,
                    ease: 3,
                    interval: 1,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 500,
                    review_kind: 1,
                },
                Some(&crate::progress::RewardGrant {
                    id: ledger_id(NIL_USER_ID, "card_review:1:0"),
                    user_id: NIL_USER_ID.to_string(),
                    source_key: "card_review:1:0".to_string(),
                    xp: 2_700,
                    gold_cents: 15_000,
                    now_ms: base,
                }),
            )
            .unwrap();

        // First pick free + grants frame_path_sage
        let s1 = c.choose_game_path(GamePathId::Sage).unwrap();
        assert_eq!(s1.chosen_path, Some(GamePathId::Sage));
        assert_eq!(c.get_game_state().unwrap().available_gold_cents, 15_000);
        assert!(c
            .get_game_state()
            .unwrap()
            .owned_item_keys
            .contains(&"frame_path_sage".to_string()));

        // Re-picking same path is a free no-op
        let _ = c.choose_game_path(GamePathId::Sage).unwrap();
        assert_eq!(c.get_game_state().unwrap().available_gold_cents, 15_000);

        // Switching to Vanguard costs 10_000 gold_cents
        let s2 = c.choose_game_path(GamePathId::Vanguard).unwrap();
        assert_eq!(s2.chosen_path, Some(GamePathId::Vanguard));
        assert_eq!(c.get_game_state().unwrap().available_gold_cents, 5_000);

        // Switching again without enough gold (5_000 < 10_000) fails
        let err2 = c.choose_game_path(GamePathId::Artisan).unwrap_err();
        assert!(matches!(err2, CoreError::Invalid(_)));
        let _ = ProgressLedgerEntry {
            id: String::new(),
            user_id: String::new(),
            source_key: String::new(),
            xp: 0,
            gold_cents: 0,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            usn: -1,
        };
    }
}
