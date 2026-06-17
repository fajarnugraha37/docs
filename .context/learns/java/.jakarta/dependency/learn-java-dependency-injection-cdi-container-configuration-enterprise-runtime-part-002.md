# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-002

# Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Bagian: `002 / 035`  
> Fokus: memahami lapisan tersembunyi di balik Java/Jakarta enterprise runtime: **API**, **SPI**, **implementation**, **provider**, **specification**, **TCK**, **container**, dan konsekuensinya terhadap dependency, classloading, debugging, migration, dan desain arsitektur.

---

## 0. Kenapa Part Ini Penting?

Banyak engineer Java enterprise bisa memakai annotation seperti:

```java
@Inject
private PaymentService paymentService;
```

atau:

```java
@ApplicationScoped
public class PaymentService { }
```

Tetapi ketika runtime error muncul seperti:

```text
java.lang.NoSuchMethodError
java.lang.ClassNotFoundException
java.lang.NoClassDefFoundError
ClassCastException: X cannot be cast to X
UnsatisfiedResolutionException
DeploymentException
ProviderNotFoundException
```

mereka sering bingung karena problemnya bukan di syntax, bukan di annotation, dan bukan di business logic. Problemnya ada di **lapisan runtime**:

- API mana yang dikompilasi?
- implementation mana yang benar-benar dipakai saat runtime?
- provider mana yang ditemukan?
- SPI mana yang dipanggil container?
- classloader mana yang memuat class tersebut?
- apakah dependency itu disediakan oleh aplikasi atau oleh server?
- apakah versi API cocok dengan implementation?
- apakah library masih `javax.*` sementara aplikasi sudah `jakarta.*`?
- apakah satu provider mengeksekusi behavior yang diasumsikan oleh provider lain?

Part ini adalah fondasi agar kamu tidak hanya “tahu pakai Jakarta EE/CDI”, tetapi mampu membaca sistem enterprise Java sebagai **kontrak berlapis**.

---

## 1. Mental Model Utama

Di Java enterprise, dependency jarang hanya berarti “library”. Sering kali dependency berarti **kontrak runtime**.

Satu fitur enterprise biasanya punya beberapa lapisan:

```text
+--------------------------------------------------+
| Application Code                                 |
| - service                                        |
| - resource                                       |
| - repository                                     |
| - interceptor                                    |
+--------------------------------------------------+
                  depends on
+--------------------------------------------------+
| API                                              |
| - jakarta.enterprise.context.ApplicationScoped   |
| - jakarta.inject.Inject                          |
| - jakarta.persistence.EntityManager              |
| - jakarta.ejb.Stateless                          |
+--------------------------------------------------+
                  implemented by
+--------------------------------------------------+
| Provider / Implementation                        |
| - Weld / OpenWebBeans / ArC for CDI              |
| - Hibernate / EclipseLink for Persistence        |
| - RESTEasy / Jersey / CXF for REST               |
| - Undertow / Tomcat / Jetty for Servlet          |
+--------------------------------------------------+
                  hosted by
+--------------------------------------------------+
| Runtime / Container / Application Server         |
| - WildFly                                        |
| - Open Liberty                                   |
| - Payara                                         |
| - TomEE                                          |
| - Quarkus                                        |
| - Helidon                                        |
+--------------------------------------------------+
                  validates against
+--------------------------------------------------+
| Specification + TCK                              |
| - Jakarta EE Platform                            |
| - CDI Spec                                       |
| - Enterprise Beans Spec                          |
| - Servlet Spec                                   |
| - Transactions Spec                              |
+--------------------------------------------------+
```

The key point:

> Kamu compile terhadap **API**, tetapi runtime behavior datang dari **implementation/provider/container**.

Kalau kamu salah memahami lapisan ini, kamu akan salah membuat dependency, salah menaruh JAR, salah memilih scope Maven/Gradle, salah membaca stack trace, dan salah mengambil keputusan migration.

---

## 2. Vocabulary yang Harus Tepat

Sebelum masuk detail, kita harus rapikan istilah.

| Istilah | Makna | Contoh |
|---|---|---|
| Specification | Dokumen kontrak resmi: apa yang harus tersedia, behavior yang wajib, lifecycle, annotation semantics, compatibility rules | Jakarta CDI 4.1 Spec, Jakarta Enterprise Beans 4.0 Spec |
| API | Class/interface/annotation yang dipakai application code saat compile | `jakarta.inject.Inject`, `jakarta.enterprise.context.ApplicationScoped` |
| SPI | Interface/hook untuk implementation/provider/framework extension | CDI Extension SPI, JPA provider SPI, Servlet container initializer |
| Implementation | Kode konkret yang menjalankan API/spec | Weld, OpenWebBeans, Hibernate, EclipseLink |
| Provider | Implementation yang dipilih/ditemukan untuk suatu API/SPI | Hibernate sebagai JPA provider, Weld sebagai CDI provider |
| Container | Runtime yang mengelola lifecycle dan services | CDI container, Servlet container, EJB container |
| Application Server | Runtime gabungan yang menyediakan banyak container/spec | WildFly, Open Liberty, Payara |
| TCK | Test Compatibility Kit untuk memverifikasi implementation terhadap spec | Jakarta EE TCK |
| Vendor Extension | Fitur di luar spec yang disediakan vendor/provider | Hibernate-specific annotations, WildFly subsystem config |
| Portable Code | Code yang hanya bergantung pada API/spec, bukan vendor-specific behavior | CDI standard injection, Jakarta Transactions standard annotations |

---

## 3. API: Apa yang Dilihat Compiler

API adalah lapisan yang dipakai aplikasi saat compile.

Contoh CDI API:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class InvoiceService {

    private final TaxService taxService;

    @Inject
    public InvoiceService(TaxService taxService) {
        this.taxService = taxService;
    }
}
```

Agar code ini compile, kamu butuh API JAR yang menyediakan:

```text
jakarta.enterprise.context.ApplicationScoped
jakarta.inject.Inject
```

Namun API JAR tidak berarti container CDI sudah aktif.

Ini sering menjadi jebakan:

```xml
<dependency>
    <groupId>jakarta.enterprise</groupId>
    <artifactId>jakarta.enterprise.cdi-api</artifactId>
    <version>4.1.0</version>
