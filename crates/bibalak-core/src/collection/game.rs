//! `Collection` methods for Game style inventory, avatar, shop, custom rewards,
//! and spend history (ADR-025, R2a).

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::game::{
    build_game_state_dto, validate_avatar_profile_input, validate_client_tx_id,
    validate_custom_reward_input, validate_spend_history_limit, AvatarProfileDto,
    AvatarProfileInput, CustomRewardDto, CustomRewardInput, EquipmentSlot, GameStateDto,
    PurchaseResultDto, SpendHistoryEntryDto,
};
use crate::progress::NIL_USER_ID;
use std::sync::atomic::Ordering;

use super::Collection;

impl Collection {
    pub fn get_game_state(&self) -> CoreResult<GameStateDto> {
        let snap = self.storage.load_game_snapshot(
            NIL_USER_ID,
            self.today(),
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )?;
        Ok(build_game_state_dto(snap))
    }

    pub fn update_avatar_profile(&self, input: AvatarProfileInput) -> CoreResult<AvatarProfileDto> {
        validate_avatar_profile_input(&input)?;
        let now_ms = self.clock.now_ms();
        let profile = self
            .storage
            .update_avatar_profile(NIL_USER_ID, &input, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        Ok(profile)
    }

    pub fn equip_game_item(&self, slot: EquipmentSlot, item_key: &str) -> CoreResult<GameStateDto> {
        let trimmed = item_key.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("item_key must not be empty".into()));
        }
        let now_ms = self.clock.now_ms();
        self.storage
            .equip_game_item(NIL_USER_ID, slot, trimmed, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        self.get_game_state()
    }

    pub fn unequip_game_slot(&self, slot: EquipmentSlot) -> CoreResult<GameStateDto> {
        let now_ms = self.clock.now_ms();
        self.storage.unequip_game_slot(NIL_USER_ID, slot, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        self.get_game_state()
    }

    pub fn buy_shop_item(
        &self,
        item_key: &str,
        client_tx_id: &str,
    ) -> CoreResult<PurchaseResultDto> {
        let trimmed_key = item_key.trim();
        if trimmed_key.is_empty() {
            return Err(CoreError::Invalid("item_key must not be empty".into()));
        }
        let tx_id = validate_client_tx_id(client_tx_id)?;
        let now_ms = self.clock.now_ms();
        let spend_id = self
            .storage
            .buy_shop_item(NIL_USER_ID, trimmed_key, tx_id, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        let state = self.get_game_state()?;
        Ok(PurchaseResultDto { spend_id, state })
    }

    pub fn refund_shop_purchase(&self, spend_id: &str) -> CoreResult<GameStateDto> {
        let trimmed = spend_id.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("spend_id must not be empty".into()));
        }
        let now_ms = self.clock.now_ms();
        self.storage
            .refund_shop_purchase(NIL_USER_ID, trimmed, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        self.get_game_state()
    }

    pub fn list_custom_rewards(&self) -> CoreResult<Vec<CustomRewardDto>> {
        self.storage.list_custom_rewards(NIL_USER_ID)
    }

    pub fn create_custom_reward(&self, input: CustomRewardInput) -> CoreResult<CustomRewardDto> {
        let clean = validate_custom_reward_input(input)?;
        let now_ms = self.clock.now_ms();
        let dto = self
            .storage
            .create_custom_reward(NIL_USER_ID, &clean, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        Ok(dto)
    }

    pub fn update_custom_reward(
        &self,
        id: &str,
        input: CustomRewardInput,
    ) -> CoreResult<CustomRewardDto> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("reward id must not be empty".into()));
        }
        let clean = validate_custom_reward_input(input)?;
        let now_ms = self.clock.now_ms();
        let dto = self
            .storage
            .update_custom_reward(NIL_USER_ID, trimmed, &clean, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        Ok(dto)
    }

