const express = require('express');
const router = express.Router();
const fitbitService = require('../services/fitbit');
const db = require('../database');

// ========================
// FITBIT WEBHOOK ENDPOINTS
// ========================
// These routes are PUBLIC (no auth middleware) because Fitbit calls them directly.
// Security is handled via signature verification and owner/subscription checks.

function toDateString(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function extractUserIdFromSubscription(subscriptionId) {
  const match = String(subscriptionId || '').match(/^user-(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function resolveUserId(ownerId, subscriptionId) {
  const bySubscription = extractUserIdFromSubscription(subscriptionId);
  if (bySubscription) {
    const strictMatch = await db.get(`
      SELECT user_id
      FROM wearable_connections
      WHERE user_id = $1
        AND provider = 'fitbit'
        AND provider_user_id = $2
    `, [bySubscription, String(ownerId || '')]);
    if (strictMatch) return strictMatch.user_id;
  }

  // Fallback by Fitbit owner ID if subscription ID is missing/unexpected.
  const byOwner = await db.get(`
    SELECT user_id
    FROM wearable_connections
    WHERE provider = 'fitbit'
      AND provider_user_id = $1
    LIMIT 1
  `, [String(ownerId || '')]);

  return byOwner?.user_id || null;
}

// Fitbit subscriber verification endpoint
// Fitbit sends 2 GET requests: one with correct verify code (expect 204), one with wrong (expect 404)
router.get('/', (req, res) => {
  const verifyCode = req.query.verify;
  const expectedCode = process.env.FITBIT_VERIFY_CODE;

  if (!expectedCode) {
    console.error('[Fitbit Webhook] FITBIT_VERIFY_CODE not set in environment');
    return res.status(404).send();
  }

  if (verifyCode === expectedCode) {
    console.log('[Fitbit Webhook] Verification successful');
    return res.status(204).send();
  }

  console.log('[Fitbit Webhook] Verification failed (expected for second check)');
  return res.status(404).send();
});

// Fitbit notification handler
// Receives JSON array of notifications when user data changes
router.post('/', async (req, res) => {
  const rawBody = typeof req.rawBody === 'string'
    ? req.rawBody
    : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null);
  const signature = req.headers['x-fitbit-signature'];

  if (!rawBody || !signature) {
    console.error('[Fitbit Webhook] Missing raw body or signature');
    return res.status(404).send();
  }

  const isValidSignature = fitbitService.verifyWebhookSignature(rawBody, signature);
  if (!isValidSignature) {
    console.error('[Fitbit Webhook] Invalid signature');
    return res.status(404).send();
  }

  let notifications;
  try {
    notifications = JSON.parse(rawBody);
  } catch (err) {
    console.error('[Fitbit Webhook] Invalid JSON payload:', err.message);
    return res.status(400).send();
  }

  if (!Array.isArray(notifications)) {
    console.error('[Fitbit Webhook] Invalid notification format');
    return res.status(400).send();
  }

  // Must respond quickly (<5s) to avoid subscriber disablement.
  res.status(204).send();

  setImmediate(async () => {
    console.log(`[Fitbit Webhook] Received ${notifications.length} notifications`);

    for (const notification of notifications) {
      const collectionType = notification?.collectionType;
      const date = notification?.date || toDateString();
      const ownerId = notification?.ownerId;
      const subscriptionId = notification?.subscriptionId;

      try {
        const userId = await resolveUserId(ownerId, subscriptionId);
        if (!userId) {
          console.log('[Fitbit Webhook] Could not resolve user', { ownerId, subscriptionId });
          continue;
        }

        await db.run(`
          INSERT INTO webhook_events (user_id, event_type, payload)
          VALUES ($1, $2, $3)
        `, [userId, `fitbit.${collectionType || 'unknown'}.updated`, JSON.stringify(notification)]);

        if (!collectionType) continue;

        await fitbitService.syncCollectionForDate(userId, collectionType, date);
        await fitbitService.markConnectionSync(userId);
      } catch (err) {
        console.error('[Fitbit Webhook] Failed to process notification:', {
          collectionType,
          ownerId,
          subscriptionId,
          error: err.message,
        });
      }
    }
  });
});

module.exports = router;
