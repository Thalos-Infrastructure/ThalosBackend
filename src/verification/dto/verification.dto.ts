import { IsEnum, IsOptional, IsString, IsBoolean, IsObject } from 'class-validator';

export enum VerificationType {
  KYC = 'kyc',
  KYB = 'kyb',
}

export enum VerificationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  EXPIRED = 'expired',
}

export enum VerificationProvider {
  MOCK = 'mock',
  ONFIDO = 'onfido',
  SUMSUB = 'sumsub',
  VERIFF = 'veriff',
  PERSONA = 'persona',
  TRULIOO = 'trulioo',
}

export interface VerificationSubject {
  id?: string;
  type: VerificationType;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
  date_of_birth?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
  company_name?: string;
  registration_number?: string;
  jurisdiction?: string;
  directors?: Array<{
    first_name: string;
    last_name: string;
    date_of_birth: string;
  }>;
  documents?: Array<{
    type: string;
    file_url?: string;
    file_name?: string;
  }>;
}

export interface VerificationSession {
  id: string;
  provider: VerificationProvider;
  type: VerificationType;
  subject: VerificationSubject;
  status: VerificationStatus;
  provider_session_id?: string;
  provider_url?: string;
  result?: {
    score?: number;
    risk_level?: 'low' | 'medium' | 'high';
    breakdown?: Record<string, unknown>;
    raw_response?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  created_at: string;
  updated_at: string;
  expires_at?: string;
  completed_at?: string;
}

export interface ProviderCreateSessionResponse {
  provider_session_id: string;
  provider_url?: string;
  expires_at: string;
}

export interface ProviderStatusResponse {
  status: VerificationStatus;
  result?: VerificationSession['result'];
  error?: VerificationSession['error'];
}

export interface ProviderWebhookPayload {
  session_id: string;
  event: string;
  status: VerificationStatus;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  timestamp: string;
}

export class CreateVerificationSessionDto {
  @IsEnum(VerificationType)
  type: VerificationType;

  @IsObject()
  subject: VerificationSubject;

  @IsOptional()
  @IsEnum(VerificationProvider)
  provider?: VerificationProvider;
}

export class VerificationCallbackDto {
  @IsString()
  session_id: string;

  @IsEnum(VerificationStatus)
  status: VerificationStatus;

  @IsOptional()
  result?: Record<string, unknown>;

  @IsOptional()
  error?: Record<string, unknown>;
}

export class WebhookVerificationDto {
  @IsString()
  provider: string;

  @IsString()
  signature?: string;

  @IsOptional()
  @IsBoolean()
  skip_validation?: boolean;
}
