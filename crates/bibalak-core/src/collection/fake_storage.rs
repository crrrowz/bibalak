use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use crate::error::{CoreError, CoreResult};
use crate::ipc::{
    DuplicateGroup, FieldOptions, FieldRemoveWarning, FindReplacePreview, NoteDetail, NoteOverview,
    NoteRow, NotetypeDetail,
};
use crate::model::{
    CanonicalModel, Card, Deck, Field, ImportSummary, NoteIndexRow, NoteSnapshot,
    NoteTypeChangeSnapshot, Notetype, Revlog, StudyCard, Template,
};
use crate::ports::{
    BrowseStore, DeckStore, GameStore, MaintenanceStore, NoteStore, NotetypeStore,
    ProductivityStore, ProgressStore, StudyStore, SyncStore,
};
use crate::scheduling::CardState;

/// Minimal in-memory `Storage` fake so the application layer can be tested
/// without `bibalak-db`. (bibalak-db has its own SQLite-backed tests.)
///
/// `queues`/`due_ms`/`due_counts` are test fixtures: unset entries fall
/// back to empty/zero, matching the original all-stub behavior, so
/// existing tests that never populate them are unaffected.
#[derive(Default)]
pub struct FakeStorage {
    pub(crate) decks: Mutex<Vec<Deck>>,
    pub(crate) next_id: AtomicUsize,
    pub(crate) queues:
        std::sync::Arc<Mutex<std::collections::HashMap<i64, crate::ports::StudyQueue>>>,
    pub(crate) due_ms: Mutex<std::collections::HashMap<i64, i64>>,
    pub(crate) due_counts: Mutex<std::collections::HashMap<i64, (u32, u32, u32)>>,
    pub(crate) last_answered: std::sync::Arc<Mutex<std::collections::HashMap<i64, i64>>>,
    pub(crate) deck_limits_map: Mutex<std::collections::HashMap<i64, (u32, u32)>>,
    pub(crate) today_studied_map: Mutex<std::collections::HashMap<i64, (u32, u32)>>,
    pub(crate) extra_new_map: Mutex<std::collections::HashMap<i64, u32>>,
    pub(crate) unbury_calls: std::sync::Arc<AtomicUsize>,
    pub(crate) last_unbury_day: Mutex<Option<i32>>,
    pub(crate) rollover_hour: Mutex<Option<u8>>,
    pub(crate) undo_answer_calls: std::sync::Arc<AtomicUsize>,
    pub(crate) media_ref_counts: Mutex<Vec<(String, u32)>>,
    pub(crate) media_ref_counts_by_query:
        Mutex<std::collections::HashMap<String, Vec<(String, u32)>>>,
    pub(crate) fail_apply_answer: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub(crate) fail_get_deck_config: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub(crate) fail_ensure_collection: std::sync::atomic::AtomicBool,
    pub(crate) study_cards: Mutex<std::collections::HashMap<i64, StudyCard>>,
    pub(crate) progress_ledger: std::sync::Arc<Mutex<Vec<crate::progress::ProgressLedgerEntry>>>,
    pub(crate) applied_revlogs: std::sync::Arc<Mutex<Vec<i64>>>,
    pub(crate) cards: Mutex<Vec<Card>>,
    pub(crate) revlogs: Mutex<Vec<Revlog>>,
    pub(crate) next_uuid: AtomicUsize,
    pub(crate) task_lists: Mutex<Vec<crate::productivity::TaskList>>,
    pub(crate) tasks: Mutex<Vec<crate::productivity::TaskItem>>,
    pub(crate) matrix_quadrants: Mutex<Vec<crate::productivity::MatrixQuadrant>>,
    pub(crate) habits: Mutex<Vec<crate::productivity::Habit>>,
    pub(crate) habit_logs: Mutex<Vec<crate::productivity::HabitLog>>,
    pub(crate) calendar_events: Mutex<Vec<crate::productivity::CalendarEvent>>,
    pub(crate) sync_state: Mutex<std::collections::HashMap<String, String>>,
    // ── Game (R2) ────────────────────────────────────────────────────────────
    pub(crate) avatar_profiles: Mutex<Vec<crate::game::AvatarProfile>>,
    pub(crate) inventory_items: Mutex<Vec<crate::game::InventoryItem>>,
    pub(crate) avatar_equipped: Mutex<Vec<crate::game::AvatarEquippedSlot>>,
    pub(crate) custom_rewards: Mutex<Vec<crate::game::CustomReward>>,
    pub(crate) gold_spend_ledger: Mutex<Vec<crate::game::GoldSpendEntry>>,
    pub(crate) freeze_token_ledger: Mutex<Vec<crate::game::FreezeTokenEntry>>,
    // ── Game depth (R4) ──────────────────────────────────────────────────────
    pub(crate) game_profiles: Mutex<Vec<crate::game_depth::GameProfile>>,
    pub(crate) game_unlocks: Mutex<Vec<crate::game_depth::GameUnlock>>,
    pub(crate) game_pets: Mutex<Vec<crate::game_depth::GamePet>>,
    pub(crate) game_pet_credits: Mutex<Vec<crate::game_depth::GamePetCredit>>,
    pub(crate) game_achievements: Mutex<Vec<crate::game_depth::GameAchievement>>,
    // ── Motivation (16d, ADR-027) ────────────────────────────────────────────
    pub(crate) motivation_settings: Mutex<Vec<crate::motivation::MotivationSettingsRow>>,
    pub(crate) monthly_badges: Mutex<Vec<crate::motivation::MonthlyBadgeRow>>,
}

impl FakeStorage {
    pub(crate) fn new_id(&self) -> i64 {
        self.next_id.fetch_add(1, Ordering::SeqCst) as i64 + 1
    }
}

impl DeckStore for FakeStorage {
    fn create_deck(&self, name: &str, now_ms: i64) -> CoreResult<Deck> {
        let deck = Deck {
            id: self.new_id(),
            name: name.to_string(),
            parent_id: None,
            config_id: self.new_id(),
            mod_ms: now_ms,
            usn: -1,
            collapsed: false,
            is_filtered: false,
        };
        self.decks.lock().unwrap().push(deck.clone());
        Ok(deck)
    }

    fn deck_by_id(&self, id: i64) -> CoreResult<Option<Deck>> {
        Ok(self
            .decks
            .lock()
            .unwrap()
            .iter()
            .find(|d| d.id == id)
            .cloned())
    }

    fn deck_by_name(&self, name: &str) -> CoreResult<Option<Deck>> {
        Ok(self
            .decks
            .lock()
            .unwrap()
            .iter()
            .find(|d| d.name == name)
            .cloned())
    }

    fn list_decks(&self) -> CoreResult<Vec<Deck>> {
        Ok(self.decks.lock().unwrap().clone())
    }

    fn rename_deck(&self, id: i64, name: &str, now_ms: i64) -> CoreResult<()> {
        let mut decks = self.decks.lock().unwrap();
        let deck = decks
            .iter_mut()
            .find(|d| d.id == id)
            .ok_or_else(|| CoreError::NotFound("deck".into()))?;
        deck.name = name.to_string();
        deck.mod_ms = now_ms;
        Ok(())
    }

    fn remove_deck(&self, id: i64, _now_ms: i64) -> CoreResult<crate::ports::RemovedDeck> {
        let mut decks = self.decks.lock().unwrap();
        let removed: Vec<Deck> = decks.iter().filter(|d| d.id == id).cloned().collect();
        decks.retain(|d| d.id != id);
        Ok(crate::ports::RemovedDeck {
            decks: removed,
            cards: vec![],
            notes: vec![],
        })
    }

    fn restore_deck(&self, removed: &crate::ports::RemovedDeck, _now_ms: i64) -> CoreResult<()> {
        self.decks
            .lock()
            .unwrap()
            .extend(removed.decks.iter().cloned());
        Ok(())
    }

    fn insert_deck(&self, deck: &Deck, _now_ms: i64) -> CoreResult<()> {
        self.decks.lock().unwrap().push(deck.clone());
        Ok(())
    }

    fn set_deck_collapsed(&self, deck_id: i64, collapsed: bool) -> CoreResult<()> {
        let mut decks = self.decks.lock().unwrap();
        if let Some(d) = decks.iter_mut().find(|d| d.id == deck_id) {
            d.collapsed = collapsed;
            Ok(())
        } else {
            Err(CoreError::NotFound(format!("deck {deck_id}")))
        }
    }

    fn create_filtered_deck(
        &self,
        _name: &str,
        _search: &str,
        _order: u8,
        _limit: u32,
        _today: i32,
        _now: i64,
    ) -> CoreResult<Deck> {
        Ok(Deck {
            id: 99,
            name: "filtered".into(),
            parent_id: None,
            config_id: 1,
            mod_ms: 0,
            usn: -1,
            collapsed: false,
            is_filtered: true,
        })
    }

    fn rebuild_filtered(&self, _id: i64, _today: i32, _now: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn empty_filtered(&self, _id: i64, _now: i64) -> CoreResult<()> {
        Ok(())
    }

    fn get_filtered_config(&self, _id: i64) -> CoreResult<Option<crate::ipc::FilteredDeckConfig>> {
        Ok(None)
    }
}

impl NoteStore for FakeStorage {
    fn import_with_tz(
        &self,
        model: &CanonicalModel,
        _tz_offset_minutes: i32,
        now_ms: i64,
        _on_progress: &mut dyn FnMut(u32, u32),
    ) -> CoreResult<ImportSummary> {
        self.import(model, now_ms)
    }

    fn import(&self, model: &CanonicalModel, _now_ms: i64) -> CoreResult<ImportSummary> {
        let mut summary = ImportSummary::default();
        for deck in &model.decks {
            if self.deck_by_name(&deck.name)?.is_none() {
                self.create_deck(&deck.name, deck.mod_ms)?;
                summary.decks_added += 1;
            }
        }
        summary.notes_added = model.notes.len() as u32;
        Ok(summary)
    }

    fn list_notes(&self, _query: Option<&str>, _limit: i64) -> CoreResult<Vec<NoteOverview>> {
        Ok(vec![])
    }

    fn note_detail(&self, _note_id: i64) -> CoreResult<Option<NoteDetail>> {
        Ok(None)
    }

