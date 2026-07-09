// Permission là hợp đồng quyền dùng chung giữa backend, gateway và admin UI.
// Mỗi giá trị ở đây phải tương ứng với một nghiệp vụ thật đang được bảo vệ bằng guard hoặc render trong menu.
export enum Permission {
  // Admin
  // 1. Admin Center
  ADMIN_ACCESS = "admin.access", // Cho phép truy cập Admin Center, nhưng không có quyền gì khác.
  // 2. Admin Dashboard
  ADMIN_DASHBOARD_VIEW = "admin.dashboard.view",
  // 3. Admin Access Control
  ADMIN_ACCESS_CONTROL_READ = "admin.access_control.read",
  ADMIN_ACCESS_CONTROL_UPDATE = "admin.access_control.update",

  // Seller
  // 1. Seller Center
  SELLER_ACCESS = "seller.access", // Cho phép truy cập Seller Center, nhưng không có quyền gì khác.
  // 2. Seller Dashboard
  SELLER_DASHBOARD_VIEW = "seller.dashboard.view",
  // 3. Seller Application
  SELLER_APPLICATION_READ = "seller.application.read",
  SELLER_APPLICATION_APPROVE = "seller.application.approve",
  SELLER_APPLICATION_REJECT = "seller.application.reject",
}
