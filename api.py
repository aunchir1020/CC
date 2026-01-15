import uuid
import json
import threading
import tempfile
import os
import tiktoken

from fastapi import FastAPI, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from openai import OpenAI
from env import OPENAI_API_KEY
from database import ChatMessage, get_db, SessionLocal

# Configuration
MAX_HISTORY_TOKENS = 11000  # Keep recent 11000 tokens of history
MAX_USER_MESSAGE_TOKENS = 1200  # Maximum tokens for user message
MAX_MODEL_RESPONSE_TOKENS = 4096  # Maximum tokens for model response per message
MODEL_NAME = "gpt-3.5-turbo"  # Model name for tiktoken encoding

# Initialize tiktoken encoder for gpt-3.5-turbo
try:
    encoding = tiktoken.encoding_for_model(MODEL_NAME)
except:
    # Fallback to cl100k_base encoding (used by gpt-3.5-turbo)
    encoding = tiktoken.get_encoding("cl100k_base")

def count_tokens(text: str) -> int:
    """Count tokens accurately using tiktoken"""
    if not text:
        return 0
    return len(encoding.encode(text))

def count_message_tokens(message: dict) -> int:
    """Count tokens for a message dict (role + content)"""
    role_tokens = len(encoding.encode(message.get("role", "")))
    content_tokens = count_tokens(message.get("content", ""))
    # Add overhead for message formatting (approximately 4 tokens per message)
    return role_tokens + content_tokens + 4

# Create a client object for the OpenAI API
client = OpenAI(api_key=OPENAI_API_KEY)

# Initialize the FastAPI App
app = FastAPI(title="LLM Chat Interface")

# Global dictionary to track active streaming sessions and cancellation flags
# Format: {session_id: threading.Event()}
streaming_sessions = {}
streaming_lock = threading.Lock()

# ADD CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (for development)
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, etc.)
    allow_headers=["*"],  # Allows all headers
)

@app.get("/")
def health():
    return {"status": "running"}

# Request Schema
class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str

