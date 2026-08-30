// File này là nguồn định nghĩa permission, role grant và navigation dùng chung cho Auth Service, Gateway và FE.
// Không đặt logic kiểm tra JWT hay business workflow ở đây; chỉ khai báo contract để các lớp runtime cùng đọc.

import { UserRole } from "../../../enums/user-role.enum";
import { Permission } from "../contracts/permission.enum";
import { PermissionScope } from "../contracts/permission-scope.enum";

// Version quyền dùng để vô hiệu Redis access-profile cache khi contract permission/menu thay đổi.
// Mỗi lần đổi shape accessProfile, thêm permission hoặc đổi menu quan trọng thì tăng version này.
export const ACCESS_CONTROL_PERMISSION_VERSION = "2026.08.30.2";

// Danh sách permission, role, scope và menu chính thức của hệ thống.
export interface PermissionDefinition {
  code: Permission; // Mã permission dùng trong DB, guard, menu, FE accessProfile.
  name: string;
  description: string;
  resource: string;
  action: string; // resource.action là cách đặt tên permission theo chuẩn RESTful, giúp FE và BE hiểu ngữ nghĩa permission.
}

// Danh sách role, permission và scope mặc định khi seed môi trường mới.
export interface RoleDefinition {
  code: UserRole;
  name: string;
  description: string;
  isSystem: boolean; // Role hệ thống không được xóa, chỉ có thể bật/tắt hoặc gán quyền.
}

// Ma trận quyền mặc định khi seed môi trường mới.
export interface RolePermissionDefinition {
  roleCode: UserRole; // Role code dùng trong DB, guard, menu, FE accessProfile.
  permissionCode: Permission;
  scope: PermissionScope;
}

// Danh mục menu backend trả về cho FE trong accessProfile.
export interface NavigationItemDefinition {
  area: "admin" | "seller";
  groupCode: string; // Mã nhóm menu dùng trong DB, guard, menu, FE accessProfile. FE sẽ render groupCode trong <el-menu-item-group> hoặc <q-item-label> tùy framework.
  groupLabel: string; // Tên hiển thị nhóm menu trong sidebar, FE sẽ render groupLabel trong <el-menu-item-group> hoặc <q-item-label> tùy framework.
  groupOrder: number; // Thứ tự nhóm menu trong sidebar, FE sẽ sort theo groupOrder trước, sortOrder sau.
  code: string; // Mã menu dùng trong DB, guard, menu, FE accessProfile.
  label: string; // Tên hiển thị trong menu.
  description: string;
  href: string; // Link menu, FE sẽ render <a href={href}> hoặc <router-link :to="{ path: href }"> tùy framework.
  icon: string; // Icon hiển thị trong menu.
  sortOrder: number; //  Thứ tự menu trong nhóm, FE sẽ sort theo groupOrder trước, sortOrder sau.
  requiredPermissionCode: Permission; // Mã permission dùng trong DB, guard, menu, FE accessProfile. FE sẽ render menu nếu user có permission này.
  requiredScope?: PermissionScope; // Scope mặc định của permission khi render menu, FE sẽ render menu nếu user có permission này với scope này. Nếu không có thì FE sẽ render menu nếu user có permission này với bất kỳ scope nào.
  parentCode?: string; // Mã menu cha dùng trong DB, guard, menu, FE accessProfile. FE sẽ render menu con nếu user có permission này với scope này và menu cha có permission này với scope này. Nếu không có thì FE sẽ render menu con nếu user có permission này với bất kỳ scope nào.
}

