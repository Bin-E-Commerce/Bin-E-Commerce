import { IntegrationEventEnvelope } from "../contracts";

export const SellerEvents = {
  APPLICATION_SUBMITTED: "seller.application-submitted",
  APPLICATION_APPROVED: "seller.application-approved",
  APPLICATION_REJECTED: "seller.application-rejected",
  SHOP_PROFILE_CHANGE_REQUESTED: "seller.shop-profile-change-requested",
  SHOP_PROFILE_CHANGE_APPROVED: "seller.shop-profile-change-approved",
  SHOP_PROFILE_CHANGE_REJECTED: "seller.shop-profile-change-rejected",
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

export type SellerShopProfileChangeSection = "tax" | "payout" | "identity";

export interface SellerShopProfileChangeRequestedPayload {
  requestId: string;
  shopId: string;
  shopName: string;
  requesterUserId: string;
  sections: SellerShopProfileChangeSection[];
  submittedAt: string;
}

export interface SellerShopProfileChangeReviewedPayload {
  requestId: string;
  shopId: string;
  shopName: string;
  requesterUserId: string;
  sections: SellerShopProfileChangeSection[];
  reviewedAt: string;
  reviewNote?: string | null;
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

export type SellerShopProfileChangeRequestedEvent = IntegrationEventEnvelope<
  typeof SellerEvents.SHOP_PROFILE_CHANGE_REQUESTED,
  SellerShopProfileChangeRequestedPayload
>;

export type SellerShopProfileChangeReviewedEvent = IntegrationEventEnvelope<
  | typeof SellerEvents.SHOP_PROFILE_CHANGE_APPROVED
  | typeof SellerEvents.SHOP_PROFILE_CHANGE_REJECTED,
  SellerShopProfileChangeReviewedPayload
>;
