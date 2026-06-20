# learn-aws-cloud-architecture-mastery-for-java-engineers-part-025.md

# Part 025 — API Architecture on AWS: API Gateway, ALB, Lambda, ECS, Auth, Throttling, dan Contracts

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain API production-grade di AWS  
> Fokus part ini: API sebagai kontrak, boundary, traffic-control layer, security surface, dan operating model di AWS  
> Tidak mengulang: HTTP fundamentals, Nginx reverse proxy internals, OpenAPI dasar, Docker/Kubernetes detail, database internals

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, Anda diharapkan mampu:

1. Memilih antara **API Gateway**, **Application Load Balancer**, **CloudFront**, **Lambda**, dan **ECS/Fargate** berdasarkan sifat API, bukan berdasarkan hype.
2. Memahami API sebagai **contract boundary**, bukan hanya endpoint teknis.
3. Mendesain API publik, partner API, internal API, private API, dan service-to-service API di AWS.
4. Memahami perbedaan REST API, HTTP API, WebSocket API, ALB routing, dan private API.
5. Mendesain authN/authZ, throttling, quota, request validation, WAF, observability, dan failure handling.
6. Menghindari failure mode umum: overload, auth bypass, broken contract, unbounded public API, bad timeout, noisy tenant, dan deployment incompatibility.
7. Menghubungkan desain API dengan aplikasi Java: Spring Boot, Quarkus, Micronaut, Lambda handler, ECS service, connection handling, graceful shutdown, tracing, dan error taxonomy.
8. Membuat Architecture Decision Record untuk API layer.

---

## 1. Mental Model: API Bukan Sekadar Endpoint

Di sistem produksi, API adalah **boundary kontrak** antara caller dan capability.

API bukan hanya:

```text
GET /cases/{caseId}
POST /cases/{caseId}/assign
POST /documents/upload
```

API adalah gabungan dari:

```text
protocol + identity + authorization + validation + routing + throttling
+ payload contract + error contract + observability + versioning
+ deployment compatibility + cost + abuse resistance + auditability
```

Jika API hanya dipahami sebagai endpoint, desainnya akan cenderung dangkal:

- semua route dibuat publik;
- auth hanya ditempel di aplikasi;
- throttling tidak dipikirkan;
- error response tidak stabil;
- tidak ada request ID;
- contract berubah tanpa backward compatibility;
- downstream failure bocor ke client;
- satu client noisy bisa menjatuhkan semua sistem;
- API gateway dianggap “optional reverse proxy”.

Cara berpikir yang lebih matang:

```text
API = boundary yang mengatur siapa boleh meminta capability apa,
      dalam bentuk apa,
      dengan batas laju berapa,
      dengan observability apa,
      dengan failure semantics apa,
      dan dengan backward compatibility seperti apa.
```

---

## 2. API Layer di AWS: Komponen Utama

Di AWS, API layer biasanya dibangun dari kombinasi:

1. **Amazon API Gateway**
   - REST API
   - HTTP API
   - WebSocket API
   - private REST API

2. **Application Load Balancer**
   - L7 load balancing
   - path/host/header routing
   - target group ke ECS, EC2, Lambda

3. **CloudFront**
   - edge distribution
   - caching
   - TLS edge
   - origin routing
   - WAF attachment

4. **AWS WAF**
   - request filtering
   - managed rules
   - rate-based rules
   - IP reputation

5. **Amazon Cognito / external IdP / IAM / Lambda authorizer / JWT authorizer**
   - authentication and authorization integration

6. **Backend compute**
   - ECS/Fargate Java service
   - EC2 Java service
   - Lambda Java function
   - App Runner service
   - private service behind VPC Link or ALB

7. **Observability components**
   - CloudWatch Logs
   - CloudWatch Metrics
   - X-Ray / OpenTelemetry
   - access logs
   - application logs
   - alarms

8. **Contract tooling**
   - OpenAPI
   - schema validation
   - generated clients
   - contract tests
   - backward compatibility gates

---

## 3. First Principle: API Type Berdasarkan Caller dan Failure Boundary

Sebelum memilih service, jawab dulu:

1. **Siapa caller-nya?**
   - public browser/mobile client;
   - partner external system;
   - internal frontend;
   - internal service;
   - batch processor;
   - webhook provider;
   - human admin;
   - machine-to-machine integration.

2. **Apa trust boundary-nya?**
   - internet-facing;
   - partner-only;
   - private VPC;
   - intra-account;
   - cross-account;
   - cross-organization.

3. **Apa traffic pattern-nya?**
   - high request/response throughput;
   - bursty;
   - long-lived connection;
   - streaming;
   - low-latency internal;
   - rarely used admin API;
   - tenant-specific spike.

4. **Apa contract stability-nya?**
   - public stable API;
   - internal fast-changing API;
   - generated client API;
   - event callback API;
   - regulatory/audit-sensitive API.

5. **Apa failure behavior yang diinginkan?**
   - reject early;
   - queue asynchronously;
   - degrade;
   - retry client-side;
   - return partial result;
   - fail closed;
   - fail open for read-only path.

6. **Apa operational control yang dibutuhkan?**
   - WAF;
   - throttling;
   - usage plan;
   - API key;
   - JWT validation;
   - request transformation;
   - private endpoint;
   - access log;
   - stage/canary deployment;
   - custom domain.

---

## 4. API Gateway vs ALB: Decision Boundary

### 4.1 Kapan API Gateway Biasanya Lebih Cocok

Gunakan API Gateway ketika API membutuhkan banyak fitur API management:

- public API dengan auth di edge;
- partner API dengan API key, quota, usage plan;
- Lambda-first API;
- request/response transformation;
- request validation;
- private API callable dari VPC endpoint;
- per-client throttling;
- WebSocket API;
- API lifecycle/stage;
- lightweight API facade untuk beberapa AWS service integration;
- strong boundary di depan backend.

### 4.2 Kapan ALB Biasanya Lebih Cocok

Gunakan ALB ketika Anda terutama butuh L7 routing ke service container/VM:

- Java service di ECS/Fargate atau EC2;
- path-based dan host-based routing;
- HTTP/HTTPS workload tradisional;
- low operational complexity;
- request body besar atau long-running HTTP lebih cocok ke backend langsung;
- service sudah punya framework API lengkap;
- API bersifat internal atau application-facing;
- tidak butuh API key/usage plan/transformasi.

### 4.3 Decision Matrix Singkat

