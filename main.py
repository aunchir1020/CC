import gradio as gr
import requests
import json
import uuid
import os
import threading
import gc
import traceback

from dotenv import load_dotenv
load_dotenv()

# Backend API URL - use environment variable or default to localhost
BASE_API_URL = os.getenv("FASTAPI_URL", "http://localhost:8000")
API_URL = f"{BASE_API_URL}/chat/"
RETRY_API_URL = f"{BASE_API_URL}/chat/retry/"
EDIT_API_URL = f"{BASE_API_URL}/chat/edit/"

# Session ID will be generated per user session using Gradio State

# Global variable to track active streaming response for cancellation
active_stream_response = None
STOP_STREAMING = False
STREAMING_LOCK = threading.Lock()
# Store stop events to track cancellation state for each streaming request
frontend_stop_events = {}
frontend_stop_lock = threading.Lock()

# Load external CSS file
def load_css():
    """Load all CSS files from the css folder and combine them."""
    css_dir = os.path.join(os.path.dirname(__file__), 'css')
    css_files = [
        'layout.css',
        'borders.css',
        'messages.css',
        'mic_recording.css',
        'buttons.css',
        'loading_dots.css',
        'edit_mode.css'
    ]
    
    combined_css = []
    for css_file in css_files:
        css_path = os.path.join(css_dir, css_file)
        if os.path.exists(css_path):
            with open(css_path, 'r', encoding='utf-8') as f:
                combined_css.append(f.read())
    
    return '\n\n'.join(combined_css)

