# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (bash for startup script)
RUN apt-get update && apt-get install -y bash \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create directory for database
RUN mkdir -p /app/data

# Expose ports
# 8000 for FastAPI backend
# 7860 for Gradio frontend
EXPOSE 8000 7860

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV API_URL=http://localhost:8000

# Copy startup script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Use startup script
CMD ["/app/start.sh"]