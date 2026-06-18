# 33 — Pattern Selection Heuristics: Decision Matrix for Senior Engineers

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: 33 dari 35  
> Topik: Pattern selection, design forces, decision matrix, trade-off, anti-pattern early warning, dan design review judgment  
> Target: Java 8 sampai Java 25

---

## 0. Posisi Materi Ini dalam Seri

Sampai bagian sebelumnya, kita sudah membahas banyak pattern secara individual:

- creational pattern,
- structural pattern,
- behavioral pattern,
- domain modeling pattern,
- service/application pattern,
- persistence boundary,
- error handling,
- concurrency,
- resilience,
- integration,
- security,
- observability,
- API design,
- framework pattern,
- architecture pattern,
- distributed system pattern,
- refactoring toward pattern.

Masalahnya, engineer yang hanya menghafal pattern sering berhenti di pertanyaan:

```text
Pattern apa yang cocok di sini?
```

Engineer yang lebih matang bertanya:

```text
Force apa yang sedang bekerja?
Apa yang berubah?
Apa yang stabil?
Apa yang harus dilindungi?
Apa yang bisa gagal?
Apa yang paling mahal jika desain ini salah?
```

Part ini bukan katalog pattern baru. Part ini adalah **decision framework** untuk memilih pattern dengan judgment.

Pattern selection bukan soal mencari nama pattern yang terlihat keren. Pattern selection adalah proses menentukan **struktur paling sederhana yang masih cukup kuat untuk menahan perubahan, kegagalan, dan kompleksitas yang benar-benar ada**.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memilih pattern berdasarkan design force, bukan berdasarkan selera.
2. Membedakan masalah creation, structure, behavior, boundary, integration, concurrency, dan architecture.
3. Menggunakan axis keputusan seperti volatility, cardinality, ownership, lifecycle, synchrony, failure, consistency, dan cognitive load.
4. Mengetahui kapan pattern terlalu dini.
5. Mengetahui kapan pattern terlambat diperkenalkan.
6. Mengenali early warning sign anti-pattern.
7. Membuat decision matrix sederhana untuk design review.
8. Menulis pattern decision record yang defensible.
9. Mengevaluasi desain Java enterprise secara rasional.
10. Menghindari “pattern-driven development” yang overengineered.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Dalam codebase Java enterprise, pilihan desain sering muncul seperti ini:

```text
Haruskah pakai Strategy atau switch?
Haruskah pakai Factory atau constructor cukup?
Haruskah pakai Repository atau DAO?
Haruskah pakai State Machine atau enum status?
Haruskah pakai event atau direct method call?
Haruskah bikin microservice atau modular monolith?
Haruskah pakai Result object atau exception?
Haruskah pakai decorator, interceptor, atau AOP?
Haruskah pakai outbox atau langsung publish message?
Haruskah pakai CQRS atau query biasa?
```

Jawaban yang buruk biasanya berbentuk:

```text
Pakai pattern X karena best practice.
Pakai pattern Y karena scalable.
Pakai pattern Z karena clean architecture.
```

Jawaban yang lebih matang:

```text
Kita pakai Strategy karena behavior berubah berdasarkan policy version,
jumlah variasi diperkirakan bertambah,
dan kita perlu test setiap variasi secara independen.

Kita tidak pakai State Machine dulu karena lifecycle hanya punya 3 status,
tidak ada transition guard kompleks,
dan state transition belum menjadi sumber defect.
```

Intinya: **pattern harus punya alasan operasional dan evolusioner**.

---

## 3. Mental Model Utama: Pattern sebagai Respons terhadap Force

Pattern muncul ketika ada tekanan desain yang berulang.

Force adalah tekanan yang membuat desain sederhana mulai tidak cukup.

Contoh force:

```text
Behavior sering berubah.
Object creation mulai kompleks.
External system tidak stabil.
Lifecycle punya banyak transition.
Error harus dijelaskan ke user dan auditor.
Call ke remote system bisa timeout.
Data harus konsisten lintas service.
Team berbeda mengubah modul berbeda.
API harus backward compatible.
```

Pattern yang baik adalah struktur yang menyerap force tersebut.

Pattern yang buruk adalah struktur yang ditambahkan tanpa force nyata.

---

## 4. Cara Berpikir: Dari Symptom ke Force ke Pattern

Jangan mulai dari nama pattern.

Mulai dari symptom.

Contoh:

```java
if (type.equals("A")) {
    // logic A
} else if (type.equals("B")) {
    // logic B
} else if (type.equals("C")) {
    // logic C
}
```

Engineer junior mungkin berkata:

```text
Ini harus diganti Strategy.
```

Engineer senior bertanya dulu:

```text
Apakah branch ini berubah sering?
Apakah branch ini punya dependency berbeda?
Apakah branch ini perlu diuji terpisah?
Apakah branch ini domain variant atau hanya mapping sederhana?
Apakah jumlah varian stabil?
Apakah branch ini bagian dari closed set?
Apakah sealed interface + switch lebih cocok?
Apakah polymorphism akan membuat flow lebih jelas atau justru tersebar?
```

Baru setelah itu memilih solusi.

---

## 5. Decision Pipeline

Gunakan pipeline berikut setiap kali memilih pattern.

```text
1. Clarify problem
2. Identify force
3. Identify stable vs volatile parts
4. Identify boundary
5. Identify ownership
6. Identify lifecycle
7. Identify failure mode
8. Estimate change frequency
9. Estimate runtime cost
10. Estimate cognitive cost
11. Choose simplest sufficient pattern
12. Define invariant
13. Define test strategy
14. Define observability point
15. Record decision
```

Pattern selection bukan sekali tembak. Ini proses reasoning.

---

## 6. Axis 1 — Volatility Axis

Pertanyaan utama:

```text
Apa yang paling mungkin berubah?
```

Volatility adalah axis paling penting dalam design pattern.

Abstraction hanya berguna jika memisahkan bagian yang berubah dari bagian yang stabil.

### 6.1 Jenis Volatility

| Jenis perubahan | Contoh | Pattern yang sering relevan |
|---|---|---|
| Algorithm berubah | scoring, validation, pricing | Strategy, Policy, Specification |
| Object family berubah | cloud provider, document renderer | Abstract Factory |
| External API berubah | vendor API, government API | Adapter, Gateway, ACL |
| Lifecycle berubah | case status, approval flow | State, State Machine |
| Output format berubah | PDF, HTML, JSON, XML | Strategy, Visitor, Template Method |
| Error contract berubah | HTTP/API error | Exception Translation, Problem Details |
| Persistence query berubah | search/filter/report | Query Object, Repository split |
| Delivery mechanism berubah | sync ke async | Command, Event, Outbox |
| Authorization rule berubah | role/policy/context | Policy Object, Specification |

