// Expose minimal ESM API expected by dynamic imports in v2
export async function loadAppState(uid) {
  if (!window.__fbExports || typeof window.__fbExports.loadAppState !== 'function') {
    throw new Error('Firebase shim not initialized');
  }
  return window.__fbExports.loadAppState(uid);
}

export async function saveAppState(uid, state) {
  if (!window.__fbExports || typeof window.__fbExports.saveAppState !== 'function') {
    throw new Error('Firebase shim not initialized');
  }
  return window.__fbExports.saveAppState(uid, state);
}