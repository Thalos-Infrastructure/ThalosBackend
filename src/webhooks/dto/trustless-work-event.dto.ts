export interface TrustlessWorkEventDto {
  event: string;
  contractId: string;
  data?: Record<string, unknown>;
}
