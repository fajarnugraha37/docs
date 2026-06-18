# learn-java-deployment-runtime-release-delivery-engineering

## Part 27 — Multi-Service and Distributed Java Deployment

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Target: Java 8 sampai Java 25  
> Level: Advanced / Principal Engineer / Top 1% Deployment Reasoning  
> Fokus: deployment multi-service Java yang aman ketika sistem tidak lagi berubah sebagai satu unit tunggal.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya, kita sudah membahas deployment sebagai unit aplikasi: artifact, runtime, container, Kubernetes, database migration, stateful workload, observability, verification, CI/CD, supply chain, hardening, dan multi-environment.

Bagian ini naik satu lapis lagi: **deployment sebagai perubahan sistem terdistribusi**.

Di sistem sederhana, kita bisa berpikir:

```text
build app → deploy app → verify app → done
```

Di sistem distributed/microservices, itu terlalu dangkal. Realitanya:

```text
service A berubah
  tetapi service B masih versi lama
  service C sudah versi baru
  consumer mobile belum update
  queue masih berisi event format lama
  cache masih menyimpan value lama
  database sedang dalam fase expand-contract
  job scheduler masih memanggil endpoint lama
  canary hanya menerima 5% traffic
  rollback service A mungkin tidak kompatibel dengan event yang sudah diproduksi versi baru
```

Jadi pertanyaan deployment berubah dari:

> “Apakah service ini bisa start?”

menjadi:

> “Apakah seluruh sistem tetap benar ketika sebagian komponennya berubah dan sebagian lainnya belum berubah?”

Itulah inti Part 27.

---

## 1. Mental Model Utama: Deployment Distributed Bukan Event, Tapi Interval

Kesalahan umum engineer adalah membayangkan deployment sebagai titik waktu:

```text
Before deploy → Deploy → After deploy
```

Padahal dalam sistem terdistribusi, deployment adalah **interval koeksistensi versi**.

```text
T0: semua service versi lama
T1: service A mulai rolling update
T2: sebagian pod A lama, sebagian pod A baru
T3: service B belum berubah
T4: event baru mulai diproduksi
T5: consumer lama masih membaca event
T6: canary A dinaikkan ke 25%
T7: cache mulai berisi campuran value lama dan baru
T8: rollback mungkin terjadi
T9: seluruh sistem mencapai state stabil baru
```

Selama interval ini, sistem harus tetap memenuhi invariant bisnis dan teknis.

### 1.1 Invariant deployment multi-service

Untuk setiap perubahan service, engineer senior harus bertanya:

1. Apakah producer baru kompatibel dengan consumer lama?
2. Apakah consumer baru kompatibel dengan producer lama?
3. Apakah response lama masih bisa dibaca client baru?
4. Apakah response baru masih bisa diabaikan client lama?
5. Apakah event lama masih ada di queue/topic?
6. Apakah data lama masih ada di database/cache/object storage?
7. Apakah rollback menghasilkan format yang masih dipahami downstream?
8. Apakah deployment partial tetap aman?
9. Apakah service discovery/traffic routing bisa mengirim request ke versi campuran?
10. Apakah monitoring bisa membedakan masalah versi baru dari masalah sistemik?

Top 1% engineer tidak hanya bertanya “apakah code benar”, tetapi:

> “Apakah perubahan ini benar ketika dunia di sekitarnya belum ikut berubah?”

---

## 2. Apa yang Membuat Distributed Deployment Sulit?

Distributed deployment sulit karena ada banyak bentuk coupling yang tidak selalu terlihat di kode.

### 2.1 Runtime coupling

Service A memanggil Service B secara synchronous.

```text
ApplicationService → CaseService → DocumentService → NotificationService
```

Jika `DocumentService` berubah contract, `CaseService` bisa gagal walaupun `CaseService` tidak berubah.

### 2.2 Data coupling

Beberapa service membaca/menulis data yang terkait secara konseptual.

```text
Case Service owns case
Compliance Service references case
Audit Service records case activity
Report Service denormalizes case state
```

Deployment satu service bisa mengubah meaning field yang dipakai service lain.

### 2.3 Event coupling

Producer mengirim event, consumer menafsirkan event.

```text
CaseApprovedEvent v1
CaseApprovedEvent v2
CaseRejectedEvent v1
```

Perubahan field event dapat merusak consumer yang masih versi lama.

### 2.4 Temporal coupling

Satu service harus dideploy sebelum service lain.

```text
Deploy Auth Service first
then API Gateway
then Backend Services
then Frontend
```

Jika urutan salah, deployment gagal walau setiap artifact benar.

### 2.5 Operational coupling

Service berbagi:

- database;
- queue;
- cache;
- secret;
- certificate;
- identity provider;
- DNS;
- API gateway;
- ingress;
- service mesh;
- observability pipeline;
- rate limiter;
- scheduler.

Masalahnya bukan hanya dependency graph di source code, tetapi graph operasional runtime.

### 2.6 Organizational coupling

Microservices sering gagal bukan karena teknologi, tetapi karena tim berubah dengan kecepatan berbeda.

```text
Team A ready deploy today
Team B sprint freeze
Team C unavailable
External vendor has monthly release window
Agency UAT has fixed sign-off date
```

Deployment strategy harus menghormati realitas organisasi.

---

## 3. Deployment Unit vs Consistency Unit

Salah satu mental model paling penting:

> Deployment unit tidak selalu sama dengan consistency unit.

### 3.1 Deployment unit

Unit yang bisa dirilis secara teknis:

- satu JAR;
- satu WAR;
- satu container image;
- satu Kubernetes Deployment;
- satu Helm release;
- satu service;
- satu frontend bundle;
- satu database migration.

### 3.2 Consistency unit

Unit yang harus berubah bersama agar behavior sistem valid:

- API provider + API consumer;
- event producer + event consumer;
- backend + frontend;
- service + DB schema;
- service + cache key format;
- service + authorization policy;
- service + gateway route;
- service + monitoring dashboard;
- service + runbook.

Contoh:

```text
Deployment unit:
- case-service image v42

Consistency unit:
- case-service v42
- approval-service compatible with case status semantics
- report-service compatible with new status
- audit-service compatible with new activity code
- frontend dropdown includes new status
- database column supports new status
- dashboard recognizes new status
```

Jika engineer hanya mengelola deployment unit, ia bisa membuat sistem yang technically deployed tetapi semantically broken.

---

## 4. Version Skew: Kondisi Normal, Bukan Edge Case

**Version skew** adalah kondisi ketika beberapa bagian sistem berjalan dengan versi berbeda.

Di Kubernetes rolling update, version skew terjadi secara natural:

```text
case-service pod-1: v1
case-service pod-2: v1
case-service pod-3: v2
case-service pod-4: v2
```

Di distributed system, version skew lebih luas:

```text
Frontend: v3
API Gateway: v2
Auth Service: v2
Case Service: v5
Document Service: v4
Notification Service: v1
Mobile Client: v1, v2, v3 all active
Queue events: v1 and v2 mixed
```

Top engineer menganggap version skew sebagai desain normal.

### 4.1 Rule penting

> Jangan mendesain deployment yang hanya aman jika semua komponen berubah bersamaan secara sempurna.

Karena di production:

- rolling update butuh waktu;
- instance bisa restart ulang;
- consumer queue bisa tertinggal;
- mobile/external client tidak bisa dipaksa update;
- cache bisa menyimpan format lama;
- rollback bisa mengembalikan sebagian sistem;
- failover DR bisa menjalankan versi yang sedikit berbeda;
- blue-green bisa membuat dua environment aktif sebentar;
- canary memang sengaja membuat dua versi hidup bersama.

---

## 5. Compatibility Matrix

Distributed deployment harus dimodelkan sebagai compatibility matrix.

Misalnya Service A memanggil Service B.

| Caller | Callee | Aman? | Catatan |
|---|---:|---:|---|
| A v1 | B v1 | Ya | baseline |
| A v1 | B v2 | Harus ya | old caller to new provider |
| A v2 | B v1 | Harus ya untuk rolling/canary | new caller to old provider |
| A v2 | B v2 | Ya | target state |

Untuk perubahan synchronous API, idealnya semua kombinasi selama rollout aman.

Jika tidak bisa, deployment harus memakai strategi khusus:

- feature flag;
- dependency order ketat;
- gateway routing by version;
- endpoint baru paralel;
- canary isolated;
- blue-green full stack;
- temporary adapter;
- dual-read/dual-write;
- maintenance window.

### 5.1 Matrix untuk event

