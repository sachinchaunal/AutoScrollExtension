/**
 * AutoScroll Popup - Google Auth Version
 * Handles login-based authentication and AutoScroll controls
 */

class AutoScrollPopup {
    constructor() {
        this.isActive = false;
        this.currentUser = null;
        this.subscriptionData = null;
        this.googleAuth = new GoogleAuth();
        this.isAuthenticated = false;
        this.currentMandateId = null;
        this.mandateCheckInterval = null;
        
        // Universal API base URL that works across environments
        this.API_BASE_URL = '${this.API_BASE_URL}';
        
        this.init();
    }

    async init() {
        console.log('AutoScroll Popup: Initializing...');
        
        // Show loading screen
        this.showLoading(true);
        
        try {
            // Check authentication status
            await this.checkAuthStatus();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Update UI based on auth status
            await this.updateUI();
            
        } catch (error) {
            console.error('AutoScroll Popup: Initialization error:', error);
            this.showError('Failed to initialize extension');
        } finally {
            this.showLoading(false);
        }
    }

    async checkAuthStatus() {
        try {
            console.log('AutoScroll Popup: Checking authentication status...');
            
            // First check with GoogleAuth directly
            const authData = await this.googleAuth.checkAuthStatus();
            
            if (authData && authData.isAuthenticated) {
                this.isAuthenticated = true;
                this.currentUser = {
                    email: authData.email,
                    name: authData.name,
                    picture: authData.picture
                };
                
                console.log('AutoScroll Popup: User is authenticated:', this.currentUser.email);
                
                // Get subscription data
                await this.loadSubscriptionData();
                // Sync AutoScroll state
                await this.syncAutoScrollState();
            } else {
                // Fallback: Check with background script
                const response = await chrome.runtime.sendMessage({ action: 'getAuthStatus' });
                
                if (response && response.success && response.data.isLoggedIn) {
                    this.isAuthenticated = response.data.isLoggedIn;
                    this.currentUser = response.data.user;
                    
                    console.log('AutoScroll Popup: Auth status from background:', this.currentUser?.email);
                    
                    if (this.isAuthenticated) {
                        // Get subscription data
                        await this.loadSubscriptionData();
                        // Sync AutoScroll state
                        await this.syncAutoScrollState();
                    }
                } else {
                    this.isAuthenticated = false;
                    this.currentUser = null;
                    console.log('AutoScroll Popup: User is not authenticated');
                }
            }
        } catch (error) {
            console.error('AutoScroll Popup: Auth check failed:', error);
            this.isAuthenticated = false;
            this.currentUser = null;
        }
    }

