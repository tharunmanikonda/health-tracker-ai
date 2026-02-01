const axios = require('axios');
const db = require('../database');

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI || 'http://localhost:3001/api/whoop/callback';

class WhoopService {
  constructor() {
    this.clientId = process.env.WHOOP_CLIENT_ID;
    this.clientSecret = process.env.WHOOP_CLIENT_SECRET;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.loadTokensFromDb();
  }

  async loadTokensFromDb() {
    try {
      const row = await db.get('SELECT whoop_access_token, whoop_refresh_token, whoop_token_expiry FROM user_settings WHERE id = 1');
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

  async saveTokensToDb() {
    try {
      await db.run(`
        INSERT INTO user_settings (id, whoop_access_token, whoop_refresh_token, whoop_token_expiry)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(id) DO UPDATE SET
          whoop_access_token = EXCLUDED.whoop_access_token,
          whoop_refresh_token = EXCLUDED.whoop_refresh_token,
          whoop_token_expiry = EXCLUDED.whoop_token_expiry
      `, [1, this.accessToken, this.refreshToken, this.tokenExpiry]);
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
    params.append('scope', 'read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement read:strain offline');
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
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  async getProfile() {
    const headers = await this.getHeaders();
    const response = await axios.get(`${WHOOP_API_BASE}/v2/user/profile/basic`, { headers });
    return response.data;
  }

  // Recovery data
  async getRecovery(startDate, endDate) {
    const headers = await this.getHeaders();
    let url = `${WHOOP_API_BASE}/v2/recovery`;
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    params.append('limit', '25');
    if (params.toString()) url += '?' + params.toString();
    
    const response = await axios.get(url, { headers });
    return response.data;
  }

  // Sleep data
  async getSleep(startDate, endDate) {
    const headers = await this.getHeaders();
    let url = `${WHOOP_API_BASE}/v2/activity/sleep`;
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    params.append('limit', '25');
    if (params.toString()) url += '?' + params.toString();
    
    const response = await axios.get(url, { headers });
    return response.data;
  }

  // Cycles (daily strain)
  async getCycles(startDate, endDate) {
    const headers = await this.getHeaders();
    let url = `${WHOOP_API_BASE}/v2/cycle`;
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    params.append('limit', '25');
    if (params.toString()) url += '?' + params.toString();
    
    const response = await axios.get(url, { headers });
    return response.data;
  }

  // Workouts
  async getWorkouts(startDate, endDate) {
    const headers = await this.getHeaders();
    let url = `${WHOOP_API_BASE}/v2/workout`;
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);
    params.append('limit', '25');
    if (params.toString()) url += '?' + params.toString();
    
    const response = await axios.get(url, { headers });
    return response.data;
  }

  // COMPREHENSIVE SYNC - ALL DATA
  async syncLatestData() {
    const today = new Date().toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    console.log('[WHOOP] 🔄 SYNCING ALL DATA from', sevenDaysAgo.split('T')[0], 'to', today.split('T')[0]);

    const results = {
      recovery: 0,
      sleep: 0,
      cycles: 0,
      workouts: 0,
      errors: []
    };

    try {
      // 1. RECOVERY DATA
      console.log('[WHOOP] 📊 Fetching recovery...');
      const recoveryData = await this.getRecovery(sevenDaysAgo, today);
      results.recovery = recoveryData.records?.length || 0;
      console.log(`[WHOOP]   ✓ ${results.recovery} recovery records`);
      
      if (recoveryData.records?.length > 0) {
        for (const record of recoveryData.records) {
          const date = record.created_at ? record.created_at.split('T')[0] : new Date().toISOString().split('T')[0];
          const score = record.score || {};
          
          await db.run(`
            INSERT INTO whoop_metrics (
              date, recovery_score, resting_hr, hrv, spo2, skin_temp
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT(date) DO UPDATE SET
              recovery_score = EXCLUDED.recovery_score,
              resting_hr = EXCLUDED.resting_hr,
              hrv = EXCLUDED.hrv,
              spo2 = EXCLUDED.spo2,
              skin_temp = EXCLUDED.skin_temp
          `, [
            date, 
            score.recovery_score || null, 
            score.resting_heart_rate || null, 
            score.hrv_rmssd_milli ? Math.round(score.hrv_rmssd_milli) : null,
            score.spo2_percentage ? Math.round(score.spo2_percentage) : null,
            score.skin_temp_celsius || null
          ]);
          
          // Push to AI feed queue
          await db.run(
            `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
             VALUES ($1, 'whoop_metrics', $2, 'recovery', $3)`,
            [
              1, // default user
              1, // placeholder - we'd need to fetch the actual id
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
      const sleepData = await this.getSleep(sevenDaysAgo, today);
      results.sleep = sleepData.records?.length || 0;
      console.log(`[WHOOP]   ✓ ${results.sleep} sleep records`);
      
      if (sleepData.records?.length > 0) {
        for (const record of sleepData.records) {
          const date = record.end ? record.end.split('T')[0] : new Date().toISOString().split('T')[0];
          const score = record.score || {};
          const stageSummary = score.stage_summary || {};
          const sleepNeeded = score.sleep_needed || {};
          
          // Calculate hours from milliseconds
          const msToHours = (ms) => ms ? ms / 3600000 : null;
          const sleepHours = msToHours(stageSummary.total_in_bed_time_milli);
          
          await db.run(`
            INSERT INTO whoop_metrics (
              date, sleep_score, sleep_hours, sleep_efficiency, sleep_consistency,
              deep_sleep_hours, rem_sleep_hours, light_sleep_hours, awake_hours,
              respiratory_rate, sleep_cycles, disturbances
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT(date) DO UPDATE SET
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
          
          // Push to AI feed queue
          await db.run(
            `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
             VALUES ($1, 'whoop_metrics', $2, 'sleep', $3)`,
            [
              1, // default user
              1, // placeholder
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
        const cycleData = await this.getCycles(sevenDaysAgo, today);
        results.cycles = cycleData.records?.length || 0;
        console.log(`[WHOOP]   ✓ ${results.cycles} cycle records`);
        
        if (cycleData.records?.length > 0) {
          for (const record of cycleData.records) {
            const date = record.start ? record.start.split('T')[0] : new Date().toISOString().split('T')[0];
            const score = record.score || {};
            
            await db.run(`
              INSERT INTO whoop_cycles (cycle_id, date, start_time, end_time, strain, kilojoules, avg_heart_rate, max_heart_rate)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT(cycle_id) DO UPDATE SET
                strain = EXCLUDED.strain,
                kilojoules = EXCLUDED.kilojoules,
                avg_heart_rate = EXCLUDED.avg_heart_rate,
                max_heart_rate = EXCLUDED.max_heart_rate
            `, [
              String(record.id),
              date,
              record.start || null,
              record.end || null,
              score.strain || null,
              score.kilojoule ? Math.round(score.kilojoule) : null,
              score.average_heart_rate || null,
              score.max_heart_rate || null
            ]);
            
            // Also update the daily metrics table
            await db.run(`
              INSERT INTO whoop_metrics (date, day_strain, kilojoules, avg_heart_rate, max_heart_rate)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT(date) DO UPDATE SET
                day_strain = EXCLUDED.day_strain,
                kilojoules = EXCLUDED.kilojoules,
                avg_heart_rate = EXCLUDED.avg_heart_rate,
                max_heart_rate = EXCLUDED.max_heart_rate
            `, [
              date,
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
        const workoutData = await this.getWorkouts(sevenDaysAgo, today);
        results.workouts = workoutData.records?.length || 0;
        console.log(`[WHOOP]   ✓ ${results.workouts} workout records`);
        
        if (workoutData.records?.length > 0) {
          for (const record of workoutData.records) {
            const score = record.score || {};
            const zones = score.zone_durations || {};
            const msToMins = (ms) => ms ? Math.round(ms / 60000) : 0;
            const duration = msToMins(record.end && record.start ? new Date(record.end) - new Date(record.start) : 0);
            const calories = score.kilojoule ? Math.round(score.kilojoule * 0.239) : null;
            
            await db.run(`
              INSERT INTO whoop_workouts (
                workout_id, date, sport_name, start_time, end_time, duration_minutes,
                strain, calories, avg_heart_rate, max_heart_rate, distance_meters,
                altitude_gain_meters, zone_0_mins, zone_1_mins, zone_2_mins, zone_3_mins, zone_4_mins, zone_5_mins
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
              ON CONFLICT(workout_id) DO UPDATE SET
                strain = EXCLUDED.strain,
                calories = EXCLUDED.calories,
                avg_heart_rate = EXCLUDED.avg_heart_rate,
                max_heart_rate = EXCLUDED.max_heart_rate
            `, [
              String(record.id),
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
            
            // Push to AI feed queue
            await db.run(
              `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
               VALUES ($1, 'whoop_workouts', $2, 'workout', $3)`,
              [
                1, // default user
                1, // placeholder
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

  async getTodayMetrics() {
    const today = new Date().toISOString().split('T')[0];
    const metrics = await db.get('SELECT * FROM whoop_metrics ORDER BY date DESC LIMIT 1');
    const workouts = await db.all('SELECT * FROM whoop_workouts WHERE date = ? ORDER BY start_time DESC', [today]);
    return { ...metrics, workouts };
  }

  async getLatestWorkouts(limit = 10) {
    return await db.all('SELECT * FROM whoop_workouts ORDER BY start_time DESC LIMIT ?', [limit]);
  }

  isAuthenticated() {
    return !!this.accessToken;
  }
}

module.exports = new WhoopService();
