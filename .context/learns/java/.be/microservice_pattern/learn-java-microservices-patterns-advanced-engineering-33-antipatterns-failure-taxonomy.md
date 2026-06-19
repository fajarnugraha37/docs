# learn-java-microservices-patterns-advanced-engineering-33-antipatterns-failure-taxonomy

> **Series**: Java Microservices Patterns — Advanced Engineering  
> **Part**: 33 / 35  
> **Topic**: Microservices Anti-Patterns and Failure Taxonomy  
> **Target**: Java 8–25 engineers who want to reason about microservices failure structurally, not only by memorizing pattern names.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 32, kita sudah membahas fondasi microservices dari sisi boundary, communication, event, saga, outbox, consistency, data ownership, query, gateway, discovery, resilience, backpressure, idempotency, workflow, state machine, service security, multi-tenancy, observability, testing, compatibility, deployment, runtime, performance, caching, migration, governance, incident, dan architecture economics.

Part 33 adalah **negative architecture handbook**.

Tujuannya bukan membuat daftar “jangan lakukan ini” secara dangkal. Tujuannya adalah membangun kemampuan untuk:

1. Mengenali microservices yang terlihat benar tetapi secara struktural rusak.
2. Mendiagnosis akar masalah, bukan hanya gejala.
3. Menghubungkan anti-pattern dengan failure mode produksi.
4. Memilih koreksi yang proporsional.
5. Mengetahui kapan solusi terbaik bukan “tambah pattern”, tetapi **merge, simplify, delay split, atau kembali ke modular monolith**.

Microservices anti-pattern sering muncul bukan karena engineer tidak tahu teori. Banyak anti-pattern muncul karena:

- timeline sempit,
- ownership tidak jelas,
- migrasi setengah jalan,
- platform belum matang,
- testing lambat,
- observability buruk,
- organisasi ingin “microservices” tetapi belum siap membayar biayanya,
- service dipecah berdasarkan struktur teknis, bukan domain,
- setiap tim mengoptimalkan lokal, bukan sistem total.

Engineer top-tier tidak hanya tahu pattern seperti Saga, CQRS, Outbox, Circuit Breaker, API Gateway, dan Event-Driven Architecture. Engineer top-tier tahu **kapan pattern tersebut berubah menjadi sumber kerusakan**.

---

## 1. Mental Model: Anti-Pattern Adalah Pattern Dengan Context Yang Salah

Anti-pattern bukan berarti sesuatu selalu buruk.

Contoh:

- Shared library bisa baik untuk utility stabil, tetapi buruk jika berisi shared domain model.
- API Gateway bisa baik untuk edge concern, tetapi buruk jika menjadi god orchestrator.
- Event-driven architecture bisa baik untuk decoupling temporal, tetapi buruk jika event tidak punya ownership dan semantic.
- Retry bisa baik untuk transient failure, tetapi buruk jika memperbesar overload.
- Cache bisa baik untuk read-heavy workload, tetapi buruk jika menjadi source of truth tidak resmi.
- Microservices bisa baik untuk domain kompleks dan banyak tim, tetapi buruk untuk sistem kecil atau tim yang belum punya operational maturity.

Jadi pertanyaan top-tier bukan:

> “Apakah X pattern bagus?”

Pertanyaan yang benar:

> “Dalam context ini, tekanan apa yang diselesaikan X, coupling apa yang ditambah, invariant apa yang dilemahkan, failure mode apa yang diperkenalkan, dan siapa yang akan mengoperasikannya?”

---

## 2. Failure Taxonomy Utama

Kita akan mengelompokkan anti-pattern ke dalam 10 keluarga besar.

```text
Microservices failure taxonomy
├── 1. Boundary failure
├── 2. Data ownership failure
├── 3. Communication failure
├── 4. Consistency and transaction failure
├── 5. Runtime and resilience failure
├── 6. Observability and operability failure
├── 7. Security and tenancy failure
├── 8. Delivery and compatibility failure
├── 9. Governance and ownership failure
└── 10. Economic and cognitive-load failure
```

Taxonomy ini penting karena banyak anti-pattern tampak berbeda tetapi akar masalahnya sama.

Contoh:

| Gejala | Kemungkinan akar |
|---|---|
| Semua service harus deploy bersamaan | Boundary failure + compatibility failure |
| Query lambat dan perlu join lintas DB | Data ownership failure + query-model failure |
| Banyak retry saat incident | Runtime failure + resilience misconfiguration |
| Event sulit dipahami | Communication failure + governance failure |
| Gateway terlalu besar | Boundary failure + ownership failure |
| Tim takut deploy | Testing failure + compatibility failure |
| Service kecil tetapi mahal | Economic failure + wrong decomposition |

---

## 3. Distributed Monolith

### 3.1 Definisi

Distributed monolith adalah sistem yang secara deployment tampak terdiri dari banyak service, tetapi secara dependency, release, data, dan runtime masih berperilaku seperti satu aplikasi besar.

Ciri utamanya:

- service tidak bisa deploy independen,
- perubahan kecil memaksa banyak service ikut berubah,
- database masih shared,
- flow bisnis selalu synchronous chain,
- contract tidak stabil,
- testing end-to-end menjadi bottleneck,
- failure satu service menjatuhkan flow besar,
- service boundary mengikuti module teknis, bukan domain ownership.

### 3.2 Bentuk umum

```text
UI
 ↓
Gateway
 ↓
Service A
 ↓
Service B
 ↓
Service C
 ↓
Service D
 ↓
Shared Database
```

Secara diagram terlihat seperti microservices. Secara behavior, ini monolith yang dipotong-potong lalu diberi network latency.

### 3.3 Kenapa berbahaya

Distributed monolith menggabungkan sisi buruk monolith dan distributed system:

| Dari monolith | Dari distributed system |
|---|---|
| tight coupling | network failure |
| shared release pressure | latency |
| shared database coupling | partial failure |
| sulit memahami impact | observability complexity |
| test besar lambat | runtime coordination |

### 3.4 Smell

