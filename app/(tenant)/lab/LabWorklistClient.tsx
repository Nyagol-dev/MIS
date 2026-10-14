'use client';

import { useState } from 'react';

interface LabSample {
  id: string;
  order_id: string;
  accession_number: string;
  sample_type: string;
  status: string;
  collected_at: string;
  first_name: string;
  last_name: string;
  test_name: string;
}

type Tab = 'pending' | 'resulted';

interface LabWorklistClientProps {
  pendingSamples: LabSample[];
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    collected: 'bg-yellow-100 text-yellow-800',
    resulted: 'bg-blue-100 text-blue-800',
    verified: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

export default function LabWorklistClient({ pendingSamples }: LabWorklistClientProps) {
  const [tab, setTab] = useState<Tab>('pending');
  const [selectedSample, setSelectedSample] = useState<LabSample | null>(null);
  const [resultValue, setResultValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const collected = pendingSamples.filter(s => s.status === 'collected');
  const resulted = pendingSamples.filter(s => s.status === 'resulted');

  async function handleVerify(sampleId: string) {
    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/laboratory/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId }),
      });
      if (!res.ok) throw new Error('Failed to verify');
      setMessage('Result verified and released.');
    } catch {
      setMessage('Failed to verify result.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnterResult(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSample || !resultValue) return;
    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/laboratory/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sampleId: selectedSample.id,
          results: [
            {
              testCode: selectedSample.test_name.replace(/\s+/g, '_').toUpperCase(),
              testName: selectedSample.test_name,
              resultValue,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error('Failed to enter result');
      setMessage('Result entered successfully.');
      setSelectedSample(null);
      setResultValue('');
    } catch {
      setMessage('Failed to enter result. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Collected (Pending Result)', value: collected.length, color: 'text-yellow-600' },
          { label: 'Awaiting Verification', value: resulted.length, color: 'text-blue-600' },
          { label: 'Today Total', value: pendingSamples.length, color: 'text-slate-700' },
          { label: 'Critical Pending', value: 0, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
            <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">{s.label}</p>
            <p className={`mt-1 text-3xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Success / error message */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes('Failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* Result Entry Modal */}
      {selectedSample && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Enter Result</h2>
            <p className="text-sm text-slate-500 mb-4">
              {selectedSample.first_name} {selectedSample.last_name} — {selectedSample.test_name}
              <br />
              Accession: <span className="font-mono">{selectedSample.accession_number}</span>
            </p>
            <form onSubmit={handleEnterResult} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Result Value</label>
                <input
                  type="text"
                  required
                  value={resultValue}
                  onChange={(e) => setResultValue(e.target.value)}
                  placeholder="e.g. 12.5 g/dL"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedSample(null)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Saving…' : 'Save Result'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tab header */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 flex">
          {(['pending', 'resulted'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'pending' ? `Collected (${collected.length})` : `Awaiting Verification (${resulted.length})`}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Accession</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Test</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Sample Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Collected</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {(tab === 'pending' ? collected : resulted).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    No samples in this queue.
                  </td>
                </tr>
              ) : (
                (tab === 'pending' ? collected : resulted).map((sample) => (
                  <tr key={sample.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{sample.accession_number}</td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {sample.last_name}, {sample.first_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{sample.test_name}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">{sample.sample_type}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(sample.collected_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3">{statusBadge(sample.status)}</td>
                    <td className="px-4 py-3 text-right">
                      {tab === 'pending' ? (
                        <button
                          onClick={() => setSelectedSample(sample)}
                          className="text-xs px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                          Enter Result
                        </button>
                      ) : (
                        <button
                          onClick={() => handleVerify(sample.id)}
                          disabled={submitting}
                          className="text-xs px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                        >
                          Verify & Release
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
    </div>
  );
}
