const express = require('express');
const router = express.Router();
const User = require('../models/User');
const SubscriptionService = require('../services/subscriptionService');
const { verifyWebhookSignature } = require('../config/razorpay');
const { formatErrorResponse } = require('../services/errorHandling');

/**
 * Get user subscription status
 * GET /api/subscription/status/:userId
 */
router.get('/status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
        
        res.json({
            success: true,
            data: subscriptionStatus
        });
        
    } catch (error) {
        console.error('❌ Get subscription status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get subscription status',
            error: error.message
        });
    }
});

/**
 * Initialize free trial for user
 * POST /api/subscription/trial/start
 */
router.post('/trial/start', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Check if trial already used
        if (user.subscription && user.subscription.trial && 
            (!user.subscription.trial.isActive && new Date() > user.subscription.trial.endDate)) {
            return res.status(400).json({
                success: false,
                message: 'Free trial has already been used'
            });
        }
        
        const trialResult = await SubscriptionService.initializeTrial(user);
        
        res.json({
            success: true,
            message: 'Free trial started successfully',
            data: trialResult
        });
        
    } catch (error) {
        console.error('❌ Start trial error:', error);
        const errorResponse = formatErrorResponse(error);
        res.status(errorResponse.error.statusCode).json(errorResponse);
    }
});

/**
 * Create subscription for user
 * POST /api/subscription/create
 */
router.post('/create', async (req, res) => {
    try {
        const { userId, planType = 'monthly' } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        if (!['monthly', 'yearly'].includes(planType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid plan type. Must be "monthly" or "yearly"'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Check if user already has an active subscription
        const currentStatus = SubscriptionService.getUserSubscriptionStatus(user);
        if (currentStatus.subscriptionStatus === 'active') {
            return res.status(400).json({
                success: false,
                message: 'User already has an active subscription'
            });
        }
        
        const subscriptionResult = await SubscriptionService.createUserSubscription(user, planType);
        
        res.json({
            success: true,
            message: 'Subscription created successfully',
            data: subscriptionResult
        });
        
    } catch (error) {
        console.error('❌ Create subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create subscription',
            error: error.message
        });
    }
});

/**
 * Cancel user subscription
 * POST /api/subscription/cancel
 */
router.post('/cancel', async (req, res) => {
    try {
        const { userId, cancelAtCycleEnd = true } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        if (!user.subscription.razorpay.subscriptionId) {
            return res.status(400).json({
                success: false,
                message: 'No active subscription found'
            });
        }
        
        const cancellationResult = await SubscriptionService.cancelUserSubscription(user, cancelAtCycleEnd);
        
        res.json({
            success: true,
            message: cancelAtCycleEnd ? 
                'Subscription will be cancelled at the end of current billing period' :
                'Subscription cancelled immediately',
            data: cancellationResult
        });
        
    } catch (error) {
        console.error('❌ Cancel subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel subscription',
            error: error.message
        });
    }
});

/**
 * Validate feature access for user
 * POST /api/subscription/validate-access
 */
router.post('/validate-access', async (req, res) => {
    try {
        const { userId, feature = 'autoScroll' } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const accessValidation = await SubscriptionService.validateFeatureAccess(user, feature);
        
        res.json({
            success: true,
            data: accessValidation
        });
        
    } catch (error) {
        console.error('❌ Validate access error:', error);
        const errorResponse = formatErrorResponse(error);
        res.status(errorResponse.error.statusCode).json(errorResponse);
    }
});

/**
 * Get subscription plans
 * GET /api/subscription/plans
 */