| Kebutuhan | API Gateway | ALB |
|---|---:|---:|
| Public managed API boundary | Kuat | Cukup |
| ECS/Fargate Java service | Bisa, tapi sering via VPC Link/ALB | Sangat natural |
| Lambda backend | Sangat natural | Bisa, tapi lebih terbatas |
| Usage plan / API key / quota | REST API mendukung | Tidak native |
| JWT authorizer | HTTP API mendukung | OIDC/Cognito authentication bisa, tapi berbeda model |
| Path/host routing sederhana | Bisa | Sangat natural |
| WebSocket API | Native | Tidak sebagai API management |
| Private API via VPC endpoint | REST private API | Internal ALB via VPC routing |
| Request transformation | REST API kuat | Biasanya di aplikasi |
| Cost per request sangat tinggi volume | Perlu dihitung | Sering lebih ekonomis untuk service HTTP besar |
| Advanced API lifecycle | Kuat | Lebih sederhana |

Kesimpulan praktis:

```text
API Gateway = API management boundary.
ALB         = L7 traffic distribution boundary.
CloudFront  = edge/caching/global distribution boundary.
WAF         = request filtering/abuse-control boundary.
```

---

## 5. API Gateway: REST API, HTTP API, WebSocket API

API Gateway punya beberapa jenis API. Jangan menganggap semuanya sama.

### 5.1 REST API

REST API adalah API Gateway generasi lebih feature-rich.

Cocok untuk:

- API management yang membutuhkan usage plan;
- API key;
- request validation;
- mapping template;
- private REST API;
- mature feature set;
- complex integration.

Trade-off:

- konfigurasi lebih kompleks;
- sering lebih mahal/berat dibanding HTTP API;
- mapping template dapat menjadi logic tersembunyi jika berlebihan.

### 5.2 HTTP API

HTTP API adalah opsi yang lebih sederhana dan ringan untuk HTTP API modern.

Cocok untuk:

- Lambda proxy integration;
- JWT authorizer;
- simple public API;
- lower-latency/lower-cost API Gateway use case;
- routing HTTP sederhana.

Trade-off:

- beberapa fitur REST API tidak tersedia atau berbeda;
- usage plan/API key model tidak sama seperti REST API;
- request transformation tidak sekuat REST API.

### 5.3 WebSocket API

WebSocket API dipakai untuk koneksi bidirectional long-lived.

Cocok untuk:

- notification live;
- collaboration;
- chat;
- realtime dashboard;
- push status processing;
- workflow progress update.

Trade-off:

- connection management menjadi domain design baru;
- perlu menyimpan connection id;
- reconnect behavior harus didesain;
- authorization tidak hanya saat connect, tetapi juga saat message routing;
- quota dan idle timeout perlu diperhatikan.

---

## 6. API Gateway Integration Model

API Gateway bukan backend. Ia menerima request, mengevaluasi route/auth/throttle, lalu meneruskan ke integration.

Integration umum:

1. Lambda proxy integration.
2. HTTP proxy integration.
3. AWS service integration.
4. VPC Link ke private resources.
5. Mock integration.

### 6.1 Lambda Proxy Integration

Dengan Lambda proxy integration, API Gateway meneruskan request sebagai event ke Lambda, dan Lambda mengembalikan response dengan format tertentu.

Kelebihan:

- sangat cepat dibuat;
- natural untuk small API dan event-backed API;
- tidak perlu menjalankan service container;
- mudah scale untuk burst tertentu.

Risiko:

- logic HTTP dan business logic bercampur di handler;
- cold start Java;
- connection pool risk;
- payload/timeout limit;
- error mapping harus disiplin;
- handler besar menjadi mini-monolith.

Pola yang lebih sehat untuk Java:

```text
API Gateway
  -> Lambda handler thin adapter
      -> Application service
          -> Domain logic
          -> Repository/client
```

Jangan membuat semua logic di class handler.

### 6.2 API Gateway ke ECS/EC2 via HTTP Integration

Untuk Java service yang berjalan di ECS/EC2, API Gateway dapat meneruskan request ke HTTP backend.

Pola umum:

```text
Client
  -> API Gateway
      -> VPC Link
          -> internal ALB / NLB
              -> ECS service / EC2 service
```

Cocok ketika:

- API Gateway dibutuhkan sebagai public/partner API boundary;
- backend tetap long-running Java service;
- perlu auth/throttle/usage plan di depan;
- service tidak ingin expose ALB langsung ke internet.

Trade-off:

- chain lebih panjang;
- observability harus end-to-end;
- timeout harus diselaraskan;
- cost bertambah;
- debugging lebih kompleks.

### 6.3 AWS Service Integration

API Gateway dapat langsung memanggil AWS service tertentu.

Contoh:

```text
POST /commands
  -> API Gateway
      -> SQS SendMessage
```

Atau:

```text
GET /presigned-upload-policy
  -> Lambda / service
```

AWS service integration berguna untuk request sederhana, tetapi jangan mengorbankan domain rule, audit, idempotency, dan authorization hanya demi menghindari backend.

---

## 7. ALB sebagai API Entry untuk Java Service

ALB sangat natural untuk Java HTTP service.

Arsitektur umum:

```text
Client
  -> Route 53
      -> ALB
          -> Target Group
              -> ECS/Fargate tasks / EC2 instances
```

ALB bekerja di layer 7. Ia mengevaluasi listener rules dan meneruskan request ke target group.

### 7.1 Listener

Listener adalah port/protocol entry.

Contoh:

```text
HTTPS :443
  default certificate: api.example.com
  rules:
    host api.example.com + path /cases/*       -> case-service-tg
    host api.example.com + path /documents/*   -> document-service-tg
    host admin.example.com                     -> admin-service-tg
```

### 7.2 Rule

Rule dapat memakai kondisi:

- host header;
- path pattern;
- HTTP header;
- HTTP method;
- query string;
- source IP.

Rule action:

- forward;
- redirect;
- fixed response;
- authenticate;

### 7.3 Target Group

Target group berisi target:

- instance;
- IP address;
- Lambda function.

Untuk ECS/Fargate dengan `awsvpc`, target group biasanya bertipe `ip`.

### 7.4 Health Check

Health check menentukan apakah target layak menerima traffic.

Endpoint health check harus menjawab:

```text
Apakah instance/task ini siap menerima traffic sekarang?
```

Bukan:

```text
Apakah semua dependency eksternal sempurna?
```

Jika health check terlalu ketat, dependency kecil bisa menyebabkan semua task dianggap unhealthy dan traffic collapse.

Pola yang sehat:

- `/livez`: proses masih hidup;
- `/readyz`: siap menerima traffic;
- `/health`: informasi agregat untuk manusia/monitoring;
- jangan mengecek dependency berat di every health check;
- bedakan critical dependency dan degraded dependency.

---

## 8. CloudFront di Depan API

CloudFront tidak hanya untuk static content. Ia dapat menjadi edge layer untuk API.

Pola:

```text
Client global
  -> CloudFront
      -> AWS WAF
          -> Origin: API Gateway / ALB / S3
```

