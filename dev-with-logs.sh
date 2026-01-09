#!/bin/bash

# Create logs directory
LOGS_DIR="/tmp/al-ummah-logs"
mkdir -p "$LOGS_DIR"

# Clear old logs
rm -f "$LOGS_DIR"/*.log

echo "🚀 Starting Al Ummah Now with separate log files..."
echo "📂 Logs directory: $LOGS_DIR"
echo ""

# Start each app in background with separate log files
cd "$(dirname "$0")"

echo "Starting shared-types..."
pnpm --filter @al-ummah/shared-types dev > "$LOGS_DIR/shared-types.log" 2>&1 &
SHARED_PID=$!

echo "Starting web app..."
pnpm --filter @al-ummah/web dev > "$LOGS_DIR/web.log" 2>&1 &
WEB_PID=$!

echo "Starting api-videos..."
pnpm --filter @al-ummah/api-videos dev > "$LOGS_DIR/api-videos.log" 2>&1 &
API_PID=$!

echo "Starting processor..."
pnpm --filter @al-ummah/processor dev > "$LOGS_DIR/processor.log" 2>&1 &
PROC_PID=$!

echo "Starting websocket-server..."
pnpm --filter @al-ummah/websocket-server dev > "$LOGS_DIR/websocket.log" 2>&1 &
WS_PID=$!

# Save PIDs for cleanup
echo "$SHARED_PID $WEB_PID $API_PID $PROC_PID $WS_PID" > "$LOGS_DIR/pids.txt"

echo ""
echo "✅ All services started!"
echo ""
echo "📝 Log files:"
echo "   Shared Types:  tail -f $LOGS_DIR/shared-types.log"
echo "   Web:           tail -f $LOGS_DIR/web.log"
echo "   API Videos:    tail -f $LOGS_DIR/api-videos.log"
echo "   Processor:     tail -f $LOGS_DIR/processor.log"
echo "   WebSocket:     tail -f $LOGS_DIR/websocket.log"
echo ""
echo "🔍 View all logs:"
echo "   tail -f $LOGS_DIR/*.log"
echo ""
echo "🛑 Stop all services:"
echo "   kill \$(cat $LOGS_DIR/pids.txt)"
echo ""
echo "Waiting for services to start..."
sleep 10

echo ""
echo "📊 Service status:"
ps -p $SHARED_PID > /dev/null && echo "   ✅ shared-types (PID: $SHARED_PID)" || echo "   ❌ shared-types"
ps -p $WEB_PID > /dev/null && echo "   ✅ web (PID: $WEB_PID)" || echo "   ❌ web"
ps -p $API_PID > /dev/null && echo "   ✅ api-videos (PID: $API_PID)" || echo "   ❌ api-videos"
ps -p $PROC_PID > /dev/null && echo "   ✅ processor (PID: $PROC_PID)" || echo "   ❌ processor"
ps -p $WS_PID > /dev/null && echo "   ✅ websocket (PID: $WS_PID)" || echo "   ❌ websocket"
echo ""

# Keep script running
echo "Press Ctrl+C to stop all services..."
trap "echo ''; echo '🛑 Stopping all services...'; kill $SHARED_PID $WEB_PID $API_PID $PROC_PID $WS_PID 2>/dev/null; exit" INT TERM

# Wait for any child to exit
wait
