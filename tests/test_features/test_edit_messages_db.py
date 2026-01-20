"""
Test cases for editing user messages with database verification
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

from conftest import client, test_session_id, sample_short_message, sample_long_message
from database import ChatMessage, SessionLocal
from api import count_tokens, MAX_USER_MESSAGE_TOKENS

# Test editing latest user message with database verification
class TestEditMessages:
    
    # Test that editing the latest user message updates the message content in database and regenerates bot response
    def test_edit_latest_user_message_updates_database(self, client, test_session_id):
        original_message = "What is Python?"
        edited_message = "What is JavaScript?"
        
        # Send original message and get bot response
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": original_message
            }
        )
        
        # Read first response
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Query database to get old user message and bot response
        db = SessionLocal()
        try:
            old_user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            old_bot_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            
            # Verify old messages exist
            assert old_user_msg is not None, "Original user message should exist in database"
            assert old_bot_msg is not None, "Original bot response should exist in database"
            assert old_user_msg.content == original_message, "Original user message content should match"
            
            old_user_id = old_user_msg.id
            old_user_created_at = old_user_msg.created_at
            old_bot_id = old_bot_msg.id
            old_bot_content = old_bot_msg.content
            old_bot_created_at = old_bot_msg.created_at
        finally:
            db.close()
        
        # Edit the message
        response2 = client.post(
            "/chat/edit/",
            json={
                "session_id": test_session_id,
                "message": edited_message
            }
        )
        
        assert response2.status_code == 200
        
        # Read edited response
        content2 = b""
        for chunk in response2.iter_bytes():
            if chunk:
                content2 += chunk
        
        # Query database again to verify changes
        db = SessionLocal()
        try:
            # Check user message was updated (not new record created)
            updated_user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.id == old_user_id)
                .first()
            )
            
            assert updated_user_msg is not None, "User message should still exist"
            assert updated_user_msg.content == edited_message, f"User message should be updated to '{edited_message}', got '{updated_user_msg.content}'"
            assert updated_user_msg.id == old_user_id, "User message ID should be same (update, not new record)"
            # Verify timestamp is unchanged (proves it's an update, not a new record)
            assert updated_user_msg.created_at == old_user_created_at, "User message created_at should be unchanged (proves update, not new record)"
            # Verify content actually changed
            assert updated_user_msg.content != original_message, "User message content should be different from original"
            
            # Check old bot message was deleted
            # Count all assistant messages - should be exactly 1 (old deleted, new created)
            all_assistant_msgs = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .all()
            )
            assert len(all_assistant_msgs) == 1, f"Should have exactly 1 assistant message after edit, got {len(all_assistant_msgs)}"
            
            # Verify the remaining message has different content (new message, not old one)
            remaining_bot_msg = all_assistant_msgs[0]
            # Verify timestamp is newer (proves it's a new message, not the old one)
            assert remaining_bot_msg.created_at > old_bot_created_at, "New bot message should have newer timestamp than old one"
            assert remaining_bot_msg.content != old_bot_content, "New bot response should be different from old one"
        finally:
            db.close()
    
    # Test that retry bot message works correctly after editing user message
    def test_retry_after_edit_uses_updated_user_message(self, client, test_session_id):
        original_message = "Explain Python"
        edited_message = "Explain JavaScript"
        
        # Send original message
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": original_message
            }
        )
        
        # Read first response
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Query database to get initial user message and bot response
        initial_user_id = None
        initial_user_created_at = None
        initial_bot_content = None
        initial_bot_id = None
        initial_bot_created_at = None
        
        db = SessionLocal()
        try:
            initial_user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            assert initial_user_msg is not None
            assert initial_user_msg.content == original_message

            initial_user_id = initial_user_msg.id
            initial_user_created_at = initial_user_msg.created_at
            
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
        
        # Ensure variables were set
        assert initial_user_id is not None, "Initial user message ID should be set"
        assert initial_user_created_at is not None, "Initial user message created_at should be set"
        
        # Edit user message
        response2 = client.post(
            "/chat/edit/",
            json={
                "session_id": test_session_id,
                "message": edited_message
            }
        )
        
        # Read edited response
        content2 = b""
        for chunk in response2.iter_bytes():
            if chunk:
                content2 += chunk
        
        # Verify edit updated database
        db = SessionLocal()
        try:
            updated_user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            assert updated_user_msg.content == edited_message, "User message should be updated"
            assert updated_user_msg.id == initial_user_id, "User message ID should be same (update, not new record)"
            # Verify user message timestamp is unchanged (proves update, not new record)
            assert updated_user_msg.created_at == initial_user_created_at, "User message created_at should be unchanged after edit (proves update)"
            # Verify content actually changed
            assert updated_user_msg.content != original_message, "User message content should be different from original"
            
            edited_bot_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "assistant")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            assert edited_bot_msg is not None

            edited_bot_id = edited_bot_msg.id
            edited_bot_content = edited_bot_msg.content
            edited_bot_created_at = edited_bot_msg.created_at

            # Verify edited bot message has newer timestamp than initial (proves it's a new message)
            assert edited_bot_created_at > initial_bot_created_at, "Edited bot message should have newer timestamp than initial"
        finally:
            db.close()
        
        # Retry bot message
        response3 = client.post(
            "/chat/retry/",
            json={
                "session_id": test_session_id,
                "message": ""
            }
        )
        
        assert response3.status_code == 200
        
        # Read retried response
        content3 = b""
        for chunk in response3.iter_bytes():
            if chunk:
                content3 += chunk
        
        # Verify retry updated database correctly
        db = SessionLocal()
        try:
            # Check old bot message (from edit) was deleted
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
            # Verify timestamp is newer than edited bot message (proves new message created)
            assert retried_bot_msg.created_at > edited_bot_created_at, "Retried bot message should have newer timestamp than edited one (proves new message)"
            assert retried_bot_msg.content != edited_bot_content, "Retried bot response should be different from edited one"
            
            # Verify user message is still the edited one (not reverted)
            final_user_msg = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .filter(ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .first()
            )
            assert final_user_msg.content == edited_message, "User message should still be the edited one after retry"
            assert final_user_msg.created_at == initial_user_created_at, "User message timestamp should still be unchanged (proves it wasn't reverted)"
        finally:
            db.close()