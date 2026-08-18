import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * AuthModule wires up JWT verification via passport-jwt.
 *
 * Token *signing* is the frontend's responsibility (ThalosFrontend lib/auth/utils.ts).
 * The backend only verifies incoming HS256 tokens; JwtModule (signing helpers) is
 * therefore intentionally absent to keep the boundary clear.
 *
 * The shared HS256 secret (`SUPABASE_JWT_SECRET`, or the legacy `JWT_SECRET`) must be
 * set in the environment — the app fails fast at startup if it is missing (see
 * JwtStrategy constructor / `app-jwt.contract.ts`). The full contract is documented in
 * `docs/auth-contract.md`.
 */
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
