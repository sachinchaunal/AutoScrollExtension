const express = require('express');
const router = express.Router();

// Alternative PowerShell installer endpoint
router.get('/download-installer-ps1', async (req, res) => {
    try {
        // Create PowerShell installer script
        const powershellInstaller = `# AutoScroll Extension - PowerShell Installer
# This script automatically installs the AutoScroll Extension for Chrome

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "   AutoScroll Extension - Automatic Installer" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Welcome to AutoScroll Extension installer!" -ForegroundColor Yellow
Write-Host "This will automatically install the extension for you." -ForegroundColor White
Write-Host ""

# Pause for user confirmation
Read-Host "Press Enter to continue"

Write-Host ""
Write-Host "[INFO] Starting installation process..." -ForegroundColor Green
Write-Host ""

# Create extension directory in user's Downloads
$ExtensionDir = "$env:USERPROFILE\\Downloads\\AutoScrollExtension"
Write-Host "[INFO] Creating extension directory: $ExtensionDir" -ForegroundColor Blue

if (!(Test-Path $ExtensionDir)) {
    New-Item -ItemType Directory -Path $ExtensionDir -Force | Out-Null
}

# Create manifest.json
Write-Host "[INFO] Creating manifest.json..." -ForegroundColor Blue
$manifestContent = @'
{
  "manifest_version": 3,
  "name": "AutoScroll Extension",
  "version": "1.0.0",
  "description": "Automatically scroll through YouTube Shorts for hands-free viewing",
  "permissions": [
    "storage",
    "activeTab",
    "identity",
    "notifications"
  ],
  "host_permissions": [
    "*://www.youtube.com/*",
    "*://autoscrollextension.onrender.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["*://www.youtube.com/*"],
      "js": ["content-scripts/youtube.js"],
      "run_at": "document_end"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "AutoScroll Extension",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "oauth2": {
    "client_id": "your-google-client-id.apps.googleusercontent.com",
    "scopes": ["openid", "email", "profile"]
  },
  "web_accessible_resources": [
    {
      "resources": ["*"],
      "matches": ["<all_urls>"]
    }
  ]
}
'@

$manifestContent | Out-File -FilePath "$ExtensionDir\\manifest.json" -Encoding UTF8

# Create directories
Write-Host "[INFO] Creating directory structure..." -ForegroundColor Blue
New-Item -ItemType Directory -Path "$ExtensionDir\\popup" -Force | Out-Null
New-Item -ItemType Directory -Path "$ExtensionDir\\content-scripts" -Force | Out-Null
New-Item -ItemType Directory -Path "$ExtensionDir\\utils" -Force | Out-Null
New-Item -ItemType Directory -Path "$ExtensionDir\\icons" -Force | Out-Null

# Create background.js
Write-Host "[INFO] Creating background.js..." -ForegroundColor Blue
$backgroundContent = @'
// AutoScroll Background Service Worker
console.log('AutoScroll Extension loaded');

chrome.runtime.onInstalled.addListener(function() {
  console.log('AutoScroll Extension installed');
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'test') {
    sendResponse({success: true});
  }
});
'@

$backgroundContent | Out-File -FilePath "$ExtensionDir\\background.js" -Encoding UTF8

# Create popup HTML
Write-Host "[INFO] Creating popup interface..." -ForegroundColor Blue
$popupHtml = @'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AutoScroll</title>
  <style>
    body { width: 300px; padding: 20px; font-family: Arial, sans-serif; }
    .header { text-align: center; margin-bottom: 20px; }
    .btn { width: 100%; padding: 12px; margin: 8px 0; background: #4CAF50; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; }
    .btn:hover { background: #45a049; }
    .btn:disabled { background: #cccccc; cursor: not-allowed; }
    .status { text-align: center; margin: 10px 0; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h2>🚀 AutoScroll</h2>
    <p>YouTube Shorts Auto-Scrolling</p>
  </div>
  <div class="status" id="status">Ready to scroll!</div>
  <button class="btn" id="startBtn">Start AutoScroll</button>
  <button class="btn" id="stopBtn">Stop AutoScroll</button>
  <script src="popup.js"></script>
</body>
</html>
'@

$popupHtml | Out-File -FilePath "$ExtensionDir\\popup\\popup.html" -Encoding UTF8

# Create popup JS
$popupJs = @'
// AutoScroll Popup Script
document.addEventListener('DOMContentLoaded', function() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const status = document.getElementById('status');
  
  startBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'start'}, function(response) {
        if (response && response.success) {
          status.textContent = 'AutoScroll started!';
          status.style.color = '#4CAF50';
        }
      });
    });
  });
  
  stopBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: 'stop'}, function(response) {
        if (response && response.success) {
          status.textContent = 'AutoScroll stopped!';
          status.style.color = '#f44336';
        }
      });
    });
  });
});
'@

$popupJs | Out-File -FilePath "$ExtensionDir\\popup\\popup.js" -Encoding UTF8

# Create content script
Write-Host "[INFO] Creating content script..." -ForegroundColor Blue
$contentScript = @'
// AutoScroll Content Script for YouTube Shorts
let isAutoScrolling = false;
let scrollInterval;

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'start') {
    startAutoScroll();
    sendResponse({success: true});
  } else if (request.action === 'stop') {
    stopAutoScroll();
    sendResponse({success: true});
  }
});

function startAutoScroll() {
  if (window.location.href.includes('/shorts/')) {
    isAutoScrolling = true;
    console.log('AutoScroll started for YouTube Shorts');
    
    // Basic auto-scroll functionality
    scrollInterval = setInterval(() => {
      if (isAutoScrolling) {
        // Simulate arrow down key press for YouTube Shorts
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          keyCode: 40,
          which: 40,
          bubbles: true
        });
        document.dispatchEvent(event);
      }
    }, 10000); // Scroll every 10 seconds
    
  } else {
    alert('Please go to YouTube Shorts to use AutoScroll!');
  }
}

function stopAutoScroll() {
  isAutoScrolling = false;
  if (scrollInterval) {
    clearInterval(scrollInterval);
  }
  console.log('AutoScroll stopped');
}
'@

$contentScript | Out-File -FilePath "$ExtensionDir\\content-scripts\\youtube.js" -Encoding UTF8

# Create placeholder icons (simple text files for now)
Write-Host "[INFO] Creating icon placeholders..." -ForegroundColor Blue
"Icon 16x16" | Out-File -FilePath "$ExtensionDir\\icons\\icon16.png" -Encoding UTF8
"Icon 48x48" | Out-File -FilePath "$ExtensionDir\\icons\\icon48.png" -Encoding UTF8  
"Icon 128x128" | Out-File -FilePath "$ExtensionDir\\icons\\icon128.png" -Encoding UTF8

# Create installation guide
Write-Host "[INFO] Creating installation guide..." -ForegroundColor Blue
$installGuide = @"
AutoScroll Extension - Installation Instructions
===============================================

AUTOMATIC INSTALLATION COMPLETED!

The extension files have been created in:
$ExtensionDir

NEXT STEPS:
1. Chrome Extensions page will open automatically
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked" button
4. Select the folder: $ExtensionDir
5. The extension will be installed and ready to use!

HOW TO USE:
1. Go to YouTube Shorts (youtube.com/shorts)
2. Click the AutoScroll extension icon in your toolbar
3. Click "Start AutoScroll"
4. Enjoy hands-free viewing!

SUPPORT:
Website: https://autoscrollextension.onrender.com
Email: sachinchaunal@gmail.com

Installation completed successfully!
"@

$installGuide | Out-File -FilePath "$ExtensionDir\\INSTALLATION_GUIDE.txt" -Encoding UTF8

Write-Host ""
Write-Host "[SUCCESS] Extension files created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "[INFO] Opening Chrome Extensions page..." -ForegroundColor Yellow
Write-Host "[INFO] You need to:" -ForegroundColor White
Write-Host "  1. Enable 'Developer mode' (toggle in top-right)" -ForegroundColor White
Write-Host "  2. Click 'Load unpacked'" -ForegroundColor White
Write-Host "  3. Select the folder: $ExtensionDir" -ForegroundColor White
Write-Host ""

# Open Chrome Extensions page
Start-Process "chrome://extensions/"

Write-Host "[INFO] Opening extension folder..." -ForegroundColor Blue
Start-Process "explorer.exe" -ArgumentList $ExtensionDir

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "Installation completed! Follow the steps above." -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to close this installer..." -ForegroundColor Yellow
Read-Host
`;

        // Set headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="AutoScroll-Extension-Installer.ps1"');
        
        // Send the PowerShell installer script
        res.send(powershellInstaller);
        
        console.log('📥 AutoScroll Extension PowerShell installer downloaded');
        
    } catch (error) {
        console.error('PowerShell installer error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create PowerShell installer'
        });
    }
});

module.exports = router;
