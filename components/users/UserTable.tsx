'use client';

import React, { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Table, TableColumn } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';

export interface UserRowData {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: any; // Date or string depending on serialization
}

export interface UserTableProps {
  users: UserRowData[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  canManage: boolean;
}

export function UserTable({
  users,
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  canManage,
}: UserTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [editUser, setEditUser] = useState<UserRowData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', newPage.toString());
    router.push(`${pathname}?${params.toString()}`);
  };

  const openEditModal = (user: UserRowData) => {
    setEditUser(user);
    setEditFullName(user.display_name);
    setEditEmail(user.email);
    setError(null);
  };

  const closeEditModal = () => {
    setEditUser(null);
    setEditFullName('');
    setEditEmail('');
    setError(null);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editFullName,
          email: editEmail,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update user');
      }

      closeEditModal();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (user: UserRowData) => {
    if (!confirm(`Are you sure you want to deactivate ${user.display_name}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to deactivate user');
      }

      router.refresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const columns: TableColumn<UserRowData>[] = [
    {
      key: 'display_name',
      header: 'Name',
      render: (user) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {user.display_name}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (user) => (
        <Badge variant={user.is_active ? 'success' : 'gray'}>
          {user.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (user) => (
        <span className="text-slate-500">
          {new Date(user.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (user) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openEditModal(user)}
          >
            Edit
          </Button>
          {user.is_active && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDeactivate(user)}
            >
              Deactivate
            </Button>
          )}
        </div>
      ),
    });
  }

  return (
    <>
      <Table
        columns={columns}
        data={users}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          itemsPerPage,
          onPageChange: handlePageChange,
        }}
        emptyState={
          <div className="py-12 text-center text-slate-500">
            No users found in this organization.
          </div>
        }
      />

      <Modal
        isOpen={!!editUser}
        onClose={closeEditModal}
        title="Edit User Profile"
        size="md"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4 mt-2">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <Input
            label="Full Name"
            value={editFullName}
            onChange={(e) => setEditFullName(e.target.value)}
            required
          />

          <Input
            label="Email Address"
            type="email"
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            required
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              onClick={closeEditModal}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
