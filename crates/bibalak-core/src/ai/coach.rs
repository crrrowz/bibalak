//! AI Study coach metrics aggregation and prompt formatting.

use super::types::{CoachDeckSummary, CoachInput};
use crate::ipc::StatsDto;

/// Build a pure [`CoachInput`] summary from [`StatsDto`], selected deck, and deck rollups.
pub fn build_coach_input(
    stats: &StatsDto,
    selected_deck_name: Option<String>,
    selected_deck_id: Option<i64>,
) -> CoachInput {
    let min_day = stats.today as i64 - 29;
    let max_day = stats.today as i64;
    let reviews_30d: u32 = stats
        .reviews
        .iter()
        .filter(|dc| dc.day >= min_day && dc.day <= max_day)
        .map(|dc| dc.count)
        .sum();

    let forecast_7d: u32 = stats
        .forecast
        .iter()
        .filter(|dc| dc.day >= 0 && dc.day < 7)
        .map(|dc| dc.count)
        .sum();
    let forecast_30d: u32 = stats
        .forecast
        .iter()
        .filter(|dc| dc.day >= 0 && dc.day < 30)
        .map(|dc| dc.count)
        .sum();

    let avg_minutes_per_day = if stats.studied_days > 0 {
        ((stats.total_time_ms as f64 / 60_000.0) / stats.studied_days as f64 * 10.0).round() / 10.0
    } else {
        0.0
    };

    let mut hourly_sorted = stats.hourly.clone();
    hourly_sorted.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.hour.cmp(&b.hour)));
    let peak_hours: Vec<u8> = hourly_sorted
        .into_iter()
        .filter(|h| h.total > 0)
        .take(3)
        .map(|h| h.hour)
        .collect();

    let mut deck_stats_sorted = stats.deck_stats.clone();
    deck_stats_sorted.sort_by(|a, b| {
        b.due_today
            .cmp(&a.due_today)
            .then_with(|| b.total_cards.cmp(&a.total_cards))
            .then_with(|| a.deck_id.cmp(&b.deck_id))
    });
    let top_decks: Vec<CoachDeckSummary> = deck_stats_sorted
        .into_iter()
        .take(10)
        .map(|d| CoachDeckSummary {
            deck_id: d.deck_id,
            name: d.name,
            due_today: d.due_today,
            retention_pct: (d.retention_pct.unwrap_or(0.0) * 10.0).round() / 10.0,
        })
        .collect();

    CoachInput {
        selected_deck: selected_deck_name,
        selected_deck_id,
        reviews_30d,
        retention_pct: (stats.retention_pct.unwrap_or(0.0) * 10.0).round() / 10.0,
        retention_goal_pct: (stats.retention_goal_pct * 10.0).round() / 10.0,
        backlog_count: stats.backlog_count,
        forecast_7d,
        forecast_30d,
        studied_days: stats.studied_days,
        avg_minutes_per_day,
        leech_count: stats.coach.leech_count,
        peak_hours,
        top_decks,
    }
}

/// Format the sanitized plain-text study stats prompt (numbers and deck names only, no card text).
pub fn format_coach_prompt(input: &CoachInput) -> String {
    let mut out = String::new();
    let scope = match (&input.selected_deck, input.selected_deck_id) {
        (Some(name), Some(id)) => format!("Selected deck: {name} (ID {id})"),
        (Some(name), None) => format!("Selected deck: {name}"),
        _ => "Whole collection".to_string(),
    };
    out.push_str(&format!("Scope: {scope}\n"));
    out.push_str(&format!("Last 30 days reviews: {}\n", input.reviews_30d));
    out.push_str(&format!(
        "Retention: {:.1}% (target: {:.1}%)\n",
        input.retention_pct, input.retention_goal_pct
    ));
    out.push_str(&format!("Overdue backlog: {} cards\n", input.backlog_count));
    out.push_str(&format!(
        "Due in next 7 days: {} cards\n",
        input.forecast_7d
    ));
    out.push_str(&format!(
        "Due in next 30 days: {} cards\n",
        input.forecast_30d
    ));
    out.push_str(&format!("Studied days: {}\n", input.studied_days));
    out.push_str(&format!(
        "Average time per studied day: {:.1} minutes\n",
        input.avg_minutes_per_day
    ));
    out.push_str(&format!("Leech cards: {}\n", input.leech_count));
    if input.peak_hours.is_empty() {
        out.push_str("Peak study hours: (no activity recorded yet)\n");
    } else {
        let formatted_hours = input
            .peak_hours
            .iter()
            .map(|h| format!("{h:02}:00"))
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!("Peak study hours: {formatted_hours}\n"));
    }
    out.push_str("\nTop decks by due count:\n");
    if input.top_decks.is_empty() {
        out.push_str("(no decks found)\n");
    } else {
        for d in &input.top_decks {
            out.push_str(&format!(
                "- [ID {}] {}: {} due today, {:.1}% retention\n",
                d.deck_id, d.name, d.due_today, d.retention_pct
            ));
        }
    }
    out
}
