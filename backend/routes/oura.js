const express = require('express');
const ouraService = require('../services/oura');
const { authenticateToken } = require('./auth');
const db = require('../database');

const router = express.Router();

function getUserId(req) {
  return req.user?.userId || req.user?.id;
}

// Public OAuth callback (Oura redirects here)
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'oura_authorization_failed',
        details: error,
      });
    }

    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: 'missing_code_or_state',
      });
    }

    const parsedState = ouraService.parseOAuthState(state);
    if (!parsedState?.userId) {
      return res.status(400).json({
        success: false,
        error: 'invalid_or_expired_state',
      });
    }

    const userId = parsedState.userId;
    const connection = await ouraService.createConnection(userId, code);

    let webhookStatus = { enabled: false };
    try {
      webhookStatus = await ouraService.ensureWebhookSubscriptions();
    } catch (subscriptionError) {
      console.error('[OURA] Failed to ensure webhook subscriptions:', subscriptionError.message);
      webhookStatus = {
        enabled: false,
        error: subscriptionError.message,
      };
    }

    // Kick off historical sync in background so callback remains responsive.
    setImmediate(async () => {
      try {
        await ouraService.syncHistoricalData(userId, 30);
      } catch (syncError) {
        console.error('[OURA] Initial historical sync failed:', syncError.message);
      }
    });

    return res.json({
      success: true,
      message: 'Oura connected successfully',
      connection,
      webhook: webhookStatus,
    });
  } catch (err) {
    console.error('[OURA] OAuth callback error:', err);
    return res.status(500).json({
      success: false,
      error: 'oura_callback_failed',
      details: err.message,
    });
  }
});

// Public webhook verification endpoint (GET challenge)
router.get('/webhook', (req, res) => {
  const { verification_token: verificationToken, challenge } = req.query;
  if (!ouraService.verifyWebhookChallenge(verificationToken)) {
    return res.status(401).json({ error: 'invalid_verification_token' });
  }

  return res.json({ challenge });
});

// Public webhook events endpoint (real-time updates from Oura)
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-oura-signature'];
  const timestamp = req.headers['x-oura-timestamp'];
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (!ouraService.verifyWebhookSignature(rawBody, signature, timestamp)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Ack immediately to keep webhook latency low (<10s requirement from Oura docs).
  res.status(202).json({ accepted: true });

  setImmediate(async () => {
    try {
      await ouraService.processWebhookEvent(req.body);
    } catch (err) {
      console.error('[OURA] Webhook processing failed:', err.message);
    }
  });
});

// Protected endpoints
router.get('/auth-url', authenticateToken, (req, res) => {
  try {
    const userId = getUserId(req);
    const authUrl = ouraService.getAuthorizationUrl(userId);
    res.json({ success: true, authUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const status = await ouraService.getStatus(userId);
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sync', authenticateToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { days = 30, dataTypes = null } = req.body || {};
    const result = await ouraService.syncHistoricalData(userId, days, dataTypes);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/webhook/subscriptions/ensure', authenticateToken, async (_req, res) => {
  try {
    const result = await ouraService.ensureWebhookSubscriptions();
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
      `SELECT id, event_type, data_type, object_id, event_time, processed, process_error, created_at
       FROM oura_webhook_events
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
    await ouraService.disconnect(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
