'use client';

/**
 * CRM lead detail view.
 *
 * Linked from the kanban cards on /admin/crm. Shows the lead's contact info,
 * stage selector, owner, follow-up date, notes, and a full activity timeline
 * with an add-activity composer. Convert button marks the lead CLOSED_WON
 * (and links to a User if/when we wire that up).
 *
 * All endpoints behind /api/leads require auth + a CRM-eligible role
 * (ADMIN / CONTENT_MARKETING_ADMIN / CONTENT_MARKETING / COORDINATOR).
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Lead = NonNullable<Awaited<ReturnType<typeof api.getLead>>['data']>;
type Activity = Lead['activities'][number];

const STAGES: { id: string; label: string }[] = [
  { id: 'NEW', label: 'New' },
  { id: 'CONTACTED', label: 'Contacted' },
  { id: 'QUALIFIED', label: 'Qualified' },
  { id: 'TRIAL_SCHEDULED', label: 'Trial Scheduled' },
  { id: 'TRIAL_COMPLETED', label: 'Trial Completed' },
  { id: 'PROPOSAL', label: 'Proposal' },
  { id: 'CLOSED_WON', label: 'Closed Won' },
  { id: 'CLOSED_LOST', label: 'Closed Lost' },
];

const ACTIVITY_LABELS: Record<string, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL_SENT: 'Email sent',
  EMAIL_RECEIVED: 'Email received',
  SMS_SENT: 'SMS sent',
  SMS_RECEIVED: 'SMS received',
  FORM_SUBMISSION: 'Form submission',
  STAGE_CHANGE: 'Stage change',
  MEETING: 'Meeting',
  TASK: 'Task',
};

const ACTIVITY_TYPES = ['NOTE', 'CALL', 'EMAIL_SENT', 'SMS_SENT', 'MEETING', 'TASK'];

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStage, setSavingStage] = useState(false);
  const [newActivityType, setNewActivityType] = useState('NOTE');
  const [newActivityBody, setNewActivityBody] = useState('');
  const [postingActivity, setPostingActivity] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [followUpDraft, setFollowUpDraft] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await api.getLead(id);
      if (res.data) {
        setLead(res.data);
        setNotesDraft(res.data.notes ?? '');
        setFollowUpDraft(res.data.nextFollowUpAt ? res.data.nextFollowUpAt.slice(0, 10) : '');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onStageChange = async (newStage: string) => {
    if (!lead || newStage === lead.stage) return;
    setSavingStage(true);
    try {
      await api.updateLead(lead.id, { stage: newStage });
      toast.success(`Moved to ${STAGES.find((s) => s.id === newStage)?.label || newStage}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update stage');
    } finally {
      setSavingStage(false);
    }
  };

  const onPostActivity = async () => {
    if (!lead || !newActivityBody.trim()) return;
    setPostingActivity(true);
    try {
      await api.addLeadActivity(lead.id, {
        type: newActivityType,
        body: newActivityBody.trim(),
      });
      setNewActivityBody('');
      toast.success('Activity logged');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log activity');
    } finally {
      setPostingActivity(false);
    }
  };

  const onSaveNotes = async () => {
    if (!lead) return;
    try {
      await api.updateLead(lead.id, { notes: notesDraft });
      toast.success('Notes saved');
      setEditingNotes(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save notes');
    }
  };

  const onSaveFollowUp = async () => {
    if (!lead) return;
    try {
      await api.updateLead(lead.id, {
        nextFollowUpAt: followUpDraft ? new Date(followUpDraft).toISOString() : null,
      });
      toast.success('Follow-up updated');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update follow-up');
    }
  };

  const onConvert = async () => {
    if (!lead) return;
    if (!confirm(`Mark ${lead.firstName} ${lead.lastName} as Closed Won?`)) return;
    try {
      await api.convertLead(lead.id, {});
      toast.success('Lead marked as Closed Won');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to convert');
    }
  };

  const onDelete = async () => {
    if (!lead) return;
    if (!confirm(`Delete ${lead.firstName} ${lead.lastName} permanently? This cannot be undone.`)) return;
    try {
      await api.deleteLead(lead.id);
      toast.success('Lead deleted');
      router.push('/admin/crm');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  if (loading) {
    return (
      <main className="p-6">
        <div className="animate-pulse text-muted">Loading lead…</div>
      </main>
    );
  }

  if (!lead) {
    return (
      <main className="p-6">
        <p className="text-muted">Lead not found.</p>
        <Link href="/admin/crm" className="text-accent-text text-sm hover:underline mt-2 inline-block">
          ← Back to CRM
        </Link>
      </main>
    );
  }

  return (
    <main className="p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <Link href="/admin/crm" className="text-xs text-muted hover:text-foreground inline-flex items-center gap-1">
        ← All leads
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {lead.firstName} {lead.lastName}
          </h1>
          <div className="text-sm text-muted mt-1 space-x-3">
            <a href={`mailto:${lead.email}`} className="hover:text-foreground">{lead.email}</a>
            {lead.phone && <a href={`tel:${lead.phone}`} className="hover:text-foreground">{lead.phone}</a>}
            {lead.ageGroup && <span>{lead.ageGroup}</span>}
            {lead.location?.name && <span>{lead.location.name}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {lead.stage !== 'CLOSED_WON' && (
            <button onClick={onConvert} className="ppl-btn ppl-btn-primary text-xs">
              Mark Closed Won
            </button>
          )}
          <button onClick={onDelete} className="ppl-btn text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">
            Delete
          </button>
        </div>
      </div>

      {/* Stage + meta grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">Stage</p>
          <select
            value={lead.stage}
            onChange={(e) => onStageChange(e.target.value)}
            disabled={savingStage}
            className="ppl-input w-full text-sm"
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">Owner</p>
          <p className="text-sm text-foreground">{lead.owner?.fullName ?? <span className="text-muted">Unassigned</span>}</p>
          {lead.owner?.email && <p className="text-xs text-muted truncate">{lead.owner.email}</p>}
        </div>
        <div className="ppl-card">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">Next Follow-up</p>
          <div className="flex gap-2">
            <input
              type="date"
              value={followUpDraft}
              onChange={(e) => setFollowUpDraft(e.target.value)}
              className="ppl-input text-sm flex-1"
            />
            <button onClick={onSaveFollowUp} className="ppl-btn ppl-btn-secondary text-xs">Save</button>
          </div>
          {lead.lastContactedAt && (
            <p className="text-[11px] text-muted mt-2">
              Last contact: {new Date(lead.lastContactedAt).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      {/* Source meta */}
      <div className="mt-6 ppl-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted">Notes</p>
          {!editingNotes && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-[11px] text-accent-text hover:brightness-110"
            >
              Edit
            </button>
          )}
        </div>
        {editingNotes ? (
          <div>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={5}
              className="ppl-input w-full text-sm"
              placeholder="Free-form notes about this lead…"
            />
            <div className="flex gap-2 mt-2">
              <button onClick={onSaveNotes} className="ppl-btn ppl-btn-primary text-xs">Save</button>
              <button
                onClick={() => {
                  setEditingNotes(false);
                  setNotesDraft(lead.notes ?? '');
                }}
                className="ppl-btn ppl-btn-secondary text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground/90 whitespace-pre-wrap">
            {lead.notes || <span className="text-muted italic">No notes yet.</span>}
          </p>
        )}
        <div className="mt-3 pt-3 border-t border-border text-[11px] text-muted space-x-3">
          <span>Source: {lead.source}</span>
          <span>Created: {new Date(lead.createdAt).toLocaleDateString()}</span>
          {lead.lostReason && <span>Lost reason: {lead.lostReason}</span>}
        </div>
      </div>

      {/* Activity timeline + composer */}
      <div className="mt-6 ppl-card">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted mb-3">Activity</p>

        {/* Composer */}
        <div className="mb-4 flex flex-col sm:flex-row gap-2">
          <select
            value={newActivityType}
            onChange={(e) => setNewActivityType(e.target.value)}
            className="ppl-input text-sm sm:w-44"
          >
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>{ACTIVITY_LABELS[t] ?? t}</option>
            ))}
          </select>
          <input
            type="text"
            value={newActivityBody}
            onChange={(e) => setNewActivityBody(e.target.value)}
            placeholder="What happened?"
            className="ppl-input text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newActivityBody.trim()) onPostActivity();
            }}
          />
          <button
            onClick={onPostActivity}
            disabled={!newActivityBody.trim() || postingActivity}
            className="ppl-btn ppl-btn-primary text-xs disabled:opacity-50"
          >
            {postingActivity ? 'Saving…' : 'Log'}
          </button>
        </div>

        {/* Timeline */}
        {lead.activities.length === 0 ? (
          <p className="text-xs text-muted italic">No activity yet.</p>
        ) : (
          <ul className="space-y-3">
            {lead.activities
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((a: Activity) => (
                <li key={a.id} className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-highlight mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-foreground">
                        {ACTIVITY_LABELS[a.type] ?? a.type}
                      </span>
                      <span className="text-[10px] text-muted">
                        {new Date(a.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                      {a.author?.fullName && (
                        <span className="text-[10px] text-muted">· {a.author.fullName}</span>
                      )}
                    </div>
                    {a.body && (
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap mt-0.5">{a.body}</p>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </main>
  );
}
