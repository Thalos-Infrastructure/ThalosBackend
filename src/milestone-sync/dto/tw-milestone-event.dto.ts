export interface TwMilestoneEventDto {
  event: string;
  contractId: string;
  data?: {
    milestoneIndex?: number;
    newStatus?: string;
    serviceProvider?: string;
    approver?: string;
    [key: string]: unknown;
  };
}