### 6.2 Volatility Smell

Jika kode punya banyak komentar seperti:

```java
// temporary rule for agency A
// special case for renewal
// old flow for legacy user
// new rule after policy update
// except when submitted from portal
```

maka kemungkinan ada volatility yang belum dimodelkan.

### 6.3 Heuristic

```text
Jika perubahan terjadi pada value sederhana → parameter/config mungkin cukup.
Jika perubahan terjadi pada behavior → Strategy/Policy.
Jika perubahan terjadi pada lifecycle → State Machine.
Jika perubahan terjadi pada boundary eksternal → Adapter/Gateway/ACL.
Jika perubahan terjadi pada object family → Factory/Abstract Factory.
Jika perubahan terjadi pada operation terhadap closed hierarchy → Visitor atau pattern matching.
```

---

## 7. Axis 2 — Cardinality Axis

Pertanyaan utama:

```text
Berapa banyak variasi sekarang dan nanti?
```

Cardinality memengaruhi apakah pattern layak.

### 7.1 Contoh Cardinality

| Variasi | Solusi yang mungkin |
|---|---|
| 1 varian | direct code |
| 2 varian sederhana | conditional jelas |
| 3–5 varian domain | enum switch, sealed switch, Strategy |
| Banyak varian dengan dependency berbeda | Strategy registry |
| Banyak varian runtime/plugin | SPI, Registry, Abstract Factory |
| Kombinasi banyak rule | Specification, Rule Object |
| Banyak state dan transition | State Machine |

### 7.2 Anti-pattern: Pattern untuk Satu Varian

Contoh overengineering:

```java
interface ApprovalStrategy {
    ApprovalResult approve(ApprovalRequest request);
}

final class DefaultApprovalStrategy implements ApprovalStrategy {
    public ApprovalResult approve(ApprovalRequest request) {
        return ApprovalResult.approved();
    }
}
```

Jika tidak ada variasi nyata, ini hanya ceremony.

Namun, ada pengecualian.

Pattern untuk satu varian bisa masuk akal jika:

```text
- variasi kedua sudah pasti akan datang,
- boundary dependency ingin dijaga,
- module lain hanya boleh melihat interface,
- testing butuh seam,
- framework/plugin contract membutuhkan abstraction.
```

### 7.3 Rule

```text
Jangan abstraksikan jumlah variasi yang tidak ada,
kecuali abstraction itu melindungi boundary yang memang penting.
```

---

## 8. Axis 3 — Ownership Axis

Pertanyaan utama:

```text
Siapa yang memiliki keputusan ini?
```

Ownership menentukan lokasi logic.

Contoh buruk:

```java
if (caseRecord.getStatus().equals("SUBMITTED")
        && user.hasRole("OFFICER")
        && !caseRecord.isLocked()) {
    // allow approve
}
```

Jika logic ini muncul di controller, service, UI adapter, dan batch job, ownership tidak jelas.

### 8.1 Ownership Candidate

| Logic | Owner yang lebih tepat |
|---|---|
| Field format validation | Value object / input validator |
| Business eligibility | Policy / Specification |
| Lifecycle transition | State Machine / Aggregate |
| Persistence query | Repository / Query Object |
| External API translation | Adapter / Gateway |
| Authorization | Authorization Policy / Access Service |
| Error mapping | Exception Translator / Error Mapper |
| UI display shaping | Presenter / View Model Assembler |

### 8.2 Ownership Smell

```text
Logic sama muncul di banyak layer.
Controller tahu terlalu banyak domain rule.
Repository tahu workflow.
DTO tahu persistence behavior.
Entity tahu HTTP error.
Domain object tahu framework annotation terlalu banyak.
```

### 8.3 Heuristic

```text
Jika logic menjawab “bolehkah?” → policy/specification/authz.
Jika logic menjawab “state boleh pindah ke mana?” → state machine.
Jika logic menjawab “bagaimana bicara ke sistem luar?” → gateway/adapter.
Jika logic menjawab “bagaimana data disajikan?” → presenter/view model.
Jika logic menjawab “bagaimana transaksi use case berjalan?” → application service/handler.
```

---

## 9. Axis 4 — Lifecycle Axis

Pertanyaan utama:

```text
Apakah object/proses ini punya lifecycle yang penting?
```

Lifecycle sering diremehkan.

Contoh:

```text
Draft → Submitted → UnderReview → Approved → Issued
                       ↓
                    Rejected
```

Jika lifecycle hanya disimpan sebagai string status, rule akan menyebar.

### 9.1 Lifecycle Complexity Level

| Level | Gejala | Pattern |
|---|---|---|
| Simple status label | status hanya display | enum/string cukup |
| Status dengan allowed action | action tergantung status | enum method / sealed state |
| Status dengan transition guard | rule saat pindah state | State Machine |
| Status dengan audit, actor, reason | perlu defensibility | Workflow Object + Audit Event |
| Long-running process | step lintas waktu/sistem | Saga / Process Manager / BPMN |

### 9.2 Lifecycle Smell

```text
status == "X" tersebar di banyak file.
Illegal transition dicegah oleh UI saja.
Tidak ada catatan siapa mengubah status.
Transition punya side effect tersembunyi.
Batch job mengubah status tanpa guard sama.
Status baru membuat banyak bug regression.
```

### 9.3 Heuristic

```text
Jika status hanya label → jangan pakai State Machine.
Jika status mengontrol behavior → mulai modelkan state.
Jika transition harus defensible → State Machine explicit.
Jika process long-running lintas sistem → Saga/Process Manager/BPMN.
```

---

## 10. Axis 5 — Synchrony Axis

Pertanyaan utama:

```text
Apakah pekerjaan harus selesai sekarang, atau bisa terjadi nanti?
```

Synchrony memengaruhi pilihan Command, Event, Queue, Outbox, Saga, dan API response model.

### 10.1 Synchronous Call Cocok Jika

```text
- user butuh jawaban langsung,
- latency dapat dikendalikan,
- dependency reliable,
- operasi pendek,
- failure bisa dikembalikan ke caller,
- consistency langsung diperlukan.
```

### 10.2 Asynchronous Event Cocok Jika

```text
- pekerjaan bisa dilanjutkan nanti,
- caller tidak butuh hasil penuh,
- dependency lambat/tidak stabil,
- side effect banyak,
- fan-out ke banyak consumer,
- perlu decoupling waktu.
```