- “Kita harus deploy A, B, C, D bareng.”
- “Kalau B down, semua flow di A gagal.”
- “Service ini cuma wrapper tabel.”
- “DTO ini dipakai semua service.”
- “Setiap perubahan enum harus update semua repo.”
- “Integration test butuh semua service hidup.”
- “Tidak bisa rollback satu service karena contract berubah serentak.”

### 3.5 Root cause

Biasanya bukan karena kurang framework. Root cause-nya:

- boundary salah,
- contract tidak backward-compatible,
- data ownership tidak jelas,
- workflow terlalu synchronous,
- shared model,
- organisasi belum punya service ownership,
- monolith dipecah berdasarkan layer atau table.

### 3.6 Correction strategy

Tidak selalu harus “pecah lagi”. Kadang harus:

1. Freeze boundary baru.
2. Identifikasi service yang selalu deploy bersama.
3. Hitung coupling matrix.
4. Merge service yang tidak punya autonomy.
5. Pisahkan database ownership bertahap.
6. Perkenalkan contract compatibility.
7. Ubah synchronous chain menjadi event/workflow hanya jika memang perlu.
8. Jadikan modular monolith sebagai opsi valid.

### 3.7 Review question

```text
Bisakah service ini:
1. deploy sendiri?
2. rollback sendiri?
3. menyimpan data sendiri?
4. menjaga invariant utamanya sendiri?
5. tetap degraded jika dependency lambat/down?
6. diuji tanpa semua service lain?
```

Jika mayoritas jawabannya “tidak”, kemungkinan besar itu distributed monolith.

---

## 4. Nano-Service Anti-Pattern

### 4.1 Definisi

Nano-service adalah service yang terlalu kecil sehingga overhead koordinasi, deployment, observability, testing, dan ownership lebih besar daripada nilai pemisahannya.

### 4.2 Contoh

```text
UserNameService
UserEmailService
UserAddressService
UserStatusService
UserValidationService
```

Setiap service hanya membungkus operasi kecil, tetapi business capability sebenarnya satu.

### 4.3 Kenapa terjadi

- salah memahami “small services” sebagai “tiny services”,
- split berdasarkan entity/table kecil,
- ingin terlihat cloud-native,
- menghindari modular design dalam satu codebase,
- tim menganggap setiap class besar harus jadi service.

### 4.4 Dampak

- latency naik,
- testing makin mahal,
- trace makin panjang,
- release makin sering tetapi tidak independen,
- on-call makin sulit,
- cognitive load naik,
- data ownership kabur.

### 4.5 Koreksi

Gabungkan service yang:

- berubah bersama,
- dimiliki tim sama,
- memakai data sama,
- menjaga invariant sama,
- tidak punya scaling profile berbeda,
- tidak punya security/compliance boundary berbeda.

Prinsip:

```text
Service harus cukup kecil untuk dimiliki dan dipahami,
tetapi cukup besar untuk memiliki business responsibility yang utuh.
```

---

## 5. Entity-Service Anti-Pattern

### 5.1 Definisi

Entity-service anti-pattern terjadi ketika setiap entity/tabel dijadikan service.

Contoh:

```text
ApplicationService
ApplicantService
DocumentService
AddressService
PaymentService
StatusService
CommentService
```

Masalahnya: domain process biasanya tidak mengikuti satu entity saja.

### 5.2 Gejala

- flow bisnis membutuhkan banyak call lintas service,
- transaction boundary hilang,
- invariant tersebar,
- service saling memanggil untuk operasi sederhana,
- orchestration pindah ke UI/gateway,
- banyak “manager service” muncul.

### 5.3 Kenapa salah

Entity bukan otomatis boundary.

Boundary yang lebih kuat biasanya berdasarkan:

- business capability,
- lifecycle,
- invariant,
- authority,
- ownership,
- change frequency,
- compliance responsibility.

### 5.4 Contoh buruk

```text
Submit application:
1. ApplicationService.create()
2. ApplicantService.update()
3. DocumentService.attach()
4. StatusService.setSubmitted()
5. AuditService.write()
6. NotificationService.send()
```

Jika operasi submit harus atomic secara domain, maka boundary-nya mungkin bukan Application table saja, tetapi **Application Intake capability**.

### 5.5 Koreksi

Tanyakan:

```text
Apa business operation yang harus benar?
Entity mana yang hanya bagian dari aggregate?
Invariant apa yang harus dijaga bersama?
Siapa authority untuk lifecycle?
```

Service yang baik sering berpusat pada capability:

```text
ApplicationIntakeService
ApplicationAssessmentService
CaseEnforcementService
PaymentSettlementService
```

Bukan sekadar table wrapper.

---

## 6. Shared Database Anti-Pattern

### 6.1 Definisi

Beberapa service membaca/menulis database/tabel yang sama secara langsung.

### 6.2 Kenapa terlihat menarik

- lebih cepat untuk query,
- mudah untuk join,
- migrasi dari monolith terasa murah,
- tidak perlu event/projection,
- tim DBA sudah nyaman dengan shared schema.

### 6.3 Kenapa berbahaya

Shared database menghancurkan service autonomy.

| Dampak | Penjelasan |
|---|---|
| Schema coupling | satu perubahan tabel bisa merusak banyak service |
| Hidden dependency | service tidak tahu siapa memakai kolom tertentu |
| Ownership kabur | tidak jelas siapa boleh mengubah data |
| Deployment coupling | migration harus koordinasi banyak service |
| Invariant bocor | service lain bisa bypass rule pemilik |
| Security risk | permission DB terlalu luas |
| Audit risk | actor/intent sulit dilacak |

### 6.4 Variasi anti-pattern

1. Semua service pakai user DB credential sama.
2. Service A membaca tabel private Service B.
3. Service B menulis status milik Service A.
4. Reporting query join langsung semua schema.
5. Foreign key lintas service schema.
6. Stored procedure menjadi shared business layer.

### 6.5 Koreksi bertahap

1. Tandai table owner.
2. Pisahkan read-only access dulu.
3. Buat published read API atau projection.
4. Hilangkan write access lintas owner.
5. Perkenalkan outbox/event untuk propagation.
6. Pisahkan migration ownership.
7. Pisahkan credential per service.
8. Tambahkan DB access audit.

