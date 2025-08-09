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

        console.log('Creating subscription for user:', {
            userId: user._id,
            email: user.email,
            name: user.name
        });

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

        // Create subscription using the older API approach
        // First create a customer
        const customer = await razorpay.customers.create({
            name: user.name || 'AutoScroll User',
            email: user.email || 'user@autoscroll.com',
            contact: '+919999999999',
            notes: {
                user_id: userId,
                source: 'extension'
            }
        });

        // Then create subscription
        const subscriptionOptions = {
            plan_id: CONFIG.planId,
            customer_id: customer.id,
            quantity: 1,
            total_count: 60, // 5 years worth (60 months)
            customer_notify: 1,
            notes: {
                user_id: userId,
                source: 'extension',
                plan_type: 'monthly'
            }
        };

        console.log('Creating Razorpay subscription with options:', subscriptionOptions);

        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        
        // Create payment link for the first payment
        const paymentLinkOptions = {
            amount: CONFIG.subscriptionPrice * 100, // Convert to paise
            currency: 'INR',
            accept_partial: false,
            description: 'AutoScroll Extension - First Payment & Setup AutoPay',
            customer: {
                name: user.name || 'AutoScroll User',
                email: user.email,
                contact: '+919999999999'
            },
            notify: {
                sms: false,
                email: true
            },
            reminder_enable: false,
            notes: {
                subscription_id: subscription.id,
                user_id: userId,
                type: 'first_payment'
            },
            callback_url: `${CONFIG.apiBaseUrl}/api/razorpay-subscriptions/callback`,
            callback_method: 'get'
        };

        const paymentLink = await razorpay.paymentLink.create(paymentLinkOptions);

        console.log('Payment link created:', {
            id: paymentLink.id,
            short_url: paymentLink.short_url,
            status: paymentLink.status
        });

        // Store subscription and payment link reference in user
        user.razorpaySubscriptionId = subscription.id;
        user.razorpayCustomerId = customer.id;
        user.razorpaySubscriptionLinkId = paymentLink.id;
        user.subscriptionLinkCreatedAt = new Date();
        await user.save();

        res.json({
            success: true,
            message: 'Subscription created successfully',
            data: {
                subscriptionId: subscription.id,
                paymentLinkId: paymentLink.id,
                subscriptionUrl: paymentLink.short_url,
                amount: CONFIG.subscriptionPrice,
                planType: 'Monthly',
                instructions: [
                    '1. Click the payment link below',
                    '2. Choose UPI as payment method',
                    '3. Complete the payment to activate subscription',
                    '4. AutoPay will be set up automatically for future renewals',
                    '5. You can cancel anytime from the extension settings'
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
                
            case 'payment.captured':
                await handlePaymentCaptured(event.payload.payment.entity);
                break;
                
            case 'payment_link.paid':
                await handlePaymentLinkPaid(event.payload);
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

// Handle payment captured (for first payment)
async function handlePaymentCaptured(payment) {
    try {
        console.log('Processing payment.captured:', payment.id);
        
        // Find user by payment notes
        if (payment.notes && payment.notes.user_id) {
            const user = await User.findById(payment.notes.user_id);
            if (user && payment.notes.type === 'first_payment') {
                // This is the first payment, activate the subscription
                user.subscriptionStatus = 'active';
                user.hasAutoRenewal = true;
                user.lastPaymentDate = new Date();
                
                // Set subscription expiry to next billing cycle
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + 30); // Monthly subscription
                user.subscriptionExpiry = expiry;
                
                await user.save();
                console.log(`First payment processed for user ${user._id}: ${payment.id}`);
            }
        }
        
    } catch (error) {
        console.error('Error handling payment capture:', error);
    }
}

// Handle payment link paid event
async function handlePaymentLinkPaid(payload) {
    try {
        const { payment_link, payment } = payload;
        
        console.log('Processing payment_link.paid event:', {
            payment_link_id: payment_link.entity.id,
            payment_id: payment.entity.id,
            amount: payment.entity.amount
        });
        
        // Find user by payment link ID
        const user = await User.findOne({ 
            razorpaySubscriptionLinkId: payment_link.entity.id 
        });
        
        if (user) {
            console.log('Found user for payment link:', user._id);
            
            // Activate subscription for this user
            user.subscriptionStatus = 'active';
            user.hasAutoRenewal = true;
            user.lastPaymentDate = new Date();
            
            // Set initial subscription expiry (30 days from now)
            const expiry = new Date();
            expiry.setDate(expiry.getDate() + 30);
            user.subscriptionExpiry = expiry;
            
            await user.save();
            console.log('Payment link paid processed successfully for user:', user._id);
        } else {
            console.error('No user found for payment link:', payment_link.entity.id);
        }
    } catch (error) {
        console.error('Error handling payment_link.paid:', error);
    }
}

// Callback handler for payment link
router.get('/callback', async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_payment_link_id, razorpay_payment_link_status } = req.query;
        
        console.log('Payment callback received:', { 
            payment_id: razorpay_payment_id, 
            payment_link_id: razorpay_payment_link_id, 
            status: razorpay_payment_link_status 
        });
        
        if (razorpay_payment_link_status === 'paid' && razorpay_payment_link_id) {
            // Find user by payment link ID
            const user = await User.findOne({ razorpaySubscriptionLinkId: razorpay_payment_link_id });
            
            if (user) {
                user.subscriptionStatus = 'active';
                user.hasAutoRenewal = true;
                user.lastPaymentDate = new Date();
                
                // Set subscription expiry
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + 30);
                user.subscriptionExpiry = expiry;
                
                await user.save();
                
                console.log(`Payment callback processed for user ${user._id}`);
                
                // Redirect to extension with success status
                res.redirect(`${CONFIG.frontendUrl}/popup.html?subscription=success`);
            } else {
                console.error('User not found for payment link:', razorpay_payment_link_id);
                res.redirect(`${CONFIG.frontendUrl}/popup.html?subscription=error`);
            }
        } else {
            res.redirect(`${CONFIG.frontendUrl}/popup.html?subscription=failed`);
        }
        
    } catch (error) {
        console.error('Callback error:', error);
        res.redirect(`${CONFIG.frontendUrl}/popup.html?subscription=error`);
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