### 10.3 Decision Table

| Pertanyaan | Jika ya | Pattern |
|---|---|---|
| Caller butuh hasil final? | Ya | synchronous command/query |
| Side effect bisa delayed? | Ya | event/outbox |
| Perlu retry durable? | Ya | queue + inbox/outbox |
| Ada distributed consistency? | Ya | saga/compensation |
| Consumer banyak? | Ya | pub/sub event |
| Perlu exactly once? | Biasanya tidak realistis | idempotency/dedup |

### 10.4 Anti-pattern

```text
Menggunakan event hanya untuk menyembunyikan synchronous dependency.
Menggunakan synchronous chain panjang untuk proses yang sebenarnya long-running.
Mengembalikan success ke user sebelum side effect penting benar-benar durable.
```

---

## 11. Axis 6 — Failure Axis

Pertanyaan utama:

```text
Apa yang terjadi jika bagian ini gagal?
```

Pattern selection harus mempertimbangkan failure.

### 11.1 Failure Type

| Failure | Design response |
|---|---|
| Validation fail | Result / validation aggregation |
| Business rule fail | Domain error / policy result |
| External timeout | timeout + retry + circuit breaker |
| Partial success | saga / compensation |
| Duplicate request | idempotency key |
| Duplicate message | inbox/dedup |
| Lost event | outbox |
| Illegal state | state machine invariant |
| Authorization fail | deny-before-mutation |
| Unknown error | exception translation + observability |

### 11.2 Failure Smell

```text
Semua error menjadi RuntimeException.
Retry dilakukan tanpa idempotency.
External call dalam DB transaction.
Message consumer tidak deduplicate.
Partial failure tidak punya recovery path.
Error response tidak membedakan user mistake dan system fault.
```

### 11.3 Heuristic

```text
Jika failure lokal dan recoverable → Result mungkin cocok.
Jika failure teknis tidak bisa dipulihkan lokal → exception cocok.
Jika failure lintas sistem → durable pattern diperlukan.
Jika failure bisa duplicate side effect → idempotency wajib.
Jika failure harus diaudit → error/audit event harus explicit.
```

---

## 12. Axis 7 — Consistency Axis

Pertanyaan utama:

```text
Konsistensi seperti apa yang benar-benar dibutuhkan?
```

Banyak desain buruk berasal dari asumsi semua hal harus immediate consistent.

### 12.1 Consistency Choice

| Kebutuhan | Pattern |
|---|---|
| Single aggregate consistency | transaction + aggregate invariant |
| Multi-table same DB | transaction script/application service |
| Multi-service consistency | saga/outbox/inbox |
| Read model eventually consistent | CQRS/read model projection |
| User action must not duplicate | idempotency key |
| Eventual notification | domain/integration event |

### 12.2 Consistency Smell

```text
Distributed transaction dipakai untuk menutupi boundary yang buruk.
Service berbagi database demi consistency cepat.
UI menganggap read model selalu real-time.
Event dipublish sebelum transaction commit.
Saga tidak punya compensation bermakna.
```

### 12.3 Heuristic

```text
Jangan memilih pattern distribusi sebelum jelas consistency requirement-nya.
Sering kali modular monolith + transaction boundary lebih baik daripada microservice premature.
```

---

## 13. Axis 8 — Runtime Cost Axis

Pertanyaan utama:

```text
Berapa biaya runtime pattern ini?
```

Pattern bukan hanya struktur code. Pattern punya biaya eksekusi.

### 13.1 Contoh Runtime Cost

| Pattern | Potensi cost |
|---|---|
| Decorator chain | call depth, allocation, debugging cost |
| Dynamic proxy/AOP | reflection/proxy overhead, hidden flow |
| Strategy registry | lookup cost, initialization cost |
| State machine | transition lookup, audit write |
| Outbox | extra write, polling/relay cost |
| CQRS | projection lag, storage duplication |
| Event sourcing | replay cost, schema evolution cost |
| Flyweight | lookup contention, cache complexity |
| Generic repository | inefficient queries |
| Reflection mapper | startup/runtime overhead |

### 13.2 Runtime Cost Tidak Selalu Buruk

Cost bisa diterima jika membeli:

```text
- correctness,
- auditability,
- evolvability,
- testability,
- isolation,
- resilience,
- maintainability.
```

### 13.3 Heuristic

```text
Pattern di hot path harus punya alasan kuat.
Pattern di boundary bisnis sering lebih layak walau ada overhead.
Pattern yang menambah IO/storage harus punya operational story.
```

---

## 14. Axis 9 — Cognitive Load Axis

Pertanyaan utama:

```text
Apakah team bisa memahami, memelihara, dan mengubah desain ini dengan aman?
```

Design yang benar secara teori bisa gagal jika terlalu sulit dipahami team.

### 14.1 Cognitive Load Sources

```text
Terlalu banyak indirection.
Terlalu banyak interface satu implementasi.
AOP/proxy magic.
Reflection-heavy framework.
Event flow tanpa tracing.
Generic abstraction berlebihan.
Naming tidak domain-oriented.
Package structure tidak mengikuti boundary.
```

### 14.2 Heuristic

```text
Jika pattern membuat flow tidak bisa dibaca tanpa debugger, pattern itu harus membeli manfaat besar.
Jika manfaatnya hanya “terlihat clean”, jangan pakai.
```

### 14.3 Simplicity Test

Tanyakan:

```text
Bisakah engineer baru menjelaskan flow utama dalam 15 menit?
Bisakah bug production ditrace dari request ke DB/event/log?
Bisakah test ditulis tanpa boot seluruh container?
Bisakah requirement baru ditambahkan tanpa memahami seluruh sistem?
```

Jika jawabannya tidak, cognitive load terlalu tinggi.

---

## 15. Axis 10 — Testability Axis

Pertanyaan utama:

```text
Apakah pattern ini membuat behavior lebih mudah diuji?
```

Pattern yang baik sering menciptakan seam.

### 15.1 Pattern dan Test Benefit

| Pattern | Test benefit |
|---|---|
| Strategy | test setiap behavior terpisah |
| Specification | test rule sebagai unit |
| State Machine | test transition table |
| Gateway | mock/stub external system |
| Repository | isolate persistence boundary |
| Command Handler | test use case boundary |
| Result object | assert domain failure tanpa exception noise |
| Outbox | assert durable integration event |
| Presenter | test output shaping tanpa UI |

### 15.2 Testability Smell

