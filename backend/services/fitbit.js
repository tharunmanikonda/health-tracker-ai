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

  normalizeMetadata(value) {
    if (value == null) return null;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
    return value;
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

  async getLatestMetricTimestamps(userId) {
    const rows = await db.all(`
      SELECT metric_type, MAX(created_at) AS last_created_at
      FROM mobile_health_metrics
      WHERE user_id = $1 AND source = 'fitbit'
      GROUP BY metric_type
    `, [userId]);

    const map = {};
    for (const row of rows) {
      map[row.metric_type] = row.last_created_at ? new Date(row.last_created_at).getTime() : 0;
    }
    return map;
  }

  getMaxTimestamp(map, metricTypes) {
    return metricTypes.reduce((max, metricType) => Math.max(max, map[metricType] || 0), 0);
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
      const timestamps = await this.getLatestMetricTimestamps(userId);
      const webhookActivityLatest = this.getMaxTimestamp(timestamps, ['steps', 'active_calories', 'distance', 'very_active_minutes', 'fairly_active_minutes', 'floors']);
      const webhookSleepLatest = this.getMaxTimestamp(timestamps, ['sleep']);
      const webhookWeightLatest = this.getMaxTimestamp(timestamps, ['weight']);

      return {
        activity: this.isStale(webhookActivityLatest, this.webhookFallbackStaleMs),
        heartRate: true,
        hrv: true,
        sleep: this.isStale(webhookSleepLatest, this.webhookFallbackStaleMs),
        weight: this.isStale(webhookWeightLatest, this.webhookFallbackStaleMs),
        azm: true,
      };
    }

    if (mode !== 'dashboard') {
      return { ...DEFAULT_SYNC_PLAN };
    }

    const [timestamps, connection] = await Promise.all([
      this.getLatestMetricTimestamps(userId),
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

    const nonWebhookLatest = this.getMaxTimestamp(timestamps, ['resting_heart_rate', 'heart_rate_zones', 'hrv', 'active_zone_minutes']);
    const webhookActivityLatest = this.getMaxTimestamp(timestamps, ['steps', 'active_calories', 'distance', 'very_active_minutes', 'fairly_active_minutes', 'floors']);
    const webhookSleepLatest = this.getMaxTimestamp(timestamps, ['sleep']);
    const webhookWeightLatest = this.getMaxTimestamp(timestamps, ['weight']);

    return {
      activity: this.isStale(webhookActivityLatest, this.webhookFallbackStaleMs),
      heartRate: this.isStale(timestamps.resting_heart_rate || nonWebhookLatest, this.nonWebhookStaleMs),
      hrv: this.isStale(timestamps.hrv, this.hrvStaleMs),
      sleep: this.isStale(webhookSleepLatest, this.webhookFallbackStaleMs),
      weight: this.isStale(webhookWeightLatest, this.webhookFallbackStaleMs),
      azm: this.isStale(timestamps.active_zone_minutes || nonWebhookLatest, this.nonWebhookStaleMs),
    };
  }

  // ========================
  // DATA PROCESSING (PER COLLECTION)
  // ========================

  async syncActivityForDate(userId, date) {
    const data = await this.getDailyActivity(userId, date);
    const summary = data?.summary;
    if (!summary) return false;

    if (summary.steps != null) {
      await this.upsertMetric(userId, 'steps', summary.steps, 'count', date);
      await this.pushToAIFeed(userId, 'activity', {
        date,
        steps: summary.steps,
        caloriesOut: summary.caloriesOut,
        veryActiveMinutes: summary.veryActiveMinutes,
        fairlyActiveMinutes: summary.fairlyActiveMinutes,
        lightlyActiveMinutes: summary.lightlyActiveMinutes,
        sedentaryMinutes: summary.sedentaryMinutes,
        source: 'fitbit',
      });
    }

    if (summary.caloriesOut != null) {
      await this.upsertMetric(userId, 'active_calories', summary.caloriesOut, 'kcal', date);
    }

    const totalDist = summary.distances?.find(d => d.activity === 'total');
    if (totalDist) {
      await this.upsertMetric(userId, 'distance', totalDist.distance, 'km', date);
    }

    if (summary.veryActiveMinutes != null) {
      await this.upsertMetric(userId, 'very_active_minutes', summary.veryActiveMinutes, 'minutes', date);
    }
    if (summary.fairlyActiveMinutes != null) {
      await this.upsertMetric(userId, 'fairly_active_minutes', summary.fairlyActiveMinutes, 'minutes', date);
    }

    if (summary.floors != null) {
      await this.upsertMetric(userId, 'floors', summary.floors, 'count', date);
    }

    console.log(`[Fitbit]   Activity synced (${date}): steps=${summary.steps}, calories=${summary.caloriesOut}`);
    return true;
  }

  async syncHeartRateForDate(userId, date) {
    const data = await this.getHeartRate(userId, date);
    const hrData = data?.['activities-heart']?.[0]?.value;
    if (!hrData) return false;

    if (hrData.restingHeartRate != null) {
      await this.upsertMetric(userId, 'resting_heart_rate', hrData.restingHeartRate, 'bpm', date);
      await this.pushToAIFeed(userId, 'heart_rate', {
        date,
        restingHeartRate: hrData.restingHeartRate,
        zones: hrData.heartRateZones,
        source: 'fitbit',
      });
    }

    if (hrData.heartRateZones) {
      await this.upsertMetric(userId, 'heart_rate_zones', 0, 'zones', date, {
        zones: hrData.heartRateZones,
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
      await this.upsertMetric(userId, 'hrv', Math.round(hrvData.dailyRmssd), 'ms', date, {
        dailyRmssd: hrvData.dailyRmssd,
        deepRmssd: hrvData.deepRmssd,
      });
      await this.pushToAIFeed(userId, 'hrv', {
        date,
        dailyRmssd: hrvData.dailyRmssd,
        deepRmssd: hrvData.deepRmssd,
        source: 'fitbit',
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

    await this.upsertMetric(userId, 'sleep', sleepMinutes, 'minutes', date, {
      efficiency: mainSleep.efficiency,
      timeInBed: mainSleep.timeInBed,
      minutesAwake: mainSleep.minutesAwake,
      startTime: mainSleep.startTime,
      endTime: mainSleep.endTime,
      type: mainSleep.type,
      stages: {
        deep: stages.deep?.minutes || 0,
        light: stages.light?.minutes || 0,
        rem: stages.rem?.minutes || 0,
        wake: stages.wake?.minutes || 0,
        deepAvg30: stages.deep?.thirtyDayAvgMinutes,
        lightAvg30: stages.light?.thirtyDayAvgMinutes,
        remAvg30: stages.rem?.thirtyDayAvgMinutes,
        wakeAvg30: stages.wake?.thirtyDayAvgMinutes,
      },
    });

    await this.pushToAIFeed(userId, 'sleep', {
      date,
      sleepHours,
      efficiency: mainSleep.efficiency,
      minutesAsleep: sleepMinutes,
      minutesAwake: mainSleep.minutesAwake,
      deepMinutes: stages.deep?.minutes || 0,
      lightMinutes: stages.light?.minutes || 0,
      remMinutes: stages.rem?.minutes || 0,
      startTime: mainSleep.startTime,
      endTime: mainSleep.endTime,
      source: 'fitbit',
    });

    console.log(`[Fitbit]   Sleep synced (${date}): hours=${sleepHours.toFixed(1)}, efficiency=${mainSleep.efficiency}`);
    return true;
  }

  async syncWeightForDate(userId, date) {
    const data = await this.getWeight(userId, date);
    const latestWeight = data?.weight?.[0];
    if (!latestWeight) return false;

    await this.upsertMetric(userId, 'weight', latestWeight.weight, 'lbs', date, {
      bmi: latestWeight.bmi,
      fat: latestWeight.fat,
      source: latestWeight.source,
    });
    await this.pushToAIFeed(userId, 'weight', {
      date,
      weight: latestWeight.weight,
      bmi: latestWeight.bmi,
      fat: latestWeight.fat,
      source: 'fitbit',
    });

    console.log(`[Fitbit]   Weight synced (${date}): weight=${latestWeight.weight}, bmi=${latestWeight.bmi}`);
    return true;
  }

  async syncActiveZoneMinutesForDate(userId, date) {
    const data = await this.getActiveZoneMinutes(userId, date);
    const azmData = data?.['activities-active-zone-minutes']?.[0]?.value;
    if (!azmData) return false;

    await this.upsertMetric(userId, 'active_zone_minutes', azmData.activeZoneMinutes || 0, 'minutes', date, {
      fatBurn: azmData.fatBurnActiveZoneMinutes || 0,
      cardio: azmData.cardioActiveZoneMinutes || 0,
      peak: azmData.peakActiveZoneMinutes || 0,
    });

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

  // Upsert a metric into mobile_health_metrics (prevents duplicates)
  async upsertMetric(userId, metricType, value, unit, date, metadata = null) {
    const startTime = `${date}T00:00:00`;
    const endTime = `${date}T23:59:59`;

    await db.run(`
      DELETE FROM mobile_health_metrics
      WHERE user_id = $1 AND source = 'fitbit' AND metric_type = $2
        AND start_time::date = $3::date
    `, [userId, metricType, date]);

    await db.run(`
      INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time, metadata)
      VALUES ($1, 'fitbit', $2, $3, $4, $5, $6, $7)
    `, [userId, metricType, value, unit, startTime, endTime, metadata ? JSON.stringify(metadata) : null]);
  }

  // Push data to AI feed queue
  async pushToAIFeed(userId, dataType, dataJson) {
    await db.run(`
      INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
      VALUES ($1, 'mobile_health_metrics', 0, $2, $3)
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
