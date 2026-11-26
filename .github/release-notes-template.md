## Downloads

| Platform | Architecture              | Artifact                             | Notes                                                     |
| -------- | ------------------------- | ------------------------------------ | --------------------------------------------------------- |
| Windows  | x86_64                    | `Bibalak_<version>_x64-setup.exe`    | Standard NSIS installer                                   |
| Windows  | x86_64                    | `Bibalak_<version>_x64_en-US.msi`    | MSI installer                                             |
| Windows  | x86_64                    | `Bibalak_<version>_x64_portable.zip` | Portable copy (extract and run; stores data in `./data/`) |
| macOS    | Apple Silicon (`aarch64`) | `Bibalak_<version>_aarch64.dmg`      | Drag `Bibalak.app` to Applications                        |
| macOS    | Intel (`x64`)             | `Bibalak_<version>_x64.dmg`          | Drag `Bibalak.app` to Applications                        |
| Linux    | x86_64                    | `Bibalak_<version>_amd64.AppImage`   | `chmod +x` and run directly                               |
| Linux    | x86_64                    | `Bibalak_<version>_amd64.deb`        | Debian / Ubuntu (`sudo apt install ./Bibalak_*.deb`)      |
| Linux    | x86_64                    | `Bibalak-<version>-1.x86_64.rpm`     | Fedora / openSUSE (`sudo dnf install ./Bibalak-*.rpm`)    |

### Unsigned installer notice

Installers are **not code-signed yet**:

- **Windows (SmartScreen):** Click **More info** → **Run anyway**.
- **macOS (Gatekeeper):** Right-click `Bibalak.app` → **Open** → **Open** (or allow in **System Settings → Privacy & Security**).

### Verify checksums (`SHA256SUMS`)

```sh
# Linux / macOS
sha256sum -c SHA256SUMS --ignore-missing

# Windows (PowerShell)
Get-FileHash .\Bibalak_<version>_x64-setup.exe -Algorithm SHA256
```

---

_Bibalak is licensed under `AGPL-3.0-or-later` (`LICENSE`), with `THIRD_PARTY_NOTICES.md` included in every package. Not affiliated with Ankitects Pty Ltd / Anki._