| Producer | Consumer | Event | Aman? |
|---|---:|---:|---:|
| P v1 | C v1 | E v1 | Ya |
| P v2 | C v1 | E v2 | Harus aman jika topic sama |
| P v1 | C v2 | E v1 | Harus aman selama backlog lama ada |
| P v2 | C v2 | E v2 | Target |

Event lebih sulit karena data lama bisa hidup lama di topic/queue.

### 5.2 Matrix untuk database

| App | DB Schema | Aman? |
|---|---:|---:|
| App v1 | Schema v1 | Ya |
| App v1 | Schema v2-expand | Harus ya |
| App v2 | Schema v2-expand | Ya |
| App v2 | Schema v3-contract | Ya setelah v1 hilang |
| App v1 | Schema v3-contract | Tidak boleh terjadi |

Ini alasan expand-contract pattern sangat penting.

---

## 6. API Compatibility: Cara Berpikir yang Benar

API compatibility bukan sekadar URL masih sama.

API contract meliputi:

- endpoint path;
- HTTP method;
- query parameter;
- header;
- request body schema;
- response body schema;
- status code;
- error format;
- pagination semantics;
- sorting semantics;
- idempotency semantics;
- authentication requirement;
- authorization scope;
- rate limit behavior;
- timeout expectation;
- retry safety;
- enum values;
- nullability;
- default value;
- field meaning.

### 6.1 Breaking change yang obvious

Contoh breaking change:

```diff
- GET /cases/{id}
+ GET /case/{id}
```

```diff
- "caseId": "C-001"
+ "id": "C-001"
```

```diff
- HTTP 200 with empty list
+ HTTP 404 when no result
```

### 6.2 Breaking change yang sering tidak disadari

#### Mengubah enum

```json
{
  "status": "APPROVED"
}
```

menjadi:

```json
{
  "status": "AUTO_APPROVED"
}
```

Consumer lama mungkin punya switch statement:

```java
switch (status) {
  case "APPROVED" -> handleApproved();
  case "REJECTED" -> handleRejected();
  default -> throw new IllegalStateException("Unknown status");
}
```

Field baru bisa aman, tetapi enum value baru sering tidak aman.

#### Mengubah meaning field

```json
{
  "amount": 1000
}
```

Dulu `amount` berarti dollar. Sekarang berarti cent.

Schema tidak berubah, tetapi behavior rusak.

#### Mengubah default sorting

Endpoint masih sama:

```text
GET /cases
```

Dulu sort by `createdDate desc`, sekarang `updatedDate desc`.

Consumer batch yang mengambil halaman bertahap bisa kehilangan atau menggandakan data.

#### Mengubah nullability

```diff
- "assignedOfficer": null allowed
+ "assignedOfficer": object required
```

Atau sebaliknya:

```diff
- always object
+ sometimes null
```

Banyak client gagal bukan karena field hilang, tetapi karena asumsi nullability berubah.

#### Mengubah error body

```json
{
  "code": "CASE_NOT_FOUND",
  "message": "Case not found"
}
```

menjadi:

```json
{
  "error": "not_found"
}
```

Error contract sering tidak diuji, padahal client banyak bergantung pada `code`.

---

## 7. Compatibility Rules untuk REST/HTTP API

### 7.1 Biasakan additive change

Perubahan relatif aman:

- menambah optional response field;
- menambah optional request field;
- menambah endpoint baru;
- menambah header optional;
- menambah enum hanya jika consumer tolerant;
- menambah pagination metadata optional;
- menambah error detail tanpa menghapus field lama.

Contoh aman:

```json
{
  "caseId": "C-001",
  "status": "PENDING",
  "assignedOfficer": "u123",
  "riskLevel": "HIGH"
}
```

Jika consumer lama hanya membaca `caseId` dan `status`, field `riskLevel` bisa diabaikan.

### 7.2 Hindari destructive change

Perubahan berbahaya:

- rename field;
- remove field;
- change type;
- change requiredness;
- change enum semantics;
- change status code behavior;
- change pagination semantics;
- change date/time format;
- change id format;
- change auth requirement mendadak;
- change error code;
- change idempotency.

### 7.3 Gunakan parallel endpoint bila perlu

Daripada mengubah endpoint lama:

```text
GET /cases/{id}
```

buat endpoint baru:

```text
GET /v2/cases/{id}
```

atau:

```text
GET /cases/{id}/detail
```

Tapi versioning bukan solusi ajaib. Ia menambah operational burden:

- dua contract harus dipelihara;
- dua dokumentasi;
- dua security policy;
- dua test suite;
- dua observability view;
- dua deprecation timeline.

### 7.4 Tolerant reader

Consumer harus membaca hanya yang dibutuhkan dan mengabaikan tambahan yang tidak dikenal.

Buruk:

```java
record CaseResponse(
    String caseId,
    String status
) {}
```

Ini bisa aman jika deserializer ignore unknown properties. Tetapi jika configured strict unknown fail, field tambahan bisa merusak.

