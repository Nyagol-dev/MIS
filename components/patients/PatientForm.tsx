'use client';

import React, { useState } from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface PatientFormProps {
  onSuccess?: (patientId: string) => void;
}

export function PatientForm({ onSuccess }: PatientFormProps) {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    dob: '',
    gender: 'other',
    phone: '',
    nationalId: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          dob: formData.dob,
          gender: formData.gender,
          phone: formData.phone,
          identifiers: formData.nationalId ? [{ type: 'national_id', value: formData.nationalId }] : []
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create patient');
      if (onSuccess) onSuccess(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl bg-white p-6 rounded-lg shadow-sm">
      <h2 className="text-xl font-semibold mb-4 text-slate-800">Register New Patient</h2>
      
      {error && <div className="p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input 
          label="First Name" 
          name="firstName" 
          value={formData.firstName} 
          onChange={handleChange} 
          required 
        />
        <Input 
          label="Last Name" 
          name="lastName" 
          value={formData.lastName} 
          onChange={handleChange} 
          required 
        />
        <Input 
          label="Date of Birth" 
          type="date" 
          name="dob" 
          value={formData.dob} 
          onChange={handleChange} 
          required 
        />
        <div className="flex flex-col gap-1.5 w-full">
          <label className="text-sm font-medium text-slate-700">Gender</label>
          <select 
            name="gender" 
            value={formData.gender} 
            onChange={handleChange}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            required
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <Input 
          label="Phone Number" 
          type="tel" 
          name="phone" 
          value={formData.phone} 
          onChange={handleChange} 
        />
        <Input 
          label="National ID" 
          name="nationalId" 
          value={formData.nationalId} 
          onChange={handleChange} 
        />
      </div>

      <div className="pt-4 flex justify-end">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Register Patient'}
        </button>
      </div>
    </form>
  );
}
