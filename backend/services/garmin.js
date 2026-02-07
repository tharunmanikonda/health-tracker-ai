const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../database');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function startOfDay(day) {
  if (!day) return null;
  return `${day}T00:00:00.000Z`;
}

function endOfDay(day) {
  if (!day) return null;
  return `${day}T23:59:59.999Z`;
}

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Base64Url(input) {
  return crypto.createHash('sha256').update(input).digest('base64url');
}

class GarminService {
  constructor() {
    this.requestQueue = Promise.resolve();
    this.windowStartMs = Date.now();
    this.windowRequestCount = 0;
  }

  get clientId() {
    return process.env.GARMIN_CLIENT_ID || '';
  }

  get clientSecret() {
    return process.env.GARMIN_CLIENT_SECRET || '';
  }

  get authorizeUrl() {
    return process.env.GARMIN_AUTH_URL || 'https://diauth.garmin.com/di-oauth2-service/oauth/authorize';
  }

  get tokenUrl() {
    return process.env.GARMIN_TOKEN_URL || 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
  }

  get apiBaseUrl() {
    return process.env.GARMIN_API_BASE_URL || 'https://apis.garmin.com';
  }

  get redirectUri() {
    return process.env.GARMIN_REDIRECT_URI || 'http://localhost:3001/api/garmin/callback';
  }

  get scopes() {
    return process.env.GARMIN_SCOPES || '';
  }

  get webhookSecret() {
    return process.env.GARMIN_WEBHOOK_SECRET || '';
  }

  get webhookSignatureHeader() {
    return (process.env.GARMIN_WEBHOOK_SIGNATURE_HEADER || 'x-garmin-signature').toLowerCase();
  }

  get webhookEnabled() {
    return !!(process.env.GARMIN_WEBHOOK_URL || process.env.GARMIN_WEBHOOK_SECRET);
  }

  get oauthStateSecret() {
    return process.env.GARMIN_STATE_SECRET || process.env.JWT_SECRET || 'garmin-state-secret';
  }

  get rateLimitMaxRequests() {
    const value = parseInt(process.env.GARMIN_RATE_LIMIT_MAX || '900', 10);
    return Number.isNaN(value) ? 900 : Math.max(1, value);
  }

  get rateLimitWindowMs() {
    return 5 * 60 * 1000;
  }

