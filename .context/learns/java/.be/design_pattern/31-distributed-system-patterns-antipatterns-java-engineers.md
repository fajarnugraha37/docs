# 31 — Distributed System Patterns and Anti-Patterns for Java Engineers

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 31 dari 35  
> Target: Java engineer yang ingin naik dari “bisa membuat service” menjadi “bisa mendesain batas sistem yang tahan terhadap perubahan, kegagalan, dan kompleksitas organisasi”.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat distributed system bukan sebagai kumpulan service, tetapi sebagai kumpulan **failure boundary**, **ownership boundary**, **consistency boundary**, dan **deployment boundary**.
2. Membedakan kapan microservice benar-benar memberi value dan kapan hanya menjadi distributed monolith.
3. Memilih pattern seperti API Gateway, Backend for Frontend, service discovery, consumer-driven contract, CQRS, event sourcing, strangler fig, dan database-per-service secara rasional.
4. Mengenali anti-pattern seperti shared database abuse, chatty services, synchronous chain death, nanoservices, distributed transaction fantasy, dan event-driven chaos.
5. Mendesain service Java yang memiliki kontrak jelas, error semantics jelas, observability cukup, dan graceful degradation.
6. Menghubungkan pattern distributed system dengan pattern sebelumnya: gateway, adapter, outbox, inbox, idempotency, saga, resilience, security, observability, repository, service layer, state machine, dan domain modeling.
7. Melakukan design review distributed architecture bukan dari diagram indah, tetapi dari pertanyaan: “apa yang terjadi saat dependency lambat, gagal, duplikat, out-of-order, stale, atau rollback sebagian?”

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Banyak engineer belajar distributed system dari diagram seperti ini:

```text
[Frontend] -> [API Gateway] -> [Service A] -> [Service B] -> [Service C]
                                      |             |
                                    [DB A]        [DB B]
```

Diagram itu tampak modern, tetapi tidak menjawab pertanyaan paling penting:

```text
Apa yang terjadi jika Service B lambat?
Apa yang terjadi jika Service C berhasil tetapi Service A gagal commit?
Siapa pemilik data?
Kontrak apa yang dijamin?
Apakah response boleh stale?
Apakah operasi idempotent?
Siapa yang retry?
Siapa yang deduplicate?
Apa yang user lihat ketika sebagian sistem gagal?
Bagaimana kita audit keputusan lintas service?
```

Distributed system memperbesar masalah yang sebelumnya kecil:

| Masalah di monolith | Menjadi apa di distributed system |
|---|---|
| Method call gagal | Remote call timeout / retry / partial failure |
| Local transaction | Distributed consistency problem |
| Shared object model | Contract/versioning problem |
| In-process exception | Cross-boundary error semantics |
| Simple debug stacktrace | Trace/correlation/log stitching problem |
| Direct DB query | Data ownership/query composition problem |
| Refactor package | Backward-compatible API migration |
| Function call latency | Network latency + queueing + saturation |

Distributed system bukan “monolith dipotong-potong”. Ia adalah sistem dengan hukum baru:

```text
Local reasoning tidak cukup.
Failure menjadi normal.
Latency menjadi bagian kontrak.
State menjadi terfragmentasi.
Time menjadi tidak absolut.
Ordering menjadi mahal.
Consistency menjadi pilihan desain.
```

---

## 3. Mental Model Utama

### 3.1 Boundary is the unit of reasoning

Dalam monolith, unit reasoning sering berupa class, package, module, atau transaction.

Dalam distributed system, unit reasoning adalah **boundary**:

```text
request boundary
transaction boundary
ownership boundary
security boundary
failure boundary
latency boundary
consistency boundary
deployment boundary
observability boundary
```

Pattern distributed system yang baik selalu menjawab:

```text
Boundary mana yang dibuat?
Apa yang disembunyikan boundary itu?
Apa yang diekspos boundary itu?
Failure apa yang ditahan boundary itu?
Coupling apa yang dikurangi?
Cost apa yang bertambah?
```

### 3.2 Remote call is not a method call

Kesalahan paling berbahaya adalah memperlakukan HTTP/gRPC call seperti method call lokal.

Method call lokal biasanya:

```text
cepat
sinkron
memory-consistent
exception langsung
call stack jelas
transaction bisa sama
```

Remote call:

```text
bisa timeout
bisa berhasil di server tetapi gagal di client
bisa duplicated karena retry
bisa reordered
bisa stale
bisa partial failure
bisa gagal karena DNS/TLS/network/load balancer
bisa mengembalikan error yang bukan business error
```

Karena itu setiap remote call harus punya desain:

```text
timeout
retry policy
idempotency
error taxonomy
fallback behavior
observability
security context
contract compatibility
```

### 3.3 Data ownership beats code ownership

Service boundary yang baik biasanya mengikuti ownership data dan business capability, bukan sekadar nama tim atau nama tabel.

Pertanyaan penting:

```text
Siapa yang boleh mengubah data ini?
Siapa source of truth?
Siapa yang boleh memvalidasi invariant utama?
Siapa yang boleh menerbitkan event tentang perubahan ini?
Siapa yang bertanggung jawab jika data salah?
```

Jika dua service sama-sama menulis tabel yang sama, sebenarnya boundary-nya belum jelas.

### 3.4 Consistency is not binary

Distributed system bukan hanya pilihan “strong consistency” atau “eventual consistency”. Ada spektrum:

| Model | Makna praktis |
|---|---|
| Strong consistency | Setelah write berhasil, read berikutnya melihat write tersebut |
| Read-your-writes | User yang menulis dapat melihat hasilnya sendiri |
| Monotonic read | User tidak melihat data mundur ke versi lama |
| Causal consistency | Event yang bergantung pada event lain terlihat dalam urutan sebab-akibat |
| Eventual consistency | Sistem akhirnya konvergen jika tidak ada update baru |
| Best-effort consistency | Sistem mencoba sinkron tetapi tidak menjamin konvergensi ketat |

Top engineer tidak hanya berkata “eventual consistency”, tetapi menjawab:

```text
Eventual dalam berapa lama?
Siapa yang boleh melihat stale data?
Apakah stale data aman untuk keputusan ini?
Apa indikator bahwa sinkronisasi tertinggal?
Apa prosedur reconciliation?
```

### 3.5 Coupling has many forms

Distributed system sering mengurangi coupling deployment tetapi menambah coupling lain.

