const express = require('express');
const router = express.Router();
const db = require('../database');
const { correlateForPlan } = require('../services/workoutVerification');

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

// ====================
// MOBILE HEALTH SYNC
// ====================

function normalizeMobileSource(source) {
  if (source === 'healthkit') return 'apple_healthkit';
  if (source === 'healthconnect') return 'health_connect';
  return source;
}

// Source → table mapping for per-provider routing
const SAMPLES_TABLE = {
  apple_healthkit: 'apple_health_samples_ts',
  health_connect: 'health_connect_samples_ts',
};
const WORKOUTS_TABLE = {
  apple_healthkit: 'apple_health_workouts',
  health_connect: 'health_connect_workouts',
};
const SLEEP_TABLE = {
  apple_healthkit: 'apple_health_sleep',
  health_connect: 'health_connect_sleep',
};

// Metric types that are continuous samples (go to hypertable)
const SAMPLE_TYPES = new Set([
  'heart_rate', 'resting_heart_rate', 'hrv', 'steps', 'active_calories',
  'basal_calories', 'distance', 'flights_climbed', 'spo2', 'respiratory_rate',
  'body_temperature',
]);

// POST /api/mobile/sync - Receive health data from mobile app
// Routes to per-provider tables: hypertables for samples, regular tables for workouts/sleep
router.post('/sync', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const { source, metrics } = req.body;
    const normalizedSource = normalizeMobileSource(source);

    // Validate source — only Apple Health and Health Connect sync via mobile
    const validSources = ['apple_healthkit', 'health_connect'];
    if (!validSources.includes(normalizedSource)) {
      return res.status(400).json({ error: 'Invalid source. Use apple_healthkit or health_connect.' });
    }

    if (!Array.isArray(metrics) || metrics.length === 0) {
      return res.status(400).json({ error: 'No metrics provided' });
    }

    // Filter valid metrics
    const validMetrics = metrics.filter(m => m?.type && m?.value != null && m?.startTime);
    if (validMetrics.length === 0) {
      return res.status(400).json({ error: 'No valid metrics (each needs type, value, startTime)' });
    }

    let insertedCount = 0;

    // Split metrics by destination
    const sampleMetrics = validMetrics.filter(m => SAMPLE_TYPES.has(m.type));
    const workoutMetrics = validMetrics.filter(m => m.type === 'workout');
    const sleepMetrics = validMetrics.filter(m => m.type === 'sleep');

    // 1. Batch insert continuous samples into provider-specific hypertable
    const samplesTable = SAMPLES_TABLE[normalizedSource];
    const BATCH_SIZE = 1000;

    for (let i = 0; i < sampleMetrics.length; i += BATCH_SIZE) {
      const batch = sampleMetrics.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIdx = 1;

      for (const metric of batch) {
        values.push(`($${paramIdx}, $${paramIdx+1}, $${paramIdx+2}, $${paramIdx+3}, $${paramIdx+4}, $${paramIdx+5})`);
        params.push(
          metric.startTime,                                         // time
          userId,                                                    // user_id
          metric.type,                                               // metric_type
          Number(metric.value),                                      // value
          metric.unit || null,                                       // unit
          metric.metadata ? JSON.stringify(metric.metadata) : null   // metadata
        );
        paramIdx += 6;
      }

      const result = await db.query(
        `INSERT INTO ${samplesTable} (time, user_id, metric_type, value, unit, metadata)
         VALUES ${values.join(', ')}
         ON CONFLICT (user_id, metric_type, time) DO NOTHING`,
        params
      );
      insertedCount += result.rowCount || 0;
    }

    // 2. Insert workouts into provider-specific workout table
    const workoutsTable = WORKOUTS_TABLE[normalizedSource];
    for (const wk of workoutMetrics) {
      const meta = wk.metadata || {};
      const isApple = normalizedSource === 'apple_healthkit';
      try {
        const result = await db.query(
          `INSERT INTO ${workoutsTable}
           (user_id, workout_type, start_time, end_time, duration_seconds, ${isApple ? 'total_calories, active_calories, distance_meters, avg_heart_rate, max_heart_rate,' : 'total_calories,'} metadata)
           VALUES ($1, $2, $3, $4, $5, ${isApple ? '$6, $7, $8, $9, $10, $11' : '$6, $7'})
           ON CONFLICT (user_id, workout_type, start_time) DO NOTHING`,
          isApple ? [
            userId,
            meta.workoutType || meta.workout_type || 'Unknown',
            wk.startTime,
            wk.endTime || null,
            meta.duration || null,
            meta.totalCalories || meta.total_calories || Number(wk.value) || null,
            meta.activeCalories || meta.active_calories || null,
            meta.distance || meta.distance_meters || null,
            meta.avgHeartRate || meta.avg_heart_rate || null,
            meta.maxHeartRate || meta.max_heart_rate || null,
            JSON.stringify(meta),
          ] : [
            userId,
            meta.workoutType || meta.workout_type || 'Unknown',
            wk.startTime,
            wk.endTime || null,
            meta.duration || null,
            meta.totalCalories || meta.total_calories || Number(wk.value) || null,
            JSON.stringify(meta),
          ]
        );
        insertedCount += result.rowCount || 0;
      } catch (e) { /* duplicate, skip */ }
    }

    // 3. Insert sleep sessions into provider-specific sleep table
    const sleepTable = SLEEP_TABLE[normalizedSource];
    for (const sl of sleepMetrics) {
      const meta = sl.metadata || {};
      const isApple = normalizedSource === 'apple_healthkit';
      try {
        const result = await db.query(
          `INSERT INTO ${sleepTable}
           (user_id, start_time, end_time, total_hours${isApple ? ', deep_hours, rem_hours, core_hours, awake_hours' : ''}, metadata)
           VALUES ($1, $2, $3, $4${isApple ? ', $5, $6, $7, $8, $9' : ', $5'})
           ON CONFLICT (user_id, start_time) DO NOTHING`,
          isApple ? [
            userId,
            sl.startTime,
            sl.endTime || null,
            Number(sl.value) || null,
            meta.deepHours || meta.deep_hours || null,
            meta.remHours || meta.rem_hours || null,
            meta.coreHours || meta.core_hours || null,
            meta.awakeHours || meta.awake_hours || null,
            JSON.stringify(meta),
          ] : [
            userId,
            sl.startTime,
            sl.endTime || null,
            Number(sl.value) || null,
            JSON.stringify(meta),
          ]
        );
        insertedCount += result.rowCount || 0;
      } catch (e) { /* duplicate, skip */ }
    }

    // AI feed queue — one entry per sync batch
    if (insertedCount > 0) {
      const typeSummary = {};
      validMetrics.forEach(m => { typeSummary[m.type] = (typeSummary[m.type] || 0) + 1; });
      await db.run(
        `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
         VALUES ($1, $2, 0, 'health_sync', $3)`,
        [
          userId,
          samplesTable,
          JSON.stringify({
            source: normalizedSource,
            metrics_count: insertedCount,
            types: typeSummary,
            timestamp: new Date().toISOString()
          })
        ]
      );

      await db.run(
        `INSERT INTO webhook_events (user_id, event_type, payload)
         VALUES ($1, 'health_data_changed', $2)`,
        [
          userId,
          JSON.stringify({ source: normalizedSource, metrics_count: insertedCount, types: Object.keys(typeSummary) })
        ]
      );
    }

    // Trigger workout verification if workout data was synced
    if (workoutMetrics.length > 0) {
      try {
        const activePlans = await db.all(
          `SELECT wp.id FROM weekly_plans wp
           JOIN plan_assignments pa ON pa.plan_id = wp.id
           WHERE (pa.user_id = $1 OR pa.user_id IS NULL)
             AND wp.week_start <= CURRENT_DATE
             AND wp.week_start + INTERVAL '7 days' > CURRENT_DATE
             AND wp.is_active = true`,
          [userId]
        );
        for (const plan of activePlans) {
          await correlateForPlan(userId, plan.id);
        }
      } catch (verifyErr) {
        console.error('Workout verification error (non-blocking):', verifyErr);
      }
    }

    res.json({
      success: true,
      message: `Synced ${insertedCount} metrics (${validMetrics.length} received, duplicates skipped)`,
      inserted: insertedCount,
      received: validMetrics.length
    });

  } catch (err) {
    console.error('Mobile health sync error:', err);
    res.status(500).json({ error: 'Failed to sync health data' });
  }
});

