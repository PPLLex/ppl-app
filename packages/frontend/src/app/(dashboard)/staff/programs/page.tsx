'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, ClientListItem, Program, ExerciseLibraryItem } from '@/lib/api';

export default function StaffProgramsPage() {
  const [athletes, setAthletes] = useState<ClientListItem[]>([]);
  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [exerciseLibrary, setExerciseLibrary] = useState<ExerciseLibraryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Create program form
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAthleteId, setNewAthleteId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add exercise form
  const [addingTo, setAddingTo] = useState<string | null>(null); // dayId
  const [exLibraryId, setExLibraryId] = useState('');
  const [exCustomName, setExCustomName] = useState('');
  const [exSets, setExSets] = useState('');
  const [exReps, setExReps] = useState('');
  const [exIntensity, setExIntensity] = useState('');
  const [exNotes, setExNotes] = useState('');
  const [savingEx, setSavingEx] = useState(false);

  // Load exercise library
  useEffect(() => {
    api.getExerciseLibrary().then((res) => {
      if (res.data) setExerciseLibrary(res.data);
    });
  }, []);

  // Load athletes
  const loadAthletes = useCallback(async () => {
    try {
      const res = await api.getMembers({ search: search || undefined });
      if (res.data) setAthletes(res.data);
    } catch (err) {
      console.error(err);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(loadAthletes, 300);
    return () => clearTimeout(t);
  }, [loadAthletes]);

  const loadAthletePrograms = async (athleteId: string) => {
    setIsLoading(true);
    try {
      const res = await api.getAthletePrograms(athleteId);
      if (res.data) setPrograms(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProgram = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!newAthleteId || !newTitle.trim()) {
      setError('Select an athlete and enter a title');
      return;
    }
    setCreating(true);
    try {
      const res = await api.createProgram({
        athleteId: newAthleteId,
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
      });
      if (res.data) {
        setSuccess('Program created!');
        setShowCreate(false);
        setNewTitle('');
        setNewDesc('');
        loadAthletePrograms(newAthleteId);
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create program');
    } finally {
      setCreating(false);
    }
  };

  const handleAddWeek = async (programId: string) => {
    try {
      await api.addProgramWeek(programId);
      // Reload program detail
      const res = await api.getProgram(programId);
      if (res.data) setSelectedProgram(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddDay = async (weekId: string, dayNum: number) => {
    try {
      await api.addProgramDay(weekId, { dayNum });
      if (selectedProgram) {
        const res = await api.getProgram(selectedProgram.id);
        if (res.data) setSelectedProgram(res.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddExercise = async (dayId: string) => {
    setSavingEx(true);
    try {
      await api.addProgramExercise(dayId, {
        exerciseId: exLibraryId || undefined,
        customName: !exLibraryId ? exCustomName.trim() : undefined,
        sets: exSets ? parseInt(exSets) : undefined,
        reps: exReps || undefined,
        intensity: exIntensity || undefined,
        notes: exNotes || undefined,
      });
      // Reset form
      setExLibraryId('');
      setExCustomName('');
      setExSets('');
      setExReps('');
      setExIntensity('');
      setExNotes('');
      setAddingTo(null);
      // Reload program
      if (selectedProgram) {
        const res = await api.getProgram(selectedProgram.id);
        if (res.data) setSelectedProgram(res.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingEx(false);
    }
  };

  const handleActivateProgram = async (programId: string) => {
    try {
      await api.updateProgram(programId, { status: 'ACTIVE' });
      if (selectedProgram) {
        const res = await api.getProgram(programId);
        if (res.data) setSelectedProgram(res.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadDetail = async (programId: string) => {
    try {
      const res = await api.getProgram(programId);
      if (res.data) setSelectedProgram(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  // Exercise library grouped by category
  const exercisesByCategory = exerciseLibrary.reduce((acc, ex) => {
    if (!acc[ex.category]) acc[ex.category] = [];
    acc[ex.category].push(ex);
    return acc;
  }, {} as Record<string, ExerciseLibraryItem[]>);

  // Detail view
  if (selectedProgram) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedProgram(null)} className="ppl-btn ppl-btn-secondary text-sm">
              &larr; Back
            </button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{selectedProgram.title}</h1>
              <p className="text-sm text-muted">
                For {selectedProgram.athlete?.fullName}
                <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                  selectedProgram.status === 'ACTIVE' ? 'bg-ppl-dark-green/10 text-ppl-dark-green' :
                  selectedProgram.status === 'DRAFT' ? 'bg-yellow-500/10 text-yellow-600' :
                  'bg-gray-500/10 text-gray-500'
                }`}>{selectedProgram.status}</span>
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {selectedProgram.status === 'DRAFT' && (
              <button onClick={() => handleActivateProgram(selectedProgram.id)} className="ppl-btn ppl-btn-primary text-sm">
                Activate
              </button>
            )}
            <button onClick={() => handleAddWeek(selectedProgram.id)} className="ppl-btn ppl-btn-secondary text-sm">
              + Week
            </button>
          </div>
        </div>

        {/* Weeks */}
        <div className="space-y-4">
          {selectedProgram.weeks?.map((week) => (
            <div key={week.id} className="ppl-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-foreground">
                  {week.title || `Week ${week.weekNum}`}
                </h3>
                <div className="flex gap-1">
                  {[1,2,3,4,5,6,7].filter((d) => !week.days?.some((day) => day.dayNum === d)).map((d) => (
                    <button
                      key={d}
                      onClick={() => handleAddDay(week.id, d)}
                      className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-foreground hover:border-ppl-dark-green"
                      title={`Add ${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]}`}
                    >
                      +{['', 'M', 'T', 'W', 'Th', 'F', 'Sa', 'Su'][d]}
                    </button>
                  ))}
                </div>
              </div>

              {week.days?.map((day) => (
                <div key={day.id} className="mb-3 p-3 border border-border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-foreground">
                      {day.title || ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day.dayNum]}
                    </h4>
                    <button
                      onClick={() => setAddingTo(addingTo === day.id ? null : day.id)}
                      className="text-xs ppl-btn ppl-btn-secondary"
                    >
                      + Exercise
                    </button>
                  </div>

                  {/* Exercises list */}
                  {day.exercises?.map((ex, idx) => (
                    <div key={ex.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-b-0 text-sm">
                      <span className="text-xs text-muted w-5">{idx + 1}.</span>
                      <span className="font-medium text-foreground flex-1">
                        {ex.exercise?.name || ex.customName}
                      </span>
                      {ex.sets && <span className="text-xs text-muted">{ex.sets}Ã{ex.reps || '?'}</span>}
                      {ex.intensity && <span className="text-xs text-ppl-dark-green">{ex.intensity}</span>}
                    </div>
                  ))}

                  {/* Add exercise form */}
                  {addingTo === day.id && (
                    <div className="mt-3 p-3 bg-surface rounded-lg border border-border space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">Exercise</label>
                        <select
                          value={exLibraryId}
                          onChange={(e) => { setExLibraryId(e.target.value); setExCustomName(''); }}
                          className="ppl-input text-sm"
                        >
                          <option value="">Custom exercise...</option>
                          {Object.entries(exercisesByCategory).map(([cat, exercises]) => (
                            <optgroup key={cat} label={cat.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}>
                              {exercises.map((ex) => (
                                <option key={ex.id} value={ex.id}>{ex.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {!exLibraryId && (
                          <input
                            type="text"
                            value={exCustomName}
                            onChange={(e) => setExCustomName(e.target.value)}
                            placeholder="Custom exercise name"
                            className="ppl-input text-sm mt-1"
                          />
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-xs text-muted mb-0.5">Sets</label>
                          <input type="number" value={exSets} onChange={(e) => setExSets(e.target.value)} className="ppl-input text-sm" placeholder="3" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-0.5">Reps</label>
                          <input type="text" value={exReps} onChange={(e) => setExReps(e.target.value)} className="ppl-input text-sm" placeholder="8-12" />
                        </div>
                        <div>
                          <label className="block text-xs text-muted mb-0.5">Intensity</label>
                          <input type="text" value={exIntensity} onChange={(e) => setExIntensity(e.target.value)} className="ppl-input text-sm" placeholder="RPE 7" />
                        </div>
                      </div>
                      <input type="text" value={exNotes} onChange={(e) => setExNotes(e.target.value)} placeholder="Coach notes (optional)" className="ppl-input text-sm" />
                      <div className="flex gap-2">
                        <button onClick={() => handleAddExercise(day.id)} disabled={savingEx} className="ppl-btn ppl-btn-primary text-sm flex-1">
                          {savingEx ? 'Adding...' : 'Add'}
                        </button>
                        <button onClick={() => setAddingTo(null)} className="ppl-btn ppl-btn-secondary text-sm">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {(!selectedProgram.weeks || selectedProgram.weeks.length === 0) && (
            <div className="ppl-card text-center py-8">
              <p className="text-muted mb-3">No weeks yet. Add your first week to start building the program.</p>
              <button onClick={() => handleAddWeek(selectedProgram.id)} className="ppl-btn ppl-btn-primary text-sm">
                + Add Week 1
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Programs</h1>
          <p className="text-sm text-muted mt-0.5">Build training programs for your athletes.</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="ppl-btn ppl-btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ New Program'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-dark-green text-sm">{success}</div>
      )}

      {/* Create program form */}
      {showCreate && (
        <div className="ppl-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">New Program</h2>
          <form onSubmit={handleCreateProgram} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Athlete</label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search athletes..."
                className="ppl-input"
              />
              {search && athletes.length > 0 && !newAthleteId && (
                <div className="mt-1 max-h-32 overflow-y-auto border border-border rounded-lg">
                  {athletes.map((a) => (
                    <button key={a.id} type="button" onClick={() => { setNewAthleteId(a.id); setSearch(a.fullName); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-hover border-b border-border last:border-b-0">
                      {a.fullName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Program Title</label>
              <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g., Off-Season Arm Care Program" className="ppl-input" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Description (optional)</label>
              <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Program overview..." rows={3} className="ppl-input resize-none" />
            </div>
            <button type="submit" disabled={creating} className="ppl-btn ppl-btn-primary w-full py-3">
              {creating ? 'Creating...' : 'Create Program'}
            </button>
          </form>
        </div>
      )}

      {/* Recent programs by athlete */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Select an Athlete</h2>
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setNewAthleteId(''); }}
          placeholder="Search athletes to view their programs..."
          className="ppl-input mb-3"
        />
        <div className="grid gap-2 max-h-64 overflow-y-auto">
          {athletes.map((a) => (
            <button
              key={a.id}
              onClick={() => { setNewAthleteId(a.id); loadAthletePrograms(a.id); }}
              className={`text-left px-4 py-3 rounded-lg border transition-colors ${
                newAthleteId === a.id ? 'border-ppl-dark-green bg-ppl-dark-green/10' : 'border-border hover:border-border-light'
              }`}
            >
              <span className="text-sm font-medium text-foreground">{a.fullName}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Programs list for selected athlete */}
      {newAthleteId && (
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-ppl-dark-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : programs.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">No programs for this athlete yet.</p>
          ) : (
            <div className="space-y-3">
              {programs.map((p) => (
                <button key={p.id} onClick={() => loadDetail(p.id)} className="w-full ppl-card text-left hover:border-ppl-dark-green/30 transition-colors">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{p.title}</h3>
                      {p.description && <p className="text-sm text-muted mt-0.5 line-clamp-1">{p.description}</p>}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      p.status === 'ACTIVE' ? 'bg-ppl-dark-green/10 text-ppl-dark-green' :
                      p.status === 'DRAFT' ? 'bg-yellow-500/10 text-yellow-600' :
                      'bg-gray-500/10 text-gray-500'
                    }`}>{p.status}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
