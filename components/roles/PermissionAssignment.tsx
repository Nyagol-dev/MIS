'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Checkbox } from '@/components/ui/Checkbox';

export interface PermissionAssignmentProps {
  isOpen: boolean;
  onClose: () => void;
  role: { id: string; name: string; is_system: boolean } | null;
  globalPermissions: { id: string; codename: string; description: string }[];
  overrides: { id: string; codename: string; description: string }[];
  entityTypes: { id: string; name: string; slug: string }[];
  currentGlobalIds: string[];
  currentOverrideIds: string[];
  currentEntityGrants: { entityTypeId: string; action: string }[];
  onRefresh: () => void;
}

const ENTITY_ACTIONS = ['create', 'read', 'update', 'delete', 'manage'] as const;

export function PermissionAssignment({
  isOpen,
  onClose,
  role,
  globalPermissions,
  overrides,
  entityTypes,
  currentGlobalIds,
  currentOverrideIds,
  currentEntityGrants,
  onRefresh,
}: PermissionAssignmentProps) {
  // We maintain local state to update the UI instantly (optimistic),
  // but if an API call fails, we revert it.
  const [localGlobalIds, setLocalGlobalIds] = useState<Set<string>>(new Set());
  const [localOverrideIds, setLocalOverrideIds] = useState<Set<string>>(new Set());
  const [localEntityGrants, setLocalEntityGrants] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalGlobalIds(new Set(currentGlobalIds));
      setLocalOverrideIds(new Set(currentOverrideIds));
      setLocalEntityGrants(
        new Set(currentEntityGrants.map((g) => `${g.entityTypeId}:${g.action}`))
      );
      setError(null);
    }
  }, [isOpen, currentGlobalIds, currentOverrideIds, currentEntityGrants]);

  const handleGlobalToggle = async (id: string, currentlyHas: boolean) => {
    if (!role || role.is_system) return;
    
    setIsUpdating(true);
    setError(null);
    
    const newHas = !currentlyHas;
    setLocalGlobalIds((prev) => {
      const next = new Set(prev);
      if (newHas) next.add(id);
      else next.delete(id);
      return next;
    });

    try {
      const res = await fetch(`/api/roles/${role.id}/permissions`, {
        method: newHas ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'global', id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update permission');
      }
      onRefresh();
    } catch (err: any) {
      setError(err.message);
      // revert
      setLocalGlobalIds((prev) => {
        const next = new Set(prev);
        if (currentlyHas) next.add(id);
        else next.delete(id);
        return next;
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOverrideToggle = async (id: string, currentlyHas: boolean) => {
    if (!role || role.is_system) return;
    
    setIsUpdating(true);
    setError(null);
    
    const newHas = !currentlyHas;
    setLocalOverrideIds((prev) => {
      const next = new Set(prev);
      if (newHas) next.add(id);
      else next.delete(id);
      return next;
    });

    try {
      const res = await fetch(`/api/roles/${role.id}/permissions`, {
        method: newHas ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'override', id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update permission override');
      }
      onRefresh();
    } catch (err: any) {
      setError(err.message);
      // revert
      setLocalOverrideIds((prev) => {
        const next = new Set(prev);
        if (currentlyHas) next.add(id);
        else next.delete(id);
        return next;
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleEntityGrantToggle = async (entityTypeId: string, action: string, currentlyHas: boolean) => {
    if (!role || role.is_system) return;

    setIsUpdating(true);
    setError(null);
    
    const newHas = !currentlyHas;
    const key = `${entityTypeId}:${action}`;
    
    setLocalEntityGrants((prev) => {
      const next = new Set(prev);
      if (newHas) next.add(key);
      else next.delete(key);
      return next;
    });

    try {
      const res = await fetch(`/api/roles/${role.id}/entity-permissions`, {
        method: newHas ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityTypeId, action }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update entity permission');
      }
      onRefresh();
    } catch (err: any) {
      setError(err.message);
      // revert
      setLocalEntityGrants((prev) => {
        const next = new Set(prev);
        if (currentlyHas) next.add(key);
        else next.delete(key);
        return next;
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (!role) return null;

  const isReadOnly = role.is_system;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Permissions: ${role.name}`}
      size="xl"
    >
      <div className="space-y-8 mt-4 max-h-[70vh] overflow-y-auto pr-2">
        {isReadOnly && (
          <div className="p-4 bg-amber-50 text-amber-800 rounded-lg dark:bg-amber-900/20 dark:text-amber-300 text-sm">
            This is a system role. Permissions cannot be modified.
          </div>
        )}

        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Global Permissions */}
        {globalPermissions.length > 0 && (
          <section>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2 mb-4">
              Platform Permissions
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {globalPermissions.map((p) => {
                const hasPerm = localGlobalIds.has(p.id);
                return (
                  <div key={p.id} className="flex items-start">
                    <Checkbox
                      checked={hasPerm}
                      disabled={isReadOnly || isUpdating}
                      onChange={() => handleGlobalToggle(p.id, hasPerm)}
                      label={p.codename}
                      helperText={p.description || undefined}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tenant Overrides */}
        {overrides.length > 0 && (
          <section>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2 mb-4">
              Tenant Overrides
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {overrides.map((o) => {
                const hasPerm = localOverrideIds.has(o.id);
                return (
                  <div key={o.id} className="flex items-start">
                    <Checkbox
                      checked={hasPerm}
                      disabled={isReadOnly || isUpdating}
                      onChange={() => handleOverrideToggle(o.id, hasPerm)}
                      label={o.codename}
                      helperText={o.description || undefined}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Entity-type Permissions */}
        {entityTypes.length > 0 && (
          <section>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-2 mb-4">
              Entity Permissions
            </h3>
            <div className="space-y-6">
              {entityTypes.map((et) => (
                <div key={et.id} className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-3">
                    {et.name} <span className="text-sm text-slate-500 font-normal">({et.slug})</span>
                  </h4>
                  <div className="flex flex-wrap gap-4">
                    {ENTITY_ACTIONS.map((action) => {
                      const key = `${et.id}:${action}`;
                      const hasPerm = localEntityGrants.has(key);
                      // If 'manage' is checked, other actions are implicitly granted by the system,
                      // but we can just show what is exactly assigned.
                      return (
                        <Checkbox
                          key={action}
                          checked={hasPerm}
                          disabled={isReadOnly || isUpdating}
                          onChange={() => handleEntityGrantToggle(et.id, action, hasPerm)}
                          label={action}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
