// YouTube Shorts AutoScroll Script
let isAutoScrollEnabled = false;
let currentVideo = null;
let scrollCheckInterval = null;
let videoProgressInterval = null;
let isScrollingInProgress = false; // Flag to prevent double scrolling
let lastScrollTime = 0; // Track when last scroll happened
let currentVideoSrc = null; // Track current video to detect changes
let isVideoPaused = false; // Track video pause state
let pauseEventListeners = []; // Store event listeners for cleanup

// Debug mode flag - set to true for verbose logging
const DEBUG_MODE = true;

// Enhanced logging function
function debugLog(message, ...args) {
    if (DEBUG_MODE) {
        console.log(`AutoScroll DEBUG: ${message}`, ...args);
    }
}

// Function to get current extension state
function getCurrentState() {
    return {
        isAutoScrollEnabled,
        isScrollingInProgress,
        currentVideoSrc,
        isVideoPaused,
        hasVideoProgressInterval: !!videoProgressInterval,
        hasScrollCheckInterval: !!scrollCheckInterval,
        pauseListenersCount: pauseEventListeners.length,
        lastScrollTime,
        url: window.location.href,
        isYouTubeShorts: isYouTubeShorts()
    };
}

// Function to print current state (for debugging)
function printCurrentState() {
    const state = getCurrentState();
    console.log('AutoScroll Current State:', state);
    return state;
}

// Make debug functions available globally for testing
window.autoScrollDebug = {
    getCurrentState,
    printCurrentState,
    forceStop: () => stopAutoScroll(),
    isEnabled: () => isAutoScrollEnabled
};

// Function to detect if we're on YouTube Shorts
function isYouTubeShorts() {
    return window.location.pathname.includes('/shorts/');
}

// Function to get the current video element
function getCurrentVideo() {
    // Try multiple selectors to find the video element
    const selectors = [
        'video[src*="blob:"]',
        'video',
        '#movie_player video',
        '.html5-video-player video',
        'ytd-shorts video'
    ];
    
    for (const selector of selectors) {
        const video = document.querySelector(selector);
        if (video && video.duration) {
            return video;
        }
    }
    
    // If no video found with duration, return the first video element
    return document.querySelector('video');
}

// Function to get video duration and current time
function getVideoInfo(video) {
    if (!video) return null;
    
    return {
        duration: video.duration,
        currentTime: video.currentTime,
        ended: video.ended,
        paused: video.paused // Add paused state
    };
}

// Function to add pause/play event listeners to video
function addVideoEventListeners(video) {
    if (!video) return;
    
    // Remove existing listeners first
    removeVideoEventListeners();
    
    const onPause = () => {
        isVideoPaused = true;
        console.log('AutoScroll: Video paused - stopping position detection to save resources');
        
        // Stop monitoring when paused
        if (videoProgressInterval) {
            clearInterval(videoProgressInterval);
            videoProgressInterval = null;
        }
    };
    
    const onPlay = () => {
        isVideoPaused = false;
        console.log('AutoScroll: Video resumed - checking if monitoring should restart');
        
        // CRITICAL: Only restart monitoring if extension is still enabled
        if (!isAutoScrollEnabled) {
            console.log('AutoScroll: Extension disabled, not restarting monitoring');
            return;
        }
        
        console.log('AutoScroll: Extension enabled, restarting position detection');
        
        // Resume monitoring when playing (only if autoscroll is enabled and not scrolling)
        if (isAutoScrollEnabled && !isScrollingInProgress && !videoProgressInterval) {
            videoProgressInterval = setInterval(monitorVideoProgress, 500);
        }
    };
    
    const onEnded = () => {
        console.log('AutoScroll: Video ended event detected');
        isVideoPaused = false;
    };
    
    // Add event listeners
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    video.addEventListener('ended', onEnded);
    
    // Store listeners for cleanup
    pauseEventListeners = [
        { element: video, event: 'pause', handler: onPause },
        { element: video, event: 'play', handler: onPlay },
        { element: video, event: 'ended', handler: onEnded }
    ];
    
    // Set initial pause state
    isVideoPaused = video.paused;
    console.log(`AutoScroll: Added event listeners to video (initially ${video.paused ? 'paused' : 'playing'})`);
}

