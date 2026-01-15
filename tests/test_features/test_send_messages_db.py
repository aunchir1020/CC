"""
Test cases for user sending messages and receiving bot replies via OpenAI with database verification
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

# Test user sending messages and receiving bot replies
class TestUserSendMessages:

    # Test that a user can send a short message and receive a reply from the bot via OpenAI
    # Verifies the complete flow: message submission, API call, streaming response, and database storage.
    def test_user_sends_short_message_and_receives_bot_reply(self, client, test_session_id, sample_short_message):
        # Send message to chat endpoint
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Verify response is streaming
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
        
        # Read streaming response and parse bot message content
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        # Parse streaming response to extract bot message content
        response_text = content.decode('utf-8')
        lines = response_text.strip().split('\n')
        
        # Extract bot message from API response
        api_bot_message = ""
        for line in lines:
            if line.strip():
                try:
                    data = json.loads(line)
                    if "error" in data:
                        # If there's an error, then fail the test
                        pytest.fail(f"API returned error: {data['error']}")
                    elif "token" in data:
                        # Accumulate tokens to build the full message
                        api_bot_message += data["token"]
                    elif "stopped" in data and data.get("stopped"):
                        # If stopped, use partial_content if available
                        if "partial_content" in data:
                            api_bot_message = data["partial_content"]
                except json.JSONDecodeError:
                    # Skip invalid JSON lines
                    continue
        
        # Verify API response contains bot message content
        assert len(api_bot_message) > 0, "API should return bot message content"
        
        # Query database to verify user message was saved and matches what was sent to API
        db = SessionLocal()
        try:
            user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            assert user_msg is not None, "User message should be saved to database"
            # Verify user message content in database matches what was sent to API
            assert user_msg.content == sample_short_message, f"User message content in database should match what was sent to API. Expected: '{sample_short_message}', Got: '{user_msg.content}'"
            assert user_msg.session_id == test_session_id, "User message session_id should match"
            assert user_msg.role == "user", "User message role should be 'user'"
            assert user_msg.created_at is not None, "User message should have created_at timestamp"
            
            # Query database to verify bot message was saved and matches what was received from API
            bot_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            assert bot_msg is not None, "Bot message should be saved to database"
            assert len(bot_msg.content) > 0, "Bot message should have content"
            # Verify bot message content in database matches what was received from API
            assert bot_msg.content == api_bot_message, f"Bot message content in database should match what was received from API. Expected: '{api_bot_message}', Got: '{bot_msg.content}'"
            assert bot_msg.session_id == test_session_id, "Bot message session_id should match"
            assert bot_msg.role == "assistant", "Bot message role should be 'assistant'"
            assert bot_msg.created_at is not None, "Bot message should have created_at timestamp"
            # Verify bot message timestamp is after user message timestamp
            assert bot_msg.created_at >= user_msg.created_at, "Bot message should be created after or at the same time as user message"
        finally:
            db.close()