const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const SubscriptionService = require('../services/subscriptionService');
const { verifyWebhookSignature } = require('../config/razorpay');
const { formatErrorResponse } = require('../services/errorHandling');

/**
 * Get pending payment link for user (Resume Payment functionality)
 * GET /api/subscription/pending-payment/:userId
 */
router.get('/pending-payment/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
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
        
        const pendingPayment = user.getPendingPaymentLink();
        
        if (pendingPayment) {
            res.json({
                success: true,
                message: 'Pending payment found',
                data: {
                    hasPendingPayment: true,
                    paymentLink: pendingPayment.link,
                    subscriptionId: pendingPayment.subscriptionId,
                    planId: pendingPayment.planId,
                    status: pendingPayment.status,
                    createdAt: pendingPayment.createdAt,
                    // Determine plan type for UI display
                    planType: pendingPayment.planId?.includes('yearly') || pendingPayment.planId?.includes('annual') ? 'yearly' : 'monthly'
                }
            });
        } else {
            res.json({
                success: true,
                message: 'No pending payment found',
                data: {
                    hasPendingPayment: false
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Get pending payment error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to check pending payment',
            error: error.message
        });
    }
});

/**
 * Get user subscription status
 * GET /api/subscription/status/:userId
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
        
        const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
        
        // Enhanced response with pending payment information
        const enhancedStatus = {
            ...subscriptionStatus,
            // Add pending payment info
            hasPendingPayment: user.hasPendingPaymentLink(),
            pendingPayment: user.getPendingPaymentLink()
        };
        
        res.json({
            success: true,
            data: enhancedStatus
        });
        
    } catch (error) {
        console.error('❌ Get subscription status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get subscription status',
            error: error.message
        });
    }
});

/**
 * Cancel user subscription
 * POST /api/subscription/cancel
 */
router.post('/cancel', async (req, res) => {
    try {
        const { userId, cancelAtCycleEnd = true } = req.body;
        
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
        
        if (!user.subscription.razorpay.subscriptionId) {
            return res.status(400).json({
                success: false,
                message: 'No active subscription found'
            });
        }
        
        const cancellationResult = await SubscriptionService.cancelUserSubscription(user, cancelAtCycleEnd);
        
        res.json({
            success: true,
            message: cancelAtCycleEnd ? 
                'Subscription will be cancelled at the end of current billing period' :
                'Subscription cancelled immediately',
            data: cancellationResult
        });
        
    } catch (error) {
        console.error('❌ Cancel subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel subscription',
            error: error.message
        });
    }
});

/**
 * Validate feature access for user
 * POST /api/subscription/validate-access
 */
router.post('/validate-access', async (req, res) => {
    try {
        const { userId, feature = 'autoScroll' } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const accessValidation = await SubscriptionService.validateFeatureAccess(user, feature);
        const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
        
        // Enhanced response with subscription processing state
        const normalizedResponse = {
            allowed: accessValidation.hasAccess || accessValidation.allowed || false,
            accessType: accessValidation.source || accessValidation.accessType || 'unknown',
            daysRemaining: accessValidation.daysRemaining || 0,
            reason: accessValidation.error || accessValidation.warning || (accessValidation.hasAccess ? 'access_granted' : 'access_denied'),
            
            // Enhanced subscription processing information
            isProcessing: subscriptionStatus.isProcessing || false,
            processingState: subscriptionStatus.processingState,
            processingMessage: subscriptionStatus.processingMessage,
            showRefreshButton: subscriptionStatus.showRefreshButton || false,
            allowTrialAccess: subscriptionStatus.allowTrialAccess || false,
            
            // Additional context for better UX
            subscriptionId: user.subscription?.razorpay?.subscriptionId,
            trialEndDate: user.subscription?.trial?.endDate,
            lastUpdated: new Date()
        };
        
        res.json({
            success: true,
            data: normalizedResponse
        });
        
    } catch (error) {
        console.error('❌ Validate access error:', error);
        const errorResponse = formatErrorResponse(error);
        res.status(errorResponse.error.statusCode).json(errorResponse);
    }
});

/**
 * Create subscription with Razorpay subscription workflow
 * POST /api/subscription/create-subscription
 */
