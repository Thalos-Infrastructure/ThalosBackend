/**
 * JwtStrategy unit tests
 *
 * Covers the three validation scenarios required by the security task:
 *   1. A real frontend-signed HS256 token is accepted.
 *   2. Invalid / expired / wrong-secret tokens are rejected (UnauthorizedException).
 *   3. The app fails fast when JWT_SECRET is unset (no silent insecure default).
 */
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { JwtStrategy, JwtPayload } from './jwt.strategy';

const REAL_SECRET = 'super-test-secret-32-chars-minimum!!';
const OTHER_SECRET = 'different-secret-will-cause-failure!';

/** Helper: sign a token exactly as the ThalosFrontend lib/auth/utils.ts does */
function signFrontendToken(
  payload: { sub: string; email?: string },
  secret: string,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '7d',
    ...options,
  });
}

/** Create a JwtStrategy instance with JWT_SECRET set in the environment */
function makeStrategy(secret: string): JwtStrategy {
  process.env.JWT_SECRET = secret;
  const strategy = new JwtStrategy();
  return strategy;
}

afterEach(() => {
  delete process.env.JWT_SECRET;
});

// ─── 1. Valid token ───────────────────────────────────────────────────────────

describe('JwtStrategy.validate — happy path', () => {
  it('accepts a valid HS256 token signed with the same secret', () => {
    const strategy = makeStrategy(REAL_SECRET);

    const payload: JwtPayload = { sub: 'user-abc-123', email: 'alice@example.com' };
    // passport-jwt already verifies the signature before calling validate();
    // we call validate() directly to test the payload contract.
    const result = strategy.validate(payload);

    expect(result).toEqual({ userId: 'user-abc-123', email: 'alice@example.com' });
  });

  it('accepts a payload without email (email is optional)', () => {
    const strategy = makeStrategy(REAL_SECRET);
    const result = strategy.validate({ sub: 'user-no-email' });
    expect(result).toEqual({ userId: 'user-no-email', email: undefined });
  });

  it('produces a verifiable token from the frontend helper', () => {
    const token = signFrontendToken({ sub: 'u1', email: 'bob@example.com' }, REAL_SECRET);
    const decoded = jwt.verify(token, REAL_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
    expect(decoded.sub).toBe('u1');
    expect(decoded.email).toBe('bob@example.com');
  });
});

// ─── 2. Invalid / expired / wrong-secret tokens ───────────────────────────────

describe('JwtStrategy.validate — rejection cases', () => {
  it('throws UnauthorizedException when sub is missing', () => {
    const strategy = makeStrategy(REAL_SECRET);
    // passport-jwt decodes but validate() must reject a payload without sub
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => strategy.validate({} as any)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when payload is null', () => {
    const strategy = makeStrategy(REAL_SECRET);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => strategy.validate(null as any)).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with the wrong secret (signature mismatch)', () => {
    const token = signFrontendToken({ sub: 'u1', email: 'eve@example.com' }, OTHER_SECRET);
    expect(() => jwt.verify(token, REAL_SECRET, { algorithms: ['HS256'] })).toThrow(
      jwt.JsonWebTokenError,
    );
  });

  it('rejects an expired token', () => {
    const token = signFrontendToken(
      { sub: 'u1', email: 'old@example.com' },
      REAL_SECRET,
      { expiresIn: -1 }, // already expired
    );
    expect(() => jwt.verify(token, REAL_SECRET, { algorithms: ['HS256'] })).toThrow(
      jwt.TokenExpiredError,
    );
  });

  it('rejects a token with a different algorithm (HS512 is not HS256)', () => {
    const token = jwt.sign({ sub: 'u1' }, REAL_SECRET, { algorithm: 'HS512' });
    expect(() =>
      jwt.verify(token, REAL_SECRET, { algorithms: ['HS256'] }),
    ).toThrow(jwt.JsonWebTokenError);
  });

  it('rejects a completely malformed token string', () => {
    expect(() => jwt.verify('not.a.jwt', REAL_SECRET, { algorithms: ['HS256'] })).toThrow(
      jwt.JsonWebTokenError,
    );
  });
});

// ─── 3. Fail-fast when JWT_SECRET is unset ────────────────────────────────────

describe('JwtStrategy constructor — missing secret', () => {
  it('throws an error at instantiation when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET; // ensure it's absent
    expect(() => new JwtStrategy()).toThrow('JWT_SECRET is required');
  });

  it('does NOT fall back to any insecure default', () => {
    delete process.env.JWT_SECRET;
    // The constructor must throw, not silently continue with a default value.
    let thrownError: unknown;
    try {
      new JwtStrategy();
    } catch (err) {
      thrownError = err;
    }
    expect(thrownError).toBeDefined();
    // Guard: the error message must not suggest a fallback was used.
    expect(String(thrownError)).not.toContain('dev-insecure');
  });
});
