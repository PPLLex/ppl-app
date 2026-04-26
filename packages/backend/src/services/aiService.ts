/**
 * AI helpers — wraps Anthropic's Claude API for the in-app AI features:
 *   - draftMarketingEmail() → AI-written campaign body (#39)
 *   - draftReviewReply()    → AI-written response to a Google review (#40)
 *
 * Reads ANTHROPIC_API_KEY from env. If unset, every helper returns a
 * graceful "AI not configured" payload so the UI shows a clear error
 * instead of throwing.
 */

import { config } from '../config';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

type AnthropicResponse = {
  content?: Array<{ type: string; text: string }>;
  error?: { message: string };
};

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 2000
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: 'AI is not configured — add ANTHROPIC_API_KEY to Railway env.',
    };
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    const data = (await res.json()) as AnthropicResponse;
    if (!res.ok) {
      return { ok: false, error: data.error?.message ?? `Anthropic returned ${res.status}` };
    }
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Draft a marketing email body from a one-line brief. Returns HTML the
 * campaign composer can drop straight into bodyHtml. Tokens like
 * {{firstName}} are intentionally LEFT IN — they get expanded per
 * recipient at send time.
 */
export async function draftMarketingEmail(brief: string): Promise<{
  ok: boolean;
  subject?: string;
  html?: string;
  error?: string;
}> {
  const systemPrompt = `You write marketing emails for Pitching Performance Lab (PPL), a baseball pitching training facility. Your tone is direct, confident, and slightly irreverent — you sound like a coach who's been around the block, not a marketing copywriter. You never use exclamation points more than once per email. You never use the word "elevate." You never write paragraphs longer than 3 sentences. You always use {{firstName}} for personalization in the greeting. Output a JSON object: { "subject": "...", "html": "<p>...</p>..." }. The html field must be valid HTML using only <p>, <strong>, <em>, <a>, <br> tags. No headings, no lists, no inline styles. Keep the entire body under 150 words.`;
  const result = await callClaude(systemPrompt, `Brief: ${brief}\n\nWrite the email now. Return ONLY the JSON object, no other text.`, 1500);
  if (!result.ok || !result.text) return { ok: false, error: result.error };

  try {
    // Strip code-fence wrapping if Claude added one
    const cleaned = result.text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { subject?: string; html?: string };
    if (!parsed.subject || !parsed.html) {
      return { ok: false, error: 'AI returned an incomplete email — try again or refine the brief.' };
    }
    return { ok: true, subject: parsed.subject, html: parsed.html };
  } catch {
    return { ok: false, error: 'AI returned malformed JSON — try again.' };
  }
}

/**
 * Draft a reply to a Google review. Tone matches the review (warm if
 * positive, professional if critical). Always thanks the reviewer by
 * name when possible and never apologizes for things outside our control.
 */
export async function draftReviewReply(args: {
  reviewerName: string;
  rating: number; // 1-5
  reviewText: string;
}): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const systemPrompt = `You write owner-style replies to Google reviews for Pitching Performance Lab (PPL). Tone matches the rating: 5★ = warm and grateful; 3-4★ = appreciative + polite acknowledgment of any criticism; 1-2★ = professional, takes the concern seriously, invites them to email cmart@pitchingperformancelab.com to make it right. Never apologize for things outside our control. Never make excuses. Never promise specific changes. Never use the word "elevate." Keep replies to 2-3 sentences max. Address the reviewer by first name if their name is provided. Sign nothing — Google appends the business name automatically.`;
  const userPrompt = `Reviewer: ${args.reviewerName}\nRating: ${args.rating}★\nReview: ${args.reviewText}\n\nWrite the reply now. Return ONLY the reply text, no quotes or other formatting.`;
  const result = await callClaude(systemPrompt, userPrompt, 400);
  if (!result.ok || !result.text) return { ok: false, error: result.error };
  return { ok: true, reply: result.text.trim() };
}

void config; // silence unused-import linter when config isn't referenced