router.post('/create-subscription', async (req, res) => {
    try {
        const { userId, planType = 'monthly' } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        if (!['monthly', 'yearly'].includes(planType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid plan type. Must be "monthly" or "yearly"'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Enhanced check for existing subscriptions (active, processing, or pending)
        const currentStatus = SubscriptionService.getUserSubscriptionStatus(user);
        
        // Check for active subscription
        if (currentStatus.subscriptionStatus === 'active') {
            return res.status(400).json({
                success: false,
                message: 'User already has an active subscription',
                code: 'SUBSCRIPTION_ALREADY_ACTIVE'
            });
        }
        
        // Check for subscription currently processing
        if (currentStatus.isProcessing) {
            return res.status(400).json({
                success: false,
                message: 'User already has a subscription being processed. Please wait for activation or contact support.',
                code: 'SUBSCRIPTION_PROCESSING',
                data: {
                    isProcessing: true,
                    processingState: currentStatus.processingState,
                    processingMessage: currentStatus.processingMessage
                }
            });
        }
        
        // Check for pending payment
        if (user.hasPendingPaymentLink()) {
            const pendingPayment = user.getPendingPaymentLink();
            return res.status(400).json({
                success: false,
                message: 'User has an existing subscription with incomplete payment. Please complete the existing payment or contact support.',
                code: 'PENDING_PAYMENT_EXISTS',
                data: {
                    hasPendingPayment: true,
                    subscriptionId: pendingPayment.subscriptionId,
                    paymentLink: pendingPayment.link,
                    createdAt: pendingPayment.createdAt
                }
            });
        }
        
        // Check for recent subscription creation (within last 10 minutes) to prevent accidental duplicates
        if (user.subscription?.razorpay?.subscriptionId && user.subscription?.razorpay?.subscriptionLinkCreatedAt) {
            const timeSinceCreation = Date.now() - new Date(user.subscription.razorpay.subscriptionLinkCreatedAt).getTime();
            const tenMinutesInMs = 10 * 60 * 1000;
            
            if (timeSinceCreation < tenMinutesInMs && 
                user.subscription.razorpay.status !== 'active' && 
                user.subscription.razorpay.status !== 'cancelled') {
                
                return res.status(400).json({
                    success: false,
                    message: 'A subscription was recently created for this user. Please complete the existing subscription or wait 10 minutes before creating a new one.',
                    code: 'RECENT_SUBSCRIPTION_EXISTS',
                    data: {
                        subscriptionId: user.subscription.razorpay.subscriptionId,
                        status: user.subscription.razorpay.status,
                        createdAt: user.subscription.razorpay.subscriptionLinkCreatedAt,
                        subscriptionLink: user.subscription.razorpay.subscriptionLink
                    }
                });
            }
        }
        
        // Create subscription using Razorpay Subscription API (follows images workflow)
        const subscriptionResult = await SubscriptionService.createUserSubscription(user, planType);
        
        if (!subscriptionResult.success) {
            throw new Error('Failed to create subscription');
        }
        
        // Store subscription details in user document
        user.subscription.razorpay.subscriptionId = subscriptionResult.subscription.id;
        user.subscription.razorpay.planId = subscriptionResult.subscription.planId;
        user.subscription.razorpay.status = 'created'; // Razorpay initial status
        user.subscription.razorpay.subscriptionLink = subscriptionResult.subscription.shortUrl; // Store the payment link
        user.subscription.razorpay.subscriptionLinkCreatedAt = new Date(); // Store creation time
        await user.save();
        
        console.log(`✅ Subscription created for user: ${user.email}, Plan: ${planType}, Subscription ID: ${subscriptionResult.subscription.id}`);
        
        res.json({
            success: true,
            message: 'Subscription created successfully',
            data: {
                subscriptionId: subscriptionResult.subscription.id,
                subscriptionLink: subscriptionResult.subscription.shortUrl, // Razorpay subscription link
                planType: planType,
                planName: subscriptionResult.subscription.planName,
                amount: subscriptionResult.subscription.amount,
                currency: subscriptionResult.subscription.currency,
                status: 'created'
            }
        });
        
    } catch (error) {
        console.error('❌ Create subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create subscription',
            error: error.message
        });
    }
});

/**
 * Handle subscription authentication callback (from subscription link)
 * GET /api/subscription/auth-callback
 */
router.get('/auth-callback', async (req, res) => {
    try {
        const { razorpay_subscription_id, razorpay_customer_id, razorpay_signature } = req.query;
        
        console.log('Subscription authentication callback received:', req.query);
        
        if (razorpay_subscription_id) {
            try {
                // Find user by subscription ID
                const user = await User.findOne({ 'subscription.razorpay.subscriptionId': razorpay_subscription_id });
                
                if (user) {
                    // Update subscription status to authenticated
                    user.subscription.razorpay.status = 'authenticated';
                    user.subscription.razorpay.customerId = razorpay_customer_id;
                    await user.save();
                    
                    console.log(`✅ Subscription authenticated for user: ${user.email}, Subscription ID: ${razorpay_subscription_id}`);
                }
            } catch (error) {
                console.error('Error updating subscription status:', error);
            }
            
            // Show authentication success page
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Subscription Authenticated</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                            text-align: center; 
                            padding: 50px; 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            margin: 0;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .auth-container {
                            background: rgba(255,255,255,0.1);
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 500px;
                            margin: 0 auto;
                            backdrop-filter: blur(10px);
                        }
                        .auth-icon { font-size: 60px; margin-bottom: 20px; }
                        .close-btn {
                            background: linear-gradient(135deg, #4CAF50, #45a049);
                            color: white;
                            border: none;
                            padding: 15px 30px;
                            border-radius: 8px;
                            font-size: 16px;
                            cursor: pointer;
                            margin: 10px;
                            transition: all 0.3s ease;
                        }
                        .close-btn:hover {
                            background: linear-gradient(135deg, #45a049, #3d8b40);
                            transform: translateY(-2px);
                        }
                        .sub-details {
                            background: rgba(255,255,255,0.1);
                            padding: 20px;
                            border-radius: 10px;
                            margin: 20px 0;
                            font-size: 14px;
                        }
                    </style>
                </head>
                <body>
                    <div class="auth-container">
                        <div class="auth-icon">🔐</div>
                        <h1>Subscription Authenticated!</h1>
                        <p style="font-size: 1.2rem; margin: 20px 0;">Your subscription is ready for payment</p>
                        <div class="sub-details">
                            <p><strong>Subscription ID:</strong> ${razorpay_subscription_id}</p>
                            <p><strong>Status:</strong> Authenticated</p>
                        </div>
                        <p>You can now proceed with the payment to activate your premium features!</p>
                        <p style="font-size: 14px; opacity: 0.9;">You can close this tab and return to the extension.</p>
                        <button class="close-btn" onclick="window.close()">Close Tab</button>
                        <p style="font-size: 12px; margin-top: 20px; opacity: 0.7;">This tab will close automatically in 10 seconds</p>
                    </div>
                    <script>
                        // Auto-close after 10 seconds
                        setTimeout(() => window.close(), 10000);
                    </script>
                </body>
                </html>
            `);
        } else {
            // Authentication failed
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Failed</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            text-align: center; 
                            padding: 50px; 
                            background: linear-gradient(135deg, #ff6b6b, #ee5a52);
                            color: white;
                            margin: 0;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .error-container {
                            background: rgba(255,255,255,0.1);
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 500px;
                            margin: 0 auto;
                            backdrop-filter: blur(10px);
                        }
                        .error-icon { font-size: 60px; margin-bottom: 20px; }
                        .close-btn {
                            background: #f44336;
                            color: white;
                            border: none;
                            padding: 15px 30px;
                            border-radius: 8px;
                            font-size: 16px;
                            cursor: pointer;
                            margin-top: 20px;
                            transition: all 0.3s ease;
                        }
                        .close-btn:hover {
                            background: #da190b;
                            transform: translateY(-2px);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div class="error-icon">❌</div>
                        <h1>Authentication Failed</h1>
                        <p>Your subscription authentication was not completed.</p>
                        <p>Please try again from the extension popup.</p>
                        <button class="close-btn" onclick="window.close()">Close Tab</button>
                    </div>
                </body>
                </html>
            `);
        }
        
    } catch (error) {
        console.error('❌ Subscription authentication callback error:', error);
        res.status(500).send(`
            <html>
            <head>
                <title>Error</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: #f44336;
                        color: white;
                    }
                    .error-container { 
                        background: rgba(255,255,255,0.1); 
                        padding: 40px; 
                        border-radius: 10px; 
                        max-width: 400px; 
                        margin: 0 auto; 
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1>❌ Error</h1>
                    <p>An error occurred processing your subscription authentication.</p>
                    <p>Please contact support if this issue persists.</p>
                    <button onclick="window.close()" style="
                        background: white; 
                        color: #f44336; 
                        border: none; 
                        padding: 10px 20px; 
                        border-radius: 5px; 
                        cursor: pointer;
                        margin-top: 20px;
                    ">Close Tab</button>
                </div>
            </body>
            </html>
        `);
    }
});

/**
 * Handle payment callback from Razorpay (subscription payment)
 * GET /api/subscription/payment-callback
 */
router.get('/payment-callback', async (req, res) => {
    try {
        const { 
            razorpay_payment_id, 
            razorpay_subscription_id,
            razorpay_payment_link_id, 
            razorpay_payment_link_reference_id, 
            razorpay_payment_link_status, 
            razorpay_signature, 
            ref 
        } = req.query;
        
        console.log('Payment callback received:', req.query);
        
        // Handle subscription payment (direct from subscription link - image 3 flow)
        if (razorpay_subscription_id && razorpay_payment_id) {
            try {
                // Find user by subscription ID
                const user = await User.findOne({ 'subscription.razorpay.subscriptionId': razorpay_subscription_id });
                
                if (user) {
                    // Subscription payment successful - activate subscription
                    user.subscription.razorpay.status = 'active';
                    user.subscription.razorpay.lastPaymentId = razorpay_payment_id;
                    user.subscription.features.autoScroll = true;
                    user.subscription.features.analytics = true;
                    user.subscription.features.customSettings = true;
                    user.subscription.features.prioritySupport = true;
                    
                    // Deactivate trial
                    if (user.subscription.trial) {
                        user.subscription.trial.isActive = false;
                    }
                    
                    // Add payment to history
                    if (!user.subscription.razorpay.paymentHistory) {
                        user.subscription.razorpay.paymentHistory = [];
                    }
                    
                    user.subscription.razorpay.paymentHistory.push({
                        paymentId: razorpay_payment_id,
                        subscriptionId: razorpay_subscription_id,
                        status: 'success',
                        paidAt: new Date()
                    });
                    
                    await user.save();
                    
                    console.log(`✅ Subscription payment successful for user: ${user.email}, Payment ID: ${razorpay_payment_id}`);
                }
            } catch (activationError) {
                console.error('Error activating subscription:', activationError);
            }
        }
        // Handle payment link payment (fallback method)
        else if (razorpay_payment_link_status === 'paid' && razorpay_payment_id) {
            try {
                // Extract reference ID to find user and subscription
                const referenceId = ref || razorpay_payment_link_reference_id;
                
                if (referenceId) {
                    // Parse reference ID to get user info
                    const refParts = referenceId.split('_');
                    if (refParts.length >= 3) {
                        const userId = refParts[2];
                        
                        // Find user and activate subscription
                        const user = await User.findById(userId);
                        if (user) {
                            // Update subscription status to active
                            user.subscription.razorpay.status = 'active';
                            user.subscription.razorpay.lastPaymentId = razorpay_payment_id;
                            user.subscription.features.customSettings = true;
                            user.subscription.features.prioritySupport = true;
                            
                            // Deactivate trial
                            if (user.subscription.trial) {
                                user.subscription.trial.isActive = false;
                            }
                            
                            // Add payment to history
                            if (!user.subscription.razorpay.paymentHistory) {
                                user.subscription.razorpay.paymentHistory = [];
                            }
                            
                            user.subscription.razorpay.paymentHistory.push({
                                paymentId: razorpay_payment_id,
                                status: 'success',
                                paidAt: new Date()
                            });
                            
                            await user.save();
                            
                            console.log(`✅ Payment link payment successful for user: ${user.email}, Payment ID: ${razorpay_payment_id}`);
                        }
                    }
                }
            } catch (activationError) {
                console.error('Error activating subscription from payment link:', activationError);
            }
        }
        
        // Show success page for any successful payment
        if (razorpay_payment_id && (razorpay_subscription_id || razorpay_payment_link_status === 'paid')) {
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Payment Successful</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                            text-align: center; 
                            padding: 50px; 
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            margin: 0;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .success-container {
                            background: rgba(255,255,255,0.1);
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 500px;
                            margin: 0 auto;
                            backdrop-filter: blur(10px);
                        }
                        .success-icon { font-size: 60px; margin-bottom: 20px; }
                        .close-btn {
                            background: linear-gradient(135deg, #4CAF50, #45a049);
                            color: white;
                            border: none;
                            padding: 15px 30px;
                            border-radius: 8px;
                            font-size: 16px;
                            cursor: pointer;
                            margin: 10px;
                            transition: all 0.3s ease;
                        }
                        .close-btn:hover {
                            background: linear-gradient(135deg, #45a049, #3d8b40);
                            transform: translateY(-2px);
                        }
                        .payment-details {
                            background: rgba(255,255,255,0.1);
                            padding: 20px;
                            border-radius: 10px;
                            margin: 20px 0;
                            font-size: 14px;
                        }
                    </style>
                </head>
                <body>
                    <div class="success-container">
                        <div class="success-icon">🎉</div>
                        <h1>Payment Successful!</h1>
                        <p style="font-size: 1.2rem; margin: 20px 0;">Welcome to AutoScroll Premium!</p>
                        <div class="payment-details">
                            <p><strong>Payment ID:</strong> ${razorpay_payment_id}</p>
                            ${razorpay_subscription_id ? `<p><strong>Subscription ID:</strong> ${razorpay_subscription_id}</p>` : ''}
                            <p><strong>Status:</strong> Confirmed</p>
                        </div>
                        <p>Your premium subscription is now active!</p>
                        <p style="font-size: 14px; opacity: 0.9;">You can now close this tab and return to the extension.</p>
                        <button class="close-btn" onclick="window.close()">Close Tab</button>
                        <p style="font-size: 12px; margin-top: 20px; opacity: 0.7;">This tab will close automatically in 15 seconds</p>
                    </div>
                    <script>
                        // Auto-close after 15 seconds
                        setTimeout(() => window.close(), 15000);
                    </script>
                </body>
                </html>
            `);
        } else {
            // Payment failed or cancelled
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Payment Cancelled</title>
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            text-align: center; 
                            padding: 50px; 
                            background: linear-gradient(135deg, #ff6b6b, #ee5a52);
                            color: white;
                            margin: 0;
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .error-container {
                            background: rgba(255,255,255,0.1);
                            border-radius: 20px;
                            padding: 40px;
                            max-width: 500px;
                            margin: 0 auto;
                            backdrop-filter: blur(10px);
                        }
                        .error-icon { font-size: 60px; margin-bottom: 20px; }
                        .close-btn {
                            background: #f44336;
                            color: white;
                            border: none;
                            padding: 15px 30px;
                            border-radius: 8px;
                            font-size: 16px;
                            cursor: pointer;
                            margin-top: 20px;
                            transition: all 0.3s ease;
                        }
                        .close-btn:hover {
                            background: #da190b;
                            transform: translateY(-2px);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div class="error-icon">❌</div>
                        <h1>Payment Cancelled</h1>
                        <p>Your payment was not completed.</p>
                        <p>No charges have been made to your account.</p>
                        <p style="font-size: 14px; margin-top: 20px;">You can try again from the extension popup.</p>
                        <button class="close-btn" onclick="window.close()">Close Tab</button>
                        <p style="font-size: 12px; margin-top: 20px; opacity: 0.7;">This tab will close automatically in 10 seconds</p>
                    </div>
                    <script>
                        // Auto-close after 10 seconds
                        setTimeout(() => window.close(), 10000);
                    </script>
                </body>
                </html>
            `);
        }
        
    } catch (error) {
        console.error('❌ Payment callback error:', error);
        res.status(500).send(`
            <html>
            <head>
                <title>Error</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: #f44336;
                        color: white;
                    }
                    .error-container { 
                        background: rgba(255,255,255,0.1); 
                        padding: 40px; 
                        border-radius: 10px; 
                        max-width: 400px; 
                        margin: 0 auto; 
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1>❌ Error</h1>
                    <p>An error occurred processing your payment callback.</p>
                    <p>Please contact support if this issue persists.</p>
                    <button onclick="window.close()" style="
                        background: white; 
                        color: #f44336; 
                        border: none; 
                        padding: 10px 20px; 
                        border-radius: 5px; 
                        cursor: pointer;
                        margin-top: 20px;
                    ">Close Tab</button>
                </div>
            </body>
            </html>
        `);
    }
});



/**
 * Get subscription plans
 * GET /api/subscription/plans
 */
router.get('/plans', (req, res) => {
    try {
        const { SUBSCRIPTION_PLANS } = require('../config/razorpay');
        
        if (!SUBSCRIPTION_PLANS || !SUBSCRIPTION_PLANS.MONTHLY || !SUBSCRIPTION_PLANS.YEARLY) {
            throw new Error('Subscription plans not properly configured');
        }
        
        res.json({
            success: true,
            data: {
                plans: {
                    monthly: {
                        id: SUBSCRIPTION_PLANS.MONTHLY.id,
                        name: SUBSCRIPTION_PLANS.MONTHLY.name,
                        amount: SUBSCRIPTION_PLANS.MONTHLY.amount,
                        currency: SUBSCRIPTION_PLANS.MONTHLY.currency,
                        period: SUBSCRIPTION_PLANS.MONTHLY.period,
                        description: SUBSCRIPTION_PLANS.MONTHLY.description,
                        displayAmount: `₹${SUBSCRIPTION_PLANS.MONTHLY.amount / 100}`,
                        savings: null
                    },
                    yearly: {
                        id: SUBSCRIPTION_PLANS.YEARLY.id,
                        name: SUBSCRIPTION_PLANS.YEARLY.name,
                        amount: SUBSCRIPTION_PLANS.YEARLY.amount,
                        currency: SUBSCRIPTION_PLANS.YEARLY.currency,
                        period: SUBSCRIPTION_PLANS.YEARLY.period,
                        description: SUBSCRIPTION_PLANS.YEARLY.description,
                        displayAmount: `₹${SUBSCRIPTION_PLANS.YEARLY.amount / 100}`,
                        savings: `Save ₹${(SUBSCRIPTION_PLANS.MONTHLY.amount * 12 - SUBSCRIPTION_PLANS.YEARLY.amount) / 100}`
                    }
                },
                trial: {
                    duration: 10,
                    features: ['autoScroll', 'analytics', 'settings']
                }
            }
        });
        
    } catch (error) {
        console.error('❌ Get plans error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get subscription plans',
            error: error.message
        });
    }
});

/**
 * Record AutoScroll usage
 * POST /api/subscription/usage/record
 */
router.post('/usage/record', async (req, res) => {
    try {
        const { userId, feature = 'autoScroll' } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        // Validate access before recording usage
        const accessValidation = await SubscriptionService.validateFeatureAccess(user, feature);
        
        if (!accessValidation.hasAccess && !accessValidation.allowed) {
            return res.status(403).json({
                success: false,
                message: accessValidation.message || 'Access denied',
                reason: accessValidation.reason || 'access_denied',
                data: accessValidation
            });
        }
        
        // Record usage
        user.recordAutoScrollUsage();
        await user.save();
        
        res.json({
            success: true,
            message: 'Usage recorded successfully',
            data: {
                totalUsage: user.subscription.usage.totalAutoScrolls,
                accessType: accessValidation.accessType,
                daysRemaining: accessValidation.daysRemaining
            }
        });
        
    } catch (error) {
        console.error('❌ Record usage error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record usage',
            error: error.message
        });
    }
});

/**
 * Razorpay webhook handler
 * POST /api/subscription/webhook
 */
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const body = JSON.stringify(req.body);
        
        // Verify webhook signature
        if (!verifyWebhookSignature(body, signature)) {
            console.warn('⚠️ Invalid webhook signature received');
            return res.status(400).json({
                success: false,
                message: 'Invalid signature'
            });
        }
        
        console.log('📧 Webhook received:', req.body.event);
        
        const result = await SubscriptionService.handleWebhookEvent(req.body);
        
        res.json({
            success: true,
            message: 'Webhook processed successfully',
            data: result
        });
        
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).json({
            success: false,
            message: 'Webhook processing failed',
            error: error.message
        });
    }
});

