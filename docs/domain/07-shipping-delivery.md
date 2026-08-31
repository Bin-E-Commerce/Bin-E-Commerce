# Giao nhận

Hệ thống dùng một platform credential cho GHN Test. Seller chỉ quản lý địa chỉ lấy hàng, thời gian chuẩn bị và khung giờ bàn giao; không nhập token, không chọn provider và không tự đẩy trạng thái.

## Luồng nghiệp vụ

1. Checkout gom sản phẩm theo shop.
2. Order Service gửi một quote cho mỗi shop.
3. Shipping Service lấy pickup address mặc định từ Seller Service; cả pickup và destination đều đã lưu đủ mã GHN trước khi gọi API fee.
4. Chỉ khi tất cả quote thành công, checkout mới được tiếp tục.
5. Seller tạo shipment sau khi order đã `CONFIRMED`.
6. Shipping Service gửi create order với `client_order_code` ổn định.
7. Tracking được cập nhật bởi webhook GHN và polling dự phòng.

## GHN Test

```text
Base URL: https://dev-online-gateway.ghn.vn
Fee:    POST /shiip/public-api/v2/shipping-order/fee
Create: POST /shiip/public-api/v2/shipping-order/create
Detail: POST /shiip/public-api/v2/shipping-order/detail
Cancel: POST /shiip/public-api/v2/switch-status/cancel
Label:  POST /shiip/public-api/v2/a5/gen-token rồi GET /a5/public-api/printA5
```

Master data được frontend lấy qua API Gateway, còn token chỉ được dùng trong Shipping Service:

```text
GET  /api/v1/shipping/locations/provinces
GET  /api/v1/shipping/locations/districts?provinceId={id}
GET  /api/v1/shipping/locations/wards?districtId={id}
```

Fee/create dùng cân nặng gram và kích thước cm. GHN yêu cầu district ID và ward code; service không gửi UUID nội bộ.

## An toàn và idempotency

- Credential chỉ nằm ở Shipping Service.
- GHN Test bị khóa cứng ở adapter để không gọi production.
- Master data GHN được cache một giờ và deduplicate request đang chạy.
- Timeout khi create sẽ tra cứu bằng `client_order_code` trước; không retry mù.
- Webhook và polling dùng cùng state machine, không cho trạng thái cũ ghi đè trạng thái mới.
- Seller chỉ xem hoặc thao tác shipment thuộc shop của mình.

## Giới hạn hiện tại

Token Test phải đi cùng `GHN_SHOP_ID` Test. Địa chỉ mới phải chọn tỉnh, quận/huyện và phường/xã từ master data GHN; không còn bước đối chiếu qua dịch vụ địa chỉ nội bộ riêng.
