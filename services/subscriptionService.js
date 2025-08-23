const User = require('../models/User');
const { 
    razorpay, 
    SUBSCRIPTION_PLANS, 
    TRIAL_CONFIG, 
    SUBSCRIPTION_STATUS,
    createSubscription,
    cancelSubscription,
    fetchSubscription,
    calculateTrialEndDate,
    calculateDaysRemaining,
    checkUserAccess,
    fetchPendingInvoices,
    chargeInvoice
} = require('../config/razorpay');
const { 
    SubscriptionError, 
    errorCodes, 
    retryRazorpayCall, 
    handleWebhookError,
    getGracefulSubscriptionStatus,
    razorpayCircuitBreaker,
    recoverSubscriptionState
} = require('./errorHandling');

/**
 * Subscription Service
 * Handles all subscription-related business logic
 */
class SubscriptionService {
    
    /**
     * Initialize trial for new user
     * @param {Object} user - User document
     * @returns {Promise<Object>} - Trial details
     */
    static async initializeTrial(user) {
        try {
            if (!user.subscription || !user.subscription.trial) {
                // Initialize subscription structure if not exists
                user.subscription = {
                    trial: {
                        isActive: true,
                        startDate: new Date(),
                        endDate: calculateTrialEndDate(),
                        usedFeatures: []
                    },
                    razorpay: {
                        status: SUBSCRIPTION_STATUS.TRIAL
                    },
                    features: {
                        autoScroll: true,
                        analytics: true,
                        customSettings: false,
                        prioritySupport: false
                    },
                    usage: {
                        lastAccessedAt: new Date(),
                        totalAutoScrolls: 0,
                        dailyUsage: []
                    }
                };
            } else {
                // Start trial for existing user
                user.startFreeTrial();
            }
            
            await user.save();
            
            console.log(`✅ Trial initialized for user: ${user.email}`);
            
            return {
                success: true,
                trial: {
                    isActive: user.subscription.trial.isActive,
                    startDate: user.subscription.trial.startDate,
                    endDate: user.subscription.trial.endDate,
                    daysRemaining: calculateDaysRemaining(user.subscription.trial.endDate)
                }
            };
        } catch (error) {
            console.error('❌ Failed to initialize trial:', error);
            throw new Error('Failed to initialize trial');
        }
    }
    
    /**
     * Create Razorpay subscription for user (following Razorpay subscription workflow)
     * @param {Object} user - User document
     * @param {string} planType - 'monthly' or 'yearly'
     * @returns {Promise<Object>} - Subscription details with subscription link
     */
    static async createUserSubscription(user, planType = 'monthly') {
        try {
            const planKey = planType.toUpperCase();
            const plan = SUBSCRIPTION_PLANS[planKey];
            
            if (!plan) {
                throw new SubscriptionError(
                    `Invalid plan type: ${planType}`,
                    errorCodes.PLAN_NOT_FOUND,
                    400
                );
            }

            // Check if user already has active subscription
            const hasAccess = await user.hasActiveAccess();
            if (hasAccess.hasAccess && hasAccess.type === 'subscription') {
                throw new SubscriptionError(
                    'User already has an active subscription',
                    errorCodes.SUBSCRIPTION_ALREADY_ACTIVE,
                    400
                );
            }
            
            // For immediate start subscriptions, don't set start_at
            // This ensures the subscription starts with the first payment (immediate billing)
            const subscriptionData = {
                plan_id: plan.id,
                customer_notify: 1, // Send notification to customer
                quantity: 1,
                total_count: planType === 'yearly' ? 1 : 12, // 1 billing cycle for yearly, 12 for monthly
                // No start_at parameter for immediate start
                addons: [],
                notes: {
                    user_id: user._id.toString(),
                    email: user.email,
                    plan_type: planType,
                    extension_name: 'AutoScroll Extension'
                }
            };
            
            // Create subscription in Razorpay with retry mechanism (follows image 1 -> 2 flow)
            const razorpaySubscription = await retryRazorpayCall(async () => {
                return await createSubscription(subscriptionData);
            });
            
            // Initialize subscription structure if not exists
            if (!user.subscription) {
                user.subscription = {
                    trial: {
                        isActive: false,
                        startDate: null,
                        endDate: null
                    },
                    razorpay: {},
                    features: {
                        autoScroll: false,
                        analytics: false,
                        customSettings: false,
                        prioritySupport: false
                    },
                    usage: {
                        lastAccessedAt: new Date(),
                        totalAutoScrolls: 0,
                        dailyUsage: []
                    }
                };
            }
            
            // Update user subscription details with Razorpay subscription data
            user.subscription.razorpay.subscriptionId = razorpaySubscription.id;
            user.subscription.razorpay.planId = plan.id;
            user.subscription.razorpay.status = SUBSCRIPTION_STATUS.CREATED; // Created state (image 2)
            user.subscription.razorpay.currentPeriodStart = new Date(razorpaySubscription.current_start * 1000);
            user.subscription.razorpay.currentPeriodEnd = new Date(razorpaySubscription.current_end * 1000);
            
            // Deactivate trial if active
            if (user.subscription.trial && user.subscription.trial.isActive) {
                user.subscription.trial.isActive = false;
            }
            
            await user.save();
            
            console.log(`✅ Subscription created for user: ${user.email}, Plan: ${planType}, ID: ${razorpaySubscription.id}`);
            console.log(`📧 Subscription link: ${razorpaySubscription.short_url}`);
            
            return {
                success: true,
                subscription: {
                    id: razorpaySubscription.id,
                    planId: plan.id,
                    planName: plan.name,
                    amount: plan.amount,
                    currency: plan.currency,
                    status: razorpaySubscription.status, // 'created' state from Razorpay
                    startDate: new Date(razorpaySubscription.current_start * 1000),
                    endDate: new Date(razorpaySubscription.current_end * 1000),
                    shortUrl: razorpaySubscription.short_url, // Subscription link for payment (image 2 -> 3)
                    authenticateUrl: razorpaySubscription.authenticate_url || razorpaySubscription.short_url
                }
            };
            
        } catch (error) {
            console.error('❌ Failed to create subscription:', error);
            throw new Error(`Failed to create subscription: ${error.message}`);
        }
    }
    
