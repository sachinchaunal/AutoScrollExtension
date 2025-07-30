const express = require('express');
const router = express.Router();
const User = require('../models/User');

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

module.exports = router;
