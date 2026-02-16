const axios = require('axios');
const db = require('../database');

const FITBIT_API_BASE = 'https://api.fitbit.com';
const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';
const WEBHOOK_COLLECTIONS = new Set(['activities', 'sleep', 'body']);
const DEFAULT_SYNC_PLAN = {
  activity: true,
  heartRate: true,
  hrv: true,
  sleep: true,
  weight: true,
  azm: true,
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

class FitbitService {
  constructor() {
    this.clientId = process.env.FITBIT_CLIENT_ID;
    this.clientSecret = process.env.FITBIT_CLIENT_SECRET;
    this.rateLimitStateByUser = new Map();
    this.maxRetries = parsePositiveInt(process.env.FITBIT_MAX_RETRIES, 4);
    this.requestTimeoutMs = parsePositiveInt(process.env.FITBIT_REQUEST_TIMEOUT_MS, 15000);

    // Webhook-first strategy:
    // - non-webhook metrics get lightweight pulls
    // - webhook-backed metrics only get fallback pulls when stale
    this.minDashboardSyncIntervalMs = parsePositiveInt(process.env.FITBIT_DASHBOARD_MIN_SYNC_MS, 5 * 60 * 1000);
    this.nonWebhookStaleMs = parsePositiveInt(process.env.FITBIT_NON_WEBHOOK_STALE_MS, 20 * 60 * 1000);
    this.webhookFallbackStaleMs = parsePositiveInt(process.env.FITBIT_WEBHOOK_FALLBACK_STALE_MS, 2 * 60 * 60 * 1000);
    this.hrvStaleMs = parsePositiveInt(process.env.FITBIT_HRV_STALE_MS, 6 * 60 * 60 * 1000);
  }

  getBasicAuth() {
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  parseDate(date) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(String(date));
    return valid ? date : toDateString();
  }

  // Load tokens from DB for a user
  async loadTokens(userId) {
    return db.get(`
      SELECT access_token, refresh_token, expires_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);
  }

  async loadConnection(userId) {
    return db.get(`
      SELECT provider_user_id, updated_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);
  }

  // Save/update tokens in DB
  async saveTokens(userId, accessToken, refreshToken, expiresAt) {
    await db.run(`
      UPDATE wearable_connections
      SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $4 AND provider = 'fitbit'
    `, [accessToken, refreshToken, expiresAt, userId]);
    console.log('[Fitbit] Tokens saved for user', userId);
  }

  async markConnectionSync(userId) {
    await db.run(`
      UPDATE wearable_connections
      SET updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);
  }

  // Refresh access token (Fitbit refresh tokens are single-use)
  async refreshAccessToken(userId) {
    const connection = await this.loadTokens(userId);
    if (!connection || !connection.refresh_token) {
      throw new Error('No Fitbit refresh token available');
    }

    const response = await axios.post(FITBIT_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: connection.refresh_token,
      }),
      {
        headers: {
          Authorization: this.getBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: this.requestTimeoutMs,
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await this.saveTokens(userId, access_token, refresh_token, expiresAt);
    console.log('[Fitbit] Token refreshed for user', userId);

    return access_token;
  }

  // Get valid access token, refreshing if expired
  async getValidToken(userId) {
    const connection = await this.loadTokens(userId);
    if (!connection) {
      throw new Error('Fitbit not connected for user ' + userId);
    }

    if (!connection.access_token) {
      throw new Error('No Fitbit access token found for user ' + userId);
    }

    if (!connection.expires_at || new Date(connection.expires_at) <= new Date()) {
      return this.refreshAccessToken(userId);
    }

    return connection.access_token;
  }

  updateRateLimitState(userId, headers = {}) {
    const limit = safeNumber(headers['fitbit-rate-limit-limit']);
    const remaining = safeNumber(headers['fitbit-rate-limit-remaining']);
    const resetSeconds = safeNumber(headers['fitbit-rate-limit-reset']);

    if (limit == null && remaining == null && resetSeconds == null) {
      return;
    }

    const prev = this.rateLimitStateByUser.get(userId) || {};
    const state = { ...prev };

    if (limit != null) state.limit = limit;
    if (remaining != null) state.remaining = remaining;
    if (resetSeconds != null) state.resetSeconds = resetSeconds;

    if (remaining != null && resetSeconds != null && remaining <= 1) {
      state.blockedUntil = Date.now() + (resetSeconds + 1) * 1000;
    } else if (state.blockedUntil && Date.now() > state.blockedUntil) {
      delete state.blockedUntil;
    }

    this.rateLimitStateByUser.set(userId, state);
  }

  assertRateLimitBudget(userId) {
    const state = this.rateLimitStateByUser.get(userId);
    if (!state?.blockedUntil) return;
    if (Date.now() < state.blockedUntil) {
      const retryMs = Math.max(state.blockedUntil - Date.now(), 1000);
      const err = new Error(`Fitbit rate limit budget exhausted; retry in ${Math.ceil(retryMs / 1000)}s`);
      err.code = 'FITBIT_RATE_LIMIT_GUARD';
      err.retryAfterMs = retryMs;
      throw err;
    }
  }

  getRetryDelayMs(err, attempt) {
    const headers = err.response?.headers || {};
    const retryAfterSeconds = safeNumber(headers['retry-after']);
    const fitbitResetSeconds = safeNumber(headers['fitbit-rate-limit-reset']);

    const retryAfterMs = retryAfterSeconds != null ? Math.max(0, retryAfterSeconds * 1000) : 0;
    const fitbitResetMs = fitbitResetSeconds != null ? Math.max(0, (fitbitResetSeconds + 1) * 1000) : 0;
    const exponentialMs = 500 * (2 ** attempt);
    const jitterMs = Math.floor(Math.random() * 300);

    return Math.max(retryAfterMs, fitbitResetMs, exponentialMs) + jitterMs;
  }

  async requestWithRetry(userId, requestConfig) {
    let token = await this.getValidToken(userId);
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        this.assertRateLimitBudget(userId);

        const response = await axios({
          ...requestConfig,
          timeout: this.requestTimeoutMs,
          headers: {
            ...(requestConfig.headers || {}),
            Authorization: `Bearer ${token}`,
          },
        });

        this.updateRateLimitState(userId, response.headers);
        return response;
      } catch (err) {
        const status = err.response?.status;
        this.updateRateLimitState(userId, err.response?.headers || {});

        if (status === 401 && attempt < this.maxRetries) {
          token = await this.refreshAccessToken(userId);
          attempt += 1;
          continue;
        }

        const retryable = status === 429 || (status >= 500 && status < 600) || err.code === 'FITBIT_RATE_LIMIT_GUARD';
        if (!retryable || attempt >= this.maxRetries) {
          throw err;
        }

        const waitMs = err.retryAfterMs || this.getRetryDelayMs(err, attempt);
        console.warn(`[Fitbit] Request failed (${status || err.code || 'unknown'}). Retrying in ${waitMs}ms (${attempt + 1}/${this.maxRetries})`);
        await sleep(waitMs);
        attempt += 1;
      }
    }

    throw new Error('Fitbit request failed after retries');
  }

  // API request helper with retries for 401, 429, and 5xx
  async apiRequest(userId, url) {
    const res = await this.requestWithRetry(userId, {
      method: 'get',
      url,
    });
    return res.data;
  }

  // ========================
  // DATA FETCH METHODS
  // ========================

  async getDailyActivity(userId, date) {
    return this.apiRequest(userId, `${FITBIT_API_BASE}/1/user/-/activities/date/${date}.json`);
  }

  async getHeartRate(userId, date) {
    return this.apiRequest(userId, `${FITBIT_API_BASE}/1/user/-/activities/heart/date/${date}/1d.json`);
  }

  async getHRVSummary(userId, date) {
    return this.apiRequest(userId, `${FITBIT_API_BASE}/1/user/-/hrv/date/${date}.json`);
  }

  async getSleep(userId, date) {
    return this.apiRequest(userId, `${FITBIT_API_BASE}/1.2/user/-/sleep/date/${date}.json`);
  }

  async getWeight(userId, date) {
    return this.apiRequest(userId, `${FITBIT_API_BASE}/1/user/-/body/log/weight/date/${date}.json`);
  }

  async getActiveZoneMinutes(userId, date) {
    return this.apiRequest(userId, `${FITBIT_API_BASE}/1/user/-/activities/active-zone-minutes/date/${date}/1d.json`);
  }

  // ========================
  // FRESHNESS + SYNC PLANS
  // ========================

  async getCollectionFreshness(userId) {
    const today = toDateString();
    const [daily, sleepRow, weightRow] = await Promise.all([
      db.get(`SELECT steps, resting_heart_rate, hrv_rmssd, azm_total, updated_at
              FROM fitbit_daily WHERE user_id = $1 AND date = $2`, [userId, today]),
      db.get(`SELECT MAX(created_at) as ts FROM fitbit_sleep
              WHERE user_id = $1 AND date >= ($2::date - INTERVAL '1 day')`, [userId, today]),
      db.get(`SELECT MAX(created_at) as ts FROM fitbit_weight
              WHERE user_id = $1 AND date >= ($2::date - INTERVAL '7 days')`, [userId, today]),
    ]);

    const updatedMs = daily?.updated_at ? new Date(daily.updated_at).getTime() : 0;

    return {
      activity: daily?.steps != null ? updatedMs : 0,
      heartRate: daily?.resting_heart_rate != null ? updatedMs : 0,
      hrv: daily?.hrv_rmssd != null ? updatedMs : 0,
      azm: daily?.azm_total != null ? updatedMs : 0,
      sleep: sleepRow?.ts ? new Date(sleepRow.ts).getTime() : 0,
      weight: weightRow?.ts ? new Date(weightRow.ts).getTime() : 0,
    };
  }

  isStale(timestampMs, staleMs) {
    if (!timestampMs) return true;
    return (Date.now() - timestampMs) > staleMs;
  }

  async resolveSyncPlan(userId, mode, force = false) {
    if (force || mode === 'manual' || mode === 'initial') {
      return { ...DEFAULT_SYNC_PLAN };
    }

    if (mode === 'webhook') {
      // Webhook handlers call collection-specific sync methods directly.
      return { ...DEFAULT_SYNC_PLAN, heartRate: false, hrv: false, azm: false };
    }

    if (mode === 'cron') {
      const freshness = await this.getCollectionFreshness(userId);

      return {
        activity: this.isStale(freshness.activity, this.webhookFallbackStaleMs),
        heartRate: true,
        hrv: true,
        sleep: this.isStale(freshness.sleep, this.webhookFallbackStaleMs),
        weight: this.isStale(freshness.weight, this.webhookFallbackStaleMs),
        azm: true,
      };
    }

    if (mode !== 'dashboard') {
      return { ...DEFAULT_SYNC_PLAN };
    }

    const [freshness, connection] = await Promise.all([
      this.getCollectionFreshness(userId),
      this.loadConnection(userId),
    ]);

    const lastConnectionSyncMs = connection?.updated_at ? new Date(connection.updated_at).getTime() : 0;
    if (lastConnectionSyncMs && (Date.now() - lastConnectionSyncMs) < this.minDashboardSyncIntervalMs) {
      return {
        activity: false,
        heartRate: false,
        hrv: false,
        sleep: false,
        weight: false,
        azm: false,
      };
    }

    return {
      activity: this.isStale(freshness.activity, this.webhookFallbackStaleMs),
      heartRate: this.isStale(freshness.heartRate, this.nonWebhookStaleMs),
      hrv: this.isStale(freshness.hrv, this.hrvStaleMs),
      sleep: this.isStale(freshness.sleep, this.webhookFallbackStaleMs),
      weight: this.isStale(freshness.weight, this.webhookFallbackStaleMs),
      azm: this.isStale(freshness.azm, this.nonWebhookStaleMs),
    };
  }

  // ========================
  // DATA PROCESSING (PER COLLECTION)
  // ========================

  async syncActivityForDate(userId, date) {
    const data = await this.getDailyActivity(userId, date);
    const summary = data?.summary;
    if (!summary) return false;

    const totalDist = summary.distances?.find(d => d.activity === 'total');
    const activeMinutes = (summary.veryActiveMinutes || 0) + (summary.fairlyActiveMinutes || 0);

    await db.run(`
      INSERT INTO fitbit_daily (user_id, date, steps, calories_total, calories_active, distance_km, floors, active_minutes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id, date) DO UPDATE SET
        steps = COALESCE(EXCLUDED.steps, fitbit_daily.steps),
        calories_total = COALESCE(EXCLUDED.calories_total, fitbit_daily.calories_total),
        calories_active = COALESCE(EXCLUDED.calories_active, fitbit_daily.calories_active),
        distance_km = COALESCE(EXCLUDED.distance_km, fitbit_daily.distance_km),
        floors = COALESCE(EXCLUDED.floors, fitbit_daily.floors),
        active_minutes = COALESCE(EXCLUDED.active_minutes, fitbit_daily.active_minutes),
        updated_at = CURRENT_TIMESTAMP
    `, [
      userId, date,
      summary.steps ?? null,
      summary.caloriesOut ?? null,
      summary.activityCalories ?? summary.caloriesOut ?? null,
      totalDist?.distance ?? null,
      summary.floors ?? null,
      activeMinutes || null,
    ]);

    if (summary.steps != null) {
      await this.pushToAIFeed(userId, 'activity', {
        date, steps: summary.steps, caloriesOut: summary.caloriesOut,
        veryActiveMinutes: summary.veryActiveMinutes,
        fairlyActiveMinutes: summary.fairlyActiveMinutes,
        source: 'fitbit',
      });
    }

    console.log(`[Fitbit]   Activity synced (${date}): steps=${summary.steps}, calories=${summary.caloriesOut}`);
    return true;
  }

  async syncHeartRateForDate(userId, date) {
    const data = await this.getHeartRate(userId, date);
    const hrData = data?.['activities-heart']?.[0]?.value;
    if (!hrData) return false;

    // Merge resting HR + zones into fitbit_daily row
    const zonesJson = hrData.heartRateZones ? JSON.stringify({ zones: hrData.heartRateZones }) : null;
    await db.run(`
      INSERT INTO fitbit_daily (user_id, date, resting_heart_rate, metadata)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, date) DO UPDATE SET
        resting_heart_rate = COALESCE(EXCLUDED.resting_heart_rate, fitbit_daily.resting_heart_rate),
        metadata = COALESCE(EXCLUDED.metadata, fitbit_daily.metadata),
        updated_at = CURRENT_TIMESTAMP
    `, [userId, date, hrData.restingHeartRate ?? null, zonesJson]);

    if (hrData.restingHeartRate != null) {
      await this.pushToAIFeed(userId, 'heart_rate', {
        date, restingHeartRate: hrData.restingHeartRate,
        zones: hrData.heartRateZones, source: 'fitbit',
      });
    }

    console.log(`[Fitbit]   Heart rate synced (${date}): restingHR=${hrData.restingHeartRate}`);
    return true;
  }

  async syncHRVForDate(userId, date) {
    const data = await this.getHRVSummary(userId, date);
    const hrvData = data?.hrv?.[0]?.value;
    if (!hrvData) return false;

    if (hrvData.dailyRmssd != null) {
      await db.run(`
        INSERT INTO fitbit_daily (user_id, date, hrv_rmssd, hrv_deep_rmssd)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, date) DO UPDATE SET
          hrv_rmssd = COALESCE(EXCLUDED.hrv_rmssd, fitbit_daily.hrv_rmssd),
          hrv_deep_rmssd = COALESCE(EXCLUDED.hrv_deep_rmssd, fitbit_daily.hrv_deep_rmssd),
          updated_at = CURRENT_TIMESTAMP
      `, [userId, date, hrvData.dailyRmssd, hrvData.deepRmssd ?? null]);

      await this.pushToAIFeed(userId, 'hrv', {
        date, dailyRmssd: hrvData.dailyRmssd,
        deepRmssd: hrvData.deepRmssd, source: 'fitbit',
      });
    }

    console.log(`[Fitbit]   HRV synced (${date}): dailyRmssd=${hrvData.dailyRmssd}`);
    return true;
  }

  async syncSleepForDate(userId, date) {
    const data = await this.getSleep(userId, date);
    const mainSleep = data?.sleep?.find(s => s.isMainSleep) || data?.sleep?.[0];
    if (!mainSleep) return false;

    const sleepMinutes = mainSleep.minutesAsleep || 0;
    const sleepHours = sleepMinutes / 60;
    const stages = mainSleep.levels?.summary || {};

    await db.run(`
      INSERT INTO fitbit_sleep (user_id, fitbit_log_id, date, start_time, end_time,
        minutes_asleep, minutes_awake, efficiency, time_in_bed,
        deep_minutes, light_minutes, rem_minutes, wake_minutes,
        deep_30day_avg, light_30day_avg, rem_30day_avg, wake_30day_avg, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (user_id, fitbit_log_id) DO UPDATE SET
        minutes_asleep = EXCLUDED.minutes_asleep,
        minutes_awake = EXCLUDED.minutes_awake,
        efficiency = EXCLUDED.efficiency,
        time_in_bed = EXCLUDED.time_in_bed,
        deep_minutes = EXCLUDED.deep_minutes,
        light_minutes = EXCLUDED.light_minutes,
        rem_minutes = EXCLUDED.rem_minutes,
        wake_minutes = EXCLUDED.wake_minutes,
        deep_30day_avg = EXCLUDED.deep_30day_avg,
        light_30day_avg = EXCLUDED.light_30day_avg,
        rem_30day_avg = EXCLUDED.rem_30day_avg,
        wake_30day_avg = EXCLUDED.wake_30day_avg,
        metadata = EXCLUDED.metadata
    `, [
      userId,
      String(mainSleep.logId || `${date}-main`),
      date,
      mainSleep.startTime || null,
      mainSleep.endTime || null,
      sleepMinutes,
      mainSleep.minutesAwake || null,
      mainSleep.efficiency || null,
      mainSleep.timeInBed || null,
      stages.deep?.minutes || null,
      stages.light?.minutes || null,
      stages.rem?.minutes || null,
      stages.wake?.minutes || null,
      stages.deep?.thirtyDayAvgMinutes || null,
      stages.light?.thirtyDayAvgMinutes || null,
      stages.rem?.thirtyDayAvgMinutes || null,
      stages.wake?.thirtyDayAvgMinutes || null,
      JSON.stringify({ type: mainSleep.type }),
    ]);

    await this.pushToAIFeed(userId, 'sleep', {
      date, sleepHours, efficiency: mainSleep.efficiency,
      minutesAsleep: sleepMinutes, minutesAwake: mainSleep.minutesAwake,
      deepMinutes: stages.deep?.minutes || 0, lightMinutes: stages.light?.minutes || 0,
      remMinutes: stages.rem?.minutes || 0, startTime: mainSleep.startTime,
      endTime: mainSleep.endTime, source: 'fitbit',
    });

    console.log(`[Fitbit]   Sleep synced (${date}): hours=${sleepHours.toFixed(1)}, efficiency=${mainSleep.efficiency}`);
    return true;
  }

  async syncWeightForDate(userId, date) {
    const data = await this.getWeight(userId, date);
    const latestWeight = data?.weight?.[0];
    if (!latestWeight) return false;

    await db.run(`
      INSERT INTO fitbit_weight (user_id, date, weight_kg, bmi, body_fat_pct, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, date) DO UPDATE SET
        weight_kg = EXCLUDED.weight_kg,
        bmi = EXCLUDED.bmi,
        body_fat_pct = EXCLUDED.body_fat_pct,
        metadata = EXCLUDED.metadata
    `, [
      userId, date,
      latestWeight.weight ?? null,
      latestWeight.bmi ?? null,
      latestWeight.fat ?? null,
      JSON.stringify({ source: latestWeight.source }),
    ]);

    await this.pushToAIFeed(userId, 'weight', {
      date, weight: latestWeight.weight, bmi: latestWeight.bmi,
      fat: latestWeight.fat, source: 'fitbit',
    });

    console.log(`[Fitbit]   Weight synced (${date}): weight=${latestWeight.weight}, bmi=${latestWeight.bmi}`);
    return true;
  }

  async syncActiveZoneMinutesForDate(userId, date) {
    const data = await this.getActiveZoneMinutes(userId, date);
    const azmData = data?.['activities-active-zone-minutes']?.[0]?.value;
    if (!azmData) return false;

    await db.run(`
      INSERT INTO fitbit_daily (user_id, date, azm_total, azm_fat_burn, azm_cardio, azm_peak)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, date) DO UPDATE SET
        azm_total = COALESCE(EXCLUDED.azm_total, fitbit_daily.azm_total),
        azm_fat_burn = COALESCE(EXCLUDED.azm_fat_burn, fitbit_daily.azm_fat_burn),
        azm_cardio = COALESCE(EXCLUDED.azm_cardio, fitbit_daily.azm_cardio),
        azm_peak = COALESCE(EXCLUDED.azm_peak, fitbit_daily.azm_peak),
        updated_at = CURRENT_TIMESTAMP
    `, [
      userId, date,
      azmData.activeZoneMinutes || 0,
      azmData.fatBurnActiveZoneMinutes || 0,
      azmData.cardioActiveZoneMinutes || 0,
      azmData.peakActiveZoneMinutes || 0,
    ]);

    console.log(`[Fitbit]   AZM synced (${date}): total=${azmData.activeZoneMinutes}`);
    return true;
  }

  async syncCollectionForDate(userId, collectionType, dateInput) {
    const date = this.parseDate(dateInput);
    if (collectionType === 'activities') return this.syncActivityForDate(userId, date);
    if (collectionType === 'sleep') return this.syncSleepForDate(userId, date);
    if (collectionType === 'body') return this.syncWeightForDate(userId, date);
    return false;
  }

  // ========================
  // COMPREHENSIVE SYNC
  // ========================

  async syncLatestData(userId, options = {}) {
    const date = this.parseDate(options.date || toDateString());
    const mode = options.mode || 'manual';
    const force = Boolean(options.force);
    const plan = await this.resolveSyncPlan(userId, mode, force);

    console.log(`[Fitbit] Syncing data for user ${userId}, date ${date}, mode=${mode}`);
    console.log('[Fitbit] Sync plan', plan);

    const results = {
      activity: false,
      heartRate: false,
      hrv: false,
      sleep: false,
      weight: false,
      azm: false,
      errors: [],
      mode,
      skipped: false,
    };

    if (!Object.values(plan).some(Boolean)) {
      results.skipped = true;
      return { success: true, data: results };
    }

    if (plan.activity) {
      try {
        results.activity = await this.syncActivityForDate(userId, date);
      } catch (err) {
        console.log('[Fitbit]   Activity sync skipped:', err.message);
        results.errors.push('activity: ' + err.message);
      }
    }

    if (plan.heartRate) {
      try {
        results.heartRate = await this.syncHeartRateForDate(userId, date);
      } catch (err) {
        console.log('[Fitbit]   Heart rate sync skipped:', err.message);
        results.errors.push('heartRate: ' + err.message);
      }
    }

    if (plan.hrv) {
      try {
        results.hrv = await this.syncHRVForDate(userId, date);
      } catch (err) {
        console.log('[Fitbit]   HRV sync skipped:', err.message);
        results.errors.push('hrv: ' + err.message);
      }
    }

    if (plan.sleep) {
      try {
        results.sleep = await this.syncSleepForDate(userId, date);
      } catch (err) {
        console.log('[Fitbit]   Sleep sync skipped:', err.message);
        results.errors.push('sleep: ' + err.message);
      }
    }

    if (plan.weight) {
      try {
        results.weight = await this.syncWeightForDate(userId, date);
      } catch (err) {
        console.log('[Fitbit]   Weight sync skipped:', err.message);
        results.errors.push('weight: ' + err.message);
      }
    }

    if (plan.azm) {
      try {
        results.azm = await this.syncActiveZoneMinutesForDate(userId, date);
      } catch (err) {
        console.log('[Fitbit]   AZM sync skipped:', err.message);
        results.errors.push('azm: ' + err.message);
      }
    }

    if (results.activity || results.heartRate || results.hrv || results.sleep || results.weight || results.azm) {
      await this.markConnectionSync(userId);
    }

    console.log('[Fitbit] Sync complete for user', userId, results);
    return { success: true, data: results };
  }

  // ========================
  // HELPER METHODS
  // ========================

  // Push data to AI feed queue
  async pushToAIFeed(userId, dataType, dataJson) {
    await db.run(`
      INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
      VALUES ($1, 'fitbit_daily', 0, $2, $3)
    `, [userId, dataType, JSON.stringify({ ...dataJson, timestamp: new Date().toISOString() })]);
  }

  // Get all connected Fitbit users for cron sync
  async getConnectedUsers() {
    return db.all(`
      SELECT user_id FROM wearable_connections WHERE provider = 'fitbit'
    `);
  }

  // Sync all connected users (called by cron)
  async syncAllUsers(options = {}) {
    const users = await this.getConnectedUsers();
    const mode = options.mode || 'cron';
    console.log(`[Fitbit] ${mode}: syncing ${users.length} connected users`);

    for (const user of users) {
      try {
        await this.syncLatestData(user.user_id, { mode });
      } catch (err) {
        console.error(`[Fitbit] ${mode} sync failed for user ${user.user_id}:`, err.message);
      }
    }
  }

  // ========================
  // WEBHOOK / SUBSCRIPTION
  // ========================

  // Create a subscription for a user after OAuth
  async createSubscription(userId, collectionType = null) {
    const normalizedCollection = collectionType && WEBHOOK_COLLECTIONS.has(collectionType) ? collectionType : null;
    const subscriptionId = `user-${userId}`;

    let url = `${FITBIT_API_BASE}/1/user/-/`;
    if (normalizedCollection) {
      url += `${normalizedCollection}/`;
    }
    url += `apiSubscriptions/${subscriptionId}.json`;

    try {
      const res = await this.requestWithRetry(userId, {
        method: 'post',
        url,
        data: null,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      console.log(`[Fitbit] Subscription created for user ${userId}:`, res.data);
      return res.data;
    } catch (err) {
      if (err.response?.status === 409) {
        console.log(`[Fitbit] Subscription already exists for user ${userId}`);
        return { existing: true };
      }
      console.error(`[Fitbit] Failed to create subscription for user ${userId}:`, err.message);
      throw err;
    }
  }

  // Create subscriptions for all collection types
  async createAllSubscriptions(userId) {
    const collections = ['activities', 'sleep', 'body'];
    for (const collection of collections) {
      try {
        await this.createSubscription(userId, collection);
      } catch (err) {
        console.error(`[Fitbit] Failed to subscribe to ${collection}:`, err.message);
      }
    }
  }

  // Verify webhook signature (HMAC-SHA1)
  verifyWebhookSignature(body, signature) {
    if (!signature) return false;
    const crypto = require('crypto');
    const signingKey = `${this.clientSecret}&`;
    const expectedSignature = crypto
      .createHmac('sha1', signingKey)
      .update(body)
      .digest('base64');

    const actualBuffer = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expectedSignature);
    if (actualBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  }
}

module.exports = new FitbitService();
