//! Canonical schema as an ordered list of migrations. The migration runner
//! applies any not yet reflected in the database's `user_version`. The schema
//! is a *superset* of Anki's so import/export round-trips losslessly; see
//! `docs/architecture/overview.md` §3.

/// `MIGRATIONS[i]` upgrades the database from `user_version == i` to `i + 1`.
/// Never edit a shipped migration — append a new one.
pub const MIGRATIONS: &[&str] = &[
    // v0 -> v1: initial canonical schema + seed (default deck config + Default deck).
    r#"
    CREATE TABLE collection (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        created    INTEGER NOT NULL,
        modified   INTEGER NOT NULL,
        schema_mod INTEGER NOT NULL,
        anki_ver   INTEGER NOT NULL DEFAULT 18,
        usn        INTEGER NOT NULL DEFAULT 0,
        last_sync  INTEGER NOT NULL DEFAULT 0,
        config     TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE deck_config (
        id     INTEGER PRIMARY KEY,
        name   TEXT NOT NULL,
        "mod"  INTEGER NOT NULL,
        usn    INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE decks (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        parent_id   INTEGER REFERENCES decks(id),
        config_id   INTEGER NOT NULL REFERENCES deck_config(id),
        "mod"       INTEGER NOT NULL,
        usn         INTEGER NOT NULL DEFAULT 0,
        collapsed   INTEGER NOT NULL DEFAULT 0,
        is_filtered INTEGER NOT NULL DEFAULT 0,
        common      TEXT NOT NULL DEFAULT '{}',
        filtered    TEXT
    );
    CREATE INDEX idx_decks_parent ON decks(parent_id);

    CREATE TABLE notetypes (
        id     INTEGER PRIMARY KEY,
        name   TEXT NOT NULL,
        kind   INTEGER NOT NULL DEFAULT 0,
        "mod"  INTEGER NOT NULL,
        usn    INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL DEFAULT '{}',
        data   TEXT
    );
    CREATE TABLE fields (
        notetype_id INTEGER NOT NULL REFERENCES notetypes(id) ON DELETE CASCADE,
        ord         INTEGER NOT NULL,
        name        TEXT NOT NULL,
        config      TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (notetype_id, ord)
    );
    CREATE TABLE templates (
        notetype_id INTEGER NOT NULL REFERENCES notetypes(id) ON DELETE CASCADE,
        ord         INTEGER NOT NULL,
        name        TEXT NOT NULL,
        qfmt        TEXT NOT NULL,
        afmt        TEXT NOT NULL,
        config      TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (notetype_id, ord)
    );

    CREATE TABLE notes (
        id          INTEGER PRIMARY KEY,
        guid        TEXT NOT NULL,
        notetype_id INTEGER NOT NULL REFERENCES notetypes(id),
        "mod"       INTEGER NOT NULL,
        usn         INTEGER NOT NULL DEFAULT 0,
        tags        TEXT NOT NULL DEFAULT '',
        fields      TEXT NOT NULL,
        sort_field  TEXT,
        checksum    INTEGER,
        data        TEXT
    );
    CREATE INDEX idx_notes_guid ON notes(guid);
    CREATE INDEX idx_notes_csum ON notes(checksum);

    CREATE TABLE cards (
        id               INTEGER PRIMARY KEY,
        note_id          INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        deck_id          INTEGER NOT NULL REFERENCES decks(id),
        ord              INTEGER NOT NULL,
        "mod"            INTEGER NOT NULL,
        usn              INTEGER NOT NULL DEFAULT 0,
        type             INTEGER NOT NULL DEFAULT 0,
        queue            INTEGER NOT NULL DEFAULT 0,
        due              INTEGER NOT NULL DEFAULT 0,
        interval         INTEGER NOT NULL DEFAULT 0,
        ease_factor      INTEGER NOT NULL DEFAULT 0,
        reps             INTEGER NOT NULL DEFAULT 0,
        lapses           INTEGER NOT NULL DEFAULT 0,
        remaining        INTEGER NOT NULL DEFAULT 0,
        original_due     INTEGER NOT NULL DEFAULT 0,
        original_deck_id INTEGER NOT NULL DEFAULT 0,
        flags            INTEGER NOT NULL DEFAULT 0,
        fsrs_stability   REAL,
        fsrs_difficulty  REAL,
        fsrs_last_review INTEGER,
        data             TEXT
    );
    CREATE INDEX idx_cards_note ON cards(note_id);
    CREATE INDEX idx_cards_sched ON cards(deck_id, queue, due);

    CREATE TABLE revlog (
        id            INTEGER PRIMARY KEY,
        card_id       INTEGER NOT NULL,
        usn           INTEGER NOT NULL DEFAULT 0,
        ease          INTEGER NOT NULL,
        interval      INTEGER NOT NULL,
        last_interval INTEGER NOT NULL,
        ease_factor   INTEGER NOT NULL,
        taken_ms      INTEGER NOT NULL,
        review_kind   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_revlog_card ON revlog(card_id);

    CREATE TABLE tags (
        name     TEXT PRIMARY KEY,
        usn      INTEGER NOT NULL DEFAULT 0,
        expanded INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE graves (
        oid  INTEGER NOT NULL,
        type INTEGER NOT NULL,
        usn  INTEGER NOT NULL DEFAULT -1,
        PRIMARY KEY (oid, type)
    );

    CREATE TABLE media (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        size     INTEGER NOT NULL,
        usn      INTEGER NOT NULL DEFAULT 0,
        mtime    INTEGER NOT NULL
    );

    -- Seed: a default options group and the Default deck (Anki convention).
    INSERT INTO deck_config (id, name, "mod", usn, config)
        VALUES (1, 'Default', 0, 0, '{}');
    INSERT INTO decks (id, name, parent_id, config_id, "mod", usn)
        VALUES (1, 'Default', NULL, 1, 0, 0);
    "#,
    // v1 -> v2: per-deck per-day "increase today's new card limit" override.
    // Keyed by (deck_id, day) where `day` is the collection-relative day number
    // (Collection::today()), so it naturally stops applying at day rollover.
    r#"
    CREATE TABLE day_limit_overrides (
        deck_id   INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        day       INTEGER NOT NULL,
        extra_new INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (deck_id, day)
    );
    "#,
    // v2 -> v3: every deck used to share the "Default" options group
    // (config_id=1), so editing one deck's new-cards/day silently changed
    // it for every other deck too. Give each existing non-Default deck its
    // own cloned config group; new decks already get one in create_deck().
    r#"
    INSERT INTO deck_config (name, "mod", usn, config)
    SELECT d.name, d."mod", -1, dc.config
    FROM decks d JOIN deck_config dc ON dc.id = d.config_id
    WHERE d.id <> 1;

    UPDATE decks
    SET config_id = (SELECT id FROM deck_config WHERE deck_config.name = decks.name AND deck_config.id <> 1)
    WHERE decks.id <> 1;
    "#,
    // v3 -> v4 (ADR-005): covering index for the study queue, per-deck counts
    // and the deck list. They filter on deck_id + type + due with
    // `queue NOT IN (...)`, which idx_cards_sched can only use for deck_id,
    // so every card row of the deck was read. With queue and the rowid (id)
    // in this index those queries never touch the table. idx_cards_sched stays
    // for queries that filter on queue directly.
    r#"
    CREATE INDEX idx_cards_study ON cards(deck_id, type, due, queue);
    "#,
    // v4 -> v5 (ADR-009): normalized text copy on notes for fast Arabic- and
    // accent-insensitive search without SQLite scalar UDF overhead.
    r#"
    ALTER TABLE notes ADD COLUMN fields_norm TEXT NOT NULL DEFAULT '';
    "#,
    // v5 -> v6 (ADR-012): compact covering index for time-bounded revlog->card
    // scans (`today_studied` and time-window lookups).
    r#"
    CREATE INDEX idx_revlog_stats ON revlog(id, card_id);
    "#,
    // v6 -> v7 (ADR-014): sync state storage for device cursor, sync counter,
    // and sync metadata tracking.
    r#"
    CREATE TABLE sync_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // v7 -> v8 (ADR-014): local-only grave deletion timestamps to support
    // accurate deterministic LWW tombstone reconciliation without altering Anki's graves schema.
    r#"
    CREATE TABLE grave_times (
        oid        INTEGER NOT NULL,
        type       INTEGER NOT NULL,
        deleted_ms INTEGER NOT NULL,
        PRIMARY KEY (oid, type)
    );
    INSERT OR IGNORE INTO grave_times (oid, type, deleted_ms)
    SELECT g.oid, g.type, COALESCE((SELECT modified FROM collection WHERE id = 1), CAST(strftime('%s', 'now') AS INTEGER) * 1000)
    FROM graves g;
    "#,
    // v8 -> v9 (ADR-019, R1): undo-safe progress reward ledger for XP and gold_cents.
    r#"
    CREATE TABLE progress_ledger (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        source_key  TEXT NOT NULL,
        xp          INTEGER NOT NULL CHECK (xp >= 0),
        gold_cents  INTEGER NOT NULL CHECK (gold_cents >= 0),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, source_key)
    );
    "#,
    // v9 -> v10 (ADR-018, M1): productivity tables (task_lists, tasks, matrix_quadrants,
    // habits, habit_logs, calendar_events).
    r#"
    CREATE TABLE task_lists (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
        color_token TEXT NOT NULL DEFAULT 'accent',
        icon_key    TEXT NULL,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1
    );
    CREATE INDEX idx_task_lists_active
        ON task_lists(user_id, deleted_at, sort_order, name);

    CREATE TABLE tasks (
        id                 TEXT PRIMARY KEY,
        user_id            TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        list_id            TEXT NULL REFERENCES task_lists(id) ON DELETE SET NULL,
        title              TEXT NOT NULL CHECK (length(trim(title)) > 0),
        notes              TEXT NOT NULL DEFAULT '',
        priority           TEXT NOT NULL DEFAULT 'none'
                           CHECK (priority IN ('high', 'medium', 'low', 'none')),
        manual_quadrant    TEXT NULL
                           CHECK (manual_quadrant IS NULL OR manual_quadrant IN ('q1', 'q2', 'q3', 'q4')),
        due_date           TEXT NULL
                           CHECK (due_date IS NULL OR (length(due_date) = 10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
        scheduled_start_ms INTEGER NULL,
        scheduled_end_ms   INTEGER NULL,
        tags_json          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags_json)),
        deck_id            INTEGER NULL,
        completed_at       INTEGER NULL,
        completed_day      INTEGER NULL,
        sort_order         INTEGER NOT NULL DEFAULT 0,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL,
        deleted_at         INTEGER NULL,
        usn                INTEGER NOT NULL DEFAULT -1,
        CHECK ((scheduled_start_ms IS NULL) = (scheduled_end_ms IS NULL)),
        CHECK (scheduled_end_ms IS NULL OR scheduled_end_ms > scheduled_start_ms)
    );
    CREATE INDEX idx_tasks_matrix
        ON tasks(user_id, deleted_at, completed_at, priority, due_date);
    CREATE INDEX idx_tasks_list
        ON tasks(user_id, list_id, deleted_at, sort_order);
    CREATE INDEX idx_tasks_schedule
        ON tasks(user_id, deleted_at, scheduled_start_ms, scheduled_end_ms);

    CREATE TABLE matrix_quadrants (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        quadrant_key TEXT NOT NULL CHECK (quadrant_key IN ('q1', 'q2', 'q3', 'q4')),
        title        TEXT NOT NULL DEFAULT '',
        color_token  TEXT NOT NULL,
        group_by     TEXT NOT NULL DEFAULT 'none'
                     CHECK (group_by IN ('none', 'tag', 'list', 'priority', 'date')),
        sort_by      TEXT NOT NULL DEFAULT 'date'
                     CHECK (sort_by IN ('date', 'priority', 'title', 'manual')),
        rule_json    TEXT NOT NULL CHECK (json_valid(rule_json)),
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        deleted_at   INTEGER NULL,
        usn          INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, quadrant_key)
    );

    INSERT OR IGNORE INTO matrix_quadrants
        (id, user_id, quadrant_key, title, color_token, group_by, sort_by, rule_json, created_at, updated_at, deleted_at, usn)
    VALUES
        ('8bf9e921-77c6-5c04-8a24-3543facf8922', '00000000-0000-0000-0000-000000000000', 'q1', '', 'danger',  'none', 'date', '{"lists":{"mode":"all"},"date_filters":["overdue","today","tomorrow"],"priorities":["high"],"types":null}', 0, 0, NULL, 0),
        ('dc2221a0-4d91-5f4b-ace9-2418543e78ee', '00000000-0000-0000-0000-000000000000', 'q2', '', 'warning', 'none', 'date', '{"lists":{"mode":"all"},"date_filters":null,"priorities":["high","medium"],"types":null}', 0, 0, NULL, 0),
        ('c6551142-e795-5a1f-bc1f-6031ceba3d2c', '00000000-0000-0000-0000-000000000000', 'q3', '', 'info',    'none', 'date', '{"lists":{"mode":"all"},"date_filters":["overdue","today","tomorrow"],"priorities":["low","none"],"types":null}', 0, 0, NULL, 0),
        ('738cec69-e2ee-5515-8403-5de096b8cbea', '00000000-0000-0000-0000-000000000000', 'q4', '', 'success', 'none', 'date', '{"lists":{"mode":"all"},"date_filters":null,"priorities":["low","none"],"types":null}', 0, 0, NULL, 0);

    CREATE TABLE habits (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
        notes           TEXT NOT NULL DEFAULT '',
        icon_key        TEXT NOT NULL DEFAULT 'check-circle',
        color_token     TEXT NOT NULL DEFAULT 'accent',
        frequency_kind  TEXT NOT NULL DEFAULT 'daily'
                        CHECK (frequency_kind IN ('daily', 'weekdays', 'weekly_count', 'every_n_days')),
        weekdays_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(weekdays_json)),
        weekly_target   INTEGER NULL CHECK (weekly_target IS NULL OR (weekly_target BETWEEN 1 AND 7)),
        interval_days   INTEGER NULL CHECK (interval_days IS NULL OR interval_days >= 1),
        goal_mode       TEXT NOT NULL DEFAULT 'achieve_all'
                        CHECK (goal_mode IN ('achieve_all', 'reach_amount')),
        goal_target     REAL NOT NULL DEFAULT 1.0 CHECK (goal_target > 0.0),
        goal_unit       TEXT NOT NULL DEFAULT '',
        start_day_index INTEGER NOT NULL,
        target_days     INTEGER NULL CHECK (target_days IS NULL OR target_days >= 1),
        section         TEXT NOT NULL DEFAULT 'others'
                        CHECK (section IN ('morning', 'afternoon', 'night', 'others')),
        reminders_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reminders_json)),
        auto_popup_log  INTEGER NOT NULL DEFAULT 0 CHECK (auto_popup_log IN (0, 1)),
        deck_id         INTEGER NULL,
        archived_at     INTEGER NULL,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        deleted_at      INTEGER NULL,
        usn             INTEGER NOT NULL DEFAULT -1
    );
    CREATE INDEX idx_habits_active
        ON habits(user_id, deleted_at, archived_at, section, sort_order);

    CREATE TABLE habit_logs (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        habit_id     TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        day_index    INTEGER NOT NULL,
        logged_value REAL NOT NULL DEFAULT 0.0 CHECK (logged_value >= 0.0),
        goal_target  REAL NOT NULL DEFAULT 1.0 CHECK (goal_target > 0.0),
        completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        mood         INTEGER NULL CHECK (mood IS NULL OR mood BETWEEN 1 AND 5),
        note         TEXT NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        deleted_at   INTEGER NULL,
        usn          INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, habit_id, day_index)
    );
    CREATE INDEX idx_habit_logs_day
        ON habit_logs(user_id, day_index, deleted_at);
    CREATE INDEX idx_habit_logs_habit
        ON habit_logs(user_id, habit_id, day_index);

    CREATE TABLE calendar_events (
        id                       TEXT PRIMARY KEY,
        user_id                  TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        title                    TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description              TEXT NOT NULL DEFAULT '',
        location                 TEXT NOT NULL DEFAULT '',
        color_token              TEXT NOT NULL DEFAULT 'accent',
        start_ms                 INTEGER NOT NULL,
        end_ms                   INTEGER NOT NULL,
        is_all_day               INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
        recurrence_freq          TEXT NULL
                                 CHECK (recurrence_freq IS NULL OR recurrence_freq IN ('daily', 'weekly')),
        recurrence_interval      INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
        recurrence_weekdays_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recurrence_weekdays_json)),
        recurrence_until_date    TEXT NULL
                                 CHECK (recurrence_until_date IS NULL OR (length(recurrence_until_date) = 10 AND recurrence_until_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
        recurrence_count         INTEGER NULL CHECK (recurrence_count IS NULL OR recurrence_count >= 1),
        recurrence_exdates_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(recurrence_exdates_json)),
        linked_task_id           TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
        external_account_id      TEXT NULL,
        external_event_id        TEXT NULL,
        created_at               INTEGER NOT NULL,
        updated_at               INTEGER NOT NULL,
        deleted_at               INTEGER NULL,
        usn                      INTEGER NOT NULL DEFAULT -1,
        CHECK (end_ms > start_ms),
        CHECK (NOT (recurrence_until_date IS NOT NULL AND recurrence_count IS NOT NULL))
    );
    CREATE INDEX idx_calendar_events_window
        ON calendar_events(user_id, deleted_at, start_ms, end_ms);
    CREATE INDEX idx_calendar_events_task
        ON calendar_events(linked_task_id);
    "#,
    // v10 -> v11 (ADR-023, PLN0): habit skip and Game-only freeze states.
    r#"
    ALTER TABLE habit_logs
        ADD COLUMN status TEXT NOT NULL DEFAULT 'logged'
        CHECK (status IN ('logged', 'skipped', 'frozen'));
    "#,
    // v11 -> v12 (ADR-025, R2): Game avatar, equipment, inventory, spending ledger,
    // custom rewards, and streak freeze token ledger.
    r#"
    CREATE TABLE avatar_profile (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        body_tone         TEXT NOT NULL DEFAULT 'tone_2',
        hair_style        TEXT NOT NULL DEFAULT 'hair_1',
        hair_color        TEXT NOT NULL DEFAULT 'brown',
        starter_outfit    TEXT NOT NULL DEFAULT 'tunic_slate',
        starter_accessory TEXT NOT NULL DEFAULT 'none',
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        deleted_at        INTEGER NULL,
        usn               INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id)
    );

    CREATE TABLE inventory_items (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        item_key    TEXT NOT NULL,
        kind        TEXT NOT NULL
                    CHECK (kind IN ('cosmetic')),
        source      TEXT NOT NULL
                    CHECK (source IN ('starter', 'shop', 'unlock')),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, item_key)
    );
    CREATE INDEX idx_inventory_items_active
        ON inventory_items(user_id, deleted_at, kind);

    CREATE TABLE avatar_equipped (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        slot        TEXT NOT NULL
                    CHECK (slot IN (
                        'head', 'outfit', 'main_hand', 'off_hand',
                        'back', 'accessory', 'backdrop', 'frame'
                    )),
        item_key    TEXT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, slot)
    );

    CREATE TABLE custom_rewards (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
        notes       TEXT NOT NULL DEFAULT '',
        cost_cents  INTEGER NOT NULL CHECK (cost_cents > 0),
        icon_key    TEXT NOT NULL DEFAULT 'gift',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1
    );
    CREATE INDEX idx_custom_rewards_active
        ON custom_rewards(user_id, deleted_at, sort_order, created_at);

    CREATE TABLE gold_spend_ledger (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        idempotency_key TEXT NOT NULL,
        kind            TEXT NOT NULL
                        CHECK (kind IN ('cosmetic', 'freeze_token', 'custom_reward', 'path_change')),
        ref_key         TEXT NOT NULL,
        amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        deleted_at      INTEGER NULL,
        usn             INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, idempotency_key)
    );
    CREATE INDEX idx_gold_spend_ledger_active
        ON gold_spend_ledger(user_id, deleted_at, kind, created_at);

    CREATE TABLE freeze_token_ledger (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        source_key  TEXT NOT NULL,
        delta       INTEGER NOT NULL CHECK (delta IN (-1, 1)),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, source_key)
    );
    CREATE INDEX idx_freeze_token_ledger_active
        ON freeze_token_ledger(user_id, deleted_at);
    "#,
    // v12 -> v13 (ADR-026, R4): deterministic unlocks, pets & mounts, cosmetic paths, solo achievements.
    r#"
    CREATE TABLE game_profile (
        id               TEXT PRIMARY KEY,
        user_id          TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        chosen_path      TEXT NULL
                         CHECK (chosen_path IS NULL OR chosen_path IN ('vanguard', 'sage', 'scout', 'artisan')),
        path_chosen_at   INTEGER NULL,
        backfill_version INTEGER NOT NULL DEFAULT 0 CHECK (backfill_version >= 0),
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        deleted_at       INTEGER NULL,
        usn              INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id)
    );

    CREATE TABLE game_unlocks (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        unlock_key   TEXT NOT NULL CHECK (length(trim(unlock_key)) > 0),
        reward_kind  TEXT NOT NULL CHECK (reward_kind IN ('pet', 'cosmetic', 'path_unlocked')),
        reward_ref   TEXT NOT NULL CHECK (length(trim(reward_ref)) > 0),
        unlocked_at  INTEGER NOT NULL,
        seen_at      INTEGER NULL,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        deleted_at   INTEGER NULL,
        usn          INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, unlock_key)
    );

    CREATE TABLE game_pets (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        species_key       TEXT NOT NULL CHECK (length(trim(species_key)) > 0),
        variant_key       TEXT NOT NULL DEFAULT 'classic' CHECK (length(trim(variant_key)) > 0),
        mount_unlocked_at INTEGER NULL,
        is_active         INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
        is_mounted        INTEGER NOT NULL DEFAULT 0 CHECK (is_mounted IN (0, 1)),
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        deleted_at        INTEGER NULL,
        usn               INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, species_key, variant_key),
        CHECK (is_mounted = 0 OR mount_unlocked_at IS NOT NULL)
    );

    CREATE UNIQUE INDEX idx_game_pets_one_active
        ON game_pets(user_id)
        WHERE is_active = 1 AND deleted_at IS NULL;

    CREATE TABLE game_pet_credits (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        pet_id      TEXT NOT NULL,
        ledger_id   TEXT NOT NULL,
        points      INTEGER NOT NULL CHECK (points IN (1, 2)),
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        deleted_at  INTEGER NULL,
        usn         INTEGER NOT NULL DEFAULT -1,
        UNIQUE (pet_id, ledger_id)
    );

    CREATE TABLE game_achievements (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        achievement_key TEXT NOT NULL CHECK (length(trim(achievement_key)) > 0),
        tier            INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
        earned_at       INTEGER NOT NULL,
        seen_at         INTEGER NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        deleted_at      INTEGER NULL,
        usn             INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, achievement_key)
    );
    "#,
    // v13 -> v14 (14c, ADR-019 / ADR-026): indexes for O(log N) pet-credit revoke and per-day ledger lookup.
    r#"
    CREATE INDEX idx_game_pet_credits_ledger
        ON game_pet_credits(user_id, ledger_id);
    CREATE INDEX idx_progress_ledger_active_created
        ON progress_ledger(user_id, deleted_at, created_at);
    "#,
    // v14 -> v15 (ADR-027, MOTd): synced daily goal, onboarding state, comeback tracking,
    // and monotonic monthly quest badges. The default motivation_settings row is seeded
    // in Rust by migrations::seed_motivation_settings using entity_id_v5 (Report 16a).
    r#"
    CREATE TABLE motivation_settings (
        id                          TEXT PRIMARY KEY,
        user_id                     TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        daily_goal_xp               INTEGER NOT NULL DEFAULT 20
                                    CHECK (daily_goal_xp IN (10, 20, 30, 50)),
        onboarding_completed_at     INTEGER NULL,
        comeback_return_day         INTEGER NULL,
        comeback_awarded_return_day INTEGER NULL,
        comeback_awarded_day        INTEGER NULL,
        comeback_dismissed_day      INTEGER NULL,
        created_at                  INTEGER NOT NULL,
        updated_at                  INTEGER NOT NULL,
        deleted_at                  INTEGER NULL,
        usn                         INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id)
    );

    CREATE TABLE monthly_badges (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        month_key           TEXT NOT NULL
                            CHECK (length(month_key) = 7 AND month_key GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        quest_count_at_earn INTEGER NOT NULL CHECK (quest_count_at_earn >= 1),
        earned_at           INTEGER NOT NULL,
        seen_at             INTEGER NULL,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        deleted_at          INTEGER NULL,
        usn                 INTEGER NOT NULL DEFAULT -1,
        UNIQUE (user_id, month_key)
    );

    CREATE INDEX idx_revlog_new_kind
        ON revlog(id, card_id) WHERE review_kind = 0;
    "#,
];

/// Grave record types (matches Anki: card, note, deck).
pub mod grave_kind {
    pub const CARD: i64 = 0;
    pub const NOTE: i64 = 1;
    pub const DECK: i64 = 2;
}
