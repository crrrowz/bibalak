# Bibalak Privacy Policy — desktop app (DRAFT)

> Draft for legal review — not legal advice. Written to match what the desktop
> app does as of 2026-11-12; update it whenever data handling changes (sync,
> accounts, crash reports, AI, the web app).

Effective date: [EFFECTIVE DATE]

[COMPANY] ("we") makes Bibalak. This policy explains what happens to your
data when you use the Bibalak desktop app.

## Summary

- Your decks, notes, media and study history stay **on your computer**.
- The app has **no account, no analytics and no advertising** today.
- The app contacts the internet only to **check for updates** (and to load
  images that a deck itself links to on the web).

## Data stored on your device

| Data                                                       | Where                                    | Purpose                                             |
| ---------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| Collection (decks, notes, cards, review history, settings) | App data folder (`com.keepsake.desktop`) | The app's core function                             |
| Media (images, audio)                                      | `collection.media` in the same folder    | Showing and playing cards                           |
| Backups                                                    | `backups` in the same folder             | Restoring your data                                 |
| Installed plugins and their settings                       | `plugins` in the same folder             | Plugins you chose to install                        |
| Interface preferences (theme, language, layout)            | Webview storage in the same folder       | Remembering your choices                            |
| Logs and crash reports                                     | Your system's temp/log folders           | Troubleshooting; only shared if you send them to us |

We cannot see this data. Deleting the app data folder deletes it.

## Network connections

- **Update check:** when you click "Check for updates" (and, once enabled,
  automatically), the app downloads a small version file from [WEBSITE]. Our
  server receives your IP address and the request, as any website does; we use
  server logs only to operate and secure the service and keep them for
  [RETENTION PERIOD].
- **Remote images in decks:** a deck may reference images hosted elsewhere.
  Showing those cards loads the images from that website, which then sees your
  IP address. Imported decks cannot otherwise send data out: their scripts run
  in a sandbox without network access.
- **Plugins:** plugins have no network access unless a future version lets you
  grant it explicitly.

## Data we receive from you directly

If you e-mail support or send us a log file, we use what you send only to
answer you and fix problems, and delete it when no longer needed.

## Payments

If you buy a paid edition, the purchase is handled by our payment provider
(merchant of record), which processes your payment and billing details under
its own privacy policy. We receive only what is needed to manage your license
(for example e-mail, country, order and license status).

## Children

Bibalak is a general-audience study tool. We do not knowingly collect personal
data from children, and the desktop app collects none from anyone.

## Your rights

Depending on where you live, you may have rights to access, correct, delete or
export personal data we hold about you (for example support e-mails or purchase
records). Contact [PRIVACY EMAIL]. Your collection itself is already under your
control on your device; you can export it at any time (Settings → Export).

## Changes

We will update this policy when the app's data handling changes and show the
new effective date. Significant changes will be announced in the app or on
[WEBSITE].

## Contact

[COMPANY], [ADDRESS] — [PRIVACY EMAIL]
