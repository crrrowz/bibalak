//! Sync delta and deterministic merge engine primitives (ADR-014).
//!
//! Provides the serialisable [`SyncDelta`] format and pure reconciliation rules:
//! - Append-only union for `revlog`
//! - Last-writer-wins (LWW) by `mod` for mutable entities (with deterministic tie-break)
//! - Tombstones win over older edits; newer edits after delete resurrect
//! - Schema modification guard (`schema_mod` divergence -> typed full sync refusal)
//! - Monotonic clock-skew guard against excessive future timestamps

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, CoreResult};
use crate::model::{Card, Deck, DeckConfig, Field, Note, Notetype, Revlog, Template};

/// Maximum permitted future timestamp drift between client and server (10 minutes, ADR-014 §2.5).
pub const MAX_FUTURE_DRIFT_MS: i64 = 600_000;

/// A tombstone representing a deleted entity (card, note, or deck).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grave {
    pub oid: i64,
    /// 0 = Card, 1 = Note, 2 = Deck (matches `schema::grave_kind`)
    pub kind: i64,
    pub usn: i64,
    /// Epoch ms when tombstone was created (or collection.modified at export)
    pub mod_ms: i64,
}

/// A tag registry sync entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncTag {
    pub name: String,
    pub usn: i64,
}

/// The unit of synchronization exchanged between devices or cloud providers.
/// Contains all mutations with `usn = -1` (or dirty since cursor).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SyncDelta {
    /// Schema modification timestamp of the collection at export.
    /// If local and remote schema_mod differ during merge, full sync is required.
    pub schema_mod: i64,
    /// Collection modification timestamp at export.
    pub collection_mod: i64,
    /// Modified deck option groups.
    pub deck_configs: Vec<DeckConfig>,
    /// Modified decks.
    pub decks: Vec<Deck>,
    /// Modified notetypes.
    pub notetypes: Vec<Notetype>,
    /// Modified fields.
    pub fields: Vec<Field>,
    /// Modified templates.
    pub templates: Vec<Template>,
    /// Modified notes.
    pub notes: Vec<Note>,
    /// Modified cards.
    pub cards: Vec<Card>,
    /// New review log rows.
    pub revlog: Vec<Revlog>,
    /// Deleted entities (tombstones).
    pub graves: Vec<Grave>,
    /// Registered tags.
    pub tags: Vec<SyncTag>,
    /// Progress reward ledger rows (`progress_ledger`, ADR-019 §2.5).
    #[serde(default)]
    pub progress_ledger: Vec<crate::progress::ProgressLedgerEntry>,
    /// Productivity task lists (`task_lists`, ADR-018).
    #[serde(default)]
    pub task_lists: Vec<crate::productivity::TaskList>,
    /// Productivity tasks (`tasks`, ADR-018).
    #[serde(default)]
    pub tasks: Vec<crate::productivity::TaskItem>,
    /// Eisenhower matrix quadrant rules (`matrix_quadrants`, ADR-018).
    #[serde(default)]
    pub matrix_quadrants: Vec<crate::productivity::MatrixQuadrant>,
    /// Habits (`habits`, ADR-018).
    #[serde(default)]
    pub habits: Vec<crate::productivity::Habit>,
    /// Daily habit logs (`habit_logs`, ADR-018).
    #[serde(default)]
    pub habit_logs: Vec<crate::productivity::HabitLog>,
    /// Local calendar events (`calendar_events`, ADR-018).
    #[serde(default)]
    pub calendar_events: Vec<crate::productivity::CalendarEvent>,
    // ── Game (R2, ADR-025) ───────────────────────────────────────────────────
    #[serde(default)]
    pub avatar_profile: Vec<crate::game::AvatarProfile>,
    #[serde(default)]
    pub inventory_items: Vec<crate::game::InventoryItem>,
    #[serde(default)]
    pub avatar_equipped: Vec<crate::game::AvatarEquippedSlot>,
    #[serde(default)]
    pub custom_rewards: Vec<crate::game::CustomReward>,
    #[serde(default)]
    pub gold_spend_ledger: Vec<crate::game::GoldSpendEntry>,
    #[serde(default)]
    pub freeze_token_ledger: Vec<crate::game::FreezeTokenEntry>,
    // ── Game depth (R4, ADR-026) ─────────────────────────────────────────────
    #[serde(default)]
    pub game_profile: Vec<crate::game_depth::GameProfile>,
    #[serde(default)]
    pub game_unlocks: Vec<crate::game_depth::GameUnlock>,
    #[serde(default)]
    pub game_pets: Vec<crate::game_depth::GamePet>,
    #[serde(default)]
    pub game_pet_credits: Vec<crate::game_depth::GamePetCredit>,
    #[serde(default)]
    pub game_achievements: Vec<crate::game_depth::GameAchievement>,
    // ── Motivation (16d, ADR-027) ────────────────────────────────────────────
    #[serde(default)]
    pub motivation_settings: Vec<crate::motivation::MotivationSettingsRow>,
    #[serde(default)]
    pub monthly_badges: Vec<crate::motivation::MonthlyBadgeRow>,
}

