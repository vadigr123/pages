(function () {
  "use strict";

  function readTheme() {
    try {
      return localStorage.getItem("lofi-theme") || "";
    } catch {
      return "";
    }
  }

  function storeTheme(t) {
    try {
      localStorage.setItem("lofi-theme", t);
    } catch {
      /**/
    }
  }

  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "white") {
      root.setAttribute("data-theme", "white");
    } else {
      root.removeAttribute("data-theme");
    }
    document.body.removeAttribute("data-theme");
    document.querySelectorAll(".os-theme-btn, .theme-btn").forEach(function (btn) {
      const isDark = btn.classList.contains("dark");
      const isWhite = btn.classList.contains("white");
      btn.classList.remove("active");
      if ((t === "white" && isWhite) || (t !== "white" && isDark)) btn.classList.add("active");
    });
  }

  window.OsTheme = {
    init: function () {
      applyTheme(readTheme());
    },
    set: function (t, el) {
      const theme = t === "white" ? "white" : "dark";
      storeTheme(theme === "white" ? "white" : "");
      applyTheme(theme);
      if (el && el.parentElement) {
        el.parentElement.querySelectorAll(".os-theme-btn, .theme-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        el.classList.add("active");
      }
    },
    apply: applyTheme,
    read: readTheme,
  };

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(readTheme());
  });
})();
