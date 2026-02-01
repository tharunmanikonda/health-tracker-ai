const express = require('express');
const router = express.Router();
const db = require('../database');

// AI Coach Chat Routes

// Get chat history
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50 } = req.query;
    
    const messages = await db.all(`
      SELECT * FROM ai_chat_messages 
      WHERE user_id = $1 
      ORDER BY created_at ASC 
      LIMIT $2
    `, [userId, parseInt(limit)]);
    
    res.json({
      success: true,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.created_at,
        metadata: m.metadata ? JSON.parse(m.metadata) : null
      }))
    });
  } catch (err) {
    console.error('Get chat history error:', err);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

// Send message to AI coach
router.post('/message', async (req, res) => {
  try {
    const userId = req.user.id;
    const { message, conversationId = null } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    // Save user message
    await db.run(`
      INSERT INTO ai_chat_messages (user_id, role, content, conversation_id)
      VALUES ($1, 'user', $2, $3)
    `, [userId, message.trim(), conversationId]);
    
    // Get user's health context
    const healthContext = await getHealthContext(userId);
    
    // Generate AI response
    const aiResponse = await generateAIResponse(message, healthContext, userId);
    
    // Save AI response
    const result = await db.run(`
      INSERT INTO ai_chat_messages (user_id, role, content, conversation_id, metadata)
      VALUES ($1, 'assistant', $2, $3, $4)
      RETURNING id
    `, [userId, aiResponse.content, conversationId, JSON.stringify(aiResponse.metadata || {})]);
    
    res.json({
      success: true,
      message: {
        id: result.id,
        role: 'assistant',
        content: aiResponse.content,
        timestamp: new Date().toISOString(),
        suggestions: aiResponse.suggestions || []
      }
    });
    
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Get health summary for AI context
async function getHealthContext(userId) {
  try {
    // Today's nutrition
    const todayNutrition = await db.get(`
      SELECT 
        SUM(calories) as calories,
        SUM(protein) as protein,
        SUM(carbs) as carbs,
        SUM(fat) as fat
      FROM food_logs 
      WHERE user_id = $1 AND timestamp::date = CURRENT_DATE
    `, [userId]);
    
    // Today's water
    const todayWater = await db.get(`
      SELECT SUM(amount) as total FROM water_logs 
      WHERE user_id = $1 AND timestamp::date = CURRENT_DATE
    `, [userId]);
    
    // Latest WHOOP metrics
    const whoopMetrics = await db.get(`
      SELECT * FROM whoop_metrics 
      WHERE user_id = $1 
      ORDER BY date DESC 
      LIMIT 1
    `, [userId]);
    
    // Latest wearable data (Fitbit, Google Fit, etc.)
    const wearableData = await db.get(`
      SELECT 
        SUM(CASE WHEN metric_type = 'steps' THEN value ELSE 0 END) as steps,
        AVG(CASE WHEN metric_type = 'heart_rate' THEN value END) as avg_hr,
        SUM(CASE WHEN metric_type = 'active_calories' THEN value ELSE 0 END) as active_calories
      FROM mobile_health_metrics 
      WHERE user_id = $1 AND created_at::date = CURRENT_DATE
    `, [userId]);
    
    // Recent weight
    const latestWeight = await db.get(`
      SELECT weight, unit FROM weight_logs 
      WHERE user_id = $1 
      ORDER BY date DESC 
      LIMIT 1
    `, [userId]);
    
    // Sleep from last night
    const lastSleep = await db.get(`
      SELECT * FROM sleep_manual 
      WHERE user_id = $1 
      ORDER BY date DESC 
      LIMIT 1
    `, [userId]);
    
    // 7-day averages
    const weekAverages = await db.get(`
      SELECT 
        AVG(total_calories) as avg_calories,
        AVG(total_protein) as avg_protein
      FROM daily_summaries 
      WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '7 days'
    `, [userId]);
    
    // User goals
    const userGoals = await db.get(`
      SELECT daily_calorie_goal, daily_protein_goal 
      FROM users 
      WHERE id = $1
    `, [userId]);
    
    return {
      today: {
        calories: Math.round(todayNutrition?.calories || 0),
        protein: Math.round(todayNutrition?.protein || 0),
        carbs: Math.round(todayNutrition?.carbs || 0),
        fat: Math.round(todayNutrition?.fat || 0),
        water: Math.round(todayWater?.total || 0),
        steps: Math.round(wearableData?.steps || 0),
        activeCalories: Math.round(wearableData?.active_calories || 0),
        avgHeartRate: wearableData?.avg_hr ? Math.round(wearableData.avg_hr) : null
      },
      goals: {
        calories: userGoals?.daily_calorie_goal || 2500,
        protein: userGoals?.daily_protein_goal || 150
      },
      whoop: whoopMetrics ? {
        recovery: whoopMetrics.recovery_score,
        sleep: whoopMetrics.sleep_score,
        strain: whoopMetrics.strain_score || whoopMetrics.day_strain,
        restingHR: whoopMetrics.resting_hr,
        hrv: whoopMetrics.hrv,
        sleepHours: whoopMetrics.sleep_hours
      } : null,
      weight: latestWeight ? {
        value: latestWeight.weight,
        unit: latestWeight.unit
      } : null,
      sleep: lastSleep ? {
        duration: lastSleep.duration,
        quality: lastSleep.quality
      } : null,
      weeklyAverages: {
        calories: Math.round(weekAverages?.avg_calories || 0),
        protein: Math.round(weekAverages?.avg_protein || 0)
      },
      date: new Date().toISOString().split('T')[0]
    };
    
  } catch (err) {
    console.error('Get health context error:', err);
    return {};
  }
}

// Generate AI response
async function generateAIResponse(userMessage, healthContext, userId) {
  const axios = require('axios');
  
  // Check if user has API key
  const settings = await db.get('SELECT whoop_api_key FROM user_settings WHERE user_id = $1', [userId]);
  const apiKey = settings?.whoop_api_key || process.env.KIMI_API_KEY || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    return {
      content: "I'm here to help with your health journey! To provide personalized insights, please add an AI API key in your settings. In the meantime, I can help you understand your logged data.",
      suggestions: ["How do I add an API key?", "Show me today's summary", "What should I log?"]
    };
  }
  
  // Build system prompt with health context
  const systemPrompt = buildHealthCoachPrompt(healthContext);
  
  try {
    // Try Kimi first
    const response = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
      model: 'moonshot-v1-8k',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 800
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    const content = response.data.choices[0].message.content;
    
    return {
      content: content,
      metadata: { model: 'kimi', hasContext: true }
    };
    
  } catch (err) {
    console.error('AI API error:', err.message);
    
    // Fallback response
    return generateFallbackResponse(userMessage, healthContext);
  }
}

// Build system prompt for health coach
function buildHealthCoachPrompt(context) {
  return `You are a knowledgeable and friendly AI Health Coach. You help users understand their fitness, nutrition, and wellness data.

CURRENT USER DATA (Today):
- Calories: ${context.today?.calories || 0} / ${context.goals?.calories || 2500} kcal
- Protein: ${context.today?.protein || 0} / ${context.goals?.protein || 150}g
- Carbs: ${context.today?.carbs || 0}g
- Fat: ${context.today?.fat || 0}g
- Water: ${context.today?.water || 0}ml
- Steps: ${context.today?.steps || 0}
${context.whoop ? `
WHOOP DATA:
- Recovery Score: ${context.whoop.recovery}%
- Sleep Score: ${context.whoop.sleep}
- Day Strain: ${context.whoop.strain}
- Resting HR: ${context.whoop.restingHR} bpm
- HRV: ${context.whoop.hrv}ms
- Sleep: ${context.whoop.sleepHours} hours
` : ''}
${context.weight ? `Current Weight: ${context.weight.value} ${context.weight.unit}` : ''}

7-DAY AVERAGES:
- Calories: ${context.weeklyAverages?.calories || 0}/day
- Protein: ${context.weeklyAverages?.protein || 0}g/day

GUIDELINES:
1. Be encouraging and supportive, never judgmental
2. Use the data provided to give personalized advice
3. If recovery is low (<50%), suggest lighter activity
4. If protein is low, suggest high-protein foods
5. Keep responses concise (2-3 short paragraphs max)
6. Use emojis occasionally to keep it friendly
7. If you don't have certain data, ask the user to log it
8. Never make up data - only use what's provided above

Today's date: ${context.date}`;
}

// Fallback responses if AI API fails
function generateFallbackResponse(message, context) {
  const msg = message.toLowerCase();
  const today = context.today || {};
  const whoop = context.whoop || {};
  
  // Simple pattern matching for common questions
  if (msg.includes('calorie') || msg.includes('eaten') || msg.includes('food')) {
    const remaining = (context.goals?.calories || 2500) - (today.calories || 0);
    return {
      content: `Today you've logged ${today.calories || 0} calories out of your ${context.goals?.calories || 2500} goal. You have ${remaining} calories remaining.\n\nYour macros so far: ${today.protein || 0}g protein, ${today.carbs || 0}g carbs, ${today.fat || 0}g fat.`,
      suggestions: ["What should I eat?", "High protein foods", "Log food"]
    };
  }
  
  if (msg.includes('sleep') && whoop.sleep) {
    return {
      content: `Last night you got ${whoop.sleepHours} hours of sleep with a sleep score of ${whoop.sleep}. Your recovery score is ${whoop.recovery}%.\n\n${whoop.recovery < 50 ? 'Your recovery is on the lower side today. Consider taking it easier and prioritizing rest.' : 'Great recovery! You\'re ready for a productive day.'}`,
      suggestions: ["How to improve sleep?", "Why is my recovery low?"]
    };
  }
  
  if (msg.includes('recovery') && whoop.recovery) {
    return {
      content: `Your WHOOP recovery score is ${whoop.recovery}%. ${whoop.recovery >= 70 ? 'Excellent! Your body is well-recovered and ready for strain.' : whoop.recovery >= 50 ? 'Moderate recovery. You can still train but listen to your body.' : 'Low recovery. Consider active recovery or rest today.'}`,
      suggestions: ["How to improve recovery?", "What affects recovery?"]
    };
  }
  
  if (msg.includes('protein') || msg.includes('macro')) {
    const proteinRemaining = (context.goals?.protein || 150) - (today.protein || 0);
    return {
      content: `You've had ${today.protein || 0}g of protein today, with ${proteinRemaining}g remaining to hit your goal of ${context.goals?.protein || 150}g.\n\nTry adding: chicken breast (31g per 100g), Greek yogurt (10g per 100g), or protein shake (25g) to reach your target.`,
      suggestions: ["High protein meals", "Protein snacks", "Log food"]
    };
  }
  
  if (msg.includes('step') || msg.includes('walk')) {
    return {
      content: `You've taken ${today.steps || 0} steps today. ${today.steps > 10000 ? 'Great job hitting that 10k goal! 🎉' : today.steps > 5000 ? 'Good progress! A short walk could get you to 10k.' : 'Try to get some movement in - even a 10-minute walk helps!'}`,
      suggestions: ["Benefits of walking", "How to get more steps"]
    };
  }
  
  if (msg.includes('water') || msg.includes('hydration')) {
    return {
      content: `You've logged ${today.water || 0}ml of water today. Aim for at least 2500ml (about 8 glasses) for optimal hydration.`,
      suggestions: ["Log water", "Hydration tips"]
    };
  }
  
  if (msg.includes('weight') && context.weight) {
    return {
      content: `Your latest recorded weight is ${context.weight.value} ${context.weight.unit}. Keep tracking daily for the most accurate trends!`,
      suggestions: ["Log weight", "Weight trends"]
    };
  }
  
  // Default response
  return {
    content: `I can help you understand your health data! Here\'s what I see today:\n\n• Calories: ${today.calories || 0}/${context.goals?.calories || 2500}\n• Protein: ${today.protein || 0}/${context.goals?.protein || 150}g\n• Steps: ${today.steps || 0}\n${whoop.recovery ? `• Recovery: ${whoop.recovery}%` : ''}\n\nWhat would you like to know more about?`,
    suggestions: ["How am I doing?", "What should I improve?", "Today's summary"]
  };
}

// Quick insights endpoint
router.get('/insights', async (req, res) => {
  try {
    const userId = req.user.id;
    const context = await getHealthContext(userId);
    
    // Generate insights based on data
    const insights = [];
    
    // Recovery insight
    if (context.whoop?.recovery) {
      if (context.whoop.recovery < 50) {
        insights.push({
          type: 'recovery',
          priority: 'high',
          title: 'Recovery is Low',
          message: `Your recovery is ${context.whoop.recovery}%. Consider lighter activity today.`,
          action: 'View sleep tips'
        });
      } else if (context.whoop.recovery > 80) {
        insights.push({
          type: 'recovery',
          priority: 'low',
          title: 'Great Recovery!',
          message: `You're at ${context.whoop.recovery}% recovery. Ready to push! 💪`,
          action: 'Plan workout'
        });
      }
    }
    
    // Protein insight
    const proteinPct = (context.today?.protein || 0) / (context.goals?.protein || 150);
    if (proteinPct < 0.5 && new Date().getHours() > 16) {
      insights.push({
        type: 'nutrition',
        priority: 'medium',
        title: 'Protein is Low',
        message: `You've only hit ${Math.round(proteinPct * 100)}% of your protein goal.`,
        action: 'High protein dinners'
      });
    }
    
    // Calorie insight
    const caloriePct = (context.today?.calories || 0) / (context.goals?.calories || 2500);
    if (caloriePct > 1) {
      insights.push({
        type: 'nutrition',
        priority: 'low',
        title: 'Over Calorie Goal',
        message: `You're ${context.today.calories - context.goals.calories} calories over target.`,
        action: 'Adjust tomorrow'
      });
    }
    
    // Steps insight
    if (context.today?.steps < 5000 && new Date().getHours() > 18) {
      insights.push({
        type: 'activity',
        priority: 'medium',
        title: 'Steps are Low',
        message: `Only ${context.today.steps} steps today. A quick evening walk?`,
        action: 'Log workout'
      });
    }
    
    // Hydration insight
    if ((context.today?.water || 0) < 1500) {
      insights.push({
        type: 'hydration',
        priority: 'medium',
        title: 'Drink More Water',
        message: `You've only had ${context.today.water}ml. Aim for 2500ml!`,
        action: 'Log water'
      });
    }
    
    res.json({
      success: true,
      insights: insights.sort((a, b) => {
        const priority = { high: 0, medium: 1, low: 2 };
        return priority[a.priority] - priority[b.priority];
      })
    });
    
  } catch (err) {
    console.error('Get insights error:', err);
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

// Clear chat history
router.delete('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    await db.run('DELETE FROM ai_chat_messages WHERE user_id = $1', [userId]);
    res.json({ success: true, message: 'Chat history cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

module.exports = router;
