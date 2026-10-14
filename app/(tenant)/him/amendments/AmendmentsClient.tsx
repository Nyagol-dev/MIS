'use client';

import { useState } from 'react';

interface AmendmentItem {
  id: string;
  patient_id: string;
  encounter_id: string;
  reason: string;
  status: string;
  created_at: string;
  first_name: string;
  last_name: string;
  mrn?: string;
  req_first_name: string;
  req_last_name: string;
}

interface AmendmentsClientProps {
  initialRequests: AmendmentItem[];
}

export default function AmendmentsClient({ initialRequests }: AmendmentsClientProps) {
  const [requests, setRequests] = useState<AmendmentItem[]>(initialRequests);
  const [selectedReq, setSelectedReq] = useState<AmendmentItem | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [reviewNotes, setReviewNotes] = useState('Correction validated against paper clinical logs');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedReq) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/him/amendments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amendmentId: selectedReq.id,
          status: decision,
          reviewNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to review amendment');

      setRequests((prev) =>
        prev.map((r) => (r.id === selectedReq.id ? { ...r, status: decision } : r))
      );
      setFeedback({ type: 'success', message: `Amendment request marked as ${decision}.` });
      setTimeout(() => setSelectedReq(null), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error processing review' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Requested By</th>
                <th className="px-6 py-3.5">Reason for Amendment</th>
                <th className="px-6 py-3.5">Date Requested</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    <p className="font-semibold text-slate-700">No Amendment Requests</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Formal chart modification requests submitted by clinicians will appear here.
                    </p>
                  </td>
                </tr>
              ) : (
                requests.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">
                        {r.first_name} {r.last_name}
                      </div>
                      <div className="text-xs text-slate-400">MRN: {r.mrn || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-800">
                      Dr. {r.req_first_name} {r.req_last_name}
                    </td>
                    <td className="px-6 py-4 text-slate-700 max-w-xs truncate" title={r.reason}>
                      {r.reason}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleDateString('en-KE', { dateStyle: 'medium' })}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          r.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : r.status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {r.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {r.status === 'pending' && (
                        <button
                          onClick={() => {
                            setSelectedReq(r);
                            setFeedback(null);
                          }}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-xs"
                        >
                          Review Request
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal */}
      {selectedReq && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Review Clinical Note Amendment</h3>
              <button onClick={() => setSelectedReq(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleReviewSubmit} className="p-6 space-y-4">
              {feedback && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1">
                <div>Patient: <strong className="text-slate-900">{selectedReq.first_name} {selectedReq.last_name}</strong></div>
                <div>Requested By: <strong className="text-slate-900">Dr. {selectedReq.req_first_name} {selectedReq.req_last_name}</strong></div>
                <div className="pt-1 text-slate-700"><strong>Clinician Reason:</strong> &ldquo;{selectedReq.reason}&rdquo;</div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Decision</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDecision('approved')}
                    className={`py-2 text-xs font-bold rounded-lg border ${
                      decision === 'approved'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    ✓ Approve Amendment
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision('rejected')}
                    className={`py-2 text-xs font-bold rounded-lg border ${
                      decision === 'rejected'
                        ? 'bg-rose-50 border-rose-500 text-rose-800'
                        : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    ✕ Reject Amendment
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Review Notes & Audit Justification</label>
                <textarea
                  rows={3}
                  required
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedReq(null)}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {loading ? 'Submitting...' : 'Submit Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
