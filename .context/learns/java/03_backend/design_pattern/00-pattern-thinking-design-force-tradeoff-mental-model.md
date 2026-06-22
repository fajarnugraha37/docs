# 00-pattern-thinking-design-force-tradeoff-mental-model

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: `00`  
> Fokus: mental model design pattern, design force, trade-off, consequence, anti-pattern, dan engineering judgment  
> Target: Java engineer yang ingin naik dari “tahu pattern” menjadi “mampu mendesain, mengevaluasi, dan merefaktor sistem dengan judgement senior”  
> Versi Java: Java 8 sampai Java 25

---

## 0. Executive Summary

Design pattern sering dipelajari secara keliru.

Banyak engineer mengira design pattern adalah daftar template seperti:

```text
Singleton = satu object global
Factory = membuat object
Strategy = mengganti if-else
Observer = event listener
Decorator = membungkus object
```

Penjelasan seperti itu tidak salah sepenuhnya, tetapi sangat dangkal. Pada level engineer senior, pattern bukan sekadar bentuk kode. Pattern adalah **jawaban berulang terhadap konflik desain yang juga berulang**.

Konflik desain itu misalnya:

```text
Saya ingin kode fleksibel, tetapi tidak ingin terlalu abstrak.
Saya ingin domain model ekspresif, tetapi tidak ingin persistence bocor ke semua layer.
Saya ingin integrasi external system mudah diganti, tetapi tidak ingin membuat abstraction palsu.
Saya ingin concurrency cepat, tetapi tidak ingin cancellation, timeout, dan context propagation berantakan.
Saya ingin workflow bisa diaudit, tetapi tidak ingin service method berubah menjadi monster procedural logic.
```

Pattern muncul ketika ada **force** yang saling tarik-menarik. Karena itu, pattern yang baik tidak pernah bisa dipahami hanya dari diagram class. Yang harus dipahami adalah:

1. konteksnya,
2. masalahnya,
3. force yang berkonflik,
4. solusi strukturalnya,
5. konsekuensinya,
6. failure mode-nya,
7. refactoring path-nya,
8. kapan pattern itu berubah menjadi anti-pattern.

Mental model utama bagian ini:

```text
Pattern bukan tujuan.
Pattern adalah bentuk stabil dari keputusan desain.

Anti-pattern bukan sekadar kode buruk.
Anti-pattern adalah solusi yang terlihat masuk akal pada awalnya,
tetapi menghasilkan konsekuensi buruk ketika sistem berkembang.
```

Jika hanya tahu pattern, kita bisa membuat codebase penuh `Factory`, `Manager`, `Handler`, `Strategy`, `Abstract`, `Base`, `Impl`, dan `Util`, tetapi tidak lebih maintainable.

Jika memahami force dan consequence, kita bisa memilih desain yang paling sederhana namun cukup kuat untuk kebutuhan sistem.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan design pattern sebagai alat berpikir, bukan template coding.
2. Membedakan idiom, design pattern, architecture pattern, framework pattern, dan anti-pattern.
3. Membaca pattern dari codebase nyata walaupun nama class-nya tidak memakai nama pattern.
4. Mengidentifikasi design force yang mendorong munculnya pattern.
5. Mengevaluasi trade-off sebelum memakai pattern.
6. Mengetahui kapan sebuah pattern berubah menjadi overengineering.
7. Mengetahui kapan kode sederhana lebih baik daripada pattern formal.
8. Menilai pattern dari konsekuensi jangka panjang, bukan dari keindahan diagram.
9. Menggunakan pattern sebagai bahasa komunikasi dalam design review.
10. Membuat Pattern Decision Record untuk keputusan desain penting.
11. Menggunakan Java 8–25 sebagai konteks modern untuk mengevaluasi ulang pattern klasik.
12. Membangun habit berpikir seperti engineer senior: invariant, boundary, failure mode, evolvability, observability, testability, dan operational cost.

---

## 2. Apa Itu Design Pattern Sebenarnya?

### 2.1 Definisi Praktis

Design pattern adalah:

```text
Nama untuk solusi desain yang sering muncul,
dalam konteks masalah yang juga sering muncul,
dengan konsekuensi yang cukup dipahami.
```

Pattern bukan copy-paste code. Pattern juga bukan class diagram yang harus diikuti secara kaku.

Pattern lebih dekat ke bahasa seperti ini:

```text
“Di bagian ini kita butuh Strategy karena algoritma eligibility berubah berdasarkan regulatory context.”

“External API jangan bocor ke domain. Buat Adapter atau Anti-Corruption Layer.”

“Workflow ini tidak boleh hanya status enum. Kita butuh explicit State Machine karena transisinya harus audit-able.”

“Jangan pakai Singleton di sini. Ini global state tersembunyi dan akan menyulitkan test parallel.”
```

Kalimat seperti itu bukan sekadar menyebut nama pattern. Itu menunjukkan bahwa engineer memahami hubungan antara:

```text
problem → force → structure → consequence
```

### 2.2 Pattern adalah Vocabulary

Pattern memberi vocabulary untuk berdiskusi di level lebih tinggi.

Tanpa pattern vocabulary, diskusi design review sering menjadi terlalu rendah level:

```text
Class ini panggil class itu.
Method ini return object itu.
Di sini kita tambahkan if.
Di sini kita inject dependency.
```

Dengan pattern vocabulary, diskusi bisa naik menjadi:

```text
Ini bukan sekadar method call. Ini boundary antar model.
Ini bukan sekadar if. Ini variasi policy yang sebaiknya eksplisit.
Ini bukan sekadar service. Ini application orchestration.
Ini bukan sekadar event. Ini domain event yang punya consequence downstream.
```

Pattern membuat desain bisa dibicarakan sebagai struktur dan konsekuensi, bukan hanya sebagai baris kode.

### 2.3 Pattern adalah Compression

Pattern mengompresi pengalaman.

Ketika seseorang mengatakan “Repository”, engineer lain yang berpengalaman langsung membayangkan banyak hal:

```text
- collection-like abstraction terhadap aggregate/domain object
- pemisahan domain dari persistence detail
- query boundary
- transaction consideration
- kemungkinan leaky ORM abstraction
- N+1 risk
- pagination concern
- testing boundary
```

Satu kata membawa banyak konteks. Inilah kekuatan pattern.

Tetapi compression juga berbahaya. Jika tim punya pemahaman berbeda terhadap kata yang sama, pattern menjadi sumber miskomunikasi.

Contoh:

```text
Engineer A: “Kita pakai Repository.”
Maksud A: domain-level collection abstraction.

Engineer B: “Repository itu interface CRUD generic.”
Maksud B: JpaRepository-style data access object.

Engineer C: “Repository itu semua query SQL ditaruh di satu class.”
Maksud C: query dumping ground.
```

Nama pattern sama, interpretasi berbeda, desain kacau.

Karena itu, pattern harus dibahas bersama konteks dan konsekuensinya.

---

## 3. Pattern Bukan Template

### 3.1 Template Thinking

Template thinking biasanya seperti ini:

```text
Masalah: banyak if-else.
Solusi: pakai Strategy.

Masalah: object creation kompleks.
Solusi: pakai Factory.

Masalah: butuh global object.
Solusi: pakai Singleton.

Masalah: ada event.
Solusi: pakai Observer.
```

Ini terlalu mekanis.

Tidak semua if-else perlu Strategy. Tidak semua object creation perlu Factory. Tidak semua shared dependency perlu Singleton. Tidak semua event perlu Observer atau Pub/Sub.

### 3.2 Force Thinking

Force thinking bertanya lebih dalam:

```text
Apa yang berubah?
Apa yang stabil?
Siapa pemilik variasi?
Apakah variasi ini runtime atau compile-time?
Apakah variasi ini domain-driven atau technical-driven?
Apakah behavior perlu diuji terpisah?
Apakah dependency direction saat ini berbahaya?
Apakah abstraction ini menyembunyikan hal yang memang perlu diketahui caller?
Berapa biaya cognitive load-nya?
```

Contoh: banyak `if-else`.

Belum tentu buruk.

```java
String labelFor(Status status) {
    return switch (status) {
        case DRAFT -> "Draft";
        case SUBMITTED -> "Submitted";
        case APPROVED -> "Approved";
        case REJECTED -> "Rejected";
    };
}
```

Ini tidak butuh Strategy. Ini mapping sederhana dan stabil. Dengan Java modern, `switch` expression justru lebih jelas daripada membuat beberapa class kecil.

Tetapi ini berbeda:

```java
Decision decide(Application application, Officer officer, RegulatoryContext context) {
    if (context.isRenewal()) {
        // 80 lines
    } else if (context.isAppeal()) {
        // 120 lines
    } else if (context.isEnforcement()) {
        // 150 lines
    } else if (context.isSpecialCase()) {
        // 100 lines
    }
}
```

Di sini Strategy, Policy Object, Specification, atau State Machine mungkin relevan. Bukan karena ada `if`, tetapi karena:

```text
- behavior besar dan berbeda
- tiap cabang punya alasan perubahan sendiri
- tiap cabang mungkin perlu test sendiri
- logic berpotensi sering berubah
- domain rule tersembunyi di procedural service
- error dan audit consequence berbeda
```

Pattern dipilih bukan karena bentuk kode saat ini, tetapi karena force yang mendorong evolusinya.

---

## 4. Pattern sebagai Respons terhadap Design Force

### 4.1 Apa Itu Design Force?

Design force adalah tekanan, constraint, atau kebutuhan yang memengaruhi desain.

Contoh design force:

