const express = require('express');
const db = require('../../database');
const { requireTeamLeader } = require('./middleware');

const router = express.Router({ mergeParams: true });

// POST /:planId/assign
router.post('/:planId/assign', requireTeamLeader, async (req, res) => {
  try {
    const { planId } = req.params;
    const { user_id } = req.body;

    const result = await db.run(
      `INSERT INTO plan_assignments (plan_id, user_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [planId, user_id || null, req.user.userId]
    );

    const assignment = await db.get(`SELECT * FROM plan_assignments WHERE id = $1`, [result.id]);
    res.status(201).json(assignment);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already assigned' });
    }
    console.error('Assign plan error:', err);
    res.status(500).json({ error: 'Failed to assign plan' });
  }
});

// GET /:planId/assignments
router.get('/:planId/assignments', requireTeamLeader, async (req, res) => {
  try {
    const assignments = await db.all(
      `SELECT pa.*, u.name as user_name
       FROM plan_assignments pa
       LEFT JOIN users u ON pa.user_id = u.id
       WHERE pa.plan_id = $1`,
      [req.params.planId]
    );
    res.json(assignments);
  } catch (err) {
    console.error('List assignments error:', err);
    res.status(500).json({ error: 'Failed to list assignments' });
  }
});

module.exports = router;
