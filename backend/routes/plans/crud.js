const express = require('express');
const db = require('../../database');
const { requireTeamMember, requireTeamLeader } = require('./middleware');

const router = express.Router({ mergeParams: true });

// POST / - Create plan
router.post('/', requireTeamLeader, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { title, week_start } = req.body;

    if (!title || !week_start) {
      return res.status(400).json({ error: 'Title and week_start are required' });
    }

    const result = await db.run(
      `INSERT INTO weekly_plans (team_id, title, week_start, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [teamId, title.trim(), week_start, req.user.userId]
    );

    const plan = await db.get(`SELECT * FROM weekly_plans WHERE id = $1`, [result.id]);
    res.status(201).json(plan);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A plan already exists for this week' });
    }
    console.error('Create plan error:', err);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// GET / - List team plans
router.get('/', requireTeamMember, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { week } = req.query;

    let sql = `SELECT wp.*, u.name as creator_name
               FROM weekly_plans wp
               LEFT JOIN users u ON wp.created_by = u.id
               WHERE wp.team_id = $1 AND wp.is_active = true`;
    const params = [teamId];

    if (week) {
      sql += ` AND wp.week_start = $2`;
      params.push(week);
    }

    sql += ` ORDER BY wp.week_start DESC`;
    const plans = await db.all(sql, params);
    res.json(plans);
  } catch (err) {
    console.error('List plans error:', err);
    res.status(500).json({ error: 'Failed to list plans' });
  }
});

// GET /my-plan - Current week plan for authenticated member
router.get('/my-plan', requireTeamMember, async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.userId;
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const day = targetDate.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(targetDate);
    weekStart.setDate(targetDate.getDate() + diff);
    const weekStartStr = weekStart.toISOString().split('T')[0];

    const plan = await db.get(
      `SELECT wp.* FROM weekly_plans wp
       WHERE wp.team_id = $1 AND wp.week_start = $2 AND wp.is_active = true
       AND (
         EXISTS (SELECT 1 FROM plan_assignments pa WHERE pa.plan_id = wp.id AND pa.user_id IS NULL)
         OR EXISTS (SELECT 1 FROM plan_assignments pa WHERE pa.plan_id = wp.id AND pa.user_id = $3)
       )`,
      [teamId, weekStartStr, userId]
    );

    if (!plan) {
      return res.json({ plan: null, workouts: [], meals: [], progress: [] });
    }

    const [workouts, meals, progress] = await Promise.all([
      db.all(`SELECT * FROM plan_workouts WHERE plan_id = $1 ORDER BY day_of_week, sort_order`, [plan.id]),
      db.all(`SELECT * FROM plan_meals WHERE plan_id = $1 ORDER BY day_of_week, sort_order`, [plan.id]),
      db.all(`SELECT * FROM plan_progress WHERE plan_id = $1 AND user_id = $2 ORDER BY date`, [plan.id, userId])
    ]);

    res.json({ plan, workouts, meals, progress });
  } catch (err) {
    console.error('My plan error:', err);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

// GET /:planId - Full plan detail
router.get('/:planId', requireTeamMember, async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await db.get(`SELECT * FROM weekly_plans WHERE id = $1`, [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const [workouts, meals, assignments] = await Promise.all([
      db.all(`SELECT * FROM plan_workouts WHERE plan_id = $1 ORDER BY day_of_week, sort_order`, [planId]),
      db.all(`SELECT * FROM plan_meals WHERE plan_id = $1 ORDER BY day_of_week, sort_order`, [planId]),
      db.all(
        `SELECT pa.*, u.name as user_name FROM plan_assignments pa
         LEFT JOIN users u ON pa.user_id = u.id WHERE pa.plan_id = $1`,
        [planId]
      )
    ]);

    res.json({ ...plan, workouts, meals, assignments });
  } catch (err) {
    console.error('Plan detail error:', err);
    res.status(500).json({ error: 'Failed to fetch plan' });
  }
});

// PUT /:planId - Update plan
router.put('/:planId', requireTeamLeader, async (req, res) => {
  try {
    const { planId } = req.params;
    const { title, is_active } = req.body;
    const sets = [];
    const params = [];
    let idx = 1;

    if (title !== undefined) { sets.push(`title = $${idx++}`); params.push(title.trim()); }
    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(is_active); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    params.push(planId);
    await db.run(`UPDATE weekly_plans SET ${sets.join(', ')} WHERE id = $${idx}`, params);
    const plan = await db.get(`SELECT * FROM weekly_plans WHERE id = $1`, [planId]);
    res.json(plan);
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// DELETE /:planId - Soft delete
router.delete('/:planId', requireTeamLeader, async (req, res) => {
  try {
    await db.run(`UPDATE weekly_plans SET is_active = false WHERE id = $1`, [req.params.planId]);
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('Delete plan error:', err);
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

module.exports = router;
