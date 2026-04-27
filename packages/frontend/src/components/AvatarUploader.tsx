'use client';

/**
 * Avatar uploader (#P11 / PREMIUM_AUDIT).
 *
 * Drop-in widget for the /profile Security tab (or anywhere). Three states:
 *   - Has avatar: shows the image with Replace + Remove buttons.
 *   - No avatar: shows initials + Upload button.
 *   - Backend says Cloudinary isn't configured: hidden entirely.
 *
 * Upload flow (signed direct upload):
 *   1. POST /api/avatars/sign      → { signature, timestamp, ... }
 *   2. POST <uploadUrl>            → file directly to Cloudinary
 *   3. POST /api/avatars/confirm   → { secureUrl } so backend persists
 *
 * Premium polish:
 *   - Drag-and-drop OR click-to-pick.
 *   - Live preview the moment a file is selected (URL.createObjectURL).
 *   - Toast feedback at every step.
 *   - 5MB upload cap, image/* MIME guard, JPG/PNG/WebP/GIF allowed.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = /^image\/(jpeg|jpg|png|webp|gif)$/i;

interface AvatarUploaderProps {
  /** Current avatar URL on the user. */
  avatarUrl: string | null;
  /** Display name — used to render initials when no avatar. */
  fullName: string;
  /** Called with the new avatarUrl on success (or null on remove). */
  onChange: (next: string | null) => void;
}

export function AvatarUploader({ avatarUrl, fullName, onChange }: AvatarUploaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAvatarHealth()
      .then((res) => {
        if (cancelled) return;
        setAvailable(!!res.data?.ready);
      })
      .catch(() => setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Free the preview blob URL when we're done with it.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  if (available === false) return null;

  const initials =
    (fullName || 'U')
      .split(/\s+/)
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  const onFile = async (file: File) => {
    if (!ALLOWED.test(file.type)) {
      toast.error('Pick a JPG, PNG, WebP, or GIF.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB. Max is 5MB.`);
      return;
    }

    setBusy(true);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    try {
      const sig = await api.signAvatarUpload();
      if (!sig.data) throw new Error('Could not get signed upload params');

      const form = new FormData();
      form.append('file', file);
      form.append('api_key', sig.data.apiKey);
      form.append('timestamp', String(sig.data.timestamp));
      form.append('signature', sig.data.signature);
      form.append('public_id', sig.data.publicId);
      form.append('folder', sig.data.folder);
      form.append('overwrite', 'true');
      form.append('eager', sig.data.eager);

      const res = await fetch(sig.data.uploadUrl, { method: 'POST', body: form });
      const body = await res.json();
      if (!res.ok || !body.secure_url) {
        throw new Error(body?.error?.message || 'Cloudinary rejected the upload');
      }

      const confirmed = await api.confirmAvatarUpload(body.secure_url);
      if (!confirmed.data) throw new Error('Server did not confirm the upload');
      onChange(confirmed.data.avatarUrl);
      toast.success('Profile photo updated');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      setPreviewUrl(null);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove your profile photo?')) return;
    setBusy(true);
    try {
      await api.deleteAvatar();
      onChange(null);
      toast.success('Profile photo removed');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  const displayUrl = previewUrl || avatarUrl;

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-lg border transition ${
        hovering
          ? 'border-highlight bg-highlight/5'
          : 'border-border bg-surface'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setHovering(true);
      }}
      onDragLeave={() => setHovering(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHovering(false);
        const file = e.dataTransfer.files[0];
        if (file) void onFile(file);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
        }}
      />
      <div
        className="relative w-20 h-20 rounded-full overflow-hidden ring-2 ring-border bg-surface-hover flex items-center justify-center text-foreground font-bold text-xl flex-shrink-0"
      >
        {displayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayUrl}
            alt={fullName}
            className="w-full h-full object-cover"
          />
        ) : (
          <span>{initials}</span>
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 text-foreground" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Profile photo</p>
        <p className="text-xs text-muted mt-0.5">
          Drop an image here or click below. JPG / PNG / WebP / GIF up to 5MB.
          We crop to a 256×256 square automatically.
        </p>
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="ppl-btn ppl-btn-secondary text-xs"
          >
            {avatarUrl ? 'Replace' : 'Upload'}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="ppl-btn text-xs"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
