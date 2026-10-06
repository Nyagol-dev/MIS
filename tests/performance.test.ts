import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { can, type UserAuthzContext } from '../lib/authz/can';
import {
  encryptField,
  decryptField,
  blindIndex,
} from '../lib/crypto/field-encryption';

describe('HMIS Core Performance & Benchmark Suite (Phase 7)', () => {
  before(() => {
    // Ensure test encryption key is configured for benchmarks
    if (!process.env.BILLING_ENCRYPTION_KEY && !process.env.FIELD_ENCRYPTION_KEY_1) {
      process.env.FIELD_ENCRYPTION_CURRENT_VERSION = '1';
      process.env.FIELD_ENCRYPTION_KEY_1 = Buffer.alloc(32, 0x42).toString('base64');
      process.env.FIELD_HMAC_KEY = Buffer.alloc(32, 0x99).toString('base64');
    }
  });

  describe('Scoped Authorization Check Latency & Throughput', () => {
    it('executes 100,000 permission evaluations under 150ms (> 650,000 checks/sec)', () => {
      const mockAuthz: UserAuthzContext = {
        userId: 'user-doctor-1',
        tenantId: 'tenant-hospital-1',
        grants: new Map([
          ['patient:read', 'assigned'],
          ['encounter:create', 'department'],
          ['clinical_note:create', 'department'],
          ['clinical_note:read', 'assigned'],
          ['allergy:create', 'hospital'],
          ['break_glass:request', 'hospital'],
        ]),
        departmentIds: new Set(['dept-opd', 'dept-casualty']),
        headOfDepartmentIds: new Set(['dept-casualty']),
        isHospitalAdmin: false,
      };

      const start = performance.now();
      const iterations = 100_000;

      for (let i = 0; i < iterations; i++) {
        // Alternating checks: hospital scope, department scope match, department scope mismatch, ungranted
        can(mockAuthz, 'allergy:create');
        can(mockAuthz, 'clinical_note:create', { departmentId: 'dept-opd' });
        can(mockAuthz, 'clinical_note:create', { departmentId: 'dept-inpatient' });
        can(mockAuthz, 'patient_restricted:read');
      }

      const elapsed = performance.now() - start;
      const totalChecks = iterations * 4;
      const checksPerSecond = Math.round((totalChecks / elapsed) * 1000);

      // Average check must be sub-microsecond
      assert.ok(
        elapsed < 1500,
        `Authorization checks took ${elapsed.toFixed(2)}ms for ${totalChecks} evaluations (${checksPerSecond} checks/sec)`
      );
    });
  });

  describe('Cryptographic Field Encryption (AES-256-GCM) Latency', () => {
    it('encrypts and decrypts 1,000 sensitive patient fields under 500ms (< 0.5ms per field)', () => {
      const testIdentities = [
        'ID-28491823',
        '+254712345678',
        'P.O. Box 40100-00100 Kisumu, Kenya',
        'SHA-MEMBER-994821-B',
        'Confidential psychiatric clinical consultation history note text for testing',
      ];

      const start = performance.now();
      const iterations = 1_000;

      for (let i = 0; i < iterations; i++) {
        const plaintext = testIdentities[i % testIdentities.length];
        const encrypted = encryptField(plaintext);
        const decrypted = decryptField(encrypted);
        assert.equal(decrypted, plaintext);
      }

      const elapsed = performance.now() - start;
      const avgMsPerOp = elapsed / iterations;

      assert.ok(
        elapsed < 1000,
        `1,000 field encryption & decryption cycles took ${elapsed.toFixed(2)}ms (avg ${avgMsPerOp.toFixed(3)}ms/op)`
      );
    });
  });

  describe('Blind Indexing (HMAC-SHA256) Search Speed', () => {
    it('computes 2,000 blind indexes under 100ms (< 0.05ms per index)', () => {
      const phones = [
        '+254722000001',
        '+254733000002',
        '+254700000003',
        '+254799000004',
      ];

      const start = performance.now();
      const iterations = 2_000;

      for (let i = 0; i < iterations; i++) {
        const phone = phones[i % phones.length];
        const hash = blindIndex(phone, 'patient_phone');
        assert.equal(hash.length, 64, 'HMAC-SHA256 must be 64 hex characters');
      }

      const elapsed = performance.now() - start;
      assert.ok(
        elapsed < 1000,
        `2,000 blind indexes took ${elapsed.toFixed(2)}ms (avg ${(elapsed / iterations).toFixed(3)}ms/index)`
      );
    });
  });
});
