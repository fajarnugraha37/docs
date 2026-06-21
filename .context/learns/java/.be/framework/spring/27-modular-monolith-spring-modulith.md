# Part 27 — Modular Monolith with Spring and Spring Modulith

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `27-modular-monolith-spring-modulith.md`  
> Status seri: Part 27 dari 35 — belum selesai  
> Target pembaca: engineer Java/Spring yang sudah memahami IoC container, transaction, event, testing, web/API, security, observability, dan ingin naik ke level desain sistem modular jangka panjang.

---

## 1. Tujuan Part Ini

Part ini membahas **modular monolith** di ekosistem Spring, terutama dengan bantuan **Spring Modulith**.

Kita tidak sedang membahas monolith sebagai “sistem lama yang buruk”. Kita membahas monolith sebagai **deployment unit tunggal** yang tetap memiliki **modul internal yang jelas, terverifikasi, dan bisa berevolusi**.

Tujuan utama:

1. Memahami perbedaan **monolith**, **layered monolith**, **modular monolith**, dan **microservices**.
2. Memahami kenapa banyak sistem gagal bukan karena memakai monolith, tetapi karena tidak punya **module boundary**.
3. Memahami bagaimana Spring Modulith membaca struktur package sebagai logical modules.
4. Memahami dependency rule, named interface, allowed dependency, dan verifikasi arsitektur.
5. Memahami event-driven communication antar modul di dalam satu process.
6. Memahami event publication registry untuk reliability event internal.
7. Memahami testing per modul tanpa harus boot seluruh sistem secara boros.
8. Memahami observability modul: trace, metrics, dan actuator module endpoint.
9. Memahami strategi ekstraksi modul menjadi service jika suatu hari diperlukan.
10. Memahami failure model modular monolith pada sistem enterprise/regulatory/case-management.

Setelah part ini, Anda harus bisa melihat codebase Spring bukan hanya sebagai kumpulan controller-service-repository, tetapi sebagai **organisasi sistem bisnis** yang punya boundary, kontrak, invariant, dan evolusi.

---

## 2. Problem yang Sering Salah Dipahami

Banyak engineer membuat dikotomi terlalu dangkal:

```text
monolith = buruk
microservices = modern
```

Ini salah framing.

Yang benar:

```text
unbounded system = buruk
bounded system = lebih mudah dikendalikan
```

Unbounded system bisa berbentuk:

1. monolith besar tanpa boundary,
2. microservices yang saling memanggil secara acak,
3. shared database antar service,
4. package `common` yang dipakai semua orang,
5. module `utils` yang menjadi tempat sampah,
6. semua service bisa inject semua repository,
7. semua domain bisa update semua table.

Microservices tidak otomatis menyelesaikan coupling. Ia hanya mengubah coupling dari **compile-time/local coupling** menjadi **network/runtime/operational coupling**.

Jika boundary internal belum jelas, memecah sistem menjadi microservices biasanya hanya menghasilkan:

```text
big ball of mud over HTTP/Kafka
```

Modular monolith mencoba mengambil posisi tengah:

```text
single deployable unit
+ strong internal module boundary
+ clear dependency rule
+ event-based module interaction
+ module-level testing
+ module-level observability
+ easier extraction path later
```

---

## 3. Mental Model: Deployment Boundary vs Logical Boundary

Kunci modular monolith adalah memisahkan dua jenis boundary:

| Boundary | Pertanyaan | Contoh |
|---|---|---|
| Deployment boundary | Apa yang di-deploy sebagai satu unit? | satu Spring Boot application |
| Logical module boundary | Bagian bisnis mana yang boleh tahu bagian mana? | `case`, `appeal`, `document`, `audit`, `notification` |

Microservices menggabungkan keduanya:

```text
logical module = deployable service
```

Modular monolith memisahkannya:

```text
logical modules = many
runtime process = one
artifact/deployment = one
```

Keuntungan pemisahan ini:

1. Tidak perlu network call untuk setiap interaksi internal.
2. Transaction boundary masih bisa lebih sederhana.
3. Debugging lebih mudah.
4. Refactoring lintas modul masih mungkin dilakukan dalam satu repo.
5. Observability tetap bisa dibuat per modul.
6. Boundary tetap bisa diverifikasi oleh test.
7. Extraction ke microservice bisa dilakukan saat alasan bisnis/operasionalnya sudah kuat.

Risikonya:

1. Boundary mudah dilanggar jika tidak diverifikasi.
2. Shared database tetap bisa membuat coupling diam-diam.
3. Satu deployable berarti semua modul ikut release.
4. Runtime failure satu process dapat memengaruhi modul lain.
5. Scaling masih per aplikasi, bukan per modul.

Maka modular monolith bukan “silver bullet”. Ia adalah **architecture discipline**.

---

## 4. Layered Monolith vs Modular Monolith

Struktur umum yang sering dipakai di Spring:

```text
com.example.app
├── controller
├── service
├── repository
├── entity
├── dto
└── config
```

Ini disebut **package-by-layer**.

Masalahnya: layer tidak merepresentasikan domain boundary. Setelah sistem membesar, hampir semua service bisa mengakses hampir semua repository.

Contoh buruk:

```java
package com.example.app.service;

@Service
class AppealService {
    private final CaseRepository caseRepository;
    private final DocumentRepository documentRepository;
    private final PaymentRepository paymentRepository;
    private final UserRepository userRepository;
    private final AuditRepository auditRepository;
}
```

Secara teknis valid. Secara arsitektur mulai berbahaya.

Modular monolith lebih memilih **package-by-feature/domain/module**:

```text
com.example.aceas
├── casework
│   ├── api
│   ├── internal
│   └── CaseworkModuleConfiguration.java
├── appeal
│   ├── api
│   ├── internal
│   └── AppealModuleConfiguration.java
├── document
│   ├── api
│   ├── internal
│   └── DocumentModuleConfiguration.java
├── notification
│   ├── api
│   ├── internal
│   └── NotificationModuleConfiguration.java
└── shared
    └── kernel
```

Setiap module memiliki:

1. public API,
2. internal implementation,
3. domain/application services,
4. repository miliknya sendiri,
5. event yang dipublish,
6. dependency rule.

Perbedaannya:

| Aspek | Package-by-layer | Modular monolith |
|---|---|---|
| Unit utama | technical layer | business capability |
| Coupling | mudah menyebar horizontal | dibatasi antar modul |
| Test | sering full-context | bisa module-level |
| Refactoring | sulit karena semua saling tahu | lebih aman karena API jelas |
| Extraction | sulit | lebih realistis |
| Ownership | tidak jelas | bisa per module/team |

---

## 5. Apa Itu Spring Modulith?

