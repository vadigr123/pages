(function () {
  "use strict";

  const state = {
    active: false,
    ready: false,
    failed: false,
    widget: null,
    sounds: [],
    shuffledOrder: [],
    currentUrl: "",
    widgetReady: false,
    initPromise: null,
    readyHandler: null,
    errorHandler: null,
    unlocked: false,
    unlockPromise: null,
    iframeLoaded: false,
  };

  function isSecurePage() {
    const p = window.location.protocol;
    return p === "http:" || p === "https:";
  }

  function encodePlaylistUrl(url) {
    return encodeURIComponent(String(url || "").trim());
  }

  function buildIframeSrc(url) {
    return (
      "https://w.soundcloud.com/player/?url=" +
      encodePlaylistUrl(url) +
      "&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false&color=ffd600"
    );
  }

  function resolveSoundTitle(sound, index, fallbackName) {
    if (fallbackName && String(fallbackName).trim()) return String(fallbackName).trim();
    const i = typeof index === "number" ? index : 0;
    if (!sound) return "Track " + (i + 1);
    const fields = [sound.title, sound.label, sound.full_title, sound.name, sound.caption];
    let title = "";
    for (let f = 0; f < fields.length; f++) {
      if (fields[f] && String(fields[f]).trim()) {
        title = String(fields[f]).trim();
        break;
      }
    }
    if (!title && sound.permalink_url) {
      try {
        const slug = String(sound.permalink_url).split("/").pop() || "";
        title = decodeURIComponent(slug).replace(/-/g, " ");
      } catch {
        title = String(sound.permalink_url).split("/").pop() || "";
      }
    }
    return title || "Track " + (i + 1);
  }

  function mapSounds(sounds, playlistUrl) {
    const plUrl = String(playlistUrl || state.currentUrl || "").trim();
    return (sounds || []).map(function (s, i) {
      const art = s.artwork_url || "";
      const cover = art ? art.replace("-large", "-t500x500") : "";
      const name = resolveSoundTitle(s, i);
      return {
        file: s.permalink_url || "",
        name: name,
        artist: (s.user && s.user.username) || "SoundCloud",
        emoji: "🎵",
        cover: cover,
        scIndex: i,
        scPlaylistUrl: plUrl,
        duration: s.duration || 0,
        durationMs: s.duration || 0,
        permalink: s.permalink_url || "",
      };
    });
  }

  function rebuildShuffleOrder() {
    state.shuffledOrder = state.sounds.map(function (_, i) {
      return i;
    });
    for (let i = state.shuffledOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = state.shuffledOrder[i];
      state.shuffledOrder[i] = state.shuffledOrder[j];
      state.shuffledOrder[j] = tmp;
    }
  }

  function waitForScApi() {
    return new Promise(function (resolve, reject) {
      if (window.SC && window.SC.Widget) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-sc-widget="1"]');
      if (existing) {
        existing.addEventListener("load", function () {
          resolve();
        });
        existing.addEventListener("error", reject);
        return;
      }
      const s = document.createElement("script");
      s.src = "https://w.soundcloud.com/player/api.js";
      s.dataset.scWidget = "1";
      s.onload = function () {
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function bindWidgetReady(widget, resolve) {
    if (state.widgetReady) return;
    state.widgetReady = true;

    widget.getSounds(function (sounds) {
      state.sounds = mapSounds(sounds, state.currentUrl);
      rebuildShuffleOrder();
      state.ready = state.sounds.length > 0;
      if (!state.ready) state.failed = true;
      resolve(state.ready);
    });
  }

  function waitForUserGesture() {
    if (state.unlocked) return Promise.resolve();
    if (state.unlockPromise) return state.unlockPromise;

    state.unlockPromise = new Promise(function (resolve) {
      function unlock() {
        if (state.unlocked) return;
        state.unlocked = true;
        document.removeEventListener("pointerdown", unlock, true);
        document.removeEventListener("keydown", unlock, true);
        resolve();
      }
      document.addEventListener("pointerdown", unlock, { capture: true, once: true });
      document.addEventListener("keydown", unlock, { capture: true, once: true });
    });

    return state.unlockPromise;
  }

  function loadIframe(iframe, url, forceReload) {
    const nextSrc = buildIframeSrc(url);
    const same =
      !forceReload &&
      state.iframeLoaded &&
      iframe.src &&
      iframe.src.indexOf("soundcloud.com") > -1 &&
      state.currentUrl === url;
    if (same) return Promise.resolve();
    iframe.src = nextSrc;
    state.iframeLoaded = true;
    state.widgetReady = false;
    return Promise.resolve();
  }

  function withWidget(fn) {
    if (!state.widget || !state.ready || state.failed) return;
    try {
      fn(state.widget);
    } catch {
      /**/
    }
  }

  window.SoundCloudPlayer = {
    isActive: function () {
      return state.active && state.ready && !state.failed && isSecurePage();
    },
    canEmbed: isSecurePage,
    resolveTitle: resolveSoundTitle,
    unlock: waitForUserGesture,
    getSounds: function () {
      return state.sounds.slice();
    },
    getShuffledOrder: function () {
      return state.shuffledOrder.slice();
    },
    reshuffle: function () {
      rebuildShuffleOrder();
    },
    getCurrentPlaylistUrl: function () {
      return state.currentUrl;
    },
    fetchPlaylist: function (playlistUrl) {
      return window.SoundCloudPlayer.init(playlistUrl, { force: true }).then(function (ok) {
        if (!ok) return [];
        return window.SoundCloudPlayer.getSounds().map(function (t) {
          return Object.assign({}, t, { scPlaylistUrl: String(playlistUrl || "").trim() });
        });
      });
    },
    ensurePlaylist: function (playlistUrl) {
      const url = String(playlistUrl || "").trim();
      if (!url) return Promise.resolve(false);
      if (state.currentUrl === url && state.ready && state.widget) {
        return Promise.resolve(true);
      }
      return window.SoundCloudPlayer.init(url, { force: true });
    },
    init: function (playlistUrl, options) {
      const url = String(playlistUrl || "").trim();
      const opts = options || {};
      if (!url || !isSecurePage()) return Promise.resolve(false);

      const iframe = document.getElementById("sc-widget");
      if (!iframe) return Promise.resolve(false);

      if (!opts.force && state.currentUrl === url && state.ready && state.widget) {
        return Promise.resolve(true);
      }

      if (state.initPromise && state.currentUrl === url && !opts.force) {
        return state.initPromise;
      }

      state.active = true;
      state.failed = false;
      state.ready = false;
      state.widgetReady = false;
      state.currentUrl = url;
      state.widget = null;
      state.sounds = [];
      state.initPromise = null;

      state.initPromise = waitForUserGesture()
        .then(function () {
          return loadIframe(iframe, url, !!opts.force);
        })
        .then(function () {
          return waitForScApi();
        })
        .then(function () {
          return new Promise(function (resolve) {
            let widget;
            try {
              widget = window.SC.Widget(iframe);
            } catch {
              state.failed = true;
              resolve(false);
              return;
            }
            state.widget = widget;
            const SC = window.SC;

            if (state.readyHandler && widget.unbind) {
              try {
                widget.unbind(SC.Widget.Events.READY, state.readyHandler);
              } catch {
                /**/
              }
            }
            if (state.errorHandler && widget.unbind) {
              try {
                widget.unbind(SC.Widget.Events.ERROR, state.errorHandler);
              } catch {
                /**/
              }
            }

            state.readyHandler = function () {
              bindWidgetReady(widget, resolve);
            };
            state.errorHandler = function () {
              state.failed = true;
              resolve(false);
            };

            widget.bind(SC.Widget.Events.READY, state.readyHandler);
            widget.bind(SC.Widget.Events.ERROR, state.errorHandler);
          });
        })
        .catch(function () {
          state.failed = true;
          return false;
        })
        .finally(function () {
          state.initPromise = null;
        });

      return state.initPromise;
    },
    widget: function () {
      return state.widget;
    },
    play: function () {
      withWidget(function (w) {
        w.play();
      });
    },
    pause: function () {
      withWidget(function (w) {
        w.pause();
      });
    },
    toggle: function () {
      withWidget(function (w) {
        w.isPaused(function (paused) {
          if (paused) w.play();
          else w.pause();
        });
      });
    },
    next: function () {
      withWidget(function (w) {
        w.next();
      });
    },
    prev: function () {
      withWidget(function (w) {
        w.prev();
      });
    },
    skip: function (index) {
      withWidget(function (w) {
        w.skip(index);
      });
    },
    setVolume: function (pct) {
      withWidget(function (w) {
        w.setVolume(Math.max(0, Math.min(100, pct)));
      });
    },
    seekTo: function (ms) {
      withWidget(function (w) {
        w.seekTo(ms);
      });
    },
    getPosition: function (cb) {
      withWidget(function (w) {
        w.getPosition(cb);
      });
    },
    getDuration: function (cb) {
      withWidget(function (w) {
        w.getDuration(cb);
      });
    },
    getCurrentSoundIndex: function (cb) {
      withWidget(function (w) {
        w.getCurrentSoundIndex(cb);
      });
    },
    getCurrentSound: function (cb) {
      withWidget(function (w) {
        w.getCurrentSound(cb);
      });
    },
    bind: function (event, cb) {
      if (!state.widget || !state.ready) return;
      try {
        state.widget.bind(event, cb);
      } catch {
        /**/
      }
    },
  };
})();
