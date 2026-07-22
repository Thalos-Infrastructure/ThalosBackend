import {
  AGREEMENT_STATUSES,
  AGREEMENT_TRANSITIONS,
  isAgreementStatus,
  type AgreementStatus,
} from './agreement-lifecycle';

export interface ValidationErrorDetail {
  field: string;
  code: string;
  message: string;
}

export interface ValidationError {
  code: string;
  details: ValidationErrorDetail[];
}

export interface ValidationResult {
  success: boolean;
  error?: ValidationError;
}

export interface MilestoneInput {
  description: string;
  amount?: string | null;
  status?: string;
}

export interface AgreementInput {
  title: string;
  description?: string;
  amount: string;
  asset?: string;
  agreement_type?: string;
  milestones?: MilestoneInput[];
  participants: Array<{ wallet_address: string; role?: string }>;
}

export interface AgreementSnapshot {
  amount: string;
  milestones: MilestoneInput[];
  agreement_type?: string;
}

const AMOUNT_REGEX = /^\d+(\.\d+)?$/;

function toCents(s: string): number {
  return Math.round(parseFloat(s) * 100);
}

function addError(details: ValidationErrorDetail[], field: string, code: string, message: string) {
  details.push({ field, code, message });
}

function errResult(details: ValidationErrorDetail[], code = 'VALIDATION_ERROR'): ValidationResult {
  return { success: false, error: { code, details } };
}

function okResult(): ValidationResult {
  return { success: true };
}

function isValidPositiveNumeric(s: string): boolean {
  if (!AMOUNT_REGEX.test(s)) return false;
  return Number(s) > 0;
}

export function validateAgreement(input: AgreementInput): ValidationResult {
  const errors: ValidationErrorDetail[] = [];

  if (!input.title || input.title.trim().length === 0) {
    addError(errors, 'title', 'REQUIRED', 'Title is required and must be non-empty');
  }

  if (input.description !== undefined && input.description !== null && input.description.trim().length === 0) {
    addError(errors, 'description', 'INVALID', 'Description must be non-empty if provided');
  }

  if (!isValidPositiveNumeric(input.amount)) {
    addError(errors, 'amount', 'INVALID_AMOUNT', 'Amount must be a positive numeric string');
  }

  const asset = input.asset ?? 'USDC';
  if (asset !== 'USDC') {
    addError(errors, 'asset', 'INVALID_ASSET', 'Only USDC is supported');
  }

  const milestones = input.milestones ?? [];
  if (milestones.length > 0) {
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (!m.description || m.description.trim().length === 0) {
        addError(errors, `milestones[${i}].description`, 'REQUIRED', 'Milestone description must be non-empty');
      }
      if (m.amount === undefined || m.amount === null) {
        addError(errors, `milestones[${i}].amount`, 'REQUIRED', 'Milestone amount is required');
      } else if (!isValidPositiveNumeric(m.amount)) {
        addError(errors, `milestones[${i}].amount`, 'INVALID_AMOUNT', 'Milestone amount must be a positive numeric string');
      }
    }

    if (errors.length === 0 && milestones.length > 0) {
      const totalCents = toCents(input.amount);
      const milestoneSumCents = milestones.reduce((sum, m) => sum + toCents(m.amount as string), 0);
      if (totalCents !== milestoneSumCents) {
        addError(
          errors,
          'milestones',
          'MILESTONE_SUM_MISMATCH',
          `Sum of milestone amounts (${(milestoneSumCents / 100).toFixed(2)}) does not equal total amount (${(totalCents / 100).toFixed(2)})`,
        );
      }
    }

    if (milestones.length > 1) {
      if (input.agreement_type !== 'multi') {
        addError(
          errors,
          'agreement_type',
          'INVALID_AGREEMENT_TYPE',
          'Agreement with multiple milestones must have agreement_type "multi"',
        );
      }
    } else {
      if (input.agreement_type === 'multi') {
        addError(
          errors,
          'agreement_type',
          'INVALID_AGREEMENT_TYPE',
          'Agreement with a single milestone must have agreement_type "single"',
        );
      }
    }
  }

  if (!input.participants || input.participants.length === 0) {
    addError(errors, 'participants', 'REQUIRED', 'At least one participant is required');
  } else {
    for (let i = 0; i < input.participants.length; i++) {
      if (!input.participants[i].wallet_address || input.participants[i].wallet_address.trim().length === 0) {
        addError(errors, `participants[${i}].wallet_address`, 'REQUIRED', 'Participant wallet address must be non-empty');
      }
    }
  }

  return errors.length > 0 ? errResult(errors) : okResult();
}

export function validateTransition(from: string, to: string): ValidationResult {
  const errors: ValidationErrorDetail[] = [];

  if (!isAgreementStatus(from)) {
    addError(errors, 'status', 'INVALID_STATUS', `"${from}" is not a valid agreement status`);
  }
  if (!isAgreementStatus(to)) {
    addError(errors, 'status', 'INVALID_STATUS', `"${to}" is not a valid agreement status`);
  }
  if (errors.length > 0) {
    return errResult(errors);
  }

  if (!AGREEMENT_TRANSITIONS[from as AgreementStatus].includes(to as AgreementStatus)) {
    const allowed = AGREEMENT_TRANSITIONS[from as AgreementStatus];
    const allowedText = allowed.length > 0 ? allowed.join(', ') : 'none (terminal status)';
    addError(
      errors,
      'status',
      'INVALID_TRANSITION',
      `Invalid status transition "${from}" → "${to}". Allowed from "${from}": ${allowedText}`,
    );
  }

  return errors.length > 0 ? errResult(errors) : okResult();
}

export function validateAgreementConsistency(agreement: AgreementSnapshot): ValidationResult {
  const errors: ValidationErrorDetail[] = [];

  if (!isValidPositiveNumeric(agreement.amount)) {
    addError(errors, 'amount', 'INCONSISTENT_AMOUNT', 'Agreement amount is not a positive numeric string');
  }

  const milestones = agreement.milestones ?? [];
  for (let i = 0; i < milestones.length; i++) {
    const m = milestones[i];
    if (m.description !== undefined && m.description !== null && m.description.trim().length === 0) {
      addError(errors, `milestones[${i}].description`, 'INCONSISTENT', 'Milestone description is empty');
    }
    if (m.amount === undefined || m.amount === null) {
      addError(errors, `milestones[${i}].amount`, 'INCONSISTENT', 'Milestone amount is missing');
    } else if (!isValidPositiveNumeric(m.amount)) {
      addError(errors, `milestones[${i}].amount`, 'INCONSISTENT_AMOUNT', 'Milestone amount is not a positive numeric string');
    }
  }

  if (errors.length === 0 && milestones.length > 0) {
    const totalCents = toCents(agreement.amount);
    const milestoneSumCents = milestones.reduce((sum, m) => sum + toCents(m.amount as string), 0);
    if (totalCents !== milestoneSumCents) {
      addError(
        errors,
        'milestones',
        'MILESTONE_SUM_MISMATCH',
        `Sum of milestone amounts (${(milestoneSumCents / 100).toFixed(2)}) does not equal total amount (${(totalCents / 100).toFixed(2)})`,
      );
    }
  }

  return errors.length > 0 ? errResult(errors) : okResult();
}
