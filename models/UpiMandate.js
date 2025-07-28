const mongoose = require('mongoose');

const upiMandateSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true
    },
    mandateId: {
        type: String,
        required: true,
        unique: true
    },
    upiId: {
        type: String,
        required: true
    },
    merchantVpa: {
        type: String,
        required: true,
        default: 'merchant@upi' // Replace with your actual UPI ID
    },
    amount: {
        type: Number,
        required: true,
        default: 9
    },
    currency: {
        type: String,
        default: 'INR'
    },
    frequency: {
        type: String,
        enum: ['MONTHLY', 'QUARTERLY', 'YEARLY'],
        default: 'MONTHLY'
    },
    startDate: {
        type: Date,
        required: true
    },
    endDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['PENDING', 'ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
        default: 'PENDING'
    },
    qrCodeData: {
        type: String,
        required: true
    },
    qrCodeImage: {
        type: String // Base64 encoded QR code image
    },
    // Razorpay specific fields
    razorpayMandateId: {
        type: String,
        index: true
    },
    razorpayPaymentLinkId: {
        type: String
    },
    razorpaySubscriptionId: {
        type: String
    },
    approvalReference: {
        type: String // Reference from UPI app when mandate is approved
    },
    lastChargedDate: {
        type: Date
    },
    nextChargeDate: {
        type: Date
    },
    chargeAttempts: [{
        date: Date,
        amount: Number,
        status: String,
        reference: String,
        razorpayPaymentId: String,
        failureReason: String
    }],
    metadata: {
        deviceFingerprint: String,
        userAgent: String,
        ipAddress: String,
        platform: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update the updatedAt field before saving
upiMandateSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Index for efficient queries
upiMandateSchema.index({ userId: 1, status: 1 });
upiMandateSchema.index({ mandateId: 1 });
upiMandateSchema.index({ nextChargeDate: 1, status: 1 });

module.exports = mongoose.model('UpiMandate', upiMandateSchema);
