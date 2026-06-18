# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-032

# Part 032 — Observability and Debugging of Dependency/Container Problems

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Bagian: `032`  
> Topik: Observability and Debugging of Dependency/Container Problems  
> Target: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, Enterprise Beans, MicroProfile Config, container runtime

---

## 0. Tujuan Bagian Ini

Setelah bagian-bagian sebelumnya, kita sudah memahami:

- dependency management,
- API/SPI/implementation/provider,
- migrasi `javax.*` ke `jakarta.*`,
- container ownership,
- classloader,
- DI fundamentals,
- Jakarta Inject,
- CDI bean model,
- bean discovery,
- scopes,
- proxies,
- qualifiers,
- producers,
- events,
- interceptors,
- decorators,
- stereotypes,
- lifecycle callbacks,
- CDI extensions,
- Enterprise Beans,
- resource injection,
- JNDI,
- configuration,
- profiles,
- feature flags,
- conditional beans,
- managed concurrency,
- dan testing runtime-heavy code.

Bagian ini adalah **debugging and observability playbook**.

Di level junior, debugging biasanya dimulai dari:

```text
Ada error. Cari stack trace. Google error. Coba-coba annotation.
```

Di level senior/top-tier, debugging container/runtime dimulai dari:

```text
Pada fase runtime mana error terjadi?
Object ini dimiliki oleh siapa?
Bean ini discoverable atau tidak?
Dependency ini compile-time, deploy-time, startup-time, atau request-time?
Class ini dimuat oleh classloader mana?
Injection point ini resolve ke kandidat mana?
Proxy ini melewati interceptor/decorator atau tidak?
Config value ini berasal dari source mana?
Resource name ini binding ke namespace mana?
```

Tujuan bagian ini: membentuk kemampuan **mendiagnosis masalah enterprise Java secara struktural**, bukan menebak-nebak.

---

## 1. Mental Model Utama: Runtime Problem Bukan Satu Jenis

Masalah di aplikasi Jakarta/CDI/EJB/config-heavy sering terlihat mirip:

```text
Deployment failed.
Injection failed.
Bean not found.
Class not found.
Context not active.
Config missing.
Resource lookup failed.
Interceptor not called.
Transaction not active.
```

Tetapi akar masalahnya bisa berada di layer yang berbeda.

Gunakan model berikut:

```text
Source Code
   |
   v
Build Dependency Graph
   |
   v
Artifact Packaging
   |
   v
Classloader Visibility
   |
   v
Bean Discovery
   |
   v
Bean Resolution
   |
   v
Proxy / Interceptor / Decorator Construction
   |
   v
Lifecycle Initialization
   |
   v
Configuration Binding
   |
   v
Resource Binding / JNDI
   |
   v
Request / Transaction / Security / Context Runtime
   |
   v
Business Invocation
```

Jika kita salah layer, solusi kita biasanya salah.

Contoh:

| Gejala | Dugaan dangkal | Diagnosis struktural yang benar |
|---|---|---|
| `Unsatisfied dependency` | class belum dibuat | bisa jadi bean tidak discoverable, qualifier salah, module tidak visible, alternative belum aktif |
| `NoClassDefFoundError` | dependency belum ditambahkan | bisa jadi dependency ada di compile tapi tidak masuk runtime, server sudah punya API berbeda, classloader split |
| Interceptor tidak jalan | annotation salah | bisa jadi self-invocation, interceptor belum enabled, binding salah target, method final/private |
| Config value salah | env var salah | bisa jadi source precedence lebih tinggi menimpa, profile aktif berbeda, env var mapping berbeda |
| `ContextNotActiveException` | CDI rusak | bisa jadi request-scoped bean dipakai di thread async tanpa context activation |
| `NameNotFoundException` | JNDI name typo | bisa jadi name relatif `java:comp/env`, resource belum bound di server, namespace salah untuk module |

---

## 2. Debugging by Phase: Jangan Mulai dari Stack Trace Saja

Stack trace penting, tetapi stack trace adalah **symptom trace**, bukan selalu **cause trace**.

Pertanyaan pertama:

```text
Error terjadi di fase apa?
```

### 2.1 Fase build/compile

Gejala:

- compilation error,
- missing import,
- package `javax.*`/`jakarta.*` tidak ditemukan,
- annotation class tidak ditemukan,
- method tidak ada saat compile.

Biasanya terkait:

- dependency declaration,
- version mismatch,
- namespace mismatch,
- BOM salah,
- source/target Java salah.

### 2.2 Fase packaging

Gejala:

- WAR/EAR/JAR tidak berisi dependency yang diperlukan,
- duplicate JAR,
- dependency masuk padahal harus `provided`,
- API JAR ikut dibundel ke server yang sudah menyediakan API.

Biasanya terkait:

- Maven scope,
- Gradle configuration,
- plugin packaging,
- shaded/fat JAR,
- EAR lib layout,
- container-provided libraries.

### 2.3 Fase deployment/bootstrap

Gejala:

- deployment exception,
- CDI validation failed,
- unsatisfied/ambiguous dependency,
- unproxyable type,
- failed resource injection,
- config required missing,
- extension failure.

Biasanya terkait:

- bean discovery,
- classloader visibility,
- CDI resolution,
- producer failure,
- lifecycle callback failure,
- resource binding,
- config validation.

### 2.4 Fase first request / first invocation

Gejala:

- lazy initialization failure,
- interceptor not applied,
- transaction not active,
- context not active,
- proxy target failure,
- config dynamically missing.

Biasanya terkait:

- lazy resource,
- request context,
- thread boundary,
- dynamic lookup,
- self-invocation,
- optional feature path.

### 2.5 Fase long-running production

Gejala:

- memory leak,
- stale config,
- context leak,
- feature flag inconsistent,
- connection pool exhaustion,
- timer duplicate,
- async task stuck,
- startup gradually slower.

Biasanya terkait:

- scope misuse,
- unclosed resource,
- producer/disposer mismatch,
- config reload inconsistency,
- context propagation failure,
- unmanaged executor,
- classloader leak after redeploy.

---

## 3. Failure Taxonomy Enterprise Java

Gunakan taxonomy berikut untuk mengklasifikasikan masalah.

```text
A. Dependency graph problem
B. Namespace problem
C. Packaging problem
D. Classloader visibility problem
E. Bean discovery problem
F. Bean resolution problem
G. Proxy problem
H. Interceptor/decorator problem
I. Lifecycle problem
J. Configuration problem
K. Resource/JNDI problem
L. Transaction problem
M. Context propagation problem
N. Security context problem
O. Concurrency/runtime saturation problem
P. Vendor/platform compatibility problem
```

Top 1% engineer tidak sekadar tahu daftar error. Mereka tahu error itu masuk kelas mana.

---

## 4. Dependency Graph Problem

Dependency graph problem terjadi sebelum container bicara soal CDI. Container tidak bisa mengelola class yang tidak ada, salah versi, atau binary-incompatible.

