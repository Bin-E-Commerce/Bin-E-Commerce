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
  recommendationRequestId?: string | null;
  recommendationItemId?: string | null;
  recommendationSource?: string | null;
  recommendationRank?: number | null;
  surface?: "home" | "product_detail" | "recommendations_page" | null;
}

export type RecommendationInteractionRecordedEvent = IntegrationEventEnvelope<
  typeof RecommendationEvents.INTERACTION_RECORDED,
  RecommendationInteractionPayload
>;

export const RecommendationCatalogEvents = {
  UPSERTED: "product.catalog.upserted",
  STATUS_CHANGED: "product.catalog.status_changed",
  AVAILABILITY_CHANGED: "product.catalog.availability_changed",
  DELETED: "product.catalog.deleted",
} as const;

export type RecommendationCatalogEventType =
  (typeof RecommendationCatalogEvents)[keyof typeof RecommendationCatalogEvents];

export interface RecommendationCatalogProductPayload {
  productId: string;
  originType: "INTERNAL" | "EXTERNAL";
  name: string;
  slug: string;
  imageUrl: string | null;
  categoryId: string | null;
  brandId: string | null;
  sellerShopId: string | null;
  externalShopId: string | null;
  minPrice: string;
  maxPrice: string;
  ratingAvg: string | null;
  reviewCount: number;
  totalSold: number;
  status: "ACTIVE" | "INACTIVE" | "DELETED";
  isInStock: boolean;
  createdAt: string;
  updatedAt: string;
  catalogVersion: number;
}

export type RecommendationCatalogEvent = IntegrationEventEnvelope<
  RecommendationCatalogEventType,
  RecommendationCatalogProductPayload
>;

export const RecommendationPurchaseEvents = {
  COMPLETED: "order.purchase.completed",
  RETURNED: "order.purchase.returned",
} as const;

export interface RecommendationPurchaseItemPayload {
  orderItemId: string;
  productId: string;
  variantId: string | null;
  categoryId: string | null;
  quantity: number;
}

export interface RecommendationPurchasePayload {
  orderId: string;
  customerUserId: string;
  occurredAt: string;
  items: RecommendationPurchaseItemPayload[];
}

export type RecommendationPurchaseEvent = IntegrationEventEnvelope<
  (typeof RecommendationPurchaseEvents)[keyof typeof RecommendationPurchaseEvents],
  RecommendationPurchasePayload
>;
