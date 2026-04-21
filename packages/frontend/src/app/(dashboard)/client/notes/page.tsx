'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, CoachNote, DigestRecipient } from '@/lib/api';

export default function ClientNotesPage() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<CoachNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('');

  // Digest recipients
  const [recipients, setRecipients] = useState<DigestRecipient[]>([]);
  const [showRecipients, setShowRecipients] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRelation, setNewRelation] = useState('');
  const [addingRecipient, setAddingRecipient] = useState(false);

  const loadNotes = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await api.getAthleteNotes(user.id, {
        category: filter || undefined,
        limit: 100,
      });
      if (res.data) setNotes(res.data);
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, filter]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const loadRecipients = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.getDigestRecipients(user.id);
      if (res.data) setRecipients(res.data);
    } catch (err) {
      console.error('Failed to load recipients:', err);
    }
  }, [user]);

  useEffect(() => { loadRecipients(); }, [loadRecipients]);

  const handleAddRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newEmail.trim()) return;
    setAddingRecipient(true);
    try {
      await api.addDigestRecipient(user.id, {
        email: newEmail.trim(),
        name: newName.trim() || undefined,
        relation: newRelation.trim() || undefined,
      });
      setNewEmail('');
      setNewName('');
      setNewRelation('');
      loadRecipients();
    } catch (err) {
      console.error('Failed to add recipient:', err);
    } finally {
      setAddingRecipient(false);
    }
  };

  const handleRemoveRecipient = async (id: string) => {
    try {
      await api.removeDigestRecipient(id);
      loadRecipients();
    } catch (err) {
      console.error('Failed to remove recipient:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatCategory = (cat: string) =>
    cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

  // Group notes by date for timeline
  const groupedNotes = notes.reduce((acc, note) => {
    const dateKey = new Date(note.sessionDate).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(note);
    return acc;
  }, {} as Record<string, CoachNote[]>);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Training Notes</h1>
          <p className="text-sm text-muted mt-0.5">
            Session notes from your coaches, compiled weekly.
          </p>
        </div>
        <button
          onClick={() => setShowRecipients(!showRecipients)}
          className="ppl-btn ppl-btn-secondary text-sm"
        >
          {showRecipients ? 'Hide' : 'Manage'} Email Recipients
        </button>
      </div>

      {/* Digest Recipients Panel */}
      {showRecipients && (
        <div className="ppl-card">
          <h2 className="text-lg font-semibold text-foreground mb-3">Weekly Email Recipients</h2>
          <p className="text-sm text-muted mb-4">
            Add email addresses to receive your weekly training notes digest (parents, on-field coaches, etc.)
          </p>

          {recipients.length > 0 && (
            <div className="space-y-2 mb-4">
              {recipients.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                  <div>
                    <span className="text-sm font-medium text-foreground">{r.email}</span>
                    {r.name && <span className="text-xs text-muted ml-2">({r.name})</span>}
                    {r.relation && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-highlight/10 text-primary-text ml-2">
                        {r.relation}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveRecipient(r.id)}
                    className="text-xs text-danger hover:text-danger/80"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddRecipient} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email address"
              className="ppl-input flex-1"
              required
            />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name (optional)"
              className="ppl-input w-40"
            />
            <select
              value={newRelation}
              onChange={(e) => setNewRelation(e.target.value)}
              className="ppl-input w-36"
            >
              <option value="">Relation...</option>
              <option value="parent">Parent</option>
              <option value="guardian">Guardian</option>
              <option value="coach">On-field Coach</option>
              <option value="trainer">Trainer</option>
              <option value="other">Other</option>
            </select>
            <button type="submit" disabled={addingRecipient} className="ppl-btn ppl-btn-primary text-sm">
              {addingRecipient ? 'Adding...' : 'Add'}
            </button>
          </form>
        </div>
      )}

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            !filter ? 'bg-primary text-white' : 'bg-surface border border-border text-muted hover:text-foreground'
          }`}
        >
          All
        </button>
        {['PITCHING_MECHANICS', 'VELOCITY_TRAINING', 'ARM_CARE', 'BULLPEN_SESSION', 'VIDEO_REVIEW', 'STRENGTH_CONDITIONING'].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === cat ? 'bg-primary text-white' : 'bg-surface border border-border text-muted hover:text-foreground'
            }`}
          >
            {formatCategory(cat)}
          </button>
        ))}
      </div>

      {/* Notes Timeline */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-lg font-medium text-foreground">No training notes yet</p>
          <p className="text-sm text-muted mt-1">
            Notes from your coaching sessions will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedNotes).map(([date, dayNotes]) => (
            <div key={date}>
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">{date}</h3>
              <div className="space-y-3 relative pl-6 border-l-2 border-highlight/20">
                {dayNotes.map((note) => (
                  <div key={note.id} className="relative">
                    {/* Timeline dot */}
                    <div className="absolute -left-[31px] top-3 w-3 h-3 rounded-full bg-primary border-2 border-background" />

                    <div className="ppl-card">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <span className="text-sm font-semibold text-foreground">
                            Coach {note.coach.fullName}
                          </span>
                          <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-highlight/10 text-primary-text ml-2">
                            {formatCategory(note.trainingCategory)}
                          </span>
                        </div>
                        <span className="text-xs text-muted whitespace-nowrap">
                          {formatDate(note.sessionDate)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">
                        {note.content}
                      </p>
                      {note.booking?.session && (
                        <p className="text-xs text-muted mt-2">
                          Session: {note.booking.session.title}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