Manfaat:

- TLS termination di edge;
- latency global lebih baik untuk TLS handshake dan cached response;
- caching untuk GET/read-only endpoint;
- WAF di edge;
- origin shielding;
- header normalization;
- custom error response;
- multiple origin routing.

Risiko:

- cache key salah dapat bocorkan data user;
- Authorization header dan cookie handling harus hati-hati;
- dynamic API tidak selalu cocok untuk caching;
- invalidation dan TTL harus didesain;
- observability bertambah layer.

Rule penting:

```text
Cache hanya response yang aman di-cache.
Cache key harus mencakup semua dimensi yang memengaruhi response.
```

Contoh cache yang berbahaya:

```text
GET /me
Authorization: Bearer token-user-a
```

Jika cache key tidak memasukkan authorization/user dimension, user B bisa menerima data user A.

Lebih aman:

- cache public metadata;
- cache static config;
- cache reference data;
- cache pre-signed public asset;
- jangan cache user-specific sensitive response kecuali sangat memahami cache key dan policy.

---

## 9. AuthN dan AuthZ di API Layer

Authentication menjawab:

```text
Siapa caller ini?
```

Authorization menjawab:

```text
Caller ini boleh melakukan action ini terhadap resource ini dalam context ini?
```

Banyak API gagal karena hanya melakukan authentication.

### 9.1 Auth Options di AWS API Architecture

1. **JWT authorizer**
   - API Gateway HTTP API dapat memvalidasi JWT;
   - cocok untuk OIDC/Cognito/external IdP;
   - cepat untuk authN dasar dan claim validation.

2. **Lambda authorizer**
   - custom authorization logic;
   - cocok untuk policy kompleks;
   - bisa cache decision;
   - risiko latency dan failure tambahan.

3. **IAM authorization**
   - cocok untuk machine-to-machine AWS principal;
   - sering digunakan untuk internal/cross-account API;
   - request harus SigV4 signed.

4. **Cognito**
   - user pool untuk user authentication;
   - identity pool untuk AWS credential federation;
   - useful untuk app-facing identity.

5. **ALB authentication**
   - ALB dapat authenticate users dengan OIDC/Cognito untuk beberapa use case;
   - cocok untuk web app/admin app tertentu;
   - bukan pengganti fine-grained domain authorization.

6. **Application-level authorization**
   - tetap diperlukan untuk domain-specific access control;
   - contoh: investigator hanya boleh melihat case assigned region-nya.

### 9.2 Pattern yang Sehat

```text
Edge/API layer:
  - validate token authenticity
  - reject missing/invalid token
  - basic scope/claim check
  - throttle/rate-limit
  - attach identity context

Application layer:
  - domain authorization
  - tenant isolation
  - resource ownership
  - workflow state permission
  - audit decision
```

Jangan taruh seluruh authorization domain di API Gateway mapping/authorizer jika domain-nya kompleks. Itu membuat policy tersebar dan sulit diaudit.

### 9.3 Authorization untuk Regulated Case Management

Contoh capability:

```text
POST /cases/{caseId}/approve-enforcement-action
```

Authorization tidak cukup dengan scope:

```text
scope: case:write
```

Harus mempertimbangkan:

- user role;
- organization unit;
- case jurisdiction;
- assignment;
- workflow state;
- separation of duties;
- conflict of interest;
- delegation;
- emergency override;
- audit logging.

Artinya API layer dapat memvalidasi token dan coarse scope, tetapi aplikasi/domain service harus memutuskan final authorization.

---

## 10. Throttling, Quota, Rate Limit, dan Abuse Control

API tanpa throttling adalah undangan untuk overload.

Traffic spike bisa berasal dari:

- bug client;
- retry storm;
- partner integration salah konfigurasi;
- bot;
- malicious abuse;
- tenant besar;
- frontend polling terlalu agresif;
- deployment baru yang mengubah traffic pattern.

### 10.1 Throttling di API Gateway

API Gateway dapat menerapkan throttling dan quota. Untuk REST API, usage plan dan API key dapat digunakan untuk mengatur akses selected APIs dengan batas throttle/quota.

Pahami bahwa throttling bukan hanya security. Ia adalah **load-shedding contract**.

Jika API menolak request dengan `429 Too Many Requests`, client harus tahu:

- boleh retry atau tidak;
- retry setelah berapa lama;
- apakah request idempotent;
- apakah response mewakili quota exhaustion atau system protection.

### 10.2 ALB dan Throttling

ALB tidak menyediakan API usage plan seperti API Gateway. Untuk throttling di depan ALB, opsi umum:

- AWS WAF rate-based rule;
- application-level rate limiting;
- token bucket di Redis/ElastiCache;
- per-tenant quota di service;
- CloudFront/WAF combination.

### 10.3 WAF Rate-Based Rule

WAF dapat membantu menahan abuse berdasarkan IP atau rule lain. Namun IP-based rate limiting sering tidak cukup untuk SaaS/API modern karena:

- banyak client berada di NAT yang sama;
- mobile network berbagi IP;
- attacker bisa menyebar IP;
- tenant identity lebih penting daripada IP.

Untuk partner/tenant API, rate limit idealnya mempertimbangkan:

```text
tenant_id + api_client_id + endpoint_class + request_cost
```

### 10.4 Request Cost

Tidak semua request sama.

Contoh:

```text
GET /cases/{id}
```

murah dibanding:

```text
POST /reports/monthly-export?from=2020-01-01&to=2026-01-01
```

Rate limiting yang matang sering memakai request unit:

```text
simple read             = 1 unit
search query            = 5 units
export request          = 50 units
bulk mutation           = 100 units
```

---

## 11. API Contract: OpenAPI, Error Model, Versioning

API contract harus stabil dan dapat diuji.

Contract mencakup:

1. path;
2. method;
3. headers;
4. query parameter;
5. request body;
6. response body;
7. status code;
8. error body;
9. authentication requirement;
10. idempotency behavior;
11. pagination model;
12. rate limit behavior;
13. deprecation policy;
14. backward compatibility rule.

### 11.1 Error Contract

Jangan biarkan setiap service mengembalikan error format berbeda.

Contoh error contract:

```json
{
  "error": {
    "code": "CASE_NOT_FOUND",
    "message": "Case was not found.",
    "details": {
      "caseId": "CASE-123"
    },
    "requestId": "req-01H...",
    "traceId": "1-..."
  }
}
```

Field penting:

- machine-readable code;
- human-readable message;
- request id;
- trace id;
- optional details;
- jangan leak internal stack trace;
- jangan leak existence data jika authorization-sensitive.

### 11.2 Status Code Discipline

Common mapping:

| Condition | Status |
|---|---:|
| Success read | 200 |
| Success create | 201 |
| Accepted async work | 202 |
| Success no body | 204 |
| Validation error | 400 |
| Missing/invalid auth | 401 |
| Authenticated but not allowed | 403 |
| Resource not found | 404 |
| State conflict / optimistic lock | 409 |
| Semantic validation | 422 |
| Rate limited | 429 |
| Unexpected server error | 500 |
| Downstream unavailable | 502/503 |
| Timeout | 504 |

Be careful: for sensitive resource, you may intentionally return `404` instead of `403` to avoid resource enumeration.

### 11.3 Versioning

API versioning bukan hanya URL `/v1`.

Versioning strategy:

1. URI versioning:

```text
/v1/cases
/v2/cases
```

2. Header versioning:

```text
Accept: application/vnd.example.case+json;version=1
```

3. Backward-compatible evolution:

- add optional field;
- add enum value carefully;
- add endpoint;
- do not remove field abruptly;
- do not change semantics silently.

4. Deprecation policy:

- announce;
- monitor usage;
- provide migration window;
- block new clients;
- retire old route.

### 11.4 Compatibility Rules

Backward-compatible changes usually include:

- adding optional response field;
- adding optional request field;
- adding new endpoint;
- adding new non-breaking enum if clients tolerate unknowns;
- relaxing validation.

Breaking changes include:

- removing field;
- renaming field;
- changing type;
- changing meaning;
- making optional field required;
- changing pagination semantics;
- changing error code contract;
- changing authorization behavior without migration;
- changing idempotency behavior.

---

## 12. Request Validation dan Payload Control

API layer harus reject invalid request sedini mungkin, tetapi jangan membuat domain logic tersebar.

Layered validation:

```text
API Gateway / edge:
  - payload size
  - content type
  - required auth
  - coarse schema
  - method/path/header requirement

Application:
  - semantic validation
  - domain invariant
  - workflow state rule
  - authorization against resource
  - idempotency
```

Contoh:

```text
POST /cases/{caseId}/assign
```

Edge validation:

- `caseId` format ada;
- JSON valid;
- body punya `assigneeId`;
- token valid.

Domain validation:

- case exists;
- assignee is active;
- user can assign;
- case is in assignable state;
- separation of duties not violated;
- audit record produced.

---

## 13. Idempotency untuk API Mutasi

Network itu unreliable. Client bisa retry. Gateway bisa timeout. Backend bisa berhasil tapi response hilang.

Untuk mutasi penting, desain idempotency.

### 13.1 Idempotency Key

Client mengirim:

```http
POST /cases
Idempotency-Key: 01J...
```

Server menyimpan:

```text
caller identity + idempotency key + request hash + result
```

Jika request sama diulang:

- return result yang sama;
- jangan create duplicate.

Jika key sama tapi request body berbeda:

- return conflict.

### 13.2 Natural Idempotency

Beberapa API bisa natural idempotent:

```http
PUT /cases/{caseId}/labels/{labelId}
DELETE /cases/{caseId}/labels/{labelId}
```

Tetapi `POST /cases` biasanya tidak natural idempotent tanpa key.

### 13.3 Idempotency di Java Service

Pola dengan DynamoDB conditional write:

```text
1. Receive request with Idempotency-Key.
2. Compute request hash.
3. Put idempotency record with condition attribute_not_exists(pk).
4. Execute domain mutation.
5. Store result/status.
6. On duplicate key:
   - if same hash and completed -> return stored result;
   - if same hash and in-progress -> return 409/202 depending design;
   - if different hash -> return 409 conflict.
```

Untuk relational DB, bisa memakai unique constraint:

```sql
unique(caller_id, idempotency_key)
```

---

## 14. Async API Pattern: 202 Accepted

Tidak semua request harus selesai synchronously.

Untuk operasi panjang:

```http
POST /reports
```

Response:

```http
202 Accepted
Location: /operations/op-123
```

Client polling:

```http
GET /operations/op-123
```

Response:

```json
{
  "operationId": "op-123",
  "status": "RUNNING",
  "submittedAt": "2026-06-20T10:00:00Z",
  "links": {
    "self": "/operations/op-123"
  }
}
```

Ketika selesai:

```json
{
  "operationId": "op-123",
  "status": "SUCCEEDED",
  "result": {
    "downloadUrl": "..."
  }
}
```

Backend AWS pattern:

```text
API Gateway / ALB
  -> Java command service
      -> persist operation
      -> enqueue SQS / start Step Functions
          -> worker/workflow
              -> update operation status
```

Manfaat:

- timeout API lebih pendek;
- retry lebih aman;
- user journey jelas;
- long-running process observable;
- audit lebih kuat;
- backpressure bisa dikontrol dengan queue.

---

## 15. Private API dan Internal API

Tidak semua API harus public.

Jenis internal API:

1. Internal ALB dalam VPC.
2. API Gateway private REST API via interface VPC endpoint.
3. Service-to-service call via Cloud Map / service discovery.
4. Cross-account private integration via PrivateLink.
5. Event-driven integration tanpa synchronous API.

### 15.1 API Gateway Private REST API

Private REST API hanya callable dari VPC melalui interface VPC endpoint. Private API memerlukan resource policy; endpoint policy dapat digunakan bersama untuk mengontrol siapa dan API apa yang dapat dipanggil dari endpoint.

Cocok untuk:

- internal API dengan API Gateway features;
- cross-account API exposure;
- private partner connectivity;
- centralized API management tanpa internet exposure.

### 15.2 Internal ALB

Internal ALB cocok untuk:

- intra-VPC service API;
- ECS/EC2 Java service;
- low friction internal routing;
- service yang tidak perlu API Gateway management features.

### 15.3 PrivateLink

PrivateLink cocok ketika producer service ingin expose endpoint secara private ke consumer VPC/account tanpa full network mesh.

Mental model:

```text
Producer VPC service
  -> NLB endpoint service
      -> Interface endpoint in Consumer VPC
```

Gunakan ketika:

- cross-account service exposure;
- partner/private SaaS endpoint;
- menghindari VPC peering/transitive routing;
- ingin expose service, bukan entire network.

---

## 16. API Gateway + Lambda Pattern

### 16.1 Kapan Cocok

- simple command/query API;
- low to medium complexity;
- event-driven backend;
- glue API;
- API yang bursty;
- async command endpoint;
- low ops overhead;
- prototype yang bisa distabilkan.

### 16.2 Kapan Hati-Hati

- latency p99 sangat ketat;
- Java cold start unacceptable;
- heavy connection pool;
- large dependency graph;
- long-running request;
- high sustained throughput dengan cost sensitivity;
- complex domain service yang lebih cocok long-running container.

### 16.3 Architecture

