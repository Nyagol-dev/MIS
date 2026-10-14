'use client';

import { useState } from 'react';

export interface InvoiceItem {
  id: string;
  invoice_number: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  total_minor_units: number;
  status: string;
  created_at: string;
}

export interface PatientOption {
  id: string;
  first_name: string;
  last_name: string;
  mrn?: string;
}

interface BillingClientProps {
  invoices: InvoiceItem[];
  patients: PatientOption[];
}

export default function BillingClient({ invoices, patients }: BillingClientProps) {
  const [invoiceList, setInvoiceList] = useState<InvoiceItem[]>(invoices);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modals state
  const [activeModal, setActiveModal] = useState<'create' | 'pay' | 'waiver' | 'view' | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // New Invoice form state
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [serviceDescription, setServiceDescription] = useState('General Consultation');
  const [quantity, setQuantity] = useState(1);
  const [unitPriceKes, setUnitPriceKes] = useState(1500);

  // Payment form state
  const [paymentMethod, setPaymentMethod] = useState<'mpesa' | 'cash' | 'card'>('mpesa');
  const [paymentAmountKes, setPaymentAmountKes] = useState(0);
  const [mpesaPhone, setMpesaPhone] = useState('254712345678');
  const [receiptRef, setReceiptRef] = useState('');

  // Waiver form state
  const [waiverAmountKes, setWaiverAmountKes] = useState(0);
  const [waiverReason, setWaiverReason] = useState('Clinical social work waiver — indigent patient');

  // Computed summary metrics
  const totalInvoicedKes = invoiceList.reduce((sum, inv) => sum + (inv.total_minor_units || 0) / 100, 0);
  const totalPaidKes = invoiceList
    .filter((inv) => inv.status === 'paid')
    .reduce((sum, inv) => sum + (inv.total_minor_units || 0) / 100, 0);
  const pendingCollectionKes = totalInvoicedKes - totalPaidKes;

  const filteredInvoices = invoiceList.filter((inv) => {
    const fullName = `${inv.first_name} ${inv.last_name}`.toLowerCase();
    const matchesSearch =
      fullName.includes(search.toLowerCase()) ||
      inv.invoice_number?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || inv.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  function openCreateModal() {
    setSelectedPatientId(patients[0]?.id || '');
    setServiceDescription('General Consultation');
    setQuantity(1);
    setUnitPriceKes(1500);
    setFeedback(null);
    setActiveModal('create');
  }

  function openPayModal(inv: InvoiceItem) {
    setSelectedInvoice(inv);
    setPaymentAmountKes((inv.total_minor_units || 0) / 100);
    setReceiptRef(`RCP-${inv.invoice_number.replace('INV-', '')}`);
    setFeedback(null);
    setActiveModal('pay');
  }

  function openWaiverModal(inv: InvoiceItem) {
    setSelectedInvoice(inv);
    setWaiverAmountKes(Math.round((inv.total_minor_units || 0) / 100));
    setFeedback(null);
    setActiveModal('waiver');
  }

  function openViewModal(inv: InvoiceItem) {
    setSelectedInvoice(inv);
    setActiveModal('view');
  }

  async function handleCreateInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatientId) {
      setFeedback({ type: 'error', message: 'Please select a patient' });
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/billing/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatientId,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invoice');

      const pat = patients.find((p) => p.id === selectedPatientId);
      const totalMinor = quantity * unitPriceKes * 100;
      const newInv: InvoiceItem = {
        id: data.id,
        invoice_number: `INV-${Date.now().toString().slice(-6)}`,
        patient_id: selectedPatientId,
        first_name: pat ? pat.first_name : 'Patient',
        last_name: pat ? pat.last_name : '',
        total_minor_units: totalMinor,
        status: 'open',
        created_at: new Date().toISOString(),
      };

      setInvoiceList((prev) => [newInv, ...prev]);
      setFeedback({ type: 'success', message: 'Invoice generated successfully!' });
      setTimeout(() => setActiveModal(null), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error creating invoice' });
    } finally {
      setLoading(false);
    }
  }

  async function handleRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInvoice) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/billing/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          patientId: selectedInvoice.patient_id,
          amountMinorUnits: Math.round(paymentAmountKes * 100),
          provider: paymentMethod,
          referenceNumber: receiptRef,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');

      setInvoiceList((prev) =>
        prev.map((inv) =>
          inv.id === selectedInvoice.id ? { ...inv, status: 'paid' } : inv
        )
      );

      setFeedback({ type: 'success', message: 'Payment recorded and invoice marked as paid!' });
      setTimeout(() => setActiveModal(null), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error processing payment' });
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyWaiver(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedInvoice) return;

    setLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/billing/waivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: selectedInvoice.id,
          amountMinorUnits: Math.round(waiverAmountKes * 100),
          reason: waiverReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply waiver');

      const waiverMinor = Math.round(waiverAmountKes * 100);
      setInvoiceList((prev) =>
        prev.map((inv) => {
          if (inv.id === selectedInvoice.id) {
            const remaining = Math.max(0, inv.total_minor_units - waiverMinor);
            return {
              ...inv,
              total_minor_units: remaining,
              status: remaining === 0 ? 'paid' : inv.status,
            };
          }
          return inv;
        })
      );

      setFeedback({ type: 'success', message: 'Waiver applied successfully with audit trail.' });
      setTimeout(() => setActiveModal(null), 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Error applying waiver' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Invoiced</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">
            KES {totalInvoicedKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">{invoiceList.length} total hospital bills</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Collected Revenue</div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">
            KES {totalPaidKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">Cash & M-Pesa settlements</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending Balance</div>
          <div className="text-2xl font-bold text-amber-600 mt-2">
            KES {pendingCollectionKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {invoiceList.filter((i) => i.status !== 'paid').length} open bills
          </div>
        </div>
      </div>

      {/* Action and Filter Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-1 gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search invoice number or patient name..."
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
            <option value="open">Open</option>
            <option value="paid">Paid</option>
          </select>
        </div>

        <button
          onClick={openCreateModal}
          className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
        >
          + Create Invoice
        </button>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Invoice #</th>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5">Amount (KES)</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    <p className="font-medium text-slate-700">No invoices found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Click "+ Create Invoice" to generate a new hospital patient bill.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-slate-900">{inv.invoice_number}</td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">
                        {inv.first_name} {inv.last_name}
                      </div>
                      <div className="text-xs text-slate-400">ID: {inv.patient_id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs">
                      {new Date(inv.created_at).toLocaleDateString('en-KE', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      {((inv.total_minor_units || 0) / 100).toLocaleString('en-KE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          inv.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {inv.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => openViewModal(inv)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
                      >
                        View
                      </button>
                      {inv.status !== 'paid' && (
                        <>
                          <button
                            onClick={() => openPayModal(inv)}
                            className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md shadow-xs transition-colors"
                          >
                            Pay
                          </button>
                          <button
                            onClick={() => openWaiverModal(inv)}
                            className="px-2.5 py-1 text-xs font-medium text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors"
                          >
                            Waiver
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CREATE INVOICE MODAL ── */}
      {activeModal === 'create' && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Create Patient Invoice</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
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
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Select Patient *</label>
                <select
                  required
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Choose Registered Patient —</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.last_name}, {p.first_name} {p.mrn ? `(${p.mrn})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Service / Description *</label>
                <input
                  type="text"
                  required
                  value={serviceDescription}
                  onChange={(e) => setServiceDescription(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Unit Price (KES)</label>
                  <input
                    type="number"
                    min={0}
                    value={unitPriceKes}
                    onChange={(e) => setUnitPriceKes(parseFloat(e.target.value) || 0)}
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex justify-between font-bold text-sm">
                <span>Total Invoice Amount:</span>
                <span className="text-blue-600">KES {(quantity * unitPriceKes).toLocaleString('en-KE')}</span>
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
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {loading ? 'Creating...' : 'Generate Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── RECORD PAYMENT MODAL ── */}
      {activeModal === 'pay' && selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Record Payment</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <form onSubmit={handleRecordPayment} className="p-6 space-y-4">
              {feedback && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1">
                <div>Invoice: <strong className="text-slate-900">{selectedInvoice.invoice_number}</strong></div>
                <div>Patient: <strong className="text-slate-900">{selectedInvoice.first_name} {selectedInvoice.last_name}</strong></div>
                <div>Bill Total: <strong className="text-emerald-700">KES {((selectedInvoice.total_minor_units || 0) / 100).toLocaleString('en-KE')}</strong></div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('mpesa')}
                    className={`py-2 text-xs font-semibold rounded-lg border ${
                      paymentMethod === 'mpesa'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    M-Pesa STK
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`py-2 text-xs font-semibold rounded-lg border ${
                      paymentMethod === 'cash'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card')}
                    className={`py-2 text-xs font-semibold rounded-lg border ${
                      paymentMethod === 'card'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'border-slate-300 text-slate-600'
                    }`}
                  >
                    Card
                  </button>
                </div>
              </div>

              {paymentMethod === 'mpesa' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">M-Pesa Mobile Number</label>
                  <input
                    type="text"
                    value={mpesaPhone}
                    onChange={(e) => setMpesaPhone(e.target.value)}
                    placeholder="2547XXXXXXXX"
                    className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400">Initiates STK Push prompt to patient handset</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Amount Paid (KES) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={paymentAmountKes}
                  onChange={(e) => setPaymentAmountKes(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-semibold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Receipt / Ref #</label>
                <input
                  type="text"
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg font-mono"
                />
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
                  disabled={loading || paymentAmountKes <= 0}
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {loading ? 'Processing...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── APPLY WAIVER MODAL ── */}
      {activeModal === 'waiver' && selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-slate-900">Hospital Bill Waiver / Discount</h3>
              <button onClick={() => setActiveModal(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>
            <form onSubmit={handleApplyWaiver} className="p-6 space-y-4">
              {feedback && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-xs text-amber-900">
                <strong>Two-Person Rule / Authorization Note:</strong> Bill waivers modify clinical financial postings and are audited under Kenya healthcare regulatory guidelines.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Waiver Amount (KES) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={waiverAmountKes}
                  onChange={(e) => setWaiverAmountKes(parseFloat(e.target.value) || 0)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Reason / Clinical Justification *</label>
                <textarea
                  required
                  rows={3}
                  value={waiverReason}
                  onChange={(e) => setWaiverReason(e.target.value)}
                  className="w-full text-sm p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
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
                  disabled={loading || waiverAmountKes <= 0}
                  className="px-5 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs disabled:opacity-50"
                >
                  {loading ? 'Applying...' : 'Authorize Waiver'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── VIEW INVOICE MODAL ── */}
      {activeModal === 'view' && selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="text-center pb-4 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-900">Hospital Patient Bill</h2>
              <p className="text-xs text-slate-500 mt-1">Official Patient Statement & Receipt</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice Number:</span>
                <span className="font-mono font-bold text-slate-900">{selectedInvoice.invoice_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Patient:</span>
                <span className="font-semibold text-slate-900">{selectedInvoice.first_name} {selectedInvoice.last_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date Issued:</span>
                <span className="text-slate-700">{new Date(selectedInvoice.created_at).toLocaleDateString('en-KE')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Status:</span>
                <span className="font-bold uppercase text-blue-600">{selectedInvoice.status}</span>
              </div>
              <div className="pt-3 border-t border-slate-200 flex justify-between text-base font-bold">
                <span>Total Amount:</span>
                <span className="text-emerald-700">KES {((selectedInvoice.total_minor_units || 0) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setActiveModal(null)}
                className="px-5 py-2 text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
