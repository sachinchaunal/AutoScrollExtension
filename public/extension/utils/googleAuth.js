/**
 * Google Authentication Handler for AutoScroll Extension
 * Simplified Universal Web-based OAuth implementation
 */

class GoogleAuth {
    constructor() {
        this.clientId = null; // Will be set from environment or config
        this.redirectUri = 'https://autoscrollextension.onrender.com/auth/callback';
        this.scopes = ['openid', 'email', 'profile'];
        this.isAuthenticating = false;
    }

    /**
     * Check if user is currently authenticated
     * @returns {Promise<Object|null>} User data if authenticated, null if not
     */
    async checkAuthStatus() {
        try {
            const data = await chrome.storage.local.get([
                'authData', 
                'isAuthenticated', 
                'userEmail', 
                'userName', 
                'userPicture'
            ]);

            if (data.isAuthenticated && data.authData && data.authData.token) {
                // Verify token is still valid
                try {
                    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                        headers: {
                            'Authorization': `Bearer ${data.authData.token}`
                        }
                    });

                    if (response.ok) {
                        console.log('GoogleAuth: User is authenticated with valid token');
                        return {
                            email: data.userEmail,
                            name: data.userName,
                            picture: data.userPicture,
                            token: data.authData.token,
                            isAuthenticated: true
                        };
                    } else {
                        console.log('GoogleAuth: Stored token is invalid, clearing auth data');
                        await this.logout();
                        return null;
                    }
                } catch (error) {
                    console.warn('GoogleAuth: Token validation failed:', error);
                    await this.logout();
                    return null;
                }
            }

