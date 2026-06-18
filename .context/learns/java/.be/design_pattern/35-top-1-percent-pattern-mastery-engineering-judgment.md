# 35 — Top 1% Engineer Pattern Mastery: Taste, Judgment, and System Evolution

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `35-top-1-percent-pattern-mastery-engineering-judgment.md`  
> Bahasa: Java 8 sampai Java 25  
> Level: Advanced / Staff+ Engineering Judgment  
> Status: Part 35 dari 35 — **bagian terakhir seri**

---

## 0. Orientasi

Setelah mempelajari design pattern dan anti-pattern dari banyak sudut, bagian terakhir ini tidak lagi bertanya:

```text
Pattern apa yang tersedia?
```

Pertanyaan senior sebenarnya adalah:

```text
Kapan pattern layak dipakai?
Kapan pattern harus ditolak?
Kapan code sederhana lebih benar?
Kapan abstraction harus dibuat sekarang?
Kapan abstraction harus ditunda?
Bagaimana menjaga sistem tetap bisa berubah selama bertahun-tahun?
Bagaimana membuat keputusan desain yang bisa dipertanggungjawabkan?
```

Top engineer bukan orang yang paling banyak hafal pattern. Top engineer adalah orang yang mampu melihat **force**, **constraint**, **risk**, **cost**, dan **evolution path** di balik desain.

Pattern mastery berarti memiliki **taste**: kemampuan membedakan desain yang tampak pintar tetapi rapuh dari desain yang mungkin biasa saja tetapi stabil, jelas, dan mudah berevolusi.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu diharapkan mampu:

1. Memahami pattern mastery sebagai judgment, bukan katalog hafalan.
2. Menggunakan pattern sebagai respons terhadap design force, bukan sebagai template mekanis.
3. Membedakan essential complexity dari accidental complexity.
4. Mengenali kapan boring code lebih baik daripada abstraction.
5. Mengenali kapan abstraction wajib dibuat meskipun belum terasa “butuh”.
6. Menilai pattern berdasarkan cost, consequence, dan migration path.
7. Melakukan design review pada level force dan invariant.
8. Menulis Pattern Decision Record atau Architecture Decision Record yang berguna.
9. Menjaga architecture tetap evolvable, bukan hanya “clean” di awal.
10. Memimpin tim agar menggunakan pattern secara konsisten dan rasional.
11. Mengembangkan internal pattern catalog untuk organisasi.
12. Menyatukan seluruh seri menjadi mental model yang operasional.

---

## 2. Prinsip Utama: Pattern Mastery Bukan Hafalan

Design pattern sering diajarkan seperti ini:

```text
Masalah A → gunakan Pattern B
```

Contoh:

```text
Banyak if-else → gunakan Strategy
Butuh satu instance → gunakan Singleton
Butuh membuat object kompleks → gunakan Builder
Butuh menyembunyikan subsystem → gunakan Facade
```

Ini berguna untuk pemula, tetapi berbahaya untuk sistem nyata.

Di sistem nyata, masalah jarang sesederhana “banyak if-else”. Masalah sebenarnya mungkin:

```text
- rule berubah berdasarkan regulasi
- rule harus audit-friendly
- rule butuh explanation
- rule berlaku per effective date
- rule berbeda per agency
- rule harus testable tanpa database
- rule harus bisa direview BA/legal
- rule harus bisa ditelusuri saat dispute
```

Jika engineer hanya melihat “banyak if-else”, ia mungkin membuat Strategy. Tetapi jika force sebenarnya adalah **auditability + versioning + explainability**, Strategy saja tidak cukup. Desain yang lebih tepat mungkin gabungan:

```text
Policy Object
Specification
Rule Object
Decision Result
Effective-Dated Rule Set
Audit Event
Pattern Decision Record
```

Top engineer tidak bertanya:

```text
Pattern apa yang cocok dengan bentuk code sekarang?
```

Ia bertanya:

```text
Apa force yang membuat code ini berubah, rusak, sulit diuji, sulit diaudit, atau sulit dioperasikan?
```

---

## 3. Definisi Praktis Pattern Mastery

Pattern mastery adalah kemampuan untuk:

```text
1. Melihat struktur tersembunyi di balik requirement.
2. Mengenali force yang saling bertentangan.
3. Memilih abstraction dengan cost paling rasional.
4. Menolak abstraction yang belum punya alasan kuat.
5. Membuat desain yang punya migration path.
6. Membuat konsekuensi desain terlihat bagi tim.
7. Mengurangi entropy seiring sistem berevolusi.
```

Pattern mastery bukan berarti semua code memakai pattern.

Pattern mastery berarti setiap pattern yang dipakai punya alasan yang jelas.

---

## 4. Pattern sebagai Bahasa Komunikasi

Pattern memberi bahasa singkat:

```text
“Ini Gateway, bukan service biasa.”
“Ini Policy Object, bukan validation utility.”
“Ini Command Handler, bukan random method.”
“Ini Outbox, bukan publish event biasa.”
“Ini State Machine, bukan enum status.”
“Ini Anti-Corruption Layer, bukan mapper kosmetik.”
```

Bahasa ini penting karena sistem besar tidak bisa hanya dipahami dari class satu per satu. Sistem besar dipahami melalui **struktur hubungan**.

Namun bahasa pattern bisa menjadi racun jika dipakai untuk menutupi desain buruk.

Contoh:

```text
Kita punya Clean Architecture.
```

Tetapi:

```text
- domain bergantung pada Spring annotation
- use case memanggil repository milik modul lain
- entity JPA keluar ke API response
- service layer saling memanggil tanpa boundary
- transaction boundary tidak jelas
```

Nama arsitektur tidak berarti apa-apa jika dependency rule dilanggar.

Pattern name bukan bukti desain benar.

Pattern name adalah **hipotesis desain** yang harus diuji terhadap force, invariant, dan consequence.

---

## 5. Mental Model Utama: Force → Decision → Consequence

Setiap keputusan desain harus dibaca dengan model ini:

```text
FORCE
  ↓
DECISION
  ↓
CONSEQUENCE
  ↓
FEEDBACK
  ↓
EVOLUTION
```

### 5.1 Force

Force adalah tekanan yang membuat desain harus mengambil bentuk tertentu.

Contoh force:

```text
- requirement sering berubah
- domain rule harus dapat diaudit
- latency harus rendah
- request volume tinggi
- third-party API tidak stabil
- database schema legacy
- consistency harus kuat
- service dependency sering gagal
- tim besar mengerjakan modul paralel
- onboarding developer lambat
- security boundary ketat
- regulasi berubah per tanggal efektif
```

### 5.2 Decision

Decision adalah pilihan desain.

Contoh:

```text
- gunakan Gateway untuk external API
- gunakan Policy Object untuk authorization
- gunakan State Machine untuk lifecycle
- gunakan Outbox untuk publish event
- gunakan sealed hierarchy untuk closed domain alternatives
- gunakan transaction script untuk simple CRUD module
```

### 5.3 Consequence

Consequence adalah efek setelah keputusan dibuat.

Contoh:

```text
Gateway:
+ external API tidak bocor ke domain
+ error bisa dinormalisasi
+ testing lebih mudah
- perlu mapping tambahan
- perlu maintain kontrak boundary

State Machine:
+ transition eksplisit
+ illegal transition bisa dicegah
+ audit lebih kuat
- lebih banyak struktur
- butuh discipline saat menambah state

Outbox:
+ menghindari dual-write inconsistency
+ event bisa retry
- perlu publisher worker
- perlu monitoring outbox lag
```