Spring Modulith adalah toolkit opinionated untuk membangun aplikasi Spring Boot yang modular berdasarkan domain.

Ia membantu dalam beberapa hal:

1. menemukan application modules dari package structure,
2. memverifikasi dependency antar modul,
3. mendokumentasikan struktur modul,
4. melakukan integration test pada modul tertentu,
5. mendukung interaksi antar modul melalui application events,
6. menyediakan event publication registry untuk event publication yang lebih reliable,
7. menyediakan observability dan actuator insight pada level modul.

Mental model penting:

```text
Spring Modulith tidak otomatis membuat desain Anda bagus.
Ia membantu menegakkan desain modular yang Anda pilih.
```

Jika package structure buruk, Spring Modulith akan membantu menemukan keburukannya. Tetapi ia tidak menggantikan proses domain decomposition.

---

## 6. Kapan Modular Monolith Lebih Masuk Akal daripada Microservices?

Modular monolith cocok jika:

1. domain masih berkembang dan boundary belum stabil,
2. tim belum cukup besar untuk mengoperasikan banyak service,
3. kebutuhan scaling belum berbeda drastis per capability,
4. consistency requirement antar modul masih tinggi,
5. deployment orchestration microservices belum sepadan dengan manfaatnya,
6. sistem butuh auditability dan transaction clarity,
7. banyak workflow/case lifecycle yang melibatkan beberapa capability internal,
8. organisasi ingin refactoring cepat tanpa network contract overhead.

Microservices lebih masuk akal jika:

1. module boundary sudah stabil,
2. capability punya lifecycle release berbeda,
3. scaling profile sangat berbeda,
4. ownership team berbeda dan mature,
5. reliability isolation sangat dibutuhkan,
6. data ownership bisa dipisahkan,
7. operational platform sudah siap,
8. integration contract dan observability sudah matang.

Rule of thumb:

```text
Jangan memecah sistem berdasarkan harapan bahwa microservices akan menciptakan boundary.
Pecah setelah boundary sudah terbukti ada.
```

---

## 7. Domain Decomposition: Modul Bukan Sekadar Folder

Modul harus merepresentasikan **business capability**, bukan sekadar namespace teknis.

Contoh untuk regulatory/case-management style system:

```text
application-intake
eligibility-screening
casework
inspection
compliance
appeal
legal-action
correspondence
document-management
notification
audit
reporting
revenue
user-access
```

Tetapi tidak semua kandidat harus langsung menjadi modul. Modul yang baik punya:

1. alasan bisnis yang jelas,
2. state yang cukup mandiri,
3. invariant sendiri,
4. vocabulary sendiri,
5. lifecycle change yang bisa dibedakan,
6. dependency ke modul lain yang bisa dijelaskan,
7. public API yang kecil,
8. internal implementation yang bisa disembunyikan.

Contoh modul buruk:

```text
common
utils
helper
manager
processor
service
entity
```

Nama-nama ini biasanya bukan business capability. Ia adalah sinyal bahwa decomposition masih teknis, bukan domain-driven.

---

## 8. Modul dan Ownership of State

Modular monolith harus punya prinsip:

```text
Setiap state harus punya owner module.
```

Contoh:

| Data/State | Owner module | Modul lain boleh? |
|---|---|---|
| Case status | `casework` | baca via API/event, tidak update langsung |
| Appeal decision | `appeal` | modul lain subscribe event |
| Document metadata | `document` | akses via document API |
| Notification delivery status | `notification` | tidak dimanipulasi langsung oleh casework |
| Audit trail | `audit` | append via API/event |

Tanpa ownership, repository menjadi pintu belakang.

Anti-pattern:

```java
@Service
class AppealService {
    private final CaseRepository caseRepository; // milik casework

    void submitAppeal(...) {
        CaseEntity c = caseRepository.findById(...);
        c.setStatus("UNDER_APPEAL");
    }
}
```

Masalah:

1. `appeal` mengubah invariant `casework`.
2. `casework` tidak tahu state-nya berubah karena siapa.
3. audit/event bisa terlewat.
4. rule transisi status tersebar.
5. extraction ke service hampir mustahil.

Versi lebih baik:

```java
@Service
class AppealService {
    private final CaseworkApi caseworkApi;

    void submitAppeal(...) {
        caseworkApi.markUnderAppeal(caseId, appealId);
    }
}
```

Atau event-based:

```java
record AppealSubmitted(UUID appealId, UUID caseId) {}
```

Lalu `casework` mendengarkan event dan mengubah state-nya sendiri.

---

## 9. Public API vs Internal Implementation

Setiap modul sebaiknya punya struktur:

```text
com.example.aceas.casework
├── api
│   ├── CaseworkApi.java
│   ├── CaseSummary.java
│   └── events
│       ├── CaseOpened.java
│       └── CaseClosed.java
├── internal
│   ├── CaseworkApplicationService.java
│   ├── CaseStatusPolicy.java
│   ├── CaseRepository.java
│   ├── CaseEntity.java
│   └── CaseController.java
└── package-info.java
```

Prinsip:

1. Modul lain hanya boleh bergantung pada `api`.
2. `internal` hanya untuk modul itu sendiri.
3. Entity persistence biasanya internal.
4. Repository internal.
5. Controller bisa internal karena HTTP endpoint adalah adapter, bukan API antar modul.
6. Event yang dikonsumsi modul lain harus diletakkan di API/event package.

Public API jangan terlalu besar. API yang terlalu besar sama saja dengan tidak punya boundary.

Contoh API yang buruk:

```java
public interface CaseworkApi {
    CaseEntity findEntity(UUID id);
    CaseRepository repository();
    void updateRawStatus(UUID id, String status);
    void save(CaseEntity entity);
}
```

Ini membocorkan internal.

Contoh API lebih baik:

```java
public interface CaseworkApi {
    CaseSnapshot getSnapshot(CaseId caseId);
    void markUnderAppeal(CaseId caseId, AppealId appealId);
    boolean canStartEnforcement(CaseId caseId);
}
```

API modular harus berbicara dalam **capability**, bukan persistence mechanics.

---

## 10. Spring Modulith Application Module Discovery

Spring Modulith menganggap package langsung di bawah root application package sebagai kandidat module.

Contoh root:

```java
package com.example.aceas;

@SpringBootApplication
class AceasApplication {}
```

Struktur:

```text
com.example.aceas
├── casework
├── appeal
├── document
└── notification
```

Maka logical modules bisa ditemukan dari package:

```text
casework
appeal
document
notification
```

Ini berarti package structure bukan kosmetik. Package structure menjadi architecture model.

Di codebase besar, ini sangat penting:

```text
package = architecture boundary
```

Bukan:

```text
package = tempat menaruh class agar rapi
```

---

