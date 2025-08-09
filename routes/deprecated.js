const express = require('express');
const router = express.Router();

// Endpoint to show which routes have been deprecated/removed
router.get('/deprecated-endpoints', (req, res) => {
    res.json({
        success: true,
        message: 'Deprecated endpoints list',
        data: {
            removed: [
                {
                    endpoint: 'GET /api/auth/status',
                    reason: 'Redundant - use /api/status instead',
                    alternative: 'GET /api/status'
                },
                {
                    endpoint: 'POST /api/users/sync',
                    reason: 'Not implemented',
                    alternative: 'Use authentication flow'
                },
                {
                    endpoint: 'GET /api/payments/history',
                    reason: 'Not implemented',
                    alternative: 'GET /api/analytics/stats'
                },
                {
                    endpoint: 'GET /api/trials/status',
                    reason: 'Merged into subscription system',
                    alternative: 'GET /api/subscriptions/status'
                },
                {
                    endpoint: 'POST /api/trials/start',
                    reason: 'Merged into user registration',
                    alternative: 'Use authentication flow'
                },
                {
                    endpoint: 'POST /api/cleanup/expired',
                    reason: 'Admin-only functionality',
                    alternative: 'Use admin dashboard'
                }
            ],
            legacy: [
                {
                    note: 'All legacy UPI mandate endpoints have been completely removed',
                    reason: 'Old payment link system replaced by proper Razorpay Subscriptions',
                    migration: 'Use /api/upi-autopay/* endpoints for all subscription management',
                    status: 'removed'
                }
            ],
            removed: [
                'POST /api/upi-mandates/create-mandate → POST /api/upi-autopay/create-autopay',
                'GET /api/upi-mandates/status/:userId → GET /api/upi-autopay/status/:userId', 
                'POST /api/upi-mandates/cancel-mandate → POST /api/upi-autopay/cancel/:userId',
                'POST /api/upi-mandates/webhook → POST /api/upi-autopay/webhook'
            ]
        }
    });
});

module.exports = router;