def chat_stream(session_id: str, user_message: str, db: Session):
    # Trim whitespace from session_id to ensure proper matching
    session_id = session_id.strip() if isinstance(session_id, str) else str(session_id).strip()
    
    # Create cancellation event for this session
    with streaming_lock:
        stop_event = threading.Event()
        streaming_sessions[session_id] = stop_event
    
    # Create a new database session for this generator to avoid session closure issues
    local_db = SessionLocal()
    
    try:
        # Save user message first (so it can be edited later even if too long)
        user_msg = ChatMessage(
            session_id=session_id,
            role="user",
            content=user_message
        )
        local_db.add(user_msg)
        local_db.commit()
        
        # Check user message token count (max 1000 tokens)
        user_message_tokens = count_tokens(user_message)
        if user_message_tokens > MAX_USER_MESSAGE_TOKENS:
            error_msg = "The message you submitted was too long, please edit it and resubmit."
            yield json.dumps({"error": error_msg}) + "\n"
            return

        # Load chat history - limit to recent 11000 tokens
        all_messages = (
            local_db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        
        # Convert to chat history format
        chat_history = [
            {"role": m.role, "content": m.content}
            for m in all_messages
        ]
        
        # Truncate history to keep recent 11000 tokens
        # Start from the end and work backwards, keeping messages until limit reached
        total_tokens = 0
        truncated_history = []
        
        # Count tokens from the end (most recent messages first)
        for msg in reversed(chat_history):
            msg_tokens = count_message_tokens(msg)
            if total_tokens + msg_tokens <= MAX_HISTORY_TOKENS:
                truncated_history.insert(0, msg)  # Insert at beginning to maintain order
                total_tokens += msg_tokens
            else:
                break
        
        chat_history = truncated_history
        
        if len(truncated_history) < len(all_messages):
            print(f"📊 Chat history truncated: {len(all_messages)} → {len(truncated_history)} messages (~{total_tokens} tokens)")
        else:
            print(f"📊 Using full chat history: {len(chat_history)} messages (~{total_tokens} tokens)")

        assistant_text = ""
        response_token_count = 0  # Track token count for response

        try:
            # Call OpenAI's streaming chat API with error handling
            try:
                stream = client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=chat_history,
                    stream=True,
                    max_tokens=MAX_MODEL_RESPONSE_TOKENS  # Limit response to 4096 tokens
                )
            except Exception as api_error:
                error_msg = str(api_error)
                # Handle common OpenAI API errors
                if "context_length_exceeded" in error_msg.lower() or "maximum context length" in error_msg.lower():
                    yield json.dumps({"error": "Conversation too long. Please refresh to start a new chat session."}) + "\n"
                    return
                elif "rate_limit" in error_msg.lower():
                    yield json.dumps({"error": "Rate limit exceeded. Please try again in a moment."}) + "\n"
                    return
                elif "insufficient_quota" in error_msg.lower():
                    yield json.dumps({"error": "API quota exceeded."}) + "\n"
                    return
                else:
                    yield json.dumps({"error": f"OpenAI API error: {error_msg}"}) + "\n"
                    return

            # Iterates over each token as it arrives
            try:
                for event in stream:
                    # Check if streaming was cancelled (check frequently)
                    if stop_event.is_set():
                        # Send stop signal immediately - this will be sent to frontend
                        # The frontend should detect this and stop reading
                        yield json.dumps({"stopped": True, "partial_content": assistant_text}) + "\n"
                        # Save content (even if blank) when stopped - frontend will handle blank display
                        assistant_msg = ChatMessage(
                            session_id=session_id,
                            role="assistant",
                            content=assistant_text  # Can be empty string if stopped early
                        )
                        local_db.add(assistant_msg)
                        local_db.commit()
                        # Break out of loop - this will end the generator and close the stream
                        break
                    
                    if event.choices and event.choices[0].delta:
                        content = event.choices[0].delta.content
                        if content:
                            assistant_text += content
                            
                            # Check token count - stop if exceeds 4096 tokens
                            response_token_count = count_tokens(assistant_text)
                            if response_token_count >= MAX_MODEL_RESPONSE_TOKENS:
                                # Stop streaming when limit reached
                                yield json.dumps({"token": content}) + "\n"
                                # Send final content and stop signal
                                yield json.dumps({"stopped": True, "partial_content": assistant_text, "reason": "token_limit"}) + "\n"
                                break
                            
                            # Sends each token to the client immediately
                            yield json.dumps({"token": content}) + "\n"
            except Exception as stream_error:
                # If stream was interrupted (e.g., connection closed), handle gracefully
                if stop_event.is_set():
                    # Stop was requested, save content (even if blank)
                    yield json.dumps({"stopped": True, "partial_content": assistant_text}) + "\n"
                    # Save content (even if blank) when stopped - frontend will handle blank display
                    assistant_msg = ChatMessage(
                        session_id=session_id,
                        role="assistant",
                        content=assistant_text  # Can be empty string if stopped early
                    )
                    local_db.add(assistant_msg)
                    local_db.commit()
                    return  # Exit generator - this closes the stream
                raise  # Re-raise if not a stop request

            # Save assistant reply after streaming finishes (only if not stopped)
            # Also check if token limit reached
            if not stop_event.is_set() and assistant_text.strip():
                # Final token count check
                final_token_count = count_tokens(assistant_text)
                if final_token_count > MAX_MODEL_RESPONSE_TOKENS:
                    # Truncate to max tokens if somehow exceeded
                    # This shouldn't happen due to the check above, but safety measure
                    print(f"⚠️ Response exceeded token limit ({final_token_count} > {MAX_MODEL_RESPONSE_TOKENS}), truncating")
                
                assistant_msg = ChatMessage(
                    session_id=session_id,
                    role="assistant",
                    content=assistant_text
                )
                local_db.add(assistant_msg)
                local_db.commit()
                print(f"✅ Saved assistant response: {final_token_count} tokens")
        except Exception as e:
            # Handle errors from the OpenAI API call or streaming
            yield json.dumps({"error": str(e)}) + "\n"
            return
    except Exception as e:
        # Handle any other errors in the function
        print(f"❌ Error in chat_stream: {str(e)}")
        yield json.dumps({"error": str(e)}) + "\n"
    finally:
        # Clean up database session
        try:
            local_db.close()
        except:
            pass
        
        # Clean up streaming session
        with streaming_lock:
            if session_id in streaming_sessions:
                del streaming_sessions[session_id]

