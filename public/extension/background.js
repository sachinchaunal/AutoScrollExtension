// AutoScroll Background Service Worker (Manifest V3) - Google Auth Version

// Import Google Auth utility
importScripts('utils/googleAuth.js');

// Global state
let googleAuth = new GoogleAuth();
let currentUser = null;
let isExtensionBlocked = false;
let lastAuthCheck = 0;
let isVerificationInProgress = false;
let lastVerificationTime = 0;

// Initialize Google Auth with automatic client ID detection
googleAuth.initialize();

// Handle installation
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        await onFirstInstall();
    } else if (details.reason === 'update') {
        await onExtensionUpdate();
    }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // Keep message channel open for async response
});

// Handle tab updates to inject content scripts
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        await handleTabUpdate(tabId, tab);
    }
});

// Handle alarms (periodic subscription check)
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'checkSubscription') {
        await checkSubscriptionStatus();
    }
    // Removed verifyDevice alarm handler to prevent duplicate user creation
});

// Initialize periodic checks - removed device verification, added auth sync
chrome.alarms.create('syncUserData', {
    delayInMinutes: 1,
    periodInMinutes: 60 // Check every hour
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'syncUserData') {
        await syncUserDataWithBackend();
    }
});

// Google Auth Functions

/**
 * Handle Google login process
 */
async function handleGoogleLogin() {
    try {
        console.log('AutoScroll: Starting Google login process...');
        
        // Perform Google login (now includes backend registration)
        const loginResult = await googleAuth.login();
        
        if (!loginResult.success) {
            throw new Error('Google login failed');
        }
        
        // Check if backend registration was successful
        if (loginResult.backendRegistered) {
            currentUser = loginResult.user;
            
            // Update local storage
            await chrome.storage.local.set({
                isAuthenticated: true,
                backendSynced: true,
                canUseExtension: loginResult.backendData.canUseExtension
            });
            
            console.log('AutoScroll: Login and backend registration successful for user:', loginResult.user.email);
            
            return {
                success: true,
                data: {
                    user: loginResult.user,
                    subscriptionData: loginResult.backendData,
                    message: loginResult.backendData.message || 'Login successful!'
                }
            };
        } else {
            // Google auth succeeded but backend registration failed
            // Try to register again
            try {
                console.log('AutoScroll: Retrying backend registration...');
                const backendResult = await googleAuth.ensureBackendRegistration();
                
                if (backendResult.success) {
                    currentUser = loginResult.user;
                    
                    await chrome.storage.local.set({
                        isAuthenticated: true,
                        backendSynced: true,
                        canUseExtension: backendResult.backendData ? backendResult.backendData.canUseExtension : true
                    });
                    
                    return {
                        success: true,
                        data: {
                            user: loginResult.user,
                            subscriptionData: backendResult.backendData || {},
                            message: 'Login successful!'
                        }
                    };
                } else {
                    throw new Error('Backend registration retry failed');
                }
                
            } catch (retryError) {
                console.warn('AutoScroll: Backend registration retry failed, proceeding with Google auth only:', retryError);
                
                // Proceed with Google-only authentication
                currentUser = loginResult.user;
                
                await chrome.storage.local.set({
                    isAuthenticated: true,
                    backendSynced: false,
                    canUseExtension: true, // Allow extension use even without backend
                    backendUserId: 'unknown' // Mark as unknown for later retry
                });
                
                return {
                    success: true,
                    data: {
                        user: loginResult.user,
                        subscriptionData: { canUseExtension: true, subscriptionStatus: 'trial' },
                        message: 'Login successful! (Some features may be limited)'
                    }
                };
            }
        }
        
    } catch (error) {
        console.error('AutoScroll: Login error:', error);
        return {
            success: false,
            error: error.message,
            message: 'Login failed. Please try again.'
        };
    }
}

/**
 * Retry backend registration for users who have Google auth but no backend connection
 */
