# Install, build and portable use

How to get a working Bibalak desktop app: set up a development machine,
build installers or a portable copy, make a release, and install or run it on
each system. For day-to-day code work see [`CONTRIBUTING.md`](../../CONTRIBUTING.md);
for the release process see [`RELEASING.md`](../../RELEASING.md).

## Which copy do I need?

| You want to…                                        | Use                                  | Where it comes from                          |
| --------------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| Install on Windows like a normal program            | `Bibalak_<ver>_x64-setup.exe` (NSIS) | release, or [build](#2-build-installers)     |
| Install on Windows through IT / Group Policy        | `Bibalak_<ver>_x64_en-US.msi`        | release, or build                            |
| Run on Windows without installing (USB stick, etc.) | `Bibalak_<ver>_x64_portable.zip`     | release, or [build](#3-build-a-portable-zip) |
| macOS (Apple silicon)                               | `Bibalak_<ver>_aarch64.dmg`          | release only (needs a Mac or CI)             |
| macOS (Intel)                                       | `Bibalak_<ver>_x64.dmg`              | release only (needs a Mac or CI)             |
| Linux                                               | `.AppImage`, `.deb` or `.rpm`        | release, or build on Linux                   |
| Work on the code                                    | development setup                    | [section 1](#1-development-setup)            |

Every release is published on the repository's
[Releases](https://github.com/crrrowz/bibalak/releases/latest) page with a `SHA256SUMS` file
to check the downloads.

## 1. Development setup

### Tools

| Tool    | Version      | Notes                                                                        |
| ------- | ------------ | ---------------------------------------------------------------------------- |
| Git     | any          |                                                                              |
| Rust    | stable 1.89+ | <https://rustup.rs>; on Windows pick the MSVC toolchain                      |
| Node.js | 26 LTS       | Current LTS (`>=22` supported; `pnpm@11.5.0` requires `>=22.13`)             |
| pnpm    | 11.5.0       | Install globally with `npm install -g pnpm@11.5.0`, or use `npx pnpm@11.5.0` |

> [!IMPORTANT]
> Install `pnpm` globally (`npm install -g pnpm@11.5.0`), **never** by running `npm install pnpm` inside the repository. A local install adds `pnpm` as a dependency in `package.json` and breaks `pnpm dev`.

Per system:

- **Windows 10/11:** Visual Studio 2022 **Build Tools** with "Desktop
  development with C++". WebView2 is already part of Windows 10/11.
- **macOS:** `xcode-select --install`.
- **Linux (Debian/Ubuntu):**

  ```sh
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf \
    libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
  ```

### Get the code and run it

```sh
git clone https://github.com/crrrowz/bibalak
cd bibalak
pnpm install
cargo test -p bibalak-core   # also generates the TypeScript IPC types
pnpm dev                      # the desktop app with hot reload
```

`pnpm dev:web` runs the interface alone in a browser with sample data:
<http://localhost:1420/preview.html>.

A development build uses the same data folder as an installed copy (see
[Where data lives](#where-data-lives)). To keep test data apart, run a
portable build instead (section 3).

### Development build vs release build

`pnpm dev` and `pnpm build:app` are two different builds; the first never
turns into the second.

|              | `pnpm dev` (`tauri dev`)                                   | `pnpm build:app` (`tauri build`)                    |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------- |
| Rust profile | `dev`: `opt-level = 0`, debug info (fast to build)         | `release`: `opt-level = 3`, `lto = "thin"`, `strip` |
| Interface    | Loaded from the Vite server on `localhost:1420`            | Built by `vite build` and packed into the app       |
| Output       | `target/debug/desktop.exe` (needs the Vite server running) | Installers in `target/release/bundle/` (section 2)  |
| Use          | Daily development                                          | A copy to install or give to someone                |

### Faster Rust builds

Cargo rebuilds only what changed, so a small edit should take seconds to a
minute. A full rebuild (several minutes) happens when:

- **a new build folder is used** — every git worktree has its own `target/`
  by default, so each new worktree compiles all dependencies again;
- **the command changes the feature set** — `cargo test`, `clippy` and
  `tauri dev` turn on slightly different features of shared crates (for
  example dev-dependencies), so switching between them rebuilds crates such
  as `tokio` or `windows-sys`;
- **`Cargo.lock` changed** after a pull;
- **antivirus scans every new file** in `target/` (slow on Windows).

Tips:

- **Keep the build folder on a fast disk.** On Windows you can point `target`
  at another drive with a directory junction (any path works):

  ```powershell
  New-Item -ItemType Directory -Force E:\cargo-target\bibalak | Out-Null
  New-Item -ItemType Junction -Path target -Target E:\cargo-target\bibalak
  ```

- **Never share one build folder between git worktrees on different
  branches.** Cargo can then judge another branch's older sources as fresh
  and reuse the wrong compiled crates, so builds and tests give wrong results.
  Give each worktree its own `target` (the default) or its own
  `CARGO_TARGET_DIR`.
- **Antivirus:** excluding the build folder and `%USERPROFILE%\.cargo` from
  real-time scanning speeds builds up, at the cost of those files no longer
  being scanned.
- `cargo clean` frees the disk space when the folder grows large (the next
  build is a full one).

## 2. Build installers

```sh
pnpm --filter @bibalak/desktop tauri build
```

The first build takes several minutes. Output, under `target/release/`:

| System  | Files                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| Windows | `bundle/nsis/Bibalak_<ver>_x64-setup.exe`, `bundle/msi/Bibalak_<ver>_x64_en-US.msi`, `desktop.exe` |
| macOS   | `bundle/macos/Bibalak.app`, `bundle/dmg/Bibalak_<ver>_aarch64.dmg`                                 |
| Linux   | `bundle/appimage/*.AppImage`, `bundle/deb/*.deb`, `bundle/rpm/*.rpm`                               |

Each system builds only its own installers. The Windows tools (NSIS and WiX)
are downloaded by Tauri on the first build.

`--no-bundle` skips the installers and only builds `target/release/desktop.exe`.

A local build is **not code-signed**: Windows SmartScreen and macOS Gatekeeper
warn on first start (see [Unsigned builds](#unsigned-builds)).

## 3. Build a portable ZIP

Windows only. After `tauri build` (with or without `--no-bundle`):

```powershell
.\scripts\package-portable.ps1 -Version 1.0.0
```

It writes `target\portable\Bibalak_1.0.0_x64_portable.zip`, which holds one
`Bibalak` folder:

```
Bibalak\
  Bibalak.exe
  portable.txt              <- turns on portable mode
  LICENSE
  THIRD_PARTY_NOTICES.md
  data\                     <- created on first start
```

### How portable mode works

- If a file named `portable.txt` sits next to `Bibalak.exe`, Bibalak keeps
  **everything** in the `data` folder beside it: the collection, media,
  backups, plugins and the interface settings (language, sidebar layout).
  Nothing is written to `%APPDATA%`.
- Delete `portable.txt` and the same exe behaves like an installed copy.
- A portable copy starts with an empty collection. It does not read an
  installed copy's data; move data between them with **Export / Import** or a
  backup.
- To back up or move it, close Bibalak and copy the whole `Bibalak` folder.
- Needs the Microsoft Edge WebView2 Runtime, which Windows 10 and 11 include.
  On a system without it, install the "Evergreen" runtime from Microsoft.
- Don't run two copies on the same `data` folder at once.

## 4. Make a release (all systems)

Releases are built by GitHub Actions (`.github/workflows/release.yml`), so a
Mac is not needed for the macOS build.

1. Update `CHANGELOG.md` and the version in `Cargo.toml`, `package.json`,
   `apps/desktop/package.json` and `apps/desktop/src-tauri/tauri.conf.json`.
   Use numeric pre-release suffixes only (`1.0.1-1`; the MSI bundler rejects
   `-rc.1`).
2. Merge to `main`, then tag and push the tag:

   ```sh
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. The workflow builds Windows, macOS (Apple silicon and Intel) and Linux,
   signs the updater files when the signing secret is set, adds the Windows
   portable ZIP and `SHA256SUMS`, and publishes the release.
4. To check a release by hand first, set the repository variable
   `RELEASE_KEEP_DRAFT` to `true`; it then waits as a draft. Details in
   [`RELEASING.md`](../../RELEASING.md).

## 5. Install and first start

### Windows

- **Setup (`-setup.exe`):** double-click, follow the steps. Installs for the
  current user, adds a Start-menu entry and an uninstaller. If WebView2 is
  missing, the installer fetches it. This is the normal choice for Windows; the
  `.msi` file shows the generic Windows Installer icon in Explorer by design.
- **MSI:** `msiexec /i Bibalak_<ver>_x64_en-US.msi` (add `/qn` for a silent
  install).
- **Portable:** extract the ZIP anywhere you can write (Desktop, USB stick —
  not `C:\Program Files`), open `Bibalak\Bibalak.exe`.

### macOS

Open the `.dmg` and drag Bibalak into Applications.

### Linux

```sh
chmod +x Bibalak_*.AppImage && ./Bibalak_*.AppImage   # no install
sudo apt install ./Bibalak_*_amd64.deb                  # Debian/Ubuntu
sudo dnf install ./Bibalak-*.x86_64.rpm                 # Fedora
```

### Unsigned builds

Bibalak is not yet signed with an operating-system certificate, so the first
start shows a warning. The download is safe to open if its checksum matches
`SHA256SUMS` on the release page.

- **Windows:** SmartScreen says "Windows protected your PC" → **More info** →
  **Run anyway**.
- **macOS:** "cannot be opened because the developer cannot be verified" →
  try opening the app once, then allow it in **System Settings → Privacy &
  Security → Open Anyway** (on macOS 14 and older, right-click the app →
  **Open** → **Open**).
- **macOS, "Bibalak is damaged and can't be opened":** macOS adds a
  quarantine flag to unsigned downloads. After moving the app to
  Applications, run once in Terminal:

  ```sh
  xattr -dr com.apple.quarantine /Applications/Bibalak.app
  ```

### Coming from Anki

In Anki, **File → Export** as `.colpkg` (whole collection) or `.apkg` (a
deck), then **Import** in Bibalak. More in the [user guide](user-guide.md).

## Where data lives

| Copy                | Folder                                               |
| ------------------- | ---------------------------------------------------- |
| Windows (installed) | `%APPDATA%\com.keepsake.desktop`                     |
| Windows (portable)  | `data` next to `Bibalak.exe`                         |
| macOS               | `~/Library/Application Support/com.keepsake.desktop` |
| Linux               | `~/.local/share/com.keepsake.desktop`                |

Inside: `collection.sqlite` (the collection), `collection.media/`,
`backups/` (a ZIP every day the app is opened, last 20 kept) and `plugins/`.
Uninstalling does not delete this folder.

## Updates

From version 1.1.0 Bibalak updates itself from the
[Releases](https://github.com/crrrowz/bibalak/releases/latest) page. It checks
when it starts (at most once a day; turn this off in **Settings → Updates**)
and you can check by hand there. Nothing is downloaded until you click
**Update and restart**. Each update is checked against Bibalak's signing key
before it is installed. Your data is always kept.

| Installed with              | How it updates                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows `-setup.exe` (NSIS) | Downloads the new `-setup.exe`, installs it and restarts.                                                                                            |
| Windows `.msi`              | Downloads the new `.msi`, installs it and restarts (stays an MSI install).                                                                           |
| Windows portable ZIP        | Never updates itself. Settings shows the new version and opens the release page: download the new ZIP and replace the files, keep the `data` folder. |
| macOS `.dmg`                | Downloads the new app, replaces `Bibalak.app` and restarts.                                                                                          |
| Linux `.AppImage`           | Replaces the AppImage file and restarts.                                                                                                             |
| Linux `.deb` / `.rpm`       | Downloads the new package and installs it with `dpkg` / `rpm`; the system asks for your password.                                                    |

Version 1.0.0 cannot update itself: install 1.1.0 by hand once, over the old
one. Builds made without the signing key (for example from a fork) cannot
update themselves either; **Settings → Updates** says so.

## Troubleshooting

| Problem                                                | Fix                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm` not found / corepack error                      | Install globally with `npm install -g pnpm@11.5.0`, or use `npx pnpm@11.5.0 <command>`.                                    |
| Rust build fails with `link.exe` not found             | Install VS Build Tools with "Desktop development with C++".                                                                |
| Window opens blank (Windows)                           | Install or repair the WebView2 Runtime.                                                                                    |
| Portable copy still uses `%APPDATA%`                   | `portable.txt` must be next to `Bibalak.exe` and be a file (not `portable.txt.txt` — turn on file extensions in Explorer). |
| Portable copy won't start from a CD or a locked folder | It needs to write its `data` folder; copy it somewhere writable.                                                           |
| App crashed                                            | `%TEMP%\bibalak-crash.txt` holds the last panic message.                                                                   |
| Every Rust build takes minutes                         | See [Faster Rust builds](#faster-rust-builds): share one build folder between checkouts.                                   |
| `Blocking waiting for file lock on build directory`    | Another build uses the shared build folder; wait for it to finish.                                                         |
