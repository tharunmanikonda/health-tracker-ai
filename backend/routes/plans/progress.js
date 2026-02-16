const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../../database');
const { requireTeamMember } = require('./middleware');

const router = express.Router({ mergeParams: true });

// Multer setup for food photos
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'meal-logs');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `meal-${req.user.userId}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /:planId/progress/workout - Toggle workout completion
router.post('/:planId/progress/workout', requireTeamMember, async (req, res) => {
  try {
    const { planId } = req.params;
    const userId = req.user.userId;
    const { workout_item_id, date, completed } = req.body;

    if (!workout_item_id || !date) {
      return res.status(400).json({ error: 'workout_item_id and date are required' });
    }

    const existing = await db.get(
      `SELECT id FROM plan_progress WHERE user_id = $1 AND plan_id = $2 AND workout_item_id = $3 AND date = $4`,
      [userId, planId, workout_item_id, date]
    );

    if (existing) {
      await db.run(
        `UPDATE plan_progress SET workout_completed = $1, completed_at = $2 WHERE id = $3`,
        [completed, completed ? new Date().toISOString() : null, existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO plan_progress (user_id, plan_id, workout_item_id, date, workout_completed, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, planId, workout_item_id, date, completed, completed ? new Date().toISOString() : null]
      );
    }

    res.json({ message: 'Workout progress updated' });
  } catch (err) {
    console.error('Workout progress error:', err);
    res.status(500).json({ error: 'Failed to update workout progress' });
  }
});

// POST /:planId/progress/meal - Log food against meal
router.post('/:planId/progress/meal', requireTeamMember, upload.single('image'), async (req, res) => {
  try {
    const { planId } = req.params;
    const userId = req.user.userId;
    const { meal_item_id, date, actual_food_name, actual_quantity_grams, actual_calories, actual_protein, actual_carbs, actual_fat } = req.body;

    if (!meal_item_id || !date) {
      return res.status(400).json({ error: 'meal_item_id and date are required' });
    }

    const imagePath = req.file ? `/uploads/meal-logs/${req.file.filename}` : null;

    const existing = await db.get(
      `SELECT id FROM plan_progress WHERE user_id = $1 AND plan_id = $2 AND meal_item_id = $3 AND date = $4`,
      [userId, planId, meal_item_id, date]
    );

    if (existing) {
      await db.run(
        `UPDATE plan_progress SET actual_food_name = $1, actual_quantity_grams = $2,
         actual_calories = $3, actual_protein = $4, actual_carbs = $5, actual_fat = $6,
         food_image_path = COALESCE($7, food_image_path), logged_at = $8 WHERE id = $9`,
        [actual_food_name, actual_quantity_grams, actual_calories, actual_protein,
         actual_carbs, actual_fat, imagePath, new Date().toISOString(), existing.id]
      );
    } else {
      await db.run(
        `INSERT INTO plan_progress (user_id, plan_id, meal_item_id, date, actual_food_name,
         actual_quantity_grams, actual_calories, actual_protein, actual_carbs, actual_fat,
         food_image_path, logged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [userId, planId, meal_item_id, date, actual_food_name, actual_quantity_grams,
         actual_calories, actual_protein, actual_carbs, actual_fat,
         imagePath, new Date().toISOString()]
      );
    }

    res.json({ message: 'Meal logged' });
  } catch (err) {
    console.error('Meal progress error:', err);
    res.status(500).json({ error: 'Failed to log meal' });
  }
});

// GET /:planId/progress/:date - Own progress for a date
router.get('/:planId/progress/:date', requireTeamMember, async (req, res) => {
  try {
    const { planId, date } = req.params;
    const progress = await db.all(
      `SELECT * FROM plan_progress WHERE plan_id = $1 AND user_id = $2 AND date = $3`,
      [planId, req.user.userId, date]
    );
    res.json(progress);
  } catch (err) {
    console.error('Get progress error:', err);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// GET /:planId/wearable-activity/:date - Get wearable workout data for this user on a date
// Queries all provider-specific workout tables (Apple Health, Health Connect, Fitbit)
router.get('/:planId/wearable-activity/:date', requireTeamMember, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { date } = req.params;

    // Query all provider workout tables with UNION ALL
    const workouts = await db.all(
      `SELECT id, 'apple_healthkit' AS source, workout_type, start_time, end_time,
              duration_seconds, total_calories, active_calories, distance_meters,
              avg_heart_rate, max_heart_rate, metadata
       FROM apple_health_workouts
       WHERE user_id = $1 AND start_time::date = $2::date
       UNION ALL
       SELECT id, 'health_connect' AS source, workout_type, start_time, end_time,
              duration_seconds, total_calories, NULL AS active_calories, NULL AS distance_meters,
              NULL AS avg_heart_rate, NULL AS max_heart_rate, metadata
       FROM health_connect_workouts
       WHERE user_id = $1 AND start_time::date = $2::date
       UNION ALL
       SELECT id, 'fitbit' AS source, workout_type, start_time, end_time,
              duration_seconds, calories AS total_calories, NULL AS active_calories, distance_km AS distance_meters,
              avg_heart_rate, NULL AS max_heart_rate, metadata
       FROM fitbit_workouts
       WHERE user_id = $1 AND start_time::date = $2::date
       ORDER BY start_time`,
      [userId, date]
    );

    res.json({
      workouts: workouts.map(w => ({
        ...w,
        metadata: typeof w.metadata === 'string' ? JSON.parse(w.metadata) : w.metadata
      }))
    });
  } catch (err) {
    console.error('Wearable activity error:', err);
    res.status(500).json({ error: 'Failed to fetch wearable activity' });
  }
});

module.exports = router;
