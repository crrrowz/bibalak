//! Thin Tauri IPC commands for productivity (task lists, tasks, matrix,
//! habits, habit logs, and local calendar) (ADR-018 §2.11 D).

use bibalak_core::ipc::{IpcError, IpcErrorKind};
use bibalak_core::productivity::{
    CalendarEventInput, CalendarOccurrenceDto, HabitBoardDto, HabitDto, HabitHistoryDto,
    HabitInput, HabitLogDto, HabitLogInput, MatrixBoardDto, MatrixQuadrantDto, QuadrantKey,
    TaskDto, TaskInput, TaskListDto, TaskListInput, TaskOrderItem, WeekStart,
};
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

const MAX_CALENDAR_WINDOW_MS: i64 = 3_660 * 86_400_000;

fn validate_calendar_window(window_start_ms: i64, window_end_ms: i64) -> IpcResult<()> {
    if window_end_ms <= window_start_ms {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "calendar window_end_ms must be greater than window_start_ms".into(),
        });
    }
    if window_end_ms.saturating_sub(window_start_ms) > MAX_CALENDAR_WINDOW_MS {
        return Err(IpcError {
            kind: IpcErrorKind::Invalid,
            message: "calendar window exceeds maximum 10-year range".into(),
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn list_task_lists(app: AppHandle) -> IpcResult<Vec<TaskListDto>> {
    with_collection(app, |collection| {
        collection.list_task_lists().map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_task_list(app: AppHandle, input: TaskListInput) -> IpcResult<TaskListDto> {
    with_collection(app, move |collection| {
        collection.create_task_list(input).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_task_list(
    app: AppHandle,
    id: String,
    input: TaskListInput,
) -> IpcResult<TaskListDto> {
    with_collection(app, move |collection| {
        collection
            .update_task_list(&id, input)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_task_list(app: AppHandle, id: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.delete_task_list(&id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn get_matrix_board(
    app: AppHandle,
    include_completed: bool,
) -> IpcResult<MatrixBoardDto> {
    with_collection(app, move |collection| {
        collection
            .get_matrix_board(include_completed)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_task(app: AppHandle, input: TaskInput) -> IpcResult<TaskDto> {
    with_collection(app, move |collection| {
        collection.create_task(input).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_task(app: AppHandle, id: String, input: TaskInput) -> IpcResult<TaskDto> {
    with_collection(app, move |collection| {
        collection.update_task(&id, input).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn complete_task(app: AppHandle, id: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.complete_task(&id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn reopen_task(app: AppHandle, id: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.reopen_task(&id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_task(app: AppHandle, id: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.delete_task(&id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn reorder_tasks(app: AppHandle, items: Vec<TaskOrderItem>) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.reorder_tasks(items).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn reschedule_overdue_tasks(app: AppHandle, target_date: String) -> IpcResult<u32> {
    with_collection(app, move |collection| {
        collection
            .reschedule_overdue_tasks(&target_date)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn move_task_to_quadrant(
    app: AppHandle,
    id: String,
    quadrant: QuadrantKey,
) -> IpcResult<TaskDto> {
    with_collection(app, move |collection| {
        collection
            .move_task_to_quadrant(&id, quadrant)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn save_matrix_quadrant(
    app: AppHandle,
    quadrant: MatrixQuadrantDto,
) -> IpcResult<MatrixQuadrantDto> {
    with_collection(app, move |collection| {
        collection
            .save_matrix_quadrant(quadrant)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn restore_matrix_defaults(
    app: AppHandle,
    quadrant: Option<QuadrantKey>,
) -> IpcResult<Vec<MatrixQuadrantDto>> {
    with_collection(app, move |collection| {
        collection
            .restore_matrix_defaults(quadrant)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn get_habit_board(
    app: AppHandle,
    week_start_day: Option<i32>,
    week_start: Option<WeekStart>,
) -> IpcResult<HabitBoardDto> {
    with_collection(app, move |collection| {
        collection
            .get_habit_board(week_start_day, week_start)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn get_habit_history(
    app: AppHandle,
    habit_id: String,
    months: Option<u32>,
    week_start: Option<WeekStart>,
) -> IpcResult<HabitHistoryDto> {
    with_collection(app, move |collection| {
        collection
            .get_habit_history(&habit_id, months, week_start)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn list_archived_habits(app: AppHandle) -> IpcResult<Vec<HabitDto>> {
    with_collection(app, |collection| {
        collection.list_archived_habits().map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_habit(app: AppHandle, input: HabitInput) -> IpcResult<HabitDto> {
    with_collection(app, move |collection| {
        collection.create_habit(input).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_habit(app: AppHandle, id: String, input: HabitInput) -> IpcResult<HabitDto> {
    with_collection(app, move |collection| {
        collection.update_habit(&id, input).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn archive_habit(app: AppHandle, id: String, archived: bool) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection
            .archive_habit(&id, archived)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_habit(app: AppHandle, id: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection.delete_habit(&id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn log_habit(app: AppHandle, input: HabitLogInput) -> IpcResult<HabitLogDto> {
    with_collection(app, move |collection| {
        collection.log_habit(input).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn list_calendar_occurrences(
    app: AppHandle,
    window_start_ms: i64,
    window_end_ms: i64,
) -> IpcResult<Vec<CalendarOccurrenceDto>> {
    validate_calendar_window(window_start_ms, window_end_ms)?;
    with_collection(app, move |collection| {
        collection
            .list_calendar_occurrences(window_start_ms, window_end_ms)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_calendar_event(
    app: AppHandle,
    input: CalendarEventInput,
) -> IpcResult<CalendarOccurrenceDto> {
    with_collection(app, move |collection| {
        collection
            .create_calendar_event(input)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_calendar_event(
    app: AppHandle,
    id: String,
    input: CalendarEventInput,
) -> IpcResult<CalendarOccurrenceDto> {
    with_collection(app, move |collection| {
        collection
            .update_calendar_event(&id, input)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_calendar_event(app: AppHandle, id: String) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection
            .delete_calendar_event(&id)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_calendar_occurrence(
    app: AppHandle,
    id: String,
    occurrence_date: String,
) -> IpcResult<()> {
    with_collection(app, move |collection| {
        collection
            .delete_calendar_occurrence(&id, &occurrence_date)
            .map_err(IpcError::from)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calendar_window_rejects_inverted_or_oversized_range() {
        assert!(validate_calendar_window(1_000, 1_000).is_err());
        assert!(validate_calendar_window(2_000, 1_000).is_err());
        assert!(validate_calendar_window(0, MAX_CALENDAR_WINDOW_MS + 1).is_err());
        assert!(validate_calendar_window(0, 86_400_000 * 30).is_ok());
    }
}
