const axios = require('axios');
const db = require('../database');

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI || 'http://localhost:3001/api/whoop/callback';
const MAX_PAGE_SIZE = 25;
const DEFAULT_SYNC_LOOKBACK_DAYS = Number.parseInt(process.env.WHOOP_SYNC_LOOKBACK_DAYS || '7', 10);
const WHOOP_SCOPES = [
  'read:recovery',
  'read:cycles',
  'read:workout',
  'read:sleep',
  'read:profile',
  'read:body_measurement',
  'offline',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function msToHours(ms) {
  return ms ? ms / 3600000 : null;
}

function msToMins(ms) {
  return ms ? Math.round(ms / 60000) : 0;
}

class WhoopService {
  constructor() {
    this.clientId = process.env.WHOOP_CLIENT_ID;
    this.clientSecret = process.env.WHOOP_CLIENT_SECRET;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.loadTokensFromDb();
  }

  async loadTokensFromDb(userId = 1) {
    try {
      const row = await db.get('SELECT whoop_access_token, whoop_refresh_token, whoop_token_expiry FROM user_settings WHERE user_id = $1', [userId]);
      if (row) {
        this.accessToken = row.whoop_access_token;
        this.refreshToken = row.whoop_refresh_token;
        this.tokenExpiry = row.whoop_token_expiry;
        if (this.accessToken) {
          console.log('[WHOOP] Loaded tokens from database');
        }
      }
    } catch (err) {
      console.log('[WHOOP] No stored tokens found');
    }
  }

  async saveTokensToDb(userId = 1) {
    try {
      await db.run(`
        INSERT INTO user_settings (user_id, whoop_access_token, whoop_refresh_token, whoop_token_expiry)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id) DO UPDATE SET
          whoop_access_token = EXCLUDED.whoop_access_token,
          whoop_refresh_token = EXCLUDED.whoop_refresh_token,
          whoop_token_expiry = EXCLUDED.whoop_token_expiry
      `, [userId, this.accessToken, this.refreshToken, this.tokenExpiry]);
      console.log('[WHOOP] Tokens saved to database');
    } catch (err) {
      console.error('[WHOOP] Failed to save tokens:', err);
    }
  }

  getAuthorizationUrl() {
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('response_type', 'code');
    params.append('scope', WHOOP_SCOPES.join(' '));
    params.append('state', 'random_state_string');

    return `${WHOOP_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code) {
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);

    const response = await axios.post(WHOOP_TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    this.accessToken = response.data.access_token;
    this.refreshToken = response.data.refresh_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    await this.saveTokensToDb();
    console.log('[WHOOP] Tokens obtained and saved');

    return response.data;
  }

  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);
    params.append('refresh_token', this.refreshToken);

    const response = await axios.post(WHOOP_TOKEN_URL, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    this.accessToken = response.data.access_token;
    this.refreshToken = response.data.refresh_token || this.refreshToken;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

    await this.saveTokensToDb();
    console.log('[WHOOP] Token refreshed');

    return this.accessToken;
  }

  async getValidAccessToken() {
    if (!this.accessToken) {
      await this.loadTokensFromDb();
    }

    if (!this.accessToken) {
      throw new Error('Not authenticated with WHOOP. Visit /api/whoop/auth to connect.');
    }

    if (Date.now() >= this.tokenExpiry - 60000) {
      await this.refreshAccessToken();
    }

    return this.accessToken;
  }

  async getHeaders() {
    const token = await this.getValidAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async requestWithRetry(config, maxRetries = 5) {
    let attempt = 0;

    while (true) {
      try {
        return await axios(config);
      } catch (err) {
        const status = err.response?.status;
        const retryable = status === 429 || (status >= 500 && status < 600);

        if (!retryable || attempt >= maxRetries) {
          throw err;
        }

        const retryAfterHeader = err.response?.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader ? Math.round(Number.parseFloat(retryAfterHeader) * 1000) : 0;
        const backoffMs = Math.max(retryAfterMs, 500 * (2 ** attempt));
        const jitterMs = Math.floor(Math.random() * 250);
        const waitMs = backoffMs + jitterMs;

        console.warn(`[WHOOP] Request failed with status ${status}. Retrying in ${waitMs}ms (${attempt + 1}/${maxRetries})`);
        await sleep(waitMs);
        attempt += 1;
      }
    }
  }

  async fetchPaginatedCollection(path, options = {}) {
    const headers = await this.getHeaders();
    const startDate = options.startDate;
    const endDate = options.endDate;
    const limit = Math.min(parsePositiveInt(options.limit, MAX_PAGE_SIZE), MAX_PAGE_SIZE);

    const records = [];
    let nextToken = null;
    let page = 0;

    do {
      const params = { limit };
      if (startDate) params.start = startDate;
      if (endDate) params.end = endDate;
      if (nextToken) params.nextToken = nextToken;

      const response = await this.requestWithRetry({
        method: 'get',
        url: `${WHOOP_API_BASE}${path}`,
        headers,
        params,
      });

      const payload = response.data || {};
      if (Array.isArray(payload.records) && payload.records.length > 0) {
        records.push(...payload.records);
      }

      nextToken = payload.next_token || payload.nextToken || null;
      page += 1;
    } while (nextToken);

    console.log(`[WHOOP] Retrieved ${records.length} records from ${path} in ${page} page(s)`);
    return { records };
  }

  async getProfile() {
    const headers = await this.getHeaders();
    const response = await this.requestWithRetry({
      method: 'get',
      url: `${WHOOP_API_BASE}/v2/user/profile/basic`,
      headers,
    });
    return response.data;
  }

  async getBodyMeasurement() {
    const headers = await this.getHeaders();
    const response = await this.requestWithRetry({
      method: 'get',
      url: `${WHOOP_API_BASE}/v2/user/measurement/body`,
      headers,
    });
    return response.data;
  }

  // Recovery data
  async getRecovery(startDate, endDate) {
    return this.fetchPaginatedCollection('/v2/recovery', { startDate, endDate, limit: MAX_PAGE_SIZE });
  }

  // Sleep data
  async getSleep(startDate, endDate) {
    return this.fetchPaginatedCollection('/v2/activity/sleep', { startDate, endDate, limit: MAX_PAGE_SIZE });
  }

  // Cycles (daily strain)
  async getCycles(startDate, endDate) {
    return this.fetchPaginatedCollection('/v2/cycle', { startDate, endDate, limit: MAX_PAGE_SIZE });
  }

  // Workouts
  async getWorkouts(startDate, endDate) {
    return this.fetchPaginatedCollection('/v2/activity/workout', { startDate, endDate, limit: MAX_PAGE_SIZE });
  }

  // COMPREHENSIVE SYNC - WHOOP AVAILABLE DATA
  async syncLatestData(options = {}) {
    const userId = parsePositiveInt(options.userId, 1);
    const lookbackDays = Math.min(parsePositiveInt(options.lookbackDays, DEFAULT_SYNC_LOOKBACK_DAYS), 180);
    const endDate = options.endDate || new Date().toISOString();
    const startDate = options.startDate || new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

    console.log('[WHOOP] 🔄 SYNCING DATA for user', userId, 'from', startDate.split('T')[0], 'to', endDate.split('T')[0]);

    const results = {
      recovery: 0,
      sleep: 0,
      cycles: 0,
      workouts: 0,
      bodyMeasurement: false,
      errors: []
    };

    try {
      // Optional body measurement (single object endpoint)
      try {
        const bodyMeasurement = await this.getBodyMeasurement();
        if (bodyMeasurement) {
          results.bodyMeasurement = true;
          await db.run(
            `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
             VALUES ($1, 'whoop_profile', $2, 'body_measurement', $3)`,
            [
              userId,
              1,
              JSON.stringify({
                ...bodyMeasurement,
                source: 'whoop',
                timestamp: new Date().toISOString(),
              }),
            ]
          );
        }
      } catch (err) {
        console.log('[WHOOP]   ⚠ Body measurement skipped:', err.message);
        results.errors.push(`body_measurement: ${err.message}`);
      }

      // 1. RECOVERY DATA
      console.log('[WHOOP] 📊 Fetching recovery...');
      const recoveryData = await this.getRecovery(startDate, endDate);
      results.recovery = recoveryData.records?.length || 0;
      console.log(`[WHOOP]   ✓ ${results.recovery} recovery records`);

      if (recoveryData.records?.length > 0) {
        for (const record of recoveryData.records) {
          const date = record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0];
          const score = record.score || {};

          await db.run(`
            INSERT INTO whoop_metrics (
              user_id, date, recovery_score, resting_hr, hrv, spo2, skin_temp
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(user_id, date) DO UPDATE SET
              recovery_score = EXCLUDED.recovery_score,
              resting_hr = EXCLUDED.resting_hr,
              hrv = EXCLUDED.hrv,
              spo2 = EXCLUDED.spo2,
              skin_temp = EXCLUDED.skin_temp
          `, [
            userId,
            date,
            score.recovery_score || null,
            score.resting_heart_rate || null,
            score.hrv_rmssd_milli ? Math.round(score.hrv_rmssd_milli) : null,
            score.spo2_percentage ? Math.round(score.spo2_percentage) : null,
            score.skin_temp_celsius || null
          ]);

          await db.run(
            `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
             VALUES ($1, 'whoop_metrics', $2, 'recovery', $3)`,
            [
              userId,
              parsePositiveInt(record.cycle_id || record.id, 1),
              JSON.stringify({
                date,
                recovery_score: score.recovery_score,
                resting_hr: score.resting_heart_rate,
                hrv: score.hrv_rmssd_milli,
                source: 'whoop',
                timestamp: new Date().toISOString()
              })
            ]
          );
        }
      }

      // 2. SLEEP DATA
      console.log('[WHOOP] 😴 Fetching sleep...');
      const sleepData = await this.getSleep(startDate, endDate);
      results.sleep = sleepData.records?.length || 0;
      console.log(`[WHOOP]   ✓ ${results.sleep} sleep records`);

      if (sleepData.records?.length > 0) {
        for (const record of sleepData.records) {
          const date = record.end ? record.end.split('T')[0] : new Date().toISOString().split('T')[0];
          const score = record.score || {};
          const stageSummary = score.stage_summary || {};
          const sleepHours = msToHours(stageSummary.total_in_bed_time_milli);

          await db.run(`
            INSERT INTO whoop_metrics (
              user_id, date, sleep_score, sleep_hours, sleep_efficiency, sleep_consistency,
              deep_sleep_hours, rem_sleep_hours, light_sleep_hours, awake_hours,
              respiratory_rate, sleep_cycles, disturbances
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT(user_id, date) DO UPDATE SET
              sleep_score = EXCLUDED.sleep_score,
              sleep_hours = EXCLUDED.sleep_hours,
              sleep_efficiency = EXCLUDED.sleep_efficiency,
              sleep_consistency = EXCLUDED.sleep_consistency,
              deep_sleep_hours = EXCLUDED.deep_sleep_hours,
              rem_sleep_hours = EXCLUDED.rem_sleep_hours,
              light_sleep_hours = EXCLUDED.light_sleep_hours,
              awake_hours = EXCLUDED.awake_hours,
              respiratory_rate = EXCLUDED.respiratory_rate,
              sleep_cycles = EXCLUDED.sleep_cycles,
              disturbances = EXCLUDED.disturbances
          `, [
            userId,
            date,
            score.sleep_performance_percentage || null,
            sleepHours,
            score.sleep_efficiency_percentage ? Math.round(score.sleep_efficiency_percentage) : null,
            score.sleep_consistency_percentage ? Math.round(score.sleep_consistency_percentage) : null,
            msToHours(stageSummary.total_slow_wave_sleep_time_milli),
            msToHours(stageSummary.total_rem_sleep_time_milli),
            msToHours(stageSummary.total_light_sleep_time_milli),
            msToHours(stageSummary.total_awake_time_milli),
            score.respiratory_rate || null,
            stageSummary.sleep_cycle_count || null,
            stageSummary.disturbance_count || null
          ]);

          await db.run(
            `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
             VALUES ($1, 'whoop_metrics', $2, 'sleep', $3)`,
            [
              userId,
              parsePositiveInt(record.id, 1),
              JSON.stringify({
                date,
                sleep_score: score.sleep_performance_percentage,
                sleep_hours: sleepHours,
                deep_sleep_hours: msToHours(stageSummary.total_slow_wave_sleep_time_milli),
                rem_sleep_hours: msToHours(stageSummary.total_rem_sleep_time_milli),
                source: 'whoop',
                timestamp: new Date().toISOString()
              })
            ]
          );
        }
      }

      // 3. CYCLES (Day Strain)
      console.log('[WHOOP] 💪 Fetching cycles...');
      try {
        const cycleData = await this.getCycles(startDate, endDate);
        results.cycles = cycleData.records?.length || 0;
        console.log(`[WHOOP]   ✓ ${results.cycles} cycle records`);

        if (cycleData.records?.length > 0) {
          for (const record of cycleData.records) {
            const date = record.start ? record.start.split('T')[0] : new Date().toISOString().split('T')[0];
            const score = record.score || {};
            const cycleId = String(record.id);

            await db.run(`
              INSERT INTO whoop_cycles (user_id, cycle_id, date, start_time, end_time, strain, kilojoules, avg_heart_rate, max_heart_rate)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT(user_id, cycle_id) DO UPDATE SET
                strain = EXCLUDED.strain,
                kilojoules = EXCLUDED.kilojoules,
                avg_heart_rate = EXCLUDED.avg_heart_rate,
                max_heart_rate = EXCLUDED.max_heart_rate,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                date = EXCLUDED.date
            `, [
              userId,
              cycleId,
              date,
              record.start || null,
              record.end || null,
              score.strain || null,
              score.kilojoule ? Math.round(score.kilojoule) : null,
              score.average_heart_rate || null,
              score.max_heart_rate || null
            ]);

            await db.run(`
              INSERT INTO whoop_metrics (user_id, date, day_strain, strain_score, kilojoules, avg_heart_rate, max_heart_rate)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              ON CONFLICT(user_id, date) DO UPDATE SET
                day_strain = EXCLUDED.day_strain,
                strain_score = EXCLUDED.strain_score,
                kilojoules = EXCLUDED.kilojoules,
                avg_heart_rate = EXCLUDED.avg_heart_rate,
                max_heart_rate = EXCLUDED.max_heart_rate
            `, [
              userId,
              date,
              score.strain || null,
              score.strain || null,
              score.kilojoule ? Math.round(score.kilojoule) : null,
              score.average_heart_rate || null,
              score.max_heart_rate || null
            ]);
          }
        }
      } catch (err) {
        console.log('[WHOOP]   ⚠ Cycles skipped (no permission or endpoint unavailable)');
        results.errors.push('cycles: ' + err.message);
      }

      // 4. WORKOUTS
      console.log('[WHOOP] 🏃 Fetching workouts...');
      try {
        const workoutData = await this.getWorkouts(startDate, endDate);
        results.workouts = workoutData.records?.length || 0;
        console.log(`[WHOOP]   ✓ ${results.workouts} workout records`);

        if (workoutData.records?.length > 0) {
          for (const record of workoutData.records) {
            const score = record.score || {};
            const zones = score.zone_durations || {};
            const durationMs = record.end && record.start ? new Date(record.end).getTime() - new Date(record.start).getTime() : 0;
            const duration = msToMins(Math.max(durationMs, 0));
            const calories = score.kilojoule ? Math.round(score.kilojoule * 0.239) : null;
            const workoutId = String(record.id);

            await db.run(`
              INSERT INTO whoop_workouts (
                user_id, workout_id, date, sport_name, start_time, end_time, duration_minutes,
                strain, calories, avg_heart_rate, max_heart_rate, distance_meters,
                altitude_gain_meters, zone_0_mins, zone_1_mins, zone_2_mins, zone_3_mins, zone_4_mins, zone_5_mins
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
              ON CONFLICT(user_id, workout_id) DO UPDATE SET
                strain = EXCLUDED.strain,
                calories = EXCLUDED.calories,
                avg_heart_rate = EXCLUDED.avg_heart_rate,
                max_heart_rate = EXCLUDED.max_heart_rate,
                distance_meters = EXCLUDED.distance_meters,
                altitude_gain_meters = EXCLUDED.altitude_gain_meters,
                duration_minutes = EXCLUDED.duration_minutes,
                sport_name = EXCLUDED.sport_name,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                date = EXCLUDED.date,
                zone_0_mins = EXCLUDED.zone_0_mins,
                zone_1_mins = EXCLUDED.zone_1_mins,
                zone_2_mins = EXCLUDED.zone_2_mins,
                zone_3_mins = EXCLUDED.zone_3_mins,
                zone_4_mins = EXCLUDED.zone_4_mins,
                zone_5_mins = EXCLUDED.zone_5_mins
            `, [
              userId,
              workoutId,
              record.start ? record.start.split('T')[0] : null,
              record.sport_name || 'Unknown',
              record.start || null,
              record.end || null,
              duration,
              score.strain || null,
              calories,
              score.average_heart_rate || null,
              score.max_heart_rate || null,
              score.distance_meter || null,
              score.altitude_gain_meter || null,
              msToMins(zones.zone_zero_milli),
              msToMins(zones.zone_one_milli),
              msToMins(zones.zone_two_milli),
              msToMins(zones.zone_three_milli),
              msToMins(zones.zone_four_milli),
              msToMins(zones.zone_five_milli)
            ]);

            await db.run(
              `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
               VALUES ($1, 'whoop_workouts', $2, 'workout', $3)`,
              [
                userId,
                parsePositiveInt(workoutId, 1),
                JSON.stringify({
                  sport_name: record.sport_name || 'Unknown',
                  duration_minutes: duration,
                  calories,
                  strain: score.strain,
                  avg_heart_rate: score.average_heart_rate,
                  max_heart_rate: score.max_heart_rate,
                  source: 'whoop',
                  timestamp: new Date().toISOString()
                })
              ]
            );
          }
        }
      } catch (err) {
        console.log('[WHOOP]   ⚠ Workouts skipped (no permission or endpoint unavailable)');
        results.errors.push('workouts: ' + err.message);
      }

      console.log('[WHOOP] ✅ SYNC COMPLETE:', results);
      return {
        success: true,
        message: 'WHOOP data synced successfully',
        data: results
      };

    } catch (err) {
      console.error('[WHOOP] ❌ SYNC FAILED:', err.message);
      if (err.response) {
        console.error('[WHOOP] API error:', err.response.status, err.response.data);
      }
      throw err;
    }
  }

  async getTodayMetrics(userId = 1) {
    const today = new Date().toISOString().split('T')[0];
    const metrics = await db.get('SELECT * FROM whoop_metrics WHERE user_id = $1 ORDER BY date DESC LIMIT 1', [userId]);
    const workouts = await db.all('SELECT * FROM whoop_workouts WHERE user_id = $1 AND date = $2 ORDER BY start_time DESC', [userId, today]);
    return metrics ? { ...metrics, workouts } : { workouts };
  }

  async getLatestWorkouts(userId = 1, limit = 10) {
    return await db.all('SELECT * FROM whoop_workouts WHERE user_id = $1 ORDER BY start_time DESC LIMIT $2', [userId, limit]);
  }

  isAuthenticated() {
    return !!this.accessToken;
  }
}

module.exports = new WhoopService();