</dependency>
```

Dependency itu membuat code compile, tetapi tidak otomatis membuat injection berjalan kalau tidak ada CDI implementation/container.

Analogi:

```text
API = bentuk colokan listrik
Implementation = kabel, arus, dan pembangkit listrik
Container = instalasi listrik gedung yang mengatur distribusi
```

Punya bentuk colokan bukan berarti ada listrik.

---

## 4. Specification: Kontrak Semantik, Bukan Sekadar Javadoc

Specification menjawab pertanyaan seperti:

- kapan bean dibuat?
- kapan dependency diinjeksi?
- bagaimana qualifier dipilih?
- apa yang terjadi jika dependency ambiguous?
- apakah interceptor dipanggil saat self-invocation?
- apa arti `@ApplicationScoped`?
- apakah `@RequestScoped` aktif di thread async?
- bagaimana transaction rollback terjadi?
- apakah implementation wajib mendukung fitur tertentu?

API hanya memberi type. Specification memberi **aturan main**.

Misalnya annotation ini:

```java
@ApplicationScoped
public class ReportService { }
```

Dari sisi Java compiler, ini hanya metadata annotation.

Dari sisi CDI specification, ini berarti bean memiliki normal scope application context. Container boleh menyuntikkan proxy, mengelola instance aktual, dan menghancurkannya saat application context berakhir.

Jadi annotation enterprise bukan hanya label. Annotation adalah bagian dari **runtime contract**.

---

## 5. Implementation / Provider: Yang Benar-Benar Menjalankan Behavior

Untuk CDI, provider/implementation bisa berupa:

- Weld
- Apache OpenWebBeans
- ArC di Quarkus

Untuk persistence:

- Hibernate ORM
- EclipseLink

Untuk REST:

- Jersey
- RESTEasy
- Apache CXF

Untuk Servlet:

- Tomcat
- Jetty
- Undertow

Application code mungkin hanya melihat:

```java
@Inject
EntityManager entityManager;
```

Tetapi runtime behavior bisa melibatkan:

```text
CDI provider
  -> menemukan bean
  -> membuat proxy
  -> membaca metadata
  -> memanggil producer
  -> menyelesaikan injection point
  -> memanggil lifecycle callback
  -> menghubungkan transaction context
  -> menghubungkan persistence provider
```

Dengan kata lain:

```text
API gives you the vocabulary.
Provider gives you the behavior.
Container gives you the lifecycle.
Specification gives you the contract.
```

---

## 6. SPI: Jalur Belakang untuk Provider dan Framework

API adalah jalur yang dipakai application developer.

SPI adalah jalur yang dipakai framework/provider/extension developer.

Contoh sederhana:

```text
Application developer:
  uses @Inject
  uses @ApplicationScoped
  uses @Transactional

Framework/extension developer:
  observes CDI container lifecycle
  registers synthetic beans
  modifies annotated types
  provides custom provider
  integrates external runtime
```

SPI sering digunakan untuk:

- provider discovery
- plugin discovery
- custom extension
- runtime integration
- annotation processing runtime
- framework bootstrap
- container lifecycle customization

Contoh mental model SPI:

```text
Application Code ---> API ---> Container
                         ^
                         |
                  SPI / Extension Hook
                         |
                 Provider / Framework
```

Contoh SPI di Java umum:

```text
java.util.ServiceLoader
```

Banyak library memakai pola seperti:

```text
META-INF/services/<interface-name>
```

Isi file:

```text
com.example.MyProviderImplementation
```

Kemudian runtime menemukan implementation melalui classpath/module path.

---

## 7. ServiceLoader: Provider Discovery Paling Dasar di Java

Walaupun Jakarta EE punya model container sendiri, `ServiceLoader` adalah fondasi penting untuk memahami provider discovery.

Contoh API:

```java
public interface CompressionProvider {
    byte[] compress(byte[] input);
}
```

Implementation:

```java
public class GzipCompressionProvider implements CompressionProvider {
    @Override
    public byte[] compress(byte[] input) {
        // simplified
        return input;
    }
}
```

Provider declaration:

```text
META-INF/services/com.example.CompressionProvider
```

Isi:

```text
com.example.GzipCompressionProvider
```

Lookup:

```java
ServiceLoader<CompressionProvider> loader =
        ServiceLoader.load(CompressionProvider.class);

for (CompressionProvider provider : loader) {
    System.out.println(provider.getClass().getName());
}
```

Ini menunjukkan pattern umum:

```text
API interface exists
Implementation class exists
Metadata connects them
Runtime discovers provider
Application gets behavior
```

Di enterprise Java, pola ini muncul dalam bentuk yang lebih kompleks.

---

## 8. Jakarta EE: Platform of Specifications

Jakarta EE bukan satu library tunggal.

Jakarta EE adalah platform yang menggabungkan banyak specification:

- CDI
- Servlet
- RESTful Web Services
- Persistence
- Transactions
- Security
- Validation
- JSON Processing
- JSON Binding
- Enterprise Beans Lite
- Interceptors
- Annotations
- Concurrency
- Mail
- Faces
- WebSocket
- Messaging
- dan lain-lain tergantung profile/platform.

Modelnya:

```text
Jakarta EE Platform
  ├── Jakarta CDI
  ├── Jakarta Servlet
  ├── Jakarta REST
  ├── Jakarta Persistence
  ├── Jakarta Transactions
  ├── Jakarta Enterprise Beans
  ├── Jakarta Security
  ├── Jakarta Validation
  ├── Jakarta Annotations
  └── ...
```

Application server menyediakan implementation dari spesifikasi-spesifikasi tersebut.

Karena itu, di aplikasi Jakarta EE tradisional, dependency API sering diberi scope `provided`:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
    <scope>provided</scope>
</dependency>
```

Maknanya:

```text
Compile-time:
  aplikasi butuh API agar code compile

Runtime:
  server yang menyediakan API + implementation
```

---

## 9. Kenapa API JAR Tidak Boleh Sembarangan Dibundel?

Misalnya kamu deploy WAR ke application server.

Server sudah punya:

```text
jakarta.enterprise.cdi-api
jakarta.inject-api
jakarta.servlet-api
jakarta.transaction-api
```

Lalu aplikasi kamu juga membawa versi lain di `WEB-INF/lib`.

Mungkin hasilnya:

```text
Server classloader loads API version A
Application classloader loads API version B
Provider expects A
Application code compiled against B
```

Efeknya bisa berupa:

```text
NoSuchMethodError
LinkageError
ClassCastException
Annotation ignored
Bean not discovered
Provider mismatch
Deployment failure
```

Contoh paling membingungkan:

```text
java.lang.ClassCastException:
jakarta.enterprise.inject.spi.BeanManager cannot be cast to jakarta.enterprise.inject.spi.BeanManager
```

Ini terdengar mustahil karena type-nya sama.

Tetapi di JVM, class identity bukan hanya nama class. Class identity adalah:

```text
fully qualified class name + classloader identity
```

Jadi:

```text
BeanManager loaded by ServerClassLoader
!=
BeanManager loaded by WebAppClassLoader
```

---

## 10. API/Implementation Mismatch

Mismatch paling umum:

### 10.1 API lebih baru daripada implementation

Aplikasi compile terhadap API baru:

```text
jakarta.enterprise.cdi-api 4.1
```

Runtime memakai provider/server yang hanya support API lama:

```text
CDI 4.0 provider
```

Kemungkinan error:

```text
NoSuchMethodError
NoSuchFieldError
UnsupportedOperationException
DeploymentException
```

### 10.2 Implementation lebih baru tetapi API lama ikut kebundel

Aplikasi membawa API lama di `WEB-INF/lib`, sementara server/provider butuh API baru.

Kemungkinan error:

```text
NoSuchMethodError inside provider code
```

Stack trace tampak berasal dari provider, padahal root cause-nya dependency packaging.

### 10.3 Spec berbeda namespace

