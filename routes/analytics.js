const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Log usage analytics (main endpoint used by extension)
router.post('/log-usage', async (req, res) => {
    try {
        const { userId, feature, platform, metadata } = req.body;

        if (!userId || !platform) {
            return res.status(400).json({
                success: false,
                message: 'User ID and platform are required'
            });
        }

        // Update user scroll count
        const user = await User.findOne({ userId });
        
        if (user) {
            user.totalScrolls += 1;
            user.platformUsage[platform] = (user.platformUsage[platform] || 0) + 1;
            
            // Store additional metadata if provided
            if (metadata) {
                if (!user.usageMetadata) user.usageMetadata = [];
                user.usageMetadata.push({
                    feature: feature || 'autoscroll',
                    platform,
                    timestamp: new Date(),
                    ...metadata
                });
                
                // Keep only last 100 usage records to prevent document bloat
                if (user.usageMetadata.length > 100) {
                    user.usageMetadata = user.usageMetadata.slice(-100);
                }
            }
            
            await user.save();
        }

        res.json({
            success: true,
            message: 'Usage analytics logged successfully',
            data: {
                userId,
                feature: feature || 'autoscroll',
                platform,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error logging usage analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Error logging usage analytics',
            error: error.message
        });
    }
});

module.exports = router;
