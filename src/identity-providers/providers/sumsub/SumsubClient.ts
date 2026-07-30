import * as jwt from 'jsonwebtoken';

export interface SumsubConfig {
  apiKey: string;
  apiSecret?: string;
  baseUrl?: string;
  timeout?: number;
}

export class SumsubClient {
  private config: SumsubConfig;
  private baseUrl: string;

  constructor(config: SumsubConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'https://api.sumsub.com';
  }

  private createJwt(): string {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;
    if (!this.config.apiSecret) throw new Error('Sumsub apiSecret is required');
    return jwt.sign({ iat, exp }, this.config.apiSecret, { algorithm: 'HS256' });
  }

  private async request(
    method: string,
    path: string,
    data?: unknown,
    queryParams?: Record<string, string>,
  ): Promise<unknown> {
    const token = this.createJwt();
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const key of Object.keys(queryParams)) url.searchParams.append(key, queryParams[key]);
    }
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    };
    const res = await fetch(url.toString(), opts);
    if (!res.ok) throw new Error(`Sumsub API error: ${res.status} - ${await res.text()}`);
    return await res.json();
  }

  async createApplicant(userId: string, metadata?: unknown): Promise<unknown> {
    return await this.request('POST', '/resources/applicants', {
      externalUserId: userId,
      ...((metadata as Record<string, unknown>) ?? {}),
    });
  }
  async getApplicantStatus(applicantId: string): Promise<unknown> {
    return await this.request('GET', `/resources/applicants/${applicantId}/status`);
  }
  async getApplicantData(applicantId: string): Promise<unknown> {
    return await this.request('GET', `/resources/applicants/${applicantId}/one`);
  }
  async generateAccessToken(applicantId: string, levelName?: string): Promise<unknown> {
    return await this.request('POST', '/resources/accessTokens', {
      userIdInApp: applicantId,
      levelName: levelName || 'basic-kyc-level',
    });
  }
  async cancelInspection(applicantId: string): Promise<unknown> {
    return await this.request('POST', `/resources/inspections/${applicantId}/cancel`);
  }
}
