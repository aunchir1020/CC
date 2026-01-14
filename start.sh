#!/bin/bash
set -e

echo "🚀 Starting Chattie Application..."
echo "📡 Starting FastAPI with Gradio mounted..."

# Use Render's PORT if available, otherwise default to 8000
PORT=${PORT:-8000}

# Start FastAPI (with Gradio mounted)
# Both backend API and frontend UI are served from the same port
python -m uvicorn api:app --host 0.0.0.0 --port $PORT