const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../database');

// ====================
// FITBIT OAUTH & API
// ====================

const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID;
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET;
const FITBIT_REDIRECT_URI = process.env.FITBIT_REDIRECT_URI || 'http://localhost:3001/api/wearables/fitbit/callback';

// Get Fitbit auth URL
router.get('/fitbit/auth-url', async (req, res) => {
  try {
    const userId = req.user.id;
    const scope = 'activity heartrate sleep nutrition weight profile';
    
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
    
    // Trigger initial sync
    await syncFitbitData(userId, access_token);
    
    res.redirect('/settings?fitbit=connected');
  } catch (err) {
    console.error('Fitbit callback error:', err);
    res.redirect('/settings?fitbit=error&message=auth_failed');
  }
});

// Sync Fitbit data
async function syncFitbitData(userId, accessToken) {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get activity data
    const activityRes = await axios.get(`https://api.fitbit.com/1/user/-/activities/date/${today}.json`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const activity = activityRes.data;
    
    // Insert steps
    if (activity.summary?.steps) {
      await db.run(`
        INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
        VALUES ($1, 'fitbit', 'steps', $2, 'count', CURRENT_DATE, CURRENT_DATE)
      `, [userId, activity.summary.steps]);
    }
    
    // Insert calories
    if (activity.summary?.caloriesOut) {
      await db.run(`
        INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
        VALUES ($1, 'fitbit', 'active_calories', $2, 'kcal', CURRENT_DATE, CURRENT_DATE)
      `, [userId, activity.summary.caloriesOut]);
    }
    
    // Insert distance
    if (activity.summary?.distances?.[0]?.distance) {
      await db.run(`
        INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
        VALUES ($1, 'fitbit', 'distance', $2, 'km', CURRENT_DATE, CURRENT_DATE)
      `, [userId, activity.summary.distances[0].distance]);
    }
    
    // Get heart rate
    try {
      const hrRes = await axios.get(`https://api.fitbit.com/1/user/-/activities/heart/date/${today}/1d.json`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      const restingHR = hrRes.data?.['activities-heart']?.[0]?.value?.restingHeartRate;
      if (restingHR) {
        await db.run(`
          INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
          VALUES ($1, 'fitbit', 'resting_heart_rate', $2, 'bpm', CURRENT_DATE, CURRENT_DATE)
        `, [userId, restingHR]);
      }
    } catch (e) {
      console.log('Fitbit HR not available');
    }
    
    // Get sleep
    try {
      const sleepRes = await axios.get(`https://api.fitbit.com/1.2/user/-/sleep/date/${today}.json`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      const sleep = sleepRes.data?.sleep?.[0];
      if (sleep) {
        await db.run(`
          INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time, metadata)
          VALUES ($1, 'fitbit', 'sleep', $2, 'minutes', $3, $4, $5)
        `, [
          userId, 
          sleep.minutesAsleep,
          sleep.startTime,
          sleep.endTime,
          JSON.stringify({ efficiency: sleep.efficiency, stages: sleep.stages })
        ]);
      }
    } catch (e) {
      console.log('Fitbit sleep not available');
    }
    
    console.log('[Fitbit] Sync completed for user', userId);
  } catch (err) {
    console.error('Fitbit sync error:', err);
    throw err;
  }
}

// Manual trigger Fitbit sync
router.post('/fitbit/sync', async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get stored token
    const connection = await db.get(`
      SELECT access_token, refresh_token, expires_at 
      FROM wearable_connections 
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);
    
    if (!connection) {
      return res.status(401).json({ error: 'Fitbit not connected' });
    }
    
    // Check if token expired and refresh if needed
    if (new Date(connection.expires_at) < new Date()) {
      // Refresh token
      const refreshRes = await axios.post('https://api.fitbit.com/oauth2/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refresh_token,
        }),
        {
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      
      const { access_token, refresh_token, expires_in } = refreshRes.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);
      
      await db.run(`
        UPDATE wearable_connections 
        SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $4 AND provider = 'fitbit'
      `, [access_token, refresh_token, expiresAt, userId]);
      
      await syncFitbitData(userId, access_token);
    } else {
      await syncFitbitData(userId, connection.access_token);
    }
    
    res.json({ success: true, message: 'Fitbit sync completed' });
  } catch (err) {
    console.error('Fitbit manual sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Disconnect Fitbit
router.post('/fitbit/disconnect', async (req, res) => {
  try {
    const userId = req.user.id;
    await db.run('DELETE FROM wearable_connections WHERE user_id = $1 AND provider = $2', [userId, 'fitbit']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// ====================
// GOOGLE FIT / WEAR OS
// ====================

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/wearables/google/callback';

// Get Google auth URL
router.get('/google/auth-url', async (req, res) => {
  try {
    const userId = req.user.id;
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
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
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
      return res.redirect('/settings?google=error&message=' + encodeURIComponent(error));
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
      VALUES ($1, 'google_fit', 'google_user', $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, provider) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, access_token, refresh_token, expiresAt]);
    
    // Trigger initial sync
    await syncGoogleFitData(userId, access_token);
    
    res.redirect('/settings?google=connected');
  } catch (err) {
    console.error('Google callback error:', err);
    res.redirect('/settings?google=error&message=auth_failed');
  }
});

// Sync Google Fit data
async function syncGoogleFitData(userId, accessToken) {
  try {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTimeNanos = startOfDay.getTime() * 1000000;
    const endTimeNanos = now * 1000000;
    
    // Helper to fetch data source
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
      await db.run(`
        INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
        VALUES ($1, 'google_fit', 'steps', $2, 'count', CURRENT_DATE, CURRENT_DATE)
      `, [userId, steps]);
    }
    
    // Calories
    const caloriesData = await fetchDataset('derived:com.google.calories.expended:com.google.android.gms:merged');
    if (caloriesData?.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal) {
      const calories = Math.round(caloriesData.bucket[0].dataset[0].point[0].value[0].fpVal);
      await db.run(`
        INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
        VALUES ($1, 'google_fit', 'active_calories', $2, 'kcal', CURRENT_DATE, CURRENT_DATE)
      `, [userId, calories]);
    }
    
    // Heart rate
    const hrData = await fetchDataset('derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm');
    if (hrData?.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal) {
      const hr = hrData.bucket[0].dataset[0].point[0].value[0].fpVal;
      await db.run(`
        INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
        VALUES ($1, 'google_fit', 'heart_rate', $2, 'bpm', CURRENT_DATE, CURRENT_DATE)
      `, [userId, Math.round(hr)]);
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
        await db.run(`
          INSERT INTO mobile_health_metrics (user_id, source, metric_type, value, unit, start_time, end_time)
          VALUES ($1, 'google_fit', 'sleep', $2, 'minutes', CURRENT_DATE, CURRENT_DATE)
        `, [userId, Math.round(totalSleepMinutes)]);
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
    const userId = req.user.id;
    
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

// Disconnect Google Fit
router.post('/google/disconnect', async (req, res) => {
  try {
    const userId = req.user.id;
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
    const userId = req.user.id;
    
    const devices = await db.all(`
      SELECT provider, connected_at, updated_at
      FROM wearable_connections
      WHERE user_id = $1
      ORDER BY connected_at DESC
    `, [userId]);
    
    res.json({
      success: true,
      devices: devices.map(d => ({
        provider: d.provider,
        connected: true,
        connectedAt: d.connected_at,
        lastSync: d.updated_at
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get connected devices' });
  }
});

module.exports = router;