    /**
     * Cancel user subscription
     * @param {Object} user - User document
     * @param {boolean} cancelAtCycleEnd - Whether to cancel at cycle end
     * @returns {Promise<Object>} - Cancellation details
     */
    static async cancelUserSubscription(user, cancelAtCycleEnd = true) {
        try {
            if (!user.subscription.razorpay.subscriptionId) {
                throw new Error('No active subscription found');
            }
            
            // Cancel subscription in Razorpay
            const cancelledSubscription = await cancelSubscription(
                user.subscription.razorpay.subscriptionId,
                cancelAtCycleEnd
            );
            
            // Update user subscription status
            user.subscription.razorpay.status = cancelAtCycleEnd ? 
                SUBSCRIPTION_STATUS.ACTIVE : SUBSCRIPTION_STATUS.CANCELLED;
            user.subscription.razorpay.cancelAtCycleEnd = cancelAtCycleEnd;
            user.subscription.razorpay.cancelledAt = new Date();
            
            if (!cancelAtCycleEnd) {
                // Immediate cancellation - disable premium features
                user.subscription.features.customSettings = false;
                user.subscription.features.prioritySupport = false;
            }
            
            await user.save();
            
            console.log(`✅ Subscription cancelled for user: ${user.email}, At cycle end: ${cancelAtCycleEnd}`);
            
            return {
                success: true,
                cancellation: {
                    subscriptionId: user.subscription.razorpay.subscriptionId,
                    cancelAtCycleEnd,
                    cancelledAt: user.subscription.razorpay.cancelledAt,
                    activeUntil: cancelAtCycleEnd ? user.subscription.razorpay.currentPeriodEnd : new Date()
                }
            };
            
        } catch (error) {
            console.error('❌ Failed to cancel subscription:', error);
            throw new Error(`Failed to cancel subscription: ${error.message}`);
        }
    }
    
