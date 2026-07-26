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
 * JWT_SECRET must be set in the environment — the app fails fast at startup if it is
 * missing (see JwtStrategy constructor).
 */
@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
