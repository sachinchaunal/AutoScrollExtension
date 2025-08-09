const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const UpiMandate = require('../models/UpiMandate');
const User = require('../models/User');
const Payment = require('../models/Payment');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Configuration
const CONFIG = {
    planId: process.env.RAZORPAY_PLAN_ID,
    subscriptionPrice: parseInt(process.env.SUBSCRIPTION_PRICE) || 9,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET,
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'
};

/**
 * Get AutoPay plan configuration
 * Returns plan details and pricing information
 */
router.get('/plan-config', async (req, res) => {
    try {
        // Verify Razorpay configuration
        if (!CONFIG.planId) {
            return res.status(500).json({
                success: false,
                message: 'AutoPay plan not configured'
            });
        }

        // Get plan details from Razorpay
        let planDetails = null;
        try {
            planDetails = await razorpay.plans.fetch(CONFIG.planId);
        } catch (error) {
            console.error('Error fetching plan from Razorpay:', error);
        }

        res.json({
            success: true,
            data: {
                planId: CONFIG.planId,
                amount: CONFIG.subscriptionPrice,
                currency: 'INR',
                interval: 'monthly',
                description: 'AutoScroll Extension Premium Monthly Subscription',
                planDetails: planDetails ? {
                    id: planDetails.id,
                    amount: planDetails.item.amount / 100, // Convert from paisa to rupees
                    currency: planDetails.item.currency,
                    interval: planDetails.period,
                    intervalCount: planDetails.interval
                } : null,
                isConfigured: !!planDetails
            }
        });

    } catch (error) {
        console.error('Error in plan config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get plan configuration',
            error: error.message
        });
    }
});

/**
 * Create a proper UPI AutoPay mandate using Razorpay Subscriptions
 * This creates a true recurring payment setup, not just a payment link
 */
