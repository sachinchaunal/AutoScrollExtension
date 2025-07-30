const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Test connection endpoint
router.get('/test', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Cleanup service is running correctly',
        timestamp: new Date().toISOString()
    });
});

/**
 * Admin endpoint to clean up duplicate users
 */
router.post('/cleanup-duplicates', async (req, res) => {
    try {
        console.log('Starting cleanup of duplicate users...');
        
        // Find all device fingerprints with multiple users
        const duplicates = await User.aggregate([
            {
                $group: {
                    _id: "$deviceFingerprint",
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
            console.log(`Processing device fingerprint: ${duplicate._id.substring(0, 16)}...`);
            
            // Sort users by creation date (keep the oldest one)
            duplicate.users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            
            // Keep the first user, delete the rest
            const userToKeep = duplicate.users[0];
            const usersToDelete = duplicate.users.slice(1);
            
            console.log(`Keeping user: ${userToKeep.userId}`);
            
            // Ensure the kept user is not blocked due to false trial abuse
            if (userToKeep.subscriptionStatus === 'blocked') {
                userToKeep.subscriptionStatus = 'trial';
                userToKeep.trialBypassAttempts = 0;
                await User.findByIdAndUpdate(userToKeep._id, {
                    subscriptionStatus: 'trial',
                    trialBypassAttempts: 0
                });
                console.log(`Unblocked user: ${userToKeep.userId}`);
            }
            
            for (const userToDelete of usersToDelete) {
                console.log(`Deleting duplicate user: ${userToDelete.userId}`);
                await User.findByIdAndDelete(userToDelete._id);
                cleanedCount++;
            }
        }
        
        const remainingUsers = await User.countDocuments();
        
        res.json({
            success: true,
            message: 'Cleanup completed successfully',
            data: {
                duplicateGroupsFound: duplicates.length,
                usersRemoved: cleanedCount,
                remainingUsers: remainingUsers
            }
        });
        
    } catch (error) {
        console.error('Error during cleanup:', error);
        res.status(500).json({
            success: false,
            message: 'Cleanup failed',
            error: error.message
        });
    }
});

module.exports = router;
