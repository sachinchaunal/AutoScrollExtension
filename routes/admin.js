const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const User = require('../models/User');

/**
 * Admin dashboard to monitor user statistics and subscription metrics
 */

// Get admin overview
router.get('/', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
        const trialUsers = await User.countDocuments({ trialDaysRemaining: { $gt: 0 } });
        const paidUsers = await User.countDocuments({ subscriptionStatus: 'active' });
        
        const totalScrolls = await User.aggregate([
            { $group: { _id: null, total: { $sum: '$totalScrolls' } } }
        ]);

        res.json({
            success: true,
            data: {
                totalUsers,
                activeSubscriptions,
                trialUsers,
                paidUsers,
                totalScrolls: totalScrolls[0]?.total || 0,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching admin overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching admin overview',
            error: error.message
        });
    }
});

// Serve admin dashboard with environment configuration
router.get('/dashboard', (req, res) => {
    try {
        const dashboardPath = path.join(__dirname, '..', 'admin-dashboard.html');
        let htmlContent = fs.readFileSync(dashboardPath, 'utf8');
        
        // Replace template variables with actual environment values
        const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
        htmlContent = htmlContent.replace('{{API_BASE_URL}}', apiBaseUrl);
        
        res.send(htmlContent);
    } catch (error) {
        console.error('Error serving admin dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading admin dashboard'
        });
    }
});

// Get user statistics
router.get('/users/stats', async (req, res) => {
    try {
        const stats = await generateUserStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error generating user stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating statistics'
        });
    }
});

// Admin statistics (alias for users/stats)
router.get('/stats', async (req, res) => {
    try {
        const stats = await generateUserStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error generating admin stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating statistics'
        });
    }
});

// Get all users with pagination
router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;
        
        const users = await User.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('googleId email displayName subscriptionStatus isSubscriptionActive trialDaysRemaining totalScrolls createdAt updatedAt');

        const totalUsers = await User.countDocuments();
        const totalPages = Math.ceil(totalUsers / limit);

        res.json({
            success: true,
            data: {
                users,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalUsers,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching users',
            error: error.message
        });
    }
});

// Get user details by ID
router.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user
        });

    } catch (error) {
        console.error('Error getting user details:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user details'
        });
    }
});

// Update user subscription status
router.put('/users/:userId/subscription', async (req, res) => {
    try {
        const { userId } = req.params;
        const { subscriptionStatus, isSubscriptionActive, subscriptionExpiry } = req.body;
        
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (subscriptionStatus) user.subscriptionStatus = subscriptionStatus;
        if (typeof isSubscriptionActive === 'boolean') user.isSubscriptionActive = isSubscriptionActive;
        if (subscriptionExpiry) user.subscriptionExpiry = new Date(subscriptionExpiry);
        user.updatedAt = new Date();

        await user.save();

        res.json({
            success: true,
            message: 'User subscription updated successfully',
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry
            }
        });

    } catch (error) {
        console.error('Error updating user subscription:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating user subscription'
        });
    }
});

// Delete user (soft delete)
router.delete('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.isDeleted = true;
        user.deletedAt = new Date();
        user.updatedAt = new Date();
        await user.save();

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting user'
        });
    }
});

// Get subscription analytics
router.get('/subscriptions/analytics', async (req, res) => {
    try {
        const analytics = await generateSubscriptionAnalytics();
        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error generating subscription analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating subscription analytics'
        });
    }
});

// Subscription list (alias for subscription analytics)
router.get('/subscriptions', async (req, res) => {
    try {
        const analytics = await generateSubscriptionAnalytics();
        
        // Get recent subscriptions
        const recentSubscriptions = await User.find({ subscriptionStatus: 'active' })
            .sort({ updatedAt: -1 })
            .limit(10)
            .select('email displayName subscriptionStatus subscriptionExpiry createdAt');

        res.json({
            success: true,
            data: {
                ...analytics,
                recentSubscriptions
            }
        });
    } catch (error) {
        console.error('Error fetching subscriptions:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscriptions'
        });
    }
});

/**
 * Generate user statistics
 */
async function generateUserStats() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Basic counts
    const totalUsers = await User.countDocuments();
    const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
    const trialUsers = await User.countDocuments({ trialDaysRemaining: { $gt: 0 } });
    const expiredUsers = await User.countDocuments({ 
        subscriptionExpiry: { $lt: now },
        isSubscriptionActive: false 
    });

    // Recent activity
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: oneDayAgo } });
    const newUsersThisWeek = await User.countDocuments({ createdAt: { $gte: oneWeekAgo } });
    const newUsersThisMonth = await User.countDocuments({ createdAt: { $gte: oneMonthAgo } });

    // Subscription status distribution
    const subscriptionDistribution = await User.aggregate([
        { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } }
    ]);

    // Platform usage
    const platformUsage = await User.aggregate([
        { $group: { 
            _id: null, 
            totalYoutube: { $sum: '$platformUsage.youtube' },
            totalInstagram: { $sum: '$platformUsage.instagram' },
            totalFacebook: { $sum: '$platformUsage.facebook' },
            totalScrolls: { $sum: '$totalScrolls' }
        }}
    ]);

    return {
        overview: {
            totalUsers,
            activeSubscriptions,
            trialUsers,
            expiredUsers,
            conversionRate: totalUsers > 0 ? ((activeSubscriptions / totalUsers) * 100).toFixed(2) : 0
        },
        growth: {
            newUsersToday,
            newUsersThisWeek,
            newUsersThisMonth
        },
        subscriptions: {
            distribution: subscriptionDistribution.reduce((acc, item) => {
                acc[item._id || 'unknown'] = item.count;
                return acc;
            }, {})
        },
        usage: platformUsage[0] || {
            totalYoutube: 0,
            totalInstagram: 0,
            totalFacebook: 0,
            totalScrolls: 0
        },
        generatedAt: now
    };
}

/**
 * Generate subscription analytics
 */
async function generateSubscriptionAnalytics() {
    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Revenue metrics (if you have payment data)
    const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
    const expiringSubscriptions = await User.countDocuments({ 
        subscriptionExpiry: { $gte: now, $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
        isSubscriptionActive: true 
    });

    // Trial conversion metrics
    const totalTrialUsers = await User.countDocuments({ subscriptionStatus: 'trial' });
    const convertedUsers = await User.countDocuments({ 
        subscriptionStatus: 'active',
        createdAt: { $gte: oneMonthAgo }
    });

    // Churn analysis
    const expiredThisMonth = await User.countDocuments({
        subscriptionExpiry: { $gte: oneMonthAgo, $lt: now },
        isSubscriptionActive: false
    });

    return {
        active: {
            totalActive: activeSubscriptions,
            expiringThisWeek: expiringSubscriptions
        },
        conversion: {
            totalTrialUsers,
            convertedUsers,
            conversionRate: totalTrialUsers > 0 ? ((convertedUsers / totalTrialUsers) * 100).toFixed(2) : 0
        },
        churn: {
            expiredThisMonth,
            churnRate: activeSubscriptions > 0 ? ((expiredThisMonth / (activeSubscriptions + expiredThisMonth)) * 100).toFixed(2) : 0
        },
        generatedAt: now
    };
}

module.exports = router;
