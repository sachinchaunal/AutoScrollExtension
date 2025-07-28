const express = require('express');
const router = express.Router();
const User = require('../models/User');
const crypto = require('crypto');

// Rate limiting for trial verification
const trialVerificationAttempts = new Map();

/**
 * Initialize or verify device and trial status
 * This is called when the extension starts up
 */
router.post('/verify-device', async (req, res) => {
    try {
        const { 
            deviceFingerprint, 
            userId, 
            deviceInfo,
            userAgent,
            extensionVersion,
            securityFingerprint,
            sessionValidation
        } = req.body;

        if (!deviceFingerprint) {
            return res.status(400).json({
                success: false,
                message: 'Device fingerprint is required',
                action: 'block'
            });
        }

        // Check for rate limiting
        const clientIP = req.ip || req.connection.remoteAddress;
        const rateLimitKey = `${clientIP}_${deviceFingerprint}`;
        
        if (isRateLimited(rateLimitKey)) {
            return res.status(429).json({
                success: false,
                message: 'Too many verification attempts. Please wait.',
                action: 'block',
                retryAfter: 300 // 5 minutes
            });
        }

        // Advanced security checks
        const securityChecks = await performSecurityChecks({
            deviceFingerprint,
            userAgent,
            clientIP,
            securityFingerprint,
            sessionValidation
        });

        if (securityChecks.riskLevel === 'high') {
            console.log(`High-risk session detected: ${securityChecks.reason}`);
            
            // Still allow but mark for monitoring
            if (securityChecks.shouldBlock) {
                return res.status(403).json({
                    success: false,
                    message: 'Security validation failed. Please try again.',
                    action: 'block',
                    reason: 'security_risk'
                });
            }
        }

        // Check for existing trial abuse first (before creating new users)
        const existingTrialUser = await User.findOne({ 
            deviceFingerprint: deviceFingerprint,
            isTrialUsed: true 
        });
        
        if (existingTrialUser) {
            console.log(`Found existing user for device ${deviceFingerprint.substring(0, 16)}...`);
            
            // If userId matches, this is the same user - proceed normally
            if (existingTrialUser.userId === userId) {
                console.log('Same user, proceeding with existing user');
            } else if (existingTrialUser.userId !== userId) {
                // Different userId with same device - this is likely a reinstall
                console.log(`Device reinstall detected: updating userId from ${existingTrialUser.userId} to ${userId}`);
                
                // Update the existing user with new userId instead of creating duplicate
                existingTrialUser.userId = userId;
                existingTrialUser.lastActiveDate = new Date();
                existingTrialUser.lastSeenIP = clientIP;
                existingTrialUser.installationAttempts += 1;
                
                // Update device info if provided
                if (deviceInfo) {
                    existingTrialUser.deviceInfo = { ...existingTrialUser.deviceInfo, ...deviceInfo };
                }
                
                // Store security fingerprint data
                if (securityFingerprint) {
                    existingTrialUser.securityFingerprint = securityFingerprint;
                    existingTrialUser.securityRiskLevel = securityChecks.riskLevel;
                }
                
                // Generate verification token
                const verificationToken = existingTrialUser.generateVerificationToken();
                
                await existingTrialUser.save();
                
                const response = {
                    success: true,
                    data: {
                        userId: existingTrialUser.userId,
                        deviceFingerprint: existingTrialUser.deviceFingerprint,
                        subscriptionStatus: existingTrialUser.subscriptionStatus,
                        trialDaysRemaining: existingTrialUser.trialDaysRemaining,
                        isSubscriptionActive: existingTrialUser.isSubscriptionActive,
                        canUseExtension: existingTrialUser.isSubscriptionActive && existingTrialUser.subscriptionStatus !== 'blocked',
                        verificationToken: verificationToken,
                        isNewDevice: false,
                        settings: existingTrialUser.settings
                    }
                };
                
                return res.json(response);
            }
        }

        // Ensure userId is provided - generate one if missing
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            console.log(`Generated userId for device: ${userId}`);
        }

        // Find or create user - first check by deviceFingerprint, then by userId
        let user = await User.findOne({ deviceFingerprint: deviceFingerprint });
        
        // If no user found by deviceFingerprint, check by userId (if provided)
        if (!user && userId) {
            user = await User.findOne({ userId: userId });
            
            if (user) {
                // User exists with different device fingerprint - update it
                console.log(`User ${userId} found with different device fingerprint, updating...`);
                user.deviceFingerprint = deviceFingerprint;
            }
        }

        const isNewDevice = !user;
        const now = new Date();

        if (!user) {
            // Create new user
            user = new User({
                userId: userId,
                deviceFingerprint: deviceFingerprint,
                trialStartDate: now,
                trialActivatedDate: now,
                subscriptionStatus: 'trial',
                isTrialUsed: true,
                deviceInfo: deviceInfo || {},
                lastSeenIP: clientIP,
                installationAttempts: 1
            });

            console.log(`New user created with device fingerprint: ${deviceFingerprint.substring(0, 16)}... and userId: ${userId}`);
        } else {
            // Update existing user
            user.lastActiveDate = now;
            user.lastSeenIP = clientIP;
            
            // Update device info if provided
            if (deviceInfo) {
                user.deviceInfo = { ...user.deviceInfo, ...deviceInfo };
            }

            // Store security fingerprint data
            if (securityFingerprint) {
                user.securityFingerprint = securityFingerprint;
                user.securityRiskLevel = securityChecks.riskLevel;
            }

            // If userId doesn't match but device does, update the userId (this is a re-install)
            if (user.userId !== userId) {
                console.log(`Updating userId for existing device ${deviceFingerprint.substring(0, 16)}... from ${user.userId} to ${userId}`);
                user.userId = userId;
                user.installationAttempts += 1;
            }
            
            console.log(`Existing user updated with device fingerprint: ${deviceFingerprint.substring(0, 16)}...`);
        }

        // Generate verification token
        const verificationToken = user.generateVerificationToken();

        await user.save();

        // Determine response based on user status
        const response = {
            success: true,
            data: {
                userId: user.userId,
                deviceFingerprint: user.deviceFingerprint,
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                isSubscriptionActive: user.isSubscriptionActive,
                canUseExtension: user.isSubscriptionActive && user.subscriptionStatus !== 'blocked',
                verificationToken: verificationToken,
                isNewDevice: isNewDevice,
                settings: user.settings
            }
        };

        // Add warning messages for trial users
        if (user.subscriptionStatus === 'trial') {
            if (user.trialDaysRemaining <= 3) {
                response.data.warning = `Trial expires in ${user.trialDaysRemaining} days. Subscribe to continue using AutoScroll.`;
            }
            
            if (user.trialBypassAttempts > 0) {
                response.data.warning = 'Trial bypass attempts detected. Subscribe to avoid service interruption.';
            }
        }

        // Block if subscription is not active
        if (!response.data.canUseExtension) {
            response.data.action = user.subscriptionStatus === 'blocked' ? 'blocked' : 'show_subscription';
            response.data.message = user.subscriptionStatus === 'blocked' 
                ? 'Account blocked due to trial abuse. Contact support.'
                : 'Trial expired or subscription inactive. Subscribe to continue.';
        }

        res.json(response);

    } catch (error) {
        console.error('Device verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying device',
            action: 'retry',
            error: error.message
        });
    }
});

