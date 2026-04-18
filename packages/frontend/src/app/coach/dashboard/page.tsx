'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { coachApi, type RosterAthleteStat, type CoachAthleteNote, type Goal, type Program, type AthleteMetricEntry, type TeamSummary, type CoachLoginResult } from '@/lib/api';

type SlidePanel = 'notes' | 'goals' | 'programs' | 'metrics' | null;

export default function CoachDashboard() {
  const router = useRouter();
  const [coach, setCoach] = useState<CoachLoginResult['coach'] | null>(null);
  const [roster, setRoster] = useState<RosterAthleteStat[]>([]);
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Slide-out panel state
  const [activePanel, setActivePanel] = useState<SlidePanel>(null);
  const [selectedAthlete, setSelectedAthlete] = useState<RosterAthleteStat | null>(null);
  const [panelData, setPanelData] = useState<CoachAthleteNote[] | Goal[] | Program[] | AthleteMetricEntry[] | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  // Note form state
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteCategory, setNewNoteCategory] = useState('GENERAL');
  const [noteSubmitting, setNoteSubmitting] = useState(false);

  // Metric form state
  const [newMetricType, setNewMetricType] = useState('FASTBALL_VELO');
  const [newMetricValue, setNewMetricValue] = useState('');
  const [newMetricUnit, setNewMetricUnit] = useState('mph');
  const [newMetricNotes, setNewMetricNotes] = useState('');
  const [metricSubmitting, setMetricSubmitting] = useState(false);

  useEffect(() => {
    const coachData = coachApi.getCoachData();
    if (!coachData) {
      router.replace('/coach/login');
      return;
    }
    setCoach(coachData);
    loadDashboard();
  }, [router]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [rosterRes, summaryRes] = await Promise.all([
        coachApi.getRoster(),
        coachApi.getTeamSummary(),
      ]);
      if (rosterRes.data) setRoster(rosterRes.data);
      if (summaryRes.data) setSummary(summaryRes.data);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('expired')) return;
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const openPanel = useCallback(async (athlete: RosterAthleteStat, panel: SlidePanel) => {
    setSelectedAthlete(athlete);
    setActivePanel(panel);
    setPanelData(null);
    setPanelLoading(true);

    try {
      let res;
      switch (panel) {
        case 'notes':
          res = await coachApi.getAthleteNotes(athlete.userId);
          break;
        case 'goals':
          res = await coachApi.getAthleteGoals(athlete.userId);
          break;
        case 'programs':
          res = await coachApi.getAthletePrograms(athlete.userId);
          break;
        case 'metrics':
          res = await coachApi.getAthleteMetrics(athlete.userId);
          break;
      }
      if (res?.data) setPanelData(res.data);
    } catch {
      setPanelData([]);
    } finally {
      setPanelLoading(false);
    }
  }, []);

  const closePanel = () => {
    setActivePanel(null);
    setSelectedAthlete(null);
    setPanelData(null);
    setNewNoteContent('');
    setNewNoteCategory('GENERAL');
  };

  const submitNote = async () => {
    if (!selectedAthlete || !newNoteContent.trim()) return;
    setNoteSubmitting(true);
    try {
      await coachApi.createAthleteNote(selectedAthlete.userId, {
        content: newNoteContent.trim(),
        category: newNoteCategory,
      });
      setNewNoteContent('');
      // Refresh notes
      const res = await coachApi.getAthleteNotes(selectedAthlete.userId);
      if (res.data) setPanelData(res.data);
      // Update roster counts
      loadDashboard();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setNoteSubmitting(false);
    }
  };

  const submitMetric = async () => {
    if (!selectedAthlete || !newMetricValue) return;
    setMetricSubmitting(true);
    try {
      await coachApi.logAthleteMetric(selectedAthlete.userId, {
        metricType: newMetricType,
        value: parseFloat(newMetricValue),
        unit: newMetricUnit || undefined,
        notes: newMetricNotes || undefined,
      });
      setNewMetricValue('');
      setNewMetricNotes('');
      const res = await coachApi.getAthleteMetrics(selectedAthlete.userId);
      if (res.data) setPanelData(res.data);
      loadDashboard();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to log metric');
    } finally {
      setMetricSubmitting(false);
    }
  };

  const handleLogout = () => {
    coachApi.clearToken();
    router.replace('/coach/login');
  };

  const permissions = coach?.permissions;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-xl max-w-md w-full text-center">
          <p className="font-medium">Something went wrong</p>
          <p className="text-sm mt-1">{error}</p>
          <button onClick={loadDashboard} className="mt-4 text-sm text-red-600 underline hover:text-red-800">Try again</button>
        </div>
      </div>
    );
  }

  const brandColor = coach?.schoolTeam?.brandColors?.primary || '#2563EB';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {coach?.schoolTeam?.brandLogoUrl ? (
                <img src={coach.schoolTeam.brandLogoUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: brandColor }}>
                  {coach?.schoolTeam?.name?.charAt(0) || 'T'}
                </div>
              )}
              <div>
                <h1 className="text-lg font-bold text-gray-900">{coach?.schoolTeam?.name}</h1>
                <p className="text-xs text-gray-500">Coach Portal — {coach?.fullName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 hidden sm:inline">{coach?.title || coach?.role?.replace('_', ' ')}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <SummaryCard label="Athletes" value={summary.totalAthletes} color="blue" />
            <SummaryCard label="Notes (7d)" value={summary.recentNotes} color="green" />
            <SummaryCard label="Metrics (7d)" value={summary.recentMetrics} color="purple" />
            <SummaryCard label="Active Goals" value={summary.activeGoals} color="yellow" />
            <SummaryCard label="Active Programs" value={summary.activePrograms} color="indigo" />
            <SummaryCard label="Need Attention" value={summary.athletesNeedingAttention} color="red" />
          </div>
        )}

        {/* Roster Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-4 sm:px-6 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Team Roster</h2>
            <p className="text-sm text-gray-500 mt-0.5">{roster.length} athletes</p>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Athlete</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Goals</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Program</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Latest Metric</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {roster.map((athlete) => (
                  <tr key={athlete.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ backgroundColor: brandColor }}>
                          {athlete.firstName.charAt(0)}{athlete.lastName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{athlete.firstName} {athlete.lastName}</div>
                          <div className="text-xs text-gray-500">{athlete.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="text-sm text-gray-700">{athlete.stats.noteCount}</span>
                      {athlete.stats.lastNoteDate && (
                        <div className="text-xs text-gray-400">{new Date(athlete.stats.lastNoteDate).toLocaleDateString()}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="text-sm text-gray-700">{athlete.stats.activeGoals}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {athlete.stats.activeProgram ? (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          {athlete.stats.activeProgram}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {athlete.stats.latestMetric ? (
                        <div>
                          <span className="text-sm font-medium text-gray-900">{athlete.stats.latestMetric.value}{athlete.stats.latestMetric.unit && ` ${athlete.stats.latestMetric.unit}`}</span>
                          <div className="text-xs text-gray-400">{athlete.stats.latestMetric.type.replace(/_/g, ' ')}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {permissions?.canTakeNotes && (
                          <ActionButton label="Notes" icon="📝" onClick={() => openPanel(athlete, 'notes')} />
                        )}
                        {permissions?.canViewGoals && (
                          <ActionButton label="Goals" icon="🎯" onClick={() => openPanel(athlete, 'goals')} />
                        )}
                        {permissions?.canViewPrograms && (
                          <ActionButton label="Program" icon="📋" onClick={() => openPanel(athlete, 'programs')} />
                        )}
                        {permissions?.canViewMetrics && (
                          <ActionButton label="Stats" icon="📊" onClick={() => openPanel(athlete, 'metrics')} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100">
            {roster.map((athlete) => (
              <div key={athlete.id} className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ backgroundColor: brandColor }}>
                    {athlete.firstName.charAt(0)}{athlete.lastName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{athlete.firstName} {athlete.lastName}</div>
                    <div className="text-xs text-gray-500">{athlete.stats.noteCount} notes · {athlete.stats.activeGoals} goals</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {permissions?.canTakeNotes && (
                    <ActionButton label="Notes" icon="📝" onClick={() => openPanel(athlete, 'notes')} />
                  )}
                  {permissions?.canViewGoals && (
                    <ActionButton label="Goals" icon="🎯" onClick={() => openPanel(athlete, 'goals')} />
                  )}
                  {permissions?.canViewPrograms && (
                    <ActionButton label="Program" icon="📋" onClick={() => openPanel(athlete, 'programs')} />
                  )}
                  {permissions?.canViewMetrics && (
                    <ActionButton label="Stats" icon="📊" onClick={() => openPanel(athlete, 'metrics')} />
                  )}
                </div>
              </div>
            ))}
          </div>

          {roster.length === 0 && (
            <div className="text-center py-12 px-4">
              <p className="text-gray-500">No athletes on your team roster yet.</p>
              <p className="text-sm text-gray-400 mt-1">Contact PPL to get your roster set up.</p>
            </div>
          )}
        </div>
      </main>

      {/* Slide-out Panel */}
      {activePanel && selectedAthlete && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/30 z-40 transition-opacity" onClick={closePanel} />

          {/* Panel */}
          <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
            {/* Panel Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
              <div>
                <h3 className="font-semibold text-gray-900">{selectedAthlete.firstName} {selectedAthlete.lastName}</h3>
                <p className="text-sm text-gray-500 capitalize">{activePanel}</p>
              </div>
              <button onClick={closePanel} className="p-2 hover:bg-gray-200 rounded-lg transition-colors text-gray-500">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto p-5">
              {panelLoading ? (
                <div className="flex items-center justify-center py-12">
                  <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              ) : (
                <>
                  {/* NOTES PANEL */}
                  {activePanel === 'notes' && (
                    <div className="space-y-4">
                      {/* Add Note Form */}
                      {permissions?.canTakeNotes && (
                        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                          <h4 className="text-sm font-medium text-blue-900 mb-2">Add Note</h4>
                          <select
                            value={newNoteCategory}
                            onChange={(e) => setNewNoteCategory(e.target.value)}
                            className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm mb-2 bg-white"
                          >
                            <option value="GENERAL">General</option>
                            <option value="PITCHING">Pitching</option>
                            <option value="HITTING">Hitting</option>
                            <option value="CONDITIONING">Conditioning</option>
                            <option value="RECOVERY">Recovery</option>
                            <option value="MENTAL">Mental Skills</option>
                            <option value="ASSESSMENT">Assessment</option>
                          </select>
                          <textarea
                            value={newNoteContent}
                            onChange={(e) => setNewNoteContent(e.target.value)}
                            placeholder="Write your note..."
                            rows={3}
                            className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm resize-none bg-white"
                          />
                          <button
                            onClick={submitNote}
                            disabled={noteSubmitting || !newNoteContent.trim()}
                            className="mt-2 w-full bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            {noteSubmitting ? 'Saving...' : 'Save Note'}
                          </button>
                        </div>
                      )}

                      {/* Notes List */}
                      {(panelData as CoachAthleteNote[])?.length === 0 ? (
                        <p className="text-center text-gray-400 py-8 text-sm">No notes yet</p>
                      ) : (
                        (panelData as CoachAthleteNote[])?.map((note) => (
                          <div key={note.id} className="bg-white rounded-lg border border-gray-200 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                                {note.category?.replace(/_/g, ' ')}
                              </span>
                              <span className="text-xs text-gray-400">{new Date(note.createdAt).toLocaleDateString()}</span>
                            </div>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                            <p className="text-xs text-gray-400 mt-2">— {note.coachName}{note.isSchoolCoachNote ? ' (you)' : ''}</p>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* GOALS PANEL */}
                  {activePanel === 'goals' && (
                    <div className="space-y-3">
                      {(panelData as Goal[])?.length === 0 ? (
                        <p className="text-center text-gray-400 py-8 text-sm">No goals set</p>
                      ) : (
                        (panelData as Goal[])?.map((goal) => (
                          <div key={goal.id} className="bg-white rounded-lg border border-gray-200 p-4">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-medium text-gray-900 text-sm">{goal.title}</h4>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                goal.status === 'ACTIVE' ? 'bg-green-50 text-green-700' :
                                goal.status === 'COMPLETED' ? 'bg-blue-50 text-blue-700' :
                                'bg-gray-50 text-gray-600'
                              }`}>
                                {goal.status}
                              </span>
                            </div>
                            {goal.description && <p className="text-sm text-gray-600 mt-1">{goal.description}</p>}
                            <div className="mt-2 flex items-center gap-3">
                              <div className="flex-1 bg-gray-200 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${goal.progress}%` }} />
                              </div>
                              <span className="text-xs text-gray-500">{goal.progress}%</span>
                            </div>
                            {goal.targetDate && (
                              <p className="text-xs text-gray-400 mt-2">Target: {new Date(goal.targetDate).toLocaleDateString()}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* PROGRAMS PANEL */}
                  {activePanel === 'programs' && (
                    <div className="space-y-4">
                      {(panelData as Program[])?.length === 0 ? (
                        <p className="text-center text-gray-400 py-8 text-sm">No programs assigned</p>
                      ) : (
                        (panelData as Program[])?.map((program) => (
                          <div key={program.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                              <div className="flex items-center justify-between">
                                <h4 className="font-medium text-gray-900 text-sm">{program.title}</h4>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                  program.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600'
                                }`}>
                                  {program.status}
                                </span>
                              </div>
                              {program.description && <p className="text-xs text-gray-500 mt-1">{program.description}</p>}
                            </div>
                            {program.weeks?.map((week) => (
                              <div key={week.id} className="border-b border-gray-100 last:border-b-0">
                                <div className="px-4 py-2 bg-gray-50/50">
                                  <span className="text-xs font-medium text-gray-600">Week {week.weekNum}{week.title ? `: ${week.title}` : ''}</span>
                                </div>
                                {week.days?.map((day) => (
                                  <div key={day.id} className="px-4 py-2">
                                    <span className="text-xs font-medium text-gray-700">Day {day.dayNum}{day.title ? ` — ${day.title}` : ''}</span>
                                    {day.exercises?.map((ex) => (
                                      <div key={ex.id} className="ml-3 mt-1 text-xs text-gray-600">
                                        • {ex.exercise?.name || ex.customName}{ex.sets ? ` — ${ex.sets}x${ex.reps || ''}` : ''}{ex.intensity ? ` @ ${ex.intensity}` : ''}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* METRICS PANEL */}
                  {activePanel === 'metrics' && (
                    <div className="space-y-4">
                      {/* Log Metric Form */}
                      {permissions?.canViewMetrics && (
                        <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                          <h4 className="text-sm font-medium text-purple-900 mb-2">Log Metric</h4>
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <select
                              value={newMetricType}
                              onChange={(e) => {
                                setNewMetricType(e.target.value);
                                // Auto-set unit
                                const unitMap: Record<string, string> = {
                                  FASTBALL_VELO: 'mph', CHANGEUP_VELO: 'mph', CURVEBALL_VELO: 'mph',
                                  SLIDER_VELO: 'mph', CUTTER_VELO: 'mph', SPIN_RATE: 'rpm',
                                  COMMAND_SCORE: '/10', MECHANICAL_SCORE: '/10', BODY_WEIGHT: 'lbs',
                                };
                                setNewMetricUnit(unitMap[e.target.value] || '');
                              }}
                              className="rounded-lg border border-purple-200 px-3 py-2 text-sm bg-white"
                            >
                              <option value="FASTBALL_VELO">Fastball Velo</option>
                              <option value="CHANGEUP_VELO">Changeup Velo</option>
                              <option value="CURVEBALL_VELO">Curveball Velo</option>
                              <option value="SLIDER_VELO">Slider Velo</option>
                              <option value="CUTTER_VELO">Cutter Velo</option>
                              <option value="SPIN_RATE">Spin Rate</option>
                              <option value="COMMAND_SCORE">Command (1-10)</option>
                              <option value="MECHANICAL_SCORE">Mechanics (1-10)</option>
                              <option value="BODY_WEIGHT">Body Weight</option>
                              <option value="CUSTOM">Custom</option>
                            </select>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                step="0.1"
                                value={newMetricValue}
                                onChange={(e) => setNewMetricValue(e.target.value)}
                                placeholder="Value"
                                className="w-full rounded-lg border border-purple-200 px-3 py-2 text-sm bg-white"
                              />
                              <input
                                type="text"
                                value={newMetricUnit}
                                onChange={(e) => setNewMetricUnit(e.target.value)}
                                placeholder="Unit"
                                className="w-16 rounded-lg border border-purple-200 px-2 py-2 text-sm bg-white text-center"
                              />
                            </div>
                          </div>
                          <input
                            type="text"
                            value={newMetricNotes}
                            onChange={(e) => setNewMetricNotes(e.target.value)}
                            placeholder="Notes (optional)"
                            className="w-full rounded-lg border border-purple-200 px-3 py-2 text-sm bg-white mb-2"
                          />
                          <button
                            onClick={submitMetric}
                            disabled={metricSubmitting || !newMetricValue}
                            className="w-full bg-purple-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                          >
                            {metricSubmitting ? 'Logging...' : 'Log Metric'}
                          </button>
                        </div>
                      )}

                      {/* Metrics History */}
                      {(panelData as AthleteMetricEntry[])?.length === 0 ? (
                        <p className="text-center text-gray-400 py-8 text-sm">No metrics recorded</p>
                      ) : (
                        <div className="space-y-2">
                          {(panelData as AthleteMetricEntry[])?.map((m) => (
                            <div key={m.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
                              <div>
                                <span className="text-sm font-medium text-gray-900">{m.type.replace(/_/g, ' ')}</span>
                                {m.notes && <p className="text-xs text-gray-500 mt-0.5">{m.notes}</p>}
                                <p className="text-xs text-gray-400 mt-0.5">{new Date(m.sessionDate).toLocaleDateString()} · {m.loggedBy}</p>
                              </div>
                              <div className="text-right">
                                <span className="text-lg font-bold text-gray-900">{m.value}</span>
                                {m.unit && <span className="text-sm text-gray-500 ml-0.5">{m.unit}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    red: 'bg-red-50 text-red-700 border-red-100',
  };

  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color] || colorMap.blue}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-75">{label}</div>
    </div>
  );
}

function ActionButton({ label, icon, onClick }: { label: string; icon: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200 transition-colors"
      title={label}
    >
      <span>{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
