const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    // Google Authentication Data
    googleId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        // Not required since we don't collect it during Google auth
        validate: {
            validator: function(v) {
                // If phone number is provided, validate it
                if (v) {
                    return /^\+?[1-9]\d{1,14}$/.test(v);
                }
                return true;
            },
            message: 'Invalid phone number format'
        }
    },
    picture: {
        type: String // Google profile picture URL
    },
    verified_email: {
        type: Boolean,
        default: false
    },

    // Authentication & Security
    authToken: {
        type: String
    },
    authTokenExpiry: {
        type: Date
    },
    lastLoginDate: {
        type: Date,
        default: Date.now
    },
    lastActiveDate: {
        type: Date,
        default: Date.now
    },
    loginCount: {
        type: Number,
        default: 0
    },

    // User Settings
    settings: {
        autoScrollEnabled: {
            type: Boolean,
            default: false
        },
        platform: {
            type: String,
            default: 'youtube'
        },
        notifications: {
            type: Boolean,
            default: true
        },
        autoScrollSpeed: {
            type: String,
            enum: ['slow', 'normal', 'fast'],
            default: 'normal'
        }
    },

    // Extension Data
    extensionVersion: {
        type: String
    },
    usageStats: {
        totalScrolls: {
            type: Number,
            default: 0
        },
        lastUsedDate: {
            type: Date
        },
        averageDaily: {
            type: Number,
            default: 0
        }
    },

    // Subscription Management
    subscription: {
        // Trial Information
        trial: {
            isActive: {
                type: Boolean,
                default: true
            },
            startDate: {
                type: Date,
                default: Date.now
            },
            endDate: {
                type: Date,
                default: function() {
                    const trialEnd = new Date();
                    trialEnd.setDate(trialEnd.getDate() + 10); // 10-day trial
                    return trialEnd;
                }
            },
            usedFeatures: [{
                feature: String,
                usedAt: { type: Date, default: Date.now }
            }]
        },
        
        // Razorpay Subscription Details
        razorpay: {
            subscriptionId: {
                type: String,
                index: true
            },
            planId: {
                type: String
            },
            customerId: {
                type: String
            },
            status: {
                type: String,
                enum: ['trial', 'active', 'past_due', 'cancelled', 'expired', 'created', 'authenticated', 'pending'],
                default: 'trial'
            },
            currentPeriodStart: {
                type: Date
            },
            currentPeriodEnd: {
                type: Date
            },
            nextBilling: {
                type: Date
            },
            cancelAtCycleEnd: {
                type: Boolean,
                default: false
            },
            cancelledAt: {
                type: Date
            },
            // Store subscription payment link for resume functionality
            subscriptionLink: {
                type: String
            },
            subscriptionLinkCreatedAt: {
                type: Date
            },
            paymentHistory: [{
                paymentId: String,
                amount: Number,
                currency: String,
                status: String,
                paidAt: Date,
                failureReason: String
            }]
        },
        
        // Access Control
        features: {
            autoScroll: {
                type: Boolean,
                default: true
            },
            analytics: {
                type: Boolean,
                default: true
            },
            customSettings: {
                type: Boolean,
                default: false
            },
            prioritySupport: {
                type: Boolean,
                default: false
            }
        },
        
        // Usage Tracking
        usage: {
            lastAccessedAt: {
                type: Date,
                default: Date.now
            },
            totalAutoScrolls: {
                type: Number,
                default: 0
            },
            dailyUsage: [{
                date: { type: Date, default: Date.now },
                scrollCount: { type: Number, default: 0 }
            }]
        }
    },

    // Metadata
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Indexes for performance
userSchema.index({ googleId: 1 });
userSchema.index({ email: 1 });

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Virtual for checking if user can use extension
userSchema.virtual('canUseExtension').get(function() {
    // All authenticated users can use the extension
    return true;
});

// Instance Methods

/**
 * Generate authentication token with 10-day expiry
 */
userSchema.methods.generateAuthToken = function() {
    const token = Math.random().toString(36).substr(2, 15) + Date.now().toString(36);
    this.authToken = token;
    // Set 10-day expiry as requested by user
    this.authTokenExpiry = new Date(Date.now() + (10 * 24 * 60 * 60 * 1000)); // 10 days
    console.log(`Auth token generated for ${this.email}: expires ${this.authTokenExpiry}`);
    return token;
};

/**
 * Verify authentication token with auto-refresh capability
 */
userSchema.methods.verifyAuthToken = function(token) {
    if (!this.authToken || this.authToken !== token) {
        console.log(`Token verification failed for ${this.email}: token mismatch`);
        return false;
    }
    
    const now = new Date();
    if (!this.authTokenExpiry || now > this.authTokenExpiry) {
        console.log(`Token verification failed for ${this.email}: token expired at ${this.authTokenExpiry}`);
        return false;
    }
    
    // Auto-refresh token if it expires within 2 days
    const timeUntilExpiry = this.authTokenExpiry - now;
    const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
    
    if (timeUntilExpiry < twoDaysInMs) {
        console.log(`Auto-refreshing token for ${this.email} (expires in ${Math.round(timeUntilExpiry / (1000 * 60 * 60))} hours)`);
        // Extend token by 10 days from now
        this.authTokenExpiry = new Date(Date.now() + (10 * 24 * 60 * 60 * 1000));
        // Note: Caller should save the user after this call
    }
    
    return true;
};