## 11. Verifikasi Modul dengan `ApplicationModules`

Spring Modulith memungkinkan kita membangun model modul dan memverifikasinya lewat test.

Contoh:

```java
package com.example.aceas;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ModularityTests {

    @Test
    void verifiesModularStructure() {
        ApplicationModules modules = ApplicationModules.of(AceasApplication.class);
        modules.verify();
    }
}
```

Test ini bukan unit test biasa. Ini adalah **architecture fitness function**.

Ia menjawab pertanyaan:

1. Apakah ada dependency cycle antar modul?
2. Apakah modul mengakses package internal modul lain?
3. Apakah dependency rule dilanggar?
4. Apakah structure aktual masih sesuai desain?

Dalam codebase enterprise, test seperti ini harus menjadi bagian dari CI.

Tanpa fitness function, architecture diagram sering menjadi artefak mati.

Dengan fitness function:

```text
architecture diagram -> executable constraint
```

---

## 12. Dependency Cycle: Musuh Utama Modularity

Cycle antar modul adalah sinyal desain buruk.

Contoh:

```text
casework -> appeal
appeal   -> casework
```

Atau lebih tersembunyi:

```text
casework -> document -> notification -> casework
```

Masalah cycle:

1. Tidak ada arah dependency yang jelas.
2. Modul tidak bisa diuji secara terpisah.
3. Perubahan kecil menyebar ke banyak modul.
4. Extraction menjadi hampir mustahil.
5. Startup/lifecycle dependency bisa menjadi rapuh.

Cara memutus cycle:

### 12.1 Extract Shared Concept ke Shared Kernel

Jika dua modul butuh konsep kecil yang sama:

```text
CaseId
AppealId
DocumentId
Money
Period
```

Bisa dipindahkan ke `shared.kernel`.

Tapi hati-hati: shared kernel harus kecil dan stabil.

Buruk:

```text
shared
├── entity
├── repository
├── service
├── util
└── everything
```

Baik:

```text
shared.kernel
├── CaseId.java
├── UserId.java
├── Money.java
└── DateRange.java
```

### 12.2 Gunakan Event

Jika modul A perlu memberi tahu modul B, tetapi tidak perlu langsung tahu hasilnya:

```text
appeal publishes AppealSubmitted
casework listens and updates case status
```

### 12.3 Introduce API Interface

Jika modul A benar-benar perlu sinkron memanggil modul B:

```text
appeal -> casework.api.CaseworkApi
```

Bukan:

```text
appeal -> casework.internal.CaseRepository
```

### 12.4 Re-evaluate Boundary

Jika dua modul selalu berubah bersama, memiliki state yang sama, dan saling membutuhkan secara intens, mungkin mereka bukan dua modul yang tepat.

Kadang solusi terbaik bukan event atau interface, tetapi menggabungkan ulang modul.

---

## 13. Named Interfaces

Dalam Spring Modulith, tidak semua package public otomatis harus menjadi API. Kita bisa menandai package tertentu sebagai named interface.

Mental model:

```text
module internal tetap tersembunyi
hanya interface/package tertentu yang boleh diakses modul lain
```

Contoh struktur:

```text
casework
├── api
│   └── CaseworkApi.java
├── events
│   └── CaseClosed.java
└── internal
    └── CaseRepository.java
```

Kita bisa menyatakan bahwa `api` atau `events` adalah permukaan publik.

Tujuan named interface:

1. memperkecil public surface,
2. membuat dependency lebih eksplisit,
3. menghindari semua class public Java menjadi API arsitektural,
4. memudahkan dokumentasi module contract.

Prinsip penting:

```text
Java public bukan berarti arsitektur public.
```

Banyak class harus `public` karena framework/proxy/serialization/testing, tetapi secara arsitektur tetap internal. Spring Modulith membantu membedakan dua level public itu.

---

## 14. Allowed Dependencies

Tidak semua modul boleh bergantung ke semua modul.

Contoh dependency rule:

```text
appeal -> casework::api
appeal -> document::api
appeal -> notification::events
casework -> audit::api
casework -> document::api
notification -> shared-kernel only
```

Spring Modulith memungkinkan dependency antar module didefinisikan lebih eksplisit, misalnya melalui metadata module/package.

Manfaat allowed dependencies:

1. menghindari dependency menyebar perlahan,
2. mencegah modul baru langsung inject apa pun,
3. mendokumentasikan arah dependency,
4. membuat CI gagal saat boundary dilanggar.

Ini penting untuk organisasi besar. Tanpa guardrail, codebase akan mengikuti tekanan delivery jangka pendek.

```text
deadline pressure + no boundary verification = architecture erosion
```

---

## 15. Application Module Test

Spring Modulith mendukung pengujian module tertentu.

Tujuannya:

1. memvalidasi modul sebagai unit integrasi,
2. tidak selalu boot seluruh aplikasi,
3. mock dependency ke modul lain,
4. memastikan modul tidak diam-diam memakai internal modul lain,
5. mempercepat feedback loop.

Contoh mental model:

```text
Test appeal module
- real beans inside appeal
- mock casework API
- mock document API
- verify event published
- verify state changed only inside appeal
```

Pola test:

```java
@ApplicationModuleTest
class AppealModuleTests {

    @Test
    void submitsAppeal() {
        // arrange
        // act
        // assert module behavior
    }
}
```

Kenapa ini penting?

Karena test Spring yang terlalu banyak menggunakan `@SpringBootTest` full context akan:

1. lambat,
2. fragile,
3. sulit menemukan boundary violation,
4. membuat semua modul selalu ikut test walau tidak relevan,
5. mendorong shared fixture global.

Module test lebih dekat ke arsitektur:

```text
test boundary mengikuti module boundary
```

---

## 16. Event-Based Module Interaction

Spring Modulith sangat mendorong interaksi antar modul menggunakan application events.

Contoh:

```java
public record AppealSubmitted(
    UUID appealId,
    UUID caseId,
    Instant submittedAt
) {}
```

Publisher:

```java
@Service
class AppealApplicationService {

    private final ApplicationEventPublisher events;
    private final AppealRepository appeals;

    @Transactional
    public void submitAppeal(SubmitAppealCommand command) {
        Appeal appeal = Appeal.submit(command.caseId(), command.reason());
        appeals.save(appeal);

        events.publishEvent(new AppealSubmitted(
            appeal.id(),
            appeal.caseId(),
            Instant.now()
        ));
    }
}
```

Listener:

```java
@Component
class CaseworkAppealListener {

    private final CaseworkApplicationService casework;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(AppealSubmitted event) {
        casework.markUnderAppeal(event.caseId(), event.appealId());
    }
}
```

Keuntungan event:

1. publisher tidak tahu semua consumer,
2. modul lebih longgar coupling-nya,
3. consumer bisa ditambah tanpa mengubah publisher,
4. event dapat menjadi integration point untuk extraction,
5. audit/notification/reporting bisa subscribe tanpa mengotori core flow.

Tapi event juga punya risiko:

1. control flow tidak eksplisit jika berlebihan,
2. debugging bisa sulit,
3. ordering tidak selalu jelas,
4. failure listener bisa membuat ambiguity,
5. transaction semantics harus dipahami,
6. eventual consistency harus diterima.

---

## 17. Event Semantics: Jangan Asal Publish Event

Event harus merepresentasikan fakta yang sudah terjadi.

Baik:

```text
AppealSubmitted
CaseClosed
DocumentUploaded
InspectionScheduled
PaymentReceived
```

Kurang baik:

```text
SubmitAppealEvent
CloseCaseEvent
SendNotificationEvent
UpdateSomethingEvent
```

Perbedaannya:

| Jenis | Makna |
|---|---|
| Command | meminta sesuatu dilakukan |
| Event | memberitahu sesuatu sudah terjadi |

Jika nama event berbentuk perintah, mungkin itu command, bukan event.

Dalam modular monolith, command biasanya sinkron melalui API modul:

```java
caseworkApi.markUnderAppeal(caseId, appealId);
```

Event dipakai untuk decoupled reaction:

```java
AppealSubmitted
```

Rule:

```text
Gunakan direct module API untuk mandatory synchronous invariant.
Gunakan event untuk secondary reaction atau eventual consistency.
```

Contoh:

| Kebutuhan | Pattern |
|---|---|
| Validasi case boleh diajukan appeal? | direct API call |
| Setelah appeal submitted, kirim notifikasi | event |
| Setelah document uploaded, update search index | event |
| Hitung ulang SLA setelah case status berubah | bisa event jika eventual acceptable |
| Pastikan payment sukses sebelum approve | direct call/transaction boundary jelas |

---

## 18. Transactional Events

Dalam Spring, event listener bisa berjalan:

1. segera saat publish,
2. sebelum commit,
3. setelah commit,
4. setelah rollback,
5. setelah completion.

Untuk banyak kasus modular monolith, listener sebaiknya berjalan setelah commit:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
void on(AppealSubmitted event) {
    notification.sendAppealSubmitted(event.appealId());
}
```

Kenapa?

Karena event `AppealSubmitted` berarti fakta appeal sudah tersimpan. Jika listener berjalan sebelum commit dan transaksi rollback, consumer bisa bereaksi terhadap fakta yang tidak pernah terjadi.

Tapi ada trade-off:

```text
AFTER_COMMIT listener tidak lagi berada dalam transaction publisher.
```

Jika listener gagal setelah commit:

1. data publisher sudah committed,
2. side effect listener mungkin gagal,
3. perlu retry/recovery,
4. perlu event publication registry atau outbox-like pattern.

---

## 19. Event Publication Registry

Spring Modulith menyediakan event publication registry untuk meningkatkan reliability event application internal.

Masalah yang ingin diselesaikan:

```text
transaction committed
but event listener failed
```

Tanpa registry, failure listener bisa hilang dari awareness operasional jika tidak dicatat dengan baik.

Dengan event publication registry, publikasi event dapat dicatat sehingga completion listener bisa dilacak dan republish/retry dapat dilakukan sesuai mekanisme yang tersedia.

Mental model:

```text
publish event
-> record publication intent/completion
-> listener executes
-> mark publication completed
-> incomplete publications can be inspected/retried
```

Ini mirip outbox dalam spirit, tetapi tetap berada dalam konteks Spring Modulith application event infrastructure.

Penting:

```text
Event publication registry bukan pengganti message broker untuk semua kasus.
```

Ia cocok untuk reliability event internal modular monolith. Jika event harus melintasi process boundary, integrasi dengan broker/outbox/externalization perlu dipertimbangkan.

---

## 20. Internal Event vs External Integration Event

Jangan campur semua event menjadi satu.

| Jenis event | Audience | Stability | Contoh |
|---|---|---|---|
| Domain/internal event | modul dalam aplikasi | bisa berubah lebih cepat | `AppealSubmitted` |
| Application event | modul internal + workflow reaction | medium | `CaseReadyForReview` |
| Integration event | sistem luar | harus stabil/versioned | `CaseStatusChangedV1` |

Internal event boleh memakai object yang lebih domain-specific, tetapi tetap jangan bocorkan entity persistence.

Buruk:

```java
public record CaseClosedEvent(CaseEntity caseEntity) {}
```

Baik:

```java
public record CaseClosed(
    UUID caseId,
    String previousStatus,
    String newStatus,
    Instant closedAt
) {}
```

Integration event harus lebih ketat:

1. versioned,
2. backward compatible,
3. tidak bergantung pada class internal,
4. punya schema/contract,
5. memiliki idempotency key/correlation id,
6. memiliki semantic ownership.

---

## 21. Module Boundary and Transaction Boundary

Modular monolith sering membuat orang tergoda melakukan satu transaksi besar lintas modul.

Contoh:

```java
@Transactional
void submitAppeal(...) {
    appeal.create(...);
    casework.updateStatus(...);
    document.lockDocuments(...);
    notification.createPending(...);
    audit.append(...);
}
```

Ini terlihat konsisten, tetapi bisa menjadi masalah:

1. transaction terlalu besar,
2. lock duration panjang,
3. module invariant tercampur,
4. rollback semantics sulit,
5. extraction ke service sulit,
6. side effect tertunda atau ambigu.

Alternatif:

```text
appeal transaction:
- create appeal
- publish AppealSubmitted after commit

casework listener:
- mark case under appeal

notification listener:
- create notification request

audit listener:
- append audit entry
```

Namun tidak semua hal harus eventual. Jika invariant bisnis mengharuskan sinkron, direct API lebih tepat.

Pertanyaan desain:

1. Apakah operasi ini harus atomic bersama?
2. Jika salah satu step gagal, apa kompensasinya?
3. Apakah user harus langsung melihat hasil semua modul?
4. Apakah modul consumer boleh tertunda?
5. Apakah ada SLA/eventual consistency window?
6. Apakah data owner yang benar melakukan update?

Top-tier engineer tidak sekadar memilih event karena trendy. Ia memilih berdasarkan invariant.

---

## 22. Module Boundary and Database Boundary

Modular monolith biasanya masih memakai satu database. Itu tidak salah.

Yang berbahaya adalah satu database tanpa ownership.

Pola yang lebih baik:

```text
single database
multiple module-owned schema/table groups
repository internal per module
no cross-module repository injection
no direct update table module lain
```

Contoh:

```text
casework tables:
- case_file
- case_status_history
- case_assignment