Lebih defensif:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record CaseResponse(
    String caseId,
    String status
) {}
```

Namun tolerant reader bukan alasan untuk provider sembarang berubah. Ia hanya safety net.

---

## 8. API Versioning Strategy

Tidak ada satu strategi versioning yang selalu benar.

### 8.1 URI versioning

```text
/api/v1/cases
/api/v2/cases
```

Kelebihan:

- eksplisit;
- mudah routing di gateway;
- mudah logging;
- mudah contract testing;
- mudah deprecation.

Kekurangan:

- mendorong duplikasi API;
- kadang terlalu kasar;
- semua endpoint terlihat berubah walau hanya satu field berubah;
- client migration bisa lambat.

### 8.2 Header versioning

```http
GET /api/cases/C-001
Accept: application/vnd.company.case.v2+json
```

Kelebihan:

- URL stabil;
- lebih sesuai content negotiation;
- bisa versioning representation, bukan resource.

Kekurangan:

- lebih sulit dilihat manual;
- gateway/logging butuh awareness header;
- developer sering lupa test kombinasi header.

### 8.3 Query parameter versioning

```text
GET /api/cases/C-001?version=2
```

Kelebihan:

- sederhana;
- mudah test.

Kekurangan:

- bisa bercampur dengan domain query;
- cache/proxy behavior perlu hati-hati;
- kurang elegan untuk long-term API governance.

### 8.4 No explicit version, only backward-compatible evolution

Ini ideal untuk internal microservices yang matang:

- perubahan hanya additive;
- breaking change dilakukan lewat endpoint baru;
- consumer-driven contract kuat;
- observability tahu consumer mana pakai field apa;
- deprecation formal.

Kelebihan:

- lebih sederhana;
- tidak ada versi menumpuk.

Kekurangan:

- butuh disiplin tinggi;
- rawan hidden breaking change;
- sulit jika consumer eksternal tidak terkendali.

### 8.5 Decision guide

| Context | Strategi yang cocok |
|---|---|
| Public/external API | URI/header versioning + deprecation policy |
| Internal microservice mature | backward-compatible evolution + contract tests |
| API gateway-heavy enterprise | URI versioning lebih mudah dioperasikan |
| Representation berubah besar | header/media type versioning |
| Emergency compatibility | parallel endpoint sementara |
| Legacy client sulit update | long-lived v1 + adapter |

---

## 9. Consumer-Driven Contract dalam Deployment

Consumer-driven contract berarti contract tidak hanya ditentukan provider, tetapi divalidasi berdasarkan kebutuhan consumer.

Tanpa contract testing:

```text
Provider deploys change
Consumer breaks in production
```

Dengan contract testing:

```text
Consumer publishes expectation
Provider validates before deployment
Breaking change detected before release
```

### 9.1 Apa yang harus ditangkap contract test?

- endpoint path;
- method;
- required request fields;
- expected response fields;
- type;
- nullability;
- allowed status codes;
- error code;
- header penting;
- auth assumption;
- pagination structure.

### 9.2 Apa yang tidak cukup ditangkap schema saja?

Schema sering tidak menangkap:

- semantic meaning;
- ordering guarantee;
- idempotency;
- rate limit;
- timeout;
- data freshness;
- consistency model;
- authorization side effect;
- business invariant.

Karena itu contract test perlu dilengkapi dengan:

- integration test;
- synthetic transaction;
- business invariant check;
- observability assertion.

### 9.3 Contract test sebagai deployment gate

Pipeline provider sebaiknya melakukan:

```text
Build provider
Run provider unit tests
Run provider integration tests
Pull latest consumer contracts
Verify provider against contracts
If pass → publish deployable artifact
If fail → block deployment
```

Untuk service internal, contract test adalah salah satu cara terbaik mengurangi ketergantungan pada end-to-end test besar yang lambat dan rapuh.

---

## 10. Event-Driven Deployment

Event-driven architecture membuat deployment lebih fleksibel tetapi juga lebih berbahaya jika schema evolution buruk.

Synchronous call gagal cepat:

```text
HTTP 500 now
```

Event-driven failure bisa tertunda:

```text
Producer deploy today
Consumer fails tonight
Retry storm tomorrow
Dead letter grows for 3 days
Report wrong next week
```

### 10.1 Event contract

Event contract meliputi:

- topic/queue name;
- event name;
- event version;
- key;
- partitioning strategy;
- ordering guarantee;
- schema;
- required fields;
- optional fields;
- enum values;
- timestamp semantics;
- idempotency key;
- correlation id;
- causation id;
- producer identity;
- retry semantics;
- DLQ behavior;
- retention period.

### 10.2 Event schema change categories

Relatif aman:

- menambah optional field;
- menambah field dengan default;
- memperluas metadata;
- menambah event type baru jika consumer ignore unknown;
- menambah nullable field.

Berbahaya:

- rename field;
- remove field;
- change type;
- change enum meaning;
- change event key;
- change ordering guarantee;
- change topic;
- change requiredness;
- change timestamp meaning;
- change idempotency key;
- change business semantic.

### 10.3 Backward vs forward compatibility

Untuk event, dua arah compatibility penting.

Backward compatibility:

```text
Consumer baru bisa membaca event lama.
```

Ini penting karena topic/queue mungkin masih menyimpan event lama.

Forward compatibility:

```text
Consumer lama bisa membaca event baru.
```

Ini penting karena producer bisa deploy lebih dulu daripada consumer.

Full compatibility:

```text
Consumer lama/bharu bisa membaca event lama/baru.
```

Ini paling aman untuk rolling distributed deployment.

### 10.4 Jangan pikir event hilang setelah dikirim

Event bisa hidup lama:

- Kafka retention days/weeks/months;
- RabbitMQ queue backlog;
- DLQ replay;
- audit replay;
- batch reprocessing;
- report rebuild;
- new consumer bootstrap from old topic.

Artinya event schema yang buruk bisa menjadi hutang jangka panjang.

---

## 11. Event Versioning Pattern

### 11.1 Version field di payload

```json
{
  "eventType": "CaseApproved",
  "eventVersion": 2,
  "caseId": "C-001",
  "approvedAt": "2026-06-18T10:00:00Z"
}
```

Kelebihan:

- consumer bisa branching;
- mudah audit;
- event self-describing.

Kekurangan:

- semua consumer harus implement branching;
- version bisa disalahgunakan untuk breaking change terus-menerus.

### 11.2 Topic per major version

```text
case.approved.v1
case.approved.v2
```

Kelebihan:

- isolasi jelas;
- consumer bisa subscribe versi yang dipahami;
- cocok untuk breaking change besar.

Kekurangan:

- topic proliferation;
- producer harus publish ke dua topic selama migration;
- ordering antar topic tidak trivial.

### 11.3 Event type baru untuk semantic baru

Daripada mengubah `CaseApproved`, buat event baru:

```text
CaseAutoApproved
CaseManuallyApproved
```

Cocok jika meaning bisnis berubah.

### 11.4 Envelope stabil, payload evolvable

```json
{
  "eventId": "evt-123",
  "eventType": "CaseApproved",
  "schemaVersion": 2,
  "occurredAt": "2026-06-18T10:00:00Z",
  "correlationId": "corr-789",
  "payload": {
    "caseId": "C-001",
    "approvalMode": "AUTO"
  }
}
```

Envelope memberikan invariants observability dan idempotency.

Payload boleh evolve dengan aturan compatibility.

---

## 12. Event Consumer Deployment Safety

Consumer event harus dirancang agar aman saat deployment.

### 12.1 Idempotent consumer

Consumer bisa menerima message yang sama lebih dari sekali.

Pola aman:

```sql
CREATE TABLE processed_event (
  event_id VARCHAR(100) PRIMARY KEY,
  processed_at TIMESTAMP NOT NULL
);
```

Pseudo-code:

```java
@Transactional
public void consume(Event event) {
    if (processedEventRepository.exists(event.id())) {
        return;
    }

    applyBusinessEffect(event);
    processedEventRepository.insert(event.id());
}
```

Invariant:

> Retry, redeploy, rebalance, dan duplicate delivery tidak boleh menggandakan side effect.

### 12.2 Consumer harus tolerate old event

Consumer v2 harus bisa membaca backlog v1.

Buruk:

```java
String riskLevel = event.getRiskLevel();
if (riskLevel.equals("HIGH")) { ... }
```

Jika event lama tidak punya `riskLevel`, NPE.

Lebih aman:

```java
String riskLevel = Optional.ofNullable(event.getRiskLevel())
    .orElse("UNKNOWN");
```

### 12.3 Consumer harus tolerate unknown future fields

Deserializer sebaiknya tidak gagal hanya karena field tambahan.

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public class CaseApprovedEvent {
    public String eventId;
    public String caseId;
    public Instant approvedAt;
}
```

### 12.4 Consumer harus jelas terhadap unknown enum

Jangan default silent untuk enum bisnis kritikal.

Untuk enum status, dua pendekatan:

#### Fail-safe ignore

Cocok untuk event non-critical.

```java
if (!supportedStatus(status)) {
    log.warn("Unsupported status ignored: {}", status);
    return;
}
```

#### Fail-fast to DLQ

Cocok untuk event critical yang tidak boleh salah tafsir.

```java
if (!supportedStatus(status)) {
    throw new UnsupportedEventVersionException(status);
}
```

Keputusan harus domain-driven.

---

## 13. Deployment Order Pattern

Distributed deployment sering membutuhkan urutan.

### 13.1 Provider-first untuk additive API

Jika provider menambah field/endpoint optional:

```text
1. Deploy provider with backward-compatible addition
2. Verify old consumers still work
3. Deploy consumers that use new field
4. Later remove old behavior if safe
```

Contoh:

```text
Case Service adds riskLevel field
Frontend still ignores it
Report Service later starts reading riskLevel
```

### 13.2 Consumer-first untuk tolerant consumer

Jika event producer akan mengirim format baru:

```text
1. Deploy consumers that can read old and new format
2. Verify consumers handle both
3. Deploy producer that emits new format
4. Monitor DLQ/error rate
5. Remove old support later
```

Ini sering lebih aman untuk event-driven systems.

### 13.3 Database expand-contract order

```text
1. Expand schema: add nullable column/table/index
2. Deploy app that writes both old and new
3. Backfill old data
4. Deploy app that reads new
5. Stop writing old
6. Contract schema: remove old only after all old versions gone
```

### 13.4 Gateway-first atau gateway-last?

Tergantung perubahan.

Jika menambah route baru:

```text
1. Deploy backend endpoint
2. Verify internal endpoint
3. Deploy gateway route
4. Verify external access
```

Jika menghapus route lama:

```text
1. Verify no consumers
2. Communicate deprecation
3. Deploy gateway shadow log/block warning
4. Remove route later
```

### 13.5 Frontend-backend order

Jika backend menambah optional capability:

```text
1. Backend deploy first
2. Frontend deploy later
```

Jika frontend bisa call endpoint baru yang belum ada, maka frontend harus feature-flagged.

```text
1. Backend deploy endpoint hidden
2. Frontend deploy feature disabled
3. Enable feature flag after verification
```

---

## 14. Feature Flags dalam Distributed Deployment

Feature flag memisahkan deployment dari release.

```text
Deploy code now
Enable behavior later
```

### 14.1 Jenis feature flag

| Jenis | Tujuan |
|---|---|
| Release flag | menyembunyikan fitur baru |
| Experiment flag | A/B testing |
| Ops flag | mematikan behavior bermasalah |
| Permission flag | enable per role/tenant |
| Migration flag | mengontrol dual-read/write |
| Kill switch | emergency disable |

### 14.2 Distributed flag problem

Feature flag menjadi distributed control plane.

Risiko:

- service A melihat flag ON, service B masih OFF;
- cache flag stale;
- flag berubah di tengah transaksi;
- rollout per tenant tidak konsisten;
- audit tidak mencatat kapan flag berubah;
- rollback artifact tidak rollback flag;
- flag lama tidak pernah dihapus.

### 14.3 Rule untuk feature flag production

