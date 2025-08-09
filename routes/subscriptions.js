const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get all subscriptions overview
router.get('/', async (req, res) => {
    try {
        const totalSubscriptions = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
        const trialSubscriptions = await User.countDocuments({ subscriptionStatus: 'trial' });
        const paidSubscriptions = await User.countDocuments({ subscriptionStatus: 'active' });
        const expiredSubscriptions = await User.countDocuments({ subscriptionStatus: 'expired' });
        
        // Get subscription statistics
        const subscriptionStats = await User.aggregate([
            {
                $group: {
                    _id: '$subscriptionStatus',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        // Get recent subscriptions
        const recentSubscriptions = await User.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select('email displayName subscriptionStatus isSubscriptionActive trialDaysRemaining createdAt subscriptionExpiry');
        
        // Calculate conversion rate
        const conversionRate = paidSubscriptions > 0 && trialSubscriptions > 0 
            ? ((paidSubscriptions / (paidSubscriptions + trialSubscriptions)) * 100).toFixed(2)
            : 0;
        
        res.json({
            success: true,
            data: {
                overview: {
                    totalSubscriptions,
                    activeSubscriptions,
                    trialSubscriptions,
                    paidSubscriptions,
                    expiredSubscriptions,
                    conversionRate: `${conversionRate}%`
                },
                subscriptionStats,
                recentSubscriptions,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching subscriptions overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscriptions overview',
            error: error.message
        });
    }
});

// Get user subscriptions (alias for /:userId)
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).select('subscriptionStatus isSubscriptionActive subscriptionExpiry trialDaysRemaining trialEndDate hasAutoRenewal');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                trialDaysRemaining: user.trialDaysRemaining,
                trialEndDate: user.trialEndDate,
                hasAutoRenewal: user.hasAutoRenewal
            }
        });
    } catch (error) {
        console.error('Subscription fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription data',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Get user subscriptions
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).select('subscriptionStatus isSubscriptionActive subscriptionExpiry trialDaysRemaining trialEndDate hasAutoRenewal');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                trialDaysRemaining: user.trialDaysRemaining,
                trialEndDate: user.trialEndDate,
                hasAutoRenewal: user.hasAutoRenewal
            }
        });
    } catch (error) {
        console.error('Error fetching user subscriptions:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription data',
            error: error.message
        });
    }
});

// Get subscription status
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

        // Calculate if trial is still active
        const now = new Date();
        const trialEndDate = user.trialEndDate;
        const isTrialActive = trialEndDate && now < trialEndDate;
        const trialDaysRemaining = isTrialActive ? Math.ceil((trialEndDate - now) / (24 * 60 * 60 * 1000)) : 0;

        const canUseExtension = user.isSubscriptionActive || isTrialActive;

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                canUseExtension,
                trialDaysRemaining,
                isTrialActive,
                trialEndDate: user.trialEndDate,
                subscriptionExpiry: user.subscriptionExpiry
            }
        });
    } catch (error) {
        console.error('Error checking subscription status:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking subscription status',
            error: error.message
        });
    }
});

// Activate subscription
router.post('/activate', async (req, res) => {
    try {
        const { userId, subscriptionType = 'monthly', paymentMethod } = req.body;
        
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

        // Activate subscription
        const subscriptionExpiry = new Date();
        subscriptionExpiry.setMonth(subscriptionExpiry.getMonth() + 1); // 1 month subscription

        user.subscriptionStatus = 'active';
        user.isSubscriptionActive = true;
        user.subscriptionExpiry = subscriptionExpiry;
        user.hasAutoRenewal = true;
        user.updatedAt = new Date();

        await user.save();

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                subscriptionType,
                paymentMethod
            },
            message: 'Subscription activated successfully'
        });
    } catch (error) {
        console.error('Error activating subscription:', error);
        res.status(500).json({
            success: false,
            message: 'Error activating subscription',
            error: error.message
        });
    }
});

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Subscriptions service is running correctly',
        timestamp: new Date().toISOString()
    });
});

// Cancel subscription
router.post('/cancel', async (req, res) => {
    try {
        const { userId } = req.body;

        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.subscriptionStatus = 'cancelled';
        await user.save();

        res.json({
            success: true,
            message: 'Subscription cancelled successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error cancelling subscription',
            error: error.message
        });
    }
});

// Renew subscription
router.post('/renew', async (req, res) => {
    try {
        const { userId } = req.body;

        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1);

        user.subscriptionStatus = 'active';
        user.subscriptionExpiry = expiryDate;
        user.lastPaymentDate = new Date();
        
        await user.save();

        res.json({
            success: true,
            message: 'Subscription renewed successfully',
            data: {
                expiryDate: user.subscriptionExpiry
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error renewing subscription',
            error: error.message
        });
    }
});

// Get subscription stats (admin)
router.get('/stats', async (req, res) => {
    try {
        const stats = await User.aggregate([
            {
                $group: {
                    _id: '$subscriptionStatus',
                    count: { $sum: 1 }
                }
            }
        ]);

        const totalUsers = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ 
            subscriptionStatus: 'active',
            subscriptionExpiry: { $gt: new Date() }
        });

        const trialUsers = await User.countDocuments({ 
            subscriptionStatus: 'trial' 
        });

        res.json({
            success: true,
            data: {
                totalUsers,
                activeSubscriptions,
                trialUsers,
                statusBreakdown: stats
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription stats',
            error: error.message
        });
    }
});

module.exports = router;
