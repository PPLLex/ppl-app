'use client';

/**
 * Google Reviews dashboard — Phase 2 (#28, #40).
 *
 * Lists captured Google reviews with stars, body, and per-review actions:
 *   - "Draft Reply with AI" → calls Claude to write a tone-matched reply
 *   - Edit + mark-published manually (Google Business Profile API publish
 *     is a future iteration; for now admin pastes the reply on Google
 *     themselves and clicks "Mark Posted" here for tracking)
 *   - "Poll Now" admin button forces an immediate fetch from Google.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Review = NonNullable<Awaited<ReturnType<typeof api.listReviews>>['data']>[number];

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unpublished', label: 'No Reply Yet' },
  { key: 'replied', label: 'Replied' },
];

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listReviews({ status: filter === 'all' ? undefined : filter });
      setReviews((res.data as Review[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handlePoll = async () => {
    setPolling(true);
    try {
      const res = await api.pollReviewsNow();
      const d = res.data;
      toast.success(`Polled — ${d?.inserted ?? 0} new of ${d?.fetched ?? 0} fetched`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Poll failed');
    } finally {
      setPolling(false);
    }
  };

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Google Reviews</h1>
          <p className="text-sm text-muted mt-0.5">
            {reviews.length} review{reviews.length === 1 ? '' : 's'} captured. Daily auto-poll runs at 8 AM ET.
          </p>
        </div>
        <button onClick={handlePoll} disabled={polling} className="ppl-btn ppl-btn-secondary text-sm disabled:opacity-50">
          {polling ? 'Polling…' : 'Poll Now'}
        </button>
      </div>

      <div className="flex gap-1 mb-4 bg-surface rounded-lg p-1 w-fit">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === f.key ? 'bg-highlight/20 text-accent-text' : 'text-muted hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-32" />)}</div>
      ) : reviews.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">
            No reviews yet. Set <code className="text-accent-text">googlePlaceId</code> in Settings, then click "Poll Now".
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => <ReviewCard key={r.id} review={r} onChanged={load} />)}
        </div>
      )}
    </main>
  );
}

function ReviewCard({ review, onChanged }: { review: Review; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review.draftReply ?? '');
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAiDraft = async () => {
    setDrafting(true);
    try {
      const res = await api.draftReviewReply(review.id);
      setDraft(res.data?.draftReply ?? '');
      setEditing(true);
      toast.success('AI draft inserted — review and edit before posting');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      await api.updateReview(review.id, { draftReply: draft });
      toast.success('Draft saved');
      setEditing(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPosted = async () => {
    setSaving(true);
    try {
      await api.updateReview(review.id, { publishedReply: draft || review.draftReply || '', markPublished: true });
      toast.success('Marked as posted');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ppl-card">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground text-sm">{review.authorName}</span>
            <span className="text-amber-400 text-sm">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
            <span className="text-[11px] text-muted">{new Date(review.publishedAt).toLocaleDateString()}</span>
            {review.publishedReplyAt && (
              <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/30">
                Replied
              </span>
            )}
          </div>
          {review.text && (
            <p className="text-sm text-foreground/90 mt-2 whitespace-pre-wrap italic">"{review.text}"</p>
          )}
          {review.url && (
            <a
              href={review.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-accent-text hover:underline mt-2 inline-block"
            >
              View on Google →
            </a>
          )}
        </div>
      </div>

      {/* Reply section */}
      <div className="mt-4 pt-4 border-t border-border">
        {editing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="ppl-input w-full text-sm"
              placeholder="Your reply…"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={handleSaveDraft} disabled={saving} className="ppl-btn ppl-btn-primary text-xs disabled:opacity-50">
                Save Draft
              </button>
              <button
                onClick={handleMarkPosted}
                disabled={saving || !draft.trim()}
                className="ppl-btn text-xs px-3 py-1.5 bg-green-500/10 text-green-400 border border-green-500/20 disabled:opacity-50"
              >
                I Posted It on Google
              </button>
              <button onClick={() => { setEditing(false); setDraft(review.draftReply ?? ''); }} className="ppl-btn ppl-btn-secondary text-xs">
                Cancel
              </button>
            </div>
          </div>
        ) : review.publishedReply ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mb-1">Your Reply</p>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap">{review.publishedReply}</p>
            <button onClick={() => { setDraft(review.publishedReply ?? ''); setEditing(true); }} className="text-[11px] text-accent-text hover:underline mt-2">
              Edit
            </button>
          </div>
        ) : review.draftReply ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Draft (not yet posted)</p>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">{review.draftReply}</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => setEditing(true)} className="text-[11px] text-accent-text hover:underline">Edit</button>
              <button
                onClick={handleMarkPosted}
                disabled={saving}
                className="text-[11px] text-green-400 hover:underline"
              >
                I Posted It on Google →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button onClick={handleAiDraft} disabled={drafting} className="ppl-btn ppl-btn-primary text-xs disabled:opacity-50">
              {drafting ? 'Drafting…' : 'Draft Reply with AI'}
            </button>
            <button onClick={() => setEditing(true)} className="ppl-btn ppl-btn-secondary text-xs">
              Write Manually
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
