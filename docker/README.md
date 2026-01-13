# Docker Deployment Files

This folder contains all Docker-related deployment files and documentation.

## Files in this folder

- **start.sh** - Startup script that runs both FastAPI backend and Gradio frontend
- **env.example** - Template for environment variables
- **railway.json** - Railway platform deployment configuration
- **render.yaml** - Render platform deployment configuration
- **DEPLOYMENT.md** - Complete deployment guide with step-by-step instructions
- **README.md** - This file

## Files in root directory

- **Dockerfile** - Main Docker configuration (kept in root for cloud platform auto-detection)
- **.dockerignore** - Files to exclude from Docker builds
- **requirements.txt** - Python dependencies

## Quick Start

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.

### Railway
1. Push code to GitHub
2. Connect repo to Railway
3. Set `OPENAI_API_KEY` environment variable
4. Deploy!

### Render
1. Push code to GitHub
2. Create new Web Service on Render
3. Connect GitHub repo
4. Set `OPENAI_API_KEY` environment variable
5. Deploy!

## Environment Variables

Required:
- `OPENAI_API_KEY` - Your OpenAI API key

Optional (with defaults):
- `API_URL` - Backend URL (default: `http://localhost:8000`)
- `GRADIO_SERVER_NAME` - Server host (default: `0.0.0.0`)
- `GRADIO_SERVER_PORT` - Server port (default: `7860`)

See [env.example](./env.example) for the complete template.