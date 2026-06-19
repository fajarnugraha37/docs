# learn-redis-mastery-for-java-engineers-part-033.md

# Part 033 — Architecture Lab: Build a Production-Grade Redis Layer in Java

> Seri: `learn-redis-mastery-for-java-engineers`  
> Bagian: `033`  
> Target pembaca: Java software engineer / tech lead / backend architect  
> Fokus: merancang dan membangun Redis layer yang production-grade, observable, testable, defensible, dan aman terhadap failure mode nyata

---

## 0. Posisi Part Ini Dalam Seri

Sampai bagian sebelumnya, kita sudah membahas Redis dari banyak sisi:

- data model Redis;
- Strings, Hashes, Lists, Sets, Sorted Sets;
- TTL, expiration, eviction;
- cache-aside;
- consistency dan invalidation;
- rate limiting;
- idempotency;
- distributed locks;
- Lua dan Redis Functions;
- Pub/Sub dan Streams;
- persistence;
- replication, Sentinel, Cluster;
- memory engineering;
- latency engineering;
- Java clients;
- transactions;
- security;
- observability;
- operations;
- testing;
- design patterns;
- anti-patterns.

Part ini bukan menambah banyak konsep baru. Part ini menyatukan semuanya dalam satu **architecture lab**.

Tujuannya adalah membangun mental model dan blueprint yang bisa kamu pakai ketika harus menjawab pertanyaan seperti:

> “Bagaimana kita memakai Redis di service Java production tanpa berubah menjadi kumpulan helper acak, key liar, TTL tidak konsisten, cache invalidation rapuh, dan incident memory mendadak?”

Kita akan membangun Redis layer untuk sebuah backend service imajiner yang cukup realistis.

---

## 1. Core Thesis

Redis yang production-grade bukan hanya soal bisa menjalankan command Redis.

Redis production-grade berarti:

1. setiap key punya owner;
2. setiap key punya schema;
3. setiap key punya lifecycle;
4. setiap Redis operation punya latency budget;
5. setiap failure mode punya fallback behavior;
6. setiap cached value punya freshness contract;
7. setiap coordination primitive punya boundary;
8. setiap serializer punya versioning strategy;
9. setiap client punya timeout dan retry policy yang sadar risiko;
10. setiap dashboard bisa menjawab “Redis sehat atau sedang membunuh sistem pelan-pelan?”

Dalam sistem yang buruk, Redis muncul sebagai utility global:

```java
redisTemplate.opsForValue().set("user:" + id, user);
```

Dalam sistem yang matang, Redis muncul sebagai **bounded infrastructure capability**:

```java
UserProfileCache.get(userId)
IdempotencyStore.tryStart(commandKey, fingerprint)
TenantRateLimiter.consume(tenantId, route, now)
CaseWorkflowTransientState.update(caseId, transitionAttempt)
```

Perbedaannya bukan kosmetik. Perbedaannya adalah governance.

---

## 2. Lab Scenario

Kita akan membangun Redis layer untuk service bernama:

```text
case-enforcement-service
```

Service ini mengelola workflow enforcement case dalam sistem regulatori.

Konteks bisnis:

- user internal membuat dan memproses enforcement case;
- tiap case memiliki lifecycle;
- beberapa operasi mahal karena membaca data dari PostgreSQL dan service lain;
- API dipanggil oleh UI, batch worker, dan integrasi eksternal;
- perlu rate limiting untuk tenant/API client;
- perlu idempotency untuk command mutasi;
- perlu cache untuk read-heavy endpoint;
- perlu transient state untuk workflow UI;
- perlu distributed coordination ringan untuk menghindari double processing job;
- audit trail tetap berada di database/event log, bukan Redis.

Redis akan dipakai untuk:

1. cache read model;
2. negative cache;
3. idempotency key store;
4. rate limiter;
5. workflow transient state;
6. short-lived processing lock dengan fencing awareness;
7. Pub/Sub signal untuk cache invalidation antar instance;
8. observability target.

Redis **tidak** akan dipakai sebagai:

1. primary database;
2. audit trail;
3. durable event broker utama;
4. source of truth workflow;
5. tempat menyimpan dokumen besar;
6. pengganti PostgreSQL constraint;
7. pengganti Kafka/RabbitMQ untuk event critical.

---

## 3. Requirement Lab

### 3.1 Functional Requirements

Service harus mendukung:

1. membaca case summary berdasarkan `caseId`;
2. membaca dashboard case list per tenant;
3. mengeksekusi command mutasi case secara idempotent;
4. membatasi request API per tenant dan per route;
5. menyimpan transient UI state untuk draft workflow action;
6. mencegah worker ganda memproses case yang sama secara bersamaan;
7. invalidasi cache saat case berubah;
8. tetap berfungsi secara degraded ketika Redis bermasalah.

### 3.2 Non-Functional Requirements

Redis layer harus:

1. punya key schema eksplisit;
2. punya TTL policy eksplisit;
3. punya serialization policy eksplisit;
4. punya timeout policy eksplisit;
5. punya observability metrics;
6. bisa diuji dengan Testcontainers;
7. tidak membuat source-of-truth ambiguity;
8. aman terhadap key explosion;
9. aman terhadap hot key semampunya;
10. punya runbook untuk failure Redis.

### 3.3 Regulatory/Defensibility Requirements

Karena domain enforcement/regulatory sensitif, aturan pentingnya:

1. keputusan final tidak boleh hanya tersimpan di Redis;
2. Redis boleh mempercepat, tapi tidak boleh menjadi satu-satunya bukti;
3. idempotency record di Redis boleh membantu request handling, tapi audit mutation tetap di PostgreSQL/event log;
4. rate limit decision perlu cukup observable agar bisa dijelaskan;
5. approximate structure seperti HyperLogLog tidak boleh dipakai untuk angka audit final;
6. cache stale harus punya batas TTL dan invalidation path;
7. lock expiry tidak boleh menghasilkan corrupt workflow state.

---

## 4. Architecture Overview

Kita akan membangun Redis layer seperti ini:

```text
┌─────────────────────────────────────────────────────────────┐
│                    Java Application                         │
│                                                             │
│  ┌───────────────┐    ┌──────────────────────────────────┐  │
│  │ Controllers   │ -> │ Application Services              │  │
│  └───────────────┘    └──────────────────────────────────┘  │
│                                │                            │
│                                v                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Redis Capability Layer                │ │
│  │                                                        │ │
│  │  CaseSummaryCache                                     │ │
│  │  DashboardCache                                       │ │
│  │  IdempotencyStore                                     │ │
│  │  TenantRateLimiter                                    │ │
│  │  WorkflowTransientStateStore                          │ │
│  │  ProcessingLeaseStore                                 │ │
│  │  CacheInvalidationPublisher/Subscriber                │ │
│  │                                                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                │                            │
│                                v                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                Redis Client Infrastructure             │ │
│  │                                                        │ │
│  │  RedisConnectionFactory / LettuceClientConfiguration   │ │
│  │  ObjectMapper / RedisCodec / serializers               │ │
│  │  timeout/retry/circuit-breaker integration             │ │
│  │  metrics/tracing                                      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

                         │
                         v
┌─────────────────────────────────────────────────────────────┐
│                         Redis                               │
│  keyspace, TTL, scripts, rate limiter, idempotency, cache    │
└─────────────────────────────────────────────────────────────┘
```

