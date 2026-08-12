// Cognito Configuration
const poolData = {
    UserPoolId: 'ca-central-1_NHVo7D7Kw',
    ClientId: '1bba66drbfqk7rgnq0h13mf56l'
};

const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
let currentUser = null;

// Switch between login and signup tabs
function switchTab(tab) {
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const showLogin = tab === 'login';
    
    if (showLogin) {
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
    } else {
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
        signupForm.classList.add('active');
        loginForm.classList.remove('active');
    }

    loginTab.setAttribute('aria-selected', String(showLogin));
    signupTab.setAttribute('aria-selected', String(!showLogin));
    loginTab.tabIndex = showLogin ? 0 : -1;
    signupTab.tabIndex = showLogin ? -1 : 0;
    
    hideMessages();
}

// Show error message
function showError(message) {
    const errorDiv = document.getElementById('error-message');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('success-message').style.display = 'none';
}

// Show success message
function showSuccess(message) {
    const successDiv = document.getElementById('success-message');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('error-message').style.display = 'none';
}

// Hide messages
function hideMessages() {
    document.getElementById('error-message').style.display = 'none';
    document.getElementById('success-message').style.display = 'none';
}

// Handle Login
async function handleLogin(event) {
    event.preventDefault();
    hideMessages();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const loginBtn = document.getElementById('login-btn');
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    
    try {
        const response = await fetch('https://cognito-idp.ca-central-1.amazonaws.com/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth'
            },
            body: JSON.stringify({
                AuthFlow: 'USER_PASSWORD_AUTH',
                ClientId: '1bba66drbfqk7rgnq0h13mf56l',
                AuthParameters: {
                    USERNAME: email,
                    PASSWORD: password
                }
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || data.__type || 'Login failed');
        }
        
        if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            // User needs to set a new password
            sessionStorage.setItem('tempSession', data.Session);
            sessionStorage.setItem('tempEmail', email);
            showNewPasswordForm();
            loginBtn.disabled = false;
            loginBtn.textContent = 'Sign in';
            return;
        }
        
        // Store tokens
        sessionStorage.setItem('accessToken', data.AuthenticationResult.AccessToken);
        sessionStorage.setItem('idToken', data.AuthenticationResult.IdToken);
        sessionStorage.setItem('userEmail', email);
        
        // Redirect to hub
        window.location.href = 'hub.html';
        
    } catch (error) {
        console.error('Login failed:', error);
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign in';
        
        // Check for common approval-related errors
        if (error.message && (error.message.includes('not confirmed') || error.message.includes('UserNotConfirmedException'))) {
            showError('Your account is pending admin approval. Please wait for approval before logging in.');
        } else if (error.message && (error.message.includes('disabled') || error.message.includes('User is disabled'))) {
            showError('Your account is pending admin approval. An administrator will enable your account shortly.');
        } else {
            showError(error.message || 'Login failed. Please check your credentials.');
        }
    }
}

// Show new password form
function showNewPasswordForm() {
    const loginForm = document.getElementById('login-form');
    loginForm.innerHTML = `
        <h3 style="margin-bottom: 20px; color: #2d3748;">Set New Password</h3>
        <p style="margin-bottom: 20px; color: #718096;">You need to set a new password before continuing.</p>
        <div class="form-group">
            <label for="new-password">New Password</label>
            <input type="password" id="new-password" required placeholder="Minimum 8 characters" minlength="8">
        </div>
        <div class="form-group">
            <label for="confirm-new-password">Confirm New Password</label>
            <input type="password" id="confirm-new-password" required placeholder="Re-enter password">
        </div>
        <button type="button" onclick="handleNewPassword()" class="auth-button">Set Password</button>
    `;
}