| Coupling | Contoh |
|---|---|
| Temporal coupling | Service A harus memanggil B saat itu juga |
| Schema coupling | Consumer bergantung pada field tertentu |
| Semantic coupling | Consumer memahami makna internal producer |
| Availability coupling | A gagal jika B down |
| Latency coupling | SLA A tergantung latency B |
| Operational coupling | Deploy A perlu koordinasi deploy B |
| Data coupling | Dua service share DB/table |
| Security coupling | A meneruskan token tanpa memahami scope |
| Observability coupling | Debug perlu log dari banyak sistem tanpa correlation |

Pattern distributed system yang baik biasanya memilih coupling mana yang diterima dan mana yang dikurangi.

---

## 4. Distributed System Pattern Map

Kita akan membahas pattern berikut:

```text
Client boundary patterns:
- API Gateway
- Backend for Frontend

Discovery and communication patterns:
- Service Discovery
- Client-side discovery
- Server-side discovery
- Synchronous request/reply
- Asynchronous messaging

Contract patterns:
- Consumer-Driven Contract
- Versioned Contract
- Tolerant Reader

Data and consistency patterns:
- Database per Service
- API Composition
- CQRS
- Event Sourcing
- Outbox/Inbox
- Saga

Migration patterns:
- Strangler Fig
- Parallel Run
- Branch by Abstraction

Failure isolation patterns:
- Bulkhead by service
- Circuit breaker
- Timeout/deadline
- Load shedding

Anti-patterns:
- Distributed Monolith
- Nanoservices
- Shared Database Abuse
- Chatty Services
- Synchronous Chain Death
- Event Soup
- Distributed Transaction Fantasy
- God Gateway
- Centralized Shared Kernel Service
```

---

## 5. API Gateway Pattern

### 5.1 Problem

Client tidak ingin mengetahui detail internal puluhan service:

```text
/frontend harus memanggil user-service
/frontend harus memanggil case-service
/frontend harus memanggil document-service
/frontend harus memanggil workflow-service
/frontend harus menggabungkan response
/frontend harus tahu auth dan retry setiap service
```

Ini menciptakan:

```text
client coupling
network chattiness
security duplication
contract sprawl
mobile/web mismatch
```

### 5.2 Intent

API Gateway menjadi entry point tunggal untuk client dan menyembunyikan topology internal service.

```text
Client -> API Gateway -> Internal Services
```

Gateway biasanya menangani:

```text
routing
authentication enforcement
rate limiting
request normalization
response shaping
TLS termination
API versioning
correlation ID
basic aggregation
```

### 5.3 Java Implementation Perspective

Di ekosistem Java, API Gateway bisa berupa:

```text
Spring Cloud Gateway
Kong / Nginx / Envoy di depan Java services
Custom Java gateway
JAX-RS/Spring edge service
BFF service per frontend
```

Untuk custom Java gateway, desain minimalnya:

```java
public interface DownstreamClient<I, O> {
    O call(I request, RequestContext context) throws DownstreamException;
}

public record RequestContext(
        String correlationId,
        String principalId,
        Set<String> scopes,
        Instant deadline
) {}
```

Gateway tidak boleh menjadi domain owner. Ia boleh melakukan edge concern, bukan business decision berat.

### 5.4 Good Gateway Responsibilities

```text
Accept external request
Validate transport-level concerns
Authenticate token
Attach correlation ID
Route to correct internal service
Normalize error envelope
Apply rate limit
Enforce coarse-grained access
Hide internal endpoints
```

### 5.5 Bad Gateway Responsibilities

```text
Own all business workflow
Contain all domain rules
Directly query all service databases
Become central transaction coordinator
Contain per-service hacks
Perform deep domain transformation everywhere
```

### 5.6 Failure Mode

API Gateway bisa menjadi:

```text
single point of failure
single point of latency
centralized god service
hidden coupling hub
bottleneck for releases
place where business logic goes to die
```

### 5.7 Design Checklist

```text
Does gateway own business state? If yes, danger.
Can internal service evolve without gateway redeploy? If no, coupling is high.
Are gateway routes observable?
Are downstream timeouts explicit?
Does gateway preserve correlation ID?
Are errors normalized without hiding root cause?
Is rate limiting per consumer, route, or tenant?
```

---

## 6. Backend for Frontend Pattern

### 6.1 Problem

Different clients need different API shapes:

```text
Web dashboard needs rich table/filter data.
Mobile needs compact payload.
Admin portal needs audit metadata.
Public portal needs masked fields.
```

One generic API often becomes bad for everyone:

```text
too much data for mobile
too little data for dashboard
frontend-specific flags in domain service
field masking scattered everywhere
```

### 6.2 Intent

Create a backend tailored to a specific frontend experience.

```text
Web UI  -> Web BFF    -> Domain services
Mobile  -> Mobile BFF -> Domain services
Admin   -> Admin BFF  -> Domain services
```

### 6.3 BFF vs API Gateway

| Aspect | API Gateway | BFF |
|---|---|---|
| Main concern | Entry point/routing/edge policy | Experience-specific API |
| Scope | Cross-client | Per client/channel |
| Logic | Transport/edge/basic aggregation | Presentation/use-case composition |
| Risk | God gateway | Duplicate client-specific orchestration |

### 6.4 Java Design

```java
public final class CaseDashboardBffService {
    private final CaseQueryClient caseClient;
    private final UserProfileClient userClient;
    private final WorkflowClient workflowClient;

    public CaseDashboardView getDashboard(CaseDashboardRequest request, AccessContext access) {
        // Compose data specifically for dashboard view.
        // No ownership of core case mutation.
        // Must tolerate partial failures if business allows.
        return null;
    }
}
```

BFF boleh compose read model, tetapi jangan menjadi owner invariant domain utama.

### 6.5 Anti-Pattern: BFF as Mini-Monolith

Tanda-tandanya:

```text
BFF punya database besar sendiri tanpa ownership jelas
BFF menjalankan business workflow utama
BFF melakukan authorization detail yang seharusnya milik domain service
BFF menjadi dependency semua frontend dan backend
```

### 6.6 When to Use

Gunakan BFF jika:

```text
client berbeda punya kebutuhan payload yang sangat berbeda
frontend terlalu banyak melakukan API composition
latency client meningkat karena banyak round trip
field masking/presentation logic mengotori domain API
```

Jangan gunakan jika:

```text
hanya ada satu frontend sederhana
kebutuhan API belum jelas
BFF hanya copy-paste gateway
team belum siap menjaga kontrak tambahan
```

---

## 7. Service Discovery Pattern

### 7.1 Problem

Dalam platform dinamis seperti Kubernetes/EKS, alamat service berubah:

```text
pod restart
node replacement
autoscaling
rolling deployment
multi-zone routing
```

Client tidak boleh hardcode IP.

### 7.2 Intent

Service Discovery menyediakan mekanisme agar client menemukan endpoint service yang valid.

Model umum:

