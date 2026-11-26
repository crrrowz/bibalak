use std::fs;
use std::time::Instant;

use bibalak_core::ports::MediaStore;
use bibalak_media::FsMediaStore;

fn main() {
    let dir = tempfile::tempdir().expect("tempdir");
    let media_dir = dir.path().join("collection.media");
    fs::create_dir_all(&media_dir).expect("mkdir");

    // Pre-populate 5,000 small files on disk before FsMediaStore launches.
    for i in 0..5_000usize {
        let name = format!("existing-{i:04}.bin");
        let content = format!("existing-payload-{i:04}-data");
        fs::write(media_dir.join(name), content.as_bytes()).expect("write existing");
    }

    let store = FsMediaStore::new(media_dir);
    let started = Instant::now();
    for i in 0..2_000usize {
        let name = format!("import-{i:04}.bin");
        let content = format!("new-import-payload-{i:04}");
        store.add(&name, content.as_bytes()).expect("add");
    }
    let elapsed = started.elapsed();
    println!(
        "added 2000 files into 5000-file folder in {:.3}s ({:.2} ms/add)",
        elapsed.as_secs_f64(),
        elapsed.as_secs_f64() * 1000.0 / 2_000.0
    );
}
