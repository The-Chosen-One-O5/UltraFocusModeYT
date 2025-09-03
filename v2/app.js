// ===== BEGIN supabase/client.js (inlined) =====
// WARNING: It's generally recommended to use environment variables for Supabase credentials.
const SUPABASE_URL = 'https://diylqtulatifooqnojrg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpeWxxdHVsYXRpZm9vcW5vanJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2NzgwMDEsImV4cCI6MjA3MjI1NDAwMX0.N2HdLgw68ocGdASlojD83g9h-xkEyCEQP9NNH6Y8bYY';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});


function getActiveUserId() {
  return window.__sbUser?.id || null;
}

// Safe helpers (no-throw): log but do not break app
async function sbUpsertAppState(state) {
  try {
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
  } catch (e) {
    console.warn('[Supabase] app_state upsert failed:', e?.message || e);
  }
}


async function sbReplaceTasks(tasks) {
  try {
    const userId = getActiveUserId();
    if (!userId) return;
    await supabase.from('tasks').delete().eq('user_id', userId);
    if (tasks.length > 0) {
       const rows = tasks.map(t => ({
            user_id: userId,
            title: t.text ?? t.title ?? '',
            completed: !!t.completed,
            deadline: t.deadline ?? null,
            difficulty: t.points ?? t.difficulty ?? null,
            points_awarded: t.points_awarded ?? null,
        }));
      await supabase.from('tasks').insert(rows);
    }
  } catch (e) {
    console.warn('[Supabase] tasks replace failed:', e?.message || e);
  }
}

async function sbUpsertPlaylists(playlists) {
  try {
    const userId = getActiveUserId();
    if (!userId || !Array.isArray(playlists)) return;
    await supabase.from('playlists').delete().eq('user_id', userId);
    if (playlists.length === 0) return;

    const rows = playlists.map(p => ({
      user_id: userId,
      name: p.name ?? '',
      urls: Array.isArray(p.urls) ? p.urls : []
    }));

     await supabase.from('playlists').insert(rows);

  } catch (e) {
    console.warn('[Supabase] playlists upsert failed:', e?.message || e);
  }
}

async function sbLoadData() {
    try {
        const userId = getActiveUserId();
        if (!userId) return null;

        const [appStateRes, tasksRes, playlistsRes] = await Promise.all([
            supabase.from('app_state').select('*').eq('user_id', userId).single(),
            supabase.from('tasks').select('*').eq('user_id', userId),
            supabase.from('playlists').select('*').eq('user_id', userId)
        ]);

        if (appStateRes.error && appStateRes.error.code !== 'PGRST116') { // Ignore "exact one row" error if no state exists
             console.warn('[Supabase] Load app_state error:', appStateRes.error.message);
        }
         if (tasksRes.error) console.warn('[Supabase] Load tasks error:', tasksRes.error.message);
         if (playlistsRes.error) console.warn('[Supabase] Load playlists error:', playlistsRes.error.message);

        const combinedState = appStateRes.data || {};
        combinedState.tasks = tasksRes.data || [];
        combinedState.playlists = playlistsRes.data || [];

        return combinedState;

    } catch(e) {
        console.warn('[Supabase] Full data load failed:', e?.message || e);
        return null;
    }
}


// Expose Supabase API for the app
window.__sb = {
  client: supabase,
  upsertAppState: sbUpsertAppState,
  replaceTasks: sbReplaceTasks,
  upsertPlaylists: sbUpsertPlaylists,
  loadData: sbLoadData,
};
// ===== END supabase/client.js (inlined) =====


