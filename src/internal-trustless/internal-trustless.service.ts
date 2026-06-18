import { BadRequestException, Injectable } from "@nestjs/common";
import { ApiClient } from "../common/api/api-client";

const ALLOWED_PREFIXES = ["deployer/", "escrow/", "helper/"];

@Injectable()
export class InternalTrustlessService {
  constructor(private readonly apiClient: ApiClient) {}
  private getBaseUrl(): string {
    const u = process.env.TRUSTLESSWORK_API_URL;
    if (!u) throw new BadRequestException("TRUSTLESSWORK_API_URL not set");
    return u.replace(/\/$/, "");
  }

  private getApiKey(): string {
    const k = process.env.TRUSTLESSWORK_API_KEY;
    if (!k) throw new BadRequestException("TRUSTLESSWORK_API_KEY not set");
    return k;
  }

  private assertAllowedPath(path: string): void {
    const normalized = path.replace(/^\/+/, "");
    const ok = ALLOWED_PREFIXES.some((p) => normalized.startsWith(p));
    if (!ok) {
      throw new BadRequestException("Path not allowed for Trustless relay");
    }
  }

  async relay(
    method: "GET" | "POST",
    path: string,
    query?: Record<string, string | number | boolean>,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    this.assertAllowedPath(path);
    const base = this.getBaseUrl();
    const normalizedPath = path.replace(/^\/+/, "");
    const url = `${base}/${normalizedPath}`;

    const headers: Record<string, string> = {
      "x-api-key": this.getApiKey(),
    };

    const response = await this.apiClient.request({
      method,
      url,
      headers,
      body,
      query,
    });

    // Extract status code from the raw fetch if needed, otherwise return a standard mapping
    const status = response.success ? 200 : 400;

    return {
      status,
      data: response.data || response.error,
    };
  }

  /**
   * Get all escrows where the address is a signer (sender, receiver, or approver)
   */
  async getEscrowsBySigner(address: string): Promise<unknown> {
    const result = await this.relay("GET", "helper/get-escrows-by-signer", {
      address,
    });
    if (result.status >= 400) {
      throw new BadRequestException(result.data);
    }
    return result.data;
  }

  /**
   * Get escrows filtered by role, status, and type
   */
  async getEscrowsByRole(params: {
    address: string;
    role?: "sender" | "receiver" | "approver";
    status?: string;
    type?: "single-release" | "multi-release";
  }): Promise<unknown> {
    const query: Record<string, string> = { address: params.address };
    if (params.role) query.role = params.role;
    if (params.status) query.status = params.status;
    if (params.type) query.type = params.type;

    const result = await this.relay("GET", "helper/get-escrows-by-role", query);
    if (result.status >= 400) {
      throw new BadRequestException(result.data);
    }
    return result.data;
  }
}
