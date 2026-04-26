'use client';

/**
 * Email blast composer + campaign list. Phase 2 (#22 / #23).
 *
 * Single-page UI for ADMIN / CONTENT_MARKETING_ADMIN / CONTENT_MARKETING:
 *   - Lists existing campaigns by status
 *   - "New Campaign" button opens a modal composer with:
 *       - subject + HTML body
 *       - audience picker (all members / parents / leads / past-due / by tag)
 *       - tag multi-select with op=any|all + subjectType=user|lead|all
 *       - audience preview (live recipient count)
 *       - "Save as Draft" + "Send Now"
 *
 * Backend endpoints already exist at /api/campaigns. Tag-based segmentation
 * uses CampaignAudience.CUSTOM_SEGMENT with audienceFilter = { tagIds, op,
 * subjectType }, resolved server-side.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Campaign = NonNullable<Awaited<ReturnType<typeof api.listCampaigns>>['data']>[number];
type Tag = NonNullable<Awaited<ReturnType<typeof api.listTags>>['data']>[number];

const AUDIENCE_OPTIONS = [
  { value: 'ALL_MEMBERS', label: 'All Active Members' },
  { value: 'ALL_PARENTS', label: 'All Parents' },
  { value: 'ALL_ATHLETES', label: 'All Athletes' },
  { value: 'ALL_LEADS', label: 'All Leads (open)' },
  { value: 'PAST_DUE_MEMBERS', label: 'Past-Due Members' },
  { value: 'CUSTOM_SEGMENT', label: 'Tag-Filtered Segment' },
];

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-500/10 text-gray-300 border border-gray-500/30',
  SCHEDULED: 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
  SENDING: 'bg-amber-500/10 text-amber-400 border border-amber-500/30',
  SENT: 'bg-green-500/10 text-green-400 border border-green-500/30',
  FAILED: 'bg-red-500/10 text-red-400 border border-red-500/30',
  CANCELLED: 'bg-gray-500/10 text-gray-500 border border-gray-500/20',
};

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, t] = await Promise.all([api.listCampaigns(), api.listTags()]);
      setCampaigns((c.data as Campaign[]) || []);
      setTags((t.data as Tag[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Email Campaigns</h1>
          <p className="text-sm text-muted mt-0.5">
            Send marketing emails to tagged audiences. {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'} total.
          </p>
        </div>
        <button onClick={() => setShowComposer(true)} className="ppl-btn ppl-btn-primary text-sm">
          + New Campaign
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="ppl-card animate-pulse h-20" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted text-sm">No campaigns yet. Hit "New Campaign" to send your first blast.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="ppl-card flex items-center gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground text-sm truncate">{c.name}</h3>
                  <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_STYLES[c.status] || ''}`}>
                    {c.status}
                  </span>
                </div>
                <p className="text-xs text-muted truncate">{c.subject}</p>
                <p className="text-[11px] text-muted mt-0.5">
                  Audience: {c.audience.replace(/_/g, ' ')}
                  {c.sentAt && ` · Sent ${new Date(c.sentAt).toLocaleDateString()}`}
                  {c.sentCount != null && ` · ${c.sentCount} delivered`}
                  {c.failedCount && c.failedCount > 0 ? ` · ${c.failedCount} failed` : ''}
                </p>
              </div>
              {c.status === 'DRAFT' && (
                <CampaignActions
                  campaign={c}
                  onChanged={load}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {showComposer && (
        <CampaignComposer
          tags={tags}
          onClose={() => setShowComposer(false)}
          onSaved={async () => {
            setShowComposer(false);
            await load();
          }}
        />
      )}
    </main>
  );
}

function CampaignActions({ campaign, onChanged }: { campaign: Campaign; onChanged: () => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const handleSend = async () => {
    if (!confirm(`Send "${campaign.name}" now? This cannot be undone.`)) return;
    setSending(true);
    try {
      const res = await api.sendCampaign(campaign.id);
      toast.success(`Sent ${res.data?.sent ?? 0} of ${res.data?.total ?? 0}`);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  };
  const handleDelete = async () => {
    if (!confirm(`Delete draft "${campaign.name}"?`)) return;
    try {
      await api.deleteCampaign(campaign.id);
      toast.success('Draft deleted');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };
  return (
    <div className="flex gap-2 flex-shrink-0">
      <button
        onClick={handleSend}
        disabled={sending}
        className="ppl-btn ppl-btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send Now'}
      </button>
      <button
        onClick={handleDelete}
        className="ppl-btn text-xs px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
      >
        Delete
      </button>
    </div>
  );
}

function CampaignComposer({
  tags,
  onClose,
  onSaved,
}: {
  tags: Tag[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [audience, setAudience] = useState('ALL_MEMBERS');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagOp, setTagOp] = useState<'any' | 'all'>('any');
  const [subjectType, setSubjectType] = useState<'all' | 'user' | 'lead'>('all');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiBrief, setAiBrief] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const tagsByKind = useMemo(() => {
    const map: Record<string, Tag[]> = {};
    for (const t of tags) {
      if (!map[t.kind]) map[t.kind] = [];
      map[t.kind].push(t);
    }
    return map;
  }, [tags]);

  const buildPayload = () => ({
    name: name.trim() || 'Untitled Campaign',
    subject: subject.trim(),
    bodyHtml,
    audience,
    audienceFilter:
      audience === 'CUSTOM_SEGMENT'
        ? { tagIds: selectedTagIds, op: tagOp, subjectType }
        : {},
  });

  const canSave = subject.trim().length > 0 && bodyHtml.trim().length > 0;

  const onPreview = async () => {
    if (!canSave) return;
    setPreviewLoading(true);
    try {
      // Save (or update) a draft first to get an ID, then preview against it.
      const created = await api.createCampaign(buildPayload());
      const id = (created.data as { id: string } | undefined)?.id;
      if (!id) throw new Error('Failed to create draft for preview');
      const preview = await api.previewCampaignAudience(id);
      setPreviewCount(preview.data?.totalRecipients ?? 0);
      // Clean up the throw-away draft so the list isn't littered.
      await api.deleteCampaign(id).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const onSaveDraft = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.createCampaign(buildPayload());
      toast.success('Draft saved');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onSendNow = async () => {
    if (!canSave) return;
    if (!confirm('Send this campaign now? Once sent, it cannot be edited or unsent.')) return;
    setSaving(true);
    try {
      const created = await api.createCampaign(buildPayload());
      const id = (created.data as { id: string } | undefined)?.id;
      if (!id) throw new Error('Failed to save campaign before sending');
      const res = await api.sendCampaign(id);
      toast.success(`Sent ${res.data?.sent ?? 0} of ${res.data?.total ?? 0}`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">New Campaign</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Campaign Name (internal)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ppl-input w-full mt-1"
              placeholder="Summer Camp Push 2026"
            />
          </div>

          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Subject Line</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="ppl-input w-full mt-1"
              placeholder="Early-bird summer camp — your spot is waiting"
            />
          </div>

          {/* AI draft */}
          <div className="ppl-card bg-background/40 border-dashed">
            <label className="text-xs text-muted uppercase tracking-wider">AI Draft (optional)</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={aiBrief}
                onChange={(e) => setAiBrief(e.target.value)}
                placeholder="e.g. Summer camp, early-bird $50 off, ends Friday"
                className="ppl-input flex-1 text-sm"
              />
              <button
                type="button"
                disabled={aiLoading || aiBrief.trim().length < 5}
                onClick={async () => {
                  setAiLoading(true);
                  try {
                    const res = await api.draftCampaignWithAi(aiBrief.trim());
                    if (res.data?.subject) setSubject(res.data.subject);
                    if (res.data?.html) setBodyHtml(res.data.html);
                    toast.success('AI draft inserted — edit before sending');
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'AI draft failed');
                  } finally {
                    setAiLoading(false);
                  }
                }}
                className="ppl-btn ppl-btn-secondary text-xs whitespace-nowrap disabled:opacity-50"
              >
                {aiLoading ? 'Drafting…' : 'Draft with AI'}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-1">
              Replaces your subject + body with an AI-generated draft. Always review before sending.
            </p>
          </div>

          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Body (HTML)</label>
            <textarea
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={8}
              className="ppl-input w-full mt-1 font-mono text-xs"
              placeholder={'<p>Hey {{firstName}},</p>\n<p>Quick note about ...</p>'}
            />
            <p className="text-[11px] text-muted mt-1">
              Tokens: <code>{'{{firstName}}'}</code> · <code>{'{{fullName}}'}</code> · <code>{'{{email}}'}</code>
            </p>
          </div>

          <div>
            <label className="text-xs text-muted uppercase tracking-wider">Audience</label>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="ppl-input w-full mt-1"
            >
              {AUDIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {audience === 'CUSTOM_SEGMENT' && (
            <div className="ppl-card bg-background/50">
              <label className="text-xs text-muted uppercase tracking-wider">Tags</label>
              <div className="space-y-3 mt-2">
                {Object.entries(tagsByKind).map(([kind, kindTags]) => (
                  <div key={kind}>
                    <p className="text-[10px] uppercase text-muted font-semibold mb-1">{kind.replace(/_/g, ' ')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {kindTags.map((t) => {
                        const selected = selectedTagIds.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() =>
                              setSelectedTagIds((prev) =>
                                selected ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                              )
                            }
                            className={`text-xs px-2.5 py-1 rounded-full border transition ${
                              selected
                                ? 'border-highlight text-foreground'
                                : 'border-border text-muted hover:text-foreground'
                            }`}
                            style={selected ? { backgroundColor: `${t.color}25` } : {}}
                          >
                            <span style={{ color: t.color }}>●</span> {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <label className="text-[10px] uppercase text-muted">Match</label>
                  <select
                    value={tagOp}
                    onChange={(e) => setTagOp(e.target.value as 'any' | 'all')}
                    className="ppl-input w-full text-sm mt-1"
                  >
                    <option value="any">Any of the selected tags</option>
                    <option value="all">All of the selected tags</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted">Send To</label>
                  <select
                    value={subjectType}
                    onChange={(e) => setSubjectType(e.target.value as 'all' | 'user' | 'lead')}
                    className="ppl-input w-full text-sm mt-1"
                  >
                    <option value="all">Users + Leads</option>
                    <option value="user">Users only</option>
                    <option value="lead">Leads only</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <button
              type="button"
              onClick={onPreview}
              disabled={!canSave || previewLoading}
              className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-50"
            >
              {previewLoading ? 'Counting…' : 'Preview Audience'}
            </button>
            {previewCount != null && (
              <p className="text-sm text-foreground">
                <strong className="text-accent-text">{previewCount}</strong> recipient{previewCount === 1 ? '' : 's'} would receive this.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border p-4 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="ppl-btn ppl-btn-secondary text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!canSave || saving}
            className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-50"
          >
            Save as Draft
          </button>
          <button
            type="button"
            onClick={onSendNow}
            disabled={!canSave || saving}
            className="ppl-btn ppl-btn-primary text-xs disabled:opacity-50"
          >
            {saving ? 'Sending…' : 'Send Now'}
          </button>
        </div>
      </div>
    </div>
  );
}
