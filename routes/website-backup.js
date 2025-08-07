const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// Include PowerShell installer routes
const powershellInstaller = require('./powershell-installer');
router.use(powershellInstaller);

// Email configuration
const createTransporter = () => {
    return nodemailer.createTransport({
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

// Download extension endpoint - Enhanced Windows Installer
router.get('/download-extension', async (req, res) => {
    try {
        const installerScript = `@echo off
title AutoScroll Extension - Professional Installer
color 0A
echo.
echo ===============================================
echo    AutoScroll Extension - Professional Installer
echo ===============================================
echo.
echo Welcome to AutoScroll Extension installer!
echo This will install the complete extension with all features.
echo.
echo ✅ Features included:
echo   • YouTube Shorts Auto-scrolling
echo   • Google Authentication
echo   • Subscription Management
echo   • Premium Features
echo.
pause
echo.

REM Check if Chrome is installed
echo [INFO] Checking Chrome installation...
where chrome >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Google Chrome not found!
    echo Please install Google Chrome first.
    echo Download from: https://www.google.com/chrome/
    pause
    exit /b 1
)
echo [SUCCESS] Chrome found!
echo.

REM Create extension directory in Downloads with timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set timestamp=%datetime:~0,8%_%datetime:~8,6%
set "EXTENSION_DIR=%USERPROFILE%\\Downloads\\AutoScrollExtension_%timestamp%"

echo [INFO] Creating extension directory: %EXTENSION_DIR%
if not exist "%EXTENSION_DIR%" mkdir "%EXTENSION_DIR%"

REM Check if directory was created
if not exist "%EXTENSION_DIR%" (
    echo [ERROR] Failed to create directory!
    pause
    exit /b 1
)

REM Download extension files from server
echo [INFO] Downloading extension files from server...
echo This may take a moment...

REM Create subdirectories
mkdir "%EXTENSION_DIR%\\popup" 2>nul
mkdir "%EXTENSION_DIR%\\content-scripts" 2>nul
mkdir "%EXTENSION_DIR%\\utils" 2>nul
mkdir "%EXTENSION_DIR%\\icons" 2>nul

REM Create a PowerShell script to download files
(
echo $ProgressPreference = 'SilentlyContinue'
echo $baseUrl = "https://autoscrollextension.onrender.com"
echo $extensionDir = "%EXTENSION_DIR%"
echo.
echo Write-Host "[INFO] Downloading extension files..." -ForegroundColor Green
echo Write-Host "This may take a moment depending on your internet connection..." -ForegroundColor Yellow
echo.
echo try {
echo     # Download main files
echo     Write-Host "Downloading manifest.json..." -ForegroundColor Cyan
echo     Invoke-WebRequest -Uri "$baseUrl/extension/manifest.json" -OutFile "$extensionDir\\manifest.json" -ErrorAction Stop
echo     Write-Host "✅ Downloaded manifest.json" -ForegroundColor Green
echo.
echo     Write-Host "Downloading background.js..." -ForegroundColor Cyan
echo     Invoke-WebRequest -Uri "$baseUrl/extension/background.js" -OutFile "$extensionDir\\background.js" -ErrorAction Stop
echo     Write-Host "✅ Downloaded background.js" -ForegroundColor Green
echo.
echo     # Download popup files
echo     Write-Host "Downloading popup files..." -ForegroundColor Cyan
echo     Invoke-WebRequest -Uri "$baseUrl/extension/popup/popup.html" -OutFile "$extensionDir\\popup\\popup.html" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/popup/popup.js" -OutFile "$extensionDir\\popup\\popup.js" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/popup/popup.css" -OutFile "$extensionDir\\popup\\popup.css" -ErrorAction Stop
echo     Write-Host "✅ Downloaded popup files" -ForegroundColor Green
echo.
echo     # Download content scripts
echo     Write-Host "Downloading content scripts..." -ForegroundColor Cyan
echo     Invoke-WebRequest -Uri "$baseUrl/extension/content-scripts/youtube.js" -OutFile "$extensionDir\\content-scripts\\youtube.js" -ErrorAction Stop
echo     Write-Host "✅ Downloaded content scripts" -ForegroundColor Green
echo.
echo     # Download utilities
echo     Write-Host "Downloading utilities..." -ForegroundColor Cyan
echo     Invoke-WebRequest -Uri "$baseUrl/extension/utils/googleAuth.js" -OutFile "$extensionDir\\utils\\googleAuth.js" -ErrorAction Stop
echo     Write-Host "✅ Downloaded utilities" -ForegroundColor Green
echo.
echo     # Download icons
echo     Write-Host "Downloading icons..." -ForegroundColor Cyan
echo     Invoke-WebRequest -Uri "$baseUrl/extension/icons/icon16.png" -OutFile "$extensionDir\\icons\\icon16.png" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/icons/icon48.png" -OutFile "$extensionDir\\icons\\icon48.png" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/icons/icon128.png" -OutFile "$extensionDir\\icons\\icon128.png" -ErrorAction Stop
echo     Write-Host "✅ Downloaded icons" -ForegroundColor Green
echo.
echo     Write-Host "[SUCCESS] All extension files downloaded successfully!" -ForegroundColor Green
echo     Write-Host "Extension installed to: $extensionDir" -ForegroundColor Yellow
echo } catch {
echo     Write-Host "[ERROR] Failed to download files: $_" -ForegroundColor Red
echo     Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
echo     Write-Host "If the problem persists, contact support at sachinchaunal@gmail.com" -ForegroundColor Yellow
echo     exit 1
echo }
) > "%TEMP%\\download_extension.ps1"

REM Execute PowerShell script
echo [INFO] Executing download...
powershell -ExecutionPolicy Bypass -File "%TEMP%\\download_extension.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Download failed!
    echo Please check your internet connection and try again.
    echo If the problem persists, contact support.
    pause
    exit /b 1
)

REM Clean up temporary script
del "%TEMP%\\download_extension.ps1" 2>nul

echo.
echo [SUCCESS] Extension files downloaded successfully!
echo Location: %EXTENSION_DIR%
echo.

REM Verify files were downloaded
echo [INFO] Verifying downloaded files...
if not exist "%EXTENSION_DIR%\\manifest.json" (
    echo [ERROR] manifest.json not found!
    goto :error
)
if not exist "%EXTENSION_DIR%\\background.js" (
    echo [ERROR] background.js not found!
    goto :error
)
echo [SUCCESS] Core files verified!

REM Create installation guide
echo [INFO] Creating installation guide...
(
echo AutoScroll Extension - Installation Guide
echo ========================================
echo.
echo INSTALLATION STEPS:
echo.
echo 1. Chrome Extensions page will open automatically
echo.
echo 2. Enable "Developer mode":
echo    - Look for the toggle in the top-right corner
echo    - Click to enable it
echo.
echo 3. Click "Load unpacked" button
echo.
echo 4. Select this folder:
echo    %EXTENSION_DIR%
echo.
echo 5. The extension will be installed and ready to use!
echo.
echo USAGE:
echo - Visit YouTube Shorts
echo - Click the extension icon in your browser
echo - Sign in with Google for premium features
echo - Enjoy automatic scrolling!
echo.
echo FEATURES:
echo - 10-day free trial
echo - Unlimited auto-scrolling after subscription
echo - Premium support
echo.
echo SUPPORT:
echo - Website: https://autoscrollextension.onrender.com
echo - Email: sachinchaunal@gmail.com
echo.
echo Thank you for using AutoScroll Extension!
) > "%EXTENSION_DIR%\\INSTALLATION_GUIDE.txt"

echo [INFO] Opening Chrome Extensions page...
echo.
echo ⚡ IMPORTANT STEPS:
echo   1. Enable "Developer mode" (toggle in top-right)
echo   2. Click "Load unpacked" 
echo   3. Select folder: %EXTENSION_DIR%
echo.

REM Open Chrome Extensions page
start chrome://extensions/

REM Wait a moment then open the extension folder
timeout /t 3 /nobreak >nul
echo [INFO] Opening extension folder...
explorer "%EXTENSION_DIR%"

echo.
echo ===============================================
echo ✅ Installation completed successfully!
echo.
echo Next steps:
echo 1. Follow the instructions in Chrome
echo 2. Load the extension from the opened folder
echo 3. Enjoy AutoScroll on YouTube Shorts!
echo.
echo Extension location: %EXTENSION_DIR%
echo ===============================================
echo.
echo Press any key to close this installer...
pause >nul
goto :end

:error
echo.
echo ===============================================
echo ❌ Installation failed!
echo.
echo Please try the following:
echo 1. Check your internet connection
echo 2. Disable antivirus temporarily
echo 3. Run as administrator
echo 4. Contact support: sachinchaunal@gmail.com
echo ===============================================
echo.
pause
exit /b 1

:end
exit /b 0
`;

        // Set headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="AutoScroll-Extension-Installer.bat"');
        
        // Send the installer script
        res.send(installerScript);
        
        console.log('📥 Enhanced AutoScroll Extension installer downloaded');
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create installer'
        });
    }
});
echo # Download main files
echo try {
echo     Invoke-WebRequest -Uri "$baseUrl/extension/manifest.json" -OutFile "$extensionDir\\manifest.json" -ErrorAction Stop
echo     Write-Host "✅ Downloaded manifest.json" -ForegroundColor Green
echo.
echo     Invoke-WebRequest -Uri "$baseUrl/extension/background.js" -OutFile "$extensionDir\\background.js" -ErrorAction Stop
echo     Write-Host "✅ Downloaded background.js" -ForegroundColor Green
echo.
echo     # Download popup files
echo     Invoke-WebRequest -Uri "$baseUrl/extension/popup/popup.html" -OutFile "$extensionDir\\popup\\popup.html" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/popup/popup.js" -OutFile "$extensionDir\\popup\\popup.js" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/popup/popup.css" -OutFile "$extensionDir\\popup\\popup.css" -ErrorAction Stop
echo     Write-Host "✅ Downloaded popup files" -ForegroundColor Green
echo.
echo     # Download content scripts
echo     Invoke-WebRequest -Uri "$baseUrl/extension/content-scripts/youtube.js" -OutFile "$extensionDir\\content-scripts\\youtube.js" -ErrorAction Stop
echo     Write-Host "✅ Downloaded content scripts" -ForegroundColor Green
echo.
echo     # Download utilities
echo     Invoke-WebRequest -Uri "$baseUrl/extension/utils/googleAuth.js" -OutFile "$extensionDir\\utils\\googleAuth.js" -ErrorAction Stop
echo     Write-Host "✅ Downloaded utilities" -ForegroundColor Green
echo.
echo     # Download icons
echo     Invoke-WebRequest -Uri "$baseUrl/extension/icons/icon16.png" -OutFile "$extensionDir\\icons\\icon16.png" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/icons/icon48.png" -OutFile "$extensionDir\\icons\\icon48.png" -ErrorAction Stop
echo     Invoke-WebRequest -Uri "$baseUrl/extension/icons/icon128.png" -OutFile "$extensionDir\\icons\\icon128.png" -ErrorAction Stop
echo     Write-Host "✅ Downloaded icons" -ForegroundColor Green
echo.
echo     Write-Host "[SUCCESS] All extension files downloaded successfully!" -ForegroundColor Green
echo } catch {
echo     Write-Host "[ERROR] Failed to download files: $_" -ForegroundColor Red
echo     Write-Host "Please check your internet connection and try again." -ForegroundColor Yellow
echo     exit 1
echo }
) > "%TEMP%\\download_extension.ps1"

