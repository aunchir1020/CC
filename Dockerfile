# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# # Install system dependencies (bash for startup script)
# RUN apt-get update && apt-get install -y bash \
#     && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment variables
# Ensures print() statements and logs are visible instantly on Render’s log dashboard
ENV PYTHONUNBUFFERED=1