const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bodyParser = require('body-parser');
const Razorpay = require('razorpay');
const axios = require('axios');
const User = require('../models/User');
const ProcessedEvent = require('../models/ProcessedEvent');

// JSON parser for non-webhook routes in this router (the app has global json too; this is safe)
router.use((req, res, next) => {
    // Skip for the exact webhook path where we need raw body
    if (req.path === '/webhook') return next();
    return bodyParser.json({ limit: '1mb' })(req, res, next);
});

// Razorpay client
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Config
const PLAN_INTERVAL = process.env.SUBSCRIPTION_INTERVAL || 'monthly'; // monthly
const PLAN_AMOUNT = parseInt(process.env.SUBSCRIPTION_PRICE || '9', 10) * 100; // in paise
const PLAN_CURRENCY = 'INR';
const PLAN_NOTE = 'AutoScroll Premium Plan';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
const RZP_PLAN_ID = process.env.RAZORPAY_PLAN_ID; // if provided, we reuse

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

function verifySignature(rawBody, signature, secret) {
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return expected === signature;
}

// Get all subscriptions overview
router.get('/', async (req, res) => {
    try {
        const totalSubscriptions = await User.countDocuments();
        const activeSubscriptions = await User.countDocuments({ isSubscriptionActive: true });
        const trialSubscriptions = await User.countDocuments({ subscriptionStatus: 'trial' });
        const paidSubscriptions = await User.countDocuments({ subscriptionStatus: 'active' });
        const expiredSubscriptions = await User.countDocuments({ subscriptionStatus: 'expired' });
        
        // Get subscription statistics
        const subscriptionStats = await User.aggregate([
            {
                $group: {
                    _id: '$subscriptionStatus',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        // Get recent subscriptions
        const recentSubscriptions = await User.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select('email displayName subscriptionStatus isSubscriptionActive trialDaysRemaining createdAt subscriptionExpiry');
        
        // Calculate conversion rate
        const conversionRate = paidSubscriptions > 0 && trialSubscriptions > 0 
            ? ((paidSubscriptions / (paidSubscriptions + trialSubscriptions)) * 100).toFixed(2)
            : 0;
        
        res.json({
            success: true,
            data: {
                overview: {
                    totalSubscriptions,
                    activeSubscriptions,
                    trialSubscriptions,
                    paidSubscriptions,
                    expiredSubscriptions,
                    conversionRate: `${conversionRate}%`
                },
                subscriptionStats,
                recentSubscriptions,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching subscriptions overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscriptions overview',
            error: error.message
        });
    }
});
/**
 * Create or fetch plan (idempotent)
 */
router.post('/create-plan', async (req, res) => {
    try {
        // If plan id is configured, fetch and return
        if (RZP_PLAN_ID) {
            try {
                const plan = await razorpay.plans.fetch(RZP_PLAN_ID);
                return res.json({ success: true, data: { planId: plan.id, amount: plan.item.amount, currency: plan.item.currency } });
            } catch (_) {
                // fall through to attempt create
            }
        }

        // Create a monthly plan
        const plan = await razorpay.plans.create({
            period: 'monthly',
            interval: 1,
            item: {
                name: PLAN_NOTE,
                amount: PLAN_AMOUNT,
                currency: PLAN_CURRENCY,
            },
            notes: { app: 'AutoScroll' },
        });

        return res.json({ success: true, data: { planId: plan.id, amount: plan.item.amount, currency: plan.item.currency } });
    } catch (error) {
        console.error('Create plan error:', error);
        return res.status(500).json({ success: false, message: 'Failed to create plan', error: error.message });
    }
});

/**
 * Create hosted subscription link (Razorpay Subscription Link)
 */
router.post('/create-subscription-link', async (req, res) => {
    try {
        const { userId, customer } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });

        // Ensure user exists
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // Ensure a plan exists
        let planId = RZP_PLAN_ID;
        if (!planId) {
            const plan = await razorpay.plans.create({
                period: 'monthly',
                interval: 1,
                item: { name: PLAN_NOTE, amount: PLAN_AMOUNT, currency: PLAN_CURRENCY },
            });
            planId = plan.id;
        }

        // Create subscription link via REST (SDK may not expose subscription_links)
        const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
        const payload = {
            plan_id: planId,
            customer_notify: 1,
            expire_by: Math.floor(Date.now() / 1000) + 15 * 60,
            quantity: 1,
            notes: { user_id: user.id, email: user.email },
            customer_details: {
                name: (customer && customer.name) || user.name || 'AutoScroll User',
                email: (customer && customer.email) || user.email,
                contact: (customer && customer.contact) || undefined,
            },
            options: { checkout: { method: { upi: 1 } } },
        };
        const { data: subLink } = await axios.post('https://api.razorpay.com/v1/subscription_links', payload, {
            headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        });

        return res.json({ success: true, data: { id: subLink.id, short_url: subLink.short_url, status: subLink.status } });
    } catch (error) {
        console.error('Create subscription link error:', error);
        return res.status(500).json({ success: false, message: 'Failed to create subscription link', error: error.message });
    }
});

/**
 * Webhook for Razorpay Subscriptions and Invoices
 */
const bodyParser = require('body-parser');
router.post('/webhook', bodyParser.raw({ type: '*/*' }), async (req, res) => {
    try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
        if (WEBHOOK_SECRET && !verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

    const event = typeof req.body === 'object' && !(req.body instanceof Buffer) ? req.body : JSON.parse(rawBody);
        const eventId = event?.payload?.payment?.entity?.id || event?.payload?.subscription?.entity?.id || event?.id || `${event.event}_${Date.now()}`;

        // Idempotency
        if (await ProcessedEvent.hasProcessed(eventId)) {
            return res.json({ success: true, message: 'Already processed' });
        }

        const markProcessed = async () => {
            try { await ProcessedEvent.create({ eventId, type: event.event, payload: event }); } catch (_) {}
        };

        switch (event.event) {
            case 'subscription.activated': {
                const sub = event.payload.subscription.entity;
                const userId = sub.notes?.user_id;
                if (userId) {
                    const user = await User.findById(userId);
                    if (user) {
                        user.subscriptionStatus = 'active';
                        user.hasAutoRenewal = true;
                        user.razorpaySubscriptionId = sub.id;
                        user.subscriptionExpiry = addMonths(new Date(), 1);
                        user.lastPaymentDate = new Date();
                        await user.save();
                    }
                }
                break;
            }
            case 'invoice.paid': {
                const sub = event.payload.subscription?.entity;
                const userId = sub?.notes?.user_id;
                if (userId) {
                    const user = await User.findById(userId);
                    if (user) {
                        const base = user.subscriptionExpiry && user.subscriptionExpiry > new Date() ? user.subscriptionExpiry : new Date();
                        user.subscriptionExpiry = addMonths(base, 1);
                        user.subscriptionStatus = 'active';
                        user.hasAutoRenewal = true;
                        if (sub?.id) user.razorpaySubscriptionId = sub.id;
                        user.lastPaymentDate = new Date();
                        await user.save();
                    }
                }
                break;
            }
            case 'invoice.payment_failed':
            case 'invoice.failed': {
                // You may record failure; do not change access immediately
                break;
            }
            case 'subscription.paused':
            case 'subscription.halted': {
                // Keep current expiry; disable auto-renew
                const sub = event.payload.subscription.entity;
                const userId = sub.notes?.user_id;
                if (userId) {
                    const user = await User.findById(userId);
                    if (user) { user.hasAutoRenewal = false; await user.save(); }
                }
                break;
            }
            case 'subscription.cancelled': {
                const sub = event.payload.subscription.entity;
                const userId = sub.notes?.user_id;
                if (userId) {
                    const user = await User.findById(userId);
                    if (user) {
                        user.subscriptionStatus = 'cancelled';
                        user.hasAutoRenewal = false;
                        // keep subscriptionExpiry as-is to preserve remaining access
                        await user.save();
                    }
                }
                break;
            }
            default:
                // ignore others
                break;
        }

        await markProcessed();
        return res.json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        return res.status(500).json({ success: false, message: 'Webhook processing failed', error: error.message });
    }
});

// Get user subscriptions (alias for /:userId)
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).select('subscriptionStatus isSubscriptionActive subscriptionExpiry trialDaysRemaining trialEndDate hasAutoRenewal');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                trialDaysRemaining: user.trialDaysRemaining,
                trialEndDate: user.trialEndDate,
                hasAutoRenewal: user.hasAutoRenewal
            }
        });
    } catch (error) {
        console.error('Subscription fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch subscription data',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Get user subscriptions
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).select('subscriptionStatus isSubscriptionActive subscriptionExpiry trialDaysRemaining trialEndDate hasAutoRenewal');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                trialDaysRemaining: user.trialDaysRemaining,
                trialEndDate: user.trialEndDate,
                hasAutoRenewal: user.hasAutoRenewal
            }
        });
    } catch (error) {
        console.error('Error fetching user subscriptions:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription data',
            error: error.message
        });
    }
});

