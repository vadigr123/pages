import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const m = html.match(/<style>([\s\S]*?)<\/style>/);
if (!m) {
  console.warn("[extract-css] No inline <style> in index.html — skipped (edit css/app.css manually).");
  process.exit(0);
}
const extPath = path.join(root, "css", "app-ext.css");
let css = m[1];
if (fs.existsSync(extPath)) css += "\n\n" + fs.readFileSync(extPath, "utf8");
fs.mkdirSync(path.join(root, "css"), { recursive: true });
fs.writeFileSync(path.join(root, "css", "app.css"), css.trimStart(), "utf8");
console.log("written css/app.css bytes", Buffer.byteLength(css));
