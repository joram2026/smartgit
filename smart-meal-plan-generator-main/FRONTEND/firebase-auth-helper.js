// firebase-auth-helper.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

let authInstance = null;
let googleProvider = null;
let currentIdToken = null;

async function getFirebaseConfig() {
  const res = await fetch('/firebase-config');
  return await res.json();
}

export async function initFirebaseAuth() {
  if (authInstance) return { auth: authInstance, provider: googleProvider };

  try {
    const config = await getFirebaseConfig();
    let app;
    const existingApps = getApps();
    if (existingApps.length > 0) {
      app = existingApps[0];
    } else {
      app = initializeApp(config);
    }
    authInstance = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    
    // Listen for auth state changes
    onAuthStateChanged(authInstance, async (user) => {
      if (user) {
        currentIdToken = await user.getIdToken();
        console.log("Firebase Auth: User is signed in:", user.email);
        
        // Register/sync user profile on the Postgres server
        await registerUserOnServer(currentIdToken);
        
        // Pull latest Postgres data and sync into localStorage
        await syncPostgresToLocal(currentIdToken);
        
        // Update UI (e.g., replace Login button with dynamic avatar chip)
        updateUIForLoggedInUser(user);
      } else {
        currentIdToken = null;
        console.log("Firebase Auth: No user signed in");
        updateUIForLoggedOutUser();
      }
    });

    return { auth: authInstance, provider: googleProvider };
  } catch (err) {
    console.error("Firebase Auth initialization failed:", err);
    throw err;
  }
}

// Function to register the authenticated user on the Postgres server
async function registerUserOnServer(token) {
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    return await res.json();
  } catch (e) {
    console.error("Failed to register user on Postgres:", e);
  }
}