```text
Test harus boot Spring untuk semua logic.
Mock terlalu banyak karena service terlalu banyak dependency.
Tidak ada cara test illegal transition.
Rule hanya bisa dites lewat end-to-end flow.
External API harus dipanggil untuk test lokal.
```

### 15.3 Heuristic

```text
Jika behavior penting tidak bisa diuji langsung, kemungkinan ownership atau boundary salah.
```

---

## 16. Axis 11 — Migration Cost Axis

Pertanyaan utama:

```text
Berapa biaya mengubah desain lama ke desain baru?
```

Pattern introduction harus mempertimbangkan migration path.

### 16.1 Migration Style

| Kondisi | Pendekatan |
|---|---|
| Logic kecil | direct refactor |
| Logic besar tanpa test | characterization test dulu |
| External boundary buruk | introduce adapter/facade dulu |
| Flow lama masih production | branch by abstraction |
| Modul sangat coupling | strangler inside monolith |
| Data model sulit | parallel read model |
| Event migration | dual publish sementara dengan reconciliation |

### 16.2 Anti-pattern: Big Bang Pattern Rewrite

Contoh buruk:

```text
Kita akan refactor seluruh module ke Clean Architecture + CQRS + State Machine sekaligus.
```

Risiko:

```text
- behavior berubah tanpa sadar,
- regression besar,
- deadline meledak,
- team kehilangan konteks,
- production bug meningkat,
- desain baru belum terbukti.
```

### 16.3 Heuristic

```text
Pattern yang bagus tapi tidak bisa dimigrasikan dengan aman belum menjadi solusi yang bagus.
```

---

## 17. Pattern Selection by Problem Category

### 17.1 Object Creation Problem

Pertanyaan:

```text
Apakah object creation punya rule, subtype, dependency, lifecycle, atau family?
```

Decision:

| Masalah | Pattern |
|---|---|
| Construction sederhana | constructor |
| Nama construction penting | static factory |
| Banyak optional field | builder |
| Required steps harus berurutan | staged builder |
| Subtype dipilih berdasarkan input | factory method |
| Family object konsisten | abstract factory |
| Copy object dengan modifikasi | copy factory / toBuilder |
| Test fixture kompleks | test data builder |

Avoid:

```text
Factory untuk object trivial.
Builder untuk record 2 field.
Abstract Factory tanpa family nyata.
Constructor melakukan IO.
```

---

### 17.2 Behavior Variation Problem

Pertanyaan:

```text
Apakah behavior berubah berdasarkan type, policy, context, atau runtime configuration?
```

Decision:

| Masalah | Pattern |
|---|---|
| Algorithm alternatif | Strategy |
| Business rule composable | Specification |
| Policy dengan reason/evidence | Policy Object / Rule Object |
| Closed variants modern Java | sealed interface + switch |
| Many operations over closed hierarchy | Visitor |
| Complex workflow behavior by state | State Pattern / State Machine |

Avoid:

```text
Strategy untuk branch dua baris.
Visitor untuk hierarchy yang sering bertambah.
Rule engine untuk rule sederhana.
Enum strategy menjadi god object.
```

---

### 17.3 Boundary Problem

Pertanyaan:

```text
Apakah model/protocol luar harus dicegah masuk ke domain internal?
```

Decision:

| Masalah | Pattern |
|---|---|
| Interface tidak cocok | Adapter |
| Simplify subsystem | Facade |
| Remote system access | Gateway |
| External model dangerous | Anti-Corruption Layer |
| API response shaping | Presenter/View Model |
| Error normalization | Exception Translator |
| Security boundary | Secure Facade / Authorization Policy |

Avoid:

```text
Pass-through adapter tanpa translation.
Facade yang hanya mengganti nama method.
Domain memakai DTO vendor.
Controller langsung pakai external client.
```

---

### 17.4 Lifecycle Problem

Pertanyaan:

```text
Apakah object/process punya state transition penting?
```

Decision:

| Masalah | Pattern |
|---|---|
| Status display | enum |
| Status controls actions | enum method / sealed state |
| Transition guarded | State Machine |
| Transition must be audited | Workflow Object + Audit Event |
| Long-running distributed process | Saga / Process Manager |
| Human workflow complex | BPMN/workflow engine |

Avoid:

```text
Boolean flags sebagai lifecycle.
Status string tersebar.
State Machine untuk CRUD sederhana.
Workflow engine untuk flow kecil.
```

---

### 17.5 Error Handling Problem

Pertanyaan:

```text
Apakah failure ini domain-level, validation-level, technical-level, atau distributed-level?
```

Decision:

| Masalah | Pattern |
|---|---|
| Validation many errors | Validation Result |
| Domain rejection | Domain Error / Result |
| Technical boundary error | Exception Translation |
| API error contract | Problem Details |
| Retryable external failure | Retry + Timeout + Circuit Breaker |
| Partial distributed failure | Saga / Compensation |
| Duplicate side effect | Idempotency |

Avoid:

```text
throws Exception.
Parsing error message string.
Returning null for failure.
HTTP 500 for all business errors.
Retry every exception.
```

---

### 17.6 Integration Problem

Pertanyaan:

```text
Apakah ada data/side effect melintasi process, service, atau system boundary?
```

Decision:

| Masalah | Pattern |
|---|---|
| External call wrapper | Gateway |
| Durable event after DB commit | Outbox |
| Idempotent consumer | Inbox |
| Duplicate request | Idempotency Key |
| Multi-step distributed business process | Saga |
| Read model optimized | CQRS projection |
| Legacy replacement | Strangler Fig |

Avoid:

```text
Dual write.
Publish event before commit.
Assume message exactly once.
Compensation tanpa makna bisnis.
Shared database antar service.
```

---

### 17.7 Concurrency Problem

Pertanyaan:

```text
Apakah masalahnya state sharing, task execution, cancellation, atau coordination?
```

Decision:

| Masalah | Pattern |
|---|---|
| State should not mutate | Immutability |
| State owned by one thread/request | Confinement |
| Wait until condition | Guarded Suspension |
| Avoid duplicate operation | Balking |
| Queue work | Producer-Consumer |
| Parallel independent tasks | Executor / Structured Concurrency |
| Async composition | CompletableFuture |
| Request scoped context | ScopedValue |

Avoid:

```text
Shared mutable state tanpa owner.
Unbounded executor.
Lost interrupt.
Timeout tanpa cancellation.
ThreadLocal leak.
Parallel stream untuk blocking IO.
```

---

### 17.8 Architecture Boundary Problem

