'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EntityType {
  id: string;
  name: string;
  slug: string;
  description: string;
  current_version: number;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface EntityTypeListProps {
  entityTypes: EntityType[];
  /** Path prefix for links. Default: '/entities'. */
  basePath?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * EntityTypeList — lists all entity types for the tenant.
 *
 * Each card links to the entity type's record list page at
 * `{basePath}/{slug}` (e.g. `/entities/patient`).
 *
 * This component is a 'use client' component that receives server-fetched
 * entity types as props — it never fetches data itself. The parent
 * Server Component is responsible for loading entity types and passing
 * them here.
 */
export const EntityTypeList: React.FC<EntityTypeListProps> = ({
  entityTypes,
  basePath = '/entities',
}) => {
  const [search, setSearch] = useState('');
  const [, startTransition] = useTransition();

  const filtered = entityTypes.filter(
    (et) =>
      et.name.toLowerCase().includes(search.toLowerCase()) ||
      et.slug.toLowerCase().includes(search.toLowerCase()) ||
      (et.description && et.description.toLowerCase().includes(search.toLowerCase()))
  );

  if (entityTypes.length === 0) {
    return (
      <EmptyState
        title="No entity types defined yet"
        description="Entity types are defined via the API or by your platform administrator. Once created, they will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Search filter */}
      {entityTypes.length > 5 && (
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(e) =>
              startTransition(() => setSearch(e.target.value))
            }
            placeholder="Filter entity types…"
            aria-label="Filter entity types"
            className="block w-full max-w-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 pl-9 text-sm shadow-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:text-slate-100"
          />
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>
      )}

      {/* Entity type grid */}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
          No entity types match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-label="Entity types"
        >
          {filtered.map((et) => (
            <li key={et.id}>
              <Link
                href={`${basePath}/${et.slug}`}
                className={`
                  group flex flex-col gap-2 rounded-xl border p-5
                  transition-all duration-200
                  hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-800
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
                  ${
                    et.is_active
                      ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 opacity-60'
                  }
                `}
                aria-label={`View records for ${et.name}`}
              >
                {/* Name + active badge */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {et.name}
                  </span>
                  <Badge variant={et.is_active ? 'success' : 'gray'}>
                    {et.is_active ? 'Active' : 'Retired'}
                  </Badge>
                </div>

                {/* Slug */}
                <code className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded w-fit">
                  {et.slug}
                </code>

                {/* Description */}
                {et.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                    {et.description}
                  </p>
                )}

                {/* Meta footer */}
                <div className="flex items-center justify-between pt-1 mt-auto border-t border-slate-100 dark:border-slate-800/60">
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    Schema v{et.current_version}
                  </span>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {formatRelativeTime(et.updated_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
