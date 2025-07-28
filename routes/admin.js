const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const User = require('../models/User');

/**
 * Admin dashboard to monitor trial abuse and security metrics
 */

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

// Get trial abuse statistics
router.get('/trial-abuse-stats', async (req, res) => {
    try {
        const stats = await generateTrialAbuseStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error generating trial abuse stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating statistics'
        });
    }
});

// Get detailed device information
router.get('/device-details/:deviceFingerprint', async (req, res) => {
    try {
        const { deviceFingerprint } = req.params;
        
        const users = await User.find({ deviceFingerprint })
            .sort({ createdAt: -1 })
            .limit(10);

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Device not found'
            });
        }

        const deviceStats = {
            deviceFingerprint: deviceFingerprint.substring(0, 16) + '...',
            totalUsers: users.length,
            firstSeen: users[users.length - 1].createdAt,
            lastSeen: users[0].lastActiveDate,
            totalTrialBypassAttempts: users.reduce((sum, u) => sum + u.trialBypassAttempts, 0),
            totalInstallationAttempts: users.reduce((sum, u) => sum + u.installationAttempts, 0),
            securityRiskLevels: users.map(u => u.securityRiskLevel).filter(Boolean),
            subscriptionStatuses: users.map(u => u.subscriptionStatus),
            users: users.map(user => ({
                userId: user.userId,
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                securityRiskLevel: user.securityRiskLevel,
                installationAttempts: user.installationAttempts,
                trialBypassAttempts: user.trialBypassAttempts,
                totalScrolls: user.totalScrolls,
                createdAt: user.createdAt,
                lastActiveDate: user.lastActiveDate,
                deviceInfo: user.deviceInfo,
                lastSeenIP: user.lastSeenIP
            }))
        };

        res.json({
            success: true,
            data: deviceStats
        });

    } catch (error) {
        console.error('Error getting device details:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching device details'
        });
    }
});

// Get high-risk users
router.get('/high-risk-users', async (req, res) => {
    try {
        const highRiskUsers = await User.find({
            $or: [
                { securityRiskLevel: 'high' },
                { trialBypassAttempts: { $gte: 3 } },
                { installationAttempts: { $gte: 5 } },
                { subscriptionStatus: 'blocked' }
            ]
        })
        .sort({ lastActiveDate: -1 })
        .limit(50)
        .select('userId deviceFingerprint securityRiskLevel trialBypassAttempts installationAttempts subscriptionStatus lastActiveDate totalScrolls');

        res.json({
            success: true,
            data: {
                count: highRiskUsers.length,
                users: highRiskUsers.map(user => ({
                    userId: user.userId,
                    deviceFingerprint: user.deviceFingerprint.substring(0, 16) + '...',
                    securityRiskLevel: user.securityRiskLevel,
                    trialBypassAttempts: user.trialBypassAttempts,
                    installationAttempts: user.installationAttempts,
                    subscriptionStatus: user.subscriptionStatus,
                    lastActiveDate: user.lastActiveDate,
                    totalScrolls: user.totalScrolls
                }))
            }
        });

    } catch (error) {
        console.error('Error getting high-risk users:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching high-risk users'
        });
    }
});

// Block a device
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
                $push: {
                    securityNotes: {
                        action: 'device_blocked',
                        reason: reason || 'Manual admin action',
                        timestamp: new Date()
                    }
                }
            }
        );

        res.json({
            success: true,
            message: `Blocked ${result.modifiedCount} users on this device`,
            data: {
                modifiedCount: result.modifiedCount,
                deviceFingerprint: deviceFingerprint.substring(0, 16) + '...'
            }
        });

    } catch (error) {
        console.error('Error blocking device:', error);
        res.status(500).json({
            success: false,
            message: 'Error blocking device'
        });
    }
});

// Unblock a device
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
                $push: {
                    securityNotes: {
                        action: 'device_unblocked',
                        reason: 'Manual admin action',
                        timestamp: new Date()
                    }
                }
            }
        );

        res.json({
            success: true,
            message: `Unblocked ${result.modifiedCount} users on this device`,
            data: {
                modifiedCount: result.modifiedCount,
                deviceFingerprint: deviceFingerprint.substring(0, 16) + '...'
            }
        });

    } catch (error) {
        console.error('Error unblocking device:', error);
        res.status(500).json({
            success: false,
            message: 'Error unblocking device'
        });
    }
});

// Get security metrics dashboard
router.get('/security-dashboard', async (req, res) => {
    try {
        const dashboard = await generateSecurityDashboard();
        res.json({
            success: true,
            data: dashboard
        });
    } catch (error) {
        console.error('Error generating security dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating security dashboard'
        });
    }
});