### 6.6 Heuristic

```text
Jika sebuah service bisa mengubah data tanpa melewati policy/invariant pemilik data,
maka boundary microservice sudah bocor.
```

---

## 7. Shared Domain Model Anti-Pattern

### 7.1 Definisi

Banyak service memakai library domain model yang sama: entity, enum, validation, state, DTO, business rule.

### 7.2 Kenapa terlihat baik

- DRY,
- reuse,
- compile-time safety,
- lebih mudah sinkron,
- mengurangi duplikasi.

### 7.3 Masalah struktural

Dalam microservices, duplikasi kecil sering lebih sehat daripada coupling besar.

Shared domain model menyebabkan:

- release coupling,
- semantic coupling,
- model owner kabur,
- bounded context hilang,
- perubahan enum menyebar,
- service tidak bisa evolve independen.

### 7.4 Yang masih boleh dishare

Biasanya aman untuk:

- tracing utility,
- logging helper,
- error envelope standar,
- security token parser,
- primitive value type yang benar-benar stabil,
- generated client berdasarkan contract dengan versioning,
- test fixture generator yang terpisah dari runtime model.

Berbahaya untuk:

- JPA entity,
- aggregate,
- state machine enum,
- business validation,
- workflow state,
- domain service,
- repository abstraction lintas service,
- common DTO untuk semua context.

### 7.5 Koreksi

- Ubah shared domain library menjadi published contract.
- Biarkan tiap service punya internal model sendiri.
- Pakai anti-corruption layer.
- Terapkan tolerant reader.
- Hindari enum global yang dianggap universal.

---

## 8. Chatty Service Anti-Pattern

### 8.1 Definisi

Satu business operation membutuhkan banyak remote call kecil.

```text
for each application:
  call ApplicantService
  call DocumentService
  call PaymentService
  call StatusService
  call UserService
```

### 8.2 Dampak

- latency tinggi,
- p99 memburuk,
- dependency failure probability naik,
- timeout budget habis,
- retry amplification,
- sulit test,
- sulit trace.

### 8.3 Rumus sederhana

Jika satu request melakukan 10 remote call dan setiap call punya availability 99.9%, maka availability kasar path:

```text
0.999^10 = 0.990
```

Semakin banyak hop, semakin turun reliability path.

### 8.4 Koreksi

- coarse-grained API untuk use case yang jelas,
- BFF untuk UX composition,
- projection/materialized view untuk query,
- event-driven propagation,
- batch endpoint,
- local read model,
- precomputed summary,
- menggabungkan service yang salah pisah.

### 8.5 Prinsip

```text
Remote call harus mahal secara mental.
Jangan desain remote API seperti method call lokal.
```

---

## 9. Synchronous Saga Chain Anti-Pattern

### 9.1 Definisi

Saga yang seharusnya long-running dan failure-aware diimplementasikan sebagai chain synchronous call.

```text
A.submit()
  -> B.reserve()
    -> C.validate()
      -> D.approve()
        -> E.notify()
```

### 9.2 Masalah

- timeout sulit,
- unknown outcome,
- compensation sulit,
- satu dependency lambat menahan semua,
- retry bisa double side-effect,
- user request menjadi hostage workflow panjang,
- observability kompleks.

### 9.3 Koreksi

Gunakan process manager/orchestrator untuk workflow panjang:

```text
Command accepted
→ workflow instance persisted
→ step executed
→ result event handled
→ next step scheduled
→ timeout/compensation handled
```

Atau gunakan choreography jika event ownership jelas dan flow sederhana.

### 9.4 Rule of thumb

Synchronous call cocok untuk:

- query singkat,
- validation cepat,
- dependency sangat reliable,
- operasi tidak long-running,
- timeout kecil dan jelas.

Async workflow lebih cocok untuk:

- human task,
- external dependency,
- SLA/timer,
- multi-step business process,
- compensation,
- partial completion,
- audit trail panjang.

---

## 10. God Gateway Anti-Pattern

### 10.1 Definisi

API Gateway/BFF menampung business logic, workflow orchestration, authorization detail, data mapping domain, dan aggregation kompleks.

### 10.2 Gejala

- gateway berubah setiap kali domain berubah,
- gateway tahu state machine internal banyak service,
- gateway memanggil 10 service untuk satu operation,
- gateway menyimpan business rule,
- service menjadi CRUD backend bodoh,
- gateway menjadi bottleneck organisasi dan runtime.

### 10.3 Kenapa terjadi

- UI butuh cepat,
- service API terlalu granular,
- domain service tidak menyediakan use-case API,
- tim frontend butuh endpoint praktis,
- gateway dianggap tempat “lem logic”.

### 10.4 Koreksi

Pisahkan:

| Concern | Lokasi ideal |
|---|---|
| routing | gateway |
| authN/token validation | gateway + service |
| coarse authZ | gateway |
| object/domain authorization | domain service |
| UX-specific composition | BFF |
| business workflow | process manager/domain service |
| state transition | state owner service |
| data projection | projection/query service |

### 10.5 Prinsip

```text
Gateway boleh memahami client experience.
Gateway tidak boleh menjadi pemilik domain truth.
```

---

## 11. Event Soup Anti-Pattern

### 11.1 Definisi

Sistem penuh event, tetapi event tidak punya semantic jelas, owner jelas, schema governance, atau lifecycle.

### 11.2 Gejala

- nama event ambigu: `DataUpdated`, `StatusChanged`, `ProcessCompleted`,
- payload tidak konsisten,
- tidak jelas siapa owner event,
- consumer mengandalkan field internal,
- event dipakai sebagai command terselubung,
- event replay merusak data,
- tidak ada schema versioning,
- tidak ada catalog,
- consumer tidak diketahui.

### 11.3 Dampak

- hidden dependency,
- sulit audit,
- sulit migration,
- replay berbahaya,
- event-driven menjadi distributed spaghetti,
- consumer takut berubah,
- producer tidak tahu impact.

### 11.4 Koreksi

