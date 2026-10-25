import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

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

/** What Lendara returns when a session is created. */
export interface LendaraSession {
  id: string;
  url: string;
  expires_at?: string;
}

/**
 * A transaction as Lendara reports it.
 *
 * The exact field names are **not** confirmed against a live sandbox run yet,
 * so every one is optional and the caller treats anything it cannot read as
 * "not verified" rather than assuming success.
 */
export interface LendaraTransaction {
  id?: string;
  status?: string;
  stellar_transaction_id?: string;
  /** Destination Stellar account, however Lendara names it. */
  account?: string;
  destination?: string;
  amount?: string | number;
  asset_code?: string;
  asset_issuer?: string;
}

@Injectable()
export class LendaraClient {
  private readonly logger = new Logger(LendaraClient.name);

  private baseUrl(): string {
    return (process.env.LENDARA_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private apiKey(): string {
    const key = process.env.LENDARA_API_KEY;
    if (!key) {
      // A missing key is a deployment problem; say so rather than send an
      // unauthenticated request and report whatever Lendara answers.
      throw new ServiceUnavailableException(
        'LENDARA_API_KEY is not configured, so the on-ramp is unavailable.',
      );
    }
    return key;
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
