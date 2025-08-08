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
                    endpoint: 'POST /api/upi-mandates/create-mandate',
                    reason: 'Replaced by AutoPay system',
                    alternative: 'POST /api/upi-autopay/create-autopay',
                    status: 'deprecated-but-functional'
                },
                {
                    endpoint: 'GET /api/upi-mandates/status/:userId',
                    reason: 'Replaced by AutoPay system',
                    alternative: 'GET /api/upi-autopay/status/:userId',
                    status: 'deprecated-but-functional'
                },
                {
                    endpoint: 'POST /api/upi-mandates/cancel-mandate',
                    reason: 'Replaced by AutoPay system',
                    alternative: 'POST /api/upi-autopay/cancel/:userId',
                    status: 'deprecated-but-functional'
                }
            ]
        }
    });
});

module.exports = router;
