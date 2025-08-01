// Firestore data helpers for Ultra Focus Mode (ESM)
import { saveAppState, loadAppState } from './firebase.js';

// Save the app's important state to Firestore under users/{uid}/app/state
export async function saveStateToCloud(uid) {
  if (!uid) throw new Error('saveStateToCloud: uid required');
  const g = window;
  const state = {
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
    currentView: g.currentView || 'homePage'
  };
  await saveAppState(uid, state);
}

// Load state from Firestore and apply to window
export async function loadStateFromCloud(uid) {
  if (!uid) throw new Error('loadStateFromCloud: uid required');
  const data = await loadAppState(uid);
  if (!data) return null;
  // Let auth.js own the apply routine to avoid duplication; but if called standalone:
  try {
    if (window && typeof window.updateAchievementLevel === 'function') window.updateAchievementLevel();
  } catch {}
  return data;
}