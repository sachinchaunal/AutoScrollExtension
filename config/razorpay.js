const Razorpay = require('razorpay');
const crypto = require('crypto');

// Razorpay Configuration
const razorpayConfig = {
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
    webhook_secret: process.env.RAZORPAY_WEBHOOK_SECRET
};

// Initialize Razorpay instance
const razorpay = new Razorpay({
    key_id: razorpayConfig.key_id,
    key_secret: razorpayConfig.key_secret
});

// Subscription Plans Configuration
const SUBSCRIPTION_PLANS = {
    MONTHLY: {
        id: process.env.RAZORPAY_PLAN_ID || 'plan_monthly_premium', // Use env plan ID or default
        name: 'AutoScroll Premium Monthly',
        amount: (process.env.SUBSCRIPTION_PRICE || 9) * 100, // Convert ₹9 to paise (900 paise = ₹9)
        currency: 'INR',
        period: 'monthly',
        interval: 1,
        description: process.env.SUBSCRIPTION_DESCRIPTION || 'Monthly subscription for AutoScroll Premium features',
        total_count: process.env.SUBSCRIPTION_TOTAL_COUNT || 12 // Number of billing cycles
    },
    YEARLY: {
        id: process.env.RAZORPAY_YEARLY_PLAN_ID || 'plan_yearly_premium',
        name: 'AutoScroll Premium Yearly',
        amount: (process.env.SUBSCRIPTION_PRICE || 9) * 11 * 100, // 11 months price for yearly (1 month free), ₹99
        currency: 'INR',
        period: 'yearly',
        interval: 1,
        description: 'Yearly subscription for AutoScroll Premium features (Save 1 month)',
        total_count: 1 // One billing cycle for yearly
    }
};

// Trial Configuration
const TRIAL_CONFIG = {
    DURATION_DAYS: 10,
    FEATURE_ACCESS: ['autoscroll', 'analytics', 'settings']
};

// Subscription Status Enums
const SUBSCRIPTION_STATUS = {
    TRIAL: 'trial',
    ACTIVE: 'active',
    PAST_DUE: 'past_due',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
    CREATED: 'created',
    AUTHENTICATED: 'authenticated',
    PENDING: 'pending'
};

/**
 * Verify Razorpay webhook signature
 * @param {string} body - Raw request body
 * @param {string} signature - Razorpay signature from header
 * @returns {boolean} - Whether signature is valid
 */
function verifyWebhookSignature(body, signature) {
    try {
        const expectedSignature = crypto
            .createHmac('sha256', razorpayConfig.webhook_secret)
            .update(body)
            .digest('hex');
        
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch (error) {
        console.error('Webhook signature verification failed:', error);
        return false;
    }
}

/**
 * Create a Razorpay subscription plan
 * @param {object} planDetails - Plan configuration
 * @returns {Promise<object>} - Created plan details
 */
async function createPlan(planDetails) {
    try {
        const planData = {
            period: planDetails.period,
            interval: planDetails.interval,
            item: {
                name: planDetails.name,
                amount: planDetails.amount,
                currency: planDetails.currency,
                description: planDetails.description
            }
        };

        // For monthly plan, use total_count if provided
        if (planDetails.total_count) {
            planData.total_count = planDetails.total_count;
        }

        const plan = await razorpay.plans.create(planData);
        
        console.log(`✅ Razorpay plan created: ${plan.id} (${planDetails.name}) - ₹${planDetails.amount/100}/month`);
        
        // Update the plan ID in our configuration if it was auto-generated
        planDetails.id = plan.id;
        
        return plan;
    } catch (error) {
        console.error(`❌ Failed to create Razorpay plan ${planDetails.name}:`, error);
        throw error;
    }
}

/**
 * Create a subscription for a customer (Enhanced for subscription workflow)
 * @param {object} subscriptionData - Subscription details
 * @returns {Promise<object>} - Created subscription with links
 */
async function createSubscription(subscriptionData) {
    try {
        // Prepare subscription payload
        const payload = {
            plan_id: subscriptionData.plan_id,
            customer_notify: subscriptionData.customer_notify || 1,
            quantity: subscriptionData.quantity || 1,
            total_count: subscriptionData.total_count || 12, // 12 months for annual by default
            addons: subscriptionData.addons || [],
            notes: {
                user_id: subscriptionData.user_id,
                email: subscriptionData.email,
                plan_type: subscriptionData.plan_type || 'monthly',
                extension_name: 'AutoScroll Extension',
                ...subscriptionData.notes
            },
            // Set callback URLs for subscription flow
            notify_info: {
                notify_phone: subscriptionData.notify_phone,
                notify_email: subscriptionData.notify_email || subscriptionData.email
            }
        };
        
        // Only add start_at if explicitly provided (for immediate start, omit this)
        if (subscriptionData.start_at) {
            payload.start_at = subscriptionData.start_at;
        }
        
        // For no expiry, don't set expire_by (Razorpay default is no expiry for subscription links)
        // Only set expire_by if explicitly provided
        if (subscriptionData.expire_by) {
            payload.expire_by = subscriptionData.expire_by;
        }
        
        const subscription = await razorpay.subscriptions.create(payload);
        
        console.log('✅ Razorpay subscription created:', subscription.id);
        console.log('📧 Subscription link available:', subscription.short_url);
        console.log('🔧 Subscription settings - Immediate start:', !subscriptionData.start_at, ', No expiry:', !subscriptionData.expire_by);
        
        return subscription;
    } catch (error) {
        console.error('❌ Failed to create Razorpay subscription:', error);
        throw error;
    }
}

/**
 * Cancel a subscription
 * @param {string} subscriptionId - Razorpay subscription ID
 * @param {boolean} cancelAtCycleEnd - Whether to cancel at cycle end
 * @returns {Promise<object>} - Cancelled subscription details
 */
async function cancelSubscription(subscriptionId, cancelAtCycleEnd = true) {
    try {
        const subscription = await razorpay.subscriptions.cancel(subscriptionId, {
            cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0
        });
        
        console.log('✅ Razorpay subscription cancelled:', subscriptionId);
        return subscription;
    } catch (error) {
        console.error('❌ Failed to cancel Razorpay subscription:', error);
        throw error;
    }
}

/**
 * Fetch subscription details
 * @param {string} subscriptionId - Razorpay subscription ID
 * @returns {Promise<object>} - Subscription details
 */
async function fetchSubscription(subscriptionId) {
    try {
        const subscription = await razorpay.subscriptions.fetch(subscriptionId);
        return subscription;
    } catch (error) {
        console.error('❌ Failed to fetch Razorpay subscription:', error);
        throw error;
    }
}

/**
 * Calculate trial end date
 * @param {Date} startDate - Trial start date
 * @returns {Date} - Trial end date
 */
function calculateTrialEndDate(startDate = new Date()) {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + TRIAL_CONFIG.DURATION_DAYS);
    return endDate;
}

