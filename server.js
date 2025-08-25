const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/database');
const { validateConfig } = require('./config/validateConfig');
const { initializePlans } = require('./config/razorpay');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const analyticsRoutes = require('./routes/analytics');
const websiteRoutes = require('./routes/website');
const webAuthRoutes = require('./routes/web-auth');
const subscriptionRoutes = require('./routes/subscription');

// Import smart rate limiting middleware
const { 
    smartRateLimit, 
    requestFrequencyAnalyzer 
} = require('./middleware/rateLimiting');

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
// Configure specific trust proxy settings to avoid security warnings
if (CONFIG.nodeEnv === 'production') {
    // Trust only the first proxy for better security
    app.set('trust proxy', 1);
} else {
    // Development environment - don't trust proxy
    app.set('trust proxy', false);
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

// Initialize Razorpay plans
initializePlans();

// Start subscription monitoring jobs
require('./jobs/subscriptionMonitor');

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
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Smart rate limiting based on endpoint type
app.use('/api', requestFrequencyAnalyzer);
app.use('/api', smartRateLimit);

// Raw body capture middleware (removed - no longer needed without payment webhooks)

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration for web authentication with 10-day persistent sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'autoscroll-session-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/autoscroll',
        touchAfter: 24 * 3600 // lazy session update - only update session once per 24 hours
    }),
    cookie: {
        secure: CONFIG.nodeEnv === 'production',
        httpOnly: true,
        maxAge: 10 * 24 * 60 * 60 * 1000, // 10 days (864,000,000 ms)
        sameSite: CONFIG.nodeEnv === 'production' ? 'none' : 'lax' // Allow cross-site cookies for extension
    },
    rolling: true // Reset expiry on each request to extend session automatically
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', webAuthRoutes); // Web-based authentication
app.use('/auth', webAuthRoutes); // Direct auth routes (for OAuth callback)
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api', websiteRoutes);

// Individual page routes
app.get('/contact', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'contact.html'));
});

app.get('/support', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'support.html'));
});

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'privacy.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', 'terms.html'));
});

// Subscription pages
app.get('/subscribe', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'subscribe.html'));
});

app.get('/manage-subscription', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'manage-subscription.html'));
});

// Serve static files from public directory - MUST come after API routes
app.use(express.static(path.join(__dirname, 'public')));

// Test authentication page
app.get('/test-auth', (req, res) => {
    res.sendFile(path.join(__dirname, 'test-auth.html'));
});

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

// Serve admin dashboard with environment configuration
app.get('/admin-dashboard', (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        const dashboardPath = path.join(__dirname, 'admin-dashboard.html');
        
        if (!fs.existsSync(dashboardPath)) {
            return res.status(404).json({
                success: false,
                message: 'Admin dashboard file not found'
            });
        }
        
        let htmlContent = fs.readFileSync(dashboardPath, 'utf8');
        
        // Replace template variables with actual environment values
        htmlContent = htmlContent.replace(/{{API_BASE_URL}}/g, CONFIG.apiBaseUrl);
        htmlContent = htmlContent.replace(/{{NODE_ENV}}/g, CONFIG.nodeEnv);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(htmlContent);
    } catch (error) {
        console.error('Error serving admin dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error loading admin dashboard',
            error: error.message
        });
    }
});

// OAuth callback route for cross-browser authentication
app.get('/auth/callback', (req, res) => {
    try {
        const fs = require('fs');
        const callbackPath = path.join(__dirname, 'public', 'auth-callback.html');
        
        if (!fs.existsSync(callbackPath)) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Auth Callback</title></head>
                <body>
                    <h1>Authentication Complete</h1>
                    <p>You can close this window.</p>
                    <script>
                        try {
                            const urlParams = new URLSearchParams(window.location.hash.substring(1));
                            const token = urlParams.get('access_token');
                            if (token && window.opener) {
                                window.opener.postMessage({type: 'GOOGLE_AUTH_SUCCESS', token: token}, '*');
                            }
                            setTimeout(() => window.close(), 2000);
                        } catch(e) { console.error(e); }
                    </script>
                </body>
                </html>
            `);
        }
        
        res.sendFile(callbackPath);
    } catch (error) {
        console.error('Error serving auth callback:', error);
        res.status(500).send('Authentication callback error');
    }
});

// API status endpoint
app.get('/api/status', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'AutoScroll Extension Backend API',
        version: '1.0.0',
        environment: CONFIG.nodeEnv,
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/health',
            status: '/api/status',
            auth: '/api/auth',
            users: '/api/users',
            analytics: '/api/analytics',
            website: '/api (contact, support, downloads)'
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
            `${CONFIG.apiBaseUrl}/api/analytics`
        ] : undefined
    });
});

// Start server
app.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`\n🚀 AutoScroll Backend Server running on ${CONFIG.apiBaseUrl}`);
    console.log(`📊 Environment: ${CONFIG.nodeEnv}`);
});

// Export CONFIG for use in other modules
module.exports = { app, CONFIG };
