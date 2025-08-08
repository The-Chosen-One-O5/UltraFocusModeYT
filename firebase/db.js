export async function saveStateToCloud(uid) {
  if (!uid) throw new Error('uid required');
  if (!window.__fbExports || typeof window.__fbExports.saveAppState !== 'function') {
    throw new Error('Firebase shim not initialized');
  }
  // Collect window state similarly to inline code
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
  return window.__fbExports.saveAppState(uid, state);
}

export async function loadStateFromCloud(uid) {
  if (!uid) throw new Error('uid required');
  if (!window.__fbExports || typeof window.__fbExports.loadAppState !== 'function') {
    throw new Error('Firebase shim not initialized');
  }
  return window.__fbExports.loadAppState(uid);
}