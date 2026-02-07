const express = require('express');
const db = require('../database');
const garminService = require('../services/garmin');
const { authenticateToken } = require('./auth');

const router = express.Router();

function getUserId(req) {
  return req.user?.userId || req.user?.id;
}

// Public OAuth callback
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'garmin_authorization_failed',
        details: error,
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'missing_code_or_state',
      });
    }

    const parsedState = garminService.parseState(state);
    if (!parsedState?.userId) {
      return res.status(400).json({
        success: false,
        error: 'invalid_or_expired_state',
      });
    }

    const connection = await garminService.connect(parsedState.userId, code, state);

    // Best-effort backfill if pull endpoints are configured.
    setImmediate(async () => {
      try {
        await garminService.syncHistoricalData(parsedState.userId, 7);
      } catch (err) {
        console.error('[GARMIN] Initial sync failed:', err.message);
      }
    });

    return res.json({
      success: true,
      message: 'Garmin connected successfully',
      connection,
    });
  } catch (err) {
    console.error('[GARMIN] OAuth callback error:', err);
    return res.status(500).json({
      success: false,
      error: 'garmin_callback_failed',
      details: err.message,
    });
  }
});

// Public webhook receiver
router.post('/webhook', async (req, res) => {
  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  if (!garminService.verifyWebhookSignature(rawBody, req.headers || {})) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  res.status(202).json({ accepted: true });

  setImmediate(async () => {
    try {
      await garminService.processWebhookPayload(req.body || {}, rawBody);
    } catch (err) {
      console.error('[GARMIN] Webhook processing failed:', err.message);
    }
  });
});

// Protected endpoints
router.get('/auth-url', authenticateToken, (req, res) => {
  try {
    const userId = getUserId(req);
    const authUrl = garminService.getAuthorizationUrl(userId);
    res.json({ success: true, authUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const status = await garminService.getStatus(userId);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { days = 7 } = req.body || {};
    const result = await garminService.syncHistoricalData(userId, days);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/events', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const rows = await db.all(
      `SELECT event_id, event_type, data_type, event_time, processed, process_error, created_at
       FROM garmin_webhook_events
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json({ success: true, count: rows.length, events: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    await garminService.disconnect(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