1. Bedakan domain event, integration event, notification event, command.
2. Gunakan event naming berbasis business fact.
3. Tetapkan event owner.
4. Buat event catalog.
5. Terapkan schema compatibility.
6. Dokumentasikan semantic, not only fields.
7. Pastikan handler idempotent.
8. Bedakan live handling dan replay handling.
9. Ukur consumer lag, DLQ, duplicate, replay result.

### 11.5 Contoh

Buruk:

```json
{
  "eventType": "ApplicationUpdated",
  "data": { "status": "APPROVED" }
}
```

Lebih baik:

```json
{
  "eventType": "ApplicationApproved",
  "eventVersion": 1,
  "applicationId": "APP-2026-0001",
  "decisionId": "DEC-991",
  "approvedBy": "officer-123",
  "approvedAt": "2026-06-19T10:15:00Z",
  "policyVersion": "assessment-policy-2026.04"
}
```

---

## 12. Event as Command Anti-Pattern

### 12.1 Definisi

Event yang seharusnya menyatakan fakta dipakai untuk menyuruh service lain melakukan sesuatu.

Buruk:

```text
UserCreatedEvent → EmailService harus kirim email
```

Lebih eksplisit:

```text
SendWelcomeEmailCommand
```

Atau event tetap fact, tetapi consumer bebas memutuskan:

```text
UserRegistered → NotificationPolicy decides whether to send welcome email
```

### 12.2 Kenapa berbahaya

- producer diam-diam mengontrol consumer,
- semantic event bercampur instruction,
- sulit replay,
- sulit menambah consumer,
- coupling tetap ada tetapi tersembunyi.

### 12.3 Koreksi

Gunakan:

- command untuk instruction,
- event untuk fact,
- policy consumer untuk reaksi,
- orchestrator untuk flow eksplisit.

---

## 13. Retry Storm Anti-Pattern

### 13.1 Definisi

Banyak client melakukan retry bersamaan saat dependency sedang lambat/down, sehingga dependency makin overload.

### 13.2 Gejala

- request rate naik saat error naik,
- p99 memburuk drastis,
- thread pool habis,
- queue penuh,
- circuit breaker tidak efektif,
- DB connection pool saturated,
- broker consumer lag naik,
- autoscaling terlambat atau memperburuk resource contention.

### 13.3 Root cause

- retry tanpa backoff,
- retry tanpa jitter,
- retry pada non-idempotent operation,
- timeout terlalu panjang,
- retry di banyak layer sekaligus: client + gateway + mesh + broker,
- tidak ada retry budget,
- tidak ada load shedding.

### 13.4 Koreksi

- timeout kecil dan jelas,
- exponential backoff + jitter,
- retry budget,
- circuit breaker,
- idempotency key,
- no retry untuk validation/business error,
- load shedding,
- fail fast,
- observability retry amplification.

### 13.5 Formula diagnosis

```text
effective_request_rate = original_rate × (1 + average_retry_count)
```

Jika original 1.000 rps dan setiap request retry 3 kali:

```text
effective_request_rate = 4.000 rps
```

Saat sistem sudah sakit, retry bisa menjadi racun.

---

## 14. No Timeout / Wrong Timeout Anti-Pattern

### 14.1 Definisi

Remote call tidak punya timeout, atau timeout diset sembarang.

### 14.2 Variasi

- timeout default library tidak diketahui,
- connect timeout ada tetapi read timeout tidak,
- timeout lebih panjang dari client SLA,
- nested call tidak membawa deadline,
- DB query timeout tidak diset,
- message processing tidak punya lease/visibility timeout,
- workflow step tidak punya timeout.

### 14.3 Dampak

- thread tertahan,
- pool habis,
- request menumpuk,
- user menunggu tanpa kepastian,
- retry datang terlambat,
- cascading failure.

### 14.4 Koreksi

Gunakan deadline thinking:

```text
Client SLA: 2.000 ms
Gateway overhead: 100 ms
Service A processing: 300 ms
Service B call budget: 600 ms
DB budget: 400 ms
Safety margin: 600 ms
```

Timeout harus berasal dari latency budget, bukan angka acak.

---

## 15. Circuit Breaker Theater

### 15.1 Definisi

Circuit breaker dipasang agar terlihat resilient, tetapi tidak efektif karena salah konfigurasi atau salah tempat.

### 15.2 Gejala

- breaker threshold terlalu tinggi,
- half-open terlalu agresif,
- fallback salah secara bisnis,
- breaker per instance padahal masalah global,
- breaker tidak membedakan slow call vs failure,
- metrics tidak diamati,
- retry tetap menghajar dependency setelah breaker open.

### 15.3 Koreksi

- ukur slow-call rate,
- tentukan fallback semantic,
- pastikan fallback tidak melanggar invariant,
- kombinasikan dengan timeout, retry budget, bulkhead,
- monitor state transition breaker,
- test dengan fault injection.

### 15.4 Prinsip

```text
Circuit breaker bukan tujuan.
Tujuannya adalah membatasi kerusakan dan memberi dependency waktu pulih.
```

---

## 16. Cache as Source of Truth Anti-Pattern

### 16.1 Definisi

Cache diperlakukan sebagai data authoritative tanpa lifecycle, audit, consistency, dan recovery discipline.

### 16.2 Gejala

- data hanya ada di Redis/cache,
- cache invalidation tidak jelas,
- TTL dipakai sebagai business rule,
- cache key tidak tenant-aware,
- data security bergantung pada cache naming,
- miss menyebabkan sistem gagal total,
- stale data tidak terdeteksi.

### 16.3 Koreksi

- definisikan source of truth,
- cache value envelope dengan version dan generatedAt,
- TTL policy eksplisit,
- event-driven invalidation,
- stale-read policy,
- tenant/security-aware key,
- cache metrics,
- fallback jika cache down,
- reconciliation jika cache memengaruhi business decision.

---

## 17. No Ownership Service Anti-Pattern

### 17.1 Definisi

Service ada, tetapi tidak jelas siapa pemilik code, runtime, data, API, incident, cost, dan lifecycle.

### 17.2 Gejala

- “service ini punya siapa?”
- incident dilempar antar tim,
- contract berubah tanpa owner,
- dependency outdated,
- alert tidak ada responder,
- schema tidak ada steward,
- cost membengkak tanpa accountability.

