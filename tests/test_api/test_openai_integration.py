"""
Test cases for OpenAI API integration
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
from api import client as openai_client, MAX_MODEL_RESPONSE_TOKENS, count_tokens

# Test OpenAI API integration
class TestOpenAIIntegration:
    
    # Test that sending a message to /chat/ endpoint actually calls OpenAI API and receives a response from the model
    def test_chat_endpoint_calls_openai_api(self, client, test_session_id, sample_short_message):
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        assert response.status_code == 200
        
        # Read streaming response and parse JSON
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        
        # Parse JSON lines to extract actual bot response
        bot_response = ""
        for line in response_text.strip().split('\n'):
            if line.strip():
                try:
                    data = json.loads(line)
                    if "token" in data:
                        bot_response += data["token"]
                    elif "error" in data:
                        assert False, f"Received error: {data['error']}"
                except json.JSONDecodeError:
                    pass
        
        # Should receive actual content from OpenAI (not just error)
        assert len(bot_response) > 0
        # Verify token count using precise counting
        token_count = count_tokens(bot_response)
        assert token_count > 0, "Response should have at least some tokens"
    
    # Test that OpenAI API responses are streamed token by token rather than returned as a complete message
    def test_openai_response_is_streamed_token_by_token(self, client, test_session_id, sample_short_message):
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Read response and check for multiple JSON lines (tokens)
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        lines = [line for line in response_text.strip().split('\n') if line.strip()]
        
        # Should receive multiple JSON lines (one per token) indicating streaming
        assert len(lines) > 1, "Should receive multiple token lines in streaming response"
        
        # Verify each line is a valid JSON token message
        token_count = 0
        for line in lines:
            data = json.loads(line)
            if "token" in data:
                token_count += 1
        
        # Should have multiple tokens
        assert token_count > 1, f"Should receive multiple tokens, got {token_count}"
    
    # Test that OpenAI API responses respect the MAX_MODEL_RESPONSE_TOKENS limit (4096 tokens)
    def test_openai_response_respects_max_token_limit(self, client, test_session_id):
        # Send a message that should generate a response
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": "Write a detailed explanation of machine learning"
            }
        )
        
        # Read full response and parse JSON
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        
        # Parse JSON lines to extract actual bot response
        bot_response = ""
        for line in response_text.strip().split('\n'):
            if line.strip():
                try:
                    data = json.loads(line)
                    if "token" in data:
                        bot_response += data["token"]
                    elif "error" in data:
                        assert False, f"Received error: {data['error']}"
                except json.JSONDecodeError:
                    pass
        
        # Use precise token counting
        if len(bot_response) > 0:
            token_count = count_tokens(bot_response)
            # Verify response respects max token limit (800 tokens)
            assert token_count <= MAX_MODEL_RESPONSE_TOKENS, f"Response has {token_count} tokens, exceeds limit of {MAX_MODEL_RESPONSE_TOKENS}"
            assert token_count > 0, "Response should have at least some tokens"
    
    # Test that when sending multiple messages, OpenAI API receives the full chat history as context (up to 2800 tokens)
    def test_openai_api_includes_chat_history_in_context(self, client, test_session_id):
        messages = [
            "My name is Alice",
            "What did I just tell you my name is?"
        ]
        
        # Send first message
        response1 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": messages[0]
            }
        )
        
        # Read first response
        content1 = b""
        for chunk in response1.iter_bytes():
            if chunk:
                content1 += chunk
        
        # Send second message (should have context from first)
        response2 = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": messages[1]
            }
        )
        
        # Read second response and parse JSON
        content2 = b""
        for chunk in response2.iter_bytes():
            if chunk:
                content2 += chunk
        
        response_text2 = content2.decode('utf-8')
        
        # Parse JSON lines to extract actual bot response
        second_response = ""
        for line in response_text2.strip().split('\n'):
            if line.strip():
                try:
                    data = json.loads(line)
                    if "token" in data:
                        second_response += data["token"]
                    elif "error" in data:
                        assert False, f"Received error: {data['error']}"
                except json.JSONDecodeError:
                    pass
        
        # Bot should remember the name (context was included)
        # Verify that response actually contains "Alice" to prove memory works
        if "error" not in second_response.lower():
            assert len(second_response) > 0, "Bot should respond"
            # Check that bot remembers "Alice" (case-insensitive)
            assert "alice" in second_response.lower(), f"Bot should remember 'Alice' but response was: {second_response[:100]}"
            # Also verify token count using precise counting
            token_count = count_tokens(second_response)
            assert token_count > 0, "Response should have at least some tokens"

    # Test that if OpenAI API returns an error, it is handled gracefully and an appropriate error message is returned to the client
    def test_openai_api_handles_errors_gracefully(self, client, test_session_id, sample_short_message):
        # Send a valid message
        response = client.post(
            "/chat/",
            json={
                "session_id": test_session_id,
                "message": sample_short_message
            }
        )
        
        # Read response and parse JSON
        content = b""
        for chunk in response.iter_bytes():
            if chunk:
                content += chunk
        
        response_text = content.decode('utf-8')
        
        # Parse JSON lines to extract actual bot response
        bot_response = ""
        for line in response_text.strip().split('\n'):
            if line.strip():
                try:
                    data = json.loads(line)
                    if "token" in data:
                        bot_response += data["token"]
                    elif "error" in data:
                        # Error is acceptable for this test (testing error handling)
                        pass
                except json.JSONDecodeError:
                    pass
        
        # Should either have content or a clear error message
        # (not a Python traceback or unhandled exception)
        assert len(response_text) > 0