# Load external JavaScript files and inject session_id
def load_js():
    js_content_parts = []
    
    # Suppress browser extension errors (message channel errors)
    # This is a common error from browser extensions trying to communicate with the page
    suppress_extension_errors = """
    (function() {
        // Suppress browser extension message channel errors
        window.addEventListener('unhandledrejection', function(event) {
            if (event.reason && typeof event.reason === 'string') {
                if (event.reason.includes('message channel') || 
                    event.reason.includes('extension') ||
                    event.reason.includes('chrome-extension') ||
                    event.reason.includes('moz-extension')) {
                    event.preventDefault(); // Suppress the error
                    return;
                }
            }
            // Log other unhandled rejections for debugging (optional)
            // console.warn('Unhandled promise rejection:', event.reason);
        });
        
        // Also suppress error events from extensions
        window.addEventListener('error', function(event) {
            if (event.message && (
                event.message.includes('message channel') ||
                event.message.includes('extension') ||
                event.message.includes('chrome-extension')
            )) {
                event.preventDefault();
                return false;
            }
        }, true);
    })();
    """
    js_content_parts.append(suppress_extension_errors)
    
    # Set custom favicon with Chattie emoji 💬
    set_favicon = """
    (function() {
        // Create SVG favicon with emoji
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💬</text></svg>';
        const faviconUrl = 'data:image/svg+xml,' + encodeURIComponent(svg);
        
        // Remove existing favicon if any
        const existingFavicons = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]');
        existingFavicons.forEach(fav => fav.remove());
        
        // Create new favicon link
        const link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        link.href = faviconUrl;
        document.head.appendChild(link);
        
        // Also set for Apple devices (use a larger size)
        const appleSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><text y=".9em" font-size="160">💬</text></svg>';
        const appleFaviconUrl = 'data:image/svg+xml,' + encodeURIComponent(appleSvg);
        const appleLink = document.createElement('link');
        appleLink.rel = 'apple-touch-icon';
        appleLink.href = appleFaviconUrl;
        document.head.appendChild(appleLink);
    })();
    """
    js_content_parts.append(set_favicon)
    
    # Session ID code for JavaScript - uses Python session_id only (no generation)
    session_id_js = """
    // Get session ID from Python (stored in container, updated when messages are sent)
    function getSessionId() {
        const container = document.getElementById('session-id-container');
        if (container && container.getAttribute('data-session-id')) {
            const sessionId = container.getAttribute('data-session-id');
            window.__SESSION_ID__ = sessionId;
            return sessionId;
        }
        
        // Fallback: use window global if set
        if (typeof window.__SESSION_ID__ !== 'undefined' && window.__SESSION_ID__) {
            return window.__SESSION_ID__;
        }
        
        return undefined;
    }
    
    // Initialize - try to get session_id from container
    window.__SESSION_ID__ = getSessionId();
    
    // Monitor container for session_id updates (from Python)
    (function() {
        const container = document.getElementById('session-id-container');
        if (container) {
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'data-session-id') {
                        const sessionId = container.getAttribute('data-session-id');
                        if (sessionId) {
                            window.__SESSION_ID__ = sessionId;
                            updateSessionIdDisplay(sessionId);
                            console.log('📝 Session ID updated from Python:', sessionId);
                        }
                    }
                });
            });
            observer.observe(container, { attributes: true });
        }
        
        // Poll for session_id if not set (fallback for load event issues)
        let pollCount = 0;
        const maxPolls = 20; // Poll for 2 seconds (20 * 100ms)
        const pollInterval = setInterval(function() {
            if (!window.__SESSION_ID__ || window.__SESSION_ID__ === undefined) {
                const sessionId = getSessionId();
                if (sessionId) {
                    window.__SESSION_ID__ = sessionId;
                    updateSessionIdDisplay(sessionId);
                    console.log('📝 Session ID found via polling:', sessionId);
                    clearInterval(pollInterval);
                } else {
                    pollCount++;
                    if (pollCount >= maxPolls) {
                        console.warn('⚠️ Session ID not found after polling, will be set on first message');
                        clearInterval(pollInterval);
                    }
                }
            } else {
                clearInterval(pollInterval);
            }
        }, 100);
    })();

    // Update session ID display when it becomes available
    function updateSessionIdDisplay(sessionId) {
        const display = document.getElementById('session-id-display');
        if (display && sessionId) {
            // Check if sessionId is a valid string (not a function representation)
            const sessionIdStr = String(sessionId);
            if (sessionIdStr.includes('<function') || sessionIdStr.includes('<lambda')) {
                display.textContent = 'Session: -';
            } else {
                // Show the full session id instead of a shortened version
                display.textContent = `Session: ${sessionIdStr}`;
            }
        }
    }
    """
    js_content_parts.append(session_id_js)
    
    # Load JavaScript files from js folder
    js_dir = os.path.join(os.path.dirname(__file__), 'js')
    
    # Load textbox_auto_grow.js
    textbox_auto_grow_js_path = os.path.join(js_dir, 'textbox_auto_grow.js')
    if os.path.exists(textbox_auto_grow_js_path):
        with open(textbox_auto_grow_js_path, 'r', encoding='utf-8') as f:
            textbox_auto_grow_js = f.read()
            js_content_parts.append(textbox_auto_grow_js)
    
    # Get API URL for JavaScript (use BASE_API_URL from environment)
    js_api_base = BASE_API_URL
    
    # Load edit_user_messages.js
    edit_js_path = os.path.join(js_dir, 'edit_user_messages.js')
    if os.path.exists(edit_js_path):
        with open(edit_js_path, 'r', encoding='utf-8') as f:
            edit_js = f.read()
            edit_js = edit_js.replace("'__SESSION_ID__'", "window.__SESSION_ID__")
            edit_js = edit_js.replace("__API_BASE_URL__", js_api_base)
            js_content_parts.append(edit_js)

    # Load stop_messages.js
    stop_js_path = os.path.join(js_dir, 'stop_messages.js')
    if os.path.exists(stop_js_path):
        with open(stop_js_path, 'r', encoding='utf-8') as f:
            stop_js = f.read()
            stop_js = stop_js.replace("'__SESSION_ID__'", "window.__SESSION_ID__")
            stop_js = stop_js.replace("__API_BASE_URL__", js_api_base)
            js_content_parts.append(stop_js)

    # Load mic_recording.js
    mic_js_path = os.path.join(js_dir, 'mic_recording.js')
    if os.path.exists(mic_js_path):
        with open(mic_js_path, 'r', encoding='utf-8') as f:
            mic_js = f.read()
            mic_js = mic_js.replace("__API_BASE_URL__", js_api_base)
            js_content_parts.append(mic_js)
    
    return '\n\n'.join(js_content_parts)