Prinsipnya:

> Application service tidak boleh memanggil Redis command mentah secara sembarang. Ia memanggil capability yang punya contract.

Buruk:

```java
redisTemplate.opsForValue().get("case:" + id);
```

Lebih baik:

```java
caseSummaryCache.get(caseId);
```

Lebih baik lagi:

```java
caseSummaryCache.getOrLoad(caseId, () -> caseReadRepository.fetchSummary(caseId));
```

Karena dengan begitu, key format, TTL, serializer, metrics, miss behavior, dan fallback tidak bocor ke seluruh codebase.

---

## 5. Bounded Context dan Redis Ownership

Sebelum menulis code, tentukan ownership.

Redis key harus punya owner yang jelas.

Contoh ownership table:

| Capability | Owner Code Module | Redis Type | Source of Truth | Criticality |
|---|---|---:|---|---|
| Case summary cache | `case-read-cache` | String/JSON | PostgreSQL | performance only |
| Dashboard cache | `case-dashboard-cache` | String/JSON | PostgreSQL/search read model | performance only |
| Idempotency store | `command-idempotency` | Hash/String | Redis temporary + DB audit final | correctness helper |
| Rate limiter | `api-enforcement` | String/ZSet/Lua | Redis temporary | enforcement helper |
| Workflow transient state | `workflow-ui-state` | Hash/JSON | Redis temporary | UX helper |
| Processing lease | `case-worker-coordination` | String + token | DB final state | coordination helper |
| Invalidation Pub/Sub | `cache-invalidation` | Pub/Sub | DB/event mutation | notification only |

Yang perlu diperhatikan:

- Redis cache capability boleh gagal tanpa membuat data salah.
- Redis idempotency/rate limiter failure perlu policy eksplisit: fail-open atau fail-closed.
- Redis lock/lease failure tidak boleh menjadi satu-satunya pelindung correctness.
- Source of truth harus disebutkan per capability.

---

## 6. Key Schema Design

Key schema bukan detail kecil. Key schema adalah public API internal ke Redis.

### 6.1 Key Naming Convention

Gunakan format:

```text
<env>:<service>:<bounded-context>:<entity-or-capability>:<version>:<identity>
```

Contoh:

```text
prod:case-enforcement:read-cache:case-summary:v1:case:CASE-123
prod:case-enforcement:read-cache:dashboard:v1:tenant:TENANT-9:filter:open
prod:case-enforcement:idempotency:command:v1:tenant:TENANT-9:key:abc123
prod:case-enforcement:rate-limit:v1:tenant:TENANT-9:route:create-case:window:2026-06-20T10:15
prod:case-enforcement:workflow-ui:v1:user:U-7:case:CASE-123:draft-action
prod:case-enforcement:lease:v1:case-processing:case:CASE-123
```

Namun key terlalu panjang juga punya memory cost. Untuk production high-volume, kita bisa lebih ringkas:

```text
p:ces:rc:cs:v1:CASE-123
p:ces:idem:cmd:v1:TENANT-9:abc123
p:ces:rl:v1:TENANT-9:create-case:20260620T1015
```

Trade-off:

- key panjang lebih readable;
- key pendek lebih hemat memory;
- key terlalu pendek sulit di-debug;
- key terlalu panjang mahal pada skala jutaan key.

### 6.2 Recommended Compromise

Untuk service Java production, gunakan prefix cukup readable tapi tidak verbose berlebihan:

```text
ces:{tenantId}:case-summary:v1:{caseId}
ces:{tenantId}:dashboard:v1:{dashboardKeyHash}
ces:{tenantId}:idem:v1:{idempotencyKey}
ces:{tenantId}:rl:v1:{route}:{window}
ces:{tenantId}:workflow-draft:v1:{userId}:{caseId}
ces:{tenantId}:lease:v1:case:{caseId}
```

Perhatikan `{tenantId}`.

Dalam Redis Cluster, hash tag `{tenantId}` bisa membuat key tenant tertentu colocated dalam slot yang sama. Ini bisa membantu beberapa operasi multi-key, tetapi juga bisa menciptakan hot slot jika tenant besar. Jadi pemakaian hash tag harus sadar konsekuensi.

### 6.3 Key Schema Registry

Buat file dokumentasi internal:

```text
docs/redis-key-registry.md
```

Isi minimal:

| Key Pattern | Type | TTL | Owner | Description | Source of Truth | Cardinality Bound |
|---|---:|---:|---|---|---|---:|
| `ces:{tenant}:case-summary:v1:{caseId}` | String JSON | 5m + jitter | CaseSummaryCache | case summary cache | PostgreSQL | number of active cases |
| `ces:{tenant}:idem:v1:{key}` | Hash | 24h | IdempotencyStore | command idempotency state | request + DB audit | requests/day |
| `ces:{tenant}:rl:v1:{route}:{window}` | String/Hash/ZSet | window+buffer | TenantRateLimiter | quota enforcement | policy config | tenants × routes × windows |
| `ces:{tenant}:workflow-draft:v1:{user}:{case}` | Hash/JSON | 30m | WorkflowDraftStore | UI transient state | none/transient | active users × drafts |
| `ces:{tenant}:lease:v1:case:{case}` | String | 30s | ProcessingLeaseStore | short lease | DB final state | active jobs |

Key registry mencegah Redis berubah menjadi landfill.

---

## 7. Serialization Policy

### 7.1 Jangan Pakai Java Native Serialization

Hindari Java native serialization untuk value Redis.

Alasannya:

1. format tidak nyaman di-debug;
2. rawan compatibility issue;
3. class/package rename bisa merusak deserialization;
4. payload sering besar;
5. security risk jika tidak dikontrol;
6. sulit dipakai lintas service/language.

### 7.2 Recommended Default

Untuk kebanyakan service:

- key: UTF-8 string;
- value: JSON dengan schema version;
- datetime: ISO-8601 atau epoch millis, konsisten;
- enum: string stable name, bukan ordinal;
- money/decimal: string decimal atau minor unit integer;
- ID: string canonical;
- binary/protobuf: hanya jika ada alasan kuat.

Contoh cache value:

```json
{
  "schemaVersion": 1,
  "caseId": "CASE-123",
  "tenantId": "TENANT-9",
  "status": "UNDER_REVIEW",
  "riskLevel": "HIGH",
  "assignedOfficerId": "U-77",
  "lastUpdatedAt": "2026-06-20T10:15:30Z",
  "cachedAt": "2026-06-20T10:16:01Z"
}
```

### 7.3 Java DTO

```java
public record CaseSummaryCacheValue(
    int schemaVersion,
    String caseId,
    String tenantId,
    String status,
    String riskLevel,
    String assignedOfficerId,
    Instant lastUpdatedAt,
    Instant cachedAt
) {}
```

### 7.4 Versioning Rule

Redis cache value harus dianggap disposable, tetapi bukan berarti boleh sembarangan.

Rules:

1. Tambah field boleh.
2. Hapus field hati-hati.
3. Rename field sebaiknya naikkan key version.
4. Ubah semantic field naikkan key version.
5. Ubah serializer naikkan key version.
6. Jangan bergantung pada cache lama untuk correctness.

Contoh:

```text
ces:{tenant}:case-summary:v1:{caseId}
ces:{tenant}:case-summary:v2:{caseId}
```

Jika schema berubah besar, deploy v2 reader/writer dan biarkan v1 expired natural.

---

## 8. Redis Client Infrastructure di Java

### 8.1 Pilihan Stack

Untuk lab ini, kita gunakan Spring Boot + Spring Data Redis + Lettuce.

Kenapa?

1. Lettuce mendukung sync/async/reactive.
2. Lettuce umum dipakai di Spring ecosystem.
3. Spring Data Redis memberi `RedisTemplate`, `StringRedisTemplate`, scripting integration, cache abstraction, dan listener container.
4. Kita tetap bisa membungkusnya agar domain code tidak tergantung langsung pada template.

### 8.2 Dependency Contoh

Maven:

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>

    <dependency>
        <groupId>io.micrometer</groupId>
        <artifactId>micrometer-registry-prometheus</artifactId>
    </dependency>

    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>testcontainers</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

### 8.3 Configuration Principles

Yang harus dikonfigurasi eksplisit:

- host/port atau sentinel/cluster config;
- TLS jika applicable;
- username/password/ACL;
- command timeout;
- connect timeout;
- client name;
- pooling jika memakai blocking/sync heavy operations;
- read-from policy jika replica reads dipakai;
- metrics;
- serialization.

Contoh konsep config:

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      timeout: 200ms
      client-name: case-enforcement-service

app:
  redis:
    cache:
      case-summary-ttl: 5m
      dashboard-ttl: 30s
    idempotency:
      ttl: 24h
    rate-limit:
      fail-open: false
    lease:
      ttl: 30s
```

Catatan penting:

- timeout Redis tidak boleh terlalu tinggi;
- timeout harus lebih kecil dari HTTP request budget;
- retry harus dibatasi;
- Redis failure tidak boleh membuat thread pool Java habis menunggu.

---

## 9. Capability 1 — CaseSummaryCache

### 9.1 Contract

`CaseSummaryCache` menyimpan hasil baca `CaseSummary`.

Source of truth: PostgreSQL.

Redis hanya mempercepat read path.

Contract:

1. cache hit boleh dipakai jika belum expired;
2. cache miss load dari repository;
3. cache failure tidak boleh menggagalkan request read jika DB tersedia;
4. stale maksimum kira-kira TTL;
5. mutation path harus publish invalidation signal;
6. cache value tidak boleh dipakai sebagai audit evidence.

### 9.2 Interface

```java
public interface CaseSummaryCache {
    Optional<CaseSummary> get(CaseId caseId);

    CaseSummary getOrLoad(CaseId caseId, Supplier<CaseSummary> loader);

    void put(CaseSummary summary);

    void evict(CaseId caseId);
}
```

### 9.3 Key Builder

```java
@Component
public final class RedisKeys {

    private static final String SERVICE_PREFIX = "ces";

    public String caseSummary(String tenantId, String caseId) {
        return SERVICE_PREFIX + ":" + tenantId + ":case-summary:v1:" + caseId;
    }

    public String dashboard(String tenantId, String dashboardHash) {
        return SERVICE_PREFIX + ":" + tenantId + ":dashboard:v1:" + dashboardHash;
    }

    public String idempotency(String tenantId, String idempotencyKey) {
        return SERVICE_PREFIX + ":" + tenantId + ":idem:v1:" + idempotencyKey;
    }

    public String rateLimit(String tenantId, String route, String window) {
        return SERVICE_PREFIX + ":" + tenantId + ":rl:v1:" + route + ":" + window;
    }

    public String workflowDraft(String tenantId, String userId, String caseId) {
        return SERVICE_PREFIX + ":" + tenantId + ":workflow-draft:v1:" + userId + ":" + caseId;
    }

    public String processingLease(String tenantId, String caseId) {
        return SERVICE_PREFIX + ":" + tenantId + ":lease:v1:case:" + caseId;
    }
}
```

Key builder adalah boundary penting.

Jangan biarkan string key dibuat tersebar di codebase.

### 9.4 Cache Implementation Skeleton

```java
@Component
public class RedisCaseSummaryCache implements CaseSummaryCache {

    private final StringRedisTemplate redis;
    private final RedisKeys keys;
    private final ObjectMapper objectMapper;
    private final Duration ttl;
    private final Random jitter = new Random();

    public RedisCaseSummaryCache(
            StringRedisTemplate redis,
            RedisKeys keys,
            ObjectMapper objectMapper
    ) {
        this.redis = redis;
        this.keys = keys;
        this.objectMapper = objectMapper;
        this.ttl = Duration.ofMinutes(5);
    }

    @Override
    public Optional<CaseSummary> get(CaseId caseId) {
        String key = keys.caseSummary(caseId.tenantId(), caseId.value());

        try {
            String raw = redis.opsForValue().get(key);
            if (raw == null) {
                return Optional.empty();
            }
            return Optional.of(decode(raw));
        } catch (Exception e) {
            // cache read failure should not break read path by default
            // metric: redis.cache.case_summary.error
            return Optional.empty();
        }
    }

    @Override
    public CaseSummary getOrLoad(CaseId caseId, Supplier<CaseSummary> loader) {
        return get(caseId).orElseGet(() -> {
            CaseSummary loaded = loader.get();
            put(loaded);
            return loaded;
        });
    }

    @Override
    public void put(CaseSummary summary) {
        String key = keys.caseSummary(summary.tenantId(), summary.caseId());
        try {
            String raw = encode(summary);
            redis.opsForValue().set(key, raw, ttlWithJitter(ttl));
        } catch (Exception e) {
            // write miss is acceptable for performance cache
            // metric: redis.cache.case_summary.put_error
        }
    }

    @Override
    public void evict(CaseId caseId) {
        String key = keys.caseSummary(caseId.tenantId(), caseId.value());
        try {
            redis.delete(key);
        } catch (Exception e) {
            // metric: redis.cache.case_summary.evict_error
        }
    }

    private Duration ttlWithJitter(Duration base) {
        long jitterSeconds = jitter.nextLong(30); // 0..29 seconds
        return base.plusSeconds(jitterSeconds);
    }

    private String encode(CaseSummary summary) throws JsonProcessingException {
        CaseSummaryCacheValue value = CaseSummaryCacheValue.from(summary, Instant.now());
        return objectMapper.writeValueAsString(value);
    }

