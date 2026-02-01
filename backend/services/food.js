const axios = require('axios');
const db = require('../database');

const OPEN_FOOD_FACTS_API = 'https://world.openfoodfacts.org/api/v0/product';

class FoodService {
  // Lookup by barcode using Open Food Facts
  async lookupBarcode(barcode) {
    try {
      const response = await axios.get(`${OPEN_FOOD_FACTS_API}/${barcode}.json`, {
        timeout: 10000
      });
      
      if (response.data.status === 1) {
        const product = response.data.product;
        const nutriments = product.nutriments;
        
        return {
          found: true,
          name: product.product_name || 'Unknown Product',
          brand: product.brands || '',
          serving_size: product.serving_size || '100g',
          calories: nutriments['energy-kcal_100g'] || nutriments['energy-kcal'] || 0,
          protein: nutriments.proteins_100g || 0,
          carbs: nutriments.carbohydrates_100g || 0,
          fat: nutriments.fat_100g || 0,
          fiber: nutriments.fiber_100g || 0,
          sugar: nutriments.sugars_100g || 0,
          sodium: nutriments.sodium_100g ? nutriments.sodium_100g * 1000 : 0,
          image_url: product.image_url,
          source: 'openfoodfacts'
        };
      }
      
      return { found: false, message: 'Product not found' };
    } catch (error) {
      console.error('Barcode lookup error:', error.message);
      return { found: false, error: error.message };
    }
  }

  // Parse food text
  async parseFoodText(text) {
    const lowerText = text.toLowerCase();
    const foods = [];
    const patterns = [
      /(\d+)\s*(?:grams?|g)\s+(?:of\s+)?(.+)/i,
      /(\d+)\s*(?:oz|ounces?)\s+(?:of\s+)?(.+)/i,
      /(\d+)\s*(?:cups?|c)\s+(?:of\s+)?(.+)/i,
      /(\d+)\s*(?:pieces?|pcs?)\s+(?:of\s+)?(.+)/i,
      /ate\s+(.+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const quantity = match[1] || '1';
        const foodName = match[2] || match[1];
        foods.push({ quantity, name: foodName.trim() });
      }
    }

    if (foods.length === 0) {
      foods.push({ quantity: '1', name: text.replace(/^(ate|had|consumed|snacked on)\s+/i, '').trim() });
    }

    return {
      parsed: true,
      foods: foods,
      originalText: text,
      needsManualEntry: true
    };
  }

  // Log food entry
  async logFood(foodData) {
    const result = await db.run(`
      INSERT INTO food_logs (user_id, name, barcode, calories, protein, carbs, fat, fiber, sugar, sodium, serving_size, portion_multiplier, source, image_path, whatsapp_message_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `, [
      foodData.user_id,
      foodData.name,
      foodData.barcode || null,
      foodData.calories || 0,
      foodData.protein || 0,
      foodData.carbs || 0,
      foodData.fat || 0,
      foodData.fiber || 0,
      foodData.sugar || 0,
      foodData.sodium || 0,
      foodData.serving_size || '1 serving',
      foodData.portion_multiplier || 1,
      foodData.source || 'manual',
      foodData.image_path || null,
      foodData.whatsapp_message_id || null
    ]);

    // Update daily summary
    if (foodData.user_id) {
      await this.updateDailySummary(foodData.user_id);
    }

    return { id: result.id, ...foodData };
  }

  // Get today's food logs for specific user
  async getTodayLogs(userId) {
    return await db.all(`
      SELECT * FROM food_logs 
      WHERE user_id = $1 AND timestamp::date = CURRENT_DATE 
      ORDER BY timestamp DESC
    `, [userId]);
  }

  // Calculate and store daily summary
  async updateDailySummary(userId) {
    const today = new Date().toISOString().split('T')[0];
    
    const totals = await db.get(`
      SELECT 
        SUM(calories) as total_calories,
        SUM(protein) as total_protein,
        SUM(carbs) as total_carbs,
        SUM(fat) as total_fat,
        SUM(fiber) as total_fiber,
        SUM(sugar) as total_sugar,
        SUM(sodium) as total_sodium
      FROM food_logs 
      WHERE user_id = $1 AND timestamp::date = CURRENT_DATE
    `, [userId]);

    const waterData = await db.get(
      'SELECT SUM(amount) as water_amount FROM water_logs WHERE user_id = $1 AND timestamp::date = CURRENT_DATE',
      [userId]
    );
    
    const whoopData = await db.get(
      'SELECT * FROM whoop_metrics WHERE user_id = $1 AND date = CURRENT_DATE',
      [userId]
    );

    await db.run(`
      INSERT INTO daily_summaries (
        user_id, date, total_calories, total_protein, total_carbs, total_fat, 
        total_fiber, total_sugar, total_sodium, water_amount,
        whoop_recovery, whoop_strain, calories_burned, net_calories
      )
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT(user_id, date) DO UPDATE SET
        total_calories = EXCLUDED.total_calories,
        total_protein = EXCLUDED.total_protein,
        total_carbs = EXCLUDED.total_carbs,
        total_fat = EXCLUDED.total_fat,
        total_fiber = EXCLUDED.total_fiber,
        total_sugar = EXCLUDED.total_sugar,
        total_sodium = EXCLUDED.total_sodium,
        water_amount = EXCLUDED.water_amount,
        whoop_recovery = EXCLUDED.whoop_recovery,
        whoop_strain = EXCLUDED.whoop_strain,
        calories_burned = EXCLUDED.calories_burned,
        net_calories = EXCLUDED.net_calories
    `, [
      userId,
      totals.total_calories || 0,
      totals.total_protein || 0,
      totals.total_carbs || 0,
      totals.total_fat || 0,
      totals.total_fiber || 0,
      totals.total_sugar || 0,
      totals.total_sodium || 0,
      waterData?.water_amount || 0,
      whoopData?.recovery_score || null,
      whoopData?.strain_score || null,
      whoopData?.calories_burned || null,
      (whoopData?.calories_burned || 0) - (totals.total_calories || 0)
    ]);
  }

  // Get daily summary
  async getDailySummary(date, userId) {
    return await db.get(
      'SELECT * FROM daily_summaries WHERE date = $1 AND user_id = $2',
      [date, userId]
    );
  }
}

module.exports = new FoodService();