```text
Changeability       : requirement sering berubah
Stability           : bagian tertentu harus tetap stabil
Performance         : overhead harus rendah
Memory              : object count tinggi
Concurrency         : akses paralel
Consistency         : state harus konsisten
Isolation           : external system tidak boleh mencemari domain
Testability         : logic harus bisa diuji terpisah
Auditability        : keputusan harus bisa dijelaskan setelah kejadian
Security            : akses harus dikontrol
Observability       : kegagalan harus bisa dilacak
Operability         : sistem harus mudah dioperasikan saat incident
Compatibility       : API tidak boleh mudah breaking
Cognitive load      : tim harus bisa memahami desain
Time-to-market      : solusi harus cukup cepat dibangun
```

Pattern muncul karena force-force ini sering bertabrakan.

### 4.2 Contoh Konflik Force

#### Force 1: Flexibility vs Simplicity

Kita ingin sistem fleksibel terhadap perubahan. Tetapi setiap abstraction menambah cognitive load.

```text
Terlalu sedikit abstraction → perubahan sulit, kode duplicate.
Terlalu banyak abstraction  → kode sulit dipahami, indirection berlebihan.
```

Pattern yang relevan:

```text
Strategy, Factory, Adapter, Template Method, Specification
```

Anti-pattern yang mungkin muncul:

```text
AbstractFactoryFactory
Strategy for one case
Interface for every class
Manager/Helper explosion
```

#### Force 2: Reuse vs Coupling

Reuse terdengar bagus. Tetapi reuse yang salah menciptakan coupling.

```text
Shared utility dipakai 20 module.
Satu perubahan kecil merusak banyak flow.
```

Pattern yang relevan:

```text
Facade, Adapter, Module Boundary, Domain Primitive
```

Anti-pattern:

```text
Common module dumping ground
God utility
Shared kernel without governance
```

#### Force 3: Runtime Variability vs Compile-Time Safety

Kadang behavior perlu dipilih saat runtime. Tetapi makin banyak runtime variability, makin sulit compiler membantu.

```text
Reflection config, string key, plugin dynamic loading, annotation magic.
```

Pattern yang relevan:

```text
Strategy Registry, SPI, Factory, Provider, Command Handler
```

Anti-pattern:

```text
Stringly typed dispatch
Hidden plugin failure
Runtime-only contract
```

#### Force 4: Domain Expressiveness vs Framework Convenience

Framework seperti Spring, Jakarta EE, Hibernate, CDI memberi banyak convenience. Tetapi domain bisa tercemar annotation, lazy proxy, transaction detail, dan persistence concern.

Pattern yang relevan:

```text
Application Service, Domain Service, Repository, Mapper, Anti-Corruption Layer
```

Anti-pattern:

```text
Entity as API DTO
Domain object depends on framework container
Transaction boundary hidden in arbitrary service call
```

#### Force 5: Auditability vs Implementation Convenience

Dalam sistem enterprise/regulatory, keputusan perlu dapat dijelaskan.

Kode seperti ini mudah dibuat:

```java
application.setStatus(Status.REJECTED);
application.setReason(reason);
repository.save(application);
```

Tetapi untuk lifecycle penting, ini mungkin tidak cukup. Pertanyaan audit:

```text
Siapa yang mengubah?
Dari state apa ke state apa?
Rule apa yang mengizinkan transisi?
Apa input yang dipakai untuk keputusan?
Apakah ada approval chain?
Apakah event terbit setelah commit?
Apakah error sebelum commit tercatat?
```

Pattern yang relevan:

```text
State Machine, Command, Domain Event, Audit Event, Specification, Policy Object
```

Anti-pattern:

```text
Status enum without transition model
Audit as free-text log
Workflow hidden inside service method
```

---

## 5. Anatomy of a Pattern

Untuk memahami pattern secara benar, jangan mulai dari UML. Mulai dari anatomi.

### 5.1 Pattern Name

Nama pattern adalah handle komunikasi.

Contoh:

```text
Strategy
Adapter
Factory Method
State
Observer
Repository
Outbox
Circuit Breaker
```

Nama pattern berguna jika tim punya pemahaman yang sama. Jika tidak, nama pattern bisa menjadi noise.

### 5.2 Context

Context menjawab:

```text
Dalam situasi apa pattern ini muncul?
Di boundary mana?
Di level apa?
Dalam lifecycle apa?
```

Contoh context Strategy:

```text
Ada beberapa algoritma atau policy yang menjalankan tujuan sama,
tetapi detailnya berbeda dan bisa berubah independen.
```

Contoh context Adapter:

```text
Sistem perlu berinteraksi dengan interface/model external yang tidak sesuai dengan model internal.
```

### 5.3 Problem

Problem harus spesifik.

Buruk:

```text
Kode tidak clean.
```

Lebih baik:

```text
Eligibility decision untuk application renewal, appeal, dan enforcement bercampur dalam satu service method,
sehingga perubahan rule satu flow berisiko merusak flow lain.
```

### 5.4 Forces

Forces menjelaskan konflik.

Contoh:

```text
- Rule sering berubah.
- Audit harus eksplisit.
- Caller tidak boleh tahu detail tiap rule.
- Tim butuh test granular.
- Tidak ingin menambah framework rule engine dulu.
```

Dari force ini, kita bisa mempertimbangkan Specification/Policy Object.

### 5.5 Solution

Solution adalah struktur yang mengatasi konflik force.

Contoh:

```text
Pisahkan setiap policy menjadi object eksplisit dengan contract yang sama.
Application service memilih policy berdasarkan context.
Setiap policy menghasilkan decision object yang memuat result, reason, dan audit metadata.
```

### 5.6 Consequences

Setiap pattern punya konsekuensi.

Contoh Strategy:

Keuntungan:

```text
- Variasi behavior terisolasi.
- Test lebih granular.
- Open for extension pada axis tertentu.
```

Biaya:

```text
- Class/object bertambah.
- Indirection bertambah.
- Pemilihan strategy perlu dikelola.
- Salah desain bisa menjadi strategy explosion.
```

### 5.7 Failure Mode

Failure mode adalah cara pattern gagal.

Contoh Adapter:

```text
- Adapter hanya pass-through, tidak benar-benar melindungi domain.
- External exception bocor ke internal layer.
- External DTO dipakai sampai domain service.
- Mapping error tidak terlihat sampai production.
```

### 5.8 Refactoring Path

Pattern yang baik sering muncul dari refactoring bertahap, bukan dari big-bang design.

Contoh:

```text
1. Temukan conditional besar.
2. Pisahkan cabang menjadi private method.
3. Ekstrak data input menjadi parameter object.
4. Ekstrak behavior menjadi interface kecil.
5. Implementasikan concrete policy.
6. Tambahkan registry/factory jika pemilihan policy mulai kompleks.
7. Tambahkan test per policy.
```

### 5.9 Non-Applicability

Pattern yang matang harus menjelaskan kapan tidak dipakai.

Contoh:

```text
Jangan pakai Strategy jika variasinya hanya dua baris mapping sederhana dan jarang berubah.
Jangan pakai Factory jika constructor sudah jelas dan object creation tidak menyembunyikan policy.
Jangan pakai Event jika caller butuh hasil synchronous dan transactional guarantee eksplisit.
```

---

## 6. Pattern, Idiom, Architecture Pattern, Framework Pattern

Salah satu kesalahan umum adalah mencampur semua istilah.

### 6.1 Idiom

Idiom adalah cara khas bahasa tertentu untuk menyelesaikan masalah kecil.

Contoh Java idiom:

```java
try (var stream = Files.lines(path)) {
    return stream.count();
}
```

Ini bukan design pattern besar. Ini idiom resource management.

Contoh lain:

```java
private static class Holder {
    static final Config INSTANCE = new Config();
}

static Config instance() {
    return Holder.INSTANCE;
}
```

Ini lazy holder idiom untuk lazy singleton.

Idiom biasanya:

```text
- bahasa-specific
- scope kecil
- sering dekat dengan syntax/runtime
- tidak selalu berlaku di bahasa lain
```

### 6.2 Design Pattern

Design pattern berada di level object collaboration.

Contoh:

```text
Strategy
Adapter
Decorator
Observer
State
Command
Factory Method
```

Scope-nya biasanya:

```text
- beberapa class/object
- collaboration structure
- behavior variation
- dependency direction
```

### 6.3 Architecture Pattern

Architecture pattern berada di level sistem/module/boundary.

Contoh:

```text
Layered Architecture
Hexagonal Architecture
Clean Architecture
CQRS
Event Sourcing
Microservices
Modular Monolith
Strangler Fig
```

Scope-nya:

```text
- module boundaries
- deployment boundaries
- data ownership
- integration style
- team ownership
- operational model
```

### 6.4 Framework Pattern

Framework pattern muncul karena framework menyediakan lifecycle dan extension model.

Contoh di Java:

```text
Dependency Injection
AOP Interceptor
Servlet Filter Chain
JAX-RS Resource Provider
CDI Producer
Spring Bean PostProcessor
Hibernate Entity Listener
Jakarta Validation ConstraintValidator
Service Provider Interface
```

Framework pattern sering memudahkan, tetapi juga bisa menyembunyikan control flow.

### 6.5 Anti-Pattern

Anti-pattern adalah solusi yang terlihat wajar tetapi menghasilkan masalah berulang.

Contoh:

```text
God Service
Anemic Domain Model
Service Locator Abuse
Generic Repository Abuse
Singleton Everything
Distributed Monolith
Event Soup
DTO Explosion
Annotation Magic
```

Anti-pattern penting karena engineer senior bukan hanya tahu cara membangun solusi, tetapi juga tahu tanda-tanda desain sedang menuju kegagalan.

---

## 7. Anti-Pattern: Solusi yang Terlihat Benar di Awal

### 7.1 Anti-Pattern Bukan Sekadar Kode Jelek

Kode jelek mudah dikenali:

```text
method 1000 baris
variable tidak jelas
duplicate copy-paste
exception ditelan
```

Anti-pattern lebih berbahaya karena sering terlihat profesional.

Contoh:

