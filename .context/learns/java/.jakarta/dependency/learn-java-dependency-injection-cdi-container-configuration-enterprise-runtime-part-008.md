# Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-008.md`  
Java target: Java 8 hingga Java 25  
Namespace target: `javax.*` dan `jakarta.*`  
Primary focus: CDI core model, bukan sekadar annotation syntax

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membangun fondasi berikut:

1. **Part 000** — enterprise runtime mental model.
2. **Part 001** — dependency management dan runtime correctness.
3. **Part 002** — API, SPI, implementation, provider.
4. **Part 003** — migrasi `javax.*` ke `jakarta.*`.
5. **Part 004** — container model: siapa yang memiliki object.
6. **Part 005** — classloader, modules, deployment isolation.
7. **Part 006** — dependency injection fundamentals.
8. **Part 007** — Jakarta Inject / JSR-330 minimal DI vocabulary.

Sekarang kita masuk ke **CDI core**.

CDI bukan hanya `@Inject`. CDI adalah model runtime yang menjawab:

- object apa yang dianggap bean?
- berdasarkan tipe apa dependency dicocokkan?
- qualifier apa yang membedakan beberapa implementasi?
- scope apa yang menentukan umur object?
- context apa yang menyimpan object scoped?
- kapan container memberi proxy, bukan object asli?
- bagaimana container memilih dependency yang benar?
- kenapa ada error `UnsatisfiedResolutionException`, `AmbiguousResolutionException`, `ContextNotActiveException`, atau `UnproxyableResolutionException`?

Kalau part sebelumnya menjelaskan **DI sebagai konsep**, part ini menjelaskan **CDI sebagai mesin runtime type-safe contextual injection**.

---

## 1. Masalah Yang CDI Selesaikan

Tanpa CDI, aplikasi enterprise biasanya jatuh ke beberapa pola manual:

```java
public class CaseService {
    private final AuditService auditService = new AuditService();
    private final CaseRepository repository = RepositoryFactory.caseRepository();
    private final Clock clock = Clock.systemUTC();
}
```

Masalahnya:

1. `CaseService` tahu cara membuat dependency.
2. Testing sulit karena dependency hard-coded.
3. Lifecycle tidak jelas.
4. Resource cleanup tidak terstruktur.
5. Alternative implementation sulit dipilih.
6. Cross-cutting behavior seperti transaction/audit/metrics sulit disisipkan.
7. Object graph tersebar di banyak class.
8. Runtime environment tidak bisa mengatur object dengan baik.

Dengan CDI:

```java
@ApplicationScoped
public class CaseService {
    private final AuditService auditService;
    private final CaseRepository repository;
    private final Clock clock;

    @Inject
    public CaseService(
            AuditService auditService,
            CaseRepository repository,
            Clock clock
    ) {
        this.auditService = auditService;
        this.repository = repository;
        this.clock = clock;
    }
}
```

Yang berubah bukan hanya syntax. Yang berubah adalah **kepemilikan object**.

Sebelumnya:

```text
Application code owns object creation.
```

Dengan CDI:

```text
Container owns object creation, wiring, lifecycle, contextual instance, proxy, and destruction.
```

CDI memberikan bahasa runtime untuk menjelaskan object:

```text
Bean = type + qualifiers + scope + lifecycle + metadata + contextual behavior
```

---

## 2. Definisi Mental: Apa Itu CDI Bean?

Dalam CDI, **bean** bukan sekadar class.

Class adalah source code type. Bean adalah **runtime component definition** yang diketahui container.

Satu class bisa menjadi bean jika memenuhi discovery rule dan punya metadata yang membuatnya eligible.

Contoh:

```java
@ApplicationScoped
public class CaseAssignmentService {
    public AssignmentResult assign(CaseId caseId) {
        // business logic
    }
}
```

Dari perspektif Java biasa, ini hanya class.

Dari perspektif CDI, ini menjadi bean dengan informasi:

```text
Bean class      : CaseAssignmentService
Bean types      : CaseAssignmentService, Object
Qualifiers      : @Default, @Any
Scope           : @ApplicationScoped
Name            : none, unless @Named or stereotype naming exists
Lifecycle       : managed by CDI container
Proxy?          : yes, because @ApplicationScoped is normal scope
Injection ready : yes, if discovered by CDI
```

Hal penting:

> CDI tidak menginjeksi “class”. CDI menginjeksi **bean yang memenuhi type + qualifier + scope/context rule**.

---

## 3. Bean Bukan Sama Dengan Object Instance

Ini salah satu mental model paling penting.

Banyak engineer berpikir:

```text
@Inject SomeService someService;
```

berarti:

```text
Container membuat new SomeService() lalu memasukkannya ke field.
```

Itu terlalu sederhana.

Dalam CDI, ada beberapa level:

```text
Bean definition
    ↓
Contextual instance
    ↓
Client proxy/reference
    ↓
Injection point variable
```

Contoh:

```java
@Inject
CaseService caseService;
```

Yang diterima field `caseService` bisa jadi bukan object asli `CaseService`, tetapi **client proxy**.

Diagram:

```text
Your code
  |
  | calls caseService.submit(...)
  v
Injected reference / client proxy
  |
  | asks active context: "which CaseService instance applies now?"
  v
CDI context storage
  |
  | returns actual contextual instance
  v
Real CaseService object
```

Kenapa perlu begitu?

Karena untuk normal scope seperti request/session/application, instance yang benar bergantung pada context aktif.

Misalnya:

- `@RequestScoped` berbeda per HTTP request.
- `@SessionScoped` berbeda per user session.
- `@ApplicationScoped` satu untuk aplikasi, tapi tetap bisa diproxy.
- `@ConversationScoped` berbeda per conversation.

Jadi injected reference harus bisa resolve object aktual saat method dipanggil.

---

## 4. Komponen Dasar CDI Resolution

Untuk memahami CDI, ingat formula berikut:

```text
Injection Point = Required Type + Required Qualifiers
Bean Candidate  = Bean Types + Bean Qualifiers + Enabled State
Resolution      = candidates matching type and qualifier, then disambiguation
```

Contoh:

```java
@Inject
PaymentGateway gateway;
```

Injection point ini punya:

```text
Required type       : PaymentGateway
Required qualifiers : @Default
```

Kenapa `@Default`? Karena injection point tanpa qualifier custom otomatis dianggap memakai `@Default`.

Bean candidate:

```java
@ApplicationScoped
public class StripePaymentGateway implements PaymentGateway {
}
```

Bean ini punya:

```text
Bean types      : StripePaymentGateway, PaymentGateway, Object
Bean qualifiers : @Default, @Any
Scope           : @ApplicationScoped
```

Maka cocok.

Tetapi jika ada dua:

```java
@ApplicationScoped
public class StripePaymentGateway implements PaymentGateway {
}

@ApplicationScoped
public class AdyenPaymentGateway implements PaymentGateway {
}
```

Injection:

```java
@Inject
PaymentGateway gateway;
```

menjadi ambiguous:

```text
Required type       : PaymentGateway
Required qualifiers : @Default
Matching beans      : StripePaymentGateway, AdyenPaymentGateway
Result              : ambiguous dependency
```