router.post('/create-autopay', async (req, res) => {
    try {
        const { userId, customerName, customerEmail, customerPhone } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        if (!CONFIG.planId) {
            return res.status(500).json({
                success: false,
                message: 'Razorpay Plan ID not configured. Please set RAZORPAY_PLAN_ID environment variable.'
            });
        }

        // Verify the plan exists and is active
        let planDetails;
        try {
            planDetails = await razorpay.plans.fetch(CONFIG.planId);
            console.log('Plan verification successful:', planDetails.id, 'Status:', planDetails.item.active);
            
            if (!planDetails.item.active) {
                return res.status(500).json({
                    success: false,
                    message: 'The subscription plan is not active. Please contact support.'
                });
            }
        } catch (planError) {
            console.error('Plan verification failed:', planError);
            return res.status(500).json({
                success: false,
                message: 'Invalid subscription plan configuration. Please contact support.',
                error: planError.message
            });
        }

        // Check if user already has an active mandate
        const existingMandate = await UpiMandate.findOne({
            userId,
            status: { $in: ['PENDING', 'ACTIVE'] }
        });

        if (existingMandate) {
            return res.status(400).json({
                success: false,
                message: 'User already has an active mandate',
                data: {
                    mandateId: existingMandate.mandateId,
                    status: existingMandate.status,
                    subscriptionId: existingMandate.razorpaySubscriptionId
                }
            });
        }

        // Generate local mandate ID
        const mandateId = `AUTOPAY_${userId}_${Date.now()}`;

        // Step 1: Create Razorpay Customer (or use existing)
        let customer;
        try {
            customer = await razorpay.customers.create({
                name: customerName || 'AutoScroll User',
                email: customerEmail || `user_${userId}@autoscroll.com`,
                contact: customerPhone || process.env.DEFAULT_CUSTOMER_PHONE || '+919999999999',
                notes: {
                    mandate_id: mandateId,
                    user_id: userId,
                    platform: 'autoscroll_extension'
                }
            });
            console.log('Created new Razorpay customer:', customer.id);
        } catch (customerError) {
            // If customer with same email/phone exists, try with unique email
            if (customerError.error && customerError.error.code === 'BAD_REQUEST_ERROR') {
                const uniqueEmail = `user_${userId}_${Date.now()}@autoscroll.com`;
                customer = await razorpay.customers.create({
                    name: customerName || 'AutoScroll User',
                    email: uniqueEmail,
                    contact: customerPhone || process.env.DEFAULT_CUSTOMER_PHONE || '+919999999999',
                    notes: {
                        mandate_id: mandateId,
                        user_id: userId,
                        platform: 'autoscroll_extension'
                    }
                });
                console.log('Created Razorpay customer with unique email:', customer.id);
            } else {
                throw customerError;
            }
        }

        // Step 2: Create Subscription with UPI AutoPay
        const subscriptionOptions = {
            plan_id: CONFIG.planId,
            customer_id: customer.id,
            quantity: 1,
            total_count: 60, // 5 years (60 months)
            customer_notify: 1,
            notes: {
                mandate_id: mandateId,
                user_id: userId,
                platform: 'autoscroll_extension'
            }
        };

        // Don't set start_at for immediate availability of payment URL
        console.log('Creating Razorpay subscription with options:', JSON.stringify(subscriptionOptions, null, 2));
        
        let subscription;
        try {
            subscription = await razorpay.subscriptions.create(subscriptionOptions);
            console.log('Created Razorpay subscription:', subscription.id);
            console.log('Subscription short_url:', subscription.short_url);
            console.log('Subscription status:', subscription.status);
            console.log('Full subscription object:', JSON.stringify(subscription, null, 2));
        } catch (subscriptionError) {
            console.error('Subscription creation failed:', subscriptionError);
            console.error('Subscription error details:', subscriptionError.error);
            throw new Error(`Failed to create Razorpay subscription: ${subscriptionError.message}`);
        }

        // Step 3: Create mandate record in database
        const subscriptionStartDate = subscription.start_at ? 
            new Date(subscription.start_at * 1000) : 
            new Date(); // Fallback to current time
            
        const subscriptionEndDate = subscription.end_at ? 
            new Date(subscription.end_at * 1000) : 
            new Date(Date.now() + (60 * 30 * 24 * 60 * 60 * 1000)); // 60 months from now
            
        const mandate = new UpiMandate({
            userId,
            mandateId,
            upiId: null, // Will be set when user provides UPI ID during payment
            merchantVpa: process.env.MERCHANT_UPI_ID,
            amount: CONFIG.subscriptionPrice,
            startDate: subscriptionStartDate,
            endDate: subscriptionEndDate,
            nextChargeDate: subscriptionStartDate,
            status: 'PENDING',
            razorpayCustomerId: customer.id,
            razorpaySubscriptionId: subscription.id,
            metadata: {
                userAgent: req.headers['user-agent'],
                ipAddress: req.ip,
                platform: 'extension',
                subscriptionType: 'upi_autopay'
            }
        });

        await mandate.save();

        // Validate subscription URL
        if (!subscription.short_url) {
            console.error('Warning: Razorpay subscription created but no short_url provided');
            console.log('Full subscription object:', JSON.stringify(subscription, null, 2));
        }

        res.json({
            success: true,
            message: 'UPI AutoPay mandate created successfully',
            data: {
                mandateId: mandate.mandateId,
                subscriptionId: subscription.id,
                customerId: customer.id,
                subscriptionUrl: subscription.short_url || null,
                amount: mandate.amount,
                startDate: mandate.startDate,
                endDate: mandate.endDate,
                nextChargeDate: mandate.nextChargeDate,
                status: 'PENDING',
                debug: {
                    hasShortUrl: !!subscription.short_url,
                    subscriptionStatus: subscription.status,
                    subscriptionCreatedAt: subscription.created_at
                },
                instructions: subscription.short_url ? [
                    '1. Click the subscription link to setup UPI AutoPay',
                    '2. Select your UPI app and complete authentication',
                    '3. Approve the recurring payment mandate',
                    '4. Your subscription will be automatically charged monthly',
                    '5. You can cancel anytime from the extension settings'
                ] : [
                    'Subscription created but payment link not immediately available.',
                    'Please check status again in a few moments or contact support.'
                ]
            }
        });

    } catch (error) {
        console.error('Create UPI autopay error:', error);
        
        if (error.error && error.error.code) {
            return res.status(400).json({
                success: false,
                message: `Razorpay Error: ${error.error.description}`,
                code: error.error.code
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error creating UPI autopay mandate',
            error: error.message
        });
    }
});

/**
 * Test Razorpay configuration and plan accessibility
 */
router.get('/test-razorpay-config', async (req, res) => {
    try {
        const results = {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            config: {
                hasKeyId: !!process.env.RAZORPAY_KEY_ID,
                hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET,
                hasPlanId: !!CONFIG.planId,
                planId: CONFIG.planId,
                subscriptionPrice: CONFIG.subscriptionPrice
            },
            tests: {}
        };

        // Test 1: Fetch plan details
        try {
            const plan = await razorpay.plans.fetch(CONFIG.planId);
            results.tests.planFetch = {
                success: true,
                planId: plan.id,
                amount: plan.item.amount,
                currency: plan.item.currency,
                active: plan.item.active,
                interval: plan.interval,
                period: plan.period
            };
        } catch (planError) {
            results.tests.planFetch = {
                success: false,
                error: planError.message,
                code: planError.error?.code
            };
        }

        // Test 2: Check API connectivity
        try {
            const plans = await razorpay.plans.all({ count: 1 });
            results.tests.apiConnectivity = {
                success: true,
                message: 'Razorpay API is accessible'
            };
        } catch (apiError) {
            results.tests.apiConnectivity = {
                success: false,
                error: apiError.message,
                code: apiError.error?.code
            };
        }

        // Test 3: Create test customer (without saving to DB)
        try {
            const testCustomer = await razorpay.customers.create({
                name: 'Test Customer',
                email: `test_${Date.now()}@autoscroll.com`,
                contact: '+919999999999'
            });
            
            results.tests.customerCreation = {
                success: true,
                customerId: testCustomer.id
            };
            
            // Cleanup: Since this is just a test, we could delete the customer
            // but Razorpay doesn't allow customer deletion, so we'll leave it
            
        } catch (customerError) {
            results.tests.customerCreation = {
                success: false,
                error: customerError.message,
                code: customerError.error?.code
            };
        }

        res.json({
            success: true,
            message: 'Razorpay configuration test completed',
            data: results
        });

    } catch (error) {
        console.error('Razorpay config test error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to test Razorpay configuration',
            error: error.message
        });
    }
});

