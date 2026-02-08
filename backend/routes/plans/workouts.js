const express = require('express');
const db = require('../../database');
const { requireTeamLeader } = require('./middleware');

const router = express.Router({ mergeParams: true });

// POST /:planId/workouts - Add workout items (batch)
router.post('/:planId/workouts', requireTeamLeader, async (req, res) => {
  try {
    const { planId } = req.params;
    const items = Array.isArray(req.body) ? req.body : [req.body];

    const inserted = [];
    for (const item of items) {
      const result = await db.run(
        `INSERT INTO plan_workouts (plan_id, day_of_week, muscle_group, exercise_name, sets, reps, weight_suggestion, notes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [planId, item.day_of_week, item.muscle_group || null, item.exercise_name,
         item.sets || null, item.reps || null, item.weight_suggestion || null,
         item.notes || null, item.sort_order || 0]
      );
      const row = await db.get(`SELECT * FROM plan_workouts WHERE id = $1`, [result.id]);
      inserted.push(row);
    }

    res.status(201).json(inserted);
  } catch (err) {
    console.error('Add workouts error:', err);
    res.status(500).json({ error: 'Failed to add workouts' });
  }
});

// PUT /:planId/workouts/:itemId
router.put('/:planId/workouts/:itemId', requireTeamLeader, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { day_of_week, muscle_group, exercise_name, sets, reps, weight_suggestion, notes, sort_order } = req.body;

    await db.run(
      `UPDATE plan_workouts SET day_of_week = COALESCE($1, day_of_week),
       muscle_group = COALESCE($2, muscle_group), exercise_name = COALESCE($3, exercise_name),
       sets = COALESCE($4, sets), reps = COALESCE($5, reps),
       weight_suggestion = COALESCE($6, weight_suggestion), notes = COALESCE($7, notes),
       sort_order = COALESCE($8, sort_order) WHERE id = $9`,
      [day_of_week, muscle_group, exercise_name, sets, reps, weight_suggestion, notes, sort_order, itemId]
    );

    const item = await db.get(`SELECT * FROM plan_workouts WHERE id = $1`, [itemId]);
    res.json(item);
  } catch (err) {
    console.error('Update workout error:', err);
    res.status(500).json({ error: 'Failed to update workout' });
  }
});

// DELETE /:planId/workouts/:itemId
router.delete('/:planId/workouts/:itemId', requireTeamLeader, async (req, res) => {
  try {
    await db.run(`DELETE FROM plan_workouts WHERE id = $1`, [req.params.itemId]);
    res.json({ message: 'Workout deleted' });
  } catch (err) {
    console.error('Delete workout error:', err);
    res.status(500).json({ error: 'Failed to delete workout' });
  }
});

module.exports = router;
