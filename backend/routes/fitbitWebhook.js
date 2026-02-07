const express = require('express');
const router = express.Router();
const fitbitService = require('../services/fitbit');
const db = require('../database');

// ========================
// FITBIT WEBHOOK ENDPOINTS
// ========================
// These routes are PUBLIC (no auth middleware) because Fitbit calls them directly.
// Security is handled via signature verification.

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
  } else {
    console.log('[Fitbit Webhook] Verification failed (expected for second check)');
    return res.status(404).send();
  }
});

// Fitbit notification handler
// Receives JSON array of notifications when user data changes
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // Must respond with 204 within 5 seconds
  res.status(204).send();

  try {
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');

    // Verify signature if present
    const signature = req.headers['x-fitbit-signature'];
    if (signature) {
      const isValid = fitbitService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.error('[Fitbit Webhook] Invalid signature, ignoring notification');
        return;
      }
    }

    const notifications = JSON.parse(rawBody);

    if (!Array.isArray(notifications)) {
      console.error('[Fitbit Webhook] Invalid notification format');
      return;
    }

    console.log(`[Fitbit Webhook] Received ${notifications.length} notifications`);

    // Process each notification asynchronously
    for (const notification of notifications) {
      const { collectionType, date, ownerId, subscriptionId } = notification;
      console.log(`[Fitbit Webhook] ${collectionType} changed for owner ${ownerId} on ${date}`);

      // Find user by subscription ID (format: user-{userId})
      const userIdMatch = subscriptionId?.match(/^user-(\d+)$/);
      if (!userIdMatch) {
        console.log('[Fitbit Webhook] Unknown subscription ID:', subscriptionId);
        continue;
      }

      const userId = parseInt(userIdMatch[1]);

      // Log the webhook event
      await db.run(`
        INSERT INTO webhook_events (user_id, event_type, payload)
        VALUES ($1, $2, $3)
      `, [userId, `fitbit.${collectionType}.updated`, JSON.stringify(notification)]);

      // Sync the specific data type that changed
      try {
        switch (collectionType) {
          case 'activities':
            await fitbitService.getDailyActivity(userId, date).then(data => {
              const summary = data?.summary;
              if (summary) {
                return Promise.all([
                  summary.steps != null && fitbitService.upsertMetric(userId, 'steps', summary.steps, 'count', date),
                  summary.caloriesOut != null && fitbitService.upsertMetric(userId, 'active_calories', summary.caloriesOut, 'kcal', date),
                  fitbitService.pushToAIFeed(userId, 'activity', {
                    date,
                    steps: summary.steps,
                    caloriesOut: summary.caloriesOut,
                    veryActiveMinutes: summary.veryActiveMinutes,
                    source: 'fitbit'
                  })
                ]);
              }
            });
            break;

          case 'sleep':
            await fitbitService.getSleep(userId, date).then(data => {
              const mainSleep = data?.sleep?.find(s => s.isMainSleep) || data?.sleep?.[0];
              if (mainSleep) {
                const stages = mainSleep.levels?.summary || {};
                return Promise.all([
                  fitbitService.upsertMetric(userId, 'sleep', mainSleep.minutesAsleep || 0, 'minutes', date, {
                    efficiency: mainSleep.efficiency,
                    stages: {
                      deep: stages.deep?.minutes || 0,
                      light: stages.light?.minutes || 0,
                      rem: stages.rem?.minutes || 0,
                      wake: stages.wake?.minutes || 0
                    }
                  }),
                  fitbitService.pushToAIFeed(userId, 'sleep', {
                    date,
                    sleepHours: (mainSleep.minutesAsleep || 0) / 60,
                    efficiency: mainSleep.efficiency,
                    deepMinutes: stages.deep?.minutes || 0,
                    remMinutes: stages.rem?.minutes || 0,
                    source: 'fitbit'
                  })
                ]);
              }
            });
            break;

          case 'body':
            await fitbitService.getWeight(userId, date).then(data => {
              const latestWeight = data?.weight?.[0];
              if (latestWeight) {
                return Promise.all([
                  fitbitService.upsertMetric(userId, 'weight', latestWeight.weight, 'lbs', date, {
                    bmi: latestWeight.bmi,
                    fat: latestWeight.fat
                  }),
                  fitbitService.pushToAIFeed(userId, 'weight', {
                    date,
                    weight: latestWeight.weight,
                    bmi: latestWeight.bmi,
                    source: 'fitbit'
                  })
                ]);
              }
            });
            break;

          default:
            console.log(`[Fitbit Webhook] Unhandled collection type: ${collectionType}`);
        }
      } catch (syncErr) {
        console.error(`[Fitbit Webhook] Failed to sync ${collectionType} for user ${userId}:`, syncErr.message);
      }
    }

  } catch (err) {
    console.error('[Fitbit Webhook] Processing error:', err);
  }
});

module.exports = router;