/**
 * Verify subscription URL accessibility
 * Helps debug hosted page issues
 */
router.get('/verify-subscription/:subscriptionId', async (req, res) => {
    try {
        const { subscriptionId } = req.params;
        
        // Fetch subscription details from Razorpay
        const subscription = await razorpay.subscriptions.fetch(subscriptionId);
        
        res.json({
            success: true,
            data: {
                subscriptionId: subscription.id,
                status: subscription.status,
                shortUrl: subscription.short_url,
                hasShortUrl: !!subscription.short_url,
                currentPeriodStart: subscription.current_start,
                currentPeriodEnd: subscription.current_end,
                planId: subscription.plan_id,
                customerId: subscription.customer_id,
                createdAt: subscription.created_at,
                debugInfo: {
                    urlActive: !!subscription.short_url,
                    subscriptionActive: subscription.status === 'created' || subscription.status === 'active',
                    troubleshooting: {
                        checkPlan: 'Verify that the plan exists and is active',
                        checkCustomer: 'Verify that the customer exists',
                        checkUrl: 'Ensure the short_url is not null',
                        razorpayStatus: 'Check Razorpay dashboard for any issues'
                    }
                }
            }
        });
        
    } catch (error) {
        console.error('Subscription verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify subscription',
            error: error.message,
            code: error.error?.code || 'UNKNOWN_ERROR'
        });
    }
});
router.get('/status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const mandate = await UpiMandate.findOne({
            userId,
            status: { $in: ['PENDING', 'ACTIVE'] }
        }).sort({ createdAt: -1 });

        if (!mandate) {
            return res.json({
                success: true,
                data: {
                    hasMandate: false,
                    message: 'No active autopay mandate found'
                }
            });
        }

        // If mandate is pending and has subscription ID, get payment URL
        let subscriptionUrl = null;
        if (mandate.status === 'PENDING' && mandate.razorpaySubscriptionId) {
            try {
                const subscription = await razorpay.subscriptions.fetch(mandate.razorpaySubscriptionId);
                subscriptionUrl = subscription.short_url;
            } catch (error) {
                console.error('Error fetching subscription URL:', error);
            }
        }

        res.json({
            success: true,
            data: {
                hasMandate: true,
                mandateId: mandate.mandateId,
                status: mandate.status,
                amount: mandate.amount,
                frequency: 'Monthly',
                nextChargeDate: mandate.nextChargeDate,
                startDate: mandate.startDate,
                endDate: mandate.endDate,
                subscriptionId: mandate.razorpaySubscriptionId,
                customerId: mandate.razorpayCustomerId,
                subscriptionUrl: subscriptionUrl,
                chargeAttempts: mandate.chargeAttempts ? mandate.chargeAttempts.length : 0,
                lastFailedCharge: mandate.chargeAttempts ? 
                    mandate.chargeAttempts.filter(attempt => attempt.status === 'FAILED').slice(-1)[0] : null
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching autopay status',
            error: error.message
        });
    }
});