```text
Client-side discovery:
Client -> Registry -> Service Instance

Server-side discovery:
Client -> Load Balancer / DNS -> Service Instance
```

### 7.3 Java/Kubernetes Perspective

Dalam Kubernetes, service discovery biasanya melalui:

```text
Kubernetes Service DNS
ClusterIP
Headless Service
Ingress / Gateway API
Service mesh discovery
```

Java application biasanya cukup memanggil logical DNS:

```text
http://case-service.namespace.svc.cluster.local
```

Tetapi tetap perlu:

```text
timeout
connection pooling
DNS cache awareness
retry policy
load balancing behavior awareness
```

### 7.4 Anti-Pattern: Discovery Without Resilience

Service discovery hanya menjawab “di mana service berada”, bukan “apa yang terjadi saat service lambat/gagal”.

Kesalahan umum:

```text
DNS discovery ada, tapi timeout tidak ada
load balancer ada, tapi retry storm terjadi
service mesh ada, tapi app tidak idempotent
endpoint ditemukan, tapi contract tidak compatible
```

---

## 8. Communication Pattern: Sync vs Async

### 8.1 Synchronous Request/Reply

```text
A -> B -> response
```

Cocok jika:

```text
caller membutuhkan jawaban langsung
operation singkat
failure bisa ditampilkan ke user
consistency perlu diketahui sebelum lanjut
```

Risiko:

```text
availability coupling
latency coupling
cascading failure
thread/resource blocking
retry amplification
```

### 8.2 Asynchronous Messaging

```text
A -> broker/topic/queue -> B
```

Cocok jika:

```text
caller tidak perlu hasil langsung
operation bisa diproses nanti
butuh buffering
butuh decoupling availability
butuh fan-out
```

Risiko:

```text
duplicate message
out-of-order message
poison message
replay behavior
stale projection
debugging lebih sulit
```

### 8.3 Decision Matrix

| Force | Sync | Async |
|---|---|---|
| User needs immediate answer | Good | Poor |
| Operation can be delayed | Poor/OK | Good |
| Need availability decoupling | Poor | Good |
| Need simple flow/debugging | Good | Harder |
| Need fan-out | Poor | Good |
| Need strict immediate consistency | Better | Harder |
| Need high burst absorption | Poor | Good |

### 8.4 Hybrid Pattern

Banyak enterprise flow memakai hybrid:

```text
User submits request synchronously.
System validates and accepts.
Long-running processing continues asynchronously.
User sees status page.
Events update workflow/projection.
```

Contoh:

```text
POST /applications/{id}/submit
-> validate minimal invariant
-> persist status SUBMITTED
-> write outbox event
-> return 202 Accepted or 200 with status
-> background processors handle notifications/screening/doc generation
```

---

## 9. Consumer-Driven Contract Pattern

### 9.1 Problem

Producer sering tidak tahu field dan behavior mana yang benar-benar dipakai consumer.

Akibatnya:

```text
producer mengubah response dan consumer rusak
consumer bergantung pada undocumented behavior
integration test lambat dan rapuh
release perlu koordinasi manual
```

### 9.2 Intent

Consumer mendefinisikan ekspektasi kontraknya, producer memverifikasi bahwa ia masih memenuhi kontrak tersebut.

```text
Consumer expectation -> Contract -> Producer verification
```

### 9.3 What Contract Must Cover

Kontrak bukan hanya JSON schema.

Harus mencakup:

```text
required fields
optional fields
field meaning
status code
error envelope
idempotency behavior
pagination behavior
sorting behavior
timeout expectation
security requirement
backward compatibility rule
```

### 9.4 Java Implementation Options

Di Java ecosystem:

```text
Spring Cloud Contract
Pact JVM
OpenAPI contract tests
JSON schema validation
Custom contract fixture tests
```

Contoh mental model:

```java
@Test
void producer_should_satisfy_case_summary_contract_for_dashboard_consumer() {
    // Given producer has a case with required status and owner fields
    // When dashboard consumer calls summary endpoint
    // Then response includes stable fields consumed by dashboard
}
```

### 9.5 Anti-Pattern: Contract as Documentation Only

OpenAPI/spec yang tidak dites akan cepat menjadi aspirational document.

Kontrak harus menjadi bagian CI:

```text
consumer publishes contract
producer verifies contract
breaking change blocks release
compatible additive change allowed
```

---

## 10. Tolerant Reader Pattern

### 10.1 Problem

Consumer terlalu strict terhadap response producer.

Misalnya:

```text
Producer menambah field baru.
Consumer gagal parse.
Producer mengubah order field.
Consumer gagal.
Consumer bergantung pada field internal.
```

### 10.2 Intent

Consumer hanya membaca data yang dibutuhkan dan mengabaikan hal yang tidak relevan.

### 10.3 Java Practice

Dengan Jackson:

```java
@JsonIgnoreProperties(ignoreUnknown = true)
public record CaseSummaryResponse(
        String caseId,
        String status,
        String title
) {}
```

Tetapi tolerant reader bukan berarti permissive terhadap semua hal.

Harus tetap strict terhadap:

```text
field required yang memang wajib
format identifier
security-sensitive fields
status enum yang memengaruhi decision
schema version jika diperlukan
```

### 10.4 Anti-Pattern: Blind Tolerance

Blind tolerance membuat consumer menerima data rusak tanpa sadar.

Lebih baik:

```text
ignore unknown fields
validate required semantic fields
log schema version mismatch
expose contract metric
fail closed untuk security decision
```

---

## 11. Database per Service Pattern

### 11.1 Problem

Service ingin loosely coupled, tetapi masih memakai database yang sama.

```text
Service A reads/writes table owned by Service B
Service B changes schema and A breaks
Both services update same row
No clear owner of invariant
```

### 11.2 Intent

Setiap service memiliki database/schema/tables yang private. Service lain mengakses data melalui API/event/projection, bukan direct table access.

```text
Service A -> DB A
Service B -> DB B
Service A --API/Event--> Service B
```

Microservices.io menempatkan database-per-service sebagai pola penting untuk menjaga loose coupling, sementara shared database adalah anti-pattern yang menimbulkan coupling data dan schema.

### 11.3 What “Owns Database” Means

Ownership bukan hanya credentials.

Artinya:

```text
service owner menentukan schema
service owner menjaga invariant
service owner melakukan migration
service owner menerbitkan perubahan melalui contract
service lain tidak melakukan join langsung ke tabel private
```

### 11.4 Java Enterprise Reality

Dalam enterprise, sering ada transisi:

```text
single Oracle database
multi-schema
many modules
some modules becoming services
reporting needs cross-domain data
legacy stored procedures
```

Pragmatic path:

```text
1. Identify table ownership.
2. Stop new cross-service writes.
3. Replace cross-service reads with API/query projection gradually.
4. Create read model for reporting.
5. Introduce outbox for state changes.
6. Split physical database only after ownership is clear.
```

Jangan memecah database fisik sebelum ownership semantic jelas. Itu hanya memindahkan kekacauan ke network.

### 11.5 Anti-Pattern: Shared Database Abuse

Tanda-tanda:

```text
multiple services update same tables
foreign keys across service ownership boundary
ad-hoc SQL from one service into another service tables
reporting query becomes production dependency
schema migration requires all teams to coordinate
no one knows source of truth
```

### 11.6 When Shared DB is Acceptable Temporarily

Dalam transisi, shared DB bisa diterima jika:

```text
ownership table jelas
write access dibatasi
read access dianggap transitional
migration plan ada
contract/projection sedang dibangun
risiko dicatat eksplisit
```

---

## 12. API Composition Pattern

### 12.1 Problem

Data tersebar di beberapa service, tetapi client butuh satu view.

Contoh dashboard:

```text
case summary from case-service
owner name from user-service
latest action from workflow-service
document count from document-service
```

### 12.2 Intent

API Composer mengambil data dari beberapa service dan menggabungkan response.

```text
Client -> Composer -> Service A
                 -> Service B
                 -> Service C
```

Composer bisa berada di:

```text
BFF
API Gateway
Query service
Application service
```

### 12.3 Risk

API Composition meningkatkan:

```text
fan-out latency
partial failure complexity
availability coupling
rate limit multiplication
debug complexity
```

Jika satu request dashboard memanggil 12 service, latency tail akan buruk.

### 12.4 Java Design

Gunakan fan-out dengan deadline, bukan timeout terpisah sembarangan:

```java
public record DashboardDeadline(Instant deadline) {
    public Duration remaining() {
        return Duration.between(Instant.now(), deadline);
    }
}
```

Setiap downstream call memakai remaining deadline, bukan timeout independen yang bisa membuat total request melewati SLA.

### 12.5 Partial Response Pattern

Untuk dashboard, partial response mungkin lebih baik daripada full failure.

```java
public record DashboardView(
        CaseSummary caseSummary,
        Optional<OwnerSummary> owner,
        Optional<WorkflowSummary> workflow,
        List<UnavailableSection> unavailableSections
) {}
```

Tetapi partial response tidak cocok untuk mutation decision yang membutuhkan invariant lengkap.

---

## 13. CQRS Pattern

### 13.1 Problem

Read dan write punya kebutuhan berbeda.

Write model ingin:

```text
invariant kuat
transaction boundary jelas
domain behavior eksplisit
normalization
consistency
```

Read model ingin:

```text
fast query
join banyak data
filter/sort/pagination
UI-specific shape
denormalization
```

Memaksa satu model untuk keduanya sering menghasilkan model yang buruk untuk semua.

### 13.2 Intent

Pisahkan Command model dan Query model.

```text
Command side: validates and changes state
Query side: optimized for reads
```

### 13.3 CQRS Does Not Require Event Sourcing

CQRS bisa sederhana:

```text
same database, separate read repository/write repository
separate table/view/materialized view
separate read service
separate search index
```

Event sourcing adalah pattern terpisah yang sering dikombinasikan dengan CQRS, tetapi bukan syarat.

### 13.4 Java Structure

```text
case/
  command/
    SubmitCaseCommand.java
    SubmitCaseHandler.java
  query/
    CaseDashboardQuery.java
    CaseDashboardProjectionRepository.java
  domain/
    Case.java
    CaseStatus.java
```

Command handler tidak harus memakai query projection. Query handler tidak boleh mengubah state.

### 13.5 Anti-Pattern: CQRS Theater

Tanda-tanda:

```text
hanya menambah package command/query tapi model sama
read side tetap memanggil write aggregate untuk semua list
write side bergantung pada read projection stale
semua simple CRUD dibuat rumit tanpa benefit
```

### 13.6 When to Use

Gunakan CQRS jika:

```text
read query kompleks dan berbeda dari write invariant
UI/reporting butuh denormalized view
write operation punya lifecycle/rule rumit
read load jauh lebih tinggi dari write load
read staleness bisa diterima
```

Jangan gunakan jika:

```text
CRUD sederhana
team belum siap menangani stale projection
consistency requirement belum jelas
observability/reconciliation belum ada
```

---

## 14. Event Sourcing Boundary

### 14.1 Problem

Beberapa domain membutuhkan audit sempurna, temporal query, atau reconstruction of state.

Contoh:

```text
case lifecycle
financial ledger
regulatory decision history
approval chain
policy evaluation history
```

### 14.2 Intent

Simpan perubahan sebagai event, bukan hanya current state.

```text
ApplicationSubmitted
ScreeningCompleted
OfficerAssigned
DecisionApproved
NoticeIssued
```

State saat ini direkonstruksi dari event stream.

### 14.3 Event Sourcing Is Not “Publish Events”

Banyak sistem mengatakan event sourcing padahal hanya publish event setelah update row.

Event sourcing berarti:

```text
event adalah source of truth
state current adalah projection
write operation append event
aggregate state dibangun dari event stream
```

### 14.4 Java Model

```java
public sealed interface CaseEvent permits
        ApplicationSubmitted,
        ScreeningCompleted,
        DecisionApproved {
    CaseId caseId();
    Instant occurredAt();
}

public record ApplicationSubmitted(
        CaseId caseId,
        ApplicantId applicantId,
        Instant occurredAt
) implements CaseEvent {}

public final class CaseAggregate {
    private CaseStatus status;

    public void apply(CaseEvent event) {
        switch (event) {
            case ApplicationSubmitted e -> this.status = CaseStatus.SUBMITTED;
            case ScreeningCompleted e -> this.status = CaseStatus.SCREENED;
            case DecisionApproved e -> this.status = CaseStatus.APPROVED;
        }
    }
}
```

### 14.5 Benefits

```text
complete audit log
temporal reconstruction
natural event-driven integration
clear history of why state changed
regulatory defensibility
```

### 14.6 Costs

```text
schema evolution of events
projection rebuild complexity
event versioning
harder queries
harder debugging for unfamiliar teams
storage growth
GDPR/privacy deletion complexity
```

### 14.7 When to Avoid

Avoid if:

```text
you only need simple CRUD
audit requirement can be met with audit table
team cannot handle event versioning
business cannot tolerate projection staleness
current-state query dominates and history is rarely needed
```

---

## 15. Strangler Fig Pattern

### 15.1 Problem

Legacy monolith terlalu besar untuk rewrite total.

Big-bang rewrite biasanya gagal karena:

```text
scope terlalu besar
business behavior tersembunyi
old system terus berubah
parity sulit dibuktikan
release risk tinggi
team kehilangan feedback produksi
```

### 15.2 Intent

Bangun sistem baru di sekitar sistem lama, pindahkan capability secara bertahap, lalu matikan bagian lama setelah aman.

```text
Client -> Routing layer -> Old system
                       -> New service
```

Martin Fowler menjelaskan strangler fig sebagai pendekatan replacement bertahap yang mengurangi risiko dibanding cut-over rewrite.

### 15.3 Steps

```text
1. Identify capability boundary.
2. Put routing/proxy/facade in front of legacy system.
3. Route selected traffic/use case to new implementation.
4. Compare behavior if needed.
5. Gradually increase scope.
6. Freeze or remove old capability.
7. Delete old code/data path.
```

### 15.4 Java Refactoring Strategy

Untuk Java monolith:

```text
Start inside codebase first:
- extract package boundary
- introduce interface/facade
- isolate repository access
- introduce adapter to legacy table/API
- create characterization tests
- introduce new module
- then extract service only if boundary stable
```

Jangan langsung membuat microservice jika boundary di dalam monolith belum jelas.

### 15.5 Anti-Pattern: Eternal Strangler

Strangler gagal jika:

```text
old and new systems coexist forever
routing rules become unmaintainable
no deletion plan
both systems write same data forever
team only adds wrappers but never removes legacy
```

Strangler harus punya deletion metric.

---

## 16. Bulkhead by Service

### 16.1 Problem

Satu dependency lambat bisa menghabiskan resource seluruh service.

Contoh:

```text
address API lambat
thread pool penuh menunggu address API
case submission ikut lambat
login ikut lambat
health check gagal
pod restart
traffic pindah ke pod lain
pod lain ikut overload
```

Google SRE menggambarkan cascading failure sering dipicu oleh overload dan positive feedback loop.

### 16.2 Intent

Pisahkan resource agar kegagalan satu area tidak menjatuhkan area lain.

Bulkhead bisa berupa:

```text
separate thread pool
separate connection pool
separate queue
separate rate limit
separate database pool
separate deployment
separate node group
separate service
```

### 16.3 Java Example

```java
public final class DownstreamExecutors {
    private final ExecutorService documentExecutor;
    private final ExecutorService notificationExecutor;
    private final ExecutorService screeningExecutor;

    public DownstreamExecutors() {
        this.documentExecutor = Executors.newFixedThreadPool(20);
        this.notificationExecutor = Executors.newFixedThreadPool(10);
        this.screeningExecutor = Executors.newFixedThreadPool(30);
    }
}
```

Dengan virtual threads, bulkhead masih relevan, tetapi bentuknya bergeser dari “jumlah thread” ke:

```text
concurrency semaphore
connection pool limit
rate limit
queue capacity
downstream capacity budget
```

### 16.4 Anti-Pattern: One Pool for Everything

Tanda-tanda:

```text
semua outbound call memakai executor/pool yang sama
semua JDBC connection dipakai semua use case tanpa prioritas
background job bisa menghabiskan resource request path
external API lambat membuat fitur unrelated ikut down
```

---

## 17. Distributed Monolith Anti-Pattern

### 17.1 Definition

Distributed monolith adalah sistem yang secara deployment terpisah, tetapi secara perubahan, data, dan runtime masih tightly coupled.

Tanda-tandanya:

```text
semua service harus deploy bersama
satu request melewati banyak service sinkron
database masih shared
contract berubah serempak
failure satu service menjatuhkan semua flow
service kecil tetapi tidak punya ownership nyata
```

### 17.2 Why It Happens

Biasanya karena organisasi memecah sistem berdasarkan technical layer:

```text
user-service
workflow-service
validation-service
notification-service
document-service
common-service
```

Bukan berdasarkan business capability dan ownership.

### 17.3 Example

```text
Submit Application:
Frontend -> Gateway
Gateway -> Application Service
Application Service -> Validation Service
Validation Service -> Profile Service
Application Service -> Workflow Service
Workflow Service -> Notification Service
Notification Service -> Template Service
Template Service -> Document Service
```

Jika setiap hop sinkron dan wajib berhasil, maka availability total menjadi perkalian availability tiap dependency.

### 17.4 Refactoring Direction

```text
1. Map end-to-end use cases.
2. Identify synchronous chain length.
3. Collapse services that always change together.
4. Move pure utility service into libraries if no runtime ownership.
5. Convert non-critical side effects to async events.
6. Create capability-owned services.
7. Eliminate shared DB writes.
```

Kadang solusi terbaik untuk distributed monolith adalah modular monolith, bukan lebih banyak service.

---

## 18. Nanoservices Anti-Pattern

### 18.1 Definition

Nanoservice adalah service yang terlalu kecil sehingga overhead distribusi lebih besar daripada benefit ownership.

Tanda-tanda:

```text
service hanya membungkus satu function sederhana
service tidak punya data ownership
service selalu dipanggil sinkron oleh satu service lain
service tidak bisa deploy independen secara meaningful
operational cost lebih besar dari complexity yang dipecahkan
```

### 18.2 Example

```text
postal-code-format-service
status-label-service
date-format-service
validation-regex-service
```

Jika logic tersebut stabil dan tidak punya independent scaling/security/deployment reason, lebih baik menjadi library/module.

### 18.3 Decision Rule

Jadikan service jika ada alasan kuat:

```text
independent data ownership
independent scaling
independent security boundary
independent team ownership
independent release cadence
highly isolated failure boundary
technology/runtime isolation required
```

Jadikan module/library jika:

```text
pure computation
no independent data
same release lifecycle
same team ownership
low operational value as service
```

---

## 19. Chatty Services Anti-Pattern

### 19.1 Definition

Service terlalu sering saling memanggil untuk menyelesaikan satu use case.

Tanda-tanda:

```text
N+1 remote calls
one page load triggers hundreds of calls
loop contains HTTP call
service asks another service for small pieces repeatedly
latency dominated by network round trip
```

### 19.2 Java Example Smell

```java
for (CaseId caseId : caseIds) {
    Owner owner = ownerClient.getOwner(caseId); // remote call inside loop
    result.add(toView(caseId, owner));
}
```

Better:

```java
Map<CaseId, Owner> owners = ownerClient.getOwners(caseIds);
```

Or better for high-volume read:

```text
maintain projection/read model updated by events
```

### 19.3 Fix Options

```text
batch API
API composition with bounded fan-out
read projection
cache with ownership-aware invalidation
move logic closer to data owner
merge services if boundary is fake
```

---

## 20. Synchronous Chain Death Anti-Pattern

