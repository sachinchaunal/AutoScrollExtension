const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Check subscription status
router.post('/check-subscription', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

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
                subscriptionStatus: user.subscriptionStatus,
                isActive: user.isSubscriptionActive,
                expiryDate: user.subscriptionExpiry,
                trialDaysRemaining: user.trialDaysRemaining
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error checking subscription status',
            error: error.message
        });
    }
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
