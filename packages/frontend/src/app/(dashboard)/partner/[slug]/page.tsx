'use client';

/**
 * Partner school dashboard — shared layout with variant-specific copy based
 * on SchoolTeamType (HIGH_SCHOOL | TRAVEL_TEAM | COLLEGE).
 *
 * Who lands here:
 *   - Admins (global) → drill into any partner school
 *   - Partnership Coach → their assigned schools only
 *   - Athletes → their own row on the roster
 *
 * Uses dynamic route param `slug` (e.g. /partner/lexington-catholic) so
 * partner coaches get a memorable URL they can bookmark.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

type DashboardData = Awaited<ReturnType<typeof api.getPartnerDashboard>>['data'];

const TYPE_COPY: Record<
  'HIGH_SCHOOL' | 'TRAVEL_TEAM' | 'COLLEGE',
  { label: string; tagline: string; accentClass: string }
> = {
  HIGH_SCHOOL: {
    label: 'High School Partner',
    tagline: 'Development-focused training for your varsity + JV arms',
    accentClass: 'from-emerald-500/20 to-emerald-500/5',
  },
  TRAVEL_TEAM: {
    label: 'Travel Team Partner',
    tagline: 'Tournament-ready prep for your top arms across the season',
    accentClass: 'from-amber-500/20 to-amber-500/5',
  },
  COLLEGE: {
    label: 'College Partner',
    tagline: 'Year-round pitching development that keeps your staff ready',
    accentClass: 'from-blue-500/20 to-blue-500/5',
  },
};

export default function PartnerSchoolPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErr(null);
    try {
      const res = await api.getPartnerDashboard(slug);
      setData(res.data ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load partner school');
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="ppl-card animate-pulse h-32" />
        <div className="ppl-card animate-pulse h-80" />
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="max-w-xl mx-auto ppl-card text-center py-10">
        <h2 className="text-lg font-bold text-foreground mb-2">
          {err?.includes('403') || err?.toLowerCase().includes('access')
            ? 'No access'
            : 'Partner school not found'}
        </h2>
        <p className="text-muted text-sm">
          {err || 'This partner school may have been archived or you may not have access.'}
        </p>
        <Link href="/" className="ppl-btn ppl-btn-secondary mt-4 inline-flex">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { schoolTeam, roster, viewerRole } = data;
  const copy = TYPE_COPY[schoolTeam.type];
  const isCoachOrAdmin = viewerRole === 'ADMIN' || viewerRole === 'PARTNERSHIP_COACH';

  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero */}
      <div className={`rounded-2xl bg-gradient-to-br ${copy.accentClass} border border-border p-6 mb-6`}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted mb-1">{copy.label}</p>
            <h1 className="font-display text-2xl sm:text-3xl text-foreground uppercase tracking-[0.04em]">
              {schoolTeam.name}
            </h1>
            <p className="text-sm text-muted mt-1">{copy.tagline}</p>
          </div>
          {schoolTeam.brandLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={schoolTeam.brandLogoUrl}
              alt={`${schoolTeam.name} logo`}
              className="w-20 h-20 object-contain rounded-lg bg-background p-2"
            />
          )}
        </div>
        {schoolTeam.primaryLocation && (
          <p className="text-xs text-muted mt-3">
            Training out of{' '}
            <strong className="text-foreground">{schoolTeam.primaryLocation.name}</strong>
          </p>
        )}
      </div>

      {/* Book training CTA — athletes see this prominent; coaches see a
          smaller version since they're managing, not booking. */}
      {viewerRole === 'ATHLETE' && (
        <div className="ppl-card mb-6 ppl-gradient p-5 text-center">
          <h2 className="font-display text-xl text-white uppercase tracking-[0.04em] mb-1">
            Ready to train?
          </h2>
          <p className="text-white/90 text-sm mb-3">
            Your coach has arranged PPL access for {schoolTeam.name}. Book a session at
            {schoolTeam.primaryLocation
              ? ` ${schoolTeam.primaryLocation.name}`
              : ' any PPL location'}.
          </p>
          <Link href="/client/book" className="ppl-btn ppl-btn-light inline-flex">
            Book a session at PPL →
          </Link>
        </div>
      )}

      {/* Roster */}
      <section className="ppl-card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-base uppercase tracking-[0.04em] text-foreground">
            Roster
          </h2>
          <p className="text-xs text-muted">
            {roster.length} {roster.length === 1 ? 'athlete' : 'athletes'}
          </p>
        </div>

        {roster.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">
            No athletes on the roster yet.
            {isCoachOrAdmin &&
              ' Invite your team below — each athlete gets a PPL account to book training.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                  <th className="py-2 font-medium">Athlete</th>
                  <th className="py-2 font-medium">Level</th>
                  <th className="py-2 font-medium text-right">PPL sessions</th>
                  {isCoachOrAdmin && (
                    <th className="py-2 font-medium text-right">Contact</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roster.map((a) => (
                  <tr key={a.id} className="hover:bg-surface/40">
                    <td className="py-3 text-foreground font-medium">
                      {a.firstName} {a.lastName}
                    </td>
                    <td className="py-3 text-muted text-xs uppercase tracking-[0.08em]">
                      {a.ageGroup ?? '—'}
                    </td>
                    <td className="py-3 text-right text-foreground font-semibold">
                      {a.sessionsAtPpl}
                    </td>
                    {isCoachOrAdmin && (
                      <td className="py-3 text-right text-muted text-xs">
                        {a.email}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Coach-only tools */}
      {isCoachOrAdmin && (
        <section className="ppl-card">
          <h2 className="font-display text-base uppercase tracking-[0.04em] text-foreground mb-3">
            Tools
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ToolCard
              title="Invite athletes"
              description="Send individual or bulk invites to the roster — athletes receive a link to create their PPL account."
              disabled // Ships in a follow-up commit
              disabledLabel="Coming soon"
            />
            <ToolCard
              title="Message the PPL team"
              description="Reach the coordinator at your athletes' PPL location with a roster-wide note."
              disabled
              disabledLabel="Coming soon"
            />
            {schoolTeam.type === 'COLLEGE' && (
              <ToolCard
                title="Schedule a program review"
                description="Book a call with the PPL team to review developmental programming for your pitchers."
                disabled
                disabledLabel="Coming soon"
              />
            )}
            {schoolTeam.type === 'TRAVEL_TEAM' && (
              <ToolCard
                title="Tournament prep window"
                description="Lock a pre-tournament training block for your arms — we'll coordinate times."
                disabled
                disabledLabel="Coming soon"
              />
            )}
            {schoolTeam.type === 'HIGH_SCHOOL' && (
              <ToolCard
                title="Season pulse"
                description="See which athletes have trained this week vs haven't — helps spot recovery risks."
                disabled
                disabledLabel="Coming soon"
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function ToolCard({
  title,
  description,
  disabled,
  disabledLabel,
  href,
}: {
  title: string;
  description: string;
  disabled?: boolean;
  disabledLabel?: string;
  href?: string;
}) {
  const content = (
    <div
      className={`ppl-card h-full transition ${
        disabled ? 'opacity-60' : 'hover:border-highlight/50 cursor-pointer'
      }`}
    >
      <div className="flex items-start justify-between mb-1">
        <h3 className="font-semibold text-foreground text-sm">{title}</h3>
        {disabled && disabledLabel && (
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted bg-surface px-2 py-0.5 rounded">
            {disabledLabel}
          </span>
        )}
      </div>
      <p className="text-xs text-muted leading-relaxed">{description}</p>
    </div>
  );

  if (disabled || !href) return content;
  return <Link href={href}>{content}</Link>;
}