```java
public interface UserService {
    UserDto create(UserCreateRequest request);
    UserDto update(Long id, UserUpdateRequest request);
    UserDto approve(Long id);
    UserDto reject(Long id);
    UserDto suspend(Long id);
    UserDto activate(Long id);
    UserDto resetPassword(Long id);
    UserDto assignRole(Long id, String role);
    UserDto removeRole(Long id, String role);
}
```

Sekilas rapi: interface, DTO, service layer.

Tetapi mungkin ini God Service. Semua use case, authorization, lifecycle, validation, transaction, event, dan audit bercampur.

Anti-pattern sering memakai vocabulary yang benar, tetapi responsibility-nya salah.

### 7.2 Anti-Pattern Biasanya Berawal dari Keputusan Lokal yang Masuk Akal

Contoh evolusi God Service:

```text
Hari 1:
UserService.createUser() sederhana.

Bulan 2:
Tambahkan update, approve, reject.

Bulan 4:
Tambahkan audit.

Bulan 6:
Tambahkan event publish.

Bulan 8:
Tambahkan integration call.

Bulan 12:
Semua perubahan user lifecycle masuk UserService.
Tidak ada yang berani memecah karena terlalu banyak flow tergantung padanya.
```

Tidak ada satu keputusan yang tampak bodoh. Tetapi akumulasi perubahan membuat desain membusuk.

### 7.3 Anti-Pattern Memiliki Feedback Lambat

Banyak anti-pattern tidak langsung terasa.

```text
Generic repository terasa cepat di awal.
Setelah query kompleks muncul, abstraction bocor.

Event-driven terasa decoupled di awal.
Setelah side effect tidak terlacak, debugging menjadi sulit.

Annotation-driven magic terasa ringkas di awal.
Setelah production incident, control flow sulit ditemukan.

Singleton terasa praktis di awal.
Setelah parallel test dan multi-tenant context, state bocor.
```

Senior engineer harus menilai bukan hanya “apakah ini bekerja sekarang”, tetapi “bagaimana ini gagal nanti”.

---

## 8. Design Smell, Code Smell, Architecture Smell

### 8.1 Code Smell

Code smell adalah indikasi permukaan bahwa ada masalah desain/implementasi lebih dalam.

Contoh:

```text
Long Method
Large Class
Duplicate Code
Long Parameter List
Switch Statements
Primitive Obsession
Feature Envy
Data Clumps
Shotgun Surgery
```

Tetapi smell bukan bukti mutlak. Smell adalah sinyal investigasi.

Contoh: switch statement.

Tidak semua switch buruk.

```java
return switch (httpStatus) {
    case 400 -> "Bad Request";
    case 401 -> "Unauthorized";
    case 403 -> "Forbidden";
    case 404 -> "Not Found";
    default -> "Unexpected";
};
```

Ini baik-baik saja.

Tetapi switch seperti ini mencurigakan:

```java
switch (application.getStatus()) {
    case DRAFT -> submit(application);
    case SUBMITTED -> approve(application);
    case APPROVED -> renew(application);
    case REJECTED -> appeal(application);
}
```

Kenapa? Karena status lifecycle mungkin menyembunyikan transition model.

### 8.2 Design Smell

Design smell berada di level responsibility dan collaboration.

Contoh:

```text
- Service tahu terlalu banyak detail repository, mapper, remote API, audit, dan rule.
- Domain object hanya getter/setter tanpa behavior.
- Interface dibuat hanya karena “best practice”, bukan karena ada variasi.
- Factory tidak mengurangi coupling, hanya memindahkan new ke tempat lain.
- Adapter tidak menerjemahkan model, hanya pass-through.
```

### 8.3 Architecture Smell

Architecture smell berada di level boundary sistem.

Contoh:

```text
- Module A dan B saling tergantung.
- Semua service berbagi database schema yang sama.
- External DTO masuk sampai domain layer.
- Common library menjadi tempat semua hal.
- Microservice saling panggil synchronous panjang.
- Event digunakan tanpa ownership dan idempotency.
```

### 8.4 Smell Triage

Tidak semua smell harus langsung diperbaiki. Gunakan triage:

```text
1. Apakah smell ini berada di area yang sering berubah?
2. Apakah smell ini menyebabkan bug berulang?
3. Apakah smell ini membuat testing sulit?
4. Apakah smell ini membuat onboarding lambat?
5. Apakah smell ini mengancam data integrity/security/auditability?
6. Apakah smell ini dekat dengan upcoming change?
```

Jika jawabannya “ya” untuk beberapa poin, refactoring lebih layak.

---

## 9. Pattern Literacy untuk Java Engineer Senior

Pattern literacy adalah kemampuan untuk:

```text
- mengenali pattern tanpa melihat namanya,
- mengenali anti-pattern walaupun bentuknya terlihat rapi,
- memilih pattern berdasarkan force,
- menjelaskan trade-off-nya,
- melakukan refactoring bertahap,
- menghindari abstraction yang tidak perlu,
- membuat desain yang bisa berevolusi.
```

### 9.1 Level 1: Pattern Recognition

Engineer bisa berkata:

```text
Ini Strategy.
Ini Adapter.
Ini Observer.
Ini Factory.
```

Ini level awal.

### 9.2 Level 2: Pattern Implementation

Engineer bisa mengimplementasikan pattern dengan benar.

Contoh Strategy:

```java
public interface PricingPolicy {
    Money calculatePrice(Order order);
}
```

Lalu concrete implementation:

```java
public final class RegularPricingPolicy implements PricingPolicy {
    @Override
    public Money calculatePrice(Order order) {
        return order.baseAmount();
    }
}
```

Ini lebih baik, tetapi belum cukup.

### 9.3 Level 3: Pattern Selection

Engineer bisa menjawab:

```text
Apakah Strategy diperlukan?
Mengapa bukan switch expression?
Mengapa bukan enum method?
Mengapa bukan rule table?
Mengapa bukan external rule engine?
Apa yang berubah?
Apa yang stabil?
```

Ini mulai senior.

### 9.4 Level 4: Pattern Consequence Management

Engineer bisa mengantisipasi:

```text
Jika jumlah strategy bertambah menjadi 30, bagaimana discovery-nya?
Jika policy butuh dependency, bagaimana injection-nya?
Jika policy perlu priority, bagaimana conflict resolution-nya?
Jika dua policy match bersamaan, apa invariant-nya?
Jika tidak ada policy match, error-nya apa?
```

Ini level yang jauh lebih penting.

### 9.5 Level 5: Pattern Evolution

Engineer bisa membawa sistem dari kondisi buruk ke desain lebih baik tanpa rewrite besar.

Contoh:

```text
God service → application service + policy objects + gateway + event publisher
Status enum chaos → explicit state transition model
External API leakage → adapter + internal canonical model
Utility sprawl → domain primitive + module boundary
```

Top engineer tidak hanya mendesain dari nol. Ia mampu memperbaiki sistem hidup yang penuh constraint.

---

## 10. Cara Membaca Codebase dan Mengenali Hidden Pattern

Dalam codebase nyata, class jarang bernama `Strategy`, `Adapter`, atau `Facade`.

Pattern sering tersembunyi di balik nama domain.

### 10.1 Cari Axis of Variation

Pertanyaan:

```text
Apa yang berubah-ubah di sini?
```

Contoh:

```java
interface NotificationSender {
    void send(Notification notification);
}

final class EmailNotificationSender implements NotificationSender { }
final class SmsNotificationSender implements NotificationSender { }
final class PushNotificationSender implements NotificationSender { }
```

Ini mungkin Strategy, Adapter, atau Gateway tergantung konteks.

Jika variasinya adalah channel teknis, ini bisa Gateway/Adapter.
Jika variasinya adalah algoritma pengiriman, ini bisa Strategy.

Pattern tidak bisa ditentukan dari bentuk class saja. Harus lihat force.

### 10.2 Cari Boundary

Pertanyaan:

```text
Apakah class ini memisahkan dua dunia?
```

Contoh:

```java
public final class OneMapClient {
    public AddressSearchResult searchByPostalCode(String postalCode) { ... }
}
```

Ini bisa Gateway.

Jika ia menerjemahkan model external ke internal:

```java
public Address findAddress(PostalCode postalCode) {
    OneMapResponse response = httpClient.get(...);
    return mapper.toAddress(response);
}
```

Ia juga berperan sebagai Adapter/Anti-Corruption Layer.

### 10.3 Cari Ownership of Decision

Pertanyaan:

```text
Siapa yang memutuskan?
```

Jika service besar melakukan semua keputusan:

```java
if (user.hasRole("ADMIN") && application.isSubmitted() && !application.isExpired()) {
    approve();
}
```

Mungkin ada Authorization Policy, Specification, atau State Guard yang tersembunyi.

### 10.4 Cari Lifecycle

Pertanyaan:

```text
Apakah object ini punya state transition?
```

Jika banyak kode seperti:

```java
setStatus(APPROVED)
setStatus(REJECTED)
setStatus(PENDING_REVIEW)
```

Cari model transisinya. Jika tidak ada, mungkin anti-pattern: status without state machine.

### 10.5 Cari Repeated Shape

Pattern sering muncul sebagai bentuk berulang:

```text
XRequest → XCommand → XHandler → XResult
YRequest → YCommand → YHandler → YResult
```

Ini bisa Command Handler pattern.

Atau:

```text
ExternalXDto → XMapper → InternalX
ExternalYDto → YMapper → InternalY
```

Ini mapping boundary.

Repeated shape bisa baik jika deliberate, tetapi bisa juga cargo cult.

---

## 11. Java 8–25 Mengubah Cara Kita Melihat Pattern

Pattern klasik banyak lahir sebelum Java modern. Karena itu, beberapa pattern perlu ditafsir ulang.

### 11.1 Java 8: Lambda Mengubah Strategy

Sebelum Java 8:

```java
public interface TaxCalculator {
    Money calculate(Invoice invoice);
}

public final class StandardTaxCalculator implements TaxCalculator {
    @Override
    public Money calculate(Invoice invoice) {
        return invoice.amount().multiply(0.11);
    }
}
```

