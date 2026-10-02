-- Migration: round11_roles_updated_at
-- Adds the missing updated_at column to the roles table.
-- The column was referenced in application code (lib/roles/roles.ts) but
-- omitted from the original CREATE TABLE definition.

ALTER TABLE roles
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