Pertanyaan:

```text
Apakah dependency direction dan module ownership jelas?
```

Decision:

| Masalah | Pattern |
|---|---|
| Simple app | Layered Architecture |
| Domain needs framework independence | Hexagonal/Clean |
| Large codebase one deployable | Modular Monolith |
| Separate team/process scale | Microservice |
| Legacy displacement | Strangler |
| UI-specific backend | BFF |
| Many clients/services | API Gateway |

Avoid:

```text
Clean architecture ceremony untuk CRUD kecil.
Microservice karena trend.
Layer bypass.
Package-by-layer untuk huge domain.
Distributed monolith.
```

---

## 18. Pattern Compatibility Matrix

Pattern sering dikombinasikan. Tetapi kombinasi harus masuk akal.

| Pattern A | Cocok dengan | Catatan |
|---|---|---|
| Command Handler | Validation Chain, Authorization Policy, Outbox | use case boundary kuat |
| State Machine | Policy, Audit Event, Outbox | lifecycle defensible |
| Gateway | Adapter, Retry, Circuit Breaker, Exception Translation | external boundary sehat |
| Repository | Query Object, Specification | hati-hati leaky ORM |
| Strategy | Factory/Registry | jika runtime selection nyata |
| Specification | Composite, Rule Object | cocok untuk rule explanation |
| DTO | Mapper, Assembler, Presenter | boundary model jelas |
| Result | Problem Details Mapper | domain failure ke API contract |
| Decorator | Metrics/Logging/Retry | ordering penting |
| Outbox | Inbox, Idempotency, Saga | durable integration |
| Hexagonal | Ports/Adapters, Gateway, Repository | dependency control |
| Modular Monolith | Module API, Domain Events | boundary internal kuat |

### 18.1 Kombinasi Berisiko

| Kombinasi | Risiko |
|---|---|
| AOP + Transaction + Retry | retry bisa mengulang transaction/side effect salah |
| Event + No Idempotency | duplicate side effect |
| Generic Repository + Complex Query | performance tersembunyi |
| Clean Architecture + Anemic Domain | ceremony tanpa behavior |
| State Machine + Scattered Status Update | invariant bocor |
| Service Locator + DI | dependency ambiguity |
| Parallel Stream + Blocking IO | common pool starvation |
| Circuit Breaker + Bad Timeout | breaker terlambat membuka |
| Builder + Mutable Product | invariant bisa rusak setelah build |
| DTO Reuse Across Boundaries | accidental coupling |

---

## 19. Early Warning Signs of Anti-Pattern

### 19.1 Pattern Naming Smell

```text
Class bernama Manager tanpa tanggung jawab jelas.
Class bernama Helper berisi business rule.
Class bernama Util bergantung pada domain.
Service berisi semua hal.
Factory melakukan validasi, IO, cache, dan logging bisnis.
Strategy punya satu implementasi selama bertahun-tahun tanpa boundary reason.
```

### 19.2 Flow Smell

```text
Untuk memahami satu use case harus buka 20 class.
Debug harus step through proxy/decorator/interceptor berlapis.
Business rule tersebar di controller, service, repository, dan frontend.
Exception ditangkap lalu diganti RuntimeException tanpa konteks.
Event consumer memanggil balik service publisher secara sinkron.
```

### 19.3 Boundary Smell

```text
External DTO masuk sampai domain.
JPA entity keluar sebagai REST response.
Controller tahu SQL detail.
Repository tahu HTTP user context.
Domain object tahu Kafka topic.
Security role check tersebar di banyak service.
```

### 19.4 Evolution Smell

```text
Requirement baru selalu butuh edit banyak file tidak terkait.
Status baru menyebabkan regression di UI, batch, API, dan report.
Vendor API berubah membuat domain test gagal.
Rule baru menyebabkan branch if-else makin dalam.
Team takut refactor karena test terlalu high-level.
```

### 19.5 Operational Smell

```text
Log banyak tapi root cause tidak ketemu.
Tidak ada correlation ID.
Retry menyebabkan traffic spike.
Timeout berbeda-beda tanpa policy.
Message duplicate membuat double processing.
Read model lag tidak terlihat.
```

---

## 20. Pattern Decision Matrix Template

Gunakan template ini saat design review.

```markdown
# Pattern Decision Matrix

## Problem
Apa masalah desain yang ingin diselesaikan?

## Context
Di layer/module mana masalah terjadi?
Siapa caller dan callee?
Apa boundary-nya?

## Forces
- Volatility:
- Cardinality:
- Ownership:
- Lifecycle:
- Synchrony:
- Failure:
- Consistency:
- Runtime cost:
- Cognitive load:
- Testability:
- Migration cost:

## Candidate Options
1. Direct/simple code
2. Pattern A
3. Pattern B
4. Framework/library solution

## Evaluation
| Option | Benefit | Cost | Risk | Fit |
|---|---|---|---|---|
| Direct | | | | |
| Pattern A | | | | |
| Pattern B | | | | |

## Decision
Chosen:

## Why

## Consequences
Positive:
Negative:

## Invariants

## Testing Strategy

## Observability

## Revisit Trigger
Kapan keputusan ini harus dievaluasi ulang?
```

---

## 21. Example 1 — Strategy vs Switch vs Sealed Pattern Matching

### 21.1 Problem

Ada logic untuk menghitung penalty berdasarkan violation type.

```java
int calculatePenalty(Violation violation) {
    return switch (violation.type()) {
        case LATE_SUBMISSION -> 100;
        case FALSE_DECLARATION -> 500;
        case UNLICENSED_ACTIVITY -> 1000;
    };
}
```

Apakah perlu Strategy?

### 21.2 Force Analysis

| Axis | Observation |
|---|---|
| Volatility | penalty rule mungkin berubah per policy year |
| Cardinality | 3 sekarang, bisa bertambah |
| Ownership | penalty logic domain policy |
| Lifecycle | tidak ada state transition |
| Failure | rule bisa reject/require explanation |
| Consistency | local decision |
| Runtime cost | minimal |
| Cognitive load | switch lebih mudah saat simple |
| Testability | switch bisa dites, Strategy lebih granular |

### 21.3 Decision

Jika rule hanya mapping sederhana:

```text
Gunakan switch expression.
```

Jika rule mulai punya dependency, explanation, effective date, exception, dan audit:

```text
Gunakan Policy/Rule Object.
```

### 21.4 Evolution

Tahap 1:

```java
return switch (type) { ... };
```

Tahap 2:

```java
record PenaltyRule(
        ViolationType type,
        LocalDate effectiveFrom,
        Money amount,
        String legalBasis
) {}
```

Tahap 3:

```java
interface PenaltyPolicy {
    PenaltyDecision decide(Violation violation, PolicyContext context);
}
```

Jangan loncat ke Strategy jika force-nya belum ada.

---

## 22. Example 2 — Enum Status vs State Machine

### 22.1 Problem

Case punya status:

```text
DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED
```

### 22.2 Simple Approach

```java
enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Cukup jika:

```text
- status hanya display,
- transition tidak kompleks,
- authorization di tempat lain sederhana,
- tidak perlu audit transition rinci.
```

### 22.3 State Machine Needed Jika

```text
- allowed action tergantung status,
- transition harus punya reason,
- actor harus terekam,
- illegal transition sering bug,
- batch/API/UI semua bisa mengubah status,
- auditor perlu menjelaskan kenapa status berubah.
```

### 22.4 Decision

```text
Jika lifecycle adalah domain invariant, pakai State Machine.
Jika status hanya label, enum cukup.
```

---

## 23. Example 3 — Direct External Client vs Gateway + ACL

### 23.1 Problem

Service memanggil external API langsung.

```java
ExternalResponse response = vendorClient.call(request);
caseRecord.setExternalStatus(response.status());
```

### 23.2 Smell

```text
Vendor status masuk ke domain.
Vendor exception bocor.
Vendor timeout tidak distandardisasi.
Vendor request model menyebar.
Test domain butuh vendor stub.
```

### 23.3 Decision

Jika API eksternal trivial dan stabil:

```text
Client wrapper sederhana cukup.
```

Jika API eksternal punya semantic mismatch, error berbeda, model berubah, atau critical:

```text
Gateway + Adapter + ACL.
```

### 23.4 Pattern Composition

```text
Application Service
  -> Domain Policy
  -> External Gateway Port
       -> Adapter
       -> Retry/Timeout/CircuitBreaker Decorator
       -> Vendor Client
```

---

## 24. Example 4 — Direct Publish vs Outbox

### 24.1 Problem

Setelah approval disimpan, sistem publish event.

```java
caseRepository.save(caseRecord);
eventPublisher.publish(new CaseApprovedEvent(caseId));
```

### 24.2 Failure

Jika DB commit berhasil tapi publish gagal:

```text
case approved, downstream tidak tahu.
```

Jika publish berhasil tapi DB rollback:

```text
downstream menerima event palsu.
```

### 24.3 Decision

Jika event hanya in-memory notification lokal:

```text
Direct domain event after transaction mungkin cukup.
```

Jika event keluar process/system boundary dan harus durable:

```text
Outbox pattern.
```

---

## 25. Example 5 — Layered vs Hexagonal vs Modular Monolith

### 25.1 Problem

Java enterprise app makin besar. Controller, service, repository saling coupling.

### 25.2 Decision by Force

| Force | Pattern |
|---|---|
| Simple CRUD app | Layered |
| Domain rule kompleks | Hexagonal/Clean boundary |
| Banyak module dalam satu deployment | Modular Monolith |
| Independent team/deploy/scale needed | Microservice |

### 25.3 Warning

```text
Clean architecture tidak otomatis membuat domain kaya.
Microservice tidak otomatis membuat boundary benar.
Modular monolith tidak otomatis modular jika package dependency liar.
```

---

## 26. Senior-Level Design Review Questions

Gunakan pertanyaan ini dalam review.

### 26.1 Problem Clarity

```text
Masalah apa yang pattern ini selesaikan?
Apakah masalah itu nyata sekarang atau spekulatif?
Apa symptom yang terlihat di code/production/team?
```

### 26.2 Volatility

```text
Bagian mana yang berubah?
Seberapa sering berubah?
Apakah perubahan itu domain, technical, atau integration?
Apakah pattern ini mengisolasi perubahan tersebut?
```

### 26.3 Boundary

```text
Boundary apa yang dilindungi?
Apakah dependency direction benar?
Apakah model luar bocor ke dalam?
Apakah framework bocor ke domain?
```

### 26.4 Invariant

```text
Invariant apa yang dijaga?
Di mana invariant ditegakkan?
Apakah semua entry point melewati invariant yang sama?
```

### 26.5 Failure

```text
Apa yang terjadi jika dependency gagal?
Apa yang terjadi jika operasi diulang?
Apa yang terjadi jika sebagian berhasil?
Apa yang terjadi jika message duplicate?
Apa yang terjadi jika timeout?
```

### 26.6 Testability

```text
Behavior penting bisa dites di level mana?
Apakah perlu boot framework untuk test rule?
Apakah illegal case bisa dites?
Apakah external failure bisa disimulasikan?
```

### 26.7 Observability

```text
Jika gagal production, log/metric/trace apa yang membuktikan penyebabnya?
Apakah correlation ID terjaga?
Apakah decision result punya reason?
Apakah audit event cukup defensible?
```

### 26.8 Cost

```text
Apa runtime cost?
Apa cognitive cost?
Apa migration cost?
Apa operational cost?
Apa maintenance cost?
```

### 26.9 Simplicity

```text
Apakah direct code cukup?
Apa yang terjadi jika kita tidak memakai pattern ini sekarang?
Kapan kita harus revisit keputusan ini?
```

---

## 27. Pattern Selection Scorecard

Gunakan score 1 sampai 5.

```text
1 = rendah / tidak penting
5 = tinggi / sangat penting
```

| Axis | Score | Meaning |
|---|---:|---|
| Volatility |  | Seberapa sering bagian ini berubah |
| Cardinality |  | Berapa banyak varian |
| Ownership clarity |  | Seberapa jelas owner logic saat ini |
| Lifecycle complexity |  | Seberapa penting state transition |
| Failure impact |  | Dampak jika gagal |
| Consistency need |  | Seberapa kuat consistency requirement |
| Runtime sensitivity |  | Seberapa hot path operasi ini |
| Cognitive load risk |  | Seberapa sulit dipahami |
| Testability need |  | Seberapa penting isolated testing |
| Migration risk |  | Risiko memperkenalkan pattern |

### 27.1 Interpretation

```text
Volatility tinggi + cardinality tinggi → Strategy/Policy/Specification.
Lifecycle tinggi + failure impact tinggi → State Machine/Workflow Object.
External boundary tinggi + failure tinggi → Gateway/ACL/Resilience.
Consistency tinggi lintas boundary → Outbox/Saga/Idempotency.
Cognitive load tinggi + volatility rendah → sederhanakan, jangan tambah pattern.
Migration risk tinggi → incremental refactoring.
```

---

## 28. Anti-Pattern Early Warning Table

| Warning | Kemungkinan anti-pattern | Refactoring arah |
|---|---|---|
| `if status ==` tersebar | Workflow hidden in services | State Machine |
| `if role ==` tersebar | Scattered authorization | Policy/Authz service |
| External DTO di domain | External model infection | ACL/Adapter |
| `catch(Exception)` everywhere | Error semantics collapse | Exception Translation |
| Event duplicate side effect | Non-idempotent consumer | Inbox/Dedup |
| Service 2000 lines | God Service | Command Handler + Domain Service |
| Repository punya 100 method | Query dumping ground | Query Object / read model |
| DTO dipakai semua layer | Universal DTO | Boundary-specific models |
| Factory melakukan IO | Factory-service confusion | Split factory/service |
| AOP behavior tidak terlihat | Annotation magic | Explicit decorator/interceptor docs |
| Interface satu implementasi tanpa reason | Abstraction ceremony | Inline or document boundary |
| Module cycle | Fake modularity | Define module API |
| Sync chain panjang | Synchronous chain death | Async/event/process redesign |
| Retry tanpa idempotency | Retry storm / double write | Idempotency + retry budget |

---

## 29. Choosing Boring Code

Top engineer tidak selalu memilih pattern paling sophisticated.

Sering kali keputusan terbaik adalah:

```text
Gunakan kode biasa yang jelas.
```

Boring code cocok jika:

```text
- requirement stabil,
- variasi sedikit,
- failure impact rendah,
- lifecycle sederhana,
- boundary tidak kritikal,
- team butuh clarity,
- cost abstraction lebih besar dari manfaat.
```

Contoh:

```java
boolean isAdult(LocalDate birthDate, Clock clock) {
    return Period.between(birthDate, LocalDate.now(clock)).getYears() >= 18;
}
```

Tidak perlu:

```text
AgeEligibilityStrategyFactoryProviderRegistry
```

Kecuali memang ada force:

```text
- rule umur berbeda per jurisdiction,
- effective date policy,
- audit reason,
- exception rule,
- external policy config,
- legal basis tracking.
```

---

## 30. Choosing Abstraction

Abstraction layak jika:

```text
- melindungi boundary penting,
- memisahkan volatile behavior,
- menciptakan test seam,
- menyatukan invariant,
- mengurangi duplication berbahaya,
- membuat failure handling konsisten,
- memungkinkan migration aman,
- menyembunyikan detail eksternal,
- mengurangi blast radius perubahan.
```

Abstraction tidak layak jika hanya:

```text
- mengikuti pattern katalog,
- membuat code terlihat enterprise,
- mengantisipasi masa depan yang tidak jelas,
- menghindari berpikir domain,
- menutupi naming buruk,
- membuat flow lebih sulit tanpa manfaat nyata.
```

---

## 31. Pattern Decision Record Example

```markdown
# Pattern Decision Record: Approval Eligibility Policy

