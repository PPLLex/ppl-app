'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, Location, Room } from '@/lib/api';

/** Friendly timezone label */
function tzLabel(tz: string): string {
  const map: Record<string, string> = {
    'America/New_York': 'Eastern Time',
    'America/Chicago': 'Central Time',
    'America/Denver': 'Mountain Time',
    'America/Los_Angeles': 'Pacific Time',
    'America/Anchorage': 'Alaska Time',
    'Pacific/Honolulu': 'Hawaii Time',
  };
  return map[tz] || tz;
}

/** Parse an existing address string into components */
function parseAddress(address: string | undefined): { street: string; city: string; state: string; zip: string } {
  if (!address) return { street: '', city: '', state: '', zip: '' };
  const parts = address.split(',').map((s) => s.trim());
  if (parts.length >= 2) {
    const street = parts[0];
    const city = parts.length >= 3 ? parts[1] : '';
    const stateZip = parts[parts.length - 1].trim();
    const stateZipMatch = stateZip.match(/^([A-Z]{2})\s*(\d{5})?$/i);
    if (stateZipMatch) {
      return { street, city, state: stateZipMatch[1].toUpperCase(), zip: stateZipMatch[2] || '' };
    }
    return { street, city, state: stateZip, zip: '' };
  }
  return { street: address, city: '', state: '', zip: '' };
}

