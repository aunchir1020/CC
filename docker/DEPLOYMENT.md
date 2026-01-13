# Deployment Guide for Chattie

This guide explains how to deploy Chattie to cloud platforms without installing Docker locally.

## Prerequisites

1. GitHub account (to host your code)
2. Account on a cloud platform (Railway, Render, etc.)
3. OpenAI API key

## Quick Start

### Option 1: Railway (Recommended - Easiest)

1. **Push your code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo-url>
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will automatically detect the Dockerfile and deploy

3. **Set Environment Variables**
   - In Railway dashboard, go to "Variables"
   - Add: `OPENAI_API_KEY` = your OpenAI API key
   - Optionally set `API_URL` if needed

4. **Get your URL**
   - Railway will provide a public URL
   - Your app will be available at that URL

### Option 2: Render

1. **Push your code to GitHub** (same as above)

2. **Deploy on Render**
   - Go to [render.com](https://render.com)
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Render will auto-detect the Dockerfile

3. **Configure**
   - Build Command: (auto-detected from Dockerfile)
   - Start Command: `/app/start.sh`
   - Environment Variables:
     - `OPENAI_API_KEY`: your OpenAI API key

4. **Deploy**
   - Click "Create Web Service"
   - Render will build and deploy your app

### Option 3: Google Cloud Run

1. **Push to GitHub**

2. **Use Cloud Build**
   - Go to Google Cloud Console
   - Enable Cloud Build API
   - Create a trigger that builds from your GitHub repo
   - Cloud Build will use your Dockerfile

3. **Deploy to Cloud Run**
   - After build, deploy the container to Cloud Run
   - Set environment variables in Cloud Run settings

## Environment Variables

Required:
- `OPENAI_API_KEY`: Your OpenAI API key

Optional:
- `API_URL`: Backend API URL (defaults to `http://localhost:8000`)
- `GRADIO_SERVER_NAME`: Server hostname (defaults to `0.0.0.0`)
- `GRADIO_SERVER_PORT`: Server port (defaults to `7860`)

## Local Testing with Docker (Optional)

If you want to test Docker locally (requires Docker Desktop):

```bash
# Build the image
docker build -t chattie-app .

# Run the container
docker run -p 8000:8000 -p 7860:7860 \
  -e OPENAI_API_KEY=your_key_here \
  chattie-app
```

Then visit `http://localhost:7860`

## Troubleshooting

### Backend not starting
- Check logs in your cloud platform dashboard
- Ensure `OPENAI_API_KEY` is set correctly
- Verify ports 8000 and 7860 are exposed

### Frontend can't connect to backend
- In cloud deployments, both services run in the same container
- `API_URL` should be `http://localhost:8000` (internal)
- The startup script ensures backend starts before frontend

### Database issues
- SQLite database (`chat.db`) is created automatically
- In cloud deployments, consider using a persistent volume for the database

## Notes

- The Dockerfile runs both FastAPI (backend) and Gradio (frontend) in one container
- For production, consider separating them into two services for better scaling
- The startup script (`start.sh`) ensures the backend starts before the frontend
- Both services must be accessible on the same domain/port in cloud deployments