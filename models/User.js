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

    // Trial & Subscription
    subscriptionStatus: {
        type: String,
        enum: ['trial', 'active', 'expired', 'cancelled', 'blocked'],
        default: 'trial'
    },
    trialDaysRemaining: {
        type: Number,
        default: 10
    },
    trialStartDate: {
        type: Date,
        default: Date.now
    },
    trialEndDate: {
        type: Date
    },
    isTrialActive: {
        type: Boolean,
        default: true
    },
    
    // Subscription Management
    subscriptionStartDate: {
        type: Date
    },
    subscriptionExpiry: {
        type: Date
    },
    lastPaymentDate: {
        type: Date
    },
    autoPayEnabled: {
        type: Boolean,
        default: false
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

    // Payment Related
    razorpayCustomerId: {
        type: String
    },
    razorpaySubscriptionId: {
        type: String
    },
    razorpaySubscriptionLinkId: {
        type: String
    },
    subscriptionLinkCreatedAt: {
        type: Date
    },
    upiMandateId: {
        type: String
    },
    paymentHistory: [{
        paymentId: String,
        amount: Number,
        currency: String,
        status: String,
        date: Date,
        method: String
    }],

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
userSchema.index({ subscriptionStatus: 1 });
userSchema.index({ trialEndDate: 1 });
userSchema.index({ subscriptionExpiry: 1 });

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Virtual for checking if subscription is active
userSchema.virtual('isSubscriptionActive').get(function() {
    if (this.subscriptionStatus === 'active' && this.subscriptionExpiry) {
        return new Date() < this.subscriptionExpiry;
    }
    
    if (this.subscriptionStatus === 'trial' && this.trialDaysRemaining > 0) {
        return true;
    }
    
    return false;
});

// Virtual for checking if user can use extension
userSchema.virtual('canUseExtension').get(function() {
    // Blocked users cannot use extension
    if (this.subscriptionStatus === 'blocked') {
        return false;
    }
    
    // Active subscription
    if (this.subscriptionStatus === 'active' && this.subscriptionExpiry) {
        return new Date() < this.subscriptionExpiry;
    }
    
    // Active trial
    if (this.subscriptionStatus === 'trial') {
        return this.trialDaysRemaining > 0;
    }
    
    return false;
});

// Virtual for days until subscription expires
userSchema.virtual('daysUntilExpiry').get(function() {
    let expiryDate;
    
    if (this.subscriptionStatus === 'trial' && this.trialEndDate) {
        expiryDate = this.trialEndDate;
    } else if (this.subscriptionStatus === 'active' && this.subscriptionExpiry) {
        expiryDate = this.subscriptionExpiry;
    } else {
        return 0;
    }
    
    const now = new Date();
    const diffTime = expiryDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(0, diffDays);
});

// Instance Methods

/**
 * Generate authentication token
 */
userSchema.methods.generateAuthToken = function() {
    const token = Math.random().toString(36).substr(2, 15) + Date.now().toString(36);
    this.authToken = token;
    this.authTokenExpiry = new Date(Date.now() + (24 * 60 * 60 * 1000)); // 24 hours
    return token;
};

/**
 * Verify authentication token
 */
userSchema.methods.verifyAuthToken = function(token) {
    if (!this.authToken || this.authToken !== token) {
        return false;
    }
    
    if (!this.authTokenExpiry || new Date() > this.authTokenExpiry) {
        return false;
    }
    
    return true;
};

/**
 * Start premium subscription
 */
userSchema.methods.activateSubscription = function(durationMonths = 1) {
    this.subscriptionStatus = 'active';
    this.subscriptionStartDate = new Date();
    this.subscriptionExpiry = new Date(Date.now() + (durationMonths * 30 * 24 * 60 * 60 * 1000));
    this.lastPaymentDate = new Date();
    this.isTrialActive = false;
    
    console.log(`User ${this.email} subscription activated until ${this.subscriptionExpiry}`);
};

/**
 * Cancel subscription
 */
userSchema.methods.cancelSubscription = function() {
    this.subscriptionStatus = 'cancelled';
    this.autoPayEnabled = false;
    
    console.log(`User ${this.email} subscription cancelled`);
};

/**
 * Update trial days remaining
 */
userSchema.methods.updateTrialDays = function() {
    if (this.subscriptionStatus !== 'trial' || !this.trialEndDate) {
        this.trialDaysRemaining = 0;
        return;
    }
    
    const now = new Date();
    const diffTime = this.trialEndDate - now;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    this.trialDaysRemaining = Math.max(0, diffDays);
    
    // Mark trial as inactive if expired
    if (this.trialDaysRemaining <= 0) {
        this.isTrialActive = false;
        this.subscriptionStatus = 'expired';
    }
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
 * Add payment to history
 */
userSchema.methods.addPayment = function(paymentData) {
    this.paymentHistory.push({
        paymentId: paymentData.paymentId,
        amount: paymentData.amount,
        currency: paymentData.currency || 'INR',
        status: paymentData.status,
        date: new Date(),
        method: paymentData.method || 'upi'
    });
    
    if (paymentData.status === 'paid' || paymentData.status === 'success') {
        this.lastPaymentDate = new Date();
    }
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
 * Get users with expiring trials (for notifications)
 */
userSchema.statics.getExpiringTrials = function(daysThreshold = 3) {
    const thresholdDate = new Date(Date.now() + (daysThreshold * 24 * 60 * 60 * 1000));
    
    return this.find({
        subscriptionStatus: 'trial',
        trialEndDate: { $lt: thresholdDate },
        trialDaysRemaining: { $gt: 0 }
    });
};

/**
 * Get expired users
 */
userSchema.statics.getExpiredUsers = function() {
    return this.find({
        $or: [
            { 
                subscriptionStatus: 'trial',
                trialDaysRemaining: { $lte: 0 }
            },
            {
                subscriptionStatus: 'active',
                subscriptionExpiry: { $lt: new Date() }
            }
        ]
    });
};

/**
 * Get subscription statistics
 */
userSchema.statics.getSubscriptionStats = async function() {
    const stats = await this.aggregate([
        {
            $group: {
                _id: '$subscriptionStatus',
                count: { $sum: 1 },
                avgTrialDays: { $avg: '$trialDaysRemaining' }
            }
        }
    ]);
    
    const totalUsers = await this.countDocuments();
    
    return {
        totalUsers,
        statusBreakdown: stats,
        timestamp: new Date()
    };
};

module.exports = mongoose.model('User', userSchema);