    /**
     * Get user subscription status and details
     * @param {Object} user - User document
     * @returns {Object} - Complete subscription status
     */
    static getUserSubscriptionStatus(user) {
        try {
            if (!user.subscription) {
                // Initialize trial for users without subscription data
                return {
                    hasAccess: false,
                    type: 'no_subscription',
                    needsTrialInit: true,
                    daysRemaining: 0
                };
            }
            
            const access = user.hasActiveAccess();
            const summary = user.getSubscriptionSummary();
            
            return {
                ...access,
                ...summary,
                plans: {
                    monthly: {
                        id: SUBSCRIPTION_PLANS.MONTHLY.id,
                        name: SUBSCRIPTION_PLANS.MONTHLY.name,
                        amount: SUBSCRIPTION_PLANS.MONTHLY.amount,
                        currency: SUBSCRIPTION_PLANS.MONTHLY.currency,
                        description: SUBSCRIPTION_PLANS.MONTHLY.description
                    },
                    yearly: {
                        id: SUBSCRIPTION_PLANS.YEARLY.id,
                        name: SUBSCRIPTION_PLANS.YEARLY.name,
                        amount: SUBSCRIPTION_PLANS.YEARLY.amount,
                        currency: SUBSCRIPTION_PLANS.YEARLY.currency,
                        description: SUBSCRIPTION_PLANS.YEARLY.description
                    }
                }
            };
            
        } catch (error) {
            console.error('❌ Failed to get subscription status:', error);
            return {
                hasAccess: false,
                type: 'error',
                daysRemaining: 0,
                error: error.message
            };
        }
    }
    
    /**
     * Validate user access for extension features
     * @param {Object} user - User document
     * @param {string} feature - Feature to check access for
     * @returns {Object} - Access validation result
     */
    static validateFeatureAccess(user, feature = 'autoScroll') {
        try {
            const access = user.hasActiveAccess();
            
            if (!access.hasAccess) {
                return {
                    allowed: false,
                    reason: 'trial_expired',
                    message: 'Your free trial has expired. Please subscribe to continue using AutoScroll.',
                    daysRemaining: 0
                };
            }
            
            // Check feature-specific access
            if (feature === 'customSettings' || feature === 'prioritySupport') {
                if (access.type === 'trial') {
                    return {
                        allowed: false,
                        reason: 'premium_feature',
                        message: 'This is a premium feature. Please subscribe to access it.',
                        daysRemaining: access.daysRemaining
                    };
                }
            }
            
            return {
                allowed: true,
                accessType: access.type,
                daysRemaining: access.daysRemaining,
                expiryDate: access.expiryDate
            };
            
        } catch (error) {
            console.error('❌ Failed to validate feature access:', error);
            return {
                allowed: false,
                reason: 'validation_error',
                message: 'Unable to validate access. Please try again.',
                error: error.message
            };
        }
    }
    
    /**
     * Handle Razorpay webhook events
     * @param {Object} event - Webhook event data
     * @returns {Promise<Object>} - Processing result
     */
    static async handleWebhookEvent(event) {
        try {
            console.log(`📧 Processing webhook: ${event.event} for ${event.payload.subscription?.entity?.id || 'unknown'}`);
            
            switch (event.event) {
                case 'subscription.authenticated':
                    return await this.handleSubscriptionAuthenticated(event.payload.subscription.entity);
                    
                case 'subscription.activated':
                    return await this.handleSubscriptionActivated(event.payload.subscription.entity);
                    
                case 'subscription.charged':
                    return await this.handleSubscriptionCharged(event.payload.payment.entity, event.payload.subscription.entity);
                    
                case 'subscription.cancelled':
                    return await this.handleSubscriptionCancelled(event.payload.subscription.entity);
                    
                case 'subscription.completed':
                    return await this.handleSubscriptionCompleted(event.payload.subscription.entity);
                    
                case 'payment.failed':
                    return await this.handlePaymentFailed(event.payload.payment.entity);
                    
                default:
                    console.log(`ℹ️ Unhandled webhook event: ${event.event}`);
                    return { success: true, message: 'Event acknowledged but not processed' };
            }
            
        } catch (error) {
            console.error('❌ Webhook processing failed:', error);
            
            // Store failed webhook for retry
            await handleWebhookError(event, error);
            
            throw new SubscriptionError(
                `Webhook processing failed: ${error.message}`,
                'WEBHOOK_PROCESSING_FAILED',
                500
            );
        }
    }
    
