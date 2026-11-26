//! Pure productivity domain model: task lists, tasks, Eisenhower matrix rules,
//! habits, habit logs, and local calendar recurrence (ADR-018).
//!
//! No IO, no database dependencies, and no system-clock reads.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use ts_rs::TS;

use crate::error::{CoreError, CoreResult};
use crate::ipc::epoch_days_to_date_string;
use crate::progress::MS_PER_DAY;

// ── Identifiers & Date Helpers ───────────────────────────────────────────────

/// Compute the deterministic RFC 4122 v5 (SHA-1) UUID for `(kind, user_id, natural_key)`.
///
/// Uses the same bit layout as [`crate::progress::ledger_id`] over
/// `"keepsake:{kind}:v1:{user_id}:{natural_key}"`.
pub fn entity_id_v5(kind: &str, user_id: &str, natural_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(b"keepsake:");
    hasher.update(kind.as_bytes());
    hasher.update(b":v1:");
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(natural_key.as_bytes());
    let digest = hasher.finalize();

    let mut b = [0_u8; 16];
    b.copy_from_slice(&digest[..16]);
    // RFC 4122 version 5 (name-based SHA-1)
    b[6] = (b[6] & 0x0f) | 0x50;
    // RFC 4122 variant (10xx)
    b[8] = (b[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3],
        b[4], b[5],
        b[6], b[7],
        b[8], b[9],
        b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

/// Validate lowercase hyphenated RFC 4122 UUID (`8-4-4-4-12` lowercase hex).
pub fn is_valid_uuid(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (i, &b) in bytes.iter().enumerate() {
        if matches!(i, 8 | 13 | 18 | 23) {
            if b != b'-' {
                return false;
            }
        } else if !matches!(b, b'0'..=b'9' | b'a'..=b'f') {
            return false;
        }
    }
    true
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

pub(crate) fn days_in_month(year: i64, month: u32) -> Option<u32> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 => Some(if is_leap_year(year) { 29 } else { 28 }),
        _ => None,
    }
}

/// Strictly parse `"YYYY-MM-DD"` into Unix epoch days (days since `1970-01-01`).
pub fn date_string_to_epoch_days(date: &str) -> CoreResult<i64> {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err(CoreError::Invalid(format!(
            "invalid calendar date '{date}': expected YYYY-MM-DD"
        )));
    }
    for (idx, &b) in bytes.iter().enumerate() {
        if idx != 4 && idx != 7 && !b.is_ascii_digit() {
            return Err(CoreError::Invalid(format!(
                "invalid calendar date '{date}': non-digit character"
            )));
        }
    }

    let year: i64 = date[0..4]
        .parse()
        .map_err(|_| CoreError::Invalid(format!("invalid year in date '{date}'")))?;
    let month: u32 = date[5..7]
        .parse()
        .map_err(|_| CoreError::Invalid(format!("invalid month in date '{date}'")))?;
    let day: u32 = date[8..10]
        .parse()
        .map_err(|_| CoreError::Invalid(format!("invalid day in date '{date}'")))?;

    let max_day = days_in_month(year, month)
        .ok_or_else(|| CoreError::Invalid(format!("invalid month in date '{date}'")))?;
    if day == 0 || day > max_day {
        return Err(CoreError::Invalid(format!(
            "invalid day in date '{date}': month {month} has {max_day} days"
        )));
    }

    // Howard Hinnant's civil-to-days algorithm (inverse of `epoch_days_to_date_string`).
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let m_adj = u64::from(if month > 2 { month - 3 } else { month + 9 });
    let doy = (153 * m_adj + 2) / 5 + u64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Ok(era * 146_097 + (doe as i64) - 719_468)
}

/// ISO weekday (`1 = Mon .. 7 = Sun`) for a Unix epoch day (`1970-01-01` was Thursday = `4`).
pub fn iso_weekday_from_epoch_days(epoch_days: i64) -> u8 {
    (epoch_days + 3).rem_euclid(7) as u8 + 1
}

/// Return `(year, month)` (`1..=12`) for a Unix epoch day.
pub fn epoch_days_to_year_month(epoch_days: i64) -> (i64, u32) {
    let z = epoch_days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m)
}

// ── Enums ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TaskPriority {
    High,
    Medium,
    Low,
    None,
}

