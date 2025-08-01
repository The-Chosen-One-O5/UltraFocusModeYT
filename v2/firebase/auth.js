// Auth wiring for Ultra Focus Mode (ESM)
// Bridges Firebase Auth to the app's existing isSignedIn/currentUser model in v2/index.html

import {
  auth,
  onAuthStateChanged,
  signInWithGooglePopup,
  signOutFromFirebase,
  saveAppState,
  loadAppState
} from './firebase.js';

// Map localStorage-based app state to a serializable object for Firestore
function collectAppStateFromWindow() {
  // Guard if v2/index.html hasn't set these yet
  const g = window;
  return {
    points: g.points || 0,
    previousPoints: g.previousPoints || 0,
    totalFocusTime: g.totalFocusTime || 0,
    totalDistractions: g.totalDistractions || 0,
    totalVideosWatched: g.totalVideosWatched || 0,
    tasks: Array.isArray(g.tasks) ? g.tasks : [],
    playlists: Array.isArray(g.playlists) ? g.playlists : [],
    streakDays: g.streakDays || 0,
    lastFocusDate: g.lastFocusDate || null,
    mysteryBoxCount: g.mysteryBoxCount || 0,
    activePowerUps: g.activePowerUps || { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null } },
    premiumLofiTracks: Array.isArray(g.premiumLofiTracks) ? g.premiumLofiTracks.map(t => ({ id: t.id, unlocked: !!t.unlocked })) : [],
    dailyFocusData: g.dailyFocusData || {},
    browserNotificationsEnabled: !!g.browserNotificationsEnabled,
    currentPomodoroDurationSetting: g.currentPomodoroDurationSetting || 60,
    // Session hints (not for restoring exact timers)
    currentView: g.currentView || 'landingPage'
  };
}

// Hydrate global app state from Firestore data (minimal intrusive)
function applyAppStateToWindow(data) {
  const g = window;
  if (!data) return;

  g.points = data.points ?? g.points ?? 0;
  g.previousPoints = data.previousPoints ?? g.previousPoints ?? g.points ?? 0;
  g.totalFocusTime = data.totalFocusTime ?? g.totalFocusTime ?? 0;
  g.totalDistractions = data.totalDistractions ?? g.totalDistractions ?? 0;
  g.totalVideosWatched = data.totalVideosWatched ?? g.totalVideosWatched ?? 0;
  g.tasks = Array.isArray(data.tasks) ? data.tasks : (g.tasks || []);
  g.playlists = Array.isArray(data.playlists) ? data.playlists : (g.playlists || []);
  g.streakDays = data.streakDays ?? g.streakDays ?? 0;
  g.lastFocusDate = data.lastFocusDate ?? g.lastFocusDate ?? null;
  g.mysteryBoxCount = data.mysteryBoxCount ?? g.mysteryBoxCount ?? 0;
  g.activePowerUps = data.activePowerUps ?? g.activePowerUps ?? { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null } };
  // premiumLofiTracks exists as objects with cost, url in index.html; only apply unlocked flags where possible
  if (Array.isArray(data.premiumLofiTracks) && Array.isArray(g.premiumLofiTracks)) {
    const unlockedMap = new Map(data.premiumLofiTracks.map(t => [t.id, !!t.unlocked]));
    g.premiumLofiTracks.forEach(t => { if (unlockedMap.has(t.id)) t.unlocked = unlockedMap.get(t.id); });
  }
  g.dailyFocusData = data.dailyFocusData ?? g.dailyFocusData ?? {};
  g.browserNotificationsEnabled = !!(data.browserNotificationsEnabled ?? g.browserNotificationsEnabled);
  g.currentPomodoroDurationSetting = data.currentPomodoroDurationSetting ?? g.currentPomodoroDurationSetting ?? 60;

  // Update UI bits if available
  try {
    if (typeof g.updateAchievementLevel === 'function') g.updateAchievementLevel();
    if (typeof g.updateStreakDisplay === 'function') g.updateStreakDisplay();
    if (typeof g.restoreTasks === 'function') g.restoreTasks();
    if (typeof g.populatePlaylistSelect === 'function') g.populatePlaylistSelect();
  } catch (e) {
    console.warn('Post-hydration UI update warning:', e.message);
  }
}

// Public APIs to be called from HTML event handlers
export async function googleSignIn() {
  const user = await signInWithGooglePopup();
  return user;
}

export async function firebaseSignOut() {
  await signOutFromFirebase();
}

// Attach a single global handler to wire buttons without editing lots of inline logic
export function wireAuthButtons() {
  const googleBtn = document.querySelector('#signinFormContainer button[data-action="google-sign-in"]');
  if (googleBtn && !googleBtn.dataset.fbwired) {
    googleBtn.dataset.fbwired = '1';
    googleBtn.addEventListener('click', async () => {
      googleBtn.disabled = true;
      const orig = googleBtn.textContent;
      googleBtn.textContent = 'Signing in...';
      try {
        const user = await googleSignIn();
        console.log('Google signed in:', user?.uid);
      } catch (e) {
        console.error('Google sign-in failed:', e);
        alert('Google sign-in failed. Check console.');
      } finally {
        googleBtn.textContent = orig;
        googleBtn.disabled = false;
      }
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && !logoutBtn.dataset.fbwired) {
    logoutBtn.dataset.fbwired = '1';
    logoutBtn.addEventListener('click', async (e) => {
      // Let existing logout confirmation UI run if it exists.
      // If not, do Firebase sign-out directly.
      try {
        // If the app's existing logout() is wired, it will run via its own listener.
        // We add a lightweight fallback if not present.
        if (!window.logout) {
          await firebaseSignOut();
        }
      } catch (err) {
        console.error('Sign out error:', err);
      }
    });
  }
}

// Keep app and Firestore in sync at auth boundaries
onAuthStateChanged(auth, async (fbUser) => {
  // Bridge to existing globals used by v2/index.html
  const g = window;

  if (fbUser) {
    g.isSignedIn = true;
    g.currentUser = fbUser.uid;

    // Load previously saved Firestore state (if any) and apply
    try {
      const remoteState = await loadAppState(fbUser.uid);
      applyAppStateToWindow(remoteState);
    } catch (e) {
      console.error('Failed to load remote state:', e);
    }

    // Migrate any local user data (localStorage-based) to Firestore on first login
    try {
      const localMigratable = collectAppStateFromWindow();
      await saveAppState(fbUser.uid, localMigratable);
    } catch (e) {
      console.error('Failed to save initial state:', e);
    }

    // Route to a protected view via existing function
    try {
      if (typeof g.showView === 'function') g.showView('homePage');
    } catch (e) {
      console.warn('Navigation warning:', e.message);
    }
  } else {
    // Signed out
    // Keep existing logout confirmation flow if app triggers it.
    // Here, just ensure global flags are off so guards work.
    g.isSignedIn = false;
    g.currentUser = null;

    try {
      if (typeof g.showView === 'function') g.showView('landingPage');
    } catch {
      // no-op
    }
  }
});