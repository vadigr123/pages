(function () {
  "use strict";

  const GRID_COLS = 10;
  const GRID_ROWS = 7;
  const STORAGE_KEY = "lofi-win-grid-v1";
  const GRID_WINDOW_IDS = [
    "player-win",
    "library-win",
    "bio-win",
    "playlist-win",
    "vibe-win",
    "settings-win",
  ];

  const DEFAULT_LAYOUT = {
    "player-win": { col: 0, row: 0, colSpan: 3, rowSpan: 2 },
    "library-win": { col: 0, row: 2, colSpan: 3, rowSpan: 2 },
    "bio-win": { col: 3, row: 0, colSpan: 3, rowSpan: 2 },
    "playlist-win": { col: 3, row: 2, colSpan: 3, rowSpan: 2 },
    "vibe-win": { col: 6, row: 0, colSpan: 2, rowSpan: 2 },
    "settings-win": { col: 6, row: 2, colSpan: 2, rowSpan: 2 },
  };

  let layout = {};
  let metrics = { cellW: 1, cellH: 1, originX: 0, originY: 0, width: 0, height: 0 };
  let enabled = false;
  let zTop = 100;

  function cloneLayout(src) {
    const out = {};
    Object.keys(src).forEach(function (id) {
      const r = src[id];
      out[id] = { col: r.col, row: r.row, colSpan: r.colSpan, rowSpan: r.rowSpan };
    });
    return out;
  }

  function isDesktopGrid() {
    return document.body.classList.contains("device-pc");
  }

  function loadLayout() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          layout = cloneLayout(DEFAULT_LAYOUT);
          GRID_WINDOW_IDS.forEach(function (id) {
            if (parsed[id]) {
              layout[id] = normalizeRect(parsed[id]);
            }
          });
          return;
        }
      }
    } catch {
      /**/
    }
    layout = cloneLayout(DEFAULT_LAYOUT);
  }

  function saveLayout() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /**/
    }
  }

  function normalizeRect(r) {
    const col = Math.max(0, Math.min(GRID_COLS - 1, parseInt(r.col, 10) || 0));
    const row = Math.max(0, Math.min(GRID_ROWS - 1, parseInt(r.row, 10) || 0));
    let colSpan = Math.max(1, parseInt(r.colSpan, 10) || 1);
    let rowSpan = Math.max(1, parseInt(r.rowSpan, 10) || 1);
    colSpan = Math.min(colSpan, GRID_COLS - col);
    rowSpan = Math.min(rowSpan, GRID_ROWS - row);
    return { col: col, row: row, colSpan: colSpan, rowSpan: rowSpan };
  }

  function getStage() {
    return document.getElementById("desktop-grid-stage");
  }

  function getOverlay() {
    return document.getElementById("desktop-grid-overlay");
  }

  function computeMetrics() {
    const stage = getStage();
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    metrics.originX = rect.left;
    metrics.originY = rect.top;
    metrics.width = rect.width;
    metrics.height = rect.height;
    metrics.cellW = rect.width / GRID_COLS;
    metrics.cellH = rect.height / GRID_ROWS;
  }

  function rectCells(rect) {
    const cells = [];
    for (let r = rect.row; r < rect.row + rect.rowSpan; r++) {
      for (let c = rect.col; c < rect.col + rect.colSpan; c++) {
        cells.push(c + "," + r);
      }
    }
    return cells;
  }

  function occupies(id, rect, ignoreId) {
    const mine = new Set(rectCells(rect));
    for (let i = 0; i < GRID_WINDOW_IDS.length; i++) {
      const otherId = GRID_WINDOW_IDS[i];
      if (otherId === id || otherId === ignoreId) continue;
      const other = layout[otherId];
      if (!other) continue;
      const cells = rectCells(other);
      for (let j = 0; j < cells.length; j++) {
        if (mine.has(cells[j])) return true;
      }
    }
    return false;
  }

  function canPlace(id, rect, ignoreId) {
    const norm = normalizeRect(rect);
    if (norm.col + norm.colSpan > GRID_COLS) return false;
    if (norm.row + norm.rowSpan > GRID_ROWS) return false;
    return !occupies(id, norm, ignoreId);
  }

  function applyWindowRect(win, rect) {
    const left = rect.col * metrics.cellW;
    const top = rect.row * metrics.cellH;
    const width = rect.colSpan * metrics.cellW - 8;
    const height = rect.rowSpan * metrics.cellH - 8;
    if (win.classList.contains("minimized")) {
      const titlebar = win.querySelector(".win-titlebar");
      const barHeight = titlebar ? titlebar.getBoundingClientRect().height : 34;
      win.style.left = left + 4 + "px";
      win.style.top = Math.max(4, metrics.height - barHeight - 4) + "px";
      win.style.width = Math.max(120, width) + "px";
      win.style.height = Math.max(barHeight, 34) + "px";
      return;
    }
    win.style.left = left + 4 + "px";
    win.style.top = top + 4 + "px";
    win.style.width = Math.max(120, width) + "px";
    win.style.height = Math.max(80, height) + "px";
  }

  function applyAllLayouts() {
    if (!enabled) return;
    computeMetrics();
    GRID_WINDOW_IDS.forEach(function (id) {
      const win = document.getElementById(id);
      const rect = layout[id];
      if (!win || !rect) return;
      applyWindowRect(win, rect);
    });
    drawOverlay();
  }

  function drawOverlay() {
    const overlay = getOverlay();
    if (!overlay || !enabled) return;
    computeMetrics();
    overlay.innerHTML = "";
    overlay.style.setProperty("--grid-cols", String(GRID_COLS));
    overlay.style.setProperty("--grid-rows", String(GRID_ROWS));
    for (let c = 1; c < GRID_COLS; c++) {
      const line = document.createElement("div");
      line.className = "grid-line grid-line-v";
      line.style.left = (c * metrics.cellW) + "px";
      overlay.appendChild(line);
    }
    for (let r = 1; r < GRID_ROWS; r++) {
      const line = document.createElement("div");
      line.className = "grid-line grid-line-h";
      line.style.top = (r * metrics.cellH) + "px";
      overlay.appendChild(line);
    }
  }

  function pixelToCell(x, y) {
    const col = Math.floor((x - metrics.originX) / metrics.cellW);
    const row = Math.floor((y - metrics.originY) / metrics.cellH);
    return {
      col: Math.max(0, Math.min(GRID_COLS - 1, col)),
      row: Math.max(0, Math.min(GRID_ROWS - 1, row)),
    };
  }

  function ensureResizeHandles(win) {
    if (win.querySelector(".win-grid-resize-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "win-grid-resize-wrap";
    ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach(function (dir) {
      const h = document.createElement("div");
      h.className = "win-resize-handle win-resize-" + dir;
      h.dataset.resize = dir;
      wrap.appendChild(h);
    });
    win.appendChild(wrap);
  }

  function bindResize(win, id) {
    const wrap = win.querySelector(".win-grid-resize-wrap");
    if (!wrap) return;
    wrap.querySelectorAll(".win-resize-handle").forEach(function (handle) {
      handle.addEventListener("mousedown", function (e) {
        if (!enabled) return;
        e.preventDefault();
        e.stopPropagation();
        const dir = handle.dataset.resize;
        const start = cloneLayout(layout)[id];
        const startX = e.clientX;
        const startY = e.clientY;

        function onMove(ev) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          const dCol = Math.round(dx / metrics.cellW);
          const dRow = Math.round(dy / metrics.cellH);
          let next = {
            col: start.col,
            row: start.row,
            colSpan: start.colSpan,
            rowSpan: start.rowSpan,
          };

          if (dir.indexOf("e") >= 0) next.colSpan = Math.max(1, start.colSpan + dCol);
          if (dir.indexOf("w") >= 0) {
            next.col = Math.max(0, start.col + dCol);
            next.colSpan = Math.max(1, start.colSpan - dCol);
          }
          if (dir.indexOf("s") >= 0) next.rowSpan = Math.max(1, start.rowSpan + dRow);
          if (dir.indexOf("n") >= 0) {
            next.row = Math.max(0, start.row + dRow);
            next.rowSpan = Math.max(1, start.rowSpan - dRow);
          }

          next = normalizeRect(next);
          if (canPlace(id, next, id)) {
            layout[id] = next;
            applyWindowRect(win, next);
            drawOverlay();
          }
        }

        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          saveLayout();
        }

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }

  function bindDrag(win, id) {
    const titlebar = win.querySelector(".win-titlebar");
    if (!titlebar) return;
    titlebar.addEventListener("mousedown", function (e) {
      if (!enabled || e.button !== 0) return;
      if (e.target.closest(".win-controls, .win-btn, button, a, input, select, label")) return;
      e.preventDefault();
      zTop += 1;
      win.style.zIndex = String(zTop);
      titlebar.style.cursor = "grabbing";

      const startRect = cloneLayout(layout)[id];
      const offsetCol = pixelToCell(e.clientX, e.clientY);
      const grabCol = offsetCol.col - startRect.col;
      const grabRow = offsetCol.row - startRect.row;

      function onMove(ev) {
        const cell = pixelToCell(ev.clientX, ev.clientY);
        const next = normalizeRect({
          col: cell.col - grabCol,
          row: cell.row - grabRow,
          colSpan: startRect.colSpan,
          rowSpan: startRect.rowSpan,
        });
        if (canPlace(id, next, id)) {
          layout[id] = next;
          applyWindowRect(win, next);
        }
      }

      function onUp() {
        titlebar.style.cursor = "grab";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveLayout();
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    loadLayout();
    const stage = getStage();
    if (stage) stage.classList.add("grid-active");
    const overlay = getOverlay();
    if (overlay) overlay.classList.add("visible");

    GRID_WINDOW_IDS.forEach(function (id) {
      const win = document.getElementById(id);
      if (!win) return;
      win.classList.add("win-grid-managed");
      win.dataset.expanded = "";
      win.removeAttribute("data-expanded");
      win.style.position = "absolute";
      win.style.margin = "0";
      ensureResizeHandles(win);
      bindResize(win, id);
      bindDrag(win, id);
    });

    applyAllLayouts();
    window.addEventListener("resize", onResize);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    window.removeEventListener("resize", onResize);
    const stage = getStage();
    if (stage) stage.classList.remove("grid-active");
    const overlay = getOverlay();
    if (overlay) {
      overlay.classList.remove("visible");
      overlay.innerHTML = "";
    }

    GRID_WINDOW_IDS.forEach(function (id) {
      const win = document.getElementById(id);
      if (!win) return;
      win.classList.remove("win-grid-managed");
      win.style.cssText = "";
      const wrap = win.querySelector(".win-grid-resize-wrap");
      if (wrap) wrap.remove();
    });
  }

  function onResize() {
    if (enabled) applyAllLayouts();
  }

  function syncDeviceMode() {
    if (isDesktopGrid()) enable();
    else disable();
  }

  function resetToDefault() {
    layout = cloneLayout(DEFAULT_LAYOUT);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /**/
    }
    GRID_WINDOW_IDS.forEach(function (id) {
      const win = document.getElementById(id);
      if (win) {
        win.style.cssText = "";
        win.dataset.expanded = "";
        win.removeAttribute("data-expanded");
        win.classList.remove("minimized");
      }
    });
    if (enabled) {
      applyAllLayouts();
    } else {
      syncDeviceMode();
    }
    if (typeof window.syncWinState === "function") {
      GRID_WINDOW_IDS.forEach(function (id) {
        window.syncWinState(id);
      });
    }
  }

  window.WindowGrid = {
    init: function () {
      loadLayout();
      syncDeviceMode();
    },
    syncDeviceMode: syncDeviceMode,
    resetToDefault: resetToDefault,
    applyAllLayouts: applyAllLayouts,
    isEnabled: function () {
      return enabled;
    },
  };
})();