1. Flag harus punya owner.
2. Flag harus punya expiry/removal plan.
3. Flag critical harus audit perubahan.
4. Flag harus default aman jika config service down.
5. Flag migration harus diuji ON dan OFF.
6. Flag tidak boleh menyembunyikan schema incompatibility yang irreversible.
7. Flag state harus masuk deployment evidence.

### 14.4 Anti-pattern

```java
if (featureFlag.isEnabled("new-case-approval")) {
    writeNewSchemaOnly();
} else {
    writeOldSchemaOnly();
}
```

Jika flag toggle bolak-balik, data bisa split.

Lebih aman selama migration:

```java
writeOldSchema();
writeNewSchema();

if (featureFlag.isEnabled("read-new-case-approval")) {
    return readNewSchema();
}
return readOldSchema();
```

Dual-write dan read-switch harus dirancang hati-hati.

---

## 15. Traffic Routing dan Deployment Multi-Version

Dalam distributed Java deployment, traffic routing menentukan siapa melihat versi mana.

### 15.1 Routing by percentage

```text
95% traffic → v1
5% traffic → v2
```

Cocok untuk canary.

Risiko:

- user flow multi-request bisa berpindah versi;
- session state tidak compatible;
- cache warm berbeda;
- downstream impact sulit dibedakan;
- 5% traffic mungkin tidak mencakup semua scenario.

### 15.2 Routing by header

```http
X-Canary: true
```

Cocok untuk internal testing dan synthetic traffic.

### 15.3 Routing by user/tenant/ring

```text
Internal users → v2
Pilot tenant → v2
Low-risk tenant → v2
All users → v2
```

Cocok untuk enterprise rollout.

### 15.4 Routing by API version

```text
/api/v1/** → service-v1
/api/v2/** → service-v2
```

Cocok untuk long-lived compatibility.

### 15.5 Sticky routing

Untuk workflow multi-step:

```text
Step 1: create application
Step 2: upload document
Step 3: submit
Step 4: pay
```

Jika step 1 diproses v2 tapi step 2 masuk v1, state bisa tidak compatible.

Solusi:

- route by session;
- route by tenant;
- route by workflow id;
- feature flag per application id;
- store workflow version at creation.

Contoh domain enforcement/case management:

```text
case.workflowVersion = "2026-Q2"
```

Semua operation case tersebut mengikuti ruleset version yang sama.

---

## 16. Workflow Versioning

Untuk sistem case management, deployment version saja tidak cukup. Workflow punya lifecycle panjang.

Contoh:

```text
Application submitted on v1 rules
Assessment happens after v2 deploy
Appeal happens after v3 deploy
Enforcement action happens after v4 deploy
```

Pertanyaan:

- Apakah case lama mengikuti aturan lama atau aturan baru?
- Apakah state lama masih valid?
- Apakah transition baru berlaku untuk case in-flight?
- Apakah audit trail bisa menjelaskan ruleset yang dipakai?

### 16.1 Workflow version as domain data

```sql
ALTER TABLE case_file ADD workflow_version VARCHAR(50);
```

```java
public Decision evaluate(CaseFile caseFile) {
    return switch (caseFile.workflowVersion()) {
        case "2025-Q4" -> rules2025Q4.evaluate(caseFile);
        case "2026-Q2" -> rules2026Q2.evaluate(caseFile);
        default -> throw new UnknownWorkflowVersionException();
    };
}
```

### 16.2 Kapan workflow version diperlukan?

Diperlukan jika:

- lifecycle entity panjang;
- aturan berubah secara legal/regulatory;
- auditability penting;
- rollback semantic sulit;
- entity lama tidak boleh otomatis mengikuti aturan baru;
- user bisa melanjutkan draft lama setelah deployment baru.

Tidak selalu diperlukan untuk CRUD sederhana.

### 16.3 Deployment implication

Jika workflow version menjadi domain data, deployment harus memastikan:

- versi rule lama masih tersedia;
- test mencakup entity lama;
- migration tidak mengubah meaning audit;
- UI bisa menampilkan behavior berdasarkan workflow version;
- reporting memahami multiple workflow versions.

---

## 17. Shared Library Deployment Risk

Di Java ecosystem, banyak organisasi membuat shared library internal:

- `common-domain.jar`;
- `common-security.jar`;
- `common-error.jar`;
- `common-web.jar`;
- `common-audit.jar`;
- `common-client.jar`;
- `common-dto.jar`.

Shared library bisa membantu konsistensi, tetapi juga menyebabkan distributed coupling.

### 17.1 Bahaya shared DTO library

Jika Service A dan Service B memakai `common-dto.jar`, perubahan DTO bisa membuat semua service harus update bersamaan.

```text
common-dto v1 → used by 30 services
common-dto v2 removes field
10 services upgraded
20 services not upgraded
runtime mismatch begins
```

### 17.2 Binary compatibility Java

Perubahan source-compatible belum tentu binary-compatible.

Contoh berbahaya:

```java
// v1
public String getCaseId() { ... }

// v2
public CaseId getCaseId() { ... }
```

Service yang dikompilasi terhadap v1 tetapi runtime memakai v2 bisa mengalami:

```text
NoSuchMethodError
```

### 17.3 Rule shared library

1. Shared library harus sangat stabil.
2. Hindari shared DTO antar bounded context.
3. Publish versioned client library hanya jika contract mature.
4. Jangan force semua service upgrade karena satu common library berubah.
5. Pisahkan library low-level utility dari domain contract.
6. Treat shared library release seperti API release.
7. Jalankan compatibility check terhadap consumer penting.

### 17.4 Better alternative

Untuk inter-service contract:

- OpenAPI spec;
- protobuf schema;
- AsyncAPI spec;
- consumer-driven contract;
- generated client per service;
- explicit version.

Jangan membuat common library menjadi database schema kedua yang tidak terlihat.

---

## 18. Client Library Versioning

Banyak Java service memakai generated/internal client:

```java
caseServiceClient.getCase(caseId);
```

Client library menyembunyikan HTTP detail, tetapi menambah versioning problem.

### 18.1 Client library compatibility matrix

| Client Lib | Provider | Aman? |
|---|---:|---:|
| client v1 | provider v1 | Ya |
| client v1 | provider v2 | Harus ya |
| client v2 | provider v1 | Harus ya saat consumer deploy dulu |
| client v2 | provider v2 | Target |

Jika client v2 memanggil endpoint provider v2 yang belum deployed, consumer deploy dulu akan gagal.

### 18.2 Client library rule

Client library baru harus bisa bekerja terhadap provider lama jika deployment order tidak dijamin.

Contoh:

```java
public RiskLevel getRiskLevel(String caseId) {
    try {
        return api.getCaseRisk(caseId).riskLevel();
    } catch (NotFoundException e) {
        return RiskLevel.UNKNOWN;
    }
}
```

Atau expose capability check:

```java
if (caseClient.supportsRiskLevel()) {
    return caseClient.getRiskLevel(caseId);
}
```

Tapi capability check sendiri harus reliable.

---

## 19. Service Discovery dan Runtime Topology

Distributed deployment tidak hanya mengubah code. Ia mengubah topology.

### 19.1 Static endpoint

```properties
case.service.url=https://case-service.internal
```

Sederhana, tetapi rentan jika route berubah.

### 19.2 DNS/service discovery

Kubernetes Service:

```text
http://case-service.namespace.svc.cluster.local
```

Traffic didistribusi ke endpoint Pod yang ready.

Risiko:

- DNS caching;
- stale endpoints;
- readiness false positive;
- connection pool menyimpan koneksi ke pod terminating;
- HTTP keep-alive ke instance lama;
- client-side load balancing tidak sinkron dengan Kubernetes readiness.

### 19.3 Service mesh

Service mesh bisa memberi:

- traffic split;
- retry;
- timeout;
- circuit breaker;
- mTLS;
- telemetry;
- shadow traffic;
- fault injection.

Tetapi service mesh juga menambah layer failure:

- sidecar version mismatch;
- policy misconfiguration;
- mTLS certificate issue;
- retry storm;
- outlier detection salah;
- routing rule stale.

Top engineer tidak menganggap mesh sebagai magic. Mesh adalah deployment control plane yang juga harus diuji.

---

## 20. Timeout, Retry, dan Circuit Breaker Saat Deployment

Deployment sering memperbesar latency sementara:

- pod cold start;
- JIT warmup;
- cache cold;
- connection pool warming;
- class loading;
- DB migration lock;
- consumer rebalance;
- autoscaling lag.

Jika timeout/retry buruk, rollout kecil bisa menjadi incident besar.