/**
 * Cancel UPI AutoPay mandate
 */
router.post('/cancel/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // Find active mandate
        const mandate = await UpiMandate.findOne({
            userId,
            status: { $in: ['PENDING', 'ACTIVE'] }
        }).sort({ createdAt: -1 });

        if (!mandate) {
            return res.status(404).json({
                success: false,
                message: 'No active autopay mandate found'
            });
        }

        // Cancel Razorpay subscription if exists
        if (mandate.razorpaySubscriptionId) {
            try {
                await razorpay.subscriptions.cancel(mandate.razorpaySubscriptionId, {
                    cancel_at_cycle_end: 0 // Cancel immediately
                });
                console.log(`Razorpay subscription cancelled: ${mandate.razorpaySubscriptionId}`);
            } catch (razorpayError) {
                console.error('Error cancelling Razorpay subscription:', razorpayError);
                // Continue with local cancellation even if Razorpay fails
            }
        }

        // Update mandate status
        mandate.status = 'CANCELLED';
        mandate.cancelledAt = new Date();
        await mandate.save();

        // Update user subscription (but preserve current access until expiry)
        const user = await User.findOne({ userId: userId }); // Use findOne with userId field
        if (user) {
            user.hasAutoRenewal = false;
            user.cancelledAt = new Date();
            await user.save();
        }

        res.json({
            success: true,
            message: 'UPI AutoPay mandate cancelled successfully',
            data: {
                mandateId: mandate.mandateId,
                cancelledAt: mandate.cancelledAt,
                accessUntil: user ? user.subscriptionExpiry : null
            }
        });

    } catch (error) {
        console.error('Cancel autopay error:', error);
        res.status(500).json({
            success: false,
            message: 'Error cancelling autopay mandate',
            error: error.message
        });
    }
});

/**
 * Webhook handler for subscription events
 */
