import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { APP_JWT_ALGORITHM, resolveAppJwtSecret } from './app-jwt.contract';

/**
 * Claims Nest relies on. The token is minted by the Next BFF; `sub` (Thalos
 * user id) is the only claim that is required, `email` is informational.
 */
export type JwtPayload = { sub: string; email?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    // Fails fast at startup when the shared secret is absent, so a
    // misconfigured deployment never boots into "every request is a 401".
    const secret = resolveAppJwtSecret();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      // Pinning the algorithm list is what stops an attacker from swapping the
      // header to `none` (or to an asymmetric alg) to bypass verification.
      algorithms: [APP_JWT_ALGORITHM],
    });
  }

  validate(payload: JwtPayload) {
    if (!payload?.sub) {
      throw new UnauthorizedException();
    }
    return { userId: payload.sub, email: payload.email };
  }
}