Pattern tanpa consequence adalah dekorasi.

---

## 6. Mental Model Kedua: Cost of Abstraction

Abstraction tidak gratis.

Setiap abstraction menambah:

```text
- jumlah konsep yang harus dipahami
- jumlah file/class/interface
- indirection saat debugging
- risiko naming buruk
- risiko overgeneralization
- risiko test terlalu mock-heavy
- risiko runtime overhead
- risiko dependency graph membesar
```

Tetapi tidak ada abstraction juga tidak gratis.

Tanpa abstraction, sistem bisa membayar biaya lain:

```text
- duplication
- scattered logic
- hidden coupling
- inconsistent behavior
- sulit audit
- sulit test
- sulit refactor
- high blast radius
- repeated bug
- requirement kecil menjadi perubahan besar
```

Top engineer tidak anti-abstraction dan tidak pro-abstraction. Ia menghitung **cost vs avoided risk**.

### 6.1 Formula Praktis

```text
Abstraction layak jika:

cost(abstraction) < cost(change_without_abstraction) + cost(failure_without_abstraction)
```

Jika perubahan belum jelas dan failure cost rendah, abstraction mungkin belum layak.

Jika perubahan sangat mungkin atau failure cost tinggi, abstraction mungkin wajib meskipun baru ada satu implementasi.

---

## 7. Single Implementation Tidak Selalu Berarti Overengineering

Nasihat umum:

```text
Jangan buat interface kalau hanya ada satu implementasi.
```

Sering benar. Tapi tidak selalu.

Interface atau port tetap layak meski implementasinya satu jika alasan utamanya adalah **boundary**, bukan polymorphism.

Contoh interface yang layak meski satu implementasi:

```java
public interface AddressValidationGateway {
    AddressValidationResult validate(AddressValidationRequest request);
}
```

Meski implementasinya hanya:

```java
public final class OneMapAddressValidationGateway implements AddressValidationGateway {
    // external HTTP client, retry, timeout, token, error translation
}
```

Interface ini bukan dibuat karena ada banyak provider. Interface ini dibuat karena domain/use case tidak boleh tahu:

```text
- HTTP endpoint
- token model
- vendor error code
- retry mechanism
- JSON schema eksternal
- timeout detail
```

Interface sebagai boundary berbeda dengan interface sebagai polymorphic abstraction.

### 7.1 Rule of Thumb

Interface dengan satu implementasi layak jika ia melindungi:

```text
- domain dari framework
- domain dari external system
- application service dari persistence detail
- core policy dari vendor detail
- test dari slow infrastructure
- modul dari modul lain
```

Interface dengan satu implementasi cenderung overengineering jika ia hanya menambah nama tanpa memutus dependency.

---

## 8. Boring Code vs Clever Code

Top engineer sering memilih boring code.

Boring code bukan code malas. Boring code adalah code yang:

```text
- jelas maksudnya
- mudah di-debug
- mudah dites
- tidak mengejutkan
- tidak menyembunyikan side effect
- tidak membuat developer baru harus memahami framework magic dulu
```

Clever code sering tampak elegan di demo, tetapi rapuh di maintenance.

Contoh clever code yang berbahaya:

```java
Map<String, Function<Request, Response>> handlers = Map.of(
    "A", this::handleA,
    "B", this::handleB,
    "C", this::handleC
);
```

Ini bisa bagus jika routing sederhana. Tetapi jika tiap handler memiliki:

```text
- authorization berbeda
- validation berbeda
- transaction boundary berbeda
- audit berbeda
- retry berbeda
- error semantic berbeda
```

Map of function akan menjadi abstraction yang terlalu dangkal.

Lebih baik explicit command handler dengan contract jelas.

### 8.1 Boring Code yang Benar

```java
public SubmitDecisionResult submit(SubmitDecisionCommand command) {
    AccessContext access = accessContextProvider.current();

    CaseRecord caseRecord = caseRepository.getForUpdate(command.caseId());

    authorizationPolicy.assertCanSubmitDecision(access, caseRecord);
    decisionPolicy.evaluate(command, caseRecord).throwIfRejected();

    CaseRecord updated = stateMachine.transition(
        caseRecord,
        CaseAction.SUBMIT_DECISION,
        TransitionContext.from(command, access)
    );

    caseRepository.save(updated);
    auditTrail.record(AuditEvent.decisionSubmitted(updated.id(), access.actorId()));

    return SubmitDecisionResult.success(updated.id(), updated.status());
}
```

Ini bukan “fancy”. Tapi force-nya terlihat:

```text
- authorization sebelum mutation
- lock/transaction boundary eksplisit
- policy terpisah
- transition eksplisit
- audit eksplisit
- result eksplisit
```

Boring code yang memperlihatkan invariant lebih bernilai daripada clever code yang menyembunyikan invariant.

---

## 9. Essential Complexity vs Accidental Complexity

### 9.1 Essential Complexity

Essential complexity berasal dari domain.

Contoh:

```text
- case punya banyak status dan illegal transition
- approval rule berbeda per license type
- effective date rule berubah karena regulasi
- sanction calculation butuh historical facts
- appeal bisa membuka ulang decision tertentu
- user visibility tergantung role, agency, team, case assignment
```

Complexity ini tidak bisa dihapus. Ia harus dimodelkan.

### 9.2 Accidental Complexity

Accidental complexity berasal dari keputusan teknis atau struktur buruk.

Contoh:

```text
- status disimpan sebagai string tanpa transition model
- authorization tersebar di controller/service/repository
- external API response dipakai langsung sebagai domain object
- DTO dipakai sebagai entity, command, event sekaligus
- service saling memanggil membentuk maze
- transaction boundary tidak jelas
- error berupa string parsing
```

Pattern yang tepat tidak menghapus essential complexity. Pattern yang tepat mengubah essential complexity menjadi struktur yang bisa dipahami, diuji, dan dievolusi.

### 9.3 Diagnosis

Tanyakan:

```text
Apakah kompleksitas ini berasal dari domain, atau dari cara kita menulis code?
```

Jika dari domain, modelkan.

Jika dari code, refactor.

---

## 10. Pattern Entropy

Sistem cenderung mengalami entropy.

Awalnya:

```text
Gateway jelas.
Policy jelas.
Command handler jelas.
State machine jelas.
DTO boundary jelas.
```

Setelah 12 bulan:

```text
- ada business logic di gateway
- policy memanggil repository
- command handler terlalu besar
- state transition bypassed oleh batch job
- DTO mulai dipakai sebagai domain object
- event listener melakukan mutation besar
- audit event tidak konsisten
```

Pattern entropy adalah proses ketika pattern tetap ada namanya, tetapi invariant-nya hilang.

### 10.1 Contoh Pattern Entropy

#### Gateway yang Membusuk

Awalnya:

```text
Gateway = external system boundary
```

Membusuk menjadi:

```text
Gateway = HTTP client + business validation + domain decision + persistence update
```

#### Policy yang Membusuk

Awalnya:

```text
Policy = pure decision logic
```

Membusuk menjadi:

```text
Policy = decision + DB query + external call + audit + exception translation
```

#### State Machine yang Membusuk

Awalnya:

```text
Semua transition lewat state machine
```

Membusuk menjadi:

