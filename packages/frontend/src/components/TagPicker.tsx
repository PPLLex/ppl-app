'use client';

/**
 * Inline tag chip + add/remove UI. Drops into any entity detail page
 * (lead, member, athlete) and lets admins manage tags without leaving
 * the page.
 */

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type Tag = { id: string; name: string; color: string; kind: string };

type SubjectKey = 'leadId' | 'userId' | 'athleteProfileId';
type SubjectType = 'lead' | 'user' | 'athlete';

const SUBJECT_KEY: Record<SubjectType, SubjectKey> = {
  lead: 'leadId',
  user: 'userId',
  athlete: 'athleteProfileId',
};

export function TagPicker({
  subjectType,
  subjectId,
}: {
  subjectType: SubjectType;
  subjectId: string;
}) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [assigned, setAssigned] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, owned] = await Promise.all([
        api.listTags(),
        api.getTagsBySubject(subjectType, subjectId),
      ]);
      setAllTags((all.data as Tag[]) || []);
      setAssigned((owned.data as Tag[]) || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [subjectType, subjectId]);

  useEffect(() => { load(); }, [load]);

  const subjectKey = SUBJECT_KEY[subjectType];

  const handleAdd = async (tagId: string) => {
    try {
      await api.assignTag(tagId, { [subjectKey]: subjectId });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add tag');
    }
  };

  const handleRemove = async (tagId: string) => {
    try {
      await api.unassignTag(tagId, { [subjectKey]: subjectId });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove tag');
    }
  };

  const assignedIds = new Set(assigned.map((t) => t.id));
  const available = allTags.filter((t) => !assignedIds.has(t.id));

  return (
    <div>
      <div className="flex items-center flex-wrap gap-1.5">
        {loading && assigned.length === 0 ? (
          <span className="text-[11px] text-muted">Loading…</span>
        ) : (
          assigned.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border"
              style={{ borderColor: `${t.color}55`, background: `${t.color}15`, color: t.color }}
            >
              {t.name}
              <button
                onClick={() => handleRemove(t.id)}
                className="hover:bg-black/20 rounded-full w-3.5 h-3.5 flex items-center justify-center"
                title="Remove"
              >
                ×
              </button>
            </span>
          ))
        )}
        {!showPicker ? (
          <button
            onClick={() => setShowPicker(true)}
            className="text-[11px] text-muted hover:text-accent-text border border-dashed border-border rounded-full px-2 py-0.5"
          >
            + Tag
          </button>
        ) : (
          <div className="relative">
            <button
              onClick={() => setShowPicker(false)}
              className="text-[11px] text-accent-text border border-accent-text/40 rounded-full px-2 py-0.5"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {showPicker && (
        <div className="mt-2 ppl-card bg-background/40 max-h-48 overflow-y-auto">
          {available.length === 0 ? (
            <p className="text-xs text-muted text-center py-2">All tags already assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {available.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleAdd(t.id)}
                  className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border border-border hover:border-accent-text transition"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
