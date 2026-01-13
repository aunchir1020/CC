# Test Suite for LLM Chat Application

This directory contains comprehensive test cases for the LLM Chat Application, organized into three main categories:

## Test Structure

### 1. `test_features/` - Feature Tests
Tests for user-facing features:
- **test_user_send_messages.py**: User sending messages and receiving bot replies
- **test_long_message_error.py**: Handling of messages exceeding 400 tokens
- **test_mic_recording.py**: Microphone recording and speech-to-text transcription
- **test_copy_messages.py**: Copying user and bot messages
- **test_edit_messages.py**: Editing latest user message
- **test_retry_messages.py**: Retrying latest bot messages

### 2. `test_api/` - API Tests
Tests for FastAPI endpoints and OpenAI integration:
- **test_fastapi_endpoints.py**: FastAPI endpoint functionality
- **test_openai_integration.py**: OpenAI API integration and responses

### 3. `test_sqlite/` - Database Tests
Tests for SQLite database operations:
- **test_chat_history_storage.py**: Chat history storage and retrieval
- **test_message_updates.py**: Message updates after edits or retries

## Running Tests

### Prerequisites
```bash
pip install pytest pytest-asyncio
```

### Run All Tests
```bash
pytest tests/
```

### Run Specific Test Category
```bash
# Feature tests
pytest tests/test_features/

# API tests
pytest tests/test_api/

# Database tests
pytest tests/test_sqlite/
```

### Run Specific Test File
```bash
pytest tests/test_features/test_user_send_messages.py
```

### Run with Verbose Output
```bash
pytest tests/ -v
```

## Test Configuration

### Shared Fixtures (`conftest.py`)
- `temp_db`: Creates temporary database for testing
- `test_session_id`: Generates unique session IDs
- `client`: FastAPI test client
- `sample_short_message`: Short test message
- `sample_long_message`: Long message (>400 tokens)
- `sample_medium_message`: Medium-length message

## Important Notes

1. **Actual API Calls**: Tests use actual API calls (not mocked) to OpenAI. Ensure you have:
   - Valid OpenAI API key in `.env` file
   - Sufficient API credits
   - Internet connection

2. **Database**: Tests that require database access may need modification to use the temporary database fixture properly.

3. **Long Messages**: Tests for long messages (>400 tokens) verify that messages are rejected before being sent to OpenAI API.

4. **Streaming Responses**: Many tests read streaming responses, which may take time to complete.

## Test Coverage

- ✅ User message sending and bot replies
- ✅ Long message error handling
- ✅ Microphone recording (structure)
- ✅ Message copying (database storage)
- ✅ Message editing
- ✅ Message retrying
- ✅ FastAPI endpoints
- ✅ OpenAI API integration
- ✅ Database storage
- ✅ Message updates after edits/retries