impl TaskPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
            Self::None => "none",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "high" => Ok(Self::High),
            "medium" => Ok(Self::Medium),
            "low" => Ok(Self::Low),
            "none" => Ok(Self::None),
            _ => Err(CoreError::Invalid(format!("unknown priority '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum QuadrantKey {
    Q1,
    Q2,
    Q3,
    Q4,
}

impl QuadrantKey {
    /// Canonical string representation stored in SQLite (`"q1"`..`"q4"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Q1 => "q1",
            Self::Q2 => "q2",
            Self::Q3 => "q3",
            Self::Q4 => "q4",
        }
    }

    /// Parse `"q1"`..`"q4"`.
    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "q1" => Ok(Self::Q1),
            "q2" => Ok(Self::Q2),
            "q3" => Ok(Self::Q3),
            "q4" => Ok(Self::Q4),
            _ => Err(CoreError::Invalid(format!("unknown quadrant_key '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixGroupBy {
    None,
    Tag,
    List,
    Priority,
    Date,
}

impl MatrixGroupBy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Tag => "tag",
            Self::List => "list",
            Self::Priority => "priority",
            Self::Date => "date",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "none" => Ok(Self::None),
            "tag" => Ok(Self::Tag),
            "list" => Ok(Self::List),
            "priority" => Ok(Self::Priority),
            "date" => Ok(Self::Date),
            _ => Err(CoreError::Invalid(format!("unknown group_by '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixSortBy {
    Date,
    Priority,
    Title,
    Manual,
}

impl MatrixSortBy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Date => "date",
            Self::Priority => "priority",
            Self::Title => "title",
            Self::Manual => "manual",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "date" => Ok(Self::Date),
            "priority" => Ok(Self::Priority),
            "title" => Ok(Self::Title),
            "manual" => Ok(Self::Manual),
            _ => Err(CoreError::Invalid(format!("unknown sort_by '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixDateFilter {
    NoDate,
    Overdue,
    Today,
    Tomorrow,
    Next7Days,
    ThisMonth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixItemType {
    Task,
    DeckDue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "mode", rename_all = "snake_case")]
#[ts(export)]
pub enum MatrixListFilter {
    All,
    Inbox,
    Tasks,
    Custom {
        list_ids: Vec<String>,
        #[ts(type = "number[]")]
        deck_ids: Vec<i64>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct QuadrantRule {
    pub lists: MatrixListFilter,
    /// `None` = all dates; `Some(vec)` = non-empty predicate list.
    pub date_filters: Option<Vec<MatrixDateFilter>>,
    /// `None` = all priorities; `Some(vec)` = non-empty subset.
    pub priorities: Option<Vec<TaskPriority>>,
    /// `None` = all item types; `Some(vec)` = non-empty subset.
    pub types: Option<Vec<MatrixItemType>>,
    /// Study-drill deck IDs explicitly pinned into this quadrant (evaluated before
    /// general rule matching for `DeckDue` placement without altering task `lists` filtering).
    #[serde(default)]
    #[ts(type = "number[]")]
    pub pinned_deck_ids: Vec<i64>,
    /// Study-drill deck IDs explicitly excluded from this quadrant's `DeckDue` placement.
    #[serde(default)]
    #[ts(type = "number[]")]
    pub excluded_deck_ids: Vec<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitFrequencyKind {
    Daily,
    Weekdays,
    WeeklyCount,
    EveryNDays,
}

impl HabitFrequencyKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekdays => "weekdays",
            Self::WeeklyCount => "weekly_count",
            Self::EveryNDays => "every_n_days",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "daily" => Ok(Self::Daily),
            "weekdays" => Ok(Self::Weekdays),
            "weekly_count" => Ok(Self::WeeklyCount),
            "every_n_days" => Ok(Self::EveryNDays),
            _ => Err(CoreError::Invalid(format!("unknown frequency_kind '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitGoalMode {
    AchieveAll,
    ReachAmount,
}

impl HabitGoalMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AchieveAll => "achieve_all",
            Self::ReachAmount => "reach_amount",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "achieve_all" => Ok(Self::AchieveAll),
            "reach_amount" => Ok(Self::ReachAmount),
            _ => Err(CoreError::Invalid(format!("unknown goal_mode '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitSection {
    Morning,
    Afternoon,
    Night,
    Others,
}

impl HabitSection {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Morning => "morning",
            Self::Afternoon => "afternoon",
            Self::Night => "night",
            Self::Others => "others",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "morning" => Ok(Self::Morning),
            "afternoon" => Ok(Self::Afternoon),
            "night" => Ok(Self::Night),
            "others" => Ok(Self::Others),
            _ => Err(CoreError::Invalid(format!("unknown habit section '{s}'"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CalendarRecurrenceFreq {
    Daily,
    Weekly,
}

impl CalendarRecurrenceFreq {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
        }
    }

    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            _ => Err(CoreError::Invalid(format!(
                "unknown calendar recurrence_freq '{s}'"
            ))),
        }
    }
}

// ── Sync / Row Entities (mirrors SQLite rows 1:1) ────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskList {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color_token: String,
    pub icon_key: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskItem {
    pub id: String,
    pub user_id: String,
    pub list_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: TaskPriority,
    pub manual_quadrant: Option<QuadrantKey>,
    pub due_date: Option<String>,
    pub scheduled_start_ms: Option<i64>,
    pub scheduled_end_ms: Option<i64>,
    pub tags: Vec<String>,
    pub deck_id: Option<i64>,
    pub completed_at: Option<i64>,
    pub completed_day: Option<i32>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MatrixQuadrant {
    pub id: String,
    pub user_id: String,
    pub quadrant_key: QuadrantKey,
    pub title: String,
    pub color_token: String,
    pub group_by: MatrixGroupBy,
    pub sort_by: MatrixSortBy,
    pub rule: QuadrantRule,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Habit {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub notes: String,
    pub icon_key: String,
    pub color_token: String,
    pub frequency_kind: HabitFrequencyKind,
    pub weekdays: Vec<u8>,
    pub weekly_target: Option<u8>,
    pub interval_days: Option<u32>,
    pub goal_mode: HabitGoalMode,
    pub goal_target: f64,
    pub goal_unit: String,
    pub start_day_index: i32,
    pub target_days: Option<u32>,
    pub section: HabitSection,
    pub reminders: Vec<String>,
    pub auto_popup_log: bool,
    pub deck_id: Option<i64>,
    pub archived_at: Option<i64>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HabitLog {
    pub id: String,
    pub user_id: String,
    pub habit_id: String,
    pub day_index: i32,
    pub logged_value: f64,
    pub goal_target: f64,
    pub completed: bool,
    #[serde(default)]
    pub status: HabitLogStatus,
    pub mood: Option<u8>,
    pub note: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarRecurrence {
    pub freq: CalendarRecurrenceFreq,
    pub interval: u32,
    pub weekdays: Vec<u8>,
    pub until_date: Option<String>,
    pub count: Option<u32>,
    pub exdates: Vec<String>,
}

impl CalendarRecurrence {
    /// Format as an RFC 5545 `RRULE` value (`FREQ=...;INTERVAL=...[;BYDAY=...][;UNTIL=...|;COUNT=...]`).
    pub fn to_rrule(&self) -> String {
        let freq_str = match self.freq {
            CalendarRecurrenceFreq::Daily => "DAILY",
            CalendarRecurrenceFreq::Weekly => "WEEKLY",
        };
        let mut out = format!("FREQ={freq_str};INTERVAL={}", self.interval.max(1));
        if self.freq == CalendarRecurrenceFreq::Weekly && !self.weekdays.is_empty() {
            let mut sorted: BTreeSet<u8> = BTreeSet::new();
            for &wd in &self.weekdays {
                if (1..=7).contains(&wd) {
                    sorted.insert(wd);
                }
            }
            if !sorted.is_empty() {
                let byday: Vec<&'static str> = sorted
                    .into_iter()
                    .map(|wd| match wd {
                        1 => "MO",
                        2 => "TU",
                        3 => "WE",
                        4 => "TH",
                        5 => "FR",
                        6 => "SA",
                        _ => "SU",
                    })
                    .collect();
                out.push_str(";BYDAY=");
                out.push_str(&byday.join(","));
            }
        }
        if let Some(ref until) = self.until_date {
            out.push_str(";UNTIL=");
            out.push_str(&until.replace('-', ""));
        } else if let Some(count) = self.count {
            out.push_str(&format!(";COUNT={count}"));
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarEvent {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: String,
    pub location: String,
    pub color_token: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub is_all_day: bool,
    pub recurrence: Option<CalendarRecurrence>,
    pub linked_task_id: Option<String>,
    pub external_account_id: Option<String>,
    pub external_event_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub usn: i64,
}

// ── IPC Request & Response DTOs ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskListDto {
    pub id: String,
    pub name: String,
    pub color_token: String,
    pub icon_key: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskListInput {
    pub name: String,
    pub color_token: String,
    pub icon_key: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskDto {
    pub id: String,
    pub list_id: Option<String>,
    pub list_name: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: TaskPriority,
    pub manual_quadrant: Option<QuadrantKey>,
    pub effective_quadrant: Option<QuadrantKey>,
    pub due_date: Option<String>,
    #[ts(type = "number | null")]
    pub scheduled_start_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub scheduled_end_ms: Option<i64>,
    pub tags: Vec<String>,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub deck_name: Option<String>,
    #[ts(type = "number | null")]
    pub completed_at: Option<i64>,
    pub completed_day: Option<i32>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskInput {
    pub list_id: Option<String>,
    pub title: String,
    pub notes: String,
    pub priority: TaskPriority,
    pub manual_quadrant: Option<QuadrantKey>,
    pub due_date: Option<String>,
    #[ts(type = "number | null")]
    pub scheduled_start_ms: Option<i64>,
    #[ts(type = "number | null")]
    pub scheduled_end_ms: Option<i64>,
    pub tags: Vec<String>,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MatrixQuadrantDto {
    pub quadrant_key: QuadrantKey,
    pub title: String,
    pub color_token: String,
    pub group_by: MatrixGroupBy,
    pub sort_by: MatrixSortBy,
    pub rule: QuadrantRule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MatrixDeckDueItemDto {
    #[ts(type = "number")]
    pub deck_id: i64,
    pub deck_name: String,
    pub due_count: u32,
    pub quadrant_key: QuadrantKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MatrixBoardDto {
    pub today_date: String,
    pub quadrants: Vec<MatrixQuadrantDto>,
    pub tasks: Vec<TaskDto>,
    pub deck_due_items: Vec<MatrixDeckDueItemDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitDto {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub icon_key: String,
    pub color_token: String,
    pub frequency_kind: HabitFrequencyKind,
    pub weekdays: Vec<u8>,
    pub weekly_target: Option<u8>,
    pub interval_days: Option<u32>,
    pub goal_mode: HabitGoalMode,
    pub goal_target: f64,
    pub goal_unit: String,
    pub start_day_index: i32,
    pub start_date: String,
    pub target_days: Option<u32>,
    pub section: HabitSection,
    pub reminders: Vec<String>,
    pub auto_popup_log: bool,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub deck_name: Option<String>,
    #[ts(type = "number | null")]
    pub archived_at: Option<i64>,
    pub sort_order: i32,
    pub current_streak: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitInput {
    pub title: String,
    pub notes: String,
    pub icon_key: String,
    pub color_token: String,
    pub frequency_kind: HabitFrequencyKind,
    pub weekdays: Vec<u8>,
    pub weekly_target: Option<u8>,
    pub interval_days: Option<u32>,
    pub goal_mode: HabitGoalMode,
    pub goal_target: f64,
    pub goal_unit: String,
    /// ISO `"YYYY-MM-DD"`; `None` defaults to backend `today`.
    pub start_date: Option<String>,
    pub target_days: Option<u32>,
    pub section: HabitSection,
    pub reminders: Vec<String>,
    pub auto_popup_log: bool,
    #[ts(type = "number | null")]
    pub deck_id: Option<i64>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WeekStart {
    Sat,
    Sun,
    #[default]
    Mon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum HabitLogStatus {
    #[default]
    Logged,
    Skipped,
    Frozen,
}

impl HabitLogStatus {
    /// Canonical string stored in SQLite (`"logged" | "skipped" | "frozen"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Logged => "logged",
            Self::Skipped => "skipped",
            Self::Frozen => "frozen",
        }
    }

    /// Parse `"logged" | "skipped" | "frozen"`.
    pub fn parse(s: &str) -> CoreResult<Self> {
        match s {
            "logged" => Ok(Self::Logged),
            "skipped" => Ok(Self::Skipped),
            "frozen" => Ok(Self::Frozen),
            _ => Err(CoreError::Invalid(format!(
                "unknown habit log status '{s}'"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitLogDto {
    pub habit_id: String,
    pub day_index: i32,
    pub date: String,
    pub logged_value: f64,
    pub goal_target: f64,
    pub completed: bool,
    pub status: HabitLogStatus,
    pub mood: Option<u8>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitLogInput {
    pub habit_id: String,
    /// Collection day index; `None` defaults to `Collection::today()`.
    pub day_index: Option<i32>,
    pub logged_value: f64,
    #[serde(default)]
    #[ts(as = "Option<HabitLogStatus>", optional)]
    pub status: HabitLogStatus,
    pub mood: Option<u8>,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitDayRingDto {
    pub day_index: i32,
    pub date: String,
    pub scheduled_count: u32,
    pub completed_count: u32,
    pub excused_count: u32,
    /// `0.0 ..= 1.0` partial-aware completion ratio (`P_d`).
    pub completion_ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitHistoryDto {
    pub habit: HabitDto,
    pub today_day_index: i32,
    pub today_date: String,
    pub current_streak: u32,
    pub longest_streak: u32,
    pub completed_days: u32,
    pub skipped_days: u32,
    pub frozen_days: u32,
    /// `completed_days / max(1, scheduled_days_in_window - skipped_days - frozen_days) * 100.0`
    pub completion_rate_pct: f64,
    pub logs: Vec<HabitLogDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskOrderItem {
    pub id: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HabitBoardDto {
    pub today_day_index: i32,
    pub today_date: String,
    pub week_days: Vec<HabitDayRingDto>,
    pub habits: Vec<HabitDto>,
    pub logs: Vec<HabitLogDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarEventInput {
    pub title: String,
    pub description: String,
    pub location: String,
    pub color_token: String,
    #[ts(type = "number")]
    pub start_ms: i64,
    #[ts(type = "number")]
    pub end_ms: i64,
    pub is_all_day: bool,
    pub recurrence: Option<CalendarRecurrence>,
    pub linked_task_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalendarOccurrenceDto {
    pub event_id: String,
    pub occurrence_date: String,
    pub is_recurring: bool,
    pub title: String,
    pub description: String,
    pub location: String,
    pub color_token: String,
    #[ts(type = "number")]
    pub start_ms: i64,
    #[ts(type = "number")]
    pub end_ms: i64,
    pub is_all_day: bool,
    pub linked_task_id: Option<String>,
    pub recurrence: Option<CalendarRecurrence>,
}

// ── Internal Storage Helper Outcomes ─────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct HabitLogWriteOutcome {
    pub previous: Option<HabitLog>,
    pub current: HabitLog,
    pub reward_granted: bool,
    pub reward_revoked: bool,
}

// ── Validation Helpers ───────────────────────────────────────────────────────

/// Validate quadrant configuration (`title`, `color_token`, and [`QuadrantRule`]).
pub fn validate_quadrant_config(
    title: &str,
    color_token: &str,
    rule: &QuadrantRule,
) -> CoreResult<()> {
    if title.trim().chars().count() > 120 {
        return Err(CoreError::Invalid(
            "quadrant title must not exceed 120 characters".into(),
        ));
    }
    let trimmed_color = color_token.trim();
    if trimmed_color.is_empty() || color_token.len() > 32 {
        return Err(CoreError::Invalid(
            "quadrant color_token must be 1..=32 bytes".into(),
        ));
    }
    if let MatrixListFilter::Custom { list_ids, deck_ids } = &rule.lists {
        if list_ids.is_empty() && deck_ids.is_empty() {
            return Err(CoreError::Invalid(
                "custom list filter must include at least one list_id or deck_id".into(),
            ));
        }
        for id in list_ids {
            if !is_valid_uuid(id) {
                return Err(CoreError::Invalid(format!(
                    "invalid list_id UUID in custom quadrant filter: '{id}'"
                )));
            }
        }
    }
    if matches!(&rule.date_filters, Some(v) if v.is_empty()) {
        return Err(CoreError::Invalid(
            "date_filters must be None or a non-empty list".into(),
        ));
    }
    if matches!(&rule.priorities, Some(v) if v.is_empty()) {
        return Err(CoreError::Invalid(
            "priorities must be None or a non-empty list".into(),
        ));
    }
    if matches!(&rule.types, Some(v) if v.is_empty()) {
        return Err(CoreError::Invalid(
            "types must be None or a non-empty list".into(),
        ));
    }
    Ok(())
}

/// Validate and normalize [`TaskListInput`].
pub fn validate_task_list_input(mut input: TaskListInput) -> CoreResult<TaskListInput> {
    input.name = input.name.trim().to_string();
    if input.name.is_empty() {
        return Err(CoreError::Invalid("task list name cannot be empty".into()));
    }
    input.color_token = input.color_token.trim().to_string();
    if input.color_token.is_empty() || input.color_token.len() > 32 {
        return Err(CoreError::Invalid(
            "task list color_token must be 1..=32 bytes".into(),
        ));
    }
    Ok(input)
}

/// Validate and normalize [`TaskInput`].
pub fn validate_task_input(mut input: TaskInput) -> CoreResult<TaskInput> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() {
        return Err(CoreError::Invalid("task title cannot be empty".into()));
    }
    if let Some(ref lid) = input.list_id {
        if !is_valid_uuid(lid) {
            return Err(CoreError::Invalid(format!("invalid task list_id '{lid}'")));
        }
    }
    if let Some(ref due) = input.due_date {
        date_string_to_epoch_days(due)?;
    }
    match (input.scheduled_start_ms, input.scheduled_end_ms) {
        (Some(start), Some(end)) if end > start => {}
        (Some(_), Some(_)) => {
            return Err(CoreError::Invalid(
                "scheduled_end_ms must be greater than scheduled_start_ms".into(),
            ));
        }
        (None, None) => {}
        _ => {
            return Err(CoreError::Invalid(
                "scheduled_start_ms and scheduled_end_ms must both be set or both null".into(),
            ));
        }
    }
    input.tags = input
        .tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    Ok(input)
}

/// Validate and normalize [`HabitInput`].
pub fn validate_habit_input(mut input: HabitInput) -> CoreResult<HabitInput> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() {
        return Err(CoreError::Invalid("habit title cannot be empty".into()));
    }
    input.icon_key = input.icon_key.trim().to_string();
    if input.icon_key.is_empty() {
        input.icon_key = "check-circle".to_string();
    }
    input.color_token = input.color_token.trim().to_string();
    if input.color_token.is_empty() || input.color_token.len() > 32 {
        return Err(CoreError::Invalid(
            "habit color_token must be 1..=32 bytes".into(),
        ));
    }
    if !input.goal_target.is_finite() || input.goal_target <= 0.0 {
        return Err(CoreError::Invalid(
            "habit goal_target must be finite and > 0".into(),
        ));
    }
    if matches!(input.target_days, Some(0)) {
        return Err(CoreError::Invalid("habit target_days must be >= 1".into()));
    }
    if let Some(ref start_date) = input.start_date {
        date_string_to_epoch_days(start_date)?;
    }

    match input.frequency_kind {
        HabitFrequencyKind::Daily => {
            input.weekdays.clear();
            input.weekly_target = None;
            input.interval_days = None;
        }
        HabitFrequencyKind::Weekdays => {
            let mut set = BTreeSet::new();
            for &wd in &input.weekdays {
                if !(1..=7).contains(&wd) {
                    return Err(CoreError::Invalid(format!(
                        "weekday must be in 1..=7, got {wd}"
                    )));
                }
                set.insert(wd);
            }
            if set.is_empty() {
                return Err(CoreError::Invalid(
                    "weekdays frequency requires at least one weekday".into(),
                ));
            }
            input.weekdays = set.into_iter().collect();
            input.weekly_target = None;
            input.interval_days = None;
        }
        HabitFrequencyKind::WeeklyCount => {
            let target = input.weekly_target.ok_or_else(|| {
                CoreError::Invalid("weekly_count frequency requires weekly_target".into())
            })?;
            if !(1..=7).contains(&target) {
                return Err(CoreError::Invalid(
                    "weekly_target must be between 1 and 7".into(),
                ));
            }
            input.weekdays.clear();
            input.interval_days = None;
        }
        HabitFrequencyKind::EveryNDays => {
            let interval = input.interval_days.ok_or_else(|| {
                CoreError::Invalid("every_n_days frequency requires interval_days".into())
            })?;
            if interval == 0 {
                return Err(CoreError::Invalid("interval_days must be >= 1".into()));
            }
            input.weekdays.clear();
            input.weekly_target = None;
        }
    }

    Ok(input)
}

/// Validate [`HabitLogInput`].
pub fn validate_habit_log_input(input: &HabitLogInput) -> CoreResult<()> {
    if !is_valid_uuid(&input.habit_id) {
        return Err(CoreError::Invalid(format!(
            "invalid habit_id '{}'",
            input.habit_id
        )));
    }
    if !input.logged_value.is_finite() || input.logged_value < 0.0 {
        return Err(CoreError::Invalid(
            "logged_value must be finite and >= 0.0".into(),
        ));
    }
    if let Some(mood) = input.mood {
        if !(1..=5).contains(&mood) {
            return Err(CoreError::Invalid(
                "habit mood must be between 1 and 5".into(),
            ));
        }
    }
    Ok(())
}

/// Validate and normalize [`CalendarEventInput`].
pub fn validate_calendar_event_input(
    mut input: CalendarEventInput,
) -> CoreResult<CalendarEventInput> {
    input.title = input.title.trim().to_string();
    if input.title.is_empty() {
        return Err(CoreError::Invalid(
            "calendar event title cannot be empty".into(),
        ));
    }
    input.color_token = input.color_token.trim().to_string();
    if input.color_token.is_empty() || input.color_token.len() > 32 {
        return Err(CoreError::Invalid(
            "calendar event color_token must be 1..=32 bytes".into(),
        ));
    }
    if input.end_ms <= input.start_ms {
        return Err(CoreError::Invalid(
            "calendar event end_ms must be greater than start_ms".into(),
        ));
    }
    if input.is_all_day
        && (input.start_ms.rem_euclid(MS_PER_DAY) != 0 || input.end_ms.rem_euclid(MS_PER_DAY) != 0)
    {
        return Err(CoreError::Invalid(
            "all-day calendar events must align to UTC midnight".into(),
        ));
    }
    if let Some(ref tid) = input.linked_task_id {
        if !is_valid_uuid(tid) {
            return Err(CoreError::Invalid(format!(
                "invalid linked_task_id '{tid}'"
            )));
        }
    }
    if let Some(ref mut rec) = input.recurrence {
        if rec.interval == 0 {
            return Err(CoreError::Invalid(
                "recurrence interval must be >= 1".into(),
            ));
        }
        if rec.until_date.is_some() && rec.count.is_some() {
            return Err(CoreError::Invalid(
                "recurrence until_date and count are mutually exclusive".into(),
            ));
        }
        if matches!(rec.count, Some(0)) {
            return Err(CoreError::Invalid("recurrence count must be >= 1".into()));
        }
        if let Some(ref until) = rec.until_date {
            date_string_to_epoch_days(until)?;
        }
        for ex in &rec.exdates {
            date_string_to_epoch_days(ex)?;
        }
        let ex_set: BTreeSet<String> = rec.exdates.iter().cloned().collect();
        rec.exdates = ex_set.into_iter().collect();

        match rec.freq {
            CalendarRecurrenceFreq::Daily => {
                rec.weekdays.clear();
            }
            CalendarRecurrenceFreq::Weekly => {
                let mut wd_set = BTreeSet::new();
                for &wd in &rec.weekdays {
                    if !(1..=7).contains(&wd) {
                        return Err(CoreError::Invalid(format!(
                            "recurrence weekday must be 1..=7, got {wd}"
                        )));
                    }
                    wd_set.insert(wd);
                }
                if wd_set.is_empty() {
                    return Err(CoreError::Invalid(
                        "weekly calendar recurrence requires at least one weekday".into(),
                    ));
                }
                rec.weekdays = wd_set.into_iter().collect();
            }
        }
    }
    Ok(input)
}

// ── Matrix Defaults & Rule Evaluation ────────────────────────────────────────

/// Default [`QuadrantRule`] for one of the four Eisenhower quadrants (ADR-018 §2.5.3).
pub fn default_quadrant_rule(key: QuadrantKey) -> QuadrantRule {
    match key {
        QuadrantKey::Q1 => QuadrantRule {
            lists: MatrixListFilter::All,
            date_filters: Some(vec![
                MatrixDateFilter::Overdue,
                MatrixDateFilter::Today,
                MatrixDateFilter::Tomorrow,
            ]),
            priorities: Some(vec![TaskPriority::High]),
            types: None,
            pinned_deck_ids: vec![],
            excluded_deck_ids: vec![],
        },
        QuadrantKey::Q2 => QuadrantRule {
            lists: MatrixListFilter::All,
            date_filters: None,
            priorities: Some(vec![TaskPriority::High, TaskPriority::Medium]),
            types: None,
            pinned_deck_ids: vec![],
            excluded_deck_ids: vec![],
        },
        QuadrantKey::Q3 => QuadrantRule {
            lists: MatrixListFilter::All,
            date_filters: Some(vec![
                MatrixDateFilter::Overdue,
                MatrixDateFilter::Today,
                MatrixDateFilter::Tomorrow,
            ]),
            priorities: Some(vec![TaskPriority::Low, TaskPriority::None]),
            types: None,
            pinned_deck_ids: vec![],
            excluded_deck_ids: vec![],
        },
        QuadrantKey::Q4 => QuadrantRule {
            lists: MatrixListFilter::All,
            date_filters: None,
            priorities: Some(vec![TaskPriority::Low, TaskPriority::None]),
            types: None,
            pinned_deck_ids: vec![],
            excluded_deck_ids: vec![],
        },
    }
}

/// Default semantic color token for a quadrant.
pub fn default_quadrant_color(key: QuadrantKey) -> &'static str {
    match key {
        QuadrantKey::Q1 => "danger",
        QuadrantKey::Q2 => "warning",
        QuadrantKey::Q3 => "info",
        QuadrantKey::Q4 => "success",
    }
}

/// Seeded/restored default [`MatrixQuadrant`] rows (`usn = 0`, `created_at = 0`, `updated_at = 0`).
pub fn default_matrix_quadrants(user_id: &str) -> Vec<MatrixQuadrant> {
    [
        QuadrantKey::Q1,
        QuadrantKey::Q2,
        QuadrantKey::Q3,
        QuadrantKey::Q4,
    ]
    .into_iter()
    .map(|key| MatrixQuadrant {
        id: entity_id_v5("matrix_quadrant", user_id, key.as_str()),
        user_id: user_id.to_string(),
        quadrant_key: key,
        title: String::new(),
        color_token: default_quadrant_color(key).to_string(),
        group_by: MatrixGroupBy::None,
        sort_by: MatrixSortBy::Date,
        rule: default_quadrant_rule(key),
        created_at: 0,
        updated_at: 0,
        deleted_at: None,
        usn: 0,
    })
    .collect()
}

fn task_matches_date_filters(
    due_date: Option<&str>,
    filters: &[MatrixDateFilter],
    today_epoch_days: i64,
) -> bool {
    let due_days = due_date.and_then(|d| date_string_to_epoch_days(d).ok());
    let today_ym = epoch_days_to_year_month(today_epoch_days);

    filters.iter().any(|filter| match filter {
        MatrixDateFilter::NoDate => due_date.is_none(),
        MatrixDateFilter::Overdue => due_days.is_some_and(|d| d < today_epoch_days),
        MatrixDateFilter::Today => due_days.is_some_and(|d| d == today_epoch_days),
        MatrixDateFilter::Tomorrow => due_days.is_some_and(|d| d == today_epoch_days + 1),
        MatrixDateFilter::Next7Days => {
            due_days.is_some_and(|d| d >= today_epoch_days && d < today_epoch_days + 7)
        }
        MatrixDateFilter::ThisMonth => {
            due_days.is_some_and(|d| epoch_days_to_year_month(d) == today_ym)
        }
    })
}

/// Evaluate whether an active, incomplete task matches `rule`.
pub fn task_matches_rule(task: &TaskItem, rule: &QuadrantRule, today_epoch_days: i64) -> bool {
    if let Some(ref types) = rule.types {
        if !types.contains(&MatrixItemType::Task) {
            return false;
        }
    }

    let list_ok = match &rule.lists {
        MatrixListFilter::All | MatrixListFilter::Tasks => true,
        MatrixListFilter::Inbox => task.list_id.is_none(),
        MatrixListFilter::Custom { list_ids, deck_ids } => {
            task.list_id
                .as_ref()
                .is_some_and(|lid| list_ids.contains(lid))
                || task.deck_id.is_some_and(|did| deck_ids.contains(&did))
        }
    };
    if !list_ok {
        return false;
    }

    if let Some(ref priorities) = rule.priorities {
        if !priorities.contains(&task.priority) {
            return false;
        }
    }

    if let Some(ref date_filters) = rule.date_filters {
        if !task_matches_date_filters(task.due_date.as_deref(), date_filters, today_epoch_days) {
            return false;
        }
    }

    true
}

/// Determine a task's effective quadrant (`manual_quadrant` overrides first-match `q1 -> q2 -> q3 -> q4`).
pub fn evaluate_task_quadrant(
    task: &TaskItem,
    quadrants: &[MatrixQuadrant],
    today_epoch_days: i64,
) -> Option<QuadrantKey> {
    if task.deleted_at.is_some() || task.completed_at.is_some() {
        return None;
    }
    if let Some(manual) = task.manual_quadrant {
        return Some(manual);
    }
    for key in [
        QuadrantKey::Q1,
        QuadrantKey::Q2,
        QuadrantKey::Q3,
        QuadrantKey::Q4,
    ] {
        if let Some(q) = quadrants
            .iter()
            .find(|q| q.quadrant_key == key && q.deleted_at.is_none())
        {
            if task_matches_rule(task, &q.rule, today_epoch_days) {
                return Some(key);
            }
        }
    }
    None
}

/// Determine which quadrant (if any) displays a `DeckDue` item (`due_count > 0`).
///
/// Overlap resolution is deterministic (`q1 -> q2 -> q3 -> q4`, first match wins):
/// 1. Explicit pins (`pinned_deck_ids`, when not excluded and `types` allows `DeckDue`).
/// 2. General rule match (`types`, not excluded, `lists` = `All` or `Custom { deck_ids }`,
///    and `date_filters` = `None` or includes `Today`).
pub fn evaluate_deck_due_quadrant(
    deck_id: i64,
    quadrants: &[MatrixQuadrant],
) -> Option<QuadrantKey> {
    let order = [
        QuadrantKey::Q1,
        QuadrantKey::Q2,
        QuadrantKey::Q3,
        QuadrantKey::Q4,
    ];
    for key in order {
        let Some(q) = quadrants
            .iter()
            .find(|q| q.quadrant_key == key && q.deleted_at.is_none())
        else {
            continue;
        };
        let type_ok = match &q.rule.types {
            None => true,
            Some(types) => types.contains(&MatrixItemType::DeckDue),
        };
        if type_ok
            && !q.rule.excluded_deck_ids.contains(&deck_id)
            && q.rule.pinned_deck_ids.contains(&deck_id)
        {
            return Some(key);
        }
    }
    for key in order {
        let Some(q) = quadrants
            .iter()
            .find(|q| q.quadrant_key == key && q.deleted_at.is_none())
        else {
            continue;
        };
        let type_ok = match &q.rule.types {
            None => true,
            Some(types) => types.contains(&MatrixItemType::DeckDue),
        };
        if !type_ok || q.rule.excluded_deck_ids.contains(&deck_id) {
            continue;
        }
        let list_ok = match &q.rule.lists {
            MatrixListFilter::All => true,
            MatrixListFilter::Custom { deck_ids, .. } => deck_ids.contains(&deck_id),
            MatrixListFilter::Inbox | MatrixListFilter::Tasks => false,
        };
        if !list_ok {
            continue;
        }
        let date_ok = match &q.rule.date_filters {
            None => true,
            Some(filters) => filters.contains(&MatrixDateFilter::Today),
        };
        if date_ok {
            return Some(key);
        }
    }
    None
}

// ── Habit Schedule, 7-Day Rings, and Streaks ─────────────────────────────────

/// True if `day_index` is inside the habit's active `[start_day_index, start_day_index + target_days)` window.
pub fn is_habit_active_on_day(habit: &Habit, day_index: i32) -> bool {
    if habit.deleted_at.is_some() || day_index < habit.start_day_index {
        return false;
    }
    match habit.target_days {
        None => true,
        Some(td) => i64::from(day_index) < i64::from(habit.start_day_index) + i64::from(td),
    }
}

pub(crate) fn is_habit_scheduled_fixed(
    habit: &Habit,
    day_index: i32,
    created_epoch_day: i64,
) -> bool {
    if !is_habit_active_on_day(habit, day_index) {
        return false;
    }
    match habit.frequency_kind {
        HabitFrequencyKind::Daily => true,
        HabitFrequencyKind::Weekdays => {
            let wd = iso_weekday_from_epoch_days(created_epoch_day + i64::from(day_index));
            habit.weekdays.contains(&wd)
        }
        HabitFrequencyKind::EveryNDays => {
            let interval = i64::from(habit.interval_days.unwrap_or(1).max(1));
            let delta = i64::from(day_index) - i64::from(habit.start_day_index);
            delta >= 0 && delta % interval == 0
        }
        HabitFrequencyKind::WeeklyCount => false,
    }
}

/// Return the `day_index` of the first day of the week containing `day_index` (`epoch_day` = `created_epoch_day + day_index`).
pub fn start_of_week_day_index(day_index: i32, epoch_day: i64, week_start: WeekStart) -> i32 {
    let wd = iso_weekday_from_epoch_days(epoch_day);
    let first_wd = match week_start {
        WeekStart::Mon => 1_i32,
        WeekStart::Sat => 6_i32,
        WeekStart::Sun => 7_i32,
    };
    let offset = (i32::from(wd) - first_wd).rem_euclid(7);
    day_index - offset
}

/// Compute the 7-day (or `num_days`) completion rings starting at `start_day` (ADR-018 §2.4, ADR-023 §2.4).
pub fn compute_habit_day_rings(
    habits: &[Habit],
    logs: &[HabitLog],
    start_day: i32,
    num_days: usize,
    created_epoch_day: i64,
    week_start: WeekStart,
) -> Vec<HabitDayRingDto> {
    let mut logs_by_key: HashMap<(&str, i32), &HabitLog> = HashMap::new();
    for log in logs {
        if log.deleted_at.is_none() {
            logs_by_key.insert((log.habit_id.as_str(), log.day_index), log);
        }
    }

    let mut rings = Vec::with_capacity(num_days);
    for offset in 0..num_days {
        let day_index = start_day + (offset as i32);
        let epoch_day = created_epoch_day + i64::from(day_index);
        let date = epoch_days_to_date_string(epoch_day);

        let mut scheduled_count: u32 = 0;
        let mut completed_count: u32 = 0;
        let mut excused_count: u32 = 0;
        let mut ratio_sum: f64 = 0.0;

        for habit in habits {
            if habit.deleted_at.is_some() || habit.archived_at.is_some() {
                continue;
            }
            if !is_habit_active_on_day(habit, day_index) {
                continue;
            }

            let log = logs_by_key.get(&(habit.id.as_str(), day_index)).copied();
            let is_excused = log.is_some_and(|l| {
                matches!(l.status, HabitLogStatus::Skipped | HabitLogStatus::Frozen)
            });

            match habit.frequency_kind {
                HabitFrequencyKind::Daily
                | HabitFrequencyKind::Weekdays
                | HabitFrequencyKind::EveryNDays => {
                    if !is_habit_scheduled_fixed(habit, day_index, created_epoch_day) {
                        continue;
                    }
                    if is_excused {
                        excused_count += 1;
                        continue;
                    }
                }
                HabitFrequencyKind::WeeklyCount => {
                    if is_excused {
                        excused_count += 1;
                        continue;
                    }
                    let target = u32::from(habit.weekly_target.unwrap_or(1).max(1));
                    let week_first = start_of_week_day_index(day_index, epoch_day, week_start);
                    let mut week_completions: u32 = 0;
                    let mut week_excused: u32 = 0;
                    for w_off in 0..7 {
                        let w_day = week_first + w_off;
                        if !is_habit_active_on_day(habit, w_day) {
                            continue;
                        }
                        if let Some(wl) = logs_by_key.get(&(habit.id.as_str(), w_day)) {
                            match wl.status {
                                HabitLogStatus::Logged if wl.completed => week_completions += 1,
                                HabitLogStatus::Skipped | HabitLogStatus::Frozen => {
                                    week_excused += 1
                                }
                                HabitLogStatus::Logged => {}
                            }
                        }
                    }
                    let effective_target = target.saturating_sub(week_excused);
                    let logged_positive = log.is_some_and(|l| {
                        l.status == HabitLogStatus::Logged && (l.logged_value > 0.0 || l.completed)
                    });
                    if week_completions >= effective_target && !logged_positive {
                        continue;
                    }
                }
            }

            scheduled_count += 1;
            if let Some(l) = log {
                if l.status == HabitLogStatus::Logged {
                    if l.completed {
                        completed_count += 1;
                    }
                    let contrib = if l.goal_target > 0.0 {
                        (l.logged_value / l.goal_target).clamp(0.0, 1.0)
                    } else if l.completed {
                        1.0
                    } else {
                        0.0
                    };
                    ratio_sum += contrib;
                }
            }
        }

        let completion_ratio = if scheduled_count > 0 {
            ratio_sum / f64::from(scheduled_count)
        } else {
            0.0
        };

        rings.push(HabitDayRingDto {
            day_index,
            date,
            scheduled_count,
            completed_count,
            excused_count,
            completion_ratio,
        });
    }

    rings
}

fn habit_last_active_day(habit: &Habit, today: i32) -> i32 {
    match habit.target_days {
        None => today,
        Some(td) => {
            let end_exclusive = i64::from(habit.start_day_index) + i64::from(td);
            let max_active =
                (end_exclusive - 1).clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
            today.min(max_active)
        }
    }
}

fn habit_day_sets(logs: &[HabitLog], habit_id: &str) -> (HashSet<i32>, HashSet<i32>) {
    let mut completed_days = HashSet::new();
    let mut excused_days = HashSet::new();
    for l in logs {
        if l.deleted_at.is_some() || l.habit_id != habit_id {
            continue;
        }
        match l.status {
            HabitLogStatus::Logged if l.completed => {
                completed_days.insert(l.day_index);
            }
            HabitLogStatus::Skipped | HabitLogStatus::Frozen => {
                excused_days.insert(l.day_index);
            }
            HabitLogStatus::Logged => {}
        }
    }
    (completed_days, excused_days)
}

/// Compute a habit's current streak as of `today`, honoring today-in-progress grace and ADR-023 skips/freezes.
pub fn compute_habit_streak(
    habit: &Habit,
    logs: &[HabitLog],
    today: i32,
    created_epoch_day: i64,
    week_start: WeekStart,
) -> u32 {
    if habit.deleted_at.is_some() || today < habit.start_day_index {
        return 0;
    }
    let (completed_days, excused_days) = habit_day_sets(logs, &habit.id);
    let last_active = habit_last_active_day(habit, today);
    if last_active < habit.start_day_index {
        return 0;
    }

    match habit.frequency_kind {
        HabitFrequencyKind::Daily
        | HabitFrequencyKind::Weekdays
        | HabitFrequencyKind::EveryNDays => {
            let mut d = last_active;
            if d == today
                && is_habit_scheduled_fixed(habit, today, created_epoch_day)
                && !completed_days.contains(&today)
            {
                d -= 1;
            }
            let mut streak = 0_u32;
            while d >= habit.start_day_index {
                if is_habit_scheduled_fixed(habit, d, created_epoch_day) {
                    if completed_days.contains(&d) {
                        streak += 1;
                    } else if excused_days.contains(&d) {
                        // Excused (skipped/frozen) bridges without incrementing.
                    } else {
                        break;
                    }
                }
                d -= 1;
            }
            streak
        }
        HabitFrequencyKind::WeeklyCount => {
            let target = u32::from(habit.weekly_target.unwrap_or(1).max(1));
            let cur_week_start = start_of_week_day_index(
                last_active,
                created_epoch_day + i64::from(last_active),
                week_start,
            );
            let mut streak: u32 = (cur_week_start..=last_active)
                .filter(|&w| is_habit_active_on_day(habit, w) && completed_days.contains(&w))
                .count() as u32;

            let mut w_start = cur_week_start - 7;
            while w_start + 6 >= habit.start_day_index {
                let mut has_active = false;
                let mut week_done = 0_u32;
                let mut week_excused = 0_u32;
                for w_off in 0..7 {
                    let w = w_start + w_off;
                    if is_habit_active_on_day(habit, w) {
                        has_active = true;
                        if completed_days.contains(&w) {
                            week_done += 1;
                        } else if excused_days.contains(&w) {
                            week_excused += 1;
                        }
                    }
                }
                if !has_active {
                    break;
                }
                let effective_target = target.saturating_sub(week_excused);
                if week_done >= effective_target {
                    streak += week_done;
                } else {
                    break;
                }
                w_start -= 7;
            }
            streak
        }
    }
}

/// Compute a habit's longest streak from `start_day_index` through `today` (ADR-023 §2.4).
pub fn compute_habit_longest_streak(
    habit: &Habit,
    logs: &[HabitLog],
    today: i32,
    created_epoch_day: i64,
    week_start: WeekStart,
) -> u32 {
    if habit.deleted_at.is_some() || today < habit.start_day_index {
        return 0;
    }
    let (completed_days, excused_days) = habit_day_sets(logs, &habit.id);
    let last_active = habit_last_active_day(habit, today);
    if last_active < habit.start_day_index {
        return 0;
    }

    match habit.frequency_kind {
        HabitFrequencyKind::Daily
        | HabitFrequencyKind::Weekdays
        | HabitFrequencyKind::EveryNDays => {
            let mut best = 0_u32;
            let mut run = 0_u32;
            let mut d = habit.start_day_index;
            while d <= last_active {
                if is_habit_scheduled_fixed(habit, d, created_epoch_day) {
                    if completed_days.contains(&d) {
                        run += 1;
                        best = best.max(run);
                    } else if excused_days.contains(&d) || d == today {
                        // Excused days bridge; an unlogged in-progress `today` does not clear run.
                    } else {
                        run = 0;
                    }
                }
                d += 1;
            }
            best
        }
        HabitFrequencyKind::WeeklyCount => {
            let target = u32::from(habit.weekly_target.unwrap_or(1).max(1));
            let first_week_start = start_of_week_day_index(
                habit.start_day_index,
                created_epoch_day + i64::from(habit.start_day_index),
                week_start,
            );
            let cur_week_start = start_of_week_day_index(
                last_active,
                created_epoch_day + i64::from(last_active),
                week_start,
            );

            let mut best = 0_u32;
            let mut run = 0_u32;
            let mut w_start = first_week_start;
            while w_start <= cur_week_start {
                let week_end = (w_start + 6).min(last_active);
                let mut week_done = 0_u32;
                let mut week_excused = 0_u32;
                for w in w_start..=week_end {
                    if is_habit_active_on_day(habit, w) {
                        if completed_days.contains(&w) {
                            week_done += 1;
                        } else if excused_days.contains(&w) {
                            week_excused += 1;
                        }
                    }
                }
                if w_start == cur_week_start {
                    run += week_done;
                    best = best.max(run);
                } else {
                    let effective_target = target.saturating_sub(week_excused);
                    if week_done >= effective_target {
                        run += week_done;
                        best = best.max(run);
                    } else {
                        run = 0;
                    }
                }
                w_start += 7;
            }
            best
        }
    }
}

/// Summary statistics computed over a history window for [`HabitHistoryDto`].
#[derive(Debug, Clone, PartialEq)]
pub struct HabitHistoryStats {
    pub completed_days: u32,
    pub skipped_days: u32,
    pub frozen_days: u32,
    pub completion_rate_pct: f64,
}

/// Compute window completion stats (`completed_days`, `skipped_days`, `frozen_days`, `completion_rate_pct`).
pub fn compute_habit_history_stats(
    habit: &Habit,
    window_logs: &[HabitLog],
    window_start: i32,
    today: i32,
    created_epoch_day: i64,
    week_start: WeekStart,
) -> HabitHistoryStats {
    let mut completed_days = 0_u32;
    let mut skipped_days = 0_u32;
    let mut frozen_days = 0_u32;
    for l in window_logs {
        if l.deleted_at.is_some()
            || l.habit_id != habit.id
            || l.day_index < window_start
            || l.day_index > today
        {
            continue;
        }
        match l.status {
            HabitLogStatus::Logged if l.completed => completed_days += 1,
            HabitLogStatus::Skipped => skipped_days += 1,
            HabitLogStatus::Frozen => frozen_days += 1,
            HabitLogStatus::Logged => {}
        }
    }

    let eval_start = window_start.max(habit.start_day_index);
    let eval_end = habit_last_active_day(habit, today);
    let scheduled_days_in_window: u32 = if eval_end < eval_start {
        0
    } else {
        match habit.frequency_kind {
            HabitFrequencyKind::Daily
            | HabitFrequencyKind::Weekdays
            | HabitFrequencyKind::EveryNDays => (eval_start..=eval_end)
                .filter(|&d| is_habit_scheduled_fixed(habit, d, created_epoch_day))
                .count() as u32,
            HabitFrequencyKind::WeeklyCount => {
                let target = u32::from(habit.weekly_target.unwrap_or(1).max(1));
                let first_w = start_of_week_day_index(
                    eval_start,
                    created_epoch_day + i64::from(eval_start),
                    week_start,
                );
                let last_w = start_of_week_day_index(
                    eval_end,
                    created_epoch_day + i64::from(eval_end),
                    week_start,
                );
                let mut total = 0_u32;
                let mut w_start = first_w;
                while w_start <= last_w {
                    let active_in_w = (w_start..=(w_start + 6))
                        .filter(|&d| {
                            d >= eval_start && d <= eval_end && is_habit_active_on_day(habit, d)
                        })
                        .count() as u32;
                    total += target.min(active_in_w);
                    w_start += 7;
                }
                total
            }
        }
    };

    let denom = scheduled_days_in_window
        .saturating_sub(skipped_days + frozen_days)
        .max(1);
    let completion_rate_pct = if scheduled_days_in_window == 0 {
        0.0
    } else {
        (f64::from(completed_days) / f64::from(denom) * 100.0).min(100.0)
    };

    HabitHistoryStats {
        completed_days,
        skipped_days,
        frozen_days,
        completion_rate_pct,
    }
}

// ── Calendar Window Expansion ────────────────────────────────────────────────

fn make_occurrence(
    event: &CalendarEvent,
    is_recurring: bool,
    occ_epoch_day: i64,
    occ_start_ms: i64,
    occ_end_ms: i64,
) -> CalendarOccurrenceDto {
    CalendarOccurrenceDto {
        event_id: event.id.clone(),
        occurrence_date: epoch_days_to_date_string(occ_epoch_day),
        is_recurring,
        title: event.title.clone(),
        description: event.description.clone(),
        location: event.location.clone(),
        color_token: event.color_token.clone(),
        start_ms: occ_start_ms,
        end_ms: occ_end_ms,
        is_all_day: event.is_all_day,
        linked_task_id: event.linked_task_id.clone(),
        recurrence: event.recurrence.clone(),
    }
}

/// Expand active calendar events (single and recurring) into occurrences overlapping `[window_start_ms, window_end_ms)`.
pub fn expand_calendar_events(
    events: &[CalendarEvent],
    window_start_ms: i64,
    window_end_ms: i64,
    tz_offset_minutes: i32,
) -> Vec<CalendarOccurrenceDto> {
    if window_end_ms <= window_start_ms {
        return Vec::new();
    }

    let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
    let mut out = Vec::new();

    for event in events {
        if event.deleted_at.is_some() || event.end_ms <= event.start_ms {
            continue;
        }
        let duration_ms = event.end_ms - event.start_ms;
        let anchor_epoch_day = if event.is_all_day {
            event.start_ms.div_euclid(MS_PER_DAY)
        } else {
            (event.start_ms + tz_off_ms).div_euclid(MS_PER_DAY)
        };

        let Some(ref rec) = event.recurrence else {
            if event.end_ms > window_start_ms && event.start_ms < window_end_ms {
                out.push(make_occurrence(
                    event,
                    false,
                    anchor_epoch_day,
                    event.start_ms,
                    event.end_ms,
                ));
            }
            continue;
        };

        let interval = i64::from(rec.interval.max(1));
        let until_epoch_day = rec
            .until_date
            .as_deref()
            .and_then(|d| date_string_to_epoch_days(d).ok());
        let exdates: HashSet<&str> = rec.exdates.iter().map(String::as_str).collect();
        let max_count = rec.count;

        let occ_times = |occ_day: i64| -> (i64, i64) {
            let delta = occ_day - anchor_epoch_day;
            let s = event.start_ms + delta * MS_PER_DAY;
            (s, s + duration_ms)
        };

        match rec.freq {
            CalendarRecurrenceFreq::Daily => {
                let first_window_day = if event.is_all_day {
                    (window_start_ms - duration_ms + 1).div_euclid(MS_PER_DAY)
                } else {
                    (window_start_ms - duration_ms + 1 + tz_off_ms).div_euclid(MS_PER_DAY)
                };
                let mut k: i64 = if first_window_day > anchor_epoch_day {
                    ((first_window_day - anchor_epoch_day) / interval).max(0)
                } else {
                    0
                };
                loop {
                    if max_count.is_some_and(|c| k >= i64::from(c)) {
                        break;
                    }
                    let occ_day = anchor_epoch_day + k * interval;
                    if until_epoch_day.is_some_and(|u| occ_day > u) {
                        break;
                    }
                    let (occ_start, occ_end) = occ_times(occ_day);
                    if occ_start >= window_end_ms {
                        break;
                    }
                    if occ_end > window_start_ms {
                        let date_str = epoch_days_to_date_string(occ_day);
                        if !exdates.contains(date_str.as_str()) {
                            out.push(make_occurrence(event, true, occ_day, occ_start, occ_end));
                        }
                    }
                    k += 1;
                }
            }
            CalendarRecurrenceFreq::Weekly => {
                let mut weekdays: Vec<u8> = rec
                    .weekdays
                    .iter()
                    .copied()
                    .filter(|wd| (1..=7).contains(wd))
                    .collect();
                weekdays.sort_unstable();
                weekdays.dedup();
                if weekdays.is_empty() {
                    continue;
                }
                let anchor_wd = iso_weekday_from_epoch_days(anchor_epoch_day);
                let anchor_week_mon = anchor_epoch_day - i64::from(anchor_wd - 1);

                let first_window_day = if event.is_all_day {
                    (window_start_ms - duration_ms + 1).div_euclid(MS_PER_DAY)
                } else {
                    (window_start_ms - duration_ms + 1 + tz_off_ms).div_euclid(MS_PER_DAY)
                };
                let mut w: i64 = if max_count.is_none() && first_window_day > anchor_week_mon + 7 {
                    ((first_window_day - anchor_week_mon) / (7 * interval) - 1).max(0)
                } else {
                    0
                };

                let mut seen_count: u32 = 0;
                'weeks: loop {
                    let week_mon = anchor_week_mon + w * 7 * interval;
                    for &wd in &weekdays {
                        let occ_day = week_mon + i64::from(wd - 1);
                        if occ_day < anchor_epoch_day {
                            continue;
                        }
                        if until_epoch_day.is_some_and(|u| occ_day > u) {
                            break 'weeks;
                        }
                        if max_count.is_some_and(|c| seen_count >= c) {
                            break 'weeks;
                        }
                        seen_count += 1;

                        let (occ_start, occ_end) = occ_times(occ_day);
                        if occ_start >= window_end_ms {
                            break 'weeks;
                        }
                        if occ_end > window_start_ms {
                            let date_str = epoch_days_to_date_string(occ_day);
                            if !exdates.contains(date_str.as_str()) {
                                out.push(make_occurrence(event, true, occ_day, occ_start, occ_end));
                            }
                        }
                    }
                    w += 1;
                }
            }
        }
    }

    out.sort_by(|a, b| {
        a.start_ms
            .cmp(&b.start_ms)
            .then_with(|| a.end_ms.cmp(&b.end_ms))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.event_id.cmp(&b.event_id))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::progress::NIL_USER_ID;

    fn sample_rule() -> QuadrantRule {
        QuadrantRule {
            lists: MatrixListFilter::All,
            date_filters: Some(vec![MatrixDateFilter::Today]),
            priorities: Some(vec![TaskPriority::High]),
            types: Some(vec![MatrixItemType::Task]),
            pinned_deck_ids: vec![],
            excluded_deck_ids: vec![],
        }
    }

    fn make_task(id: &str, priority: TaskPriority, due_date: Option<&str>) -> TaskItem {
        TaskItem {
            id: id.to_string(),
            user_id: NIL_USER_ID.to_string(),
            list_id: None,
            title: format!("Task {id}"),
            notes: String::new(),
            priority,
            manual_quadrant: None,
            due_date: due_date.map(str::to_string),
            scheduled_start_ms: None,
            scheduled_end_ms: None,
            tags: vec![],
            deck_id: None,
            completed_at: None,
            completed_day: None,
            sort_order: 0,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn make_habit(
        id: &str,
        frequency_kind: HabitFrequencyKind,
        weekdays: Vec<u8>,
        weekly_target: Option<u8>,
        interval_days: Option<u32>,
        goal_mode: HabitGoalMode,
        goal_target: f64,
        start_day_index: i32,
        target_days: Option<u32>,
    ) -> Habit {
        Habit {
            id: id.to_string(),
            user_id: NIL_USER_ID.to_string(),
            title: format!("Habit {id}"),
            notes: String::new(),
            icon_key: "check-circle".to_string(),
            color_token: "accent".to_string(),
            frequency_kind,
            weekdays,
            weekly_target,
            interval_days,
            goal_mode,
            goal_target,
            goal_unit: String::new(),
            start_day_index,
            target_days,
            section: HabitSection::Morning,
            reminders: vec![],
            auto_popup_log: false,
            deck_id: None,
            archived_at: None,
            sort_order: 0,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        }
    }

    fn make_habit_log(
        habit_id: &str,
        day_index: i32,
        logged_value: f64,
        goal_target: f64,
    ) -> HabitLog {
        HabitLog {
            id: format!("log-{habit_id}-{day_index}"),
            user_id: NIL_USER_ID.to_string(),
            habit_id: habit_id.to_string(),
            day_index,
            logged_value,
            goal_target,
            completed: logged_value >= goal_target,
            status: HabitLogStatus::Logged,
            mood: None,
            note: String::new(),
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        }
    }

    #[test]
    fn quadrant_rule_validation_rejects_empty_filters_and_bad_uuids() {
        assert!(validate_quadrant_config("Valid", "danger", &sample_rule()).is_ok());

        let long_title = "a".repeat(121);
        assert!(matches!(
            validate_quadrant_config(&long_title, "danger", &sample_rule()),
            Err(CoreError::Invalid(_))
        ));

        assert!(matches!(
            validate_quadrant_config("", "   ", &sample_rule()),
            Err(CoreError::Invalid(_))
        ));

        let mut empty_date = sample_rule();
        empty_date.date_filters = Some(vec![]);
        assert!(matches!(
            validate_quadrant_config("", "danger", &empty_date),
            Err(CoreError::Invalid(_))
        ));

        let mut empty_prio = sample_rule();
        empty_prio.priorities = Some(vec![]);
        assert!(matches!(
            validate_quadrant_config("", "danger", &empty_prio),
            Err(CoreError::Invalid(_))
        ));

        let mut empty_types = sample_rule();
        empty_types.types = Some(vec![]);
        assert!(matches!(
            validate_quadrant_config("", "danger", &empty_types),
            Err(CoreError::Invalid(_))
        ));

        let mut empty_custom = sample_rule();
        empty_custom.lists = MatrixListFilter::Custom {
            list_ids: vec![],
            deck_ids: vec![],
        };
        assert!(matches!(
            validate_quadrant_config("", "danger", &empty_custom),
            Err(CoreError::Invalid(_))
        ));

        let mut bad_uuid_custom = sample_rule();
        bad_uuid_custom.lists = MatrixListFilter::Custom {
            list_ids: vec!["not-a-uuid".into()],
            deck_ids: vec![],
        };
        assert!(matches!(
            validate_quadrant_config("", "danger", &bad_uuid_custom),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn evaluate_matrix_respects_manual_pin_and_first_match_precedence() {
        let quadrants = default_matrix_quadrants(NIL_USER_ID);
        let today_days = date_string_to_epoch_days("2026-11-22").unwrap();

        // High + Today matches both Q1 (urgent+high) and Q2 (any date + high/medium); Q1 wins first-match.
        let urgent_high = make_task("t1", TaskPriority::High, Some("2026-11-22"));
        assert_eq!(
            evaluate_task_quadrant(&urgent_high, &quadrants, today_days),
            Some(QuadrantKey::Q1)
        );

        // Manual pin overrides automatic rule evaluation.
        let mut pinned = make_task("t2", TaskPriority::High, Some("2026-11-22"));
        pinned.manual_quadrant = Some(QuadrantKey::Q4);
        assert_eq!(
            evaluate_task_quadrant(&pinned, &quadrants, today_days),
            Some(QuadrantKey::Q4)
        );
    }

    #[test]
    fn old_rule_json_without_deck_pin_fields_deserializes_and_evaluates_identically() {
        let legacy_q1 = r#"{"lists":{"mode":"all"},"date_filters":["overdue","today","tomorrow"],"priorities":["high"],"types":null}"#;
        let legacy_q2 = r#"{"lists":{"mode":"all"},"date_filters":null,"priorities":["high","medium"],"types":null}"#;
        let q1_rule: QuadrantRule = serde_json::from_str(legacy_q1).unwrap();
        let q2_rule: QuadrantRule = serde_json::from_str(legacy_q2).unwrap();
        assert!(q1_rule.pinned_deck_ids.is_empty());
        assert!(q1_rule.excluded_deck_ids.is_empty());

        let mut quadrants = default_matrix_quadrants(NIL_USER_ID);
        quadrants[0].rule = q1_rule;
        quadrants[1].rule = q2_rule;

        assert_eq!(
            evaluate_deck_due_quadrant(42, &quadrants),
            Some(QuadrantKey::Q1)
        );
        let today_days = date_string_to_epoch_days("2026-11-22").unwrap();
        let inbox_high = make_task("t-legacy", TaskPriority::High, Some("2026-11-22"));
        assert_eq!(
            evaluate_task_quadrant(&inbox_high, &quadrants, today_days),
            Some(QuadrantKey::Q1)
        );
    }

    #[test]
    fn evaluate_deck_due_quadrant_resolves_pins_exclusions_and_overlaps_predictably() {
        let mut quadrants = default_matrix_quadrants(NIL_USER_ID);
        // Pin deck 2 into Q2 and exclude it from Q1; deck 1 stays unpinned in Q1.
        quadrants[0].rule.excluded_deck_ids = vec![2];
        quadrants[1].rule.pinned_deck_ids = vec![2];
        assert_eq!(
            evaluate_deck_due_quadrant(1, &quadrants),
            Some(QuadrantKey::Q1)
        );
        assert_eq!(
            evaluate_deck_due_quadrant(2, &quadrants),
            Some(QuadrantKey::Q2)
        );

        // If two quadrants both claim the same deck via pinned_deck_ids, Q1..Q4 first-match wins.
        quadrants[0].rule.excluded_deck_ids.clear();
        quadrants[0].rule.pinned_deck_ids = vec![2];
        assert_eq!(
            evaluate_deck_due_quadrant(2, &quadrants),
            Some(QuadrantKey::Q1)
        );

        // Excluding from Q1..Q4 omits the deck cleanly without affecting inbox tasks.
        for q in &mut quadrants {
            q.rule.pinned_deck_ids.clear();
            q.rule.excluded_deck_ids = vec![2];
        }
        assert_eq!(evaluate_deck_due_quadrant(2, &quadrants), None);
    }

    #[test]
    fn default_matrix_rules_cover_every_priority_and_date_combination() {
        let quadrants = default_matrix_quadrants(NIL_USER_ID);
        let today_days = date_string_to_epoch_days("2026-11-22").unwrap();

        let dates = [
            ("none", None),
            ("overdue", Some("2026-11-20")),
            ("today", Some("2026-11-22")),
            ("tomorrow", Some("2026-11-23")),
            ("future", Some("2026-12-01")),
        ];
        let expected = [
            // High: urgent -> Q1; NoDate / Future -> Q2
            (TaskPriority::High, "none", QuadrantKey::Q2),
            (TaskPriority::High, "overdue", QuadrantKey::Q1),
            (TaskPriority::High, "today", QuadrantKey::Q1),
            (TaskPriority::High, "tomorrow", QuadrantKey::Q1),
            (TaskPriority::High, "future", QuadrantKey::Q2),
            // Medium: always Q2
            (TaskPriority::Medium, "none", QuadrantKey::Q2),
            (TaskPriority::Medium, "overdue", QuadrantKey::Q2),
            (TaskPriority::Medium, "today", QuadrantKey::Q2),
            (TaskPriority::Medium, "tomorrow", QuadrantKey::Q2),
            (TaskPriority::Medium, "future", QuadrantKey::Q2),
            // Low: urgent -> Q3; NoDate / Future -> Q4
            (TaskPriority::Low, "none", QuadrantKey::Q4),
            (TaskPriority::Low, "overdue", QuadrantKey::Q3),
            (TaskPriority::Low, "today", QuadrantKey::Q3),
            (TaskPriority::Low, "tomorrow", QuadrantKey::Q3),
            (TaskPriority::Low, "future", QuadrantKey::Q4),
            // None: urgent -> Q3; NoDate / Future -> Q4
            (TaskPriority::None, "none", QuadrantKey::Q4),
            (TaskPriority::None, "overdue", QuadrantKey::Q3),
            (TaskPriority::None, "today", QuadrantKey::Q3),
            (TaskPriority::None, "tomorrow", QuadrantKey::Q3),
            (TaskPriority::None, "future", QuadrantKey::Q4),
        ];

        for (prio, label, want) in expected {
            let due = dates.iter().find(|(l, _)| *l == label).unwrap().1;
            let task = make_task(label, prio, due);
            assert_eq!(
                evaluate_task_quadrant(&task, &quadrants, today_days),
                Some(want),
                "priority={prio:?} date={label}"
            );
        }

        // Custom rule gap -> effective_quadrant == None (Unsorted)
        let mut restricted = quadrants.clone();
        for q in &mut restricted {
            q.rule.priorities = Some(vec![TaskPriority::Low]);
        }
        let unmatched = make_task("unmatched", TaskPriority::High, Some("2026-11-22"));
        assert_eq!(
            evaluate_task_quadrant(&unmatched, &restricted, today_days),
            None
        );
    }

    #[test]
    fn habit_schedule_and_ring_ratio_cover_all_four_frequencies() {
        // 2026-11-16 is a Monday.
        let mon_epoch = date_string_to_epoch_days("2026-11-16").unwrap();
        let habits = vec![
            // Daily, only active for 2 days (day 0, day 1)
            make_habit(
                "h_daily",
                HabitFrequencyKind::Daily,
                vec![],
                None,
                None,
                HabitGoalMode::AchieveAll,
                1.0,
                0,
                Some(2),
            ),
            // Weekdays: Mon (1) & Wed (3)
            make_habit(
                "h_wd",
                HabitFrequencyKind::Weekdays,
                vec![1, 3],
                None,
                None,
                HabitGoalMode::ReachAmount,
                100.0,
                0,
                None,
            ),
            // Every 2 days starting day 0 -> days 0, 2, 4...
            make_habit(
                "h_every2",
                HabitFrequencyKind::EveryNDays,
                vec![],
                None,
                Some(2),
                HabitGoalMode::AchieveAll,
                1.0,
                0,
                None,
            ),
            // WeeklyCount 2/week
            make_habit(
                "h_wc",
                HabitFrequencyKind::WeeklyCount,
                vec![],
                Some(2),
                None,
                HabitGoalMode::AchieveAll,
                1.0,
                0,
                None,
            ),
        ];

        let logs = vec![
            make_habit_log("h_daily", 0, 1.0, 1.0),
            make_habit_log("h_wd", 0, 50.0, 100.0), // 0.5 partial on Mon
            make_habit_log("h_every2", 0, 1.0, 1.0),
            make_habit_log("h_wc", 0, 1.0, 1.0),
            make_habit_log("h_wc", 2, 1.0, 1.0), // reaches 2/week on Wed
        ];

        let rings = compute_habit_day_rings(&habits, &logs, 0, 4, mon_epoch, WeekStart::Mon);
        assert_eq!(rings.len(), 4);
        // Day 0 (Mon): all 4 scheduled; 3 completed + 0.5 partial = 3.5 / 4 = 0.875
        assert_eq!(rings[0].scheduled_count, 4);
        assert_eq!(rings[0].completed_count, 3);
        assert!((rings[0].completion_ratio - 0.875).abs() < 1e-9);
        // Day 1 (Tue): daily (unlogged) + weekly_count (logged on Mon & Wed => 2/2 met, so Tue unlogged is rest day!) => only daily = 1
        assert_eq!(rings[1].scheduled_count, 1);
        assert_eq!(rings[1].completed_count, 0);
        // Day 2 (Wed): daily expired (target_days=2 => days 0,1); wd(Wed) + every2(day 2) + weekly_count(logged on Wed) => 3 scheduled
        assert_eq!(rings[2].scheduled_count, 3);
        assert_eq!(rings[2].completed_count, 1);
        // Day 3 (Thu): all unscheduled (daily expired, wd=Mon/Wed, every2=even, wc=rest day)
        assert_eq!(rings[3].scheduled_count, 0);
        assert_eq!(rings[3].completion_ratio, 0.0);
    }

    #[test]
    fn weekly_count_ring_worked_example_mon_to_sun() {
        let mon_epoch = date_string_to_epoch_days("2026-11-16").unwrap(); // Monday
        let habit = make_habit(
            "h_wc3",
            HabitFrequencyKind::WeeklyCount,
            vec![],
            Some(3),
            None,
            HabitGoalMode::ReachAmount,
            10.0,
            0,
            None,
        );

        // Case A: Mon (0), Wed (2), Fri (4) completed -> target 3/3 reached.
        let logs_a = vec![
            make_habit_log("h_wc3", 0, 10.0, 10.0),
            make_habit_log("h_wc3", 2, 10.0, 10.0),
            make_habit_log("h_wc3", 4, 10.0, 10.0),
        ];
        let rings_a = compute_habit_day_rings(
            std::slice::from_ref(&habit),
            &logs_a,
            0,
            7,
            mon_epoch,
            WeekStart::Mon,
        );
        for (idx, ring) in rings_a.iter().enumerate() {
            if matches!(idx, 0 | 2 | 4) {
                assert_eq!(ring.scheduled_count, 1, "day {idx}");
                assert!((ring.completion_ratio - 1.0).abs() < 1e-9, "day {idx}");
            } else {
                assert_eq!(ring.scheduled_count, 0, "day {idx}");
                assert!((ring.completion_ratio - 0.0).abs() < 1e-9, "day {idx}");
            }
        }

        // Case B: Mon (0) & Wed (2) completed (2 < 3), Tue (1) partial 5.0/10.0 (0.5).
        let logs_b = vec![
            make_habit_log("h_wc3", 0, 10.0, 10.0),
            make_habit_log("h_wc3", 1, 5.0, 10.0),
            make_habit_log("h_wc3", 2, 10.0, 10.0),
        ];
        let rings_b = compute_habit_day_rings(&[habit], &logs_b, 0, 7, mon_epoch, WeekStart::Mon);
        for (idx, ring) in rings_b.iter().enumerate() {
            assert_eq!(ring.scheduled_count, 1, "day {idx} must be scheduled");
            let want = match idx {
                0 | 2 => 1.0,
                1 => 0.5,
                _ => 0.0,
            };
            assert!((ring.completion_ratio - want).abs() < 1e-9, "day {idx}");
        }
    }

    #[test]
    fn calendar_recurrence_to_rrule_and_window_expansion_respects_exdates_and_bounds() {
        let rec_daily = CalendarRecurrence {
            freq: CalendarRecurrenceFreq::Daily,
            interval: 2,
            weekdays: vec![],
            until_date: None,
            count: Some(4),
            exdates: vec!["2026-11-24".into()],
        };
        assert_eq!(rec_daily.to_rrule(), "FREQ=DAILY;INTERVAL=2;COUNT=4");

        let rec_weekly = CalendarRecurrence {
            freq: CalendarRecurrenceFreq::Weekly,
            interval: 1,
            weekdays: vec![1, 3, 5],
            until_date: Some("2026-11-30".into()),
            count: None,
            exdates: vec![],
        };
        assert_eq!(
            rec_weekly.to_rrule(),
            "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;UNTIL=20261130"
        );

        let anchor_day = date_string_to_epoch_days("2026-11-22").unwrap();
        let all_day_start = anchor_day * MS_PER_DAY;
        let all_day_end = (anchor_day + 1) * MS_PER_DAY;

        let all_day_event = CalendarEvent {
            id: "ev-1".into(),
            user_id: NIL_USER_ID.into(),
            title: "All Day".into(),
            description: String::new(),
            location: String::new(),
            color_token: "accent".into(),
            start_ms: all_day_start,
            end_ms: all_day_end,
            is_all_day: true,
            recurrence: Some(rec_daily),
            linked_task_id: None,
            external_account_id: None,
            external_event_id: None,
            created_at: 1_000,
            updated_at: 1_000,
            deleted_at: None,
            usn: -1,
        };

        // Window covering 2026-11-22 .. 2026-11-30; count=4 generates Nov 22, 24(exdate), 26, 28 -> 3 visible.
        let win_start = all_day_start;
        let win_end = (anchor_day + 8) * MS_PER_DAY;

        let utc_occ =
            expand_calendar_events(std::slice::from_ref(&all_day_event), win_start, win_end, 0);
        let dates_utc: Vec<&str> = utc_occ.iter().map(|o| o.occurrence_date.as_str()).collect();
        assert_eq!(dates_utc, vec!["2026-11-22", "2026-11-26", "2026-11-28"]);

        // All-day event UTC midnight must not shift across timezone offsets (e.g., UTC-8 = -480, UTC+9 = +540).
        let pst_occ = expand_calendar_events(
            std::slice::from_ref(&all_day_event),
            win_start,
            win_end,
            -480,
        );
        let jst_occ = expand_calendar_events(&[all_day_event], win_start, win_end, 540);
        assert_eq!(pst_occ, utc_occ);
        assert_eq!(jst_occ, utc_occ);
    }

    #[test]
    fn date_string_roundtrip_and_invalid_dates_rejected() {
        for sample in [
            "1970-01-01",
            "2000-02-29",
            "2024-02-29",
            "2026-11-22",
            "2026-12-31",
        ] {
            let days = date_string_to_epoch_days(sample).expect(sample);
            assert_eq!(epoch_days_to_date_string(days), sample);
        }

        for invalid in [
            "",
            "2026-2-22",
            "2026-00-10",
            "2026-13-01",
            "2026-02-29", // 2026 is not a leap year
            "2026-02-30",
            "2026-04-31",
            "2026/11/22",
            "abcd-ef-gh",
        ] {
            assert!(
                date_string_to_epoch_days(invalid).is_err(),
                "expected invalid date error for {invalid:?}"
            );
        }
    }

    #[test]
    fn weekly_count_follows_week_start_sat() {
        // 2026-11-14 is Saturday (day 0). Sat..Fri week 1 = days 0..=6; Sat..Fri week 2 = days 7..=13.
        let sat_epoch = date_string_to_epoch_days("2026-11-14").unwrap();
        let habit = make_habit(
            "h_sat",
            HabitFrequencyKind::WeeklyCount,
            vec![],
            Some(2),
            None,
            HabitGoalMode::AchieveAll,
            1.0,
            0,
            None,
        );
        // Completed Sat (0) and Sun (1) -> 2/2 in Sat..Fri week 1; Fri (6) is rest day under Sat,
        // whereas under Mon..Sun, Sat(0)+Sun(1) belong to the previous week so Thu/Fri would still be needed!
        // Plus Mon (9) completed in Sat..Fri week 2.
        let logs = vec![
            make_habit_log("h_sat", 0, 1.0, 1.0),
            make_habit_log("h_sat", 1, 1.0, 1.0),
            make_habit_log("h_sat", 9, 1.0, 1.0),
        ];

        // Under WeekStart::Sat, week 1 (Sat 0..Fri 6) met 2/2, so streak through Mon (9) is 3.
        assert_eq!(
            compute_habit_streak(&habit, &logs, 9, sat_epoch, WeekStart::Sat),
            3
        );
        // Under WeekStart::Mon, Mon(2)..Sun(8) had 0 completions (< 2), breaking streak at Mon(9) -> 1.
        assert_eq!(
            compute_habit_streak(&habit, &logs, 9, sat_epoch, WeekStart::Mon),
            1
        );

        // Day rings for Sat..Fri week 1 (days 0..=6) with WeekStart::Sat:
        // Sat (0) & Sun (1) met 2/2, so Mon..Fri (days 2..=6) are rest days (scheduled_count == 0).
        let rings_sat = compute_habit_day_rings(
            std::slice::from_ref(&habit),
            &logs,
            0,
            7,
            sat_epoch,
            WeekStart::Sat,
        );
        assert_eq!(rings_sat[0].scheduled_count, 1);
        assert_eq!(rings_sat[1].scheduled_count, 1);
        for (idx, ring) in rings_sat.iter().enumerate().take(7).skip(2) {
            assert_eq!(
                ring.scheduled_count, 0,
                "day {idx} should be rest under Sat week"
            );
        }
    }
}
