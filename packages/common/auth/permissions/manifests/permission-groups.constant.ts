import { Permission } from "../contracts/permission.enum";

// Nhóm quyền mở được khu vực Admin Center.
// Nhóm này chỉ dùng cho kiểm tra khu vực tổng quát; từng endpoint vẫn phải khai báo permission cụ thể.
export const ADMIN_CENTER_PERMISSIONS = [
  Permission.ADMIN_ACCESS,
  Permission.ADMIN_DASHBOARD_VIEW,
  Permission.ADMIN_ACCESS_CONTROL_READ,
  Permission.SELLER_APPLICATION_READ,
] as const;

// Nhóm quyền mở được Seller Center.
// Không đưa ADMIN/SUPPORT vào nhóm này để tránh nhân sự nội bộ thấy nhầm giao diện vận hành shop.
export const SELLER_CENTER_PERMISSIONS = [
  Permission.SELLER_ACCESS,
] as const;