appeal tables:
- appeal
- appeal_decision
- appeal_attachment_link

document tables:
- document
- document_version
- document_access_grant
```

Modul lain tidak boleh query table internal sembarangan hanya karena berada di DB yang sama.

Untuk read model/reporting, ada beberapa opsi:

1. dedicated reporting module dengan read-only projections,
2. database view yang dianggap contract,
3. event-maintained read model,
4. direct API query jika kebutuhan kecil,
5. exported query service.

Anti-pattern:

```sql
SELECT *
FROM case_file c
JOIN appeal a ON ...
JOIN document d ON ...
JOIN notification n ON ...
```

Jika query seperti ini ada di sembarang modul, boundary runtuh.

---

## 23. Shared Kernel: Berguna tetapi Berbahaya

Shared kernel adalah kumpulan konsep kecil yang stabil dan dipakai beberapa modul.

Contoh yang wajar:

```text
CaseId
UserId
TenantId
Money
DateRange
EmailAddress
PostalCode
```

Contoh yang mulai berbahaya:

```text
BaseEntity
BaseRepository
CommonService
GenericWorkflowService
CaseUtils
StatusUtils
```

Shared kernel harus memenuhi syarat:

1. kecil,
2. stabil,
3. tidak bergantung ke modul spesifik,
4. tidak mengandung policy bisnis yang berubah cepat,
5. tidak menjadi tempat menaruh semua yang tidak tahu harus diletakkan di mana.

Rule praktis:

```text
Jika class berubah karena requirement satu modul, jangan taruh di shared kernel.
```

---

## 24. Module API Design

API antar modul harus sengaja didesain.

Ada beberapa bentuk API:

### 24.1 Synchronous Interface

```java
public interface CaseworkApi {
    CaseSnapshot getSnapshot(CaseId caseId);
    void markUnderAppeal(CaseId caseId, AppealId appealId);
}
```

Cocok untuk:

1. query kecil,
2. mandatory validation,
3. invariant yang butuh jawaban langsung,
4. command yang harus dipastikan berhasil/gagal.

### 24.2 Domain Event

```java
public record CaseClosed(CaseId caseId, Instant closedAt) {}
```

Cocok untuk:

1. notification,
2. audit,
3. read model update,
4. search indexing,
5. secondary reaction.

### 24.3 Published Read Model

```java
public record CaseSummary(
    CaseId id,
    String referenceNo,
    String status,
    String applicantName
) {}
```

Cocok untuk modul lain yang perlu membaca ringkasan tanpa tahu entity internal.

### 24.4 Policy API

```java
public interface CaseworkPolicyApi {
    boolean canAppeal(CaseId caseId, UserId actor);
}
```

Cocok untuk authorization/eligibility/validation lintas modul.

Namun hati-hati: policy API lintas modul bisa membuat coupling kuat jika semua rule tersebar.

---

## 25. Anti-Corruption Boundary Antar Modul

Walaupun masih satu process, modul tetap perlu boundary transform.

Buruk:

```java
AppealService menerima CaseEntity dari Casework.
```

Baik:

```java
AppealService menerima CaseSnapshot atau CaseAppealEligibility.
```

Kenapa?

Entity internal membawa terlalu banyak detail:

1. field persistence,
2. lazy loading,
3. lifecycle JPA,
4. invariant internal,
5. relasi yang tidak relevan,
6. accidental write access.

DTO antar modul bukan sekadar “boilerplate”. Ia adalah **anti-corruption layer**.

---

## 26. Modul dan Controller

Controller adalah adapter dari dunia HTTP ke application service.

Pertanyaan: controller diletakkan di mana?

Biasanya controller milik modul yang menyediakan capability.

```text
casework/internal/web/CaseController.java
appeal/internal/web/AppealController.java
document/internal/web/DocumentController.java
```

Jangan buat satu package global:

```text
web/controllers/all controllers here
```

Karena controller global akan melemahkan boundary domain.

API endpoint adalah external boundary, tetapi implementasinya tetap harus masuk ke modul owner.

---

## 27. Modul dan Security

Security dalam modular monolith punya dua level:

1. platform-level security,
2. module-level authorization.

Platform-level:

```text
authentication
session/JWT
CSRF/CORS
filter chain
basic route authorization
```

Module-level:

```text
can user submit appeal?
can officer assign this case?
can reviewer see document?
can agency user approve enforcement?
```

Jangan semua authorization ditaruh di global security config.

Buruk:

```java
.requestMatchers("/appeals/**").hasRole("OFFICER")
```

Ini terlalu kasar untuk sistem kompleks.

Lebih baik:

```java
@PreAuthorize("@appealAuthorization.canSubmit(#command, authentication)")
public AppealId submit(SubmitAppealCommand command) { ... }
```

Atau di application service:

```java
appealPolicy.assertCanSubmit(actor, caseSnapshot);
```

Tetapi boundary-nya harus jelas:

1. authentication dan coarse access di platform/security layer,
2. fine-grained authorization di module/domain/application layer,
3. audit decision di modul terkait.

---

## 28. Modul dan Observability

Jika modular monolith hanya punya metrics global, kita sulit tahu modul mana yang bermasalah.

Observability modular harus menjawab:

1. Modul mana yang menghasilkan latency tinggi?
2. Modul mana yang paling sering memanggil modul lain?
3. Event mana yang sering gagal?
4. Modul mana yang paling banyak error?
5. Dependency antar modul mana yang dominan?
6. Apakah flow case/appeal/document lambat karena satu modul?

Spring Modulith menyediakan support production-ready seperti actuator endpoint untuk struktur modul serta observability interaksi modul.

Secara desain, kita bisa menambahkan tag:

```text
module=appeal
operation=submitAppeal
result=success/failure
```

Contoh custom metric:

```java
class AppealMetrics {
    private final Counter submitted;

    AppealMetrics(MeterRegistry registry) {
        this.submitted = Counter.builder("appeal.submitted")
            .tag("module", "appeal")
            .register(registry);
    }
}
```

Tetapi hindari cardinality tinggi:

Buruk:

```text
tag caseId=123456
```

Baik:

```text
tag module=appeal
 tag operation=submit
 tag result=success
```

---

## 29. Module Documentation

Spring Modulith dapat menghasilkan dokumentasi struktur module.

Nilainya bukan hanya dokumentasi indah, tetapi menjaga alignment:

```text
actual code structure -> generated module docs -> architecture review
```

Dokumentasi yang bagus untuk setiap module:

1. nama module,
2. responsibility,
3. owner state,
4. public API,
5. published events,
6. consumed events,
7. allowed dependencies,
8. forbidden dependencies,
9. transaction boundary,
10. integration boundary,
11. key invariants,
12. operational signals.

Contoh module canvas:

```text
Module: appeal
Responsibility:
- manage appeal submission, assessment, and decision lifecycle

