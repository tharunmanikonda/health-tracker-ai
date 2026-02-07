const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../database');
const fitbitService = require('../services/fitbit');

// ====================
// FITBIT OAUTH & API
// ====================

const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const FITBIT_REDIRECT_URI = process.env.FITBIT_REDIRECT_URI || 'http://localhost:3001/api/wearables/fitbit/callback';

// Get Fitbit auth URL
router.get('/fitbit/auth-url', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const scope = 'activity heartrate sleep weight profile oxygen_saturation respiratory_rate temperature';

    const params = new URLSearchParams({
      client_id: FITBIT_CLIENT_ID,
      response_type: 'code',
      scope: scope,
      redirect_uri: FITBIT_REDIRECT_URI,
      state: userId.toString(),
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
    const userId = parseInt(state);

    if (error) {
      return res.redirect('/settings?fitbit=error&message=' + encodeURIComponent(error));
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
      await fitbitService.syncLatestData(userId);
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

    const result = await fitbitService.syncLatestData(userId);
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
    const connection = await db.get(`
      SELECT provider_user_id, connected_at, updated_at, expires_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);

    res.json({
      connected: !!connection,
      providerUserId: connection?.provider_user_id,
      connectedAt: connection?.connected_at,
      lastSync: connection?.updated_at
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
// GOOGLE FIT / WEAR OS
// ====================
// NOTE: Google Fit REST API is deprecated (shutdown June 2025).
// Keeping for existing connections. New users should use Fitbit or Health Connect via mobile app.

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/wearables/google/callback';

// Get Google auth URL
router.get('/google/auth-url', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const scope = 'https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.body.read https://www.googleapis.com/auth/fitness.sleep.read https://www.googleapis.com/auth/fitness.heart_rate.read';

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: scope,
      access_type: 'offline',
      prompt: 'consent',
      state: userId.toString(),
    });

    res.json({
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      deprecated: true,
      message: 'Google Fit REST API is deprecated. Consider using Fitbit or Health Connect via the mobile app.'
    });
  } catch (err) {
    console.error('Google auth URL error:', err);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
});

// Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    const userId = parseInt(state);

    if (error) {
      return res.redirect('/?google=error&message=' + encodeURIComponent(error));
    }

    // Exchange code for tokens
    const tokenResponse = await axios.post('https://oauth2.googleapis.com/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        code: code,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Store tokens
    await db.run(`
      INSERT INTO wearable_connections (user_id, provider, access_token, refresh_token, expires_at, connected_at)
      VALUES ($1, 'google_fit', $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, provider)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, access_token, refresh_token, expiresAt]);

    // Trigger initial sync
    await syncGoogleFitData(userId, access_token);

    res.redirect('/?google=connected');
  } catch (err) {
    console.error('Google callback error:', err);
    res.redirect('/?google=error&message=auth_failed');
  }
});

// Helper to upsert Google Fit metric (delete + insert to prevent duplicates)
async function upsertGoogleMetric(userId, metricType, value, unit, date) {
  await db.run(`
    DELETE FROM mobile_health_metrics
    WHERE user_id = $1 AND source = 'google_fit' AND metric_type = $2
      AND start_time::date = $3::date
  `, [userId, metricType, date]);

  await db.run(`
    INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
    VALUES ($1, 'google_fit', $2, $3, $4, $5, $5)
  `, [userId, metricType, value, unit, date]);

  // Push to AI feed
  await db.run(`
    INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
    VALUES ($1, 'mobile_health_metrics', 0, $2, $3)
  `, [userId, metricType, JSON.stringify({
    source: 'google_fit',
    type: metricType,
    value,
    unit,
    timestamp: new Date().toISOString()
  })]);
}

