// File này định nghĩa contract interaction dùng giữa Web, API Gateway và Recommendation Service.
// Payload chỉ chứa tín hiệu hành vi tối thiểu; không chứa email, token, địa chỉ hoặc dữ liệu thanh toán.

import { IntegrationEventEnvelope } from "../contracts";

export const RecommendationEvents = {
  INTERACTION_RECORDED: "recommendation.interaction.recorded",
} as const;

export const RecommendationInteractionTypes = {
  PRODUCT_VIEWED: "PRODUCT_VIEWED",
  PRODUCT_CLICKED: "PRODUCT_CLICKED",
  PRODUCT_IMPRESSED: "PRODUCT_IMPRESSED",
  SEARCH_PERFORMED: "SEARCH_PERFORMED",
  PRODUCT_ADDED_TO_CART: "PRODUCT_ADDED_TO_CART",
  PRODUCT_REMOVED_FROM_CART: "PRODUCT_REMOVED_FROM_CART",
} as const;

export type RecommendationInteractionType =
  (typeof RecommendationInteractionTypes)[keyof typeof RecommendationInteractionTypes];

export interface RecommendationInteractionPayload {
  interactionType: RecommendationInteractionType;
  userId: string | null;
  sessionId: string | null;
  productId: string | null;
  variantId: string | null;
  categoryId: string | null;
  query: string | null;
  page: string | null;
  position: number | null;
  quantity: number | null;
  requestId: string | null;
}

export type RecommendationInteractionRecordedEvent = IntegrationEventEnvelope<
  typeof RecommendationEvents.INTERACTION_RECORDED,
  RecommendationInteractionPayload
>;
