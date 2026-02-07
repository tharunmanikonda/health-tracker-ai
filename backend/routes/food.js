const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const foodService = require('../services/food');
const ocrService = require('../services/ocr');
const db = require('../database');

const upload = multer({ dest: 'uploads/' });

// Get user ID from authenticated request
function getUserId(req) {
  return req.user?.userId || req.user?.id;
}

// ========== FOOD LOGGING ==========

// Lookup barcode
router.get('/barcode/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await foodService.lookupBarcode(code);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log food manually or from barcode
router.post('/log', async (req, res) => {
  try {
    const userId = getUserId(req);
    const foodData = { ...req.body, user_id: userId };
    const result = await foodService.logFood(foodData);
    
    // Push to AI feed queue
    await db.run(
      `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
       VALUES ($1, 'food_logs', $2, 'food', $3)`,
      [
        userId,
        result.id,
        JSON.stringify({
          name: foodData.name,
          calories: foodData.calories,
          protein: foodData.protein,
          carbs: foodData.carbs,
          fat: foodData.fat,
          timestamp: new Date().toISOString()
        })
      ]
    );
    
    // Trigger webhook event
    await db.run(
      `INSERT INTO webhook_events (user_id, event_type, payload)
       VALUES ($1, 'food_logged', $2)`,
      [
        userId,
        JSON.stringify({ food: foodData.name, calories: foodData.calories })
      ]
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's food logs
router.get('/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const logs = await db.all(
      'SELECT * FROM food_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE ORDER BY timestamp DESC',
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get food logs for a specific date
router.get('/logs/:date', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { date } = req.params;
    const logs = await db.all(
      'SELECT * FROM food_logs WHERE user_id = $1 AND timestamp::date = $2 ORDER BY timestamp DESC',
      [userId, date]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete food log
router.delete('/log/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;
    await db.run('DELETE FROM food_logs WHERE id = $1 AND user_id = $2', [id, userId]);
    await foodService.updateDailySummary(userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== WATER TRACKING ==========

// Get today's water intake
router.get('/water/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const result = await db.get(
      'SELECT SUM(amount) as total FROM water_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE',
      [userId]
    );
    res.json({ total: result?.total || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log water intake
router.post('/water/log', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { amount, unit = 'ml' } = req.body;
    const result = await db.run(
      'INSERT INTO water_logs (user_id, amount, unit) VALUES ($1, $2, $3) RETURNING id',
      [userId, amount, unit]
    );
    
    // Push to AI feed queue
    await db.run(
      `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
       VALUES ($1, 'water_logs', $2, 'water', $3)`,
      [
        userId,
        result.id,
        JSON.stringify({ amount, unit, timestamp: new Date().toISOString() })
      ]
    );
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get water history
router.get('/water/history/:days', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { days = 7 } = req.params;
    const logs = await db.all(
      `SELECT timestamp::date as date, SUM(amount) as total 
       FROM water_logs 
       WHERE user_id = $1 AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY timestamp::date
       ORDER BY date DESC`,
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== WEIGHT TRACKING ==========

// Get weight history
router.get('/weight/history', async (req, res) => {
  try {
    const userId = getUserId(req);
    const logs = await db.all(
      'SELECT * FROM weight_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 30',
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest weight
router.get('/weight/latest', async (req, res) => {
  try {
    const userId = getUserId(req);
    const log = await db.get(
      'SELECT * FROM weight_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 1',
      [userId]
    );
    res.json(log || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log weight
router.post('/weight/log', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { weight, unit = 'lbs', date, notes = '' } = req.body;
    const logDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    
    const result = await db.run(
      `INSERT INTO weight_logs (user_id, date, weight, unit, notes) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (user_id, date) 
       DO UPDATE SET weight = EXCLUDED.weight, unit = EXCLUDED.unit, notes = EXCLUDED.notes 
       RETURNING id`,
      [userId, logDate, weight, unit, notes]
    );
    
    // Push to AI feed queue
    await db.run(
      `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
       VALUES ($1, 'weight_logs', $2, 'weight', $3)`,
      [
        userId,
        result.id,
        JSON.stringify({ weight, unit, date: logDate, notes, timestamp: new Date().toISOString() })
      ]
    );
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== MOOD TRACKING ==========

// Get mood history
router.get('/mood/history', async (req, res) => {
  try {
    const userId = getUserId(req);
    const logs = await db.all(
      'SELECT * FROM mood_logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 30',
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's mood
router.get('/mood/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const log = await db.get(
      'SELECT * FROM mood_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE ORDER BY timestamp DESC LIMIT 1',
      [userId]
    );
    res.json(log || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log mood
router.post('/mood/log', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { mood_score, energy_score, notes = '', timestamp } = req.body;
    const result = await db.run(
      'INSERT INTO mood_logs (user_id, mood_score, energy_score, notes, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [userId, mood_score, energy_score, notes, timestamp || new Date().toISOString()]
    );
    
    // Push to AI feed queue
    await db.run(
      `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
       VALUES ($1, 'mood_logs', $2, 'mood', $3)`,
      [
        userId,
        result.id,
        JSON.stringify({ mood_score, energy_score, notes, timestamp: timestamp || new Date().toISOString() })
      ]
    );
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== SLEEP TRACKING ==========

// Get sleep history
router.get('/sleep/history', async (req, res) => {
  try {
    const userId = getUserId(req);
    const logs = await db.all(
      'SELECT * FROM sleep_manual WHERE user_id = $1 ORDER BY date DESC LIMIT 30',
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's sleep
router.get('/sleep/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const log = await db.get(
      'SELECT * FROM sleep_manual WHERE user_id = $1 AND date = CURRENT_DATE',
      [userId]
    );
    res.json(log || null);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log sleep
router.post('/sleep/log', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { duration, quality, notes = '', date } = req.body;
    const logDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    
    const result = await db.run(
      `INSERT INTO sleep_manual (user_id, date, duration, quality, notes) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date)
       DO UPDATE SET duration = EXCLUDED.duration, quality = EXCLUDED.quality, notes = EXCLUDED.notes
       RETURNING id`,
      [userId, logDate, duration, quality, notes]
    );
    
    // Push to AI feed queue
    await db.run(
      `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
       VALUES ($1, 'sleep_manual', $2, 'sleep', $3)`,
      [
        userId,
        result.id,
        JSON.stringify({ duration, quality, notes, date: logDate, timestamp: new Date().toISOString() })
      ]
    );
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== WORKOUT TRACKING ==========

// Get workout history
router.get('/workouts/history', async (req, res) => {
  try {
    const userId = getUserId(req);
    const manualLogs = await db.all(
      'SELECT *, \'manual\' as source FROM workouts_manual WHERE user_id = $1 ORDER BY date DESC LIMIT 20',
      [userId]
    );
    const whoopLogs = await db.all(
      'SELECT *, \'whoop\' as source FROM whoop_workouts WHERE user_id = $1 ORDER BY date DESC LIMIT 20',
      [userId]
    );
    const allWorkouts = [...manualLogs, ...whoopLogs].sort((a, b) => 
      new Date(b.date || b.start_time) - new Date(a.date || a.start_time)
    ).slice(0, 30);
    res.json(allWorkouts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log manual workout
router.post('/workouts/manual', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { type, duration, calories = 0, notes = '', date } = req.body;
    const logDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    
    const result = await db.run(
      'INSERT INTO workouts_manual (user_id, date, type, duration, calories, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [userId, logDate, type, duration, calories, notes]
    );
    
    // Push to AI feed queue
    await db.run(
      `INSERT INTO ai_feed_queue (user_id, source_table, source_id, data_type, data_json)
       VALUES ($1, 'workouts_manual', $2, 'workout', $3)`,
      [
        userId,
        result.id,
        JSON.stringify({ type, duration, calories, notes, date: logDate, timestamp: new Date().toISOString() })
      ]
    );
    
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== MEDICATION TRACKING ==========

// Get medication history
router.get('/meds/history', async (req, res) => {
  try {
    const userId = getUserId(req);
    const logs = await db.all(
      'SELECT * FROM medication_logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 30',
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get today's medications
router.get('/meds/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const logs = await db.all(
      'SELECT * FROM medication_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE ORDER BY timestamp DESC',
      [userId]
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Log medication
router.post('/meds/log', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, taken = true, notes = '' } = req.body;
    const result = await db.run(
      'INSERT INTO medication_logs (user_id, name, taken, notes) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, name, taken, notes]
    );
    res.json({ success: true, id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== OCR LABEL SCANNING ==========

// Upload and scan nutrition label
router.post('/scan-label', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imagePath = req.file.path;
    const nutritionData = await ocrService.scanNutritionLabel(imagePath);
    
    res.json({
      success: true,
      data: nutritionData,
      imagePath: req.file.filename
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
