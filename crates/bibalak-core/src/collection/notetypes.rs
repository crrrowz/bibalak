use crate::error::{CoreError, CoreResult};
use crate::events::{DomainEvent, EventSink};
use crate::ipc::{
    FieldOptions, FieldRemoveWarning, NotetypeDetail, NotetypeSummary, TemplateSummary,
};
use crate::model::Notetype;
use crate::notetype_preset::{
    compile_preset, is_image_occlusion_config, lint_templates, EditorMode, NotetypePreset,
    TemplateLintHint,
};
use crate::Collection;

fn unique_notetype_name(existing: &[Notetype], base_name: &str) -> String {
    let mut final_name = base_name.to_string();
    let mut counter = 2;
    while existing
        .iter()
        .any(|nt| nt.name.eq_ignore_ascii_case(&final_name))
    {
        final_name = format!("{base_name} {counter}");
        counter += 1;
    }
    final_name
}

impl Collection {
    /// All note types with their ordered field names, for the Add Note picker.
    pub fn list_notetypes(&self) -> CoreResult<Vec<NotetypeSummary>> {
        let notetypes = self.storage.list_notetypes()?;
        let mut result = Vec::with_capacity(notetypes.len());
        for nt in notetypes {
            let fields = self.storage.fields_for_notetype(nt.id)?;
            let note_count = self.storage.note_count_for_notetype(nt.id)?;
            let is_image_occlusion =
                (nt.kind == 1 && is_image_occlusion_config(&nt.config_json)).then_some(true);
            result.push(NotetypeSummary {
                id: nt.id,
                name: nt.name,
                kind: nt.kind,
                is_image_occlusion,
                field_names: fields.into_iter().map(|f| f.name).collect(),
                note_count,
            });
        }
        Ok(result)
    }

    pub fn get_notetype_detail(&self, notetype_id: i64) -> CoreResult<Option<NotetypeDetail>> {
        self.storage.get_notetype_detail(notetype_id)
    }

