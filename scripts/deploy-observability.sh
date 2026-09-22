#!/usr/bin/env bash
set -Eeuo pipefail

# Script idempotent: co the chay lai nhieu lan ma khong tao them Secret hoac Pod du.
# Grafana password duoc tao tren node va khong duoc luu trong Git hay log CI/CD.

# Cài đặt hoặc cập nhật stack monitoring/logging độc lập với application rollout.
# Grafana password được tạo trên node và không được lưu trong Git.

K3S_MANIFEST_PATH="${K3S_MANIFEST_PATH:-/opt/bin-ecommerce/k8s}"
OBSERVABILITY_PATH="${OBSERVABILITY_PATH:-$K3S_MANIFEST_PATH/observability/manifests}"
NAMESPACE="bin-ecommerce-observability"

if [[ ! -f "$OBSERVABILITY_PATH/kustomization.yaml" ]]; then
  echo "Observability kustomization not found: $OBSERVABILITY_PATH" >&2
  exit 1
fi

kubectl() {
  # Dung k3s kubectl de khong phu thuoc kubeconfig cua user ubuntu.
  sudo k3s kubectl "$@"
}

if ! kubectl -n "$NAMESPACE" get secret grafana-admin >/dev/null 2>&1; then
  password="$(openssl rand -hex 24)"
  kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  kubectl -n "$NAMESPACE" create secret generic grafana-admin \
    --from-literal=admin-password="$password" \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  echo "Created Grafana admin secret in Kubernetes. Retrieve it locally with kubectl; it is not printed by this script." >&2
fi

# Apply toan bo entrypoint; Kustomize kiem tra resource path thong nhat.
kubectl apply -k "$OBSERVABILITY_PATH"
# ConfigMap thay doi khong tu dong restart cac process observability. Restart dung
# cac workload doc config luc startup; khong restart kube-state-metrics/node-exporter.
kubectl -n "$NAMESPACE" rollout restart \
  deployment/prometheus deployment/grafana deployment/loki daemonset/alloy
# Cho tung workload de workflow fail ngay neu image, config hoac probe co van de.
kubectl -n "$NAMESPACE" rollout status deployment/prometheus --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/grafana --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/loki --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/kube-state-metrics --timeout=180s
kubectl -n "$NAMESPACE" rollout status daemonset/node-exporter --timeout=180s
kubectl -n "$NAMESPACE" rollout status daemonset/alloy --timeout=180s

echo
echo "Observability stack is ready. Use these private tunnels:"
echo "  sudo k3s kubectl -n $NAMESPACE port-forward svc/grafana 3000:3000"
echo "  sudo k3s kubectl -n $NAMESPACE port-forward svc/prometheus 9090:9090"
echo "  Grafana: http://127.0.0.1:3000 (user: admin)"