    private CaseSummary decode(String raw) throws JsonProcessingException {
        CaseSummaryCacheValue value = objectMapper.readValue(raw, CaseSummaryCacheValue.class);
        if (value.schemaVersion() != 1) {
            throw new IllegalStateException("Unsupported cache schema version: " + value.schemaVersion());
        }
        return value.toDomain();
    }
}
```

### 9.5 Why TTL Jitter?

Jika ribuan key dibuat bersamaan dengan TTL sama persis, mereka bisa expired bersamaan.

Itu menghasilkan:

1. cache stampede;
2. spike DB;
3. latency tinggi;
4. cascading failure.

Jitter menyebarkan expiration.

---

## 10. Capability 2 — Negative Cache

Negative cache menyimpan fakta bahwa data tidak ditemukan.

Contoh:

```text
case CASE-404 does not exist
```

Tanpa negative cache, attacker atau buggy client bisa membuat sistem terus query DB untuk ID yang tidak ada.

### 10.1 Contract

1. negative cache TTL harus pendek;
2. tidak boleh menyimpan negative result terlalu lama jika entity bisa dibuat segera;
3. mutation create harus evict negative key;
4. negative cache value harus dibedakan dari positive value.

### 10.2 Value Envelope

```json
{
  "schemaVersion": 1,
  "kind": "NOT_FOUND",
  "caseId": "CASE-404",
  "cachedAt": "2026-06-20T10:20:00Z"
}
```

Atau bisa gunakan key terpisah:

```text
ces:TENANT-9:case-summary-not-found:v1:CASE-404
```

Keduanya valid.

Untuk simplicity, key terpisah sering lebih aman.

---

## 11. Capability 3 — Dashboard Cache

Dashboard cache berbeda dari entity cache.

Entity cache:

```text
caseId -> case summary
```

Dashboard cache:

```text
filter/sort/page/tenant/user permissions -> list result
```

Dashboard cache lebih berisiko karena:

1. key cardinality mudah meledak;
2. filter kombinasi banyak;
3. permission context bisa berubah;
4. stale dashboard bisa membingungkan user;
5. invalidation sulit.

### 11.1 Key Design

Jangan masukkan query raw panjang ke key.

Buat canonical query descriptor lalu hash.

```java
public record DashboardQueryKey(
    String tenantId,
    String userRole,
    String status,
    String sort,
    int page,
    int size
) {
    public String canonical() {
        return "tenant=" + tenantId
            + "|role=" + userRole
            + "|status=" + status
            + "|sort=" + sort
            + "|page=" + page
            + "|size=" + size;
    }
}
```

Hash:

```java
String hash = sha256(queryKey.canonical()).substring(0, 24);
String key = keys.dashboard(queryKey.tenantId(), hash);
```

### 11.2 TTL

Dashboard list biasanya lebih pendek:

```text
15s - 60s
```

Karena dashboard adalah aggregate view yang sering berubah.

### 11.3 Invalidation Strategy

Ada 3 pilihan:

1. short TTL only;
2. event-driven invalidation;
3. versioned namespace.

Untuk dashboard, sering paling aman:

- short TTL;
- plus namespace version per tenant.

Contoh:

```text
ces:TENANT-9:dashboard-version:v1 = 42
ces:TENANT-9:dashboard:v1:42:<queryHash>
```

Saat case berubah:

```text
INCR ces:TENANT-9:dashboard-version:v1
```

Dengan begitu, cache lama tidak perlu dihapus satu per satu. Ia akan expired natural.

Trade-off:

- mudah invalidasi;
- cache churn lebih tinggi;
- perlu satu extra GET untuk version;
- bisa jadi hot key untuk tenant besar.

---

## 12. Capability 4 — IdempotencyStore

Idempotency dibutuhkan untuk command mutasi.

Contoh command:

```http
POST /cases/{caseId}/transitions
Idempotency-Key: abc123
```

Request body:

```json
{
  "action": "ESCALATE",
  "reason": "threshold exceeded"
}
```

### 12.1 Contract

Idempotency store harus menjawab:

1. apakah command baru boleh mulai?
2. apakah command yang sama sedang diproses?
3. apakah command sudah selesai dan response bisa direplay?
4. apakah key sama dipakai untuk payload berbeda?
5. apa yang terjadi jika processing mati di tengah?

### 12.2 State Machine

```text
ABSENT
  │
  │ tryStart(fingerprint)
  v
STARTED
  │
  ├── complete(responseRef/summary) ──> COMPLETED
  │
  ├── fail(retryable?) ───────────────> FAILED
  │
  └── TTL expires ───────────────────> ABSENT/UNKNOWN
```

### 12.3 Redis Representation

Gunakan Hash:

```text
key: ces:TENANT-9:idem:v1:abc123

type: Hash
fields:
  status = STARTED | COMPLETED | FAILED
  fingerprint = sha256(canonical request body + route + tenant + actor)
  startedAt = epoch millis
  completedAt = epoch millis
  responseCode = 200
  responseBody = small JSON or response reference
  errorCode = optional
```

TTL: misalnya 24 jam.

### 12.4 Atomic Start with Lua

Kita butuh atomic logic:

- jika key absent, create STARTED;
- jika key exists dengan fingerprint sama, return existing status;
- jika key exists dengan fingerprint beda, reject conflict.

Pseudo Lua:

```lua
local key = KEYS[1]
local fingerprint = ARGV[1]
local now = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])

local existingStatus = redis.call('HGET', key, 'status')

if not existingStatus then
  redis.call('HSET', key,
    'status', 'STARTED',
    'fingerprint', fingerprint,
    'startedAt', now
  )
  redis.call('EXPIRE', key, ttlSeconds)
  return {'STARTED_NEW'}
end

local existingFingerprint = redis.call('HGET', key, 'fingerprint')

if existingFingerprint ~= fingerprint then
  return {'CONFLICT', existingStatus}
end

return {'EXISTING', existingStatus}
```

### 12.5 Java Interface

```java
public interface IdempotencyStore {
    StartResult tryStart(IdempotencyCommand command);

    void complete(IdempotencyKey key, CommandResponse response);

