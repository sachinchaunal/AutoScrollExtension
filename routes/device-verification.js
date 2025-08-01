const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get device verification overview
router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Device verification service (deprecated)',
        status: 'DEPRECATED',
        recommendation: 'Use Google OAuth authentication instead',
        newEndpoint: '/api/auth/google-login',
        timestamp: new Date().toISOString()
    });
});

/**
 * Health check endpoint for device verification service
 * Used by frontend to check backend connectivity
 */
router.get('/health', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            status: 'DEPRECATED',
            service: 'device-verification',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '3.0 (Google Auth)',
            message: 'Device verification deprecated in favor of Google OAuth',
            features: [
                'google-oauth-authentication',
                'secure-user-identification', 
                'subscription-management',
                'trial-period-tracking'
            ]
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            success: false,
            status: 'ERROR',
            service: 'device-verification',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * DEPRECATED: Device verification endpoint
 * Redirects to Google OAuth
 */
router.post('/verify-device', async (req, res) => {
    res.status(410).json({
        success: false,
        message: 'Device verification deprecated. Use Google OAuth authentication.',
        redirect: '/api/auth/google-login',
        recommendation: 'Please implement Google OAuth login for secure authentication.',
        timestamp: new Date().toISOString()
    });
});

/**
 * DEPRECATED: Feature access verification
 * Use Google OAuth tokens instead
 */
router.post('/verify-feature-access', async (req, res) => {
    res.status(410).json({
        success: false,
        message: 'Feature access verification deprecated. Use Google OAuth tokens.',
        redirect: '/api/auth/verify-token',
        recommendation: 'Verify user authentication with Google OAuth tokens.',
        timestamp: new Date().toISOString()
    });
});

/**
 * DEPRECATED: Usage logging
 * Use analytics endpoints instead
 */
router.post('/log-usage', async (req, res) => {
    res.status(410).json({
        success: false,
        message: 'Usage logging deprecated. Use analytics endpoints.',
        redirect: '/api/analytics',
        recommendation: 'Log usage events through the analytics service.',
        timestamp: new Date().toISOString()
    });
});

/**
 * Get user status by Google ID (migration helper)
 */
router.get('/user-status/:googleId', async (req, res) => {
    try {
        const { googleId } = req.params;
        
        const user = await User.findOne({ googleId });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                userId: user._id,
                googleId: user.googleId,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                trialDaysRemaining: user.trialDaysRemaining,
                createdAt: user.createdAt,
                lastActiveDate: user.updatedAt
            }
        });

    } catch (error) {
        console.error('User status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user status'
        });
    }
});

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Device verification service running (deprecated)',
        status: 'DEPRECATED',
        recommendation: 'Use Google OAuth authentication',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