    /**
     * Handle subscription authenticated webhook
     * This is called when customer completes authentication transaction
     * For immediate start subscriptions, this means the subscription is ready for charging
     */
    static async handleSubscriptionAuthenticated(subscription) {
        try {
            const user = await User.findOne({ 'subscription.razorpay.subscriptionId': subscription.id });
            
            if (!user) {
                console.warn(`⚠️ User not found for subscription: ${subscription.id}`);
                return { success: false, message: 'User not found' };
            }
            
            // Update subscription status to authenticated
            user.subscription.razorpay.status = SUBSCRIPTION_STATUS.AUTHENTICATED;
            user.subscription.razorpay.currentPeriodStart = new Date(subscription.current_start * 1000);
            user.subscription.razorpay.currentPeriodEnd = new Date(subscription.current_end * 1000);
            
            await user.save();
            
            console.log(`🔐 Subscription authenticated for user: ${user.email}, ID: ${subscription.id}`);
            console.log(`📅 Billing period: ${new Date(subscription.current_start * 1000)} to ${new Date(subscription.current_end * 1000)}`);
            
            // For immediate start subscriptions, fetch and process any pending invoices
            try {
                const pendingInvoices = await fetchPendingInvoices(subscription.id);
                
                if (pendingInvoices.length > 0) {
                    console.log(`� Processing ${pendingInvoices.length} pending invoices for subscription: ${subscription.id}`);
                    
                    for (const invoice of pendingInvoices) {
                        if (invoice.status === 'issued') {
                            console.log(`� Triggering payment for invoice: ${invoice.id}`);
                            await chargeInvoice(invoice.id);
                        }
                    }
                }
            } catch (invoiceError) {
                console.warn(`⚠️ Could not process pending invoices for subscription: ${subscription.id}`, invoiceError.message);
                // Don't fail the entire webhook for invoice processing issues
            }
            return { success: true, message: 'Subscription authenticated' };
            
        } catch (error) {
            console.error('❌ Failed to handle subscription authentication:', error);
            throw error;
        }
    }

    /**
     * Handle subscription activated webhook
     */
    static async handleSubscriptionActivated(subscription) {
        try {
            const user = await User.findOne({ 'subscription.razorpay.subscriptionId': subscription.id });
            
            if (!user) {
                console.warn(`⚠️ User not found for subscription: ${subscription.id}`);
                return { success: false, message: 'User not found' };
            }
            
            // Activate subscription and enable all features
            user.subscription.razorpay.status = SUBSCRIPTION_STATUS.ACTIVE;
            user.subscription.razorpay.currentPeriodStart = new Date(subscription.current_start * 1000);
            user.subscription.razorpay.currentPeriodEnd = new Date(subscription.current_end * 1000);
            user.subscription.features.autoScroll = true;
            user.subscription.features.analytics = true;
            user.subscription.features.customSettings = true;
            user.subscription.features.prioritySupport = true;
            
            // Deactivate trial
            if (user.subscription.trial) {
                user.subscription.trial.isActive = false;
            }
            
            await user.save();
            
            console.log(`✅ Subscription activated for user: ${user.email}, Plan: ${subscription.plan_id}`);
            return { success: true, message: 'Subscription activated' };
            
        } catch (error) {
            console.error('❌ Failed to handle subscription activation:', error);
            throw error;
        }
    }
    
    /**
     * Handle subscription charged webhook
     */
    static async handleSubscriptionCharged(payment, subscription) {
        try {
            const user = await User.findOne({ 'subscription.razorpay.subscriptionId': subscription.id });
            
            if (!user) {
                console.warn(`⚠️ User not found for subscription: ${subscription.id}`);
                return { success: false, message: 'User not found' };
            }
            
            // Record payment in user history
            user.subscription.razorpay.paymentHistory.push({
                paymentId: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                paidAt: new Date(payment.created_at * 1000)
            });
            
            // Update subscription details
            user.updateSubscriptionStatus(subscription);
            await user.save();
            
            console.log(`💰 Payment processed for user: ${user.email}, Amount: ${payment.amount/100} ${payment.currency}`);
            return { success: true, message: 'Payment recorded' };
            
        } catch (error) {
            console.error('❌ Failed to handle subscription charge:', error);
            throw error;
        }
    }
    
    /**
     * Handle subscription cancelled webhook
     */
    static async handleSubscriptionCancelled(subscription) {
        try {
            const user = await User.findOne({ 'subscription.razorpay.subscriptionId': subscription.id });
            
            if (!user) {
                console.warn(`⚠️ User not found for subscription: ${subscription.id}`);
                return { success: false, message: 'User not found' };
            }
            
            user.subscription.razorpay.status = SUBSCRIPTION_STATUS.CANCELLED;
            user.subscription.razorpay.cancelledAt = new Date();
            
            // Disable premium features immediately if hard cancellation
            if (subscription.status === 'cancelled') {
                user.subscription.features.customSettings = false;
                user.subscription.features.prioritySupport = false;
            }
            
            await user.save();
            
            console.log(`❌ Subscription cancelled for user: ${user.email}`);
            return { success: true, message: 'Subscription cancelled' };
            
        } catch (error) {
            console.error('❌ Failed to handle subscription cancellation:', error);
            throw error;
        }
    }
    
