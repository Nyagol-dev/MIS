# Pharmacy & Laboratory Operations Guide

**Document Reference:** TRN-PHARM-LAB-HMIS-2026-V1  
**Target Roles:** Pharmacists, Pharmaceutical Technologists, Laboratory Technologists  
**Modules Covered:** e-Prescriptions, FEFO Dispensing, Controlled Drugs, LIS Sample Accession, Result Verification  
**System:** Nexus Hospital Management Information System (HMIS)  
**Effective Date:** October 2026  

---

## 1. Pharmacy Dispensing & Stock Management

### 1.1 Outpatient & Inpatient Prescription Worklist
1. Log into the HMIS and open **Pharmacy / Dispensing**.
2. Prescriptions placed by medical officers appear in real-time under the **Pending Dispense Queue**.
3. Select an order to open the prescription details.

### 1.2 Clinical Review & Safety Overrides
- **Drug-Allergy Verification:** If the patient has a recorded allergy to the prescribed molecule (or its therapeutic class), a prominent warning banner is displayed.
- **Drug-Drug Interaction Checks:** The system checks against known severe interactions.
- If an override is clinically necessary, the pharmacist must select **Override Alert**, enter an explicit clinical rationale (e.g. *Benefit outweighs risk, desensitization protocol active, alternative contraindicated*), and record their Pharmacy and Poisons Board (PPB) registration number.

### 1.3 FEFO Dispensing & Batch Selection
1. For each prescription line item, the system automatically suggests the stock batch based on **First-Expired, First-Out (FEFO)** principles.
2. Verify physical stock batch number and expiry date against the screen prompt.
3. Enter the quantity dispensed and patient dosage instructions.
4. Click **Confirm Dispense**. The inventory ledger is automatically debited, and billable items are posted to the patient's billing ledger.

### 1.4 Controlled Drug (DDA) Register
1. When dispensing Schedule 2 / Schedule 3 controlled substances (e.g., *Morphine, Pethidine, Fentanyl*), the **Controlled Substances Modal** opens automatically.
2. Record:
   - Patient Full Name and National ID / CR ID
   - Prescribing Doctor's KMPDC Registration Number
   - Prescribed Quantity and Exact Batch Number
   - Physical Running Balance in the DDA safe
   - Co-signing witness (second registered nurse or pharmacist)
3. The entry is immutably appended to the statutory electronic Controlled Drug Register.

---

## 2. Laboratory Information System (LIS) Operations

### 2.1 Sample Collection & Barcode Accessioning
1. Navigate to **Laboratory / Phlebotomy & Accession**.
2. View pending laboratory investigation orders placed by OPD or Inpatient clinicians.
3. When the patient presents for specimen collection (or when blood/urine tubes arrive from the wards):
   - Click **Collect Sample**.
   - Verify patient identity using two identifiers (Name + National ID/DOB).
   - The system generates a unique **Accession Number** (e.g. `LAB-2026-004521`).
   - Print or attach the barcode label to the specimen tube.
   - Click **Mark Sample Received**.

### 2.2 Result Entry & Analyzer Worklists
1. Navigate to **Laboratory / Worklists**.
2. Filter by test section (e.g., *Hematology*, *Biochemistry*, *Parasitology*, *Microbiology*).
3. Open the accessioned sample record and enter test parameters:
   - **Numeric Values:** (e.g., *Hemoglobin: 11.2 g/dL*, *RBS: 6.4 mmol/L*).
   - The system automatically compares results against age- and sex-adjusted physiological reference ranges.
   - Values outside normal limits are highlighted with yellow (High/Low) or red (Critical) flags.

### 2.3 Critical Result Notification Protocol
If a test result falls within a defined **Critical / Panic Range** (e.g., *Platelets < 20,000*, *Potassium > 6.5 mmol/L*, *Positive Blood Film for Malaria with High Parasitemia*):
1. The system displays a red **Critical Alert Prompt**.
2. Immediately contact the ordering medical officer or ward nurse by phone.
3. In the HMIS alert prompt, document:
   - Name of Clinician Notified
   - Date and Time of Verbal Notification
   - Immediate clinical verbal read-back confirmed
4. Click **Confirm Critical Alert Dispatched**.

### 2.4 Result Verification and Release
1. A senior or verifying technologist reviews the entered results under **Pending Verification**.
2. Check internal quality control (QC) status for the analyzer run.
3. Click **Verify and Release Results**.
4. The result report is immediately made available in the ordering doctor's consultation chart, inpatient ward view, and SHA claim package.
