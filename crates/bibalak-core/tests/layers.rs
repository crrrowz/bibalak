//! Layer guard (ARCH8): `bibalak-core`, `bibalak-scheduler`, and
//! `bibalak-render` must stay pure — no DB, network, filesystem, or Tauri
//! dependencies, and no `std::fs` / `std::net` / `std::process` / wall-clock
//! reads outside the explicit `SystemClock` adapter in `ports.rs`.

use std::fs;
use std::path::{Path, PathBuf};

const PURE_CRATES: &[(&str, &[&str])] = &[
    (
        "bibalak-core",
        &[
            "serde",
            "serde_json",
            "sha1",
            "thiserror",
            "ts-rs",
            "unicode-normalization",
        ],
    ),
    ("bibalak-scheduler", &["bibalak-core"]),
    ("bibalak-render", &["bibalak-core", "regex"]),
];

const FORBIDDEN_PATTERNS: &[&str] = &[
    "std::fs",
    "std::net",
    "std::process",
    "rusqlite",
    "tauri::",
    "use tauri",
    "ureq",
    "reqwest",
    "tokio",
];

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir).expect("read src dir");
    for entry in entries {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

fn parse_dependencies(manifest: &str) -> Vec<String> {
    let mut deps = Vec::new();
    let mut in_deps = false;
    for raw_line in manifest.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') {
            in_deps = line == "[dependencies]";
            continue;
        }
        if in_deps {
            if let Some((key, _)) = line.split_once('=') {
                let name = key.trim().split('.').next().unwrap_or("").trim();
                if !name.is_empty() {
                    deps.push(name.to_string());
                }
            }
        }
    }
    deps
}

#[test]
fn pure_crates_have_no_io_dependencies() {
    let crates_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates parent dir");

    for &(crate_name, allowed) in PURE_CRATES {
        let crate_dir = crates_root.join(crate_name);
        let manifest_path = crate_dir.join("Cargo.toml");
        let manifest = fs::read_to_string(&manifest_path)
            .unwrap_or_else(|e| panic!("read {}: {e}", manifest_path.display()));

        for dep in parse_dependencies(&manifest) {
            assert!(
                allowed.contains(&dep.as_str()),
                "{crate_name} added non-allowlisted dependency `{dep}` in Cargo.toml"
            );
        }

        let mut rs_files = Vec::new();
        collect_rs_files(&crate_dir.join("src"), &mut rs_files);
        for file in rs_files {
            let content = fs::read_to_string(&file)
                .unwrap_or_else(|e| panic!("read {}: {e}", file.display()));
            // Strip `#[cfg(test)]` tail and comment-only lines so doc comments mentioning
            // adapter crates (e.g. `ureq`) or unit tests don't trigger false positives.
            let prod_raw = content.split("#[cfg(test)]").next().unwrap_or(&content);
            let prod: String = prod_raw
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            for pat in FORBIDDEN_PATTERNS {
                assert!(
                    !prod.contains(pat),
                    "{} contains forbidden IO/framework reference `{pat}`",
                    file.display()
                );
            }
            let is_ports = crate_name == "bibalak-core"
                && (file.file_name().and_then(|n| n.to_str()) == Some("ports.rs")
                    || file.ends_with(Path::new("ports").join("mod.rs")));
            if !is_ports {
                assert!(
                    !prod.contains("SystemTime::now"),
                    "{} calls `SystemTime::now` outside bibalak-core/src/ports/mod.rs",
                    file.display()
                );
            }
        }
    }
}
