const express = require('express');
const router = express.Router();
const whoopService = require('../services/whoop');

// Get user ID from authenticated request
function getUserId(req) {
  return req.user?.userId || req.user?.id || 1;
}

// OAuth: Start authorization
router.get('/auth', (req, res) => {
  const authUrl = whoopService.getAuthorizationUrl();
  res.redirect(authUrl);
});

// OAuth: Callback handler
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.status(400).json({ error: 'WHOOP authorization denied', details: error });
  }
  
  if (!code) {
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    await whoopService.exchangeCodeForTokens(code);
    res.json({ 
      success: true, 
      message: 'WHOOP connected successfully!',
      nextStep: 'Visit /api/whoop/sync to fetch your data'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to exchange code for tokens', details: err.message });
  }
});

// Check connection status
router.get('/status', (req, res) => {
  res.json({
    authenticated: whoopService.isAuthenticated(),
    authUrl: whoopService.isAuthenticated() ? null : '/api/whoop/auth'
  });
});

// Get WHOOP profile
router.get('/profile', async (req, res) => {
  try {
    const profile = await whoopService.getProfile();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      authUrl: '/api/whoop/auth'
    });
  }
});

// Sync WHOOP data manually
router.post('/sync', async (req, res) => {
  try {
    const userId = getUserId(req);
    const requestedDays = Number.parseInt(String(req.body?.days ?? ''), 10);
    const lookbackDays = Number.isFinite(requestedDays) && requestedDays > 0
      ? Math.min(requestedDays, 180)
      : 30;

    const result = await whoopService.syncLatestData({ userId, lookbackDays });
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      authUrl: '/api/whoop/auth'
    });
  }
});

// Get WHOOP metrics for today
router.get('/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const metrics = await whoopService.getTodayMetrics(userId);
    res.json(metrics || { message: 'No data available for today' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get WHOOP metrics for date range
router.get('/metrics', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { start, end } = req.query;
    const db = require('../database');
    
    let query = 'SELECT * FROM whoop_metrics WHERE user_id = $1';
    const params = [userId];
    let nextParam = 2;

    if (start) {
      query += ` AND date >= $${nextParam}`;
      params.push(start);
      nextParam += 1;
    }
    if (end) {
      query += ` AND date <= $${nextParam}`;
      params.push(end);
      nextParam += 1;
    }
    
    query += ' ORDER BY date DESC';
    
    const metrics = await db.all(query, params);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
