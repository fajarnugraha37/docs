# Part 11 — Jersey Injection Model: HK2, Binder, Factories, Scopes, and Lifecycle

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> Fokus: memahami dependency injection internal Jersey sebagai runtime graph, bukan hanya `@Inject` yang “magic”.  
> Target: Java 8 sampai Java 25, Jersey 2.x/3.x/4.x, `javax` dan `jakarta` namespace awareness.

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya, kita sudah membahas:

1. Jersey sebagai implementation dari JAX-RS/Jakarta REST.
2. Bootstrap aplikasi melalui `Application`, `ResourceConfig`, scanning, dan explicit registration.
3. Bagaimana Jersey memahami resource class.
4. Bagaimana request dicocokkan ke resource method.
5. Bagaimana parameter di-bind.
6. Bagaimana request/response body diproses oleh `MessageBodyReader` dan `MessageBodyWriter`.
7. Strategi JSON provider.
8. Response engineering.
9. Exception mapper.
10. Filters dan interceptors.

Part ini masuk ke lapisan yang sering menjadi sumber bug production yang tidak terlihat dari permukaan:

> Siapa yang membuat object?  
> Berapa lama object itu hidup?  
> Apakah object tersebut aman dipakai bersama banyak request?  
> Kenapa dependency bisa ter-inject di resource tapi gagal di filter?  
> Kenapa `@Context` berbeda dengan `@Inject`?  
> Kenapa service singleton bisa tanpa sadar menyimpan request-specific state?  
> Kenapa integrasi Spring/CDI/HK2 sering membingungkan ownership?

Part ini tidak mengulang dependency injection dasar. Fokusnya adalah **model runtime Jersey**.

---

## 1. Big Picture: Jersey Membutuhkan Object Graph Sendiri

Sebuah request Jersey tampak sederhana:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService caseService;

    @Inject
    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id) {
        return caseService.get(id);
    }
}
```

Dari luar, kita melihat satu class resource dengan dependency `CaseService`.

Tetapi di runtime, Jersey harus menjawab banyak pertanyaan:

```text
Saat aplikasi start:
  - Resource class apa saja yang tersedia?
  - Provider apa saja yang tersedia?
  - Filter apa saja yang tersedia?
  - Exception mapper apa saja yang tersedia?
  - Dependency apa saja yang perlu dibuat?
  - Scope apa yang berlaku untuk setiap object?

Saat request masuk:
  - Resource instance baru dibuat atau reuse instance lama?
  - Request-scoped object disediakan dari mana?
  - @Context HttpHeaders menunjuk ke request yang mana?
  - @Inject service singleton aman atau tidak?
  - Factory dipanggil berapa kali?
  - Cleanup terjadi kapan?
```

Dengan kata lain, Jersey bukan hanya router. Jersey juga menjalankan **component lifecycle management**.

Jersey 2.x dan seterusnya menggunakan **HK2** sebagai dependency injection dan lifecycle kernel internal. Dokumentasi Jersey menyebut bahwa Jersey memakai HK2 untuk component lifecycle management dan dependency injection sejak Jersey 2.x. HK2 sendiri adalah lightweight dynamic dependency injection framework dari proyek Eclipse/GlassFish HK2.

---

## 2. Mental Model Utama: Injection Di Jersey Adalah Runtime Ownership Problem

Kesalahan umum ketika memakai Jersey adalah berpikir:

> “Kalau ada `@Inject`, berarti dependency injection sudah beres.”

Itu terlalu dangkal.

Pertanyaan yang lebih penting:

```text
1. Siapa owner object ini?
2. Siapa yang membuat object ini?
3. Siapa yang menghancurkan/menutup object ini?
4. Scope object ini apa?
5. Apakah object ini boleh menyimpan state?
6. Apakah object ini aman untuk concurrent request?
7. Apakah object ini berasal dari HK2, CDI, Spring, Servlet container, atau dibuat manual?
```

Dalam production system, bug injection jarang hanya berbunyi “dependency null”. Bug yang lebih berbahaya adalah:

- singleton menyimpan state request;
- request object bocor ke background thread;
- service dibuat dua kali oleh dua container berbeda;
- transaksi tidak aktif karena resource dibuat HK2, bukan Spring/CDI;
- provider singleton tidak thread-safe;
- factory membuat expensive object per request tanpa pooling;
- `@Context` dipakai di object yang hidup terlalu lama;
- custom binder tidak teregister di `ResourceConfig` yang benar;
- dependency conflict antara `javax.inject` dan `jakarta.inject`;
- resource instance didaftarkan manual sehingga lifecycle berubah.

Top-level model:

```text
Jersey Application
  ├── ResourceConfig / Application
  ├── Jersey runtime
  │   ├── Resource model
  │   ├── Provider model
  │   ├── Filter/interceptor model
  │   ├── Exception mapper model
  │   └── Injection/lifecycle model
  │
  ├── HK2 ServiceLocator
  │   ├── service descriptors
  │   ├── binders
  │   ├── factories
  │   ├── scopes
  │   └── injection resolution
  │
  └── External container integration
      ├── Servlet container
      ├── CDI container
      ├── Spring container
      └── Jakarta EE server
```

Kunci pemahaman:

> Jersey harus bisa membuat resource, provider, filter, interceptor, mapper, dan context object pada saat yang tepat. HK2 adalah mekanisme internal yang membantu Jersey melakukan itu.

---

## 3. `@Context` vs `@Inject`: Jangan Disamakan

Di Jersey/Jakarta REST, ada dua gaya injection yang sering terlihat:

```java
@Context
private HttpHeaders headers;

@Inject
private CaseService caseService;
```

Keduanya sama-sama “masuk otomatis”, tetapi maknanya berbeda.

### 3.1 `@Context`

`@Context` adalah konsep Jakarta REST/JAX-RS untuk mengakses object kontekstual dari runtime HTTP/JAX-RS.

Contoh object yang umum:

```java
@Context UriInfo uriInfo;
@Context HttpHeaders headers;
@Context Request request;
@Context SecurityContext securityContext;
@Context Application application;
@Context Configuration configuration;
@Context Providers providers;
```

Mental model:

```text
@Context = “berikan saya object runtime/konteks dari request/aplikasi Jersey.”
```

Object `@Context` sering kali bukan service business. Ia adalah view ke runtime.

Contoh:

```java
@Path("/debug")
public class DebugResource {

    @Context
    UriInfo uriInfo;

    @Context
    HttpHeaders headers;

    @GET
    public Map<String, Object> inspect() {
        return Map.of(
            "path", uriInfo.getPath(),
            "accept", headers.getAcceptableMediaTypes().toString()
        );
    }
}
```

`UriInfo` dan `HttpHeaders` tergantung request. Ia tidak boleh diperlakukan seperti singleton service.

### 3.2 `@Inject`

`@Inject` berasal dari dependency injection API. Di dunia Jersey, injection ini biasanya diselesaikan oleh HK2, kecuali aplikasi diintegrasikan dengan CDI/Spring secara eksplisit.

Mental model:

```text
@Inject = “berikan saya dependency dari object graph DI.”
```

Contoh:

```java
public class CaseResource {

    private final CaseService caseService;

    @Inject
    public CaseResource(CaseService caseService) {
        this.caseService = caseService;
    }
}
```

`CaseService` adalah dependency aplikasi. Ia bukan context object HTTP.

### 3.3 Kesalahan Fatal: Menyimpan `@Context` Dalam Singleton State

Contoh berbahaya:

```java
@Singleton
public class BadAuditService {

    @Context
    private HttpHeaders headers;

    public void audit(String action) {
        String userAgent = headers.getHeaderString("User-Agent");
        // berbahaya jika lifecycle/proxy tidak dipahami
    }
}
```

Masalahnya bukan hanya “apakah ini compile”. Masalahnya:

- `BadAuditService` singleton;
- `HttpHeaders` request-specific;
- service bisa dipakai dari background thread;
- request context bisa sudah tidak aktif;
- behavior bisa tergantung proxy implementation;
- sulit dites;
- rawan data request bocor lintas request jika state disimpan salah.

Desain lebih sehat:

```java
public final class RequestAuditContext {
    private final String correlationId;
    private final String actor;
    private final String userAgent;

    public RequestAuditContext(String correlationId, String actor, String userAgent) {
        this.correlationId = correlationId;
        this.actor = actor;
        this.userAgent = userAgent;
    }

