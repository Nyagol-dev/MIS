'use client';

import React, { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { EntityRecordForm } from './EntityRecordForm';
import type { FieldDefinition } from './fields/TextField';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityRecord {
  id: string;
  schema_version: number;
  data: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
  created_by: string | null;
  updated_by: string | null;
}

/**
 * Permission booleans — ONLY booleans, derived from canOnEntityType() in the
 * parent Server Component. This component NEVER imports getEffectivePermissions,
 * can, or canOnEntityType. Permissions are never re-derived here.
 */
export interface EntityPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export interface EntityRecordTableProps {
  records: EntityRecord[];
  fieldDefinitions: FieldDefinition[];
  permissions: EntityPermissions;
  entityTypeId: string;
  entityTypeSlug: string;
  /** Display name for the entity type, used in UI labels. */
  entityTypeName?: string;
  /** Total records across all pages (for pagination display). */
  total?: number;
  /** Current page (1-indexed). */
  currentPage?: number;
  itemsPerPage?: number;
  onPageChange?: (page: number) => void;
}

// ─── Cell value renderer ──────────────────────────────────────────────────────

/**
 * Renders a field value as a compact table cell.
 * Truncates long strings, pretty-prints booleans, formats dates.
 */
function renderCellValue(value: unknown, fieldType: string): React.ReactNode {
  if (value === null || value === undefined) {
    return (
      <span className="text-slate-400 dark:text-slate-600 italic text-xs">—</span>
    );
  }

  switch (fieldType) {
    case 'boolean':
      return (
        <Badge variant={value ? 'success' : 'gray'}>
          {value ? 'Yes' : 'No'}
        </Badge>
      );

    case 'date': {
      const d = new Date(String(value));
      return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
    }

    case 'datetime': {
      const d = new Date(String(value));
      return isNaN(d.getTime())
        ? String(value)
        : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    }

    case 'json':
      return (
        <code className="text-xs font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded">
          {typeof value === 'string'
            ? value.slice(0, 40) + (value.length > 40 ? '…' : '')
            : JSON.stringify(value).slice(0, 40)}
        </code>
      );

    case 'enum':
      return (
        <Badge variant="secondary">{String(value)}</Badge>
      );

    case 'reference':
      return (
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {String(value).slice(0, 8)}…
        </span>
      );

    case 'file':
      return (
        <span className="text-slate-400 dark:text-slate-600 italic text-xs">
          [file]
        </span>
      );

    default: {
      const s = String(value);
      return s.length > 60 ? (
        <span title={s}>{s.slice(0, 60)}…</span>
      ) : (
        s
      );
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export const EntityRecordTable: React.FC<EntityRecordTableProps> = ({
  records,
  fieldDefinitions,
  permissions,
  entityTypeId,
  entityTypeSlug,
  entityTypeName = 'Record',
  total,
  currentPage = 1,
  itemsPerPage = 50,
  onPageChange,
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── Modal state ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<EntityRecord | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<EntityRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Derive columns from fieldDefinitions (sort_order already applied) ──────
  const MAX_VISIBLE_COLUMNS = 6;

  const columns: TableColumn<EntityRecord>[] = [
    ...fieldDefinitions.slice(0, MAX_VISIBLE_COLUMNS).map(
      (field): TableColumn<EntityRecord> => ({
        key: field.field_key,
        header: field.display_name,
        render: (row) => renderCellValue(row.data[field.field_key], field.field_type),
      })
    ),
    // Actions column — shown only when at least one action permission is true
    ...(permissions.canUpdate || permissions.canDelete
      ? [
          {
            key: '_actions',
            header: (
              <span className="sr-only">Actions</span>
            ),
            className: 'w-px text-right',
            render: (row: EntityRecord) => (
              <div className="flex items-center justify-end gap-2">
                {permissions.canUpdate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditRecord(row)}
                    aria-label={`Edit record ${row.id}`}
                  >
                    Edit
                  </Button>
                )}
                {permissions.canDelete && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleteRecord(row);
                    }}
                    aria-label={`Delete record ${row.id}`}
                  >
                    Delete
                  </Button>
                )}
              </div>
            ),
          } satisfies TableColumn<EntityRecord>,
        ]
      : []),
  ];

  // ── Delete handler ─────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!deleteRecord) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(
        `/api/entities/${encodeURIComponent(entityTypeSlug)}/records/${deleteRecord.id}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setDeleteError(json.error ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }

      setDeleteRecord(null);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Network error — please try again.'
      );
    } finally {
      setIsDeleting(false);
    }
  }, [deleteRecord, entityTypeSlug, router]);

  // ── Pagination ─────────────────────────────────────────────────────────────
  const totalPages =
    total !== undefined && total > 0 ? Math.ceil(total / itemsPerPage) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Table header toolbar */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {total !== undefined && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {total} {total === 1 ? 'record' : 'records'}
            </span>
          )}
        </div>
        {permissions.canCreate && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setCreateOpen(true)}
            aria-label={`Create new ${entityTypeName}`}
          >
            + New {entityTypeName}
          </Button>
        )}
      </div>

      {/* Table */}
      {records.length === 0 ? (
        <EmptyState
          title={`No ${entityTypeName} records yet`}
          description={
            permissions.canCreate
              ? `Create your first ${entityTypeName.toLowerCase()} to get started.`
              : `No records have been created for this type.`
          }
        />
      ) : (
        <Table
          columns={columns}
          data={records}
          pagination={
            totalPages > 1 && onPageChange
              ? {
                  currentPage,
                  totalPages,
                  onPageChange,
                  totalItems: total,
                  itemsPerPage,
                }
              : undefined
          }
        />
      )}

      {/* ── Create Modal ──────────────────────────────────────────────────── */}
      {permissions.canCreate && (
        <Modal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          title={`New ${entityTypeName}`}
          size="lg"
        >
          <EntityRecordForm
            fieldDefinitions={fieldDefinitions}
            entityTypeId={entityTypeId}
            entityTypeSlug={entityTypeSlug}
            onSuccess={() => {
              setCreateOpen(false);
              startTransition(() => router.refresh());
            }}
            onCancel={() => setCreateOpen(false)}
          />
        </Modal>
      )}

      {/* ── Edit Modal ────────────────────────────────────────────────────── */}
      {permissions.canUpdate && editRecord && (
        <Modal
          isOpen={!!editRecord}
          onClose={() => setEditRecord(null)}
          title={`Edit ${entityTypeName}`}
          size="lg"
        >
          <EntityRecordForm
            fieldDefinitions={fieldDefinitions}
            existingRecord={editRecord}
            entityTypeId={entityTypeId}
            entityTypeSlug={entityTypeSlug}
            onSuccess={() => {
              setEditRecord(null);
              startTransition(() => router.refresh());
            }}
            onCancel={() => setEditRecord(null)}
          />
        </Modal>
      )}

      {/* ── Delete Confirmation Modal ─────────────────────────────────────── */}
      {permissions.canDelete && (
        <Modal
          isOpen={!!deleteRecord}
          onClose={() => {
            setDeleteRecord(null);
            setDeleteError(null);
          }}
          title={`Delete ${entityTypeName}`}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Are you sure you want to permanently delete this record? This
              action cannot be undone.
            </p>

            {deleteError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
              >
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setDeleteRecord(null);
                  setDeleteError(null);
                }}
                disabled={isDeleting || isPending}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                isLoading={isDeleting || isPending}
                onClick={handleDelete}
                disabled={isDeleting || isPending}
              >
                Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
