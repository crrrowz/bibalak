//! Plugin host: manifest loading, capability enforcement, install/enable/disable/remove.
//!
//! Plugins execute in the frontend (sandboxed Web Workers). This crate manages
//! filesystem state under `<app-data>/plugins/` and enforces that manifests
//! target API 0.2.x, declare only active capabilities, and stay confined to
//! their install directory.
//!
//! Architecture:
//!   `<app-data>/plugins/installed/<plugin-id>/`  ← plugin files (manifest + entry)
//!   `<app-data>/plugins/state.json`              ← `{ enabled: string[] }`

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Current plugin API version supported by this host.
pub const PLUGIN_API_VERSION: &str = "0.2.0";

// ── Error ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("plugin not found: {0}")]
    NotFound(String),
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
}

pub type PluginResult<T> = Result<T, PluginError>;

// ── Capability ────────────────────────────────────────────────────────────────

/// Capabilities a plugin may declare in its `plugin.json`.
/// Only active capabilities in API 0.2.0 are accepted at install/enable time;
/// reserved capabilities are modeled explicitly so they fail with a clear message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Capability {
    #[serde(rename = "read:notes")]
    ReadNotes,
    #[serde(rename = "write:cards")]
    WriteCards,
    #[serde(rename = "read:decks")]
    ReadDecks,
    #[serde(rename = "ui:panel")]
    UiPanel,
    #[serde(rename = "ui:command")]
    UiCommand,
    #[serde(rename = "ui:review-button")]
    UiReviewButton,
    #[serde(rename = "net:fetch")]
    NetFetch,
    #[serde(rename = "events:listen")]
    EventsListen,
    #[serde(rename = "ai:card-hint")]
    AiCardHint,
    #[serde(rename = "ai:note-fill-back")]
    AiNoteFillBack,
    #[serde(rename = "ai:deck-summary")]
    AiDeckSummary,
}

impl Capability {
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::ReadNotes => "read:notes",
            Self::WriteCards => "write:cards",
            Self::ReadDecks => "read:decks",
            Self::UiPanel => "ui:panel",
            Self::UiCommand => "ui:command",
            Self::UiReviewButton => "ui:review-button",
            Self::NetFetch => "net:fetch",
            Self::EventsListen => "events:listen",
            Self::AiCardHint => "ai:card-hint",
            Self::AiNoteFillBack => "ai:note-fill-back",
            Self::AiDeckSummary => "ai:deck-summary",
        }
    }

    /// Returns `true` when this capability is implemented and enabled in API 0.2.0.
    pub const fn is_active(&self) -> bool {
        matches!(
            self,
            Self::ReadNotes
                | Self::ReadDecks
                | Self::UiPanel
                | Self::UiCommand
                | Self::EventsListen
        )
    }
}

// ── Manifest ──────────────────────────────────────────────────────────────────

/// Parsed `plugin.json` manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// Entry-point JS file path relative to the plugin root.
    pub entry: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    #[serde(default)]
    pub permissions: Vec<Capability>,
}

impl PluginManifest {
    /// Parse and validate structural manifest fields and path confinement.
    /// Does not reject older `apiVersion` or reserved capabilities so already-installed
    /// plugins can still be listed and removed; call [`Self::validate_api`] for install/enable.
    pub fn parse_from_dir(dir: &Path) -> PluginResult<Self> {
        let path = dir.join("plugin.json");
        if !path.is_file() {
            return Err(PluginError::NotFound(path.display().to_string()));
        }
        let raw = std::fs::read_to_string(&path)?;
        let m: PluginManifest = serde_json::from_str(&raw)?;
        if m.id.trim().is_empty() {
            return Err(PluginError::InvalidManifest("id is empty".into()));
        }
        if m.name.trim().is_empty() {
            return Err(PluginError::InvalidManifest("name is empty".into()));
        }
        if m.version.trim().is_empty() {
            return Err(PluginError::InvalidManifest("version is empty".into()));
        }
        if m.entry.trim().is_empty() {
            return Err(PluginError::InvalidManifest("entry is empty".into()));
        }
        // `id` becomes a directory name and `entry` a path under it: both must
        // stay inside `<app-data>/plugins/installed/<id>/`.
        if !is_safe_id(&m.id) {
            return Err(PluginError::InvalidManifest(format!(
                "id {:?} may only contain letters, digits, '.', '_' and '-'",
                m.id
            )));
        }
        if !is_safe_relative_path(&m.entry) {
            return Err(PluginError::InvalidManifest(format!(
                "entry {:?} must be a relative path inside the plugin folder",
                m.entry
            )));
        }
        Ok(m)
    }