    void fail(IdempotencyKey key, FailureInfo failure);
}
```

### 12.6 Design Warning

Jangan simpan response body besar di Redis.

Untuk response besar:

- simpan response summary kecil; atau
- simpan reference ke DB row; atau
- recompute safe response dari source of truth.

Idempotency Redis adalah control plane sementara, bukan archive.

---

## 13. Capability 5 — TenantRateLimiter

Rate limiter Redis harus didesain sebagai enforcement system.

### 13.1 Contract

Input:

```text
tenantId, route, actor, cost, now
```

Output:

```text
allowed / rejected
remaining quota
retryAfter
limit policy
```

### 13.2 Algorithm Choice

Untuk lab, gunakan token bucket dengan Lua.

Kenapa?

- smooth dibanding fixed window;
- atomic refill + consume;
- bisa support cost per request;
- bisa return remaining token;
- cocok untuk Redis.

### 13.3 Key

```text
ces:{tenantId}:rl:v1:{route}
```

Fields:

```text
tokens
lastRefillMillis
```

TTL:

```text
long enough to clean inactive tenants/routes
```

Misalnya:

```text
2 × time needed to refill full bucket
```

### 13.4 Fail-Open vs Fail-Closed

Ini keputusan penting.

Untuk public API enforcement:

- fail-closed lebih aman terhadap abuse;
- fail-open lebih menjaga availability.

Untuk sistem regulatori internal:

- route baca mungkin fail-open;
- route mutasi sensitif mungkin fail-closed atau degrade dengan local emergency limiter;
- keputusan harus tertulis di ADR.

### 13.5 Result Object

```java
public record RateLimitDecision(
    boolean allowed,
    long limit,
    long remaining,
    Duration retryAfter,
    String policyId
) {}
```

### 13.6 Observability

Metrics wajib:

```text
redis.rate_limit.allowed.count{tenant, route}
redis.rate_limit.rejected.count{tenant, route}
redis.rate_limit.redis_error.count{route}
redis.rate_limit.lua_latency
redis.rate_limit.fail_open.count
redis.rate_limit.fail_closed.count
```

Untuk cardinality, jangan selalu label tenant jika tenant banyak. Bisa label tenant tier atau hash bucket.

---

## 14. Capability 6 — WorkflowTransientStateStore

Workflow UI sering butuh state sementara:

- draft form;
- selected action;
- temporary validation result;
- wizard progress;
- optimistic UI handoff.

Redis cocok untuk transient state jika:

1. state boleh hilang;
2. TTL jelas;
3. bukan audit trail;
4. bukan source of truth;
5. ukuran kecil.

### 14.1 Key

```text
ces:{tenant}:workflow-draft:v1:{userId}:{caseId}
```

### 14.2 Redis Type

Pilihan:

- Hash untuk field kecil dan partial update;
- JSON/String untuk complex object.

Gunakan Hash jika field stabil:

```text
action = ESCALATE
reasonDraft = ...
lastEditedAt = ...
validationStatus = PENDING
```

TTL: 30 menit sampai 2 jam, tergantung UX.

### 14.3 Contract

1. transient state tidak boleh dianggap final;
2. submit command harus membaca request body final, bukan Redis draft secara buta;
3. Redis draft boleh membantu UX, bukan compliance;
4. sensitive text harus dipertimbangkan: apakah boleh disimpan di Redis? apakah encrypted at rest? apakah ACL cukup?

---

## 15. Capability 7 — ProcessingLeaseStore

Kita butuh mencegah dua worker memproses case yang sama secara bersamaan.

Redis lock/lease bisa membantu, tetapi tidak cukup untuk correctness absolut.

### 15.1 Contract

Lease:

1. punya token unik;
2. punya TTL pendek;
3. release hanya jika token cocok;
4. renewal harus eksplisit;
5. worker harus siap kehilangan lease;
6. final write ke DB harus tetap punya guard.

### 15.2 Key

```text
ces:{tenant}:lease:v1:case:{caseId}
```

Value:

```json
{
  "token": "uuid",
  "owner": "worker-12",
  "startedAt": "...",
  "fencingToken": 9182
}
```

Untuk fencing token, Redis bisa membantu menghasilkan monotonic counter:

```text
INCR ces:{tenant}:lease-fence:v1:case:{caseId}
```

Tetapi final enforcement harus ada di DB/resource target.

Contoh DB update:

```sql
UPDATE case_processing_state
SET status = 'PROCESSED', last_fencing_token = :token
WHERE case_id = :caseId
  AND last_fencing_token < :token;
```

Atau gunakan optimistic version di DB.

### 15.3 Safe Unlock Lua

```lua
local key = KEYS[1]
local expected = ARGV[1]

if redis.call('GET', key) == expected then
  return redis.call('DEL', key)
else
  return 0
end
```

### 15.4 Design Warning

Redis lease tidak melindungi dari:

1. GC pause lebih lama dari TTL;
2. network partition;
3. Redis failover dengan lost write;
4. process yang lanjut bekerja setelah lease expired;
5. external resource yang tidak mengenal fencing.

Karena itu, lock adalah optimization/coordination helper, bukan correctness root.

---

## 16. Capability 8 — Cache Invalidation Pub/Sub

Kita bisa publish invalidation signal setelah case berubah.

### 16.1 Event

```json
{
  "type": "CASE_CHANGED",
  "tenantId": "TENANT-9",
  "caseId": "CASE-123",
  "changedAt": "2026-06-20T10:40:00Z",
  "sourceInstance": "case-enforcement-service-7"
}
```

Channel:

```text
ces:cache-invalidation:v1
```

### 16.2 Contract

Pub/Sub invalidation is best-effort.

Artinya:

1. subscriber yang down bisa miss event;
2. message tidak durable;
3. TTL tetap dibutuhkan;
4. mutation path boleh evict local key langsung;
5. invalidation signal mempercepat consistency, bukan satu-satunya mekanisme.

### 16.3 Flow

```text
command success in DB
    ↓
evict local relevant Redis keys if known
    ↓
publish invalidation message
    ↓
other instances receive
    ↓
evict local in-memory cache / Redis key if needed
```

Jika sudah memakai Redis sebagai shared cache, Pub/Sub sering dipakai untuk local in-memory cache invalidation, bukan Redis cache invalidation saja.

---

## 17. Degraded Mode Design

Redis akan gagal. Desain harus menyebutkan apa yang terjadi.

### 17.1 Failure Matrix

| Capability | Redis Down Behavior | Reason |
|---|---|---|
| CaseSummaryCache | bypass Redis, read DB | cache performance only |
| DashboardCache | bypass Redis, read DB/search | cache performance only |
| NegativeCache | bypass Redis | correctness not dependent |
| IdempotencyStore | reject or DB fallback | mutating operation correctness-sensitive |
| RateLimiter read route | maybe fail-open | availability preferred |
| RateLimiter mutating route | fail-closed or emergency local limiter | abuse/correctness risk |
| WorkflowTransientState | lose draft/degraded UX | transient only |
| ProcessingLease | use DB optimistic guard / skip worker | avoid duplicate critical work |
| Pub/Sub invalidation | rely on TTL | best-effort only |

### 17.2 Circuit Breaker

Redis failure harus cepat diketahui.

Pattern:

1. Redis command timeout pendek;
2. Redis errors dihitung;
3. jika error rate tinggi, buka circuit;
4. cache operations bypass sementara;
5. idempotency/rate limiter mengikuti fail policy;
6. emit alert.

Jangan biarkan setiap request mencoba Redis selama 2 detik lalu fallback. Itu akan membunuh latency.

### 17.3 Local Fallback Caution

Local cache fallback bisa membantu, tapi berbahaya jika:

1. data harus cross-instance consistent;
2. invalidation tidak ada;
3. memory lokal tidak dibatasi;
4. stale behavior tidak didefinisikan.

Gunakan local cache hanya untuk:

- reference data stable;
- short TTL;
- bounded size;
- non-critical read.

---

## 18. Observability Design

Production Redis layer harus menghasilkan metrics dari dua sisi:

1. Redis server metrics;
2. application Redis capability metrics.

### 18.1 Server Metrics

Monitor:

```text
used_memory
used_memory_rss
mem_fragmentation_ratio
maxmemory
maxmemory_policy
evicted_keys
expired_keys
keyspace_hits
keyspace_misses
connected_clients
blocked_clients
instantaneous_ops_per_sec
rejected_connections
latest_fork_usec
master_repl_offset / replica lag
slowlog length
latency events
commandstats
```

### 18.2 Application Metrics

Per capability:

```text
redis.cache.case_summary.hit
redis.cache.case_summary.miss
redis.cache.case_summary.error
redis.cache.case_summary.load_latency
redis.cache.dashboard.hit
redis.cache.dashboard.miss
redis.idempotency.started
redis.idempotency.replayed
redis.idempotency.conflict
redis.rate_limit.allowed
redis.rate_limit.rejected
redis.lease.acquire_success
redis.lease.acquire_conflict
redis.lease.release_failed_token_mismatch
redis.lua.error
redis.command.timeout
```

### 18.3 SLO-Oriented View

Jangan hanya punya Redis dashboard. Punya service view:

- Apakah Redis latency menaikkan p95/p99 API?
- Apakah cache hit ratio turun?
- Apakah DB load naik karena cache miss?
- Apakah eviction mulai terjadi?
- Apakah idempotency Redis error membuat command reject?
- Apakah rate limiter fail-open meningkat?

### 18.4 Alert Examples

Alert yang berguna:

```text
RedisMemoryNearLimit:
  used_memory / maxmemory > 85% for 10m