// Sync Google Fit data (with upsert to prevent duplicates)
async function syncGoogleFitData(userId, accessToken) {
  try {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = new Date().toISOString().split('T')[0];

    const fetchDataset = async (dataSourceId) => {
      try {
        const res = await axios.post(
          `https://fitness.googleapis.com/fitness/v1/users/me/dataset:aggregate`,
          {
            aggregateBy: [{ dataSourceId }],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: startOfDay.getTime(),
            endTimeMillis: now,
          },
          {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );
        return res.data;
      } catch (e) {
        return null;
      }
    };

    // Steps
    const stepsData = await fetchDataset('derived:com.google.step_count.delta:com.google.android.gms:merged');
    if (stepsData?.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.intVal) {
      const steps = stepsData.bucket[0].dataset[0].point[0].value[0].intVal;
      await upsertGoogleMetric(userId, 'steps', steps, 'count', today);
    }

    // Calories
    const caloriesData = await fetchDataset('derived:com.google.calories.expended:com.google.android.gms:merged');
    if (caloriesData?.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal) {
      const calories = Math.round(caloriesData.bucket[0].dataset[0].point[0].value[0].fpVal);
      await upsertGoogleMetric(userId, 'active_calories', calories, 'kcal', today);
    }

    // Heart rate
    const hrData = await fetchDataset('derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm');
    if (hrData?.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal) {
      const hr = Math.round(hrData.bucket[0].dataset[0].point[0].value[0].fpVal);
      await upsertGoogleMetric(userId, 'heart_rate', hr, 'bpm', today);
    }

    // Sleep
    const sleepData = await fetchDataset('derived:com.google.sleep.segment:com.google.android.gms:merged');
    if (sleepData?.bucket?.[0]?.dataset?.[0]?.point) {
      const sleepPoints = sleepData.bucket[0].dataset[0].point;
      let totalSleepMinutes = 0;

      for (const point of sleepPoints) {
        const start = parseInt(point.startTimeNanos) / 1000000;
        const end = parseInt(point.endTimeNanos) / 1000000;
        totalSleepMinutes += (end - start) / (1000 * 60);
      }

      if (totalSleepMinutes > 0) {
        await upsertGoogleMetric(userId, 'sleep', Math.round(totalSleepMinutes), 'minutes', today);
      }
    }

    console.log('[Google Fit] Sync completed for user', userId);
  } catch (err) {
    console.error('Google Fit sync error:', err);
    throw err;
  }
}

// Manual trigger Google Fit sync
router.post('/google/sync', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);

    const connection = await db.get(`
      SELECT access_token, refresh_token, expires_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'google_fit'
    `, [userId]);

    if (!connection) {
      return res.status(401).json({ error: 'Google Fit not connected' });
    }

    // Refresh if needed
    if (new Date(connection.expires_at) < new Date()) {
      const refreshRes = await axios.post('https://oauth2.googleapis.com/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: connection.refresh_token,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );

      const { access_token, expires_in } = refreshRes.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      await db.run(`
        UPDATE wearable_connections
        SET access_token = $1, expires_at = $2, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $3 AND provider = 'google_fit'
      `, [access_token, expiresAt, userId]);

      await syncGoogleFitData(userId, access_token);
    } else {
      await syncGoogleFitData(userId, connection.access_token);
    }

    res.json({ success: true, message: 'Google Fit sync completed' });
  } catch (err) {
    console.error('Google Fit manual sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Google Fit connection status
router.get('/google/status', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const connection = await db.get(`
      SELECT connected_at, updated_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'google_fit'
    `, [userId]);

    res.json({
      connected: !!connection,
      connectedAt: connection?.connected_at,
      lastSync: connection?.updated_at,
      deprecated: true,
      message: 'Google Fit API is deprecated. Consider using Fitbit or Health Connect via mobile app.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Disconnect Google Fit
router.post('/google/disconnect', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    await db.run('DELETE FROM wearable_connections WHERE user_id = $1 AND provider = $2', [userId, 'google_fit']);
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

    // Get latest metrics from all wearable sources
    const metrics = await db.all(`
      SELECT source, metric_type, value, unit, metadata, created_at
      FROM mobile_health_metrics
      WHERE user_id = $1 AND start_time::date = $2::date
      AND source IN ('fitbit', 'google_fit', 'google_wear_os')
      ORDER BY created_at DESC
    `, [userId, today]);

    // Group by source
    const grouped = {};
    for (const m of metrics) {
      if (!grouped[m.source]) grouped[m.source] = {};
      grouped[m.source][m.metric_type] = {
        value: m.value,
        unit: m.unit,
        metadata: m.metadata ? JSON.parse(m.metadata) : null,
        updatedAt: m.created_at
      };
    }

    res.json({ success: true, date: today, data: grouped });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get latest data' });
  }
});

module.exports = router;
