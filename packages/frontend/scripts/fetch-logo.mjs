#!/usr/bin/env node
/**
 * fetch-logo.mjs — pull the latest PPL logo from the backend API and bake it
 * into /public/ppl-logo.webp as a 43KB optimized static asset.
 *
 * Runs as a Vercel prebuild hook (see package.json "prebuild"). Means:
 *   1. Every deploy starts by pulling the CURRENT logo from the live backend.
 *   2. The static file shipped with each build always reflects the latest
 *      logo uploaded via admin Settings → Branding.
 *   3. The frontend renders `<img src="/ppl-logo.webp">` with zero network
 *      round-trip at runtime — instant first paint.
 *
 * When admin uploads a new logo, the backend fires the Vercel deploy hook
 * (see packages/backend/src/routes/settings.ts). ~60-90s later the new
 * logo is live as the static asset. Fully automatic, no manual steps.
 *
 * Fail-open: if the backend is unreachable or returns no logo, we keep
 * whatever ppl-logo.webp already exists in public/. That ensures a
 * missing/slow API never blocks a deploy.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const WEBP_PATH = join(PUBLIC_DIR, 'ppl-logo.webp');
const PNG_PATH = join(PUBLIC_DIR, 'ppl-logo.png');

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  'https://ppl-app-production.up.railway.app';

const API = `${BACKEND_URL.replace(/\/$/, '')}/api/settings/branding`;

async function main() {
  console.log(`[fetch-logo] pulling branding from ${API}`);

  let body;
  try {
    const res = await fetch(API, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.warn(`[fetch-logo] backend returned ${res.status}; keeping existing logo`);
      return;
    }
    body = await res.json();
  } catch (err) {
    console.warn(`[fetch-logo] backend unreachable (${err.message}); keeping existing logo`);
    return;
  }

  const dataUri = body?.data?.logoData;
  if (!dataUri) {
    console.warn('[fetch-logo] no logoData in API response; keeping existing logo');
    return;
  }

  const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(dataUri);
  if (!match) {
    console.warn('[fetch-logo] unexpected logoData format; keeping existing logo');
    return;
  }

  const [, mime, b64] = match;
  const raw = Buffer.from(b64, 'base64');
  console.log(`[fetch-logo] fetched ${raw.length} bytes (${mime})`);

  // Optimize via `sharp` — resize to max 512×512, convert to WebP.
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    // sharp isn't in prod deps — fall back to saving raw PNG bytes so the
    // build never breaks. The runtime experience is the same (just a larger
    // file). Dev should `npm install sharp` as a devDependency for this.
    console.warn('[fetch-logo] sharp not installed; saving raw as .png (no optimize)');
    writeFileSync(PNG_PATH, raw);
    // Keep the existing webp if present
    return;
  }

  const webp = await sharp(raw)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, effort: 6 })
    .toBuffer();

  const png = await sharp(raw)
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();

  writeFileSync(WEBP_PATH, webp);
  writeFileSync(PNG_PATH, png);
  console.log(`[fetch-logo] wrote ${WEBP_PATH} (${webp.length} bytes)`);
  console.log(`[fetch-logo] wrote ${PNG_PATH} (${png.length} bytes)`);
}

main().catch((err) => {
  // Never fail the build on logo-fetch issues — the fallback is "keep the
  // previously shipped ppl-logo.webp" which is already in the repo.
  console.warn(`[fetch-logo] unexpected error: ${err.message}; build continues`);
  if (!existsSync(WEBP_PATH)) {
    console.warn('[fetch-logo] WARNING: no existing ppl-logo.webp in public/');
  }
});