    public String correlationId() { return correlationId; }
    public String actor() { return actor; }
    public String userAgent() { return userAgent; }
}
```

Resource/filter mengambil context, lalu meneruskan value eksplisit:

```java
@Provider
public class AuditContextFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String correlationId = requestContext.getHeaderString("X-Correlation-Id");
        String actor = "resolved-user";
        String userAgent = requestContext.getHeaderString("User-Agent");

        requestContext.setProperty(
            "auditContext",
            new RequestAuditContext(correlationId, actor, userAgent)
        );
    }
}
```

Lalu resource mengambil property atau request-scoped dependency dengan cara yang jelas.

Prinsipnya:

> Jangan biarkan singleton menyembunyikan ketergantungan pada request. Jadikan request context eksplisit di boundary.

---

## 4. HK2 Dalam Jersey: ServiceLocator, Descriptor, Binder

HK2 dapat dipahami dengan tiga konsep inti:

```text
ServiceLocator
  = registry/runtime yang mengetahui service apa saja yang tersedia.

Descriptor
  = metadata tentang service: contract, implementation, scope, qualifier, ranking.

Binder
  = kode konfigurasi yang mendaftarkan binding ke ServiceLocator.
```

Di aplikasi Jersey, kita biasanya tidak berinteraksi langsung dengan `ServiceLocator` untuk semua hal. Kita lebih sering menulis binder dan mendaftarkannya ke `ResourceConfig`.

Contoh sederhana:

```java
import org.glassfish.hk2.utilities.binding.AbstractBinder;
import org.glassfish.jersey.server.ResourceConfig;

public class ApiApplication extends ResourceConfig {

    public ApiApplication() {
        packages("com.example.api");

        register(new AbstractBinder() {
            @Override
            protected void configure() {
                bind(DefaultCaseService.class)
                    .to(CaseService.class);
            }
        });
    }
}
```

Artinya:

```text
Jika ada komponen Jersey membutuhkan CaseService,
berikan instance DefaultCaseService sesuai lifecycle default binding.
```

Namun, ini baru permukaan.

Dalam desain production, kita harus menentukan:

- apakah service singleton?
- apakah service request-scoped?
- apakah service dibuat factory?
- apakah instance external sudah dibuat di luar HK2?
- apakah service punya dependency lain?
- apakah service thread-safe?
- apakah service perlu shutdown?

---

## 5. Binding Class vs Binding Instance

HK2/Jersey memungkinkan beberapa gaya binding. Dua yang paling penting:

1. bind class;
2. bind instance.

### 5.1 Binding Class

```java
bind(DefaultCaseService.class)
    .to(CaseService.class);
```

Makna:

```text
HK2 tahu implementation class-nya.
HK2 bertanggung jawab membuat instance saat dibutuhkan.
HK2 dapat melakukan injection ke constructor/field/method object tersebut.
Lifecycle mengikuti scope binding.
```

Ini cocok ketika object memang bagian dari graph HK2.

### 5.2 Binding Instance

```java
CaseService service = new DefaultCaseService(repository, clock);

bind(service)
    .to(CaseService.class);
```

Makna:

```text
Instance sudah dibuat manual.
HK2 hanya menyimpan dan menyediakannya.
HK2 tidak membangun object ini dari nol.
```

Ini cocok untuk:

- object external yang lifecycle-nya dikelola manual;
- object dari container lain;
- object immutable singleton;
- test double;
- resource mahal yang dikonstruksi di bootstrap.

Namun ada risiko:

```java
bind(new DefaultCaseService())
    .to(CaseService.class);
```

Jika `DefaultCaseService` butuh dependency injection internal, dependency itu tidak otomatis masuk lewat constructor karena kamu sudah membuat object manual.

Contoh buruk:

```java
public class DefaultCaseService implements CaseService {

    @Inject
    private CaseRepository repository;
}

bind(new DefaultCaseService()).to(CaseService.class);
```

`repository` bisa tidak seperti yang kamu harapkan, tergantung injection dilakukan atau tidak oleh lifecycle container.

Desain lebih jelas:

```java
bind(DefaultCaseService.class)
    .to(CaseService.class)
    .in(Singleton.class);
```

Atau jika dibuat manual:

```java
CaseRepository repository = new OracleCaseRepository(dataSource);
CaseService service = new DefaultCaseService(repository, Clock.systemUTC());

bind(service).to(CaseService.class);
```

Prinsip:

> Kalau container yang membuat object, biarkan container menyelesaikan dependency. Kalau kamu yang membuat object, selesaikan dependency secara eksplisit.

---

## 6. Binding Contract vs Implementation

DI yang sehat mengikat berdasarkan contract.

```java
public interface CaseService {
    CaseDto get(String id);
}

public class DefaultCaseService implements CaseService {
    @Override
    public CaseDto get(String id) {
        return new CaseDto(id);
    }
}
```

Binding:

```java
bind(DefaultCaseService.class)
    .to(CaseService.class);
```

Resource:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService service;

    @Inject
    public CaseResource(CaseService service) {
        this.service = service;
    }
}
```

Kelebihan:

- resource tidak peduli implementation;
- test lebih mudah;
- migration lebih mudah;
- implementation bisa diganti berdasarkan environment;
- boundary API layer lebih bersih.

Namun jangan membuat interface palsu untuk semua class tanpa alasan. Interface berguna jika ada variasi nyata:

- implementation berbeda per environment;
- mock/test double penting;
- module boundary;
- plugin/extension;
- dependency inversion yang meaningful.

Untuk class sederhana yang tidak berubah, binding concrete class juga masuk akal.

---

## 7. Scope: Bagian Paling Penting Dalam Injection Model

Scope menentukan umur instance.

Mental model:

```text
Singleton      = satu instance untuk aplikasi.
RequestScoped  = satu instance per request.
PerLookup      = instance baru setiap kali diminta.
```

Nama annotation dapat berbeda tergantung namespace dan modul:

- `jakarta.inject.Singleton` atau `javax.inject.Singleton`;
- HK2 scope seperti `org.glassfish.hk2.api.PerLookup`;
- Jersey/HK2 request scope;
- CDI `jakarta.enterprise.context.RequestScoped` jika pakai CDI;
- Spring `@Scope` jika pakai Spring.

Di sini fokusnya mental model, bukan menghafal annotation.

---

## 8. Singleton Scope

Singleton berarti satu instance dipakai bersama semua request.

```java
bind(DefaultCaseService.class)
    .to(CaseService.class)
    .in(Singleton.class);
```

Cocok untuk:

- stateless service;
- immutable configuration;
- client factory yang thread-safe;
- mapper stateless;
- validator stateless;
- cache manager thread-safe;
- service yang hanya menggunakan dependency thread-safe.

Tidak cocok untuk:

- menyimpan request-specific data;
- menyimpan current user;
- menyimpan current transaction;
- menyimpan mutable non-thread-safe state;
- menyimpan buffer reused tanpa synchronization;
- menyimpan per-request accumulator.

Contoh singleton aman:

```java
@Singleton
public class DefaultCaseService implements CaseService {

    private final CaseRepository repository;
    private final Clock clock;

    @Inject
    public DefaultCaseService(CaseRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    public CaseDto get(String id) {
        return repository.findById(id);
    }
}
```

Contoh singleton berbahaya:

```java
@Singleton
public class BadCaseService {

    private String currentUser;

    public void setCurrentUser(String currentUser) {
        this.currentUser = currentUser;
    }

    public CaseDto get(String id) {
        // race antar request
        return loadForUser(id, currentUser);
    }
}
```

Jika dua request paralel:

```text
Request A user = alice
Request B user = bob

A: setCurrentUser(alice)
B: setCurrentUser(bob)
A: get(id) -> memakai bob tanpa sengaja
```

Ini bukan bug Jersey. Ini bug lifecycle design.

Rule of thumb:

> Singleton boleh punya state hanya jika state itu immutable, thread-safe, atau memang global application state yang dikontrol dengan benar.

---

## 9. Request Scope

Request scope berarti satu instance per HTTP request.

Cocok untuk:

- request identity;
- correlation context;
- audit context;
- tenant context;
- per-request unit-of-work handle;
- object yang mengumpulkan data selama satu request;
- object yang tidak boleh dibagi antar request.

Contoh konseptual:

```java
public class RequestIdentity {
    private final String actorId;
    private final Set<String> roles;
    private final String tenantId;

    public RequestIdentity(String actorId, Set<String> roles, String tenantId) {
        this.actorId = actorId;
        this.roles = Set.copyOf(roles);
        this.tenantId = tenantId;
    }

    public String actorId() { return actorId; }
    public Set<String> roles() { return roles; }
    public String tenantId() { return tenantId; }
}
```

