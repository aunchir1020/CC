(function() {
    let welcomeTextbox = null;
    let chatTextbox = null;
    let welcomeInitialized = false;
    let chatInitialized = false;
    
    // Shared constants for row calculations
    const rowHeight = 30; // line-height in pixels (matches CSS line-height: 30px)
    const textRowsMin = 2; // Minimum 2 rows of text
    const textRowsMax = 6; // Maximum 6 rows of text (becomes scrollable after this)
    const buttonRowPadding = 80; // Bottom padding to reserve space for buttons (80px to ensure buttons don't block text)
    const minTextHeight = textRowsMin * rowHeight; // 60px for 2 rows of text
    const maxTextHeight = textRowsMax * rowHeight; // 180px for 6 rows of text
    
    // Shared auto-grow function
    function autoGrow(textbox) {
        if (!textbox) return;
        
        // Reset height to calculate scrollHeight correctly
        textbox.style.height = 'auto';
        
        // Get computed styles
        const computedStyle = window.getComputedStyle(textbox);
        const paddingTop = parseInt(computedStyle.paddingTop, 10) || 12;
        const paddingBottom = parseInt(computedStyle.paddingBottom, 10) || 80;
        const paddingVertical = paddingTop + paddingBottom;
        
        // Calculate new height based on content
        const scrollHeight = textbox.scrollHeight;
        const contentHeight = scrollHeight - paddingVertical;
        
        // Calculate height bounds
        const minHeight = minTextHeight + buttonRowPadding - 50; // 90px (2 rows text + 30px button area)
        const maxHeight = maxTextHeight + buttonRowPadding - 30; // 230px (6 rows text + 50px button area)
        
        let newHeight;
        // Use scrollHeight directly - it already includes padding
        newHeight = scrollHeight;
        
        // Clamp to min/max bounds
        newHeight = Math.max(newHeight, minHeight);
        newHeight = Math.min(newHeight, maxHeight);
        
        // Apply the new height
        textbox.style.setProperty('height', newHeight + 'px', 'important');
        
        // Wait until the browser applies the new height and layout, then adjust scrollTop safely
        requestAnimationFrame(function() {
            enforceScrollLimit(textbox);
            setTimeout(function() {
                enforceScrollLimit(textbox);
            }, 10);
        });
        
        // If content exceeds max, ensure scrollable area is properly limited
        if (contentHeight > maxTextHeight) {
            setTimeout(function() {
                enforceScrollLimit(textbox);
            }, 50);
        }
    }
    
    // Shared scroll limit enforcement function
    function enforceScrollLimit(textbox) {
        if (!textbox) return;
        
        const computedStyle = window.getComputedStyle(textbox);
        const paddingBottom = parseInt(computedStyle.paddingBottom, 10) || 80;
        const scrollHeight = textbox.scrollHeight;
        const clientHeight = textbox.clientHeight;
        let currentScrollTop = textbox.scrollTop;
        
        const visibleTextArea = clientHeight - paddingBottom;
        const scrollableTextHeight = scrollHeight - paddingBottom;
        const maxScrollTop = Math.max(0, scrollableTextHeight - visibleTextArea);
        
        if (currentScrollTop > maxScrollTop) {
            textbox.scrollTop = maxScrollTop;
            requestAnimationFrame(function() {
                if (textbox && textbox.scrollTop > maxScrollTop) {
                    textbox.scrollTop = maxScrollTop;
                }
            });
        }
    }
    
    // Shared debounced auto-grow function
    function createDebouncedAutoGrow(textbox) {
        let autoGrowRafId = null;
        return function() {
            if (autoGrowRafId) {
                cancelAnimationFrame(autoGrowRafId);
            }
            autoGrowRafId = requestAnimationFrame(function() {
                autoGrow(textbox);
                enforceScrollLimit(textbox);
                autoGrowRafId = null;
            });
        };
    }
    
    // Setup auto-grow for welcome textbox
    function setupAutoGrowWelcomeTextarea() {
        // Try multiple selectors to find the welcome textbox
        welcomeTextbox = document.querySelector('#input-wrapper-welcome textarea') ||
                        document.querySelector('#input-wrapper-welcome .input-box textarea') ||
                        document.querySelector('#input-wrapper-welcome textarea.input-box') ||
                        document.querySelector('#input-wrapper-welcome .input-box')?.querySelector('textarea');
        
        if (!welcomeTextbox) {
            // Retry if not found yet
            if (!welcomeInitialized) {
                setTimeout(setupAutoGrowWelcomeTextarea, 500);
            }
            return;
        }
        
        // Prevent multiple initializations
        if (welcomeTextbox.hasAttribute('data-auto-grow-initialized')) {
            return;
        }
        welcomeTextbox.setAttribute('data-auto-grow-initialized', 'true');
        
        console.log('🔍 Found welcome textbox:', welcomeTextbox);
        
        // Set initial styles with !important using setProperty
        const minHeight = minTextHeight + buttonRowPadding - 50; // 90px (60px text + 30px button area)
        const maxHeight = maxTextHeight + buttonRowPadding - 30; // 230px (180px text + 50px button area)
        welcomeTextbox.style.setProperty('min-height', minHeight + 'px', 'important');
        welcomeTextbox.style.setProperty('max-height', maxHeight + 'px', 'important');
        welcomeTextbox.style.setProperty('height', minHeight + 'px', 'important');
        welcomeTextbox.style.setProperty('resize', 'none', 'important');
        welcomeTextbox.style.setProperty('overflow-y', 'auto', 'important');
        welcomeTextbox.style.setProperty('overflow-x', 'hidden', 'important');
        welcomeTextbox.style.setProperty('line-height', rowHeight + 'px', 'important');
        
        const debouncedAutoGrow = createDebouncedAutoGrow(welcomeTextbox);
        
        // Prevent scrolling into button area on scroll event
        welcomeTextbox.addEventListener('scroll', function(e) {
            enforceScrollLimit(welcomeTextbox);
        }, true);
        
        // Prevent wheel scrolling into button area
        welcomeTextbox.addEventListener('wheel', function(e) {
            const computedStyle = window.getComputedStyle(welcomeTextbox);
            const paddingBottom = parseInt(computedStyle.paddingBottom, 10) || 80;
            const scrollHeight = welcomeTextbox.scrollHeight;
            const clientHeight = welcomeTextbox.clientHeight;
            
            if (scrollHeight <= clientHeight) {
                return;
            }
            
            const visibleTextArea = clientHeight - paddingBottom;
            const scrollableTextHeight = scrollHeight - paddingBottom;
            const maxScrollTop = Math.max(0, scrollableTextHeight - visibleTextArea);
            const currentScroll = welcomeTextbox.scrollTop;
            // proposedScroll - where the scrollTop would be if we let the browser handle it naturally
            const proposedScroll = currentScroll + e.deltaY; // e.deltaY - how much the user wants to scroll this event
            
            if (proposedScroll > maxScrollTop) {
                e.preventDefault();
                e.stopPropagation();
                welcomeTextbox.scrollTop = maxScrollTop;
                return false;
            } else if (proposedScroll < 0) {
                e.preventDefault();
                e.stopPropagation();
                welcomeTextbox.scrollTop = 0;
                return false;
            }
        }, { passive: false }); // Allow calling e.preventDefault() to stop the browser’s default scrolling behavior
        
        // Prevent keyboard scrolling into button area
        welcomeTextbox.addEventListener('keydown', function(e) {
            const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'End'];
            if (scrollKeys.includes(e.key)) {
                setTimeout(() => enforceScrollLimit(welcomeTextbox), 0);
            }
        });
        
        // Add event listeners for auto-grow
        welcomeTextbox.addEventListener('input', debouncedAutoGrow);
        // Using setTimeout(..., 10) ensures debouncedAutoGrow runs after the pasted text is actually in the textarea
        welcomeTextbox.addEventListener('paste', function() {
            setTimeout(debouncedAutoGrow, 10);
        });
        
        // Continuously enforce scroll limit
        setInterval(function() {
            if (welcomeTextbox) {
                const scrollHeight = welcomeTextbox.scrollHeight;
                const clientHeight = welcomeTextbox.clientHeight;
                
                if (scrollHeight > clientHeight) {
                    enforceScrollLimit(welcomeTextbox);
                }
            }
        }, 10);
        
        // Call autoGrow initially
        setTimeout(function() {
            autoGrow(welcomeTextbox);
            setTimeout(() => autoGrow(welcomeTextbox), 50);
        }, 0); // Wait until the current JavaScript execution finishes and the browser can update layout
        
        welcomeInitialized = true;
        console.log('✅ Welcome textbox auto-grow initialized', welcomeTextbox);
    }
    
    // Setup auto-grow for chat textbox
    function setupAutoGrowChatTextarea() {
        // Try multiple selectors to find the chat textbox
        chatTextbox = document.querySelector('#input-wrapper-chat textarea') ||
                     document.querySelector('#input-wrapper-chat .input-box textarea') ||
                     document.querySelector('#input-wrapper-chat textarea.input-box') ||
                     document.querySelector('#input-wrapper-chat .input-box')?.querySelector('textarea');
        
        if (!chatTextbox) {
            // Retry if not found yet
            if (!chatInitialized) {
                setTimeout(setupAutoGrowChatTextarea, 500);
            }
            return;
        }
        
        // Prevent multiple initializations
        if (chatTextbox.hasAttribute('data-auto-grow-initialized-chat')) {
            return;
        }
        chatTextbox.setAttribute('data-auto-grow-initialized-chat', 'true');
        
        console.log('🔍 Found chat textbox:', chatTextbox);
        
        // Set initial styles with !important using setProperty
        const minHeight = minTextHeight + buttonRowPadding - 50; // 90px (60px text + 30px button area)
        const maxHeight = maxTextHeight + buttonRowPadding - 30; // 230px (180px text + 50px button area)
        chatTextbox.style.setProperty('min-height', minHeight + 'px', 'important');
        chatTextbox.style.setProperty('max-height', maxHeight + 'px', 'important');
        chatTextbox.style.setProperty('height', minHeight + 'px', 'important');
        chatTextbox.style.setProperty('resize', 'none', 'important');
        chatTextbox.style.setProperty('overflow-y', 'auto', 'important');
        chatTextbox.style.setProperty('overflow-x', 'hidden', 'important');
        chatTextbox.style.setProperty('line-height', rowHeight + 'px', 'important');
        
        const debouncedAutoGrow = createDebouncedAutoGrow(chatTextbox);
        
        // Prevent scrolling into button area on scroll event
        chatTextbox.addEventListener('scroll', function(e) {
            enforceScrollLimit(chatTextbox);
        }, true);
        
        // Prevent wheel scrolling into button area
        chatTextbox.addEventListener('wheel', function(e) {
            const computedStyle = window.getComputedStyle(chatTextbox);
            const paddingBottom = parseInt(computedStyle.paddingBottom, 10) || 80;
            const scrollHeight = chatTextbox.scrollHeight;
            const clientHeight = chatTextbox.clientHeight;
            
            if (scrollHeight <= clientHeight) {
                return;
            }
            
            const visibleTextArea = clientHeight - paddingBottom;
            const scrollableTextHeight = scrollHeight - paddingBottom;
            const maxScrollTop = Math.max(0, scrollableTextHeight - visibleTextArea);
            const currentScroll = chatTextbox.scrollTop;
            const proposedScroll = currentScroll + e.deltaY;
            
            if (proposedScroll > maxScrollTop) {
                e.preventDefault();
                e.stopPropagation();
                chatTextbox.scrollTop = maxScrollTop;
                return false;
            } else if (proposedScroll < 0) {
                e.preventDefault();
                e.stopPropagation();
                chatTextbox.scrollTop = 0;
                return false;
            }
        }, { passive: false });
        
        // Prevent keyboard scrolling into button area
        chatTextbox.addEventListener('keydown', function(e) {
            const scrollKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'End'];
            if (scrollKeys.includes(e.key)) {
                setTimeout(() => enforceScrollLimit(chatTextbox), 0);
            }
        });
        
        // Add event listeners for auto-grow
        chatTextbox.addEventListener('input', debouncedAutoGrow);
        chatTextbox.addEventListener('paste', function() {
            setTimeout(debouncedAutoGrow, 10);
        });
        
        // Continuously enforce scroll limit
        setInterval(function() {
            if (chatTextbox) {
                const scrollHeight = chatTextbox.scrollHeight;
                const clientHeight = chatTextbox.clientHeight;
                
                if (scrollHeight > clientHeight) {
                    enforceScrollLimit(chatTextbox);
                }
            }
        }, 10);
        
        // Call autoGrow initially
        setTimeout(function() {
            autoGrow(chatTextbox);
            setTimeout(() => autoGrow(chatTextbox), 50);
        }, 0);
        
        chatInitialized = true;
        console.log('✅ Chat textbox auto-grow initialized', chatTextbox);
    }
    
    // Initialize both textboxes
    function initializeAll() {
        setupAutoGrowWelcomeTextarea();
        setupAutoGrowChatTextarea();
    }
    
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(initializeAll, 1000);
        });
    } else {
        setTimeout(initializeAll, 1000);
    }
    
    // Watch for dynamic changes (Gradio might recreate elements)
    const observer = new MutationObserver(() => {
        if (!welcomeInitialized || !welcomeTextbox) {
            setupAutoGrowWelcomeTextarea();
        }
        if (!chatInitialized || !chatTextbox) {
            setupAutoGrowChatTextarea();
        }
    });
    
    if (document.body) {
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
})();