// Function to remove video event listeners
function removeVideoEventListeners() {
    console.log(`AutoScroll: Removing ${pauseEventListeners.length} video event listeners`);
    pauseEventListeners.forEach(({ element, event, handler }) => {
        try {
            element.removeEventListener(event, handler);
            console.log(`AutoScroll: ✓ Removed ${event} listener`);
        } catch (error) {
            console.log(`AutoScroll: ⚠️ Failed to remove ${event} listener:`, error.message);
        }
    });
    pauseEventListeners = [];
    console.log('AutoScroll: ✓ All video event listeners cleared');
}
function scrollToNextShorts() {
    console.log('AutoScroll: Attempting to scroll to next video...');
    
    // Method 1: Try using keyboard shortcut (most reliable for Shorts)
    const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true
    });
    
    // Focus on the shorts container first
    const shortsContainer = document.querySelector('#shorts-container') ||
                           document.querySelector('#player') ||
                           document.querySelector('ytd-shorts') ||
                           document.body;
    
    shortsContainer.focus();
    document.dispatchEvent(event);
    console.log('AutoScroll: Arrow down key dispatched');
    
    // Method 2: Try clicking next button as fallback
    setTimeout(() => {
        const nextButton = document.querySelector('button[aria-label*="next" i]') || 
                          document.querySelector('button[aria-label*="Next" i]') ||
                          document.querySelector('button[title*="next" i]') ||
                          document.querySelector('[aria-label*="Go to next" i]');
        
        if (nextButton && !nextButton.disabled) {
            console.log('AutoScroll: Clicking next button as fallback');
            nextButton.click();
        }
    }, 500);
    
    return true;
}

// Function to monitor video progress
function monitorVideoProgress() {
    // CRITICAL: Check if extension is disabled first
    if (!isAutoScrollEnabled) {
        console.log('AutoScroll: Extension disabled, stopping monitoring');
        return;
    }

    // TRIAL CHECK: Periodically verify feature access (every 30 calls ≈ 15 seconds)
    if (Math.random() < 0.033) { // ~3.3% chance each call
        checkFeatureAccess().then(canUse => {
            if (!canUse) {
                console.log('AutoScroll: Trial expired during usage - stopping autoscroll');
                stopAutoScroll();
                return;
            }
        }).catch(error => {
            console.error('AutoScroll: Trial check failed during monitoring:', error);
        });
    }

    const video = getCurrentVideo();
    
    if (!video) {
        console.log('AutoScroll: No video found');
        return;
    }
    
    // Check if video has changed (new video loaded)
    if (currentVideoSrc && video.src !== currentVideoSrc) {
        console.log('AutoScroll: New video detected, resetting scroll state');
        isScrollingInProgress = false;
        currentVideoSrc = video.src;
        
        // ONLY add event listeners if extension is still enabled
        if (isAutoScrollEnabled) {
            addVideoEventListeners(video);
        }
    } else if (!currentVideoSrc && isAutoScrollEnabled) {
        currentVideoSrc = video.src;
        addVideoEventListeners(video);
    }
    
    // Prevent monitoring if scrolling is already in progress
    if (isScrollingInProgress) {
        console.log('AutoScroll: Scroll in progress, skipping monitoring');
        return;
    }
    
    // Skip monitoring if video is paused to save resources
    if (isVideoPaused) {
        console.log('AutoScroll: Video is paused, skipping position detection (resource optimization)');
        return;
    }
    
    const videoInfo = getVideoInfo(video);
    
    if (!videoInfo || !videoInfo.duration) {
        console.log('AutoScroll: Video info not available');
        return;
    }
    
    // Update pause state from video info
    if (videoInfo.paused !== isVideoPaused) {
        isVideoPaused = videoInfo.paused;
        console.log(`AutoScroll: Video pause state changed to: ${isVideoPaused ? 'paused' : 'playing'}`);
        
        if (isVideoPaused) {
            console.log('AutoScroll: Video paused detected, resource optimization active');
            return; // Skip this monitoring cycle
        }
    }
    
    // Check if video has ended or is very close to ending (within 0.5 seconds)
    const timeRemaining = videoInfo.duration - videoInfo.currentTime;
    const isNearEnd = timeRemaining <= 0.5;
    const hasEnded = videoInfo.ended || videoInfo.currentTime >= videoInfo.duration;
    
    console.log(`AutoScroll: Duration: ${videoInfo.duration.toFixed(1)}s, Current: ${videoInfo.currentTime.toFixed(1)}s, Remaining: ${timeRemaining.toFixed(1)}s, Paused: ${videoInfo.paused}`);
    
    if (hasEnded || isNearEnd) {
        // Check if we recently scrolled (prevent multiple scrolls within 5 seconds)
        const now = Date.now();
        if (now - lastScrollTime < 5000) {
            console.log('AutoScroll: Recently scrolled, ignoring duplicate trigger');
            return;
        }
        
        console.log('AutoScroll: Video finished, applying 1-second cooldown delay before scrolling...');
        
        // Set scrolling in progress flag
        isScrollingInProgress = true;
        lastScrollTime = now;
        
        // Clear the interval to prevent multiple scrolls
        if (videoProgressInterval) {
            clearInterval(videoProgressInterval);
            videoProgressInterval = null;
        }
        
        // Remove event listeners from current video
        removeVideoEventListeners();
        
        // Apply 1-second cooldown delay before scrolling to next video
        setTimeout(() => {
            console.log('AutoScroll: Cooldown complete, scrolling to next video...');
            scrollToNextShorts();
            
            // Wait a bit more for the new video to load, then restart monitoring
            setTimeout(() => {
                if (isAutoScrollEnabled) {
                    isScrollingInProgress = false; // Reset scrolling flag
                    isVideoPaused = false; // Reset pause state
                    currentVideoSrc = null; // Reset to detect new video
                    startVideoMonitoring();
                }
            }, 2000);
        }, 1000); // 1-second cooldown delay
    }
}

