/**
 * Smart Lishe — Firebase Synchronization & Auth Layer
 * Synchronously intercepts form submissions and handles offline state 
 * synchronization (localStorage keys starting with 'smartlishe_') with Firestore.
 * 
 * Uses modern Firebase Web v10 Modular SDK via CDN to natively support custom named Firestore database IDs.
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

  let dbInstance = null;
  let authInstance = null;
  let fstore = null; // Reference to imported firestore module

  // Global override for localStorage setItem and removeItem to keep Firestore up-to-date instantly
  const originalSetItem = localStorage.setItem;
  localStorage.setItem = function(key, value) {
    originalSetItem.apply(this, arguments);
    if (key.startsWith('smartlishe_') && !window.__is_syncing_from_firestore) {
      const syncKey = key.replace('smartlishe_', '');
      if (authInstance && authInstance.currentUser && dbInstance && fstore) {
        try {
          const parsedValue = JSON.parse(value);
          const uid = authInstance.currentUser.uid;
          
          // If the profile is updated, update the main user document as well for easy admin queries
          if (syncKey === 'profile') {
            const userDocRef = fstore.doc(dbInstance, 'users', uid);
            fstore.setDoc(userDocRef, parsedValue, { merge: true })
              .catch(err => console.warn("Error updating Firestore profile:", err));
          }
          
          // Save to standard sync collection
          const dataDocRef = fstore.doc(dbInstance, 'users', uid, 'data', syncKey);
          fstore.setDoc(dataDocRef, {
            key: syncKey,
            value: parsedValue,
            updatedAt: fstore.serverTimestamp()
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
      if (authInstance && authInstance.currentUser && dbInstance && fstore) {
        const uid = authInstance.currentUser.uid;
        const dataDocRef = fstore.doc(dbInstance, 'users', uid, 'data', syncKey);
        fstore.deleteDoc(dataDocRef)
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

  // Dynamic import helper to fetch the Modular SDKs from the Google CDN
  Promise.all([
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js")
  ]).then(([appMod, authMod, firestoreMod]) => {
    fstore = firestoreMod;
    
    const app = appMod.initializeApp(firebaseConfig);
    authInstance = authMod.getAuth(app);
    dbInstance = firestoreMod.initializeFirestore(app, {
      experimentalForceLongPolling: true
    }, databaseId);

    window.firebaseAuthInstance = authInstance;
    window.firestoreInstance = dbInstance;
    window.__firebase_loaded_successfully = true;

    console.log("🔥 Firebase connected successfully (Modular SDK) to Firestore db:", databaseId);

    // Setup sync and auth monitoring
    setupSync(authMod, firestoreMod);

    // Handle logout page
    if (window.location.pathname.includes('/auth/logout.html')) {
      authMod.signOut(authInstance).then(() => {
        localStorage.clear();
        console.log("Logged out successfully from Firebase Auth");
      });
    }
  }).catch(err => {
    console.error("Failed to load Firebase modular SDKs:", err);
  });

  function setupSync(authMod, firestoreMod) {
    authMod.onAuthStateChanged(authInstance, async (user) => {
      if (user) {
        console.log("👤 Logged in as:", user.email);
        window.__is_syncing_from_firestore = true;

        try {
          // 1. Load user profile doc
          const userDocRef = firestoreMod.doc(dbInstance, 'users', user.uid);
          const profileDoc = await firestoreMod.getDoc(userDocRef);
          if (profileDoc.exists()) {
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
          const dataColRef = firestoreMod.collection(dbInstance, 'users', user.uid, 'data');
          const dataSnap = await firestoreMod.getDocs(dataColRef);
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

    try {
      const { createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
      const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

      const cred = await createUserWithEmailAndPassword(authInstance, email, password);
      const uid = cred.user.uid;

      const actualRole = (email.toLowerCase() === 'admin@gmail.com' || email.toLowerCase() === 'admin2@gmail.com') ? 'Admin' : selectedRole;

      const profile = {
        name: firstName + ' ' + lastName,
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: phone,
        role: actualRole,
        setupComplete: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const userDocRef = doc(dbInstance, 'users', uid);
      await setDoc(userDocRef, profile);

      // Store locally
      localStorage.setItem('email', email);
      localStorage.setItem('firstName', firstName);
      localStorage.setItem('lastName', lastName);
      localStorage.setItem('smartlishe_role', actualRole);
      localStorage.setItem('role', actualRole);
      localStorage.setItem('smartlishe_logged_in', 'true');
      localStorage.setItem('smartlishe_profile', JSON.stringify(profile));

      showToast('Account created successfully on the backend!');
      
      setTimeout(() => {
        if (actualRole === 'Admin') {
          window.location.href = '/admin/accounts.html';
        } else if (actualRole === 'Professional') {
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

    try {
      const { signInWithEmailAndPassword, createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js");
      const { doc, getDoc, setDoc, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

      let cred;
      try {
        cred = await signInWithEmailAndPassword(authInstance, email, password);
      } catch (loginErr) {
        // Automatic provisioning for demo accounts to ensure frictionless trials
        if (loginErr.code === 'auth/user-not-found' && (email === 'demo@smartlishe.co.ke' || email === 'james@nutritionist.co.ke')) {
          console.log("Provisioning demo account automatically on Firebase...");
          cred = await createUserWithEmailAndPassword(authInstance, email, password);
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
          const userDocRef = doc(dbInstance, 'users', cred.user.uid);
          await setDoc(userDocRef, profile);
        } else {
          throw loginErr;
        }
      }

      const uid = cred.user.uid;
      
      // Fetch profile
      const userDocRef = doc(dbInstance, 'users', uid);
      const profileDoc = await getDoc(userDocRef);
      let profile = profileDoc.exists() ? profileDoc.data() : null;

      if (!profile) {
        const actualRole = (email.toLowerCase() === 'admin@gmail.com' || email.toLowerCase() === 'admin2@gmail.com') ? 'Admin' : selectedRole;
        profile = {
          name: email.split('@')[0],
          firstName: email.split('@')[0],
          lastName: '',
          email: email,
          role: actualRole,
          setupComplete: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await setDoc(userDocRef, profile);
      }

      const finalRole = profile.role || ((email.toLowerCase() === 'admin@gmail.com' || email.toLowerCase() === 'admin2@gmail.com') ? 'Admin' : selectedRole);

      // Sync and set localStorage
      localStorage.setItem('email', email);
      localStorage.setItem('smartlishe_logged_in', 'true');
      localStorage.setItem('smartlishe_role', finalRole);
      localStorage.setItem('role', finalRole);
      localStorage.setItem('smartlishe_profile', JSON.stringify(profile));

      // Fetch all nested data subcollections before redirecting
      window.__is_syncing_from_firestore = true;
      try {
        const dataColRef = collection(dbInstance, 'users', uid, 'data');
        const dataSnap = await getDocs(dataColRef);
        dataSnap.forEach(doc => {
          localStorage.setItem('smartlishe_' + doc.id, JSON.stringify(doc.data().value));
        });
      } catch (e) {
        console.warn("Failed to fetch subcollections in login:", e);
      }
      window.__is_syncing_from_firestore = false;

      showToast('Login successful! Redirecting...');
      
      setTimeout(() => {
        if (finalRole === 'Admin') {
          window.location.href = '/admin/accounts.html';
        } else if (finalRole === 'Professional') {
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
