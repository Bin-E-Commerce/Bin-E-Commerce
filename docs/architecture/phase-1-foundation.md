# Giai đoạn 1: Triển khai nền tảng và ứng dụng trên EC2 + k3s

> Mục tiêu của giai đoạn này là đưa hệ thống thật lên môi trường deploy trước khi tiếp tục phát triển tính năng mới.
>
> Phạm vi: EC2 Ubuntu 24.04, k3s single-node, Traefik Ingress, HTTPS, application services, Kafka, Keycloak, AI workers, Prometheus, Grafana và logging. PostgreSQL, MongoDB, Redis, Qdrant và S3 dùng dịch vụ cloud đã cấu hình sẵn.

## 1. Kết quả cuối cùng

Sau khi hoàn thành, request phải đi theo luồng:

```text
Browser
   |
   v
Vercel Web
   |
   | HTTPS: https://api.<domain-cua-ban>
   v
Elastic IP của EC2
   |
   v
Traefik Ingress trong k3s
   |
   v
API Gateway
   |
   +--> Auth Service --------> Keycloak + PostgreSQL cloud
   +--> Seller Service ------> PostgreSQL cloud
   +--> Product Service -----> PostgreSQL cloud + S3
   +--> Catalog Service -----> PostgreSQL cloud
   +--> Cart Service --------> PostgreSQL cloud + Redis cloud
   +--> Order Service -------> PostgreSQL cloud + Kafka
   +--> Shipping Service ----> PostgreSQL cloud
   +--> Notification Service > MongoDB cloud + Redis cloud
   +--> Recommendation -----> PostgreSQL cloud + Redis cloud + Qdrant cloud
   +--> AI Service ----------> PostgreSQL cloud + Redis cloud + S3
   +--> AI Workers ----------> Kafka + cloud databases + S3
```

K3s chỉ chạy workload và điều phối container. K3s không sở hữu dữ liệu business. Database cloud là nguồn dữ liệu chính; không dựng lại PostgreSQL, MongoDB, Redis hoặc Qdrant bằng Docker trên EC2.

## 2. Quyết định hạ tầng đã chốt

| Thành phần | Cấu hình / vị trí | Ghi chú |
| --- | --- | --- |
| Frontend | Vercel | Chỉ chứa biến `NEXT_PUBLIC_*` an toàn |
| Compute | Một EC2 AWS | Chạy Ubuntu và k3s single-node |
| EC2 instance | `c7i-flex.large` | 2 vCPU, 4 GiB RAM |
| EC2 disk | 30 GiB gp3 | Chỉ lưu image, log, Kafka/Keycloak và manifest cần thiết |
| Kubernetes | k3s | Control plane và worker cùng một node |
| Ingress | Traefik tích hợp trong k3s | Route API và terminate HTTPS |
| PostgreSQL | Cloud PostgreSQL | Các database/schema của backend và Keycloak |
| MongoDB | MongoDB Atlas/cloud | Notification/document data |
| Redis | Upstash/cloud Redis | Cache, session, OTP và recommendation cache |
| Qdrant | Qdrant Cloud | Vector embedding recommendation |
| Object storage | Amazon S3 | Ảnh và file |
| Event bus | Kafka trong k3s | Một broker cho môi trường demo |
| Identity provider | Keycloak trong k3s | Kết nối PostgreSQL cloud |
| Monitoring | Prometheus + Grafana | Chạy resource limit thấp |
| Logging | Loki + Alloy | Retention ngắn để không đầy disk |

### Vì sao giảm từ `m7i-flex.large` xuống `c7i-flex.large`?

Trước đây EC2 cần nhiều RAM vì còn dự định chạy database local. Khi database chuyển lên cloud, EC2 không còn phải giữ PostgreSQL, MongoDB, Redis và Qdrant nên giảm từ 8 GiB xuống 4 GiB là hợp lý cho demo.

Tuy nhiên 4 GiB vẫn là giới hạn chặt. Không chạy nhiều replica, không build Docker image trên EC2 và không training model nặng trên node. Nếu thấy `OOMKilled`, tắt workload không cần thiết trước khi tăng instance.

## 3. Những thứ không làm trong Phase 1

- Không cài Docker Compose database lên EC2.
- Không public các port PostgreSQL, MongoDB, Redis, Kafka, Qdrant, Keycloak, Prometheus và Grafana trực tiếp bằng Security Group.
- Không dùng EKS, AWS ALB/NLB, NAT Gateway, RDS, MSK hoặc ElastiCache trong kiến trúc tiết kiệm hiện tại.
- Không build image trên EC2 4 GiB.
- Không dùng tag image `latest`.
- Không commit `.env`, kubeconfig hoặc private key.
- Không chạy training model lớn trên EC2.
- Không tạo nhiều replica khi chưa đo RAM.
- Không xóa database cloud để xử lý lỗi deploy.

## 4. Chuẩn bị trước khi mở AWS Console

Chuẩn bị sẵn:

- Tài khoản AWS có Free Tier/credit còn hạn.
- Key pair `.pem` dùng để SSH.
- Domain hoặc subdomain dành cho API, ví dụ `api.example.com`.
- File `.env` trên máy Windows. File này chứa secret và không được đưa lên Git.
- Tài khoản container registry, khuyến nghị GitHub Container Registry (GHCR).
- Mã nguồn đã build/test local.
- Các endpoint cloud PostgreSQL, MongoDB, Redis, Qdrant và S3 đã kiểm tra bằng môi trường local.

