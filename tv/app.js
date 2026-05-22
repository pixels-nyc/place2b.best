// Global State variables
let player = null;
let currentVideoId = '';
let isLoopEnabled = true;
let isMuted = false;
let hudTimeoutId = null;
let lastInteractionTime = 0;

// Collections stored in LocalStorage
let favorites = [];
let historyList = [];

// Initialize Application once DOM loads
window.addEventListener('DOMContentLoaded', () => {
  loadCollections();
  renderFavorites();
  renderHistory();
  setupEventListeners();
  checkUrlParameters();
});

// Setup event listeners for UI buttons and keyboards
function setupEventListeners() {
  // Main Play Form
  const playForm = document.getElementById('play-form');
  if (playForm) {
    playForm.addEventListener('submit', handleFormSubmit);
  }

  // Clear Input Button
  const btnClearInput = document.getElementById('btn-clear-input');
  if (btnClearInput) {
    btnClearInput.addEventListener('click', () => {
      const urlInput = document.getElementById('video-url');
      if (urlInput) {
        urlInput.value = '';
        urlInput.focus();
      }
    });
  }

  // Clear History Button
  const btnClearHistory = document.getElementById('btn-clear-history');
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', clearHistory);
  }

  // Dashboard Control buttons
  document.getElementById('ctrl-play').addEventListener('click', togglePlay);
  document.getElementById('ctrl-mute').addEventListener('click', toggleMute);
  document.getElementById('ctrl-loop').addEventListener('click', toggleLoop);
  document.getElementById('ctrl-favorite').addEventListener('click', toggleFavoriteCurrent);
  document.getElementById('ctrl-theater').addEventListener('click', enterTheaterMode);

  // HUD (Theater Mode) Control buttons
  document.getElementById('hud-btn-play').addEventListener('click', togglePlay);
  document.getElementById('hud-btn-mute').addEventListener('click', toggleMute);
  document.getElementById('hud-btn-loop').addEventListener('click', toggleLoop);
  document.getElementById('hud-btn-favorite').addEventListener('click', toggleFavoriteCurrent);
  document.getElementById('hud-btn-exit').addEventListener('click', exitTheaterMode);

  // Spatial Navigation HUD trigger: Any keypress or mouse movement reveals HUD in theater mode
  document.addEventListener('keydown', handleGlobalKeydown);
  document.addEventListener('mousemove', triggerHudReveal);

  // Keep HUD open when elements inside are focused
  const hudContainer = document.getElementById('theater-hud');
  if (hudContainer) {
    hudContainer.addEventListener('focusin', () => {
      triggerHudReveal();
      // Temporarily clear timeout to keep HUD open while navigating it
      if (hudTimeoutId) {
        clearTimeout(hudTimeoutId);
        hudTimeoutId = null;
      }
    });
    
    hudContainer.addEventListener('focusout', () => {
      // Re-engage auto-hide after moving focus away
      startHudTimer();
    });
  }
}

// Global Keydown Handler (Remote controls & keyboard)
function handleGlobalKeydown(e) {
  const isTheater = document.body.classList.contains('theater-active');
  
  if (isTheater) {
    // Show HUD for any interaction
    triggerHudReveal();
    
    // Pressing Escape or Backspace (remote Back key sometimes triggers this)
    if (e.key === 'Escape' || e.keyCode === 27 || e.keyCode === 8) {
      // If we are in theater mode, exit theater mode
      exitTheaterMode();
      e.preventDefault();
    }
  }
}

// URL Parser: Extracts YouTube Video ID
function extractVideoId(urlOrId) {
  if (!urlOrId) return '';
  urlOrId = urlOrId.trim();

  // 1. Check if it's already a clean 11-char ID
  if (urlOrId.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  // 2. Try to parse as URL
  try {
    let urlString = urlOrId;
    // Add protocol if missing to allow URL parser to work
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = 'https://' + urlString;
    }
    const parsedUrl = new URL(urlString);
    const host = parsedUrl.hostname.toLowerCase();
    
    if (host.includes('youtu.be')) {
      const path = parsedUrl.pathname.substring(1);
      return path.split('/')[0].split('?')[0].substring(0, 11);
    }
    
    if (host.includes('youtube.com')) {
      const pathParts = parsedUrl.pathname.split('/');
      
      // Check paths like /shorts/ID, /embed/ID, /v/ID, /live/ID
      const triggerIndex = pathParts.findIndex(p => p === 'shorts' || p === 'embed' || p === 'v' || p === 'live');
      if (triggerIndex !== -1 && triggerIndex + 1 < pathParts.length) {
        return pathParts[triggerIndex + 1].substring(0, 11);
      }
      
      // Standard /watch?v=ID
      const vParam = parsedUrl.searchParams.get('v');
      if (vParam) {
        return vParam.substring(0, 11);
      }
    }
  } catch (e) {
    // Fall back to robust regex if URL parsing fails
  }

  // Robust regex fallback
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = urlOrId.match(regExp);
  return match ? match[1] : '';
}