impl SyncDelta {
    /// Returns true if the delta contains zero entity modifications.
    pub fn is_empty(&self) -> bool {
        self.deck_configs.is_empty()
            && self.decks.is_empty()
            && self.notetypes.is_empty()
            && self.fields.is_empty()
            && self.templates.is_empty()
            && self.notes.is_empty()
            && self.cards.is_empty()
            && self.revlog.is_empty()
            && self.graves.is_empty()
            && self.tags.is_empty()
            && self.progress_ledger.is_empty()
            && self.task_lists.is_empty()
            && self.tasks.is_empty()
            && self.matrix_quadrants.is_empty()
            && self.habits.is_empty()
            && self.habit_logs.is_empty()
            && self.calendar_events.is_empty()
            && self.avatar_profile.is_empty()
            && self.inventory_items.is_empty()
            && self.avatar_equipped.is_empty()
            && self.custom_rewards.is_empty()
            && self.gold_spend_ledger.is_empty()
            && self.freeze_token_ledger.is_empty()
            && self.game_profile.is_empty()
            && self.game_unlocks.is_empty()
            && self.game_pets.is_empty()
            && self.game_pet_credits.is_empty()
            && self.game_achievements.is_empty()
            && self.motivation_settings.is_empty()
            && self.monthly_badges.is_empty()
    }
}

/// Summary of entity changes applied during a sync merge.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MergeSummary {
    pub deck_configs_updated: u32,
    pub decks_updated: u32,
    pub notetypes_updated: u32,
    pub notes_updated: u32,
    pub cards_updated: u32,
    pub revlog_added: u32,
    pub graves_applied: u32,
    pub tags_registered: u32,
    pub progress_ledger_updated: u32,
    pub task_lists_updated: u32,
    pub tasks_updated: u32,
    pub matrix_quadrants_updated: u32,
    pub habits_updated: u32,
    pub habit_logs_updated: u32,
    pub calendar_events_updated: u32,
    // ── Game (R2, ADR-025) ───────────────────────────────────────────────────
    #[serde(default)]
    pub avatar_profile_updated: u32,
    #[serde(default)]
    pub inventory_items_updated: u32,
    #[serde(default)]
    pub avatar_equipped_updated: u32,
    #[serde(default)]
    pub custom_rewards_updated: u32,
    #[serde(default)]
    pub gold_spend_ledger_updated: u32,
    #[serde(default)]
    pub freeze_token_ledger_updated: u32,
    // ── Game depth (R4, ADR-026) ─────────────────────────────────────────────
    #[serde(default)]
    pub game_profile_updated: u32,
    #[serde(default)]
    pub game_unlocks_updated: u32,
    #[serde(default)]
    pub game_pets_updated: u32,
    #[serde(default)]
    pub game_pet_credits_updated: u32,
    #[serde(default)]
    pub game_achievements_updated: u32,
    // ── Motivation (16d, ADR-027) ────────────────────────────────────────────
    #[serde(default)]
    pub motivation_settings_updated: u32,
    #[serde(default)]
    pub monthly_badges_updated: u32,
}