### 20.1 Retry amplification

Misalnya:

```text
Frontend retries 2x
API Gateway retries 2x
Service A retries 3x
Service B retries 3x
```

Satu request user bisa menghasilkan:

```text
2 × 2 × 3 × 3 = 36 attempts
```

Saat deployment membuat latency naik, retry storm bisa membuat semua service overload.

### 20.2 Deployment-safe retry rules

1. Retry hanya untuk operasi idempotent.
2. Gunakan exponential backoff + jitter.
3. Batasi total retry budget.
4. Jangan retry HTTP 4xx kecuali spesifik.
5. Jangan retry jika downstream sudah overload.
6. Gunakan timeout lebih kecil dari upstream timeout.
7. Gunakan circuit breaker untuk stop cascade.
8. Monitor retry count saat rollout.

### 20.3 Timeout hierarchy

```text
User/client timeout: 30s
API gateway timeout: 25s
Service A timeout: 20s
Service B timeout: 15s
DB query timeout: 10s
```

Jangan kebalik:

```text
Gateway timeout 10s
Service waits 30s
DB waits 60s
```

Itu menghasilkan zombie work setelah caller sudah menyerah.

---

## 21. Partial Failure During Deployment

Distributed deployment harus menerima partial failure.

Contoh:

```text
case-service v2 deployed successfully
notification-service still v1
audit-service fails rollout
report-service consuming old events slowly
frontend already shows new button
```

Pertanyaan:

- Apakah user bisa melakukan action baru?
- Apakah action menghasilkan audit?
- Apakah notification wajib atau best-effort?
- Apakah report boleh eventual?
- Apakah rollback case-service cukup?
- Apakah event v2 sudah masuk queue dan tidak bisa dibatalkan?

### 21.1 Classify dependency criticality

| Dependency | Jika gagal | Deployment behavior |
|---|---|---|
| Auth | block request | hard dependency |
| Payment | block payment flow | hard dependency |
| Audit regulatory | block or durable buffer | hard/regulatory |
| Email notification | degrade | async/best-effort |
| Reporting projection | eventual | async recovery |
| Recommendation | degrade | optional |

Tidak semua failure harus rollback. Tetapi semua failure harus punya model.

### 21.2 Synchronous vs asynchronous fallback

Untuk audit regulatory, fallback silent sangat berbahaya.

Buruk:

```java
try {
    auditClient.record(action);
} catch (Exception e) {
    log.warn("Audit failed, ignored");
}
```

Lebih baik:

- write local durable outbox;
- block critical transition;
- retry with DLQ;
- alert;
- mark case pending audit;
- fail closed untuk aksi legal penting.

---

## 22. Outbox Pattern untuk Deployment Safety

Outbox pattern membantu menjaga konsistensi antara DB transaction dan event publishing.

Tanpa outbox:

```text
1. Update case status in DB
2. Publish CaseApprovedEvent
```

Failure possibility:

```text
DB update success
publish fails
consumer never knows
```

Dengan outbox:

```text
Single DB transaction:
1. Update case status
2. Insert outbox event row

Async publisher:
3. Read outbox row
4. Publish event
5. Mark published
```

### 22.1 Deployment implication

Outbox membuat deployment lebih aman karena:

- event tidak hilang saat producer restart;
- publisher bisa pause saat consumer belum siap;
- replay bisa dilakukan;
- schema migration bisa dikontrol;
- event publication bisa diobservasi.

### 22.2 Outbox table example

```sql
CREATE TABLE outbox_event (
  id VARCHAR(100) PRIMARY KEY,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_version INT NOT NULL,
  payload CLOB NOT NULL,
  status VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  published_at TIMESTAMP NULL
);
```

### 22.3 Outbox deployment trap

Jika payload schema berubah, old publisher/new publisher compatibility harus dipikirkan.

```text
App v1 writes outbox payload v1
App v2 publisher must still publish v1
App v2 writes payload v2
Consumer v1 may still consume v2
```

Outbox tidak menghapus schema compatibility problem. Ia membuatnya lebih visible dan recoverable.

---

## 23. Saga, Workflow, dan Long-Running Transaction Deployment

Di distributed system, business transaction sering melintasi banyak service.

```text
Submit Application
  → validate profile
  → reserve payment reference
  → create case
  → request document screening
  → send notification
  → update dashboard projection
```

Tidak ada single database transaction global yang sehat untuk semua ini.

### 23.1 Saga orchestration

Satu orchestrator mengatur langkah.

```text
Workflow Engine / Orchestrator
  calls service A
  calls service B
  waits event C
  compensates if needed
```

Deployment risk:

- orchestrator versi baru menjalankan step baru;
- worker versi lama tidak punya handler step baru;
- in-flight workflow lama berada di step yang sudah dihapus;
- compensation logic berubah;
- timeout policy berubah.

### 23.2 Saga choreography

Service bereaksi terhadap event.

```text
ApplicationSubmitted → ProfileValidated → CaseCreated → NotificationSent
```

Deployment risk:

- event order berubah;
- consumer baru belum deployed;
- duplicate event;
- missing compensation;
- unknown event ignored padahal critical.

### 23.3 Rule untuk long-running workflow

1. Jangan hapus handler step lama sampai tidak ada workflow lama.
2. Version workflow definition.
3. Simpan workflow version di instance.
4. Pastikan compensation backward-compatible.
5. Jangan ubah timeout semantic tanpa migration.
6. Sediakan manual recovery path.
7. Observability harus per workflow instance, bukan hanya per service.

---

## 24. Cache Compatibility in Distributed Deployment

Cache sering dilupakan saat deployment.

### 24.1 Cache key versioning

Buruk:

```text
case:{caseId}
```

Jika value shape berubah, service lama bisa membaca value baru dan gagal.

Lebih aman:

```text
case:v1:{caseId}
case:v2:{caseId}
```

### 24.2 Cache value compatibility

Jika cache value JSON berubah:

```json
{
  "caseId": "C-001",
  "status": "PENDING"
}
```

menjadi:

```json
{
  "caseId": "C-001",
  "lifecycle": {
    "status": "PENDING"
  }
}
```

Old reader akan gagal.

### 24.3 Cache invalidation during deployment

Pilihan:

1. clear all cache;
2. versioned key;
3. dual-read old/new;
4. TTL-based transition;
5. lazy migration;
6. warm cache before switch.

### 24.4 Distributed cache rule

Jika ada rolling update, cache harus aman untuk versi campuran.

```text
Pod v1 writes cache
Pod v2 reads cache
Pod v2 writes cache
Pod v1 reads cache
```

Jika tidak aman, gunakan key versioning atau isolate traffic.

---

## 25. Authorization and Policy Deployment Across Services

Authorization deployment multi-service sangat berbahaya karena policy tersebar.

Contoh:

```text
API Gateway validates token
Case Service checks role
Document Service checks ownership
Audit Service records action
Frontend hides button
```

Jika hanya frontend diubah, keamanan tidak berubah.
Jika hanya backend diubah, UI mungkin misleading.
Jika gateway belum diubah, request bisa ditolak sebelum mencapai service.

### 25.1 Policy compatibility

Pertanyaan deployment:

- Apakah role baru sudah ada di IdP?
- Apakah token claim baru tersedia?
- Apakah gateway menerima scope baru?
- Apakah backend memahami scope baru?
- Apakah frontend mengecek permission yang sama?
- Apakah audit mencatat policy decision?
- Apakah old service gagal jika claim tidak ada?

### 25.2 Safe order untuk permission baru

```text
1. Add role/scope in IdP, not yet assigned
2. Deploy backend tolerant to new/old claims
3. Deploy gateway policy allowing new route/scope
4. Deploy frontend hidden behind flag
5. Assign permission to pilot users
6. Monitor authorization decision logs
7. Roll out broadly
```

### 25.3 Safe order untuk memperketat permission

```text
1. Observe current usage
2. Warn/deprecate unauthorized pattern
3. Deploy audit-only policy mode if possible
4. Fix legitimate clients
5. Enforce deny
6. Monitor spikes in 403
```

Langsung memperketat policy bisa menjadi incident.

---

## 26. Frontend + Backend Distributed Deployment

Frontend adalah service consumer juga.

### 26.1 SPA deployment issue

Single Page Application bisa di-cache browser/CDN.

```text
User browser still has frontend v1
Backend already v2
```

Atau sebaliknya:

```text
Frontend v2 bundle loaded
Backend v1 still serving API
```

### 26.2 Rule untuk SPA-backend compatibility

