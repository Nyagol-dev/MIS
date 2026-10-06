# Phase 3 Summary: Orders, Laboratory, Radiology, Pharmacy

## Changes Made
- Created migration `round16_phase3_orders_lab_pharmacy.sql` establishing the relational tables for:
  - **Orders (CPOE)**: `orders`, `order_items`
  - **Laboratory (LIS)**: `lab_samples`, `lab_results`
  - **Radiology**: `imaging_reports`
  - **Pharmacy**: `dispenses`, `stock_batches`, `controlled_drug_register`
- Added Row Level Security (RLS) policies for all new Phase 3 tables ensuring tenant isolation (`tenant_id = current_tenant_id()`).
- Applied appropriate PostgreSQL constraints, foreign keys (referencing `patients`, `encounters`, and `users`), and default values to ensure data integrity.

## Deferred / To Do
- Creation of tests (isolation, authorization, clinical logic tests) for the new Phase 3 tables.
- Building the UI/API layers for CPOE, LIS, Radiology reporting, and Pharmacy dispensing.
- Integration of `lib/authz/` to enforce department-scoped permissions on these tables.
- Resolution of existing `eslint` and `typescript` errors that are currently failing `npm run lint`.
