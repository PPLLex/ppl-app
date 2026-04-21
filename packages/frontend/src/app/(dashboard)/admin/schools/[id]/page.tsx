'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, SchoolTeamDetail, SchoolInvoice, SchoolContract, SchoolCoach, coachApi } from '@/lib/api';

const INVOICE_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-surface text-muted border border-border',
  SENT: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  PAID: 'bg-green-500/10 text-green-400 border border-green-500/20',
  OVERDUE: 'bg-red-500/10 text-red-400 border border-red-500/20',
  VOID: 'bg-surface text-muted border border-border',
};

const CONTRACT_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-surface text-muted border border-border',
  SENT: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  SIGNED: 'bg-green-500/10 text-green-400 border border-green-500/20',
  EXPIRED: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  VOIDED: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

type Tab = 'overview' | 'roster' | 'coaches' | 'invoices' | 'contracts';

export default function SchoolDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [school, setSchool] = useState<SchoolTeamDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Invoice form
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceDesc, setInvoiceDesc] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');

  // Contract form
  const [showContractForm, setShowContractForm] = useState(false);
  const [contractTitle, setContractTitle] = useState('');
  const [contractTerms, setContractTerms] = useState('');
  const [contractStart, setContractStart] = useState('');
  const [contractEnd, setContractEnd] = useState('');
  const [contractValue, setContractValue] = useState('');

  // Coach form
  const [showCoachForm, setShowCoachForm] = useState(false);
  const [editingCoach, setEditingCoach] = useState<SchoolCoach | null>(null);
  const [coachFullName, setCoachFullName] = useState('');
  const [coachEmail, setCoachEmail] = useState('');
  const [coachPhone2, setCoachPhone2] = useState('');
  const [coachPassword, setCoachPassword] = useState('');
  const [coachRole, setCoachRole] = useState<string>('HEAD_COACH');
  const [coachTitle, setCoachTitle] = useState('');
  const [coachPerms, setCoachPerms] = useState({
    canViewDashboard: true,
    canTakeNotes: true,
    canViewPrograms: true,
    canViewGoals: true,
    canViewMetrics: true,
    canMessageAthletes: false,
    receivesWeeklySummary: true,
    notifyReminders: true,
  });

  function resetCoachForm() {
    setEditingCoach(null);
    setCoachFullName('');
    setCoachEmail('');
    setCoachPhone2('');
    setCoachPassword('');
    setCoachRole('HEAD_COACH');
    setCoachTitle('');
    setCoachPerms({
      canViewDashboard: true,
      canTakeNotes: true,
      canViewPrograms: true,
      canViewGoals: true,
      canViewMetrics: true,
      canMessageAthletes: false,
      receivesWeeklySummary: true,
      notifyReminders: true,
    });
    setShowCoachForm(false);
  }

  function editCoach(c: SchoolCoach) {
    setEditingCoach(c);
    setCoachFullName(c.fullName);
    setCoachEmail(c.email);
    setCoachPhone2(c.phone || '');
    setCoachPassword('');
    setCoachRole(c.role);
    setCoachTitle(c.title || '');
    setCoachPerms({
      canViewDashboard: c.canViewDashboard,
      canTakeNotes: c.canTakeNotes,
      canViewPrograms: c.canViewPrograms,
      canViewGoals: c.canViewGoals,
      canViewMetrics: c.canViewMetrics,
      canMessageAthletes: c.canMessageAthletes,
      receivesWeeklySummary: c.receivesWeeklySummary,
      notifyReminders: c.notifyReminders,
    });
    setShowCoachForm(true);
  }

  async function handleSaveCoach(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload: Record<string, unknown> = {
        fullName: coachFullName,
        email: coachEmail,
        phone: coachPhone2 || null,
        role: coachRole,
        title: coachTitle || null,
        ...coachPerms,
      };

      if (editingCoach) {
        if (coachPassword) payload.password = coachPassword;
        await coachApi.updateSchoolCoach(id, editingCoach.id, payload as Partial<SchoolCoach> & { password?: string });
        setMessage({ type: 'success', text: 'Coach updated' });
      } else {
        if (!coachPassword) { setMessage({ type: 'error', text: 'Password is required for new coaches' }); return; }
        payload.password = coachPassword;
        await coachApi.createSchoolCoach(id, payload as Partial<SchoolCoach> & { password: string });
        setMessage({ type: 'success', text: 'Coach created' });
      }
      resetCoachForm();
      await load();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save coach' });
    }
  }

  async function handleDeactivateCoach(coachId: string) {
    if (!confirm('Deactivate this coach? They will no longer be able to log in.')) return;
    try {
      await coachApi.deactivateSchoolCoach(id, coachId);
      setMessage({ type: 'success', text: 'Coach deactivated' });
      await load();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to deactivate coach' });
    }
  }

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getSchool(id);
      if (res.data) setSchool(res.data);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load school' });
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  async function handleInviteCoach() {
    try {
      const res = await api.inviteCoach(id);
      setMessage({ type: 'success', text: res.message || 'Invite sent!' });
      await load();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send invite' });
    }
  }

  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createSchoolInvoice(id, {
        description: invoiceDesc || null,
        totalCents: Math.round(parseFloat(invoiceAmount) * 100),
        dueDate: invoiceDueDate || null,
        notes: invoiceNotes || null,
      } as Partial<SchoolInvoice>);
      setShowInvoiceForm(false);
      setInvoiceDesc(''); setInvoiceAmount(''); setInvoiceDueDate(''); setInvoiceNotes('');
      setMessage({ type: 'success', text: 'Invoice created' });
      await load();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create invoice' });
    }
  }

  async function handleUpdateInvoiceStatus(invoiceId: string, status: string) {
    try {
      await api.updateSchoolInvoice(id, invoiceId, { status } as Partial<SchoolInvoice>);
      await load();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update invoice' });
    }
  }

  async function handleCreateContract(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createSchoolContract(id, {
        title: contractTitle,
        terms: contractTerms,
        startDate: contractStart,
        endDate: contractEnd,
        totalValueCents: contractValue ? Math.round(parseFloat(contractValue) * 100) : null,
      } as Partial<SchoolContract>);
      setShowContractForm(false);
      setContractTitle(''); setContractTerms(''); setContractStart(''); setContractEnd(''); setContractValue('');
      setMessage({ type: 'success', text: 'Contract created' });
      await load();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to create contract' });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-surface-hover rounded animate-pulse w-64" />
        <div className="ppl-card animate-pulse h-48" />
      </div>
    );
  }

  if (!school) {
    return (
      <div className="ppl-card text-center py-12">
        <p className="text-muted">School not found.</p>
        <Link href="/admin/schools" className="ppl-btn ppl-btn-secondary mt-4 inline-block">Back</Link>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'roster', label: 'Roster', count: school.athletes.length },
    { key: 'coaches', label: 'Coaches', count: school.coaches?.length || 0 },
    { key: 'invoices', label: 'Invoices', count: school.invoices.length },
    { key: 'contracts', label: 'Contracts', count: school.contracts.length },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/schools" className="text-sm text-muted hover:text-accent transition-colors">
          ← Back to Partner Schools
        </Link>
        <div className="flex items-center gap-4 mt-2">
          {school.brandLogoUrl ? (
            <div className="w-14 h-14 rounded-lg overflow-hidden border border-border bg-background flex items-center justify-center">
              <img src={school.brandLogoUrl} alt={school.name} className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div
              className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-xl"
              style={{ backgroundColor: school.brandColors?.primary || '#374151' }}
            >
              {school.name.charAt(0)}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground">{school.name}</h1>
            <p className="text-sm text-muted">
              {school.coachName && `Coach: ${school.coachName}`}
              {school.coachName && school.coachEmail && ' · '}
              {school.coachEmail}
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === 'success'
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-xs text-muted">({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* School Info */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Partnership Info</h3>
            <div className="space-y-2 text-sm">
              <div><span className="text-muted">Status:</span>{' '}<span className="text-foreground">{school.isActive ? 'Active' : 'Inactive'}</span></div>
              <div><span className="text-muted">Location:</span>{' '}<span className="text-foreground">{school.primaryLocation?.name || 'Not set'}</span></div>
              <div><span className="text-muted">Athletes:</span>{' '}<span className="text-foreground">{school.athletes.length}</span></div>
              <div><span className="text-muted">Signup URL:</span>{' '}<span className="text-foreground font-mono text-xs">{school.signupUrl}</span></div>
              {school.totalAnnualBudget && (
                <div><span className="text-muted">Annual Budget:</span>{' '}<span className="text-foreground">{formatMoney(school.totalAnnualBudget)}</span></div>
              )}
            </div>
          </div>

          {/* Coach & Invite */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Coach & Roster</h3>
            <div className="space-y-2 text-sm">
              <div><span className="text-muted">Coach:</span>{' '}<span className="text-foreground">{school.coachName || 'Not set'}</span></div>
              <div><span className="text-muted">Email:</span>{' '}<span className="text-foreground">{school.coachEmail || 'Not set'}</span></div>
              <div><span className="text-muted">Phone:</span>{' '}<span className="text-foreground">{school.coachPhone || 'Not set'}</span></div>
              <div className="flex items-center gap-2">
                <span className="text-muted">Invite Status:</span>
                <span className={`ppl-badge text-xs ${
                  school.coachInviteStatus === 'ACCEPTED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                  school.coachInviteStatus === 'SENT' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                  'bg-surface text-muted border border-border'
                }`}>
                  {school.coachInviteStatus === 'ACCEPTED' ? 'Roster Submitted' :
                   school.coachInviteStatus === 'SENT' ? 'Invite Sent' : 'Not Sent'}
                </span>
              </div>
            </div>
            {school.coachEmail && school.coachInviteStatus !== 'ACCEPTED' && (
              <button
                onClick={handleInviteCoach}
                className="ppl-btn ppl-btn-primary text-sm mt-4 w-full"
              >
                {school.coachInviteStatus === 'SENT' ? 'Resend Invite' : 'Send Roster Invite'}
              </button>
            )}
          </div>

          {/* Billing Contact */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Billing Contact</h3>
            <div className="space-y-2 text-sm">
              <div><span className="text-muted">Name:</span>{' '}<span className="text-foreground">{school.paymentContactName || school.coachName || 'Not set'}</span></div>
              <div><span className="text-muted">Email:</span>{' '}<span className="text-foreground">{school.paymentContactEmail || school.coachEmail || 'Not set'}</span></div>
            </div>
          </div>

          {/* School Branding */}
          <SchoolBrandingCard school={school} onUpdated={load} />

          {/* Quick Stats */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Financials</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-surface rounded-lg text-center">
                <p className="text-xl font-bold text-accent">
                  {formatMoney(school.invoices.filter((i) => i.status === 'PAID').reduce((sum, i) => sum + i.paidCents, 0))}
                </p>
                <p className="text-xs text-muted">Collected</p>
              </div>
              <div className="p-3 bg-surface rounded-lg text-center">
                <p className="text-xl font-bold text-foreground">
                  {formatMoney(school.invoices.filter((i) => i.status === 'SENT' || i.status === 'OVERDUE').reduce((sum, i) => sum + (i.totalCents - i.paidCents), 0))}
                </p>
                <p className="text-xs text-muted">Outstanding</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'roster' && (
        <div className="ppl-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Team Roster ({school.athletes.length})</h3>
          </div>
          {school.athletes.length > 0 ? (
            <div className="space-y-2">
              {school.athletes.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{a.user.fullName}</p>
                    <p className="text-xs text-muted">{a.user.email}{a.user.phone && ` · ${a.user.phone}`}</p>
                  </div>
                  <span className={`ppl-badge text-xs ${a.user.isActive
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-surface text-muted border border-border'
                  }`}>
                    {a.user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-8">
              {school.coachInviteStatus === 'NOT_SENT'
                ? 'Send a roster invite to the coach to get started'
                : school.coachInviteStatus === 'SENT'
                  ? 'Waiting for coach to submit the roster...'
                  : 'No athletes on roster'}
            </p>
          )}
        </div>
      )}

      {tab === 'coaches' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Coach Dashboard Accounts</h3>
            <button onClick={() => { resetCoachForm(); setShowCoachForm(true); }} className="ppl-btn ppl-btn-primary text-sm">
              + Add Coach
            </button>
          </div>

          {showCoachForm && (
            <form onSubmit={handleSaveCoach} className="ppl-card mb-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">{editingCoach ? 'Edit Coach' : 'New Coach Login'}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Full Name *</label>
                  <input type="text" value={coachFullName} onChange={(e) => setCoachFullName(e.target.value)} placeholder="John Smith" className="ppl-input w-full text-sm" required />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Email *</label>
                  <input type="email" value={coachEmail} onChange={(e) => setCoachEmail(e.target.value)} placeholder="coach@school.edu" className="ppl-input w-full text-sm" required />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Phone</label>
                  <input type="tel" value={coachPhone2} onChange={(e) => setCoachPhone2(e.target.value)} placeholder="(555) 123-4567" className="ppl-input w-full text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">{editingCoach ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                  <input type="password" value={coachPassword} onChange={(e) => setCoachPassword(e.target.value)} placeholder={editingCoach ? '••••••••' : 'Min 8 characters'} className="ppl-input w-full text-sm" {...(!editingCoach ? { required: true, minLength: 8 } : {})} />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Role</label>
                  <select value={coachRole} onChange={(e) => setCoachRole(e.target.value)} className="ppl-input w-full text-sm">
                    <option value="HEAD_COACH">Head Coach</option>
                    <option value="ASSISTANT_COACH">Assistant Coach</option>
                    <option value="DIRECTOR">Director</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Title</label>
                  <input type="text" value={coachTitle} onChange={(e) => setCoachTitle(e.target.value)} placeholder="Director of Pitching" className="ppl-input w-full text-sm" />
                </div>
              </div>

              {/* Permissions */}
              <div>
                <label className="text-xs text-muted block mb-2">Permissions</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    ['canViewDashboard', 'View Dashboard'],
                    ['canTakeNotes', 'Take Notes'],
                    ['canViewPrograms', 'View Programs'],
                    ['canViewGoals', 'View Goals'],
                    ['canViewMetrics', 'View/Log Metrics'],
                    ['canMessageAthletes', 'Message Athletes'],
                    ['receivesWeeklySummary', 'Weekly Summary Email'],
                    ['notifyReminders', 'Note Reminders'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={coachPerms[key]}
                        onChange={(e) => setCoachPerms({ ...coachPerms, [key]: e.target.checked })}
                        className="rounded border-border text-accent focus:ring-accent"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button type="submit" className="ppl-btn ppl-btn-primary text-sm">{editingCoach ? 'Save Changes' : 'Create Coach'}</button>
                <button type="button" onClick={resetCoachForm} className="ppl-btn ppl-btn-secondary text-sm">Cancel</button>
              </div>
            </form>
          )}

          {(school.coaches?.length || 0) > 0 ? (
            <div className="space-y-2">
              {school.coaches.map((c) => (
                <div key={c.id} className="ppl-card flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{c.fullName}</p>
                      <span className="ppl-badge text-xs bg-surface text-muted border border-border">{c.role.replace('_', ' ')}</span>
                      {c.title && <span className="text-xs text-muted">· {c.title}</span>}
                      {!c.isActive && (
                        <span className="ppl-badge text-xs bg-red-500/10 text-red-400 border border-red-500/20">Deactivated</span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-0.5">{c.email}{c.phone ? ` · ${c.phone}` : ''}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {c.canTakeNotes && <PermBadge label="Notes" />}
                      {c.canViewPrograms && <PermBadge label="Programs" />}
                      {c.canViewGoals && <PermBadge label="Goals" />}
                      {c.canViewMetrics && <PermBadge label="Metrics" />}
                      {c.canMessageAthletes && <PermBadge label="Messages" />}
                      {c.receivesWeeklySummary && <PermBadge label="Weekly Email" />}
                    </div>
                    {c.lastLoginAt && (
                      <p className="text-xs text-muted mt-1">Last login: {formatDate(c.lastLoginAt)}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => editCoach(c)} className="ppl-btn text-xs ppl-btn-secondary">Edit</button>
                    {c.isActive && (
                      <button onClick={() => handleDeactivateCoach(c.id)} className="ppl-btn text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20">Deactivate</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ppl-card text-center py-8">
              <p className="text-sm text-muted">No coach accounts yet</p>
              <p className="text-xs text-muted mt-1">Add coaches to give them access to the team dashboard portal</p>
            </div>
          )}
        </div>
      )}

      {tab === 'invoices' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Invoices</h3>
            <button onClick={() => setShowInvoiceForm(!showInvoiceForm)} className="ppl-btn ppl-btn-primary text-sm">
              + New Invoice
            </button>
          </div>

          {showInvoiceForm && (
            <form onSubmit={handleCreateInvoice} className="ppl-card mb-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Description</label>
                  <input type="text" value={invoiceDesc} onChange={(e) => setInvoiceDesc(e.target.value)} placeholder="Fall 2026 Remote Programming" className="ppl-input w-full text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Amount ($) *</label>
                  <input type="number" step="0.01" min="0" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} placeholder="2500.00" className="ppl-input w-full text-sm" required />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Due Date</label>
                  <input type="date" value={invoiceDueDate} onChange={(e) => setInvoiceDueDate(e.target.value)} className="ppl-input w-full text-sm" />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Notes</label>
                  <input type="text" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} placeholder="Optional notes" className="ppl-input w-full text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="ppl-btn ppl-btn-primary text-sm">Create Invoice</button>
                <button type="button" onClick={() => setShowInvoiceForm(false)} className="ppl-btn ppl-btn-secondary text-sm">Cancel</button>
              </div>
            </form>
          )}

          {school.invoices.length > 0 ? (
            <div className="space-y-2">
              {school.invoices.map((inv) => (
                <div key={inv.id} className="ppl-card flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{formatMoney(inv.totalCents)}</p>
                      <span className={`ppl-badge text-xs ${INVOICE_STATUS_COLORS[inv.status] || ''}`}>{inv.status}</span>
                    </div>
                    <p className="text-xs text-muted">
                      {inv.description || 'No description'}
                      {inv.dueDate && ` · Due ${formatDate(inv.dueDate)}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {inv.status === 'DRAFT' && (
                      <button onClick={() => handleUpdateInvoiceStatus(inv.id, 'SENT')} className="ppl-btn text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">Send</button>
                    )}
                    {inv.status === 'SENT' && (
                      <button onClick={() => handleUpdateInvoiceStatus(inv.id, 'PAID')} className="ppl-btn text-xs bg-green-500/10 text-green-400 border border-green-500/20">Mark Paid</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ppl-card text-center py-8">
              <p className="text-sm text-muted">No invoices yet</p>
            </div>
          )}
        </div>
      )}

      {tab === 'contracts' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Contracts</h3>
            <button onClick={() => setShowContractForm(!showContractForm)} className="ppl-btn ppl-btn-primary text-sm">
              + New Contract
            </button>
          </div>

          {showContractForm && (
            <form onSubmit={handleCreateContract} className="ppl-card mb-4 space-y-3">
              <div>
                <label className="text-xs text-muted block mb-1">Contract Title *</label>
                <input type="text" value={contractTitle} onChange={(e) => setContractTitle(e.target.value)} placeholder="PPL Remote Training Agreement — Fall 2026" className="ppl-input w-full text-sm" required />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Terms & Conditions *</label>
                <textarea value={contractTerms} onChange={(e) => setContractTerms(e.target.value)} placeholder="Enter the full contract terms, payment schedule, deliverables..." className="ppl-input w-full text-sm" rows={6} required />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Start Date *</label>
                  <input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} className="ppl-input w-full text-sm" required />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">End Date *</label>
                  <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} className="ppl-input w-full text-sm" required />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Total Value ($)</label>
                  <input type="number" step="0.01" min="0" value={contractValue} onChange={(e) => setContractValue(e.target.value)} placeholder="5000.00" className="ppl-input w-full text-sm" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="ppl-btn ppl-btn-primary text-sm">Create Contract</button>
                <button type="button" onClick={() => setShowContractForm(false)} className="ppl-btn ppl-btn-secondary text-sm">Cancel</button>
              </div>
            </form>
          )}

          {school.contracts.length > 0 ? (
            <div className="space-y-2">
              {school.contracts.map((c) => (
                <div key={c.id} className="ppl-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{c.title}</p>
                        <span className={`ppl-badge text-xs ${CONTRACT_STATUS_COLORS[c.status] || ''}`}>{c.status}</span>
                      </div>
                      <p className="text-xs text-muted">
                        {formatDate(c.startDate)} — {formatDate(c.endDate)}
                        {c.totalValueCents && ` · ${formatMoney(c.totalValueCents)}`}
                      </p>
                      {c.signedByName && (
                        <p className="text-xs text-green-400 mt-1">Signed by {c.signedByName} on {formatDate(c.signedAt!)}</p>
                      )}
                    </div>
                    {c.status === 'DRAFT' && (
                      <button
                        onClick={async () => {
                          try {
                            await api.updateSchoolContract(id, c.id, { status: 'SENT' } as Partial<SchoolContract>);
                            await load();
                          } catch { /* ignore */ }
                        }}
                        className="ppl-btn text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      >
                        Send for Signing
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ppl-card text-center py-8">
              <p className="text-sm text-muted">No contracts yet</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PermBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400 border border-green-500/20">
      {label}
    </span>
  );
}

/* ─── School Branding Card ─── */
function SchoolBrandingCard({ school, onUpdated }: { school: SchoolTeamDetail; onUpdated: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMsg('Logo must be under 2MB');
      return;
    }
    setUploading(true);
    setMsg('');
    try {
      await api.uploadSchoolLogo(school.id, file);
      setMsg('Logo uploaded!');
      onUpdated();
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      await api.removeSchoolLogo(school.id);
      setMsg('Logo removed');
      onUpdated();
      setTimeout(() => setMsg(''), 2000);
    } catch {
      setMsg('Failed to remove');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="ppl-card">
      <h3 className="font-semibold text-foreground mb-3">Team Branding</h3>
      <div className="flex items-center gap-4">
        {school.brandLogoUrl ? (
          <div className="relative group">
            <div className="w-16 h-16 rounded-lg bg-background border border-border flex items-center justify-center overflow-hidden">
              <img src={school.brandLogoUrl} alt={school.name} className="max-w-full max-h-full object-contain" />
            </div>
            <button
              onClick={handleRemove}
              disabled={uploading}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove logo"
            >
              &times;
            </button>
          </div>
        ) : (
          <div
            className="w-16 h-16 rounded-lg flex items-center justify-center text-white font-bold text-xl"
            style={{ backgroundColor: school.brandColors?.primary || '#374151' }}
          >
            {school.name.charAt(0)}
          </div>
        )}
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            onChange={handleUpload}
            className="hidden"
            id={`school-logo-${school.id}`}
          />
          <label
            htmlFor={`school-logo-${school.id}`}
            className={`ppl-btn ppl-btn-secondary text-xs cursor-pointer inline-block ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {uploading ? 'Uploading...' : school.brandLogoUrl ? 'Change Logo' : 'Upload Logo'}
          </label>
          <p className="text-[10px] text-muted mt-1">PNG, JPG, WebP, SVG, or GIF. Max 2MB.</p>
          {msg && <p className={`text-xs mt-1 ${msg.includes('fail') || msg.includes('must') ? 'text-red-400' : 'text-accent'}`}>{msg}</p>}
        </div>
      </div>
      {school.brandColors && (
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full border border-border" style={{ backgroundColor: school.brandColors.primary }} />
            <span className="text-xs text-muted">Primary</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full border border-border" style={{ backgroundColor: school.brandColors.secondary }} />
            <span className="text-xs text-muted">Secondary</span>
          </div>
        </div>
      )}
    </div>
  );
}