    /// Parse and fully validate a plugin directory for API 0.2.0 compatibility.
    pub fn from_dir(dir: &Path) -> PluginResult<Self> {
        let m = Self::parse_from_dir(dir)?;
        m.validate_api()?;
        let entry_path = dir.join(&m.entry);
        if !entry_path.is_file() {
            return Err(PluginError::InvalidManifest(format!(
                "entry file {:?} does not exist in plugin folder",
                m.entry
            )));
        }
        Ok(m)
    }

    /// Validate `apiVersion` and active capabilities for API 0.2.0.
    pub fn validate_api(&self) -> PluginResult<()> {
        if !is_supported_api_version(&self.api_version) {
            return Err(PluginError::InvalidManifest(format!(
                "unsupported apiVersion {:?}; Bibalak requires 0.2.x",
                self.api_version
            )));
        }
        for cap in &self.permissions {
            if !cap.is_active() {
                return Err(PluginError::InvalidManifest(format!(
                    "capability '{}' is reserved and not active in plugin API {PLUGIN_API_VERSION}",
                    cap.as_str()
                )));
            }
        }
        Ok(())
    }

    pub fn permission_strings(&self) -> Vec<String> {
        self.permissions
            .iter()
            .map(|c| c.as_str().to_string())
            .collect()
    }
}

/// Accepts `"0.2"` or `"0.2.<patch>"` (ASCII digits).
pub fn is_supported_api_version(version: &str) -> bool {
    let trimmed = version.trim();
    if trimmed == "0.2" {
        return true;
    }
    let Some(rest) = trimmed.strip_prefix("0.2.") else {
        return false;
    };
    !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())
}

pub fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Relative, platform-neutral, no `..`/`.` segments, no drive or root prefix.
fn is_safe_relative_path(path: &str) -> bool {
    !path.starts_with(['/', '\\'])
        && !path.contains(':')
        && path
            .split(['/', '\\'])
            .all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

// ── Persisted state ───────────────────────────────────────────────────────────

#[derive(Debug, Default, Serialize, Deserialize)]
struct PluginState {
    enabled: Vec<String>,
}

// ── PluginRecord ──────────────────────────────────────────────────────────────

/// A loaded, registered plugin with its on-disk location.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginRecord {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub install_path: PathBuf,
}

// ── Bundled sample plugins (single source of truth under examples/plugins/) ───

struct BundledSample {
    id: &'static str,
    manifest_json: &'static str,
    entry_js: &'static str,
    readme_md: &'static str,
}

const BUNDLED_SAMPLES: &[BundledSample] = &[
    BundledSample {
        id: "bibalak-focus-timer",
        manifest_json: include_str!("../../../examples/plugins/focus-timer/plugin.json"),
        entry_js: include_str!("../../../examples/plugins/focus-timer/index.js"),
        readme_md: include_str!("../../../examples/plugins/focus-timer/README.md"),
    },
    BundledSample {
        id: "bibalak-today-glance",
        manifest_json: include_str!("../../../examples/plugins/today-at-a-glance/plugin.json"),
        entry_js: include_str!("../../../examples/plugins/today-at-a-glance/index.js"),
        readme_md: include_str!("../../../examples/plugins/today-at-a-glance/README.md"),
    },
    BundledSample {
        id: "bibalak-leech-helper",
        manifest_json: include_str!("../../../examples/plugins/leech-helper/plugin.json"),
        entry_js: include_str!("../../../examples/plugins/leech-helper/index.js"),
        readme_md: include_str!("../../../examples/plugins/leech-helper/README.md"),
    },
    BundledSample {
        id: "bibalak-note-checker",
        manifest_json: include_str!("../../../examples/plugins/note-checker/plugin.json"),
        entry_js: include_str!("../../../examples/plugins/note-checker/index.js"),
        readme_md: include_str!("../../../examples/plugins/note-checker/README.md"),
    },
];

// ── PluginManager ─────────────────────────────────────────────────────────────

/// Manages the `<app-data>/plugins/` directory tree.
/// Thread-safe: holds only `PathBuf` fields; all I/O is synchronous.
pub struct PluginManager {
    installed_dir: PathBuf,
    state_path: PathBuf,
}

