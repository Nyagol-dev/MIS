'use client';

import React from 'react';
import type { FieldDefinition } from './TextField';

export interface FileFieldProps {
  fieldDefinition: FieldDefinition;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * FileField — STUB for `file` field_type.
 *
 * File upload requires a file storage backend (S3/GCS/Vercel Blob) which is
 * explicitly out of scope for Round 9 (see blueprint Scope Boundary section).
 *
 * This component renders a clearly-marked disabled upload area so that entity
 * forms with `file` fields don't crash — they just surface a clear "not yet
 * available" affordance.
 *
 * TODO: Replace with a real upload component once file storage is configured.
 *       The field value should become a URL or storage key string.
 */
export const FileField: React.FC<FileFieldProps> = ({ fieldDefinition }) => {
  const { display_name, is_required } = fieldDefinition;

  return (
    <div className="w-full flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {display_name}
        {is_required && ' *'}
      </label>

      <div
        aria-disabled="true"
        className={`
          flex flex-col items-center justify-center gap-3
          rounded-lg border-2 border-dashed
          border-slate-200 dark:border-slate-700
          bg-slate-50 dark:bg-slate-900/40
          px-6 py-10
          cursor-not-allowed opacity-60
          select-none
        `}
      >
        {/* Upload icon */}
        <svg
          className="h-10 w-10 text-slate-300 dark:text-slate-600"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>

        <div className="text-center">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            File upload not yet available
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            File storage support is planned for a future release.
          </p>
        </div>
      </div>
    </div>
  );
};
