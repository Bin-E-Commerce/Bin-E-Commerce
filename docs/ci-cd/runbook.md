# CI/CD production runbook

## Phạm vi

Repository chỉ có hai nhánh và hai môi trường:

- **Branch `dev`:** nhánh tích hợp duy nhất cho phát triển hằng ngày.
- **Branch `main`:** nhánh production, chỉ nhận Pull Request từ `dev`.

- **Local:** Docker Compose, Keycloak local và database local.
- **Production:** backend chạy tuần tự trên K3s/EC2; frontend deploy native trên Vercel từ `main`.

Không có staging. CI không đọc `.env`, không tạo secret và không deploy từ Pull Request.

## Luồng release

```text
push dev -> CI matrix -> Pull Request dev -> main -> CI main
                                                        |
                                                        v
                                      Build Images -> GHCR + Trivy + SBOM
                                                        |
                                                        v
                                      production approval -> K3s rollout
                                                        |
                                                        v
                                                smoke test / rollback
```

`CI` chạy khi push vào `dev`, push vào `main` và Pull Request vào `main`. `Build Images` chỉ chạy sau khi CI của commit `main` thành công. `Deploy Production` chỉ chạy sau Build Images thành công và dừng ở GitHub Environment `production` để reviewer approve.

Không push trực tiếp vào `main`. Mọi thay đổi đi qua `dev`, sau đó tạo Pull Request `dev -> main`.

## GitHub cấu hình một lần

Tạo Environment tên `production`, bật **Required reviewers**, sau đó thêm các Secrets sau:

Tạo thêm Repository Variable:

| Variable | Giá trị |
| --- | --- |
| `PRODUCTION_ENVIRONMENT` | `production` |

| Secret | Nội dung |
| --- | --- |
| `PROD_HOST` | IP hoặc hostname EC2 |
| `PROD_USER` | User SSH, thường là `ubuntu` |
| `PROD_SSH_PRIVATE_KEY` | Private key chỉ dùng cho deploy |
| `PROD_KNOWN_HOSTS` | Dòng host key lấy từ EC2, không dùng `StrictHostKeyChecking=no` |
| `PROD_K3S_MANIFEST_PATH` | Ví dụ `/opt/bin-ecommerce/k8s` |
| `GHCR_TOKEN` | Tuỳ chọn; nếu không có workflow dùng `GITHUB_TOKEN` |

`GITHUB_TOKEN` được ưu tiên về nguyên tắc least privilege cho GHCR. Nếu tổ chức yêu cầu PAT riêng thì tạo `GHCR_TOKEN` có quyền package tối thiểu, không dùng token admin.

EC2 phải có sẵn:

- K3s và namespace `bin-ecommerce-app`.
- `ghcr-pull-secret` để pull private image.
- `bin-ecommerce-runtime-secrets` và các secret runtime hiện tại.
- DNS/TLS cho API, Keycloak và frontend.

CD chỉ gọi `kubectl set image` cho service thay đổi. CD không apply Kafka/Keycloak và không ghi đè runtime Secret.

## Cách CI xác định service

`.github/scripts/detect-affected-services.mjs` trả về matrix dùng chung cho các workflow:

- `services/<service>/**`: chỉ service đó.
- `packages/common/**`: toàn bộ backend TypeScript.
- root `package.json`, `package-lock.json`, `tsconfig.base.json`, `turbo.json`: toàn bộ workspace liên quan.
- `web/**`: chỉ Web; Vercel chịu trách nhiệm deploy.
- `infra/k8s/**`: bật thêm job validate Kustomize.
- docs thuần tuý: không build service.
- thay đổi workflow/script CI: chạy lại toàn bộ matrix để tránh pipeline hỏng sau merge.

Git submodule phải được commit và push trước khi root repository cập nhật pointer. CI checkout đúng pointer đã commit; thay đổi chưa commit bên trong submodule không thể xuất hiện trong production image.

## Image và artifact

Mỗi backend image có dạng:

```text
ghcr.io/daongocanh25092004/bin-ecommerce-<service>:<full-commit-sha>
```

Không dùng `latest`. Buildx bật cache, provenance và SBOM. Trivy fail release nếu có lỗ hổng HIGH/CRITICAL đã có bản fix. Workflow lưu `release-manifest.json` gồm service, image tag và digest.

