(function() {
    'use strict';
    
    console.log('🎤 Microphone recording script loaded');
    
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let microphoneButton = null;
    let currentStream = null;
    let textbox = null;
    let originalPlaceholder = null;
    
    const SPEECH_TO_TEXT_API = '__API_BASE_URL__/speech-to-text/';
    
    // Initialize microphone button handlers
    function setupMicrophoneButton() {
        // Find all microphone buttons (welcome and chat sections)
        const micButtons = document.querySelectorAll('#mic-button');
        
        if (micButtons.length === 0) {
            console.log('🎤 Microphone buttons not found, will retry...');
            setTimeout(setupMicrophoneButton, 500);
            return;
        }
        
        console.log(`🎤 Found ${micButtons.length} microphone button(s)`);
        
        // Attach click event to all microphone buttons
        micButtons.forEach((btn, index) => {
            // Check if listener already attached (prevent duplicates)
            if (!btn.hasAttribute('data-mic-listener-attached')) {
                // Add click event to toggle recording
                btn.addEventListener('click', toggleRecording);
                btn.setAttribute('data-mic-listener-attached', 'true');
                console.log(`✅ Microphone button ${index + 1} handler attached`);
            }
        });
        
        // Store the first button as the primary reference (for backward compatibility)
        microphoneButton = micButtons[0];
        
        // Find textbox (will be updated based on which button is clicked)
        textbox = document.querySelector('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
        
        if (textbox) {
            // Store original placeholder
            if (!originalPlaceholder) {
                originalPlaceholder = textbox.placeholder || 'How can I help you today?';
            }
            console.log('✅ Textbox found');
        } else {
            console.log('📝 Textbox not found, will retry...');
            setTimeout(setupMicrophoneButton, 500);
            return;
        }
        
        console.log('✅ Microphone buttons setup complete');
    }
    
    // Toggle recording (click to start, will be stopped by cancel/confirm buttons)
    async function toggleRecording(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (isRecording) {
            // If already recording, clicking mic again does nothing (user must use cancel/confirm)
            return;
        }
        
        // Find the textbox associated with the clicked button
        const clickedButton = e.currentTarget || e.target.closest('#mic-button');
        let inputContainer = null;
        
        if (clickedButton) {
            // Find the textbox in the same input container
            inputContainer = clickedButton.closest('#input-container');
            if (inputContainer) {
                const nearbyTextbox = inputContainer.querySelector('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
                if (nearbyTextbox) {
                    textbox = nearbyTextbox;
                    // Store original placeholder if not stored yet
                    if (!originalPlaceholder) {
                        originalPlaceholder = textbox.placeholder || 'How can I help you today?';
                    }
                    console.log('✅ Found textbox for clicked button');
                }
            }
        }
        
        // Fallback to general textbox finder if above didn't work
        if (!textbox) {
            textbox = document.querySelector('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
            if (!originalPlaceholder && textbox) {
                originalPlaceholder = textbox.placeholder || 'How can I help you today?';
            }
            // Try to find input container from textbox
            if (textbox) {
                inputContainer = textbox.closest('#input-container') || textbox.parentElement;
            }
        }
        
        // Hide mic and send buttons IMMEDIATELY (before requesting microphone access)
        // This provides instant feedback to the user
        const micBtn = inputContainer ? inputContainer.querySelector('#mic-button') : document.querySelector('#mic-button');
        
        // Try multiple ways to find the send button
        let sendBtn = null;
        if (inputContainer) {
            // Try specific IDs first
            sendBtn = inputContainer.querySelector('#upload-button-welcome') || 
                     inputContainer.querySelector('#upload-button-chat') ||
                     inputContainer.querySelector('#upload-button');
            // If not found, try by class
            if (!sendBtn) {
                const uploadButtons = inputContainer.querySelectorAll('button.upload-button, button[class*="upload"]');
                sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
            }
        } else {
            // Try document-wide search
            sendBtn = document.querySelector('#upload-button-welcome') || 
                     document.querySelector('#upload-button-chat') ||
                     document.querySelector('#upload-button');
            if (!sendBtn) {
                const uploadButtons = document.querySelectorAll('button.upload-button, button[class*="upload"]');
                sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
            }
        }
        
        console.log('🎤 Hiding buttons immediately - micBtn:', micBtn, 'sendBtn:', sendBtn, 'inputContainer:', inputContainer);
        
        if (micBtn) {
            micBtn.style.setProperty('display', 'none', 'important');
            micBtn.style.setProperty('visibility', 'hidden', 'important');
            micBtn.style.setProperty('opacity', '0', 'important');
        }
        if (sendBtn) {
            sendBtn.style.setProperty('display', 'none', 'important');
            sendBtn.style.setProperty('visibility', 'hidden', 'important');
            sendBtn.style.setProperty('opacity', '0', 'important');
            console.log('✅ Send button hidden:', sendBtn.id || sendBtn.className, 'Element:', sendBtn);
        } else {
            console.warn('⚠️ Send button not found! Searching in:', inputContainer);
            // Try to find all buttons in the container for debugging
            if (inputContainer) {
                const allButtons = inputContainer.querySelectorAll('button');
                console.warn('All buttons in container:', Array.from(allButtons).map(btn => ({
                    id: btn.id,
                    className: btn.className,
                    ariaLabel: btn.getAttribute('aria-label')
                })));
            }
        }
        
        // Start recording (this will show the recording UI after mic access is granted)
        await startRecording();
    }
    
    // Start recording audio
    async function startRecording() {
        if (isRecording) return;
        
        try {
            // Request microphone access with proper error handling
            console.log('🎤 Requesting microphone access...');
            
            // Check if getUserMedia is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia is not supported in this browser');
            }
            
            currentStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100,
                    channelCount: 1
                } 
            });
            
            console.log('✅ Microphone access granted');
            
            // Create MediaRecorder
            const options = {
                mimeType: 'audio/webm;codecs=opus'
            };
            
            // Fallback to default if webm not supported
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                console.warn('⚠️ WebM not supported, using default codec');
                options.mimeType = '';
            }
            
            mediaRecorder = new MediaRecorder(currentStream, options);
            
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    audioChunks.push(event.data);
                    console.log('📦 Audio chunk received:', event.data.size, 'bytes');
                }
            };
            
            mediaRecorder.onstop = async () => {
                // Stop all tracks to release microphone
                if (currentStream) {
                    currentStream.getTracks().forEach(track => {
                        track.stop();
                        console.log('🛑 Track stopped:', track.kind);
                    });
                    currentStream = null;
                }
            };
            
            mediaRecorder.onerror = (event) => {
                console.error('❌ MediaRecorder error:', event.error);
                stopRecording();
                hideRecordingUI();
                alert('Error during recording. Please try again.');
            };
            
            // Start recording
            mediaRecorder.start(100); // Collect data every 100ms
            isRecording = true;
            
            console.log('🎤 Recording started, state:', mediaRecorder.state);
            
            // Update UI
            showRecordingUI();
            
        } catch (error) {
            console.error('❌ Error accessing microphone:', error);
            let errorMessage = 'Microphone access denied. ';
            
            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage += 'Please check your browser settings and allow microphone access.';
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                errorMessage += 'No microphone found. Please connect a microphone.';
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                errorMessage += 'Microphone is being used by another application.';
            } else {
                errorMessage += `Error: ${error.message}`;
            }
            
            alert(errorMessage);
            
            // Restore buttons if recording failed
            const inputContainer = textbox ? (textbox.closest('#input-container') || textbox.parentElement) : null;
            const micBtn = inputContainer ? inputContainer.querySelector('#mic-button') : document.querySelector('#mic-button');
            let sendBtn = inputContainer ? 
                (inputContainer.querySelector('#upload-button-welcome') || inputContainer.querySelector('#upload-button-chat') || inputContainer.querySelector('#upload-button')) :
                (document.querySelector('#upload-button-welcome') || document.querySelector('#upload-button-chat') || document.querySelector('#upload-button'));
            
            // Also try finding by class if not found
            if (!sendBtn && inputContainer) {
                const uploadButtons = inputContainer.querySelectorAll('button.upload-button, button[class*="upload"]');
                sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
            }
            if (!sendBtn) {
                const uploadButtons = document.querySelectorAll('button.upload-button, button[class*="upload"]');
                sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
            }
            
            if (micBtn) {
                // Remove !important styles by setting to default values
                micBtn.style.removeProperty('display');
                micBtn.style.removeProperty('visibility');
                micBtn.style.removeProperty('opacity');
                micBtn.style.setProperty('display', '', 'important');
                micBtn.style.setProperty('visibility', 'visible', 'important');
                micBtn.style.setProperty('opacity', '1', 'important');
            }
            if (sendBtn) {
                // Remove !important styles by setting to default values
                sendBtn.style.removeProperty('display');
                sendBtn.style.removeProperty('visibility');
                sendBtn.style.removeProperty('opacity');
                sendBtn.style.setProperty('display', '', 'important');
                sendBtn.style.setProperty('visibility', 'visible', 'important');
                sendBtn.style.setProperty('opacity', '1', 'important');
            }
            
            isRecording = false;
        }
    }
    
    // Stop recording audio (without processing)
    function stopRecording() {
        if (!isRecording || !mediaRecorder) return;
        
        // Only stop if recording is in progress
        if (mediaRecorder.state === 'recording' || mediaRecorder.state === 'inactive') {
            try {
                mediaRecorder.stop();
                isRecording = false;
                
                console.log('🎤 Recording stopped, state:', mediaRecorder.state);
            } catch (error) {
                console.error('❌ Error stopping recorder:', error);
            }
        }
        
        // Stop microphone stream
        if (currentStream) {
            currentStream.getTracks().forEach(track => {
                track.stop();
            });
            currentStream = null;
        }
        
        // Update button appearance
        if (microphoneButton) {
            microphoneButton.classList.remove('recording');
        }
    }
    
    // Show recording UI inside textbox
    function showRecordingUI() {
        if (!textbox) {
            textbox = document.querySelector('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
        }
        
        if (!textbox) {
            console.error('❌ Textbox not found');
            return;
        }
        
        // Find the input container
        const inputContainer = textbox.closest('#input-container') || textbox.parentElement;
        
        // Hide mic and send buttons first, then show cancel and confirm buttons in their place
        // Find buttons in the same input container as the textbox
        const micBtn = inputContainer ? inputContainer.querySelector('#mic-button') : document.querySelector('#mic-button');
        // Try to find send button with specific IDs first, then fallback to generic selector
        let sendBtn = inputContainer ? 
            (inputContainer.querySelector('#upload-button-welcome') || inputContainer.querySelector('#upload-button-chat') || inputContainer.querySelector('#upload-button')) :
            (document.querySelector('#upload-button-welcome') || document.querySelector('#upload-button-chat') || document.querySelector('#upload-button'));
        
        // Hide original buttons first (use !important to override any CSS)
        if (micBtn) {
            micBtn.style.setProperty('display', 'none', 'important');
            micBtn.style.setProperty('visibility', 'hidden', 'important');
            micBtn.style.setProperty('opacity', '0', 'important');
        }
        if (sendBtn) {
            sendBtn.style.setProperty('display', 'none', 'important');
            sendBtn.style.setProperty('visibility', 'hidden', 'important');
            sendBtn.style.setProperty('opacity', '0', 'important');
            console.log('✅ Send button hidden in showRecordingUI:', sendBtn.id || sendBtn.className);
        } else {
            console.warn('⚠️ Send button not found in showRecordingUI!');
        }
        
        // Create cancel button (replaces mic button) - scope to current input container
        // Remove any existing cancel button in this container first
        const existingCancelBtn = inputContainer ? inputContainer.querySelector('.recording-cancel-btn-absolute') : null;
        if (existingCancelBtn) {
            existingCancelBtn.remove();
        }
        
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'recording-cancel-btn-absolute';
        cancelBtn.setAttribute('aria-label', 'Cancel recording');
        cancelBtn.setAttribute('type', 'button');
        cancelBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        cancelBtn.addEventListener('click', handleCancel);
        
        // Position cancel button where mic button was - append to same container as mic button
        if (micBtn && micBtn.parentElement) {
            micBtn.parentElement.appendChild(cancelBtn);
        } else if (inputContainer) {
            inputContainer.appendChild(cancelBtn);
        }
        
        cancelBtn.style.display = 'flex';
        cancelBtn.style.visibility = 'visible';
        
        // Create confirm button (replaces send button) - scope to current input container
        // Remove any existing confirm button in this container first
        const existingConfirmBtn = inputContainer ? inputContainer.querySelector('.recording-confirm-btn-absolute') : null;
        if (existingConfirmBtn) {
            existingConfirmBtn.remove();
        }
        
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'recording-confirm-btn-absolute';
        confirmBtn.setAttribute('aria-label', 'Confirm and transcribe');
        confirmBtn.setAttribute('type', 'button');
        confirmBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
        confirmBtn.addEventListener('click', handleConfirm);
        
        // Position confirm button where send button was - append to same container as send button
        if (sendBtn && sendBtn.parentElement) {
            sendBtn.parentElement.appendChild(confirmBtn);
        } else if (inputContainer) {
            inputContainer.appendChild(confirmBtn);
        }
        
        confirmBtn.style.display = 'flex';
        confirmBtn.style.visibility = 'visible';
        
        // Create recording UI inside textbox - just the wave bars (many bars for longer wave)
        // Determine number of bars based on which textbox is being used
        // Chat page textbox is longer, so use 170 bars; welcome page uses 130 bars
        const inputWrapper = textbox.closest('#input-wrapper-welcome, #input-wrapper-chat');
        const isChatPage = inputWrapper && inputWrapper.id === 'input-wrapper-chat';
        const numBars = isChatPage ? 170 : 130;
        
        let waveBarsHTML = '';
        for (let i = 0; i < numBars; i++) {
            waveBarsHTML += '<div class="wave-bar"></div>';
        }
        
        const recordingHTML = `
            <div class="recording-content">
                <div class="recording-wave">
                    ${waveBarsHTML}
                </div>
            </div>
        `;
        
        // Set textbox content to recording UI
        textbox.value = '';
        textbox.placeholder = '';
        textbox.readOnly = true;
        textbox.style.paddingRight = '100px'; // Make room for buttons
        
        // Create a wrapper div inside textbox's parent to overlay the recording UI
        const inputBox = textbox.closest('.input-box') || textbox.parentElement;
        
        // Remove any existing recording UI
        const existingUI = inputBox.querySelector('.recording-ui-overlay');
        if (existingUI) {
            existingUI.remove();
        }
        
        // Create overlay for recording UI
        const recordingOverlay = document.createElement('div');
        recordingOverlay.className = 'recording-ui-overlay';
        recordingOverlay.innerHTML = recordingHTML;
        
        // Append overlay to inputBox (will be positioned absolutely)
        inputBox.appendChild(recordingOverlay);
        
        // Event listeners are already attached to the absolute-positioned buttons above
        
        console.log('✅ Recording UI shown');
    }
    
    // Hide recording UI and restore normal textbox
    function hideRecordingUI() {
        // Restore textbox
        if (textbox) {
            textbox.placeholder = originalPlaceholder || 'How can I help you today?';
            textbox.readOnly = false;
            textbox.style.paddingRight = '';
        }
        
        // Find the input container to scope button queries
        const inputContainer = textbox ? textbox.closest('#input-container') : null;
        
        // Remove recording overlay (find in same container)
        const recordingOverlay = inputContainer ? inputContainer.querySelector('.recording-ui-overlay') : document.querySelector('.recording-ui-overlay');
        if (recordingOverlay) {
            recordingOverlay.remove();
        }
        
        // Remove cancel and confirm buttons (find in same container)
        const cancelBtn = inputContainer ? inputContainer.querySelector('.recording-cancel-btn-absolute') : document.querySelector('.recording-cancel-btn-absolute');
        const confirmBtn = inputContainer ? inputContainer.querySelector('.recording-confirm-btn-absolute') : document.querySelector('.recording-confirm-btn-absolute');
        
        if (cancelBtn) {
            cancelBtn.remove();
        }
        if (confirmBtn) {
            confirmBtn.remove();
        }
        
        // Show mic and send buttons (find in same container)
        const micBtn = inputContainer ? inputContainer.querySelector('#mic-button') : document.querySelector('#mic-button');
        // Try to find send button with specific IDs first, then fallback to generic selector
        let sendBtn = inputContainer ? 
            (inputContainer.querySelector('#upload-button-welcome') || inputContainer.querySelector('#upload-button-chat') || inputContainer.querySelector('#upload-button')) :
            (document.querySelector('#upload-button-welcome') || document.querySelector('#upload-button-chat') || document.querySelector('#upload-button'));
        
        // Also try finding by class if not found
        if (!sendBtn && inputContainer) {
            const uploadButtons = inputContainer.querySelectorAll('button.upload-button, button[class*="upload"]');
            sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
        }
        if (!sendBtn) {
            const uploadButtons = document.querySelectorAll('button.upload-button, button[class*="upload"]');
            sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
        }
        
        if (micBtn) {
            // Remove !important styles by setting to default values
            micBtn.style.removeProperty('display');
            micBtn.style.removeProperty('visibility');
            micBtn.style.removeProperty('opacity');
            micBtn.style.setProperty('display', '', 'important');
            micBtn.style.setProperty('visibility', 'visible', 'important');
            micBtn.style.setProperty('opacity', '1', 'important');
        }
        if (sendBtn) {
            // Remove !important styles by setting to default values
            sendBtn.style.removeProperty('display');
            sendBtn.style.removeProperty('visibility');
            sendBtn.style.removeProperty('opacity');
            sendBtn.style.setProperty('display', '', 'important');
            sendBtn.style.setProperty('visibility', 'visible', 'important');
            sendBtn.style.setProperty('opacity', '1', 'important');
            console.log('✅ Send button restored in hideRecordingUI:', sendBtn.id || sendBtn.className);
        } else {
            console.warn('⚠️ Send button not found in hideRecordingUI!');
        }
        
        console.log('✅ Recording UI hidden');
    }
    
    // Handle cancel button click
    function handleCancel(e) {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('❌ Recording cancelled');
        
        // Stop recording
        stopRecording();
        
        // Hide recording UI
        hideRecordingUI();
        
        // Restore textbox to empty with placeholder
        if (textbox) {
            textbox.value = '';
            textbox.placeholder = originalPlaceholder || 'How can I help you today?';
        }
        
        // Ensure mic and send buttons are visible
        // Find buttons in the same container as textbox
        const inputContainer = textbox ? textbox.closest('#input-container') : null;
        const micBtn = inputContainer ? inputContainer.querySelector('#mic-button') : document.querySelector('#mic-button');
        // Try to find send button with specific IDs first, then fallback to generic selector
        let sendBtn = inputContainer ? 
            (inputContainer.querySelector('#upload-button-welcome') || inputContainer.querySelector('#upload-button-chat') || inputContainer.querySelector('#upload-button')) :
            (document.querySelector('#upload-button-welcome') || document.querySelector('#upload-button-chat') || document.querySelector('#upload-button'));
        
        // Also try finding by class if not found
        if (!sendBtn && inputContainer) {
            const uploadButtons = inputContainer.querySelectorAll('button.upload-button, button[class*="upload"]');
            sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
        }
        if (!sendBtn) {
            const uploadButtons = document.querySelectorAll('button.upload-button, button[class*="upload"]');
            sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
        }
        
        if (micBtn) {
            // Remove !important styles by setting to default values
            micBtn.style.removeProperty('display');
            micBtn.style.removeProperty('visibility');
            micBtn.style.removeProperty('opacity');
            micBtn.style.setProperty('display', '', 'important');
            micBtn.style.setProperty('visibility', 'visible', 'important');
            micBtn.style.setProperty('opacity', '1', 'important');
        }
        if (sendBtn) {
            // Remove !important styles by setting to default values
            sendBtn.style.removeProperty('display');
            sendBtn.style.removeProperty('visibility');
            sendBtn.style.removeProperty('opacity');
            sendBtn.style.setProperty('display', '', 'important');
            sendBtn.style.setProperty('visibility', 'visible', 'important');
            sendBtn.style.setProperty('opacity', '1', 'important');
            // Disable send button when textbox is empty (after cancel)
            sendBtn.disabled = true;
            console.log('✅ Send button restored in handleCancel:', sendBtn.id || sendBtn.className);
        } else {
            console.warn('⚠️ Send button not found in handleCancel!');
        }
        
        console.log('✅ Recording cancelled and UI restored');
    }
    
    // Handle confirm button click
    async function handleConfirm(e) {
        e.preventDefault();
        e.stopPropagation();
        
        console.log('✅ Recording confirmed, processing...');
        
        // Stop recording
        stopRecording();
        
        // Hide recording UI and show buttons immediately
        hideRecordingUI();
        
        // Show mic and send buttons immediately (before transcription completes)
        // Find buttons in the same container as textbox
        const inputContainer = textbox ? textbox.closest('#input-container') : null;
        const micBtn = inputContainer ? inputContainer.querySelector('#mic-button') : document.querySelector('#mic-button');
        // Try to find send button with specific IDs first, then fallback to generic selector
        let sendBtn = inputContainer ? 
            (inputContainer.querySelector('#upload-button-welcome') || inputContainer.querySelector('#upload-button-chat') || inputContainer.querySelector('#upload-button')) :
            (document.querySelector('#upload-button-welcome') || document.querySelector('#upload-button-chat') || document.querySelector('#upload-button'));
        
        // Also try finding by class if not found
        if (!sendBtn && inputContainer) {
            const uploadButtons = inputContainer.querySelectorAll('button.upload-button, button[class*="upload"]');
            sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
        }
        if (!sendBtn) {
            const uploadButtons = document.querySelectorAll('button.upload-button, button[class*="upload"]');
            sendBtn = uploadButtons.length > 0 ? uploadButtons[0] : null;
        }
        
        if (micBtn) {
            // Remove !important styles by setting to default values
            micBtn.style.removeProperty('display');
            micBtn.style.removeProperty('visibility');
            micBtn.style.removeProperty('opacity');
            micBtn.style.setProperty('display', '', 'important');
            micBtn.style.setProperty('visibility', 'visible', 'important');
            micBtn.style.setProperty('opacity', '1', 'important');
        }
        if (sendBtn) {
            // Remove !important styles by setting to default values
            sendBtn.style.removeProperty('display');
            sendBtn.style.removeProperty('visibility');
            sendBtn.style.removeProperty('opacity');
            sendBtn.style.setProperty('display', '', 'important');
            sendBtn.style.setProperty('visibility', 'visible', 'important');
            sendBtn.style.setProperty('opacity', '1', 'important');
            // Will enable after transcription (textbox will have text)
            sendBtn.disabled = true; // Disable for now, will enable after transcription
            console.log('✅ Send button restored in handleConfirm:', sendBtn.id || sendBtn.className);
        } else {
            console.warn('⚠️ Send button not found in handleConfirm!');
        }
        
        // Process and transcribe in the background (this will set text in textbox)
        try {
            await processRecording();
            
            // Enable send button after transcription completes (textbox now has text)
            if (sendBtn) {
                sendBtn.disabled = false;
            }
            
            console.log('✅ Recording processed and UI restored');
        } catch (error) {
            console.error('❌ Error processing recording:', error);
            // Keep send button disabled if transcription fails
            if (sendBtn) {
                sendBtn.disabled = true;
            }
        }
    }
    
    // Process recorded audio and send to backend
    async function processRecording() {
        if (audioChunks.length === 0) {
            console.log('⚠️ No audio data recorded');
            alert('No audio recorded. Please try again.');
            return;
        }
        
        try {
            // Combine audio chunks into a blob
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
            console.log('📦 Audio blob created:', audioBlob.size, 'bytes');
            
            // Create FormData to send to backend
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            
            console.log('📤 Sending audio to backend for transcription...');
            
            // Send to backend for transcription
            const response = await fetch(SPEECH_TO_TEXT_API, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.status === 'success' && result.text) {
                console.log('✅ Transcription successful:', result.text);
                
                // Find the text input (could be welcome or chat)
                const textInput = document.querySelector('textarea[placeholder*="help"], textarea[data-testid*="textbox"], textarea');
                
                if (textInput) {
                    // Set the transcribed text
                    textInput.value = result.text;
                    
                    // Trigger input event so Gradio recognizes the change
                    textInput.dispatchEvent(new Event('input', { bubbles: true }));
                    textInput.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // Focus the input
                    textInput.focus();
                } else {
                    console.error('❌ Text input not found');
                }
            } else {
                console.error('❌ Transcription failed:', result.error || 'Unknown error');
                alert('Error transcribing audio. Please try again.');
            }
            
        } catch (error) {
            console.error('❌ Error processing recording:', error);
            alert('Error processing audio. Please try again.');
        } finally {
            // Clear audio chunks
            audioChunks = [];
        }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('🎤 DOM ready, setting up microphone button');
            setupMicrophoneButton();
            // Also set up periodic check for chat button
            setTimeout(setupMicrophoneButton, 1000);
        });
    } else {
        console.log('🎤 DOM already ready, setting up microphone button');
        setupMicrophoneButton();
        // Also set up periodic check for chat button
        setTimeout(setupMicrophoneButton, 1000);
    }
    
    // Also watch for Gradio's dynamic DOM updates
    const observer = new MutationObserver((mutations) => {
        // Check for new microphone buttons
        const currentMicButtons = document.querySelectorAll('#mic-button');
        
        // Check if any button is missing the listener attribute
        let needsSetup = false;
        currentMicButtons.forEach(btn => {
            if (!btn.hasAttribute('data-mic-listener-attached')) {
                needsSetup = true;
            }
        });
        
        if (needsSetup) {
            console.log(`🔄 Detected ${currentMicButtons.length} microphone button(s), some need setup...`);
            setupMicrophoneButton();
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true, // Watch for visibility changes
        attributeFilter: ['style', 'class'] // Watch for style/class changes that might show/hide elements
    });
    
    // Also periodically check (in case MutationObserver misses something)
    setInterval(() => {
        const currentMicButtons = document.querySelectorAll('#mic-button');
        let needsSetup = false;
        currentMicButtons.forEach(btn => {
            if (!btn.hasAttribute('data-mic-listener-attached')) {
                needsSetup = true;
            }
        });
        if (needsSetup && currentMicButtons.length > 0) {
            console.log('🔄 Periodic check: Setting up microphone buttons...');
            setupMicrophoneButton();
        }
    }, 2000); // Check every 2 seconds
    
})();