```text
Beberapa service langsung set status karena urgent fix
```

Pattern mastery berarti menjaga invariant pattern tetap hidup.

---

## 11. Pattern Invariant

Setiap pattern harus punya invariant.

Tanpa invariant, pattern hanya nama.

### 11.1 Contoh Invariant

#### Gateway

```text
Gateway invariant:
- hanya boundary ke external system
- tidak membuat domain decision
- menerjemahkan request/response/error
- menyembunyikan protocol/vendor detail
```

#### Policy Object

```text
Policy invariant:
- mengevaluasi keputusan domain/security
- tidak melakukan side effect
- menghasilkan decision/reason yang eksplisit
- mudah dites tanpa infrastructure
```

#### Command Handler

```text
Command Handler invariant:
- mengorkestrasi satu use case
- menentukan transaction boundary
- memanggil policy/domain/gateway/repository seperlunya
- tidak menjadi dumping ground semua logic
```

#### Repository

```text
Repository invariant:
- merepresentasikan boundary persistence untuk aggregate/model tertentu
- tidak mengekspos detail ORM/query internal secara liar
- tidak menjadi tempat semua query random
```

#### Outbox

```text
Outbox invariant:
- event ditulis dalam transaction yang sama dengan state change
- publisher terpisah boleh retry
- consumer harus idempotent
- event memiliki identity dan traceability
```

### 11.2 Design Review Question

Saat review, jangan hanya bertanya:

```text
Apakah ini memakai pattern X?
```

Tanyakan:

```text
Invariant pattern X apa yang harus dijaga?
Apakah code ini menjaga invariant itu?
```

---

## 12. Design Taste

Design taste adalah intuisi yang dibentuk oleh pengalaman, tetapi dapat dibuat eksplisit.

Taste yang baik cenderung memilih desain yang:

```text
- explicit over implicit
- local reasoning over global reasoning
- stable boundary over scattered dependency
- clear invariant over clever flexibility
- testable decision over hidden side effect
- operational visibility over silent magic
- evolution path over perfect initial abstraction
```

Taste buruk sering muncul sebagai:

```text
- semua dibuat generic
- semua dibuat reusable sebelum ada kebutuhan nyata
- semua dibuat framework-driven
- semua dibuat annotation-driven
- semua dibuat asynchronous
- semua dibuat microservice
- semua dibuat event-driven
- semua dibuat fluent API
- semua dibuat interface
```

Kata “semua” biasanya smell.

---

## 13. Senior-Level Pattern Question

Pemula bertanya:

```text
Bagaimana implementasi Strategy Pattern?
```

Engineer menengah bertanya:

```text
Kapan Strategy lebih baik daripada switch?
```

Senior engineer bertanya:

```text
Apa axis perubahan behavior ini?
Apakah variasi behavior dimiliki domain atau konfigurasi?
Apakah variasi butuh audit/explanation?
Apakah selection runtime atau compile-time?
Apakah jumlah variasi stabil?
Apakah rule perlu effective dating?
Apakah behavior ini harus bisa dites terpisah?
Apakah abstraction cost lebih kecil dari change cost?
```

Staff-level engineer bertanya:

```text
Bagaimana membuat tim lain bisa menambah variasi tanpa merusak invariant?
Bagaimana memastikan rule baru tidak diam-diam mengubah rule lama?
Bagaimana desain ini dimonitor saat production behavior berbeda dari ekspektasi?
Bagaimana keputusan ini dicatat agar bisa dipahami 2 tahun lagi?
```

---

## 14. Designing for Change Without Predicting the Future

Salah satu kesalahan besar adalah mencoba memprediksi semua masa depan.

Contoh:

```text
Nanti mungkin ada 10 provider external.
Nanti mungkin semua rule configurable.
Nanti mungkin dipakai banyak tenant.
Nanti mungkin service dipisah microservice.
```

Jika semua “mungkin” dijadikan abstraction sekarang, sistem menjadi berat sebelum waktunya.

Tetapi menolak semua kemungkinan juga salah.

Top engineer tidak memprediksi masa depan secara detail. Ia mengidentifikasi **axis perubahan yang paling mungkin dan paling mahal jika salah**.

### 14.1 Axis of Change

Tanyakan:

```text
Apa yang paling mungkin berubah?
```

Contoh:

```text
- vendor API
- regulatory rule
- UI representation
- persistence schema
- authorization matrix
- workflow state
- message transport
- report filter
```

Lalu tanyakan:

```text
Jika berubah, bagian code mana yang akan tersentuh?
Berapa banyak file?
Berapa banyak test?
Berapa banyak deployment?
Berapa besar risiko regression?
```

Jika jawabannya besar, boundary layak dibuat.

### 14.2 Design for Replaceability, Not Infinite Flexibility

Replaceability berbeda dengan flexibility.

Flexibility sering berarti:

```text
Bisa melakukan banyak hal dengan konfigurasi/generic abstraction.
```

Replaceability berarti:

```text
Detail bisa diganti karena dependency boundary jelas.
```

Contoh:

```java
public interface CaseNumberGenerator {
    CaseNumber next(CaseType type, LocalDate date);
}
```

Ini bukan overgeneralized framework. Ini replaceable boundary.

---

## 15. Evolutionary Architecture

Architecture tidak selesai saat diagram dibuat.

Architecture hidup melalui:

```text
- perubahan requirement
- bug production
- performance incident
- migration
- team turnover
- audit finding
- security patch
- framework upgrade
- database growth
- integration change
```

Karena itu, architecture harus punya feedback loop.

Evolutionary architecture menekankan perubahan kecil, feedback loop, dan fitness function. Dalam praktik Java enterprise, ini berarti architecture bukan hanya folder structure, tetapi juga test, lint rule, module boundary, contract test, observability, dan ADR yang menjaga decision tetap visible.

### 15.1 Architecture Fitness Function

Fitness function adalah mekanisme untuk memeriksa apakah architecture masih memenuhi constraint.

Contoh fitness function:

```text
- domain package tidak boleh bergantung pada Spring Web
- API module tidak boleh mengekspos JPA entity
- service A tidak boleh query table milik module B
- semua external call harus melewati Gateway
- semua state transition harus melewati StateMachine
- semua mutation penting harus menghasilkan AuditEvent
- semua integration event harus lewat Outbox
- semua public endpoint harus punya authorization policy test
```

Fitness function bisa berupa:

```text
- unit test arsitektur
- ArchUnit test
- static analysis
- dependency check
- build rule
- code review checklist
- runtime metric
- production dashboard
- audit reconciliation query
```

### 15.2 Contoh ArchUnit-Style Rule

```java
// Pseudo-example
classes()
    .that().resideInAPackage("..domain..")
    .should().onlyDependOnClassesThat()
    .resideInAnyPackage(
        "java..",
        "com.example.shared.domain..",
        "com.example.case.domain.."
    );
```

Tujuannya bukan membuat build “galak”. Tujuannya menjaga decision agar tidak membusuk diam-diam.

---

## 16. Design Debt vs Technical Debt

Technical debt sering dipahami sebagai code kotor.

Design debt lebih halus:

```text
Desain masih bekerja, tetapi semakin mahal untuk berubah karena boundary, invariant, atau ownership salah.
```

Contoh design debt:

```text
- service layer tahu semua modul
- authorization tidak punya central policy model
- status lifecycle tidak punya transition model
- event payload tidak versioned
- repository mengembalikan JPA entity ke API layer
- integration call dilakukan di tengah transaction
- audit trail hanya string log tanpa semantic event
```