### 4.1 Gejala umum

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
NoSuchFieldError
IncompatibleClassChangeError
LinkageError
AbstractMethodError
```

### 4.2 Makna tiap error

#### `ClassNotFoundException`

Class dicari secara eksplisit, biasanya via reflection/classloader, tetapi tidak ditemukan.

Contoh:

```text
java.lang.ClassNotFoundException: jakarta.enterprise.context.ApplicationScoped
```

Kemungkinan:

- CDI API tidak tersedia di runtime,
- menggunakan standalone Java SE tanpa CDI dependencies,
- deploy ke server lama yang belum Jakarta,
- dependency scope salah.

#### `NoClassDefFoundError`

Class pernah diketahui saat compile/linking, tetapi gagal ditemukan saat runtime ketika class tersebut diperlukan.

Kemungkinan:

- dependency ada saat compile tapi tidak ikut runtime,
- transitive dependency hilang,
- optional dependency tidak tersedia,
- class initialization sebelumnya gagal.

#### `NoSuchMethodError`

Class ada, tetapi method yang dipanggil tidak ada di versi runtime.

Ini hampir selalu sinyal **version mismatch**.

Contoh mental:

```text
Compile pakai library A v2.
Runtime yang loaded adalah library A v1.
Bytecode memanggil method baru v2.
Runtime v1 tidak punya method itu.
```

#### `ClassCastException: X cannot be cast to X`

Jika nama class sama tetapi tidak bisa cast ke dirinya sendiri, hampir pasti class dimuat oleh **dua classloader berbeda**.

```text
com.acme.Service cannot be cast to com.acme.Service
```

Makna sebenarnya:

```text
com.acme.Service loaded by ClassLoader A
!=
com.acme.Service loaded by ClassLoader B
```

---

## 5. Dependency Graph Diagnostic Checklist

### 5.1 Maven

```bash
mvn -q dependency:tree
mvn -q dependency:tree -Dincludes=jakarta.*
mvn -q dependency:tree -Dincludes=javax.*
mvn -q dependency:tree -Dverbose
```

Cari:

- duplicate API,
- mixed `javax` and `jakarta`,
- lebih dari satu versi dependency penting,
- implementation library masuk dua kali,
- dependency yang harus `provided` tetapi masuk `compile/runtime`,
- dependency yang harus runtime tetapi malah `provided`.

### 5.2 Gradle

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jakarta.enterprise
./gradlew dependencyInsight --dependency javax.enterprise
./gradlew dependencyInsight --dependency weld
./gradlew dependencyInsight --dependency hibernate
```

Cari:

- selected version,
- conflict resolution,
- forced version,
- platform/BOM override,
- capability conflict,
- transitive pull yang tidak disengaja.

### 5.3 Dependency invariant

Untuk Jakarta EE app server deployment, biasanya invariant-nya:

```text
Application code uses API packages from the same namespace generation.
Server provides Jakarta EE APIs.
Application does not bundle conflicting Jakarta EE API JARs unless runtime model requires it.
Implementation provider versions match server/platform.
```

Untuk standalone/embedded runtime:

```text
Application must include both API and implementation/provider needed at runtime.
No assumption that external container provides CDI/JPA/Servlet/JTA services.
```

---

## 6. Namespace Problem: `javax.*` vs `jakarta.*`

Namespace problem adalah salah satu sumber error paling mahal sejak Jakarta EE 9.

### 6.1 Bentuk masalah

```text
Application code imports jakarta.enterprise.context.ApplicationScoped.
Third-party library still expects javax.enterprise.context.ApplicationScoped.
Runtime only provides jakarta.*.
```

Atau sebaliknya:

```text
Application code still javax.*.
Server modern only supports jakarta.*.
```

### 6.2 Gejala

- class not found,
- annotation tidak dikenali,
- bean tidak discoverable,
- provider tidak match,
- deployment gagal,
- runtime integration diam-diam tidak aktif.

### 6.3 Diagnostic query

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
jar tf app.war | grep 'javax/'
jar tf app.war | grep 'jakarta/'
```

Untuk source:

```bash
grep -R "import javax\." src/main/java
grep -R "import jakarta\." src/main/java
```

### 6.4 Rule

Jangan berpikir:

```text
javax dan jakarta itu sama, cuma beda nama.
```

Lebih benar:

```text
javax.* and jakarta.* are different binary universes.
```

---

## 7. Packaging Problem

Packaging problem terjadi saat dependency graph benar di build, tetapi artifact runtime salah.

### 7.1 Contoh umum

- WAR tidak berisi library internal.
- EAR lib tidak visible ke module tertentu.
- API JAR ikut masuk ke WAR dan bentrok dengan server.
- Fat JAR memasukkan dua provider CDI/JPA.
- Native image/build-time augmentation menghapus bean karena dianggap unused.

### 7.2 Diagnosis artifact

```bash
jar tf target/app.war | sort > war-content.txt
jar tf target/app.jar | sort > jar-content.txt
jar tf target/app.ear | sort > ear-content.txt
```

Cari:

```text
WEB-INF/lib/
META-INF/beans.xml
WEB-INF/beans.xml
META-INF/services/
META-INF/microprofile-config.properties
```

### 7.3 Packaging invariant

```text
The artifact must contain what the runtime does not provide.
The artifact must not contain what the runtime already provides incompatibly.
The metadata required for discovery must be in the right place.
```

---

## 8. Classloader Visibility Problem

Classloader problem adalah penyebab banyak masalah yang terlihat seperti DI problem.

### 8.1 Mental model

```text
A class is not identified only by its fully qualified name.
A class is identified by:
  - fully qualified name
  - defining classloader
```

Jadi:

```text
com.acme.Foo loaded by WAR classloader
```

berbeda dengan:

```text
com.acme.Foo loaded by EAR/lib classloader
```

### 8.2 Common failure

```text
ClassCastException: com.acme.User cannot be cast to com.acme.User
```

Ini biasanya bukan karena class aneh. Ini karena duplicate loading.

### 8.3 Diagnostic logging

Tambahkan debug sementara:

```java
static void printClassOrigin(Class<?> type) {
    System.out.println("class=" + type.getName());
    System.out.println("loader=" + type.getClassLoader());
    System.out.println("codeSource=" +
        type.getProtectionDomain().getCodeSource());
}
```

Untuk instance:

```java
printClassOrigin(instance.getClass());
printClassOrigin(MyService.class);
```

Jika loader atau codeSource berbeda, ada classloader split.

### 8.4 Classloader checklist

- Apakah dependency ada di `WEB-INF/lib` dan server module sekaligus?
- Apakah EAR/lib punya versi berbeda dari WAR?
- Apakah shared library server memuat API yang juga dibundel app?
- Apakah library internal dipasang sebagai server module padahal app juga membawa versi sendiri?
- Apakah deployment isolation berubah antar environment?

---

## 9. Bean Discovery Problem

Bean discovery problem terjadi ketika class ada dan visible, tetapi CDI tidak menganggapnya sebagai bean.

### 9.1 Gejala

```text
Unsatisfied dependency for type PaymentGateway with qualifiers @Default
```

Padahal class `StripePaymentGateway` ada.

Kemungkinan:

- class tidak punya bean-defining annotation,
- `beans.xml` discovery mode `none`,
- archive tidak dianggap bean archive,
- package namespace salah,
- bean class tidak visible ke module injection point,
- conditional build/runtime menghapus bean,
- native/build-time indexing tidak menemukan class.

### 9.2 Discovery invariant

```text
A class must be both visible and discoverable to become a CDI bean.
```

Visibility bukan discovery.

```text
classpath contains class
!=
CDI container registers bean
```

### 9.3 Yang dicek

```text
Is there beans.xml?
What is bean-discovery-mode?
Does the class have a bean-defining annotation?
Is it in the deployment module scanned by CDI?
Is it excluded by extension/build-time filtering?
Is the annotation jakarta.* or javax.*?
```

### 9.4 Example

```java
public class AuditService {
}
```

Class ini mungkin tidak menjadi bean jika discovery mode `annotated` dan tidak ada bean-defining annotation.

Lebih eksplisit:

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class AuditService {
}
```

