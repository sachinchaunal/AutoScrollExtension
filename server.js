const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
require('dotenv').config();

const connectDB = require('./config/database');
const { validateConfig } = require('./config/validateConfig');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const paymentRoutes = require('./routes/payments');
const subscriptionRoutes = require('./routes/subscriptions');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const cleanupRoutes = require('./routes/cleanup');
const upiMandateRoutes = require('./routes/upi-mandates');
const deviceVerificationRoutes = require('./routes/device-verification');

const app = express();

// Configuration from environment variables
const CONFIG = {
    port: process.env.PORT || 3000,
    host: process.env.HOST || 'localhost',
    nodeEnv: process.env.NODE_ENV || 'development',
    apiBaseUrl: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
    frontendUrl: process.env.FRONTEND_URL || 'chrome-extension://your-extension-id',
    allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [
        'chrome-extension://your-extension-id',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ],
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`
};

// Trust proxy for production deployment (Render, Heroku, etc.)
if (CONFIG.nodeEnv === 'production') {
    app.set('trust proxy', true);
}

// Validate configuration before starting
console.log('🔧 Starting AutoScroll Backend Server...\n');
console.log('📋 Server Configuration:');
console.log(`   Environment: ${CONFIG.nodeEnv}`);
console.log(`   Host: ${CONFIG.host}`);
console.log(`   Port: ${CONFIG.port}`);
console.log(`   API Base URL: ${CONFIG.apiBaseUrl}`);
console.log(`   Frontend URL: ${CONFIG.frontendUrl}`);
console.log(`   Webhook Base URL: ${CONFIG.webhookBaseUrl}`);
console.log(`   Allowed Origins: ${CONFIG.allowedOrigins.join(', ')}\n`);

validateConfig();

// Connect to MongoDB
connectDB();

// Middleware - Configure Helmet with relaxed CSP for test dashboard
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for test dashboard
            styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles
            imgSrc: ["'self'", "data:", "blob:", "https:"], // Allow images from various sources
            connectSrc: ["'self'", CONFIG.apiBaseUrl, "https://autoscrollextension.onrender.com"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
}));

// CORS configuration using environment variables
app.use(cors({
    origin: function (origin, callback) {
        // In development, allow all origins
        if (CONFIG.nodeEnv === 'development') {
            callback(null, true);
            return;
        }
        
        // Check if wildcard is set for all origins
        if (CONFIG.allowedOrigins.includes('*')) {
            callback(null, true);
            return;
        }
        
        // In production, check against allowed origins
        if (!origin || CONFIG.allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`❌ CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-razorpay-signature']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/upi-mandates', upiMandateRoutes);
app.use('/api/device', deviceVerificationRoutes);

// Serve test dashboard with environment configuration
app.get('/test-dashboard', (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const dashboardPath = path.join(__dirname, 'test-dashboard.html');
        
        if (!fs.existsSync(dashboardPath)) {
            return res.status(404).json({
                success: false,
                message: 'Test dashboard file not found'
            });
        }
        
        let htmlContent = fs.readFileSync(dashboardPath, 'utf8');
        
        // Replace template variables with actual environment values
        htmlContent = htmlContent.replace(/{{API_BASE_URL}}/g, CONFIG.apiBaseUrl);
        htmlContent = htmlContent.replace(/{{NODE_ENV}}/g, CONFIG.nodeEnv);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
    } catch (error) {
        console.error('Error serving test dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading test dashboard',
            error: error.message
        });
    }
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'AutoScroll Extension Backend API',
        version: '1.0.0',
        environment: CONFIG.nodeEnv,
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            auth: '/api/auth',
            users: '/api/users',
            payments: '/api/payments',
            subscriptions: '/api/subscriptions',
            upiMandates: '/api/upi-mandates',
            analytics: '/api/analytics',
            admin: '/api/admin',
            cleanup: '/api/cleanup'
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: CONFIG.nodeEnv === 'development' ? err.message : {}
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        availableEndpoints: CONFIG.nodeEnv === 'development' ? [
            `${CONFIG.apiBaseUrl}/api/users`,
            `${CONFIG.apiBaseUrl}/api/payments`,
            `${CONFIG.apiBaseUrl}/api/upi-mandates`,
            `${CONFIG.apiBaseUrl}/api/admin`
        ] : undefined
    });
});

// Start server
app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`\n🚀 AutoScroll Backend Server running on ${CONFIG.apiBaseUrl}`);
    console.log(`📊 Environment: ${CONFIG.nodeEnv}`);
    console.log(`🔗 UPI Mandate cron job scheduled for daily 2 AM IST`);
});

// Setup cron job for processing recurring charges (runs daily at 2 AM)
cron.schedule('0 2 * * *', async () => {
    console.log('Running daily UPI mandate charges...');
    try {
        const fetch = require('node-fetch');
        const response = await fetch(`${CONFIG.apiBaseUrl}/api/upi-mandates/process-charges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        console.log('Daily charge processing completed:', result);
    } catch (error) {
        console.error('Error in daily charge processing:', error);
    }
}, {
    timezone: "Asia/Kolkata"
});

// Export CONFIG for use in other modules
module.exports = { app, CONFIG };
