import type { FeedbackCenterItem } from '@/types/feedback-center';
import type { RecommendationDeliveryStatus } from '@/store/repush-store';

export type ProjectedFeedbackStatus =
  | 'pending'
  | 'positive'
  | 'screening_failed'
  | 'interview_failed'
  | 'closed';

type FeedbackStatusInput = Pick<FeedbackCenterItem, 'confirmedStatus' | 'sourceStatus'>;

/** Only a confirmed delivery can enter feedback follow-up. */
export function isFeedbackEligibleDelivery(status?: RecommendationDeliveryStatus): boolean {
  return status === 'sent' || status === 'manual';
}

/**
 * Projects OCR and manual feedback into one UI status.
 * A manual confirmation is authoritative, even when the stored OCR result is stale.
 */
export function projectFeedbackStatus(item?: FeedbackStatusInput): ProjectedFeedbackStatus {
  switch (item?.confirmedStatus) {
    case 'pending':
    case 'interview_pending':
      return 'pending';
    case 'interview_passed':
      return 'positive';
    case 'screening_failed':
      return 'screening_failed';
    case 'interview_failed':
      return 'interview_failed';
    case 'closed':
      return 'closed';
  }

  switch (item?.sourceStatus) {
    case 'passed':
      return 'positive';
    case 'screening_failed':
      return 'screening_failed';
    case 'interview_failed':
      return 'interview_failed';
    case 'scheduled':
    case 'pending':
    case 'no_feedback':
    case 'manual_review':
    default:
      return 'pending';
  }
}
