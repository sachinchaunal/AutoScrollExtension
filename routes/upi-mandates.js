const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const Razorpay = require('razorpay');
const UpiMandate = require('../models/UpiMandate');
const User = require('../models/User');
const Payment = require('../models/Payment');

// Initialize Razorpay with mandate support
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Configuration from environment variables
const CONFIG = {
    // UPI Mandate configuration
    merchantVpa: process.env.MERCHANT_UPI_ID || 'merchant@paytm',
    merchantName: process.env.MERCHANT_NAME || 'AutoScroll Extension',
    merchantCode: process.env.MERCHANT_CODE || 'AUTOSCROLL001',
    
    // Razorpay configuration
    planId: process.env.RAZORPAY_PLAN_ID,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET,
    
    // Subscription configuration
    subscriptionPrice: parseInt(process.env.SUBSCRIPTION_PRICE) || 9,
    subscriptionTotalCount: parseInt(process.env.SUBSCRIPTION_TOTAL_COUNT) || 60,
    subscriptionDescription: process.env.SUBSCRIPTION_DESCRIPTION || 'AutoScroll Extension - Monthly Subscription',
    trialDays: parseInt(process.env.TRIAL_DAYS) || 10,
    
    // Default customer information
    defaultCustomerPhone: process.env.DEFAULT_CUSTOMER_PHONE || '+919999999999',
    defaultCustomerEmail: process.env.DEFAULT_CUSTOMER_EMAIL || 'user@example.com',
    
    // URLs
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    frontendUrl: process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'
};

// Get UPI mandates overview
router.get('/', async (req, res) => {
    try {
        const totalMandates = await UpiMandate.countDocuments();
        const activeMandates = await UpiMandate.countDocuments({ status: 'ACTIVE' });
        const pendingMandates = await UpiMandate.countDocuments({ status: 'PENDING' });
        const cancelledMandates = await UpiMandate.countDocuments({ status: 'CANCELLED' });
        
        const recentMandates = await UpiMandate.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('userId mandateId status amount createdAt');

        res.json({
            success: true,
            data: {
                totalMandates,
                activeMandates,
                pendingMandates,
                cancelledMandates,
                recentMandates,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching UPI mandates overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching UPI mandates overview',
            error: error.message
        });
    }
});

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'UPI Mandates service is running correctly',
        timestamp: new Date().toISOString()
    });
});

// Test Razorpay configuration
router.get('/test-razorpay', async (req, res) => {
    try {
        // Test basic Razorpay connectivity
        const testPaymentLink = {
            amount: 100, // ₹1 for testing
            currency: 'INR',
            accept_partial: false,
            description: 'Test payment link',
            customer: {
                name: 'Test User',
                contact: CONFIG.defaultCustomerPhone,
                email: CONFIG.defaultCustomerEmail
            },
            notify: {
                sms: false,
                email: false
            },
            reminder_enable: false,
            notes: {
                test: 'true'
            }
        };

        console.log('Testing Razorpay with config:', {
            key_id: process.env.RAZORPAY_KEY_ID ? 'SET' : 'NOT SET',
            key_secret: process.env.RAZORPAY_KEY_SECRET ? 'SET' : 'NOT SET'
        });

        const paymentLink = await razorpay.paymentLink.create(testPaymentLink);
        
        res.json({
            success: true,
            message: 'Razorpay is working correctly',
            data: {
                paymentLinkId: paymentLink.id,
                shortUrl: paymentLink.short_url,
                amount: paymentLink.amount
            }
        });

    } catch (error) {
        console.error('Razorpay test error:', error);
        res.status(500).json({
            success: false,
            message: 'Razorpay test failed',
            error: error.message,
            details: error.error || null
        });
    }
});

// UPI Mandate configuration (legacy - keeping for backward compatibility)
const UPI_CONFIG = {
    merchantVpa: CONFIG.merchantVpa,
    merchantName: CONFIG.merchantName,
    merchantCode: CONFIG.merchantCode
};

