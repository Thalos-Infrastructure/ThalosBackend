/**
 * GF-8-BE — Nest verifies the JWT minted by the Next BFF.
 *
 * This boots a real Nest HTTP app (global prefix, real `JwtAuthGuard` /
 * `JwtStrategy` / passport-jwt) and drives it with tokens minted exactly the
 * way ThalosFrontend mints them — `jsonwebtoken.sign(payload, SUPABASE_JWT_SECRET,
 * { algorithm: 'HS256', expiresIn })` — so a secret or algorithm drift between
 * the two services fails here instead of in production.
 */
import 'reflect-metadata';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AuthModule } from './auth.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthUserCtx, CurrentUser } from './current-user.decorator';

const SHARED_SECRET = 'shared-supabase-jwt-secret-32-chars!!';
const OTHER_SECRET = 'a-different-secret-that-must-not-pass';
const USER_ID = 'e7d3c0f2-5f5a-4a1e-9f0a-2b7c4d6e8a10';

/** Mirror of the Next BFF token minting (ThalosFrontend `lib/auth/utils.ts`). */
function mintNextToken(
  payload: Record<string, unknown> = { sub: USER_ID, email: 'alice@example.com' },
  secret: string = SHARED_SECRET,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: '7d', ...options });
}

/** Minimal protected route: echoes what the guard put on the request. */
@Controller('probe')
@UseGuards(JwtAuthGuard)
class ProbeController {
  @Get()
  whoAmI(@CurrentUser() user: AuthUserCtx) {
    return user;
  }
}

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AuthModule],
    controllers: [ProbeController],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('v1');
  await app.init();
  return app;
}

describe('Next-minted app JWT — Nest verification contract', () => {
  let app: INestApplication;
  const previousEnv = {
    supabase: process.env.SUPABASE_JWT_SECRET,
    legacy: process.env.JWT_SECRET,
  };

  beforeAll(async () => {
    // Only the canonical name is set: this proves Nest reads the same variable
    // the Next BFF signs with, not the legacy fallback.
    process.env.SUPABASE_JWT_SECRET = SHARED_SECRET;
    delete process.env.JWT_SECRET;
    app = await bootApp();
  });

  afterAll(async () => {
    await app?.close();
    if (previousEnv.supabase === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = previousEnv.supabase;
    if (previousEnv.legacy === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousEnv.legacy;
  });

  // --- Accepted --------------------------------------------------------------

  it('accepts a valid Next-minted token and exposes sub as userId', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${mintNextToken()}`)
      .expect(200);

    expect(res.body).toEqual({ userId: USER_ID, email: 'alice@example.com' });
  });

  it('accepts a wallet-only token (no email claim)', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${mintNextToken({ sub: USER_ID })}`)
      .expect(200);

    expect(res.body.userId).toBe(USER_ID);
  });

  it('ignores extra BFF claims (wallet_public_key, wallet_provider, iss, aud)', async () => {
    const token = mintNextToken({
      sub: USER_ID,
      email: 'alice@example.com',
      wallet_public_key: 'GA7QYNF7SOWQ3GLR2BGMZEHHHVSH3VK4UFR2QPYDQGPHK3WSALDQXJZN',
      wallet_provider: 'accesly',
      iss: 'thalos-frontend',
      aud: 'thalos-backend',
    });

    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  // --- Rejected --------------------------------------------------------------

  it('rejects a token signed with a different secret', async () => {
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${mintNextToken(undefined, OTHER_SECRET)}`)
      .expect(401);
  });

  it('rejects an expired token', async () => {
    const token = mintNextToken(undefined, SHARED_SECRET, { expiresIn: -60 });
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token signed with another HMAC algorithm (HS512)', async () => {
    const token = jwt.sign({ sub: USER_ID }, SHARED_SECRET, { algorithm: 'HS512' });
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const token = jwt.sign({ sub: USER_ID }, '', { algorithm: 'none' });
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token whose payload was tampered with after signing', async () => {
    const [header, payload, signature] = mintNextToken().split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...(JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<
          string,
          unknown
        >),
        sub: 'attacker-user-id',
      }),
    ).toString('base64url');

    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${header}.${forged}.${signature}`)
      .expect(401);
  });

  it('rejects a token without a sub claim', async () => {
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${mintNextToken({ email: 'nobody@example.com' })}`)
      .expect(401);
  });

  it('rejects a malformed token', async () => {
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
  });

  it('rejects a request with no Authorization header', async () => {
    await request(app.getHttpServer()).get('/v1/probe').expect(401);
  });

  it('rejects a non-Bearer Authorization scheme', async () => {
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Basic ${Buffer.from('user:pass').toString('base64')}`)
      .expect(401);
  });
});

describe('Next-minted app JWT — legacy JWT_SECRET deployments', () => {
  let app: INestApplication;
  const previousEnv = {
    supabase: process.env.SUPABASE_JWT_SECRET,
    legacy: process.env.JWT_SECRET,
  };

  beforeAll(async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    process.env.JWT_SECRET = SHARED_SECRET;
    app = await bootApp();
  });

  afterAll(async () => {
    await app?.close();
    if (previousEnv.supabase === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = previousEnv.supabase;
    if (previousEnv.legacy === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousEnv.legacy;
  });

  it('still verifies tokens when only the legacy variable is configured', async () => {
    await request(app.getHttpServer())
      .get('/v1/probe')
      .set('Authorization', `Bearer ${mintNextToken()}`)
      .expect(200);
  });
});
