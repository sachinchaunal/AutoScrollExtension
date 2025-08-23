const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const router = express.Router();

// Email configuration
const createTransporter = () => {
    return nodemailer.createTransporter({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

// Contact form endpoint
router.post('/contact', async (req, res) => {
    try {
        const { name, email, subject, message, type } = req.body;
        
        // Validate input
        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                success: false,
                error: 'All fields are required'
            });
        }
        
        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // For local testing, skip email sending and just log the message
        if (process.env.NODE_ENV === 'development') {
            console.log('📧 Contact form submission (Development Mode):');
            console.log('From:', name, email);
            console.log('Subject:', subject);
            console.log('Message:', message);
            console.log('Type:', type);
            
            return res.status(200).json({
                success: true,
                message: 'Message logged successfully (Development Mode)'
            });
        }

        // Production email sending
        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"${name}" <${email}>`,
            to: 'sachinchaunal@gmail.com',
            subject: `AutoScroll Extension - ${subject}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4CAF50;">AutoScroll Extension Contact Form</h2>
                    <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
                        <p><strong>Type:</strong> ${type || 'General Inquiry'}</p>
                        <p><strong>Name:</strong> ${name}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Subject:</strong> ${subject}</p>
                        <div style="margin-top: 20px;">
                            <strong>Message:</strong>
                            <p style="background-color: white; padding: 15px; border-radius: 3px; border-left: 4px solid #4CAF50;">
                                ${message.replace(/\n/g, '<br>')}
                            </p>
                        </div>
                    </div>
                    <p style="color: #666; font-size: 12px; margin-top: 20px;">
                        This message was sent through the AutoScroll Extension website contact form.
                    </p>
                </div>
            `
        };

        // Send email
        await transporter.sendMail(mailOptions);
        
        res.status(200).json({
            success: true,
            message: 'Message sent successfully! We will get back to you soon.'
        });
        
        console.log('📧 Contact form email sent successfully');
        
    } catch (error) {
        console.error('Contact form error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to send message. Please try again later.'
        });
    }
});

// Newsletter signup endpoint
router.post('/newsletter', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Valid email address is required'
            });
        }

        // For local testing, just log the subscription
        if (process.env.NODE_ENV === 'development') {
            console.log('📧 Newsletter subscription (Development Mode):', email);
            
            return res.status(200).json({
                success: true,
                message: 'Newsletter subscription logged successfully (Development Mode)'
            });
        }

        // Production email sending
        const transporter = createTransporter();
        
        const mailOptions = {
            from: 'AutoScroll Extension <sachinchaunal13@gmail.com>',
            to: 'sachinchaunal@gmail.com',
            subject: 'New Newsletter Subscription - AutoScroll Extension',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4CAF50;">New Newsletter Subscription</h2>
                    <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Subscribed at:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    <p style="color: #666; font-size: 12px; margin-top: 20px;">
                        This subscription was made through the AutoScroll Extension website.
                    </p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.status(200).json({
            success: true,
            message: 'Thank you for subscribing to our newsletter!'
        });
        
        console.log('📧 Newsletter subscription email sent for:', email);
        
    } catch (error) {
        console.error('Newsletter signup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to subscribe. Please try again later.'
        });
    }
});

// User feedback endpoint
router.post('/feedback', async (req, res) => {
    try {
        const { rating, comment, userEmail } = req.body;
        
        // Validate input
        if (!rating || !comment) {
            return res.status(400).json({
                success: false,
                error: 'Rating and comment are required'
            });
        }

        // For local testing, just log the feedback
        if (process.env.NODE_ENV === 'development') {
            console.log('📝 User feedback (Development Mode):');
            console.log('Rating:', rating);
            console.log('Comment:', comment);
            console.log('Email:', userEmail || 'Anonymous');
            
            return res.status(200).json({
                success: true,
                message: 'Feedback logged successfully (Development Mode)'
            });
        }

        // Production email sending
        const transporter = createTransporter();
        
        const mailOptions = {
            from: 'AutoScroll Extension <sachinchaunal13@gmail.com>',
            to: 'sachinchaunal@gmail.com',
            subject: `User Feedback - AutoScroll Extension (${rating} stars)`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4CAF50;">User Feedback</h2>
                    <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
                        <p><strong>Rating:</strong> ${'⭐'.repeat(rating)} (${rating}/5)</p>
                        <p><strong>User Email:</strong> ${userEmail || 'Anonymous'}</p>
                        <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
                        <div style="margin-top: 20px;">
                            <strong>Comment:</strong>
                            <p style="background-color: white; padding: 15px; border-radius: 3px; border-left: 4px solid #4CAF50;">
                                ${comment.replace(/\n/g, '<br>')}
                            </p>
                        </div>
                    </div>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.status(200).json({
            success: true,
            message: 'Thank you for your feedback!'
        });
        
        console.log('📝 User feedback email sent successfully');
        
    } catch (error) {
        console.error('Feedback submission error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit feedback. Please try again later.'
        });
    }
});

// Download extension as ZIP file
router.get('/download-extension', async (req, res) => {
    try {
        console.log('📦 Starting extension ZIP download...');
        
        const extensionPath = path.join(__dirname, '..', 'public', 'extension');
        
        // Check if extension directory exists
        if (!fs.existsSync(extensionPath)) {
            console.error('❌ Extension directory not found:', extensionPath);
            return res.status(404).json({
                success: false,
                error: 'Extension files not found'
            });
        }

        // Set response headers for ZIP download
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="AutoScroll-Extension.zip"');

        // Create ZIP archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        // Handle archive errors
        archive.on('error', (err) => {
            console.error('❌ Archive error:', err);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Failed to create extension package'
                });
            }
        });

        // Handle archive completion
        archive.on('end', () => {
            console.log('✅ Extension ZIP created successfully. Total bytes:', archive.pointer());
        });

        // Pipe archive to response
        archive.pipe(res);

        // Add extension files to archive
        archive.directory(extensionPath, false);

        // Add installation instructions
        const installationGuide = `AutoScroll Extension - Installation Guide
==========================================

Thank you for downloading AutoScroll Extension!

INSTALLATION STEPS:
1. Unzip this file to any folder on your computer
2. Open Google Chrome
3. Go to: chrome://extensions/
4. Enable "Developer mode" (toggle in top-right corner)
5. Click "Load unpacked"
6. Select the unzipped folder containing the extension files

FEATURES:
• Automatic scrolling on YouTube Shorts
• Customizable scroll speed and timing
• Smart pause detection
• Google Authentication integration
• Free to use with unlimited scrolling

USAGE:
1. Visit YouTube Shorts (youtube.com/shorts)
2. Click the extension icon in your browser toolbar
3. Configure settings and enjoy automatic scrolling!

SUPPORT:
Website: https://autoscrollextension.onrender.com
Email: sachinchaunal@gmail.com
GitHub: [Your GitHub Repository]

WHAT'S INCLUDED:
• manifest.json - Extension configuration
• background.js - Background service worker
• popup/ - Extension popup interface
• content-scripts/ - YouTube integration scripts
• icons/ - Extension icons
• utils/ - Authentication utilities

Thank you for using AutoScroll Extension!
Version: 1.0.0
`;

        // Add installation guide to ZIP
        archive.append(installationGuide, { name: 'INSTALLATION_GUIDE.txt' });

        // Finalize the archive
        archive.finalize();
        
        console.log('📦 AutoScroll Extension ZIP download initiated');
        
    } catch (error) {
        console.error('❌ Download error:', error);
        
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Failed to create extension package'
            });
        }
    }
});

// Get extension info endpoint
router.get('/extension-info', (req, res) => {
    try {
        const extensionPath = path.join(__dirname, '..', 'public', 'extension');
        const manifestPath = path.join(extensionPath, 'manifest.json');
        
        if (!fs.existsSync(manifestPath)) {
            return res.status(404).json({
                success: false,
                error: 'Extension manifest not found'
            });
        }
        
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        res.json({
            success: true,
            extension: {
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                permissions: manifest.permissions,
                downloadUrl: '/api/download-extension'
            }
        });
        
    } catch (error) {
        console.error('Extension info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get extension information'
        });
    }
});

module.exports = router;