// Danh mục permission chính thức của hệ thống.
// Admin UI chỉ được bật/tắt các permission đã có trong danh sách này, không tự tạo permission tự do trong DB.
export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    code: Permission.ADMIN_ACCESS,
    name: "Truy cập Admin Center",
    description: "Cho phép vào khu vực vận hành nội bộ của nền tảng.",
    resource: "admin",
    action: "access",
  },
  {
    code: Permission.ADMIN_DASHBOARD_VIEW,
    name: "Xem bảng điều khiển admin",
    description: "Cho phép xem dashboard tổng quan của Admin Center.",
    resource: "admin.dashboard",
    action: "view",
  },
  {
    code: Permission.ADMIN_ACCESS_CONTROL_READ,
    name: "Xem trang phân quyền",
    description:
      "Cho phép xem role, permission, scope và menu trong Admin Center.",
    resource: "admin.access_control",
    action: "read",
  },
  {
    code: Permission.ADMIN_ACCESS_CONTROL_UPDATE,
    name: "Chỉnh sửa phân quyền",
    description:
      "Cho phép bật hoặc tắt permission cho từng role trong Admin Center.",
    resource: "admin.access_control",
    action: "update",
  },
  {
    code: Permission.CART_READ,
    name: "Xem giỏ hàng",
    description: "Cho phép Customer hoặc Seller xem giỏ hàng active của chính mình.",
    resource: "cart",
    action: "read",
  },
  {
    code: Permission.CART_ITEM_ADD,
    name: "Thêm sản phẩm vào giỏ hàng",
    description:
      "Cho phép Customer hoặc Seller thêm sản phẩm nội bộ vào giỏ hàng của chính mình.",
    resource: "cart.item",
    action: "add",
  },
  {
    code: Permission.CART_ITEM_UPDATE,
    name: "Cập nhật số lượng trong giỏ hàng",
    description:
      "Cho phép Customer hoặc Seller tăng, giảm số lượng sản phẩm trong giỏ hàng của chính mình.",
    resource: "cart.item",
    action: "update",
  },
  {
    code: Permission.CART_ITEM_REMOVE,
    name: "Xóa sản phẩm khỏi giỏ hàng",
    description:
      "Cho phép Customer hoặc Seller xóa sản phẩm khỏi giỏ hàng của chính mình.",
    resource: "cart.item",
    action: "remove",
  },
  {
    code: Permission.ORDER_CREATE,
    name: "Tạo đơn COD",
    description: "Cho phép Customer hoặc Seller tạo đơn COD từ giỏ hàng của chính mình.",
    resource: "order",
    action: "create",
  },
  {
    code: Permission.ORDER_READ,
    name: "Xem đơn hàng của tôi",
    description:
      "Cho phép Customer xem lịch sử và chi tiết các đơn hàng thuộc tài khoản của mình.",
    resource: "order",
    action: "read",
  },
  {
    code: Permission.ORDER_CANCEL,
    name: "Hủy đơn hàng của tôi",
    description:
      "Cho phép Customer hủy đơn COD đã xác nhận thuộc tài khoản của mình.",
    resource: "order",
    action: "cancel",
  },
  {
    code: Permission.SELLER_ORDER_READ,
    name: "Xem đơn hàng của shop",
    description:
      "Cho phép Seller xem các đơn hàng có sản phẩm thuộc shop của mình.",
    resource: "seller.order",
    action: "read",
  },
  {
    code: Permission.SELLER_APPLICATION_READ,
    name: "Xem hồ sơ đăng ký seller",
    description: "Cho phép xem danh sách và chi tiết hồ sơ đăng ký người bán.",
    resource: "seller.application",
    action: "read",
  },
  {
    code: Permission.SELLER_APPLICATION_APPROVE,
    name: "Duyệt hồ sơ đăng ký seller",
    description: "Cho phép chấp thuận hồ sơ đăng ký người bán.",
    resource: "seller.application",
    action: "approve",
  },
  {
    code: Permission.SELLER_APPLICATION_REJECT,
    name: "Từ chối hồ sơ đăng ký seller",
    description: "Cho phép từ chối hồ sơ đăng ký người bán.",
    resource: "seller.application",
    action: "reject",
  },
  {
    code: Permission.SELLER_ACCESS,
    name: "Truy cập Seller Center",
    description: "Cho phép vào khu vực vận hành shop của người bán.",
    resource: "seller",
    action: "access",
  },
  {
    code: Permission.SELLER_DASHBOARD_VIEW,
    name: "Xem bảng điều khiển seller",
    description: "Cho phép xem dashboard tổng quan trong Seller Center.",
    resource: "seller.dashboard",
    action: "view",
  },
  {
    code: Permission.SELLER_PRODUCT_READ,
    name: "Xem sản phẩm của shop",
    description:
      "Cho phép người bán xem danh sách sản phẩm thuộc shop do mình sở hữu.",
    resource: "seller.product",
    action: "read",
  },
  {
    code: Permission.SELLER_PRODUCT_CREATE,
    name: "Thêm sản phẩm cho shop",
    description:
      "Cho phép người bán tạo bản nháp hoặc đăng sản phẩm mới thuộc shop do mình sở hữu.",
    resource: "seller.product",
    action: "create",
  },
  {
    code: Permission.SELLER_PRODUCT_UPDATE,
    name: "Chỉnh sửa sản phẩm của shop",
    description:
      "Cho phép người bán cập nhật thông tin, phân loại, giá bán và tồn kho sản phẩm thuộc shop do mình sở hữu.",
    resource: "seller.product",
    action: "update",
  },
  {
    code: Permission.SELLER_PRODUCT_STATUS_UPDATE,
    name: "Thay đổi trạng thái sản phẩm của shop",
    description:
      "Cho phép người bán bật hoặc tắt sản phẩm thuộc shop mà không thay đổi nội dung sản phẩm.",
    resource: "seller.product.status",
    action: "update",
  },
  {
    code: Permission.SELLER_PRODUCT_DELETE,
    name: "Xóa sản phẩm của shop",
    description:
      "Cho phép người bán chuyển sản phẩm thuộc shop sang trạng thái đã xóa theo chính sách vòng đời sản phẩm.",
    resource: "seller.product",
    action: "delete",
  },
  {
    code: Permission.SELLER_PRODUCT_RESTORE,
    name: "Khôi phục sản phẩm của shop",
    description:
      "Cho phép người bán khôi phục sản phẩm đã xóa mềm thuộc shop do mình sở hữu.",
    resource: "seller.product",
    action: "restore",
  },
  {
    code: Permission.SELLER_AI_PRODUCT_CONTENT_GENERATE,
    name: "Tạo gợi ý nội dung sản phẩm bằng AI",
    description:
      "Cho phép người bán sử dụng AI để đề xuất tên sản phẩm trong phạm vi shop của mình.",
    resource: "seller.ai.product_content",
    action: "generate",
  },
  {
    code: Permission.SELLER_AI_IMAGE_OPTIMIZATION_VIEW,
    name: "Xem cong cu toi uu anh bang AI",
    description: "Cho phep seller xem bang dieu khien va ket qua toi uu anh cua shop.",
    resource: "seller.ai.image_optimization",
    action: "view",
  },
  {
    code: Permission.SELLER_AI_IMAGE_OPTIMIZATION_GENERATE,
    name: "Tao yeu cau toi uu anh bang AI",
    description: "Cho phep seller tao job toi uu anh trong pham vi shop cua minh.",
    resource: "seller.ai.image_optimization",
    action: "generate",
  },
  {
    code: Permission.SELLER_AI_IMAGE_OPTIMIZATION_APPLY,
    name: "Ap dung anh toi uu bang AI",
    description: "Cho phep seller duyet va ap dung anh AI vao san pham cua shop.",
    resource: "seller.ai.image_optimization",
    action: "apply",
  },
  {
    code: Permission.SELLER_AI_IMAGE_OPTIMIZATION_ROLLBACK,
    name: "Khoi phuc anh goc sau toi uu AI",
    description: "Cho phep seller khoi phuc anh goc cua san pham da ap dung AI.",
    resource: "seller.ai.image_optimization",
    action: "rollback",
  },
  {
    code: Permission.SELLER_SHOP_PROFILE_READ,
    name: "Xem hồ sơ shop",
    description:
      "Cho phép người bán xem thông tin công khai, thuế và định danh đã xác minh của shop mình.",
    resource: "seller.shop_profile",
    action: "read",
  },
  {
    code: Permission.SELLER_SHOP_PROFILE_UPDATE,
    name: "Chỉnh sửa hồ sơ shop",
    description:
      "Cho phép người bán cập nhật tên, logo, mô tả và thông tin liên hệ công khai của shop mình.",
    resource: "seller.shop_profile",
    action: "update",
  },
  {
    code: Permission.SELLER_SHOP_PROFILE_CHANGE_REQUEST_CREATE,
    name: "Gửi yêu cầu đổi hồ sơ shop",
    description:
      "Cho phép người bán gửi thay đổi thuế, thanh toán hoặc định danh để admin xác minh.",
    resource: "seller.shop_profile_change_request",
    action: "create",
  },
  {
    code: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_READ,
    name: "Xem yêu cầu đổi hồ sơ shop",
    description:
      "Cho phép nhân sự vận hành xem dữ liệu trước và sau trong yêu cầu thay đổi hồ sơ shop.",
    resource: "admin.shop_profile_change_request",
    action: "read",
  },
  {
    code: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_APPROVE,
    name: "Duyệt yêu cầu đổi hồ sơ shop",
    description:
      "Cho phép áp dụng thay đổi thuế, thanh toán hoặc định danh vào hồ sơ đang có hiệu lực.",
    resource: "admin.shop_profile_change_request",
    action: "approve",
  },
  {
    code: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_REJECT,
    name: "Từ chối yêu cầu đổi hồ sơ shop",
    description:
      "Cho phép từ chối yêu cầu thay đổi hồ sơ shop và ghi rõ lý do cho người bán.",
    resource: "admin.shop_profile_change_request",
    action: "reject",
  },
];

