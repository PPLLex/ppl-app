'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, SchoolTeamDetail, SchoolInvoice, SchoolContract } from '@/lib/api';

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

type Tab = 'overview' | 'roster' | 'invoices' | 'contracts';

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
    { key: 'invoices', label: 'Invoices', count: school.invoices.length },
    { key: 'contracts', label: 'Contracts', count: school.contracts.length },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/schools" className="text-sm text-muted hover:text-ppl-light-green transition-colors">
          ← Back to Partner Schools
        </Link>
        <div className="flex items-center gap-4 mt-2">
          <div
            className="w-14 h-14 rounded-lg flex items-center justify-center text-white font-bold text-xl"
            style={{ backgroundColor: school.brandColors?.primary || '#374151' }}
          >
            {school.name.charAt(0)}
          </div>
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
              <div><span className="text-muted">Ath
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
