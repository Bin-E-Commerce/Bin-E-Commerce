// Audience mô tả nhóm người nhận mà backend tự resolve; frontend không được tự khai báo hoặc tự join audience.
export enum NotificationAudienceType {
  USER = "user",
  PERMISSION = "permission",
  ROLE = "role",
  SHOP = "shop",
  BROADCAST = "broadcast",
}

export interface NotificationAudience {
  type: NotificationAudienceType;
  value?: string;
  scope?: string;
}
