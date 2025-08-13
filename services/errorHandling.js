// Error handling service for subscription system
class SubscriptionError extends Error {
    constructor(message, code, statusCode = 500) {
        super(message);
        this.name = 'SubscriptionError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

const errorCodes = {
    TRIAL_ALREADY_USED: 'TRIAL_ALREADY_USED',
    SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
    WEBHOOK_VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED',
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    SUBSCRIPTION_ALREADY_ACTIVE: 'SUBSCRIPTION_ALREADY_ACTIVE',
    TRIAL_EXPIRED: 'TRIAL_EXPIRED',
    RAZORPAY_API_ERROR: 'RAZORPAY_API_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    INVALID_SUBSCRIPTION_STATUS: 'INVALID_SUBSCRIPTION_STATUS'
};

const errorMessages = {
    [errorCodes.TRIAL_ALREADY_USED]: 'Free trial has already been used for this account',
    [errorCodes.SUBSCRIPTION_NOT_FOUND]: 'Subscription not found',
    [errorCodes.PAYMENT_FAILED]: 'Payment processing failed',
    [errorCodes.WEBHOOK_VERIFICATION_FAILED]: 'Webhook verification failed',
    [errorCodes.PLAN_NOT_FOUND]: 'Subscription plan not found',
    [errorCodes.USER_NOT_FOUND]: 'User not found',
    [errorCodes.SUBSCRIPTION_ALREADY_ACTIVE]: 'User already has an active subscription',
    [errorCodes.TRIAL_EXPIRED]: 'Free trial has expired',
    [errorCodes.RAZORPAY_API_ERROR]: 'Payment gateway error',
    [errorCodes.DATABASE_ERROR]: 'Database operation failed',
    [errorCodes.INVALID_SUBSCRIPTION_STATUS]: 'Invalid subscription status'
};

// Retry mechanism for Razorpay API calls
const retryRazorpayCall = async (operation, maxRetries = 3) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.error(`Razorpay API attempt ${attempt} failed:`, error.message);
            
            // Don't retry on client errors (4xx)
            if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
                break;
            }
            
            // Wait before retrying (exponential backoff)
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw new SubscriptionError(
        `Razorpay API failed after ${maxRetries} attempts: ${lastError.message}`,
        errorCodes.RAZORPAY_API_ERROR,
        502
    );
};

// Handle webhook delivery failures
const handleWebhookError = async (webhookData, error) => {
    console.error('Webhook processing failed:', error);
    
    // Store failed webhook for retry
    const failedWebhook = {
        data: webhookData,
        error: error.message,
        timestamp: new Date(),
        retryCount: 0
    };
    
    // In production, store this in database for retry mechanism
    console.log('Failed webhook stored for retry:', failedWebhook);
    
    return failedWebhook;
};

// Graceful degradation for when payment gateway is down
const getGracefulSubscriptionStatus = async (user) => {
    try {
        // If Razorpay is down, rely on local database status
        if (user.subscriptionStatus === 'active' && user.subscriptionEnd > new Date()) {
            return {
                isActive: true,
                source: 'local_cache',
                warning: 'Payment gateway temporarily unavailable'
            };
        }
        
        // If trial is still valid
        if (user.trialEnd && user.trialEnd > new Date()) {
            return {
                isActive: true,
                source: 'trial',
                daysRemaining: Math.ceil((user.trialEnd - new Date()) / (1000 * 60 * 60 * 24))
            };
        }
        
        return {
            isActive: false,
            source: 'local_cache'
        };
    } catch (error) {
        console.error('Error in graceful subscription check:', error);
        return {
            isActive: false,
            source: 'error',
            error: error.message
        };
    }
};

// Circuit breaker for external API calls
class CircuitBreaker {
    constructor(threshold = 5, timeout = 60000) {
        this.failureThreshold = threshold;
        this.timeout = timeout;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    }
    
    async call(operation) {
        if (this.state === 'OPEN') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'HALF_OPEN';
            } else {
                throw new SubscriptionError(
                    'Circuit breaker is OPEN - service temporarily unavailable',
                    errorCodes.RAZORPAY_API_ERROR,
                    503
                );
            }
        }
        
        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }
    
    onSuccess() {
        this.failureCount = 0;
        this.state = 'CLOSED';
    }
    
    onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        
        if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
        }
    }
}

// Global circuit breaker for Razorpay
const razorpayCircuitBreaker = new CircuitBreaker();

// Enhanced error response formatter
const formatErrorResponse = (error) => {
    if (error instanceof SubscriptionError) {
        return {
            success: false,
            error: {
                code: error.code,
                message: error.message,
                statusCode: error.statusCode
            }
        };
    }
    
    // Handle Razorpay errors
    if (error.name === 'RazorpayError') {
        return {
            success: false,
            error: {
                code: errorCodes.RAZORPAY_API_ERROR,
                message: 'Payment gateway error: ' + error.message,
                statusCode: 502
            }
        };
    }
    
    // Handle database errors
    if (error.name === 'MongoError' || error.name === 'ValidationError') {
        return {
            success: false,
            error: {
                code: errorCodes.DATABASE_ERROR,
                message: 'Database operation failed',
                statusCode: 500
            }
        };
    }
    
    // Generic error
    return {
        success: false,
        error: {
            code: 'UNKNOWN_ERROR',
            message: 'An unexpected error occurred',
            statusCode: 500
        }
    };
};

// Subscription state recovery
const recoverSubscriptionState = async (user) => {
    try {
        console.log(`Recovering subscription state for user: ${user._id}`);
        
        // If user has Razorpay subscription ID, try to fetch current status
        if (user.razorpaySubscriptionId) {
            const razorpay = require('../config/razorpay').razorpayInstance;
            
            try {
                const subscription = await razorpayCircuitBreaker.call(async () => {
                    return await razorpay.subscriptions.fetch(user.razorpaySubscriptionId);
                });
                
                // Update local status based on Razorpay status
                const isActive = subscription.status === 'active';
                const subscriptionEnd = subscription.current_end ? new Date(subscription.current_end * 1000) : null;
                
                await user.updateSubscriptionStatus({
                    isActive,
                    subscriptionEnd,
                    razorpayData: subscription
                });
                
                console.log(`Subscription state recovered from Razorpay for user: ${user._id}`);
                return { success: true, source: 'razorpay' };
                
            } catch (razorpayError) {
                console.warn(`Could not fetch from Razorpay, using local state:`, razorpayError.message);
                // Fall back to local state if Razorpay is unavailable
                return { success: true, source: 'local', warning: 'Payment gateway unavailable' };
            }
        }
        
        return { success: true, source: 'local' };
    } catch (error) {
        console.error('Failed to recover subscription state:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    SubscriptionError,
    errorCodes,
    errorMessages,
    retryRazorpayCall,
    handleWebhookError,
    getGracefulSubscriptionStatus,
    CircuitBreaker,
    razorpayCircuitBreaker,
    formatErrorResponse,
    recoverSubscriptionState
};
