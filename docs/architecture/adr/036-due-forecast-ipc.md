# ADR-036: Lightweight `due_forecast` IPC for Calendar

**Status:** Proposed (2026-11-28)
**Date:** 2026-11-28

## Context

`CalendarScreen` previously called `get_stats(null, null)` on every mount solely to read `today_date` and `forecast` (30-day due review card counts). On large collections (`50k+` cards), `get_stats` performs a full `revlog` and `cards` scan (retention, FSRS stability/difficulty buckets, per-deck rollups, coach leeches).

## Decision

1. **Expose read-only `due_forecast(days?: number, tz_offset_minutes: number) -> DueForecastDto`** returning `{ today_date, forecast: DayCount[] }` (clamped `days` in `1..=365`, default `30`, `tz_offset_minutes` in `-1440..=1440`).
2. **Compute in one filtered SQL query** (`SELECT due - today, COUNT(*) FROM cards WHERE type = 2 AND queue = 2 AND due BETWEEN today AND today + days GROUP BY due`) matching `StatsDto.forecast` semantics and backend rollover day math.
3. **`CalendarScreen` calls `ipc.dueForecast(30)`** instead of `ipc.getStats(null, null)`.

## Consequences

- Zero schema migration (`user_version` stays v15).
- Eliminates full `revlog` scan when opening Calendar.