/// Validate that a remote delta can be merged into local state.
///
/// Refuses merge if:
/// 1. `delta.schema_mod != local_schema_mod` (ADR-014 §2.3: full sync required).
/// 2. Any timestamp exceeds `now_ms + MAX_FUTURE_DRIFT_MS` (ADR-014 §2.5: clock-skew guard).
pub fn validate_delta(delta: &SyncDelta, local_schema_mod: i64, now_ms: i64) -> CoreResult<()> {
    if delta.schema_mod != 0 && delta.schema_mod != local_schema_mod {
        return Err(CoreError::FullSyncRequired {
            local: local_schema_mod,
            remote: delta.schema_mod,
        });
    }

    let max_allowed = now_ms + MAX_FUTURE_DRIFT_MS;

    let check_time = |mod_ms: i64| -> CoreResult<()> {
        if mod_ms > max_allowed {
            return Err(CoreError::ClockSkewDetected {
                remote_mod: mod_ms,
                now_ms,
                max_skew_ms: MAX_FUTURE_DRIFT_MS,
            });
        }
        Ok(())
    };

    check_time(delta.collection_mod)?;
    for dc in &delta.deck_configs {
        check_time(dc.mod_ms)?;
    }
    for d in &delta.decks {
        check_time(d.mod_ms)?;
    }
    for nt in &delta.notetypes {
        check_time(nt.mod_ms)?;
    }
    for n in &delta.notes {
        check_time(n.mod_ms)?;
    }
    for c in &delta.cards {
        check_time(c.mod_ms)?;
    }
    for g in &delta.graves {
        check_time(g.mod_ms)?;
    }
    let check_opt_time = |ts: Option<i64>| -> CoreResult<()> {
        if let Some(t) = ts {
            check_time(t)?;
        }
        Ok(())
    };

    for p in &delta.progress_ledger {
        check_time(p.updated_at)?;
        check_opt_time(p.deleted_at)?;
    }
    for tl in &delta.task_lists {
        check_time(tl.updated_at)?;
        check_opt_time(tl.deleted_at)?;
    }
    for t in &delta.tasks {
        check_time(t.updated_at)?;
        check_opt_time(t.deleted_at)?;
    }
    for mq in &delta.matrix_quadrants {
        check_time(mq.updated_at)?;
        check_opt_time(mq.deleted_at)?;
    }
    for h in &delta.habits {
        check_time(h.updated_at)?;
        check_opt_time(h.deleted_at)?;
    }
    for hl in &delta.habit_logs {
        check_time(hl.updated_at)?;
        check_opt_time(hl.deleted_at)?;
    }
    for ce in &delta.calendar_events {
        check_time(ce.updated_at)?;
        check_opt_time(ce.deleted_at)?;
    }
    for ms in &delta.motivation_settings {
        check_time(ms.updated_at)?;
        check_opt_time(ms.deleted_at)?;
    }
    for mb in &delta.monthly_badges {
        check_time(mb.updated_at)?;
        check_opt_time(mb.deleted_at)?;
    }

    Ok(())
}

/// Deterministic Last-Writer-Wins (LWW) resolution.
///
/// Returns `true` if the remote entity wins and should overwrite local state.
/// Tie-break: deterministic string comparison of serialized/content representation.
#[inline]
pub fn should_remote_win_lww(
    remote_mod: i64,
    local_mod: i64,
    remote_content: &str,
    local_content: &str,
) -> bool {
    if remote_mod > local_mod {
        true
    } else if remote_mod < local_mod {
        false
    } else {
        // Deterministic tie-breaker: lexicographical order ensures both peers agree
        remote_content > local_content
    }
}

/// Tombstone reconciliation rule (ADR-014 §2.4 item 3).
///
/// Tombstone wins over older or same-age local edits (`grave_mod >= local_mod`).
/// A strictly newer local edit (`local_mod > grave_mod`) resurrects the entity.
#[inline]
pub fn should_tombstone_win(grave_mod: i64, local_entity_mod: i64) -> bool {
    grave_mod >= local_entity_mod
}

/// Resurrect local grave on incoming remote edit.
///
/// Returns `true` if an incoming remote edit occurred strictly after local deletion.
#[inline]
pub fn should_remote_resurrect(remote_mod: i64, local_grave_mod: i64) -> bool {
    remote_mod > local_grave_mod
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_delta_rejects_divergent_schema_mod() {
        let delta = SyncDelta {
            schema_mod: 200,
            ..Default::default()
        };
        let err = validate_delta(&delta, 100, 1000).unwrap_err();
        match err {
            CoreError::FullSyncRequired { local, remote } => {
                assert_eq!(local, 100);
                assert_eq!(remote, 200);
            }
            other => panic!("expected FullSyncRequired, got {other:?}"),
        }
    }

    #[test]
    fn validate_delta_rejects_excessive_future_clock_skew() {
        let now = 1_000_000;
        let delta = SyncDelta {
            schema_mod: 100,
            collection_mod: now + MAX_FUTURE_DRIFT_MS + 1,
            ..Default::default()
        };
        let err = validate_delta(&delta, 100, now).unwrap_err();
        match err {
            CoreError::ClockSkewDetected {
                remote_mod,
                now_ms,
                max_skew_ms,
            } => {
                assert_eq!(remote_mod, now + MAX_FUTURE_DRIFT_MS + 1);
                assert_eq!(now_ms, now);
                assert_eq!(max_skew_ms, MAX_FUTURE_DRIFT_MS);
            }
            other => panic!("expected ClockSkewDetected, got {other:?}"),
        }
    }

    #[test]
    fn lww_newer_mod_wins() {
        assert!(should_remote_win_lww(200, 100, "b", "a"));
        assert!(!should_remote_win_lww(100, 200, "b", "a"));
    }

    #[test]
    fn lww_tie_break_is_deterministic() {
        assert!(should_remote_win_lww(100, 100, "z", "a"));
        assert!(!should_remote_win_lww(100, 100, "a", "z"));
    }

    #[test]
    fn tombstone_wins_over_stale_edit() {
        assert!(should_tombstone_win(200, 100));
        assert!(should_tombstone_win(200, 200));
        assert!(!should_tombstone_win(100, 200)); // newer edit resurrects
    }
}
