// Channel cho biết delivery nào cần được tạo từ một domain event.
export enum NotificationChannel {
  IN_APP = "in_app",
  EMAIL = "email",
  PUSH = "push",
  SMS = "sms",
}