# Chat API Endpoint
@app.post("/chat/")
# Get database session
async def chat(data: ChatRequest, db: Session = Depends(get_db)):
    if not data.message.strip():
        return {"error": "Message cannot be empty."}

    # Use provided session_id or create a new unique one
    # Trim whitespace from session_id to ensure proper matching
    if data.session_id and isinstance(data.session_id, str):
        session_id = data.session_id.strip()
    elif data.session_id:
        session_id = str(data.session_id).strip()
    else:
        session_id = str(uuid.uuid4())

    # Stream response token by token back to the client
    return StreamingResponse(
        chat_stream(session_id, data.message, db),
        media_type="text/event-stream"
    )

def chat_edit_stream(session_id: str, edited_message: str, db: Session):
    """Edit the last user message and regenerate bot response - UPDATES existing records"""
    # Trim whitespace from session_id to ensure proper matching
    session_id = session_id.strip() if isinstance(session_id, str) else str(session_id).strip()
    
    # Create cancellation event for this session
    with streaming_lock:
        stop_event = threading.Event()
        streaming_sessions[session_id] = stop_event
    
    # Create a new database session for this generator to avoid session closure issues
    local_db = SessionLocal()
    
    try:
        # Validate session_id
        if not session_id or not isinstance(session_id, str) or len(session_id) == 0:
            yield json.dumps({"error": "Invalid session ID provided"}) + "\n"
            return
        
        # Get the last user message from database
        last_user = (
            local_db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .filter(ChatMessage.role == "user")
            .order_by(ChatMessage.created_at.desc())
            .first()
        )
        
        if not last_user:
            # Check if session exists at all
            session_exists = (
                local_db.query(ChatMessage)
                .filter(ChatMessage.session_id == session_id)
                .first()
            )
            if not session_exists:
                # Log for debugging - check if there are any similar session IDs
                similar_sessions = (
                    local_db.query(ChatMessage.session_id)
                    .distinct()
                    .limit(5)
                    .all()
                )
                print(f"⚠️ Edit: No session found for ID: {session_id[:8]}... (length: {len(session_id)})")
                if similar_sessions:
                    print(f"   Available sessions: {[s[0][:8] + '...' for s in similar_sessions]}")
                yield json.dumps({"error": f"No chat session found with session ID: {session_id[:8]}..."}) + "\n"
            else:
                yield json.dumps({"error": "No user message found to edit in this session"}) + "\n"
            return
        
        # Check edited message token count before updating (max 1000 tokens)
        edited_message_tokens = count_tokens(edited_message)
        if edited_message_tokens > MAX_USER_MESSAGE_TOKENS:
            error_msg = "The message you submitted was too long, please edit it and resubmit."
            yield json.dumps({"error": error_msg}) + "\n"
            return
        
        # UPDATE the existing user message content (don't create new)
        old_content = last_user.content
        last_user.content = edited_message
        local_db.commit()
        print(f"✏️ Backend: UPDATED user message ID {last_user.id}")
        print(f"   Old: '{old_content[:50]}...'")
        print(f"   New: '{edited_message[:50]}...'")
        
        # DELETE the last assistant message (will be regenerated)
        last_assistant = (
            local_db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .filter(ChatMessage.role == "assistant")
            .order_by(ChatMessage.created_at.desc())
            .first()
        )
        
        if last_assistant:
            assistant_id = last_assistant.id
            local_db.delete(last_assistant)
            local_db.commit()
            print(f"🗑️ Backend: DELETED assistant message ID {assistant_id}")
        
        # Get all remaining messages for context - limit to recent 11000 tokens
        all_messages = (
            local_db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        
        # Convert to chat history format
        chat_history = [
            {"role": m.role, "content": m.content}
            for m in all_messages
        ]
        
        # Truncate history to keep recent 11000 tokens
        total_tokens = 0
        truncated_history = []
        
        # Count tokens from the end (most recent messages first)
        for msg in reversed(chat_history):
            msg_tokens = count_message_tokens(msg)
            if total_tokens + msg_tokens <= MAX_HISTORY_TOKENS:
                truncated_history.insert(0, msg)  # Insert at beginning to maintain order
                total_tokens += msg_tokens
            else:
                break
        
        chat_history = truncated_history
        
        if not chat_history:
            yield json.dumps({"error": "No conversation history found"}) + "\n"
            return
        
        if len(truncated_history) < len(all_messages):
            print(f"📊 Chat history truncated: {len(all_messages)} → {len(truncated_history)} messages (~{total_tokens} tokens)")
        else:
            print(f"📊 Using full chat history: {len(chat_history)} messages (~{total_tokens} tokens)")
        
        print(f"📊 Backend: Generating new response with {len(chat_history)} messages in history")
        
        assistant_text = ""
        response_token_count = 0  # Track token count for response
        
        try:
            # Stream response from OpenAI with error handling
            try:
                stream = client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=chat_history,
                    stream=True,
                    temperature=0.7,
                    max_tokens=MAX_MODEL_RESPONSE_TOKENS  # Limit response to 4096 tokens
                )
            except Exception as api_error:
                error_msg = str(api_error)
                # Handle common OpenAI API errors
                if "context_length_exceeded" in error_msg.lower() or "maximum context length" in error_msg.lower():
                    yield json.dumps({"error": "Conversation too long. Please refresh to start a new chat session."}) + "\n"
                    return
                elif "rate_limit" in error_msg.lower():
                    yield json.dumps({"error": "Rate limit exceeded. Please try again in a moment."}) + "\n"
                    return
                elif "insufficient_quota" in error_msg.lower():
                    yield json.dumps({"error": "API quota exceeded."}) + "\n"
                    return
                else:
                    yield json.dumps({"error": f"OpenAI API error: {error_msg}"}) + "\n"
                    return
            
            for chunk in stream:
                # Check if streaming should be stopped
                if stop_event.is_set():
                    # Save content (even if blank) when stopped - frontend will handle blank display
                    assistant_msg = ChatMessage(
                        session_id=session_id,
                        role="assistant",
                        content=assistant_text  # Can be empty string if stopped early
                    )
                    local_db.add(assistant_msg)
                    local_db.commit()
                    yield json.dumps({"partial_content": assistant_text}) + "\n"
                    yield json.dumps({"stopped": True}) + "\n"
                    break
                
                if chunk.choices[0].delta.content is not None:
                    token = chunk.choices[0].delta.content
                    assistant_text += token
                    
                    # Check token count - stop if exceeds 4096 tokens
                    response_token_count = count_tokens(assistant_text)
                    if response_token_count >= MAX_MODEL_RESPONSE_TOKENS:
                        # Stop streaming when limit reached
                        yield json.dumps({"token": token}) + "\n"
                        yield json.dumps({"stopped": True, "partial_content": assistant_text, "reason": "token_limit"}) + "\n"
                        break
                    
                    yield json.dumps({"token": token}) + "\n"
            
            # If stream completed normally (not stopped), save the complete response
            # If stopped, message was already saved above
            if not stop_event.is_set() and assistant_text:
                assistant_msg = ChatMessage(
                    session_id=session_id,
                    role="assistant",
                    content=assistant_text
                )
                local_db.add(assistant_msg)
                local_db.commit()
                print(f"✅ Backend: SAVED new assistant message ID {assistant_msg.id}")
                print(f"   Content: '{assistant_text[:50]}...'")
                
        except Exception as e:
            yield json.dumps({"error": f"Error during streaming: {str(e)}"}) + "\n"
    except Exception as e:
        print(f"❌ Error in chat_edit_stream: {str(e)}")
        yield json.dumps({"error": str(e)}) + "\n"
    finally:
        # Clean up database session
        try:
            local_db.close()
        except:
            pass
        
        # Clean up streaming session
        with streaming_lock:
            if session_id in streaming_sessions:
                del streaming_sessions[session_id]

