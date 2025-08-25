const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const router = express.Router();

// Email configuration
const createTransporter = () => {
    return nodemailer.createTransport({
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
            to: 'sachinchaunal13@gmail.com',
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

// Support form endpoint
router.post('/support', async (req, res) => {
    try {
        const { name, email, type, message, requestType } = req.body;
        
        // Validate input
        if (!name || !email || !type || !message) {
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

        // For local testing, we can optionally send emails for testing
        // Set SEND_EMAILS_IN_DEV=true in .env to test email functionality in development
        if (process.env.NODE_ENV === 'development' && process.env.SEND_EMAILS_IN_DEV !== 'true') {
            console.log('🆘 Support form submission (Development Mode):');
            console.log('From:', name, email);
            console.log('Issue Type:', type);
            console.log('Message:', message);
            console.log('Request Type:', requestType);
            console.log('💡 To test email sending in development, set SEND_EMAILS_IN_DEV=true in .env');
            
            return res.status(200).json({
                success: true,
                message: 'Support request logged successfully (Development Mode)'
            });
        }

        // Production email sending (or development with SEND_EMAILS_IN_DEV=true)
        try {
            const transporter = createTransporter();
            
            // Test the transporter configuration
            await transporter.verify();
            console.log('📧 SMTP connection verified successfully');
            
            // Map issue types to user-friendly descriptions
            const issueTypeMap = {
                'installation': 'Installation Problem',
                'functionality': 'Extension Not Working',
                'payment': 'Payment/Subscription Issue',
                'feature': 'Feature Request',
                'bug': 'Bug Report',
                'account': 'Account Issue',
                'other': 'Other'
            };
            
            const issueTypeDisplay = issueTypeMap[type] || type;
            
            const mailOptions = {
                from: `"AutoScroll Support" <${process.env.EMAIL_USER}>`, // Use authenticated email as sender
                replyTo: `"${name}" <${email}>`, // Set user's email as reply-to
                to: 'sachinchaunal13@gmail.com',
                subject: `AutoScroll Extension - Support Request: ${issueTypeDisplay}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #dc3545;">🆘 AutoScroll Extension Support Request</h2>
                        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; border-left: 4px solid #dc3545;">
                            <p><strong>Issue Type:</strong> ${issueTypeDisplay}</p>
                            <p><strong>Name:</strong> ${name}</p>
                            <p><strong>Email:</strong> ${email}</p>
                            <p><strong>Submitted at:</strong> ${new Date().toLocaleString()}</p>
                            <div style="margin-top: 20px;">
                                <strong>Issue Description:</strong>
                                <p style="background-color: white; padding: 15px; border-radius: 3px; border-left: 4px solid #dc3545;">
                                    ${message.replace(/\n/g, '<br>')}
                                </p>
                            </div>
                        </div>
                        <div style="background-color: #fff3cd; padding: 15px; margin-top: 20px; border-radius: 5px; border-left: 4px solid #ffc107;">
                            <p style="margin: 0; color: #856404;">
                                <strong>Priority:</strong> This is a support request and should be responded to within 24 hours.
                            </p>
                        </div>
                        <p style="color: #666; font-size: 12px; margin-top: 20px;">
                            This support request was submitted through the AutoScroll Extension support center.
                        </p>
                    </div>
                `
            };

            // Send email
            const emailResult = await transporter.sendMail(mailOptions);
            console.log('🆘 Support request email sent successfully for:', issueTypeDisplay);
            console.log('📧 Email sent with ID:', emailResult.messageId);
            
            res.status(200).json({
                success: true,
                message: 'Support request submitted successfully! We will respond within 24 hours.'
            });
            
        } catch (emailError) {
            console.error('❌ Email sending failed:', emailError);
            
            // Even if email fails, we should log the support request
            console.log('🆘 Support form submission (Email Failed - Logging instead):');
            console.log('From:', name, email);
            console.log('Issue Type:', type);
            console.log('Message:', message);
            
            // Return success to user but indicate potential delay
            res.status(200).json({
                success: true,
                message: 'Support request received! There may be a slight delay in our response.'
            });
        }
        
    } catch (error) {
        console.error('Support form error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit support request. Please try again later.'
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
            to: 'sachinchaunal13@gmail.com',
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
            to: 'sachinchaunal13@gmail.com',
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