/**
 * Verify extension functionality before allowing feature use
 * This should be called before each major feature operation
 */
router.post('/verify-feature-access', async (req, res) => {
    try {
        const { 
            userId, 
            deviceFingerprint, 
            verificationToken,
            feature = 'autoscroll'
        } = req.body;

        if (!deviceFingerprint || !verificationToken) {
            return res.status(400).json({
                success: false,
                message: 'Missing required verification parameters',
                canUseFeature: false,
                action: 'reverify'
            });
        }

        // Ensure userId is provided - this shouldn't happen if device verification worked properly
        if (!userId) {
            console.warn('Feature access check: userId missing, requiring reverification');
            return res.status(400).json({
                success: false,
                message: 'User ID missing - please reverify device',
                canUseFeature: false,
                action: 'reverify'
            });
        }

        const user = await User.findOne({ userId, deviceFingerprint });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
                canUseFeature: false,
                action: 'reverify'
            });
        }

        // Verify token
        if (!user.isVerificationTokenValid(verificationToken)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired verification token',
                canUseFeature: false,
                action: 'reverify'
            });
        }

        // Check subscription status
        if (user.subscriptionStatus === 'blocked') {
            return res.status(403).json({
                success: false,
                message: 'Account blocked',
                canUseFeature: false,
                action: 'blocked'
            });
        }

        // Check if subscription is active
        if (!user.isSubscriptionActive) {
            return res.status(403).json({
                success: false,
                message: 'Subscription inactive or trial expired',
                canUseFeature: false,
                action: 'show_subscription',
                trialDaysRemaining: user.trialDaysRemaining
            });
        }

        // Update last active
        user.lastActiveDate = new Date();
        await user.save();

        res.json({
            success: true,
            canUseFeature: true,
            data: {
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                isSubscriptionActive: user.isSubscriptionActive
            }
        });

    } catch (error) {
        console.error('Feature access verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Error verifying feature access',
            canUseFeature: false,
            action: 'retry'
        });
    }
});

