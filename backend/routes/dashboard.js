const express = require('express');
const router = express.Router();
const db = require('../database');
const foodService = require('../services/food');

// Get user ID from authenticated request
function getUserId(req) {
  return req.user?.userId || req.user?.id || 1;
}

// Get today's dashboard data
router.get('/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const today = new Date().toISOString().split('T')[0];
    
    // Get food logs
    const foodLogs = await db.all(`
      SELECT * FROM food_logs 
      WHERE user_id = $1 AND timestamp::date = $2
      ORDER BY timestamp DESC
    `, [userId, today]);
    
    // Get WHOOP metrics
    const whoopMetrics = await db.get(
      'SELECT * FROM whoop_metrics WHERE user_id = $1 ORDER BY date DESC LIMIT 1',
      [userId]
    );
    
    // Get today's workouts
    const workouts = await db.all(`
      SELECT * FROM whoop_workouts 
      WHERE user_id = $1 AND date = $2
      ORDER BY start_time DESC
    `, [userId, today]);
    
    // Get recent cycles
    const cycles = await db.all(`
      SELECT * FROM whoop_cycles 
      WHERE user_id = $1
      ORDER BY date DESC 
      LIMIT 7
    `, [userId]);
    
    // Get daily summary
    const summary = await foodService.getDailySummary(today, userId);
    
    // Get user goals
    const user = await db.get(
      'SELECT daily_calorie_goal, daily_protein_goal FROM users WHERE id = $1',
      [userId]
    );
    const goals = user || { daily_calorie_goal: 2500, daily_protein_goal: 150 };
    
    // Get today's water
    const waterData = await db.get(
      'SELECT SUM(amount) as total FROM water_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE',
      [userId]
    );
    
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
    } else {
      // Sum calories from today's workouts as fallback
      caloriesBurned = workouts.reduce((sum, w) => sum + (w.calories || 0), 0);
      if (caloriesBurned > 0) burnedSource = 'workouts';
    }

    res.json({
      date: today,
      food_logs: foodLogs,
      whoop: whoopMetrics,
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
