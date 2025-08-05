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

// Dashboard stats (alias for root admin endpoint)
router.get('/dashboard-stats', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
        const trialUsers = await User.countDocuments({ trialDaysRemaining: { $gt: 0 } });
        const paidUsers = await User.countDocuments({ subscriptionStatus: 'active' });
        
        const totalScrolls = await User.aggregate([
            { $group: { _id: null, total: { $sum: '$totalScrolls' } } }
        ]);

        // Additional stats for dashboard
        const newUsersToday = await User.countDocuments({
            createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        });

        const newUsersThisWeek = await User.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        });

        res.json({
            success: true,
            data: {
                totalUsers,
                activeSubscriptions,
                trialUsers,
                paidUsers,
                totalScrolls: totalScrolls[0]?.total || 0,
                newUsersToday,
                newUsersThisWeek,
                conversionRate: paidUsers > 0 && trialUsers > 0 
                    ? ((paidUsers / (paidUsers + trialUsers)) * 100).toFixed(2) + '%'
                    : '0%',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard stats',
            error: error.message
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

// Security dashboard route for trial abuse monitoring
router.get('/security-dashboard', async (req, res) => {
    try {
        // Get trial abuse statistics
        const trialAbuseStats = await generateTrialAbuseStats();
        
        // Get top abusers (devices with multiple users)
        const topAbusers = await getTopAbusers();
        
        // Get recent blocks
        const recentBlocks = await getRecentBlocks();

        res.json({
            success: true,
            data: {
                trialAbuseStats,
                topAbusers,
                recentBlocks
            }
        });
    } catch (error) {
        console.error('Error generating security dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating security dashboard',
            error: error.message
        });
    }
});

// High risk users endpoint
router.get('/high-risk-users', async (req, res) => {
    try {
        const highRiskUsers = await User.find({
            $or: [
                { trialBypassAttempts: { $gt: 1 } },
                { securityRiskLevel: 'high' },
                { subscriptionStatus: 'blocked' }
            ]
        })
        .select('userId deviceFingerprint securityRiskLevel trialBypassAttempts subscriptionStatus lastActiveDate')
        .sort({ trialBypassAttempts: -1, lastActiveDate: -1 })
        .limit(50);

        res.json({
            success: true,
            data: {
                users: highRiskUsers,
                count: highRiskUsers.length
            }
        });
    } catch (error) {
        console.error('Error fetching high risk users:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching high risk users',
            error: error.message
        });
    }
});

// Block device endpoint
router.post('/block-device', async (req, res) => {
    try {
        const { deviceFingerprint, reason } = req.body;
        
        if (!deviceFingerprint) {
            return res.status(400).json({
                success: false,
                message: 'Device fingerprint is required'
            });
        }

        const result = await User.updateMany(
            { deviceFingerprint },
            { 
                subscriptionStatus: 'blocked',
                blockReason: reason || 'Admin action',
                blockedAt: new Date(),
                updatedAt: new Date()
            }
        );

        res.json({
            success: true,
            message: `Blocked ${result.modifiedCount} users on device`,
            data: {
                modifiedCount: result.modifiedCount,
                deviceFingerprint
            }
        });
    } catch (error) {
        console.error('Error blocking device:', error);
        res.status(500).json({
            success: false,
            message: 'Error blocking device',
            error: error.message
        });
    }
});

// Unblock device endpoint
router.post('/unblock-device', async (req, res) => {
    try {
        const { deviceFingerprint } = req.body;
        
        if (!deviceFingerprint) {
            return res.status(400).json({
                success: false,
                message: 'Device fingerprint is required'
            });
        }

        const result = await User.updateMany(
            { deviceFingerprint, subscriptionStatus: 'blocked' },
            { 
                subscriptionStatus: 'trial',
                $unset: { blockReason: '', blockedAt: '' },
                updatedAt: new Date()
            }
        );

        res.json({
            success: true,
            message: `Unblocked ${result.modifiedCount} users on device`,
            data: {
                modifiedCount: result.modifiedCount,
                deviceFingerprint
            }
        });
    } catch (error) {
        console.error('Error unblocking device:', error);
        res.status(500).json({
            success: false,
            message: 'Error unblocking device',
            error: error.message
        });
    }
});

/**
 * Helper functions for security dashboard
 */
async function generateTrialAbuseStats() {
    const totalUsers = await User.countDocuments();
    const uniqueDevices = await User.distinct('deviceFingerprint').then(devices => devices.length);
    const blockedUsers = await User.countDocuments({ subscriptionStatus: 'blocked' });
    const highRiskUsers = await User.countDocuments({ 
        $or: [
            { trialBypassAttempts: { $gt: 1 } },
            { securityRiskLevel: 'high' }
        ]
    });
    
    const deviceReuseRatio = totalUsers > 0 ? (totalUsers / uniqueDevices).toFixed(2) : 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ 
        createdAt: { $gte: today }
    });

    return {
        overview: {
            totalUsers,
            uniqueDevices,
            blockedUsers,
            highRiskUsers,
            deviceReuseRatio
        },
        recentActivity: {
            newUsersToday
        }
    };
}

async function getTopAbusers() {
    const abusers = await User.aggregate([
        {
            $group: {
                _id: '$deviceFingerprint',
                userCount: { $sum: 1 },
                attempts: { $sum: '$trialBypassAttempts' },
                lastActivity: { $max: '$lastActiveDate' }
            }
        },
        {
            $match: {
                userCount: { $gt: 1 }
            }
        },
        {
            $sort: { attempts: -1, userCount: -1 }
        },
        {
            $limit: 10
        },
        {
            $project: {
                deviceId: '$_id',
                userCount: 1,
                attempts: 1,
                lastActivity: 1,
                _id: 0
            }
        }
    ]);

    return abusers;
}

async function getRecentBlocks() {
    const recentBlocks = await User.find({ 
        subscriptionStatus: 'blocked',
        blockedAt: { $exists: true }
    })
    .select('userId deviceFingerprint blockedAt trialBypassAttempts securityRiskLevel')
    .sort({ blockedAt: -1 })
    .limit(20);

    return recentBlocks.map(block => ({
        deviceId: block.deviceFingerprint,
        userId: block.userId,
        blockedAt: block.blockedAt,
        attempts: block.trialBypassAttempts || 0,
        riskLevel: block.securityRiskLevel || 'low'
    }));
}

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
