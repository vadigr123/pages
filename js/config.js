/**
 * Кілька "папок" плейлистів: додай власні .mp3 у відповідні підкаталоги репозиторію.
 * На GitHub Pages шляхи відносні до кореня сайту (наприклад music/playlist/...).
 * Для обкладинки конкретного треку можна додати поле: cover: "img/thumbnail.player/your-cover.jpg"
 */
(function () {
  window.PLAYER_THUMBNAILS = [
    "img/thumbnail.player/pose_5.png",
    "img/thumbnail.player/pose_4.png",
    "img/thumbnail.player/pose_3.png",
    "img/thumbnail.player/pose_2.png",
    "img/thumbnail.player/pose_1.png",
  ];

  window.POYO_PET_IDLE = "img/poyo.pet/open_e.png";
  window.POYO_PET_ACTIVE = ["img/poyo.pet/idle_animation_1.gif", "img/poyo.pet/idle_animation_2.gif"];

  // Library is populated by runtime folder analysis in js/app.js.
  window.PLAYLIST_LIBRARY = [];

  /**
   * Fallback folders for local mode when the browser/server cannot list music/ root.
   */
  window.MUSIC_PLAYLIST_FOLDERS = ["dreamcore"];
  window.MUSIC_MANIFEST_PATH = "music/library.json";

  /**
   * SoundCloud playlist URL(s). String or array — all playlists merge into one player list.
   * @example
   * window.SOUNDCLOUD_PLAYLIST_URLS = [
   *   "https://soundcloud.com/user/sets/playlist-a",
   *   "https://soundcloud.com/user/sets/playlist-b",
   * ];
   */
  window.SOUNDCLOUD_PLAYLIST_URL = "https://soundcloud.com/ellybean-800904304/sets/dreamcore-weirdcore-playlist";

  window.getSoundCloudPlaylistUrls = function () {
    const raw = window.SOUNDCLOUD_PLAYLIST_URLS != null ? window.SOUNDCLOUD_PLAYLIST_URLS : window.SOUNDCLOUD_PLAYLIST_URL;
    if (Array.isArray(raw)) {
      return raw
        .map(function (u) {
          return String(u || "").trim();
        })
        .filter(Boolean);
    }
    const one = String(raw || "").trim();
    return one ? [one] : [];
  };

  function readActiveIndex() {
    try {
      const v = parseInt(localStorage.getItem("lofi-pl-folder"), 10);
      if (Number.isFinite(v) && v >= 0 && v < window.PLAYLIST_LIBRARY.length) return v;
    } catch {
      /**/
    }
    return 0;
  }

  window.activePlaylistFolderIndex = readActiveIndex();

  window.persistActivePlaylistFolder = function () {
    try {
      localStorage.setItem("lofi-pl-folder", String(window.activePlaylistFolderIndex));
    } catch {
      /**/
    }
  };

  /** All tracks from every source (playlist.m3u unified view). */
  window.getUnifiedTracks = function () {
    const lib = Array.isArray(window.PLAYLIST_LIBRARY) ? window.PLAYLIST_LIBRARY : [];
    const out = [];
    lib.forEach(function (entry) {
      const folder = (entry && entry.folder) || "~/music/";
      (entry && entry.tracks ? entry.tracks : []).forEach(function (track) {
        out.push(
          Object.assign({}, track, {
            sourceFolder: track.sourceFolder || folder,
          }),
        );
      });
    });
    return out;
  };

  /** Tracks for the currently highlighted source folder (library preview). */
  window.getSourceTracks = function (folderIndex) {
    const idx =
      typeof folderIndex === "number" && folderIndex >= 0 ? folderIndex : window.activePlaylistFolderIndex;
    const lib = window.PLAYLIST_LIBRARY[idx];
    return (lib && lib.tracks) || [];
  };

  window.getActiveTracks = function () {
    return window.getUnifiedTracks();
  };

  window.getActiveFolderLabel = function () {
    const lib = window.PLAYLIST_LIBRARY;
    if (!lib || !lib.length) return "~/music/";
    const idx = window.activePlaylistFolderIndex;
    if (idx >= 0 && idx < lib.length && lib[idx]) {
      return lib[idx].folder;
    }
    return "~/music/all/";
  };

  window.getUnifiedFolderLabel = function () {
    const n = window.getUnifiedTracks().length;
    return "~/playlist.m3u (" + n + " tracks)";
  };
})();