Aplikasi memakai:

```java
import javax.inject.Inject;
```

Runtime modern mencari:

```java
import jakarta.inject.Inject;
```

Atau library dependency masih menghasilkan bean dengan `javax.enterprise.*`, sementara container Jakarta EE 10/11 bekerja dengan `jakarta.enterprise.*`.

Efeknya:

```text
annotation tidak dianggap relevan
bean tidak ditemukan
provider tidak compatible
class not found
```

---

## 11. Provider-Specific Classes: Kapan Boleh, Kapan Berbahaya

Contoh JPA portable:

```java
import jakarta.persistence.EntityManager;

public class CaseRepository {
    @PersistenceContext
    EntityManager entityManager;
}
```

Contoh provider-specific:

```java
import org.hibernate.Session;

Session session = entityManager.unwrap(Session.class);
```

Apakah salah? Tidak selalu.

Tetapi ini mengubah kontrak arsitektur:

```text
Before:
  application depends on Jakarta Persistence API

After:
  application depends on Hibernate implementation behavior
```

Konsekuensi:

- sulit pindah provider
- migration lebih mahal
- behavior mungkin tidak portable
- testing harus include provider spesifik
- bug provider bisa menjadi bug application
- code perlu compatibility matrix provider

Prinsip praktis:

> Gunakan API standard sebagai default. Gunakan provider-specific extension hanya jika manfaatnya nyata, dibungkus boundary yang jelas, dan didokumentasikan.

---

## 12. Portable Code vs Vendor-Specific Code

Portable code:

```java
@Inject
PaymentGateway gateway;
```

```java
@Transactional
public void submitPayment(PaymentCommand command) {
    gateway.charge(command);
}
```

Vendor-specific code:

```java
@org.hibernate.annotations.BatchSize(size = 50)
```

```java
@io.quarkus.arc.profile.IfBuildProfile("prod")
```

```java
@org.jboss.ejb3.annotation.Pool("slsb-strict-max-pool")
```

Vendor-specific code sering berguna, tetapi harus dilihat sebagai **architecture decision**, bukan sekadar convenience.

Checklist sebelum memakai vendor-specific feature:

1. Apakah fitur standard tidak cukup?
2. Apakah manfaatnya signifikan?
3. Apakah ada fallback portable?
4. Apakah dependency ini bocor ke domain/application layer?
5. Apakah migration cost diterima?
6. Apakah sudah dicatat di ADR?
7. Apakah test mencakup behavior vendor-specific tersebut?
8. Apakah versi provider/server sudah dikunci?

---

## 13. CDI API vs CDI Provider

Application code:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class NotificationService {
    @Inject
    MailClient mailClient;
}
```

CDI API menyediakan:

```text
@ApplicationScoped
@Inject
@Qualifier
@Produces
@Observes
Instance<T>
BeanManager
Extension SPI
```

CDI provider menjalankan:

```text
bean discovery
injection point resolution
proxy generation
context management
lifecycle callbacks
interceptor binding
decorator chain
event delivery
extension invocation
```

Contoh provider:

```text
Weld
Apache OpenWebBeans
ArC
```

Yang harus diingat:

```text
CDI API jar alone is not a CDI runtime.
```

Untuk unit test, kamu bisa memasang Weld JUnit misalnya. Untuk app server, CDI provider sudah disediakan server. Untuk Quarkus, ArC menjadi CDI-like build-time optimized container.

---

## 14. JPA API vs Persistence Provider

Aplikasi melihat:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
```

Provider menjalankan:

```text
entity metadata parsing
SQL generation
dirty checking
flush
lazy loading
proxy/enhancement
first-level cache
second-level cache integration
transaction synchronization
schema generation optional
```

Provider umum:

```text
Hibernate ORM
EclipseLink
```

Error yang tampak seperti JPA sering sebenarnya provider-specific:

```text
LazyInitializationException       -> Hibernate-specific exception
MultipleBagFetchException         -> Hibernate-specific exception
QueryException                    -> provider parser behavior
```

Top engineer tidak berhenti pada “JPA error”. Ia bertanya:

```text
Apakah ini error spec-level atau provider-level?
```

Karena solusi berbeda:

- spec-level: ubah cara memakai JPA API/transaction boundary
- provider-level: cek Hibernate behavior/config/version/bug/workaround

---

## 15. Servlet API vs Servlet Container

Aplikasi melihat:

```java
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
```

Container menjalankan:

```text
HTTP connection handling
request parsing
response writing
filter chain
servlet lifecycle
session management
async servlet support
multipart handling
websocket integration
security integration
classloader isolation
```

Provider/container:

```text
Tomcat
Jetty
Undertow
Open Liberty web container
Payara web container
```

Hal yang sering disalahpahami:

```text
jakarta.servlet-api is not Tomcat.
```

Servlet API hanya kontrak. Tomcat/Jetty/Undertow adalah runtime yang menjalankan request.

---

## 16. Enterprise Beans API vs EJB Container

Aplikasi melihat:

```java
import jakarta.ejb.Stateless;

@Stateless
public class SettlementService {
    public void settle() { }
}
```

EJB/Enterprise Beans container menyediakan:

```text
session bean lifecycle
pooling
transaction management
security checks
timer service
async method execution
remote/local invocation semantics
concurrency management for singleton beans
interceptor integration
```

Kalau kamu hanya menaruh annotation `@Stateless` di plain Java SE app tanpa EJB container, annotation itu tidak otomatis memberi pooling/transaction/security.

Ini pattern umum enterprise Java:

> Annotation tidak punya kekuatan sendiri. Kekuatan datang dari runtime yang membaca dan mengeksekusi kontraknya.

---

## 17. Jakarta Inject vs CDI

`jakarta.inject` adalah API kecil untuk dependency injection vocabulary.

Contoh:

```java
import jakarta.inject.Inject;
import jakarta.inject.Named;
import jakarta.inject.Provider;
import jakarta.inject.Singleton;
```

CDI jauh lebih besar:

```text
contexts
scopes
qualifiers
events
producers
disposers
interceptors integration
decorators
extensions
bean discovery
resolution algorithm
client proxies
```

Jadi:

```text
Jakarta Inject = minimal DI annotation vocabulary
CDI = full contextual dependency injection runtime model
```

Kesalahan umum:

```text
“Karena sudah ada @Inject, berarti CDI aktif.”
```

Belum tentu. `@Inject` bisa dipahami oleh CDI, Guice, Spring integration, atau runtime lain. Yang menentukan behavior adalah runtime/container/provider.

---

## 18. Jakarta Annotations: Common Metadata Layer

Beberapa annotation bersifat lintas specification.

Contoh:

```java
@PostConstruct
public void init() { }

@PreDestroy
public void destroy() { }
```

Annotation ini bisa dipakai di banyak managed component, tetapi behavior tetap bergantung pada container yang mengelola component tersebut.

Contoh lain:

```java
@Priority(100)
```

`@Priority` bisa memengaruhi ordering di beberapa konteks seperti interceptor/alternative/provider selection tergantung spec yang menggunakannya.

Jadi annotation common bukan berarti behavior universal tanpa konteks.