// Form Submission handler
function handleFormSubmit(e) {
  e.preventDefault();
  const inputEl = document.getElementById('video-url');
  const query = inputEl.value;
  const videoId = extractVideoId(query);

  if (videoId) {
    playVideoById(videoId);
  } else {
    alert('Could not find a valid YouTube Video ID or Link. Please try again.');
    inputEl.focus();
  }
}

// Initialize or Play Video
function playVideoById(videoId, customTitle) {
  currentVideoId = videoId;
  updateStatusBar('loading', 'Loading video...');

  // Hide placeholder, show player container
  document.getElementById('player-placeholder').style.opacity = '0';
  setTimeout(() => {
    document.getElementById('player-placeholder').style.display = 'none';
    document.getElementById('youtube-player').style.display = 'block';
  }, 400);

  // If player doesn't exist yet, load API and create it
  if (!player) {
    createPlayer(videoId);
  } else {
    // Player exists, load video
    player.loadVideoById({
      videoId: videoId
    });
  }

  // Add to History list
  const title = customTitle || videoId;
  addToHistory(videoId, title);
  
  // Update Fav status indicators
  updateFavoriteButtons();
  
  // Activate Controls Card on dashboard
  document.body.classList.add('video-active');
}

// Create YouTube Player Instance
function createPlayer(videoId) {
  // Ensure YT API script is loaded. If window.YT is not defined, wait a bit
  if (typeof YT === 'undefined' || !YT.Player) {
    setTimeout(() => createPlayer(videoId), 100);
    return;
  }

  player = new YT.Player('youtube-player', {
    videoId: videoId,
    playerVars: {
      autoplay: 1,
      controls: 0,         // Hide native controls
      disablekb: 1,        // Disable player keyboard actions
      fs: 0,               // Disable fullscreen buttons
      rel: 0,              // Disable related videos
      modestbranding: 1,   // Hide YouTube logo
      iv_load_policy: 3,   // Hide annotations
      wmode: 'transparent'
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}

// Player API callbacks
function onPlayerReady(event) {
  updateStatusBar('playing', 'Looping Active');
  
  // Apply initial mute state
  if (isMuted) {
    player.mute();
  } else {
    player.unMute();
  }

  // Update Title in HUD once video loads
  setTimeout(updateCurrentVideoTitle, 1000);
  
  // Auto-play trigger to make sure it plays on Fire Stick
  player.playVideo();
  updateControlsUI();
}

function onPlayerStateChange(event) {
  // State: PLAYING (1)
  if (event.data === YT.PlayerState.PLAYING) {
    updateStatusBar('playing', 'Looping Active');
    updateControlsUI();
    updateCurrentVideoTitle();
  }
  
  // State: PAUSED (2)
  if (event.data === YT.PlayerState.PAUSED) {
    updateStatusBar('ready', 'Paused');
    updateControlsUI();
  }

  // State: ENDED (0) -> Loop trigger!
  if (event.data === YT.PlayerState.ENDED) {
    if (isLoopEnabled) {
      updateStatusBar('playing', 'Looping...');
      player.playVideo();
    } else {
      updateStatusBar('ready', 'Finished');
    }
  }
}

function onPlayerError(event) {
  console.error('YouTube Player Error:', event.data);
  updateStatusBar('ready', 'Playback Error');
  alert('An error occurred loading this YouTube video. It might be restricted, private, or copyrighted.');
}

// Update Title in local storage and display HUD
function updateCurrentVideoTitle() {
  if (player && typeof player.getVideoData === 'function') {
    const videoData = player.getVideoData();
    if (videoData && videoData.title) {
      const title = videoData.title;
      // Update HUD
      document.getElementById('hud-video-title').textContent = title;
      
      // Update in history and favorites maps to have actual titles
      updateTitleInStorage(currentVideoId, title);
    }
  }
}

// Controls: Play / Pause Toggle
function togglePlay() {
  if (!player) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
}

// Controls: Mute Toggle
function toggleMute() {
  if (!player) return;
  isMuted = !isMuted;
  if (isMuted) {
    player.mute();
  } else {
    player.unMute();
  }
  updateControlsUI();
}

// Controls: Loop Toggle
function toggleLoop() {
  isLoopEnabled = !isLoopEnabled;
  updateControlsUI();
}

// Controls: Update Dashboard & HUD UI buttons
function updateControlsUI() {
  const isPlaying = player && player.getPlayerState() === YT.PlayerState.PLAYING;
  
  // Dashboard Controls
  const ctrlPlay = document.getElementById('ctrl-play');
  ctrlPlay.querySelector('.icon').textContent = isPlaying ? '⏸' : '▶';
  ctrlPlay.querySelector('.label').textContent = isPlaying ? 'Pause' : 'Play';
  
  const ctrlMute = document.getElementById('ctrl-mute');
  ctrlMute.querySelector('.icon').textContent = isMuted ? '🔇' : '🔊';
  ctrlMute.querySelector('.label').textContent = isMuted ? 'Unmute' : 'Mute';
  
  const ctrlLoop = document.getElementById('ctrl-loop');
  if (isLoopEnabled) {
    ctrlLoop.classList.add('active');
    ctrlLoop.querySelector('.label').textContent = 'Loop: ON';
  } else {
    ctrlLoop.classList.remove('active');
    ctrlLoop.querySelector('.label').textContent = 'Loop: OFF';
  }

  // HUD (Theater Mode) Controls
  const hudPlay = document.getElementById('hud-btn-play');
  hudPlay.textContent = isPlaying ? '⏸ Pause' : '▶ Play';

  const hudMute = document.getElementById('hud-btn-mute');
  hudMute.textContent = isMuted ? '🔇 Unmute' : '🔊 Mute';

  const hudLoop = document.getElementById('hud-btn-loop');
  if (isLoopEnabled) {
    hudLoop.classList.add('active');
    hudLoop.textContent = '🔁 Loop: ON';
  } else {
    hudLoop.classList.remove('active');
    hudLoop.textContent = '🔁 Loop: OFF';
  }
}

// Theater Mode: Enter Fullscreen TV display
function enterTheaterMode() {
  document.body.classList.add('theater-active');
  triggerHudReveal();
  setTimeout(() => {
    const playBtn = document.getElementById('hud-btn-play');
    if (playBtn) playBtn.focus();
  }, 100);
}

// Theater Mode: Exit back to Dashboard
function exitTheaterMode() {
  document.body.classList.remove('theater-active');
  
  if (hudTimeoutId) {
    clearTimeout(hudTimeoutId);
  }
  const hud = document.getElementById('theater-hud');
  if (hud) hud.classList.remove('hud-visible');

  setTimeout(() => {
    const playSubmitBtn = document.getElementById('btn-play-submit');
    if (playSubmitBtn) playSubmitBtn.focus();
  }, 100);
}

// HUD Overlay Fade Timer logic
function triggerHudReveal() {
  const hud = document.getElementById('theater-hud');
  if (!hud || !document.body.classList.contains('theater-active')) return;

  hud.classList.add('hud-visible');
  
  if (hudTimeoutId) {
    clearTimeout(hudTimeoutId);
  }

  startHudTimer();
}

function startHudTimer() {
  const activeEl = document.activeElement;
  const hud = document.getElementById('theater-hud');
  if (hud && hud.contains(activeEl)) {
    return;
  }

  hudTimeoutId = setTimeout(() => {
    if (hud) {
      hud.classList.remove('hud-visible');
    }
  }, 4000);
}

// LocalStorage: Load favorites and history
function loadCollections() {
  try {
    const savedFavorites = localStorage.getItem('loopplay_favs');
    favorites = savedFavorites ? JSON.parse(savedFavorites) : [];

    const savedHistory = localStorage.getItem('loopplay_hist');
    historyList = savedHistory ? JSON.parse(savedHistory) : [];
  } catch (e) {
    console.error('Error reading localStorage:', e);
    favorites = [];
    historyList = [];
  }
}

// LocalStorage: Add new item to History
function addToHistory(id, title) {
  historyList = historyList.filter(item => item.id !== id);
  historyList.unshift({ id: id, title: title });
  
  if (historyList.length > 10) {
    historyList.pop();
  }
  
  saveHistory();
  renderHistory();
}

// LocalStorage: Save History
function saveHistory() {
  try {
    localStorage.setItem('loopplay_hist', JSON.stringify(historyList));
  } catch (e) {
    console.error(e);
  }
}

// LocalStorage: Clear History
function clearHistory() {
  historyList = [];
  saveHistory();
  renderHistory();
}

// LocalStorage: Favorite Toggle
function toggleFavoriteCurrent() {
  if (!currentVideoId) return;
  
  const index = favorites.findIndex(item => item.id === currentVideoId);
  if (index >= 0) {
    favorites.splice(index, 1);
  } else {
    let title = currentVideoId;
    if (player && typeof player.getVideoData === 'function') {
      const data = player.getVideoData();
      if (data && data.title) title = data.title;
    }
    favorites.unshift({ id: currentVideoId, title: title });
  }

  saveFavorites();
  renderFavorites();
  updateFavoriteButtons();
}

function removeFavoriteById(id) {
  favorites = favorites.filter(item => item.id !== id);
  saveFavorites();
  renderFavorites();
  updateFavoriteButtons();
}

// LocalStorage: Save Favorites
function saveFavorites() {
  try {
    localStorage.setItem('loopplay_favs', JSON.stringify(favorites));
  } catch (e) {
    console.error(e);
  }
}

// LocalStorage: Update titles once YouTube API retrieves them
function updateTitleInStorage(id, newTitle) {
  let updated = false;

  historyList.forEach(item => {
    if (item.id === id && item.title !== newTitle) {
      item.title = newTitle;
      updated = true;
    }
  });

  favorites.forEach(item => {
    if (item.id === id && item.title !== newTitle) {
      item.title = newTitle;
      updated = true;
    }
  });

  if (updated) {
    saveFavorites();
    saveHistory();
    renderFavorites();
    renderHistory();
  }
}

// Update Favorite Star/Icons in UI controls
function updateFavoriteButtons() {
  const isFavorite = favorites.some(item => item.id === currentVideoId);
  
  const dashboardFav = document.getElementById('ctrl-favorite');
  dashboardFav.querySelector('.icon').textContent = isFavorite ? '★' : '☆';
  dashboardFav.querySelector('.label').textContent = isFavorite ? 'Saved' : 'Save';
  if (isFavorite) dashboardFav.classList.add('active');
  else dashboardFav.classList.remove('active');

  const hudFav = document.getElementById('hud-btn-favorite');
  hudFav.textContent = isFavorite ? '★ Saved' : '☆ Save';
  if (isFavorite) hudFav.classList.add('active');
  else hudFav.classList.remove('active');
}

// Render Favorite list in dashboard UI
function renderFavorites() {
  const listEl = document.getElementById('favorites-list');
  if (!listEl) return;

  if (favorites.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No favorites saved yet. Star a video to save it here!</div>';
    return;
  }

  listEl.innerHTML = '';
  favorites.forEach((item, index) => {
    const container = document.createElement('div');
    container.className = 'collection-item-row';
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.width = '100%';

    const btn = document.createElement('button');
    btn.className = 'collection-item';
    btn.setAttribute('tabindex', (13 + index * 2).toString());
    btn.innerHTML = `
      <div class="collection-thumb" style="background-image: url('https://img.youtube.com/vi/${item.id}/default.jpg')"></div>
      <div class="collection-details">
        <span class="collection-title">${item.title}</span>
        <span class="collection-meta">ID: ${item.id}</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      playVideoById(item.id, item.title);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove-item';
    removeBtn.setAttribute('tabindex', (13 + index * 2 + 1).toString());
    removeBtn.innerHTML = '✕';
    removeBtn.setAttribute('title', 'Remove favorite');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFavoriteById(item.id);
    });

    container.appendChild(btn);
    container.appendChild(removeBtn);
    listEl.appendChild(container);
  });
}

// Render Recent History list in dashboard UI
function renderHistory() {
  const listEl = document.getElementById('history-list');
  if (!listEl) return;

  if (historyList.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No recently played loops.</div>';
    return;
  }

  listEl.innerHTML = '';
  const historyStartIndex = 35;
  historyList.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.className = 'collection-item';
    btn.setAttribute('tabindex', (historyStartIndex + index).toString());
    btn.innerHTML = `
      <div class="collection-thumb" style="background-image: url('https://img.youtube.com/vi/${item.id}/default.jpg')"></div>
      <div class="collection-details">
        <span class="collection-title">${item.title}</span>
        <span class="collection-meta">ID: ${item.id}</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      playVideoById(item.id, item.title);
    });
    listEl.appendChild(btn);
  });
}

// Check URL Parameters on init (e.g. ?v=videoId or ?url=...)
function checkUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('v');
  const url = params.get('url');

  if (v) {
    const videoId = extractVideoId(v);
    if (videoId) playVideoById(videoId);
  } else if (url) {
    const videoId = extractVideoId(url);
    if (videoId) playVideoById(videoId);
  }
}

// Update top Status Bar display status
function updateStatusBar(type, text) {
  const statusBar = document.getElementById('status-bar');
  if (!statusBar) return;

  statusBar.className = 'status-bar ' + type;
  const statusText = statusBar.querySelector('.status-text');
  if (statusText) statusText.textContent = text;
}