Design debt lebih berbahaya karena tidak selalu terlihat sebagai bug.

Ia muncul saat:

```text
- feature kecil butuh perubahan di 20 file
- bug fix memicu regression di modul lain
- developer takut menyentuh code tertentu
- QA harus regression besar untuk perubahan kecil
- audit tidak bisa menjelaskan kenapa sistem mengambil keputusan
```

---

## 17. Pattern Decision Record

Karena design decision mudah hilang, top engineer mencatat keputusan penting.

Pattern Decision Record adalah versi lebih kecil dari ADR yang fokus pada pattern-level decision.

### 17.1 Template

```markdown
# PDR-0001: Use State Machine for Case Lifecycle

## Status
Accepted

## Context
Case lifecycle has many states, illegal transitions, role-specific actions,
audit requirements, and deadline-based behavior. Current implementation uses
scattered status assignment in multiple services.

## Forces
- Transitions must be explicit.
- Illegal transitions must be rejected consistently.
- Audit must show actor, action, source state, target state, and reason.
- UI needs available actions per state.
- Batch and user-triggered transitions must follow same rules.

## Decision
Introduce a centralized CaseStateMachine component.
All status changes must go through transition(action, context).
Direct setStatus outside persistence reconstruction is forbidden.

## Consequences
Positive:
- Transition logic becomes explicit and testable.
- Audit becomes consistent.
- UI can derive available actions.

Negative:
- More upfront structure.
- Existing services need migration.
- State machine must be versioned when lifecycle changes.

## Alternatives Considered
1. Keep enum status and scattered if-else.
2. Use external BPMN engine.
3. Use table-driven transition model.

## Enforcement
- Unit tests for transition matrix.
- Code review check: no direct status mutation.
- Optional static rule for setStatus usage.

## Review Date
After next major lifecycle CR.
```

### 17.2 Kenapa PDR Penting

Tanpa PDR, tim baru hanya melihat code. Mereka tidak tahu:

```text
- kenapa pattern dipilih
- alternatif apa yang ditolak
- constraint apa yang penting
- invariant apa yang harus dijaga
- kapan decision perlu direview
```

Dokumentasi yang baik bukan dokumentasi panjang. Dokumentasi yang baik adalah dokumentasi yang menjaga konteks keputusan tetap hidup.

---

## 18. Architecture Decision Record vs Pattern Decision Record

ADR biasanya lebih luas:

```text
- memilih modular monolith vs microservice
- memilih database per service
- memilih Kafka vs RabbitMQ
- memilih framework runtime
- memilih authentication strategy
```

PDR lebih dekat ke code design:

```text
- gunakan State Machine untuk lifecycle
- gunakan Policy Object untuk authorization
- gunakan Gateway untuk external API
- gunakan Outbox untuk integration event
- gunakan Result type untuk domain validation
- gunakan sealed hierarchy untuk decision outcome
```

Keduanya saling melengkapi.

---

## 19. Internal Pattern Catalog

Organisasi yang matang memiliki pattern catalog internal.

Bukan katalog umum seperti:

```text
Strategy
Factory
Observer
```

Tetapi katalog berbasis konteks organisasi:

```text
- How we model lifecycle transitions
- How we call external government APIs
- How we publish integration events
- How we model authorization decisions
- How we represent audit events
- How we expose case detail APIs
- How we handle idempotent commands
- How we design batch correction jobs
- How we version regulatory rules
```

### 19.1 Struktur Internal Pattern Catalog

```markdown
# Pattern: Authorization Policy Object

## Use When
- Decision depends on actor/action/resource/context.
- Decision must be tested independently.
- Decision reason must be auditable.

## Do Not Use When
- Only coarse endpoint-level authentication is needed.
- Rule is temporary and isolated.

## Standard Shape
- AccessContext
- ResourceSnapshot
- AuthorizationPolicy
- AuthorizationDecision
- DenialReason

## Required Tests
- allowed path
- denied role
- denied ownership
- denied state
- denied cross-agency

## Observability
- denied reason code
- actor id hash
- resource type/id
- correlation id

## Anti-Patterns
- role check in controller
- role check in frontend only
- authorization after mutation
- string-based reason without taxonomy
```

Catalog seperti ini mempercepat tim karena engineer tidak mulai dari nol setiap kali.

---

## 20. Pattern Governance Tanpa Bureaucracy

Governance buruk:

```text
Semua design harus pakai template panjang dan approval banyak orang.
```

Governance baik:

```text
Keputusan penting dicatat cukup singkat, invariant dijaga otomatis, review fokus pada risk.
```

### 20.1 Kapan Butuh PDR/ADR?

Butuh jika keputusan:

```text
- sulit dibalik
- memengaruhi banyak modul
- punya security/compliance impact
- punya operational impact
- menciptakan abstraction baru
- menetapkan boundary baru
- mengubah dependency direction
- menjadi precedent untuk tim lain
```

Tidak perlu jika:

```text
- perubahan lokal kecil
- refactoring jelas tanpa trade-off besar
- implementation detail mudah diganti
```

---

## 21. Code Review at Pattern Level

Code review biasa sering fokus pada:

```text
- naming
- formatting
- null check
- unit test
- bug lokal
```

Pattern-level review bertanya:

```text
1. Apa responsibility utama class ini?
2. Apa boundary yang sedang dijaga?
3. Apakah dependency direction benar?
4. Apakah invariant domain terlihat?
5. Apakah error semantics jelas?
6. Apakah side effect jelas?
7. Apakah transaction boundary jelas?
8. Apakah authorization sebelum mutation?
9. Apakah external model bocor ke domain?
10. Apakah pattern yang dipakai punya invariant yang dijaga?
11. Apakah abstraction ini punya force yang nyata?
12. Apakah desain ini bisa diuji tanpa infrastructure berat?
13. Apakah observability cukup saat production gagal?
```

### 21.1 Contoh Review Comment Lemah

```text
Maybe use Strategy Pattern here.
```

Masalah: terlalu umum.

### 21.2 Contoh Review Comment Kuat

```text
Rule approval sekarang bercampur dengan orchestration submit.
Karena rule ini berubah per license type dan perlu denial reason untuk audit,
lebih aman diekstrak sebagai Policy/Rule Object yang mengembalikan Decision,
bukan langsung throw exception. Ini juga akan membuat test rule tidak perlu setup transaction/database.
```

Review comment kuat menyebut:

```text
- masalah desain
- force
- pattern yang disarankan
- alasan
- consequence
```

---

## 22. Architecture Review at Force Level

Architecture review bukan hanya melihat diagram.

Tanyakan:

```text
1. Apa force utama sistem?
2. Force mana yang paling mahal jika salah?
3. Boundary mana yang melindungi force itu?
4. Apa failure mode utama?
5. Apa data consistency assumption?
6. Apa latency assumption?
7. Apa ownership assumption?
8. Apa security assumption?
9. Apa operational assumption?
10. Bagaimana assumption ini divalidasi?
```

### 22.1 Contoh

Proposal:

```text
Pisahkan module approval menjadi microservice.
```

Review force-level:

```text
- Apakah approval punya data ownership yang jelas?
- Apakah module lain butuh join langsung ke approval data?
- Apakah consistency approval harus atomic dengan case update?
- Apakah user journey toleran eventual consistency?
- Apakah tim punya operational maturity untuk service baru?
- Apakah distributed tracing sudah siap?
- Apakah deployment dan rollback sudah terpisah?
- Apakah security token propagation jelas?
- Apakah data migration feasible?
```

Jika jawaban mayoritas belum jelas, microservice bisa menjadi distributed monolith.

---

## 23. Knowing When Boring Code Is Better

Boring code lebih baik ketika:

```text
- variasi behavior belum nyata
- requirement stabil
- failure cost rendah
- code lokal dan mudah dipahami
- abstraction akan menambah indirection tanpa mengurangi risk
- tim belum punya shared vocabulary untuk pattern tersebut
```

Contoh:

```java
public BigDecimal calculateFee(ApplicationType type) {
    return switch (type) {
        case INDIVIDUAL -> BigDecimal.valueOf(50);
        case COMPANY -> BigDecimal.valueOf(100);
    };
}
```

Ini mungkin cukup.

Jangan langsung membuat:

```text
FeeCalculationStrategy
FeeCalculationStrategyFactory
FeeCalculationStrategyRegistry
AbstractFeeCalculationStrategy
DefaultFeeCalculationStrategyProvider
```

Jika fee rule stabil dan sederhana, switch expression lebih jujur.

### 23.1 Kapan Switch Mulai Menjadi Smell

Switch mulai smell jika:

```text
- muncul di banyak tempat
- tiap branch panjang
- tiap branch punya dependency berbeda
- branch berubah sering
- branch perlu audit/explanation
- branch perlu authorization berbeda
- branch perlu transaction/failure handling berbeda
- branch perlu plugin/extension oleh tim lain
```

Barulah Strategy/Policy/State/Visitor dipertimbangkan.

---

## 24. Knowing When Abstraction Is Required

Abstraction wajib dibuat lebih awal ketika:

```text
- boundary melewati trust boundary
- external system tidak stabil
- domain rule punya audit/legal impact
- state transition punya illegal path
- security decision tersebar
- side effect harus reliable
- failure bisa menyebabkan data corruption
- data model internal tidak boleh bocor
- tim berbeda memiliki ownership berbeda
```

Contoh yang hampir selalu layak diberi boundary:

```text
- external API Gateway
- authorization policy
- audit event model
- state transition model
- integration event/outbox
- persistence repository per aggregate/module
- domain primitive untuk sensitive identifier
```

---

## 25. The “One More If” Trap

Banyak sistem buruk tidak dimulai buruk.

Ia dimulai dari:

```text
Tambahkan satu if saja.
```

Lalu:

```text
Tambahkan satu special case.
Tambahkan satu role exception.
Tambahkan satu status baru.
Tambahkan satu license type baru.
Tambahkan satu external provider baru.
Tambahkan satu retry di sini.
Tambahkan satu audit log di sana.
```

Pada titik tertentu, code kehilangan bentuk.

### 25.1 Refactoring Trigger

Jangan refactor pada if pertama.

Refactor ketika terlihat salah satu sinyal:

```text
- if yang sama muncul di 3 tempat
- branch punya alasan perubahan berbeda
- branch membutuhkan test matrix yang membesar
- bug terjadi karena branch lupa diupdate
- branch baru butuh menyentuh code lama yang tidak terkait
- branch punya side effect berbeda
- branch perlu decision reason/audit
```

### 25.2 Pattern Response

```text
Branch by type simple              → switch expression / sealed hierarchy
Branch by algorithm                → Strategy
Branch by eligibility rule         → Specification / Policy
Branch by lifecycle state          → State Machine
Branch by operation intent         → Command Handler
Branch by output operation on tree → Visitor / pattern matching
Branch by external provider        → Gateway / Adapter / Abstract Factory
```

---

## 26. The “Generic Everything” Trap

Generic design sering tampak sophisticated.

Contoh:

```java
public interface Processor<I, O, C> {
    O process(I input, C context);
}
```

Masalahnya: nama generic sering menghapus makna domain.

Bandingkan:

```java
public interface EligibilityPolicy {
    EligibilityDecision evaluate(Application application, AccessContext context);
}
```

Yang kedua lebih sempit, tetapi lebih bermakna.

### 26.1 Generic Layak Jika

Generic abstraction layak jika:

```text
- benar-benar ada common lifecycle
- contract dapat dijelaskan tanpa domain tertentu
- caller mendapat manfaat dari uniform treatment
- type parameter tidak menyembunyikan semantic penting
- error model jelas
- observability masih meaningful
```

Generic abstraction buruk jika:

```text
- semua implementasi berbeda total
- caller harus tahu detail subtype
- banyak instanceof/check di dalam generic layer
- nama method terlalu umum
- domain term hilang
```

---

## 27. The “Framework Will Save Us” Trap

Framework memberi banyak pattern built-in:

```text
- Dependency Injection
- AOP
- annotation processing
- transaction management
- validation
- repository abstraction
- HTTP mapping
- messaging listener
```

Tetapi framework tidak menentukan desain domain yang benar.

Framework bisa membuat code terlihat rapi meski desainnya buruk.

Contoh:

```java
@Service
@Transactional
public class CaseService {
    // 2000 lines of everything
}
```

Annotation tidak menghapus God Service.

```java
@Repository
public interface CaseRepository extends JpaRepository<CaseEntity, Long> {
    // 80 query methods used by 10 modules
}
```

Repository annotation tidak menjamin repository boundary sehat.

```java
@EventListener
public void onApproved(CaseApprovedEvent event) {
    // mutates many modules synchronously
}
```

Event annotation tidak menjamin event design sehat.

### 27.1 Framework as Detail

Framework seharusnya mempercepat implementation, bukan mengambil alih model.

Prinsip:

```text
Domain should not need framework vocabulary to be understood.
```

Jika domain object hanya bisa dimengerti setelah memahami Spring/JPA/Jackson annotation, boundary mulai bocor.

---

## 28. Pattern Compatibility

Pattern jarang berdiri sendiri.

Contoh use case submit application:

```text
Command Object
Command Handler
Application Service
Authorization Policy
Specification Rule
State Machine
Repository
Gateway
Outbox
Audit Event
Problem Details
Structured Logging
```

Top engineer melihat komposisi pattern.

### 28.1 Komposisi Sehat

```text
Controller
  → maps HTTP DTO to Command
  → calls Command Handler

Command Handler
  → starts transaction
  → loads aggregate via Repository
  → evaluates Policy/Specification
  → transitions State Machine
  → saves aggregate
  → writes Audit Event
  → writes Outbox Event

Outbox Publisher
  → publishes Integration Event
  → retries safely

Consumer
  → uses Inbox/Dedup
  → applies idempotent side effect
```

### 28.2 Komposisi Buruk

```text
Controller
  → validates business rule
  → checks role
  → loads JPA entity
  → mutates status
  → calls external API
  → publishes message
  → writes log string
  → returns entity as JSON
```

Komposisi buruk sering bekerja di awal, tetapi sulit dipertahankan.

---

## 29. Pattern Conflict

Pattern bisa bertabrakan.

### 29.1 Strategy vs Switch Expression

Strategy memberi extensibility.
Switch memberi locality.

Jika variasi sedikit dan stabil, switch menang.
Jika variasi besar dan berubah independen, Strategy menang.

### 29.2 Domain Model vs Transaction Script

Rich domain model memberi invariant kuat.
Transaction Script memberi kesederhanaan.

