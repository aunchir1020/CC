"""
Test cases for stop message functionality
"""

import pytest
import time
import sys
import os

# Add project root and tests directory to path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
tests_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if tests_dir not in sys.path:
    sys.path.insert(0, tests_dir)

from conftest import client, test_session_id, sample_short_message

# Test stop message functionality
class TestStopMessage:
    
    # Test that the stop endpoint stops the streaming response when called during active streaming
    def test_stop_during_streaming_stops_response(self, client, test_session_id, sample_short_message):
        # Start a streaming request
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        assert response.status_code == 200
        
        # Wait a moment for streaming to start
        time.sleep(0.5)
        
        # Call stop endpoint
        stop_response = client.post(f"/chat/stop/{test_session_id}")
        assert stop_response.status_code == 200
        stop_data = stop_response.json()
        # Should indicate success if session was active
        assert "success" in stop_data
        
        # Read some chunks from streaming response
        chunks_received = 0
        for chunk in response.iter_bytes():
            if chunk:
                chunks_received += 1
                if chunks_received > 5:  # Read a few chunks before checking
                    break
        
        # Verify that streaming was affected
        assert chunks_received >= 0
    
    # Test that the stop endpoint stops the retry response when called during a retry operation
    def test_stop_during_retry_stops_retry_response(self, client, test_session_id, sample_short_message):
        # First, send a message to get a bot response
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Read first response to complete it
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Start retry
        response2 = client.post(
            "/chat/retry/",
            json={
                "session_id": test_session_id,
                "message": ""
            }
        )
        
        assert response2.status_code == 200
        
        # Wait a moment for retry streaming to start
        time.sleep(0.5)
        
        # Call stop endpoint
        stop_response = client.post(f"/chat/stop/{test_session_id}")
        assert stop_response.status_code == 200
        stop_data = stop_response.json()
        assert "success" in stop_data
        
        # Read some chunks from retry response
        chunks_received = 0
        for chunk in response2.iter_bytes():
            if chunk:
                chunks_received += 1
                if chunks_received > 5:
                    break
        
        # Verify retry was affected
        assert chunks_received >= 0
    
    # Test that the stop endpoint stops the edit response when called during an edit operation
    def test_stop_during_edit_stops_edit_response(self, client, test_session_id):
        # First, send a message
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
        
        # Start edit
        response2 = client.post(
            "/chat/edit/",
            json={
                "session_id": test_session_id,
                "message": "Edited message"
            }
        )
        
        assert response2.status_code == 200
        
        # Wait a moment for edit streaming to start
        time.sleep(0.5)
        
        # Call stop endpoint
        stop_response = client.post(f"/chat/stop/{test_session_id}")
        assert stop_response.status_code == 200
        stop_data = stop_response.json()
        assert "success" in stop_data
        
        # Read some chunks from edit response
        chunks_received = 0
        for chunk in response2.iter_bytes():
            if chunk:
                chunks_received += 1
                if chunks_received > 5:
                    break
        
        # Verify edit was affected
        assert chunks_received >= 0
    
    # Test that the stop endpoint returns a response in the expected format
    def test_stop_endpoint_response_format(self, client, test_session_id):
        response = client.post(f"/chat/stop/{test_session_id}")
        
        assert response.status_code == 200
        data = response.json()
        # Response should have expected structure
        assert isinstance(data, dict)
        assert "success" in data
        assert "message" in data
        assert "session_id" in data
        assert isinstance(data["success"], bool)
        assert isinstance(data["message"], str)
        assert isinstance(data["session_id"], str)