### 17.3 Koreksi

Setiap service harus punya ownership record:

```yaml
service: application-assessment
owner_team: licensing-platform
business_capability: application assessment
runtime_owner: licensing-platform
data_owner: licensing-platform
api_owner: licensing-platform
on_call: licensing-platform-primary
slo: 99.9
critical_dependencies:
  - identity-service
  - document-service
  - oracle-assessment-db
```

### 17.4 Prinsip

```text
Service tanpa owner adalah liability, bukan architecture asset.
```

---

## 18. Fake Autonomy Anti-Pattern

### 18.1 Definisi

Tim dikatakan memiliki service secara independen, tetapi semua keputusan masih harus melalui approval pusat, shared release, shared database, shared platform manual, dan testing bottleneck.

### 18.2 Gejala

- service team tidak bisa deploy sendiri,
- platform hanya bisa diubah oleh satu tim kecil,
- environment harus booking,
- release window bulanan,
- contract approval manual panjang,
- observability tidak bisa diakses tim service,
- incident harus menunggu tim infra.

### 18.3 Koreksi

- golden path,
- self-service deployment,
- guardrail automated,
- standard templates,
- policy-as-code,
- service catalog,
- automated compatibility checks,
- platform team sebagai product team.

---

## 19. E2E Test Bottleneck Anti-Pattern

### 19.1 Definisi

Keyakinan rilis bergantung hampir sepenuhnya pada end-to-end test besar.

### 19.2 Gejala

- E2E lambat,
- flaky,
- environment sering rusak,
- test data konflik,
- sulit tahu root cause,
- developer menunggu lama,
- release tertunda karena satu test lintas sistem gagal.

### 19.3 Koreksi

Ganti ke testing portfolio:

```text
Unit test
+ Component test
+ Contract test
+ Integration test with real dependency where needed
+ Compatibility test
+ Limited E2E smoke test
+ Synthetic/canary in production-like runtime
```

### 19.4 Prinsip

```text
E2E test memvalidasi wiring penting.
E2E test tidak boleh menjadi satu-satunya sumber confidence.
```

---

## 20. Framework-First Architecture Anti-Pattern

### 20.1 Definisi

Arsitektur dibentuk oleh framework/tool, bukan domain dan failure model.

Contoh:

- “Karena pakai Kafka, semua harus event.”
- “Karena pakai Spring Cloud, semua harus discovery + config server.”
- “Karena pakai Kubernetes, semua harus microservice.”
- “Karena ada workflow engine, semua logic masuk BPMN.”
- “Karena pakai service mesh, aplikasi tidak perlu resilience.”

### 20.2 Dampak

- overengineering,
- pattern dipakai tanpa problem,
- domain boundary kalah oleh tool boundary,
- failure mode tidak dipahami,
- tim sulit debug karena terlalu banyak layer.

### 20.3 Koreksi

Gunakan urutan keputusan:

```text
Domain pressure
→ invariant
→ consistency requirement
→ communication shape
→ failure model
→ operational maturity
→ tool/framework
```

Bukan sebaliknya.

---

## 21. Generic Common Service Anti-Pattern

### 21.1 Definisi

Membuat service “common” yang menampung segala hal umum:

```text
CommonService
MasterDataService
UtilityService
ReferenceService
SharedWorkflowService
CommonValidationService
```

### 21.2 Masalah

Common service sering menjadi hidden monolith:

- semua service bergantung padanya,
- domain rule dari banyak context bercampur,
- scaling profile tidak jelas,
- owner tidak jelas,
- perubahan kecil berdampak luas.

### 21.3 Kapan common service boleh

Boleh jika capability-nya jelas dan stabil:

- identity service,
- notification service,
- document rendering service,
- audit ingestion service,
- reference data service dengan ownership jelas.

Tidak boleh jika hanya tempat membuang logic yang “dipakai lebih dari satu service”.

---

## 22. Over-Aggregated Service Anti-Pattern

### 22.1 Definisi

Service terlalu besar dan menampung banyak bounded context.

### 22.2 Gejala

- service punya banyak domain unrelated,
- tim takut ubah karena impact luas,
- database service sangat besar,
- deployment risk tinggi,
- scaling tidak efisien,
- banyak module internal saling tidak paham.

### 22.3 Koreksi

Jangan langsung split berdasarkan table. Cari seam:

- capability berbeda,
- lifecycle berbeda,
- owner berbeda,
- scaling berbeda,
- compliance boundary berbeda,
- data access pattern berbeda,
- change frequency berbeda.

---

## 23. Orchestration Everywhere Anti-Pattern

### 23.1 Definisi

Semua interaksi dijadikan central orchestrator, bahkan yang cukup sebagai event reaction atau local operation.

### 23.2 Dampak

- orchestrator menjadi god service,
- service lain pasif,
- autonomy turun,
- bottleneck runtime dan organisasi,
- flow sulit evolve,
- orchestrator tahu terlalu banyak detail.

### 23.3 Koreksi

Gunakan decision:

| Situation | Better option |
|---|---|
| Flow kritikal, long-running, butuh audit step-by-step | orchestration |
| Banyak independent reaction terhadap fact | choreography |
| Single aggregate operation | local transaction |
| Query composition | BFF/projection |
| Human task + SLA + escalation | workflow/process manager |

---

## 24. Choreography Chaos Anti-Pattern

### 24.1 Definisi

Sistem sepenuhnya event choreography tanpa owner flow, sehingga business process sulit dipahami.

### 24.2 Gejala

- tidak ada yang bisa menggambar end-to-end flow,
- satu event memicu rantai panjang tak terlihat,
- compensation tidak jelas,
- failure step tengah tidak terdeteksi,
- audit harus rekonstruksi dari banyak log,
- impact perubahan event sulit diprediksi.

### 24.3 Koreksi

- dokumentasikan process map,
- gunakan process manager untuk flow kritikal,
- buat event catalog,
- gunakan correlation/causation id,
- definisikan owner process,
- observability berbasis business transaction.

---

## 25. Anemic Service Anti-Pattern

### 25.1 Definisi

Service hanya CRUD wrapper, sementara business logic tersebar di UI, gateway, consumer, atau job.