/**
 * Calculate days remaining in trial or subscription
 * @param {Date} endDate - End date of trial/subscription
 * @returns {number} - Days remaining (0 if expired)
 */
function calculateDaysRemaining(endDate) {
    const now = new Date();
    const end = new Date(endDate);
    const diffTime = end - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
}

/**
 * Check if user has active access (trial or subscription)
 * @param {object} user - User object with subscription data
 * @returns {object} - Access status and details
 */
function checkUserAccess(user) {
    const now = new Date();
    
    // Check trial access
    if (user.subscription?.trial?.isActive) {
        const trialEnd = new Date(user.subscription.trial.endDate);
        if (now <= trialEnd) {
            return {
                hasAccess: true,
                type: 'trial',
                daysRemaining: calculateDaysRemaining(trialEnd),
                expiryDate: trialEnd
            };
        }
    }
    
    // Check subscription access
    if (user.subscription?.razorpay?.status === SUBSCRIPTION_STATUS.ACTIVE) {
        const subEnd = new Date(user.subscription.razorpay.currentPeriodEnd);
        if (now <= subEnd) {
            return {
                hasAccess: true,
                type: 'subscription',
                daysRemaining: calculateDaysRemaining(subEnd),
                expiryDate: subEnd,
                plan: user.subscription.razorpay.planId
            };
        }
    }
    
    return {
        hasAccess: false,
        type: 'expired',
        daysRemaining: 0
    };
}

/**
 * Initialize subscription plans on server start
 */
async function initializePlans() {
    try {
        console.log('🔧 Initializing Razorpay subscription plans...');
        
        // Check if plans exist, if not create them
        for (const [key, planConfig] of Object.entries(SUBSCRIPTION_PLANS)) {
            try {
                // Try to fetch existing plan
                await razorpay.plans.fetch(planConfig.id);
                console.log(`✅ Plan ${planConfig.id} already exists`);
            } catch (error) {
                if (error.error && error.error.code === 'BAD_REQUEST_ERROR') {
                    // Plan doesn't exist, create it
                    await createPlan(planConfig);
                } else {
                    console.error(`❌ Error checking plan ${planConfig.id}:`, error);
                }
            }
        }
        
        console.log('✅ Razorpay plans initialization complete');
    } catch (error) {
        console.error('❌ Failed to initialize Razorpay plans:', error);
    }
}

/**
 * Fetch pending invoices for a subscription
 */
async function fetchPendingInvoices(subscriptionId) {
    try {
        const invoices = await razorpay.invoices.all({
            subscription_id: subscriptionId,
            status: 'issued'
        });
        
        console.log(`📋 Found ${invoices.items.length} pending invoices for subscription: ${subscriptionId}`);
        return invoices.items;
    } catch (error) {
        console.error('❌ Failed to fetch pending invoices:', error);
        throw error;
    }
}

/**
 * Charge a specific invoice manually
 */
async function chargeInvoice(invoiceId) {
    try {
        const invoice = await razorpay.invoices.fetch(invoiceId);
        
        if (invoice.status === 'issued') {
            // For subscriptions with immediate start, Razorpay should automatically
            // attempt charging, but we can also manually issue/send the invoice
            const updatedInvoice = await razorpay.invoices.issue(invoiceId);
            console.log(`📤 Invoice ${invoiceId} has been issued for payment`);
            return updatedInvoice;
        }
        
        return invoice;
    } catch (error) {
        console.error('❌ Failed to charge invoice:', error);
        throw error;
    }
}

module.exports = {
    razorpay,
    razorpayConfig,
    SUBSCRIPTION_PLANS,
    TRIAL_CONFIG,
    SUBSCRIPTION_STATUS,
    verifyWebhookSignature,
    createPlan,
    createSubscription,
    cancelSubscription,
    fetchSubscription,
    calculateTrialEndDate,
    calculateDaysRemaining,
    checkUserAccess,
    initializePlans,
    fetchPendingInvoices,
    chargeInvoice
};