Solusinya bukan memberi nama string sembarangan. Solusi CDI idiomatis adalah **qualifier**.

---

## 5. Bean Type: CDI Melihat Object Melalui Set Tipe

Setiap bean punya **bean types**.

Bean types adalah tipe-tipe yang dapat digunakan untuk mencocokkan injection point.

Contoh:

```java
public interface NotificationSender {
    void send(Notification notification);
}

@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send email
    }
}
```

Bean types untuk `EmailNotificationSender` biasanya mencakup:

```text
EmailNotificationSender
NotificationSender
Object
```

Maka injection berikut bisa match:

```java
@Inject
NotificationSender sender;
```

atau:

```java
@Inject
EmailNotificationSender sender;
```

Tetapi secara desain, lebih baik inject interface jika boundary-nya memang abstraksi:

```java
@Inject
NotificationSender sender;
```

Bukan karena interface selalu wajib, tetapi karena injection point seharusnya mengekspresikan **contract yang dibutuhkan consumer**, bukan class implementation yang kebetulan tersedia.

### 5.1 Bean Type Tidak Sama Dengan Java Inheritance Saja

CDI resolution memakai assignability rule. Dalam kasus generic type, ini bisa menjadi lebih kompleks.

Contoh:

```java
public interface Repository<T, ID> {
    T findById(ID id);
}

@ApplicationScoped
public class CaseRepository implements Repository<Case, CaseId> {
    public Case findById(CaseId id) { ... }
}
```

Injection:

```java
@Inject
Repository<Case, CaseId> repository;
```

harus cocok dengan bean type generic yang sesuai.

Namun injection raw type:

```java
@Inject
Repository repository;
```

adalah smell karena:

- type safety hilang;
- resolution bisa menjadi terlalu luas;
- ambiguous risk meningkat;
- error baru muncul saat runtime behavior.

### 5.2 Membatasi Bean Types Dengan `@Typed`

CDI menyediakan `@Typed` untuk membatasi tipe yang diekspos bean.

Contoh:

```java
import jakarta.enterprise.inject.Typed;

@Typed(NotificationSender.class)
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
    @Override
    public void send(Notification notification) {
        // send email
    }
}
```

Dengan ini, bean tersebut diekspos hanya sebagai `NotificationSender` dan `Object`, bukan sebagai concrete `EmailNotificationSender`.

Manfaat:

- mencegah consumer inject implementation langsung;
- mengurangi accidental coupling;
- memperjelas architectural boundary;
- mengurangi ambiguity pada type tertentu.

Tetapi jangan pakai `@Typed` berlebihan. Gunakan saat ada kebutuhan arsitektural yang jelas.

---

## 6. Qualifier: Routing Table CDI Yang Type-Safe

Jika type menjawab:

```text
Saya butuh jenis dependency apa?
```

Qualifier menjawab:

```text
Dari beberapa dependency dengan jenis yang sama, varian mana yang saya butuhkan?
```

Contoh:

```java
public interface DocumentStorage {
    StoredDocument store(Document document);
}
```

Ada beberapa implementasi:

```java
@ApplicationScoped
public class S3DocumentStorage implements DocumentStorage {
    public StoredDocument store(Document document) { ... }
}

@ApplicationScoped
public class LocalDocumentStorage implements DocumentStorage {
    public StoredDocument store(Document document) { ... }
}
```

Injection ini ambiguous:

```java
@Inject
DocumentStorage storage;
```

Karena dua bean match type `DocumentStorage` dengan qualifier default.

### 6.1 Membuat Qualifier

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, METHOD, PARAMETER })
public @interface ExternalStorage {
}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, METHOD, PARAMETER })
public @interface LocalStorage {
}
```

Apply ke bean:

```java
@ExternalStorage
@ApplicationScoped
public class S3DocumentStorage implements DocumentStorage {
    public StoredDocument store(Document document) { ... }
}

@LocalStorage
@ApplicationScoped
public class LocalDocumentStorage implements DocumentStorage {
    public StoredDocument store(Document document) { ... }
}
```

Inject:

```java
@Inject
@ExternalStorage
DocumentStorage storage;
```

Sekarang injection point punya:

```text
Required type       : DocumentStorage
Required qualifier  : @ExternalStorage
```

Yang match hanya `S3DocumentStorage`.

### 6.2 Built-in Qualifiers: `@Default` dan `@Any`

Setiap bean yang tidak punya qualifier explicit biasanya mendapat `@Default`.

Setiap bean CDI memiliki `@Any`.

Contoh:

```java
@ApplicationScoped
public class DefaultAuditSink implements AuditSink {
}
```

Bean qualifiers:

```text
@Default
@Any
```

Jika punya custom qualifier:

```java
@ExternalAudit
@ApplicationScoped
public class ExternalAuditSink implements AuditSink {
}
```

Bean qualifiers:

```text
@ExternalAudit
@Any
```

Biasanya tidak lagi punya `@Default` kecuali diberi explicit.

### 6.3 `@Any` Untuk Dynamic Lookup

`@Any` sering dipakai bersama `Instance<T>` untuk mengakses semua varian.

```java
@Inject
@Any
Instance<DocumentStorage> storages;
```

Lalu select:

```java
DocumentStorage storage = storages
        .select(new ExternalStorageLiteral())
        .get();
