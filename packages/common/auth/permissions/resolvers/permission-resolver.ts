import { UserRole } from "../../../enums/user-role.enum";
import { Permission } from "../contracts/permission.enum";
import { ROLE_PERMISSION_DEFINITIONS } from "../manifests/access-control.manifest";

// Chuẩn hóa một role dạng string về UserRole nghiệp vụ.
// Role kỹ thuật của Keycloak như offline_access hoặc uma_authorization sẽ bị bỏ qua.
export function normalizeRoleCode(role: string): UserRole | null {
  const normalized = role.trim().toUpperCase();
  return Object.values(UserRole).includes(normalized as UserRole)
    ? (normalized as UserRole)
    : null;
}

// Chuẩn hóa danh sách role trước khi tính quyền.
// CUSTOMER là role nền; nếu user có role vận hành cao hơn thì bỏ CUSTOMER để FE không hiển thị sai ngữ cảnh.
export function normalizeBusinessRoles(roles: string[]): UserRole[] {
  // Dùng Set để loại role trùng khi role xuất hiện đồng thời trong realm_access, resource_access hoặc DB.
  const normalizedRoles = [
    ...new Set(
      roles
        .map((role) => normalizeRoleCode(role))
        .filter((role): role is UserRole => Boolean(role)),
    ),
  ];

  if (normalizedRoles.length <= 1) return normalizedRoles;

  // Khi đã có ADMIN/SUPPORT_AGENT/SELLER, CUSTOMER chỉ còn là vai trò mặc định của Keycloak.
  return normalizedRoles.filter((role) => role !== UserRole.CUSTOMER);
}

// Resolve permission từ role bằng manifest mặc định.
// Hàm này chỉ dùng cho fallback/seed logic; runtime chính vẫn nên lấy permission động từ DB qua Auth Service.
export function derivePermissionsFromRoles(roles: string[]): Permission[] {
  const permissions = new Set<Permission>();
  const normalizedRoles = normalizeBusinessRoles(roles);

  // Mỗi role có thể sinh nhiều permission; Set giữ kết quả gọn và không trùng.
  for (const definition of ROLE_PERMISSION_DEFINITIONS) {
    if (normalizedRoles.includes(definition.roleCode)) {
      permissions.add(definition.permissionCode);
    }
  }

  return [...permissions];
}
