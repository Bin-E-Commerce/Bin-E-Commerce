# Bin E-Commerce — Setup cho thành viên

Tài liệu này hướng dẫn chạy hệ thống local bằng Docker Compose và Web bằng Next.js.

## 1. Yêu cầu

- Git và quyền truy cập các repository/submodule.
- Node.js >= 20, npm >= 10.
- Docker Desktop đang chạy.
- Tối thiểu 8 GB RAM dành cho Docker Desktop.

## 2. Clone và cài dependency

~~~bash
git clone --recurse-submodules <repository-url>
cd E-commerce
git submodule update --init --recursive
npm ci
cd web && npm ci && cd ..
~~~

Nếu submodule bị rỗng:

~~~bash
git submodule update --init --recursive
~~~

## 3. Tạo file môi trường

PowerShell:

~~~powershell
Copy-Item .env.example .env
Copy-Item infra/docker/.env.example infra/docker/.env
Copy-Item web/.env.example web/.env
~~~

Bash:

~~~bash
cp .env.example .env
cp infra/docker/.env.example infra/docker/.env
cp web/.env.example web/.env
~~~

Không commit các file .env thật.

### Biến cần kiểm tra

infra/docker/.env phải có đủ biến cho PostgreSQL, MongoDB, Redis, Keycloak và Grafana.

Root .env cần kiểm tra tối thiểu:

~~~env
POSTGRES_PASSWORD=...
MONGODB_URI=mongodb://...
KEYCLOAK_CLIENT_SECRET=...
INTERNAL_SERVICE_TOKEN=...
AI_DATABASE_URL=postgresql+asyncpg://...
AI_REDIS_URL=redis://:password@redis:6379/0
REDIS_PASSWORD=password
~~~

REDIS_PASSWORD trong root .env phải giống infra/docker/.env và password bên trong AI_REDIS_URL.

Các biến OPENAI_API_KEY, SMTP và GHN chỉ cần điền khi sử dụng chức năng tương ứng. RANKING_MODEL_PATH chỉ cần điền khi đã có model LightGBM trong services/ai-service/artifacts.

Web dùng cấu hình local:

~~~env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_KEYCLOAK_URL=http://localhost:8080
NEXT_PUBLIC_KEYCLOAK_REALM=bin-ecommerce
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=web-client
NEXT_PUBLIC_APP_URL=http://localhost:5173
~~~

## 4. Khởi động hệ thống

### Bước 1 — Hạ tầng

~~~bash
docker compose --env-file infra/docker/.env \
  --env-file .env \
  -f infra/docker/docker-compose.infra.yml up -d
~~~

Hạ tầng gồm PostgreSQL, MongoDB, Redis, Kafka, Keycloak, Qdrant, Prometheus, Grafana và Kafka UI.

Kiểm tra:

~~~bash
docker compose --env-file infra/docker/.env \
  --env-file .env \
  -f infra/docker/docker-compose.infra.yml ps
~~~

### Bước 2 — Application services

~~~bash
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
~~~

### Bước 3 — Web

Mở terminal mới:

~~~bash
cd web
npm run dev
~~~

Truy cập Web tại http://localhost:5173.

## 5. Kiểm tra nhanh

~~~bash
curl http://localhost:3000/api/v1/health
~~~

| Thành phần | Địa chỉ |
| --- | --- |
| Web | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| Keycloak | http://localhost:8080 |
| Kafka UI | http://localhost:8081 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3030 |
| Qdrant | http://localhost:6333 |

## 6. Lệnh thường dùng

~~~bash
# Xem log application
docker compose --env-file .env logs -f <service-name>

# Rebuild application images
docker compose --env-file .env up -d --build

# Dừng application services, không xóa volume
docker compose --env-file .env stop

# Dừng infra, không xóa volume
npm run infra:down
~~~

Không dùng down -v, docker volume prune hoặc docker system prune nếu chưa backup dữ liệu.

## 7. Lỗi thường gặp

### Web không gọi được API

Kiểm tra NEXT_PUBLIC_API_URL=http://localhost:3000 trong web/.env, sau đó restart Web.

### Service không kết nối được Redis

Kiểm tra REDIS_PASSWORD trong root .env, infra/docker/.env và password trong AI_REDIS_URL phải giống nhau.

### Container chưa healthy

~~~bash
docker compose --env-file infra/docker/.env \
  --env-file .env \
  -f infra/docker/docker-compose.infra.yml ps
docker compose --env-file .env logs <service-name>
~~~

Chờ PostgreSQL, Kafka và Redis healthy trước khi đánh giá lỗi application service.
