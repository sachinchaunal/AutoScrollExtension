const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

/**
 * Smart Rate Limiting Middleware for AutoScroll Extension
 * Implements tiered rate limits based on request type and user patterns
 */

// General API rate limiter with secure trust proxy configuration
const generalApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Secure trust proxy configuration
    trustProxy: process.env.NODE_ENV === 'production' ? 1 : false,
    handler: (req, res) => {
        console.warn(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
        res.status(429).json({
            success: false,
            message: 'Too many requests, please try again later.',
            retryAfter: 15 * 60 * 1000
        });
    }
});

// Strict rate limiter for subscription validation (the main problem endpoint)
const subscriptionValidationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // Limit to 10 subscription checks per 5 minutes per IP
    message: {
        success: false,
        message: 'Too many subscription validation requests. Using cached data.',
        retryAfter: 5 * 60 * 1000,
        useCachedData: true
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Secure trust proxy configuration
    trustProxy: process.env.NODE_ENV === 'production' ? 1 : false,
    keyGenerator: (req) => {
        // Use user ID if available, otherwise fall back to IP
        const userId = req.body?.userId || req.params?.userId || req.ip;
        return `subscription_${userId}`;
    },
    handler: (req, res) => {
        const userId = req.body?.userId || req.params?.userId || 'unknown';
        console.warn(`Subscription validation rate limit exceeded for user: ${userId}, IP: ${req.ip}`);
        
        res.status(429).json({
            success: false,
            message: 'Too many subscription checks. Please use cached data or try again later.',
            retryAfter: 5 * 60 * 1000,
            useCachedData: true,
            rateLimited: true
        });
    }
});

// Authentication rate limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit to 20 auth requests per 15 minutes per IP
    message: {
        success: false,
        message: 'Too many authentication attempts, please try again later.',
        retryAfter: 15 * 60 * 1000
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Secure trust proxy configuration
    trustProxy: process.env.NODE_ENV === 'production' ? 1 : false,
    handler: (req, res) => {
        console.warn(`Auth rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
        res.status(429).json({
            success: false,
            message: 'Too many authentication attempts, please try again later.',
            retryAfter: 15 * 60 * 1000
        });
    }
});

// Speed limiter (progressive delay) for excessive requests
const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000, // 15 minutes
    delayAfter: 5, // Allow 5 requests per 15 minutes without delay
    delayMs: () => 500, // Fixed 500ms delay per request after delayAfter (v3.0 format)
    maxDelayMs: 10000, // Maximum delay of 10 seconds
    validate: {
        delayMs: false // Disable the delayMs deprecation warning
    }
});

// Per-user rate limiter based on user ID (more granular)
const createUserRateLimiter = (windowMs = 5 * 60 * 1000, max = 15) => {
    return rateLimit({
        windowMs,
        max,
        keyGenerator: (req) => {
            // Extract user ID from various possible locations
            const userId = req.body?.userId || 
                          req.params?.userId || 
                          req.headers['x-user-id'] ||
                          req.query?.userId ||
                          req.ip;
            return `user_${userId}`;
        },
        message: {
            success: false,
            message: 'Too many requests for this user account.',
            retryAfter: windowMs,
            useLocalCache: true
        },
        handler: (req, res) => {
            const userId = req.body?.userId || req.params?.userId || 'unknown';
            console.warn(`User rate limit exceeded for user: ${userId}, IP: ${req.ip}`);
            
            res.status(429).json({
                success: false,
                message: 'Too many requests from your account. Please wait before trying again.',
                retryAfter: windowMs,
                useLocalCache: true,
                rateLimited: true
            });
        }
    });
};

// Smart middleware that applies different limits based on endpoint
const smartRateLimit = (req, res, next) => {
    const path = req.path.toLowerCase();
    const method = req.method.toLowerCase();
    
    // Apply appropriate rate limiter based on endpoint
    if (path.includes('/subscription/validate-access')) {
        // Most restrictive - this is the endpoint causing the problem
        return subscriptionValidationLimiter(req, res, next);
    } else if (path.includes('/auth/')) {
        // Moderate restriction for auth endpoints
        return authLimiter(req, res, next);
    } else if (path.includes('/subscription/')) {
        // Moderate restriction for other subscription endpoints
        return createUserRateLimiter(10 * 60 * 1000, 25)(req, res, next);
    } else {
        // General API rate limiting for other endpoints
        return generalApiLimiter(req, res, next);
    }
};

// Request frequency analyzer (for debugging)
const requestFrequencyAnalyzer = (req, res, next) => {
    const userId = req.body?.userId || req.params?.userId || 'anonymous';
    const endpoint = req.path;
    const timestamp = Date.now();
    
    // Store request metadata for analysis
    if (!global.requestAnalytics) {
        global.requestAnalytics = new Map();
    }
    
    const userKey = `${userId}_${endpoint}`;
    const userRequests = global.requestAnalytics.get(userKey) || [];
    
    // Add current request
    userRequests.push(timestamp);
    
    // Keep only last 100 requests per user/endpoint
    if (userRequests.length > 100) {
        userRequests.splice(0, userRequests.length - 100);
    }
    
    global.requestAnalytics.set(userKey, userRequests);
    
    // Analyze frequency (requests in last minute)
    const oneMinuteAgo = timestamp - 60000;
    const recentRequests = userRequests.filter(time => time > oneMinuteAgo);
    
    // Log if excessive frequency detected
    if (recentRequests.length > 10) {
        console.warn(`⚠️ High frequency detected: User ${userId} made ${recentRequests.length} requests to ${endpoint} in last minute`);
    }
    
    // Add analytics to request for monitoring
    req.requestAnalytics = {
        userId,
        endpoint,
        recentRequestCount: recentRequests.length,
        isHighFrequency: recentRequests.length > 10
    };
    
    next();
};

// Cleanup function for analytics data (run periodically)
const cleanupAnalytics = () => {
    if (!global.requestAnalytics) return;
    
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleanedCount = 0;
    
    for (const [key, requests] of global.requestAnalytics.entries()) {
        // Remove old requests
        const recentRequests = requests.filter(time => time > oneHourAgo);
        
        if (recentRequests.length === 0) {
            global.requestAnalytics.delete(key);
            cleanedCount++;
        } else {
            global.requestAnalytics.set(key, recentRequests);
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} old analytics entries`);
    }
};

// Run cleanup every 30 minutes
setInterval(cleanupAnalytics, 30 * 60 * 1000);

module.exports = {
    generalApiLimiter,
    subscriptionValidationLimiter,
    authLimiter,
    speedLimiter,
    createUserRateLimiter,
    smartRateLimit,
    requestFrequencyAnalyzer,
    cleanupAnalytics
};