Setelah Java 8, untuk behavior kecil:

```java
Function<Invoice, Money> standardTax = invoice -> invoice.amount().multiply(0.11);
```

Tetapi jangan salah paham.

Lambda bagus untuk behavior kecil dan lokal. Untuk domain policy penting yang perlu nama, test, audit, dependency, dan ownership, class eksplisit masih lebih baik.

Guideline:

```text
Lambda cocok jika:
- behavior kecil,
- tidak butuh nama domain kuat,
- tidak butuh state/dependency kompleks,
- local composition cukup jelas.

Class Strategy lebih cocok jika:
- behavior punya domain meaning,
- perlu test terpisah,
- perlu dependency injection,
- perlu observability/audit,
- perlu ownership tim yang jelas.
```

### 11.2 Records Mengubah DTO dan Value Object

Record membuat data carrier lebih ringkas:

```java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new IllegalArgumentException("Invalid scale");
        }
    }
}
```

Ini mengurangi kebutuhan boilerplate class untuk immutable data.

Tetapi record bukan pengganti semua domain object.

Record cocok untuk:

```text
- immutable data carrier,
- value object sederhana,
- command/query DTO,
- event payload,
- result object.
```

Record kurang cocok jika:

```text
- identity mutable penting,
- lifecycle kompleks,
- invariant membutuhkan controlled mutation,
- persistence framework menuntut proxy/mutability tertentu.
```

### 11.3 Sealed Classes Mengubah State, Visitor, dan Type Hierarchy

Sealed hierarchy memungkinkan model alternatif tertutup:

```java
public sealed interface Decision permits Approved, Rejected, PendingReview { }

public record Approved(String approvalNo) implements Decision { }
public record Rejected(String reason) implements Decision { }
public record PendingReview(String queue) implements Decision { }
```

Dengan sealed types, compiler bisa membantu exhaustive handling.

```java
String label(Decision decision) {
    return switch (decision) {
        case Approved approved -> "Approved: " + approved.approvalNo();
        case Rejected rejected -> "Rejected: " + rejected.reason();
        case PendingReview pending -> "Pending: " + pending.queue();
    };
}
```

Ini mengubah kebutuhan Visitor dalam beberapa kasus. Visitor masih berguna, tetapi sealed + pattern matching membuat banyak use case lebih sederhana.

### 11.4 Pattern Matching Mengurangi Boilerplate, Bukan Menghilangkan Design

Pattern matching membuat branching lebih aman dan ekspresif. Tetapi jika branching mengandung domain decision besar, tetap perlu desain.

Buruk:

```java
return switch (caseType) {
    case Renewal r -> { /* 200 lines */ }
    case Appeal a -> { /* 180 lines */ }
    case Enforcement e -> { /* 300 lines */ }
};
```

Lebih baik:

```java
return switch (caseType) {
    case Renewal r -> renewalPolicy.decide(r);
    case Appeal a -> appealPolicy.decide(a);
    case Enforcement e -> enforcementPolicy.decide(e);
};
```

Pattern matching membantu dispatch, tetapi tidak menggantikan responsibility modeling.

### 11.5 Virtual Threads Mengubah Concurrency Pattern

Sebelum virtual threads, banyak desain Java dipengaruhi kelangkaan thread. Kita menggunakan async callback, executor tuning, reactive pipeline, dan non-blocking style untuk mengatasi blocking I/O.

Dengan virtual threads, blocking style bisa kembali masuk akal untuk banyak I/O-bound workloads.

Tetapi virtual threads bukan alasan untuk mengabaikan:

```text
- timeout,
- cancellation,
- backpressure,
- connection pool limit,
- external service rate limit,
- transaction duration,
- memory pressure,
- observability.
```

Pattern concurrency modern berubah dari “bagaimana menghindari blocking” menjadi “bagaimana membatasi, membatalkan, dan mengamati unit kerja concurrent”.

### 11.6 Scoped Values dan Structured Concurrency Mengubah Context Propagation

ThreadLocal dahulu sering dipakai untuk request context, correlation id, tenant id, security context, dan tracing.

Dengan virtual threads, ThreadLocal tetap bisa dipakai tetapi perlu lebih hati-hati. Scoped Values memberi model yang lebih eksplisit untuk data immutable yang berlaku dalam scope tertentu.

Structured concurrency membantu melihat beberapa subtask sebagai satu unit kerja, sehingga failure dan cancellation lebih mudah dikelola.

Dampaknya terhadap pattern:

```text
- Context Object pattern berubah.
- ThreadLocal-heavy design perlu dievaluasi ulang.
- Executor/Future pattern perlu mempertimbangkan structured lifecycle.
- Observer/asynchronous side effect perlu punya cancellation story.
```

---

## 12. Pattern Decision: Dari “Pakai Apa?” ke “Mengapa Ini?”

Pertanyaan junior:

```text
Pattern apa yang cocok untuk kasus ini?
```

Pertanyaan senior:

```text
Apa force dominan di kasus ini?
Apa desain paling sederhana yang menjaga invariant penting?
Bagian mana yang harus fleksibel?
Bagian mana yang harus sengaja dibuat tidak fleksibel?
Apa konsekuensi operasionalnya?
Apa failure mode-nya?
Apa refactoring path jika asumsi berubah?
```

### 12.1 Jangan Mulai dari Pattern Catalog

Mulai dari masalah.

Template berpikir:

```text
1. Apa use case-nya?
2. Apa invariant yang tidak boleh rusak?
3. Apa yang berubah dan apa yang stabil?
4. Apa boundary-nya?
5. Apa dependency direction yang diinginkan?
6. Apa failure mode utama?
7. Apa yang perlu diamati saat production?
8. Apa design paling sederhana yang cukup?
9. Pattern apa yang secara natural muncul?
10. Apa anti-pattern yang harus dihindari?
```

### 12.2 Contoh: Banyak Payment Method

Masalah:

```text
Sistem mendukung payment method: card, bank transfer, e-wallet.
Setiap method punya validation, fee, external gateway, dan failure behavior berbeda.
```

Pilihan desain:

#### Option A: If-else di service

```java
if (method == CARD) { ... }
else if (method == BANK_TRANSFER) { ... }
else if (method == EWALLET) { ... }
```

Cocok jika:

```text
- hanya prototype,
- logic sangat kecil,
- variasi jarang berubah,
- tidak ada external dependency rumit.
```

Tidak cocok jika:

```text
- logic berbeda besar,
- payment method sering ditambah,
- gateway berbeda,
- error semantics berbeda,
- settlement/audit berbeda.
```

#### Option B: Strategy

```java
interface PaymentProcessor {
    PaymentResult process(PaymentCommand command);
    boolean supports(PaymentMethod method);
}
```

Cocok jika:

```text
- variasi behavior jelas,
- tiap method bisa diuji sendiri,
- dependency berbeda,
- selection logic manageable.
```

Risiko:

```text
- supports() conflict,
- ordering ambiguity,
- terlalu banyak small classes,
- common flow duplicate.
```

#### Option C: Template Method + Strategy

Jika ada flow stabil:

```text
validate → reserve → charge → record → publish event
```

Tetapi beberapa step bervariasi, Template Method atau orchestrator + strategy step bisa lebih cocok.

#### Option D: State Machine

Jika payment punya lifecycle kompleks:

```text
INITIATED → AUTHORIZED → CAPTURED → SETTLED → REFUNDED
```

Maka problem bukan hanya variasi payment method. Ada state transition. State Machine mungkin lebih penting daripada Strategy.

### 12.3 Lesson

Pattern selection bukan jawaban tunggal. Sering kali beberapa pattern bekerja bersama, tetapi harus ada pattern utama yang menjawab force dominan.

---

## 13. Pattern Composition

Di sistem nyata, pattern jarang berdiri sendiri.

Contoh use case: submit enforcement case.

Kemungkinan composition:

```text
Command              : SubmitCaseCommand
Command Handler      : SubmitCaseHandler
Application Service  : orchestrates transaction
Specification        : eligibility/guard rules
State Machine        : valid transition
Repository           : load/save aggregate
Adapter/Gateway      : external reference validation
Domain Event         : CaseSubmitted
Outbox               : reliable event publication
Audit Event          : regulatory traceability
Exception Translator : stable API error
```

Ini bukan overengineering jika setiap pattern menjawab force nyata.

Tetapi ini overengineering jika use case hanya CRUD sederhana.

### 13.1 Pattern Stack Harus Punya Justifikasi

Untuk setiap layer/pattern, tanyakan:

```text
Pattern ini melindungi invariant apa?
Pattern ini mengisolasi perubahan apa?
Pattern ini mengurangi risiko apa?
Pattern ini menambah biaya apa?
Jika dihapus, apa yang rusak?
```

Jika tidak bisa dijawab, pattern itu kemungkinan ceremony.

### 13.2 Composition Bisa Menghasilkan Emergent Complexity

Pattern yang masing-masing benar bisa menjadi sistem yang sulit dipahami jika digabung tanpa disiplin.

Contoh:

```text
Controller → Mapper → Command → Handler → ApplicationService → DomainService → Policy → Specification → Repository → Entity → EventPublisher → Outbox → Listener → Gateway
```

Struktur ini bisa benar untuk use case kompleks. Tetapi bisa berlebihan untuk update field sederhana.

Senior engineer harus menjaga proportionality.

---

## 14. Pattern dan Boundary

Pattern terbaik biasanya memperjelas boundary.

Boundary penting karena bug dan complexity sering muncul ketika dua dunia bercampur.

### 14.1 Boundary yang Umum di Java Enterprise