  get pullEndpoints() {
    return (process.env.GARMIN_PULL_ENDPOINTS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  async withQueue(task) {
    const next = this.requestQueue.then(task, task);
    this.requestQueue = next.catch(() => {});
    return next;
  }

  async acquireRateSlot() {
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

  buildState(userId) {
    const verifier = randomBase64Url(64);
    return jwt.sign(
      {
        provider: 'garmin',
        userId,
        pkceVerifier: verifier,
      },
      this.oauthStateSecret,
      { expiresIn: '15m' }
    );
  }

  parseState(stateToken) {
    try {
      const parsed = jwt.verify(stateToken, this.oauthStateSecret);
      if (parsed.provider !== 'garmin' || !parsed.userId) return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  getAuthorizationUrl(userId) {
    if (!this.clientId) throw new Error('GARMIN_CLIENT_ID is not configured');

    const stateToken = this.buildState(userId);
    const parsed = this.parseState(stateToken);
    const codeChallenge = sha256Base64Url(parsed.pkceVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state: stateToken,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (this.scopes) {
      params.set('scope', this.scopes);
    }

    return `${this.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code, stateToken) {
    const parsedState = this.parseState(stateToken);
    if (!parsedState?.pkceVerifier) {
      throw new Error('Invalid or expired Garmin OAuth state');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: parsedState.pkceVerifier,
      state: stateToken,
    });

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await axios.post(this.tokenUrl, body.toString(), {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    });

    return response.data;
  }

  async getConnection(userId) {
    return db.get(
      `SELECT *
       FROM wearable_connections
       WHERE user_id = $1 AND provider = 'garmin'`,
      [userId]
    );
  }

  async upsertConnection(userId, tokens, providerUserId = null) {
    const expiresIn = Number(tokens.expires_in) || 86400;
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));

    await db.run(
      `INSERT INTO wearable_connections (user_id, provider, provider_user_id, access_token, refresh_token, expires_at, connected_at, updated_at)
       VALUES ($1, 'garmin', $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         provider_user_id = COALESCE(EXCLUDED.provider_user_id, wearable_connections.provider_user_id),
         access_token = EXCLUDED.access_token,
         refresh_token = COALESCE(EXCLUDED.refresh_token, wearable_connections.refresh_token),
         expires_at = EXCLUDED.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        providerUserId,
        tokens.access_token,
        tokens.refresh_token || null,
        expiresAt.toISOString(),
      ]
    );
  }

  async refreshAccessToken(userId, connection) {
    if (!connection?.refresh_token) {
      throw new Error('No Garmin refresh token available');
    }

    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
    });

    const response = await axios.post(this.tokenUrl, body.toString(), {
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    });

    await this.upsertConnection(userId, response.data, connection.provider_user_id);
    return response.data.access_token;
  }

  async getValidAccessToken(userId) {
    const connection = await this.getConnection(userId);
    if (!connection?.access_token) {
      throw new Error('Garmin is not connected for this user');
    }

    const expiresAtMs = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    const expiresSoon = !expiresAtMs || (Date.now() + 60 * 1000 >= expiresAtMs);
    if (expiresSoon) {
      return this.refreshAccessToken(userId, connection);
    }

    return connection.access_token;
  }

  async request(userId, method, path, { params = undefined, data = undefined } = {}) {
    return this.withQueue(async () => {
      let attempt = 0;

      while (attempt < 5) {
        attempt += 1;
        await this.acquireRateSlot();

        try {
          const accessToken = await this.getValidAccessToken(userId);
          const response = await axios.request({
            method,
            url: `${this.apiBaseUrl}${path}`,
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            params,
            data,
            timeout: 20000,
          });
          return response.data;
        } catch (error) {
          const status = error.response?.status;

          if (status === 401 && attempt < 3) {
            const connection = await this.getConnection(userId);
            if (connection?.refresh_token) {
              await this.refreshAccessToken(userId, connection);
              continue;
            }
          }

          if ((status === 429 || status === 503) && attempt < 5) {
            const retryAfter = Number(error.response?.headers?.['retry-after']);
            const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(2000 * (2 ** (attempt - 1)), 30000);
            const jitter = Math.floor(Math.random() * 500);
            await sleep(backoffMs + jitter);
            continue;
          }

          throw error;
        }
      }

      throw new Error('Garmin API request failed after retries');
    });
  }

  verifyWebhookSignature(rawBody, headers) {
    if (!this.webhookSecret) return true;
    const signatureHeader = headers[this.webhookSignatureHeader];
    if (!signatureHeader) return false;

    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody || '')
      .digest('hex');

    const normalizedExpected = expected.toLowerCase();
    const normalizedProvided = String(signatureHeader).trim().toLowerCase().replace(/^sha256=/, '');

    if (normalizedExpected.length !== normalizedProvided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(normalizedExpected), Buffer.from(normalizedProvided));
  }

  extractProviderUserId(payload) {
    return (
      payload?.userId ||
      payload?.user_id ||
      payload?.summary?.userId ||
      payload?.summary?.user_id ||
      null
    );
  }

  extractEventTime(payload) {
    return (
      payload?.eventTimestamp ||
      payload?.event_time ||
      payload?.timestamp ||
      payload?.summary?.calendarDate ||
      new Date().toISOString()
    );
  }

  extractEventType(payload) {
    return payload?.eventType || payload?.event_type || 'update';
  }

  extractDataType(payload) {
    return payload?.dataType || payload?.data_type || payload?.summaryType || 'unknown';
  }

  flattenCandidateDocuments(payload) {
    const docs = [];

    if (Array.isArray(payload?.dailies)) {
      for (const daily of payload.dailies) docs.push({ dataType: 'daily_activity', document: daily });
    }
    if (Array.isArray(payload?.epochs)) {
      for (const epoch of payload.epochs) docs.push({ dataType: 'epoch', document: epoch });
    }
    if (Array.isArray(payload?.activities)) {
      for (const activity of payload.activities) docs.push({ dataType: 'workout', document: activity });
    }
    if (Array.isArray(payload?.sleeps)) {
      for (const sleepDoc of payload.sleeps) docs.push({ dataType: 'sleep', document: sleepDoc });
    }
    if (payload?.summary && typeof payload.summary === 'object') {
      docs.push({ dataType: this.extractDataType(payload), document: payload.summary });
    }

    if (docs.length === 0) {
      docs.push({ dataType: this.extractDataType(payload), document: payload });
    }

    return docs;
  }

  extractMetricsFromDocument(dataType, document) {
    const metrics = [];
    const day = document?.calendarDate || document?.day || null;
    const start = toIso(document?.startTimeInSeconds ? document.startTimeInSeconds * 1000 : document?.startTime || document?.start_datetime) || startOfDay(day);
    const end = toIso(document?.endTimeInSeconds ? document.endTimeInSeconds * 1000 : document?.endTime || document?.end_datetime) || endOfDay(day);

    const pushMetric = (metricType, value, unit) => {
      if (!isNumeric(value)) return;
      metrics.push({
        metric_type: metricType,
        value,
        unit,
        start_time: start,
        end_time: end,
      });
    };

    pushMetric('steps', document.steps || document.totalSteps || document.stepCount, 'count');
    pushMetric('active_calories', document.activeCalories || document.activeKilocalories || document.calories, 'kcal');
    pushMetric('distance', document.distanceInMeters || document.distanceMeters || document.distance, 'm');
    pushMetric('heart_rate', document.averageHeartRateInBeatsPerMinute || document.averageHeartRate || document.avgHr, 'bpm');
    pushMetric('resting_heart_rate', document.restingHeartRateInBeatsPerMinute || document.restingHeartRate, 'bpm');
    pushMetric('sleep', (document.sleepDurationInSeconds || document.sleepSeconds || document.durationInSeconds) / 3600, 'hours');
    pushMetric('stress_score', document.stressScore || document.stressLevel, 'score');
    pushMetric('vo2_max', document.vo2Max || document.vo2max, 'ml/kg/min');
    pushMetric('body_battery', document.bodyBatteryMostRecentValue || document.bodyBatteryValue, 'score');

    if (dataType === 'workout') {
      const durationSecs = document.durationInSeconds || document.movingDurationInSeconds;
      if (isNumeric(durationSecs)) {
        pushMetric('workout', durationSecs / 60, 'minutes');
      }
    }

    return metrics;
  }

  async insertMetric(userId, metric, metadata, sourceDocumentId) {
    const result = await db.run(
      `INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time, metadata)
       SELECT $1, 'garmin', $2, $3, $4, $5, $6, $7::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM mobile_health_metrics
         WHERE user_id = $1
           AND source = 'garmin'
           AND metric_type = $2
           AND start_time IS NOT DISTINCT FROM $5
           AND end_time IS NOT DISTINCT FROM $6
           AND metadata->>'garmin_document_id' = $8
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
        String(sourceDocumentId),
      ]
    );

    return result.id || null;
  }

  async persistDocument(userId, dataType, document, eventId, providerUserId) {
    const documentId = String(
      document?.id ||
      document?.activityId ||
      document?.summaryId ||
      document?.calendarDate ||
      eventId
    );

    const day = document?.calendarDate || document?.day || null;
    const start = toIso(document?.startTimeInSeconds ? document.startTimeInSeconds * 1000 : document?.startTime || document?.start_datetime);
    const end = toIso(document?.endTimeInSeconds ? document.endTimeInSeconds * 1000 : document?.endTime || document?.end_datetime);

    await db.run(
      `INSERT INTO garmin_documents (user_id, provider_user_id, data_type, document_id, day, start_time, end_time, raw_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (user_id, data_type, document_id)
       DO UPDATE SET
         provider_user_id = COALESCE(EXCLUDED.provider_user_id, garmin_documents.provider_user_id),
         day = EXCLUDED.day,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         raw_json = EXCLUDED.raw_json,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        providerUserId || null,
        dataType,
        documentId,
        day || null,
        start || null,
        end || null,
        JSON.stringify(document),
      ]
    );

    const metrics = this.extractMetricsFromDocument(dataType, document);
    let insertedMetrics = 0;

    for (const metric of metrics) {
      const metadata = {
        provider: 'garmin',
        garmin_data_type: dataType,
        garmin_document_id: documentId,
        garmin_provider_user_id: providerUserId || null,
        raw_document: document,
      };

      const metricId = await this.insertMetric(userId, metric, metadata, documentId);
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
            source: 'garmin',
            metric_type: metric.metric_type,
            value: metric.value,
            unit: metric.unit,
            start_time: metric.start_time,
            end_time: metric.end_time,
            data_type: dataType,
            document_id: documentId,
            timestamp: new Date().toISOString(),
          }),
        ]
      );
    }

    if (insertedMetrics > 0) {
      await db.run(
        `INSERT INTO webhook_events (user_id, event_type, payload)
         VALUES ($1, 'health_data_changed', $2::jsonb)`,
        [
          userId,
          JSON.stringify({
            source: 'garmin',
            data_type: dataType,
            document_id: documentId,
            metrics_inserted: insertedMetrics,
            timestamp: new Date().toISOString(),
          }),
        ]
      );
    }

    return insertedMetrics;
  }

  async resolveWebhookUser(providerUserId) {
    if (providerUserId) {
      const mapped = await db.get(
        `SELECT user_id
         FROM wearable_connections
         WHERE provider = 'garmin' AND provider_user_id = $1`,
        [String(providerUserId)]
      );
      if (mapped?.user_id) return mapped.user_id;
    }

    const allConnections = await db.all(
      `SELECT user_id
       FROM wearable_connections
       WHERE provider = 'garmin'
       ORDER BY updated_at DESC
       LIMIT 2`
    );

    if (allConnections.length === 1) {
      return allConnections[0].user_id;
    }

    return null;
  }

  async processWebhookPayload(payload, rawBody) {
    const providerUserId = this.extractProviderUserId(payload);
    const eventType = this.extractEventType(payload);
    const dataType = this.extractDataType(payload);
    const eventTime = toIso(this.extractEventTime(payload)) || new Date().toISOString();
    const eventId = String(
      payload?.eventId ||
      payload?.event_id ||
      crypto.createHash('sha256').update(rawBody || JSON.stringify(payload || {})).digest('hex')
    );

    const userId = await this.resolveWebhookUser(providerUserId);
    if (!userId) {
      throw new Error('Unable to map Garmin webhook event to a local user');
    }

    const insertedEvent = await db.run(
      `INSERT INTO garmin_webhook_events (event_id, user_id, provider_user_id, event_type, data_type, event_time, payload, processed)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, false)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [
        eventId,
        userId,
        providerUserId || null,
        eventType,
        dataType,
        eventTime,
        JSON.stringify(payload),
      ]
    );

    if (!insertedEvent.id) {
      return { duplicate: true, userId, eventId };
    }

    try {
      const docs = this.flattenCandidateDocuments(payload);
      let totalMetrics = 0;
      for (const doc of docs) {
        totalMetrics += await this.persistDocument(userId, doc.dataType, doc.document, eventId, providerUserId);
      }

      await db.run(
        `UPDATE garmin_webhook_events SET processed = true, process_error = null WHERE event_id = $1`,
        [eventId]
      );

      if (providerUserId) {
        await db.run(
          `UPDATE wearable_connections
           SET provider_user_id = COALESCE(provider_user_id, $2), updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND provider = 'garmin'`,
          [userId, String(providerUserId)]
        );
      }

      return { success: true, userId, eventId, metricsInserted: totalMetrics };
    } catch (error) {
      await db.run(
        `UPDATE garmin_webhook_events SET processed = false, process_error = $2 WHERE event_id = $1`,
        [eventId, error.message]
      );
      throw error;
    }
  }

  async syncHistoricalData(userId, days = 7) {
    const endpoints = this.pullEndpoints;
    if (endpoints.length === 0) {
      return {
        success: true,
        mode: 'webhook_only',
        message: 'GARMIN_PULL_ENDPOINTS not configured; waiting for webhook events',
        results: [],
      };
    }

    const safeDays = Math.max(1, Math.min(Number(days) || 7, 90));
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - (safeDays * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

    const results = [];
    for (const endpoint of endpoints) {
      try {
        const response = await this.request(userId, 'GET', endpoint, {
          params: { startDate, endDate },
        });

        const docs = Array.isArray(response)
          ? response
          : (Array.isArray(response?.data) ? response.data : [response]);

        let metricsInserted = 0;
        let documentCount = 0;
        for (const doc of docs) {
          if (!doc || typeof doc !== 'object') continue;
          const docType = doc.dataType || doc.data_type || 'manual_pull';
          metricsInserted += await this.persistDocument(userId, docType, doc, `pull-${startDate}-${endDate}`, null);
          documentCount += 1;
        }

        results.push({
          endpoint,
          success: true,
          documents: documentCount,
          metricsInserted,
        });
      } catch (error) {
        results.push({
          endpoint,
          success: false,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      mode: 'pull',
      startDate,
      endDate,
      results,
    };
  }

  async connect(userId, code, stateToken) {
    const tokenData = await this.exchangeCodeForTokens(code, stateToken);
    await this.upsertConnection(userId, tokenData, null);

    return {
      userId,
      tokenType: tokenData.token_type || 'bearer',
      expiresIn: tokenData.expires_in || null,
      scope: tokenData.scope || null,
    };
  }

  async disconnect(userId) {
    await db.run(
      `DELETE FROM wearable_connections
       WHERE user_id = $1 AND provider = 'garmin'`,
      [userId]
    );
  }

  async getStatus(userId) {
    const connection = await this.getConnection(userId);
    const latestEvent = await db.get(
      `SELECT event_id, event_type, data_type, event_time, processed, process_error, created_at
       FROM garmin_webhook_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    const docs = await db.get(
      `SELECT COUNT(*)::int AS count
       FROM garmin_documents
       WHERE user_id = $1`,
      [userId]
    );

    return {
      connected: !!connection,
      providerUserId: connection?.provider_user_id || null,
      expiresAt: connection?.expires_at || null,
      hasRefreshToken: !!connection?.refresh_token,
      webhookEnabled: this.webhookEnabled,
      pullEnabled: this.pullEndpoints.length > 0,
      documentsSynced: docs?.count || 0,
      latestWebhookEvent: latestEvent || null,
    };
  }
}

module.exports = new GarminService();
