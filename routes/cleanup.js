const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get cleanup status overview
router.get('/', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const deletedUsers = await User.countDocuments({ isDeleted: true });
        const expiredTrials = await User.countDocuments({ 
            trialDaysRemaining: { $lte: 0 },
            subscriptionStatus: 'trial'
        });
        const expiredSubscriptions = await User.countDocuments({
            subscriptionExpiry: { $lt: new Date() },
            isSubscriptionActive: true
        });

        res.json({
            success: true,
            data: {
                totalUsers,
                deletedUsers,
                expiredTrials,
                expiredSubscriptions,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching cleanup overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching cleanup overview',
            error: error.message
        });
    }
});

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Cleanup service is running correctly',
        timestamp: new Date().toISOString()
    });
});

/**
 * Admin endpoint to clean up soft deleted users
 */
router.post('/cleanup-deleted', async (req, res) => {
    try {
        console.log('Starting cleanup of soft deleted users...');
        
        // Find users marked as deleted more than 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const deletedUsers = await User.find({ 
            isDeleted: true,
            deletedAt: { $lt: thirtyDaysAgo }
        });
        
        let cleanedCount = 0;
        
        for (const user of deletedUsers) {
            console.log(`Permanently deleting user: ${user.email}`);
            await User.findByIdAndDelete(user._id);
            cleanedCount++;
        }
        
        const remainingUsers = await User.countDocuments();
        
        res.json({
            success: true,
            message: 'Deleted users cleanup completed successfully',
            data: {
                usersRemoved: cleanedCount,
                remainingUsers: remainingUsers
            }
        });
        
    } catch (error) {
        console.error('Error during deleted users cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Deleted users cleanup failed',
            error: error.message
        });
    }
});

/**
 * Admin endpoint to clean up expired trial users
 */
router.post('/cleanup-expired-trials', async (req, res) => {
    try {
        console.log('Starting cleanup of expired trial users...');
        
        // Find users with expired trials (more than 7 days past expiry)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const expiredTrialUsers = await User.find({ 
            subscriptionStatus: 'trial',
            trialEndDate: { $lt: sevenDaysAgo },
            trialDaysRemaining: { $lte: 0 }
        });
        
        let cleanedCount = 0;
        
        for (const user of expiredTrialUsers) {
            console.log(`Soft deleting expired trial user: ${user.email}`);
            user.isDeleted = true;
            user.deletedAt = new Date();
            user.updatedAt = new Date();
            await user.save();
            cleanedCount++;
        }
        
        const remainingActiveUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        
        res.json({
            success: true,
            message: 'Expired trial users cleanup completed successfully',
            data: {
                usersSoftDeleted: cleanedCount,
                remainingActiveUsers: remainingActiveUsers
            }
        });
        
    } catch (error) {
        console.error('Error during expired trial cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Expired trial cleanup failed',
            error: error.message
        });
    }
});

// Cleanup expired trials (alias)
router.post('/expired-trials', async (req, res) => {
    try {
        console.log('Starting cleanup of expired trial users...');
        
        // Find users with expired trials (more than 7 days past expiry)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const expiredTrialUsers = await User.find({ 
            subscriptionStatus: 'trial',
            trialEndDate: { $lt: sevenDaysAgo },
            trialDaysRemaining: { $lte: 0 }
        });
        
        let cleanedCount = 0;
        
        for (const user of expiredTrialUsers) {
            console.log(`Soft deleting expired trial user: ${user.email}`);
            user.isDeleted = true;
            user.deletedAt = new Date();
            user.updatedAt = new Date();
            await user.save();
            cleanedCount++;
        }
        
        const remainingActiveUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        
        res.json({
            success: true,
            message: 'Expired trial users cleanup completed successfully',
            data: {
                usersSoftDeleted: cleanedCount,
                remainingActiveUsers: remainingActiveUsers
            }
        });
        
    } catch (error) {
        console.error('Error during expired trial cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Expired trial cleanup failed',
            error: error.message
        });
    }
});

/**
 * Admin endpoint to update expired subscriptions
 */
