// Scope mô tả phạm vi dữ liệu mà permission được phép tác động.
// Permission giống nhau nhưng scope khác nhau sẽ tạo ra quyền vận hành khác nhau trong hệ thống lớn.
export enum PermissionScope {
  GLOBAL = "global", // Scope toàn cục, có thể tác động đến tất cả dữ liệu trong hệ thống.
  OWN = "own", // Scope cá nhân, chỉ có thể tác động đến dữ liệu của chính người dùng đó.
  OWN_SHOP = "own_shop", // Scope cửa hàng, chỉ có thể tác động đến dữ liệu của cửa hàng mà người dùng đó đang quản lý.
  ASSIGNED_SHOP = "assigned_shop", // Scope cửa hàng được chỉ định, chỉ có thể tác động đến dữ liệu của cửa hàng mà người dùng đó được chỉ định quản lý.
}
