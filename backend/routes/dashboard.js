const express = require('express');
const router = express.Router();
const db = require('../database');
const foodService = require('../services/food');
const fitbitService = require('../services/fitbit');

// Get user ID from authenticated request
function getUserId(req) {
  return req.user?.userId || req.user?.id || 1;
}

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mapFitbitMetrics(rows) {
  const map = {};
  for (const row of rows) {
    if (!map[row.metric_type]) {
      map[row.metric_type] = {
        value: row.value,
        unit: row.unit,
        metadata: safeJson(row.metadata),
        updatedAt: row.created_at,
      };
    }
  }
  return map;
}

function metricValue(metric) {
  if (!metric) return null;
  const parsed = Number(metric.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveFitbitInsights(metrics) {
  const steps = metricValue(metrics.steps);
  const activeCalories = metricValue(metrics.active_calories);
  const hrv = metricValue(metrics.hrv);
  const restingHr = metricValue(metrics.resting_heart_rate);
  const azm = metricValue(metrics.active_zone_minutes);
  const sleepMinutes = metricValue(metrics.sleep);
  const sleepHours = sleepMinutes != null ? sleepMinutes / 60 : null;
  const sleepEfficiency = metricValue({ value: metrics.sleep?.metadata?.efficiency });
  const stageMeta = metrics.sleep?.metadata?.stages || {};
  const deepMinutes = Number(stageMeta.deep || 0);
  const remMinutes = Number(stageMeta.rem || 0);
  const deepRemRatio = sleepMinutes ? Math.round(((deepMinutes + remMinutes) / sleepMinutes) * 100) : null;
  const sleepDebtHours = sleepHours != null ? Math.max(0, Math.round((8 - sleepHours) * 10) / 10) : null;

  const scores = [];
  if (hrv != null) scores.push({ value: clamp((hrv - 20) * 1.6, 0, 100), weight: 0.35 });
  if (restingHr != null) scores.push({ value: clamp(100 - Math.max(0, (restingHr - 50) * 2.5), 0, 100), weight: 0.25 });
  if (sleepEfficiency != null) scores.push({ value: clamp(sleepEfficiency, 0, 100), weight: 0.2 });
  if (sleepHours != null) scores.push({ value: clamp((sleepHours / 8) * 100, 0, 100), weight: 0.2 });

  const totalWeight = scores.reduce((sum, item) => sum + item.weight, 0);
  const readinessScore = totalWeight > 0
    ? Math.round(scores.reduce((sum, item) => sum + (item.value * item.weight), 0) / totalWeight)
    : null;

  const stepsScore = steps != null ? clamp((steps / 10000) * 100, 0, 100) : null;
  const azmScore = azm != null ? clamp((azm / 60) * 100, 0, 100) : null;
  const activityLoadScore = (stepsScore != null || azmScore != null)
    ? Math.round(((stepsScore || 0) + (azmScore || 0)) / ((stepsScore != null ? 1 : 0) + (azmScore != null ? 1 : 0)))
    : null;

  return {
    readiness_score: readinessScore,
    sleep_hours: sleepHours != null ? Math.round(sleepHours * 10) / 10 : null,
    sleep_efficiency: sleepEfficiency,
    sleep_debt_hours: sleepDebtHours,
    deep_rem_ratio_pct: deepRemRatio,
    activity_load_score: activityLoadScore,
    steps,
    active_calories: activeCalories,
    hrv,
    resting_heart_rate: restingHr,
    active_zone_minutes: azm,
  };
}

// Get today's dashboard data
router.get('/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const today = new Date().toISOString().split('T')[0];

    const fitbitConnection = await db.get(`
      SELECT provider_user_id, connected_at, updated_at
      FROM wearable_connections
      WHERE user_id = $1 AND provider = 'fitbit'
    `, [userId]);

    let fitbitSync = null;
    if (fitbitConnection) {
      try {
        fitbitSync = await fitbitService.syncLatestData(userId, { mode: 'dashboard' });
      } catch (syncErr) {
        console.warn('[Dashboard] Fitbit freshness sync skipped:', syncErr.message);
      }
    }

    const [foodLogs, whoopMetrics, workouts, cycles, summary, user, waterData, fitbitRows] = await Promise.all([
      db.all(`
        SELECT * FROM food_logs
        WHERE user_id = $1 AND timestamp::date = $2
        ORDER BY timestamp DESC
      `, [userId, today]),
      db.get(
        'SELECT * FROM whoop_metrics WHERE user_id = $1 ORDER BY date DESC LIMIT 1',
        [userId]
      ),
      db.all(`
        SELECT * FROM whoop_workouts
        WHERE user_id = $1 AND date = $2
        ORDER BY start_time DESC
      `, [userId, today]),
      db.all(`
        SELECT * FROM whoop_cycles
        WHERE user_id = $1
        ORDER BY date DESC
        LIMIT 7
      `, [userId]),
      foodService.getDailySummary(today, userId),
      db.get(
        'SELECT daily_calorie_goal, daily_protein_goal FROM users WHERE id = $1',
        [userId]
      ),
      db.get(
        'SELECT SUM(amount) as total FROM water_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE',
        [userId]
      ),
      db.all(`
        SELECT metric_type, value, unit, metadata, created_at
        FROM mobile_health_metrics
        WHERE user_id = $1
          AND source = 'fitbit'
          AND start_time::date >= ($2::date - INTERVAL '1 day')
        ORDER BY created_at DESC
      `, [userId, today]),
    ]);

    const goals = user || { daily_calorie_goal: 2500, daily_protein_goal: 150 };

    const fitbitMetrics = mapFitbitMetrics(fitbitRows);
    const fitbitDerived = deriveFitbitInsights(fitbitMetrics);
    const fitbitLatestAt = fitbitRows[0]?.created_at || null;
    const fitbitSummary = fitbitConnection ? {
      connected: true,
      connected_at: fitbitConnection.connected_at,
      last_sync: fitbitConnection.updated_at,
      last_metric_at: fitbitLatestAt,
      steps: fitbitDerived.steps,
      active_calories: fitbitDerived.active_calories,
      resting_heart_rate: fitbitDerived.resting_heart_rate,
      hrv: fitbitDerived.hrv,
      active_zone_minutes: fitbitDerived.active_zone_minutes,
      sleep_minutes: metricValue(fitbitMetrics.sleep),
      sleep_efficiency: fitbitDerived.sleep_efficiency,
      weight: metricValue(fitbitMetrics.weight),
    } : null;

    // Calculate macros (food intake)
    const totals = foodLogs.reduce((acc, log) => ({
      calories: acc.calories + (log.calories || 0),
      protein: acc.protein + (log.protein || 0),
      carbs: acc.carbs + (log.carbs || 0),
      fat: acc.fat + (log.fat || 0)
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    // Calculate calories burned from activity sources
    let caloriesBurned = 0;
    let burnedSource = null;
    if (whoopMetrics?.kilojoules) {
      // WHOOP reports in kilojoules, convert to kcal
      caloriesBurned = Math.round(whoopMetrics.kilojoules * 0.239006);
      burnedSource = 'whoop';
    } else if (fitbitDerived.active_calories != null) {
      caloriesBurned = Math.round(fitbitDerived.active_calories);
      burnedSource = 'fitbit';
    } else {
      // Sum calories from today's workouts as fallback
      caloriesBurned = workouts.reduce((sum, w) => sum + (w.calories || 0), 0);
      if (caloriesBurned > 0) burnedSource = 'workouts';
    }

    res.json({
      date: today,
      food_logs: foodLogs,
      whoop: whoopMetrics,
      fitbit: fitbitSummary,
      fitbit_derived: fitbitDerived,
      fitbit_sync: fitbitSync?.data || null,
      workouts: workouts,
      cycles: cycles,
      summary: summary,
      goals: goals,
      totals: totals,
      calories_burned: caloriesBurned,
      burned_source: burnedSource,
      water: { total: waterData?.total || 0 },
      remaining: {
        calories: goals.daily_calorie_goal - totals.calories,
        protein: goals.daily_protein_goal - totals.protein
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get week overview
router.get('/week', async (req, res) => {
  try {
    const userId = getUserId(req);
    const today = new Date();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    const metrics = await db.all(
      `SELECT * FROM whoop_metrics 
       WHERE user_id = $1 AND date >= $2 AND date <= $3 
       ORDER BY date DESC`,
      [userId, sevenDaysAgo, todayStr]
    );

    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get insights
router.get('/insights', async (req, res) => {
  try {
    const userId = getUserId(req);
    const insights = await db.all(`
      SELECT 
        ds.date,
        ds.total_calories,
        ds.total_protein,
        wm.recovery_score as whoop_recovery,
        wm.day_strain as whoop_strain,
        wm.kilojoules as calories_burned,
        wm.sleep_score,
        wm.hrv,
        wm.sleep_hours
      FROM daily_summaries ds
      LEFT JOIN whoop_metrics wm ON ds.date = wm.date AND ds.user_id = wm.user_id
      WHERE ds.user_id = $1 AND wm.recovery_score IS NOT NULL
      ORDER BY ds.date DESC
      LIMIT 30
    `, [userId]);

    // Calculate correlations
    const correlations = calculateCorrelations(insights);

    res.json({
      data: insights,
      correlations: correlations
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get workouts
router.get('/workouts', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { limit = 20 } = req.query;
    const workouts = await db.all(`
      SELECT * FROM whoop_workouts 
      WHERE user_id = $1
      ORDER BY start_time DESC 
      LIMIT $2
    `, [userId, limit]);
    res.json(workouts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function calculateCorrelations(data) {
  const highProteinDays = data.filter(d => d.total_protein > 150);
  const lowProteinDays = data.filter(d => d.total_protein < 100);
  
  const highProteinAvgRecovery = highProteinDays.reduce((a, b) => a + (b.whoop_recovery || 0), 0) / (highProteinDays.length || 1);
  const lowProteinAvgRecovery = lowProteinDays.reduce((a, b) => a + (b.whoop_recovery || 0), 0) / (lowProteinDays.length || 1);

  return {
    high_protein_recovery: Math.round(highProteinAvgRecovery),
    low_protein_recovery: Math.round(lowProteinAvgRecovery),
    protein_recovery_diff: Math.round(highProteinAvgRecovery - lowProteinAvgRecovery),
    high_protein_days_count: highProteinDays.length,
    low_protein_days_count: lowProteinDays.length
  };
}

module.exports = router;