// ====================
// AI FEED ENDPOINTS
// ====================

// GET /api/mobile/health/ai-feed - Get unprocessed data for AI
router.get('/ai-feed', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const { limit = 50, markProcessed = true } = req.query;
    
    // Get unprocessed items
    const items = await db.all(`
      SELECT * FROM ai_feed_queue 
      WHERE user_id = $1 AND processed = false
      ORDER BY created_at ASC
      LIMIT $2
    `, [userId, parseInt(limit)]);
    
    // Mark as processed if requested
    if (markProcessed === 'true' && items.length > 0) {
      const ids = items.map(i => i.id);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      await db.run(`
        UPDATE ai_feed_queue 
        SET processed = true, processed_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders})
      `, ids);
    }
    
    res.json({
      success: true,
      count: items.length,
      items: items.map(item => ({
        ...item,
        data: safeJson(item.data_json)
      }))
    });
    
  } catch (err) {
    console.error('AI feed error:', err);
    res.status(500).json({ error: 'Failed to get AI feed' });
  }
});

// GET /api/mobile/health/ai-feed/stats - Get feed statistics
router.get('/ai-feed/stats', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    
    const stats = await db.get(`
      SELECT 
        COUNT(CASE WHEN processed = false THEN 1 END) as unprocessed_count,
        COUNT(CASE WHEN processed = true THEN 1 END) as processed_count,
        COUNT(*) as total_count
      FROM ai_feed_queue 
      WHERE user_id = $1
    `, [userId]);
    
    const typeBreakdown = await db.all(`
      SELECT data_type, COUNT(*) as count
      FROM ai_feed_queue 
      WHERE user_id = $1 AND processed = false
      GROUP BY data_type
    `, [userId]);
    
    res.json({
      success: true,
      stats: {
        ...stats,
        unprocessed_by_type: typeBreakdown
      }
    });
    
  } catch (err) {
    console.error('AI feed stats error:', err);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ====================
// WEBHOOK ENDPOINTS
// ====================

// POST /api/mobile/health/webhook/subscribe - Subscribe to webhooks
router.post('/webhook/subscribe', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const { url, events } = req.body;
    
    // Store webhook subscription (for future implementation)
    // For now, just acknowledge
    res.json({
      success: true,
      message: 'Webhook subscription registered',
      url,
      events
    });
    
  } catch (err) {
    console.error('Webhook subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// GET /api/mobile/health/webhook/events - Get recent webhook events
router.get('/webhook/events', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const { limit = 20 } = req.query;
    
    const events = await db.all(`
      SELECT * FROM webhook_events 
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, parseInt(limit)]);
    
    res.json({
      success: true,
      events: events.map(e => ({
        ...e,
        payload: safeJson(e.payload)
      }))
    });
    
  } catch (err) {
    console.error('Get webhook events error:', err);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

module.exports = router;
