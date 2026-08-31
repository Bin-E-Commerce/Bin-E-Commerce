// File này định nghĩa event vận chuyển dùng chung giữa Shipping và Notification Service.

import { IntegrationEventEnvelope } from "../contracts";

export const ShippingEvents = {
  STATUS_UPDATED: "shipment.status.updated",
} as const;

export type ShipmentStatus =
  | "READY_TO_SHIP"
  | "PICKUP_ASSIGNED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

export interface ShipmentStatusUpdatedPayload {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  shopId: string;
  sellerUserId: string;
  customerUserId: string;
  trackingCode: string;
  status: ShipmentStatus;
  statusLabel: string;
  currentLocation: {
    latitude: number;
    longitude: number;
    label: string;
  };
}

export type ShipmentStatusUpdatedEvent = IntegrationEventEnvelope<
  typeof ShippingEvents.STATUS_UPDATED,
  ShipmentStatusUpdatedPayload
>;
