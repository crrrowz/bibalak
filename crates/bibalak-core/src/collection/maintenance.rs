use crate::error::CoreResult;
use crate::ipc::IntegrityReport;
use crate::model::Revlog;
use crate::Collection;

impl Collection {
    pub fn integrity_check(&self) -> CoreResult<IntegrityReport> {
        self.storage.integrity_check(self.clock.now_ms())
    }

    pub fn optimize(&self) -> CoreResult<()> {
        self.storage.optimize()
    }

    pub fn note_media_refs(&self) -> CoreResult<Vec<String>> {
        self.storage.note_media_refs()
    }

    pub fn backup_db(&self, dest_path: &std::path::Path) -> CoreResult<()> {
        self.storage.backup_db(dest_path)
    }

    pub fn revlogs_for_optimize(&self, deck_id: Option<i64>) -> CoreResult<Vec<Revlog>> {
        self.storage.revlogs_for_optimize(deck_id)
    }
}
