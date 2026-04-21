'use client';

import { useState, useEffect } from 'react';
import { api, OutsideCoachAthlete, OutsideCoachAthleteReport } from '@/lib/api';

/**
 * Outside Coach Dashboard
 * When a user who is also an outside coach logs in, they can view their linked athletes
 * and read-only training notes from PPL sessions.
 */
export default function OutsideCoachDashboardPage() {
  const [athletes, setAthletes] = useState<OutsideCoachAthlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAthlete, setSelectedAthlete] = useState<OutsideCoachAthlete | null>(null);
  const [report, setReport] = useState<OutsideCoachAthleteReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.getOutsideCoachAthletes();
        if (res.data) setAthletes(res.data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load athletes');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const viewAthleteReports = async (athlete: OutsideCoachAthlete) => {
    setSelectedAthlete(athlete);
    setReportLoading(true);
    setReport(null);
    try {
      const res = await api.getOutsideCoachAthleteReports(athlete.athlete.id);
      if (res.data) setReport(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setReportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="ppl-card animate-pulse h-20" />
        <div className="ppl-card animate-pulse h-64" />
      </div>
    );
  }

  if (athletes.length === 0) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Coach Dashboard</h1>
          <p className="text-sm text-muted mt-0.5">View your linked athletes&apos; training progress</p>
        </div>
        <div className="ppl-card text-center py-16">
          <div className="w-20 h-20 rounded-full bg-surface-hover mx-auto mb-4 flex items-center justify-center">
            <svg className="w-10 h-10 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No Athletes Linked</h3>
          <p className="text-sm text-muted max-w-md mx-auto">
            You&apos;ll see athletes here once they add you as their outside coach from their PPL account.
            Ask your athletes to go to My Account &gt; My Coaches and add your email address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Coach Dashboard</h1>
        <p className="text-sm text-muted mt-0.5">
          View training progress for your {athletes.length} linked athlete{athletes.length !== 1 ? 's' : ''}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-danger/10 border border-danger/20 text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Athlete List */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Your Athletes</h2>
          {athletes.map(a => (
            <button
              key={a.linkId}
              onClick={() => viewAthleteReports(a)}
              className={`w-full text-left ppl-card transition-all hover:border-highlight/30 ${
                selectedAthlete?.linkId === a.linkId
                  ? 'border-highlight/50 bg-highlight/5'
                  : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-highlight/10 flex items-center justify-center shrink-0">
                  <span className="text-accent-text font-bold text-lg">
                    {a.athlete.firstName.charAt(0)}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {a.athlete.firstName} {a.athlete.lastName}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {a.athlete.ageGroup && (
                      <span className="text-xs bg-surface-hover px-2 py-0.5 rounded">{a.athlete.ageGroup}</span>
                    )}
                    {a.organization && (
                      <span className="text-xs text-muted truncate">{a.organization}</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Reports Panel */}
        <div className="lg:col-span-2">
          {!selectedAthlete ? (
            <div className="ppl-card text-center py-16">
              <svg className="w-12 h-12 text-muted/40 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="text-muted text-sm">Select an athlete to view their training reports</p>
            </div>
          ) : reportLoading ? (
            <div className="space-y-3">
              <div className="ppl-card animate-pulse h-20" />
              <div className="ppl-card animate-pulse h-40" />
              <div className="ppl-card animate-pulse h-40" />
            </div>
          ) : report ? (
            <div className="space-y-4">
              {/* Athlete Header */}
              <div className="ppl-card">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full ppl-gradient flex items-center justify-center">
                    <span className="text-white text-xl font-bold">
                      {report.athlete.firstName.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">
                      {report.athlete.firstName} {report.athlete.lastName}
                    </h2>
                    <div className="flex items-center gap-3 mt-1">
                      {report.athlete.ageGroup && (
                        <span className="text-xs bg-highlight/10 text-accent-text px-2 py-0.5 rounded">
                          {report.athlete.ageGroup}
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        {report.coachNotes.length} session note{report.coachNotes.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Training Notes */}
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">Training Notes</h3>

              {report.coachNotes.length === 0 ? (
                <div className="ppl-card text-center py-10">
                  <p className="text-muted text-sm">No training notes available yet</p>
                  <p className="text-xs text-muted/60 mt-1">Notes will appear here after PPL coaches log session feedback</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {report.coachNotes.map(note => (
                    <div key={note.id} className="ppl-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{note.coachName}</span>
                          {note.sessionType && (
                            <span className="text-xs bg-surface-hover px-2 py-0.5 rounded">{note.sessionType}</span>
                          )}
                        </div>
                        <span className="text-xs text-muted">
                          {note.sessionDate
                            ? new Date(note.sessionDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })
                            : new Date(note.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/85 whitespace-pre-wrap leading-relaxed">
                        {note.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