```text
Client
  -> CloudFront/WAF optional
      -> API Gateway HTTP API
          -> Lambda Java handler
              -> DynamoDB / SQS / Step Functions / S3
```

### 16.4 Handler Discipline

Handler harus tipis:

```java
public class CreateCaseHandler implements RequestHandler<ApiGatewayRequest, ApiGatewayResponse> {
    private final CreateCaseUseCase useCase = Bootstrap.createCaseUseCase();

    @Override
    public ApiGatewayResponse handleRequest(ApiGatewayRequest request, Context context) {
        RequestContext ctx = RequestContextMapper.from(request, context);
        CreateCaseCommand command = RequestParser.parse(request);
        CreateCaseResult result = useCase.execute(ctx, command);
        return ApiResponseMapper.created(result);
    }
}
```

Pisahkan:

- request parsing;
- auth context mapping;
- domain use case;
- persistence;
- response mapping;
- exception mapping.

---

## 17. ALB + ECS/Fargate Java API Pattern

### 17.1 Kapan Cocok

- Spring Boot/Quarkus/Micronaut service;
- sustained HTTP traffic;
- complex business API;
- need connection pool reuse;
- predictable latency;
- multiple endpoints;
- service-level autoscaling;
- easier local parity.

### 17.2 Architecture

```text
Route 53
  -> CloudFront optional
      -> AWS WAF optional
          -> public ALB
              -> target group: ECS Fargate tasks
                  -> Java API service
                      -> RDS/DynamoDB/S3/SQS/etc.
```

### 17.3 Java Service Requirements

Service harus menyediakan:

- `/readyz`;
- `/livez`;
- structured logs;
- request ID propagation;
- OpenTelemetry tracing;
- graceful shutdown;
- timeout per downstream;
- connection pool bounded;
- error mapping;
- idempotency support;
- metrics endpoint or custom metrics;
- version endpoint;
- build metadata endpoint.

### 17.4 Graceful Shutdown

Saat ECS menghentikan task:

1. task menerima SIGTERM;
2. service berhenti menerima request baru;
3. ALB deregistration dimulai;
4. in-flight request diberi waktu selesai;
5. connection pool ditutup;
6. process exit.

Jika ini salah, deployment akan menghasilkan 5xx intermittent.

---

## 18. API Gateway + ECS via VPC Link Pattern

Pattern:

```text
Client / Partner
  -> API Gateway
      -> VPC Link
          -> internal ALB/NLB
              -> ECS Java service
```

Cocok ketika:

- butuh API Gateway API management features;
- backend tetap container Java;
- ingin backend tidak punya public ALB;
- partner API perlu usage plan/API key/throttling;
- external API contract berbeda dari internal service contract.

Trade-off:

- lebih banyak hop;
- timeout harus diselaraskan;
- debugging perlu correlation ID end-to-end;
- biaya API Gateway + LB + compute;
- deployment dependencies lebih banyak.

Rule:

```text
Jika API Gateway hanya meneruskan seluruh request tanpa policy, auth, throttle, atau transformation yang berguna,
kemungkinan ALB langsung lebih sederhana.
```

---

## 19. Request Path dan Timeout Budget

Setiap layer punya timeout. Jangan desain API tanpa timeout budget.

Contoh chain:

```text
Client timeout:          10s
CloudFront origin:        ?
API Gateway timeout:      service-specific limit
ALB idle timeout:         60s default commonly configured
Java server timeout:      8s
Downstream DB timeout:    2s
Downstream S3 timeout:    3s
Retry budget:             bounded
```

Desain buruk:

```text
Client timeout 5s
Backend timeout 30s
DB timeout 60s
```

Akibat:

- client sudah pergi;
- server masih kerja;
- retry client membuat duplicate load;
- thread pool habis;
- DB connection habis;
- sistem collapse.

Desain lebih sehat:

```text
end-to-end timeout budget = 3s
  auth/edge      50ms
  routing        50ms
  app logic      500ms
  DB             300ms
  downstream     500ms
  serialization  100ms
  buffer         remaining
```

Untuk operasi panjang, jangan memaksa synchronous request. Gunakan `202 Accepted` + operation resource.

---

## 20. Pagination, Filtering, Sorting

API data-heavy harus punya pagination contract.

### 20.1 Offset Pagination

```text
GET /cases?page=10&pageSize=50
```

Mudah dipahami, tetapi bermasalah untuk data berubah cepat dan offset besar.

### 20.2 Cursor Pagination

```text
GET /cases?limit=50&pageToken=eyJ..."
```

Lebih baik untuk data besar dan continuation.

Response:

```json
{
  "items": [ ... ],
  "nextPageToken": "eyJ..."
}
```

Rule:

- token opaque;
- jangan expose internal key tanpa pertimbangan;
- token punya expiry jika perlu;
- sorting harus stabil;
- include consistent filter criteria in token.

### 20.3 Filtering

Jangan memberi query API yang tanpa batas.

Buruk:

```text
GET /cases?query=anything&from=1900-01-01&includeAll=true
```

Lebih sehat:

- filter allowlist;
- max date range;
- max page size;
- indexed fields only;
- async export untuk query berat;
- search service untuk search-heavy workload.

---

## 21. File Upload/Download API

Jangan upload file besar melalui Java API jika S3 bisa menerima langsung.

Pattern yang lebih baik:

```text
Client
  -> POST /documents/upload-intent
      -> Java API validates auth/domain
      -> returns presigned S3 URL

Client
  -> PUT object directly to S3

S3 event
  -> virus scan / metadata extraction / workflow
```

Manfaat:

- API service tidak menjadi data pump;
- reduce memory pressure;
- lower cost;
- better retry multipart upload;
- backend tetap mengontrol authorization dan metadata.

Download:

```text
Client
  -> GET /documents/{id}/download-url
      -> Java API validates authorization
      -> returns short-lived presigned URL

Client
  -> GET S3 object via presigned URL
```

Untuk highly sensitive documents:

- short expiry;
- object key unpredictable;
- audit download intent;
- maybe proxy through service if policy demands;
- watermarking/classification if required;
- object lock for evidence if applicable.

---

## 22. Webhook API

Webhook endpoint adalah public API yang dipanggil sistem eksternal.

Risiko:

- duplicate event;
- out-of-order event;
- fake event;
- replay attack;
- provider retry storm;
- slow response menyebabkan provider retry;
- schema changes;
- event burst.

Pattern sehat:

```text
External provider
  -> API Gateway / ALB
      -> webhook receiver
          -> verify signature
          -> persist raw event
          -> enqueue SQS
          -> return 2xx quickly
              -> async processor
```

Rules:

- verify signature/HMAC;
- reject old timestamp;
- store provider event ID;
- idempotent processing;
- return quickly;
- process asynchronously;
- keep raw payload for audit/debug;
- monitor DLQ.

