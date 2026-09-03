# Nghiệp vụ hoàn hàng và hoàn tiền

## Luồng chuẩn

1. Customer chọn các item thuộc cùng một shop, chọn lý do, mô tả và bằng chứng.
2. Order Service kiểm tra order đã DELIVERED hoặc COMPLETED, còn trong thời hạn, item hợp lệ và không có request đang mở. Khi Customer báo chưa nhận/có vấn đề hoặc Seller duyệt return, order được đưa sang `RETURN_REFUND` để không còn nằm ở tab Chờ xác nhận/Hoàn thành; request hoàn vẫn theo state machine riêng bên dưới.
3. `CANCELLED` chỉ dùng cho Customer hủy đơn trước khi shipper lấy hàng.
4. Seller nhận notification, duyệt hoặc từ chối. Từ chối bắt buộc có lý do.
5. Khi được duyệt, request chuyển sang AWAITING_SHIPMENT. Seller tạo vận đơn chiều ngược với pickup là địa chỉ customer và điểm đến là shop.
6. Shipping Service theo dõi vận đơn. Khi trạng thái RETURNED, callback nội bộ đưa request sang RECEIVED.
7. Seller kiểm tra kiện hàng. Kết quả đạt chuyển sang REFUND_PENDING; không đạt chuyển sang INSPECTION_FAILED và bắt buộc có ghi chú.
8. Phase hiện tại kết thúc ở REFUND_PENDING; chưa có settlement hoặc thao tác chuyển tiền thủ công trong hệ thống.

## State machine

```text
REQUESTED -> AWAITING_SHIPMENT -> IN_TRANSIT -> RECEIVED
REQUESTED -> CUSTOMER_CANCELLED
REQUESTED -> REJECTED
RECEIVED -> REFUND_PENDING
RECEIVED -> INSPECTION_FAILED
```

## Quy tắc tiền

- `refundItemAmount` là tổng `lineTotal` của các item Customer chọn hoàn, được làm tròn về đồng VND.
- `refundShippingAmount` là phần phí vận chuyển chiều đi được hoàn, được phân bổ theo tỷ trọng item trong `subtotal` và làm tròn về đồng VND.
- Phí vận chuyển chỉ hoàn với các lý do thuộc lỗi seller.
- Với order nhiều shop, phí vận chuyển được phân bổ theo tỷ trọng giá trị item để tránh hoàn trùng.
- `returnShippingCost` là phí GHN chiều ngược customer → shop đã được báo và lưu ngay khi tạo request; khi tạo vận đơn, hệ thống cập nhật lại bằng `total_fee` thực tế nếu GHN trả về giá khác.
- `returnShippingFee` là phần chi phí chiều ngược bị trừ vào số tiền trả khách; lỗi seller thì bằng 0, lỗi từ Customer thì bằng `returnShippingCost`.
- Khi tạo request, Order Service gọi quote GHN đúng tuyến customer → shop để chốt số tiền dự kiến một lần. Khi tạo vận đơn hoàn, Shipping Service dùng `total_fee` GHN của chính tuyến này để đối soát; không suy ra phí chiều ngược từ `subtotal`.
- `refundAmount = refundItemAmount + refundShippingAmount - returnShippingFee` là tổng tiền cuối cùng trả khách.

## Media và cleanup

- Return evidence hỗ trợ tối đa 5 ảnh và 1 video.
- Các purpose được dùng là `return_image` và `return_video`.
- Upload dùng presigned POST; nếu submit request thất bại, frontend gọi cleanup qua Product Service, rồi Product Service gọi Media Service bằng internal token.
- Khi customer hủy hoặc request bị từ chối, evidence vẫn được giữ để phục vụ audit dispute.
- Media Service xóa theo prefix owner/asset/purpose, không nhận S3 key tùy ý.

## Phân quyền và notification

- Customer: tạo, xem và hủy request của mình.
- Seller: xem, duyệt, từ chối và kiểm tra request thuộc shop.
- Admin: quản trị nền tảng; không có queue chuyển tiền trong phase hiện tại.
- Các event return được publish sau khi lưu database; Notification Service tạo notification riêng cho customer và seller, có chống trùng theo event id.

## Tính nhất quán và retry

- Tạo vận đơn hoàn idempotent theo `returnRequestId`.
- Callback nhận hàng idempotent khi request đã ở RECEIVED.
- Các migration mở rộng enum/cột dùng `IF NOT EXISTS` để an toàn khi deploy lặp.
