export interface MilestoneData {
  index?: number;
  status?: string;
  description?: string;
  amount?: string;
}

export interface TrustlessWorkEventDto {
  event: string;
  contractId: string;
  data?: Record<string, unknown>;
  milestone?: MilestoneData;
}
