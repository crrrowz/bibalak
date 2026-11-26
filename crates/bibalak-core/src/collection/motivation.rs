//! `Collection` use-cases for Cycle 3 daily motivation (ADR-027, 16d).

use std::sync::atomic::Ordering;

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::BatchNoteInput;
use crate::motivation::{
    validate_daily_goal_xp, validate_month_key, MotivationStateDto, StreakCalendarDto,
};
use crate::productivity::epoch_days_to_year_month;
use crate::progress::NIL_USER_ID;

use super::Collection;

const STARTER_CARDS_EN: &[(&str, &str)] = &[
    (
        "What makes spaced repetition more effective than cramming?",
        "Reviewing material at expanding intervals just before you forget strengthens long-term recall with less total study time.",
    ),
    (
        "Why should a single flashcard test one atomic idea?",
        "Atomic cards eliminate partial-recall ambiguity, making grading honest and intervals accurate.",
    ),
    (
        "How does active recall work during study?",
        "Trying to retrieve an answer from memory before flipping the card builds stronger neural retrieval paths than passive re-reading.",
    ),
    (
        "When should you rate a card 'Again' vs 'Hard'?",
        "Choose 'Again' if you could not recall the core answer; choose 'Hard' if you recalled it accurately with notable effort.",
    ),
    (
        "What is a leech card, and how should you handle it?",
        "A card you repeatedly forget. Edit, split, or add a mnemonic instead of grinding through it unchanged.",
    ),
    (
        "Why set a realistic daily XP goal?",
        "Consistent short daily sessions beat occasional marathons for both memory retention and habit momentum.",
    ),
    (
        "How does the testing effect help exam performance?",
        "Practicing retrieval under recall conditions transfers directly to recalling knowledge under pressure.",
    ),
    (
        "What does FSRS optimize compared to fixed intervals?",
        "FSRS models each card's memory stability and difficulty to schedule the next review at your target retention.",
    ),
];

const STARTER_CARDS_AR: &[(&str, &str)] = &[
    (
        "لماذا يكون التكرار المتباعد أكثر فاعلية من الحفظ المكثف؟",
        "مراجعة المعلومة على فترات متزايدة قبيل نسيانها تقوّي التذكّر طويل المدى بوقت دراسة أقل.",
    ),
    (
        "لماذا يُفضّل أن تختبر البطاقة فكرة واحدة محددة؟",
        "البطاقة المركّزة تمنع التباس التقييم الجزئي وتجعل حساب الفترات أدق.",
    ),
    (
        "كيف يعمل الاسترجاع النشط أثناء الدراسة؟",
        "محاولة استدعاء الإجابة من الذاكرة قبل قلب البطاقة تبني مسارات استرجاع أقوى من القراءة السلبية.",
    ),
    (
        "متى تختار «مجددًا» ومتى تختار «صعب»؟",
        "اختر «مجددًا» إذا لم تستطع استرجاع الإجابة الأساسية، واختر «صعب» إذا استرجعتها بدقة ولكن بمجهود واضح.",
    ),
    (
        "ما البطاقة المستعصية وكيف تتعامل معها؟",
        "بطاقة يتكرر نسيانها؛ الأفضل تعديلها أو تقسيمها أو إضافة رابط ذهني لها بدل تكرارها كما هي.",
    ),
    (
        "ما فائدة تحديد هدف يومي واقعي من نقاط الخبرة؟",
        "الانتظام اليومي القصير يتفوق على الجلسات الطويلة المتقطعة في ترسيخ الذاكرة وبناء العادة.",
    ),
    (
        "كيف يساعد أثر الاختبار على الأداء في الامتحانات؟",
        "التدرّب على الاسترجاع من الذاكرة ينعكس مباشرة على سرعة ودقة التذكّر وقت الحاجة.",
    ),
    (
        "ما الذي تحسّنه خوارزمية FSRS مقارنة بالفترات الثابتة؟",
        "تقدّر استقرار الذاكرة وصعوبة كل بطاقة لتحديد موعد المراجعة الأنسب لنسبة التذكّر المستهدفة.",
    ),
];

impl Collection {
    pub fn get_motivation_state(&self) -> CoreResult<MotivationStateDto> {
        self.get_motivation_state_for_style(None)
    }