# Edit API Endpoint
@app.post("/chat/edit/")
async def chat_edit(data: ChatRequest, db: Session = Depends(get_db)):
    """Edit the last user message and regenerate bot response"""
    if not data.session_id:
        return {"error": "Session ID is required for edit"}
    
    if not data.message:
        return {"error": "Edited message is required"}
    
    # Trim whitespace from session_id to avoid matching issues
    session_id = data.session_id.strip() if isinstance(data.session_id, str) else str(data.session_id).strip()
    edited_message = data.message
    
    # Stream response token by token back to the client
    return StreamingResponse(
        chat_edit_stream(session_id, edited_message, db),
        media_type="text/event-stream"
    )

def chat_retry_stream(session_id: str, db: Session):
    """Retry the last assistant message by deleting it and regenerating"""
    # Trim whitespace from session_id to ensure proper matching
    session_id = session_id.strip() if isinstance(session_id, str) else str(session_id).strip()
    
    # Create cancellation event for this session (reuse same session_id)
    with streaming_lock:
        stop_event = threading.Event()
        streaming_sessions[session_id] = stop_event
    
    # Create a new database session for this generator to avoid session closure issues
    local_db = SessionLocal()
    
    try:
        # Get the last assistant message
        last_assistant = (
            local_db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .filter(ChatMessage.role == "assistant")
            .order_by(ChatMessage.created_at.desc())
            .first()
        )
        
        if not last_assistant:
            yield json.dumps({"error": "No assistant message to retry"}) + "\n"
            return
        
        # Delete the last assistant message
        local_db.delete(last_assistant)
        local_db.commit()
        
        # Get all messages before the deleted one for context - limit to recent 11000 tokens
        all_messages = (
            local_db.query(ChatMessage)
            .filter(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        
        # Convert to chat history format
        chat_history = [
            {"role": m.role, "content": m.content}
            for m in all_messages
        ]
        
        # Truncate history to keep recent 11000 tokens
        total_tokens = 0
        truncated_history = []
        
        # Count tokens from the end (most recent messages first)
        for msg in reversed(chat_history):
            msg_tokens = count_message_tokens(msg)
            if total_tokens + msg_tokens <= MAX_HISTORY_TOKENS:
                truncated_history.insert(0, msg)  # Insert at beginning to maintain order
                total_tokens += msg_tokens
            else:
                break
        
        chat_history = truncated_history
        
        if not chat_history:
            yield json.dumps({"error": "No conversation history found"}) + "\n"
            return
        
        if len(truncated_history) < len(all_messages):
            print(f"📊 Chat history truncated: {len(all_messages)} → {len(truncated_history)} messages (~{total_tokens} tokens)")
        
        assistant_text = ""
        response_token_count = 0  # Track token count for response
        
        try:
            # Call OpenAI's streaming chat API with error handling
            try:
                stream = client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=chat_history,
                    stream=True,
                    max_tokens=MAX_MODEL_RESPONSE_TOKENS  # Limit response to 4096 tokens
                )
            except Exception as api_error:
                error_msg = str(api_error)
                # Handle common OpenAI API errors
                if "context_length_exceeded" in error_msg.lower() or "maximum context length" in error_msg.lower():
                    yield json.dumps({"error": "Conversation too long. Please refresh to start a new chat session."}) + "\n"
                    return
                elif "rate_limit" in error_msg.lower():
                    yield json.dumps({"error": "Rate limit exceeded. Please try again in a moment."}) + "\n"
                    return
                elif "insufficient_quota" in error_msg.lower():
                    yield json.dumps({"error": "API quota exceeded."}) + "\n"
                    return
                else:
                    yield json.dumps({"error": f"OpenAI API error: {error_msg}"}) + "\n"
                    return
            
            # Iterates over each token as it arrives
            for event in stream:
                # Check if streaming was cancelled
                if stop_event.is_set():
                    yield json.dumps({"stopped": True, "partial_content": assistant_text}) + "\n"
                    # Save content (even if blank) when stopped - frontend will handle blank display
                    new_message = ChatMessage(
                        session_id=session_id,
                        role="assistant",
                        content=assistant_text  # Can be empty string if stopped early
                    )
                    local_db.add(new_message)
                    local_db.commit()
                    return
                
                if event.choices and event.choices[0].delta:
                    content = event.choices[0].delta.content
                    if content:
                        assistant_text += content
                        
                        # Check token count - stop if exceeds 4096 tokens
                        response_token_count = count_tokens(assistant_text)
                        if response_token_count >= MAX_MODEL_RESPONSE_TOKENS:
                            # Stop streaming when limit reached
                            yield json.dumps({"token": content}) + "\n"
                            yield json.dumps({"stopped": True, "partial_content": assistant_text, "reason": "token_limit"}) + "\n"
                            break
                        
                        # Sends each token to the client immediately
                        yield json.dumps({"token": content}) + "\n"
        
        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"
            return
        
        # Save new assistant reply (only if not stopped)
        # If stopped, message was already saved above
        if not stop_event.is_set() and assistant_text.strip():
            new_message = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=assistant_text
            )
            local_db.add(new_message)
            local_db.commit()
    except Exception as e:
        print(f"❌ Error in chat_retry_stream: {str(e)}")
        yield json.dumps({"error": str(e)}) + "\n"
    finally:
        # Clean up database session
        try:
            local_db.close()
        except:
            pass
        
        # Clean up streaming session
        with streaming_lock:
            if session_id in streaming_sessions:
                del streaming_sessions[session_id]