/**
 * Get user subscription analytics
 * GET /api/subscription/analytics/:userId
 */
router.get('/analytics/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
        
        // Calculate usage analytics
        const analytics = {
            subscription: {
                status: subscriptionStatus.subscriptionStatus,
                type: subscriptionStatus.accessType,
                daysRemaining: subscriptionStatus.daysRemaining,
                expiryDate: subscriptionStatus.expiryDate
            },
            usage: {
                totalAutoScrolls: user.subscription?.usage?.totalAutoScrolls || 0,
                lastUsed: user.subscription?.usage?.lastAccessedAt,
                dailyUsage: user.subscription?.usage?.dailyUsage?.slice(-7) || [], // Last 7 days
                averageDaily: user.subscription?.usage?.dailyUsage?.length > 0 ?
                    user.subscription.usage.dailyUsage.reduce((sum, day) => sum + day.scrollCount, 0) / user.subscription.usage.dailyUsage.length :
                    0
            },
            features: user.subscription?.features || {},
            trial: {
                used: !user.subscription?.trial?.isActive || new Date() > user.subscription?.trial?.endDate,
                startDate: user.subscription?.trial?.startDate,
                endDate: user.subscription?.trial?.endDate
            }
        };
        
        res.json({
            success: true,
            data: analytics
        });
        
    } catch (error) {
        console.error('❌ Get analytics error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get analytics',
            error: error.message
        });
    }
});

