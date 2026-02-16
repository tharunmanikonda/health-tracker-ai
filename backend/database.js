const { Pool } = require('pg');

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/health_tracker',
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Initialize database
async function init() {
  try {
    // Test connection
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    client.release();
    
    await createTables();
    await seedDefaultUser();
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
  }
}

// Create all tables
async function createTables() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        is_active INTEGER DEFAULT 1,
        daily_calorie_goal INTEGER DEFAULT 2500,
        daily_protein_goal INTEGER DEFAULT 150,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    // WHOOP daily metrics
    await client.query(`
      CREATE TABLE IF NOT EXISTS whoop_metrics (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE,
        sleep_score INTEGER,
        recovery_score INTEGER,
        strain_score REAL,
        resting_hr INTEGER,
        hrv INTEGER,
        spo2 INTEGER,
        skin_temp REAL,
        calories_burned INTEGER,
        sleep_hours REAL,
        sleep_efficiency INTEGER,
        sleep_consistency INTEGER,
        deep_sleep_hours REAL,
        rem_sleep_hours REAL,
        light_sleep_hours REAL,
        awake_hours REAL,
        respiratory_rate REAL,
        sleep_cycles INTEGER,
        disturbances INTEGER,
        day_strain REAL,
        avg_heart_rate INTEGER,
        max_heart_rate INTEGER,
        kilojoules INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      )
    `);

    // WHOOP workouts
    await client.query(`
      CREATE TABLE IF NOT EXISTS whoop_workouts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        workout_id TEXT,
        date DATE,
        sport_name TEXT,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        duration_minutes INTEGER,
        strain REAL,
        calories INTEGER,
        avg_heart_rate INTEGER,
        max_heart_rate INTEGER,
        distance_meters REAL,
        altitude_gain_meters REAL,
        zone_0_mins INTEGER,
        zone_1_mins INTEGER,
        zone_2_mins INTEGER,
        zone_3_mins INTEGER,
        zone_4_mins INTEGER,
        zone_5_mins INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, workout_id)
      )
    `);

    // WHOOP cycles (daily strain)
    await client.query(`
      CREATE TABLE IF NOT EXISTS whoop_cycles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        cycle_id TEXT,
        date DATE,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        strain REAL,
        kilojoules INTEGER,
        avg_heart_rate INTEGER,
        max_heart_rate INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, cycle_id)
      )
    `);

    // Food logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS food_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        name TEXT,
        barcode TEXT,
        calories INTEGER,
        protein REAL,
        carbs REAL,
        fat REAL,
        fiber REAL,
        sugar REAL,
        sodium INTEGER,
        serving_size TEXT,
        portion_multiplier REAL DEFAULT 1,
        source TEXT,
        image_path TEXT,
        whatsapp_message_id TEXT
      )
    `);

    // Water logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS water_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        amount INTEGER,
        unit TEXT DEFAULT 'ml'
      )
    `);

    // Weight logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS weight_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE,
        weight REAL,
        unit TEXT DEFAULT 'lbs',
        notes TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Mood logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS mood_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        mood_score INTEGER,
        energy_score INTEGER,
        notes TEXT
      )
    `);

    // Sleep manual logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS sleep_manual (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE,
        duration REAL,
        quality INTEGER,
        notes TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Manual workouts
    await client.query(`
      CREATE TABLE IF NOT EXISTS workouts_manual (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE,
        type TEXT,
        duration INTEGER,
        calories INTEGER,
        notes TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Medication/supplement logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS medication_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        name TEXT,
        taken BOOLEAN DEFAULT true,
        notes TEXT
      )
    `);

    // Daily summaries
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE,
        total_calories INTEGER,
        total_protein REAL,
        total_carbs REAL,
        total_fat REAL,
        total_fiber REAL,
        total_sugar REAL,
        total_sodium INTEGER,
        water_amount INTEGER,
        whoop_recovery INTEGER,
        whoop_strain REAL,
        calories_burned INTEGER,
        net_calories INTEGER,
        workout_count INTEGER,
        total_workout_minutes INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      )
    `);

    // User settings
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        whoop_api_key TEXT,
        whatsapp_number TEXT,
        whoop_access_token TEXT,
        whoop_refresh_token TEXT,
        whoop_token_expiry BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Single source of truth: goals are stored on users, not user_settings.
    await client.query(`
      ALTER TABLE user_settings
      DROP COLUMN IF EXISTS daily_calorie_goal
    `);
    await client.query(`
      ALTER TABLE user_settings
      DROP COLUMN IF EXISTS daily_protein_goal
    `);

    // Mobile health metrics (legacy table — kept for backward compatibility)
    await client.query(`
      CREATE TABLE IF NOT EXISTS mobile_health_metrics (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_health_metrics_dedup
      ON mobile_health_metrics(user_id, source, metric_type, start_time, end_time)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mobile_health_metrics_created
      ON mobile_health_metrics(user_id, created_at DESC)
    `);

    // ============================================================
    // TimescaleDB: High-resolution time series health data
    // Append-only, no updates. Batch inserts with ON CONFLICT DO NOTHING.
    // ============================================================
    await initTimescaleDB(client);

    // AI feed queue - unprocessed health data for AI
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_feed_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        source_table TEXT NOT NULL,
        source_id INTEGER NOT NULL,
        data_type TEXT NOT NULL,
        data_json JSONB NOT NULL,
        processed BOOLEAN DEFAULT false,
        processed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Webhook events log
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload JSONB,
        delivered BOOLEAN DEFAULT false,
        delivered_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Wearable device connections (Fitbit, Google Fit, etc.)
    await client.query(`
      CREATE TABLE IF NOT EXISTS wearable_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider)
      )
    `);

    // Oura webhook subscriptions (app-level webhook registrations)
    await client.query(`
      CREATE TABLE IF NOT EXISTS oura_webhook_subscriptions (
        id SERIAL PRIMARY KEY,
        subscription_id TEXT UNIQUE NOT NULL,
        data_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        callback_url TEXT NOT NULL,
        expiration_time TIMESTAMP,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Oura webhook events (for idempotency + debugging)
    await client.query(`
      CREATE TABLE IF NOT EXISTS oura_webhook_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        oura_user_id TEXT,
        event_type TEXT NOT NULL,
        data_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        event_time TIMESTAMP NOT NULL,
        payload JSONB NOT NULL,
        processed BOOLEAN DEFAULT false,
        process_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, data_type, event_type, object_id, event_time)
      )
    `);

    // Oura documents (raw canonical payload cache)
    await client.query(`
      CREATE TABLE IF NOT EXISTS oura_documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        data_type TEXT NOT NULL,
        document_id TEXT NOT NULL,
        day DATE,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        summary_value REAL,
        raw_json JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, data_type, document_id)
      )
    `);

    // Garmin webhook events (idempotency + debugging)
    await client.query(`
      CREATE TABLE IF NOT EXISTS garmin_webhook_events (
        id SERIAL PRIMARY KEY,
        event_id TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider_user_id TEXT,
        event_type TEXT NOT NULL,
        data_type TEXT NOT NULL,
        event_time TIMESTAMP NOT NULL,
        payload JSONB NOT NULL,
        processed BOOLEAN DEFAULT false,
        process_error TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Garmin documents cache
    await client.query(`
      CREATE TABLE IF NOT EXISTS garmin_documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        provider_user_id TEXT,
        data_type TEXT NOT NULL,
        document_id TEXT NOT NULL,
        day DATE,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        raw_json JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, data_type, document_id)
      )
    `);

    // AI Coach chat messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        conversation_id TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for faster chat history queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON ai_chat_messages(user_id, created_at)
    `);

    // Teams
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        invite_code TEXT UNIQUE NOT NULL,
        invite_expires_at TIMESTAMP,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        max_members INTEGER DEFAULT 15,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Team members
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role TEXT DEFAULT 'member' CHECK (role IN ('leader', 'member')),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, user_id)
      )
    `);

    // Challenges
    await client.query(`
      CREATE TABLE IF NOT EXISTS challenges (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        metric_type TEXT CHECK (metric_type IN ('calories_burned', 'steps', 'water_intake', 'protein_goal', 'workout_count', 'sleep_hours')),
        target_value REAL NOT NULL,
        target_unit TEXT NOT NULL,
        start_date DATE,
        end_date DATE,
        created_by INTEGER REFERENCES users(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CHECK (end_date > start_date)
      )
    `);

    // Challenge participants
    await client.query(`
      CREATE TABLE IF NOT EXISTS challenge_participants (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(challenge_id, user_id)
      )
    `);

    // Challenge progress (daily snapshot per user)
    await client.query(`
      CREATE TABLE IF NOT EXISTS challenge_progress (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        current_value REAL DEFAULT 0,
        percentage REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(challenge_id, user_id, date)
      )
    `);

    // Weekly plans - one per team per week
    await client.query(`
      CREATE TABLE IF NOT EXISTS weekly_plans (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        week_start DATE NOT NULL,
        created_by INTEGER REFERENCES users(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, week_start)
      )
    `);

    // Plan workouts - exercises per day
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_workouts (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES weekly_plans(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        muscle_group TEXT,
        exercise_name TEXT NOT NULL,
        sets INTEGER,
        reps TEXT,
        weight_suggestion TEXT,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Plan meals - food items per day per meal type
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_meals (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES weekly_plans(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack','pre_workout','post_workout')),
        food_name TEXT NOT NULL,
        quantity_grams REAL,
        calories INTEGER,
        protein REAL,
        carbs REAL,
        fat REAL,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Plan assignments - who gets which plan
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_assignments (
        id SERIAL PRIMARY KEY,
        plan_id INTEGER REFERENCES weekly_plans(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        assigned_by INTEGER REFERENCES users(id),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plan_id, user_id)
      )
    `);

    // Plan progress - member workout checks + food logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS plan_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES weekly_plans(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        workout_item_id INTEGER REFERENCES plan_workouts(id) ON DELETE CASCADE,
        workout_completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP,
        meal_item_id INTEGER REFERENCES plan_meals(id) ON DELETE CASCADE,
        actual_food_name TEXT,
        actual_quantity_grams REAL,
        actual_calories INTEGER,
        actual_protein REAL,
        actual_carbs REAL,
        actual_fat REAL,
        food_image_path TEXT,
        logged_at TIMESTAMP,
        verification_status TEXT DEFAULT 'unverified',
        verification_source TEXT,
        wearable_metric_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: add verification columns to existing plan_progress table
    await client.query(`ALTER TABLE plan_progress ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified'`);
    await client.query(`ALTER TABLE plan_progress ADD COLUMN IF NOT EXISTS verification_source TEXT`);
    await client.query(`ALTER TABLE plan_progress ADD COLUMN IF NOT EXISTS wearable_metric_id INTEGER`);

    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_food_logs_user_timestamp ON food_logs(user_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, DATE(timestamp));
      CREATE INDEX IF NOT EXISTS idx_whoop_metrics_user_date ON whoop_metrics(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, DATE(timestamp));
      CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_mood_logs_user_date ON mood_logs(user_id, DATE(timestamp));
      CREATE INDEX IF NOT EXISTS idx_mobile_health_user_created ON mobile_health_metrics(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_feed_processed ON ai_feed_queue(user_id, processed, created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_feed_type ON ai_feed_queue(data_type);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_user ON webhook_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_oura_events_user_created ON oura_webhook_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_oura_events_processed ON oura_webhook_events(processed, created_at);
      CREATE INDEX IF NOT EXISTS idx_oura_documents_user_day ON oura_documents(user_id, day);
      CREATE INDEX IF NOT EXISTS idx_oura_subscriptions_active ON oura_webhook_subscriptions(active, data_type, event_type);
      CREATE INDEX IF NOT EXISTS idx_garmin_events_user_created ON garmin_webhook_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_garmin_events_processed ON garmin_webhook_events(processed, created_at);
      CREATE INDEX IF NOT EXISTS idx_garmin_documents_user_day ON garmin_documents(user_id, day);
      CREATE INDEX IF NOT EXISTS idx_teams_invite_code ON teams(invite_code);
      CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_challenges_team ON challenges(team_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_challenge_progress_challenge ON challenge_progress(challenge_id, date);
      CREATE INDEX IF NOT EXISTS idx_weekly_plans_team ON weekly_plans(team_id, week_start);
      CREATE INDEX IF NOT EXISTS idx_plan_workouts_plan ON plan_workouts(plan_id, day_of_week);
      CREATE INDEX IF NOT EXISTS idx_plan_meals_plan ON plan_meals(plan_id, day_of_week);
      CREATE INDEX IF NOT EXISTS idx_plan_assignments_user ON plan_assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_plan_progress_user_date ON plan_progress(user_id, plan_id, date);
    `);

    await client.query('COMMIT');
    console.log('✅ PostgreSQL tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating tables:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Initialize TimescaleDB per-provider hypertables + regular tables
async function initTimescaleDB(client) {
  // Enable TimescaleDB extension (no-op if not installed — falls back to regular tables)
  // Use SAVEPOINT so a failed CREATE EXTENSION doesn't poison the enclosing transaction
  let hasTimescale = false;
  try {
    await client.query('SAVEPOINT try_timescale');
    await client.query(`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`);
    await client.query('RELEASE SAVEPOINT try_timescale');
    hasTimescale = true;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT try_timescale');
    console.log('⚠️  TimescaleDB extension not available — using regular PostgreSQL tables');
  }

  // ============================================================
  // APPLE HEALTH (HealthKit) — iOS
  // ============================================================

  // Hypertable: high-frequency samples (HR at 1-sec, steps, calories, HRV, SpO2, etc.)
  await client.query(`
    CREATE TABLE IF NOT EXISTS apple_health_samples_ts (
      time TIMESTAMPTZ NOT NULL,
      user_id INTEGER NOT NULL,
      metric_type TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      unit TEXT,
      metadata JSONB,
      UNIQUE (user_id, metric_type, time)
    )
  `);

  // Regular: workout sessions
  await client.query(`
    CREATE TABLE IF NOT EXISTS apple_health_workouts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workout_type TEXT NOT NULL,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      duration_seconds REAL,
      total_calories REAL,
      active_calories REAL,
      distance_meters REAL,
      avg_heart_rate REAL,
      max_heart_rate REAL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, workout_type, start_time)
    )
  `);

  // Regular: sleep sessions with stages
  await client.query(`
    CREATE TABLE IF NOT EXISTS apple_health_sleep (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      total_hours REAL,
      deep_hours REAL,
      rem_hours REAL,
      core_hours REAL,
      awake_hours REAL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, start_time)
    )
  `);

  // ============================================================
  // HEALTH CONNECT — Android
  // ============================================================

  // Hypertable: high-frequency samples (HR, steps, calories)
  await client.query(`
    CREATE TABLE IF NOT EXISTS health_connect_samples_ts (
      time TIMESTAMPTZ NOT NULL,
      user_id INTEGER NOT NULL,
      metric_type TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      unit TEXT,
      metadata JSONB,
      UNIQUE (user_id, metric_type, time)
    )
  `);

  // Regular: workout sessions
  await client.query(`
    CREATE TABLE IF NOT EXISTS health_connect_workouts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      workout_type TEXT NOT NULL,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      duration_seconds REAL,
      total_calories REAL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, workout_type, start_time)
    )
  `);

  // Regular: sleep sessions
  await client.query(`
    CREATE TABLE IF NOT EXISTS health_connect_sleep (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      total_hours REAL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, start_time)
    )
  `);

  // ============================================================
  // FITBIT — Cloud API
  // ============================================================

  // Hypertable: intraday HR (1-sec resolution when pulled via /activities/heart/date/.../1sec.json)
  await client.query(`
    CREATE TABLE IF NOT EXISTS fitbit_samples_ts (
      time TIMESTAMPTZ NOT NULL,
      user_id INTEGER NOT NULL,
      metric_type TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      unit TEXT,
      metadata JSONB,
      UNIQUE (user_id, metric_type, time)
    )
  `);

  // Regular: daily summaries (resting HR, HRV, AZM, steps, calories, distance, floors, active mins)
  await client.query(`
    CREATE TABLE IF NOT EXISTS fitbit_daily (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      steps INTEGER,
      calories_total INTEGER,
      calories_active INTEGER,
      distance_km REAL,
      floors INTEGER,
      active_minutes INTEGER,
      resting_heart_rate INTEGER,
      hrv_rmssd REAL,
      hrv_deep_rmssd REAL,
      azm_total INTEGER,
      azm_fat_burn INTEGER,
      azm_cardio INTEGER,
      azm_peak INTEGER,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, date)
    )
  `);

  // Regular: workout logs with logType + HR zones
  await client.query(`
    CREATE TABLE IF NOT EXISTS fitbit_workouts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fitbit_log_id TEXT,
      workout_type TEXT NOT NULL,
      log_type TEXT,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      duration_seconds REAL,
      calories INTEGER,
      distance_km REAL,
      avg_heart_rate INTEGER,
      fat_burn_minutes INTEGER,
      cardio_minutes INTEGER,
      peak_minutes INTEGER,
      out_of_range_minutes INTEGER,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, fitbit_log_id)
    )
  `);

  // Regular: sleep with stages + benchmarks
  await client.query(`
    CREATE TABLE IF NOT EXISTS fitbit_sleep (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fitbit_log_id TEXT,
      date DATE NOT NULL,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      minutes_asleep INTEGER,
      minutes_awake INTEGER,
      efficiency INTEGER,
      time_in_bed INTEGER,
      deep_minutes INTEGER,
      light_minutes INTEGER,
      rem_minutes INTEGER,
      wake_minutes INTEGER,
      deep_30day_avg INTEGER,
      light_30day_avg INTEGER,
      rem_30day_avg INTEGER,
      wake_30day_avg INTEGER,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, fitbit_log_id)
    )
  `);

  // Regular: weight / body composition
  await client.query(`
    CREATE TABLE IF NOT EXISTS fitbit_weight (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      weight_kg REAL,
      bmi REAL,
      body_fat_pct REAL,
      metadata JSONB,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, date)
    )
  `);

  // ============================================================
  // HYPERTABLE SETUP + CONTINUOUS AGGREGATES + POLICIES
  // ============================================================

  const hypertables = [
    { table: 'apple_health_samples_ts',  prefix: 'ah',  segmentby: 'user_id, metric_type' },
    { table: 'health_connect_samples_ts', prefix: 'hc', segmentby: 'user_id, metric_type' },
    { table: 'fitbit_samples_ts',         prefix: 'fb', segmentby: 'user_id, metric_type' },
  ];

  if (hasTimescale) {
    for (const ht of hypertables) {
      try {
        await client.query(`
          SELECT create_hypertable('${ht.table}', 'time',
            if_not_exists => TRUE,
            migrate_data => TRUE
          )
        `);
        console.log(`✅ ${ht.table} hypertable ready`);

        // Continuous aggregate: 1-minute buckets (AVG for rates, SUM for cumulative)
        await client.query(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS ${ht.prefix}_samples_1min
          WITH (timescaledb.continuous) AS
          SELECT
            time_bucket('1 minute', time) AS bucket,
            user_id,
            metric_type,
            AVG(value) AS avg_value,
            SUM(value) AS sum_value,
            MIN(value) AS min_value,
            MAX(value) AS max_value,
            COUNT(*) AS sample_count
          FROM ${ht.table}
          GROUP BY bucket, user_id, metric_type
          WITH NO DATA
        `);

        // Continuous aggregate: 1-hour buckets
        await client.query(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS ${ht.prefix}_samples_1hr
          WITH (timescaledb.continuous) AS
          SELECT
            time_bucket('1 hour', time) AS bucket,
            user_id,
            metric_type,
            AVG(value) AS avg_value,
            SUM(value) AS sum_value,
            MIN(value) AS min_value,
            MAX(value) AS max_value,
            COUNT(*) AS sample_count
          FROM ${ht.table}
          GROUP BY bucket, user_id, metric_type
          WITH NO DATA
        `);

        // Continuous aggregate: 1-day buckets
        await client.query(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS ${ht.prefix}_samples_1day
          WITH (timescaledb.continuous) AS
          SELECT
            time_bucket('1 day', time) AS bucket,
            user_id,
            metric_type,
            AVG(value) AS avg_value,
            SUM(value) AS sum_value,
            MIN(value) AS min_value,
            MAX(value) AS max_value,
            COUNT(*) AS sample_count
          FROM ${ht.table}
          GROUP BY bucket, user_id, metric_type
          WITH NO DATA
        `);

        // Refresh policies
        try {
          await client.query(`SELECT add_continuous_aggregate_policy('${ht.prefix}_samples_1min',
            start_offset => INTERVAL '10 minutes', end_offset => INTERVAL '1 minute',
            schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE)`);
        } catch (e) { /* policy exists */ }

        try {
          await client.query(`SELECT add_continuous_aggregate_policy('${ht.prefix}_samples_1hr',
            start_offset => INTERVAL '4 hours', end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE)`);
        } catch (e) { /* policy exists */ }

        try {
          await client.query(`SELECT add_continuous_aggregate_policy('${ht.prefix}_samples_1day',
            start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour', if_not_exists => TRUE)`);
        } catch (e) { /* policy exists */ }

        // Retention: raw data 7 days, 1-min 30 days (1-hr and 1-day kept forever)
        try {
          await client.query(`SELECT add_retention_policy('${ht.table}',
            drop_after => INTERVAL '7 days', if_not_exists => TRUE)`);
        } catch (e) { /* policy exists */ }
        try {
          await client.query(`SELECT add_retention_policy('${ht.prefix}_samples_1min',
            drop_after => INTERVAL '30 days', if_not_exists => TRUE)`);
        } catch (e) { /* policy exists */ }

        // Compression: compress raw chunks older than 2 days
        try {
          await client.query(`ALTER TABLE ${ht.table} SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = '${ht.segmentby}',
            timescaledb.compress_orderby = 'time DESC'
          )`);
          await client.query(`SELECT add_compression_policy('${ht.table}',
            compress_after => INTERVAL '2 days', if_not_exists => TRUE)`);
        } catch (e) { /* policy exists */ }

      } catch (err) {
        console.error(`TimescaleDB setup error for ${ht.table} (non-fatal):`, err.message);
      }
    }
    console.log('✅ All per-provider hypertables + continuous aggregates + policies ready');
  } else {
    // Fallback: create indexes for plain PostgreSQL
    for (const ht of hypertables) {
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${ht.prefix}_samples_user_time
        ON ${ht.table}(user_id, metric_type, time DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_${ht.prefix}_samples_time
        ON ${ht.table}(time DESC)`);
    }
    console.log('✅ Per-provider sample tables ready (plain PostgreSQL mode)');
  }

  // Indexes for regular event tables
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ah_workouts_user ON apple_health_workouts(user_id, start_time DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_ah_sleep_user ON apple_health_sleep(user_id, start_time DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hc_workouts_user ON health_connect_workouts(user_id, start_time DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hc_sleep_user ON health_connect_sleep(user_id, start_time DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fb_daily_user ON fitbit_daily(user_id, date DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fb_workouts_user ON fitbit_workouts(user_id, start_time DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fb_sleep_user ON fitbit_sleep(user_id, date DESC)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_fb_weight_user ON fitbit_weight(user_id, date DESC)`);
}

// Seed default user
async function seedDefaultUser() {
  const bcrypt = require('bcrypt');
  const defaultEmail = 'manikondatharun885@gmail.com';
  const defaultPassword = 'Tharun1234';
  const defaultName = 'Tharun';

  try {
    const existingUser = await get('SELECT id FROM users WHERE email = $1', [defaultEmail]);
    
    if (!existingUser) {
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await run(
        'INSERT INTO users (email, password_hash, name, is_active, daily_calorie_goal, daily_protein_goal) VALUES ($1, $2, $3, 1, 2500, 150)',
        [defaultEmail, hashedPassword, defaultName]
      );
      console.log('✅ Default user created:', defaultEmail);
    } else {
      console.log('✅ Default user already exists');
    }
  } catch (err) {
    console.error('Error seeding default user:', err);
  }
}

// Query helpers
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
    return result;
  } catch (err) {
    console.error('Query error:', err);
    throw err;
  }
}

async function run(sql, params = []) {
  const result = await pool.query(sql, params);
  return { id: result.rows[0]?.id, changes: result.rowCount };
}

async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

// Get pool for transactions
function getPool() {
  return pool;
}

// Close pool (for graceful shutdown)
async function close() {
  await pool.end();
}

module.exports = {
  init,
  query,
  run,
  get,
  all,
  getPool,
  close,
};
