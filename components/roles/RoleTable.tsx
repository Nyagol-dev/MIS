'use client';

import React, { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Table, TableColumn } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RoleForm } from './RoleForm';
import { PermissionAssignment } from './PermissionAssignment';

export interface RoleRowData {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: any;
}

export interface RoleTableProps {
  roles: RoleRowData[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  canManage: boolean;
  globalPermissions: { id: string; codename: string; description: string }[];
  overrides: { id: string; codename: string; description: string }[];
  entityTypes: { id: string; name: string; slug: string }[];
  roleAssignments: {
    [roleId: string]: {
      globalIds: string[];
      overrideIds: string[];
      entityGrants: { entityTypeId: string; action: string }[];
    };
  };
}

export function RoleTable({
  roles,
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  canManage,
  globalPermissions,
  overrides,
  entityTypes,
  roleAssignments,
}: RoleTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [editRole, setEditRole] = useState<RoleRowData | null>(null);
  const [permissionsRole, setPermissionsRole] = useState<RoleRowData | null>(null);

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', newPage.toString());
    router.push(`${pathname}?${params.toString()}`);
  };

  const handleDeactivate = async (role: RoleRowData) => {
    if (role.is_system) return;
    if (!confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/roles/${role.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete role');
      }

      router.refresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const columns: TableColumn<RoleRowData>[] = [
    {
      key: 'name',
      header: 'Role Name',
      render: (role) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {role.name}
          </span>
          {role.is_system && (
            <Badge variant="info">System</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (role) => (
        <span className="text-slate-500 truncate max-w-xs block">
          {role.description || '-'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (role) => (
        <span className="text-slate-500">
          {new Date(role.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (role) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPermissionsRole(role)}
            disabled={role.is_system}
            title={role.is_system ? 'System roles cannot be modified' : ''}
          >
            Permissions
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditRole(role)}
            disabled={role.is_system}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleDeactivate(role)}
            disabled={role.is_system}
          >
            Delete
          </Button>
        </div>
      ),
    });
  }

  const currentRoleAssignment = permissionsRole ? roleAssignments[permissionsRole.id] : {
    globalIds: [],
    overrideIds: [],
    entityGrants: []
  };

  return (
    <>
      <Table
        columns={columns}
        data={roles}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          itemsPerPage,
          onPageChange: handlePageChange,
        }}
        emptyState={
          <div className="py-12 text-center text-slate-500">
            No roles found in this organization.
          </div>
        }
      />

      <RoleForm
        isOpen={!!editRole}
        onClose={() => setEditRole(null)}
        initialData={editRole ? { id: editRole.id, name: editRole.name, description: editRole.description } : undefined}
      />

      <PermissionAssignment
        isOpen={!!permissionsRole}
        onClose={() => setPermissionsRole(null)}
        role={permissionsRole ? { id: permissionsRole.id, name: permissionsRole.name, is_system: permissionsRole.is_system } : null}
        globalPermissions={globalPermissions}
        overrides={overrides}
        entityTypes={entityTypes}
        currentGlobalIds={currentRoleAssignment?.globalIds || []}
        currentOverrideIds={currentRoleAssignment?.overrideIds || []}
        currentEntityGrants={currentRoleAssignment?.entityGrants || []}
        onRefresh={() => router.refresh()}
      />
    </>
  );
}
