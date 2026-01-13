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
    
    const SESSION_ID = '__SESSION_ID__';
    const API_BASE = 'http://localhost:8000';
    
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
        let buttonAttributeObserver = null; // NEW: Watch for Gradio changing button attributes
        
        // Function to check if streaming is active
        function isStreaming() {
            const now = Date.now();
            
            // Method 1: Check for loading dots
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
                        lastBotMessageLength = 0;
                        lastContentCheck = now;
                        loadingDotsDisappearedAt = 0; // Reset - dots are visible
                        // Reset any existing timeout when loading dots appear
                        if (streamingTimeout) {
                            clearTimeout(streamingTimeout);
                            streamingTimeout = null;
                        }
                        return true;
                    }
                }
            }
            
            // Method 2: Check if last bot message is actively growing
            const chatbotContainer = document.querySelector('.gradio-chatbot, [class*="chatbot"]');
            const botMessages = chatbotContainer 
                ? chatbotContainer.querySelectorAll('.message.bot, .message-wrap.bot .message')
                : document.querySelectorAll('.message.bot');
            
            if (botMessages.length > 0) {
                const lastBotMessage = botMessages[botMessages.length - 1];
                if (lastBotMessage) {
                    const currentText = lastBotMessage.textContent || '';
                    const currentLength = currentText.trim().length;
                    
                    // If tokens are streaming and loading dots just disappeared, 
                    // keep streaming state for a grace period to wait for first token
                    // This prevents button from switching back too early
                    if (isCurrentlyStreaming && !loadingDotsVisible && currentLength === 0) {
                        // Track when loading dots disappeared
                        if (loadingDotsDisappearedAt === 0) {
                            loadingDotsDisappearedAt = now;
                            console.log('📊 Loading dots disappeared - starting grace period');
                        }
                        
                        const timeSinceDotsDisappeared = now - loadingDotsDisappearedAt;
                        // Give 5 seconds grace period after loading dots disappear
                        // This allows time for first token to arrive
                        if (timeSinceDotsDisappeared < 5000) {
                            console.log(`⏳ Grace period: waiting for first token (${Math.round((5000 - timeSinceDotsDisappeared) / 1000)}s remaining)`);
                            return true; // Still consider it streaming during grace period
                        } else {
                            // Grace period expired, no content arrived
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
                    
                    // If content starts arriving, reset the loading dots disappeared timestamp
                    if (currentLength > 0 && loadingDotsDisappearedAt > 0) {
                        loadingDotsDisappearedAt = 0;
                    }
                    
                    if (currentLength > lastBotMessageLength && lastBotMessageLength >= 0) {
                        if (!isCurrentlyStreaming) {
                            console.log(`📊 Streaming detected: content growing (${lastBotMessageLength} → ${currentLength} chars)`);
                            isCurrentlyStreaming = true;
                            startMonitoring();
                        }
                        lastBotMessageLength = currentLength;
                        lastContentCheck = now;
                        
                        if (streamingTimeout) {
                            clearTimeout(streamingTimeout);
                        }
                        
                        streamingTimeout = setTimeout(() => {
                            console.log('📊 Streaming finished: no content change for 10s');
                            isCurrentlyStreaming = false;
                            lastBotMessageLength = currentLength;
                            stopMonitoring();
                            updateButtonState();
                        }, 10000); // Increased to 10 seconds for long messages
                        
                        return true;
                    }
                    
                    if (isCurrentlyStreaming) {
                        if (currentLength > 0) {
                            if (currentLength !== lastBotMessageLength) {
                                lastBotMessageLength = currentLength;
                                lastContentCheck = now;
                                
                                if (streamingTimeout) {
                                    clearTimeout(streamingTimeout);
                                }
                                streamingTimeout = setTimeout(() => {
                                    isCurrentlyStreaming = false;
                                    lastBotMessageLength = currentLength;
                                    stopMonitoring();
                                    updateButtonState();
                                }, 10000); // Increased to 10 seconds for long messages
                                
                                return true;
                            }
                            
                            const timeSinceLastChange = now - lastContentCheck;
                            // Increased timeout to 10 seconds to handle long messages with pauses
                            if (timeSinceLastChange < 10000) {
                                return true;
                            } else {
                                // Only stop if no change for 10 seconds (longer pause indicates streaming finished)
                                console.log('📊 Streaming finished: no content change for 10s');
                                isCurrentlyStreaming = false;
                                lastBotMessageLength = currentLength;
                                stopMonitoring();
                                if (streamingTimeout) {
                                    clearTimeout(streamingTimeout);
                                    streamingTimeout = null;
                                }
                                return false;
                            }
                        } else {
                            // No content yet, but tokens are streaming
                            // Check if loading dots just disappeared (grace period)
                            if (loadingDotsDisappearedAt === 0) {
                                loadingDotsDisappearedAt = now;
                                console.log('📊 Loading dots disappeared - starting grace period');
                            }
                            
                            const timeSinceDotsDisappeared = now - loadingDotsDisappearedAt;
                            // Give 5 seconds grace period after loading dots disappear
                            // This allows time for first token to arrive
                            if (timeSinceDotsDisappeared < 5000) {
                                // Still in grace period after loading dots disappeared
                                // Wait for first token to arrive
                                console.log(`⏳ Grace period: waiting for content (${Math.round((5000 - timeSinceDotsDisappeared) / 1000)}s remaining)`);
                                return true;
                            } else {
                                // Grace period expired, no content arrived
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
                    }
                    
                    if (currentLength > 0 && lastBotMessageLength !== currentLength) {
                        lastBotMessageLength = currentLength;
                    }
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
        
        // NEW: Force button to stay enabled during streaming
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
            
            // Create attribute observer if not exists and we're streaming
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
                
                // Ensure overflow doesn't clip our square
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
        
        // Call backend stop endpoint with proper error handling
        try {
            const response = await fetch(API_BASE + '/chat/stop/' + SESSION_ID, {
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
                        if (mutation.addedNodes.length > 0) {
                            for (const node of mutation.addedNodes) {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    const classes = node.className || '';
                                    if (classes.includes('loading') || classes.includes('message') || classes.includes('bot')) {
                                        shouldUpdate = true;
                                        break;
                                    }
                                }
                            }
                        }
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
                    
                    // Also check if editing state changed
                    if (nowStreaming || wasStreaming || isEditingMessage()) {
                        updateButtonState();
                    }
                    
                    // Keep monitoring longer for long messages (up to 60 checks = 30 seconds)
                    if (checkCount > 60 && !isCurrentlyStreaming) {
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