Kiểm tra Git không theo dõi file secret trên Windows PowerShell:

```powershell
git check-ignore -v .env
git status --short
```

Nếu `.env` không bị ignore, dừng lại và bổ sung vào `.gitignore` trước khi tiếp tục. Không in giá trị file bằng `Get-Content` trong terminal hoặc đưa secret vào ảnh chụp màn hình.

## 5. Tạo EC2 trên AWS

Vào:

```text
AWS Console → EC2 → Instances → Launch instances
```

Chọn đúng:

| Thiết lập | Giá trị |
| --- | --- |
| Name | `bin-ecommerce-platform-01` |
| AMI | Ubuntu Server 24.04 LTS |
| Architecture | 64-bit x86 |
| Instance type | `c7i-flex.large` |
| vCPU | 2 |
| Memory | 4 GiB |
| Root volume | 30 GiB, gp3 |
| Quantity | 1 |
| Key pair | `bin-ecommerce-platform-key` |
| Public IPv4 | Bật khi tạo |
| VPC/Subnet | Public subnet có Internet Gateway |
| Auto-assign public IP | Bật |

### Vì sao dùng Ubuntu 24.04 x86?

- Username SSH chuẩn là `ubuntu`.
- Docker image Node/Python hiện tại đang build cho x86_64.
- Tránh nhầm AMI ARM với instance x86.
- Ubuntu 24.04 LTS phù hợp cho k3s và được hỗ trợ lâu dài.

### Kiểm tra sau khi tạo

Không vội cài phần mềm ngay. Kiểm tra trước:

1. Instance state là `Running`.
2. Instance type là `c7i-flex.large`.
3. AMI là Ubuntu Server 24.04 LTS.
4. Public IPv4 đã được cấp.
5. Key pair đúng tên.
6. Security Group đúng như phần tiếp theo.

`Free tier eligible` chỉ là nhãn eligibility của tài khoản, khu vực và loại instance tại thời điểm tạo. Vẫn phải theo dõi Billing, EBS, Elastic IP, data transfer và số giờ chạy thực tế.

## 6. Cấu hình Security Group

Tạo Security Group:

```text
bin-ecommerce-platform-sg
```

Inbound rules tối thiểu:

| Type | Port | Source | Mục đích |
| --- | ---: | --- | --- |
| SSH | 22 | My IP | EC2 administration |
| HTTP | 80 | `0.0.0.0/0` | HTTP and ACME challenge |
| HTTPS | 443 | `0.0.0.0/0` | Public API |

Không mở public:

```text
3000-3010   Application service ports
6443        Kubernetes API Server
5432        PostgreSQL
27017       MongoDB
6379        Redis
9092        Kafka
6333        Qdrant
8080        Keycloak
9090        Prometheus
3000        Grafana
```

Lưu ý: port `22` chỉ cho IP hiện tại của máy bạn. Nếu IP nhà mạng thay đổi, cập nhật rule; không mở SSH cho toàn Internet nếu không bắt buộc.

## 7. Gắn Elastic IP và cấu hình DNS

Vào:

```text
EC2 → Elastic IPs → Allocate Elastic IP address
```

Sau đó:

```text
Actions → Associate Elastic IP address → bin-ecommerce-platform-01
```

Tại nhà cung cấp domain tạo record:

```text
Type: A
Name: api
Value: <Elastic IP của EC2>
TTL: 300
```

Kiểm tra từ Windows:

```powershell
Resolve-DnsName api.example.com
```

Kết quả phải trả về đúng Elastic IP. Không dùng Public IPv4 tạm thời cho DNS vì địa chỉ đó có thể đổi sau stop/start.

## 8. SSH từ Windows vào EC2

Mở PowerShell trên máy cá nhân:

```powershell
$keyPath = "C:\Users\FPT-ACER\Downloads\bin-ecommerce-platform-key.pem"
$elasticIp = "<ELASTIC_IP_THAT>"

ssh -i $keyPath -o IdentitiesOnly=yes ubuntu@$elasticIp
```

Ý nghĩa:

- `$keyPath`: đường dẫn private key, không phải public key.
- `$elasticIp`: địa chỉ IP ổn định của EC2.
- `-i`: chỉ định key dùng để xác thực.
- `IdentitiesOnly=yes`: tránh SSH thử nhầm key khác.
- `ubuntu`: username mặc định của Ubuntu AMI.

Nếu lỗi `Permission denied`:

- Kiểm tra đúng key pair lúc tạo instance.
- Kiểm tra username là `ubuntu`.
- Kiểm tra file `.pem` tồn tại.
- Trên Windows không cần chạy `chmod`; chỉ cần giữ private key riêng tư.

Nếu timeout:

- Kiểm tra instance đang `Running`.
- Kiểm tra Security Group port 22 cho đúng My IP.
- Kiểm tra subnet có route tới Internet Gateway.
- Kiểm tra Elastic IP đã associate đúng instance.

## 9. Chuẩn bị Ubuntu

Chạy trên EC2 sau khi SSH thành công:

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y \
  ca-certificates \
  curl \
  jq \
  git \
  unzip \
  htop \
  dnsutils \
  net-tools
