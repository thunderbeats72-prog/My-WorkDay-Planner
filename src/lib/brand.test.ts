import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARK } from './brandGeometry';

/**
 * The logo is the one asset that ships in several forms at once: an inline SVG
 * in the app chrome, a standalone `icon.svg`, PNGs for the OS, and an .ico for
 * the tab. They drifted once already — the sidebar drew a 177° arc while the
 * tab icon drew 233° — so the shared geometry is asserted here.
 */

// `import.meta.url` is rewritten by the bundler under jsdom; resolve from the
// project root instead, which vitest sets to the package directory.
const publicPath = (file: string) => resolve(process.cwd(), 'public', file);
const read = (path: string) => readFileSync(publicPath(path), 'utf8');

describe('brand mark', () => {
  it('derives a 233° arc from the ring radius', () => {
    const circumference = 2 * Math.PI * MARK.radius;
    const degrees = (MARK.dash / circumference) * 360;
    // Rounded to whole units for a crisp SVG; allow for that rounding.
    expect(degrees).toBeGreaterThan(232);
    expect(degrees).toBeLessThan(234);
  });

  it('is identical in the component and in icon.svg', () => {
    const icon = read('icon.svg');
    expect(icon).toContain(`stroke-dasharray="${MARK.dash} ${MARK.gap}"`);
    expect(icon).toContain(`r="${MARK.radius}"`);
    expect(icon).toContain(`stroke-width="${MARK.stroke}"`);
    expect(icon).toContain(`cy="${MARK.pinY}"`);
    expect(icon).toContain(`r="${MARK.pinRadius}"`);
    // The tile is near-black, never the retired navy.
    expect(icon).not.toMatch(/#1E3A6B|#132542|#7FA8FF|url\(#/i);
    expect(icon.toUpperCase()).toContain('#0B0B0D');
  });

  it('declares no gradient, glow or spark — the mark is flat', () => {
    const icon = read('icon.svg');
    expect(icon).not.toContain('<linearGradient');
    expect(icon).not.toContain('<radialGradient');
    expect(icon).not.toContain('<filter');
  });

  it('ships every icon a browser or OS can ask for', () => {
    for (const file of [
      'favicon.ico',
      'favicon-16.png',
      'favicon-32.png',
      'favicon-48.png',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-512.png',
      'og-image.png',
    ]) {
      const bytes = readFileSync(publicPath(file));
      expect(bytes.byteLength, `${file} should not be empty`).toBeGreaterThan(200);
    }
  });

  it('keeps the .ico a real multi-size icon container', () => {
    const ico = readFileSync(publicPath('favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(3); // 16, 32 and 48
  });

  it('points the manifest at the current icon generation', () => {
    const manifest = JSON.parse(read('manifest.webmanifest')) as {
      icons: Array<{ src: string; purpose?: string }>;
      theme_color: string;
    };
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    // A generation query defeats the launcher's copy of an older icon.
    for (const icon of manifest.icons) expect(icon.src).toMatch(/\?v=\d+$/);
    expect(manifest.theme_color.toLowerCase()).toBe('#0a0a0c');
  });
});

describe('brand cache refresh', () => {
  it('uses the same fresh generation for browser, installed app and notifications', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const generation = config.match(/const ASSET_GENERATION = '(\d+)'/)?.[1];
    expect(generation).toBeDefined();
    expect(config).toContain('png|svg|ico');
    const manifest = JSON.parse(read('manifest.webmanifest')) as {
      icons: Array<{ src: string }>;
      shortcuts: Array<{ icons: Array<{ src: string }> }>;
    };
    for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap((shortcut) => shortcut.icons)]) {
      expect(icon.src).toMatch(new RegExp(`\\?v=${generation}$`));
    }
    const worker = read('sw.js');
    for (const path of ['/icon-192.png', '/favicon-32.png']) {
      expect(worker).toContain(`${path}?v=${generation}`);
      expect(readFileSync(resolve(process.cwd(), 'src/lib/notifications.ts'), 'utf8')).toContain(`${path}?v=${generation}`);
    }
  });
});
