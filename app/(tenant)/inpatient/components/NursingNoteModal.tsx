'use client';

import { useState } from 'react';
import { handleNursingNote } from '../actions';

export default function NursingNoteModal({
  admissionId,
  onClose,
}: {
  admissionId: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note) return;
    setLoading(true);
    try {
      await handleNursingNote(admissionId, note);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to save nursing note');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Add Nursing Note</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Note Details</label>
            <textarea
              required
              rows={5}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter nursing observations, care provided..."
            />
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
              disabled={loading || !note}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
