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
            
            // Check for existing mandates when opening modal
            await this.checkForExistingMandatesOnOpen();
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

    async checkForExistingMandatesOnOpen() {
        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            if (!userData.backendUserId || !userData.authData) {
                return; // User not authenticated
            }

            const response = await fetch(`https://autoscrollextension.onrender.com/api/upi-mandates/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success && result.data.hasMandate) {
                // User has existing mandate, show it
                this.currentMandateId = result.data.mandateId;
                this.handleExistingMandateOnOpen(result.data);
            }

        } catch (error) {
            console.log('AutoScroll Popup: Could not check existing mandates:', error.message);
            // Don't show error to user, just proceed with normal flow
        }
    }

    handleExistingMandateOnOpen(mandateData) {
        const upiSection = document.getElementById('upiInputSection');
        const statusSection = document.getElementById('mandateStatus');

        // Hide UPI input and show existing mandate
        if (upiSection) upiSection.style.display = 'none';
        if (statusSection) statusSection.style.display = 'block';

        // Show existing mandate information
        this.updateMandateStatus(mandateData);
        
        console.log('AutoScroll Popup: Found existing mandate:', mandateData.mandateId);
    }

    closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.clearMandateCheckInterval();
    }

    async createUpiMandate() {
        const upiId = document.getElementById('userUpiId').value.trim();
        
        if (!upiId) {
            this.showError('Please enter a valid UPI ID');
            return;
        }

        if (!this.isValidUpiId(upiId)) {
            this.showError('Please enter a valid UPI ID (e.g., yourname@paytm)');
            return;
        }

        try {
            console.log('AutoScroll Popup: Creating UPI mandate for:', upiId);

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

            const response = await fetch('https://autoscrollextension.onrender.com/api/upi-mandates/create-mandate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                },
                body: JSON.stringify({
                    userId: userData.backendUserId,
                    userUpiId: upiId,
                    amount: 9 // Optional: specify amount, defaults to CONFIG.subscriptionPrice
                })
            });

            const result = await response.json();

            if (result.success) {
                this.currentMandateId = result.data.mandateId;
                
                // Handle Razorpay mandate response
                if (result.data.qrCodeImage) {
                    // Use the data URL QR code image
                    this.showMandateQR(result.data.qrCodeImage);
                    this.startMandateStatusCheck();
                } else if (result.data.qrCodeData || result.data.paymentUrl) {
                    // Use the payment URL as fallback
                    this.showMandateQR(result.data.qrCodeData || result.data.paymentUrl);
                    this.startMandateStatusCheck();
                } else {
                    // Test mode or simple mandate
                    console.log('AutoScroll Popup: Test mandate created:', result.data);
                    this.showNotification('Test Mode', 'Test mandate created successfully. In production, a QR code would be displayed.');
                }
                
                // Show instructions if available
                if (result.data.instructions) {
                    console.log('AutoScroll Popup: Instructions:', result.data.instructions);
                }
            } else {
                // Check if it's an existing mandate error
                if (result.message && result.message.includes('already has an active mandate') && result.data) {
                    // User has existing mandate, show management options
                    this.handleExistingMandate(result.data);
                } else {
                    throw new Error(result.message || 'Failed to create mandate');
                }
            }

        } catch (error) {
            console.error('AutoScroll Popup: Mandate creation error:', error);
            this.showError('Failed to create subscription: ' + error.message);
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
            
            const response = await fetch(`https://autoscrollextension.onrender.com/api/upi-mandates/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success && result.data.hasMandate) {
                if (result.data.qrCodeImage || result.data.qrCodeData || result.data.paymentUrl) {
                    // Show QR code or payment link if available
                    const paymentData = result.data.qrCodeImage || result.data.qrCodeData || result.data.paymentUrl;
                    this.showMandateQR(paymentData);
                    this.startMandateStatusCheck();
                    this.showNotification('Payment Required', 'Please complete the payment to activate your subscription.');
                } else {
                    this.showError('Payment completion option not available. The mandate may have expired. Please try creating a new subscription.');
                }
            } else {
                this.showError('Could not retrieve mandate details. Please try creating a new subscription.');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Pending payment completion error:', error);
            this.showError('Failed to retrieve payment details: ' + error.message);
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
            
            const response = await fetch(`https://autoscrollextension.onrender.com/api/upi-mandates/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success) {
                this.updateMandateStatus(result.data);
                
                if (result.data.status === 'active') {
                    // Mandate is active, subscription successful
                    this.clearMandateCheckInterval();
                    await this.loadSubscriptionData(); // Refresh subscription data
                    this.closePaymentModal();
                    this.updateSubscriptionInfo();
                    this.showNotification('Success!', 'Your subscription is now active!');
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
        if (statusTitle) statusTitle.textContent = 'Subscription Status';
        
        // Enhanced status text with icons
        const statusIcon = this.getStatusIcon(statusData.status);
        if (statusText) statusText.textContent = `${statusIcon} Status: ${statusData.status.toUpperCase()}`;
        
        if (mandateDetails) {
            // Calculate next payment info
            const nextPaymentInfo = this.getNextPaymentInfo(statusData);
            
            mandateDetails.innerHTML = `
                <p><strong>Mandate ID:</strong></p>
                <p class="mandate-id">${statusData.mandateId}</p>
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
            'pending': '⏳',
            'cancelled': '❌',
            'paused': '⏸️',
            'expired': '⏰'
        };
        return icons[status.toLowerCase()] || '❓';
    }

    getNextPaymentInfo(statusData) {
        if (statusData.status.toLowerCase() === 'active' && statusData.nextChargeDate) {
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
        
        if (statusLower === 'active') {
            return `
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Refresh Status</button>
                <button id="cancelActiveMandateBtn" class="btn btn-danger">❌ Cancel Subscription</button>
            `;
        } else if (statusLower === 'pending') {
            return `
                <button id="completePendingMandateBtn" class="btn btn-primary">💳 Complete Payment</button>
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Check Status</button>
                <button id="cancelPendingMandateBtn" class="btn btn-danger">❌ Cancel</button>
            `;
        } else if (statusLower === 'cancelled') {
            return `
                <button id="createNewMandateBtn" class="btn btn-primary">➕ Create New Subscription</button>
                <button id="refreshMandateStatus" class="btn btn-secondary">🔄 Refresh Status</button>
            `;
        } else if (statusLower === 'paused') {
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
            this.showLoading('Resuming subscription...');

            const response = await fetch(`${this.API_BASE}/upi-mandates/resume-mandate`, {
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

        if (!confirm('Are you sure you want to cancel your subscription?')) {
            return;
        }

        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            const response = await fetch(`https://autoscrollextension.onrender.com/api/upi-mandates/cancel-mandate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                },
                body: JSON.stringify({
                    userId: userData.backendUserId,
                    mandateId: this.currentMandateId
                })
            });

            const result = await response.json();

            if (result.success) {
                await this.loadSubscriptionData(); // Refresh subscription data
                this.closePaymentModal();
                this.updateSubscriptionInfo();
                this.showNotification('Cancelled', 'Your subscription has been cancelled');
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

            const response = await fetch(`https://autoscrollextension.onrender.com/api/auth/settings/${userData.backendUserId}`, {
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
