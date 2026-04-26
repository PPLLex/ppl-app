'use client';

/**
 * Admin CRM — sales pipeline view (foundation).
 *
 * Kanban-style columns, one per PipelineStage, with lead cards showing the
 * essentials (name, source, owner, next follow-up). Click a card to see
 * detail + activity stream (ships in a follow-up commit; this page lists
 * leads only).
 *
 * Access: Admin, Content & Marketing Admin, Content & Marketing, Coordinator.
 * Other roles can't hit /api/leads so navigating here returns empty.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { usePersistedState } from '@/hooks/usePersistedState';
import { BulkActionBar, useRowSelection } from '@/components/bulk/BulkActionBar';
import { HoverPreview } from '@/components/HoverPreview';

type Lead = Awaited<ReturnType<typeof api.listLeads>>['data'] extends Array<infer T> | null | undefined
  ? T
  : never;

const STAGES: Array<{ id: string; label: string; color: string }> = [
  { id: 'NEW', label: 'New', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  { id: 'CONTACTED', label: 'Contacted', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  { id: 'QUALIFIED', label: 'Qualified', color: 'bg-highlight/15 text-highlight-text border-highlight/30' },
  {
    id: 'ASSESSMENT_BOOKED',
    label: 'Assessment booked',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  {
    id: 'ASSESSMENT_DONE',
    label: 'Assessment done',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  { id: 'CLOSED_WON', label: 'Closed — Won', color: 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40' },
  { id: 'CLOSED_LOST', label: 'Closed — Lost', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  { id: 'NURTURE', label: 'Nurture', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
];

const SOURCE_LABELS: Record<string, string> = {
  WEBSITE_FORM: 'Website form',
  REFERRAL: 'Referral',
  WALK_IN: 'Walk-in',
  EVENT: 'Event',
  PARTNER_SCHOOL: 'Partner school',
  COLD_OUTREACH: 'Cold outreach',
  PAID_AD: 'Paid ad',
  SOCIAL: 'Social',
  OTHER: 'Other',
};

export default function AdminCrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  // Persist search across page navigations — staff routinely set a
  // search, click into a lead, then return; losing the term is annoying.
  const [search, setSearch] = usePersistedState<string>('crm-search', '');
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listLeads({ q: search || undefined });
      setLeads((res.data as Lead[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const byStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    for (const s of STAGES) map.set(s.id, []);
    for (const lead of leads) {
      if (!map.has(lead.stage)) map.set(lead.stage, []);
      map.get(lead.stage)!.push(lead);
    }
    // Sort each stage's column by lead score desc — hottest at the top.
    // Falls back to most-recently-updated when scores are equal.
    for (const [k, list] of map) {
      list.sort((a, b) => {
        const sa = (a as Lead & { score?: number }).score ?? 0;
        const sb = (b as Lead & { score?: number }).score ?? 0;
        if (sb !== sa) return sb - sa;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      map.set(k, list);
    }
    return map;
  }, [leads]);

  const advanceStage = async (lead: Lead, newStage: string) => {
    try {
      await api.updateLead(lead.id, { stage: newStage });
      toast.success(`Moved ${lead.firstName} → ${STAGES.find((s) => s.id === newStage)?.label}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update lead');
    }
  };

  // Bulk selection (#U8). Each lead card surfaces a checkbox; selected
  // lead IDs flow into a sticky action bar with "move to stage" and
  // "clear" controls.
  const allLeadIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const sel = useRowSelection(allLeadIds);
  const [bulkBusy, setBulkBusy] = useState(false);

  const runBulkStageChange = useCallback(
    async (stage: string) => {
      if (sel.count === 0) return;
      setBulkBusy(true);
      try {
        const res = await api.bulkLeadsStage({ leadIds: sel.ids, stage });
        toast.success(
          `Moved ${res.data?.processed ?? 0} lead${res.data?.processed === 1 ? '' : 's'} → ${
            STAGES.find((s) => s.id === stage)?.label ?? stage
          }`
        );
        sel.clear();
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Bulk stage move failed');
      } finally {
        setBulkBusy(false);
      }
    },
    [sel, load]
  );

  return (
    <main className="ppl-page-root">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl uppercase tracking-[0.04em] text-foreground">
              Sales pipeline
            </h1>
            <p className="text-sm text-muted mt-1">
              {leads.length} lead{leads.length === 1 ? '' : 's'} across the funnel
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="ppl-input text-sm max-w-xs"
            />
            <button
              onClick={() => setShowNewForm(true)}
              className="ppl-btn ppl-btn-primary text-sm"
            >
              + New lead
            </button>
          </div>
        </div>

        {loading ? (
          // Layout-matched skeleton — same column count + width as the
          // real kanban so there's no shift when data lands.
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGES.map((s) => (
              <div key={s.id} className="min-w-[280px] flex-shrink-0 space-y-3">
                <div className="ppl-skeleton h-6 w-32" aria-hidden />
                <div className="ppl-skeleton h-20" aria-hidden />
                <div className="ppl-skeleton h-20" aria-hidden />
                <div className="ppl-skeleton h-20" aria-hidden />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {STAGES.map((stage) => {
              const items = byStage.get(stage.id) || [];
              return (
                <div key={stage.id} className="min-w-[280px] flex-shrink-0">
                  <div
                    className={`rounded-t-lg px-3 py-2 border border-b-0 ${stage.color} text-xs uppercase tracking-[0.12em] font-semibold flex items-center justify-between`}
                  >
                    <span>{stage.label}</span>
                    <span className="opacity-80">{items.length}</span>
                  </div>
                  <div className="bg-surface/40 border border-border rounded-b-lg p-2 space-y-2 min-h-[120px]">
                    {items.length === 0 ? (
                      <p className="text-xs text-muted text-center py-6">No leads here yet.</p>
                    ) : (
                      items.map((lead) => (
                        <LeadCard
                          key={lead.id}
                          lead={lead}
                          onAdvance={advanceStage}
                          isSelected={sel.isSelected(lead.id)}
                          onToggleSelect={() => sel.toggle(lead.id)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showNewForm && <NewLeadModal onClose={() => setShowNewForm(false)} onCreated={load} />}

      {/* Bulk action bar (#U8) — Move selected leads through stages without
          dragging each card individually. Auto-hides at zero selected. */}
      <BulkActionBar selectedCount={sel.count} onClear={sel.clear} noun="lead">
        <select
          disabled={bulkBusy}
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            e.target.value = '';
            if (v) runBulkStageChange(v);
          }}
          className="bg-background border border-border rounded text-xs px-2 py-1.5 text-foreground focus:outline-none focus:border-highlight"
          aria-label="Move selected leads to stage"
        >
          <option value="" disabled>
            Move to…
          </option>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </BulkActionBar>
    </main>
  );
}