1. Backend harus deploy dulu untuk additive endpoints.
2. Frontend harus tolerate missing optional fields.
3. Feature baru harus hidden sampai backend ready.
4. Static asset caching harus versioned/hash-based.
5. API client harus handle old error format during transition.
6. Jangan remove backend field sampai frontend lama tidak aktif.

### 26.3 Backend-for-frontend

BFF bisa mengurangi coupling frontend ke banyak service.

```text
Frontend → BFF → many backend services
```

Tetapi BFF menjadi consistency boundary:

- BFF harus backward-compatible dengan frontend lama;
- BFF harus forward-compatible dengan backend baru;
- BFF deployment order penting;
- BFF bisa menyembunyikan distributed complexity, tetapi tidak menghilangkannya.

---

## 27. Mobile and External Client Deployment

External client tidak ikut release cadence internal.

```text
Mobile app v1 still active for months
Partner API client updates once per quarter
Agency integration has formal UAT window
```

### 27.1 Rule external compatibility

1. Jangan breaking change tanpa versioning.
2. Publish deprecation policy.
3. Monitor usage by client version.
4. Support old contract sampai sunset date.
5. Provide test/sandbox environment.
6. Provide changelog and migration guide.
7. Use explicit error for deprecated version.
8. Never rely on “everyone will update quickly”.

### 27.2 Client identification

Gunakan header:

```http
X-Client-Id: cpds
X-Client-Version: 2.3.1
```

atau token claim:

```json
{
  "client_id": "cpds-web",
  "client_version": "2.3.1"
}
```

Ini membantu:

- routing;
- deprecation;
- canary;
- support;
- incident analysis;
- compatibility decision.

---

## 28. Data Projection and Reporting Deployment

Distributed systems sering punya read model/projection:

```text
OLTP service DB → events → reporting DB/search index/dashboard
```

Deployment risiko:

- event baru belum dipahami projector;
- projection schema belum expand;
- report query mengasumsikan field lama;
- rebuild projection butuh replay event lama;
- partial deployment membuat dashboard misleading.

### 28.1 Projection compatibility

Projector baru harus bisa membaca event lama.

Projector lama harus tidak mati jika menerima event baru, atau producer harus menunggu projector update.

### 28.2 Rebuild strategy

Jika projection harus rebuild:

```text
1. Deploy new projection table/index side-by-side
2. Backfill/replay into new projection
3. Compare counts and sample values
4. Switch read path
5. Keep old projection for rollback window
6. Remove old after confidence period
```

Jangan langsung mutate projection utama tanpa rollback path.

### 28.3 Reporting semantic change

Misalnya status case berubah:

```text
PENDING_REVIEW split into PENDING_OFFICER_REVIEW and PENDING_MANAGER_REVIEW
```

Report lama mungkin butuh mapping:

```text
legacy PENDING_REVIEW = new PENDING_OFFICER_REVIEW + PENDING_MANAGER_REVIEW
```

Deployment harus include semantic mapping, bukan hanya schema change.

---

## 29. Distributed Rollback Is Not Time Travel

Rollback satu service tidak membatalkan side effect yang sudah terjadi.

### 29.1 What rollback can undo

- process version;
- container image;
- config value;
- routing weight;
- feature flag state;
- gateway route;
- deployment manifest.

### 29.2 What rollback cannot automatically undo

- database rows already written;
- event already published;
- external email sent;
- payment initiated;
- audit record created;
- cache polluted;
- workflow transition executed;
- document generated;
- external partner notified;
- user action completed.

### 29.3 Rollback compatibility question

Before deploy v2:

> “If we rollback to v1 after 30 minutes, can v1 read everything v2 wrote?”

Jika jawabannya tidak, rollback bukan strategi aman. Anda butuh:

- roll-forward fix;
- feature disable;
- compatibility layer;
- data repair script;
- compensating action;
- traffic isolation;
- manual recovery.

### 29.4 Roll-forward often safer

Di distributed deployment, roll-forward sering lebih aman daripada rollback jika:

- schema sudah berubah;
- event v2 sudah tersebar;
- downstream sudah membaca data v2;
- client sudah menerima response baru;
- external side effect sudah terjadi.

Tetapi roll-forward harus cepat dan teruji.

---

## 30. Deployment Graph

Top engineer menggambar deployment graph sebelum release kompleks.

### 30.1 Example graph

```text
Frontend
   ↓
API Gateway
   ↓
Case Service ─────→ Document Service
   ↓                     ↓
Case DB              Object Storage
   ↓
Outbox Publisher ───→ Event Broker ───→ Audit Consumer
                                      ├→ Notification Consumer
                                      └→ Reporting Projector
```

### 30.2 Annotate graph dengan change type

```text
Frontend: new button, calls new endpoint
Gateway: new route /cases/{id}/approve
Case Service: new approval logic + emits CaseApproved v2
Case DB: add approval_mode column
Audit Consumer: must read CaseApproved v2
Report Projector: new status mapping
Notification Consumer: ignores approval_mode
```

### 30.3 Annotate graph dengan deployment order

```text
1. DB expand
2. Audit consumer tolerant to v1/v2
3. Report projector tolerant to v1/v2
4. Case service emits v1 + v2-compatible payload behind flag
5. Gateway route enabled for internal users
6. Frontend deployed with feature disabled
7. Enable pilot tenant
8. Monitor
9. Full rollout
10. Contract old behavior later
```

### 30.4 Annotate rollback capability

```text
DB expand: rollback not needed, compatible
Audit consumer: rollback safe
Report projector: rollback safe if projection old retained
Case service: rollback safe only if v1 can read approval_mode nullable
Frontend: rollback safe
Gateway: route can disable
Flag: kill switch available
```

This graph becomes release evidence.

---

## 31. Deployment Checklist for Multi-Service Java Change

### 31.1 Contract checklist

- [ ] Provider API backward-compatible?
- [ ] Consumer tolerant to provider change?
- [ ] Error response compatibility checked?
- [ ] Enum change reviewed?
- [ ] Date/time format unchanged?
- [ ] Pagination behavior unchanged?
- [ ] Nullability reviewed?
- [ ] OpenAPI/AsyncAPI/protobuf/schema updated?
- [ ] Consumer-driven contracts pass?

### 31.2 Event checklist

- [ ] Event schema compatible?
- [ ] Old consumer can read new event?
- [ ] New consumer can read old event?
- [ ] DLQ behavior tested?
- [ ] Idempotency key stable?
- [ ] Event ordering assumption unchanged?
- [ ] Retention/replay considered?
- [ ] Outbox/inbox compatible?

### 31.3 Database/cache checklist

- [ ] DB schema expand before app deploy?
- [ ] Old app works with new schema?
- [ ] New app works with old/expanded schema?
- [ ] Backfill plan exists?
- [ ] Contract/drop delayed?
- [ ] Cache key/value versioning safe?
- [ ] Cache clear/warm strategy defined?

### 31.4 Runtime checklist

- [ ] Resource sizing unchanged or reviewed?
- [ ] Timeout/retry/circuit breaker reviewed?
- [ ] Startup/readiness behavior safe?
- [ ] Graceful shutdown safe?
- [ ] Connection pool behavior safe during rolling?
- [ ] Consumer drain behavior safe?

### 31.5 Release checklist

- [ ] Deployment order defined?
- [ ] Feature flags defined?
- [ ] Canary/ring strategy defined?
- [ ] Synthetic check ready?
- [ ] Metrics/log gates defined?
- [ ] Rollback/roll-forward path defined?
- [ ] Data repair path defined if needed?
- [ ] Communication plan ready?

---

## 32. Example Case Study: Add Risk Scoring to Case Approval

### 32.1 Requirement

Tambahkan risk scoring ke approval flow.

Perubahan:

- Case Service menghitung `riskLevel`;
- Approval UI menampilkan risk;
- Audit mencatat risk saat approval;
- Reporting menampilkan distribusi risk;
- Notification tidak butuh risk;
- old cases tidak punya risk.

### 32.2 Naive deployment

```text
1. Add NOT NULL risk_level column
2. Deploy Case Service requiring risk_level
3. Deploy frontend calling new field
4. Deploy report later
```

Masalah:

- old app gagal insert karena column NOT NULL;
- old cases null;
- report query salah;
- frontend v2 bisa deployed sebelum backend;
- rollback Case Service v1 mungkin tidak tahu field baru;
- audit consumer bisa gagal jika event berubah.

### 32.3 Safer plan

#### Step 1 — DB expand

```sql
ALTER TABLE case_file ADD risk_level VARCHAR(20) NULL;
```