---

## 10. Bean Resolution Problem

Bean resolution problem terjadi ketika CDI sudah punya daftar bean, tetapi injection point tidak resolve ke tepat satu bean.

CDI type-safe resolution secara konseptual:

```text
candidate beans
  -> filter by assignable bean type
  -> filter by qualifier
  -> apply alternatives / priority / specialization rules
  -> result must be exactly one resolvable bean
```

### 10.1 Unsatisfied dependency

Makna:

```text
No bean matched the injection point type + qualifiers.
```

Contoh:

```java
@Inject
PaymentGateway gateway;
```

Candidate:

```java
@ApplicationScoped
@Stripe
class StripeGateway implements PaymentGateway {}
```

Jika injection point tidak punya `@Stripe`, maka bean dengan qualifier `@Stripe` mungkin tidak match `@Default`.

Fix:

```java
@Inject
@Stripe
PaymentGateway gateway;
```

Atau beri bean `@Default` jika memang default.

### 10.2 Ambiguous dependency

Makna:

```text
More than one bean matched the injection point type + qualifiers.
```

Contoh:

```java
@ApplicationScoped
class StripeGateway implements PaymentGateway {}

@ApplicationScoped
class PaypalGateway implements PaymentGateway {}

@Inject
PaymentGateway gateway;
```

Fix yang benar bukan asal `@Named`, tetapi membuat routing semantik:

```java
@Qualifier
@Retention(RUNTIME)
@Target({TYPE, FIELD, PARAMETER, METHOD})
public @interface PrimaryPayment {}
```

Lalu:

```java
@ApplicationScoped
@PrimaryPayment
class StripeGateway implements PaymentGateway {}

@Inject
@PrimaryPayment
PaymentGateway gateway;
```

### 10.3 Resolution checklist

Untuk setiap injection error, tulis:

```text
Injection point:
  type      = ?
  qualifiers= ?
  module    = ?

Candidate beans:
  bean class = ?
  bean types = ?
  qualifiers = ?
  scope = ?
  enabled alternative? = ?
  specialized? = ?
  priority? = ?
```

Jika ini tidak bisa dijawab, debugging masih belum struktural.

---

## 11. Proxy Problem

Proxy problem terjadi ketika CDI perlu membuat proxy tetapi tipe bean tidak proxyable.

### 11.1 Kenapa proxy diperlukan?

Normal-scoped bean seperti `@ApplicationScoped`, `@RequestScoped`, `@SessionScoped` biasanya diinjeksi sebagai client proxy.

Injection point menerima proxy. Proxy akan resolve contextual instance yang benar saat method dipanggil.

```text
injected reference
   |
   v
client proxy
   |
   v
current contextual instance
```

### 11.2 Gejala

```text
UnproxyableResolutionException
Cannot create proxy for class ...
```

Penyebab umum:

- class final,
- method final tertentu,
- constructor no-arg tidak tersedia pada provider tertentu,
- primitive/array type sebagai normal-scoped bean,
- sealed class/proxy restrictions,
- visibility constructor/method tidak memungkinkan proxy generation.

### 11.3 Fix patterns

#### Pattern A — gunakan interface

```java
public interface PricingService {
    Money calculatePrice(Order order);
}

@ApplicationScoped
public class DefaultPricingService implements PricingService {
    public Money calculatePrice(Order order) { ... }
}
```

Injection:

```java
@Inject
PricingService pricingService;
```

#### Pattern B — jangan final untuk managed service

```java
@ApplicationScoped
public class AuditService {
}
```

Hindari:

```java
@ApplicationScoped
public final class AuditService {
}
```

#### Pattern C — gunakan `@Dependent` dengan sadar

`@Dependent` tidak normal scope, tetapi mengganti scope hanya untuk menghindari proxy sering menyembunyikan masalah lifecycle.

Jangan jadikan `@Dependent` sebagai quick fix tanpa analisis.

---

## 12. Interceptor and Decorator Problem

### 12.1 Gejala

- interceptor tidak terpanggil,
- decorator tidak membungkus call,
- audit/metrics tidak muncul,
- transaction annotation tidak berefek,
- retry tidak jalan,
- security check tidak terjadi.

### 12.2 Root cause umum

#### Self-invocation

```java
@ApplicationScoped
public class CaseService {

    public void submit() {
        validate(); // direct self-call, does not go through proxy
    }

    @Audited
    public void validate() {
    }
}
```

Karena call tidak melewati proxy/container, interceptor bisa tidak aktif.

Fix:

- pindahkan intercepted method ke bean lain,
- panggil melalui injected proxy,
- desain boundary method dengan jelas.

#### Method tidak interceptable

- private method,
- static method,
- final method,
- constructor logic,
- call dari dalam object sendiri.

#### Binding annotation salah target

```java
@Target(TYPE)
```

padahal dipakai di method.

Atau retention bukan runtime:

```java
@Retention(CLASS)
```

padahal interceptor butuh runtime metadata.

#### Interceptor belum enabled / priority salah

CDI interceptor membutuhkan binding dan enablement/order yang benar, tergantung model `beans.xml` atau `@Priority`.

### 12.3 Debugging checklist

```text
Is the called object a CDI proxy or raw instance?
Is the method public/non-final/interceptable?
Is the call external or self-invocation?
Is interceptor binding retained at runtime?
Is target correct: TYPE/METHOD?
Is interceptor enabled?
Is ordering as expected?
Are multiple interceptors overriding each other's behavior?
```

---

## 13. Lifecycle Problem

Lifecycle problem terjadi ketika kode dijalankan pada fase yang salah.

### 13.1 Constructor misuse

Di constructor:

- injected fields belum tersedia,
- proxy mungkin belum siap,
- config injection belum selesai,
- resource injection belum selesai,
- interceptor tidak berlaku.

Buruk:

```java
@ApplicationScoped
public class ReportService {
    @Inject
    AuditService audit;

    public ReportService() {
        audit.record("init"); // audit masih null
    }
}
```

Lebih benar:

```java
@PostConstruct
void init() {
    audit.record("init");
}
```

Tetapi `@PostConstruct` juga jangan disalahgunakan untuk semua heavy work.

### 13.2 Heavy startup failure

Jika `@PostConstruct` melakukan:

- network call,
- DB migration,
- external API handshake,
- long cache warmup,
- lock distributed,

startup bisa menjadi lambat atau gagal total.

Pertanyaan desain:

```text
Apakah service boleh gagal deploy jika dependency eksternal down?
Atau harus start degraded lalu health check degraded?
```

### 13.3 `@PreDestroy` not called assumption

`@PreDestroy` berguna untuk cleanup, tetapi jangan membuat correctness bisnis bergantung pada callback ini selalu berhasil.

Pada crash process, kill -9, node eviction, OOM, atau hardware failure, callback bisa tidak berjalan.

Invariant:

```text
PreDestroy is cleanup hook, not business guarantee.
```

---

## 14. Configuration Problem

Configuration problem sering terlihat sebagai business bug.

### 14.1 Gejala

- wrong endpoint,
- wrong timeout,
- feature active di env salah,
- secret invalid,
- env var tidak terbaca,
- property default diam-diam dipakai di production,
- value berubah di satu node tapi tidak di node lain.

### 14.2 Config source precedence

MicroProfile Config membentuk merged view dari banyak `ConfigSource`. Default umum:

```text
System properties                         ordinal 400
Environment variables                     ordinal 300
META-INF/microprofile-config.properties   ordinal 100
```

Artinya property file dalam aplikasi bisa dikalahkan oleh env var/system property.

### 14.3 Debugging config value

Jangan hanya tanya:

```text
Value-nya apa?
```

Tanya:

```text
Value berasal dari source mana?
Source ordinal berapa?
Apakah ada source lebih tinggi yang override?
Apakah profile aktif mengubah value?
Apakah env var mapping benar?
Apakah value dibaca sekali saat startup atau dynamic?
Apakah semua replica membaca value sama?
```

### 14.4 Safe config dump

Buat endpoint/log internal yang bisa menampilkan metadata config tanpa leak secret.

Contoh output aman:

```json
{
  "app.payment.timeout.ms": {
    "value": "5000",
    "source": "environment variables",
    "ordinal": 300,
    "sensitive": false
  },
  "app.payment.api-key": {
    "value": "****",
    "source": "kubernetes secret",
    "ordinal": 350,
    "sensitive": true
  }
}
```

Jangan log secret mentah.

### 14.5 Required config invariant

Untuk config penting:

```text
Fail fast on missing required config.
Fail fast on invalid format.
Fail fast on unsafe prod default.
Expose effective non-secret config source.
```

---

## 15. Resource / JNDI Problem

Resource problem umum pada app server dan deployment tradisional.

### 15.1 Gejala

```text
NameNotFoundException
NoInitialContextException
Resource injection failed
DataSource not found
JMS ConnectionFactory not bound
```

### 15.2 Naming mental model

JNDI name bukan sekadar string global. Ada namespace dan scoping.

Contoh:

```text
java:comp/env/jdbc/AppDS
java:module/...
java:app/...
java:global/...
```

`java:comp/env` adalah namespace default penting untuk resource reference dalam model Jakarta EE.

### 15.3 Common mistake

Mengira ini sama:

```text
jdbc/AppDS
java:comp/env/jdbc/AppDS
java:global/jdbc/AppDS
```

Padahal tidak.

### 15.4 Diagnostic checklist

```text
Where is the resource declared?
Where is it bound by server?
Is the app using resource-ref indirection?
Is the lookup relative or absolute?
Is the current component allowed to access java:comp/env?
Is the resource type matching expected type?
Is the server environment configured in this deployment slot?
```

### 15.5 CDI bridge pattern

Daripada lookup JNDI tersebar:

```java
@ApplicationScoped
public class DataSourceProducer {

    @Resource(lookup = "java:comp/env/jdbc/AppDS")
    DataSource dataSource;

    @Produces
    @ApplicationScoped
    public DataSource dataSource() {
        return dataSource;
    }
}
```

Kemudian aplikasi lain cukup:

```java
@Inject
DataSource dataSource;
```

Tetapi pastikan ownership jelas: DataSource tetap resource container, bukan resource buatan CDI.

---

## 16. Transaction Problem

### 16.1 Gejala

- data tidak rollback,
- data rollback padahal tidak diharapkan,
- lazy loading gagal,
- nested transaction tidak sesuai harapan,
- `TransactionRequiredException`,
- `RollbackException`,
- database lock lama,
- transaction timeout.

### 16.2 Pertanyaan diagnosis

```text
Who starts the transaction?
EJB container?
CDI interceptor?
JTA UserTransaction?
Framework-specific transaction manager?
Database auto-commit?
```

Jika tidak tahu siapa yang memulai transaksi, debugging akan kacau.

### 16.3 Boundary checklist

```text
Method yang dipanggil melewati proxy/container?
Annotation transaction ada di method yang benar?
Self-invocation terjadi?
Exception checked atau unchecked?
Rollback rule eksplisit?
Call async keluar dari transaction context?
Resource enlisted ke JTA transaction?
DB operation memakai connection yang sama?
```

### 16.4 Logging transaction identity

Untuk debugging berat, log correlation:

```text
requestId
caseId
thread
transaction active?
transaction key/id if available
method boundary
exception type
rollbackOnly?
```

Hati-hati: API untuk detail transaction id bisa vendor-specific.

---

## 17. Context Propagation Problem

Context problem biasanya muncul ketika code melewati thread boundary.

### 17.1 Gejala

```text
ContextNotActiveException
RequestScoped bean not available
Security principal null
MDC lost
Tenant context lost
Transaction not active
```

### 17.2 Penyebab

- memakai `new Thread()` dalam container,
- memakai unmanaged executor,
- `CompletableFuture.supplyAsync()` default common pool,
- callback library berjalan di thread non-container,
- request scope dipakai setelah request selesai,
- context disimpan di ThreadLocal tanpa propagation.

### 17.3 Better model

Gunakan:

- `ManagedExecutorService`,
- MicroProfile Context Propagation,
- explicit context object,
- immutable command/event payload,
- correlation id propagation.

### 17.4 Rule

```text
Thread boundary is also context boundary unless explicitly propagated.
```

---

## 18. Security Context Problem

### 18.1 Gejala

- user principal null,
- roles tidak terbaca,
- `@RolesAllowed` tidak berefek,
- call async kehilangan identity,
- scheduled job berjalan tanpa expected identity,
- run-as tidak sesuai.

### 18.2 Diagnosis