---

## 23. Multi-Tenant API Design

Untuk SaaS/regulatory platform multi-tenant, API harus tenant-aware.

Tenant identity bisa berasal dari:

- JWT claim;
- API key mapping;
- subdomain;
- mTLS client certificate;
- request path;
- IAM principal/session tag;
- partner integration record.

Rule:

```text
Tenant ID dari request path tidak boleh dipercaya begitu saja.
Tenant context harus berasal dari authenticated identity atau mapping yang terkontrol.
```

Buruk:

```http
GET /tenants/{tenantId}/cases
Authorization: token user A
```

lalu aplikasi memakai `{tenantId}` tanpa mengecek token.

Lebih sehat:

```text
1. Validate token.
2. Resolve caller tenant(s).
3. If path has tenantId, verify caller is allowed for that tenant.
4. Apply tenant condition in every data access.
5. Audit tenant context.
```

Per-tenant control:

- throttling;
- quota;
- data partition;
- encryption key;
- observability dimension;
- cost allocation;
- abuse suspension;
- emergency access block.

---

## 24. API Observability

Minimum observability untuk API:

1. access log;
2. application log;
3. request ID;
4. trace ID;
5. latency metrics;
6. status code metrics;
7. error code metrics;
8. auth failure metrics;
9. throttle metrics;
10. downstream dependency metrics;
11. per-route dashboard;
12. per-tenant dashboard untuk SaaS;
13. alarm untuk 5xx, 4xx spike, p95/p99 latency, throttling, saturation.

### 24.1 Correlation ID

Request harus punya ID end-to-end:

```text
x-request-id: req-...
traceparent: ...
```

Jika client tidak mengirim request ID, edge/app membuat satu.

Log Java:

```json
{
  "timestamp": "2026-06-20T10:00:00Z",
  "level": "INFO",
  "service": "case-api",
  "route": "POST /cases/{caseId}/assign",
  "requestId": "req-123",
  "traceId": "1-...",
  "tenantId": "tenant-a",
  "actorId": "user-123",
  "caseId": "CASE-123",
  "status": 200,
  "latencyMs": 148
}
```

### 24.2 Access Log vs App Log

Access log menjawab:

```text
Request apa masuk, dari mana, route apa, status apa, latency berapa?
```

App log menjawab:

```text
Apa keputusan bisnis/teknis yang terjadi saat request diproses?
```

Audit log menjawab:

```text
Siapa melakukan action apa terhadap resource apa, kapan, dengan outcome apa?
```

Jangan mencampur semua menjadi satu log tanpa struktur.

---

## 25. Security Controls untuk API

Layered controls:

```text
DNS/domain
  -> TLS
  -> CloudFront optional
  -> WAF
  -> API Gateway / ALB
  -> authN
  -> coarse authZ
  -> throttling
  -> request validation
  -> backend app authZ
  -> domain invariant
  -> audit log
  -> data access control
```

Checklist:

- TLS enforced;
- modern TLS policy;
- no public HTTP except redirect;
- WAF for public API;
- auth required by default;
- no anonymous admin endpoint;
- no debug endpoint public;
- CORS restricted;
- payload size bounded;
- sensitive headers not logged;
- PII masked;
- least privilege integration role;
- private backend if possible;
- audit sensitive action;
- rate limit external clients;
- tenant isolation tested.

### 25.1 CORS

CORS bukan authentication. CORS hanya browser policy.

Bad assumption:

```text
CORS restricts API access.
```

Reality:

```text
Non-browser clients can ignore CORS.
```

CORS harus dikonfigurasi untuk UX/security browser, tetapi authorization tetap wajib.

### 25.2 mTLS

Mutual TLS cocok untuk:

- partner API;
- machine-to-machine integration;
- high-trust private client identity;
- financial/regulatory integration.

Tetapi mTLS menjawab client certificate identity, bukan semua domain authorization. Tetap perlu map certificate ke partner/client/tenant/capability.

---

## 26. Deployment dan Compatibility

API deployment harus mempertahankan compatibility.

### 26.1 Backward-Compatible Deployment

Contoh aman:

1. Backend baru menerima old + new field.
2. Client baru mulai mengirim new field.
3. Setelah semua client upgrade, old field dideprecate.
4. Setelah window selesai, old field dihapus.

### 26.2 Database Migration Coordination

Untuk API yang mengubah schema:

```text
expand -> deploy app compatible with both -> migrate data -> switch reads -> contract cleanup
```

Jangan deploy API yang langsung butuh kolom baru tanpa migration siap.

### 26.3 Canary

Canary deployment berguna untuk melihat:

- error rate;
- latency;
- auth failure;
- downstream saturation;
- business metric anomaly;
- tenant-specific impact.

Rollback tidak boleh hanya berdasarkan 5xx. Kadang deployment sukses teknis tetapi merusak business invariant.

---

## 27. AWS Reference Architectures

### 27.1 Public Java API dengan ALB + ECS

```text
Route 53
  -> CloudFront
      -> WAF
          -> ALB
              -> ECS Fargate Java API
                  -> RDS/Aurora
                  -> DynamoDB
                  -> S3
                  -> SQS
```

Use case:

- main business API;
- high sustained traffic;
- complex domain logic;
- Java framework service.

Strength:

- natural Java service model;
- connection reuse;
- easy debugging;
- ALB routing;
- container deployment.

Weakness:

- API management features must be built/app-added;
- per-client quota not native in ALB;
- WAF/application rate limit needed.

### 27.2 Partner API dengan API Gateway + ECS Backend

```text
Partner Client
  -> API Gateway REST API
      -> usage plan / API key / authorizer
      -> VPC Link
          -> internal ALB
              -> ECS Java partner-api service
```

Use case:

- partner API;
- need API keys/quota;
- want backend private;
- contract intentionally different from internal API.

Strength:

- API management;
- throttling/quota;
- private backend;
- observability at API boundary.

Weakness:

- more moving parts;
- timeout alignment;
- cost;
- mapping complexity.

### 27.3 Async Command API

```text
Client
  -> API Gateway / ALB
      -> Java command service
          -> validate/auth/idempotency
          -> persist operation
          -> SQS / Step Functions
              -> worker/workflow
```

Use case:

- report generation;
- enforcement workflow action;
- document processing;
- bulk import;
- external system integration.

Strength:

- resilient;
- timeout-safe;
- auditable;
- supports retries/backpressure.

Weakness:

- client must handle async state;
- more state model;
- eventual consistency.

### 27.4 Lambda-first API

```text
API Gateway HTTP API
  -> Lambda Java handler
      -> DynamoDB/S3/SQS
```

Use case:

- small API;
- event-backed commands;
- simple read/write;
- low ops burden.

Strength:

- simple infrastructure;
- automatic scaling;
- no container runtime.

Weakness:

- Java cold start;
- function sprawl;
- connection management;
- timeout and package size constraints.

### 27.5 Private Internal API

```text
Internal service
  -> internal ALB
      -> ECS Java service
```

or:

```text
Internal service in VPC
  -> API Gateway private REST API via interface endpoint
      -> backend integration
```

Use case:

- internal platform API;
- cross-account private API;
- backend orchestration.

Strength:

- no internet exposure;
- controlled network path;
- can use IAM/resource policies.

Weakness:

- networking and DNS complexity;
- harder developer access;
- endpoint policy/resource policy debugging.

---

## 28. Failure Mode Catalog

### 28.1 No Throttling

Symptom:

- traffic spike overwhelms backend;
- database connection pool exhausted;
- p99 latency explodes;
- retry storm.

Mitigation:

- API Gateway throttling;
- WAF rate-based rule;
- app rate limiting;
- per-tenant quota;
- async queue for expensive work;
- client retry guidance.

### 28.2 Auth Only at Frontend

Symptom:

- backend endpoint callable directly;
- bypass frontend checks;
- unauthorized data access.

Mitigation:

- enforce auth at API/backend;
- no public backend bypass;
- security group restrict origin;
- validate token server-side;
- domain authorization in service.

### 28.3 Broken Tenant Isolation

Symptom:

- caller changes `tenantId` path/query;
- sees other tenant data.

Mitigation:

- tenant derived from identity;
- path tenant verified against identity;
- data access always scoped;
- tests for cross-tenant access;
- audit tenant context.

### 28.4 Cache Data Leak

Symptom:

- user receives another user's response from CloudFront/cache.

Mitigation:

- correct cache key;
- avoid caching user-specific responses;
- include auth/cookie only if safe;
- Cache-Control discipline;
- test with two users.

### 28.5 Timeout Mismatch

Symptom:

- client times out;
- backend keeps processing;
- retries duplicate mutation;
- resource exhaustion.

Mitigation:

- timeout budget;
- idempotency;
- async processing;
- bounded retries;
- cancellation where possible.

### 28.6 Health Check Too Strict

Symptom:

- transient dependency issue causes all targets unhealthy;
- ALB returns 503;
- cascading failure.

Mitigation:

- separate liveness/readiness;
- readiness checks only critical local readiness;
- degraded mode;
- dependency-specific alarms.

### 28.7 Contract Drift

Symptom:

- backend changes response;
- clients break;
- generated clients fail;
- partner escalations.

Mitigation:

- OpenAPI source of truth;
- contract tests;
- backward compatibility checks;
- versioning/deprecation policy.

### 28.8 Error Leakage

Symptom:

- stack trace returned;
- SQL error visible;
- internal hostnames leak;
- authorization existence leak.

Mitigation:

- centralized error mapper;
- safe public error contract;
- internal logs keep detail;
- sensitive resource returns controlled 404/403.

### 28.9 API Gateway Mapping Logic Becomes Business Logic

Symptom:

- VTL/templates contain branching domain rules;
- app and gateway disagree;
- tests incomplete.

Mitigation:

- keep mapping minimal;
- move domain logic to application;
- test gateway config;
- document transformation.

### 28.10 Missing Audit for Sensitive API

Symptom:

- cannot prove who approved/changed/exported data;
- compliance gap.

Mitigation:

- audit log at domain action level;
- include actor, tenant, resource, action, outcome, reason;
- immutable storage where required;
- link request ID and trace ID.

---

## 29. Java Implementation Blueprint

### 29.1 Spring Boot API Service Behind ALB

Core capabilities:

- controller thin;
- service/use-case layer;
- domain authorization;
- validation;
- idempotency;
- error mapper;
- request ID filter;
- structured logging;
- OpenTelemetry;
- health endpoints;
- graceful shutdown.

Pseudo structure:

```text
com.example.caseapi
  api/
    CaseController.java
    ErrorResponse.java
    GlobalExceptionHandler.java
    RequestContextFilter.java
  application/
    AssignCaseUseCase.java
    CreateCaseUseCase.java
  domain/
    Case.java
    CaseState.java
    CasePolicy.java
  persistence/
    CaseRepository.java
  integration/
    S3DocumentClient.java
    SqsCommandPublisher.java
  observability/
    AuditLogger.java
```

### 29.2 Request Context

Create request context once:

```java
public record RequestContext(
    String requestId,
    String traceId,
    String tenantId,
    String actorId,
    Set<String> scopes,
    Instant receivedAt
) {}
```

Use it everywhere:

- authorization;
- audit;
- logging;
- metrics;
- downstream calls;
- idempotency.

### 29.3 Error Mapping

Example exception taxonomy:

```text
ValidationException        -> 400
AuthenticationException    -> 401
AuthorizationException     -> 403 / 404 for sensitive existence
ResourceNotFoundException  -> 404
ConflictException          -> 409
RateLimitException         -> 429
DownstreamTimeoutException -> 504
DownstreamUnavailable      -> 503
UnexpectedException        -> 500
```

Do not let framework default error leak internals.

### 29.4 OpenAPI Contract Gate

Pipeline should run:

1. unit tests;
2. API contract generation/validation;
3. backward compatibility check;
4. integration test;
5. auth test;
6. negative test;
7. performance smoke;
8. deploy canary.

---

## 30. API Design for Regulated Case Management Platform

Scenario:

- regulated investigation platform;
- multiple agencies/tenants;
- sensitive case documents;
- external partner submission;
- internal case workflow;
- audit required;
- export/reporting;
- human approval;
- strict authorization.

### 30.1 API Surface

Public/partner API:

```text
POST /partner/v1/submissions
GET  /partner/v1/submissions/{submissionId}
POST /partner/v1/webhooks/ack
```

Internal user API:

```text
GET  /v1/cases
POST /v1/cases
GET  /v1/cases/{caseId}
POST /v1/cases/{caseId}/assign
POST /v1/cases/{caseId}/recommend-enforcement
POST /v1/cases/{caseId}/approve-enforcement
POST /v1/documents/upload-intent
GET  /v1/documents/{documentId}/download-url
```

Admin API:

```text
POST /admin/v1/policies
POST /admin/v1/users/{userId}/delegations
GET  /admin/v1/audit-events
```

### 30.2 Architecture

```text
Internet / Partner
  -> CloudFront
      -> WAF
          -> API Gateway REST API
              -> authorizer + usage plan + throttling
              -> VPC Link
                  -> internal ALB
                      -> partner-api ECS service

Internal App Users
  -> CloudFront
      -> WAF
          -> ALB
              -> case-api ECS service

Long-running commands
  -> case-api
      -> Step Functions / SQS
          -> workers

Documents
  -> upload intent API
      -> S3 presigned URL
      -> S3 event scan/extract
```