// Get subscription status
router.get('/status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Calculate if trial is still active
        const now = new Date();
        const trialEndDate = user.trialEndDate;
        const isTrialActive = trialEndDate && now < trialEndDate;
        const trialDaysRemaining = isTrialActive ? Math.ceil((trialEndDate - now) / (24 * 60 * 60 * 1000)) : 0;

    const canUseExtension = user.canUseExtension || isTrialActive;

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                canUseExtension,
                trialDaysRemaining,
                isTrialActive,
                trialEndDate: user.trialEndDate,
                subscriptionExpiry: user.subscriptionExpiry,
                hasAutoRenewal: !!user.hasAutoRenewal
            }
        });
    } catch (error) {
        console.error('Error checking subscription status:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking subscription status',
            error: error.message
        });
    }
});

// Force refresh status (alias for GET but keeps payload contract consistent)
router.post('/refresh-status', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const now = new Date();
        const isTrialActive = user.trialEndDate && now < user.trialEndDate;
        const trialDaysRemaining = isTrialActive ? Math.ceil((user.trialEndDate - now) / (24 * 60 * 60 * 1000)) : 0;

        return res.json({
            success: true,
            message: 'Status refreshed',
            data: {
                userId: user.id,
                subscriptionStatus: user.subscriptionStatus,
                canUseExtension: user.canUseExtension || isTrialActive,
                trialDaysRemaining,
                subscriptionExpiry: user.subscriptionExpiry,
                hasAutoRenewal: !!user.hasAutoRenewal,
                refreshed: true
            }
        });
    } catch (error) {
        console.error('Refresh status error:', error);
        return res.status(500).json({ success: false, message: 'Failed to refresh status', error: error.message });
    }
});

