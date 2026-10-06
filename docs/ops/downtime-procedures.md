# Hospital Clinical Downtime Procedures & Business Continuity Plan

**Document Reference:** OPS-DOWNTIME-HMIS-2026-V1  
**Target Facility:** Level 4 / 5 / 6 Kenyan Hospital  
**System Evaluated:** Nexus Hospital Management Information System (HMIS)  
**Applicability:** All Clinical, Nursing, Diagnostic, Pharmacy, and Cashier Units  
**Effective Date:** October 2026  

---

## 1. Overview and Operational Principles

In Kenyan public and faith-based healthcare facilities, intermittent power disruptions, fiber cuts, or infrastructure maintenance can interrupt digital systems. Clinical care and patient safety must continue uninterrupted.

### 1.1 Core Principles
1. **Patient Safety First:** Clinical intervention, emergency triage, resuscitation, and urgent medication administration must never be delayed due to system unavailability.
2. **Standardized Paper Trail:** All departments must maintain a physical **Downtime Stationery Pack** with pre-printed emergency forms.
3. **Strict Catch-Up Reconciliation:** Every paper document generated during downtime must be retrospectively reconciled and transcribed into the HMIS once the system is restored.

---

## 2. Downtime Roles & Command Hierarchy

During declared downtime:
- **Downtime Coordinator (Hospital Admin on Duty):** Declares downtime status; coordinates physical runners; tracks outage duration.
- **Health Records (HIM) Lead:** Issues emergency paper chart binders; manages sequential downtime registration numbers (`DT-YYYY-XXXX`).
- **Department Shift Leads:** Ensure staff switch to standardized paper downtime forms; supervise paper prescription and lab request logging.
- **ICT Systems Lead:** Investigates root cause; coordinates power generator/network recovery; provides estimated time to restoration (ETR).

---

## 3. Standardized Printable Downtime Clinical Forms

Each clinical station must maintain at least 100 printed copies of these emergency templates:

### Form DT-01: Emergency Triage & Vitals Form
```
================================================================================
                    [HOSPITAL NAME] - EMERGENCY DOWNTIME TRIAGE FORM
                                     Form ID: DT-01
================================================================================
Downtime Tracking No: DT-________    Date: ___/___/2026   Time: ___:___ EAT
Temporary Patient ID / Name: __________________________________________________
Age: ______   Gender: [ ] M  [ ] F   Contact Phone: ___________________________
National ID / Birth Cert: ______________________________________________________

TRIAGE VITALS:
Temperature: ______ °C          Blood Pressure: ______ / ______ mmHg
Heart Rate:  ______ bpm         Respiratory Rate: ______ bpm
SpO2:        ______ %           Weight: ______ kg       Height: ______ cm

TRIAGE CATEGORY:
[ ] RED (Resuscitation)    [ ] AMBER (Very Urgent)    [ ] YELLOW (Urgent)    [ ] GREEN (Standard)

KNOWN ALLERGIES: ______________________________________________________________
CHIEF COMPLAINTS: _____________________________________________________________

Triage Officer Name: _______________________ Cadre: ________ Signature: _______
================================================================================
```

---

### Form DT-02: Outpatient Clinical Encounter & Prescription Form
```
================================================================================
             [HOSPITAL NAME] - OPD CLINICAL ENCOUNTER & PRESCRIPTION
                                     Form ID: DT-02
================================================================================
Patient Name: _________________________________ Downtime No: DT-_______________
Age: ______  Sex: _____  Date: ___/___/2026  Time: ___:___ EAT  Dept: OPD Clinic

HISTORY & PHYSICAL EXAMINATION:
________________________________________________________________________________
________________________________________________________________________________
________________________________________________________________________________

WORKING DIAGNOSIS (ICD-11 / Clinical): ________________________________________

EMERGENCY PRESCRIPTION (To Pharmacy):
Item  Medication & Strength        Dose     Route   Freq     Duration   Qty Disp
1.    __________________________   ______   _____   ______   ________   ________
2.    __________________________   ______   _____   ______   ________   ________
3.    __________________________   ______   _____   ______   ________   ________

Ordering Clinician: ____________________ KMPDC/Reg: _________ Sign: ____________
Pharmacy Dispensing Officer: ___________ PPB Reg: ___________ Sign: ____________
================================================================================
```

