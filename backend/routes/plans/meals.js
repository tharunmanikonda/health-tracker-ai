const express = require('express');
const db = require('../../database');
const { requireTeamLeader } = require('./middleware');

const router = express.Router({ mergeParams: true });

// POST /:planId/meals - Add meal items (batch)
router.post('/:planId/meals', requireTeamLeader, async (req, res) => {
  try {
    const { planId } = req.params;
    const items = Array.isArray(req.body) ? req.body : [req.body];

    const inserted = [];
    for (const item of items) {
      const result = await db.run(
        `INSERT INTO plan_meals (plan_id, day_of_week, meal_type, food_name, quantity_grams, calories, protein, carbs, fat, notes, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [planId, item.day_of_week, item.meal_type, item.food_name,
         item.quantity_grams || null, item.calories || null, item.protein || null,
         item.carbs || null, item.fat || null, item.notes || null, item.sort_order || 0]
      );
      const row = await db.get(`SELECT * FROM plan_meals WHERE id = $1`, [result.id]);
      inserted.push(row);
    }

    res.status(201).json(inserted);
  } catch (err) {
    console.error('Add meals error:', err);
    res.status(500).json({ error: 'Failed to add meals' });
  }
});

// PUT /:planId/meals/:itemId
router.put('/:planId/meals/:itemId', requireTeamLeader, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { day_of_week, meal_type, food_name, quantity_grams, calories, protein, carbs, fat, notes, sort_order } = req.body;

    await db.run(
      `UPDATE plan_meals SET day_of_week = COALESCE($1, day_of_week),
       meal_type = COALESCE($2, meal_type), food_name = COALESCE($3, food_name),
       quantity_grams = COALESCE($4, quantity_grams), calories = COALESCE($5, calories),
       protein = COALESCE($6, protein), carbs = COALESCE($7, carbs), fat = COALESCE($8, fat),
       notes = COALESCE($9, notes), sort_order = COALESCE($10, sort_order) WHERE id = $11`,
      [day_of_week, meal_type, food_name, quantity_grams, calories, protein, carbs, fat, notes, sort_order, itemId]
    );

    const item = await db.get(`SELECT * FROM plan_meals WHERE id = $1`, [itemId]);
    res.json(item);
  } catch (err) {
    console.error('Update meal error:', err);
    res.status(500).json({ error: 'Failed to update meal' });
  }
});

// DELETE /:planId/meals/:itemId
router.delete('/:planId/meals/:itemId', requireTeamLeader, async (req, res) => {
  try {
    await db.run(`DELETE FROM plan_meals WHERE id = $1`, [req.params.itemId]);
    res.json({ message: 'Meal deleted' });
  } catch (err) {
    console.error('Delete meal error:', err);
    res.status(500).json({ error: 'Failed to delete meal' });
  }
});

module.exports = router;