// Activate subscription
router.post('/activate', async (req, res) => {
    try {
        const { userId, subscriptionType = 'monthly', paymentMethod } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Activate subscription
        const subscriptionExpiry = new Date();
        subscriptionExpiry.setMonth(subscriptionExpiry.getMonth() + 1); // 1 month subscription

        user.subscriptionStatus = 'active';
        user.isSubscriptionActive = true;
        user.subscriptionExpiry = subscriptionExpiry;
        user.hasAutoRenewal = true;
        user.updatedAt = new Date();

        await user.save();

        res.json({
            success: true,
            data: {
                userId,
                subscriptionStatus: user.subscriptionStatus,
                isSubscriptionActive: user.isSubscriptionActive,
                subscriptionExpiry: user.subscriptionExpiry,
                subscriptionType,
                paymentMethod
            },
            message: 'Subscription activated successfully'
        });
    } catch (error) {
        console.error('Error activating subscription:', error);
        res.status(500).json({
            success: false,
            message: 'Error activating subscription',
            error: error.message
        });
    }
});

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Subscriptions service is running correctly',
        timestamp: new Date().toISOString()
    });
});

// Cancel subscription
router.post('/cancel', async (req, res) => {
    try {
    const { userId } = req.body;

    const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Cancel at Razorpay if we have subscription id
        if (user.razorpaySubscriptionId) {
            try {
                await razorpay.subscriptions.cancel(user.razorpaySubscriptionId, { cancel_at_cycle_end: 0 });
            } catch (e) {
                console.warn('Razorpay cancel failed or already cancelled:', e.message);
            }
        }

        user.subscriptionStatus = 'cancelled';
        user.hasAutoRenewal = false;
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
 
// Dev-only helpers (not mounted in production)
if (process.env.NODE_ENV !== 'production') {
    router.post('/simulate-activation', async (req, res) => {
        try {
            const { userId } = req.body;
            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            user.subscriptionStatus = 'active';
            user.hasAutoRenewal = true;
            user.subscriptionExpiry = addMonths(new Date(), 1);
            user.lastPaymentDate = new Date();
            await user.save();
            return res.json({ success: true, message: 'Simulated activation', data: { userId: user.id, subscriptionExpiry: user.subscriptionExpiry } });
        } catch (e) {
            return res.status(500).json({ success: false, message: e.message });
        }
    });

    router.post('/simulate-cancel', async (req, res) => {
        try {
            const { userId } = req.body;
            const user = await User.findById(userId);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            user.subscriptionStatus = 'cancelled';
            user.hasAutoRenewal = false;
            await user.save();
            return res.json({ success: true, message: 'Simulated cancel', data: { userId: user.id } });
        } catch (e) {
            return res.status(500).json({ success: false, message: e.message });
        }
    });
}