/**
 * Manually trigger invoice processing for authenticated subscription
 * POST /api/subscription/trigger-charge/:subscriptionId
 */
router.post('/trigger-charge/:subscriptionId', async (req, res) => {
    try {
        const { subscriptionId } = req.params;
        
        if (!subscriptionId) {
            return res.status(400).json({
                success: false,
                message: 'Subscription ID is required'
            });
        }
        
        // Find user with this subscription
        const user = await User.findOne({ 'subscription.razorpay.subscriptionId': subscriptionId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found for this subscription'
            });
        }
        
        // Check if subscription is in authenticated state
        if (user.subscription.razorpay.status !== 'authenticated') {
            return res.status(400).json({
                success: false,
                message: `Subscription is in ${user.subscription.razorpay.status} state, not authenticated`
            });
        }
        
        const result = await SubscriptionService.triggerSubscriptionCharge(subscriptionId);
        
        res.json({
            success: true,
            message: 'Charge trigger initiated',
            data: result
        });
        
    } catch (error) {
        console.error('❌ Trigger charge error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger charge',
            error: error.message
        });
    }
});

/**
 * Trigger manual charge for authenticated subscription
 * POST /api/subscription/trigger-charge
 */
router.post('/trigger-charge', async (req, res) => {
    try {
        const { subscriptionId, userId } = req.body;
        
        if (!subscriptionId && !userId) {
            return res.status(400).json({
                success: false,
                message: 'Either subscriptionId or userId is required'
            });
        }
        
        const result = await SubscriptionService.triggerSubscriptionCharge(subscriptionId, userId);
        
        res.json({
            success: true,
            message: 'Subscription charge triggered successfully',
            data: result
        });
        
    } catch (error) {
        console.error('❌ Trigger charge error:', error);
        const errorResponse = formatErrorResponse(error);
        res.status(errorResponse.error.statusCode).json(errorResponse);
    }
});