# Load event to initialize session_id in JavaScript container
def initialize_session_id(session_id):
    """Generate new UUID on page load and return HTML + UUID for state"""
    # Generate new UUID every time (each page load/refresh gets new session)
    new_session_id = str(uuid.uuid4())
    html = f'<div id="session-id-container" data-session-id="{new_session_id}" style="display: none;"></div>'
    # Return both HTML for display and UUID for state
    return html, new_session_id
    
def check_input(text):
    """Check if input is empty and return button state."""
    return gr.update(interactive=bool(text.strip()))

# Send user message to FastAPI backend and stream the response
# Returns: (response_text, is_stopped) as a tuple
def chat_with_llm(message, history, session_id):
    global active_stream_response, STOP_STREAMING
    
    if not message.strip():
        yield ("Please enter a message.", False)
        return
    
    # Create stop event for this session
    stop_event = threading.Event()
    with frontend_stop_lock:
        frontend_stop_events[session_id] = stop_event
    
    # Reset stop flag
    with STREAMING_LOCK:
        STOP_STREAMING = False
    
    payload = {
        "session_id": session_id,
        "message": message
    }
    
    try:
        response = requests.post(
            API_URL,
            json=payload,
            stream=True,
            timeout=60
        )
        
        # Store response for potential cancellation
        with STREAMING_LOCK:
            active_stream_response = response
        
        if response.status_code != 200:
            yield (f"Error: API returned status code {response.status_code}", False)
            with STREAMING_LOCK:
                active_stream_response = None
            with frontend_stop_lock:
                frontend_stop_events.pop(session_id, None)
            return
        
        accumulated_response = ""
        stopped = False
        
        try:
            # Read streaming response line by line
            # The backend will send a "stopped" message when stop is clicked
            for line in response.iter_lines(decode_unicode=False):
                # Check if streaming was cancelled (check stop event first)
                if stop_event.is_set():
                    stopped = True
                    accumulated_response = accumulated_response.strip() if accumulated_response else ""
                    break
                
                with STREAMING_LOCK:
                    if STOP_STREAMING:
                        stopped = True
                        accumulated_response = accumulated_response.strip() if accumulated_response else ""
                        break
                    
                if line:
                    try:
                        data = json.loads(line.decode('utf-8'))
                        
                        if "error" in data:
                            # Return error message without "Error:" prefix - respond function will handle display
                            error_msg = data['error']
                            yield (error_msg, False)
                            return
                        
                        # Check if backend stopped the stream - this is the main detection point
                        # The backend sends this when stop button is clicked
                        if "stopped" in data and data["stopped"]:
                            stopped = True
                            if "partial_content" in data:
                                accumulated_response = data["partial_content"]
                            else:
                                accumulated_response = accumulated_response.strip() if accumulated_response else ""
                            # Break immediately - don't wait for more data
                            break
                        
                        if "token" in data:
                            accumulated_response += data["token"]
                            yield (accumulated_response, False)
                            
                    except json.JSONDecodeError:
                        continue
                    except Exception as e:
                        # If connection was closed or interrupted, stop gracefully
                        error_str = str(e).lower()
                        if "connection" in error_str or "closed" in error_str or "broken" in error_str or "abort" in error_str:
                            stopped = True
                            accumulated_response = accumulated_response.strip() if accumulated_response else ""
                            break
                        yield (f"Error processing response: {str(e)}", False)
                        return
        except requests.exceptions.ChunkedEncodingError:
            # Connection closed/chunked encoding error - likely from stop
            stopped = True
            accumulated_response = accumulated_response.strip() if accumulated_response else ""
        except requests.exceptions.ConnectionError:
            # Connection was closed
            stopped = True
            accumulated_response = accumulated_response.strip() if accumulated_response else ""
        except Exception as e:
            # Other errors - might be from connection close
            error_str = str(e).lower()
            if "connection" in error_str or "closed" in error_str or "broken" in error_str:
                stopped = True
                accumulated_response = accumulated_response.strip() if accumulated_response else ""
            else:
                yield (f"Error: {str(e)}", False)
            return
        
        # Final yield with accumulated content
        # Check if there got an error message (from backend error response)
        if accumulated_response and (
            accumulated_response.startswith("Conversation too long") or
            accumulated_response.startswith("Rate limit") or
            accumulated_response.startswith("API quota") or
            accumulated_response.startswith("OpenAI API error") or
            "conversation too long" in accumulated_response.lower() or
            "rate limit" in accumulated_response.lower()
        ):
            # This is an error - mark it so respond function can handle it
            yield (accumulated_response, False)  # is_stopped=False but it's an error
        elif accumulated_response:
            yield (accumulated_response, stopped)
        elif not stopped:
            yield ("No response received from the model.", stopped)
        # If stopped and no content, yield empty string to leave bot message blank (no error)
        elif stopped and not accumulated_response:
            yield ("", stopped)
            
    except requests.exceptions.RequestException as e:
        # Handle connection errors gracefully (might be from stop)
        error_str = str(e).lower()
        if "connection" in error_str or "closed" in error_str or "broken" in error_str:
            # Connection was closed - might be from stop
            if accumulated_response:
                yield (accumulated_response, True)
            else:
                # If stopped early with no content, leave blank instead of error message
                yield ("", True)
        else:
            with STREAMING_LOCK:
                active_stream_response = None
            with frontend_stop_lock:
                frontend_stop_events.pop(session_id, None)
            yield (f"Connection error: {str(e)}\n\nMake sure the FastAPI backend is running on http://localhost:8000", False)
    except Exception as e:
        with STREAMING_LOCK:
            active_stream_response = None
        with frontend_stop_lock:
            frontend_stop_events.pop(session_id, None)
        yield (f"Unexpected error: {str(e)}", False)
    finally:
        # Clean up - always close the connection and release resources
        try:
            if 'response' in locals() and response:
                response.close()
                # Force close the underlying connection
                if hasattr(response, 'raw') and response.raw:
                    try:
                        response.raw.close()
                    except:
                        pass
        except:
            pass
        
        # Clear response reference
        with STREAMING_LOCK:
            active_stream_response = None
            if 'stopped' in locals() and stopped:
                STOP_STREAMING = False
        
        # Clean up stop event
        with frontend_stop_lock:
            frontend_stop_events.pop(session_id, None)
        
        # Force garbage collection to free memory
        gc.collect()

