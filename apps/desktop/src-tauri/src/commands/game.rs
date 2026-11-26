//! Thin Tauri IPC commands for Game style (R2a) and Game depth (R4-1).

use bibalak_core::game::{
    validate_avatar_profile_input, validate_client_tx_id, validate_custom_reward_input,
    validate_spend_history_limit, AvatarProfileDto, AvatarProfileInput, CustomRewardDto,
    CustomRewardInput, EquipmentSlot, GameStateDto, PurchaseResultDto, SpendHistoryEntryDto,
};
use bibalak_core::game_depth::{BackfillOutcomeDto, GameDepthStateDto, GamePathId};
use bibalak_core::ipc::IpcError;
use bibalak_core::CoreError;
use tauri::AppHandle;

use super::with_collection;

type IpcResult<T> = Result<T, IpcError>;

fn validate_non_empty_key(val: &str, field: &str) -> Result<String, IpcError> {
    let trimmed = val.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err(IpcError::from(CoreError::Invalid(format!(
            "{field} must be 1..=128 characters"
        ))));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
pub async fn get_game_state(app: AppHandle) -> IpcResult<GameStateDto> {
    with_collection(app, |collection| {
        collection.get_game_state().map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_avatar_profile(
    app: AppHandle,
    input: AvatarProfileInput,
) -> IpcResult<AvatarProfileDto> {
    validate_avatar_profile_input(&input).map_err(IpcError::from)?;
    with_collection(app, move |collection| {
        collection
            .update_avatar_profile(input)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn equip_game_item(
    app: AppHandle,
    slot: EquipmentSlot,
    item_key: String,
) -> IpcResult<GameStateDto> {
    let key = validate_non_empty_key(&item_key, "item_key")?;
    with_collection(app, move |collection| {
        collection
            .equip_game_item(slot, &key)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn unequip_game_slot(app: AppHandle, slot: EquipmentSlot) -> IpcResult<GameStateDto> {
    with_collection(app, move |collection| {
        collection.unequip_game_slot(slot).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn buy_shop_item(
    app: AppHandle,
    item_key: String,
    client_tx_id: String,
) -> IpcResult<PurchaseResultDto> {
    let key = validate_non_empty_key(&item_key, "item_key")?;
    let tx_id = validate_client_tx_id(&client_tx_id)
        .map_err(IpcError::from)?
        .to_owned();
    with_collection(app, move |collection| {
        collection
            .buy_shop_item(&key, &tx_id)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn refund_shop_purchase(app: AppHandle, spend_id: String) -> IpcResult<GameStateDto> {
    let id = validate_non_empty_key(&spend_id, "spend_id")?;
    with_collection(app, move |collection| {
        collection.refund_shop_purchase(&id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn list_custom_rewards(app: AppHandle) -> IpcResult<Vec<CustomRewardDto>> {
    with_collection(app, |collection| {
        collection.list_custom_rewards().map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn create_custom_reward(
    app: AppHandle,
    input: CustomRewardInput,
) -> IpcResult<CustomRewardDto> {
    let clean = validate_custom_reward_input(input).map_err(IpcError::from)?;
    with_collection(app, move |collection| {
        collection
            .create_custom_reward(clean)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn update_custom_reward(
    app: AppHandle,
    id: String,
    input: CustomRewardInput,
) -> IpcResult<CustomRewardDto> {
    let clean_id = validate_non_empty_key(&id, "id")?;
    let clean_input = validate_custom_reward_input(input).map_err(IpcError::from)?;
    with_collection(app, move |collection| {
        collection
            .update_custom_reward(&clean_id, clean_input)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn delete_custom_reward(app: AppHandle, id: String) -> IpcResult<()> {
    let clean_id = validate_non_empty_key(&id, "id")?;
    with_collection(app, move |collection| {
        collection
            .delete_custom_reward(&clean_id)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn claim_custom_reward(
    app: AppHandle,
    id: String,
    client_tx_id: String,
) -> IpcResult<PurchaseResultDto> {
    let clean_id = validate_non_empty_key(&id, "id")?;
    let tx_id = validate_client_tx_id(&client_tx_id)
        .map_err(IpcError::from)?
        .to_owned();
    with_collection(app, move |collection| {
        collection
            .claim_custom_reward(&clean_id, &tx_id)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn list_spend_history(
    app: AppHandle,
    limit: Option<u32>,
) -> IpcResult<Vec<SpendHistoryEntryDto>> {
    let lim = validate_spend_history_limit(limit).map_err(IpcError::from)?;
    with_collection(app, move |collection| {
        collection
            .list_spend_history(Some(lim))
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn get_game_depth_state(app: AppHandle) -> IpcResult<GameDepthStateDto> {
    with_collection(app, |collection| {
        collection.get_game_depth_state().map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn choose_game_path(app: AppHandle, path_id: GamePathId) -> IpcResult<GameDepthStateDto> {
    with_collection(app, move |collection| {
        collection.choose_game_path(path_id).map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn set_active_pet(
    app: AppHandle,
    pet_id: Option<String>,
    mounted: bool,
) -> IpcResult<GameDepthStateDto> {
    let clean_pet = match pet_id {
        Some(p) => Some(validate_non_empty_key(&p, "pet_id")?),
        None => None,
    };
    with_collection(app, move |collection| {
        collection
            .set_active_pet(clean_pet.as_deref(), mounted)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn acknowledge_unlocks(app: AppHandle, unlock_ids: Vec<String>) -> IpcResult<()> {
    if unlock_ids.len() > 500 {
        return Err(IpcError::from(CoreError::Invalid(
            "cannot acknowledge more than 500 unlocks at once".into(),
        )));
    }
    let mut clean = Vec::with_capacity(unlock_ids.len());
    for id in &unlock_ids {
        clean.push(validate_non_empty_key(id, "unlock_id")?);
    }
    with_collection(app, move |collection| {
        collection
            .acknowledge_unlocks(&clean)
            .map_err(IpcError::from)
    })
    .await
}

#[tauri::command]
pub async fn run_unlock_backfill(app: AppHandle) -> IpcResult<BackfillOutcomeDto> {
    with_collection(app, |collection| {
        collection.run_unlock_backfill().map_err(IpcError::from)
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use bibalak_core::ports::FixedClock;
    use bibalak_db::SqliteStorage;

    use super::*;

    #[test]
    fn game_ipc_validation_rejects_bad_inputs_and_roundtrips_collection() {
        assert!(validate_non_empty_key("   ", "item_key").is_err());
        assert!(validate_spend_history_limit(Some(0)).is_err());
        assert!(validate_spend_history_limit(Some(501)).is_err());

        let storage = SqliteStorage::open_in_memory().unwrap();
        let c = bibalak_core::Collection::new(
            Box::new(storage),
            Arc::new(FixedClock(1_795_341_600_000)),
        )
        .unwrap();
        let gs = c.get_game_state().unwrap();
        assert_eq!(gs.level, 1);
        assert_eq!(gs.freeze_token_cap, 3);
        let ds = c.get_game_depth_state().unwrap();
        assert!(ds.backfill_applied);
        assert_eq!(ds.achievements.len(), 25);
    }
}
