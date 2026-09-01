// File nay dinh nghia integration event review tu Product Service sang Notification Service.
import { IntegrationEventEnvelope } from "../contracts";

export const ReviewEvents = {
  CREATED: "review.created",
  UPDATED: "review.updated",
} as const;

export interface ReviewChangedPayload {
  reviewId: string;
  productId: string;
  productName: string;
  sellerUserId: string;
  customerUserId: string;
  orderId: string;
  rating: number;
  reviewerName: string | null;
  isAnonymous: boolean;
  hasComment: boolean;
  mediaCount: number;
  createdAt: string;
}

export type ReviewCreatedPayload = ReviewChangedPayload;
export type ReviewUpdatedPayload = ReviewChangedPayload;

export type ReviewCreatedEvent = IntegrationEventEnvelope<
  typeof ReviewEvents.CREATED,
  ReviewCreatedPayload
>;

export type ReviewUpdatedEvent = IntegrationEventEnvelope<
  typeof ReviewEvents.UPDATED,
  ReviewUpdatedPayload
>;
