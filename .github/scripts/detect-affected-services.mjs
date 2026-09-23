#!/usr/bin/env node

// Xác định service bị ảnh hưởng từ danh sách file thay đổi.
//
// Script chỉ đọc Git history và in một JSON duy nhất để GitHub Actions dùng
// làm matrix. Không đọc .env, Kubernetes Secret hoặc bất kỳ giá trị bí mật nào.

import { execFileSync } from "node:child_process";

const backendServices = [
  "api-gateway",
  "auth-service",
  "cart-service",
  "catalog-service",
  "media-service",
  "notification-service",
  "order-service",
  "product-service",
  "recommendation-service",
  "seller-service",
  "shipping-service",
  "ai-service",
];

const serviceDefinitions = [
  ...backendServices.map((name) => ({
    name,
    kind: name === "ai-service" ? "python" : "node",
    workspace: `services/${name}`,
    // Buildx chạy từ root repository. Vì AI dùng context riêng nên Dockerfile
    // vẫn phải là path từ root; nếu chỉ dùng "Dockerfile", Buildx sẽ không tìm
    // thấy file dù context đã trỏ vào services/ai-service.
    dockerfile:
      name === "ai-service"
        ? "services/ai-service/Dockerfile"
        : `services/${name}/Dockerfile`,
    // Node image cần root context để copy packages/common; AI Dockerfile có
    // pyproject.toml ngay trong service nên dùng context riêng.
    context: name === "ai-service" ? `services/${name}` : ".",
  })),
  {
    name: "web",
    kind: "web",
    workspace: "web",
    dockerfile: null,
    context: "web",
  },
];

const nodeServices = serviceDefinitions
  .filter(({ kind }) => kind === "node")
  .map(({ name }) => name);

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function gitDiff(base, head) {
  const candidates = [];

  if (base && head && base !== head) {
    candidates.push([base, head]);
  }

  if (head) {
    candidates.push([`${head}^`, head]);
  }

  candidates.push(["HEAD^", "HEAD"]);

  for (const [from, to] of candidates) {
    try {
      return execFileSync("git", ["diff", "--name-only", from, to], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean);
    } catch {
      // Commit đầu tiên hoặc shallow checkout có thể không có đủ parent.
      // Chuyển sang candidate kế tiếp thay vì làm CI fail không rõ nguyên nhân.
    }
  }

  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function hasServicePath(file, service) {
  return (
    file === `services/${service}` || file.startsWith(`services/${service}/`)
  );
}

const base = readArgument("--base");
const head = readArgument("--head") || "HEAD";
const changedFiles = gitDiff(base, head);
const services = new Set();
let hasInfraChanges = false;

for (const file of changedFiles) {
  for (const service of backendServices) {
    if (hasServicePath(file, service)) {
      services.add(service);
    }
  }

  if (file === "web" || file.startsWith("web/")) {
    services.add("web");
  }

  if (file === "packages/common" || file.startsWith("packages/common/")) {
    nodeServices.forEach((service) => services.add(service));
  }

  // Root dependency/config changes can affect workspace resolution, therefore
  // CI kiểm tra toàn bộ workspace thay vì tạo ra image sai dependency.
  if (
    file === "package.json" ||
    file === "package-lock.json" ||
    file === "tsconfig.base.json" ||
    file === "turbo.json"
  ) {
    serviceDefinitions.forEach(({ name }) => services.add(name));
  }

  if (file.startsWith("infra/k8s/")) {
    hasInfraChanges = true;
  }

  // Thay đổi workload AI phải build lại image và deploy cả HTTP API, outbox relay
  // và image worker vì ba process dùng chung một artifact Python.
  if (
    file.startsWith("infra/k8s/apps/ai-service/") ||
    file === "infra/k8s/base/apps/kustomization.yaml"
  ) {
    services.add("ai-service");
  }

  // Deploy script là hợp đồng rollout chung; mọi image cần được kiểm tra lại
  // khi script thay đổi để production không dùng logic rollback cũ.
  if (file === "scripts/deploy-production.sh") {
    backendServices.forEach((service) => services.add(service));
    hasInfraChanges = true;
  }

  // Thay đổi workflow/script CI phải tự kiểm tra lại mọi service để tránh
  // một lỗi pipeline chỉ được phát hiện sau khi merge vào main.
  if (
    file.startsWith(".github/workflows/") ||
    file.startsWith(".github/scripts/")
  ) {
    serviceDefinitions.forEach(({ name }) => services.add(name));
    hasInfraChanges = true;
  }
}

const orderedServices = serviceDefinitions
  .map(({ name }) => name)
  .filter((name) => services.has(name));

const matrix = serviceDefinitions
  .filter(({ name }) => services.has(name))
  .map((definition) => definition);

const backendMatrix = matrix.filter(({ kind }) => kind !== "web");

process.stdout.write(
  JSON.stringify({
    changedFiles,
    services: orderedServices,
    matrix,
    backendMatrix,
    deployServices: orderedServices.filter((name) => name !== "web"),
    hasServiceChanges: matrix.length > 0,
    hasBackendChanges: backendMatrix.length > 0,
    hasInfraChanges,
  }),
);