```text
API boundary            : HTTP/gRPC/message input-output
Application boundary    : use case orchestration
Domain boundary         : business rule/invariant
Persistence boundary    : database/ORM/query concern
Integration boundary    : external system contract
Security boundary       : subject, permission, policy
Transaction boundary    : commit/rollback unit
Concurrency boundary    : ownership and lifecycle of parallel work
Module boundary         : package/component ownership
Deployment boundary     : process/service/runtime ownership
```

### 14.2 Pattern sebagai Boundary Marker

Contoh:

```text
DTO        → API boundary
Command    → use case boundary
Repository → persistence boundary
Adapter    → integration boundary
Policy     → decision boundary
State      → lifecycle boundary
Event      → side-effect boundary
Facade     → subsystem boundary
```

Jika pattern tidak memperjelas boundary, mungkin pattern itu hanya dekorasi.

### 14.3 Boundary Leak

Boundary leak adalah ketika detail dari satu dunia bocor ke dunia lain.

Contoh:

```java
public class ApplicationApprovalService {
    public void approve(OneMapApiResponse response, HttpServletRequest request, EntityManager em) {
        // domain decision + HTTP + external DTO + persistence API mixed together
    }
}
```

Ini mencampur:

```text
- external API model,
- HTTP concern,
- persistence concern,
- domain decision.
```

Pattern yang mungkin membantu:

```text
Controller DTO → Command → Application Service → Domain Policy → Repository → Adapter
```

Bukan karena layered architecture harus selalu dipakai, tetapi karena boundary leak sedang merusak reasoning.

---

## 15. Pattern dan Invariant

Salah satu pertanyaan terpenting dalam desain:

```text
Invariant apa yang harus selalu benar?
```

Invariant adalah kondisi yang harus dipertahankan oleh sistem.

Contoh:

```text
Application yang sudah APPROVED tidak boleh kembali ke DRAFT.
Payment tidak boleh CAPTURED sebelum AUTHORIZED.
Case tidak boleh CLOSED jika masih ada pending task.
User tidak boleh approve application miliknya sendiri.
Audit event harus tercatat untuk setiap state transition penting.
Outbox event tidak boleh publish sebelum transaction commit.
```

Pattern berguna jika membantu menjaga invariant.

### 15.1 Invariant Lemah: Hanya Convention

```java
application.setStatus(Status.APPROVED);
```

Semua code bisa memanggil setter. Invariant hanya berdasarkan disiplin manusia.

### 15.2 Invariant Lebih Kuat: Behavior Method

```java
application.approve(ApprovalContext context);
```

Method bisa memvalidasi guard.

### 15.3 Invariant Lebih Eksplisit: State Machine

```java
stateMachine.transition(application, APPROVE, context);
```

Transition rule bisa diaudit dan dites.

### 15.4 Invariant Lebih Terstruktur: Command + Policy + State Machine

```java
submitCaseHandler.handle(command);
```

Di dalamnya:

```text
- command validation,
- authorization policy,
- state transition guard,
- domain mutation,
- audit event,
- outbox event.
```

Semakin penting invariant, semakin layak desain eksplisit.

---

## 16. Pattern dan Cost Model

Pattern tidak gratis.

Setiap pattern punya biaya.

### 16.1 Cognitive Cost

Berapa banyak konsep yang harus dipahami pembaca?

```text
Simple method: rendah
Strategy registry: sedang
Plugin architecture via SPI: tinggi
Event-driven saga: sangat tinggi
```

### 16.2 Runtime Cost

Ada overhead?

```text
Dynamic proxy
Reflection
Serialization
Indirection
Thread creation
Object allocation
Locking
Network call
```

Banyak overhead kecil tidak masalah, tetapi di hot path bisa penting.

### 16.3 Testing Cost

Pattern bisa menurunkan atau menaikkan testing cost.

Strategy menurunkan cost jika behavior bisa dites terpisah.

Tetapi event-driven side effect bisa menaikkan cost jika flow menjadi asynchronous dan eventually consistent.

### 16.4 Operational Cost

Pattern memengaruhi operasi production.

Contoh:

```text
Circuit breaker butuh metrics dan tuning.
Outbox butuh relay, retry, monitoring, cleanup.
Saga butuh compensation visibility.
Cache pattern butuh invalidation strategy.
Plugin architecture butuh version compatibility.
```

### 16.5 Migration Cost

Apakah pattern membuat migrasi lebih mudah atau sulit?

Adapter bisa memudahkan migrasi external API.

Tetapi abstraction yang salah bisa membuat semua caller tergantung pada model palsu yang sulit diganti.

### 16.6 Cost Model Table

| Pattern | Benefit | Cost | Risk |
|---|---|---|---|
| Strategy | Isolasi variasi behavior | class/registry/selection | strategy explosion |
| Factory | Kontrol creation | indirection | hidden dependency |
| Adapter | Isolasi external model | mapping overhead | pass-through adapter |
| Observer/Event | Decoupling side effect | tracing/debugging sulit | event soup |
| State Machine | Lifecycle eksplisit | model lebih kompleks | transition table overkill |
| Repository | Persistence boundary | abstraction design | leaky ORM/generic repository |
| Outbox | Reliable event publication | relay/cleanup/monitoring | stuck outbox |
| Circuit Breaker | Failure isolation | tuning/metrics | masking real issue |

---

## 17. Pattern Maturity Model

Tidak semua sistem butuh pattern formal sejak awal.

### 17.1 Stage 1: Direct Code

```java
public void approve(Long applicationId) {
    Application app = repository.findById(applicationId);
    app.setStatus(APPROVED);
    repository.save(app);
}
```

Cocok jika:

```text
- use case sederhana,
- invariant sedikit,
- risiko rendah,
- perubahan jarang.
```

### 17.2 Stage 2: Encapsulated Behavior

```java
app.approve(officer, clock);
```

Cocok jika:

```text
- domain invariant mulai penting,
- mutation perlu dikontrol.
```

### 17.3 Stage 3: Policy/Specification

```java
approvalPolicy.validate(app, officer);
app.approve(officer, clock);
```

Cocok jika:

```text
- rule kompleks,
- rule berubah,
- perlu test granular,
- perlu explanation.
```

### 17.4 Stage 4: State Machine

```java
caseLifecycle.transition(app, Action.APPROVE, context);
```

Cocok jika:

```text
- banyak state,
- transisi diatur ketat,
- audit penting,
- illegal transition harus eksplisit.
```

### 17.5 Stage 5: Workflow/Process Orchestration

```text
Human task + timer + escalation + integration + compensation
```

Cocok jika:

```text
- long-running process,
- human approval,
- SLA,
- escalation,
- external events,
- process visibility.
```

Design maturity berarti memilih stage yang sesuai dengan real complexity, bukan selalu stage paling canggih.

---

## 18. Pattern Misuse: Penyebab Umum

### 18.1 Resume-Driven Design

Engineer memakai pattern agar terlihat advanced.

Tanda-tanda:

```text
- banyak interface satu implementasi tanpa alasan,
- banyak abstract class tanpa variasi,
- factory untuk constructor sederhana,
- event untuk call yang sebenarnya synchronous,
- microservice untuk module yang belum punya ownership/data boundary.
```

### 18.2 Framework-Driven Design

Desain mengikuti bentuk framework, bukan domain.

Contoh:

```text
Controller → Service → Repository untuk semua use case,
meskipun ada use case yang butuh command, policy, state, atau workflow.
```

Layer template bisa berguna, tetapi tidak boleh menggantikan pemikiran domain.

### 18.3 Pattern Cargo Cult

Menerapkan bentuk luar pattern tanpa memahami force.

Contoh Adapter palsu:

```java
class ExternalUserAdapter {
    ExternalUserDto getUser(String id) {
        return externalClient.getUser(id);
    }
}
```

Ini hanya pass-through. Domain masih menerima `ExternalUserDto`. Boundary tidak dilindungi.

Adapter yang lebih benar:

```java
class ExternalUserGateway {
    UserProfile findUserProfile(UserId id) {
        ExternalUserDto dto = externalClient.getUser(id.value());
        return mapper.toUserProfile(dto);
    }
}
```

### 18.4 Premature Generalization

Membuat abstraction untuk masa depan yang belum jelas.

```java
interface AbstractUniversalProcessor<TRequest, TResponse, TContext> {
    TResponse process(TRequest request, TContext context);
}
```

Pertanyaannya:

```text
Apa variasi nyata yang sudah diketahui?
Apa invariant yang dilindungi?
Apa yang akan lebih mudah berubah?
Apa yang justru menjadi lebih sulit?
```

### 18.5 Local Optimization, Global Damage

Sebuah pattern bisa memudahkan satu class tetapi merusak sistem.

Contoh:

```text
Service Locator membuat caller mudah mendapatkan dependency.
Tetapi dependency graph menjadi tersembunyi, test sulit, dan runtime failure meningkat.
```

---

## 19. Pattern Review Checklist

Gunakan checklist ini saat design review.

### 19.1 Problem Clarity

```text
[ ] Masalah spesifik sudah jelas?
[ ] Area perubahan sudah diketahui?
[ ] Invariant utama sudah ditulis?
[ ] Boundary yang ingin dilindungi sudah jelas?
[ ] Risiko utama sudah eksplisit?
```

### 19.2 Pattern Fit

```text
[ ] Pattern menjawab force dominan?
[ ] Pattern tidak hanya dipilih karena familiar?
[ ] Ada alternatif lebih sederhana?
[ ] Ada alternatif lebih eksplisit?
[ ] Ada alasan kenapa tidak memakai alternatif itu?
```

### 19.3 Consequence

```text
[ ] Biaya cognitive load diterima?
[ ] Biaya runtime diterima?
[ ] Biaya testing diterima?
[ ] Biaya operasional diterima?
[ ] Failure mode dipahami?
```

### 19.4 Java Fit

