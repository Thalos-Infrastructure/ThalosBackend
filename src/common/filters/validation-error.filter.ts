import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { isValidationFailure, ValidationFailure } from './validation-error.util';

/**
 * Normalizes every validation failure into the single, machine-readable contract
 * the frontend consumes:
 *
 *   { success: false, error: { code: string, details: { field, code, message }[] } }
 *
 * Without this filter, NestJS wraps `BadRequestException({ success: false, error })`
 * into `{ statusCode, message: { success: false, error }, error: 'Bad Request' }`,
 * which breaks the frontend's error renderer.
 *
 * The filter handles three cases:
 *  1. The exception response is already a standardized ValidationFailure → pass through.
 *  2. The exception response is a plain string → wrap as a single-field VALIDATION_ERROR.
 *  3. The exception response is an object with `message`/`details` → normalize into the contract.
 */
@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    const raw = exception.getResponse();
    let body: ValidationFailure;

    if (isValidationFailure(raw)) {
      body = raw;
    } else if (typeof raw === 'string') {
      body = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: [{ field: 'body', code: 'VALIDATION_ERROR', message: raw }],
        },
      };
    } else if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      const details = Array.isArray(obj.details)
        ? (obj.details as Array<{ field?: string; code?: string; message?: string }>).map((d) => ({
            field: d.field ?? 'body',
            code: d.code ?? 'VALIDATION_ERROR',
            message: d.message ?? JSON.stringify(d),
          }))
        : [
            {
              field: 'body',
              code: 'VALIDATION_ERROR',
              message: obj.message
                ? typeof obj.message === 'string'
                  ? obj.message
                  : JSON.stringify(obj.message)
                : JSON.stringify(obj),
            },
          ];
      body = {
        success: false,
        error: {
          code: obj.code
            ? typeof obj.code === 'string'
              ? obj.code
              : JSON.stringify(obj.code)
            : 'VALIDATION_ERROR',
          details,
        },
      };
    } else {
      body = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: [{ field: 'body', code: 'VALIDATION_ERROR', message: String(raw) }],
        },
      };
    }

    response.status(status).json(body);
  }
}