// Danh mục role nghiệp vụ chính thức.
// DB có thể lưu trạng thái active hoặc assignment, nhưng code giữ danh sách role được hệ thống hiểu.
export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: UserRole.CUSTOMER,
    name: "Khách hàng",
    description: "Người dùng mua hàng trên nền tảng.",
    isSystem: true,
  },
  {
    code: UserRole.SELLER,
    name: "Người bán",
    description: "Người bán đã được duyệt và có quyền vận hành shop.",
    isSystem: true,
  },
  {
    code: UserRole.SUPPORT_AGENT,
    name: "Nhân sự hỗ trợ",
    description: "Nhân sự nội bộ xử lý hồ sơ và hỗ trợ người dùng.",
    isSystem: true,
  },
  {
    code: UserRole.ADMIN,
    name: "Quản trị viên",
    description: "Quản trị viên hệ thống có quyền vận hành toàn nền tảng.",
    isSystem: true,
  },
];

// Ma trận quyền mặc định khi seed môi trường mới.
// Seed service chỉ tạo bản ghi còn thiếu, không ghi đè trạng thái quyền mà admin đã bật/tắt trong DB.
export const ROLE_PERMISSION_DEFINITIONS: RolePermissionDefinition[] = [
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.CART_READ,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.CART_READ,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.CART_ITEM_ADD,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.CART_ITEM_ADD,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.CART_ITEM_UPDATE,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.CART_ITEM_UPDATE,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.CART_ITEM_REMOVE,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.CART_ITEM_REMOVE,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.ORDER_CREATE,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.ORDER_CREATE,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.ORDER_READ,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.CUSTOMER,
    permissionCode: Permission.ORDER_CANCEL,
    scope: PermissionScope.OWN,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_ORDER_READ,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_ACCESS,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_DASHBOARD_VIEW,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_PRODUCT_READ,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_PRODUCT_CREATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_PRODUCT_UPDATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_PRODUCT_STATUS_UPDATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_PRODUCT_DELETE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_PRODUCT_RESTORE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_AI_PRODUCT_CONTENT_GENERATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_AI_IMAGE_OPTIMIZATION_VIEW,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_AI_IMAGE_OPTIMIZATION_GENERATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_AI_IMAGE_OPTIMIZATION_APPLY,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_AI_IMAGE_OPTIMIZATION_ROLLBACK,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_SHOP_PROFILE_READ,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_SHOP_PROFILE_UPDATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SELLER,
    permissionCode: Permission.SELLER_SHOP_PROFILE_CHANGE_REQUEST_CREATE,
    scope: PermissionScope.OWN_SHOP,
  },
  {
    roleCode: UserRole.SUPPORT_AGENT,
    permissionCode: Permission.SELLER_APPLICATION_READ,
    scope: PermissionScope.GLOBAL,
  },
  {
    // Nhân sự hỗ trợ được xem hồ sơ và xử lý đầy đủ vòng review seller.
    // Gateway và seller-service vẫn kiểm tra từng permission riêng nên không thể dùng quyền đọc để duyệt hoặc từ chối.
    roleCode: UserRole.SUPPORT_AGENT,
    permissionCode: Permission.SELLER_APPLICATION_APPROVE,
    scope: PermissionScope.GLOBAL,
  },
  {
    // Tách quyền từ chối riêng để thao tác này được hiển thị, audit và thu hồi độc lập với quyền duyệt hồ sơ.
    roleCode: UserRole.SUPPORT_AGENT,
    permissionCode: Permission.SELLER_APPLICATION_REJECT,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_ACCESS,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_DASHBOARD_VIEW,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_ACCESS_CONTROL_READ,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_ACCESS_CONTROL_UPDATE,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_APPLICATION_READ,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_APPLICATION_APPROVE,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_APPLICATION_REJECT,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_ACCESS,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_DASHBOARD_VIEW,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_PRODUCT_READ,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_SHOP_PROFILE_READ,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.SELLER_SHOP_PROFILE_UPDATE,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_READ,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_APPROVE,
    scope: PermissionScope.GLOBAL,
  },
  {
    roleCode: UserRole.ADMIN,
    permissionCode: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_REJECT,
    scope: PermissionScope.GLOBAL,
  },
];