Resource bisa menerima:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService service;
    private final RequestIdentity identity;

    @Inject
    public CaseResource(CaseService service, RequestIdentity identity) {
        this.service = service;
        this.identity = identity;
    }
}
```

Namun request-scoped custom object butuh factory/binder yang benar, karena value-nya biasanya berasal dari request header/security context.

---

## 10. Per-Lookup Scope

Per-lookup berarti instance dibuat setiap kali dependency diminta.

Cocok untuk:

- object murah yang stateful;
- builder;
- command object;
- per-operation helper;
- object yang tidak thread-safe dan tidak ingin di-share.

Tidak cocok untuk:

- expensive object seperti HTTP client pool;
- database connection pool;
- heavy serializer;
- object yang perlu shutdown;
- cache.

Jika salah memakai per-lookup untuk expensive object, performa dan resource usage bisa hancur.

Contoh buruk:

```java
bind(MyHttpClient.class)
    .to(MyHttpClient.class)
    .in(PerLookup.class);
```

Jika `MyHttpClient` membuka connection pool, maka tiap injection bisa membuat pool baru.

Lebih sehat:

```java
bind(sharedHttpClient)
    .to(MyHttpClient.class);
```

atau:

```java
bind(MyHttpClientFactory.class)
    .to(MyHttpClientFactory.class)
    .in(Singleton.class);
```

---

## 11. Constructor Injection vs Field Injection

### 11.1 Constructor Injection

```java
public class CaseResource {

    private final CaseService service;

    @Inject
    public CaseResource(CaseService service) {
        this.service = service;
    }
}
```

Kelebihan:

- dependency eksplisit;
- object tidak bisa dibuat tanpa dependency;
- field bisa `final`;
- mudah dites tanpa container;
- lebih aman untuk refactor;
- cocok untuk immutable object.

Ini adalah default recommendation untuk service dan resource yang kamu kontrol.

### 11.2 Field Injection

```java
public class CaseResource {

    @Inject
    private CaseService service;
}
```

Kelebihan:

- pendek;
- sering dipakai untuk sample;
- kadang berguna untuk framework object tertentu.

Kekurangan:

- dependency tersembunyi;
- sulit dites tanpa container;
- field tidak final;
- object bisa dalam keadaan setengah valid;
- refactor lebih rawan.

### 11.3 Method Injection

```java
public class CaseResource {

    private CaseService service;

    @Inject
    public void setCaseService(CaseService service) {
        this.service = service;
    }
}
```

Cocok jika dependency optional atau perlu post-construction setup, tetapi jarang menjadi pilihan terbaik untuk resource/service biasa.

Prinsip production:

> Gunakan constructor injection untuk dependency wajib. Gunakan field injection secara terbatas untuk object kontekstual/framework ketika memang lebih masuk akal.

---

## 12. Resource Lifecycle: Class Registration vs Instance Registration

Ini bagian penting yang sering dilupakan.

### 12.1 Register Resource Class

```java
register(CaseResource.class);
```

atau:

```java
packages("com.example.api");
```

Makna:

```text
Jersey tahu class resource.
Jersey/HK2 dapat membuat instance sesuai lifecycle.
Injection bisa dilakukan oleh runtime.
```

### 12.2 Register Resource Instance

```java
register(new CaseResource(caseService));
```

Makna:

```text
Kamu sudah membuat resource instance.
Runtime tidak mengontrol construction dengan cara yang sama.
Resource instance cenderung singleton-like karena instance yang sama didaftarkan.
```

Ini bisa berguna untuk test atau resource sederhana, tetapi berbahaya jika resource menyimpan state.

Contoh buruk:

```java
@Path("/cases")
public class BadCaseResource {

    private String lastCaseId;

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") String id) {
        this.lastCaseId = id;
        return find(id);
    }
}

register(new BadCaseResource());
```

Jika instance yang sama dipakai banyak request, `lastCaseId` race.

Resource class sebaiknya stateless. Bahkan jika lifecycle per-request, stateless tetap lebih mudah dijaga.

---

## 13. Provider Lifecycle: Filter, Mapper, Reader, Writer Biasanya Singleton-Oriented

Banyak provider Jersey seperti:

- `ContainerRequestFilter`
- `ContainerResponseFilter`
- `ReaderInterceptor`
- `WriterInterceptor`
- `ExceptionMapper`
- `MessageBodyReader`
- `MessageBodyWriter`

sering hidup sebagai singleton atau setidaknya dipakai lintas request.

Karena itu provider harus dianggap **thread-safe by default**.

Contoh filter aman:

```java
@Provider
public class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    public static final String CORRELATION_ID = "correlationId";

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String id = requestContext.getHeaderString("X-Correlation-Id");
        if (id == null || id.isBlank()) {
            id = UUID.randomUUID().toString();
        }
        requestContext.setProperty(CORRELATION_ID, id);
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        Object id = requestContext.getProperty(CORRELATION_ID);
        if (id != null) {
            responseContext.getHeaders().putSingle("X-Correlation-Id", id.toString());
        }
    }
}
```

Filter ini aman karena tidak menyimpan request state di field.

Contoh filter buruk:

```java
@Provider
public class BadCorrelationFilter implements ContainerRequestFilter {

    private String currentCorrelationId;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        currentCorrelationId = requestContext.getHeaderString("X-Correlation-Id");
    }
}
```

Jika filter singleton, field `currentCorrelationId` race.

Rule:

> Provider Jersey harus stateless atau state-nya harus thread-safe dan tidak request-specific.

---

## 14. Factory Binding: Ketika Object Tidak Bisa Dibuat Langsung

Kadang dependency tidak bisa dibuat hanya dengan constructor injection sederhana.

Contoh:

- `RequestIdentity` harus dibaca dari `SecurityContext` atau request property;
- `TenantContext` harus dibaca dari header;
- `AuditContext` harus gabungan correlation ID, user, IP, user-agent;
- `DataSource` dibuat dari external config;
- `Clock` ingin diganti di test;
- client perlu custom TLS/pool config.

Di sinilah factory berguna.

Contoh konseptual:

```java
public class ClockFactory implements Factory<Clock> {

    @Override
    public Clock provide() {
        return Clock.systemUTC();
    }

    @Override
    public void dispose(Clock instance) {
        // no-op
    }
}
```

Binding:

```java
bindFactory(ClockFactory.class)
    .to(Clock.class)
    .in(Singleton.class);
```

Namun hati-hati: scope bisa berlaku pada service hasil factory atau factory-nya tergantung API binding dan runtime. Jangan hanya menebak. Uji behavior jika object mahal atau request-specific.

### 14.1 Factory Untuk Request Identity

```java
public class RequestIdentityFactory implements Factory<RequestIdentity> {

    private final jakarta.inject.Provider<ContainerRequestContext> requestContextProvider;

    @Inject
    public RequestIdentityFactory(jakarta.inject.Provider<ContainerRequestContext> requestContextProvider) {
        this.requestContextProvider = requestContextProvider;
    }

    @Override
    public RequestIdentity provide() {
        ContainerRequestContext ctx = requestContextProvider.get();

        String actor = (String) ctx.getProperty("actorId");
        String tenant = ctx.getHeaderString("X-Tenant-Id");

        if (actor == null) {
            actor = "anonymous";
        }

        return new RequestIdentity(actor, Set.of(), tenant);
    }

    @Override
    public void dispose(RequestIdentity instance) {
        // no-op
    }
}
```

Binding konseptual:

```java
register(new AbstractBinder() {
    @Override
    protected void configure() {
        bindFactory(RequestIdentityFactory.class)
            .to(RequestIdentity.class)
            .in(RequestScoped.class);
    }
});
```

Catatan:

- exact request scope annotation dapat bergantung pada versi/module;
- pada beberapa setup, lebih sederhana memakai request property daripada custom request-scoped injection;
- jangan memaksakan custom injection jika property passing lebih jelas.

### 14.2 Factory Tidak Boleh Menjadi Service Locator Tersembunyi

Factory buruk:

```java
public class EverythingFactory implements Factory<Object> {
    public Object provide() {
        // if type A return A
        // if type B return B
        // baca config global
        // resolve request
        // resolve user
        // open db connection
        // call remote service
        return something;
    }
}
```

Ini membuat dependency graph tidak terlihat.

Factory yang baik:

- kecil;
- satu tanggung jawab;
- lifecycle jelas;
- tidak melakukan IO berat per request kecuali memang perlu;
- tidak menyembunyikan business logic;
- mudah dites.

---

## 15. `jakarta.inject.Provider<T>`: Lazy/Contextual Access

Kadang kamu tidak ingin langsung menerima object, tetapi ingin menerima provider untuk mengambil object saat dibutuhkan.

```java
public class CaseResource {