router.post('/webhook', async (req, res) => {
    try {
        console.log('🔗 Webhook received - Headers:', {
            signature: req.headers['x-razorpay-signature'] ? 'present' : 'missing',
            contentType: req.headers['content-type'],
            userAgent: req.headers['user-agent']
        });
        
        console.log('🔗 Webhook received - Body type:', typeof req.body);
        console.log('🔗 Webhook received - Body keys:', Object.keys(req.body || {}));
        
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        // Enhanced signature verification with debugging
        const crypto = require('crypto');
        const expectedSignature = crypto
            .createHmac('sha256', CONFIG.webhookSecret)
            .update(body)
            .digest('hex');
        
        // Skip signature verification in development or if no secret is configured
        const skipSignatureVerification = !CONFIG.webhookSecret || CONFIG.webhookSecret === 'test' || process.env.NODE_ENV === 'development';
        
        if (signature && signature !== expectedSignature && !skipSignatureVerification) {
            console.log('❌ Invalid webhook signature');
            console.log('Expected:', expectedSignature);
            console.log('Received:', signature);
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        } else if (!signature && !skipSignatureVerification) {
            console.log('⚠️ No signature provided, but signature verification is enabled');
        } else if (skipSignatureVerification) {
            console.log('⚠️ Signature verification skipped (development mode or no secret configured)');
        }

        const event = req.body;
        
        // Enhanced logging with fallback
        if (event && event.event) {
            console.log('✅ UPI AutoPay webhook received:', event.event);
        } else {
            console.log('⚠️ UPI AutoPay webhook received with undefined event');
            console.log('📋 Full event object:', JSON.stringify(event, null, 2));
            
            // Try to handle malformed events
            if (!event || typeof event !== 'object') {
                console.log('❌ Invalid event object received');
                return res.status(400).json({ success: false, message: 'Invalid event data' });
            }
        }

        // Handle webhook events with safety checks
        const eventType = event && event.event ? event.event : 'unknown';
        
        switch (eventType) {
            case 'subscription.activated':
                if (event.payload && event.payload.subscription && event.payload.subscription.entity) {
                    await handleSubscriptionActivated(event.payload.subscription.entity);
                } else {
                    console.log('❌ Invalid subscription.activated payload structure');
                }
                break;
                
            case 'subscription.charged':
                if (event.payload && event.payload.payment && event.payload.subscription) {
                    await handleSubscriptionCharged(
                        event.payload.payment.entity, 
                        event.payload.subscription.entity
                    );
                } else {
                    console.log('❌ Invalid subscription.charged payload structure');
                }
                break;
                
            case 'subscription.cancelled':
                if (event.payload && event.payload.subscription && event.payload.subscription.entity) {
                    await handleSubscriptionCancelled(event.payload.subscription.entity);
                } else {
                    console.log('❌ Invalid subscription.cancelled payload structure');
                }
                break;
                
            case 'subscription.halted':
                if (event.payload && event.payload.subscription && event.payload.subscription.entity) {
                    await handleSubscriptionHalted(event.payload.subscription.entity);
                } else {
                    console.log('❌ Invalid subscription.halted payload structure');
                }
                break;
                
            case 'payment.failed':
                if (event.payload && event.payload.payment && event.payload.payment.entity) {
                    await handlePaymentFailed(event.payload.payment.entity);
                } else {
                    console.log('❌ Invalid payment.failed payload structure');
                }
                break;
                
            case 'unknown':
                console.log('❌ Unknown webhook event - event.event is undefined');
                console.log('📋 Available event data:', Object.keys(event || {}));
                break;
                
            default:
                console.log('⚠️ Unhandled webhook event:', eventType);
                console.log('📋 Full event data:', JSON.stringify(event, null, 2));
        }

        res.json({ success: true, message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
        console.error('❌ Request headers:', JSON.stringify(req.headers, null, 2));
        res.status(500).json({ success: false, message: 'Webhook processing failed', error: error.message });
    }
});

// Webhook handlers
async function handleSubscriptionActivated(subscription) {
    try {
        const mandate = await UpiMandate.findOne({ 
            razorpaySubscriptionId: subscription.id 
        });
        
        if (mandate) {
            mandate.status = 'ACTIVE';
            mandate.activatedAt = new Date();
            await mandate.save();

            // Update user subscription
            const user = await User.findOne({ userId: mandate.userId }); // Use findOne with userId field
            if (user) {
                user.subscriptionStatus = 'active';
                user.hasAutoRenewal = true;
                user.lastPaymentDate = new Date();
                user.upiMandateId = mandate.mandateId;
                
                // Set subscription expiry to next billing cycle
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + 30);
                user.subscriptionExpiry = expiry;
                
                await user.save();
            }

            console.log(`UPI AutoPay activated: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription activation:', error);
    }
}

async function handleSubscriptionCharged(payment, subscription) {
    try {
        const mandate = await UpiMandate.findOne({ 
            razorpaySubscriptionId: subscription.id 
        });
        
        if (mandate) {
            // Record successful charge
            mandate.chargeAttempts.push({
                date: new Date(),
                amount: payment.amount / 100,
                status: 'SUCCESS',
                reference: payment.id,
                razorpayPaymentId: payment.id
            });

            // Update next charge date
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 30);
            mandate.nextChargeDate = nextDate;
            mandate.lastChargedDate = new Date();
            
            await mandate.save();

            // Create payment record
            const paymentRecord = new Payment({
                userId: mandate.userId,
                transactionId: payment.id,
                razorpayPaymentId: payment.id,
                amount: payment.amount / 100,
                status: 'completed',
                validatedAt: new Date(),
                metadata: {
                    mandateId: mandate.mandateId,
                    subscriptionId: subscription.id,
                    type: 'autopay_charge',
                    platform: 'razorpay_autopay'
                }
            });
            await paymentRecord.save();

            // Extend user subscription
            const user = await User.findOne({ userId: mandate.userId }); // Use findOne with userId field
            if (user) {
                const currentExpiry = new Date(user.subscriptionExpiry || new Date());
                const newExpiry = new Date(currentExpiry);
                newExpiry.setDate(newExpiry.getDate() + 30);
                
                user.subscriptionExpiry = newExpiry;
                user.lastPaymentDate = new Date();
                user.subscriptionStatus = 'active';
                await user.save();
            }

            console.log(`UPI AutoPay charge successful: ${payment.id}`);
        }
    } catch (error) {
        console.error('Error handling subscription charge:', error);
    }
}

async function handleSubscriptionCancelled(subscription) {
    try {
        const mandate = await UpiMandate.findOne({ 
            razorpaySubscriptionId: subscription.id 
        });
        
        if (mandate) {
            mandate.status = 'CANCELLED';
            mandate.cancelledAt = new Date();
            await mandate.save();

            // Update user
            const user = await User.findOne({ userId: mandate.userId }); // Use findOne with userId field
            if (user) {
                user.hasAutoRenewal = false;
                user.cancelledAt = new Date();
                await user.save();
            }

            console.log(`UPI AutoPay cancelled: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription cancellation:', error);
    }
}

async function handleSubscriptionHalted(subscription) {
    try {
        const mandate = await UpiMandate.findOne({ 
            razorpaySubscriptionId: subscription.id 
        });
        
        if (mandate) {
            mandate.status = 'PAUSED';
            await mandate.save();

            console.log(`UPI AutoPay paused: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription halt:', error);
    }
}

async function handlePaymentFailed(payment) {
    try {
        // Find mandate by subscription ID (available in payment notes)
        const mandate = await UpiMandate.findOne({ 
            razorpaySubscriptionId: payment.subscription_id 
        });
        
        if (mandate) {
            // Record failed charge
            mandate.chargeAttempts.push({
                date: new Date(),
                amount: payment.amount / 100,
                status: 'FAILED',
                reference: payment.id,
                razorpayPaymentId: payment.id,
                failureReason: payment.error_description || 'Payment failed'
            });
            
            await mandate.save();

            console.log(`UPI AutoPay payment failed: ${payment.id}`);
        }
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
}

module.exports = router;
