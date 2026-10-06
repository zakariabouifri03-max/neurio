(() => {
  'use strict';

  const INSTALL_FLAG = '__youtubeSmooth1080pContentInstalled';
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const DEFAULT_SETTINGS = Object.freeze({
    smartBufferProtection: true,
    maximumSmoothness: false,
    resumeBufferSeconds: 8
  });
  const SAMPLE_INTERVAL_MS = 1000;
  const PROTECTION_COOLDOWN_MS = 5000;
  const NORMAL_MAX_PAUSE_MS = 20000;
  const MAXIMUM_MAX_PAUSE_MS = 30000;
  const DRAIN_SLOPE_THRESHOLD = 0.18;
  const QUALITY_LABELS = Object.freeze({
    highres: '2160p+',
    hd2160: '2160p',
    hd1440: '1440p',
    hd1080: '1080p',
    hd720: '720p',
    large: '480p',
    medium: '360p',
    small: '240p',
    tiny: '144p',
    auto: 'Auto'
  });

  let settings = { ...DEFAULT_SETTINGS };
  let activeVideo = null;
  let activePlayer = null;
  let videoListeners = null;
  let discoveryTimer = null;
  let lastSnapshot = null;
  let lastSource = '';
  let lastRoute = location.pathname + location.search;
  let waitingSince = 0;
  let lastStallAt = 0;
  let lastSample = null;
  let trendSamples = [];
  let lastCurrentTime = 0;
  let lastProgressAt = Date.now();

  const protection = {
    active: false,
    video: null,
    startedAt: 0,
    cooldownUntil: 0,
    reason: ''
  };

  function normalizeSettings(value) {
    const candidate = value && typeof value === 'object' ? value : {};
    const target = Number(candidate.resumeBufferSeconds);
    return {
      smartBufferProtection: typeof candidate.smartBufferProtection === 'boolean'
        ? candidate.smartBufferProtection
        : DEFAULT_SETTINGS.smartBufferProtection,
      maximumSmoothness: typeof candidate.maximumSmoothness === 'boolean'
        ? candidate.maximumSmoothness
        : DEFAULT_SETTINGS.maximumSmoothness,
      resumeBufferSeconds: Number.isFinite(target)
        ? Math.min(18, Math.max(6, Math.round(target / 2) * 2))
        : DEFAULT_SETTINGS.resumeBufferSeconds
    };
  }

  function getPlayerFor(video) {
    if (!video) return document.querySelector('#movie_player, .html5-video-player');
    return video.closest('#movie_player, .html5-video-player')
      || document.querySelector('#movie_player, .html5-video-player')
      || video;
  }

  function findMainVideo() {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (player) {
      const video = player.querySelector('video.html5-main-video')
        || player.querySelector('video.video-stream')
        || player.querySelector('video');
      if (video) return video;
    }

    const known = document.querySelector('video.html5-main-video, ytd-player video, ytd-reel-video-renderer video');
    if (known) return known;

    // Shorts and future YouTube layouts may not keep the legacy player selectors.
    const candidates = Array.from(document.querySelectorAll('video'))
      .filter((video) => video.isConnected && (video.currentSrc || video.readyState > 0 || video.videoWidth > 0));
    candidates.sort((a, b) => (b.videoWidth * b.videoHeight) - (a.videoWidth * a.videoHeight));
    return candidates[0] || null;
  }

  function safelyCallPlayer(player, methodName) {
    try {
      if (player && typeof player[methodName] === 'function') {
        player[methodName]();
        return true;
      }
    } catch (_error) {
      // The player API is optional and varies across YouTube layouts.
    }
    return false;
  }

  function detachVideo() {
    if (activeVideo && videoListeners) {
      for (const [type, listener] of Object.entries(videoListeners)) {
        activeVideo.removeEventListener(type, listener);
      }
    }
    videoListeners = null;
    activeVideo = null;
    activePlayer = null;
    lastSource = '';
    waitingSince = 0;
    lastSample = null;
    trendSamples = [];
  }

  function releaseProtection(reason, shouldResume) {
    if (!protection.active) return;
    const video = protection.video;
    const player = getPlayerFor(video);
    protection.active = false;
    protection.video = null;
    protection.reason = '';
    protection.startedAt = 0;
    protection.cooldownUntil = Date.now() + (reason === 'settings-off' ? 1000 : PROTECTION_COOLDOWN_MS);

    if (!shouldResume || !video || !video.isConnected || video.ended) return;

    const calledPlayer = safelyCallPlayer(player, 'playVideo');
    if (!calledPlayer) {
      try {
        const playResult = video.play();
        if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
      } catch (_error) {
        // Autoplay policy or a page transition may prevent the best-effort resume.
      }
    }
  }

  function attachVideo(video) {
    if (video === activeVideo) {
      activePlayer = getPlayerFor(video);
      return;
    }

    if (protection.active) releaseProtection('video-changed', true);
    detachVideo();
    if (!video) return;

    activeVideo = video;
    activePlayer = getPlayerFor(video);
    lastSource = video.currentSrc || video.src || '';
    lastCurrentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    lastProgressAt = Date.now();

    const onWaiting = () => {
      waitingSince = Date.now();
      lastStallAt = waitingSince;
    };
    const onCanPlay = () => {
      waitingSince = 0;
    };
    const onPlaying = () => {
      waitingSince = 0;
      lastProgressAt = Date.now();
      if (protection.active && protection.video === video) {
        // A play event not issued by our resume path is treated as viewer/player intent.
        protection.active = false;
        protection.video = null;
        protection.reason = '';
        protection.startedAt = 0;
        protection.cooldownUntil = Date.now() + PROTECTION_COOLDOWN_MS;
      }
    };
    const onTimeUpdate = () => {
      if (video.currentTime > lastCurrentTime + 0.03) {
        lastCurrentTime = video.currentTime;
        lastProgressAt = Date.now();
        if (!video.paused) waitingSince = 0;
      }
    };
    const onSeeking = () => {
      waitingSince = 0;
      lastSample = null;
      trendSamples = [];
    };
    const onEnded = () => {
      waitingSince = 0;
      if (protection.active && protection.video === video) releaseProtection('ended', false);
    };

    videoListeners = {
      waiting: onWaiting,
      stalled: onWaiting,
      canplay: onCanPlay,
      playing: onPlaying,
      play: onPlaying,
      timeupdate: onTimeUpdate,
      seeking: onSeeking,
      ended: onEnded
    };
    for (const [type, listener] of Object.entries(videoListeners)) {
      video.addEventListener(type, listener, { passive: true });
    }
  }

  function discoverVideo() {
    discoveryTimer = null;
    const video = findMainVideo();
    if (video !== activeVideo) attachVideo(video);
  }

  function scheduleDiscovery(delay = 180) {
    if (discoveryTimer) return;
    discoveryTimer = window.setTimeout(discoverVideo, delay);
  }

  function pageType() {
    if (location.pathname.startsWith('/shorts/')) return 'YouTube Shorts';
    if (location.pathname === '/watch') return 'YouTube watch page';
    return 'YouTube';
  }

  function isAdShowing() {
    const player = activePlayer || getPlayerFor(activeVideo);
    if (!player) return false;
    if (player.classList && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) return true;
    const adMarker = player.querySelector('.ytp-ad-player-overlay, .ytp-ad-text');
    return Boolean(adMarker && adMarker.getClientRects().length > 0);
  }

  function getBufferedAhead(video) {
    if (!video) return null;
    let ranges;
    try {
      ranges = video.buffered;
    } catch (_error) {
      return null;
    }
    if (!ranges || ranges.length === 0) return 0;

    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let rangeIndex = -1;
    for (let index = 0; index < ranges.length; index += 1) {
      let start;
      let end;
      try {
        start = ranges.start(index);
        end = ranges.end(index);
      } catch (_error) {
        continue;
      }
      if (start <= currentTime + 0.25 && end >= currentTime - 0.25) {
        rangeIndex = index;
        break;
      }
      if (rangeIndex === -1 && start > currentTime && start - currentTime <= 0.25) {
        rangeIndex = index;
        break;
      }
    }
    if (rangeIndex === -1) return 0;

    let contiguousEnd = ranges.end(rangeIndex);
    for (let index = rangeIndex + 1; index < ranges.length; index += 1) {
      const start = ranges.start(index);
      const end = ranges.end(index);
      if (start - contiguousEnd > 0.3) break;
      contiguousEnd = Math.max(contiguousEnd, end);
    }
    return Math.max(0, contiguousEnd - currentTime);
  }

  function normalizeQuality(raw) {
    if (raw == null) return null;
    const value = String(raw).toLowerCase().trim();
    if (QUALITY_LABELS[value]) return QUALITY_LABELS[value];
    const match = value.match(/(?:hd)?(144|240|360|480|720|1080|1440|2160)p?/);
    return match ? `${match[1]}p` : (value === 'default' ? 'Auto' : null);
  }

  function getQuality(video, player) {
    try {
      if (player && typeof player.getPlaybackQuality === 'function') {
        const label = normalizeQuality(player.getPlaybackQuality());
        if (label) return { label, source: 'player-api' };
      }
    } catch (_error) {
      // Fall through to read-only media dimensions.
    }
    if (video && Number.isFinite(video.videoHeight) && video.videoHeight > 0) {
      return { label: `${Math.round(video.videoHeight)}p`, source: 'video-dimensions' };
    }
    return { label: null, source: 'unavailable' };
  }

  function getNetworkEstimate(bufferSeconds, video, now) {
    let connection = null;
    try {
      connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    } catch (_error) {
      connection = null;
    }

    const downlink = connection && Number(connection.downlink);
    const effectiveType = connection && typeof connection.effectiveType === 'string'
      ? connection.effectiveType.toLowerCase()
      : '';
    let label = 'Unknown';
    let source = null;

    if (Number.isFinite(downlink) && downlink > 0) {
      if (downlink < 2) label = 'Slow';
      else if (downlink < 8) label = 'Medium';
      else label = 'Fast';
      source = 'network-information-api';
    } else if (effectiveType === 'slow-2g' || effectiveType === '2g') {
      label = 'Slow';
      source = 'network-information-api';
    } else if (effectiveType === '3g') {
      label = 'Medium';
      source = 'network-information-api';
    } else if (effectiveType === '4g') {
      label = 'Fast';
      source = 'network-information-api';
    } else if ((lastStallAt && now - lastStallAt < 20000)
      || (video && !video.paused && bufferSeconds !== null && bufferSeconds < 2)) {
      label = 'Slow';
      source = 'playback-observation';
    } else if (video && !video.paused && bufferSeconds !== null && bufferSeconds < 6) {
      label = 'Medium';
      source = 'playback-observation';
    }

    return {
      label,
      downlinkMbps: Number.isFinite(downlink) && downlink > 0 ? downlink : null,
      effectiveType: effectiveType || null,
      source
    };
  }

  function updateTrend(bufferSeconds, now, video) {
    if (!Number.isFinite(bufferSeconds)) return null;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    let slope = null;
    if (lastSample) {
      const elapsed = (now - lastSample.time) / 1000;
      const sameSource = lastSample.source === (video.currentSrc || video.src || '');
      if (elapsed >= 0.45 && elapsed <= 3.5 && sameSource && !video.seeking) {
        slope = (bufferSeconds - lastSample.bufferSeconds) / elapsed;
        if (Number.isFinite(slope)) {
          trendSamples.push(slope);
          if (trendSamples.length > 5) trendSamples.shift();
        }
      }
    }
    lastSample = {
      time: now,
      bufferSeconds,
      currentTime,
      source: video.currentSrc || video.src || ''
    };
    if (slope === null || trendSamples.length === 0) return null;
    return trendSamples.reduce((total, value) => total + value, 0) / trendSamples.length;
  }

  function protectionProfile() {
    const baseResume = settings.resumeBufferSeconds;
    const resumeSeconds = settings.maximumSmoothness ? Math.min(24, baseResume + 6) : baseResume;
    const triggerSeconds = settings.maximumSmoothness
      ? Math.max(4.5, Math.min(7, resumeSeconds * 0.4))
      : Math.max(1.4, Math.min(3.3, baseResume * 0.33));
    return {
      resumeSeconds,
      triggerSeconds,
      riskHorizonSeconds: settings.maximumSmoothness ? 9 : 5.5,
      maxPauseMs: settings.maximumSmoothness ? MAXIMUM_MAX_PAUSE_MS : NORMAL_MAX_PAUSE_MS
    };
  }

  function beginProtection(video, player, reason, now) {
    if (protection.active || !video || video.paused || video.ended) return;
    protection.active = true;
    protection.video = video;
    protection.startedAt = now;
    protection.reason = reason;

    const calledPlayer = safelyCallPlayer(player, 'pauseVideo');
    if (!calledPlayer || !video.paused) {
      try {
        video.pause();
      } catch (_error) {
        protection.active = false;
        protection.video = null;
        protection.reason = '';
        protection.startedAt = 0;
      }
    }
  }

  function shouldBeginProtection(video, player, bufferSeconds, slope, now) {
    if (!settings.smartBufferProtection || !video || protection.active) return null;
    if (now < protection.cooldownUntil || video.paused || video.ended || video.seeking) return null;
    if (video.readyState < 2 || isAdShowing()) return null;
    if (video.currentTime < 1.5 && !waitingSince) return null;
    if (!Number.isFinite(bufferSeconds)) return null;

    const profile = protectionProfile();
    const falling = Number.isFinite(slope) && slope < -DRAIN_SLOPE_THRESHOLD;
    const predictedSecondsToEmpty = falling ? bufferSeconds / Math.max(0.05, -slope) : Infinity;
    const critical = bufferSeconds <= Math.min(1.2, profile.triggerSeconds);
    const lowAndFalling = bufferSeconds <= profile.triggerSeconds && falling;
    const predicted = falling
      && bufferSeconds <= profile.resumeSeconds
      && predictedSecondsToEmpty <= profile.riskHorizonSeconds;
    const waitingWithReserve = waitingSince > 0
      && now - waitingSince > 250
      && bufferSeconds > 0.35
      && bufferSeconds < profile.resumeSeconds;

    if (critical || lowAndFalling || predicted || waitingWithReserve) {
      if (predicted) return 'buffer-depletion-predicted';
      if (waitingWithReserve) return 'player-waiting';
      return 'low-buffer';
    }
    return null;
  }

  function maybeProtect(video, player, bufferSeconds, slope, now) {
    if (protection.active && protection.video === video) {
      const profile = protectionProfile();
      const elapsed = now - protection.startedAt;
      if (!settings.smartBufferProtection) {
        releaseProtection('settings-off', true);
      } else if (video.ended || !video.isConnected) {
        releaseProtection('video-ended', false);
      } else if (bufferSeconds !== null && bufferSeconds >= profile.resumeSeconds) {
        releaseProtection('buffer-ready', true);
      } else if (elapsed >= profile.maxPauseMs) {
        // A bounded hold avoids leaving the viewer paused forever if the player cannot fill while paused.
        releaseProtection('safety-timeout', true);
      }
      return;
    }

    const reason = shouldBeginProtection(video, player, bufferSeconds, slope, now);
    if (reason) beginProtection(video, player, reason, now);
  }

  function playbackState(video, bufferSeconds, now) {
    if (!video) return { state: 'unavailable', protectionPaused: false };
    if (protection.active && protection.video === video) {
      return { state: 'building', protectionPaused: true };
    }
    if (video.ended) return { state: 'ended', protectionPaused: false };
    if (video.seeking) return { state: 'seeking', protectionPaused: false };
    if (video.paused) return { state: 'paused', protectionPaused: false };

    const stalePlayback = now - lastProgressAt > 1400;
    if (waitingSince || (stalePlayback && bufferSeconds !== null && bufferSeconds < 0.5)) {
      return { state: 'buffering', protectionPaused: false };
    }
    return { state: 'stable', protectionPaused: false };
  }

  function createSnapshot() {
    const now = Date.now();
    const host = location.hostname.toLowerCase();
    const pageActive = host === 'youtube.com' || host.endsWith('.youtube.com');
    const video = activeVideo && activeVideo.isConnected ? activeVideo : null;
    const player = video ? getPlayerFor(video) : null;

    if (!video) {
      return {
        pageActive,
        pageType: pageType(),
        videoFound: false,
        quality: { label: null, source: 'unavailable' },
        connection: getNetworkEstimate(null, null, now),
        bufferSeconds: null,
        playback: { state: 'unavailable', protectionPaused: false },
        protectionPaused: false,
        currentTime: null,
        duration: null,
        sampledAt: now
      };
    }

    const bufferSeconds = getBufferedAhead(video);
    const playback = playbackState(video, bufferSeconds, now);
    return {
      pageActive,
      pageType: pageType(),
      videoFound: true,
      quality: getQuality(video, player),
      connection: getNetworkEstimate(bufferSeconds, video, now),
      bufferSeconds: Number.isFinite(bufferSeconds) ? Math.round(bufferSeconds * 10) / 10 : null,
      playback,
      protectionPaused: playback.protectionPaused,
      protectionReason: protection.reason || null,
      currentTime: Number.isFinite(video.currentTime) ? Math.round(video.currentTime * 10) / 10 : null,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      sampledAt: now
    };
  }

  function sample() {
    const found = findMainVideo();
    if (found !== activeVideo) attachVideo(found);
    if (!activeVideo) {
      lastSnapshot = createSnapshot();
      return;
    }
    if (!activeVideo.isConnected) {
      if (protection.active && protection.video === activeVideo) releaseProtection('player-removed', false);
      detachVideo();
      lastSnapshot = createSnapshot();
      return;
    }

    activePlayer = getPlayerFor(activeVideo);
    const source = activeVideo.currentSrc || activeVideo.src || '';
    if (source !== lastSource) {
      lastSource = source;
      lastSample = null;
      trendSamples = [];
      waitingSince = 0;
      if (protection.active && protection.video === activeVideo) releaseProtection('media-changed', true);
    }

    const now = Date.now();
    const bufferSeconds = getBufferedAhead(activeVideo);
    const slope = updateTrend(bufferSeconds, now, activeVideo);
    maybeProtect(activeVideo, activePlayer, bufferSeconds, slope, now);
    lastSnapshot = createSnapshot();
  }

  function applySettings(nextSettings) {
    settings = normalizeSettings(nextSettings);
    if (!settings.smartBufferProtection && protection.active) {
      releaseProtection('settings-off', true);
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'YS1080_GET_STATUS') {
      sendResponse(lastSnapshot || createSnapshot());
      return false;
    }
    if (message.type === 'YS1080_SET_SETTINGS') {
      applySettings(message.settings);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  chrome.storage.local.get('settings').then(({ settings: stored }) => {
    applySettings(stored);
  }).catch(() => {
    applySettings(DEFAULT_SETTINGS);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) applySettings(changes.settings.newValue);
  });

  const routeChanged = () => {
    const route = location.pathname + location.search;
    if (route !== lastRoute) {
      lastRoute = route;
      scheduleDiscovery(250);
    } else {
      scheduleDiscovery(120);
    }
  };
  for (const eventName of ['yt-navigate-finish', 'yt-page-data-updated', 'yt-navigate-cache']) {
    document.addEventListener(eventName, routeChanged, true);
  }
  window.addEventListener('popstate', routeChanged, true);

  try {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection && typeof connection.addEventListener === 'function') {
      connection.addEventListener('change', () => {
        lastSnapshot = createSnapshot();
      });
    }
  } catch (_error) {
    // Network Information API is optional.
  }

  const observer = new MutationObserver(() => {
    if (!activeVideo || !activeVideo.isConnected) scheduleDiscovery(220);
    else if (!activePlayer || !activePlayer.isConnected) scheduleDiscovery(220);
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  scheduleDiscovery(0);
  window.setInterval(sample, SAMPLE_INTERVAL_MS);
})();
