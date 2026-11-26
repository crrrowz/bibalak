//! `Collection` productivity use-cases: task lists, tasks, Eisenhower matrix,
//! habits, habit logs, and local calendar (ADR-018).

use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::Ordering;

use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::epoch_days_to_date_string;
use crate::productivity::{
    compute_habit_day_rings, compute_habit_history_stats, compute_habit_longest_streak,
    compute_habit_streak, date_string_to_epoch_days, default_matrix_quadrants, entity_id_v5,
    evaluate_deck_due_quadrant, evaluate_task_quadrant, expand_calendar_events, is_valid_uuid,
    start_of_week_day_index, validate_calendar_event_input, validate_habit_input,
    validate_habit_log_input, validate_quadrant_config, validate_task_input,
    validate_task_list_input, CalendarEvent, CalendarEventInput, CalendarOccurrenceDto, Habit,
    HabitBoardDto, HabitDto, HabitGoalMode, HabitHistoryDto, HabitInput, HabitLog, HabitLogDto,
    HabitLogInput, HabitLogStatus, MatrixBoardDto, MatrixDeckDueItemDto, MatrixQuadrant,
    MatrixQuadrantDto, QuadrantKey, TaskDto, TaskInput, TaskItem, TaskList, TaskListDto,
    TaskListInput, TaskOrderItem, WeekStart,
};
use crate::progress::{
    build_yesterday_summary, habit_source_key, ledger_id, reward_for_habit, reward_for_task,
    task_source_key, RewardGrant, YesterdaySummaryDto, MS_PER_DAY, NIL_USER_ID,
    YESTERDAY_SUMMARY_SEEN_KEY,
};
use crate::undo::UndoAction;
use crate::Collection;

fn to_task_list_dto(list: TaskList) -> TaskListDto {
    TaskListDto {
        id: list.id,
        name: list.name,
        color_token: list.color_token,
        icon_key: list.icon_key,
        sort_order: list.sort_order,
    }
}

fn to_quadrant_dto(q: MatrixQuadrant) -> MatrixQuadrantDto {
    MatrixQuadrantDto {
        quadrant_key: q.quadrant_key,
        title: q.title,
        color_token: q.color_token,
        group_by: q.group_by,
        sort_by: q.sort_by,
        rule: q.rule,
    }
}

fn to_task_dto(
    task: TaskItem,
    effective_quadrant: Option<QuadrantKey>,
    list_names: &HashMap<String, String>,
    deck_names: &HashMap<i64, String>,
) -> TaskDto {
    let list_name = task
        .list_id
        .as_ref()
        .and_then(|id| list_names.get(id).cloned());
    let deck_name = task.deck_id.and_then(|id| deck_names.get(&id).cloned());
    TaskDto {
        id: task.id,
        list_id: task.list_id,
        list_name,
        title: task.title,
        notes: task.notes,
        priority: task.priority,
        manual_quadrant: task.manual_quadrant,
        effective_quadrant,
        due_date: task.due_date,
        scheduled_start_ms: task.scheduled_start_ms,
        scheduled_end_ms: task.scheduled_end_ms,
        tags: task.tags,
        deck_id: task.deck_id,
        deck_name,
        completed_at: task.completed_at,
        completed_day: task.completed_day,
        sort_order: task.sort_order,
    }
}

fn to_habit_dto(
    habit: Habit,
    created_epoch_day: i64,
    deck_names: &HashMap<i64, String>,
    current_streak: u32,
) -> HabitDto {
    let start_date =
        epoch_days_to_date_string(created_epoch_day + i64::from(habit.start_day_index));
    let deck_name = habit.deck_id.and_then(|id| deck_names.get(&id).cloned());
    HabitDto {
        id: habit.id,
        title: habit.title,
        notes: habit.notes,
        icon_key: habit.icon_key,
        color_token: habit.color_token,
        frequency_kind: habit.frequency_kind,
        weekdays: habit.weekdays,
        weekly_target: habit.weekly_target,
        interval_days: habit.interval_days,
        goal_mode: habit.goal_mode,
        goal_target: habit.goal_target,
        goal_unit: habit.goal_unit,
        start_day_index: habit.start_day_index,
        start_date,
        target_days: habit.target_days,
        section: habit.section,
        reminders: habit.reminders,
        auto_popup_log: habit.auto_popup_log,
        deck_id: habit.deck_id,
        deck_name,
        archived_at: habit.archived_at,
        sort_order: habit.sort_order,
        current_streak,
    }
}

fn to_habit_log_dto(log: HabitLog, created_epoch_day: i64) -> HabitLogDto {
    HabitLogDto {
        habit_id: log.habit_id,
        day_index: log.day_index,
        date: epoch_days_to_date_string(created_epoch_day + i64::from(log.day_index)),
        logged_value: log.logged_value,
        goal_target: log.goal_target,
        completed: log.completed,
        status: log.status,
        mood: log.mood,
        note: log.note,
    }
}