            console.log('GoogleAuth: User is not authenticated');
            return null;

        } catch (error) {
            console.error('GoogleAuth: Error checking auth status:', error);
            return null;
        }
    }

    /**
     * Initialize Google Auth
     * @param {string} clientId Optional: specify client ID manually
     */
    initialize(clientId = null) {
        if (clientId) {
            this.clientId = clientId;
            console.log('GoogleAuth: Initialized with provided client ID');
        } else {
            // Use Web Application Client ID for universal compatibility
            this.clientId = '635885285423-c84krdm83jhqvmjvqb7g6pncsup4gdc6.apps.googleusercontent.com';
            console.log('GoogleAuth: Initialized with Web Application client ID');
        }
        
        console.log('GoogleAuth: Initialization complete - Universal Web OAuth');
    }

    /**
     * Start Google OAuth login flow using Universal Web-based OAuth
     * @returns {Promise<Object>} User authentication data
     */
    async login() {
        try {
            if (this.isAuthenticating) {
                throw new Error('Authentication already in progress');
            }

            this.isAuthenticating = true;
            console.log('GoogleAuth: Starting Universal Web OAuth login flow...');

            // Use Universal web-based OAuth only
            const token = await this.launchUniversalWebAuth();
            if (!token) {
                throw new Error('Failed to get authentication token');
            }

            // Get user info from Google
            const userInfo = await this.getUserInfo(token);
            
            // Store authentication data
            await this.storeAuthData(userInfo, token);

            console.log('GoogleAuth: Login successful for user:', userInfo.email);
            
            // Register with backend after successful Google authentication
            try {
                console.log('GoogleAuth: Attempting backend registration...');
                const backendResult = await this.registerWithBackend(userInfo);
                console.log('GoogleAuth: Backend registration successful');
                
                return {
                    success: true,
                    user: userInfo,
                    token: token,
                    backendRegistered: true,
                    backendData: backendResult.data
                };
                
            } catch (backendError) {
                console.warn('GoogleAuth: Backend registration failed, but Google auth succeeded:', backendError);
                
                // Return successful Google auth even if backend registration fails
                return {
                    success: true,
                    user: userInfo,
                    token: token,
                    backendRegistered: false,
                    backendError: backendError.message
                };
            }

        } catch (error) {
            console.error('GoogleAuth: Login failed:', error);
            throw error;
        } finally {
            this.isAuthenticating = false;
        }
    }

    /**
     * Detect browser type and capabilities
     * @returns {Object} Browser information
     */
    detectBrowser() {
        try {
            const userAgent = navigator.userAgent;
            const isEdge = userAgent.includes('Edg/') || userAgent.includes('Edge/');
            const isChrome = userAgent.includes('Chrome/') && !isEdge;
            const isFirefox = userAgent.includes('Firefox/');
            const isSafari = userAgent.includes('Safari/') && !isChrome && !isEdge;
            const isOpera = userAgent.includes('OPR/') || userAgent.includes('Opera/');
            
            return {
                isEdge,
                isChrome,
                isFirefox,
                isSafari,
                isOpera,
                userAgent,
                browserName: isChrome ? 'Chrome' : 
                           isEdge ? 'Edge' : 
                           isFirefox ? 'Firefox' : 
                           isSafari ? 'Safari' : 
                           isOpera ? 'Opera' : 'Unknown'
            };
        } catch (error) {
            console.log('GoogleAuth: Browser detection failed:', error);
            return {
                isEdge: false,
                isChrome: false,
                isFirefox: false,
                isSafari: false,
                isOpera: false,
                userAgent: 'unknown',
                browserName: 'Unknown'
            };
        }
    }

    /**
     * Universal web-based OAuth flow that works in all browsers
     * @returns {Promise<string>} OAuth token
     */
    async launchUniversalWebAuth() {
        return new Promise((resolve, reject) => {
            try {
                console.log('GoogleAuth: Starting universal web authentication...');
                
                // Use Web Application Client ID for universal web-based auth
                const WEB_CLIENT_ID = '635885285423-c84krdm83jhqvmjvqb7g6pncsup4gdc6.apps.googleusercontent.com';
                const REDIRECT_URI = 'https://autoscrollextension.onrender.com/auth/callback';
                
                const browser = this.detectBrowser();
                console.log('GoogleAuth: Browser info for universal auth:', browser);
                
                // Build OAuth URL
                const params = new URLSearchParams({
                    client_id: WEB_CLIENT_ID,
                    response_type: 'token',
                    redirect_uri: REDIRECT_URI,
                    scope: this.scopes.join(' '),
                    state: `universal_auth_${browser.isChrome ? 'chrome' : browser.isEdge ? 'edge' : browser.isFirefox ? 'firefox' : 'unknown'}_${Date.now()}`,
                    prompt: 'select_account' // Force account selection for better UX
                });

                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
                console.log('GoogleAuth: Opening authentication window for universal auth...');
                
                // Check if running in extension context
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    this.handleExtensionAuth(authUrl, resolve, reject);
                } else {
                    // Fallback for non-extension contexts
                    this.handleWebAuth(authUrl, resolve, reject);
                }

            } catch (error) {
                console.error('GoogleAuth: Universal web auth setup error:', error);
                reject(new Error('Failed to initialize authentication: ' + error.message));
            }
        });
    }

    /**
     * Handle authentication in extension context (Chrome, Edge, Firefox extensions)
     * @param {string} authUrl OAuth URL
     * @param {Function} resolve Promise resolve function
     * @param {Function} reject Promise reject function
     */
    handleExtensionAuth(authUrl, resolve, reject) {
        // Create new tab for authentication
        chrome.tabs.create({
            url: authUrl,
            active: true
        }, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error('Failed to open authentication tab: ' + chrome.runtime.lastError.message));
                return;
            }

            console.log('GoogleAuth: Authentication tab created:', tab.id);
            let authCompleted = false;
            
            // Listen for tab updates (when user is redirected)
            const tabUpdateListener = (tabId, changeInfo, updatedTab) => {
                if (tabId !== tab.id || authCompleted) return;
                
                console.log('GoogleAuth: Tab update ->', {
                    tabId,
                    url: changeInfo.url ? changeInfo.url.substring(0, 80) + '...' : 'no url',
                    status: changeInfo.status
                });
                
                // Check if we've reached our callback URL
                if (changeInfo.url && changeInfo.url.includes('autoscrollextension.onrender.com/auth/callback')) {
                    console.log('GoogleAuth: Reached callback URL, extracting token...');
                    authCompleted = true;
                    
                    // Remove listeners
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
                    chrome.tabs.onRemoved.removeListener(tabRemoveListener);
                    
                    // Wait a moment for the page to fully load
                    setTimeout(() => {
                        this.extractTokenFromCallback(tab.id)
                            .then(token => {
                                chrome.tabs.remove(tab.id);
                                resolve(token);
                            })
                            .catch(error => {
                                chrome.tabs.remove(tab.id);
                                reject(error);
                            });
                    }, 2000);
                    return;
                }
                
                // Check for direct token in URL (backup method)
                if (changeInfo.url && changeInfo.url.includes('access_token=')) {
                    console.log('GoogleAuth: Found access token directly in URL');
                    authCompleted = true;
                    
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
                    chrome.tabs.onRemoved.removeListener(tabRemoveListener);
                    
                    try {
                        const token = this.extractTokenFromUrl(changeInfo.url);
                        chrome.tabs.remove(tab.id);
                        resolve(token);
                    } catch (error) {
                        chrome.tabs.remove(tab.id);
                        reject(error);
                    }
                    return;
                }
                
                // Check for errors
                if (changeInfo.url && changeInfo.url.includes('error=')) {
                    console.log('GoogleAuth: Error detected in OAuth flow');
                    authCompleted = true;
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
                    chrome.tabs.onRemoved.removeListener(tabRemoveListener);
                    chrome.tabs.remove(tab.id);
                    reject(new Error('OAuth authentication failed'));
                }
            };

            // Listen for tab removal (user closed tab manually)
            const tabRemoveListener = (tabId) => {
                if (tabId === tab.id && !authCompleted) {
                    authCompleted = true;
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
                    chrome.tabs.onRemoved.removeListener(tabRemoveListener);
                    reject(new Error('Authentication canceled - tab was closed'));
                }
            };

            chrome.tabs.onUpdated.addListener(tabUpdateListener);
            chrome.tabs.onRemoved.addListener(tabRemoveListener);
            
            // Timeout after 10 minutes
            setTimeout(() => {
                if (!authCompleted) {
                    authCompleted = true;
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
                    chrome.tabs.onRemoved.removeListener(tabRemoveListener);
                    try {
                        chrome.tabs.remove(tab.id);
                    } catch (e) {
                        // Tab might already be closed
                    }
                    reject(new Error('Authentication timeout - please try again'));
                }
            }, 600000);
        });
    }

    /**
     * Handle authentication in web context (fallback)
     * @param {string} authUrl OAuth URL
     * @param {Function} resolve Promise resolve function
     * @param {Function} reject Promise reject function
     */
    handleWebAuth(authUrl, resolve, reject) {
        console.log('GoogleAuth: Using web-based authentication fallback');
        
        // Open popup window
        const popup = window.open(authUrl, 'google-auth', 'width=500,height=600,scrollbars=yes,resizable=yes');
        
        if (!popup) {
            reject(new Error('Failed to open authentication popup - please allow popups for this site'));
            return;
        }

        // Poll for popup closure or success
        const pollInterval = setInterval(() => {
            try {
                if (popup.closed) {
                    clearInterval(pollInterval);
                    reject(new Error('Authentication canceled - popup was closed'));
                    return;
                }

                // Try to access popup URL (will throw if different origin)
                const popupUrl = popup.location.href;
                
                if (popupUrl.includes('autoscrollextension.onrender.com/auth/callback') || 
                    popupUrl.includes('access_token=')) {
                    
                    clearInterval(pollInterval);
                    
                    try {
                        const token = this.extractTokenFromUrl(popupUrl);
                        popup.close();
                        resolve(token);
                    } catch (error) {
                        popup.close();
                        reject(error);
                    }
                }
            } catch (e) {
                // Cross-origin access denied - this is expected during auth flow
            }
        }, 1000);

        // Timeout after 10 minutes
        setTimeout(() => {
            clearInterval(pollInterval);
            if (!popup.closed) {
                popup.close();
                reject(new Error('Authentication timeout - please try again'));
            }
        }, 600000);
    }

    /**
     * Extract token from callback page using content script injection
     * @param {number} tabId Tab ID to extract token from
     * @returns {Promise<string>} OAuth token
     */
    async extractTokenFromCallback(tabId) {
        return new Promise((resolve, reject) => {
            // Method 1: Try to inject script to extract token from page
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                    try {
                        // Try multiple methods to get the token
                        let token = null;
                        
                        // Method 1: From URL hash
                        if (window.location.hash) {
                            const hashParams = new URLSearchParams(window.location.hash.substring(1));
                            token = hashParams.get('access_token');
                        }
                        
                        // Method 2: From URL search params
                        if (!token && window.location.search) {
                            const searchParams = new URLSearchParams(window.location.search);
                            token = searchParams.get('access_token');
                        }
                        
                        // Method 3: Check if token was stored in page by backend
                        if (!token) {
                            const tokenElement = document.querySelector('#access_token');
                            if (tokenElement) {
                                token = tokenElement.textContent || tokenElement.value;
                            }
                        }
                        
                        // Method 4: Check localStorage (if backend stored it there)
                        if (!token && window.localStorage) {
                            token = localStorage.getItem('access_token');
                        }
                        
                        console.log('Token extraction result:', token ? 'SUCCESS' : 'FAILED');
                        return token;
                        
                    } catch (e) {
                        console.error('Token extraction error:', e);
                        return null;
                    }
                }
            }, (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Script injection failed:', chrome.runtime.lastError);
                    reject(new Error('Failed to extract token from callback page'));
                    return;
                }
                
                if (result && result[0] && result[0].result) {
                    console.log('GoogleAuth: Token extracted successfully via script injection');
                    resolve(result[0].result);
                } else {
                    // Method 2: Try to get current tab URL and extract from there
                    chrome.tabs.get(tabId, (tab) => {
                        if (chrome.runtime.lastError || !tab) {
                            reject(new Error('Failed to get tab information'));
                            return;
                        }
                        
                        try {
                            const token = this.extractTokenFromUrl(tab.url);
                            if (token) {
                                console.log('GoogleAuth: Token extracted from tab URL');
                                resolve(token);
                            } else {
                                reject(new Error('No access token found in callback'));
                            }
                        } catch (error) {
                            reject(new Error('Failed to extract token: ' + error.message));
                        }
                    });
                }
            });
        });
    }

    /**
     * Build Google OAuth URL for web-based authentication
     * @returns {string} OAuth URL
     */
    buildGoogleAuthUrl() {
        // Use Web Application Client ID for cross-browser OAuth support
        const WEB_CLIENT_ID = '635885285423-c84krdm83jhqvmjvqb7g6pncsup4gdc6.apps.googleusercontent.com';
        
        // Use production callback URL now that Google Cloud Console is configured
        const REDIRECT_URI = 'https://autoscrollextension.onrender.com/auth/callback';
        
        const browser = this.detectBrowser();
        
        const params = new URLSearchParams({
            client_id: WEB_CLIENT_ID,
            response_type: 'token',
            redirect_uri: REDIRECT_URI,
            scope: this.scopes.join(' '),
            state: `web_auth_${browser.browserName.toLowerCase()}_${Date.now()}`
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
        console.log(`GoogleAuth: Built OAuth URL for ${browser.browserName} with web application client ID`);
        return authUrl;
    }

    /**
     * Extract access token from OAuth response URL
     * @param {string} url Response URL from OAuth flow
     * @returns {string|null} Access token or null
     */
    extractTokenFromUrl(url) {
        try {
            console.log('GoogleAuth: Extracting token from URL...');
            
            // Handle both fragment (#) and query (?) based responses
            let fragment = '';
            if (url.includes('#')) {
                fragment = url.split('#')[1];
            } else if (url.includes('?')) {
                fragment = url.split('?')[1];
            }
            
            // Also handle the case where the token is in the URL path itself
            if (!fragment && url.includes('access_token=')) {
                const urlParts = url.split('access_token=');
                if (urlParts.length > 1) {
                    const tokenPart = urlParts[1].split('&')[0];
                    if (tokenPart) {
                        console.log('GoogleAuth: Successfully extracted access token from URL path');
                        return decodeURIComponent(tokenPart);
                    }
                }
            }
            
            if (!fragment) {
                console.error('GoogleAuth: No fragment or query found in URL:', url.substring(0, 100) + '...');
                return null;
            }

            console.log('GoogleAuth: Fragment found:', fragment.substring(0, 100) + '...');

            // Parse parameters from fragment
            const params = new URLSearchParams(fragment);
            const accessToken = params.get('access_token');

            if (accessToken) {
                console.log('GoogleAuth: Successfully extracted access token');
                return accessToken;
            }

            // Check for error in response
            const error = params.get('error');
            if (error) {
                const errorDescription = params.get('error_description') || 'Unknown error';
                console.error('GoogleAuth: OAuth error:', error, errorDescription);
                throw new Error(`OAuth error: ${error} - ${errorDescription}`);
            }

            // Try alternative parameter names
            const altToken = params.get('token') || params.get('auth_token') || params.get('oauth_token');
            if (altToken) {
                console.log('GoogleAuth: Found token with alternative parameter name');
                return altToken;
            }

            console.error('GoogleAuth: No token found in parameters');
            console.error('GoogleAuth: Available parameters:', Array.from(params.keys()).join(', '));
            console.error('GoogleAuth: Full URL for debugging:', url);
            return null;
            
        } catch (error) {
            console.error('GoogleAuth: Error extracting token from URL:', error);
            throw error;
        }
    }

    /**
     * Get user information from Google API
     * @param {string} token OAuth token
     * @returns {Promise<Object>} User information
     */
    async getUserInfo(token) {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user information');
        }

        const userInfo = await response.json();
        
        return {
            id: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            verified_email: userInfo.verified_email
        };
    }

    /**
     * Store authentication data in Chrome storage
     * @param {Object} userInfo User information
     * @param {string} token OAuth token
     */
    async storeAuthData(userInfo, token) {
        const authData = {
            isLoggedIn: true,
            user: userInfo,
            token: token,
            loginTime: Date.now(),
            userId: `google_${userInfo.id}`, // Consistent user ID format
            lastLoginDate: new Date().toISOString()
        };

        await chrome.storage.local.set({
            authData: authData,
            userEmail: userInfo.email,
            userName: userInfo.name,
            userPicture: userInfo.picture,
            isAuthenticated: true
        });

        console.log('GoogleAuth: Auth data stored successfully');
    }

    /**
     * Check if user is currently logged in
     * @returns {Promise<Object>} Login status and user data
     */
    async checkLoginStatus() {
        try {
            const data = await chrome.storage.local.get(['authData', 'isAuthenticated']);
            
            if (!data.authData || !data.isAuthenticated) {
                return { isLoggedIn: false, user: null };
            }

            // Verify token is still valid
            const isValid = await this.verifyToken(data.authData.token);
            
            if (!isValid) {
                // Token expired, clear auth data
                await this.logout();
                return { isLoggedIn: false, user: null };
            }

            return {
                isLoggedIn: true,
                user: data.authData.user,
                loginTime: data.authData.loginTime
            };

        } catch (error) {
            console.error('GoogleAuth: Error checking login status:', error);
            return { isLoggedIn: false, user: null };
        }
    }

    /**
     * Verify if the OAuth token is still valid
     * @param {string} token OAuth token
     * @returns {Promise<boolean>} Token validity
     */
    async verifyToken(token) {
        try {
            const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`);
            return response.ok;
        } catch (error) {
            console.error('GoogleAuth: Token verification failed:', error);
            return false;
        }
    }

    /**
     * Logout user and clear all auth data
     * @returns {Promise<void>}
     */
    async logout() {
        try {
            // Get current token to revoke
            const data = await chrome.storage.local.get(['authData']);
            
            if (data.authData && data.authData.token) {
                // Revoke the token
                try {
                    await fetch(`https://oauth2.googleapis.com/revoke?token=${data.authData.token}`, {
                        method: 'POST'
                    });
                } catch (error) {
                    console.warn('GoogleAuth: Token revocation failed:', error);
                }

                // Remove cached token from Chrome Identity API (if available)
                try {
                    if (chrome.identity && chrome.identity.removeCachedAuthToken) {
                        chrome.identity.removeCachedAuthToken({ token: data.authData.token });
                        console.log('GoogleAuth: Cached token removed from Chrome Identity API');
                    } else {
                        console.log('GoogleAuth: Chrome Identity API not available (normal for some browsers)');
                    }
                } catch (error) {
                    // This is expected in Microsoft Edge and some other browsers
                    if (error.message.includes('Microsoft Edge') || error.message.includes('not supported')) {
                        console.log('GoogleAuth: Chrome Identity API not supported in this browser (this is normal)');
                    } else {
                        console.warn('GoogleAuth: Could not remove cached token:', error.message);
                    }
                }
            }

            // Clear all auth-related data from storage
            await chrome.storage.local.remove([
                'authData',
                'userEmail',
                'userName',
                'userPicture',
                'isAuthenticated',
                'subscriptionData',
                'trialData'
            ]);

            console.log('GoogleAuth: Logout successful');

        } catch (error) {
            console.error('GoogleAuth: Logout error:', error);
            throw error;
        }
    }

    /**
     * Get current user data
     * @returns {Promise<Object|null>} Current user data or null
     */
    async getCurrentUser() {
        const status = await this.checkLoginStatus();
        return status.isLoggedIn ? status.user : null;
    }

    /**
     * Refresh user authentication
     * @returns {Promise<Object>} Refreshed user data
     */
    async refreshAuth() {
        try {
            const data = await chrome.storage.local.get(['authData']);
            
            if (!data.authData) {
                throw new Error('No existing auth data to refresh');
            }

            // Get fresh token
            const token = await this.getAuthToken();
            const userInfo = await this.getUserInfo(token);
            
            // Update stored data
            await this.storeAuthData(userInfo, token);
            
            return {
                success: true,
                user: userInfo
            };

        } catch (error) {
            console.error('GoogleAuth: Auth refresh failed:', error);
            throw error;
        }
    }

    /**
     * Register user with backend after Google auth
     * @param {Object} userInfo Google user information
     * @returns {Promise<Object>} Backend registration result
     */
    async registerWithBackend(userInfo) {
        try {
            const API_BASE = 'https://autoscrollextension.onrender.com';

            console.log(`GoogleAuth: Registering with backend: ${API_BASE}`);

            const response = await fetch(`${API_BASE}/api/auth/google-login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    googleId: userInfo.id,
                    email: userInfo.email,
                    name: userInfo.name,
                    picture: userInfo.picture,
                    verified_email: userInfo.verified_email,
                    extensionVersion: chrome.runtime.getManifest().version,
                    loginTimestamp: Date.now()
                })
            });

            const result = await response.json();

            if (result.success) {
                // Store backend user data
                await chrome.storage.local.set({
                    backendUserId: result.data.userId,
                    subscriptionStatus: result.data.subscriptionStatus,
                    trialDaysRemaining: result.data.trialDaysRemaining,
                    canUseExtension: result.data.canUseExtension,
                    isNewUser: result.data.isNewUser,
                    backendSynced: true,
                    lastBackendSync: Date.now()
                });

                console.log('GoogleAuth: Backend registration successful');
                return result;
            } else {
                throw new Error(result.message || 'Backend registration failed');
            }

        } catch (error) {
            console.error('GoogleAuth: Backend registration error:', error);
            throw error;
        }
    }

    /**
     * Check if user is registered with backend and register if not
     * @returns {Promise<Object>} Backend registration status
     */
    async ensureBackendRegistration() {
        try {
            // Check if already registered
            const data = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            if (data.backendUserId && data.backendUserId !== 'unknown') {
                console.log('GoogleAuth: User already registered with backend');
                return { 
                    success: true, 
                    alreadyRegistered: true,
                    backendUserId: data.backendUserId 
                };
            }

            // Get current user info
            const currentUser = await this.getCurrentUser();
            if (!currentUser) {
                throw new Error('User not authenticated with Google');
            }

            // Register with backend
            console.log('GoogleAuth: Registering user with backend...');
            const result = await this.registerWithBackend(currentUser);
            
            return {
                success: true,
                alreadyRegistered: false,
                backendData: result.data
            };

        } catch (error) {
            console.error('GoogleAuth: Backend registration check/retry failed:', error);
            throw error;
        }
    }
}

// Export for use in extension
if (typeof window !== 'undefined') {
    window.GoogleAuth = GoogleAuth;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = GoogleAuth;
}
