// File này định nghĩa integration event của Order Service cho notification và email.
// Payload chỉ chứa định danh người nhận cùng dữ liệu tổng hợp; không chứa địa chỉ, số điện thoại hay thanh toán nhạy cảm.

import { IntegrationEventEnvelope } from "../contracts";

export const OrderEvents = {
  CREATED: "order.created",
  CANCELLED: "order.cancelled",
} as const;

export type OrderEventType = (typeof OrderEvents)[keyof typeof OrderEvents];

// Mỗi recipient tương ứng với một chủ shop có item trong order; consumer sẽ tạo notification và email riêng theo userId.
export interface OrderSellerRecipient {
  userId: string;
  shopId: string;
  itemCount: number;
  shopItemTotal: string;
  previewProductName: string;
}

export type OrderCreatedSellerRecipient = OrderSellerRecipient;

// Snapshot tối thiểu để email customer hiển thị đúng những sản phẩm đã đặt mà không gọi lại Product Service.
export interface OrderEventItem {
  productName: string;
  variantName: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface OrderCreatedPayload {
  orderId: string;
  orderNumber: string;
  paymentMethod: "COD";
  totalAmount: string;
  createdAt: string;
  customerUserId: string;
  customerEmail?: string | null;
  customerItems?: OrderEventItem[];
  recipients: OrderSellerRecipient[];
}

export type OrderCreatedEvent = IntegrationEventEnvelope<
  typeof OrderEvents.CREATED,
  OrderCreatedPayload
>;

export interface OrderCancelledPayload {
  orderId: string;
  orderNumber: string;
  paymentMethod: "COD";
  totalAmount: string;
  createdAt: string;
  cancelledAt: string;
  cancelReason: string | null;
  customerUserId: string;
  customerEmail?: string | null;
  customerItems?: OrderEventItem[];
  recipients: OrderSellerRecipient[];
}

export type OrderCancelledEvent = IntegrationEventEnvelope<
  typeof OrderEvents.CANCELLED,
  OrderCancelledPayload
>;