Old app tetap aman.

#### Step 2 — Deploy tolerant consumers

Audit consumer:

```java
String riskLevel = event.riskLevel() == null ? "UNKNOWN" : event.riskLevel();
```

Report projector:

```text
risk null → UNKNOWN bucket
```

#### Step 3 — Deploy Case Service dual-compatible

- reads old cases with null risk;
- writes risk for new approval;
- event includes optional riskLevel;
- feature flag controls UI exposure, not DB compatibility.

#### Step 4 — Deploy frontend hidden

Frontend deployed but risk panel disabled.

#### Step 5 — Enable pilot ring

Enable for internal users or low-risk tenant.

#### Step 6 — Observe

Metrics:

- approval success rate;
- audit consumer error;
- report projector lag;
- null risk percentage;
- unknown enum count;
- p95 approval latency.

#### Step 7 — Backfill optional

Backfill risk for old cases if business requires.

#### Step 8 — Contract later

Only after all old cases handled:

```sql
-- maybe never make NOT NULL if legacy cases valid without risk
```

### 32.4 Senior insight

The hard part is not adding a column. The hard part is preserving correctness while old data, old consumers, old UI, old events, and new behavior coexist.

---

## 33. Example Case Study: Split Status Enum

### 33.1 Current state

```text
PENDING_REVIEW
APPROVED
REJECTED
```

New requirement:

```text
PENDING_OFFICER_REVIEW
PENDING_MANAGER_REVIEW
APPROVED
REJECTED
```

### 33.2 Why this is dangerous

Enum changes break:

- frontend switch-case;
- report grouping;
- authorization rules;
- workflow transitions;
- notification template;
- audit description;
- external API consumers;
- old mobile app;
- search filters.

### 33.3 Safer transition

#### Phase 1 — Add mapping, do not emit new enum externally

Internal domain may know new status, but external API maps:

```text
PENDING_OFFICER_REVIEW → PENDING_REVIEW
PENDING_MANAGER_REVIEW → PENDING_REVIEW
```

#### Phase 2 — Deploy tolerant consumers

Consumers understand both old and new.

#### Phase 3 — Version external API/report

New report can split statuses, old report keeps aggregate.

#### Phase 4 — Emit new statuses to selected consumers

Use API version, feature flag, or tenant ring.

#### Phase 5 — Deprecate old status only after consumers migrated

Do not remove old mapping too early.

---

## 34. Common Failure Modes

### 34.1 Provider deploy breaks old consumer

Symptom:

```text
Consumer 500 increases after provider deploy
```

Cause:

- removed field;
- changed type;
- changed error format;
- new enum;
- strict deserialization.

Prevention:

- contract tests;
- backward-compatible API;
- canary provider;
- consumer usage telemetry.

### 34.2 Consumer deploy assumes provider new endpoint

Symptom:

```text
404/501 from provider
```

Cause:

- consumer deployed before provider;
- feature flag missing;
- service discovery points to old provider;
- canary routing inconsistent.

Prevention:

- provider-first deployment;
- capability check;
- feature flag;
- compatibility matrix.

### 34.3 Event consumer dies on old backlog

Symptom:

```text
Consumer v2 fails after deployment processing old event
```

Cause:

- consumer v2 only understands event v2;
- replay/backlog contains event v1.

Prevention:

- backward compatibility;
- schema registry;
- replay tests;
- DLQ staging test.

### 34.4 New event kills old consumer

Symptom:

```text
DLQ grows after producer deploy
```

Cause:

- producer emits event v2 before consumer updated;
- unknown enum;
- required field changed.

Prevention:

- consumer-first;
- full compatibility;
- topic versioning;
- canary producer.

### 34.5 Cache poisoning

Symptom:

```text
Random pods fail deserialization
```

Cause:

- v2 writes cache format;
- v1 reads same key.

Prevention:

- cache key version;
- tolerant reader;
- cache clear strategy;
- traffic isolation.

### 34.6 Rollback fails after data change

Symptom:

```text
Rollback app starts but cannot process records written by v2
```

Cause:

- v2 wrote irreversible data;
- v1 cannot parse new enum/field.

Prevention:

- rollback compatibility test;
- expand-contract;
- roll-forward plan;
- data repair.

### 34.7 Retry storm during rolling update

Symptom:

```text
Latency spike becomes full outage
```

Cause:

- cold pods slower;
- retry layers multiply traffic;
- readiness too optimistic;
- circuit breaker absent.

Prevention:

- startup probe;
- warmup;
- retry budget;
- canary;
- autoscaling headroom.

---

## 35. Observability untuk Distributed Deployment

Single-service metrics tidak cukup.

### 35.1 Deployment markers

Setiap telemetry harus bisa difilter berdasarkan:

- service name;
- service version;
- image tag;
- git SHA;
- pod name;
- deployment ring;
- tenant;
- feature flag state;
- API version;
- event version;
- workflow version.

### 35.2 Metrics yang penting

Per service:

- request rate;
- error rate;
- latency;
- saturation;
- restarts;
- CPU throttling;
- memory RSS;
- GC pause;
- thread pool queue;
- connection pool usage.

Inter-service:

- downstream error by target service;
- timeout count;
- retry count;
- circuit breaker open;
- queue lag;
- DLQ size;
- event processing latency;
- contract violation count.

Domain:

- successful approvals;
- failed submissions;
- stuck workflow count;
- pending audit count;
- notification pending count;
- report projection lag;
- case transition failure.

### 35.3 Logs yang penting

Structured log fields:

```json
{
  "service": "case-service",
  "version": "2.4.0",
  "gitSha": "abc123",
  "correlationId": "corr-789",
  "tenantId": "agency-a",
  "workflowVersion": "2026-Q2",
  "apiVersion": "v2",
  "eventVersion": 2,
  "featureFlags": ["risk-scoring"],
  "message": "Case approved"
}
```

Tanpa metadata versi, canary analysis sangat sulit.

### 35.4 Trace propagation

Trace harus melintasi:

```text
Frontend → Gateway → Service A → Service B → DB
                         ↓
                       Queue → Consumer → Report DB
```

Untuk async boundary, gunakan correlation/causation id.

---

## 36. Release Evidence untuk Multi-Service Deployment

Untuk enterprise/regulatory, release evidence harus menjawab:

1. Apa yang berubah?
2. Service mana saja terpengaruh?
3. Contract apa yang berubah?
4. Database/event/cache apa yang berubah?
5. Deployment order apa?
6. Compatibility matrix apa?
7. Verification apa yang sudah dilakukan?
8. Metrics apa yang dipantau?
9. Rollback/roll-forward plan apa?
10. Siapa approve?
11. Kapan deployed?
12. Versi artifact apa?
13. Git SHA apa?
14. Feature flag state apa?
15. Apakah ada post-deploy anomaly?

### 36.1 Example release evidence table

| Component | Old | New | Change | Verification | Rollback |
|---|---:|---:|---|---|---|
| case-service | 2.3.1 | 2.4.0 | adds risk scoring | smoke + canary + contract | image rollback safe |
| audit-consumer | 1.8.0 | 1.9.0 | reads risk optional | replay v1/v2 events | safe |
| reporting-projector | 3.1.0 | 3.2.0 | new risk bucket | projection compare | keep old projection |
| DB schema | 55 | 56 | add nullable risk_level | migration check | no rollback needed |
| frontend | 4.2.0 | 4.3.0 | hidden risk UI | flag off smoke | static rollback |

---

## 37. Anti-Patterns

### 37.1 Big bang deployment

```text
Deploy 12 services, DB migration, gateway, frontend, events all at once
```

Kadang diperlukan untuk legacy, tetapi harus dianggap high-risk.

### 37.2 “It compiles, so it is compatible”

Compile-time success tidak membuktikan runtime compatibility.

### 37.3 Shared DTO everywhere

Membuat distributed system seperti monolith buruk tanpa transactional safety monolith.

### 37.4 Removing old fields too early

Consumer lama masih hidup, event lama masih ada, cache lama masih ada.

### 37.5 No version in telemetry

Saat incident, tidak bisa membedakan v1 vs v2.

### 37.6 Rollback plan that ignores data

Rollback image tanpa data compatibility bukan rollback plan.

### 37.7 Feature flag without lifecycle

Flag menjadi permanent complexity.

### 37.8 Strict deserialization for external input

Membuat additive change menjadi breaking change.

### 37.9 Retry everywhere

Retry tanpa budget memperbesar outage.

### 37.10 Gateway route enabled before backend ready

Membuat error publik untuk fitur yang belum siap.

