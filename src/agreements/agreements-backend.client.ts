import { Injectable, Logger } from '@nestjs/common';
import { ApiClient, ApiResponse } from '../common/api/api-client';

export interface Agreement {
  id: string;
  contract_id: string | null;
  title: string;
  description: string | null;
  amount: string;
  asset: string;
  status: string;
  agreement_type: string;
  milestones: Array<{
    description: string;
    amount: string;
    status: string;
    evidence_description?: string;
    evidence_urls?: string[];
    evidence_submitted_at?: string;
  }>;
  metadata: Record<string, unknown>;
  created_by: string;
  created_by_profile_id?: string | null;
  funded_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Agreement participant data structure.
 */
export interface AgreementParticipant {
  id: string;
  agreement_id: string;
  wallet_address: string;
  role: string;
  profile_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgreementActivity {
  id: string;
  agreement_id: string;
  actor_wallet: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface CreateAgreementRequest {
  contract_id?: string | null;
  title: string;
  description?: string | null;
  amount: string;
  asset?: string;
  agreement_type?: string;
  milestones?: Array<{
    description: string;
    amount: string;
    status: string;
  }>;
  metadata?: Record<string, unknown>;
  created_by: string;
  created_by_profile_id?: string | null;
  participants: Array<{
    wallet_address: string;
    role: string;
    profile_id?: string | null;
  }>;
}

export interface CreateAgreementResponse {
  agreement: Agreement;
}

export interface LinkContractResponse {
  success: boolean;
  agreement?: Agreement;
}

export interface UpdateAgreementStatusRequest {
  status: string;
  actor_wallet: string;
}

export interface UpdateAgreementStatusResponse {
  success: boolean;
  agreement?: Agreement;
}

export interface UpdateMilestoneRequest {
  milestone_index: number;
  status: string;
  actor_wallet: string;
  evidence_description?: string;
  evidence_urls?: string[];
}

export interface UpdateMilestoneResponse {
  success: boolean;
  agreement?: Agreement;
}

export interface LogActivityRequest {
  agreement_id: string;
  actor_wallet: string;
  action: string;
  details?: Record<string, unknown>;
}

export interface GetByContractResponse {
  agreement: Agreement | null;
}

export interface GetActivityResponse {
  activities: AgreementActivity[];
}

export interface GetAgreementResponse {
  agreement: Agreement | null;
  participants: AgreementParticipant[];
}

export interface ListAgreementsResponse {
  agreements: Agreement[];
}

@Injectable()
export class AgreementsBackendClient {
  private readonly logger = new Logger(AgreementsBackendClient.name);
  private readonly baseUrl: string;

  constructor(private readonly apiClient: ApiClient) {
    // For now, we assume backend endpoints are on the same server
    // In the future, this could be configurable via environment variable
    this.baseUrl = 'http://localhost:3001';
  }

  async createAgreement(
    walletAddress: string,
    req: CreateAgreementRequest,
  ): Promise<ApiResponse<CreateAgreementResponse>> {
    return this.apiClient.post<CreateAgreementResponse>(`${this.baseUrl}/agreements`, req, {
      headers: {
        'X-Wallet-Address': walletAddress,
      },
    });
  }

  async getAgreement(
    agreementId: string,
    walletAddress: string,
  ): Promise<ApiResponse<GetAgreementResponse>> {
    return this.apiClient.get<GetAgreementResponse>(`${this.baseUrl}/agreements/${agreementId}`, {
      headers: {
        'X-Wallet-Address': walletAddress,
      },
    });
  }

  async getAgreementByContractId(
    contractId: string,
    walletAddress: string,
  ): Promise<ApiResponse<GetByContractResponse>> {
    return this.apiClient.get<GetByContractResponse>(
      `${this.baseUrl}/agreements/by-contract/${contractId}`,
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    );
  }

  async listAgreementsByWallet(
    wallet: string,
    walletAddress: string,
  ): Promise<ApiResponse<ListAgreementsResponse>> {
    return this.apiClient.get<ListAgreementsResponse>(`${this.baseUrl}/agreements`, {
      query: { wallet },
      headers: {
        'X-Wallet-Address': walletAddress,
      },
    });
  }

  async updateAgreementStatus(
    agreementId: string,
    req: UpdateAgreementStatusRequest,
    walletAddress: string,
  ): Promise<ApiResponse<UpdateAgreementStatusResponse>> {
    return this.apiClient.patch<UpdateAgreementStatusResponse>(
      `${this.baseUrl}/agreements/${agreementId}/status`,
      req,
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    );
  }

  async updateMilestone(
    agreementId: string,
    req: UpdateMilestoneRequest,
    walletAddress: string,
  ): Promise<ApiResponse<UpdateMilestoneResponse>> {
    return this.apiClient.patch<UpdateMilestoneResponse>(
      `${this.baseUrl}/agreements/${agreementId}/milestones`,
      req,
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    );
  }

  async getAgreementActivity(
    agreementId: string,
    walletAddress: string,
  ): Promise<ApiResponse<GetActivityResponse>> {
    return this.apiClient.get<GetActivityResponse>(
      `${this.baseUrl}/agreements/${agreementId}/activity`,
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    );
  }

  async logActivity(
    req: LogActivityRequest,
    walletAddress: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.apiClient.post<{ success: boolean }>(
      `${this.baseUrl}/agreements/${req.agreement_id}/activity`,
      req,
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    );
  }

  async linkContract(
    agreementId: string,
    contractId: string,
    actorWallet: string,
    walletAddress: string,
  ): Promise<ApiResponse<LinkContractResponse>> {
    return this.apiClient.patch<LinkContractResponse>(
      `${this.baseUrl}/agreements/${agreementId}/link-contract`,
      { contract_id: contractId, actor_wallet: actorWallet },
      {
        headers: {
          'X-Wallet-Address': walletAddress,
        },
      },
    );
  }
}