# Generate response
def respond(message, chat_history, session_id):
    chat_history = chat_history or []

    # Add user message
    chat_history.append({
        "role": "user",
        "content": message
    })
    yield chat_history

    # Add empty assistant message with loading marker (three dots)
    chat_history.append({
        "role": "assistant",
        "content": '<span class="loading-dots"><span></span><span></span><span></span></span>'
    })
    yield chat_history

    # Stream response and replace spinner with actual content
    first_token = True
    stopped = False
    error_occurred = False
    
    try:
        for partial, is_stopped in chat_with_llm(message, chat_history, session_id):
            if is_stopped:
                stopped = is_stopped
                break  # Stop streaming loop if stopped
            
            # Safety check: ensure chat_history has assistant message
            if len(chat_history) == 0 or chat_history[-1]["role"] != "assistant":
                # Add assistant message if missing
                chat_history.append({
                    "role": "assistant",
                    "content": ""
                })
            
            # Check if this is an error message (from backend error response)
            # Backend errors are detected by checking for common error patterns
            is_error = partial and (
                partial.startswith("Conversation too long") or
                partial.startswith("Rate limit") or
                partial.startswith("API quota") or
                partial.startswith("OpenAI API error") or
                "conversation too long" in partial.lower() or
                "rate limit" in partial.lower() or
                "quota exceeded" in partial.lower() or
                "context length" in partial.lower()
            )
            
            if is_error:
                error_occurred = True
                chat_history[-1]["content"] = partial.strip()
                yield chat_history
                break
            
            if first_token and partial and partial.strip():
                # Replace spinner marker with actual content
                chat_history[-1]["content"] = partial.strip()
                first_token = False
            elif not first_token:
                chat_history[-1]["content"] = partial
            elif first_token and not partial and stopped:
                # If stopped early with no content, leave blank (remove loading dots)
                chat_history[-1]["content"] = ""
                first_token = False
            
            # During streaming, keep yielding updates
            yield chat_history
    except Exception as e:
        # Handle any unexpected errors in the streaming loop
        error_occurred = True
        traceback.print_exc()  # Print full traceback for debugging
        # Ensure assistant message exists before updating
        if len(chat_history) == 0 or chat_history[-1]["role"] != "assistant":
            chat_history.append({
                "role": "assistant",
                "content": f"An error occurred: {str(e)}"
            })
        else:
            chat_history[-1]["content"] = f"An error occurred: {str(e)}"
        yield chat_history
        return
        
    if not error_occurred:
        yield chat_history  # Streaming finished normally