async function retryBackendRegistration() {
    try {
        console.log('AutoScroll: Retrying backend registration...');
        
        const authData = await chrome.storage.local.get(['authData', 'backendUserId']);
        
        if (!authData.authData || !authData.authData.user) {
            throw new Error('No Google authentication found');
        }
        
        if (authData.backendUserId && authData.backendUserId !== 'unknown') {
            console.log('AutoScroll: User already registered with backend');
            return {
                success: true,
                message: 'Already registered with backend'
            };
        }
        
        const backendResult = await googleAuth.ensureBackendRegistration();
        
        if (backendResult.success) {
            await chrome.storage.local.set({
                backendSynced: true,
                canUseExtension: backendResult.backendData ? backendResult.backendData.canUseExtension : true
            });
            
            return {
                success: true,
                data: backendResult.backendData,
                message: 'Backend registration successful'
            };
        } else {
            throw new Error('Backend registration failed');
        }
        
    } catch (error) {
        console.error('AutoScroll: Backend registration retry error:', error);
        return {
            success: false,
            error: error.message,
            message: 'Backend registration failed. Extension will work with limited features.'
        };
    }
}

/**
 * Handle logout process
 */
async function handleLogout() {
    try {
        console.log('AutoScroll: Starting logout process...');
        
        // Logout from Google Auth
        await googleAuth.logout();
        
        // Clear current user
        currentUser = null;
        
        // Update local storage
        await chrome.storage.local.set({
            isAuthenticated: false,
            backendSynced: false,
            canUseExtension: false,
            autoScrollActive: false // Stop any active scrolling
        });
        
        // Stop any active autoscroll
        await performEmergencyStop();
        
        console.log('AutoScroll: Logout successful');
        
        return {
            success: true,
            message: 'Logged out successfully'
        };
        
    } catch (error) {
        console.error('AutoScroll: Logout error:', error);
        return {
            success: false,
            error: error.message,
            message: 'Logout failed'
        };
    }
}

/**
 * Sync user data with backend
 */
