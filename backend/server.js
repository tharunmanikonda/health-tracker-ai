require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const path = require('path');

const db = require('./database');
const { router: authRouter, authenticateToken } = require('./routes/auth');
const whoopRoutes = require('./routes/whoop');
const foodRoutes = require('./routes/food');
const dashboardRoutes = require('./routes/dashboard');
const whatsappRoutes = require('./routes/whatsapp');
const mobileRoutes = require('./routes/mobile');
const wearablesRoutes = require('./routes/wearables');
const aiCoachRoutes = require('./routes/aiCoach');
const whoopService = require('./services/whoop');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize database
db.init();

// Public routes (no auth required)
app.use('/api/auth', authRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes middleware
app.use('/api', authenticateToken);

// Protected routes
app.use('/api/whoop', whoopRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/wearables', wearablesRoutes);
app.use('/api/ai-coach', aiCoachRoutes);

// Tracking routes - mounted at root /api for frontend compatibility
app.use('/api/water', authenticateToken, (req, res, next) => {
  if (req.path === '/today') req.url = '/water/today';
  if (req.path === '/log') req.url = '/water/log';
  next();
}, foodRoutes);

app.use('/api/weight', authenticateToken, (req, res, next) => {
  if (req.path === '/history') req.url = '/weight/history';
  if (req.path === '/latest') req.url = '/weight/latest';
  if (req.path === '/log') req.url = '/weight/log';
  next();
}, foodRoutes);

app.use('/api/mood', authenticateToken, (req, res, next) => {
  if (req.path === '/history') req.url = '/mood/history';
  if (req.path === '/today') req.url = '/mood/today';
  if (req.path === '/log') req.url = '/mood/log';
  next();
}, foodRoutes);

app.use('/api/sleep', authenticateToken, (req, res, next) => {
  if (req.path === '/history') req.url = '/sleep/history';
  if (req.path === '/today') req.url = '/sleep/today';
  if (req.path === '/log') req.url = '/sleep/log';
  next();
}, foodRoutes);

app.use('/api/workouts', authenticateToken, (req, res, next) => {
  if (req.path === '/history') req.url = '/workouts/history';
  if (req.path === '/manual') req.url = '/workouts/manual';
  next();
}, foodRoutes);

app.use('/api/meds', authenticateToken, (req, res, next) => {
  if (req.path === '/history') req.url = '/meds/history';
  if (req.path === '/today') req.url = '/meds/today';
  if (req.path === '/log') req.url = '/meds/log';
  next();
}, foodRoutes);

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Auto-sync WHOOP data every 15 minutes (protected - only for authenticated users)
cron.schedule('*/15 * * * *', async () => {
  console.log('[CRON] Syncing WHOOP data...');
  try {
    await whoopService.syncLatestData();
    console.log('[CRON] WHOOP sync complete');
  } catch (err) {
    console.error('[CRON] WHOOP sync failed:', err.message);
  }
});

// SPA catch-all: serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/api/dashboard/today`);
});
