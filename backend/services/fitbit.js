const axios = require('axios');
const db = require('../database');

const FITBIT_API_BASE = 'https://api.fitbit.com';
const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token';

class FitbitService {
  constructor() {
    this.clientId = process.env.FITBIT_CLIENT_ID;
    this.clientSecret = process.env.FITBIT_CLIENT_SECRET;
  }

  getBasicAuth() {
    return 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
  }

  // Load tokens from DB for a user
  async loadTokens(userId) {
    const connection = await db.get(`
      SELECT access_token, refresh_token, expires_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);
    return connection;
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
          'Authorization': this.getBasicAuth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Save new tokens (refresh_token is single-use, must save the new one)
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

    if (new Date(connection.expires_at) < new Date()) {
      return await this.refreshAccessToken(userId);
    }

    return connection.access_token;
  }

  // API request helper with auto-retry on 401
  async apiRequest(userId, url) {
    let token = await this.getValidToken(userId);

    try {
      const res = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return res.data;
    } catch (err) {
      if (err.response?.status === 401) {
        // Token expired mid-request, refresh and retry
        token = await this.refreshAccessToken(userId);
        const res = await axios.get(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.data;
      }
      throw err;
    }
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
  // COMPREHENSIVE SYNC
  // ========================

  async syncLatestData(userId) {
    const today = new Date().toISOString().split('T')[0];
    console.log(`[Fitbit] Syncing data for user ${userId}, date ${today}`);

    const results = {
      activity: false,
      heartRate: false,
      hrv: false,
      sleep: false,
      weight: false,
      azm: false,
      errors: []
    };

    // 1. DAILY ACTIVITY (steps, calories, distance, active minutes)
    try {
      const data = await this.getDailyActivity(userId, today);
      const summary = data.summary;

      if (summary) {
        // Steps
        if (summary.steps != null) {
          await this.upsertMetric(userId, 'steps', summary.steps, 'count', today);
          await this.pushToAIFeed(userId, 'activity', {
            date: today,
            steps: summary.steps,
            caloriesOut: summary.caloriesOut,
            veryActiveMinutes: summary.veryActiveMinutes,
            fairlyActiveMinutes: summary.fairlyActiveMinutes,
            lightlyActiveMinutes: summary.lightlyActiveMinutes,
            sedentaryMinutes: summary.sedentaryMinutes,
            source: 'fitbit'
          });
        }

        // Calories burned
        if (summary.caloriesOut != null) {
          await this.upsertMetric(userId, 'active_calories', summary.caloriesOut, 'kcal', today);
        }

        // Total distance
        const totalDist = summary.distances?.find(d => d.activity === 'total');
        if (totalDist) {
          await this.upsertMetric(userId, 'distance', totalDist.distance, 'km', today);
        }

        // Active minutes
        if (summary.veryActiveMinutes != null) {
          await this.upsertMetric(userId, 'very_active_minutes', summary.veryActiveMinutes, 'minutes', today);
        }
        if (summary.fairlyActiveMinutes != null) {
          await this.upsertMetric(userId, 'fairly_active_minutes', summary.fairlyActiveMinutes, 'minutes', today);
        }

        // Floors
        if (summary.floors != null) {
          await this.upsertMetric(userId, 'floors', summary.floors, 'count', today);
        }

        results.activity = true;
        console.log(`[Fitbit]   Steps: ${summary.steps}, Calories: ${summary.caloriesOut}`);
      }
    } catch (err) {
      console.log('[Fitbit]   Activity sync skipped:', err.message);
      results.errors.push('activity: ' + err.message);
    }

    // 2. HEART RATE (resting HR + zones)
    try {
      const data = await this.getHeartRate(userId, today);
      const hrData = data?.['activities-heart']?.[0]?.value;

      if (hrData) {
        if (hrData.restingHeartRate) {
          await this.upsertMetric(userId, 'resting_heart_rate', hrData.restingHeartRate, 'bpm', today);
          await this.pushToAIFeed(userId, 'heart_rate', {
            date: today,
            restingHeartRate: hrData.restingHeartRate,
            zones: hrData.heartRateZones,
            source: 'fitbit'
          });
        }

        // Store heart rate zones as metadata
        if (hrData.heartRateZones) {
          await this.upsertMetric(userId, 'heart_rate_zones', 0, 'zones', today, {
            zones: hrData.heartRateZones
          });
        }

        results.heartRate = true;
        console.log(`[Fitbit]   Resting HR: ${hrData.restingHeartRate}`);
      }
    } catch (err) {
      console.log('[Fitbit]   Heart rate sync skipped:', err.message);
      results.errors.push('heartRate: ' + err.message);
    }

    // 3. HRV (Heart Rate Variability)
    try {
      const data = await this.getHRVSummary(userId, today);
      const hrvData = data?.hrv?.[0]?.value;

      if (hrvData) {
        if (hrvData.dailyRmssd) {
          await this.upsertMetric(userId, 'hrv', Math.round(hrvData.dailyRmssd), 'ms', today, {
            dailyRmssd: hrvData.dailyRmssd,
            deepRmssd: hrvData.deepRmssd
          });
          await this.pushToAIFeed(userId, 'hrv', {
            date: today,
            dailyRmssd: hrvData.dailyRmssd,
            deepRmssd: hrvData.deepRmssd,
            source: 'fitbit'
          });
        }

        results.hrv = true;
        console.log(`[Fitbit]   HRV: ${hrvData.dailyRmssd?.toFixed(1)}ms`);
      }
    } catch (err) {
      console.log('[Fitbit]   HRV sync skipped:', err.message);
      results.errors.push('hrv: ' + err.message);
    }

    // 4. SLEEP (stages, duration, efficiency)
    try {
      const data = await this.getSleep(userId, today);
      const mainSleep = data?.sleep?.find(s => s.isMainSleep) || data?.sleep?.[0];

      if (mainSleep) {
        const sleepMinutes = mainSleep.minutesAsleep || 0;
        const sleepHours = sleepMinutes / 60;
        const stages = mainSleep.levels?.summary || {};

        await this.upsertMetric(userId, 'sleep', sleepMinutes, 'minutes', today, {
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
            wakeAvg30: stages.wake?.thirtyDayAvgMinutes
          }
        });

        await this.pushToAIFeed(userId, 'sleep', {
          date: today,
          sleepHours,
          efficiency: mainSleep.efficiency,
          minutesAsleep: sleepMinutes,
          minutesAwake: mainSleep.minutesAwake,
          deepMinutes: stages.deep?.minutes || 0,
          lightMinutes: stages.light?.minutes || 0,
          remMinutes: stages.rem?.minutes || 0,
          startTime: mainSleep.startTime,
          endTime: mainSleep.endTime,
          source: 'fitbit'
        });

        results.sleep = true;
        console.log(`[Fitbit]   Sleep: ${sleepHours.toFixed(1)}h, Efficiency: ${mainSleep.efficiency}%`);
      }
    } catch (err) {
      console.log('[Fitbit]   Sleep sync skipped:', err.message);
      results.errors.push('sleep: ' + err.message);
    }

    // 5. WEIGHT / BMI
    try {
      const data = await this.getWeight(userId, today);
      const latestWeight = data?.weight?.[0];

      if (latestWeight) {
        await this.upsertMetric(userId, 'weight', latestWeight.weight, 'lbs', today, {
          bmi: latestWeight.bmi,
          fat: latestWeight.fat,
          source: latestWeight.source
        });
        await this.pushToAIFeed(userId, 'weight', {
          date: today,
          weight: latestWeight.weight,
          bmi: latestWeight.bmi,
          fat: latestWeight.fat,
          source: 'fitbit'
        });

        results.weight = true;
        console.log(`[Fitbit]   Weight: ${latestWeight.weight}, BMI: ${latestWeight.bmi}`);
      }
    } catch (err) {
      console.log('[Fitbit]   Weight sync skipped:', err.message);
      results.errors.push('weight: ' + err.message);
    }

    // 6. ACTIVE ZONE MINUTES
    try {
      const data = await this.getActiveZoneMinutes(userId, today);
      const azmData = data?.['activities-active-zone-minutes']?.[0]?.value;

      if (azmData) {
        await this.upsertMetric(userId, 'active_zone_minutes', azmData.activeZoneMinutes || 0, 'minutes', today, {
          fatBurn: azmData.fatBurnActiveZoneMinutes || 0,
          cardio: azmData.cardioActiveZoneMinutes || 0,
          peak: azmData.peakActiveZoneMinutes || 0
        });

        results.azm = true;
        console.log(`[Fitbit]   AZM: ${azmData.activeZoneMinutes} (FB:${azmData.fatBurnActiveZoneMinutes} C:${azmData.cardioActiveZoneMinutes} P:${azmData.peakActiveZoneMinutes})`);
      }
    } catch (err) {
      console.log('[Fitbit]   AZM sync skipped:', err.message);
      results.errors.push('azm: ' + err.message);
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

    // Delete existing metric for this user/source/type/date, then insert
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
  async syncAllUsers() {
    const users = await this.getConnectedUsers();
    console.log(`[Fitbit] Cron: syncing ${users.length} connected users`);

    for (const user of users) {
      try {
        await this.syncLatestData(user.user_id);
      } catch (err) {
        console.error(`[Fitbit] Cron sync failed for user ${user.user_id}:`, err.message);
      }
    }
  }

  // ========================
  // WEBHOOK / SUBSCRIPTION
  // ========================

  // Create a subscription for a user after OAuth
  async createSubscription(userId, collectionType = null) {
    const token = await this.getValidToken(userId);
    const subscriptionId = `user-${userId}`;

    let url = `${FITBIT_API_BASE}/1/user/-/`;
    if (collectionType) {
      url += `${collectionType}/`;
    }
    url += `apiSubscriptions/${subscriptionId}.json`;

    try {
      const res = await axios.post(url, null, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`[Fitbit] Subscription created for user ${userId}:`, res.data);
      return res.data;
    } catch (err) {
      // 409 = subscription already exists, which is fine
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
    const crypto = require('crypto');
    const signingKey = this.clientSecret + '&';
    const expectedSignature = crypto
      .createHmac('sha1', signingKey)
      .update(body)
      .digest('base64');
    return signature === expectedSignature;
  }
}

module.exports = new FitbitService();
