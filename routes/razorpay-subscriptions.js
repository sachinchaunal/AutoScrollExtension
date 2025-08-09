const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Configuration
const CONFIG = {
    subscriptionPrice: parseInt(process.env.SUBSCRIPTION_PRICE) || 9,
    planId: process.env.RAZORPAY_PLAN_ID,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'
};

// Test Razorpay configuration
router.get('/test', async (req, res) => {
    try {
        console.log('Testing Razorpay configuration...');
        
        // Test plan fetch
        const plan = await razorpay.plans.fetch(CONFIG.planId);
        
        res.json({
            success: true,
            message: 'Razorpay configuration is working',
            data: {
                planId: plan.id,
                amount: plan.item.amount,
                interval: plan.interval,
                period: plan.period
            }
        });

    } catch (error) {
        console.error('Razorpay configuration test failed:', error);
        res.status(500).json({
            success: false,
            message: 'Razorpay configuration test failed',
            error: error.message,
            config: {
                hasKeyId: !!process.env.RAZORPAY_KEY_ID,
                hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET,
                hasPlanId: !!CONFIG.planId,
                planId: CONFIG.planId
            }
        });
    }
});

// Create subscription link for UPI AutoPay
router.post('/create-subscription', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if user already has an active subscription
        if (user.subscriptionStatus === 'active' && user.hasAutoRenewal) {
            return res.status(400).json({
                success: false,
                message: 'User already has an active subscription',
                data: {
                    subscriptionStatus: user.subscriptionStatus,
                    subscriptionExpiry: user.subscriptionExpiry,
                    hasAutoRenewal: user.hasAutoRenewal
                }
            });
        }

        // Create subscription link
        const subscriptionLinkOptions = {
            plan_id: CONFIG.planId,
            customer_notify: 1,
            quantity: 1,
            total_count: 60, // 5 years worth (60 months)
            notes: {
                user_id: userId,
                source: 'extension',
                plan_type: 'monthly'
            },
            // Notify options
            notify: {
                email: true,
                sms: false
            },
            // Callback URLs
            callback_url: `${CONFIG.apiBaseUrl}/api/razorpay-subscriptions/callback`,
            callback_method: 'get'
        };

        console.log('Creating Razorpay subscription link with options:', subscriptionLinkOptions);

        const subscriptionLink = await razorpay.subscriptionLink.create(subscriptionLinkOptions);

        console.log('Subscription link created:', {
            id: subscriptionLink.id,
            short_url: subscriptionLink.short_url,
            status: subscriptionLink.status
        });

        // Store subscription link reference in user
        user.razorpaySubscriptionLinkId = subscriptionLink.id;
        user.subscriptionLinkCreatedAt = new Date();
        await user.save();

        res.json({
            success: true,
            message: 'Subscription link created successfully',
            data: {
                subscriptionLinkId: subscriptionLink.id,
                subscriptionUrl: subscriptionLink.short_url,
                amount: CONFIG.subscriptionPrice,
                planType: 'Monthly',
                instructions: [
                    '1. Click the subscription link below',
                    '2. Choose UPI as payment method',
                    '3. Scan QR code with your UPI app',
                    '4. Setup AutoPay for monthly renewals',
                    '5. Complete the payment to activate subscription'
                ]
            }
        });

    } catch (error) {
        console.error('Create subscription error:', error);
        
        // Handle specific Razorpay errors
        if (error.error && error.error.code) {
            return res.status(400).json({
                success: false,
                message: `Razorpay Error: ${error.error.description}`,
                code: error.error.code
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error creating subscription',
            error: error.message
        });
    }
});

// Check subscription status for user
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

        // Calculate remaining days
        let daysRemaining = 0;
        if (user.subscriptionStatus === 'trial' && user.trialEndDate) {
            const now = new Date();
            const trialEnd = new Date(user.trialEndDate);
            daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
        } else if (user.subscriptionStatus === 'active' && user.subscriptionExpiry) {
            const now = new Date();
            const expiry = new Date(user.subscriptionExpiry);
            daysRemaining = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
        }

        res.json({
            success: true,
            data: {
                userId: user._id,
                subscriptionStatus: user.subscriptionStatus || 'trial',
                hasAutoRenewal: user.hasAutoRenewal || false,
                subscriptionExpiry: user.subscriptionExpiry,
                lastPaymentDate: user.lastPaymentDate,
                daysRemaining,
                razorpaySubscriptionId: user.razorpaySubscriptionId,
                canUseExtension: true, // For now, always allow usage
                pendingSubscriptionLink: user.razorpaySubscriptionLinkId && !user.razorpaySubscriptionId
            }
        });

    } catch (error) {
        console.error('Get subscription status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription status',
            error: error.message
        });
    }
});

