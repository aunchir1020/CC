#!/bin/bash
set -e

echo "🚀 Starting Chattie Application..."

# Start FastAPI backend in background
echo "📡 Starting FastAPI backend on port 8000..."
python -m uvicorn api:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be ready
echo "⏳ Waiting for backend to start..."
sleep 5

# Check if backend is running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend failed to start!"
    exit 1
fi

echo "✅ Backend is running (PID: $BACKEND_PID)"

# Start Gradio frontend
echo "🎨 Starting Gradio frontend on port 7860..."
python main.py

# Keep container running
wait $BACKEND_PID