Mental model:

```text
Annotation = metadata
Spec = semantic meaning
Container = executor of semantic meaning
```

---

## 19. Container sebagai Composition Engine

Application server modern bukan satu “kotak ajaib”. Ia composition engine.

Contoh deployment request ke resource REST:

```text
HTTP request
  -> network listener
  -> servlet container
  -> filter chain
  -> security layer
  -> REST provider
  -> CDI injection/proxy
  -> interceptor chain
  -> transaction interceptor
  -> application service
  -> JPA provider
  -> JDBC driver
  -> database
```

Masing-masing lapisan punya API/provider:

| Layer | API | Provider/Runtime |
|---|---|---|
| HTTP Servlet | Jakarta Servlet | Tomcat/Undertow/Jetty/server web container |
| REST | Jakarta REST | Jersey/RESTEasy/CXF |
| DI | Jakarta CDI/Inject | Weld/OpenWebBeans/ArC |
| Transaction | Jakarta Transactions | server transaction manager/Narayana/etc. |
| Persistence | Jakarta Persistence | Hibernate/EclipseLink |
| Database | JDBC | Oracle/PostgreSQL/MySQL driver |
| Security | Jakarta Security/JACC/etc. | server security subsystem |

Top-level runtime problem sering berasal dari interaksi antar-provider, bukan satu provider saja.

---

## 20. Compatibility Matrix: Cara Berpikir Senior

Setiap enterprise app punya compatibility matrix, walaupun tidak selalu ditulis.

Contoh matrix:

| Dimension | Example |
|---|---|
| Java runtime | Java 17, 21, 25 |
| Jakarta EE version | 9.1, 10, 11 |
| CDI version | 3.0, 4.0, 4.1 |
| Servlet version | 5.0, 6.0, 6.1 |
| JPA version | 3.0, 3.1, 3.2 |
| Enterprise Beans version | 4.0 |
| Server | WildFly/Open Liberty/Payara/TomEE |
| CDI provider | Weld/OpenWebBeans/ArC |
| JPA provider | Hibernate/EclipseLink |
| JDBC driver | Oracle/PostgreSQL/MySQL driver version |
| Build tool | Maven/Gradle version |
| Namespace | `javax.*` or `jakarta.*` |

Tanpa matrix ini, migration menjadi trial-and-error.

Prinsip:

> Jangan hanya tanya “versi library apa?” Tanyakan “kontrak runtime mana yang sedang dipakai?”

---

## 21. Example: Satu Annotation, Banyak Lapisan

Ambil contoh:

```java
@Transactional
public void approveCase(String caseId) {
    caseRepository.approve(caseId);
    auditTrail.record(caseId, "APPROVED");
}
```

Pertanyaan layer:

1. `@Transactional` berasal dari package mana?
   - `jakarta.transaction.Transactional`?
   - Spring `org.springframework.transaction.annotation.Transactional`?
   - vendor-specific?

2. Siapa yang membaca annotation itu?
   - CDI interceptor?
   - EJB container?
   - Spring proxy?

3. Apakah method dipanggil melalui proxy?
   - kalau self-invocation, mungkin interceptor tidak jalan.

4. Transaction manager apa yang dipakai?
   - Jakarta Transactions provider?
   - Spring transaction manager?
   - local JDBC transaction?
   - JTA/XA?

5. Persistence provider ikut transaction bagaimana?
   - JTA-managed EntityManager?
   - resource-local EntityManager?

6. Apa rollback rule-nya?
   - checked exception rollback?
   - runtime exception rollback?
   - configured rollbackOn/dontRollbackOn?

Satu annotation membuka banyak pertanyaan runtime.

Itulah bedanya pemakai framework dengan engineer yang paham container.

---

## 22. Example: `@Inject` yang Tidak Bekerja

Code:

```java
public class CaseResource {

    @Inject
    CaseService caseService;

    public Response getCase(String id) {
        return Response.ok(caseService.get(id)).build();
    }
}
```

Error:

```text
java.lang.NullPointerException: caseService is null
```

Kemungkinan root cause:

1. `CaseResource` bukan managed object.
2. CDI tidak aktif.
3. Bean archive tidak discoverable.
4. `beans.xml` tidak ada pada mode tertentu.
5. `CaseService` tidak punya bean-defining annotation.
6. Package annotation masih `javax.inject.Inject` di runtime `jakarta.*`.
7. Resource dibuat manual dengan `new CaseResource()`.
8. JAX-RS provider tidak terintegrasi dengan CDI dalam runtime tersebut.
9. Ada dua classloader berbeda memuat annotation/API.
10. Dependency CDI API hanya compile, tidak ada provider.

Troubleshooting senior tidak langsung “tambahkan annotation”. Ia memeriksa ownership:

```text
Siapa yang membuat CaseResource?
Siapa yang membuat CaseService?
Apakah keduanya dikelola container yang sama?
Apakah CDI discovery melihat CaseService?
Apakah injection point type + qualifier resolve ke satu bean?
```

---

## 23. Example: Compile Sukses, Deploy Gagal

Maven dependency:

```xml
<dependency>
    <groupId>jakarta.enterprise</groupId>
    <artifactId>jakarta.enterprise.cdi-api</artifactId>
    <version>4.1.0</version>
</dependency>
```

Compile sukses.

Deploy ke server lama gagal:

```text
NoSuchMethodError: jakarta.enterprise.inject.spi.BeanManager.someNewMethod
```

Root cause:

```text
Application compiled with CDI 4.1 API
Server/runtime provider supports older CDI API
```

Solusi bukan “clean install”. Solusi:

- align API version dengan server platform
- gunakan server BOM/platform BOM
- pakai `provided` untuk API yang disediakan server
- upgrade server jika butuh fitur baru
- jangan bundle API yang seharusnya server-provided

---

## 24. Example: Provider Leak ke Domain Layer

Buruk:

```java
package com.acme.case.domain;

import org.hibernate.Session;

public class CasePolicy {
    public void evaluate(Session session) {
        // domain logic mixed with provider-specific persistence implementation
    }
}
```

Masalah:

- domain layer tahu Hibernate
- sulit test tanpa Hibernate
- sulit pindah provider
- persistence concern bocor ke business rule
- transaction/lazy loading behavior bisa mengontrol domain logic

Lebih baik:

```java
package com.acme.case.domain;

public class CasePolicy {
    public PolicyDecision evaluate(CaseSnapshot snapshot) {
        // pure domain logic
    }
}
```

Provider-specific code dibatasi di infrastructure adapter:

```java
package com.acme.case.infrastructure.persistence;

public class HibernateCaseRepository implements CaseRepository {
    // provider-specific optimization allowed here, documented
}
```

Principle:

```text
Provider-specific dependency boleh ada di infrastructure boundary,
tetapi jangan merusak domain/application model.
```

---

## 25. Specification Compliance dan TCK

TCK adalah test suite untuk memverifikasi apakah implementation memenuhi specification.

Namun penting:

```text
TCK compliance means provider satisfies required spec behavior.
It does not mean all providers behave identically in every edge case.
```

