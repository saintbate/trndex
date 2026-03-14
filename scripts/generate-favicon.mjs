#!/usr/bin/env node
/**
 * Generate favicon.ico and apple-icon.png from Trndex brand (dark bg, green X).
 * Run: node scripts/generate-favicon.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import toIco from "to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, "..", "app");
const publicDir = path.join(__dirname, "..", "public");

const svg = `
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="16" fill="#07070C"/>
  <rect x="1.5" y="1.5" width="61" height="61" rx="14.5" stroke="rgba(255,255,255,0.08)"/>
  <path d="M20 18L44 46" stroke="#00E676" stroke-width="8" stroke-linecap="round"/>
  <path d="M44 18L20 46" stroke="#00E676" stroke-width="8" stroke-linecap="round"/>
</svg>
`.trim();

async function main() {
  const png32 = await sharp(Buffer.from(svg))
    .resize(32, 32)
    .png()
    .toBuffer();

  const png180 = await sharp(Buffer.from(svg))
    .resize(180, 180)
    .png()
    .toBuffer();

  const ico = await toIco([png32]);

  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "favicon.ico"), ico);
  fs.writeFileSync(path.join(appDir, "apple-icon.png"), png180);

  console.log("Generated app/favicon.ico and app/apple-icon.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