### 25.2 Gejala

- service bernama domain tetapi method-nya hanya create/update/delete,
- state transition bisa dilakukan dari banyak tempat,
- rule berbeda antar caller,
- audit tidak konsisten,
- authorization object-level tidak konsisten.

### 25.3 Koreksi

Service harus expose command berbasis intent:

Buruk:

```http
PATCH /applications/{id}
{ "status": "APPROVED" }
```

Lebih baik:

```http
POST /applications/{id}/approval-decisions
{
  "decision": "APPROVE",
  "reason": "All requirements met",
  "policyVersion": "2026.04"
}
```

---

## 26. Leaky Abstraction Anti-Pattern

### 26.1 Definisi

Service membocorkan detail internal seperti table name, internal enum, database error, internal workflow state, atau framework exception ke consumer.

### 26.2 Dampak

- consumer bergantung pada internal,
- migration sulit,
- security risk,
- error handling tidak stabil,
- public contract kacau.

### 26.3 Koreksi

- public DTO berbeda dari entity,
- public error model stabil,
- internal state mapped ke external status yang dirancang,
- jangan expose database ID internal jika tidak perlu,
- gunakan anti-corruption layer.

---

## 27. Temporal Coupling Anti-Pattern

### 27.1 Definisi

Service harus tersedia pada waktu yang sama untuk business process berhasil, padahal prosesnya bisa dirancang lebih toleran.

### 27.2 Contoh

Application submission gagal karena NotificationService down.

Padahal notification bukan invariant utama submission.

### 27.3 Koreksi

Pisahkan critical path:

```text
Submit application:
- validate request
- persist application submitted
- publish ApplicationSubmitted event
- return accepted/success

Notification:
- consume event asynchronously
- retry/DLQ if failed
```

### 27.4 Prinsip

```text
Jangan letakkan side effect non-critical di critical path.
```

---

## 28. Hidden Coupling Through Reporting

### 28.1 Definisi

Reporting/BI/dashboard langsung membaca database banyak service, sehingga reporting menjadi coupling layer tersembunyi.

### 28.2 Gejala

- schema tidak bisa berubah karena report,
- report query join lintas domain,
- performance OLTP terganggu,
- report logic menjadi business truth alternatif,
- ownership data report kabur.

### 28.3 Koreksi

- published reporting model,
- CDC to analytical store,
- projection/read model,
- data contract untuk reporting,
- data lineage,
- report owner,
- freshness SLA.

---

## 29. Authorization Bypass Through Internal Calls

### 29.1 Definisi

Service menganggap request internal selalu trusted dan tidak melakukan object-level authorization.

### 29.2 Dampak

- confused deputy,
- privilege escalation,
- tenant leakage,
- audit actor salah,
- internal endpoint disalahgunakan.

### 29.3 Koreksi

- service identity + user delegation context,
- audience-restricted token,
- service-level authorization,
- object-level domain authorization,
- tenant context validation,
- audit actor/subject/scope.

---

## 30. Tenant Leakage Anti-Pattern

### 30.1 Definisi

Data tenant/user/context bercampur karena tenant isolation tidak konsisten di service, cache, message, DB, search index, or object storage.

### 30.2 Smell

- cache key tanpa tenant,
- message tanpa tenant id,
- query lupa `tenant_id`,
- object storage path tidak scoped,
- admin endpoint tidak audit,
- projection merge multi-tenant tanpa policy.

### 30.3 Koreksi

- tenant context sebagai mandatory field,
- DB constraint/index tenant-aware,
- cache key tenant-aware,
- message envelope tenant-aware,
- search index partitioning/filter,
- security tests untuk cross-tenant access,
- tenant-aware observability.

---

## 31. Observability Afterthought Anti-Pattern

### 31.1 Definisi

Logs/metrics/traces ditambahkan setelah incident, bukan didesain sebagai bagian dari contract runtime.

### 31.2 Gejala

- tidak ada correlation id,
- log tidak structured,
- trace putus di async boundary,
- metrics hanya CPU/memory,
- tidak ada business metric,
- alert noisy,
- dashboard tidak membantu triage,
- tidak tahu dampak user.

### 31.3 Koreksi

Observability harus menjawab:

```text
Apa yang gagal?
Di service mana?
Untuk tenant/user/case mana?
Dependency apa yang lambat?
Apakah data corrupt atau hanya stale?
Apakah retry memperburuk?
Apakah fallback aktif?
Apakah backlog naik?
Berapa business impact?
```

---

## 32. Manual Operations Anti-Pattern

### 32.1 Definisi

Operasi penting dilakukan manual tanpa automation, audit, rollback, atau guardrail.

### 32.2 Contoh

- manual DB patch di production,
- manual restart sebagai solusi utama,
- manual config change,
- manual replay message,
- manual migration script tanpa idempotency,
- manual secret rotation tanpa validation.

### 32.3 Koreksi

- runbook executable,
- migration script idempotent,
- approval + audit trail,
- dry run,
- rollback/roll-forward plan,
- automation with guardrail,
- post-action verification.

---

## 33. Excessive Runtime Diversity Anti-Pattern

### 33.1 Definisi

Terlalu banyak runtime, framework, DB, broker, dan language tanpa alasan kuat.

### 33.2 Dampak

- support burden naik,
- security patching sulit,
- observability tidak konsisten,
- hiring/onboarding sulit,
- platform team kewalahan,
- incident response lambat.

### 33.3 Koreksi

Tetapkan:

- golden path,
- allowed technology radar,
- exception process,
- lifecycle policy,
- support tier,
- observability standard,
- security baseline.

Untuk Java 8–25, ini termasuk aturan:

```text
Java 8: legacy only, migration planned
Java 11: stable legacy LTS
Java 17: modern enterprise baseline
Java 21: preferred for virtual threads where useful
Java 25: adopt with compatibility/runtime validation
```

---

## 34. Premature Microservices Anti-Pattern

### 34.1 Definisi

Sistem dipecah menjadi microservices sebelum domain, team, platform, testing, deployment, dan observability matang.

### 34.2 Gejala

