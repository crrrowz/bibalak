# ADR-028: Reminders — rules in core, one plan command, a notifications capability (16c)

**Status:** Accepted
**Date:** 2026-11-25

## Context

16c adds daily study, evening streak and habit reminders. asks that every
feature run on Windows, macOS, Linux, phones and a web version from one core.
OS notification APIs differ per host, and some hosts (the preview, a browser
tab that is closed) cannot deliver at a given time.

## Decision

1. **Rules in `bibalak-core::reminders`** (pure: no OS, Tauri, clock or UI
   imports). `plan_reminders(&ReminderPlanInput)` takes `now_ms`, the time
   zone offset, the rollover hour, today's XP, the study streak, freeze
   tokens, the style, the reminder settings and today's habits and logs, and
   returns the reminders due in the next 24 hours. Days come from the
   backend day index (rollover hour + offset), never from the UI.
2. **One IPC command, `plan_reminders(settings, style)`** (async),
   returning `ReminderPlanDto { items: PlannedReminderDto[], next_rollover_ms }`.
   Each item has a stable id per day (`daily:<day>`, `evening:<day>`,
   `habit:<id>:<HH:MM>:<day>`), `fire_at_ms`, a kind, i18n keys and args.
3. **Delivery is a host capability:** `NotificationsApi` in
   `lib/platform/types.ts`; the desktop adapter uses
   `tauri-plugin-notification` (Windows, macOS, Linux; Tauri mobile later);
   `null` in the preview and in tests. Screens never import the plugin.
4. **A thin front-end runner** asks for the plan on start, at the next
   rollover and on data events, keeps one timer, and remembers fired ids so
   nothing fires twice in a day. It has no rules of its own.

## Consequences

- A phone build can hand the whole plan to the OS ahead of time; a server
  can send the same plan as push later.
- Today reminders fire only while Bibalak is running (the Settings hint
  says so).
- Reminder switches and times live in the front-end store (`localStorage`),
  so they do not sync between devices yet; moving them into the collection
  config is a Stage 2 item.
- The time zone offset is the one the app already uses; a DST change during
  the day shifts reminders by an hour until the next plan, like the rest of
  the day index.
