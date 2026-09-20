# Cấu hình database managed miễn phí

Tài liệu này mô tả profile cloud cho Bin E-Commerce. S3/CDN đã có cấu hình riêng và không thay đổi trong tài liệu này.

## Thành phần được chọn

| Vai trò | Dịch vụ | Biến kết nối chính |
| --- | --- | --- |
| PostgreSQL | Neon Free | `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` |
| Document database | MongoDB Atlas Free | `MONGODB_URI` |
| Cache/rate limit | Upstash Redis Free | `REDIS_URL`, `AI_REDIS_URL` |
| Vector database | Qdrant Cloud Free | `QDRANT_URL`, `QDRANT_API_KEY` |

## Nguyên tắc dữ liệu

- PostgreSQL là nguồn dữ liệu giao dịch của các service quan hệ. Mỗi service tiếp tục dùng database riêng.
- MongoDB chỉ giữ document/notification data theo contract hiện tại.
- Redis chỉ giữ cache, session ngắn hạn, rate limit và realtime state; không dùng làm nguồn dữ liệu chính.
- Qdrant chỉ giữ embedding/vector và metadata tìm kiếm; PostgreSQL/MongoDB vẫn giữ dữ liệu nguồn.
- Upstash Free chỉ có một logical database phù hợp; các service phải dùng `REDIS_DB=0` và phân tách key theo namespace.

## Tạo tài nguyên

1. Tạo một Neon project và tạo các database `bin_ecommerce_auth`, `bin_ecommerce_seller`, `bin_ecommerce_product`, `bin_ecommerce_catalog`, `bin_ecommerce_cart`, `bin_ecommerce_order`, `bin_shipping`, `bin_ecommerce_recommendation`, `bin_ecommerce_ai`.
2. Tạo MongoDB Atlas Free cluster, database user và allowlist IP Elastic IP của EC2.
3. Tạo một Upstash Redis database, lấy URL `rediss://` có TLS.
4. Tạo một Qdrant Cloud Free cluster, lấy HTTPS endpoint và API key.
5. Chọn region gần EC2 nhất để giảm latency.

## Điền cấu hình

```powershell
Copy-Item .env.cloud.example .env.cloud
```

Điền secret thật vào `.env.cloud` trên máy deploy. Không đưa file này vào Git, Docker image hoặc frontend.

AI Service dùng URL riêng vì SQLAlchemy async cần scheme `postgresql+asyncpg`:

```text
AI_DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST/DATABASE?ssl=require
AI_REDIS_URL=rediss://default:PASSWORD@HOST:6379
```

## Chạy profile managed cloud

Giữ Kafka, Keycloak và observability local trên EC2; application services sẽ kết nối database managed qua các biến trong `.env.cloud`:

```powershell
docker compose --env-file infra/docker/.env --env-file .env -f infra/docker/docker-compose.infra.yml up -d
docker compose --env-file .env -f docker-compose.yml up -d --build
```

`infra/docker/docker-compose.infra.yml` không còn tạo PostgreSQL, MongoDB, Redis hoặc Qdrant local. File này chỉ chạy Kafka, Keycloak, Prometheus, Grafana và Kafka UI; các application service dùng endpoint managed cloud trong root `.env`.

## Kiểm tra sau khi kết nối

```powershell
docker compose --env-file .env -f docker-compose.yml ps
docker compose --env-file .env -f docker-compose.yml logs --tail=100 auth-service product-service recommendation-service ai-service
```

Chỉ sau khi các healthcheck, migration, đăng nhập, tạo sản phẩm, recommendation và image optimization chạy ổn định mới dừng database local và giảm instance EC2.