```text
Is this code called inside container-managed request?
Is this method invoked through container proxy?
Is security annotation on interceptable method?
Is the identity propagated to async execution?
Is run-as configured?
Is the role mapping environment-specific?
```

### 18.3 Observability

Log aman:

```text
principalName/hash
roles count / selected role names if non-sensitive
auth mechanism
request id
method boundary
security decision allow/deny
```

Jangan log token mentah, session id mentah, authorization header, atau PII.

---

## 19. Observability Signals yang Perlu Ada

Runtime-heavy application perlu lebih dari business logs.

### 19.1 Startup observability

Log saat startup:

```text
application version
build commit
Java version
Jakarta/MicroProfile/runtime version
active profile
config source summary
non-secret effective config hash
feature flag provider status
datasource binding status
CDI startup success/failure
migration/schema version
```

### 19.2 Dependency observability

Simpan artifact:

```text
dependency tree
SBOM
effective POM / Gradle dependency lock
runtime classpath summary
container version
```

Ini sangat penting untuk incident postmortem.

### 19.3 CDI observability

Untuk development/staging:

```text
bean count
selected alternatives
enabled interceptors
enabled decorators
registered extensions
producer failures
ambiguous/unsatisfied validation errors
```

Tidak semua runtime menyediakan hal ini secara portable, tetapi banyak provider/server punya debug mode.

### 19.4 Config observability

```text
active sources
source ordinals
effective non-secret values
missing required config
unsafe defaults
profile overlays
config reload count
last reload timestamp
```

### 19.5 Resource observability

```text
datasource name
pool active/idle/max
connection acquisition time
JMS connection status
JNDI binding validation
external connector health
```

### 19.6 Context observability

```text
request id
correlation id
tenant/agency id
principal
thread name
executor name
transaction active
feature flag decision id
```

---

## 20. Logging Patterns for Container Problems

### 20.1 Good log shape

```json
{
  "event": "cdi.bean.resolution.failure",
  "injectionPoint": "CaseService.paymentGateway",
  "requiredType": "PaymentGateway",
  "qualifiers": ["@Default"],
  "module": "case-management.war",
  "phase": "deployment",
  "message": "No matching bean found"
}
```

### 20.2 Bad log shape

```text
Error happened
```

Atau:

```text
Exception: null
```

### 20.3 Good boundary log

```json
{
  "event": "runtime.boundary.enter",
  "boundary": "CaseSubmissionService.submit",
  "requestId": "req-123",
  "caseId": "CASE-2026-001",
  "principal": "hash:abc123",
  "tenant": "agency-a",
  "transactionExpected": true,
  "featureFlags": {
    "new-case-routing": "enabled"
  }
}
```

### 20.4 Do not log

- raw password,
- raw token,
- private key,
- session id,
- full PII payload,
- large serialized entity graph,
- database connection string with password,
- feature targeting rule containing sensitive user data.

---

## 21. Metrics for Runtime/Container Health

### 21.1 Startup metrics

```text
app_startup_duration_seconds
cdi_bootstrap_duration_seconds
config_load_duration_seconds
resource_binding_validation_duration_seconds
```

### 21.2 CDI/runtime metrics

```text
cdi_context_not_active_total
cdi_producer_failure_total
cdi_event_observer_failure_total
interceptor_invocation_total
interceptor_failure_total
decorator_invocation_total
```

### 21.3 Config metrics

```text
config_missing_required_total
config_reload_total
config_reload_failure_total
config_source_active_count
feature_flag_evaluation_total
feature_flag_evaluation_failure_total
feature_flag_cache_stale_total
```

### 21.4 Resource metrics

```text
datasource_pool_active
datasource_pool_idle
datasource_pool_pending
datasource_connection_acquire_seconds
datasource_connection_timeout_total
jndi_lookup_failure_total
```

### 21.5 Context/concurrency metrics

```text
managed_executor_active_threads
managed_executor_queue_depth
managed_executor_rejected_total
context_propagation_failure_total
async_task_duration_seconds
async_task_failure_total
```

---

## 22. Tracing Runtime Boundaries

Tracing berguna ketika call melewati:

- REST boundary,
- service boundary,
- transaction boundary,
- async boundary,
- CDI event boundary,
- message boundary,
- external connector boundary.

### 22.1 Span naming

Gunakan nama yang stabil:

```text
CaseSubmissionService.submit
PaymentGateway.charge
AuditTrailWriter.record
FeatureFlagClient.evaluate
ExternalRegistryClient.lookup
```

Jangan gunakan nama span yang terlalu dinamis:

```text
submit case CASE-123 user fajar agency ABC
```

Data dinamis masuk attribute, bukan span name.

### 22.2 Useful span attributes

```text
component.kind = cdi-bean / ejb / producer / interceptor / decorator
bean.scope = ApplicationScoped / RequestScoped / Stateless
transaction.active = true/false
feature.flag.key = new-routing
feature.flag.variant = enabled
config.profile = uat
resource.name = jdbc/AppDS
async = true/false
```

### 22.3 Trace edge case

Jangan trace semua method kecil. Trace boundary yang menjelaskan ownership dan latency.

---

## 23. Debugging Playbook: Unsatisfied Dependency

### 23.1 Symptom

```text
Unsatisfied dependency for type X with qualifiers Y
```

### 23.2 Flow

```text
1. Confirm injection point type and qualifiers.
2. Confirm expected implementation exists in source.
3. Confirm expected implementation is packaged.
4. Confirm module/classloader visibility.
5. Confirm it is a bean archive / discoverable.
6. Confirm bean-defining annotation or beans.xml discovery mode.
7. Confirm qualifiers match exactly.
8. Confirm alternative is enabled if expected.
9. Confirm namespace consistency: javax vs jakarta.
10. Confirm build-time/container-specific exclusion did not remove it.
```

### 23.3 Common fixes

- add bean-defining annotation,
- correct qualifier,
- add missing dependency,
- change Maven scope,
- ensure library packaged in correct module,
- enable alternative,
- align namespace,
- add `beans.xml` if required by deployment model.

---

## 24. Debugging Playbook: Ambiguous Dependency

### 24.1 Symptom

```text
Ambiguous dependency for type X with qualifiers Y
```

### 24.2 Flow

```text
1. List all candidate beans matching type.
2. List qualifiers of each candidate.
3. Determine which one should be selected semantically.
4. Add qualifier if variants are valid alternatives.
5. Use @Alternative/@Priority if environment/test replacement.
6. Use @Specializes only when replacing superclass implementation intentionally.
7. Avoid @Named as arbitrary disambiguator unless name is truly part of contract.
```

### 24.3 Bad fix

```java
@Named("foo")
```

hanya untuk membuat ambiguity hilang tanpa semantic meaning.

### 24.4 Better fix

```java
@PrimaryCaseRouter
@ExperimentalCaseRouter
@LegacyCaseRouter
```

Qualifier harus menjelaskan routing intent.