### 20.1 Definition

Satu request membutuhkan chain sinkron panjang.

```text
A -> B -> C -> D -> E -> F
```

Problem:

```text
latency accumulates
failure probability accumulates
debugging harder
transaction semantics unclear
caller timeout may expire while downstream still works
retry duplicates work at multiple levels
```

### 20.2 Availability Intuition

Jika tiap service availability 99.9% dan semua harus berhasil:

```text
0.999 ^ 6 = 0.994
```

End-to-end availability turun meski tiap service terlihat bagus.

### 20.3 Fix Direction

```text
shorten synchronous path
make non-critical steps async
introduce acceptance + background processing
use outbox for reliable side effects
use bulkhead and deadline propagation
precompute read model
merge strongly coupled services
```

---

## 21. Shared Kernel and Common Service Trap

### 21.1 Shared Kernel Pattern

Shared Kernel adalah bagian model/kode yang sengaja dibagi antar bounded context.

Contoh yang mungkin valid:

```text
Money type
Identifier type
ProblemDetails model
common audit envelope
security principal contract
```

### 21.2 Trap

Shared kernel menjadi dumping ground:

```text
common-domain
common-service
shared-utils
platform-core
base-business
```

Lalu semua service bergantung padanya, dan perubahan kecil memicu release besar.

### 21.3 Rule

Shared kernel harus:

```text
small
stable
versioned
well-owned
backward compatible
free from business workflow logic
```

Jika shared module sering berubah, itu bukan kernel; itu coupling hub.

---

## 22. Service Boundary Heuristics

Gunakan pertanyaan berikut saat memutuskan boundary service:

### 22.1 Ownership Questions

```text
Siapa owner data ini?
Siapa owner invariant ini?
Siapa owner lifecycle ini?
Siapa yang menerima bug report jika hasil salah?
```

### 22.2 Change Questions

```text
Apakah bagian ini sering berubah bersama bagian lain?
Apakah bisa deploy independen tanpa koordinasi?
Apakah contract stabil?
Apakah consumer bisa tolerate additive change?
```

### 22.3 Runtime Questions

```text
Apakah scaling need berbeda?
Apakah latency budget berbeda?
Apakah availability requirement berbeda?
Apakah ada resource pool yang perlu diisolasi?
```

### 22.4 Security Questions

```text
Apakah data sensitivity berbeda?
Apakah authorization policy berbeda?
Apakah audit requirement berbeda?
Apakah network boundary perlu berbeda?
```

### 22.5 Consistency Questions

```text
Apakah operasi butuh atomic consistency?
Apakah eventual consistency diterima?
Apakah stale data aman?
Apakah reconciliation tersedia?
```

Jika jawaban menunjukkan boundary tidak independen, service terpisah mungkin premature.

---

## 23. Java Service Design Skeleton

### 23.1 Recommended Package Shape

```text
case-service/
  api/
    http/
      CaseController.java
      CaseRequestDto.java
      CaseResponseDto.java
    messaging/
      CaseEventPublisher.java
  application/
    command/
      SubmitCaseCommand.java
      SubmitCaseHandler.java
    query/
      GetCaseDashboardQuery.java
      GetCaseDashboardHandler.java
  domain/
    Case.java
    CaseStatus.java
    CasePolicy.java
    CaseEvent.java
  infrastructure/
    persistence/
      JpaCaseRepository.java
    client/
      ProfileGateway.java
      DocumentGateway.java
    messaging/
      OutboxPublisher.java
  observability/
    CaseMetrics.java
```

### 23.2 Boundary Rule

```text
api depends on application
application depends on domain and ports
domain depends on nothing external
infrastructure implements ports
```

### 23.3 Remote Client Port

```java
public interface ProfileLookupPort {
    ProfileSnapshot getProfile(ApplicantId applicantId, RequestDeadline deadline);
}
```

Infrastructure adapter:

```java
public final class HttpProfileGateway implements ProfileLookupPort {
    private final HttpClient client;

    @Override
    public ProfileSnapshot getProfile(ApplicantId applicantId, RequestDeadline deadline) {
        // timeout, error translation, correlation ID, metrics
        return null;
    }
}
```

Domain should not know HTTP.

---

## 24. Error Semantics Across Services

Distributed error taxonomy:

```text
Business rejection
Validation error
Authorization denial
Conflict/stale version
Dependency timeout
Dependency unavailable
Rate limited
Malformed contract
Unknown technical failure
```

Do not expose raw downstream error blindly.

Use normalized envelope:

```java
public record ServiceError(
        String code,
        String message,
        boolean retryable,
        String correlationId,
        Map<String, Object> details
) {}
```

Key question:

```text
Can caller decide correctly based on this error?
```

If not, error contract is bad.

---

## 25. Observability Requirements

Distributed system without observability is guesswork.

Minimum:

```text
correlation ID across all boundaries
trace/span for remote calls
metric per downstream dependency
latency histogram, not only average
error code cardinality controlled
retry count metric
circuit/bulkhead state metric
queue lag metric
outbox/inbox backlog metric
projection staleness metric
contract failure metric
```

Log event example:

```json
{
  "event": "downstream_call_completed",
  "correlationId": "c-123",
  "service": "case-service",
  "downstream": "profile-service",
  "operation": "getProfile",
  "durationMs": 120,
  "status": "success"
}
```

Avoid:

```text
log without correlation
log only generic exception
high-cardinality metrics from user IDs
PII in logs
missing downstream latency breakdown
```

---

## 26. Testing Strategy

### 26.1 Unit Tests

Test local domain decisions without network.

```text
domain invariant
policy object
state transition
error mapping
idempotency decision
```

### 26.2 Contract Tests

Test producer/consumer compatibility.

```text
request schema
response schema
error envelope
status codes
required fields
backward compatibility
```

### 26.3 Integration Tests

Test actual adapters:

```text
HTTP client timeout
serialization/deserialization
auth header propagation
retry behavior
rate limit behavior
```

### 26.4 Component Tests

Run service with fake dependencies:

```text
profile-service slow
profile-service 500
profile-service returns unknown enum
message duplicated
message out-of-order
```

### 26.5 Chaos/Failure Tests

Test failure assumptions:

```text
downstream unavailable
broker lag
DB slow
partial deployment
DNS failure
connection pool exhausted
```

### 26.6 Migration Tests

For strangler:

```text
old vs new behavior comparison
shadow traffic
dual read comparison
reconciliation job
roll-forward/rollback route test
```

---

## 27. Refactoring Path: From Monolith to Distributed System Safely

Do not begin by creating repositories.

Begin with understanding boundaries.

### Step 1 — Map capabilities