```

Giải thích:

- `apt-get update`: cập nhật danh sách package.
- `apt-get upgrade`: cài bản vá hệ điều hành.
- `ca-certificates`: xác minh HTTPS.
- `curl`: tải script và kiểm tra HTTP.
- `jq`: đọc JSON khi kiểm tra Kubernetes/API.
- `git`: lấy manifest hoặc source cần thiết.
- `unzip`: giải nén công cụ.
- `htop`: theo dõi CPU/RAM.
- `dnsutils`: cung cấp `dig`.
- `net-tools`: hỗ trợ kiểm tra network khi debug.

Đặt hostname:

```bash
sudo hostnamectl set-hostname bin-ecommerce-node-01
hostname
```

Kiểm tra tài nguyên:

```bash
uname -m
free -h
df -h /
sudo ss -lntp
```

Kết quả cần xác nhận:

- `uname -m` là `x86_64`.
- RAM gần 4 GiB.
- Root disk gần 30 GiB.
- Chưa có process lạ chiếm port 80 hoặc 443.

Không cài Docker trên node chỉ để chạy ứng dụng. K3s đã có containerd làm runtime. Docker chỉ dùng trên máy build hoặc CI để tạo image.

### Chính sách RAM cho instance 4 GiB

Không bật toàn bộ workload nặng ngay lập tức. Thứ tự bật:

1. K3s và Traefik.
2. Kafka và Keycloak.
3. API Gateway và commerce services.
4. Recommendation và AI workers.
5. Prometheus, Grafana, Loki.

Sau mỗi nhóm kiểm tra:

```bash
free -h
df -h /
kubectl get pods --all-namespaces
```

Nếu Pod bị `OOMKilled`, giảm workload trước; không tăng replica và không bật thêm worker.

## 10. Cài k3s

K3s là Kubernetes nhẹ chạy bên trong EC2. EC2 cung cấp CPU/RAM/network; k3s điều phối Pod, Service, Deployment, Ingress và tự khôi phục Pod.

Tải installer về file tạm để có thể xem trước:

```bash
curl -sfL https://get.k3s.io -o /tmp/install-k3s.sh
chmod 700 /tmp/install-k3s.sh
less /tmp/install-k3s.sh
```

Các tham số:

- `-s`: không in tiến trình tải.
- `-f`: dừng khi HTTP request lỗi.
- `-L`: theo redirect.
- `-o`: lưu script vào file.
- `chmod 700`: chỉ owner được đọc/chạy script.
- `less`: xem script trước khi chạy installer có quyền root.

Cài k3s:

```bash
sudo sh /tmp/install-k3s.sh server
```

K3s sẽ cài:

- Kubernetes server/control plane.
- Kubelet.
- Containerd.
- CoreDNS.
- Traefik Ingress.
- Local-path provisioner.
- `kubectl` tích hợp.

Kiểm tra systemd:

```bash
sudo systemctl status k3s --no-pager
sudo systemctl enable k3s
```

Trạng thái cần có:

```text
Active: active (running)
```

## 11. Cấu hình kubectl

K3s lưu kubeconfig quản trị ở:

```text
/etc/rancher/k3s/k3s.yaml
```

Sao chép kubeconfig cho user `ubuntu`:

```bash
mkdir -p "$HOME/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
sudo chown "$USER:$USER" "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"
```

Kiểm tra:

```bash
kubectl version
kubectl get nodes -o wide
kubectl cluster-info
```

Node cần có:

```text
STATUS: Ready
ROLES: control-plane,etcd
```

Kubeconfig chứa quyền quản trị cluster. Không tải file này lên GitHub, không gửi qua chat và không đưa vào Docker image.

## 12. Kiểm tra Traefik và namespace hệ thống

```bash
kubectl get pods -n kube-system -o wide
kubectl get service -n kube-system
kubectl get ingressclass
kubectl get service -n kube-system traefik
```

Cần thấy:

- Pod Traefik ở trạng thái `Running`.
- `IngressClass` tên `traefik`.
- Traefik lắng nghe HTTP/HTTPS qua cơ chế ServiceLB của k3s.

Tạo namespace:

```bash
for namespace in \
  bin-ecommerce-app \
  bin-ecommerce-data \
  bin-ecommerce-jobs \
  bin-ecommerce-observability \
  bin-ecommerce-ingress; do
  kubectl create namespace "$namespace" \
    --dry-run=client \
    -o yaml | kubectl apply -f -
done
```

Giải thích:

- Vòng lặp đi qua từng namespace.
- `--dry-run=client` chỉ tạo manifest ở phía client.
- `-o yaml` xuất manifest YAML.
- `kubectl apply -f -` đọc YAML từ pipe.
- Có thể chạy lại an toàn vì `apply` có tính idempotent.

Gắn label để phân biệt workload:

```bash
kubectl label namespace bin-ecommerce-app \
  app.kubernetes.io/part-of=bin-ecommerce --overwrite

kubectl label namespace bin-ecommerce-data \
  app.kubernetes.io/part-of=bin-ecommerce --overwrite

kubectl label namespace bin-ecommerce-observability \
  app.kubernetes.io/part-of=bin-ecommerce --overwrite
```

## 13. Đưa `.env` lên EC2 an toàn

### 13.1. Chép file `.env` từ Windows

Thực hiện từ PowerShell trên máy cá nhân:

```powershell
$keyPath = "C:\Users\FPT-ACER\Downloads\bin-ecommerce-platform-key.pem"
$elasticIp = "<ELASTIC_IP_THAT>"
$envFile = "E:\Study\Project\E-commerce\.env"

scp -i $keyPath -o IdentitiesOnly=yes `
  $envFile `
  ubuntu@$elasticIp:/tmp/bin-ecommerce.env
