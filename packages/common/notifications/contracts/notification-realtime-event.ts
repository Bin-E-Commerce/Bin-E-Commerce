import { NotificationAudience } from "./notification-audience";
import { NotificationCategory } from "./notification-category";
import { NotificationPriority } from "./notification-priority";

export const NOTIFICATION_REALTIME_CHANNEL =
  "bin-ecommerce:notifications:realtime";

export const NotificationRealtimeEvents = {
  CREATED: "notification.created",
} as const;

// DTO realtime chỉ mang dữ liệu an toàn để render; dữ liệu nhạy cảm phải được tải qua API có kiểm quyền.
export interface NotificationRealtimeItem {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  badgeKey?: string | null;
  priority: NotificationPriority;
  createdAt: string;
}

// Message Redis giữ audience để API Gateway chọn đúng Socket.IO room trước khi emit ra client.
export interface NotificationRealtimeMessage {
  name: typeof NotificationRealtimeEvents.CREATED;
  audiences: NotificationAudience[];
  notification: NotificationRealtimeItem;
}
