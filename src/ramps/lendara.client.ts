import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { isMainnet } from '../internal-trustless/escrow-write.helper';

/**
 * The only place Thalos talks to Lendara.
 *
 * Shaped after `trustless-relay.helper.ts`: one egress point, the API key read
 * from the environment and never leaving the server, and the base URL
 * configurable per environment. Deliberately plain `fetch` rather than the
 * `@lendara/ramp` SDK — that package is at 0.1.1 and published from a preview
 * deployment, and two REST calls do not justify the dependency.
 */

const DEFAULT_BASE_URL = 'https://lendaraweb-production.up.railway.app';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Sandbox key used when `LENDARA_API_KEY` is unset, so the demo runs without
 * per-environment configuration.
 *
 * It is a test key: the fiat is simulated and the USDC has no value. It is
 * still a credential, it is in a public repository, and git history cannot be
 * rewritten — rotate it once the demo is over.
 *
 * Only ever used on testnet. On mainnet a missing key is an error, because
 * falling back to a sandbox project there would point real users at simulated
 * money.
 */
const SANDBOX_API_KEY = 'lnd_test_K3J365P7K55526TJUFRPLHZ5GF'; // gitleaks:allow

/** What Lendara returns when a session is created. */
export interface LendaraSession {
  id: string;
  url: string;
  expires_at?: string;
}

/**
 * A transaction as Lendara reports it — the SEP-24 schema, confirmed against
 * the published types of `@lendara/widget`.
 *
 * Everything is optional anyway: the REST response is not guaranteed to match
 * the widget's postMessage payload field for field, and the verifier treats
 * anything it cannot read as "not verified" rather than assuming success.
 */
export interface LendaraTransaction {
  id?: string;
  kind?: string;
  status?: string;
  stellar_transaction_id?: string;
  /** Destination Stellar account (SEP-24 names it `to`). */
  to?: string;
  /** What was delivered, as `stellar:<CODE>:<ISSUER>` per SEP-38. */
  amount_out_asset?: string;
  amount_out?: string;
  amount_in?: string;
  amount_in_asset?: string;
  completed_at?: string;
  /** Older/alternative spellings, kept as fallbacks. */
  destination?: string;
  account?: string;
  asset_issuer?: string;
}

/**
 * The issuer out of a SEP-38 asset identifier (`stellar:USDC:GABC…`).
 *
 * Returns null for the native asset or anything unparseable, which the caller
 * treats as "not the escrow's asset" rather than guessing.
 */
export function issuerOf(asset: string | undefined): string | null {
  if (!asset) return null;
  const parts = asset.split(':');
  return parts.length === 3 && parts[0] === 'stellar' ? parts[2] : null;
}

@Injectable()
export class LendaraClient {
  private readonly logger = new Logger(LendaraClient.name);

  private baseUrl(): string {
    return (process.env.LENDARA_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private warnedAboutFallback = false;

  private apiKey(): string {
    const key = process.env.LENDARA_API_KEY?.trim();
    if (key) return key;

    if (isMainnet()) {
      // A missing key is a deployment problem; say so rather than quietly
      // serve real users from a sandbox project.
      throw new ServiceUnavailableException(
        'LENDARA_API_KEY is not configured, so the on-ramp is unavailable.',
      );
    }

    if (!this.warnedAboutFallback) {
      this.warnedAboutFallback = true;
      this.logger.warn(
        'LENDARA_API_KEY is not set — using the built-in sandbox key. Set the variable before relying on this.',
      );
    }
    return SANDBOX_API_KEY;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new ServiceUnavailableException('Could not reach Lendara. Try again in a moment.');
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    // Non-JSON bodies come back as the raw text: the caller treats anything it
    // cannot read as unverified, so a surprise HTML error page is not fatal.
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      this.logger.error(
        `Lendara ${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`,
      );
      throw new ServiceUnavailableException(`Lendara rejected the request (${response.status}).`);
    }

    return data as T;
  }

  /** Create an on-ramp session for `account`. The URL is single-use and expires. */
  createSession(params: {
    account: string;
    fiat_currency: string;
    amount: string;
  }): Promise<LendaraSession> {
    return this.request<LendaraSession>('POST', '/v1/sessions', params);
  }

  /** The transaction behind a session, used to confirm the USDC actually landed. */
  getTransaction(sessionId: string): Promise<LendaraTransaction> {
    return this.request<LendaraTransaction>(
      'GET',
      `/v1/transactions/${encodeURIComponent(sessionId)}`,
    );
  }
}
