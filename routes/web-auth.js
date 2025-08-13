const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// OAuth client configuration
const client = new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:3000'}/auth/callback`
});

// Google OAuth login route
router.get('/google', (req, res) => {
    try {
        const responseType = req.query.response_type || 'code';
        const state = req.query.state;
        
        if (responseType === 'token') {
            // Implicit flow for web extension - redirect to Google with token response
            const params = new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                response_type: 'token',
                redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${process.env.API_BASE_URL || 'http://localhost:3000'}/auth/callback`,
                scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
                state: state || 'web_auth'
            });
            
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
            res.redirect(authUrl);
        } else {
            // Authorization code flow for backend OAuth
            const authUrl = client.generateAuthUrl({
                access_type: 'offline',
                scope: [
                    'https://www.googleapis.com/auth/userinfo.profile',
                    'https://www.googleapis.com/auth/userinfo.email'
                ],
                prompt: 'consent',
                state: state
            });

            res.redirect(authUrl);
        }
    } catch (error) {
        console.error('Google auth URL generation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate authentication URL' 
        });
    }
});

// Google OAuth callback route
router.get('/callback', async (req, res) => {
    try {
        const { code, access_token, state } = req.query;
        let accessToken = access_token;
        let googleUser = null;

        if (code) {
            // Authorization code flow
            const { tokens } = await client.getToken(code);
            client.setCredentials(tokens);
            accessToken = tokens.access_token;
        } else if (!access_token) {
            // Check URL fragment for implicit flow tokens
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Processing Authentication</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>🔄 Processing Authentication</h1>
                    <p>Please wait while we process your authentication...</p>
                    <script>
                        // Extract token from URL fragment for implicit flow
                        const fragment = window.location.hash.substring(1);
                        const params = new URLSearchParams(fragment);
                        const token = params.get('access_token');
                        const error = params.get('error');
                        
                        if (token) {
                            // Redirect to callback with token as query parameter
                            window.location.href = '/auth/callback?access_token=' + token + '&state=' + (params.get('state') || '');
                        } else if (error) {
                            document.body.innerHTML = '<h1>❌ Authentication Error</h1><p>Error: ' + error + '</p>';
                            setTimeout(() => window.close(), 3000);
                        } else {
                            document.body.innerHTML = '<h1>❌ No Token Found</h1><p>Authentication failed - no token received</p>';
                            setTimeout(() => window.close(), 3000);
                        }
                    </script>
                </body>
                </html>
            `);
        }

        if (!accessToken) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Error</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>❌ Authentication Error</h1>
                    <p>No authorization code or access token received from Google.</p>
                    <script>
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
                </html>
            `);
        }

        // Get user info from Google
        const response = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessToken}`);
        googleUser = await response.json();

        if (!googleUser.email) {
            throw new Error('Failed to get user email from Google');
        }

        // Find or create user in database
        let user = await User.findOne({ email: googleUser.email });

        if (!user) {
            // Create new user
            user = new User({
                email: googleUser.email,
                name: googleUser.name || 'Unknown User',
                picture: googleUser.picture || '',
                googleId: googleUser.id,
                provider: 'google',
                isActive: true
            });

            await user.save();
            console.log('New user created:', user.email);
        } else {
            // Update existing user info
            user.name = googleUser.name || user.name;
            user.picture = googleUser.picture || user.picture;
            user.lastLogin = new Date();
            user.isActive = true;

            await user.save();
            console.log('Existing user updated:', user.email);
        }

        // Generate JWT token
        const jwtToken = jwt.sign(
            { 
                userId: user._id, 
                email: user.email
            },
            process.env.JWT_SECRET || 'fallback-secret',
            { expiresIn: '24h' }
        );

        // Set session data
        req.session.user = {
            id: user._id,
            email: user.email,
            name: user.name,
            picture: user.picture
        };
        req.session.token = jwtToken;

        // Check if this is an implicit flow request (from web extension)
        const isWebExtension = state && state.includes('web_auth');
        
        if (isWebExtension) {
            // For implicit flow, show success page with token in hash
            res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>✅ Authentication Successful!</h1>
                    <p>You can close this window and return to the extension.</p>
                    <script>
                        // Store token globally for script injection
                        window.extractedToken = '${accessToken}';
                        
                        // Send success message to parent window (extension)
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'GOOGLE_AUTH_SUCCESS',
                                user: {
                                    id: '${user._id}',
                                    email: '${user.email}',
                                    name: '${user.name}',
                                    picture: '${user.picture}'
                                },
                                token: '${jwtToken}',
                                userId: '${user._id}'
                            }, '*');
                        }
                        
                        // Auto-close after 2 seconds
                        setTimeout(() => {
                            window.close();
                        }, 2000);
                    </script>
                </body>
                </html>
            `);
        } else {
            // Regular authorization code flow - send success response
            res.send(`
                <!DOCTYPE html>
                <html>
                <head><title>Authentication Successful</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>✅ Authentication Successful!</h1>
                    <p>You can close this window.</p>
                    <script>
                        // Send success message to parent window
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'GOOGLE_AUTH_SUCCESS',
                                user: {
                                    id: '${user._id}',
                                    email: '${user.email}',
                                    name: '${user.name}',
                                    picture: '${user.picture}'
                                },
                                token: '${jwtToken}',
                                userId: '${user._id}'
                            }, '*');
                        }
                        
                        // Auto-close after 2 seconds
                        setTimeout(() => {
                            window.close();
                        }, 2000);
                    </script>
                </body>
                </html>
            `);
        }

    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>Authentication Error</title></head>
            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1>❌ Authentication Failed</h1>
                <p>Error: ${error.message}</p>
                <script>
                    setTimeout(() => window.close(), 5000);
                </script>
            </body>
            </html>
        `);
    }
});

// Get current user route
router.get('/me', (req, res) => {
    try {
        if (req.session && req.session.user) {
            res.json({
                success: true,
                data: {
                    user: req.session.user,
                    token: req.session.token,
                    userId: req.session.user.id
                }
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Not authenticated'
            });
        }
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user data'
        });
    }
});

// Logout route
router.post('/logout', (req, res) => {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to logout'
                });
            }
            
            res.clearCookie('connect.sid');
            res.json({
                success: true,
                message: 'Logged out successfully'
            });
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to logout'
        });
    }
});

module.exports = router;