REM Execute PowerShell script
echo [INFO] Executing download...
powershell -ExecutionPolicy Bypass -File "%TEMP%\\download_extension.ps1"

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Download failed!
    echo Please check your internet connection and try again.
    pause
    exit /b 1
)

REM Clean up temporary script
del "%TEMP%\\download_extension.ps1" 2>nul

echo.
echo [SUCCESS] Extension files downloaded successfully!
echo.

REM Create installation guide
echo [INFO] Creating installation guide...
(
echo AutoScroll Extension - Installation Guide
echo ========================================
echo.
echo INSTALLATION STEPS:
echo.
echo 1. Chrome Extensions page will open automatically
echo.
echo 2. Enable "Developer mode":
echo    - Look for the toggle in the top-right corner
echo    - Click to enable it
echo.
echo 3. Click "Load unpacked" button
echo.
echo 4. Select this folder:
echo    %EXTENSION_DIR%
echo.
echo 5. The extension will be installed and ready to use!
echo.
echo USAGE:
echo - Visit YouTube Shorts
echo - Click the extension icon in your browser
echo - Enjoy automatic scrolling!
echo.
echo SUPPORT:
echo - Website: https://autoscrollextension.onrender.com
echo - Contact: sachinchaunal@gmail.com
echo.
echo Thank you for using AutoScroll Extension!
) > "%EXTENSION_DIR%\\INSTALLATION_GUIDE.txt"

echo [INFO] Opening Chrome Extensions page...
echo.
echo ⚡ IMPORTANT STEPS:
echo   1. Enable "Developer mode" (toggle in top-right)
echo   2. Click "Load unpacked" 
echo   3. Select folder: %EXTENSION_DIR%
echo.

REM Open Chrome Extensions page
start chrome://extensions/

REM Wait a moment then open the extension folder
timeout /t 2 /nobreak >nul
echo [INFO] Opening extension folder...
explorer "%EXTENSION_DIR%"

echo.
echo ===============================================
echo ✅ Installation completed successfully!
echo.
echo Next steps:
echo 1. Follow the instructions in Chrome
echo 2. Load the extension from the opened folder
echo 3. Enjoy AutoScroll on YouTube Shorts!
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
        
        console.log('📥 Enhanced AutoScroll Extension installer downloaded');
        
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create installer'
        });
    }
});

module.exports = router;
