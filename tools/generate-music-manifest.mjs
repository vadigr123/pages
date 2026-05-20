import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MUSIC_DIR = path.join(ROOT, "music");
const OUT_FILE = path.join(MUSIC_DIR, "library.json");
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".opus", ".aac", ".m4a", ".mp4", ".webm", ".flac"]);
const REF_EXT = new Set([".m3u", ".m3u8", ".sources"]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function titleFromFolder(folderName) {
  return String(folderName || "playlist")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function readRefList(absFile, relFolder) {
  try {
    const raw = fs.readFileSync(absFile, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        if (/^[a-z]+:\/\//i.test(line)) return line;
        if (line.startsWith("/")) return line.slice(1);
        return toPosix(path.join(relFolder, line.replace(/^\.\/+/, "")));
      });
  } catch {
    return [];
  }
}

function createTrack(filePath, artist) {
  const base = path.basename(filePath).replace(/\.[^.]+$/, "");
  return {
    file: toPosix(filePath),
    name: base.replace(/[_-]+/g, " ").trim() || "Unknown Track",
    artist,
    emoji: "🎵",
  };
}

function generate() {
  if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
  }

  const dirents = fs
    .readdirSync(MUSIC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const playlists = [];

  for (const dirent of dirents) {
    const folderName = dirent.name;
    const absFolder = path.join(MUSIC_DIR, folderName);
    const relFolder = toPosix(path.join("music", folderName));
    const artist = titleFromFolder(folderName);
    const tracks = [];

    const files = fs
      .readdirSync(absFolder, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));

    for (const fileName of files) {
      const absFile = path.join(absFolder, fileName);
      const relFile = toPosix(path.join(relFolder, fileName));
      const ext = path.extname(fileName).toLowerCase();
      if (AUDIO_EXT.has(ext)) {
        tracks.push(createTrack(relFile, artist));
        continue;
      }
      if (REF_EXT.has(ext)) {
        const refs = readRefList(absFile, relFolder);
        for (const ref of refs) {
          const refExt = path.extname(ref).toLowerCase();
          if (!AUDIO_EXT.has(refExt)) continue;
          tracks.push(createTrack(ref, artist));
        }
      }
    }

    if (tracks.length) {
      playlists.push({
        folder: `${relFolder}/`,
        tracks,
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    playlists,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(`Generated ${toPosix(path.relative(ROOT, OUT_FILE))} with ${playlists.length} playlist(s).`);
}

generate();
