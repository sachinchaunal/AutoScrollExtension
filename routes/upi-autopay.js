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
    planId: process.env.RAZORPAY_PLAN_ID,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    subscriptionPrice: parseInt(process.env.SUBSCRIPTION_PRICE) || 9,
    webhookUrl: process.env.NODE_ENV === 'production' 
        ? 'https://autoscrollextension.onrender.com/api/upi-autopay/webhook'
        : 'http://localhost:3000/api/upi-autopay/webhook'
};

/**
 * � Debug plan endpoint
 */
router.get('/debug-plan', async (req, res) => {
    try {
        console.log('Fetching plan for debugging...');
        const plan = await razorpay.plans.fetch(CONFIG.planId);
        
        res.json({
            success: true,
            message: 'Plan debug successful',
            data: {
                planId: CONFIG.planId,
                planStatus: plan.status,
                planDetails: plan
            }
        });
    } catch (error) {
        console.error('Debug plan error:', error);
        res.status(500).json({
            success: false,
            message: 'Debug plan failed',
            error: error.message
        });
    }
});

/**
 * �🚀 NEW SIMPLE SUBSCRIPTION SYSTEM
 * Creates a Razorpay subscription link for UPI AutoPay
 */
router.post('/create-subscription', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Get user details
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if user already has an active subscription
        if (user.subscriptionStatus === 'active') {
            return res.status(400).json({
                success: false,
                message: 'User already has an active subscription'
            });
        }

        // For testing: Allow trial users to create subscriptions
        console.log(`User subscription status: ${user.subscriptionStatus}`);

        // Verify plan exists and is active
        console.log('Checking Razorpay plan...');
        try {
            const plan = await razorpay.plans.fetch(CONFIG.planId);
            console.log('Plan status:', plan.status);
            console.log('Plan details:', JSON.stringify(plan, null, 2));
        } catch (planError) {
            console.error('Plan fetch error:', planError);
            throw new Error(`Plan verification failed: ${planError.message}`);
        }

        console.log(`Creating subscription for user: ${user.email}`);

        // Step 1: Create or Find Razorpay Customer
        console.log('Step 1: Creating or finding Razorpay customer...');
        let customer;
        try {
            // First try to create a new customer
            customer = await razorpay.customers.create({
                name: user.name || 'AutoScroll User',
                email: user.email,
                contact: user.phone || '+919999999999',
                notes: {
                    user_id: userId,
                    platform: 'autoscroll_extension'
                }
            });
            console.log(`✅ Created new Razorpay customer: ${customer.id}`);
        } catch (customerError) {
            console.log('❌ Customer creation failed, checking if customer already exists...');
            console.log('Customer error:', customerError.message);
            
            // If customer already exists, try to find them
            if (customerError.message && customerError.message.includes('Customer already exists')) {
                try {
                    console.log('🔍 Searching for existing customer...');
                    // Search for existing customer by email
                    const customers = await razorpay.customers.all({
                        count: 10,
                        skip: 0
                    });
                    
                    const existingCustomer = customers.items.find(c => c.email === user.email);
                    
                    if (existingCustomer) {
                        customer = existingCustomer;
                        console.log(`✅ Found existing Razorpay customer: ${customer.id}`);
                    } else {
                        throw new Error('Customer exists but could not be found in search');
                    }
                } catch (searchError) {
                    console.error('❌ Failed to find existing customer:', searchError);
                    throw new Error(`Customer lookup failed: ${searchError.message}`);
                }
            } else {
                // Some other error occurred
                console.error('❌ Customer creation failed with unexpected error:', customerError);
                console.error('❌ Customer error full details:', JSON.stringify(customerError, null, 2));
                
                const errorMessage = customerError.message || 
                                    customerError.description || 
                                    customerError.error?.description || 
                                    `Razorpay API Error (${customerError.statusCode})`;
                
                throw new Error(`Customer creation failed: ${errorMessage}`);
            }
        }

        // Step 2: Create Subscription
        console.log('Step 2: Creating subscription...');
        const subscription = await razorpay.subscriptions.create({
            plan_id: CONFIG.planId,
            customer_id: customer.id,
            quantity: 1,
            total_count: 60, // 5 years (60 months)
            customer_notify: true,
            notes: {
                user_id: userId,
                platform: 'autoscroll_extension'
            }
        });

        console.log(`Created subscription: ${subscription.id}`);
        console.log(`Subscription URL: ${subscription.short_url}`);

        // Step 3: Update user with subscription details
        user.razorpayCustomerId = customer.id;
        user.razorpaySubscriptionId = subscription.id;
        // For local testing, set to trial since webhooks won't work
        // In production, webhooks will update this to 'active' after payment
        user.subscriptionStatus = 'trial'; // Will be updated via webhook in production
        await user.save();

        res.json({
            success: true,
            data: {
                subscriptionId: subscription.id,
                customerId: customer.id,
                subscriptionUrl: subscription.short_url,
                amount: CONFIG.subscriptionPrice,
                currency: 'INR',
                status: 'created'
            },
            message: 'Subscription created successfully. Please complete payment.'
        });

    } catch (error) {
        console.error('Create subscription error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        res.status(500).json({
            success: false,
            message: 'Failed to create subscription',
            error: error.message,
            details: error.description || 'No additional details',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * 📊 Get subscription status
 */
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

        res.json({
            success: true,
            data: {
                subscriptionStatus: user.subscriptionStatus || 'inactive',
                hasActiveSubscription: user.isSubscriptionActive || false,
                subscriptionId: user.razorpaySubscriptionId,
                customerId: user.razorpayCustomerId,
                nextBillingDate: user.subscriptionExpiry
            }
        });

    } catch (error) {
        console.error('Get subscription status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get subscription status',
            error: error.message
        });
    }
});

