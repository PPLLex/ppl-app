'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, ClientListItem, CoachNote, TrainingCategoryOption } from '@/lib/api';

export default function StaffNotesPage() {
  // Athlete selection
  const [athletes, setAthletes] = useState<ClientListItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedAthleteId, setSelectedAthleteId] = useState('');
  const [selectedAthleteName, setSelectedAthleteName] = useState('');

  // Note form
  const [categories, setCategories] = useState<TrainingCategoryOption[]>([]);
  const [trainingCategory, setTrainingCategory] = useState('');
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');

  // Recent notes (my notes)
  const [recentNotes, setRecentNotes] = useState<CoachNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  // Load categories once
  useEffect(() => {
    api.getTrainingCategories().then((res) => {
      if (res.data) setCategories(res.data);
    });
  }, []);

  // Load athletes
  const loadAthletes = useCallback(async () => {
    try {
      const res = await api.getMembers({ search: search || undefined });
      if (res.data) setAthletes(res.data);
    } catch (err) {
      console.error('Failed to load athletes:', err);
    }
  }, [search]);

  useEffect(() => {
    const timeout = setTimeout(loadAthletes, 300);
    return () => clearTimeout(timeout);
  }, [loadAthletes]);

  // Load my recent notes
  const loadRecentNotes = useCallback(async () => {
    setLoadingNotes(true);
    try {
      const res = await api.getMyCoachNotes({ limit: 20 });
      if (res.data) setRecentNotes(res.data);
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setLoadingNotes(false);
    }
  }, []);

  useEffect(() => {
    loadRecentNotes();
  }, [loadRecentNotes]);

  const selectAthlete = (athlete: ClientListItem) => {
    setSelectedAthleteId(athlete.id);
    setSelectedAthleteName(athlete.fullName);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!selectedAthleteId) {
      setError('Please select an athlete first');
      return;
    }
    if (!trainingCategory) {
      setError('Please select a training category');
      return;
    }
    if (!content.trim()) {
      setError('Please enter your notes');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.createCoachNote({
        athleteId: selectedAthleteId,
        trainingCategory,
        content: content.trim(),
      });
      setSuccessMsg(`Note saved for ${selectedAthleteName}`);
      setContent('');
      setTrainingCategory('');
      // Refresh recent notes
      loadRecentNotes();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save note';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatCategory = (cat: string) => {
    return cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Session Notes</h1>
        <p className="text-sm text-muted mt-0.5">
          Write training notes for your athletes. Notes are compiled and sent weekly.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left â Note Form */}
        <div className="ppl-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">New Note</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="mb-4 p-3 rounded-lg bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-dark-green text-sm">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Athlete Search & Select */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Athlete
              </label>
              {selectedAthleteId ? (
                <div className="flex items-center justify-between p-3 rounded-lg border border-ppl-dark-green bg-ppl-dark-green/10">
                  <span className="font-medium text-foreground">{selectedAthleteName}</span>
                  <button
                    type="button"
                    onClick={() => { setSelectedAthleteId(''); setSelectedAthleteName(''); }}
                    className="text-sm text-muted hover:text-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search athletes..."
                    className="ppl-input"
                  />
                  {athletes.length > 0 && (
                    <div className="max-h-48 overflow-y-auto border border-border rounded-lg">
                      {athletes.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => selectAthlete(a)}
                          className="w-full text-left px-3 py-2 hover:bg-surface-hover border-b border-border last:border-b-0 transition-colors"
                        >
                          <span className="text-sm font-medium text-foreground">{a.fullName}</span>
                          {a.ageGroup && (
                            <span className="text-xs text-muted ml-2">
                              {a.ageGroup === 'college' ? 'College' : a.ageGroup === 'ms_hs' ? 'MS/HS' : 'Youth'}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Training Category */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Training Category
              </label>
              <select
                value={trainingCategory}
                onChange={(e) => setTrainingCategory(e.target.value)}
                className="ppl-input"
              >
                <option value="">Select category...</option>
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Note Content */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Notes
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What did you work on? How did they perform? Any recommendations..."
                rows={5}
                className="ppl-input resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="ppl-btn ppl-btn-primary w-full py-3 text-base"
            >
              {isSubmitting ? 'Saving...' : 'Save Note'}
            </button>
          </form>
        </div>

        {/* Right â Recent Notes */}
        <div className="ppl-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Recent Notes</h2>

          {loadingNotes ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-8 h-8 border-2 border-ppl-dark-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : recentNotes.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">
              No notes yet. Start by writing your first session note!
            </p>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {recentNotes.map((note) => (
                <div
                  key={note.id}
                  className="p-3 rounded-lg border border-border hover:border-border-light transition-colors"
                >
                  <div className="flex items-start justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">
                      {note.athlete?.fullName || 'Unknown Athlete'}
                    </span>
                    <span className="text-xs text-muted whitespace-nowrap ml-2">
                      {formatDate(note.sessionDate)}
                    </span>
                  </div>
                  <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-ppl-dark-green/10 text-ppl-dark-green mb-2">
                    {formatCategory(note.trainingCategory)}
                  </span>
                  <p className="text-sm text-muted leading-relaxed">
                    {note.cleanedContent || note.rawContent}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
