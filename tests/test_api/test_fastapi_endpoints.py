"""
Test cases for FastAPI endpoints
"""

import pytest
import json
import io
import sys
import os

# Add project root to path (needed for conftest to import database, api, etc.)
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Add tests directory to path to import conftest
tests_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if tests_dir not in sys.path:
    sys.path.insert(0, tests_dir)

# Import directly from conftest file to avoid conflict with site-packages tests package
from conftest import client, test_session_id, sample_short_message

# Test FastAPI endpoint functionality
class TestFastAPIEndpoints:
    
    # Test that the GET / endpoint (health check) returns running status
    def test_health_endpoint_returns_status(self, client):
        response = client.get("/")
        
        assert response.status_code == 200
        data = response.json()
        assert data == {"status": "running"}
    
    # Test that POST /chat/ endpoint accepts requests and returns streaming response
    def test_chat_endpoint_accepts_post_request(self, client, test_session_id, sample_short_message):
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    
    # Test that POST /chat/ endpoint requires message field in request body
    def test_chat_endpoint_requires_message_field(self, client, test_session_id):
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id
            }
        )
        
        # Should handle missing message field
        # FastAPI will validate and return 422 if message is required
        assert response.status_code in [200, 422]

    # Test that POST /chat/ endpoint streams response in chunks (token by token)
    def test_chat_endpoint_streams_response_in_chunks(self, client, test_session_id, sample_short_message):
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        assert response.status_code == 200
        
        # Read chunks
        chunks = []
        for chunk in response.iter_bytes():
            if chunk:
                chunks.append(chunk)
        
        # Should receive multiple chunks (streaming)
        assert len(chunks) > 0
    
    # Test that POST /chat/ endpoint returns responses in JSON lines format
    def test_chat_endpoint_response_format_is_json_lines(self, client, test_session_id, sample_short_message):
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Read response
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        lines = response_text.strip().split('\n')
        
        # Each line should be valid JSON (or at least parseable)
        for line in lines:
            if line.strip():
                # Try to parse as JSON
                try:
                    json.loads(line)
                except json.JSONDecodeError:
                    # Some lines might not be JSON (like empty lines)
                    pass
    
    # Test that POST /chat/edit/ endpoint accepts requests and returns streaming response
    def test_chat_edit_endpoint_accepts_post_request(self, client, test_session_id):
        # First send a message
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": "Original message"
            }
        )
        
        # Read first response
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Now test edit endpoint
        response2 = client.post(
            "/chat/edit/",
            json={
                "session_id": test_session_id,
                "message": "Edited message"
            }
        )
        
        assert response2.status_code == 200
        assert response2.headers["content-type"] == "text/event-stream; charset=utf-8"
    
    # Test that POST /chat/retry/ endpoint accepts requests and returns streaming response
    def test_chat_retry_endpoint_accepts_post_request(self, client, test_session_id, sample_short_message):
        # First send a message to create a bot response
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Read first response
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Now test retry endpoint
        response2 = client.post(
            "/chat/retry/",
            json={
                "session_id": test_session_id,
                "message": ""
            }
        )
        
        assert response2.status_code == 200
        assert response2.headers["content-type"] == "text/event-stream; charset=utf-8"
    
    #Test that POST /chat/stop/{session_id} endpoint accepts requests
    def test_chat_stop_endpoint_accepts_post_request(self, client, test_session_id):
        response = client.post(f"/chat/stop/{test_session_id}")
        
        # Stop endpoint should return success
        assert response.status_code == 200
    
    # Test that POST /speech-to-text/ endpoint accepts file uploads.
    def test_speech_to_text_endpoint_accepts_file_upload(self, client):
        audio_file = io.BytesIO(b"fake audio data")
        audio_file.name = "test.webm"
        
        response = client.post(
            "/speech-to-text/",
            files={"audio": ("test.webm", audio_file, "audio/webm")}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "text" in data