Jika domain rule kompleks, rich model menang.
Jika operasi CRUD sederhana, transaction script menang.

### 29.3 Event-Driven vs Synchronous Call

Event-driven memberi decoupling dan resilience.
Synchronous call memberi immediate consistency dan straightforward reasoning.

Jika user perlu hasil langsung, sync mungkin benar.
Jika side effect bisa eventual, event lebih baik.

### 29.4 Microservice vs Modular Monolith

Microservice memberi independent deployment dan scaling.
Modular monolith memberi simpler consistency dan lower operational overhead.

Jika boundary belum matang, modular monolith sering lebih benar.

---

## 30. Design Smell Taxonomy

Top engineer memiliki radar smell.

### 30.1 Naming Smell

```text
Manager
Helper
Util
Processor
Handler
Service
Common
Generic
Base
Abstract
```

Nama ini bukan selalu salah, tetapi sering menandakan responsibility belum jelas.

### 30.2 Boundary Smell

```text
- API DTO dipakai di domain
- JPA entity dipakai di controller
- external response dipakai di service internal
- repository dipanggil dari policy
- domain object punya framework annotation berlebihan
```

### 30.3 Dependency Smell

```text
- cyclic package dependency
- service A call service B call service C call service A
- utility global dipakai semua modul
- static context menyimpan request state
```

### 30.4 Error Smell

```text
- throws Exception
- catch Throwable
- return null untuk error
- parse string error message
- HTTP status dipakai sebagai domain decision
```

### 30.5 Concurrency Smell

```text
- shared mutable state tanpa owner
- Executor tanpa bound
- CompletableFuture tanpa timeout
- interrupt diabaikan
- ThreadLocal tidak dibersihkan
```

### 30.6 Integration Smell

```text
- update DB lalu publish event tanpa outbox
- retry non-idempotent operation
- external call dalam DB transaction panjang
- consumer tidak dedup
```

### 30.7 Observability Smell

```text
- log tanpa correlation id
- audit hanya string
- metric tanpa label penting
- exception swallowed
- fallback diam-diam mengembalikan data palsu
```

---

## 31. Pattern Review Checklist

Gunakan checklist ini saat memilih pattern.

### 31.1 Problem Clarity

```text
[ ] Apa masalah desain nyata?
[ ] Apa force utama?
[ ] Apa failure mode jika tidak diubah?
[ ] Apakah masalah terjadi sekali atau berulang?
[ ] Apakah ini essential complexity atau accidental complexity?
```

### 31.2 Pattern Fit

```text
[ ] Pattern ini menyelesaikan force utama?
[ ] Pattern ini menjaga invariant apa?
[ ] Apakah pattern ini terlalu besar untuk masalahnya?
[ ] Apakah ada solusi lebih sederhana?
[ ] Apakah pattern ini familiar untuk tim?
```

### 31.3 Consequence

```text
[ ] Class/interface bertambah berapa?
[ ] Debug path bertambah berapa layer?
[ ] Test apa yang perlu ditambah?
[ ] Observability apa yang perlu dibuat?
[ ] Apa risiko misuse pattern ini?
```

### 31.4 Evolution

```text
[ ] Bagaimana jika requirement berubah?
[ ] Bagaimana jika variasi baru ditambah?
[ ] Bagaimana jika pattern ini perlu dihapus?
[ ] Bagaimana migration path dari code lama?
[ ] Kapan decision perlu direview?
```

---

## 32. Top 1% Pattern Decision Matrix

Gunakan matrix sederhana ini.

| Force | Smell Saat Ini | Pattern Kandidat | Jangan Pakai Jika |
|---|---|---|---|
| Banyak algorithm berubah | if-else besar | Strategy | variasi sedikit dan stabil |
| Rule butuh explanation | boolean validation | Policy / Rule Object | rule trivial |
| Lifecycle kompleks | status enum liar | State Machine | hanya 2 state sederhana |
| External API bocor | DTO vendor di domain | Gateway / ACL | wrapper hanya pass-through tanpa semantic translation |
| Side effect reliable | dual write | Outbox | event tidak penting/retry tidak dibutuhkan |
| Authorization tersebar | role check di mana-mana | Policy Object | hanya endpoint coarse auth |
| Tree structure | recursive if | Composite / Visitor | struktur flat |
| Closed alternatives | instanceof chain | sealed + switch / Visitor | subtype terus ditambah oleh pihak luar |
| Object construction kompleks | constructor telescoping | Builder | object sederhana |
| API compatibility | overload kacau | Options object / versioning | API internal sementara |
| Cross-cutting concern | duplicated logging/retry | Decorator/Interceptor | ordering tidak jelas |
| Persistence boundary bocor | entity keluar layer | Repository/Mapper | CRUD kecil tanpa domain boundary |
| Distributed consistency | sync chain panjang | Saga / Async Event | immediate consistency wajib |
| Complexity module besar | service maze | Modular boundary | ownership tidak jelas |

---

## 33. Staff-Level Design Questions

Saat kamu memimpin design discussion, gunakan pertanyaan ini.

### 33.1 Responsibility

```text
Siapa pemilik keputusan ini?
Siapa pemilik data ini?
Siapa pemilik side effect ini?
Siapa yang boleh mengubah state ini?
```

### 33.2 Boundary

```text
Boundary apa yang sedang dilindungi?
Apa yang tidak boleh bocor melewati boundary?
Apakah dependency direction sudah benar?
Apa public contract boundary ini?
```

### 33.3 Invariant

```text
Invariant apa yang harus selalu benar?
Di mana invariant ditegakkan?
Apa test yang membuktikan invariant?
Apa observability yang menunjukkan invariant dilanggar?
```

### 33.4 Failure

```text
Apa yang terjadi jika dependency gagal?
Apakah retry aman?
Apakah operation idempotent?
Apakah partial failure bisa dideteksi?
Apakah compensation bermakna secara domain?
```

### 33.5 Evolution

```text
Apa yang paling mungkin berubah?
Apa yang paling mahal jika berubah?
Apa migration path-nya?
Apa yang membuat keputusan ini perlu direview?
```

---

## 34. Pattern Communication

Top engineer tidak hanya membuat desain. Ia membuat desain bisa dipahami.

### 34.1 Cara Menjelaskan Pattern ke Tim

Buruk:

```text
Kita pakai Specification Pattern.
```

Baik:

```text
Rule eligibility sekarang tersebar di tiga service.
Karena rule ini akan berubah per license type dan harus menghasilkan denial reason,
kita pindahkan ke Specification/Policy Object.
Setiap rule akan pure, testable, dan mengembalikan Decision dengan reason code.
```

### 34.2 Cara Menjelaskan Trade-Off

```text
Kita menambah 4 class, tetapi menghapus rule duplication di 3 use case.
Debug path bertambah satu layer, tetapi rule bisa dites tanpa database.
Ini worth it karena rule berubah tiap CR dan denial reason harus audit-friendly.
```

Penjelasan seperti ini melatih tim berpikir force/consequence, bukan sekadar pattern name.

---

## 35. Mentoring Team Through Patterns

Pattern maturity tim bertahap.

### 35.1 Level 1 — Syntax Familiarity

Tim tahu bentuk pattern.

```text
- Strategy pakai interface
- Builder untuk object kompleks
- Observer untuk event
```

### 35.2 Level 2 — Intent Understanding

Tim tahu kenapa pattern ada.