---

## 25. Debugging Playbook: Context Not Active

### 25.1 Symptom

```text
ContextNotActiveException: Request context is not active
```

### 25.2 Flow

```text
1. Identify injected bean scope.
2. Identify current thread.
3. Is this inside HTTP request/container invocation?
4. Is this inside async callback?
5. Was the contextual reference captured and used later?
6. Should this bean be request-scoped at all?
7. Should explicit context propagation be used?
8. Should data be extracted into immutable command instead of passing scoped bean?
```

### 25.3 Common bad pattern

```java
@Inject
RequestContext requestContext;

executor.submit(() -> service.process(requestContext));
```

### 25.4 Better pattern

```java
CaseCommand command = CaseCommand.from(requestContext);
managedExecutor.submit(() -> service.process(command));
```

Pass data, not request-scoped object.

---

## 26. Debugging Playbook: Interceptor Not Called

### 26.1 Flow

```text
1. Is the object container-managed?
2. Is method invoked through proxy?
3. Is it self-invocation?
4. Is method interceptable?
5. Is binding annotation retained at runtime?
6. Is binding target valid?
7. Is interceptor enabled?
8. Is there priority/order conflict?
9. Is the annotation placed on implementation or interface as expected by runtime?
10. Is CDI Lite/runtime subset limiting feature?
```

### 26.2 Fast test

Add temporary log inside interceptor:

```java
@AroundInvoke
Object around(InvocationContext ctx) throws Exception {
    log.info("intercepted {}.{}", 
        ctx.getMethod().getDeclaringClass().getName(),
        ctx.getMethod().getName());
    return ctx.proceed();
}
```

If never logged, invocation never reached interceptor chain.

---

## 27. Debugging Playbook: Config Value Wrong

### 27.1 Flow

```text
1. Print effective key.
2. Print effective value redacted if sensitive.
3. Print source name.
4. Print source ordinal.
5. Print active profile.
6. Print all candidate values by source if possible.
7. Check env var name mapping.
8. Check container secret/configmap injection.
9. Check whether value is read once or dynamic.
10. Check replica consistency.
```

### 27.2 Example investigation table

| Key | Expected | Actual | Source | Ordinal | Diagnosis |
|---|---:|---:|---|---:|---|
| `case.routing.enabled` | `false` | `true` | env var | 300 | env var overrides file |
| `payment.timeout.ms` | `5000` | `1000` | system property | 400 | startup arg overrides Kubernetes config |
| `audit.writer.mode` | `db` | `noop` | default file | 100 | missing environment override |

---

## 28. Debugging Playbook: JNDI Resource Not Found

### 28.1 Flow

```text
1. Determine exact lookup name.
2. Determine whether name is relative or absolute.
3. Determine component namespace.
4. Confirm resource-ref declaration if used.
5. Confirm server binding exists.
6. Confirm resource type matches injection field/type.
7. Confirm environment-specific deployment has same binding.
8. Confirm module has access to namespace.
9. Confirm app server logs during deployment.
```

### 28.2 Example

Error:

```text
NameNotFoundException: jdbc/AppDS
```

Question:

```text
Did code lookup jdbc/AppDS, java:comp/env/jdbc/AppDS, or java:global/jdbc/AppDS?
```

Those are not equivalent.

---

## 29. Debugging Playbook: Transaction Not Working

### 29.1 Flow

```text
1. Is transaction annotation on actual invoked method?
2. Is invocation through container proxy?
3. Is it self-invocation?
4. Is the bean managed by EJB/CDI transaction interceptor?
5. Is exception type causing rollback?
6. Is rollback configured for checked exception?
7. Is async boundary losing transaction?
8. Is DB connection enlisted in transaction?
9. Is transaction timeout reached?
10. Is there nested call with REQUIRES_NEW or NOT_SUPPORTED?
```

### 29.2 Common issue

```java
public void submit() {
    save(); // self-invocation
}

@Transactional
public void save() {
}
```

The transaction interceptor may not run.

---

## 30. Production Incident Method

Ketika incident terjadi, jangan mulai dari patch.

Gunakan struktur:

```text
1. Establish symptom.
2. Establish blast radius.
3. Establish phase.
4. Establish recent change.
5. Establish runtime identity.
6. Establish effective config.
7. Establish dependency/runtime versions.
8. Establish failing boundary.
9. Mitigate safely.
10. Root cause after stabilization.
```

### 30.1 Establish symptom

```text
What exactly failed?
Deployment?
Startup?
Specific endpoint?
Specific async task?
Specific tenant?
Specific profile?
```

### 30.2 Establish blast radius

```text
All nodes or one node?
All users or one role?
All tenants or one agency?
All requests or one workflow?
All environments or only UAT/PROD?
```

### 30.3 Establish recent change

```text
Code change?
Dependency change?
Server patch?
Config change?
Secret rotation?
Database change?
Feature flag change?
Deployment topology change?
```

### 30.4 Runtime identity

Always capture:

```text
app version
commit hash
artifact checksum
Java version
server/runtime version
active profile
container image digest
config source summary
feature flag snapshot
```

---

## 31. Safe Debug Endpoints

A mature enterprise app often has internal-only diagnostic endpoints.

### 31.1 Useful endpoints

```text
/internal/runtime/info
/internal/runtime/config
/internal/runtime/features
/internal/runtime/resources
/internal/runtime/dependencies
/internal/runtime/health/details
```

### 31.2 Security rules

- internal network only,
- strong auth,
- role restricted,
- no secret raw values,
- rate limited,
- auditable access,
- disabled or reduced in highest-security environments if required.

### 31.3 Example response

```json
{
  "application": {
    "name": "case-management",
    "version": "2026.06.16.1",
    "commit": "abc123"
  },
  "runtime": {
    "java": "25",
    "jakartaEe": "11",
    "server": "example-runtime-1.2.3"
  },
  "profiles": ["prod"],
  "config": {
    "sources": [
      {"name": "system-properties", "ordinal": 400},
      {"name": "environment-variables", "ordinal": 300},
      {"name": "microprofile-config.properties", "ordinal": 100}
    ]
  }
}
```

---

## 32. Failure-Mode Matrix

| Failure class | Typical symptom | Best first diagnostic |
|---|---|---|
| Dependency graph | `NoSuchMethodError` | dependency tree / runtime classpath |
| Namespace | `javax`/`jakarta` class not found | grep imports + dependency tree |
| Packaging | class exists in repo but runtime missing | inspect WAR/EAR/JAR |
| Classloader | `X cannot be cast to X` | print classloader/codeSource |
| Discovery | unsatisfied dependency | bean archive + bean-defining annotation |
| Resolution | ambiguous dependency | candidate bean list by type/qualifier |
| Proxy | unproxyable type | final/no-arg/proxyable rules |
| Interceptor | behavior not applied | proxy path + self-invocation check |
| Lifecycle | null injected field in constructor | constructor vs `@PostConstruct` phase |
| Config | wrong value | source + ordinal + profile |
| JNDI | resource not found | exact namespace + server binding |
| Transaction | no rollback | proxy path + exception rollback rule |
| Context | request scope unavailable | thread boundary + context propagation |
| Security | principal missing | container boundary + async propagation |
| Concurrency | stuck/rejected tasks | executor metrics + queue depth |