- tim kecil tetapi service banyak,
- domain masih sering berubah,
- belum ada CI/CD matang,
- belum ada centralized observability,
- belum ada contract testing,
- belum ada on-call discipline,
- database masih satu,
- deployment masih manual.

### 34.3 Koreksi

Mulai dengan modular monolith:

```text
Clear modules
Explicit boundaries
Internal events
No cyclic dependency
Separate schemas if needed
Contract-like internal APIs
```

Lalu extract ketika ada tekanan nyata:

- team scaling,
- independent deployment,
- scaling profile berbeda,
- compliance boundary,
- runtime isolation,
- change frequency berbeda.

---

## 35. Anti-Pattern Diagnosis Method

Gunakan 7 langkah.

### Step 1 — Identify symptom

Contoh:

```text
Release selalu terlambat karena harus deploy 8 service bersama.
```

### Step 2 — Map affected capability

```text
Application submission
Application assessment
Payment confirmation
Notification
Audit
```

### Step 3 — Draw dependency graph

```text
Gateway → ApplicationService → ApplicantService → DocumentService
                         ↘ PaymentService
                         ↘ NotificationService
                         ↘ AuditService
```

### Step 4 — Classify coupling

| Coupling type | Ada? |
|---|---|
| Runtime coupling | yes |
| Data coupling | yes |
| Contract coupling | yes |
| Release coupling | yes |
| Semantic coupling | yes |
| Ownership coupling | unclear |

### Step 5 — Identify violated principle

```text
Service autonomy
Data ownership
Bounded context
Timeout budget
Compatibility
```

### Step 6 — Choose correction level

| Level | Correction |
|---|---|
| Local | change timeout/retry/config |
| Service | redesign API/contract |
| Data | split ownership/projection |
| Workflow | introduce process manager |
| Org | clarify owner/team |
| Architecture | merge/split service |
| Platform | create golden path |

### Step 7 — Verify with measurable outcome

```text
Can deploy independently? yes/no
p99 reduced? yes/no
fan-out reduced? yes/no
incident MTTR reduced? yes/no
contract break count reduced? yes/no
service ownership clear? yes/no
```

---

## 36. Anti-Pattern Severity Matrix

| Severity | Meaning | Example |
|---|---|---|
| S1 | Immediate production risk | retry storm causing outage |
| S2 | High reliability/security risk | tenant leakage, auth bypass |
| S3 | Delivery/release risk | distributed monolith |
| S4 | Maintainability risk | shared domain model |
| S5 | Local smell | minor DTO leakage |

Severity depends on:

- blast radius,
- reversibility,
- data integrity impact,
- security impact,
- user/business impact,
- frequency,
- operational detectability.

---

## 37. Java 8–25 Considerations

### 37.1 Java 8

Common in legacy enterprise systems.

Risks:

- older HTTP client ecosystem,
- older GC ergonomics,
- older TLS defaults,
- limited language modeling,
- no records/sealed classes,
- harder modern observability integration depending on stack.

Anti-pattern risk:

- shared libraries become easier than contract discipline,
- legacy app servers encourage shared DB,
- manual thread pools often misconfigured.

### 37.2 Java 11

Better baseline for modern runtime than Java 8.

Useful:

- standard `HttpClient`,
- improved container awareness compared to older Java,
- better TLS/security baseline,
- common migration target.

### 37.3 Java 17

Strong modern enterprise baseline.

Useful:

- records,
- sealed classes,
- better GC options,
- stronger language modeling for command/event/state.

### 37.4 Java 21

Important for virtual threads.

But anti-pattern warning:

```text
Virtual threads make blocking cheaper.
They do not make remote calls reliable.
They do not remove timeout, backpressure, bulkhead, or idempotency needs.
```

### 37.5 Java 25

Use as latest horizon, but adopt with:

- dependency compatibility validation,
- container runtime validation,
- observability agent validation,
- framework support validation,
- GC/performance regression testing,
- production rollout strategy.

---

## 38. Refactoring Playbook by Anti-Pattern

### 38.1 Distributed monolith

Options:

- merge services that always change together,
- split data ownership,
- introduce compatibility,
- reduce synchronous chain,
- add projection/query service,
- improve contract testing.

### 38.2 Shared database

Options:

- ownership map,
- credential isolation,
- API/projection replacement,
- outbox/CDC propagation,
- staged write removal.

### 38.3 Event soup

Options:

- event catalog,
- schema governance,
- event owner,
- semantic naming,
- replay contract,
- consumer inventory.

### 38.4 God gateway

Options:

- move domain logic to service,
- move workflow to process manager,
- keep UX composition in BFF,
- reduce fan-out,
- define gateway responsibility.

### 38.5 Retry storm

Options:

- retry budget,
- jitter,
- timeout,
- load shedding,
- circuit breaker,
- idempotency,
- remove duplicate retry layers.

### 38.6 E2E bottleneck

Options:

- contract tests,
- component tests,
- synthetic tests,
- stable test data ownership,
- limited E2E smoke.

---

## 39. Production Readiness Checklist

### Boundary

- [ ] Service boundary maps to capability/lifecycle/invariant.
- [ ] Service can deploy independently.
- [ ] Service can rollback/roll-forward independently.
- [ ] No cyclic service dependency.
- [ ] No service exists only as table wrapper.

### Data

- [ ] Each data object has clear owner.
- [ ] No unauthorized direct DB access across service boundary.
- [ ] Cross-service query solved by API/projection/reporting model.
- [ ] No shared JPA entity/domain model across services.
- [ ] Migration ownership clear.

### Communication

- [ ] Synchronous calls have timeout budget.
- [ ] Retry policy has backoff, jitter, and budget.
- [ ] API contract has compatibility rules.
- [ ] Event contract has owner, schema version, semantic description.
- [ ] No event soup.

### Consistency

- [ ] Invariants classified.
- [ ] Cross-service invariant has explicit control mechanism.
- [ ] Saga/compensation has failure matrix.
- [ ] Idempotency is implemented for retryable operations.
- [ ] Reconciliation exists for eventual consistency.

### Runtime