    async loadSubscriptionData() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'getSubscriptionStatus' });
            
            if (response && response.success) {
                this.subscriptionData = response.data;
                console.log('AutoScroll Popup: Subscription data loaded:', this.subscriptionData);
            }
        } catch (error) {
            console.error('AutoScroll Popup: Failed to load subscription data:', error);
        }
    }

    async forceRefreshStatus() {
        try {
            console.log('AutoScroll Popup: Force refreshing subscription status...');
            
            // Show loading state
            const refreshBtns = [
                document.getElementById('refreshStatusBtn'),
                document.getElementById('refreshStatusBtn2')
            ];
            
            refreshBtns.forEach(btn => {
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = '🔄 Refreshing...';
                }
            });
            
            // Call force refresh from background script
            const response = await chrome.runtime.sendMessage({ action: 'forceRefreshStatus' });
            
            if (response && response.success) {
                console.log('AutoScroll Popup: Force refresh successful:', response.data);
                
                // Reload subscription data
                await this.loadSubscriptionData();
                
                // Update UI
                await this.updateUI();
                
                // Show success message
                this.showNotification('Subscription status refreshed successfully!', 'success');
                
            } else {
                console.error('AutoScroll Popup: Force refresh failed:', response);
                this.showNotification('Failed to refresh status. Please try again.', 'error');
            }
            
        } catch (error) {
            console.error('AutoScroll Popup: Force refresh error:', error);
            this.showNotification('Error refreshing status. Please try again.', 'error');
        } finally {
            // Reset button states
            const refreshBtns = [
                document.getElementById('refreshStatusBtn'),
                document.getElementById('refreshStatusBtn2')
            ];
            
            refreshBtns.forEach(btn => {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🔄 Refresh Status';
                }
            });
        }
    }

    async syncAutoScrollState() {
        try {
            // Check if we're on a supported platform
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab && this.isSupportedPlatform(tab.url)) {
                // Get AutoScroll status from content script
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
                
                if (response && response.success) {
                    this.isActive = response.isActive;
                    console.log('AutoScroll Popup: AutoScroll state synced:', this.isActive);
                }
            }
        } catch (error) {
            console.log('AutoScroll Popup: Could not sync with content script:', error.message);
        }
    }

    setupEventListeners() {
        // Google Login Button
        const loginBtn = document.getElementById('googleLoginBtn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.handleGoogleLogin());
        }

        // Logout Button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // AutoScroll Toggle Button
        const toggleBtn = document.getElementById('toggleButton');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleAutoScroll());
        }

        // Subscribe Button
        const subscribeBtn = document.getElementById('subscribeButton');
        if (subscribeBtn) {
            subscribeBtn.addEventListener('click', () => this.openPaymentModal());
        }

        // Refresh Status Buttons
        const refreshStatusBtn = document.getElementById('refreshStatusBtn');
        if (refreshStatusBtn) {
            refreshStatusBtn.addEventListener('click', () => this.forceRefreshStatus());
        }
        
        const refreshStatusBtn2 = document.getElementById('refreshStatusBtn2');
        if (refreshStatusBtn2) {
            refreshStatusBtn2.addEventListener('click', () => this.forceRefreshStatus());
        }

        // Payment Modal Events
        this.setupPaymentModalEvents();

        // Settings Events
        this.setupSettingsEvents();

        // Close Modal
        const closeModal = document.getElementById('closeModal');
        if (closeModal) {
            closeModal.addEventListener('click', () => this.closePaymentModal());
        }

        // Click outside modal to close
        const modal = document.getElementById('paymentModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closePaymentModal();
                }
            });
        }
    }

    setupPaymentModalEvents() {
        // Create Mandate Button
        const createMandateBtn = document.getElementById('createMandateBtn');
        if (createMandateBtn) {
            createMandateBtn.addEventListener('click', () => this.createUpiMandate());
        }

        // Check Mandate Status
        const checkStatusBtn = document.getElementById('checkMandateStatus');
        if (checkStatusBtn) {
            checkStatusBtn.addEventListener('click', () => this.checkMandateStatus());
        }

        // Cancel Mandate
        const cancelMandateBtn = document.getElementById('cancelMandateBtn');
        if (cancelMandateBtn) {
            cancelMandateBtn.addEventListener('click', () => this.cancelMandate());
        }
    }

    setupSettingsEvents() {
        // Notifications Toggle
        const notificationsToggle = document.getElementById('notificationsToggle');
        if (notificationsToggle) {
            notificationsToggle.addEventListener('change', (e) => {
                this.updateSetting('notifications', e.target.checked);
            });
        }

        // Speed Select
        const speedSelect = document.getElementById('speedSelect');
        if (speedSelect) {
            speedSelect.addEventListener('change', (e) => {
                this.updateSetting('autoScrollSpeed', e.target.value);
            });
        }
    }

    async updateUI() {
        if (this.isAuthenticated) {
            this.showMainScreen();
            this.updateUserInfo();
            this.updateSubscriptionInfo();
            this.updateAutoScrollStatus();
        } else {
            this.showLoginScreen();
        }
    }

    showLoginScreen() {
        document.getElementById('loginScreen').style.display = 'block';
        document.getElementById('mainScreen').style.display = 'none';
    }

    showMainScreen() {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainScreen').style.display = 'block';
    }

    showLoading(show) {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = show ? 'flex' : 'none';
        }
    }

    updateUserInfo() {
        if (!this.currentUser) return;

        const userPicture = document.getElementById('userPicture');
        const userName = document.getElementById('userName');
        const userEmail = document.getElementById('userEmail');

        if (userPicture) {
            userPicture.src = this.currentUser.picture || 'icons/icon48.png';
            userPicture.alt = this.currentUser.name || 'User';
        }

        if (userName) {
            userName.textContent = this.currentUser.name || 'Unknown User';
        }

        if (userEmail) {
            userEmail.textContent = this.currentUser.email || 'No email';
        }
    }

    updateSubscriptionInfo() {
        if (!this.subscriptionData) return;

        const trialInfo = document.getElementById('trialInfo');
        const subscriptionStatus = document.getElementById('subscriptionStatus');
        const expiredNotice = document.getElementById('expiredNotice');
        const trialDays = document.getElementById('trialDays');
        const trialProgress = document.getElementById('trialProgress');
        const subscribeButton = document.getElementById('subscribeButton');

        // Hide all sections first
        if (trialInfo) trialInfo.style.display = 'none';
        if (subscriptionStatus) subscriptionStatus.style.display = 'none';
        if (expiredNotice) expiredNotice.style.display = 'none';

        if (this.subscriptionData.subscriptionStatus === 'trial') {
            // Show trial info
            if (trialInfo) trialInfo.style.display = 'block';
            if (trialDays) {
                trialDays.textContent = `${this.subscriptionData.trialDaysRemaining} days remaining`;
            }
            if (trialProgress) {
                const progressPercent = (this.subscriptionData.trialDaysRemaining / 10) * 100;
                trialProgress.style.width = `${Math.max(0, progressPercent)}%`;
            }
            if (subscribeButton) {
                subscribeButton.style.display = 'block';
                subscribeButton.textContent = 'Subscribe to Premium';
            }
        } else if (this.subscriptionData.subscriptionStatus === 'active') {
            // Show active subscription
            if (subscriptionStatus) {
                subscriptionStatus.style.display = 'block';
                const subscriptionText = document.getElementById('subscriptionText');
                if (subscriptionText) {
                    subscriptionText.textContent = 'Premium subscription active';
                }
            }
            if (subscribeButton) {
                subscribeButton.style.display = 'block';
                subscribeButton.textContent = 'Manage Subscription';
            }
        } else {
            // Show expired notice
            if (expiredNotice) expiredNotice.style.display = 'block';
            if (subscribeButton) {
                subscribeButton.style.display = 'block';
                subscribeButton.textContent = 'Subscribe Now';
            }
        }
    }

    updateAutoScrollStatus() {
        const statusDot = document.getElementById('statusDot');
        const statusText = document.getElementById('statusText');
        const toggleButton = document.getElementById('toggleButton');

        if (this.isActive) {
            if (statusDot) statusDot.className = 'status-dot active';
            if (statusText) statusText.textContent = 'Active';
            if (toggleButton) {
                toggleButton.textContent = 'Stop AutoScroll';
                toggleButton.className = 'btn btn-danger';
            }
        } else {
            if (statusDot) statusDot.className = 'status-dot inactive';
            if (statusText) statusText.textContent = 'Inactive';
            if (toggleButton) {
                toggleButton.textContent = 'Start AutoScroll';
                toggleButton.className = 'btn btn-primary';
            }
        }

        // Disable button if can't use extension
        if (toggleButton && this.subscriptionData) {
            toggleButton.disabled = !this.subscriptionData.canUseExtension;
            if (!this.subscriptionData.canUseExtension) {
                toggleButton.textContent = 'Trial Expired - Subscribe';
                toggleButton.className = 'btn btn-secondary';
            }
        }
    }

    async handleGoogleLogin() {
        try {
            this.showLoading(true);
            console.log('AutoScroll Popup: Starting Google login...');

            const response = await chrome.runtime.sendMessage({ action: 'googleLogin' });

            if (response && response.success) {
                console.log('AutoScroll Popup: Login successful!');
                
                // Update local state
                this.isAuthenticated = true;
                this.currentUser = response.data.user;
                this.subscriptionData = response.data.subscriptionData;

                // Update UI
                await this.updateUI();

                // Show success message
                this.showNotification('Welcome!', response.data.message || 'Login successful');

            } else {
                throw new Error(response.error || 'Login failed');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Login error:', error);
            
            // Handle different types of authentication errors with enhanced browser-specific messages
            let errorMessage = 'Login failed: ';
            
            if (error.message.includes('Chrome Identity API')) {
                errorMessage = '🔧 Chrome Extension API Issue:\n\nThe Chrome Identity API encountered an error. This usually resolves with:\n\n1. Reload the extension\n2. Restart Chrome\n3. Clear extension data in Chrome settings\n\nTrying fallback authentication...';
                
                // Auto-retry with universal auth
                setTimeout(() => {
                    console.log('AutoScroll: Retrying login with universal auth fallback');
                    this.handleGoogleLogin();
                }, 3000);
                
            } else if (error.message.includes('API is not supported') || error.message.includes('not supported')) {
                // Detect browser for specific guidance
                const userAgent = navigator.userAgent;
                const isEdge = userAgent.includes('Edg/');
                const isFirefox = userAgent.includes('Firefox/');
                const isSafari = userAgent.includes('Safari/') && !userAgent.includes('Chrome/');
                
                if (isEdge) {
                    errorMessage = '✅ Microsoft Edge Compatibility:\n\nYour browser is supported! The extension will use universal web authentication.\n\nIf login fails:\n1. Allow popups from this extension\n2. Make sure you\'re signed into your Microsoft account\n3. Try refreshing the extension';
                } else if (isFirefox) {
                    errorMessage = '🦊 Firefox Compatibility:\n\nFirefox extensions have different APIs. The extension will use web-based authentication.\n\nPlease:\n1. Allow popups for this extension\n2. Enable third-party cookies temporarily\n3. Try the authentication again';
                } else if (isSafari) {
                    errorMessage = '🍎 Safari Limited Support:\n\nSafari has limited extension capabilities. For best experience:\n\n1. Use Chrome or Edge instead\n2. If continuing, allow all popups\n3. Enable cross-site tracking';
                } else {
                    errorMessage = '🌐 Browser Compatibility:\n\nUsing universal authentication for your browser. Please:\n\n1. Allow popups for this extension\n2. Ensure JavaScript is enabled\n3. Try refreshing the page';
                }
            } else if (error.message.includes('User cancelled') || error.message.includes('cancelled') || error.message.includes('tab was closed')) {
                errorMessage = '❌ Login Cancelled\n\nYou cancelled the Google sign-in process. Please try again to access premium features.';
            } else if (error.message.includes('network') || error.message.includes('fetch') || error.message.includes('timeout')) {
                errorMessage = '🌐 Network Error\n\nUnable to connect to authentication servers. Please:\n\n1. Check your internet connection\n2. Disable VPN temporarily if using one\n3. Try again in a few moments';
            } else if (error.message.includes('popup blocked') || error.message.includes('popup')) {
                errorMessage = '🚫 Popup Blocked\n\nYour browser blocked the authentication popup. Please:\n\n1. Click the popup blocker icon in your address bar\n2. Allow popups for this extension\n3. Try logging in again';
            } else if (error.message.includes('Authentication not supported')) {
                errorMessage = '⚠️ Browser Authentication Issue\n\nYour browser configuration doesn\'t support the required authentication. Please:\n\n1. Update your browser to the latest version\n2. Enable JavaScript and cookies\n3. Use Chrome or Edge for best compatibility';
            } else {
                errorMessage += error.message || 'Unknown error occurred. Please try refreshing the extension or restarting your browser.';
            }
            
            this.showError(errorMessage);
        } finally {
            this.showLoading(false);
        }
    }

    async handleLogout() {
        try {
            this.showLoading(true);
            console.log('AutoScroll Popup: Logging out...');

            // First, try to logout directly with GoogleAuth
            try {
                await this.googleAuth.logout();
                console.log('AutoScroll Popup: Direct GoogleAuth logout successful');
            } catch (directLogoutError) {
                console.warn('AutoScroll Popup: Direct logout failed, trying via background:', directLogoutError.message);
                
                // Fallback: logout via background script
                const response = await chrome.runtime.sendMessage({ action: 'logout' });
                
                if (!response || !response.success) {
                    throw new Error(response?.error || 'Background logout failed');
                }
            }

            // Clear local state regardless of method used
            this.isAuthenticated = false;
            this.currentUser = null;
            this.subscriptionData = null;
            this.isActive = false;

            // Clear local storage as well
            await chrome.storage.local.clear();

            // Update UI
            this.showLoginScreen();
            this.showNotification('Logout Successful', 'You have been logged out successfully! 👋');

            console.log('AutoScroll Popup: Logout completed successfully');

        } catch (error) {
            console.error('AutoScroll Popup: Logout error:', error);
            
            // Even if logout fails, clear local state for security
            this.isAuthenticated = false;
            this.currentUser = null;
            this.subscriptionData = null;
            
            // Show appropriate message based on error type
            let message = 'Logout encountered an issue, but local session has been cleared.';
            
            if (error.message.includes('removeCachedAuthToken') || error.message.includes('Microsoft Edge') || error.message.includes('API is not supported')) {
                // Edge/Browser compatibility issue - but logout was successful
                message = 'Logged out successfully! (Some browser-specific features not available)';
                this.showNotification('Logout Complete', message);
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                message = 'Logged out locally. Network error prevented full server logout.';
                this.showNotification('Partial Logout', message);
            } else {
                this.showError(message);
            }
            
            this.showLoginScreen(); // Show login screen anyway for security
        } finally {
            this.showLoading(false);
        }
    }

    async toggleAutoScroll() {
        if (!this.subscriptionData || !this.subscriptionData.canUseExtension) {
            this.showError('Your trial has expired. Please subscribe to continue.');
            this.openPaymentModal();
            return;
        }

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab || !this.isSupportedPlatform(tab.url)) {
                this.showError('Please navigate to YouTube Shorts to use AutoScroll');
                return;
            }

            const action = this.isActive ? 'stopAutoScroll' : 'startAutoScroll';
            console.log('AutoScroll Popup: Sending action:', action);

            const response = await chrome.tabs.sendMessage(tab.id, { action });

            if (response && response.success) {
                // Update local state based on actual response
                this.isActive = response.isActive;
                this.updateAutoScrollStatus();

                // Log usage
                if (this.isActive) {
                    chrome.runtime.sendMessage({
                        action: 'logScrollEvent',
                        data: {
                            platform: 'youtube',
                            url: tab.url,
                            direction: 'start'
                        }
                    });
                }

                console.log('AutoScroll Popup: Toggle successful, new state:', this.isActive);
                
                // Double-check state after 1 second to ensure consistency
                setTimeout(async () => {
                    try {
                        const checkResponse = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
                        if (checkResponse && checkResponse.success) {
                            if (checkResponse.isActive !== this.isActive) {
                                console.log('AutoScroll Popup: State mismatch detected, correcting UI');
                                this.isActive = checkResponse.isActive;
                                this.updateAutoScrollStatus();
                            }
                        }
                    } catch (error) {
                        console.log('AutoScroll Popup: State verification failed:', error.message);
                    }
                }, 1000);
                
            } else {
                throw new Error(response?.error || 'Failed to toggle AutoScroll');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Toggle error:', error);
            this.showError('Failed to toggle AutoScroll: ' + error.message);
            
            // Reset UI state on error
            await this.syncAutoScrollState();
        }
    }

    isSupportedPlatform(url) {
        return url && (url.includes('youtube.com/shorts') || url.includes('youtube.com') && url.includes('shorts'));
    }

    // Payment and Subscription Methods
    async openPaymentModal() {
        const modal = document.getElementById('paymentModal');
        if (modal) {
            modal.style.display = 'flex';
            
            // Reset modal sections
            this.resetPaymentModalSections();
            
            // Check for existing autopay when opening modal
            await this.checkForExistingAutopayOnOpen();
        }
    }

    resetPaymentModalSections() {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const statusSection = document.getElementById('mandateStatus');

        if (upiSection) upiSection.style.display = 'block';
        if (qrSection) qrSection.style.display = 'none';
        if (statusSection) statusSection.style.display = 'none';
    }

    async checkForExistingAutopayOnOpen() {
        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            if (!userData.backendUserId || !userData.authData) {
                return; // User not authenticated
            }

            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success && result.data.hasMandate) {
                // User has existing autopay, show it
                this.currentMandateId = result.data.mandateId;
                this.handleExistingAutopayOnOpen(result.data);
            }

        } catch (error) {
            console.log('AutoScroll Popup: Could not check existing autopay:', error.message);
            // Don't show error to user, just proceed with normal flow
        }
    }

    handleExistingAutopayOnOpen(autopayData) {
        const upiSection = document.getElementById('upiInputSection');
        const statusSection = document.getElementById('mandateStatus');

        // Hide UPI input and show existing autopay
        if (upiSection) upiSection.style.display = 'none';
        if (statusSection) statusSection.style.display = 'block';

        // Show existing autopay information
        this.updateMandateStatus(autopayData);
        
        console.log('AutoScroll Popup: Found existing autopay:', autopayData.mandateId);
    }

    closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.clearMandateCheckInterval();
    }

    async createUpiMandate() {
        // Get customer information from current user
        const customerName = this.currentUser?.name || 'AutoScroll User';
        const customerEmail = this.currentUser?.email || 'user@autoscroll.com';

        try {
            console.log('AutoScroll Popup: Creating UPI AutoPay for user:', customerEmail);

            // Get user data with better validation
            const userData = await chrome.storage.local.get(['backendUserId', 'authData', 'userProfile']);
            
            if (!userData.backendUserId) {
                this.showError('User not authenticated. Please log in again.');
                return;
            }

            if (!userData.authData || !userData.authData.token) {
                this.showError('Authentication token missing. Please log in again.');
                return;
            }

            if (!this.currentUser || !this.currentUser.email) {
                this.showError('User information missing. Please log in again.');
                return;
            }

            const response = await fetch('${this.API_BASE_URL}/upi-autopay/create-autopay', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                },
                body: JSON.stringify({
                    userId: userData.backendUserId,
                    customerName: customerName,
                    customerEmail: customerEmail,
                    customerPhone: '+919999999999' // Optional: could be collected from user
                })
            });

            const result = await response.json();

            if (result.success) {
                this.currentMandateId = result.data.mandateId;
                
                // Handle AutoPay subscription URL
                if (result.data.subscriptionUrl) {
                    this.showAutopayLink(result.data.subscriptionUrl);
                    this.startMandateStatusCheck();
                } else {
                    // No subscription URL available yet
                    console.log('AutoScroll Popup: AutoPay created but no URL yet:', result.data);
                    this.showPendingSubscriptionMessage(result.data);
                    
                    // Start checking for URL availability
                    this.startSubscriptionUrlCheck();
                    
                    // Also try to verify the subscription after a short delay
                    setTimeout(() => {
                        this.verifySubscriptionStatus(result.data.subscriptionId);
                    }, 3000);
                }
                
                // Show instructions if available
                if (result.data.instructions) {
                    console.log('AutoScroll Popup: Instructions:', result.data.instructions);
                }
            } else {
                // Check if it's an existing autopay error
                if (result.message && result.message.includes('already has an active mandate') && result.data) {
                    // User has existing autopay, show management options
                    this.handleExistingMandate(result.data);
                } else {
                    throw new Error(result.message || 'Failed to create autopay');
                }
            }

        } catch (error) {
            console.error('AutoScroll Popup: AutoPay creation error:', error);
            this.showError('Failed to create AutoPay subscription: ' + error.message);
        }
    }

    handleExistingMandate(mandateData) {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const statusSection = document.getElementById('mandateStatus');

        // Hide UPI input section
        if (upiSection) upiSection.style.display = 'none';
        // Hide QR section
        if (qrSection) qrSection.style.display = 'none';
        // Show status section
        if (statusSection) statusSection.style.display = 'block';

        // Set the current mandate ID
        this.currentMandateId = mandateData.mandateId;

        // Show existing mandate management options
        this.showExistingMandateOptions(mandateData);
        
        // Start checking the existing mandate status
        this.checkMandateStatus();
    }

    showExistingMandateOptions(mandateData) {
        const statusSection = document.getElementById('mandateStatus');
        
        if (statusSection) {
            statusSection.innerHTML = `
                <div class="status-card existing-mandate">
                    <h4>🔄 Existing Subscription Found</h4>
                    <p>You already have a subscription set up!</p>
                    
                    <div class="mandate-details">
                        <p><strong>Mandate ID:</strong></p>
                        <p class="mandate-id">${mandateData.mandateId}</p>
                        <p><strong>Status:</strong> ${mandateData.status}</p>
                    </div>
                    
                    <div class="existing-mandate-actions">
                        <p><strong>What would you like to do?</strong></p>
                        <div class="action-buttons">
                            <button id="checkExistingStatus" class="btn btn-secondary">Check Current Status</button>
                            <button id="cancelExistingMandate" class="btn btn-danger">Cancel Subscription</button>
                        </div>
                        
                        ${mandateData.status === 'PENDING' ? `
                            <div class="pending-mandate-notice">
                                <p><strong>⚠️ Payment Pending:</strong></p>
                                <p>Your subscription setup is incomplete. Complete the payment to activate your subscription.</p>
                                <button id="completePendingPayment" class="btn btn-primary">Complete Payment</button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            // Add event listeners for the new buttons
            this.setupExistingMandateEventListeners();
        }
    }

    setupExistingMandateEventListeners() {
        const checkStatusBtn = document.getElementById('checkExistingStatus');
        const cancelBtn = document.getElementById('cancelExistingMandate');
        const completePaymentBtn = document.getElementById('completePendingPayment');

        if (checkStatusBtn) {
            checkStatusBtn.addEventListener('click', () => this.checkMandateStatus());
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancelMandate());
        }

        if (completePaymentBtn) {
            completePaymentBtn.addEventListener('click', () => this.handlePendingPaymentCompletion());
        }
    }

    async handlePendingPaymentCompletion() {
        try {
            // Get the existing mandate details to show QR/payment link again
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success && result.data.hasMandate) {
                if (result.data.subscriptionUrl) {
                    // Show the subscription URL for payment
                    this.showAutopayLink(result.data.subscriptionUrl);
                    this.startMandateStatusCheck();
                    this.showNotification('Payment Required', 'Please complete the payment to activate your subscription.');
                } else {
                    // No subscription URL available, try to create a new one
                    console.log('No subscription URL available, attempting to recreate...');
                    this.showError('Payment link expired. Creating a new subscription...');
                    
                    // Reset to create new mandate
                    this.resetToCreateNewMandate();
                    
                    // Auto-create new mandate after a short delay
                    setTimeout(() => {
                        this.createUpiMandate();
                    }, 2000);
                }
            } else {
                this.showError('Could not retrieve mandate details. Please try creating a new subscription.');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Pending payment completion error:', error);
            this.showError('Failed to retrieve payment details. Please try creating a new subscription.');
        }
    }

    showPendingSubscriptionMessage(subscriptionData) {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const qrCodeDiv = document.getElementById('mandateQrCode');

        if (upiSection) upiSection.style.display = 'none';
        if (qrSection) qrSection.style.display = 'block';
        
        if (qrCodeDiv) {
            const pendingHTML = `
                <div style="text-align: center;">
                    <h3>⏳ Setting up your AutoPay</h3>
                    <p style="margin-bottom: 15px;">Your subscription is being prepared...</p>
                    <div style="margin: 20px 0;">
                        <div class="loading-spinner" style="
                            border: 4px solid #f3f3f3;
                            border-top: 4px solid #3498db;
                            border-radius: 50%;
                            width: 40px;
                            height: 40px;
                            animation: spin 2s linear infinite;
                            margin: 0 auto;
                        "></div>
                    </div>
                    <p style="font-size: 14px; color: #666;">
                        Please wait while we generate your payment link...
                    </p>
                    <div style="margin-top: 15px;">
                        <button id="retrySubscriptionBtn" class="btn btn-secondary" style="margin-right: 10px;">
                            🔄 Check Again
                        </button>
                        <button id="cancelPendingBtn" class="btn btn-danger">
                            ❌ Cancel
                        </button>
                    </div>
                </div>
                <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                </style>
            `;
            
            qrCodeDiv.innerHTML = pendingHTML;
            
            // Add event listeners
            const retryBtn = document.getElementById('retrySubscriptionBtn');
            const cancelBtn = document.getElementById('cancelPendingBtn');
            
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.checkMandateStatus());
            }
            
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => this.resetToCreateNewMandate());
            }
        }
    }

    startSubscriptionUrlCheck() {
        this.clearMandateCheckInterval();
        
        this.mandateCheckInterval = setInterval(async () => {
            await this.checkForSubscriptionUrl();
        }, 3000); // Check every 3 seconds

        // Stop checking after 2 minutes
        setTimeout(() => {
            this.clearMandateCheckInterval();
            this.showSubscriptionUrlTimeout();
        }, 120000);
    }

    async checkForSubscriptionUrl() {
        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success && result.data.hasMandate && result.data.subscriptionUrl) {
                // URL is now available
                this.clearMandateCheckInterval();
                this.showAutopayLink(result.data.subscriptionUrl);
                this.startMandateStatusCheck();
                console.log('AutoScroll Popup: Subscription URL now available');
            }

        } catch (error) {
            console.error('AutoScroll Popup: URL check error:', error);
        }
    }

    showSubscriptionUrlTimeout() {
        const qrCodeDiv = document.getElementById('mandateQrCode');
        
        if (qrCodeDiv) {
            const timeoutHTML = `
                <div style="text-align: center;">
                    <h3>⚠️ Setup Taking Longer Than Expected</h3>
                    <p style="margin-bottom: 15px;">The payment link generation is delayed.</p>
                    <div style="margin-top: 20px;">
                        <button id="retrySubscriptionSetup" class="btn btn-primary" style="margin-right: 10px;">
                            🔄 Try Again
                        </button>
                        <button id="createNewSubscription" class="btn btn-secondary">
                            ➕ Create New
                        </button>
                    </div>
                    <p style="font-size: 12px; color: #666; margin-top: 15px;">
                        If the issue persists, please contact support.
                    </p>
                </div>
            `;
            
            qrCodeDiv.innerHTML = timeoutHTML;
            
            // Add event listeners
            const retryBtn = document.getElementById('retrySubscriptionSetup');
            const newBtn = document.getElementById('createNewSubscription');
            
            if (retryBtn) {
                retryBtn.addEventListener('click', () => this.checkMandateStatus());
            }
            
            if (newBtn) {
                newBtn.addEventListener('click', () => this.resetToCreateNewMandate());
            }
        }
    }

    showAutopayLink(subscriptionUrl) {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const qrCodeDiv = document.getElementById('mandateQrCode');

        if (upiSection) upiSection.style.display = 'none';
        if (qrSection) qrSection.style.display = 'block';
        
        if (qrCodeDiv && subscriptionUrl) {
            const autopayHTML = `
                <div style="text-align: center;">
                    <h3>🔄 Setup UPI AutoPay</h3>
                    <p style="margin-bottom: 15px;">Choose your preferred method to setup automatic monthly payments:</p>
                    
                    <div class="payment-methods" style="margin: 20px 0;">
                        <div class="method-option" style="margin-bottom: 15px;">
                            <button id="openInNewTab" class="btn btn-primary" style="
                                width: 100%;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                color: white;
                                padding: 15px 30px;
                                border: none;
                                border-radius: 8px;
                                font-weight: bold;
                                font-size: 16px;
                                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                                cursor: pointer;
                                transition: transform 0.2s;
                            ">
                                🚀 Open Payment Page in New Tab
                            </button>
                        </div>
                        
                        <div class="method-option" style="margin-bottom: 15px;">
                            <button id="generateQrCode" class="btn btn-secondary" style="
                                width: 100%;
                                background: #28a745;
                                color: white;
                                padding: 12px 20px;
                                border: none;
                                border-radius: 6px;
                                font-weight: bold;
                                cursor: pointer;
                            ">
                                📱 Generate QR Code for UPI Apps
                            </button>
                        </div>
                    </div>
                    
                    <div class="alternative-link" style="margin: 15px 0; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                        <p style="font-size: 12px; color: #666; margin: 5px 0;">Or copy this payment link:</p>
                        <input type="text" value="${subscriptionUrl}" readonly class="copy-link-input" style="
                            width: 100%;
                            padding: 8px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                            font-size: 12px;
                            background: white;
                            cursor: pointer;
                        " />
                        <p style="font-size: 11px; color: #888; margin: 5px 0;">Click to copy and paste in your browser</p>
                    </div>
                    
                    <div id="qrCodeContainer" style="display: none; margin-top: 20px;">
                        <div id="qrCodeDisplay" style="background: white; padding: 20px; border-radius: 8px; border: 2px solid #ddd;">
                            <!-- QR code will be inserted here -->
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #007cba;">
                        <h4 style="margin: 0 0 10px 0; color: #333;">What happens next?</h4>
                        <ol style="text-align: left; margin: 0; padding-left: 20px;">
                            <li>You'll be redirected to Razorpay's secure payment page</li>
                            <li>Choose your UPI app (GPay, PhonePe, Paytm, etc.)</li>
                            <li>Approve the AutoPay mandate for ₹9/month</li>
                            <li>Your subscription will be automatically renewed monthly</li>
                            <li>You can cancel anytime from this extension</li>
                        </ol>
                    </div>
                    
                    <p style="font-size: 12px; color: #666; margin-top: 15px;">
                        Secure payment powered by Razorpay • Cancel anytime
                    </p>
                </div>
            `;
            
            qrCodeDiv.innerHTML = autopayHTML;
            
            // Add event listeners for payment methods
            this.setupPaymentMethodEventListeners(subscriptionUrl);
        }
    }

    setupPaymentMethodEventListeners(subscriptionUrl) {
        // Open in new tab button
        const openTabBtn = document.getElementById('openInNewTab');
        if (openTabBtn) {
            openTabBtn.addEventListener('mouseenter', () => {
                openTabBtn.style.transform = 'scale(1.02)';
            });
            
            openTabBtn.addEventListener('mouseleave', () => {
                openTabBtn.style.transform = 'scale(1)';
            });
            
            openTabBtn.addEventListener('click', () => {
                console.log('AutoScroll Popup: Opening payment page in new tab:', subscriptionUrl);
                
                // Universal solution that works in all browsers
                try {
                    // Try window.open first (works in all browsers)
                    const newWindow = window.open(subscriptionUrl, '_blank', 'noopener,noreferrer');
                    
                    if (newWindow) {
                        console.log('Successfully opened payment page in new tab using window.open');
                        this.showNotification('Payment Page Opened', 'Complete the payment in the new tab to activate your subscription.');
                    } else {
                        // If popup was blocked, provide alternative methods
                        throw new Error('Popup blocked');
                    }
                } catch (error) {
                    console.log('window.open failed, providing alternative methods:', error.message);
                    
                    // Show alternative methods when popup is blocked
                    this.showPopupBlockedAlternatives(subscriptionUrl);
                }
            });
        }

        // Generate QR code button
        const qrBtn = document.getElementById('generateQrCode');
        if (qrBtn) {
            qrBtn.addEventListener('click', () => {
                this.generateUpiQrCode(subscriptionUrl);
            });
        }

        // Copy link functionality
        const copyInput = document.querySelector('.copy-link-input');
        if (copyInput) {
            copyInput.addEventListener('click', function() {
                this.select();
                document.execCommand('copy');
                this.style.background = '#e8f5e8';
                setTimeout(() => {
                    this.style.background = 'white';
                }, 2000);
            });
        }
    }

    showPopupBlockedAlternatives(subscriptionUrl) {
        const qrCodeDiv = document.getElementById('mandateQrCode');
        
        if (qrCodeDiv) {
            const alternativesHTML = `
                <div style="text-align: center;">
                    <h3>🚫 Popup Blocked</h3>
                    <p style="margin-bottom: 15px; color: #e74c3c;">Your browser blocked the popup. Please try one of these alternatives:</p>
                    
                    <div class="popup-alternatives" style="margin: 20px 0;">
                        <div class="alternative-method" style="margin-bottom: 15px; padding: 15px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #856404;">🔗 Method 1: Copy Link</h4>
                            <input type="text" value="${subscriptionUrl}" readonly id="manualCopyInput" style="
                                width: 100%;
                                padding: 10px;
                                border: 1px solid #ddd;
                                border-radius: 4px;
                                font-size: 14px;
                                background: white;
                                cursor: pointer;
                                margin-bottom: 10px;
                            " />
                            <button id="copyLinkBtn" class="btn btn-primary" style="width: 100%; padding: 10px;">
                                📋 Copy Link and Open Manually
                            </button>
                            <p style="font-size: 12px; color: #856404; margin: 10px 0 0 0;">
                                Click to copy, then paste in your browser's address bar
                            </p>
                        </div>
                        
                        <div class="alternative-method" style="margin-bottom: 15px; padding: 15px; background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #0c5460;">📱 Method 2: QR Code</h4>
                            <button id="showQrAlternative" class="btn btn-secondary" style="width: 100%; padding: 10px;">
                                📱 Generate QR Code for Mobile Payment
                            </button>
                            <p style="font-size: 12px; color: #0c5460; margin: 10px 0 0 0;">
                                Scan with your phone's camera or UPI app
                            </p>
                        </div>
                        
                        <div class="alternative-method" style="margin-bottom: 15px; padding: 15px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #721c24;">⚙️ Method 3: Allow Popups</h4>
                            <p style="font-size: 14px; color: #721c24; margin: 0 0 10px 0;">
                                1. Look for a popup blocker icon in your address bar<br>
                                2. Click it and select "Always allow popups from this extension"<br>
                                3. Refresh this extension and try again
                            </p>
                            <button id="retryAfterPopupAllow" class="btn btn-primary" style="width: 100%; padding: 10px;">
                                🔄 Try Opening Payment Page Again
                            </button>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                        <p style="font-size: 12px; color: #666; margin: 0;">
                            <strong>Why does this happen?</strong><br>
                            Browsers block popups by default for security. This is normal behavior.
                            Any of the above methods will work to complete your payment.
                        </p>
                    </div>
                </div>
            `;
            
            qrCodeDiv.innerHTML = alternativesHTML;
            
            // Setup event listeners for alternatives
            this.setupPopupAlternativeListeners(subscriptionUrl);
        }
    }

    setupPopupAlternativeListeners(subscriptionUrl) {
        // Copy link functionality
        const copyInput = document.getElementById('manualCopyInput');
        const copyBtn = document.getElementById('copyLinkBtn');
        
        if (copyInput && copyBtn) {
            const copyFunction = () => {
                copyInput.select();
                copyInput.setSelectionRange(0, 99999); // For mobile devices
                
                try {
                    document.execCommand('copy');
                    copyBtn.textContent = '✅ Copied! Open in Browser';
                    copyBtn.style.background = '#28a745';
                    copyInput.style.background = '#e8f5e8';
                    
                    setTimeout(() => {
                        copyBtn.textContent = '📋 Copy Link and Open Manually';
                        copyBtn.style.background = '';
                        copyInput.style.background = 'white';
                    }, 3000);
                    
                    this.showNotification('Link Copied', 'Paste the link in your browser to complete payment.');
                } catch (err) {
                    console.error('Copy failed:', err);
                    // Fallback: select the text for manual copy
                    copyInput.focus();
                    copyInput.select();
                    this.showNotification('Please Copy Manually', 'Select all text and copy it manually.');
                }
            };
            
            copyInput.addEventListener('click', copyFunction);
            copyBtn.addEventListener('click', copyFunction);
        }

        // QR code alternative
        const qrBtn = document.getElementById('showQrAlternative');
        if (qrBtn) {
            qrBtn.addEventListener('click', () => {
                this.generateUpiQrCode(subscriptionUrl);
            });
        }

        // Retry popup
        const retryBtn = document.getElementById('retryAfterPopupAllow');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                try {
                    const newWindow = window.open(subscriptionUrl, '_blank', 'noopener,noreferrer');
                    if (newWindow) {
                        this.showNotification('Success!', 'Payment page opened successfully.');
                    } else {
                        this.showNotification('Still Blocked', 'Popups are still blocked. Please use the copy link method above.');
                    }
                } catch (error) {
                    this.showNotification('Still Blocked', 'Please use the copy link method above.');
                }
            });
        }
    }

    async generateUpiQrCode(subscriptionUrl) {
        try {
            const qrContainer = document.getElementById('qrCodeContainer');
            const qrDisplay = document.getElementById('qrCodeDisplay');
            
            if (!qrContainer || !qrDisplay) return;
            
            // Show loading
            qrDisplay.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin-top: 15px;">Generating QR Code...</p>
                </div>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            `;
            
            qrContainer.style.display = 'block';
            
            // Generate QR code using a QR code service
            const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(subscriptionUrl)}`;
            
            // Create QR code display
            const qrHtml = `
                <div style="text-align: center;">
                    <h4 style="margin-bottom: 15px;">📱 Scan with any UPI app</h4>
                    <img src="${qrCodeUrl}" alt="Payment QR Code" style="width: 200px; height: 200px; border: 1px solid #ddd;" />
                    <p style="margin-top: 15px; font-size: 14px; color: #666;">
                        Scan this QR code with GPay, PhonePe, Paytm, or any UPI app
                    </p>
                    <div style="margin-top: 15px;">
                        <button id="hideQrCode" class="btn btn-secondary" style="padding: 8px 16px;">Hide QR Code</button>
                    </div>
                </div>
            `;
            
            qrDisplay.innerHTML = qrHtml;
            
            // Add hide QR code functionality
            const hideQrBtn = document.getElementById('hideQrCode');
            if (hideQrBtn) {
                hideQrBtn.addEventListener('click', () => {
                    qrContainer.style.display = 'none';
                });
            }
            
            console.log('AutoScroll Popup: QR code generated for URL:', subscriptionUrl);
            
        } catch (error) {
            console.error('AutoScroll Popup: Failed to generate QR code:', error);
            const qrDisplay = document.getElementById('qrCodeDisplay');
            if (qrDisplay) {
                qrDisplay.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #e74c3c;">
                        <p>Failed to generate QR code. Please use the payment link instead.</p>
                    </div>
                `;
            }
        }
    }

    showMandateQR(qrData) {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const qrCodeDiv = document.getElementById('mandateQrCode');

        if (upiSection) upiSection.style.display = 'none';
        if (qrSection) qrSection.style.display = 'block';
        
        if (qrCodeDiv && qrData) {
            let qrHTML = '';
            
            // Check if qrData is a data URL (QR code image)
            if (qrData.startsWith('data:image')) {
                qrHTML = `
                    <div style="text-align: center;">
                        <img src="${qrData}" alt="UPI Mandate QR Code" style="width: 200px; height: 200px; margin-bottom: 10px;">
                        <p style="font-size: 12px; color: #666;">Scan QR code with any UPI app to setup autopay</p>
                    </div>
                `;
            } 
            // Check if qrData is a payment link URL
            else if (qrData.startsWith('http')) {
                qrHTML = `
                    <div style="text-align: center;">
                        <p style="margin-bottom: 15px;">Click the button below to setup UPI autopay:</p>
                        <a href="${qrData}" target="_blank" style="
                            display: inline-block;
                            background: #007cba;
                            color: white;
                            padding: 12px 24px;
                            text-decoration: none;
                            border-radius: 5px;
                            font-weight: bold;
                        ">Setup UPI Autopay</a>
                        <p style="font-size: 12px; color: #666; margin-top: 10px;">Or copy this link: <br><span style="word-break: break-all;">${qrData}</span></p>
                    </div>
                `;
            }
            // Fallback for other formats
            else {
                qrHTML = `
                    <div style="text-align: center;">
                        <p>Payment Setup Required</p>
                        <p style="font-size: 12px; color: #666; word-break: break-all;">${qrData}</p>
                    </div>
                `;
            }
            
            qrCodeDiv.innerHTML = qrHTML;
        } else if (qrCodeDiv) {
            qrCodeDiv.innerHTML = `<p style="text-align: center;">QR Code will be generated when ready</p>`;
        }
    }

    startMandateStatusCheck() {
        this.clearMandateCheckInterval();
        
        this.mandateCheckInterval = setInterval(async () => {
            await this.checkMandateStatus();
        }, 5000); // Check every 5 seconds

        // Stop checking after 10 minutes
        setTimeout(() => {
            this.clearMandateCheckInterval();
        }, 600000);
    }

    async checkMandateStatus() {
        if (!this.currentMandateId) return;

        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success) {
                this.updateMandateStatus(result.data);
                
                if (result.data.status === 'ACTIVE') {
                    // AutoPay is active, subscription successful
                    this.clearMandateCheckInterval();
                    await this.loadSubscriptionData(); // Refresh subscription data
                    this.closePaymentModal();
                    this.updateSubscriptionInfo();
                    this.showNotification('Success!', 'Your AutoPay subscription is now active!');
                }
            }

        } catch (error) {
            console.error('AutoScroll Popup: Status check error:', error);
        }
    }

    updateMandateStatus(statusData) {
        const statusSection = document.getElementById('mandateStatus');
        const statusTitle = document.getElementById('mandateStatusTitle');
        const statusText = document.getElementById('mandateStatusText');
        const mandateDetails = document.getElementById('mandateDetails');

        if (statusSection) statusSection.style.display = 'block';
        if (statusTitle) statusTitle.textContent = 'AutoPay Subscription Status';
        
        // Enhanced status text with icons
        const statusIcon = this.getStatusIcon(statusData.status);
        if (statusText) statusText.textContent = `${statusIcon} Status: ${statusData.status.toUpperCase()}`;
        
        if (mandateDetails) {
            // Calculate next payment info
            const nextPaymentInfo = this.getNextPaymentInfo(statusData);
            
            mandateDetails.innerHTML = `
                <p><strong>Subscription ID:</strong></p>
                <p class="mandate-id">${statusData.subscriptionId || statusData.mandateId}</p>
                <p><strong>Amount:</strong> ₹${statusData.amount}/month</p>
                <p><strong>Status:</strong> ${statusData.status.toUpperCase()}</p>
                ${statusData.frequency ? `<p><strong>Billing Cycle:</strong> ${statusData.frequency}</p>` : ''}
                ${nextPaymentInfo}
                ${statusData.lastChargedDate ? `<p><strong>Last Payment:</strong> ${new Date(statusData.lastChargedDate).toLocaleDateString()}</p>` : ''}
                ${statusData.endDate ? `<p><strong>Valid Until:</strong> ${new Date(statusData.endDate).toLocaleDateString()}</p>` : ''}
                
                <div class="mandate-actions">
                    ${this.getMandateActionButtons(statusData.status)}
                </div>
            `;
            
            // Setup action button listeners
            this.setupMandateActionListeners();
        }
    }

    getStatusIcon(status) {
        const icons = {
            'active': '✅',
            'ACTIVE': '✅',
            'pending': '⏳',
            'PENDING': '⏳',
            'cancelled': '❌',
            'CANCELLED': '❌',
            'paused': '⏸️',
            'PAUSED': '⏸️',
            'expired': '⏰',
            'EXPIRED': '⏰'
        };
        return icons[status] || '❓';
    }

    getNextPaymentInfo(statusData) {
        if ((statusData.status.toLowerCase() === 'active' || statusData.status === 'ACTIVE') && statusData.nextChargeDate) {
            const nextDate = new Date(statusData.nextChargeDate);
            const today = new Date();
            const diffTime = nextDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 0) {
                return `<p><strong>Next Payment:</strong> ${nextDate.toLocaleDateString()} (in ${diffDays} days)</p>`;
            } else if (diffDays === 0) {
                return `<p><strong>Next Payment:</strong> Today (${nextDate.toLocaleDateString()})</p>`;
            } else {
                return `<p><strong>Next Payment:</strong> Overdue (${nextDate.toLocaleDateString()})</p>`;
            }
        } else if (statusData.status.toLowerCase() === 'pending') {
            return `<p><strong>Action Required:</strong> Complete payment to activate subscription</p>`;
        }
        return '';
    }

    getMandateActionButtons(status) {
        const statusLower = status.toLowerCase();
        
        if (statusLower === 'active' || status === 'ACTIVE') {
            return `
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Refresh Status</button>
                <button id="cancelActiveMandateBtn" class="btn btn-danger">❌ Cancel Subscription</button>
            `;
        } else if (statusLower === 'pending' || status === 'PENDING') {
            return `
                <button id="completePendingMandateBtn" class="btn btn-primary">💳 Complete Payment</button>
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Check Status</button>
                <button id="cancelPendingMandateBtn" class="btn btn-danger">❌ Cancel</button>
            `;
        } else if (statusLower === 'cancelled' || status === 'CANCELLED') {
            return `
                <button id="createNewMandateBtn" class="btn btn-primary">➕ Create New Subscription</button>
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Refresh Status</button>
            `;
        } else if (statusLower === 'paused' || status === 'PAUSED') {
            return `
                <button id="resumeMandateBtn" class="btn btn-primary">▶️ Resume Subscription</button>
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Refresh Status</button>
                <button id="cancelPausedMandateBtn" class="btn btn-danger">❌ Cancel</button>
            `;
        } else {
            return `
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Refresh Status</button>
                <button id="contactSupportBtn" class="btn btn-secondary">🆘 Contact Support</button>
            `;
        }
    }

    setupMandateActionListeners() {
        // Refresh status button
        const refreshBtn = document.getElementById('refreshMandateStatus');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.checkMandateStatus());
        }

        // Cancel active mandate
        const cancelActiveBtn = document.getElementById('cancelActiveMandateBtn');
        if (cancelActiveBtn) {
            cancelActiveBtn.addEventListener('click', () => this.cancelMandate());
        }

        // Cancel pending mandate
        const cancelPendingBtn = document.getElementById('cancelPendingMandateBtn');
        if (cancelPendingBtn) {
            cancelPendingBtn.addEventListener('click', () => this.cancelMandate());
        }

        // Cancel paused mandate
        const cancelPausedBtn = document.getElementById('cancelPausedMandateBtn');
        if (cancelPausedBtn) {
            cancelPausedBtn.addEventListener('click', () => this.cancelMandate());
        }

        // Complete pending payment
        const completePendingBtn = document.getElementById('completePendingMandateBtn');
        if (completePendingBtn) {
            completePendingBtn.addEventListener('click', () => this.handlePendingPaymentCompletion());
        }

        // Create new mandate
        const createNewBtn = document.getElementById('createNewMandateBtn');
        if (createNewBtn) {
            createNewBtn.addEventListener('click', () => this.resetToCreateNewMandate());
        }

        // Resume mandate
        const resumeBtn = document.getElementById('resumeMandateBtn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => this.resumeMandate());
        }

        // Contact support
        const contactSupportBtn = document.getElementById('contactSupportBtn');
        if (contactSupportBtn) {
            contactSupportBtn.addEventListener('click', () => {
                window.open('mailto:support@example.com?subject=AutoScroll Extension Support', '_blank');
            });
        }
    }

    async resumeMandate() {
        const userId = this.userData?.userId;
        if (!userId) {
            this.showError('Please login first');
            return;
        }

        const confirmResume = confirm('Do you want to resume your AutoPay subscription?');
        if (!confirmResume) return;

        try {
            this.showLoading('Resume feature coming soon...');

            // Note: Resume functionality not yet implemented in AutoPay system
            // TODO: Implement resume functionality in upi-autopay routes
            throw new Error('Resume functionality not yet available in the new AutoPay system. Please contact support.');

            const response = await fetch(`${this.API_BASE}/upi-autopay/resume/${this.currentMandateId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ userId })
            });

            const result = await response.json();

            if (result.success) {
                this.showNotification('Success', 'Subscription resumed successfully! 🎉');
                // Refresh mandate status
                setTimeout(() => this.checkMandateStatus(), 1000);
            } else {
                this.showError(result.message || 'Failed to resume subscription');
            }
        } catch (error) {
            console.error('Resume mandate error:', error);
            this.showError('Failed to resume subscription. Please try again.');
        } finally {
            this.hideLoading();
        }
    }

    async verifySubscriptionStatus(subscriptionId) {
        try {
            console.log('AutoScroll Popup: Verifying subscription status:', subscriptionId);
            
            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/verify-subscription/${subscriptionId}`);
            const result = await response.json();

            if (result.success) {
                console.log('AutoScroll Popup: Subscription verification result:', result.data);
                
                if (result.data.shortUrl && !result.data.hasShortUrl) {
                    // URL became available, update the UI
                    this.showAutopayLink(result.data.shortUrl);
                    this.startMandateStatusCheck();
                } else if (!result.data.hasShortUrl) {
                    console.warn('AutoScroll Popup: Subscription verification shows no URL available');
                    this.showSubscriptionConfigError(result.data.debugInfo);
                }
            } else {
                console.error('AutoScroll Popup: Subscription verification failed:', result);
            }

        } catch (error) {
            console.error('AutoScroll Popup: Subscription verification error:', error);
        }
    }

    showSubscriptionConfigError(debugInfo) {
        const qrCodeDiv = document.getElementById('mandateQrCode');
        
        if (qrCodeDiv) {
            const errorHTML = `
                <div style="text-align: center;">
                    <h3>⚠️ Subscription Configuration Issue</h3>
                    <p style="margin-bottom: 15px;">There seems to be an issue with the payment link generation.</p>
                    
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 15px; margin: 15px 0; text-align: left;">
                        <h4 style="margin: 0 0 10px 0; color: #856404;">Possible Causes:</h4>
                        <ul style="margin: 0; padding-left: 20px; color: #856404; font-size: 14px;">
                            <li>Payment system is temporarily unavailable</li>
                            <li>Subscription plan configuration needs updating</li>
                            <li>Network connectivity issues</li>
                        </ul>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <button id="retrySubscriptionCreation" class="btn btn-primary" style="margin-right: 10px;">
                            🔄 Try Again
                        </button>
                        <button id="contactSupportBtn" class="btn btn-secondary">
                            🆘 Contact Support
                        </button>
                    </div>
                    
                    <p style="font-size: 12px; color: #666; margin-top: 15px;">
                        If the issue persists, please contact our support team.
                    </p>
                </div>
            `;
            
            qrCodeDiv.innerHTML = errorHTML;
            
            // Add event listeners
            const retryBtn = document.getElementById('retrySubscriptionCreation');
            const supportBtn = document.getElementById('contactSupportBtn');
            
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    this.resetToCreateNewMandate();
                    // Auto-retry after a short delay
                    setTimeout(() => {
                        this.createUpiMandate();
                    }, 1000);
                });
            }
            
            if (supportBtn) {
                supportBtn.addEventListener('click', () => {
                    window.open('mailto:support@autoscrollextension.com?subject=Payment Link Issue&body=I am having trouble with the subscription payment link. Please help.', '_blank');
                });
            }
        }
    }

    resetToCreateNewMandate() {
        // Reset UI to allow creating a new mandate
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const statusSection = document.getElementById('mandateStatus');

        if (upiSection) upiSection.style.display = 'block';
        if (qrSection) qrSection.style.display = 'none';
        if (statusSection) statusSection.style.display = 'none';

        // Clear current mandate ID
        this.currentMandateId = null;
        
        // Clear UPI input
        const upiInput = document.getElementById('userUpiId');
        if (upiInput) upiInput.value = '';

        this.showNotification('Ready', 'You can now create a new subscription.');
    }

    clearMandateCheckInterval() {
        if (this.mandateCheckInterval) {
            clearInterval(this.mandateCheckInterval);
            this.mandateCheckInterval = null;
        }
    }

    async cancelMandate() {
        if (!this.currentMandateId) return;

        if (!confirm('Are you sure you want to cancel your AutoPay subscription?')) {
            return;
        }

        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/cancel/${userData.backendUserId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success) {
                await this.loadSubscriptionData(); // Refresh subscription data
                this.closePaymentModal();
                this.updateSubscriptionInfo();
                this.showNotification('Cancelled', 'Your AutoPay subscription has been cancelled');
            } else {
                throw new Error(result.message || 'Failed to cancel subscription');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Cancel error:', error);
            this.showError('Failed to cancel subscription: ' + error.message);
        }
    }

    async updateSetting(key, value) {
        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            const settings = {};
            settings[key] = value;

            const response = await fetch(`${this.API_BASE_URL}/auth/settings/${userData.backendUserId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                },
                body: JSON.stringify({ settings })
            });

            const result = await response.json();

            if (result.success) {
                console.log('AutoScroll Popup: Setting updated:', key, value);
            }

        } catch (error) {
            console.error('AutoScroll Popup: Settings update error:', error);
        }
    }

    isValidUpiId(upiId) {
        const upiRegex = /^[a-zA-Z0-9.-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{2,64}$/;
        return upiRegex.test(upiId);
    }

    showNotification(title, message) {
        // Create a simple notification
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.innerHTML = `
            <strong>${title}</strong><br>
            ${message}
        `;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
            max-width: 300px;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showSuccess(message) {
        // Show success notification
        this.showNotification('Success', message);
    }

    showError(message) {
        // Create a simple error notification
        const notification = document.createElement('div');
        notification.className = 'notification error';
        notification.innerHTML = `
            <strong>Error</strong><br>
            ${message}
        `;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
            max-width: 300px;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 7000);
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AutoScrollPopup();
});

// Handle tab updates to sync state
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        // Re-sync AutoScroll state when tab is updated
        if (window.autoScrollPopup) {
            window.autoScrollPopup.syncAutoScrollState();
        }
    }
});

console.log('AutoScroll Popup: Script loaded');
