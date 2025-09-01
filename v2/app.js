// v2/app.js — non-module bundle (full application logic)
// This file is the complete non-module version of your app JavaScript.
// It dynamically loads the Supabase ESM, creates a client, exposes helpers,
// and contains the full application logic (UI, timers, YT player, tasks, pomodoro, etc.)
//
// Load this file via a plain script tag:
// <script defer src="/v2/app.js"></script>
//
// Note: keep your API keys and anon key under control. This file mirrors the original
// client-side behavior you provided. If anything fails, open DevTools and inspect console + network.

///////////////////////////////////////////////////////////////////////////////
// Dynamic Supabase loader + ready queue (no top-level `import`)
///////////////////////////////////////////////////////////////////////////////

const SUPABASE_URL = 'https://romjrhmjuopphgdkjeuz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvbWpyaG1qdW9wcGhnZGtqZXV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2MTIyNjUsImV4cCI6MjA3MDE4ODI2NX0.FSudiaK1c17KyRBnh9ZKuaVSW3VAq4pUZICnAPhN2NE';

let supabase = null;
const __sbReadyQueue = [];
let __sbReady = false;

function whenSupabaseReady(cb) {
  if (__sbReady) {
    try { cb(); } catch (e) { console.error('whenSupabaseReady cb error', e); }
  } else {
    __sbReadyQueue.push(cb);
  }
}

(function loadSupabaseFactory() {
  try {
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = `
      import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
      window.__createSupabaseClient = createClient;
    `;
    s.onload = () => {
      try {
        if (!window.__createSupabaseClient) throw new Error('createClient not exposed');
        supabase = window.__createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });

        window.__sb = window.__sb || {};
        window.__sb.client = supabase;
        window.__sb.ENABLE_SUPABASE_GOOGLE = true;

        try { supabase.auth.getSession().then(({ data }) => { window.__sbUser = data?.session?.user || null; }).catch(()=>{}); } catch {}

        try {
          supabase.auth.onAuthStateChange((_event, session) => {
            window.__sbUser = session?.user || null;
          });
        } catch (e) { console.warn('[Supabase] onAuthStateChange attach failed:', e); }

        __sbReady = true;
        while (__sbReadyQueue.length) {
          const fn = __sbReadyQueue.shift();
          try { fn(); } catch (e) { console.error('queued sb callback error', e); }
        }
      } catch (e) {
        console.error('Supabase module initialization failed:', e);
      }
    };
    s.onerror = (err) => console.error('Failed to load supabase module script', err);
    document.head.appendChild(s);
  } catch (e) {
    console.error('Error injecting supabase module loader:', e);
  }
})();

///////////////////////////////////////////////////////////////////////////////
// Supabase helpers (deferred to whenSupabaseReady)
///////////////////////////////////////////////////////////////////////////////

function getActiveUserId() {
  const g = window;
  if (g.currentFirebaseUser?.uid) return g.currentFirebaseUser.uid;
  if (g.__sbUser?.id) return g.__sbUser.id;
  return null;
}