    private final Provider<RequestIdentity> identityProvider;

    @Inject
    public CaseResource(Provider<RequestIdentity> identityProvider) {
        this.identityProvider = identityProvider;
    }

    @GET
    public Response list() {
        RequestIdentity identity = identityProvider.get();
        return Response.ok().build();
    }
}
```

Manfaat:

- lazy resolution;
- cocok untuk request-scoped object yang diakses dari object lebih panjang umurnya;
- bisa menghindari circular dependency tertentu;
- bisa menunda expensive creation.

Namun `Provider<T>` juga bisa disalahgunakan.

Contoh buruk:

```java
@Singleton
public class BadSingleton {

    private final Provider<RequestIdentity> identityProvider;

    @Inject
    public BadSingleton(Provider<RequestIdentity> identityProvider) {
        this.identityProvider = identityProvider;
    }

    public void startBackgroundJob() {
        new Thread(() -> {
            RequestIdentity identity = identityProvider.get(); // request context tidak ada
        }).start();
    }
}
```

`Provider<T>` tidak membuat request context menjadi abadi. Ia hanya menunda lookup.

Rule:

> Provider bukan izin untuk membawa request-scoped dependency keluar dari request lifecycle.

---

## 16. Custom Injectable: Kapan Perlu, Kapan Tidak

Kamu bisa membuat custom injection agar resource bisa menulis:

```java
@Inject
@CurrentUser
private UserPrincipal user;
```

atau:

```java
public CaseResource(@CurrentTenant TenantId tenantId) { ... }
```

Ini elegan jika dipakai secara luas dan behavior-nya stabil.

Namun custom injection punya biaya:

- lebih sulit dipahami developer baru;
- lebih sulit di-debug;
- bergantung pada HK2/Jersey internals;
- migration Jersey 2 → 3 → 4 bisa lebih sulit;
- salah scope bisa bocor;
- annotation magic bisa menyembunyikan failure.

Alternatif yang lebih eksplisit:

```java
@Context
SecurityContext securityContext;
```

atau:

```java
@Inject
RequestIdentity identity;
```

atau:

```java
CaseCommand command = new CaseCommand(actorId, requestDto);
service.execute(command);
```

Gunakan custom injection jika:

- konsepnya sangat sering dipakai;
- semantic-nya jelas;
- lifecycle-nya request-bound;
- tim paham mekanismenya;
- ada test khusus;
- ada dokumentasi internal;
- failure mode-nya jelas.

Jangan gunakan custom injection hanya agar code terlihat “framework-like”.

---

## 17. Injection Ke Resource vs Provider vs Filter vs Mapper

Tidak semua komponen dibuat dalam konteks yang sama.

### 17.1 Resource

Resource biasanya titik utama injection.

```java
@Path("/cases")
public class CaseResource {
    @Inject CaseService service;
}
```

Jika resource dibuat oleh Jersey, injection normal berjalan.

### 17.2 ExceptionMapper

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    private final ErrorResponseFactory errorFactory;

    @Inject
    public DomainExceptionMapper(ErrorResponseFactory errorFactory) {
        this.errorFactory = errorFactory;
    }

    @Override
    public Response toResponse(DomainException exception) {
        return errorFactory.toResponse(exception);
    }
}
```

Mapper cenderung provider singleton. Dependency-nya harus aman untuk lintas request, atau dependency request-specific harus diperoleh dari context/property dengan hati-hati.

### 17.3 Filter

```java
@Provider
public class AuthFilter implements ContainerRequestFilter {

    private final TokenVerifier verifier;

    @Inject
    public AuthFilter(TokenVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String token = extractToken(requestContext);
        Principal principal = verifier.verify(token);
        requestContext.setProperty("principal", principal);
    }
}
```

`TokenVerifier` harus thread-safe jika filter singleton.

### 17.4 MessageBodyReader/Writer

Provider body biasanya sangat sensitif terhadap thread-safety.

```java
@Provider
@Consumes("application/vnd.example.case+json")
public class CaseBodyReader implements MessageBodyReader<CaseRequest> {

    private final ObjectMapper mapper;

    @Inject
    public CaseBodyReader(ObjectMapper mapper) {
        this.mapper = mapper;
    }
}
```

`ObjectMapper` Jackson biasanya thread-safe setelah konfigurasi selesai. Tetapi jangan mutate konfigurasi mapper saat request berjalan.

---

## 18. Circular Dependency: Gejala Desain Yang Perlu Dicermati

Contoh:

```text
CaseResource -> CaseService -> AuditService -> RequestIdentity -> CaseService
```

Atau:

```text
AuthFilter -> UserService -> JerseyClient -> AuthTokenProvider -> AuthFilter
```

Circular dependency kadang bisa diakali dengan `Provider<T>`, tetapi sering menjadi tanda boundary salah.

Pertanyaan desain:

- Apakah service terlalu banyak tanggung jawab?
- Apakah audit bergantung pada domain service padahal seharusnya menerima event?
- Apakah security layer memanggil service yang juga bergantung security layer?
- Apakah request context dicampur ke business service?
- Apakah infrastructure client butuh domain service?

Solusi yang lebih sehat:

- pecah interface;
- balik dependency arah event;
- buat command/context object eksplisit;
- pisahkan authentication dari domain authorization;
- hindari service locator pattern;
- gunakan domain event/audit event sink.

Contoh refactor:

```text
Before:
  CaseService -> AuditService -> CaseService

After:
  CaseService -> AuditSink
  AuditSink -> append AuditEvent
```

`AuditEvent` berisi data eksplisit, bukan mengambil ulang dari service.

---

## 19. Request Context Propagation: Jangan Mengandalkan ThreadLocal Secara Buta

Banyak aplikasi menggunakan MDC atau ThreadLocal untuk correlation ID/current user.

Contoh:

```java
MDC.put("correlationId", id);
```

Ini bisa berguna untuk logging, tetapi berbahaya jika dianggap sebagai dependency model.

Masalah:

- request bisa berpindah thread pada async flow;
- executor custom tidak otomatis membawa ThreadLocal;
- virtual thread mengubah cara berpikir thread lifecycle;
- cleanup sering lupa;
- background job bisa mewarisi context yang salah;
- test menjadi order-dependent.

Pola lebih aman:

```java
try {
    MDC.put("correlationId", id);
    chain.doWork();
} finally {
    MDC.remove("correlationId");
}
```

Untuk business logic, lebih baik explicit context:

```java
public record CommandContext(
    String correlationId,
    String actorId,
    String tenantId
) {}
```

Service method:

```java
caseService.approveCase(context, command);
```

Ya, ini lebih verbose. Tetapi untuk sistem regulatory/case-management, explicit context sering jauh lebih defendable.

---

## 20. Injection Dan Transaction Boundary

Jersey sendiri bukan transaction manager. Kalau kamu memakai JPA, CDI, Spring, atau Jakarta EE container, transaksi biasanya dikelola oleh layer lain.

Bug umum:

```java
@Path("/cases")
public class CaseResource {

    @Inject
    CaseService service;
}
```

Developer mengira `CaseService` adalah Spring bean dengan `@Transactional`, tetapi ternyata object dibuat oleh HK2, bukan Spring.

Akibat:

- `@Transactional` tidak aktif;
- security proxy tidak aktif;
- AOP logging tidak aktif;
- caching annotation tidak aktif;
- repository dependency bisa berbeda instance;
- lifecycle callback tidak jalan.

Mental model:

```text
Annotation seperti @Transactional hanya bekerja jika object dibuat/diproxy oleh container yang memahami annotation itu.
```

Jika resource dibuat Jersey/HK2 tetapi service harus Spring-managed, integration harus eksplisit.

Arsitektur sehat:

```text
Jersey resource/filter/mapper      -> dibuat Jersey
Application service/business layer -> dibuat Spring/CDI/Jakarta EE container
Repository/transaction layer       -> dibuat primary application container
```

Atau:

```text
Semua resource/service dikelola CDI dalam Jakarta EE runtime
Jersey hanya menjadi Jakarta REST implementation
```

Yang berbahaya adalah campuran tanpa ownership jelas.

---

## 21. Multi-Container Ownership Problem

Dalam aplikasi enterprise, bisa ada beberapa container:

```text
Servlet container
  └── Jersey runtime
        └── HK2 ServiceLocator

Spring ApplicationContext
CDI BeanManager
Jakarta EE container
```

