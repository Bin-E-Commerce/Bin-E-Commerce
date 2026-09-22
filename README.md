<div align="center">

<img src="https://raw.githubusercontent.com/Bin-E-Commerce/Bin-E-Commerce-UI-Web/0299ed1be0f82dbd79549e2da0a3a92c8e0dfcf8/public/images/logo/logo_background_white.png" alt="Bin E-Commerce" width="260" />

# Bin E-Commerce

**An end-to-end commerce platform that connects product discovery, intelligent recommendations, secure checkout, fulfillment, seller operations, and administration in one system.**

<p>
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white" alt="Node.js 20 or newer" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.7" />
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white" alt="NestJS 11" />
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/Kafka-event--driven-231F20?logo=apachekafka&logoColor=white" alt="Apache Kafka" />
  <img src="https://img.shields.io/badge/Keycloak-OIDC-4D4D4D?logo=keycloak&logoColor=white" alt="Keycloak OIDC" />
</p>

<a href="https://daongocanh.site">View portfolio</a>

</div>

---

## Table of contents

1. [The problem](#1-the-problem)
2. [What this system provides](#2-what-this-system-provides)
3. [Who uses it](#3-who-uses-it)
4. [See the platform at a glance](#4-see-the-platform-at-a-glance)
5. [Core capabilities](#5-core-capabilities)
6. [Technology stack](#6-technology-stack)
7. [Repository structure](#7-repository-structure)
8. [Architecture](#8-architecture)
9. [Service catalogue](#9-service-catalogue)
10. [Domain and data ownership](#10-domain-and-data-ownership)
11. [Key business flows](#11-key-business-flows)
12. [API and communication rules](#12-api-and-communication-rules)
13. [Security model](#13-security-model)
14. [Recommendation and AI](#14-recommendation-and-ai)
15. [Local setup](#15-local-setup)
16. [Configuration](#16-configuration)
17. [Development workflow](#17-development-workflow)
18. [Testing and quality](#18-testing-and-quality)
19. [Observability and operations](#19-observability-and-operations)
20. [Deployment](#20-deployment)
21. [Documentation map](#21-documentation-map)
22. [Design decisions](#22-design-decisions)
23. [Project status and boundaries](#23-project-status-and-boundaries)
24. [Ownership](#24-ownership)

---

## 1. The problem

An online store is not only a product list and a checkout button. A reliable commerce platform must keep product data, carts, orders, inventory, shipping, identity, seller operations, notifications, and recommendations consistent while each part evolves independently.

Bin E-Commerce addresses that coordination problem with a full-stack monorepo and independently organized backend services. The customer gets a single shopping journey; the platform keeps domain responsibilities separated behind an API Gateway and asynchronous event contracts.

If you have built a conventional monolith, the familiar business flows are still here. The architectural difference is that high-change or failure-prone capabilities have explicit ownership, persistence boundaries, and integration contracts instead of sharing one large application state.

## 2. What this system provides

Bin E-Commerce is a learning and production-oriented commerce platform composed of:

- a Next.js storefront for browsing, search, cart, checkout, accounts and order tracking;
- seller workspaces for products, inventory, orders, shops, shipping, finance and AI-assisted workflows;
- admin workspaces for seller review, catalog oversight, access control and recommendation policy;
- NestJS services organized around commerce domains;
- an API Gateway for the browser-facing API boundary;
- Kafka-based asynchronous communication for events and background work;
- Keycloak-based OIDC authentication and role/permission enforcement;
- PostgreSQL and MongoDB selected according to the consistency and shape of each domain;
- recommendation and AI services for candidate generation, ranking and seller assistance;
- Docker Compose and repository scripts for repeatable local development.

The browser talks to the Gateway. It does not need to know where a service is deployed, and it never receives infrastructure credentials or internal service tokens.

## 3. Who uses it

| Persona | Main workspace | Typical goal |
| --- | --- | --- |
| Guest shopper | Public storefront | Explore products, receive recommendations and build a guest cart |
| Customer | Storefront and profile | Manage addresses, place orders, track delivery, review and request support |
| Seller | Seller workspace | Register a shop, manage catalog and stock, process orders and configure shipping |
| Administrator | Admin workspace | Review sellers, manage access, inspect operations and control recommendation policy |
| Engineer | Monorepo and service documentation | Develop, test, deploy and observe one domain without guessing its boundaries |

## 4. See the platform at a glance

```text
Customer / Guest                         Seller                         Admin
       │                                  │                              │
       └────────────── Next.js Web Application ──────────────────────────┘
                                      │ HTTPS
                                      ▼
                               API Gateway
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
       Domain services           Event broker             AI services
       auth, product,            Kafka topics             recommendation,
       catalog, cart,            and workers              AI ranking/assistants
       order, shipping...
              │                       │                       │
              └─────────────── owned databases ───────────────┘
```

### A customer journey in one example

```text
Discover product
  → product/catalog reads
  → recommendation candidates and ranking
  → add to cart
  → address and shipping quote
  → create order
  → asynchronous notifications and fulfillment events
  → seller processes order
  → shipment tracking and customer updates
```

## 5. Core capabilities

### Customer experience

- Product and shop discovery with category and detail views.
- Guest and authenticated cart experiences.
- Address collection and shipping location selection.
- Checkout preparation and order creation.
- Profile, sessions, addresses, order history and order details.
- Review and rating surfaces where the purchase context is available.
- Notifications and status feedback across the shopping lifecycle.

### Seller operations

- Seller registration and approval-oriented onboarding.
- Shop identity, profile, design and public preview.
- Product creation, editing, variants and inventory views.
- Seller order management and return-related workflows.
- Shipping provider and shipping settings.
- Analytics, finance and banking surfaces.
- AI-assisted product content and image optimization flows.

### Administration

- Admin shell and permission-aware navigation.
- Seller applications and shop profile change review.
- Product and seller oversight.
- Role and permission matrix management.
- Recommendation activity and policy management.
- Explicit access-denied states for protected areas.

### Platform capabilities

- Gateway-centered API access.
- JWT/OIDC identity integration with Keycloak.
- Domain events and background workers through Kafka.
- Candidate generation, recommendation tracking and ranking rollout controls.
- Media upload and asset processing boundaries.
- Health, lint, type-check and test scripts per package.

## 6. Technology stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web | Next.js 16, React 19, TypeScript | Storefront, account, seller, admin and showcase UI |
| UI | Tailwind CSS 4, Radix UI, shadcn/ui, Lucide, Motion | Consistent responsive components and interaction states |
| Client data | TanStack Query, Redux Toolkit, Axios | Server cache, auth/client state and Gateway requests |
| Backend | NestJS 11, TypeScript | Modular service APIs, dependency injection and workers |
| Identity | Keycloak, OIDC, OAuth 2.0, JWT | Login, token issuance, roles and identity context |
| Messaging | Apache Kafka | Durable asynchronous events and decoupled consumers |
| Relational data | PostgreSQL, TypeORM | Transactions, identities, products, orders and policy data |
| Document data | MongoDB, Mongoose | Flexible carts, notifications and document-shaped data |
| AI | Python/FastAPI, LightGBM, embeddings/Qdrant integration | Ranking, semantic candidates and seller assistance |
| Media | Object-storage/Lambda-compatible processing boundary | Upload and image transformation workflows |
| Runtime | Docker, Docker Compose, npm workspaces, Turborepo | Local orchestration and parallel repository tasks |
| Quality | ESLint, TypeScript compiler, Jest | Static checks and unit/integration test execution |

Technology versions should be verified in the relevant `package.json`, lockfile and service configuration before a production upgrade.

## 7. Repository structure

```text
E-commerce/
├── web/                         # Next.js 16 frontend
│   ├── src/app/                 # App Router routes and route-local features
│   ├── src/components/         # Shared application shell and UI primitives
│   ├── src/services/            # Typed frontend adapters grouped by domain
│   ├── src/hooks/               # Cross-feature client hooks
│   ├── src/store/               # Redux store and slices
│   └── README.md                # Detailed frontend architecture guide
├── services/                    # Backend and AI services
│   ├── api-gateway/
│   ├── auth-service/
│   ├── catalog-service/
│   ├── product-service/
│   ├── cart-service/
│   ├── order-service/
│   ├── shipping-service/
│   ├── seller-service/
│   ├── media-service/
│   ├── notification-service/
│   ├── recommendation-service/
│   └── ai-service/
├── packages/                   # Shared repository packages and tooling
├── infra/                      # Docker, Keycloak, observability and runtime config
├── docs/                       # Architecture, domain, feature, flow and planning docs
├── docker-compose.yml          # Local application service composition
├── package.json                # Root workspace and Turborepo scripts
├── turbo.json                  # Task pipeline and caching configuration
└── README.md                   # System-level documentation
```

The service list above reflects the current repository boundaries. Optional or future domains should not be documented as running services until they have a directory, manifest and supported runtime path.

## 8. Architecture

### Architecture reference

The detailed architecture diagram and expanded decision record will be added here later:

**Architecture link:** []

### Current system shape

```text
┌───────────────────────────────────────────────────────────────────────┐
│                              Clients                                  │
│                 Browser / customer / seller / admin                   │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         Next.js Web Application                        │
│  public routes · auth routes · customer routes · seller · admin        │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ public API boundary
                                ▼
┌───────────────────────────────────────────────────────────────────────┐
│                             API Gateway                               │
│          routing · auth context · permission boundary · proxy         │
└───────┬───────────┬───────────┬───────────┬───────────┬────────────────┘
        ▼           ▼           ▼           ▼           ▼
     Auth       Catalog       Cart        Order      Shipping   ...
        │           │           │           │           │
        └───────────┴───────────┴─────┬─────┴───────────┘
                                      │ Kafka events
                                      ▼
                         Notification / AI / workers
```

### Architectural boundaries

1. The web app owns presentation, client interaction, form validation and Gateway integration.
2. The Gateway owns the browser-facing route boundary; it is not the owner of product, order or seller business rules.
3. Each domain service owns its application rules, persistence adapters and domain events.
4. Kafka carries asynchronous integration events. Consumers must tolerate retries and duplicate delivery.
5. AI and recommendation enrich commerce decisions but must have a safe baseline/fallback path.
6. Databases are owned by the service that writes them. Other services integrate through APIs or events rather than direct table access.

### Request and event paths

```text
Synchronous request
Browser → Web adapter → API Gateway → owning service → owned database

Asynchronous side effect
Owning service → Kafka topic → consumer/worker → consumer database or external provider

AI-assisted request
Web → API Gateway → recommendation service → candidate sources → ranking/AI service
                                      └────────────── fallback to standard ranking
```

The complete architecture reference is intentionally left as a placeholder above so it can be replaced with the final diagram or published design document later.

## 9. Service catalogue

| Service | Primary responsibility | Typical integrations |
| --- | --- | --- |
| `api-gateway` | Public API boundary, routing and request protection | All browser-facing services, auth context |
| `auth-service` | User-facing auth profile, addresses and identity-related operations | Keycloak, PostgreSQL, Gateway |
| `catalog-service` | Catalog reads and discovery-oriented product data | Product data, Gateway, recommendation surfaces |
| `product-service` | Product, variant and product-domain operations | PostgreSQL, media, seller and catalog flows |
| `cart-service` | Customer and guest cart state | MongoDB, product/catalog data, order preparation |
| `order-service` | Order creation and lifecycle orchestration | Cart, seller, shipping, notifications, events |
| `shipping-service` | Shipping locations, quotes, shipment state and tracking | Shipping provider integration, orders |
| `seller-service` | Seller identity, shop operations and seller workflows | Auth, product, order, media, shipping |
| `media-service` | Upload, asset metadata and media processing boundary | Object storage, image processing, product/seller flows |
| `notification-service` | Transactional notification delivery and templates | Kafka events, email/provider boundary, MongoDB |
| `recommendation-service` | Candidate orchestration, ranking policy and recommendation tracking | Product/catalog, AI service, Kafka, cache/persistence |
| `ai-service` | Embeddings, AI-assisted seller features and ranking inference | Recommendation service, workers, model artifacts |

Service README files contain the implementation-specific API, environment variables and ownership details for each service.

## 10. Domain and data ownership

| Domain | Owner | Data concern |
| --- | --- | --- |
| Identity and account | `auth-service` | Users, profile data, addresses and identity references |
| Product and catalog | `product-service`, `catalog-service` | Product source data and discovery/read models |
| Cart | `cart-service` | Guest and customer cart lifecycle, expiry and item state |
| Order | `order-service` | Order aggregate, status transitions and orchestration state |
| Seller and shop | `seller-service` | Seller onboarding, shop profile and seller operations |
| Shipping | `shipping-service` | Locations, quotes, shipment and tracking state |
| Media | `media-service` | Asset metadata and processing status |
| Notification | `notification-service` | Templates, delivery jobs and notification state |
| Recommendation | `recommendation-service` | Policy, candidates, attribution and ranking metadata |
| AI models | `ai-service` | Inference boundary, model status, embeddings and workers |

### Data rules

- A service may read another domain through a supported contract, not by connecting to another service's database.
- Transactional state changes happen in the owning service before integration events are published.
- Consumers should be idempotent because events can be retried or delivered more than once.
- Public response DTOs must not expose internal credentials, provider secrets or private implementation details.
- Cache invalidation is part of the mutation contract, not an afterthought in the UI.

## 11. Key business flows

### 11.1 Browse and recommendation

```text
Visitor opens home/product page
  → web requests catalog/product data through Gateway
  → recommendation surface requests candidates when enabled
  → standard ranking produces the safe baseline
  → optional AI ranking blends into the baseline when eligible
  → web renders products and queues impressions
```

Guest sessions use a browser-generated recommendation session identifier so useful anonymous signals can be attributed without requiring login.

### 11.2 Cart and checkout

```text
Add product
  → cart-service validates item and quantity
  → cart state is returned to the web client
  → checkout collects address and shipping context
  → shipping-service provides quote/provider information
  → order-service creates the order and owns lifecycle transitions
```

The UI can show loading, empty, validation and failure states for every step. The backend remains authoritative for price, stock, eligibility and order validity.

### 11.3 Order, seller and shipping

```text
Order created
  → order state is persisted
  → integration event is published
  → seller receives an actionable order view
  → shipping data is created or updated
  → notification consumers deliver status updates
  → customer tracks the resulting lifecycle
```

An event consumer being temporarily unavailable should not make the original order mutation disappear. Retry, idempotency and observable failure states are part of the integration design.

### 11.4 Seller AI assistance

```text
Seller opens product editor
  → submits content/image assistance request through Gateway
  → ai-service validates the request and provider boundary
  → result returns to the seller for review
  → seller decides what is persisted
```

AI output is assistance, not an automatic replacement for seller intent or backend validation.

## 12. API and communication rules

### Browser-facing requests

- Use the API Gateway as the single browser-facing backend origin.
- Keep domain endpoint adapters in the web service layer, not inside page components.
- Use authenticated clients for protected operations and public clients for public reads.
- Represent loading, empty, validation, unauthorized, forbidden, not-found and server-error states explicitly.
- Invalidate or update affected query caches after mutations.

### Service-to-service communication

- Use synchronous calls only when the caller needs an immediate response to continue the request.
- Use Kafka when work can be processed asynchronously or should survive consumer downtime.
- Version event contracts deliberately and keep payloads stable for existing consumers.
- Add correlation information so a user action can be followed across Gateway, service and consumer logs.
- Never place provider tokens or internal service tokens in a browser response.

### Error handling

The API contract should make errors actionable: stable error code, HTTP status, safe message, correlation identifier when available, and field-level details for validation failures. UI copy should translate these states into a useful next action rather than exposing raw stack traces.

## 13. Security model

### Identity and authorization

Keycloak is the identity provider. Services validate identity and authorization at their own boundaries; a Gateway check improves routing and feedback but is not a substitute for backend enforcement.

```text
User → Keycloak login/OIDC → access token
     → Web authenticated client → API Gateway
     → service guard/permission check → domain operation
```

The permission model distinguishes authentication from authorization. A logged-in user can still be denied access to seller or admin operations without the required role, scope or permission.

### Trust and data boundaries

| Boundary | Rule |
| --- | --- |
| Browser | Receives public configuration and safe API responses only |
| Web server/runtime | Can coordinate rendering and requests but must not expose internal credentials |
| API Gateway | Validates/routs the external request and forwards trusted identity context |
| Domain service | Re-checks authorization and owns business invariants |
| Internal AI/provider calls | Require server-side credentials and internal network policy |
| Database | Accessible only by its owning service |

### Local trust notice

Local startup runs containers, creates/uses development infrastructure and sends requests to configured local services. It does not require production credentials when the local `.env` values are used. Review `docker-compose.yml`, `infra/` and `.env.example` before connecting external providers.

To stop local infrastructure, run `npm run infra:down`. To stop application containers, run `npm run services:down`. Remove only the development volumes you intentionally created; never point local cleanup commands at production data.

## 14. Recommendation and AI

Recommendation is designed as an enhancement layer with a dependable standard-ranking baseline.

```text
Candidate sources
  ├── profile/session affinity
  ├── semantic similarity
  ├── co-behavior signals
  └── popularity/freshness/quality
          │
          ▼
Standard ranking ───────────────┐
                                ├── final recommendation response
Optional AI ranking ────────────┘
```

The runtime policy can control AI enablement and AI blend. When enabled, the compatible LightGBM model is applied to every request; an unavailable model or invalid response falls back to Standard/Hybrid ranking. Environment variables remain appropriate for infrastructure-level master switches, service URLs, model paths and internal tokens.

Safety rules:

- Standard ranking remains available as the baseline and fallback.
- An unavailable model, timeout or invalid AI response must not break product discovery.
- A fallback response must not be recorded as successful AI treatment.
- Recommendation responses expose enough ranking metadata for operators to verify the actual mode.
- Admin policy changes must be versioned and auditable.

For implementation details, see `services/recommendation-service/README.md`, `services/ai-service/README.md` and `docs/flow/recommendation/`.

## 15. Local setup

### Prerequisites

- Node.js 20 or newer.
- npm 10 or newer.
- Docker Desktop or Docker Engine with Compose.
- Git.
- Access to the configured local or development infrastructure when a flow requires external providers.

### Install dependencies

```powershell
git clone <repository-url>
cd E-commerce
npm install
```

The repository uses npm workspaces and Turborepo. Do not run separate dependency installation commands inside every package unless a package README explicitly requires it.

### Configure environment

```powershell
Copy-Item .env.example .env
Copy-Item infra/docker/.env.example infra/docker/.env
Copy-Item web/.env.example web/.env.local
```

Use the actual example filenames present in your checkout. Keep local values uncommitted and never copy production secrets into a public web environment file.

### Start infrastructure

```powershell
npm run infra:up
```

This command starts `infra/docker/docker-compose.infra.yml`, which includes a dedicated PostgreSQL database for local Keycloak. Production Keycloak is deployed separately on K3s.

### Start application services

```powershell
npm run services:build
npm run services:up
```

For frontend-only work:

```powershell
cd web
npm run dev
```

The exact ports are configuration-driven. Check the service `.env.example` files and Compose file instead of assuming that every backend service is exposed directly to the browser.

### Stop local runtime

```powershell
npm run services:down
npm run infra:down
```

## 16. Configuration

Configuration has two distinct audiences:

1. **Runtime/infrastructure configuration**: service URLs, database connections, Kafka, Keycloak, provider credentials, model paths and internal tokens. These stay server-side.
2. **Browser configuration**: values intentionally prefixed with `NEXT_PUBLIC_`, such as the public Gateway origin and public app URL. Anything here can be inspected by a user.

Common web variables include:

| Variable | Used by | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Web | Public API Gateway origin |
| `NEXT_PUBLIC_KEYCLOAK_URL` | Web | Keycloak public URL used by the auth client |
| `NEXT_PUBLIC_KEYCLOAK_REALM` | Web | Keycloak realm |
| `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID` | Web | Public OIDC client identifier |
| `NEXT_PUBLIC_APP_URL` | Web | Public web application URL |

Service-specific variables are documented in each service README. Environment master switches may disable a capability globally, while admin-editable policy belongs in the service policy store and must be audited.

## 17. Development workflow

### Choose the smallest change boundary

1. Identify the owning domain and its service README.
2. Inspect a similar existing feature before adding a new structure.
3. Change the service contract, persistence and event behavior in the owning service.
4. Update Gateway routing and permission checks where required.
5. Update the web adapter, hook and route-local UI.
6. Add or update tests at the narrowest relevant level.
7. Run repository checks before opening a pull request.

### Naming and organization rules

- Keep backend business code separated into application, presentation and infrastructure where the service convention supports it.
- Keep web route files thin and feature code close to the route that owns it.
- Keep API contracts typed and stable.
- Prefer existing shared UI primitives over duplicate local implementations.
- Preserve Vietnamese inline comments for complex code where the repository convention requires them.
- Do not introduce a new abstraction, migration or shared utility without a concrete consumer and ownership boundary.

### Useful root commands

```powershell
npm run build
npm run lint
npm run type-check
npm test
npm run infra:up
npm run infra:down
npm run services:build
npm run services:up
npm run services:down
```

Run a package-specific command when working on one service to receive faster feedback.

## 18. Testing and quality

### Test layers

| Layer | Purpose | Typical location |
| --- | --- | --- |
| Unit | Pure rules, use cases, DTO validation and transformations | Service `*.spec.ts`, web feature utilities/hooks |
| Integration | Service adapters with database, broker or provider boundaries | Service test configuration |
| API/E2E | Complete request flow through Gateway and real infrastructure | Service or repository E2E suites |
| Frontend behavior | Form states, route behavior and user-visible interactions | Web component/feature tests |
| Static checks | Type safety and code consistency | `type-check`, `lint`, build |

### Before a pull request

```powershell
npm run lint
npm run type-check
npm test
npm run build
```

If infrastructure-dependent tests are unavailable locally, record the reason and separate a baseline environment failure from a regression introduced by the change.

### Acceptance scenarios worth protecting

- Guest can browse and retain a cart session.
- Authenticated customer can complete checkout with valid address/shipping data.
- Unauthorized users cannot access seller/admin mutations.
- Seller can create or update a product without bypassing validation.
- Order events are safe under retries.
- Recommendation fallback still returns a usable standard result.
- Notification failure does not silently roll back an already-created order.

## 19. Observability and operations

Operational visibility should answer three questions: is the request failing, where did it fail, and which business entity was affected?

Recommended correlation fields:

- request/correlation ID;
- authenticated actor or anonymous session ID, subject to privacy rules;
- order/product/shop identifier where relevant;
- service name and event name;
- policy/model version for recommendation requests.

Monitor at least:

- Gateway and service availability;
- request latency and error rate;
- Kafka consumer lag and retry/dead-letter behavior;
- database connection and migration health;
- order state transition failures;
- notification delivery failures;
- recommendation fallback rate and model readiness;
- memory and container restart behavior.

Do not log access tokens, passwords, internal service tokens, payment secrets or unnecessary personal data.

## 20. Deployment

Deployment is environment-specific and must use the runtime configuration appropriate for that environment. The repository includes Docker and infrastructure configuration, but the final deployment target, DNS, certificates and provider credentials must be supplied by the operator.

### Safe rollout sequence

1. Build and test the changed services.
2. Build immutable images or deploy artifacts.
3. Apply infrastructure configuration and secrets through the deployment environment.
4. Start dependencies and verify health checks.
5. Start the Gateway and domain services.
6. Verify authentication, public reads and one representative mutation.
7. Verify Kafka consumers and background workers.
8. Verify frontend public configuration and protected-route behavior.
9. Monitor errors, latency, lag and business flow metrics.
10. Roll back the changed service or policy when the evidence requires it.

For AI ranking, deploy the compatible model artifact, verify model readiness, then enable AI for the service. Standard ranking must remain available as the baseline and emergency fallback.

## 21. Documentation map

| Area | Location |
| --- | --- |
| Frontend architecture | `web/README.md` |
| Per-service contracts and setup | `services/*/README.md` |
| Domain understanding | `docs/domain/` |
| Architecture guides | `docs/architecture/` |
| Feature notes | `docs/features/` |
| Interactive flows | `docs/flow/` |
| Delivery plans | `docs/plan/` |
| Shared packages | `packages/` and package-level documentation |
| Local runtime | `docker-compose.yml`, `infra/` and `.env.example` files |

Start with this README for system context, then move to the owning service README before changing implementation details.

## 22. Design decisions

### Why a monorepo?

The monorepo keeps service code, frontend integration, shared tooling and infrastructure changes reviewable together. npm workspaces and Turborepo make package-level execution possible without hiding the cross-service contract.

### Why microservices?

The split makes ownership explicit for identity, catalog, cart, order, seller, shipping, media, notification, recommendation and AI concerns. It also introduces real operational cost, so a new service should be justified by a stable boundary rather than created for every small feature.

### Why an API Gateway?

The browser needs one stable public boundary for routing, CORS, authentication context and common request protection. Domain authorization remains inside each service so a direct internal call cannot bypass business rules.

### Why Kafka?

Order side effects, notifications, analytics and recommendation signals often do not need to block the original request. Durable events allow consumers to retry independently and reduce synchronous coupling.

### Why PostgreSQL and MongoDB?

Relational storage is appropriate for strongly consistent transactional aggregates. Document storage is useful where data is flexible, nested or naturally expires. The owner of each aggregate chooses the persistence model and exposes a contract to other services.

### Why standard ranking plus AI ranking?

Product discovery must remain useful when a model is unavailable, cold-start signals are weak or a rollout is being evaluated. A standard baseline gives the platform a predictable result while AI can be introduced gradually and measured.

## 23. Project status and boundaries

This repository is an actively developed commerce platform and reference implementation. Some integrations, providers, workflows and deployment values are environment-dependent. A README describes the supported structure; it does not guarantee that every optional provider or production deployment is enabled in every checkout.

Before treating a capability as production-ready, verify:

- the owning service endpoint and persistence path;
- authorization and tenant/seller boundaries;
- retry and idempotency behavior;
- observability and failure handling;
- test coverage for the critical business flow;
- environment and provider configuration;
- the related service README and domain document.

## 24. Ownership

### Engineering

**Đào Ngọc Anh**

Software Engineer

Responsible for the architecture, implementation, integration, interaction design and maintenance of the Bin E-Commerce platform.

[View portfolio](https://daongocanh.site)

### Architecture and product experience

The system spans the storefront, customer account, seller operations, admin controls, typed API boundaries, event-driven integrations, recommendation experience and AI-assisted workflows.
