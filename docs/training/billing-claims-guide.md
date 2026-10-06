# Billing, Revenue Cycle & SHA Claims Operating Guide

**Document Reference:** TRN-BILL-HMIS-2026-V1  
**Target Roles:** Cashiers, Billing Clerks, Finance Officers, Insurance / Claims Officers  
**Modules Covered:** Invoicing, M-Pesa STK Push, Cashier Shift Reconciliation, Waivers, SHA Claims FHIR Bundles  
**System:** Nexus Hospital Management Information System (HMIS)  
**Effective Date:** October 2026  

---

## 1. Cashier & Patient Billing Operations

### 1.1 Opening and Closing Cashier Shifts
1. At the beginning of each duty shift, log into the HMIS and open **Billing / Cashier Shifts**.
2. Click **Open Shift**, enter your opening float amount (KES), and verify your workstation terminal ID.
3. At the end of duty:
   - Click **Close Shift**.
   - Review the shift summary breakdown (Total Cash, Total M-Pesa, Total Card, Total Waivers).
   - Enter your counted physical cash balance.
   - Any variance is logged for audit; print the signed **End-of-Shift Reconciliation Report**.

### 1.2 Patient Bill Inspection & Auto-Charging
The system automatically populates patient invoices as clinical care occurs:
- OPD consultation fees (auto-charged upon triage/doctor call)
- Laboratory investigation fees (auto-charged upon order submission)
- Radiology imaging fees (auto-charged upon order submission)
- Pharmacy items (auto-charged upon pharmacist dispense)
- Inpatient bed-day accommodation charges (auto-accrued daily at midnight).

To view an invoice:
1. Search for the patient by Name, National ID, or Invoice Number.
2. Verify line items and outstanding patient balance.

### 1.3 Processing Payments: M-Pesa STK Push & Cash
#### A. M-Pesa STK Push Payment (Recommended)
1. In the payment processing panel, select payment method: **M-Pesa STK Push**.
2. Enter the patient's Safaricom phone number (format: `07XXXXXXXX` or `2547XXXXXXXX`).
3. Click **Initiate STK Push**.
4. The patient receives an automated prompt on their phone requesting their M-Pesa PIN.
5. The system listens for the callback webhook in real time. Upon PIN validation, the invoice is automatically stamped **PAID**, and an electronic receipt is generated.

#### B. Cash & Card Payments
1. Select **Cash** or **Credit/Debit Card**.
2. Enter the amount tendered. The system calculates change due.
3. Click **Post Payment**.

### 1.4 Waivers & Discounts (Two-Person Approval Rule)
Cashiers cannot unilaterally discount or waive patient bills:
1. Click **Request Waiver / Discount**.
2. Enter the proposed waiver amount and select the standardized waiver category (e.g., *Indigent / Social Work Case*, *Staff Benefit*, *Medical Board Waiver*).
3. The request is routed to the **Hospital Administrator / Medical Superintendent Approval Queue**.
4. Once an authorized administrator approves the waiver, the adjusted balance reflects on the invoice.

### 1.5 Immutability and Reversals Policy
- Posted invoices and receipts are **immutable** and cannot be edited or deleted.
- If a mistaken entry occurred, select **Issue Credit Note / Reversal**, provide the audit reason, and submit for supervisory authorization.

---

## 2. Insurance & Social Health Authority (SHA) Claims

### 2.1 Electronic Eligibility Verification
1. Navigate to **Insurance & Claims / Eligibility**.
2. Enter the patient's National ID or SHA Member Number.
3. The system queries the national eligibility endpoint in real time, returning:
   - Active Coverage Status (Active / Inactive / Dependent)
   - Covered Benefit Packages (e.g., *Primary Healthcare Fund, Social Health Insurance Fund, Emergency/Chronic Fund*)
   - Pre-authorization requirements for intended procedures.

### 2.2 Pre-Authorization (Pre-Auth) Workflow
For surgical procedures, specialized imaging, or extended inpatient admissions:
1. Open the patient's active encounter and click **Request Pre-Auth**.
2. Attach the admitting clinical diagnosis (ICD-11), surgical notes, and proposed procedure code.
3. Submit the pre-auth request. The status updates to *Approved*, *Queried*, or *Rejected*.

### 2.3 Claims Assembly & Fraud-Guard Verification
The HMIS automatically prevents fraudulent or non-compliant claims:
- **Fraud-Guard Rule:** Every line item on an insurance claim must map to a verified clinical encounter, signed CPOE order, or recorded pharmacy dispense event in the database. Claims lacking clinical evidence are rejected by the system before submission.
- **ICD-11 Enforcement:** Claims must have at least one valid ICD-11 primary diagnosis code.

### 2.4 Submitting Claims via FHIR R4 Claim Bundle
1. Open **Claims Management / Pending Submission Queue**.
2. Select the completed claim.
3. Click **Generate & Validate FHIR Claim Bundle**.
   - The system packs all necessary FHIR R4 resources: `Organization`, `Patient`, `Practitioner`, `Encounter`, `Condition`, `ServiceRequest`, and `Claim`.
4. Click **Submit to SHA / Payer**.
5. The system records the unique Claim ID and monitors the asynchronous response in `integration_outbox`.
6. **Idempotency:** If network failure occurs during submission, resubmitting with the same Claim ID safely checks status without creating duplicate bills.
