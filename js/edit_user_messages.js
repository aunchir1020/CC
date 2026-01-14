(function() {
    const SESSION_ID = '__SESSION_ID__';
    // Dynamically determine API base URL
    let API_BASE = '__API_BASE_URL__';
    if (API_BASE === '__DYNAMIC_API_URL__' || API_BASE.includes('localhost')) {
        // For deployed environments, try to use current origin with port 8000
        const currentOrigin = window.location.origin;
        if (currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1')) {
            API_BASE = 'http://localhost:8000';
        } else {
            // For deployed apps, try current origin with port 8000
            // Note: This will only work if port 8000 is publicly exposed
            // If not, you need to set API_URL environment variable to a publicly accessible backend URL
            const url = new URL(currentOrigin);
            API_BASE = `${url.protocol}//${url.hostname}:8000`;
            console.log('🔗 Using API URL:', API_BASE);
        }
    }
    
    // Setup edit button functionality
    function setupEditButton() {
        // SVG icon for edit button (pencil)
        const pencilIconSVG = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
        `;
        
        // Function to inject edit button for latest user message
        function injectEditButton() {
            // Find within chatbot container first
            const chatbot = document.querySelector('.chatbot, [data-testid*="chatbot"], #chatbot-container, [class*="chatbot"]');
            let searchRoot = chatbot || document;
            
            // Try multiple selectors to find user messages
            let userMessages = Array.from(searchRoot.querySelectorAll(
                '.message-wrap.user, ' +
                '.message.user, ' +
                '[class*="message-wrap"][class*="user"], ' +
                '[class*="message"][class*="user"]'
            ));
            
            // Fallback search if needed
            if (userMessages.length === 0 && chatbot) {
                const allDivs = Array.from(chatbot.querySelectorAll('div'));
                userMessages = allDivs.filter(div => {
                    const classes = (div.className || '').toString();
                    const hasUser = classes.includes('user');
                    const hasMessage = classes.includes('message') || classes.includes('message-wrap');
                    return hasUser && hasMessage;
                });
            }
            
            console.log('🔍 Searching for user messages, found:', userMessages.length);
            
            if (userMessages.length === 0) {
                return;
            }
            
            // Remove edit buttons from ALL user messages first
            const allEditButtons = Array.from(searchRoot.querySelectorAll('.edit-user-message-btn'));
            allEditButtons.forEach(btn => btn.remove());
            
            // Get the latest user message (last one in the DOM) - only add button to this one
            const latestUserMessage = userMessages[userMessages.length - 1];
            if (!latestUserMessage) {
                return;
            }
            
            // Get the parent container (message-wrap)
            const parentContainer = latestUserMessage.parentElement;
            if (!parentContainer || parentContainer === document.body) {
                return;
            }
            
            // Skip if already in edit mode
            if (latestUserMessage.classList.contains('editing-message')) {
                return;
            }
            
            console.log('✅ Injecting edit button for latest user message only');
            
            // Get the text content
            const messageText = latestUserMessage.textContent || latestUserMessage.innerText || '';
            
            // Create edit button
            const editButton = document.createElement('button');
            editButton.className = 'edit-user-message-btn';
            editButton.setAttribute('type', 'button');
            editButton.setAttribute('aria-label', 'Edit message');
            editButton.setAttribute('title', 'Edit message');
            editButton.innerHTML = pencilIconSVG;
            
            // Add click handler to convert message to editable textarea
            editButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('✏️ Edit button clicked for message:', messageText);
                
                // Convert message box to editable textarea
                convertMessageToEditable(latestUserMessage, parentContainer, editButton);
            });
            
            // Insert edit button at the LEFT of the grey message box
            if (parentContainer && parentContainer !== document.body) {
                try {
                    parentContainer.insertBefore(editButton, latestUserMessage);
                } catch (error) {
                    console.error('❌ Error inserting edit button:', error);
                    if (parentContainer.firstChild) {
                        parentContainer.insertBefore(editButton, parentContainer.firstChild);
                    } else {
                        parentContainer.appendChild(editButton);
                    }
                }
            }
            
            // Ensure button is visible
            editButton.style.display = 'flex';
            editButton.style.visibility = 'visible';
            editButton.style.opacity = '0.7';
            
            console.log('✅ Edit button injected successfully');
        }
        
        // Convert message box to editable input with cancel/send buttons
        function convertMessageToEditable(messageElement, parentContainer, editButton) {
            // Mark as editing
            messageElement.classList.add('editing-message');
            
            // Hide edit button
            if (editButton) {
                editButton.style.display = 'none';
            }
            
            // Hide copy and edit buttons in the message wrap and parent containers
            if (parentContainer) {
                // Find all buttons in the message wrap and its parents
                const allButtons = parentContainer.querySelectorAll('button');
                const copyButtons = Array.from(allButtons).filter(btn => {
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const title = (btn.getAttribute('title') || '').toLowerCase();
                    const classes = (btn.className || '').toString();
                    return ariaLabel.includes('copy') || title.includes('copy') || 
                           classes.includes('edit-user-message-btn');
                });
                
                copyButtons.forEach(btn => {
                    if (!btn.classList.contains('edit-cancel-btn') && 
                        !btn.classList.contains('edit-send-btn')) {
                        btn.style.display = 'none';
                        btn.style.visibility = 'hidden';
                        btn.setAttribute('data-originally-visible', 'true');
                    }
                });
            }
            
            // Also hide edit button using the editButton parameter
            if (editButton && editButton.parentNode) {
                editButton.style.display = 'none';
                editButton.style.visibility = 'hidden';
            }
            
            // Get original text
            const originalText = messageElement.textContent || messageElement.innerText || '';
            
            // Store original HTML structure (we'll need to restore it on cancel)
            const originalHTML = messageElement.innerHTML;
            messageElement.setAttribute('data-original-html', originalHTML);
            
            // Remove blue background from message element
            messageElement.style.backgroundColor = 'transparent';
            messageElement.style.background = 'transparent';
            messageElement.style.padding = '0';
            messageElement.style.border = 'none';
            messageElement.style.boxShadow = 'none';
            
            // Create textarea (auto-grows from 2 rows to 6 rows of text, with 1 reserved row for buttons)
            const textarea = document.createElement('textarea');
            textarea.className = 'editable-message-textarea';
            textarea.value = originalText.trim();
            textarea.rows = 2; // Start with 2 rows of text (button row is separate, reserved via padding)
            textarea.cols = 100; // Set columns for width
            // Ensure blue border is visible (same color #2563eb and shadow as input textbox on focus)
            textarea.style.border = '2px solid #2563eb';
            textarea.style.borderWidth = '2px';
            textarea.style.borderStyle = 'solid';
            textarea.style.borderColor = '#2563eb';
            textarea.style.marginTop = '20px'; // Move down to avoid logo container blocking top border
            textarea.style.opacity = '1'; // Ensure border is fully opaque
            textarea.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.1)'; // Same shadow as input textbox on focus
            // Set heights: 2-6 rows for text + 1 reserved row for buttons
            const rowHeight = 30; // Approximate height per row (line-height 1.5 * font-size 16px)
            const textRowsMin = 2;
            const textRowsMax = 6;
            const buttonRow = 1;
            const minTextHeight = textRowsMin * rowHeight; // 60px for 2 rows of text
            const maxTextHeight = textRowsMax * rowHeight; // 180px for 6 rows of text
            const buttonRowHeight = buttonRow * rowHeight; // 30px for button row
            
            textarea.style.minHeight = (minTextHeight + buttonRowHeight) + 'px'; // 90px: 2 rows text + 1 row buttons
            textarea.style.maxHeight = (maxTextHeight + buttonRowHeight) + 'px'; // 210px: 6 rows text + 1 row buttons
            textarea.style.resize = 'none'; // Disable manual resize
            textarea.style.overflowY = 'auto'; // Scrollable when max-height reached
            textarea.style.overflowX = 'hidden';
            
            // Auto-grow function to adjust textarea height as user types
            // This ensures text stays above buttons and cursor doesn't go to button row
            function autoGrow() {
                // Reset height to calculate scrollHeight correctly
                textarea.style.height = 'auto';
                
                // Get computed styles
                const computedStyle = window.getComputedStyle(textarea);
                const paddingTop = parseInt(computedStyle.paddingTop, 10);
                const paddingBottom = parseInt(computedStyle.paddingBottom, 10);
                const paddingVertical = paddingTop + paddingBottom;
                
                // Calculate new height based on content
                // scrollHeight includes padding
                const scrollHeight = textarea.scrollHeight;
                
                // Content height (without padding) - this is the actual text area
                const contentHeight = scrollHeight - paddingVertical;
                
                // Calculate height: content + padding, but ensure button row is always reserved
                const minHeight = minTextHeight + buttonRowHeight; // 90px
                const maxHeight = maxTextHeight + buttonRowHeight; // 210px
                
                let newHeight;
                if (contentHeight <= minTextHeight) {
                    // Minimum: 2 rows of text + button row (ensure even 1 line has space)
                    newHeight = Math.max(minHeight, contentHeight + paddingVertical);
                } else if (contentHeight >= maxTextHeight) {
                    // Maximum: 6 rows of text + button row
                    // When at max, ensure scrollable area stops at exactly 6 rows
                    newHeight = maxHeight;
                } else {
                    // Dynamic: content height + button row + padding
                    newHeight = contentHeight + paddingVertical;
                }
                
                // Ensure minimum height to prevent buttons from blocking text
                newHeight = Math.max(newHeight, minHeight);
                
                textarea.style.height = newHeight + 'px';
                
                // When content exceeds max, limit the scrollable area
                // Set max scroll position to prevent scrolling into button area
                if (contentHeight > maxTextHeight) {
                    // Calculate the maximum scroll position (6 rows of text visible)
                    // scrollHeight - clientHeight gives us how much to scroll
                    // Account for padding-bottom to keep last line visible
                    const maxScrollTop = scrollHeight - textarea.clientHeight;
                    // If scrolled too far, reset to max allowed
                    if (textarea.scrollTop > maxScrollTop) {
                        textarea.scrollTop = maxScrollTop;
                    }
                }
            }
            
            // Prevent scrolling into button area - enforce strict limit
            // This function ensures scroll area ends exactly above the button row
            function enforceScrollLimit() {
                // Calculate maximum scroll position
                // scrollHeight = total content height (including all padding)
                // clientHeight = visible height (including all padding)
                // maxScrollTop = scrollHeight - clientHeight to ensures that text can't scroll into button area
                const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
                
                // Enforce the limit strictly - prevent any scrolling into button area
                if (textarea.scrollTop > maxScrollTop) {
                    textarea.scrollTop = maxScrollTop;
                }
            }
            
            // Prevent scrolling into button area on scroll event
            textarea.addEventListener('scroll', enforceScrollLimit);
            
            // Also enforce after input to catch any programmatic scrolling
            textarea.addEventListener('input', function() {
                setTimeout(enforceScrollLimit, 0);
            });
            
            // Wrap autoGrow to enforce scroll limit after height adjustment
            const originalAutoGrow = autoGrow;
            autoGrow = function() {
                originalAutoGrow();
                setTimeout(enforceScrollLimit, 0);
            };
            
            // Call autoGrow initially to set correct height
            autoGrow();
            
            // Add event listeners for auto-grow
            textarea.addEventListener('input', autoGrow);
            textarea.addEventListener('keyup', autoGrow);
            textarea.addEventListener('keydown', autoGrow);
            
            // Create button container
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'edit-message-buttons';
            buttonContainer.style.display = 'flex';
            buttonContainer.style.flexDirection = 'row';
            buttonContainer.style.alignItems = 'center';
            buttonContainer.style.gap = '32px'; // Spacing between buttons
            buttonContainer.style.position = 'absolute';
            buttonContainer.style.right = '24px'; // Increased from 12px to push buttons left, creating more space on right
            buttonContainer.style.bottom = '20px'; // Increased from 12px to create more space from bottom border
            buttonContainer.style.zIndex = '10';
            
            // Create cancel button (text)
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'edit-cancel-btn';
            cancelBtn.setAttribute('type', 'button');
            cancelBtn.setAttribute('aria-label', 'Cancel editing');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.padding = '8px 16px'; // Further reduced padding
            cancelBtn.style.borderRadius = '20px'; // More rounded
            cancelBtn.style.border = '1px solid #d1d5db'; // Lighter grey border
            cancelBtn.style.borderStyle = 'solid';
            cancelBtn.style.borderWidth = '1px';
            cancelBtn.style.borderColor = '#d1d5db'; // Lighter grey
            cancelBtn.style.background = 'white';
            cancelBtn.style.cursor = 'pointer';
            cancelBtn.style.color = '#333';
            cancelBtn.style.fontSize = '14px'; // Smaller font
            cancelBtn.style.fontWeight = '500';
            cancelBtn.style.marginRight = '16px'; // Spacing between buttons
            cancelBtn.style.boxSizing = 'border-box';
            cancelBtn.style.display = 'inline-flex';
            cancelBtn.style.alignItems = 'center';
            cancelBtn.style.justifyContent = 'center';
            
            cancelBtn.addEventListener('mouseenter', () => {
                cancelBtn.style.background = '#f5f5f5';
            });
            cancelBtn.addEventListener('mouseleave', () => {
                cancelBtn.style.background = 'white';
            });
            
            // Create send button (text)
            const sendBtn = document.createElement('button');
            sendBtn.className = 'edit-send-btn';
            sendBtn.setAttribute('type', 'button');
            sendBtn.setAttribute('aria-label', 'Send edited message');
            sendBtn.textContent = 'Send';
            sendBtn.style.padding = '8px 16px'; // Further reduced padding
            sendBtn.style.borderRadius = '20px'; // More rounded
            sendBtn.style.border = 'none';
            sendBtn.style.background = '#2563eb';
            sendBtn.style.cursor = 'pointer';
            sendBtn.style.color = 'white';
            sendBtn.style.fontSize = '14px'; // Smaller font
            sendBtn.style.fontWeight = '500';
            sendBtn.style.boxSizing = 'border-box';
            sendBtn.style.display = 'inline-flex';
            sendBtn.style.alignItems = 'center';
            sendBtn.style.justifyContent = 'center';
            sendBtn.style.marginLeft = '0';
            
            sendBtn.addEventListener('mouseenter', () => {
                sendBtn.style.background = '#1d4ed8';
            });
            sendBtn.addEventListener('mouseleave', () => {
                sendBtn.style.background = '#2563eb';
            });
            
            // Wrap message element in a container for positioning
            const wrapper = document.createElement('div');
            wrapper.className = 'editable-message-wrapper';
            wrapper.style.position = 'relative';
            wrapper.style.width = '100%';
            
            // Replace message content with textarea
            messageElement.innerHTML = '';
            messageElement.appendChild(wrapper);
            wrapper.appendChild(textarea);
            wrapper.appendChild(buttonContainer);
            buttonContainer.appendChild(cancelBtn);
            buttonContainer.appendChild(sendBtn);
            
            // Focus textarea
            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            
            // Cancel handler
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('❌ Edit cancelled');
                cancelEditing(messageElement, parentContainer, editButton);
            });
            
            // Send handler
            sendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const editedText = textarea.value.trim();
                if (editedText) {
                    console.log('✅ Sending edited message:', editedText);
                    // Enable stop button when sending edited message
                    enableStopButtonForEdit();
                    sendEditedMessage(editedText, messageElement, parentContainer, editButton);
                }
            });
            
            // Disable bottom send button when editing starts
            disableBottomSendButton();
            
            // Re-enable bottom send button when editing is cancelled or finished
            const textareaObserver = new MutationObserver(() => {
                // Check if textarea is still present (editing still active)
                if (!messageElement.querySelector('.editable-message-textarea')) {
                    // Editing finished - re-enable bottom send button
                    enableBottomSendButton();
                    textareaObserver.disconnect();
                }
            });
            
            // Watch for textarea removal
            if (messageElement) {
                textareaObserver.observe(messageElement, {
                    childList: true,
                    subtree: true
                });
            }
        }
        
        // Disable bottom send button when editing
        function disableBottomSendButton() {
            // Find the bottom send button (chat page)
            let button = document.querySelector('#upload-button-chat');
            if (!button) {
                const buttons = document.querySelectorAll('.upload-button');
                for (let btn of buttons) {
                    if (btn.offsetParent !== null) {
                        button = btn;
                        break;
                    }
                }
            }
            
            if (button) {
                button.disabled = true;
                button.setAttribute('disabled', 'true');
                button.style.pointerEvents = 'none';
                button.style.cursor = 'not-allowed';
                button.style.opacity = '0.5';
                console.log('🔒 Bottom send button disabled (editing active)');
            }
        }
        
        // Enable bottom send button when editing ends
        function enableBottomSendButton() {
            // Find the bottom send button (chat page)
            let button = document.querySelector('#upload-button-chat');
            if (!button) {
                const buttons = document.querySelectorAll('.upload-button');
                for (let btn of buttons) {
                    if (btn.offsetParent !== null) {
                        button = btn;
                        break;
                    }
                }
            }
            
            if (button) {
                // Check if textbox has content to determine if button should be enabled
                const inputs = document.querySelectorAll('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
                const input = inputs[0];
                const hasInput = input && input.value.trim().length > 0;
                
                // Only enable if not in stop mode and textbox has content
                if (!button.classList.contains('stop-mode')) {
                    if (hasInput) {
                        button.disabled = false;
                        button.removeAttribute('disabled');
                        button.style.pointerEvents = 'auto';
                        button.style.cursor = 'pointer';
                        button.style.opacity = '1';
                    } else {
                        button.disabled = true;
                        button.setAttribute('disabled', 'true');
                        button.style.pointerEvents = 'none';
                        button.style.cursor = 'not-allowed';
                        button.style.opacity = '0.5';
                    }
                }
                console.log('🔓 Bottom send button state updated (editing ended)');
            }
        }
        
        // Enable stop button when sending edited message
        function enableStopButtonForEdit() {
            // Trigger the stop button monitoring by dispatching a custom event
            // or directly calling the stop button's startMonitoring function
            const event = new CustomEvent('editMessageSent', {
                detail: { action: 'startMonitoring' }
            });
            document.dispatchEvent(event);
            console.log('🔄 Stop button monitoring triggered for edited message');
        }
        
        // Cancel editing - restore original message
        function cancelEditing(messageElement, parentContainer, editButton) {
            const originalHTML = messageElement.getAttribute('data-original-html');
            if (originalHTML) {
                messageElement.innerHTML = originalHTML;
                messageElement.removeAttribute('data-original-html');
            }
            messageElement.classList.remove('editing-message');
            
            // Restore blue background
            messageElement.style.backgroundColor = '';
            messageElement.style.padding = '';
            
            // Show edit button again
            if (editButton) {
                editButton.style.display = 'inline-flex';
            }
            
            // Show copy buttons again
            if (parentContainer) {
                const copyButtons = parentContainer.querySelectorAll('button[data-originally-visible="true"]');
                copyButtons.forEach(btn => {
                    btn.style.display = '';
                    btn.removeAttribute('data-originally-visible');
                });
            }
            
            // Re-enable bottom send button
            enableBottomSendButton();
        }
        
        // Send edited message
        async function sendEditedMessage(editedText, messageElement, parentContainer, editButton) {
            // Disable buttons during send
            const sendBtn = messageElement.querySelector('.edit-send-btn');
            const cancelBtn = messageElement.querySelector('.edit-cancel-btn');
            if (sendBtn) sendBtn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            
            try {
                // Update the message in the UI immediately - convert back to blue message box
                messageElement.innerHTML = '';
                messageElement.textContent = editedText;
                messageElement.classList.remove('editing-message');
                
                // Ensure message.user class is present (in case it was removed)
                if (!messageElement.classList.contains('message')) {
                    messageElement.classList.add('message');
                }
                if (!messageElement.classList.contains('user')) {
                    messageElement.classList.add('user');
                }
                
                messageElement.removeAttribute('data-original-html');
                
                // Restore all original styles - remove any inline styles added during editing
                messageElement.style.backgroundColor = '';
                messageElement.style.background = '';
                messageElement.style.border = '';
                messageElement.style.boxShadow = '';
                messageElement.style.width = '';
                messageElement.style.maxWidth = '';
                messageElement.style.minWidth = '';
                messageElement.style.marginTop = '';
                messageElement.style.marginBottom = '';
                messageElement.style.display = '';
                messageElement.style.verticalAlign = '';
                messageElement.style.opacity = '';
                messageElement.style.filter = '';
                
                // Restore original padding but add bottom padding for better spacing after editing
                // Use setProperty with !important to override CSS !important rules
                messageElement.style.setProperty('padding-top', '16px', 'important');
                messageElement.style.setProperty('padding-right', '20px', 'important');
                messageElement.style.setProperty('padding-bottom', '24px', 'important'); // Increased bottom padding (28px) for edited messages
                messageElement.style.setProperty('padding-left', '20px', 'important');
                
                // CSS will apply .message.user styling (blue background, border-radius, etc.)
                // Override padding above to add bottom padding only after editing
                
                // Show edit button again
                if (editButton) {
                    editButton.style.display = 'inline-flex';
                }
                
                // Show copy buttons again
                if (parentContainer) {
                    const copyButtons = parentContainer.querySelectorAll('button[data-originally-visible="true"]');
                    copyButtons.forEach(btn => {
                        btn.style.display = '';
                        btn.removeAttribute('data-originally-visible');
                    });
                }
                
                // parentContainer is already the .message-wrap.user container
                const userMessageWrap = parentContainer;
                console.log('📦 User message wrap (parentContainer):', userMessageWrap, 'className:', userMessageWrap.className);
                
                // Find existing bot message by searching for .message.bot elements
                let botMessageWrap = null;
                let botMessageElement = null;
                
                console.log('🔍 Searching for bot messages by .message.bot elements');
                const chatbot = document.querySelector('.chatbot, [data-testid*="chatbot"], #chatbot-container, [class*="chatbot"]');
                if (chatbot) {
                    // Find all .message.bot elements
                    let botMessages = Array.from(chatbot.querySelectorAll('.message.bot'));
                    
                    // If that doesn't work, search for elements with "message" and "bot" classes
                    if (botMessages.length === 0) {
                        const allDivs = Array.from(chatbot.querySelectorAll('div'));
                        botMessages = allDivs.filter(div => {
                            const classes = (div.className || '').toString();
                            return classes.includes('message') && classes.includes('bot') && !classes.includes('user');
                        });
                    }
                    
                    console.log('🔍 Found', botMessages.length, 'bot message elements');
                    
                    if (botMessages.length > 0) {
                        // Get the last one (latest bot message)
                        botMessageElement = botMessages[botMessages.length - 1];
                        console.log('✅ Found latest bot message element:', botMessageElement, 'classes:', botMessageElement.className);
                        
                        // Find the parent wrap (could be message-wrap, or flex-wrap with role, etc.)
                        let current = botMessageElement.parentElement;
                        while (current && current !== chatbot && current !== document.body) {
                            const classes = (current.className || '').toString();
                            // Check if this parent is a message wrap (has message-wrap, or flex-wrap with role)
                            if (classes.includes('message-wrap') || 
                                (classes.includes('flex-wrap') && (classes.includes('bot') || classes.includes('role')))) {
                                botMessageWrap = current;
                                break;
                            }
                            current = current.parentElement;
                        }
                        
                        // Didn't find a wrap but found the element, use the element's parent
                        if (!botMessageWrap && botMessageElement.parentElement) {
                            botMessageWrap = botMessageElement.parentElement;
                            console.log('⚠️ Using parent as botMessageWrap:', botMessageWrap, 'classes:', botMessageWrap.className);
                        }
                        
                        if (botMessageWrap) {
                            console.log('✅ Found bot message wrap:', botMessageWrap, 'classes:', botMessageWrap.className);
                        } else {
                            console.log('⚠️ Found botMessageElement but not botMessageWrap');
                        }
                    } else {
                        console.log('⚠️ No bot message elements found');
                    }
                } else {
                    console.log('⚠️ Chatbot container not found');
                }
                
                // If no existing bot message, than can't edit - this shouldn't happen
                if (!botMessageElement) {
                    console.error('❌ Could not find existing bot message element to edit');
                    alert('Error: Could not find bot message to update. Please refresh the page.');
                    return;
                }
                
                // Find the text node to update without breaking Gradio structure
                let textNodeToUpdate = null;
                
                if (botMessageElement) {
                    // Try to find the actual text node within the structure
                    // Look for the innermost element that contains text
                    const possibleContainers = [
                        botMessageElement.querySelector('div[data-testid="bot"] .message-content .md p'),
                        botMessageElement.querySelector('div[data-testid="bot"] .message-content p'),
                        botMessageElement.querySelector('div[data-testid="bot"] .md p'),
                        botMessageElement.querySelector('.message-content .md p'),
                        botMessageElement.querySelector('.message-content p'),
                        botMessageElement.querySelector('.md p'),
                        botMessageElement.querySelector('div[data-testid="bot"] .message-content'),
                        botMessageElement.querySelector('div[data-testid="bot"] .md'),
                        botMessageElement.querySelector('.message-content'),
                        botMessageElement.querySelector('.md'),
                        botMessageElement.querySelector('div[data-testid="bot"]'),
                        botMessageElement.querySelector('p'),
                        botMessageElement
                    ];
                    
                    for (const container of possibleContainers) {
                        if (container) {
                            textNodeToUpdate = container;
                            break;
                        }
                    }
                    
                    // Set loading indicator - add it without replacing structure
                    if (textNodeToUpdate && textNodeToUpdate !== botMessageElement) {
                        // Store original content
                        const originalContent = textNodeToUpdate.textContent || textNodeToUpdate.innerText || '';
                        textNodeToUpdate.setAttribute('data-original-content', originalContent);
                        textNodeToUpdate.innerHTML = '<span class="loading-dots"><span></span><span></span><span></span></span>';
                    } else {
                        // Fallback: add loading to the element itself
                        const originalContent = botMessageElement.textContent || botMessageElement.innerText || '';
                        botMessageElement.setAttribute('data-original-content', originalContent);
                        botMessageElement.innerHTML = '<span class="loading-dots"><span></span><span></span><span></span></span>';
                        textNodeToUpdate = botMessageElement;
                    }
                    console.log('⏳ Set loading indicator on bot message (preserving structure)');
                }
                
                // Call the edit API endpoint and stream the response
                const response = await fetch(`${API_BASE}/chat/edit/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        session_id: SESSION_ID,
                        message: editedText
                    })
                }).catch(err => {
                    console.error('❌ Fetch error:', err);
                    throw err; // Re-throw to be caught by outer try-catch
                });
                
                if (!response || !response.ok) {
                    throw new Error(`HTTP error! status: ${response ? response.status : 'no response'}`);
                }
                
                // Read streaming response
                const reader = response.body ? response.body.getReader() : null;
                if (!reader) {
                    throw new Error('Response body is not readable');
                }
                
                const decoder = new TextDecoder();
                let buffer = '';
                let accumulatedResponse = '';
                let firstToken = true;
                
                try {
                    while (true) {
                        const { done, value } = await reader.read().catch(err => {
                            console.warn('⚠️ Reader error:', err);
                            return { done: true, value: null };
                        });
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer
                    
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        
                        try {
                            const data = JSON.parse(line);
                            
                            if (data.error) {
                                if (botMessageElement) {
                                    botMessageElement.textContent = `Error: ${data.error}`;
                                }
                                break;
                            }
                            
                            if (data.token) {
                                accumulatedResponse += data.token;
                                
                                // Update bot message with accumulated response (preserve structure)
                                if (botMessageElement && textNodeToUpdate) {
                                    if (firstToken) {
                                        // Remove loading dots and show first token
                                        // Update only text content, never replace innerHTML
                                        textNodeToUpdate.textContent = accumulatedResponse.trim();
                                        firstToken = false;
                                        console.log('✅ First token received, updating bot message');
                                    } else {
                                        // Update accumulated response
                                        textNodeToUpdate.textContent = accumulatedResponse;
                                    }
                                } else if (botMessageElement) {
                                    // Fallback if textNodeToUpdate not found
                                    botMessageElement.textContent = accumulatedResponse;
                                } else {
                                    console.warn('⚠️ Token received but botMessageElement is null');
                                }
                            }
                            
                            if (data.stopped) {
                                if (botMessageElement && accumulatedResponse) {
                                    // Final update preserving structure
                                    if (textNodeToUpdate) {
                                        textNodeToUpdate.textContent = accumulatedResponse.trim();
                                    } else {
                                        botMessageElement.textContent = accumulatedResponse.trim();
                                    }
                                }
                                break;
                            }
                        } catch (e) {
                            // Skip invalid JSON lines
                            console.warn('⚠️ Failed to parse JSON:', line);
                        }
                    }
                }
                
                // Final update (preserve structure)
                if (botMessageElement && accumulatedResponse) {
                    if (textNodeToUpdate) {
                        textNodeToUpdate.textContent = accumulatedResponse.trim();
                    } else {
                        botMessageElement.textContent = accumulatedResponse.trim();
                    }
                }
                
                // Don't touch button containers - just let Gradio handle them naturally
                // The existing bot message structure is preserved, just replaced the text content
            } catch (error) {
                console.error('❌ Error in streaming response:', error);
                // Handle streaming errors - update UI to show error
                if (botMessageElement) {
                    botMessageElement.textContent = `Error: ${error.message || 'Failed to update message'}`;
                }
            }
            } catch (error) {
                console.error('❌ Error sending edited message:', error);
                alert('Error updating message. Please try again.');
                
                // Re-enable buttons
                if (sendBtn) sendBtn.disabled = false;
                if (cancelBtn) cancelBtn.disabled = false;
            }
        }
        
        // Watch for new user messages being added
        let lastUserMessageCount = 0;
        let isInjecting = false;

        const observer = new MutationObserver((mutations) => {
            if (isInjecting) {
                return;
            }
            
            const chatbot = document.querySelector('.chatbot, [data-testid*="chatbot"], #chatbot-container, [class*="chatbot"]');
            const searchRoot = chatbot || document;
            
            let userMessages = Array.from(searchRoot.querySelectorAll(
                '.message-wrap.user, ' +
                '.message.user, ' +
                '[class*="message-wrap"][class*="user"], ' +
                '[class*="message"][class*="user"]'
            ));
            
            if (userMessages.length === 0 && chatbot) {
                const allDivs = Array.from(chatbot.querySelectorAll('div'));
                userMessages = allDivs.filter(div => {
                    const classes = (div.className || '').toString();
                    const hasUser = classes.includes('user');
                    const hasMessage = classes.includes('message') || classes.includes('message-wrap');
                    return hasUser && hasMessage;
                });
            }
            
            if (userMessages.length !== lastUserMessageCount) {
                isInjecting = true;
                setTimeout(() => {
                    injectEditButton();
                    lastUserMessageCount = userMessages.length;
                    setTimeout(() => {
                        isInjecting = false;
                    }, 100);
                }, 300);
            }
        });
        
        // Start observing
        const observeTarget = document.body;
        observer.observe(observeTarget, {
            childList: true,
            subtree: true
        });
        
        console.log('👀 Observer started on:', observeTarget.tagName);
        
        // Initial injection
        setTimeout(() => {
            injectEditButton();
        }, 1000);
        
        console.log('✅ Edit button script initialized');
    }
    
    // Prevent multiple initializations
    if (window.editButtonInitialized) {
        console.log('📝 Edit button already initialized, skipping');
        return;
    }
    window.editButtonInitialized = true;
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📝 Edit button script: DOMContentLoaded');
            setupEditButton();
        });
    } else {
        console.log('📝 Edit button script: DOM already ready');
        setupEditButton();
    }
})();

console.log('📝 Edit user message script loaded');