## Status
Accepted

## Context
Approval eligibility currently lives in `ApprovalService` as nested conditional logic.
The same rule is partially duplicated in API validation and batch approval.
Policy changes are expected twice per year.
Audit requires explanation of rejection reasons.

## Forces
- Volatility: high, policy changes regularly.
- Cardinality: medium, currently 7 rules, expected to grow.
- Ownership: unclear, duplicated across service/API/batch.
- Failure: business rejection must be explainable.
- Testability: each rule must be tested independently.
- Cognitive load: current nested condition is hard to review.

## Decision
Introduce `ApprovalEligibilityPolicy` composed of rule objects.
Each rule returns `RuleEvaluation` with code, result, and reason.
Application service will call the policy before state transition.

## Alternatives Considered
1. Keep conditional logic in service.
2. Use enum switch.
3. Use external rule engine.
4. Use Specification/Rule Object.

## Consequences
Positive:
- Rules become explicit and testable.
- Rejection reason becomes consistent.
- API and batch reuse same policy.

Negative:
- More classes.
- Need ordering convention.
- Need governance for adding rules.

## Invariants
- Approval cannot proceed if any blocking rule fails.
- Every rejection must include code and reason.
- Every rule must be deterministic for same input.

## Testing
- Unit test each rule.
- Policy composition test.
- Regression test for existing approval scenarios.

## Observability
- Log policy decision summary with correlation ID.
- Emit metric by rejection code.
- Persist audit event for final rejection reason.

