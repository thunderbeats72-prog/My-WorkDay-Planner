/**
 * Regenerates every shipped brand asset from `src/lib/brandGeometry.ts`.
 *
 *   pnpm brand:icons
 *
 * Requires Playwright's Chromium (`npx playwright install chromium`) or the
 * CHROMIUM_PATH environment variable. The script is deliberately dependency
 * light: it renders the same SVG math the app renders, so the tab icon, the
 * installed app icon and the sidebar mark are provably one logo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public');

// Kept in sync with src/lib/brandGeometry.ts by src/lib/brand.test.ts.
const MARK = { size: 512, radius: 132, stroke: 30, arcDegrees: 233, pinRadius: 17, pinStroke: 9, tile: '#0B0B0D' };
const CIRC = 2 * Math.PI * MARK.radius;
const DASH = Math.round((MARK.arcDegrees / 360) * CIRC);
const GAP = Math.round(CIRC);

function mark({ rounded = true, maskable = false, stroke = MARK.stroke, small = false } = {}) {
  const size = MARK.size;
  const r = maskable ? 118 : MARK.radius;
  const scale = r / MARK.radius;
  const sw = maskable ? 26 : stroke;
  const dash = Math.round((MARK.arcDegrees / 360) * 2 * Math.PI * r);
  const gap = Math.round(2 * Math.PI * r);
  const pinR = Math.round(MARK.pinRadius * scale * (small ? 1.06 : 1));
  const pinStroke = Math.round(MARK.pinStroke * scale * (small ? 1.25 : 1));
  const trackOpacity = small ? 0.22 : 0.16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect width="${size}" height="${size}"${rounded ? ' rx="112"' : ''} fill="${MARK.tile}"/>
  ${rounded ? `<rect x="3" y="3" width="${size - 6}" height="${size - 6}" rx="109" fill="none" stroke="#FFFFFF" stroke-opacity="0.1" stroke-width="6"/>` : ''}
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="${trackOpacity}" stroke-width="${sw}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${dash} ${gap}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  <circle cx="${size / 2}" cy="${size / 2 - r}" r="${pinR}" fill="${MARK.tile}" stroke="#FFFFFF" stroke-width="${pinStroke}"/>
</svg>`;
}

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core').catch(() => {
  throw new Error('playwright-core is not installed. Run: npm i -D playwright-core && npx playwright install chromium');
});

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shot(svg, size, name) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:${MARK.tile}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  await page.screenshot({ path: resolve(OUT, name), clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name, `${size}px`);
}

await shot(mark(), 512, 'icon-512.png');
await shot(mark(), 192, 'icon-192.png');
await shot(mark(), 180, 'apple-touch-icon.png');
await shot(mark({ rounded: false, maskable: true }), 512, 'icon-maskable-512.png');
await shot(mark({ stroke: 52, small: true }), 32, 'favicon-32.png');
await shot(mark({ stroke: 60, small: true }), 16, 'favicon-16.png');
await shot(mark({ stroke: 42, small: true }), 48, 'favicon-48.png');

// Multi-size .ico (PNG payloads, supported everywhere that matters).
const entries = [16, 32, 48].map((size) => ({ size, data: readFileSync(resolve(OUT, `favicon-${size}.png`)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16;
const dir = [];
for (const { size, data } of entries) {
  const d = Buffer.alloc(16);
  d.writeUInt8(size, 0);
  d.writeUInt8(size, 1);
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(data.length, 8);
  d.writeUInt32LE(offset, 12);
  dir.push(d);
  offset += data.length;
}
writeFileSync(resolve(OUT, 'favicon.ico'), Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]));
console.log('wrote favicon.ico (16, 32, 48)');

const vector = mark()
  .replace(` width="${MARK.size}" height="${MARK.size}"`, '')
  .replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="My Workday Planner"');
writeFileSync(resolve(OUT, 'icon.svg'), vector.trim().replace(/\n\s+/g, '\n  ') + '\n');
console.log('wrote icon.svg');

await browser.close();
console.log('\nDash', DASH, 'of', GAP, '- bump ASSET_GENERATION in vite.config.ts after regenerating.');