async function syncUserDataWithBackend() {
    try {
        // Check if user is logged in
        const authStatus = await googleAuth.checkLoginStatus();
        
        if (!authStatus.isLoggedIn) {
            console.log('AutoScroll: User not logged in, skipping sync');
            return { success: false, message: 'User not logged in' };
        }
        
        const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
        
        if (!userData.backendUserId || !userData.authData) {
            console.log('AutoScroll: Missing backend data, re-registering...');
            return await googleAuth.registerWithBackend(authStatus.user);
        }
        
        // Try to get updated user profile from backend
        const API_BASE = 'https://autoscrollextension.onrender.com';
        
        try {
            const response = await fetch(`${API_BASE}/api/auth/profile/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                
                if (result.success) {
                    // Update local storage with fresh data
                    await chrome.storage.local.set({
                        subscriptionStatus: result.data.subscriptionStatus,
                        trialDaysRemaining: result.data.trialDaysRemaining,
                        canUseExtension: result.data.canUseExtension,
                        lastBackendSync: Date.now()
                    });
                    
                    console.log('AutoScroll: User data synced successfully');
                    return { 
                        success: true, 
                        data: result.data,
                        message: 'User data synced'
                    };
                }
            }
            
            throw new Error(`Profile sync failed: ${response.status}`);
            
        } catch (error) {
            console.log(`AutoScroll: Sync failed for ${API_BASE}:`, error.message);
            return { success: false, message: 'Backend sync failed', error: error.message };
        }
        
    } catch (error) {
        console.error('AutoScroll: Sync error:', error);
        return { success: false, error: error.message };
    }
}

async function onFirstInstall() {
    try {
        console.log('AutoScroll: First install detected - Google Auth version');
        
        // Initialize default settings
        const defaultSettings = {
            autoScrollActive: false,
            selectedPlatform: 'youtube',
            extensionVersion: chrome.runtime.getManifest().version,
            firstInstallDate: new Date().getTime(),
            isAuthenticated: false,
            requiresLogin: true
        };

        await chrome.storage.local.set(defaultSettings);
        
        // Show welcome notification
        showNotification(
            'AutoScroll Installed!',
            'Welcome! Please log in with your Google account to start your 10-day free trial.',
            'icons/icon48.png'
        );
        
        console.log('AutoScroll: Installation completed - user needs to log in');
    } catch (error) {
        console.error('AutoScroll Installation error:', error);
        
        // Store error information for debugging
        await chrome.storage.local.set({
            lastInstallError: error.message,
            lastInstallErrorTime: Date.now()
        });
    }
}

async function onExtensionUpdate() {
    try {
        console.log('AutoScroll: Extension update detected');
        
        // Check if user is logged in and sync with backend
        const authStatus = await googleAuth.checkLoginStatus();
        if (authStatus.isLoggedIn) {
            await syncUserDataWithBackend();
        }
        
    } catch (error) {
        console.error('AutoScroll Update error:', error);
    }
}

async function verifyUserAccess() {
    try {
        // Prevent concurrent verification calls
        if (isVerificationInProgress) {
            console.log('AutoScroll: Verification already in progress, skipping...');
            return;
        }
        
        // Skip if recently verified (within 30 minutes)
        const now = Date.now();
        if (now - lastVerificationTime < 30 * 60 * 1000) {
            console.log('AutoScroll: Skipping verification - recently verified');
            return;
        }
        
        isVerificationInProgress = true;
        console.log('AutoScroll: Verifying user access');
        
        const result = await syncUserDataWithBackend();
        
        if (result.success) {
            lastVerificationTime = now;
            isExtensionBlocked = !result.data.canUseExtension;
            
            console.log('AutoScroll: User verification successful', {
                canUse: result.data.canUseExtension,
                status: result.data.subscriptionStatus
            });
            
            if (result.data.warning) {
                showNotification(
                    'AutoScroll Notice',
                    result.data.warning,
                    'icons/icon48.png'
                );
            }
        } else {
            console.log('AutoScroll: User verification failed:', result.message);
        }
        
    } catch (error) {
        console.error('AutoScroll: User verification error:', error);
    } finally {
        isVerificationInProgress = false;
    }
}

// Legacy device info function - kept for backward compatibility
async function gatherDeviceInfo() {
    try {
        return {
            browser: 'Chrome',
            os: navigator.platform,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
    } catch (error) {
        console.error('Error gathering device info:', error);
        return {
            browser: 'Unknown',
            os: 'Unknown',
            language: 'unknown',
            timezone: 'unknown'
        };
    }
}

// Legacy browser detection function
function getBrowserInfo() {
    const ua = navigator.userAgent;
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return 'Unknown';
}

async function handleMessage(message, sender, sendResponse) {
    try {
        console.log('AutoScroll: Received message:', message.action);
        
        // Check authentication for most actions (except login/auth related)
        const authRequiredActions = [
            'startAutoScroll', 'stopAutoScroll', 'getStatus', 
            'getSubscriptionStatus', 'logScrollEvent', 'checkFeatureAccess', 'forceRefreshStatus'
        ];
        
        if (authRequiredActions.includes(message.action)) {
            const authStatus = await googleAuth.checkLoginStatus();
            if (!authStatus.isLoggedIn) {
                sendResponse({ 
                    success: false, 
                    error: 'Authentication required',
                    requiresLogin: true
                });
                return;
            }
            currentUser = authStatus.user;
        }
        
        switch (message.action) {
            case 'googleLogin':
                const loginResult = await handleGoogleLogin();
                sendResponse(loginResult);
                break;

            case 'retryBackendRegistration':
                const retryResult = await retryBackendRegistration();
                sendResponse(retryResult);
                break;

            case 'logout':
                const logoutResult = await handleLogout();
                sendResponse(logoutResult);
                break;

            case 'getAuthStatus':
                try {
                    // Use the new checkAuthStatus method for better session management
                    const authData = await googleAuth.checkAuthStatus();
                    
                    if (authData && authData.isAuthenticated) {
                        sendResponse({ 
                            success: true, 
                            data: {
                                isLoggedIn: true,
                                user: {
                                    email: authData.email,
                                    name: authData.name,
                                    picture: authData.picture
                                }
                            }
                        });
                    } else {
                        // Fallback to old method if needed
                        const authStatus = await googleAuth.checkLoginStatus();
                        sendResponse({ 
                            success: true, 
                            data: {
                                isLoggedIn: authStatus.isLoggedIn,
                                user: authStatus.user
                            }
                        });
                    }
                } catch (error) {
                    console.error('AutoScroll: getAuthStatus error:', error);
                    sendResponse({ 
                        success: false, 
                        data: {
                            isLoggedIn: false,
                            user: null
                        }
                    });
                }
                break;

            case 'getSubscriptionStatus':
                const status = await getSubscriptionStatus();
                sendResponse({ success: true, data: status });
                break;
            
            case 'forceRefreshStatus':
                const refreshResult = await forceRefreshSubscriptionStatus();
                sendResponse({ success: true, data: refreshResult });
                break;

            case 'logScrollEvent':
                await logScrollEvent(message.data);
                sendResponse({ success: true });
                break;

            case 'checkFeatureAccess':
                const canUse = await canUseFeature();
                sendResponse({ success: true, canUse });
                break;

            case 'autoScrollStopped':
                await handleAutoScrollStopped(message.platform, message.reason);
                sendResponse({ success: true });
                break;

            case 'reportError':
                console.error('AutoScroll Content script error:', message.error);
                sendResponse({ success: true });
                break;

            case 'emergencyStop':
                await performEmergencyStop();
                sendResponse({ success: true, message: 'Emergency stop executed' });
                break;

            case 'forceStopAllTabs':
                await forceStopAllTabs();
                sendResponse({ success: true, message: 'Force stopped all tabs' });
                break;

            case 'syncUserData':
                const syncResult = await syncUserDataWithBackend();
                sendResponse(syncResult);
                break;

            default:
                console.warn('AutoScroll: Unknown action:', message.action);
                sendResponse({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('AutoScroll Background script error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

async function performEmergencyStop() {
    try {
        console.log('AutoScroll: Performing emergency stop on all tabs');
        
        // Update storage immediately
        await chrome.storage.local.set({
            autoScrollActive: false,
            lastStopReason: 'emergency_stop',
            lastStopTime: Date.now()
        });
        
        // Get all tabs and send stop message
        const tabs = await chrome.tabs.query({});
        const supportedUrls = ['youtube.com'];
        
        for (const tab of tabs) {
            if (tab.url && supportedUrls.some(url => tab.url.includes(url))) {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'forceStop'
                    });
                    console.log(`AutoScroll: Sent emergency stop to tab ${tab.id}`);
                } catch (error) {
                    // Tab might not have content script, ignore
                    console.log(`AutoScroll: Could not send stop to tab ${tab.id}:`, error.message);
                }
            }
        }
        
        console.log('AutoScroll: Emergency stop completed');
    } catch (error) {
        console.error('AutoScroll: Emergency stop failed:', error);
    }
}

async function forceStopAllTabs() {
    try {
        console.log('AutoScroll: Force stopping all tabs');
        
        // Update storage
        await chrome.storage.local.set({
            autoScrollActive: false,
            lastStopReason: 'force_stop_all',
            lastStopTime: Date.now()
        });
        
        // Get all tabs
        const tabs = await chrome.tabs.query({});
        
        for (const tab of tabs) {
            try {
                // Send force stop to all tabs
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'forceStop'
                });
            } catch (error) {
                // Ignore tabs without content script
            }
        }
        
        console.log('AutoScroll: Force stop all tabs completed');
    } catch (error) {
        console.error('AutoScroll: Force stop all tabs failed:', error);
    }
}

async function handleTabUpdate(tabId, tab) {
    // Check if tab is a supported platform
    const supportedPlatforms = [
        { pattern: /youtube\.com.*\/shorts/, platform: 'youtube' }
    ];

    for (const { pattern, platform } of supportedPlatforms) {
        if (pattern.test(tab.url)) {
            console.log(`AutoScroll: Detected ${platform} platform on tab ${tabId}`);
            
            // Verify feature access before allowing use
            const canUse = await canUseFeature();
            
            // Send platform info to content script
            try {
                await chrome.tabs.sendMessage(tabId, {
                    action: 'platformDetected',
                    platform: platform,
                    canUseFeature: canUse
                });
            } catch (error) {
                // Tab might not be ready yet, ignore silently
                console.log(`AutoScroll: Could not send message to tab ${tabId}:`, error.message);
            }
            break;
        }
    }
}

async function getSubscriptionStatus() {
    try {
        // Check if user is logged in
        const authStatus = await googleAuth.checkLoginStatus();
        
        if (!authStatus.isLoggedIn) {
            return {
                subscriptionStatus: 'not_authenticated',
                trialDaysRemaining: 0,
                canUseExtension: false,
                isSubscriptionActive: false,
                requiresLogin: true,
                user: null
            };
        }
        
        const data = await chrome.storage.local.get([
            'subscriptionStatus',
            'trialDaysRemaining',
            'canUseExtension',
            'backendUserId',
            'lastBackendSync'
        ]);

        return {
            subscriptionStatus: data.subscriptionStatus || 'trial',
            trialDaysRemaining: data.trialDaysRemaining || 0,
            userId: data.backendUserId,
            canUseExtension: data.canUseExtension || false,
            isSubscriptionActive: data.canUseExtension || false,
            lastSync: data.lastBackendSync || 0,
            user: authStatus.user,
            isAuthenticated: true
        };
    } catch (error) {
        console.error('AutoScroll: Error getting subscription status:', error);
        return {
            subscriptionStatus: 'error',
            trialDaysRemaining: 0,
            canUseExtension: false,
            isSubscriptionActive: false,
            error: error.message
        };
    }
}

async function forceRefreshSubscriptionStatus() {
    try {
        console.log('AutoScroll: Force refreshing subscription status...');
        
        // Check if user is authenticated
        const authStatus = await googleAuth.checkLoginStatus();
        if (!authStatus.isLoggedIn) {
            return {
                success: false,
                message: 'User not authenticated',
                subscriptionStatus: 'not_authenticated'
            };
        }

        const userProfile = authStatus.profile;
        
        // Force sync with backend and refresh status
        const result = await syncUserDataWithBackend();
        
        if (result.success) {
            // Also call the refresh endpoint to force update
            try {
                const refreshResponse = await fetch(`${API_BASE}/api/upi-mandates/refresh-status`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        userId: result.data.userId
                    })
                });
                
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    console.log('AutoScroll: Force refresh completed:', refreshData.data);
                    
                    // Update local storage with refreshed data
                    await chrome.storage.local.set({
                        subscriptionStatus: refreshData.data.subscriptionStatus,
                        subscriptionExpiry: refreshData.data.subscriptionExpiry,
                        hasAutoRenewal: refreshData.data.hasAutoRenewal,
                        lastRefreshTime: Date.now()
                    });
                    
                    return {
                        success: true,
                        message: refreshData.message,
                        data: refreshData.data
                    };
                }
            } catch (refreshError) {
                console.log('AutoScroll: Refresh endpoint error:', refreshError.message);
                // Continue with basic sync result
            }
            
            return {
                success: true,
                message: 'Basic sync completed',
                data: result.data
            };
        } else {
            return {
                success: false,
                message: result.message || 'Sync failed'
            };
        }
        
    } catch (error) {
        console.error('AutoScroll: Error force refreshing status:', error);
        return {
            success: false,
            message: error.message,
            error: error.message
        };
    }
}

async function canUseFeature() {
    try {
        // Check if user is authenticated
        const authStatus = await googleAuth.checkLoginStatus();
        
        if (!authStatus.isLoggedIn) {
            console.log('AutoScroll: User not authenticated, feature access denied');
            return false;
        }
        
        // Check local storage first
        const localData = await chrome.storage.local.get([
            'canUseExtension', 
            'lastBackendSync',
            'subscriptionStatus',
            'trialDaysRemaining'
        ]);
        
        // If recently synced (within 5 minutes), use local data
        const timeSinceSync = Date.now() - (localData.lastBackendSync || 0);
        if (timeSinceSync < 5 * 60 * 1000 && localData.canUseExtension !== undefined) {
            console.log('AutoScroll: Using cached feature access:', localData.canUseExtension);
            return localData.canUseExtension;
        }
        
        // Sync with backend to get fresh data
        const syncResult = await syncUserDataWithBackend();
        
        if (syncResult.success && syncResult.data) {
            console.log('AutoScroll: Feature access from backend sync:', syncResult.data.canUseExtension);
            return syncResult.data.canUseExtension;
        }
        
        // Fallback to local data if sync fails
        console.log('AutoScroll: Backend sync failed, using local data');
        return localData.canUseExtension || false;
        
    } catch (error) {
        console.error('AutoScroll: Feature access check failed:', error);
        
        // In case of error, check if user is authenticated and has local permission
        const localData = await chrome.storage.local.get(['canUseExtension', 'isAuthenticated']);
        return localData.isAuthenticated && (localData.canUseExtension || false);
    }
}

async function logScrollEvent(data) {
    try {
        console.log('AutoScroll: Logging scroll event for', data.platform);
        
        // Check if user is authenticated
        const authStatus = await googleAuth.checkLoginStatus();
        if (!authStatus.isLoggedIn) {
            console.log('AutoScroll: User not authenticated, skipping usage log');
            return;
        }
        
        const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
        
        if (!userData.backendUserId || !userData.authData) {
            console.log('AutoScroll: Missing user data, skipping usage log');
            return;
        }
        
        // Log to backend
        const API_BASE = 'https://autoscrollextension.onrender.com';
        
        try {
            const response = await fetch(`${API_BASE}/api/analytics/log-usage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                },
                body: JSON.stringify({
                    userId: userData.backendUserId,
                    feature: 'autoscroll',
                    platform: data.platform,
                    metadata: {
                        url: data.url,
                        direction: data.direction || 'down',
                        timestamp: new Date().getTime()
                    }
                })
            });

            if (response.ok) {
                console.log('AutoScroll: Usage logged successfully to backend');
            } else {
                console.log(`AutoScroll: Usage logging failed: ${response.status}`);
            }
            
        } catch (error) {
            console.log(`AutoScroll: Usage logging failed for ${API_BASE}:`, error.message);
        }

        // Also store locally for offline scenarios
        const existingLogs = await chrome.storage.local.get(['scrollLogs']);
        const logs = existingLogs.scrollLogs || [];
        logs.push({
            timestamp: new Date().getTime(),
            platform: data.platform,
            url: data.url,
            direction: data.direction || 'down',
            userId: userData.backendUserId
        });
        
        // Keep only last 50 events
        if (logs.length > 50) {
            logs.splice(0, logs.length - 50);
        }
        
        await chrome.storage.local.set({ scrollLogs: logs });

    } catch (error) {
        console.error('AutoScroll: Error logging scroll event:', error);
    }
}

