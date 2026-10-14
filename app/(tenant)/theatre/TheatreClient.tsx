'use client';

import { useState } from 'react';
import WhoChecklistModal from './components/WhoChecklistModal';
import { handleTheatreStatusUpdate } from './actions';

export interface TheatreCase {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  procedure_name: string;
  scheduled_at: string;
  status: string;
}

export interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  mrn?: string;
}

interface TheatreClientProps {
  initialCases: TheatreCase[];
  patients: PatientOption[];
}

export default function TheatreClient({ initialCases, patients }: TheatreClientProps) {
  const [cases, setCases] = useState<TheatreCase[]>(initialCases);
  const [activeChecklistCaseId, setActiveChecklistCaseId] = useState<string | null>(null);
  const [activeStatusCase, setActiveStatusCase] = useState<TheatreCase | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);

  // Status update state
  const [newStatus, setNewStatus] = useState<'in_progress' | 'completed' | 'cancelled'>('in_progress');
  const [statusNotes, setStatusNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Schedule form state
  const [selectedPatientId, setSelectedPatientId] = useState(patients[0]?.id || '');
  const [procedureCode, setProcedureCode] = useState('PROC-CS-01');
  const [procedureName, setProcedureName] = useState('Emergency Caesarean Section');
  const [scheduledAt, setScheduledAt] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  const [scheduling, setScheduling] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function handleStatusSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeStatusCase) return;

    setUpdatingStatus(true);
    try {
      await handleTheatreStatusUpdate(activeStatusCase.id, newStatus, statusNotes);
      setCases((prev) =>
        prev.map((c) => (c.id === activeStatusCase.id ? { ...c, status: newStatus } : c))
      );
      setActiveStatusCase(null);
    } catch (err: any) {
      alert(err?.message || 'Failed to update theatre status');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) return;

    setScheduling(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/theatre/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatientId,
          encounterId: '00000000-0000-0000-0000-000000000001',
          procedureCode,
          procedureName,
          scheduledAt: new Date(scheduledAt).toISOString(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule case');

      const pat = patients.find((p) => p.id === selectedPatientId);
      const newCase: TheatreCase = {
        id: data.id,
        patient_id: selectedPatientId,
        first_name: pat?.first_name || 'Patient',
        last_name: pat?.last_name || '',
        procedure_name: procedureName,
        scheduled_at: new Date(scheduledAt).toISOString(),
        status: 'scheduled',
      };

      setCases((prev) => [...prev, newCase]);
      setFeedback({ type: 'success', message: 'Theatre case scheduled successfully!' });
      setTimeout(() => setShowScheduleModal(false), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error scheduling case' });
    } finally {
      setScheduling(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Operating Theatre & Procedures</h1>
          <p className="mt-1 text-sm text-slate-500">
            Surgical suite schedule, WHO safety sign-in checklists, and intra-operative case logging
          </p>
        </div>
        <button
          onClick={() => {
            setFeedback(null);
            setShowScheduleModal(true);
          }}
          className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-semibold text-sm shadow-sm transition-colors"
        >
          + Schedule Surgical Case
        </button>
      </div>

      <div className="bg-white shadow-xs rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5 text-left">Time</th>
                <th className="px-6 py-3.5 text-left">Patient</th>
                <th className="px-6 py-3.5 text-left">Procedure</th>
                <th className="px-6 py-3.5 text-left">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {cases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">
                    <p className="font-semibold text-slate-700">No scheduled surgical cases</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Click "+ Schedule Surgical Case" to book an operating room procedure.
                    </p>
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      {new Date(c.scheduled_at).toLocaleString('en-KE', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">
                      {c.first_name} {c.last_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 font-medium">
                      {c.procedure_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${
                          c.status === 'scheduled'
                            ? 'bg-blue-50 text-blue-800 border border-blue-200'
                            : c.status === 'in_progress'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200 animate-pulse'
                            : c.status === 'completed'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {c.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-xs font-semibold space-x-2">
                      <button
                        onClick={() => {
                          setActiveStatusCase(c);
                          setNewStatus('in_progress');
                          setStatusNotes('');
                        }}
                        className="px-2.5 py-1 text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md"
                      >
                        Update Status
                      </button>
                      <button
                        onClick={() => setActiveChecklistCaseId(c.id)}
                        className="px-2.5 py-1 text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md"
                      >
                        WHO Checklist
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* WHO Surgical Safety Checklist Modal */}
      {activeChecklistCaseId && (
        <WhoChecklistModal
          caseId={activeChecklistCaseId}
          onClose={() => {
            setActiveChecklistCaseId(null);
            setCases((prev) =>
              prev.map((c) =>
                c.id === activeChecklistCaseId ? { ...c, status: 'in_progress' } : c
              )
            );
          }}
        />
      )}

      {/* Status Update Modal */}
      {activeStatusCase && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Update Procedure Status</h3>
            <p className="text-xs text-slate-500 mb-4">
              Patient: {activeStatusCase.first_name} {activeStatusCase.last_name} — {activeStatusCase.procedure_name}
            </p>

            <form onSubmit={handleStatusSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">New Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as any)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg"
                >
                  <option value="in_progress">In Progress (Surgical incision)</option>
                  <option value="completed">Completed (Recovery Room transfer)</option>
                  <option value="cancelled">Cancelled (Pre-op contraindication)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Operative / Nursing Notes</label>
                <textarea
                  rows={3}
                  value={statusNotes}
                  onChange={(e) => setStatusNotes(e.target.value)}
                  placeholder="Estimated blood loss, intraoperative findings, specimens sent to lab..."
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveStatusCase(null)}
                  disabled={updatingStatus}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingStatus}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {updatingStatus ? 'Updating...' : 'Save Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schedule Case Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex justify-between items-center pb-3 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Schedule Operating Room Case</h3>
              <button onClick={() => setShowScheduleModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleScheduleSubmit} className="space-y-4 pt-4">
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
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Procedure Name *</label>
                <input
                  type="text"
                  required
                  value={procedureName}
                  onChange={(e) => setProcedureName(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Procedure Code</label>
                  <input
                    type="text"
                    value={procedureCode}
                    onChange={(e) => setProcedureCode(e.target.value)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Scheduled Date & Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  disabled={scheduling}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={scheduling || !selectedPatientId}
                  className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {scheduling ? 'Scheduling...' : 'Confirm Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
