'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, Location, Room } from '@/lib/api';

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
              ? 'bg-ppl-dark-green/10 border border-ppl-dark-green/20 text-ppl-light-green'
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
                    <p className="text-xs text-muted">Timezone: {loc.timezone || 'America/Chicago'}</p>
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
                    className="text-xs text-ppl-light-green hover:underline"
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
  const [form, setForm] = useState({
    name: location?.name || '',
    address: location?.address || '',
    phone: location?.phone || '',
    timezone: location?.timezone || 'America/Chicago',
    closedDay: (location as any)?.closedDay || 'sunday',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      if (location) {
        await api.updateLocation(location.id, form);
      } else {
        await api.createLocation(form);
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
              placeholder="PPL South"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted block mb-1">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="ppl-input"
              placeholder="123 Main St, Dallas TX"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="ppl-input"
                placeholder="(214) 555-0100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted block mb-1">Closed Day</label>
              <select
                value={form.closedDay}
                onChange={(e) => setForm({ ...form, closedDay: e.target.value })}
                className="ppl-input"
              >
                <option value="">None</option>
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
                <option value="saturday">Saturday</option>
              </select>
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