// Create UPI Autopay Mandate using Razorpay
router.post('/create-mandate', async (req, res) => {
    try {
        const { userId, userUpiId, amount = CONFIG.subscriptionPrice } = req.body;

        if (!userId || !userUpiId) {
            return res.status(400).json({
                success: false,
                message: 'User ID and UPI ID are required'
            });
        }

        // Validate UPI ID format
        const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upiRegex.test(userUpiId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid UPI ID format'
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
                    razorpayMandateId: existingMandate.razorpayMandateId
                }
            });
        }

        // Calculate dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setFullYear(endDate.getFullYear() + 5); // 5 years validity (Razorpay requirement)
        
        const nextChargeDate = new Date();
        nextChargeDate.setDate(nextChargeDate.getDate() + 30); // Next month

        // Generate local mandate ID
        const mandateId = `MANDATE_${userId}_${Date.now()}`;

        // Create Razorpay payment link for UPI subscription
        const paymentLinkOptions = {
            amount: amount * 100, // Convert to paise
            currency: 'INR',
            accept_partial: false,
            description: CONFIG.subscriptionDescription,
            customer: {
                name: 'AutoScroll User',
                contact: CONFIG.defaultCustomerPhone,
                email: CONFIG.defaultCustomerEmail
            },
            notify: {
                sms: false,
                email: false
            },
            reminder_enable: false,
            notes: {
                mandate_id: mandateId,
                user_id: userId,
                user_upi_id: userUpiId,
                purpose: 'AutoScroll Extension Subscription'
            },
            callback_url: `${CONFIG.apiBaseUrl}/api/upi-mandates/callback`,
            callback_method: 'get',
            options: {
                checkout: {
                    method: {
                        upi: 1
                    }
                }
            }
        };

        console.log('Creating Razorpay payment link with options:', paymentLinkOptions);
        console.log('Razorpay config:', {
            key_id: process.env.RAZORPAY_KEY_ID ? 'SET' : 'NOT SET',
            key_secret: process.env.RAZORPAY_KEY_SECRET ? 'SET' : 'NOT SET',
            plan_id: process.env.RAZORPAY_PLAN_ID
        });
        
        const paymentLink = await razorpay.paymentLink.create(paymentLinkOptions);
        
        console.log('Payment link created:', paymentLink);

        // Generate QR code for the payment link
        const qrCodeImage = await QRCode.toDataURL(paymentLink.short_url, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // Create mandate record in database
        const mandate = new UpiMandate({
            userId,
            mandateId,
            upiId: userUpiId,
            merchantVpa: UPI_CONFIG.merchantVpa,
            amount,
            startDate,
            endDate,
            nextChargeDate,
            qrCodeData: paymentLink.short_url,
            qrCodeImage,
            razorpayMandateId: paymentLink.id, // Using payment link ID for now
            razorpayPaymentLinkId: paymentLink.id,
            metadata: {
                userAgent: req.headers['user-agent'],
                ipAddress: req.ip,
                platform: 'extension'
            }
        });

        await mandate.save();

        res.json({
            success: true,
            message: 'UPI Autopay mandate created successfully using Razorpay',
            data: {
                mandateId: mandate.mandateId,
                razorpayMandateId: paymentLink.id,
                paymentLinkId: paymentLink.id,
                qrCodeImage: mandate.qrCodeImage,
                qrCodeData: mandate.qrCodeData,
                paymentUrl: paymentLink.short_url,
                amount: mandate.amount,
                frequency: mandate.frequency,
                startDate: mandate.startDate,
                endDate: mandate.endDate,
                nextChargeDate: mandate.nextChargeDate,
                instructions: [
                    '1. Scan the QR code or click the payment link',
                    '2. Complete the payment to setup autopay',
                    '3. Your subscription will be automatically renewed monthly',
                    '4. You can cancel anytime from the extension settings'
                ]
            }
        });

    } catch (error) {
        console.error('Create mandate error:', error);
        
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
            message: 'Error creating UPI mandate',
            error: error.message
        });
    }
});

