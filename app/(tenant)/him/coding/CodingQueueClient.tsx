'use client';

import { useState } from 'react';

interface QueueItem {
  id: string;
  encounter_id: string;
  status: string;
  created_at: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  mrn?: string;
  encounter_type: string;
  encounter_date: string;
}

interface CodingQueueClientProps {
  initialQueue: QueueItem[];
}

export default function CodingQueueClient({ initialQueue }: CodingQueueClientProps) {
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);
  const [icd11Code, setIcd11Code] = useState('1B11 (Tuberculosis of lung)');
  const [diagnosisDescription, setDiagnosisDescription] = useState('Confirmed pulmonary TB via GeneXpert');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const commonCodes = [
    { code: '1B11', title: 'Tuberculosis of lung' },
    { code: '1F40', title: 'Malaria caused by Plasmodium falciparum' },
    { code: 'BA00', title: 'Essential hypertension' },
    { code: '5A11', title: 'Type 2 diabetes mellitus' },
    { code: 'CA23', title: 'Pneumonia due to Streptococcus pneumoniae' },
  ];

  async function handleCompleteCoding(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedItem) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/him/coding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queueId: selectedItem.id,
          encounterId: selectedItem.encounter_id,
          icd11Code,
          description: diagnosisDescription,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete coding');

      setQueue((prev) => prev.filter((item) => item.id !== selectedItem.id));
      setFeedback({ type: 'success', message: 'Encounter chart successfully coded!' });
      setTimeout(() => setSelectedItem(null), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error completing coding' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Table */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Encounter Type</th>
                <th className="px-6 py-3.5">Encounter Date</th>
                <th className="px-6 py-3.5">Coding Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                    <p className="font-semibold text-slate-700">Coding Queue is Clear</p>
                    <p className="text-xs text-slate-400 mt-1">
                      All clinical encounter records have been coded with ICD-11 classifications.
                    </p>
                  </td>
                </tr>
              ) : (
                queue.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">
                        {item.first_name} {item.last_name}
                      </div>
                      <div className="text-xs text-slate-400">MRN: {item.mrn || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 capitalize text-slate-700">
                      {item.encounter_type || 'Outpatient Consultation'}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(item.encounter_date || item.created_at).toLocaleDateString('en-KE', {
                        dateStyle: 'medium',
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        PENDING ICD-11
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedItem(item);
                          setFeedback(null);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                      >
                        Code Encounter
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900">Assign ICD-11 Code</h3>
                <p className="text-xs text-slate-500">
                  Patient: {selectedItem.first_name} {selectedItem.last_name}
                </p>
              </div>
              <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCompleteCoding} className="p-6 space-y-4">
              {feedback && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              {/* Common ICD-11 shortcuts */}
              <div>
                <span className="text-xs font-bold text-slate-700 uppercase">Frequent Conditions:</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {commonCodes.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => {
                        setIcd11Code(`${c.code} (${c.title})`);
                        setDiagnosisDescription(c.title);
                      }}
                      className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded border border-slate-300"
                    >
                      {c.code}: {c.title}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">ICD-11 Code & Title *</label>
                <input
                  type="text"
                  required
                  value={icd11Code}
                  onChange={(e) => setIcd11Code(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Clinical Notes / Justification</label>
                <textarea
                  rows={3}
                  value={diagnosisDescription}
                  onChange={(e) => setDiagnosisDescription(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !icd11Code.trim()}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {loading ? 'Saving Code...' : 'Complete & Sign Coding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
