const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../database');

const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const OURA_API_BASE = 'https://api.ouraring.com';

const DEFAULT_SCOPES = [
  'email',
  'personal',
  'daily',
  'heartrate',
  'workout',
  'session',
  'spo2Daily',
].join(' ');

const WEBHOOK_DEFAULT_DATA_TYPES = [
  'daily_activity',
  'daily_sleep',
  'daily_readiness',
  'sleep',
  'workout',
  'session',
  'daily_stress',
  'daily_spo2',
  'daily_resilience',
  'daily_cardiovascular_age',
  'vo2_max',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNumeric(value) {
  return typeof value === 'number' && !Number.isNaN(value);
}

function toDateTimeString(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function dayStart(day) {
  if (!day) return null;
  return `${day}T00:00:00.000Z`;
}

function dayEnd(day) {
  if (!day) return null;
  return `${day}T23:59:59.999Z`;
}

function calculateDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return Math.round((end - start) / 60000);
}

class OuraService {
  constructor() {
    this.requestQueue = Promise.resolve();
    this.windowStartMs = Date.now();
    this.windowRequestCount = 0;
  }

  get clientId() {
    return process.env.OURA_CLIENT_ID || '';
  }

  get clientSecret() {
    return process.env.OURA_CLIENT_SECRET || '';
  }

  get redirectUri() {
    return process.env.OURA_REDIRECT_URI || 'http://localhost:3001/api/oura/callback';
  }

  get webhookUrl() {
    return process.env.OURA_WEBHOOK_URL || '';
  }

  get webhookVerificationToken() {
    return process.env.OURA_WEBHOOK_VERIFICATION_TOKEN || '';
  }

  get oauthScope() {
    return process.env.OURA_SCOPES || DEFAULT_SCOPES;
  }

  get oauthStateSecret() {
    return process.env.OURA_STATE_SECRET || process.env.JWT_SECRET || 'oura-state-secret';
  }

  get rateLimitMaxRequests() {
    const value = parseInt(process.env.OURA_RATE_LIMIT_MAX || '4800', 10);
    return Number.isNaN(value) ? 4800 : Math.max(1, value);
  }

  get rateLimitWindowMs() {
    return 5 * 60 * 1000;
  }

  async withRequestQueue(task) {
    const next = this.requestQueue.then(task, task);
    this.requestQueue = next.catch(() => {});
    return next;
  }

  async acquireRateLimitSlot() {
    while (true) {
      const now = Date.now();
      if (now - this.windowStartMs >= this.rateLimitWindowMs) {
        this.windowStartMs = now;
        this.windowRequestCount = 0;
      }

      if (this.windowRequestCount < this.rateLimitMaxRequests) {
        this.windowRequestCount += 1;
        return;
      }

      const waitMs = this.rateLimitWindowMs - (now - this.windowStartMs) + 100;
      await sleep(Math.max(waitMs, 100));
    }
  }

  buildOAuthState(userId) {
    return jwt.sign(
      { userId, provider: 'oura' },
      this.oauthStateSecret,
      { expiresIn: '15m' }
    );
  }

  parseOAuthState(stateToken) {
    try {
      const decoded = jwt.verify(stateToken, this.oauthStateSecret);
      if (decoded.provider !== 'oura' || !decoded.userId) return null;
      return decoded;
    } catch (_err) {
      return null;
    }
  }

  getAuthorizationUrl(userId) {
    if (!this.clientId) {
      throw new Error('OURA_CLIENT_ID is not configured');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.oauthScope,
      state: this.buildOAuthState(userId),
    });

    return `${OURA_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
    });

    const response = await axios.post(OURA_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });

    return response.data;
  }

  async fetchPersonalInfoWithAccessToken(accessToken) {
    const response = await axios.get(`${OURA_API_BASE}/v2/usercollection/personal_info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20000,
    });

    return response.data;
  }

  async getConnection(userId) {
    return db.get(
      `SELECT *
       FROM wearable_connections
       WHERE user_id = $1 AND provider = 'oura'`,
      [userId]
    );
  }

  async upsertConnection(userId, tokens, ouraUserId = null) {
    const expiresIn = Number(tokens.expires_in) || 86400;
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));

    await db.run(
      `INSERT INTO wearable_connections (user_id, provider, provider_user_id, access_token, refresh_token, expires_at, connected_at, updated_at)
       VALUES ($1, 'oura', $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         provider_user_id = COALESCE(EXCLUDED.provider_user_id, wearable_connections.provider_user_id),
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, wearable_connections.refresh_token),
         expires_at = EXCLUDED.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        ouraUserId,
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt.toISOString(),
      ]
    );
  }

  async refreshAccessToken(userId, connection) {
    if (!connection?.refresh_token) {
      throw new Error('No Oura refresh token available');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await axios.post(OURA_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20000,
    });

    const refreshed = response.data;
    await this.upsertConnection(userId, refreshed, connection.provider_user_id);
    return refreshed.access_token;
  }

  async getValidAccessToken(userId) {
    const connection = await this.getConnection(userId);
    if (!connection?.access_token) {
      throw new Error('Oura is not connected for this user');
    }

    const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    const expiresSoon = !expiresAt || (Date.now() + 60 * 1000 >= expiresAt);
    if (expiresSoon) {
      return this.refreshAccessToken(userId, connection);
    }

    return connection.access_token;
  }

  async request(options) {
    return this.withRequestQueue(async () => {
      const {
        userId = null,
        method = 'GET',
        path,
        params = undefined,
        data = undefined,
        authType = 'bearer',
      } = options;

      let attempt = 0;
      while (attempt < 5) {
        attempt += 1;
        await this.acquireRateLimitSlot();

        try {
          const headers = {};

          if (authType === 'client') {
            if (!this.clientId || !this.clientSecret) {
              throw new Error('OURA_CLIENT_ID/OURA_CLIENT_SECRET are required for webhook subscription APIs');
            }
            headers['x-client-id'] = this.clientId;
            headers['x-client-secret'] = this.clientSecret;
          } else {
            if (!userId) throw new Error('userId is required for bearer-auth Oura API requests');
            const accessToken = await this.getValidAccessToken(userId);
            headers.Authorization = `Bearer ${accessToken}`;
          }

          const response = await axios.request({
            method,
            url: `${OURA_API_BASE}${path}`,
            headers,
            params,
            data,
            timeout: 20000,
          });

          return response.data;
        } catch (error) {
          const status = error.response?.status;

          if (status === 401 && authType === 'bearer' && userId && attempt < 3) {
            const connection = await this.getConnection(userId);
            if (connection?.refresh_token) {
              await this.refreshAccessToken(userId, connection);
              continue;
            }
          }

          if (status === 429 && attempt < 5) {
            const retryAfter = Number(error.response?.headers?.['retry-after']);
            const baseDelayMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(2000 * (2 ** (attempt - 1)), 30000);
            const jitterMs = Math.floor(Math.random() * 500);
            await sleep(baseDelayMs + jitterMs);
            continue;
          }

          throw error;
        }
      }

      throw new Error('Failed to complete Oura API request');
    });
  }

  getPathForDataType(dataType, objectId = null) {
    const mapping = {
      tag: '/v2/usercollection/tag',
      enhanced_tag: '/v2/usercollection/enhanced_tag',
      workout: '/v2/usercollection/workout',
      session: '/v2/usercollection/session',
      sleep: '/v2/usercollection/sleep',
      daily_sleep: '/v2/usercollection/daily_sleep',
      daily_readiness: '/v2/usercollection/daily_readiness',
      daily_activity: '/v2/usercollection/daily_activity',
      daily_spo2: '/v2/usercollection/daily_spo2',
      sleep_time: '/v2/usercollection/sleep_time',
      rest_mode_period: '/v2/usercollection/rest_mode_period',
      ring_configuration: '/v2/usercollection/ring_configuration',
      daily_stress: '/v2/usercollection/daily_stress',
      daily_cardiovascular_age: '/v2/usercollection/daily_cardiovascular_age',
      daily_resilience: '/v2/usercollection/daily_resilience',
      vo2_max: '/v2/usercollection/vO2_max',
    };

    const basePath = mapping[dataType];
    if (!basePath) {
      throw new Error(`Unsupported Oura data type: ${dataType}`);
    }

    return objectId ? `${basePath}/${encodeURIComponent(objectId)}` : basePath;
  }

  verifyWebhookSignature(rawBody, signature, timestamp) {
    if (!this.clientSecret) return false;
    if (!rawBody || !signature || !timestamp) return false;

    const hmac = crypto.createHmac('sha256', this.clientSecret);
    hmac.update(`${timestamp}${rawBody}`);
    const expected = hmac.digest('hex').toUpperCase();
    const provided = String(signature).trim().toUpperCase();

    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  }

  verifyWebhookChallenge(verificationToken) {
    if (!this.webhookVerificationToken) return false;
    return verificationToken === this.webhookVerificationToken;
  }

  async ensureWebhookSubscriptions() {
    if (!this.webhookUrl || !this.webhookVerificationToken) {
      return {
        enabled: false,
        reason: 'OURA_WEBHOOK_URL or OURA_WEBHOOK_VERIFICATION_TOKEN is missing',
      };
    }

    const desiredDataTypes = (process.env.OURA_WEBHOOK_DATA_TYPES || WEBHOOK_DEFAULT_DATA_TYPES.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const desiredEventTypes = (process.env.OURA_WEBHOOK_EVENT_TYPES || 'create,update')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const desired = [];
    for (const dataType of desiredDataTypes) {
      for (const eventType of desiredEventTypes) {
        desired.push({ data_type: dataType, event_type: eventType });
      }
    }

    const existing = await this.request({
      authType: 'client',
      method: 'GET',
      path: '/v2/webhook/subscription',
    });

    const subscriptions = Array.isArray(existing) ? existing : [];
    let created = 0;

    for (const entry of desired) {
      const found = subscriptions.find((subscription) =>
        subscription.callback_url === this.webhookUrl &&
        subscription.data_type === entry.data_type &&
        subscription.event_type === entry.event_type
      );

      let activeSubscription = found;
      if (!activeSubscription) {
        activeSubscription = await this.request({
          authType: 'client',
          method: 'POST',
          path: '/v2/webhook/subscription',
          data: {
            callback_url: this.webhookUrl,
            verification_token: this.webhookVerificationToken,
            data_type: entry.data_type,
            event_type: entry.event_type,
          },
        });
        created += 1;
      }

      await db.run(
        `INSERT INTO oura_webhook_subscriptions (subscription_id, data_type, event_type, callback_url, expiration_time, active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (subscription_id)
         DO UPDATE SET
           data_type = EXCLUDED.data_type,
           event_type = EXCLUDED.event_type,
           callback_url = EXCLUDED.callback_url,
           expiration_time = EXCLUDED.expiration_time,
           active = true,
           updated_at = CURRENT_TIMESTAMP`,
        [
          activeSubscription.id,
          activeSubscription.data_type,
          activeSubscription.event_type,
          activeSubscription.callback_url,
          activeSubscription.expiration_time || null,
        ]
      );
    }

    return {
      enabled: true,
      created,
      totalDesired: desired.length,
    };
  }

  async createConnection(userId, code) {
    const tokenData = await this.exchangeCodeForTokens(code);
    const personalInfo = await this.fetchPersonalInfoWithAccessToken(tokenData.access_token);

    await this.upsertConnection(userId, tokenData, personalInfo?.id || null);

    return {
      userId,
      ouraUserId: personalInfo?.id || null,
      tokenType: tokenData.token_type || 'bearer',
      expiresIn: tokenData.expires_in || null,
      scope: tokenData.scope || null,
    };
  }

  async disconnect(userId) {
    await db.run(
      `DELETE FROM wearable_connections WHERE user_id = $1 AND provider = 'oura'`,
      [userId]
    );
  }

  extractMetricsFromDocument(dataType, document) {
    const metrics = [];
    const start = toDateTimeString(document?.timestamp) || dayStart(document?.day);
    const end = dayEnd(document?.day);

    if (dataType === 'daily_activity') {
      if (isNumeric(document.steps)) {
        metrics.push({ metric_type: 'steps', value: document.steps, unit: 'count', start_time: start, end_time: end });
      }
      if (isNumeric(document.active_calories)) {
        metrics.push({ metric_type: 'active_calories', value: document.active_calories, unit: 'kcal', start_time: start, end_time: end });
      }
      if (isNumeric(document.equivalent_walking_distance)) {
        metrics.push({ metric_type: 'distance', value: document.equivalent_walking_distance, unit: 'm', start_time: start, end_time: end });
      }
      if (isNumeric(document.total_calories)) {
        metrics.push({ metric_type: 'total_calories', value: document.total_calories, unit: 'kcal', start_time: start, end_time: end });
      }
    }

    if (dataType === 'daily_sleep' && isNumeric(document.score)) {
      metrics.push({ metric_type: 'sleep_score', value: document.score, unit: 'score', start_time: start, end_time: end });
    }

    if (dataType === 'daily_readiness' && isNumeric(document.score)) {
      metrics.push({ metric_type: 'readiness_score', value: document.score, unit: 'score', start_time: start, end_time: end });
    }

    if (dataType === 'sleep') {
      const bedtimeStart = toDateTimeString(document.bedtime_start);
      const bedtimeEnd = toDateTimeString(document.bedtime_end);
      if (isNumeric(document.total_sleep_duration)) {
        metrics.push({
          metric_type: 'sleep',
          value: document.total_sleep_duration / 3600,
          unit: 'hours',
          start_time: bedtimeStart || start,
          end_time: bedtimeEnd || end,
        });
      }
      if (isNumeric(document.average_heart_rate)) {
        metrics.push({
          metric_type: 'heart_rate',
          value: document.average_heart_rate,
          unit: 'bpm',
          start_time: bedtimeStart || start,
          end_time: bedtimeEnd || end,
        });
      }
      if (isNumeric(document.average_hrv)) {
        metrics.push({
          metric_type: 'heart_rate_variability',
          value: document.average_hrv,
          unit: 'ms',
          start_time: bedtimeStart || start,
          end_time: bedtimeEnd || end,
        });
      }
    }

    if (dataType === 'workout') {
      const workoutStart = toDateTimeString(document.start_datetime);
      const workoutEnd = toDateTimeString(document.end_datetime);
      const durationMinutes = calculateDurationMinutes(workoutStart, workoutEnd);
      if (isNumeric(durationMinutes)) {
        metrics.push({
          metric_type: 'workout',
          value: durationMinutes,
          unit: 'minutes',
          start_time: workoutStart || start,
          end_time: workoutEnd || end,
        });
      }
      if (isNumeric(document.calories)) {
        metrics.push({
          metric_type: 'active_calories',
          value: document.calories,
          unit: 'kcal',
          start_time: workoutStart || start,
          end_time: workoutEnd || end,
        });
      }
      if (isNumeric(document.distance)) {
        metrics.push({
          metric_type: 'distance',
          value: document.distance,
          unit: 'm',
          start_time: workoutStart || start,
          end_time: workoutEnd || end,
        });
      }
    }

    if (dataType === 'daily_spo2') {
      const avg = document?.spo2_percentage?.average;
      if (isNumeric(avg)) {
        metrics.push({
          metric_type: 'spo2',
          value: avg,
          unit: 'percent',
          start_time: start,
          end_time: end,
        });
      }
    }

    if (dataType === 'daily_stress') {
      if (isNumeric(document.stress_high)) {
        metrics.push({
          metric_type: 'stress_high_seconds',
          value: document.stress_high,
          unit: 'seconds',
          start_time: start,
          end_time: end,
        });
      }
      if (isNumeric(document.recovery_high)) {
        metrics.push({
          metric_type: 'recovery_high_seconds',
          value: document.recovery_high,
          unit: 'seconds',
          start_time: start,
          end_time: end,
        });
      }
    }

    if (dataType === 'daily_cardiovascular_age' && isNumeric(document.vascular_age)) {
      metrics.push({
        metric_type: 'vascular_age',
        value: document.vascular_age,
        unit: 'years',
        start_time: start,
        end_time: end,
      });
    }

    if (dataType === 'vo2_max' && isNumeric(document.vo2_max)) {
      metrics.push({
        metric_type: 'vo2_max',
        value: document.vo2_max,
        unit: 'ml/kg/min',
        start_time: toDateTimeString(document.timestamp) || start,
        end_time: end,
      });
    }

    return metrics;
  }

  extractSummaryValue(document) {
    if (isNumeric(document?.score)) return document.score;
    if (isNumeric(document?.steps)) return document.steps;
    if (isNumeric(document?.active_calories)) return document.active_calories;
    if (isNumeric(document?.vo2_max)) return document.vo2_max;
    if (isNumeric(document?.stress_high)) return document.stress_high;
    return null;
  }

  async insertMetric(userId, metric, metadata, ouraDocumentId) {
    const result = await db.run(
      `INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time, metadata)
       SELECT $1, 'oura', $2, $3, $4, $5, $6, $7::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM mobile_health_metrics
         WHERE user_id = $1
           AND source = 'oura'
           AND metric_type = $2
           AND start_time IS NOT DISTINCT FROM $5
           AND end_time IS NOT DISTINCT FROM $6
           AND metadata->>'oura_document_id' = $8
       )
       RETURNING id`,
      [
        userId,
        metric.metric_type,
        metric.value,
        metric.unit || null,
        metric.start_time || null,
        metric.end_time || null,
        JSON.stringify(metadata),
        String(ouraDocumentId),
      ]
    );

    return result.id || null;
  }

  async persistDocumentAndMetrics(userId, dataType, document, webhookPayload = null) {
    const docId = document?.id ? String(document.id) : null;
    if (!docId) {
      throw new Error(`Oura ${dataType} document has no id`);
    }

    const day = document?.day || null;
    const startTime = toDateTimeString(document.bedtime_start || document.start_datetime || document.timestamp);
    const endTime = toDateTimeString(document.bedtime_end || document.end_datetime);
    const summaryValue = this.extractSummaryValue(document);

    const stored = await db.run(
      `INSERT INTO oura_documents (user_id, data_type, document_id, day, start_time, end_time, summary_value, raw_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, data_type, document_id)
       DO UPDATE SET
         day = EXCLUDED.day,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         summary_value = EXCLUDED.summary_value,
         raw_json = EXCLUDED.raw_json,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        userId,
        dataType,
        docId,
        day || null,
        startTime,
        endTime,
        summaryValue,
        JSON.stringify(document),
      ]
    );

    const metrics = this.extractMetricsFromDocument(dataType, document);
    let insertedMetrics = 0;

    for (const metric of metrics) {
      const metadata = {
        provider: 'oura',
        oura_data_type: dataType,
        oura_document_id: docId,
        oura_document_day: day || null,
        webhook_event_type: webhookPayload?.event_type || null,
        webhook_event_time: webhookPayload?.event_time || null,
        raw_document: document,
      };

      const metricId = await this.insertMetric(userId, metric, metadata, docId);
      if (!metricId) continue;

      insertedMetrics += 1;

      await db.run(
        `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
         VALUES ($1, 'mobile_health_metrics', $2, $3, $4::jsonb)`,
        [
          userId,
          metricId,
          metric.metric_type,
          JSON.stringify({
            source: 'oura',
            metric_type: metric.metric_type,
            value: metric.value,
            unit: metric.unit,
            start_time: metric.start_time,
            end_time: metric.end_time,
            data_type: dataType,
            document_id: docId,
            timestamp: new Date().toISOString(),
          }),
        ]
      );
    }

    await db.run(
      `INSERT INTO webhook_events (user_id, event_type, payload)
       VALUES ($1, 'health_data_changed', $2::jsonb)`,
      [
        userId,
        JSON.stringify({
          source: 'oura',
          data_type: dataType,
          document_id: docId,
          metrics_inserted: insertedMetrics,
          timestamp: new Date().toISOString(),
        }),
      ]
    );

    return {
      storedDocumentId: stored.id || null,
      insertedMetrics,
    };
  }

  async processWebhookEvent(payload) {
    const dataType = payload?.data_type;
    const eventType = payload?.event_type;
    const objectId = payload?.object_id ? String(payload.object_id) : null;
    const ouraUserId = payload?.user_id ? String(payload.user_id) : null;
    const eventTime = toDateTimeString(payload?.event_time) || new Date().toISOString();

    if (!dataType || !eventType || !objectId) {
      throw new Error('Invalid Oura webhook payload');
    }

    const connection = ouraUserId
      ? await db.get(
        `SELECT user_id
         FROM wearable_connections
         WHERE provider = 'oura' AND provider_user_id = $1`,
        [ouraUserId]
      )
      : null;

    if (!connection?.user_id) {
      throw new Error(`No local user mapped for Oura user_id ${ouraUserId || 'unknown'}`);
    }

    const userId = connection.user_id;

    const insertedEvent = await db.run(
      `INSERT INTO oura_webhook_events (user_id, oura_user_id, event_type, data_type, object_id, event_time, payload, processed)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, false)
       ON CONFLICT (user_id, data_type, event_type, object_id, event_time)
       DO NOTHING
       RETURNING id`,
      [
        userId,
        ouraUserId,
        eventType,
        dataType,
        objectId,
        eventTime,
        JSON.stringify(payload),
      ]
    );

    if (!insertedEvent.id) {
      return { duplicate: true, userId };
    }

    const eventId = insertedEvent.id;

    try {
      if (eventType === 'delete') {
        await db.run(
          `UPDATE oura_webhook_events SET processed = true, process_error = null WHERE id = $1`,
          [eventId]
        );
        return { userId, deleted: true };
      }

      const path = this.getPathForDataType(dataType, objectId);
      const document = await this.request({
        userId,
        method: 'GET',
        path,
        authType: 'bearer',
      });

      const persisted = await this.persistDocumentAndMetrics(userId, dataType, document, payload);

      await db.run(
        `UPDATE oura_webhook_events SET processed = true, process_error = null WHERE id = $1`,
        [eventId]
      );

      return {
        userId,
        eventId,
        ...persisted,
      };
    } catch (error) {
      await db.run(
        `UPDATE oura_webhook_events SET processed = false, process_error = $2 WHERE id = $1`,
        [eventId, error.message]
      );
      throw error;
    }
  }

  async syncDataTypeRange(userId, dataType, startDate, endDate) {
    const path = this.getPathForDataType(dataType);
    const params = {
      start_date: startDate,
      end_date: endDate,
      next_token: null,
    };

    let nextToken = null;
    let documentCount = 0;
    let metricCount = 0;

    do {
      const response = await this.request({
        userId,
        method: 'GET',
        path,
        params: {
          start_date: params.start_date,
          end_date: params.end_date,
          ...(nextToken ? { next_token: nextToken } : {}),
        },
        authType: 'bearer',
      });

      const data = Array.isArray(response?.data) ? response.data : [];
      nextToken = response?.next_token || null;

      for (const document of data) {
        const persisted = await this.persistDocumentAndMetrics(userId, dataType, document);
        documentCount += 1;
        metricCount += persisted.insertedMetrics || 0;
      }
    } while (nextToken);

    return {
      dataType,
      documents: documentCount,
      metrics: metricCount,
    };
  }

  async syncHistoricalData(userId, days = 30, dataTypes = null) {
    const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - (safeDays * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

    const selectedDataTypes = Array.isArray(dataTypes) && dataTypes.length > 0
      ? dataTypes
      : ['daily_activity', 'daily_sleep', 'daily_readiness', 'sleep', 'workout', 'daily_stress'];

    const results = [];
    for (const dataType of selectedDataTypes) {
      try {
        const result = await this.syncDataTypeRange(userId, dataType, startDate, endDate);
        results.push({ ...result, success: true });
      } catch (error) {
        results.push({ dataType, success: false, error: error.message });
      }
    }

    return {
      days: safeDays,
      startDate,
      endDate,
      results,
    };
  }

  async getStatus(userId) {
    const connection = await this.getConnection(userId);
    const latestWebhookEvent = await db.get(
      `SELECT data_type, event_type, object_id, event_time, processed, process_error, created_at
       FROM oura_webhook_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    const docsCount = await db.get(
      `SELECT COUNT(*)::int AS count
       FROM oura_documents
       WHERE user_id = $1`,
      [userId]
    );

    return {
      connected: !!connection,
      providerUserId: connection?.provider_user_id || null,
      expiresAt: connection?.expires_at || null,
      hasRefreshToken: !!connection?.refresh_token,
      webhookConfigured: !!(this.webhookUrl && this.webhookVerificationToken),
      documentsSynced: docsCount?.count || 0,
      latestWebhookEvent: latestWebhookEvent || null,
    };
  }
}

module.exports = new OuraService();
