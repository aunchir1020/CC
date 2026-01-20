(function() {
    // Global error handler to catch unhandled promise rejections
    window.addEventListener('unhandledrejection', function(event) {
        // Suppress browser extension errors
        if (event.reason && typeof event.reason === 'string') {
            if (event.reason.includes('message channel') || 
                event.reason.includes('extension') ||
                event.reason.includes('chrome-extension')) {
                event.preventDefault(); // Suppress the error
                return;
            }
        }
        // Log other unhandled rejections for debugging
        console.warn('⚠️ Unhandled promise rejection:', event.reason);
    });
    
    // Function to get session ID from Python (stored in container)
    // Only uses Python session_id - no JavaScript generation
    function getSessionId() {
        // Read from container (set by Python on page load and when messages are sent)
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
        
        // If not available yet, return undefined (should be set by Python)
        console.warn('⚠️ Session ID not available - waiting for Python to set it');
        return undefined;
    }
    
    const API_BASE = '__API_BASE_URL__';
    
    // Setup stop button functionality
    function setupStopButton() {
        // Track streaming state
        let lastBotMessageLength = 0;
        let lastContentCheck = 0;
        let loadingDotsDisappearedAt = 0; // Track when loading dots disappeared
        let streamingTimeout = null;
        let isCurrentlyStreaming = false;
        let stopSquareInterval = null;
        let stopObserver = null;
        let periodicCheckInterval = null;
        let isMonitoring = false;
        let buttonAttributeObserver = null; // Watch for Gradio changing button attributes
        
        // INCREASED TIMEOUTS for better stability
        const GRACE_PERIOD_MS = 15000; // Increased from 10s to 15s - wait longer for first token
        const STREAMING_TIMEOUT_MS = 25000; // Increased from 15s to 25s - wait longer for content changes
        const MONITORING_DURATION_CHECKS = 100; // Increased from 60 to 100 checks (50 seconds)
        
        // Function to check if streaming is active
        function isStreaming() {
            const now = Date.now();
            
            // Check for loading dots
            const loadingDotsSelectors = [
                '.loading-dots',
                '[class*="loading-dots"]',
                '[class*="loading"]',
                'span.loading-dots',
                '.message.bot .loading-dots',
                '.message-wrap.bot .loading-dots'
            ];
            
            let loadingDotsVisible = false;
            for (const selector of loadingDotsSelectors) {
                const loadingDots = document.querySelectorAll(selector);
                for (let dots of loadingDots) {
                    const style = window.getComputedStyle(dots);
                    const isVisible = style.display !== 'none' && 
                                     style.visibility !== 'hidden' &&
                                     dots.offsetParent !== null &&
                                     style.opacity !== '0';
                    
                    if (isVisible) {
                        loadingDotsVisible = true;
                        if (!isCurrentlyStreaming) {
                            console.log('📊 Streaming detected: loading dots visible (selector:', selector + ')');
                            isCurrentlyStreaming = true;
                            startMonitoring();
                        }
                        lastBotMessageLength = 0; // Set to 0 because new streaming has begun
                        lastContentCheck = now; // Track the last time the bot message content changed
                        loadingDotsDisappearedAt = 0; // Tracks when the loading dots disappear, set to 0 means dots are visible
                        // Reset any existing timeout when loading dots appear
                        if (streamingTimeout) {
                            clearTimeout(streamingTimeout);
                            streamingTimeout = null;
                        }
                        return true;
                    }
                }
            }
            
            // Check if last bot message is actively growing
            const chatbotContainer = document.querySelector('.gradio-chatbot, [class*="chatbot"]');
            const botMessages = chatbotContainer 
                ? chatbotContainer.querySelectorAll('.message.bot, .message-wrap.bot .message')
                : document.querySelectorAll('.message.bot');
            
            if (botMessages.length > 0) {
                const lastBotMessage = botMessages[botMessages.length - 1];
                if (!lastBotMessage) 
                    return false;

                const currentText = lastBotMessage.textContent || '';
                const currentLength = currentText.trim().length;

                // Handle grace period when loading dots disappear
                if (isCurrentlyStreaming && !loadingDotsVisible && currentLength === 0) {
                    if (loadingDotsDisappearedAt === 0) {
                        loadingDotsDisappearedAt = now;
                        console.log('📊 Loading dots disappeared - starting grace period');
                    }

                    const timeSinceDotsDisappeared = now - loadingDotsDisappearedAt;

                    if (timeSinceDotsDisappeared < GRACE_PERIOD_MS) {
                        console.log(`⏳ Grace period: waiting for first token (${Math.round((GRACE_PERIOD_MS - timeSinceDotsDisappeared) / 1000)}s remaining)`);
                        return true;
                    } else {
                        console.log('⏰ Grace period expired - no content received');
                        isCurrentlyStreaming = false;
                        lastBotMessageLength = 0;
                        loadingDotsDisappearedAt = 0;
                        stopMonitoring();
                        if (streamingTimeout) {
                            clearTimeout(streamingTimeout);
                            streamingTimeout = null;
                        }
                        return false;
                    }
                }

                // Reset grace period if content has started
                if (currentLength > 0 && loadingDotsDisappearedAt > 0) {
                    loadingDotsDisappearedAt = 0;
                }

                // Check if content is growing or streaming
                if (currentLength > lastBotMessageLength) {
                    if (!isCurrentlyStreaming) {
                        console.log(`📊 Streaming detected: content growing (${lastBotMessageLength} → ${currentLength} chars)`);
                        isCurrentlyStreaming = true;
                        startMonitoring();
                    }

                    console.log(`📊 Streaming detected: content growing (${lastBotMessageLength} → ${currentLength} chars)`);
                    lastBotMessageLength = currentLength;
                    lastContentCheck = now;

                    if (streamingTimeout) {
                        clearTimeout(streamingTimeout);
                    }
                    streamingTimeout = setTimeout(() => {
                        console.log(`📊 Streaming finished: no content change for ${STREAMING_TIMEOUT_MS / 1000}s`);
                        isCurrentlyStreaming = false;
                        stopMonitoring();
                        updateButtonState();
                    }, STREAMING_TIMEOUT_MS);

                    return true;
                }

                // Handle ongoing streaming with no growth
                if (isCurrentlyStreaming && currentLength > 0) {
                    const timeSinceLastChange = now - lastContentCheck;
                    if (timeSinceLastChange < STREAMING_TIMEOUT_MS) {
                        return true;
                    } else {
                        console.log(`📊 Streaming finished: no content change for ${STREAMING_TIMEOUT_MS / 1000}s`);
                        isCurrentlyStreaming = false;
                        stopMonitoring();
                        if (streamingTimeout) {
                            clearTimeout(streamingTimeout);
                            streamingTimeout = null;
                        }
                        return false;
                    }
                }

                // Update lastBotMessageLength if necessary
                if (currentLength > 0 && lastBotMessageLength !== currentLength) {
                    lastBotMessageLength = currentLength;
                }
            }
            
            if (botMessages.length === 0 && isCurrentlyStreaming) {
                isCurrentlyStreaming = false;
                lastBotMessageLength = 0;
                lastContentCheck = 0;
                loadingDotsDisappearedAt = 0;
                stopMonitoring();
                if (streamingTimeout) {
                    clearTimeout(streamingTimeout);
                    streamingTimeout = null;
                }
            }
            
            return isCurrentlyStreaming;
        }
        
        // Force button to stay enabled during streaming
        function forceButtonEnabled(button) {
            if (!button) return;
            
            // Remove disabled attribute and classes
            button.disabled = false;
            button.removeAttribute('disabled');
            button.classList.remove('disabled');
            
            // Force enable styles
            button.style.pointerEvents = 'auto';
            button.style.cursor = 'pointer';
            button.style.opacity = '1';
            button.style.backgroundColor = '#2563eb';
            
            // Only create the observer if we are streaming
            // And only if we have not already created one
            if (!buttonAttributeObserver && isCurrentlyStreaming) {
                buttonAttributeObserver = new MutationObserver((mutations) => {
                    // Only react if we're still streaming
                    if (!isCurrentlyStreaming) return;
                    
                    for (const mutation of mutations) {
                        if (mutation.type === 'attributes') {
                            const attrName = mutation.attributeName;
                            
                            // If Gradio tries to disable the button, re-enable it
                            if (attrName === 'disabled' && button.disabled) {
                                console.log('🔄 Gradio tried to disable button - re-enabling for stop mode');
                                button.disabled = false;
                                button.removeAttribute('disabled');
                            }
                            
                            // If Gradio changes style or class, restore our styles
                            if (attrName === 'style' || attrName === 'class') {
                                if (button.style.pointerEvents !== 'auto') {
                                    button.style.pointerEvents = 'auto';
                                }
                                if (button.style.cursor !== 'pointer') {
                                    button.style.cursor = 'pointer';
                                }
                                if (button.style.opacity !== '1') {
                                    button.style.opacity = '1';
                                }
                                if (button.style.backgroundColor !== 'rgb(37, 99, 235)' && 
                                    button.style.backgroundColor !== '#2563eb') {
                                    button.style.backgroundColor = '#2563eb';
                                }
                            }
                        }
                    }
                });
                
                // Observe the button for attribute changes
                buttonAttributeObserver.observe(button, {
                    attributes: true,
                    attributeFilter: ['disabled', 'style', 'class', 'aria-disabled']
                });
                
                console.log('✅ Button attribute observer started - will fight Gradio\'s disable attempts');
            }
        }
        
        // Function to update button state based on streaming
        function updateButtonState() {
            // Target the CHAT button specifically (not the welcome button)
            let button = document.querySelector('#upload-button-chat');
            
            // Fallback: try to find visible upload button by class
            if (!button) {
                const buttons = document.querySelectorAll('.upload-button');
                for (let btn of buttons) {
                    if (btn.offsetParent !== null) { // Check if visible
                        button = btn;
                        break;
                    }
                }
            }
            
            // Last resort: any visible button with upload in ID
            if (!button) {
                const buttons = document.querySelectorAll('[id*="upload-button"]');
                for (let btn of buttons) {
                    if (btn.offsetParent !== null) {
                        button = btn;
                        break;
                    }
                }
            }
            
            if (!button) {
                return; // Button not found
            }
            
            // If user is editing a message, disable the bottom send button
            if (isEditingMessage()) {
                button.disabled = true;
                button.setAttribute('disabled', 'true');
                button.style.pointerEvents = 'none';
                button.style.cursor = 'not-allowed';
                button.style.opacity = '0.5';
                return; // Don't proceed with streaming checks when editing
            }
            
            const streaming = isStreaming();
            
            if (streaming) {
                // Streaming active - show stop button
                if (!button.classList.contains('stop-mode')) {
                    button.classList.add('stop-mode');
                    console.log('🟦 Button → STOP mode (streaming detected)');
                }
                
                // CRITICAL: Force button to stay enabled (override Gradio's disabled state)
                forceButtonEnabled(button);
                
                // Remove hidden class if present
                button.classList.remove('hidden');
                // Preserve circular shape and positioning - ensure it stays in the same place as send button
                button.style.display = 'flex';
                button.style.visibility = 'visible';
                button.style.position = 'absolute';
                button.style.right = '10px';
                button.style.top = '50%';
                button.style.transform = 'translateY(-52%)';
                button.style.width = '36px';
                button.style.height = '36px';
                button.style.minWidth = '36px';
                button.style.minHeight = '36px';
                button.style.maxWidth = '36px';
                button.style.maxHeight = '36px';
                button.style.borderRadius = '50%';
                button.style.aspectRatio = '1 / 1';
                
                // Ensure overflow doesn't clip our square, to show a square overlay or icon on top of the button
                const computedStyle = window.getComputedStyle(button);
                if (computedStyle.overflow === 'hidden' || computedStyle.overflow === 'clip') {
                    button.style.overflow = 'visible';
                }
                
                // Create/update stop square
                let stopSquare = button.querySelector('.stop-square');
                if (!stopSquare) {
                    stopSquare = document.createElement('div');
                    stopSquare.className = 'stop-square';
                    stopSquare.style.cssText = `
                        width: 14px !important;
                        height: 14px !important;
                        background-color: white !important;
                        border-radius: 2px !important;
                        position: absolute !important;
                        top: 50% !important;
                        left: 50% !important;
                        transform: translate(-50%, -50%) !important;
                        z-index: 10 !important;
                        pointer-events: none !important;
                        display: block !important;
                        visibility: visible !important;
                        opacity: 1 !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    `;
                    button.appendChild(stopSquare);
                    console.log('✅ Stop square created');
                } else {
                    stopSquare.style.display = 'block';
                    stopSquare.style.visibility = 'visible';
                    stopSquare.style.opacity = '1';
                }
                
                // Clear any text content
                if (button.childNodes) {
                    Array.from(button.childNodes).forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            node.textContent = '';
                        }
                    });
                }
                
                // Start interval to maintain stop square
                if (!stopSquareInterval) {
                    stopSquareInterval = setInterval(() => {
                        if (isCurrentlyStreaming && button.classList.contains('stop-mode')) {
                            // Keep button enabled
                            forceButtonEnabled(button);
                            
                            // Ensure square exists
                            const square = button.querySelector('.stop-square');
                            if (!square) {
                                const newSquare = document.createElement('div');
                                newSquare.className = 'stop-square';
                                newSquare.style.cssText = `
                                    width: 14px !important;
                                    height: 14px !important;
                                    background-color: white !important;
                                    border-radius: 2px !important;
                                    position: absolute !important;
                                    top: 50% !important;
                                    left: 50% !important;
                                    transform: translate(-50%, -50%) !important;
                                    z-index: 10 !important;
                                    pointer-events: none !important;
                                    display: block !important;
                                `;
                                button.appendChild(newSquare);
                                console.log('🔄 Stop square recreated');
                            }
                        }
                    }, 200);
                }
            } else {
                // Streaming stopped - show send button
                const wasInStopMode = button.classList.contains('stop-mode');
                
                if (wasInStopMode) {
                    button.classList.remove('stop-mode');
                    console.log('🔵 Button → SEND mode (streaming stopped)');
                    
                    // Remove stop square
                    const stopSquare = button.querySelector('.stop-square');
                    if (stopSquare) {
                        stopSquare.remove();
                    }
                    
                    // Clear interval
                    if (stopSquareInterval) {
                        clearInterval(stopSquareInterval);
                        stopSquareInterval = null;
                    }
                    
                    // Stop button attribute observer
                    if (buttonAttributeObserver) {
                        buttonAttributeObserver.disconnect();
                        buttonAttributeObserver = null;
                        console.log('✅ Button attribute observer stopped');
                    }
                    
                    // Reset tracking
                    lastBotMessageLength = 0;
                    lastContentCheck = 0;
                    loadingDotsDisappearedAt = 0;
                    if (streamingTimeout) {
                        clearTimeout(streamingTimeout);
                        streamingTimeout = null;
                    }
                }
                
                // When not streaming, check if textbox has text and manage button state accordingly
                const inputs = document.querySelectorAll('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
                const input = inputs[0];
                const hasInput = input && input.value.trim().length > 0;
                
                // Ensure button is visible and positioned correctly
                button.style.display = 'flex';
                button.style.visibility = 'visible';
                button.style.position = 'absolute';
                button.style.right = '10px';
                button.style.top = '50%';
                button.style.transform = 'translateY(-52%)';
                
                if (hasInput) {
                    // Textbox has text - enable button
                    button.disabled = false;
                    button.removeAttribute('disabled');
                    button.style.pointerEvents = 'auto';
                    button.style.cursor = 'pointer';
                    button.style.opacity = '1';
                } else {
                    // Textbox is empty - disable button
                    button.disabled = true;
                    button.setAttribute('disabled', 'true');
                    button.style.pointerEvents = 'none';
                    button.style.cursor = 'not-allowed';
                    button.style.opacity = '0.5';
                }
            }
        }
        
        // Function to handle stop button click
        async function handleStopClick(e) {
            // Target chat button specifically
            let button = e.target.closest('#upload-button-chat');
            if (!button) {
                button = e.target.closest('.upload-button');
            }
            if (!button) {
                button = e.target.closest('[id*="upload-button"]');
            }
            if (!button) return;
            
            // Only handle if in stop mode
            if (!button.classList.contains('stop-mode')) return;
            
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            console.log('🛑 Stop button clicked - stopping stream');
            
            // Mark that streaming was stopped by user
            isCurrentlyStreaming = false;
            lastBotMessageLength = 0;
            lastContentCheck = 0;
            loadingDotsDisappearedAt = 0;
            stopMonitoring();
            if (streamingTimeout) {
                clearTimeout(streamingTimeout);
                streamingTimeout = null;
            }
            
            // Get current session_id (from Python)
            const currentSessionId = getSessionId();
            if (!currentSessionId) {
                console.error('❌ Cannot stop: Session ID not available');
                return;
            }
            
            // Call backend stop endpoint with proper error handling
            try {
                const response = await fetch(API_BASE + '/chat/stop/' + currentSessionId, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }).catch(err => {
                    // Handle network errors
                    console.warn('⚠️ Fetch error (network issue):', err);
                    return null;
                });
                
                if (response && response.ok) {
                    try {
                        const data = await response.json();
                        console.log('✅ Stop request sent:', data);
                    } catch (jsonError) {
                        console.warn('⚠️ Failed to parse stop response:', jsonError);
                    }
                } else if (response) {
                    console.warn('⚠️ Failed to stop stream:', response.status);
                }
            } catch (error) {
                // Silently handle errors - don't let them propagate as unhandled promises
                console.error('❌ Error stopping stream:', error);
            }
            
            // Force button state update with error handling
            // After stop, check textbox content and update button accordingly
            setTimeout(() => {
                try {
                    // Get the button first
                    let updateButton = document.querySelector('#upload-button-chat');
                    if (!updateButton) {
                        const buttons = document.querySelectorAll('.upload-button');
                        for (let btn of buttons) {
                            if (btn.offsetParent !== null) {
                                updateButton = btn;
                                break;
                            }
                        }
                    }
                    
                    if (updateButton) {
                        // Remove stop mode
                        updateButton.classList.remove('stop-mode');
                        
                        // Remove stop square
                        const stopSquare = updateButton.querySelector('.stop-square');
                        if (stopSquare) {
                            stopSquare.remove();
                        }
                        
                        // Check textbox content
                        const inputs = document.querySelectorAll('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
                        const input = inputs[0];
                        const hasInput = input && input.value.trim().length > 0;
                        
                        // Update button state based on textbox content
                        if (hasInput) {
                            // Textbox has text - enable button
                            updateButton.disabled = false;
                            updateButton.removeAttribute('disabled');
                            updateButton.style.pointerEvents = 'auto';
                            updateButton.style.cursor = 'pointer';
                            updateButton.style.opacity = '1';
                            console.log('✅ Button → SEND mode (enabled - textbox has content)');
                        } else {
                            // Textbox is empty - disable button
                            updateButton.disabled = true;
                            updateButton.setAttribute('disabled', 'true');
                            updateButton.style.pointerEvents = 'none';
                            updateButton.style.cursor = 'not-allowed';
                            updateButton.style.opacity = '0.5';
                            console.log('✅ Button → SEND mode (disabled - textbox empty)');
                        }
                        
                        // Ensure button is visible and positioned correctly
                        updateButton.style.display = 'flex';
                        updateButton.style.visibility = 'visible';
                    }
                } catch (err) {
                    console.warn('⚠️ Error updating button state:', err);
                }
            }, 200);
        }
        
        // Debounce function
        let updateTimeout = null;
        function debouncedUpdateButtonState() {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
                updateButtonState();
            }, 100);
        }
        
        // Start monitoring
        function startMonitoring() {
            if (isMonitoring) return;
            isMonitoring = true;
            
            // Create MutationObserver
            if (!stopObserver) {
                stopObserver = new MutationObserver((mutations) => {
                    let shouldUpdate = false;
                    for (const mutation of mutations) {
                        // Catch entirely new messages or loading indicators
                        if (mutation.addedNodes.length > 0) {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    const classes = node.className || '';
                                    if (classes.includes('loading') || classes.includes('message') || classes.includes('bot')) {
                                        shouldUpdate = true; // Marks that something happened in the chat that could require updating the button, e.g. send -> stop if bot started streaming
                                        break;
                                    }
                                }
                            }
                        }
                        // Catch incremental updates inside a message like bot streaming tokens
                        if (mutation.type === 'characterData' || mutation.type === 'childList') {
                            const target = mutation.target;
                            if (target && (target.closest && target.closest('.message.bot, .message-wrap.bot'))) {
                                shouldUpdate = true;
                            }
                        }
                    }
                    if (shouldUpdate) {
                        debouncedUpdateButtonState();
                    }
                });
            }
            
            const chatbotContainer = document.querySelector('.gradio-chatbot, [class*="chatbot"], .chatbot-container');
            if (chatbotContainer) {
                stopObserver.observe(chatbotContainer, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: false
                });
            }
            
            // Start periodic check - more frequent for better detection
            if (!periodicCheckInterval) {
                let checkCount = 0;
                periodicCheckInterval = setInterval(() => {
                    checkCount++;
                    const wasStreaming = isCurrentlyStreaming;
                    const nowStreaming = isStreaming();
                    
                    // nowStreaming - bot is actively streaming tokens right now
                    // wasStreaming - the streaming might have just stopped, want to update the button from stop → send
                    if (nowStreaming || wasStreaming || isEditingMessage()) {
                        updateButtonState();
                    }
                    
                    // INCREASED: Keep monitoring longer for long messages
                    if (checkCount > MONITORING_DURATION_CHECKS && !isCurrentlyStreaming) {
                        stopMonitoring();
                    }
                }, 500);
            }
            
            console.log('✅ Monitoring started');
        }
        
        // Stop monitoring
        function stopMonitoring() {
            if (!isMonitoring) return;
            isMonitoring = false;
            
            if (stopObserver) {
                stopObserver.disconnect();
                console.log('✅ Monitoring stopped (streaming ended)');
            }
            
            if (periodicCheckInterval) {
                clearInterval(periodicCheckInterval);
                periodicCheckInterval = null;
            }
            
            // Also stop button attribute observer
            if (buttonAttributeObserver) {
                buttonAttributeObserver.disconnect();
                buttonAttributeObserver = null;
                console.log('✅ Button attribute observer stopped');
            }
        }
        
        // Add click handler for stop button
        document.addEventListener('click', handleStopClick, true);
        
        // Listen for edit message sent event
        document.addEventListener('editMessageSent', (e) => {
            console.log('📤 Edit message sent - starting monitoring...');
            startMonitoring();
            
            // Check for streaming with strategic timing
            setTimeout(() => {
                isStreaming();
                updateButtonState();
            }, 100);
            setTimeout(() => {
                isStreaming();
                updateButtonState();
            }, 300);
            setTimeout(() => {
                isStreaming();
                updateButtonState();
            }, 600);
        });
        
        // Detect when send button is clicked
        document.addEventListener('click', (e) => {
            const button = e.target.closest('#upload-button-chat') || 
                          e.target.closest('#upload-button-welcome') ||
                          e.target.closest('.upload-button');
            if (button && !button.classList.contains('stop-mode')) {
                // Don't start monitoring if user is editing (editable textarea has its own send button)
                if (isEditingMessage()) {
                    return;
                }
                
                console.log('📤 Send button clicked - starting monitoring...');
                startMonitoring();
                
                // Check for streaming with strategic timing
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 100);
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 300);
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 600);
            }
        }, true);
        
        // Detect when retry button is clicked
        document.addEventListener('click', (e) => {
            // Check if retry button was clicked
            const retryButton = e.target.closest('button[aria-label*="retry"]') ||
                               e.target.closest('button[aria-label*="Retry"]') ||
                               e.target.closest('button[title*="retry"]') ||
                               e.target.closest('button[title*="Retry"]') ||
                               (e.target.closest('button') && (
                                   e.target.closest('button').getAttribute('aria-label')?.toLowerCase().includes('retry') ||
                                   e.target.closest('button').getAttribute('title')?.toLowerCase().includes('retry')
                               ));
            
            if (retryButton) {
                console.log('🔄 Retry button clicked - starting monitoring...');
                startMonitoring();
                
                // Check for streaming with strategic timing
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 100);
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 300);
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 600);
                setTimeout(() => {
                    isStreaming();
                    updateButtonState();
                }, 1000);
            }
        }, true);
        
        // Check if user is currently editing a message
        function isEditingMessage() {
            // Check if editable textarea exists (user is editing)
            const editableTextarea = document.querySelector('.editable-message-textarea');
            const editingMessage = document.querySelector('.editing-message');
            return editableTextarea !== null || editingMessage !== null;
        }
        
        // Setup textbox input listener to update button state when user types
        function setupTextboxListener() {
            const textboxes = document.querySelectorAll('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
            
            textboxes.forEach(textbox => {
                // Skip editable textarea (for editing messages) - it has its own send button
                if (textbox.classList.contains('editable-message-textarea')) {
                    return;
                }
                
                // Check if listener already attached
                if (!textbox.hasAttribute('data-stop-script-listener')) {
                    // Listen for input changes (typing)
                    textbox.addEventListener('input', () => {
                        // Only update button state if not currently streaming and not editing
                        if (!isCurrentlyStreaming && !isEditingMessage()) {
                            updateButtonState();
                        }
                    });
                    
                    // Listen for Enter key press (to send message)
                    textbox.addEventListener('keydown', (e) => {
                        // Check if Enter is pressed (without Shift - Shift+Enter is for new line)
                        if (e.key === 'Enter' && !e.shiftKey) {
                            console.log('⌨️ Enter key pressed - starting monitoring...');
                            // Start monitoring immediately when Enter is pressed
                            startMonitoring();
                            
                            // Check for streaming with strategic timing
                            setTimeout(() => {
                                isStreaming();
                                updateButtonState();
                            }, 100);
                            setTimeout(() => {
                                isStreaming();
                                updateButtonState();
                            }, 300);
                            setTimeout(() => {
                                isStreaming();
                                updateButtonState();
                            }, 600);
                        }
                    });
                    
                    textbox.setAttribute('data-stop-script-listener', 'true');
                    console.log('✅ Textbox input and Enter key listener attached');
                }
            });
        }
        
        // Initial check
        function initialCheck() {
            const testButton = document.querySelector('#upload-button-chat');
            if (testButton) {
                console.log('✅ Stop button script initialized - chat button found');
            } else {
                console.warn('⚠️ Chat upload button not found - will retry when needed');
            }
            
            // Setup textbox listener
            setupTextboxListener();
            
            // Also setup listener when new textboxes are added (Gradio might add them dynamically)
            const textboxObserver = new MutationObserver(() => {
                setupTextboxListener();
                // Also check if editing state changed
                updateButtonState();
            });
            
            // Watch for new textboxes being added and editing state changes
            if (document.body) {
                textboxObserver.observe(document.body, {
                    childList: true,
                    subtree: true
                });
            }
        }
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initialCheck, 1000);
            });
        } else {
            setTimeout(initialCheck, 1000);
        }
    }
    
    setupStopButton();
    
    console.log('✅ Stop button script loaded');
})();