```text
- Strategy mengisolasi variasi algorithm
- Builder mengontrol konstruksi object kompleks
- Observer memisahkan publisher dari subscriber
```

### 35.3 Level 3 — Force Recognition

Tim tahu kapan force muncul.

```text
- rule berubah independen
- construction punya invariant banyak
- side effect boleh asynchronous
```

### 35.4 Level 4 — Consequence Awareness

Tim tahu biaya pattern.

```text
- Strategy menambah indirection
- Builder bisa menyembunyikan invalid state jika validation lemah
- Observer bisa membuat side effect tersembunyi
```

### 35.5 Level 5 — Evolutionary Judgment

Tim tahu kapan pattern harus diubah, digabung, atau dihapus.

```text
- Strategy diganti switch karena variasi menyusut
- direct publish diganti Outbox karena reliability issue
- transaction script dipisah menjadi domain model karena rule membesar
```

---

## 36. Pattern Misuse Recovery

Kadang pattern sudah terlanjur salah.

### 36.1 Strategy Explosion

Gejala:

```text
- puluhan class kecil
- tiap class hanya 3 baris
- selection logic kompleks
- behavior sebenarnya stabil
```

Recovery:

```text
- group strategy yang sama
- ganti dengan switch/sealed type jika lebih jelas
- hapus factory/registry yang tidak memberi value
```

### 36.2 Generic Repository Abuse

Gejala:

```text
- repository terlalu generic
- domain query tidak jelas
- N+1 tersembunyi
- caller mengatur terlalu banyak persistence detail
```

Recovery:

```text
- buat repository spesifik aggregate/use case
- pisahkan read model query
- eksplisitkan fetch plan/pagination
```

### 36.3 Event Soup

Gejala:

```text
- terlalu banyak event kecil
- listener tidak jelas ownership-nya
- debugging alur sulit
- side effect tersembunyi
```

Recovery:

```text
- klasifikasikan domain vs integration event
- buat event catalog
- tambah correlation/causation id
- jadikan side effect penting sebagai explicit handler
- gunakan outbox/inbox untuk reliability
```

### 36.4 Clean Architecture Theater

Gejala:

```text
- banyak folder usecase/domain/adapter
- dependency rule dilanggar
- domain masih tahu framework
- use case hanya pass-through ke repository
```

Recovery:

```text
- enforce dependency rule
- hapus layer kosong
- pindahkan business decision ke domain/policy
- pisahkan real boundary dari naming kosmetik
```

---

## 37. Pattern Removal as Skill

Kadang keputusan terbaik adalah menghapus pattern.

### 37.1 Kapan Pattern Harus Dihapus

```text
- variasi tidak pernah muncul
- abstraction membuat bug lebih sering
- indirection menyulitkan debugging
- pattern tidak punya invariant yang dijaga
- tim tidak memahami pattern setelah waktu cukup
- pattern hanya membungkus pass-through logic
- cost maintenance lebih besar dari benefit
```

### 37.2 Contoh

Sebelum:

```java
interface FeeStrategy {
    Money calculate(FeeContext context);
}

final class IndividualFeeStrategy implements FeeStrategy { ... }
final class CompanyFeeStrategy implements FeeStrategy { ... }
final class CharityFeeStrategy implements FeeStrategy { ... }
```

Jika semua hanya return fixed fee dan tidak berubah selama bertahun-tahun:

```java
public Money calculateFee(ApplicationType type) {
    return switch (type) {
        case INDIVIDUAL -> Money.sgd(50);
        case COMPANY -> Money.sgd(100);
        case CHARITY -> Money.sgd(0);
    };
}
```

Menghapus abstraction juga refactoring.

---

## 38. Java 8–25: Pattern Taste Modern

Java modern mengubah taste.

### 38.1 Lambda Mengurangi Boilerplate Strategy

Java 8 membuat Strategy ringan:

```java
Predicate<Application> eligible = app -> app.status() == SUBMITTED;
```

Tetapi jangan gunakan lambda untuk rule besar yang butuh nama, audit, dan test explicit.

### 38.2 Records Mengurangi DTO Boilerplate

```java
public record SubmitApplicationRequest(
    String applicationId,
    String remarks
) {}
```

Tetapi record bukan alasan mencampur DTO dengan domain model.

### 38.3 Sealed Classes Mengubah Visitor Trade-Off

```java
public sealed interface DecisionResult
    permits Approved, Rejected, PendingReview {}
```

Closed hierarchy + switch bisa menggantikan Visitor dalam banyak kasus.

### 38.4 Pattern Matching Mengurangi instanceof Noise

Pattern matching membuat type branching lebih aman dan readable.

Tetapi jika behavior adalah milik subtype, polymorphism tetap lebih baik.

### 38.5 Virtual Threads Mengubah Concurrency Pattern

Virtual threads mengurangi kebutuhan callback-heavy asynchronous code untuk blocking IO workload.

Tetapi virtual threads tidak menghapus:

```text
- timeout
- cancellation
- rate limit
- backpressure
- idempotency
- external dependency failure
- database bottleneck
```

### 38.6 Structured Concurrency Mengubah Fan-Out Design

Structured concurrency membuat subtasks berada dalam scope yang jelas. Ini memperbaiki error handling, cancellation, dan observability untuk operasi fan-out/fan-in.

Mental model:

```text
Jika task parent selesai, child task tidak boleh hidup liar.
```

Ini menggeser taste dari fire-and-forget ke scoped concurrent operation.

### 38.7 Scoped Values Mengubah Context Propagation

Scoped values lebih cocok untuk immutable request context dalam structured concurrent code dibanding ThreadLocal yang mudah bocor.

Tetapi context tetap harus dibatasi. Jangan jadikan scoped value sebagai global dependency tersembunyi.

---

## 39. Case: Staff-Level Review of a Proposed Design

### 39.1 Proposal

```text
Untuk approval process, kita buat ApprovalProcessor generic.
Semua module bisa register ApprovalStep via annotation.
Processor akan scan semua step dan menjalankan berdasarkan order.
```

### 39.2 Junior Review

```text
Bagus, flexible dan reusable.
```

### 39.3 Senior Review

```text
Apa invariant approval?
Apakah step order harus audit-friendly?
Apakah step boleh side effect?
Apakah authorization dilakukan step mana?
Apa yang terjadi jika step gagal di tengah?
Apakah semua module punya lifecycle yang sama?
Apakah annotation scanning membuat dependency tersembunyi?
Bagaimana test approval flow per module?
Bagaimana production trace menunjukkan step mana gagal?
```

### 39.4 Better Design

Jika approval tiap module berbeda tetapi punya skeleton sama:

```text
- Command Handler per approval use case
- shared ApprovalWorkflow interface hanya untuk common lifecycle
- explicit Policy per module
- explicit StateMachine per aggregate
- explicit AuditEvent
- optional Template Method hanya jika skeleton benar-benar stabil
```

### 39.5 Decision

Generic annotation-driven processor ditolak jika force utamanya bukan extensibility lintas modul, melainkan auditability dan explicit lifecycle.

Top engineer tidak terpesona oleh “generic”. Ia mencari invariant.

---

## 40. Capstone: End-to-End Pattern Judgment Example

Requirement:

```text
Sistem harus memproses submission application.
Rule eligibility berbeda per application type.
Submission mengubah status.
Harus audit-friendly.
Harus publish event ke downstream.
External address validation API kadang gagal.
Authorization tergantung actor, agency, assignment, dan status case.
```