router.get('/plans', (req, res) => {
    try {
        const { SUBSCRIPTION_PLANS } = require('../config/razorpay');
        
        res.json({
            success: true,
            data: {
                plans: {
                    monthly: {
                        id: SUBSCRIPTION_PLANS.MONTHLY.id,
                        name: SUBSCRIPTION_PLANS.MONTHLY.name,
                        amount: SUBSCRIPTION_PLANS.MONTHLY.amount,
                        currency: SUBSCRIPTION_PLANS.MONTHLY.currency,
                        period: SUBSCRIPTION_PLANS.MONTHLY.period,
                        description: SUBSCRIPTION_PLANS.MONTHLY.description,
                        displayAmount: `₹${SUBSCRIPTION_PLANS.MONTHLY.amount / 100}`,
                        savings: null
                    },
                    yearly: {
                        id: SUBSCRIPTION_PLANS.YEARLY.id,
                        name: SUBSCRIPTION_PLANS.YEARLY.name,
                        amount: SUBSCRIPTION_PLANS.YEARLY.amount,
                        currency: SUBSCRIPTION_PLANS.YEARLY.currency,
                        period: SUBSCRIPTION_PLANS.YEARLY.period,
                        description: SUBSCRIPTION_PLANS.YEARLY.description,
                        displayAmount: `₹${SUBSCRIPTION_PLANS.YEARLY.amount / 100}`,
                        savings: `Save ₹${(SUBSCRIPTION_PLANS.MONTHLY.amount * 12 - SUBSCRIPTION_PLANS.YEARLY.amount) / 100}`
                    }
                },
                trial: {
                    duration: 10,
                    features: ['autoScroll', 'analytics', 'settings']
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Get plans error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get subscription plans',
            error: error.message
        });
    }
});

/**
 * Record AutoScroll usage
 * POST /api/subscription/usage/record
 */
router.post('/usage/record', async (req, res) => {
    try {
        const { userId, feature = 'autoScroll' } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Validate access before recording usage
        const accessValidation = SubscriptionService.validateFeatureAccess(user, feature);
        
        if (!accessValidation.allowed) {
            return res.status(403).json({
                success: false,
                message: accessValidation.message,
                reason: accessValidation.reason,
                data: accessValidation
            });
        }
        
        // Record usage
        user.recordAutoScrollUsage();
        await user.save();
        
        res.json({
            success: true,
            message: 'Usage recorded successfully',
            data: {
                totalUsage: user.subscription.usage.totalAutoScrolls,
                accessType: accessValidation.accessType,
                daysRemaining: accessValidation.daysRemaining
            }
        });
        
    } catch (error) {
        console.error('❌ Record usage error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record usage',
            error: error.message
        });
    }
});

/**
 * Razorpay webhook handler
 * POST /api/subscription/webhook
 */
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        // Verify webhook signature
        if (!verifyWebhookSignature(body, signature)) {
            console.warn('⚠️ Invalid webhook signature received');
            return res.status(400).json({
                success: false,
                message: 'Invalid signature'
            });
        }
        
        console.log('📧 Webhook received:', req.body.event);
        
        const result = await SubscriptionService.handleWebhookEvent(req.body);
        
        res.json({
            success: true,
            message: 'Webhook processed successfully',
            data: result
        });
        
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({
            success: false,
            message: 'Webhook processing failed',
            error: error.message
        });
    }
});

/**
 * Get user subscription analytics
 * GET /api/subscription/analytics/:userId
 */
router.get('/analytics/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
        
        // Calculate usage analytics
        const analytics = {
            subscription: {
                status: subscriptionStatus.subscriptionStatus,
                type: subscriptionStatus.accessType,
                daysRemaining: subscriptionStatus.daysRemaining,
                expiryDate: subscriptionStatus.expiryDate
            },
            usage: {
                totalAutoScrolls: user.subscription?.usage?.totalAutoScrolls || 0,
                lastUsed: user.subscription?.usage?.lastAccessedAt,
                dailyUsage: user.subscription?.usage?.dailyUsage?.slice(-7) || [], // Last 7 days
                averageDaily: user.subscription?.usage?.dailyUsage?.length > 0 ?
                    user.subscription.usage.dailyUsage.reduce((sum, day) => sum + day.scrollCount, 0) / user.subscription.usage.dailyUsage.length :
                    0
            },
            features: user.subscription?.features || {},
            trial: {
                used: !user.subscription?.trial?.isActive || new Date() > user.subscription?.trial?.endDate,
                startDate: user.subscription?.trial?.startDate,
                endDate: user.subscription?.trial?.endDate
            }
        };
        
        res.json({
            success: true,
            data: analytics
        });
        
    } catch (error) {
        console.error('❌ Get analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get analytics',
            error: error.message
        });
    }
});

module.exports = router;
