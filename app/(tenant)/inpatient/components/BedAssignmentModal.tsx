'use client';

import { useState } from 'react';
import { handleBedAssignment } from '../actions';

export default function BedAssignmentModal({
  admissionId,
  availableBeds,
  onClose,
}: {
  admissionId: string;
  availableBeds: { bed_id: string; bed_number: string; ward_name: string }[];
  onClose: () => void;
}) {
  const [bedId, setBedId] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!bedId) return;
    setLoading(true);
    try {
      await handleBedAssignment(admissionId, bedId);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to assign bed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-semibold mb-4">Assign Bed</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Select Bed</label>
            <select
              required
              value={bedId}
              onChange={(e) => setBedId(e.target.value)}
              className="w-full border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="">-- Choose a bed --</option>
              {availableBeds.map((b) => (
                <option key={b.bed_id} value={b.bed_id}>
                  {b.ward_name} - Bed {b.bed_number}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !bedId}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Assigning...' : 'Assign Bed'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