```text
Application submission
Screening
Approval
Document issuance
Notification
Payment
Audit/reporting
```

### Step 2 — Map data ownership

```text
Which module owns which aggregate/table?
Who writes what?
Who reads what?
Which read is operational vs reporting?
```

### Step 3 — Map synchronous flow

```text
For each user action:
- services/modules called
- DB touched
- external APIs called
- side effects emitted
- transaction boundary
```

### Step 4 — Introduce internal boundaries first

```text
package boundary
application service
ports/adapters
repository ownership
anti-corruption layer
contract DTO
```

### Step 5 — Remove cross-boundary writes

```text
replace table writes with owner API/command
introduce outbox for changes
introduce projection for reads
```

### Step 6 — Extract only stable capability

Criteria:

```text
clear owner
clear data
clear contract
clear SLA
clear failure behavior
clear observability
```

### Step 7 — Add operational guardrails

```text
timeout
retry budget
circuit breaker
bulkhead
rate limit
contract test
trace propagation
runbook
```

---

## 28. Pattern Decision Matrix

| Need | Candidate Pattern | Warning |
|---|---|---|
| Hide internal topology | API Gateway | God gateway |
| Client-specific shape | BFF | Mini-monolith BFF |
| Dynamic endpoints | Service Discovery | Discovery without timeout |
| Independent data ownership | Database per Service | Premature split |
| Complex read model | CQRS | CQRS theater |
| Perfect audit/history | Event Sourcing | Event versioning cost |
| Cross-service operation | Saga | Compensation without domain meaning |
| Reliable event publish | Outbox | Outbox without monitoring |
| Reliable event consume | Inbox/Idempotency | Dedup store never cleaned |
| Legacy migration | Strangler Fig | Eternal strangler |
| Avoid cascading failure | Bulkhead/Circuit/Timeout | Retry storm |
| Consumer compatibility | Contract Test | Contract as documentation only |
| Large frontend aggregation | API Composition/BFF | Fan-out latency |

---

## 29. Advanced Failure Scenarios

### 29.1 Success on Server, Timeout on Client

```text
Client sends approve request.
Server approves and commits.
Response times out.
Client retries.
```

If operation is not idempotent:

```text
duplicate approval
duplicate notification
duplicate event
duplicate document
```

Fix:

```text
idempotency key
operation unique constraint
idempotent command handler
safe retry contract
```

### 29.2 Event Arrives Before Read Model Update

```text
User submits application.
Event published.
Notification reads dashboard projection.
Projection not updated yet.
```

Fix:

```text
include sufficient state in event
or wait for projection version
or design notification to tolerate missing projection
or use same transaction for local read model when required
```

### 29.3 Consumer Does Not Understand New Enum

Producer adds status:

```text
UNDER_REVIEW_BY_BOARD
```

Consumer only knows:

```text
SUBMITTED, APPROVED, REJECTED
```

Fix:

```text
unknown enum handling
contract tests
default display category
versioned semantic rollout
```

### 29.4 Retry Storm

Dependency fails.

All callers retry immediately.

Dependency gets more traffic while already failing.

Fix:

```text
bounded retry
exponential backoff
jitter
circuit breaker
retry budget
load shedding
```

### 29.5 Shared DB Migration Breaks Consumer

Service A changes column meaning.

Service B direct SQL still assumes old meaning.

Fix:

```text
stop direct DB access
owner API/projection
schema compatibility window
migration contract
consumer inventory
```

---

## 30. Security in Distributed Boundaries

Distributed systems introduce security propagation problems.

Questions:

```text
Does downstream receive user identity or service identity?
Can service act on behalf of user?
Are scopes reduced at each boundary?
Is authorization checked at owning service?
Can gateway decision be bypassed internally?
Is audit event tied to original principal?
```

Anti-pattern:

```text
Gateway checks authorization, internal service trusts all internal traffic.
```

Better:

```text
Gateway authenticates and applies coarse policy.
Owning service enforces object-level policy.
Downstream receives signed/validated context.
Audit records original actor and service actor.
```

---

## 31. Performance and Capacity Considerations

Distributed design changes performance model.

### 31.1 Tail Latency

Average latency is misleading. Dashboard with 10 downstream calls is affected by slowest dependency.

Measure:

```text
p50
p95
p99
max
timeout count
queue wait
connection wait
```

### 31.2 Fan-Out Cost

If one request fans out to 20 calls:

```text
100 user requests = 2,000 downstream requests
```

Add retry x3:

```text
potential 6,000 downstream attempts
```

### 31.3 Connection Pooling

Java HTTP/JDBC pools must be designed by dependency, not globally.

```text
profile-service pool
case-service DB pool
external-api pool
message broker connection
```

### 31.4 Virtual Threads

Virtual threads reduce cost of blocking threads, but do not remove:

```text
downstream capacity limit
DB connection limit
rate limit
memory pressure
queue overload
idempotency need
```

Do not use virtual threads as permission for unbounded concurrency.

---

## 32. Case Study: Regulatory Case Platform Extraction

### 32.1 Starting Point

A large Java enterprise platform has modules:

```text
Application
Case
Compliance
Document
Notification
Profile
Workflow
Audit
Report
```

Current issues:

```text
shared Oracle schema
services call each other synchronously
notification logic inside application transaction
dashboard performs many joins
approval updates case, document, notification, audit together
external agency sync can block user request
```

### 32.2 Bad Extraction Plan

```text
Create application-service
Create case-service
Create document-service
Create notification-service
Create workflow-service
Let them all share the same DB initially
Make synchronous HTTP calls for same flow
```

Result:

```text
distributed monolith
shared database abuse
synchronous chain death
harder debugging
no ownership improvement
```

### 32.3 Better Plan

#### Step 1 — Internal modularization

```text
Application module owns application aggregate.
Case module owns case lifecycle.
Document module owns document metadata and generation request.
Notification module owns notification dispatch.
Audit module receives audit events.
```

#### Step 2 — Local outbox

Approval transaction:

```text
update application/case state
insert audit event
insert document generation event
insert notification event
commit
```

#### Step 3 — Async side effects

```text
Document generation async
Notification async
External agency sync async if not required for immediate user response
```

#### Step 4 — Projection

Dashboard reads from projection:

```text
case_dashboard_projection
updated by domain events
contains denormalized fields safe for UI
```

#### Step 5 — Service extraction candidate

Extract notification first if:

```text
it has separate scaling need
failure should not block approval
contract is event-based
idempotency exists
observability exists
```

Extract case lifecycle only after:

```text
state machine boundary is explicit
table ownership clear
other modules no longer write case tables
contracts stabilized
```

---

## 33. Design Review Checklist

### 33.1 Boundary

