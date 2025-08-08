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
            start_at: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // Start tomorrow
            notes: {
                mandate_id: mandateId,
                user_id: userId,
                platform: 'autoscroll_extension'
            }
        };

        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        console.log('Created Razorpay subscription:', subscription.id);

        // Step 3: Create mandate record in database
        const mandate = new UpiMandate({
            userId,
            mandateId,
            upiId: null, // Will be set when user provides UPI ID during payment
            merchantVpa: process.env.MERCHANT_UPI_ID,
            amount: CONFIG.subscriptionPrice,
            startDate: new Date(subscription.start_at * 1000),
            endDate: new Date(subscription.end_at * 1000),
            nextChargeDate: new Date(subscription.start_at * 1000),
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

        res.json({
            success: true,
            message: 'UPI AutoPay mandate created successfully',
            data: {
                mandateId: mandate.mandateId,
                subscriptionId: subscription.id,
                customerId: customer.id,
                subscriptionUrl: subscription.short_url,
                amount: mandate.amount,
                startDate: mandate.startDate,
                endDate: mandate.endDate,
                nextChargeDate: mandate.nextChargeDate,
                status: 'PENDING',
                instructions: [
                    '1. Click the subscription link to setup UPI AutoPay',
                    '2. Select your UPI app and complete authentication',
                    '3. Approve the recurring payment mandate',
                    '4. Your subscription will be automatically charged monthly',
                    '5. You can cancel anytime from the extension settings'
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
 * Get subscription status with payment link if pending
 */
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
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        // Verify webhook signature
        const crypto = require('crypto');
        const expectedSignature = crypto
            .createHmac('sha256', CONFIG.webhookSecret)
            .update(body)
            .digest('hex');
        
        if (signature && signature !== expectedSignature && CONFIG.webhookSecret) {
            console.log('Invalid webhook signature');
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const event = req.body;
        console.log('UPI AutoPay webhook received:', event.event);

        switch (event.event) {
            case 'subscription.activated':
                await handleSubscriptionActivated(event.payload.subscription.entity);
                break;
                
            case 'subscription.charged':
                await handleSubscriptionCharged(
                    event.payload.payment.entity, 
                    event.payload.subscription.entity
                );
                break;
                
            case 'subscription.cancelled':
                await handleSubscriptionCancelled(event.payload.subscription.entity);
                break;
                
            case 'subscription.halted':
                await handleSubscriptionHalted(event.payload.subscription.entity);
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