// Razorpay webhook handler
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        // Verify webhook signature
        const expectedSignature = crypto
            .createHmac('sha256', CONFIG.webhookSecret)
            .update(body)
            .digest('hex');
        
        console.log('Webhook signature verification:', {
            received: signature,
            expected: expectedSignature,
            match: signature === expectedSignature
        });
        
        // Skip signature verification in development if webhook secret is not properly set
        if (signature && signature !== expectedSignature && CONFIG.webhookSecret) {
            console.log('Invalid webhook signature - webhook processing skipped');
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const event = req.body;
        console.log('Razorpay webhook received:', event.event, event.payload?.subscription?.entity?.id || event.payload?.payment?.entity?.id);

        switch (event.event) {
            case 'subscription.activated':
                await handleSubscriptionActivated(event.payload.subscription.entity);
                break;
                
            case 'subscription.charged':
                await handleSubscriptionCharged(event.payload.payment.entity, event.payload.subscription.entity);
                break;
                
            case 'subscription.cancelled':
                await handleSubscriptionCancelled(event.payload.subscription.entity);
                break;
                
            case 'subscription.halted':
                await handleSubscriptionHalted(event.payload.subscription.entity);
                break;
                
            case 'subscription.paused':
                await handleSubscriptionPaused(event.payload.subscription.entity);
                break;
                
            case 'subscription.resumed':
                await handleSubscriptionResumed(event.payload.subscription.entity);
                break;
                
            case 'payment.failed':
                await handlePaymentFailed(event.payload.payment.entity);
                break;
                
            default:
                console.log('Unhandled webhook event:', event.event);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Handle subscription activation (first successful payment with autopay setup)
async function handleSubscriptionActivated(subscription) {
    try {
        console.log('Processing subscription.activated:', subscription.id);
        
        // Find user by notes
        const userId = subscription.notes?.user_id;
        if (!userId) {
            console.error('No user_id in subscription notes');
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            console.error('User not found for subscription:', userId);
            return;
        }

        // Update user subscription status
        user.subscriptionStatus = 'active';
        user.hasAutoRenewal = true;
        user.razorpaySubscriptionId = subscription.id;
        user.lastPaymentDate = new Date();
        
        // Set subscription expiry to next billing cycle
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30); // Monthly subscription
        user.subscriptionExpiry = expiry;
        
        await user.save();

        console.log(`Subscription activated for user ${userId}: ${subscription.id}`);

    } catch (error) {
        console.error('Error handling subscription activation:', error);
    }
}

// Handle successful recurring charge
async function handleSubscriptionCharged(payment, subscription) {
    try {
        console.log('Processing subscription.charged:', payment.id, 'for subscription:', subscription.id);
        
        // Find user by subscription ID
        const user = await User.findOne({ razorpaySubscriptionId: subscription.id });
        if (!user) {
            console.error('User not found for subscription:', subscription.id);
            return;
        }

        // Update last payment date
        user.lastPaymentDate = new Date();
        
        // Extend subscription expiry by 30 days
        const currentExpiry = new Date(user.subscriptionExpiry || new Date());
        const newExpiry = new Date(currentExpiry);
        newExpiry.setDate(newExpiry.getDate() + 30);
        user.subscriptionExpiry = newExpiry;
        
        // Ensure subscription is active
        user.subscriptionStatus = 'active';
        
        await user.save();

        console.log(`Subscription charged successfully for user ${user._id}: ${payment.id}`);

    } catch (error) {
        console.error('Error handling subscription charge:', error);
    }
}

// Handle subscription cancellation
async function handleSubscriptionCancelled(subscription) {
    try {
        console.log('Processing subscription.cancelled:', subscription.id);
        
        const user = await User.findOne({ razorpaySubscriptionId: subscription.id });
        if (!user) {
            console.error('User not found for subscription:', subscription.id);
            return;
        }

        // Disable auto-renewal but keep subscription active until expiry
        user.hasAutoRenewal = false;
        await user.save();

        console.log(`Subscription cancelled for user ${user._id}: ${subscription.id}`);

    } catch (error) {
        console.error('Error handling subscription cancellation:', error);
    }
}

// Handle subscription halt (multiple payment failures)
async function handleSubscriptionHalted(subscription) {
    try {
        console.log('Processing subscription.halted:', subscription.id);
        
        const user = await User.findOne({ razorpaySubscriptionId: subscription.id });
        if (!user) {
            console.error('User not found for subscription:', subscription.id);
            return;
        }

        // Mark subscription as inactive and disable auto-renewal
        user.subscriptionStatus = 'inactive';
        user.hasAutoRenewal = false;
        await user.save();

        console.log(`Subscription halted for user ${user._id}: ${subscription.id}`);

    } catch (error) {
        console.error('Error handling subscription halt:', error);
    }
}

// Handle subscription pause
async function handleSubscriptionPaused(subscription) {
    try {
        console.log('Processing subscription.paused:', subscription.id);
        
        const user = await User.findOne({ razorpaySubscriptionId: subscription.id });
        if (!user) {
            console.error('User not found for subscription:', subscription.id);
            return;
        }

        user.hasAutoRenewal = false;
        await user.save();

        console.log(`Subscription paused for user ${user._id}: ${subscription.id}`);

    } catch (error) {
        console.error('Error handling subscription pause:', error);
    }
}

// Handle subscription resume
async function handleSubscriptionResumed(subscription) {
    try {
        console.log('Processing subscription.resumed:', subscription.id);
        
        const user = await User.findOne({ razorpaySubscriptionId: subscription.id });
        if (!user) {
            console.error('User not found for subscription:', subscription.id);
            return;
        }

        user.subscriptionStatus = 'active';
        user.hasAutoRenewal = true;
        await user.save();

        console.log(`Subscription resumed for user ${user._id}: ${subscription.id}`);

    } catch (error) {
        console.error('Error handling subscription resume:', error);
    }
}

// Handle payment failure
async function handlePaymentFailed(payment) {
    try {
        console.log('Processing payment.failed:', payment.id);
        
        // Payment failures are automatically handled by Razorpay
        // They will retry and eventually halt the subscription if all retries fail
        
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
}

// Callback handler for subscription link
router.get('/callback', async (req, res) => {
    try {
        const { subscription_id, subscription_link_id, status } = req.query;
        
        console.log('Subscription callback received:', { subscription_id, subscription_link_id, status });
        
        if (status === 'activated' && subscription_id) {
            // Find user by subscription link ID
            const user = await User.findOne({ razorpaySubscriptionLinkId: subscription_link_id });
            
            if (user) {
                user.razorpaySubscriptionId = subscription_id;
                user.subscriptionStatus = 'active';
                user.hasAutoRenewal = true;
                user.lastPaymentDate = new Date();
                
                // Set subscription expiry
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + 30);
                user.subscriptionExpiry = expiry;
                
                await user.save();
                
                console.log(`Subscription callback processed for user ${user._id}`);
            }
        }
        
        // Redirect to extension with status
        const redirectUrl = `${CONFIG.frontendUrl}/popup.html?subscription=${status || 'success'}`;
        res.redirect(redirectUrl);
        
    } catch (error) {
        console.error('Callback error:', error);
        const redirectUrl = `${CONFIG.frontendUrl}/popup.html?subscription=error`;
        res.redirect(redirectUrl);
    }
});

// Cancel subscription
router.post('/cancel-subscription', async (req, res) => {
    try {
        const { userId } = req.body;

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

        if (!user.razorpaySubscriptionId) {
            return res.status(400).json({
                success: false,
                message: 'No active subscription found'
            });
        }

        // Cancel Razorpay subscription
        await razorpay.subscriptions.cancel(user.razorpaySubscriptionId, {
            cancel_at_cycle_end: 1 // Cancel at the end of current billing cycle
        });

        // Update user - disable auto-renewal but keep subscription active until expiry
        user.hasAutoRenewal = false;
        await user.save();

        res.json({
            success: true,
            message: 'Subscription cancelled successfully. You can continue using the extension until your current billing period ends.',
            data: {
                subscriptionExpiry: user.subscriptionExpiry,
                hasAutoRenewal: false
            }
        });

    } catch (error) {
        console.error('Cancel subscription error:', error);
        
        if (error.error && error.error.code) {
            return res.status(400).json({
                success: false,
                message: `Razorpay Error: ${error.error.description}`,
                code: error.error.code
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error cancelling subscription',
            error: error.message
        });
    }
});

module.exports = router;