Pertanyaan penting:

```text
CaseService dibuat oleh siapa?
CaseRepository dibuat oleh siapa?
DataSource dibuat oleh siapa?
Transaction manager milik siapa?
Security context milik siapa?
```

Jika tidak jelas, kamu bisa punya dua instance berbeda:

```text
HK2 CaseService instance
Spring CaseService instance
```

Lalu kamu bingung kenapa:

- config berbeda;
- transaction tidak aktif;
- mock test tidak kena;
- lifecycle callback tidak jalan;
- metrics tidak tercatat;
- singleton ternyata double singleton.

Rule production:

> Pilih satu primary application composition container. Jersey boleh punya HK2 untuk komponen HTTP-nya, tetapi business graph sebaiknya punya owner yang jelas.

---

## 22. Recommended Composition Patterns

### Pattern A — Pure Jersey/HK2 Small Service

Cocok untuk:

- microservice kecil;
- dependency graph sederhana;
- tidak butuh Spring/CDI;
- explicit manual configuration;
- low framework overhead.

Struktur:

```text
ResourceConfig
  ├── register resources
  ├── register filters
  ├── register mappers
  └── register HK2 binders
        ├── services
        ├── repositories
        ├── clients
        └── config objects
```

Kelebihan:

- sederhana;
- explicit;
- kecil;
- cocok untuk embedded/serverless tertentu.

Kekurangan:

- fitur enterprise seperti transaction/AOP/config lebih manual;
- integrasi library Spring/CDI tidak otomatis;
- tim harus paham HK2.

### Pattern B — Jersey as HTTP Adapter, Spring/CDI as Business Container

Cocok untuk:

- aplikasi enterprise;
- butuh transaction;
- butuh repository framework;
- butuh security/AOP;
- sudah punya container utama.

Struktur:

```text
Jersey Resource
  -> inject/use ApplicationService from Spring/CDI
      -> transaction boundary
      -> repository
      -> domain logic
```

Kelebihan:

- ownership jelas;
- transaction proxy bekerja;
- service layer bisa dipakai endpoint lain;
- testing business layer lebih normal.

Kekurangan:

- integrasi awal lebih kompleks;
- perlu memastikan resource/provider dibuat container yang tepat atau bridge benar.

### Pattern C — Jakarta EE Native

Cocok untuk:

- aplikasi berjalan di Jakarta EE server;
- CDI menjadi standard composition;
- Jakarta REST implementation disediakan server;
- transaction/security dikelola platform.

Struktur:

```text
CDI beans + Jakarta REST resources + JTA + Jakarta Security
```

Kelebihan:

- standard platform alignment;
- lifecycle dan context lebih integrated;
- bagus untuk enterprise server.

Kekurangan:

- server dependency;
- migration antar server tetap perlu validasi;
- Jersey-specific extension harus hati-hati.

---

## 23. Designing A Clean Jersey Resource With Injection

Contoh buruk:

```java
@Path("/cases")
public class CaseResource {

    @Context HttpHeaders headers;
    @Context SecurityContext securityContext;

    @Inject CaseRepository repository;
    @Inject AuditRepository auditRepository;
    @Inject MailClient mailClient;
    @Inject TemplateRenderer templateRenderer;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") String id, ApprovalRequest request) {
        // validate
        // authorize
        // load case
        // update DB
        // insert audit
        // send email
        // render template
        // handle exception
        // build response
        return Response.ok().build();
    }
}
```

Masalah:

- resource terlalu tahu banyak;
- transaction boundary tidak jelas;
- audit tersebar;
- email side effect bercampur;
- sulit dites;
- dependency terlalu banyak;
- context HTTP masuk ke domain orchestration;
- error mapping kemungkinan tidak konsisten.

Desain lebih sehat:

```java
@Path("/cases")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class CaseResource {

    private final CaseCommandService commandService;
    private final RequestContextFactory contextFactory;

    @Inject
    public CaseResource(CaseCommandService commandService,
                        RequestContextFactory contextFactory) {
        this.commandService = commandService;
        this.contextFactory = contextFactory;
    }

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") String id,
                            ApprovalRequest request,
                            @Context UriInfo uriInfo) {
        CommandContext context = contextFactory.fromCurrentRequest();

        ApprovalResult result = commandService.approve(
            context,
            new ApproveCaseCommand(id, request.reason())
        );

        URI location = uriInfo.getAbsolutePathBuilder()
            .path("events")
            .path(result.eventId())
            .build();

        return Response.created(location)
            .entity(result)
            .build();
    }
}
```

Resource hanya bertugas:

- menerima HTTP input;
- mengambil context boundary;
- membentuk command;
- memanggil application service;
- membangun HTTP response.

Service mengurus use case.

---

## 24. Binding Example: Production-Oriented ResourceConfig

Contoh `ResourceConfig` explicit:

```java
public class ApiApplication extends ResourceConfig {

    public ApiApplication(AppConfig config) {
        register(CaseResource.class);
        register(CorrelationIdFilter.class);
        register(AuthFilter.class);
        register(DomainExceptionMapper.class);
        register(ValidationExceptionMapper.class);

        register(new ApplicationBinder(config));
    }
}
```

Binder:

```java
public class ApplicationBinder extends AbstractBinder {

    private final AppConfig config;

    public ApplicationBinder(AppConfig config) {
        this.config = config;
    }

    @Override
    protected void configure() {
        bind(config)
            .to(AppConfig.class);

        bind(Clock.systemUTC())
            .to(Clock.class);

        bind(DefaultCaseCommandService.class)
            .to(CaseCommandService.class)
            .in(Singleton.class);

        bind(OracleCaseRepository.class)
            .to(CaseRepository.class)
            .in(Singleton.class);

        bind(DefaultRequestContextFactory.class)
            .to(RequestContextFactory.class)
            .in(Singleton.class);

        bind(DefaultErrorResponseFactory.class)
            .to(ErrorResponseFactory.class)
            .in(Singleton.class);
    }
}
```

Hal yang bagus:

- binding explicit;
- service contract jelas;
- singleton hanya untuk stateless/thread-safe service;
- config object immutable;
- resource registered explicit;
- provider registered explicit.

Hal yang perlu diverifikasi:

- repository thread-safe?
- repository memakai DataSource thread-safe?
- transaksi dikelola di mana?
- apakah `DefaultRequestContextFactory` mengambil request context dengan aman?
- apakah semua dependency benar-benar HK2-owned?

---

## 25. RequestContextFactory: Versi Aman dan Tidak Aman

### 25.1 Versi Tidak Aman

```java
@Singleton
public class BadRequestContextFactory implements RequestContextFactory {

    @Context
    private SecurityContext securityContext;

    private CommandContext lastContext;

    @Override
    public CommandContext fromCurrentRequest() {
        lastContext = new CommandContext(
            UUID.randomUUID().toString(),
            securityContext.getUserPrincipal().getName(),
            "tenant"
        );
        return lastContext;
    }
}
```

Masalah:

- singleton menyimpan `lastContext`;
- `@Context` di singleton harus sangat hati-hati;
- tidak jelas lifecycle;
- sulit untuk async/background.

### 25.2 Versi Lebih Aman: Context Diambil Saat Resource Boundary

```java
public class DefaultRequestContextFactory implements RequestContextFactory {

    @Override
    public CommandContext from(String correlationId,
                               SecurityContext securityContext,
                               String tenantId) {
        String actor = securityContext.getUserPrincipal() == null
            ? "anonymous"
            : securityContext.getUserPrincipal().getName();

        return new CommandContext(correlationId, actor, tenantId);
    }
}
```

Resource:

```java
@POST
public Response approve(@Context SecurityContext securityContext,
                        @Context HttpHeaders headers,
                        ApprovalRequest request) {
    CommandContext context = contextFactory.from(
        headers.getHeaderString("X-Correlation-Id"),
        securityContext,
        headers.getHeaderString("X-Tenant-Id")
    );

    return Response.ok(service.approve(context, request)).build();
}
```

Kelebihan:

- request-specific data eksplisit;
- factory stateless;
- tidak menyimpan request state;
- mudah dites.

Trade-off:

- method signature lebih panjang;
- resource tahu lebih banyak tentang context extraction.

Untuk sistem kompleks, extraction bisa diletakkan di filter dan disimpan sebagai request property.

---

## 26. Request Property Sebagai Alternatif Custom Request Injection

Filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class IdentityFilter implements ContainerRequestFilter {

    public static final String REQUEST_IDENTITY = "requestIdentity";

    private final TokenVerifier verifier;

    @Inject
    public IdentityFilter(TokenVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String token = extractBearerToken(requestContext);
        RequestIdentity identity = verifier.verify(token);
        requestContext.setProperty(REQUEST_IDENTITY, identity);
    }
}
```

Resource:

```java
@Path("/cases")
public class CaseResource {

    private final CaseService service;

    @Inject
    public CaseResource(CaseService service) {
        this.service = service;
    }

    @GET
    public Response list(@Context ContainerRequestContext requestContext) {
        RequestIdentity identity = (RequestIdentity)
            requestContext.getProperty(IdentityFilter.REQUEST_IDENTITY);

        return Response.ok(service.list(identity)).build();
    }
}
```

Kelebihan:

- sederhana;
- tidak perlu custom HK2 injection;
- lifecycle jelas: property milik request;
- filter dan resource boundary terlihat.

Kekurangan:

- casting manual;
- string key rawan typo;
- resource bergantung pada property name;
- tidak sebersih constructor injection.

Perbaikan:

```java
public final class RequestProperties {
    public static final String REQUEST_IDENTITY = RequestIdentity.class.getName();

    private RequestProperties() {}
}
```

atau buat helper:

```java
public final class RequestIdentityAccessor {

    public RequestIdentity require(ContainerRequestContext ctx) {
        Object value = ctx.getProperty(RequestProperties.REQUEST_IDENTITY);
        if (value instanceof RequestIdentity identity) {
            return identity;
        }
        throw new NotAuthorizedException("Missing request identity");
    }
}
```

---

## 27. Injection Failure Modes

### 27.1 Unsatisfied Dependency

Gejala:

```text
UnsatisfiedDependencyException
MultiException
No object available for injection
```

Penyebab umum:

- class belum di-bind;
- binder belum di-register;
- package scanning tidak mencakup provider/resource;
- salah namespace `javax.inject` vs `jakarta.inject`;
- class dibuat manual, bukan oleh Jersey;
- dependency berada di Spring/CDI tapi belum di-bridge ke HK2;
- qualifier mismatch;
- generic type binding salah.

Checklist:

```text
1. Apakah dependency didaftarkan di ResourceConfig yang benar?
2. Apakah dependency dibuat oleh HK2 atau container lain?
3. Apakah annotation namespace cocok dengan versi Jersey?
4. Apakah contract interface yang di-inject sama dengan yang di-bind?
5. Apakah ada qualifier?
6. Apakah resource/provider didaftarkan sebagai class, bukan instance yang salah?
```

### 27.2 Ambiguous Dependency

Gejala:

```text
More than one service matches
Ambiguous service resolution
```

Penyebab:

```java
bind(DefaultCaseService.class).to(CaseService.class);
bind(MockCaseService.class).to(CaseService.class);
```

Solusi:

- gunakan qualifier/name;
- hanya bind satu implementation per environment;
- gunakan ranking jika memang sesuai;
- pisahkan test config dan prod config;
- jangan scan semua package sembarangan.

### 27.3 Wrong Scope

Gejala:

- data request bercampur;
- memory leak;
- performance buruk;
- object dibuat terlalu sering;
- state hilang;
- cleanup tidak berjalan.

Contoh:

```text
HTTP client dibuat per request -> connection pool meledak.
Audit context singleton -> user bercampur.
Mapper mutable singleton -> JSON output tidak konsisten.
```

### 27.4 Injection Works in Resource But Fails in Filter

Kemungkinan:

- filter tidak terdaftar sebagai provider class;
- filter dibuat manual tanpa dependency;
- provider lifecycle berbeda;
- binder tidak aktif pada application tersebut;
- filter berada di package yang tidak discan;
- container integration tidak menjembatani provider.

### 27.5 `@Transactional` Tidak Bekerja

Kemungkinan:

- object tidak dibuat Spring/CDI;
- self-invocation melewati proxy;
- method tidak public;
- transaction manager tidak aktif;
- resource langsung memanggil repository tanpa service proxy;
- menggunakan HK2 binding untuk service yang seharusnya Spring-managed.

---

## 28. Debugging Injection Graph Secara Sistematis

Saat injection gagal, jangan langsung coba-coba register random package.

Gunakan pendekatan:

```text
Step 1 — Identifikasi komponen yang gagal dibuat
  Resource? Filter? Mapper? Provider? Service?

Step 2 — Identifikasi dependency yang gagal
  Type apa? Interface atau concrete? Ada qualifier?

Step 3 — Identifikasi owner
  HK2? Spring? CDI? Manual?

Step 4 — Periksa registration
  ResourceConfig register binder? packages? explicit class?

Step 5 — Periksa namespace
  javax vs jakarta?

Step 6 — Periksa scope
  Singleton/request/per-lookup? Ada request context saat dibuat?

Step 7 — Periksa construction style
  class registration atau instance registration?

Step 8 — Buat minimal reproduction
  resource kecil + binder kecil + dependency kecil.
```

Contoh minimal reproduction:

```java
@Path("/ping")
public class PingResource {

    private final PingService service;

    @Inject
    public PingResource(PingService service) {
        this.service = service;
    }

    @GET
    public String ping() {
        return service.ping();
    }
}

public interface PingService {
    String ping();
}

public class DefaultPingService implements PingService {
    public String ping() { return "pong"; }
}

public class TestApplication extends ResourceConfig {
    public TestApplication() {
        register(PingResource.class);
        register(new AbstractBinder() {
            protected void configure() {
                bind(DefaultPingService.class).to(PingService.class);
            }
        });
    }
}
```

Jika ini bekerja, masalah ada pada integration graph yang lebih besar.

---

## 29. Qualifier: Ketika Satu Contract Punya Banyak Implementation

Misal ada dua outbound client:

```java
public interface CaseExternalClient {
    ExternalCase get(String id);
}
```

Implementation:

```java
public class PrimaryCaseExternalClient implements CaseExternalClient { ... }
public class SecondaryCaseExternalClient implements CaseExternalClient { ... }
```

Jika keduanya di-bind ke contract yang sama tanpa pembeda, injection ambiguous.

Kita bisa memakai qualifier.

Contoh annotation:

```java
@Qualifier
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.METHOD, ElementType.TYPE})
public @interface PrimaryClient {}
```

Binding konseptual:

```java
bind(PrimaryCaseExternalClient.class)
    .to(CaseExternalClient.class)
    .qualifiedBy(new PrimaryClientLiteral());