Owns:
- appeal
- appeal_decision
- appeal_status_history

Public API:
- AppealApi
- AppealSummary

Publishes:
- AppealSubmitted
- AppealWithdrawn
- AppealDecisionIssued

Consumes:
- CaseClosed
- DocumentDeleted

Allowed dependencies:
- casework::api
- document::api
- audit::api
- shared-kernel

Forbidden:
- casework::internal
- document::internal
- notification::internal
```

---

## 30. Spring Modulith Moments

Spring Modulith juga menyediakan konsep Moments, yaitu pendekatan event-based untuk waktu.

Masalah umum:

```text
Setiap hari jam 00:00, generate SLA reminder
Setiap awal bulan, close reporting period
Setiap akhir kuartal, archive old records
```

Tanpa struktur, logic waktu tersebar di scheduler global.

Dengan event-based time, modul bisa bereaksi pada event waktu yang relevan.

Mental model:

```text
time passes -> moment event published -> interested modules react
```

Manfaat:

1. time-based logic lebih eksplisit,
2. testing waktu lebih mudah,
3. modul yang berkepentingan subscribe sendiri,
4. scheduler tidak menjadi god component.

Tetapi tetap perlu discipline:

1. jangan jadikan semua workflow berbasis time event,
2. pastikan idempotency,
3. pastikan locking di multi-replica deployment,
4. observability wajib untuk event waktu.

---

## 31. Modular Monolith untuk Workflow/State Machine

Untuk sistem regulatory/case-management, module boundary sering bertemu workflow.

Contoh:

```text
casework -> inspection -> enforcement -> appeal -> legal -> closure
```

Pertanyaan penting:

1. Apakah workflow engine menjadi modul sendiri?
2. Apakah state owner ada di casework?
3. Apakah appeal mengubah case state langsung?
4. Apakah compliance module hanya listener event?
5. Apakah audit append dilakukan sinkron atau event?

Pola yang sering masuk akal:

```text
casework module owns case lifecycle state
other modules publish facts or send commands via casework API
casework validates transition
casework publishes CaseStatusChanged
secondary modules react
```

Contoh:

```java
public interface CaseworkApi {
    void requestTransition(CaseId caseId, CaseTransitionCommand command);
}
```

`casework` tetap owner state machine.

`appeal` tidak langsung set case status. Ia memberi fakta atau command:

```text
AppealSubmitted
```

atau:

```text
caseworkApi.markUnderAppeal(...)
```

Tergantung invariant.

Rule:

```text
Module yang memiliki state machine harus menjadi satu-satunya penentu valid transition.
```

---

## 32. Modular Monolith dan Audit Defensibility

Dalam sistem regulasi, audit bukan sekadar log. Audit adalah bukti keputusan.

Module-level audit harus menjawab:

1. siapa melakukan aksi,
2. modul apa yang memproses,
3. aggregate apa yang berubah,
4. command/event apa yang memicu perubahan,
5. rule apa yang dievaluasi,
6. outcome apa yang dihasilkan,
7. correlation id/request id,
8. waktu dan transaction boundary,
9. apakah event consumer berhasil,
10. apakah ada retry/compensation.

Modular monolith membantu jika audit dirancang dengan module boundary:

```text
audit module receives facts from modules
modules publish meaningful domain events
audit stores append-only record
```

Tetapi jangan buat audit module mengambil alih business semantics semua modul.

Buruk:

```text
audit module knows all entity internals and diffs everything blindly
```

Lebih baik:

```text
module emits semantically meaningful audit fact
```

Contoh:

```java
public record CaseAssignedAuditFact(
    CaseId caseId,
    UserId previousOfficer,
    UserId newOfficer,
    UserId assignedBy,
    Instant assignedAt,
    String reason
) {}
```

---

## 33. Migration dari Layered Monolith ke Modular Monolith

Migrasi tidak harus big-bang.

Langkah realistis:

### Step 1 — Inventory Package dan Dependency

Cari:

1. service yang inject banyak repository,
2. repository dipakai lintas domain,
3. common/util yang terlalu besar,
4. entity yang dipakai banyak modul,
5. cyclic dependency,
6. controller yang memanggil banyak service lintas domain.

### Step 2 — Tentukan Candidate Modules

Gunakan domain capability:

```text
casework
appeal
document
notification
audit
reporting
```

### Step 3 — Pindahkan Package secara Bertahap

Jangan langsung rewrite logic. Mulai dari package structure.

```text
controller/service/repository lama
-> module/internal
```

### Step 4 — Definisikan API Package

Expose hanya yang dibutuhkan modul lain.

### Step 5 — Larang Cross-Repository Access

Modul lain tidak boleh inject repository owner module.

### Step 6 — Tambahkan Spring Modulith Verification Test

Mulai dari verify sederhana.

### Step 7 — Perbaiki Violation Paling Besar

Jangan berusaha sempurna sejak hari pertama. Prioritaskan:

1. cycle,
2. internal package access,
3. repository leakage,
4. shared common abuse.

### Step 8 — Introduce Events

Mulai dari secondary side effects:

1. notification,
2. audit,
3. reporting projection,
4. search indexing.

### Step 9 — Add Module Tests

Uji module behavior dengan dependency external dimock.

### Step 10 — Document dan Enforce di CI

Architecture harus executable.

---

## 34. Refactoring Example: Dari Coupled Service ke Module API/Event

Awal:

```java
@Service
class AppealService {
    private final AppealRepository appeals;
    private final CaseRepository cases;
    private final NotificationService notification;
    private final AuditService audit;

    @Transactional
    void submit(UUID caseId, String reason) {
        CaseEntity c = cases.findById(caseId).orElseThrow();
        if (!c.canAppeal()) throw new IllegalStateException();

        AppealEntity appeal = new AppealEntity(caseId, reason);
        appeals.save(appeal);

        c.setStatus("UNDER_APPEAL");
        notification.sendAppealSubmitted(appeal.getId());
        audit.log("Appeal submitted");
    }
}
```

Masalah:

1. Appeal mengakses `CaseRepository` langsung.
2. Appeal mengubah case status langsung.
3. Notification side effect di dalam transaksi.
4. Audit hardcoded.
5. Transaction terlalu luas.
6. Boundary kabur.

Versi modular:

```java
@Service
class AppealApplicationService {
    private final AppealRepository appeals;
    private final CaseworkApi casework;
    private final ApplicationEventPublisher events;