---

## 38. Practical Design Heuristics

### 38.1 Design for N and N-1 compatibility

Minimal:

```text
version N service should work with version N-1 dependencies
version N-1 service should survive version N dependencies
```

Untuk external API/event retention panjang, mungkin perlu N-2 atau lebih.

### 38.2 Prefer additive over destructive

Add first, migrate, observe, then remove later.

### 38.3 Old readers and old writers matter

Jangan hanya test new app dengan new app.

Test:

```text
old caller → new provider
new caller → old provider
old event → new consumer
new event → old consumer
old cache → new app
new cache → old app
old DB row → new app
new DB row → old app
```

### 38.4 Separate deploy from activate

Deploy code dengan feature disabled.

Activate setelah system ready.

### 38.5 Prefer ring rollout for business risk

Percentage canary bagus untuk traffic risk.
Ring rollout bagus untuk business/process risk.

```text
Internal → pilot tenant → low-risk tenant → all tenants
```

### 38.6 Treat events as public APIs

Event consumer bisa lebih banyak dari yang Anda tahu.

### 38.7 Treat data as the hardest rollback boundary

Process bisa diganti cepat. Data sulit dibalik.

### 38.8 Make version visible everywhere

Version harus ada di:

- artifact;
- logs;
- metrics;
- traces;
- health endpoint;
- deployment manifest;
- release note;
- dashboard.

---

## 39. Java-Specific Considerations

### 39.1 Serialization compatibility

Java native serialization sangat berbahaya untuk distributed deployment jika class berubah.

Risiko:

- `serialVersionUID` mismatch;
- class not found;
- field type mismatch;
- incompatible object graph;
- security risk.

Untuk inter-service communication, prefer:

- JSON with schema discipline;
- protobuf;
- Avro;
- explicit DTO;
- versioned contract.

### 39.2 Jackson compatibility

Jackson default behavior bisa berbeda berdasarkan config.

Perhatikan:

```java
DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES
DeserializationFeature.READ_UNKNOWN_ENUM_VALUES_AS_NULL
DeserializationFeature.READ_UNKNOWN_ENUM_VALUES_USING_DEFAULT_VALUE
SerializationFeature.WRITE_DATES_AS_TIMESTAMPS
```

Config ini adalah deployment compatibility decision, bukan hanya coding style.

### 39.3 Java records

Records bagus untuk immutable DTO, tetapi hati-hati:

```java
public record CaseDto(String caseId, String status) {}
```

Menambah required constructor parameter bisa memengaruhi deserialization dan generated clients.

### 39.4 Enum in Java

Unknown enum value sering menyebabkan failure.

Pertimbangkan:

```java
enum CaseStatus {
    PENDING,
    APPROVED,
    REJECTED,
    UNKNOWN
}
```

Dengan mapping unknown ke `UNKNOWN` jika domain aman.

### 39.5 Generated clients

Generated OpenAPI/protobuf clients harus diperlakukan sebagai versioned artifacts.

Jangan auto-upgrade generated client across many services tanpa compatibility check.

### 39.6 JVM warmup and canary

Java service versi baru bisa terlihat lambat karena:

- class loading;
- JIT warmup;
- cache warmup;
- connection pool initialization;
- lazy bean initialization;
- CDS difference;
- new code path not warmed.

Canary analysis harus membedakan cold-start latency dari steady-state regression.

---

## 40. Reference Deployment Playbook

Untuk perubahan multi-service medium-risk:

```text
1. Identify changed contracts
2. Build compatibility matrix
3. Classify data/event/cache impact
4. Define deployment graph
5. Define deployment order
6. Add schema expand if needed
7. Deploy tolerant readers/consumers first
8. Deploy providers/producers in compatible mode
9. Deploy frontend/clients behind flag
10. Enable synthetic traffic
11. Start canary/ring
12. Observe technical + business metrics
13. Increase rollout gradually
14. Keep old compatibility during rollback window
15. Remove old behavior later in separate release
16. Capture release evidence
```

Untuk high-risk regulatory workflow:

```text
1. Add workflow versioning
2. Preserve old rules for in-flight cases
3. Deploy new rules disabled
4. Pilot by tenant/case type
5. Compare decision output if possible
6. Enable new rule for new cases only
7. Keep old rule executable for audit/replay
8. Contract only after legal/business sign-off
```

---

## 41. Ring-Based Deployment Model for Enterprise Java

Ring rollout cocok untuk sistem enterprise dengan tenant/agency/user group.

```text
Ring 0: developers/internal support
Ring 1: QA/UAT synthetic users
Ring 2: pilot agency/team
Ring 3: low-risk production users
Ring 4: all production users
```

### 41.1 Ring control dimensions

- tenant id;
- agency id;
- user role;
- case type;
- workflow version;
- region;
- API client id;
- request header;
- feature flag group.

### 41.2 Ring metrics

Per ring:

- error rate;
- latency;
- business success rate;
- user complaint;
- workflow stuck count;
- DLQ count;
- audit completeness;
- rollback/disable frequency.

### 41.3 Ring anti-pattern

Ring yang hanya percentage traffic tidak cukup untuk business workflow.

```text
5% random users
```

bisa mengenai case critical secara acak.

Lebih baik:

```text
specific low-risk tenant/case type
```

untuk perubahan domain sensitif.

---

## 42. Decision Framework

Saat menghadapi perubahan distributed, jawab pertanyaan ini.

### 42.1 Change type

- API additive?
- API breaking?
- event additive?
- event breaking?
- database expand?
- database contract?
- cache format change?
- workflow semantic change?
- authorization policy change?
- infrastructure routing change?

### 42.2 Consumer control

- semua consumer internal?
- ada external consumer?
- ada mobile/browser cached client?
- ada batch job lama?
- ada report/replay consumer tidak terlihat?

### 42.3 Rollout requirement

- can rolling update handle it?
- need provider-first?
- need consumer-first?
- need blue-green full stack?
- need ring rollout?
- need maintenance window?

### 42.4 Rollback reality

- can old version read new data?
- can old consumer read new event?
- can old UI handle new API?
- can cache be cleared?
- can external side effect be compensated?
- is roll-forward safer?

### 42.5 Evidence

- what proves compatibility?
- what proves no hidden consumer?
- what proves business correctness?
- what metric triggers stop?
- what artifact identifies deployed version?

---

## 43. Master Summary

Distributed Java deployment is not primarily about Kubernetes YAML, Docker images, or CI/CD syntax.

It is about **safe coexistence of versions**.

The core mental model:

```text
Every deployment creates a temporary distributed system
where old and new versions coexist.
Your job is to make that coexistence safe.
```

Top 1% deployment engineers reason in terms of:

- compatibility matrix;
- version skew;
- deployment graph;
- contract evolution;
- event schema evolution;
- data rollback boundaries;
- cache compatibility;
- workflow versioning;
- feature activation;
- traffic routing;
- partial failure;
- observability by version;
- release evidence.

They do not ask only:

```text
Can I deploy this service?
```

They ask:

```text
Can the system remain correct while this service, its consumers, its producers,
its database, its events, its cache, its frontend, and its workflows are not all
at the same version?
```

That is the difference between “can operate microservices” and “can safely evolve distributed enterprise systems.”

---

## 44. Referensi

- Kubernetes Documentation — Deployments, Pods, Services, Workloads, and Production Container Orchestration: https://kubernetes.io/docs/
- Martin Fowler — Microservices: https://martinfowler.com/articles/microservices.html
- Martin Fowler — Consumer-Driven Contracts: https://martinfowler.com/articles/consumerDrivenContracts.html
- Martin Fowler — Contract Test: https://martinfowler.com/bliki/ContractTest.html
- Confluent Documentation — Schema Evolution and Compatibility: https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html
- OpenTelemetry Documentation — Java Instrumentation and Semantic Conventions: https://opentelemetry.io/docs/
- Spring Documentation — Spring Cloud Contract: https://spring.io/projects/spring-cloud-contract
- AsyncAPI Specification: https://www.asyncapi.com/docs
- OpenAPI Specification: https://spec.openapis.org/oas/latest.html
- Chris Richardson — Microservices Patterns, Saga and Transactional Outbox patterns: https://microservices.io/patterns/index.html

---

## 45. Status Seri

Part ini adalah **Part 27 dari 35** dalam series:

```text
learn-java-deployment-runtime-release-delivery-engineering
```

Seri **belum selesai**.

Berikutnya:

```text
Part 28 — Legacy Java Deployment: Java 8, App Servers, Monoliths, and Migration Constraints
```