```

Namun hati-hati: dynamic lookup bisa berubah menjadi service locator jika dipakai sembarangan.

Gunakan untuk:

- plugin mechanism;
- runtime strategy selection;
- optional extension;
- selecting by qualifier dynamically;
- framework-level code.

Jangan gunakan untuk menyembunyikan dependency yang sebenarnya statis.

---

## 7. Scope: Umur dan Visibility Object

Scope bukan hanya “singleton atau request”. Scope adalah kontrak tentang:

1. kapan instance dibuat;
2. kapan instance dihancurkan;
3. siapa yang bisa melihat instance yang sama;
4. context apa yang menyimpan instance;
5. apakah injected reference perlu proxy;
6. apakah instance harus serializable/passivation capable;
7. apakah aman dipakai lintas thread.

CDI built-in scopes yang umum:

```text
@Dependent
@RequestScoped
@SessionScoped
@ApplicationScoped
@ConversationScoped
```

Selain itu ada pseudo-scope seperti `@Singleton` dari Jakarta Inject dan scope tambahan tergantung runtime/framework.

### 7.1 `@Dependent`

`@Dependent` adalah default jika tidak ada scope lain.

Contoh:

```java
public class CaseNumberFormatter {
    public String format(CaseNumber number) { ... }
}
```

Jika class ini discoverable sebagai bean tapi tidak punya scope, biasanya scope-nya `@Dependent`.

Mental model:

```text
Dependent object belongs to the object that receives it.
```

Jika `@Dependent` bean diinject ke `@ApplicationScoped` bean, dependent instance hidup selama owning application-scoped bean hidup.

Jika `@Dependent` bean dibuat untuk method parameter/disposer/producer, lifetime-nya mengikuti aturan dependent object tersebut.

Kapan cocok:

- stateless helper kecil;
- value-like service;
- object yang memang menjadi bagian dari owning object;
- producer-created object yang lifetime-nya ingin dekat dengan consumer.

Risiko:

- memory retention jika dependent object berat diinject ke long-lived bean;
- tidak ada client proxy normal scope;
- circular dependency lebih sulit;
- lifecycle destruction mengikuti owner, bukan context request/session.

### 7.2 `@ApplicationScoped`

Satu contextual instance per aplikasi.

```java
@ApplicationScoped
public class CasePolicyService {
}
```

Cocok untuk:

- stateless application service;
- reusable domain/application policy;
- adapter yang thread-safe;
- cache manager dengan kontrol concurrency;
- config facade immutable;
- feature flag facade.

Perlu hati-hati:

- shared across threads;
- mutable field harus thread-safe;
- jangan simpan request/user-specific state;
- jangan menyimpan entity mutable per request;
- jangan menyimpan `Principal`, request body, atau transaction-specific state.

Smell:

```java
@ApplicationScoped
public class CurrentUserHolder {
    private UserId currentUser; // dangerous
}
```

Ini salah karena `@ApplicationScoped` dibagi semua request/user.

Lebih baik:

```java
@RequestScoped
public class CurrentUserContext {
    private UserId currentUser;
}
```

atau gunakan security context resmi runtime.

### 7.3 `@RequestScoped`

Satu contextual instance per request.

```java
@RequestScoped
public class RequestCorrelation {
    private String correlationId;
}
```

Cocok untuk:

- correlation id;
- request metadata;
- current request user context;
- request-local cache;
- per-request validation context;
- request-specific policy evaluation context.

Risiko:

- context tidak aktif di background thread;
- async code bisa kehilangan context;
- jangan inject `@RequestScoped` ke thread unmanaged lalu dipakai setelah request selesai;
- jangan simpan reference request-scoped ke static/global object.

### 7.4 `@SessionScoped`

Satu contextual instance per HTTP session.

```java
@SessionScoped
public class UserSessionState implements Serializable {
    private UserId userId;
}
```

Cocok untuk:

- UI/session state;
- wizard state;
- user preference sementara;
- login/session-level state.

Risiko besar:

- memory growth per user;
- serialization/passivation requirement;
- stale state;
- cluster replication cost;
- security risk jika session fixation/session leak;
- tidak cocok untuk service stateless.

Untuk backend API stateless modern, `@SessionScoped` sering dihindari kecuali memang ada stateful UI flow.

### 7.5 `@ConversationScoped`

Conversation scope berada di antara request dan session. Cocok untuk long-running interaction, misalnya multi-step wizard.

Namun dalam aplikasi REST/stateless modern, conversation scope sering jarang dipakai. Banyak runtime cloud-native bahkan membatasi atau tidak mendukung penuh conversation scope pada mode tertentu.

Kapan relevan:

- JSF-style flow;
- multi-step form;
- stateful interaction yang tidak mau sebesar session.

Risiko:

- lifecycle sulit dipahami;
- leak jika conversation tidak diakhiri;
- kurang cocok untuk stateless API;
- butuh disiplin flow management.

---

## 8. Context: Storage Aktif Untuk Scoped Instance

Scope adalah annotation/kontrak.

Context adalah runtime storage yang aktif pada waktu tertentu.

Analogi:

```text
Scope   = jenis laci
Context = laci aktif saat ini
Bean    = barang yang disimpan dalam laci
Proxy   = kartu akses ke barang dalam laci aktif
```

Contoh request:

```text
HTTP Request A starts
    RequestContext A active
    @RequestScoped CurrentUserContext instance A created
HTTP Request A ends
    RequestContext A destroyed
    CurrentUserContext instance A destroyed
```

Request lain:

```text
HTTP Request B starts
    RequestContext B active
    @RequestScoped CurrentUserContext instance B created
```

Injection point sama:

```java
@Inject
CurrentUserContext currentUser;
```

Tapi object aktual berbeda tergantung request aktif.

### 8.1 `ContextNotActiveException`

Jika code mencoba memakai `@RequestScoped` bean saat request context tidak aktif, runtime bisa melempar context-not-active error.

Contoh skenario:

```java
@ApplicationScoped
public class ReportJob {
    @Inject
    CurrentUserContext currentUser;

    public void runNightlyJob() {
        currentUser.userId(); // request context may not be active
    }
}
```

Masalahnya bukan injection-nya. Injection bisa berhasil karena proxy bisa diinjeksi. Masalah muncul ketika proxy dipakai dan tidak ada request context aktif.

Mental model:

```text
Injection time success does not guarantee invocation time context availability.
```

Solusi desain:

- jangan pakai request user context di scheduled job;
- pass explicit system actor;
- aktifkan request context secara sadar jika runtime mendukung dan memang tepat;
- pisahkan request-specific service dari background service.

---

## 9. Normal Scope vs Pseudo Scope

CDI membedakan normal scope dan pseudo-scope.

Normal scope biasanya menggunakan client proxy.

Contoh normal scope:

```text
@RequestScoped
@SessionScoped
@ApplicationScoped
@ConversationScoped
```

Pseudo-scope:

```text
@Dependent
@Singleton (Jakarta Inject pseudo-scope in CDI context)
```

### 9.1 Normal Scope

Normal scoped bean tidak langsung diinjeksi sebagai instance asli. Yang diinjeksi adalah contextual reference/client proxy.

Kenapa?

Karena object aktual bergantung pada context.

```text
Injected proxy -> active context -> actual instance
```

Manfaat:

- request/session-specific resolution;
- lazy creation;
- circular dependency tertentu bisa diatasi;
- passivation proxy support;
- interception/decorator integration lebih konsisten.

Konsekuensi:

- class harus proxyable;
- final class/final method bisa bermasalah;
- equals/hashCode identity bisa tricky;
- self-invocation tetap tidak melewati proxy.

### 9.2 Pseudo-Scope

Pseudo-scoped bean biasanya tidak memakai client proxy dengan semantics normal context.

`@Dependent` mengikuti owner.

`@Singleton` dari Jakarta Inject sering berarti satu instance, tetapi bukan normal scope CDI seperti `@ApplicationScoped`.

Perbedaan penting:

```text
@ApplicationScoped = normal scope, contextual, proxied
@Singleton         = pseudo-scope style, one instance but not same normal context semantics
```

Dalam banyak aplikasi, untuk service application-wide CDI, prefer:

```java
@ApplicationScoped
public class CaseService {
}
```

daripada:

```java
@Singleton
public class CaseService {
}
```

kecuali ada alasan spesifik.

---

## 10. Client Proxy: Referensi Yang Terlihat Seperti Object Asli

Client proxy adalah object yang diinjeksi untuk mewakili contextual instance.

Contoh:

```java
@ApplicationScoped
public class CaseService {
    public void submit() { ... }
}