/**
 * ❌ Cancel subscription
 */
router.post('/cancel/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

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

        // Cancel subscription on Razorpay
        await razorpay.subscriptions.cancel(user.razorpaySubscriptionId, {
            cancel_at_cycle_end: false
        });

        // Update user status
        user.subscriptionStatus = 'cancelled';
        user.isSubscriptionActive = false;
        user.hasAutoRenewal = false;
        await user.save();

        res.json({
            success: true,
            message: 'Subscription cancelled successfully'
        });

    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel subscription',
            error: error.message
        });
    }
});

/**
 * 🔔 Webhook handler for Razorpay events
 */
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);

        // Verify webhook signature
        const expectedSignature = crypto
            .createHmac('sha256', CONFIG.webhookSecret)
            .update(body)
            .digest('hex');

        if (signature !== expectedSignature && process.env.NODE_ENV === 'production') {
            console.log('❌ Invalid webhook signature');
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const event = req.body;
        console.log(`🔔 Webhook received: ${event.event}`);

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

            default:
                console.log(`⚠️ Unhandled webhook event: ${event.event}`);
        }

        res.json({ success: true, message: 'Webhook processed' });

    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({ success: false, message: 'Webhook processing failed' });
    }
});

// Webhook handlers
async function handleSubscriptionActivated(subscription) {
    try {
        const userId = subscription.notes?.user_id;
        if (!userId) return;

        const user = await User.findById(userId);
        if (!user) return;

        user.subscriptionStatus = 'active';
        user.isSubscriptionActive = true;
        user.hasAutoRenewal = true;
        user.subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await user.save();

        console.log(`✅ Subscription activated for user: ${user.email}`);
    } catch (error) {
        console.error('Error handling subscription activation:', error);
    }
}

async function handleSubscriptionCharged(payment, subscription) {
    try {
        const userId = subscription.notes?.user_id;
        if (!userId) return;

        const user = await User.findById(userId);
        if (!user) return;

        // Extend subscription expiry
        user.subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
        user.subscriptionStatus = 'active';
        user.isSubscriptionActive = true;
        await user.save();

        console.log(`💰 Payment successful for user: ${user.email}, Amount: ${payment.amount/100}`);
    } catch (error) {
        console.error('Error handling subscription charge:', error);
    }
}

async function handleSubscriptionCancelled(subscription) {
    try {
        const userId = subscription.notes?.user_id;
        if (!userId) return;

        const user = await User.findById(userId);
        if (!user) return;

        user.subscriptionStatus = 'cancelled';
        user.isSubscriptionActive = false;
        user.hasAutoRenewal = false;
        await user.save();

        console.log(`❌ Subscription cancelled for user: ${user.email}`);
    } catch (error) {
        console.error('Error handling subscription cancellation:', error);
    }
}

