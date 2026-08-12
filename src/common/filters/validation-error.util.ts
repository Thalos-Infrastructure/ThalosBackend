/**
 * Standardized validation error contract used across all Agreement write paths.
 *
 * Shape (consumed by the frontend):
 *   { success: false, error: { code: string, details: { field, code, message }[] } }
 *
 * This is the single source of truth for how validation failures are reported —
 * whether they originate from the centralized validator, a controller guard,
 * or an inline business-rule check.
 */
export interface ValidationErrorDetail {
  field: string;
  code: string;
  message: string;
}

export interface ValidationError {
  code: string;
  details: ValidationErrorDetail[];
}

export interface ValidationFailure {
  success: false;
  error: ValidationError;
}

/** Build a standardized validation failure from a list of details. */
export function validationFailure(
  details: ValidationErrorDetail[],
  code = 'VALIDATION_ERROR',
): ValidationFailure {
  return { success: false, error: { code, details } };
}

/** Build a single-field validation failure (convenience). */
export function fieldError(field: string, code: string, message: string): ValidationFailure {
  return validationFailure([{ field, code, message }]);
}

/** Type guard: is this object a standardized validation failure? */
export function isValidationFailure(obj: unknown): obj is ValidationFailure {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'success' in obj &&
    obj.success === false &&
    'error' in obj &&
    typeof (obj as { error: unknown }).error === 'object' &&
    (obj as { error: { code?: unknown } }).error !== null &&
    'code' in (obj as { error: Record<string, unknown> }).error &&
    'details' in (obj as { error: Record<string, unknown> }).error &&
    Array.isArray((obj as { error: { details: unknown } }).error.details)
  );
}
