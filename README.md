# Tharun's Health Tracker

A comprehensive health tracking web app that integrates with WHOOP for biometric data and provides multiple ways to log food intake.

## Features

- **WHOOP Integration**: Real-time sync of recovery, sleep, HRV, and strain data
- **Barcode Scanner**: Scan product barcodes to auto-populate nutrition info
- **OCR Label Scanner**: Take photos of nutrition labels to extract data automatically
- **WhatsApp Integration**: Text your food intake for hands-free logging
- **Oura Ring Integration**: OAuth + webhook-based near-real-time sync (about 30s after Oura app sync)
- **Garmin Watch Integration**: OAuth2 + webhook-driven updates with throttling-safe sync pipeline
- **Dashboard**: Daily overview of calories, macros, and WHOOP metrics
- **Insights**: Correlation analysis between nutrition and recovery

## Product Planning Docs

- Mobile-first planning playbook: `MOBILE_FIRST_SCREEN_PLANNING_PLAYBOOK.md`
- Per-screen spec template: `SCREEN_SPEC_TEMPLATE.md`
- Filled v1 screen specs (Home/Planner/Scan): `SCREEN_SPECS_V1.md`

## Tech Stack

- **Backend**: Node.js, Express, PostgreSQL
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
npm run dev
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

## Oura Setup (Optional, Recommended for near-real-time)

1. Create an OAuth app in Oura Cloud: `https://cloud.ouraring.com/oauth/applications`
2. Set these in `backend/.env`:
   - `OURA_CLIENT_ID`
   - `OURA_CLIENT_SECRET`
   - `OURA_REDIRECT_URI` (default: `http://localhost:3001/api/oura/callback`)
   - `OURA_WEBHOOK_URL` (must be public HTTPS URL)
   - `OURA_WEBHOOK_VERIFICATION_TOKEN` (your secret token)
3. Generate auth URL (while logged into this app): `GET /api/oura/auth-url`
4. Complete OAuth. Callback endpoint is `GET /api/oura/callback`.
5. Ensure subscriptions (optional manual trigger): `POST /api/oura/webhook/subscriptions/ensure`

Notes:
- Oura docs recommend webhooks over polling for real-time updates and to avoid rate limits.
- This integration uses webhook-first sync + rate-limit-aware API fetching with 429 backoff.

## Garmin Setup (Optional, Enterprise Program)

1. Apply to Garmin Connect Developer Program and get app credentials.
2. Set these in `backend/.env`:
   - `GARMIN_CLIENT_ID`
   - `GARMIN_CLIENT_SECRET`
   - `GARMIN_REDIRECT_URI` (default: `http://localhost:3001/api/garmin/callback`)
   - `GARMIN_WEBHOOK_SECRET` (if Garmin signing is enabled)
3. Generate auth URL while logged in: `GET /api/garmin/auth-url`
4. Complete OAuth callback at: `GET /api/garmin/callback`
5. Configure Garmin webhook target: `POST /api/garmin/webhook`
6. Optional manual pull (if Garmin grants pull endpoints): set `GARMIN_PULL_ENDPOINTS`

Notes:
- Garmin recommends event-driven integrations (notifications can arrive within seconds).
- Public docs do not publish a single numeric global rate limit; Garmin references throttled access in program docs.
- This implementation uses webhook-first updates, queueing, and retry/backoff for `429/503`.

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

PostgreSQL database (configured via `DATABASE_URL`)

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