/// Reconcile active deck-linked habits for `day_index` against the authoritative revlog count.
/// Returns `true` if any `habit_log` or `progress_ledger` row changed.
#[allow(clippy::too_many_arguments)]
pub(crate) fn sync_deck_linked_habits_on_storage(
    storage: &dyn crate::ports::Storage,
    day_index: i32,
    today: i32,
    day_start_ms: i64,
    day_end_ms: i64,
    now_ms: i64,
    tz_offset_minutes: i32,
    rollover_hour: u8,
    created_ms: i64,
) -> CoreResult<(bool, bool)> {
    let habits = storage.list_habits(NIL_USER_ID, false)?;
    let linked: Vec<Habit> = habits
        .into_iter()
        .filter(|h| {
            h.deck_id.is_some() && crate::productivity::is_habit_active_on_day(h, day_index)
        })
        .collect();
    if linked.is_empty() {
        return Ok((false, false));
    }

    let decks = storage.list_decks()?;
    let active_deck_ids: std::collections::HashSet<i64> = decks.into_iter().map(|d| d.id).collect();
    let existing_logs = storage.list_habit_logs_range(NIL_USER_ID, day_index, day_index)?;
    let existing_by_habit: HashMap<&str, &HabitLog> = existing_logs
        .iter()
        .map(|l| (l.habit_id.as_str(), l))
        .collect();

    let mut count_cache: HashMap<i64, u32> = HashMap::new();
    let mut changed = false;
    let mut game_changed = false;

    for habit in linked {
        let Some(deck_id) = habit.deck_id else {
            continue;
        };
        if !active_deck_ids.contains(&deck_id) {
            continue;
        }
        let review_count = match count_cache.get(&deck_id) {
            Some(&c) => c,
            None => {
                let c = storage.deck_review_count_in_window(deck_id, day_start_ms, day_end_ms)?;
                count_cache.insert(deck_id, c);
                c
            }
        };
        let (logged_value, completed) = match habit.goal_mode {
            HabitGoalMode::ReachAmount => {
                let v = f64::from(review_count);
                (v, v >= habit.goal_target)
            }
            HabitGoalMode::AchieveAll => {
                (if review_count > 0 { 1.0 } else { 0.0 }, review_count > 0)
            }
        };

        let prev = existing_by_habit.get(habit.id.as_str()).copied();
        if prev
            .is_some_and(|p| matches!(p.status, HabitLogStatus::Skipped | HabitLogStatus::Frozen))
            && !completed
        {
            // Preserve explicit skip/freeze when review count is still below goal (ADR-023 §2.4).
            continue;
        }
        let source_key = habit_source_key(&habit.id, day_index);
        let active_reward = storage.get_active_ledger_reward(NIL_USER_ID, &source_key)?;
        let reward = reward_for_habit(completed, day_index, today).map(|r| RewardGrant {
            id: ledger_id(NIL_USER_ID, &source_key),
            user_id: NIL_USER_ID.to_string(),
            source_key: source_key.clone(),
            xp: r.xp as i64,
            gold_cents: r.gold_cents as i64,
            now_ms,
        });
        let want_revoke = !completed && active_reward.is_some();
        let want_grant = reward.is_some() && active_reward.is_none();

        if prev.is_none() && logged_value == 0.0 && !completed && !want_revoke && !want_grant {
            continue;
        }
        let log_matches = prev.is_some_and(|p| {
            p.status == HabitLogStatus::Logged
                && (p.logged_value - logged_value).abs() < f64::EPSILON
                && p.completed == completed
                && (p.goal_target - habit.goal_target).abs() < f64::EPSILON
        });
        if log_matches && !want_revoke && !want_grant {
            continue;
        }

        let log = HabitLog {
            id: entity_id_v5(
                "habit_log",
                NIL_USER_ID,
                &format!("{}:{day_index}", habit.id),
            ),
            user_id: NIL_USER_ID.to_string(),
            habit_id: habit.id.clone(),
            day_index,
            logged_value,
            goal_target: habit.goal_target,
            completed,
            status: HabitLogStatus::Logged,
            mood: prev.and_then(|p| p.mood),
            note: prev.map(|p| p.note.clone()).unwrap_or_default(),
            created_at: prev.map_or(now_ms, |p| p.created_at),
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        let revoke_key = (!completed).then_some(source_key.as_str());
        let ctx = crate::game_depth::GameEvalContext {
            user_id: NIL_USER_ID.to_string(),
            today,
            awarded_day: day_index,
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
            card_is_mature: false,
        };
        let game_out =
            storage.upsert_habit_log_with_game(&log, reward.as_ref(), revoke_key, &ctx)?;
        let outcome = game_out.habit_outcome;
        if !log_matches || outcome.reward_granted || outcome.reward_revoked {
            changed = true;
        }
        if game_out.game_changed {
            game_changed = true;
        }
    }

    Ok((changed, game_changed))
}

impl Collection {
    pub(crate) fn created_epoch_day_local(&self) -> i64 {
        self.local_day_index(self.created_ms)
    }

    fn today_epoch_days(&self) -> i64 {
        self.created_epoch_day_local() + i64::from(self.today())
    }

    fn deck_name_map(&self) -> CoreResult<HashMap<i64, String>> {
        Ok(self
            .storage
            .list_decks()?
            .into_iter()
            .map(|d| (d.id, d.name))
            .collect())
    }

    fn task_list_name_map(&self) -> CoreResult<HashMap<String, String>> {
        Ok(self
            .storage
            .list_task_lists(NIL_USER_ID)?
            .into_iter()
            .map(|l| (l.id, l.name))
            .collect())
    }

    fn active_quadrants_or_default(&self) -> CoreResult<Vec<MatrixQuadrant>> {
        let quadrants = self.storage.list_matrix_quadrants(NIL_USER_ID)?;
        if quadrants.is_empty() {
            Ok(default_matrix_quadrants(NIL_USER_ID))
        } else {
            Ok(quadrants)
        }
    }

    // ── Task Lists ───────────────────────────────────────────────────────────

    pub fn list_task_lists(&self) -> CoreResult<Vec<TaskListDto>> {
        Ok(self
            .storage
            .list_task_lists(NIL_USER_ID)?
            .into_iter()
            .map(to_task_list_dto)
            .collect())
    }

    pub fn create_task_list(&self, input: TaskListInput) -> CoreResult<TaskListDto> {
        let input = validate_task_list_input(input)?;
        let now_ms = self.clock.now_ms();
        let list = TaskList {
            id: self.storage.new_uuid(),
            user_id: NIL_USER_ID.to_string(),
            name: input.name,
            color_token: input.color_token,
            icon_key: input.icon_key,
            sort_order: input.sort_order,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        self.storage.upsert_task_list(&list)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(to_task_list_dto(list))
    }

    pub fn update_task_list(&self, id: &str, input: TaskListInput) -> CoreResult<TaskListDto> {
        let input = validate_task_list_input(input)?;
        let existing = self
            .storage
            .list_task_lists(NIL_USER_ID)?
            .into_iter()
            .find(|l| l.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("task list '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        let updated = TaskList {
            name: input.name,
            color_token: input.color_token,
            icon_key: input.icon_key,
            sort_order: input.sort_order,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
            ..existing
        };
        self.storage.upsert_task_list(&updated)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(to_task_list_dto(updated))
    }

    pub fn delete_task_list(&self, id: &str) -> CoreResult<()> {
        let existing = self
            .storage
            .list_task_lists(NIL_USER_ID)?
            .into_iter()
            .find(|l| l.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("task list '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        let moved_task_ids = self
            .storage
            .soft_delete_task_list(NIL_USER_ID, id, now_ms)?;
        let list_id = id.to_string();
        self.record_undo(
            UndoAction::DeleteTaskList {
                name: existing.name,
            },
            move |s, undo_now| {
                s.restore_task_list(NIL_USER_ID, &list_id, &moved_task_ids, undo_now)
            },
        );
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    // ── Tasks & Eisenhower Matrix ────────────────────────────────────────────

    pub fn get_matrix_board(&self, include_completed: bool) -> CoreResult<MatrixBoardDto> {
        let today_days = self.today_epoch_days();
        let today_date = epoch_days_to_date_string(today_days);
        let quadrants = self.active_quadrants_or_default()?;
        let tasks = self.storage.list_tasks(NIL_USER_ID, include_completed)?;
        let list_names = self.task_list_name_map()?;
        let decks_with_counts = self.list_decks_with_counts()?;
        let deck_names: HashMap<i64, String> = decks_with_counts
            .iter()
            .map(|(d, _)| (d.id, d.name.clone()))
            .collect();
        let parent_by_id: HashMap<i64, Option<i64>> = decks_with_counts
            .iter()
            .map(|(d, _)| (d.id, d.parent_id))
            .collect();

        let task_dtos = tasks
            .into_iter()
            .map(|t| {
                let eff = evaluate_task_quadrant(&t, &quadrants, today_days);
                to_task_dto(t, eff, &list_names, &deck_names)
            })
            .collect();

        let mut candidates = Vec::new();
        let mut listed_quadrant: HashMap<i64, QuadrantKey> = HashMap::new();
        for (deck, (new_c, learn_c, rev_c)) in decks_with_counts {
            if deck.is_filtered {
                continue;
            }
            let due_count = new_c + learn_c + rev_c;
            if due_count == 0 {
                continue;
            }
            if let Some(quadrant_key) = evaluate_deck_due_quadrant(deck.id, &quadrants) {
                listed_quadrant.insert(deck.id, quadrant_key);
                candidates.push(MatrixDeckDueItemDto {
                    deck_id: deck.id,
                    deck_name: deck.name,
                    due_count,
                    quadrant_key,
                });
            }
        }

        // Drop any deck whose ancestor is already listed in the same quadrant
        // (parent counts already include child decks).
        let deck_due_items = candidates
            .into_iter()
            .filter(|item| {
                let mut cur = parent_by_id.get(&item.deck_id).copied().flatten();
                let mut steps = 0usize;
                while let Some(anc_id) = cur {
                    if listed_quadrant.get(&anc_id) == Some(&item.quadrant_key) {
                        return false;
                    }
                    steps += 1;
                    if steps >= parent_by_id.len() {
                        break;
                    }
                    cur = parent_by_id.get(&anc_id).copied().flatten();
                }
                true
            })
            .collect();

        let quadrant_dtos = quadrants.into_iter().map(to_quadrant_dto).collect();
        Ok(MatrixBoardDto {
            today_date,
            quadrants: quadrant_dtos,
            tasks: task_dtos,
            deck_due_items,
        })
    }

    pub fn create_task(&self, input: TaskInput) -> CoreResult<TaskDto> {
        let input = validate_task_input(input)?;
        let list_names = self.task_list_name_map()?;
        if let Some(ref lid) = input.list_id {
            if !list_names.contains_key(lid) {
                return Err(CoreError::NotFound(format!("task list '{lid}' not found")));
            }
        }
        let now_ms = self.clock.now_ms();
        let task = TaskItem {
            id: self.storage.new_uuid(),
            user_id: NIL_USER_ID.to_string(),
            list_id: input.list_id,
            title: input.title,
            notes: input.notes,
            priority: input.priority,
            manual_quadrant: input.manual_quadrant,
            due_date: input.due_date,
            scheduled_start_ms: input.scheduled_start_ms,
            scheduled_end_ms: input.scheduled_end_ms,
            tags: input.tags,
            deck_id: input.deck_id,
            completed_at: None,
            completed_day: None,
            sort_order: input.sort_order,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        self.storage.upsert_task(&task)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        let quadrants = self.active_quadrants_or_default()?;
        let eff = evaluate_task_quadrant(&task, &quadrants, self.today_epoch_days());
        let deck_names = self.deck_name_map()?;
        Ok(to_task_dto(task, eff, &list_names, &deck_names))
    }

    pub fn update_task(&self, id: &str, input: TaskInput) -> CoreResult<TaskDto> {
        let input = validate_task_input(input)?;
        let existing = self
            .storage
            .get_task(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        let list_names = self.task_list_name_map()?;
        if let Some(ref lid) = input.list_id {
            if !list_names.contains_key(lid) {
                return Err(CoreError::NotFound(format!("task list '{lid}' not found")));
            }
        }
        let now_ms = self.clock.now_ms();
        let updated = TaskItem {
            list_id: input.list_id,
            title: input.title,
            notes: input.notes,
            priority: input.priority,
            manual_quadrant: input.manual_quadrant,
            due_date: input.due_date,
            scheduled_start_ms: input.scheduled_start_ms,
            scheduled_end_ms: input.scheduled_end_ms,
            tags: input.tags,
            deck_id: input.deck_id,
            sort_order: input.sort_order,
            updated_at: now_ms,
            usn: -1,
            ..existing
        };
        self.storage.upsert_task(&updated)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        let quadrants = self.active_quadrants_or_default()?;
        let eff = evaluate_task_quadrant(&updated, &quadrants, self.today_epoch_days());
        let deck_names = self.deck_name_map()?;
        Ok(to_task_dto(updated, eff, &list_names, &deck_names))
    }

    pub fn complete_task(&self, id: &str) -> CoreResult<()> {
        let existing = self
            .storage
            .get_task(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        if existing.completed_at.is_some() {
            return Ok(());
        }
        let now_ms = self.clock.now_ms();
        let today = self.today();
        let prev_completed_at = existing.completed_at;
        let prev_completed_day = existing.completed_day;
        let source_key = task_source_key(id);
        let totals = self.storage.progress_totals(
            NIL_USER_ID,
            self.today_start_ms(),
            self.today_end_ms(),
        )?;
        let reward = reward_for_task(totals.tasks_rewarded_today).map(|r| RewardGrant {
            id: ledger_id(NIL_USER_ID, &source_key),
            user_id: NIL_USER_ID.to_string(),
            source_key: source_key.clone(),
            xp: r.xp as i64,
            gold_cents: r.gold_cents as i64,
            now_ms,
        });
        let ctx = crate::game_depth::GameEvalContext {
            user_id: NIL_USER_ID.to_string(),
            today,
            awarded_day: today,
            now_ms,
            tz_offset_minutes: self.tz_offset_minutes.load(Ordering::Relaxed),
            rollover_hour: self.rollover_hour.load(Ordering::Relaxed),
            created_ms: self.created_ms,
            card_is_mature: false,
        };
        let outcome = self.storage.set_task_completion_with_game(
            NIL_USER_ID,
            id,
            Some(now_ms),
            Some(today),
            reward.as_ref(),
            None,
            &ctx,
        )?;
        let granted = outcome.reward_granted;
        let task_id = id.to_string();
        let revoke_key = granted.then_some(source_key);
        self.record_undo(
            UndoAction::CompleteTask {
                title: existing.title,
            },
            move |s, undo_now| {
                s.set_task_completion(
                    NIL_USER_ID,
                    &task_id,
                    prev_completed_at,
                    prev_completed_day,
                    None,
                    revoke_key.as_deref(),
                    undo_now,
                )
                .map(|_| ())
            },
        );
        let _ = self.reconcile_motivation(false)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        if outcome.game_changed {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(())
    }

    pub fn reopen_task(&self, id: &str) -> CoreResult<()> {
        let existing = self
            .storage
            .get_task(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        let prev_completed_at = existing.completed_at;
        let prev_completed_day = existing.completed_day;
        let source_key = task_source_key(id);
        let prev_grant = self
            .storage
            .get_active_ledger_reward(NIL_USER_ID, &source_key)?;
        let _ = self.storage.set_task_completion(
            NIL_USER_ID,
            id,
            None,
            None,
            None,
            Some(&source_key),
            now_ms,
        )?;
        let task_id = id.to_string();
        self.record_undo(
            UndoAction::ReopenTask {
                title: existing.title,
            },
            move |s, undo_now| {
                s.set_task_completion(
                    NIL_USER_ID,
                    &task_id,
                    prev_completed_at,
                    prev_completed_day,
                    prev_grant.as_ref(),
                    None,
                    undo_now,
                )
                .map(|_| ())
            },
        );
        let _ = self.reconcile_motivation(true)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn delete_task(&self, id: &str) -> CoreResult<()> {
        let existing = self
            .storage
            .get_task(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        self.storage.soft_delete_task(NIL_USER_ID, id, now_ms)?;
        let task_id = id.to_string();
        self.record_undo(
            UndoAction::DeleteTask {
                title: existing.title,
            },
            move |s, undo_now| s.restore_task(NIL_USER_ID, &task_id, undo_now),
        );
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    /// Maximum number of task items accepted in a single `reorder_tasks` batch.
    pub const MAX_REORDER_TASKS_ITEMS: usize = 500;

    pub fn reorder_tasks(&self, items: Vec<TaskOrderItem>) -> CoreResult<()> {
        if items.is_empty() {
            return Err(CoreError::Invalid(
                "reorder_tasks requires at least one item".into(),
            ));
        }
        if items.len() > Self::MAX_REORDER_TASKS_ITEMS {
            return Err(CoreError::Invalid(format!(
                "reorder_tasks accepts at most {} items",
                Self::MAX_REORDER_TASKS_ITEMS
            )));
        }
        for item in &items {
            if !is_valid_uuid(&item.id) {
                return Err(CoreError::Invalid(format!("invalid task id '{}'", item.id)));
            }
        }
        let now_ms = self.clock.now_ms();
        self.storage.reorder_tasks(NIL_USER_ID, &items, now_ms)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn reschedule_overdue_tasks(&self, target_date: &str) -> CoreResult<u32> {
        let target_days = date_string_to_epoch_days(target_date)?;
        let today_days = self.today_epoch_days();
        if target_days < today_days {
            return Err(CoreError::Invalid(format!(
                "target_date '{target_date}' cannot be in the past"
            )));
        }
        let today_date = epoch_days_to_date_string(today_days);
        let now_ms = self.clock.now_ms();
        let count =
            self.storage
                .reschedule_overdue_tasks(NIL_USER_ID, &today_date, target_date, now_ms)?;
        if count > 0 {
            self.events.emit(DomainEvent::ProductivityChanged);
        }
        Ok(count)
    }

    pub fn move_task_to_quadrant(&self, id: &str, quadrant: QuadrantKey) -> CoreResult<TaskDto> {
        let existing = self
            .storage
            .get_task(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        let updated = TaskItem {
            manual_quadrant: Some(quadrant),
            updated_at: now_ms,
            usn: -1,
            ..existing
        };
        self.storage.upsert_task(&updated)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        let quadrants = self.active_quadrants_or_default()?;
        let eff = evaluate_task_quadrant(&updated, &quadrants, self.today_epoch_days());
        let list_names = self.task_list_name_map()?;
        let deck_names = self.deck_name_map()?;
        Ok(to_task_dto(updated, eff, &list_names, &deck_names))
    }

    pub fn save_matrix_quadrant(&self, q: MatrixQuadrantDto) -> CoreResult<MatrixQuadrantDto> {
        validate_quadrant_config(&q.title, &q.color_token, &q.rule)?;
        let now_ms = self.clock.now_ms();
        let existing = self
            .storage
            .list_matrix_quadrants(NIL_USER_ID)?
            .into_iter()
            .find(|item| item.quadrant_key == q.quadrant_key);
        let row = MatrixQuadrant {
            id: existing.as_ref().map_or_else(
                || entity_id_v5("matrix_quadrant", NIL_USER_ID, q.quadrant_key.as_str()),
                |item| item.id.clone(),
            ),
            user_id: NIL_USER_ID.to_string(),
            quadrant_key: q.quadrant_key,
            title: q.title.trim().to_string(),
            color_token: q.color_token.trim().to_string(),
            group_by: q.group_by,
            sort_by: q.sort_by,
            rule: q.rule,
            created_at: existing.map_or(now_ms, |item| item.created_at),
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        self.storage.upsert_matrix_quadrant(&row)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(to_quadrant_dto(row))
    }

    pub fn restore_matrix_defaults(
        &self,
        quadrant: Option<QuadrantKey>,
    ) -> CoreResult<Vec<MatrixQuadrantDto>> {
        let now_ms = self.clock.now_ms();
        let existing = self.storage.list_matrix_quadrants(NIL_USER_ID)?;
        for mut default_q in default_matrix_quadrants(NIL_USER_ID) {
            if quadrant.is_some_and(|k| k != default_q.quadrant_key) {
                continue;
            }
            if let Some(cur) = existing
                .iter()
                .find(|item| item.quadrant_key == default_q.quadrant_key)
            {
                default_q.id = cur.id.clone();
                default_q.created_at = cur.created_at;
            }
            default_q.updated_at = now_ms;
            default_q.deleted_at = None;
            default_q.usn = -1;
            self.storage.upsert_matrix_quadrant(&default_q)?;
        }
        self.events.emit(DomainEvent::ProductivityChanged);
        let updated = self.active_quadrants_or_default()?;
        Ok(updated.into_iter().map(to_quadrant_dto).collect())
    }

    // ── Habits & Logs ────────────────────────────────────────────────────────

    pub(crate) fn day_start_end_ms(&self, day_index: i32) -> (i64, i64) {
        let start = self.day_zero_start_ms() + i64::from(day_index) * MS_PER_DAY;
        (start, start + MS_PER_DAY)
    }

    pub(crate) fn sync_deck_linked_habits_for_day(&self, day_index: i32) -> CoreResult<bool> {
        let today = self.today();
        let (day_start_ms, day_end_ms) = self.day_start_end_ms(day_index);
        let now_ms = self.clock.now_ms();
        let (changed, game_changed) = sync_deck_linked_habits_on_storage(
            self.storage.as_ref(),
            day_index,
            today,
            day_start_ms,
            day_end_ms,
            now_ms,
            self.tz_offset_minutes.load(Ordering::Relaxed),
            self.rollover_hour.load(Ordering::Relaxed),
            self.created_ms,
        )?;
        if changed {
            self.events.emit(DomainEvent::ProductivityChanged);
        }
        if game_changed {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(changed)
    }

    /// Read-only "yesterday" summary (returns `None` on day 0, when dismissed, or when yesterday had no activity).
    pub fn yesterday_summary(&self) -> CoreResult<Option<YesterdaySummaryDto>> {
        let today = self.today();
        if today < 1 {
            return Ok(None);
        }
        if let Some(seen_str) = self.storage.get_sync_state(YESTERDAY_SUMMARY_SEEN_KEY)? {
            if seen_str
                .trim()
                .parse::<i32>()
                .ok()
                .is_some_and(|s| s >= today)
            {
                return Ok(None);
            }
        }
        let yesterday = today - 1;
        let (y_start, y_end) = self.day_start_end_ms(yesterday);
        let activity = self
            .storage
            .yesterday_activity(NIL_USER_ID, yesterday, y_start, y_end)?;
        Ok(build_yesterday_summary(
            yesterday,
            self.created_epoch_day_local(),
            activity,
        ))
    }

    /// Persist dismissal of the "yesterday" summary card for `day` in local-only `sync_state`.
    pub fn dismiss_yesterday_summary(&self, day: i32) -> CoreResult<()> {
        self.storage
            .set_sync_state(YESTERDAY_SUMMARY_SEEN_KEY, &day.to_string())
    }

    pub fn get_habit_board(
        &self,
        week_start_day: Option<i32>,
        week_start: Option<WeekStart>,
    ) -> CoreResult<HabitBoardDto> {
        let week_start = week_start.unwrap_or_default();
        let today = self.today();
        let _ = self.sync_deck_linked_habits_for_day(today)?;
        let created_epoch_day = self.created_epoch_day_local();
        let today_date = epoch_days_to_date_string(created_epoch_day + i64::from(today));
        let start_day = week_start_day.unwrap_or_else(|| {
            start_of_week_day_index(today, created_epoch_day + i64::from(today), week_start)
        });
        let end_day = start_day + 6;

        let habits = self.storage.list_habits(NIL_USER_ID, false)?;
        let min_habit_start = habits
            .iter()
            .map(|h| h.start_day_index)
            .min()
            .unwrap_or(start_day);
        let from_day = (start_day - 6).min(min_habit_start - 6).min(today - 6);
        let to_day = end_day.max(today);
        let all_logs = self
            .storage
            .list_habit_logs_range(NIL_USER_ID, from_day, to_day)?;

        let week_days = compute_habit_day_rings(
            &habits,
            &all_logs,
            start_day,
            7,
            created_epoch_day,
            week_start,
        );
        let deck_names = self.deck_name_map()?;

        let habit_dtos = habits
            .into_iter()
            .map(|h| {
                let streak =
                    compute_habit_streak(&h, &all_logs, today, created_epoch_day, week_start);
                to_habit_dto(h, created_epoch_day, &deck_names, streak)
            })
            .collect();

        let visible_logs = all_logs
            .into_iter()
            .filter(|l| l.day_index >= start_day && l.day_index <= end_day)
            .map(|l| to_habit_log_dto(l, created_epoch_day))
            .collect();

        Ok(HabitBoardDto {
            today_day_index: today,
            today_date,
            week_days,
            habits: habit_dtos,
            logs: visible_logs,
        })
    }

    pub fn get_habit_history(
        &self,
        habit_id: &str,
        months: Option<u32>,
        week_start: Option<WeekStart>,
    ) -> CoreResult<HabitHistoryDto> {
        let habit = self
            .storage
            .get_habit(NIL_USER_ID, habit_id)?
            .ok_or_else(|| CoreError::NotFound(format!("habit '{habit_id}' not found")))?;
        let months = months.unwrap_or(12).clamp(1, 24);
        let week_start = week_start.unwrap_or_default();
        let today = self.today();
        let created_epoch_day = self.created_epoch_day_local();
        let today_date = epoch_days_to_date_string(created_epoch_day + i64::from(today));

        let window_days = i32::try_from(months).unwrap_or(12) * 31;
        let window_start = today - (window_days - 1);
        let fetch_from = window_start.min(habit.start_day_index) - 6;
        let all_logs =
            self.storage
                .list_habit_logs_for_habit(NIL_USER_ID, habit_id, fetch_from, today)?;

        let current_streak =
            compute_habit_streak(&habit, &all_logs, today, created_epoch_day, week_start);
        let longest_streak =
            compute_habit_longest_streak(&habit, &all_logs, today, created_epoch_day, week_start);
        let stats = compute_habit_history_stats(
            &habit,
            &all_logs,
            window_start,
            today,
            created_epoch_day,
            week_start,
        );

        let deck_names = self.deck_name_map()?;
        let habit_dto = to_habit_dto(habit, created_epoch_day, &deck_names, current_streak);
        let logs = all_logs
            .into_iter()
            .filter(|l| l.day_index >= window_start && l.day_index <= today)
            .map(|l| to_habit_log_dto(l, created_epoch_day))
            .collect();

        Ok(HabitHistoryDto {
            habit: habit_dto,
            today_day_index: today,
            today_date,
            current_streak,
            longest_streak,
            completed_days: stats.completed_days,
            skipped_days: stats.skipped_days,
            frozen_days: stats.frozen_days,
            completion_rate_pct: stats.completion_rate_pct,
            logs,
        })
    }

    pub fn list_archived_habits(&self) -> CoreResult<Vec<HabitDto>> {
        let archived: Vec<Habit> = self
            .storage
            .list_habits(NIL_USER_ID, true)?
            .into_iter()
            .filter(|h| h.archived_at.is_some())
            .collect();
        if archived.is_empty() {
            return Ok(Vec::new());
        }
        let today = self.today();
        let created_epoch_day = self.created_epoch_day_local();
        let min_start = archived
            .iter()
            .map(|h| h.start_day_index)
            .min()
            .unwrap_or(today);
        let logs = self.storage.list_habit_logs_range(
            NIL_USER_ID,
            (min_start - 6).min(today - 6),
            today,
        )?;
        let deck_names = self.deck_name_map()?;
        Ok(archived
            .into_iter()
            .map(|h| {
                let streak =
                    compute_habit_streak(&h, &logs, today, created_epoch_day, WeekStart::default());
                to_habit_dto(h, created_epoch_day, &deck_names, streak)
            })
            .collect())
    }

    pub fn create_habit(&self, input: HabitInput) -> CoreResult<HabitDto> {
        let input = validate_habit_input(input)?;
        let created_epoch_day = self.created_epoch_day_local();
        let start_day_index = match input.start_date {
            Some(ref d) => {
                let epoch = date_string_to_epoch_days(d)?;
                i32::try_from(epoch - created_epoch_day).map_err(|_| {
                    CoreError::Invalid("habit start_date is out of supported range".into())
                })?
            }
            None => self.today(),
        };
        let now_ms = self.clock.now_ms();
        let habit = Habit {
            id: self.storage.new_uuid(),
            user_id: NIL_USER_ID.to_string(),
            title: input.title,
            notes: input.notes,
            icon_key: input.icon_key,
            color_token: input.color_token,
            frequency_kind: input.frequency_kind,
            weekdays: input.weekdays,
            weekly_target: input.weekly_target,
            interval_days: input.interval_days,
            goal_mode: input.goal_mode,
            goal_target: input.goal_target,
            goal_unit: input.goal_unit,
            start_day_index,
            target_days: input.target_days,
            section: input.section,
            reminders: input.reminders,
            auto_popup_log: input.auto_popup_log,
            deck_id: input.deck_id,
            archived_at: None,
            sort_order: input.sort_order,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        self.storage.upsert_habit(&habit)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        let deck_names = self.deck_name_map()?;
        Ok(to_habit_dto(habit, created_epoch_day, &deck_names, 0))
    }

    pub fn update_habit(&self, id: &str, input: HabitInput) -> CoreResult<HabitDto> {
        let input = validate_habit_input(input)?;
        let existing = self
            .storage
            .get_habit(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("habit '{id}' not found")))?;
        let created_epoch_day = self.created_epoch_day_local();
        let start_day_index = match input.start_date {
            Some(ref d) => {
                let epoch = date_string_to_epoch_days(d)?;
                i32::try_from(epoch - created_epoch_day).map_err(|_| {
                    CoreError::Invalid("habit start_date is out of supported range".into())
                })?
            }
            None => existing.start_day_index,
        };
        let now_ms = self.clock.now_ms();
        let updated = Habit {
            title: input.title,
            notes: input.notes,
            icon_key: input.icon_key,
            color_token: input.color_token,
            frequency_kind: input.frequency_kind,
            weekdays: input.weekdays,
            weekly_target: input.weekly_target,
            interval_days: input.interval_days,
            goal_mode: input.goal_mode,
            goal_target: input.goal_target,
            goal_unit: input.goal_unit,
            start_day_index,
            target_days: input.target_days,
            section: input.section,
            reminders: input.reminders,
            auto_popup_log: input.auto_popup_log,
            deck_id: input.deck_id,
            sort_order: input.sort_order,
            updated_at: now_ms,
            usn: -1,
            ..existing
        };
        self.storage.upsert_habit(&updated)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        let today = self.today();
        let logs = self.storage.list_habit_logs_range(
            NIL_USER_ID,
            updated.start_day_index.min(today),
            today,
        )?;
        let streak = compute_habit_streak(
            &updated,
            &logs,
            today,
            created_epoch_day,
            WeekStart::default(),
        );
        let deck_names = self.deck_name_map()?;
        Ok(to_habit_dto(
            updated,
            created_epoch_day,
            &deck_names,
            streak,
        ))
    }

    pub fn archive_habit(&self, id: &str, archived: bool) -> CoreResult<()> {
        let existing = self
            .storage
            .get_habit(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("habit '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        let updated = Habit {
            archived_at: if archived { Some(now_ms) } else { None },
            updated_at: now_ms,
            usn: -1,
            ..existing
        };
        self.storage.upsert_habit(&updated)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn delete_habit(&self, id: &str) -> CoreResult<()> {
        let existing = self
            .storage
            .get_habit(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("habit '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        let log_ids = self.storage.soft_delete_habit(NIL_USER_ID, id, now_ms)?;
        let habit_id = id.to_string();
        self.record_undo(
            UndoAction::DeleteHabit {
                title: existing.title,
            },
            move |s, undo_now| s.restore_habit(NIL_USER_ID, &habit_id, &log_ids, undo_now),
        );
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn log_habit(&self, input: HabitLogInput) -> CoreResult<HabitLogDto> {
        validate_habit_log_input(&input)?;
        let habit = self
            .storage
            .get_habit(NIL_USER_ID, &input.habit_id)?
            .ok_or_else(|| CoreError::NotFound(format!("habit '{}' not found", input.habit_id)))?;
        let today = self.today();
        let day_index = input.day_index.unwrap_or(today);
        let now_ms = self.clock.now_ms();
        if input.status == HabitLogStatus::Frozen {
            if day_index != today && day_index != today - 1 {
                return Err(CoreError::Invalid(
                    "streak freeze is only allowed for today or yesterday".into(),
                ));
            }
            let existing = self
                .storage
                .list_habit_logs_for_habit(NIL_USER_ID, &habit.id, day_index, day_index)?
                .into_iter()
                .next();
            if let Some(prev) = existing {
                if prev.completed {
                    return Err(CoreError::Invalid(
                        "cannot freeze an already completed habit day".into(),
                    ));
                }
                if prev.status == HabitLogStatus::Frozen {
                    return Ok(to_habit_log_dto(prev, self.created_epoch_day_local()));
                }
            }
        }
        let (logged_value, completed) = if input.status != HabitLogStatus::Logged {
            (0.0, false)
        } else if let Some(deck_id) = habit.deck_id {
            let (d_start, d_end) = self.day_start_end_ms(day_index);
            let count = self
                .storage
                .deck_review_count_in_window(deck_id, d_start, d_end)?;
            match habit.goal_mode {
                HabitGoalMode::ReachAmount => {
                    let v = f64::from(count);
                    (v, v >= habit.goal_target)
                }
                HabitGoalMode::AchieveAll => (if count > 0 { 1.0 } else { 0.0 }, count > 0),
            }
        } else {
            (input.logged_value, input.logged_value >= habit.goal_target)
        };
        let log_id = entity_id_v5(
            "habit_log",
            NIL_USER_ID,
            &format!("{}:{day_index}", habit.id),
        );
        let log = HabitLog {
            id: log_id,
            user_id: NIL_USER_ID.to_string(),
            habit_id: habit.id.clone(),
            day_index,
            logged_value,
            goal_target: habit.goal_target,
            completed,
            status: input.status,
            mood: input.mood,
            note: input.note,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        let source_key = habit_source_key(&habit.id, day_index);
        let prev_reward = self
            .storage
            .get_active_ledger_reward(NIL_USER_ID, &source_key)?;
        let reward = reward_for_habit(completed, day_index, today).map(|r| RewardGrant {
            id: ledger_id(NIL_USER_ID, &source_key),
            user_id: NIL_USER_ID.to_string(),
            source_key: source_key.clone(),
            xp: r.xp as i64,
            gold_cents: r.gold_cents as i64,
            now_ms,
        });
        let revoke_key = (!completed).then_some(source_key.as_str());
        let ctx = crate::game_depth::GameEvalContext {
            user_id: NIL_USER_ID.to_string(),
            today,
            awarded_day: day_index,
            now_ms,
            tz_offset_minutes: self.tz_offset_minutes.load(Ordering::Relaxed),
            rollover_hour: self.rollover_hour.load(Ordering::Relaxed),
            created_ms: self.created_ms,
            card_is_mature: false,
        };
        let game_out =
            self.storage
                .upsert_habit_log_with_game(&log, reward.as_ref(), revoke_key, &ctx)?;
        let outcome = game_out.habit_outcome;
        let previous = outcome.previous;
        let revoke_on_undo =
            (outcome.reward_granted && prev_reward.is_none()).then_some(source_key);
        let habit_id = habit.id;
        self.record_undo(
            UndoAction::LogHabit { title: habit.title },
            move |s, undo_now| {
                s.restore_habit_log_snapshot(
                    NIL_USER_ID,
                    &habit_id,
                    day_index,
                    previous.as_ref(),
                    prev_reward.as_ref(),
                    revoke_on_undo.as_deref(),
                    undo_now,
                )
            },
        );
        let _ = self.reconcile_motivation(!completed)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        if game_out.game_changed {
            self.events.emit(DomainEvent::GameChanged);
        }
        Ok(to_habit_log_dto(
            outcome.current,
            self.created_epoch_day_local(),
        ))
    }

    // ── Calendar Events ──────────────────────────────────────────────────────

    pub fn list_calendar_occurrences(
        &self,
        window_start_ms: i64,
        window_end_ms: i64,
    ) -> CoreResult<Vec<CalendarOccurrenceDto>> {
        let events = self.storage.list_calendar_events(NIL_USER_ID)?;
        let tz_offset_minutes = self.tz_offset_minutes.load(Ordering::Relaxed);
        Ok(expand_calendar_events(
            &events,
            window_start_ms,
            window_end_ms,
            tz_offset_minutes,
        ))
    }

    fn single_occurrence_dto(&self, event: &CalendarEvent) -> CalendarOccurrenceDto {
        let tz_off_ms = i64::from(self.tz_offset_minutes.load(Ordering::Relaxed)) * 60_000;
        let anchor_day = if event.is_all_day {
            event.start_ms.div_euclid(MS_PER_DAY)
        } else {
            (event.start_ms + tz_off_ms).div_euclid(MS_PER_DAY)
        };
        CalendarOccurrenceDto {
            event_id: event.id.clone(),
            occurrence_date: epoch_days_to_date_string(anchor_day),
            is_recurring: event.recurrence.is_some(),
            title: event.title.clone(),
            description: event.description.clone(),
            location: event.location.clone(),
            color_token: event.color_token.clone(),
            start_ms: event.start_ms,
            end_ms: event.end_ms,
            is_all_day: event.is_all_day,
            linked_task_id: event.linked_task_id.clone(),
            recurrence: event.recurrence.clone(),
        }
    }

    pub fn create_calendar_event(
        &self,
        input: CalendarEventInput,
    ) -> CoreResult<CalendarOccurrenceDto> {
        let input = validate_calendar_event_input(input)?;
        if let Some(ref tid) = input.linked_task_id {
            if self.storage.get_task(NIL_USER_ID, tid)?.is_none() {
                return Err(CoreError::NotFound(format!("task '{tid}' not found")));
            }
        }
        let now_ms = self.clock.now_ms();
        let event = CalendarEvent {
            id: self.storage.new_uuid(),
            user_id: NIL_USER_ID.to_string(),
            title: input.title,
            description: input.description,
            location: input.location,
            color_token: input.color_token,
            start_ms: input.start_ms,
            end_ms: input.end_ms,
            is_all_day: input.is_all_day,
            recurrence: input.recurrence,
            linked_task_id: input.linked_task_id,
            external_account_id: None,
            external_event_id: None,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        };
        self.storage.upsert_calendar_event(&event)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(self.single_occurrence_dto(&event))
    }

    pub fn update_calendar_event(
        &self,
        id: &str,
        input: CalendarEventInput,
    ) -> CoreResult<CalendarOccurrenceDto> {
        let input = validate_calendar_event_input(input)?;
        let existing = self
            .storage
            .get_calendar_event(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("calendar event '{id}' not found")))?;
        if let Some(ref tid) = input.linked_task_id {
            if self.storage.get_task(NIL_USER_ID, tid)?.is_none() {
                return Err(CoreError::NotFound(format!("task '{tid}' not found")));
            }
        }
        let now_ms = self.clock.now_ms();
        let updated = CalendarEvent {
            title: input.title,
            description: input.description,
            location: input.location,
            color_token: input.color_token,
            start_ms: input.start_ms,
            end_ms: input.end_ms,
            is_all_day: input.is_all_day,
            recurrence: input.recurrence,
            linked_task_id: input.linked_task_id,
            updated_at: now_ms,
            usn: -1,
            ..existing
        };
        self.storage.upsert_calendar_event(&updated)?;
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(self.single_occurrence_dto(&updated))
    }

    pub fn delete_calendar_event(&self, id: &str) -> CoreResult<()> {
        let existing = self
            .storage
            .get_calendar_event(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("calendar event '{id}' not found")))?;
        let now_ms = self.clock.now_ms();
        self.storage
            .soft_delete_calendar_event(NIL_USER_ID, id, now_ms)?;
        let event_id = id.to_string();
        self.record_undo(
            UndoAction::DeleteCalendarEvent {
                title: existing.title,
            },
            move |s, undo_now| s.restore_calendar_event(NIL_USER_ID, &event_id, undo_now),
        );
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }

    pub fn delete_calendar_occurrence(&self, id: &str, occurrence_date: &str) -> CoreResult<()> {
        date_string_to_epoch_days(occurrence_date)?;
        let existing = self
            .storage
            .get_calendar_event(NIL_USER_ID, id)?
            .ok_or_else(|| CoreError::NotFound(format!("calendar event '{id}' not found")))?;
        let mut rec = existing.recurrence.clone().ok_or_else(|| {
            CoreError::Invalid("cannot exclude occurrence on a non-recurring event".into())
        })?;
        let prev_exdates = rec.exdates.clone();
        let mut set: BTreeSet<String> = rec.exdates.into_iter().collect();
        set.insert(occurrence_date.to_string());
        rec.exdates = set.into_iter().collect();

        let now_ms = self.clock.now_ms();
        let title = existing.title.clone();
        let updated = CalendarEvent {
            recurrence: Some(rec),
            updated_at: now_ms,
            usn: -1,
            ..existing
        };
        self.storage.upsert_calendar_event(&updated)?;
        let event_id = id.to_string();
        self.record_undo(
            UndoAction::DeleteCalendarEvent { title },
            move |s, undo_now| {
                if let Some(mut ev) = s.get_calendar_event(NIL_USER_ID, &event_id)? {
                    if let Some(ref mut r) = ev.recurrence {
                        r.exdates = prev_exdates;
                    }
                    ev.updated_at = undo_now;
                    ev.usn = -1;
                    s.upsert_calendar_event(&ev)?;
                }
                Ok(())
            },
        );
        self.events.emit(DomainEvent::ProductivityChanged);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use crate::collection::fake_storage::FakeStorage;
    use crate::error::CoreError;
    use crate::events::DomainEvent;
    use crate::ports::{FixedClock, TestClock};
    use crate::productivity::{
        entity_id_v5, HabitFrequencyKind, HabitGoalMode, HabitInput, HabitLogInput, HabitLogStatus,
        HabitSection, MatrixGroupBy, MatrixListFilter, MatrixQuadrantDto, MatrixSortBy,
        QuadrantKey, QuadrantRule, TaskInput, TaskListInput, TaskPriority,
    };
    use crate::progress::NIL_USER_ID;
    use crate::undo::UndoAction;
    use crate::Collection;

    fn make_collection_with_events(now_ms: i64) -> (Collection, Arc<Mutex<Vec<DomainEvent>>>) {
        let storage = FakeStorage::default();
        let c = Collection::new(Box::new(storage), Arc::new(FixedClock(now_ms))).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        c.events().subscribe(move |ev| {
            captured.lock().unwrap().push(ev.clone());
        });
        (c, events)
    }

    #[test]
    fn complete_and_reopen_task_record_undo_and_emit_event() {
        let now_ms = 1_795_341_600_000_i64;
        let (c, events) = make_collection_with_events(now_ms);
        let task = c
            .create_task(TaskInput {
                list_id: None,
                title: "Write M1 tests".into(),
                notes: String::new(),
                priority: TaskPriority::High,
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
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::CompleteTask {
                title: "Write M1 tests".into(),
            })
        );
        let board = c.get_matrix_board(true).unwrap();
        let done = board.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(done.completed_day, Some(c.today()));
        assert_eq!(done.completed_at, Some(now_ms));

        assert!(events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DomainEvent::ProductivityChanged)));

        // Undo completion -> incomplete again
        assert_eq!(
            c.undo().unwrap(),
            Some(UndoAction::CompleteTask {
                title: "Write M1 tests".into(),
            })
        );
        let board = c.get_matrix_board(true).unwrap();
        let undone = board.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(undone.completed_at, None);
        assert_eq!(undone.completed_day, None);

        // Complete again, then reopen -> records ReopenTask and undo restores completed state
        c.complete_task(&task.id).unwrap();
        c.reopen_task(&task.id).unwrap();
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::ReopenTask {
                title: "Write M1 tests".into(),
            })
        );
        c.undo().unwrap();
        let board = c.get_matrix_board(true).unwrap();
        let restored = board.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(restored.completed_at, Some(now_ms));
    }

    #[test]
    fn log_habit_undo_restores_prior_snapshot_and_day_index() {
        // Start at 2026-11-22 03:30:00 UTC (before default rollover_hour = 4).
        let before_rollover = 1_795_318_200_000_i64;
        let clock = Arc::new(TestClock::new(before_rollover));
        let c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();
        let day_before = c.today();

        // Advance 1 hour across 04:00 rollover -> today() increments by 1.
        clock.advance_ms(3_600_000);
        let expected_day = c.today();
        assert_eq!(expected_day, day_before + 1);

        let habit = c
            .create_habit(HabitInput {
                title: "Drink water".into(),
                notes: String::new(),
                icon_key: "droplet".into(),
                color_token: "info".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::ReachAmount,
                goal_target: 2000.0,
                goal_unit: "ml".into(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();

        // First log: creates new row for day_index = Collection::today().
        let log1 = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: None,
                logged_value: 500.0,
                status: HabitLogStatus::Logged,
                mood: Some(3),
                note: "Morning glass".into(),
            })
            .unwrap();
        assert_eq!(log1.day_index, expected_day);
        assert!(!log1.completed);
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::LogHabit {
                title: "Drink water".into(),
            })
        );

        // Second log: updates existing row to 2000.0 (completed).
        let log2 = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: None,
                logged_value: 2000.0,
                status: HabitLogStatus::Logged,
                mood: Some(5),
                note: "Finished!".into(),
            })
            .unwrap();
        assert!(log2.completed);

        // Undo second log -> restores exact prior snapshot (500.0, mood 3, "Morning glass").
        c.undo().unwrap();
        let board = c.get_habit_board(None, None).unwrap();
        let after_first_undo = board
            .logs
            .iter()
            .find(|l| l.habit_id == habit.id && l.day_index == expected_day)
            .unwrap();
        assert_eq!(after_first_undo.logged_value, 500.0);
        assert_eq!(after_first_undo.mood, Some(3));
        assert_eq!(after_first_undo.note, "Morning glass");
        assert!(!after_first_undo.completed);

        // Undo first log -> soft-deletes newly created log.
        c.undo().unwrap();
        let board_after_second = c.get_habit_board(None, None).unwrap();
        assert!(board_after_second
            .logs
            .iter()
            .all(|l| !(l.habit_id == habit.id && l.day_index == expected_day)));
    }

    #[test]
    fn delete_task_list_moves_tasks_to_inbox_and_undo_restores_links() {
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        let list = c
            .create_task_list(TaskListInput {
                name: "University".into(),
                color_token: "accent".into(),
                icon_key: None,
                sort_order: 0,
            })
            .unwrap();
        let task = c
            .create_task(TaskInput {
                list_id: Some(list.id.clone()),
                title: "Read chapter 3".into(),
                notes: String::new(),
                priority: TaskPriority::Medium,
                manual_quadrant: None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();
        assert_eq!(task.list_id.as_deref(), Some(list.id.as_str()));

        c.delete_task_list(&list.id).unwrap();
        assert_eq!(
            c.undo_status(),
            Some(UndoAction::DeleteTaskList {
                name: "University".into(),
            })
        );
        assert!(c.list_task_lists().unwrap().is_empty());
        let board = c.get_matrix_board(false).unwrap();
        let inbox_task = board.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(inbox_task.list_id, None);
        assert_eq!(inbox_task.list_name, None);

        c.undo().unwrap();
        let lists = c.list_task_lists().unwrap();
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].id, list.id);
        let board_restored = c.get_matrix_board(false).unwrap();
        let restored_task = board_restored
            .tasks
            .iter()
            .find(|t| t.id == task.id)
            .unwrap();
        assert_eq!(restored_task.list_id.as_deref(), Some(list.id.as_str()));
        assert_eq!(restored_task.list_name.as_deref(), Some("University"));
    }

    #[test]
    fn restore_matrix_defaults_preserves_ids_and_marks_dirty() {
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        c.save_matrix_quadrant(MatrixQuadrantDto {
            quadrant_key: QuadrantKey::Q1,
            title: "Custom Q1".into(),
            color_token: "accent".into(),
            group_by: MatrixGroupBy::Tag,
            sort_by: MatrixSortBy::Title,
            rule: QuadrantRule {
                lists: MatrixListFilter::Inbox,
                date_filters: None,
                priorities: None,
                types: None,
                pinned_deck_ids: vec![],
                excluded_deck_ids: vec![],
            },
        })
        .unwrap();

        let restored = c.restore_matrix_defaults(Some(QuadrantKey::Q1)).unwrap();
        let q1_dto = restored
            .iter()
            .find(|q| q.quadrant_key == QuadrantKey::Q1)
            .unwrap();
        assert_eq!(q1_dto.title, "");
        assert_eq!(q1_dto.color_token, "danger");
        assert_eq!(q1_dto.group_by, MatrixGroupBy::None);
        assert_eq!(q1_dto.sort_by, MatrixSortBy::Date);

        let raw_q1 = c
            .storage()
            .list_matrix_quadrants(NIL_USER_ID)
            .unwrap()
            .into_iter()
            .find(|q| q.quadrant_key == QuadrantKey::Q1)
            .unwrap();
        assert_eq!(
            raw_q1.id,
            entity_id_v5("matrix_quadrant", NIL_USER_ID, "q1")
        );
        assert_eq!(raw_q1.deleted_at, None);
        assert_eq!(raw_q1.usn, -1);
    }

    #[test]
    fn task_daily_cap_of_ten_and_reopen_recomplete_same_day_does_not_double_count() {
        let now_ms = 1_795_341_600_000_i64;
        let clock = Arc::new(TestClock::new(now_ms));
        let c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();

        let priorities = [
            TaskPriority::High,
            TaskPriority::Medium,
            TaskPriority::Low,
            TaskPriority::None,
        ];
        let mut task_ids = Vec::new();
        for idx in 0..12 {
            let task = c
                .create_task(TaskInput {
                    list_id: None,
                    title: format!("Task {idx}"),
                    notes: String::new(),
                    priority: priorities[idx % priorities.len()],
                    manual_quadrant: None,
                    due_date: None,
                    scheduled_start_ms: None,
                    scheduled_end_ms: None,
                    tags: vec![],
                    deck_id: None,
                    sort_order: idx as i32,
                })
                .unwrap();
            task_ids.push(task.id);
        }

        // Complete first 10 tasks across all priorities: flat 10 XP / 100 gold_cents each.
        for (i, tid) in task_ids[..10].iter().enumerate() {
            clock.set(now_ms + (i as i64) * 1_000);
            c.complete_task(tid).unwrap();
        }
        let s10 = c.progress_summary().unwrap();
        assert_eq!(s10.total_xp, 100);
        let quest_gold: u64 = {
            let m = c.get_motivation_state().unwrap();
            m.daily_quests
                .iter()
                .chain(std::iter::once(&m.weekly_quest))
                .filter(|q| q.completed)
                .map(|q| q.reward_gold_cents)
                .sum()
        };
        assert_eq!(s10.gold_cents, 1_000 + quest_gold);
        assert_eq!(s10.today_xp, 100);
        assert_eq!(s10.tasks_rewarded_today, 10);
        assert_eq!(s10.task_reward_daily_cap, 10);

        // 11th completion succeeds but earns 0 XP / 0 gold_cents.
        c.complete_task(&task_ids[10]).unwrap();
        let s11 = c.progress_summary().unwrap();
        assert_eq!(s11.total_xp, 100);
        assert_eq!(s11.tasks_rewarded_today, 10);

        // Reopen task #3 -> drops active count to 9 (90 XP); re-completing returns to 10 (100 XP), never 11.
        c.reopen_task(&task_ids[2]).unwrap();
        let s_reopened = c.progress_summary().unwrap();
        assert_eq!(s_reopened.total_xp, 90);
        assert_eq!(s_reopened.tasks_rewarded_today, 9);

        c.complete_task(&task_ids[2]).unwrap();
        let s_recompleted = c.progress_summary().unwrap();
        assert_eq!(s_recompleted.total_xp, 100);
        assert_eq!(s_recompleted.tasks_rewarded_today, 10);

        // Reopen task #4, complete #12 to fill 10th slot, then re-complete #4 -> no reward for #4.
        c.reopen_task(&task_ids[3]).unwrap();
        c.complete_task(&task_ids[11]).unwrap();
        assert_eq!(c.progress_summary().unwrap().tasks_rewarded_today, 10);
        c.complete_task(&task_ids[3]).unwrap();
        let s_blocked = c.progress_summary().unwrap();
        assert_eq!(s_blocked.total_xp, 100);
        assert_eq!(s_blocked.tasks_rewarded_today, 10);
    }

    #[test]
    fn habit_backlogging_today_and_yesterday_reward_older_days_save_without_reward() {
        let day0_ms = 1_794_601_800_000_i64; // 2026-11-13 23:30 UTC+3
        let day3_ms = day0_ms + 3 * crate::progress::MS_PER_DAY;
        let clock = Arc::new(TestClock::new(day3_ms));
        let mut c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();
        c.created_ms = day0_ms;
        c.set_local_offset_minutes(180);

        let today = c.today();
        assert_eq!(today, 3);

        let habit = c
            .create_habit(HabitInput {
                title: "Read paper".into(),
                notes: String::new(),
                icon_key: "book".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::ReachAmount,
                goal_target: 20.0,
                goal_unit: "min".into(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();

        // Partial log on today -> no reward.
        let partial = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: Some(today),
                logged_value: 10.0,
                status: HabitLogStatus::Logged,
                mood: None,
                note: String::new(),
            })
            .unwrap();
        assert!(!partial.completed);
        assert_eq!(c.progress_summary().unwrap().total_xp, 0);

        // Completing today and yesterday -> +10 XP / +100 gold_cents each.
        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today),
            logged_value: 20.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().today_xp, 10);

        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today - 1),
            logged_value: 25.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        let after_yesterday = c.progress_summary().unwrap();
        assert_eq!(after_yesterday.total_xp, 20);
        assert_eq!(after_yesterday.today_xp, 20);

        // Older day (today - 2) and future day (today + 1) save without reward.
        let old = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: Some(today - 2),
                logged_value: 20.0,
                status: HabitLogStatus::Logged,
                mood: None,
                note: String::new(),
            })
            .unwrap();
        assert!(old.completed);
        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today + 1),
            logged_value: 20.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 20);
    }

    #[test]
    fn deck_linked_habit_autofills_from_revlog_ignores_manual_value_and_revokes_on_card_undo() {
        let now_ms = 1_795_341_600_000_i64;
        let storage = FakeStorage::default();
        storage
            .decks
            .lock()
            .unwrap()
            .push(crate::collection::fake_storage::deck(
                10, "Biology", None, false,
            ));
        for cid in [101_i64, 102] {
            storage.cards.lock().unwrap().push(crate::model::Card {
                id: cid,
                note_id: cid,
                deck_id: 10,
                ord: 0,
                mod_ms: 0,
                usn: -1,
                ctype: 0,
                queue: 0,
                due: 0,
                interval: 0,
                ease_factor: 2500,
                reps: 0,
                lapses: 0,
                remaining: 0,
                original_due: 0,
                original_deck_id: 0,
                flags: 0,
                fsrs_stability: None,
                fsrs_difficulty: None,
                fsrs_last_review: None,
                data: None,
            });
        }

        let clock = Arc::new(TestClock::new(now_ms));
        let c = Collection::new(Box::new(storage), clock.clone()).unwrap();

        let habit = c
            .create_habit(HabitInput {
                title: "Bio cards".into(),
                notes: String::new(),
                icon_key: "layers".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::ReachAmount,
                goal_target: 2.0,
                goal_unit: "cards".into(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: Some(10),
                sort_order: 0,
            })
            .unwrap();

        let prev = crate::scheduling::CardState::new(2500);
        let next = crate::scheduling::CardState {
            phase: crate::scheduling::CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        let log1 = crate::model::Revlog {
            id: now_ms,
            card_id: 101,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 0,
        };
        c.apply_answer(101, 101, &prev, 0, &next, 1, &log1, 8)
            .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 3);

        // Manual log_habit ignores caller's logged_value (keeps revlog count = 1.0) while saving mood/note.
        let manual = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: None,
                logged_value: 99.0,
                status: HabitLogStatus::Logged,
                mood: Some(4),
                note: "Warmup".into(),
            })
            .unwrap();
        assert_eq!(manual.logged_value, 1.0);
        assert!(!manual.completed);
        assert_eq!(manual.mood, Some(4));
        assert_eq!(manual.note, "Warmup");
        assert_eq!(c.progress_summary().unwrap().total_xp, 3);

        // Second card answer reaches target=2 -> grants 3 XP card + 10 XP habit bonus (+100 gold_cents).
        clock.set(now_ms + 5_000);
        let log2 = crate::model::Revlog {
            id: now_ms + 5_000,
            card_id: 102,
            ..log1
        };
        c.apply_answer(102, 102, &prev, 0, &next, 1, &log2, 8)
            .unwrap();
        let after_second = c.progress_summary().unwrap();
        assert_eq!(after_second.total_xp, 16);
        assert_eq!(after_second.gold_cents, 150);

        // Card undo drops revlog count to 1 -> habit becomes incomplete & revokes 10 XP + 100 gold_cents.
        c.undo().unwrap();
        let board = c.get_habit_board(None, None).unwrap();
        let h_log = board.logs.iter().find(|l| l.habit_id == habit.id).unwrap();
        assert_eq!(h_log.logged_value, 1.0);
        assert!(!h_log.completed);
        let after_undo = c.progress_summary().unwrap();
        assert_eq!(after_undo.total_xp, 3);
        assert_eq!(after_undo.gold_cents, 25);
    }

    #[test]
    fn deck_linked_autofill_is_idempotent_and_emits_no_event_when_unchanged() {
        let now_ms = 1_795_341_600_000_i64;
        let storage = FakeStorage::default();
        storage
            .decks
            .lock()
            .unwrap()
            .push(crate::collection::fake_storage::deck(
                10, "Biology", None, false,
            ));
        let c = Collection::new(Box::new(storage), Arc::new(FixedClock(now_ms))).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        c.events().subscribe(move |ev| {
            captured.lock().unwrap().push(ev.clone());
        });

        let habit = c
            .create_habit(HabitInput {
                title: "Bio cards".into(),
                notes: String::new(),
                icon_key: "layers".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::ReachAmount,
                goal_target: 5.0,
                goal_unit: "cards".into(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: Some(10),
                sort_order: 0,
            })
            .unwrap();

        let _ = c.get_habit_board(None, None).unwrap();
        events.lock().unwrap().clear();

        // Calling get_habit_board again with unchanged revlogs emits zero ProductivityChanged events.
        let b2 = c.get_habit_board(None, None).unwrap();
        assert!(b2.habits.iter().any(|h| h.id == habit.id));
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .all(|e| !matches!(e, DomainEvent::ProductivityChanged)));
    }

    #[test]
    fn yesterday_summary_shows_once_per_day_and_skips_inactive_days() {
        let day0_ms = 1_794_601_800_000_i64;
        let clock = Arc::new(TestClock::new(day0_ms));
        let mut c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();
        c.created_ms = day0_ms;

        // Day 0 -> no yesterday.
        assert_eq!(c.yesterday_summary().unwrap(), None);

        // Day 1 after inactive Day 0 -> None, writes nothing to sync_state.
        clock.set(day0_ms + crate::progress::MS_PER_DAY);
        assert_eq!(c.yesterday_summary().unwrap(), None);
        assert_eq!(
            c.storage()
                .get_sync_state(crate::progress::YESTERDAY_SUMMARY_SEEN_KEY)
                .unwrap(),
            None
        );

        // Complete a task on Day 1, then advance to Day 2 -> Some once.
        let task = c
            .create_task(TaskInput {
                list_id: None,
                title: "Yesterday task".into(),
                notes: String::new(),
                priority: TaskPriority::Medium,
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

        clock.set(day0_ms + 2 * crate::progress::MS_PER_DAY);
        let summary = c
            .yesterday_summary()
            .unwrap()
            .expect("active yesterday should return summary");
        assert_eq!(summary.day, 1);
        assert_eq!(summary.tasks_completed, 1);
        assert_eq!(summary.xp, 10);
        assert_eq!(summary.gold_cents, 100);

        // Dismiss for Day 2 -> disappears immediately, reappears if Day 2 is active and Day 3 arrives.
        c.dismiss_yesterday_summary(2).unwrap();
        assert_eq!(c.yesterday_summary().unwrap(), None);
    }

    #[test]
    fn matrix_board_drops_child_deck_when_parent_is_in_same_quadrant() {
        let storage = FakeStorage::default();
        storage.decks.lock().unwrap().extend([
            crate::collection::fake_storage::deck(1, "Spanish", None, false),
            crate::collection::fake_storage::deck(2, "Spanish::Verbs", Some(1), false),
            crate::collection::fake_storage::deck(3, "Filtered", None, true),
        ]);
        {
            let mut counts = storage.due_counts.lock().unwrap();
            counts.insert(1, (0, 0, 1));
            counts.insert(2, (0, 0, 2));
            counts.insert(3, (0, 0, 5));
        }

        let c =
            Collection::new(Box::new(storage), Arc::new(FixedClock(1_795_341_600_000))).unwrap();
        let board = c.get_matrix_board(false).unwrap();
        let ids: Vec<i64> = board.deck_due_items.iter().map(|d| d.deck_id).collect();
        assert_eq!(ids, vec![1]);
        assert_eq!(board.deck_due_items[0].due_count, 3);
    }

    #[test]
    fn matrix_board_keeps_child_deck_when_rule_puts_it_in_different_quadrant() {
        let storage = FakeStorage::default();
        storage.decks.lock().unwrap().extend([
            crate::collection::fake_storage::deck(1, "Spanish", None, false),
            crate::collection::fake_storage::deck(2, "Spanish::Verbs", Some(1), false),
        ]);
        {
            let mut counts = storage.due_counts.lock().unwrap();
            counts.insert(1, (0, 0, 1));
            counts.insert(2, (0, 0, 2));
        }

        let c =
            Collection::new(Box::new(storage), Arc::new(FixedClock(1_795_341_600_000))).unwrap();
        // Put child deck (id=2) specifically into Q2, while parent (id=1) stays in Q1.
        c.save_matrix_quadrant(MatrixQuadrantDto {
            quadrant_key: QuadrantKey::Q1,
            title: String::new(),
            color_token: "danger".into(),
            group_by: MatrixGroupBy::None,
            sort_by: MatrixSortBy::Date,
            rule: QuadrantRule {
                lists: MatrixListFilter::Custom {
                    list_ids: vec![],
                    deck_ids: vec![1],
                },
                date_filters: None,
                priorities: None,
                types: None,
                pinned_deck_ids: vec![],
                excluded_deck_ids: vec![],
            },
        })
        .unwrap();
        c.save_matrix_quadrant(MatrixQuadrantDto {
            quadrant_key: QuadrantKey::Q2,
            title: String::new(),
            color_token: "warning".into(),
            group_by: MatrixGroupBy::None,
            sort_by: MatrixSortBy::Date,
            rule: QuadrantRule {
                lists: MatrixListFilter::Custom {
                    list_ids: vec![],
                    deck_ids: vec![2],
                },
                date_filters: None,
                priorities: None,
                types: None,
                pinned_deck_ids: vec![],
                excluded_deck_ids: vec![],
            },
        })
        .unwrap();

        let board = c.get_matrix_board(false).unwrap();
        let pairs: Vec<(i64, QuadrantKey)> = board
            .deck_due_items
            .iter()
            .map(|d| (d.deck_id, d.quadrant_key))
            .collect();
        assert_eq!(pairs, vec![(1, QuadrantKey::Q1), (2, QuadrantKey::Q2)]);
    }

    #[test]
    fn matrix_board_parent_with_no_own_due_cards_rolls_up_child_and_lists_only_parent() {
        let storage = FakeStorage::default();
        storage.decks.lock().unwrap().extend([
            crate::collection::fake_storage::deck(1, "Spanish", None, false),
            crate::collection::fake_storage::deck(2, "Spanish::Verbs", Some(1), false),
        ]);
        {
            let mut counts = storage.due_counts.lock().unwrap();
            counts.insert(2, (0, 0, 2));
        }

        let c =
            Collection::new(Box::new(storage), Arc::new(FixedClock(1_795_341_600_000))).unwrap();
        let board = c.get_matrix_board(false).unwrap();
        let ids: Vec<i64> = board.deck_due_items.iter().map(|d| d.deck_id).collect();
        assert_eq!(ids, vec![1]);
        assert_eq!(board.deck_due_items[0].due_count, 2);
    }

    #[test]
    fn move_deck_due_to_q2_via_pinned_rule_persists_and_preserves_inbox_tasks() {
        let storage = FakeStorage::default();
        storage.decks.lock().unwrap().extend([
            crate::collection::fake_storage::deck(1, "Default", None, false),
            crate::collection::fake_storage::deck(2, "Biology", None, false),
        ]);
        {
            let mut counts = storage.due_counts.lock().unwrap();
            counts.insert(1, (0, 0, 2));
            counts.insert(2, (0, 0, 4));
        }

        let c =
            Collection::new(Box::new(storage), Arc::new(FixedClock(1_795_341_600_000))).unwrap();
        let inbox_q1 = c
            .create_task(TaskInput {
                list_id: None,
                title: "Inbox high today".into(),
                notes: String::new(),
                priority: TaskPriority::High,
                manual_quadrant: None,
                due_date: Some("2026-11-22".into()),
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();
        let inbox_q2 = c
            .create_task(TaskInput {
                list_id: None,
                title: "Inbox medium".into(),
                notes: String::new(),
                priority: TaskPriority::Medium,
                manual_quadrant: None,
                due_date: None,
                scheduled_start_ms: None,
                scheduled_end_ms: None,
                tags: vec![],
                deck_id: None,
                sort_order: 1,
            })
            .unwrap();

        let initial = c.get_matrix_board(false).unwrap();
        let mut q1 = initial
            .quadrants
            .iter()
            .find(|q| q.quadrant_key == QuadrantKey::Q1)
            .unwrap()
            .clone();
        let mut q2 = initial
            .quadrants
            .iter()
            .find(|q| q.quadrant_key == QuadrantKey::Q2)
            .unwrap()
            .clone();

        q1.rule.excluded_deck_ids.push(2);
        q2.rule.pinned_deck_ids.push(2);
        c.save_matrix_quadrant(q1).unwrap();
        c.save_matrix_quadrant(q2).unwrap();

        let board = c.get_matrix_board(false).unwrap();
        assert_eq!(
            board
                .deck_due_items
                .iter()
                .find(|d| d.deck_id == 1)
                .map(|d| d.quadrant_key),
            Some(QuadrantKey::Q1)
        );
        assert_eq!(
            board
                .deck_due_items
                .iter()
                .find(|d| d.deck_id == 2)
                .map(|d| d.quadrant_key),
            Some(QuadrantKey::Q2)
        );
        assert_eq!(
            board
                .tasks
                .iter()
                .find(|t| t.id == inbox_q1.id)
                .and_then(|t| t.effective_quadrant),
            Some(QuadrantKey::Q1)
        );
        assert_eq!(
            board
                .tasks
                .iter()
                .find(|t| t.id == inbox_q2.id)
                .and_then(|t| t.effective_quadrant),
            Some(QuadrantKey::Q2)
        );
    }

    #[test]
    fn complete_task_on_already_done_task_is_a_noop() {
        let day1_ms = 1_795_341_600_000_i64;
        let clock = Arc::new(TestClock::new(day1_ms));
        let c = Collection::new(Box::new(FakeStorage::default()), clock.clone()).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        c.events().subscribe(move |ev| {
            captured.lock().unwrap().push(ev.clone());
        });

        let task = c
            .create_task(TaskInput {
                list_id: None,
                title: "Already done".into(),
                notes: String::new(),
                priority: TaskPriority::Medium,
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
        let done_day = c.today();
        let expected_undo = Some(UndoAction::CompleteTask {
            title: "Already done".into(),
        });
        assert_eq!(c.undo_status(), expected_undo);

        // Advance one day and create a fresh undo step by renaming/completing another action,
        // or clear events and verify undo_status is unchanged (by checking undo stack depth via undo).
        clock.advance_ms(crate::progress::MS_PER_DAY);
        events.lock().unwrap().clear();

        c.complete_task(&task.id).unwrap();

        let board = c.get_matrix_board(true).unwrap();
        let done = board.tasks.iter().find(|t| t.id == task.id).unwrap();
        assert_eq!(done.completed_day, Some(done_day));
        assert_eq!(done.completed_at, Some(day1_ms));
        assert_eq!(c.progress_summary().unwrap().tasks_rewarded_today, 0);
        assert!(events
            .lock()
            .unwrap()
            .iter()
            .all(|e| !matches!(e, DomainEvent::ProductivityChanged)));
        assert_eq!(c.undo_status(), expected_undo);
        // Only one undo entry should exist for the single completion.
        c.undo().unwrap();
        assert_eq!(c.undo_status(), None);
    }

    #[test]
    fn skipped_habit_bridges_streak_without_reward() {
        let day0_ms = 1_794_601_800_000_i64;
        let day3_ms = day0_ms + 3 * crate::progress::MS_PER_DAY;
        let clock = Arc::new(TestClock::new(day3_ms));
        let mut c = Collection::new(Box::new(FakeStorage::default()), clock).unwrap();
        c.created_ms = day0_ms;
        c.set_local_offset_minutes(180);

        let habit = c
            .create_habit(HabitInput {
                title: "Read".into(),
                notes: String::new(),
                icon_key: "book".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::AchieveAll,
                goal_target: 1.0,
                goal_unit: String::new(),
                start_date: Some(crate::ipc::epoch_days_to_date_string(
                    c.local_day_index(day0_ms),
                )),
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();

        let today = c.today();
        // Day 0 completed, Day 1 skipped (even with non-zero caller logged_value -> coerced to 0/false),
        // Day 2 completed, Day 3 (today) completed -> streak = 3 (day 1 bridged without incrementing).
        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today - 3),
            logged_value: 1.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        let skipped = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: Some(today - 2),
                logged_value: 1.0,
                status: HabitLogStatus::Skipped,
                mood: None,
                note: "Sick day".into(),
            })
            .unwrap();
        assert_eq!(skipped.status, HabitLogStatus::Skipped);
        assert_eq!(skipped.logged_value, 0.0);
        assert!(!skipped.completed);

        // Complete today, then skip today -> reward granted then soft-revoked atomically.
        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today - 1),
            logged_value: 1.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 10);

        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today),
            logged_value: 1.0,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
        })
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 20);

        let board = c.get_habit_board(None, None).unwrap();
        assert_eq!(board.habits[0].current_streak, 3);

        // Skipping today revokes today's reward and preserves the prior 2-day streak.
        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: Some(today),
            logged_value: 1.0,
            status: HabitLogStatus::Skipped,
            mood: None,
            note: "Rest".into(),
        })
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 10);
        let board2 = c.get_habit_board(None, None).unwrap();
        assert_eq!(board2.habits[0].current_streak, 2);
        let today_ring = board2
            .week_days
            .iter()
            .find(|r| r.day_index == today)
            .unwrap();
        assert_eq!(today_ring.scheduled_count, 0);
        assert_eq!(today_ring.excused_count, 1);
    }

    #[test]
    fn frozen_habit_rejected_when_no_tokens_available() {
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        let habit = c
            .create_habit(HabitInput {
                title: "Daily".into(),
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

        let err = c
            .log_habit(HabitLogInput {
                habit_id: habit.id,
                day_index: None,
                logged_value: 0.0,
                status: HabitLogStatus::Frozen,
                mood: None,
                note: String::new(),
            })
            .unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)));
        assert!(err
            .to_string()
            .contains("no streak freeze tokens available"));
    }

    #[test]
    fn deck_linked_auto_sync_preserves_skip_below_target() {
        let now_ms = 1_795_341_600_000_i64;
        let storage = FakeStorage::default();
        storage
            .decks
            .lock()
            .unwrap()
            .push(crate::collection::fake_storage::deck(
                10, "Biology", None, false,
            ));
        storage.cards.lock().unwrap().push(crate::model::Card {
            id: 101,
            note_id: 101,
            deck_id: 10,
            ord: 0,
            mod_ms: 0,
            usn: -1,
            ctype: 0,
            queue: 0,
            due: 0,
            interval: 0,
            ease_factor: 2500,
            reps: 0,
            lapses: 0,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        });
        let c = Collection::new(Box::new(storage), Arc::new(TestClock::new(now_ms))).unwrap();

        let habit = c
            .create_habit(HabitInput {
                title: "Bio cards".into(),
                notes: String::new(),
                icon_key: "layers".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::ReachAmount,
                goal_target: 3.0,
                goal_unit: "cards".into(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: Some(10),
                sort_order: 0,
            })
            .unwrap();

        // User skips today even after 1 card review (< target 3).
        let prev = crate::scheduling::CardState::new(2500);
        let next = crate::scheduling::CardState {
            phase: crate::scheduling::CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        let rev = crate::model::Revlog {
            id: now_ms,
            card_id: 101,
            usn: -1,
            ease: 3,
            interval: 1,
            last_interval: 0,
            ease_factor: 2500,
            taken_ms: 1000,
            review_kind: 0,
        };
        c.apply_answer(101, 101, &prev, 0, &next, 1, &rev, 8)
            .unwrap();

        let skip_log = c
            .log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: None,
                logged_value: 0.0,
                status: HabitLogStatus::Skipped,
                mood: None,
                note: "Rotation shift".into(),
            })
            .unwrap();
        assert_eq!(skip_log.status, HabitLogStatus::Skipped);
        assert_eq!(skip_log.logged_value, 0.0);

        // Answering a second card (2 < 3) still preserves the skip.
        let rev2 = crate::model::Revlog {
            id: now_ms + 1_000,
            ..rev
        };
        c.apply_answer(101, 101, &prev, 0, &next, 1, &rev2, 8)
            .unwrap();
        let board = c.get_habit_board(None, None).unwrap();
        let log = board.logs.iter().find(|l| l.habit_id == habit.id).unwrap();
        assert_eq!(log.status, HabitLogStatus::Skipped);
        assert_eq!(log.logged_value, 0.0);
        assert!(!log.completed);
    }

    #[test]
    fn deck_linked_auto_sync_promotes_skip_at_goal() {
        let now_ms = 1_795_341_600_000_i64;
        let storage = FakeStorage::default();
        storage
            .decks
            .lock()
            .unwrap()
            .push(crate::collection::fake_storage::deck(
                10, "Biology", None, false,
            ));
        storage.cards.lock().unwrap().push(crate::model::Card {
            id: 101,
            note_id: 101,
            deck_id: 10,
            ord: 0,
            mod_ms: 0,
            usn: -1,
            ctype: 0,
            queue: 0,
            due: 0,
            interval: 0,
            ease_factor: 2500,
            reps: 0,
            lapses: 0,
            remaining: 0,
            original_due: 0,
            original_deck_id: 0,
            flags: 0,
            fsrs_stability: None,
            fsrs_difficulty: None,
            fsrs_last_review: None,
            data: None,
        });
        let c = Collection::new(Box::new(storage), Arc::new(TestClock::new(now_ms))).unwrap();

        let habit = c
            .create_habit(HabitInput {
                title: "Bio cards".into(),
                notes: String::new(),
                icon_key: "layers".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::ReachAmount,
                goal_target: 2.0,
                goal_unit: "cards".into(),
                start_date: None,
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: Some(10),
                sort_order: 0,
            })
            .unwrap();

        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: None,
            logged_value: 0.0,
            status: HabitLogStatus::Skipped,
            mood: None,
            note: "Thought I'd rest".into(),
        })
        .unwrap();

        let prev = crate::scheduling::CardState::new(2500);
        let next = crate::scheduling::CardState {
            phase: crate::scheduling::CardPhase::Review,
            interval_days: 1,
            reps: 1,
            ..prev
        };
        for offset in [0_i64, 1_000] {
            let rev = crate::model::Revlog {
                id: now_ms + offset,
                card_id: 101,
                usn: -1,
                ease: 3,
                interval: 1,
                last_interval: 0,
                ease_factor: 2500,
                taken_ms: 1000,
                review_kind: 0,
            };
            c.apply_answer(101, 101, &prev, 0, &next, 1, &rev, 8)
                .unwrap();
        }

        let board = c.get_habit_board(None, None).unwrap();
        let log = board.logs.iter().find(|l| l.habit_id == habit.id).unwrap();
        assert_eq!(log.status, HabitLogStatus::Logged);
        assert_eq!(log.logged_value, 2.0);
        assert!(log.completed);
        assert_eq!(log.note, "Thought I'd rest");
        // 3 XP card + 10 XP habit reward (card_id 101 reviewed once per day = 3 XP).
        assert_eq!(c.progress_summary().unwrap().total_xp, 13);
    }

    #[test]
    fn get_habit_history_computes_stats_and_notes() {
        let day0_ms = 1_794_601_800_000_i64;
        let day4_ms = day0_ms + 4 * crate::progress::MS_PER_DAY;
        let clock = Arc::new(TestClock::new(day4_ms));
        let mut c = Collection::new(Box::new(FakeStorage::default()), clock).unwrap();
        c.created_ms = day0_ms;
        c.set_local_offset_minutes(180);

        let habit = c
            .create_habit(HabitInput {
                title: "Hydrate".into(),
                notes: String::new(),
                icon_key: "droplet".into(),
                color_token: "accent".into(),
                frequency_kind: HabitFrequencyKind::Daily,
                weekdays: vec![],
                weekly_target: None,
                interval_days: None,
                goal_mode: HabitGoalMode::AchieveAll,
                goal_target: 1.0,
                goal_unit: String::new(),
                start_date: Some(crate::ipc::epoch_days_to_date_string(
                    c.local_day_index(day0_ms),
                )),
                target_days: None,
                section: HabitSection::Morning,
                reminders: vec![],
                auto_popup_log: false,
                deck_id: None,
                sort_order: 0,
            })
            .unwrap();

        // Day 0..1 completed (streak 2), Day 2 missed, Day 3 skipped, Day 4 (today) completed.
        // Window is 5 scheduled days (0..=4), 1 skipped -> denom = 4, completed = 3 -> 75.0%.
        // Longest streak = 2 (days 0..1), current streak = 1 (day 4, day 3 skipped, day 2 missed).
        for (day, status, mood, note) in [
            (0, HabitLogStatus::Logged, Some(5), "Great"),
            (1, HabitLogStatus::Logged, None, ""),
            (3, HabitLogStatus::Skipped, Some(2), "Fever"),
            (4, HabitLogStatus::Logged, Some(4), "Back"),
        ] {
            c.log_habit(HabitLogInput {
                habit_id: habit.id.clone(),
                day_index: Some(day),
                logged_value: if status == HabitLogStatus::Logged {
                    1.0
                } else {
                    0.0
                },
                status,
                mood,
                note: note.into(),
            })
            .unwrap();
        }

        let hist = c.get_habit_history(&habit.id, Some(12), None).unwrap();
        assert_eq!(hist.today_day_index, 4);
        assert_eq!(hist.current_streak, 1);
        assert_eq!(hist.longest_streak, 2);
        assert_eq!(hist.completed_days, 3);
        assert_eq!(hist.skipped_days, 1);
        assert_eq!(hist.frozen_days, 0);
        assert!((hist.completion_rate_pct - 75.0).abs() < 1e-9);
        assert_eq!(hist.logs.len(), 4);
        assert_eq!(
            hist.logs.iter().map(|l| l.day_index).collect::<Vec<_>>(),
            vec![0, 1, 3, 4]
        );
        assert_eq!(hist.logs[2].note, "Fever");
    }

    #[test]
    fn list_archived_habits_returns_only_archived() {
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        let mk = |title: &str| HabitInput {
            title: title.into(),
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
        };
        let active = c.create_habit(mk("Active")).unwrap();
        let archived = c.create_habit(mk("Old routine")).unwrap();
        c.archive_habit(&archived.id, true).unwrap();

        let list = c.list_archived_habits().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, archived.id);
        assert!(list[0].archived_at.is_some());
        assert!(list.iter().all(|h| h.id != active.id));
    }

    #[test]
    fn undo_log_habit_restores_status() {
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        let habit = c
            .create_habit(HabitInput {
                title: "Practice".into(),
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

        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: None,
            logged_value: 0.0,
            status: HabitLogStatus::Skipped,
            mood: None,
            note: "Rest".into(),
        })
        .unwrap();

        c.log_habit(HabitLogInput {
            habit_id: habit.id.clone(),
            day_index: None,
            logged_value: 1.0,
            status: HabitLogStatus::Logged,
            mood: Some(5),
            note: "Done after all".into(),
        })
        .unwrap();
        assert_eq!(c.progress_summary().unwrap().total_xp, 10);

        c.undo().unwrap();
        let board = c.get_habit_board(None, None).unwrap();
        let restored = board.logs.iter().find(|l| l.habit_id == habit.id).unwrap();
        assert_eq!(restored.status, HabitLogStatus::Skipped);
        assert!(!restored.completed);
        assert_eq!(restored.logged_value, 0.0);
        assert_eq!(restored.note, "Rest");
        assert_eq!(c.progress_summary().unwrap().total_xp, 0);
    }

    #[test]
    fn reorder_tasks_rejects_oversized_input() {
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        let items: Vec<crate::productivity::TaskOrderItem> = (0
            ..=Collection::MAX_REORDER_TASKS_ITEMS)
            .map(|i| crate::productivity::TaskOrderItem {
                id: format!("22222222-2222-4222-8222-{i:012}"),
                sort_order: i as i32 * 10,
            })
            .collect();
        let err = c.reorder_tasks(items).unwrap_err();
        assert!(matches!(err, CoreError::Invalid(_)), "got {err:?}");
    }

    #[test]
    fn reschedule_overdue_rejects_bad_date() {
        // 2026-11-22 10:00 UTC -> today is 2026-11-22.
        let (c, _) = make_collection_with_events(1_795_341_600_000);
        for bad in ["not-a-date", "2026-02-30", "2026-13-01", "2026-11-21"] {
            let err = c.reschedule_overdue_tasks(bad).unwrap_err();
            assert!(
                matches!(err, CoreError::Invalid(_)),
                "expected Invalid for {bad:?}, got {err:?}"
            );
        }
        // Today and future dates remain valid.
        assert_eq!(c.reschedule_overdue_tasks("2026-11-22").unwrap(), 0);
        assert_eq!(c.reschedule_overdue_tasks("2026-11-23").unwrap(), 0);
    }
}