async function handleSubscriptionHalted(subscription) {
    try {
        const userId = subscription.notes?.user_id;
        if (!userId) return;

        const user = await User.findById(userId);
        if (!user) return;

        user.subscriptionStatus = 'halted';
        user.isSubscriptionActive = false;
        await user.save();

        console.log(`⏸️ Subscription halted for user: ${user.email}`);
    } catch (error) {
        console.error('Error handling subscription halt:', error);
    }
}

/**
 * 🧪 Test configuration endpoint
 */
router.get('/test-config', async (req, res) => {
    try {
        // Test plan fetch
        const plan = await razorpay.plans.fetch(CONFIG.planId);
        
        res.json({
            success: true,
            message: 'Configuration test passed',
            data: {
                environment: process.env.NODE_ENV || 'development',
                planId: CONFIG.planId,
                planActive: plan.status === 'active',
                planAmount: plan.item.amount / 100,
                webhookUrl: CONFIG.webhookUrl,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Configuration test failed',
            error: error.message
        });
    }
});

/**
 * 👤 Create test user
 */
router.post('/create-test-user', async (req, res) => {
    try {
        // Delete any existing test users first
        await User.deleteMany({ email: { $regex: /test\..*@autoscroll\.test|sachinchaunal@gmail\.com/ } });
        
        // Create new test user with unique email to avoid Razorpay customer conflict
        const testUser = new User({
            googleId: 'test_google_id_' + Date.now(),
            email: `test.${Date.now()}@autoscroll.test`,
            name: 'Test User',
            picture: 'https://lh3.googleusercontent.com/test',
            verified_email: true,
            subscriptionStatus: 'trial',
            trialDaysRemaining: 10,
            trialStartDate: new Date(),
            trialEndDate: new Date(Date.now() + (10 * 24 * 60 * 60 * 1000)),
            isTrialActive: true
        });

        await testUser.save();

        res.json({
            success: true,
            message: 'Test user created successfully',
            data: {
                userId: testUser._id,
                email: testUser.email,
                name: testUser.name,
                subscriptionStatus: testUser.subscriptionStatus
            }
        });

    } catch (error) {
        console.error('Create test user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create test user',
            error: error.message
        });
    }
});

/**
 * 🧪 Simple test endpoint
 */
router.post('/test-simple', async (req, res) => {
    try {
        const { userId } = req.body;
        console.log('Test endpoint called with userId:', userId);
        
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

        res.json({
            success: true,
            message: 'Test successful',
            data: {
                userId: user._id,
                email: user.email,
                config: CONFIG
            }
        });
    } catch (error) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            success: false,
            message: 'Test failed',
            error: error.message
        });
    }
});

/**
 * 🧪 Get test user for testing
 */
router.get('/test-user', async (req, res) => {
    try {
        const user = await User.findOne({ email: 'sachinchaunal@gmail.com' });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Test user not found'
            });
        }
        
        res.json({
            success: true,
            data: {
                userId: user._id,
                email: user.email,
                name: user.name,
                subscriptionStatus: user.subscriptionStatus
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get test user',
            error: error.message
        });
    }
});

/**
 * 📋 Get plan configuration
 */
router.get('/plan-config', async (req, res) => {
    try {
        const plan = await razorpay.plans.fetch(CONFIG.planId);
        
        res.json({
            success: true,
            data: {
                planId: CONFIG.planId,
                amount: plan.item.amount / 100,
                currency: plan.item.currency,
                interval: plan.period,
                description: plan.item.description,
                planDetails: plan
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get plan configuration',
            error: error.message
        });
    }
});

/**
 * 🧪 Test webhook simulation (for local testing only)
 * Since webhooks won't work locally, this endpoint simulates subscription activation
 */
router.post('/test-activate-subscription', async (req, res) => {
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
                message: 'User has no subscription to activate'
            });
        }

        // Simulate webhook - activate the subscription
        user.subscriptionStatus = 'active';
        user.subscriptionStartDate = new Date();
        user.subscriptionExpiry = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 days
        user.lastPaymentDate = new Date();
        user.autoPayEnabled = true;
        user.isTrialActive = false;
        
        await user.save();

        console.log(`✅ Simulated webhook activation for user ${user.email}`);

        res.json({
            success: true,
            message: 'Subscription activated successfully (simulated webhook)',
            data: {
                userId: user._id,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionExpiry: user.subscriptionExpiry,
                autoPayEnabled: user.autoPayEnabled
            }
        });

    } catch (error) {
        console.error('Test webhook simulation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to simulate webhook',
            error: error.message
        });
    }
});

module.exports = router;
