# 🐳 Docker Setup for Health Tracker

Run the entire Health Tracker stack with one command - no manual database setup needed!

## 🚀 Quick Start

```bash
# 1. Clone/navigate to the project
cd tharun-health-tracker

# 2. Run the startup script
./start.sh

# Or manually:
docker-compose up --build -d
```

That's it! The app will be available at:
- **Web App**: http://localhost:3000
- **API**: http://localhost:3001
- **API Health Check**: http://localhost:3001/api/health

## 📋 What's Included

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| **PostgreSQL** | postgres:16-alpine | 5432 | Database - auto-initialized |
| **Backend API** | Node 20 Alpine | 3001 | Express API server |
| **Frontend** | Nginx Alpine | 3000 | React web app |

## 🔧 Configuration

### Environment Variables

Create `backend/.env` (or copy from `.env.example`):

```bash
# Required - auto-generated if not set
JWT_SECRET=your-super-secret-key

# Optional - for wearable integrations
WHOOP_CLIENT_ID=your_whoop_id
WHOOP_CLIENT_SECRET=your_whoop_secret

FITBIT_CLIENT_ID=your_fitbit_id
FITBIT_CLIENT_SECRET=your_fitbit_secret

GOOGLE_CLIENT_ID=your_google_id
GOOGLE_CLIENT_SECRET=your_google_secret

# Optional - for AI Coach
KIMI_API_KEY=your_kimi_key
# or
OPENAI_API_KEY=your_openai_key
```

### Database Connection

The backend automatically connects to PostgreSQL:
```
Host: postgres (container name)
Port: 5432
User: health_tracker
Password: health_tracker_secret
Database: health_tracker
```

No manual setup needed - tables are created automatically on first run!

## 🛠️ Common Commands

```bash
# Start all services
docker-compose up -d

# Start with rebuild (after code changes)
docker-compose up --build -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f postgres

# Stop services
docker-compose down

# Stop and remove database (clean slate)
docker-compose down -v

# Restart a service
docker-compose restart backend

# Execute commands in containers
docker-compose exec backend sh
docker-compose exec postgres psql -U health_tracker -d health_tracker
```

## 📁 Volumes

Data is persisted using Docker volumes:

- `postgres_data` - PostgreSQL database files
- `./backend/uploads` - Uploaded images (OCR scans)

## 🔍 Troubleshooting

### Services won't start
```bash
# Check logs
docker-compose logs

# Check specific service
docker-compose logs backend
```

### Database connection issues
```bash
# Check if postgres is healthy
docker-compose ps

# Restart postgres
docker-compose restart postgres
```

### Port already in use
```bash
# Check what's using port 3000 or 3001
lsof -i :3000
lsof -i :3001

# Kill the process or change ports in docker-compose.yml
```

### Reset everything
```bash
# Stop and remove all data
docker-compose down -v

# Rebuild from scratch
docker-compose up --build -d
```

## 🏗️ Production Deployment

For production, update these in `docker-compose.yml`:

1. **Change default passwords**:
   ```yaml
   environment:
     POSTGRES_PASSWORD: your-strong-password-here
   ```

2. **Use proper JWT secret**:
   ```yaml
   environment:
     JWT_SECRET: use-a-random-64-char-string
   ```

3. **Enable SSL**:
   ```yaml
   environment:
     DATABASE_SSL: "true"
   ```

4. **Use tagged images instead of latest**:
   ```yaml
   services:
     backend:
       image: your-registry/health-tracker-backend:v1.0.0
   ```

## 💾 Database Backup/Restore

```bash
# Backup
docker-compose exec postgres pg_dump -U health_tracker health_tracker > backup.sql

# Restore
docker-compose exec -T postgres psql -U health_tracker health_tracker < backup.sql
```

## 🌐 Accessing Database Locally

```bash
# Connect with psql (if installed locally)
psql -h localhost -p 5432 -U health_tracker -d health_tracker

# Or use Docker
docker-compose exec postgres psql -U health_tracker -d health_tracker
```

Default password: `health_tracker_secret`

## 📱 Mobile App Development

The mobile app (React Native) is NOT included in Docker - it's built separately:

```bash
cd mobile
npm install
# iOS: npx react-native run-ios
# Android: npx react-native run-android
```

Point the mobile app to your Docker backend:
- iOS Simulator: `http://localhost:3001`
- Android Emulator: `http://10.0.2.2:3001`
- Physical device: Use your computer's local IP

## 🧪 Development Mode

For active development with hot reload:

```bash
# Terminal 1 - Database only
docker-compose up postgres -d

# Terminal 2 - Backend (with nodemon)
cd backend
npm install
npm run dev

# Terminal 3 - Frontend (with Vite)
cd frontend
npm install
npm run dev
```

## 📊 Resource Usage

Approximate resource usage:

| Service | CPU | Memory | Storage |
|---------|-----|--------|---------|
| PostgreSQL | Low | 100MB | 1GB+ (grows with data) |
| Backend | Low-Medium | 150MB | Minimal |
| Frontend | Low | 20MB | Minimal |
| **Total** | **Low** | **~300MB** | **~1GB** |

## 🔒 Security Notes

- Default passwords should be changed for production
- JWT_SECRET should be a strong random string
- API keys should never be committed to git
- Use HTTPS in production (via reverse proxy)
- Database is not exposed externally by default

## 🆘 Support

If you encounter issues:
1. Check logs: `docker-compose logs`
2. Verify ports are free: `lsof -i :3000,3001,5432`
3. Reset: `docker-compose down -v && docker-compose up --build`
4. Check Docker resources: Docker Desktop > Settings > Resources