async function checkSubscriptionStatus() {
    try {
        // Check user access which also checks subscription
        await verifyUserAccess();
        
    } catch (error) {
        console.log('AutoScroll: Subscription check error (non-critical):', error.message);
    }
}

async function handleAutoScrollStopped(platform, reason) {
    try {
        console.log(`AutoScroll: ${platform} autoscroll stopped - reason: ${reason}`);
        
        // Update storage to reflect that autoscroll is no longer active
        await chrome.storage.local.set({
            autoScrollActive: false,
            lastStopReason: reason,
            lastStopTime: new Date().getTime(),
            lastStopPlatform: platform
        });
        
        // Show notification based on reason
        let notificationTitle = 'AutoScroll Stopped';
        let notificationMessage = '';
        
        switch (reason) {
            case 'tab_hidden':
                notificationMessage = `${platform} tab was hidden or minimized`;
                break;
            case 'page_unload':
                notificationMessage = `Left ${platform} page`;
                break;
            case 'left_shorts_page':
                notificationMessage = 'No longer on YouTube Shorts';
                break;
            case 'manual_stop':
                notificationMessage = `Manually stopped on ${platform}`;
                break;
            default:
                notificationMessage = `Stopped on ${platform}`;
        }
        
        // Only show notification for automatic stops (not manual)
        if (reason !== 'manual_stop') {
            showNotification(
                notificationTitle,
                `${notificationMessage}. Click extension icon to restart when you return.`,
                'icons/icon48.png'
            );
        }
        
        console.log(`AutoScroll: Updated storage and showed notification for ${reason}`);
    } catch (error) {
        console.error('AutoScroll: Error handling autoscroll stopped:', error);
    }
}

function showNotification(title, message, iconUrl) {
    try {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: iconUrl,
            title: title,
            message: message
        });
        
        console.log('AutoScroll: Notification shown:', title);
    } catch (error) {
        console.error('AutoScroll: Notification error:', error);
    }
}

// Service worker lifecycle logging
console.log('AutoScroll: Background service worker loaded');

// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
    console.log('AutoScroll: Extension startup detected');
    // Removed automatic device verification on startup to prevent duplicates
});

// Removed automatic device verification when service worker loads

// Export functions for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        canUseFeature,
        getSubscriptionStatus,
        syncUserDataWithBackend,
        forceRefreshSubscriptionStatus
    };
}