/**
 * Log feature usage (like scroll events)
 */
router.post('/log-usage', async (req, res) => {
    try {
        const { 
            userId, 
            deviceFingerprint, 
            verificationToken,
            feature = 'autoscroll',
            platform = 'youtube',
            metadata = {}
        } = req.body;

        // Ensure required parameters are present
        if (!userId || !deviceFingerprint || !verificationToken) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters for usage logging'
            });
        }

        const user = await User.findOne({ userId, deviceFingerprint });

        if (!user || !user.isVerificationTokenValid(verificationToken)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid verification'
            });
        }

        // Just update last active time - no counting needed
        user.lastActiveDate = new Date();
        await user.save();

        res.json({
            success: true,
            data: {
                message: 'Usage logged successfully'
            }
        });

    } catch (error) {
        console.error('Usage logging error:', error);
        res.status(500).json({
            success: false,
            message: 'Error logging usage'
        });
    }
});

/**
 * Check if client is rate limited
 */
function isRateLimited(key) {
    const now = Date.now();
    const attempts = trialVerificationAttempts.get(key) || [];
    
    // Remove attempts older than 5 minutes
    const recentAttempts = attempts.filter(time => now - time < 5 * 60 * 1000);
    
    // Allow max 5 attempts per 5 minutes
    if (recentAttempts.length >= 5) {
        return true;
    }
    
    // Add current attempt
    recentAttempts.push(now);
    trialVerificationAttempts.set(key, recentAttempts);
    
    return false;
}

/**
 * Get device trial status (admin endpoint)
 */
router.get('/device-status/:deviceFingerprint', async (req, res) => {
    try {
        const { deviceFingerprint } = req.params;
        
        const users = await User.find({ deviceFingerprint }).sort({ createdAt: -1 });
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Device not found'
            });
        }

        res.json({
            success: true,
            data: {
                deviceFingerprint: deviceFingerprint.substring(0, 16) + '...',
                userCount: users.length,
                isTrialUsed: users.some(u => u.isTrialUsed),
                totalBypassAttempts: users.reduce((sum, u) => sum + u.trialBypassAttempts, 0),
                users: users.map(u => ({
                    userId: u.userId,
                    subscriptionStatus: u.subscriptionStatus,
                    trialDaysRemaining: u.trialDaysRemaining,
                    createdAt: u.createdAt,
                    lastActiveDate: u.lastActiveDate,
                    installationAttempts: u.installationAttempts,
                    trialBypassAttempts: u.trialBypassAttempts
                }))
            }
        });

    } catch (error) {
        console.error('Device status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching device status'
        });
    }
});

// Clean up rate limiting map periodically
setInterval(() => {
    const now = Date.now();
    const cutoff = 5 * 60 * 1000; // 5 minutes
    
    for (const [key, attempts] of trialVerificationAttempts.entries()) {
        const recentAttempts = attempts.filter(time => now - time < cutoff);
        if (recentAttempts.length === 0) {
            trialVerificationAttempts.delete(key);
        } else {
            trialVerificationAttempts.set(key, recentAttempts);
        }
    }
}, 5 * 60 * 1000); // Clean every 5 minutes

/**
 * Perform advanced security checks
 */