@RequestScoped
public class CaseResource {
    @Inject
    CaseService caseService;
}
```

`caseService` bisa jadi proxy.

Saat dipanggil:

```java
caseService.submit();
```

Proxy melakukan kira-kira:

```text
1. determine active context for @ApplicationScoped
2. obtain actual CaseService contextual instance
3. invoke submit() on actual instance
```

### 10.1 Kenapa Proxy Penting Untuk Mental Model?

Karena beberapa bug runtime terlihat aneh jika kita lupa proxy.

Contoh:

```java
System.out.println(caseService.getClass());
```

Output bisa bukan:

```text
class com.example.CaseService
```

melainkan class generated proxy.

Jangan membuat logic berdasarkan `getClass()` dari injected bean.

Lebih aman:

```java
caseService instanceof CaseService
```

pun bisa tergantung proxy mechanics dan provider.

Yang lebih penting: desain jangan bergantung pada concrete runtime class dari injected bean.

### 10.2 Final Class Problem

Normal scoped bean perlu proxyable.

Bad:

```java
@ApplicationScoped
public final class CaseService {
    public void submit() { ... }
}
```

Final class sulit diproxy dengan subclass-based proxy.

Bad:

```java
@ApplicationScoped
public class CaseService {
    public final void submit() { ... }
}
```

Final method tidak bisa diintercept/override oleh proxy tertentu.

Rule praktis:

```text
Managed service class should not be final unless runtime explicitly supports it and you know the consequence.
Business methods intended for interception should not be final.
```

### 10.3 Self-Invocation Problem

```java
@ApplicationScoped
public class CaseService {

    @Audited
    public void submit(CaseCommand command) {
        validate(command);
    }

    @Audited
    public void validate(CaseCommand command) {
        // validation
    }
}
```

Jika external caller memanggil:

```java
caseService.submit(command);
```

Call masuk melalui proxy, interceptor `@Audited` untuk `submit` bisa jalan.

Tapi call internal:

```java
validate(command);
```

dari method dalam class yang sama tidak melewati proxy.

Maka interceptor pada `validate` bisa tidak berjalan.

Mental model:

```text
Interception happens at proxy boundary, not at every Java method call.
```

Solusi:

- pindahkan method intercepted ke bean lain;
- jangan desain business invariant penting bergantung pada self-invocation interception;
- gunakan explicit internal method call jika behavior memang internal;
- untuk transaction boundary, letakkan boundary pada externally-invoked application service method.

---

## 11. Injection Point: Kontrak Consumer

Injection point adalah lokasi dependency diminta.

Contoh field:

```java
@Inject
AuditSink auditSink;
```

Constructor:

```java
@Inject
public CaseService(AuditSink auditSink) {
    this.auditSink = auditSink;
}
```

Method:

```java
@Inject
void init(AuditSink auditSink) {
    this.auditSink = auditSink;
}
```

Parameter producer/observer juga bisa menjadi injection point.

Injection point memiliki metadata:

```text
required type
required qualifiers
declaring bean
member/parameter information
```

### 11.1 Injection Point Harus Menyatakan Need, Bukan Implementation Convenience

Bad:

```java
@Inject
PostgresCaseRepository repository;
```

Jika consumer hanya butuh contract repository, lebih baik:

```java
@Inject
CaseRepository repository;
```

Namun jangan dogmatis. Concrete injection bisa valid untuk:

- private helper yang memang bukan abstraction boundary;
- test-only bean;
- local component yang tidak punya alternative;
- code yang sengaja tidak ingin abstraction berlebihan.

Rule lebih tepat:

```text
Inject the most stable contract that expresses what the consumer needs.
```

---

## 12. Resolution Algorithm: Cara Container Memilih Bean

Ini versi mental model, bukan formal spec penuh.

Saat container melihat injection point:

```java
@Inject
@ExternalStorage
DocumentStorage storage;
```

Ia melakukan:

```text
1. Ambil required type: DocumentStorage
2. Ambil required qualifiers: @ExternalStorage
3. Cari enabled beans yang bean types-nya assignable ke DocumentStorage
4. Filter beans yang qualifiers-nya match @ExternalStorage
5. Jika 0 kandidat  -> unsatisfied dependency
6. Jika 1 kandidat  -> resolved
7. Jika >1 kandidat -> apply disambiguation rules
8. Jika tetap >1    -> ambiguous dependency
9. Jika bean terpilih tidak proxyable padahal perlu proxy -> unproxyable error
10. Siapkan contextual reference/proxy untuk injection point
```

Diagram:

```text
Injection point
  |
  v
Required type + qualifiers
  |
  v
Candidate beans by type
  |
  v
Candidate beans by qualifier
  |
  v
Enabled/alternative/priority filtering
  |
  +-- 0 --> Unsatisfied
  |
  +-- 1 --> Resolved
  |
  +-- N --> Ambiguous
```

### 12.1 Unsatisfied Dependency

Contoh:

```java
@Inject
PaymentGateway gateway;
```

Tetapi tidak ada bean yang punya type `PaymentGateway` dan qualifier `@Default`.

Penyebab umum:

1. class belum discoverable sebagai bean;
2. lupa scope/bean-defining annotation;
3. `beans.xml` mode tidak sesuai;
4. dependency JAR tidak masuk deployment;
5. salah namespace `javax` vs `jakarta`;
6. qualifier injection point tidak sama dengan qualifier bean;
7. implementation berada di classloader yang tidak terlihat;
8. bean disabled karena alternative/profile/build condition;
9. generic type tidak assignable;
10. producer method tidak discoverable.

### 12.2 Ambiguous Dependency

Contoh:

```java
@Inject
AuditSink auditSink;
```

Ada:

```java
@ApplicationScoped
public class DatabaseAuditSink implements AuditSink { }