```text
[ ] Apakah Java 8 lambda cukup?
[ ] Apakah record cocok sebagai data carrier?
[ ] Apakah sealed hierarchy lebih tepat daripada inheritance terbuka?
[ ] Apakah switch expression/pattern matching membuat solusi lebih sederhana?
[ ] Apakah virtual threads mengubah concurrency choice?
[ ] Apakah ScopedValue lebih tepat daripada ThreadLocal?
```

### 19.5 Evolution

```text
[ ] Jika requirement bertambah, extension point-nya jelas?
[ ] Jika requirement tidak bertambah, apakah design terlalu berat?
[ ] Jika pattern gagal, refactoring path-nya apa?
[ ] Apakah desain bisa dimigrasikan bertahap?
[ ] Apakah tests cukup melindungi refactoring?
```

---

## 20. Pattern Decision Record

Untuk keputusan desain penting, biasakan membuat Pattern Decision Record.

Ini lebih ringan dari Architecture Decision Record, tetapi fokus pada pattern-level choice.

### 20.1 Template

```markdown
# Pattern Decision Record: <Judul>

## Context
Situasi dan boundary tempat masalah muncul.

## Problem
Masalah spesifik yang ingin diselesaikan.

## Forces
- Force 1
- Force 2
- Force 3

## Decision
Pattern/struktur yang dipilih.

## Alternatives Considered
- Option A: alasan ditolak
- Option B: alasan ditolak

## Consequences
Positive:
- ...

Negative:
- ...

## Failure Modes
- ...

## Refactoring Path
Jika asumsi berubah, langkah migrasi yang aman.

## Review Trigger
Kapan keputusan ini perlu dievaluasi ulang.
```

### 20.2 Contoh PDR

```markdown
# Pattern Decision Record: Use Policy Object for Application Eligibility

## Context
Application submission memiliki eligibility rule yang berbeda untuk new application, renewal, dan appeal.
Rule sering berubah berdasarkan regulatory update.

## Problem
Eligibility logic saat ini berada dalam satu service method besar sehingga perubahan rule renewal berisiko merusak appeal.

## Forces
- Rule berubah independen per application type.
- Decision harus bisa dijelaskan ke user dan auditor.
- Tim belum membutuhkan external rule engine.
- Test harus granular per rule.
- Performance harus tetap sederhana tanpa runtime scripting.

## Decision
Gunakan Policy Object per application type.
Setiap policy menghasilkan EligibilityDecision berisi result, reason code, dan explanation.

## Alternatives Considered
- If-else di service: lebih sederhana tetapi sulit dites dan rawan regressions.
- Rule engine: terlalu berat untuk tahap ini.
- Database-driven rules: belum ada kebutuhan non-developer rule editing.

## Consequences
Positive:
- Rule terisolasi.
- Test lebih granular.
- Decision explanation eksplisit.

Negative:
- Class bertambah.
- Policy selection perlu dikelola.
- Common rule harus dihindari dari duplikasi berlebihan.

## Failure Modes
- Policy terlalu banyak dan tidak punya grouping.
- Priority conflict jika lebih dari satu policy match.
- Shared helper berubah menjadi god utility.

## Refactoring Path
Jika rule semakin banyak dan perlu konfigurasi non-developer, policy object bisa menjadi backend dari rule table atau rule engine.

## Review Trigger
Evaluasi ulang jika jumlah policy > 20 atau rule mulai berubah tanpa deployment.
```

---

## 21. Worked Example: Dari Procedural Service ke Pattern-Aware Design

### 21.1 Starting Point

```java
public class CaseService {

    public void submit(Long caseId, Long officerId) {
        Case c = caseRepository.findById(caseId)
                .orElseThrow(() -> new NotFoundException("Case not found"));

        Officer officer = officerRepository.findById(officerId)
                .orElseThrow(() -> new NotFoundException("Officer not found"));

        if (!officer.hasRole("CASE_OFFICER")) {
            throw new ForbiddenException("Not allowed");
        }

        if (c.getStatus() != CaseStatus.DRAFT) {
            throw new BadRequestException("Only draft case can be submitted");
        }

        if (c.getDocuments().isEmpty()) {
            throw new BadRequestException("Document required");
        }

        if (c.getRespondentEmail() == null) {
            throw new BadRequestException("Respondent email required");
        }

        c.setStatus(CaseStatus.SUBMITTED);
        c.setSubmittedBy(officerId);
        c.setSubmittedAt(LocalDateTime.now());

        caseRepository.save(c);

        auditRepository.save(new AuditLog("Case submitted: " + caseId));

        emailClient.send(c.getRespondentEmail(), "Case submitted", "...");

        eventPublisher.publish(new CaseSubmittedEvent(caseId));
    }
}
```

Kode ini mungkin bekerja. Tetapi beberapa concern bercampur:

```text
- loading data,
- authorization,
- state transition,
- validation,
- mutation,
- audit,
- email integration,
- event publication,
- time source,
- exception semantics.
```

### 21.2 Jangan Langsung Over-Refactor

Kesalahan umum adalah langsung membuat banyak pattern.

```text
CaseSubmitCommand
CaseSubmitCommandValidator
CaseSubmitCommandHandler
CaseSubmitFacade
CaseSubmitFactory
CaseSubmitStrategy
CaseSubmitProcessor
CaseSubmitManager
CaseSubmitWorkflow
```

Ini belum tentu benar.

Pertama, identifikasi force.

### 21.3 Force Analysis

```text
Invariant:
- hanya DRAFT yang boleh SUBMITTED
- document wajib ada
- respondent email wajib ada
- officer harus authorized
- submit harus menghasilkan audit trail

Volatility:
- validation rule bisa bertambah
- authorization rule bisa berubah
- notification mungkin berubah
- state lifecycle mungkin bertambah

Boundary:
- domain tidak boleh tahu email client
- domain tidak boleh tahu HTTP exception
- audit harus structured, bukan string bebas

Failure:
- email gagal setelah case saved
- event publish gagal setelah commit
- audit gagal
- duplicate submit
```

### 21.4 First Refactoring: Command Boundary

```java
public record SubmitCaseCommand(
        CaseId caseId,
        OfficerId officerId
) { }
```

Command memberi use case boundary.

### 21.5 Application Service / Handler

```java
public final class SubmitCaseHandler {
    private final CaseRepository caseRepository;
    private final OfficerRepository officerRepository;
    private final SubmitCasePolicy submitCasePolicy;
    private final AuditRecorder auditRecorder;
    private final DomainEventPublisher eventPublisher;
    private final Clock clock;

    public SubmitCaseResult handle(SubmitCaseCommand command) {
        Case c = caseRepository.get(command.caseId());
        Officer officer = officerRepository.get(command.officerId());

        submitCasePolicy.check(c, officer);

        CaseSubmitted submitted = c.submit(officer.id(), clock.instant());

        caseRepository.save(c);
        auditRecorder.record(submitted.toAuditEvent());
        eventPublisher.publish(submitted);

        return new SubmitCaseResult(c.id(), c.status());
    }
}
```

Perhatikan: kita belum membuat pattern terlalu banyak. Kita baru memperjelas boundary.

### 21.6 Policy Object

```java
public final class SubmitCasePolicy {

    public void check(Case c, Officer officer) {
        if (!officer.canSubmitCase()) {
            throw DomainError.forbidden("OFFICER_NOT_ALLOWED");
        }
        if (!c.isDraft()) {
            throw DomainError.invalidTransition("ONLY_DRAFT_CAN_BE_SUBMITTED");
        }
        if (!c.hasRequiredDocuments()) {
            throw DomainError.validation("DOCUMENT_REQUIRED");
        }
        if (!c.hasRespondentEmail()) {
            throw DomainError.validation("RESPONDENT_EMAIL_REQUIRED");
        }
    }
}
```

Policy Object cocok karena rule punya domain meaning dan perlu test.

### 21.7 Domain Behavior

```java
public final class Case {
    private CaseStatus status;
    private OfficerId submittedBy;
    private Instant submittedAt;

    public CaseSubmitted submit(OfficerId officerId, Instant now) {
        if (status != CaseStatus.DRAFT) {
            throw DomainError.invalidTransition("ONLY_DRAFT_CAN_BE_SUBMITTED");
        }
        this.status = CaseStatus.SUBMITTED;
        this.submittedBy = officerId;
        this.submittedAt = now;
        return new CaseSubmitted(id, officerId, now);
    }
}
```

Invariant state transition tidak lagi hanya berada di service.

### 21.8 Audit Event

```java
public record CaseSubmitted(
        CaseId caseId,
        OfficerId submittedBy,
        Instant submittedAt
) implements DomainEvent {

    public AuditEvent toAuditEvent() {
        return new AuditEvent(
                "CASE_SUBMITTED",
                caseId.value(),
                submittedBy.value(),
                submittedAt
        );
    }
}
```

Audit tidak lagi free-text.

### 21.9 Pattern yang Digunakan

```text
Command             : SubmitCaseCommand
Application Service : SubmitCaseHandler
Policy Object       : SubmitCasePolicy
Domain Method       : Case.submit()
Domain Event        : CaseSubmitted
Audit Event         : structured audit record
Repository          : CaseRepository
```

Tidak semua pattern GoF. Banyak pattern enterprise lebih penting di sistem nyata.

### 21.10 Apa yang Belum Diselesaikan?

Masih ada pertanyaan:

```text
Apakah event publish harus outbox?
Apakah audit harus dalam transaction yang sama?
Apakah email harus synchronous atau async listener?
Apakah duplicate submit perlu idempotency key?
Apakah state transition perlu state machine formal?
```

Pattern-aware design tidak berarti menyelesaikan semua sekaligus. Ia membuat next decision lebih jelas.

---

## 22. Pattern dan Testing

Pattern yang baik biasanya memperbaiki testability.

Tetapi pattern juga bisa memperburuk testing jika membuat flow terlalu tersebar.

### 22.1 Testing Direct Procedural Service

Jika semua logic ada di satu service, test cenderung berat:

```text
- setup repository
- setup officer
- setup case
- mock email
- mock audit
- mock event
- verify status
- verify exception
- verify side effect
```

Test menjadi integration-style walaupun hanya ingin menguji rule kecil.

### 22.2 Testing Policy Object

```java
@Test
void draftCaseWithDocumentsCanBeSubmittedByAuthorizedOfficer() {
    var policy = new SubmitCasePolicy();
    var c = CaseFixture.draftWithRequiredDocuments();
    var officer = OfficerFixture.caseOfficer();

    assertDoesNotThrow(() -> policy.check(c, officer));
}
```

Test lebih fokus.

### 22.3 Testing State Transition

```java
@Test
void approvedCaseCannotReturnToDraft() {
    var c = CaseFixture.approved();

    assertThrows(InvalidTransition.class,
            () -> c.transitionToDraft());
}
```

### 22.4 Testing Adapter

Adapter test fokus pada mapping dan external error normalization.

```text
Given external 404 → internal NotFound
Given external timeout → retryable ExternalDependencyFailure
Given malformed response → non-retryable IntegrationContractFailure
```

### 22.5 Testing Pattern Composition

Untuk flow lengkap, gunakan test lebih sedikit tetapi bermakna:

```text
submit case success emits audit and event
submit invalid case returns validation error
submit unauthorized case does not mutate case
submit duplicate command is idempotent
```

Pattern seharusnya membuat test pyramid lebih sehat, bukan penuh mock fragile.

---

## 23. Pattern dan Observability

Design pattern juga harus dilihat dari debugging dan production operation.

### 23.1 Hidden Control Flow Problem

Pattern seperti Observer, Interceptor, AOP, Event Listener, dan Proxy sering menyembunyikan control flow.

Contoh:

```text
Method dipanggil → annotation intercept → transaction open → security check → retry wrapper → event listener → async handler
```

Jika tidak ada observability, incident menjadi sulit.

### 23.2 Pattern Harus Punya Diagnostic Surface

Untuk pattern penting, sediakan diagnostic surface:

```text
Strategy selected: strategy_name
Policy decision: rule_id, result, reason
State transition: from, action, to, actor
Adapter call: external_system, operation, latency, status
Circuit breaker: state, failure_rate, open_duration
Outbox: pending_count, oldest_age, retry_count
```

### 23.3 Anti-Pattern: Log Everything

Logging semua hal bukan observability.

Observability yang baik menjawab pertanyaan:

```text
Apa yang terjadi?
Mengapa terjadi?
Request/case/user mana yang terdampak?
Dependency mana yang gagal?
Apakah failure retryable?
Apakah data sudah committed?
Apakah event sudah published?
```

Pattern harus membantu menjawab pertanyaan itu.

---

## 24. Pattern dan Team Communication

Pattern berguna jika meningkatkan komunikasi tim.

### 24.1 Code Review Tanpa Pattern Language

```text
Kenapa bikin class baru?
Kenapa tidak langsung panggil API?
Kenapa tidak taruh di service saja?
Kenapa butuh event?
Kenapa butuh mapper?
```

### 24.2 Code Review Dengan Pattern Language

```text
Adapter ini masih bocor karena external DTO dipakai di application service.
Policy ini punya dua alasan perubahan: authorization dan eligibility. Sebaiknya dipisah.
State transition ini masih bisa di-bypass lewat setter public.
Event ini terlihat seperti synchronous RPC tersembunyi.
Repository ini terlalu generic sehingga query semantics hilang.
```

Komentar menjadi lebih tajam dan actionable.

### 24.3 Pattern sebagai Mentoring Tool

Untuk anggota tim junior/mid-level, pattern membantu menjelaskan desain tanpa harus mengulang semua reasoning dari nol.

Tetapi jangan hanya berkata:

```text
“Pakai Strategy.”
```

Lebih baik:

```text
“Di sini ada variasi rule yang berubah independen. Kalau tetap di if-else service, setiap perubahan renewal bisa menyentuh appeal. Kita ekstrak Policy/Strategy per flow supaya rule bisa dites dan diubah terpisah.”
```

Itu mengajarkan judgement, bukan hafalan.

---

## 25. Design Pattern dalam Enterprise Java: Prinsip Efisiensi Belajar

Karena kamu sudah mempelajari banyak seri Java sebelumnya, seri ini tidak akan mengulang detail teknis seperti:

```text
- cara kerja collection,
- JDBC/HikariCP detail,
- JPA mapping dasar,
- Spring Boot dasar,
- Jakarta EE dasar,
- Kafka/RabbitMQ/Redis dasar,
- logging framework dasar,
- JVM/GC detail,
- HTTP client detail.
```

Kita akan memakai semua itu sebagai fondasi.

Contoh:

```text
Saat membahas Repository, kita tidak mengulang JPA dasar.
Kita membahas kapan Repository menjadi leaky abstraction.

Saat membahas Observer/Event, kita tidak mengulang Kafka/RabbitMQ dasar.
Kita membahas event semantics, idempotency, ordering, dan side-effect boundary.

Saat membahas Decorator/Proxy, kita tidak mengulang Spring AOP dasar.
Kita membahas invisibility, debugging, ordering, dan transaction/security interaction.

Saat membahas State Machine, kita tidak mengulang enum dasar.
Kita membahas lifecycle invariant, transition guard, auditability, dan regulatory defensibility.
```

---

## 26. Core Mental Models

### 26.1 Pattern = Decision Shape

```text
Pattern adalah bentuk keputusan desain yang sudah pernah terbukti berguna dalam konteks tertentu.
```

Jangan tanya:

```text
Pattern apa yang keren?
```

Tanya:

```text
Keputusan desain apa yang harus distabilkan?
```

### 26.2 Abstraction = Compression + Contract

Abstraction bukan hanya menyembunyikan detail. Abstraction harus memberi contract yang lebih stabil daripada detail di bawahnya.

Jika abstraction berubah setiap kali implementation berubah, abstraction itu leaky atau palsu.

### 26.3 Boundary = Place Where Translation Happens

Boundary bukan sekadar package. Boundary adalah tempat model diterjemahkan.

```text
HTTP JSON → command
External DTO → internal value object
Database row → domain aggregate
Domain event → integration event
Exception → API problem response
```

Jika tidak ada translation, boundary mungkin hanya nama folder.

### 26.4 Invariant > Pattern

Pattern hanya berguna jika menjaga invariant atau mengisolasi perubahan.

Jika pattern tidak menjaga apa pun, ia hanya ceremony.

### 26.5 Simplicity is Contextual

Kode paling sederhana hari ini bisa menjadi paling mahal bulan depan jika mengabaikan force yang sudah jelas.

Tetapi pattern paling fleksibel hari ini bisa menjadi paling mahal jika future change tidak pernah datang.

Simplicity bukan berarti sedikit class. Simplicity berarti mental model yang paling kecil untuk problem nyata.

### 26.6 Explicitness is a Tool

Tidak semua hal harus eksplisit. Tetapi hal penting harus eksplisit.

Eksplisitkan:

```text
- state transition,
- authorization decision,
- domain policy,
- integration boundary,
- transaction boundary,
- retry/idempotency behavior,
- audit event,
- error semantics.
```

Boleh implisitkan hal teknis kecil yang stabil dan tidak berisiko.

### 26.7 Every Pattern Has a Degenerate Form

Setiap pattern bisa membusuk.

```text
Strategy → strategy explosion
Factory → hidden dependency maze
Adapter → pass-through wrapper
Observer → event soup
State → transition table hell
Repository → generic CRUD dumping ground
Facade → god facade
Decorator → onion debugging hell
```

Belajar pattern berarti juga belajar bentuk busuknya.

---

## 27. Practical Heuristics

### 27.1 Kapan Memakai Pattern Formal?

Gunakan pattern formal jika minimal beberapa kondisi ini benar:

```text
[ ] Ada variasi behavior yang jelas.
[ ] Ada boundary yang perlu dilindungi.
[ ] Ada invariant penting.
[ ] Ada rule yang sering berubah.
[ ] Ada dependency external yang tidak stabil.
[ ] Ada lifecycle/state transition penting.
[ ] Ada kebutuhan test granular.
[ ] Ada kebutuhan audit/traceability.
[ ] Ada kebutuhan extension yang sudah nyata, bukan spekulatif.
```

### 27.2 Kapan Tidak Memakai Pattern Formal?

Jangan pakai pattern formal jika:

```text
[ ] Problem masih sangat sederhana.
[ ] Variasi belum nyata.
[ ] Abstraction hanya dibuat untuk “best practice”.
[ ] Nama pattern lebih jelas daripada problemnya.
[ ] Tim akan kesulitan memahami indirection-nya.
[ ] Pattern tidak menjaga invariant apa pun.
[ ] Pattern tidak mengurangi risiko perubahan.
```

### 27.3 Rule of Three

Satu kasus:

```text
Jangan buru-buru abstraction.
```

Dua kasus:

```text
Perhatikan kemiripan, tetapi masih bisa eksplisit.
```

Tiga kasus:

```text
Mulai cari pattern variasi yang stabil.
```

Rule ini bukan hukum, tetapi heuristic.

### 27.4 Prefer Named Domain Concept Over Generic Pattern Name

Buruk:

```java
class ApplicationStrategy { }
class CaseProcessor { }
class RuleManager { }
```

Lebih baik:

```java
class RenewalEligibilityPolicy { }
class AppealSubmissionGuard { }
class EnforcementTransitionRules { }
```

Pattern boleh menjadi struktur internal, tetapi nama domain membuat intent lebih jelas.

### 27.5 Keep Pattern Surface Small

Jangan mengekspos semua detail pattern ke seluruh codebase.

Contoh:

```text
Application service boleh tahu Policy interface.
Controller tidak perlu tahu concrete policy.
Domain tidak perlu tahu DI container.
External adapter tidak perlu bocor ke domain.
```

---

## 28. Common Misconceptions

