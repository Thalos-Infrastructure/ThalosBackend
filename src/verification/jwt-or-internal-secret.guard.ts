import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * Lets a request through when EITHER:
 *  - it carries a valid internal service secret (`x-thalos-internal-secret`) —
 *    a trusted server-to-server consumer such as Agreements or Reputation; the
 *    request is flagged `req.isInternalService = true`, or
 *  - it carries a valid app JWT (delegated to {@link JwtAuthGuard}, which
 *    populates `req.user`).
 *
 * This only decides *authentication*. Fine-grained authorization (the caller may
 * only read a subject they own, or must be an admin) is enforced in
 * `VerificationService.assertCanRead`.
 */
@Injectable()
export class JwtOrInternalSecretGuard implements CanActivate {
  private readonly jwtGuard = new JwtAuthGuard();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { isInternalService?: boolean }>();

    const expected = process.env.THALOS_INTERNAL_SECRET;
    const header = req.headers['x-thalos-internal-secret'];
    const value = Array.isArray(header) ? header[0] : header;

    if (expected && value && value === expected) {
      req.isInternalService = true;
      return true;
    }

    return (await this.jwtGuard.canActivate(context)) as boolean;
  }
}