- [ ] Bulkheads exist for critical dependencies.
- [ ] Circuit breaker configuration is tested.
- [ ] Backpressure/load shedding exists.
- [ ] Cache failure mode defined.
- [ ] Platform retry does not conflict with app retry.

### Observability

- [ ] Correlation ID propagates sync and async.
- [ ] Logs are structured.
- [ ] Metrics include business/correctness signals.
- [ ] Traces cross service boundaries.
- [ ] Dashboards support incident triage.

### Security

- [ ] Internal calls authenticated.
- [ ] Object-level authorization not bypassed.
- [ ] Tenant context enforced.
- [ ] Token audience/scope checked.
- [ ] Audit actor is preserved.

### Delivery

- [ ] Contract tests prevent breaking changes.
- [ ] Database migration follows expand-contract.
- [ ] Feature flags have owner and cleanup.
- [ ] Canary/smoke validation exists.
- [ ] E2E is not the only confidence mechanism.

### Ownership

- [ ] Every service has owner team.
- [ ] On-call owner clear.
- [ ] Cost owner clear.
- [ ] API/event/data owner clear.
- [ ] Runbook exists.

### Economics

- [ ] Service pays for its complexity.
- [ ] Complexity budget is tracked.
- [ ] Merge/consolidation is considered when autonomy is fake.
- [ ] Platform cost justified.
- [ ] Cognitive load acceptable.

---

## 40. Top 1% Review Questions

Use these questions in architecture reviews.

### Boundary

```text
What business capability does this service own?
What invariant would break if this service disappeared?
Why is this a service instead of a module?
What changes independently from other services?
What data does it authoritatively own?
```

### Communication

```text
Why is this call synchronous?
What is the timeout budget?
Is retry safe?
What happens if dependency is slow, not down?
Can this be made async without harming UX/invariant?
```

### Data

```text
Who owns this data?
Who is allowed to write it?
How do other services read it?
How is stale data handled?
What is the reconciliation process?
```

### Event

```text
Is this event a fact or a command?
Who owns the event?
Can it be replayed safely?
What consumers exist?
What schema changes are compatible?
```

### Runtime

```text
What happens at p99 latency?
What happens under overload?
Where is the bulkhead?
Who sheds load?
What retry layer is authoritative?
```

### Security

```text
Who is the actor?
Who is the service identity?
What is the tenant?
What is the audience?
What is audited?
```

### Governance

```text
Who owns this service in production?
Who handles incident?
Who pays cost?
Who approves breaking contract change?
Who removes deprecated version?
```

### Economics

```text
What complexity does this service introduce?
What autonomy does it buy?
Would a module be cheaper?
Would merging reduce risk?
What is the microservice premium here?
```

---

## 41. Practical Exercise

### Exercise 1 — Diagnose distributed monolith

Given:

```text
ApplicationService
ApplicantService
DocumentService
PaymentService
NotificationService
AuditService
```

All services:

- use same Oracle schema,
- share `common-domain.jar`,
- deploy in same release window,
- use synchronous REST chain for submission,
- require full E2E test suite before deploy.

Tasks:

1. Identify anti-patterns.
2. Classify them by taxonomy.
3. Rank severity.
4. Propose 3-month remediation.
5. Decide which services to merge or keep.
6. Define target data ownership.
7. Define target communication model.

### Exercise 2 — Event soup cleanup

Given events:

```text
StatusChanged
DataUpdated
ProcessDone
UserAction
SyncRequired
```

Tasks:

1. Rename events as business facts.
2. Define event owner.
3. Define schema.
4. Define replay behavior.
5. Define compatibility rules.
6. Define event catalog fields.

### Exercise 3 — Retry storm postmortem

Given:

- dependency p99 increased from 300ms to 8s,
- client timeout 30s,
- retry 3 times immediate,
- gateway also retries 2 times,
- service mesh retries 2 times,
- no idempotency key,
- DB pool saturated.

Tasks:

1. Draw amplification path.
2. Calculate rough max attempt multiplier.
3. Identify unsafe retries.
4. Propose corrected timeout/retry policy.
5. Define metrics and alerts.

---

## 42. Summary

Microservices anti-patterns are rarely isolated mistakes. They are usually **signals of violated architecture forces**:

- boundary mismatch,
- data ownership leak,
- communication coupling,
- consistency ambiguity,
- runtime overload,
- missing observability,
- weak security context,
- poor compatibility discipline,
- unclear ownership,
- unpaid complexity cost.

A senior engineer can name anti-patterns.  
A principal-level engineer can trace anti-patterns to root causes, quantify their blast radius, and choose whether to refactor, merge, split, defer, or simplify.

The strongest lesson:

```text
Microservices are not proven by service count.
They are proven by independent evolution, clear ownership,
bounded failure, explicit contracts, operational maturity,
and justified complexity cost.
```

---

## 43. References

- Davide Taibi, Valentina Lenarduzzi, Claus Pahl — *Microservices Anti-Patterns: A Taxonomy*, arXiv, 2019.
- Martin Fowler — *Microservice Premium*.
- Martin Fowler — *Microservice Trade-Offs*.
- Martin Fowler — *Monolith First*.
- Martin Fowler — *Microservices and the First Law of Distributed Objects*.
- Microsoft Azure Architecture Center — *Microservices architecture style* and *Data considerations for microservices*.
- Google SRE Book — *Addressing Cascading Failures*.
- Microservices.io — Database-per-Service, Saga, Transactional Outbox, Idempotent Consumer.
- AWS Builders Library — Timeouts, retries, backoff, and jitter.
- Team Topologies — Team ownership and cognitive load concepts.

---

## 44. Status Seri

Saat ini selesai:

```text
Part 33 / 35 — Microservices Anti-Patterns and Failure Taxonomy
```

Seri belum selesai.

Part berikutnya:

```text
Part 34 — Capstone: Architecture Review, Design Exercise, and Decision Framework
```

Filename:

```text
learn-java-microservices-patterns-advanced-engineering-34-capstone-architecture-review.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-32-cost-complexity-architecture-economics.md">⬅️ 0. Posisi Part Ini di Dalam Series</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-34-capstone-architecture-review.md">0. Why This Capstone Exists ➡️</a>
</div>