    /**
     * Manually trigger subscription charge for authenticated subscriptions
     */
    static async triggerSubscriptionCharge(subscriptionId) {
        try {
            console.log(`🔄 Triggering charge for subscription: ${subscriptionId}`);
            
            // Fetch subscription details from Razorpay
            const subscription = await fetchSubscription(subscriptionId);
            
            if (subscription.status !== 'authenticated') {
                throw new SubscriptionError(
                    `Subscription is in ${subscription.status} state, expected authenticated`,
                    'INVALID_SUBSCRIPTION_STATE',
                    400
                );
            }
            
            // Fetch and process pending invoices
            const pendingInvoices = await fetchPendingInvoices(subscriptionId);
            
            if (pendingInvoices.length === 0) {
                return {
                    success: true,
                    message: 'No pending invoices found',
                    invoicesProcessed: 0
                };
            }
            
            let processedCount = 0;
            const processedInvoices = [];
            
            for (const invoice of pendingInvoices) {
                try {
                    if (invoice.status === 'issued') {
                        const processedInvoice = await chargeInvoice(invoice.id);
                        processedInvoices.push({
                            id: invoice.id,
                            amount: invoice.amount,
                            status: processedInvoice.status
                        });
                        processedCount++;
                        console.log(`✅ Processed invoice: ${invoice.id}, Amount: ${invoice.amount/100}`);
                    }
                } catch (invoiceError) {
                    console.error(`❌ Failed to process invoice ${invoice.id}:`, invoiceError.message);
                    processedInvoices.push({
                        id: invoice.id,
                        amount: invoice.amount,
                        error: invoiceError.message
                    });
                }
            }
            
            return {
                success: true,
                message: `Processed ${processedCount} out of ${pendingInvoices.length} invoices`,
                invoicesProcessed: processedCount,
                totalInvoices: pendingInvoices.length,
                invoices: processedInvoices
            };
            
        } catch (error) {
            console.error('❌ Failed to trigger subscription charge:', error);
            throw error;
        }
    }

    /**
     * Handle subscription completed webhook
     */
    static async handleSubscriptionCompleted(subscription) {
        try {
            const user = await User.findOne({ 'subscription.razorpay.subscriptionId': subscription.id });
            
            if (!user) {
                console.warn(`⚠️ User not found for subscription: ${subscription.id}`);
                return { success: false, message: 'User not found' };
            }
            
            user.subscription.razorpay.status = SUBSCRIPTION_STATUS.EXPIRED;
            user.subscription.features.customSettings = false;
            user.subscription.features.prioritySupport = false;
            
            await user.save();
            
            console.log(`⏱️ Subscription completed for user: ${user.email}`);
            return { success: true, message: 'Subscription completed' };
            
        } catch (error) {
            console.error('❌ Failed to handle subscription completion:', error);
            throw error;
        }
    }
    
    /**
     * Handle payment failed webhook
     */
    static async handlePaymentFailed(payment) {
        try {
            // Find subscription associated with this payment
            const subscription = await fetchSubscription(payment.subscription_id);
            const user = await User.findOne({ 'subscription.razorpay.subscriptionId': payment.subscription_id });
            
            if (!user) {
                console.warn(`⚠️ User not found for failed payment: ${payment.id}`);
                return { success: false, message: 'User not found' };
            }
            
            // Record failed payment
            user.subscription.razorpay.paymentHistory.push({
                paymentId: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                status: 'failed',
                paidAt: new Date(payment.created_at * 1000),
                failureReason: payment.error_description || 'Payment failed'
            });
            
            // Update subscription status if needed
            user.subscription.razorpay.status = SUBSCRIPTION_STATUS.PAST_DUE;
            
            await user.save();
            
            console.log(`💸 Payment failed for user: ${user.email}, Reason: ${payment.error_description}`);
            return { success: true, message: 'Payment failure recorded' };
            
        } catch (error) {
            console.error('❌ Failed to handle payment failure:', error);
            throw error;
        }
    }
    
