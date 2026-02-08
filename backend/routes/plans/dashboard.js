const express = require('express');
const db = require('../../database');
const { requireTeamLeader } = require('./middleware');

const router = express.Router({ mergeParams: true });

// GET /:planId/dashboard - All members' progress
router.get('/:planId/dashboard', requireTeamLeader, async (req, res) => {
  try {
    const { teamId, planId } = req.params;

    const plan = await db.get(`SELECT * FROM weekly_plans WHERE id = $1`, [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const members = await getAssignedMembers(planId, teamId);
    if (members.length === 0) return res.json({ plan, members: [] });

    const [workoutCounts, mealTotals, allProgress] = await Promise.all([
      db.all(`SELECT day_of_week, COUNT(*) as count FROM plan_workouts WHERE plan_id = $1 GROUP BY day_of_week`, [planId]),
      db.all(`SELECT day_of_week, COALESCE(SUM(calories), 0) as total_calories FROM plan_meals WHERE plan_id = $1 GROUP BY day_of_week`, [planId]),
      db.all(
        `SELECT pp.*, pw.day_of_week as workout_day, pm.day_of_week as meal_day, pm.calories as planned_calories
         FROM plan_progress pp
         LEFT JOIN plan_workouts pw ON pp.workout_item_id = pw.id
         LEFT JOIN plan_meals pm ON pp.meal_item_id = pm.id
         WHERE pp.plan_id = $1`,
        [planId]
      )
    ]);

    const weekDates = buildWeekDates(plan.week_start);
    const dashboard = members.map(m => buildMemberStats(m, allProgress, weekDates, workoutCounts, mealTotals));

    res.json({ plan, week_dates: weekDates, members: dashboard });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

async function getAssignedMembers(planId, teamId) {
  const assignments = await db.all(`SELECT user_id FROM plan_assignments WHERE plan_id = $1`, [planId]);
  const isAllAssigned = assignments.some(a => a.user_id === null);

  if (isAllAssigned) {
    return db.all(
      `SELECT tm.user_id, u.name FROM team_members tm JOIN users u ON tm.user_id = u.id WHERE tm.team_id = $1`,
      [teamId]
    );
  }

  const userIds = assignments.map(a => a.user_id).filter(Boolean);
  if (userIds.length === 0) return [];

  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
  return db.all(`SELECT u.id as user_id, u.name FROM users u WHERE u.id IN (${placeholders})`, userIds);
}

function buildWeekDates(weekStart) {
  const start = new Date(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

function buildMemberStats(member, allProgress, weekDates, workoutCounts, mealTotals) {
  const memberProgress = allProgress.filter(p => p.user_id === member.user_id);

  const days = weekDates.map((dateStr, dayIndex) => {
    const dayWorkoutTotal = workoutCounts.find(w => w.day_of_week === dayIndex)?.count || 0;
    const dayCalorieTarget = mealTotals.find(m => m.day_of_week === dayIndex)?.total_calories || 0;

    const dayProgress = memberProgress.filter(p => {
      const pDate = p.date?.toISOString?.().split('T')[0] || String(p.date);
      return pDate === dateStr;
    });

    const workoutsCompleted = dayProgress.filter(p => p.workout_item_id && p.workout_completed).length;
    const caloriesLogged = dayProgress.filter(p => p.meal_item_id).reduce((sum, p) => sum + (p.actual_calories || 0), 0);

    return {
      date: dateStr, day_of_week: dayIndex,
      workoutPct: dayWorkoutTotal > 0 ? Math.round((workoutsCompleted / dayWorkoutTotal) * 100) : null,
      foodPct: dayCalorieTarget > 0 ? Math.round((caloriesLogged / dayCalorieTarget) * 100) : null,
      workoutsCompleted, dayWorkoutTotal, caloriesLogged, dayCalorieTarget
    };
  });

  const daysWithWorkouts = days.filter(d => d.dayWorkoutTotal > 0);
  const foodPcts = days.filter(d => d.dayCalorieTarget > 0).map(d => d.foodPct);

  return {
    user_id: member.user_id,
    name: member.name,
    days,
    workout_days_completed: daysWithWorkouts.filter(d => d.workoutPct === 100).length,
    workout_days_total: daysWithWorkouts.length,
    avg_food_compliance: foodPcts.length > 0 ? Math.round(foodPcts.reduce((a, b) => a + b, 0) / foodPcts.length) : 0
  };
}

module.exports = router;
