'use client';

import { useState } from 'react';
import { handleTheatreStatusUpdate } from '../actions';

export default function WhoChecklistModal({
  caseId,
  onClose,
}: {
  caseId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [checklist, setChecklist] = useState({
    identityConfirmed: false,
    siteMarked: false,
    anaesthesiaCheck: false,
    pulseOximeter: false,
    allergies: false,
    airwayRisk: false,
    bloodLossRisk: false,
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // In a real app, we'd save this to a WHO checklist table.
      // Here we append it to notes and update status to in_progress.
      const summary = `WHO Safety Sign-in completed: ${JSON.stringify(checklist)}`;
      await handleTheatreStatusUpdate(caseId, 'in_progress', summary);
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to save checklist');
    } finally {
      setLoading(false);
    }
  }

  const toggle = (key: keyof typeof checklist) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-semibold mb-4">WHO Surgical Safety Sign-in</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            {Object.keys(checklist).map((key) => (
              <label key={key} className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={checklist[key as keyof typeof checklist]}
                  onChange={() => toggle(key as keyof typeof checklist)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <span className="text-sm text-slate-700 capitalize">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end space-x-3 pt-4 border-t">
            <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-md">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-md">Confirm & Start Case</button>
          </div>
        </form>
      </div>
    </div>
  );
}
