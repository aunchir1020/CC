### Tech Stack
- **Frontend** built with **Gradio**, **HTML**, **CSS** & **Javascript**
- **Backend** as a separate **FastAPI** service that talks to **OpenAI** (ChatGPT 3.5 + Whisper).
- **SQLite + SQLAlchemy** used to store chat history

### Architecture Overview

- **Frontend**
  - Provides a chat interface that supports real-time streaming of LLM responses, multi-turn conversation interaction, message editing and retry, optional voice input, and per-session state management via a unique session_id shared with the backend.

- **Backend** (`api.py`)
  - FastAPI app with endpoints:
    - **`POST /chat/`** – stream a response from OpenAI, saving both user and assistant messages into SQLite.
    - **`POST /chat/edit/`** – edit the last user message, delete the corresponding assistant message, and regenerate a new assistant reply using the updated history.
    - **`POST /chat/retry/`** – retry the last assistant message by deleting it and re‑calling OpenAI with the same prior user message.
    - **`POST /chat/stop/{session_id}`** – mark a streaming session as cancelled so the generator stops early.
    - **`POST /speech-to-text/`** – send uploaded audio to Whisper (`whisper-1`) and return transcribed text in input textarea.

- **Database Layer** (`database.py`)
  - SQLite database
  - `ChatMessage` model:
    - `id`: primary key.
    - `session_id`: groups messages per chat tab.
    - `role`: `"user"` or `"assistant"`.
    - `content`: actual text.
    - `created_at`: UTC timestamp.

### Thought Process & Key Design Decisions

- **1. LLM, UI framework, and storage choices**
  - Chose **OpenAI** as the LLM provider for stable streaming support and predictable performance. Have experience with Local LLMs (e.g., Ollama), heavily depending on hardware memory so less reliable for development and deployment.
  - Selected **Gradio** for the frontend to enable rapid iteration while still allowing integration with HTML, CSS, and JavaScript for custom UI behavior. Have experience with Streamlit, found that it is restrictive for advanced layout control and client-side interactions.
  - Used **SQLite with SQLAlchemy** for chat history storage, leveraging prior experience with SQLite in mobile application development and its simplicity for prototyping session-based persistence.

- **2. Multi-turn conversation and context handling**
  - The frontend was designed around **multi-turn conversation** from the start, requiring the backend to resend prior messages as context to the LLM on each request.
  - To prevent exceeding model context limits:
    - **Conversation history is trimmed from the oldest messages** first, retaining only the most recent messages whose combined token count is within MAX_HISTORY_TOKENS.
    - **User input length is validated before calling the LLM**; if a message exceeds MAX_USER_MESSAGE_TOKENS, the request is rejected with a clear error message so the user can edit their input without consuming API calls.
    - Model output length is also capped.

- **3. Edit and retry interaction design**
  - An initial attempt was made to support full message versioning. While it was possible to view previous versions of a response, it caused confusion when distinguishing which message a reply belonged to. 
  - To keep the system simple, this feature was removed, and the design now focuses on **latest message operations** only.
  - **Edit flow:**
    - Locate the **latest user message** for the current session.
    - Replace its content with the edited text.
    - Remove the corresponding assistant response.
    - Rebuild conversation context (with token trimming) and generate a new assistant reply.
  - **Retry flow:**
    - Remove only the **latest assistant message**.
    - Reuse the same user messages.
    - Generate and stream a new response, which is then stored as a new assistant entry.

- **4. Audio input for accessibility**
  - To reduce typing friction, an optional **audio-to-text input** feature was added.
  - User audio is transcribed using Whisper, and the **transcribed text is inserted into the input box rather than being sent automatically**.
  - This **allows users to review and edit transcriptions before submission**, accounting for occasional speech recognition inaccuracies.

- **5. Deployment considerations and trade-offs**
  - Due to local hardware memory limitations, **Docker images were not built locally**. The application was deployed using **Render** which supports Docker-based deployments.
  - Since Render only allows one exposed port per service, the **frontend and backend are deployed as separate services**, with the frontend communicating with the backend via HTTP APIs.
  - In the deployment environment, SQLite storage is ephemeral and not persisted across restarts. Given time constraints, the storage backend was **not migrated to a managed database**. Instead, the **session ID is visibly displayed** in the UI to demonstrate that refreshing the page or opening a new tab creates a new chat session, making session scoping explicit.

### Implementation Walkthrough

