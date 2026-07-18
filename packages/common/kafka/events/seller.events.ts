import { IntegrationEventEnvelope } from "../contracts";

export const SellerEvents = {
  APPLICATION_SUBMITTED: "seller.application-submitted",
  APPLICATION_APPROVED: "seller.application-approved",
  APPLICATION_REJECTED: "seller.application-rejected",
} as const;

export type SellerEventType = (typeof SellerEvents)[keyof typeof SellerEvents];

export interface SellerApplicationSubmittedPayload {
  userId: string;
  email: string;
  applicationId: string;
  shopName: string;
  submittedAt: string;
  submissionRevision: number;
}

export interface SellerApplicationReviewedPayload {
  userId: string;
  email: string;
  applicationId: string;
  shopName: string;
  reviewedAt: string;
  reviewNote?: string | null;
  correctionTargets?: string[];
  submissionRevision: number;
}

export type SellerApplicationSubmittedEvent = IntegrationEventEnvelope<
  typeof SellerEvents.APPLICATION_SUBMITTED,
  SellerApplicationSubmittedPayload
>;

export type SellerApplicationReviewedEvent = IntegrationEventEnvelope<
  | typeof SellerEvents.APPLICATION_APPROVED
  | typeof SellerEvents.APPLICATION_REJECTED,
  SellerApplicationReviewedPayload
>;
