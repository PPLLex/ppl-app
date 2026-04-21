'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, BookingHistoryItem } from '@/lib/api';

type StatusFilter = 'all' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export default function ClientBookingHistoryPage() {
  const [bookings, setBookings] = useState<BookingHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getMyBookings({
        status: filter === 'all' ? undefined : filter,
        page,
      });
      if (res.data) setBookings(res.data);
      const raw = res as any;
      if (raw.pagination) setTotalPages(raw.pagination.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    load();
  }, [load]);

  const STATUS_STYLES: Record<string, string> = {
    CONFIRMED: 'ppl-badge-active',
    COMPLETED: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
    CANCELLED: 'bg-red-500/10 text-red-400 border border-red-500/20',
    NO_SHOW: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    WAITLISTED: 'ppl-badge-warning',
  };

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'CONFIRMED', label: 'Upcoming' },
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'CANCELLED', label: 'Cancelled' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
        <p className="text-sm text-muted mt-0.5">Your session history and upcoming bookings</p>
      </div>

      {/* Filters */}
      <div className="flex gap-1 mb-4 bg-surface rounded-lg p-1 w-fit">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => { setFilter(f.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              filter === f.key
                ? 'bg-highlight/20 text-accent-text'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Bookings List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="ppl-card animate-pulse h-20" />
          ))}
        </div>
      ) : bookings.length > 0 ? (
        <div className="space-y-2">
          {bookings.map((booking) => {
            const start = new Date(booking.session.startTime);
            const end = new Date(booking.session.endTime);
            const isPast = start < new Date();

            return (
              <div
                key={booking.id}
                className={`ppl-card flex items-center gap-4 ${isPast ? 'opacity-70' : ''}`}
              >
                {/* Date Block */}
                <div className="w-14 h-14 rounded-lg bg-background flex flex-col items-center justify-center flex-shrink-0">
                  <span className="text-xs text-muted font-medium">
                    {start.toLocaleDateString('en-US', { month: 'short' })}
                  </span>
                  <span className="text-lg font-bold text-foreground leading-tight">
                    {start.getDate()}
                  </span>
                </div>

                {/* Session Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground text-sm">{booking.session.title}</h3>
                    <span className={`ppl-badge text-xs ${STATUS_STYLES[booking.status] || ''}`}>
                      {booking.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {start.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                    {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} –{' '}
                    {end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </p>
                  <p className="text-xs text-muted">
                    {booking.session.locationName}
                    {booking.session.roomName && ` — ${booking.session.roomName}`}
                  </p>
                </div>

                {/* Type Badge */}
                <span className="text-xs text-muted capitalize px-2 py-1 bg-background rounded">
                  {booking.session.type.replace(/_/g, ' ')}
                </span>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-sm text-muted">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="ppl-btn ppl-btn-secondary text-xs disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="ppl-card text-center py-12">
          <p className="text-muted">No bookings found</p>
          <a href="/client/book" className="text-sm text-accent-text hover:underline mt-2 inline-block">
            Book a session &rarr;
          </a>
        </div>
      )}
    </div>
  );
}
