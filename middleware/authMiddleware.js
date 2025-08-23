/**
 * Enhanced Authentication Middleware with Auto-Refresh
 * Handles 10-day persistent sessions with automatic token refresh
 */

const User = require('../models/User');

/**
 * Verify authentication token with auto-refresh capability
 */
const authenticateToken = async (req, res, next) => {
    try {
        // Extract token from various sources
        let token = null;
        let userId = null;

        // Check Authorization header (Bearer token)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
            userId = req.body.userId || req.params.userId || req.query.userId;
        }

        // Check request body
        if (!token && req.body.authToken) {
            token = req.body.authToken;
            userId = req.body.userId;
        }

        // Check query parameters (for GET requests)
        if (!token && req.query.authToken) {
            token = req.query.authToken;
            userId = req.query.userId;
        }

        if (!token || !userId) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token and user ID required',
                requiresReauth: true,
                code: 'MISSING_AUTH'
            });
        }

        // Find user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
                requiresReauth: true,
                code: 'USER_NOT_FOUND'
            });
        }

        // Verify token (includes auto-refresh)
        const isValidToken = user.verifyAuthToken(token);
        
        if (!isValidToken) {
            console.log(`Auth middleware: Token verification failed for user ${userId}`);
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired authentication token',
                requiresReauth: true,
                code: 'TOKEN_INVALID'
            });
        }

        // Save user if token was auto-refreshed
        if (user.isModified('authTokenExpiry')) {
            await user.save();
            console.log(`Auth middleware: Token auto-refreshed for ${user.email}`);
            
            // Add refresh info to response headers
            res.set('X-Token-Refreshed', 'true');
            res.set('X-Token-Expires', user.authTokenExpiry.toISOString());
        }

        // Update last activity
        user.lastActiveDate = new Date();
        await user.save();

        // Attach user to request for use in route handlers
        req.user = user;
        req.authToken = token;
        
        // Add auth info to response headers
        res.set('X-User-ID', user._id.toString());
        res.set('X-Token-Valid', 'true');

        next();

    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication error',
            requiresReauth: false,
            code: 'AUTH_ERROR',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
    try {
        // Try to authenticate, but don't fail if no token
        const authHeader = req.headers.authorization;
        const token = req.body.authToken || req.query.authToken || 
                     (authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null);
        const userId = req.body.userId || req.params.userId || req.query.userId;

        if (token && userId) {
            const user = await User.findById(userId);
            if (user && user.verifyAuthToken(token)) {
                // Save if token was refreshed
                if (user.isModified('authTokenExpiry')) {
                    await user.save();
                }
                
                user.lastActiveDate = new Date();
                await user.save();
                
                req.user = user;
                req.authToken = token;
                req.isAuthenticated = true;
            }
        }

        req.isAuthenticated = !!req.user;
        next();

    } catch (error) {
        console.error('Optional auth middleware error:', error);
        req.isAuthenticated = false;
        req.user = null;
        next(); // Continue without authentication
    }
};

/**
 * Check if user has valid subscription access
 */
const requireSubscription = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required',
                requiresReauth: true,
                code: 'NO_AUTH'
            });
        }

        const subscriptionStatus = req.user.hasActiveAccess();
        
        if (!subscriptionStatus.hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Valid subscription required',
                subscriptionRequired: true,
                code: 'SUBSCRIPTION_REQUIRED',
                data: {
                    accessType: subscriptionStatus.type,
                    hasAccess: false,
                    reason: subscriptionStatus.type === 'expired' ? 'Trial or subscription expired' : 'No active subscription'
                }
            });
        }

        // Add subscription info to request
        req.subscriptionStatus = subscriptionStatus;
        next();

    } catch (error) {
        console.error('Subscription middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Subscription check failed',
            code: 'SUBSCRIPTION_ERROR'
        });
    }
};

/**
 * Rate limiting per user
 */
const userRateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    const requestCounts = new Map();
    
    return (req, res, next) => {
        const userId = req.user?._id?.toString() || req.ip;
        const now = Date.now();
        const windowStart = now - windowMs;
        
        // Clean old entries
        for (const [key, data] of requestCounts.entries()) {
            if (data.resetTime < now) {
                requestCounts.delete(key);
            }
        }
        
        // Check current user
        const userRequests = requestCounts.get(userId) || { count: 0, resetTime: now + windowMs };
        
        if (userRequests.count >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: 'Rate limit exceeded',
                retryAfter: Math.ceil((userRequests.resetTime - now) / 1000),
                code: 'RATE_LIMIT'
            });
        }
        
        userRequests.count++;
        requestCounts.set(userId, userRequests);
        
        next();
    };
};

module.exports = {
    authenticateToken,
    optionalAuth,
    requireSubscription,
    userRateLimit
};