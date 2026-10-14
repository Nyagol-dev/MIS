'use client';

import { useState } from 'react';

interface RoiItem {
  id: string;
  patient_id: string;
  requested_by: string;
  purpose: string;
  released_at: string;
  details?: string;
  first_name: string;
  last_name: string;
  mrn?: string;
  officer_first: string;
  officer_last: string;
}

interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  mrn?: string;
}

interface RoiClientProps {
  initialLogs: RoiItem[];
  patients: PatientOption[];
}

export default function RoiClient({ initialLogs, patients }: RoiClientProps) {
  const [logs, setLogs] = useState<RoiItem[]>(initialLogs);
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(patients[0]?.id || '');
  const [requestedBy, setRequestedBy] = useState('Insurance Claims Investigation Unit');
  const [purpose, setPurpose] = useState('Medical assessment for SHA Reimbursement');
  const [details, setDetails] = useState('Discharged summary, lab histology, and inpatient bills');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/him/roi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatientId,
          requestedBy,
          purpose,
          details,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to log disclosure');

      const pat = patients.find((p) => p.id === selectedPatientId);
      const newLog: RoiItem = {
        id: data.logId,
        patient_id: selectedPatientId,
        requested_by: requestedBy,
        purpose,
        released_at: new Date().toISOString(),
        details,
        first_name: pat?.first_name || 'Patient',
        last_name: pat?.last_name || '',
        mrn: pat?.mrn,
        officer_first: 'Health',
        officer_last: 'Records Officer',
      };

      setLogs((prev) => [newLog, ...prev]);
      setFeedback({ type: 'success', message: 'Disclosure event recorded and audited.' });
      setTimeout(() => setShowLogModal(false), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error logging ROI' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="text-sm text-slate-600">
          Total Disclosures Logged: <strong className="text-slate-900">{logs.length}</strong>
        </div>
        <button
          onClick={() => {
            setFeedback(null);
            setShowLogModal(true);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg shadow-xs"
        >
          + Log Record Disclosure
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Requesting Party</th>
                <th className="px-6 py-3.5">Authorized Purpose</th>
                <th className="px-6 py-3.5">Released By</th>
                <th className="px-6 py-3.5">Date Released</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    <p className="font-semibold text-slate-700">No Disclosures Logged</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Every external disclosure of patient health information must be recorded here.
                    </p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">
                        {log.first_name} {log.last_name}
                      </div>
                      <div className="text-xs text-slate-400">MRN: {log.mrn || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-800">{log.requested_by}</td>
                    <td className="px-6 py-4 text-slate-600">{log.purpose}</td>
                    <td className="px-6 py-4 text-slate-700 text-xs">
                      {log.officer_first} {log.officer_last}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(log.released_at).toLocaleDateString('en-KE', { dateStyle: 'medium' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Log Release of Information (ROI)</h3>
              <button onClick={() => setShowLogModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleLogSubmit} className="p-6 space-y-4">
              {feedback && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Patient *</label>
                <select
                  required
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.last_name}, {p.first_name} {p.mrn ? `(${p.mrn})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Requesting Party / Entity *</label>
                <input
                  type="text"
                  required
                  value={requestedBy}
                  onChange={(e) => setRequestedBy(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Purpose of Release *</label>
                <input
                  type="text"
                  required
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Records Disclosed / Scope</label>
                <textarea
                  rows={2}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !selectedPatientId}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {loading ? 'Recording...' : 'Record Disclosure'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
