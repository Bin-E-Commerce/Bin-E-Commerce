<div align="center">

# Bin E-Commerce

**A multi-service marketplace for product discovery, checkout, fulfillment, seller operations, and administration.**

![Node.js 20](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![NestJS 11](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-events-231F20?logo=apachekafka&logoColor=white)

[Portfolio](https://daongocanh.site)

</div>

---

## What this repository contains

Commerce flows such as checkout, inventory, delivery, returns, and recommendations are familiar. This project gives those flows explicit service ownership and integrates them through an API Gateway and asynchronous events.

The root repository pins the web app and backend services as Git submodules. It also contains shared TypeScript contracts, crawler/import utilities, Docker Compose files, Kubernetes manifests, and GitHub Actions workflows.

## Start locally

> [!IMPORTANT]
> Local startup creates Docker containers, networks, and persistent volumes. It downloads packages and images and connects to the database and provider endpoints configured in your environment files. The Compose files do **not** start PostgreSQL, MongoDB, Redis, or Qdrant for the application; configure reachable development instances first. Do not put production credentials in local files. Values prefixed with NEXT_PUBLIC_ are exposed to the browser.
>
> Setup creates local environment files and runs npm and Docker commands. npm dependency lifecycle scripts may run during installation.
>
> The npm run services:down and npm run infra:down commands stop containers but keep volume data. Do not use docker compose down -v unless you intend to delete local volume data.

### Prerequisites

- Git with access to the submodule repositories.
- Node.js 20 and npm.
- Docker with Docker Compose.
- Python 3.12 only when working on the AI Service directly.

### Clone and install

~~~powershell
git clone --recurse-submodules https://github.com/Bin-E-Commerce/Bin-Ecommerce.git
cd Bin-Ecommerce

npm ci
Copy-Item .env.example .env
Copy-Item infra/docker/.env.example infra/docker/.env
Copy-Item web/.env.example web/.env.local
~~~

For an existing checkout without initialized submodules:

~~~powershell
git submodule update --init --recursive
~~~

Fill required values in the root .env for PostgreSQL, MongoDB, Redis, Qdrant, internal service authentication, and any providers used by your flows. The sample leaves secrets blank and marks required Compose values.

### Start the backend and web app

~~~powershell
npm run infra:up
npm run services:build
npm run services:up
~~~

In another terminal:

~~~powershell
cd web
npm ci
npm run dev
~~~

The web app runs at http://localhost:5173. The API Gateway is at http://localhost:3000 and local Keycloak is at http://localhost:8080. The reverse proxy uses ports 8088 and 8443 by default. Ports can be changed in the environment configuration.

The web sample sets NEXT_PUBLIC_API_URL to the Gateway, NEXT_PUBLIC_KEYCLOAK_URL to Keycloak, and NEXT_PUBLIC_APP_URL to the web origin. Check web/.env.example before changing local ports.

The root npm workspace covers packages/* and services/*. The web submodule has its own lockfile and dependencies and must be installed separately. AI Service is Python-based and is not an npm workspace.

### Stop the local runtime

~~~powershell
npm run services:down
npm run infra:down
~~~

## See the platform at a glance

~~~mermaid
flowchart LR
    client[Customer, seller, admin] --> web[Next.js web app]
    web --> gateway[API Gateway]
    gateway --> auth[Auth]
    gateway --> product[Product and catalog]
    gateway --> cart[Cart]
    gateway --> order[Order]
    gateway --> shipping[Shipping]
    gateway --> seller[Seller]
    gateway --> media[Media]
    gateway --> recommendation[Recommendation]
    gateway --> notification[Notification]
    product --> kafka[(Kafka)]
    order --> kafka
    shipping --> kafka
    kafka --> workers[Consumers and AI workers]
    recommendation --> ai[AI Service]
~~~

The browser uses the API Gateway as its backend boundary. Domain services enforce their own business rules and own their persistence. Kafka carries asynchronous events and background work.

## Capabilities

- **Shopping:** product and shop discovery, cart, checkout, customer profiles, order history, and shipment tracking.
- **Seller operations:** shop onboarding, products and inventory, order processing, shipping settings, finance, and AI-assisted product workflows.
- **Returns and refunds:** customers can request returns or cancel eligible orders; seller and admin workspaces track the next action. For paid Pay2S cancellations, the customer supplies a recipient bank account and an admin performs and records the refund. VietQR helps prepare a bank transfer; it does not transfer money itself.
- **Payments and shipping:** cash on delivery and Pay2S payment flows; GHN integration with a configurable demo mode.
- **Recommendations:** candidate generation and ranking with a standard fallback when optional AI ranking is unavailable.
- **Administration:** seller review, access control, finance/refund queues, and recommendation policy tools.

## Services and ownership

| Component | Responsibility |
| --- | --- |
| api-gateway | Browser-facing API, routing, and request boundary |
| auth-service | Account and identity-related operations |
| seller-service | Seller onboarding, shop profiles, and seller operations |
| product-service | Products, variants, and inventory-related product data |
| catalog-service | Catalog read model and product discovery |
| cart-service | Customer and guest cart lifecycle |
| order-service | Order lifecycle, cancellation, returns, and refund state |
| shipping-service | Quotes, outbound and return shipments, and tracking |
| media-service | Upload and media asset processing |
| notification-service | Notification events and delivery |
| recommendation-service | Candidate sources, ranking policy, and recommendation tracking |
| ai-service | AI APIs, embeddings, and ranking inference |
| AI workers | Embedding jobs, image optimization jobs, and outbox event delivery |

The root Docker Compose file also defines an Nginx reverse proxy. It does not define a web container.

## Repository layout

~~~text
Bin-Ecommerce/
├── web/                         # Next.js submodule
├── services/                    # Backend service submodules
│   ├── api-gateway/
│   ├── auth-service/
│   ├── cart-service/
│   ├── catalog-service/
│   ├── media-service/
│   ├── notification-service/
│   ├── order-service/
│   ├── product-service/
│   ├── recommendation-service/
│   ├── seller-service/
│   ├── shipping-service/
│   └── ai-service/              # Python/FastAPI
├── packages/
│   ├── common/                  # Shared TypeScript contracts
│   ├── crawl-tiki/              # Tiki brand crawler/importer
│   ├── data-shoppe/             # Catalog import data and instructions
│   └── scripts/
├── infra/
│   ├── docker/                  # Local Kafka and Keycloak infrastructure
│   └── k8s/                     # Application and observability manifests
├── docs/architecture/           # Deployment architecture and rollout plan
├── .github/workflows/           # CI, image build, and deployment workflows
├── docker-compose.yml           # Backend application containers
├── package.json                 # Root npm workspaces and scripts
└── turbo.json                   # Turborepo task pipeline
~~~

Each service and the web app has its own Git history. The root repository records the exact submodule commit it uses. Commit changes in a submodule first, then update and commit its pointer in the root repository.

## Technology

| Area | Current implementation |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript |
| Node services | NestJS 11 and TypeScript |
| AI service | Python 3.12, FastAPI, SQLAlchemy, LightGBM |
| Relational storage | PostgreSQL with TypeORM in Node services; SQLAlchemy in AI Service |
| Document storage | MongoDB for notification data |
| Cache and short-lived state | Redis |
| Events and workers | Apache Kafka |
| Vector search | Qdrant |
| Identity | Keycloak and OIDC/JWT |
| Local orchestration | Docker Compose, npm workspaces, and Turborepo |
| Production manifests | Kubernetes/Kustomize for K3s |

Dependency versions are defined in package manifests and lockfiles. CI currently uses Node.js 20 and Python 3.12.

## Configuration

Use these examples as the source of truth for variable names:

- Root application Compose: .env.example
- Local Kafka and Keycloak: infra/docker/.env.example
- Browser configuration: web/.env.example
- Service-specific configuration: services/<service>/.env.example

Common settings include database endpoints, INTERNAL_SERVICE_TOKEN, Keycloak client configuration, Redis and Qdrant URLs, payment credentials, shipping provider credentials, and public frontend URLs. Only put intentionally public values in NEXT_PUBLIC_* variables. Keep credentials in ignored local files or the deployment secret store.

The local infrastructure Compose file starts Kafka, Kafka UI, a PostgreSQL instance for local Keycloak, and Keycloak. It does not provide the application databases or Qdrant. Pay2S and GHN require provider configuration; Pay2S is disabled by default and shipping demo mode is enabled.

## Development and quality checks

Run root scripts for the root Node workspaces:

~~~powershell
npm run build
npm run lint
npm run type-check
npm test
~~~

Run web checks from the web directory:

~~~powershell
cd web
npm run build
npm run lint
npm run type-check
npm test
~~~

The AI Service has its own Makefile and Python environment:

~~~powershell
cd services/ai-service
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
make check
~~~

Root scripts use Turborepo across root npm workspaces. They do not include the separate web submodule or Python AI checks. CI checks affected services and the web app separately.

## CI and deployment

- ci.yml runs on pull requests to main and pushes to main. It checks affected packages and validates Kubernetes manifests when relevant files change.
- build-images.yml runs after successful CI on main or by manual dispatch. It builds affected backend images, scans for unfixed HIGH and CRITICAL vulnerabilities with Trivy, and publishes SBOM and release artifacts.
- deploy-production.yml deploys backend releases to K3s through AWS OIDC and Systems Manager. Production environment variables and secrets must be configured.
- deploy-observability.yml is a manual workflow for observability manifests.
- The frontend deployment target is Vercel and is separate from the backend image rollout.

The deployment architecture in [docs/architecture/README.md](docs/architecture/README.md) targets Vercel for the web app and a single-node K3s cluster on EC2 for backend workloads. A single node is not high availability. Manifests and workflows do not supply production credentials or guarantee that optional providers are enabled.

## Documentation

- [Web architecture and frontend setup](https://github.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/blob/main/README.md)
- [Architecture and deployment plan](docs/architecture/README.md)
- [Order Service](https://github.com/Bin-E-Commerce/Bin-E-Commerce-Order-Service/blob/main/README.md)
- [Shipping Service](https://github.com/Bin-E-Commerce/Bin-Ecommerce-Shipping-Service/blob/main/README.md)
- Other service READMEs are under services/.
- [AI Service](https://github.com/Bin-E-Commerce/Bin-E-Commerce-Ai-Service/blob/main/README.md) documents its Python runtime, workers, and provider boundaries.

## Known local-development constraints

- Initialize Git submodules before installing root workspaces.
- Install web dependencies separately from root dependencies.
- Configure reachable application databases and external services; Compose is not a complete offline development environment.
- Configure Keycloak realm/client settings for the local identity flow.
- Configure Pay2S, GHN, object storage, and AI providers only for flows that need them.
- Check service READMEs and deployment configuration before treating a provider flow or production deployment as enabled.

## Ownership

**Đào Ngọc Anh** — Software Engineer

[Portfolio](https://daongocanh.site)