// Handle new password setting
async function handleNewPassword() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    
    if (newPassword !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    if (newPassword.length < 8) {
        showError('Password must be at least 8 characters long');
        return;
    }
    
    const session = sessionStorage.getItem('tempSession');
    const email = sessionStorage.getItem('tempEmail');
    
    try {
        const response = await fetch('https://cognito-idp.ca-central-1.amazonaws.com/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-amz-json-1.1',
                'X-Amz-Target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge'
            },
            body: JSON.stringify({
                ChallengeName: 'NEW_PASSWORD_REQUIRED',
                ClientId: '1bba66drbfqk7rgnq0h13mf56l',
                ChallengeResponses: {
                    USERNAME: email,
                    NEW_PASSWORD: newPassword
                },
                Session: session
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to set new password');
        }
        
        // Store tokens
        sessionStorage.setItem('accessToken', data.AuthenticationResult.AccessToken);
        sessionStorage.setItem('idToken', data.AuthenticationResult.IdToken);
        sessionStorage.setItem('userEmail', email);
        
        // Clean up temp storage
        sessionStorage.removeItem('tempSession');
        sessionStorage.removeItem('tempEmail');
        
        // Redirect to hub
        window.location.href = 'hub.html';
        
    } catch (error) {
        console.error('Failed to set password:', error);
        showError(error.message || 'Failed to set new password. Please try again.');
    }
}

// Handle Signup
function handleSignup(event) {
    event.preventDefault();
    hideMessages();
    
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const signupBtn = document.getElementById('signup-btn');
    
    // Validate passwords match
    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    // Validate password strength
    if (password.length < 8) {
        showError('Password must be at least 8 characters long');
        return;
    }
    
    signupBtn.disabled = true;
    signupBtn.textContent = 'Creating account...';
    
    const attributeList = [
        new AmazonCognitoIdentity.CognitoUserAttribute({
            Name: 'email',
            Value: email
        }),
        new AmazonCognitoIdentity.CognitoUserAttribute({
            Name: 'name',
            Value: name
        })
    ];
    
    userPool.signUp(email, password, attributeList, null, function(err, result) {
        signupBtn.disabled = false;
        signupBtn.textContent = 'Create Account';
        
        if (err) {
            console.error('Signup failed:', err);
            showError(err.message || 'Signup failed. Please try again.');
            return;
        }
        
        currentUser = result.user;
        console.log('User signed up:', currentUser.getUsername());
        showSuccess('Account created! Please check your email for verification code.');
        
        // Show verification box
        document.getElementById('verification-box').classList.add('active');
    });
}

// Handle Email Verification
function handleVerification() {
    const code = document.getElementById('verification-code').value;
    
    if (!code) {
        showError('Please enter verification code');
        return;
    }
    
    if (!currentUser) {
        const email = document.getElementById('signup-email').value;
        const userData = {
            Username: email,
            Pool: userPool,
        };
        currentUser = new AmazonCognitoIdentity.CognitoUser(userData);
    }
    
    currentUser.confirmRegistration(code, true, function(err, result) {
        if (err) {
            console.error('Verification failed:', err);
            showError(err.message || 'Verification failed. Please check your code.');
            return;
        }
        
        console.log('Verification successful:', result);
        showSuccess('Email verified successfully. Your account is now pending admin approval. You will be notified once approved and can then log in.');
        
        // Hide verification box
        document.getElementById('verification-box').classList.remove('active');
        
        // Don't auto-switch to login, just show the message
        setTimeout(() => {
            document.getElementById('signup-form').innerHTML = `
                <div style="text-align: center; padding: 40px 20px;">
                    <h3 style="color: #18232b; margin-bottom: 15px;">Account created successfully</h3>
                    <p style="color: #65716f; margin-bottom: 20px;">
                        Your account has been verified and is now <strong>pending admin approval</strong>.
                    </p>
                    <p style="color: #65716f; margin-bottom: 30px;">
                        An administrator will review your account shortly. You'll receive an email notification once approved.
                    </p>
                    <button onclick="switchTab('login')" class="auth-button">
                        Return to Login
                    </button>
                </div>
            `;
        }, 2000);
    });
}

document.querySelector('.auth-tabs')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;

    event.preventDefault();
    const nextTab = event.key === 'ArrowRight' ? 'signup' : 'login';
    switchTab(nextTab);
    document.getElementById(`${nextTab}-tab`).focus();
});

// Check if user is already logged in
function checkAuth() {
    const accessToken = sessionStorage.getItem('accessToken');
    const idToken = sessionStorage.getItem('idToken');
    
    if (accessToken && idToken) {
        // User is logged in, redirect to hub
        window.location.href = 'hub.html';
    }
}

// Check auth on page load
checkAuth();
