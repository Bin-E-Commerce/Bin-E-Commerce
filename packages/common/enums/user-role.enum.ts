export enum UserRole {
  CUSTOMER = "CUSTOMER", // Khách mua hàng trên nền tảng.
  SELLER = "SELLER", // Người bán đã được duyệt và có quyền truy cập Seller Center.
  CATALOG_MANAGER = "CATALOG_MANAGER", // Nhân sự quản lý danh mục, sản phẩm và dữ liệu catalog.
  INVENTORY_MANAGER = "INVENTORY_MANAGER", // Nhân sự quản lý tồn kho, số lượng hàng và trạng thái kho.
  ORDER_MANAGER = "ORDER_MANAGER", // Nhân sự xử lý đơn hàng và cập nhật trạng thái đơn.
  SHIPPING_MANAGER = "SHIPPING_MANAGER", // Nhân sự theo dõi và điều phối vận chuyển.
  PROMOTION_MANAGER = "PROMOTION_MANAGER", // Nhân sự tạo và quản lý chương trình khuyến mãi.
  RETURN_MANAGER = "RETURN_MANAGER", // Nhân sự xử lý yêu cầu trả hàng và hoàn tiền.
  ANALYST = "ANALYST", // Nhân sự xem báo cáo và phân tích hiệu suất kinh doanh.
  SUPPORT_AGENT = "SUPPORT_AGENT", // Nhân sự hỗ trợ khách hàng và xử lý khiếu nại.
  ADMIN = "ADMIN", // Quản trị viên hệ thống có quyền cao nhất.
}

// Nhóm vai trò người dùng cuối để phân biệt khách mua và người bán với nhân sự nội bộ.
export const CUSTOMER_ROLES: UserRole[] = [UserRole.CUSTOMER];
export const SELLER_ROLES: UserRole[] = [UserRole.SELLER];

// Nhóm vai trò được phép vào Seller Center, dùng khi một màn hình cho cả seller và admin vận hành.
export const SELLER_CENTER_ROLES: UserRole[] = [
  UserRole.SELLER,
  UserRole.ADMIN,
];

// Nhóm vai trò nhân sự nội bộ để dùng lại trong @Roles() khi bảo vệ các API quản trị.
export const STAFF_ROLES: UserRole[] = [
  UserRole.CATALOG_MANAGER,
  UserRole.INVENTORY_MANAGER,
  UserRole.ORDER_MANAGER,
  UserRole.SHIPPING_MANAGER,
  UserRole.PROMOTION_MANAGER,
  UserRole.RETURN_MANAGER,
  UserRole.ANALYST,
  UserRole.SUPPORT_AGENT,
  UserRole.ADMIN,
];