// Wrap entire script in IIFE
;(() => {

    // IMPORTANT: Storing API keys directly in client-side JS is insecure.
    // This should be replaced with a backend proxy for a production application.
    const YOUTUBE_API_KEY = 'AIzaSyA16li1kPmHxCkcIw87ThOHmpBB1fuBPFY'; // <-- PASTE YOUR YOUTUBE API KEY HERE

    // --- State Variables ---
    let currentView = 'landingPage';
    let player; let videoIds = []; let currentVideoIndex = 0;
    let isFocusModeActive = false; let countdownInterval;
    let points = 0; let isSignedIn = false; let currentUser = null;
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
    let premiumLofiTracks = [ { id: "track1", name: "Celestial", url: "https://www.dropbox.com/scl/fi/3xkks3j4tcmnloz46o03m/Kyle-Dixon-Michael-Stei-Kids.mp3?rlkey=6w97eurecqph68b8f2r7zn5pf&st=epeucz72&dl=1", unlocked: false, cost: 150 }, { id: "track2", name: "Midnight", url: "https://www.dropbox.com/scl/fi/7vikjhsay7xayyab0tlvt/enchanted-metamorphosis-chronicles-264087.mp3?rlkey=mrdncvjr3g5bo8dksxywh9zxh&st=ui3kdsq5&dl=1", unlocked: false, cost: 150 }, { id: "track3", name: "Rainy", url: "https://www.dropbox.com/scl/fi/iaouozc1osse7h5ea9lon/thunder-chosic.com.mp3?rlkey=o7u0rarnh4kk657qhmcgyiolz&st=2r9f625j&dl=1", unlocked: false, cost: 200 }, { id: "track4", name: "Dark Academia ✨", url: "https://www.dropbox.com/scl/fi/6gbti0c7ka2e3lc1kj895/Toxic-Drunker-a-playlist-to-romanticize-studying-physics-dark-academia-playlist.mp3?rlkey=xfo51y00j6tbuozey81c5cfub&st=lvu3uvvp&dl=1", unlocked: false, cost: 1000 }, { id: "track5", name: "Aria Math", url: "https://www.dropbox.com/scl/fi/nqgmray2um9mjtm9stjk9/aria_math_credit_to_c4.mp3?rlkey=99e4kgsulvy1k738piy17iiye&st=uj9t230p&dl=1", unlocked: false, cost: 800 }, { id: "track6", name: "Apollo 11", url: "https://www.dropbox.com/scl/fi/6gl1bhdz9pe8ymjyh0jgd/RevenantEntertainment-kataruma-dont-worry-ill-always-be-here-for-you.mp3?rlkey=ntodkwanh7by2r2nyuw7cht1x&st=mbs2fozn&dl=1", unlocked: false, cost: 800 }, { id: "track7", name: "Aatma rama lofi", url: "https://www.dropbox.com/scl/fi/55vg6j03lwhlmi4eoqual/Aatma-Rama-_-Raghu-X-Stereo-India.mp3?rlkey=25klv8ao9wt63wq65ol33oub&st=w68o3ka6&dl=1", unlocked: false, cost: 500 }, { id: "track8", name: "The greatest song ever made 👾", url: "https://www.dropbox.com/scl/fi/hrbitky0j4l92zya0gvrg/If-You-re-A-Gamer-This-Song-FOUND-You-4.mp3?rlkey=4kevn083g6iz20bcmh5o6kizw&st=jp2zojra&dl=1", unlocked: false, cost: 1000 } , { id: "track9", name: "Minecraft Music", url: "https://www.dropbox.com/scl/fi/ux9xrruz6lm9a4v6gxwci/A-Minecraft-Movie-Soundtrack-_-Minecraft-from-A-Minecraft-Movie-Mark-Mothersbaugh-_-WaterTower-0.mp3?rlkey=g1xufj61oamoub6y97pzqjn9i&st=ke6mjj22&dl=1", unlocked: false, cost: 1000 } , { id: "track10", name: "Minecraft Music extended", url: "https://www.dropbox.com/scl/fi/buiewhxmbx9q19t2ir54q/Minecraft-Movie-Theme-_-EXTENDED-ORCHESTRAL-VERSION-_A-Minecraft-Movie_-Soundtrack-4.mp3?rlkey=p7melu9j1d9q0x4lh2116s8xz&st=s20iizbq&dl=1", unlocked: false, cost: 1000 } ];
    let availableLofiSongs = [...baseLofiSongs];
    const achievementLevels = [ { points: 0, level: "Mortal", color: "white" }, { points: 1000, level: "Soldier", color: "#4169E1" }, { points: 2000, level: "Knight", color: "#e0e0ff", glow: true }, { points: 3000, level: "KING", color: "#ff8c00", glow: true }, { points: 4000, level: "GIGACHAD", color: "#ff4500", glow: true }, { points: 5000, level: "Demigod", color: "gold", glow: true }, { points: 6000, level: "Titan", color: "gold", glow: true, box: true }, { points: 7000, level: "Immortal", color: "gold", glow: true, box: true, boxGlow: true }, { points: 8000, level: "Celestial", color: "#00BFFF", glow: true, box: true, boxGlow: true }, { points: 9000, level: "Divine", color: "rainbow" }, { points: 10000, level: "Omnipotent", color: "rainbow", glow: true }, ];
    const motivationalQuotes = [ "Focus is the key to unlocking your potential.", "Every step forward is a victory.", "Progress, not perfection, is the goal.", "You are more capable than you know. Believe it.", "Stay sharp, stay focused, stay winning.", "Embrace the challenge; it's where you grow." ];

    // --- Calendar State ---
    let dailyFocusData = {}; // Stores { 'YYYY-MM-DD': { focusTime: seconds, distractions: count } }
    let currentSessionFocusTime = 0; // Tracks focus time within the current YT or Pomodoro session
    let calendarCurrentDate = new Date(); // Tracks the month/year displayed in the calendar

    // --- DOM References ---
    let topNavBar, landingPage, signinForm, homePage, youtubeLecturePage, profilePage, focusStatsPage, pyqEmbedPage, pdfView;
    let playerContainer, playerDiv, timerDisplay, timerText, progressBar, progressFill, pointsDisplay;
    let achievementLevelDiv, lofiPlayer, aiPopup, fireBox, videoSidebar, videoThumbnailList;
    let usernameInput, passwordInput, homeUsernameSpan, dateTimeDisplaySpan, focusStatusSpan;
    let playlistSelect, urlInputsContainer, playlistNameInput, youtubeInputContainer;
    let todoListPopup, tasksContainer;
    let confirmationDialog, streakShieldDialog, doublePointsDialog, deadlineDialog, sessionCompleteDialog, mysteryBoxPopup, audioTracksStore, pomodoroOverlay;
    let gameSidebar, sidebarTrigger;
    let navClockTime, navClockPeriod, navStreakDisplay, videoSidebarToggleBtn, navProfileBtn;
    let calendarGrid, calendarMonthYear, prevMonthBtn, nextMonthBtn; // Calendar elements
    let pomodoroTimerEl, pomodoroDurationInput, pomodoroStatusEl, pomodoroStartBtn, pomodoroResetBtn, pomodoroCloseBtn, pomodoroWithPdfBtn; // Pomodoro elements
    let todoBadgeEl;
    let browserNotificationSettingCheckbox;
    let upcomingTaskDisplayEl;


    // --- Core Functions ---

    function showView(viewId) {
        console.log("Show View:", viewId);
        if (!document.getElementById(viewId)) { console.error(`View "${viewId}" missing!`); viewId = 'landingPage'; }
        const protectedViews = ['homePage', 'youtubeLecturePage', 'profile', 'focusStats', 'pyqEmbedPage', 'pdfView'];

        if (protectedViews.includes(viewId) && !isSignedIn) { console.warn(`Access denied to "${viewId}".`); showView('signinForm'); return; }
        document.querySelectorAll('.page-view').forEach(v => v.style.display = 'none');
        const targetView = document.getElementById(viewId);
        targetView.style.display = 'flex';
        currentView = viewId;

        const isPublicView = viewId === 'landingPage' || viewId === 'signinForm';
        const showNav = isSignedIn && !isPublicView;
        const showShared = isSignedIn && (viewId === 'homePage' || viewId === 'youtubeLecturePage' || viewId === 'pyqEmbedPage' || viewId === 'pdfView');

        if(topNavBar) topNavBar.style.display = showNav ? 'flex' : 'none';
        if(pointsDisplay) pointsDisplay.style.display = showNav ? 'block' : 'none';
        if(achievementLevelDiv) achievementLevelDiv.style.display = showNav ? 'block' : 'none';
        if(lofiPlayer) lofiPlayer.style.display = showShared ? 'block' : 'none';
        if(fireBox) fireBox.style.display = showShared ? 'flex' : 'none';

        document.body.classList.toggle('hide-menu', isPublicView || !isSignedIn);


        // YT Page UI Logic
        if (viewId === 'youtubeLecturePage') {
            const showInput = !isFocusModeActive; const showPlayerArea = isFocusModeActive; const showMultiVideoUI = showPlayerArea && videoIds.length > 1;
            if(youtubeInputContainer) youtubeInputContainer.style.display = showInput ? 'block' : 'none';
            if(playerContainer) playerContainer.style.display = showPlayerArea ? 'block' : 'none';
            if(videoSidebar) videoSidebar.style.display = showMultiVideoUI ? 'block' : 'none';
            if(videoSidebarToggleBtn) videoSidebarToggleBtn.style.display = showMultiVideoUI ? 'block' : 'none';
            if(timerDisplay) timerDisplay.style.display = showPlayerArea ? 'block' : 'none';
            const controls = document.getElementById('youtubeLecturePageControls'); if(controls) controls.style.display = showPlayerArea ? 'flex' : 'none';
            if (showInput && isSignedIn) { populatePlaylistSelect(); restoreUrlInputs(); }
            if (showPlayerArea) { highlightCurrentThumbnail(); } else { closeVideoSidebar(); }
        } else {
            if(timerDisplay) timerDisplay.style.display = 'none';
            if (player && typeof player.pauseVideo === 'function' && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) { player.pauseVideo(); }
        }

        // View Specific Updates
        if (viewId === 'homePage') { updateHomePageInfo(); displayRandomMotivation(); updateUpcomingTaskDisplay(); }
        else if (viewId === 'profile') { displayProfileInfo(); }
        else if (viewId === 'focusStats') { displayFocusStatsInfo(); showCalendar(); }

        closeSidebar();
        saveState();
    }

    function updateHomePageInfo() { if (homeUsernameSpan && window.__sbUser) homeUsernameSpan.textContent = window.__sbUser.email.split('@')[0]; updateDateTimeDisplay(); updateFocusStatus(); }
    function updateDateTimeDisplay() { const dateEl = dateTimeDisplaySpan; if (!dateEl) return; const now = new Date(); const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }; dateEl.textContent = `${now.toLocaleDateString(undefined, optionsDate)}`; }
    function updateFocusStatus() { if (!focusStatusSpan) return; const incompleteTasks = tasks.filter(task => !task.completed).length; if (isFocusModeActive) { focusStatusSpan.textContent = `Focusing on ${timerMode}...`; focusStatusSpan.style.color = 'var(--success)'; } else if (isPomodoroActive) { focusStatusSpan.textContent = `Pomodoro active!`; focusStatusSpan.style.color = 'var(--success)'; } else if (incompleteTasks > 0) { focusStatusSpan.textContent = `${incompleteTasks} quest${incompleteTasks > 1 ? 's' : ''} remaining!`; focusStatusSpan.style.color = 'var(--accent-alt)'; } else if (tasks.length > 0) { focusStatusSpan.textContent = "All quests complete!"; focusStatusSpan.style.color = 'var(--success)'; } else { focusStatusSpan.textContent = "Ready to add quests?"; focusStatusSpan.style.color = 'var(--text-dim)'; } }
    function displayRandomMotivation() { const quoteElement = document.getElementById('motivationQuote'); if (quoteElement) { const randomIndex = Math.floor(Math.random() * motivationalQuotes.length); quoteElement.textContent = `"${motivationalQuotes[randomIndex]}"`; } }

    function displayProfileInfo() {
        const usernameEl = document.getElementById('profileUsername'); const levelEl = document.getElementById('profileLevel'); const xpEl = document.getElementById('profileXP'); const streakEl = document.getElementById('profileStreak'); const iconEl = document.getElementById('profileIcon');
        if (!usernameEl || !levelEl || !xpEl || !streakEl || !iconEl || !browserNotificationSettingCheckbox) return;
        usernameEl.textContent = window.__sbUser?.email.split('@')[0] || 'Guest';
        const levelInfo = getAchievementLevel(points);
        levelEl.textContent = levelInfo.level; levelEl.className = 'level'; levelEl.style.color = ''; levelEl.classList.remove('rainbow', 'level-glow'); if (levelInfo.color === 'rainbow') { levelEl.classList.add('rainbow'); } else { levelEl.style.color = levelInfo.color; } if (levelInfo.glow) levelEl.classList.add('level-glow');
        xpEl.textContent = points;
        streakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`;
        let iconClass = 'fa-user'; if (levelInfo.points >= 8000) iconClass = 'fa-gem'; else if (levelInfo.points >= 5000) iconClass = 'fa-crown'; else if (levelInfo.points >= 2000) iconClass = 'fa-user-shield'; iconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;
        browserNotificationSettingCheckbox.checked = browserNotificationsEnabled;
        browserNotificationSettingCheckbox.disabled = browserNotificationPermission === 'denied';
    }

    function displayFocusStatsInfo() {
        const focusTimeEl = document.getElementById('statsTotalFocusTime'); const distractionsEl = document.getElementById('statsTotalDistractions'); const videosEl = document.getElementById('statsTotalVideosWatched'); const streakEl = document.getElementById('statsCurrentStreak');
        if (!focusTimeEl || !distractionsEl || !videosEl || !streakEl) return;
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
             document.getElementById('lofiPlay').style.display = 'inline-block';
             document.getElementById('lofiPause').style.display = 'none';
             lofiAudio.load();
         } else {
             document.querySelectorAll('#lofiPlayer button').forEach(btn => btn.disabled = true);
         }
         if (focusAudioElement) {
             focusAudioElement.loop = true;
             focusAudioElement.load();
         }
    }

    function updateAvailableLofiTracks() { const unlockedPremiumUrls = premiumLofiTracks.filter(track => track.unlocked).map(track => track.url); availableLofiSongs = [...new Set([...baseLofiSongs, ...unlockedPremiumUrls])]; if (lofiAudio && !availableLofiSongs.includes(lofiAudio.src)) { currentLofiIndex = 0; if (availableLofiSongs.length > 0) { lofiAudio.src = availableLofiSongs[currentLofiIndex]; lofiAudio.load(); } else { lofiAudio.removeAttribute('src'); } } document.querySelectorAll('#lofiPlayer button').forEach(btn => btn.disabled = availableLofiSongs.length === 0); }
    function getAchievementLevel(currentPoints) { let currentLevel = achievementLevels[0]; for (const level of achievementLevels) { if (currentPoints >= level.points) { currentLevel = level; } else { break; } } return currentLevel; }
    function updateAchievementLevel() { if (!achievementLevelDiv || !isSignedIn) return; const level = getAchievementLevel(points); achievementLevelDiv.textContent = level.level; achievementLevelDiv.className = 'level-default'; achievementLevelDiv.removeAttribute('style'); achievementLevelDiv.classList.remove('rainbow', 'level-glow', 'level-box-glow'); achievementLevelDiv.style.border = '2px solid var(--secondary)'; if (level.color === 'rainbow') { achievementLevelDiv.classList.add('rainbow'); } else { achievementLevelDiv.style.color = level.color; } if (level.glow) achievementLevelDiv.classList.add('level-glow'); if (level.box) achievementLevelDiv.style.border = '2px solid var(--gold)'; if (level.boxGlow) achievementLevelDiv.classList.add('level-box-glow'); if (currentView === 'profile') displayProfileInfo(); }
    function playSfx(soundId) { const el = document.getElementById(soundId); if (!el) return; try { el.currentTime = 0; el.volume = 1.0; el.play().catch(e => console.warn(`SFX ${soundId} blocked:`, e?.message||e)); } catch(e){ console.warn('SFX error:', e?.message||e); } }
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
        if (!lofiUserInitiated || !lofiAudio || availableLofiSongs.length === 0) return;
        if (!lofiAudio.src) {
            currentLofiIndex = Math.max(0, Math.min(currentLofiIndex, availableLofiSongs.length - 1));
            lofiAudio.src = availableLofiSongs[currentLofiIndex];
            lofiAudio.load();
        }
        lofiAudio.play().then(syncLofiUi).catch(err => console.error("Lofi play error:", err));
    }
    function pauseLofi() { if (!lofiAudio) return; try { lofiAudio.pause(); } catch {} syncLofiUi(); }
    function nextLofi() { if (!lofiAudio || availableLofiSongs.length <= 1) return; currentLofiIndex = (currentLofiIndex + 1) % availableLofiSongs.length; lofiAudio.src = availableLofiSongs[currentLofiIndex]; lofiAudio.load(); playLofi(false); }
    function prevLofi() { if (!lofiAudio || availableLofiSongs.length <= 1) return; currentLofiIndex = (currentLofiIndex - 1 + availableLofiSongs.length) % availableLofiSongs.length; lofiAudio.src = availableLofiSongs[currentLofiIndex]; lofiAudio.load(); playLofi(false); }

    function updateStreak() {
        if (!isSignedIn) return;
        const today = new Date().toDateString();
        let needsSave = false;
        if (lastFocusDate !== today) {
            if (lastFocusDate) {
                const last = new Date(lastFocusDate);
                const todayDate = new Date(today);
                last.setHours(0, 0, 0, 0);
                todayDate.setHours(0, 0, 0, 0);
                const diffDays = Math.floor((todayDate - last) / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    streakDays++;
                    needsSave = true;
                    checkMysteryBoxMilestone();
                } else if (diffDays > 1) {
                    if (activePowerUps.streakShield.active && Date.now() < activePowerUps.streakShield.expiry && !activePowerUps.streakShield.used) {
                        activePowerUps.streakShield.used = true;
                        needsSave = true;
                        showConfirmation("Shield Used!", "Streak Shield protected your focus streak!", false);
                    } else {
                        streakDays = 1;
                        if (activePowerUps.streakShield.active) activePowerUps.streakShield.used = false;
                        needsSave = true;
                    }
                }
            } else {
                streakDays = 1;
                needsSave = true;
            }
            lastFocusDate = today;
            needsSave = true;
        }
        logDailyFocus();
        updateStreakDisplay();
        if (needsSave) { saveState(); }
    }

    function logDailyFocus() {
        if (!isSignedIn || currentSessionFocusTime <= 0) return;
        const today = new Date();
        const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
        if (!dailyFocusData[dateString]) {
            dailyFocusData[dateString] = { focusTime: 0, distractions: 0 };
        }
        dailyFocusData[dateString].focusTime += currentSessionFocusTime;
        currentSessionFocusTime = 0;
    }

    function updateStreakDisplay() { if (!navStreakDisplay) return; navStreakDisplay.innerHTML = `<i class="fas fa-fire"></i> ${streakDays} ${streakDays === 1 ? 'day' : 'days'} focus`; const profileStreakEl = document.getElementById('profileStreak'); if (profileStreakEl && currentView === 'profile') profileStreakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`; const statsStreakEl = document.getElementById('statsCurrentStreak'); if (statsStreakEl && currentView === 'focusStats') statsStreakEl.textContent = `${streakDays} day${streakDays === 1 ? '' : 's'}`; }
    function checkMysteryBoxMilestone() { if (streakDays > 0 && streakDays % MYSTERY_BOX_STREAK_INTERVAL === 0) { mysteryBoxCount++; showMysteryBoxPopup(); playSfx('achievementAudio'); saveState(); } }
    function showMysteryBoxPopup() { const popup = document.getElementById("mysteryBoxPopup"); const rewardText = document.getElementById("mysteryRewardText"); const openButton = document.getElementById("openMysteryBox"); if (!popup || !rewardText || !openButton) return; if (mysteryBoxCount > 0) { rewardText.textContent = `You have ${mysteryBoxCount} Box${mysteryBoxCount > 1 ? 'es' : ''}! Open?`; openButton.disabled = false; openButton.textContent = "Open"; popup.style.display = "flex"; } }
    function openMysteryBox() { if (mysteryBoxCount <= 0) return; const popup = document.getElementById("mysteryBoxPopup"); const rewardText = document.getElementById("mysteryRewardText"); const openButton = document.getElementById("openMysteryBox"); if (!popup || !rewardText || !openButton) return; mysteryBoxCount--; const reward = mysteryBoxRewards[Math.floor(Math.random() * mysteryBoxRewards.length)]; let rewardMessageText = ""; switch (reward.type) { case "points": const val = reward.value(); points += val; rewardMessageText = `Found ${reward.message(val)}!`; break; case "doublePoints": if (!activePowerUps.doublePoints.active || (activePowerUps.doublePoints.expiry && Date.now() > activePowerUps.doublePoints.expiry)) { activePowerUps.doublePoints.active = true; activePowerUps.doublePoints.expiry = Date.now() + DOUBLE_POINTS_DURATION; rewardMessageText = `Activated: ${reward.message()}!`; setTimeout(() => { activePowerUps.doublePoints.active = false; saveState(); }, DOUBLE_POINTS_DURATION); } else { points += 200; rewardMessageText = `Double XP active! +200 XP!`; } break; case "streakShield": if (!activePowerUps.streakShield.active || (activePowerUps.streakShield.expiry && Date.now() > activePowerUps.streakShield.expiry)) { activePowerUps.streakShield.active = true; activePowerUps.streakShield.expiry = Date.now() + STREAK_SHIELD_DURATION; activePowerUps.streakShield.used = false; rewardMessageText = `Activated: ${reward.message()}!`; setTimeout(() => { activePowerUps.streakShield.active = false; saveState(); }, STREAK_SHIELD_DURATION); } else { points += 200; rewardMessageText = `Shield active! +200 XP!`; } break; case "lofiTrack": const lockedTracks = premiumLofiTracks.filter(t => !t.unlocked); if (lockedTracks.length > 0) { const trackToUnlock = lockedTracks[Math.floor(Math.random() * lockedTracks.length)]; trackToUnlock.unlocked = true; updateAvailableLofiTracks(); rewardMessageText = `Audio Unlocked: "${trackToUnlock.name}"!`; playSfx('achievementAudio'); } else { points += 100; rewardMessageText = `All tracks unlocked! +100 XP!`; } break; } rewardText.textContent = rewardMessageText; if (pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; openButton.textContent = "Awesome!"; openButton.disabled = true; saveState(); checkLevelUp(); setTimeout(() => { openButton.disabled = mysteryBoxCount <= 0; openButton.textContent = "Open"; if (mysteryBoxCount > 0) { rewardText.textContent = `Have ${mysteryBoxCount} Box${mysteryBoxCount > 1 ? 'es' : ''} left! Open?`; } else { rewardText.textContent = "No more boxes."; } }, 2500); }
    function closeMysteryBoxPopup() { const popup = document.getElementById("mysteryBoxPopup"); if (popup) popup.style.display = "none"; }
    function applyPowerUps(basePoints) { let finalPoints = basePoints; if (activePowerUps.doublePoints.active && Date.now() < activePowerUps.doublePoints.expiry) { finalPoints *= 2; } return Math.floor(finalPoints); }
    function checkLevelUp() { const oldLevel = getAchievementLevel(previousPoints); const newLevel = getAchievementLevel(points); if (newLevel.points > oldLevel.points) { showAchievementOverlay(`LEVEL UP! ${newLevel.level.toUpperCase()}!`); updateAchievementLevel(); } previousPoints = points; if (currentView === 'profile') displayProfileInfo(); if (currentView === 'focusStats') displayFocusStatsInfo(); }
    function showStreakShieldDialog() { if (points < STREAK_SHIELD_COST) { showConfirmation("Need XP", `Need ${STREAK_SHIELD_COST} XP.`, false); return; } if (activePowerUps.streakShield.active && Date.now() < activePowerUps.streakShield.expiry) { showConfirmation("Active", "Shield active!", false); return; } document.getElementById("streakShieldDialog").style.display = "flex"; }
    function handleStreakShieldConfirmation(choice) { document.getElementById("streakShieldDialog").style.display = "none"; if (choice === "yes" && points >= STREAK_SHIELD_COST) { points -= STREAK_SHIELD_COST; activePowerUps.streakShield.active = true; activePowerUps.streakShield.expiry = Date.now() + STREAK_SHIELD_DURATION; activePowerUps.streakShield.used = false; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Success", "Shield activated!", false); playSfx('achievementAudio'); saveState(); checkLevelUp(); setTimeout(() => { activePowerUps.streakShield.active = false; saveState(); if(isSignedIn) showConfirmation("Expired", "Shield faded.", false); }, STREAK_SHIELD_DURATION); } }
    function showDoublePointsDialog() { if (points < DOUBLE_POINTS_COST) { showConfirmation("Need XP", `Need ${DOUBLE_POINTS_COST} XP.`, false); return; } if (activePowerUps.doublePoints.active && Date.now() < activePowerUps.doublePoints.expiry) { showConfirmation("Active", "Double XP active!", false); return; } document.getElementById("doublePointsDialog").style.display = "flex"; }
    function handleDoublePointsConfirmation(choice) { document.getElementById("doublePointsDialog").style.display = "none"; if (choice === "yes" && points >= DOUBLE_POINTS_COST) { points -= DOUBLE_POINTS_COST; activePowerUps.doublePoints.active = true; activePowerUps.doublePoints.expiry = Date.now() + DOUBLE_POINTS_DURATION; if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Success", "Double XP activated!", false); playSfx('achievementAudio'); saveState(); checkLevelUp(); setTimeout(() => { activePowerUps.doublePoints.active = false; saveState(); if(isSignedIn) showConfirmation("Expired", "Double XP ended.", false); }, DOUBLE_POINTS_DURATION); } }
    function showAudioTracksStore() { const store = document.getElementById("audioTracksStore"); const tracksList = document.getElementById("audioTracksList"); if (!store || !tracksList) return; tracksList.innerHTML = ""; premiumLofiTracks.sort((a, b) => a.name.localeCompare(b.name)).forEach(track => { const trackItem = document.createElement("div"); trackItem.className = `audio-track-item ${track.unlocked ? 'unlocked' : 'locked'}`; trackItem.innerHTML = `<div class="track-info"><div class="track-name">${track.name}</div><div class="track-cost">${track.unlocked ? "Owned" : `${track.cost} XP`}</div></div>`; const unlockBtn = document.createElement("button"); unlockBtn.className = "unlock-track-btn"; unlockBtn.dataset.trackId = track.id; if (track.unlocked) { unlockBtn.textContent = "✓ OWNED"; unlockBtn.disabled = true; unlockBtn.classList.add('unlocked'); } else { unlockBtn.textContent = "UNLOCK"; unlockBtn.disabled = points < track.cost; unlockBtn.onclick = () => unlockAudioTrack(track.id); } trackItem.appendChild(unlockBtn); tracksList.appendChild(trackItem); }); store.style.display = "flex"; }
    function closeAudioTracksStore() { document.getElementById("audioTracksStore").style.display = "none"; }
    function unlockAudioTrack(trackId) { const track = premiumLofiTracks.find(t => t.id === trackId); if (!track || track.unlocked || points < track.cost) return; points -= track.cost; track.unlocked = true; updateAvailableLofiTracks(); if (pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Unlocked!", `"${track.name}" available!`, false); playSfx('achievementAudio'); showAudioTracksStore(); saveState(); checkLevelUp(); }

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
        if (pomodoroOverlay) {
            pomodoroOverlay.style.display = "flex";
            pdfView.style.display = 'none';
            document.getElementById('pomodoroContainer').style.display = 'block';
        }
    }

    function showPdfView() {
        if (pomodoroOverlay) {
            pomodoroOverlay.style.display = 'flex';
            pdfView.style.display = 'flex';
            document.getElementById('pomodoroContainer').style.display = 'none';

            document.getElementById('pomodoroTimerSmallDisplay').textContent = `${currentPomodoroDurationSetting.toString().padStart(2, "0")}:00`;

            const adobeDCView = new AdobeDC.View({clientId: "c2a3e0ee00ef42428971dfb99bc6d6af", divId: "adobe-dc-view"});
            adobeDCView.previewFile({
               content:{ location: { url: "https://acrobatservices.adobe.com/view-sdk-demo/PDFs/Bodea%20Brochure.pdf"}},
               metaData:{fileName: "Bodea Brochure.pdf"}
            },
            {
               embedMode: "SIZED_CONTAINER"
            });
        }
    }
    
    function startPomodoro(isPdfMode = false) {
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

         if (isPdfMode) {
             showPdfView();
         } else {
             if (pomodoroStatusEl) pomodoroStatusEl.textContent = "Focusing...";
             if (pomodoroStartBtn) pomodoroStartBtn.disabled = true;
             if (pomodoroResetBtn) pomodoroResetBtn.disabled = false;
             if (pomodoroDurationInput) pomodoroDurationInput.disabled = true;
             requestFullscreen(document.documentElement);
         }

         updatePomodoroDisplay(isPdfMode);

         pomodoroInterval = setInterval(() => {
             pomodoroTimeRemaining--;
             currentSessionFocusTime++;
             totalFocusTime++;
             updatePomodoroDisplay(isPdfMode);

             if (pomodoroTimeRemaining % 60 === 0 && pomodoroTimeRemaining > 0) {
                 points += applyPowerUps(1);
                 if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
                 checkLevelUp();
             }
             if (pomodoroTimeRemaining <= 0) {
                 completePomodoroSession(isPdfMode);
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
         showView('homePage');
     }

    function closePomodoroOverlay() {
         if (isPomodoroActive) {
             showConfirmation( "Exit?", "Pomodoro session active. Stop?", true, () => {
                 clearInterval(pomodoroInterval);
                 logDailyFocus();
                 isPomodoroActive = false;
                 exitFullscreen();
                 if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
                 if(pomodoroTimerEl) pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
                 saveState();
                 pomodoroOverlay.style.display = "none";
                 updateUpcomingTaskDisplay();
             });
         } else {
             exitFullscreen();
             if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
              if(pomodoroTimerEl) pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
             pomodoroOverlay.style.display = "none";
             updateUpcomingTaskDisplay();
         }
     }

     function updatePomodoroDisplay(isPdfMode = false) {
        const timerEl = isPdfMode ? document.getElementById('pomodoroTimerSmallDisplay') : pomodoroTimerEl;
        if (!timerEl) return;
        const minutes = Math.floor(pomodoroTimeRemaining / 60);
        const seconds = pomodoroTimeRemaining % 60;
        timerEl.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

        const timerWarningClass = 'timer-warning';
        const timerShakeClass = 'timer-shake';

        if (pomodoroTimeRemaining < 10 && pomodoroTimeRemaining >= 0) {
            timerEl.classList.add(timerShakeClass, timerWarningClass);
        } else if (pomodoroTimeRemaining < 60 && pomodoroTimeRemaining >= 0) {
            timerEl.classList.add(timerWarningClass);
            timerEl.classList.remove(timerShakeClass);
        } else {
            timerEl.classList.remove(timerWarningClass, timerShakeClass);
        }
    }


    function completePomodoroSession(isPdfMode = false) {
        clearInterval(pomodoroInterval);
        isPomodoroActive = false;
        playSfx("pomodoroCompleteAudio");

        if (currentSessionFocusTime > 0) {
             logDailyFocus();
        }
        if(!isPdfMode){
            if (pomodoroStatusEl) pomodoroStatusEl.textContent = `Complete! Distractions: ${pomodoroDistractionCount}`;
            if (pomodoroStartBtn) pomodoroStartBtn.disabled = false;
            if (pomodoroResetBtn) pomodoroResetBtn.disabled = true;
            if (pomodoroDurationInput) pomodoroDurationInput.disabled = false;
            if(pomodoroTimerEl) pomodoroTimerEl.classList.remove('timer-warning', 'timer-shake');
        } else {
            showView('homePage');
        }
        exitFullscreen();
        saveState();
        checkLevelUp();
        updateUpcomingTaskDisplay();
    }

    function toggleTodo() { if (!todoListPopup) return; const isVisible = todoListPopup.style.display === "flex"; if (isVisible) { saveTasks(); todoListPopup.style.display = "none"; } else { restoreTasks(); todoListPopup.style.display = "flex"; } }
    function addTaskLine(taskData = { id: Date.now() + Math.random(), text: "", completed: false, deadline: null, points: null, deadlineChecked: false }) {
        if (!tasksContainer) return null;
        const line = document.createElement("div");
        line.className = "task-line";
        line.dataset.taskId = taskData.id;
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "task-check"; checkbox.checked = taskData.completed; checkbox.onchange = handleTaskCompletionChange; const input = document.createElement("input"); input.type = "text"; input.className = "task-text"; input.placeholder = "Add quest..."; input.value = taskData.text; input.readOnly = taskData.completed; input.onkeydown = handleTaskInputKeydown; input.onchange = () => { line.dataset.text = input.value; }; line.dataset.text = taskData.text; line.dataset.completed = taskData.completed; if(taskData.deadline) line.dataset.deadline = taskData.deadline; if(taskData.points) line.dataset.points = taskData.points; if(taskData.deadlineChecked) line.dataset.deadlineChecked = taskData.deadlineChecked; const buttonsContainer = document.createElement('div'); buttonsContainer.className = 'task-buttons'; const deadlineBtn = document.createElement("button"); deadlineBtn.className = "set-deadline"; deadlineBtn.innerHTML = '<i class="fas fa-stopwatch"></i>'; deadlineBtn.title = "Deadline"; deadlineBtn.onclick = () => showDeadlineDialog(line); deadlineBtn.disabled = taskData.completed; const removeBtn = document.createElement("button"); removeBtn.className = "remove-task"; removeBtn.innerHTML = '<i class="fas fa-times"></i>'; removeBtn.title = "Remove"; removeBtn.onclick = () => removeTask(line); buttonsContainer.appendChild(deadlineBtn); buttonsContainer.appendChild(removeBtn); line.appendChild(checkbox); line.appendChild(input); line.appendChild(buttonsContainer); updateTaskDeadlineDisplay(line, taskData.deadline, taskData.points); tasksContainer.appendChild(line); if (taskData.completed) { line.style.opacity = '0.7'; }
        updateTodoBadge();
        updateUpcomingTaskDisplay();
        return input;
     }
    function handleTaskInputKeydown(event) { if (event.key === "Enter") { event.preventDefault(); const currentInput = event.target; const currentLine = currentInput.closest('.task-line'); if (currentLine) currentLine.dataset.text = currentInput.value; const allLines = tasksContainer?.querySelectorAll('.task-line'); if (!allLines) return; if (currentLine === allLines[allLines.length - 1]) { const newFocusTarget = addTaskLine(); if (newFocusTarget) newFocusTarget.focus(); } else { let nextLine = currentLine.nextElementSibling; while (nextLine && !nextLine.classList.contains('task-line')) { nextLine = nextLine.nextElementSibling; } if (nextLine) { const nextInput = nextLine.querySelector('.task-text'); if (nextInput) nextInput.focus(); } else { const newFocusTarget = addTaskLine(); if (newFocusTarget) newFocusTarget.focus(); } } } }
    function removeTask(taskElement) { if (!tasksContainer || !taskElement) return; const parentLine = taskElement.closest('.task-line'); if(parentLine) {tasksContainer.removeChild(parentLine);} updateTodoBadge(); updateUpcomingTaskDisplay(); }
    
    async function restoreTasks() {
        if (!tasksContainer) return;
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
            text: line.querySelector(".task-text")?.value.trim() || "",
            completed: line.querySelector(".task-check")?.checked || false,
            deadline: line.dataset.deadline ? parseInt(line.dataset.deadline) : null,
            points: line.dataset.points ? parseInt(line.dataset.points) : null,
            deadlineChecked: line.dataset.deadlineChecked === 'true'
        })).filter(task => task.text !== "");

        localStorage.setItem(`tasks_${currentUser}`, JSON.stringify(tasks));

        if (isSignedIn) {
            await window.__sb?.replaceTasks(tasks);
        }

        updateFocusStatus(); updateTodoBadge(); updateUpcomingTaskDisplay();
    }
    function handleTaskCompletionChange(event) { const checkbox = event.target; const taskLine = checkbox.closest('.task-line'); if (!taskLine) return; const input = taskLine.querySelector('.task-text'); const deadlineBtn = taskLine.querySelector('.set-deadline'); taskLine.dataset.completed = checkbox.checked; if (checkbox.checked) { if(input) input.readOnly = true; taskLine.style.opacity = '0.7'; if(deadlineBtn) deadlineBtn.disabled = true; checkSingleTaskDeadline(taskLine); } else { if(input) input.readOnly = false; taskLine.style.opacity = '1'; if(deadlineBtn) deadlineBtn.disabled = false; }
        updateTodoBadge();
        updateUpcomingTaskDisplay();
    }
    function checkSingleTaskDeadline(taskLine) { if (!taskLine) return; const deadlineTimestamp = taskLine.dataset.deadline ? parseInt(taskLine.dataset.deadline) : null; const deadlineChecked = taskLine.dataset.deadlineChecked === 'true'; const taskPoints = taskLine.dataset.points ? parseInt(taskLine.dataset.points) : null; const taskText = taskLine.querySelector('.task-text')?.value || "Untitled"; if (!deadlineTimestamp || deadlineChecked || !taskPoints) return; const now = Date.now(); let earnedPoints = 0; let message = ""; if (now <= deadlineTimestamp) { earnedPoints = applyPowerUps(taskPoints); points += earnedPoints; message = `Quest "${taskText}" on time! +${earnedPoints} XP`; playSfx('achievementAudio'); } else { message = `Quest "${taskText}" completed late.`; } showConfirmation("Quest Update", message, false); if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; taskLine.dataset.deadlineChecked = 'true'; saveState(); checkLevelUp(); updateTodoBadge(); updateUpcomingTaskDisplay(); }
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
    function handleDeadlineConfirmation(choice) { const dialog = document.getElementById("deadlineDialog"); if (!dialog || !currentTaskForDeadline) return; dialog.style.display = "none"; if (choice === "yes") { const dateValue = document.getElementById("deadlineDate").value; const timeValue = document.getElementById("deadlineTime").value; const selectedPoints = document.getElementById("taskDifficulty").value; if (!dateValue || !timeValue) { showConfirmation("Invalid", "Select date & time.", false); currentTaskForDeadline = null; return; } const deadlineTimestamp = new Date(`${dateValue}T${timeValue}`).getTime(); if (deadlineTimestamp <= Date.now()) { showConfirmation("Invalid", "Deadline must be future.", false); currentTaskForDeadline = null; return; } currentTaskForDeadline.dataset.deadline = deadlineTimestamp; currentTaskForDeadline.dataset.points = selectedPoints; currentTaskForDeadline.dataset.deadlineChecked = 'false'; updateTaskDeadlineDisplay(currentTaskForDeadline, deadlineTimestamp, selectedPoints); sentNotificationTaskIds.delete(currentTaskForDeadline.dataset.taskId);
        updateTodoBadge(); updateUpcomingTaskDisplay(); saveTasks();} currentTaskForDeadline = null; }
    function updateTaskDeadlineDisplay(taskLine, deadlineTimestamp, pointsValue) { const existingDeadlineSpan = taskLine.querySelector(".deadline-info"); if (existingDeadlineSpan) existingDeadlineSpan.remove(); const existingPointsSpan = taskLine.querySelector(".points-info"); if (existingPointsSpan) existingPointsSpan.remove(); if (deadlineTimestamp && pointsValue) { const deadlineDate = new Date(parseInt(deadlineTimestamp)); const deadlineInfo = document.createElement("span"); deadlineInfo.className = "deadline-info"; deadlineInfo.textContent = `Due: ${deadlineDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${deadlineDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}`; deadlineInfo.title = deadlineDate.toLocaleString(); const pointsInfo = document.createElement("span"); pointsInfo.className = "points-info"; pointsInfo.textContent = `+${pointsValue} XP`; const buttonsContainer = taskLine.querySelector('.task-buttons'); if (buttonsContainer) { taskLine.insertBefore(pointsInfo, buttonsContainer); taskLine.insertBefore(deadlineInfo, pointsInfo); } else { taskLine.appendChild(deadlineInfo); taskLine.appendChild(pointsInfo); } } }

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

            const diffMinutes = Math.round((nextTask.deadline - now) / (1000 * 60));
            const diffHours = Math.round(diffMinutes / 60);

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
                timeString = `Due: ${deadline.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${deadline.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}`;
                upcomingTaskDisplayEl.className = '';
            }
            upcomingTaskDisplayEl.innerHTML = `<i class="fas ${isOverdue ? 'fa-exclamation-triangle' : 'fa-bell'}"></i> ${nextTask.text} <span style="color: var(--text-dim); font-size: 0.9em;">(${timeString})</span>`;
        } else {
            upcomingTaskDisplayEl.innerHTML = `<i class="fas fa-star"></i> No urgent quests!`;
            upcomingTaskDisplayEl.className = 'none';
        }
    }
   
    function requestNotificationPermission() {
        if (!('Notification' in window)) {
            browserNotificationPermission = 'denied';
            browserNotificationsEnabled = false;
            if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = true;
            if (currentView === 'profile') displayProfileInfo();
            return Promise.resolve('denied');
        }
        return Notification.requestPermission().then(permission => {
            browserNotificationPermission = permission;
            if (permission === 'denied') {
                browserNotificationsEnabled = false;
                 if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = true;
            } else {
                 if (browserNotificationSettingCheckbox) browserNotificationSettingCheckbox.disabled = false;
                 if(permission === 'default') browserNotificationsEnabled = false;
            }
             if (currentView === 'profile') displayProfileInfo();
            saveState();
            return permission;
        });
    }

     function handleNotificationSettingChange(event) {
         const isEnabled = event.target.checked;
         browserNotificationsEnabled = isEnabled;
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
         if (!browserNotificationsEnabled || browserNotificationPermission !== 'granted' || !tasks) return;
         const now = Date.now();
         tasks.forEach(task => {
             if (!task.completed && task.deadline &&
                 task.deadline > now &&
                 task.deadline <= now + NOTIFICATION_LEAD_TIME &&
                 !sentNotificationTaskIds.has(task.id)
             ) {
                 const minutesLeft = Math.round((task.deadline - now) / (1000 * 60));
                 const title = `Quest Due Soon! (${minutesLeft} min)`;
                 const options = { body: task.text || "Upcoming task requires attention.", icon: '/favicon-32x32.png', tag: `task-${task.id}` };
                 try {
                     const notification = new Notification(title, options);
                     sentNotificationTaskIds.add(task.id);
                     notification.onclick = () => { window.focus(); showView('homePage'); toggleTodo(); };
                 } catch (err) { console.error("Error sending notification:", err); }
             }
         });
     }

    function parseInputUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const params = urlObj.searchParams;
            const playlistId = params.get('list');
            let videoId = params.get('v');
            if (urlObj.hostname === 'youtu.be') { videoId = urlObj.pathname.substring(1); }
            else if (urlObj.pathname.startsWith('/live/')) { videoId = urlObj.pathname.split('/')[2]; }
            else if (urlObj.pathname.startsWith('/shorts/')) { videoId = urlObj.pathname.split('/')[2]; }
            else if (urlObj.pathname.startsWith('/embed/')) { videoId = urlObj.pathname.split('/')[2]; }
            return { videoId: videoId || null, playlistId: playlistId || null };
        } catch (e) {
            let match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
            const videoId = match ? match[1] : null;
            match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
            const playlistId = match ? match[1] : null;
            return { videoId, playlistId };
        }
    }

     async function fetchPlaylistVideos(playlistId, pageToken = '') {
         if (!YOUTUBE_API_KEY || YOUTUBE_API_KEY === 'YOUR_API_KEY_HERE') {
             showConfirmation("API Key Error", "YouTube API Key is not configured.", false);
             return [];
         }
         let allVideoIds = [];
         const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${YOUTUBE_API_KEY}` + (pageToken ? `&pageToken=${pageToken}` : '');
         try {
             const response = await fetch(apiUrl);
             if (!response.ok) {
                 const errorData = await response.json();
                 throw new Error(errorData?.error?.message || `HTTP error! Status: ${response.status}`);
             }
             const data = await response.json();
             if (data.items) {
                 data.items.forEach(item => {
                     if (item.snippet?.resourceId?.kind === 'youtube#video' && item.snippet.resourceId.videoId) {
                         allVideoIds.push(item.snippet.resourceId.videoId);
                     }
                 });
             }
             if (data.nextPageToken) {
                 const nextPageVideos = await fetchPlaylistVideos(playlistId, data.nextPageToken);
                 allVideoIds = allVideoIds.concat(nextPageVideos);
             }
             return allVideoIds;
         } catch (error) {
             showConfirmation("Playlist Load Error", `Failed to load videos for playlist ${playlistId}. ${error.message}`, false);
             return [];
         }
     }

    async function prepareAndStartPlayback() {
        try {
            const urlElements = urlInputsContainer.querySelectorAll(".youtube-url");
            const urls = Array.from(urlElements).map(input => input.value.trim()).filter(url => url);
            if (urls.length === 0) { showConfirmation("No URLs", "Please enter at least one YouTube URL (video or playlist).", false); return; }

            videoIds = [];
            let playlistFetchPromises = [];

            urls.forEach(url => {
                const parsed = parseInputUrl(url);
                if (parsed) {
                    if (parsed.playlistId) {
                        playlistFetchPromises.push(fetchPlaylistVideos(parsed.playlistId));
                    } else if (parsed.videoId && !videoIds.includes(parsed.videoId)) {
                        videoIds.push(parsed.videoId);
                    }
                }
            });

            const playlistResults = await Promise.all(playlistFetchPromises);
            playlistResults.forEach(playlistVideoIds => {
                if (Array.isArray(playlistVideoIds)) {
                    playlistVideoIds.forEach(videoId => {
                        if (!videoIds.includes(videoId)) { videoIds.push(videoId); }
                    });
                }
            });

            if (videoIds.length === 0) {
                showConfirmation("No Videos Found", "Could not find any playable videos from the provided URLs or playlists.", false);
                return;
            }

            currentVideoIndex = 0;
            completedVideos.clear();
            allVideosCompleted = false;
            initializeYouTubeView();
            saveState();
            requestFullscreen(document.documentElement);

        } catch (err) {
            console.error("Playback preparation error:", err);
            showConfirmation("Playback Error", `Error starting the focus session: ${err.message}.`, false);
        }
    }

    function loadYouTubeAPI() { return new Promise((resolve, reject) => { if (isYouTubeAPILoaded) { resolve(); return; } const tag = document.createElement("script"); tag.src = "https://www.youtube.com/iframe_api"; tag.async = true; window.onYouTubeIframeAPIReady = () => { isYouTubeAPILoaded = true; resolve(); }; tag.onerror = (e) => reject(new Error("YT API script load failed.")); document.head.appendChild(tag); setTimeout(() => { if (!isYouTubeAPILoaded) reject(new Error("YT API load timeout.")); }, 15000); }); }
    function initializeYouTubeView() { if (videoIds.length === 0) { showView('homePage'); return; } currentSessionFocusTime = 0;
    updateStreak();
    showView('youtubeLecturePage');
    loadYouTubeAPI().then(() => { setupYouTubePlayer(); startTimer(focusDuration, "Focus Time"); setupVideoSidebar(); updateFocusStatus(); }).catch((err) => { showConfirmation("Player Error", "Cannot load YouTube player.", false); showView('youtubeLecturePage'); isFocusModeActive = false; }); }
    function setupYouTubePlayer() { if (!isYouTubeAPILoaded || !YT?.Player || !playerDiv || videoIds.length === 0) return; if (player && typeof player.destroy === 'function') { player.destroy(); } try { player = new YT.Player("player", { height: "100%", width: "100%", videoId: videoIds[currentVideoIndex], playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, showinfo: 0, iv_load_policy: 3, fs: 1 }, events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange, onError: onPlayerError }, }); } catch (error) { showConfirmation("Player Fail", "Error creating player.", false); showView('youtubeLecturePage'); } }
    function onPlayerReady(event) { event.target.playVideo(); isFocusModeActive = true; highlightCurrentThumbnail(); }
    function onPlayerStateChange(event) { if (event.data === YT.PlayerState.ENDED) { completedVideos.add(videoIds[currentVideoIndex]); totalVideosWatched++; points += applyPowerUps(50); if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; checkLevelUp(); saveState(); if (currentView === 'focusStats') displayFocusStatsInfo(); currentVideoIndex++; if (currentVideoIndex < videoIds.length) { player.loadVideoById(videoIds[currentVideoIndex]); } else { allVideosCompleted = true; showConfirmation("Playlist Done!", "All videos watched.", false); player.stopVideo(); } } highlightCurrentThumbnail(); }
    function onPlayerError(event) { console.error("YT Player Error:", event.data); let errorMsg = "Unknown YT error."; switch (event.data) { case 2: errorMsg = "Invalid parameter."; break; case 5: errorMsg = "HTML5 error."; break; case 100: errorMsg = "Not found."; break; case 101: case 150: errorMsg = "Embedding disallowed."; break; } showConfirmation("Video Error", `${errorMsg} Skipping.`, false); setTimeout(() => { currentVideoIndex++; if (currentVideoIndex < videoIds.length) { player.loadVideoById(videoIds[currentVideoIndex]); } else { allVideosCompleted = true; endFocusSession("Error playing videos."); } }, 2000); }
    function setupVideoSidebar() { if (!videoThumbnailList || !videoSidebar) return; videoThumbnailList.innerHTML = ''; const showSidebar = videoIds.length > 1; if(videoSidebarToggleBtn) videoSidebarToggleBtn.style.display = showSidebar ? 'block' : 'none'; if (!showSidebar) { closeVideoSidebar(); return; } videoIds.forEach((id, index) => { const thumbnail = document.createElement("img"); thumbnail.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg`; thumbnail.alt = `Video ${index + 1}`; thumbnail.className = "thumbnail"; thumbnail.dataset.index = index; thumbnail.loading = 'lazy';
    thumbnail.onclick = () => { if (index !== currentVideoIndex) { currentVideoIndex = index; player.loadVideoById(videoIds[currentVideoIndex]); closeVideoSidebar(); } }; thumbnail.onerror = () => { thumbnail.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; }; videoThumbnailList.appendChild(thumbnail); }); highlightCurrentThumbnail(); }
    function toggleVideoSidebar() { if (!videoSidebar) return; isVideoSidebarOpen = !isVideoSidebarOpen; videoSidebar.classList.toggle('open', isVideoSidebarOpen); if(videoSidebarToggleBtn) videoSidebarToggleBtn.innerHTML = isVideoSidebarOpen ? '<i class="fas fa-times"></i>' : '<i class="fas fa-list"></i>'; }
    function closeVideoSidebar() { if (!videoSidebar || !isVideoSidebarOpen) return; isVideoSidebarOpen = false; videoSidebar.classList.remove('open'); if(videoSidebarToggleBtn) videoSidebarToggleBtn.innerHTML = '<i class="fas fa-list"></i>'; }
    function highlightCurrentThumbnail() { if (!videoThumbnailList) return; videoThumbnailList.querySelectorAll('.thumbnail').forEach((thumb, index) => { thumb.classList.toggle('active', index === currentVideoIndex); }); }

    function startTimer(duration, mode) {
         if (!timerDisplay || !progressFill || !progressBar) return;
         clearInterval(countdownInterval);
         isFocusModeActive = true;
         timerMode = mode;
         let timeRemainingSeconds = Math.max(0, Math.floor(duration / 1000));
         const totalDurationSeconds = timeRemainingSeconds;

         countdownInterval = setInterval(() => {
             const minutes = Math.floor(timeRemainingSeconds / 60);
             const seconds = timeRemainingSeconds % 60;
             if(timerText) timerText.textContent = `${mode}: ${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
             const progress = totalDurationSeconds > 0 ? ((totalDurationSeconds - timeRemainingSeconds) / totalDurationSeconds) * 100 : 0;
             if(progressFill) progressFill.style.width = `${Math.min(100, progress)}%`;
             if (mode === "Focus Time") { totalFocusTime++; currentSessionFocusTime++; }
             timerRemaining = timeRemainingSeconds;
             timeRemainingSeconds--;

             if (timeRemainingSeconds < 0) {
                 clearInterval(countdownInterval);
                 if (mode === "Focus Time") {
                     points += applyPowerUps(100); if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; checkLevelUp(); playSfx("achievementAudio"); logDailyFocus();
                     showSessionCompleteDialog();
                 } else { // Break finished
                     startTimer(focusDuration, "Focus Time");
                 }
                 saveState();
             }
         }, 1000);
     }

    function endFocusSession(reason = "Session ended.") {
        lofiUserInitiated = false; pauseLofi(); clearInterval(countdownInterval);
        if (isFocusModeActive) { logDailyFocus(); }
        isFocusModeActive = false;
        if (player && typeof player.destroy === 'function') { player.destroy(); player = null; }
        videoIds = []; currentVideoIndex = 0; completedVideos.clear(); allVideosCompleted = false;
        exitFullscreen();
        saveState();
        updateFocusStatus();
        updateUpcomingTaskDisplay();
        showView('homePage');
    }

    function showSessionCompleteDialog() { const dialog = document.getElementById("sessionCompleteDialog"); if (dialog) dialog.style.display = "flex"; }
    function handleSessionContinue(choice) { document.getElementById("sessionCompleteDialog").style.display = "none"; if (choice === "continue") { points += applyPowerUps(100); if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`; showConfirmation("Bonus!", `+${applyPowerUps(100)} XP!`, false); playSfx('achievementAudio'); checkLevelUp(); saveState(); currentSessionFocusTime = 0;
    startTimer(focusDuration, "Focus Time"); } else { endFocusSession("User ended session after completion."); } }
    function requestExitSession() { showConfirmation( "Exit?", "End current focus session?", true, () => { endFocusSession("User exited session manually."); }); }
    function toggleAIPopup() { if (!aiPopup) return; aiPopup.style.display = aiPopup.style.display === "block" ? "none" : "block"; }
    function toggleSidebar() { if (!gameSidebar || !sidebarTrigger) return; isSidebarOpen = !isSidebarOpen; gameSidebar.classList.toggle('open', isSidebarOpen); sidebarTrigger.style.left = isSidebarOpen ? '280px' : '0px'; }
    function closeSidebar() { if (!gameSidebar || !sidebarTrigger || !isSidebarOpen) return; isSidebarOpen = false; gameSidebar.classList.remove('open'); sidebarTrigger.style.left = '0px'; }

    async function handleAuthAction(action, email, password) {
        const emailInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        email = email || emailInput.value.trim();
        password = password || passwordInput.value;

        if (!email || !password) {
            showConfirmation("Missing Info", "Please provide both email and password.", false);
            return;
        }

        let response;
        if (action === 'sign-up') {
            if (password.length < 6) {
                showConfirmation("Weak Password", "Password must be at least 6 characters.", false);
                return;
            }
            response = await supabase.auth.signUp({ email, password });
        } else if (action === 'sign-in') {
            response = await supabase.auth.signInWithPassword({ email, password });
        }

        const { data, error } = response;
        if (error) {
            showConfirmation("Auth Error", error.message, false);
        } else if(data.user) {
            if (action === 'sign-up') {
                showConfirmation("Success!", "Account created. Please check your email for verification.", false);
            }
            // onAuthStateChange will handle navigation and state loading
        }
    }

    async function handleSignOut() {
        showConfirmation("Logout?", "Are you sure you want to logout?", true, async () => {
            logDailyFocus();
            await saveState(); // Save final state before signing out
            const { error } = await supabase.auth.signOut();
            if (error) {
                showConfirmation("Logout Error", error.message, false);
            } else {
                // Clear local state
                isSignedIn = false; currentUser = null; points = 0; previousPoints = 0; totalFocusTime = 0; totalDistractions = 0; totalVideosWatched = 0; tasks = []; streakDays = 0; lastFocusDate = null; mysteryBoxCount = 0; activePowerUps = { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null } }; playlists = []; dailyFocusData = {};
                localStorage.removeItem(`focusModeState_v5`);
                localStorage.removeItem(`tasks_${currentUser}`);
                localStorage.removeItem(`playlists_${currentUser}`);
                window.location.reload(); // Reload to clear all state and show landing page
            }
        });
    }

    async function saveState() {
        const stateToSave = {
            points, previousPoints, totalFocusTime, totalDistractions, totalVideosWatched,
            streakDays, lastFocusDate, mysteryBoxCount, activePowerUps, dailyFocusData,
            premiumLofiTracks: premiumLofiTracks.map(t => ({ id: t.id, unlocked: t.unlocked })),
            browserNotificationsEnabled, currentPomodoroDurationSetting, currentView,
        };
        localStorage.setItem(`focusModeState_v5_${currentUser}`, JSON.stringify(stateToSave));
        if (isSignedIn) {
            await window.__sb.upsertAppState(stateToSave);
        }
    }

    async function loadSavedState(user) {
        console.log("Loading state for user:", user.id);
        currentUser = user.id;
        isSignedIn = true;

        const remoteData = await window.__sb.loadData();

        if(remoteData){
            points = remoteData.points ?? 0;
            previousPoints = remoteData.previous_points ?? points;
            totalFocusTime = remoteData.total_focus_time ?? 0;
            totalDistractions = remoteData.total_distractions ?? 0;
            totalVideosWatched = remoteData.total_videos_watched ?? 0;
            streakDays = remoteData.streak_days ?? 0;
            lastFocusDate = remoteData.last_focus_date ?? null;
            mysteryBoxCount = remoteData.mystery_box_count ?? 0;
            activePowerUps = remoteData.active_power_ups ?? { doublePoints: { active: false, expiry: null }, streakShield: { active: false, used: false, expiry: null } };
            dailyFocusData = remoteData.daily_focus_data ?? {};
            browserNotificationsEnabled = !!remoteData.browser_notifications_enabled;
            currentPomodoroDurationSetting = remoteData.current_pomodoro_duration_setting ?? 60;
            tasks = remoteData.tasks.map(t => ({...t, text: t.title})) ?? [];
            playlists = remoteData.playlists ?? [];

            if (Array.isArray(remoteData.premium_lofi_tracks)) {
                const map = new Map(remoteData.premium_lofi_tracks.map(t => [t.id, !!t.unlocked]));
                premiumLofiTracks.forEach(t => { if (map.has(t.id)) t.unlocked = map.get(t.id); });
            }
        } else {
             // Fallback to local storage if no remote data
            const localState = JSON.parse(localStorage.getItem(`focusModeState_v5_${currentUser}`) || "{}");
            points = localState.points || 0;
            tasks = JSON.parse(localStorage.getItem(`tasks_${currentUser}`) || '[]');
            playlists = JSON.parse(localStorage.getItem(`playlists_${currentUser}`) || '[]');
            //... load other properties from localState
        }

        updateAvailableLofiTracks();
        browserNotificationPermission = ('Notification' in window) ? Notification.permission : 'denied';
        if(pomodoroDurationInput) pomodoroDurationInput.value = currentPomodoroDurationSetting;
        if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
        updateAchievementLevel(); updateStreakDisplay(); await restoreTasks();
        checkExpiredPowerups(); sentNotificationTaskIds.clear();

        showView(remoteData?.current_view || 'homePage');
        startPeriodicChecks();
    }


    function checkExpiredPowerups() { let stateChanged = false; const now = Date.now(); if (activePowerUps.doublePoints.active && now > activePowerUps.doublePoints.expiry) { activePowerUps.doublePoints.active = false; stateChanged = true; } if (activePowerUps.streakShield.active && now > activePowerUps.streakShield.expiry) { activePowerUps.streakShield.active = false; activePowerUps.streakShield.used = false; stateChanged = true; } if (stateChanged) { saveState(); } }
    function requestFullscreen(element) { try { if (element.requestFullscreen) element.requestFullscreen().catch(()=>{}); } catch(e){} }
    function exitFullscreen() { try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{}); } catch(e){} }
    function showConfirmation(title, message, isCancellable = false, onConfirm = () => {}, onCancel = () => {}, dialogClass = '') { const dialog = document.getElementById("confirmationDialog"); const dialogBox = dialog?.querySelector(".dialog-box"); const titleEl = dialog?.querySelector("h3"); const messageEl = dialog?.querySelector("p"); const confirmBtn = document.getElementById("confirmBtn"); const cancelBtn = document.getElementById("cancelBtn"); if (!dialog || !dialogBox || !titleEl || !messageEl || !confirmBtn || !cancelBtn) return; dialogBox.className = 'dialog-box ' + dialogClass; titleEl.innerHTML = `<i class="fas ${isCancellable ? 'fa-question-circle' : 'fa-info-circle'}"></i> ${title}`; messageEl.textContent = message; cancelBtn.style.display = isCancellable ? "inline-block" : "none"; const newConfirmBtn = confirmBtn.cloneNode(true); confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn); const newCancelBtn = cancelBtn.cloneNode(true); cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn); newConfirmBtn.textContent = isCancellable ? "YES" : "OK"; newConfirmBtn.onclick = () => { dialog.style.display = 'none'; onConfirm(); }; if (isCancellable) { newCancelBtn.onclick = () => { dialog.style.display = 'none'; onCancel(); }; } dialog.style.display = "flex"; }

     function showCalendar() {
         generateCalendarGrid(calendarCurrentDate.getFullYear(), calendarCurrentDate.getMonth());
     }

    function generateCalendarGrid(year, month) {
        if (!calendarGrid || !calendarMonthYear) return;
        calendarGrid.innerHTML = '';
        calendarMonthYear.innerHTML = `<i class="fas fa-calendar-alt"></i> ${new Date(year, month).toLocaleString('default', { month: 'long' })} ${year}`;
        const firstDayOfMonth = (new Date(year, month, 1).getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const todayString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;

        for (let i = 0; i < firstDayOfMonth; i++) { calendarGrid.insertAdjacentHTML('beforeend', '<div class="calendar-day other-month"></div>'); }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateString = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            const focusData = dailyFocusData[dateString];
            const dayCell = document.createElement('div');
            dayCell.className = 'calendar-day';
            dayCell.textContent = day;
            if (focusData && focusData.focusTime > 0) {
                const focusMinutes = Math.floor(focusData.focusTime / 60);
                dayCell.classList.add('has-focus', focusMinutes >= 60 ? 'focus-high' : 'focus-medium');
                dayCell.title = `${focusMinutes} min focus`;
            }
            if (dateString === todayString) { dayCell.classList.add('today'); }
            calendarGrid.appendChild(dayCell);
        }
    }

     function changeCalendarMonth(offset) {
         calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + offset);
         showCalendar();
     }

     function startPeriodicChecks() {
         clearInterval(generalInterval);
         generalInterval = setInterval(() => {
             if (isSignedIn) { checkTaskDeadlines(); checkAndSendNotifications(); }
         }, 60000);
     }

    // --- Event Listener Setup ---
    function setupEventListeners() {
        document.body.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action) {
                switch (action) {
                    case 'show-view':
                        const view = e.target.closest('[data-view]').dataset.view;
                        showView(view);
                        break;
                    case 'sign-in': handleAuthAction('sign-in'); break;
                    case 'create-account': handleAuthAction('sign-up'); break;
                    case 'email-sign-up': handleAuthAction('sign-up'); break;
                    case 'email-sign-in': handleAuthAction('sign-in'); break;
                    case 'email-sign-out': handleSignOut(); break;
                    case 'github': window.open("https://github.com/The-Chosen-One-o5/UltraFocusModeYT", "_blank"); break;
                    case 'add-url': addUrlInput(); break;
                    case 'save-playlist': savePlaylist(); break;
                    case 'remove-playlist': removePlaylist(); break;
                    case 'start-playback': prepareAndStartPlayback(); break;
                    case 'toggle-todo': toggleTodo(); break;
                    case 'save-tasks': saveTasks(); break;
                    case 'add-task-line': addTaskLine().focus(); break;
                    case 'close-todo': toggleTodo(); break;
                }
            }
        });

        if(sidebarTrigger) sidebarTrigger.addEventListener('click', toggleSidebar);
        document.getElementById('logoutBtn')?.addEventListener('click', handleSignOut);
        document.getElementById('restartBtn')?.addEventListener('click', requestExitSession);
        if(videoSidebarToggleBtn) videoSidebarToggleBtn.addEventListener('click', toggleVideoSidebar);
        document.addEventListener('keydown', (e) => { if (document.activeElement.tagName !== 'INPUT' && (e.key === 't' || e.key === 'T')) { toggleVideoSidebar(); } });
        document.getElementById('streakShieldBtn')?.addEventListener('click', showStreakShieldDialog);
        document.getElementById('doublePointsBtn')?.addEventListener('click', showDoublePointsDialog);
        document.getElementById('audioStoreBtn')?.addEventListener('click', showAudioTracksStore);
        document.getElementById('quietPomodoroBtn')?.addEventListener('click', showPomodoroOverlay);
        document.getElementById('bossFightBtn')?.addEventListener('click', () => showConfirmation("Coming Soon!", "The Boss Fight feature is under development. Prepare for battle!", false));
        document.getElementById('streakShieldConfirmBtn')?.addEventListener('click', () => handleStreakShieldConfirmation('yes')); document.getElementById('streakShieldCancelBtn')?.addEventListener('click', () => handleStreakShieldConfirmation('no'));
        document.getElementById('doublePointsConfirmBtn')?.addEventListener('click', () => handleDoublePointsConfirmation('yes')); document.getElementById('doublePointsCancelBtn')?.addEventListener('click', () => handleDoublePointsConfirmation('no'));
        document.getElementById('deadlineConfirmBtn')?.addEventListener('click', () => handleDeadlineConfirmation('yes')); document.getElementById('deadlineCancelBtn')?.addEventListener('click', () => handleDeadlineConfirmation('no'));
        document.getElementById('sessionContinueBtn')?.addEventListener('click', () => handleSessionContinue('continue')); document.getElementById('sessionEndBtn')?.addEventListener('click', () => handleSessionContinue('end'));
        document.getElementById('openMysteryBox')?.addEventListener('click', openMysteryBox); document.getElementById('closeMysteryBoxBtn')?.addEventListener('click', closeMysteryBoxPopup);
        document.getElementById('closeAudioStore')?.addEventListener('click', closeAudioTracksStore);
        pomodoroStartBtn?.addEventListener('click', () => startPomodoro(false));
        pomodoroResetBtn?.addEventListener('click', resetPomodoro);
        pomodoroCloseBtn?.addEventListener('click', closePomodoroOverlay);
        pomodoroWithPdfBtn?.addEventListener('click', () => startPomodoro(true));
        document.getElementById('exitPdfViewBtn')?.addEventListener('click', () => { showView('homePage'); resetPomodoro(); });
         if(pomodoroDurationInput) { pomodoroDurationInput.addEventListener('change', () => { const newDuration = parseInt(pomodoroDurationInput.value, 10); if (!isNaN(newDuration) && newDuration >= 1 && newDuration <= 180) { currentPomodoroDurationSetting = newDuration; if (!isPomodoroActive) { pomodoroTimeRemaining = currentPomodoroDurationSetting * 60; updatePomodoroDisplay(); } } else { pomodoroDurationInput.value = currentPomodoroDurationSetting; showConfirmation("Invalid Time", "Set duration between 1 and 180 minutes.", false); } });}
         if (browserNotificationSettingCheckbox) { browserNotificationSettingCheckbox.addEventListener('change', handleNotificationSettingChange); }
        document.getElementById('lofiPlay')?.addEventListener('click', () => playLofi(true)); document.getElementById('lofiPause')?.addEventListener('click', pauseLofi); document.getElementById('lofiPrev')?.addEventListener('click', prevLofi); document.getElementById('lofiNext')?.addEventListener('click', nextLofi);
        if(fireBox) fireBox.addEventListener('click', toggleAIPopup);
        if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeCalendarMonth(-1));
        if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeCalendarMonth(1));

         document.addEventListener("visibilitychange", () => {
             const isHidden = document.hidden;
             if (isHidden) {
                pauseLofi();
                if ((isFocusModeActive && currentView === 'youtubeLecturePage') || isPomodoroActive) {
                    totalDistractions++;
                    const today = new Date();
                    const dateString = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
                    if (!dailyFocusData[dateString]) dailyFocusData[dateString] = { focusTime: 0, distractions: 0 };
                    dailyFocusData[dateString].distractions++;

                    if(isPomodoroActive){
                        pomodoroDistractionCount++;
                        points = Math.max(0, points - POMODORO_DISTRACTION_PENALTY);
                        if(pointsDisplay) pointsDisplay.innerHTML = `<span style="color: var(--secondary);">⭐</span> XP: ${points}`;
                        showConfirmation("Distraction!", `Pomodoro Focus Lost! -${POMODORO_DISTRACTION_PENALTY} XP.`, false);
                         if (pomodoroDistractionCount >= POMODORO_MAJOR_PENALTY_THRESHOLD) {
                             points = Math.max(0, points - POMODORO_MAJOR_PENALTY_AMOUNT);
                             showConfirmation("🚨 Major Penalty!", `Distraction limit exceeded! -${POMODORO_MAJOR_PENALTY_AMOUNT} XP!`, false);
                         }
                         checkLevelUp();
                    }
                    if(focusAudioElement) focusAudioElement.play().catch(()=>{});
                    saveState();
                }
             } else {
                if (focusAudioElement && !focusAudioElement.paused) { focusAudioElement.pause(); focusAudioElement.currentTime = 0; }
                if ((isFocusModeActive || isPomodoroActive) && lofiUserInitiated) { playLofi(false); }
             }
         });
         window.addEventListener('beforeunload', () => { if (isSignedIn) { logDailyFocus(); saveState(); } });
    }

    // --- Initialization ---
    document.addEventListener("DOMContentLoaded", async () => {
        // Cache DOM elements
        topNavBar = document.getElementById('topNavBar'); landingPage = document.getElementById('landingPage'); signinForm = document.getElementById('signinForm'); homePage = document.getElementById('homePage'); youtubeLecturePage = document.getElementById('youtubeLecturePage'); profilePage = document.getElementById('profile'); focusStatsPage = document.getElementById('focusStats'); pyqEmbedPage = document.getElementById('pyqEmbedPage'); pdfView = document.getElementById('pdfView');
        playerContainer = document.getElementById('playerContainer'); playerDiv = document.getElementById('player'); timerDisplay = document.getElementById('timerDisplay'); timerText = document.getElementById('timerText'); progressBar = document.getElementById('progressBar'); progressFill = document.getElementById('progressFill'); pointsDisplay = document.getElementById('pointsDisplay'); achievementLevelDiv = document.getElementById('achievementLevel'); lofiPlayer = document.getElementById('lofiPlayer'); aiPopup = document.getElementById('aiPopup'); fireBox = document.getElementById('fireBox'); videoSidebar = document.getElementById('videoSidebar'); videoThumbnailList = document.getElementById('videoThumbnailList'); usernameInput = document.getElementById('username'); passwordInput = document.getElementById('password'); homeUsernameSpan = document.getElementById('homeUsername'); dateTimeDisplaySpan = document.getElementById('dateTimeDisplay'); focusStatusSpan = document.getElementById('focusStatus'); youtubeInputContainer = document.getElementById('youtubeInputContainer'); playlistSelect = document.getElementById('playlistSelect'); urlInputsContainer = document.getElementById('urlInputs'); playlistNameInput = document.getElementById('playlistName'); todoListPopup = document.getElementById('todoList'); tasksContainer = document.getElementById('tasks');
        confirmationDialog = document.getElementById('confirmationDialog'); streakShieldDialog = document.getElementById('streakShieldDialog'); doublePointsDialog = document.getElementById('doublePointsDialog'); deadlineDialog = document.getElementById('deadlineDialog'); sessionCompleteDialog = document.getElementById('sessionCompleteDialog'); mysteryBoxPopup = document.getElementById('mysteryBoxPopup'); audioTracksStore = document.getElementById('audioTracksStore'); pomodoroOverlay = document.getElementById('pomodoroOverlay'); gameSidebar = document.querySelector('.game-sidebar'); sidebarTrigger = document.querySelector('.sidebar-trigger'); navClockTime = document.getElementById('navClockTime'); navClockPeriod = document.getElementById('navClockPeriod'); navStreakDisplay = document.getElementById('navStreakDisplay'); videoSidebarToggleBtn = document.getElementById('videoSidebarToggleBtn'); navProfileBtn = document.getElementById('navProfileBtn');
        calendarGrid = document.getElementById('calendarGrid'); calendarMonthYear = document.getElementById('calendarMonthYear'); prevMonthBtn = document.getElementById('prevMonthBtn'); nextMonthBtn = document.getElementById('nextMonthBtn');
        pomodoroTimerEl = document.getElementById('pomodoroTimer'); pomodoroDurationInput = document.getElementById('pomodoroDurationInput'); pomodoroStatusEl = document.getElementById('pomodoroStatus'); pomodoroStartBtn = document.getElementById('pomodoroStartBtn'); pomodoroResetBtn = document.getElementById('pomodoroResetBtn'); pomodoroCloseBtn = document.getElementById('pomodoroCloseBtn'); pomodoroWithPdfBtn = document.getElementById('pomodoroWithPdfBtn');
        todoBadgeEl = document.getElementById('todoBadge'); browserNotificationSettingCheckbox = document.getElementById('browserNotificationSetting'); upcomingTaskDisplayEl = document.getElementById('upcomingTaskDisplay');

        // Explicitly hide popups on start, in case of CSS errors
        if (todoListPopup) todoListPopup.style.display = 'none';

        initAudio();
        setupEventListeners();
        setInterval(updateClock, 1000);

        supabase.auth.onAuthStateChange(async (_event, session) => {
            if (session?.user) {
                window.__sbUser = session.user;
                if(!isSignedIn) await loadSavedState(session.user);
            } else {
                window.__sbUser = null;
                isSignedIn = false;
                currentUser = null;
                showView('landingPage');
            }
        });

        const { data: { session } } = await supabase.auth.getSession();
        if(session?.user){
             window.__sbUser = session.user;
             if(!isSignedIn) await loadSavedState(session.user);
        } else {
            showView('landingPage');
        }

    });

})();