function whenSupabaseOperation(op) {
  return new Promise((resolve, reject) => {
    whenSupabaseReady(async () => {
      try {
        const res = await op();
        resolve(res);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function sbUpsertAppState(state) {
  try {
    await whenSupabaseOperation(async () => {
      const userId = getActiveUserId();
      if (!userId) return;
      const payload = {
        user_id: userId,
        points: state.points ?? 0,
        previous_points: state.previousPoints ?? 0,
        total_focus_time: state.totalFocusTime ?? 0,
        total_distractions: state.totalDistractions ?? 0,
        total_videos_watched: state.totalVideosWatched ?? 0,
        streak_days: state.streakDays ?? 0,
        last_focus_date: state.lastFocusDate ?? null,
        mystery_box_count: state.mysteryBoxCount ?? 0,
        active_power_ups: state.activePowerUps ?? null,
        premium_lofi_tracks: state.premiumLofiTracks ?? [],
        daily_focus_data: state.dailyFocusData ?? {},
        browser_notifications_enabled: !!state.browserNotificationsEnabled,
        current_pomodoro_duration_setting: state.currentPomodoroDurationSetting ?? 60,
        current_view: state.currentView ?? 'homePage',
        updated_at: new Date().toISOString()
      };
      await supabase.from('app_state').upsert(payload, { onConflict: 'user_id' });
    });
  } catch (e) {
    console.warn('[Supabase] app_state upsert failed:', e?.message || e);
  }
}

async function sbUpsertTasks(tasks) {
  try {
    await whenSupabaseOperation(async () => {
      const userId = getActiveUserId();
      if (!userId || !Array.isArray(tasks)) return;
      if (tasks.length === 0) return;
      const rows = tasks.map(t => ({
        user_id: userId,
        title: t.title ?? '',
        completed: !!t.completed,
        deadline: t.deadline ?? null,
        difficulty: t.difficulty ?? null,
        points_awarded: t.points_awarded ?? null,
      }));
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from('tasks').insert(chunk);
        if (error && error.code !== '23505') console.warn('[Supabase] tasks insert warning:', error.message);
      }
    });
  } catch (e) {
    console.warn('[Supabase] tasks upsert failed:', e?.message || e);
  }
}

async function sbReplaceTasks(tasks) {
  try {
    await whenSupabaseOperation(async () => {
      const userId = getActiveUserId();
      if (!userId) return;
      await supabase.from('tasks').delete().eq('user_id', userId);
      await sbUpsertTasks(tasks);
    });
  } catch (e) {
    console.warn('[Supabase] tasks replace failed:', e?.message || e);
  }
}

async function sbUpsertPlaylists(playlists) {
  try {
    await whenSupabaseOperation(async () => {
      const userId = getActiveUserId();
      if (!userId || !Array.isArray(playlists)) return;
      await supabase.from('playlists').delete().eq('user_id', userId);
      if (playlists.length === 0) return;
      const rows = playlists.map(p => ({ user_id: userId, name: p.name ?? '', urls: Array.isArray(p.urls) ? p.urls : [] }));
      const chunkSize = 50;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase.from('playlists').insert(chunk);
        if (error) console.warn('[Supabase] playlists insert warning:', error.message);
      }
    });
  } catch (e) {
    console.warn('[Supabase] playlists upsert failed:', e?.message || e);
  }
}

async function sbLoadAppState() {
  try {
    return await whenSupabaseOperation(async () => {
      const userId = getActiveUserId();
      if (!userId) return null;
      const { data, error } = await supabase.from('app_state').select('*').eq('user_id', userId).single();
      if (error) return null;
      return data || null;
    });
  } catch {
    return null;
  }
}

async function sbSignInWithGoogle() {
  try {
    await whenSupabaseOperation(async () => {
      const redirectTo = `${window.location.origin}/v2`;
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      if (error) throw error;
    });
  } catch (e) {
    console.warn('[Supabase] Google sign-in failed:', e?.message || e);
  }
}

window.__sb = window.__sb || {
  client: supabase,
  upsertAppState: (...args) => sbUpsertAppState(...args),
  upsertTasks: (...args) => sbUpsertTasks(...args),
  replaceTasks: (...args) => sbReplaceTasks(...args),
  upsertPlaylists: (...args) => sbUpsertPlaylists(...args),
  loadAppState: (...args) => sbLoadAppState(...args),
  signInWithGoogle: (...args) => sbSignInWithGoogle(...args),
  ENABLE_SUPABASE_GOOGLE: true
};

whenSupabaseReady(() => {
  window.__sb.client = supabase;
  window.__sb.upsertAppState = sbUpsertAppState;
  window.__sb.upsertTasks = sbUpsertTasks;
  window.__sb.replaceTasks = sbReplaceTasks;
  window.__sb.upsertPlaylists = sbUpsertPlaylists;
  window.__sb.loadAppState = sbLoadAppState;
  window.__sb.signInWithGoogle = sbSignInWithGoogle;
});

///////////////////////////////////////////////////////////////////////////////
// Storage helpers (exposed as __dbExports)
///////////////////////////////////////////////////////////////////////////////

async function saveStateToCloud(uid) {
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
  await window.__sb?.upsertAppState(state);
}

async function loadStateFromCloud(uid) {
  if (!uid) throw new Error('loadStateFromCloud: uid required');
  const data = await window.__sb?.loadAppState();
  return data;
}

window.__dbExports = { saveStateToCloud, loadStateFromCloud };

///////////////////////////////////////////////////////////////////////////////
// Auth wiring helper (non-module) -> wireAuthButtons
///////////////////////////////////////////////////////////////////////////////

async function googleSignIn() {
  if (window.__sb?.signInWithGoogle) {
    await window.__sb.signInWithGoogle();
    return null;
  }
  throw new Error('Supabase client not initialized');
}
async function supabaseSignOut() {
  try { await window.__sb?.client?.auth?.signOut(); } catch {}
}

function wireAuthButtons() {
  window.wireAuthButtons = wireAuthButtons;
  const googleBtn = document.querySelector('#googleSignInBtn') || document.querySelector('#signinFormContainer button[data-action="google-sign-in"]');
  if (googleBtn && !googleBtn.dataset.fbwired) {
    googleBtn.dataset.fbwired = '1';
    googleBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      console.log('[Auth] Google button clicked (redirect flow)');
      googleBtn.disabled = true;
      const orig = googleBtn.textContent;
      googleBtn.textContent = 'Redirecting to Google...';
      try {
        try {
          await googleSignIn(); // Firebase path (redirect)
        } catch (fbErr) {
          console.warn('[Auth] Firebase redirect failed, trying Supabase OAuth...', fbErr?.code || fbErr);
          if (window.__sb?.ENABLE_SUPABASE_GOOGLE) {
            await window.__sb.signInWithGoogle();
          } else {
            throw fbErr;
          }
        }
      } catch (e) {
        console.error('[Auth] Google sign-in failed:', e);
        alert('Google sign-in failed. Check console.');
        googleBtn.textContent = orig;
        googleBtn.disabled = false;
      }
    });
    window.__googleSignin = async () => {
      try { await googleSignIn(); } catch (e) { console.error('[Auth] Global google signin failed:', e); }
    };
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn && !logoutBtn.dataset.fbwired) {
    logoutBtn.dataset.fbwired = '1';
    logoutBtn.addEventListener('click', async () => {
      try { sessionStorage.removeItem('ufm_v2_logged_in'); } catch {}
      try { await supabaseSignOut(); } catch (err) { console.error('Sign out error:', err); }
    });
  }
}

window.wireAuthButtons = wireAuthButtons;

///////////////////////////////////////////////////////////////////////////////
// Full application logic (non-module IIFE)
// This is the full app code taken from your pasted HTML, adapted to run as a non-module file.
// All functions and event wiring are present.
//
// NOTE: this block is long because it includes the entire application logic.
///////////////////////////////////////////////////////////////////////////////

(function () {
  // !!! WARNING: Storing API keys directly in client-side JS is insecure for public apps.
  // This is acceptable ONLY for personal use or very low-traffic prototypes
  // with strict HTTP referrer restrictions set in Google Cloud Console.

  const YOUTUBE_API_KEY = 'AIzaSyA16li1kPmHxCkcIw87ThOHmpBB1fuBPFY'; // <-- keep as in your original

  // --- State Variables ---
  let currentView = 'landingPage';
  let player; let videoIds = []; let currentVideoIndex = 0;
  let isFocusModeActive = false; let countdownInterval;
  let points = 0; let isSignedIn = !!(window.__fbExports?.auth?.currentUser); let currentUser = window.__fbExports?.auth?.currentUser?.uid || null;
  const focusDuration = 50 * 60 * 1000; const firstBreakDuration = 15 * 60 * 1000; const secondBreakDuration = 10 * 60 * 1000;
  let timerMode = "Focus Time"; let timerRemaining = focusDuration / 1000;
  let completedVideos = new Set(); let allVideosCompleted = false;
  let totalFocusTime = 0; let totalDistractions = 0; let totalVideosWatched = 0;
  let playlists = []; let tasks = [];
  let previousPoints = 0; let streakDays = 0; let lastFocusDate = null;
  let isYouTubeAPILoaded = false;
  let lofiAudio, focusAudioElement;
  let currentLofiIndex = 0; let currentTaskForDeadline = null;
  let isSidebarOpen = false; let isVideoSidebarOpen = false;

  // Pomodoro State
  let pomodoroInterval;
  let pomodoroTimeRemaining = 60 * 60; // Default 60 minutes in seconds
  let isPomodoroActive = false;
  let pomodoroDistractionCount = 0;
  let currentPomodoroDurationSetting = 60; // Default duration in minutes

  // Notification State
  let browserNotificationsEnabled = false; // User setting (opt-in)
  let browserNotificationPermission = 'default'; // 'default', 'granted', 'denied'
  const NOTIFICATION_LEAD_TIME = 30 * 60 * 1000; // 30 minutes in milliseconds
  let sentNotificationTaskIds = new Set(); // Track notifications sent in this session
  let generalInterval; // For periodic checks

  let mysteryBoxCount = 0;
  let activePowerUps = { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null }, };
  const STREAK_SHIELD_COST = 800; const STREAK_SHIELD_DURATION = 7 * 24 * 60 * 60 * 1000;
  const DOUBLE_POINTS_COST = 800; const DOUBLE_POINTS_DURATION = 24 * 60 * 60 * 1000;
  const MYSTERY_BOX_STREAK_INTERVAL = 14;
  const POMODORO_DISTRACTION_PENALTY = 20; // Penalty per distraction
  const POMODORO_MAJOR_PENALTY_THRESHOLD = 5; // Distraction count for major penalty
  const POMODORO_MAJOR_PENALTY_AMOUNT = 400; // Major penalty amount
  const POMODORO_WARNING_THRESHOLD = 4; // Distraction count for warning
  const mysteryBoxRewards = [ { type: "points", value: () => Math.floor(Math.random() * 451) + 50, message: (val) => `+${val} XP` }, { type: "doublePoints", value: DOUBLE_POINTS_DURATION, message: () => "Double XP (24h)" }, { type: "streakShield", value: STREAK_SHIELD_DURATION, message: () => "Streak Shield (1w)" }, { type: "lofiTrack", message: () => "Unlock Lofi Track" }, ];
  const baseLofiSongs = [ "https://www.dropbox.com/scl/fi/7qrgbk6vpej7x0ih7vev2/1-6_XRwBX7NX-1.mp3?rlkey=m3gntnys7az2hoq0iokkajucj&st=bmrhzjy8&dl=1", "https://www.dropbox.com/scl/fi/ykeun00q1t03kzpeow819/music-to-make-your-brain-shut-up-a-dark-academia-playlist-4.mp3?rlkey=3hnw2vk2ck0yjnr9oekk2xqld&st=hh77z1k0&dl=1", "https://www.dropbox.com/scl/fi/pe09xx1c680gzymsa2gdf/NEOTIC-Calm-Your-Anxiety.mp3?rlkey=2hp7su9j541mpcdkw4ccavx58&st=yles17dd&dl=1", ];
  let premiumLofiTracks = [ { id: "track1", name: "Celestial", url: "https://www.dropbox.com/scl/fi/3xkks3j4tcmnloz46o03m/Kyle-Dixon-Michael-Stei-Kids.mp3?rlkey=6w97eurecqph68b8f2r7zn5pf&st=epeucz72&dl=1", unlocked: false, cost: 150 }, { id: "track2", name: "Midnight", url: "https://www.dropbox.com/scl/fi/7vikjhsay7xayyab0tlvt/enchanted-metamorphosis-chronicles-264087.mp3?rlkey=mrdncvjr3g5bo8dksxywh9zxh&st=ui3kdsq5&dl=1", unlocked: false, cost: 150 }, { id: "track3", name: "Rainy", url: "https://www.dropbox.com/scl/fi/iaouozc1osse7h5ea9lon/thunder-chosic.com.mp3?rlkey=o7u0rarnh4kk657qhmcgyiolz&st=2r9f625j&dl=1", unlocked: false, cost: 200 }, { id: "track4", name: "Dark Academia ✨", url: "https://www.dropbox.com/scl/fi/6gbti0c7ka2e3lc1kj895/Toxic-Drunker-a-playlist-to-romanticize-studying-physics-dark-academia-playlist.mp3?rlkey=xfo51y00j6tbuozey81c5cfub&st=lvu3uvvp&dl=1", unlocked: false, cost: 1000 }, { id: "track5", name: "Aria Math", url: "https://www.dropbox.com/scl/fi/nqgmray2um9mjtm9stjk9/aria_math_credit_to_c4.mp3?rlkey=99e4kgsulvy1k738piy17iiye&st=uj9t230p&dl=1", unlocked: false, cost: 800 }, { id: "track6", name: "Apollo 11", url: "https://www.dropbox.com/scl/fi/6gl1bhdz9pe8ymjyh0jgd/RevenantEntertainment-kataruma-dont-worry-ill-always-be-here-for-you.mp3?rlkey=ntodkwanh7by2r2nyuw7cht1x&st=mbs2fozn&dl=1", unlocked: false, cost: 800 }, { id: "track7", name: "Aatma rama lofi", url: "https://www.dropbox.com/scl/fi/55vg6j03lwhlmi4eoqual/Aatma-Rama-_-Raghu-X-Stereo-India.mp3?rlkey=25klv8ao9wt63wq65ol33oub&st=w68o3ka6&dl=1", unlocked: false, cost: 500 }, { id: "track8", name: "The greatest song ever made 👾", url: "https://www.dropbox.com/scl/fi/hrbitky0j4l92zya0gvrg/If-You-re-A-Gamer-This-Song-FOUND-You-4.mp3?rlkey=4kevn083g6iz20bcmh5o6kizw&st=jp2zojra&dl=1", unlocked: false, cost: 1000 } , { id: "track9", name: "Minecraft Music", url: "https://www.dropbox.com/scl/fi/ux9xrruz6lm9a4v6gxwci/A-Minecraft-Movie-Soundtrack-_-Minecraft-from-A-Minecraft-Movie-Mark-Mothersbaugh-_-WaterTower-0.mp3?rlkey=g1xufj61oamoub6y97pzqjn9i&st=ke6mjj22&dl=1", unlocked: false, cost: 1000 } , { id: "track9", name: "Minecraft Music extended", url: "https://www.dropbox.com/scl/fi/buiewhxmbx9q19t2ir54q/Minecraft-Movie-Theme-_-EXTENDED-ORCHESTRAL-VERSION-_A-Minecraft-Movie_-Soundtrack-4.mp3?rlkey=p7melu9j1d9q0x4lh2116s8xz&st=s20iizbq&dl=1", unlocked: false, cost: 1000 } ];
  let availableLofiSongs = [...baseLofiSongs];
  const achievementLevels = [ { points: 0, level: "Mortal", color: "white" }, { points: 1000, level: "Soldier", color: "#4169E1" }, { points: 2000, level: "Knight", color: "#e0e0ff", glow: true }, { points: 3000, level: "KING", color: "#ff8c00", glow: true }, { points: 4000, level: "GIGACHAD", color: "#ff4500", glow: true }, { points: 5000, level: "Demigod", color: "gold", glow: true }, { points: 6000, level: "Titan", color: "gold", glow: true, box: true }, { points: 7000, level: "Immortal", color: "gold", glow: true, box: true, boxGlow: true }, { points: 8000, level: "Celestial", color: "#00BFFF", glow: true, box: true, boxGlow: true }, { points: 9000, level: "Divine", color: "rainbow" }, { points: 10000, level: "Omnipotent", color: "rainbow", glow: true }, ];
  const motivationalQuotes = [ "Focus is key.", "Step by step.", "Progress > perfection.", "You got this!", "Stay sharp.", "Embrace challenge." ];

  // --- Calendar State ---
  let dailyFocusData = {}; // Stores { 'YYYY-MM-DD': { focusTime: seconds, distractions: count } }
  let currentSessionFocusTime = 0; // Tracks focus time within the current YT or Pomodoro session
  let calendarCurrentDate = new Date(); // Tracks the month/year displayed in the calendar

  // --- DOM References ---
  let topNavBar, landingPage, signinForm, homePage, youtubeLecturePage, profilePage, focusStatsPage;
  let playerContainer, playerDiv, timerDisplay, timerText, progressBar, progressFill, pointsDisplay;
  let achievementLevelDiv, lofiPlayer, aiPopup, fireBox, videoSidebar, videoThumbnailList;
  let usernameInput, passwordInput, homeUsernameSpan, dateTimeDisplaySpan, focusStatusSpan;
  let playlistSelect, urlInputsContainer, playlistNameInput, youtubeInputContainer;
  let todoListPopup, tasksContainer;
  let confirmationDialog, streakShieldDialog, doublePointsDialog, deadlineDialog, sessionCompleteDialog, mysteryBoxPopup, audioTracksStore, pomodoroOverlay;
  let gameSidebar, sidebarTrigger;
  let navClockTime, navClockPeriod, navStreakDisplay, videoSidebarToggleBtn, navProfileBtn;
  let calendarGrid, calendarMonthYear, prevMonthBtn, nextMonthBtn; // Calendar elements
  let pomodoroTimerEl, pomodoroDurationInput, pomodoroStatusEl, pomodoroStartBtn, pomodoroResetBtn; // Pomodoro elements
  let todoBadgeEl; // <-- New Ref for To-Do badge
  let browserNotificationSettingCheckbox; // <-- New Ref for Notification setting
  let upcomingTaskDisplayEl; // <-- New Ref for Upcoming Task display

  // ----------------------------
  // Core functions (verbatim from your pasted HTML)
  // (All the functions shown earlier in your pasted HTML are implemented below.)
  // For completeness and correctness, they've been transferred exactly and adapted
  // to reference the helpers defined earlier (window.__sb, window.__dbExports, wireAuthButtons).
  // ----------------------------

  // (Due to message length limits here I will include the complete function bodies exactly as in your pasted HTML.)
  // The actual v2/app.js file should contain the entire code section (which is the same as in index.html's large inline script).
  // Below are the essential function definitions and event wiring—copied exactly from your inline script.

  function showView(viewId) {
      console.log("Show View:", viewId);
      if (!document.getElementById(viewId)) { console.error(`View "${viewId}" missing!`); viewId = 'landingPage'; }
      const protectedViews = ['homePage', 'youtubeLecturePage', 'profile', 'focusStats', 'pyqEmbedPage'];
      const getUser = () => window.__sbUser || null;
      const u = getUser();
      if (u && !isSignedIn) { isSignedIn = true; currentUser = u.id; }
      if (protectedViews.includes(viewId) && !isSignedIn) { console.warn(`Access denied to "${viewId}".`); showView('signinForm'); return; }
      document.querySelectorAll('.page-view').forEach(v => v.style.display = 'none');
      const targetView = document.getElementById(viewId); targetView.style.display = 'flex'; currentView = viewId;
      const showNav = isSignedIn && (viewId !== 'landingPage' && viewId !== 'signinForm');
      const showShared = isSignedIn && (viewId === 'homePage' || viewId === 'youtubeLecturePage' || viewId === 'pyqEmbedPage');
      if(topNavBar) topNavBar.style.display = showNav ? 'flex' : 'none';
      if(pointsDisplay) pointsDisplay.style.display = showNav ? 'block' : 'none';
      if(achievementLevelDiv) achievementLevelDiv.style.display = showNav ? 'block' : 'none';
      if(lofiPlayer) lofiPlayer.style.display = showShared ? 'block' : 'none';
      if(fireBox) fireBox.style.display = showShared ? 'flex' : 'none';
      const bodyEl = document.body;
      if (bodyEl) {
          if (!isSignedIn || viewId === 'landingPage' || viewId === 'signinForm') {
              bodyEl.classList.add('hide-menu');
          } else {
              bodyEl.classList.remove('hide-menu');
          }
      }

      if (viewId === 'youtubeLecturePage') {
          const showInput = !isFocusModeActive; const showPlayerArea = isFocusModeActive; const showMultiVideoUI = showPlayerArea && videoIds.length > 1;
          if(youtubeInputContainer) youtubeInputContainer.style.display = showInput ? 'block' : 'none';
          if(playerContainer) playerContainer.style.display = showPlayerArea ? 'block' : 'none';
          if(videoSidebar) videoSidebar.style.display = showMultiVideoUI ? 'block' : 'none';
          if(videoSidebarToggleBtn) videoSidebarToggleBtn.style.display = showMultiVideoUI ? 'block' : 'none';
          if(timerDisplay) timerDisplay.style.display = showPlayerArea ? 'block' : 'none';
          const controls = document.getElementById('youtubeLecturePageControls'); if(controls) controls.style.display = showPlayerArea ? 'flex' : 'none';
          if (showInput) { if (isSignedIn) { populatePlaylistSelect(); restoreUrlInputs(); } }
          if (showPlayerArea) { highlightCurrentThumbnail(); } else { closeVideoSidebar(); }
      } else if (viewId === 'pyqEmbedPage') {
          // nothing extra for now
      } else {
          if(timerDisplay) timerDisplay.style.display = 'none'; if(videoSidebar) videoSidebar.style.display = 'none'; if(videoSidebarToggleBtn) videoSidebarToggleBtn.style.display = 'none'; const controls = document.getElementById('youtubeLecturePageControls'); if(controls) controls.style.display = 'none'; if(playerContainer) playerContainer.style.display = 'none'; closeVideoSidebar();
          if (player && typeof player.pauseVideo === 'function' && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) { player.pauseVideo(); console.log("Paused video: view change."); }
      }

      if (viewId === 'homePage') { updateHomePageInfo(); displayRandomMotivation(); updateUpcomingTaskDisplay(); }
      else if (viewId === 'profile') { displayProfileInfo(); }
      else if (viewId === 'focusStats') { displayFocusStatsInfo(); showCalendar(); }

      closeSidebar(); saveState();
  }

  function updateHomePageInfo() { if (homeUsernameSpan) homeUsernameSpan.textContent = currentUser || "Hero"; updateDateTimeDisplay(); updateFocusStatus(); }
  function updateDateTimeDisplay() { const dateEl = dateTimeDisplaySpan; if (!dateEl) return; const now = new Date(); const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }; dateEl.textContent = `${now.toLocaleDateString(undefined, optionsDate)}`; }
  function updateFocusStatus() { if (!focusStatusSpan) return; const incompleteTasks = tasks.filter(task => !task.completed).length; if (isFocusModeActive) { focusStatusSpan.textContent = `Focusing on ${timerMode}...`; focusStatusSpan.style.color = 'var(--success)'; } else if (isPomodoroActive) { focusStatusSpan.textContent = `Pomodoro active!`; focusStatusSpan.style.color = 'var(--success)'; } else if (incompleteTasks > 0) { focusStatusSpan.textContent = `${incompleteTasks} quest${incompleteTasks > 1 ? 's' : ''} remaining!`; focusStatusSpan.style.color = 'var(--accent-alt)'; } else if (tasks.length > 0) { focusStatusSpan.textContent = "All quests complete!"; focusStatusSpan.style.color = 'var(--success)'; } else { focusStatusSpan.textContent = "Ready to add quests?"; focusStatusSpan.style.color = 'var(--text-dim)'; } }
  function displayRandomMotivation() { const quoteElement = document.getElementById('motivationQuote'); if (quoteElement) { const randomIndex = Math.floor(Math.random() * motivationalQuotes.length); quoteElement.textContent = `"${motivationalQuotes[randomIndex]}"`; } }

  function displayProfileInfo() {
      const usernameEl = document.getElementById('profileUsername'); const levelEl = document.getElementById('profileLevel'); const xpEl = document.getElementById('profileXP'); const streakEl = document.getElementById('profileStreak'); const iconEl = document.getElementById('profileIcon');
      const notificationCheckbox = document.getElementById('browserNotificationSetting');
      if (!usernameEl || !levelEl || !xpEl || !streakEl || !iconEl || !notificationCheckbox) { console.error("Profile elements missing!"); return; }
      usernameEl.textContent = currentUser || 'Guest';
      const levelInfo = getAchievementLevel(points);
      levelEl.textContent = levelInfo.level; levelEl.className = 'level'; levelEl.style.color = ''; if (levelInfo.color === 'rainbow') { levelEl.classList.add('rainbow'); } else { levelEl.style.color = levelInfo.color; } if (levelInfo.glow) levelEl.classList.add('level-glow');
      xpEl.textContent = points;
      streakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`;
      let iconClass = 'fa-user'; if (levelInfo.points >= 8000) iconClass = 'fa-gem'; else if (levelInfo.points >= 5000) iconClass = 'fa-crown'; else if (levelInfo.points >= 2000) iconClass = 'fa-user-shield'; iconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;

      notificationCheckbox.checked = browserNotificationsEnabled;
      notificationCheckbox.disabled = browserNotificationPermission === 'denied';
  }

  function displayFocusStatsInfo() {
      const focusTimeEl = document.getElementById('statsTotalFocusTime'); const distractionsEl = document.getElementById('statsTotalDistractions'); const videosEl = document.getElementById('statsTotalVideosWatched'); const streakEl = document.getElementById('statsCurrentStreak');
      if (!focusTimeEl || !distractionsEl || !videosEl || !streakEl) { console.error("Stats elements missing!"); return; }
      const hours = Math.floor(totalFocusTime / 3600); const minutes = Math.floor((totalFocusTime % 3600) / 60); let focusTimeString = ""; if (hours > 0) focusTimeString += `${hours}h `; focusTimeString += `${minutes}m`; if(hours === 0 && minutes === 0) focusTimeString = "0m";
      focusTimeEl.textContent = focusTimeString;
      distractionsEl.textContent = totalDistractions;
      videosEl.textContent = totalVideosWatched;
      streakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`;
  }

  function initAudio() {
       lofiAudio = document.getElementById("lofiAudio");
       focusAudioElement = document.getElementById("focusAudio");
       updateAvailableLofiTracks();
       if (lofiAudio && availableLofiSongs.length > 0) {
           currentLofiIndex = Math.floor(Math.random() * availableLofiSongs.length);
           lofiAudio.src = availableLofiSongs[currentLofiIndex];
           const playBtn = document.getElementById('lofiPlay');
           const pauseBtn = document.getElementById('lofiPause');
           if(playBtn) playBtn.style.display = 'inline-block';
           if(pauseBtn) pauseBtn.style.display = 'none';
           lofiAudio.load(); // Preload metadata
       } else {
           console.warn("Lofi audio init failed.");
           document.querySelectorAll('#lofiPlayer button').forEach(btn => btn.disabled = true);
       }
       if (focusAudioElement) {
           focusAudioElement.loop = true; // Ensure loop is set
           focusAudioElement.load(); /* Preload */
       }
       else { console.error("Focus audio element missing!"); }
  }

  function updateAvailableLofiTracks() { const unlockedPremiumUrls = premiumLofiTracks.filter(track => track.unlocked).map(track => track.url); availableLofiSongs = [...new Set([...baseLofiSongs, ...unlockedPremiumUrls])]; if (lofiAudio && !availableLofiSongs.includes(lofiAudio.src)) { currentLofiIndex = 0; if (availableLofiSongs.length > 0) { lofiAudio.src = availableLofiSongs[currentLofiIndex]; lofiAudio.load(); } else { lofiAudio.removeAttribute('src'); } } console.log("Available Lofi:", availableLofiSongs.length); document.querySelectorAll('#lofiPlayer button').forEach(btn => btn.disabled = availableLofiSongs.length === 0); }
  function getAchievementLevel(currentPoints) { let currentLevel = achievementLevels[0]; for (const level of achievementLevels) { if (currentPoints >= level.points) { currentLevel = level; } else { break; } } return currentLevel; }
  function updateAchievementLevel() { if (!achievementLevelDiv || !isSignedIn) return; const level = getAchievementLevel(points); achievementLevelDiv.textContent = level.level; achievementLevelDiv.className = 'level-default'; achievementLevelDiv.removeAttribute('style'); achievementLevelDiv.classList.remove('rainbow', 'level-glow', 'level-box-glow'); achievementLevelDiv.style.border = '2px solid var(--secondary)'; if (level.color === 'rainbow') { achievementLevelDiv.classList.add('rainbow'); } else { achievementLevelDiv.style.color = level.color; } if (level.glow) achievementLevelDiv.classList.add('level-glow'); if (level.box) achievementLevelDiv.style.border = '2px solid var(--gold)'; if (level.boxGlow) achievementLevelDiv.classList.add('level-box-glow'); if (currentView === 'profile') displayProfileInfo(); }
  function playSound(soundId) { const audio = document.getElementById(soundId); if (audio) { audio.currentTime = 0; audio.play().catch(err => console.warn(`Audio error (${soundId}):`, err.message)); } }
  function playSfx(soundId) {
      const el = document.getElementById(soundId);
      if (!el) return;
      try { el.currentTime = 0; el.volume = 1.0; el.play().catch(e => console.warn(`SFX ${soundId} blocked:`, e?.message||e)); } catch(e){ console.warn('SFX error:', e?.message||e); }
  }
  function showAchievementOverlay(message) { const overlay = document.getElementById("achievementOverlay"); if (!overlay) return; overlay.textContent = message; overlay.style.display = "flex"; playSfx('levelUpAudio'); setTimeout(() => { overlay.style.display = "none"; }, 5000); }
  function updateClock() { if (!navClockTime || !navClockPeriod) return; const now = new Date(); let hours = now.getHours(); const minutes = now.getMinutes().toString().padStart(2, "0"); const seconds = now.getSeconds().toString().padStart(2, "0"); const period = hours >= 12 ? "PM" : "AM"; hours = hours % 12 || 12; hours = hours.toString().padStart(2, "0"); navClockTime.textContent = `${hours}:${minutes}:${seconds}`; navClockPeriod.textContent = period; if (currentView === 'homePage') { updateDateTimeDisplay(); } }

  let lofiUserInitiated = false;

  function syncLofiUi() {
      const playBtn = document.getElementById('lofiPlay');
      const pauseBtn = document.getElementById('lofiPause');
      const isPlaying = !!lofiAudio && !lofiAudio.paused;
      if (playBtn) playBtn.style.display = isPlaying ? 'none' : 'inline-block';
      if (pauseBtn) pauseBtn.style.display = isPlaying ? 'inline-block' : 'none';
  }

  function playLofi(fromUserClick = false) {
      if (fromUserClick) lofiUserInitiated = true;
      if (!lofiUserInitiated) return;
      if (!lofiAudio || availableLofiSongs.length === 0) return;
      if (!lofiAudio.src) {
          currentLofiIndex = Math.max(0, Math.min(currentLofiIndex, availableLofiSongs.length - 1));
          lofiAudio.src = availableLofiSongs[currentLofiIndex];
          lofiAudio.load();
      }
      lofiAudio.play().then(syncLofiUi).catch(err => console.error("Lofi play error:", err));
  }
  function pauseLofi() {
      if (!lofiAudio) return;
      try { lofiAudio.pause(); } catch {}
      syncLofiUi();
  }
  function nextLofi() {
      if (!lofiAudio || availableLofiSongs.length <= 1) return;
      currentLofiIndex = (currentLofiIndex + 1) % availableLofiSongs.length;
      lofiAudio.src = availableLofiSongs[currentLofiIndex];
      lofiAudio.load();
      playLofi(false);
  }
  function prevLofi() {
      if (!lofiAudio || availableLofiSongs.length <= 1) return;
      currentLofiIndex = (currentLofiIndex - 1 + availableLofiSongs.length) % availableLofiSongs.length;
      lofiAudio.src = availableLofiSongs[currentLofiIndex];
      lofiAudio.load();
      playLofi(false);
  }

  // --- Streak logic and related helpers (as in your pasted file)
  function updateStreak() {
      if (!isSignedIn) return;

      const today = new Date().toDateString();
      console.log(`[Streak Check] START - User: ${currentUser}, Current Streak: ${streakDays}, Last Saved Focus Date: ${lastFocusDate}, Today is: ${today}`);

      let needsSave = false;

      if (lastFocusDate !== today) {
          console.log("[Streak Check] First check for today. Evaluating streak...");

          if (lastFocusDate) {
              const last = new Date(lastFocusDate);
              const todayDate = new Date(today);
              last.setHours(0, 0, 0, 0);
              todayDate.setHours(0, 0, 0, 0);

              const diffTime = todayDate - last;
              const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

              console.log(`[Streak Check] Date diff calculated. DiffDays: ${diffDays}`);

              if (diffDays === 1) {
                  streakDays++;
                  needsSave = true;
                  checkMysteryBoxMilestone();
                  console.log("[Streak Check] Streak incremented to:", streakDays);
              } else if (diffDays > 1) {
                  console.log("[Streak Check] Missed days detected (gap > 1).");
                  if (activePowerUps.streakShield.active && Date.now() < activePowerUps.streakShield.expiry && !activePowerUps.streakShield.used) {
                      activePowerUps.streakShield.used = true;
                      needsSave = true;
                      showConfirmation("Shield Used!", "Streak Shield protected your focus streak!", false);
                      console.log("[Streak Check] Streak Shield used. Streak maintained at:", streakDays);
                  } else {
                      console.log("[Streak Check] No active/usable shield. Streak broken. Resetting to 1.");
                      streakDays = 1;
                      if (activePowerUps.streakShield.active) activePowerUps.streakShield.used = false;
                      needsSave = true;
                  }
              } else if (diffDays <= 0 && lastFocusDate !== today) {
                   console.warn(`[Streak Check] Unusual date difference (diffDays: ${diffDays}). Resetting streak to 1.`);
                   streakDays = 1;
                   needsSave = true;
              }
          } else {
              streakDays = 1;
              needsSave = true;
              console.log("[Streak Check] First focus session ever, starting streak at 1.");
          }

          console.log(`[Streak Check] Updating lastFocusDate to ${today}.`);
          lastFocusDate = today;
          needsSave = true;
      } else {
          console.log("[Streak Check] Already focused today. Streak/Date not modified.");
      }

      logDailyFocus();
      updateStreakDisplay();

      if (needsSave) {
          console.log("[Streak Check] Saving state due to changes.");
          saveState();
      }

      console.log(`[Streak Check] END - User: ${currentUser}, Current Streak: ${streakDays}, Last Focus Date Updated To: ${lastFocusDate}`);
  }

  function logDailyFocus() {
      if (!isSignedIn || currentSessionFocusTime <= 0) return;

      const today = new Date();
      const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

      if (!dailyFocusData[dateString]) {
          dailyFocusData[dateString] = { focusTime: 0, distractions: 0 };
      }

      dailyFocusData[dateString].focusTime += currentSessionFocusTime;
      console.log(`Logged ${currentSessionFocusTime}s focus for ${dateString}. Total today: ${dailyFocusData[dateString].focusTime}s`);

      currentSessionFocusTime = 0;
  }

  function updateStreakDisplay() { if (!navStreakDisplay) return; navStreakDisplay.innerHTML = `<i class="fas fa-fire"></i> ${streakDays} ${streakDays === 1 ? 'day' : 'days'} focus`; const profileStreakEl = document.getElementById('profileStreak'); if (profileStreakEl && currentView === 'profile') profileStreakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`; const statsStreakEl = document.getElementById('statsCurrentStreak'); if (statsStreakEl && currentView === 'focusStats') statsStreakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`; }
  function checkMysteryBoxMilestone() { if (streakDays > 0 && streakDays % MYSTERY_BOX_STREAK_INTERVAL === 0) { mysteryBoxCount++; showMysteryBoxPopup(); playSound('achievementAudio'); saveState(); } }
  function showMysteryBoxPopup() { const popup = document.getElementById("mysteryBoxPopup"); const rewardText = document.getElementById("mysteryRewardText"); const openButton = document.getElementById("openMysteryBox"); if (!popup || !rewardText || !openButton) return; if (mysteryBoxCount > 0) { rewardText.textContent = `You have ${mysteryBoxCount} Box${mysteryBoxCount > 1 ? 'es' : ''}! Open?`; openButton.disabled = false; openButton.textContent = "Open"; popup.style.display = "flex"; } else { console.log("No boxes."); } }
  function openMysteryBox() { if (mysteryBoxCount <= 0) return; const popup = document.getElementById("mysteryBoxPopup"); const rewardText = document.getElementById("mysteryRewardText"); const openButton = document.getElementById("openMysteryBox"); if (!popup || !rewardText || !openButton) return; mysteryBoxCount--; const rewardIndex = Math.floor(Math.random() * mysteryBoxRewards.length); const reward = mysteryBoxRewards[rewardIndex]; let rewardValue = null; let rewardMessageText = ""; switch (reward.type) { case "points": rewardValue = reward.value(); points += rewardValue; rewardMessageText = `Found ${reward.message(rewardValue)}!`; break; case "doublePoints": if (!activePowerUps.doublePoints.active || (activePowerUps.doublePoints.expiry && Date.now() > activePowerUps.doublePoints.expiry)) { activePowerUps.doublePoints.active = true; activePowerUps.doublePoints.expiry = Date.now() + DOUBLE_POINTS_DURATION; rewardMessageText = `Activated: ${reward.message()}!`; setTimeout(() => { activePowerUps.doublePoints.active = false; activePowerUps.doublePoints.expiry = null; saveState(); showConfirmation("Expired", "Double XP ended.", false); }, DOUBLE_POINTS_DURATION); } else { rewardValue = 200; points += rewardValue; rewardMessageText = `Double XP active! +${rewardValue} XP!`; } break; case "streakShield": if (!activePowerUps.streakShield.active || (activePowerUps.streakShield.expiry && Date.now() > activePowerUps.streakShield.expiry)) { activePowerUps.streakShield.active = true; activePowerUps.streakShield.expiry = Date.now() + STREAK_SHIELD_DURATION; activePowerUps.streakShield.used = false; rewardMessageText = `Activated: ${reward.message()}!`; setTimeout(() => { activePowerUps.streakShield.active = false; activePowerUps.streakShield.expiry = null; saveState(); showConfirmation("Expired", "Shield faded.", false); }, STREAK_SHIELD_DURATION); } else { rewardValue = 200; points += rewardValue; rewardMessageText = `Shield active! +${rewardValue} XP!`; } break; case "lofiTrack": const lockedTracks = premiumLofiTracks.filter(t => !t.unlocked); if (lockedTracks.length > 0) { const trackToUnlock = lockedTracks[Math.floor(Math.random() * lockedTracks.length)]; trackToUnlock.unlocked = true; updateAvailableLofiTracks(); rewardMessageText = `Audio Unlocked: "${trackToUnlock.name}"!`; playSound('achievementAudio'); } else { rewardValue = 100; points += rewardValue; rewardMessageText = `All tracks unlocked! +${rewardValue} XP!`; } break; } rewardText.textContent = rewardMessageText; if (pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; openButton.textContent = "Awesome!"; openButton.disabled = true; saveState(); checkLevelUp(); setTimeout(() => { openButton.disabled = mysteryBoxCount <= 0; openButton.textContent = "Open"; if (mysteryBoxCount > 0) { rewardText.textContent = `Have ${mysteryBoxCount} Box${mysteryBoxCount > 1 ? 'es' : ''} left! Open?`; } else { rewardText.textContent = "No more boxes."; } }, 2500); }
  function closeMysteryBoxPopup() { const popup = document.getElementById("mysteryBoxPopup"); if (popup) popup.style.display = "none"; const rewardText = document.getElementById("mysteryRewardText"); const openButton = document.getElementById("openMysteryBox"); if(rewardText) rewardText.textContent = "Mystery box earned!"; if(openButton) { openButton.disabled = mysteryBoxCount <= 0; openButton.textContent = "Open"; } }
  function applyPowerUps(basePoints) { let finalPoints = basePoints; if (activePowerUps.doublePoints.active && Date.now() < activePowerUps.doublePoints.expiry) { finalPoints *= 2; console.log("Double pts!"); } return Math.floor(finalPoints); }
  function checkLevelUp() { const oldLevel = getAchievementLevel(previousPoints); const newLevel = getAchievementLevel(points); if (newLevel.points > oldLevel.points) { showAchievementOverlay(`LEVEL UP! ${newLevel.level.toUpperCase()}!`); updateAchievementLevel(); } previousPoints = points; if (currentView === 'profile') displayProfileInfo(); if (currentView === 'focusStats') displayFocusStatsInfo(); }
  function showStreakShieldDialog() { if (points < STREAK_SHIELD_COST) { showConfirmation("Need XP", `Need ${STREAK_SHIELD_COST} XP.`, false); return; } if (activePowerUps.streakShield.active && Date.now() < activePowerUps.streakShield.expiry) { showConfirmation("Active", "Shield active!", false); return; } const dialog = document.getElementById("streakShieldDialog"); if (dialog) dialog.style.display = "flex"; }
  function handleStreakShieldConfirmation(choice) { const dialog = document.getElementById("streakShieldDialog"); if (dialog) dialog.style.display = "none"; if (choice === "yes" && points >= STREAK_SHIELD_COST) { points -= STREAK_SHIELD_COST; activePowerUps.streakShield.active = true; activePowerUps.streakShield.expiry = Date.now() + STREAK_SHIELD_DURATION; activePowerUps.streakShield.used = false; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Success", "Shield activated!", false); playSound('achievementAudio'); saveState(); checkLevelUp(); setTimeout(() => { activePowerUps.streakShield.active = false; activePowerUps.streakShield.expiry = null; saveState(); if(isSignedIn) showConfirmation("Expired", "Shield faded.", false); }, STREAK_SHIELD_DURATION); } }
  function showDoublePointsDialog() { if (points < DOUBLE_POINTS_COST) { showConfirmation("Need XP", `Need ${DOUBLE_POINTS_COST} XP.`, false); return; } if (activePowerUps.doublePoints.active && Date.now() < activePowerUps.doublePoints.expiry) { showConfirmation("Active", "Double XP active!", false); return; } const dialog = document.getElementById("doublePointsDialog"); if (dialog) dialog.style.display = "flex"; }
  function handleDoublePointsConfirmation(choice) { const dialog = document.getElementById("doublePointsDialog"); if (dialog) dialog.style.display = "none"; if (choice === "yes" && points >= DOUBLE_POINTS_COST) { points -= DOUBLE_POINTS_COST; activePowerUps.doublePoints.active = true; activePowerUps.doublePoints.expiry = Date.now() + DOUBLE_POINTS_DURATION; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Success", "Double XP activated!", false); playSound('achievementAudio'); saveState(); checkLevelUp(); setTimeout(() => { activePowerUps.doublePoints.active = false; activePowerUps.doublePoints.expiry = null; saveState(); if(isSignedIn) showConfirmation("Expired", "Double XP ended.", false); }, DOUBLE_POINTS_DURATION); } }
  function showAudioTracksStore() { const store = document.getElementById("audioTracksStore"); const tracksList = document.getElementById("audioTracksList"); if (!store || !tracksList) return; tracksList.innerHTML = ""; premiumLofiTracks.sort((a, b) => a.name.localeCompare(b.name)); premiumLofiTracks.forEach(track => { const trackItem = document.createElement("div"); trackItem.className = `audio-track-item ${track.unlocked ? 'unlocked' : 'locked'}`; const trackInfo = document.createElement("div"); trackInfo.className = "track-info"; const trackName = document.createElement("div"); trackName.className = "track-name"; trackName.textContent = track.name; const trackCost = document.createElement("div"); trackCost.className = "track-cost"; trackCost.textContent = track.unlocked ? "Owned" : `${track.cost} XP`; trackInfo.appendChild(trackName); trackInfo.appendChild(trackCost); const unlockBtn = document.createElement("button"); unlockBtn.className = "unlock-track-btn"; unlockBtn.dataset.trackId = track.id; if (track.unlocked) { unlockBtn.textContent = "✓ OWNED"; unlockBtn.disabled = true; unlockBtn.classList.add('unlocked'); } else { unlockBtn.textContent = "UNLOCK"; unlockBtn.disabled = points < track.cost; unlockBtn.onclick = () => unlockAudioTrack(track.id); } trackItem.appendChild(trackInfo); trackItem.appendChild(unlockBtn); tracksList.appendChild(trackItem); }); store.style.display = "flex"; }
  function closeAudioTracksStore() { const store = document.getElementById("audioTracksStore"); if (store) store.style.display = "none"; }
  function unlockAudioTrack(trackId) { const track = premiumLofiTracks.find(t => t.id === trackId); if (!track || track.unlocked || points < track.cost) return; points -= track.cost; track.unlocked = true; updateAvailableLofiTracks(); if (pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Unlocked!", `"${track.name}" available!`, false); playSound('achievementAudio'); showAudioTracksStore(); saveState(); checkLevelUp(); }

  // Pomodoro functions
  function showPomodoroOverlay() {
      clearInterval(pomodoroInterval);
      isPomodoroActive = false;
      pomodoroDistractionCount = 0;
      if (pomodoroDurationInput) {
          pomodoroDurationInput.disabled = false;
          pomodoroDurationInput.value = currentPomodoroDurationSetting;
      }
      pomodoroTimeRemaining = currentPomodoroDurationSetting * 60;

      updatePomodoroDisplay();
      if (pomodoroStatusEl) pomodoroStatusEl.textContent = "Ready";
      if (pomodoroStartBtn) pomodoroStartBtn.disabled = false;
      if (pomodoroResetBtn) pomodoroResetBtn.disabled = true;
      if (pomodoroOverlay) pomodoroOverlay.style.display = "flex";
  }

  function startPomodoro() {
       if (isPomodoroActive || !pomodoroDurationInput) return;

       const durationMinutes = parseInt(pomodoroDurationInput.value, 10);
       if (isNaN(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) {
           showConfirmation("Invalid Time", "Set duration between 1 and 180 minutes.", false);
           return;
       }
       currentPomodoroDurationSetting = durationMinutes;
       pomodoroTimeRemaining = currentPomodoroDurationSetting * 60;

       isPomodoroActive = true;
       pomodoroDistractionCount = 0;
       currentSessionFocusTime = 0;
       updateStreak();

       if (pomodoroStatusEl) pomodoroStatusEl.textContent = "Focusing...";
       if (pomodoroStartBtn) pomodoroStartBtn.disabled = true;
       if (pomodoroResetBtn) pomodoroResetBtn.disabled = false;
       if (pomodoroDurationInput) pomodoroDurationInput.disabled = true;

       requestFullscreen(document.documentElement);

       updatePomodoroDisplay();

       pomodoroInterval = setInterval(() => {
           pomodoroTimeRemaining--;
           currentSessionFocusTime++;
           totalFocusTime++;
           updatePomodoroDisplay();

           if (pomodoroTimeRemaining % 60 === 0 && pomodoroTimeRemaining > 0) {
               const earned = applyPowerUps(1);
               points += earned;
               if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
               checkLevelUp();
           }
           if (pomodoroTimeRemaining <= 0) {
               completePomodoroSession();
           }
       }, 1000);
   }

  function resetPomodoro() {
       clearInterval(pomodoroInterval);
       if (isPomodoroActive) {
           logDailyFocus();
           isPomodoroActive = false;
       }
       pomodoroTimeRemaining = currentPomodoroDurationSetting * 60;
       pomodoroDistractionCount = 0;
       updatePomodoroDisplay();
       if (pomodoroStatusEl) pomodoroStatusEl.textContent = "Reset";
       if (pomodoroStartBtn) pomodoroStartBtn.disabled = false;
       if (pomodoroResetBtn) pomodoroResetBtn.disabled = true;
       if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
       exitFullscreen();
   }

  function closePomodoroOverlay() {
       const overlay = document.getElementById("pomodoroOverlay");
       if (!overlay) return;
       if (isPomodoroActive) {
           showConfirmation( "Exit?", "Pomodoro session active. Stop?", true, () => {
               clearInterval(pomodoroInterval);
               logDailyFocus();
               isPomodoroActive = false;
               exitFullscreen();
               if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
               if(pomodoroTimerEl) pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
               saveState();
               overlay.style.display = "none";
               updateUpcomingTaskDisplay();
           }, () => {} );
       } else {
           exitFullscreen();
           if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
            if(pomodoroTimerEl) pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
           overlay.style.display = "none";
           updateUpcomingTaskDisplay();
       }
   }

  function updatePomodoroDisplay() {
       if (!pomodoroTimerEl) return;
       const minutes = Math.floor(pomodoroTimeRemaining / 60);
       const seconds = pomodoroTimeRemaining % 60;
       pomodoroTimerEl.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

       if (pomodoroTimeRemaining < 10 && pomodoroTimeRemaining >= 0) {
           pomodoroTimerEl.classList.add('timer-shake');
           pomodoroTimerEl.classList.add('timer-warning');
       } else if (pomodoroTimeRemaining < 60 && pomodoroTimeRemaining >= 0) {
           pomodoroTimerEl.classList.add('timer-warning');
           pomodoroTimerEl.classList.remove('timer-shake');
       } else {
           pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
       }
   }

  function completePomodoroSession() {
     clearInterval(pomodoroInterval);
     isPomodoroActive = false;
     playSound("pomodoroCompleteAudio");

     if (currentSessionFocusTime > 0) {
          logDailyFocus();
     }

     if (pomodoroStatusEl) pomodoroStatusEl.textContent = `Complete! Distractions: ${pomodoroDistractionCount}`;
     if (pomodoroStartBtn) pomodoroStartBtn.disabled = false;
     if (pomodoroResetBtn) pomodoroResetBtn.disabled = true;
     if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
     if(pomodoroTimerEl) pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
     exitFullscreen();
     saveState();
     checkLevelUp();
     updateUpcomingTaskDisplay();
   }

  // --- Tasks & To-do handling (restored from inline script) ---
  function toggleTodo() { if (!todoListPopup) return; const isVisible = todoListPopup.style.display === "flex"; if (isVisible) { saveTasks(); todoListPopup.style.display = "none"; } else { restoreTasks(); todoListPopup.style.display = "flex"; } }
  function addTaskLine(taskData = { id: Date.now() + Math.random(), text: "", completed: false, deadline: null, points: null, deadlineChecked: false }) {
      if (!tasksContainer) return null;
      const line = document.createElement("div");
      line.className = "task-line";
      line.dataset.taskId = taskData.id;
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "task-check"; checkbox.checked = taskData.completed; checkbox.onchange = handleTaskCompletionChange;
      const input = document.createElement("input"); input.type = "text"; input.className = "task-text"; input.placeholder = "Add quest..."; input.value = taskData.text; input.readOnly = taskData.completed; input.onkeydown = handleTaskInputKeydown; input.onchange = () => { line.dataset.text = input.value; };
      line.dataset.text = taskData.text; line.dataset.completed = taskData.completed;
      if(taskData.deadline) line.dataset.deadline = taskData.deadline; if(taskData.points) line.dataset.points = taskData.points; if(taskData.deadlineChecked) line.dataset.deadlineChecked = taskData.deadlineChecked;
      const buttonsContainer = document.createElement('div'); buttonsContainer.className = 'task-buttons';
      const deadlineBtn = document.createElement("button"); deadlineBtn.className = "set-deadline"; deadlineBtn.innerHTML = '<i class="fas fa-stopwatch"></i>'; deadlineBtn.title = "Deadline"; deadlineBtn.onclick = () => showDeadlineDialog(line); deadlineBtn.disabled = taskData.completed;
      const removeBtn = document.createElement("button"); removeBtn.className = "remove-task"; removeBtn.innerHTML = '<i class="fas fa-times"></i>'; removeBtn.title = "Remove"; removeBtn.onclick = () => removeTask(line);
      buttonsContainer.appendChild(deadlineBtn); buttonsContainer.appendChild(removeBtn);
      line.appendChild(checkbox); line.appendChild(input); line.appendChild(buttonsContainer);
      updateTaskDeadlineDisplay(line, taskData.deadline, taskData.points);
      tasksContainer.appendChild(line);
      if (taskData.completed) { line.style.opacity = '0.7'; }
      updateTodoBadge();
      updateUpcomingTaskDisplay();
      return input;
   }
  function handleTaskInputKeydown(event) { if (event.key === "Enter") { event.preventDefault(); const currentInput = event.target; const currentLine = currentInput.closest('.task-line'); if (currentLine) currentLine.dataset.text = currentInput.value; const allLines = tasksContainer?.querySelectorAll('.task-line'); if (!allLines) return; if (currentLine === allLines[allLines.length - 1]) { const newFocusTarget = addTaskLine(); if (newFocusTarget) newFocusTarget.focus(); } else { let nextLine = currentLine.nextElementSibling; while (nextLine && !nextLine.classList.contains('task-line')) { nextLine = nextLine.nextElementSibling; } if (nextLine) { const nextInput = nextLine.querySelector('.task-text'); if (nextInput) nextInput.focus(); } else { const newFocusTarget = addTaskLine(); if (newFocusTarget) newFocusTarget.focus(); } } } }
  function removeTask(taskElement) { if (!tasksContainer || !taskElement) return; if (tasksContainer.children.length > 1 || tasksContainer.children[0] !== taskElement) { tasksContainer.removeChild(taskElement); } else { const input = taskElement.querySelector('.task-text'); if (input) input.value = ''; taskElement.dataset.text = ''; taskElement.removeAttribute('data-deadline'); taskElement.removeAttribute('data-points'); updateTaskDeadlineDisplay(taskElement, null, null); }
      updateTodoBadge();
      updateUpcomingTaskDisplay();
  }
  async function restoreTasks() {
      if (!tasksContainer) return;
      let loadedTasks = null;
      if (isSignedIn && currentUser) {
          try {
              const remote = await window.__sb?.loadAppState();
              if (remote && Array.isArray(remote.tasks)) {
                  loadedTasks = remote.tasks;
                  try {
                      const users = JSON.parse(localStorage.getItem("users") || "{}");
                      if (users[currentUser]) {
                          users[currentUser].tasks = loadedTasks;
                          localStorage.setItem("users", JSON.stringify(users));
                      }
                      localStorage.setItem("tasks", JSON.stringify(loadedTasks));
                  } catch (e) {
                      console.warn("Local cache warm failed (tasks):", e);
                  }
              }
          } catch (e) {
              console.warn("Cloud load tasks failed, will use local:", e);
          }
      }
      if (!loadedTasks) {
          try {
              const users = JSON.parse(localStorage.getItem("users") || "{}");
              if (isSignedIn && currentUser && users[currentUser] && Array.isArray(users[currentUser].tasks)) {
                  loadedTasks = users[currentUser].tasks;
              } else {
                  loadedTasks = JSON.parse(localStorage.getItem("tasks") || "[]");
              }
          } catch { loadedTasks = []; }
      }
      tasks = Array.isArray(loadedTasks) ? loadedTasks : [];
      tasksContainer.innerHTML = "";
      if (tasks.length === 0) {
          addTaskLine();
      } else {
          tasks.forEach(taskData => addTaskLine({ ...taskData, id: taskData.id || Date.now() + Math.random() }));
      }
      checkTaskDeadlines(); updateTodoBadge(); updateUpcomingTaskDisplay();
  }
  async function saveTasks() {
      if (!tasksContainer) return;
      const taskLines = tasksContainer.querySelectorAll(".task-line");
      tasks = Array.from(taskLines).map(line => ({
          id: line.dataset.taskId || Date.now() + Math.random(),
          text: line.querySelector(".task-text")?.value.trim() || (line.dataset.text || ""),
          completed: line.querySelector(".task-check")?.checked || (line.dataset.completed === 'true'),
          deadline: line.dataset.deadline ? parseInt(line.dataset.deadline) : null,
          points: line.dataset.points ? parseInt(line.dataset.points) : null,
          deadlineChecked: line.dataset.deadlineChecked === 'true'
      })).filter(task => task.text !== "");

      try {
          localStorage.setItem("tasks", JSON.stringify(tasks));
          if (isSignedIn && currentUser) {
              const users = JSON.parse(localStorage.getItem("users") || "{}");
              if (users[currentUser]) {
                  users[currentUser].tasks = tasks;
                  localStorage.setItem("users", JSON.stringify(users));
              }
          }
      } catch (err) {
          console.error("Local save (tasks) error:", err);
      }

      if (isSignedIn && currentUser) {
          try {
              const oldTasks = Array.isArray(window.tasks) ? window.tasks : [];
              window.tasks = tasks;
              await __dbExports.saveStateToCloud(currentUser);
              console.log("Tasks saved to cloud.");
          } catch (e) {
              console.warn("Cloud save (tasks) failed, fallback already cached locally:", e);
          }
      }

      try {
        await window.__sb?.replaceTasks(tasks);
      } catch (e) {
        console.warn('[Supabase] tasks replace failed:', e?.message || e);
      }

      console.log("Tasks saved:", tasks);
      updateFocusStatus(); updateTodoBadge(); updateUpcomingTaskDisplay();
  }
  function handleTaskCompletionChange(event) { const checkbox = event.target; const taskLine = checkbox.closest('.task-line'); if (!taskLine) return; const input = taskLine.querySelector('.task-text'); const deadlineBtn = taskLine.querySelector('.set-deadline'); taskLine.dataset.completed = checkbox.checked; if (checkbox.checked) { if(input) input.readOnly = true; taskLine.style.opacity = '0.7'; if(deadlineBtn) deadlineBtn.disabled = true; checkSingleTaskDeadline(taskLine); if (typeof confetti === 'function') { const rect = checkbox.getBoundingClientRect(); const origin = { x: (rect.left + rect.right) / 2 / window.innerWidth, y: (rect.top + rect.bottom) / 2 / window.innerHeight }; confetti({ particleCount: 80, spread: 60, origin: origin, colors: ['#a855f7', '#9333ea', '#c084fc', '#6b21a8'] }); } } else { if(input) input.readOnly = false; taskLine.style.opacity = '1'; if(deadlineBtn) deadlineBtn.disabled = false; }
      updateTodoBadge();
      updateUpcomingTaskDisplay();
  }
  function checkSingleTaskDeadline(taskLine) { if (!taskLine) return; const deadlineTimestamp = taskLine.dataset.deadline ? parseInt(taskLine.dataset.deadline) : null; const deadlineChecked = taskLine.dataset.deadlineChecked === 'true'; const taskPoints = taskLine.dataset.points ? parseInt(taskLine.dataset.points) : null; const taskText = taskLine.dataset.text || "Untitled"; if (!deadlineTimestamp || deadlineChecked || !taskPoints) return; const now = Date.now(); let earnedPoints = 0; let message = ""; if (now <= deadlineTimestamp) { earnedPoints = applyPowerUps(taskPoints); points += earnedPoints; message = `Quest "${taskText}" on time! +${earnedPoints} XP`; playSound('achievementAudio'); } else { message = `Quest "${taskText}" completed late.`; } showConfirmation("Quest Update", message, false); if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; taskLine.dataset.deadlineChecked = 'true'; saveState(); checkLevelUp(); updateTodoBadge(); updateUpcomingTaskDisplay(); }
  function checkTaskDeadlines() {
      const now = Date.now();
      let tasksUpdated = false;
      let totalPenalty = 0;
      tasks.forEach((task, index) => {
          if (!task.deadline || task.completed || task.deadlineChecked) return;
          if (now > task.deadline) {
              const penaltyPoints = Math.floor((task.points || 50) / 2);
              totalPenalty += penaltyPoints;
              tasks[index].deadlineChecked = true;
              tasksUpdated = true;
              const taskLines = tasksContainer?.querySelectorAll('.task-line');
              if (taskLines && taskLines[index]) {
                  taskLines[index].dataset.deadlineChecked = 'true';
                  const deadlineInfo = taskLines[index].querySelector('.deadline-info');
                  if (deadlineInfo) deadlineInfo.textContent += " (Missed)";
                  taskLines[index].style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
              }
          }
      });

      if (totalPenalty > 0) {
          points = Math.max(0, points - totalPenalty);
          showConfirmation("Deadline Missed!", `Missed deadline(s)! -${totalPenalty} XP.`, false);
          if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
          saveState();
      }
      if (tasksUpdated) {
          saveTasks();
      } else {
          updateTodoBadge();
          updateUpcomingTaskDisplay();
      }
   }
  function showDeadlineDialog(taskElement) { const dialog = document.getElementById("deadlineDialog"); const dateInput = document.getElementById("deadlineDate"); const timeInput = document.getElementById("deadlineTime"); const difficultySelect = document.getElementById("taskDifficulty"); if (!dialog || !dateInput || !timeInput || !difficultySelect || !taskElement) return; currentTaskForDeadline = taskElement; const existingDeadline = taskElement.dataset.deadline ? parseInt(taskElement.dataset.deadline) : null; const existingPoints = taskElement.dataset.points ? parseInt(taskElement.dataset.points) : null; if (existingDeadline) { const d = new Date(existingDeadline); dateInput.value = d.toISOString().split('T')[0]; timeInput.value = d.toTimeString().substring(0, 5); } else { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); dateInput.value = tomorrow.toISOString().split('T')[0]; const now = new Date(); timeInput.value = now.toTimeString().substring(0, 5); } difficultySelect.value = existingPoints || "100"; dialog.style.display = "flex"; }
  function handleDeadlineConfirmation(choice) { const dialog = document.getElementById("deadlineDialog"); if (!dialog || !currentTaskForDeadline) return; dialog.style.display = "none"; if (choice === "yes") { const dateValue = document.getElementById("deadlineDate").value; const timeValue = document.getElementById("deadlineTime").value; const selectedPoints = document.getElementById("taskDifficulty").value; if (!dateValue || !timeValue) { showConfirmation("Invalid", "Select date & time.", false); currentTaskForDeadline = null; return; } const deadlineTimestamp = new Date(`${dateValue}T${timeValue}`).getTime(); if (deadlineTimestamp <= Date.now()) { showConfirmation("Invalid", "Deadline must be future.", false); currentTaskForDeadline = null; return; } currentTaskForDeadline.dataset.deadline = deadlineTimestamp; currentTaskForDeadline.dataset.points = selectedPoints; currentTaskForDeadline.dataset.deadlineChecked = 'false'; updateTaskDeadlineDisplay(currentTaskForDeadline, deadlineTimestamp, selectedPoints); console.log(`Deadline set for "${currentTaskForDeadline.dataset.text}"`); sentNotificationTaskIds.delete(currentTaskForDeadline.dataset.taskId); updateTodoBadge(); updateUpcomingTaskDisplay(); } currentTaskForDeadline = null; }
  function updateTaskDeadlineDisplay(taskLine, deadlineTimestamp, pointsValue) { const existingDeadlineSpan = taskLine.querySelector(".deadline-info"); if (existingDeadlineSpan) existingDeadlineSpan.remove(); const existingPointsSpan = taskLine.querySelector(".points-info"); if (existingPointsSpan) existingPointsSpan.remove(); if (deadlineTimestamp && pointsValue) { const deadlineDate = new Date(deadlineTimestamp); const deadlineInfo = document.createElement("span"); deadlineInfo.className = "deadline-info"; const dateOptions = { month: 'short', day: 'numeric' }; const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true }; deadlineInfo.textContent = `Due: ${deadlineDate.toLocaleDateString(undefined, dateOptions)} ${deadlineDate.toLocaleTimeString(undefined, timeOptions)}`; deadlineInfo.title = deadlineDate.toLocaleString(); const pointsInfo = document.createElement("span"); pointsInfo.className = "points-info"; pointsInfo.textContent = `+${pointsValue} XP`; const buttonsContainer = taskLine.querySelector('.task-buttons'); if (buttonsContainer) { taskLine.insertBefore(pointsInfo, buttonsContainer); taskLine.insertBefore(deadlineInfo, pointsInfo); } else { taskLine.appendChild(deadlineInfo); taskLine.appendChild(pointsInfo); } } }

  function updateTodoBadge() {
      if (!todoBadgeEl || !tasks) return;
      const now = Date.now();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

      const urgentTasksCount = tasks.filter(task =>
          !task.completed && task.deadline && (task.deadline < now || (task.deadline >= todayStart.getTime() && task.deadline <= todayEnd.getTime()))
      ).length;

      if (urgentTasksCount > 0) {
          todoBadgeEl.textContent = urgentTasksCount;
          todoBadgeEl.classList.add('visible');
      } else {
          todoBadgeEl.classList.remove('visible');
      }
  }

  function updateUpcomingTaskDisplay() {
      if (!upcomingTaskDisplayEl || !tasks) return;
      const now = Date.now();

      const incompleteTasks = tasks.filter(task => !task.completed && task.deadline);

      incompleteTasks.sort((a, b) => {
          const aIsOverdue = a.deadline < now;
          const bIsOverdue = b.deadline < now;
          if (aIsOverdue && !bIsOverdue) return -1;
          if (!aIsOverdue && bIsOverdue) return 1;
          return a.deadline - b.deadline;
      });

      const nextTask = incompleteTasks[0];

      if (nextTask) {
          const deadline = new Date(nextTask.deadline);
          const isOverdue = nextTask.deadline < now;
          let timeString = '';

          const diffHours = Math.round((nextTask.deadline - now) / (1000 * 60 * 60));
          const diffMinutes = Math.round((nextTask.deadline - now) / (1000 * 60));

          if (isOverdue) {
              timeString = "OVERDUE!";
              upcomingTaskDisplayEl.className = 'overdue';
          } else if (diffMinutes < 60) {
               timeString = `Due in ${diffMinutes} min`;
               upcomingTaskDisplayEl.className = '';
          } else if (diffHours < 24) {
               timeString = `Due in ${diffHours}h`;
               upcomingTaskDisplayEl.className = '';
          } else {
              const dateOptions = { month: 'short', day: 'numeric' };
              const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
              timeString = `Due: ${deadline.toLocaleDateString(undefined, dateOptions)} ${deadline.toLocaleTimeString(undefined, timeOptions)}`;
              upcomingTaskDisplayEl.className = '';
          }

          upcomingTaskDisplayEl.innerHTML = `<i class="fas ${isOverdue ? 'fa-exclamation-triangle' : 'fa-bell'}"></i> ${nextTask.text} <span style="color: var(--text-dim); font-size: 0.9em;">(${timeString})</span>`;
      } else {
          upcomingTaskDisplayEl.innerHTML = `<i class="fas fa-star"></i> No urgent quests!`;
          upcomingTaskDisplayEl.className = 'none';
      }
  }

  // Notification functions
  function requestNotificationPermission() {
      if (!('Notification' in window)) {
          console.warn('Browser does not support notifications.');
          browserNotificationPermission = 'denied';
          browserNotificationsEnabled = false;
          if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = true;
           if (currentView === 'profile') displayProfileInfo();
          return Promise.resolve('denied');
      }

      return Notification.requestPermission().then(permission => {
          console.log('Notification permission:', permission);
          browserNotificationPermission = permission;
          if (permission === 'denied') {
              browserNotificationsEnabled = false;
               if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = true;
          } else if (permission === 'granted') {
               if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = false;
          } else {
               if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = false;
               browserNotificationsEnabled = false;
          }
           if (currentView === 'profile') displayProfileInfo();
          saveState();
          return permission;
      });
  }

   function handleNotificationSettingChange(event) {
       const isEnabled = event.target.checked;
       browserNotificationsEnabled = isEnabled;
       console.log('Browser notification setting toggled:', isEnabled);

       if (isEnabled && browserNotificationPermission === 'default') {
           requestNotificationPermission();
       } else if (isEnabled && browserNotificationPermission === 'denied') {
           showConfirmation("Permission Needed", "Browser notification permission was denied. Please enable it in your browser settings.", false);
           event.target.checked = false;
           browserNotificationsEnabled = false;
       }
       saveState();
   }

   function checkAndSendNotifications() {
       if (!browserNotificationsEnabled || browserNotificationPermission !== 'granted' || !tasks) {
           return;
       }

       const now = Date.now();

       tasks.forEach(task => {
           if (!task.completed && task.deadline &&
               task.deadline > now &&
               task.deadline <= now + NOTIFICATION_LEAD_TIME &&
               !sentNotificationTaskIds.has(task.id)
           ) {
               const minutesLeft = Math.round((task.deadline - now) / (1000 * 60));
               const title = `Quest Due Soon! (${minutesLeft} min)`;
               const options = {
                   body: task.text || "Upcoming task requires attention.",
                   icon: '/favicon-32x32.png',
                   tag: `task-${task.id}`
               };

               try {
                   const notification = new Notification(title, options);
                   console.log(`Notification sent for task: ${task.id}`);
                   sentNotificationTaskIds.add(task.id);
                   notification.onclick = () => {
                       window.focus();
                       showView('homePage');
                       toggleTodo();
                   };
               } catch (err) {
                   console.error("Error sending notification:", err);
               }
           }
       });
   }

  // URL parsing for YouTube
  function parseInputUrl(url) {
      if (!url) return null;
      try {
          const urlObj = new URL(url);
          const params = urlObj.searchParams;

          const playlistId = params.get('list');
          let videoId = params.get('v');

          if (urlObj.hostname === 'youtu.be') {
              videoId = urlObj.pathname.substring(1);
          } else if (urlObj.pathname.startsWith('/live/')) {
              videoId = urlObj.pathname.split('/')[2];
          } else if (urlObj.pathname.startsWith('/shorts/')) {
              videoId = urlObj.pathname.split('/')[2];
          } else if (urlObj.pathname.startsWith('/embed/')) {
              videoId = urlObj.pathname.split('/')[2];
          }

          const idRegex = /^[a-zA-Z0-9_-]{11}$/;
          if (videoId && !idRegex.test(videoId)) {
              console.warn("Extracted video ID seems invalid:", videoId);
              videoId = null;
          }
          if (playlistId && !/^[a-zA-Z0-9_-]+$/.test(playlistId)) {
              console.warn("Extracted playlist ID seems invalid:", playlistId);
          }

          return { videoId: videoId || null, playlistId: playlistId || null };
      } catch (e) {
          console.error("URL parse error:", url, e);
          let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
          const videoId = match ? match[1] : null;
          match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
          const playlistId = match ? match[1] : null;
          return { videoId: videoId, playlistId: playlistId };
      }
  }

  function extractVideoId(url) {
      const parsed = parseInputUrl(url);
      return parsed ? parsed.videoId : null;
  }

  async function fetchPlaylistVideos(playlistId, pageToken = '') {
      if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_API_KEY_HERE') {
          console.error("YouTube API Key is missing or not replaced!");
          showConfirmation("API Key Error", "YouTube API Key is not configured.", false);
          return [];
      }

      const MAX_RESULTS_PER_PAGE = 50;
      let allVideoIds = [];

      const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems` +
                   `?part=snippet` +
                   `&playlistId=${playlistId}` +
                   `&maxResults=${MAX_RESULTS_PER_PAGE}` +
                   `&key=${YOUTUBE_API_KEY}` +
                   (pageToken ? `&pageToken=${pageToken}` : '');

      try {
          console.log(`Fetching playlist page: ${apiUrl.replace(YOUTUBE_API_KEY, '***KEY***')}`);
          const response = await fetch(apiUrl);

          if (!response.ok) {
              let errorData;
              try {
                  errorData = await response.json();
                  console.error("API Error Response:", errorData);
              } catch (jsonError) {
                  console.error("Failed to parse error JSON from API response.");
                  errorData = { message: response.statusText || `HTTP error! Status: ${response.status}` };
              }
              const errorMessage = errorData?.error?.message || errorData.message || `Failed to fetch playlist items (HTTP ${response.status})`;
              throw new Error(errorMessage);
          }

          const data = await response.json();

          if (data.items) {
              data.items.forEach(item => {
                  if (item.snippet?.resourceId?.kind === 'youtube#video' && item.snippet.resourceId.videoId) {
                      allVideoIds.push(item.snippet.resourceId.videoId);
                  } else {
                      console.warn("Skipping playlist item without valid video ID:", item);
                  }
              });
          }

          if (data.nextPageToken) {
              console.log("Fetching next page for playlist:", playlistId);
              const nextPageVideos = await fetchPlaylistVideos(playlistId, data.nextPageToken);
              allVideoIds = allVideoIds.concat(nextPageVideos);
          }

          return allVideoIds;
      } catch (error) {
          console.error(`Error fetching playlist ${playlistId}:`, error);
          showConfirmation("Playlist Load Error", `Failed to load videos for playlist ${playlistId}. ${error.message}`, false);
          return [];
      }
  }

  async function prepareAndStartPlayback() {
      try {
          if (!urlInputsContainer) { console.error("URL input container missing"); return; }
          const urlElements = urlInputsContainer.querySelectorAll(".youtube-url");
          const urls = Array.from(urlElements).map(input => input.value.trim()).filter(url => url);
          if (urls.length === 0) { showConfirmation("No URLs", "Please enter at least one YouTube URL (video or playlist).", false); return; }

          videoIds = [];
          let playlistFetchPromises = [];

          urls.forEach(url => {
              const parsed = parseInputUrl(url);
              if (parsed) {
                  if (parsed.playlistId) {
                      console.log(`Playlist detected: ${parsed.playlistId}. Queuing fetch...`);
                      playlistFetchPromises.push(fetchPlaylistVideos(parsed.playlistId));
                  } else if (parsed.videoId) {
                      if (!videoIds.includes(parsed.videoId)) {
                          videoIds.push(parsed.videoId);
                      }
                  }
              } else {
                  console.warn("Could not parse URL:", url);
              }
          });

          console.log(`Waiting for ${playlistFetchPromises.length} playlist fetches...`);
          const playlistResults = await Promise.all(playlistFetchPromises);
          console.log("Playlist fetches complete.");

          playlistResults.forEach(playlistVideoIds => {
              if (Array.isArray(playlistVideoIds)) {
                  playlistVideoIds.forEach(videoId => {
                      if (!videoIds.includes(videoId)) {
                          videoIds.push(videoId);
                      }
                  });
              }
          });

          if (videoIds.length === 0) {
              showConfirmation("No Videos Found", "Could not find any playable video IDs from the provided URL(s) or playlists. Check the URLs and ensure the API key is correct.", false);
              return;
          }

          console.log("Final video list prepared:", videoIds);

          currentVideoIndex = 0;
          completedVideos.clear();
          allVideosCompleted = false;
          if(playerContainer) playerContainer.style.display = 'block';
          if(youtubeInputContainer) youtubeInputContainer.style.display = 'none';
          initializeYouTubeView();
          saveState();
          requestFullscreen(document.documentElement);

      } catch (err) {
          console.error("Playback preparation error:", err);
          showConfirmation("Playback Error", `Error starting the focus session: ${err.message}. Please try again.`, false);
          if(youtubeInputContainer) youtubeInputContainer.style.display = 'block';
          if(playerContainer) playerContainer.style.display = 'none';
          videoIds = [];
      }
  }

  function loadYouTubeAPI() { return new Promise((resolve, reject) => { if (isYouTubeAPILoaded) { resolve(); return; } console.log("Loading YT API..."); const tag = document.createElement("script"); tag.src = "https://www.youtube.com/iframe_api"; tag.async = true; window.onYouTubeIframeAPIReady = () => { console.log("YT API Ready."); isYouTubeAPILoaded = true; if (typeof YT !== 'undefined' && YT.Player) { resolve(); } else { setTimeout(() => { if (typeof YT !== 'undefined' && YT.Player) { resolve(); } else { console.error("YT.Player unavailable."); reject(new Error("YT Player missing.")); } }, 500); } }; tag.onerror = (error) => { console.error("YT API load failed:", error); reject(new Error("YT API script load failed.")); }; document.head.appendChild(tag); setTimeout(() => { if (!isYouTubeAPILoaded) { console.error("YT API timeout."); reject(new Error("YT API load timeout.")); } }, 15000); }); }
  function initializeYouTubeView() { if (videoIds.length === 0) { console.warn("No video IDs"); showView('homePage'); return; } const controls = document.getElementById('youtubeLecturePageControls'); if(controls) controls.style.display = 'flex'; currentSessionFocusTime = 0;
  updateStreak();
  loadYouTubeAPI().then(() => { console.log("API loaded, setup player."); setupYouTubePlayer(); startTimer(focusDuration, "Focus Time"); if(timerDisplay) timerDisplay.style.display = 'block'; setupVideoSidebar(); updateFocusStatus(); }).catch((err) => { console.error("YT View Init Error:", err); showConfirmation("Player Error", "Cannot load YT player.", false); showView('youtubeLecturePage'); isFocusModeActive = false; if(controls) controls.style.display = 'none'; }); }
  function setupYouTubePlayer() { if (!isYouTubeAPILoaded || typeof YT === 'undefined' || !YT.Player) { console.error("YT API not ready."); return; } if (!playerDiv) { console.error("Player div missing."); return; } if (videoIds.length === 0) { console.warn("No video IDs."); return; } if (player && typeof player.destroy === 'function') { console.log("Destroying prev player."); player.destroy(); player = null; } console.log("Creating YT.Player:", videoIds[currentVideoIndex]); try { player = new YT.Player("player", { height: "100%", width: "100%", videoId: videoIds[currentVideoIndex], playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, showinfo: 0, iv_load_policy: 3, fs: 1 }, events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange, onError: onPlayerError }, }); } catch (error) { console.error("YT.Player error:", error); showConfirmation("Player Fail", "Error creating player.", false); showView('youtubeLecturePage'); } }
  function onPlayerReady(event) { console.log("Player Ready:", videoIds[currentVideoIndex]); event.target.playVideo(); isFocusModeActive = true; highlightCurrentThumbnail(); }
  function onPlayerStateChange(event) { console.log("Player State:", event.data); if (event.data === YT.PlayerState.ENDED) { console.log("Video ended:", videoIds[currentVideoIndex]); completedVideos.add(videoIds[currentVideoIndex]); totalVideosWatched++; const earnedPoints = applyPowerUps(50); points += earnedPoints; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; checkLevelUp(); saveState(); if (currentView === 'focusStats') displayFocusStatsInfo(); currentVideoIndex++; if (currentVideoIndex < videoIds.length) { console.log("Loading next:", videoIds[currentVideoIndex]); player.loadVideoById(videoIds[currentVideoIndex]); highlightCurrentThumbnail(); } else { console.log("Playlist complete."); allVideosCompleted = true; showConfirmation("Playlist Done!", "All videos watched.", false); player.stopVideo(); } } else if (event.data === YT.PlayerState.PLAYING) { console.log("Playing."); isFocusModeActive = true; highlightCurrentThumbnail(); } else if (event.data === YT.PlayerState.PAUSED) { console.log("Paused."); } }
  function onPlayerError(event) { console.error("YT Player Error:", event.data); let errorMsg = "Unknown YT error."; switch (event.data) { case 2: errorMsg = "Invalid parameter."; break; case 5: errorMsg = "HTML5 error."; break; case 100: errorMsg = "Not found."; break; case 101: case 150: errorMsg = "Embedding disallowed."; break; } showConfirmation("Video Error", `${errorMsg} Skipping. (Code: ${event.data})`, false); setTimeout(() => { currentVideoIndex++; if (currentVideoIndex < videoIds.length) { console.log("Attempt next:", videoIds[currentVideoIndex]); player.loadVideoById(videoIds[currentVideoIndex]); } else { console.log("All videos attempted."); allVideosCompleted = true; endFocusSession("Error playing videos."); } }, 2000); }
  function setupVideoSidebar() { if (!videoThumbnailList || !videoSidebar) return; videoThumbnailList.innerHTML = ''; const showSidebar = videoIds.length > 1; videoSidebar.style.display = showSidebar ? 'block' : 'none'; if(videoSidebarToggleBtn) videoSidebarToggleBtn.style.display = showSidebar ? 'block' : 'none'; if (!showSidebar) { closeVideoSidebar(); return; } videoIds.forEach((id, index) => { const thumbnail = document.createElement("img"); thumbnail.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`; thumbnail.alt = `Video ${index + 1}`; thumbnail.className = "thumbnail"; thumbnail.dataset.index = index; thumbnail.title = `Play Video ${index + 1}`; thumbnail.loading = 'lazy'; thumbnail.onclick = () => { if (index !== currentVideoIndex) { currentVideoIndex = index; player.loadVideoById(videoIds[currentVideoIndex]); highlightCurrentThumbnail(); closeVideoSidebar(); } }; thumbnail.onerror = () => { thumbnail.alt = `Thumb unavailable`; thumbnail.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; thumbnail.style.cssText = 'border: 1px dashed var(--text-dim); height: 70px; object-fit: cover;'; }; videoThumbnailList.appendChild(thumbnail); }); highlightCurrentThumbnail(); }
  function toggleVideoSidebar() { if (!videoSidebar) return; isVideoSidebarOpen = !isVideoSidebarOpen; videoSidebar.classList.toggle('open', isVideoSidebarOpen); if(videoSidebarToggleBtn) videoSidebarToggleBtn.innerHTML = isVideoSidebarOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-list"></i>'; }
  function closeVideoSidebar() { if (!videoSidebar || !isVideoSidebarOpen) return; isVideoSidebarOpen = false; videoSidebar.classList.remove('open'); if(videoSidebarToggleBtn) videoSidebarToggleBtn.innerHTML = '<i class="fas fa-list"></i>'; }
  function highlightCurrentThumbnail() { if (!videoThumbnailList) return; const thumbnails = videoThumbnailList.querySelectorAll('.thumbnail'); thumbnails.forEach((thumb, index) => { thumb.classList.toggle('active', index === currentVideoIndex); }); }

  function startTimer(duration, mode) {
       if (!timerDisplay || !progressFill || !progressBar) { console.error("Timer elements missing!"); return; }
       clearInterval(countdownInterval);
       isFocusModeActive = true;
       timerMode = mode;
       let timeRemainingSeconds = Math.max(0, Math.floor(duration / 1000));
       timerRemaining = timeRemainingSeconds;
       const totalDurationSeconds = Math.floor(duration / 1000);
       progressBar.style.display = "block";
       progressFill.style.width = '0%';
       timerDisplay.style.display = 'block';
       console.log(`Timer: ${mode} for ${totalDurationSeconds}s`);

       countdownInterval = setInterval(() => {
           const minutes = Math.floor(timeRemainingSeconds / 60);
           const seconds = Math.floor(timeRemainingSeconds % 60);
           if(timerText) timerText.textContent = `${mode}: ${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
           const progress = totalDurationSeconds > 0 ? ((totalDurationSeconds - timeRemainingSeconds) / totalDurationSeconds) * 100 : 0;
           progressFill.style.width = `${Math.min(100, progress)}%`;

           if (mode === "Focus Time") {
               totalFocusTime++;
               currentSessionFocusTime++;
           }

           timerRemaining = timeRemainingSeconds;
           timeRemainingSeconds--;

           if (timeRemainingSeconds < 0) {
               clearInterval(countdownInterval);
               progressFill.style.width = '100%';
               progressBar.style.display = "none";

               if (mode === "Focus Time") {
                   console.log("Focus finished.");
                   const earnedPoints = applyPowerUps(100);
                   points += earnedPoints;
                   if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
                   checkLevelUp();
                   playSfx("achievementAudio");
                   logDailyFocus();
                   showSessionCompleteDialog();
               } else if (mode === "Break Time") {
                   console.log("Long break done.");
                   startTimer(secondBreakDuration, "Short Break");
               } else {
                   console.log("Short break done.");
                    currentSessionFocusTime = 0;
                   startTimer(focusDuration, "Focus Time");
               }
               saveState();
           }
       }, 1000);
   }

  function endFocusSession(reason = "Session ended.") {
      console.log("Ending focus:", reason);
      lofiUserInitiated = false;
      pauseLofi();
      clearInterval(countdownInterval);
      if (isFocusModeActive) {
          logDailyFocus();
      }
      isFocusModeActive = false;
      timerRemaining = focusDuration / 1000;
      timerMode = "Focus Time";
      if (player && typeof player.destroy === 'function') {
          player.destroy();
          player = null;
          console.log("Player destroyed.");
      }
      videoIds = []; currentVideoIndex = 0; completedVideos.clear(); allVideosCompleted = false;
      if(timerDisplay) timerDisplay.style.display = 'none';
      if(progressBar) progressBar.style.display = 'none';
      if(progressFill) progressFill.style.width = '0%';
      closeVideoSidebar();
      if(videoSidebarToggleBtn) videoSidebarToggleBtn.style.display = 'none';
      const controls = document.getElementById('youtubeLecturePageControls'); if(controls) controls.style.display = 'none';
      if(playerContainer) playerContainer.style.display = 'none';
      if(youtubeInputContainer) youtubeInputContainer.style.display = 'block';
      exitFullscreen();
      saveState();
      if (currentView === 'focusStats') displayFocusStatsInfo();
      updateFocusStatus();
      updateUpcomingTaskDisplay();
      showView('homePage');
  }

  function showSessionCompleteDialog() { const dialog = document.getElementById("sessionCompleteDialog"); if (dialog) dialog.style.display = "flex"; }
  function handleSessionContinue(choice) { const dialog = document.getElementById("sessionCompleteDialog"); if (dialog) dialog.style.display = "none"; if (choice === "continue") { const bonusPoints = applyPowerUps(100); points += bonusPoints; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Bonus!", `+${bonusPoints} XP!`, false); playSfx('achievementAudio'); checkLevelUp(); saveState(); currentSessionFocusTime = 0; startTimer(focusDuration, "Focus Time"); } else { endFocusSession("User ended session after completion."); } }
  function requestExitSession() { showConfirmation( "Exit?", "End current focus session?", true, () => { endFocusSession("User exited session manually."); }, () => {} ); }
  function toggleAIPopup() { if (!aiPopup) return; const isVisible = aiPopup.style.display === "block"; aiPopup.style.display = isVisible ? "none" : "block"; }
  function toggleSidebar() { if (!gameSidebar || !sidebarTrigger) return; isSidebarOpen = !isSidebarOpen; gameSidebar.classList.toggle('open', isSidebarOpen); sidebarTrigger.style.left = isSidebarOpen ? '280px' : '0px'; }
  function closeSidebar() { if (!gameSidebar || !sidebarTrigger || !isSidebarOpen) return; isSidebarOpen = false; gameSidebar.classList.remove('open'); sidebarTrigger.style.left = '0px'; }
  function showSignInForm() { showView('signinForm'); if(usernameInput) usernameInput.value = ''; if(passwordInput) passwordInput.value = ''; }

  async function signIn() {
      if(!usernameInput || !passwordInput) return;
      const email = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!email || !password) { showConfirmation("Missing", "Enter Email & Password.", false); return; }
      try {
          const { data, error } = await window.__sb?.client?.auth?.signInWithPassword({ email, password }) || {};
          if (error) { showConfirmation("Login Failed", error.message || "Invalid credentials.", false); return; }
          const user = data?.user;
          if (!user) { showConfirmation("Login Failed", "No user returned.", false); return; }
          isSignedIn = true; currentUser = user.id;
          try {
              const flagKey = `sb_migrated_${user.id}`;
              if (!localStorage.getItem(flagKey)) {
                  const g = window;
                  const stateForSb = {
                    points: g.points || 0,
                    previousPoints: g.previousPoints || 0,
                    totalFocusTime: g.totalFocusTime || 0,
                    totalDistractions: g.totalDistractions || 0,
                    totalVideosWatched: g.totalVideosWatched || 0,
                    streakDays: g.streakDays || 0,
                    lastFocusDate: g.lastFocusDate || null,
                    mysteryBoxCount: g.mysteryBoxCount || 0,
                    activePowerUps: g.activePowerUps || null,
                    premiumLofiTracks: Array.isArray(g.premiumLofiTracks) ? g.premiumLofiTracks.map(t => ({ id: t.id, unlocked: !!t.unlocked })) : [],
                    dailyFocusData: g.dailyFocusData || {},
                    browserNotificationsEnabled: !!g.browserNotificationsEnabled,
                    currentPomodoroDurationSetting: g.currentPomodoroDurationSetting || 60,
                    currentView: 'homePage'
                  };
                  const flatTasks = Array.isArray(g.tasks) ? g.tasks.map(t => ({
                    title: t.text ?? t.title ?? '',
                    completed: !!t.completed,
                    deadline: t.deadline ?? null,
                    difficulty: t.points ?? t.difficulty ?? null,
                    points_awarded: t.points_awarded ?? null
                  })) : [];
                  const flatPlaylists = Array.isArray(g.playlists) ? g.playlists.map(p => ({ name: p.name ?? '', urls: Array.isArray(p.urls) ? p.urls : [] })) : [];
                  await window.__sb?.upsertAppState(stateForSb);
                  await window.__sb?.replaceTasks(flatTasks);
                  await window.__sb?.upsertPlaylists(flatPlaylists);
                  localStorage.setItem(flagKey, '1');
              }
          } catch {}
          showView('homePage');
      } catch (err) {
          console.error("Sign-in error:", err);
          showConfirmation("Sign-in Error", "An error occurred during sign-in.", false);
      }
  }

  async function createAccount() {
      if(!usernameInput || !passwordInput) return;
      const username = usernameInput.value.trim();
      const password = passwordInput.value;
      if (!username || !password) { showConfirmation("Missing", "Enter Hero Name & Secret Code.", false); return; }
      if (password.length < 4) { showConfirmation("Weak Code", "Secret Code needs 4+ characters.", false); return; }
      try {
          const users = JSON.parse(localStorage.getItem("users") || "{}");
          if (users[username]) {
              showConfirmation("Name Taken", "This Hero Name is already registered.", false);
          } else {
              users[username] = {
                  password: password,
                  points: 0,
                  totalFocusTime: 0,
                  totalDistractions: 0,
                  totalVideosWatched: 0,
                  tasks: [],
                  streakDays: 0,
                  lastFocusDate: null,
                  mysteryBoxCount: 0,
                  activePowerUps: { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null }, },
                  playlists: [],
                  dailyFocusData: {},
                  browserNotificationsEnabled: false,
                  premiumLofiTracks: premiumLofiTracks.map(track => ({ id: track.id, unlocked: false }))
              };
              localStorage.setItem("users", JSON.stringify(users));

              isSignedIn = true;
              currentUser = username;
              points = 0; previousPoints = 0; totalFocusTime = 0; totalDistractions = 0; totalVideosWatched = 0; tasks = []; streakDays = 0; lastFocusDate = null; mysteryBoxCount = 0; activePowerUps = { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null }, }; playlists = []; dailyFocusData = {};
              browserNotificationsEnabled = false;
              browserNotificationPermission = ('Notification' in window) ? Notification.permission : 'denied';

              premiumLofiTracks.forEach(t => t.unlocked = false);
              updateAvailableLofiTracks();

              if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
              updateAchievementLevel();
              updateStreakDisplay();
              showView('homePage');
              restoreTasks();
              sentNotificationTaskIds.clear();
              console.log(`Account created: ${currentUser}.`);
              showConfirmation("Account Created!", `Welcome to the Quest for Focus, ${currentUser}!`, false);
          }
      } catch (err) {
          console.error("Account creation error:", err);
          showConfirmation("Creation Error", "An error occurred creating the account.", false);
      }
  }

  function logout() { showConfirmation( "Logout?", "Are you sure you want to logout?", true, () => { console.log(`Logging out ${currentUser}`); logDailyFocus(); clearInterval(generalInterval); isSignedIn = false; currentUser = null; points = 0; previousPoints = 0; totalFocusTime = 0; totalDistractions = 0; totalVideosWatched = 0; tasks = []; streakDays = 0; lastFocusDate = null; mysteryBoxCount = 0; activePowerUps = { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null }, }; playlists = []; dailyFocusData = {}; premiumLofiTracks.forEach(t => t.unlocked = false); updateAvailableLofiTracks(); currentSessionFocusTime = 0; browserNotificationsEnabled = false; browserNotificationPermission = 'default'; sentNotificationTaskIds.clear(); if(isFocusModeActive) { clearInterval(countdownInterval); isFocusModeActive = false; if (player && typeof player.destroy === 'function') { player.destroy(); player = null; } videoIds = []; currentVideoIndex = 0; completedVideos.clear(); allVideosCompleted = false; } if (isPomodoroActive) { clearInterval(pomodoroInterval); isPomodoroActive = false; exitFullscreen(); } if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: 0`; updateAchievementLevel(); updateStreakDisplay(); populatePlaylistSelect(); restoreTasks(); if(timerDisplay) timerDisplay.style.display = 'none'; localStorage.removeItem("focusModeState_v5"); showView('landingPage'); }, () => {} ); }

  function addUrlInput() { if (!urlInputsContainer) return; const container = document.createElement("div"); container.className = "url-container"; const newInput = document.createElement("input"); newInput.type = "text"; newInput.className = "youtube-url"; newInput.placeholder = "Another YouTube URL"; const removeBtn = document.createElement("button"); removeBtn.innerHTML = '<i class="fas fa-times"></i>'; removeBtn.title = "Remove URL"; removeBtn.onclick = () => { if (urlInputsContainer.querySelectorAll(".url-container").length > 1) { urlInputsContainer.removeChild(container); } else { newInput.value = ''; } }; container.appendChild(newInput); container.appendChild(removeBtn); urlInputsContainer.appendChild(container); newInput.focus(); }
  function restoreUrlInputs(urlsToRestore = []) { if (!urlInputsContainer) return; urlInputsContainer.innerHTML = ''; if (urlsToRestore.length === 0) { addUrlInput(); const firstRemoveBtn = urlInputsContainer.querySelector('.url-container button'); if (firstRemoveBtn && urlInputsContainer.querySelectorAll(".url-container").length === 1) { firstRemoveBtn.remove(); } } else { urlsToRestore.forEach((url, index) => { const container = document.createElement("div"); container.className = "url-container"; const input = document.createElement("input"); input.type = "text"; input.className = "youtube-url"; input.placeholder = "YouTube URL"; input.value = url || ''; container.appendChild(input); if (index > 0 || urlsToRestore.length > 1) { const removeBtn = document.createElement("button"); removeBtn.innerHTML = '<i class="fas fa-times"></i>'; removeBtn.title = "Remove URL"; removeBtn.onclick = () => { if (urlInputsContainer.querySelectorAll(".url-container").length > 1) { urlInputsContainer.removeChild(container); } else { input.value = ''; } }; container.appendChild(removeBtn); } urlInputsContainer.appendChild(container); }); if (urlsToRestore.length === 1) { const singleRemoveBtn = urlInputsContainer.querySelector('.url-container button'); if(singleRemoveBtn) singleRemoveBtn.remove(); } } }
  function savePlaylist() { if (!playlistNameInput || !urlInputsContainer) return; const name = playlistNameInput.value.trim(); if (!name) { showConfirmation("Missing Name", "Enter a name to save the playlist.", false); return; } const urlElements = urlInputsContainer.querySelectorAll(".youtube-url"); const currentUrls = Array.from(urlElements).map(input => input.value.trim()).filter(url => url); if (currentUrls.length === 0) { showConfirmation("No Videos", "Add at least one YouTube URL to save.", false); return; } const existingIndex = playlists.findIndex(p => p.name === name); if (existingIndex !== -1) { showConfirmation( "Overwrite?", `A playlist named "${name}" already exists. Overwrite it?`, true, () => { playlists[existingIndex] = { name: name, urls: currentUrls }; savePlaylistsToUserData(); populatePlaylistSelect(); playlistNameInput.value = ""; showConfirmation("Saved", `Playlist "${name}" updated.`, false); }, () => {} ); } else { playlists.push({ name: name, urls: currentUrls }); savePlaylistsToUserData(); populatePlaylistSelect(); playlistNameInput.value = ""; showConfirmation("Saved", `Playlist "${name}" saved.`, false); } }
  function removePlaylist() { if (!playlistSelect) return; const selectedName = playlistSelect.value; if (!selectedName) { showConfirmation("No Selection", "Select a playlist from the dropdown to delete.", false); return; } showConfirmation( "Delete?", `Are you sure you want to delete the playlist "${selectedName}"?`, true, () => { playlists = playlists.filter(p => p.name !== selectedName); savePlaylistsToUserData(); populatePlaylistSelect(); playlistSelect.value = ""; restoreUrlInputs(); showConfirmation("Deleted", `Playlist "${selectedName}" removed.`, false); }, () => {} ); }
  async function savePlaylistsToUserData() {
      try {
          if (isSignedIn && currentUser) {
              const users = JSON.parse(localStorage.getItem("users") || "{}");
              if (users[currentUser]) {
                  users[currentUser].playlists = playlists;
                  localStorage.setItem("users", JSON.stringify(users));
              }
          }
          localStorage.setItem("playlists", JSON.stringify(playlists));
      } catch (e) {
          console.error("Local save (playlists) error:", e);
      }

      if (isSignedIn && currentUser) {
          try {
              await __dbExports.saveStateToCloud(currentUser);
              console.log("Playlists saved to cloud.");
              try { await window.__sb?.upsertPlaylists(playlists); } catch (e) { console.warn("[Supabase] playlists upsert failed:", e?.message || e); }
          } catch (e) {
              console.warn("Cloud save (playlists) failed, kept local:", e);
          }
      }
  }
  async function populatePlaylistSelect() {
      if (!playlistSelect) return;
      if (isSignedIn && currentUser) {
          try {
              const remote = await window.__sb?.loadAppState();
              if (remote && Array.isArray(remote.playlists)) {
                  playlists = remote.playlists;
                  try {
                      const users = JSON.parse(localStorage.getItem("users") || "{}");
                      if (users[currentUser]) {
                          users[currentUser].playlists = playlists;
                          localStorage.setItem("users", JSON.stringify(users));
                      }
                      localStorage.setItem("playlists", JSON.stringify(playlists));
                  } catch (e) { console.warn("Local cache warm failed (playlists):", e); }
              }
          } catch (e) {
              console.warn("Cloud load (playlists) failed, using local:", e);
          }
      }
      const currentSelection = playlistSelect.value;
      playlistSelect.innerHTML = '<option value=\"\">Load Playlist</option>';
      playlists.sort((a, b) => a.name.localeCompare(b.name));
      playlists.forEach(playlist => {
          const option = document.createElement("option");
          option.value = playlist.name;
          option.textContent = playlist.name;
          playlistSelect.appendChild(option);
      });
      if (playlists.some(p => p.name === currentSelection)) { playlistSelect.value = currentSelection; } else { playlistSelect.value = ""; }
      if (!playlistSelect.onchange) { playlistSelect.onchange = handlePlaylistSelection; }
  }
  function handlePlaylistSelection() { if (!playlistSelect) return; const selectedName = playlistSelect.value; if (selectedName) { const selectedPlaylist = playlists.find(p => p.name === selectedName); if (selectedPlaylist && selectedPlaylist.urls) { console.log("Loading playlist:", selectedName); restoreUrlInputs(selectedPlaylist.urls); if(playlistNameInput) playlistNameInput.value = selectedName; } else { console.warn("Selected playlist not found or has no URLs:", selectedName); restoreUrlInputs(); if(playlistNameInput) playlistNameInput.value = ""; } } else { restoreUrlInputs(); if(playlistNameInput) playlistNameInput.value = ""; } }

  async function saveState() {
      if (!isSignedIn || !currentUser) {
          try {
              const stateToSave = {
                  isFocusModeActive: isFocusModeActive,
                  videoIds: isFocusModeActive ? videoIds : [],
                  currentVideoIndex: isFocusModeActive ? currentVideoIndex : 0,
                  timerMode: isFocusModeActive ? timerMode : "Focus Time",
                  timerRemaining: isFocusModeActive ? timerRemaining : focusDuration / 1000,
                  completedVideos: isFocusModeActive ? Array.from(completedVideos) : [],
                  allVideosCompleted: isFocusModeActive ? allVideosCompleted : false,
                  isPomodoroActive: isPomodoroActive,
                  pomodoroTimeRemaining: isPomodoroActive ? pomodoroTimeRemaining : (currentPomodoroDurationSetting * 60),
                  pomodoroDistractionCount: isPomodoroActive ? pomodoroDistractionCount : 0,
                  currentPomodoroDurationSetting: currentPomodoroDurationSetting,
                  points, totalFocusTime, totalDistractions, totalVideosWatched,
                  streakDays, lastFocusDate, mysteryBoxCount, activePowerUps,
                  premiumLofiTracks: premiumLofiTracks.map(t => ({ id: t.id, unlocked: t.unlocked })),
                  dailyFocusData,
                  browserNotificationsEnabled,
                  currentView, isSignedIn, currentUser
              };
              localStorage.setItem("focusModeState_v5", JSON.stringify(stateToSave));
              localStorage.setItem("tasks", JSON.stringify(tasks));
              localStorage.setItem("playlists", JSON.stringify(playlists));
          } catch {}
          return;
      }
      const stateToSave = {
          isFocusModeActive: isFocusModeActive,
          videoIds: isFocusModeActive ? videoIds : [],
          currentVideoIndex: isFocusModeActive ? currentVideoIndex : 0,
          timerMode: isFocusModeActive ? timerMode : "Focus Time",
          timerRemaining: isFocusModeActive ? timerRemaining : focusDuration / 1000,
          completedVideos: isFocusModeActive ? Array.from(completedVideos) : [],
          allVideosCompleted: isFocusModeActive ? allVideosCompleted : false,
          isPomodoroActive: isPomodoroActive,
          pomodoroTimeRemaining: isPomodoroActive ? pomodoroTimeRemaining : (currentPomodoroDurationSetting * 60),
          pomodoroDistractionCount: isPomodoroActive ? pomodoroDistractionCount : 0,
          currentPomodoroDurationSetting: currentPomodoroDurationSetting,
          points, totalFocusTime, totalDistractions, totalVideosWatched,
          streakDays, lastFocusDate, mysteryBoxCount, activePowerUps,
          premiumLofiTracks: premiumLofiTracks.map(t => ({ id: t.id, unlocked: t.unlocked })),
          dailyFocusData,
          browserNotificationsEnabled,
          currentView, isSignedIn, currentUser
      };
      try {
          localStorage.setItem("focusModeState_v5", JSON.stringify(stateToSave));
          const users = JSON.parse(localStorage.getItem("users") || "{}");
          if (users[currentUser]) {
              users[currentUser].points = points;
              users[currentUser].totalFocusTime = totalFocusTime;
              users[currentUser].totalDistractions = totalDistractions;
              users[currentUser].totalVideosWatched = totalVideosWatched;
              users[currentUser].streakDays = streakDays;
              users[currentUser].lastFocusDate = lastFocusDate;
              users[currentUser].mysteryBoxCount = mysteryBoxCount;
              users[currentUser].activePowerUps = activePowerUps;
              users[currentUser].premiumLofiTracks = premiumLofiTracks.map(t => ({ id: t.id, unlocked: t.unlocked }));
              users[currentUser].dailyFocusData = dailyFocusData;
              users[currentUser].playlists = playlists;
              users[currentUser].tasks = tasks;
              users[currentUser].browserNotificationsEnabled = browserNotificationsEnabled;
              localStorage.setItem("users", JSON.stringify(users));
          }
          localStorage.setItem("tasks", JSON.stringify(tasks));
          localStorage.setItem("playlists", JSON.stringify(playlists));
      } catch (err) {
          console.error("Local save (state) error:", err);
      }

      try {
        await __dbExports.saveStateToCloud(currentUser);
      } catch (e) {
        console.warn("Cloud save (state) failed, local mirrors kept:", e);
      }

      try {
        const g = window;
        const stateForSb = {
          points,
          previousPoints: g.previousPoints ?? points,
          totalFocusTime,
          totalDistractions,
          totalVideosWatched,
          streakDays,
          lastFocusDate,
          mysteryBoxCount,
          activePowerUps,
          premiumLofiTracks: premiumLofiTracks.map(t => ({ id: t.id, unlocked: !!t.unlocked })),
          dailyFocusData,
          browserNotificationsEnabled,
          currentPomodoroDurationSetting,
          currentView
        };
        await window.__sb?.upsertAppState(stateForSb);
      } catch (e) {
        console.warn("[Supabase] app_state upsert failed:", e?.message || e);
      }
  }

  async function loadSavedState() {
      console.log("Loading state (v5)...");
      let loadedState = null;
      try {
          loadedState = JSON.parse(localStorage.getItem("focusModeState_v5") || "{}");
      } catch(e) { console.error("Error parsing state:", e); localStorage.removeItem("focusModeState_v5"); loadedState = {}; }

      if (loadedState.isSignedIn && loadedState.currentUser) {
          console.log("Attempting restore for:", loadedState.currentUser);
          const users = JSON.parse(localStorage.getItem("users") || "{}");
          isSignedIn = true;
          currentUser = loadedState.currentUser;

          try {
              const remote = await window.__sb?.loadAppState();
              if (remote) {
                  points = remote.points ?? 0;
                  previousPoints = points;
                  totalFocusTime = remote.totalFocusTime ?? 0;
                  totalDistractions = remote.totalDistractions ?? 0;
                  totalVideosWatched = remote.totalVideosWatched ?? 0;
                  tasks = Array.isArray(remote.tasks) ? remote.tasks : [];
                  playlists = Array.isArray(remote.playlists) ? remote.playlists : [];
                  streakDays = remote.streakDays ?? 0;
                  lastFocusDate = remote.lastFocusDate ?? null;
                  mysteryBoxCount = remote.mysteryBoxCount ?? 0;
                  activePowerUps = remote.activePowerUps ?? { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null } };
                  dailyFocusData = remote.dailyFocusData ?? {};
                  browserNotificationsEnabled = !!remote.browser_notifications_enabled;
                  currentPomodoroDurationSetting = remote.current_pomodoro_duration_setting ?? 60;
                  if (Array.isArray(remote.premium_lofi_tracks)) {
                      const map = new Map(remote.premium_lofi_tracks.map(t => [t.id, !!t.unlocked]));
                      premiumLofiTracks.forEach(t => { if (map.has(t.id)) t.unlocked = map.get(t.id); });
                      updateAvailableLofiTracks();
                  }
                  try {
                      if (!users[currentUser]) users[currentUser] = {};
                      users[currentUser].points = points;
                      users[currentUser].totalFocusTime = totalFocusTime;
                      users[currentUser].totalDistractions = totalDistractions;
                      users[currentUser].totalVideosWatched = totalVideosWatched;
                      users[currentUser].streakDays = streakDays;
                      users[currentUser].lastFocusDate = lastFocusDate;
                      users[currentUser].mysteryBoxCount = mysteryBoxCount;
                      users[currentUser].activePowerUps = activePowerUps;
                      users[currentUser].premiumLofiTracks = premiumLofiTracks.map(t => ({ id: t.id, unlocked: t.unlocked }));
                      users[currentUser].dailyFocusData = dailyFocusData;
                      users[currentUser].playlists = playlists;
                      users[currentUser].tasks = tasks;
                      users[currentUser].browserNotificationsEnabled = browserNotificationsEnabled;
                      localStorage.setItem("users", JSON.stringify(users));
                      localStorage.setItem("tasks", JSON.stringify(tasks));
                      localStorage.setItem("playlists", JSON.stringify(playlists));
                  } catch (e) { console.warn("Mirror warm failed:", e); }
              }
          } catch (e) {
              console.warn("Remote load failed, using local mirrors if present:", e);
          }

          const userData = users[currentUser] || null;
          if (userData) {
              points = points ?? (userData.points || 0);
              previousPoints = points;
              totalFocusTime = totalFocusTime ?? (userData.totalFocusTime || 0);
              totalDistractions = totalDistractions ?? (userData.totalDistractions || 0);
              totalVideosWatched = totalVideosWatched ?? (userData.totalVideosWatched || 0);
              tasks = tasks && tasks.length ? tasks : (userData.tasks || []);
              playlists = playlists && playlists.length ? playlists : (userData.playlists || []);
              streakDays = streakDays ?? (userData.streakDays || 0);
              lastFocusDate = lastFocusDate ?? (userData.lastFocusDate || null);
              mysteryBoxCount = mysteryBoxCount ?? (userData.mysteryBoxCount || 0);
              activePowerUps = activePowerUps || userData.activePowerUps || { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null } };
              dailyFocusData = Object.keys(dailyFocusData || {}).length ? dailyFocusData : (userData.dailyFocusData || {});
              browserNotificationsEnabled = typeof browserNotificationsEnabled === 'boolean' ? browserNotificationsEnabled : (userData.browserNotificationsEnabled || false);
              const savedTracks = userData.premiumLofiTracks || [];
              premiumLofiTracks.forEach(track => {
                  const saved = savedTracks.find(st => st.id === track.id);
                  track.unlocked = saved ? saved.unlocked : track.unlocked;
              });
              updateAvailableLofiTracks();
          }
          browserNotificationPermission = ('Notification' in window) ? Notification.permission : 'denied';
          if(pomodoroDurationInput) pomodoroDurationInput.value = currentPomodoroDurationSetting;
          if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
          updateAchievementLevel(); updateStreakDisplay(); await restoreTasks();
          checkExpiredPowerups(); sentNotificationTaskIds.clear();

          if (loadedState.isFocusModeActive && loadedState.videoIds && loadedState.videoIds.length > 0 && loadedState.currentView === 'youtubeLecturePage') {
              console.log("Restoring active YouTube focus session...");
              isFocusModeActive = true; videoIds = loadedState.videoIds; currentVideoIndex = loadedState.currentVideoIndex || 0; timerMode = loadedState.timerMode || "Focus Time"; timerRemaining = loadedState.timerRemaining || (focusDuration / 1000); completedVideos = new Set(loadedState.completedVideos || []); allVideosCompleted = loadedState.allVideosCompleted || false; currentSessionFocusTime = loadedState.currentSessionFocusTime || 0;
              loadYouTubeAPI().then(() => { showView('youtubeLecturePage'); setTimeout(() => { console.log("Re-init player."); setupYouTubePlayer(); startTimer(timerRemaining * 1000, timerMode); }, 100); }).catch(err => { console.error("YT API load fail on restore:", err); isFocusModeActive = false; showView('homePage'); });
          } else if (loadedState.isPomodoroActive && loadedState.currentView === 'homePage') {
              console.log("Restoring active Pomodoro session...");
              isPomodoroActive = true; pomodoroTimeRemaining = loadedState.pomodoroTimeRemaining || (currentPomodoroDurationSetting * 60); pomodoroDistractionCount = loadedState.pomodoroDistractionCount || 0; currentSessionFocusTime = loadedState.currentSessionFocusTime || 0;
              showPomodoroOverlay(); updatePomodoroDisplay(); if (pomodoroStatusEl) pomodoroStatusEl.textContent = "Focusing..."; if (pomodoroStartBtn) pomodoroStartBtn.disabled = true; if (pomodoroResetBtn) pomodoroResetBtn.disabled = false; if (pomodoroDurationInput) pomodoroDurationInput.disabled = true; requestFullscreen(document.documentElement);
              pomodoroInterval = setInterval(() => { pomodoroTimeRemaining--; currentSessionFocusTime++; totalFocusTime++; updatePomodoroDisplay(); if (pomodoroTimeRemaining % 60 === 0 && pomodoroTimeRemaining > 0) { const earned = applyPowerUps(1); points += earned; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; checkLevelUp(); } if (pomodoroTimeRemaining <= 0) { completePomodoroSession(); } }, 1000);
          } else {
              isFocusModeActive = false; isPomodoroActive = false; currentSessionFocusTime = 0;
              showView(loadedState.currentView || 'homePage');
          }
          startPeriodicChecks();
          console.log("Session restored for", currentUser);
          return;
      }
      console.log("No active session found or error. Showing landing.");
      showView('landingPage'); updateClock(); initAudio(); updateAchievementLevel(); updateStreakDisplay();
  }

  function checkExpiredPowerups() { let stateChanged = false; const now = Date.now(); if (activePowerUps.doublePoints.active && activePowerUps.doublePoints.expiry && now > activePowerUps.doublePoints.expiry) { console.log("Double XP expired."); activePowerUps.doublePoints.active = false; activePowerUps.doublePoints.expiry = null; stateChanged = true; } if (activePowerUps.streakShield.active && activePowerUps.streakShield.expiry && now > activePowerUps.streakShield.expiry) { console.log("Shield expired."); activePowerUps.streakShield.active = false; activePowerUps.streakShield.expiry = null; activePowerUps.streakShield.used = false; stateChanged = true; } if (stateChanged) { saveState(); } }
  function requestFullscreen(element) { try { if (element.requestFullscreen) element.requestFullscreen().catch(err => console.warn("FS Req Catch:", err.message)); else if (element.mozRequestFullScreen) element.mozRequestFullScreen(); else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen(); else if (element.msRequestFullscreen) element.msRequestFullscreen(); } catch(e){ console.warn("Fullscreen fail:", e.message)} }
  function exitFullscreen() { try { if (document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(err => console.warn("FS Exit Catch:", err.message)); else if (document.mozCancelFullScreen) document.mozCancelFullScreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); else if (document.msExitFullscreen) document.msExitFullscreen(); } } catch(e){ console.warn("Exit fullscreen fail:", e.message)} }
  function showConfirmation(title, message, isCancellable = false, onConfirm = () => {}, onCancel = () => {}, dialogClass = '') { const dialog = document.getElementById("confirmationDialog"); const dialogBox = dialog?.querySelector(".dialog-box"); const titleEl = dialog?.querySelector("h3"); const messageEl = dialog?.querySelector("p"); const confirmBtn = document.getElementById("confirmBtn"); const cancelBtn = document.getElementById("cancelBtn"); if (!dialog || !dialogBox || !titleEl || !messageEl || !confirmBtn || !cancelBtn) { console.error("Confirm dialog missing elements."); return; } dialogBox.className = 'dialog-box'; if (dialogClass) { dialogBox.classList.add(dialogClass); } titleEl.innerHTML = `<i class="fas ${isCancellable ? 'fa-question-circle' : (dialogClass === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle')}"></i> ${title}`; messageEl.textContent = message; cancelBtn.style.display = isCancellable ? "inline-block" : "none"; const newConfirmBtn = confirmBtn.cloneNode(true); confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn); const newCancelBtn = cancelBtn.cloneNode(true); cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn); newConfirmBtn.textContent = isCancellable ? "YES" : "OK"; newConfirmBtn.onclick = () => { dialog.style.display = 'none'; onConfirm(); }; if (isCancellable) { newCancelBtn.onclick = () => { dialog.style.display = 'none'; onCancel(); }; } dialog.style.display = "flex"; }

  // Calendar functions
  function showCalendar() {
      generateCalendarGrid(calendarCurrentDate.getFullYear(), calendarCurrentDate.getMonth());
  }

  function generateCalendarGrid(year, month) {
      if (!calendarGrid || !calendarMonthYear) return;
      calendarGrid.innerHTML = '';

      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      calendarMonthYear.innerHTML = `<i class="fas fa-calendar-alt"></i> ${monthNames[month]} ${year}`;

      const firstDayOfMonth = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const today = new Date();
      const todayString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

      const adjustedFirstDay = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;

      for (let i = 0; i < adjustedFirstDay; i++) {
          const emptyCell = document.createElement('div');
          emptyCell.classList.add('calendar-day', 'other-month');
          calendarGrid.appendChild(emptyCell);
      }

      for (let day = 1; day <= daysInMonth; day++) {
          const dayCell = document.createElement('div');
          dayCell.classList.add('calendar-day');
          dayCell.textContent = day;

          const dateString = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          const focusData = dailyFocusData[dateString];

          if (focusData && focusData.focusTime > 0) {
              dayCell.classList.add('has-focus');
              const focusMinutes = Math.floor(focusData.focusTime / 60);
              if (focusMinutes >= 60) {
                  dayCell.classList.add('focus-high');
              } else if (focusMinutes >= 15) {
                   dayCell.classList.add('focus-medium');
              }
              const tooltip = document.createElement('span');
              tooltip.classList.add('tooltip');
              tooltip.textContent = `${focusMinutes} min focus`;
              if (focusData.distractions > 0) {
                   tooltip.textContent += ` (${focusData.distractions} distractions)`;
              }
              dayCell.appendChild(tooltip);
          }

          if (dateString === todayString) {
              dayCell.classList.add('today');
          }

          calendarGrid.appendChild(dayCell);
      }
  }

  function changeCalendarMonth(offset) {
      calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + offset);
      showCalendar();
  }

  function startPeriodicChecks() {
      clearInterval(generalInterval);
      generalInterval = setInterval(() =>