## Revisit Trigger
Revisit if rules become user-configurable or require non-developer maintenance.
```

---

## 32. Pattern Selection in Java 8–25

Modern Java changes pattern selection.

### 32.1 Java 8

Lambda and functional interface reduce ceremony.

Before:

```java
class AmountComparator implements Comparator<Invoice> {
    public int compare(Invoice a, Invoice b) {
        return a.amount().compareTo(b.amount());
    }
}
```

After:

```java
Comparator<Invoice> byAmount = Comparator.comparing(Invoice::amount);
```

Impact:

```text
Small Strategy often becomes lambda.
Callback becomes functional interface.
Template hooks can become function parameters.
```

### 32.2 Java 16+ Records

Records reduce DTO/value object ceremony.

Impact:

```text
DTO, Command, Query, Event payload, Result object become clearer.
But record is not automatically good domain model.
```

### 32.3 Java 17+ Sealed Classes

Sealed classes help model closed alternatives.

Impact:

```text
Visitor may be replaced by sealed hierarchy + switch.
Enum with payload limitations can become sealed type.
Result/Either becomes ergonomic.
Domain alternatives become explicit.
```

### 32.4 Pattern Matching Switch

Pattern matching switch reduces instanceof chains.

Impact:

```text
Closed hierarchy operation can be direct and type-safe.
But too much logic in switch can centralize too much behavior.
```

### 32.5 Virtual Threads

Virtual threads reduce need for reactive complexity for many blocking IO workloads.

Impact:

```text
Concurrency pattern choice shifts from callback-heavy to structured blocking style.
But resource limits, DB pools, rate limits, and cancellation still matter.
```

### 32.6 Scoped Values and Structured Concurrency

Impact:

```text
Request context propagation can avoid ThreadLocal leak.
Fan-out/fan-in can become structured, cancellable, and easier to reason about.
```

---

## 33. Common Wrong Pattern Selection

### 33.1 Strategy When Switch Is Better

Wrong if:

```text
- closed set,
- simple mapping,
- no dependencies,
- no independent lifecycle,
- switch is exhaustive and readable.
```

### 33.2 Switch When Strategy Is Better

Wrong if:

```text
- each branch grows large,
- dependencies differ,
- behavior changes independently,
- tests need isolation,
- modules own variants separately.
```

### 33.3 State Machine When Enum Is Enough

Wrong if:

```text
- no meaningful transition rule,
- no audit requirement,
- state only display,
- lifecycle stable and tiny.
```

### 33.4 Enum When State Machine Is Needed

Wrong if:

```text
- illegal transition common,
- allowed actions depend on state,
- actor/reason/timestamp matter,
- multiple entry points mutate status.
```

### 33.5 Microservice When Modular Monolith Is Better

Wrong if:

```text
- boundary not clear,
- database still shared,
- team not independent,
- deployment not independent,
- latency and failure complexity ignored.
```

### 33.6 Generic Repository When Query Object Is Better

Wrong if:

```text
- queries are domain-specific,
- performance differs per use case,
- filtering/pagination complex,
- eager/lazy loading matters.
```

### 33.7 Event When Direct Call Is Better

Wrong if:

```text
- caller needs immediate result,
- event is only hiding method call,
- ordering is strict,
- consumer cannot be idempotent,
- debugging becomes much harder.
```

### 33.8 Direct Call When Event Is Better

Wrong if:

```text
- side effect is not required for response,
- dependency is slow/unreliable,
- fan-out grows,
- caller should not know consumers,
- durable retry is needed.
```

---

## 34. Pattern Selection for Regulatory/Enterprise Systems

Dalam sistem regulatory, pattern selection biasanya dipengaruhi oleh:

```text
- auditability,
- explainability,
- lifecycle correctness,
- authorization defensibility,
- historical traceability,
- external integration reliability,
- policy change,
- batch and online consistency,
- user action accountability.
```

Pattern yang sering sangat berguna:

| Concern | Pattern |
|---|---|
| Policy decision | Policy Object, Specification, Rule Object |
| Case lifecycle | State Machine, Workflow Object |
| Action request | Command, Command Handler |
| Audit | Audit Event, Correlation/Causation ID |
| External agency integration | Gateway, ACL, Outbox/Inbox |
| Authorization | Authorization Policy, Resource Filter |
| Error defensibility | Domain Error, Problem Details |
| UI available action | Presenter/View Model from state/action model |
| Batch consistency | Idempotency, Dedup, State Guard |

### 34.1 Regulatory Heuristic

```text
Jika keputusan perlu dijelaskan kepada auditor,
jangan biarkan keputusan itu tersembunyi di if-else tanpa reason model.
```

```text
Jika user action mengubah lifecycle,
jangan biarkan transition terjadi tanpa actor, reason, timestamp, and previous state.
```

```text
Jika side effect keluar sistem,
jangan publish tanpa durability dan idempotency.
```

---

## 35. Design Review Checklist

Sebelum menerima pattern, jawab:

```text
[ ] Masalah nyata sudah jelas.
[ ] Force yang mendorong pattern sudah disebutkan.
[ ] Bagian stable dan volatile sudah dipisahkan.
[ ] Ownership logic jelas.
[ ] Boundary yang dilindungi jelas.
[ ] Invariant yang dijaga jelas.
[ ] Failure mode sudah dipikirkan.
[ ] Consistency requirement eksplisit.
[ ] Runtime cost dapat diterima.
[ ] Cognitive load dapat diterima.
[ ] Test strategy tersedia.
[ ] Observability point tersedia.
[ ] Migration path aman.
[ ] Revisit trigger ditentukan.
[ ] Alternatif lebih sederhana sudah dipertimbangkan.
```

---

## 36. Ringkasan Mental Model

Pattern selection dapat diringkas begini:

```text
Pattern bukan tujuan.
Pattern adalah respons terhadap force.
```

```text
Abstraction bukan kualitas otomatis.
Abstraction bagus jika menahan perubahan yang benar.
```

```text
Simplicity bukan berarti tanpa struktur.
Simplicity berarti struktur cukup untuk masalah nyata.
```

```text
Overengineering terjadi saat pattern ditambahkan sebelum force ada.
Underengineering terjadi saat force nyata dibiarkan menyebar tanpa model.
```

```text
Top engineer bukan orang yang tahu paling banyak pattern.
Top engineer adalah orang yang tahu kapan tidak memakai pattern,
kapan memakai pattern kecil,
dan kapan pattern eksplisit wajib untuk menjaga correctness, auditability, dan evolusi sistem.
```

---

## 37. Latihan Mandiri

### Latihan 1 — Conditional to Pattern

Ambil satu method dengan conditional panjang.

Jawab:

```text
Apakah conditional ini mapping sederhana, behavior variation, lifecycle transition, atau policy decision?
Apakah perlu switch, Strategy, Specification, atau State Machine?
Apa force-nya?
```

### Latihan 2 — Boundary Review

Cari satu external API client.

Jawab:

```text
Apakah external DTO masuk ke domain?
Apakah error external diterjemahkan?
Apakah timeout/retry/idempotency jelas?
Apakah gateway punya contract internal?
```

### Latihan 3 — Lifecycle Review

Cari satu entity dengan status.

Jawab:

```text
Di mana allowed transition didefinisikan?
Apakah semua entry point melewati rule yang sama?
Apakah illegal transition dites?
Apakah transition diaudit?
```

### Latihan 4 — Pattern Decision Record

Pilih satu design issue nyata.

Tulis:

```text
Problem, context, forces, options, decision, consequences, invariant, test, observability, revisit trigger.
```

---

## 38. Penutup

Part ini adalah alat navigasi untuk semua pattern yang sudah dipelajari.

Setelah kamu tahu pattern satu per satu, kemampuan berikutnya adalah memilih.

Pemilihan pattern yang matang membutuhkan:

```text
- membaca force,
- memahami boundary,
- menjaga invariant,
- menghitung cost,
- memikirkan failure,
- menilai kemampuan team,
- memilih struktur paling sederhana yang cukup kuat.
```

Inilah perbedaan antara engineer yang menghafal design pattern dan engineer yang memiliki design judgment.

---

## Status Seri

```text
Part 33 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
34-case-study-enterprise-java-module-pattern-refactoring.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./32-refactoring-toward-patterns-away-from-antipatterns.md">⬅️ Refactoring Toward Patterns and Away from Anti-Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./34-case-study-enterprise-java-module-pattern-refactoring.md">Case Study: Refactoring a Complex Enterprise Java Module Pattern Refactoring ➡️</a>
</div>