Kenapa?

Karena spec sering memberi ruang implementation detail:

- performance strategy
- proxy generation strategy
- class scanning optimization
- cache strategy
- SQL generation detail
- logging detail
- metadata bootstrap
- extension ordering edge case
- vendor configuration

Jadi portable code tetap perlu testing di target runtime.

Praktis:

- jangan hanya test di embedded provider kalau production pakai app server berbeda
- jangan hanya test di H2 kalau production Oracle/PostgreSQL
- jangan asumsikan behavior vendor-specific portable
- gunakan integration test pada target runtime untuk runtime-critical behavior

---

## 26. Java 8 sampai 25: Apa yang Berubah dalam Konteks Ini?

Seri ini mencakup Java 8–25. Untuk topik API/SPI/provider, perubahan paling penting bukan syntax Java semata, tetapi runtime compatibility.

### Java 8 era

Umumnya terkait:

```text
Java EE 7/8
javax.* namespace
traditional app server
WAR/EAR deployment
reflection unrestricted
classpath dominant
```

### Java 11 era

Mulai penting:

```text
Java EE/Jakarta transition
removed Java EE modules from JDK
stronger push to external dependencies
container modernization
```

### Java 17 era

Sering menjadi baseline modern enterprise:

```text
LTS baseline
Jakarta EE 10/11 runtimes
stronger encapsulation concerns
modern GC/runtime behavior
records/sealed classes considerations
```

### Java 21 era

Penting untuk:

```text
virtual threads
modern LTS
container resource tuning
framework/runtime compatibility
```

### Java 25 era

Penting sebagai modern Java SE line:

```text
latest platform baseline
longer-term modernization discussion
runtime compatibility validation required
```

Yang harus kamu pahami:

```text
Java version upgrade bukan hanya language feature upgrade.
Ia memengaruhi reflection, bytecode version, dependency compatibility,
framework support, provider instrumentation, dan container support.
```

Contoh error:

```text
Unsupported class file major version 65
```

Artinya ada class dikompilasi dengan Java 21 tetapi runtime Java lebih tua. Ini bukan CDI problem, tetapi sering muncul saat mengembangkan provider/SPI/plugin di ecosystem enterprise.

---

## 27. Namespace Compatibility: `javax` dan `jakarta` Bukan Alias

Ini harus sangat jelas:

```java
javax.inject.Inject
```

bukan sama dengan:

```java
jakarta.inject.Inject
```

Bagi JVM, itu dua class berbeda.

Bagi container Jakarta EE modern, annotation `javax.inject.Inject` mungkin tidak dianggap sebagai annotation `jakarta.inject.Inject`.

Dependency graph campuran bisa seperti:

```text
Application code: jakarta.*
Library A: jakarta.*
Library B: javax.*
Server: Jakarta EE 10/11
```

Masalah:

- Library B mungkin tidak terdeteksi sebagai bean Jakarta CDI.
- Annotation metadata tidak cocok.
- Provider extension tidak jalan.
- API class tidak ditemukan.
- Adapter perlu dibuat.

Strategi:

1. Pastikan semua Jakarta EE-related dependencies sejajar namespace.
2. Gunakan dependency tree scan.
3. Hindari library lama yang belum migrate jika menyentuh managed component.
4. Kalau library hanya pure utility tanpa annotation enterprise, risikonya lebih kecil.
5. Kalau library menyediakan servlet/filter/CDI extension/JPA integration, risikonya besar.

---

## 28. Build-Time vs Runtime-Time Provider Model

Traditional Jakarta EE runtime banyak melakukan discovery saat deployment/startup:

```text
scan classpath
read annotations
build metadata
validate injection points
create proxies
start contexts
```

Modern cloud-native runtimes seperti Quarkus banyak menggeser pekerjaan ke build time:

```text
scan at build time
index classes
generate bytecode
remove unused metadata
optimize startup
reduce reflection
```

Konsekuensi:

| Model | Kelebihan | Risiko |
|---|---|---|
| Runtime discovery | fleksibel, dynamic, cocok app server klasik | startup lebih berat, error muncul saat deploy/startup |
| Build-time augmentation | startup cepat, native-friendly, optimizable | dynamic behavior dibatasi, extension perlu build-time metadata |

Ini memengaruhi desain SPI/provider.

Framework modern sering tidak hanya menjalankan API. Mereka melakukan **augmentation**:

```text
source/classes -> build metadata -> generated classes -> optimized runtime
```

Jadi dependency/provider bukan hanya runtime issue, tetapi juga build pipeline issue.

---

## 29. Decision: API Only, API + Provider, atau Platform?

Saat membuat aplikasi, kamu harus tahu model dependency yang dipilih.

### 29.1 Deploy ke full Jakarta EE server

Biasanya:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
    <scope>provided</scope>