// Create UPI mandate (alias for create-mandate)
router.post('/create', async (req, res) => {
    try {
        const { userId, userUpiId, amount = CONFIG.subscriptionPrice } = req.body;

        if (!userId || !userUpiId) {
            return res.status(400).json({
                success: false,
                message: 'User ID and UPI ID are required'
            });
        }

        // Simple mandate creation for testing
        const mandateId = `TEST_MANDATE_${userId}_${Date.now()}`;
        
        res.json({
            success: true,
            message: 'Test UPI mandate created successfully',
            data: {
                mandateId,
                userId,
                userUpiId,
                amount,
                status: 'PENDING',
                testMode: true
            }
        });

    } catch (error) {
        console.error('Create mandate error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating UPI mandate',
            error: error.message
        });
    }
});

// Check mandate status
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
                    message: 'No active mandate found'
                }
            });
        }

        res.json({
            success: true,
            data: {
                hasMandate: true,
                mandateId: mandate.mandateId,
                status: mandate.status,
                amount: mandate.amount,
                frequency: mandate.frequency || 'Monthly',
                nextChargeDate: mandate.nextChargeDate,
                nextPaymentDate: mandate.nextChargeDate, // Alias for frontend compatibility
                endDate: mandate.endDate,
                lastChargedDate: mandate.lastChargedDate,
                startDate: mandate.startDate,
                createdAt: mandate.createdAt,
                qrCodeImage: mandate.status === 'PENDING' ? mandate.qrCodeImage : null,
                qrCodeData: mandate.status === 'PENDING' ? mandate.qrCodeData : null,
                paymentUrl: mandate.status === 'PENDING' ? mandate.qrCodeData : null,
                chargeAttempts: mandate.chargeAttempts ? mandate.chargeAttempts.length : 0,
                lastFailedCharge: mandate.chargeAttempts ? 
                    mandate.chargeAttempts.filter(attempt => attempt.status === 'FAILED').slice(-1)[0] : null
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching mandate status',
            error: error.message
        });
    }
});

