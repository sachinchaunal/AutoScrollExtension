/**
 * AutoScroll Popup - Simplified Razorpay Version
 * Clean implementation with simple subscription system
 */

class AutoScrollPopup {
    constructor() {
        this.isActive = false;
        this.currentUser = null;
        this.subscriptionData = null;
        this.googleAuth = new GoogleAuth();
        this.isAuthenticated = false;
        this.subscriptionMonitor = null;
        
        // Universal API base URL that works across environments
        this.API_BASE_URL = 'https://autoscrollextension.onrender.com/api';
        
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
            } else {
                console.log('AutoScroll Popup: No subscription data available');
                this.subscriptionData = null;
            }
        } catch (error) {
            console.error('AutoScroll Popup: Failed to load subscription data:', error);
            this.subscriptionData = null;
        }
    }

    async forceRefreshStatus() {
        console.log('AutoScroll Popup: Force refreshing status...');
        
        try {
            this.showLoading(true);
            
            // Refresh auth status
            await this.checkAuthStatus();
            
            // Force refresh subscription status from server
            if (this.isAuthenticated && this.currentUser) {
                const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
                
                if (userData.backendUserId && userData.authData) {
                    try {
                        // Check subscription status from server
                        const response = await fetch(`${this.API_BASE_URL}/upi-autopay/status/${userData.backendUserId}`, {
                            headers: {
                                'Authorization': `Bearer ${userData.authData.token}`
                            }
                        });

                        const result = await response.json();
                        
                        if (result.success) {
                            // Update local subscription data
                            await chrome.storage.local.set({
                                subscriptionData: result.data
                            });
                            
                            // Reload subscription data
                            await this.loadSubscriptionData();
                        }
                    } catch (error) {
                        console.log('AutoScroll Popup: Server status check failed:', error.message);
                    }
                }
            }
            
            // Update UI
            await this.updateUI();
            
            this.showNotification('Refreshed', 'Status updated successfully');
            
        } catch (error) {
            console.error('AutoScroll Popup: Force refresh failed:', error);
            this.showError('Failed to refresh status');
        } finally {
            this.showLoading(false);
        }
    }

    async syncAutoScrollState() {
        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab || !this.isSupportedPlatform(tab.url)) {
                this.isActive = false;
                return;
            }

            // Send message to content script to get current state
            const response = await chrome.tabs.sendMessage(tab.id, { 
                action: 'getState' 
            }).catch(() => ({ isActive: false }));

            this.isActive = response?.isActive || false;
            console.log('AutoScroll Popup: Synced state - isActive:', this.isActive);
            
        } catch (error) {
            console.log('AutoScroll Popup: Could not sync state:', error.message);
            this.isActive = false;
        }
    }

    setupEventListeners() {
        // Login button
        const loginBtn = document.getElementById('loginBtn');
        if (loginBtn) {
            loginBtn.addEventListener('click', () => this.handleGoogleLogin());
        }

        // Logout button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Toggle AutoScroll button
        const toggleBtn = document.getElementById('toggleAutoScroll');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleAutoScroll());
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshStatus');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.forceRefreshStatus());
        }

        // AutoScroll controls
        const startBtn = document.getElementById('startAutoScroll');
        const stopBtn = document.getElementById('stopAutoScroll');
        
        if (startBtn) {
            startBtn.addEventListener('click', () => this.toggleAutoScroll());
        }
        
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.toggleAutoScroll());
        }

        // Premium/Payment buttons
        const upgradeBtn = document.getElementById('upgradeBtn');
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => this.openPaymentModal());
        }

        // Payment modal setup
        this.setupPaymentModalEvents();
        
        // Settings
        this.setupSettingsEvents();
    }

    setupPaymentModalEvents() {
        // Create Mandate button
        const createMandateBtn = document.getElementById('createMandateBtn');
        if (createMandateBtn) {
            createMandateBtn.addEventListener('click', () => this.createSubscription());
        }

        // Close modal buttons
        const closeModal = document.getElementById('closeModal');
        const paymentModal = document.getElementById('paymentModal');
        
        if (closeModal) {
            closeModal.addEventListener('click', () => this.closePaymentModal());
        }
        
        if (paymentModal) {
            paymentModal.addEventListener('click', (e) => {
                if (e.target === paymentModal) {
                    this.closePaymentModal();
                }
            });
        }
    }

    setupSettingsEvents() {
        // Speed control
        const speedSlider = document.getElementById('scrollSpeed');
        if (speedSlider) {
            speedSlider.addEventListener('input', (e) => {
                this.updateSettings('autoScrollSpeed', parseInt(e.target.value));
            });
        }

        // Other settings can be added here
    }

    async updateUI() {
        if (this.isAuthenticated && this.currentUser) {
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
        const loader = document.getElementById('loadingIndicator');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }

    updateUserInfo() {
        if (!this.currentUser) return;

        const userEmail = document.getElementById('userEmail');
        const userName = document.getElementById('userName');
        const userAvatar = document.getElementById('userAvatar');

        if (userEmail) userEmail.textContent = this.currentUser.email;
        if (userName) userName.textContent = this.currentUser.name || 'User';
        if (userAvatar && this.currentUser.picture) {
            userAvatar.src = this.currentUser.picture;
        }
    }

    updateSubscriptionInfo() {
        const subscriptionInfo = document.getElementById('subscriptionInfo');
        const upgradeSection = document.getElementById('upgradeSection');

        if (!subscriptionInfo) return;

        if (this.subscriptionData && this.subscriptionData.hasActiveSubscription) {
            subscriptionInfo.innerHTML = `
                <div class="subscription-active">
                    <h3>✅ Premium Active</h3>
                    <p>Status: ${this.subscriptionData.subscriptionStatus || 'Active'}</p>
                    ${this.subscriptionData.nextBillingDate ? `<p>Next billing: ${new Date(this.subscriptionData.nextBillingDate).toLocaleDateString()}</p>` : ''}
                    <p>Enjoying unlimited AutoScroll!</p>
                </div>
            `;
            
            if (upgradeSection) {
                upgradeSection.style.display = 'none';
            }
        } else {
            subscriptionInfo.innerHTML = `
                <div class="subscription-inactive">
                    <h3>💡 Free Trial</h3>
                    <p>Upgrade to Premium for unlimited AutoScroll access</p>
                    <ul>
                        <li>✅ Unlimited usage</li>
                        <li>✅ All platforms supported</li>
                        <li>✅ Priority support</li>
                    </ul>
                </div>
            `;
            
            if (upgradeSection) {
                upgradeSection.style.display = 'block';
            }
        }
    }

    updateAutoScrollStatus() {
        const statusElement = document.getElementById('autoScrollStatus');
        const toggleBtn = document.getElementById('toggleAutoScroll');
        const startBtn = document.getElementById('startAutoScroll');
        const stopBtn = document.getElementById('stopAutoScroll');

        if (statusElement) {
            statusElement.innerHTML = this.isActive 
                ? '<span class="status-active">🟢 AutoScroll Active</span>'
                : '<span class="status-inactive">⚪ AutoScroll Inactive</span>';
        }

        if (toggleBtn) {
            toggleBtn.textContent = this.isActive ? 'Stop AutoScroll' : 'Start AutoScroll';
            toggleBtn.className = this.isActive ? 'btn btn-danger' : 'btn btn-primary';
        }

        if (startBtn) startBtn.style.display = this.isActive ? 'none' : 'inline-block';
        if (stopBtn) stopBtn.style.display = this.isActive ? 'inline-block' : 'none';
    }

    async handleGoogleLogin() {
        try {
            console.log('AutoScroll Popup: Starting Google login...');
            this.showLoading(true);

            // Start Google OAuth flow
            const authResult = await this.googleAuth.startAuthFlow();
            
            if (authResult.success) {
                console.log('AutoScroll Popup: Google login successful');
                
                // Update local state
                this.isAuthenticated = true;
                this.currentUser = authResult.user;
                
                // Load subscription data
                await this.loadSubscriptionData();
                
                // Update UI
                await this.updateUI();
                
                this.showNotification('Welcome!', `Logged in as ${this.currentUser.name || this.currentUser.email}`);
                
            } else {
                throw new Error(authResult.error || 'Authentication failed');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Login failed:', error);
            this.showError('Login failed: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async handleLogout() {
        try {
            console.log('AutoScroll Popup: Logging out...');
            this.showLoading(true);

            // Clear local state first
            this.isAuthenticated = false;
            this.currentUser = null;
            this.subscriptionData = null;

            // Update UI immediately
            this.showLoginScreen();

            // Clear storage
            await chrome.storage.local.clear();
            
            // Perform Google logout
            await this.googleAuth.logout();
            
            // Send logout message to background script
            await chrome.runtime.sendMessage({ action: 'logout' });

            this.showNotification('Logged out', 'You have been logged out successfully');

        } catch (error) {
            console.error('AutoScroll Popup: Logout error:', error);
            this.showError('Logout failed: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async toggleAutoScroll() {
        try {
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                this.showError('No active tab found');
                return;
            }

            if (!this.isSupportedPlatform(tab.url)) {
                this.showError('AutoScroll is not supported on this website');
                return;
            }

            // Check if user has access
            if (!this.isAuthenticated) {
                this.showError('Please log in to use AutoScroll');
                return;
            }

            // Send toggle message to content script
            const response = await chrome.tabs.sendMessage(tab.id, { 
                action: 'toggle',
                hasSubscription: this.subscriptionData?.hasActiveSubscription || false
            });

            if (response && response.success) {
                this.isActive = response.isActive;
                this.updateAutoScrollStatus();
                
                console.log('AutoScroll Popup: Toggle successful, new state:', this.isActive);
                
                if (response.message) {
                    this.showNotification('AutoScroll', response.message);
                }
            } else {
                throw new Error(response?.error || 'Failed to toggle AutoScroll');
            }

        } catch (error) {
            console.error('AutoScroll Popup: Toggle failed:', error);
            this.showError('Failed to toggle AutoScroll: ' + error.message);
        }
    }

    isSupportedPlatform(url) {
        if (!url) return false;
        
        const supportedDomains = ['youtube.com', 'youtu.be'];
        return supportedDomains.some(domain => url.includes(domain));
    }

    // 💳 NEW SIMPLE PAYMENT SYSTEM
    async openPaymentModal() {
        const modal = document.getElementById('paymentModal');
        if (modal) {
            modal.style.display = 'flex';
            this.resetPaymentModal();
        }
    }

    resetPaymentModal() {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const statusSection = document.getElementById('mandateStatus');

        if (upiSection) upiSection.style.display = 'block';
        if (qrSection) qrSection.style.display = 'none';
        if (statusSection) statusSection.style.display = 'none';
    }

    async createSubscription() {
        try {
            console.log('🚀 Creating new subscription...');

            // Get user data
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            if (!userData.backendUserId || !userData.authData) {
                this.showError('Please log in again to continue.');
                return;
            }

            // Show loading
            this.showPaymentLoading(true);

            // Create subscription via backend
            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/create-subscription`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${userData.authData.token}`
                },
                body: JSON.stringify({
                    userId: userData.backendUserId
                })
            });

            const result = await response.json();

            if (result.success && result.data.subscriptionUrl) {
                console.log('✅ Subscription created successfully:', result.data.subscriptionId);
                
                // Open Razorpay checkout in new tab
                this.openRazorpayCheckout(result.data.subscriptionUrl);
                
                // Start monitoring subscription status
                this.startSubscriptionMonitoring(result.data.subscriptionId);
                
                // Show success message
                this.showPaymentSuccess(result.data);
                
            } else {
                throw new Error(result.message || 'Failed to create subscription');
            }

        } catch (error) {
            console.error('❌ Subscription creation failed:', error);
            this.showError(`Failed to create subscription: ${error.message}`);
        } finally {
            this.showPaymentLoading(false);
        }
    }

    openRazorpayCheckout(subscriptionUrl) {
        console.log('🔗 Opening Razorpay checkout:', subscriptionUrl);
        
        try {
            // Universal browser solution
            const newWindow = window.open(subscriptionUrl, '_blank', 'noopener,noreferrer');
            
            if (newWindow) {
                console.log('✅ Razorpay checkout opened successfully');
                this.showNotification('Payment Page Opened', 'Complete your payment in the new tab to activate AutoPay.');
            } else {
                // Popup blocked - show alternatives
                this.showPopupBlockedAlternatives(subscriptionUrl);
            }
        } catch (error) {
            console.error('❌ Failed to open checkout:', error);
            this.showPopupBlockedAlternatives(subscriptionUrl);
        }
    }

    showPopupBlockedAlternatives(subscriptionUrl) {
        const qrSection = document.getElementById('mandateQrSection');
        const qrCodeDiv = document.getElementById('mandateQrCode');

        if (qrSection) qrSection.style.display = 'block';
        
        if (qrCodeDiv) {
            qrCodeDiv.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <h3>🚫 Popup Blocked</h3>
                    <p style="margin-bottom: 20px;">Your browser blocked the payment page. Use one of these methods:</p>
                    
                    <div style="margin: 20px 0;">
                        <h4>📋 Method 1: Copy Payment Link</h4>
                        <input type="text" value="${subscriptionUrl}" readonly style="
                            width: 100%; padding: 10px; margin: 10px 0; 
                            border: 1px solid #ddd; border-radius: 4px;
                            font-size: 14px; cursor: pointer;
                        " onclick="this.select(); document.execCommand('copy'); this.style.background='#e8f5e8';" />
                        <p style="font-size: 12px; color: #666;">Click to copy, then paste in your browser</p>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <h4>📱 Method 2: QR Code</h4>
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(subscriptionUrl)}" 
                             alt="Payment QR Code" style="width: 200px; height: 200px; border: 1px solid #ddd;" />
                        <p style="font-size: 12px; color: #666;">Scan with your phone's camera</p>
                    </div>
                    
                    <button onclick="window.open('${subscriptionUrl}', '_blank')" 
                            style="background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer;">
                        🔄 Try Opening Again
                    </button>
                </div>
            `;
        }
    }

    startSubscriptionMonitoring(subscriptionId) {
        console.log('👀 Starting subscription monitoring for:', subscriptionId);
        
        // Check subscription status every 10 seconds
        this.subscriptionMonitor = setInterval(async () => {
            await this.checkSubscriptionStatus();
        }, 10000);

        // Stop monitoring after 10 minutes
        setTimeout(() => {
            if (this.subscriptionMonitor) {
                clearInterval(this.subscriptionMonitor);
                this.subscriptionMonitor = null;
            }
        }, 600000);
    }

    async checkSubscriptionStatus() {
        try {
            const userData = await chrome.storage.local.get(['backendUserId', 'authData']);
            
            if (!userData.backendUserId) return;

            const response = await fetch(`${this.API_BASE_URL}/upi-autopay/status/${userData.backendUserId}`, {
                headers: {
                    'Authorization': `Bearer ${userData.authData.token}`
                }
            });

            const result = await response.json();

            if (result.success && result.data.subscriptionStatus === 'active') {
                console.log('🎉 Subscription activated!');
                
                // Stop monitoring
                if (this.subscriptionMonitor) {
                    clearInterval(this.subscriptionMonitor);
                    this.subscriptionMonitor = null;
                }
                
                // Update local subscription data
                await this.loadSubscriptionData();
                this.updateSubscriptionInfo();
                
                // Close payment modal
                this.closePaymentModal();
                
                // Show success
                this.showNotification('Success!', 'Your AutoPay subscription is now active! 🎉');
            }

        } catch (error) {
            console.error('❌ Status check failed:', error);
        }
    }

    showPaymentLoading(show) {
        const createBtn = document.getElementById('createMandateBtn');
        if (createBtn) {
            if (show) {
                createBtn.disabled = true;
                createBtn.textContent = '⏳ Creating Subscription...';
            } else {
                createBtn.disabled = false;
                createBtn.textContent = 'Setup AutoPay Subscription';
            }
        }
    }

    showPaymentSuccess(data) {
        const upiSection = document.getElementById('upiInputSection');
        const qrSection = document.getElementById('mandateQrSection');
        const qrCodeDiv = document.getElementById('mandateQrCode');

        if (upiSection) upiSection.style.display = 'none';
        if (qrSection) qrSection.style.display = 'block';
        
        if (qrCodeDiv) {
            qrCodeDiv.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <h3>✅ Subscription Created!</h3>
                    <p style="margin-bottom: 20px;">
                        Your AutoPay subscription has been set up. 
                        Complete the payment to activate it.
                    </p>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin: 0 0 10px 0;">📋 Subscription Details</h4>
                        <p><strong>Amount:</strong> ₹${data.amount}/month</p>
                        <p><strong>Subscription ID:</strong> ${data.subscriptionId}</p>
                        <p><strong>Status:</strong> Waiting for payment</p>
                    </div>
                    
                    <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin: 0; color: #155724;">
                            ✅ Payment page opened in new tab<br>
                            👀 Monitoring subscription status automatically
                        </p>
                    </div>
                    
                    <p style="font-size: 12px; color: #666;">
                        This modal will close automatically once payment is complete
                    </p>
                </div>
            `;
        }
    }

    closePaymentModal() {
        const modal = document.getElementById('paymentModal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Clear any monitoring intervals
        if (this.subscriptionMonitor) {
            clearInterval(this.subscriptionMonitor);
            this.subscriptionMonitor = null;
        }
    }

    // 🛠️ UTILITY FUNCTIONS
    async updateSettings(key, value) {
        try {
            await chrome.storage.local.set({ [key]: value });
            
            // If it's an AutoScroll setting, sync with content script
            if (key.startsWith('autoScroll')) {
                await this.syncAutoScrollState();
                console.log('AutoScroll Popup: Setting updated:', key, value);
            }

        } catch (error) {
            console.error('AutoScroll Popup: Settings update error:', error);
        }
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
