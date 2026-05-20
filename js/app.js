(function () {
  "use strict";

  let localAudio = null;
  let localAudioBound = false;
  let playerMode = "local";
  let scUiBound = false;
  let localFilePicker = null;

  function useSc() {
    return playerMode === "soundcloud" && window.SoundCloudPlayer && SoundCloudPlayer.isActive();
  }

  function isScTrack(t) {
    if (!t) return false;
    if (t.scPlaylistUrl) return true;
    const file = String(t.file || t.permalink || "");
    return /soundcloud\.com/i.test(file);
  }

  function useScForTrack(t) {
    return isScTrack(t) && window.SoundCloudPlayer && SoundCloudPlayer.canEmbed();
  }

  function folderLabelFromScUrl(url) {
    const slug = String(url || "")
      .replace(/\/+$/, "")
      .split("/")
      .pop();
    const label = slug ? decodePathPart(slug).replace(/[_-]+/g, " ") : "playlist";
    return "~/soundcloud/" + label.toLowerCase().replace(/\s+/g, "-") + "/";
  }

  function mergeLibraryEntries(newEntries) {
    if (!Array.isArray(newEntries) || !newEntries.length) return;
    const existing = Array.isArray(window.PLAYLIST_LIBRARY) ? window.PLAYLIST_LIBRARY.slice() : [];
    const byFolder = {};
    existing.forEach(function (entry) {
      if (entry && entry.folder) byFolder[entry.folder] = entry;
    });
    newEntries.forEach(function (entry) {
      if (!entry || !entry.folder) return;
      const key = entry.folder;
      if (!byFolder[key]) {
        byFolder[key] = { folder: key, tracks: [] };
      }
      const seen = new Set(
        byFolder[key].tracks.map(function (t) {
          return String(t.file || "") + "|" + String(t.name || "");
        }),
      );
      (entry.tracks || []).forEach(function (t) {
        const id = String(t.file || "") + "|" + String(t.name || "");
        if (seen.has(id)) return;
        seen.add(id);
        byFolder[key].tracks.push(t);
      });
    });
    window.PLAYLIST_LIBRARY = Object.keys(byFolder)
      .sort()
      .map(function (k) {
        return byFolder[k];
      });
    if (window.activePlaylistFolderIndex >= window.PLAYLIST_LIBRARY.length) {
      window.activePlaylistFolderIndex = 0;
    }
    window.persistActivePlaylistFolder();
  }

  function trackDurationSeconds(t) {
    if (!t) return 0;
    if (t.durationMs && t.durationMs > 0) return t.durationMs / 1000;
    if (t.duration && t.duration > 0) {
      return t.duration > 1000 ? t.duration / 1000 : t.duration;
    }
    return 0;
  }

  function setPlaylistRowDuration(index, seconds) {
    const li = document.getElementById("pl-" + index);
    if (!li) return;
    const dur = li.querySelector(".pl-dur");
    if (!dur) return;
    dur.textContent = seconds > 0 && isFinite(seconds) ? fmt(seconds) : "–:––";
  }

  function ensureTrackDuration(track, index) {
    const known = trackDurationSeconds(track);
    if (known > 0) {
      setPlaylistRowDuration(index, known);
      return Promise.resolve(known);
    }
    if (isScTrack(track)) {
      setPlaylistRowDuration(index, 0);
      return Promise.resolve(0);
    }
    const src = String(track.file || "");
    if (!src) {
      setPlaylistRowDuration(index, 0);
      return Promise.resolve(0);
    }
    return new Promise(function (resolve) {
      const probe = document.createElement("audio");
      probe.preload = "metadata";
      const done = function (sec) {
        try {
          probe.removeAttribute("src");
          probe.load();
        } catch {
          /**/
        }
        resolve(sec);
      };
      probe.addEventListener(
        "loadedmetadata",
        function () {
          if (probe.duration && isFinite(probe.duration)) {
            track.durationMs = Math.round(probe.duration * 1000);
            setPlaylistRowDuration(index, probe.duration);
            done(probe.duration);
          } else {
            setPlaylistRowDuration(index, 0);
            done(0);
          }
        },
        { once: true },
      );
      probe.addEventListener(
        "error",
        function () {
          setPlaylistRowDuration(index, 0);
          done(0);
        },
        { once: true },
      );
      probe.src = src;
    });
  }

  function hydratePlaylistDurations() {
    const tr = tracks();
    tr.forEach(function (t, i) {
      ensureTrackDuration(t, i);
    });
  }

  function refreshPlaylistUi() {
    rebuildOrder();
    window.renderPlaylist();
    window.renderLibraryFolders();
    hydratePlaylistDurations();
  }

  function getAudio() {
    const tr = tracks();
    const t = tr[order[currentQueueIdx]];
    if (useScForTrack(t)) return null;
    if (!localAudio) {
      localAudio = document.createElement("audio");
      localAudio.id = "player";
      localAudio.style.display = "none";
      document.body.appendChild(localAudio);
    }
    return localAudio;
  }

  function stopLocalAudio() {
    if (!localAudio) return;
    try {
      localAudio.pause();
    } catch {
      /**/
    }
    isPlaying = false;
    setPlayIcon(false);
    const vinyl = document.getElementById("vinyl");
    const win = document.getElementById("player-win");
    if (vinyl) vinyl.classList.remove("playing");
    if (win) win.classList.remove("playing-window");
  }

  function stopScPlayback() {
    if (!window.SoundCloudPlayer || !SoundCloudPlayer.isActive()) return;
    try {
      SoundCloudPlayer.pause();
    } catch {
      /**/
    }
    isPlaying = false;
    setPlayIcon(false);
    const vinyl = document.getElementById("vinyl");
    const win = document.getElementById("player-win");
    if (vinyl) vinyl.classList.remove("playing");
    if (win) win.classList.remove("playing-window");
  }

  let currentQueueIdx = 0;
  let isPlaying = false;
  let isShuffle = false;
  let isLoop = false;
  let order = [];
  let failedInRow = 0;
  let fallbackCoverIdx = -1;
  const availableAssetCache = {};
  const SUPPORTED_PLAYABLE_EXT = ["mp3", "wav", "ogg", "opus", "aac", "m4a", "mp4", "webm", "flac"];
  const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];

  const WIN_MAP = {
    "player-win": { tb: "tb-player", di: "di-player", dock: "dock-player" },
    "library-win": { tb: "tb-library", di: "di-library", dock: "dock-library" },
    "bio-win": { tb: "tb-bio", di: "di-bio", dock: "dock-bio" },
    "playlist-win": { tb: "tb-playlist", di: "di-playlist", dock: "dock-playlist" },
    "vibe-win": { tb: "tb-vibe", di: "di-vibe", dock: "dock-vibe" },
    "settings-win": { tb: "tb-settings", di: "di-settings", dock: "dock-settings" },

    "paint-win": { tb: null, di: null, dock: null },
    "calc-win": { tb: null, di: null, dock: null },
    "calendar-win": { tb: null, di: null, dock: null },
    "autoclick-win": { tb: null, di: null, dock: null },
  };

  const MAIN_WIN_IDS = Object.keys(WIN_MAP);

  function tracks() {
    return window.getActiveTracks();
  }

  function decodePathPart(s) {
    try {
      return decodeURIComponent(String(s || ""));
    } catch {
      return String(s || "");
    }
  }

  function fileExt(path) {
    const m = String(path || "").toLowerCase().match(/\.([a-z0-9]+)(?:[#?].*)?$/);
    return m ? m[1] : "";
  }

  function isAudioPath(path) {
    return SUPPORTED_PLAYABLE_EXT.includes(fileExt(path));
  }

  function cleanNameFromFile(path) {
    const base = String(path || "")
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, "");
    return decodePathPart(base).replace(/[_-]+/g, " ").trim() || "Unknown Track";
  }

  function titleFromFolderPath(path) {
    const seg = String(path || "")
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean)
      .pop() || "playlist";
    const label = decodePathPart(seg).replace(/[_-]+/g, " ").trim();
    return label
      .split(/\s+/)
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function makeTrack(filePath, artistLabel) {
    return {
      file: filePath,
      name: cleanNameFromFile(filePath),
      artist: artistLabel || "Playlist",
      emoji: "🎵",
      duration: 0,
      durationMs: 0,
    };
  }

  async function listDirEntries(path) {
    try {
      const resp = await fetch(path, { cache: "no-store" });
      if (!resp.ok) return [];
      const html = await resp.text();
      const out = [];
      const rx = /href\s*=\s*["']([^"']+)["']/gi;
      let m;
      while ((m = rx.exec(html))) {
        const href = m[1];
        if (!href || href === "../" || href.startsWith("?") || href.startsWith("#")) continue;
        if (/^[a-z]+:/i.test(href) && !href.startsWith("http")) continue;
        if (href.startsWith("/")) continue;
        out.push(href);
      }
      return Array.from(new Set(out));
    } catch {
      return [];
    }
  }

  async function collectThumbnailDefaults() {
    const known = Array.isArray(window.PLAYER_THUMBNAILS) ? window.PLAYER_THUMBNAILS.slice() : [];
    const entries = await listDirEntries("img/thumbnail.player/");
    entries.forEach(function (entry) {
      const p = "img/thumbnail.player/" + entry.replace(/\/+$/, "");
      if (IMAGE_EXT.includes(fileExt(p))) known.push(p);
    });
    const uniq = Array.from(new Set(known));
    window.PLAYER_THUMBNAILS = uniq;
  }

  async function resolveTrackCover(filePath) {
    // Avoid probing for many per-track names and rely on default thumbnails when no explicit cover is provided.
    return null;
  }

  async function parseReferenceListFile(filePath) {
    try {
      const resp = await fetch(filePath, { cache: "no-store" });
      if (!resp.ok) return [];
      const raw = await resp.text();
      return raw
        .split(/\r?\n/)
        .map(function (line) {
          return line.trim();
        })
        .filter(function (line) {
          return !!line && !line.startsWith("#");
        })
        .map(function (line) {
          if (/^[a-z]+:\/\//i.test(line)) return line;
          if (line.startsWith("/")) return line.slice(1);
          const folder = filePath.split("/").slice(0, -1).join("/");
          return (folder ? folder + "/" : "") + line.replace(/^\.\/+/, "");
        });
    } catch {
      return [];
    }
  }

  async function loadManifestLibrary() {
    const manifestPath = window.MUSIC_MANIFEST_PATH || "music/library.json";
    try {
      const resp = await fetch(manifestPath, { cache: "no-store" });
      if (!resp.ok) return [];
      const json = await resp.json();
      const playlists = Array.isArray(json && json.playlists) ? json.playlists : [];
      const out = [];
      for (let i = 0; i < playlists.length; i++) {
        const pl = playlists[i] || {};
        const folderPath = String(pl.folder || "").trim();
        const tracksRaw = Array.isArray(pl.tracks) ? pl.tracks : [];
        const artist = titleFromFolderPath(folderPath || "playlist");
        const tracksPrepared = [];
        for (let j = 0; j < tracksRaw.length; j++) {
          const src = tracksRaw[j];
          const filePath = typeof src === "string" ? src : src && src.file;
          if (!filePath || !isAudioPath(filePath)) continue;
          const track = makeTrack(filePath, artist);
          if (src && typeof src === "object") {
            if (src.name) track.name = String(src.name);
            if (src.artist) track.artist = String(src.artist);
            if (src.emoji) track.emoji = String(src.emoji);
            if (src.cover) track.cover = String(src.cover);
            if (src.duration) track.duration = Number(src.duration);
            if (src.durationMs) track.durationMs = Number(src.durationMs);
          }
          if (!track.cover) track.cover = await resolveTrackCover(filePath);
          tracksPrepared.push(track);
        }
        if (tracksPrepared.length) {
          out.push({
            folder: "~/" + String(folderPath || "music/").replace(/^\/+/, "").replace(/\/+$/, "/"),
            tracks: tracksPrepared,
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async function buildLibraryFromMusicFolder() {
    const root = "music/";
    const rootEntries = await listDirEntries(root);
    let playlistFolders = rootEntries.filter(function (entry) {
      return entry.endsWith("/") && entry !== "../";
    });
    if (!playlistFolders.length && Array.isArray(window.MUSIC_PLAYLIST_FOLDERS)) {
      playlistFolders = window.MUSIC_PLAYLIST_FOLDERS.map(function (name) {
        const clean = String(name || "").trim().replace(/^\/+|\/+$/g, "");
        return clean ? clean + "/" : "";
      }).filter(Boolean);
    }
    const library = [];

    for (let i = 0; i < playlistFolders.length; i++) {
      const folderRel = playlistFolders[i];
      const folderPath = root + folderRel;
      const artist = titleFromFolderPath(folderPath);
      const entries = await listDirEntries(folderPath);
      const tracks = [];

      for (let j = 0; j < entries.length; j++) {
        const item = entries[j];
        if (item.endsWith("/")) continue;
        const fullPath = folderPath + item;
        const ext = fileExt(fullPath);
        if (isAudioPath(fullPath)) {
          const track = makeTrack(fullPath, artist);
          track.cover = await resolveTrackCover(fullPath);
          tracks.push(track);
        } else if (ext === "m3u" || ext === "m3u8" || ext === "sources") {
          const refs = await parseReferenceListFile(fullPath);
          for (let r = 0; r < refs.length; r++) {
            if (!isAudioPath(refs[r])) continue;
            const refTrack = makeTrack(refs[r], artist);
            refTrack.cover = await resolveTrackCover(refs[r]);
            tracks.push(refTrack);
          }
        }
      }

      if (tracks.length) {
        library.push({
          folder: "~/" + folderPath.replace(/\/+$/, "/"),
          tracks: tracks,
        });
      }
    }

    return library;
  }

  async function initLibraryFromFolderAnalysis() {
    await collectThumbnailDefaults();
    const manifestLibrary = await loadManifestLibrary();
    if (manifestLibrary.length) {
      window.PLAYLIST_LIBRARY = manifestLibrary;
      return;
    }
    if (window.location.protocol === "file:") {
      if (!Array.isArray(window.PLAYLIST_LIBRARY)) window.PLAYLIST_LIBRARY = [];
      return;
    }
    const scanned = await buildLibraryFromMusicFolder();
    if (scanned.length) {
      window.PLAYLIST_LIBRARY = scanned;
      return;
    }
    window.PLAYLIST_LIBRARY = [];
  }

  function createLocalFilePicker() {
    if (localFilePicker) return localFilePicker;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".mp3,.wav,.ogg,.opus,.aac,.m4a,.mp4,.webm,.flac,audio/*";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.display = "none";
    input.addEventListener("change", onPickLocalFolder);
    document.body.appendChild(input);
    localFilePicker = input;
    return input;
  }

  function normalizeImportedPlaylistName(relPath) {
    const first = String(relPath || "")
      .split("/")
      .filter(Boolean)[0] || "Imported";
    return titleFromFolderPath(first);
  }

  async function onPickLocalFolder(ev) {
    const files = Array.from((ev.target && ev.target.files) || []);
    const byPlaylist = {};
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = f.webkitRelativePath || f.name;
      if (!isAudioPath(f.name)) continue;
      const playlistName = normalizeImportedPlaylistName(rel);
      if (!byPlaylist[playlistName]) byPlaylist[playlistName] = [];
      const objectUrl = URL.createObjectURL(f);
      const track = {
        file: objectUrl,
        name: cleanNameFromFile(f.name),
        artist: playlistName,
        emoji: "🎵",
      };
      track.cover = await resolveTrackCover(f.name);
      byPlaylist[playlistName].push(track);
    }

    const nextLibrary = Object.keys(byPlaylist)
      .sort()
      .map(function (playlistName) {
        return {
          folder: "~/music/" + playlistName.toLowerCase() + "/",
          tracks: byPlaylist[playlistName],
        };
      })
      .filter(function (entry) {
        return entry.tracks.length > 0;
      });

    if (!nextLibrary.length) return;
    mergeLibraryEntries(nextLibrary);
    playerMode = "local";
    const newIdx = window.PLAYLIST_LIBRARY.findIndex(function (e) {
      return e.folder === nextLibrary[0].folder;
    });
    if (newIdx >= 0) window.activePlaylistFolderIndex = newIdx;
    refreshPlaylistUi();
    loadTrack(0, false);
    setPlayIcon(false);
    isPlaying = false;
    const idle = window.t ? window.t("nowPlayingIdle") : "♫ idle";
    const nb = document.getElementById("now-playing-bar");
    if (nb) nb.textContent = idle;
    if (ev && ev.target) ev.target.value = "";
  }

  window.pickMusicFolder = function () {
    const input = createLocalFilePicker();
    input.click();
  };

  function rebuildOrder() {
    const tr = tracks();
    order = tr.map(function (_, i) {
      return i;
    });
  }

  function applyTrackUi(t) {
    document.getElementById("track-name").textContent = t.name;
    document.getElementById("track-artist").textContent = t.artist;
    document.getElementById("track-file").textContent = isScTrack(t) ? t.permalink || t.file : "~/" + t.file;
    setTrackCover(t);
    const bar = document.getElementById("now-playing-bar");
    if (bar) bar.textContent = "♫ " + t.name + " — " + t.artist;
    updatePlaylistActive();
    updateSongMeta(t);
  }

  function bindLocalAudioEvents() {
    if (localAudioBound) return;
    const audio = getAudio();
    if (!audio) return;
    localAudioBound = true;
    audio.addEventListener("timeupdate", function () {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      document.getElementById("progress-fill").style.width = pct + "%";
      document.getElementById("cur-time").textContent = fmt(audio.currentTime);
      document.getElementById("dur-time").textContent = fmt(audio.duration);
      const mm = document.getElementById("meta-duration");
      if (mm) mm.textContent = fmt(audio.duration);
    });
    audio.addEventListener("loadedmetadata", function () {
      const mm = document.getElementById("meta-duration");
      if (mm && audio.duration) mm.textContent = fmt(audio.duration);
      const tr = tracks();
      const t = tr[order[currentQueueIdx]];
      if (t && audio.duration && isFinite(audio.duration)) {
        t.durationMs = Math.round(audio.duration * 1000);
        setPlaylistRowDuration(order[currentQueueIdx], audio.duration);
      }
    });
    audio.addEventListener("ended", function () {
      if (isLoop) {
        audio.play();
        return;
      }
      window.nextTrack(true);
    });
    audio.addEventListener("error", function () {
      const tr = tracks();
      if (!tr.length) return;
      failedInRow += 1;
      if (failedInRow >= tr.length) {
        const nm = document.getElementById("track-name");
        const ar = document.getElementById("track-artist");
        const bar = document.getElementById("now-playing-bar");
        if (nm) nm.textContent = "No playable tracks";
        if (ar) ar.textContent = "Add audio or set SoundCloud URL";
        if (bar) bar.textContent = "♫ track load error";
        setPlayIcon(false);
        isPlaying = false;
        return;
      }
      window.nextTrack();
    });

    audio.addEventListener("pause", function () {
      setPlayIcon(false);
      isPlaying = false;
      const vinyl = document.getElementById("vinyl");
      const win = document.getElementById("player-win");
      if (vinyl) vinyl.classList.remove("playing");
      if (win) win.classList.remove("playing-window");
    });

    audio.addEventListener("play", function () {
      setPlayIcon(true);
      isPlaying = true;
      const vinyl = document.getElementById("vinyl");
      const win = document.getElementById("player-win");
      if (vinyl) vinyl.classList.add("playing");
      if (win) win.classList.add("playing-window");
    });
  }

  function bindScWidgetUi() {
    if (scUiBound || !window.SoundCloudPlayer) return;
    scUiBound = true;
    const SC = window.SC;
    SoundCloudPlayer.bind(SC.Widget.Events.PLAY_PROGRESS, function () {
      SoundCloudPlayer.getPosition(function (pos) {
        SoundCloudPlayer.getDuration(function (dur) {
          if (!dur) return;
          const pct = (pos / dur) * 100;
          document.getElementById("progress-fill").style.width = pct + "%";
          document.getElementById("cur-time").textContent = fmt(pos / 1000);
          document.getElementById("dur-time").textContent = fmt(dur / 1000);
          const mm = document.getElementById("meta-duration");
          if (mm) mm.textContent = fmt(dur / 1000);
        });
      });
    });
    SoundCloudPlayer.bind(SC.Widget.Events.PLAY, function () {
      const tr = tracks();
      const queued = tr[order[currentQueueIdx]];
      if (queued && queued.name) {
        applyTrackUi(queued);
        setPlayIcon(true);
        isPlaying = true;
        document.getElementById("vinyl").classList.add("playing");
        document.getElementById("player-win").classList.add("playing-window");
        return;
      }
      SoundCloudPlayer.getCurrentSound(function (sound) {
        SoundCloudPlayer.getCurrentSoundIndex(function (idx) {
          const widgetIdx = typeof idx === "number" ? idx : 0;
          const name = SoundCloudPlayer.resolveTitle(sound, widgetIdx, queued && queued.name);
          const t = {
            name: name,
            artist: (sound && sound.user && sound.user.username) || (queued && queued.artist) || "SoundCloud",
            file: (sound && sound.permalink_url) || (queued && queued.file) || "",
            permalink: (sound && sound.permalink_url) || (queued && queued.permalink) || "",
            cover:
              (sound && sound.artwork_url ? sound.artwork_url.replace("-large", "-t500x500") : "") ||
              (queued && queued.cover) ||
              "",
            scIndex: queued && typeof queued.scIndex === "number" ? queued.scIndex : widgetIdx,
            scPlaylistUrl: (queued && queued.scPlaylistUrl) || SoundCloudPlayer.getCurrentPlaylistUrl(),
            duration: (sound && sound.duration) || (queued && queued.duration) || 0,
            durationMs: (sound && sound.duration) || (queued && queued.durationMs) || 0,
          };
          applyTrackUi(t);
          setPlayIcon(true);
          isPlaying = true;
          document.getElementById("vinyl").classList.add("playing");
          document.getElementById("player-win").classList.add("playing-window");
        });
      });
    });
    SoundCloudPlayer.bind(SC.Widget.Events.PAUSE, function () {
      setPlayIcon(false);
      isPlaying = false;
      document.getElementById("vinyl").classList.remove("playing");
      document.getElementById("player-win").classList.remove("playing-window");
    });
    SoundCloudPlayer.bind(SC.Widget.Events.FINISH, function () {
      if (isLoop) {
        SoundCloudPlayer.play();
        return;
      }
      window.nextTrack(true);
    });
  }

  function integrateSoundCloudTracks(scUrl, scTracks) {
    if (!scTracks || !scTracks.length) return;
    mergeLibraryEntries([
      {
        folder: folderLabelFromScUrl(scUrl),
        tracks: scTracks,
      },
    ]);
    bindScWidgetUi();
    refreshPlaylistUi();
  }

  function loadAllSoundCloudPlaylists(urls) {
    if (!window.SoundCloudPlayer || !SoundCloudPlayer.canEmbed()) return Promise.resolve();
    const list = (urls || []).filter(Boolean);
    if (!list.length) return Promise.resolve();

    let chain = Promise.resolve();
    list.forEach(function (url) {
      chain = chain.then(function () {
        return SoundCloudPlayer.fetchPlaylist(url).then(function (fetched) {
          if (fetched.length) integrateSoundCloudTracks(url, fetched);
        });
      });
    });
    return chain;
  }

  function queueSoundCloudActivation(urls) {
    loadAllSoundCloudPlaylists(urls);
  }

  async function initPlayerSource() {
    playerMode = "local";
    bindLocalAudioEvents();
    await initLibraryFromFolderAnalysis();
    const scUrls = window.getSoundCloudPlaylistUrls ? window.getSoundCloudPlaylistUrls() : [];
    if (scUrls.length && window.SoundCloudPlayer && SoundCloudPlayer.canEmbed()) {
      queueSoundCloudActivation(scUrls);
    }
  }

  function playScTrack(t, autoPlay) {
    stopLocalAudio();
    const plUrl = t.scPlaylistUrl || String(window.SOUNDCLOUD_PLAYLIST_URL || "").trim();
    const scIdx = typeof t.scIndex === "number" ? t.scIndex : 0;
    playerMode = "soundcloud";
    SoundCloudPlayer.ensurePlaylist(plUrl).then(function (ok) {
      if (!ok) return;
      bindScWidgetUi();
      SoundCloudPlayer.skip(scIdx);
      applyTrackUi(t);
      if (autoPlay) SoundCloudPlayer.play();
    });
  }

  function loadTrack(queueIdx, autoPlay) {
    const tr = tracks();
    if (!tr.length) return;
    currentQueueIdx = ((queueIdx % tr.length) + tr.length) % tr.length;
    const t = tr[order[currentQueueIdx]];
    failedInRow = 0;
    if (!t) return;
    if (useScForTrack(t)) {
      playScTrack(t, autoPlay);
      return;
    }
    playerMode = "local";
    stopScPlayback();
    const audio = getAudio();
    if (!audio) return;
    if (isPlaying) audio.pause();
    audio.src = t.file;
    applyTrackUi(t);
    const rowIdx = order[currentQueueIdx];
    ensureTrackDuration(t, rowIdx);
    if (autoPlay) {
      audio.play().catch(function () {});
      setPlayIcon(true);
      isPlaying = true;
      document.getElementById("vinyl").classList.add("playing");
      document.getElementById("player-win").classList.add("playing-window");
    }
  }

  function getFallbackCoverDataUri() {
    return "data:image/svg+xml;utf8," + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#1f1f1f'/><stop offset='1' stop-color='#0d0d0d'/></linearGradient></defs><rect width='512' height='512' fill='url(#g)'/><circle cx='430' cy='430' r='70' fill='none' stroke='#ffd600' stroke-opacity='.35' stroke-width='6'/><circle cx='256' cy='256' r='90' fill='none' stroke='#ffd600' stroke-opacity='.18' stroke-width='4'/></svg>"
    );
  }

  function probeImage(path) {
    if (!path) return Promise.resolve(null);
    if (availableAssetCache[path] !== undefined) return Promise.resolve(availableAssetCache[path] ? path : null);
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        availableAssetCache[path] = true;
        resolve(path);
      };
      img.onerror = function () {
        availableAssetCache[path] = false;
        resolve(null);
      };
      img.src = path;
    });
  }

  async function firstAvailableImage(candidates) {
    for (let i = 0; i < candidates.length; i++) {
      const ok = await probeImage(candidates[i]);
      if (ok) return ok;
    }
    return null;
  }

  function setTrackCover(track) {
    const cover = document.getElementById("track-cover");
    if (!cover) return;
    const thumbs = Array.isArray(window.PLAYER_THUMBNAILS) ? window.PLAYER_THUMBNAILS : [];
    if (track && track.cover) {
      probeImage(track.cover).then(function (path) {
        cover.src = path || getFallbackCoverDataUri();
      });
      return;
    }
    if (!thumbs.length) {
      cover.src = getFallbackCoverDataUri();
      return;
    }
    fallbackCoverIdx = (fallbackCoverIdx + 1) % thumbs.length;
    const rotated = thumbs.slice(fallbackCoverIdx).concat(thumbs.slice(0, fallbackCoverIdx));
    firstAvailableImage(rotated).then(function (path) {
      cover.src = path || getFallbackCoverDataUri();
    });
  }

  function playSongIndex(trackIndex) {
    const tr = tracks();
    if (!tr.length) return;
    const pos = order.indexOf(trackIndex);
    if (pos >= 0) loadTrack(pos, true);
  }

  window.togglePlay = function () {
    const tr = tracks();
    const t = tr[order[currentQueueIdx]];
    if (useScForTrack(t)) {
      if (!window.SoundCloudPlayer || !SoundCloudPlayer.canEmbed()) return;
      SoundCloudPlayer.unlock().then(function () {
        if (isPlaying) {
          SoundCloudPlayer.pause();
          setPlayIcon(false);
          isPlaying = false;
          document.getElementById("vinyl").classList.remove("playing");
          document.getElementById("player-win").classList.remove("playing-window");
          return;
        }
        playScTrack(t, true);
      });
      return;
    }
    const audio = getAudio();
    if (!audio) return;
    if (!audio.src) {
      loadTrack(currentQueueIdx, true);
      return;
    }
    if (audio.paused) {
      audio.play().catch(function () {});
      setPlayIcon(true);
      document.getElementById("vinyl").classList.add("playing");
      document.getElementById("player-win").classList.add("playing-window");
      isPlaying = true;
    } else {
      audio.pause();
      setPlayIcon(false);
      document.getElementById("vinyl").classList.remove("playing");
      document.getElementById("player-win").classList.remove("playing-window");
      isPlaying = false;
    }
  };

  window.setPlayIcon = function (playing) {
    const icon = document.getElementById("play-icon");
    isPlaying = playing;
    if (playing) {
      icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
      icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    }
  };

  window.seekAudio = function (e) {
    const bar = document.getElementById("progress-bar");
    const pct = e.offsetX / bar.offsetWidth;
    const tr = tracks();
    const t = tr[order[currentQueueIdx]];
    if (useScForTrack(t)) {
      SoundCloudPlayer.getDuration(function (dur) {
        SoundCloudPlayer.seekTo(dur * pct);
      });
      return;
    }
    const audio = getAudio();
    if (!audio || !audio.duration) return;
    audio.currentTime = pct * audio.duration;
  };

  function fmt(s) {
    if (isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  window.nextTrack = function (autoPlay) {
    const tr = tracks();
    if (!tr.length) return;
    let idx = currentQueueIdx + 1;
    if (idx >= tr.length) idx = 0;
    loadTrack(idx, typeof autoPlay === "boolean" ? autoPlay : isPlaying);
  };

  window.prevTrack = function () {
    const tr = tracks();
    if (!tr.length) return;
    const t = tr[order[currentQueueIdx]];
    if (!useScForTrack(t)) {
      const audio = getAudio();
      if (audio && audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
      }
    }
    let idx = currentQueueIdx - 1;
    if (idx < 0) idx = tr.length - 1;
    loadTrack(idx, isPlaying);
  };

  window.toggleShuffle = function () {
    isShuffle = !isShuffle;
    const btn = document.getElementById("shuffle-ctrl");
    btn.classList.toggle("active-ctrl", isShuffle);
    if (isShuffle) shuffleOrder();
    else rebuildOrder();
  };

  function shuffleOrder() {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    if (window.SoundCloudPlayer && SoundCloudPlayer.isActive()) SoundCloudPlayer.reshuffle();
  }

  window.shufflePlaylist = function () {
    isShuffle = true;
    shuffleOrder();
    loadTrack(0, isPlaying);
    document.getElementById("shuffle-ctrl").classList.add("active-ctrl");
    const btn = document.getElementById("shuffle-list-btn");
    btn.classList.add("on");
    setTimeout(function () {
      btn.classList.remove("on");
    }, 1200);
  };

  window.toggleLoop = function () {
    isLoop = !isLoop;
    document.getElementById("loop-ctrl").classList.toggle("active-ctrl", isLoop);
  };

  window.setVol = function (v) {
    const tr = tracks();
    const t = tr[order[currentQueueIdx]];
    if (useScForTrack(t)) SoundCloudPlayer.setVolume(v);
    else {
      const audio = getAudio();
      if (audio) audio.volume = v / 100;
    }
    document.getElementById("vol-val").textContent = String(v);
  };

  window.renderPlaylist = function () {
    const ul = document.getElementById("playlist-list");
    const tr = tracks();
    if (!ul) return;
    ul.innerHTML = tr
      .map(function (t, i) {
        const durSec = trackDurationSeconds(t);
        const durLabel = durSec > 0 ? fmt(durSec) : "–:––";
        return (
          '<li id="pl-' +
          i +
          '" onclick="playSongIndex(' +
          i +
          ')">' +
          '<span class="pl-num">' +
          String(i + 1).padStart(2, "0") +
          "</span>" +
          '<span class="pl-name">' +
          t.emoji +
          " " +
          escapeHtml(t.name || "Unknown Track") +
          "</span>" +
          '<span class="pl-dur">' +
          durLabel +
          "</span></li>"
        );
      })
      .join("");
    hydratePlaylistDurations();
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  window.updatePlaylistActive = function () {
    const trLen = tracks().length;
    document.querySelectorAll(".playlist-list li").forEach(function (li, i) {
      li.classList.toggle("active", i < trLen && order[currentQueueIdx] === i);
    });
  };

  window.playSongIndex = playSongIndex;

  window.renderLibraryFolders = function () {
    const el = document.querySelector(".folder-list");
    const pathBar = document.getElementById("library-active-path");
    if (pathBar) {
      const unified = window.getUnifiedFolderLabel ? window.getUnifiedFolderLabel() : "";
      pathBar.textContent = unified + " · " + window.getActiveFolderLabel();
    }
    if (!el) return;
    el.innerHTML = window.PLAYLIST_LIBRARY.map(function (entry, idx) {
      const active = idx === window.activePlaylistFolderIndex ? " active" : "";
      const analysis = analyzeFolder(entry);
      return (
        '<div class="file-item folder' +
        active +
        '" onclick="selectPlaylistFolder(' +
        idx +
        ')">' +
        '<span class="file-icon">📁</span>' +
        "<span>" +
        escapeHtml(entry.folder) +
        "</span>" +
        '<span class="file-size">' +
        entry.tracks.length +
        " tracks • " +
        analysis.formats +
        "</span></div>"
      );
    }).join("");
    window.updateLibraryPreview();
  };

  window.selectPlaylistFolder = function (idx) {
    window.activePlaylistFolderIndex = idx;
    window.persistActivePlaylistFolder();
    window.renderLibraryFolders();
    window.updateLibraryPreview();
  };

  window.updateLibraryPreview = function () {
    const pv = document.getElementById("library-preview");
    if (!pv) return;
    const lbl = window.t ? window.t("libraryPreview") : "Tracks:";
    const folder = window.PLAYLIST_LIBRARY[window.activePlaylistFolderIndex] || { tracks: [] };
    const info = analyzeFolder(folder);
    const previewTracks = window.getSourceTracks
      ? window.getSourceTracks(window.activePlaylistFolderIndex)
      : folder.tracks || [];
    const lines =
      lbl +
      "\n" +
      "formats: " +
      info.formats +
      " | playable: " +
      info.playable +
      "/" +
      folder.tracks.length +
      " | m3u refs: " +
      info.m3uRefs +
      " | source refs: " +
      info.sourceRefs +
      "\n\n" +
      previewTracks
        .map(function (t) {
          return "• " + t.name + " [" + guessFormat(t.file).toLowerCase() + "]";
        })
        .join("\n");
    pv.textContent = lines;
  };

  function analyzeFolder(entry) {
    const tr = (entry && entry.tracks) || [];
    const formatCounter = {};
    let playable = 0;
    let m3uRefs = 0;
    let sourceRefs = 0;
    tr.forEach(function (t) {
      const ext = guessFormat(t.file).toLowerCase();
      formatCounter[ext] = (formatCounter[ext] || 0) + 1;
      if (SUPPORTED_PLAYABLE_EXT.includes(ext)) playable += 1;
      if (ext === "m3u" || ext === "m3u8") m3uRefs += 1;
      if (ext === "sources" || ext === "source") sourceRefs += 1;
    });
    const formats = Object.keys(formatCounter)
      .sort()
      .map(function (ext) {
        return ext + ":" + formatCounter[ext];
      })
      .join(", ");
    return {
      formats: formats || "none",
      playable: playable,
      m3uRefs: m3uRefs,
      sourceRefs: sourceRefs,
    };
  }

  function updateSongMeta(t) {
    const setText = function (id, val) {
      const n = document.getElementById(id);
      if (n) n.textContent = val;
    };
    setText("meta-title", t.name || "—");
    setText("meta-artist", t.artist || "—");
    setText("meta-file", isScTrack(t) ? t.permalink || t.file || "—" : "~/" + (t.file || ""));
    const durSec = trackDurationSeconds(t);
    if (durSec > 0) setText("meta-duration", fmt(durSec));
    else {
      const audio = getAudio();
      setText("meta-duration", fmt((audio && audio.duration) || 0));
    }
    const scLink = document.getElementById("meta-soundcloud");
    if (scLink) {
      if (t.permalink) {
        scLink.innerHTML = '<a href="' + escapeHtml(t.permalink) + '" target="_blank" rel="noopener">' + escapeHtml(t.permalink) + "</a>";
      } else scLink.textContent = "—";
    }
    setText("meta-format", isScTrack(t) ? "SOUNDCLOUD" : guessFormat(t.file));
    setText("meta-emoji", t.emoji || "—");
    setText("meta-folder", window.getActiveFolderLabel());
  }

  function guessFormat(file) {
    const m = String(file || "").match(/\.(\w+)$/);
    return m ? m[1].toUpperCase() : "—";
  }

  function restoreWindowPosition(win) {
    if (!win) return;
    win.style.position = "absolute";
    win.style.bottom = "";
    win.style.top = "";
    if (window.WindowGrid && window.WindowGrid.isEnabled() && typeof window.WindowGrid.applyAllLayouts === "function") {
      window.WindowGrid.applyAllLayouts();
    }
  }

  window.showWin = function (id, tbId) {
    const win = document.getElementById(id);
    if (!win) return;
    const isHidden = win.style.display === "none";
    const isMin = win.classList.contains("minimized");
    if (isHidden) {
      win.style.display = "";
      if (isMin) restoreWindowPosition(win);
      win.classList.remove("minimized");
    } else if (isMin) {
      win.classList.remove("minimized");
      restoreWindowPosition(win);
    } else {
      win.style.display = "none";
    }
    syncWinState(id);
  };

  window.toggleWin = function (id) {
    const win = document.getElementById(id);
    if (!win) return;
    const nextHidden = win.style.display === "";
    win.style.display = nextHidden ? "none" : "";
    if (!nextHidden && win.classList.contains("minimized")) {
      win.classList.remove("minimized");
      restoreWindowPosition(win);
    }
    syncWinState(id);
  };

  window.minimizeWin = function (id) {
    const w = document.getElementById(id);
    if (!w) return;
    const willMinimize = !w.classList.contains("minimized");
    w.classList.toggle("minimized");
    if (willMinimize) {
      w.style.position = "fixed";
      w.style.bottom = "4px";
      w.style.top = "";
      w.style.height = "";
      w.style.zIndex = "1001";
    } else {
      restoreWindowPosition(w);
    }
    syncWinState(id);
  };

  window.expandWin = function (id) {
    if (id === "paint-win" || id === "calc-win" || id === "calendar-win" || id === "autoclick-win") return;
    if (window.WindowGrid && window.WindowGrid.isEnabled()) return;
    const win = document.getElementById(id);
    const phone = document.body.classList.contains("device-phone");
    const tablet = document.body.classList.contains("device-tablet");
    const gutter = phone || tablet ? 0 : 72;
    if (win.dataset.expanded === "1") {
      win.style.cssText = "";
      win.dataset.expanded = "";
      win.removeAttribute("data-expanded");
    } else {
      win.style.cssText =
        "position:fixed;top:36px;left:" +
        gutter +
        "px;right:0;bottom:0;z-index:500;border-radius:0;margin:0;width:auto;";
      win.dataset.expanded = "1";
      win.setAttribute("data-expanded", "1");
    }
    syncWinState(id);
  };

  function syncWinState(id) {
    const win = document.getElementById(id);
    const map = WIN_MAP[id];
    if (!win || !map) return;
    const visible = win.style.display !== "none";
    const notMin = !win.classList.contains("minimized");
    const tb = map.tb && document.getElementById(map.tb);
    if (tb) tb.classList.toggle("tb-active", visible);
    const di = map.di && document.getElementById(map.di);
    if (di) di.classList.toggle("win-open", visible && notMin);
    const dk = map.dock && document.getElementById(map.dock);
    if (dk) dk.classList.toggle("dock-open", visible && notMin);
  }

  window.syncWinState = syncWinState;

  window.focusWin = function (id) {
    const win = document.getElementById(id);
    if (!win) return;
    win.style.display = "";
    win.classList.remove("minimized");
    syncWinState(id);
  };

  window.setTheme = function (t, el) {
    if (window.OsTheme) {
      window.OsTheme.set(t === "white" ? "white" : "dark", el);
      return;
    }
    const theme = t === "white" ? "white" : "";
    if (theme) document.documentElement.setAttribute("data-theme", "white");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("lofi-theme", theme);
    } catch {
      /**/
    }
    document.querySelectorAll(".theme-btn").forEach(function (b) {
      b.classList.remove("active");
    });
    if (el) el.classList.add("active");
  };

  window.updateClock = function () {
    const now = new Date();
    const el = document.getElementById("clock");
    if (!el) return;
    el.textContent =
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0") +
      ":" +
      String(now.getSeconds()).padStart(2, "0");
  };

  function initEQ() {
    const container = document.getElementById("meta-eq");
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < 28; i++) {
      const bar = document.createElement("div");
      bar.className = "eq-bar";
      bar.style.height = "4px";
      bar.style.opacity = "0.35";
      container.appendChild(bar);
    }
    animateEQ();
  }

  function animateEQ() {
    const bars = document.querySelectorAll("#meta-eq .eq-bar");
    if (!bars.length) return;
    if (!isPlaying) {
      bars.forEach(function (b) {
        b.style.height = "4px";
        b.style.opacity = "0.25";
      });
      requestAnimationFrame(function () {
        setTimeout(function () {
          animateEQ();
        }, 220);
      });
      return;
    }
    bars.forEach(function (b) {
      const h = 6 + Math.random() * 30;
      b.style.height = h + "px";
      b.style.opacity = String(0.45 + Math.random() * 0.55);
    });
    requestAnimationFrame(function () {
      setTimeout(function () {
        animateEQ();
      }, 110);
    });
  }

  window.initRain = function () {
    const canvas = document.getElementById("rain");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);
    const drops = Array.from({ length: 80 }, function () {
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: 1 + Math.random() * 2,
        length: 8 + Math.random() * 16,
        opacity: 0.1 + Math.random() * 0.3,
      };
    });

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const theme = document.documentElement.getAttribute("data-theme");
      drops.forEach(function (d) {
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 1, d.y + d.length);
        ctx.strokeStyle =
          theme === "white" ? "rgba(100,80,0," + d.opacity + ")" : "rgba(255,214,0," + d.opacity + ")";
        ctx.lineWidth = 0.8;
        ctx.stroke();
        d.y += d.speed;
        if (d.y > canvas.height) {
          d.y = -d.length;
          d.x = Math.random() * canvas.width;
        }
      });
      requestAnimationFrame(draw);
    }

    draw();
  };

  window.sendMsg = function () {
    alert(window.t ? window.t("contactMsg") : "hello@example.com");
  };

  /** ---- Settings & device ------------------------------------------------ */
  window.readStoredDevice = function () {
    try {
      return localStorage.getItem("lofi-device") || "auto";
    } catch {
      return "auto";
    }
  };

  window.storeDeviceMode = function (mode) {
    try {
      localStorage.setItem("lofi-device", mode);
    } catch {
      /**/
    }
  };

  function detectAutoDevice() {
    const w = window.innerWidth;
    const coarse = window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(hover: none)").matches;
    if (coarse && w <= 540) return "phone";
    if (w <= 900) return "tablet";
    return "pc";
  }

  window.applyDeviceClasses = function () {
    const saved = window.readStoredDevice();
    let resolved;
    if (saved === "auto") resolved = detectAutoDevice();
    else if (["pc", "tablet", "phone"].includes(saved)) resolved = saved;
    else resolved = "pc";

    document.body.classList.toggle("device-auto", saved === "auto");

    document.body.classList.remove("device-pc", "device-tablet", "device-phone", "tablet-show-sidebar");
    document.body.classList.add("device-" + resolved);

    const allowSwitcher = resolved === "phone";
    document.body.classList.toggle("mobile-switcher-available", !!allowSwitcher);

    if (window.WindowGrid) window.WindowGrid.syncDeviceMode();

    if (resolved !== "phone") closeAppSwitcher(false);
    const hint = document.getElementById("swipe-hint");
    if (hint && window.t) hint.textContent = window.t("tapHint");

    MAIN_WIN_IDS.forEach(function (wid) {
      syncWinState(wid);
    });
  };

  window.onDeviceSettingChange = function (sel) {
    window.storeDeviceMode(sel.value);
    window.applyDeviceClasses();
    if (typeof window.paintResize === "function") window.paintResize();
  };

  window.onLangChange = function (sel) {
    window.setLang(sel.value);
    window.applyI18nDom();
    window.renderLibraryFolders();
    const shuf = document.getElementById("shuffle-list-btn");
    if (shuf && window.t) shuf.textContent = window.t("playlistShuffle");
    const lbl = document.getElementById("switcher-label");
    if (lbl && window.t) lbl.textContent = window.t("switcherTitle");
    paintRefreshI18n();
  };

  function bindSettingsForm() {
    const langSel = document.getElementById("setting-lang");
    const devSel = document.getElementById("setting-device");
    if (langSel) {
      langSel.value = window.currentLang || "uk";
      langSel.onchange = function () {
        window.onLangChange(langSel);
      };
    }
    if (devSel) {
      devSel.value = window.readStoredDevice();
      devSel.onchange = function () {
        window.onDeviceSettingChange(devSel);
      };
    }
    document.body.classList.toggle("no-os-cursor", window.matchMedia("(pointer: fine)").matches === false);
  }

  /** ---- Hidden menu ------------------------------------------------------ */
  window.toggleHiddenMenu = function (ev) {
    if (ev) ev.stopPropagation();
    const dd = document.getElementById("hidden-dropdown");
    if (!dd) return;
    dd.classList.toggle("open");
    setTimeout(function () {
      if (!dd.classList.contains("open")) return;
      function close(ev2) {
        if (!dd.contains(ev2.target) && ev2.target.id !== "hidden-menu-btn") {
          dd.classList.remove("open");
          document.removeEventListener("mousedown", close, true);
        }
      }
      document.addEventListener("mousedown", close, true);
    }, 0);
  };

  window.openHiddenApp = function (id, ev) {
    if (ev) ev.stopPropagation();
    const dd = document.getElementById("hidden-dropdown");
    if (dd) dd.classList.remove("open");
    window.focusWin(id);
  };

  /** ---- App switcher (phone) -------------------------------------------- */
  let pullStart = null;

  function closeAppSwitcher(animated) {
    const bd = document.getElementById("app-switch-backdrop");
    if (!bd) return;
    if (!animated) {
      bd.classList.remove("open");
      document.body.dataset.switcherDragging = "";
      return;
    }
    bd.classList.remove("open");
  }

  window.closeAppSwitcher = function () {
    closeAppSwitcher(true);
  };

  function refreshSwitcherList() {
    const list = document.getElementById("switch-card-list");
    if (!list) return;
    list.innerHTML = "";
    const label = window.t ? window.t("swipeUpClose") : "swipe up";
    MAIN_WIN_IDS.forEach(function (wid) {
      const win = document.getElementById(wid);
      if (!win || win.style.display === "none") return;
      const card = document.createElement("div");
      card.className = "switch-card";
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.flexDirection = "column";
      row.style.gap = "4px";
      row.style.flex = "1";
      const titleEl = win.querySelector(".win-title");
      const tt = document.createElement("span");
      tt.textContent = (titleEl && titleEl.textContent) || wid;
      const hint = document.createElement("small");
      hint.style.color = "#888";
      hint.textContent = label;
      row.appendChild(tt);
      row.appendChild(hint);
      card.appendChild(row);
      attachSwipeClose(card, wid);
      list.appendChild(card);
    });
  }

  window.openAppSwitcher = function () {
    const bd = document.getElementById("app-switch-backdrop");
    if (!bd || !document.body.classList.contains("mobile-switcher-available")) return;
    refreshSwitcherList();
    bd.classList.add("open");
  };

  function attachSwipeClose(card, winId) {
    let sy = 0,
      sx = 0;
    card.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches[0]) return;
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        card.classList.add("dragging");
      },
      { passive: true },
    );

    card.addEventListener(
      "touchend",
      function (e) {
        card.classList.remove("dragging");
        const ch = e.changedTouches && e.changedTouches[0];
        if (!ch) return;
        const dy = sy - ch.clientY;
        if (dy > 48) window.toggleWin(winId);
      },
      { passive: true },
    );
  }

  function bindEdgePull() {
    const edge = document.getElementById("edge-pull-zone");
    if (!edge) return;
    edge.addEventListener(
      "touchstart",
      function (e) {
        pullStart = e.touches[0].clientY;
      },
      { passive: true },
    );
    edge.addEventListener(
      "touchend",
      function (e) {
        if (pullStart == null || !e.changedTouches[0]) return;
        const dy = e.changedTouches[0].clientY - pullStart;
        pullStart = null;
        if (dy > 36) window.openAppSwitcher();
      },
      { passive: true },
    );

    edge.addEventListener(
      "mousedown",
      function (e) {
        pullStart = e.clientY;
      },
      { passive: true },
    );

    edge.addEventListener(
      "mouseup",
      function (e) {
        if (pullStart == null) return;
        const dy = e.clientY - pullStart;
        pullStart = null;
        if (dy > 36) window.openAppSwitcher();
      },
      { passive: true },
    );
  }

  /** ---- Calculator ------------------------------------------------------- */
  let calcBuf = "";

  window.calcTap = function (v) {
    const d = document.getElementById("calc-display");
    if (v === "C") {
      calcBuf = "";
    } else if (v === "⌫") {
      calcBuf = calcBuf.slice(0, -1);
    } else if (v === "=") {
      try {
        const safe = calcBuf.replace(/[^0-9+\-*/.()%\s]/g, "");
        // eslint-disable-next-line no-new-func
        const result = Function('"use strict"; return (' + safe + ");")();
        calcBuf = String(Math.round(result * 100000000) / 100000000);
      } catch {
        calcBuf = "err";
      }
    } else {
      calcBuf += v;
    }
    d.textContent = calcBuf || "0";
  };

  /** ---- Calendar --------------------------------------------------------- */
  let viewDate = new Date();

  window.calPrev = function () {
    viewDate.setMonth(viewDate.getMonth() - 1);
    window.renderCalendar();
  };

  window.calNext = function () {
    viewDate.setMonth(viewDate.getMonth() + 1);
    window.renderCalendar();
  };

  window.renderCalendar = function () {
    const titleEl = document.getElementById("calendar-title");
    const gridEl = document.getElementById("calendar-grid");
    if (!gridEl || !titleEl) return;
    titleEl.textContent =
      viewDate.toLocaleString(undefined, {
        month: "long",
        year: "numeric",
      }) + "";
    gridEl.innerHTML = "";
    const dow = ["S", "M", "T", "W", "T", "F", "S"];
    dow.forEach(function (day) {
      const c = document.createElement("div");
      c.className = "cal-dow";
      c.textContent = day;
      gridEl.appendChild(c);
    });
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const js = start.getDay();
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();

    let count = js;
    for (let k = 0; k < count; k++) {
      const filler = document.createElement("div");
      filler.className = "cal-cell muted";
      gridEl.appendChild(filler);
    }
    const today = new Date();

    function addDay(dayNum) {
      const cd = document.createElement("div");
      cd.textContent = String(dayNum);
      cd.className = "cal-cell";
      const isToday =
        today.getFullYear() === viewDate.getFullYear() &&
        today.getMonth() === viewDate.getMonth() &&
        today.getDate() === dayNum;
      if (isToday) cd.classList.add("today");
      gridEl.appendChild(cd);
    }

    for (let d = 1; d <= daysInMonth; d++) addDay(d);
  };

  /** ---- Paint ------------------------------------------------------------ */
  const paintState = {
    composite: null,
    layers: [],
    active: 0,
    tool: "brush",
    drawing: false,
    color: "#FFD600",
    size: 3,
    w: 1024,
    h: 1024,
  };

  const PALETTE = ["#FFD600", "#ffffff", "#000000", "#ff5f57", "#007aff", "#28c840"];

  window.paintResize = function () {
    redrawComposite();
  };

  function redrawComposite() {
    if (!paintState.composite) return;
    const cx = paintState.composite.getContext("2d");
    cx.clearRect(0, 0, paintState.w, paintState.h);
    paintState.layers.forEach(function (L) {
      if (L.visible) cx.drawImage(L.canvas, 0, 0);
    });
  }

  function ensurePaint() {
    const host = document.getElementById("paint-stack");
    if (!host || paintState.composite) return;
    paintState.composite = document.createElement("canvas");
    paintState.composite.width = paintState.w;
    paintState.composite.height = paintState.h;
    paintState.composite.style.width = paintState.w + "px";
    paintState.composite.style.height = paintState.h + "px";
    paintState.composite.style.display = "block";
    host.innerHTML = "";
    host.style.display = "inline-block";
    host.appendChild(paintState.composite);

    paintState.layers = [];
    addPaintSurface(window.t ? window.t("paintLayer") + " 1" : "layer 1");
    rebuildPaintLayersUi();
    bindPaintInteractions(paintState.composite);
    redrawComposite();
    renderSwatches();
  }

  function addPaintSurface(name) {
    const c = document.createElement("canvas");
    c.width = paintState.w;
    c.height = paintState.h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, paintState.w, paintState.h);
    paintState.layers.push({ name: name || "layer", canvas: c, ctx: ctx, visible: true });
    paintState.active = paintState.layers.length - 1;
  }

  function renderSwatches() {
    const el = document.getElementById("paint-swatches");
    if (!el) return;
    el.innerHTML = "";
    PALETTE.forEach(function (col) {
      const s = document.createElement("div");
      s.className = "swatch" + (col === paintState.color ? " pick" : "");
      s.style.background = col;
      s.onclick = function () {
        paintState.tool = "brush";
        paintState.color = col;
        paintToolSync();
        renderSwatches();
      };
      el.appendChild(s);
    });
  }

  function rebuildPaintLayersUi() {
    const col = document.getElementById("paint-layers");
    if (!col) return;
    col.innerHTML = "";
    paintState.layers.forEach(function (L, i) {
      const row = document.createElement("div");
      row.className = "paint-layer-row" + (i === paintState.active ? " active" : "");
      const eye = document.createElement("input");
      eye.type = "checkbox";
      eye.checked = L.visible;
      eye.addEventListener("click", function (ev) {
        ev.stopPropagation();
      });
      eye.onchange = function () {
        L.visible = eye.checked;
        redrawComposite();
      };
      const lab = document.createElement("span");
      lab.style.flex = "1";
      lab.textContent = (i === paintState.active ? "▶ " : "") + L.name;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "paint-layer-del";
      del.textContent = "×";
      del.onclick = function (ev) {
        ev.stopPropagation();
        if (paintState.layers.length <= 1) return;
        paintState.layers.splice(i, 1);
        if (paintState.active >= paintState.layers.length) paintState.active = paintState.layers.length - 1;
        rebuildPaintLayersUi();
        redrawComposite();
      };
      lab.ondblclick = function (ev) {
        ev.stopPropagation();
        const next = window.prompt("Layer name", L.name);
        if (next && next.trim()) {
          L.name = next.trim();
          rebuildPaintLayersUi();
        }
      };
      row.onclick = function () {
        paintState.active = i;
        rebuildPaintLayersUi();
      };
      row.appendChild(eye);
      row.appendChild(lab);
      row.appendChild(del);
      col.appendChild(row);
    });
  }

  window.paintAddLayer = function () {
    const baseName = window.t ? window.t("paintLayer") : "Layer";
    const nextIndex = paintState.layers.length + 1;
    const c = document.createElement("canvas");
    c.width = paintState.w;
    c.height = paintState.h;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, paintState.w, paintState.h);
    paintState.layers.splice(paintState.active + 1, 0, {
      name: baseName + " " + nextIndex,
      canvas: c,
      ctx: ctx,
      visible: true,
    });
    paintState.active++;
    rebuildPaintLayersUi();
    redrawComposite();
  };

  window.paintClearActive = function () {
    const L = paintState.layers[paintState.active];
    if (!L) return;
    L.ctx.clearRect(0, 0, paintState.w, paintState.h);
    redrawComposite();
  };

  window.paintPickTool = function (tool) {
    paintState.tool = tool;
    paintToolSync();
  };

  window.paintPickSize = function (v) {
    paintState.size = parseFloat(v) || 1;
    const preview = document.getElementById("paint-size-preview");
    if (preview) {
      const px = Math.max(4, Math.round(paintState.size * 2));
      preview.style.width = px + "px";
      preview.style.height = px + "px";
    }
  };

  function paintToolSync() {
    const tb = document.getElementById("paint-brush-tool");
    const te = document.getElementById("paint-erase-tool");
    if (tb) tb.classList.toggle("pick", paintState.tool === "brush");
    if (te) te.classList.toggle("pick", paintState.tool === "erase");
    const clr = document.getElementById("paint-color-input");
    if (clr) clr.value = paintState.color;
    const sz = document.getElementById("paint-size");
    if (sz) sz.value = String(paintState.size);
  }

  window.paintColorInput = function (el) {
    paintState.color = el.value;
    paintState.tool = "brush";
    paintToolSync();
    renderSwatches();
  };

  function bindPaintInteractions(disp) {
    function coords(ev) {
      const r = disp.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function activeCtx() {
      const layer = paintState.layers[paintState.active];
      return layer ? layer.ctx : null;
    }

    function strokeBetween(pa, pb) {
      const ctx = activeCtx();
      if (!ctx) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = paintState.size;
      if (paintState.tool === "erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = paintState.color;
      }
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      redrawComposite();
    }

    let lastPt = null;
    disp.style.touchAction = "none";
    disp.style.cursor = "crosshair";

    disp.addEventListener(
      "pointerdown",
      function (ev) {
        ev.preventDefault();
        disp.setPointerCapture && disp.setPointerCapture(ev.pointerId);
        paintState.drawing = true;
        lastPt = coords(ev);
        const ctx = activeCtx();
        if (ctx) {
          if (!paintState.layers[paintState.active].visible) {
            paintState.layers[paintState.active].visible = true;
            rebuildPaintLayersUi();
          }
          // Draw one point on tap, otherwise single click doesn't paint.
          strokeBetween(lastPt, lastPt);
        }
      },
      { passive: false },
    );

    disp.addEventListener(
      "pointermove",
      function (ev) {
        if (!paintState.drawing) return;
        const p = coords(ev);
        strokeBetween(lastPt || p, p);
        lastPt = p;
      },
      { passive: true },
    );

    disp.addEventListener(
      "pointerup",
      function () {
        paintState.drawing = false;
        lastPt = null;
      },
      { passive: true },
    );
    disp.addEventListener(
      "pointerleave",
      function () {
        paintState.drawing = false;
      },
      { passive: true },
    );
    disp.addEventListener(
      "pointercancel",
      function () {
        paintState.drawing = false;
        lastPt = null;
      },
      { passive: true },
    );
  }

  function flattenPaintCanvas() {
    const c = document.createElement("canvas");
    c.width = paintState.w;
    c.height = paintState.h;
    const cx = c.getContext("2d");
    paintState.layers.forEach(function (L) {
      if (L.visible) cx.drawImage(L.canvas, 0, 0);
    });
    return c;
  }

  window.paintMergeAll = function () {
    const flat = flattenPaintCanvas();
    const ctx = flat.getContext("2d");
    paintState.layers = [
      {
        name: window.t ? window.t("paintLayer") + " merged" : "merged",
        canvas: flat,
        ctx: ctx,
        visible: true,
      },
    ];
    paintState.active = 0;
    paintState.composite = flat;
    const host = document.getElementById("paint-stack");
    if (host) {
      host.innerHTML = "";
      host.appendChild(flat);
      bindPaintInteractions(flat);
    }
    rebuildPaintLayersUi();
    redrawComposite();
  };

  window.paintExportPng = function () {
    const link = document.createElement("a");
    link.download = "drawing.png";
    link.href = flattenPaintCanvas().toDataURL("image/png");
    link.click();
  };

  function paintRefreshI18n() {
    const bBrush = document.getElementById("paint-brush-label");
    const bEr = document.getElementById("paint-erase-label");
    const bClear = document.getElementById("paint-clear-btn");
    const bAdd = document.getElementById("paint-add-layer");
    const cz = document.getElementById("paint-color-label");
    const sz = document.getElementById("paint-size-label");
    if (bBrush && window.t) bBrush.textContent = window.t("paintBrush");
    if (bEr && window.t) bEr.textContent = window.t("paintEraser");
    if (bClear && window.t) bClear.textContent = window.t("paintClear");
    if (bAdd && window.t) bAdd.textContent = window.t("paintAddLayer");
    if (bClear && window.t) bClear.textContent = window.t("paintClear");
    const mergeBtn = document.querySelector('[onclick="paintMergeAll()"]');
    if (mergeBtn && window.t) mergeBtn.textContent = window.t("paintMerge");
    const exportBtn = document.querySelector('[onclick="paintExportPng()"]');
    if (exportBtn && window.t) exportBtn.textContent = window.t("paintExport");
    if (bBrush && window.t) bBrush.textContent = "✏ " + window.t("paintBrush");
    if (bEr && window.t) bEr.textContent = "◻ " + window.t("paintEraser");
    paintPickSize(paintState.size);
  }

  function initBioAvatarFallback() {
    const fallback =
      "data:image/svg+xml," +
      encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72'><rect width='72' height='72' rx='8' fill='%23FFD600'/><text x='50%' y='55%' text-anchor='middle' font-size='32' fill='%231a1a1a'>?</text></svg>",
      );
    document.querySelectorAll(".bio-avatar-img").forEach(function (img) {
      img.onerror = function () {
        this.onerror = null;
        this.src = fallback;
      };
    });
  }

  function formatLanyardStatus(status) {
    if (!status) return "Unavailable";
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function updateLanyardStatusElement(userId, payload) {
    const statusElement = document.getElementById("lanyard-status-" + userId);
    if (!statusElement) return;

    if (!payload || !payload.discord_status) {
      statusElement.textContent = "Status: unavailable";
      return;
    }

    const presence = formatLanyardStatus(payload.discord_status);
    let activityText = "";
    if (Array.isArray(payload.activities) && payload.activities.length > 0) {
      const activity = payload.activities[0];
      if (activity && activity.name) {
        activityText = " — " + activity.name;
      }
    }

    statusElement.textContent = "Status: " + presence + activityText;
  }

  async function fetchLanyardProfiles() {
    const ids = ["892429048771399680", "837064341315911741"];

    await Promise.all(
      ids.map(async function (id) {
        try {
          const response = await fetch("https://api.lanyard.rest/v1/users/" + id);
          if (!response.ok) {
            updateLanyardStatusElement(id, null);
            return;
          }
          const result = await response.json();
          if (!result || !result.data) {
            updateLanyardStatusElement(id, null);
            return;
          }
          updateLanyardStatusElement(id, result.data);
        } catch (error) {
          updateLanyardStatusElement(id, null);
        }
      }),
    );
  }

  function initPoyoPet() {
    const btn = document.getElementById("poyo-pet-btn");
    const img = document.getElementById("poyo-pet-img");
    if (!btn || !img) return;
    let idleSrc = null;
    let activeSrcList = [];
    let restoreTimer = null;
    const idleCandidate = window.POYO_PET_IDLE || "img/poyo.pet/open_e.png";
    const activeCandidates = Array.isArray(window.POYO_PET_ACTIVE)
      ? window.POYO_PET_ACTIVE
      : ["img/poyo.pet/idle_animation_1.gif", "img/poyo.pet/idle_animation_2.gif"];

    probeImage(idleCandidate).then(function (path) {
      idleSrc = path || getFallbackCoverDataUri();
      img.src = idleSrc;
    });

    Promise.all(
      activeCandidates.map(function (p) {
        return probeImage(p);
      }),
    ).then(function (arr) {
      activeSrcList = arr.filter(Boolean);
    });

    btn.addEventListener("click", function () {
      if (!document.body.classList.contains("device-pc")) return;
      btn.classList.remove("bounce");
      window.requestAnimationFrame(function () {
        btn.classList.add("bounce");
      });
      window.setTimeout(function () {
        btn.classList.remove("bounce");
      }, 700);

      if (restoreTimer) {
        window.clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      if (activeSrcList.length) {
        const pick = activeSrcList[Math.floor(Math.random() * activeSrcList.length)];
        img.src = pick;
        restoreTimer = window.setTimeout(function () {
          if (idleSrc) img.src = idleSrc;
        }, 3600);
      }
    });
  }

  /** ---- Clicker game ----------------------------------------------------- */
  const CLICKER_KEY = "lofi-cheese-score";

  function loadClickerScore() {
    try {
      return parseInt(localStorage.getItem(CLICKER_KEY) || "0", 10) || 0;
    } catch {
      return 0;
    }
  }

  function saveClickerScore(score) {
    try {
      localStorage.setItem(CLICKER_KEY, String(score));
    } catch {
      /**/
    }
  }

  function syncClickerUi(score) {
    const count = document.getElementById("ac-count");
    const badge = document.getElementById("ac-status");
    if (count) count.textContent = String(score);
    if (badge) badge.textContent = "SAVED";
  }

  window.clickerTap = function () {
    const next = loadClickerScore() + 1;
    saveClickerScore(next);
    syncClickerUi(next);
  };

  window.clickerReset = function () {
    saveClickerScore(0);
    syncClickerUi(0);
  };

  window.resetWindowLayout = function () {
    if (window.WindowGrid) window.WindowGrid.resetToDefault();
  };

  /** ---- Initialization --------------------------------------------------- */
  window.bootstrapLofiOs = async function () {
    await initPlayerSource();
    rebuildOrder();
    window.renderPlaylist();
    window.renderLibraryFolders();
    loadTrack(0, false);

    MAIN_WIN_IDS.forEach(function (id) {
      window.syncWinState(id);
    });
    initEQ();
    window.initRain();
    initPoyoPet();
    initBioAvatarFallback();

    window.applyI18nDom();
    bindSettingsForm();

    bindEdgePull();

    calcBuf = "";

    window.updateClock();
    setInterval(window.updateClock, 1000);

    window.setVol(70);

    window.applyDeviceClasses();
    syncClickerUi(loadClickerScore());

    window.addEventListener("resize", window.applyDeviceClasses);

    window.addEventListener(
      "lofi-lang",
      function () {
        window.applyI18nDom();
      },
      false,
    );

    document.addEventListener("click", closeHiddenOutside, false);
    if (window.WindowGrid) window.WindowGrid.init();
  };

  function closeHiddenOutside(ev) {
    const dd = document.getElementById("hidden-dropdown");
    const btn = document.getElementById("hidden-menu-btn");
    if (!dd || !dd.classList.contains("open")) return;
    if (dd.contains(ev.target)) return;
    if (btn && btn.contains(ev.target)) return;
    dd.classList.remove("open");
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      const savedTheme = localStorage.getItem("lofi-theme");
      if (savedTheme === "white") document.documentElement.setAttribute("data-theme", "white");
    } catch {
      /**/
    }
    ensurePaint();
    window.bootstrapLofiOs();
    fetchLanyardProfiles();
    setInterval(fetchLanyardProfiles, 60000);
    window.renderCalendar();
    paintRefreshI18n();
    paintToolSync();
  });
})();
