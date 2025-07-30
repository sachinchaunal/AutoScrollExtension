const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Test connection endpoint
router.get('/test-connection', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Backend server is running correctly',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Get or create user
router.post('/register', async (req, res) => {
    try {
        const { userId, email, deviceFingerprint } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // If deviceFingerprint is not provided, generate one for testing
        const finalDeviceFingerprint = deviceFingerprint || `device_${userId}_${Date.now()}`;

        let user = await User.findOne({ userId });

        if (!user) {
            user = new User({
                userId,
                email,
                deviceFingerprint: finalDeviceFingerprint,
                trialStartDate: new Date()
            });
            await user.save();
        }

        res.json({
            success: true,
            data: {
                userId: user.userId,
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                deviceFingerprint: user.deviceFingerprint
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error registering user',
            error: error.message
        });
    }
});

// Get user profile
router.get('/profile/:userId', async (req, res) => {
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
                userId: user.userId,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                totalScrolls: user.totalScrolls,
                platformUsage: user.platformUsage,
                settings: user.settings,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching user profile',
            error: error.message
        });
    }
});

// Update user settings
router.patch('/settings/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { settings } = req.body;

        const user = await User.findOne({ userId });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.settings = { ...user.settings, ...settings };
        await user.save();

        res.json({
            success: true,
            message: 'Settings updated successfully',
            data: user.settings
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating settings',
            error: error.message
        });
    }
});

module.exports = router;