```

Lệnh này gửi file qua SSH vào thư mục tạm. Không dùng email, chat hoặc commit để gửi file secret.

### 13.2. Cất file vào thư mục chỉ root đọc được

SSH lại vào EC2 và chạy:

```bash
sudo install -d -m 700 /opt/bin-ecommerce/secrets
sudo mv /tmp/bin-ecommerce.env \
  /opt/bin-ecommerce/secrets/.env
sudo chown root:root /opt/bin-ecommerce/secrets/.env
sudo chmod 600 /opt/bin-ecommerce/secrets/.env
```

Kiểm tra permission mà không in nội dung:

```bash
sudo stat -c '%A %U:%G %n' \
  /opt/bin-ecommerce/secrets/.env
```

Kết quả cần tương tự:

```text
-rw------- root:root /opt/bin-ecommerce/secrets/.env
```

### 13.3. Không mount toàn bộ `.env` mù quáng

Không phải service nào cũng dùng cùng `POSTGRES_DB`, port hoặc credential. Cần chia secret theo boundary:

| Secret | Dùng cho |
| --- | --- |
| `bin-ecommerce-postgres-secret` | Host, port, user, password, SSL của PostgreSQL |
| `bin-ecommerce-mongo-secret` | MongoDB URI và password |
| `bin-ecommerce-redis-secret` | Redis URL, password, database index |
| `bin-ecommerce-qdrant-secret` | Qdrant URL và API key |
| `bin-ecommerce-s3-secret` | Bucket, region, access key và secret key |
| `bin-ecommerce-kafka-secret` | Chỉ khi Kafka có auth |
| `bin-ecommerce-keycloak-secret` | Admin/bootstrap secret và DB config |

`POSTGRES_DB` phải được khai báo riêng cho từng service hoặc từng migration Job. Không dùng một database name chung nếu kiến trúc đã tách database theo bounded context.

`.env` là file nguồn duy nhất. Kubernetes Secret có thể chứa các key trong `.env`, còn mỗi Deployment chỉ tham chiếu đúng key mà service đó cần:

```bash
kubectl create secret generic bin-ecommerce-runtime-secrets \
  --namespace=bin-ecommerce-app \
  --from-env-file=/opt/bin-ecommerce/secrets/.env \
  --dry-run=client \
  -o yaml | kubectl apply -f -
```

Ví dụ Deployment chỉ lấy các key PostgreSQL cần thiết:

```yaml
env:
  - name: POSTGRES_HOST
    valueFrom:
      secretKeyRef:
        name: bin-ecommerce-runtime-secrets
        key: POSTGRES_HOST
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: bin-ecommerce-runtime-secrets
        key: POSTGRES_PASSWORD
```

Không đưa giá trị thật vào manifest YAML. Kubernetes Secret chỉ base64, không phải mã hóa tuyệt đối; quyền đọc Secret phải giới hạn bằng RBAC.

Kiểm tra tên key, không kiểm tra giá trị:

```bash
kubectl get secret bin-ecommerce-postgres-secret \
  --namespace=bin-ecommerce-app \
  -o json | jq -r '.data | keys[]'
```

## 14. Chuẩn bị registry và Docker image

Không build image trên EC2 4 GiB. Build trên máy cá nhân hoặc GitHub Actions, sau đó push lên GHCR.

### 14.1. Đăng nhập GHCR

Tạo GitHub Personal Access Token có quyền tối thiểu `write:packages` và `read:packages`. Không ghi token trực tiếp vào command history.

Trên máy cá nhân:

```powershell
docker login ghcr.io -u <GITHUB_USERNAME>
```

Khi được hỏi password, paste token vào prompt. Không đặt token trong file Dockerfile, manifest hoặc `.env` frontend.

### 14.2. Chọn tag bất biến

```powershell
$tag = (git rev-parse --short=12 HEAD)
$owner = "<GITHUB_USERNAME>".ToLower()
```

`$tag` là commit đang build. Image cùng một tag phải luôn trỏ tới cùng một nội dung.

### 14.3. Build các Node service

Dockerfile của monorepo dùng repository root làm build context, vì vậy dấu `.` ở cuối lệnh là bắt buộc:

```powershell
$nodeServices = @(
  "api-gateway",
  "auth-service",
  "seller-service",
  "product-service",
  "catalog-service",
  "media-service",
  "recommendation-service",
  "cart-service",
  "order-service",
  "notification-service",
  "shipping-service"
)

