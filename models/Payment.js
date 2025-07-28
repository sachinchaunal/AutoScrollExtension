const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true
    },
    transactionId: {
        type: String,
        required: true,
        unique: true
    },
    razorpayPaymentId: {
        type: String,
        sparse: true
    },
    razorpayOrderId: {
        type: String,
        sparse: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'INR'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['upi', 'card', 'netbanking', 'wallet'],
        default: 'upi'
    },
    subscriptionType: {
        type: String,
        enum: ['monthly', 'yearly'],
        default: 'monthly'
    },
    validatedAt: {
        type: Date
    },
    refundedAt: {
        type: Date
    },
    metadata: {
        userAgent: String,
        ipAddress: String,
        platform: String
    }
}, {
    timestamps: true
});

paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ status: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