Frontend không tạo image; Vercel tiếp tục deploy theo branch `main` và giữ biến môi trường production riêng của Vercel.

## Deploy production

1. Push thay đổi vào `dev` và chờ CI xanh.
2. Tạo Pull Request `dev -> main`.
3. Merge Pull Request vào `main`.
4. Chờ `CI` và `Build Images` xanh.
5. Mở `Deploy Production`, kiểm tra commit SHA.
6. Reviewer approve Environment `production`.
7. Workflow SSH vào EC2 và deploy theo thứ tự:

   ```text
   auth-service
   catalog-service
   product-service
   cart-service
   shipping-service
   order-service
   seller-service
   media-service
   notification-service
   recommendation-service
   ai-service
   api-gateway
   ```

   API Gateway để cuối nhằm tránh expose request tới upstream đang rollout trên node EC2 một-node.

8. Mỗi service phải pass `rollout status` trong 180 giây.
9. Smoke test kiểm tra API health, Keycloak OIDC discovery và frontend HTTPS.

Nếu chỉ thay `web`, Vercel deploy theo cơ chế native và không tạo release backend.

## Rollback khẩn cấp

Nếu rollout hoặc smoke test fail, `scripts/deploy-production.sh` tự:

1. Dừng release.
2. Lấy image hiện tại của mỗi Deployment trước khi đổi.
3. Đổi ngược các Deployment đã chạm về image cũ.
4. Chờ rollout rollback.
5. Trả workflow về trạng thái failed để cần điều tra trước khi retry.

Rollback thủ công trên EC2:

```bash
sudo k3s kubectl -n bin-ecommerce-app get deploy -o wide
sudo k3s kubectl -n bin-ecommerce-app rollout history deployment/bin-ecommerce-auth-service
sudo k3s kubectl -n bin-ecommerce-app rollout undo deployment/bin-ecommerce-auth-service
sudo k3s kubectl -n bin-ecommerce-app rollout status deployment/bin-ecommerce-auth-service --timeout=180s
```

Rollback application không rollback database. Migration mới phải backward-compatible với image trước đó. Cơ chế migration hiện tại của từng service vẫn được giữ nguyên trong giai đoạn đầu; migration Job riêng sẽ là phase sau.

## Kustomize và data infrastructure

`infra/k8s/base` tách workload application, config, ingress và bundle data. `infra/k8s/overlays/production` là overlay để render/validate image contract. Do production chạy một node và yêu cầu không restart service không liên quan, release app dùng `set image` theo service thay đổi thay vì apply toàn bộ overlay mỗi lần.

Validate local:

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone infra/k8s/overlays/production
```

Kafka/Keycloak chỉ bootstrap hoặc nâng cấp bằng thao tác có chủ đích, sau khi backup và review manifest. Không đưa chúng vào workflow Build/Deploy application.

## Local verification

CI/CD file có thể kiểm tra mà không cần secret production:

```bash
node .github/scripts/detect-affected-services.mjs --base HEAD^ --head HEAD
docker compose --env-file infra/docker/.env --env-file .env \
  -f infra/docker/docker-compose.infra.yml config --quiet
```

Local dùng Keycloak `http://localhost:8080`, frontend callback `http://localhost:5173/callback` và API local. Production dùng domain HTTPS riêng; không copy `.env` local lên EC2.

## Điều tra lỗi thường gặp

- **CI không chạy service cần thiết:** xem log `Detect affected services` và kiểm tra submodule pointer có được commit không.
- **GHCR pull lỗi:** kiểm tra `ghcr-pull-secret`, package visibility và image tag full SHA.
- **Rollout timeout:** xem `kubectl describe deploy`, pod events và log container; không xoá Secret để thử lại.
- **Smoke test lỗi sau rollout:** workflow đã rollback application; kiểm tra ingress/DNS/API dependency trước khi retry.
- **Frontend vẫn dùng config cũ:** kiểm tra Vercel Environment Variables và redeploy Vercel; không đưa frontend vào K3s.
- **Kustomize validation lỗi:** chạy lệnh render local, kiểm tra raw manifest và không dùng `latest`.