RedisEvictionsDetected:
  rate(evicted_keys[5m]) > 0

RedisCommandTimeoutSpike:
  redis.command.timeout rate > threshold

CacheHitRatioDrop:
  hit_ratio(case_summary) < 70% for 15m and traffic > baseline

RateLimiterRedisFailure:
  rate(redis.rate_limit.redis_error[5m]) > threshold

IdempotencyStoreFailure:
  any sustained error on mutation route
```

Alert buruk:

```text
Redis CPU > 50%
```

Tanpa konteks, alert seperti itu sering noisy.

---

## 19. Testing Strategy

### 19.1 Test Pyramid untuk Redis Layer

```text
┌──────────────────────────────────┐
│ Failure / chaos / failover tests  │  few, expensive
├──────────────────────────────────┤
│ Integration tests with Redis      │  important
├──────────────────────────────────┤
│ Contract tests for key/schema     │  important
├──────────────────────────────────┤
│ Unit tests for key builders/DTO   │  many, cheap
└──────────────────────────────────┘
```

### 19.2 Unit Tests

Test:

- key builder format;
- query canonicalization;
- TTL jitter bounds;
- serialization round-trip;
- schema version handling;
- fallback decision logic;
- rate limit policy mapping.

Example:

```java
@Test
void caseSummaryKeyIncludesVersionAndTenant() {
    RedisKeys keys = new RedisKeys();

    String key = keys.caseSummary("TENANT-9", "CASE-123");

    assertThat(key).isEqualTo("ces:TENANT-9:case-summary:v1:CASE-123");
}
```

### 19.3 Integration Test with Testcontainers

```java
@Testcontainers
@SpringBootTest
class RedisCaseSummaryCacheIT {

    @Container
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:8"))
        .withExposedPorts(6379);

    @DynamicPropertySource
    static void redisProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    }

    @Autowired
    CaseSummaryCache cache;

    @Test
    void storesAndReadsCaseSummary() {
        CaseSummary summary = sampleSummary();

        cache.put(summary);

        assertThat(cache.get(new CaseId(summary.tenantId(), summary.caseId())))
            .contains(summary);
    }
}
```

### 19.4 TTL Test

Avoid brittle sleep tests when possible.

But for expiration behavior, small integration test is acceptable:

```java
@Test
void expiresWorkflowDraft() throws InterruptedException {
    store.saveDraft(draft, Duration.ofMillis(200));

    assertThat(store.getDraft(draft.id())).isPresent();

    await().atMost(Duration.ofSeconds(2))
        .untilAsserted(() -> assertThat(store.getDraft(draft.id())).isEmpty());
}
```

### 19.5 Concurrency Test for Idempotency

Goal: only one request starts new processing.

```java
@Test
void onlyOneConcurrentRequestStartsIdempotentCommand() throws Exception {
    int threads = 20;
    ExecutorService executor = Executors.newFixedThreadPool(threads);
    CountDownLatch start = new CountDownLatch(1);

    List<Future<StartResult>> futures = IntStream.range(0, threads)
        .mapToObj(i -> executor.submit(() -> {
            start.await();
            return idempotencyStore.tryStart(command);
        }))
        .toList();

    start.countDown();

    List<StartResult> results = futures.stream()
        .map(this::getUnchecked)
        .toList();

    assertThat(results.stream().filter(StartResult::isNewStart).count()).isEqualTo(1);
}
```

### 19.6 Failure Injection Tests

Test behavior when Redis unavailable:

- cache should bypass;
- idempotency should reject or fallback as designed;
- rate limiter should fail-open/fail-closed as configured;
- lease acquire should fail safely.

Example pseudo:

```java
@Test
void cacheBypassesWhenRedisUnavailable() {
    redis.stop();

    CaseSummary result = caseSummaryCache.getOrLoad(caseId, () -> expectedFromDb);

    assertThat(result).isEqualTo(expectedFromDb);
}
```

---

## 20. Load Test Plan

Redis code yang benar secara unit test bisa tetap buruk secara produksi.

### 20.1 Load Dimensions

Test minimal:

1. cache hit-heavy workload;
2. cache miss-heavy workload;
3. hot key workload;
4. dashboard cardinality workload;
5. rate limiter high concurrency;
6. idempotency duplicate storm;
7. Redis timeout/failure during traffic;
8. DB load when cache disabled.

### 20.2 Questions Load Test Must Answer

1. Apa Redis p50/p95/p99 command latency?
2. Apa API p95/p99 dengan Redis sehat?
3. Apa API p95/p99 ketika Redis down?
4. Apa DB QPS saat cache hit ratio turun?
5. Apakah connection pool wait muncul?
6. Apakah memory naik linear sesuai estimasi?
7. Apakah eviction terjadi?
8. Apakah key cardinality sesuai budget?
9. Apakah retry memperburuk incident?

### 20.3 Anti-Goal

Jangan cuma benchmark Redis mentah:

```bash
redis-benchmark
```

Itu berguna sebagai baseline server, tapi tidak menjawab apakah service Java-mu benar.

Load test harus melalui application path.

---

## 21. Memory Budget Worksheet

Sebelum production, isi worksheet.

### 21.1 Example

| Capability | Estimated Keys | Avg Value Size | Avg Key Size | TTL | Estimated Memory |
|---|---:|---:|---:|---:|---:|
| Case summary cache | 500k | 1.5 KB | 60 B | 5m | ~900 MB+ overhead |
| Dashboard cache | 50k | 8 KB | 80 B | 30s | ~500 MB+ overhead |
| Idempotency | 2M/day active | 500 B | 80 B | 24h | ~1.5 GB+ overhead |
| Rate limiter | 100k | 100 B | 70 B | 10m | ~30 MB+ overhead |
| Workflow drafts | 20k | 2 KB | 90 B | 1h | ~60 MB+ overhead |
| Leases | 5k | 100 B | 70 B | 30s | small |

Then apply multiplier:

```text
estimated logical payload × 1.5 to 3.0
```

Why multiplier?

Because Redis has overhead:

- key object overhead;
- value object overhead;
- allocator overhead;
- fragmentation;
- replication/persistence copy-on-write impact;
- cluster overhead;
- client output buffer risk.

### 21.2 Capacity Rule of Thumb

Do not run Redis at 95% memory.

Leave headroom for:

1. traffic spikes;
2. expiration delay;
3. fragmentation;
4. AOF/RDB rewrite copy-on-write;
5. failover/restart behavior;
6. deployment mistakes.

A safer planning range:

```text
normal used_memory <= 60% - 70% of maxmemory
alert around 80% - 85%
urgent above 90%
```

Exact number depends on workload and persistence.

---

## 22. Latency Budget Worksheet

Example API budget:

```text
GET /cases/{caseId}/summary
SLO: p95 < 150ms
```

Budget:

| Component | Budget |
|---|---:|
| HTTP ingress/filter | 5ms |
| auth/session | 10ms |
| Redis cache GET | 5ms |
| DB fallback if miss | 80ms |
| serialization/mapping | 10ms |
| response write | 10ms |
| buffer | 30ms |

Redis timeout should not be 1 second.

For cache read:

```text
Redis cache GET timeout: 20ms-50ms depending environment
```

For critical idempotency/rate limiter:

```text
Redis timeout may be slightly higher, but still bounded
```

Retry policy:

- no retry for cache GET in request path;
- limited retry maybe for idempotency if safe and fast;
- never unbounded retry;
- jittered retry for background jobs.

---

## 23. Security Checklist

For this lab, production Redis must satisfy:

1. Redis not exposed publicly;
2. network restricted by security group/firewall/Kubernetes NetworkPolicy;
3. TLS enabled if traffic crosses untrusted boundary;
4. ACL user per application/service;
5. least privilege command category if feasible;
6. dangerous commands unavailable to app user;
7. credentials in secret manager;
8. password rotation plan;
9. no sensitive PII in Redis unless approved;
10. value encryption considered for sensitive transient state;
11. logs do not print Redis credentials or sensitive cached payload;
12. `KEYS` not used in production paths;
13. admin access audited.

Example ACL intent:

```text
app user can GET/SET/DEL/EXPIRE/HGET/HSET/EVAL for owned prefixes only
app user cannot FLUSHALL/CONFIG/SHUTDOWN/MODULE
```

Actual ACL design depends on Redis deployment and supported command/key pattern controls.

---

## 24. Runbook

### 24.1 Redis Latency Spike

Symptoms:

- API p95/p99 naik;
- Redis command timeout naik;
- slowlog bertambah;
- blocked clients mungkin naik;
- CPU/network mungkin naik.

Triage:

1. cek `SLOWLOG`;
2. cek `INFO commandstats`;
3. cek hot key/big key suspicion;
4. cek client connection count;
5. cek application deployment baru;
6. cek network latency;
7. cek persistence rewrite/fork activity;
8. cek Lua scripts lambat.

Immediate mitigation:

- bypass non-critical cache;
- disable problematic endpoint/pattern;
- reduce traffic via rate limit;
- rollback deploy;
- scale read path if architecture supports;
- split hot key or add local cache.

### 24.2 Memory Near Limit

Symptoms:

- `used_memory` mendekati `maxmemory`;
- eviction terjadi;
- latency naik;
- writes gagal jika `noeviction`;
- hit ratio berubah.

Triage:

1. cek keyspace cardinality per prefix;
2. cek TTL missing;
3. cek big keys;
4. cek new feature/deploy;
5. cek dashboard/query cardinality explosion;
6. cek idempotency TTL terlalu panjang;
7. cek workflow drafts tidak expire.

Mitigation:

- disable offending cache;
- reduce TTL;
- delete safe prefix carefully using scan batch, not keys;
- increase memory only jika root cause dipahami;
- add cardinality guard;
- patch code.

### 24.3 Redis Down

Expected behavior:

- cache bypass;
- DB load naik;
- idempotency/rate limiter follow policy;
- worker coordination degrade safely;
- alert fired.

Triage:

1. confirm Redis availability;
2. confirm app circuit breaker state;
3. check DB load because cache bypass;
4. check mutation error rate;
5. check fail-open/fail-closed metrics;
6. check recovery after Redis returns.

---

## 25. Architecture Decision Record

Buat ADR untuk Redis layer.

### ADR Template

```markdown
# ADR: Redis Usage in case-enforcement-service