```text
What is the business capability boundary?
Who owns the data?
Who owns the invariant?
Can this service be deployed independently?
What changes require coordination?
```

### 33.2 Communication

```text
Is this call sync or async? Why?
What is the timeout?
Is there deadline propagation?
Is retry safe?
Is operation idempotent?
What happens if response is lost?
```

### 33.3 Data

```text
Is database shared?
Who writes this table?
How are cross-service queries handled?
Is projection stale? Is that safe?
How is reconciliation done?
```

### 33.4 Contract

```text
Is contract versioned?
Are breaking changes detected?
Are consumers known?
Are unknown fields/enums handled?
Are error semantics stable?
```

### 33.5 Failure

```text
What if dependency is slow?
What if dependency is down?
What if message duplicates?
What if message order changes?
What if partial success occurs?
What if retry storm happens?
```

### 33.6 Observability

```text
Is correlation ID propagated?
Are remote calls traced?
Are queues/backlogs monitored?
Are projection lags visible?
Are contract failures visible?
Is audit separate from technical log?
```

### 33.7 Security

```text
Where is authN performed?
Where is object-level authZ performed?
Is user context propagated safely?
Can internal services bypass policy?
Is audit tied to actor and action?
```

---

## 34. Anti-Pattern Catalog Summary

| Anti-Pattern | Symptom | Consequence | Correction |
|---|---|---|---|
| Distributed Monolith | Services deploy/change together | Monolith complexity + network cost | Revisit boundaries, merge or decouple |
| Nanoservices | Tiny services without ownership | Operational overhead | Use module/library |
| Shared Database Abuse | Many services write same DB | Schema/data coupling | Ownership, API/projection |
| Chatty Services | Many small remote calls | Latency/cost explosion | Batch/projection/BFF |
| Synchronous Chain Death | Long sync dependency chain | Cascading failure | Async side effects, shorten path |
| God Gateway | Business logic in gateway | Bottleneck/coupling | Move logic to owning services/BFF |
| Event Soup | Events without ownership/meaning | Debug/replay chaos | Event taxonomy and ownership |
| Contract by Documentation | Spec not tested | Runtime breakage | Contract tests in CI |
| Eternal Strangler | Legacy never removed | Permanent complexity | Deletion plan and metrics |
| Retry Storm | All clients retry aggressively | Outage amplification | Backoff, jitter, budgets, circuit |
| Distributed Transaction Fantasy | Try to make everything atomic | Blocking/fragility | Saga, compensation, idempotency |
| Common Service Trap | Shared service for all logic | Central bottleneck | Small stable shared kernel |

---

## 35. Staff-Level Discussion Questions

Gunakan pertanyaan ini untuk menguji kedalaman desain:

```text
1. Apa yang membuat service ini benar-benar independen?
2. Data apa yang masih dimiliki bersama?
3. Apakah service boundary mengikuti business capability atau technical layer?
4. Apa maximum synchronous chain length untuk use case utama?
5. Apakah user-facing request menunggu side effect non-critical?
6. Apa yang terjadi jika downstream berhasil tetapi caller timeout?
7. Apa idempotency key untuk mutation ini?
8. Siapa consumer event ini dan apa kontraknya?
9. Apakah event membawa cukup data atau hanya notifikasi?
10. Apakah projection stale aman untuk keputusan ini?
11. Apakah failure dependency terlihat di dashboard/alert?
12. Apakah service bisa rollback independen?
13. Apakah gateway mengandung business decision?
14. Apakah shared library terlalu sering berubah?
15. Jika service ini digabung kembali ke monolith modular, apa yang hilang?
```

Pertanyaan terakhir penting. Jika jawabannya “tidak banyak yang hilang”, mungkin service itu tidak perlu menjadi service.

---

## 36. Summary

Distributed system pattern bukan sekadar menambah service, gateway, queue, dan Kubernetes.

Mental model utama:

```text
Service boundary adalah failure boundary.
Data ownership lebih penting daripada jumlah service.
Remote call bukan method call.
Consistency adalah keputusan desain, bukan default.
Async mengurangi temporal coupling tetapi menambah ordering/idempotency/replay problem.
Microservice tanpa ownership menjadi distributed monolith.
Gateway tanpa batas menjadi god service.
Event tanpa contract menjadi event soup.
Retry tanpa budget menjadi retry storm.
Observability bukan tambahan; ia syarat untuk mengoperasikan distributed system.
```

Top engineer tidak bertanya:

```text
“Pakai microservice atau monolith?”
```

Ia bertanya:

```text
“Boundary mana yang benar-benar perlu independen, failure apa yang harus ditahan, consistency apa yang dibutuhkan, dan cost operasional apa yang sanggup kita bayar?”
```

---

## 37. Referensi Lanjut

Beberapa rujukan penting untuk memperdalam topik:

1. Martin Fowler — Strangler Fig Application.
2. Microservices.io — Microservice Architecture, Database per Service, Saga, API Composition, CQRS, Event Sourcing.
3. Azure Architecture Center — Cloud Design Patterns, Bulkhead, Circuit Breaker, Retry Storm anti-pattern.
4. Google SRE Book — Addressing Cascading Failures.
5. Enterprise Integration Patterns — Messaging, routing, channel, transformation, idempotent receiver.
6. Sam Newman — Building Microservices dan Monolith to Microservices.
7. Chris Richardson — Microservices Patterns.

---

## 38. Posisi Part Ini dalam Seri

Kita sudah melewati:

```text
Part 0  - Pattern thinking
Part 1  - Java 8–25 pattern evolution
Part 2  - Object design fundamentals
Part 3  - SOLID revisited
Part 4–6 - Creational patterns
Part 7–9 - Structural patterns
Part 10–16 - Behavioral patterns
Part 17–21 - Domain/application/data/error patterns
Part 22–25 - Concurrency, resilience, integration
Part 26–29 - Security, observability, API, framework patterns
Part 30 - Architecture patterns
Part 31 - Distributed system patterns and anti-patterns
```

Berikutnya:

```text
32-refactoring-toward-patterns-away-from-antipatterns.md
```

Part berikutnya akan fokus pada cara bergerak dari codebase nyata yang messy menuju pattern yang tepat tanpa big-bang rewrite: characterization test, golden master, extract strategy, split god service, replace conditional with polymorphism, break cyclic dependency, dan safe refactoring sequence.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./30-architecture-layered-hexagonal-clean-modular-monolith.md">⬅️ Part 30 — Architecture Pattern: Layered, Hexagonal, Clean, Modular Monolith</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./32-refactoring-toward-patterns-away-from-antipatterns.md">Refactoring Toward Patterns and Away from Anti-Patterns ➡️</a>
</div>
