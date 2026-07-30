import Stripe from 'stripe';

export interface StripeConfig {
  apiKey: string;
  webhookSecret?: string;
  timeout?: number;
}

export class StripeClient {
  private stripe: Stripe;

  constructor(config: StripeConfig) {
    this.stripe = new Stripe(config.apiKey, { apiVersion: '2024-06-20' as any, timeout: config.timeout || 30000 });
  }

  async createVerificationSession(data: any): Promise<any> {
    return await this.stripe.identity.verificationSessions.create({ type: 'individual', ...(data.metadata || {}) });
  }
  async retrieveVerificationSession(sessionId: string): Promise<any> {
    return await this.stripe.identity.verificationSessions.retrieve(sessionId);
  }
  async cancelVerificationSession(sessionId: string): Promise<any> {
    return await this.stripe.identity.verificationSessions.cancel(sessionId);
  }
}