</dependency>
```

Runtime:

```text
Server provides API + implementation/provider
```

Cocok untuk:

- WAR/EAR deployment
- WildFly/Open Liberty/Payara/TomEE model
- enterprise apps dengan server-managed resources

### 29.2 Standalone Java SE app dengan CDI embedded

Dependency:

```text
CDI API + CDI implementation
```

Runtime:

```text
Application starts CDI container itself
```

Cocok untuk:

- CLI
- batch job
- test harness
- lightweight app

### 29.3 Framework packaged app

Misal Quarkus/Micronaut/Spring Boot-like model.

Dependency:

```text
framework extensions/starters
provider integrated by framework
```

Runtime:

```text
fat jar / fast jar / native image / container image
```

Cocok untuk:

- microservice
- container deployment
- build-time optimized runtime

Top engineer selalu bertanya:

```text
Siapa provider-nya?
Siapa container-nya?
Siapa yang punya lifecycle?
Apa yang aplikasi bundle?
Apa yang runtime sediakan?
```

---

## 30. Dependency Scope Rules for Enterprise APIs

Rule of thumb:

### Jika app server menyediakan API + implementation

Gunakan `provided` untuk API:

```xml
<scope>provided</scope>
```

Jangan bundle API/spec JAR di WAR/EAR kecuali runtime memang memintanya.

### Jika standalone runtime

Gunakan API + implementation sebagai dependency runtime.

Contoh konsep:

```text
compile: CDI API
runtime: Weld implementation
```

### Jika test

Gunakan test-scoped container/provider:

```text
test: Weld JUnit
```

### Jika memakai provider-specific feature

Tambahkan provider dependency di boundary yang tepat, jangan bocorkan ke semua module.

---

## 31. Failure Mode Catalog

### 31.1 `ClassNotFoundException`

Makna:

```text
Runtime mencoba memuat class, tetapi class tidak ada di classpath/classloader yang terlihat.
```

Kemungkinan:

- dependency tidak dibundle
- dependency `provided` padahal runtime tidak menyediakan
- salah namespace `javax`/`jakarta`
- class ada di module/classloader lain tetapi tidak visible
- server module belum enable

### 31.2 `NoClassDefFoundError`

Makna:

```text
Class pernah diketahui saat compile/link, tetapi gagal tersedia saat runtime atau gagal initialize.
```

Kemungkinan:

- missing transitive dependency
- static initializer gagal
- optional dependency tidak ada
- incompatible runtime packaging

### 31.3 `NoSuchMethodError`

Makna:

```text
Code memanggil method yang ada saat compile, tetapi tidak ada pada class runtime.
```

Kemungkinan:

- API version mismatch
- implementation version mismatch
- duplicate dependency
- server membawa versi lama
- application membundle versi salah

### 31.4 `ClassCastException: X cannot be cast to X`

Makna:

```text
Nama class sama tetapi dimuat classloader berbeda.
```

Kemungkinan:

- duplicate API JAR
- app/server classloader conflict
- EAR module isolation
- provider loaded in different module

### 31.5 CDI Unsatisfied Dependency

Makna:

```text
Tidak ada bean yang cocok untuk type + qualifier injection point.
```

Kemungkinan:

- class bukan bean
- bean archive tidak discoverable
- qualifier salah
- alternative tidak aktif
- namespace annotation salah
- provider tidak scan module tersebut

### 31.6 CDI Ambiguous Dependency

Makna:

```text
Lebih dari satu bean cocok.
```

Kemungkinan:

- dua implementation same type + qualifier
- producer dan class bean sama-sama aktif
- test mock dan real bean sama-sama aktif
- alternative/priority salah

### 31.7 ProviderNotFoundException

Makna:

```text
API mencari provider tetapi tidak menemukan implementation.
```

Kemungkinan:

- implementation dependency tidak ada
- service provider metadata tidak ada
- classloader tidak melihat provider
- module system tidak membuka provider

---

## 32. Debugging Algorithm: Layer by Layer

Saat runtime error enterprise muncul, jangan mulai dari business logic. Mulai dari layer.

### Step 1 — Identifikasi API package

Apakah `javax.*` atau `jakarta.*`?

```text
import javax.enterprise.context.ApplicationScoped
atau
import jakarta.enterprise.context.ApplicationScoped
```

### Step 2 — Identifikasi target platform

```text
Java EE 8?
Jakarta EE 9?
Jakarta EE 10?
Jakarta EE 11?
Spring Boot standalone?
Quarkus?
Plain Java SE?
```

### Step 3 — Identifikasi provider/runtime

```text
CDI provider?
JPA provider?
REST provider?
Servlet container?
Transaction manager?
```

### Step 4 — Cek dependency tree

Maven:

```bash
mvn dependency:tree
```

Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jakarta.enterprise
```

Cari:

```text
duplicate API
mixed javax/jakarta
old transitive dependency
provider-specific dependency leak
```

### Step 5 — Cek packaging

Untuk WAR:

```text
WEB-INF/lib
```

Untuk EAR:

```text
EAR/lib
module WAR/lib
server modules
```

Untuk fat JAR:

```text
BOOT-INF/lib or equivalent
```

### Step 6 — Cek server-provided dependencies

Pertanyaan:

```text
Apakah server sudah punya API ini?
Apakah aplikasi membundlenya lagi?
Versi mana yang menang?
```

### Step 7 — Cek provider discovery

Cari:

```text
META-INF/services
beans.xml
persistence.xml
web.xml
server.xml
application.xml
module descriptor
```

### Step 8 — Cek startup log

Startup log sering memberi tahu:

```text
CDI provider version
JPA provider version
REST provider version
Servlet version
Jakarta EE profile
enabled server features
```

### Step 9 — Minimal reproduction

Buat reproduksi kecil dengan:

- satu bean
- satu injection
- satu dependency
- satu runtime

Kalau reproduksi kecil jalan, problem ada di graph/packaging. Kalau tidak jalan, problem ada di platform/runtime setup.

---

## 33. Practical Dependency Tree Smells

Saat membaca dependency tree, cari smell ini:

### 33.1 Ada `javax.*` dan `jakarta.*` bersamaan

Contoh:

```text
javax.enterprise:cdi-api
jakarta.enterprise:jakarta.enterprise.cdi-api
```

Risiko tinggi.

### 33.2 Ada API JAR compile/runtime padahal deploy ke app server

Contoh:

```text
jakarta.servlet:jakarta.servlet-api:jar inside WEB-INF/lib
```

Mungkin harus `provided`.

### 33.3 Ada dua provider untuk spec yang sama

Contoh:

```text
Hibernate + EclipseLink
Weld + OpenWebBeans
Jersey + RESTEasy
```

Tidak selalu salah, tetapi harus disengaja.

### 33.4 Provider version tidak cocok dengan API

Contoh:

```text
CDI API 4.1 + old CDI provider
JPA API 3.2 + old Hibernate version
```

### 33.5 Vendor-specific dependency bocor ke domain module

Contoh:

```text
domain module depends on org.hibernate.orm
```

Harus dipertanyakan.

---

## 34. Provider Boundary Pattern

Untuk menjaga arsitektur bersih, gunakan provider boundary.

Contoh interface di application/domain boundary:

```java
public interface CaseSearchPort {
    List<CaseSearchResult> search(CaseSearchCriteria criteria);
}
```

Implementation provider-specific di infrastructure:

```java
@ApplicationScoped
public class HibernateCaseSearchAdapter implements CaseSearchPort {

    @PersistenceContext
    EntityManager entityManager;

    @Override
    public List<CaseSearchResult> search(CaseSearchCriteria criteria) {
        // Hibernate optimization may be used here if necessary
        return List.of();
    }
}
```

Kalau perlu unwrap Hibernate:

```java
Session session = entityManager.unwrap(Session.class);
```

Tetap di adapter, bukan di domain service.

Architecture rule:

```text
Provider-specific classes are allowed only at infrastructure edge.
Core application logic depends on stable ports/API.
```

---

## 35. API/SPI Boundary untuk Framework Internal

Kadang kamu membuat internal framework untuk banyak module.

Contoh:

```java
public interface AuditEventWriter {
    void write(AuditEvent event);
}
```

Application module hanya tahu API internal:

```java
@Inject
AuditEventWriter auditEventWriter;
```

Implementation bisa berbeda:

```java
@ApplicationScoped
public class DatabaseAuditEventWriter implements AuditEventWriter { }

@ApplicationScoped
public class KafkaAuditEventWriter implements AuditEventWriter { }
```

SPI internal bisa dibuat untuk plugin:

```java
public interface AuditEnricher {
    AuditEvent enrich(AuditEvent event);
}
```

Lalu semua plugin ditemukan via CDI:

```java
@Inject
Instance<AuditEnricher> enrichers;
```

Atau via ServiceLoader jika framework tidak ingin bergantung CDI.

Keputusan penting:

| Pilihan | Cocok Untuk | Risiko |
|---|---|---|
| CDI injection | enterprise app managed runtime | butuh CDI aktif |
| ServiceLoader | library/plugin generic | lifecycle/config terbatas |
| Manual registry | sederhana, explicit | boilerplate, mudah jadi service locator |
| Build-time processor | high performance framework | kompleks, sulit debug |

---

## 36. Tanda Kamu Salah Memahami Layer

Beberapa kalimat yang harus memicu alarm:

> “Saya sudah import `@Inject`, tapi kenapa dependency tidak masuk?”

Import bukan runtime.

> “Saya sudah tambah API dependency, kenapa provider tidak ditemukan?”

API bukan implementation.

> “Di local jalan, di server gagal. Mungkin servernya aneh.”

Mungkin dependency packaging/classloader berbeda.

> “Kita pakai JPA, jadi pasti portable dari Hibernate ke EclipseLink.”

Tidak kalau code memakai Hibernate-specific behavior.

> “Annotation ini tidak jalan.”

Annotation tidak “jalan”. Container yang membaca annotation dan menjalankan behavior.

> “Kita bisa campur `javax` dan `jakarta`, package-nya mirip.”

Tidak. Itu dua universe berbeda.

---

## 37. Real-World Architecture Example: Regulatory Case Management

Bayangkan sistem case management regulatory:

```text
Case Intake
  -> Case Assessment
  -> Assignment
  -> Investigation
  -> Enforcement Action
  -> Appeal
  -> Closure
```

Komponen:

```java
@ApplicationScoped
public class EnforcementDecisionService {

    private final CaseRepository caseRepository;
    private final PolicyEvaluator policyEvaluator;
    private final AuditPort auditPort;

    @Inject
    public EnforcementDecisionService(
            CaseRepository caseRepository,
            PolicyEvaluator policyEvaluator,
            AuditPort auditPort) {
        this.caseRepository = caseRepository;
        this.policyEvaluator = policyEvaluator;
        this.auditPort = auditPort;
    }
}
```

Layer analysis:

| Component | Should Depend On | Should Not Depend On |
|---|---|---|
| `EnforcementDecisionService` | CDI API minimally, application ports | Hibernate Session, vendor server API |
| `CaseRepository` interface | domain/application model | SQL/JPA provider detail |
| `JpaCaseRepository` | JPA API, maybe provider-specific extension | UI/JAX-RS classes |
| `AuditPort` | stable internal contract | concrete database/kafka implementation |
| `DatabaseAuditAdapter` | JPA/JDBC provider | policy engine internals |
| `PolicyEvaluator` | domain model/config abstraction | raw environment variable lookup everywhere |

Runtime diagram:

```text
CDI Container
  ├── EnforcementDecisionService bean
  ├── JpaCaseRepository bean
  ├── DefaultPolicyEvaluator bean
  ├── DatabaseAuditAdapter bean
  └── Config/FeatureFlag producers

JPA Provider
  └── EntityManager implementation

Transaction Manager
  └── transaction boundary around use case

Application Server
  └── hosts CDI + JPA + TX + REST + security
```

This is how top-level reasoning should look: not “class calls class”, but **managed components participating in runtime contracts**.

---

## 38. How to Choose Abstraction Level

Tidak semua code perlu abstraksi besar.

Gunakan standard API langsung jika:

- API stable
- provider tidak perlu diganti
- boundary sudah infrastructure
- behavior standard cukup

Contoh acceptable:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {
    @PersistenceContext
    EntityManager em;
}
```

Buat wrapper/port jika:

- provider-specific behavior perlu dibatasi
- dependency mahal untuk test
- integration punya failure mode sendiri
- ada kemungkinan multiple implementation
- business layer harus bebas runtime concern
- configuration/feature flag menentukan implementation

Contoh:

```java
public interface PostalCodeLookupClient {
    Address lookup(String postalCode);
}
```

Implementation bisa:

```text
OneMapPostalCodeLookupClient
CachedPostalCodeLookupClient
StubPostalCodeLookupClient
FeatureFlaggedPostalCodeLookupClient
```

---

## 39. API/SPI/Provider in Testing

Testing harus sadar layer.

### Unit test

Tidak perlu provider/container.

```java
class EnforcementDecisionServiceTest {
    @Test
    void approvesWhenPolicyAllows() {
        CaseRepository repo = new FakeCaseRepository();
        PolicyEvaluator policy = new AllowPolicyEvaluator();
        AuditPort audit = new InMemoryAuditPort();

        EnforcementDecisionService service =
                new EnforcementDecisionService(repo, policy, audit);

        // assert behavior
    }
}
```

### CDI container test

Perlu CDI provider test runtime.

Tujuan:

```text
verify bean discovery
verify injection
verify qualifiers
verify producers
verify interceptors/decorators if needed
```

### App server integration test

Perlu target runtime.

Tujuan:

```text
verify server-provided API/provider
verify JNDI/resource binding
verify transaction manager
verify REST/CDI integration
verify packaging/classloader assumptions
```

### Provider-specific integration test

Perlu provider asli.

Tujuan:

```text
verify Hibernate query behavior
verify EclipseLink behavior
verify Oracle JDBC behavior
verify transaction synchronization
```

Testing strategy yang matang tidak mencampur semua concern ke satu jenis test.

---

## 40. Library Design: Kalau Kamu Membuat Library untuk Enterprise Java

Jika kamu membuat shared library untuk banyak aplikasi enterprise, jangan sembarang bergantung pada provider.

### Library portable

```text
Depends on:
  jakarta.inject-api maybe
  jakarta.enterprise.cdi-api maybe, if CDI integration needed

Avoids:
  concrete CDI provider
  app server API
  Hibernate unless module specifically persistence adapter
```

### Library with optional integration

Pisahkan module:

```text
acme-audit-core
acme-audit-cdi
acme-audit-jpa
acme-audit-hibernate
acme-audit-microprofile-config
```

Keuntungan:

- core library ringan
- provider-specific code isolated
- user hanya ambil module yang dibutuhkan
- lebih mudah maintain compatibility

### Jangan membuat core library seperti ini

```text
acme-common
  depends on jakartaee-api
  depends on hibernate
  depends on weld
  depends on resteasy
  depends on server-specific API