```

Resource/service:

```java
@Inject
public CaseSyncService(@PrimaryClient CaseExternalClient client) {
    this.client = client;
}
```

Dalam praktik HK2, literal qualifier perlu dibuat sesuai API annotation literal yang digunakan.

Namun, sebelum memakai qualifier, tanyakan:

```text
Apakah benar satu service butuh memilih implementation di injection time?
Atau lebih baik buat dua contract berbeda?
```

Kadang lebih jelas:

```java
public interface PrimaryCaseClient { ... }
public interface SecondaryCaseClient { ... }
```

Jangan over-engineer qualifier jika nama contract bisa memperjelas maksud.

---

## 30. Generic Type Binding

Generic injection bisa tricky.

Contoh:

```java
public interface Serializer<T> {
    String serialize(T value);
}
```

Implementation:

```java
public class CaseSerializer implements Serializer<CaseDto> { ... }
public class UserSerializer implements Serializer<UserDto> { ... }
```

Injection:

```java
@Inject
Serializer<CaseDto> serializer;
```

Tidak semua DI binding generic berjalan sesuai intuisi jika type erasure dan binding descriptor tidak dikonfigurasi benar.

Untuk production, sering lebih jelas membuat contract spesifik:

```java
public interface CaseDtoSerializer {
    String serialize(CaseDto value);
}
```

atau gunakan registry eksplisit:

```java
public class SerializerRegistry {
    private final Map<Class<?>, Serializer<?>> serializers;
}
```

Generic bagus untuk library internal, tetapi untuk business service injection, explicit contract sering lebih mudah di-debug.

---

## 31. Java 8 sampai 25: Apa Yang Berubah Untuk Injection Model?

### 31.1 Java 8

Konteks umum:

- banyak Jersey 2.x legacy masih Java 8;
- namespace `javax.ws.rs`;
- `javax.inject`;
- belum ada module system;
- reflection relatif lebih bebas;
- banyak aplikasi WAR tradisional.

Risiko:

- dependency lama;
- classpath conflict;
- `javax` stack terkunci;
- upgrade ke Jakarta butuh migrasi besar.

### 31.2 Java 9+

Module system memperketat reflective access jika memakai module path.

Risiko:

- package tidak terbuka untuk reflection;
- automatic module ambiguity;
- split package;
- dependency lama tidak module-friendly.

Banyak aplikasi server tetap memakai classpath, tetapi engineer top-level harus tahu bahwa reflection/injection dan module path punya konsekuensi.

### 31.3 Java 11/17

Java 11 dan 17 sering menjadi baseline modern untuk server enterprise.

Perubahan relevan:

- dependency ecosystem lebih modern;
- TLS/runtime behavior berubah dibanding Java 8;
- GC dan observability membaik;
- Java 17 menjadi baseline penting untuk banyak Jakarta EE 11 stack.

Untuk Jersey 4/Jakarta REST 4.0, Java SE 17 menjadi baseline spec.

### 31.4 Java 21

Java 21 membawa virtual threads sebagai fitur final. Untuk injection model:

- jangan asumsikan satu request = platform thread mahal;
- ThreadLocal masih ada, tetapi propagation harus sadar lifecycle;
- request-scoped object tetap request-scoped, bukan thread-scoped secara konseptual;
- singleton tetap harus thread-safe;
- blocking service bisa lebih scalable jika container mendukung model yang sesuai.

### 31.5 Java 25

Java 25 adalah LTS terbaru. Untuk Jersey engineering:

- migration harus memperhatikan baseline framework;
- library compatibility lebih penting daripada syntax Java terbaru;
- module/reflection/security/runtime flags harus dites;
- virtual-thread/container support harus diuji berdasarkan server sebenarnya;
- jangan menganggap Jersey 2.x legacy otomatis cocok untuk Java 25 production tanpa dependency validation.

Prinsip:

> Java version menaikkan kemampuan runtime, tetapi tidak memperbaiki lifecycle design yang salah.

---

## 32. `javax` vs `jakarta`: Injection Namespace Trap

Jersey 2.x umumnya berada di dunia:

```text
javax.ws.rs.*
javax.inject.*
javax.annotation.*
```

Jersey 3.x/4.x berada di dunia:

```text
jakarta.ws.rs.*
jakarta.inject.*
jakarta.annotation.*
```

Kesalahan umum:

```java
import javax.inject.Inject;
```

padahal aplikasi Jersey 3/4 memakai Jakarta namespace.

Atau sebaliknya:

```java
import jakarta.inject.Inject;
```

padahal stack masih Jersey 2.x/Java EE legacy.

Gejala:

- annotation terlihat benar di code;
- compile mungkin berhasil karena dua dependency ada;
- runtime tidak mengenali injection seperti yang diharapkan;
- provider tidak terdeteksi;
- classpath berisi campuran `javax` dan `jakarta`.

Checklist migration:

```text
1. Pastikan Jersey major version.
2. Pastikan Jakarta REST/JAX-RS API version.
3. Pastikan Servlet namespace.
4. Pastikan Inject namespace.
5. Pastikan Bean Validation namespace.
6. Pastikan JSON-B/Jackson provider variant.
7. Pastikan server/container mendukung namespace yang sama.
```

Rule:

> Jangan campur `javax` dan `jakarta` kecuali kamu benar-benar memahami compatibility bridge yang sedang dipakai. Untuk aplikasi normal, campuran ini adalah red flag.

---

## 33. Object Yang Harus Singleton vs Tidak

| Object | Scope Umum | Catatan |
|---|---:|---|
| Stateless application service | Singleton | Aman jika dependency thread-safe |
| Repository berbasis DataSource | Singleton | DataSource/pool thread-safe, connection per operation |
| HTTP client dengan pool | Singleton | Jangan buat per request |
| ObjectMapper | Singleton | Konfigurasi selesai sebelum dipakai |
| Validator | Singleton | Biasanya thread-safe, cek implementation |
| RequestIdentity | Request | Actor/tenant/request-specific |
| AuditContext | Request | Jangan singleton |
| DTO | Per operation | Jangan di-bind sebagai service |
| Command object | Per operation | Dibuat manual dari request |
| Builder mutable | Per lookup/per operation | Jangan singleton jika mutable |
| Filter/provider | Singleton-like | Harus stateless/thread-safe |
| ExceptionMapper | Singleton-like | Jangan simpan exception/request state di field |
| Entity stream | Request | Jangan simpan keluar request |
| Database connection | Per operation/transaction | Jangan singleton raw connection |

---

## 34. Anti-Patterns Besar

### 34.1 Resource Sebagai Service Locator

```java
@Path("/cases")
public class CaseResource {

    @Context
    ServletContext servletContext;

    @POST
    public Response approve(ApprovalRequest request) {
        CaseService service = (CaseService) servletContext.getAttribute("caseService");
        return Response.ok(service.approve(request)).build();
    }
}
```

Masalah:

- dependency tersembunyi;
- type safety hilang;
- test sulit;
- lifecycle tidak jelas.

### 34.2 Static Global Container

```java
public final class GlobalServices {
    public static CaseService caseService;
}
```

Masalah:

- initialization order;
- test contamination;
- race;
- impossible to reason in multi-app deployment;
- hidden coupling.

### 34.3 Inject Everything Into Everything

```java
public class CaseService {
    @Inject HttpHeaders headers;
    @Inject SecurityContext security;
    @Inject ContainerRequestContext request;
    @Inject CaseRepository repository;
    @Inject MailClient mail;
    @Inject TemplateEngine template;
    @Inject AuditRepository audit;
}
```

Masalah:

- service layer tahu HTTP;
- sulit reuse;
- sulit test;
- transaction/security boundary kabur;
- request lifecycle masuk ke domain.

### 34.4 Framework Annotation Dianggap Architecture

```java
@Inject
@Transactional
@RolesAllowed
@Audited
@Cached
public class EverythingService { ... }
```

Annotation bisa berguna. Tetapi architecture bukan kumpulan annotation.

Pertanyaan sebenarnya:

- siapa enforce transaction?
- siapa enforce authorization?
- siapa menulis audit?
- apa failure behavior?
- bagaimana observability?
- apakah annotation aktif jika object dibuat HK2?

---

## 35. Designing For Regulatory/Case-Management Systems

Untuk sistem enforcement/case-management, injection design harus mendukung defensibility.

Yang biasanya penting:

```text
- actor identity jelas;
- role/authority jelas;
- tenant/agency/module context jelas;
- correlation ID jelas;
- audit context eksplisit;
- command boundary jelas;
- transaction boundary jelas;
- error mapping konsisten;
- side effect terkontrol;
- no hidden request state;
- no accidental cross-request contamination.
```

Desain resource:

```java
public Response approve(@PathParam("caseId") String caseId,
                        ApprovalRequest request,
                        @Context SecurityContext security,
                        @Context HttpHeaders headers) {
    CommandContext context = CommandContext.from(
        requireCorrelationId(headers),
        requireActor(security),
        requireTenant(headers)
    );

    ApproveCaseCommand command = new ApproveCaseCommand(
        caseId,
        request.decision(),
        request.reason()
    );

    ApprovalResult result = service.approve(context, command);

    return Response.ok(result).build();
}
```

Application service:

```java
public ApprovalResult approve(CommandContext context, ApproveCaseCommand command) {
    authorization.require(context.actor(), "CASE_APPROVE", command.caseId());

    CaseAggregate aggregate = repository.loadForUpdate(command.caseId());
    aggregate.approve(command.decision(), command.reason(), context.actor());

    repository.save(aggregate);

    audit.append(AuditEvent.caseApproved(
        context.correlationId(),
        context.actor(),
        command.caseId(),
        command.reason()
    ));

    return ApprovalResult.from(aggregate);
}
```

Perhatikan:

- resource mengambil HTTP context;
- service menerima context eksplisit;
- authorization eksplisit;
- audit eksplisit;
- no singleton request field;
- no hidden ThreadLocal dependency untuk business correctness.

---

## 36. Testing Injection Model

### 36.1 Unit Test Service Tanpa Jersey

Jika service didesain bersih, test tidak butuh Jersey.

```java
@Test
void approve_shouldAppendAudit() {
    FakeCaseRepository repository = new FakeCaseRepository();
    FakeAuditSink audit = new FakeAuditSink();

    CaseCommandService service = new DefaultCaseCommandService(repository, audit);

    CommandContext context = new CommandContext("corr-1", "alice", "tenant-a");
    ApproveCaseCommand command = new ApproveCaseCommand("CASE-1", "APPROVE", "ok");

    service.approve(context, command);

    assertThat(audit.events()).hasSize(1);
}
```

### 36.2 Jersey Test Untuk Injection Wiring

Gunakan Jersey test untuk memastikan binder dan resource wiring benar.

```java
@Override
protected Application configure() {
    return new ResourceConfig()
        .register(CaseResource.class)
        .register(new AbstractBinder() {
            @Override
            protected void configure() {
                bind(FakeCaseService.class).to(CaseService.class);
            }
        });
}
```

Test:

```java
@Test
void getCase_shouldUseInjectedService() {
    Response response = target("cases/CASE-1").request().get();
    assertEquals(200, response.getStatus());
}
```

### 36.3 Test Scope Behavior

Untuk dependency request-scoped, test bahwa instance tidak bocor.

```text
Request 1 -> actor alice
Request 2 -> actor bob
Pastikan service tidak melihat actor request sebelumnya.
```

### 36.4 Test Provider Thread Safety

Untuk filter/mapper/provider custom:

- jangan simpan mutable request state di field;
- lakukan parallel request test jika ada state;
- gunakan static analysis/code review untuk field mutable.

---

## 37. Production Checklist Untuk Jersey Injection

Gunakan checklist ini sebelum release.

### 37.1 Ownership

```text
[ ] Setiap resource dibuat oleh container yang jelas.
[ ] Setiap service dibuat oleh container yang jelas.
[ ] Tidak ada duplicate business singleton di HK2 dan Spring/CDI.
[ ] Transactional service dibuat oleh container yang mampu mengaktifkan transaction proxy.
[ ] Provider/filter/mapper ownership jelas.
```

### 37.2 Scope

```text
[ ] Singleton hanya menyimpan immutable/thread-safe state.
[ ] Tidak ada request-specific state di singleton field.
[ ] Request identity/context tidak bocor ke background thread.
[ ] HTTP client/pool tidak dibuat per request.
[ ] ObjectMapper tidak dimutasi saat runtime request.
[ ] Resource class stateless.
```

### 37.3 Registration

```text
[ ] ResourceConfig explicit untuk production.
[ ] Binder terdaftar di aplikasi yang benar.
[ ] Provider penting didaftarkan explicit.
[ ] Package scanning tidak terlalu luas.
[ ] Auto-discovery tidak menjadi satu-satunya mekanisme untuk komponen kritikal.
```

### 37.4 Namespace/Version

```text
[ ] Jersey major version cocok dengan `javax`/`jakarta` namespace.
[ ] Inject annotation namespace cocok.
[ ] Servlet namespace cocok.
[ ] Bean Validation namespace cocok.
[ ] JSON provider cocok dengan Jersey major version.
```

### 37.5 Testing

```text
[ ] Ada test resource wiring.
[ ] Ada test exception mapper wiring.
[ ] Ada test filter wiring.
[ ] Ada test request identity isolation.
[ ] Ada test bahwa service transactional benar-benar diproxy jika memakai Spring/CDI.
```

---

## 38. Heuristics Untuk Menjadi Engineer Yang Lebih Kuat Di Jersey DI

Pegang heuristics ini:

1. **Injection bukan magic; injection adalah object ownership.**
2. **Scope lebih penting daripada annotation.**
3. **Singleton adalah default yang berbahaya jika object menyimpan state.**
4. **Resource sebaiknya stateless walaupun lifecycle-nya per-request.**
5. **Provider/filter/mapper harus dianggap dipakai paralel oleh banyak request.**
6. **`@Context` adalah runtime context, bukan business dependency.**
7. **Request context untuk business logic sebaiknya dibuat eksplisit.**
8. **Jangan mencampur HK2, Spring, CDI tanpa ownership boundary.**
9. **Jika annotation seperti `@Transactional` tidak aktif, cek siapa yang membuat object.**
10. **Migration `javax` ke `jakarta` bukan rename biasa; itu perubahan ecosystem boundary.**

---

## 39. Mini Exercise

### Exercise 1 — Scope Diagnosis

Diberikan class berikut:

```java
@Provider
public class RequestLoggingFilter implements ContainerRequestFilter {