def submit_and_respond_welcome(message, history, started, session_id):
    try:
        # Safety check: generate UUID if None (shouldn't happen after demo.load(), but just in case)
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        if not message.strip():
            return "", history, started, gr.update(), gr.update(), gr.update(), session_id

        # Ensure history is a list
        if history is None:
            history = []

        started = True
        first_yield = True

        for updated_history in respond(message, history, session_id):
            if first_yield:
                yield (
                    "",                      # clear welcome textbox
                    updated_history,         # chatbot
                    started,
                    gr.update(visible=False),# hide welcome_section
                    gr.update(visible=True), # show chat_section
                    gr.update(visible=True), # SHOW input_chat (bottom)
                    session_id               # pass through session_id
                )
                first_yield = False
            else:
                yield "", updated_history, started, gr.update(), gr.update(), gr.update(), session_id
    except Exception as e:
        # Catch any errors and return error message
        traceback.print_exc()
        error_msg = f"Error: {str(e)}"
        if history is None:
            history = []
        history.append({"role": "assistant", "content": error_msg})
        yield "", history, True, gr.update(), gr.update(), gr.update(), session_id

def submit_and_respond_chat(message, history, started, session_id):
    try:
        # Safety check: generate UUID if None (shouldn't happen after demo.load(), but just in case)
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        if not message.strip():
            return "", history, session_id
        
        # Ensure history is a list
        if history is None:
            history = []
        
        # Normal new message flow
        for updated_history in respond(message, history, session_id):
            yield "", updated_history, session_id
    except Exception as e:
        # Catch any errors and return error message
        traceback.print_exc()
        error_msg = f"Error: {str(e)}"
        # To return valid history format
        if history is None:
            history = []
        history.append({"role": "assistant", "content": error_msg})
        yield "", history, session_id