/**
 * Refresh authentication token to extend session
 */
userSchema.methods.refreshAuthToken = function() {
    if (!this.authToken) {
        console.log(`Cannot refresh token for ${this.email}: no existing token`);
        return null;
    }
    
    // Extend current token expiry by 10 days from now
    this.authTokenExpiry = new Date(Date.now() + (10 * 24 * 60 * 60 * 1000));
    this.lastActiveDate = new Date();
    
    console.log(`Token refreshed for ${this.email}: new expiry ${this.authTokenExpiry}`);
    return this.authToken;
};

/**
 * Check if token needs refresh (expires within 2 days)
 */
userSchema.methods.needsTokenRefresh = function() {
    if (!this.authTokenExpiry) return true;
    
    const timeUntilExpiry = this.authTokenExpiry - new Date();
    const twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
    
    return timeUntilExpiry < twoDaysInMs;
};

/**
 * Record usage activity
 */
userSchema.methods.recordUsage = function() {
    this.lastActiveDate = new Date();
    this.usageStats.lastUsedDate = new Date();
    this.usageStats.totalScrolls = (this.usageStats.totalScrolls || 0) + 1;
    
    // Calculate average daily usage (simplified)
    const daysSinceCreation = Math.max(1, Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)));
    this.usageStats.averageDaily = this.usageStats.totalScrolls / daysSinceCreation;
};

/**
 * Start free trial for new user
 */
userSchema.methods.startFreeTrial = function() {
    this.subscription.trial.isActive = true;
    this.subscription.trial.startDate = new Date();
    this.subscription.trial.endDate = new Date(Date.now() + (10 * 24 * 60 * 60 * 1000)); // 10 days
    this.subscription.razorpay.status = 'trial';
    
    console.log(`✅ Free trial started for user ${this.email} until ${this.subscription.trial.endDate}`);
};

/**
 * Check if user has active access (trial or subscription)
 * Enhanced with subscription processing state awareness
 */
userSchema.methods.hasActiveAccess = function() {
    const now = new Date();
    
    // Check subscription access first
    if (this.subscription.razorpay.status === 'active' && 
        this.subscription.razorpay.currentPeriodEnd && 
        now <= this.subscription.razorpay.currentPeriodEnd) {
        return {
            hasAccess: true,
            type: 'subscription',
            daysRemaining: Math.ceil((this.subscription.razorpay.currentPeriodEnd - now) / (1000 * 60 * 60 * 24)),
            expiryDate: this.subscription.razorpay.currentPeriodEnd,
            planId: this.subscription.razorpay.planId
        };
    }
    
    // Check if subscription is in processing state (created, authenticated)
    const isSubscriptionProcessing = this.subscription.razorpay.subscriptionId && 
        (this.subscription.razorpay.status === 'created' || this.subscription.razorpay.status === 'authenticated');
    
    // Check trial access
    if (this.subscription.trial.isActive && now <= this.subscription.trial.endDate) {
        return {
            hasAccess: true,
            type: 'trial',
            daysRemaining: Math.ceil((this.subscription.trial.endDate - now) / (1000 * 60 * 60 * 24)),
            expiryDate: this.subscription.trial.endDate,
            isSubscriptionProcessing: isSubscriptionProcessing
        };
    }
    
    // Special case: Trial expired but subscription is processing - allow limited access
    if (isSubscriptionProcessing) {
        // Check if subscription was created recently (within last 24 hours)
        const subscriptionAge = this.subscription.razorpay.currentPeriodStart 
            ? now - new Date(this.subscription.razorpay.currentPeriodStart)
            : null;
        
        if (!subscriptionAge || subscriptionAge < 24 * 60 * 60 * 1000) {
            return {
                hasAccess: true,
                type: 'subscription_processing',
                daysRemaining: 1, // Grace period
                expiryDate: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours grace
                isSubscriptionProcessing: true,
                processingState: this.subscription.razorpay.status
            };
        }
    }
    
    return {
        hasAccess: false,
        type: 'expired',
        daysRemaining: 0,
        isSubscriptionProcessing: isSubscriptionProcessing
    };
};

/**
 * Update subscription status from Razorpay webhook
 */
userSchema.methods.updateSubscriptionStatus = function(subscriptionData) {
    this.subscription.razorpay.subscriptionId = subscriptionData.id;
    this.subscription.razorpay.status = subscriptionData.status;
    this.subscription.razorpay.planId = subscriptionData.plan_id;
    this.subscription.razorpay.currentPeriodStart = new Date(subscriptionData.current_start * 1000);
    this.subscription.razorpay.currentPeriodEnd = new Date(subscriptionData.current_end * 1000);
    
    if (subscriptionData.status === 'active') {
        // Deactivate trial when subscription becomes active
        this.subscription.trial.isActive = false;
        
        // Enable premium features
        this.subscription.features.customSettings = true;
        this.subscription.features.prioritySupport = true;
    }
    
    console.log(`✅ Subscription updated for user ${this.email}: ${subscriptionData.status}`);
};