## Status
Accepted

## Context
case-enforcement-service needs low-latency read acceleration, idempotency for mutating commands, tenant rate limiting, transient workflow UI state, and lightweight worker coordination.

## Decision
Use Redis as a bounded infrastructure capability, not as a primary database. Redis usage is restricted to documented capabilities:

1. CaseSummaryCache
2. DashboardCache
3. IdempotencyStore
4. TenantRateLimiter
5. WorkflowTransientStateStore
6. ProcessingLeaseStore
7. CacheInvalidation Pub/Sub

All Redis keys must be created through RedisKeys. All values must use explicit schema/versioned JSON unless an ADR-approved binary format is used. TTL is mandatory unless explicitly justified.

## Consequences
Positive:
- lower read latency;
- reduced DB load;
- central enforcement primitives;
- better duplicate request handling;
- consistent Redis governance.

Negative:
- additional operational dependency;
- Redis outage can affect rate limiting/idempotency;
- memory capacity must be managed;
- cache invalidation complexity;
- more integration tests required.

## Source of Truth
PostgreSQL and event/audit log remain source of truth for cases, workflow transitions, and compliance evidence. Redis is not authoritative for final business state.

## Failure Policy
- caches fail open by bypassing Redis;
- idempotency failure on mutating commands fails closed unless DB fallback is implemented;
- rate limiter policy differs by route sensitivity;
- processing lease failure skips or defers worker processing;
- Pub/Sub invalidation is best-effort, TTL remains required.

## Observability
Application emits Redis capability metrics. Platform monitors Redis server metrics. Alerts exist for memory pressure, eviction, command timeout, hit ratio drop, and critical capability failure.

## Review Date
Review after first production incident, major Redis upgrade, or high-cardinality feature addition.
```

---

## 26. Production Readiness Checklist

Before enabling Redis-backed capability in production:

### 26.1 Design

- [ ] Source of truth identified.
- [ ] Redis role explicitly stated.
- [ ] Fail-open/fail-closed policy decided.
- [ ] Data lifecycle/TTL defined.
- [ ] Key cardinality estimated.
- [ ] Memory budget estimated.
- [ ] Hot key risk reviewed.
- [ ] Cluster key constraints reviewed.
- [ ] Sensitive data classification reviewed.

### 26.2 Implementation

- [ ] Key builder centralized.
- [ ] Serializer versioned.
- [ ] Java native serialization avoided.
- [ ] Timeout configured.
- [ ] Retry bounded.
- [ ] Circuit breaker/degraded behavior implemented if needed.
- [ ] Metrics emitted.
- [ ] Lua scripts tested.
- [ ] No production path uses `KEYS`.
- [ ] No unbounded `HGETALL`/`SMEMBERS` on large keys.

### 26.3 Testing

- [ ] Unit tests for key schema.
- [ ] Serialization round-trip tests.
- [ ] Integration tests with real Redis.
- [ ] TTL tests.
- [ ] Concurrency tests for idempotency/locks.
- [ ] Redis down tests.
- [ ] Load tests for key workloads.
- [ ] Memory growth tested or modeled.

### 26.4 Operations

- [ ] Dashboard exists.
- [ ] Alerts exist.
- [ ] Runbook exists.
- [ ] Backup/recovery reviewed if persistence matters.
- [ ] ACL/security reviewed.
- [ ] Upgrade path known.
- [ ] Safe prefix cleanup procedure exists.

---

## 27. Common Review Questions

Dalam design review, tanyakan:

1. Apa Redis key pattern-nya?
2. Siapa owner key ini?
3. Berapa TTL-nya?
4. Apa yang terjadi saat key hilang?
5. Apa yang terjadi saat key stale?
6. Apa yang terjadi saat Redis down?
7. Apakah Redis menjadi source of truth?
8. Berapa cardinality maksimum?
9. Berapa memory estimate?
10. Apakah key ini bisa hot?
11. Apakah operation ini multi-key?
12. Apakah aman di Redis Cluster?
13. Apakah command ini bisa blocking/mahal?
14. Apakah value bisa membesar tanpa batas?
15. Apakah data ini sensitive?
16. Apakah ada observability?
17. Apakah ada test untuk concurrency/failure?
18. Apakah ada rollback plan?

Jika tim tidak bisa menjawab sebagian besar pertanyaan ini, Redis usage belum siap production.

---

## 28. Example Package Structure

```text
src/main/java/com/company/caseenforcement/

  redis/
    RedisKeys.java
    RedisObjectMapperConfig.java
    RedisClientConfig.java
    RedisCapabilityMetrics.java

  cache/
    CaseSummaryCache.java
    RedisCaseSummaryCache.java
    DashboardCache.java
    RedisDashboardCache.java

  idempotency/
    IdempotencyStore.java
    RedisIdempotencyStore.java
    IdempotencyLuaScripts.java
    IdempotencyState.java

  ratelimit/
    TenantRateLimiter.java
    RedisTenantRateLimiter.java
    RateLimitPolicy.java
    RateLimitDecision.java
    RateLimitLuaScripts.java

  workflow/
    WorkflowTransientStateStore.java
    RedisWorkflowTransientStateStore.java

  coordination/
    ProcessingLeaseStore.java
    RedisProcessingLeaseStore.java
    LeaseToken.java

  invalidation/
    CacheInvalidationPublisher.java
    RedisCacheInvalidationPublisher.java
    CacheInvalidationSubscriber.java
    CacheInvalidationMessage.java
