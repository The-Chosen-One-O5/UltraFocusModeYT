// Firebase initialization (ESM)
// Loads Firebase SDKs from CDN and initializes app/auth/firestore using your config.
// Exports initialized instances for use across your site.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithRedirect,
  getRedirectResult
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDS6ZuQcViCFgolCcmAqBPp_9pndCB8F8Q",
  authDomain: "ultrafocusmode-18ae4.firebaseapp.com",
  projectId: "ultrafocusmode-18ae4",
  storageBucket: "ultrafocusmode-18ae4.firebasestorage.app",
  messagingSenderId: "998572603670",
  appId: "1:998572603670:web:f14dff88199d964b0c3837",
  measurementId: "G-04LSN8085M"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Minimal profile bootstrap in users/{uid}
async function ensureUserProfile(user) {
  if (!user) return;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } else {
    // Keep profile fresh
    await updateDoc(ref, {
      email: user.email || null,
      displayName: user.displayName || null,
      photoURL: user.photoURL || null,
      updatedAt: serverTimestamp()
    });
  }
}

// App state path users/{uid}/app/state
async function saveAppState(uid, state) {
  const ref = doc(db, 'users', uid, 'app', 'state');
  await setDoc(ref, {
    ...state,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

async function loadAppState(uid) {
  const ref = doc(db, 'users', uid, 'app', 'state');
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Handle OAuth redirect completion (if any). Run ASAP.
(async () => {
  try {
    const redirectResult = await getRedirectResult(auth);
    if (redirectResult && redirectResult.user) {
      console.log('[Auth] Redirect result user:', redirectResult.user.uid);
      await ensureUserProfile(redirectResult.user);
    }
  } catch (e) {
    console.error('[Auth] getRedirectResult error:', e);
  }
})();

// Auth helpers with robust fallback to redirect on popup failure
async function signInWithGooglePopup() {
  console.log('[Auth] Attempting signInWithPopup...');
  try {
    const result = await signInWithPopup(auth, provider);
    await ensureUserProfile(result.user);
    console.log('[Auth] Popup sign-in success:', result.user?.uid);
    return result.user;
  } catch (err) {
    console.warn('[Auth] Popup sign-in failed, considering redirect fallback:', err?.code || err);
    const code = err?.code || '';
    // Fallback for common production cases: popup blocked, third-party cookies, unsupported env, CSP, etc.
    const shouldRedirect =
      code === 'auth/popup-blocked' ||
      code === 'auth/popup-closed-by-user' || // optional: treat as fallback
      code === 'auth/operation-not-supported-in-this-environment' ||
      code === 'auth/unauthorized-domain' || // if misconfigured, redirect may still succeed once config is fixed
      code === 'auth/internal-error';
    if (shouldRedirect) {
      console.log('[Auth] Falling back to signInWithRedirect...');
      await signInWithRedirect(auth, provider);
      // The flow continues after page reload via getRedirectResult above
      return null;
    }
    throw err;
  }
}

async function signOutFromFirebase() {
  await signOut(auth);
}

export {
  app,
  auth,
  db,
  provider,
  onAuthStateChanged,
  signInWithGooglePopup,
  signOutFromFirebase,
  saveAppState,
  loadAppState
};