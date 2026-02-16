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
      db.all(`SELECT day_of_week, COUNT(*) as count FROM plan_workouts WHERE plan_id = $1 GROUP BY day_of_week`, [planId]),
      db.all(`SELECT day_of_week, COALESCE(SUM(calories), 0) as total_calories, COALESCE(SUM(protein), 0) as total_protein, COALESCE(SUM(carbs), 0) as total_carbs, COALESCE(SUM(fat), 0) as total_fat FROM plan_meals WHERE plan_id = $1 GROUP BY day_of_week`, [planId]),
      db.all(
        `SELECT pp.*, pp.verification_status, pp.verification_source, pp.wearable_metric_id,
                pw.day_of_week as workout_day, pm.day_of_week as meal_day,
                pm.calories as planned_calories, pm.protein as planned_protein,
                pm.carbs as planned_carbs, pm.fat as planned_fat
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

    // Team summary
    const needsAttentionCount = dashboard.filter(m => m.needs_attention).length;
    const allOverall = dashboard.map(m => m.overall_compliance).filter(v => v !== null);
    const allWorkoutPcts = dashboard.map(m => {
      return m.workout_days_total > 0 ? Math.round((m.workout_days_completed / m.workout_days_total) * 100) : null;
    }).filter(v => v !== null);
    const allFoodPcts = dashboard.map(m => m.avg_food_compliance).filter(v => v > 0 || v === 0);

    const summary = {
      total_members: dashboard.length,
      needs_attention_count: needsAttentionCount,
      avg_workout_completion: allWorkoutPcts.length > 0 ? Math.round(allWorkoutPcts.reduce((a, b) => a + b, 0) / allWorkoutPcts.length) : 0,
      avg_nutrition_compliance: allFoodPcts.length > 0 ? Math.round(allFoodPcts.reduce((a, b) => a + b, 0) / allFoodPcts.length) : 0,
      avg_overall_compliance: allOverall.length > 0 ? Math.round(allOverall.reduce((a, b) => a + b, 0) / allOverall.length) : 0
    };

    res.json({ plan, week_dates: weekDates, members: dashboard, summary });
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
    const dayWorkoutTotal = workoutCounts.find(w => w.day_of_week === dayIndex)?.count || 0;
    const dayMealData = mealTotals.find(m => m.day_of_week === dayIndex);
    const dayCalorieTarget = dayMealData?.total_calories || 0;
    const dayProteinTarget = dayMealData?.total_protein || 0;
    const dayCarbsTarget = dayMealData?.total_carbs || 0;
    const dayFatTarget = dayMealData?.total_fat || 0;

    const dayProgress = memberProgress.filter(p => {
      const rawDate = p.date?.toISOString?.() || String(p.date || '');
      const pDate = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate.slice(0, 10);
      return pDate === dateStr;
    });

    const workoutProgress = dayProgress.filter(p => p.workout_item_id);
    const workoutsCompleted = workoutProgress.filter(p => p.workout_completed).length;
    const mealEntries = dayProgress.filter(p => p.meal_item_id);
    const caloriesLogged = mealEntries.reduce((sum, p) => sum + (p.actual_calories || 0), 0);
    const proteinLogged = mealEntries.reduce((sum, p) => sum + (p.actual_protein || 0), 0);
    const carbsLogged = mealEntries.reduce((sum, p) => sum + (p.actual_carbs || 0), 0);
    const fatLogged = mealEntries.reduce((sum, p) => sum + (p.actual_fat || 0), 0);

    // Verification counts
    const verifiedCount = workoutProgress.filter(p => p.verification_status === 'verified').length;
    const conflictingCount = workoutProgress.filter(p => p.verification_status === 'conflicting').length;
    const noWearableCount = workoutProgress.filter(p => p.verification_status === 'no_data').length;
    const unverifiedCount = workoutProgress.filter(p => !p.verification_status || p.verification_status === 'unverified').length;

    // Wearable workout detail placeholder (loaded async via wearable-activity endpoint)
    const verifiedRow = workoutProgress.find(p => p.wearable_metric_id && p.verification_source);
    let wearableDetail = null;
    if (verifiedRow) {
      wearableDetail = {
        source: verifiedRow.verification_source,
        wearable_metric_id: verifiedRow.wearable_metric_id,
      };
    }

    return {
      date: dateStr, day_of_week: dayIndex,
      workoutPct: dayWorkoutTotal > 0 ? Math.round((workoutsCompleted / dayWorkoutTotal) * 100) : null,
      foodPct: dayCalorieTarget > 0 ? Math.round((caloriesLogged / dayCalorieTarget) * 100) : null,
      workoutsCompleted, dayWorkoutTotal, caloriesLogged, dayCalorieTarget,
      proteinLogged, proteinTarget: dayProteinTarget,
      proteinPct: dayProteinTarget > 0 ? Math.round((proteinLogged / dayProteinTarget) * 100) : null,
      carbsLogged, carbsTarget: dayCarbsTarget,
      carbsPct: dayCarbsTarget > 0 ? Math.round((carbsLogged / dayCarbsTarget) * 100) : null,
      fatLogged, fatTarget: dayFatTarget,
      fatPct: dayFatTarget > 0 ? Math.round((fatLogged / dayFatTarget) * 100) : null,
      verifiedCount, conflictingCount, noWearableCount, unverifiedCount,
      wearableDetail
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

  // Weekly nutrition summary
  const daysWithMeals = days.filter(d => d.dayCalorieTarget > 0);
  const totalProteinLogged = days.reduce((s, d) => s + d.proteinLogged, 0);
  const totalProteinTarget = days.reduce((s, d) => s + d.proteinTarget, 0);
  const totalCarbsLogged = days.reduce((s, d) => s + d.carbsLogged, 0);
  const totalCarbsTarget = days.reduce((s, d) => s + d.carbsTarget, 0);
  const totalFatLogged = days.reduce((s, d) => s + d.fatLogged, 0);
  const totalFatTarget = days.reduce((s, d) => s + d.fatTarget, 0);

  const weekly_nutrition = {
    avg_protein: daysWithMeals.length > 0 ? Math.round(totalProteinLogged / daysWithMeals.length) : 0,
    target_protein: daysWithMeals.length > 0 ? Math.round(totalProteinTarget / daysWithMeals.length) : 0,
    avg_carbs: daysWithMeals.length > 0 ? Math.round(totalCarbsLogged / daysWithMeals.length) : 0,
    target_carbs: daysWithMeals.length > 0 ? Math.round(totalCarbsTarget / daysWithMeals.length) : 0,
    avg_fat: daysWithMeals.length > 0 ? Math.round(totalFatLogged / daysWithMeals.length) : 0,
    target_fat: daysWithMeals.length > 0 ? Math.round(totalFatTarget / daysWithMeals.length) : 0
  };

  // Overall compliance & needs_attention
  const allPcts = [];
  days.forEach(d => {
    if (d.workoutPct !== null) allPcts.push(d.workoutPct);
    if (d.foodPct !== null) allPcts.push(d.foodPct);
  });
  const overall_compliance = allPcts.length > 0 ? Math.round(allPcts.reduce((a, b) => a + b, 0) / allPcts.length) : null;

  const missed_days = days.filter(d => {
    const hasTargets = d.dayWorkoutTotal > 0 || d.dayCalorieTarget > 0;
    const nothingLogged = d.workoutsCompleted === 0 && d.caloriesLogged === 0;
    return hasTargets && nothingLogged;
  }).length;

  const needs_attention = missed_days >= 2 || (overall_compliance !== null && overall_compliance < 50);

  const avg_food_compliance = foodPcts.length > 0 ? Math.round(foodPcts.reduce((a, b) => a + b, 0) / foodPcts.length) : 0;

  const has_wearable = days.some(d => d.verifiedCount > 0 || d.conflictingCount > 0);

  return {
    user_id: member.user_id,
    name: member.name,
    days,
    workout_days_completed: daysWithWorkouts.filter(d => d.workoutPct === 100).length,
    workout_days_total: daysWithWorkouts.length,
    avg_food_compliance,
    weekly_nutrition,
    overall_compliance,
    missed_days,
    needs_attention,
    has_wearable
  };
}

module.exports = router;