    pub fn delete_custom_reward(&self, id: &str) -> CoreResult<()> {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("reward id must not be empty".into()));
        }
        let now_ms = self.clock.now_ms();
        self.storage
            .delete_custom_reward(NIL_USER_ID, trimmed, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        Ok(())
    }

    pub fn claim_custom_reward(
        &self,
        id: &str,
        client_tx_id: &str,
    ) -> CoreResult<PurchaseResultDto> {
        let trimmed_id = id.trim();
        if trimmed_id.is_empty() {
            return Err(CoreError::Invalid("reward id must not be empty".into()));
        }
        let tx_id = validate_client_tx_id(client_tx_id)?;
        let now_ms = self.clock.now_ms();
        let spend_id = self
            .storage
            .claim_custom_reward(NIL_USER_ID, trimmed_id, tx_id, now_ms)?;
        self.events.emit(DomainEvent::GameChanged);
        let state = self.get_game_state()?;
        Ok(PurchaseResultDto { spend_id, state })
    }

    pub fn list_spend_history(&self, limit: Option<u32>) -> CoreResult<Vec<SpendHistoryEntryDto>> {
        let lim = validate_spend_history_limit(limit)?;
        let now_ms = self.clock.now_ms();
        self.storage.list_spend_history(NIL_USER_ID, lim, now_ms)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use crate::collection::fake_storage::FakeStorage;
    use crate::error::CoreError;
    use crate::events::DomainEvent;
    use crate::game::{
        AvatarProfileInput, CustomRewardInput, EquipmentSlot, FREEZE_TOKEN_CAP, REFUND_WINDOW_MS,
        STREAK_FREEZE_ITEM_KEY,
    };
    use crate::model::Revlog;
    use crate::ports::{FixedClock, TestClock};
    use crate::productivity::{
        HabitFrequencyKind, HabitGoalMode, HabitInput, HabitLogInput, HabitLogStatus, HabitSection,
        TaskInput, TaskPriority,
    };
    use crate::progress::{ledger_id, ProgressLedgerEntry, NIL_USER_ID};
    use crate::scheduling::{CardPhase, CardState};
    use crate::Collection;

    fn make_collection_with_clock(
        now_ms: i64,
    ) -> (Collection, Arc<TestClock>, Arc<Mutex<Vec<DomainEvent>>>) {
        let clock = Arc::new(TestClock::new(now_ms));
        let c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        c.events()
            .subscribe(move |e| ev.lock().unwrap().push(e.clone()));
        (c, clock, events)
    }

    fn seed_gold(c: &Collection, key: &str, xp: i64, gold_cents: i64, created_at: i64) {
        c.storage()
            .apply_answer(
                1,
                &CardState::new(2500),
                0,
                &Revlog {
                    id: created_at,
                    card_id: 1,
                    usn: -1,
                    ease: 3,
                    interval: 1,
                    last_interval: 0,
                    ease_factor: 2500,
                    taken_ms: 1000,
                    review_kind: 0,
                },
                Some(&crate::progress::RewardGrant {
                    id: ledger_id(NIL_USER_ID, key),
                    user_id: NIL_USER_ID.to_string(),
                    source_key: key.to_string(),
                    xp,
                    gold_cents,
                    now_ms: created_at,
                }),
            )
            .unwrap();
    }

    #[test]
    fn available_gold_equals_earned_minus_spent_with_saturating_floor() {
        let base = 1_795_341_600_000;
        let (c, clock, _) = make_collection_with_clock(base);
        // Earn 3_000 gold_cents on card 1
        seed_gold(&c, "card_review:1:0", 10, 3_000, base);
        assert_eq!(c.progress_summary().unwrap().gold_cents, 3_000);

        // Spend 2_500 on head_hood_scholar
        c.buy_shop_item("head_hood_scholar", "tx-1").unwrap();
        let summary = c.progress_summary().unwrap();
        assert_eq!(summary.gold_cents, 500);
        assert_eq!(summary.today_gold_cents, 3_000);

        // Undo/revoke earned gold below spent -> saturates at 0, never negative
        let mut state = CardState::new(2500);
        state.phase = CardPhase::New;
        c.storage()
            .undo_answer(
                1,
                &state,
                0,
                base,
                &[],
                None,
                Some("card_review:1:0"),
                base + 100,
            )
            .unwrap();
        let after_revoke = c.progress_summary().unwrap();
        assert_eq!(after_revoke.gold_cents, 0);
        let gs = c.get_game_state().unwrap();
        assert_eq!(gs.earned_gold_cents, 0);
        assert_eq!(gs.spent_gold_cents, 2_500);
        assert_eq!(gs.available_gold_cents, 0);
        clock.advance_ms(1_000);
    }

    #[test]
    fn buy_cosmetic_is_idempotent_and_rejects_insufficient_gold() {
        let base = 1_795_341_600_000;
        let (c, _, _) = make_collection_with_clock(base);
        seed_gold(&c, "card_review:1:0", 10, 2_400, base);

        let err = c.buy_shop_item("head_hood_scholar", "tx-1").unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));

        seed_gold(&c, "card_review:2:0", 10, 500, base);
        let first = c.buy_shop_item("head_hood_scholar", "tx-1").unwrap();
        assert_eq!(first.state.available_gold_cents, 400);
        assert!(first
            .state
            .owned_item_keys
            .contains(&"head_hood_scholar".to_string()));

        // Retrying with same or different client_tx_id returns idempotently without double spend
        let second = c.buy_shop_item("head_hood_scholar", "tx-2").unwrap();
        assert_eq!(second.spend_id, first.spend_id);
        assert_eq!(second.state.available_gold_cents, 400);
    }

    #[test]
    fn buy_freeze_token_enforces_cap_of_3() {
        let base = 1_795_341_600_000;
        let (c, _, _) = make_collection_with_clock(base);
        seed_gold(&c, "card_review:1:0", 10, 10_000, base);

        let r1 = c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-1").unwrap();
        assert_eq!(r1.state.freeze_tokens_held, 1);
        // Same client_tx_id is idempotent
        let r1_dup = c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-1").unwrap();
        assert_eq!(r1_dup.state.freeze_tokens_held, 1);
        assert_eq!(r1_dup.spend_id, r1.spend_id);

        let _ = c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-2").unwrap();
        let r3 = c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-3").unwrap();
        assert_eq!(r3.state.freeze_tokens_held, FREEZE_TOKEN_CAP);

        let err = c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-4").unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));
        assert_eq!(c.get_game_state().unwrap().available_gold_cents, 2_500);
    }

    #[test]
    fn refund_within_5m_restores_gold_and_unequips_and_rejects_after_window() {
        let base = 1_795_341_600_000;
        let (c, clock, _) = make_collection_with_clock(base);
        seed_gold(&c, "card_review:1:0", 10, 10_000, base);

        let purchase = c.buy_shop_item("head_hood_scholar", "tx-1").unwrap();
        c.equip_game_item(EquipmentSlot::Head, "head_hood_scholar")
            .unwrap();
        assert_eq!(
            c.get_game_state()
                .unwrap()
                .equipped
                .iter()
                .find(|s| s.slot == EquipmentSlot::Head)
                .and_then(|s| s.item_key.clone()),
            Some("head_hood_scholar".to_string())
        );

        // Within 5m -> refunds gold, removes ownership, unequips slot
        clock.advance_ms(REFUND_WINDOW_MS - 1);
        let refunded = c.refund_shop_purchase(&purchase.spend_id).unwrap();
        assert_eq!(refunded.available_gold_cents, 10_000);
        assert!(!refunded
            .owned_item_keys
            .contains(&"head_hood_scholar".to_string()));
        assert_eq!(
            refunded
                .equipped
                .iter()
                .find(|s| s.slot == EquipmentSlot::Head)
                .and_then(|s| s.item_key.clone()),
            None
        );

        // Re-buy after refund works cleanly (reuses spend row)
        let rebuy = c.buy_shop_item("head_hood_scholar", "tx-2").unwrap();
        assert_eq!(rebuy.state.available_gold_cents, 7_500);

        // Past 5m window -> rejected
        clock.advance_ms(REFUND_WINDOW_MS + 1);
        let err = c.refund_shop_purchase(&rebuy.spend_id).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));
    }

    #[test]
    fn log_habit_frozen_consumes_one_token_and_undo_or_relog_refunds_it() {
        let base = 1_795_341_600_000;
        let (c, clock, _) = make_collection_with_clock(base);
        seed_gold(&c, "card_review:1:0", 10, 5_000, base);
        c.buy_shop_item(STREAK_FREEZE_ITEM_KEY, "tx-1").unwrap();
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

        let habit = c
            .create_habit(HabitInput {
                title: "Read".into(),
                notes: String::new(),
                icon_key: "check".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::AchieveAll,
                goal_target: 1.0,
                goal_unit: String::new(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();

        // Freeze today -> consumes 1 token
        let frozen = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: None,
                logged_value: 0.0,
                status: HabitLogStatus::Frozen,
                mood: None,
                note: String::new(),
            })
            .unwrap();
        assert_eq!(frozen.status, HabitLogStatus::Frozen);
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

        // Idempotent freeze call when already frozen -> does not fail or spend extra
        let frozen_again = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: None,
                logged_value: 0.0,
                status: HabitLogStatus::Frozen,
                mood: None,
                note: String::new(),
            })
            .unwrap();
        assert_eq!(frozen_again.status, HabitLogStatus::Frozen);
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

        // Undo freeze -> refunds token
        c.undo().unwrap();
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

        // Freeze yesterday (today - 1) on day 1 -> consumes token; completing later refunds it
        let day0 = c.today();
        clock.advance_days(1);
        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(day0),
            logged_value: 0.0,
            status: HabitLogStatus::Frozen,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(day0),
            logged_value: 1.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

        // Older than yesterday rejected
        clock.advance_days(2);
        let old_err = c
            .log_habit(HabitLogInput {
                habit_id: habit.id,
                day_index: Some(day0),
                logged_value: 0.0,
                status: HabitLogStatus::Frozen,
                mood: None,
                note: String::new(),
            })
            .unwrap_err();
        assert!(matches!(old_err, CoreError::Invalid(_)));
    }

    #[test]
    fn streak_milestone_7d_grants_freeze_once_up_to_cap() {
        let base = 1_795_341_600_000;
        let (c, clock, _) = make_collection_with_clock(base);
        // Days 0..=5 (6 consecutive days) via tasks
        for day in 0..6 {
            let task = c
                .create_task(TaskInput {
                    list_id: None,
                    title: format!("Task {day}"),
                    notes: String::new(),
                    priority: TaskPriority::None,
                    manual_quadrant: None,
                    due_date: None,
                    scheduled_start_ms: None,
                    scheduled_end_ms: None,
                    tags: vec![],
                    deck_id: None,
                    sort_order: 0,
                })
                .unwrap();
            c.complete_task(&task.id).unwrap();
            clock.advance_days(1);
        }
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 0);

        // Day 6 completes 7-day streak -> grants +1 freeze token
        let t7 = c
            .create_task(TaskInput {
                list_id: None,
                title: "Task 7".into(),
                notes: String::new(),
                priority: TaskPriority::None,
                manual_quadrant: None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();
        c.complete_task(&t7.id).unwrap();
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);

        // Completing another task on day 6 does NOT grant a second token
        let t7b = c
            .create_task(TaskInput {
                list_id: None,
                title: "Task 7b".into(),
                notes: String::new(),
                priority: TaskPriority::None,
                manual_quadrant: None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();
        c.complete_task(&t7b.id).unwrap();
        assert_eq!(c.get_game_state().unwrap().freeze_tokens_held, 1);
    }

    #[test]
    fn custom_reward_crud_and_repeat_claim_spends_gold() {
        let base = 1_795_341_600_000;
        let (c, _, _) = make_collection_with_clock(base);
        seed_gold(&c, "card_review:1:0", 10, 5_000, base);

        let created = c
            .create_custom_reward(CustomRewardInput {
                title: "Coffee break".into(),
                notes: "Pour over".into(),
                cost_cents: 1_500,
                icon_key: "coffee".into(),
                sort_order: Some(0),
            })
            .unwrap();
        assert_eq!(created.claim_count, 0);

        let r1 = c.claim_custom_reward(&created.id, "c-1").unwrap();
        assert_eq!(r1.state.available_gold_cents, 3_500);
        let r2 = c.claim_custom_reward(&created.id, "c-2").unwrap();
        assert_eq!(r2.state.available_gold_cents, 2_000);
        let r3 = c.claim_custom_reward(&created.id, "c-3").unwrap();
        assert_eq!(r3.state.available_gold_cents, 500);

        let listed = c.list_custom_rewards().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].claim_count, 3);

        // Insufficient gold for 4th claim (500 < 1,500)
        assert!(c.claim_custom_reward(&created.id, "c-4").is_err());

        // Update + profile update + delete
        let updated = c
            .update_custom_reward(
                &created.id,
                CustomRewardInput {
                    title: "Tea break".into(),
                    notes: String::new(),
                    cost_cents: 500,
                    icon_key: "sun".into(),
                    sort_order: Some(1),
                },
            )
            .unwrap();
        assert_eq!(updated.title, "Tea break");
        assert_eq!(updated.claim_count, 3);

        let profile = c
            .update_avatar_profile(AvatarProfileInput {
                body_tone: "tone_3".into(),
                hair_style: "hair_2".into(),
                hair_color: "indigo".into(),
                starter_outfit: "tunic_forest".into(),
                starter_accessory: "acc_glasses".into(),
            })
            .unwrap();
        assert_eq!(profile.body_tone, "tone_3");

        c.delete_custom_reward(&created.id).unwrap();
        assert!(c.list_custom_rewards().unwrap().is_empty());

        let history = c.list_spend_history(Some(10)).unwrap();
        assert_eq!(history.len(), 3);
        assert!(history[0].refundable);
    }

    #[test]
    fn unused_imports_check() {
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
        let _ = FixedClock(0);
    }
}