### 30.3 Security Model

- JWT validates identity;
- domain service enforces case-level authorization;
- tenant context derived from identity;
- sensitive action requires workflow state and separation of duties;
- approval action writes immutable audit event;
- document access generates short-lived presigned URL;
- WAF protects public entry;
- partner API has usage plan/API key/mTLS depending requirement;
- admin API isolated by route/domain and stronger authorization.

### 30.4 Audit Model

Audit event:

```json
{
  "eventType": "CASE_ASSIGNMENT_CHANGED",
  "tenantId": "agency-a",
  "caseId": "CASE-123",
  "actorId": "user-456",
  "requestId": "req-789",
  "traceId": "1-...",
  "previousAssignee": "user-111",
  "newAssignee": "user-222",
  "outcome": "SUCCEEDED",
  "occurredAt": "2026-06-20T10:00:00Z"
}
```

Audit is not the same as app log. Audit is domain evidence.

---

## 31. ADR Template

```markdown
# ADR: API Entry Architecture for <Workload>

## Status
Proposed / Accepted / Deprecated / Superseded

## Context
- Callers:
- Trust boundary:
- Traffic pattern:
- Auth requirements:
- Throttling requirements:
- Contract stability:
- Backend runtime:
- Compliance/audit requirements:

## Decision
We will use:
- Entry layer:
- Auth mechanism:
- Backend integration:
- Throttling/quota:
- WAF:
- Observability:
- Versioning strategy:

## Alternatives Considered
1. API Gateway + Lambda
2. API Gateway + VPC Link + ECS
3. ALB + ECS
4. CloudFront + ALB
5. Private API

## Consequences
Positive:
- ...

Negative:
- ...

Risks:
- ...

Mitigations:
- ...

## Operational Invariants
- Every request has requestId and traceId.
- Every mutating request is idempotent or explicitly non-idempotent.
- Every external API has throttling.
- Every sensitive action has audit event.
- Backend is not publicly reachable except through approved entry.
- API contract changes pass backward compatibility checks.
```

---

## 32. Review Checklist

### Architecture

- [ ] Caller and trust boundary are clear.
- [ ] API Gateway vs ALB decision is justified.
- [ ] CloudFront usage is justified and cache policy is safe.
- [ ] Backend exposure is minimized.
- [ ] Private/internal APIs are not accidentally public.

### Security

- [ ] TLS is enforced.
- [ ] AuthN is required where needed.
- [ ] Domain AuthZ exists in application.
- [ ] Tenant isolation is tested.
- [ ] WAF/rate limiting exists for public API.
- [ ] CORS is not treated as security.
- [ ] Sensitive headers/body are not logged.

### Contract

- [ ] OpenAPI/spec exists.
- [ ] Error contract is consistent.
- [ ] Pagination contract is stable.
- [ ] Idempotency is defined for mutations.
- [ ] Backward compatibility rules exist.
- [ ] Deprecation policy exists.

### Reliability

- [ ] Timeout budget exists.
- [ ] Retry behavior is documented.
- [ ] Long-running operations are async.
- [ ] Health checks are correct.
- [ ] Graceful shutdown tested.
- [ ] Downstream failure behavior is defined.

### Observability

- [ ] Access logs enabled.
- [ ] Application structured logs exist.
- [ ] Request ID/trace ID propagated.
- [ ] Per-route latency/error metrics exist.
- [ ] 4xx/5xx/throttle alarms exist.
- [ ] Audit events exist for sensitive actions.

### Cost

- [ ] Per-request cost understood.
- [ ] CloudFront/API Gateway/ALB/WAF costs considered.
- [ ] Log volume bounded.
- [ ] Expensive endpoints have request-unit control.
- [ ] Partner/tenant usage can be attributed.

---

## 33. Exercises

### Exercise 1 — API Gateway vs ALB

Anda punya Java Spring Boot service di ECS Fargate untuk internal admin app. Traffic hanya dari corporate VPN/private network. Tidak butuh API key/usage plan. Pilih API Gateway atau ALB? Buat ADR singkat.

### Exercise 2 — Partner API

Desain partner API untuk submit laporan pelanggaran. Requirement:

- partner external;
- quota per partner;
- request signature atau token;
- payload besar berisi dokumen;
- async processing;
- audit;
- partner dapat cek status.

Buat architecture dan endpoint contract.

### Exercise 3 — Idempotent Mutation

Desain `POST /cases/{caseId}/assign` agar aman terhadap retry.

Pertimbangkan:

- idempotency key;
- optimistic locking;
- audit event;
- duplicate request;
- conflicting repeated request.

### Exercise 4 — Cache Safety

Endpoint mana yang aman untuk cache di CloudFront?

```text
GET /public/reference-data/case-types
GET /me
GET /cases/{caseId}
GET /documents/{documentId}/download-url
GET /public/status
```

Jelaskan cache key dan TTL untuk yang aman.

### Exercise 5 — Failure Mode Walkthrough

Partner client bug mengirim 10x request karena retry tanpa backoff. Backend RDS connection pool habis. Buat mitigation di:

- client contract;
- API Gateway/WAF;
- application;
- database;
- observability;
- runbook.

---

## 34. Ringkasan Mental Model

API architecture di AWS harus dibaca sebagai boundary design:

```text
Caller -> Edge -> API boundary -> Backend integration -> Domain capability -> Data/workflow side effect
```

API Gateway bukan selalu lebih baik dari ALB. ALB bukan selalu cukup. CloudFront bukan hanya CDN. WAF bukan pengganti authorization. CORS bukan security. JWT claim bukan domain permission. API key bukan authentication kuat. OpenAPI bukan hanya dokumentasi. Error response adalah contract. Idempotency adalah reliability feature. Throttling adalah load-shedding contract. Audit log adalah evidence, bukan debug log.

Untuk Java engineer, API production-grade berarti:

- controller/handler tipis;
- domain authorization jelas;
- error mapping konsisten;
- idempotency untuk mutasi;
- timeout budget;
- request context propagation;
- structured logging;
- graceful shutdown;
- contract testing;
- deployment compatibility;
- observability per route/caller/tenant.

Jika semua ini ada, API bukan hanya “bisa dipanggil”; API menjadi boundary yang aman, operable, reliable, dan defensible.

---

## 35. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-026.md
```

Judul:

```text
Governance, Audit, and Compliance: CloudTrail, Config, Control Tower, Security Hub
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — Configuration and Secrets: Parameter Store, Secrets Manager, AppConfig, Runtime Flags</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-026.md">Part 026 — Governance, Audit, and Compliance: CloudTrail, Config, Control Tower, Security Hub ➡️</a>
</div>