function LeadCard({
  lead,
  onAdvance,
  isSelected,
  onToggleSelect,
}: {
  lead: Lead;
  onAdvance: (lead: Lead, newStage: string) => void;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const currentIdx = STAGES.findIndex((s) => s.id === lead.stage);
  const nextStage = currentIdx >= 0 && currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;

  const isOverdue =
    lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now();

  // Score (0-100) — color-coded badge so admins can spot hot leads at a glance
  const score = (lead as Lead & { score?: number }).score ?? 0;
  const scoreStyle =
    score >= 70
      ? 'bg-green-500/20 text-green-400 border-green-500/40'
      : score >= 40
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : 'bg-gray-500/10 text-gray-400 border-gray-500/30';

  return (
    <div
      className={`border rounded-lg p-3 transition group ${
        isSelected
          ? 'bg-highlight/10 border-highlight'
          : 'bg-background border-border hover:border-highlight/40'
      }`}
    >
      <div className="flex items-start gap-2 mb-1">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="w-3.5 h-3.5 mt-0.5 accent-highlight cursor-pointer flex-shrink-0"
          aria-label={`Select ${lead.firstName} ${lead.lastName}`}
        />
      </div>
      <Link href={`/admin/crm/${lead.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <HoverPreview entity={{ kind: 'lead', id: lead.id }} className="flex-1 min-w-0">
            <p className="font-semibold text-foreground text-sm truncate">
              {lead.firstName} {lead.lastName}
            </p>
          </HoverPreview>
          {score > 0 && (
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border flex-shrink-0 ${scoreStyle}`}
              title={`Lead score: ${score}/100`}
            >
              {score}
            </span>
          )}
        </div>
        <p className="text-xs text-muted truncate">{lead.email}</p>
      </Link>

      <div className="flex items-center flex-wrap gap-1.5 mt-2">
        <span className="text-[10px] uppercase tracking-[0.08em] bg-surface px-1.5 py-0.5 rounded text-muted">
          {SOURCE_LABELS[lead.source] ?? lead.source}
        </span>
        {lead.ageGroup && (
          <span className="text-[10px] uppercase tracking-[0.08em] bg-surface px-1.5 py-0.5 rounded text-muted">
            {lead.ageGroup}
          </span>
        )}
        {lead.nextFollowUpAt && (
          <span
            className={`text-[10px] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded ${
              isOverdue
                ? 'bg-red-500/15 text-red-400'
                : 'bg-amber-500/15 text-amber-400'
            }`}
            title={new Date(lead.nextFollowUpAt).toLocaleString()}
          >
            {isOverdue ? 'Overdue' : 'Follow-up'}
          </span>
        )}
      </div>

      {lead.owner && (
        <p className="text-xs text-muted mt-2 truncate">
          Owner: <span className="text-foreground/80">{lead.owner.fullName}</span>
        </p>
      )}

      {nextStage && (
        <button
          onClick={() => onAdvance(lead, nextStage.id)}
          className="text-[11px] text-accent-text hover:brightness-110 mt-2 opacity-0 group-hover:opacity-100 transition"
        >
          Move to {nextStage.label} →
        </button>
      )}
    </div>
  );
}

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('OTHER');
  const [ageGroup, setAgeGroup] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName || !email) return;
    setSaving(true);
    try {
      await api.createLead({
        firstName,
        lastName,
        email: email.toLowerCase(),
        phone: phone || undefined,
        source,
        ageGroup: ageGroup || undefined,
        notes: notes || undefined,
      });
      toast.success(`Lead ${firstName} ${lastName} created`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create lead');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-10 px-4">
      <div className="bg-card border border-border rounded-lg max-w-md w-full p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg uppercase tracking-[0.04em] text-foreground">New lead</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">×</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ppl-label">First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="ppl-input w-full"
                required
              />
            </div>
            <div>
              <label className="ppl-label">Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="ppl-input w-full"
                required
              />
            </div>
          </div>
          <div>
            <label className="ppl-label">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="ppl-input w-full"
              required
            />
          </div>
          <div>
            <label className="ppl-label">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="ppl-input w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ppl-label">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="ppl-input w-full"
              >
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="ppl-label">Age group</label>
              <select
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                className="ppl-input w-full"
              >
                <option value="">—</option>
                <option value="youth">Youth</option>
                <option value="ms_hs">MS / HS</option>
                <option value="college">College</option>
                <option value="pro">Pro</option>
              </select>
            </div>
          </div>
          <div>
            <label className="ppl-label">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="ppl-input w-full"
              rows={3}
              placeholder="Anything worth remembering about this lead…"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="ppl-btn ppl-btn-secondary text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !firstName || !lastName || !email}
              className="ppl-btn ppl-btn-primary text-sm disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Create lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