/**
 * DEBUG: Get detailed subscription information for troubleshooting
 * GET /api/subscription/debug/:userId
 */
router.get('/debug/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
        const accessValidation = await SubscriptionService.validateFeatureAccess(user, 'autoScroll');
        
        // Detailed debug information
        const debugInfo = {
            userId: user._id,
            email: user.email,
            subscription: {
                razorpay: {
                    subscriptionId: user.subscription?.razorpay?.subscriptionId,
                    status: user.subscription?.razorpay?.status,
                    planId: user.subscription?.razorpay?.planId,
                    currentPeriodStart: user.subscription?.razorpay?.currentPeriodStart,
                    currentPeriodEnd: user.subscription?.razorpay?.currentPeriodEnd,
                    paymentHistory: user.subscription?.razorpay?.paymentHistory?.length || 0
                },
                trial: {
                    isActive: user.subscription?.trial?.isActive,
                    startDate: user.subscription?.trial?.startDate,
                    endDate: user.subscription?.trial?.endDate
                },
                features: user.subscription?.features,
                usage: {
                    totalAutoScrolls: user.subscription?.usage?.totalAutoScrolls,
                    lastAccessedAt: user.subscription?.usage?.lastAccessedAt
                }
            },
            computedStatus: subscriptionStatus,
            accessValidation: accessValidation,
            currentTime: new Date(),
            hasActiveAccess: user.hasActiveAccess()
        };
        
        res.json({
            success: true,
            data: debugInfo
        });
        
    } catch (error) {
        console.error('❌ Debug subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get debug information',
            error: error.message
        });
    }
});