# Retry API Endpoint
@app.post("/chat/retry/")
async def chat_retry(data: ChatRequest, db: Session = Depends(get_db)):
    """Retry the last assistant message"""
    if not data.session_id:
        return {"error": "Session ID is required for retry"}
    
    # Trim whitespace from session_id to ensure proper matching
    session_id = data.session_id.strip() if isinstance(data.session_id, str) else str(data.session_id).strip()
    
    # Stream response token by token back to the client
    return StreamingResponse(
        chat_retry_stream(session_id, db),
        media_type="text/event-stream"
    )

# Stop streaming endpoint
@app.post("/chat/stop/{session_id}")
async def stop_streaming(session_id: str):
    """Stop streaming for a given session"""
    with streaming_lock:
        if session_id in streaming_sessions:
            stop_event = streaming_sessions[session_id]
            stop_event.set()
            # Don't remove from dict yet - let the cleanup in finally block handle it
            return {"success": True, "message": "Streaming stopped", "session_id": session_id}
        else:
            return {"success": False, "message": "No active streaming session found", "session_id": session_id}

# Speech-to-text endpoint
@app.post("/speech-to-text/")
async def speech_to_text(audio: UploadFile = File(...)):
    """
    Convert audio file to text using OpenAI Whisper API
    """
    try:
        # Save uploaded audio to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
            content = await audio.read()
            temp_audio.write(content)
            temp_audio_path = temp_audio.name
        
        try:
            # Transcribe using OpenAI Whisper
            with open(temp_audio_path, "rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file
                )
            
            text = transcription.text
            
            return {"text": text, "status": "success"}
        finally:
            # Clean up temporary file
            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)
    
    except Exception as e:
        return {"text": "", "status": "error", "error": str(e)}