    @Transactional
    AppealId submit(SubmitAppealCommand command) {
        CaseAppealEligibility eligibility = casework.checkAppealEligibility(command.caseId());
        eligibility.assertAllowed();

        Appeal appeal = Appeal.submit(command.caseId(), command.reason(), command.actor());
        appeals.save(appeal);

        events.publishEvent(new AppealSubmitted(
            appeal.id(),
            appeal.caseId(),
            command.actor(),
            Instant.now()
        ));

        return appeal.id();
    }
}
```

Consumer casework:

```java
@Component
class CaseworkAppealListener {
    private final CaseworkApplicationService casework;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(AppealSubmitted event) {
        casework.markUnderAppeal(event.caseId(), event.appealId());
    }
}
```

Consumer notification:

```java
@Component
class AppealNotificationListener {
    private final NotificationApi notification;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(AppealSubmitted event) {
        notification.enqueueAppealSubmitted(event.appealId(), event.caseId());
    }
}
```

Consumer audit:

```java
@Component
class AppealAuditListener {
    private final AuditApi audit;

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(AppealSubmitted event) {
        audit.append(new AuditFact(
            "appeal",
            "appeal.submitted",
            event.appealId().toString(),
            event.actor().toString(),
            event.submittedAt()
        ));
    }
}
```

Trade-off:

1. Flow menjadi lebih decoupled.
2. Debugging butuh event tracing.
3. Event failure harus ditangani.
4. User mungkin tidak langsung melihat secondary effect.
5. Test harus mencakup publisher dan listeners.

Ini bukan “lebih sederhana” dalam jumlah class, tetapi lebih terkendali dalam architecture boundary.

---

## 35. Modular Monolith dan Extraction ke Microservice

Modular monolith yang baik memberi jalan ekstraksi.

Tanda sebuah modul siap diekstrak:

1. public API kecil dan stabil,
2. repository internal tidak dipakai modul lain,
3. event contract jelas,
4. dependency inbound/outbound diketahui,
5. state ownership jelas,
6. test module kuat,
7. observability module tersedia,
8. transaction coupling dengan modul lain rendah,
9. tidak ada shared entity,
10. tidak ada cycle.

Ekstraksi buruk:

```text
copy package into new service
keep shared DB
keep internal class dependency via shared library
replace method call with REST call everywhere
```

Ekstraksi lebih baik:

1. freeze module API,
2. introduce port interface,
3. add remote adapter behind same API,
4. externalize events,
5. split data ownership,
6. migrate read paths,
7. migrate write paths,
8. monitor consistency,
9. remove in-process dependency.

Pattern strangler internal:

```text
in-process module API
-> interface remains
-> implementation switches to remote client
-> module state moves out
-> callers mostly unchanged
```

Jika modular monolith sudah benar, extraction menjadi engineering project, bukan archaeology project.

---

## 36. Failure Model Modular Monolith

Modular monolith punya failure mode khusus.

### 36.1 Boundary Erosion

Gejala:

1. modul mengakses internal modul lain,
2. repository dipakai lintas modul,
3. shared common membesar,
4. dependency cycle muncul,
5. architecture test dimatikan karena “mengganggu delivery”.

Mitigasi:

1. Spring Modulith verification test,
2. code review boundary checklist,
3. package naming convention,
4. API package kecil,
5. CI enforcement.

### 36.2 Event Black Hole

Gejala:

1. event dipublish tetapi listener gagal diam-diam,
2. no retry,
3. no event registry,
4. no metrics,
5. no alert.

Mitigasi:

1. event publication registry,
2. idempotent listener,
3. error metric,
4. retry policy,
5. operational endpoint/runbook.

### 36.3 Shared Database Coupling

Gejala:

1. join lintas table owner,
2. update table modul lain,
3. migration satu modul memecahkan modul lain,
4. report query menjadi dependency tersembunyi.

Mitigasi:

1. owner table jelas,
2. repository internal,
3. read model/projection,
4. contract view,
5. migration review per module.

### 36.4 God Module

Gejala:

1. module `core` dipakai semua,
2. module `workflow` tahu semua domain,
3. module `common` mengandung business rule,
4. semua flow lewat satu orchestrator besar.

Mitigasi:

1. pecah responsibility,
2. pindahkan rule ke owner module,
3. gunakan event untuk secondary reaction,
4. minimalkan shared kernel.

### 36.5 Release Coupling

Gejala:

1. semua modul harus regression test setiap change,
2. tidak jelas impact change module,
3. test suite lambat.

Mitigasi:

1. module tests,
2. dependency graph,
3. impact analysis,
4. contract tests,
5. feature flags.

---

## 37. Design Heuristics untuk Top-Tier Spring Modular System

Gunakan aturan praktis berikut.

### 37.1 Satu Modul, Satu Alasan Bisnis

Modul harus bisa dijelaskan tanpa kata teknis.

Baik:

```text
appeal manages appeal lifecycle
```

Buruk:

```text
processor contains processing logic
```

### 37.2 Repository Tidak Boleh Menjadi API Antar Modul

Repository adalah persistence detail.

Jika modul lain butuh data, expose query API atau event/read model.

### 37.3 Entity Tidak Boleh Keluar Modul

Entity adalah internal state representation.

Gunakan DTO/snapshot/value object.

### 37.4 Event Adalah Fakta, Bukan Perintah

Gunakan past-tense naming.

### 37.5 Direct Call untuk Invariant, Event untuk Reaction

Jangan memakai event untuk hal yang harus langsung valid dan atomic, kecuali Anda siap dengan eventual consistency.

### 37.6 Shared Kernel Harus Kecil

Jika shared kernel tumbuh terus, boundary salah.

### 37.7 Architecture Test Wajib di CI

Boundary yang tidak diverifikasi akan membusuk.

### 37.8 Observability Harus Per Modul

Jika tidak bisa melihat interaksi modul, event-driven modularity akan sulit dioperasikan.

### 37.9 Module API Harus Punya Owner

API tanpa owner akan menjadi dumping ground.

### 37.10 Ekstraksi Service Bukan Tujuan Awal

Tujuan modularity adalah evolvability. Microservice extraction hanya salah satu kemungkinan hasil.

---

## 38. Checklist Review Modular Monolith

Gunakan checklist ini saat review PR atau desain.

### 38.1 Boundary

- [ ] Apakah class baru berada di module yang tepat?
- [ ] Apakah module lain mengakses package internal?
- [ ] Apakah ada dependency cycle?
- [ ] Apakah API module terlalu besar?
- [ ] Apakah shared kernel digunakan hanya untuk konsep stabil?

### 38.2 State Ownership

- [ ] Siapa owner data/state ini?
- [ ] Apakah repository hanya dipakai owner module?
- [ ] Apakah modul lain update table/entity owner module?
- [ ] Apakah read model lintas module jelas?

### 38.3 Communication

- [ ] Apakah direct API dipakai untuk invariant sinkron?
- [ ] Apakah event dipakai untuk reaction/eventual consistency?
- [ ] Apakah event merepresentasikan fakta yang sudah terjadi?
- [ ] Apakah listener idempotent?
- [ ] Apakah event failure observable?

### 38.4 Transaction

- [ ] Apakah transaction terlalu besar?
- [ ] Apakah side effect external dilakukan setelah commit?
- [ ] Apakah rollback semantics jelas?
- [ ] Apakah event listener phase tepat?

### 38.5 Testing

- [ ] Apakah module verification test ada?
- [ ] Apakah module-level test ada?
- [ ] Apakah dependency external dimock dengan benar?
- [ ] Apakah event publication/listener diuji?

### 38.6 Observability

- [ ] Apakah metrics memiliki tag module/operation/result?
- [ ] Apakah trace menunjukkan interaksi modul?
- [ ] Apakah actuator module insight tersedia?
- [ ] Apakah failure listener punya alert?

### 38.7 Future Extraction

- [ ] Apakah module API cukup stabil?
- [ ] Apakah entity tidak bocor?
- [ ] Apakah database ownership jelas?
- [ ] Apakah event contract bisa dieksternalisasi?

---

## 39. Contoh Struktur Project yang Direkomendasikan

```text
src/main/java/com/example/aceas
├── AceasApplication.java
├── shared
│   └── kernel
│       ├── CaseId.java
│       ├── UserId.java
│       ├── TenantId.java
│       └── DateRange.java
├── casework
│   ├── package-info.java
│   ├── api
│   │   ├── CaseworkApi.java
│   │   ├── CaseSnapshot.java
│   │   └── events
│   │       ├── CaseOpened.java
│   │       ├── CaseStatusChanged.java
│   │       └── CaseClosed.java
│   └── internal
│       ├── web
│       ├── application
│       ├── domain
│       └── persistence
├── appeal
│   ├── package-info.java
│   ├── api
│   │   ├── AppealApi.java
│   │   └── events
│   │       ├── AppealSubmitted.java
│   │       └── AppealDecisionIssued.java
│   └── internal
│       ├── web
│       ├── application
│       ├── domain
│       └── persistence
├── document
│   ├── package-info.java
│   ├── api
│   └── internal
├── notification
│   ├── package-info.java
│   ├── api
│   └── internal
└── audit
    ├── package-info.java
    ├── api
    └── internal