// Function to start monitoring the current video
function startVideoMonitoring() {
    // CRITICAL: Check if extension is still enabled
    if (!isAutoScrollEnabled) {
        console.log('AutoScroll: Extension disabled, cancelling video monitoring startup');
        return;
    }

    // Clear any existing interval
    if (videoProgressInterval) {
        clearInterval(videoProgressInterval);
        videoProgressInterval = null;
    }
    
    // Don't start monitoring if scrolling is in progress
    if (isScrollingInProgress) {
        console.log('AutoScroll: Scroll in progress, delaying video monitoring...');
        setTimeout(() => {
            if (isAutoScrollEnabled && !isScrollingInProgress) {
                startVideoMonitoring();
            }
        }, 1000);
        return;
    }
    
    console.log('AutoScroll: Starting video monitoring...');
    
    // Wait for video to be ready
    let attempts = 0;
    const maxAttempts = 10;
    
    const checkVideoReady = () => {
        // Double-check extension is still enabled
        if (!isAutoScrollEnabled) {
            console.log('AutoScroll: Extension disabled during video check, aborting monitoring');
            return;
        }

        attempts++;
        const video = getCurrentVideo();
        
        console.log(`AutoScroll: Attempt ${attempts} - Video found:`, !!video);
        
        if (video) {
            console.log(`AutoScroll: Video duration: ${video.duration}, currentTime: ${video.currentTime}`);
            // Update current video source
            currentVideoSrc = video.src;
        }
        
        if (video && video.duration && !isNaN(video.duration) && video.duration > 0) {
            console.log(`AutoScroll: Started monitoring video with duration: ${video.duration.toFixed(1)}s`);
            
            // Add pause/play event listeners to the video (only if still enabled)
            if (isAutoScrollEnabled) {
                addVideoEventListeners(video);
            }
            
            // Only start monitoring interval if video is not paused and extension is enabled
            if (!video.paused && isAutoScrollEnabled) {
                videoProgressInterval = setInterval(monitorVideoProgress, 500);
                console.log('AutoScroll: Video is playing, monitoring started');
            } else if (video.paused) {
                console.log('AutoScroll: Video is paused, monitoring will start when video plays');
            } else {
                console.log('AutoScroll: Extension disabled, monitoring cancelled');
            }
            return;
        }
        
        if (attempts < maxAttempts && isAutoScrollEnabled) {
            // Retry after 1 second if video not ready and extension still enabled
            setTimeout(checkVideoReady, 1000);
        } else {
            console.log('AutoScroll: Could not find video with valid duration after maximum attempts or extension disabled');
        }
    };
    
    checkVideoReady();
}