/**
 * Generate trial abuse statistics
 */
async function generateTrialAbuseStats() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Total users and device counts
    const totalUsers = await User.countDocuments();
    const uniqueDevices = await User.distinct('deviceFingerprint').then(arr => arr.length);

    // Trial abuse metrics
    const usersWithTrialAbuse = await User.countDocuments({ trialBypassAttempts: { $gt: 0 } });
    const blockedUsers = await User.countDocuments({ subscriptionStatus: 'blocked' });
    const highRiskUsers = await User.countDocuments({ securityRiskLevel: 'high' });

    // Recent activity
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: oneDayAgo } });
    const activeUsersToday = await User.countDocuments({ lastActiveDate: { $gte: oneDayAgo } });

    // Trial bypass attempts in last week
    const recentTrialAbuse = await User.aggregate([
        { $match: { updatedAt: { $gte: oneWeekAgo } } },
        { $group: { _id: null, totalAttempts: { $sum: '$trialBypassAttempts' } } }
    ]);

    // Device reuse patterns
    const deviceReuseStats = await User.aggregate([
        { $group: { _id: '$deviceFingerprint', userCount: { $sum: 1 } } },
        { $match: { userCount: { $gt: 1 } } },
        { $group: { _id: null, reusedDevices: { $sum: 1 }, totalReuseCount: { $sum: '$userCount' } } }
    ]);

    // Security risk distribution
    const riskDistribution = await User.aggregate([
        { $group: { _id: '$securityRiskLevel', count: { $sum: 1 } } }
    ]);

    return {
        overview: {
            totalUsers,
            uniqueDevices,
            deviceReuseRatio: uniqueDevices > 0 ? (totalUsers / uniqueDevices).toFixed(2) : 0,
            usersWithTrialAbuse,
            blockedUsers,
            highRiskUsers
        },
        recentActivity: {
            newUsersToday,
            activeUsersToday,
            trialAbuseAttemptsThisWeek: recentTrialAbuse[0]?.totalAttempts || 0
        },
        deviceReuse: {
            reusedDevices: deviceReuseStats[0]?.reusedDevices || 0,
            totalReuseCount: deviceReuseStats[0]?.totalReuseCount || 0
        },
        securityRisks: {
            distribution: riskDistribution.reduce((acc, item) => {
                acc[item._id || 'unknown'] = item.count;
                return acc;
            }, {})
        },
        generatedAt: now
    };
}

/**
 * Generate comprehensive security dashboard
 */
async function generateSecurityDashboard() {
    const trialStats = await generateTrialAbuseStats();
    
    // Top devices by abuse attempts
    const topAbusers = await User.aggregate([
        { $match: { trialBypassAttempts: { $gt: 0 } } },
        { $group: { 
            _id: '$deviceFingerprint', 
            totalAttempts: { $sum: '$trialBypassAttempts' },
            userCount: { $sum: 1 },
            lastActivity: { $max: '$lastActiveDate' }
        }},
        { $sort: { totalAttempts: -1 } },
        { $limit: 10 }
    ]);

    // Recent blocked devices
    const recentBlocks = await User.find({ 
        subscriptionStatus: 'blocked',
        updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    })
    .sort({ updatedAt: -1 })
    .limit(10)
    .select('deviceFingerprint userId updatedAt trialBypassAttempts securityRiskLevel');

    // Geographic distribution (if IP data available)
    const ipDistribution = await User.aggregate([
        { $match: { lastSeenIP: { $exists: true, $ne: null } } },
        { $group: { 
            _id: { $substr: ['$lastSeenIP', 0, 7] }, // First 7 chars of IP for privacy
            count: { $sum: 1 }
        }},
        { $sort: { count: -1 } },
        { $limit: 10 }
    ]);

    return {
        trialAbuseStats: trialStats,
        topAbusers: topAbusers.map(device => ({
            deviceId: device._id.substring(0, 16) + '...',
            attempts: device.totalAttempts,
            userCount: device.userCount,
            lastActivity: device.lastActivity
        })),
        recentBlocks: recentBlocks.map(user => ({
            deviceId: user.deviceFingerprint.substring(0, 16) + '...',
            userId: user.userId,
            blockedAt: user.updatedAt,
            attempts: user.trialBypassAttempts,
            riskLevel: user.securityRiskLevel
        })),
        ipDistribution: ipDistribution.map(ip => ({
            ipPrefix: ip._id,
            userCount: ip.count
        }))
    };
}

module.exports = router;
