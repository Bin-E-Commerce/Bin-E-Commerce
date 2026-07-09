export enum UserRole {
  CUSTOMER = "CUSTOMER", // Khách mua hàng trên nền tảng.
  SELLER = "SELLER", // Người bán đã được duyệt và có quyền truy cập Seller Center.
  SUPPORT_AGENT = "SUPPORT_AGENT", // Nhân sự nội bộ hỗ trợ người dùng và đọc hồ sơ seller.
  ADMIN = "ADMIN", // Quản trị viên hệ thống có quyền vận hành toàn nền tảng.
}

// Nhóm role người dùng cuối; hiện dùng để phân biệt khách mua với các role vận hành.
export const CUSTOMER_ROLES: UserRole[] = [UserRole.CUSTOMER];

// Nhóm role bán hàng; chỉ seller đã được duyệt mới được vào Seller Center.
export const SELLER_ROLES: UserRole[] = [UserRole.SELLER];

// Nhóm role nhân sự nội bộ hiện đã triển khai trong hệ thống.
export const STAFF_ROLES: UserRole[] = [UserRole.SUPPORT_AGENT, UserRole.ADMIN];
