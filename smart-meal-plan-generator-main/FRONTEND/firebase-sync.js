/**
 * Smart Lishe — Firebase Synchronization & Auth Layer
 * Synchronously intercepts form submissions and handles offline state 
 * synchronization (localStorage keys starting with 'smartlishe_') with Firestore.
 */

(function() {
  const firebaseConfig = {
    apiKey: "AIzaSyBSHeaPxbMOGxOrRPRV7vtqedhpRxGvWHw",
    authDomain: "smartlishe-4fe54.firebaseapp.com",
    projectId: "smartlishe-4fe54",
    storageBucket: "smartlishe-4fe54.firebasestorage.app",
    messagingSenderId: "688539136675",
    appId: "1:688539136675:web:8ed8d986e50913ed86c516"
  };

  const databaseId = "ai-studio-smartlishe-62742a0a-7336-4764-bba2-7c69cf67b8bf";

  window.__firebase_loaded_successfully = false;
  window.__is_syncing_from_firestore = false;

  // Global override for localStorage setItem and removeItem to keep Firestore up-to-date instantly
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    originalSetItem.apply(this, arguments);
    if (key.startsWith('smartlishe_') && !window.__is_syncing_from_firestore) {
      const syncKey = key.replace('smartlishe_', '');
      const auth = window.firebaseAuthInstance;
      const db = window.firestoreInstance;
      if (auth && auth.currentUser && db) {
        try {
          const parsedValue = JSON.parse(value);
          // If the profile is updated, update the main user document as well for easy admin queries
          if (syncKey === 'profile') {
            db.collection('users').doc(auth.currentUser.uid).set(parsedValue, { merge: true })
              .catch(err => console.warn("Error updating Firestore profile:", err));
          }
          // Save to standard sync collection
          db.collection('users').doc(auth.currentUser.uid).collection('data').doc(syncKey).set({
            key: syncKey,
            value: parsedValue,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }).catch(err => console.warn("Error updating Firestore key:", err));
        } catch (e) {}
      }
    }
  };

  const originalRemoveItem = localStorage.removeItem;
  localStorage.removeItem = function(key) {
    originalRemoveItem.apply(this, arguments);
    if (key.startsWith('smartlishe_') && !window.__is_syncing_from_firestore) {
      const syncKey = key.replace('smartlishe_', '');
      const auth = window.firebaseAuthInstance;
      const db = window.firestoreInstance;
      if (auth && auth.currentUser && db) {
        db.collection('users').doc(auth.currentUser.uid).collection('data').doc(syncKey).delete()
          .catch(err => console.warn("Error deleting Firestore key:", err));
      }
    }
  };

  // Intercept form submissions immediately in the capture phase to block any race condition
  window.addEventListener('submit', function(e) {
    const targetId = e.target.id;
    if (targetId === 'registerForm' || targetId === 'loginForm') {
      e.preventDefault();
      e.stopPropagation();

      if (!window.__firebase_loaded_successfully) {
        showToast("Connecting securely to backend... please wait a moment and click again.", "error");
        return;
      }

      if (targetId === 'registerForm') {
        handleFirebaseRegister();
      } else if (targetId === 'loginForm') {
        handleFirebaseLogin();
      }
    }
  }, true); // Capture phase is critical to preempt the local scripts!

  // Helpers to load scripts
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Helper to wrap promises with a timeout to prevent indefinite loading spinners
  function withTimeout(promise, ms, defaultVal = null) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]).catch(err => {
      console.warn("Firebase promise timed out after " + ms + "ms:", err);
      return defaultVal;
    });
  }

  // Load Firebase Compat SDKs hierarchically to prevent race conditions
  loadScript("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js")
    .then(() => {
      return Promise.all([
        loadScript("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"),
        loadScript("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js")
      ]);
    })
    .then(() => {
      initFirebase();
    })
    .catch(err => {
      console.error("Failed to load Firebase SDK sequentially:", err);
    });

  function initFirebase() {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    
    const auth = firebase.auth();
    const db = firebase.app().firestore(databaseId);

    window.firebaseAuthInstance = auth;
    window.firestoreInstance = db;
    window.__firebase_loaded_successfully = true;

    console.log("🔥 Firebase connected successfully to Firestore db:", databaseId);

    // Setup sync and auth monitoring
    setupSync(auth, db);

    // Handle logout page
    if (window.location.pathname.includes('/auth/logout.html')) {
      auth.signOut().then(() => {
        localStorage.clear();
        console.log("Logged out successfully from Firebase Auth");
      });
    }
  }

  function setupSync(auth, db) {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        console.log("👤 Logged in as:", user.email);
        window.__is_syncing_from_firestore = true;

        try {
          // 1. Load user profile doc
          const profileDoc = await db.collection('users').doc(user.uid).get();
          if (profileDoc.exists) {
            const profileData = profileDoc.data();
            localStorage.setItem('smartlishe_profile', JSON.stringify(profileData));
            localStorage.setItem('smartlishe_role', profileData.role || 'User');
            localStorage.setItem('role', profileData.role || 'User');
            localStorage.setItem('firstName', profileData.firstName || profileData.name?.split(' ')[0] || '');
            localStorage.setItem('lastName', profileData.lastName || profileData.name?.split(' ')[1] || '');
            localStorage.setItem('email', profileData.email || user.email);
            localStorage.setItem('smartlishe_logged_in', 'true');
          }

          // 2. Fetch all user's data subcollections (meals, water, shopping list, etc)
          const dataSnap = await db.collection('users').doc(user.uid).collection('data').get();
          dataSnap.forEach(doc => {
            const data = doc.data();
            localStorage.setItem('smartlishe_' + doc.id, JSON.stringify(data.value));
          });

          // Dispatch standard storage event so UI reactive elements update
          window.dispatchEvent(new Event('storage'));
          console.log("✨ All data synchronized securely from Firestore!");

        } catch (e) {
          console.error("Sync read error:", e);
        } finally {
          window.__is_syncing_from_firestore = false;
        }
      }
    });
  }

  // Handle Register Flow
  async function handleFirebaseRegister() {
    const firstName = document.getElementById('regFirstName')?.value?.trim();
    const lastName = document.getElementById('regLastName')?.value?.trim();
    const email = document.getElementById('regEmail')?.value?.trim();
    const phone = document.getElementById('regPhone')?.value?.trim() || '';
    const password = document.getElementById('regPassword')?.value;
    const confirm = document.getElementById('regConfirmPassword')?.value;
    const terms = document.getElementById('acceptTerms')?.checked;
    const selectedRole = document.querySelector('.role-card.selected')?.dataset?.role || 'User';

    if (!firstName || !lastName) { showToast('Please enter your full name.', 'error'); return; }
    if (!email || !email.includes('@')) { showToast('Please enter a valid email address.', 'error'); return; }
    if (password.length < 8) { showToast('Password must be at least 8 characters.', 'error'); return; }
    if (password !== confirm) { showToast('Passwords do not match.', 'error'); return; }
    if (!terms) { showToast('Please accept the Terms of Service.', 'error'); return; }

    setBtnLoading('continueBtn', true);

    const auth = window.firebaseAuthInstance;
    const db = window.firestoreInstance;

    try {
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;

      const profile = {
        name: firstName + ' ' + lastName,
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: phone,
        role: selectedRole,
        setupComplete: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await withTimeout(db.collection('users').doc(uid).set(profile), 2500);

      // Store locally
      localStorage.setItem('email', email);
      localStorage.setItem('firstName', firstName);
      localStorage.setItem('lastName', lastName);
      localStorage.setItem('smartlishe_role', selectedRole);
      localStorage.setItem('role', selectedRole);
      localStorage.setItem('smartlishe_logged_in', 'true');
      localStorage.setItem('smartlishe_profile', JSON.stringify(profile));

      showToast('Account created successfully on the backend!');
      
      setTimeout(() => {
        if (selectedRole === 'Professional') {
          window.location.href = '/auth/professional-profile-setup.html';
        } else {
          window.location.href = '/auth/user-profile-setup.html';
        }
      }, 1000);

    } catch (err) {
      console.error("Firebase register error:", err);
      showToast(err.message, 'error');
      setBtnLoading('continueBtn', false);
    }
  }

  // Handle Login Flow
  async function handleFirebaseLogin() {
    const email = document.getElementById('loginEmail')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value;
    const selectedRole = document.querySelector('.role-card.selected')?.dataset?.role || 'User';

    if (!email || !password) {
      showToast('Please fill in all fields.', 'error');
      return;
    }

    setBtnLoading('loginBtn', true);

    const auth = window.firebaseAuthInstance;
    const db = window.firestoreInstance;

    try {
      let cred;
      try {
        cred = await auth.signInWithEmailAndPassword(email, password);
      } catch (loginErr) {
        // Automatic provisioning for demo accounts to ensure frictionless trials
        if (loginErr.code === 'auth/user-not-found' && (email === 'demo@smartlishe.co.ke' || email === 'james@nutritionist.co.ke')) {
          console.log("Provisioning demo account automatically on Firebase...");
          cred = await auth.createUserWithEmailAndPassword(email, password);
          const isPro = email === 'james@nutritionist.co.ke';
          const profile = {
            name: isPro ? "Dr. James Ochieng" : "Demo User",
            firstName: isPro ? "James" : "Demo",
            lastName: isPro ? "Ochieng" : "User",
            email: email,
            role: isPro ? "Professional" : "User",
            setupComplete: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await withTimeout(db.collection('users').doc(cred.user.uid).set(profile), 2500);
        } else {
          throw loginErr;
        }
      }

      const uid = cred.user.uid;
      
      // Fetch profile
      let profileDoc = await withTimeout(db.collection('users').doc(uid).get(), 2500);
      let profile = (profileDoc && profileDoc.exists) ? profileDoc.data() : null;

      if (!profile) {
        profile = {
          name: email.split('@')[0],
          firstName: email.split('@')[0],
          lastName: '',
          email: email,
          role: selectedRole,
          setupComplete: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await withTimeout(db.collection('users').doc(uid).set(profile), 2500);
      }

      // Sync and set localStorage
      localStorage.setItem('email', email);
      localStorage.setItem('smartlishe_logged_in', 'true');
      localStorage.setItem('smartlishe_role', profile.role || selectedRole);
      localStorage.setItem('role', profile.role || selectedRole);
      localStorage.setItem('smartlishe_profile', JSON.stringify(profile));

      // Fetch all nested data subcollections before redirecting
      window.__is_syncing_from_firestore = true;
      try {
        const dataSnap = await withTimeout(db.collection('users').doc(uid).collection('data').get(), 2500);
        if (dataSnap) {
          dataSnap.forEach(doc => {
            localStorage.setItem('smartlishe_' + doc.id, JSON.stringify(doc.data().value));
          });
        }
      } catch (e) {
        console.warn("Failed to fetch subcollections in login:", e);
      }
      window.__is_syncing_from_firestore = false;

      showToast('Login successful! Redirecting...');
      
      setTimeout(() => {
        if (profile.role === 'Professional' || selectedRole === 'Professional') {
          window.location.href = '/professional/home.html';
        } else {
          window.location.href = '/user/dashboard.html';
        }
      }, 800);

    } catch (err) {
      console.error("Firebase login error:", err);
      showToast(err.message, 'error');
      setBtnLoading('loginBtn', false);
    }
  }

  // Manage UI button loading states
  function setBtnLoading(btnId, isLoading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isLoading) {
      btn.classList.add('btn-loading');
      btn.disabled = true;
      const spinner = btn.querySelector('.spinner-small');
      if (spinner) spinner.style.display = 'block';
    } else {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      const spinner = btn.querySelector('.spinner-small');
      if (spinner) spinner.style.display = 'none';
    }
  }

  // Generic Toast display helper
  function showToast(msg, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${msg}</span>`;
    stack.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(40px) scale(0.96)';
      setTimeout(() => t.remove(), 350);
    }, 3500);
  }

})();