### 40.1 Force Identification

```text
Eligibility variation      → Policy / Specification
State transition           → State Machine
Auditability               → Audit Event Pattern
External dependency        → Gateway + Resilience
Reliable event publishing  → Outbox
Authorization complexity   → Authorization Policy
Use case boundary          → Command Handler
API boundary               → DTO/Mapper
Persistence boundary       → Repository
Error contract             → Problem Details / error taxonomy
Observability              → correlation + structured logs + metrics
```

### 40.2 Shape

```text
SubmitApplicationController
  → SubmitApplicationRequest DTO
  → SubmitApplicationCommand
  → SubmitApplicationHandler
      → AuthorizationPolicy
      → ApplicationRepository
      → AddressValidationGateway
      → EligibilityPolicy
      → ApplicationStateMachine
      → AuditTrail
      → OutboxRepository
  → SubmitApplicationResponse DTO
```

### 40.3 Why Not Simpler?

Bisa saja semua di controller/service.

Tetapi force-nya tinggi:

```text
- regulatory audit
- lifecycle correctness
- external dependency failure
- downstream integration reliability
- authorization complexity
```

Maka pattern cost layak.

### 40.4 Why Not More Generic?

Tidak perlu membuat:

```text
GenericWorkflowProcessor<TCommand, TEntity, TState, TEvent>
```

Karena force saat ini bukan reusable workflow framework. Force saat ini adalah correctness dan explicitness pada submission use case.

---

## 41. Final Mental Model

Simpan model ini:

```text
Pattern bukan tujuan.
Pattern adalah alat untuk mengendalikan perubahan, coupling, failure, dan complexity.
```

Atau lebih lengkap:

```text
1. Temukan force.
2. Temukan invariant.
3. Temukan boundary.
4. Pilih abstraction minimum yang menjaga invariant pada boundary itu.
5. Pahami consequence.
6. Buat test dan observability untuk menjaga decision.
7. Catat decision jika penting.
8. Review decision saat force berubah.
9. Hapus pattern jika cost-nya tidak lagi sepadan.
```

---

## 42. Top 1% Engineer Checklist

### 42.1 Sebelum Menulis Code

```text
[ ] Saya tahu problem desain yang sedang saya selesaikan.
[ ] Saya tahu force utama.
[ ] Saya tahu invariant yang harus dijaga.
[ ] Saya tahu boundary yang tidak boleh bocor.
[ ] Saya tahu failure mode utama.
[ ] Saya tahu apakah abstraction layak sekarang.
```

### 42.2 Saat Memilih Pattern

```text
[ ] Pattern dipilih karena force, bukan karena preferensi.
[ ] Ada alternatif lebih sederhana yang dipertimbangkan.
[ ] Consequence positif dan negatif jelas.
[ ] Pattern invariant bisa dijelaskan satu paragraf.
[ ] Pattern bisa dites.
[ ] Pattern bisa diobservasi saat production failure.
```

### 42.3 Saat Review Code

```text
[ ] Responsibility class jelas.
[ ] Dependency direction benar.
[ ] External model tidak bocor.
[ ] Error semantics jelas.
[ ] Transaction boundary jelas.
[ ] Authorization sebelum mutation.
[ ] Side effect eksplisit.
[ ] Audit/telemetry cukup.
```

### 42.4 Saat Menjaga Sistem

```text
[ ] Pattern entropy dimonitor.
[ ] Decision penting dicatat.
[ ] Fitness function menjaga boundary.
[ ] Refactoring dilakukan incremental.
[ ] Pattern yang tidak lagi berguna dihapus.
[ ] Tim memiliki vocabulary yang sama.
```

---

## 43. Anti-Pattern Terakhir: Pattern Identity

Anti-pattern terbesar setelah mempelajari seri panjang adalah menjadikan pattern sebagai identitas.

Contoh:

```text
Saya selalu pakai Clean Architecture.
Saya selalu pakai DDD.
Saya selalu pakai event-driven.
Saya selalu pakai microservice.
Saya selalu pakai interface.
Saya selalu pakai Strategy.
```

Top engineer tidak “selalu” memakai satu style.

Top engineer menyesuaikan desain dengan force nyata.

Kalimat yang lebih sehat:

```text
Dalam konteks ini, dengan force ini, trade-off ini, dan failure mode ini,
pattern ini adalah pilihan paling rasional saat ini.
```

---

## 44. Ringkasan Seluruh Seri

Seri ini bergerak dari:

```text
Pattern thinking
  → object design
  → SOLID
  → creational pattern
  → structural pattern
  → behavioral pattern
  → domain/application/persistence/API pattern
  → concurrency/resilience/integration/security/observability pattern
  → framework/architecture/distributed system pattern
  → refactoring and decision matrix
  → case study
  → mastery and judgment
```

Benang merahnya:

```text
Design pattern bukan hafalan struktur class.
Design pattern adalah cara mengendalikan perubahan, coupling, failure, dan konsekuensi jangka panjang.
```

---

## 45. Final Summary

Pattern mastery untuk Java engineer top-tier berarti:

```text
- memahami pattern klasik
- memahami bagaimana Java 8–25 mengubah implementasinya
- memahami anti-pattern yang sering menyamar sebagai best practice
- memahami boundary dan dependency direction
- memahami cost of abstraction
- memahami failure mode
- memahami operational consequence
- memahami refactoring path
- mampu menjelaskan keputusan desain dengan jernih
- mampu menjaga desain berevolusi tanpa membusuk
```

Keahlian tertinggi bukan membuat sistem terlihat rumit.

Keahlian tertinggi adalah membuat sistem yang secara domain memang kompleks menjadi:

```text
lebih eksplisit,
lebih defensible,
lebih testable,
lebih observable,
lebih mudah berubah,
dan lebih aman untuk dikerjakan oleh tim selama bertahun-tahun.
```

---

## 46. Referensi Lanjutan

Gunakan referensi ini bukan untuk menghafal, tetapi untuk memperdalam judgment:

1. Gamma, Helm, Johnson, Vlissides — *Design Patterns: Elements of Reusable Object-Oriented Software*.
2. Martin Fowler — *Patterns of Enterprise Application Architecture*.
3. Martin Fowler — *Refactoring*.
4. Martin Fowler — *Architecture Decision Record*.
5. Martin Fowler — *Strangler Fig Application*.
6. Neal Ford, Rebecca Parsons, Patrick Kua — *Building Evolutionary Architectures*.
7. Joshua Bloch — *Effective Java*.
8. Eric Evans — *Domain-Driven Design*.
9. Vaughn Vernon — *Implementing Domain-Driven Design*.
10. Chris Richardson — *Microservices Patterns*.
11. Gregor Hohpe, Bobby Woolf — *Enterprise Integration Patterns*.
12. OpenJDK / Oracle Java SE documentation for Java 8–25 language and concurrency evolution.
13. OWASP Cheat Sheet Series for security design review.
14. OpenTelemetry documentation for observability design.
15. Google SRE books for reliability and operational thinking.

---

## 47. Status Seri

```text
Part 35 dari 35 selesai.
Seri learn-java-design-patterns-antipatterns-architecture-engineering selesai.
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./34-case-study-enterprise-java-module-pattern-refactoring.md">⬅️ Case Study: Refactoring a Complex Enterprise Java Module Pattern Refactoring</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