export default function AdminLocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRoomModal, setShowRoomModal] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadLocations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.getLocations();
      if (res.data) setLocations(res.data);
    } catch (err) {
      console.error('Failed to load locations:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Locations</h1>
          <p className="text-sm text-muted mt-0.5">Manage PPL facilities and rooms</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="ppl-btn ppl-btn-primary text-sm">
          + Add Location
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-primary/10 border border-primary/20 text-accent'
              : 'bg-danger/10 border border-danger/20 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((n) => <div key={n} className="ppl-card animate-pulse h-40" />)}
        </div>
      ) : locations.length === 0 ? (
        <div className="ppl-card text-center py-12">
          <p className="text-muted">No locations yet. Create your first one above.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {locations.map((loc) => (
            <div key={loc.id} className="ppl-card">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-foreground">{loc.name}</h2>
                    <span className={`ppl-badge ${loc.isActive ? 'ppl-badge-active' : 'ppl-badge-warning'}`}>
                      {loc.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {loc.address && <p className="text-sm text-muted mt-0.5">{loc.address}</p>}
                  <div className="flex gap-4 mt-1">
                    {loc.phone && <p className="text-xs text-muted">{loc.phone}</p>}
                    <p className="text-xs text-muted">Timezone: {tzLabel(loc.timezone || 'America/Chicago')}</p>
                  </div>
                </div>
                <button
                  onClick={() => setEditingLocation(loc)}
                  className="ppl-btn ppl-btn-secondary text-xs"
                >
                  Edit
                </button>
              </div>

              {/* Rooms */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">Rooms</h3>
                  <button
                    onClick={() => setShowRoomModal(loc.id)}
                    className="text-xs text-accent hover:underline"
                  >
                    + Add Room
                  </button>
                </div>
                {loc.rooms && loc.rooms.length > 0 ? (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                    {loc.rooms.map((room: Room) => (
                      <div key={room.id} className="bg-background rounded-lg p-3">
                        <p className="font-semibold text-foreground text-sm">{room.name}</p>
                        <p className="text-xs text-muted mt-0.5">
                          {room.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted">No rooms configured yet.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Location Modal */}
      {showCreateModal && (
        <LocationModal
          onClose={() => setShowCreateModal(false)}
          onSaved={() => {
            setShowCreateModal(false);
            setMessage({ type: 'success', text: 'Location created!' });
            loadLocations();
          }}
        />
      )}

      {/* Edit Location Modal */}
      {editingLocation && (
        <LocationModal
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSaved={() => {
            setEditingLocation(null);
            setMessage({ type: 'success', text: 'Location updated!' });
            loadLocations();
          }}
        />
      )}

      {/* Add Room Modal */}
      {showRoomModal && (
        <RoomModal
          locationId={showRoomModal}
          onClose={() => setShowRoomModal(null)}
          onSaved={() => {
            setShowRoomModal(null);
            setMessage({ type: 'success', text: 'Room added!' });
            loadLocations();
          }}
        />
      )}
    </div>
  );
}

function LocationModal({
  location,
  onClose,
  onSaved,
}: {
  location?: Location;
  onClose: () => void;
  onSaved: () => void;
}) {
  const parsed = parseAddress(location?.address);
  const [form, setForm] = useState({
    name: location?.name || '',
    street: parsed.street,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    phone: location?.phone || '',
    timezone: location?.timezone || 'America/Chicago',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-detect timezone when zip changes
  useEffect(() => {
    if (form.zip.length === 5) {
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://ppl-app-production.up.railway.app'}/api/locations/timezone-from-zip/${form.zip}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.data?.timezone) {
            setForm((prev) => ({ ...prev, timezone: data.data.timezone }));
          }
        })
        .catch(() => {});
    }
  }, [form.zip]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setIsSubmitting(true);
    setError('');

    // Combine address fields into a single string
    const addressParts = [form.street, form.city, `${form.state} ${form.zip}`.trim()].filter(Boolean);
    const address = addressParts.join(', ');

    try {
      const payload = {
        name: form.name,
        address,
        phone: form.phone,
        zip: form.zip,
        timezone: form.timezone,
      };
      if (location) {
        await api.updateLocation(location.id, payload);
      } else {
        await api.createLocation(payload);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="ppl-card w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">
            {location ? 'Edit Location' : 'New Location'}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
        </div>
        {!location && (
          <p className="text-xs text-muted mb-3">
            A <strong>13+</strong> and <strong>Youth</strong> calendar will be created automatically.
          </p>
        )}
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Location Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="ppl-input"
              placeholder="PPL Southlake"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Street Address</label>
            <input
              type="text"
              value={form.street}
              onChange={(e) => setForm({ ...form, street: e.target.value })}
              className="ppl-input"
              placeholder="1234 Performance Blvd"
            />
          </div>
          <div className="grid grid-cols-6 gap-2">
            <div className="col-span-3">
              <label className="text-xs font-medium text-muted block mb-1">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="ppl-input"
                placeholder="Southlake"
              />
            </div>
            <div className="col-span-1">
              <label className="text-xs font-medium text-muted block mb-1">State</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })}
                className="ppl-input"
                placeholder="TX"
                maxLength={2}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted block mb-1">Zip Code</label>
              <input
                type="text"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                className="ppl-input"
                placeholder="76092"
                maxLength={5}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="ppl-input"
                placeholder="(817) 555-0100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Timezone</label>
              <div className="ppl-input bg-surface/50 flex items-center text-sm text-foreground">
                {tzLabel(form.timezone)}
              </div>
              <p className="text-[10px] text-muted mt-0.5">Auto-detected from zip</p>
            </div>
          </div>
          <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full justify-center">
            {isSubmitting ? 'Saving...' : location ? 'Update Location' : 'Create Location'}
          </button>
        </form>
      </div>
    </div>
  );
}

function RoomModal({
  locationId,
  onClose,
  onSaved,
}: {
  locationId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Room name is required'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      await api.createRoom(locationId, { name });
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add room');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="ppl-card w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">Add Room</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl">&times;</button>
        </div>
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger/20 rounded-lg text-sm text-danger">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Room Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ppl-input"
              placeholder="Room 3"
              required
            />
          </div>
          <button type="submit" disabled={isSubmitting} className="ppl-btn ppl-btn-primary w-full justify-center">
            {isSubmitting ? 'Adding...' : 'Add Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