```

Test structure:

```text
src/test/java/com/example/aceas
├── ModularityTests.java
├── casework
│   └── CaseworkModuleTests.java
├── appeal
│   └── AppealModuleTests.java
└── document
    └── DocumentModuleTests.java
```

---

## 40. What Good Looks Like

Sistem Spring modular yang sehat memiliki karakteristik berikut:

1. Package structure merepresentasikan domain capability.
2. `ApplicationModules.verify()` berjalan di CI.
3. Tidak ada dependency cycle antar modul.
4. Modul hanya expose API kecil.
5. Repository dan entity internal tidak bocor.
6. Shared kernel kecil dan stabil.
7. Event antar modul punya semantic yang jelas.
8. Listener event idempotent dan observable.
9. Transaction boundary tidak terlalu besar.
10. Module-level tests cepat dan meaningful.
11. Observability bisa menunjukkan module interaction.
12. Documentation module dapat digenerate dari code.
13. Ekstraksi ke service mungkin dilakukan tanpa rewrite total.
14. Engineer baru bisa memahami ownership dari package structure.
15. Architecture tidak hanya ada di diagram, tetapi ditegakkan oleh test.

---

## 41. Latihan Praktis

### Latihan 1 — Identifikasi Modul

Ambil sistem Spring yang Anda punya. Buat daftar package saat ini dan kelompokkan ke business capability.

Output:

```text
Candidate modules:
- ...

Ambiguous modules:
- ...

Potential shared kernel:
- ...

God modules:
- ...
```

### Latihan 2 — Cari Repository Leakage

Cari semua injection repository:

```text
private final .*Repository
```

Tentukan apakah repository dipakai oleh owner module atau modul lain.

### Latihan 3 — Cari Cycle

Gambarkan dependency antar capability.

```text
casework -> document
appeal -> casework
casework -> appeal ?
```

Jika ada cycle, usulkan cara memutuskannya:

1. event,
2. API interface,
3. shared kernel,
4. merge module,
5. redesign boundary.

### Latihan 4 — Desain Event

Ambil satu use case:

```text
Submit appeal
```

Tentukan:

1. command,
2. owner module,
3. transaction boundary,
4. event published,
5. listeners,
6. retry/failure strategy,
7. audit fact.

### Latihan 5 — Module Canvas

Buat canvas untuk satu module:

```text
Module:
Responsibility:
Owns:
Public API:
Publishes:
Consumes:
Allowed dependencies:
Forbidden dependencies:
Key invariants:
Operational metrics:
```

---

## 42. Ringkasan Mental Model

Modular monolith bukan kompromi lemah antara monolith dan microservices. Ia adalah cara untuk mendapatkan **modularity, evolvability, dan boundary discipline** tanpa membayar seluruh biaya distributed system terlalu awal.

Spring Modulith membantu menjadikan boundary itu executable:

```text
package structure -> application modules -> verification -> documentation -> module tests -> observability
```

Prinsip paling penting:

```text
Monolith bukan masalah utama.
Unbounded coupling adalah masalah utama.
```

Dan:

```text
Microservices tanpa modularity hanya memindahkan kekacauan ke network.
```

Sistem Spring yang matang harus bisa menjawab:

1. Modul apa yang memiliki state ini?
2. Modul mana yang boleh memanggil API ini?
3. Event apa yang dipublish saat state berubah?
4. Listener mana yang wajib berhasil?
5. Apa yang terjadi jika listener gagal?
6. Dependency cycle mana yang dilarang?
7. Bagaimana membuktikan boundary tidak dilanggar?
8. Bagaimana mengamati interaksi antar modul di production?
9. Modul mana yang siap diekstrak jika dibutuhkan?

Jika pertanyaan-pertanyaan ini bisa dijawab dari code, test, dan observability, maka Spring monolith Anda bukan sekadar monolith. Ia adalah sistem modular yang punya daya tahan evolusi.

---

## 43. Status Seri

```text
Part saat ini : 27 dari 35
Status        : belum selesai
Berikutnya    : 28-multitenancy-enterprise-platform-patterns.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./26-testing-spring-applications-at-scale.md">⬅️ Testing Spring Applications at Scale</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./28-multitenancy-enterprise-platform-patterns.md">Part 28 — Multi-Tenancy, Multi-Module, and Enterprise Platform Patterns ➡️</a>
</div>