router.post('/update-expired-subscriptions', async (req, res) => {
    try {
        console.log('Starting update of expired subscriptions...');
        
        const now = new Date();
        
        // Find subscriptions that are marked as active but have expired
        const result = await User.updateMany(
            {
                isSubscriptionActive: true,
                subscriptionExpiry: { $lt: now }
            },
            {
                $set: {
                    isSubscriptionActive: false,
                    subscriptionStatus: 'expired',
                    updatedAt: now
                }
            }
        );
        
        console.log(`Updated ${result.modifiedCount} expired subscriptions`);
        
        res.json({
            success: true,
            message: 'Expired subscriptions updated successfully',
            data: {
                subscriptionsUpdated: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error during subscription expiry update:', error);
        res.status(500).json({
            success: false,
            message: 'Subscription expiry update failed',
            error: error.message
        });
    }
});

/**
 * Admin endpoint to clean up duplicate Google accounts
 */
router.post('/cleanup-duplicate-google', async (req, res) => {
    try {
        console.log('Starting cleanup of duplicate Google accounts...');
        
        // Find all Google IDs with multiple users
        const duplicates = await User.aggregate([
            {
                $match: { googleId: { $exists: true, $ne: null } }
            },
            {
                $group: {
                    _id: "$googleId",
                    count: { $sum: 1 },
                    users: { $push: "$$ROOT" }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ]);
        
        let cleanedCount = 0;
        
        for (const duplicate of duplicates) {
            console.log(`Processing Google ID: ${duplicate._id}`);
            
            // Sort users by creation date (keep the oldest one)
            duplicate.users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            
            // Keep the first user, soft delete the rest
            const userToKeep = duplicate.users[0];
            const usersToDelete = duplicate.users.slice(1);
            
            console.log(`Keeping user: ${userToKeep.email}`);
            
            for (const userToDelete of usersToDelete) {
                console.log(`Soft deleting duplicate user: ${userToDelete.email}`);
                await User.findByIdAndUpdate(userToDelete._id, {
                    isDeleted: true,
                    deletedAt: new Date(),
                    updatedAt: new Date()
                });
                cleanedCount++;
            }
        }
        
        const remainingActiveUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        
        res.json({
            success: true,
            message: 'Duplicate Google accounts cleanup completed successfully',
            data: {
                duplicateGroupsFound: duplicates.length,
                usersSoftDeleted: cleanedCount,
                remainingActiveUsers: remainingActiveUsers
            }
        });
        
    } catch (error) {
        console.error('Error during Google duplicates cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Google duplicates cleanup failed',
            error: error.message
        });
    }
});

// Cleanup old data (comprehensive cleanup)
router.post('/old-data', async (req, res) => {
    try {
        console.log('Starting comprehensive old data cleanup...');
        
        let totalCleaned = 0;
        const results = [];

        // 1. Clean expired trials
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const expiredTrialUsers = await User.find({ 
            subscriptionStatus: 'trial',
            trialEndDate: { $lt: sevenDaysAgo },
            trialDaysRemaining: { $lte: 0 }
        });
        
        for (const user of expiredTrialUsers) {
            user.isDeleted = true;
            user.deletedAt = new Date();
            user.updatedAt = new Date();
            await user.save();
            totalCleaned++;
        }
        
        results.push({
            operation: 'expired_trials',
            count: expiredTrialUsers.length,
            message: 'Expired trial users soft deleted'
        });

        // 2. Clean old deleted users (permanently delete after 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const oldDeletedUsers = await User.find({ 
            isDeleted: true,
            deletedAt: { $lt: thirtyDaysAgo }
        });
        
        for (const user of oldDeletedUsers) {
            await User.findByIdAndDelete(user._id);
            totalCleaned++;
        }
        
        results.push({
            operation: 'old_deleted_users',
            count: oldDeletedUsers.length,
            message: 'Old deleted users permanently removed'
        });

        // 3. Update expired subscriptions
        const now = new Date();
        const expiredSubsResult = await User.updateMany(
            {
                isSubscriptionActive: true,
                subscriptionExpiry: { $lt: now }
            },
            {
                $set: {
                    isSubscriptionActive: false,
                    subscriptionStatus: 'expired',
                    updatedAt: now
                }
            }
        );
        
        results.push({
            operation: 'expired_subscriptions',
            count: expiredSubsResult.modifiedCount,
            message: 'Expired subscriptions updated'
        });

        const remainingActiveUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        
        res.json({
            success: true,
            message: 'Comprehensive old data cleanup completed successfully',
            data: {
                totalItemsCleaned: totalCleaned,
                operations: results,
                remainingActiveUsers: remainingActiveUsers
            }
        });
        
    } catch (error) {
        console.error('Error during old data cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Old data cleanup failed',
            error: error.message
        });
    }
});

module.exports = router;
