const User = require('../models/User');
const SubscriptionService = require('../services/subscriptionService');

/**
 * Middleware to check subscription access
 * @param {string} feature - Feature to check access for (optional)
 * @returns {Function} Express middleware function
 */
function requireSubscription(feature = 'autoScroll') {
    return async (req, res, next) => {
        try {
            const userId = req.body.userId || req.params.userId || req.query.userId;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required',
                    requiresAuth: true
                });
            }
            
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                    requiresAuth: true
                });
            }
            
            // Check feature access
            const accessValidation = SubscriptionService.validateFeatureAccess(user, feature);
            
            if (!accessValidation.allowed) {
                const statusCode = accessValidation.reason === 'trial_expired' ? 402 : 403;
                
                return res.status(statusCode).json({
                    success: false,
                    message: accessValidation.message,
                    reason: accessValidation.reason,
                    requiresSubscription: true,
                    subscriptionStatus: SubscriptionService.getUserSubscriptionStatus(user)
                });
            }
            
            // Add user and access info to request
            req.user = user;
            req.subscriptionAccess = accessValidation;
            
            next();
            
        } catch (error) {
            console.error('❌ Subscription middleware error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to validate subscription access',
                error: error.message
            });
        }
    };
}

/**
 * Middleware to check trial access only (for trial features)
 */
function requireTrialOrSubscription() {
    return async (req, res, next) => {
        try {
            const userId = req.body.userId || req.params.userId || req.query.userId;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required',
                    requiresAuth: true
                });
            }
            
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                    requiresAuth: true
                });
            }
            
            const access = user.hasActiveAccess();
            
            if (!access.hasAccess) {
                return res.status(402).json({
                    success: false,
                    message: 'Trial has expired. Please subscribe to continue using AutoScroll.',
                    requiresSubscription: true,
                    subscriptionStatus: SubscriptionService.getUserSubscriptionStatus(user)
                });
            }
            
            // Add user and access info to request
            req.user = user;
            req.subscriptionAccess = access;
            
            next();
            
        } catch (error) {
            console.error('❌ Trial middleware error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to validate trial access',
                error: error.message
            });
        }
    };
}

/**
 * Middleware to check premium subscription access
 */
function requirePremiumSubscription() {
    return async (req, res, next) => {
        try {
            const userId = req.body.userId || req.params.userId || req.query.userId;
            
            if (!userId) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID is required',
                    requiresAuth: true
                });
            }
            
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                    requiresAuth: true
                });
            }
            
            const access = user.hasActiveAccess();
            
            if (!access.hasAccess) {
                return res.status(402).json({
                    success: false,
                    message: 'Subscription required to access this feature',
                    requiresSubscription: true,
                    subscriptionStatus: SubscriptionService.getUserSubscriptionStatus(user)
                });
            }
            
            if (access.type !== 'subscription') {
                return res.status(403).json({
                    success: false,
                    message: 'Premium subscription required for this feature',
                    requiresPremium: true,
                    currentAccess: access.type,
                    subscriptionStatus: SubscriptionService.getUserSubscriptionStatus(user)
                });
            }
            
            // Add user and access info to request
            req.user = user;
            req.subscriptionAccess = access;
            
            next();
            
        } catch (error) {
            console.error('❌ Premium middleware error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to validate premium access',
                error: error.message
            });
        }
    };
}

/**
 * Middleware to auto-initialize trial for new users
 */
function autoInitializeTrial() {
    return async (req, res, next) => {
        try {
            const userId = req.body.userId || req.params.userId || req.query.userId;
            
            if (!userId) {
                return next(); // Skip if no user ID
            }
            
            const user = await User.findById(userId);
            if (!user) {
                return next(); // Skip if user not found
            }
            
            // Check if user needs trial initialization
            if (!user.subscription || !user.subscription.trial) {
                console.log(`🆕 Initializing trial for new user: ${user.email}`);
                await SubscriptionService.initializeTrial(user);
            }
            
            next();
            
        } catch (error) {
            console.error('❌ Auto trial initialization error:', error);
            // Don't block the request, just continue
            next();
        }
    };
}

/**
 * Middleware to record usage when accessing protected features
 */
function recordUsage(feature = 'autoScroll') {
    return async (req, res, next) => {
        try {
            // Add post-response middleware to record usage
            const originalSend = res.send;
            
            res.send = function(data) {
                // Call original send
                originalSend.call(this, data);
                
                // Record usage if request was successful and user exists
                if (req.user && res.statusCode >= 200 && res.statusCode < 300) {
                    setImmediate(async () => {
                        try {
                            req.user.recordAutoScrollUsage();
                            await req.user.save();
                            console.log(`📊 Usage recorded for user: ${req.user.email}, Feature: ${feature}`);
                        } catch (error) {
                            console.error('❌ Failed to record usage:', error);
                        }
                    });
                }
            };
            
            next();
            
        } catch (error) {
            console.error('❌ Usage recording middleware error:', error);
            next();
        }
    };
}

/**
 * Middleware to add subscription status to all authenticated responses
 */
function addSubscriptionStatus() {
    return async (req, res, next) => {
        try {
            const originalJson = res.json;
            
            res.json = function(data) {
                // Add subscription status to successful responses if user exists
                if (req.user && res.statusCode >= 200 && res.statusCode < 300) {
                    const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(req.user);
                    
                    if (data && typeof data === 'object') {
                        data.subscriptionStatus = {
                            hasAccess: subscriptionStatus.hasAccess,
                            type: subscriptionStatus.accessType,
                            daysRemaining: subscriptionStatus.daysRemaining,
                            canUpgrade: subscriptionStatus.canUpgrade
                        };
                    }
                }
                
                // Call original json
                originalJson.call(this, data);
            };
            
            next();
            
        } catch (error) {
            console.error('❌ Subscription status middleware error:', error);
            next();
        }
    };
}

module.exports = {
    requireSubscription,
    requireTrialOrSubscription,
    requirePremiumSubscription,
    autoInitializeTrial,
    recordUsage,
    addSubscriptionStatus
};
