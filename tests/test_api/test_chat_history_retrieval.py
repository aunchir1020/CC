"""
Test that chat history for a session is retrieved from SQLite
within the max history token limit and sent to the OpenAI API.
"""

import pytest
import sys
import os

# Add project root and tests directory to path
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
tests_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if tests_dir not in sys.path:
    sys.path.insert(0, tests_dir)

from conftest import client, test_session_id  # noqa: E402
from database import ChatMessage, SessionLocal  # noqa: E402
from api import count_tokens, count_message_tokens, MAX_HISTORY_TOKENS  # noqa: E402


class TestChatHistoryStorage:
    # Test that when a session has a long history in the SQLite DB,
    # the backend retrieves the history for that session, truncates it
    # to the most recent messages within MAX_HISTORY_TOKENS, and sends
    # exactly that slice to the OpenAI API.
    def test_chat_history_truncated_to_max_tokens_and_sent_to_api(
        self,
        client,
        test_session_id,
        monkeypatch,
    ):
        # Seed the database with a long history for this session
        db = SessionLocal()
        try:
            # Ensure a clean slate for this session
            db.query(ChatMessage).filter(ChatMessage.session_id == test_session_id).delete()
            db.commit()

            # Create many messages so total tokens > MAX_HISTORY_TOKENS
            base_text = "This is a token-rich message used for history testing. " * 5
            seeded_messages = []
            for i in range(180):
                role = "user" if i % 2 == 0 else "assistant"
                content = f"History message {i}: " + base_text
                msg = ChatMessage(
                    session_id=test_session_id,
                    role=role,
                    content=content,
                )
                db.add(msg)
                seeded_messages.append(msg)
            db.commit()
        finally:
            db.close()

        # Monkeypatch OpenAI client to capture messages sent to the API
        captured = {}

        import api  # Import here so monkeypatch targets the same module used by the app

        def fake_create(model, messages, stream, max_tokens):
            # Capture the messages that backend sends to OpenAI
            captured["messages"] = list(messages)

            class DummyStream:
                def __iter__(self_inner):
                    # No actual streaming content is needed for this test
                    return iter([])

            return DummyStream()

        monkeypatch.setattr(api.client.chat.completions, "create", fake_create)

        # Send a new message to trigger chat_stream and history retrieval
        new_user_message = "Final question that should see truncated history."
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": new_user_message,
            },
        )

        # Drain the streaming response to let the backend finish
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk

        assert response.status_code == 200
        # Ensure our fake OpenAI client was actually called
        assert "messages" in captured, "OpenAI API was not called by chat_stream"

        # Load full history from DB and reconstruct what the backend should use
        db = SessionLocal()
        try:
            all_messages = (
                db.query(ChatMessage)
                .filter(ChatMessage.session_id == test_session_id)
                .order_by(ChatMessage.created_at)
                .all()
            )
        finally:
            db.close()

        # Convert DB rows to chat history format used by the backend
        full_history = [{"role": m.role, "content": m.content} for m in all_messages]

        # Full history should be larger than the token limit so truncation is meaningful
        # Use count_message_tokens to match backend's calculation (includes role + overhead)
        full_tokens = sum(count_message_tokens(msg) for msg in full_history)
        assert full_tokens > MAX_HISTORY_TOKENS, (
            f"Seeded history should exceed MAX_HISTORY_TOKENS={MAX_HISTORY_TOKENS}, "
            f"but has only {full_tokens} tokens"
        )

        # Reproduce the backend's truncation logic here to compute the expected slice
        # Use count_message_tokens to match backend's calculation
        total_tokens = 0
        expected_truncated = []
        for msg in reversed(full_history):
            msg_tokens = count_message_tokens(msg)
            if total_tokens + msg_tokens <= MAX_HISTORY_TOKENS:
                expected_truncated.insert(0, msg)
                total_tokens += msg_tokens
            else:
                break

        # Sanity check: expected_truncated should be a suffix of full_history
        assert expected_truncated == full_history[-len(expected_truncated) :]

        # Compare with what was actually sent to the OpenAI API
        sent_to_api = captured["messages"]

        # The backend should send exactly the truncated history slice
        assert sent_to_api == expected_truncated, (
            "Chat history sent to OpenAI does not match the expected "
            "truncated suffix of the session history"
        )

        # And the total tokens of what was sent must be within the limit
        # Use count_message_tokens to match backend's calculation
        sent_tokens = sum(count_message_tokens(msg) for msg in sent_to_api)
        assert sent_tokens <= MAX_HISTORY_TOKENS, (
            f"Chat history sent to OpenAI has {sent_tokens} tokens, "
            f"which exceeds the MAX_HISTORY_TOKENS={MAX_HISTORY_TOKENS}"
        )