/**
 * Force refresh subscription status (for stuck subscriptions)
 * POST /api/subscription/force-refresh
 */
router.post('/force-refresh', async (req, res) => {
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
        
        const subscriptionId = user.subscription?.razorpay?.subscriptionId;
        const currentStatus = user.subscription?.razorpay?.status;
        
        console.log(`🔄 Force refresh for user: ${user.email}, Current status: ${currentStatus}, Subscription: ${subscriptionId}`);
        
        // If user has a subscription, check its status with Razorpay
        if (subscriptionId) {
            try {
                const { fetchSubscription } = require('../config/razorpay');
                const razorpaySubscription = await fetchSubscription(subscriptionId);
                
                console.log(`📊 Razorpay says subscription ${subscriptionId} is: ${razorpaySubscription.status}`);
                
                // If Razorpay says it's active but our database doesn't reflect that
                if (razorpaySubscription.status === 'active' && currentStatus !== 'active') {
                    console.log(`🔧 Fixing stuck subscription: ${subscriptionId} for user: ${user.email}`);
                    
                    // Manually activate the subscription
                    user.subscription.razorpay.status = 'active';
                    user.subscription.razorpay.currentPeriodStart = new Date(razorpaySubscription.current_start * 1000);
                    user.subscription.razorpay.currentPeriodEnd = new Date(razorpaySubscription.current_end * 1000);
                    user.subscription.features.autoScroll = true;
                    user.subscription.features.analytics = true;
                    user.subscription.features.customSettings = true;
                    user.subscription.features.prioritySupport = true;
                    
                    // Deactivate trial
                    if (user.subscription.trial) {
                        user.subscription.trial.isActive = false;
                    }
                    
                    await user.save();
                    
                    console.log(`✅ Successfully fixed stuck subscription for: ${user.email}`);
                    
                    // Return updated subscription status
                    const updatedStatus = SubscriptionService.getUserSubscriptionStatus(user);
                    
                    res.json({
                        success: true,
                        message: 'Subscription status successfully updated to active',
                        data: updatedStatus,
                        fixed: true
                    });
                } else {
                    // No fix needed, just return current status
                    const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
                    
                    res.json({
                        success: true,
                        message: 'Subscription status is up to date',
                        data: subscriptionStatus,
                        fixed: false,
                        razorpayStatus: razorpaySubscription.status
                    });
                }
                
            } catch (fetchError) {
                console.error(`❌ Failed to fetch subscription from Razorpay:`, fetchError);
                
                // Fallback: just return current status
                const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
                
                res.json({
                    success: true,
                    message: 'Could not verify with Razorpay, returning current status',
                    data: subscriptionStatus,
                    fixed: false,
                    error: 'Could not reach Razorpay'
                });
            }
        } else {
            // No subscription ID, just return current status
            const subscriptionStatus = SubscriptionService.getUserSubscriptionStatus(user);
            
            res.json({
                success: true,
                message: 'No subscription found',
                data: subscriptionStatus,
                fixed: false
            });
        }
        
    } catch (error) {
        console.error('❌ Force refresh error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to refresh subscription status',
            error: error.message
        });
    }
});