// Function to check if user can use autoscroll feature
async function checkFeatureAccess() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'checkFeatureAccess' });
        
        if (!response.success) {
            console.log('AutoScroll: Feature access check failed:', response.error);
            return false;
        }
        
        if (!response.canUse) {
            console.log('AutoScroll: Feature access denied - trial expired or subscription inactive');
            
            // Show trial expired message
            showTrialExpiredNotification();
            return false;
        }
        
        console.log('AutoScroll: Feature access granted');
        return true;
        
    } catch (error) {
        console.error('AutoScroll: Error checking feature access:', error);
        return false; // Deny access on error
    }
}

// Function to show trial expired notification
function showTrialExpiredNotification() {
    try {
        // Create a notification overlay on the page
        const overlay = document.createElement('div');
        overlay.id = 'autoscroll-trial-expired';
        overlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ff4444, #cc0000);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: Arial, sans-serif;
            font-size: 14px;
            max-width: 300px;
            cursor: pointer;
            animation: slideIn 0.3s ease-out;
        `;
        
        overlay.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 8px;">🕐 AutoScroll Trial Expired</div>
            <div style="font-size: 12px; opacity: 0.9;">Your 10-day free trial has ended. Subscribe to continue using AutoScroll features.</div>
            <div style="text-align: center; margin-top: 10px; font-size: 11px; opacity: 0.8;">Click to dismiss</div>
        `;
        
        // Add CSS animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        
        // Remove on click
        overlay.addEventListener('click', () => {
            overlay.remove();
            style.remove();
        });
        
        // Auto remove after 10 seconds
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.remove();
                style.remove();
            }
        }, 10000);
        
        document.body.appendChild(overlay);
        
        console.log('AutoScroll: Trial expired notification shown');
        
    } catch (error) {
        console.error('AutoScroll: Error showing trial notification:', error);
    }
}

// Function to start autoscroll
function startAutoScroll() {
    if (!isYouTubeShorts()) {
        console.log('AutoScroll: Not on YouTube Shorts page');
        return;
    }
    
    // Check feature access before starting (trial/subscription check)
    checkFeatureAccess().then(canUse => {
        if (!canUse) {
            console.log('AutoScroll: Access denied - cannot start autoscroll');
            return;
        }
        
        // Force stop any existing processes first
        if (isAutoScrollEnabled) {
            console.log('AutoScroll: Stopping existing instance before starting new one');
            stopAutoScroll();
            // Wait a moment for cleanup to complete
            setTimeout(() => {
                continueStartAutoScroll();
            }, 500);
        } else {
            continueStartAutoScroll();
        }
    }).catch(error => {
        console.error('AutoScroll: Feature access check failed:', error);
        showTrialExpiredNotification();
    });
}

function continueStartAutoScroll() {
    isAutoScrollEnabled = true;
    console.log('AutoScroll: Started for YouTube Shorts');
    
    // Update storage immediately
    chrome.storage.local.set({
        autoScrollActive: true,
        selectedPlatform: 'youtube'
    });
    
    // Start monitoring the current video
    startVideoMonitoring();
    
    // Create and store mutation observer for cleanup
    const observer = new MutationObserver(() => {
        if (isAutoScrollEnabled && isYouTubeShorts()) {
            // Restart monitoring when page content changes
            setTimeout(() => {
                if (isAutoScrollEnabled) {
                    startVideoMonitoring();
                }
            }, 1000);
        }
    });
    
    // Store observer globally for cleanup
    window.autoScrollObserver = observer;
    
    // Observe changes in the main content area
    const targetNode = document.querySelector('#content') || document.body;
    observer.observe(targetNode, {
        childList: true,
        subtree: true
    });
    
    console.log('AutoScroll: ✓ Started with mutation observer');
}

