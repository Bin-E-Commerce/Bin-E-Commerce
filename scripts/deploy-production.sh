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

for service in "${CHANGED[@]}"; do
  validate_image "$service"
done

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

rollback() {
  local failure_code=$?
  trap - ERR
  set +e
  echo "Deployment failed; rolling back changed Deployments..." >&2

  if [[ -f "$previous_file" ]]; then
    while IFS='=' read -r service previous_image; do
      [[ -n "$service" && -n "$previous_image" ]] || continue
      kubectl -n "$NAMESPACE" set image \
        "deployment/bin-ecommerce-$service" \
        "$service=$previous_image" >/dev/null
    done < <(sudo cat "$previous_file")

    for service in "${APPLIED[@]}"; do
      kubectl -n "$NAMESPACE" rollout status \
        "deployment/bin-ecommerce-$service" --timeout="$ROLLOUT_TIMEOUT" >/dev/null
    done
  fi

  echo "Rollback attempted for release $RELEASE_SHA." >&2
  exit "$failure_code"
}

trap rollback ERR

for service in "${DEPLOY_ORDER[@]}"; do
  [[ " ${CHANGED[*]} " == *" $service "* ]] || continue

  deployment="bin-ecommerce-$service"
  previous_image="$(kubectl -n "$NAMESPACE" get deployment "$deployment" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')"
  [[ -n "$previous_image" ]] || {
    echo "Cannot determine current image for $deployment." >&2
    exit 1
  }

  printf '%s=%s\n' "$service" "$previous_image" | sudo tee -a "$previous_file" >/dev/null
  image="$(image_variable "$service")"
  # Ghi nhận trước khi set image để cả service đang fail readiness cũng được
  # chờ rollback, thay vì chỉ rollback các service đã rollout thành công.
  APPLIED+=("$service")

  echo "Deploying $service..."
  kubectl -n "$NAMESPACE" set image "deployment/$deployment" "$service=$image" >/dev/null
  kubectl -n "$NAMESPACE" rollout status "deployment/$deployment" --timeout="$ROLLOUT_TIMEOUT"
  printf '%s\n' "$service" | sudo tee -a "$applied_file" >/dev/null
done

# Smoke test từ EC2 kiểm tra cả DNS/Ingress/public TLS mà người dùng thật sẽ
# gặp. Không gửi credential và không in response body có thể chứa token.
curl --fail --silent --show-error --max-time 20 \
  https://api.binecommerce.site/api/v1/health >/dev/null
curl --fail --silent --show-error --max-time 20 \
  https://keycloak.binecommerce.site/realms/bin-ecommerce/.well-known/openid-configuration >/dev/null
curl --fail --silent --show-error --max-time 20 \
  https://www.binecommerce.site >/dev/null

printf 'RELEASE_SHA=%s\nCHANGED_SERVICES=%s\n' "$RELEASE_SHA" "$CHANGED_SERVICES" \
  | sudo tee "$current_file" >/dev/null
echo "Production release $RELEASE_SHA deployed successfully."