    pub fn get_motivation_state_for_style(
        &self,
        style: Option<&str>,
    ) -> CoreResult<MotivationStateDto> {
        let allow_auto_freeze = style
            .map(str::trim)
            .is_some_and(|s| s.eq_ignore_ascii_case("game"));
        let dto = self.storage.get_motivation_state(
            NIL_USER_ID,
            self.today(),
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
            self.clock.now_ms(),
            allow_auto_freeze,
        )?;
        if dto.auto_frozen_day.is_some() {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(dto)
    }

    pub fn set_daily_goal(&self, goal_xp: u32) -> CoreResult<MotivationStateDto> {
        let valid_goal = validate_daily_goal_xp(goal_xp)?;
        let now_ms = self.clock.now_ms();
        self.storage
            .set_daily_goal(NIL_USER_ID, valid_goal, now_ms)?;
        let _ = self.reconcile_motivation(false)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        self.get_motivation_state()
    }

    pub fn get_streak_calendar(&self, year: i32, month: u8) -> CoreResult<StreakCalendarDto> {
        self.storage.get_streak_calendar(
            NIL_USER_ID,
            year,
            month,
            self.today(),
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )
    }

    pub fn freeze_study_day(&self, day_index: i32) -> CoreResult<StreakCalendarDto> {
        let today = self.today();
        let now_ms = self.clock.now_ms();
        let consumed = self.storage.freeze_study_day(
            NIL_USER_ID,
            day_index,
            today,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
            now_ms,
        )?;
        if consumed {
            self.events.emit(DomainEvent::GameChanged);
        }
        let (year, month) =
            epoch_days_to_year_month(self.created_epoch_day_local() + i64::from(day_index));
        self.get_streak_calendar(year as i32, month as u8)
    }

    pub fn dismiss_comeback_offer(&self) -> CoreResult<()> {
        self.storage
            .dismiss_comeback_offer(NIL_USER_ID, self.clock.now_ms())?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn complete_onboarding(
        &self,
        skipped: bool,
        create_starter: bool,
        locale: &str,
    ) -> CoreResult<()> {
        let norm_locale = match locale.trim().to_ascii_lowercase().as_str() {
            "ar" => "ar",
            "en" | "" => "en",
            other if other.len() <= 16 => "en",
            other => {
                return Err(CoreError::Invalid(format!(
                    "invalid onboarding locale '{other}'"
                )));
            }
        };
        if !skipped && create_starter {
            self.create_starter_deck(norm_locale)?;
        }
        self.storage
            .complete_onboarding(NIL_USER_ID, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn mark_monthly_badge_seen(&self, month_key: &str) -> CoreResult<()> {
        let valid_key = validate_month_key(month_key)?;
        self.storage
            .mark_monthly_badge_seen(NIL_USER_ID, &valid_key, self.clock.now_ms())?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub(crate) fn reconcile_motivation(&self, allow_comeback_revoke: bool) -> CoreResult<bool> {
        self.storage.reconcile_motivation(
            NIL_USER_ID,
            self.today(),
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
            self.clock.now_ms(),
            allow_comeback_revoke,
        )
    }

    fn create_starter_deck(&self, locale: &str) -> CoreResult<()> {
        let deck_name = if locale == "ar" {
            "مجموعة البداية"
        } else {
            "Bibalak Starter"
        };
        let deck_id = match self.storage.deck_by_name(deck_name)? {
            Some(existing) => existing.id,
            None => self.create_deck(deck_name)?.id,
        };
        let notetypes = self.list_notetypes()?;
        let Some(basic_nt) = notetypes
            .into_iter()
            .find(|nt| nt.kind == 0 && nt.field_names.len() >= 2)
        else {
            return Ok(());
        };
        let cards = if locale == "ar" {
            STARTER_CARDS_AR
        } else {
            STARTER_CARDS_EN
        };
        let batch: Vec<BatchNoteInput> = cards
            .iter()
            .map(|(front, back)| {
                let mut fields = Vec::with_capacity(basic_nt.field_names.len());
                fields.push((*front).to_string());
                fields.push((*back).to_string());
                while fields.len() < basic_nt.field_names.len() {
                    fields.push(String::new());
                }
                BatchNoteInput {
                    fields,
                    tags: vec!["starter".to_string()],
                }
            })
            .collect();
        let _ = self.add_notes_batch(basic_nt.id, deck_id, &batch)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::collection::fake_storage::FakeStorage;
    use crate::game::{SpendKind, FREEZE_TOKEN_CAP};
    use crate::model::Revlog;
    use crate::motivation::{
        daily_quest_source_key, daily_quests_for_day, monthly_badge_source_key,
        COMEBACK_BONUS_GOLD_CENTS, DAILY_QUEST_GOLD_CENTS, MONTHLY_BADGE_GOLD_CENTS,
        MONTHLY_BADGE_TARGET_QUESTS,
    };
    use crate::ports::TestClock;
    use crate::productivity::{HabitGoalMode, HabitInput, HabitLogInput, TaskInput, TaskPriority};
    use crate::progress::{ledger_id, NIL_USER_ID, TASK_REWARD_XP};
    use crate::scheduling::{CardPhase, CardState};
    use crate::Collection;

    const DAY_MS: i64 = 86_400_000;
    const BASE_MS: i64 = 1_794_601_800_000; // Day 0

    fn make_collection() -> (Collection, Arc<TestClock>) {
        let clock = Arc::new(TestClock::new(BASE_MS));
        let storage = Box::new(FakeStorage::default());
        (Collection::new(storage, clock.clone()).unwrap(), clock)
    }

    fn answer_good_card(
        col: &Collection,
        card_id: i64,
        now_ms: i64,
        taken_ms: i64,
        review_kind: i64,
    ) {
        let prev = CardState::new(2500);
        let next = CardState {
            phase: CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        let log = Revlog {
            id: now_ms,
            card_id,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms,
            review_kind,
        };
        col.apply_answer(card_id, card_id, &prev, 0, &next, 1, &log, 8)
            .unwrap();
    }

    #[test]
    fn quest_reward_revokes_on_undo_and_reawards_in_place() {
        let (col, clock) = make_collection();
        // Find a day where Slot 3 has `tasks_2` (day 0 has slot3 idx2: tasks_2!).
        let today = col.today();
        let quests = daily_quests_for_day(today);
        let task_quest = quests
            .iter()
            .find(|q| q.id == "tasks_2")
            .expect("day 0 has tasks_2");

        let t1 = col
            .create_task(TaskInput {
                list_id: None,
                title: "First".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        let t2 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Second".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();

        col.complete_task(&t1.id).unwrap();
        let state1 = col.get_motivation_state().unwrap();
        assert_eq!(state1.daily_quests[2].progress, 1);
        assert!(!state1.daily_quests[2].completed);

        clock.set(BASE_MS + 1_000);
        col.complete_task(&t2.id).unwrap();
        let state2 = col.get_motivation_state().unwrap();
        assert!(state2.daily_quests[2].completed);
        let sum_after = col.progress_summary().unwrap();
        // 2 tasks * 100 + 200 quest gold = 400; quest xp = 0 -> 20 xp total.
        assert_eq!(sum_after.today_xp, TASK_REWARD_XP * 2);
        assert_eq!(sum_after.gold_cents, 200 + DAILY_QUEST_GOLD_CENTS);

        // Undo t2 -> quest reward revokes cleanly.
        clock.set(BASE_MS + 2_000);
        col.undo().unwrap();
        let state_undone = col.get_motivation_state().unwrap();
        assert_eq!(state_undone.daily_quests[2].progress, 1);
        assert!(!state_undone.daily_quests[2].completed);
        let sum_undone = col.progress_summary().unwrap();
        assert_eq!(sum_undone.today_xp, TASK_REWARD_XP);
        assert_eq!(sum_undone.gold_cents, 100);

        // Re-complete t2 -> un-revokes existing row in place without duplicate rows.
        clock.set(BASE_MS + 3_000);
        col.complete_task(&t2.id).unwrap();
        let sum_re = col.progress_summary().unwrap();
        assert_eq!(sum_re.today_xp, TASK_REWARD_XP * 2);
        assert_eq!(sum_re.gold_cents, 200 + DAILY_QUEST_GOLD_CENTS);

        let key = daily_quest_source_key(today, task_quest.id);
        let active = col
            .storage()
            .get_active_ledger_reward(NIL_USER_ID, &key)
            .unwrap()
            .expect("quest reward should be active in place");
        assert_eq!(active.xp, 0);
        assert_eq!(active.gold_cents, DAILY_QUEST_GOLD_CENTS as i64);
    }

    #[test]
    fn comeback_bonus_once_per_return_after_7_days_and_midday_goal_change() {
        let (col, clock) = make_collection();
        col.set_daily_goal(10).unwrap();

        // Day 0 activity.
        answer_good_card(&col, 1, BASE_MS + 100, 1_000, 0);

        // Advance 7 days -> comeback offer becomes active.
        let day7_ms = BASE_MS + 7 * DAY_MS;
        clock.set(day7_ms);
        let state = col.get_motivation_state().unwrap();
        let offer = state.comeback_offer.expect("comeback offer after 7 days");
        assert_eq!(offer.away_days, 7);
        assert_eq!(offer.reward_gold_cents, COMEBACK_BONUS_GOLD_CENTS);

        // Earn 12 XP (4 cards * 3 XP >= 10 XP goal) -> comeback bonus grants once.
        for i in 0..4 {
            answer_good_card(&col, 10 + i, day7_ms + 1_000 + i * 100, 1_000, 0);
        }
        let state_awarded = col.get_motivation_state().unwrap();
        assert!(state_awarded.goal_met_today);
        assert_eq!(state_awarded.comeback_offer, None);
        let gold_after_comeback = col.progress_summary().unwrap().gold_cents;
        assert!(gold_after_comeback >= 5 * 25 + COMEBACK_BONUS_GOLD_CENTS);

        // Raising goal mid-day (10 -> 30) NEVER revokes comeback bonus or quests.
        let raised = col.set_daily_goal(30).unwrap();
        assert!(!raised.goal_met_today);
        assert_eq!(
            col.progress_summary().unwrap().gold_cents,
            gold_after_comeback
        );

        // Reaching the raised goal (30 XP) does NOT grant comeback bonus a second time.
        for i in 0..6 {
            answer_good_card(&col, 20 + i, day7_ms + 2_000 + i * 100, 1_000, 0);
        }
        let summary_at_30 = col.progress_summary().unwrap();
        // Only card reviews (+150 gold_cents) + any newly completed daily quest, never +500 again.
        assert_eq!(summary_at_30.gold_cents - gold_after_comeback, 6 * 25);
    }

    fn fake_day(ts: i64) -> i32 {
        Collection::new(
            Box::new(FakeStorage::default()),
            Arc::new(TestClock::new(ts)),
        )
        .unwrap()
        .today()
    }

    #[test]
    fn monthly_badge_at_20_is_monotonic() {
        let storage = Box::new(FakeStorage::default());
        // Pick a day in late Nov 2026 (Nov 21..=30) whose Slot 3 quest is `tasks_2`,
        // so all 19 pre-seeded days `(today - 19)..=(today - 1)` stay in `2026-11`
        // and completing 2 tasks (20 XP < 30 XP, 0 reviews) hits exactly 20 quests.
        let now_ms = (8..=17)
            .map(|off| BASE_MS + off * DAY_MS)
            .find(|&ts| daily_quests_for_day(fake_day(ts))[2].id == "tasks_2")
            .expect("Nov 21..=30 must include a tasks_2 day");
        let day0 = fake_day(now_ms);
        let clock = Arc::new(TestClock::new(now_ms));
        // Pre-seed 19 completed daily quests in `2026-11` across earlier days.
        {
            let mut ledger = storage.progress_ledger.lock().unwrap();
            for offset in 1..=19 {
                let d = day0 - offset;
                let q = daily_quests_for_day(d)[0];
                let key = daily_quest_source_key(d, q.id);
                ledger.push(crate::progress::ProgressLedgerEntry {
                    id: ledger_id(NIL_USER_ID, &key),
                    user_id: NIL_USER_ID.to_string(),
                    source_key: key,
                    xp: 0,
                    gold_cents: DAILY_QUEST_GOLD_CENTS as i64,
                    created_at: now_ms - i64::from(offset) * DAY_MS,
                    updated_at: now_ms - i64::from(offset) * DAY_MS,
                    deleted_at: None,
                    usn: -1,
                });
            }
        }
        let col = Collection::new(storage, clock.clone()).unwrap();
        assert_eq!(col.today(), day0);
        let t1 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Q1".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        let t2 = col
            .create_task(TaskInput {
                list_id: None,
                title: "Q2".into(),
                notes: "".into(),
                priority: TaskPriority::None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                manual_quadrant: None,
                sort_order: 0,
            })
            .unwrap();
        col.complete_task(&t1.id).unwrap();
        clock.set(now_ms + 1_000);
        col.complete_task(&t2.id).unwrap();

        let state = col.get_motivation_state().unwrap();
        assert!(state.monthly_badge.earned);
        assert_eq!(
            state.monthly_badge.completed_daily_quests,
            MONTHLY_BADGE_TARGET_QUESTS
        );
        let badge_key = monthly_badge_source_key(&state.monthly_badge.month_key);
        assert!(col
            .storage()
            .get_active_ledger_reward(NIL_USER_ID, &badge_key)
            .unwrap()
            .is_some());

        // Reopen 2nd task -> daily quest drops back to 19/20, but monthly badge stays earned & monotonic!
        clock.set(now_ms + 5_000);
        col.reopen_task(&t2.id).unwrap();
        let after_undo = col.get_motivation_state().unwrap();
        assert_eq!(after_undo.monthly_badge.completed_daily_quests, 19);
        assert!(after_undo.monthly_badge.earned);
        let badge_reward = col
            .storage()
            .get_active_ledger_reward(NIL_USER_ID, &badge_key)
            .unwrap()
            .expect("monthly badge reward must stay active (monotonic)");
        assert_eq!(badge_reward.gold_cents, MONTHLY_BADGE_GOLD_CENTS as i64);
    }

    #[test]
    fn game_auto_freeze_bridges_one_day_gap_and_quests_never_count_as_study_days() {
        let storage = Box::new(FakeStorage::default());
        let clock = Arc::new(TestClock::new(BASE_MS));
        let day0 = fake_day(BASE_MS);
        // Seed a freeze token held and a quest row on `day0 + 4` (NOT a study day!).
        {
            storage
                .freeze_token_ledger
                .lock()
                .unwrap()
                .push(crate::game::FreezeTokenEntry {
                    id: crate::game::game_entity_id(
                        "freeze_token_ledger",
                        NIL_USER_ID,
                        "freeze_buy:t1",
                    ),
                    user_id: NIL_USER_ID.to_string(),
                    source_key: "freeze_buy:t1".to_string(),
                    delta: 1,
                    created_at: BASE_MS,
                    updated_at: BASE_MS,
                    deleted_at: None,
                    usn: -1,
                });
            let quest_key = daily_quest_source_key(day0 + 4, "reviews_15");
            storage
                .progress_ledger
                .lock()
                .unwrap()
                .push(crate::progress::ProgressLedgerEntry {
                    id: ledger_id(NIL_USER_ID, &quest_key),
                    user_id: NIL_USER_ID.to_string(),
                    source_key: quest_key,
                    xp: 0,
                    gold_cents: DAILY_QUEST_GOLD_CENTS as i64,
                    created_at: BASE_MS + 4 * DAY_MS,
                    updated_at: BASE_MS + 4 * DAY_MS,
                    deleted_at: None,
                    usn: -1,
                });
        }
        let col = Collection::new(storage, clock.clone()).unwrap();
        assert_eq!(col.today(), day0);

        // Day 0: study. Day 1: study. Day 2: missed. Day 3: check in Default (no auto-freeze).
        answer_good_card(&col, 1, BASE_MS + 100, 1_000, 0);
        clock.set(BASE_MS + DAY_MS);
        answer_good_card(&col, 2, BASE_MS + DAY_MS + 100, 1_000, 0);

        // On `day0 + 4`, quest_daily:<day0+4>:reviews_15 exists in ledger, MUST NOT count as study day.
        clock.set(BASE_MS + 4 * DAY_MS);
        let default_day4 = col.get_motivation_state_for_style(Some("default")).unwrap();
        assert!(!default_day4.studied_today);
        assert_eq!(default_day4.current_streak, 0);

        // Rewind clock to `day0 + 3` (`day0 + 2` was missed 1-day gap).
        clock.set(BASE_MS + 3 * DAY_MS);
        let def_state = col.get_motivation_state_for_style(Some("default")).unwrap();
        assert_eq!(def_state.auto_frozen_day, None);
        assert_eq!(def_state.current_streak, 0);

        // Switch to Game style -> auto-freezes `day0 + 2` and preserves 2-day streak!
        let game_state = col.get_motivation_state_for_style(Some("game")).unwrap();
        assert_eq!(game_state.auto_frozen_day, Some(day0 + 2));
        assert_eq!(game_state.current_streak, 2);
        assert_eq!(col.storage().freeze_tokens_held(NIL_USER_ID).unwrap(), 0);
        let _ = (SpendKind::FreezeToken, FREEZE_TOKEN_CAP);
        let _ = (
            HabitGoalMode::AchieveAll,
            HabitInput {
                title: String::new(),
                notes: String::new(),
                icon_key: String::new(),
                color_token: String::new(),
                frequency_kind: crate::productivity::HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::AchieveAll,
                goal_target: 1.0,
                goal_unit: String::new(),
                start_date: None,
                target_days: None,
                section: crate::productivity::HabitSection::Others,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            },
            HabitLogInput {
                habit_id: String::new(),
                day_index: None,
                logged_value: 1.0,
                status: crate::productivity::HabitLogStatus::Logged,
                mood: None,
                note: String::new(),
            },
        );
    }
}
