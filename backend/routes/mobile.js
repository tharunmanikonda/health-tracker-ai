const express = require('express');
const router = express.Router();
const db = require('../database');

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

function isSameMetric(existing, incoming) {
  if (!existing) return false;
  const existingValue = Number(existing.value);
  const incomingValue = Number(incoming.value);
  if (!Number.isFinite(existingValue) || !Number.isFinite(incomingValue)) return false;

  const existingMetadata = safeJson(existing.metadata);
  const incomingMetadata = incoming.metadata || null;

  return (
    existingValue === incomingValue &&
    (existing.unit || null) === (incoming.unit || null) &&
    JSON.stringify(existingMetadata || null) === JSON.stringify(incomingMetadata)
  );
}

// POST /api/mobile/sync - Receive health data from mobile app
router.post('/sync', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const { source, metrics } = req.body;
    const normalizedSource = normalizeMobileSource(source);
    
    // Validate source
    const validSources = ['apple_healthkit', 'samsung_health', 'health_connect', 'google_fit', 'fitbit', 'google_wear_os'];
    if (!validSources.includes(normalizedSource)) {
      return res.status(400).json({ error: 'Invalid source' });
    }
    
    if (!Array.isArray(metrics) || metrics.length === 0) {
      return res.status(400).json({ error: 'No metrics provided' });
    }
    
    const insertedIds = [];
    
    for (const metric of metrics) {
      if (!metric?.type || metric?.value == null) continue;

      const startTime = metric.startTime || null;
      const endTime = metric.endTime || null;
      const metadata = metric.metadata || null;

      const existing = await db.get(
        `SELECT id, value, unit, metadata
         FROM mobile_health_metrics
         WHERE user_id = $1
           AND source = $2
           AND metric_type = $3
           AND start_time IS NOT DISTINCT FROM $4::timestamp
           AND end_time IS NOT DISTINCT FROM $5::timestamp
         LIMIT 1`,
        [userId, normalizedSource, metric.type, startTime, endTime]
      );

      if (isSameMetric(existing, metric)) {
        insertedIds.push(existing.id);
        continue;
      }

      if (existing?.id) {
        await db.run('DELETE FROM mobile_health_metrics WHERE id = $1', [existing.id]);
      }

      const result = await db.run(
        `INSERT INTO mobile_health_metrics 
         (user_id, source, metric_type, value, unit, start_time, end_time, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          userId,
          normalizedSource,
          metric.type,
          Number(metric.value),
          metric.unit || null,
          startTime,
          endTime,
          metadata ? JSON.stringify(metadata) : null
        ]
      );
      
      insertedIds.push(result.id);
      
      // Add to AI feed queue
      await db.run(
        `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
         VALUES ($1, 'mobile_health_metrics', $2, $3, $4)`,
        [
          userId,
          result.id,
          metric.type,
          JSON.stringify({
            source: normalizedSource,
            type: metric.type,
            value: metric.value,
            unit: metric.unit,
            startTime: metric.startTime,
            endTime: metric.endTime,
            timestamp: new Date().toISOString()
          })
        ]
      );
      
      // Log webhook event
      await db.run(
        `INSERT INTO webhook_events (user_id, event_type, payload)
         VALUES ($1, 'health_data_changed', $2)`,
        [
          userId,
          JSON.stringify({ source: normalizedSource, type: metric.type, value: metric.value })
        ]
      );
    }
    
    res.json({
      success: true,
      message: `Synced ${insertedIds.length} metrics`,
      insertedIds
    });
    
  } catch (err) {
    console.error('Mobile health sync error:', err);
    res.status(500).json({ error: 'Failed to sync health data' });
  }
});

// GET /api/mobile/health/latest - Get latest health metrics
router.get('/latest', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const { since, types } = req.query;
    
    let query = `
      SELECT * FROM mobile_health_metrics 
      WHERE user_id = $1
    `;
    const params = [userId];
    
    if (since) {
      query += ` AND created_at > $${params.length + 1}`;
      params.push(since);
    }
    
    if (types) {
      const typeList = types.split(',');
      query += ` AND metric_type IN (${typeList.map((_, i) => `$${params.length + i + 1}`).join(',')})`;
      params.push(...typeList);
    }
    
    query += ` ORDER BY created_at DESC LIMIT 100`;
    
    const metrics = await db.all(query, params);
    
    res.json({
      success: true,
      count: metrics.length,
      metrics: metrics.map(m => ({
        ...m,
        metadata: safeJson(m.metadata)
      }))
    });
    
  } catch (err) {
    console.error('Get latest health error:', err);
    res.status(500).json({ error: 'Failed to get health data' });
  }
});

// GET /api/mobile/health/summary - Get today's summary
router.get('/summary', async (req, res) => {
  try {
    const userId = (req.user.userId || req.user.id);
    const today = new Date().toISOString().split('T')[0];
    
    const summary = await db.get(`
      SELECT 
        COALESCE(SUM(CASE WHEN metric_type = 'steps' THEN value ELSE 0 END), 0) as total_steps,
        COALESCE(SUM(CASE WHEN metric_type = 'active_calories' THEN value ELSE 0 END), 0) as total_active_calories,
        COALESCE(SUM(CASE WHEN metric_type = 'distance' THEN value ELSE 0 END), 0) as total_distance,
        COALESCE(AVG(CASE WHEN metric_type = 'heart_rate' THEN value END), 0) as avg_heart_rate,
        COALESCE(MAX(CASE WHEN metric_type = 'heart_rate' THEN value END), 0) as max_heart_rate,
        COUNT(CASE WHEN metric_type = 'workout' THEN 1 END) as workout_count
      FROM mobile_health_metrics 
      WHERE user_id = $1 
      AND start_time::date = CURRENT_DATE
    `, [userId]);
    
    // Get sleep data if available
    const sleepData = await db.get(`
      SELECT 
        SUM(CASE 
          WHEN end_time IS NOT NULL AND start_time IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
          ELSE value 
        END) as total_sleep_hours
      FROM mobile_health_metrics 
      WHERE user_id = $1 
      AND metric_type = 'sleep'
      AND start_time::date >= CURRENT_DATE - INTERVAL '1 day'
    `, [userId]);
    
    res.json({
      success: true,
      date: today,
      summary: {
        ...summary,
        total_sleep_hours: sleepData?.total_sleep_hours || 0
      }
    });
    
  } catch (err) {
    console.error('Get summary error:', err);
    res.status(500).json({ error: 'Failed to get summary' });
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
