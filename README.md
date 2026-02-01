# Tharun's Health Tracker

A comprehensive health tracking web app that integrates with WHOOP for biometric data and provides multiple ways to log food intake.

## Features

- **WHOOP Integration**: Real-time sync of recovery, sleep, HRV, and strain data
- **Barcode Scanner**: Scan product barcodes to auto-populate nutrition info
- **OCR Label Scanner**: Take photos of nutrition labels to extract data automatically
- **WhatsApp Integration**: Text your food intake for hands-free logging
- **Dashboard**: Daily overview of calories, macros, and WHOOP metrics
- **Insights**: Correlation analysis between nutrition and recovery

## Tech Stack

- **Backend**: Node.js, Express, SQLite
- **Frontend**: React, Recharts
- **OCR**: Tesseract.js
- **Barcode**: html5-qrcode
- **Data**: Open Food Facts API (free)

## Quick Start

### 1. Clone and Setup
```bash
cd tharun-health-tracker
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env and add your WHOOP API key
npm install
npm start
```

### 3. Frontend Setup (new terminal)
```bash
cd frontend
npm install
npm start
```

### 4. Access
- Web app: http://localhost:3000
- API: http://localhost:3001

## Getting WHOOP API Key

1. Go to https://developer.whoop.com
2. Create an app
3. Get your API key
4. Add to `.env` file

## WhatsApp Setup (Optional)

1. Create a Twilio account at https://twilio.com
2. Enable WhatsApp sandbox
3. Add credentials to `.env`
4. Configure webhook URL to `https://your-domain/api/whatsapp/webhook`

## Usage

### Dashboard
View today's progress: calories consumed vs goal, macro breakdown, WHOOP recovery score.

### Barcode Scanner
Point camera at any product barcode to auto-fetch nutrition data from Open Food Facts database.

### Label Scanner
Take a photo of any nutrition label - OCR will extract calories, protein, carbs, and fat.

### WhatsApp Commands
Text your WhatsApp number:
- `"ate 2 eggs and toast"` - Log food by description
- `"bc 123456789"` - Lookup and log by barcode
- `"500 cal"` - Quick calorie entry
- `"today"` - Get today's summary
- `"help"` - Show all commands

### Insights
See correlations between your nutrition and WHOOP recovery metrics over time.

## Database

SQLite database stored at `database/health_tracker.db`

Tables:
- `whoop_metrics` - WHOOP data synced daily
- `food_logs` - All food entries
- `daily_summaries` - Aggregated daily stats
- `user_settings` - Goals and configuration

## Future Enhancements

- Mobile app (React Native)
- Push notifications
- Meal recommendations based on recovery
- Hydration tracking
- Weight/body composition tracking
- Export to CSV/PDF

## License

MIT