    private String path;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        path = requestContext.getUriInfo().getPath();
        log.info("path={}", path);
    }
}
```

Pertanyaan:

1. Apa bug potensialnya?
2. Apakah bug ini selalu terlihat di local testing?
3. Bagaimana perbaikannya?

Jawaban ringkas:

- `path` adalah request-specific state di provider yang kemungkinan singleton.
- Race hanya muncul saat concurrent request.
- Gunakan local variable, bukan field.

Perbaikan:

```java
@Provider
public class RequestLoggingFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String path = requestContext.getUriInfo().getPath();
        log.info("path={}", path);
    }
}
```

### Exercise 2 — Ownership Diagnosis

Diberikan:

```java
@Service
public class CaseService {
    @Transactional
    public void approve(String id) { ... }
}

register(new AbstractBinder() {
    protected void configure() {
        bind(CaseService.class).to(CaseService.class);
    }
});
```

Pertanyaan:

1. Apa risiko utamanya?
2. Kenapa `@Transactional` bisa tidak aktif?
3. Apa desain yang lebih benar?

Jawaban:

- Risiko: `CaseService` dibuat HK2, bukan Spring.
- `@Transactional` Spring bekerja melalui Spring proxy/container.
- Inject Spring-managed bean ke Jersey melalui integration/bridge, atau jadikan Jersey resource juga Spring-managed sesuai setup.

### Exercise 3 — Request Context Design

Diberikan requirement:

```text
Setiap approve case harus menyimpan actor, role, tenant, correlation ID, IP address, dan reason ke audit.
```

Desain buruk:

```java
@Singleton
public class AuditService {
    @Context HttpHeaders headers;
    @Context SecurityContext security;
}
```

Desain lebih baik:

```java
public record AuditContext(
    String correlationId,
    String actor,
    String tenant,
    String ipAddress
) {}
```

Resource/filter membentuk `AuditContext`, service menerima explicit context, audit sink menulis event.

---

## 40. Kesimpulan Part 11

Jersey injection model harus dipahami sebagai bagian dari runtime engineering.

Hal paling penting dari part ini:

```text
Jersey/HK2 tidak hanya “mengisi field”.
Ia mengelola object graph, lifecycle, scope, provider, resource, dan runtime context.
```

Jika kamu memahami:

- siapa owner object;
- bagaimana object dibuat;
- scope object;
- thread-safety object;
- perbedaan `@Context` dan `@Inject`;
- kapan memakai binder/factory;
- kapan request context harus eksplisit;
- bagaimana container lain seperti Spring/CDI masuk;
- bagaimana namespace `javax`/`jakarta` memengaruhi runtime;

maka kamu tidak hanya bisa “membuat endpoint Jersey”, tetapi bisa membangun API runtime yang stabil, aman, testable, dan defendable.

---

## 41. Referensi Resmi dan Relevan

- Eclipse Jersey User Guide — Custom Injection and Lifecycle Management.
- Eclipse Jersey User Guide — Application Deployment and Runtime Configuration.
- Jakarta RESTful Web Services 4.0 Specification dan API docs.
- Jakarta REST `@Context`, `Configuration`, `Providers`, `SecurityContext`, `HttpHeaders`, `UriInfo` API docs.
- Eclipse GlassFish HK2 documentation/API overview.
- Jersey migration notes untuk perubahan binding/injection dan peralihan `javax` ke `jakarta`.

---

## 42. Status Series

Progress saat ini:

```text
Part 0  — Orientasi seri                                  — selesai
Part 1  — Jersey mental model                              — selesai
Part 2  — Application bootstrap                            — selesai
Part 3  — Resource model internals                         — selesai
Part 4  — Request matching deep dive                       — selesai
Part 5  — Parameter injection semantics                    — selesai
Part 6  — Entity provider pipeline                         — selesai
Part 7  — JSON in Jersey                                   — selesai
Part 8  — Response engineering                             — selesai
Part 9  — Exception mapping architecture                   — selesai
Part 10 — Filters and interceptors                         — selesai
Part 11 — Jersey injection model                           — selesai
Part 12 — CDI, Spring, and Jersey Integration              — berikutnya
...
Part 32 — Capstone                                         — target akhir
```

Seri belum selesai. Part berikutnya adalah:

> **Part 12 — CDI, Spring, and Jersey Integration: Choosing the Composition Model**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Filters and Interceptors: Request/Response Pipeline Control](./10-filters-and-interceptors-request-response-pipeline-control.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 12 — CDI, Spring, and Jersey Integration: Choosing the Composition Model](./12-cdi-spring-and-jersey-integration-choosing-composition-model.md)