// Function to stop autoscroll
function stopAutoScroll() {
    console.log('AutoScroll: Stop function called - FORCING COMPLETE SHUTDOWN');
    
    // FORCE STOP - Set all flags to false immediately
    isAutoScrollEnabled = false;
    isScrollingInProgress = false;
    currentVideoSrc = null;
    isVideoPaused = false;
    lastScrollTime = 0;
    
    // Remove all video event listeners FIRST
    removeVideoEventListeners();
    
    // Clear specific intervals with verification
    if (videoProgressInterval) {
        clearInterval(videoProgressInterval);
        videoProgressInterval = null;
        console.log('AutoScroll: ✓ Cleared video progress interval');
    }
    
    if (scrollCheckInterval) {
        clearInterval(scrollCheckInterval);
        scrollCheckInterval = null;
        console.log('AutoScroll: ✓ Cleared scroll check interval');
    }
    
    // Stop any mutation observers
    if (window.autoScrollObserver) {
        window.autoScrollObserver.disconnect();
        window.autoScrollObserver = null;
        console.log('AutoScroll: ✓ Disconnected mutation observer');
    }
    
    // Also try to remove any event listeners from ALL video elements on the page
    try {
        const allVideos = document.querySelectorAll('video');
        allVideos.forEach((video, index) => {
            // Remove any potential lingering event listeners
            const newVideo = video.cloneNode(true);
            video.parentNode.replaceChild(newVideo, video);
            console.log(`AutoScroll: ✓ Cleaned video element ${index + 1}/${allVideos.length}`);
        });
    } catch (error) {
        console.log('AutoScroll: Video cleanup attempt failed:', error.message);
    }
    
    // Update storage immediately to persist stopped state
    try {
        chrome.storage.local.set({
            autoScrollActive: false,
            lastStopReason: 'manual_stop',
            lastStopTime: Date.now(),
            lastStopPlatform: 'youtube'
        });
        console.log('AutoScroll: ✓ Updated storage with stopped state');
    } catch (error) {
        console.log('AutoScroll: Storage update failed:', error.message);
    }
    
    console.log('AutoScroll: ✓✓✓ COMPLETE SHUTDOWN EXECUTED - All processes stopped');
    
    // Notify background script that autoscroll stopped
    try {
        chrome.runtime.sendMessage({ 
            action: 'autoScrollStopped', 
            platform: 'youtube',
            reason: 'manual_stop'
        });
        console.log('AutoScroll: ✓ Notified background script of manual stop');
    } catch (error) {
        console.log('AutoScroll: Could not notify background script:', error.message);
    }
    
    // Double verification - check if any intervals are still running after 1 second
    setTimeout(() => {
        if (isAutoScrollEnabled) {
            console.error('AutoScroll: WARNING - Extension still enabled after stop! Force stopping again...');
            isAutoScrollEnabled = false;
        }
        
        // Final verification log
        const finalState = getCurrentState();
        console.log('AutoScroll: ✓ Stop verification complete - Final state:', finalState);
        
        if (!finalState.isAutoScrollEnabled) {
            console.log('AutoScroll: ✓✓✓ CONFIRMED - Extension is fully stopped');
        } else {
            console.error('AutoScroll: ❌ ERROR - Extension still showing as enabled!');
        }
    }, 1000);
}

