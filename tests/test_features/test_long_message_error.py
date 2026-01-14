"""
Test cases for user sending very long messages that exceed 1200 tokens
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

from conftest import client, test_session_id, sample_long_message
from database import ChatMessage, SessionLocal
from api import count_tokens, MAX_USER_MESSAGE_TOKENS

# Test handling of messages that exceed 1200 tokens
class TestLongMessageError:

    # Test that when a message exceeds 1200 tokens, the OpenAI API is not called.
    def test_long_message_does_not_call_openai_api(self, client, test_session_id, sample_long_message):
        # Send long message
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_long_message
            }
        )
        
        # Read streaming response
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        
        # Verify it's an error response, not a bot reply
        # Bot replies would contain content tokens, errors contain JSON error messages
        assert "error" in response_text.lower()
        # Should not contain typical bot response patterns
        assert "The message you submitted was too long" in response_text
    
    # Test that sending a message exceeding 1200 tokens returns the specific error message
    def test_user_sends_message_exceeding_1200_tokens_gets_error(self, client, test_session_id, sample_long_message):
        # Verify the message actually exceeds the limit
        token_count = count_tokens(sample_long_message)
        assert token_count > MAX_USER_MESSAGE_TOKENS, f"Test message should exceed {MAX_USER_MESSAGE_TOKENS} tokens, but has {token_count}"
        
        # Send long message
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_long_message
            }
        )
        
        # Response should still be 200 (streaming starts)
        assert response.status_code == 200
        
        # Read streaming response
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        
        # Verify error message is present
        assert "error" in response_text.lower()
        assert "The message you submitted was too long, please edit it and resubmit." in response_text
    
    # Test that a long message (exceeding 1200 tokens) is still saved to the database even though it returns an error, so it can be edited later.
    def test_long_message_is_saved_to_database_despite_error(self, client, test_session_id, sample_long_message):
        # Verify the message actually exceeds the limit
        token_count = count_tokens(sample_long_message)
        assert token_count > MAX_USER_MESSAGE_TOKENS, f"Test message should exceed {MAX_USER_MESSAGE_TOKENS} tokens, but has {token_count}"
        
        # Send long message
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_long_message
            }
        )
        
        # Read response to complete the request
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        
        # Verify error message is returned
        assert "error" in response_text.lower()
        assert "The message you submitted was too long, please edit it and resubmit." in response_text
        
        # Query database to verify the long message was saved despite the error
        db = SessionLocal()
        try:
            user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            assert user_msg is not None, "Long user message should be saved to database despite error"
            # Verify the message content in database matches what was sent to API
            assert user_msg.content == sample_long_message, f"User message content in database should match what was sent to API. Expected length: {len(sample_long_message)}, Got length: {len(user_msg.content) if user_msg else 0}"
            assert user_msg.session_id == test_session_id, "User message session_id should match"
            assert user_msg.role == "user", "User message role should be 'user'"
            assert user_msg.created_at is not None, "User message should have created_at timestamp"
            
            # Verify no bot message was saved (since API was not called)
            bot_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            assert bot_msg is None, "No bot message should be saved when message exceeds token limit (API not called)"
        finally:
            db.close()