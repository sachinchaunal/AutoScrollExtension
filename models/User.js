const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    deviceFingerprint: {
        type: String,
        required: true,
        index: true
    },
    email: {
        type: String,
        sparse: true
    },
    trialStartDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    trialActivatedDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    subscriptionStatus: {
        type: String,
        enum: ['trial', 'active', 'expired', 'cancelled', 'blocked'],
        default: 'trial'
    },
    subscriptionExpiry: {
        type: Date
    },
    lastPaymentDate: {
        type: Date
    },
    hasAutoRenewal: {
        type: Boolean,
        default: false
    },
    upiMandateId: {
        type: String,
        sparse: true // Only for users with active mandates
    },

    payments: [{
        transactionId: String,
        amount: Number,
        currency: String,
        status: String,
        razorpayPaymentId: String,
        date: { type: Date, default: Date.now }
    }],
    settings: {
        autoScrollEnabled: { type: Boolean, default: false },
        preferredPlatform: { type: String, default: 'youtube' },
        scrollDelay: { type: Number, default: 2000 }
    },
    // Device and security tracking
    deviceInfo: {
        browser: String,
        os: String,
        screenResolution: String,
        timezone: String,
        language: String
    },
    // Enhanced security tracking
    securityFingerprint: {
        behavioral: String,
        network: String,
        installation: String,
        composite: String,
        timestamp: Date
    },
    securityRiskLevel: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low'
    },
    // Activity tracking
    lastActiveDate: {
        type: Date,
        default: Date.now
    },
    lastSeenIP: String,
    installationAttempts: {
        type: Number,
        default: 1
    },
    // Trial abuse prevention
    isTrialUsed: {
        type: Boolean,
        default: true
    },
    trialBypassAttempts: {
        type: Number,
        default: 0
    },
    // Backend verification
    lastVerificationDate: {
        type: Date,
        default: Date.now
    },
    verificationToken: String,

    // Security notes for admin tracking
    securityNotes: [{
        action: String,
        reason: String,
        timestamp: { type: Date, default: Date.now },
        adminId: String
    }]
}, {
    timestamps: true
});

// Calculate trial days remaining
userSchema.virtual('trialDaysRemaining').get(function() {
    if (this.subscriptionStatus !== 'trial') return 0;
    
    const now = new Date();
    const trialDuration = 10 * 24 * 60 * 60 * 1000; // 10 days
    const elapsed = now - this.trialActivatedDate;
    const remaining = trialDuration - elapsed;
    
    return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
});

// Check if subscription is active
userSchema.virtual('isSubscriptionActive').get(function() {
    if (this.subscriptionStatus === 'blocked') {
        return false;
    }
    
    if (this.subscriptionStatus === 'active') {
        return this.subscriptionExpiry ? this.subscriptionExpiry > new Date() : true;
    }
    
    if (this.subscriptionStatus === 'trial') {
        return this.trialDaysRemaining > 0;
    }
    
    return false;
});



userSchema.methods.generateVerificationToken = function() {
    const token = Math.random().toString(36).substr(2, 15) + Date.now().toString(36);
    this.verificationToken = token;
    this.lastVerificationDate = new Date();
    return token;
};

userSchema.methods.isVerificationTokenValid = function(token, maxAgeMinutes = 60) {
    if (!this.verificationToken || this.verificationToken !== token) {
        return false;
    }
    
    const tokenAge = Date.now() - this.lastVerificationDate.getTime();
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    return tokenAge <= maxAge;
};

// Static methods
userSchema.statics.findByDeviceFingerprint = function(deviceFingerprint) {
    return this.findOne({ deviceFingerprint });
};

userSchema.statics.checkTrialAbuse = function(deviceFingerprint) {
    return this.findOne({ 
        deviceFingerprint, 
        isTrialUsed: true 
    });
};

// Indexes for performance
userSchema.index({ userId: 1 });
userSchema.index({ deviceFingerprint: 1 });
userSchema.index({ subscriptionExpiry: 1 });
userSchema.index({ lastActiveDate: 1 });
userSchema.index({ verificationToken: 1 });
userSchema.index({ isTrialUsed: 1, deviceFingerprint: 1 });

module.exports = mongoose.model('User', userSchema);
