const express = require('express');
const router = express.Router();
const User = require('../models/User');
const crypto = require('crypto');

// Rate limiting for trial verification
const trialVerificationAttempts = new Map();

/**
 * Health check endpoint for device verification service
 * Used by frontend to check backend connectivity
 */
router.get('/health', async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            status: 'OK',
            service: 'device-verification',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '2.0',
            features: [
                'enhanced-fingerprinting',
                'duplicate-prevention', 
                'hardware-id-tracking',
                'multi-layer-detection'
            ]
        });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            success: false,
            status: 'ERROR',
            service: 'device-verification',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Initialize or verify device and trial status
 * This is called when the extension starts up
 */
router.post('/verify-device', async (req, res) => {
    try {
        const { 
            deviceFingerprint, 
            hardwareId,
            installationId,
            userId, 
            deviceInfo,
            userAgent,
            extensionVersion,
            securityFingerprint,
            sessionValidation,
            isReinstall = false,
            fingerprintVersion = '1.0',
            context = 'unknown'
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

        console.log(`Device verification request: fingerprint=${deviceFingerprint.substring(0, 16)}..., userId=${userId}, isReinstall=${isReinstall}`);

        // ENHANCED DUPLICATE PREVENTION LOGIC with Hardware-Level Detection
        console.log(`Device verification request: fingerprint=${deviceFingerprint.substring(0, 16)}..., userId=${userId}, isReinstall=${isReinstall}, hardwareId=${hardwareId ? hardwareId.substring(0, 16) + '...' : 'none'}, context=${context}`);
        
        // Multi-layer device detection (most restrictive to least restrictive)
        let existingDeviceUser = null;
        
        // Layer 1: Hardware ID match (strongest indicator)
        if (hardwareId) {
            existingDeviceUser = await User.findOne({ 
                'deviceFingerprints.hardwareId': hardwareId 
            }).sort({ createdAt: -1 });
            
            if (existingDeviceUser) {
                console.log(`Found existing user by hardwareId: ${existingDeviceUser.userId}`);
            }
        }
        
        // Layer 2: Device fingerprint match (if no hardware match)
        if (!existingDeviceUser) {
            existingDeviceUser = await User.findOne({ 
                deviceFingerprint: deviceFingerprint 
            }).sort({ createdAt: -1 });
            
            if (existingDeviceUser) {
                console.log(`Found existing user by deviceFingerprint: ${existingDeviceUser.userId}`);
            }
        }
        
        // Layer 3: Check for similar fingerprints on same device (fallback)
        if (!existingDeviceUser && hardwareId) {
            existingDeviceUser = await User.findOne({
                $or: [
                    { 'deviceFingerprints.hardwareId': hardwareId },
                    { 'deviceFingerprints.installationId': installationId }
                ]
            }).sort({ createdAt: -1 });
            
            if (existingDeviceUser) {
                console.log(`Found existing user by alternative hardware match: ${existingDeviceUser.userId}`);
            }
        }

        if (existingDeviceUser) {
            console.log(`Found existing user for device ${deviceFingerprint.substring(0, 16)}...: ${existingDeviceUser.userId}`);
            
            // Case 1: Same userId - this is just a normal verification
            if (existingDeviceUser.userId === userId) {
                console.log('Same user verification - updating existing record');
                
                // Update existing user with enhanced fingerprinting
                existingDeviceUser.lastActiveDate = new Date();
                existingDeviceUser.lastSeenIP = clientIP;
                
                if (deviceInfo) {
                    existingDeviceUser.deviceInfo = { ...existingDeviceUser.deviceInfo, ...deviceInfo };
                }
                
                if (securityFingerprint) {
                    existingDeviceUser.securityFingerprint = securityFingerprint;
                    existingDeviceUser.securityRiskLevel = securityChecks.riskLevel;
                }
                
                // Update enhanced fingerprinting data
                if (!existingDeviceUser.deviceFingerprints) {
                    existingDeviceUser.deviceFingerprints = {};
                }
                
                existingDeviceUser.deviceFingerprints.main = deviceFingerprint;
                existingDeviceUser.deviceFingerprints.updatedAt = new Date();
                
                if (hardwareId) {
                    existingDeviceUser.deviceFingerprints.hardwareId = hardwareId;
                }
                
                if (installationId) {
                    existingDeviceUser.deviceFingerprints.installationId = installationId;
                }
                
                if (fingerprintVersion) {
                    existingDeviceUser.deviceFingerprints.fingerprintVersion = fingerprintVersion;
                }
                
                if (context) {
                    existingDeviceUser.deviceFingerprints.context = context;
                }
                
                // Update enhanced fingerprint metadata
                if (!existingDeviceUser.enhancedFingerprintData) {
                    existingDeviceUser.enhancedFingerprintData = {};
                }
                
                existingDeviceUser.enhancedFingerprintData.version = fingerprintVersion;
                existingDeviceUser.enhancedFingerprintData.context = context;
                existingDeviceUser.enhancedFingerprintData.hasHardwareId = !!hardwareId;
                existingDeviceUser.enhancedFingerprintData.hasInstallationId = !!installationId;
                existingDeviceUser.enhancedFingerprintData.timestamp = new Date();
                
                const verificationToken = existingDeviceUser.generateVerificationToken();
                await existingDeviceUser.save();
                
                return res.json({
                    success: true,
                    data: {
                        userId: existingDeviceUser.userId,
                        deviceFingerprint: existingDeviceUser.deviceFingerprint,
                        subscriptionStatus: existingDeviceUser.subscriptionStatus,
                        trialDaysRemaining: existingDeviceUser.trialDaysRemaining,
                        isSubscriptionActive: existingDeviceUser.isSubscriptionActive,
                        canUseExtension: existingDeviceUser.isSubscriptionActive && existingDeviceUser.subscriptionStatus !== 'blocked',
                        verificationToken: verificationToken,
                        isNewDevice: false,
                        isExistingUser: true,
                        settings: existingDeviceUser.settings
                    }
                });
            }
            
            // Case 2: Different userId but same device - this is a reinstall attempt
            if (existingDeviceUser.userId !== userId) {
                console.log(`Reinstall attempt detected: device=${deviceFingerprint.substring(0, 16)}..., old userId=${existingDeviceUser.userId}, new userId=${userId}`);
                
                // CRITICAL: Do not create new trial - update existing user with new userId
                existingDeviceUser.userId = userId; // Update to new userId
                existingDeviceUser.lastActiveDate = new Date();
                existingDeviceUser.lastSeenIP = clientIP;
                existingDeviceUser.installationAttempts = (existingDeviceUser.installationAttempts || 0) + 1;
                
                // Update device info if provided
                if (deviceInfo) {
                    existingDeviceUser.deviceInfo = { ...existingDeviceUser.deviceInfo, ...deviceInfo };
                }
                
                // Store security fingerprint data
                if (securityFingerprint) {
                    existingDeviceUser.securityFingerprint = securityFingerprint;
                    existingDeviceUser.securityRiskLevel = securityChecks.riskLevel;
                }
                
                // Update enhanced fingerprinting data for reinstall
                if (!existingDeviceUser.deviceFingerprints) {
                    existingDeviceUser.deviceFingerprints = {};
                }
                
                existingDeviceUser.deviceFingerprints.main = deviceFingerprint;
                existingDeviceUser.deviceFingerprints.updatedAt = new Date();
                
                if (hardwareId) {
                    existingDeviceUser.deviceFingerprints.hardwareId = hardwareId;
                }
                
                if (installationId) {
                    existingDeviceUser.deviceFingerprints.installationId = installationId;
                }
                
                existingDeviceUser.deviceFingerprints.fingerprintVersion = fingerprintVersion;
                existingDeviceUser.deviceFingerprints.context = context;
                
                // Update enhanced fingerprint metadata for reinstall tracking
                if (!existingDeviceUser.enhancedFingerprintData) {
                    existingDeviceUser.enhancedFingerprintData = {};
                }
                
                existingDeviceUser.enhancedFingerprintData.version = fingerprintVersion;
                existingDeviceUser.enhancedFingerprintData.context = context;
                existingDeviceUser.enhancedFingerprintData.hasHardwareId = !!hardwareId;
                existingDeviceUser.enhancedFingerprintData.hasInstallationId = !!installationId;
                existingDeviceUser.enhancedFingerprintData.timestamp = new Date();
                existingDeviceUser.enhancedFingerprintData.isReinstall = true;
                
                // Generate verification token
                const verificationToken = existingDeviceUser.generateVerificationToken();
                
                await existingDeviceUser.save();
                
                console.log(`Updated existing user: ${existingDeviceUser.userId}, status: ${existingDeviceUser.subscriptionStatus}, trial remaining: ${existingDeviceUser.trialDaysRemaining}`);
                
                const response = {
                    success: true,
                    data: {
                        userId: existingDeviceUser.userId,
                        deviceFingerprint: existingDeviceUser.deviceFingerprint,
                        subscriptionStatus: existingDeviceUser.subscriptionStatus,
                        trialDaysRemaining: existingDeviceUser.trialDaysRemaining,
                        isSubscriptionActive: existingDeviceUser.isSubscriptionActive,
                        canUseExtension: existingDeviceUser.isSubscriptionActive && existingDeviceUser.subscriptionStatus !== 'blocked',
                        verificationToken: verificationToken,
                        isNewDevice: false,
                        isReinstall: true,
                        installationAttempts: existingDeviceUser.installationAttempts,
                        settings: existingDeviceUser.settings
                    }
                };
                
                // Add appropriate warning based on status
                if (existingDeviceUser.subscriptionStatus === 'trial' && existingDeviceUser.trialDaysRemaining <= 0) {
                    response.data.warning = 'Your free trial has already been used on this device. Subscribe to continue using AutoScroll.';
                } else if (existingDeviceUser.subscriptionStatus === 'trial' && existingDeviceUser.trialDaysRemaining > 0) {
                    response.data.warning = `Welcome back! You have ${existingDeviceUser.trialDaysRemaining} days remaining in your trial.`;
                } else if (existingDeviceUser.subscriptionStatus === 'blocked') {
                    response.data.warning = 'This device has been blocked due to trial abuse. Contact support if you believe this is an error.';
                }
                
                return res.json(response);
            }
        }

        // ADDITIONAL CHECK: Look for existing user by userId
        const existingUserIdUser = await User.findOne({ userId: userId });
        if (existingUserIdUser && existingUserIdUser.deviceFingerprint !== deviceFingerprint) {
            console.log(`Found existing userId ${userId} with different device fingerprint. Updating device fingerprint.`);
            
            // Update the device fingerprint for this user
            existingUserIdUser.deviceFingerprint = deviceFingerprint;
            existingUserIdUser.lastActiveDate = new Date();
            existingUserIdUser.lastSeenIP = clientIP;
            
            if (deviceInfo) {
                existingUserIdUser.deviceInfo = { ...existingUserIdUser.deviceInfo, ...deviceInfo };
            }
            
            if (securityFingerprint) {
                existingUserIdUser.securityFingerprint = securityFingerprint;
                existingUserIdUser.securityRiskLevel = securityChecks.riskLevel;
            }
            
            const verificationToken = existingUserIdUser.generateVerificationToken();
            await existingUserIdUser.save();
            
            return res.json({
                success: true,
                data: {
                    userId: existingUserIdUser.userId,
                    deviceFingerprint: existingUserIdUser.deviceFingerprint,
                    subscriptionStatus: existingUserIdUser.subscriptionStatus,
                    trialDaysRemaining: existingUserIdUser.trialDaysRemaining,
                    isSubscriptionActive: existingUserIdUser.isSubscriptionActive,
                    canUseExtension: existingUserIdUser.isSubscriptionActive && existingUserIdUser.subscriptionStatus !== 'blocked',
                    verificationToken: verificationToken,
                    isNewDevice: false,
                    deviceUpdated: true,
                    settings: existingUserIdUser.settings
                }
            });
        }

        // Only create new user if no existing user found at all
        console.log(`Creating new user: userId=${userId}, deviceFingerprint=${deviceFingerprint.substring(0, 16)}...`);
        
        const now = new Date();
        const newUser = new User({
            userId: userId,
            deviceFingerprint: deviceFingerprint,
            trialStartDate: now,
            trialActivatedDate: now,
            subscriptionStatus: 'trial',
            isTrialUsed: true,
            deviceInfo: deviceInfo || {},
            lastSeenIP: clientIP,
            installationAttempts: 1,
            securityFingerprint: securityFingerprint,
            securityRiskLevel: securityChecks.riskLevel,
            // Enhanced fingerprinting data
            deviceFingerprints: {
                main: deviceFingerprint,
                hardwareId: hardwareId,
                installationId: installationId,
                fingerprintVersion: fingerprintVersion,
                context: context,
                createdAt: now
            },
            enhancedFingerprintData: {
                version: fingerprintVersion,
                context: context,
                hasHardwareId: !!hardwareId,
                hasInstallationId: !!installationId,
                timestamp: now
            }
        });

        // Generate verification token
        const verificationToken = newUser.generateVerificationToken();

        await newUser.save();

        console.log(`New user created successfully: ${newUser.userId}, trial days: ${newUser.trialDaysRemaining}`);

        const response = {
            success: true,
            data: {
                userId: newUser.userId,
                deviceFingerprint: newUser.deviceFingerprint,
                subscriptionStatus: newUser.subscriptionStatus,
                trialDaysRemaining: newUser.trialDaysRemaining,
                isSubscriptionActive: newUser.isSubscriptionActive,
                canUseExtension: newUser.isSubscriptionActive && newUser.subscriptionStatus !== 'blocked',
                verificationToken: verificationToken,
                isNewDevice: true,
                isNewUser: true,
                settings: newUser.settings
            }
        };

        // Add welcome message for new users
        if (newUser.trialDaysRemaining > 0) {
            response.data.warning = `Welcome! Your ${newUser.trialDaysRemaining}-day free trial has started.`;
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
