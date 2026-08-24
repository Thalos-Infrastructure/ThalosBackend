export const ENGAGEMENT_TYPES = ['fixed', 'milestone', 'hourly'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

export const OPPORTUNITY_STATUSES = ['open', 'closed', 'filled'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export interface Opportunity {
  id: string;
  project_id: string;
  title: string;
  description: string;
  skills_required: string[];
  budget_amount: number;
  budget_asset: string;
  engagement_type: EngagementType;
  status: OpportunityStatus;
  created_at: string;
}

export function isAllowedStatusTransition(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return from === 'open' && (to === 'closed' || to === 'filled');
}
