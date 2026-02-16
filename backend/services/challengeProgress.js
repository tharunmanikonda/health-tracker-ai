const db = require('../database');

// Metric aggregation queries - returns a single value for a user on a given date
const metricQueries = {
  calories_burned: async (userId, date) => {
    // Try whoop_metrics first (kilojoules → kcal), fallback to manual workouts, then mobile
    const whoop = await db.get(
      `SELECT kilojoules FROM whoop_metrics WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    if (whoop?.kilojoules) return whoop.kilojoules * 0.239;

    const manual = await db.get(
      `SELECT COALESCE(SUM(calories), 0) as total FROM workouts_manual WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    if (manual?.total > 0) return manual.total;

    // Check Fitbit daily table
    const fitbit = await db.get(
      `SELECT calories_active FROM fitbit_daily WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    if (fitbit?.calories_active > 0) return fitbit.calories_active;

    // Check Apple Health / Health Connect workout tables
    const ah = await db.get(
      `SELECT COALESCE(SUM(active_calories), 0) as total FROM apple_health_workouts
       WHERE user_id = $1 AND start_time::date = $2`, [userId, date]);
    if (ah?.total > 0) return ah.total;

    return 0;
  },

  steps: async (userId, date) => {
    // Check Fitbit daily table
    const fitbit = await db.get(
      `SELECT steps FROM fitbit_daily WHERE user_id = $1 AND date = $2`, [userId, date]);
    if (fitbit?.steps > 0) return fitbit.steps;

    // Check Apple Health samples hypertable
    const ah = await db.get(
      `SELECT COALESCE(SUM(value), 0) as total FROM apple_health_samples_ts
       WHERE user_id = $1 AND metric_type = 'steps' AND time::date = $2`, [userId, date]);
    if (ah?.total > 0) return ah.total;

    // Check Health Connect samples hypertable
    const hc = await db.get(
      `SELECT COALESCE(SUM(value), 0) as total FROM health_connect_samples_ts
       WHERE user_id = $1 AND metric_type = 'steps' AND time::date = $2`, [userId, date]);
    return hc?.total || 0;
  },

  water_intake: async (userId, date) => {
    const result = await db.get(
      `SELECT COALESCE(SUM(amount), 0) as total FROM water_logs
       WHERE user_id = $1 AND DATE(timestamp) = $2`,
      [userId, date]
    );
    return result?.total || 0;
  },

  protein_goal: async (userId, date) => {
    const result = await db.get(
      `SELECT COALESCE(SUM(protein), 0) as total FROM food_logs
       WHERE user_id = $1 AND DATE(timestamp) = $2`,
      [userId, date]
    );
    return result?.total || 0;
  },

  workout_count: async (userId, date) => {
    const manual = await db.get(
      `SELECT COUNT(*) as cnt FROM workouts_manual WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    const whoop = await db.get(
      `SELECT COUNT(*) as cnt FROM whoop_workouts WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    return (parseInt(manual?.cnt) || 0) + (parseInt(whoop?.cnt) || 0);
  },

  sleep_hours: async (userId, date) => {
    const whoop = await db.get(
      `SELECT sleep_hours FROM whoop_metrics WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    if (whoop?.sleep_hours) return whoop.sleep_hours;

    const manual = await db.get(
      `SELECT duration FROM sleep_manual WHERE user_id = $1 AND date = $2`,
      [userId, date]
    );
    return manual?.duration || 0;
  }
};

// Update progress for all active challenges
async function updateAllChallengeProgress() {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get all active challenges that have started
    const activeChallenges = await db.all(
      `SELECT c.*,
        GREATEST(1, (CURRENT_DATE - c.start_date) + 1) as days_elapsed
       FROM challenges c
       WHERE c.is_active = true
         AND c.start_date <= CURRENT_DATE
         AND c.end_date >= CURRENT_DATE`
    );

    for (const challenge of activeChallenges) {
      const participants = await db.all(
        `SELECT user_id FROM challenge_participants WHERE challenge_id = $1`,
        [challenge.id]
      );

      for (const participant of participants) {
        try {
          const queryFn = metricQueries[challenge.metric_type];
          if (!queryFn) continue;

          const currentValue = await queryFn(participant.user_id, today);

          // Calculate percentage: daily value vs daily target
          const percentage = challenge.target_value > 0
            ? Math.min((currentValue / challenge.target_value) * 100, 100)
            : 0;

          // UPSERT progress
          await db.run(
            `INSERT INTO challenge_progress (challenge_id, user_id, date, current_value, percentage)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (challenge_id, user_id, date)
             DO UPDATE SET current_value = $4, percentage = $5`,
            [challenge.id, participant.user_id, today, currentValue, Math.round(percentage * 100) / 100]
          );
        } catch (err) {
          console.error(`[ChallengeProgress] Error updating user ${participant.user_id} for challenge ${challenge.id}:`, err.message);
        }
      }
    }

    console.log(`[ChallengeProgress] Updated ${activeChallenges.length} active challenges`);
  } catch (err) {
    console.error('[ChallengeProgress] Update failed:', err.message);
  }
}

// Get overall percentage for a user across all days of a challenge
async function getOverallPercentage(challengeId, userId) {
  const result = await db.get(
    `SELECT COALESCE(AVG(percentage), 0) as avg_pct
     FROM challenge_progress
     WHERE challenge_id = $1 AND user_id = $2`,
    [challengeId, userId]
  );
  return Math.round((result?.avg_pct || 0) * 100) / 100;
}

module.exports = {
  updateAllChallengeProgress,
  getOverallPercentage,
  metricQueries
};