---

### Form DT-03: Urgent Laboratory Requisition & Result Form
```
================================================================================
             [HOSPITAL NAME] - URGENT LAB REQUISITION & RESULT FORM
                                     Form ID: DT-03
================================================================================
Patient Name: _________________________________ Downtime No: DT-_______________
Ward / Clinic: ________________________________ Ordering Doctor: ________________
Sample Collection Time: ___:___ EAT            Specimen Type: [ ] Blood [ ] Urine

TESTS REQUESTED:
[ ] Full Blood Count (FBC)    [ ] Malaria Slide/RDT       [ ] Blood Sugar (RBS)
[ ] Urinalysis                [ ] U/E/Cr (Renal Panel)     [ ] Liver Function Tests
[ ] Other: ____________________________________________________________________

LABORATORY RESULT ENTRY (Technologist):
Test Name                 Result Value        Reference Range       Flag (H/L/C)
_______________________   _________________   ___________________   ____________
_______________________   _________________   ___________________   ____________

Technologist Name: __________________ Licence No: _________ Sign: ______________
Verification Timestamp: ___/___/2026 ___:___ EAT
================================================================================
```

---

### Form DT-05: Inpatient Admission & Medication Administration Record (MAR)
```
================================================================================
          [HOSPITAL NAME] - INPATIENT ADMISSION & MEDICATION RECORD (MAR)
                                     Form ID: DT-05
================================================================================
Patient Name: _________________________________ Downtime No: DT-_______________
Admitted Ward: _________________ Bed No: _______ Date/Time: ___/___/2026 ___:___
Admitting Diagnosis: ___________________________ Attending Doctor: _____________

MEDICATION ADMINISTRATION RECORD (MAR):
Medication & Dose        Sched Time    Given Time    Nurse Initials   Remarks
______________________   __________    __________    ______________   __________
______________________   __________    __________    ______________   __________
______________________   __________    __________    ______________   __________
______________________   __________    __________    ______________   __________
================================================================================
```

---

## 4. Emergency Read-Only Access & Data Availability

During planned or localized network interruptions where local hospital LAN or battery-powered laptop carts remain functional:
1. **Emergency Read-Only Summary:** The HMIS supports exporting an offline-cached JSON/PDF emergency summary containing active inpatient bed lists, current admitted diagnoses, and recorded allergies.
2. **Access Security:** Emergency read-only dumps are encrypted with the medical superintendent's key and stored exclusively on secure hospital-managed triage terminals.

---

## 5. Post-Downtime System Restoration & Catch-Up Reconciliation

Once ICT declares the HMIS fully restored and operational:

### 5.1 Step 1: Physical Paper Marshalling
The Downtime Coordinator and HIM Lead collect all physical forms (DT-01 to DT-06) from Triage, OPD, Lab, Pharmacy, and Cashier stations. Forms are stamped with the physical intake time.

### 5.2 Step 2: Patient Matching & Registration
1. HIM Officers search the Master Patient Index (MPI) for each patient using National ID, HUDUMA/CR ID, or Name + DOB.
2. If the patient is existing, open the patient chart. If new, register the patient and record the downtime tracking number (`DT-XXXX`) in the registration notes.

### 5.3 Step 3: Retrospective Back-Entry (Chronological Catch-Up)
1. **Encounters & Clinical Notes:** Transcribe clinical notes and ICD-11 diagnoses, setting the historical timestamp to match the downtime paper slip. Select the `Downtime Catch-up` tag.
2. **Laboratory & Diagnostic Orders:** Back-enter orders, results, and technologist verifications.
3. **Pharmacy Dispenses:** Reconcile dispensed medication batches against physical pharmacy inventory.
4. **Billing & Receipts:** Transcribe paper receipt numbers into patient invoices to match cashier cash balances.

### 5.4 Step 4: Verification and Quality Audit
The Clinical Director and HIM Officer review back-entered charts against paper files. Once verified, physical downtime forms are archived in the patient's permanent paper folder under the statutory 20-year retention rule.
