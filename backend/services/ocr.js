const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

class OCRService {
  constructor() {
    this.uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async extractNutritionFromImage(imagePath) {
    try {
      const result = await Tesseract.recognize(
        imagePath,
        'eng',
        {
          logger: m => console.log(m)
        }
      );

      const text = result.data.text;
      console.log('OCR Extracted Text:', text);

      // Parse nutrition info from text
      const nutrition = this.parseNutritionLabel(text);
      
      return {
        success: true,
        text: text,
        nutrition: nutrition,
        confidence: result.data.confidence
      };
    } catch (error) {
      console.error('OCR Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  parseNutritionLabel(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    const nutrition = {
      name: null,
      serving_size: null,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      fiber: null,
      sugar: null,
      sodium: null
    };

    // Extract product name (usually first line or near top)
    if (lines.length > 0) {
      nutrition.name = lines[0].replace(/[^a-zA-Z0-9\s]/g, '').trim();
    }

    // Look for nutrition patterns
    const patterns = {
      serving_size: /serving size[\s:]*(.+)/i,
      calories: /calories[\s:]*(\d+)/i,
      protein: /protein[\s:]*(\d+(?:\.\d+)?)\s*g/i,
      carbs: /total carbohydrate[s]?[\s:]*(\d+(?:\.\d+)?)\s*g/i,
      fat: /total fat[\s:]*(\d+(?:\.\d+)?)\s*g/i,
      fiber: /dietary fiber[\s:]*(\d+(?:\.\d+)?)\s*g/i,
      sugar: /total sugar[s]?[\s:]*(\d+(?:\.\d+)?)\s*g/i,
      sodium: /sodium[\s:]*(\d+)\s*mg/i
    };

    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match) {
        const value = match[1].trim();
        nutrition[key] = key === 'serving_size' || key === 'name' ? value : parseFloat(value);
      }
    }

    return nutrition;
  }

  saveUploadedFile(buffer, originalName) {
    const filename = `${Date.now()}_${originalName}`;
    const filepath = path.join(this.uploadDir, filename);
    fs.writeFileSync(filepath, buffer);
    return { filename, filepath: `/uploads/${filename}` };
  }
}

module.exports = new OCRService();
