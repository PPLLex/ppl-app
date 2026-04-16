'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, Program } from '@/lib/api';

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function ClientProgramsPage() {
  const { user } = useAuth();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedWeek, setExpandedWeek] = useState<string | null>(null);

  const loadPrograms = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await api.getAthletePrograms(user.id);
      if (res.data) setPrograms(res.data);
    } catch (err) {
      console.error('Failed to load programs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => { loadPrograms(); }, [loadPrograms]);

  const loadProgramDetail = async (programId: string) => {
    try {
      const res = await api.getProgram(programId);
      if (res.data) {
        setSelectedProgram(res.data);
        // Expand first week by default
        if (res.data.weeks && res.data.weeks.length > 0) {
          setExpandedWeek(res.data.weeks[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load program:', err);
    }
  };

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-500',
    ACTIVE: 'bg-ppl-dark-green/10 text-ppl-dark-green',
    COMPLETED: 'bg-green-500/10 text-green-600',
    ARCHIVED: 'bg-gray-400/10 text-gray-400',
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-10 h-10 border-2 border-ppl-dark-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Detail view
  if (selectedProgram) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedProgram(null)}
            className="ppl-btn ppl-btn-secondary text-sm"
          >
            &larr; Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{selectedProgram.title}</h1>
            <p className="text-sm text-muted">
              By Coach {selectedProgram.coach.fullName}
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${statusColors[selectedProgram.status]}`}>
                {selectedProgram.status}
              </span>
            </p>
          </div>
        </div>

        {selectedProgram.description && (
          <p className="text-sm text-muted">{selectedProgram.description}</p>
        )}

        {/* Weeks accordion */}
        <div className="space-y-3">
          {selectedProgram.weeks?.map((week) => (
            <div key={week.id} className="ppl-card">
              <button
                onClick={() => setExpandedWeek(expandedWeek === week.id ? null : week.id)}
                className="w-full flex items-center justify-between"
              >
                <h3 className="text-base font-semibold text-foreground">
                  {week.title || `Week ${week.weekNum}`}
                </h3>
                <svg
                  className={`w-5 h-5 text-muted transition-transform ${expandedWeek === week.id ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {expandedWeek === week.id && (
                <div className="mt-4 space-y-4">
                  {week.days?.map((day) => (
                    <div key={day.id} className="border border-border rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-foreground mb-1">
                        {day.title || DAY_NAMES[day.dayNum] || `Day ${day.dayNum}`}
                      </h4>
                      {day.notes && (
                        <p className="text-xs text-muted mb-3">{day.notes}</p>
                      )}

                      {day.exercises && day.exercises.length > 0 ? (
                        <div className="space-y-2">
                          {day.exercises.map((ex, idx) => (
                            <div key={ex.id} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-b-0">
                              <span className="text-xs text-muted font-mono w-5">{idx + 1}.</span>
                              <div className="flex-1">
                                <p className="text-sm font-medium text-foreground">
                                  {ex.exercise?.name || ex.customName || 'Exercise'}
                                </p>
                                <div className="flex flex-wrap gap-3 mt-1">
                                  {ex.sets && (
                                    <span className="text-xs text-muted">
                                      <strong>{ex.sets}</strong> sets
                                    </span>
                                  )}
                                  {ex.reps && (
                                    <span className="text-xs text-muted">
                                      <strong>{ex.reps}</strong> reps
                                    </span>
                                  )}
                                  {ex.intensity && (
                                    <span className="text-xs text-ppl-dark-green font-medium">
                                      {ex.intensity}
                                    </span>
                                  )}
                                  {ex.tempo && (
                                    <span className="text-xs text-muted">
                                      Tempo: {ex.tempo}
                                    </span>
                                  )}
                                  {ex.restSeconds && (
                                    <span className="text-xs text-muted">
                                      Rest: {ex.restSeconds}s
                                    </span>
                                  )}
                                </div>
                                {ex.notes && (
                                  <p className="text-xs text-muted mt-1 italic">{ex.notes}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted italic">No exercises yet</p>
                      )}
                    </div>
                  ))}
                  {(!week.days || week.days.length === 0) && (
                    <p className="text-sm text-muted text-center py-4">No days planned for this week yet.</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {(!selectedProgram.weeks || selectedProgram.weeks.length === 0) && (
            <div className="ppl-card text-center py-8">
              <p className="text-muted">Program is being built by your coach. Check back soon!</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Programs</h1>
        <p className="text-sm text-muted mt-0.5">
          Training programs built by your coaches.
        </p>
      </div>

      {programs.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-lg font-medium text-foreground">No programs yet</p>
          <p className="text-sm text-muted mt-1">
            Your coach will create training programs for you here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {programs.map((program) => (
            <button
              key={program.id}
              onClick={() => loadProgramDetail(program.id)}
              className="ppl-card text-left hover:border-ppl-dark-green/30 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-semibold text-foreground">{program.title}</h3>
                  <p className="text-sm text-muted mt-0.5">By Coach {program.coach.fullName}</p>
                  {program.description && (
                    <p className="text-sm text-muted mt-1 line-clamp-2">{program.description}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[program.status]}`}>
                  {program.status}
                </span>
              </div>
              {program.weeks && (
                <p className="text-xs text-muted mt-2">
                  {program.weeks.length} week{program.weeks.length !== 1 ? 's' : ''}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
