export type FeedbackSourceStatus =
  | 'no_feedback'
  | 'pending'
  | 'scheduled'
  | 'screening_failed'
  | 'interview_failed'
  | 'manual_review';

export type FeedbackConfirmedStatus =
  | 'pending'
  | 'screening_failed'
  | 'interview_pending'
  | 'interview_passed'
  | 'interview_failed'
  | 'closed';

export interface FeedbackTimelineEvent {
  id: string;
  type: 'follow_up' | 'status_update' | 'repush' | 'close' | 'manual_resolve';
  at: string;
  note?: string;
  status?: FeedbackConfirmedStatus;
}

export type FeedbackLedgerStatus = 'resolved' | 'manual_review' | 'irrelevant' | 'failed' | 'context_only';

export interface FeedbackMessageLedgerItem {
  id: string;
  owner: 'a' | 'b';
  telegramMessageId: string;
  sentAt: string;
  direction: 'incoming' | 'outgoing';
  sourceType: 'text' | 'image' | 'other';
  status: FeedbackLedgerStatus;
  preview?: string;
  note?: string;
  extractedItemCount: number;
  recommendationIds: string[];
}

export interface FeedbackCenterItem {
  id: string;
  recommendationId?: string;
  owner: 'a' | 'b';
  candidateCode?: string;
  candidateName: string;
  jobTitle: string;
  organization?: string;
  department?: string;
  contactPerson?: string;
  recommendedAt?: string;
  interviewStatus?: string;
  feedbackAt?: string;
  sourceStatus: FeedbackSourceStatus;
  sourceSummary?: string;
  sourceEvidence?: string;
  auditConclusion?: string;
  confidence?: number;
  telegramMessageId?: string;
  confirmedStatus?: FeedbackConfirmedStatus;
  followUpCount: number;
  lastFollowUpAt?: string;
  repushReady?: boolean;
  timeline: FeedbackTimelineEvent[];
  updatedAt: string;
}

export interface FeedbackCenterState {
  version: 1;
  generatedAt: string;
  items: FeedbackCenterItem[];
  ledger?: FeedbackMessageLedgerItem[];
}
