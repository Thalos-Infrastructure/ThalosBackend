/**
 * Single source of truth for the app-JWT contract shared with the Next BFF
 * (ThalosFrontend). The BFF *mints* the token, Nest only *verifies* it, so the
 * two sides must agree on three things:
 *
 *   1. the signing algorithm      → {@link APP_JWT_ALGORITHM} (HS256)
 *   2. the shared secret          → {@link APP_JWT_SECRET_ENV_VARS}
 *   3. the required claim         → `sub` (the Thalos user id)
 *
 * Everything that needs the shared secret (the passport strategy and the
 * wallet-ownership challenge HMAC) resolves it through {@link resolveAppJwtSecret}
 * so a mismatch can only ever come from the environment, never from the code.
 *
 * The secret value itself is never logged or returned in an error message —
 * only the variable *names* are, which is what an operator needs to fix it.
 */

/** The only algorithm accepted for app JWTs; `none` and RSA variants are rejected. */
export const APP_JWT_ALGORITHM = 'HS256' as const;

/**
 * Environment variables holding the shared HS256 secret, in resolution order.
 *
 * `SUPABASE_JWT_SECRET` is the canonical name — it is what the Next BFF signs
 * with. `JWT_SECRET` is kept as a fallback so existing deployments (and the
 * older `.env` files documented in the README) keep working unchanged.
 */
export const APP_JWT_SECRET_ENV_VARS = ['SUPABASE_JWT_SECRET', 'JWT_SECRET'] as const;

/** Reads one environment variable. Lets callers pass a Nest `ConfigService`. */
export type EnvReader = (key: string) => string | undefined;

const defaultEnvReader: EnvReader = (key) => process.env[key];

export class MissingAppJwtSecretError extends Error {
  constructor() {
    super(
      `No app JWT secret configured: set ${APP_JWT_SECRET_ENV_VARS.join(' or ')}. ` +
        `It must be byte-identical to the secret the Next BFF signs with, ` +
        `otherwise every authenticated request fails with 401.`,
    );
    this.name = 'MissingAppJwtSecretError';
  }
}

/**
 * Resolve the shared HS256 secret, together with the variable it came from.
 *
 * Blank / whitespace-only values are treated as unset: an empty `JWT_SECRET`
 * would otherwise make `jsonwebtoken` verify against an empty key instead of
 * failing fast.
 *
 * @throws {MissingAppJwtSecretError} when no variable holds a usable value.
 */
export function resolveAppJwtSecretSource(read: EnvReader = defaultEnvReader): {
  secret: string;
  source: (typeof APP_JWT_SECRET_ENV_VARS)[number];
} {
  for (const source of APP_JWT_SECRET_ENV_VARS) {
    const secret = read(source)?.trim();
    if (secret) {
      return { secret, source };
    }
  }
  throw new MissingAppJwtSecretError();
}

/**
 * Resolve the shared HS256 secret used to verify Next-minted app JWTs and to
 * HMAC wallet-ownership challenges.
 *
 * @throws {MissingAppJwtSecretError} when no variable holds a usable value.
 */
export function resolveAppJwtSecret(read: EnvReader = defaultEnvReader): string {
  return resolveAppJwtSecretSource(read).secret;
}
