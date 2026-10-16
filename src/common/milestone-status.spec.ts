/**
 * Tests for the canonical milestone status enum and legacy value mapping.
 *
 * Covers:
 *  - All canonical statuses are recognized
 *  - Legacy TW values (e.g. "completed") map correctly
 *  - Unknown values return null
 *  - isMilestoneStatus type guard
 *  - Exhaustive enum coverage
 *
 * Issue: GF-4-BE / #142
 */
import {
  MILESTONE_STATUSES,
  MILESTONE_STATUS_LABELS,
  isMilestoneStatus,
  normalizeMilestoneStatus,
  milestoneStatusFromTrustless,
} from './milestone-status';

describe('MilestoneStatus (canonical enum)', () => {
  describe('MILESTONE_STATUSES constant', () => {
    it('contains exactly four statuses', () => {
      expect(MILESTONE_STATUSES).toHaveLength(4);
    });

    it('includes all expected statuses', () => {
      expect(MILESTONE_STATUSES).toContain('pending');
      expect(MILESTONE_STATUSES).toContain('approved');
      expect(MILESTONE_STATUSES).toContain('released');
      expect(MILESTONE_STATUSES).toContain('rejected');
    });

    it('does not include legacy TW values', () => {
      expect(MILESTONE_STATUSES).not.toContain('completed');
      expect(MILESTONE_STATUSES).not.toContain('cancelled');
    });
  });

  describe('isMilestoneStatus()', () => {
    it.each(MILESTONE_STATUSES)('returns true for "%s"', (status) => {
      expect(isMilestoneStatus(status)).toBe(true);
    });

    it('returns false for legacy TW value "completed"', () => {
      expect(isMilestoneStatus('completed')).toBe(false);
    });

    it('returns false for unknown strings', () => {
      expect(isMilestoneStatus('unknown')).toBe(false);
      expect(isMilestoneStatus('')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isMilestoneStatus(null)).toBe(false);
      expect(isMilestoneStatus(undefined)).toBe(false);
      expect(isMilestoneStatus(42)).toBe(false);
    });
  });

  describe('normalizeMilestoneStatus()', () => {
    it.each(MILESTONE_STATUSES)('passes through canonical status "%s"', (status) => {
      expect(normalizeMilestoneStatus(status)).toBe(status);
    });

    it('does not treat TW "completed" (evidence delivered) as "released"', () => {
      expect(normalizeMilestoneStatus('completed')).toBeNull();
    });

    it('returns null for completely unknown values', () => {
      expect(normalizeMilestoneStatus('unknown')).toBeNull();
      expect(normalizeMilestoneStatus('')).toBeNull();
      expect(normalizeMilestoneStatus('CANCELLED')).toBeNull();
    });

    it('is case-sensitive (TW values are lowercase)', () => {
      expect(normalizeMilestoneStatus('Completed')).toBeNull();
      expect(normalizeMilestoneStatus('COMPLETED')).toBeNull();
    });
  });

  describe('MILESTONE_STATUS_LABELS', () => {
    it('has a label for every canonical status', () => {
      for (const status of MILESTONE_STATUSES) {
        expect(MILESTONE_STATUS_LABELS[status]).toBeDefined();
        expect(typeof MILESTONE_STATUS_LABELS[status]).toBe('string');
        expect(MILESTONE_STATUS_LABELS[status].length).toBeGreaterThan(0);
      }
    });

    it('labels are exhaustive (no extra keys)', () => {
      expect(Object.keys(MILESTONE_STATUS_LABELS).sort()).toEqual([...MILESTONE_STATUSES].sort());
    });
  });

  describe('milestoneStatusFromTrustless()', () => {
    it('evidence on an unfunded escrow stays pending (CA6DQZ… on testnet)', () => {
      expect(milestoneStatusFromTrustless({ status: 'completed', approved: false }, false)).toBe(
        'pending',
      );
    });

    it('is approved once the approver approved, whatever the text says', () => {
      expect(milestoneStatusFromTrustless({ status: 'completed', approved: true })).toBe(
        'approved',
      );
      expect(milestoneStatusFromTrustless({ status: 'completed', flags: { approved: true } })).toBe(
        'approved',
      );
    });

    it('is released only from a release flag', () => {
      expect(milestoneStatusFromTrustless({ status: 'completed', flags: { released: true } })).toBe(
        'released',
      );
      // single-release: TW flags the escrow, not the milestone
      expect(milestoneStatusFromTrustless({ status: 'completed', approved: true }, true)).toBe(
        'released',
      );
    });

    it('keeps an explicit rejection', () => {
      expect(milestoneStatusFromTrustless({ status: 'rejected' })).toBe('rejected');
    });
  });
});