@ApplicationScoped
public class KafkaAuditSink implements AuditSink { }
```

Keduanya punya `@Default`.

Solusi:

- tambahkan qualifier;
- jadikan salah satu `@Alternative` dan enable secara eksplisit;
- gunakan `@Priority` jika memang default global;
- gunakan producer untuk memilih satu implementation;
- ubah injection point menjadi `Instance<AuditSink>` jika memang butuh banyak;
- batasi bean types dengan `@Typed` jika accidental exposure.

Jangan langsung pakai `@Named("databaseAuditSink")` sebagai reflex pertama. `@Named` string-based dan lebih cocok untuk integration dengan expression language/UI/legacy pattern, bukan routing utama business implementation.

### 12.3 Unproxyable Resolution

Contoh:

```java
@ApplicationScoped
public final class CaseService {
}
```

Karena `@ApplicationScoped` normal scope perlu proxy, class final bisa gagal.

Penyebab umum:

- final class;
- final method yang perlu diproxy/intercept;
- no accessible no-arg constructor pada kondisi tertentu/provider tertentu;
- primitive/array type untuk normal scoped bean;
- class dengan visibility tidak mendukung proxy generation.

Solusi:

- jangan final untuk managed service normal scoped;
- inject interface;
- gunakan scope yang sesuai;
- refactor final value object agar tidak menjadi normal scoped CDI bean;
- gunakan producer untuk third-party final class jika perlu, dengan scope yang tepat;
- pahami provider runtime.

---

## 13. Bean Name: Jangan Samakan Dengan Qualifier

CDI mendukung bean name, biasanya melalui `@Named`.

```java
@Named("caseService")
@ApplicationScoped
public class CaseService {
}
```

Bean name berguna untuk:

- expression language;
- JSF/CDI integration;
- beberapa integration layer lama;
- lookup berbasis nama di context tertentu.

Tapi untuk dependency routing, qualifier lebih kuat.

Bad:

```java
@Inject
@Named("s3Storage")
DocumentStorage storage;
```

Lebih baik:

```java
@Inject
@ExternalStorage
DocumentStorage storage;
```

Kenapa?

- qualifier type-safe;
- refactor-friendly;
- bisa punya members yang typed;
- container error lebih jelas;
- mengurangi string typo;
- menyatakan domain meaning, bukan class/name detail.

`@Named` bukan haram. Tapi jangan jadikan default routing mechanism.

---

## 14. Enabled Bean: Bean Ada Belum Tentu Aktif

Dalam CDI, class bisa ada di classpath, tetapi belum tentu menjadi enabled bean yang bisa dipakai resolution.

Faktor yang mempengaruhi:

1. bean discovery mode;
2. bean-defining annotation;
3. alternative enabled or not;
4. stereotype;
5. priority;
6. specialization;
7. build-time conditional inclusion di runtime tertentu;
8. archive/module visibility;
9. extension modification;
10. profile/config condition vendor-specific.

Mental model:

```text
Class exists       != bean exists
Bean exists        != enabled bean
Enabled bean       != matching bean
Matching bean      != uniquely resolvable bean
Resolvable bean    != proxyable bean
Proxyable bean     != context active at invocation time
```

Ini sangat penting untuk debugging.

---

## 15. CDI Object Graph: Bukan Tree, Tapi Graph

Dependency injection sering digambarkan seperti tree:

```text
CaseResource
  -> CaseService
      -> CaseRepository
      -> AuditService
```

Realitanya object graph bisa menjadi graph:

```text
CaseResource
  -> CaseService
      -> CaseRepository
      -> AuditService
          -> Clock
      -> PolicyService
          -> Clock
```

`Clock` bisa dipakai banyak bean.

Dengan scopes:

```text
@RequestScoped CaseResource
  -> proxy to @ApplicationScoped CaseService
      -> proxy/reference to @ApplicationScoped CaseRepository
      -> proxy/reference to @ApplicationScoped AuditService
      -> @Dependent CaseNumberFormatter
```

Di runtime:

```text
Injection references are not necessarily actual object ownership edges.
Some are proxies.
Some are dependent owned instances.
Some are contextual references.
```

Itulah kenapa scope penting untuk memory dan lifecycle.

---

## 16. Contoh Lengkap: Regulatory Case Workflow

Misalnya kita punya sistem regulatory case management.

Requirement:

- case bisa disubmit;
- case harus divalidasi policy;
- case disimpan;
- audit ditulis;
- notification dikirim;
- ada dua audit sink: database dan external compliance bus;
- ada request correlation id;
- ada clock yang bisa diganti saat test.

### 16.1 Domain Contract

```java
public interface CaseRepository {
    Case save(Case aggregate);
}

public interface AuditSink {
    void record(AuditEvent event);
}

public interface NotificationSender {
    void send(Notification notification);
}
```

### 16.2 Qualifier

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, PARAMETER, METHOD })
public @interface ComplianceAudit {
}

@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, PARAMETER, METHOD })
public @interface OperationalAudit {
}
```

### 16.3 Beans

```java
@ApplicationScoped
public class JdbcCaseRepository implements CaseRepository {
    @Override
    public Case save(Case aggregate) {
        // persist using datasource/JPA/JDBC adapter
        return aggregate;
    }
}

@OperationalAudit
@ApplicationScoped
public class DatabaseAuditSink implements AuditSink {
    @Override
    public void record(AuditEvent event) {
        // write to audit table
    }
}

@ComplianceAudit
@ApplicationScoped
public class ComplianceBusAuditSink implements AuditSink {
    @Override
    public void record(AuditEvent event) {
        // publish to compliance bus
    }
}
```

### 16.4 Request Context Bean

```java
@RequestScoped
public class RequestCorrelationContext {
    private String correlationId;

    public String correlationId() {
        return correlationId;
    }

    public void setCorrelationId(String correlationId) {
        this.correlationId = correlationId;
    }
}
```

### 16.5 Application Service

```java
@ApplicationScoped
public class SubmitCaseUseCase {
    private final CaseRepository repository;
    private final AuditSink operationalAudit;
    private final AuditSink complianceAudit;
    private final RequestCorrelationContext correlationContext;
    private final Clock clock;

    @Inject
    public SubmitCaseUseCase(
            CaseRepository repository,
            @OperationalAudit AuditSink operationalAudit,
            @ComplianceAudit AuditSink complianceAudit,
            RequestCorrelationContext correlationContext,
            Clock clock
    ) {
        this.repository = repository;
        this.operationalAudit = operationalAudit;
        this.complianceAudit = complianceAudit;
        this.correlationContext = correlationContext;
        this.clock = clock;
    }

    public SubmitCaseResult submit(SubmitCaseCommand command) {
        Case aggregate = Case.submit(command, clock.instant());
        Case saved = repository.save(aggregate);

        AuditEvent event = AuditEvent.caseSubmitted(
                saved.id(),
                correlationContext.correlationId(),
                clock.instant()
        );

        operationalAudit.record(event);
        complianceAudit.record(event);

        return new SubmitCaseResult(saved.id());
    }
}
```

Perhatikan hal penting:

```java
RequestCorrelationContext correlationContext
```

di-inject ke `@ApplicationScoped` bean.

Apakah itu salah?

Tidak selalu. Karena yang diinjeksi adalah proxy untuk `@RequestScoped` bean. Saat method `submit()` dipanggil dalam request context aktif, proxy akan resolve contextual instance request tersebut.

Tapi jika `SubmitCaseUseCase.submit()` dipanggil dari background job tanpa request context, maka call ke `correlationContext.correlationId()` bisa gagal.

Design implication:

- jika use case hanya boleh dipanggil dari request boundary, dokumentasikan invariant;
- jika use case juga dipakai background job, jangan bergantung pada request-scoped context;
- lebih aman pass explicit execution context:

```java
public SubmitCaseResult submit(SubmitCaseCommand command, ExecutionContext context) {
    // context contains actor/correlation/source
}
```

Top-level lesson:

```text
CDI makes injection possible, but architecture must still define valid invocation contexts.
```

---

## 17. Producer Preview: Saat Object Tidak Bisa Jadi Bean Langsung

Part producer akan dibahas detail nanti, tetapi core CDI mental model perlu mengenalnya.

Misalnya `Clock` bukan class buatan kita dan kita ingin satu bean:

```java
@ApplicationScoped
public class TimeProducer {

    @Produces
    @ApplicationScoped
    public Clock systemClock() {
        return Clock.systemUTC();
    }
}
```

Lalu:

```java
@Inject
Clock clock;
```

Dari sisi resolution, producer method membuat bean definition dengan:

```text
Bean type      : Clock
Qualifier      : @Default, @Any
Scope          : @ApplicationScoped
Creation logic : TimeProducer.systemClock()
```

Producer bukan sekadar factory method. Producer adalah cara menambahkan bean ke CDI graph.

---

## 18. `Instance<T>` Preview: Dynamic Bean Access

Kadang kita tidak ingin satu bean langsung. Kita ingin memilih saat runtime.

```java
@Inject
@Any
Instance<AuditSink> auditSinks;
```

Contoh select:

```java
AuditSink sink = auditSinks
        .select(ComplianceAuditLiteral.INSTANCE)
        .get();
```

Atau iterate:

```java
for (AuditSink sink : auditSinks) {
    sink.record(event);
}
```

Gunakan hati-hati.

`Instance<T>` valid untuk:

- optional dependency;
- multi-bean plugin;
- strategy lookup;
- framework extension;
- runtime conditional selection.

Tapi jika dipakai agar class tidak perlu deklarasi dependency jelas, itu smell.

Bad:

```java
@ApplicationScoped
public class GodService {
    @Inject
    @Any
    Instance<Object> anything;

    public Object findSomething(String name) { ... }
}
```

Ini service locator disguised as CDI.

---

## 19. CDI Error Reading Playbook

### 19.1 Unsatisfied Dependency

Error pattern:

```text
Unsatisfied dependency for type X and qualifiers Y
```

Baca sebagai:

```text
At injection point requiring type X + qualifier Y,
CDI found zero enabled beans whose bean types and qualifiers match.
```

Checklist:

1. Apakah implementation class ada di deployment artifact?
2. Apakah package namespace benar? `javax` vs `jakarta`?
3. Apakah class discoverable sebagai bean?
4. Apakah ada bean-defining annotation?
5. Apakah `beans.xml` mode cocok?
6. Apakah qualifier injection point sama dengan bean?
7. Apakah dependency berada di module/classloader visible?
8. Apakah bean disabled by alternative/profile?
9. Apakah generic type match?
10. Apakah producer method discoverable?

### 19.2 Ambiguous Dependency

Error pattern:

```text
Ambiguous dependencies for type X and qualifiers Y
Possible dependencies: A, B, C
```

Baca sebagai:

```text
At injection point requiring type X + qualifier Y,
CDI found more than one enabled matching bean.
```

Checklist:

1. Apakah ada multiple implementation dengan `@Default`?
2. Apakah test bean ikut masuk runtime?
3. Apakah producer dan class bean menghasilkan type sama?
4. Apakah alternative enabled tidak sengaja?
5. Apakah bean types terlalu luas?
6. Perlu qualifier atau `@Typed`?
7. Apakah injection point seharusnya `Instance<X>`?

### 19.3 Context Not Active

Error pattern:

```text
Context not active for scope @RequestScoped
```

Baca sebagai:

```text
Proxy berhasil diinjeksi, tetapi saat dipakai tidak ada active context untuk scope tersebut.
```

Checklist:

1. Dipanggil dari background thread?
2. Dipanggil dari scheduler?
3. Dipanggil setelah request selesai?
4. Dipanggil dari async completion stage tanpa context propagation?
5. Ada request context activation mechanism yang perlu dipakai?
6. Seharusnya data request dipass explicit, bukan diambil dari request-scoped bean?

### 19.4 Unproxyable Bean Type

Error pattern:

```text
Unproxyable bean type
```

Baca sebagai:

```text
CDI perlu membuat proxy untuk bean tersebut, tetapi tipe/class tidak bisa diproxy.
```

Checklist:

1. Class final?
2. Method final?
3. Constructor tidak suitable?
4. Class/package visibility bermasalah?
5. Bean normal scoped padahal seharusnya `@Dependent`?
6. Bisa inject interface?
7. Third-party final class perlu producer/wrapper?

---

## 20. Design Heuristics Untuk CDI Core

### 20.1 Default Service Scope

Untuk stateless application service:

```java
@ApplicationScoped
public class SomeUseCase {
}
```

Asalkan:

- tidak menyimpan request/user-specific mutable state;
- dependency juga thread-safe atau contextual proxy;
- mutable cache dilindungi concurrency control.

### 20.2 Request Data Jangan Disimpan Di Application Service

Bad:

```java
@ApplicationScoped
public class CaseService {
    private UserId currentUser;
}
```

Good:

```java
public SubmitCaseResult submit(SubmitCaseCommand command, Actor actor) {
    // actor explicit
}
```

atau gunakan request-scoped context dengan batas invocation jelas.

### 20.3 Qualifier Untuk Domain Meaning, Bukan Implementation Name

Bad:

```java
@S3
DocumentStorage storage;
```

Lebih domain-oriented:

```java
@ExternalDocumentStore
DocumentStorage storage;
```

Kenapa? Karena implementation bisa berubah dari S3 ke Azure Blob tanpa mengganti meaning injection point.

### 20.4 Jangan Pakai CDI Untuk Semua Object

Tidak semua object harus bean.

Value object:

```java
public record CaseId(String value) { }
```

Entity/domain aggregate:

```java
public class Case {
    // domain state
}
```

DTO:

```java
public record SubmitCaseRequest(...) { }
```

Biasanya bukan CDI bean.

CDI cocok untuk:

- service;
- adapter;
- factory/producer;
- policy component;
- infrastructure connector;
- runtime boundary;
- integration component;
- cross-cutting collaborator.

### 20.5 Constructor Injection Untuk Required Dependency

Prefer:

```java
@ApplicationScoped
public class CaseService {
    private final CaseRepository repository;

    @Inject
    public CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Manfaat:

- dependency explicit;
- final field;
- easier unit test;
- no partially initialized object after constructor;
- class invariant lebih jelas.

Field injection masih banyak dipakai di legacy Jakarta EE, tapi untuk code baru constructor injection lebih defensible.

### 20.6 Jangan Campur Business Selection Dengan If-Else Config Everywhere

Bad:

```java
if (config.getStorageType().equals("s3")) {
    s3.store(doc);
} else {
    local.store(doc);
}
```

Jika selection bersifat deployment-time/startup-time, gunakan CDI selection pattern:

- qualifier;
- alternative;
- producer;
- config-driven producer;
- profile-specific bean;
- feature flag wrapper jika runtime decision.

Part berikutnya akan membahas qualifiers/alternatives lebih dalam.

---

## 21. CDI Dengan Java 8 Hingga Java 25

CDI sebagai specification berkembang bersama Java/Jakarta EE ecosystem.

### 21.1 Java 8 Era

Biasanya terkait:

```text
Java EE 7 / Java EE 8
javax.enterprise.*
javax.inject.*
```

Common runtime:

- WildFly/JBoss EAP;
- Payara/GlassFish;
- WebLogic;
- WebSphere/Liberty;
- TomEE;
- custom embedded Weld.

Ciri:

- `javax.*` namespace;
- CDI 1.x/2.x tergantung platform;
- banyak aplikasi EAR/WAR;
- EJB/CDI coexistence kuat;
- deployment descriptor masih sering muncul.

### 21.2 Java 11/17 Transition

Java 11 dan 17 banyak dipakai saat migrasi enterprise modern.

Isu:

- illegal reflective access;
- JPMS awareness;
- app server compatibility;
- library upgrade;
- namespace transition;
- CDI provider version;
- bytecode target.

### 21.3 Java 21/25 Modern Era

Modern Jakarta EE 10/11 ecosystem bergerak ke:

```text
jakarta.enterprise.*
jakarta.inject.*
```

Ciri:

- Java 17+ baseline untuk Jakarta EE 11;
- CDI Lite relevance;
- build-time augmentation di runtime seperti Quarkus;
- cloud-native deployment;
- MicroProfile integration;
- virtual thread discussion;
- stronger dependency hygiene;
- test/container integration lebih modern.

Tetapi mental model bean/type/qualifier/scope/context tetap fundamental.

---

## 22. CDI Dalam Berbagai Runtime

CDI specification memberi model portable, tetapi implementasi/runtime punya detail.

Contoh provider/runtime:

```text
Weld            : CDI reference implementation heritage, used in multiple runtimes
OpenWebBeans    : Apache CDI implementation
ArC             : Quarkus CDI-inspired/build-time optimized implementation
Open Liberty    : Jakarta EE/MicroProfile runtime
WildFly         : Jakarta EE runtime using Weld integration
Payara/GlassFish: Jakarta EE runtime lineage
TomEE           : Tomcat + Jakarta EE profile capabilities
```

Hal yang bisa berbeda:

- discovery behavior optimization;
- classpath scanning;
- build-time validation;
- unsupported features in CDI Lite mode;
- proxy generation detail;
- native image restrictions;
- custom config/profile conditional annotations;
- extension support.

Prinsip:

```text
Learn the CDI spec mental model first, then learn runtime-specific constraints.
```

Jangan sebaliknya.

Kalau belajar hanya dari satu framework, kita mudah mengira vendor-specific behavior sebagai CDI universal.

---

## 23. CDI Core Anti-Patterns

### 23.1 Annotation-Driven Guessing

```java
@Inject
private Something something;
```

lalu berharap container “tahu sendiri”.

CDI bukan magic. CDI punya deterministic resolution rule.

### 23.2 `@ApplicationScoped` Dengan Mutable Request State

```java
@ApplicationScoped
public class SearchService {
    private SearchCriteria lastCriteria;
}
```

Berbahaya dalam concurrent request.

### 23.3 Qualifier Terlalu Teknis

```java
@MySql
@S3
@Redis
```

Kadang valid untuk infra adapter, tapi sering lebih baik qualifier berdasarkan role:

```java
@PrimaryCaseStore
@ExternalDocumentStore
@DistributedCache
```

### 23.4 Semua Object Dijadikan Bean

Domain object tidak perlu jadi CDI bean.

Bad:

```java
@Dependent
public class Case {
    private CaseStatus status;
}
```

Domain aggregate harus dibuat oleh domain logic/repository/factory, bukan container global.

### 23.5 `Instance<Object>` Sebagai Service Locator

Jika suatu class bisa mencari apapun dari container, dependency graph hilang.

### 23.6 Mengandalkan `@Named` String Routing

String routing fragile dan kurang expressive.

### 23.7 Ignoring Scope Boundary

Inject request-scoped bean ke app-scoped service boleh secara teknis, tetapi invocation context harus benar.

### 23.8 Self-Invocation Untuk Transaction/Audit/Security

Interceptors/proxies bekerja pada boundary. Internal method call tidak otomatis melewati proxy.

---

## 24. Practical Checklist Saat Mendesain CDI Bean

Untuk setiap bean, jawab pertanyaan ini:

```text
1. Apakah class ini memang runtime-managed component?
2. Apa contract yang diekspos ke consumer?
3. Apa bean types yang sebaiknya visible?
4. Apakah perlu interface?
5. Apakah ada lebih dari satu implementation?
6. Jika ya, qualifier domain apa yang tepat?
7. Scope apa yang benar?
8. Apakah scope tersebut thread-safe untuk state yang dimiliki?
9. Apakah bean akan diproxy?
10. Apakah class proxyable?
11. Apakah bean menyimpan request/user/transaction state?
12. Apakah dependency required atau optional?
13. Apakah constructor injection bisa dipakai?
14. Apakah lifecycle callback diperlukan?
15. Apakah object ini resource yang perlu disposer/cleanup?
16. Apakah akan dipakai dari request dan background job?
17. Apakah invocation context-nya selalu valid?
18. Bagaimana test akan mengganti dependency ini?
19. Bagaimana error resolution akan terbaca?
20. Apakah dependency graph masih jelas setelah memakai CDI?
```

---

## 25. Mini Case Study: Ambiguous Dependency Pada Audit Sink

### 25.1 Problem

```java
public interface AuditSink {
    void record(AuditEvent event);
}

@ApplicationScoped
public class DatabaseAuditSink implements AuditSink {
    public void record(AuditEvent event) { ... }
}

@ApplicationScoped
public class KafkaAuditSink implements AuditSink {
    public void record(AuditEvent event) { ... }
}

@ApplicationScoped
public class CaseService {
    @Inject
    AuditSink auditSink;
}
```

Runtime error:

```text
Ambiguous dependency for type AuditSink with qualifier @Default
```

### 25.2 Salah Solusi

```java
@Inject
@Named("databaseAuditSink")
AuditSink auditSink;
```

Ini bekerja, tapi kurang baik sebagai default design karena string name menjadi routing utama.

### 25.3 Solusi Lebih Baik

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, PARAMETER, METHOD })
public @interface OperationalAudit {
}

@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, FIELD, PARAMETER, METHOD })
public @interface ComplianceAudit {
}
```

```java
@OperationalAudit
@ApplicationScoped
public class DatabaseAuditSink implements AuditSink {
    public void record(AuditEvent event) { ... }
}

@ComplianceAudit
@ApplicationScoped
public class KafkaAuditSink implements AuditSink {
    public void record(AuditEvent event) { ... }
}
```

```java
@ApplicationScoped
public class CaseService {
    private final AuditSink auditSink;

    @Inject
    public CaseService(@OperationalAudit AuditSink auditSink) {
        this.auditSink = auditSink;
    }
}
```

Now injection point explicitly says:

```text
I need the audit sink used for operational audit.
```

Bukan:

```text
I need the bean whose string name is databaseAuditSink.
```

---

## 26. Mini Case Study: Request Context In Background Job

### 26.1 Problem

```java
@RequestScoped
public class CurrentActor {
    public UserId userId() { ... }
}

@ApplicationScoped
public class CaseEscalationJob {
    @Inject
    CurrentActor currentActor;

    public void run() {
        UserId actor = currentActor.userId();
        // escalate overdue cases
    }
}
```

Saat job berjalan, tidak ada HTTP request.

Error:

```text
Context not active for @RequestScoped
```

### 26.2 Root Cause

`CurrentActor` adalah request-scoped. Job bukan request.

Injection proxy bisa masuk, tetapi invocation gagal.

### 26.3 Solusi Desain

