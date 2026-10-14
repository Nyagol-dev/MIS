'use client';

import { useState } from 'react';
import { ImagingOrder } from '@/lib/radiology/service';

interface RadiologyWorklistClientProps {
  orders: ImagingOrder[];
}

export default function RadiologyWorklistClient({ orders }: RadiologyWorklistClientProps) {
  const [orderList, setOrderList] = useState<ImagingOrder[]>(orders);
  const [search, setSearch] = useState('');
  const [modalityFilter, setModalityFilter] = useState('ALL');
  const [selectedOrder, setSelectedOrder] = useState<ImagingOrder | null>(null);
  const [reportText, setReportText] = useState('');
  const [dicomStudyUid, setDicomStudyUid] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const filteredOrders = orderList.filter((order) => {
    const matchesSearch =
      `${order.first_name} ${order.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      order.body_part?.toLowerCase().includes(search.toLowerCase()) ||
      order.id.toLowerCase().includes(search.toLowerCase());
    const matchesModality =
      modalityFilter === 'ALL' || order.modality?.toUpperCase() === modalityFilter;
    return matchesSearch && matchesModality;
  });

  const modalities = Array.from(new Set(orders.map((o) => o.modality?.toUpperCase()).filter(Boolean)));

  function openReportModal(order: ImagingOrder) {
    setSelectedOrder(order);
    setReportText('');
    setDicomStudyUid(order.id ? `1.2.840.10008.${order.id.replace(/-/g, '')}` : '');
    setFeedback(null);
  }

  function applyTemplate(type: 'chest_normal' | 'abd_normal') {
    if (type === 'chest_normal') {
      setReportText(
        `EXAMINATION: CHEST X-RAY (PA VIEW)\n\nFINDINGS:\nLungs are clear bilaterally with no focal consolidation, pneumothorax, or pleural effusion.\nCardiothoracic ratio is within normal limits.\nMediastinal contours and hila appear normal.\nBony thorax and soft tissues unremarkable.\n\nIMPRESSION:\nNormal radiographic examination of the chest.`
      );
    } else if (type === 'abd_normal') {
      setReportText(
        `EXAMINATION: ABDOMINAL ULTRASOUND\n\nFINDINGS:\nLiver: Normal size, contour, and homogeneous echotexture. No focal lesion.\nGallbladder: Well-distended with thin wall. No calculi or sludge.\nBiliary Tree: Common bile duct is not dilated.\nPancreas: Normal in size and echogenicity.\nSpleen: Normal size and homogeneous architecture.\nKidneys: Both kidneys demonstrate normal size, corticomedullary differentiation, and no hydronephrosis or calculi.\nUrinary Bladder: Smooth wall, completely distended.\n\nIMPRESSION:\nNormal abdominal ultrasound examination.`
      );
    }
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedOrder) return;
    if (!reportText.trim()) {
      setFeedback({ type: 'error', message: 'Report narrative cannot be empty.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/radiology/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          reportText,
          dicomStudyUid: dicomStudyUid.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit imaging report');
      }

      setFeedback({ type: 'success', message: 'Report verified and signed successfully!' });
      // Remove from worklist or mark completed
      setOrderList((prev) => prev.filter((o) => o.id !== selectedOrder.id));
      setTimeout(() => {
        setSelectedOrder(null);
      }, 1000);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'An error occurred' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top filters and controls */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-1 gap-3 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search patient name, body part, or order ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:max-w-md px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <select
            value={modalityFilter}
            onChange={(e) => setModalityFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Modalities</option>
            {modalities.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing {filteredOrders.length} pending imaging request{filteredOrders.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-700 font-semibold text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Patient</th>
                <th className="px-6 py-3.5">Modality & Body Part</th>
                <th className="px-6 py-3.5">Priority</th>
                <th className="px-6 py-3.5">Ordered By</th>
                <th className="px-6 py-3.5">Ordered At</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    <p className="font-medium text-slate-700">No imaging orders in queue</p>
                    <p className="text-xs text-slate-400 mt-1">
                      New orders from Outpatient or Inpatient CPOE will appear here automatically.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">
                        {order.first_name} {order.last_name}
                      </div>
                      <div className="text-xs text-slate-500">ID: {order.patient_id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 mr-2">
                        {order.modality || 'Imaging'}
                      </span>
                      <span className="text-slate-800 font-medium">{order.body_part || 'General'}</span>
                      {order.clinical_notes && (
                        <div className="text-xs text-slate-500 truncate max-w-xs mt-0.5" title={order.clinical_notes}>
                          Indication: {order.clinical_notes}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          order.priority === 'urgent' || order.priority === 'stat'
                            ? 'bg-red-50 text-red-700 border border-red-200 animate-pulse'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {order.priority?.toUpperCase() || 'ROUTINE'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-700">
                      {order.ordered_by_name || 'Medical Officer'}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs">
                      {new Date(order.ordered_at).toLocaleString('en-KE', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => openReportModal(order)}
                        className="inline-flex items-center px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg shadow-sm transition-colors"
                      >
                        Enter Report
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Report Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Radiology Report Entry</h3>
                <p className="text-xs text-slate-500">
                  Patient: {selectedOrder.first_name} {selectedOrder.last_name} | {selectedOrder.modality} - {selectedOrder.body_part}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold p-1"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmitReport} className="p-6 space-y-4 overflow-y-auto flex-1">
              {feedback && (
                <div
                  className={`p-3 rounded-lg text-sm font-medium ${
                    feedback.type === 'success'
                      ? 'bg-green-50 text-green-800 border border-green-200'
                      : 'bg-red-50 text-red-800 border border-red-200'
                  }`}
                >
                  {feedback.message}
                </div>
              )}

              {/* Patient and Clinical Context Banner */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-1">
                <div className="flex justify-between">
                  <span className="font-semibold text-slate-900">Clinical Indication:</span>
                  <span>Priority: <strong className="uppercase">{selectedOrder.priority || 'ROUTINE'}</strong></span>
                </div>
                <p className="text-slate-600 italic">
                  {selectedOrder.clinical_notes || 'No specific clinical indication provided by ordering physician.'}
                </p>
              </div>

              {/* Template shortcuts */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">Quick Templates:</span>
                <button
                  type="button"
                  onClick={() => applyTemplate('chest_normal')}
                  className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border border-slate-300"
                >
                  Normal Chest X-Ray
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate('abd_normal')}
                  className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border border-slate-300"
                >
                  Normal Abdominal US
                </button>
              </div>

              {/* Report Narrative */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Report Findings & Impression *
                </label>
                <textarea
                  rows={8}
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                  placeholder="Enter detailed radiological findings, technique, and impression..."
                  className="w-full font-mono text-xs sm:text-sm p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              {/* PACS DICOM Study UID */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  PACS / DICOM Study UID (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={dicomStudyUid}
                    onChange={(e) => setDicomStudyUid(e.target.value)}
                    placeholder="e.g. 1.2.840.10008.5.1.4.1.1.2..."
                    className="flex-1 text-xs p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  {dicomStudyUid && (
                    <a
                      href={`#pacs-viewer-${dicomStudyUid}`}
                      onClick={(e) => {
                        e.preventDefault();
                        alert(`Opening integrated PACS Web Viewer for Study UID: ${dicomStudyUid}`);
                      }}
                      className="px-3 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 flex items-center gap-1"
                    >
                      View in PACS
                    </a>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm disabled:opacity-50"
                >
                  {submitting ? 'Signing Report...' : 'Sign & Complete Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