---

## 33. Debugging Anti-Patterns

### 33.1 Annotation gambling

```text
Add @ApplicationScoped.
Add @Named.
Add @Dependent.
Add @Alternative.
Try until it works.
```

Ini sering menciptakan sistem yang rapuh.

Lebih baik:

```text
Define expected bean type, qualifier, scope, lifecycle, and resolution path.
```

### 33.2 Scope downgrade to avoid proxy

```java
@Dependent
public final class BigService { ... }
```

Dipakai hanya agar proxy error hilang.

Bahaya:

- lifecycle berubah,
- instance bisa banyak,
- cleanup berbeda,
- state leak/duplication.

### 33.3 Catch all deployment exceptions

Jangan menyembunyikan startup failure yang seharusnya fail fast.

Buruk:

```java
@PostConstruct
void init() {
    try {
        loadRequiredConfig();
    } catch (Exception e) {
        log.warn("ignored", e);
    }
}
```

Jika config wajib, biarkan deployment gagal.

### 33.4 Direct JNDI lookup everywhere

Buruk:

```java
new InitialContext().lookup("...")
```

tersebar di business code.

Lebih baik:

- central producer,
- resource abstraction,
- clear boundary,
- test replacement.

### 33.5 Hidden feature flag in business logic

Buruk:

```java
if (config.get("x.enabled")) {
   ...
}
```

tersebar di 30 tempat.

Lebih baik:

- feature decision service,
- structured flag evaluation log,
- decorator/interceptor where appropriate,
- removal plan.

---

## 34. Code: Runtime Diagnostic Utility

Contoh utility sederhana untuk debugging class origin.

```java
package com.acme.runtime.diagnostics;

public final class ClassOrigin {

    private ClassOrigin() {
    }

    public static String describe(Class<?> type) {
        var source = type.getProtectionDomain() == null
                ? null
                : type.getProtectionDomain().getCodeSource();

        return "ClassOrigin{" +
                "name='" + type.getName() + '\'' +
                ", loader=" + type.getClassLoader() +
                ", source=" + source +
                '}';
    }

    public static String describe(Object instance) {
        if (instance == null) {
            return "ClassOrigin{null}";
        }
        return describe(instance.getClass());
    }
}
```

Use case:

```java
log.info("Injected service origin: {}", ClassOrigin.describe(paymentGateway));
log.info("API type origin: {}", ClassOrigin.describe(PaymentGateway.class));
```

Jika proxy class muncul, cek juga superclass/interface dan code source implementation.

---

## 35. Code: CDI Resolution Debug Probe

Untuk environment development/test, kadang berguna memakai `Instance<T>` untuk melihat resolvability.

```java
@ApplicationScoped
public class BeanResolutionProbe {

    @Inject
    @Any
    Instance<PaymentGateway> gateways;

    public void printGateways() {
        for (PaymentGateway gateway : gateways) {
            System.out.println("gateway=" + gateway.getClass());
        }
    }
}
```

Catatan:

- Ini bukan pattern utama production code.
- Ini diagnostic probe.
- Untuk production, lebih baik observability runtime yang aman dan terkontrol.

---

## 36. Code: Config Diagnostic View

Contoh konsep diagnostic untuk MicroProfile Config.

```java
@ApplicationScoped
public class ConfigDiagnostics {

    @Inject
    Config config;

    public List<String> sources() {
        List<String> result = new ArrayList<>();
        for (ConfigSource source : config.getConfigSources()) {
            result.add(source.getName() + " ordinal=" + source.getOrdinal());
        }
        return result;
    }

    public Optional<String> safeValue(String key) {
        if (isSensitive(key)) {
            return config.getOptionalValue(key, String.class).map(ignored -> "****");
        }
        return config.getOptionalValue(key, String.class);
    }

    private boolean isSensitive(String key) {
        String normalized = key.toLowerCase(Locale.ROOT);
        return normalized.contains("password")
                || normalized.contains("secret")
                || normalized.contains("token")
                || normalized.contains("key");
    }
}
```

Production version harus lebih matang:

- allowlist key,
- secret classification eksplisit,
- role restriction,
- audit access,
- no raw dump.

---

## 37. Code: Boundary Logging Interceptor

Contoh interceptor untuk observability boundary.

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RuntimeBoundary {
    String value() default "";
}
```

```java
@RuntimeBoundary
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class RuntimeBoundaryInterceptor {

    @AroundInvoke
    Object around(InvocationContext ctx) throws Exception {
        long start = System.nanoTime();
        String method = ctx.getMethod().getDeclaringClass().getSimpleName()
                + "." + ctx.getMethod().getName();

        try {
            log.info("boundary.enter method={}", method);
            Object result = ctx.proceed();
            long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            log.info("boundary.exit method={} elapsedMs={}", method, elapsedMs);
            return result;
        } catch (Exception e) {
            long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
            log.warn("boundary.fail method={} elapsedMs={} exception={}",
                    method, elapsedMs, e.getClass().getName());
            throw e;
        }
    }
}
```

Gunakan untuk boundary penting, bukan semua method.

---

## 38. Code: Startup Runtime Summary

```java
@ApplicationScoped
public class RuntimeStartupSummary {

    @Inject
    Config config;

    @PostConstruct
    void logSummary() {
        log.info("runtime.java.version={}", System.getProperty("java.version"));
        log.info("runtime.app.profile={}", safeConfig("app.profile"));
        log.info("runtime.app.version={}", safeConfig("app.version"));

        for (ConfigSource source : config.getConfigSources()) {
            log.info("config.source name={} ordinal={}",
                    source.getName(), source.getOrdinal());
        }
    }