### Misconception 1: “Design Pattern Membuat Kode Selalu Lebih Baik”

Tidak. Pattern bisa memperbaiki desain jika problemnya cocok. Jika tidak, pattern menambah indirection.

### Misconception 2: “Pattern Modern Sudah Menggantikan GoF”

Tidak sepenuhnya. GoF tetap relevan, tetapi implementasinya berubah karena Java modern.

Strategy bisa berupa lambda. Visitor bisa digantikan sealed + switch untuk beberapa kasus. Singleton bisa digantikan DI scope. Tetapi force dasarnya tetap ada.

### Misconception 3: “Kalau Pakai Spring, Pattern Tidak Perlu Dipikirkan”

Framework tidak menghapus desain. Framework hanya memberi building blocks.

Spring bisa memudahkan DI, AOP, transaction, event, repository, dan configuration. Tetapi ia tidak otomatis menentukan responsibility, invariant, boundary, dan failure semantics.

### Misconception 4: “Interface Selalu Bagus”

Interface bagus jika ada contract stabil atau variasi nyata.

Interface buruk jika hanya menjadi ceremony:

```text
UserService interface + UserServiceImpl satu-satunya implementasi,
tidak ada test fake,
tidak ada module boundary,
tidak ada variasi runtime,
tidak ada public API reason.
```

### Misconception 5: “Pattern Sama dengan Layering”

Layering adalah satu architecture style. Pattern bisa muncul di dalam atau lintas layer.

Layer tanpa responsibility jelas hanya menghasilkan folder rapi dengan coupling buruk.

### Misconception 6: “Anti-Pattern Berarti Orang yang Menulis Tidak Kompeten”

Tidak selalu. Anti-pattern sering muncul dari tekanan deadline, requirement bertambah, tim berganti, framework constraint, atau kurangnya refactoring window.

Tujuan mengenali anti-pattern bukan menyalahkan, tetapi menemukan path perbaikan.

---

## 29. Design Review Questions untuk Part 0

Gunakan pertanyaan ini saat membaca kode atau mendesain fitur.

### 29.1 Context

```text
Di boundary mana problem ini terjadi?
Apakah ini domain, application, integration, persistence, security, atau infrastructure concern?
```

### 29.2 Change

```text
Apa yang paling mungkin berubah?
Apa yang hampir pasti stabil?
Apa yang berubah bersama?
Apa yang berubah independen?
```

### 29.3 Ownership

```text
Class mana yang seharusnya memiliki keputusan ini?
Apakah keputusan ini domain-level atau application-level?
Apakah external system terlalu memengaruhi internal model?
```

### 29.4 Invariant

```text
Apa yang tidak boleh rusak?
Apakah invariant dikontrol oleh compiler, constructor, method, state machine, database constraint, atau convention?
```

### 29.5 Failure

```text
Bagaimana desain ini gagal?
Apakah failure terlihat?
Apakah failure bisa diretry?
Apakah failure meninggalkan partial side effect?
```

### 29.6 Simplicity

```text
Apakah abstraction ini membayar biaya dirinya?
Apakah kode langsung lebih jelas?
Apakah pattern ini menyelesaikan problem nyata atau hanya membuat desain terlihat sophisticated?
```

### 29.7 Evolution

```text
Jika requirement bertambah dua kali lipat, bagian mana yang pecah?
Jika requirement ternyata tidak bertambah, bagian mana yang terasa berlebihan?
Apa refactoring path paling aman?
```

---

## 30. Latihan Berpikir

### Exercise 1: Identify Force

Kode:

```java
public BigDecimal calculateFee(Application app) {
    if (app.getType() == ApplicationType.NEW) {
        return new BigDecimal("100.00");
    }
    if (app.getType() == ApplicationType.RENEWAL) {
        return new BigDecimal("80.00");
    }
    if (app.getType() == ApplicationType.APPEAL) {
        return BigDecimal.ZERO;
    }
    throw new IllegalArgumentException("Unsupported type");
}
```

Pertanyaan:

```text
Apakah ini butuh Strategy?
Apa informasi yang belum cukup?
```

Jawaban yang matang:

```text
Belum tentu.
Jika fee hanya mapping sederhana dan stabil, switch expression cukup.
Jika fee punya rule kompleks, discount, exemption, effective date, regulatory basis, dan audit explanation, maka Policy/Strategy lebih cocok.
```

### Exercise 2: Detect Boundary Leak

Kode:

```java
public void validateAddress(OneMapResponse response) {
    if (response.getResults().isEmpty()) {
        throw new BadRequestException("Invalid postal code");
    }
}
```

Pertanyaan:

```text
Apa smell-nya?
```

Kemungkinan jawaban:

```text
External DTO masuk ke domain/application validation. Seharusnya response diterjemahkan di adapter/gateway menjadi internal AddressLookupResult atau Address value object.
```

### Exercise 3: Pattern or Anti-Pattern?

Kode:

```java
public interface CaseRepository<T, ID> {
    T save(T entity);
    Optional<T> findById(ID id);
    List<T> findAll();
    void delete(T entity);
    List<T> findByQuery(String queryName, Map<String, Object> params);
}
```

Pertanyaan:

```text
Pattern apa ini? Risiko apa?
```

Jawaban:

```text
Ini mencoba menjadi generic repository. Bisa berguna untuk CRUD sederhana, tetapi berisiko menjadi leaky abstraction dan query dumping ground. Domain-specific repository mungkin lebih jelas untuk aggregate penting.
```

### Exercise 4: Hidden State Machine

Kode:

```java
if (status == DRAFT && action == SUBMIT) status = SUBMITTED;
else if (status == SUBMITTED && action == APPROVE) status = APPROVED;
else if (status == SUBMITTED && action == REJECT) status = REJECTED;
else if (status == APPROVED && action == SUSPEND) status = SUSPENDED;
else throw new InvalidActionException();
```

Pertanyaan:

```text
Apa pattern yang mulai muncul?
```

Jawaban:

```text
State transition model. Bisa tetap sederhana dengan transition table, atau berkembang menjadi State pattern/State Machine jika guard/action/audit/transisi makin kompleks.
```

---

## 31. Vocabulary Penting

| Istilah | Makna Praktis |
|---|---|
| Pattern | Solusi desain berulang dalam konteks masalah berulang |
| Anti-pattern | Solusi yang tampak benar tetapi menghasilkan konsekuensi buruk berulang |
| Force | Tekanan/constraint desain yang saling tarik-menarik |
| Consequence | Dampak positif/negatif dari keputusan desain |
| Invariant | Kondisi yang harus selalu benar |
| Boundary | Garis pemisah antar concern/model/lifecycle |
| Indirection | Perantara tambahan dalam call/model/dependency graph |
| Abstraction | Contract stabil yang menyembunyikan detail tertentu |
| Leaky abstraction | Abstraction yang gagal menyembunyikan detail penting bawahnya |
| Coupling | Tingkat ketergantungan antar bagian |
| Cohesion | Tingkat kesatuan responsibility dalam satu module/class |
| Volatility | Seberapa sering bagian berubah |
| Extension point | Titik yang sengaja dibuat untuk variasi/perluasan |
| Refactoring path | Urutan aman menuju desain lebih baik |
| Design smell | Sinyal adanya masalah responsibility/collaboration |
| Architecture smell | Sinyal adanya masalah boundary sistem/module |

---

## 32. Ringkasan

Bagian ini adalah fondasi seluruh seri.

Inti yang perlu diingat:

```text
1. Pattern bukan template kode.
2. Pattern adalah respons terhadap design force.
3. Pattern harus dinilai dari consequence.
4. Pattern yang salah konteks berubah menjadi anti-pattern.
5. Java modern mengubah implementasi pattern, tetapi tidak menghapus force dasarnya.
6. Pattern terbaik memperjelas boundary, invariant, dan ownership.
7. Senior engineer memilih pattern berdasarkan problem, bukan berdasarkan katalog.
8. Top engineer tahu kapan tidak memakai pattern.
```

Kalimat paling penting:

```text
Jangan bertanya “pattern apa yang bisa saya pakai?”
Bertanyalah “force apa yang sedang bertabrakan, invariant apa yang harus dijaga, dan desain paling sederhana apa yang cukup kuat untuk menahannya?”
```

---

## 33. Referensi

Referensi konseptual yang relevan untuk bagian ini:

1. Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides — *Design Patterns: Elements of Reusable Object-Oriented Software*. Buku ini mempopulerkan 23 GoF design patterns dan menekankan elemen seperti pattern name, problem, solution, dan consequences.
2. Hillside Group — *About Patterns*. Menjelaskan asal-usul pattern language dan gagasan bahwa pattern berada dalam relasi context, problem/forces, dan solution.
3. EuroPLoP — *Patterns*. Menjelaskan pattern sebagai relasi antara context, conflict of forces, dan solution.
4. Martin Fowler — *Code Smell* dan *Catalog of Refactorings*. Code smell dipahami sebagai indikasi permukaan dari masalah yang lebih dalam; refactoring adalah cara behavior-preserving untuk memperbaiki desain.
5. OpenJDK JEP 395 — Records.
6. OpenJDK JEP 409 — Sealed Classes.
7. OpenJDK JEP 444 — Virtual Threads.
8. OpenJDK JEP 505 — Structured Concurrency, fifth preview in JDK 25.
9. OpenJDK JEP 506 — Scoped Values finalized in JDK 25.
10. Oracle Java Language Changes by Release — ringkasan perubahan bahasa Java lintas versi.

---

## 34. Status Seri

Seri belum selesai.

Bagian ini adalah:

```text
Part 0 dari 35
```

Bagian berikutnya:

```text
01-java-8-to-25-pattern-evolution-modern-language-impact.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./01-java-8-to-25-pattern-evolution-modern-language-impact.md">Java 8 to 25 Pattern Evolution: Modern Language Impact ➡️</a>
</div>