```

Ini menjadi dependency bomb.

---

## 41. Anti-Patterns

### 41.1 API dependency dianggap runtime

```text
“Sudah add jakarta.enterprise.cdi-api, berarti CDI jalan.”
```

Salah. Butuh provider/container.

### 41.2 Provider dependency bocor ke semua module

```text
common/domain module depends on org.hibernate
```

Harus dibatasi.

### 41.3 Mixed namespace tanpa strategi

```text
javax.persistence + jakarta.enterprise + old library
```

Berisiko tinggi.

### 41.4 Mengandalkan vendor extension diam-diam

```text
Code tampak standard, tetapi behavior bergantung konfigurasi WildFly/Hibernate tertentu.
```

Harus didokumentasikan.

### 41.5 Membundel API yang sudah disediakan server

```text
WEB-INF/lib/jakarta.servlet-api.jar
```

Sering memicu classloader/linkage problem.

### 41.6 Tidak punya compatibility matrix

Upgrade dilakukan berdasarkan feeling.

### 41.7 Menganggap TCK compliance berarti no edge cases

Provider tetap bisa berbeda di area yang tidak ditentukan detail oleh spec.

---

## 42. Checklist Desain Dependency Enterprise

Gunakan checklist ini saat membuat module baru.

### 42.1 API Level

- [ ] API apa yang dipakai?
- [ ] Apakah API standard Jakarta/MicroProfile/Java SE?
- [ ] Apakah masih `javax.*` atau sudah `jakarta.*`?
- [ ] Apakah API version cocok dengan platform target?

### 42.2 Provider Level

- [ ] Provider apa yang menjalankan behavior?
- [ ] Apakah provider disediakan server atau aplikasi?
- [ ] Apakah provider version cocok dengan API?
- [ ] Apakah ada lebih dari satu provider untuk spec yang sama?

### 42.3 Container Level

- [ ] Siapa yang membuat object?
- [ ] Siapa yang mengelola lifecycle?
- [ ] Apakah object managed atau dibuat manual?
- [ ] Apakah injection/interceptor/transaction berjalan melalui proxy?

### 42.4 Packaging Level

- [ ] Dependency apa yang masuk artifact?
- [ ] Dependency apa yang `provided`?
- [ ] Apakah ada API JAR duplicate?
- [ ] Apakah ada mixed namespace?
- [ ] Apakah server module/feature perlu di-enable?

### 42.5 Architecture Level

- [ ] Apakah provider-specific code dibatasi di infrastructure?
- [ ] Apakah domain/application layer portable?
- [ ] Apakah vendor-specific choice didokumentasikan?
- [ ] Apakah migration path jelas?

### 42.6 Testing Level

- [ ] Ada unit test tanpa container?
- [ ] Ada CDI/container test untuk wiring?
- [ ] Ada integration test pada runtime target?
- [ ] Ada provider-specific test jika memakai extension?

---

## 43. Diagnostic Cheat Sheet

| Symptom | Likely Layer | First Check |
|---|---|---|
| `@Inject` null | ownership/container | object dibuat manual atau managed? |
| Unsatisfied dependency | CDI resolution | bean discoverable? qualifier cocok? |
| Ambiguous dependency | CDI resolution | ada multiple bean same type/qualifier? |
| `NoSuchMethodError` | API/provider mismatch | dependency tree + server version |
| `ClassNotFoundException` | packaging/classloader | dependency ada di runtime? scope benar? |
| `ClassCastException X to X` | classloader duplicate | duplicate API/provider JAR? |
| annotation ignored | namespace/discovery | `javax` vs `jakarta`? bean archive? |
| provider not found | SPI discovery | implementation dependency + `META-INF/services` |
| works local, fails server | server-provided mismatch | bundled vs provided dependency |
| works server A, fails server B | vendor-specific behavior | provider extension leaked? |

---

## 44. Practical Exercise

### Exercise 1 — Identify the Layers

Given code:

```java
@ApplicationScoped
public class ReportGenerator {

    @Inject
    EntityManager entityManager;

    public Report generate() {
        return new Report();
    }
}
```

Answer:

1. Which annotations/classes are API?
2. Which provider is responsible for CDI behavior?
3. Which provider is responsible for persistence behavior?
4. Which container creates `ReportGenerator`?
5. What happens if this class is instantiated with `new ReportGenerator()`?
6. What happens if `jakarta.persistence-api` version is newer than runtime provider?

Expected reasoning:

```text
@ApplicationScoped and @Inject are CDI/Inject API-level metadata.
EntityManager is Jakarta Persistence API.
CDI provider manages bean discovery/injection/lifecycle.
JPA provider implements EntityManager behavior.
Container must create/manage ReportGenerator.
Manual construction bypasses injection.
API/provider mismatch can cause runtime linkage or behavior failures.
```

### Exercise 2 — Read Dependency Tree Smell

Given:

```text
jakarta.enterprise:jakarta.enterprise.cdi-api:4.1.0
javax.enterprise:cdi-api:2.0
org.jboss.weld:weld-core-impl:3.x
```

Problems:

```text
mixed jakarta/javax
CDI API 4.1 with old Weld 3-era implementation likely mismatch
old javax CDI API present
high risk of classloader/resolution failure
```

### Exercise 3 — Decide Provider Boundary

You need Hibernate-specific batch fetching.

Bad:

```java
public class CaseDecisionPolicy {
    private org.hibernate.Session session;
}
```

Better:

```text
Keep Hibernate-specific optimization in Jpa/Hibernate repository adapter.
Expose provider-neutral domain data to policy layer.
Document provider-specific optimization.
```

---

## 45. Summary Mental Model

Part ini bisa diringkas menjadi beberapa invariant:

1. **API is not runtime.**
   API membuat code compile. Runtime behavior datang dari provider/container.

2. **Annotation is not behavior.**
   Annotation adalah metadata. Container/provider yang membaca dan menjalankan semantics.

3. **Specification is the contract.**
   Javadoc memberi type-level detail. Specification memberi lifecycle dan behavior contract.

4. **Provider implements the contract.**
   Weld, Hibernate, RESTEasy, Jersey, Tomcat, Undertow, dan lainnya menjalankan behavior nyata.

5. **Container owns lifecycle.**
   Kalau object dibuat manual, injection/interceptor/scope/transaction mungkin tidak berlaku.

6. **Classloader is part of type identity.**
   Class name sama tidak cukup. Classloader berbeda berarti type berbeda.

7. **`javax.*` and `jakarta.*` are different universes.**
   Jangan campur tanpa strategi migration.

8. **Provider-specific code is an architecture decision.**
   Boleh dipakai, tetapi harus dibatasi, dites, dan didokumentasikan.

9. **Compatibility matrix is mandatory for serious systems.**
   Java version, Jakarta EE version, API, provider, server, namespace, and packaging must align.

10. **Debug from layer, not from symptom.**
    Runtime error enterprise biasanya akibat mismatch antar layer.

---

## 46. What You Should Be Able to Do After This Part

Setelah memahami bagian ini, kamu harus bisa:

- membedakan API, SPI, implementation, provider, container, specification, dan TCK;
- menjelaskan kenapa API dependency tidak cukup untuk menjalankan runtime behavior;
- membaca stack trace dependency/classloader/provider mismatch;
- menentukan apakah dependency harus `provided`, `runtime`, atau dibundel;
- mengenali mixed `javax`/`jakarta` dependency risk;
- memutuskan kapan vendor-specific feature boleh dipakai;
- membatasi provider-specific code di infrastructure boundary;
- membuat compatibility matrix untuk enterprise runtime;
- men-debug masalah injection, provider discovery, dan classloading secara sistematis.

---

## 47. Bridge to Next Part

Part ini menjelaskan lapisan tersembunyi:

```text
Specification -> API/SPI -> Provider/Implementation -> Container -> Application Behavior
```

Part berikutnya akan membahas transisi besar yang sangat memengaruhi semua lapisan tersebut:

```text
Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
```

Di sana kita akan membahas:

- kenapa `javax.*` ke `jakarta.*` bukan rename biasa;
- binary/source compatibility;
- dependency graph migration;
- library compatibility;
- adapter strategy;
- migration testing;
- cara memigrasi enterprise app tanpa merusak runtime behavior.

---

# Status Seri

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[ ] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
...
[ ] Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton
```

Seri belum selesai. Ini adalah bagian 002 dari 035.