    pub fn create_notetype(&self, name: &str, kind: i64) -> CoreResult<NotetypeDetail> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("note type name is empty".into()));
        }
        let existing = self.storage.list_notetypes()?;
        let final_name = unique_notetype_name(&existing, name);
        let id = self
            .storage
            .create_notetype(&final_name, kind, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        self.storage
            .get_notetype_detail(id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {id}")))
    }

    pub fn delete_notetype(&self, notetype_id: i64) -> CoreResult<()> {
        self.storage
            .delete_notetype(notetype_id, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn rename_notetype(&self, notetype_id: i64, name: &str) -> CoreResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("note type name is empty".into()));
        }
        self.storage
            .rename_notetype(notetype_id, name, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn stock_notetype_names(&self) -> Vec<&'static str> {
        self.storage.stock_notetype_names()
    }

    pub fn add_stock_notetype(&self, index: usize) -> CoreResult<NotetypeDetail> {
        let id = self
            .storage
            .add_stock_notetype(index, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        self.storage
            .get_notetype_detail(id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {id}")))
    }

    pub fn save_notetype_css(&self, notetype_id: i64, css: &str) -> CoreResult<()> {
        self.storage
            .save_notetype_css(notetype_id, css, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn add_field(&self, notetype_id: i64, name: &str) -> CoreResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("field name is empty".into()));
        }
        self.storage
            .add_field(notetype_id, name, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn check_field_remove(&self, notetype_id: i64, ord: i64) -> CoreResult<FieldRemoveWarning> {
        self.storage.check_field_remove(notetype_id, ord)
    }

    pub fn remove_field(&self, notetype_id: i64, ord: i64) -> CoreResult<()> {
        self.storage
            .remove_field(notetype_id, ord, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn rename_field(&self, notetype_id: i64, ord: i64, name: &str) -> CoreResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(CoreError::Invalid("field name is empty".into()));
        }
        self.storage
            .rename_field(notetype_id, ord, name, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn reorder_fields(&self, notetype_id: i64, new_order: Vec<i64>) -> CoreResult<()> {
        self.storage
            .reorder_fields(notetype_id, &new_order, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn save_field_options(
        &self,
        notetype_id: i64,
        ord: i64,
        options: FieldOptions,
    ) -> CoreResult<()> {
        self.storage
            .save_field_options(notetype_id, ord, &options, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn set_sort_field(&self, notetype_id: i64, ord: i64) -> CoreResult<()> {
        self.storage
            .set_sort_field(notetype_id, ord, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn duplicate_notetype(
        &self,
        notetype_id: i64,
        copy_name_base: &str,
    ) -> CoreResult<NotetypeDetail> {
        let base = copy_name_base.trim();
        let existing = self.storage.list_notetypes()?;
        let fallback;
        let base_name = if base.is_empty() {
            let orig = existing
                .iter()
                .find(|nt| nt.id == notetype_id)
                .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
            fallback = format!("{} copy", orig.name);
            fallback.as_str()
        } else {
            base
        };
        let final_name = unique_notetype_name(&existing, base_name);
        let id = self
            .storage
            .duplicate_notetype(notetype_id, &final_name, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        self.storage
            .get_notetype_detail(id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {id}")))
    }

    pub fn add_template(
        &self,
        notetype_id: i64,
        name: &str,
        qfmt: &str,
        afmt: &str,
    ) -> CoreResult<()> {
        self.storage
            .add_template(notetype_id, name, qfmt, afmt, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn check_template_remove(&self, notetype_id: i64, ord: i64) -> CoreResult<u32> {
        self.storage.check_template_remove(notetype_id, ord)
    }

    pub fn remove_template(&self, notetype_id: i64, ord: i64) -> CoreResult<()> {
        self.storage
            .remove_template(notetype_id, ord, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    pub fn save_template(
        &self,
        notetype_id: i64,
        ord: i64,
        name: &str,
        qfmt: &str,
        afmt: &str,
    ) -> CoreResult<()> {
        self.storage
            .save_template(notetype_id, ord, name, qfmt, afmt, self.clock.now_ms())?;
        self.events.emit(DomainEvent::SchemaChanged);
        Ok(())
    }

    /// Save a note type's preset configuration. In `Simple` mode, compiles the
    /// preset against the current fields and updates `kind`, `templates`, and
    /// `css` in the same transaction. In `Advanced` mode, persists only
    /// `keepsakePreset` without touching existing templates or CSS.
    pub fn save_notetype_preset(
        &self,
        notetype_id: i64,
        mut preset: NotetypePreset,
        confirm_remove: bool,
    ) -> CoreResult<NotetypeDetail> {
        let detail = self
            .storage
            .get_notetype_detail(notetype_id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
        let compiled = if preset.mode == EditorMode::Simple {
            let out = compile_preset(&preset, &detail.fields)?;
            if out.kind != detail.kind && self.storage.note_count_for_notetype(notetype_id)? > 0 {
                return Err(CoreError::Invalid(
                    "cannot change note type kind while notes exist".into(),
                ));
            }
            if out.templates.len() < detail.templates.len() && !confirm_remove {
                return Err(CoreError::Invalid(
                    "removing card templates deletes existing cards; confirmation required".into(),
                ));
            }
            preset.compiled_digest = Some(out.compiled_digest.clone());
            Some(out)
        } else {
            None
        };
        self.storage.save_notetype_preset(
            notetype_id,
            &preset,
            compiled.as_ref(),
            confirm_remove,
            self.clock.now_ms(),
        )?;
        self.events.emit(DomainEvent::SchemaChanged);
        self.storage
            .get_notetype_detail(notetype_id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))
    }

    /// Lint a note type's templates and CSS without network calls or DB writes.
    /// When `qfmt`/`afmt` are `Some`, lints the draft template against the note
    /// type's fields; otherwise lints all saved templates.
    pub fn lint_notetype(
        &self,
        notetype_id: i64,
        qfmt: Option<&str>,
        afmt: Option<&str>,
        css: Option<&str>,
    ) -> CoreResult<Vec<TemplateLintHint>> {
        let detail = self
            .storage
            .get_notetype_detail(notetype_id)?
            .ok_or_else(|| CoreError::NotFound(format!("notetype {notetype_id}")))?;
        let effective_css = css.unwrap_or(&detail.css);
        let draft_templates;
        let templates = if qfmt.is_some() || afmt.is_some() {
            let base = detail.templates.first();
            draft_templates = vec![TemplateSummary {
                ord: base.map(|t| t.ord).unwrap_or(0),
                name: base
                    .map(|t| t.name.clone())
                    .unwrap_or_else(|| "Card 1".into()),
                qfmt: qfmt
                    .map(str::to_string)
                    .unwrap_or_else(|| base.map(|t| t.qfmt.clone()).unwrap_or_default()),
                afmt: afmt
                    .map(str::to_string)
                    .unwrap_or_else(|| base.map(|t| t.afmt.clone()).unwrap_or_default()),
            }];
            draft_templates.as_slice()
        } else {
            detail.templates.as_slice()
        };
        Ok(lint_templates(
            detail.kind,
            &detail.fields,
            templates,
            effective_css,
        ))
    }
}
