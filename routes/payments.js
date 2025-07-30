const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const Payment = require('../models/Payment');

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create payment order
router.post('/create-order', async (req, res) => {
    try {
        const { userId, amount = 9, currency = 'INR' } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Log Razorpay configuration for debugging
        console.log('Creating Razorpay order with config:', {
            key_id: process.env.RAZORPAY_KEY_ID ? '***' + process.env.RAZORPAY_KEY_ID.slice(-4) : 'Not set',
            key_secret: process.env.RAZORPAY_KEY_SECRET ? '***' + process.env.RAZORPAY_KEY_SECRET.slice(-4) : 'Not set'
        });

        // Create Razorpay order
        const options = {
            amount: amount * 100, // Convert to paise
            currency: currency,
            receipt: `autoscroll_${userId}_${Date.now()}`
        };

        console.log('Razorpay order options:', options);
        const order = await razorpay.orders.create(options);
        console.log('Razorpay order created:', order);

        // Save order details
        const payment = new Payment({
            userId,
            transactionId: order.receipt,
            razorpayOrderId: order.id,
            amount,
            currency,
            status: 'pending',
            metadata: {
                userAgent: req.headers['user-agent'],
                ipAddress: req.ip
            }
        });

        await payment.save();

        res.json({
            success: true,
            data: {
                orderId: order.id,
                amount: order.amount,
                currency: order.currency,
                key: process.env.RAZORPAY_KEY_ID
            }
        });
    } catch (error) {
        console.error('Payment order creation error:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        res.status(500).json({
            success: false,
            message: 'Error creating payment order',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Verify payment
router.post('/verify-payment', async (req, res) => {
    try {
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            userId,
            transactionId 
        } = req.body;

        if (razorpay_payment_id && razorpay_signature) {
            // Verify Razorpay signature
            const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
            hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
            const generated_signature = hmac.digest('hex');

            if (generated_signature !== razorpay_signature) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid payment signature'
                });
            }

            // Update payment status
            const payment = await Payment.findOne({ 
                razorpayOrderId: razorpay_order_id 
            });

            if (payment) {
                payment.status = 'completed';
                payment.razorpayPaymentId = razorpay_payment_id;
                payment.validatedAt = new Date();
                await payment.save();

                // Update user subscription
                await activateSubscription(payment.userId);

                return res.json({
                    success: true,
                    message: 'Payment verified successfully'
                });
            }
        }

        // Manual verification with transaction ID
        if (transactionId && userId) {
            // In a real implementation, you would verify with payment gateway
            // For now, we'll accept any transaction ID (for demo purposes)
            
            const payment = new Payment({
                userId,
                transactionId,
                amount: 9,
                status: 'completed',
                validatedAt: new Date(),
                metadata: {
                    userAgent: req.headers['user-agent'],
                    ipAddress: req.ip,
                    platform: 'manual_verification'
                }
            });

            await payment.save();
            await activateSubscription(userId);

            return res.json({
                success: true,
                message: 'Payment verified successfully'
            });
        }

        res.status(400).json({
            success: false,
            message: 'Invalid payment verification data'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error verifying payment',
            error: error.message
        });
    }
});

// Activate subscription
async function activateSubscription(userId) {
    const user = await User.findOne({ userId });
    
    if (user) {
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month subscription

        user.subscriptionStatus = 'active';
        user.subscriptionExpiry = expiryDate;
        user.lastPaymentDate = new Date();
        
        await user.save();
    }
}

// Get payment history
router.get('/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const payments = await Payment.find({ userId })
            .sort({ createdAt: -1 })
            .limit(10);

        res.json({
            success: true,
            data: payments
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching payment history',
            error: error.message
        });
    }
});

module.exports = router;
