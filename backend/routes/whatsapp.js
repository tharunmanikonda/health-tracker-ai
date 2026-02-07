const express = require('express');
const router = express.Router();
const foodService = require('../services/food');

// Twilio WhatsApp webhook
router.post('/webhook', async (req, res) => {
  try {
    const { Body, From, MessageSid, NumMedia, MediaUrl0 } = req.body;
    
    console.log('WhatsApp message received:', { from: From, body: Body });

    let response = '';

    // Handle different message types
    if (NumMedia > 0 && MediaUrl0) {
      // Handle image (nutrition label photo)
      response = await handleImageMessage(MediaUrl0, MessageSid);
    } else if (Body?.startsWith('barcode ') || Body?.startsWith('bc ')) {
      // Handle barcode lookup
      const barcode = Body.replace(/^(barcode|bc)\s+/i, '').trim();
      response = await handleBarcode(barcode);
    } else if (Body?.match(/^\d+\s+cal/)) {
      // Handle calorie-only quick log
      response = await handleQuickCalorieLog(Body, MessageSid);
    } else if (Body?.toLowerCase() === 'status' || Body?.toLowerCase() === 'today') {
      // Get today's summary
      response = await handleStatusRequest();
    } else if (Body?.toLowerCase() === 'help') {
      response = getHelpMessage();
    } else {
      // Parse as food text
      response = await handleFoodText(Body, MessageSid);
    }

    // Twilio expects TwiML response
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(response)}</Message>
</Response>`);

  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.set('Content-Type', 'text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, I had trouble processing that. Try again or type 'help' for options.</Message>
</Response>`);
  }
});

async function handleFoodText(text, messageId) {
  const parsed = await foodService.parseFoodText(text);
  
  if (parsed.needsManualEntry) {
    // Log with manual flag for later completion
    await foodService.logFood({
      name: parsed.foods.map(f => `${f.quantity} ${f.name}`).join(', '),
      calories: 0,
      source: 'whatsapp',
      whatsapp_message_id: messageId
    });

    return `✅ Logged: "${text}"\n\nI'll need you to add nutrition details. Reply with:\n"calories [number], protein [number], carbs [number], fat [number]"`;
  }

  return `🍽️ Parsed: ${parsed.foods.map(f => `${f.quantity} ${f.name}`).join(', ')}`;
}

async function handleQuickCalorieLog(text, messageId) {
  const match = text.match(/(\d+)\s+cal/);
  if (match) {
    const calories = parseInt(match[1]);
    await foodService.logFood({
      name: 'Quick calorie entry',
      calories: calories,
      source: 'whatsapp',
      whatsapp_message_id: messageId
    });
    return `✅ Logged ${calories} calories`;
  }
  return 'Could not parse calories. Try: "500 cal"';
}

async function handleBarcode(barcode) {
  const result = await foodService.lookupBarcode(barcode);
  
  if (result.found) {
    await foodService.logFood({
      ...result,
      barcode: barcode,
      source: 'whatsapp_barcode'
    });
    
    return `✅ Logged: ${result.name}\n📊 ${Math.round(result.calories)} cal | ${Math.round(result.protein)}g protein | ${Math.round(result.carbs)}g carbs | ${Math.round(result.fat)}g fat`;
  }
  
  return `❌ Product not found for barcode: ${barcode}`;
}

async function handleImageMessage(imageUrl, messageId) {
  // Download and process image with OCR
  // For now, acknowledge receipt
  return `📸 Image received! Processing nutrition label...\n\n(Note: OCR processing coming soon - for now, please text me the nutrition info)`;
}

async function handleStatusRequest() {
  const db = require('../database');
  const today = new Date().toISOString().split('T')[0];
  
  const summary = await db.get(`
    SELECT
      SUM(calories) as total_calories,
      SUM(protein) as total_protein
    FROM food_logs
    WHERE DATE(timestamp) = $1
  `, [today]);

  const whoop = await db.get('SELECT recovery_score FROM whoop_metrics WHERE date = $1', [today]);

  let msg = `📊 Today's Stats\n\n`;
  msg += `🍽️ Food: ${Math.round(summary?.total_calories || 0)} cal`;
  if (summary?.total_protein) msg += ` | ${Math.round(summary.total_protein)}g protein`;
  msg += `\n`;
  
  if (whoop?.recovery_score) {
    msg += `💚 Recovery: ${whoop.recovery_score}%\n`;
  }

  return msg;
}

function getHelpMessage() {
  return `🤖 Health Tracker Commands:

🍽️ *Log food:* "ate 2 eggs and toast"
📊 *Quick calories:* "500 cal"
🔍 *Barcode:* "bc 123456789"
📸 *Scan label:* Send nutrition label photo
📈 *Check status:* "today" or "status"

I'll track everything and show insights on your dashboard!`;
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