// Listen for messages from popup/background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('AutoScroll: Received message:', request.action);
    
    if (request.action === 'startAutoScroll') {
        console.log('AutoScroll: Starting autoscroll...');
        startAutoScroll();
        sendResponse({ success: true, isActive: isAutoScrollEnabled });
    } else if (request.action === 'stopAutoScroll') {
        console.log('AutoScroll: Stopping autoscroll...');
        stopAutoScroll();
        
        // Wait a moment to ensure stop is complete before responding
        setTimeout(() => {
            const finalState = getCurrentState();
            console.log('AutoScroll: Stop response state:', finalState);
            sendResponse({ 
                success: true, 
                isActive: finalState.isAutoScrollEnabled,
                stopped: true,
                state: finalState
            });
        }, 500);
        
        return true; // Keep message channel open for async response
    } else if (request.action === 'getStatus') {
        const currentState = getCurrentState();
        sendResponse({ 
            isActive: currentState.isAutoScrollEnabled,
            isShorts: currentState.isYouTubeShorts,
            success: true,
            state: currentState
        });
    } else if (request.action === 'forceStop') {
        // Emergency force stop command
        console.log('AutoScroll: EMERGENCY FORCE STOP RECEIVED');
        stopAutoScroll();
        
        setTimeout(() => {
            const finalState = getCurrentState();
            sendResponse({ 
                success: true, 
                isActive: finalState.isAutoScrollEnabled, 
                message: 'Force stopped',
                state: finalState
            });
        }, 500);
        
        return true; // Keep message channel open for async response
    } else {
        console.log('AutoScroll: Unknown action:', request.action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
});

// Auto-start if we're already on shorts page (for development/testing)
if (isYouTubeShorts()) {
    console.log('AutoScroll: YouTube Shorts detected on page load');
    
    // Check storage to see if autoscroll should be running
    chrome.storage.local.get(['autoScrollActive'], (data) => {
        if (data.autoScrollActive) {
            console.log('AutoScroll: Storage indicates autoscroll should be active, but NOT auto-starting for safety');
            console.log('AutoScroll: User must manually start from popup for safety');
        } else {
            console.log('AutoScroll: Storage indicates autoscroll is inactive');
        }
    });
}

// Page visibility and navigation monitoring
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isAutoScrollEnabled) {
        console.log('AutoScroll: YouTube tab hidden, stopping autoscroll');
        stopAutoScrollWithReason('tab_hidden');
    }
});

// Listen for beforeunload to stop autoscroll when user navigates away
window.addEventListener('beforeunload', () => {
    if (isAutoScrollEnabled) {
        console.log('AutoScroll: YouTube page unloading, stopping autoscroll');
        stopAutoScrollWithReason('page_unload');
    }
});

// Function to stop autoscroll with specific reason
function stopAutoScrollWithReason(reason) {
    isAutoScrollEnabled = false;
    isScrollingInProgress = false;
    currentVideoSrc = null;
    isVideoPaused = false;
    
    removeVideoEventListeners();
    
    if (videoProgressInterval) {
        clearInterval(videoProgressInterval);
        videoProgressInterval = null;
    }
    
    if (scrollCheckInterval) {
        clearInterval(scrollCheckInterval);
        scrollCheckInterval = null;
    }
    
    console.log(`AutoScroll: YouTube stopped due to: ${reason}`);
    
    // Notify background script
    try {
        chrome.runtime.sendMessage({ 
            action: 'autoScrollStopped', 
            platform: 'youtube',
            reason: reason
        });
    } catch (error) {
        console.log('AutoScroll: Could not notify background script:', error.message);
    }
}

// Also listen for URL changes using the History API
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        console.log('AutoScroll: URL changed to:', url);
        
        if (isYouTubeShorts() && isAutoScrollEnabled) {
            console.log('AutoScroll: Restarting monitoring for new Shorts page');
            // Reset scroll state for new page
            isScrollingInProgress = false;
            currentVideoSrc = null;
            isVideoPaused = false;
            removeVideoEventListeners(); // Clean up old listeners
            setTimeout(() => {
                if (isAutoScrollEnabled) {
                    startVideoMonitoring();
                }
            }, 2000);
        } else if (!isYouTubeShorts() && isAutoScrollEnabled) {
            console.log('AutoScroll: No longer on YouTube Shorts, stopping autoscroll');
            stopAutoScrollWithReason('left_shorts_page');
        }
    }
}).observe(document, { subtree: true, childList: true });