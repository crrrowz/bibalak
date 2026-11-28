use crate::error::CoreResult;
use crate::model::Revlog;
use crate::scheduling::CardState;

/// Game economy, avatar/shop, game depth (R4), and motivation (ADR-027) persistence.
pub trait GameStore: Send + Sync {
    fn spent_gold_cents(&self, user_id: &str) -> CoreResult<u64>;

    fn freeze_tokens_held(&self, user_id: &str) -> CoreResult<u32>;

    fn load_game_snapshot(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<crate::game::GameSnapshot>;

    fn update_avatar_profile(
        &self,
        user_id: &str,
        input: &crate::game::AvatarProfileInput,
        now_ms: i64,
    ) -> CoreResult<crate::game::AvatarProfileDto>;

    fn equip_game_item(
        &self,
        user_id: &str,
        slot: crate::game::EquipmentSlot,
        item_key: &str,
        now_ms: i64,
    ) -> CoreResult<()>;

    fn unequip_game_slot(
        &self,
        user_id: &str,
        slot: crate::game::EquipmentSlot,
        now_ms: i64,
    ) -> CoreResult<()>;

    fn buy_shop_item(
        &self,
        user_id: &str,
        item_key: &str,
        client_tx_id: &str,
        now_ms: i64,
    ) -> CoreResult<String>;

    fn refund_shop_purchase(&self, user_id: &str, spend_id: &str, now_ms: i64) -> CoreResult<()>;

    fn list_custom_rewards(&self, user_id: &str) -> CoreResult<Vec<crate::game::CustomRewardDto>>;

    fn create_custom_reward(
        &self,
        user_id: &str,
        input: &crate::game::CustomRewardInput,
        now_ms: i64,
    ) -> CoreResult<crate::game::CustomRewardDto>;

    fn update_custom_reward(
        &self,
        user_id: &str,
        id: &str,
        input: &crate::game::CustomRewardInput,
        now_ms: i64,
    ) -> CoreResult<crate::game::CustomRewardDto>;

    fn delete_custom_reward(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()>;

    fn claim_custom_reward(
        &self,
        user_id: &str,
        reward_id: &str,
        client_tx_id: &str,
        now_ms: i64,
    ) -> CoreResult<String>;

    fn list_spend_history(
        &self,
        user_id: &str,
        limit: u32,
        now_ms: i64,
    ) -> CoreResult<Vec<crate::game::SpendHistoryEntryDto>>;

    fn grant_unlocked_cosmetic(
        &self,
        user_id: &str,
        item_key: &str,
        now_ms: i64,
    ) -> CoreResult<bool>;

    fn spend_gold(
        &self,
        user_id: &str,
        kind: crate::game::SpendKind,
        ref_key: &str,
        idempotency_key: &str,
        amount_cents: u64,
        now_ms: i64,
    ) -> CoreResult<String>;

    fn upsert_habit_log_with_game(
        &self,
        log: &crate::productivity::HabitLog,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::HabitLogGameOutcome>;

    fn apply_answer_with_game(
        &self,
        card_id: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        reward: Option<&crate::progress::RewardGrant>,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::ApplyAnswerOutcome>;

    #[allow(clippy::too_many_arguments)]
    fn apply_answer_atomic(
        &self,
        card_id: i64,
        note_id: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        reward: Option<&crate::progress::RewardGrant>,
        is_leech: bool,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::ApplyAnswerFullOutcome>;

    #[allow(clippy::too_many_arguments)]
    fn set_task_completion_with_game(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::GameWriteOutcome>;

    fn load_game_depth_state(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(crate::game_depth::GameDepthStateDto, bool)>;

    fn choose_game_path(
        &self,
        user_id: &str,
        path_id: crate::game_depth::GamePathId,
        now_ms: i64,
    ) -> CoreResult<()>;

    fn set_active_pet(
        &self,
        user_id: &str,
        pet_id: Option<&str>,
        mounted: bool,
        now_ms: i64,
    ) -> CoreResult<()>;

    fn acknowledge_unlocks(
        &self,
        user_id: &str,
        unlock_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()>;

    fn run_unlock_backfill(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<crate::game_depth::BackfillOutcomeDto>;

    #[allow(clippy::too_many_arguments)]
    fn get_motivation_state(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
        allow_auto_freeze: bool,
    ) -> CoreResult<crate::motivation::MotivationStateDto>;

    #[allow(clippy::too_many_arguments)]
    fn reconcile_motivation(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
        allow_comeback_revoke: bool,
    ) -> CoreResult<bool>;

    fn set_daily_goal(&self, user_id: &str, goal_xp: u32, now_ms: i64) -> CoreResult<()>;

    #[allow(clippy::too_many_arguments)]
    fn get_streak_calendar(
        &self,
        user_id: &str,
        year: i32,
        month: u8,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<crate::motivation::StreakCalendarDto>;

    #[allow(clippy::too_many_arguments)]
    fn freeze_study_day(
        &self,
        user_id: &str,
        day_index: i32,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
    ) -> CoreResult<bool>;

    fn dismiss_comeback_offer(&self, user_id: &str, now_ms: i64) -> CoreResult<()>;

    fn complete_onboarding(&self, user_id: &str, now_ms: i64) -> CoreResult<()>;

    fn mark_monthly_badge_seen(
        &self,
        user_id: &str,
        month_key: &str,
        now_ms: i64,
    ) -> CoreResult<()>;
}