async function performSecurityChecks(data) {
    const checks = {
        riskLevel: 'low',
        reasons: [],
        shouldBlock: false
    };

    try {
        // Check user agent consistency
        if (data.userAgent) {
            const suspiciousUA = checkSuspiciousUserAgent(data.userAgent);
            if (suspiciousUA) {
                checks.reasons.push('suspicious_user_agent');
                checks.riskLevel = 'medium';
            }
        }

        // Check for automation patterns
        if (data.sessionValidation) {
            if (!data.sessionValidation.isLegitimate) {
                checks.reasons.push('automation_detected');
                checks.riskLevel = 'high';
                
                if (data.sessionValidation.score === 0) {
                    checks.shouldBlock = true;
                }
            }
        }

        // Check security fingerprint for known patterns
        if (data.securityFingerprint) {
            const fingerprintRisk = analyzeFingerprintRisk(data.securityFingerprint);
            if (fingerprintRisk.isRisky) {
                checks.reasons.push(...fingerprintRisk.reasons);
                if (fingerprintRisk.level === 'high') {
                    checks.riskLevel = 'high';
                }
            }
        }

        // Check IP-based patterns
        const ipRisk = await checkIPRisk(data.clientIP);
        if (ipRisk.isRisky) {
            checks.reasons.push('suspicious_ip');
            checks.riskLevel = ipRisk.level;
        }

        // Check for rapid successive attempts
        const rapidAttempts = checkRapidAttempts(data.deviceFingerprint);
        if (rapidAttempts) {
            checks.reasons.push('rapid_attempts');
            checks.riskLevel = 'medium';
        }

    } catch (error) {
        console.error('Security check error:', error);
        checks.reasons.push('security_check_failed');
    }

    return checks;
}

/**
 * Check for suspicious user agent patterns
 */
function checkSuspiciousUserAgent(userAgent) {
    const suspiciousPatterns = [
        /headless/i,
        /phantom/i,
        /selenium/i,
        /webdriver/i,
        /bot/i,
        /crawler/i,
        /spider/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Analyze fingerprint for risky patterns
 */
function analyzeFingerprintRisk(securityFingerprint) {
    const risk = {
        isRisky: false,
        level: 'low',
        reasons: []
    };

    try {
        // Check for missing or suspicious behavioral data
        if (securityFingerprint.behavioral === 'fallback_' || 
            securityFingerprint.behavioral.includes('error')) {
            risk.isRisky = true;
            risk.reasons.push('behavioral_fingerprint_suspicious');
        }

        // Check for network anomalies
        if (securityFingerprint.network && securityFingerprint.network.includes('vpn')) {
            risk.isRisky = true;
            risk.level = 'medium';
            risk.reasons.push('vpn_detected');
        }

        // Check installation integrity
        if (securityFingerprint.installation && 
            securityFingerprint.installation.includes('error')) {
            risk.isRisky = true;
            risk.level = 'high';
            risk.reasons.push('installation_integrity_failed');
        }

    } catch (error) {
        risk.isRisky = true;
        risk.level = 'medium';
        risk.reasons.push('fingerprint_analysis_failed');
    }

    return risk;
}

/**
 * Check IP-based risk factors
 */
async function checkIPRisk(clientIP) {
    const risk = {
        isRisky: false,
        level: 'low'
    };

    try {
        // Check for localhost/development environment
        if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP.startsWith('192.168.')) {
            return risk; // Allow development IPs
        }

        // In production, you could integrate with IP reputation services
        // For now, just check for common VPN/proxy IP ranges
        const suspiciousRanges = [
            /^10\./, // Private network (might indicate VPN)
            /^172\.(1[6-9]|2\d|3[01])\./, // Private network
            // Add more suspicious IP patterns as needed
        ];

        if (suspiciousRanges.some(pattern => pattern.test(clientIP))) {
            risk.isRisky = true;
            risk.level = 'medium';
        }

    } catch (error) {
        console.error('IP risk check error:', error);
    }

    return risk;
}

/**
 * Check for rapid successive attempts from same device
 */
function checkRapidAttempts(deviceFingerprint) {
    const now = Date.now();
    const key = `rapid_${deviceFingerprint}`;
    
    const attempts = trialVerificationAttempts.get(key) || [];
    const recentAttempts = attempts.filter(time => now - time < 60 * 1000); // Last minute
    
    // More than 3 attempts in 1 minute is suspicious
    return recentAttempts.length > 3;
}

module.exports = router;
