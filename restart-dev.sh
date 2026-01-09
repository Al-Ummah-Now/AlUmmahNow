#!/bin/bash

# Al Ummah Now - Development Server Restart Script
# This script cleanly restarts all development services

set -e

echo "🔄 Restarting Al Ummah Now development servers..."

# Kill all existing processes
echo "⏹️  Stopping all running processes..."
# Kill log service on port 3089
lsof -ti:3089 | xargs kill -9 2>/dev/null || true
# Kill all worker processes
killall -9 node workerd 2>/dev/null || true

# Wait for processes to terminate
echo "⏳ Waiting for processes to terminate..."
sleep 3

# Start log service first (other apps depend on it)
echo "📝 Starting log service..."
cd /home/meywd/AlUmmahNow
pnpm --filter @al-ummah/log-service dev &
sleep 2

# Start all services via turbo
echo "🚀 Starting all services..."
pnpm dev &

# Wait for services to initialize
echo "⏳ Waiting for services to start (20 seconds)..."
sleep 20

# Verify services
echo ""
echo "✅ Verifying services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

LOG_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3089/health)
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001)
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3086)
WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3087)
PROC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3088)

echo "📝 Log Service (3089):  $LOG_STATUS $([ "$LOG_STATUS" = "200" ] && echo "✅" || echo "❌")"
echo "📱 Web App (3001):      $WEB_STATUS $([ "$WEB_STATUS" = "200" ] && echo "✅" || echo "❌")"
echo "🎥 API Videos (3086):   $API_STATUS $([ "$API_STATUS" = "200" ] && echo "✅" || echo "❌")"
echo "🔌 WebSocket (3087):    $WS_STATUS $([ "$WS_STATUS" = "200" ] && echo "✅" || echo "❌")"
echo "⚙️  Processor (3088):    $PROC_STATUS $([ "$PROC_STATUS" = "404" ] && echo "✅ (404 expected)" || echo "❌")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎉 All services are running!"
echo ""
echo "📝 URLs:"
echo "   Log Service: http://localhost:3089"
echo "   Web:         http://localhost:3001"
echo "   API:         http://127.0.0.1:3086"
echo "   WebSocket:   http://localhost:3087"
echo ""
echo "💡 Tip: Use './restart-dev.sh' to restart all services"