/**
 * ADMIN: Fix stuck subscription status (force refresh from database)
 * POST /api/subscription/admin/fix-stuck
 */
router.post('/admin/fix-stuck', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        console.log(`🔧 ADMIN: Fixing stuck subscription for ${user.email}`);
        console.log(`Current status: ${user.subscription?.razorpay?.status}`);
        console.log(`Subscription ID: ${user.subscription?.razorpay?.subscriptionId}`);
        
        // If user has an active subscription but is stuck in processing
        if (user.subscription?.razorpay?.subscriptionId && 
            user.subscription?.razorpay?.status !== 'active') {
            
            // Force check subscription status from Razorpay
            const subscriptionId = user.subscription.razorpay.subscriptionId;
            
            try {
                const { fetchSubscription } = require('../config/razorpay');
                const razorpaySubscription = await fetchSubscription(subscriptionId);
                
                console.log(`🔧 Razorpay subscription status: ${razorpaySubscription.status}`);
                
                if (razorpaySubscription.status === 'active') {
                    // Force activate the subscription
                    user.subscription.razorpay.status = 'active';
                    user.subscription.razorpay.currentPeriodStart = new Date(razorpaySubscription.current_start * 1000);
                    user.subscription.razorpay.currentPeriodEnd = new Date(razorpaySubscription.current_end * 1000);
                    user.subscription.features.autoScroll = true;
                    user.subscription.features.analytics = true;
                    user.subscription.features.customSettings = true;
                    user.subscription.features.prioritySupport = true;
                    
                    // Deactivate trial
                    if (user.subscription.trial) {
                        user.subscription.trial.isActive = false;
                    }
                    
                    await user.save();
                    
                    console.log(`✅ ADMIN: Fixed stuck subscription for ${user.email} - now active`);
                    
                    res.json({
                        success: true,
                        message: 'Subscription status fixed - now active',
                        data: {
                            userId: user._id,
                            subscriptionId: subscriptionId,
                            oldStatus: 'stuck',
                            newStatus: 'active',
                            razorpayStatus: razorpaySubscription.status
                        }
                    });
                } else {
                    res.json({
                        success: false,
                        message: `Razorpay subscription is not active: ${razorpaySubscription.status}`,
                        data: {
                            userId: user._id,
                            subscriptionId: subscriptionId,
                            currentStatus: user.subscription.razorpay.status,
                            razorpayStatus: razorpaySubscription.status
                        }
                    });
                }
                
            } catch (fetchError) {
                console.error(`❌ Failed to fetch subscription from Razorpay:`, fetchError);
                res.status(500).json({
                    success: false,
                    message: 'Failed to fetch subscription from Razorpay',
                    error: fetchError.message
                });
            }
        } else {
            res.json({
                success: false,
                message: 'Subscription is not stuck or already active',
                data: {
                    userId: user._id,
                    currentStatus: user.subscription?.razorpay?.status,
                    subscriptionId: user.subscription?.razorpay?.subscriptionId
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Admin fix stuck subscription error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fix stuck subscription',
            error: error.message
        });
    }
});

