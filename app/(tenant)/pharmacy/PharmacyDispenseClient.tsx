'use client';

import { useState } from 'react';

interface PrescriptionOrder {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  drug_name: string;
  dose: string;
  route: string;
  frequency: string;
  ordered_at: string;
  ordered_by_name: string;
  status: string;
}

interface PharmacyDispenseClientProps {
  prescriptions: PrescriptionOrder[];
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

export default function PharmacyDispenseClient({ prescriptions }: PharmacyDispenseClientProps) {
  const [selected, setSelected] = useState<PrescriptionOrder | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  async function handleDispense(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/pharmacy/dispense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selected.id,
          patientId: selected.patient_id,
          notes,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      setMessage(`Dispensed ${selected.drug_name} for ${selected.first_name} ${selected.last_name}.`);
      setSelected(null);
      setNotes('');
    } catch {
      setMessage('Failed to record dispense. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Pending Dispense</p>
          <p className="mt-1 text-3xl font-bold text-yellow-600">{prescriptions.length}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Dispensed Today</p>
          <p className="mt-1 text-3xl font-bold text-green-600">—</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Drug Interactions</p>
          <p className="mt-1 text-3xl font-bold text-red-500">0</p>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes('Failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* Dispense Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Confirm Dispense</h2>
            <div className="bg-slate-50 rounded-lg p-4 mb-4 text-sm space-y-1">
              <p><span className="font-medium">Patient:</span> {selected.first_name} {selected.last_name}</p>
              <p><span className="font-medium">Drug:</span> {selected.drug_name}</p>
              <p><span className="font-medium">Dose:</span> {selected.dose}</p>
              <p><span className="font-medium">Route:</span> {selected.route}</p>
              <p><span className="font-medium">Frequency:</span> {selected.frequency}</p>
              <p><span className="font-medium">Prescriber:</span> {selected.ordered_by_name}</p>
            </div>
            <form onSubmit={handleDispense} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Dispense Notes <span className="text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. batch number, expiry, counselling given"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {submitting ? 'Recording…' : 'Confirm Dispense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prescription queue */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
          <h2 className="font-semibold text-slate-900">Dispense Queue</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Drug</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Dose / Route</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Prescriber</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Ordered</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {prescriptions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    No pending prescriptions.
                  </td>
                </tr>
              ) : (
                prescriptions.map((rx) => (
                  <tr key={rx.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {rx.last_name}, {rx.first_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 font-medium">{rx.drug_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {rx.dose} — {rx.route}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{rx.ordered_by_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(rx.ordered_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">{statusBadge(rx.status)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setSelected(rx)}
                        className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        Dispense
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
