'use client';

import React, { useState } from 'react';

interface NoteData {
  id?: string;
  note_type: string;
  content: string; // JSON string
  is_locked: boolean;
  author_name?: string;
  created_at?: string;
}

export function ClinicalNotesPanel({ encounterId, patientId, initialNotes = [] }: { encounterId: string, patientId: string, initialNotes?: NoteData[] }) {
  const [notes, setNotes] = useState<NoteData[]>(initialNotes);
  const [isDrafting, setIsDrafting] = useState(false);
  const [noteType, setNoteType] = useState('SOAP');
  
  // Structured template fields based on note type
  const [soapData, setSoapData] = useState({ s: '', o: '', a: '', p: '' });
  const [loading, setLoading] = useState(false);

  const handleSave = async (lock: boolean) => {
    setLoading(true);
    try {
      const content = JSON.stringify(noteType === 'SOAP' ? soapData : { text: soapData.s });
      // Call API
      const res = await fetch('/api/clinical/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId, patientId, noteType, content })
      });
      const data = await res.json();
      
      if (lock && data.id) {
        await fetch(`/api/clinical/notes/${data.id}/lock`, { method: 'POST' });
      }
      
      // Update local state mock for now
      setNotes([...notes, { 
        id: data.id, 
        note_type: noteType, 
        content, 
        is_locked: lock, 
        author_name: 'Current User', 
        created_at: new Date().toISOString() 
      }]);
      
      setIsDrafting(false);
      setSoapData({ s: '', o: '', a: '', p: '' });
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded shadow-sm border border-slate-200">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="font-semibold text-slate-800">Clinical Notes</h3>
        {!isDrafting && (
          <button onClick={() => setIsDrafting(true)} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">
            + New Note
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {notes.map((note, i) => (
          <div key={i} className="border border-slate-200 rounded p-3 bg-slate-50">
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-200">
              <span className="font-medium text-sm text-slate-700">{note.note_type} Note</span>
              <div className="flex gap-2 text-xs text-slate-500">
                <span>{new Date(note.created_at || '').toLocaleString()}</span>
                <span>• {note.author_name}</span>
                {note.is_locked ? (
                  <span className="text-red-600 font-semibold flex items-center">🔒 Locked</span>
                ) : (
                  <span className="text-amber-600 font-semibold">✏️ Draft</span>
                )}
              </div>
            </div>
            <div className="text-sm text-slate-800">
              {note.note_type === 'SOAP' ? (
                <div className="space-y-2">
                  <p><strong>S:</strong> {JSON.parse(note.content).s}</p>
                  <p><strong>O:</strong> {JSON.parse(note.content).o}</p>
                  <p><strong>A:</strong> {JSON.parse(note.content).a}</p>
                  <p><strong>P:</strong> {JSON.parse(note.content).p}</p>
                </div>
              ) : (
                <p>{JSON.parse(note.content).text}</p>
              )}
            </div>
          </div>
        ))}

        {isDrafting && (
          <div className="border border-blue-200 rounded p-4 bg-blue-50/30">
            <div className="mb-3">
              <select value={noteType} onChange={e => setNoteType(e.target.value)} className="text-sm border rounded px-2 py-1">
                <option value="SOAP">SOAP Note</option>
                <option value="Brief">Brief Note</option>
              </select>
            </div>
            
            {noteType === 'SOAP' ? (
              <div className="space-y-3">
                <div><label className="text-xs font-semibold block mb-1 text-slate-600">Subjective</label><textarea value={soapData.s} onChange={e => setSoapData({...soapData, s: e.target.value})} className="w-full text-sm border rounded p-2" rows={2}/></div>
                <div><label className="text-xs font-semibold block mb-1 text-slate-600">Objective</label><textarea value={soapData.o} onChange={e => setSoapData({...soapData, o: e.target.value})} className="w-full text-sm border rounded p-2" rows={2}/></div>
                <div><label className="text-xs font-semibold block mb-1 text-slate-600">Assessment</label><textarea value={soapData.a} onChange={e => setSoapData({...soapData, a: e.target.value})} className="w-full text-sm border rounded p-2" rows={2}/></div>
                <div><label className="text-xs font-semibold block mb-1 text-slate-600">Plan</label><textarea value={soapData.p} onChange={e => setSoapData({...soapData, p: e.target.value})} className="w-full text-sm border rounded p-2" rows={2}/></div>
              </div>
            ) : (
              <div><textarea value={soapData.s} onChange={e => setSoapData({...soapData, s: e.target.value})} className="w-full text-sm border rounded p-2" rows={4} placeholder="Note content..."/></div>
            )}
            
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setIsDrafting(false)} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-200 rounded">Cancel</button>
              <button onClick={() => handleSave(false)} disabled={loading} className="text-sm bg-white border border-slate-300 px-3 py-1.5 hover:bg-slate-50 rounded">Save Draft</button>
              <button onClick={() => handleSave(true)} disabled={loading} className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700">Sign & Lock</button>
            </div>
          </div>
        )}
        
        {!isDrafting && notes.length === 0 && (
          <div className="text-center p-6 text-slate-500 text-sm italic">
            No clinical notes documented for this encounter.
          </div>
        )}
      </div>
    </div>
  );
}
