const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Daily cron job to update all trial users
const updateAllTrialUsers = async () => {
    try {
        console.log('🕐 Starting daily trial update job...');
        
        // Find all users with active trials
        const trialUsers = await User.find({
            subscriptionStatus: 'trial',
            trialEndDate: { $exists: true }
        });
        
        console.log(`📊 Found ${trialUsers.length} trial users to update`);
        
        let updatedCount = 0;
        let expiredCount = 0;
        
        for (const user of trialUsers) {
            try {
                const oldDays = user.trialDaysRemaining;
                
                // Call the updateTrialDays method
                user.updateTrialDays();
                await user.save();
                
                if (user.trialDaysRemaining <= 0 && oldDays > 0) {
                    expiredCount++;
                    console.log(`❌ Trial expired for user: ${user.email}`);
                } else {
                    updatedCount++;
                    console.log(`✅ Updated trial for ${user.email}: ${oldDays} → ${user.trialDaysRemaining} days`);
                }
                
            } catch (error) {
                console.error(`❌ Failed to update trial for user ${user.email}:`, error);
            }
        }
        
        console.log(`✅ Trial update job completed: ${updatedCount} updated, ${expiredCount} expired`);
        
        return {
            success: true,
            totalUsers: trialUsers.length,
            updated: updatedCount,
            expired: expiredCount
        };
        
    } catch (error) {
        console.error('❌ Daily trial update job failed:', error);
        return { success: false, error: error.message };
    }
};

// Manual endpoint to trigger trial updates (for testing)
router.post('/update-all-trials', async (req, res) => {
    try {
        const result = await updateAllTrialUsers();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get trial status for specific user (by ID or email)
router.get('/trial-status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Try to find user by MongoDB ObjectId first, then by email
        let user;
        if (userId.match(/^[0-9a-fA-F]{24}$/)) {
            // It's a valid MongoDB ObjectId
            user = await User.findById(userId);
        } else {
            // Assume it's an email address
            user = await User.findOne({ email: userId });
        }
        
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        // Update trial before returning status
        user.updateTrialDays();
        await user.save();
        
        res.json({
            success: true,
            data: {
                subscriptionStatus: user.subscriptionStatus,
                trialDaysRemaining: user.trialDaysRemaining,
                trialStartDate: user.trialStartDate,
                trialEndDate: user.trialEndDate,
                canUseExtension: user.canUseExtension,
                isTrialActive: user.isTrialActive
            }
        });
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if user can use extension features (by ID or email)
router.get('/check-access/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Try to find user by MongoDB ObjectId first, then by email
        let user;
        if (userId.match(/^[0-9a-fA-F]{24}$/)) {
            // It's a valid MongoDB ObjectId
            user = await User.findById(userId);
        } else {
            // Assume it's an email address
            user = await User.findOne({ email: userId });
        }
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                canUse: false,
                error: 'User not found' 
            });
        }
        
        // Update trial status first
        user.updateTrialDays();
        await user.save();
        
        const canUse = user.canUseExtension;
        let message = '';
        
        if (user.subscriptionStatus === 'trial') {
            if (user.trialDaysRemaining > 0) {
                message = `Trial: ${user.trialDaysRemaining} days remaining`;
            } else {
                message = 'Trial expired - please subscribe to continue';
            }
        } else if (user.subscriptionStatus === 'active') {
            message = 'Subscription active';
        } else if (user.subscriptionStatus === 'cancelled') {
            // Calculate remaining days for cancelled subscription
            let remainingDays = 0;
            if (user.subscriptionExpiry) {
                const now = new Date();
                const expiry = new Date(user.subscriptionExpiry);
                remainingDays = Math.max(0, Math.ceil((expiry - now) / (1000 * 60 * 60 * 24)));
            }
            
            if (remainingDays > 0) {
                message = `Subscription cancelled - ${remainingDays} days remaining`;
            } else {
                message = 'Subscription expired - please renew';
            }
        } else if (user.subscriptionStatus === 'expired') {
            message = 'Subscription expired - please renew';
        }
        
        res.json({
            success: true,
            canUse: canUse,
            subscriptionStatus: user.subscriptionStatus,
            trialDaysRemaining: user.trialDaysRemaining,
            message: message,
            warning: canUse ? null : 'Extension features are disabled. Please subscribe to continue.'
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            canUse: false,
            error: error.message 
        });
    }
});

// Schedule daily updates using setInterval (runs every 24 hours)
setInterval(async () => {
    await updateAllTrialUsers();
}, 24 * 60 * 60 * 1000); // 24 hours in milliseconds

// Run trial update once when server starts
setTimeout(async () => {
    console.log('🚀 Running initial trial update on server start...');
    await updateAllTrialUsers();
}, 5000); // Wait 5 seconds after server start

module.exports = { router, updateAllTrialUsers };
