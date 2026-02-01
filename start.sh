#!/bin/bash

# Health Tracker - Docker Startup Script

echo "🚀 Health Tracker - Docker Setup"
echo "================================="
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first:"
    echo "   https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose found"
echo ""

# Check if .env exists
if [ ! -f backend/.env ]; then
    echo "⚠️  No .env file found in backend/"
    echo "Creating from .env.example..."
    cp backend/.env.example backend/.env
    echo "✅ Created backend/.env"
    echo "⚠️  Please edit backend/.env with your API keys before running"
    echo ""
fi

# Build and start
echo "🔨 Building and starting services..."
echo ""

docker-compose up --build -d

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Health Tracker is running!"
    echo ""
    echo "📱 Access the app:"
    echo "   Web App:     http://localhost:3000"
    echo "   API:         http://localhost:3001"
    echo "   API Health:  http://localhost:3001/api/health"
    echo ""
    echo "🗄️  Database:"
    echo "   Host:     localhost:5432"
    echo "   User:     health_tracker"
    echo "   Password: health_tracker_secret"
    echo "   Database: health_tracker"
    echo ""
    echo "📊 View logs:"
    echo "   docker-compose logs -f"
    echo ""
    echo "🛑 Stop services:"
    echo "   docker-compose down"
    echo ""
    echo "🧹 Clean up (removes database):"
    echo "   docker-compose down -v"
else
    echo ""
    echo "❌ Failed to start services"
    exit 1
fi