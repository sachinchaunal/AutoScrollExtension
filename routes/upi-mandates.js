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
                razorpayMandateId: razorpayMandate.id,
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
                frequency: mandate.frequency,
                nextChargeDate: mandate.nextChargeDate,
                endDate: mandate.endDate,
                lastChargedDate: mandate.lastChargedDate,
                qrCodeImage: mandate.status === 'PENDING' ? mandate.qrCodeImage : null
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
        
        if (signature !== expectedSignature) {
            console.log('Invalid webhook signature');
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
                
            default:
                console.log('Unhandled webhook event:', event.event);
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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
            const user = await User.findOne({ userId: mandate.userId });
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
            const user = await User.findOne({ userId: mandate.userId });
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
            const user = await User.findOne({ userId: mandate.userId });
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
                const user = await User.findOne({ userId: mandate.userId });
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

        if (!userId || !mandateId) {
            return res.status(400).json({
                success: false,
                message: 'User ID and Mandate ID are required'
            });
        }

        const mandate = await UpiMandate.findOne({ userId, mandateId });

        if (!mandate) {
            return res.status(404).json({
                success: false,
                message: 'Mandate not found'
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
        const user = await User.findOne({ userId });
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
        const user = await User.findOne({ userId: mandate.userId });
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

module.exports = router;