foreach ($service in $nodeServices) {
  $image = "ghcr.io/$owner/bin-ecommerce-$service`:$tag"
  docker build `
    --file "services/$service/Dockerfile" `
    --tag $image `
    .
  docker push $image
}
```

### 14.4. Build AI image và dùng command khác nhau

AI API và các worker dùng chung image `ai-service`; Kubernetes chỉ thay đổi command:

```powershell
$aiImage = "ghcr.io/$owner/bin-ecommerce-ai-service`:$tag"

docker build `
  --file services/ai-service/Dockerfile `
  --tag $aiImage `
  .

docker push $aiImage
```

Các workload AI:

| Workload | Image | Command |
| --- | --- | --- |
| AI API | `bin-ecommerce-ai-service:<tag>` | Command mặc định FastAPI |
| Embedding worker | Cùng image | Command worker embedding |
| Image worker | Cùng image | Command worker image optimization |
| Ranking worker | Cùng image | Command worker ranking |
| Outbox relay | Cùng image | Command relay outbox |

Command chính xác phải lấy từ `docker-compose.yml` hoặc Dockerfile hiện tại của service; không tự đổi command khi chưa kiểm tra entrypoint.

### 14.5. Tạo imagePullSecret trên k3s

Trên EC2, dùng token read-only nếu registry hỗ trợ:

```bash
kubectl create secret docker-registry ghcr-pull-secret \
  --namespace=bin-ecommerce-app \
  --docker-server=ghcr.io \
  --docker-username=<GITHUB_USERNAME> \
  --docker-password='<GHCR_READ_TOKEN>' \
  --dry-run=client \
  -o yaml | kubectl apply -f -
```

Manifest Deployment phải tham chiếu:

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret
```

Sau khi chạy xong, xóa token khỏi shell history nếu token từng xuất hiện trong command. Tốt hơn là dùng prompt hoặc secret manager.

## 15. Chuẩn bị cấu trúc Kubernetes manifest

Tạo cấu trúc manifest rõ ràng, không trộn Secret thật vào Git:

```text
infra/k8s/
├── namespaces/
├── config/
├── data/
│   ├── kafka/
│   └── keycloak/
├── jobs/
│   └── migrations/
├── apps/
│   ├── api-gateway/
│   ├── auth-service/
│   ├── seller-service/
│   ├── product-service/
│   ├── catalog-service/
│   ├── media-service/
│   ├── cart-service/
│   ├── order-service/
│   ├── notification-service/
│   ├── shipping-service/
│   ├── recommendation-service/
│   └── ai/
├── observability/
└── ingress/
```

Mỗi application Deployment phải có:

- `replicas: 1`.
- `image` tag theo commit SHA.
- `imagePullSecrets` nếu GHCR private.
- `envFrom` hoặc `secretKeyRef` cho secret.
- `resources.requests` và `resources.limits`.
- `readinessProbe`.
- `livenessProbe`.
- `Service` loại `ClusterIP`.
- label `app.kubernetes.io/name` và `app.kubernetes.io/part-of`.

Ví dụ khung Deployment an toàn:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bin-ecommerce-api-gateway
  namespace: bin-ecommerce-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: bin-ecommerce-api-gateway
  template:
    metadata:
      labels:
        app.kubernetes.io/name: bin-ecommerce-api-gateway
        app.kubernetes.io/part-of: bin-ecommerce
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret
      containers:
        - name: api-gateway
          image: ghcr.io/<owner>/bin-ecommerce-api-gateway:<commit-sha>
          ports:
            - name: http
              containerPort: 3000
          resources:
            requests:
              cpu: 25m
              memory: 96Mi
            limits:
              cpu: 250m
              memory: 256Mi
          readinessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: bin-ecommerce-api-gateway
  namespace: bin-ecommerce-app
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: bin-ecommerce-api-gateway
  ports:
    - name: http
      port: 80
      targetPort: http
```

Port trong ví dụ phải khớp `PORT` thật của service. Không copy nguyên manifest nếu service đang dùng port khác.

## 16. Deploy theo dependency order

Không apply toàn bộ stack một lần. Deploy theo nhóm và kiểm tra sau từng nhóm.

### 16.1. Namespace, ConfigMap và Secret

```bash
kubectl apply -f infra/k8s/namespaces/
kubectl apply -f infra/k8s/config/
kubectl get namespaces
kubectl get configmap,secret -n bin-ecommerce-app
```

Kết quả cần có namespace và Secret. Không dùng `kubectl get secret -o yaml` để gửi lên chat vì manifest có thể chứa dữ liệu nhạy cảm.

### 16.2. Kafka và Keycloak

Kafka là event bus cho order, notification, recommendation và AI workers. Keycloak là OIDC provider. Hai thành phần này là workload trong k3s; PostgreSQL của Keycloak vẫn dùng cloud.

```bash
kubectl apply -f infra/k8s/data/kafka/
kubectl apply -f infra/k8s/data/keycloak/

kubectl get pods -n bin-ecommerce-data -o wide
kubectl get svc -n bin-ecommerce-data
```

Kafka demo chỉ chạy một broker. Keycloak chỉ chạy một replica. Không scale hai thành phần này trên single-node 4 GiB.

Kiểm tra Kafka trước khi deploy consumer:

```bash
kubectl logs -n bin-ecommerce-data statefulset/<kafka-statefulset-name>
kubectl describe pod -n bin-ecommerce-data <kafka-pod-name>
```

Kiểm tra Keycloak:

```bash
kubectl rollout status deployment/<keycloak-deployment-name> \
  -n bin-ecommerce-data \
  --timeout=180s
kubectl logs -n bin-ecommerce-data deployment/<keycloak-deployment-name>
```

Không public Kafka hoặc Keycloak admin port. Chỉ API Gateway hoặc các service nội bộ trong cluster được gọi tới chúng.

### 16.3. Database migration Job

Migration phải chạy trước application Deployment:

```bash
kubectl apply -f infra/k8s/jobs/migrations/
kubectl get jobs -n bin-ecommerce-jobs
kubectl get pods -n bin-ecommerce-jobs
```

Theo dõi Job:

```bash
kubectl wait \
  --for=condition=complete \
  --timeout=300s \
  job/<migration-job-name> \
  -n bin-ecommerce-jobs
```

Nếu Job lỗi:

```bash
kubectl describe job <migration-job-name> -n bin-ecommerce-jobs
kubectl logs job/<migration-job-name> -n bin-ecommerce-jobs
```

Các lỗi thường gặp:

- Sai hostname cloud database.
- Sai password hoặc database name.
- Thiếu `ssl=require` cho Neon/Azure PostgreSQL.
- Cloud database chưa cho phép kết nối từ EC2.
- Migration chạy nhầm database.

### 16.4. Deploy commerce services

Deploy theo thứ tự:

```bash
kubectl apply -f infra/k8s/apps/auth-service/
kubectl apply -f infra/k8s/apps/product-service/
kubectl apply -f infra/k8s/apps/catalog-service/
kubectl apply -f infra/k8s/apps/seller-service/
kubectl apply -f infra/k8s/apps/media-service/
kubectl apply -f infra/k8s/apps/cart-service/
kubectl apply -f infra/k8s/apps/order-service/
kubectl apply -f infra/k8s/apps/shipping-service/
kubectl apply -f infra/k8s/apps/notification-service/
```

Theo dõi:

```bash
kubectl get deployment,pods,services \
  -n bin-ecommerce-app \
  -o wide
```

Với từng service:

```bash
kubectl rollout status deployment/<service-name> \
  -n bin-ecommerce-app \
  --timeout=180s
```

Không chuyển sang service tiếp theo nếu service trước còn `CrashLoopBackOff`, `ImagePullBackOff` hoặc `0/1 Ready`.

### 16.5. Deploy Recommendation và AI workers

```bash
kubectl apply -f infra/k8s/apps/recommendation-service/
kubectl apply -f infra/k8s/apps/ai/
```

Kiểm tra:

```bash
kubectl get pods -n bin-ecommerce-app \
  -l app.kubernetes.io/part-of=bin-ecommerce \
  -o wide

kubectl logs -n bin-ecommerce-app deployment/<recommendation-deployment-name>
kubectl logs -n bin-ecommerce-app deployment/<embedding-worker-name>
kubectl logs -n bin-ecommerce-app deployment/<image-worker-name>
kubectl logs -n bin-ecommerce-app deployment/<ranking-worker-name>
```

Điều kiện đạt:

- Recommendation đọc được catalog cloud đã backfill.
- Qdrant URL/API key đúng.
- Redis recommendation đúng database index.
- Kafka consumer group hoạt động.
- Không phát sinh DLQ mới liên tục.
- API recommendation trả item với user mới và user đã có hành vi.

## 17. Deploy monitoring và logging

Monitoring không được deploy trước application vì sẽ làm khó phân biệt lỗi nền tảng và lỗi ứng dụng. Sau khi application Ready mới deploy:

```bash
sudo bash scripts/deploy-observability.sh
kubectl get pods -n bin-ecommerce-observability
kubectl get services -n bin-ecommerce-observability
```

Cần có tối thiểu:

- Prometheus thu thập metrics.
- Grafana đọc datasource Prometheus.
- Node Exporter theo dõi CPU/RAM/disk EC2.
- kube-state-metrics theo dõi Deployment/Pod/Service.
- Loki lưu log ngắn hạn.
- Alloy thu thập stdout/stderr của Pod.

Không public Grafana ngay. Nếu cần demo, route qua HTTPS và thêm authentication. Không đặt Grafana admin password trong ConfigMap.

Kiểm tra tài nguyên:

```bash
kubectl get pods -n bin-ecommerce-observability -o wide
free -h
df -h /
```

Retention mục tiêu cho demo:

- Prometheus: 3–7 ngày.
- Loki: 3–7 ngày.
- Kafka topic: vừa đủ phục vụ retry/DLQ.

## 18. Tạo Ingress HTTP cho API Gateway

Chỉ route API Gateway ra Internet. Không route trực tiếp Product, Cart, Order, Recommendation hoặc database.

Tạo Ingress tạm HTTP để kiểm tra trước HTTPS:

```bash
kubectl apply -f infra/k8s/ingress/api-http.yaml
kubectl get ingress -n bin-ecommerce-app
kubectl describe ingress bin-ecommerce-api -n bin-ecommerce-app
```

Manifest cần có cấu trúc tương đương:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: bin-ecommerce-api
  namespace: bin-ecommerce-app
spec:
  ingressClassName: traefik
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: bin-ecommerce-api-gateway
                port:
                  number: 80
```

Test từ EC2:

```bash
curl -i \
  -H 'Host: api.example.com' \
  http://127.0.0.1/api/health
```

Nếu trả `404`:

- Kiểm tra host có khớp `api.example.com`.
- Kiểm tra IngressClass là `traefik`.
- Kiểm tra Service name và port.
- Kiểm tra API Gateway có endpoint health đúng path.

Nếu trả `502`:

```bash
kubectl get endpoints bin-ecommerce-api-gateway -n bin-ecommerce-app
kubectl get pods -n bin-ecommerce-app
```

Endpoint rỗng nghĩa là selector Service không khớp label Pod hoặc Pod chưa Ready.

## 19. Cấu hình HTTPS bằng cert-manager

Cài Helm trước nếu chưa có:

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
  -o /tmp/get_helm.sh
chmod 700 /tmp/get_helm.sh
less /tmp/get_helm.sh
sudo bash /tmp/get_helm.sh
helm version
```

Cài cert-manager:

```bash
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

Kiểm tra:

```bash
kubectl get pods -n cert-manager
```

> Tại thời điểm này port 80 phải public để Let's Encrypt thực hiện HTTP-01 challenge.

Tạo ClusterIssuer bằng email thật:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: bin-ecommerce-letsencrypt-prod
spec:
  acme:
    email: your-real-email@example.com
    server: https://acme-v02.api.letsencrypt.org/directory
    privateKeySecretRef:
      name: bin-ecommerce-letsencrypt-account
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

Apply:

```bash
kubectl apply -f infra/k8s/ingress/cluster-issuer.yaml
```

Thêm TLS vào Ingress:

```yaml
metadata:
  name: bin-ecommerce-api
  namespace: bin-ecommerce-app
  annotations:
    cert-manager.io/cluster-issuer: bin-ecommerce-letsencrypt-prod
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - api.example.com
      secretName: bin-ecommerce-api-tls
```

Kiểm tra certificate:

```bash
kubectl get certificate -n bin-ecommerce-app
kubectl describe certificate bin-ecommerce-api-tls -n bin-ecommerce-app
kubectl get challenge,order -n bin-ecommerce-app
kubectl get secret bin-ecommerce-api-tls -n bin-ecommerce-app
```

Test:

```bash
curl -I https://api.example.com/api/health
```

Nếu certificate `Pending`, kiểm tra DNS, port 80, IngressClass, domain và challenge log trước khi tạo lại certificate.

## 20. Cấu hình Vercel sau khi API HTTPS hoạt động

Trong Vercel Project → Settings → Environment Variables, cấu hình biến production tương ứng với tên project hiện tại, ví dụ:

```ini
NEXT_PUBLIC_API_URL=https://api.example.com
```

Không đưa các biến sau lên Vercel frontend:

```text
POSTGRES_PASSWORD
MONGODB_URI
REDIS_PASSWORD
QDRANT_API_KEY
AWS_SECRET_ACCESS_KEY
INTERNAL_SERVICE_TOKEN
KEYCLOAK_CLIENT_SECRET
```

Sau khi lưu:

1. Redeploy Vercel.
2. Mở DevTools → Network.
3. Kiểm tra request không còn gọi `localhost`.
4. Kiểm tra CORS API cho đúng domain Vercel.
5. Kiểm tra login, product, cart, order và recommendation.

## 21. Kiểm tra end-to-end

Thực hiện đúng thứ tự này:

### 21.1. Kiểm tra cluster

```bash
kubectl get nodes -o wide
kubectl get pods --all-namespaces
kubectl get events --all-namespaces --sort-by=.lastTimestamp
```

### 21.2. Kiểm tra application

```bash
kubectl get deployment,pod,service \
  -n bin-ecommerce-app \
  -o wide
```

Tất cả service bắt buộc phải có Pod `1/1 Running` và Service có endpoint.

### 21.3. Kiểm tra authentication

- Mở frontend từ Vercel.
- Đăng nhập bằng tài khoản user.
- Đăng nhập bằng tài khoản seller.
- Kiểm tra tài khoản admin.
- Kiểm tra redirect Google nếu đã cấu hình.
- Kiểm tra Keycloak redirect URI đúng domain mới.

### 21.4. Kiểm tra commerce flow

- Xem danh sách sản phẩm.
- Mở chi tiết sản phẩm.
- Thêm sản phẩm vào giỏ.
- Cập nhật số lượng.
- Xóa sản phẩm khỏi giỏ.
- Tạo đơn hàng.
- Kiểm tra tồn kho và trạng thái đơn.
- Kiểm tra seller thấy sản phẩm và dữ liệu của đúng tài khoản.

### 21.5. Kiểm tra recommendation

- User mới vẫn nhận được sản phẩm fallback.
- User xem sản phẩm thì event được ghi.
- Thêm vào giỏ tạo event đúng.
- Recommendation catalog có sản phẩm.
- Redis không giữ response rỗng cũ.
- Qdrant có collection/vector tương ứng.
- Kafka consumer không đẩy event liên tục vào DLQ.

### 21.6. Kiểm tra AI

- AI Service health endpoint trả thành công.
- Image worker nhận job.
- Embedding worker nhận job.
- Ranking worker không crash do thiếu model/config.
- Outbox relay publish event thành công.

## 22. Theo dõi RAM và chi phí

Trên EC2 chạy liên tục:

```bash
free -h
df -h /
top
sudo journalctl -u k3s --since "30 minutes ago" --no-pager
```

Trong k3s:

```bash
kubectl get pods --all-namespaces -o wide
kubectl describe node
kubectl get events --all-namespaces --sort-by=.lastTimestamp
```

Dấu hiệu cần giảm tải:

- Pod có trạng thái `OOMKilled`.
- Node `MemoryPressure=True`.
- Kafka restart liên tục.
- Grafana/Loki chiếm nhiều RAM/disk.
- Request chậm do CPU credit hoặc memory pressure.

Thứ tự tắt khi cần giảm tải:

1. Tắt ranking worker nếu chưa demo ranking.
2. Tắt image worker nếu chưa demo AI image.
3. Giảm retention Prometheus/Loki.
4. Tắt Kafka UI.
5. Tạm dừng Grafana/Loki nhưng giữ Prometheus nếu cần metrics.
6. Chỉ giữ API Gateway, Auth, Product, Cart, Order và Recommendation cho demo cơ bản.

Không tắt PostgreSQL/MongoDB/Redis/Qdrant cloud bằng cách xóa dữ liệu. Nếu muốn tiết kiệm, dừng workload EC2 khi không demo và kiểm tra phí database cloud riêng.

## 23. Rollback khi deploy lỗi

Xem lịch sử:

```bash
kubectl rollout history deployment/bin-ecommerce-api-gateway \
  -n bin-ecommerce-app
```

Rollback:

```bash
kubectl rollout undo deployment/bin-ecommerce-api-gateway \
  -n bin-ecommerce-app

kubectl rollout status deployment/bin-ecommerce-api-gateway \
  -n bin-ecommerce-app \
  --timeout=180s
```

Rollback image cụ thể:

```bash
kubectl set image deployment/bin-ecommerce-api-gateway \
  api-gateway=ghcr.io/<owner>/bin-ecommerce-api-gateway:<previous-sha> \
  -n bin-ecommerce-app
```

Không rollback database bằng cách xóa bảng. Database migration cần migration down hoặc kế hoạch phục hồi riêng.

## 24. Xử lý lỗi thường gặp

### EC2 không SSH được

Kiểm tra Security Group port 22, My IP, key pair, subnet public, route table và Elastic IP.

### Node `NotReady`

```bash
kubectl describe node bin-ecommerce-node-01
sudo systemctl status k3s --no-pager
sudo journalctl -u k3s -n 100 --no-pager
free -h
df -h /
```

### Pod `ImagePullBackOff`

```bash
kubectl describe pod <pod-name> -n bin-ecommerce-app
kubectl get secret ghcr-pull-secret -n bin-ecommerce-app
```

Kiểm tra image name, commit tag, quyền `read:packages` và `imagePullSecrets`.

### Pod `CrashLoopBackOff`

```bash
kubectl logs <pod-name> -n bin-ecommerce-app --previous
kubectl describe pod <pod-name> -n bin-ecommerce-app
```

Tập trung kiểm tra biến môi trường, port, migration, cloud database SSL và Kafka broker URL.

### Pod `OOMKilled`

```bash
kubectl describe pod <pod-name> -n bin-ecommerce-app
free -h
```

Giảm worker/monitoring hoặc giảm concurrency. Không tăng replica trên single-node 4 GiB.

### API trả 502

```bash
kubectl get endpoints bin-ecommerce-api-gateway -n bin-ecommerce-app
kubectl get pods -n bin-ecommerce-app
kubectl logs deployment/bin-ecommerce-api-gateway -n bin-ecommerce-app
```

Kiểm tra Service selector, `targetPort`, `PORT` và readiness probe.

### HTTPS `Pending`

```bash
kubectl describe certificate -n bin-ecommerce-app
kubectl get challenge,order -n bin-ecommerce-app
```

Kiểm tra DNS đã trỏ đúng Elastic IP và port 80/443 đã mở.

### Recommendation trả danh sách rỗng

Kiểm tra theo thứ tự:

1. `recommendation_catalog_products` có dữ liệu.
2. Recommendation Service kết nối đúng PostgreSQL cloud.
3. Redis cache đã invalidate.
4. Qdrant URL/API key đúng.
5. Kafka event/profile projection không lỗi.
6. API Gateway chuyển đúng `x-user-id` hoặc `x-session-id`.

## 25. Tiêu chí hoàn thành Phase 1

```text
[ ] EC2 bin-ecommerce-platform-01 đang Running
[ ] Instance type là c7i-flex.large, 2 vCPU, 4 GiB RAM
[ ] Root volume là 30 GiB gp3
[ ] Elastic IP đã associate
[ ] Security Group chỉ mở 22 cho My IP, 80 và 443 public
[ ] Hostname là bin-ecommerce-node-01
[ ] k3s service active
[ ] Node ở trạng thái Ready
[ ] Traefik Ingress đang Running
[ ] Namespace đã tạo đúng
[ ] Không chạy database local trên EC2
[ ] Secret cloud đã tạo, không có secret thật trong Git
[ ] GHCR image đã build theo commit SHA
[ ] Kafka và Keycloak đã Ready
[ ] Database migration Job đã Complete
[ ] API Gateway đã rollout thành công
[ ] Commerce services đã rollout thành công
[ ] Recommendation trả sản phẩm
[ ] AI workers và outbox relay đã nhận event/job
[ ] Prometheus/Grafana có metrics cơ bản
[ ] Loki/Alloy thu được log application
[ ] DNS trỏ đúng Elastic IP
[ ] Ingress route đúng API Gateway
[ ] Certificate ở trạng thái Ready
[ ] HTTPS health endpoint trả thành công
[ ] Đăng nhập hoạt động
[ ] Cart và Order hoạt động
[ ] Recommendation hoạt động với user mới
[ ] Không có OOMKilled hoặc DLQ tăng liên tục
[ ] Vercel gọi API HTTPS, không còn gọi localhost
```

Khi toàn bộ checklist đạt, hệ thống đã được deploy end-to-end trên EC2/k3s. Phase tiếp theo mới tập trung vào CI/CD tự động, tối ưu latency và phát triển tính năng; không quay lại dựng database local.

## 26. Các lệnh nguy hiểm không được chạy tùy tiện

Không chạy các lệnh sau nếu chưa có backup và chưa hiểu rõ tác động:

```bash
kubectl delete namespace bin-ecommerce-data
kubectl delete pvc --all --all-namespaces
docker system prune -a
sudo rm -rf /var/lib/rancher/k3s
```

Đặc biệt, không xóa namespace, PVC hoặc thư mục k3s chỉ để xử lý một Pod lỗi. Luôn kiểm tra `describe`, `logs`, `events` và rollout trước.
