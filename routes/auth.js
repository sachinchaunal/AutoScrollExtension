const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * Google OAuth Login/Register endpoint
 * Handles user authentication via Google OAuth
 */
router.post('/google-login', async (req, res) => {
    try {
        const {
            googleId,
            email,
            name,
            picture,
            verified_email,
            extensionVersion,
            loginTimestamp
        } = req.body;

        console.log(`Auth: Google login attempt for email: ${email}, googleId: ${googleId}`);

        // Validate required fields
        if (!googleId || !email || !name) {
            return res.status(400).json({
                success: false,
                message: 'Missing required Google authentication data',
                required: ['googleId', 'email', 'name']
            });
        }

        // Check if user already exists (by googleId or email)
        let existingUser = await User.findOne({
            $or: [
                { googleId: googleId },
                { email: email }
            ]
        });

        if (existingUser) {
            // Existing user - update their information and login
            console.log(`Auth: Existing user found: ${existingUser.email}`);

            // Update user information
            existingUser.googleId = googleId;
            existingUser.email = email;
            existingUser.name = name;
            existingUser.picture = picture;
            existingUser.verified_email = verified_email;
            existingUser.lastLoginDate = new Date();
            existingUser.extensionVersion = extensionVersion;
            existingUser.loginCount = (existingUser.loginCount || 0) + 1;

            // Generate auth token
            const authToken = existingUser.generateAuthToken();
            console.log(`Auth login: Generated token for ${existingUser.email}: ${authToken.substring(0, 10)}..., expiry: ${existingUser.authTokenExpiry}`);
            await existingUser.save();

            console.log(`Auth: User login successful - ${existingUser.email}, subscription: ${existingUser.subscriptionStatus}, trial: ${existingUser.trialDaysRemaining} days`);

            return res.json({
                success: true,
                data: {
                    userId: existingUser._id,
                    googleId: existingUser.googleId,
                    email: existingUser.email,
                    name: existingUser.name,
                    picture: existingUser.picture,
                    subscriptionStatus: existingUser.subscriptionStatus,
                    trialDaysRemaining: existingUser.trialDaysRemaining,
                    isSubscriptionActive: existingUser.isSubscriptionActive,
                    canUseExtension: existingUser.canUseExtension,
                    authToken: authToken,
                    isNewUser: false,
                    isExistingUser: true,
                    message: `Welcome back, ${existingUser.name}!`
                }
            });
        }

        // New user - create account with 10-day free trial
        console.log(`Auth: Creating new user account for: ${email}`);

        const newUser = new User({
            googleId: googleId,
            email: email,
            name: name,
            picture: picture,
            verified_email: verified_email,
            
            // Trial settings (10 days free trial)
            subscriptionStatus: 'trial',
            trialDaysRemaining: 10,
            trialStartDate: new Date(),
            trialEndDate: new Date(Date.now() + (10 * 24 * 60 * 60 * 1000)), // 10 days from now
            isTrialActive: true,
            
            // User metadata
            createdAt: new Date(),
            lastLoginDate: new Date(),
            extensionVersion: extensionVersion,
            loginCount: 1,
            
            // Settings
            settings: {
                autoScrollEnabled: false,
                platform: 'youtube',
                notifications: true
            }
        });

        // Generate auth token
        const authToken = newUser.generateAuthToken();
        console.log(`Auth new user: Generated token for ${newUser.email}: ${authToken.substring(0, 10)}..., expiry: ${newUser.authTokenExpiry}`);
        await newUser.save();

        console.log(`Auth: New user created successfully - ${newUser.email}, userId: ${newUser._id}, trial: ${newUser.trialDaysRemaining} days`);

        res.status(201).json({
            success: true,
            data: {
                userId: newUser._id,
                googleId: newUser.googleId,
                email: newUser.email,
                name: newUser.name,
                picture: newUser.picture,
                subscriptionStatus: newUser.subscriptionStatus,
                trialDaysRemaining: newUser.trialDaysRemaining,
                isSubscriptionActive: newUser.isSubscriptionActive,
                canUseExtension: newUser.canUseExtension,
                authToken: authToken,
                isNewUser: true,
                isExistingUser: false,
                trialEndDate: newUser.trialEndDate,
                message: `Welcome ${newUser.name}! Your 10-day free trial has started.`
            }
        });

    } catch (error) {
        console.error('Auth: Google login error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * Verify user authentication token
 */
router.post('/verify-token', async (req, res) => {
    try {
        const { authToken, userId } = req.body;

        if (!authToken || !userId) {
            return res.status(400).json({
                success: false,
                message: 'Missing authentication token or user ID'
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify token
        const isValidToken = user.verifyAuthToken(authToken);
        
        console.log(`Auth verify: User ${userId}, token: ${authToken.substring(0, 10)}..., stored: ${user.authToken ? user.authToken.substring(0, 10) + '...' : 'none'}, expiry: ${user.authTokenExpiry}, valid: ${isValidToken}`);

        if (!isValidToken) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired authentication token'
            });
        }

        // Update last activity
        user.lastActiveDate = new Date();
        await user.save();

        res.json({
            success: true,
            data: {
                userId: user._id,
                email: user.email,
                name: user.name,
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                canUseExtension: user.canUseExtension,
                isSubscriptionActive: user.isSubscriptionActive
            }
        });

    } catch (error) {
        console.error('Auth: Token verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Token verification failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * Get user profile and subscription data
 */
router.get('/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const authToken = req.headers.authorization?.replace('Bearer ', '');

        if (!authToken) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token required'
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify token
        if (!user.verifyAuthToken(authToken)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token'
            });
        }

        res.json({
            success: true,
            data: {
                userId: user._id,
                googleId: user.googleId,
                email: user.email,
                name: user.name,
                picture: user.picture,
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                trialEndDate: user.trialEndDate,
                isSubscriptionActive: user.isSubscriptionActive,
                canUseExtension: user.canUseExtension,
                settings: user.settings,
                createdAt: user.createdAt,
                lastLoginDate: user.lastLoginDate,
                loginCount: user.loginCount
            }
        });

    } catch (error) {
        console.error('Auth: Profile fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user profile',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * Update user settings
 */
router.put('/settings/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { settings } = req.body;
        const authToken = req.headers.authorization?.replace('Bearer ', '');

        if (!authToken) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token required'
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify token
        if (!user.verifyAuthToken(authToken)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid authentication token'
            });
        }

        // Update settings
        user.settings = { ...user.settings, ...settings };
        user.lastActiveDate = new Date();
        await user.save();

        res.json({
            success: true,
            data: {
                settings: user.settings,
                message: 'Settings updated successfully'
            }
        });

    } catch (error) {
        console.error('Auth: Settings update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update settings',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * Logout endpoint (invalidate token)
 */
router.post('/logout', async (req, res) => {
    try {
        const { userId, authToken } = req.body;

        if (!userId || !authToken) {
            return res.status(400).json({
                success: false,
                message: 'Missing user ID or authentication token'
            });
        }

        const user = await User.findById(userId);

        if (user) {
            // Invalidate the token by updating authTokenExpiry
            user.authTokenExpiry = new Date();
            await user.save();
        }

        res.json({
            success: true,
            data: {
                message: 'Logout successful'
            }
        });

    } catch (error) {
        console.error('Auth: Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Logout failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
