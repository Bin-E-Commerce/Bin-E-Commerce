#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy application image theo release manifest trên một node K3s.
# Input là file không chứa secret gồm RELEASE_SHA, CHANGED_SERVICES và
# IMAGE_<SERVICE>. Output là rollout tuần tự, smoke test và release record.
# Script không apply Kafka/Keycloak, không chạm Kubernetes Secret runtime.
# Khi rollout hoặc smoke test lỗi, các Deployment đã đổi được rollback về image
# trước đó; database migration không bị rollback tự động.

NAMESPACE="${NAMESPACE:-bin-ecommerce-app}"
RELEASE_ROOT="${RELEASE_ROOT:-/opt/bin-ecommerce/releases}"
RELEASE_ENV_FILE="${RELEASE_ENV_FILE:-/tmp/bin-ecommerce-release.env}"
K3S_MANIFEST_PATH="${K3S_MANIFEST_PATH:-/opt/bin-ecommerce/k8s}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-180s}"
AI_ROLLOUT_TIMEOUT="${AI_ROLLOUT_TIMEOUT:-600s}"
SMOKE_MAX_TIME="${SMOKE_MAX_TIME:-20}"
SMOKE_RETRY_COUNT="${SMOKE_RETRY_COUNT:-4}"
SMOKE_RETRY_DELAY="${SMOKE_RETRY_DELAY:-2}"
SMOKE_RETRY_MAX_TIME="${SMOKE_RETRY_MAX_TIME:-45}"
KAFKA_NAMESPACE="${KAFKA_NAMESPACE:-bin-ecommerce-data}"
KAFKA_POD="${KAFKA_POD:-kafka-0}"
KAFKA_CLI="${KAFKA_CLI:-/opt/kafka/bin/kafka-topics.sh}"

if [[ ! -f "$RELEASE_ENV_FILE" ]]; then
  echo "Release env file not found: $RELEASE_ENV_FILE" >&2
  exit 1
fi

# File này do workflow tạo từ service name/image đã validate. Vẫn validate lại
# ở server để file upload lỗi không thể chạy lệnh ngoài dự kiến.
set -a
# shellcheck disable=SC1090
source "$RELEASE_ENV_FILE"
set +a

: "${RELEASE_SHA:?RELEASE_SHA is required}"
: "${CHANGED_SERVICES:?CHANGED_SERVICES is required}"
AI_WORKERS_CREATED="${AI_WORKERS_CREATED:-false}"

if [[ "$AI_WORKERS_CREATED" != true && "$AI_WORKERS_CREATED" != false ]]; then
  echo "AI_WORKERS_CREATED must be true or false." >&2
  exit 1
fi

