'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ClientDetail } from '@/lib/api';
import { TagPicker } from '@/components/TagPicker';
import { CustomFieldsPanel } from '@/components/CustomFieldsPanel';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400 border border-green-500/20',
  PAST_DUE: 'bg-red-500/10 text-red-400 border border-red-500/20',
  CANCELLED: 'bg-surface text-muted border border-border',
  CONFIRMED: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  COMPLETED: 'bg-green-500/10 text-green-400 border border-green-500/20',
  NO_SHOW: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
};

export default function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [member, setMember] = useState<ClientDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState('');
  const [goals, setGoals] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getMember(id);
      if (res.data) {
        setMember(res.data);
        setNotes(res.data.clientProfile?.notes || '');
        setGoals(res.data.clientProfile?.trainingGoals || '');
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load member' });
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveNotes() {
    try {
      await api.updateClientNotes(id, { notes, trainingGoals: goals });
      setMessage({ type: 'success', text: 'Notes saved.' });
      setIsEditing(false);
      await load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save notes.' });
    }
  }

  async function handleDeactivate() {
    if (!confirm(`Deactivate ${member?.fullName}? This will prevent them from logging in.`)) return;
    try {
      await api.deactivateClient(id);
      setMessage({ type: 'success', text: 'Member deactivated.' });
      await load();
    } catch {
      setMessage({ type: 'error', text: 'Failed to deactivate.' });
    }
  }

  async function handleSendReviewRequest() {
    if (!member) return;
    if (!confirm(`Send a review request email to ${member.fullName}?`)) return;
    try {
      const res = await api.sendReviewRequest(id);
      setMessage({ type: 'success', text: res.message || 'Review request sent.' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to send review request.',
      });
    }
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-surface-hover rounded animate-pulse w-64" />
        <div className="ppl-card animate-pulse h-48" />
        <div className="ppl-card animate-pulse h-32" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="ppl-card text-center py-12">
        <p className="text-muted">Member not found.</p>
        <Link href="/admin/members" className="ppl-btn ppl-btn-secondary mt-4 inline-block">
          Back to Members
        </Link>
      </div>
    );
  }

  const activeMembership = member.clientMemberships.find((m) => m.status === 'ACTIVE' || m.status === 'PAST_DUE');
  const upcomingBookings = member.bookings
    .filter((b) => b.status === 'CONFIRMED' && new Date(b.session.startTime) > new Date())
    .sort((a, b) => new Date(a.session.startTime).getTime() - new Date(b.session.startTime).getTime());
  const pastBookings = member.bookings
    .filter((b) => b.status !== 'CONFIRMED' || new Date(b.session.startTime) <= new Date())
    .sort((a, b) => new Date(b.session.startTime).getTime() - new Date(a.session.startTime).getTime())
    .slice(0, 10);

  return (
    <div>
      {/* Back + Header */}
      <div className="mb-6">
        <Link href="/admin/members" className="text-sm text-muted hover:text-accent-text transition-colors">
          ← Back to Members
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{member.fullName}</h1>
            <p className="text-sm text-muted">{member.email} {member.phone && `Â· ${member.phone}`}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSendReviewRequest}
              className="ppl-btn text-sm bg-highlight/15 text-accent-text border border-highlight/30 hover:bg-highlight/25"
            >
              Send Review Request
            </button>
            <button
              onClick={handleDeactivate}
              className="ppl-btn text-sm bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
            >
              Deactivate
            </button>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Tags */}
      <div className="mb-4">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted mb-2">Tags</p>
        <TagPicker subjectType="user" subjectId={member.id} />
      </div>

      {/* Custom fields */}
      <div className="mb-4">
        <CustomFieldsPanel entityType="USER" entityId={member.id} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column — Profile + Notes */}
        <div className="lg:col-span-1 space-y-4">
          {/* Profile Info */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Profile</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted">Location:</span>{' '}
                <span className="text-foreground">{member.homeLocation?.name || 'Not set'}</span>
              </div>
              <div>
                <span className="text-muted">Age Group:</span>{' '}
                <span className="text-foreground">{member.clientProfile?.ageGroup || 'Not set'}</span>
              </div>
              <div>
                <span className="text-muted">Training:</span>{' '}
                <span className="text-foreground">
                  {member.clientProfile?.trainingPreference
                    ? member.clientProfile.trainingPreference === 'IN_PERSON'
                      ? 'In-Person'
                      : member.clientProfile.trainingPreference === 'REMOTE'
                        ? 'Remote'
                        : 'Hybrid'
                    : 'Not set'}
                </span>
              </div>
              {member.clientProfile?.emergencyContactName && (
                <div>
                  <span className="text-muted">Emergency:</span>{' '}
                  <span className="text-foreground">
                    {member.clientProfile.emergencyContactName}
                    {member.clientProfile.emergencyContactPhone && ` Â· ${member.clientProfile.emergencyContactPhone}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="ppl-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">Coach Notes</h3>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className="text-xs text-accent-text hover:underline"
              >
                {isEditing ? 'Cancel' : 'Edit'}
              </button>
            </div>
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted block mb-1">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="ppl-input w-full text-sm"
                    rows={4}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted block mb-1">Training Goals</label>
                  <textarea
                    value={goals}
                    onChange={(e) => setGoals(e.target.value)}
                    className="ppl-input w-full text-sm"
                    rows={3}
                  />
                </div>
                <button onClick={handleSaveNotes} className="ppl-btn ppl-btn-primary text-sm w-full">
                  Save
                </button>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted mb-0.5">Notes</p>
                  <p className="text-foreground">{member.clientProfile?.notes || 'No notes yet'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted mb-0.5">Training Goals</p>
                  <p className="text-foreground">{member.clientProfile?.trainingGoals || 'Not set'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column — Membership + Bookings + Payments */}
        <div className="lg:col-span-2 space-y-4">
          {/* Membership */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Membership</h3>
            {activeMembership ? (
              <div className="flex items-center justify-between p-3 bg-surface rounded-lg">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{activeMembership.plan.name}</p>
                    <span className={`ppl-badge text-xs ${STATUS_COLORS[activeMembership.status] || ''}`}>
                      {activeMembership.status === 'PAST_DUE' ? 'Past Due' : activeMembership.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    {activeMembership.location.name} Â· Bills on {activeMembership.billingDay.toLowerCase()}s Â· Since {formatDate(activeMembership.startedAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-accent-text">
                    ${(activeMembership.plan.priceCents / 100).toFixed(0)}
                  </p>
                  <p className="text-xs text-muted">/week</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">No active membership</p>
            )}

            {/* Past memberships */}
            {member.clientMemberships.filter((m) => m.status === 'CANCELLED').length > 0 && (
              <div className="mt-3">
                <p className="text-xs text-muted mb-1">Previous Memberships</p>
                {member.clientMemberships
                  .filter((m) => m.status === 'CANCELLED')
                  .map((m) => (
                    <div key={m.id} className="text-sm text-muted flex items-center gap-2 py-1">
                      <span>{m.plan.name}</span>
                      <span className="ppl-badge text-xs bg-surface text-muted border border-border">Cancelled</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Upcoming Bookings */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">
              Upcoming Sessions ({upcomingBookings.length})
            </h3>
            {upcomingBookings.length > 0 ? (
              <div className="space-y-2">
                {upcomingBookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm font-medium text-foreground">{b.session.title}</p>
                      <p className="text-xs text-muted">
                        {formatDate(b.session.startTime)} at {formatTime(b.session.startTime)}
                        {b.session.coach && ` Â· ${b.session.coach.fullName}`}
                        {b.session.room && ` Â· ${b.session.room.name}`}
                      </p>
                    </div>
                    <span className={`ppl-badge text-xs ${STATUS_COLORS[b.status] || ''}`}>
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No upcoming sessions</p>
            )}
          </div>

          {/* Recent Booking History */}
          <div className="ppl-card">
            <h3 className="font-semibold text-foreground mb-3">Recent History</h3>
            {pastBookings.length > 0 ? (
              <div className="space-y-2">
                {pastBookings.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm text-foreground">{b.session.title}</p>
                      <p className="text-xs text-muted">
                        {formatDate(b.session.startTime)} at {formatTime(b.session.startTime)}
                      </p>
                    </div>
                    <span className={`ppl-badge text-xs ${STATUS_COLORS[b.status] || ''}`}>
                      {b.status === 'NO_SHOW' ? 'No Show' : b.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No booking history</p>
            )}
          </div>

          {/* Payment History */}
          {member.payments.length > 0 && (
            <div className="ppl-card">
              <h3 className="font-semibold text-foreground mb-3">Payment History</h3>
              <div className="space-y-2">
                {member.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${p.status === 'SUCCEEDED' ? 'bg-green-400' : 'bg-red-400'}`} />
                      <span className="text-sm text-foreground">${(p.amountCents / 100).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {p.failureReason && <span className="text-xs text-red-400">{p.failureReason}</span>}
                      <span className="text-xs text-muted">{formatDate(p.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