    private String safeConfig(String key) {
        return config.getOptionalValue(key, String.class).orElse("<missing>");
    }
}
```

Jangan log secret.

---

## 39. What Good Looks Like in a Mature Team

Tim yang matang punya kebiasaan berikut:

### 39.1 Before incident

- dependency lock atau controlled BOM,
- SBOM tersedia,
- artifact content bisa diinspeksi,
- runtime version tercatat,
- config source terlihat,
- feature flag decision observable,
- CDI/container startup logs jelas,
- health check resource meaningful,
- runbook error umum tersedia.

### 39.2 During incident

- tahu versi artifact yang jalan,
- tahu config efektif,
- tahu perubahan terakhir,
- tahu node mana terdampak,
- bisa membedakan deployment failure vs runtime request failure,
- bisa rollback config/feature flag tanpa rebuild jika desain mendukung,
- tidak patch asal annotation.

### 39.3 After incident

- root cause dipetakan ke failure taxonomy,
- invariant baru ditambahkan,
- test/runtime check dibuat,
- observability gap ditutup,
- documentation/runbook diperbarui.

---

## 40. Runtime Review Checklist

Gunakan checklist ini saat review aplikasi enterprise Java.

### Dependency

- [ ] Tidak ada mixed `javax.*`/`jakarta.*` tanpa alasan eksplisit.
- [ ] BOM/platform version jelas.
- [ ] API vs implementation dependency jelas.
- [ ] `provided` vs runtime scope benar.
- [ ] Dependency tree tersimpan di CI artifact.

### Packaging

- [ ] WAR/EAR/JAR berisi metadata yang diperlukan.
- [ ] Tidak ada duplicate API JAR yang bentrok dengan server.
- [ ] `beans.xml`/config files berada di lokasi benar.

### CDI

- [ ] Bean discovery mode dipahami.
- [ ] Scope setiap service intentional.
- [ ] Qualifier punya makna domain/runtime.
- [ ] Alternatives hanya untuk selection eksplisit.
- [ ] Producers punya ownership dan disposer jika perlu.
- [ ] Interceptors/decorators punya boundary jelas.

### Config

- [ ] Required config fail fast.
- [ ] Secret tidak punya unsafe default.
- [ ] Effective config source bisa dilihat secara aman.
- [ ] Profile aktif eksplisit.
- [ ] Feature flag punya owner dan removal plan.

### Resources

- [ ] JNDI/resource names documented.
- [ ] Resource binding tervalidasi saat startup.
- [ ] Pool metrics tersedia.
- [ ] Direct lookup tidak tersebar.

### Runtime

- [ ] Async menggunakan managed executor/context propagation.
- [ ] Request scoped object tidak bocor ke async task.
- [ ] Transaction boundary melewati proxy/container.
- [ ] Security decision observable.
- [ ] Startup summary tersedia.

---

## 41. Mental Model Recap

Untuk setiap masalah container/runtime, jangan langsung bertanya:

```text
Annotation apa yang kurang?
```

Tanyakan:

```text
1. Fase mana yang gagal?
2. Layer mana yang gagal?
3. Siapa owner object/resource/context ini?
4. Apakah class visible?
5. Apakah bean discoverable?
6. Apakah injection point resolve ke tepat satu bean?
7. Apakah reference ini proxy atau raw object?
8. Apakah call melewati container boundary?
9. Apakah config value berasal dari source yang benar?
10. Apakah context/thread/transaction/security masih aktif?
```

Itulah bedanya debugging reaktif dengan debugging struktural.

---

## 42. Key Takeaways

- Runtime/container bugs harus diklasifikasikan berdasarkan layer dan phase.
- Banyak error CDI sebenarnya berasal dari dependency graph, packaging, namespace, atau classloader.
- `Unsatisfied` berarti tidak ada bean cocok; `Ambiguous` berarti terlalu banyak bean cocok.
- Class ada di classpath belum tentu discoverable sebagai CDI bean.
- Proxy menjelaskan banyak perilaku interceptor, scope, context, dan self-invocation.
- Config debugging harus melacak source, ordinal, profile, dan dynamic/static lookup.
- JNDI/resource debugging harus melacak namespace dan binding, bukan hanya string lookup.
- Thread boundary adalah context boundary kecuali context dipropagasi eksplisit.
- Observability runtime harus mencakup startup, dependency, config, resources, CDI, feature flags, context, dan transaction boundary.
- Top-tier engineer membangun runbook, invariant, dan diagnostic capability sebelum incident terjadi.

---

## 43. Latihan

### Latihan 1 — Unsatisfied Dependency

Diberikan error:

```text
Unsatisfied dependency for type CaseRouter with qualifiers @Default
```

Tulis investigasi lengkap:

- injection point,
- candidate implementation,
- bean discovery,
- qualifier,
- packaging,
- classloader,
- namespace,
- alternative/profile.

### Latihan 2 — Interceptor Tidak Jalan

Diberikan service:

```java
@ApplicationScoped
public class CaseService {
    public void submit() {
        validate();
    }

    @Audited
    public void validate() {
    }
}
```

Jelaskan mengapa audit mungkin tidak tercatat dan desain ulang boundary-nya.

### Latihan 3 — Config Salah di Production

Diberikan:

```text
app.case.routing.enabled expected false, actual true
```

Buat tabel investigasi source/ordinal/profile/env var/replica.

### Latihan 4 — Context Not Active

Diberikan:

```java
@Inject
RequestScopedUserContext userContext;

CompletableFuture.runAsync(() -> service.process(userContext));
```

Jelaskan failure mode dan refactor ke command object + managed executor/context propagation.

### Latihan 5 — Classloader Split

Diberikan:

```text
com.acme.Policy cannot be cast to com.acme.Policy
```

Jelaskan mengapa ini mungkin terjadi dan tulis diagnostic utility untuk membuktikannya.

---

## 44. Koneksi ke Part Berikutnya

Bagian ini memberi playbook observability dan debugging.

Part berikutnya akan naik ke level arsitektur:

```text
Part 033 — Architecture Patterns for Enterprise Java Runtime Design
```

Di sana kita akan membahas bagaimana merancang struktur aplikasi enterprise supaya dependency injection, configuration, feature flag, interceptors, decorators, resource boundary, dan runtime ownership menjadi **arsitektur yang sadar container**, bukan sekadar kumpulan annotation.

---

## 45. Status Seri

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
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
[x] Part 013 — Producers and Disposers: Programmatic Object Supply
[x] Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
[x] Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
[x] Part 016 — Decorators: Semantic Wrapping of Business Interfaces
[x] Part 017 — Stereotypes and Annotation Composition
[x] Part 018 — Lifecycle Callbacks: Construction, Initialization, Destruction
[x] Part 019 — CDI Extensions and Portable Runtime Customization
[x] Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters
[x] Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics
[x] Part 022 — EJB Transactions, Timers, Async, and Security Boundaries
[x] Part 023 — Jakarta Common Annotations and Resource Injection
[x] Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources
[x] Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts
[x] Part 026 — MicroProfile Config Deep Dive
[x] Part 027 — Profiles: Environment-Specific Behavior Without Code Forking
[x] Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery
[x] Part 029 — Conditional Beans and Runtime Selection Patterns
[x] Part 030 — Container Concurrency, Managed Executors, and Context Propagation
[x] Part 031 — Testing CDI, EJB, and Configuration-Heavy Code
[x] Part 032 — Observability and Debugging of Dependency/Container Problems
```

Belum selesai:

```text
[ ] Part 033 — Architecture Patterns for Enterprise Java Runtime Design
[ ] Part 034 — Migration and Modernization Playbook
[ ] Part 035 — Capstone: Designing a Production-Grade Enterprise Runtime Skeleton
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 031 — Testing CDI, EJB, and Configuration-Heavy Code](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 033 — Architecture Patterns for Enterprise Java Runtime Design](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-033.md)

</div>