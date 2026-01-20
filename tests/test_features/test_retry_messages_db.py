"""
Test cases for retrying latest bot messages with database verification
"""

import pytest
import json
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
from database import ChatMessage, SessionLocal

# Test retrying latest bot message functionality with database verification
class TestRetryMessages:
    
    # Test that retrying the latest bot message deletes the old response in database and generates a new bot response
    def test_retry_latest_bot_message_regenerates_response(self, client, test_session_id, sample_short_message):
        # Send a message to get a bot response
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Read first bot response
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Query database to get initial bot response
        db = SessionLocal()
        try:
            initial_bot_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            assert initial_bot_msg is not None, "Initial bot response should exist in database"
            
            initial_bot_id = initial_bot_msg.id
            initial_bot_content = initial_bot_msg.content
            initial_bot_created_at = initial_bot_msg.created_at
        finally:
            db.close()
        
        # Retry the bot message
        response2 = client.post(
            "/chat/retry/",
            json={
                "session_id": test_session_id,
                "message": ""
            }
        )
        
        assert response2.status_code == 200
        assert response2.headers["content-type"] == "text/event-stream; charset=utf-8"
        
        # Read retried response
        content2 = b""
        for chunk in response2.iter_bytes():
            if chunk:
                content2 += chunk
        
        # Query database again to verify changes
        db = SessionLocal()
        try:
            # Check old bot message was deleted
            # Count all assistant messages - should be exactly 1 (old deleted, new created)
            all_assistant_msgs = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .all()
            )
            assert len(all_assistant_msgs) == 1, f"Should have exactly 1 assistant message after retry, got {len(all_assistant_msgs)}"
            
            # Get the retried bot message (should be the only one)
            retried_bot_msg = all_assistant_msgs[0]
            
            assert retried_bot_msg is not None, "Retried bot response should exist in database"
            assert len(retried_bot_msg.content) > 0, "Retried bot response should have content"
            # Verify timestamp is newer (proves it's a new message, not the old one)
            assert retried_bot_msg.created_at > initial_bot_created_at, "Retried bot message should have newer timestamp than initial (proves new message created)"
            assert retried_bot_msg.content != initial_bot_content, "Retried bot response should be different from initial one"
        finally:
            db.close()

    # Test that multiple retries of the same bot message can generate different responses and update database correctly
    def test_multiple_retries_generate_different_responses(self, client, test_session_id, sample_short_message):
        # Send message to get initial bot response
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
        
        # Query database to get initial bot response
        db = SessionLocal()
        try:
            initial_bot_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            assert initial_bot_msg is not None
            
            initial_bot_content = initial_bot_msg.content
            initial_bot_created_at = initial_bot_msg.created_at
        finally:
            db.close()
        
        # Retry multiple times and verify database updates
        previous_bot_content = initial_bot_content
        for i in range(2):
            retry_response = client.post(
                "/chat/retry/",
                json={
                    "session_id": test_session_id,
                    "message": ""
                }
            )
            
            # Read retried response
            content = b""
            for chunk in retry_response.iter_bytes():
                if chunk:
                    content += chunk
            
            # Query database after each retry
            db = SessionLocal()
            try:
                # Should have exactly 1 assistant message (old deleted, new created)
                all_assistant_msgs = (
                    db.query(ChatMessage)
                    .filter(ChatMessage.session_id == test_session_id)
                    .filter(ChatMessage.role == "assistant")
                    .all()
                )
                assert len(all_assistant_msgs) == 1, f"After retry {i+1}, should have exactly 1 assistant message, got {len(all_assistant_msgs)}"
                
                # Get the current bot message
                current_bot_msg = all_assistant_msgs[0]
                assert current_bot_msg.content != previous_bot_content, f"Retry {i+1} should generate different content"
                # Verify timestamp is newer than previous (proves new message created)
                if i == 0:
                    assert current_bot_msg.created_at > initial_bot_created_at, f"First retry should have newer timestamp than initial (proves new message)"
                else:
                    assert current_bot_msg.created_at > previous_bot_created_at, f"Retry {i+1} should have newer timestamp than previous retry (proves new message)"
                previous_bot_content = current_bot_msg.content
                previous_bot_created_at = current_bot_msg.created_at
            finally:
                db.close()