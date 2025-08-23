const cron = require('node-cron');
const User = require('../models/User');
const SubscriptionService = require('../services/subscriptionService');
const { fetchSubscription } = require('../config/razorpay');

/**
 * Subscription Monitoring Cron Jobs
 * Handles automated subscription monitoring, notifications, and cleanup
 */

console.log('🕒 Setting up subscription monitoring cron jobs...');

/**
 * Daily subscription status check
 * Runs every day at 9:00 AM to check for expired trials and subscriptions
 */
cron.schedule('0 9 * * *', async () => {
    console.log('📊 Running daily subscription status check...');
    
    try {
        await checkExpiredTrials();
        await checkExpiringSubscriptions();
        await syncSubscriptionStatuses();
        console.log('✅ Daily subscription check completed');
    } catch (error) {
        console.error('❌ Daily subscription check failed:', error);
    }
});

/**
 * Hourly subscription sync
 * Runs every hour to sync subscription statuses with Razorpay
 */
cron.schedule('0 * * * *', async () => {
    console.log('🔄 Running hourly subscription sync...');
    
    try {
        await syncActiveSubscriptions();
        console.log('✅ Hourly subscription sync completed');
    } catch (error) {
        console.error('❌ Hourly subscription sync failed:', error);
    }
});

/**
 * Weekly cleanup job
 * Runs every Sunday at 2:00 AM to clean up old data
 */
cron.schedule('0 2 * * 0', async () => {
    console.log('🧹 Running weekly subscription cleanup...');
    
    try {
        await cleanupExpiredSubscriptions();
        await cleanupOldUsageData();
        console.log('✅ Weekly cleanup completed');
    } catch (error) {
        console.error('❌ Weekly cleanup failed:', error);
    }
});

/**
 * Check for expired trials and send notifications
 */
async function checkExpiredTrials() {
    try {
        // Find users with trials that expired in the last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const now = new Date();
        
        const expiredTrialUsers = await User.find({
            'subscription.trial.isActive': true,
            'subscription.trial.endDate': {
                $gte: oneDayAgo,
                $lt: now
            },
            'subscription.razorpay.status': { $ne: 'active' }
        });
        
        console.log(`🔍 Found ${expiredTrialUsers.length} recently expired trial users`);
        
        for (const user of expiredTrialUsers) {
            try {
                // Deactivate trial
                user.subscription.trial.isActive = false;
                user.subscription.razorpay.status = 'expired';
                
                await user.save();
                
                console.log(`⏰ Trial expired for user: ${user.email}`);
                
                // TODO: Send email notification about trial expiry
                // await sendTrialExpiredEmail(user);
                
            } catch (error) {
                console.error(`❌ Failed to process expired trial for ${user.email}:`, error);
            }
        }
        
    } catch (error) {
        console.error('❌ Failed to check expired trials:', error);
    }
}

/**
 * Check for subscriptions expiring within 3 days
 */
async function checkExpiringSubscriptions() {
    try {
        const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        
        const expiringUsers = await User.find({
            'subscription.razorpay.status': 'active',
            'subscription.razorpay.currentPeriodEnd': {
                $lte: threeDaysFromNow,
                $gt: new Date()
            }
        });
        
        console.log(`🔔 Found ${expiringUsers.length} subscriptions expiring within 3 days`);
        
        for (const user of expiringUsers) {
            try {
                const daysRemaining = Math.ceil(
                    (user.subscription.razorpay.currentPeriodEnd - new Date()) / (1000 * 60 * 60 * 24)
                );
                
                console.log(`⚠️ Subscription expiring in ${daysRemaining} days for user: ${user.email}`);
                
                // TODO: Send email notification about upcoming expiry
                // await sendExpiryReminderEmail(user, daysRemaining);
                
            } catch (error) {
                console.error(`❌ Failed to process expiring subscription for ${user.email}:`, error);
            }
        }
        
    } catch (error) {
        console.error('❌ Failed to check expiring subscriptions:', error);
    }
}

/**
 * Sync subscription statuses with Razorpay
 */