    fn update_note(
        &self,
        _note_id: i64,
        _fields: &[String],
        _tags: &[String],
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn notes_by_ids(&self, _ids: &[i64]) -> CoreResult<Vec<NoteOverview>> {
        Ok(vec![])
    }

    fn dump_collection(&self) -> CoreResult<CanonicalModel> {
        Ok(CanonicalModel::default())
    }

    fn add_note_with_cards(
        &self,
        _notetype_id: i64,
        _deck_id: i64,
        _fields: &[String],
        _tags: &[String],
        _now_ms: i64,
    ) -> CoreResult<(i64, u32)> {
        Ok((1, 0))
    }

    fn add_notes_batch(
        &self,
        _notetype_id: i64,
        _deck_id: i64,
        notes: &[crate::ipc::BatchNoteInput],
        _now_ms: i64,
    ) -> CoreResult<(Vec<i64>, u32)> {
        let mut ids = Vec::with_capacity(notes.len());
        for _ in notes {
            ids.push(self.new_id());
        }
        Ok((ids, notes.len() as u32))
    }

    fn find_duplicate_note(
        &self,
        _notetype_id: i64,
        _first_field: &str,
    ) -> CoreResult<Option<i64>> {
        Ok(None)
    }

    fn add_note_tag(&self, _note_id: i64, _tag: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn bulk_add_tag(&self, _note_ids: &[i64], _tag: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn bulk_remove_tag(&self, _note_ids: &[i64], _tag: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn restore_notes(&self, _snapshots: &[NoteSnapshot], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn delete_notes(&self, _note_ids: &[i64], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn move_cards_to_deck(&self, _card_ids: &[i64], _deck_id: i64, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn remove_note_tag(&self, _note_id: i64, _tag: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn import_text_notes(
        &self,
        _deck_id: i64,
        _notetype_id: i64,
        _duplicate_policy: crate::ipc::DuplicatePolicy,
        rows: &[crate::ports::ParsedTextNote],
        _now_ms: i64,
    ) -> CoreResult<crate::ports::TextImportOutcome> {
        let added = rows.len() as u32;
        Ok(crate::ports::TextImportOutcome {
            summary: crate::ipc::TextImportSummary {
                notes_added: added,
                notes_updated: 0,
                notes_skipped: 0,
                cards_added: added,
                errors: vec![],
            },
            affected_note_ids: vec![],
        })
    }
}

impl NotetypeStore for FakeStorage {
    fn list_notetypes(&self) -> CoreResult<Vec<Notetype>> {
        Ok(vec![])
    }

    fn fields_for_notetype(&self, _notetype_id: i64) -> CoreResult<Vec<Field>> {
        Ok(vec![])
    }

    fn templates_for_notetype(&self, _notetype_id: i64) -> CoreResult<Vec<Template>> {
        Ok(vec![])
    }

    fn get_notetype_detail(&self, _notetype_id: i64) -> CoreResult<Option<NotetypeDetail>> {
        Ok(None)
    }

    fn create_notetype(&self, _name: &str, _kind: i64, _now_ms: i64) -> CoreResult<i64> {
        Ok(1)
    }

    fn stock_notetype_names(&self) -> Vec<&'static str> {
        vec![]
    }

    fn add_stock_notetype(&self, _index: usize, _now_ms: i64) -> CoreResult<i64> {
        Ok(1)
    }

    fn delete_notetype(&self, _notetype_id: i64, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn note_count_for_notetype(&self, _notetype_id: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn rename_notetype(&self, _notetype_id: i64, _name: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn save_notetype_css(&self, _notetype_id: i64, _css: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn add_field(&self, _notetype_id: i64, _name: &str, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn check_field_remove(&self, _notetype_id: i64, _ord: i64) -> CoreResult<FieldRemoveWarning> {
        Ok(FieldRemoveWarning {
            notes_with_content: 0,
            using_templates: vec![],
        })
    }

    fn remove_field(&self, _notetype_id: i64, _ord: i64, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn rename_field(
        &self,
        _notetype_id: i64,
        _ord: i64,
        _name: &str,
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn reorder_fields(
        &self,
        _notetype_id: i64,
        _new_order: &[i64],
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn save_field_options(
        &self,
        _notetype_id: i64,
        _ord: i64,
        _options: &FieldOptions,
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn set_sort_field(&self, _notetype_id: i64, _ord: i64, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn duplicate_notetype(
        &self,
        _notetype_id: i64,
        _new_name: &str,
        _now_ms: i64,
    ) -> CoreResult<i64> {
        Ok(2)
    }

    fn add_template(
        &self,
        _notetype_id: i64,
        _name: &str,
        _qfmt: &str,
        _afmt: &str,
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn check_template_remove(&self, _notetype_id: i64, _ord: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn remove_template(&self, _notetype_id: i64, _ord: i64, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn save_template(
        &self,
        _notetype_id: i64,
        _ord: i64,
        _name: &str,
        _qfmt: &str,
        _afmt: &str,
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn change_note_type(
        &self,
        _note_ids: &[i64],
        _target_notetype_id: i64,
        _field_map: &[Option<usize>],
        _template_map: &[(i64, Option<i64>)],
        _now_ms: i64,
    ) -> CoreResult<Vec<NoteTypeChangeSnapshot>> {
        Ok(vec![])
    }

    fn restore_note_type_changes(
        &self,
        _snapshots: &[NoteTypeChangeSnapshot],
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }
}

impl StudyStore for FakeStorage {
    fn study_queue(
        &self,
        deck_id: i64,
        _today: i32,
        _now_ms: i64,
        _today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<crate::ports::StudyQueue> {
        let mut q = self
            .queues
            .lock()
            .unwrap()
            .get(&deck_id)
            .cloned()
            .unwrap_or_default();
        q.new.truncate(new_limit as usize);
        q.review.truncate(review_limit as usize);
        Ok(q)
    }

    fn count_due_by_type(
        &self,
        deck_id: i64,
        _today: i32,
        _now_ms: i64,
        _today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<(u32, u32, u32)> {
        let (n, l, r) = self
            .due_counts
            .lock()
            .unwrap()
            .get(&deck_id)
            .copied()
            .unwrap_or((0, 0, 0));
        Ok((n.min(new_limit), l, r.min(review_limit)))
    }

    fn count_due(
        &self,
        deck_id: i64,
        today: i32,
        now_ms: i64,
        today_end_ms: i64,
        new_limit: u32,
        review_limit: u32,
    ) -> CoreResult<u32> {
        let (n, l, r) = self.count_due_by_type(
            deck_id,
            today,
            now_ms,
            today_end_ms,
            new_limit,
            review_limit,
        )?;
        Ok(n + l + r)
    }

    fn deck_due_counts(
        &self,
        _today: i32,
        _now_ms: i64,
        _today_end_ms: i64,
    ) -> CoreResult<std::collections::HashMap<i64, (u32, u32, u32)>> {
        Ok(self.due_counts.lock().unwrap().clone())
    }

    fn cards_due_ms(&self, card_ids: &[i64]) -> CoreResult<std::collections::HashMap<i64, i64>> {
        let due = self.due_ms.lock().unwrap();
        Ok(card_ids
            .iter()
            .filter_map(|id| due.get(id).map(|&ms| (*id, ms)))
            .collect())
    }

    fn cards_last_answered(
        &self,
        card_ids: &[i64],
    ) -> CoreResult<std::collections::HashMap<i64, i64>> {
        let last = self.last_answered.lock().unwrap();
        Ok(card_ids
            .iter()
            .filter_map(|id| last.get(id).map(|&ms| (*id, ms)))
            .collect())
    }

    fn latest_answered_card_id(&self) -> CoreResult<Option<i64>> {
        Ok(self
            .last_answered
            .lock()
            .unwrap()
            .iter()
            .max_by_key(|(_, &ms)| ms)
            .map(|(&card_id, _)| card_id))
    }

    fn deck_limits(&self, config_id: i64) -> CoreResult<(u32, u32)> {
        Ok(self
            .deck_limits_map
            .lock()
            .unwrap()
            .get(&config_id)
            .copied()
            .unwrap_or((20, 200)))
    }

    fn all_deck_limits(&self) -> CoreResult<std::collections::HashMap<i64, (u32, u32)>> {
        Ok(self.deck_limits_map.lock().unwrap().clone())
    }

    fn today_studied(&self, deck_id: i64, _today_start_ms: i64) -> CoreResult<(u32, u32)> {
        Ok(self
            .today_studied_map
            .lock()
            .unwrap()
            .get(&deck_id)
            .copied()
            .unwrap_or((0, 0)))
    }

    fn all_today_studied(
        &self,
        _today_start_ms: i64,
    ) -> CoreResult<std::collections::HashMap<i64, (u32, u32)>> {
        Ok(self.today_studied_map.lock().unwrap().clone())
    }

    fn set_deck_limits(
        &self,
        _config_id: i64,
        _new_per_day: u32,
        _rev_per_day: u32,
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn get_deck_config(&self, _config_id: i64) -> CoreResult<crate::scheduling::SchedConfig> {
        if self.fail_get_deck_config.load(Ordering::SeqCst) {
            return Err(CoreError::Storage(
                "simulated get_deck_config failure".into(),
            ));
        }
        Ok(crate::scheduling::SchedConfig::default())
    }

    fn set_deck_config(
        &self,
        _config_id: i64,
        _config: &crate::scheduling::SchedConfig,
        _now_ms: i64,
    ) -> CoreResult<()> {
        Ok(())
    }

    fn get_rollover_hour(&self) -> CoreResult<u8> {
        Ok(self.rollover_hour.lock().unwrap().unwrap_or(4))
    }

    fn set_rollover_hour(&self, hour: u8, _now_ms: i64) -> CoreResult<()> {
        *self.rollover_hour.lock().unwrap() = Some(hour);
        Ok(())
    }

    fn day_extra_new(&self, deck_id: i64, _day: i32) -> CoreResult<u32> {
        Ok(self
            .extra_new_map
            .lock()
            .unwrap()
            .get(&deck_id)
            .copied()
            .unwrap_or(0))
    }

    fn all_day_extra_new(&self, _day: i32) -> CoreResult<std::collections::HashMap<i64, u32>> {
        Ok(self.extra_new_map.lock().unwrap().clone())
    }

    fn set_day_extra_new(&self, deck_id: i64, _day: i32, extra_new: u32) -> CoreResult<()> {
        self.extra_new_map
            .lock()
            .unwrap()
            .insert(deck_id, extra_new);
        Ok(())
    }

    fn study_card(&self, card_id: i64) -> CoreResult<Option<StudyCard>> {
        Ok(self.study_cards.lock().unwrap().get(&card_id).cloned())
    }

    fn apply_answer(
        &self,
        _card_id: i64,
        _next: &CardState,
        _due: i64,
        log: &Revlog,
        reward: Option<&crate::progress::RewardGrant>,
    ) -> CoreResult<bool> {
        if self.fail_apply_answer.load(Ordering::SeqCst) {
            return Err(CoreError::Storage("simulated apply_answer failure".into()));
        }
        self.applied_revlogs.lock().unwrap().push(log.id);
        self.revlogs.lock().unwrap().push(log.clone());
        let Some(r) = reward else {
            return Ok(false);
        };
        let mut ledger = self.progress_ledger.lock().unwrap();
        if let Some(entry) = ledger
            .iter_mut()
            .find(|e| e.user_id == r.user_id && e.source_key == r.source_key)
        {
            if entry.deleted_at.is_some() {
                entry.xp = r.xp;
                entry.gold_cents = r.gold_cents;
                entry.created_at = r.now_ms;
                entry.updated_at = r.now_ms;
                entry.deleted_at = None;
                entry.usn = -1;
                Ok(true)
            } else {
                Ok(false)
            }
        } else {
            ledger.push(crate::progress::ProgressLedgerEntry {
                id: r.id.clone(),
                user_id: r.user_id.clone(),
                source_key: r.source_key.clone(),
                xp: r.xp,
                gold_cents: r.gold_cents,
                created_at: r.now_ms,
                updated_at: r.now_ms,
                deleted_at: None,
                usn: -1,
            });
            Ok(true)
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn stats(
        &self,
        _deck_ids: Option<&[i64]>,
        _days: Option<u32>,
        _tz_offset_minutes: i32,
        _rollover_hour: u8,
        _fsrs_weights: &[f64; 21],
        _retention_goal_pct: f64,
        _today: i32,
        _now_ms: i64,
        _created_ms: i64,
    ) -> CoreResult<crate::ipc::StatsDto> {
        Ok(crate::ipc::StatsDto::default())
    }

    fn suspend_cards(&self, _card_ids: &[i64], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn unsuspend_cards(&self, _card_ids: &[i64], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn bury_cards(&self, _card_ids: &[i64], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn unbury_cards(&self, _card_ids: &[i64], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn bury_siblings(
        &self,
        _note_id: i64,
        _answered_card_id: i64,
        _now_ms: i64,
    ) -> CoreResult<Vec<i64>> {
        Ok(vec![])
    }

    fn undo_answer(
        &self,
        _card_id: i64,
        _prev_state: &CardState,
        _prev_due: i64,
        revlog_id: i64,
        _buried_siblings: &[i64],
        _leech_note: Option<i64>,
        reward_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()> {
        self.undo_answer_calls.fetch_add(1, Ordering::SeqCst);
        self.applied_revlogs
            .lock()
            .unwrap()
            .retain(|&id| id != revlog_id);
        self.revlogs.lock().unwrap().retain(|r| r.id != revlog_id);
        if let Some(key) = reward_source_key {
            let mut ledger = self.progress_ledger.lock().unwrap();
            if let Some(entry) = ledger.iter_mut().find(|e| {
                e.user_id == crate::progress::NIL_USER_ID
                    && e.source_key == key
                    && e.deleted_at.is_none()
            }) {
                entry.deleted_at = Some(now_ms);
                entry.updated_at = now_ms;
                entry.usn = -1;
            }
            drop(ledger);
            let lid = crate::progress::ledger_id(crate::progress::NIL_USER_ID, key);
            self.fake_revoke_pet_credit(crate::progress::NIL_USER_ID, &lid, now_ms);
        }
        Ok(())
    }

    fn unbury_deck(&self, _deck_id: i64, _now_ms: i64) -> CoreResult<()> {
        self.unbury_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn unbury_all(&self, _now_ms: i64) -> CoreResult<()> {
        self.unbury_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn get_last_unbury_day(&self) -> CoreResult<Option<i32>> {
        Ok(*self.last_unbury_day.lock().unwrap())
    }

    fn set_last_unbury_day(&self, day: i32, _now_ms: i64) -> CoreResult<()> {
        *self.last_unbury_day.lock().unwrap() = Some(day);
        Ok(())
    }

    fn set_card_flag(&self, _card_ids: &[i64], _flag: u8, _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn deck_card_ids(&self, deck_ids: &[i64]) -> CoreResult<Vec<i64>> {
        let mut ids: Vec<i64> = self
            .cards
            .lock()
            .unwrap()
            .iter()
            .filter(|c| deck_ids.contains(&c.deck_id))
            .map(|c| c.id)
            .collect();
        ids.sort_unstable();
        Ok(ids)
    }

    fn forget_cards(
        &self,
        _card_ids: &[i64],
        _reset_counts: bool,
        _now_ms: i64,
    ) -> CoreResult<Vec<Card>> {
        Ok(vec![])
    }

    fn set_due_date(
        &self,
        _card_ids: &[i64],
        _min_days: u32,
        _max_days: u32,
        _today: i32,
        _now_ms: i64,
    ) -> CoreResult<Vec<Card>> {
        Ok(vec![])
    }

    fn reposition_new_cards(
        &self,
        _card_ids: &[i64],
        _start: i64,
        _step: i64,
        _shuffle: bool,
        _shift_existing: bool,
        _now_ms: i64,
    ) -> CoreResult<Vec<Card>> {
        Ok(vec![])
    }

    fn restore_cards(&self, _cards: &[Card], _now_ms: i64) -> CoreResult<()> {
        Ok(())
    }

    fn revlogs_for_optimize(&self, _deck_id: Option<i64>) -> CoreResult<Vec<crate::model::Revlog>> {
        Ok(vec![])
    }

    fn workload_snapshot(&self, _deck_ids: &[i64]) -> CoreResult<crate::ports::WorkloadSnapshot> {
        Ok(crate::ports::WorkloadSnapshot::default())
    }
}

impl BrowseStore for FakeStorage {
    fn index_rows(&self) -> CoreResult<Vec<NoteIndexRow>> {
        Ok(vec![])
    }

    fn index_rows_for_notes(&self, _note_ids: &[i64]) -> CoreResult<Vec<NoteIndexRow>> {
        Ok(vec![])
    }

    #[allow(clippy::too_many_arguments)]
    fn search_cards(
        &self,
        _q: &str,
        _today: i32,
        _now_ms: i64,
        _limit: i64,
        _offset: i64,
        _sort_key: Option<&str>,
        _sort_asc: bool,
    ) -> CoreResult<Vec<crate::ipc::CardRow>> {
        Ok(vec![])
    }

    #[allow(clippy::too_many_arguments)]
    fn search_note_rows(
        &self,
        _q: &str,
        _today: i32,
        _now_ms: i64,
        _limit: i64,
        _offset: i64,
        _sort_key: Option<&str>,
        _sort_asc: bool,
    ) -> CoreResult<Vec<NoteRow>> {
        Ok(vec![])
    }

    fn count_cards(&self, _q: &str, _today: i32, _now_ms: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn count_note_rows(&self, _q: &str, _today: i32, _now_ms: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn preview_find_replace(
        &self,
        _note_ids: &[i64],
        _field_name: Option<&str>,
        _find: &str,
        _use_regex: bool,
        _case_sensitive: bool,
    ) -> CoreResult<FindReplacePreview> {
        Ok(FindReplacePreview {
            notes_matched: 0,
            occurrences: 0,
        })
    }

    fn find_replace_notes(
        &self,
        _note_ids: &[i64],
        _field_name: Option<&str>,
        _find: &str,
        _replace: &str,
        _use_regex: bool,
        _case_sensitive: bool,
        _now_ms: i64,
    ) -> CoreResult<Vec<NoteSnapshot>> {
        Ok(vec![])
    }

    fn load_quality_notes(
        &self,
        _deck_id: Option<i64>,
        _note_ids: Option<&[i64]>,
        _leeches_only: bool,
        _limit: u32,
    ) -> CoreResult<Vec<crate::ipc::QualityScanNote>> {
        Ok(vec![])
    }

    fn apply_quality_fixes(
        &self,
        _edits: &[crate::ipc::QualityNoteEdit],
        _now_ms: i64,
    ) -> CoreResult<Vec<NoteSnapshot>> {
        Ok(vec![])
    }

    fn find_duplicates(
        &self,
        _notetype_id: i64,
        _field_ord: i64,
    ) -> CoreResult<Vec<DuplicateGroup>> {
        Ok(vec![])
    }

    fn list_tags(&self) -> CoreResult<Vec<String>> {
        Ok(vec![])
    }

    fn list_tag_counts(&self) -> CoreResult<Vec<crate::ipc::TagCount>> {
        Ok(vec![])
    }

    fn rename_tag(&self, _old: &str, _new: &str, _now: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn delete_tag(&self, _tag: &str, _now: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn merge_tags(&self, _src: &[String], _tgt: &str, _now: i64) -> CoreResult<()> {
        Ok(())
    }
}

impl MaintenanceStore for FakeStorage {
    fn schema_version(&self) -> CoreResult<i64> {
        Ok(1)
    }

    fn ensure_collection(&self, _now_ms: i64) -> CoreResult<i64> {
        if self.fail_ensure_collection.load(Ordering::SeqCst) {
            return Err(CoreError::Storage("bad created".into()));
        }
        Ok(0)
    }

    fn integrity_check(&self, _now_ms: i64) -> CoreResult<Vec<String>> {
        Ok(vec![])
    }

    fn optimize(&self) -> CoreResult<()> {
        Ok(())
    }

    fn note_media_refs(&self) -> CoreResult<Vec<String>> {
        Ok(vec![])
    }

    fn note_media_ref_counts(&self) -> CoreResult<Vec<(String, u32)>> {
        Ok(self.media_ref_counts.lock().unwrap().clone())
    }

    fn note_media_ref_counts_matching(
        &self,
        query: &str,
        _today: i32,
        _now_ms: i64,
    ) -> CoreResult<Vec<(String, u32)>> {
        if query.trim().is_empty() {
            return self.note_media_ref_counts();
        }
        Ok(self
            .media_ref_counts_by_query
            .lock()
            .unwrap()
            .get(query)
            .cloned()
            .unwrap_or_default())
    }

    fn rewrite_media_ref(&self, _old_name: &str, _new_name: &str, _now_ms: i64) -> CoreResult<u32> {
        Ok(0)
    }

    fn backup_db(&self, _dest: &std::path::Path) -> CoreResult<()> {
        Ok(())
    }
}

impl SyncStore for FakeStorage {
    fn export_delta(&self) -> CoreResult<crate::sync::SyncDelta> {
        Ok(crate::sync::SyncDelta::default())
    }

    fn apply_sync_delta(
        &self,
        _delta: &crate::sync::SyncDelta,
        _new_usn: i64,
        _now_ms: i64,
    ) -> CoreResult<crate::sync::MergeSummary> {
        Ok(crate::sync::MergeSummary::default())
    }

    fn get_sync_state(&self, key: &str) -> CoreResult<Option<String>> {
        Ok(self.sync_state.lock().unwrap().get(key).cloned())
    }

    fn set_sync_state(&self, key: &str, value: &str) -> CoreResult<()> {
        self.sync_state
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
        Ok(())
    }
}

impl ProgressStore for FakeStorage {
    fn progress_totals(
        &self,
        user_id: &str,
        today_start_ms: i64,
        today_end_ms: i64,
    ) -> CoreResult<crate::progress::ProgressTotals> {
        let ledger = self.progress_ledger.lock().unwrap();
        let mut totals = crate::progress::ProgressTotals::default();
        for e in ledger
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
        {
            let xp = e.xp.max(0) as u64;
            let gold = e.gold_cents.max(0) as u64;
            totals.total_xp += xp;
            totals.gold_cents += gold;
            if e.created_at >= today_start_ms && e.created_at < today_end_ms {
                totals.today_xp += xp;
                totals.today_gold_cents += gold;
                if e.source_key.starts_with("task_done:") {
                    totals.tasks_rewarded_today += 1;
                }
            }
        }
        Ok(totals)
    }

    fn get_active_ledger_reward(
        &self,
        user_id: &str,
        source_key: &str,
    ) -> CoreResult<Option<crate::progress::RewardGrant>> {
        let ledger = self.progress_ledger.lock().unwrap();
        Ok(ledger
            .iter()
            .find(|e| e.user_id == user_id && e.source_key == source_key && e.deleted_at.is_none())
            .map(|e| crate::progress::RewardGrant {
                id: e.id.clone(),
                user_id: e.user_id.clone(),
                source_key: e.source_key.clone(),
                xp: e.xp,
                gold_cents: e.gold_cents,
                now_ms: e.created_at,
            }))
    }

    fn deck_review_count_in_window(
        &self,
        deck_id: i64,
        start_ms: i64,
        end_ms: i64,
    ) -> CoreResult<u32> {
        let decks = self.decks.lock().unwrap();
        let deck_pairs: Vec<(i64, Option<i64>)> =
            decks.iter().map(|d| (d.id, d.parent_id)).collect();
        let subtree = crate::progress::deck_subtree_ids(&deck_pairs, deck_id);
        let cards = self.cards.lock().unwrap();
        let card_decks: std::collections::HashMap<i64, i64> =
            cards.iter().map(|c| (c.id, c.deck_id)).collect();
        let revlogs = self.revlogs.lock().unwrap();
        let revlog_inputs: Vec<crate::progress::StudyRevlogInput> = revlogs
            .iter()
            .map(|r| crate::progress::StudyRevlogInput {
                id: r.id,
                card_id: r.card_id,
                ease: r.ease,
                taken_ms: r.taken_ms,
                review_kind: r.review_kind,
            })
            .collect();
        Ok(crate::progress::count_deck_reviews_in_window(
            &revlog_inputs,
            &card_decks,
            &subtree,
            start_ms,
            end_ms,
        ))
    }

    fn yesterday_activity(
        &self,
        user_id: &str,
        yesterday_day: i32,
        yesterday_start_ms: i64,
        yesterday_end_ms: i64,
    ) -> CoreResult<crate::progress::YesterdayActivity> {
        let reviews = self
            .revlogs
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                r.id >= yesterday_start_ms
                    && r.id < yesterday_end_ms
                    && (0..=3).contains(&r.review_kind)
            })
            .count() as u32;
        let tasks_completed = self
            .tasks
            .lock()
            .unwrap()
            .iter()
            .filter(|t| {
                t.user_id == user_id
                    && t.deleted_at.is_none()
                    && t.completed_day == Some(yesterday_day)
            })
            .count() as u32;
        let habits_completed = self
            .habit_logs
            .lock()
            .unwrap()
            .iter()
            .filter(|l| {
                l.user_id == user_id
                    && l.deleted_at.is_none()
                    && l.day_index == yesterday_day
                    && l.completed
            })
            .count() as u32;
        let mut xp = 0_u64;
        let mut gold_cents = 0_u64;
        for e in self.progress_ledger.lock().unwrap().iter().filter(|e| {
            e.user_id == user_id
                && e.deleted_at.is_none()
                && e.created_at >= yesterday_start_ms
                && e.created_at < yesterday_end_ms
        }) {
            xp = xp.saturating_add(e.xp.max(0) as u64);
            gold_cents = gold_cents.saturating_add(e.gold_cents.max(0) as u64);
        }
        Ok(crate::progress::YesterdayActivity {
            reviews,
            tasks_completed,
            habits_completed,
            xp,
            gold_cents,
        })
    }

    fn progress_history(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(Vec<crate::progress::ProgressDay>, usize)> {
        let ledger = self.progress_ledger.lock().unwrap();
        let rewards = ledger
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .map(|e| crate::progress::LedgerRewardInput {
                source_key: e.source_key.clone(),
                xp: e.xp,
                gold_cents: e.gold_cents,
                created_at: e.created_at,
            });
        Ok(crate::progress::aggregate_progress_history(
            rewards,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        ))
    }

    fn study_days(
        &self,
        user_id: &str,
        limit: u32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(Vec<crate::progress::StudyDay>, usize)> {
        let decks = self.decks.lock().unwrap();
        let top_lookup = crate::progress::build_top_deck_lookup(
            decks.iter().map(|d| (d.id, d.name.clone(), d.parent_id)),
        );
        let cards = self.cards.lock().unwrap();
        let card_top_decks: std::collections::HashMap<i64, i64> = cards
            .iter()
            .filter_map(|c| {
                top_lookup
                    .get(&c.deck_id)
                    .map(|&(top_id, _)| (c.id, top_id))
            })
            .collect();
        let revlogs = self.revlogs.lock().unwrap();
        let revlog_inputs = revlogs.iter().map(|r| crate::progress::StudyRevlogInput {
            id: r.id,
            card_id: r.card_id,
            ease: r.ease,
            taken_ms: r.taken_ms,
            review_kind: r.review_kind,
        });
        let tasks = self.tasks.lock().unwrap();
        let completed_task_days: Vec<i32> = tasks
            .iter()
            .filter(|t| t.user_id == user_id && t.deleted_at.is_none())
            .filter_map(|t| t.completed_day)
            .collect();
        let habit_logs = self.habit_logs.lock().unwrap();
        let completed_habit_days: Vec<i32> = habit_logs
            .iter()
            .filter(|l| l.user_id == user_id && l.deleted_at.is_none() && l.completed)
            .map(|l| l.day_index)
            .collect();
        let ledger = self.progress_ledger.lock().unwrap();
        let rewards = ledger
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .map(|e| crate::progress::LedgerRewardInput {
                source_key: e.source_key.clone(),
                xp: e.xp,
                gold_cents: e.gold_cents,
                created_at: e.created_at,
            });
        Ok(crate::progress::aggregate_study_days(
            revlog_inputs,
            &card_top_decks,
            completed_task_days,
            completed_habit_days,
            rewards,
            limit,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        ))
    }

    fn progress_by_deck(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        now_ms: i64,
        created_ms: i64,
    ) -> CoreResult<(Vec<crate::progress::DeckProgress>, usize)> {
        let decks = self.decks.lock().unwrap();
        let deck_inputs: Vec<(i64, String, Option<i64>)> = decks
            .iter()
            .map(|d| (d.id, d.name.clone(), d.parent_id))
            .collect();
        let top_lookup = crate::progress::build_top_deck_lookup(deck_inputs.clone());
        let habits = self.habits.lock().unwrap();
        let habit_top_decks: std::collections::HashMap<String, i64> = habits
            .iter()
            .filter(|h| h.user_id == user_id && h.deleted_at.is_none())
            .filter_map(|h| {
                h.deck_id.and_then(|did| {
                    top_lookup
                        .get(&did)
                        .map(|&(top_id, _)| (h.id.clone(), top_id))
                })
            })
            .collect();
        let cards = self.cards.lock().unwrap();
        let card_inputs: Vec<crate::progress::DeckCardInput> = cards
            .iter()
            .map(|c| crate::progress::DeckCardInput {
                card_id: c.id,
                deck_id: c.deck_id,
                ctype: c.ctype,
                queue: c.queue,
                interval: c.interval,
            })
            .collect();
        let mut revlogs = self.revlogs.lock().unwrap().clone();
        revlogs.sort_by_key(|r| r.id);
        let revlog_inputs = revlogs.iter().map(|r| crate::progress::StudyRevlogInput {
            id: r.id,
            card_id: r.card_id,
            ease: r.ease,
            taken_ms: r.taken_ms,
            review_kind: r.review_kind,
        });
        let ledger = self.progress_ledger.lock().unwrap();
        let rewards = ledger
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .map(|e| crate::progress::LedgerRewardInput {
                source_key: e.source_key.clone(),
                xp: e.xp,
                gold_cents: e.gold_cents,
                created_at: e.created_at,
            });
        Ok(crate::progress::aggregate_progress_by_deck(
            deck_inputs,
            card_inputs,
            revlog_inputs,
            &habit_top_decks,
            rewards,
            tz_offset_minutes,
            rollover_hour,
            now_ms,
            created_ms,
        ))
    }
}

impl ProductivityStore for FakeStorage {
    fn new_uuid(&self) -> String {
        let n = self.next_uuid.fetch_add(1, Ordering::SeqCst) + 1;
        format!("{n:08x}-0000-4000-8000-000000000000")
    }

    fn list_task_lists(&self, user_id: &str) -> CoreResult<Vec<crate::productivity::TaskList>> {
        let mut out: Vec<_> = self
            .task_lists
            .lock()
            .unwrap()
            .iter()
            .filter(|l| l.user_id == user_id && l.deleted_at.is_none())
            .cloned()
            .collect();
        out.sort_by(|a, b| {
            a.sort_order
                .cmp(&b.sort_order)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    fn upsert_task_list(&self, list: &crate::productivity::TaskList) -> CoreResult<()> {
        let mut lists = self.task_lists.lock().unwrap();
        if let Some(existing) = lists.iter_mut().find(|l| l.id == list.id) {
            *existing = list.clone();
        } else {
            lists.push(list.clone());
        }
        Ok(())
    }

    fn soft_delete_task_list(
        &self,
        user_id: &str,
        id: &str,
        now_ms: i64,
    ) -> CoreResult<Vec<String>> {
        let mut lists = self.task_lists.lock().unwrap();
        let list = lists
            .iter_mut()
            .find(|l| l.user_id == user_id && l.id == id && l.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("task list '{id}' not found")))?;
        list.deleted_at = Some(now_ms);
        list.updated_at = now_ms;
        list.usn = -1;
        drop(lists);

        let mut tasks = self.tasks.lock().unwrap();
        let mut moved = Vec::new();
        for t in tasks.iter_mut().filter(|t| {
            t.user_id == user_id && t.list_id.as_deref() == Some(id) && t.deleted_at.is_none()
        }) {
            moved.push(t.id.clone());
            t.list_id = None;
            t.updated_at = now_ms;
            t.usn = -1;
        }
        moved.sort();
        Ok(moved)
    }

    fn restore_task_list(
        &self,
        user_id: &str,
        id: &str,
        task_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut lists = self.task_lists.lock().unwrap();
        let list = lists
            .iter_mut()
            .find(|l| l.user_id == user_id && l.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("task list '{id}' not found")))?;
        list.deleted_at = None;
        list.updated_at = now_ms;
        list.usn = -1;
        drop(lists);

        let mut tasks = self.tasks.lock().unwrap();
        for t in tasks.iter_mut().filter(|t| {
            t.user_id == user_id
                && t.deleted_at.is_none()
                && task_ids.iter().any(|tid| tid == &t.id)
        }) {
            t.list_id = Some(id.to_string());
            t.updated_at = now_ms;
            t.usn = -1;
        }
        Ok(())
    }

    fn list_tasks(
        &self,
        user_id: &str,
        include_completed: bool,
    ) -> CoreResult<Vec<crate::productivity::TaskItem>> {
        let mut out: Vec<_> = self
            .tasks
            .lock()
            .unwrap()
            .iter()
            .filter(|t| {
                t.user_id == user_id
                    && t.deleted_at.is_none()
                    && (include_completed || t.completed_at.is_none())
            })
            .cloned()
            .collect();
        out.sort_by(|a, b| {
            a.sort_order
                .cmp(&b.sort_order)
                .then_with(|| a.created_at.cmp(&b.created_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    fn get_task(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<crate::productivity::TaskItem>> {
        Ok(self
            .tasks
            .lock()
            .unwrap()
            .iter()
            .find(|t| t.user_id == user_id && t.id == id && t.deleted_at.is_none())
            .cloned())
    }

    fn upsert_task(&self, task: &crate::productivity::TaskItem) -> CoreResult<()> {
        let mut tasks = self.tasks.lock().unwrap();
        if let Some(existing) = tasks.iter_mut().find(|t| t.id == task.id) {
            *existing = task.clone();
        } else {
            tasks.push(task.clone());
        }
        Ok(())
    }

    fn set_task_completion(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<bool> {
        let mut tasks = self.tasks.lock().unwrap();
        let task = tasks
            .iter_mut()
            .find(|t| t.user_id == user_id && t.id == id && t.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        task.completed_at = completed_at;
        task.completed_day = completed_day;
        task.updated_at = now_ms;
        task.usn = -1;
        drop(tasks);

        let (granted, revoked) = fake_apply_ledger_hook(
            &self.progress_ledger,
            user_id,
            reward,
            revoke_source_key,
            now_ms,
        );
        if revoked {
            if let Some(key) = revoke_source_key {
                let lid = crate::progress::ledger_id(user_id, key);
                self.fake_revoke_pet_credit(user_id, &lid, now_ms);
            }
        }
        if granted {
            if let Some(r) = reward {
                self.fake_grant_pet_credit(
                    user_id,
                    &r.id,
                    crate::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                    now_ms,
                );
            }
        }
        Ok(granted)
    }

    fn reorder_tasks(
        &self,
        user_id: &str,
        items: &[crate::productivity::TaskOrderItem],
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut tasks = self.tasks.lock().unwrap();
        for item in items {
            if !tasks
                .iter()
                .any(|t| t.user_id == user_id && t.id == item.id && t.deleted_at.is_none())
            {
                return Err(CoreError::NotFound(format!("task '{}' not found", item.id)));
            }
        }
        for item in items {
            if let Some(task) = tasks
                .iter_mut()
                .find(|t| t.user_id == user_id && t.id == item.id && t.deleted_at.is_none())
            {
                task.sort_order = item.sort_order;
                task.updated_at = now_ms;
                task.usn = -1;
            }
        }
        Ok(())
    }

    fn reschedule_overdue_tasks(
        &self,
        user_id: &str,
        today_date: &str,
        target_date: &str,
        now_ms: i64,
    ) -> CoreResult<u32> {
        let mut tasks = self.tasks.lock().unwrap();
        let mut count = 0_u32;
        for task in tasks.iter_mut() {
            if task.user_id == user_id
                && task.deleted_at.is_none()
                && task.completed_at.is_none()
                && task.due_date.as_deref().is_some_and(|d| d < today_date)
            {
                task.due_date = Some(target_date.to_string());
                task.updated_at = now_ms;
                task.usn = -1;
                count += 1;
            }
        }
        Ok(count)
    }

    fn soft_delete_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        let mut tasks = self.tasks.lock().unwrap();
        let task = tasks
            .iter_mut()
            .find(|t| t.user_id == user_id && t.id == id && t.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        task.deleted_at = Some(now_ms);
        task.updated_at = now_ms;
        task.usn = -1;
        Ok(())
    }

    fn restore_task(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        let mut tasks = self.tasks.lock().unwrap();
        let task = tasks
            .iter_mut()
            .find(|t| t.user_id == user_id && t.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("task '{id}' not found")))?;
        task.deleted_at = None;
        task.updated_at = now_ms;
        task.usn = -1;
        Ok(())
    }

    fn list_matrix_quadrants(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<crate::productivity::MatrixQuadrant>> {
        let mut quads = self.matrix_quadrants.lock().unwrap();
        if !quads.iter().any(|q| q.user_id == user_id) {
            quads.extend(crate::productivity::default_matrix_quadrants(user_id));
        }
        let mut out: Vec<_> = quads
            .iter()
            .filter(|q| q.user_id == user_id && q.deleted_at.is_none())
            .cloned()
            .collect();
        out.sort_by(|a, b| a.quadrant_key.as_str().cmp(b.quadrant_key.as_str()));
        Ok(out)
    }

    fn upsert_matrix_quadrant(&self, q: &crate::productivity::MatrixQuadrant) -> CoreResult<()> {
        let mut quads = self.matrix_quadrants.lock().unwrap();
        if !quads.iter().any(|existing| existing.user_id == q.user_id) {
            quads.extend(crate::productivity::default_matrix_quadrants(&q.user_id));
        }
        if let Some(existing) = quads.iter_mut().find(|existing| {
            existing.user_id == q.user_id && existing.quadrant_key == q.quadrant_key
        }) {
            *existing = q.clone();
        } else {
            quads.push(q.clone());
        }
        Ok(())
    }

    fn list_habits(
        &self,
        user_id: &str,
        include_archived: bool,
    ) -> CoreResult<Vec<crate::productivity::Habit>> {
        let mut out: Vec<_> = self
            .habits
            .lock()
            .unwrap()
            .iter()
            .filter(|h| {
                h.user_id == user_id
                    && h.deleted_at.is_none()
                    && (include_archived || h.archived_at.is_none())
            })
            .cloned()
            .collect();
        out.sort_by(|a, b| {
            a.sort_order
                .cmp(&b.sort_order)
                .then_with(|| a.created_at.cmp(&b.created_at))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(out)
    }

    fn get_habit(&self, user_id: &str, id: &str) -> CoreResult<Option<crate::productivity::Habit>> {
        Ok(self
            .habits
            .lock()
            .unwrap()
            .iter()
            .find(|h| h.user_id == user_id && h.id == id && h.deleted_at.is_none())
            .cloned())
    }

    fn upsert_habit(&self, habit: &crate::productivity::Habit) -> CoreResult<()> {
        let mut habits = self.habits.lock().unwrap();
        if let Some(existing) = habits.iter_mut().find(|h| h.id == habit.id) {
            *existing = habit.clone();
        } else {
            habits.push(habit.clone());
        }
        Ok(())
    }

    fn soft_delete_habit(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<Vec<String>> {
        let mut habits = self.habits.lock().unwrap();
        let habit = habits
            .iter_mut()
            .find(|h| h.user_id == user_id && h.id == id && h.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("habit '{id}' not found")))?;
        habit.deleted_at = Some(now_ms);
        habit.updated_at = now_ms;
        habit.usn = -1;
        drop(habits);

        let mut logs = self.habit_logs.lock().unwrap();
        let mut log_ids = Vec::new();
        for log in logs
            .iter_mut()
            .filter(|l| l.user_id == user_id && l.habit_id == id && l.deleted_at.is_none())
        {
            log_ids.push(log.id.clone());
            log.deleted_at = Some(now_ms);
            log.updated_at = now_ms;
            log.usn = -1;
        }
        log_ids.sort();
        Ok(log_ids)
    }

    fn restore_habit(
        &self,
        user_id: &str,
        id: &str,
        log_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut habits = self.habits.lock().unwrap();
        let habit = habits
            .iter_mut()
            .find(|h| h.user_id == user_id && h.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("habit '{id}' not found")))?;
        habit.deleted_at = None;
        habit.updated_at = now_ms;
        habit.usn = -1;
        drop(habits);

        let mut logs = self.habit_logs.lock().unwrap();
        for log in logs
            .iter_mut()
            .filter(|l| l.user_id == user_id && log_ids.iter().any(|lid| lid == &l.id))
        {
            log.deleted_at = None;
            log.updated_at = now_ms;
            log.usn = -1;
        }
        Ok(())
    }

    fn list_habit_logs_range(
        &self,
        user_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<crate::productivity::HabitLog>> {
        let mut out: Vec<_> = self
            .habit_logs
            .lock()
            .unwrap()
            .iter()
            .filter(|l| {
                l.user_id == user_id
                    && l.deleted_at.is_none()
                    && l.day_index >= from_day
                    && l.day_index <= to_day
            })
            .cloned()
            .collect();
        out.sort_by(|a, b| a.day_index.cmp(&b.day_index).then_with(|| a.id.cmp(&b.id)));
        Ok(out)
    }

    fn list_habit_logs_for_habit(
        &self,
        user_id: &str,
        habit_id: &str,
        from_day: i32,
        to_day: i32,
    ) -> CoreResult<Vec<crate::productivity::HabitLog>> {
        let mut out: Vec<_> = self
            .habit_logs
            .lock()
            .unwrap()
            .iter()
            .filter(|l| {
                l.user_id == user_id
                    && l.habit_id == habit_id
                    && l.deleted_at.is_none()
                    && l.day_index >= from_day
                    && l.day_index <= to_day
            })
            .cloned()
            .collect();
        out.sort_by(|a, b| a.day_index.cmp(&b.day_index).then_with(|| a.id.cmp(&b.id)));
        Ok(out)
    }

    fn upsert_habit_log(
        &self,
        log: &crate::productivity::HabitLog,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
    ) -> CoreResult<crate::productivity::HabitLogWriteOutcome> {
        let mut logs = self.habit_logs.lock().unwrap();
        let previous = logs
            .iter()
            .find(|l| {
                l.user_id == log.user_id
                    && l.habit_id == log.habit_id
                    && l.day_index == log.day_index
            })
            .cloned();
        let created_at = match &previous {
            Some(p) if p.deleted_at.is_none() => p.created_at,
            _ => log.created_at,
        };
        let current = crate::productivity::HabitLog {
            created_at,
            ..log.clone()
        };
        if let Some(existing) = logs.iter_mut().find(|l| {
            l.user_id == current.user_id
                && l.habit_id == current.habit_id
                && l.day_index == current.day_index
        }) {
            *existing = current.clone();
        } else {
            logs.push(current.clone());
        }
        drop(logs);

        let (reward_granted, reward_revoked) = fake_apply_ledger_hook(
            &self.progress_ledger,
            &current.user_id,
            reward,
            revoke_source_key,
            current.updated_at,
        );
        Ok(crate::productivity::HabitLogWriteOutcome {
            previous,
            current,
            reward_granted,
            reward_revoked,
        })
    }

    fn restore_habit_log_snapshot(
        &self,
        user_id: &str,
        habit_id: &str,
        day_index: i32,
        previous: Option<&crate::productivity::HabitLog>,
        restore_reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut logs = self.habit_logs.lock().unwrap();
        if let Some(entry) = logs
            .iter_mut()
            .find(|l| l.user_id == user_id && l.habit_id == habit_id && l.day_index == day_index)
        {
            match previous {
                Some(prev) => {
                    entry.logged_value = prev.logged_value;
                    entry.goal_target = prev.goal_target;
                    entry.completed = prev.completed;
                    entry.status = prev.status;
                    entry.mood = prev.mood;
                    entry.note = prev.note.clone();
                    entry.deleted_at = prev.deleted_at;
                    entry.updated_at = now_ms;
                    entry.usn = -1;
                }
                None => {
                    entry.deleted_at = Some(now_ms);
                    entry.updated_at = now_ms;
                    entry.usn = -1;
                }
            }
        }
        drop(logs);

        let (_, revoked) = fake_apply_ledger_hook(
            &self.progress_ledger,
            user_id,
            restore_reward,
            revoke_source_key,
            now_ms,
        );
        if revoked {
            if let Some(key) = revoke_source_key {
                let lid = crate::progress::ledger_id(user_id, key);
                self.fake_revoke_pet_credit(user_id, &lid, now_ms);
            }
        }
        if let Some(r) = restore_reward {
            self.fake_grant_pet_credit(
                user_id,
                &r.id,
                crate::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                now_ms,
            );
        }
        let freeze_key = format!("freeze_use:{habit_id}:{day_index}");
        if previous.is_some_and(|p| p.status == crate::productivity::HabitLogStatus::Frozen) {
            if self.fake_freeze_tokens_held(user_id) >= 1 {
                self.fake_upsert_freeze_entry(user_id, &freeze_key, -1, now_ms);
            }
        } else {
            self.fake_soft_delete_freeze_entry(user_id, &freeze_key, now_ms);
        }
        Ok(())
    }

    fn list_calendar_events(
        &self,
        user_id: &str,
    ) -> CoreResult<Vec<crate::productivity::CalendarEvent>> {
        let mut out: Vec<_> = self
            .calendar_events
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .cloned()
            .collect();
        out.sort_by(|a, b| a.start_ms.cmp(&b.start_ms).then_with(|| a.id.cmp(&b.id)));
        Ok(out)
    }

    fn get_calendar_event(
        &self,
        user_id: &str,
        id: &str,
    ) -> CoreResult<Option<crate::productivity::CalendarEvent>> {
        Ok(self
            .calendar_events
            .lock()
            .unwrap()
            .iter()
            .find(|e| e.user_id == user_id && e.id == id && e.deleted_at.is_none())
            .cloned())
    }

    fn upsert_calendar_event(&self, event: &crate::productivity::CalendarEvent) -> CoreResult<()> {
        let mut events = self.calendar_events.lock().unwrap();
        if let Some(existing) = events.iter_mut().find(|e| e.id == event.id) {
            *existing = event.clone();
        } else {
            events.push(event.clone());
        }
        Ok(())
    }

    fn soft_delete_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        let mut events = self.calendar_events.lock().unwrap();
        let ev = events
            .iter_mut()
            .find(|e| e.user_id == user_id && e.id == id && e.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("calendar event '{id}' not found")))?;
        ev.deleted_at = Some(now_ms);
        ev.updated_at = now_ms;
        ev.usn = -1;
        Ok(())
    }

    fn restore_calendar_event(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        let mut events = self.calendar_events.lock().unwrap();
        let ev = events
            .iter_mut()
            .find(|e| e.user_id == user_id && e.id == id)
            .ok_or_else(|| CoreError::NotFound(format!("calendar event '{id}' not found")))?;
        ev.deleted_at = None;
        ev.updated_at = now_ms;
        ev.usn = -1;
        Ok(())
    }
}

impl GameStore for FakeStorage {
    fn spent_gold_cents(&self, user_id: &str) -> CoreResult<u64> {
        Ok(self.fake_spent_gold_cents(user_id))
    }

    fn freeze_tokens_held(&self, user_id: &str) -> CoreResult<u32> {
        Ok(self.fake_freeze_tokens_held(user_id))
    }

    fn load_game_snapshot(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<crate::game::GameSnapshot> {
        let (total_xp, earned_gold_cents) = self.fake_earned_totals(user_id);
        let spent_gold_cents = self.fake_spent_gold_cents(user_id);
        let active_days =
            self.fake_active_ledger_days(user_id, tz_offset_minutes, rollover_hour, created_ms);
        let frozen_days = self.fake_frozen_study_days(user_id);
        let (study_streak, studied_today) =
            crate::game::study_streak_with_freezes(&active_days, &frozen_days, today);
        let freeze_tokens_held = self.fake_freeze_tokens_held(user_id);

        let avatar = self
            .avatar_profiles
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.user_id == user_id && p.deleted_at.is_none())
            .map(|p| crate::game::AvatarProfileDto {
                body_tone: p.body_tone.clone(),
                hair_style: p.hair_style.clone(),
                hair_color: p.hair_color.clone(),
                starter_outfit: p.starter_outfit.clone(),
                starter_accessory: p.starter_accessory.clone(),
            })
            .unwrap_or_default();

        let equipped = self
            .avatar_equipped
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .filter_map(|e| {
                crate::game::EquipmentSlot::parse(&e.slot).ok().map(|slot| {
                    crate::game::EquippedSlotDto {
                        slot,
                        item_key: e.item_key.clone(),
                    }
                })
            })
            .collect();

        let mut owned_item_keys: Vec<String> = self
            .inventory_items
            .lock()
            .unwrap()
            .iter()
            .filter(|i| i.user_id == user_id && i.deleted_at.is_none())
            .map(|i| i.item_key.clone())
            .collect();
        owned_item_keys.sort();

        Ok(crate::game::GameSnapshot {
            total_xp,
            earned_gold_cents,
            spent_gold_cents,
            study_streak,
            studied_today,
            freeze_tokens_held,
            avatar,
            equipped,
            owned_item_keys,
        })
    }

    fn update_avatar_profile(
        &self,
        user_id: &str,
        input: &crate::game::AvatarProfileInput,
        now_ms: i64,
    ) -> CoreResult<crate::game::AvatarProfileDto> {
        let mut profiles = self.avatar_profiles.lock().unwrap();
        let id = crate::game::game_entity_id("avatar_profile", user_id, "default");
        if let Some(p) = profiles.iter_mut().find(|p| p.user_id == user_id) {
            p.body_tone = input.body_tone.clone();
            p.hair_style = input.hair_style.clone();
            p.hair_color = input.hair_color.clone();
            p.starter_outfit = input.starter_outfit.clone();
            p.starter_accessory = input.starter_accessory.clone();
            p.updated_at = now_ms;
            p.deleted_at = None;
            p.usn = -1;
        } else {
            profiles.push(crate::game::AvatarProfile {
                id,
                user_id: user_id.to_string(),
                body_tone: input.body_tone.clone(),
                hair_style: input.hair_style.clone(),
                hair_color: input.hair_color.clone(),
                starter_outfit: input.starter_outfit.clone(),
                starter_accessory: input.starter_accessory.clone(),
                created_at: now_ms,
                updated_at: now_ms,
                deleted_at: None,
                usn: -1,
            });
        }
        Ok(crate::game::AvatarProfileDto {
            body_tone: input.body_tone.clone(),
            hair_style: input.hair_style.clone(),
            hair_color: input.hair_color.clone(),
            starter_outfit: input.starter_outfit.clone(),
            starter_accessory: input.starter_accessory.clone(),
        })
    }

    fn equip_game_item(
        &self,
        user_id: &str,
        slot: crate::game::EquipmentSlot,
        item_key: &str,
        now_ms: i64,
    ) -> CoreResult<()> {
        if crate::game::cosmetic_slot_for_item(item_key) != Some(slot) {
            return Err(CoreError::Invalid(
                "item does not belong to this equipment slot".into(),
            ));
        }
        let owned = self
            .inventory_items
            .lock()
            .unwrap()
            .iter()
            .any(|i| i.user_id == user_id && i.item_key == item_key && i.deleted_at.is_none());
        if !owned {
            return Err(CoreError::Invalid("item is not owned".into()));
        }
        self.fake_set_equipped_slot(user_id, slot, Some(item_key.to_string()), now_ms);
        Ok(())
    }

    fn unequip_game_slot(
        &self,
        user_id: &str,
        slot: crate::game::EquipmentSlot,
        now_ms: i64,
    ) -> CoreResult<()> {
        self.fake_set_equipped_slot(user_id, slot, None, now_ms);
        Ok(())
    }

    fn buy_shop_item(
        &self,
        user_id: &str,
        item_key: &str,
        client_tx_id: &str,
        now_ms: i64,
    ) -> CoreResult<String> {
        let item = crate::game::catalog_item(item_key)
            .ok_or_else(|| CoreError::Invalid(format!("unknown shop item '{item_key}'")))?;
        match item.kind {
            crate::game::SpendKind::Cosmetic => {
                let idemp = format!("shop_buy:{item_key}");
                let active_spend = self
                    .gold_spend_ledger
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|s| {
                        s.user_id == user_id && s.idempotency_key == idemp && s.deleted_at.is_none()
                    })
                    .map(|s| s.id.clone());
                let active_inv = self.inventory_items.lock().unwrap().iter().any(|i| {
                    i.user_id == user_id && i.item_key == item_key && i.deleted_at.is_none()
                });
                if let (Some(spend_id), true) = (active_spend, active_inv) {
                    return Ok(spend_id);
                }
                if active_inv {
                    return Err(CoreError::Invalid("cosmetic item is already owned".into()));
                }
                let spend_id = self.fake_spend_gold(
                    user_id,
                    crate::game::SpendKind::Cosmetic,
                    item_key,
                    &idemp,
                    item.price_cents,
                    now_ms,
                )?;
                self.fake_upsert_inventory_item(user_id, item_key, "shop", now_ms);
                Ok(spend_id)
            }
            crate::game::SpendKind::FreezeToken => {
                let idemp = format!("freeze_buy:{client_tx_id}");
                if let Some(existing_id) = self
                    .gold_spend_ledger
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|s| {
                        s.user_id == user_id && s.idempotency_key == idemp && s.deleted_at.is_none()
                    })
                    .map(|s| s.id.clone())
                {
                    return Ok(existing_id);
                }
                if self.fake_freeze_tokens_held(user_id) >= crate::game::FREEZE_TOKEN_CAP {
                    return Err(CoreError::Invalid("streak freeze token cap reached".into()));
                }
                let spend_id = self.fake_spend_gold(
                    user_id,
                    crate::game::SpendKind::FreezeToken,
                    item_key,
                    &idemp,
                    item.price_cents,
                    now_ms,
                )?;
                self.fake_upsert_freeze_entry(user_id, &idemp, 1, now_ms);
                Ok(spend_id)
            }
            _ => Err(CoreError::Invalid("item cannot be bought in shop".into())),
        }
    }

    fn refund_shop_purchase(&self, user_id: &str, spend_id: &str, now_ms: i64) -> CoreResult<()> {
        let mut spends = self.gold_spend_ledger.lock().unwrap();
        let idx = spends
            .iter()
            .position(|s| s.user_id == user_id && s.id == spend_id && s.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("purchase '{spend_id}' not found")))?;
        let row = spends[idx].clone();
        if now_ms < row.created_at || now_ms - row.created_at > crate::game::REFUND_WINDOW_MS {
            return Err(CoreError::Invalid("refund window has expired".into()));
        }
        let kind = crate::game::SpendKind::parse(&row.kind)?;
        if kind == crate::game::SpendKind::PathChange {
            return Err(CoreError::Invalid("path changes cannot be refunded".into()));
        }
        if kind == crate::game::SpendKind::FreezeToken && self.fake_freeze_tokens_held(user_id) < 1
        {
            return Err(CoreError::Invalid(
                "cannot refund an already used freeze token".into(),
            ));
        }
        spends[idx].deleted_at = Some(now_ms);
        spends[idx].updated_at = now_ms;
        spends[idx].usn = -1;
        drop(spends);

        match kind {
            crate::game::SpendKind::Cosmetic => {
                for item in self.inventory_items.lock().unwrap().iter_mut() {
                    if item.user_id == user_id
                        && item.item_key == row.ref_key
                        && item.deleted_at.is_none()
                    {
                        item.deleted_at = Some(now_ms);
                        item.updated_at = now_ms;
                        item.usn = -1;
                    }
                }
                for eq in self.avatar_equipped.lock().unwrap().iter_mut() {
                    if eq.user_id == user_id
                        && eq.deleted_at.is_none()
                        && eq.item_key.as_deref() == Some(row.ref_key.as_str())
                    {
                        eq.item_key = None;
                        eq.updated_at = now_ms;
                        eq.usn = -1;
                    }
                }
            }
            crate::game::SpendKind::FreezeToken => {
                self.fake_soft_delete_freeze_entry(user_id, &row.idempotency_key, now_ms);
            }
            crate::game::SpendKind::CustomReward => {}
            crate::game::SpendKind::PathChange => {}
        }
        Ok(())
    }

    fn list_custom_rewards(&self, user_id: &str) -> CoreResult<Vec<crate::game::CustomRewardDto>> {
        let spends = self.gold_spend_ledger.lock().unwrap();
        let mut rewards: Vec<_> = self
            .custom_rewards
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.user_id == user_id && r.deleted_at.is_none())
            .cloned()
            .collect();
        rewards.sort_by(|a, b| {
            a.sort_order
                .cmp(&b.sort_order)
                .then_with(|| a.created_at.cmp(&b.created_at))
        });
        Ok(rewards
            .into_iter()
            .map(|r| {
                let claim_count = spends
                    .iter()
                    .filter(|s| {
                        s.user_id == user_id
                            && s.deleted_at.is_none()
                            && s.kind == crate::game::SpendKind::CustomReward.as_str()
                            && s.ref_key == r.id
                    })
                    .count() as u32;
                crate::game::CustomRewardDto {
                    id: r.id,
                    title: r.title,
                    notes: r.notes,
                    cost_cents: r.cost_cents.max(0) as u64,
                    icon_key: r.icon_key,
                    sort_order: r.sort_order,
                    claim_count,
                }
            })
            .collect())
    }

    fn create_custom_reward(
        &self,
        user_id: &str,
        input: &crate::game::CustomRewardInput,
        now_ms: i64,
    ) -> CoreResult<crate::game::CustomRewardDto> {
        let mut rewards = self.custom_rewards.lock().unwrap();
        let active_count = rewards
            .iter()
            .filter(|r| r.user_id == user_id && r.deleted_at.is_none())
            .count();
        if active_count >= crate::game::MAX_CUSTOM_REWARDS {
            return Err(CoreError::Invalid(format!(
                "maximum of {} active custom rewards reached",
                crate::game::MAX_CUSTOM_REWARDS
            )));
        }
        let id = self.new_uuid();
        let sort_order = input.sort_order.unwrap_or(active_count as i32);
        rewards.push(crate::game::CustomReward {
            id: id.clone(),
            user_id: user_id.to_string(),
            title: input.title.clone(),
            notes: input.notes.clone(),
            cost_cents: input.cost_cents as i64,
            icon_key: input.icon_key.clone(),
            sort_order,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        Ok(crate::game::CustomRewardDto {
            id,
            title: input.title.clone(),
            notes: input.notes.clone(),
            cost_cents: input.cost_cents,
            icon_key: input.icon_key.clone(),
            sort_order,
            claim_count: 0,
        })
    }

    fn update_custom_reward(
        &self,
        user_id: &str,
        id: &str,
        input: &crate::game::CustomRewardInput,
        now_ms: i64,
    ) -> CoreResult<crate::game::CustomRewardDto> {
        let mut rewards = self.custom_rewards.lock().unwrap();
        let r = rewards
            .iter_mut()
            .find(|r| r.user_id == user_id && r.id == id && r.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("custom reward '{id}' not found")))?;
        r.title = input.title.clone();
        r.notes = input.notes.clone();
        r.cost_cents = input.cost_cents as i64;
        r.icon_key = input.icon_key.clone();
        if let Some(so) = input.sort_order {
            r.sort_order = so;
        }
        r.updated_at = now_ms;
        r.usn = -1;
        let sort_order = r.sort_order;
        drop(rewards);
        let claim_count = self
            .gold_spend_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|s| {
                s.user_id == user_id
                    && s.deleted_at.is_none()
                    && s.kind == crate::game::SpendKind::CustomReward.as_str()
                    && s.ref_key == id
            })
            .count() as u32;
        Ok(crate::game::CustomRewardDto {
            id: id.to_string(),
            title: input.title.clone(),
            notes: input.notes.clone(),
            cost_cents: input.cost_cents,
            icon_key: input.icon_key.clone(),
            sort_order,
            claim_count,
        })
    }

    fn delete_custom_reward(&self, user_id: &str, id: &str, now_ms: i64) -> CoreResult<()> {
        let mut rewards = self.custom_rewards.lock().unwrap();
        let r = rewards
            .iter_mut()
            .find(|r| r.user_id == user_id && r.id == id && r.deleted_at.is_none())
            .ok_or_else(|| CoreError::NotFound(format!("custom reward '{id}' not found")))?;
        r.deleted_at = Some(now_ms);
        r.updated_at = now_ms;
        r.usn = -1;
        Ok(())
    }

    fn claim_custom_reward(
        &self,
        user_id: &str,
        reward_id: &str,
        client_tx_id: &str,
        now_ms: i64,
    ) -> CoreResult<String> {
        let idemp = format!("reward_claim:{reward_id}:{client_tx_id}");
        if let Some(existing) = self
            .gold_spend_ledger
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.user_id == user_id && s.idempotency_key == idemp && s.deleted_at.is_none())
            .map(|s| s.id.clone())
        {
            return Ok(existing);
        }
        let cost_cents = self
            .custom_rewards
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.user_id == user_id && r.id == reward_id && r.deleted_at.is_none())
            .map(|r| r.cost_cents.max(0) as u64)
            .ok_or_else(|| CoreError::NotFound(format!("custom reward '{reward_id}' not found")))?;
        self.fake_spend_gold(
            user_id,
            crate::game::SpendKind::CustomReward,
            reward_id,
            &idemp,
            cost_cents,
            now_ms,
        )
    }

    fn list_spend_history(
        &self,
        user_id: &str,
        limit: u32,
        now_ms: i64,
    ) -> CoreResult<Vec<crate::game::SpendHistoryEntryDto>> {
        let held = self.fake_freeze_tokens_held(user_id);
        let rewards = self.custom_rewards.lock().unwrap();
        let mut entries: Vec<_> = self
            .gold_spend_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.user_id == user_id && s.deleted_at.is_none())
            .cloned()
            .collect();
        entries.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        entries.truncate(limit as usize);
        entries
            .into_iter()
            .map(|s| {
                let kind = crate::game::SpendKind::parse(&s.kind)?;
                let label = match kind {
                    crate::game::SpendKind::CustomReward => rewards
                        .iter()
                        .find(|r| r.id == s.ref_key)
                        .map(|r| r.title.clone())
                        .unwrap_or_else(|| s.ref_key.clone()),
                    _ => s.ref_key.clone(),
                };
                let within_window = now_ms >= s.created_at
                    && now_ms - s.created_at <= crate::game::REFUND_WINDOW_MS;
                let refundable = within_window
                    && match kind {
                        crate::game::SpendKind::Cosmetic | crate::game::SpendKind::CustomReward => {
                            true
                        }
                        crate::game::SpendKind::FreezeToken => held >= 1,
                        crate::game::SpendKind::PathChange => false,
                    };
                Ok(crate::game::SpendHistoryEntryDto {
                    spend_id: s.id,
                    kind,
                    ref_key: s.ref_key,
                    label,
                    amount_cents: s.amount_cents.max(0) as u64,
                    created_at: s.created_at,
                    refundable,
                })
            })
            .collect()
    }

    fn grant_unlocked_cosmetic(
        &self,
        user_id: &str,
        item_key: &str,
        now_ms: i64,
    ) -> CoreResult<bool> {
        if !crate::game::is_valid_cosmetic_key(item_key) {
            return Err(CoreError::Invalid(format!(
                "unknown cosmetic key '{item_key}'"
            )));
        }
        Ok(self.fake_upsert_inventory_item(user_id, item_key, "unlock", now_ms))
    }

    fn spend_gold(
        &self,
        user_id: &str,
        kind: crate::game::SpendKind,
        ref_key: &str,
        idempotency_key: &str,
        amount_cents: u64,
        now_ms: i64,
    ) -> CoreResult<String> {
        self.fake_spend_gold(
            user_id,
            kind,
            ref_key,
            idempotency_key,
            amount_cents,
            now_ms,
        )
    }

    fn upsert_habit_log_with_game(
        &self,
        log: &crate::productivity::HabitLog,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::HabitLogGameOutcome> {
        let freeze_key = format!("freeze_use:{}:{}", log.habit_id, log.day_index);
        let mut game_changed = false;

        if log.status == crate::productivity::HabitLogStatus::Frozen {
            let prev = self
                .habit_logs
                .lock()
                .unwrap()
                .iter()
                .find(|l| {
                    l.user_id == log.user_id
                        && l.habit_id == log.habit_id
                        && l.day_index == log.day_index
                        && l.deleted_at.is_none()
                })
                .cloned();
            if let Some(p) = prev {
                if p.completed {
                    return Err(CoreError::Invalid(
                        "cannot freeze an already completed habit day".into(),
                    ));
                }
                if p.status != crate::productivity::HabitLogStatus::Frozen {
                    if self.fake_freeze_tokens_held(&ctx.user_id) < 1 {
                        return Err(CoreError::Invalid(
                            "no streak freeze tokens available".into(),
                        ));
                    }
                    self.fake_upsert_freeze_entry(&ctx.user_id, &freeze_key, -1, log.updated_at);
                    game_changed = true;
                }
            } else {
                if self.fake_freeze_tokens_held(&ctx.user_id) < 1 {
                    return Err(CoreError::Invalid(
                        "no streak freeze tokens available".into(),
                    ));
                }
                self.fake_upsert_freeze_entry(&ctx.user_id, &freeze_key, -1, log.updated_at);
                game_changed = true;
            }
        } else if self.fake_soft_delete_freeze_entry(&ctx.user_id, &freeze_key, log.updated_at) {
            game_changed = true;
        }

        let habit_outcome = self.upsert_habit_log(log, reward, revoke_source_key)?;
        if habit_outcome.reward_revoked {
            if let Some(key) = revoke_source_key {
                let lid = crate::progress::ledger_id(&ctx.user_id, key);
                self.fake_revoke_pet_credit(&ctx.user_id, &lid, ctx.now_ms);
            }
        }
        if habit_outcome.reward_granted {
            if let Some(r) = reward {
                if self.fake_on_reward_committed(
                    ctx,
                    &r.id,
                    crate::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                )? {
                    game_changed = true;
                }
            }
        }

        Ok(crate::game_depth::HabitLogGameOutcome {
            habit_outcome,
            game_changed,
        })
    }

    fn apply_answer_with_game(
        &self,
        card_id: i64,
        next: &CardState,
        due: i64,
        log: &Revlog,
        reward: Option<&crate::progress::RewardGrant>,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::ApplyAnswerOutcome> {
        let reward_granted = self.apply_answer(card_id, next, due, log, reward)?;
        let mut game_changed = false;
        if (0..=3).contains(&log.review_kind) {
            if let Some(r) = reward.filter(|_| reward_granted) {
                game_changed = self.fake_on_reward_committed(
                    ctx,
                    &r.id,
                    crate::game_depth::PET_CREDIT_REVIEW_POINTS,
                )?;
            } else {
                game_changed = self.fake_evaluate_depth(ctx)?;
            }
        }
        Ok(crate::game_depth::ApplyAnswerOutcome {
            reward_granted,
            game_changed,
            revlog_id: log.id,
        })
    }

    fn set_task_completion_with_game(
        &self,
        user_id: &str,
        id: &str,
        completed_at: Option<i64>,
        completed_day: Option<i32>,
        reward: Option<&crate::progress::RewardGrant>,
        revoke_source_key: Option<&str>,
        ctx: &crate::game_depth::GameEvalContext,
    ) -> CoreResult<crate::game_depth::GameWriteOutcome> {
        let reward_granted = self.set_task_completion(
            user_id,
            id,
            completed_at,
            completed_day,
            reward,
            revoke_source_key,
            ctx.now_ms,
        )?;
        let mut game_changed = false;
        if reward_granted {
            if let Some(r) = reward {
                game_changed = self.fake_on_reward_committed(
                    ctx,
                    &r.id,
                    crate::game_depth::PET_CREDIT_PRODUCTIVITY_POINTS,
                )?;
            }
        } else if completed_at.is_some() {
            game_changed = self.fake_evaluate_depth(ctx)?;
        }
        Ok(crate::game_depth::GameWriteOutcome {
            reward_granted,
            game_changed,
        })
    }

    fn load_game_depth_state(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<(crate::game_depth::GameDepthStateDto, bool)> {
        let outcome = self.run_unlock_backfill(
            user_id,
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
        )?;
        let backfill_granted_any = !outcome.already_applied
            && (outcome.pets_granted > 0
                || outcome.cosmetics_granted > 0
                || outcome.achievements_granted > 0);
        let (total_xp, _) = self.fake_earned_totals(user_id);
        let level = crate::progress::level_from_xp(total_xp).level;
        let profile = self
            .game_profiles
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.user_id == user_id && p.deleted_at.is_none())
            .cloned();
        let chosen_path = profile
            .as_ref()
            .and_then(|p| p.chosen_path.as_deref())
            .and_then(|s| crate::game_depth::GamePathId::parse(s).ok());
        let path_chosen_at = profile.as_ref().and_then(|p| p.path_chosen_at);
        let backfill_applied = profile
            .as_ref()
            .is_some_and(|p| p.backfill_version >= crate::game_depth::CURRENT_BACKFILL_VERSION);

        let credits = self.game_pet_credits.lock().unwrap();
        let mut pets: Vec<_> = self
            .game_pets
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.user_id == user_id && p.deleted_at.is_none())
            .map(|p| {
                let sum: u32 = credits
                    .iter()
                    .filter(|c| c.user_id == user_id && c.pet_id == p.id && c.deleted_at.is_none())
                    .map(|c| c.points)
                    .sum();
                crate::game_depth::PetProgressDto {
                    id: p.id.clone(),
                    species_key: p.species_key.clone(),
                    variant_key: p.variant_key.clone(),
                    growth_points: crate::game_depth::growth_points_from_sum(sum),
                    mount_unlocked: p.mount_unlocked_at.is_some(),
                    is_active: p.is_active,
                    is_mounted: p.is_mounted,
                }
            })
            .collect();
        drop(credits);
        pets.sort_by(|a, b| {
            a.species_key
                .cmp(&b.species_key)
                .then_with(|| a.variant_key.cmp(&b.variant_key))
        });

        let active_pet = pets.iter().find(|p| p.is_active);
        let active_pet_id = active_pet.map(|p| p.id.clone());
        let mounted = active_pet.is_some_and(|p| p.is_mounted);

        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let today = crate::progress::day_index_for_ms(
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_day,
        ) as i32;
        let metrics =
            self.fake_depth_metrics(user_id, tz_offset_minutes, rollover_hour, created_ms, today);
        let earned_map: std::collections::HashMap<String, i64> = self
            .game_achievements
            .lock()
            .unwrap()
            .iter()
            .filter(|a| a.user_id == user_id && a.deleted_at.is_none())
            .map(|a| (a.achievement_key.clone(), a.earned_at))
            .collect();
        let achievements = crate::game_depth::build_achievement_statuses(&metrics, &earned_map);

        let mut unseen_unlocks: Vec<crate::game_depth::UnlockEventDto> = self
            .game_unlocks
            .lock()
            .unwrap()
            .iter()
            .filter(|u| u.user_id == user_id && u.deleted_at.is_none() && u.seen_at.is_none())
            .map(|u| crate::game_depth::UnlockEventDto {
                id: u.id.clone(),
                kind: u.reward_kind.clone(),
                key: u.unlock_key.clone(),
                reward_ref: u.reward_ref.clone(),
                unlocked_at: u.unlocked_at,
            })
            .collect();
        for a in self
            .game_achievements
            .lock()
            .unwrap()
            .iter()
            .filter(|a| a.user_id == user_id && a.deleted_at.is_none() && a.seen_at.is_none())
        {
            let badge_ref = crate::game_depth::ACHIEVEMENT_CATALOG
                .iter()
                .find(|r| r.achievement_key == a.achievement_key)
                .map(|r| r.badge_ref)
                .unwrap_or("badge_spark")
                .to_string();
            unseen_unlocks.push(crate::game_depth::UnlockEventDto {
                id: a.id.clone(),
                kind: "achievement".to_string(),
                key: a.achievement_key.clone(),
                reward_ref: badge_ref,
                unlocked_at: a.earned_at,
            });
        }
        unseen_unlocks.sort_by(|a, b| {
            a.unlocked_at
                .cmp(&b.unlocked_at)
                .then_with(|| a.id.cmp(&b.id))
        });

        Ok((
            crate::game_depth::GameDepthStateDto {
                level,
                chosen_path,
                path_chosen_at,
                path_switch_gold_cents: crate::game_depth::PATH_SWITCH_COST_CENTS,
                active_pet_id,
                mounted,
                pets,
                achievements,
                unseen_unlocks,
                backfill_applied,
            },
            backfill_granted_any,
        ))
    }

    fn choose_game_path(
        &self,
        user_id: &str,
        path_id: crate::game_depth::GamePathId,
        now_ms: i64,
    ) -> CoreResult<()> {
        let (total_xp, _) = self.fake_earned_totals(user_id);
        let level = crate::progress::level_from_xp(total_xp).level;
        if level < crate::game_depth::PATH_UNLOCK_LEVEL {
            return Err(CoreError::Invalid("paths unlock at level 10".into()));
        }
        self.fake_ensure_game_profile(user_id, now_ms);
        let existing_path = self
            .game_profiles
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.user_id == user_id && p.deleted_at.is_none())
            .and_then(|p| p.chosen_path.clone());
        if existing_path.as_deref() == Some(path_id.as_str()) {
            return Ok(());
        }
        if existing_path.is_some() {
            let idemp = format!("path_switch:{}", self.new_uuid());
            self.fake_spend_gold(
                user_id,
                crate::game::SpendKind::PathChange,
                path_id.as_str(),
                &idemp,
                crate::game_depth::PATH_SWITCH_COST_CENTS,
                now_ms,
            )?;
        }
        for p in self.game_profiles.lock().unwrap().iter_mut() {
            if p.user_id == user_id && p.deleted_at.is_none() {
                p.chosen_path = Some(path_id.as_str().to_string());
                p.path_chosen_at = Some(now_ms);
                p.updated_at = now_ms;
                p.usn = -1;
            }
        }
        let ukey = path_id.unlock_key();
        let frame = path_id.frame_item_key();
        self.fake_insert_unlock(user_id, &ukey, "cosmetic", frame, now_ms);
        self.fake_upsert_inventory_item(user_id, frame, "unlock", now_ms);
        self.fake_insert_achievement(user_id, "ach:level_10", 2, now_ms);
        Ok(())
    }

    fn set_active_pet(
        &self,
        user_id: &str,
        pet_id: Option<&str>,
        mounted: bool,
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut pets = self.game_pets.lock().unwrap();
        if let Some(pid) = pet_id {
            let target = pets
                .iter()
                .find(|p| p.user_id == user_id && p.id == pid && p.deleted_at.is_none())
                .cloned()
                .ok_or_else(|| CoreError::NotFound(format!("pet '{pid}' not found")))?;
            if mounted && target.mount_unlocked_at.is_none() {
                return Err(CoreError::Invalid(
                    "pet has not unlocked mount yet (requires 50 bond points)".into(),
                ));
            }
            for p in pets.iter_mut() {
                if p.user_id == user_id && p.deleted_at.is_none() {
                    if p.id == pid {
                        p.is_active = true;
                        p.is_mounted = mounted;
                        p.updated_at = now_ms;
                        p.usn = -1;
                    } else if p.is_active || p.is_mounted {
                        p.is_active = false;
                        p.is_mounted = false;
                        p.updated_at = now_ms;
                        p.usn = -1;
                    }
                }
            }
        } else {
            if mounted {
                return Err(CoreError::Invalid(
                    "cannot mount without an active pet".into(),
                ));
            }
            for p in pets.iter_mut() {
                if p.user_id == user_id && p.deleted_at.is_none() && (p.is_active || p.is_mounted) {
                    p.is_active = false;
                    p.is_mounted = false;
                    p.updated_at = now_ms;
                    p.usn = -1;
                }
            }
        }
        Ok(())
    }

    fn acknowledge_unlocks(
        &self,
        user_id: &str,
        unlock_ids: &[String],
        now_ms: i64,
    ) -> CoreResult<()> {
        let set: std::collections::HashSet<&str> = unlock_ids.iter().map(String::as_str).collect();
        for u in self.game_unlocks.lock().unwrap().iter_mut() {
            if u.user_id == user_id
                && u.deleted_at.is_none()
                && u.seen_at.is_none()
                && set.contains(u.id.as_str())
            {
                u.seen_at = Some(now_ms);
                u.updated_at = now_ms;
                u.usn = -1;
            }
        }
        for a in self.game_achievements.lock().unwrap().iter_mut() {
            if a.user_id == user_id
                && a.deleted_at.is_none()
                && a.seen_at.is_none()
                && set.contains(a.id.as_str())
            {
                a.seen_at = Some(now_ms);
                a.updated_at = now_ms;
                a.usn = -1;
            }
        }
        Ok(())
    }

    fn run_unlock_backfill(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<crate::game_depth::BackfillOutcomeDto> {
        self.fake_ensure_game_profile(user_id, now_ms);
        let version = self
            .game_profiles
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.user_id == user_id && p.deleted_at.is_none())
            .map_or(0, |p| p.backfill_version);
        if version >= crate::game_depth::CURRENT_BACKFILL_VERSION {
            return Ok(crate::game_depth::BackfillOutcomeDto {
                already_applied: true,
                pets_granted: 0,
                cosmetics_granted: 0,
                achievements_granted: 0,
            });
        }
        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let today = crate::progress::day_index_for_ms(
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_day,
        ) as i32;
        let (_, pets_granted, cosmetics_granted, achievements_granted) = self.fake_run_eval_pass(
            user_id,
            now_ms,
            tz_offset_minutes,
            rollover_hour,
            created_ms,
            today,
        )?;
        for p in self.game_profiles.lock().unwrap().iter_mut() {
            if p.user_id == user_id && p.deleted_at.is_none() {
                p.backfill_version = crate::game_depth::CURRENT_BACKFILL_VERSION;
                p.updated_at = now_ms;
                p.usn = -1;
            }
        }
        Ok(crate::game_depth::BackfillOutcomeDto {
            already_applied: false,
            pets_granted,
            cosmetics_granted,
            achievements_granted,
        })
    }

    fn get_motivation_state(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
        allow_auto_freeze: bool,
    ) -> CoreResult<crate::motivation::MotivationStateDto> {
        self.fake_ensure_motivation_settings(user_id, now_ms);
        let active_days =
            self.fake_active_ledger_days(user_id, tz_offset_minutes, rollover_hour, created_ms);
        let mut frozen_days = self.fake_frozen_study_days(user_id);

        let prev_active_day = active_days.iter().copied().filter(|&d| d < today).max();
        {
            let mut settings_list = self.motivation_settings.lock().unwrap();
            if let Some(settings) = settings_list
                .iter_mut()
                .find(|s| s.user_id == user_id && s.deleted_at.is_none())
            {
                crate::motivation::evaluate_comeback_on_load(
                    settings,
                    prev_active_day,
                    today,
                    now_ms,
                );
            }
        }

        let mut auto_frozen_day = None;
        if allow_auto_freeze {
            let held = self.fake_freeze_tokens_held(user_id);
            if let Some(gap_day) = crate::motivation::should_auto_freeze_study_gap(
                &active_days,
                &frozen_days,
                today,
                held,
            ) {
                let key = crate::motivation::study_freeze_source_key(gap_day);
                self.fake_upsert_freeze_entry(user_id, &key, -1, now_ms);
                frozen_days.insert(gap_day);
                auto_frozen_day = Some(gap_day);
            }
        }

        let settings = self
            .motivation_settings
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.user_id == user_id && s.deleted_at.is_none())
            .cloned()
            .unwrap_or_else(|| {
                crate::motivation::MotivationSettingsRow::new_default(user_id, now_ms)
            });

        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
        let rollover_ms = i64::from(rollover_hour) * 3_600_000;
        let day_zero_start_ms = created_day * crate::progress::MS_PER_DAY + rollover_ms - tz_off_ms;
        let today_start_ms = day_zero_start_ms + i64::from(today) * crate::progress::MS_PER_DAY;
        let today_end_ms = today_start_ms + crate::progress::MS_PER_DAY;

        let daily_counts = self.fake_quest_counts_in_window(
            user_id,
            today,
            today,
            today_start_ms,
            today_end_ms,
            &active_days,
        );
        let daily_templates = crate::motivation::daily_quests_for_day(today);
        let daily_quests: Vec<crate::motivation::QuestDto> = daily_templates
            .iter()
            .map(|&tpl| {
                crate::motivation::build_quest_dto(
                    tpl,
                    crate::motivation::QuestKind::Daily,
                    &daily_counts,
                )
            })
            .collect();

        let (week_index, week_start_day, week_end_day) =
            crate::motivation::iso_week_bounds(today, created_day);
        let week_start_ms =
            day_zero_start_ms + i64::from(week_start_day) * crate::progress::MS_PER_DAY;
        let week_end_ms =
            day_zero_start_ms + i64::from(week_end_day + 1) * crate::progress::MS_PER_DAY;
        let weekly_counts = self.fake_quest_counts_in_window(
            user_id,
            week_start_day,
            week_end_day,
            week_start_ms,
            week_end_ms,
            &active_days,
        );
        let weekly_tpl = crate::motivation::weekly_quest_for_week(week_index);
        let weekly_quest = crate::motivation::build_quest_dto(
            weekly_tpl,
            crate::motivation::QuestKind::Weekly,
            &weekly_counts,
        );

        let month_key = crate::motivation::month_key_for_day(today, created_day);
        let completed_daily_quests =
            self.fake_monthly_daily_quest_count(user_id, &month_key, created_day);
        let badges: Vec<crate::motivation::MonthlyBadgeRow> = self
            .monthly_badges
            .lock()
            .unwrap()
            .iter()
            .filter(|b| b.user_id == user_id && b.deleted_at.is_none())
            .cloned()
            .collect();
        let current_badge = badges.iter().find(|b| b.month_key == month_key);
        let monthly_badge = crate::motivation::MonthlyBadgeStatusDto {
            month_key: month_key.clone(),
            completed_daily_quests,
            target_daily_quests: crate::motivation::MONTHLY_BADGE_TARGET_QUESTS,
            earned: current_badge.is_some(),
            earned_at: current_badge.map(|b| b.earned_at),
            seen: current_badge.is_some_and(|b| b.seen_at.is_some()),
            reward_gold_cents: crate::motivation::MONTHLY_BADGE_GOLD_CENTS,
        };
        let mut earned_monthly_badges: Vec<crate::motivation::EarnedMonthlyBadgeDto> = badges
            .iter()
            .map(|b| crate::motivation::EarnedMonthlyBadgeDto {
                month_key: b.month_key.clone(),
                quest_count_at_earn: b.quest_count_at_earn,
                earned_at: b.earned_at,
                seen: b.seen_at.is_some(),
            })
            .collect();
        earned_monthly_badges.sort_by(|a, b| b.month_key.cmp(&a.month_key));

        let (current_streak, studied_today, best_streak) =
            crate::motivation::compute_streak_pair(&active_days, &frozen_days, today);
        let prev_before_return = settings
            .comeback_return_day
            .and_then(|rd| active_days.iter().copied().filter(|&d| d < rd).max());
        let comeback_offer =
            crate::motivation::active_comeback_offer(&settings, prev_before_return, today);

        Ok(crate::motivation::MotivationStateDto {
            daily_goal_xp: settings.daily_goal_xp,
            today_xp: daily_counts.xp,
            goal_met_today: daily_counts.xp >= u64::from(settings.daily_goal_xp),
            current_streak,
            best_streak,
            studied_today,
            next_milestone: crate::motivation::next_streak_milestone(current_streak),
            today_day_index: today,
            today_date: crate::ipc::epoch_days_to_date_string(created_day + i64::from(today)),
            days_remaining_in_week: (week_end_day - today).max(0) as u32,
            daily_quests,
            weekly_quest,
            monthly_badge,
            earned_monthly_badges,
            comeback_offer,
            onboarding_completed: settings.onboarding_completed_at.is_some(),
            auto_frozen_day,
        })
    }

    fn reconcile_motivation(
        &self,
        user_id: &str,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
        allow_comeback_revoke: bool,
    ) -> CoreResult<bool> {
        self.fake_ensure_motivation_settings(user_id, now_ms);
        let mut changed = false;
        let active_days =
            self.fake_active_ledger_days(user_id, tz_offset_minutes, rollover_hour, created_ms);
        let prev_active_day = active_days.iter().copied().filter(|&d| d < today).max();
        {
            let mut settings_list = self.motivation_settings.lock().unwrap();
            if let Some(settings) = settings_list
                .iter_mut()
                .find(|s| s.user_id == user_id && s.deleted_at.is_none())
            {
                if crate::motivation::evaluate_comeback_on_load(
                    settings,
                    prev_active_day,
                    today,
                    now_ms,
                ) {
                    changed = true;
                }
            }
        }

        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
        let rollover_ms = i64::from(rollover_hour) * 3_600_000;
        let day_zero_start_ms = created_day * crate::progress::MS_PER_DAY + rollover_ms - tz_off_ms;
        let today_start_ms = day_zero_start_ms + i64::from(today) * crate::progress::MS_PER_DAY;
        let today_end_ms = today_start_ms + crate::progress::MS_PER_DAY;

        let daily_counts = self.fake_quest_counts_in_window(
            user_id,
            today,
            today,
            today_start_ms,
            today_end_ms,
            &active_days,
        );
        for tpl in crate::motivation::daily_quests_for_day(today) {
            let key = crate::motivation::daily_quest_source_key(today, tpl.id);
            let progress = crate::motivation::quest_progress(tpl.metric, &daily_counts);
            if progress >= tpl.target {
                if self.fake_upsert_motivation_ledger(
                    user_id,
                    &key,
                    crate::motivation::DAILY_QUEST_GOLD_CENTS as i64,
                    now_ms,
                ) {
                    changed = true;
                }
            } else if self.fake_soft_revoke_ledger(user_id, &key, now_ms) {
                changed = true;
            }
        }

        let (week_index, week_start_day, week_end_day) =
            crate::motivation::iso_week_bounds(today, created_day);
        let week_start_ms =
            day_zero_start_ms + i64::from(week_start_day) * crate::progress::MS_PER_DAY;
        let week_end_ms =
            day_zero_start_ms + i64::from(week_end_day + 1) * crate::progress::MS_PER_DAY;
        let weekly_counts = self.fake_quest_counts_in_window(
            user_id,
            week_start_day,
            week_end_day,
            week_start_ms,
            week_end_ms,
            &active_days,
        );
        let weekly_tpl = crate::motivation::weekly_quest_for_week(week_index);
        let weekly_key = crate::motivation::weekly_quest_source_key(week_index, weekly_tpl.id);
        let weekly_prog = crate::motivation::quest_progress(weekly_tpl.metric, &weekly_counts);
        if weekly_prog >= weekly_tpl.target {
            if self.fake_upsert_motivation_ledger(
                user_id,
                &weekly_key,
                crate::motivation::WEEKLY_QUEST_GOLD_CENTS as i64,
                now_ms,
            ) {
                changed = true;
            }
        } else if self.fake_soft_revoke_ledger(user_id, &weekly_key, now_ms) {
            changed = true;
        }

        // Comeback bonus
        let settings_snapshot = self
            .motivation_settings
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.user_id == user_id && s.deleted_at.is_none())
            .cloned();
        if let Some(s) = settings_snapshot {
            let comeback_key = crate::motivation::comeback_bonus_source_key(today);
            if daily_counts.xp >= u64::from(s.daily_goal_xp)
                && crate::motivation::is_comeback_reward_eligible(&s, today)
            {
                if self.fake_upsert_motivation_ledger(
                    user_id,
                    &comeback_key,
                    crate::motivation::COMEBACK_BONUS_GOLD_CENTS as i64,
                    now_ms,
                ) {
                    changed = true;
                }
                let mut list = self.motivation_settings.lock().unwrap();
                if let Some(row) = list
                    .iter_mut()
                    .find(|r| r.user_id == user_id && r.deleted_at.is_none())
                {
                    row.comeback_awarded_return_day = row.comeback_return_day;
                    row.comeback_awarded_day = Some(today);
                    row.updated_at = now_ms;
                    row.usn = -1;
                    changed = true;
                }
            } else if allow_comeback_revoke
                && daily_counts.xp < u64::from(s.daily_goal_xp)
                && s.comeback_awarded_day == Some(today)
            {
                if self.fake_soft_revoke_ledger(user_id, &comeback_key, now_ms) {
                    changed = true;
                }
                let mut list = self.motivation_settings.lock().unwrap();
                if let Some(row) = list
                    .iter_mut()
                    .find(|r| r.user_id == user_id && r.deleted_at.is_none())
                {
                    row.comeback_awarded_return_day = None;
                    row.comeback_awarded_day = None;
                    row.updated_at = now_ms;
                    row.usn = -1;
                    changed = true;
                }
            }
        }

        // Monthly badge (monotonic)
        let month_key = crate::motivation::month_key_for_day(today, created_day);
        let monthly_done = self.fake_monthly_daily_quest_count(user_id, &month_key, created_day);
        if monthly_done >= crate::motivation::MONTHLY_BADGE_TARGET_QUESTS {
            let mut badges = self.monthly_badges.lock().unwrap();
            let already = badges.iter().any(|b| {
                b.user_id == user_id && b.month_key == month_key && b.deleted_at.is_none()
            });
            if !already {
                if let Some(existing) = badges
                    .iter_mut()
                    .find(|b| b.user_id == user_id && b.month_key == month_key)
                {
                    existing.deleted_at = None;
                    existing.updated_at = now_ms;
                    existing.usn = -1;
                } else {
                    badges.push(crate::motivation::MonthlyBadgeRow {
                        id: crate::motivation::monthly_badge_id(user_id, &month_key),
                        user_id: user_id.to_string(),
                        month_key: month_key.clone(),
                        quest_count_at_earn: monthly_done,
                        earned_at: now_ms,
                        seen_at: None,
                        created_at: now_ms,
                        updated_at: now_ms,
                        deleted_at: None,
                        usn: -1,
                    });
                }
                drop(badges);
                let badge_key = crate::motivation::monthly_badge_source_key(&month_key);
                self.fake_upsert_motivation_ledger(
                    user_id,
                    &badge_key,
                    crate::motivation::MONTHLY_BADGE_GOLD_CENTS as i64,
                    now_ms,
                );
                changed = true;
            }
        }

        Ok(changed)
    }

    fn set_daily_goal(&self, user_id: &str, goal_xp: u32, now_ms: i64) -> CoreResult<()> {
        crate::motivation::validate_daily_goal_xp(goal_xp)?;
        self.fake_ensure_motivation_settings(user_id, now_ms);
        let mut list = self.motivation_settings.lock().unwrap();
        if let Some(row) = list
            .iter_mut()
            .find(|r| r.user_id == user_id && r.deleted_at.is_none())
        {
            row.daily_goal_xp = goal_xp;
            row.updated_at = now_ms;
            row.usn = -1;
        }
        Ok(())
    }

    fn get_streak_calendar(
        &self,
        user_id: &str,
        year: i32,
        month: u8,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> CoreResult<crate::motivation::StreakCalendarDto> {
        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let month_days = crate::motivation::month_day_range(year, month, created_day)?;
        let active_days =
            self.fake_active_ledger_days(user_id, tz_offset_minutes, rollover_hour, created_ms);
        let frozen_days = self.fake_frozen_study_days(user_id);
        let (current_streak, studied_today, best_streak) =
            crate::motivation::compute_streak_pair(&active_days, &frozen_days, today);
        let freeze_tokens_held = self.fake_freeze_tokens_held(user_id);
        let daily_goal_xp = self
            .motivation_settings
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.user_id == user_id && s.deleted_at.is_none())
            .map_or(crate::motivation::DEFAULT_DAILY_GOAL_XP, |s| {
                s.daily_goal_xp
            });

        let tz_off_ms = i64::from(tz_offset_minutes) * 60_000;
        let rollover_ms = i64::from(rollover_hour) * 3_600_000;
        let day_zero_start_ms = created_day * crate::progress::MS_PER_DAY + rollover_ms - tz_off_ms;

        let days = month_days
            .into_iter()
            .map(|(day_index, date, day_of_month)| {
                let start_ms =
                    day_zero_start_ms + i64::from(day_index) * crate::progress::MS_PER_DAY;
                let end_ms = start_ms + crate::progress::MS_PER_DAY;
                let counts = self.fake_quest_counts_in_window(
                    user_id,
                    day_index,
                    day_index,
                    start_ms,
                    end_ms,
                    &active_days,
                );
                let studied = active_days.contains(&day_index);
                let xp = self.fake_earned_xp_for_day(
                    user_id,
                    day_index,
                    tz_offset_minutes,
                    rollover_hour,
                    created_day,
                );
                crate::motivation::StreakCalendarDayDto {
                    day_index,
                    date,
                    day_of_month,
                    is_future: day_index > today,
                    studied,
                    goal_met: studied && xp >= u64::from(daily_goal_xp),
                    frozen: frozen_days.contains(&day_index),
                    xp,
                    reviews: counts.reviews,
                    tasks_completed: counts.tasks,
                    habits_completed: counts.habits,
                }
            })
            .collect();

        Ok(crate::motivation::StreakCalendarDto {
            year,
            month,
            today_day_index: today,
            today_date: crate::ipc::epoch_days_to_date_string(created_day + i64::from(today)),
            daily_goal_xp,
            current_streak,
            best_streak,
            studied_today,
            next_milestone: crate::motivation::next_streak_milestone(current_streak),
            milestones: crate::motivation::build_streak_milestones(current_streak, best_streak),
            freeze_tokens_held,
            freeze_token_cap: crate::game::FREEZE_TOKEN_CAP,
            can_freeze_day: crate::motivation::can_manual_freeze_day(
                &active_days,
                &frozen_days,
                today,
                freeze_tokens_held,
            ),
            days,
        })
    }

    fn freeze_study_day(
        &self,
        user_id: &str,
        day_index: i32,
        today: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        now_ms: i64,
    ) -> CoreResult<bool> {
        if day_index != today - 1 && day_index != today - 2 {
            return Err(CoreError::Invalid(
                "study streak freeze is only allowed for yesterday or two days ago".into(),
            ));
        }
        let active_days =
            self.fake_active_ledger_days(user_id, tz_offset_minutes, rollover_hour, created_ms);
        if active_days.contains(&day_index) {
            return Err(CoreError::Invalid(
                "cannot freeze an already active study day".into(),
            ));
        }
        let frozen_days = self.fake_frozen_study_days(user_id);
        if frozen_days.contains(&day_index) {
            return Ok(false);
        }
        if self.fake_freeze_tokens_held(user_id) < 1 {
            return Err(CoreError::Invalid(
                "no streak freeze tokens available".into(),
            ));
        }
        let key = crate::motivation::study_freeze_source_key(day_index);
        Ok(self.fake_upsert_freeze_entry(user_id, &key, -1, now_ms))
    }

    fn dismiss_comeback_offer(&self, user_id: &str, now_ms: i64) -> CoreResult<()> {
        self.fake_ensure_motivation_settings(user_id, now_ms);
        let mut list = self.motivation_settings.lock().unwrap();
        if let Some(row) = list
            .iter_mut()
            .find(|r| r.user_id == user_id && r.deleted_at.is_none())
        {
            if row.comeback_return_day.is_some() {
                row.comeback_dismissed_day = row.comeback_return_day;
                row.updated_at = now_ms;
                row.usn = -1;
            }
        }
        Ok(())
    }

    fn complete_onboarding(&self, user_id: &str, now_ms: i64) -> CoreResult<()> {
        self.fake_ensure_motivation_settings(user_id, now_ms);
        let mut list = self.motivation_settings.lock().unwrap();
        if let Some(row) = list
            .iter_mut()
            .find(|r| r.user_id == user_id && r.deleted_at.is_none())
        {
            if row.onboarding_completed_at.is_none() {
                row.onboarding_completed_at = Some(now_ms);
                row.updated_at = now_ms;
                row.usn = -1;
            }
        }
        Ok(())
    }

    fn mark_monthly_badge_seen(
        &self,
        user_id: &str,
        month_key: &str,
        now_ms: i64,
    ) -> CoreResult<()> {
        let mut badges = self.monthly_badges.lock().unwrap();
        if let Some(badge) = badges
            .iter_mut()
            .find(|b| b.user_id == user_id && b.month_key == month_key && b.deleted_at.is_none())
        {
            if badge.seen_at.is_none() {
                badge.seen_at = Some(now_ms);
                badge.updated_at = now_ms;
                badge.usn = -1;
            }
        }
        Ok(())
    }
}

impl FakeStorage {
    fn fake_earned_totals(&self, user_id: &str) -> (u64, u64) {
        let ledger = self.progress_ledger.lock().unwrap();
        let mut xp = 0_u64;
        let mut gold = 0_u64;
        for e in ledger
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
        {
            xp += e.xp.max(0) as u64;
            gold += e.gold_cents.max(0) as u64;
        }
        (xp, gold)
    }

    fn fake_spent_gold_cents(&self, user_id: &str) -> u64 {
        self.gold_spend_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.user_id == user_id && s.deleted_at.is_none())
            .map(|s| s.amount_cents.max(0) as u64)
            .sum()
    }

    fn fake_freeze_tokens_held(&self, user_id: &str) -> u32 {
        let sum: i64 = self
            .freeze_token_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|f| f.user_id == user_id && f.deleted_at.is_none())
            .map(|f| i64::from(f.delta))
            .sum();
        u32::try_from(sum.max(0)).unwrap_or(u32::MAX)
    }

    fn fake_active_ledger_days(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
    ) -> std::collections::HashSet<i32> {
        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let ledger = self.progress_ledger.lock().unwrap();
        let mut days = std::collections::HashSet::new();
        for e in ledger
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
        {
            match crate::progress::parse_ledger_source_key(&e.source_key) {
                Some(crate::progress::ParsedSourceKey::CardReview { day_index, .. })
                | Some(crate::progress::ParsedSourceKey::HabitLog { day_index, .. }) => {
                    days.insert(day_index);
                }
                Some(crate::progress::ParsedSourceKey::TaskDone { .. }) => {
                    let d = crate::progress::day_index_for_ms(
                        e.created_at,
                        tz_offset_minutes,
                        rollover_hour,
                        created_day,
                    ) as i32;
                    days.insert(d);
                }
                Some(crate::progress::ParsedSourceKey::QuestDaily { .. })
                | Some(crate::progress::ParsedSourceKey::QuestWeekly { .. })
                | Some(crate::progress::ParsedSourceKey::ComebackBonus { .. })
                | Some(crate::progress::ParsedSourceKey::MonthlyBadge { .. })
                | None => {}
            }
        }
        days
    }

    fn fake_frozen_study_days(&self, user_id: &str) -> std::collections::HashSet<i32> {
        self.freeze_token_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|f| f.user_id == user_id && f.deleted_at.is_none() && f.delta < 0)
            .filter_map(|f| crate::motivation::parse_study_freeze_source_key(&f.source_key))
            .collect()
    }

    fn fake_ensure_motivation_settings(&self, user_id: &str, now_ms: i64) {
        let mut list = self.motivation_settings.lock().unwrap();
        if !list
            .iter()
            .any(|s| s.user_id == user_id && s.deleted_at.is_none())
        {
            list.push(crate::motivation::MotivationSettingsRow::new_default(
                user_id, now_ms,
            ));
        }
    }

    fn fake_quest_counts_in_window(
        &self,
        user_id: &str,
        start_day: i32,
        end_day: i32,
        start_ms: i64,
        end_ms: i64,
        active_days: &std::collections::HashSet<i32>,
    ) -> crate::motivation::QuestMetricCounts {
        let revlogs = self.revlogs.lock().unwrap();
        let mut reviews = 0_u32;
        let mut taken_ms_sum = 0_i64;
        let mut seen_before = std::collections::HashSet::new();
        for r in revlogs.iter() {
            if r.id < start_ms {
                seen_before.insert(r.card_id);
            }
        }
        let mut new_card_ids = std::collections::HashSet::new();
        for r in revlogs.iter() {
            if r.id >= start_ms && r.id < end_ms && (0..=3).contains(&r.review_kind) {
                reviews += 1;
                taken_ms_sum += r.taken_ms.max(0);
                if r.review_kind == 0 && !seen_before.contains(&r.card_id) {
                    new_card_ids.insert(r.card_id);
                }
            }
        }
        drop(revlogs);

        let tasks = self
            .tasks
            .lock()
            .unwrap()
            .iter()
            .filter(|t| {
                t.user_id == user_id
                    && t.deleted_at.is_none()
                    && t.completed_at.is_some()
                    && t.completed_day
                        .is_some_and(|d| d >= start_day && d <= end_day)
            })
            .count() as u32;

        let habits = self
            .habit_logs
            .lock()
            .unwrap()
            .iter()
            .filter(|l| {
                l.user_id == user_id
                    && l.deleted_at.is_none()
                    && l.completed
                    && l.status == crate::productivity::HabitLogStatus::Logged
                    && l.day_index >= start_day
                    && l.day_index <= end_day
            })
            .count() as u32;

        let xp: u64 = self
            .progress_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|e| {
                e.user_id == user_id
                    && e.deleted_at.is_none()
                    && e.created_at >= start_ms
                    && e.created_at < end_ms
            })
            .map(|e| e.xp.max(0) as u64)
            .sum();

        let active_days_count = (start_day..=end_day)
            .filter(|d| active_days.contains(d))
            .count() as u32;

        crate::motivation::QuestMetricCounts {
            reviews,
            minutes: u32::try_from((taken_ms_sum / 60_000).max(0)).unwrap_or(u32::MAX),
            new_cards: new_card_ids.len() as u32,
            tasks,
            habits,
            xp,
            active_days: active_days_count,
        }
    }

    fn fake_monthly_daily_quest_count(
        &self,
        user_id: &str,
        month_key: &str,
        created_day: i64,
    ) -> u32 {
        self.progress_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .filter(
                |e| match crate::progress::parse_ledger_source_key(&e.source_key) {
                    Some(crate::progress::ParsedSourceKey::QuestDaily { day_index, .. }) => {
                        crate::motivation::month_key_for_day(day_index, created_day) == month_key
                    }
                    _ => false,
                },
            )
            .count() as u32
    }

    fn fake_upsert_motivation_ledger(
        &self,
        user_id: &str,
        source_key: &str,
        gold_cents: i64,
        now_ms: i64,
    ) -> bool {
        let mut ledger = self.progress_ledger.lock().unwrap();
        if let Some(entry) = ledger
            .iter_mut()
            .find(|e| e.user_id == user_id && e.source_key == source_key)
        {
            if entry.deleted_at.is_some() {
                entry.xp = 0;
                entry.gold_cents = gold_cents;
                entry.created_at = now_ms;
                entry.updated_at = now_ms;
                entry.deleted_at = None;
                entry.usn = -1;
                return true;
            }
            return false;
        }
        ledger.push(crate::progress::ProgressLedgerEntry {
            id: crate::progress::ledger_id(user_id, source_key),
            user_id: user_id.to_string(),
            source_key: source_key.to_string(),
            xp: 0,
            gold_cents,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        true
    }

    fn fake_soft_revoke_ledger(&self, user_id: &str, source_key: &str, now_ms: i64) -> bool {
        let mut ledger = self.progress_ledger.lock().unwrap();
        if let Some(entry) = ledger
            .iter_mut()
            .find(|e| e.user_id == user_id && e.source_key == source_key && e.deleted_at.is_none())
        {
            entry.deleted_at = Some(now_ms);
            entry.updated_at = now_ms;
            entry.usn = -1;
            return true;
        }
        false
    }

    fn fake_earned_xp_for_day(
        &self,
        user_id: &str,
        day_index: i32,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_day: i64,
    ) -> u64 {
        self.progress_ledger
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.user_id == user_id && e.deleted_at.is_none())
            .filter_map(|e| {
                let d = match crate::progress::parse_ledger_source_key(&e.source_key) {
                    Some(crate::progress::ParsedSourceKey::CardReview { day_index, .. })
                    | Some(crate::progress::ParsedSourceKey::HabitLog { day_index, .. }) => {
                        day_index
                    }
                    Some(crate::progress::ParsedSourceKey::TaskDone { .. }) => {
                        crate::progress::day_index_for_ms(
                            e.created_at,
                            tz_offset_minutes,
                            rollover_hour,
                            created_day,
                        ) as i32
                    }
                    _ => return None,
                };
                (d == day_index).then_some(e.xp.max(0) as u64)
            })
            .sum()
    }

    fn fake_spend_gold(
        &self,
        user_id: &str,
        kind: crate::game::SpendKind,
        ref_key: &str,
        idempotency_key: &str,
        amount_cents: u64,
        now_ms: i64,
    ) -> CoreResult<String> {
        let (_, earned) = self.fake_earned_totals(user_id);
        let spent = self.fake_spent_gold_cents(user_id);
        if crate::game::available_gold_cents(earned, spent) < amount_cents {
            return Err(CoreError::Invalid("insufficient gold".into()));
        }
        let id = crate::game::game_entity_id("gold_spend_ledger", user_id, idempotency_key);
        let mut spends = self.gold_spend_ledger.lock().unwrap();
        if let Some(existing) = spends
            .iter_mut()
            .find(|s| s.user_id == user_id && s.idempotency_key == idempotency_key)
        {
            existing.kind = kind.as_str().to_string();
            existing.ref_key = ref_key.to_string();
            existing.amount_cents = amount_cents as i64;
            existing.created_at = now_ms;
            existing.updated_at = now_ms;
            existing.deleted_at = None;
            existing.usn = -1;
            return Ok(existing.id.clone());
        }
        spends.push(crate::game::GoldSpendEntry {
            id: id.clone(),
            user_id: user_id.to_string(),
            idempotency_key: idempotency_key.to_string(),
            kind: kind.as_str().to_string(),
            ref_key: ref_key.to_string(),
            amount_cents: amount_cents as i64,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        Ok(id)
    }

    fn fake_upsert_inventory_item(
        &self,
        user_id: &str,
        item_key: &str,
        source: &str,
        now_ms: i64,
    ) -> bool {
        let mut items = self.inventory_items.lock().unwrap();
        if let Some(existing) = items
            .iter_mut()
            .find(|i| i.user_id == user_id && i.item_key == item_key)
        {
            let was_deleted = existing.deleted_at.is_some();
            if was_deleted {
                existing.source = source.to_string();
                existing.created_at = now_ms;
                existing.updated_at = now_ms;
                existing.deleted_at = None;
                existing.usn = -1;
            }
            return was_deleted;
        }
        items.push(crate::game::InventoryItem {
            id: crate::game::game_entity_id("inventory_item", user_id, item_key),
            user_id: user_id.to_string(),
            item_key: item_key.to_string(),
            kind: "cosmetic".to_string(),
            source: source.to_string(),
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        true
    }

    fn fake_set_equipped_slot(
        &self,
        user_id: &str,
        slot: crate::game::EquipmentSlot,
        item_key: Option<String>,
        now_ms: i64,
    ) {
        let mut eqs = self.avatar_equipped.lock().unwrap();
        let slot_str = slot.as_str();
        if let Some(existing) = eqs
            .iter_mut()
            .find(|e| e.user_id == user_id && e.slot == slot_str)
        {
            existing.item_key = item_key;
            existing.updated_at = now_ms;
            existing.deleted_at = None;
            existing.usn = -1;
        } else {
            eqs.push(crate::game::AvatarEquippedSlot {
                id: crate::game::game_entity_id("avatar_equipped", user_id, slot_str),
                user_id: user_id.to_string(),
                slot: slot_str.to_string(),
                item_key,
                created_at: now_ms,
                updated_at: now_ms,
                deleted_at: None,
                usn: -1,
            });
        }
    }

    fn fake_upsert_freeze_entry(
        &self,
        user_id: &str,
        source_key: &str,
        delta: i32,
        now_ms: i64,
    ) -> bool {
        let mut entries = self.freeze_token_ledger.lock().unwrap();
        if let Some(existing) = entries
            .iter_mut()
            .find(|f| f.user_id == user_id && f.source_key == source_key)
        {
            let changed = existing.deleted_at.is_some() || existing.delta != delta;
            existing.delta = delta;
            existing.created_at = now_ms;
            existing.updated_at = now_ms;
            existing.deleted_at = None;
            existing.usn = -1;
            return changed;
        }
        entries.push(crate::game::FreezeTokenEntry {
            id: crate::game::game_entity_id("freeze_token_ledger", user_id, source_key),
            user_id: user_id.to_string(),
            source_key: source_key.to_string(),
            delta,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        true
    }

    fn fake_soft_delete_freeze_entry(&self, user_id: &str, source_key: &str, now_ms: i64) -> bool {
        let mut entries = self.freeze_token_ledger.lock().unwrap();
        let mut changed = false;
        for f in entries.iter_mut().filter(|f| {
            f.user_id == user_id && f.source_key == source_key && f.deleted_at.is_none()
        }) {
            f.deleted_at = Some(now_ms);
            f.updated_at = now_ms;
            f.usn = -1;
            changed = true;
        }
        changed
    }

    fn fake_ensure_game_profile(&self, user_id: &str, now_ms: i64) {
        let mut profiles = self.game_profiles.lock().unwrap();
        if !profiles
            .iter()
            .any(|p| p.user_id == user_id && p.deleted_at.is_none())
        {
            profiles.push(crate::game_depth::GameProfile {
                id: crate::game_depth::game_profile_id(user_id),
                user_id: user_id.to_string(),
                chosen_path: None,
                path_chosen_at: None,
                backfill_version: 0,
                created_at: now_ms,
                updated_at: now_ms,
                deleted_at: None,
                usn: -1,
            });
        }
    }

    fn fake_insert_unlock(
        &self,
        user_id: &str,
        unlock_key: &str,
        reward_kind: &str,
        reward_ref: &str,
        now_ms: i64,
    ) -> bool {
        let mut unlocks = self.game_unlocks.lock().unwrap();
        if unlocks
            .iter()
            .any(|u| u.user_id == user_id && u.unlock_key == unlock_key)
        {
            return false;
        }
        unlocks.push(crate::game_depth::GameUnlock {
            id: crate::game_depth::game_unlock_id(user_id, unlock_key),
            user_id: user_id.to_string(),
            unlock_key: unlock_key.to_string(),
            reward_kind: reward_kind.to_string(),
            reward_ref: reward_ref.to_string(),
            unlocked_at: now_ms,
            seen_at: None,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        true
    }

    fn fake_insert_pet(
        &self,
        user_id: &str,
        species_key: &str,
        variant_key: &str,
        now_ms: i64,
    ) -> bool {
        let mut pets = self.game_pets.lock().unwrap();
        if pets.iter().any(|p| {
            p.user_id == user_id && p.species_key == species_key && p.variant_key == variant_key
        }) {
            return false;
        }
        let has_active = pets
            .iter()
            .any(|p| p.user_id == user_id && p.is_active && p.deleted_at.is_none());
        pets.push(crate::game_depth::GamePet {
            id: crate::game_depth::game_pet_id(user_id, species_key, variant_key),
            user_id: user_id.to_string(),
            species_key: species_key.to_string(),
            variant_key: variant_key.to_string(),
            mount_unlocked_at: None,
            is_active: !has_active,
            is_mounted: false,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        true
    }

    fn fake_insert_achievement(
        &self,
        user_id: &str,
        achievement_key: &str,
        tier: u8,
        now_ms: i64,
    ) -> bool {
        let mut achs = self.game_achievements.lock().unwrap();
        if achs
            .iter()
            .any(|a| a.user_id == user_id && a.achievement_key == achievement_key)
        {
            return false;
        }
        achs.push(crate::game_depth::GameAchievement {
            id: crate::game_depth::game_achievement_id(user_id, achievement_key),
            user_id: user_id.to_string(),
            achievement_key: achievement_key.to_string(),
            tier,
            earned_at: now_ms,
            seen_at: None,
            created_at: now_ms,
            updated_at: now_ms,
            deleted_at: None,
            usn: -1,
        });
        true
    }

    fn fake_grant_pet_credit(
        &self,
        user_id: &str,
        ledger_id: &str,
        points: u32,
        now_ms: i64,
    ) -> bool {
        let active_pet_id = {
            let pets = self.game_pets.lock().unwrap();
            pets.iter()
                .find(|p| p.user_id == user_id && p.is_active && p.deleted_at.is_none())
                .and_then(|p| p.mount_unlocked_at.is_none().then(|| p.id.clone()))
        };
        let Some(pet_id) = active_pet_id else {
            return false;
        };
        let mut credits = self.game_pet_credits.lock().unwrap();
        if let Some(existing) = credits
            .iter_mut()
            .find(|c| c.pet_id == pet_id && c.ledger_id == ledger_id)
        {
            if existing.deleted_at.is_some() {
                existing.points = points;
                existing.updated_at = now_ms;
                existing.deleted_at = None;
                existing.usn = -1;
            }
        } else {
            credits.push(crate::game_depth::GamePetCredit {
                id: crate::game_depth::game_pet_credit_id(user_id, &pet_id, ledger_id),
                user_id: user_id.to_string(),
                pet_id: pet_id.clone(),
                ledger_id: ledger_id.to_string(),
                points,
                created_at: now_ms,
                updated_at: now_ms,
                deleted_at: None,
                usn: -1,
            });
        }
        let sum: u32 = credits
            .iter()
            .filter(|c| c.user_id == user_id && c.pet_id == pet_id && c.deleted_at.is_none())
            .map(|c| c.points)
            .sum();
        drop(credits);
        if sum >= crate::game_depth::MAX_PET_GROWTH {
            let mut pets = self.game_pets.lock().unwrap();
            if let Some(pet) = pets
                .iter_mut()
                .find(|p| p.id == pet_id && p.deleted_at.is_none())
            {
                if pet.mount_unlocked_at.is_none() {
                    pet.mount_unlocked_at = Some(now_ms);
                    pet.updated_at = now_ms;
                    pet.usn = -1;
                    return true;
                }
            }
        }
        false
    }

    fn fake_revoke_pet_credit(&self, user_id: &str, ledger_id: &str, now_ms: i64) {
        let mut credits = self.game_pet_credits.lock().unwrap();
        for c in credits
            .iter_mut()
            .filter(|c| c.user_id == user_id && c.ledger_id == ledger_id && c.deleted_at.is_none())
        {
            c.deleted_at = Some(now_ms);
            c.updated_at = now_ms;
            c.usn = -1;
        }
    }

    fn fake_depth_metrics(
        &self,
        user_id: &str,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        today: i32,
    ) -> crate::game_depth::DepthMetricSnapshot {
        let created_day =
            crate::progress::created_epoch_day(created_ms, tz_offset_minutes, rollover_hour);
        let reviews = self
            .revlogs
            .lock()
            .unwrap()
            .iter()
            .filter(|r| (0..=3).contains(&r.review_kind))
            .count() as u32;
        let (total_xp, _) = self.fake_earned_totals(user_id);
        let level = crate::progress::level_from_xp(total_xp).level;
        let completed_tasks = self
            .tasks
            .lock()
            .unwrap()
            .iter()
            .filter(|t| t.user_id == user_id && t.deleted_at.is_none() && t.completed_at.is_some())
            .count() as u32;
        let habit_logs = self.habit_logs.lock().unwrap().clone();
        let completed_habit_logs = habit_logs
            .iter()
            .filter(|l| l.user_id == user_id && l.deleted_at.is_none() && l.completed)
            .count() as u32;
        let max_habit_streak = self
            .habits
            .lock()
            .unwrap()
            .iter()
            .filter(|h| h.user_id == user_id && h.deleted_at.is_none() && h.archived_at.is_none())
            .map(|h| {
                crate::productivity::compute_habit_streak(
                    h,
                    &habit_logs,
                    today,
                    created_day,
                    crate::productivity::WeekStart::Mon,
                )
            })
            .max()
            .unwrap_or(0);

        let mut study_day_set =
            self.fake_active_ledger_days(user_id, tz_offset_minutes, rollover_hour, created_ms);
        for r in self
            .revlogs
            .lock()
            .unwrap()
            .iter()
            .filter(|r| (0..=3).contains(&r.review_kind))
        {
            study_day_set.insert(crate::progress::day_index_for_ms(
                r.id,
                tz_offset_minutes,
                rollover_hour,
                created_day,
            ) as i32);
        }
        for t in self
            .tasks
            .lock()
            .unwrap()
            .iter()
            .filter(|t| t.user_id == user_id && t.deleted_at.is_none())
        {
            if let Some(d) = t.completed_day {
                study_day_set.insert(d);
            }
        }
        for l in habit_logs
            .iter()
            .filter(|l| l.user_id == user_id && l.deleted_at.is_none() && l.completed)
        {
            study_day_set.insert(l.day_index);
        }
        let study_days = study_day_set.len() as u32;

        let cards = self.cards.lock().unwrap();
        let mature_cards = cards
            .iter()
            .filter(|c| crate::progress::is_mature_card(c.ctype, c.queue, c.interval))
            .count() as u32;
        let decks = self.decks.lock().unwrap();
        let deck_tuples: Vec<(i64, String, Option<i64>)> = decks
            .iter()
            .map(|d| (d.id, d.name.clone(), d.parent_id))
            .collect();
        let top_lookup = crate::progress::build_top_deck_lookup(deck_tuples);
        let card_deck_map: std::collections::HashMap<i64, i64> =
            cards.iter().map(|c| (c.id, c.deck_id)).collect();
        let mut studied_top_decks = std::collections::HashSet::new();
        for r in self
            .revlogs
            .lock()
            .unwrap()
            .iter()
            .filter(|r| (0..=3).contains(&r.review_kind))
        {
            if let Some(deck_id) = card_deck_map.get(&r.card_id) {
                if let Some(&(top_id, _)) = top_lookup.get(deck_id) {
                    studied_top_decks.insert(top_id);
                }
            }
        }
        let decks_studied = studied_top_decks.len() as u32;

        let pets = self.game_pets.lock().unwrap();
        let unlocked_pets = pets
            .iter()
            .filter(|p| p.user_id == user_id && p.deleted_at.is_none())
            .count() as u32;
        let has_mount = pets.iter().any(|p| {
            p.user_id == user_id && p.deleted_at.is_none() && p.mount_unlocked_at.is_some()
        });
        let path_chosen = self
            .game_profiles
            .lock()
            .unwrap()
            .iter()
            .any(|p| p.user_id == user_id && p.deleted_at.is_none() && p.chosen_path.is_some());

        crate::game_depth::DepthMetricSnapshot {
            reviews,
            level,
            completed_tasks,
            completed_habit_logs,
            max_habit_streak,
            study_days,
            mature_cards,
            decks_studied,
            unlocked_pets,
            has_mount,
            path_chosen,
        }
    }

    fn fake_run_eval_pass(
        &self,
        user_id: &str,
        now_ms: i64,
        tz_offset_minutes: i32,
        rollover_hour: u8,
        created_ms: i64,
        today: i32,
    ) -> CoreResult<(bool, u32, u32, u32)> {
        let mut metrics =
            self.fake_depth_metrics(user_id, tz_offset_minutes, rollover_hour, created_ms, today);
        let mut pets_granted = 0_u32;
        let mut cosmetics_granted = 0_u32;
        let mut achievements_granted = 0_u32;

        for rule in &crate::game_depth::THRESHOLD_UNLOCK_RULES {
            if metrics.value_for(rule.metric) >= rule.threshold {
                let inserted = self.fake_insert_unlock(
                    user_id,
                    rule.unlock_key,
                    rule.reward_kind(),
                    &rule.reward_ref(),
                    now_ms,
                );
                match rule.grant {
                    crate::game_depth::UnlockGrant::Pet {
                        species_key,
                        variant_key,
                        ..
                    } => {
                        if self.fake_insert_pet(user_id, species_key, variant_key, now_ms) {
                            pets_granted += 1;
                            metrics.unlocked_pets += 1;
                        }
                    }
                    crate::game_depth::UnlockGrant::Cosmetic { item_key } => {
                        if self.fake_upsert_inventory_item(user_id, item_key, "unlock", now_ms) {
                            cosmetics_granted += 1;
                        }
                    }
                }
                let _ = inserted;
            }
        }
        for ach in &crate::game_depth::ACHIEVEMENT_CATALOG {
            let achieved = if ach.achievement_key == "ach:level_10" {
                metrics.level >= 10 || metrics.path_chosen
            } else {
                metrics.value_for(ach.metric) >= ach.threshold
            };
            if achieved
                && self.fake_insert_achievement(user_id, ach.achievement_key, ach.tier, now_ms)
            {
                achievements_granted += 1;
            }
        }
        let any_changed = pets_granted > 0 || cosmetics_granted > 0 || achievements_granted > 0;
        Ok((
            any_changed,
            pets_granted,
            cosmetics_granted,
            achievements_granted,
        ))
    }

    fn fake_evaluate_depth(&self, ctx: &crate::game_depth::GameEvalContext) -> CoreResult<bool> {
        let (changed, _, _, _) = self.fake_run_eval_pass(
            &ctx.user_id,
            ctx.now_ms,
            ctx.tz_offset_minutes,
            ctx.rollover_hour,
            ctx.created_ms,
            ctx.today,
        )?;
        Ok(changed)
    }

    fn fake_on_reward_committed(
        &self,
        ctx: &crate::game_depth::GameEvalContext,
        ledger_id: &str,
        pet_points: u32,
    ) -> CoreResult<bool> {
        let mut changed = false;
        let active_days = self.fake_active_ledger_days(
            &ctx.user_id,
            ctx.tz_offset_minutes,
            ctx.rollover_hour,
            ctx.created_ms,
        );
        let streak = crate::game::streak_ending_at(&active_days, ctx.awarded_day);
        if streak > 0
            && streak.is_multiple_of(crate::game::STREAK_FREEZE_MILESTONE_DAYS)
            && self.fake_freeze_tokens_held(&ctx.user_id) < crate::game::FREEZE_TOKEN_CAP
        {
            let key = format!("freeze_earn:streak:{}", ctx.awarded_day);
            let exists = self
                .freeze_token_ledger
                .lock()
                .unwrap()
                .iter()
                .any(|f| f.user_id == ctx.user_id && f.source_key == key);
            if !exists && self.fake_upsert_freeze_entry(&ctx.user_id, &key, 1, ctx.now_ms) {
                changed = true;
            }
        }
        if self.fake_evaluate_depth(ctx)? {
            changed = true;
        }
        if self.fake_grant_pet_credit(&ctx.user_id, ledger_id, pet_points, ctx.now_ms) {
            changed = true;
        }
        if self.fake_evaluate_depth(ctx)? {
            changed = true;
        }
        Ok(changed)
    }
}

fn fake_apply_ledger_hook(
    ledger_mutex: &Mutex<Vec<crate::progress::ProgressLedgerEntry>>,
    user_id: &str,
    reward: Option<&crate::progress::RewardGrant>,
    revoke_source_key: Option<&str>,
    now_ms: i64,
) -> (bool, bool) {
    let mut ledger = ledger_mutex.lock().unwrap();
    let granted = if let Some(r) = reward {
        if let Some(existing) = ledger
            .iter_mut()
            .find(|e| e.user_id == r.user_id && e.source_key == r.source_key)
        {
            if existing.deleted_at.is_some() {
                existing.xp = r.xp;
                existing.gold_cents = r.gold_cents;
                existing.created_at = r.now_ms;
                existing.updated_at = now_ms;
                existing.deleted_at = None;
                existing.usn = -1;
                true
            } else {
                false
            }
        } else {
            ledger.push(crate::progress::ProgressLedgerEntry {
                id: r.id.clone(),
                user_id: r.user_id.clone(),
                source_key: r.source_key.clone(),
                xp: r.xp,
                gold_cents: r.gold_cents,
                created_at: r.now_ms,
                updated_at: now_ms,
                deleted_at: None,
                usn: -1,
            });
            true
        }
    } else {
        false
    };

    let revoked = if let Some(key) = revoke_source_key {
        let mut did_revoke = false;
        for e in ledger
            .iter_mut()
            .filter(|e| e.user_id == user_id && e.source_key == key && e.deleted_at.is_none())
        {
            e.deleted_at = Some(now_ms);
            e.updated_at = now_ms;
            e.usn = -1;
            did_revoke = true;
        }
        did_revoke
    } else {
        false
    };

    (granted, revoked)
}

#[cfg(test)]
pub(crate) use super::testkit::{collection, deck};