if [[ ! "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_SHA must be a full lowercase Git SHA." >&2
  exit 1
fi

declare -a DEPLOY_ORDER=(
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
)

declare -A ALLOWED_SERVICE=()
for service in "${DEPLOY_ORDER[@]}"; do
  ALLOWED_SERVICE["$service"]=1
done

declare -a CHANGED=()
IFS=',' read -r -a requested_services <<< "$CHANGED_SERVICES"
for service in "${requested_services[@]}"; do
  [[ -n "$service" ]] || continue
  if [[ -z "${ALLOWED_SERVICE[$service]:-}" ]]; then
    echo "Unsupported application service: $service" >&2
    exit 1
  fi
  CHANGED+=("$service")
done

if (( ${#CHANGED[@]} == 0 )); then
  echo "No backend application image needs deployment."
  exit 0
fi

kubectl() {
  sudo k3s kubectl "$@"
}

image_variable() {
  local service="$1"
  local variable="IMAGE_${service//-/_}"
  printf '%s' "${!variable:-}"
}

validate_image() {
  local service="$1"
  local image
  image="$(image_variable "$service")"
  if [[ ! "$image" =~ ^ghcr\.io/daongocanh25092004/bin-ecommerce-${service}:[0-9a-f]{40}$ ]]; then
    echo "Invalid image reference for $service." >&2
    exit 1
  fi
}

# Đảm bảo broker đã có leader cho các topic mà producer/consumer dùng trước khi rollout application.
# Hàm chỉ tạo topic còn thiếu với cấu hình single-broker của demo; không xóa hoặc thay đổi topic đã có dữ liệu.
ensure_kafka_topics() {
  local topics=(
    "notification.otp-requested"
    "order.created"
    "order.cancelled"
    "order.delivery.awaiting_confirmation"
    "order.delivery.confirmed"
    "order.delivery.issue_reported"
    "order.delivery.auto_confirmed"
    "order.purchase.completed"
    "order.purchase.returned"
    "return.requested"
    "return.approved"
    "return.rejected"
    "return.cancelled"
    "return.in_transit"
    "return.received"
    "return.inspection.passed"
    "return.inspection.failed"
    "review.created"
    "review.updated"
    "seller.application-submitted"
    "seller.application-approved"
    "seller.application-rejected"
    "seller.shop-profile-change-requested"
    "seller.shop-profile-change-approved"
    "seller.shop-profile-change-rejected"
    "shipment.status.updated"
    "recommendation.interaction.recorded"
    "recommendation.product-embedding.requested.v1"
    "recommendation.product-embedding.generated.v1"
    "recommendation.product-embedding.dlq.v1"
    "recommendation.interactions.v1"
    "recommendation.interactions.dlq.v1"
    "recommendation.catalog.dlq.v1"
    "recommendation.purchase.dlq.v1"
    "recommendation.relations.dlq.v1"
    "ai.image-optimization.requested.v1"
    "ai.image-optimization.dlq.v1"
  )

  echo "Checking Kafka broker readiness..."
  kubectl -n "$KAFKA_NAMESPACE" wait --for=condition=ready "pod/$KAFKA_POD" --timeout=120s
  if ! kubectl -n "$KAFKA_NAMESPACE" exec "$KAFKA_POD" -- test -x "$KAFKA_CLI"; then
    echo "Kafka CLI not found or not executable: $KAFKA_CLI" >&2
    kubectl -n "$KAFKA_NAMESPACE" exec "$KAFKA_POD" -- sh -c 'command -v kafka-topics.sh || true' >&2
    return 1
  fi

  for topic in "${topics[@]}"; do
    if kubectl -n "$KAFKA_NAMESPACE" exec "$KAFKA_POD" -- "$KAFKA_CLI" \
      --bootstrap-server localhost:9092 --describe --topic "$topic" >/dev/null 2>&1; then
      continue
    fi

    echo "Creating missing Kafka topic: $topic"
    if ! create_output="$(kubectl -n "$KAFKA_NAMESPACE" exec "$KAFKA_POD" -- "$KAFKA_CLI" \
      --bootstrap-server localhost:9092 \
      --create --if-not-exists --topic "$topic" --partitions 1 --replication-factor 1 2>&1)"; then
      echo "Kafka topic creation failed for $topic:" >&2
      echo "$create_output" >&2
      kubectl -n "$KAFKA_NAMESPACE" logs "$KAFKA_POD" --tail=80 >&2 || true
      return 1
    fi
    if ! kubectl -n "$KAFKA_NAMESPACE" exec "$KAFKA_POD" -- "$KAFKA_CLI" \
      --bootstrap-server localhost:9092 --describe --topic "$topic" >/dev/null 2>&1; then
      echo "Kafka topic exists but has no healthy leader: $topic" >&2
      kubectl -n "$KAFKA_NAMESPACE" exec "$KAFKA_POD" -- "$KAFKA_CLI" \
        --bootstrap-server localhost:9092 --describe --topic "$topic" >&2 || true
      return 1
    fi
  done

  echo "Kafka topics are ready."
}

for service in "${CHANGED[@]}"; do
  validate_image "$service"
done

# Fail fast ở hạ tầng message broker để không rollout từng service rồi timeout dây chuyền.
ensure_kafka_topics

# Validate kustomization trước khi đổi image. Base giữ raw manifest cũ ở
# infra/k8s/{apps,config,ingress}; bước này không apply data infrastructure.
if [[ -f "$K3S_MANIFEST_PATH/overlays/production/kustomization.yaml" ]]; then
  kubectl kustomize --load-restrictor LoadRestrictionsNone \
    "$K3S_MANIFEST_PATH/overlays/production" >/dev/null
fi

release_dir="$RELEASE_ROOT/$RELEASE_SHA"
previous_file="$release_dir/previous-images.env"
current_file="$RELEASE_ROOT/current-release.env"
applied_file="$release_dir/applied-services.txt"
sudo mkdir -p "$release_dir"
sudo rm -f "$previous_file" "$applied_file"

declare -a APPLIED=()
PREPULL_POD=""

# AI image dùng chung một image nhưng có ba workload runtime độc lập.
# Cập nhật đồng thời để job không bị ghi vào outbox mà thiếu relay/worker xử lý.
deployment_targets() {
  local service="$1"
  if [[ "$service" == "ai-service" ]]; then
    printf '%s\n' \
      "bin-ecommerce-ai-service" \
      "bin-ecommerce-ai-image-worker" \
      "bin-ecommerce-ai-outbox-relay"
    return
  fi
  printf 'bin-ecommerce-%s\n' "$service"
}

rollout_timeout_for() {
  local service="$1"
  if [[ "$service" == "ai-service" ]]; then
    printf '%s' "$AI_ROLLOUT_TIMEOUT"
    return
  fi
  printf '%s' "$ROLLOUT_TIMEOUT"
}

diagnose_rollout_failure() {
  local deployment="$1"
  local selector

  echo "Rollout diagnostics for $deployment:" >&2
  kubectl -n "$NAMESPACE" describe deployment "$deployment" >&2 || true
  kubectl -n "$NAMESPACE" get deployment "$deployment" \
    -o jsonpath='{range $key,$value := .spec.selector.matchLabels}{$key}={$value},{end}' \
    2>/dev/null | sed 's/,$//' > "/tmp/bin-ecommerce-selector-$$" || true
  selector="$(sudo cat "/tmp/bin-ecommerce-selector-$$" 2>/dev/null || true)"
  sudo rm -f "/tmp/bin-ecommerce-selector-$$"
  if [[ -n "$selector" ]]; then
    kubectl -n "$NAMESPACE" get pods -l "$selector" -o wide >&2 || true
  fi
  kubectl -n "$NAMESPACE" get events --sort-by=.lastTimestamp | tail -80 >&2 || true
}

cleanup_prepull_pod() {
  if [[ -n "$PREPULL_POD" ]]; then
    kubectl -n "$NAMESPACE" delete pod "$PREPULL_POD" \
      --ignore-not-found --grace-period=0 --force >/dev/null 2>&1 || true
    PREPULL_POD=""
  fi
}

prepull_ai_image() {
  local image="$1"
  local short_sha="${RELEASE_SHA:0:12}"

  echo "Pre-pulling AI image once before creating API and worker pods..."
  cleanup_prepull_pod
  PREPULL_POD="bin-ecommerce-ai-prepull-$short_sha"
  cat <<EOF | kubectl -n "$NAMESPACE" apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: $PREPULL_POD
  labels:
    app.kubernetes.io/name: bin-ecommerce-ai-prepull
    app.kubernetes.io/part-of: bin-ecommerce
spec:
  restartPolicy: Never
  imagePullSecrets:
    - name: ghcr-pull-secret
  containers:
    - name: prepull
      image: $image
      imagePullPolicy: IfNotPresent
      command: ["python", "-c", "import time; time.sleep(30)"]
      resources:
        requests:
          cpu: 10m
          memory: 32Mi
        limits:
          cpu: 50m
          memory: 64Mi
EOF

  if ! kubectl -n "$NAMESPACE" wait --for=condition=ready \
    "pod/$PREPULL_POD" --timeout="$AI_ROLLOUT_TIMEOUT"; then
    echo "AI image pre-pull failed for $image." >&2
    kubectl -n "$NAMESPACE" describe pod "$PREPULL_POD" >&2 || true
    kubectl -n "$NAMESPACE" logs "$PREPULL_POD" --all-containers --tail=100 >&2 || true
    return 1
  fi

  cleanup_prepull_pod
}

# Container name của workload AI dùng chung để cập nhật và rollback cùng một image.
container_name() {
  local service="$1"
  if [[ "$service" == "ai-service" ]]; then
    printf 'ai-service'
    return
  fi
  printf '%s' "$service"
}

# Nhận diện workload được tạo trong chính release này để rollback bằng cách xóa,
# không cố khôi phục một image cũ vốn chưa từng tồn tại trước deployment.
is_created_ai_worker() {
  [[ "$AI_WORKERS_CREATED" == true ]] && {
    [[ "$1" == "bin-ecommerce-ai-image-worker" || "$1" == "bin-ecommerce-ai-outbox-relay" ]]
  }
}

# Tạo cặp worker chỉ sau khi preflight Kafka/Kustomize và rollback trap đã sẵn sàng.
# Deployment đã tồn tại không bị apply lại để giữ nguyên cấu hình cũ trong phạm vi release image.
ensure_ai_worker_deployments() {
  local manifest="$K3S_MANIFEST_PATH/apps/ai-service/workers.yaml"
  local worker_exists=false
  local relay_exists=false

  [[ -f "$manifest" ]] || {
    echo "AI worker manifest not found: $manifest" >&2
    return 1
  }

  if kubectl -n "$NAMESPACE" get deployment bin-ecommerce-ai-image-worker >/dev/null 2>&1; then
    worker_exists=true
  fi
  if kubectl -n "$NAMESPACE" get deployment bin-ecommerce-ai-outbox-relay >/dev/null 2>&1; then
    relay_exists=true
  fi

  if [[ "$worker_exists" == false && "$relay_exists" == false ]]; then
    # Đánh dấu trước apply để partial create vẫn được dọn khi kubectl trả lỗi.
    AI_WORKERS_CREATED=true
    kubectl apply -f "$manifest"
  elif [[ "$worker_exists" != "$relay_exists" ]]; then
    echo "AI worker deployments are partially installed; refusing unsafe rollout." >&2
    return 1
  fi
}

rollback() {
  local failure_code=$?
  trap - ERR
  set +e
  echo "Deployment failed; rolling back changed Deployments..." >&2
  cleanup_prepull_pod

  if [[ -f "$previous_file" ]]; then
    while IFS=$'\t' read -r deployment container previous_image; do
      [[ -n "$deployment" && -n "$container" && -n "$previous_image" ]] || continue
      kubectl -n "$NAMESPACE" set image \
        "deployment/$deployment" \
        "$container=$previous_image" >/dev/null
    done < <(sudo cat "$previous_file")

    for deployment in "${APPLIED[@]}"; do
      if is_created_ai_worker "$deployment"; then
        continue
      fi
      kubectl -n "$NAMESPACE" rollout status \
        "deployment/$deployment" --timeout="$ROLLOUT_TIMEOUT" >/dev/null
    done
  fi

  if [[ "$AI_WORKERS_CREATED" == true ]]; then
    kubectl -n "$NAMESPACE" delete deployment \
      bin-ecommerce-ai-image-worker \
      bin-ecommerce-ai-outbox-relay \
      --ignore-not-found >/dev/null
  fi

  echo "Rollback attempted for release $RELEASE_SHA." >&2
  exit "$failure_code"
}

trap rollback ERR

for service in "${DEPLOY_ORDER[@]}"; do
  [[ " ${CHANGED[*]} " == *" $service "* ]] || continue

  image="$(image_variable "$service")"
  container="$(container_name "$service")"

  if [[ "$service" == "ai-service" ]]; then
    prepull_ai_image "$image"
    ensure_ai_worker_deployments
  fi

  declare -a SERVICE_DEPLOYMENTS=()
  while IFS= read -r deployment; do
    [[ -n "$deployment" ]] || continue
    previous_image="$(kubectl -n "$NAMESPACE" get deployment "$deployment" \
      -o jsonpath='{.spec.template.spec.containers[0].image}')"
    [[ -n "$previous_image" ]] || {
      echo "Cannot determine current image for $deployment." >&2
      exit 1
    }

    # Ghi nhận trước khi set image để workload đang fail readiness cũng được rollback.
    # Workload mới tạo không có image cũ; rollback sẽ xóa nó thay vì ghi nhận sai.
    if ! is_created_ai_worker "$deployment"; then
      printf '%s\t%s\t%s\n' "$deployment" "$container" "$previous_image" \
        | sudo tee -a "$previous_file" >/dev/null
    fi
    APPLIED+=("$deployment")
    SERVICE_DEPLOYMENTS+=("$deployment")
  done < <(deployment_targets "$service")

  # Set image cho toàn bộ workload cùng service trước khi chờ rollout.
  # Với AI, image đã được pre-pull nên API và worker không tranh nhau tải image lớn.
  for deployment in "${SERVICE_DEPLOYMENTS[@]}"; do
    echo "Deploying $service workload $deployment..."
    kubectl -n "$NAMESPACE" set image "deployment/$deployment" "$container=$image" >/dev/null
  done

  rollout_timeout="$(rollout_timeout_for "$service")"
  for deployment in "${SERVICE_DEPLOYMENTS[@]}"; do
    if ! kubectl -n "$NAMESPACE" rollout status \
      "deployment/$deployment" --timeout="$rollout_timeout"; then
      diagnose_rollout_failure "$deployment"
      exit 1
    fi
  done

  printf '%s\n' "$service" | sudo tee -a "$applied_file" >/dev/null
done

cleanup_prepull_pod

# Smoke test từ EC2 kiểm tra cả DNS/Ingress/public TLS mà người dùng thật sẽ
# gặp. Không gửi credential và không in response body có thể chứa token.
smoke_check() {
  local name="$1"
  local url="$2"
  local response_code=""

  echo "Smoke test: $name ($url)"
  if response_code="$(curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 5 \
    --max-time "$SMOKE_MAX_TIME" \
    --retry "$SMOKE_RETRY_COUNT" \
    --retry-delay "$SMOKE_RETRY_DELAY" \
    --retry-max-time "$SMOKE_RETRY_MAX_TIME" \
    --retry-connrefused \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$url")"; then
    echo "Smoke test passed: $name (HTTP ${response_code:-000})"
    return 0
  fi

  echo "Smoke test failed: $name ($url), last HTTP status: ${response_code:-000}" >&2
  return 1
}

smoke_check "API Gateway" \
  "https://api.binecommerce.site/api/v1/health"
smoke_check "Keycloak" \
  "https://keycloak.binecommerce.site/realms/bin-ecommerce/.well-known/openid-configuration"

# Frontend chay tren Vercel, doc lap voi rollout K3s; khong de loi edge tam thoi
# cua frontend lam backend production bi rollback oan.
if ! smoke_check "Frontend (warning only)" "https://www.binecommerce.site"; then
  echo "Warning: frontend smoke test failed; backend deployment remains successful." >&2
fi

printf 'RELEASE_SHA=%s\nCHANGED_SERVICES=%s\n' "$RELEASE_SHA" "$CHANGED_SERVICES" \
  | sudo tee "$current_file" >/dev/null
echo "Production release $RELEASE_SHA deployed successfully."
