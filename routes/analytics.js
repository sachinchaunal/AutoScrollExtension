const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get analytics overview
router.get('/', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
        const trialUsers = await User.countDocuments({ trialDaysRemaining: { $gt: 0 } });
        
        const totalScrolls = await User.aggregate([
            { $group: { _id: null, total: { $sum: '$totalScrolls' } } }
        ]);

        res.json({
            success: true,
            data: {
                totalUsers,
                activeSubscriptions,
                trialUsers,
                totalScrolls: totalScrolls[0]?.total || 0,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching analytics overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching analytics overview',
            error: error.message
        });
    }
});

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Analytics service is running correctly',
        timestamp: new Date().toISOString()
    });
});

// Log scroll event
router.post('/', async (req, res) => {
    try {
        const { userId, platform, url, direction, timestamp } = req.body;

        if (!userId || !platform) {
            return res.status(400).json({
                success: false,
                message: 'User ID and platform are required'
            });
        }

        // Update user scroll count
        const user = await User.findOne({ userId });
        
        if (user) {
            user.totalScrolls += 1;
            user.platformUsage[platform] = (user.platformUsage[platform] || 0) + 1;
            await user.save();
        }

        res.json({
            success: true,
            message: 'Analytics logged successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error logging analytics',
            error: error.message
        });
    }
});

// Get user analytics
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                totalScrolls: user.totalScrolls,
                platformUsage: user.platformUsage,
                accountAge: Math.floor((new Date() - user.createdAt) / (1000 * 60 * 60 * 24)), // days
                subscriptionStatus: user.subscriptionStatus
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching user analytics',
            error: error.message
        });
    }
});

// Get platform analytics (admin)
router.get('/platforms', async (req, res) => {
    try {
        const platformStats = await User.aggregate([
            {
                $group: {
                    _id: null,
                    totalYoutube: { $sum: '$platformUsage.youtube' },
                    totalInstagram: { $sum: '$platformUsage.instagram' },
                    totalFacebook: { $sum: '$platformUsage.facebook' },
                    totalScrolls: { $sum: '$totalScrolls' }
                }
            }
        ]);

        const userCount = await User.countDocuments();

        res.json({
            success: true,
            data: {
                platformStats: platformStats[0] || {
                    totalYoutube: 0,
                    totalInstagram: 0,
                    totalFacebook: 0,
                    totalScrolls: 0
                },
                totalUsers: userCount
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching platform analytics',
            error: error.message
        });
    }
});

// Analytics dashboard (alias for root)
router.get('/dashboard', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
        const trialUsers = await User.countDocuments({ trialDaysRemaining: { $gt: 0 } });
        
        const totalScrolls = await User.aggregate([
            { $group: { _id: null, total: { $sum: '$totalScrolls' } } }
        ]);

        const recentUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select('email displayName subscriptionStatus createdAt');

        res.json({
            success: true,
            data: {
                totalUsers,
                activeSubscriptions,
                trialUsers,
                totalScrolls: totalScrolls[0]?.total || 0,
                recentUsers,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching analytics dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching analytics dashboard',
            error: error.message
        });
    }
});

// User analytics (alias for user endpoint)
router.get('/users', async (req, res) => {
    try {
        const userStats = await User.aggregate([
            {
                $group: {
                    _id: '$subscriptionStatus',
                    count: { $sum: 1 },
                    totalScrolls: { $sum: '$totalScrolls' }
                }
            }
        ]);

        const topUsers = await User.find()
            .sort({ totalScrolls: -1 })
            .limit(10)
            .select('email displayName totalScrolls subscriptionStatus');

        res.json({
            success: true,
            data: {
                userStats,
                topUsers,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching user analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user analytics',
            error: error.message
        });
    }
});

// Subscription analytics
router.get('/subscriptions', async (req, res) => {
    try {
        const subscriptionStats = await User.aggregate([
            {
                $group: {
                    _id: '$subscriptionStatus',
                    count: { $sum: 1 }
                }
            }
        ]);

        const conversionRate = await calculateConversionRate();

        res.json({
            success: true,
            data: {
                subscriptionStats,
                conversionRate,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching subscription analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription analytics',
            error: error.message
        });
    }
});

// Payment analytics
router.get('/payments', async (req, res) => {
    try {
        const Payment = require('../models/Payment');
        
        const paymentStats = await Payment.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const totalRevenue = await Payment.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.json({
            success: true,
            data: {
                paymentStats,
                totalRevenue: totalRevenue[0]?.total || 0,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching payment analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching payment analytics',
            error: error.message
        });
    }
});

// Helper function to calculate conversion rate
async function calculateConversionRate() {
    const totalTrialUsers = await User.countDocuments({ subscriptionStatus: 'trial' });
    const paidUsers = await User.countDocuments({ subscriptionStatus: 'active' });
    
    if (totalTrialUsers === 0) return 0;
    return ((paidUsers / (totalTrialUsers + paidUsers)) * 100).toFixed(2);
}

module.exports = router;
