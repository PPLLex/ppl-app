/**
 * Google Places review monitor — Phase 2 (#28).
 *
 * Polls Google Places "Place Details" API daily for the org's place ID.
 * New reviews (not yet seen) get inserted into Review and the admin gets
 * an alert email — especially urgent for low ratings (≤ 3 stars).
 *
 * Google Places returns at most the 5 most recent reviews per call, so
 * heavy weeks may miss some. For higher fidelity we'd switch to the
 * Google Business Profile API (separate auth flow). 5/day is fine for
 * PPL's volume.
 *
 * Required env: GOOGLE_PLACES_API_KEY
 * Required OrgSettings: googlePlaceId (set on /admin/settings)
 */

import { prisma } from '../utils/prisma';
import { sendEmail, buildPPLEmail } from './emailService';
import { config } from '../config';

type GoogleReview = {
  author_name: string;
  profile_photo_url?: string;
  rating: number;
  text?: string;
  time: number; // Unix seconds
  // Used to construct a stable identifier — Google doesn't give us a
  // first-class review ID via the standard Places API, so we hash
  // (author_name + time + first 40 chars of text) for dedupe.
};

type GooglePlaceDetailsResponse = {
  result?: {
    name?: string;
    reviews?: GoogleReview[];
    url?: string;
  };
  status?: string;
  error_message?: string;
};

function externalIdFor(r: GoogleReview): string {
  // Stable enough for dedupe — author_name + time should never collide for
  // genuine reviews. Slice text to bound length.
  const textSlug = (r.text ?? '').slice(0, 40).replace(/\s+/g, ' ').trim();
  return `${r.author_name}|${r.time}|${textSlug}`;
}

export async function pollGoogleReviews(): Promise<{
  fetched: number;
  inserted: number;
  alertedLowStars: number;
  skipped?: string;
}> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { fetched: 0, inserted: 0, alertedLowStars: 0, skipped: 'GOOGLE_PLACES_API_KEY unset' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settings: any = await prisma.orgSettings.findUnique({ where: { id: 'ppl' } });
  const placeId: string | null = settings?.googlePlaceId ?? null;
  if (!placeId) {
    return { fetched: 0, inserted: 0, alertedLowStars: 0, skipped: 'OrgSettings.googlePlaceId unset' };
  }

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&fields=name,reviews,url&key=${apiKey}`;

  let data: GooglePlaceDetailsResponse;
  try {
    const res = await fetch(url);
    data = (await res.json()) as GooglePlaceDetailsResponse;
  } catch (err) {
    console.error('[reviewMonitor] fetch failed:', err);
    return { fetched: 0, inserted: 0, alertedLowStars: 0, skipped: 'fetch error' };
  }

  if (data.status && data.status !== 'OK') {
    console.error('[reviewMonitor] API error:', data.status, data.error_message);
    return { fetched: 0, inserted: 0, alertedLowStars: 0, skipped: data.status };
  }

  const reviews = data.result?.reviews ?? [];
  let inserted = 0;
  let alertedLowStars = 0;

  for (const r of reviews) {
    const externalId = externalIdFor(r);
    const existing = await prisma.review.findFirst({
      where: { organizationId: 'ppl', provider: 'google', externalId },
    });
    if (existing) continue;

    const created = await prisma.review.create({
      data: {
        organizationId: 'ppl',
        provider: 'google',
        externalId,
        authorName: r.author_name,
        authorPhotoUrl: r.profile_photo_url ?? null,
        rating: r.rating,
        text: r.text ?? null,
        publishedAt: new Date(r.time * 1000),
        url: data.result?.url ?? null,
      },
    });
    inserted++;

    // Alert on low-star reviews immediately. High-star reviews get
    // batched into a daily digest (next iteration) — for now we email
    // every new review so admin gets visibility.
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'cmart@pitchingperformancelab.com';
    if (r.rating <= 3) alertedLowStars++;
    void sendEmail({
      to: adminEmail,
      subject: `${r.rating === 5 ? '⭐' : r.rating <= 3 ? '⚠️' : ''} New ${r.rating}-star Google review from ${r.author_name}`,
      html: buildPPLEmail(`New ${r.rating}-Star Review`, `
        <p style="margin:0 0 10px;font-size:13px;color:#666;">From <strong style="color:#1a1a1a;">${r.author_name}</strong> · ${new Date(r.time * 1000).toLocaleDateString()}</p>
        <p style="margin:0 0 16px;font-size:18px;color:#95c83c;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</p>
        ${r.text ? `<p style="margin:0 0 18px;font-size:14.5px;color:#374151;line-height:1.65;font-style:italic;">"${r.text.replace(/"/g, '&quot;')}"</p>` : ''}
        <p style="margin:0 0 18px;text-align:center;">
          <a href="${config.frontendUrl}/admin/reviews/${created.id}" style="display:inline-block;padding:12px 24px;background:#95c83c;color:#1a1a1a;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">Draft Reply with AI →</a>
        </p>
        ${data.result?.url ? `<p style="margin:0;text-align:center;font-size:12px;color:#666;"><a href="${data.result.url}" style="color:#95c83c;">View on Google →</a></p>` : ''}
      `),
      text: `New ${r.rating}-star review from ${r.author_name}: ${r.text ?? '(no text)'}`,
    }).catch((e) => console.error('[reviewMonitor] alert email failed:', e));
  }

  console.log(
    `[reviewMonitor] fetched ${reviews.length}, inserted ${inserted} new, ${alertedLowStars} low-star alerts`
  );
  return { fetched: reviews.length, inserted, alertedLowStars };
}