```

Boundary yang sehat:

- `application` package tidak tahu detail Redis command;
- Redis package tidak tahu business workflow terlalu dalam;
- DTO Redis tidak sama mentah dengan entity JPA;
- metrics ada di setiap capability.

---

## 29. End-to-End Flow Example

### 29.1 Read Case Summary

```text
HTTP GET /cases/CASE-123/summary
  ↓
Application validates tenant/user access
  ↓
CaseSummaryCache.getOrLoad(caseId)
  ├── Redis hit → return summary
  └── Redis miss/error → fetch PostgreSQL → put Redis best-effort → return summary
```

Properties:

- Redis failure does not break read;
- DB remains source of truth;
- cache write is best-effort;
- metric records hit/miss/error.

### 29.2 Mutate Case with Idempotency

```text
HTTP POST /cases/CASE-123/transitions
Idempotency-Key: abc123
  ↓
compute request fingerprint
  ↓
IdempotencyStore.tryStart
  ├── STARTED_NEW → execute command
  ├── EXISTING COMPLETED → replay response
  ├── EXISTING STARTED → return 409/202 depending policy
  └── CONFLICT → return 409 idempotency key reused with different payload
  ↓
DB transaction persists transition + audit record
  ↓
IdempotencyStore.complete
  ↓
evict case summary cache
  ↓
publish invalidation signal
```

Properties:

- duplicate request safe;
- audit remains in DB;
- Redis helps control duplicate execution;
- stale cache invalidated;
- idempotency TTL bounds memory.

### 29.3 Worker Processing with Lease

```text
Worker receives job for CASE-123
  ↓
ProcessingLeaseStore.tryAcquire(caseId)
  ├── acquired(token/fence) → process
  └── not acquired → skip/defer
  ↓
DB update with optimistic/fencing guard
  ↓
release lease using token compare-delete
```

Properties:

- Redis reduces duplicate processing;
- DB guard remains final correctness boundary;
- lease expiry handled explicitly.

---

## 30. What Top Engineers Do Differently

Average Redis usage:

```text
Use Redis because it is fast.
```

Strong Redis usage:

```text
Use Redis because a specific access pattern benefits from bounded low-latency volatile state, and the failure behavior is explicitly safe.
```

Average Redis usage:

```text
Let's cache this object.
```

Strong Redis usage:

```text
This object has a read-heavy access pattern, source of truth remains PostgreSQL, stale tolerance is 5 minutes, invalidation happens on mutation, TTL has jitter, key cardinality is bounded by active cases, cache failure bypasses to DB, and memory budget is acceptable.
```

Average Redis usage:

```text
Use a distributed lock.
```

Strong Redis usage:

```text
Use a short Redis lease to reduce duplicate work, but final write uses DB optimistic guard/fencing because Redis lease can expire during GC pause or failover.
```

Average Redis usage:

```text
Store request IDs in Redis.
```

Strong Redis usage:

```text
Represent idempotency as a TTL-bound state machine with fingerprint conflict detection, completed response replay, failure policy, and audit source of truth elsewhere.
```

---

## 31. Lab Exercises

### Exercise 1 — Key Registry

Create `docs/redis-key-registry.md` for your current project.

Include:

- key pattern;
- Redis type;
- TTL;
- owner;
- source of truth;
- cardinality estimate;
- failure behavior.

### Exercise 2 — Cache Capability

Implement:

```java
CaseSummaryCache.getOrLoad()
```

Requirements:

- JSON schema version;
- TTL jitter;
- Redis failure fallback;
- metrics for hit/miss/error;
- integration test.

### Exercise 3 — Idempotency Store

Implement Lua-backed `tryStart`.

Test:

- first request starts;
- duplicate same payload returns existing;
- duplicate different payload conflicts;
- concurrent requests only one starts;
- TTL expires.

### Exercise 4 — Rate Limiter

Implement token bucket with Lua.

Test:

- consumes token;
- rejects when empty;
- refills over time;
- returns retry-after;
- handles high concurrency.

### Exercise 5 — Redis Down Drill

Stop Redis during integration test or local run.

Verify:

- read cache bypasses;
- command mutation behaves according to idempotency failure policy;
- rate limiter fail policy works;
- metrics/alerts fire.

### Exercise 6 — Memory Estimate

Estimate memory for 1 million case summary keys.

Consider:

- key length;
- value size;
- Redis object overhead;
- fragmentation multiplier;
- TTL distribution;
- maxmemory headroom.

---

## 32. Summary

A production-grade Redis layer is not a collection of Redis commands.

It is a governed subsystem.

The key lessons:

1. Redis capability should be explicit, not scattered utility usage.
2. Every key needs owner, schema, TTL, and cardinality estimate.
3. Redis should rarely be source of truth in business-critical regulatory workflows.
4. Cache failure should usually degrade to source of truth.
5. Idempotency and rate limiting need stronger failure policy than cache.
6. Distributed locks need fencing or DB/resource-side correctness guard.
7. Pub/Sub invalidation is best-effort; TTL remains necessary.
8. Observability must exist at server and application capability level.
9. Testing must include TTL, concurrency, Redis down, and load behavior.
10. Redis architecture must be documented with ADR and runbook.

The goal is not to use Redis everywhere.

The goal is to know exactly where Redis creates leverage, where it creates risk, and how to make that risk explicit, bounded, tested, and observable.

---

## 33. Completion Status

```text
Part 033 selesai.
Seri belum selesai.
Belum mencapai bagian terakhir.
Berikutnya: learn-redis-mastery-for-java-engineers-part-034.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-redis-mastery-for-java-engineers-part-032.md">⬅️ Part 032 — Redis Anti-Patterns and Failure Case Studies</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-redis-mastery-for-java-engineers-part-034.md">Part 034 — Final Mastery: Decision Framework, Review Checklist, and Interview-Grade Reasoning ➡️</a>
</div>
