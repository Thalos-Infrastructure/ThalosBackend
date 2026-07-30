import axios from 'axios';
import * as jwt from 'jsonwebtoken';

export interface SumsubConfig {
  apiKey: string;
  apiSecret: string;
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
    return jwt.sign({ iat, exp }, this.config.apiSecret, { algorithm: 'HS256' });
  }

  private async request(method: string, path: string, data?: unknown, queryParams?: Record<string, string>): Promise<unknown> {
    const token = this.createJwt();
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const key of Object.keys(queryParams)) url.searchParams.append(key, queryParams[key]);
    }
    try {
      const response = await axios.request({
        method,
        url: url.toString(),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        data,
        timeout: this.config.timeout || 30000,
      });
      return response.data;
    } catch (error: any) {
      if (error.response) throw new Error(`Sumsub API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      throw new Error(`Sumsub request failed: ${error.message}`);
    }
  }

  async createApplicant(userId: string, metadata?: unknown): Promise<unknown> {
    return await this.request('POST', '/resources/applicants', { externalUserId: userId, ...(metadata as object) ?? {} });
  }
  async getApplicantStatus(applicantId: string): Promise<unknown> {
    return await this.request('GET', `/resources/applicants/${applicantId}/status`);
  }
  async getApplicantData(applicantId: string): Promise<unknown> {
    return await this.request('GET', `/resources/applicants/${applicantId}/one`);
  }
  async generateAccessToken(applicantId: string, levelName?: string): Promise<unknown> {
    return await this.request('POST', '/resources/accessTokens', { userIdInApp: applicantId, levelName: levelName || 'basic-kyc-level' });
  }
  async cancelInspection(applicantId: string): Promise<unknown> {
    return await this.request('POST', `/resources/inspections/${applicantId}/cancel`);
  }
}
