'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { api, SchoolTeam } from '@/lib/api';

const STATUS_BADGE: Record<string, string> = {
  NOT_SENT: 'bg-surface text-muted border border-border',
  SENT: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  ACCEPTED: 'bg-green-500/10 text-green-400 border border-green-500/20',
  EXPIRED: 'bg-red-500/10 text-red-400 border border-red-500/20',
};

export default function SchoolsPage() {
  const [schools, setSchools] = useState<SchoolTeam[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.getSchools();
        if (res.data) setSchools(res.data);
      } catch {
        // handle error
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-surface-hover rounded animate-pulse w-64" />
        <div className="ppl-card animate-pulse h-48" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Partner Schools</h1>
          <p className="text-sm text-muted mt-1">Manage team partnerships, rosters, invoices, and contracts</p>
        </div>
        <Link href="/admin/schools/new" className="ppl-btn ppl-btn-primary">
          + New Partnership
        </Link>
      </div>

      {schools.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted mb-4">No partner schools yet</p>
          <Link href="/admin/schools/new" className="ppl-btn ppl-btn-primary">
            Set Up First Partnership
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {schools.map((school) => (
            <Link key={school.id} href={`/admin/schools/${school.id}`} className="ppl-card hover:border-ppl-light-green/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {school.brandLogoUrl ? (
                    <img src={school.brandLogoUrl} alt={school.name} className="w-10 h-10 rounded-lg object-cover" />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: school.brandColors?.primary || '#374151' }}
                    >
                      {school.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-foreground">{school.name}</h3>
                    {school.coachName && (
                      <p className="text-xs text-muted">Coach: {school.coachName}</p>
                    )}
                  </div>
                </div>
                {!school.isActive && (
                  <span className="ppl-badge text-xs bg-surface text-muted border border-border">Inactive</span>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm">
                <div>
                  <span className="text-muted">Athletes:</span>{' '}
                  <span className="text-foreground font-medium">{school._count?.athletes || 0}</span>
                </div>
                <div>
                  <span className="text-muted">Invoices:</span>{' '}
                  <span className="text-foreground font-medium">{school._count?.invoices || 0}</span>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className={`ppl-badge text-xs ${STATUS_BADGE[school.coachInviteStatus] || ''}`}>
                  {school.coachInviteStatus === 'NOT_SENT'
                    ? 'Invite Not Sent'
                    : school.coachInviteStatus === 'SENT'
                      ? 'Invite Sent'
                      : school.coachInviteStatus === 'ACCEPTED'
                        ? 'Roster Submitted'
                        : 'Expired'}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
