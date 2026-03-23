#!/bin/bash
# SyncRoom Start Script
# Starts both backend and frontend and shows access URLs

set -e

echo "🚀 Starting SyncRoom..."
echo ""

# Get network IP
IP=$(hostname -I | awk '{print $1}')

# Kill any existing instances
pkill -f "uvicorn app.main" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 1

# Start backend
echo "📡 Starting backend..."
cd "$(dirname $0)/backend"
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
sleep 2

# Start frontend  
echo "🎨 Starting frontend..."
cd "$(dirname $0)/frontend"
npm run dev -- -p 3000 -H 0.0.0.0 &
FRONTEND_PID=$!
sleep 3

echo ""
echo "════════════════════════════════════════════════"
echo "  ✅ SyncRoom is running!"
echo "════════════════════════════════════════════════"
echo ""
echo "  🖥️  From THIS PC:"
echo "     Frontend: http://localhost:3000"
echo "     Backend:  http://localhost:8000"
echo ""
echo "  📱 From MOBILE (same WiFi or hotspot):"
echo "     Frontend: http://${IP}:3000"
echo "     Backend:  http://${IP}:8000"
echo ""
echo "  💡 TIP: If college WiFi blocks device-to-device,"
echo "     connect both PC and phone to your PHONE HOTSPOT."
echo ""
echo "  Press Ctrl+C to stop everything."
echo "════════════════════════════════════════════════"

# Wait for either to exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