/**
 * ADMIN: Manually activate subscription (simulate successful webhook)
 * POST /api/subscription/admin/activate
 */
router.post('/admin/activate', async (req, res) => {
    try {
        const { userId, subscriptionId } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'userId is required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        const subId = subscriptionId || user.subscription?.razorpay?.subscriptionId;
        if (!subId) {
            return res.status(400).json({
                success: false,
                message: 'No subscription found for user'
            });
        }
        
        // Create mock subscription object for webhook simulation
        const mockSubscription = {
            id: subId,
            entity: 'subscription',
            plan_id: user.subscription.razorpay.planId,
            status: 'active',
            current_start: Math.floor(Date.now() / 1000),
            current_end: Math.floor((Date.now() + (30 * 24 * 60 * 60 * 1000)) / 1000), // 30 days from now
            charge_at: Math.floor((Date.now() + (30 * 24 * 60 * 60 * 1000)) / 1000),
            created_at: Math.floor((Date.now() - (10 * 60 * 1000)) / 1000) // 10 minutes ago
        };
        
        // Call the webhook handler directly to simulate successful payment
        const result = await SubscriptionService.handleSubscriptionActivated(mockSubscription);
        
        console.log(`🔧 ADMIN: Manually activated subscription for ${user.email}: ${subId}`);
        
        res.json({
            success: true,
            message: 'Subscription manually activated',
            data: {
                userId: user._id,
                subscriptionId: subId,
                status: 'active',
                result
            }
        });
        
    } catch (error) {
        console.error('❌ Admin activate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to activate subscription',
            error: error.message
        });
    }
});

/**
 * ADMIN: Manually update subscription status (for testing webhook failures)
 * POST /api/subscription/admin/update-status
 */
router.post('/admin/update-status', async (req, res) => {
    try {
        const { userId, subscriptionId, status } = req.body;
        
        if (!userId || !status) {
            return res.status(400).json({
                success: false,
                message: 'userId and status are required'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        if (!user.subscription?.razorpay?.subscriptionId) {
            return res.status(400).json({
                success: false,
                message: 'No subscription found for user'
            });
        }
        
        // Update subscription status
        const oldStatus = user.subscription.razorpay.status;
        user.subscription.razorpay.status = status;
        
        // If activating subscription, enable all features
        if (status === 'active') {
            user.subscription.features.autoScroll = true;
            user.subscription.features.analytics = true;
            user.subscription.features.customSettings = true;
            user.subscription.features.prioritySupport = true;
            
            // Update billing period if provided
            if (subscriptionId) {
                const now = new Date();
                user.subscription.razorpay.currentPeriodStart = now;
                user.subscription.razorpay.currentPeriodEnd = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // 30 days
            }
        }
        
        await user.save();
        
        console.log(`🔧 ADMIN: Updated subscription status for ${user.email}: ${oldStatus} → ${status}`);
        
        res.json({
            success: true,
            message: `Subscription status updated from ${oldStatus} to ${status}`,
            data: {
                userId: user._id,
                subscriptionId: user.subscription.razorpay.subscriptionId,
                oldStatus,
                newStatus: status,
                features: user.subscription.features
            }
        });
        
    } catch (error) {
        console.error('❌ Admin update status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update subscription status',
            error: error.message
        });
    }
});

module.exports = router;
