/**
 * Cloudinary integration (#P11 / PREMIUM_AUDIT).
 *
 * Two responsibilities:
 *   1. Sign upload params so the FRONTEND can upload directly to
 *      Cloudinary without the secret ever touching the browser.
 *   2. Verify Cloudinary's webhook callback so we trust the resulting
 *      avatarUrl before we save it on the User row.
 *
 * Env vars (Railway):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * If any of the three is missing, the integration logs a warning and
 * upload endpoints return 503 — clean degradation rather than a confusing
 * 500. Frontend hides the avatar uploader when /api/avatar/health says
 * cloudinary isn't configured.
 *
 * Why signed direct upload (vs proxying through our backend)?
 *   - Avoids a 5-10MB image roundtripping through Railway's egress.
 *   - Cloudinary's `eager` transformations crop + thumbnail at upload
 *     time — we get a square 256x256 + a 64x64 sidebar variant for free.
 *   - The signature is short-lived (1h) and tied to upload params
 *     (folder, public_id, transformation), so a leaked signature can't
 *     be replayed against a different filename.
 */

import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

let configured = false;
let cachedConfig: CloudinaryConfig | null = null;

function getConfig(): CloudinaryConfig | null {
  if (cachedConfig) return cachedConfig;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return null;
  cachedConfig = { cloudName, apiKey, apiSecret };
  return cachedConfig;
}

function ensureConfigured(): CloudinaryConfig | null {
  const cfg = getConfig();
  if (!cfg) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[cloudinary] CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET missing — avatar uploads disabled'
      );
    }
    return null;
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: cfg.cloudName,
      api_key: cfg.apiKey,
      api_secret: cfg.apiSecret,
      secure: true,
    });
    configured = true;
  }
  return cfg;
}

export function isCloudinaryReady(): boolean {
  return ensureConfigured() !== null;
}

/**
 * Build a signed upload payload for a specific user's avatar. The
 * frontend posts the returned params to https://api.cloudinary.com/v1_1/
 * <cloud_name>/image/upload — no secret involved.
 *
 * Eager transformations:
 *   - 256x256 square crop (face-detected if possible) → main avatar
 *   - 64x64 square crop → sidebar / nav thumbnail
 *
 * public_id is scoped to the user so a re-upload overwrites the old
 * file (cheaper than orphan cleanup).
 */
export function signAvatarUpload(userId: string): {
  ready: true;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  folder: string;
  eager: string;
  uploadUrl: string;
} | { ready: false; reason: string } {
  const cfg = ensureConfigured();
  if (!cfg) {
    return { ready: false, reason: 'Cloudinary is not configured on this server' };
  }

  const folder = 'ppl/avatars';
  const publicId = `user_${userId}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const eager = 'c_fill,g_face,w_256,h_256|c_fill,g_face,w_64,h_64';

  // The set of params that must be signed — Cloudinary requires the
  // signature to cover EVERY non-secret param the upload includes
  // (alphabetical order, joined by '&'). See:
  // https://cloudinary.com/documentation/upload_images#generating_authentication_signatures
  const paramsToSign: Record<string, string | number> = {
    eager,
    folder,
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };
  const signature = signParams(paramsToSign, cfg.apiSecret);

  return {
    ready: true,
    cloudName: cfg.cloudName,
    apiKey: cfg.apiKey,
    timestamp,
    signature,
    publicId,
    folder,
    eager,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,
  };
}

/**
 * Verify the secure_url Cloudinary sends back to us. We re-derive the
 * expected public URL from the signed payload and check it matches —
 * this protects against a malicious frontend handing us an arbitrary
 * URL (e.g. a phishing image) instead of the one we authorized.
 */
export function isValidAvatarUrl(url: string, userId: string): boolean {
  const cfg = ensureConfigured();
  if (!cfg) return false;
  // Expected pattern:
  //   https://res.cloudinary.com/<cloud>/image/upload/.../ppl/avatars/user_<id>.<ext>
  const pattern = new RegExp(
    `^https://res\\.cloudinary\\.com/${escapeRegex(
      cfg.cloudName
    )}/image/upload/(?:[^/]+/)*ppl/avatars/user_${escapeRegex(userId)}(?:\\.[a-z0-9]+)?$`
  );
  return pattern.test(url);
}

function signParams(
  params: Record<string, string | number>,
  apiSecret: string
): string {
  const keys = Object.keys(params).sort();
  const toSign = keys.map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