    /**
     * Validate feature access with graceful degradation
     * @param {Object} user - User document
     * @param {String} feature - Feature name to check
     * @returns {Promise<Object>} - Access validation result
     */
    static async validateFeatureAccess(user, feature = 'autoScroll') {
        try {
            // First try normal subscription check
            const hasAccess = await user.hasActiveAccess();
            
            if (hasAccess.hasAccess) {
                return {
                    hasAccess: true,
                    source: hasAccess.type,
                    daysRemaining: hasAccess.daysRemaining,
                    reliable: true
                };
            }
            
            // If no access according to local state, try to recover from Razorpay
            if (user.subscription?.razorpay?.subscriptionId) {
                console.log('Attempting subscription state recovery for user:', user._id);
                const recovery = await recoverSubscriptionState(user);
                
                if (recovery.success) {
                    // Re-check after recovery
                    const updatedAccess = await user.hasActiveAccess();
                    return {
                        hasAccess: updatedAccess.hasAccess,
                        source: updatedAccess.type || recovery.source,
                        daysRemaining: updatedAccess.daysRemaining,
                        reliable: recovery.source === 'razorpay',
                        recovered: true
                    };
                }
            }
            
            // If all else fails, use graceful degradation
            const gracefulStatus = await getGracefulSubscriptionStatus(user);
            
            return {
                hasAccess: gracefulStatus.isActive,
                source: gracefulStatus.source,
                daysRemaining: gracefulStatus.daysRemaining || 0,
                reliable: false,
                warning: gracefulStatus.warning || gracefulStatus.error
            };
            
        } catch (error) {
            console.error('Error validating feature access:', error);
            
            // In case of total failure, allow limited access if trial is valid
            const trialValid = user.subscription?.trial?.endDate && user.subscription.trial.endDate > new Date();
            
            return {
                hasAccess: trialValid,
                source: 'fallback',
                daysRemaining: trialValid ? Math.ceil((user.subscription.trial.endDate - new Date()) / (1000 * 60 * 60 * 24)) : 0,
                reliable: false,
                error: error.message
            };
        }
    }
    
    /**
     * Trigger manual charge for authenticated subscription
     * @param {string} subscriptionId - Razorpay subscription ID
     * @param {string} userId - User ID (alternative to subscriptionId)
     * @returns {Promise<Object>} - Charge result
     */
    static async triggerSubscriptionCharge(subscriptionId, userId) {
        try {
            let user;
            let subId = subscriptionId;
            
            // If userId provided, get subscription ID from user
            if (userId) {
                user = await User.findById(userId);
                if (!user) {
                    throw new SubscriptionError('User not found', 'USER_NOT_FOUND', 404);
                }
                subId = user.subscription?.razorpay?.subscriptionId;
                if (!subId) {
                    throw new SubscriptionError('No subscription found for user', 'SUBSCRIPTION_NOT_FOUND', 404);
                }
            }
            
            if (!subId) {
                throw new SubscriptionError('Subscription ID is required', 'SUBSCRIPTION_ID_REQUIRED', 400);
            }
            
            // Fetch current subscription status
            const subscription = await fetchSubscription(subId);
            
            if (subscription.status !== 'authenticated') {
                throw new SubscriptionError(
                    `Cannot trigger charge for subscription in ${subscription.status} status. Expected: authenticated`,
                    'INVALID_SUBSCRIPTION_STATUS',
                    400
                );
            }
            
            // Fetch pending invoices for this subscription
            const pendingInvoices = await fetchPendingInvoices(subId);
            
            if (pendingInvoices.length === 0) {
                return {
                    success: true,
                    message: 'No pending invoices found',
                    subscriptionId: subId,
                    status: subscription.status
                };
            }
            
            // Charge the first pending invoice
            const firstInvoice = pendingInvoices[0];
            console.log(`💳 Attempting to charge invoice: ${firstInvoice.id} for subscription: ${subId}`);
            
            const chargeResult = await chargeInvoice(firstInvoice.id);
            
            // Update user subscription status if user found
            if (user) {
                // This will be updated by webhook, but we can update optimistically
                user.subscription.razorpay.lastChargeAttempt = new Date();
                await user.save();
            }
            
            console.log(`✅ Invoice charge triggered: ${firstInvoice.id}, Status: ${chargeResult.status}`);
            
            return {
                success: true,
                message: 'Subscription charge triggered successfully',
                subscriptionId: subId,
                invoiceId: firstInvoice.id,
                chargeStatus: chargeResult.status,
                amount: firstInvoice.amount,
                currency: firstInvoice.currency
            };
            
        } catch (error) {
            console.error('❌ Failed to trigger subscription charge:', error);
            throw error;
        }
    }
}

module.exports = SubscriptionService;