async function syncSubscriptionStatuses() {
    try {
        const activeSubscriptionUsers = await User.find({
            'subscription.razorpay.subscriptionId': { $exists: true, $ne: null },
            'subscription.razorpay.status': { $in: ['active', 'past_due', 'created'] }
        });
        
        console.log(`🔄 Syncing ${activeSubscriptionUsers.length} active subscriptions with Razorpay`);
        
        for (const user of activeSubscriptionUsers) {
            try {
                const subscription = await fetchSubscription(user.subscription.razorpay.subscriptionId);
                
                // Update subscription status if it has changed
                if (subscription.status !== user.subscription.razorpay.status) {
                    console.log(`📝 Updating subscription status for ${user.email}: ${user.subscription.razorpay.status} → ${subscription.status}`);
                    
                    user.updateSubscriptionStatus(subscription);
                    await user.save();
                }
                
            } catch (error) {
                console.error(`❌ Failed to sync subscription for ${user.email}:`, error);
                
                // If subscription not found in Razorpay, mark as expired
                if (error.message.includes('not found') || error.message.includes('does not exist')) {
                    user.subscription.razorpay.status = 'expired';
                    await user.save();
                    console.log(`🗑️ Marked subscription as expired for ${user.email} (not found in Razorpay)`);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Failed to sync subscription statuses:', error);
    }
}

/**
 * Sync only active subscriptions more frequently
 */
async function syncActiveSubscriptions() {
    try {
        const activeUsers = await User.find({
            'subscription.razorpay.subscriptionId': { $exists: true, $ne: null },
            'subscription.razorpay.status': 'active',
            'subscription.razorpay.currentPeriodEnd': { $gt: new Date() }
        }).limit(50); // Limit to avoid rate limiting
        
        console.log(`🔄 Quick sync for ${activeUsers.length} active subscriptions`);
        
        for (const user of activeUsers) {
            try {
                const subscription = await fetchSubscription(user.subscription.razorpay.subscriptionId);
                
                if (subscription.status !== 'active') {
                    console.log(`⚠️ Status change detected for ${user.email}: active → ${subscription.status}`);
                    
                    user.updateSubscriptionStatus(subscription);
                    await user.save();
                }
                
            } catch (error) {
                console.error(`❌ Failed to quick sync for ${user.email}:`, error);
            }
        }
        
    } catch (error) {
        console.error('❌ Failed to sync active subscriptions:', error);
    }
}

/**
 * Clean up expired subscriptions older than 30 days
 */
async function cleanupExpiredSubscriptions() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        const result = await User.updateMany(
            {
                'subscription.razorpay.status': { $in: ['expired', 'cancelled'] },
                'subscription.razorpay.cancelledAt': { $lt: thirtyDaysAgo }
            },
            {
                $unset: {
                    'subscription.razorpay.subscriptionId': '',
                    'subscription.razorpay.planId': ''
                }
            }
        );
        
        console.log(`🧹 Cleaned up ${result.modifiedCount} old expired subscriptions`);
        
    } catch (error) {
        console.error('❌ Failed to cleanup expired subscriptions:', error);
    }
}

/**
 * Clean up old usage data (keep only last 90 days)
 */
async function cleanupOldUsageData() {
    try {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        
        const result = await User.updateMany(
            {
                'subscription.usage.dailyUsage.date': { $lt: ninetyDaysAgo }
            },
            {
                $pull: {
                    'subscription.usage.dailyUsage': {
                        date: { $lt: ninetyDaysAgo }
                    }
                }
            }
        );
        
        console.log(`🧹 Cleaned up old usage data for ${result.modifiedCount} users`);
        
    } catch (error) {
        console.error('❌ Failed to cleanup old usage data:', error);
    }
}

/**
 * Get subscription monitoring statistics
 */
async function getSubscriptionStats() {
    try {
        const stats = await User.aggregate([
            {
                $group: {
                    _id: '$subscription.razorpay.status',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        const trialUsers = await User.countDocuments({
            'subscription.trial.isActive': true,
            'subscription.trial.endDate': { $gt: new Date() }
        });
        
        const expiredTrials = await User.countDocuments({
            'subscription.trial.isActive': false,
            'subscription.razorpay.status': { $ne: 'active' }
        });
        
        return {
            subscriptionStatuses: stats,
            activeTrials: trialUsers,
            expiredTrials: expiredTrials,
            lastUpdated: new Date()
        };
        
    } catch (error) {
        console.error('❌ Failed to get subscription stats:', error);
        return null;
    }
}

// Export stats function for API use
module.exports = {
    getSubscriptionStats
};

console.log('✅ Subscription monitoring cron jobs setup complete');
