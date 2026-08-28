export const APPLICATION_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface Application {
  id: string;
  opportunity_id: string;
  builder_id: string;
  message: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}
