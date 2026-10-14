'use client';

import { useState } from 'react';
import { handleBedAssignment, handleNursingNote, handleMarEntry, handleDischargePatient } from './actions';

interface Admission {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  admitted_at: string;
  status: string;
  bed_id: string | null;
  bed_number: string | null;
  ward_name: string | null;
}

interface Bed {
  bed_id: string;
  bed_number: string;
  ward_name: string;
  status: string;
}

type ModalType = 'bed' | 'notes' | 'mar' | 'discharge' | null;

interface InpatientClientProps {
  admissions: Admission[];
  availableBeds: Bed[];
}

export default function InpatientClient({ admissions, availableBeds }: InpatientClientProps) {
  const [modal, setModal] = useState<ModalType>(null);
  const [activeAdmission, setActiveAdmission] = useState<Admission | null>(null);
  const [bedId, setBedId] = useState('');
  const [noteText, setNoteText] = useState('');
  const [drugCode, setDrugCode] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('IV');
  const [marNotes, setMarNotes] = useState('');
  const [dischargeReason, setDischargeReason] = useState('Routine clinical discharge upon recovery');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const totalOccupied = admissions.length;
  const totalBeds = availableBeds.length + totalOccupied;

  function openModal(type: ModalType, admission: Admission) {
    setActiveAdmission(admission);
    setModal(type);
    setMessage('');
    setBedId('');
    setNoteText('');
    setDrugCode('');
    setDose('');
    setRoute('IV');
    setMarNotes('');
    setDischargeReason('Routine clinical discharge upon recovery');
  }

  function closeModal() {
    setModal(null);
    setActiveAdmission(null);
  }

  async function onBedAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAdmission || !bedId) return;
    setLoading(true);
    try {
      await handleBedAssignment(activeAdmission.id, bedId);
      setMessage('Bed assigned successfully.');
      closeModal();
    } catch {
      setMessage('Failed to assign bed.');
    } finally {
      setLoading(false);
    }
  }

  async function onNursingNote(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAdmission || !noteText.trim()) return;
    setLoading(true);
    try {
      await handleNursingNote(activeAdmission.id, noteText.trim());
      setMessage('Nursing note saved.');
      closeModal();
    } catch {
      setMessage('Failed to save note.');
    } finally {
      setLoading(false);
    }
  }

  async function onMarEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAdmission || !drugCode || !dose) return;
    setLoading(true);
    try {
      await handleMarEntry(activeAdmission.id, drugCode, dose, route, marNotes || undefined);
      setMessage('MAR entry recorded.');
      closeModal();
    } catch {
      setMessage('Failed to record MAR entry.');
    } finally {
      setLoading(false);
    }
  }

  async function onDischarge(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAdmission) return;
    setLoading(true);
    try {
      await handleDischargePatient(activeAdmission.id, dischargeReason);
      setMessage('Patient successfully discharged.');
      closeModal();
    } catch {
      setMessage('Failed to discharge patient.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-4 shadow-sm rounded-lg border border-slate-200">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">Active Admissions</h2>
          <p className="text-3xl font-bold mt-2 text-slate-900">{totalOccupied}</p>
        </div>
        <div className="bg-white p-4 shadow-sm rounded-lg border border-slate-200">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">Available Beds</h2>
          <p className="text-3xl font-bold mt-2 text-green-600">{availableBeds.length}</p>
        </div>
        <div className="bg-white p-4 shadow-sm rounded-lg border border-slate-200">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide">Total Bed Capacity</h2>
          <p className="text-3xl font-bold mt-2 text-slate-700">{totalBeds}</p>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes('Failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* Admissions table */}
      <div className="bg-white shadow-sm rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900">Current Admissions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Admitted</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Ward / Bed</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {admissions.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-400">
                    No active admissions found.
                  </td>
                </tr>
              ) : (
                admissions.map((adm) => (
                  <tr key={adm.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {adm.last_name}, {adm.first_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(adm.admitted_at).toLocaleString('en-KE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {adm.ward_name
                        ? `${adm.ward_name} / Bed ${adm.bed_number}`
                        : <span className="text-amber-600 font-medium">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => openModal('bed', adm)}
                        className="text-xs px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                      >
                        Assign Bed
                      </button>
                      <button
                        onClick={() => openModal('notes', adm)}
                        className="text-xs px-3 py-1 bg-slate-600 text-white rounded-lg hover:bg-slate-700"
                      >
                        Notes
                      </button>
                      <button
                        onClick={() => openModal('mar', adm)}
                        className="text-xs px-3 py-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                      >
                        MAR
                      </button>
                      <button
                        onClick={() => openModal('discharge', adm)}
                        className="text-xs px-3 py-1 bg-rose-600 text-white rounded-lg hover:bg-rose-700"
                      >
                        Discharge
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bed Assignment Modal ─────────────────────────────────────────────── */}
      {modal === 'bed' && activeAdmission && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Assign Bed — {activeAdmission.first_name} {activeAdmission.last_name}
            </h2>
            <form onSubmit={onBedAssign} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Select Bed</label>
                <select
                  required
                  value={bedId}
                  onChange={(e) => setBedId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— Choose a bed —</option>
                  {availableBeds.map((b) => (
                    <option key={b.bed_id} value={b.bed_id}>
                      {b.ward_name} — Bed {b.bed_number}
                    </option>
                  ))}
                </select>
                {availableBeds.length === 0 && (
                  <p className="mt-1 text-xs text-red-600">No available beds at this time.</p>
                )}
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeModal} disabled={loading}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !bedId}
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {loading ? 'Assigning…' : 'Assign Bed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Nursing Note Modal ───────────────────────────────────────────────── */}
      {modal === 'notes' && activeAdmission && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Nursing Note — {activeAdmission.first_name} {activeAdmission.last_name}
            </h2>
            <form onSubmit={onNursingNote} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Note</label>
                <textarea
                  required
                  rows={5}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Enter nursing note…"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeModal} disabled={loading}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !noteText.trim()}
                  className="px-4 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50">
                  {loading ? 'Saving…' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MAR Entry Modal ──────────────────────────────────────────────────── */}
      {modal === 'mar' && activeAdmission && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Medication Administration — {activeAdmission.first_name} {activeAdmission.last_name}
            </h2>
            <form onSubmit={onMarEntry} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Drug Code / Name</label>
                <input
                  required
                  type="text"
                  value={drugCode}
                  onChange={(e) => setDrugCode(e.target.value)}
                  placeholder="e.g. AMOX500 or Amoxicillin 500mg"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Dose</label>
                  <input
                    required
                    type="text"
                    value={dose}
                    onChange={(e) => setDose(e.target.value)}
                    placeholder="e.g. 500mg"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Route</label>
                  <select
                    value={route}
                    onChange={(e) => setRoute(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {['PO', 'IV', 'IM', 'SC', 'SL', 'PR', 'Topical', 'INH'].map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Notes <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={marNotes}
                  onChange={(e) => setMarNotes(e.target.value)}
                  placeholder="e.g. patient tolerated well"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeModal} disabled={loading}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={loading || !drugCode || !dose}
                  className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                  {loading ? 'Recording…' : 'Record Administration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── Discharge Modal ────────────────────────────────────────────────── */}
      {modal === 'discharge' && activeAdmission && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Discharge Patient — {activeAdmission.first_name} {activeAdmission.last_name}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Discharging this patient will release bed assignment and update admission status to discharged.
            </p>
            <form onSubmit={onDischarge} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Discharge Reason / Summary *
                </label>
                <textarea
                  required
                  rows={3}
                  value={dischargeReason}
                  onChange={(e) => setDischargeReason(e.target.value)}
                  placeholder="Clinical recovery, transfer, home care, etc."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={loading}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !dischargeReason.trim()}
                  className="px-4 py-2 text-sm bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {loading ? 'Discharging…' : 'Confirm Discharge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
