#!/bin/bash
set -e

echo "🚀 Starting Chattie Frontend (Gradio)..."

# Start Gradio frontend
# Render sets PORT environment variable - Gradio will use it automatically
python main.py