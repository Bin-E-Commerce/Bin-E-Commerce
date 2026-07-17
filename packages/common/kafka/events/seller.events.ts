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
}

export interface SellerApplicationReviewedPayload {
  userId: string;
  email: string;
  applicationId: string;
  shopName: string;
  reviewedAt: string;
  reviewNote?: string | null;
  correctionTargets?: string[];
}
