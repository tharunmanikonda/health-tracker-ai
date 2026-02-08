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
    if (members.length === 0) {
      return res.json({
        plan,
        week_dates: buildWeekDates(plan.week_start),
        summary: {
          total_members: 0,
          needs_attention_count: 0,
          avg_workout_completion: null,
          avg_nutrition_compliance: null,
          avg_overall_compliance: null,
        },
        members: [],
      });
    }

    const [workoutCounts, mealTotals, allProgress] = await Promise.all([
      db.all(
        `SELECT day_of_week, COUNT(*)::int as count
         FROM plan_workouts
         WHERE plan_id = $1
         GROUP BY day_of_week`,
        [planId]
      ),
      db.all(
        `SELECT day_of_week,
                COALESCE(SUM(calories), 0)::real as total_calories,
                COALESCE(SUM(protein), 0)::real as total_protein,
                COALESCE(SUM(carbs), 0)::real as total_carbs,
                COALESCE(SUM(fat), 0)::real as total_fat
         FROM plan_meals
         WHERE plan_id = $1
         GROUP BY day_of_week`,
        [planId]
      ),
      db.all(
        `SELECT pp.*,
                pw.day_of_week as workout_day,
                pm.day_of_week as meal_day,
                pm.calories as planned_calories,
                pm.protein as planned_protein,
                pm.carbs as planned_carbs,
                pm.fat as planned_fat
         FROM plan_progress pp
         LEFT JOIN plan_workouts pw ON pp.workout_item_id = pw.id
         LEFT JOIN plan_meals pm ON pp.meal_item_id = pm.id
         WHERE pp.plan_id = $1`,
        [planId]
      )
    ]);

    const weekDates = buildWeekDates(plan.week_start);
    const dashboard = members.map(m =>
      buildMemberStats(m, allProgress, weekDates, workoutCounts, mealTotals),
    );

    const summary = {
      total_members: dashboard.length,
      needs_attention_count: dashboard.filter((m) => m.needs_attention).length,
      avg_workout_completion: average(
        dashboard.map((m) => m.avg_workout_completion).filter((v) => v !== null),
      ),
      avg_nutrition_compliance: average(
        dashboard.map((m) => m.avg_nutrition_compliance).filter((v) => v !== null),
      ),
      avg_overall_compliance: average(
        dashboard.map((m) => m.overall_compliance).filter((v) => v !== null),
      ),
    };

    res.json({ plan, week_dates: weekDates, summary, members: dashboard });
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

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPct(logged, target) {
  if (!target || target <= 0) return null;
  return Math.round((logged / target) * 100);
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + toNumber(value), 0) / values.length);
}

function buildMemberStats(member, allProgress, weekDates, workoutCounts, mealTotals) {
  const memberProgress = allProgress.filter(p => p.user_id === member.user_id);

  const days = weekDates.map((dateStr, dayIndex) => {
    const workoutTarget = workoutCounts.find(w => Number(w.day_of_week) === dayIndex);
    const mealTarget = mealTotals.find(m => Number(m.day_of_week) === dayIndex);

    const dayWorkoutTotal = toNumber(workoutTarget?.count);
    const dayCalorieTarget = toNumber(mealTarget?.total_calories);
    const dayProteinTarget = toNumber(mealTarget?.total_protein);
    const dayCarbsTarget = toNumber(mealTarget?.total_carbs);
    const dayFatTarget = toNumber(mealTarget?.total_fat);

    const dayProgress = memberProgress.filter(p => {
      const rawDate = p.date?.toISOString?.() || String(p.date || '');
      const pDate = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate.slice(0, 10);
      return pDate === dateStr;
    });

    const workoutsCompleted = dayProgress.filter((p) => p.workout_item_id && p.workout_completed).length;
    const mealProgress = dayProgress.filter((p) => p.meal_item_id);
    const caloriesLogged = mealProgress.reduce((sum, p) => sum + toNumber(p.actual_calories), 0);
    const proteinLogged = mealProgress.reduce((sum, p) => sum + toNumber(p.actual_protein), 0);
    const carbsLogged = mealProgress.reduce((sum, p) => sum + toNumber(p.actual_carbs), 0);
    const fatLogged = mealProgress.reduce((sum, p) => sum + toNumber(p.actual_fat), 0);

    return {
      date: dateStr,
      day_of_week: dayIndex,
      workoutPct: toPct(workoutsCompleted, dayWorkoutTotal),
      foodPct: toPct(caloriesLogged, dayCalorieTarget),
      proteinPct: toPct(proteinLogged, dayProteinTarget),
      carbsPct: toPct(carbsLogged, dayCarbsTarget),
      fatPct: toPct(fatLogged, dayFatTarget),
      workoutsCompleted,
      dayWorkoutTotal,
      caloriesLogged,
      dayCalorieTarget,
      proteinLogged,
      dayProteinTarget,
      carbsLogged,
      dayCarbsTarget,
      fatLogged,
      dayFatTarget,
    };
  });

  const daysWithWorkouts = days.filter(d => d.dayWorkoutTotal > 0);
  const foodPcts = days.filter(d => d.dayCalorieTarget > 0).map(d => d.foodPct).filter((v) => v !== null);
  const workoutPcts = days.map((d) => d.workoutPct).filter((v) => v !== null);
  const overallParts = [...workoutPcts, ...foodPcts];

  const proteinLoggedTotal = days.reduce((sum, d) => sum + d.proteinLogged, 0);
  const proteinTargetTotal = days.reduce((sum, d) => sum + d.dayProteinTarget, 0);
  const carbsLoggedTotal = days.reduce((sum, d) => sum + d.carbsLogged, 0);
  const carbsTargetTotal = days.reduce((sum, d) => sum + d.dayCarbsTarget, 0);
  const fatLoggedTotal = days.reduce((sum, d) => sum + d.fatLogged, 0);
  const fatTargetTotal = days.reduce((sum, d) => sum + d.dayFatTarget, 0);

  const overallCompliance = average(overallParts);
  const missedDays = days.filter((d) => {
    const hadTarget = d.dayWorkoutTotal > 0 || d.dayCalorieTarget > 0;
    const hadNoLogs = d.workoutsCompleted === 0 && d.caloriesLogged === 0;
    return hadTarget && hadNoLogs;
  }).length;

  return {
    user_id: member.user_id,
    name: member.name,
    days,
    workout_days_completed: daysWithWorkouts.filter(d => d.workoutPct === 100).length,
    workout_days_total: daysWithWorkouts.length,
    avg_workout_completion: average(workoutPcts),
    avg_nutrition_compliance: average(foodPcts),
    avg_food_compliance: average(foodPcts) || 0,
    overall_compliance: overallCompliance,
    missed_days: missedDays,
    needs_attention: missedDays >= 2 || (overallCompliance !== null && overallCompliance < 50),
    weekly_nutrition: {
      protein: {
        logged: Math.round(proteinLoggedTotal),
        target: Math.round(proteinTargetTotal),
        pct: toPct(proteinLoggedTotal, proteinTargetTotal),
      },
      carbs: {
        logged: Math.round(carbsLoggedTotal),
        target: Math.round(carbsTargetTotal),
        pct: toPct(carbsLoggedTotal, carbsTargetTotal),
      },
      fat: {
        logged: Math.round(fatLoggedTotal),
        target: Math.round(fatTargetTotal),
        pct: toPct(fatLoggedTotal, fatTargetTotal),
      },
    },
  };
}

module.exports = router;