// Function to fetch all keys from Postgres and load them into localStorage
async function syncPostgresToLocal(token) {
  try {
    const res = await fetch('/api/sync', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await res.json();
    if (result.success && result.data) {
      console.log("Sync: Pulled Postgres data successfully:", Object.keys(result.data));
      // Save all Postgres keys into localstorage
      for (const [key, value] of Object.entries(result.data)) {
        localStorage.setItem('smartlishe_' + key, JSON.stringify(value));
      }
      
      // Dispatch storage or custom event so UI can refresh if needed
      window.dispatchEvent(new Event('storage'));
    }
  } catch (e) {
    console.error("Failed to sync Postgres to local storage:", e);
  }
}

// Function to push a single key-value update to the Postgres server
export async function syncLocalToPostgres(key, value) {
  if (!currentIdToken) return;
  try {
    await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentIdToken}`
      },
      body: JSON.stringify({ key, value })
    });
    console.log(`Sync: Saved key "${key}" to PostgreSQL.`);
  } catch (e) {
    console.error(`Failed to sync key "${key}" to Postgres:`, e);
  }
}

// Intercept Store.set to automatically sync updates to PostgreSQL
function interceptStore() {
  if (typeof Store !== 'undefined' && Store.set && !Store.set.__isIntercepted) {
    const originalSet = Store.set;
    Store.set = function(key, value) {
      const success = originalSet(key, value);
      if (success) {
        syncLocalToPostgres(key, value);
      }
      return success;
    };
    Store.set.__isIntercepted = true;
    console.log("Sync: Successfully hooked into Store.set");
  } else {
    setTimeout(interceptStore, 200);
  }
}
interceptStore();

// Trigger Google Login
export async function loginWithGoogle() {
  const { auth, provider } = await initFirebaseAuth();
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    // Save minimal legacy compatibility keys for the frontend
    localStorage.setItem('email', user.email);
    localStorage.setItem('smartlishe_logged_in', 'true');
    localStorage.setItem('smartlishe_role', 'User');
    localStorage.setItem('role', 'User');
    
    const profile = {
      name: user.displayName || user.email.split('@')[0],
      firstName: user.displayName?.split(' ')[0] || user.email.split('@')[0],
      email: user.email,
      role: 'User',
      photoURL: user.photoURL,
      setupComplete: true
    };
    localStorage.setItem('smartlishe_profile', JSON.stringify(profile));
    localStorage.setItem('firstName', profile.firstName);
    
    console.log("Login successful! Redirecting...");
    return user;
  } catch (e) {
    console.error("Google Sign-In failed:", e);
    throw e;
  }
}

// Trigger Email/Password Registration
export async function registerWithEmail(email, password, firstName, lastName, role = 'User') {
  const { auth } = await initFirebaseAuth();
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const user = result.user;
    
    // Update display name in Firebase
    await updateProfile(user, {
      displayName: `${firstName} ${lastName}`
    });

    // Save legacy compatibility keys for the frontend
    localStorage.setItem('email', user.email);
    localStorage.setItem('smartlishe_logged_in', 'true');
    localStorage.setItem('smartlishe_role', role);
    localStorage.setItem('role', role);
    
    const profile = {
      name: `${firstName} ${lastName}`,
      firstName: firstName,
      lastName: lastName,
      email: user.email,
      role: role,
      setupComplete: true
    };
    localStorage.setItem('smartlishe_profile', JSON.stringify(profile));
    localStorage.setItem('firstName', firstName);

    console.log("Firebase Auth: Email user registered:", user.email);
    return user;
  } catch (e) {
    console.error("Email registration failed:", e);
    throw e;
  }
}

// Trigger Email/Password Login
export async function loginWithEmail(email, password, role = 'User') {
  const { auth } = await initFirebaseAuth();
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    const user = result.user;

    const displayName = user.displayName || email.split('@')[0];
    const nameParts = displayName.split(' ');
    const firstName = nameParts[0] || displayName;
    const lastName = nameParts.slice(1).join(' ') || '';

    // Save legacy compatibility keys for the frontend
    localStorage.setItem('email', user.email);
    localStorage.setItem('smartlishe_logged_in', 'true');
    localStorage.setItem('smartlishe_role', role);
    localStorage.setItem('role', role);
    
    let existingProfile = {};
    try {
      const raw = localStorage.getItem('smartlishe_profile');
      if (raw) existingProfile = JSON.parse(raw);
    } catch(err) {}

    const profile = {
      ...existingProfile,
      name: displayName,
      firstName: firstName,
      lastName: lastName,
      email: user.email,
      role: role,
      setupComplete: true
    };
    localStorage.setItem('smartlishe_profile', JSON.stringify(profile));
    localStorage.setItem('firstName', firstName);

    console.log("Firebase Auth: Email user logged in:", user.email);
    return user;
  } catch (e) {
    console.error("Email login failed:", e);
    throw e;
  }
}

// Trigger Logout
export async function logoutUser() {
  if (!authInstance) await initFirebaseAuth();
  try {
    await signOut(authInstance);
    // Clear legacy compatibility storage keys
    localStorage.removeItem('email');
    localStorage.removeItem('smartlishe_logged_in');
    localStorage.removeItem('smartlishe_profile');
    localStorage.removeItem('smartlishe_role');
    localStorage.removeItem('role');
    localStorage.removeItem('firstName');
    
    console.log("Logged out successfully.");
  } catch (e) {
    console.error("Logout failed:", e);
  }
}

// UI Updaters
function updateUIForLoggedInUser(user) {
  // Update dynamic avatar and name chips if they exist
  const emailVal = user.email;
  const nameVal = user.displayName || emailVal.split('@')[0];
  const photoVal = user.photoURL || '';

  // Update navbar Sign In link to show Profile/Dashboard
  const navSignIn = document.getElementById('navSignIn');
  if (navSignIn) {
    navSignIn.innerHTML = `<i class="fa-solid fa-user"></i> ${nameVal.split(' ')[0]}`;
    navSignIn.href = '/user/dashboard.html';
  }

  // Update topbar user avatar
  const topbarChip = document.getElementById('topbarChip');
  if (topbarChip) {
    topbarChip.innerHTML = `
      <img src="${photoVal || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200'}" alt="User" class="profile-avatar" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid var(--sukuma);">
      <div class="profile-info" style="display:flex;flex-direction:column;gap:1px;text-align:left;">
        <span class="profile-name" style="font-weight:700;font-size:0.82rem;color:var(--text-primary);line-height:1.2;">${nameVal}</span>
        <span class="profile-role" style="font-size:0.68rem;color:var(--text-muted);display:flex;align-items:center;gap:4px;">User <i class="fa-solid fa-cloud" style="color: #10b981;" title="Synced to Postgres"></i></span>
      </div>
    `;
    topbarChip.href = '/user/profile.html';
  }
}

function updateUIForLoggedOutUser() {
  const navSignIn = document.getElementById('navSignIn');
  if (navSignIn) {
    navSignIn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Sign In`;
    navSignIn.href = '/auth/login.html';
  }
}

// Automatically initialize auth on load
initFirebaseAuth();
