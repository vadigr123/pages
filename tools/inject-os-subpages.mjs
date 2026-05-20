import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const headInject = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link href="https://fonts.googleapis.com/css2?family=VT323&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">',
  '<link rel="stylesheet" href="../../css/os-shared.css">',
].join("\n");

function taskbar(title) {
  return [
    '<div class="os-taskbar">',
    '  <a class="os-taskbar-logo" href="../../index.html">~/lofi.os</a>',
    '  <span class="os-taskbar-sep">|</span>',
    `  <span class="os-taskbar-title">${title}</span>`,
    '  <span class="os-taskbar-spacer"></span>',
    '  <div class="os-theme-btns">',
    '    <div class="os-theme-btn dark active" title="dark" onclick="OsTheme.set(\'dark\',this)"></div>',
    '    <div class="os-theme-btn white" title="light" onclick="OsTheme.set(\'white\',this)"></div>',
    "  </div>",
    "</div>",
    '<script defer src="../../js/os-theme.js"></script>',
  ].join("\n");
}

function patch(fileRel, title, bodyClass) {
  const file = path.join(root, fileRel);
  let html = fs.readFileSync(file, "utf8");
  if (!html.includes("os-shared.css")) {
    html = html.replace("</head>", headInject + "\n</head>");
  }
  if (!html.includes("os-taskbar")) {
    html = html.replace(/<body([^>]*)>/i, (m) => {
      const attrs = m[1] || "";
      if (attrs.includes("class=")) {
        return `<body${attrs.replace(/class="([^"]*)"/, `class="$1 ${bodyClass}"`)}>${taskbar(title)}`;
      }
      return `<body${attrs} class="${bodyClass}">${taskbar(title)}`;
    });
  }
  html = html.replace(/<\/motion>/g, "</div>").replace(/<motion\b/g, "<motion").replace(/<motion /g, "<div ");
  fs.writeFileSync(file, html, "utf8");
  console.log("patched", fileRel);
}

patch("pages/Metadata/metamouse.html", "metamouse.app", "lofi-os-page");
patch("pages/e621-main/index.html", "e621.tags", "lofi-os-page");
patch("pages/ideas-board-main/index.html", "ideas.board", "lofi-os-page");