// Manifest menu backend trả về cho FE trong accessProfile.
// Mỗi item phải khai báo group rõ ràng để sidebar không tự gom sai ngữ nghĩa ở frontend.
export const NAVIGATION_ITEM_DEFINITIONS: NavigationItemDefinition[] = [
  {
    area: "admin",
    groupCode: "overview",
    groupLabel: "Tổng quan",
    groupOrder: 10,
    code: "admin.dashboard",
    label: "Bảng điều khiển",
    description: "Sức khỏe hệ thống và việc cần xử lý",
    href: "/admin/dashboard",
    icon: "LayoutDashboard",
    sortOrder: 10,
    requiredPermissionCode: Permission.ADMIN_DASHBOARD_VIEW,
  },
  {
    area: "admin",
    groupCode: "seller",
    groupLabel: "Người bán",
    groupOrder: 20,
    code: "admin.seller_applications",
    label: "Hồ sơ chờ duyệt",
    description: "Danh sách đăng ký seller cần kiểm tra",
    href: "/admin/sellers/applications",
    icon: "ClipboardCheck",
    sortOrder: 10,
    requiredPermissionCode: Permission.SELLER_APPLICATION_READ,
  },
  {
    area: "admin",
    groupCode: "seller",
    groupLabel: "Người bán",
    groupOrder: 20,
    code: "admin.shop_profile_changes",
    label: "Thay đổi hồ sơ shop",
    description: "Duyệt thay đổi thuế, thanh toán và định danh",
    href: "/admin/sellers/profile-changes",
    icon: "FilePenLine",
    sortOrder: 20,
    requiredPermissionCode: Permission.ADMIN_SHOP_PROFILE_CHANGE_REQUEST_READ,
  },
  {
    area: "admin",
    groupCode: "system",
    groupLabel: "Hệ thống",
    groupOrder: 90,
    code: "admin.access_control",
    label: "Phân quyền",
    description: "Vai trò, quyền, scope và menu",
    href: "/admin/access-control",
    icon: "ShieldCheck",
    sortOrder: 10,
    requiredPermissionCode: Permission.ADMIN_ACCESS_CONTROL_READ,
  },
  {
    area: "seller",
    groupCode: "overview",
    groupLabel: "Tổng quan",
    groupOrder: 10,
    code: "seller.dashboard",
    label: "Bảng điều khiển",
    description: "Doanh thu, đơn cần xử lý và sức khỏe shop",
    href: "/seller",
    icon: "LayoutDashboard",
    sortOrder: 10,
    requiredPermissionCode: Permission.SELLER_DASHBOARD_VIEW,
  },
  {
    area: "seller",
    groupCode: "products",
    groupLabel: "Quản lý sản phẩm",
    groupOrder: 20,
    code: "seller.ai.image_optimization",
    label: "Tối ưu hình ảnh AI",
    description: "Tạo ảnh nền trắng và ảnh lifestyle cho sản phẩm",
    href: "/seller/ai/optimization",
    icon: "AiAssistant",
    sortOrder: 5,
    requiredPermissionCode: Permission.SELLER_AI_IMAGE_OPTIMIZATION_VIEW,
    requiredScope: PermissionScope.OWN_SHOP,
  },
  {
    area: "seller",
    groupCode: "products",
    groupLabel: "Quản lý sản phẩm",
    groupOrder: 20,
    code: "seller.products",
    label: "Tất cả sản phẩm",
    description: "Theo dõi sản phẩm, giá bán, tồn kho và trạng thái hiển thị",
    href: "/seller/products",
    icon: "PackageSearch",
    sortOrder: 10,
    requiredPermissionCode: Permission.SELLER_PRODUCT_READ,
  },
  {
    area: "seller",
    groupCode: "products",
    groupLabel: "Quản lý sản phẩm",
    groupOrder: 20,
    code: "seller.products.create",
    label: "Thêm sản phẩm",
    description: "Tạo sản phẩm, phân loại, giá bán và tồn kho",
    href: "/seller/products/new",
    icon: "PackagePlus",
    sortOrder: 20,
    requiredPermissionCode: Permission.SELLER_PRODUCT_CREATE,
  },
  {
    area: "seller",
    groupCode: "orders",
    groupLabel: "Quản lý đơn hàng",
    groupOrder: 25,
    code: "seller.orders",
    label: "Đơn hàng",
    description: "Theo dõi đơn hàng có sản phẩm thuộc shop",
    href: "/seller/orders",
    icon: "ClipboardList",
    sortOrder: 10,
    requiredPermissionCode: Permission.SELLER_ORDER_READ,
    requiredScope: PermissionScope.OWN_SHOP,
  },
  {
    area: "seller",
    groupCode: "shop",
    groupLabel: "Quản lý shop",
    groupOrder: 30,
    code: "seller.shop_profile",
    label: "Hồ sơ shop",
    description: "Thông tin công khai, thuế và định danh của shop",
    href: "/seller/shop",
    icon: "Store",
    sortOrder: 10,
    requiredPermissionCode: Permission.SELLER_SHOP_PROFILE_READ,
  },
];
