const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// Include PowerShell installer routes
const powershellInstaller = require('./powershell-installer');
router.use(powershellInstaller);

// Email configuration
const createTransporter = () => {
    return nodemailer.createTransporter({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER || 'sachinchaunal13@gmail.com',
            pass: process.env.EMAIL_PASS || 'sdkh pzvj wctu zywe'
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
                message: 'Contact form submitted successfully (development mode - email not sent)',
                data: {
                    name,
                    email,
                    subject,
                    type: type || 'contact',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        const transporter = createTransporter();
        
        // Email to admin
        const adminMailOptions = {
            from: process.env.EMAIL_USER,
            to: 'sachinchaunal@gmail.com',
            subject: `[AutoScroll Contact] ${subject}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #667eea;">📧 New Contact Message</h2>
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>From:</strong> ${name}</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Subject:</strong> ${subject}</p>
                        <p><strong>Type:</strong> ${type || 'General Contact'}</p>
                    </div>
                    <div style="background: #fff; padding: 20px; border-left: 4px solid #667eea;">
                        <h3>Message:</h3>
                        <p style="line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
                    </div>
                    <hr style="margin: 30px 0;">
                    <p style="color: #666; font-size: 12px;">
                        This message was sent from the AutoScroll Extension website contact form.
                        <br>Timestamp: ${new Date().toLocaleString()}
                    </p>
                </div>
            `
        };
        
        // Confirmation email to user
        const userMailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Thank you for contacting AutoScroll Extension',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #667eea;">🚀 Thank you for contacting us!</h2>
                    <p>Hi ${name},</p>
                    <p>We've received your message about "<strong>${subject}</strong>" and we'll get back to you as soon as possible.</p>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>Your Message:</h3>
                        <p style="line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
                    </div>
                    
                    <p>Our typical response time is within 24 hours.</p>
                    
                    <div style="background: linear-gradient(135deg, #667eea, #764ba2); padding: 20px; border-radius: 8px; color: white; text-align: center; margin: 30px 0;">
                        <h3>🎉 Haven't tried AutoScroll Extension yet?</h3>
                        <p>Get your 10-day free trial and enhance your YouTube Shorts experience!</p>
                        <a href="https://autoscrollextension.onrender.com" style="background: #fff; color: #667eea; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Download Now</a>
                    </div>
                    
                    <p>Best regards,<br>AutoScroll Extension Team</p>
                    
                    <hr style="margin: 30px 0;">
                    <p style="color: #666; font-size: 12px;">
                        If you didn't send this message, please ignore this email.
                        <br>AutoScroll Extension - Enhance your browsing experience
                    </p>
                </div>
            `
        };
        
        // Send emails
        await Promise.all([
            transporter.sendMail(adminMailOptions),
            transporter.sendMail(userMailOptions)
        ]);
        
        console.log(`📧 Contact email sent from ${email}: ${subject}`);
        
        res.json({
            success: true,
            message: 'Message sent successfully! We\'ll get back to you soon.'
        });
        
    } catch (error) {
        console.error('Contact email error:', error);
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

        // For local testing, skip email sending and just log the message
        if (process.env.NODE_ENV === 'development') {
            const ticketId = 'TICKET-' + Date.now();
            console.log('🛠️ Support form submission (Development Mode):');
            console.log('Ticket ID:', ticketId);
            console.log('From:', name, email);
            console.log('Issue Type:', type);
            console.log('Message:', message);
            console.log('Request Type:', requestType);
            
            return res.status(200).json({
                success: true,
                message: `Support request submitted successfully (development mode - email not sent). Ticket ID: ${ticketId}`,
                data: {
                    ticketId,
                    name,
                    email,
                    type,
                    requestType: requestType || 'support',
                    timestamp: new Date().toISOString()
                }
            });
        }
        
        const transporter = createTransporter();
        
        // Priority based on issue type
        const priorityMap = {
            payment: 'HIGH',
            functionality: 'HIGH',
            installation: 'MEDIUM',
            bug: 'MEDIUM',
            feature: 'LOW',
            other: 'MEDIUM'
        };
        
        const priority = priorityMap[type] || 'MEDIUM';
        const ticketId = `AS-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        
        // Email to support team
        const supportMailOptions = {
            from: process.env.EMAIL_USER,
            to: 'sachinchaunal@gmail.com',
            subject: `[AutoScroll Support - ${priority}] ${type.toUpperCase()}: ${ticketId}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #e74c3c;">🚨 New Support Request</h2>
                    <div style="background: ${priority === 'HIGH' ? '#ffebee' : priority === 'MEDIUM' ? '#fff3e0' : '#f1f8e9'}; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${priority === 'HIGH' ? '#e74c3c' : priority === 'MEDIUM' ? '#ff9800' : '#4caf50'};">
                        <p><strong>Ticket ID:</strong> ${ticketId}</p>
                        <p><strong>Priority:</strong> <span style="color: ${priority === 'HIGH' ? '#e74c3c' : priority === 'MEDIUM' ? '#ff9800' : '#4caf50'};">${priority}</span></p>
                        <p><strong>Issue Type:</strong> ${type.charAt(0).toUpperCase() + type.slice(1)}</p>
                        <p><strong>From:</strong> ${name} (${email})</p>
                        <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
                    </div>
                    
                    <div style="background: #fff; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                        <h3>Issue Description:</h3>
                        <p style="line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4>Quick Actions:</h4>
                        <p>• Reply to: ${email}</p>
                        <p>• Reference: ${ticketId}</p>
                        <p>• Expected response time: ${priority === 'HIGH' ? '2-4 hours' : priority === 'MEDIUM' ? '4-8 hours' : '24-48 hours'}</p>
                    </div>
                </div>
            `
        };
        
        // Confirmation email to user
        const userMailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: `AutoScroll Support: Your request has been received (${ticketId})`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #667eea;">🛠️ Support Request Received</h2>
                    <p>Hi ${name},</p>
                    <p>We've received your support request and our team is on it!</p>
                    
                    <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2196f3;">
                        <h3>📋 Request Details:</h3>
                        <p><strong>Ticket ID:</strong> ${ticketId}</p>
                        <p><strong>Issue Type:</strong> ${type.charAt(0).toUpperCase() + type.slice(1)}</p>
                        <p><strong>Priority:</strong> ${priority}</p>
                        <p><strong>Expected Response:</strong> ${priority === 'HIGH' ? '2-4 hours' : priority === 'MEDIUM' ? '4-8 hours' : '24-48 hours'}</p>
                    </div>
                    
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4>Your Issue:</h4>
                        <p style="line-height: 1.6;">${message.replace(/\n/g, '<br>')}</p>
                    </div>
                    
                    <div style="background: #fff3e0; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>💡 While you wait, try these quick fixes:</h3>
                        ${getQuickFixes(type)}
                    </div>
                    
                    <p>We'll email you at this address when we have an update.</p>
                    <p>Please keep your ticket ID (<strong>${ticketId}</strong>) for reference.</p>
                    
                    <p>Best regards,<br>AutoScroll Extension Support Team</p>
                    
                    <hr style="margin: 30px 0;">
                    <p style="color: #666; font-size: 12px;">
                        Need urgent help? Reply to this email with your ticket ID.
                        <br>AutoScroll Extension - We're here to help!
                    </p>
                </div>
            `
        };
        
        // Send emails
        await Promise.all([
            transporter.sendMail(supportMailOptions),
            transporter.sendMail(userMailOptions)
        ]);
        
        console.log(`🛠️ Support request received - ${ticketId}: ${type} from ${email}`);
        
        res.json({
            success: true,
            message: `Support request submitted successfully! Ticket ID: ${ticketId}`,
            ticketId: ticketId,
            priority: priority
        });
        
    } catch (error) {
        console.error('Support email error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to submit support request. Please try again later.'
        });
    }
});

// Helper function for quick fixes
function getQuickFixes(issueType) {
    const fixes = {
        installation: `
            <ul>
                <li>✅ Make sure you have Chrome Developer Mode enabled</li>
                <li>✅ Extract the ZIP file completely before loading</li>
                <li>✅ Select the folder (not individual files) when loading unpacked</li>
                <li>✅ Restart Chrome after installation</li>
            </ul>
        `,
        functionality: `
            <ul>
                <li>✅ Make sure you're on YouTube Shorts (not regular videos)</li>
                <li>✅ Try refreshing the YouTube page</li>
                <li>✅ Check if extension is enabled in Chrome toolbar</li>
                <li>✅ Log out and log back into the extension</li>
            </ul>
        `,
        payment: `
            <ul>
                <li>✅ Check your internet connection</li>
                <li>✅ Try a different payment method</li>
                <li>✅ Clear browser cache and cookies</li>
                <li>✅ Disable ad blockers temporarily</li>
            </ul>
        `,
        bug: `
            <ul>
                <li>✅ Try disabling and re-enabling the extension</li>
                <li>✅ Check Chrome console for error messages (F12)</li>
                <li>✅ Test in incognito mode</li>
                <li>✅ Update Chrome to latest version</li>
            </ul>
        `,
        feature: `
            <ul>
                <li>💡 Thank you for your suggestion!</li>
                <li>💡 We review all feature requests carefully</li>
                <li>💡 Popular requests get priority in development</li>
                <li>💡 You'll be notified when new features are released</li>
            </ul>
        `,
        other: `
            <ul>
                <li>✅ Check our documentation and FAQ</li>
                <li>✅ Try restarting your browser</li>
                <li>✅ Make sure extension has latest updates</li>
                <li>✅ Contact us with specific error messages if any</li>
            </ul>
        `
    };
    
    return fixes[issueType] || fixes.other;
}

// Download extension endpoint
router.get('/download-extension', async (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');
        
        // Create Windows installer batch script
        const installerScript = `@echo off
title AutoScroll Extension Installer
color 0A
echo.
echo ===============================================
echo    AutoScroll Extension - Automatic Installer
echo ===============================================
echo.
echo Welcome to AutoScroll Extension installer!
echo This will automatically install the extension for you.
echo.
pause
echo.
echo [INFO] Starting installation process...
echo.

REM Create extension directory in user's Downloads
set "EXTENSION_DIR=%USERPROFILE%\\Downloads\\AutoScrollExtension"
echo [INFO] Creating extension directory: %EXTENSION_DIR%
if not exist "%EXTENSION_DIR%" mkdir "%EXTENSION_DIR%"

REM Create manifest.json
echo [INFO] Creating manifest.json...
(
echo {
echo   "manifest_version": 3,
echo   "name": "AutoScroll Extension",
echo   "version": "1.0.0",
echo   "description": "Automatically scroll through YouTube Shorts for hands-free viewing",
echo   "permissions": [
echo     "storage",
echo     "activeTab",
echo     "identity",
echo     "notifications"
echo   ],
echo   "host_permissions": [
echo     "*://www.youtube.com/*",
echo     "*://autoscrollextension.onrender.com/*"
echo   ],
echo   "background": {
echo     "service_worker": "background.js"
echo   },
echo   "content_scripts": [
echo     {
echo       "matches": ["*://www.youtube.com/*"],
echo       "js": ["content-scripts/youtube.js"],
echo       "run_at": "document_end"
echo     }
echo   ],
echo   "action": {
echo     "default_popup": "popup/popup.html",
echo     "default_title": "AutoScroll Extension",
echo     "default_icon": {
echo       "16": "icons/icon16.png",
echo       "48": "icons/icon48.png",
echo       "128": "icons/icon128.png"
echo     }
echo   },
echo   "icons": {
echo     "16": "icons/icon16.png",
echo     "48": "icons/icon48.png",
echo     "128": "icons/icon128.png"
echo   },
echo   "oauth2": {
echo     "client_id": "your-google-client-id.apps.googleusercontent.com",
echo     "scopes": ["openid", "email", "profile"]
echo   },
echo   "web_accessible_resources": [
echo     {
echo       "resources": ["*"],
echo       "matches": ["<all_urls>"]
echo     }
echo   ]
echo }
) > "%EXTENSION_DIR%\\manifest.json"

REM Create directories
echo [INFO] Creating directory structure...
mkdir "%EXTENSION_DIR%\\popup" 2>nul
mkdir "%EXTENSION_DIR%\\content-scripts" 2>nul
mkdir "%EXTENSION_DIR%\\utils" 2>nul
mkdir "%EXTENSION_DIR%\\icons" 2>nul

REM Create background.js (simplified version)
echo [INFO] Creating background.js...
(
echo // AutoScroll Background Service Worker
echo console.log('AutoScroll Extension loaded'^);
echo.
echo chrome.runtime.onInstalled.addListener(function^(^) {
echo   console.log('AutoScroll Extension installed'^);
echo }^);
echo.
echo chrome.runtime.onMessage.addListener(function^(request, sender, sendResponse^) {
echo   if ^(request.action === 'test'^) {
echo     sendResponse^({success: true}^);
echo   }
echo }^);
) > "%EXTENSION_DIR%\\background.js"

REM Create popup files
echo [INFO] Creating popup interface...
(
echo ^<!DOCTYPE html^>
echo ^<html^>
echo ^<head^>
echo   ^<meta charset="UTF-8"^>
echo   ^<title^>AutoScroll^</title^>
echo   ^<style^>
echo     body { width: 300px; padding: 20px; font-family: Arial; }
echo     .header { text-align: center; margin-bottom: 20px; }
echo     .btn { width: 100%%; padding: 10px; margin: 5px 0; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; }
echo     .btn:hover { background: #45a049; }
echo   ^</style^>
echo ^</head^>
echo ^<body^>
echo   ^<div class="header"^>
echo     ^<h2^>🚀 AutoScroll^</h2^>
echo     ^<p^>YouTube Shorts Auto-Scrolling^</p^>
echo   ^</div^>
echo   ^<button class="btn" id="startBtn"^>Start AutoScroll^</button^>
echo   ^<button class="btn" id="stopBtn"^>Stop AutoScroll^</button^>
echo   ^<script src="popup.js"^>^</script^>
echo ^</body^>
echo ^</html^>
) > "%EXTENSION_DIR%\\popup\\popup.html"

(
echo // AutoScroll Popup Script
echo document.addEventListener('DOMContentLoaded', function^(^) {
echo   document.getElementById('startBtn'^).addEventListener('click', function^(^) {
echo     chrome.tabs.query^({active: true, currentWindow: true}, function^(tabs^) {
echo       chrome.tabs.sendMessage^(tabs[0].id, {action: 'start'}^);
echo     }^);
echo   }^);
echo   
echo   document.getElementById('stopBtn'^).addEventListener('click', function^(^) {
echo     chrome.tabs.query^({active: true, currentWindow: true}, function^(tabs^) {
echo       chrome.tabs.sendMessage^(tabs[0].id, {action: 'stop'}^);
echo     }^);
echo   }^);
echo }^);
) > "%EXTENSION_DIR%\\popup\\popup.js"

REM Create content script (basic version)
echo [INFO] Creating content script...
(
echo // AutoScroll Content Script for YouTube Shorts
echo let isAutoScrolling = false;
echo.
echo chrome.runtime.onMessage.addListener^(function^(request, sender, sendResponse^) {
echo   if ^(request.action === 'start'^) {
echo     startAutoScroll^(^);
echo     sendResponse^({success: true}^);
echo   } else if ^(request.action === 'stop'^) {
echo     stopAutoScroll^(^);
echo     sendResponse^({success: true}^);
echo   }
echo }^);
echo.
echo function startAutoScroll^(^) {
echo   if ^(window.location.href.includes^('/shorts/'^)^) {
echo     isAutoScrolling = true;
echo     console.log^('AutoScroll started for YouTube Shorts'^);
echo     // Add your autoscroll logic here
echo   } else {
echo     alert^('Please go to YouTube Shorts to use AutoScroll'^);
echo   }
echo }
echo.
echo function stopAutoScroll^(^) {
echo   isAutoScrolling = false;
echo   console.log^('AutoScroll stopped'^);
echo }
) > "%EXTENSION_DIR%\\content-scripts\\youtube.js"

REM Create placeholder icons (text files for now)
echo [INFO] Creating icon placeholders...
echo Icon 16x16 > "%EXTENSION_DIR%\\icons\\icon16.png"
echo Icon 48x48 > "%EXTENSION_DIR%\\icons\\icon48.png"
echo Icon 128x128 > "%EXTENSION_DIR%\\icons\\icon128.png"

REM Create installation instructions
echo [INFO] Creating installation guide...
(
echo AutoScroll Extension - Installation Instructions
echo ===============================================
echo.
echo AUTOMATIC INSTALLATION STEPS:
echo.
echo 1. The extension files have been created in:
echo    %EXTENSION_DIR%
echo.
echo 2. Now we'll open Chrome Extensions page for you...
echo.
) > "%EXTENSION_DIR%\\INSTALLATION_GUIDE.txt"

echo [SUCCESS] Extension files created successfully!
echo.
echo [INFO] Opening Chrome Extensions page...
echo [INFO] You need to:
echo   1. Enable "Developer mode" (toggle in top-right)
echo   2. Click "Load unpacked"
echo   3. Select the folder: %EXTENSION_DIR%
echo.

REM Open Chrome Extensions page
start chrome://extensions/

echo.
echo [INFO] Opening extension folder...
explorer "%EXTENSION_DIR%"

echo.
echo ===============================================
echo Installation completed! Follow the steps above.
echo ===============================================
echo.
echo Press any key to close this installer...
pause >nul
`;

        // Set headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="AutoScroll-Extension-Installer.bat"');
        
        // Send the installer script
        res.send(installerScript);
        
        console.log('📥 AutoScroll Extension installer downloaded');
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create installer'
        });
    }
});

module.exports = router;
