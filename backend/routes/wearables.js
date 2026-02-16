const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const db = require('../database');
const fitbitService = require('../services/fitbit');

// ====================
// FITBIT OAUTH & API
// ====================

const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const FITBIT_REDIRECT_URI = process.env.FITBIT_REDIRECT_URI || 'http://localhost:3001/api/wearables/fitbit/callback';
const FITBIT_STATE_SECRET = process.env.FITBIT_STATE_SECRET || process.env.JWT_SECRET || FITBIT_CLIENT_SECRET || 'fitbit-state-secret';
const FITBIT_STATE_MAX_AGE_MS = 15 * 60 * 1000;

function safeJson(value) {
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

function signFitbitState(payloadBase64) {
  return crypto.createHmac('sha256', FITBIT_STATE_SECRET).update(payloadBase64).digest('hex');
}

function buildFitbitState(userId) {
  const payload = {
    userId,
    iat: Date.now(),
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signFitbitState(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function decodeFitbitState(state) {
  if (!state || typeof state !== 'string') return null;
  const [payloadBase64, signature] = state.split('.');
  if (!payloadBase64 || !signature) return null;

  const expectedSignature = signFitbitState(payloadBase64);
  if (signature.length !== expectedSignature.length) return null;

  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  } catch {
    return null;
  }
  if (!isValid) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
    if (!payload?.userId || !payload?.iat) return null;
    if ((Date.now() - payload.iat) > FITBIT_STATE_MAX_AGE_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

// Get Fitbit auth URL
router.get('/fitbit/auth-url', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const scope = 'activity heartrate sleep weight profile oxygen_saturation respiratory_rate temperature';
    const state = buildFitbitState(userId);

    const params = new URLSearchParams({
      client_id: FITBIT_CLIENT_ID,
      response_type: 'code',
      scope: scope,
      redirect_uri: FITBIT_REDIRECT_URI,
      state,
    });

    res.json({
      authUrl: `https://www.fitbit.com/oauth2/authorize?${params.toString()}`
    });
  } catch (err) {
    console.error('Fitbit auth URL error:', err);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// Fitbit OAuth callback
router.get('/fitbit/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    const decodedState = decodeFitbitState(state);
    const userId = decodedState?.userId ? Number.parseInt(String(decodedState.userId), 10) : null;

    if (error) {
      return res.redirect('/settings?fitbit=error&message=' + encodeURIComponent(error));
    }

    if (!code || !userId) {
      return res.redirect('/?fitbit=error&message=invalid_state');
    }

    // Exchange code for tokens
    const tokenResponse = await axios.post('https://api.fitbit.com/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: FITBIT_CLIENT_ID,
        redirect_uri: FITBIT_REDIRECT_URI,
        code: code,
      }),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in, user_id: fitbitUserId } = tokenResponse.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Store tokens
    await db.run(`
      INSERT INTO wearable_connections (user_id, provider, provider_user_id, access_token, refresh_token, expires_at, connected_at)
      VALUES ($1, 'fitbit', $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, provider)
      DO UPDATE SET
        provider_user_id = EXCLUDED.provider_user_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, fitbitUserId, access_token, refresh_token, expiresAt]);

    // Create webhook subscriptions for real-time updates
    try {
      await fitbitService.createAllSubscriptions(userId);
    } catch (subErr) {
      console.error('[Fitbit] Subscription creation failed (non-blocking):', subErr.message);
    }

    // Trigger comprehensive initial sync via the service
    try {
      await fitbitService.syncLatestData(userId, { mode: 'initial', force: true });
    } catch (syncErr) {
      console.error('[Fitbit] Initial sync failed (non-blocking):', syncErr.message);
    }

    res.redirect('/?fitbit=connected');
  } catch (err) {
    console.error('Fitbit callback error:', err);
    res.redirect('/?fitbit=error&message=auth_failed');
  }
});

// Manual trigger Fitbit sync (uses the comprehensive service)
router.post('/fitbit/sync', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);

    const connection = await db.get(`
      SELECT access_token FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);

    if (!connection) {
      return res.status(401).json({ error: 'Fitbit not connected' });
    }

    const result = await fitbitService.syncLatestData(userId, { mode: 'manual', force: true });
    res.json({ success: true, message: 'Fitbit sync completed', data: result.data });
  } catch (err) {
    console.error('Fitbit manual sync error:', err);
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// Fitbit connection status
router.get('/fitbit/status', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const [connection, metricFreshness] = await Promise.all([
      db.get(`
      SELECT provider_user_id, connected_at, updated_at, expires_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]),
      db.get(`
        SELECT MAX(updated_at) AS last_metric_at
        FROM fitbit_daily
        WHERE user_id = $1
      `, [userId]),
    ]);

    res.json({
      connected: !!connection,
      providerUserId: connection?.provider_user_id,
      connectedAt: connection?.connected_at,
      lastSync: connection?.updated_at,
      lastMetricAt: metricFreshness?.last_metric_at || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Disconnect Fitbit
router.post('/fitbit/disconnect', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    await db.run('DELETE FROM wearable_connections WHERE user_id = $1 AND provider = $2', [userId, 'fitbit']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// ====================
// CONNECTED DEVICES LIST
// ====================

router.get('/connected', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);

    const devices = await db.all(`
      SELECT provider, provider_user_id, connected_at, updated_at
      FROM wearable_connections
      WHERE user_id = $1
      ORDER BY connected_at DESC
    `, [userId]);

    // Also check WHOOP connection
    const whoopSettings = await db.get(`
      SELECT whoop_access_token FROM user_settings WHERE user_id = $1
    `, [userId]);

    const allDevices = devices.map(d => ({
      provider: d.provider,
      connected: true,
      connectedAt: d.connected_at,
      lastSync: d.updated_at,
      deprecated: d.provider === 'google_fit'
    }));

    if (whoopSettings?.whoop_access_token) {
      allDevices.push({
        provider: 'whoop',
        connected: true,
        connectedAt: null,
        lastSync: null
      });
    }

    res.json({
      success: true,
      devices: allDevices
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get connected devices' });
  }
});

// ====================
// LATEST WEARABLE DATA
// ====================

router.get('/latest-data', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const today = new Date().toISOString().split('T')[0];

    // Get Fitbit data from dedicated tables
    const [fitbitDaily, fitbitSleep, fitbitWeight] = await Promise.all([
      db.get(`SELECT * FROM fitbit_daily WHERE user_id = $1 AND date = $2`, [userId, today]),
      db.get(`SELECT * FROM fitbit_sleep WHERE user_id = $1 AND date >= ($2::date - INTERVAL '1 day') ORDER BY created_at DESC LIMIT 1`, [userId, today]),
      db.get(`SELECT * FROM fitbit_weight WHERE user_id = $1 ORDER BY date DESC LIMIT 1`, [userId]),
    ]);

    const grouped = {};
    if (fitbitDaily || fitbitSleep || fitbitWeight) {
      grouped.fitbit = {};
      if (fitbitDaily) {
        if (fitbitDaily.steps != null) grouped.fitbit.steps = { value: fitbitDaily.steps, unit: 'count', updatedAt: fitbitDaily.updated_at };
        if (fitbitDaily.calories_active != null) grouped.fitbit.active_calories = { value: fitbitDaily.calories_active, unit: 'kcal', updatedAt: fitbitDaily.updated_at };
        if (fitbitDaily.resting_heart_rate != null) grouped.fitbit.resting_heart_rate = { value: fitbitDaily.resting_heart_rate, unit: 'bpm', updatedAt: fitbitDaily.updated_at };
        if (fitbitDaily.hrv_rmssd != null) grouped.fitbit.hrv = { value: Math.round(fitbitDaily.hrv_rmssd), unit: 'ms', updatedAt: fitbitDaily.updated_at };
        if (fitbitDaily.azm_total != null) grouped.fitbit.active_zone_minutes = { value: fitbitDaily.azm_total, unit: 'minutes', updatedAt: fitbitDaily.updated_at };
        if (fitbitDaily.distance_km != null) grouped.fitbit.distance = { value: fitbitDaily.distance_km, unit: 'km', updatedAt: fitbitDaily.updated_at };
        if (fitbitDaily.floors != null) grouped.fitbit.floors = { value: fitbitDaily.floors, unit: 'count', updatedAt: fitbitDaily.updated_at };
      }
      if (fitbitSleep) {
        grouped.fitbit.sleep = { value: fitbitSleep.minutes_asleep, unit: 'minutes', updatedAt: fitbitSleep.created_at, metadata: { efficiency: fitbitSleep.efficiency } };
      }
      if (fitbitWeight) {
        grouped.fitbit.weight = { value: fitbitWeight.weight_kg, unit: 'kg', updatedAt: fitbitWeight.created_at };
      }
    }

    res.json({ success: true, date: today, data: grouped });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get latest data' });
  }
});

module.exports = router;
