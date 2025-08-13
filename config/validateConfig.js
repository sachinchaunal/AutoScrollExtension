/**
 * Configuration Validation Utility
 * Validates that all required environment variables are properly set
 */

const validateConfig = () => {
    const requiredEnvVars = [
        'RAZORPAY_KEY_ID',
        'RAZORPAY_KEY_SECRET',
        'RAZORPAY_PLAN_ID',
        'MONGODB_URI',
        'JWT_SECRET'
    ];

    const optionalEnvVars = [
        // Razorpay Configuration
        'RAZORPAY_WEBHOOK_SECRET',
        
        // Business Configuration
        'MERCHANT_UPI_ID',
        'MERCHANT_NAME',
        'MERCHANT_CODE',
        'DEFAULT_CUSTOMER_PHONE',
        'DEFAULT_CUSTOMER_EMAIL',
        
        // Subscription Configuration
        'SUBSCRIPTION_PRICE',
        'TRIAL_DAYS',
        'SUBSCRIPTION_TOTAL_COUNT',
        'SUBSCRIPTION_DESCRIPTION',
        
        // URL Configuration
        'HOST',
        'API_BASE_URL',
        'FRONTEND_URL',
        'CLIENT_URL',
        'SERVER_URL',
        'WEBHOOK_BASE_URL',
        'ALLOWED_ORIGINS',
        
        // Environment Configuration
        'NODE_ENV',
        'PORT'
    ];

    console.log('🔍 Validating Environment Configuration...\n');

    // Check required variables
    const missingRequired = [];
    requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            missingRequired.push(varName);
        } else {
            console.log(`✅ ${varName}: ${process.env[varName].substring(0, 20)}...`);
        }
    });

    // Check optional variables
    console.log('\n📋 Optional Configuration:');
    optionalEnvVars.forEach(varName => {
        if (process.env[varName]) {
            console.log(`✅ ${varName}: ${process.env[varName]}`);
        } else {
            console.log(`⚠️  ${varName}: Using default value`);
        }
    });

    // Report results
    if (missingRequired.length > 0) {
        console.log('\n❌ Missing Required Environment Variables:');
        missingRequired.forEach(varName => {
            console.log(`   - ${varName}`);
        });
        console.log('\n🚨 Server may not function properly without these variables!');
        return false;
    } else {
        console.log('\n✅ All required environment variables are configured!');
        console.log('🚀 Server configuration is valid.');
        return true;
    }
};

module.exports = { validateConfig };