# Retry generating the last bot response
def retry_last_response(chat_history, session_id):
    try:
        # Safety check: generate UUID if None (shouldn't happen after demo.load(), but just in case)
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        print(f"🔄 Retry called with session_id: {session_id}")
        print(f"📋 Chat history type: {type(chat_history)}")
        print(f"📋 Chat history length: {len(chat_history) if chat_history else 0}")
        
        if not chat_history or len(chat_history) < 2:
            print("⚠️ Retry: Chat history too short or empty")
            return chat_history or [], session_id
        
        # Make a deep copy to avoid mutating the original
        import copy
        chat_history = copy.deepcopy(chat_history)
        
        # Validate and normalize all messages to correct format
        validated_history = []
        for idx, msg in enumerate(chat_history):
            try:
                # Handle dict format (standard)
                if isinstance(msg, dict):
                    role = msg.get("role")
                    content = msg.get("content")
                    
                    # Extract string content if it's in nested format
                    if isinstance(content, (list, dict)):
                        # If content is a list/dict, try to extract text
                        print(f"⚠️ Retry: Message {idx} has complex content: {type(content)}")
                        if isinstance(content, list) and len(content) > 0:
                            # Extract first text item
                            if isinstance(content[0], dict) and "text" in content[0]:
                                content = content[0]["text"]
                            else:
                                content = str(content[0])
                        else:
                            content = str(content)
                    
                    if role and content:
                        validated_history.append({
                            "role": str(role),
                            "content": str(content)
                        })
                    else:
                        print(f"⚠️ Retry: Message {idx} missing role or content")
                        continue
                else:
                    print(f"⚠️ Retry: Invalid message format at index {idx}: {type(msg)}")
                    continue
                    
            except Exception as e:
                print(f"❌ Retry: Error validating message at index {idx}: {e}")
                traceback.print_exc()
                continue
        
        if not validated_history:
            print("❌ Retry: No valid messages after validation")
            return [], session_id
        
        print(f"✅ Retry: Validated {len(validated_history)} messages")
        chat_history = validated_history
        
        # Find the last assistant message index
        last_assistant_idx = None
        for i in range(len(chat_history) - 1, -1, -1):
            if chat_history[i].get("role") == "assistant":
                last_assistant_idx = i
                break
        
        if last_assistant_idx is None:
            print("⚠️ Retry: No assistant message found to retry")
            return chat_history, session_id
        
        print(f"🎯 Retry: Found assistant message at index {last_assistant_idx}")
        
        # Show loading - ensure clean format
        chat_history[last_assistant_idx] = {
            "role": "assistant",
            "content": '<span class="loading-dots"><span></span><span></span><span></span></span>'
        }
        yield chat_history, session_id
        
        # Call retry API
        payload = {"session_id": session_id, "message": ""}
        print(f"📤 Retry: Calling API at {RETRY_API_URL} with session_id: {session_id}")
        
        try:
            response = requests.post(RETRY_API_URL, json=payload, stream=True, timeout=60)
            
            if response.status_code != 200:
                error_msg = f"Error: API returned status code {response.status_code}"
                print(f"❌ Retry: {error_msg}")
                chat_history[last_assistant_idx] = {
                    "role": "assistant",
                    "content": error_msg
                }
                yield chat_history, session_id
                return
            
            accumulated_response = ""
            first_token = True
            
            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line.decode('utf-8'))
                        
                        if "error" in data:
                            error_msg = data['error']
                            print(f"❌ Retry: Backend returned error: {error_msg}")
                            chat_history[last_assistant_idx] = {
                                "role": "assistant",
                                "content": error_msg
                            }
                            yield chat_history, session_id
                            return
                        
                        if "stopped" in data and data["stopped"]:
                            if "partial_content" in data:
                                accumulated_response = data["partial_content"]
                            break
                        
                        if "token" in data:
                            if first_token and data["token"].strip():
                                accumulated_response = data["token"].strip()
                                first_token = False
                            else:
                                accumulated_response += data["token"]
                            
                            # Update with clean format
                            chat_history[last_assistant_idx] = {
                                "role": "assistant",
                                "content": accumulated_response
                            }
                            yield chat_history, session_id
                            
                    except json.JSONDecodeError:
                        continue
                    except Exception as e:
                        print(f"❌ Retry: Error processing stream line: {e}")
                        traceback.print_exc()
                        continue
            
            # Final update with clean format
            if accumulated_response:
                chat_history[last_assistant_idx] = {
                    "role": "assistant",
                    "content": accumulated_response.strip()
                }
            else:
                chat_history[last_assistant_idx] = {
                    "role": "assistant",
                    "content": "No response received from the model."
                }
            
            print(f"✅ Retry: Completed successfully")
            yield chat_history, session_id
                
        except requests.exceptions.RequestException as e:
            error_msg = f"Connection error: {str(e)}"
            print(f"❌ Retry: {error_msg}")
            traceback.print_exc()
            chat_history[last_assistant_idx] = {
                "role": "assistant",
                "content": error_msg
            }
            yield chat_history, session_id
            
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        print(f"❌ Retry: {error_msg}")
        traceback.print_exc()
        
        if not chat_history:
            chat_history = []
        
        # Find last assistant message or create new one
        last_assistant_idx = None
        for i in range(len(chat_history) - 1, -1, -1):
            if isinstance(chat_history[i], dict) and chat_history[i].get("role") == "assistant":
                last_assistant_idx = i
                break
        
        if last_assistant_idx is not None:
            chat_history[last_assistant_idx] = {
                "role": "assistant",
                "content": error_msg
            }
        else:
            chat_history.append({
                "role": "assistant",
                "content": error_msg
            })
        
        yield chat_history, session_id

