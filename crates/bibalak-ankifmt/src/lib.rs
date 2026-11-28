//! # bibalak-ankifmt
//!
//! Bidirectional Anki compatibility. [`read_package`] detects the container
//! (`.apkg`/`.colpkg`) and schema version and emits a [`CanonicalModel`];
//! writers (M6) serialise it back. Round-trip fidelity is a test gate.
//!
//! Status: import of both legacy schema **v11** (JSON-blob `col`) and modern
//! **v18** (tabular + protobuf template configs, zstd `.anki21b`) is supported.

mod pb;
pub mod reader;
pub mod testkit;
pub mod text_import;
pub mod writer;

pub use reader::{
    read_package, read_package_with_limits, read_package_with_media, read_package_with_progress,
    read_package_with_progress_stats, PackageMediaStats, PackageReadLimits, MAX_COLLECTION_BYTES,
    MAX_MEDIA_BYTES, MAX_MEDIA_MAP_BYTES, MAX_TOTAL_PACKAGE_BYTES,
};
pub use writer::{
    write_apkg, write_apkg_streaming, write_apkg_with_media, ExportProgressUpdate,
    StreamingExportOutcome,
};
