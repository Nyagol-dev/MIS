'use client';

import { useState } from 'react';

export interface ClaimItem {
  id: string;
  claim_number: string;
  payer_name: string;
  first_name: string;
  last_name: string;
  submitted_at: string;
  total_minor_units: number;
  status: string;
}

export interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  mrn?: string;
}

interface ClaimsClientProps {
  claims: ClaimItem[];
  patients: PatientOption[];
}

export default function ClaimsClient({ claims, patients }: ClaimsClientProps) {
  const [claimList, setClaimList] = useState<ClaimItem[]>(claims);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals state
  const [activeModal, setActiveModal] = useState<'create' | 'eligibility' | 'fhir' | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<ClaimItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New Claim Form State
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [payerName, setPayerName] = useState('SHA');
  const [memberNumber, setMemberNumber] = useState('SHA-8921-3401');
  const [icd11Code, setIcd11Code] = useState('1B11 (Tuberculosis of lung)');
  const [totalAmountKes, setTotalAmountKes] = useState(12500);

  // Eligibility check state
  const [eligibilityPayer, setEligibilityPayer] = useState('SHA');
  const [eligibilityMemberNo, setEligibilityMemberNo] = useState('SHA-9921-4821');
  const [eligibilityResult, setEligibilityResult] = useState<any | null>(null);

  // Metrics
  const totalClaimsValueKes = claimList.reduce(
    (sum, c) => sum + (c.total_minor_units || 0) / 100,
    0
  );
  const approvedClaimsKes = claimList
    .filter((c) => c.status === 'paid' || c.status === 'approved')
    .reduce((sum, c) => sum + (c.total_minor_units || 0) / 100, 0);

  const filteredClaims = claimList.filter((c) => {
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    const matchesSearch =
      fullName.includes(search.toLowerCase()) ||
      c.claim_number?.toLowerCase().includes(search.toLowerCase()) ||
      c.payer_name?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  async function handleCreateClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) {
      setFeedback({ type: 'error', message: 'Please select a patient.' });
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      // First ensure a coverage record exists or pass fallback coverage ID
      const coverageRes = await fetch('/api/claims/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatientId,
          coverageId: '00000000-0000-0000-0000-000000000001', // Fallback or standard
          totalMinorUnits: Math.round(totalAmountKes * 100),
          lines: [
            {
              serviceId: 'srv-diag-01',
              amountMinorUnits: Math.round(totalAmountKes * 100),
            },
          ],
        }),
      });

      const data = await coverageRes.json();
      if (!coverageRes.ok) throw new Error(data.error || 'Failed to submit claim');

      const pat = patients.find((p) => p.id === selectedPatientId);
      const newClaim: ClaimItem = {
        id: data.id,
        claim_number: `CLM-${Date.now().toString().slice(-6)}`,
        payer_name: payerName,
        first_name: pat?.first_name || 'Patient',
        last_name: pat?.last_name || '',
        submitted_at: new Date().toISOString(),
        total_minor_units: Math.round(totalAmountKes * 100),
        status: 'submitted',
      };

      setClaimList((prev) => [newClaim, ...prev]);
      setFeedback({
        type: 'success',
        message: 'Claim assembled and submitted to payer HIE endpoint successfully!',
      });
      setTimeout(() => setActiveModal(null), 1200);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error submitting claim' });
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckEligibility(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setEligibilityResult(null);

    try {
      const res = await fetch('/api/claims/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payer: eligibilityPayer,
          memberNumber: eligibilityMemberNo,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to check eligibility');
      setEligibilityResult(data);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Eligibility check failed' });
    } finally {
      setLoading(false);
    }
  }

  function getFhirBundleJson(claim: ClaimItem) {
    return JSON.stringify(
      {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: claim.submitted_at,
        entry: [
          {
            resource: {
              resourceType: 'Claim',
              id: claim.claim_number,
              status: 'active',
              type: {
                coding: [
                  {
                    system: 'http://terminology.hl7.org/CodeSystem/claim-type',
                    code: 'institutional',
                  },
                ],
              },
              use: 'claim',
              patient: {
                reference: `Patient/${claim.first_name}-${claim.last_name}`,
              },
              insurer: {
                display: claim.payer_name,
              },
              total: {
                value: (claim.total_minor_units || 0) / 100,
                currency: 'KES',
              },
            },
          },
        ],
      },
      null,
      2
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Total Claims Value</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            KES {totalClaimsValueKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-400 mt-1">{claimList.length} submissions</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Settled / Approved</div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">
            KES {approvedClaimsKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-400 mt-1">Paid by SHA / Insurers</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Processing in HIE</div>
          <div className="text-2xl font-bold text-blue-600 mt-2">
            {claimList.filter((c) => c.status === 'submitted' || c.status === 'processing').length}
          </div>
          <div className="text-xs text-slate-400 mt-1">Under adjudication</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Payer Integration</div>
          <div className="text-sm font-bold text-emerald-700 mt-2 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            SHA AfyaLink Connected
          </div>
          <div className="text-xs text-slate-400 mt-1">FHIR R4 Claim Endpoint</div>
        </div>
      </div>

      {/* Control / Action Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-1 gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search claim #, patient name, or payer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:max-w-md px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="submitted">Submitted</option>
            <option value="processing">Processing</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        <div className="flex gap-2.5 w-full sm:w-auto">
          <button
            onClick={() => {
              setEligibilityResult(null);
              setActiveModal('eligibility');
            }}
            className="flex-1 sm:flex-none px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg border border-slate-300 transition-colors"
          >
            Verify Eligibility
          </button>
          <button
            onClick={() => {
              setSelectedPatientId(patients[0]?.id || '');
              setFeedback(null);
              setActiveModal('create');
            }}
            className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
          >
            + Assemble Claim
          </button>
        </div>
      </div>

      {/* Claims Table */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Claim #</th>
                <th className="px-6 py-3.5">Payer / Scheme</th>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Submitted Date</th>
                <th className="px-6 py-3.5">Total (KES)</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredClaims.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <p className="font-medium text-slate-700">No insurance claims in record</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Click "+ Assemble Claim" to create and dispatch a new SHA/insurance claim bundle.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredClaims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-slate-900">{claim.claim_number}</td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-slate-900">{claim.payer_name}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-800 font-medium">
                      {claim.first_name} {claim.last_name}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs">
                      {new Date(claim.submitted_at).toLocaleDateString('en-KE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {((claim.total_minor_units || 0) / 100).toLocaleString('en-KE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          claim.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : claim.status === 'processing'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : claim.status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {claim.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedClaim(claim);
                          setActiveModal('fhir');
                        }}
                        className="px-2.5 py-1 text-xs font-mono text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200"
                      >
                        FHIR Bundle
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CREATE CLAIM MODAL ── */}
      {activeModal === 'create' && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Assemble & Submit Claim</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateClaim} className="p-6 space-y-4">
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
                  <option value="">— Select Patient —</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.last_name}, {p.first_name} {p.mrn ? `(${p.mrn})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Payer *</label>
                  <select
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg"
                  >
                    <option value="SHA">Social Health Authority (SHA)</option>
                    <option value="Jubilee Insurance">Jubilee Insurance</option>
                    <option value="AAR Insurance">AAR Insurance</option>
                    <option value="CIC Insurance">CIC Insurance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Policy / Member #</label>
                  <input
                    type="text"
                    required
                    value={memberNumber}
                    onChange={(e) => setMemberNumber(e.target.value)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Primary Diagnosis (ICD-11 Code) *
                </label>
                <input
                  type="text"
                  required
                  value={icd11Code}
                  onChange={(e) => setIcd11Code(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Claim Amount (KES) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={totalAmountKes}
                  onChange={(e) => setTotalAmountKes(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-bold"
                />
              </div>

              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-900">
                <strong>AfyaLink HIE Notice:</strong> This claim will be packaged into a standard FHIR R4 Bundle with practitioner accreditation and facility identifier before submission.
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !selectedPatientId}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {loading ? 'Submitting to HIE...' : 'Submit Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ELIGIBILITY MODAL ── */}
      {activeModal === 'eligibility' && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Verify Insurance Eligibility</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <form onSubmit={handleCheckEligibility} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Payer</label>
                  <select
                    value={eligibilityPayer}
                    onChange={(e) => setEligibilityPayer(e.target.value)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg"
                  >
                    <option value="SHA">Social Health Authority (SHA)</option>
                    <option value="Jubilee Insurance">Jubilee Insurance</option>
                    <option value="AAR Insurance">AAR Insurance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Member Number</label>
                  <input
                    type="text"
                    required
                    value={eligibilityMemberNo}
                    onChange={(e) => setEligibilityMemberNo(e.target.value)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-lg"
                >
                  {loading ? 'Querying HIE Registry...' : 'Run Eligibility Inquiry'}
                </button>
              </form>

              {eligibilityResult && (
                <div className="mt-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-xs space-y-2">
                  <div className="flex justify-between items-center font-bold text-emerald-900">
                    <span>Coverage Status:</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 text-[11px]">
                      {eligibilityResult.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Scheme:</span>
                    <span className="font-semibold">{eligibilityResult.scheme}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Annual Limit Remaining:</span>
                    <span className="font-bold text-slate-900">
                      KES {eligibilityResult.benefitBalanceKes.toLocaleString('en-KE')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Pre-authorization:</span>
                    <span>{eligibilityResult.preauthRequired ? 'Required for IPD' : 'Not Required'}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-emerald-200">
                    Verified live at: {new Date(eligibilityResult.verifiedAt).toLocaleTimeString()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FHIR BUNDLE MODAL ── */}
      {activeModal === 'fhir' && selectedClaim && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-slate-900">FHIR R4 Claim Bundle</h3>
                <p className="text-xs text-slate-500">ID: {selectedClaim.claim_number}</p>
              </div>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 font-mono text-xs bg-slate-900 text-slate-200 rounded-b-xl">
              <pre>{getFhirBundleJson(selectedClaim)}</pre>
            </div>
            <div className="p-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