# Load CSS and JS from external files
custom_css = load_css()
custom_js = load_js()

# Create Gradio interface
# Gradio 6+: css/js should be passed to launch(), not Blocks()
with gr.Blocks(title="Chattie") as demo:
    # Logo
    gr.HTML("""
        <div id="logo-container">
            <div id="logo-left">
                <div id="logo-icon">💬</div>
                <h1 id="logo-text">Chattie</h1>
            </div>
            <div id="session-info">
                <span id="session-id-display">Session: Loading...</span>
            </div>
        </div>
    """)
    
    # Welcome section
    welcome_section = gr.Column(visible=True, elem_id="welcome-container")
    with welcome_section:
        # Welcome message
        gr.HTML("""
            <div id="welcome-message">
                <strong>Hello! I'm Chattie, your AI assistant.</strong><br/>
                <span style="font-size: 18px;">Ask me anything and I'll help you out!</span>
            </div>
        """)

        # Welcome input
        input_welcome = gr.Column(elem_id="input-wrapper-welcome")
        with input_welcome:
            with gr.Row(elem_id="input-container"):
                msg_welcome = gr.Textbox(
                    placeholder="How can I help you today?",
                    show_label=False,
                    container=False,
                    elem_classes=["input-box"],
                    lines=1,
                    max_lines=6,
                    scale=1
                )
                mic_btn_welcome = gr.Button(
                    "",
                    elem_id="mic-button",
                    size="sm",
                    interactive=True,
                    scale=0,
                    min_width=40
                )
                submit_btn_welcome = gr.Button(
                    "",
                    elem_id="upload-button-welcome",
                    elem_classes=["upload-button"],
                    size="sm",
                    interactive=False,
                    scale=0,
                    min_width=40
                )

    # Chat section
    chat_section = gr.Column(visible=False, elem_id="chatbot-container")
    with chat_section:
        chatbot = gr.Chatbot(
            height=None,
            show_label=False,
            container=False
        )

    # Chat input
    input_chat = gr.Column(visible=False, elem_id="input-wrapper-chat")
    with input_chat:
        with gr.Row(elem_id="input-container"):
            msg_chat = gr.Textbox(
                placeholder="How can I help you today?",
                show_label=False,
                container=False,
                elem_classes=["input-box"],
                lines=1,
                max_lines=6,
                scale=1
            )
            mic_btn_chat = gr.Button(
                "",
                elem_id="mic-button",
                size="sm",
                interactive=True,
                scale=0,
                min_width=40
            )
            submit_btn_chat = gr.Button(
                "",
                elem_id="upload-button-chat",
                elem_classes=["upload-button"],
                size="sm",
                interactive=False,
                scale=0,
                min_width=40
            )

    chat_started = gr.State(False)
    # Session ID: Each browser tab gets a unique session_id (isolated chat history)
    # Page refresh generates a new session_id (new chat session)
    # UUID is generated in demo.load() on each page load/refresh
    session_id_state = gr.State(value=None)
    
    # Enable/disable buttons based on input
    msg_welcome.change(fn=check_input, inputs=[msg_welcome], outputs=[submit_btn_welcome], queue=False)
    msg_chat.change(fn=check_input, inputs=[msg_chat], outputs=[submit_btn_chat], queue=False)
    
    # Welcome input handlers
    submit_btn_welcome.click(
        fn=submit_and_respond_welcome,
        inputs=[msg_welcome, chatbot, chat_started, session_id_state],
        outputs=[msg_welcome, chatbot, chat_started, welcome_section, chat_section, input_chat, session_id_state]
    )

    msg_welcome.submit(
        fn=submit_and_respond_welcome,
        inputs=[msg_welcome, chatbot, chat_started, session_id_state],
        outputs=[msg_welcome, chatbot, chat_started, welcome_section, chat_section, input_chat, session_id_state]
    )

    # Chat input handlers
    submit_btn_chat.click(
        fn=submit_and_respond_chat,
        inputs=[msg_chat, chatbot, chat_started, session_id_state],
        outputs=[msg_chat, chatbot, session_id_state]
    )

    msg_chat.submit(
        fn=submit_and_respond_chat,
        inputs=[msg_chat, chatbot, chat_started, session_id_state],
        outputs=[msg_chat, chatbot, session_id_state]
    )

    # Retry button handler
    chatbot.retry(
        fn=retry_last_response,
        inputs=[chatbot, session_id_state],
        outputs=[chatbot, session_id_state]
    )
    
    # Replace the hidden HTML component
    session_id_display = gr.HTML(visible=True, elem_id="session-id-display")
    
    # Load event to generate and set initial session_id
    # Generates new UUID on every page load/refresh and syncs to both DOM and state
    demo.load(
        fn=initialize_session_id,
        inputs=[session_id_state],
        outputs=[session_id_display, session_id_state],
        js="""
        function(html_output) {
            // html_output is the HTML string returned from initialize_session_id
            // Extract session_id from the HTML's data-session-id attribute
            if (typeof window !== 'undefined' && html_output) {
                // Parse the HTML to extract session_id
                const match = html_output.match(/data-session-id="([^"]+)"/);
                if (match && match[1]) {
                    const session_id = match[1];
                    window.__SESSION_ID__ = session_id;
                    console.log('📝 Session ID initialized from Python:', session_id);
                    
                    // Set in container immediately
                    const container = document.getElementById('session-id-container');
                    if (!container) {
                        // Create container if it doesn't exist
                        const newContainer = document.createElement('div');
                        newContainer.id = 'session-id-container';
                        newContainer.setAttribute('data-session-id', session_id);
                        newContainer.style.display = 'none';
                        document.body.appendChild(newContainer);
                    } else {
                        // Update existing container
                        container.setAttribute('data-session-id', session_id);
                    }
                    
                    // Update the display
                    const display = document.getElementById('session-id-display');
                    if (display) {
                        display.textContent = `Session: ${session_id}`;
                    }

                    // Trigger custom event so edit script knows session is ready
                    const event = new CustomEvent('sessionIdReady', {
                        detail: { sessionId: session_id }
                    });
                    document.dispatchEvent(event);
                } else {
                    console.warn('⚠️ Could not extract session_id from HTML');
                }
            }
            // Return the HTML string as-is
            return html_output;
        }
        """
    )

if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Starting Chattie - AI Chat Assistant")
    print("=" * 60)
    print(f"🔗 Backend API: {BASE_API_URL}")
    print("📋 Session IDs are generated per user session")
    print("=" * 60)
    
    # Get server configuration from environment variables
    # Render provides PORT environment variable - use it if available
    server_name = os.getenv("GRADIO_SERVER_NAME", "0.0.0.0")
    # Use Render's PORT if available, otherwise use GRADIO_SERVER_PORT or default 7860
    render_port = os.getenv("PORT")
    if render_port:
        server_port = int(render_port)
    else:
        server_port = int(os.getenv("GRADIO_SERVER_PORT", "7860"))
    inbrowser = os.getenv("GRADIO_INBROWSER", "false").lower() == "true"
    
    demo.queue()
    demo.launch(
        server_name=server_name,
        server_port=server_port,
        css=custom_css,
        js=custom_js,
        share=False,
        inbrowser=inbrowser,
    )