```java
@ApplicationScoped
public class CaseEscalationJob {
    private final CaseEscalationService service;

    @Inject
    public CaseEscalationJob(CaseEscalationService service) {
        this.service = service;
    }

    public void run() {
        service.escalateOverdueCases(Actor.system("case-escalation-job"));
    }
}
```

```java
@ApplicationScoped
public class CaseEscalationService {
    public void escalateOverdueCases(Actor actor) {
        // actor explicit
    }
}
```

Lesson:

```text
Request context data should not be a hidden dependency of background processes.
```

---

## 27. Mini Case Study: Unproxyable Final Service

### 27.1 Problem

```java
@ApplicationScoped
public final class RiskScoringService {
    public int score(CaseData data) {
        return 0;
    }
}
```

Runtime error:

```text
Unproxyable bean type: final class
```

### 27.2 Why

`@ApplicationScoped` is normal scope. CDI wants to inject a client proxy. A final class cannot be subclass-proxied by common mechanisms.

### 27.3 Solusi

Option 1:

```java
@ApplicationScoped
public class RiskScoringService {
    public int score(CaseData data) {
        return 0;
    }
}
```

Option 2:

```java
public interface RiskScoring {
    int score(CaseData data);
}

@ApplicationScoped
public class DefaultRiskScoring implements RiskScoring {
    public int score(CaseData data) {
        return 0;
    }
}
```

Inject:

```java
@Inject
RiskScoring riskScoring;
```

Option 3: jika class third-party final, wrap it:

```java
@ApplicationScoped
public class RiskScoringAdapter {
    private final ThirdPartyFinalRiskEngine engine;

    public RiskScoringAdapter() {
        this.engine = new ThirdPartyFinalRiskEngine();
    }

    public int score(CaseData data) {
        return engine.score(data);
    }
}
```

Atau gunakan producer dengan scope yang tepat.

---

## 28. Mental Model Ringkas

Ingat tujuh konsep inti:

```text
Bean       = runtime component definition known by CDI
Type       = what contract can satisfy injection point
Qualifier  = which variant of the contract
Scope      = lifecycle and sharing rule
Context    = active storage for scoped instances
Proxy      = injected reference that resolves actual contextual instance
Resolution = deterministic matching of injection point to enabled bean
```

Formula praktis:

```text
Injection point asks for: type + qualifiers
CDI searches among: enabled beans with bean types + qualifiers
Scope determines: lifetime and context
Normal scope usually means: client proxy
Invocation may fail if: context is not active
```

---

## 29. Latihan Mandiri

### Latihan 1 — Identifikasi Bean Metadata

Untuk class berikut:

```java
@ApplicationScoped
public class EmailNotificationSender implements NotificationSender {
}
```

Tentukan:

```text
Bean class      : ?
Bean types      : ?
Qualifiers      : ?
Scope           : ?
Proxy needed    : ?
Thread-safe req : ?
```

### Latihan 2 — Resolve Ambiguity

Diberikan:

```java
@ApplicationScoped
public class A implements Processor { }

@ApplicationScoped
public class B implements Processor { }

@Inject
Processor processor;
```

Tentukan:

1. error apa yang mungkin muncul?
2. kenapa?
3. minimal dua solusi CDI yang benar.

### Latihan 3 — Scope Safety

Apakah desain berikut aman?

```java
@ApplicationScoped
public class CurrentRequestData {
    private String userId;
}
```

Jelaskan:

1. masalah concurrency;
2. masalah data leakage;
3. scope yang lebih tepat;
4. alternatif explicit parameter.

### Latihan 4 — Context Not Active

Sebuah scheduled job menginject `@RequestScoped UserContext`. Saat jalan malam hari, error `ContextNotActiveException`.

Jelaskan root cause dan redesign.

### Latihan 5 — Proxy Boundary

Sebuah method `A()` dengan `@Transactional` memanggil method `B()` dalam class yang sama, dan `B()` juga punya `@Transactional(REQUIRES_NEW)`. Kenapa `REQUIRES_NEW` bisa tidak berlaku?

Hubungkan dengan self-invocation dan proxy boundary.

---

## 30. Checklist Review Kode CDI

Gunakan checklist ini saat code review:

```text
[ ] Bean punya scope yang sengaja dipilih, bukan kebetulan.
[ ] Application-scoped bean tidak menyimpan request/user-specific state.
[ ] Request-scoped bean tidak dipakai di background job tanpa desain context eksplisit.
[ ] Multiple implementation dibedakan dengan qualifier, bukan string name fragile.
[ ] Injection point memakai contract yang stabil.
[ ] Constructor injection dipakai untuk dependency required.
[ ] Bean normal scoped proxyable.
[ ] Tidak ada final service class tanpa alasan.
[ ] Tidak ada Instance<Object> sebagai service locator.
[ ] Domain object/entity/value object tidak dijadikan CDI bean tanpa alasan.
[ ] Producer dipakai untuk third-party/config-derived object, bukan untuk menyembunyikan graph.
[ ] CDI error message bisa dijelaskan dengan type + qualifier + scope + context model.
[ ] Test replacement strategy jelas.
[ ] Namespace javax/jakarta konsisten.
[ ] Bean discovery mode diketahui.
```

---

## 31. Apa Yang Belum Dibahas Detail

Part ini sengaja belum membahas terlalu dalam:

- bean discovery modes dan `beans.xml` detail;
- semua built-in scopes secara mendalam;
- proxy mechanics detail;
- qualifiers with members dan `@Nonbinding`;
- alternatives, specialization, priority;
- producers/disposers detail;
- CDI events;
- interceptors;
- decorators;
- stereotypes;
- lifecycle callbacks;
- CDI extensions.

Itu akan dibahas pada part berikutnya.

---

## 32. Kesimpulan

CDI bukan magic annotation. CDI adalah runtime model yang mengelola object berdasarkan:

```text
bean definition + type + qualifier + scope + context + proxy + lifecycle
```

Untuk menjadi engineer yang kuat di enterprise Java, kita harus bisa membaca CDI dari sudut pandang container:

- injection point meminta type dan qualifier;
- container mencari enabled bean;
- scope menentukan lifetime;
- context menentukan instance aktif;
- proxy menghubungkan consumer dengan contextual instance;
- error resolution selalu bisa diturunkan dari model tersebut.

Jika model ini sudah kuat, topik-topik berikutnya akan jauh lebih mudah:

- bean discovery;
- scopes;
- proxy;
- qualifiers;
- producers;
- events;
- interceptors;
- decorators;
- Enterprise Beans integration;
- configuration/profile/feature flag;
- runtime debugging.

---

## 33. Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
```

Belum selesai. Bagian berikutnya:

```text
Part 009 — Bean Discovery and Archive Model
```

---

## 34. Referensi Resmi Untuk Pendalaman

- Jakarta Contexts and Dependency Injection 4.1 Specification
- Jakarta Dependency Injection 2.0 Specification
- Jakarta EE Platform 11 Specification
- Weld Documentation
- OpenWebBeans Documentation
- Open Liberty CDI Documentation
- WildFly Developer Guide CDI Integration
- Quarkus CDI Reference Guide

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-007.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-009](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-009.md)