impl PluginManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let base = app_data_dir.join("plugins");
        Self {
            installed_dir: base.join("installed"),
            state_path: base.join("state.json"),
        }
    }

    fn load_state(&self) -> PluginState {
        std::fs::read_to_string(&self.state_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_state(&self, state: &PluginState) -> PluginResult<()> {
        if let Some(parent) = self.state_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.state_path, serde_json::to_string_pretty(state)?)?;
        Ok(())
    }

    /// List all installed plugins with their enabled state, sorted by name.
    pub fn list(&self) -> PluginResult<Vec<PluginRecord>> {
        let state = self.load_state();
        let mut records = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.installed_dir) else {
            return Ok(vec![]);
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            match PluginManifest::parse_from_dir(&path) {
                Ok(manifest) => {
                    let compatible = manifest.validate_api().is_ok();
                    let enabled = compatible && state.enabled.contains(&manifest.id);
                    records.push(PluginRecord {
                        enabled,
                        install_path: path,
                        manifest,
                    });
                }
                Err(e) => {
                    tracing::warn!("skipping plugin dir {:?}: {e}", path);
                }
            }
        }
        records.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
        Ok(records)
    }

    /// Install a plugin by copying `src_dir` into the managed directory.
    /// Returns the new `PluginRecord` (disabled by default).
    pub fn install(&self, src_dir: &Path) -> PluginResult<PluginRecord> {
        let manifest = PluginManifest::from_dir(src_dir)?;
        let dest = self.installed_dir.join(&manifest.id);
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        std::fs::create_dir_all(&dest)?;
        copy_dir_all(src_dir, &dest)?;
        // Ensure a newly installed/updated plugin starts disabled until user consent.
        self.disable(&manifest.id)?;
        Ok(PluginRecord {
            enabled: false,
            install_path: dest,
            manifest,
        })
    }

    /// Install all bundled API 0.2.0 sample plugins (replacing the legacy 0.1.0 word-count sample if present).
    /// Existing user-modified copies with the same id are preserved unless not yet installed.
    pub fn install_samples(&self) -> PluginResult<Vec<PluginRecord>> {
        let legacy_dir = self.installed_dir.join("keepsake-word-count");
        if legacy_dir.is_dir() {
            let _ = self.disable("keepsake-word-count");
            let _ = std::fs::remove_dir_all(&legacy_dir);
        }

        std::fs::create_dir_all(&self.installed_dir)?;
        for sample in BUNDLED_SAMPLES {
            let dest = self.installed_dir.join(sample.id);
            if dest.is_dir() {
                continue;
            }
            std::fs::create_dir_all(&dest)?;
            std::fs::write(dest.join("plugin.json"), sample.manifest_json)?;
            std::fs::write(dest.join("index.js"), sample.entry_js)?;
            std::fs::write(dest.join("README.md"), sample.readme_md)?;
        }
        self.list()
    }

    pub fn enable(&self, id: &str) -> PluginResult<()> {
        if !is_safe_id(id) {
            return Err(PluginError::InvalidManifest(format!(
                "invalid plugin id {id:?}"
            )));
        }
        let dir = self.installed_dir.join(id);
        if !dir.is_dir() {
            return Err(PluginError::NotFound(id.to_string()));
        }
        let _manifest = PluginManifest::from_dir(&dir)?;

        let mut state = self.load_state();
        if !state.enabled.iter().any(|s| s == id) {
            state.enabled.push(id.to_string());
        }
        self.save_state(&state)
    }

    pub fn disable(&self, id: &str) -> PluginResult<()> {
        if !is_safe_id(id) {
            return Err(PluginError::InvalidManifest(format!(
                "invalid plugin id {id:?}"
            )));
        }
        let mut state = self.load_state();
        state.enabled.retain(|s| s != id);
        self.save_state(&state)
    }

    /// Uninstall a plugin: remove it from enabled state and delete its directory.
    pub fn remove(&self, id: &str) -> PluginResult<()> {
        if !is_safe_id(id) {
            return Err(PluginError::InvalidManifest(format!(
                "invalid plugin id {id:?}"
            )));
        }
        let dir = self.installed_dir.join(id);
        if !dir.is_dir() {
            return Err(PluginError::NotFound(id.to_string()));
        }
        self.disable(id)?;
        std::fs::remove_dir_all(&dir)?;
        Ok(())
    }

    /// Verify that `id` is installed, enabled, compatible with API 0.2, and declares `cap`.
    pub fn require_enabled_capability(&self, id: &str, cap: Capability) -> PluginResult<()> {
        if !is_safe_id(id) {
            return Err(PluginError::InvalidManifest(format!(
                "invalid plugin id {id:?}"
            )));
        }
        let state = self.load_state();
        if !state.enabled.iter().any(|s| s == id) {
            return Err(PluginError::PermissionDenied(format!(
                "plugin '{id}' is not enabled"
            )));
        }
        let dir = self.installed_dir.join(id);
        if !dir.is_dir() {
            return Err(PluginError::NotFound(id.to_string()));
        }
        let manifest = PluginManifest::from_dir(&dir)?;
        if !manifest.permissions.contains(&cap) {
            return Err(PluginError::PermissionDenied(format!(
                "plugin '{id}' lacks permission '{}'",
                cap.as_str()
            )));
        }
        Ok(())
    }

    /// Read the entry-point JS source for a plugin so the host can inject it
    /// into a sandboxed Worker (with the bridge preamble prepended).
    pub fn read_entry(&self, id: &str) -> PluginResult<String> {
        if !is_safe_id(id) {
            return Err(PluginError::InvalidManifest(format!(
                "invalid plugin id {id:?}"
            )));
        }
        let dir = self.installed_dir.join(id);
        if !dir.is_dir() {
            return Err(PluginError::NotFound(id.to_string()));
        }
        let manifest = PluginManifest::from_dir(&dir)?;
        let entry_path = dir.join(&manifest.entry);
        Ok(std::fs::read_to_string(&entry_path)?)
    }
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)?.flatten() {
        let ty = entry.file_type()?;
        // Never follow or copy symlinks out of or into the plugin directory.
        if ty.is_symlink() {
            continue;
        }
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else if ty.is_file() {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_plugin_dir(parent: &Path, manifest: &str, entry_rel: &str) -> PathBuf {
        let dir = parent.join("test-plugin");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("plugin.json"), manifest).unwrap();
        if let Some(entry_parent) = Path::new(entry_rel).parent() {
            if !entry_parent.as_os_str().is_empty() {
                let _ = fs::create_dir_all(dir.join(entry_parent));
            }
        }
        if is_safe_relative_path(entry_rel) {
            fs::write(
                dir.join(entry_rel),
                "BibalakPlugin.definePlugin({ activate: function() {} });",
            )
            .unwrap();
        }
        dir
    }

    const MANIFEST_JSON: &str = r#"{
        "id": "test-plugin",
        "name": "Test Plugin",
        "version": "1.2.3",
        "entry": "index.js",
        "description": "A test plugin",
        "apiVersion": "0.2.0",
        "permissions": ["ui:command", "events:listen"]
    }"#;

    #[test]
    fn manifest_parses_capabilities() {
        let tmp = TempDir::new().unwrap();
        let dir = write_plugin_dir(tmp.path(), MANIFEST_JSON, "index.js");
        let m = PluginManifest::from_dir(&dir).unwrap();
        assert_eq!(m.id, "test-plugin");
        assert_eq!(m.version, "1.2.3");
        assert_eq!(m.api_version, "0.2.0");
        assert_eq!(
            m.permissions,
            vec![Capability::UiCommand, Capability::EventsListen]
        );
        assert_eq!(m.permission_strings(), vec!["ui:command", "events:listen"]);
    }

    #[test]
    fn manifest_rejects_unsupported_api_version() {
        let tmp = TempDir::new().unwrap();
        for ver in ["0.1.0", "0.3.0", "1.0.0", "bad", "0.2.x"] {
            let json = format!(
                r#"{{"id":"test-plugin","name":"X","version":"1.0.0","entry":"index.js","apiVersion":"{ver}"}}"#
            );
            let dir = write_plugin_dir(tmp.path(), &json, "index.js");
            let res = PluginManifest::from_dir(&dir);
            assert!(
                matches!(res, Err(PluginError::InvalidManifest(ref msg)) if msg.contains("apiVersion")),
                "apiVersion {ver:?} must be rejected, got {res:?}"
            );
        }
    }

    #[test]
    fn manifest_rejects_reserved_capabilities_with_clear_message() {
        let tmp = TempDir::new().unwrap();
        for cap in [
            "write:cards",
            "ui:review-button",
            "net:fetch",
            "ai:card-hint",
            "ai:note-fill-back",
            "ai:deck-summary",
        ] {
            let json = format!(
                r#"{{"id":"test-plugin","name":"X","version":"1.0.0","entry":"index.js","apiVersion":"0.2.0","permissions":["{cap}"]}}"#
            );
            let dir = write_plugin_dir(tmp.path(), &json, "index.js");
            let res = PluginManifest::from_dir(&dir);
            assert!(
                matches!(res, Err(PluginError::InvalidManifest(ref msg)) if msg.contains(cap) && msg.contains("reserved")),
                "reserved capability {cap:?} must be rejected clearly, got {res:?}"
            );
        }
    }

    #[test]
    fn install_enable_disable_remove_persists() {
        let tmp = TempDir::new().unwrap();
        let src = write_plugin_dir(tmp.path(), MANIFEST_JSON, "index.js");
        let app_dir = tmp.path().join("appdata");
        let mgr = PluginManager::new(&app_dir);

        let record = mgr.install(&src).unwrap();
        assert_eq!(record.manifest.id, "test-plugin");
        assert!(!record.enabled);

        // Enable → list shows enabled
        mgr.enable("test-plugin").unwrap();
        let records = mgr.list().unwrap();
        assert!(records
            .iter()
            .any(|r| r.manifest.id == "test-plugin" && r.enabled));

        // Capability check passes for declared, fails for undeclared
        assert!(mgr
            .require_enabled_capability("test-plugin", Capability::UiCommand)
            .is_ok());
        assert!(matches!(
            mgr.require_enabled_capability("test-plugin", Capability::ReadDecks),
            Err(PluginError::PermissionDenied(_))
        ));

        // Disable → back to disabled
        mgr.disable("test-plugin").unwrap();
        let records = mgr.list().unwrap();
        assert!(records
            .iter()
            .any(|r| r.manifest.id == "test-plugin" && !r.enabled));
        assert!(matches!(
            mgr.require_enabled_capability("test-plugin", Capability::UiCommand),
            Err(PluginError::PermissionDenied(_))
        ));

        // Remove → directory and state removed
        mgr.remove("test-plugin").unwrap();
        assert!(mgr.list().unwrap().is_empty());
        assert!(matches!(
            mgr.remove("test-plugin"),
            Err(PluginError::NotFound(_))
        ));
    }

    #[test]
    fn install_samples_bundles_all_four_and_cleans_legacy_sample() {
        let tmp = TempDir::new().unwrap();
        let app_dir = tmp.path().join("appdata");
        let mgr = PluginManager::new(&app_dir);

        // Simulate legacy 0.1.0 word-count sample
        let legacy = app_dir.join("plugins/installed/keepsake-word-count");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("plugin.json"), "{}").unwrap();

        let list = mgr.install_samples().unwrap();
        assert!(!legacy.exists());
        assert_eq!(list.len(), 4);
        assert!(list
            .iter()
            .all(|r| !r.enabled && r.manifest.api_version == "0.2.0"));
        for r in &list {
            assert!(mgr.read_entry(&r.manifest.id).is_ok());
        }
    }

    #[test]
    fn install_copies_files_and_entry_readable() {
        let tmp = TempDir::new().unwrap();
        let src = write_plugin_dir(tmp.path(), MANIFEST_JSON, "index.js");
        let app_dir = tmp.path().join("appdata");
        let mgr = PluginManager::new(&app_dir);
        mgr.install(&src).unwrap();

        // Files copied
        let dest = app_dir.join("plugins/installed/test-plugin");
        assert!(dest.join("plugin.json").exists());
        assert!(dest.join("index.js").exists());

        // Entry readable
        let entry = mgr.read_entry("test-plugin").unwrap();
        assert!(!entry.is_empty());
    }

    fn manifest_with(id: &str, entry: &str) -> String {
        format!(
            r#"{{"id": "{id}", "name": "X", "version": "1.0.0", "entry": "{entry}", "apiVersion": "0.2.0"}}"#
        )
    }

    #[test]
    fn manifest_rejects_path_traversal_in_id() {
        let tmp = TempDir::new().unwrap();
        for id in ["../evil", "a/b", "a\\\\b", "..", ".", "C:evil"] {
            let dir = write_plugin_dir(tmp.path(), &manifest_with(id, "index.js"), "index.js");
            let res = PluginManifest::from_dir(&dir);
            assert!(
                matches!(res, Err(PluginError::InvalidManifest(_))),
                "id {id:?} must be rejected, got {res:?}"
            );
        }
    }

    #[test]
    fn manifest_rejects_entry_outside_plugin_dir() {
        let tmp = TempDir::new().unwrap();
        for entry in [
            "../../secret.txt",
            "/etc/passwd",
            "C:\\\\Windows\\\\win.ini",
            "sub/../../x.js",
        ] {
            let dir = write_plugin_dir(tmp.path(), &manifest_with("ok-plugin", entry), entry);
            let res = PluginManifest::from_dir(&dir);
            assert!(
                matches!(res, Err(PluginError::InvalidManifest(_))),
                "entry {entry:?} must be rejected, got {res:?}"
            );
        }
        // A nested relative entry stays allowed.
        let dir = write_plugin_dir(
            tmp.path(),
            &manifest_with("ok-plugin", "dist/index.js"),
            "dist/index.js",
        );
        assert!(PluginManifest::from_dir(&dir).is_ok());
    }
}