/**
 * Record AutoScroll usage
 */
userSchema.methods.recordAutoScrollUsage = function() {
    this.subscription.usage.lastAccessedAt = new Date();
    this.subscription.usage.totalAutoScrolls += 1;
    
    // Update daily usage
    const today = new Date().toDateString();
    const todayUsage = this.subscription.usage.dailyUsage.find(
        usage => usage.date.toDateString() === today
    );
    
    if (todayUsage) {
        todayUsage.scrollCount += 1;
    } else {
        this.subscription.usage.dailyUsage.push({
            date: new Date(),
            scrollCount: 1
        });
        
        // Keep only last 30 days of usage data
        if (this.subscription.usage.dailyUsage.length > 30) {
            this.subscription.usage.dailyUsage = this.subscription.usage.dailyUsage.slice(-30);
        }
    }
};

/**
 * Get subscription summary for UI
 */
userSchema.methods.getSubscriptionSummary = function() {
    const access = this.hasActiveAccess();
    
    return {
        hasAccess: access.hasAccess,
        accessType: access.type,
        daysRemaining: access.daysRemaining,
        expiryDate: access.expiryDate,
        trialUsed: !this.subscription.trial.isActive || new Date() > this.subscription.trial.endDate,
        subscriptionStatus: this.subscription.razorpay.status,
        planId: this.subscription.razorpay.planId,
        features: this.subscription.features,
        totalUsage: this.subscription.usage.totalAutoScrolls,
        canUpgrade: access.type === 'trial' || !access.hasAccess,
        canCancel: this.subscription.razorpay.status === 'active' && !this.subscription.razorpay.cancelAtCycleEnd,
        // Add pending payment link info
        hasPendingPayment: this.hasPendingPaymentLink(),
        pendingPaymentLink: this.getPendingPaymentLink(),
        // Add subscription management link info for active subscriptions
        hasManagementLink: this.hasSubscriptionManagementLink(),
        managementLink: this.getSubscriptionManagementLink()
    };
};

/**
 * Check if user has a pending payment link that can be resumed
 */
userSchema.methods.hasPendingPaymentLink = function() {
    // Only show pending payment if subscription is created/authenticated but not active
    const isPendingStatus = ['created', 'authenticated'].includes(this.subscription.razorpay.status);
    const hasSubscriptionLink = !!this.subscription.razorpay.subscriptionLink;
    
    // No expiration check - subscription links remain valid for payment method updates
    return isPendingStatus && hasSubscriptionLink;
};

/**
 * Get pending payment link if available
 */
userSchema.methods.getPendingPaymentLink = function() {
    if (this.hasPendingPaymentLink()) {
        return {
            link: this.subscription.razorpay.subscriptionLink,
            subscriptionId: this.subscription.razorpay.subscriptionId,
            planId: this.subscription.razorpay.planId,
            status: this.subscription.razorpay.status,
            createdAt: this.subscription.razorpay.subscriptionLinkCreatedAt
        };
    }
    return null;
};

/**
 * Check if user has a subscription management link (for active subscriptions)
 */
userSchema.methods.hasSubscriptionManagementLink = function() {
    const isActiveStatus = this.subscription.razorpay.status === 'active';
    const hasSubscriptionLink = !!this.subscription.razorpay.subscriptionLink;
    
    return isActiveStatus && hasSubscriptionLink;
};

/**
 * Get subscription management link for active subscriptions
 */
userSchema.methods.getSubscriptionManagementLink = function() {
    if (this.hasSubscriptionManagementLink()) {
        return {
            link: this.subscription.razorpay.subscriptionLink,
            subscriptionId: this.subscription.razorpay.subscriptionId,
            planId: this.subscription.razorpay.planId,
            status: this.subscription.razorpay.status,
            createdAt: this.subscription.razorpay.subscriptionLinkCreatedAt,
            purpose: 'payment_management' // Indicates this is for payment method updates
        };
    }
    return null;
};

// Static Methods

/**
 * Find user by Google ID
 */
userSchema.statics.findByGoogleId = function(googleId) {
    return this.findOne({ googleId });
};

/**
 * Find user by email
 */
userSchema.statics.findByEmail = function(email) {
    return this.findOne({ email: email.toLowerCase() });
};

/**
 * Get basic user statistics
 */
userSchema.statics.getUserStats = async function() {
    const totalUsers = await this.countDocuments();
    const activeUsers = await this.countDocuments({
        lastActiveDate: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Active in last 30 days
    });
    
    return {
        totalUsers,
        activeUsers,
        timestamp: new Date()
    };
};

module.exports = mongoose.model('User', userSchema);
