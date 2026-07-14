/**
 * Smart Lishe — Firebase Synchronization & Auth Layer
 * Automatically syncs offline state (localStorage keys starting with 'smartlishe_')
 * to Cloud Firestore, and provides real Firebase Authentication.
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

  // Load all required Firebase Compat scripts dynamically
  Promise.all([
    loadScript("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"),
    loadScript("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"),
    loadScript("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js")
  ]).then(() => {
    initFirebase();
  }).catch(err => {
    console.error("Failed to load Firebase SDK:", err);
  });

  function initFirebase() {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    
    const auth = firebase.auth();
    const db = firebase.app().firestore(databaseId);

    window.firebaseAuthInstance = auth;
    window.firestoreInstance = db;

    console.log("🔥 Firebase initialized successfully with database:", databaseId);

    // Setup synchronization hook
    setupSync(auth, db);

    // Hook forms if on Auth pages
    if (window.location.pathname.includes('/auth/register.html')) {
      hookRegistrationForm(auth, db);
    } else if (window.location.pathname.includes('/auth/login.html')) {
      hookLoginForm(auth, db);
    } else if (window.location.pathname.includes('/auth/logout.html')) {
      handleLogout(auth);
    }
  }

  function setupSync(auth, db) {
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        console.log("👤 User is signed in to Firebase Auth:", user.email);
        window.__is_syncing_from_firestore = true;

        try {
          // 1. Fetch user profile
          const profileDoc = await db.collection('users').doc(user.uid).get();
          if (profileDoc.exists) {
            const profileData = profileDoc.data();
            localStorage.setItem('smartlishe_profile', JSON.stringify(profileData));
            localStorage.setItem('smartlishe_role', profileData.role || 'User');
            localStorage.setItem('role', profileData.role || 'User');
            localStorage.setItem('smartlishe_logged_in', 'true');
          }

          // 2. Fetch all user sync data documents
          const dataSnap = await db.collection('users').doc(user.uid).collection('data').get();
          dataSnap.forEach(doc => {
            const data = doc.data();
            localStorage.setItem('smartlishe_' + doc.id, JSON.stringify(data.value));
            // Trigger storage event to refresh page states if needed
            window.dispatchEvent(new Event('storage'));
          });

          console.log("✨ All data synced from Firestore backend!");
        } catch (e) {
          console.error("Error reading from Firestore sync:", e);
        } finally {
          window.__is_syncing_from_firestore = false;
        }

        // 3. Keep Firestore in sync when localStorage is updated
        const originalSetItem = localStorage.setItem;
        localStorage.setItem = function(key, value) {
          originalSetItem.apply(this, arguments);
          if (key.startsWith('smartlishe_') && !window.__is_syncing_from_firestore) {
            const syncKey = key.replace('smartlishe_', '');
            try {
              const parsedValue = JSON.parse(value);
              db.collection('users').doc(user.uid).collection('data').doc(syncKey).set({
                key: syncKey,
                value: parsedValue,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              }).catch(err => console.warn("Error updating Firestore on setItem:", err));
            } catch (e) {}
          }
        };

        const originalRemoveItem = localStorage.removeItem;
        localStorage.removeItem = function(key) {
          originalRemoveItem.apply(this, arguments);
          if (key.startsWith('smartlishe_') && !window.__is_syncing_from_firestore) {
            const syncKey = key.replace('smartlishe_', '');
            db.collection('users').doc(user.uid).collection('data').doc(syncKey).delete()
              .catch(err => console.warn("Error deleting Firestore on removeItem:", err));
          }
        };

      } else {
        console.log("👤 No authenticated user in Firebase Auth");
      }
    });
  }

  function hookRegistrationForm(auth, db) {
    const regForm = document.getElementById('registerForm');
    if (!regForm) return;

    regForm.addEventListener('submit', async function(e) {
      e.stopPropagation(); // Stop original local registration handler
      e.preventDefault();

      const firstName = document.getElementById('regFirstName').value.trim();
      const lastName = document.getElementById('regLastName').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const confirm = document.getElementById('regConfirmPassword').value;
      const terms = document.getElementById('acceptTerms').checked;
      const selectedRole = window.selectedRole || 'User';

      if (!firstName || !lastName) { showToast('Please enter your full name.', 'error'); return; }
      if (!email || !email.includes('@')) { showToast('Please enter a valid email address.', 'error'); return; }
      if (password.length < 8) { showToast('Password must be at least 8 characters.', 'error'); return; }
      if (password !== confirm) { showToast('Passwords do not match.', 'error'); return; }
      if (!terms) { showToast('Please accept the Terms of Service.', 'error'); return; }

      const btn = document.getElementById('continueBtn');
      if (btn) {
        btn.classList.add('btn-loading');
        const spinner = btn.querySelector('.spinner-small');
        if (spinner) spinner.style.display = 'block';
        btn.disabled = true;
      }

      try {
        // Register in Firebase Authentication
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const uid = cred.user.uid;

        // Create Profile document in Firestore
        const profile = {
          name: firstName + ' ' + lastName,
          firstName: firstName,
          lastName: lastName,
          email: email,
          role: selectedRole,
          setupComplete: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await db.collection('users').doc(uid).set(profile);

        showToast('Account created successfully in backend!');
        
        // Wait briefly for firestore sync before redirecting
        setTimeout(() => {
          if (selectedRole === 'Professional') {
            window.location.href = '../auth/professional-profile-setup.html';
          } else {
            window.location.href = '../auth/user-profile-setup.html';
          }
        }, 1000);

      } catch (err) {
        console.error("Registration error:", err);
        showToast(err.message, 'error');
        if (btn) {
          btn.classList.remove('btn-loading');
          const spinner = btn.querySelector('.spinner-small');
          if (spinner) spinner.style.display = 'none';
          btn.disabled = false;
        }
      }
    }, true); // Capture phase to preempt local handler
  }

  function hookLoginForm(auth, db) {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    loginForm.addEventListener('submit', async function(e) {
      e.stopPropagation(); // Preempt original local-only handler
      e.preventDefault();

      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value.trim();
      const selectedRole = window.selectedRole || 'User';

      if (!email || !password) {
        showToast('Please fill in all fields.', 'error');
        return;
      }

      const btn = document.getElementById('loginBtn');
      if (btn) {
        btn.classList.add('btn-loading');
        const spinner = btn.querySelector('.spinner-small');
        if (spinner) spinner.style.display = 'block';
        btn.disabled = true;
      }

      try {
        let cred;
        try {
          cred = await auth.signInWithEmailAndPassword(email, password);
        } catch (loginErr) {
          // Auto-registration for standard demo accounts to ensure frictionless login
          if (loginErr.code === 'auth/user-not-found' && (email === 'demo@smartlishe.co.ke' || email === 'james@nutritionist.co.ke')) {
            console.log("Demo user not found in firebase auth, creating account automatically...");
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
            await db.collection('users').doc(cred.user.uid).set(profile);
          } else {
            throw loginErr;
          }
        }

        const uid = cred.user.uid;
        const profileDoc = await db.collection('users').doc(uid).get();
        let profile = profileDoc.exists ? profileDoc.data() : null;

        if (!profile) {
          // Generate fallback profile if missing in Firestore
          profile = {
            name: email.split('@')[0],
            firstName: email.split('@')[0],
            lastName: '',
            email: email,
            role: selectedRole,
            setupComplete: true
          };
          await db.collection('users').doc(uid).set(profile);
        }

        // Keep local storage in sync
        localStorage.setItem('email', email);
        localStorage.setItem('smartlishe_logged_in', 'true');
        localStorage.setItem('smartlishe_role', profile.role || selectedRole);
        localStorage.setItem('role', profile.role || selectedRole);
        localStorage.setItem('smartlishe_profile', JSON.stringify(profile));

        showToast('Login successful! Redirecting...');
        setTimeout(() => {
          if (profile.role === 'Professional' || selectedRole === 'Professional') {
            window.location.href = '../professional/home.html';
          } else {
            window.location.href = '../user/dashboard.html';
          }
        }, 800);

      } catch (err) {
        console.error("Login error:", err);
        showToast(err.message, 'error');
        if (btn) {
          btn.classList.remove('btn-loading');
          const spinner = btn.querySelector('.spinner-small');
          if (spinner) spinner.style.display = 'none';
          btn.disabled = false;
        }
      }
    }, true); // Capture phase to preempt local handler
  }

  function handleLogout(auth) {
    auth.signOut().then(() => {
      localStorage.clear();
      console.log("Logged out from Firebase successfully");
    });
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
