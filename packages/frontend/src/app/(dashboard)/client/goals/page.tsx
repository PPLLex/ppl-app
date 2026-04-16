'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api, Goal } from '@/lib/api';

export default function ClientGoalsPage() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

  // New goal form
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'SHORT_TERM' | 'LONG_TERM'>('SHORT_TERM');
  const [targetDate, setTargetDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadGoals = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await api.getAthleteGoals(user.id, {
        status: filter || undefined,
      });
      if (res.data) setGoals(res.data);
    } catch (err) {
      console.error('Failed to load goals:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user, filter]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) {
      setError('Goal title is required');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.createGoal({
        type,
        title: title.trim(),
        description: description.trim() || undefined,
        targetDate: targetDate || undefined,
      });
      setTitle('');
      setDescription('');
      setTargetDate('');
      setShowForm(false);
      loadGoals();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create goal';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateProgress = async (goalId: string, progress: number) => {
    try {
      const status = progress >= 100 ? 'COMPLETED' : undefined;
      await api.updateGoal(goalId, { progress, status });
      loadGoals();
    } catch (err) {
      console.error('Failed to update goal:', err);
    }
  };

  const handleAbandon = async (goalId: string) => {
    try {
      await api.updateGoal(goalId, { status: 'ABANDONED' });
      loadGoals();
    } catch (err) {
      console.error('Failed to abandon goal:', err);
    }
  };

  const activeGoals = goals.filter((g) => g.status === 'ACTIVE');
  const completedGoals = goals.filter((g) => g.status === 'COMPLETED');
  const abandonedGoals = goals.filter((g) => g.status === 'ABANDONED');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Goals</h1>
          <p className="text-sm text-muted mt-0.5">
            Track your short and long-term training goals.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="ppl-btn ppl-btn-primary text-sm"
        >
          {showForm ? 'Cancel' : '+ New Goal'}
        </button>
      </div>

      {/* New Goal Form */}
      {showForm && (
        <div className="ppl-card">
          <h2 className="text-lg font-semibold text-foreground mb-4">Set a New Goal</h2>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleCreateGoal} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Goal Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Hit 85 mph fastball"
                  className="ppl-input"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setType('SHORT_TERM')}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      type === 'SHORT_TERM'
                        ? 'border-ppl-dark-green bg-ppl-dark-green/10 text-ppl-dark-green'
                        : 'border-border text-muted hover:text-foreground'
                    }`}
                  >
                    Short Term
                  </button>
                  <button
                    type="button"
                    onClick={() => setType('LONG_TERM')}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      type === 'LONG_TERM'
                        ? 'border-ppl-dark-green bg-ppl-dark-green/10 text-ppl-dark-green'
                        : 'border-border text-muted hover:text-foreground'
                    }`}
                  >
                    Long Term
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does success look like?"
                rows={3}
                className="ppl-input resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Target Date (optional)</label>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="ppl-input"
              />
            </div>

            <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full py-3">
              {isSubmitting ? 'Creating...' : 'Create Goal'}
            </button>
          </form>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2">
        {[
          { value: '', label: 'All', count: goals.length },
          { value: 'ACTIVE', label: 'Active', count: activeGoals.length },
          { value: 'COMPLETED', label: 'Completed', count: completedGoals.length },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === tab.value
                ? 'bg-ppl-dark-green text-white'
                : 'bg-surface border border-border text-muted hover:text-foreground'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Goals List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 border-2 border-ppl-dark-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : goals.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-lg font-medium text-foreground">No goals yet</p>
          <p className="text-sm text-muted mt-1">
            Set your first goal to start tracking your progress!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(filter ? goals : [...activeGoals, ...completedGoals, ...abandonedGoals]).map((goal) => (
            <div key={goal.id} className="ppl-card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-foreground">{goal.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      goal.type === 'SHORT_TERM'
                        ? 'bg-blue-500/10 text-blue-600'
                        : 'bg-purple-500/10 text-purple-600'
                    }`}>
                      {goal.type === 'SHORT_TERM' ? 'Short Term' : 'Long Term'}
                    </span>
                  </div>
                  {goal.description && (
                    <p className="text-sm text-muted mt-1">{goal.description}</p>
                  )}
                  {goal.coach && (
                    <p className="text-xs text-muted mt-1">Set by Coach {goal.coach.fullName}</p>
                  )}
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  goal.status === 'ACTIVE' ? 'bg-ppl-dark-green/10 text-ppl-dark-green' :
                  goal.status === 'COMPLETED' ? 'bg-green-500/10 text-green-600' :
                  'bg-gray-500/10 text-gray-500'
                }`}>
                  {goal.status}
                </span>
              </div>

              {/* Progress Bar */}
              {goal.status === 'ACTIVE' && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted">Progress</span>
                    <span className="text-xs font-medium text-foreground">{goal.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full ppl-gradient transition-all duration-300"
                      style={{ width: `${goal.progress}%` }}
                    />
                  </div>
                  <div className="flex gap-2 mt-3">
                    {[25, 50, 75, 100].map((p) => (
                      <button
                        key={p}
                        onClick={() => handleUpdateProgress(goal.id, p)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          goal.progress >= p
                            ? 'border-ppl-dark-green bg-ppl-dark-green/10 text-ppl-dark-green'
                            : 'border-border text-muted hover:text-foreground'
                        }`}
                      >
                        {p}%
                      </button>
                    ))}
                    <button
                      onClick={() => handleAbandon(goal.id)}
                      className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-danger hover:border-danger ml-auto"
                    >
                      Abandon
                    </button>
                  </div>
                </div>
              )}

              {goal.targetDate && (
                <p className="text-xs text-muted">
                  Target: {new Date(goal.targetDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