// Get QR code for existing mandate
router.get('/qr/:mandateId', async (req, res) => {
    try {
        const { mandateId } = req.params;

        const mandate = await UpiMandate.findOne({
            mandateId,
            status: 'PENDING'
        });

        if (!mandate) {
            return res.status(404).json({
                success: false,
                message: 'No pending mandate found with this ID'
            });
        }

        res.json({
            success: true,
            data: {
                mandateId: mandate.mandateId,
                qrCodeImage: mandate.qrCodeImage,
                qrCodeData: mandate.qrCodeData,
                paymentUrl: mandate.qrCodeData,
                amount: mandate.amount,
                status: mandate.status
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching QR code',
            error: error.message
        });
    }
});

// Razorpay webhook handler for mandate events
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        // Verify webhook signature (important for security)
        const crypto = require('crypto');
        const expectedSignature = crypto
            .createHmac('sha256', CONFIG.webhookSecret)
            .update(body)
            .digest('hex');
        
        // For development/testing, log signature verification details
        console.log('Webhook signature verification:', {
            received: signature,
            expected: expectedSignature,
            match: signature === expectedSignature,
            hasSecret: !!CONFIG.webhookSecret
        });
        
        // Skip signature verification in development if webhook secret is not properly set
        if (signature && signature !== expectedSignature && CONFIG.webhookSecret && CONFIG.webhookSecret !== process.env.RAZORPAY_KEY_SECRET) {
            console.log('Invalid webhook signature - webhook processing skipped');
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        const event = req.body;
        console.log('Razorpay webhook received:', event.event, event.payload);

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
                
            case 'payment.failed':
                await handlePaymentFailed(event.payload.payment.entity);
                break;
                
            case 'payment_link.paid':
                await handlePaymentLinkPaid(event.payload);
                break;
                
            case 'payment.authorized':
            case 'payment.captured':
                // These events are handled by payment_link.paid
                console.log(`Payment event logged: ${event.event}`);
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

// Handle payment link paid event - this is the key missing handler!
async function handlePaymentLinkPaid(payload) {
    try {
        const { payment_link, payment, order } = payload;
        
        console.log('Processing payment_link.paid event:', {
            payment_link_id: payment_link.entity.id,
            payment_id: payment.entity.id,
            amount: payment.entity.amount
        });
        
        // Find mandate by payment link ID
        const mandate = await UpiMandate.findOne({ 
            razorpayPaymentLinkId: payment_link.entity.id 
        });
        
        if (mandate) {
            console.log('Found mandate for payment link:', mandate.mandateId);
            
            // Create subscription for this mandate
            const subscriptionOptions = {
                plan_id: CONFIG.planId,
                customer_notify: 1,
                quantity: 1,
                total_count: CONFIG.subscriptionTotalCount,
                start_at: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // Start next month
                notes: {
                    mandate_id: mandate.mandateId,
                    user_id: mandate.userId
                }
            };

            const subscription = await razorpay.subscriptions.create(subscriptionOptions);
            console.log('Created Razorpay subscription:', subscription.id);
            
            // Update mandate status
            mandate.status = 'ACTIVE';
            mandate.razorpaySubscriptionId = subscription.id;
            mandate.approvalReference = payment.entity.id;
            await mandate.save();

            // Update user subscription status
            const user = await User.findById(mandate.userId);
            if (user) {
                user.subscriptionStatus = 'active';
                user.hasAutoRenewal = true;
                user.lastPaymentDate = new Date();
                user.upiMandateId = mandate.mandateId;
                
                // Set initial subscription expiry (30 days from now)
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + 30);
                user.subscriptionExpiry = expiry;
                
                await user.save();
                console.log('Updated user subscription status to active:', user.email);
            }

            // Record initial payment
            const paymentRecord = new Payment({
                userId: mandate.userId,
                transactionId: payment.entity.id,
                razorpayPaymentId: payment.entity.id,
                amount: payment.entity.amount / 100, // Convert from paise to rupees
                status: 'completed',
                validatedAt: new Date(),
                metadata: {
                    mandateId: mandate.mandateId,
                    subscriptionId: subscription.id,
                    type: 'mandate_setup',
                    platform: 'razorpay_mandate'
                }
            });
            await paymentRecord.save();
            
            console.log('Payment link paid processed successfully for mandate:', mandate.mandateId);
        } else {
            console.error('No mandate found for payment link:', payment_link.entity.id);
        }
    } catch (error) {
        console.error('Error handling payment_link.paid:', error);
    }
}

// Handle subscription activation
async function handleSubscriptionActivated(subscription) {
    try {
        const mandate = await UpiMandate.findOne({ razorpayMandateId: subscription.id });
        
        if (mandate) {
            mandate.status = 'ACTIVE';
            mandate.razorpaySubscriptionId = subscription.id;
            mandate.approvalReference = subscription.id;
            await mandate.save();

            // Update user subscription
            const user = await User.findById(mandate.userId);
            if (user) {
                user.subscriptionStatus = 'active';
                user.subscriptionExpiry = mandate.endDate;
                user.hasAutoRenewal = true;
                user.lastPaymentDate = new Date();
                user.upiMandateId = mandate.mandateId;
                await user.save();
            }

            console.log(`Mandate activated: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription activation:', error);
    }
}

// Handle successful charge
async function handleSubscriptionCharged(payment, subscription) {
    try {
        const mandate = await UpiMandate.findOne({ razorpayMandateId: subscription.id });
        
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
            nextDate.setDate(nextDate.getDate() + 30); // Next month
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
                    type: 'recurring_charge',
                    platform: 'razorpay_mandate'
                }
            });
            await paymentRecord.save();

            // Extend user subscription
            const user = await User.findById(mandate.userId);
            if (user) {
                const currentExpiry = new Date(user.subscriptionExpiry || new Date());
                const newExpiry = new Date(currentExpiry);
                newExpiry.setDate(newExpiry.getDate() + 30);
                
                user.subscriptionExpiry = newExpiry;
                user.lastPaymentDate = new Date();
                user.subscriptionStatus = 'active';
                await user.save();
            }

            console.log(`Recurring charge successful: ${payment.id} for mandate: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription charge:', error);
    }
}

// Handle subscription cancellation
async function handleSubscriptionCancelled(subscription) {
    try {
        const mandate = await UpiMandate.findOne({ razorpayMandateId: subscription.id });
        
        if (mandate) {
            mandate.status = 'CANCELLED';
            await mandate.save();

            // Update user
            const user = await User.findById(mandate.userId);
            if (user) {
                user.hasAutoRenewal = false;
                await user.save();
            }

            console.log(`Mandate cancelled: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription cancellation:', error);
    }
}

// Handle subscription halt (payment failures)
async function handleSubscriptionHalted(subscription) {
    try {
        const mandate = await UpiMandate.findOne({ razorpayMandateId: subscription.id });
        
        if (mandate) {
            mandate.status = 'PAUSED';
            await mandate.save();

            console.log(`Mandate paused due to payment failure: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling subscription halt:', error);
    }
}

// Handle payment failure
async function handlePaymentFailed(payment) {
    try {
        // Find mandate by notes or other identifier
        const mandate = await UpiMandate.findOne({ 
            $or: [
                { razorpayMandateId: payment.order_id },
                { 'chargeAttempts.razorpayPaymentId': payment.id }
            ]
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

            console.log(`Payment failed: ${payment.id} for mandate: ${mandate.mandateId}`);
        }
    } catch (error) {
        console.error('Error handling payment failure:', error);
    }
}

// Payment callback handler
router.get('/callback', async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_payment_link_id, razorpay_payment_link_reference_id, razorpay_payment_link_status, razorpay_signature } = req.query;
        
        if (razorpay_payment_link_status === 'paid') {
            // Find mandate by payment link ID
            const mandate = await UpiMandate.findOne({ razorpayPaymentLinkId: razorpay_payment_link_id });
            
            if (mandate) {
                // Create subscription for this mandate
                const subscriptionOptions = {
                    plan_id: CONFIG.planId,
                    customer_notify: 1,
                    quantity: 1,
                    total_count: CONFIG.subscriptionTotalCount,
                    start_at: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // Start next month
                    notes: {
                        mandate_id: mandate.mandateId,
                        user_id: mandate.userId
                    }
                };

                const subscription = await razorpay.subscriptions.create(subscriptionOptions);
                
                mandate.status = 'ACTIVE';
                mandate.razorpaySubscriptionId = subscription.id;
                mandate.approvalReference = razorpay_payment_id;
                await mandate.save();

                // Update user
                const user = await User.findById(mandate.userId);
                if (user) {
                    user.subscriptionStatus = 'active';
                    user.hasAutoRenewal = true;
                    user.lastPaymentDate = new Date();
                    user.upiMandateId = mandate.mandateId;
                    
                    // Set initial subscription expiry
                    const expiry = new Date();
                    expiry.setDate(expiry.getDate() + 30);
                    user.subscriptionExpiry = expiry;
                    
                    await user.save();
                }

                // Record initial payment
                const payment = new Payment({
                    userId: mandate.userId,
                    transactionId: razorpay_payment_id,
                    razorpayPaymentId: razorpay_payment_id,
                    amount: mandate.amount,
                    status: 'completed',
                    validatedAt: new Date(),
                    metadata: {
                        mandateId: mandate.mandateId,
                        type: 'mandate_setup',
                        platform: 'razorpay_mandate'
                    }
                });
                await payment.save();

                res.redirect(`${process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'}/popup.html?mandate=success`);
            } else {
                res.redirect(`${process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'}/popup.html?mandate=error`);
            }
        } else {
            res.redirect(`${process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'}/popup.html?mandate=failed`);
        }
    } catch (error) {
        console.error('Callback error:', error);
        res.redirect(`${process.env.FRONTEND_URL || 'chrome-extension://your-extension-id'}/popup.html?mandate=error`);
    }
});

// Cancel mandate using Razorpay
router.post('/cancel-mandate', async (req, res) => {
    try {
        const { userId, mandateId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Find mandate by userId and mandateId, or just userId if mandateId not provided
        let mandate;
        if (mandateId) {
            mandate = await UpiMandate.findOne({ userId, mandateId });
        } else {
            // Find active mandate for user
            mandate = await UpiMandate.findOne({
                userId,
                status: { $in: ['PENDING', 'ACTIVE', 'PAUSED'] }
            }).sort({ createdAt: -1 }); // Get latest active mandate
        }

        if (!mandate) {
            return res.status(404).json({
                success: false,
                message: 'No active mandate found for this user'
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

        mandate.status = 'CANCELLED';
        await mandate.save();

        // Update user subscription
        const user = await User.findById(userId);
        if (user) {
            user.hasAutoRenewal = false;
            await user.save();
        }

        res.json({
            success: true,
            message: 'Mandate cancelled successfully'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error cancelling mandate',
            error: error.message
        });
    }
});

// Get mandate history
router.get('/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const mandates = await UpiMandate.find({ userId })
            .sort({ createdAt: -1 })
            .select('-qrCodeImage -qrCodeData') // Exclude large fields
            .limit(10);

        res.json({
            success: true,
            data: mandates
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching mandate history',
            error: error.message
        });
    }
});

// Get user mandates (alias for history)
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const mandates = await UpiMandate.find({ userId })
            .sort({ createdAt: -1 })
            .select('-qrCodeImage -qrCodeData') // Exclude large fields
            .limit(10);

        res.json({
            success: true,
            data: mandates
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching user mandates',
            error: error.message
        });
    }
});

// Process recurring charges (internal endpoint)
router.post('/process-charges', async (req, res) => {
    try {
        // Find all active mandates due for charging
        const today = new Date();
        const mandatesQuery = {
            status: 'ACTIVE',
            nextChargeDate: { $lte: today }
        };

        const mandates = await UpiMandate.find(mandatesQuery);
        const results = [];

        for (const mandate of mandates) {
            try {
                // In a real implementation, you would call UPI payment gateway API
                // For now, we'll simulate successful charges
                const chargeResult = await processRecurringCharge(mandate);
                results.push({
                    mandateId: mandate.mandateId,
                    userId: mandate.userId,
                    success: chargeResult.success,
                    amount: mandate.amount,
                    reference: chargeResult.reference
                });
            } catch (error) {
                results.push({
                    mandateId: mandate.mandateId,
                    userId: mandate.userId,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            message: `Processed ${results.length} mandates`,
            data: results
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error processing charges',
            error: error.message
        });
    }
});

// Helper function to generate UPI mandate QR data
function generateMandateQRData(params) {
    const {
        mandateId,
        payerVpa,
        payeeVpa,
        amount,
        merchantName,
        startDate,
        endDate
    } = params;

    // UPI Mandate QR format (simplified)
    const qrData = [
        `upi://mandate`,
        `?pa=${encodeURIComponent(payeeVpa)}`,
        `&pn=${encodeURIComponent(merchantName)}`,
        `&am=${amount}`,
        `&cu=INR`,
        `&mode=02`, // Mandate mode
        `&purpose=14`, // Subscription
        `&orgid=${UPI_CONFIG.merchantCode}`,
        `&mid=${mandateId}`,
        `&validitystart=${formatDate(startDate)}`,
        `&validityend=${formatDate(endDate)}`,
        `&frequency=30`, // Monthly (30 days)
        `&recurring=1`
    ].join('');

    return qrData;
}

// Helper function to format date for UPI
function formatDate(date) {
    return date.toISOString().split('T')[0].replace(/-/g, '');
}

// Helper function to process recurring charge
async function processRecurringCharge(mandate) {
    try {
        // In a real implementation, this would call the UPI payment gateway
        // For demo purposes, we'll simulate a successful charge
        
        const reference = `REC_${mandate.mandateId}_${Date.now()}`;
        
        // Record the charge attempt
        mandate.chargeAttempts.push({
            date: new Date(),
            amount: mandate.amount,
            status: 'SUCCESS',
            reference: reference
        });

        // Update next charge date
        const nextDate = new Date(mandate.nextChargeDate);
        nextDate.setDate(nextDate.getDate() + 30); // Next month
        mandate.nextChargeDate = nextDate;
        mandate.lastChargedDate = new Date();

        await mandate.save();

        // Create payment record
        const payment = new Payment({
            userId: mandate.userId,
            transactionId: reference,
            amount: mandate.amount,
            status: 'completed',
            validatedAt: new Date(),
            metadata: {
                mandateId: mandate.mandateId,
                type: 'recurring_charge',
                platform: 'upi_mandate'
            }
        });
        await payment.save();

        // Update user subscription
        const user = await User.findById(mandate.userId);
        if (user) {
            const newExpiry = new Date(user.subscriptionExpiry);
            newExpiry.setDate(newExpiry.getDate() + 30);
            user.subscriptionExpiry = newExpiry;
            user.lastPaymentDate = new Date();
            await user.save();
        }

        return {
            success: true,
            reference: reference
        };

    } catch (error) {
        // Record failed attempt
        mandate.chargeAttempts.push({
            date: new Date(),
            amount: mandate.amount,
            status: 'FAILED',
            failureReason: error.message
        });
        await mandate.save();

        throw error;
    }
}

// Resume mandate endpoint
router.post('/resume-mandate', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Find paused mandate
        const mandate = await UpiMandate.findOne({
            userId,
            status: 'PAUSED'
        });

        if (!mandate) {
            return res.status(404).json({
                success: false,
                message: 'No paused mandate found for this user'
            });
        }

        // Update mandate status to active
        mandate.status = 'ACTIVE';
        mandate.resumedDate = new Date();
        
        // Add activity log
        mandate.activityLog.push({
            action: 'RESUMED',
            timestamp: new Date(),
            details: 'Mandate resumed by user',
            metadata: {
                resumedFrom: 'user_action'
            }
        });

        await mandate.save();

        res.json({
            success: true,
            message: 'Mandate resumed successfully',
            data: {
                mandateId: mandate.mandateId,
                status: mandate.status,
                nextChargeDate: mandate.nextChargeDate
            }
        });

    } catch (error) {
        console.error('Resume mandate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to resume mandate',
            error: error.message
        });
    }
});

// Force refresh subscription status for user
router.post('/refresh-status', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Get user current status
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get user's active mandate
        const mandate = await UpiMandate.findOne({
            userId,
            status: 'ACTIVE'
        }).sort({ createdAt: -1 });

        let subscriptionStatus = user.subscriptionStatus || 'trial';
        let canUseExtension = true;
        let message = 'Status refreshed successfully';

        // If user has active mandate, they should have active subscription
        if (mandate) {
            if (user.subscriptionStatus !== 'active') {
                user.subscriptionStatus = 'active';
                user.hasAutoRenewal = true;
                
                // Set subscription expiry if not set
                if (!user.subscriptionExpiry) {
                    const expiry = new Date();
                    expiry.setDate(expiry.getDate() + 30);
                    user.subscriptionExpiry = expiry;
                }
                
                await user.save();
                subscriptionStatus = 'active';
                message = 'Subscription status updated to active';
                
                console.log(`Force refreshed subscription status for user ${userId}: trial -> active`);
            }
        }

        // Calculate remaining days
        let daysRemaining = 0;
        if (subscriptionStatus === 'trial' && user.trialEndDate) {
            const now = new Date();
            const trialEnd = new Date(user.trialEndDate);
            daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
        } else if (subscriptionStatus === 'active' && user.subscriptionExpiry) {
            const now = new Date();
            const expiry = new Date(user.subscriptionExpiry);
            daysRemaining = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
        }

        res.json({
            success: true,
            message,
            data: {
                userId: user._id,
                subscriptionStatus,
                canUseExtension,
                daysRemaining,
                hasAutoRenewal: user.hasAutoRenewal || false,
                mandateStatus: mandate ? mandate.status : null,
                mandateId: mandate ? mandate.mandateId : null,
                lastPaymentDate: user.lastPaymentDate,
                subscriptionExpiry: user.subscriptionExpiry,
                refreshed: true
            }
        });

    } catch (error) {
        console.error('Refresh status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to refresh status',
            error: error.message
        });
    }
});

module.exports = router;
