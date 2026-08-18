/**
 * Shared-secret resolution contract (GF-8-BE).
 *
 * The Next BFF signs the app JWT with `SUPABASE_JWT_SECRET`; Nest must verify
 * with the very same value. These tests pin the resolution order and the
 * fail-fast behaviour, and assert that no error path leaks the secret itself.
 */
import {
  APP_JWT_ALGORITHM,
  APP_JWT_SECRET_ENV_VARS,
  MissingAppJwtSecretError,
  resolveAppJwtSecret,
  resolveAppJwtSecretSource,
} from './app-jwt.contract';

const SUPABASE_SECRET = 'supabase-jwt-secret-32-chars-minimum!!';
const LEGACY_SECRET = 'legacy-jwt-secret-32-chars-minimum!!!!';

/** Build an env reader over a plain object, like `process.env` but hermetic. */
const readerFor = (env: Record<string, string | undefined>) => (key: string) => env[key];

describe('app JWT secret resolution', () => {
  it('prefers SUPABASE_JWT_SECRET — the name the Next BFF signs with', () => {
    const { secret, source } = resolveAppJwtSecretSource(
      readerFor({ SUPABASE_JWT_SECRET: SUPABASE_SECRET, JWT_SECRET: LEGACY_SECRET }),
    );
    expect(secret).toBe(SUPABASE_SECRET);
    expect(source).toBe('SUPABASE_JWT_SECRET');
  });

  it('falls back to JWT_SECRET so existing deployments keep working', () => {
    const { secret, source } = resolveAppJwtSecretSource(readerFor({ JWT_SECRET: LEGACY_SECRET }));
    expect(secret).toBe(LEGACY_SECRET);
    expect(source).toBe('JWT_SECRET');
  });

  it('treats a blank value as unset instead of verifying against an empty key', () => {
    const { secret, source } = resolveAppJwtSecretSource(
      readerFor({ SUPABASE_JWT_SECRET: '   ', JWT_SECRET: LEGACY_SECRET }),
    );
    expect(secret).toBe(LEGACY_SECRET);
    expect(source).toBe('JWT_SECRET');
  });

  it('trims surrounding whitespace (a trailing newline in .env would break HS256)', () => {
    expect(resolveAppJwtSecret(readerFor({ SUPABASE_JWT_SECRET: `${SUPABASE_SECRET}\n` }))).toBe(
      SUPABASE_SECRET,
    );
  });

  it('throws MissingAppJwtSecretError when neither variable is set', () => {
    expect(() => resolveAppJwtSecret(readerFor({}))).toThrow(MissingAppJwtSecretError);
  });

  it('names both variables in the error, and never the secret value', () => {
    let message = '';
    try {
      resolveAppJwtSecret(readerFor({ SUPABASE_JWT_SECRET: '' }));
    } catch (err) {
      message = String(err);
    }
    for (const name of APP_JWT_SECRET_ENV_VARS) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain(SUPABASE_SECRET);
    expect(message).not.toContain(LEGACY_SECRET);
  });

  it('reads process.env by default', () => {
    const previous = process.env.SUPABASE_JWT_SECRET;
    process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;
    try {
      expect(resolveAppJwtSecret()).toBe(SUPABASE_SECRET);
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = previous;
    }
  });

  it('pins HS256 as the only accepted algorithm', () => {
    expect(APP_JWT_ALGORITHM).toBe('HS256');
  });
});