- **Frontend flow**
  - On first load:
    - The **welcome section** is visible.
    - `session_id_state` generates a UUID and propagates it to the DOM + JS.
  - When the user sends the first message:
    - `submit_and_respond_welcome`:
      - Appends a user message to local chat history.
      - Hides welcome and **shows chat** + bottom input area.
      - Then shows a temporary “loading dots” assistant message.
      - **Calls `chat_with_llm`** to stream the backend response, replacing the loading dots with actual tokens as they arrive.
  - For subsequent turns:
    - `submit_and_respond_chat` reuses the same `respond`/`chat_with_llm` pipeline with the same `session_id`.
  - **Edit user messages** (`edit_user_messages.js`):
    - When user clicks the edit button on a user message, the message is converted to an editable textarea.
    - User can modify the text and click "Send" to submit the edited message.
    - The frontend calls `/chat/edit/` with the edited text and `session_id`.
    - The backend updates the user message in the database, deletes the corresponding assistant response and streams a new response.
    - The UI shows the edited message and new assistant response.
  - **Retry assistant messages**:
    - The retry button on `gr.Chatbot` calls `retry_last_response`, which:
      - Normalizes chat history into a clean list of `{role, content}` dicts (because Gradio's Chatbot component can sometimes return messages in different formats such as list or nested dict, and the backend API expects a consistent `{role: str, content: str}` format).
      - Inserts a loading spinner for the last assistant message.
      - Calls `/chat/retry/` and streams the updated answer into that slot.
  - **Stop streaming** (`stop_messages.js`):
    - During streaming, the send button automatically switches to a stop button.
    - When the stop button is clicked, the frontend calls `/chat/stop/{session_id}` to signal the backend to stop.
    - The backend sets a threading event flag that the streaming loop checks frequently, causing it to exit early and yield a `{"stopped": true}` message.
    - The frontend detects the stop signal and updates the UI accordingly.
  - **Microphone recording** (`mic_recording.js`):
    - When user clicks the microphone button, the browser requests microphone access.
    - Audio is recorded using the MediaRecorder API and stored in chunks.
    - When recording stops, the audio is sent to `/speech-to-text/` endpoint.
    - The backend accepts the uploaded audio file (WebM), temporarily writes it to disk using Python's `tempfile.NamedTemporaryFile`, sends it to OpenAI's `client.audio.transcriptions.create` (`whisper-1`) and then deletes the temporary file after transcription.
    - The transcribed text is inserted into the input textarea, allowing the user to review and edit before submitting.

- **Backend flow for `/chat/`**
  1. Receive `ChatRequest` with `message` and `session_id`.
  2. In `chat_stream`:
     - Save the user message to DB immediately.
     - Validate its token length.
     - Load full history for that `session_id` and truncate to the last ~`MAX_HISTORY_TOKENS` tokens.
     - Call OpenAI’s streaming `chat.completions.create`.
     - For each chunk:
       - Append to `assistant_text`.
       - Enforce max response token limit.
       - Yield chunk JSON to the client.
     - When streaming is done, save the assistant message to DB.

- **Backend flow for `/chat/edit/`**
  1. Receive `ChatRequest` with `edited_message` and `session_id`.
  2. In `chat_edit_stream`:
     - Validate `session_id` and find the last user message in the database.
     - Validate the edited message token length (must be ≤ `MAX_USER_MESSAGE_TOKENS`).
     - UPDATE the existing user message content in the database (same record, new content).
     - DELETE the last assistant message (will be regenerated).
     - Load remaining chat history, truncate to `MAX_HISTORY_TOKENS` and call OpenAI.
     - Stream the new assistant response token-by-token.
     - Save the new assistant message to DB when streaming completes.

- **Backend flow for `/chat/retry/`**
  1. Receive `ChatRequest` with `session_id` (the `message` field is empty, as retry regenerates the assistant response to the existing last user message).
  2. In `chat_retry_stream`:
     - Find the last assistant message in the database.
     - DELETE the last assistant message.
     - Load all remaining messages for context, truncate to `MAX_HISTORY_TOKENS`.
     - Call OpenAI with the same conversation history (without the deleted assistant message).
     - Stream a new assistant response token by token.
     - Save the new assistant message to DB when streaming completes.

- **Backend flow for `/chat/stop/{session_id}`**
  1. Receive `session_id` as a path parameter.
  2. Look up the `threading.Event()` stored in `streaming_sessions[session_id]` (this event was created when streaming started in `chat_stream`, `chat_edit_stream`, or `chat_retry_stream`).
  3. Call `.set()` on the event to signal the streaming loop to stop.
  4. Return a JSON response indicating success or failure.
  5. The streaming loop (in `chat_stream`, `chat_edit_stream`, or `chat_retry_stream`) checks `stop_event.is_set()` frequently and exits early when set, yielding a `{"stopped": true}` message.

- **Backend flow for `/speech-to-text/`**
  1. Receive an uploaded audio file (`UploadFile`) from the frontend.
  2. Read the audio content from the stream (can only be read once).
  3. Write the audio to a temporary file in the system's temp directory using `tempfile.NamedTemporaryFile`.
  4. Open the temporary file in binary mode (`"rb"`) and pass it to OpenAI's `client.audio.transcriptions.create()` with model `whisper-1`.
  5. Receive the transcribed text from OpenAI.
  6. Delete the temporary file.
  7. Return the transcribed text to the frontend.

- **Deployment on Render with Docker**
  - **Docker Configuration**:
    - Uses `python:3.11-slim` base image for a lightweight container.
    - Copies application code and installs dependencies from `requirements.txt`.
    - Creates `/app/data` directory for SQLite database storage.
    - Exposes ports 8000 (FastAPI backend) and 7860 (Gradio frontend).
    - Uses `start.sh` script as the entry point to start the application.
  - **Render Deployment**:
    - Two separate web services are deployed on Render: one for the frontend (Gradio) and one for the backend (FastAPI).
    - Each service is built from the same Docker image (using the `Dockerfile`), but they run independently.
    - Render automatically builds the Docker image from the `Dockerfile`.
    - The frontend connects to the backend using the `FASTAPI_URL` environment variable which is the backend service's URL (`https://chattie-backend-sxyb.onrender.com`).

### Test Cases – What They Cover

#### Testing Methodology

Uses **pytest** as the testing framework with the following approach:

- **Test Framework & Tools**
  - **pytest** as the primary testing framework for test execution and assertions.
  - **FastAPI TestClient** for making HTTP requests to API endpoints without running a full server.

- **Test Organization**
  - Tests are split into two main directories:
    - **`test_api/`** - Tests for FastAPI endpoints and backend logic.
    - **`test_features/`** - Tests for end-to-end feature behavior including database operations.

- **Shared Fixtures (`conftest.py`)**
  - **`client` fixture**: Provides a FastAPI `TestClient` instance for making API requests.
  - **`test_session_id` fixture**: Generates a unique UUID session ID for each test to ensure test isolation.
  - **`sample_short_message` fixture**: Provides a short test message within token limits.
  - **`sample_medium_message` fixture**: Provides a medium-length message for various test scenarios.
  - **`sample_long_message` fixture**: Provides a message exceeding token limits (1200 words) for error testing.

- **Testing Approach**
  - **Integration Testing**: Most tests make actual API calls to the FastAPI backend and interact with the real SQLite database
  - **Real OpenAI API Calls**: Tests use actual OpenAI API calls (not mocked) to verify functionality.
  - **Monkeypatching**: Some tests (e.g., `test_chat_history_retrieval.py`) use `pytest.monkeypatch` to intercept and inspect OpenAI API calls, allowing verification of what data is sent to the API without making real requests.
  - **Database Verification**: Tests are featured to query the database directly using SQLAlchemy to verify that messages are correctly stored, updated, or deleted after API operations.

- **Test Execution**
  - Run all tests: `pytest tests/`
  - Run specific category: `pytest tests/test_api/` or `pytest tests/test_features/`
  - Run with verbose output: `pytest tests/ -v`

#### 1. API Tests (`tests/test_api/`)

- **`test_fastapi_endpoints.py`**
  - Validates the core functionality of the FastAPI endpoints, ensuring that each endpoint correctly handles requests and returns responses in the expected format.
    - **`test_health_endpoint_returns_status`** verifies the GET / endpoint to ensure the server is running.
    - **`test_chat_endpoint_accepts_post_request`** checks that the POST /chat/ endpoint accepts a valid user message and returns a streaming response.
    - **`test_chat_endpoint_requires_message_field`** ensures that the /chat/ endpoint validates the request body, specifically the required message field.
    - **`test_chat_endpoint_streams_response_in_chunks`** verifies that the /chat/ endpoint streams the LLM’s response in multiple chunks rather than returning it all at once.
    - **`test_chat_endpoint_response_format_is_json_lines`** checks that the streamed response is in JSON lines.
    - **`test_chat_edit_endpoint_accepts_post_request`** validates that the POST /chat/edit/ endpoint accepts requests to edit the latest user message and returns a streaming response.
    - **`test_chat_retry_endpoint_accepts_post_request`** ensures the POST /chat/retry/ endpoint regenerates a new assistant response.
    - **`test_chat_stop_endpoint_accepts_post_request`** checks the POST /chat/stop/ endpoint stops the streaming response.
    - **`test_speech_to_text_endpoint_accepts_file_upload`** validates the POST /speech-to-text/ endpoint can handle audio file upload.

- **`test_chat_history_retrieval.py`**
  - Tests that the backend retrieves chat history for a session, truncates it to stay within the maximum token limit and sends the correct slice to the OpenAI API.
    - **`test_chat_history_truncated_to_max_tokens_and_sent_to_api`** validates that the chat backend correctly retrieves and truncates session history before sending it to the OpenAI API

- **`test_openai_integration.py`**
  - Ensures that the FastAPI /chat/ endpoint integrates correctly with the OpenAI API, supports streaming token-by-token responses, respects token limits, preserves conversation context
    - **`test_chat_endpoint_calls_openai_api`** verifies that sending a message to /chat/ actually calls the OpenAI API and receives a response.
    - **`test_openai_response_is_streamed_token_by_token`** ensures that the API response is streamed token by token, rather than returned as a single complete message.
    - **`test_openai_response_respects_max_token_limit`** verifies that the response from OpenAI respects the maximum token limit.
    - **`test_openai_api_includes_chat_history_in_context`** checks that multiple messages sent in a session include previous chat history in the API request context.
    - **`test_openai_api_handles_errors_gracefully`** ensures that errors returned by the OpenAI API are handled without breaking the endpoint.

#### 2. Feature Tests (`tests/test_features/`)

- **`test_send_messages_db.py`**
  - Ensures that a user can send a message via the FastAPI /chat/ endpoint and receive a reply via OpenAI, and that both user and bot messages are correctly stored in the database.
    - **`test_user_sends_short_message_and_receives_bot_reply`** verifies the complete flow of sending a message, receiving a streaming response and persisting messages in SQLite.

- **`test_long_message_error.py`**
  - Verifies that the system properly handle the situation of a user sends a message exceeding the allowed token limit (1200 tokens).
    - **`test_long_message_does_not_call_openai_api`** ensures that messages exceeding 1200 tokens are blocked from sending to OpenAI.
    - **`test_user_sends_message_exceeding_1200_tokens_gets_error`** confirms that the user receives a clear error message when exceeding the token limit.
    - **`test_long_message_is_saved_to_database_despite_error`** ensures that long messages are still stored in the database so that can be edited and resubmitted later.

- **`test_edit_messages_db.py`**
  - Verifies that the backend correctly updates the user message in the database, regenerates the bot response and supports retrying the bot message when a user edits their latest message,.
    - **`test_edit_latest_user_message_updates_database`** confirms that editing the latest user message updates the message in the database and triggers a new bot response.
    - **`test_retry_after_edit_uses_updated_user_message`** ensures that the retry functionality correctly uses the edited user message and generates a new bot response.

- **`test_retry_messages_db.py`**
  - Verifies that retries delete the previous bot response, create a new one and update the database consistently.
    - **`test_retry_latest_bot_message_regenerates_response`** tests that retrying the latest bot message deletes the old response in the database and generates a new bot response.
    - **`test_multiple_retries_generate_different_responses`** tests that multiple retries generate distinct bot responses each time

- **`test_stop_messages.py`**
  - Ensures that streaming responses (normal chat, retry, or edit) can be stopped on demand.
    - **`test_stop_during_streaming_stops_response`** tests that the stop endpoint can be called during a normal streaming chat response.
    - **`test_stop_during_retry_stops_retry_response`** tests that the stop endpoint can be called during a retry operation.
    - **`test_stop_during_edit_stops_edit_response`** tests that the stop endpoint can be called during the streaming operation for edited message.
    - **`test_stop_endpoint_response_format`** tests that the stop endpoint returns a response with the expected JSON structure.

### Limitations & Bugs
- The app may occasionally behave inconsistently on Render due to container restarts and hosting environment constraints.
- SQLite storage on Render is ephemeral, meaning all chat history may be lost when the service restarts or redeploys.
- Test coverage is limited to core functionalities; some edge cases and UI interactions are not fully covered, and there is currently no automated UI testing in place.
- The stop button switches back to the send button too quickly, making it difficult for users to effectively interrupt the assistant’s streaming response.
- Regenerating an edited message with a shorter response does not fully clear the old content, leaving leftover text from the previous response visible in the UI.
- Message version tracking is not supported, so previous versions of edited or retried messages cannot be viewed or restored.
- The input textbox scroll area can extend beneath the microphone or send button, causing text to be partially blocked when scrolling.