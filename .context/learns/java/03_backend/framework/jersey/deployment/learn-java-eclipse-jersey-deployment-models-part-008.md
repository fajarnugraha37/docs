# learn-java-eclipse-jersey-deployment-models-part-008

# Part 8 — Programmatic Deployment with `ResourceConfig`

> Seri: **learn-java-eclipse-jersey-deployment-models**  
> Bagian: **Part 8 dari 32**  
> Topik: **Programmatic Deployment with `ResourceConfig`**  
> Target pembaca: Java engineer yang sudah memahami JAX-RS/Jakarta REST, servlet deployment, WAR, Jersey runtime, dan ingin naik level ke deployment model yang deterministik, eksplisit, mudah dites, dan production-grade.  
> Cakupan Java: **Java 8 sampai Java 25**  
> Cakupan Jersey: **Jersey 2.x (`javax.*`), Jersey 3.x/4.x (`jakarta.*`)**

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita membahas bagaimana Jersey ditempelkan ke servlet container melalui `ServletContainer`, filter, mapping, context path, dan deployment descriptor. Semua itu menjawab pertanyaan:

> “Bagaimana container menemukan dan menjalankan Jersey?”

Part ini menjawab pertanyaan yang lebih dalam:

> “Setelah Jersey ditemukan, bagaimana kita mendefinisikan aplikasi Jersey secara eksplisit, deterministik, dan production-grade?”

Di Jersey, pusat konfigurasi aplikasi server-side biasanya adalah:

```java
org.glassfish.jersey.server.ResourceConfig
```

Untuk Jersey 2.x, namespace API JAX-RS masih memakai:

```java
javax.ws.rs.*
```

Untuk Jersey 3.x/4.x, namespace sudah memakai:

```java
jakarta.ws.rs.*
```

Namun class Jersey spesifik seperti `ResourceConfig` tetap berada di package Jersey:

```java
org.glassfish.jersey.server.ResourceConfig
```

`ResourceConfig` adalah cara Jersey memberi kita kendali terhadap:

- resource class yang aktif,
- provider yang aktif,
- feature yang aktif,
- binder/injection binding,
- package scanning,
- property runtime,
- filtering/discovery behavior,
- JSON provider,
- validation feature,
- exception mapper,
- container-specific integration,
- dan bootstrap behavior.

Mental model utama part ini:

> Deployment model menentukan **di mana Jersey hidup**.  
> `ResourceConfig` menentukan **apa isi aplikasi Jersey dan bagaimana runtime-nya dibangun**.

---

## 2. Kenapa `ResourceConfig` Penting untuk Engineer Level Tinggi?

Engineer pemula sering membiarkan Jersey melakukan auto-discovery sebanyak mungkin:

```java
@ApplicationPath("/api")
public class MyApplication extends Application {
}
```

Lalu berharap semua resource, provider, mapper, filter, dan feature ditemukan otomatis.

Itu bisa jalan untuk demo. Tetapi untuk sistem besar, regulated, multi-module, cloud deployment, dan platform yang harus mudah diaudit, pendekatan terlalu implisit sering menjadi sumber masalah.

Masalah yang sering muncul:

1. Resource tidak terdaftar tetapi aplikasi tetap start.
2. Provider JSON berbeda antara local dan server.
3. `ExceptionMapper` tidak aktif karena package scanning tidak menjangkau module tertentu.
4. Filter auth aktif di satu deployment tetapi tidak aktif di deployment lain.
5. Dependency injection binding bentrok antara HK2/CDI/Spring/custom binder.
6. Startup lambat karena scanning package terlalu luas.
7. Classpath berisi provider duplikat.
8. Container menyediakan API tertentu tetapi aplikasi juga membundel API versi berbeda.
9. Test environment tidak identik dengan production environment.
10. Deployment tampak sukses tetapi runtime behavior salah.

`ResourceConfig` membantu mengubah deployment dari:

```text
implicit + magical + environment-dependent
```

menjadi:

```text
explicit + auditable + testable + deterministic
```

Itulah pola pikir engineer top-tier.

---

## 3. Apa Itu `ResourceConfig`?

Secara konseptual, `ResourceConfig` adalah **application model builder** untuk Jersey server runtime.

Ia bukan HTTP server. Ia bukan servlet container. Ia bukan reverse proxy. Ia bukan API gateway.

Ia adalah konfigurasi runtime Jersey yang menjawab:

```text
Aplikasi REST ini terdiri dari resource apa?
Provider apa?
Filter apa?
Feature apa?
Binder apa?
Property apa?
Package mana yang discan?
Behavior Jersey apa yang dinyalakan?
```

Secara sederhana:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
        property("jersey.config.server.tracing.type", "ON_DEMAND");
    }
}
```

Di servlet deployment, class ini bisa dipakai oleh Jersey `ServletContainer`.

Di embedded deployment, instance `ResourceConfig` bisa diberikan langsung ke server factory seperti Grizzly atau Jetty integration.

---

## 4. `Application` vs `ResourceConfig`

JAX-RS/Jakarta REST mendefinisikan class standar:

```java
javax.ws.rs.core.Application
```

atau:

```java
jakarta.ws.rs.core.Application
```

`Application` adalah abstraction standar. Ia portable di berbagai implementation JAX-RS/Jakarta REST.

`ResourceConfig` adalah subclass/extension Jersey yang memberi API konfigurasi lebih kaya.

Mental modelnya:

```text
Application
  = kontrak standar spesifikasi

ResourceConfig
  = Application + Jersey-specific configuration API
```

### 4.1 Standard `Application`

Contoh:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            HealthResource.class,
            UserResource.class,
            GlobalExceptionMapper.class
        );
    }
}
```

Kelebihan:

- portable,
- mengikuti spesifikasi,
- minim dependency Jersey-specific di application class.

Kekurangan:

- kurang ergonomis,
- lebih sulit mengatur Jersey feature/properties,
- tidak sepraktis untuk package scanning, feature registration, dan custom binding.

### 4.2 Jersey `ResourceConfig`

Contoh:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
    }
}
```

Kelebihan:

- fluent registration,
- mudah mengaktifkan feature Jersey,
- bisa package scanning,
- bisa register binder,
- bisa set property,
- cocok untuk deployment yang eksplisit.

Kekurangan:

- Jersey-specific,
- tidak portable ke implementation lain tanpa modifikasi,
- harus hati-hati jika aplikasi ingin benar-benar vendor-neutral.

Untuk seri ini, karena topiknya memang **Eclipse Jersey Deployment Models**, `ResourceConfig` adalah pusat pembahasan yang sah.

---

## 5. Di Mana `ResourceConfig` Dipakai?

`ResourceConfig` bisa dipakai dalam beberapa deployment model.

### 5.1 Servlet Container dengan `@ApplicationPath`

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
    }
}
```

Container menemukan application class melalui annotation scanning, lalu Jersey membangun runtime berdasarkan konfigurasi tersebut.

### 5.2 Servlet Container dengan `web.xml`

```xml
<servlet>
    <servlet-name>jersey-api</servlet-name>
    <servlet-class>org.glassfish.jersey.servlet.ServletContainer</servlet-class>
    <init-param>
        <param-name>jakarta.ws.rs.Application</param-name>
        <param-value>com.example.ApiApplication</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
    <servlet-name>jersey-api</servlet-name>
    <url-pattern>/api/*</url-pattern>
</servlet-mapping>
```

Untuk Jersey 2.x, param name sering memakai bentuk `javax.ws.rs.Application`.

Untuk Jersey 3.x/4.x, dunia Jakarta memakai `jakarta.ws.rs.Application`.

Namun detail nama init-param perlu selalu divalidasi terhadap versi Jersey/container yang dipakai, karena deployment descriptor adalah bagian yang sangat sensitif terhadap major version.

### 5.3 Embedded Grizzly

```java
ResourceConfig config = new ResourceConfig()
    .register(HealthResource.class)
    .register(UserResource.class)
    .register(JacksonFeature.class);

HttpServer server = GrizzlyHttpServerFactory.createHttpServer(
    URI.create("http://0.0.0.0:8080/"),
    config
);
```

Di sini tidak ada WAR. Tidak ada external servlet container. Aplikasi Java sendiri yang membuat HTTP server dan memasukkan `ResourceConfig` ke Jersey runtime.

### 5.4 Embedded Jetty

Dalam model Jetty embedded, kita biasanya membuat server, context, servlet holder, lalu memasukkan application class atau instance konfigurasi.

Konsepnya:

```text
main()
  -> create Server
  -> create ServletContextHandler
  -> create ServletHolder(ServletContainer)
  -> configure Application/ResourceConfig
  -> start server
```

### 5.5 Test Runtime

`ResourceConfig` sangat berguna untuk test karena kita bisa membuat konfigurasi minimal:

```java
public class UserResourceTest extends JerseyTest {
    @Override
    protected Application configure() {
        return new ResourceConfig()
            .register(UserResource.class)
            .register(TestExceptionMapper.class)
            .register(new TestBinder());
    }
}
```

Dengan ini test tidak perlu menjalankan seluruh WAR atau container production.

---

## 6. Model Mental: `ResourceConfig` sebagai Runtime Manifest

Bayangkan `ResourceConfig` sebagai manifest runtime yang eksplisit.

```text
ResourceConfig
├── resource classes
├── singleton resource instances
├── providers
│   ├── MessageBodyReader
│   ├── MessageBodyWriter
│   ├── ExceptionMapper
│   ├── ContextResolver
│   └── ParamConverterProvider
├── filters
│   ├── ContainerRequestFilter
│   └── ContainerResponseFilter
├── dynamic features
├── name binding filters
├── binders / injection bindings
├── properties
├── package scanning roots
└── runtime features
```

Kalau WAR adalah packaging manifest, maka `ResourceConfig` adalah **Jersey runtime manifest**.

Engineer top-tier tidak hanya bertanya:

> “Apakah endpoint jalan?”

Tetapi:

> “Apakah runtime manifest-nya eksplisit, deterministic, reproducible, observable, dan aman terhadap classpath drift?”

---

## 7. Tiga Gaya Konfigurasi `ResourceConfig`

Ada tiga gaya utama.

### 7.1 Fully Explicit Registration

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
        register(OrderResource.class);

        register(GlobalExceptionMapper.class);
        register(ValidationExceptionMapper.class);
        register(JsonMappingExceptionMapper.class);

        register(AuthenticationFilter.class);
        register(CorrelationIdFilter.class);
        register(AuditResponseFilter.class);

        register(JacksonFeature.class);
        register(new ApiBinder());
    }
}
```

Kelebihan:

- sangat eksplisit,
- mudah diaudit,
- startup lebih predictable,
- bagus untuk regulated environment,
- tidak tergantung package scanning,
- mudah dibuat checklist.

Kekurangan:

- lebih verbose,
- harus disiplin saat menambah resource/provider baru,
- ada risiko lupa register class baru.

Cocok untuk:

- sistem regulated,
- platform enterprise,
- aplikasi dengan audit/security tinggi,
- layanan yang jumlah resource-nya manageable,
- deployment yang harus deterministik.

### 7.2 Package Scanning

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages(
            "com.example.api.resource",
            "com.example.api.provider",
            "com.example.api.filter"
        );
    }
}
```

Kelebihan:

- lebih ringkas,
- cocok untuk aplikasi kecil-menengah,
- resource baru otomatis ditemukan.

Kekurangan:

- startup bisa lebih lambat,
- behavior tergantung classpath,
- scanning root terlalu luas bisa bahaya,
- lebih sulit diaudit,
- berisiko menemukan class yang tidak dimaksudkan.

Cocok untuk:

- internal service sederhana,
- prototyping serius,
- aplikasi dengan package discipline sangat baik.

### 7.3 Hybrid Explicit + Narrow Scanning

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api.resource");

        register(GlobalExceptionMapper.class);
        register(AuthenticationFilter.class);
        register(CorrelationIdFilter.class);
        register(JacksonFeature.class);
        register(new ApiBinder());
    }
}
```

Ini sering menjadi sweet spot.

Resource discan dari package terbatas, tetapi provider penting diregister eksplisit.

Kenapa provider penting sebaiknya eksplisit?

Karena provider menentukan behavior sistem:

- error response,
- JSON serialization,
- auth,
- audit,
- validation,
- correlation ID,
- security header,
- content negotiation.

Kesalahan provider bisa lebih berbahaya daripada resource tidak ditemukan.

---

## 8. Resource Registration

Resource adalah class yang berisi endpoint REST.

Contoh Jakarta:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/health")
public class HealthResource {
    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public String health() {
        return "OK";
    }
}
```

Register eksplisit:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
    }
}
```

Mental model:

```text
Resource class registered
  -> Jersey inspects @Path methods
  -> builds resource model
  -> maps HTTP method + path + media type
  -> runtime can dispatch request
```

Jika resource class tidak terdaftar dan tidak ditemukan scanning, endpoint tidak ada.

Gejala:

```text
HTTP 404
```

Tetapi root cause-nya bukan selalu URL salah. Bisa jadi resource tidak masuk `ResourceConfig`.

---

## 9. Provider Registration

Provider adalah komponen yang memengaruhi pipeline request/response.

Contoh provider:

- `ExceptionMapper<T>`
- `MessageBodyReader<T>`
- `MessageBodyWriter<T>`
- `ContainerRequestFilter`
- `ContainerResponseFilter`
- `ContextResolver<T>`
- `ParamConverterProvider`
- `Feature`
- `DynamicFeature`

### 9.1 Exception Mapper

```java
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable exception) {
        return Response.serverError()
            .entity(new ErrorResponse("INTERNAL_ERROR", "Unexpected error"))
            .build();
    }
}
```

Register:

```java
register(GlobalExceptionMapper.class);
```

Jangan mengandalkan `@Provider` saja jika aplikasi tidak melakukan scanning terhadap package provider tersebut.

Annotation `@Provider` menandai class sebagai provider, tetapi runtime tetap harus menemukannya.

### 9.2 Message Body Provider

JSON, XML, multipart, SSE, dan custom binary format biasanya masuk melalui provider.

Contoh Jackson:

```java
register(JacksonFeature.class);
```

Atau custom object mapper melalui `ContextResolver`:

```java
@Provider
public class ObjectMapperProvider implements ContextResolver<ObjectMapper> {
    private final ObjectMapper mapper;

    public ObjectMapperProvider() {
        this.mapper = new ObjectMapper()
            .findAndRegisterModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return mapper;
    }
}
```

Register:

```java
register(ObjectMapperProvider.class);
```

Production invariant:

> JSON provider harus eksplisit dan sama antara local, test, staging, dan production.

Kalau tidak, serialization/deserialization behavior bisa berubah tanpa terlihat saat compile time.

---

## 10. Feature Registration

`Feature` adalah cara mengaktifkan sekumpulan behavior.

Contoh umum:

```java
register(JacksonFeature.class);
register(MultiPartFeature.class);
register(ServerProperties.BV_SEND_ERROR_IN_RESPONSE, true);
```

Konseptual:

```text
Feature
  -> runs during application bootstrap
  -> registers providers/binders/properties
  -> modifies runtime model
```

Feature cocok untuk:

- JSON support,
- multipart support,
- bean validation,
- metrics,
- tracing,
- auth module,
- common platform module.

Contoh custom feature:

```java
public class PlatformFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdFilter.class);
        context.register(SecurityHeadersFilter.class);
        context.register(GlobalExceptionMapper.class);
        context.property("app.platform.feature.enabled", true);
        return true;
    }
}
```

Register:

```java
register(PlatformFeature.class);
```

Ini berguna untuk platform engineering:

```text
Semua service Jersey wajib register PlatformFeature.
```

Dengan begitu, cross-cutting behavior menjadi reusable dan enforceable.

---

## 11. Binder Registration dan Dependency Injection Boundary

Jersey menggunakan injection infrastructure sendiri. Di banyak versi Jersey 2/3, HK2 menjadi bagian penting dari internal injection model.

`ResourceConfig` dapat mendaftarkan binder:

```java
public class ApiBinder extends AbstractBinder {
    @Override
    protected void configure() {
        bind(UserServiceImpl.class)
            .to(UserService.class);

        bindFactory(DatabaseConnectionFactory.class)
            .to(DatabaseConnection.class)
            .proxy(true);
    }
}
```

Register:

```java
register(new ApiBinder());
```

Lalu resource:

```java
@Path("/users")
public class UserResource {
    private final UserService userService;

    @Inject
    public UserResource(UserService userService) {
        this.userService = userService;
    }
}
```

Untuk Jersey 2.x Java 8:

```java
import javax.inject.Inject;
```

Untuk Jakarta-era dependency stack, tergantung integrasi yang dipakai:

```java
import jakarta.inject.Inject;
```

Namun perlu hati-hati: namespace injection juga bisa menjadi sumber mismatch.

### 11.1 DI Ownership Decision

Pertanyaan production-grade:

```text
Siapa pemilik dependency injection?

- Jersey/HK2?
- CDI container?
- Spring?
- Guice?
- custom manual wiring?
```

Jangan mencampur tanpa boundary jelas.

Bad smell:

```text
Sebagian service dibuat HK2,
sebagian CDI,
sebagian Spring,
sebagian static singleton,
sebagian manual new.
```

Akibat:

- lifecycle tidak jelas,
- resource leak,
- transaction boundary ambigu,
- test sulit,
- behavior berbeda antar deployment model.

### 11.2 Binder Cocok untuk Apa?

Binder cocok untuk:

- service interface ke implementation,
- repository abstraction,
- clock/time provider,
- ID generator,
- external client wrapper,
- config object,
- per-request context,
- platform service.

Binder tidak cocok untuk menyembunyikan operational complexity tanpa lifecycle control.

Contoh buruk:

```java
bind(new ExpensiveExternalClient()).to(ExternalClient.class);
```

Kalau client butuh close/shutdown, connection pool, metrics, dan refresh credential, lifecycle-nya harus eksplisit.

---

## 12. Property Configuration

`ResourceConfig` bisa menyimpan property:

```java
property("app.name", "case-management-api");
property("app.deployment.model", "servlet-war");
property(ServerProperties.BV_SEND_ERROR_IN_RESPONSE, false);
```

Property bisa memengaruhi:

- Jersey internal behavior,
- validation behavior,
- tracing behavior,
- provider behavior,
- custom feature behavior.

Mental model:

```text
External config
  -> translated into typed application config
  -> injected into ResourceConfig/features/binders
  -> used to build runtime behavior
```

Jangan menjadikan `ResourceConfig` sebagai tempat membaca env var secara liar di banyak titik.

Lebih baik:

```java
public final class ApiRuntimeConfig {
    private final String appName;
    private final boolean detailedErrorsEnabled;
    private final Duration requestTimeout;

    // constructor + getters
}
```

Lalu:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication(ApiRuntimeConfig config) {
        register(new ApiBinder(config));
        register(GlobalExceptionMapper.class);
        property("app.name", config.appName());
    }
}
```

Dengan begitu konfigurasi bisa dites.

---

## 13. Constructor Pattern untuk `ResourceConfig`

Ada beberapa pola constructor.

### 13.1 Default Constructor untuk Container Discovery

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
    }
}
```

Cocok untuk servlet container yang membuat instance application class sendiri.

Kelebihan:

- mudah untuk WAR deployment,
- compatible dengan container discovery,
- sederhana.

Kekurangan:

- sulit memasukkan runtime config yang sudah divalidasi,
- mudah tergoda membaca env var langsung di constructor.

### 13.2 Constructor dengan Config Object

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication(ApiRuntimeConfig config) {
        register(new ApiBinder(config));
        register(HealthResource.class);
        register(UserResource.class);
    }
}
```

Cocok untuk embedded deployment dan test.

Kelebihan:

- sangat testable,
- config bisa divalidasi sebelum runtime start,
- bagus untuk Java main application.

Kekurangan:

- tidak selalu langsung cocok dengan container discovery,
- butuh factory/bootstrap layer.

### 13.3 Static Factory

```java
public final class ApiApplications {
    private ApiApplications() {
    }

    public static ResourceConfig production(ApiRuntimeConfig config) {
        return new ResourceConfig()
            .register(new ApiBinder(config))
            .register(HealthResource.class)
            .register(UserResource.class)
            .register(GlobalExceptionMapper.class)
            .register(JacksonFeature.class);
    }

    public static ResourceConfig test(ApiRuntimeConfig config) {
        return new ResourceConfig()
            .register(new TestBinder(config))
            .register(UserResource.class)
            .register(GlobalExceptionMapper.class)
            .register(JacksonFeature.class);
    }
}
```

Ini berguna jika ingin menghindari inheritance berlebihan.

---

## 14. Explicit Registration vs `@Provider` Annotation

`@Provider` hanya menandai class sebagai provider.

Tetapi provider baru aktif jika:

1. discan oleh runtime,
2. didaftarkan eksplisit,
3. didaftarkan oleh feature,
4. ditemukan oleh service loader/metainf services jika mekanisme itu diaktifkan,
5. atau disediakan oleh container/runtime.

Jadi:

```java
@Provider
public class GlobalExceptionMapper implements ExceptionMapper<Throwable> {
}
```

belum cukup jika package provider tidak discan.

Pola yang lebih deterministic:

```java
register(GlobalExceptionMapper.class);
```

Untuk sistem besar, gunakan rule:

```text
Critical providers must be explicitly registered.
```

Critical providers:

- auth filters,
- authorization filters,
- audit filters,
- exception mappers,
- object mapper provider,
- validation mapper,
- correlation ID filter,
- security headers filter.

---

## 15. Package Scanning: Kapan Aman, Kapan Bahaya

Package scanning terlihat nyaman:

```java
packages("com.example");
```

Tetapi ini terlalu luas.

Lebih baik:

```java
packages(
    "com.example.caseapi.resource",
    "com.example.caseapi.provider"
);
```

### 15.1 Risiko Scanning Terlalu Luas

Risiko:

- resource internal ikut aktif,
- experimental provider ikut aktif,
- duplicate mapper terdeteksi,
- startup lambat,
- behavior berubah saat dependency baru ditambahkan,
- test berbeda dengan production karena classpath berbeda,
- package dari module lain ikut terbaca.

Contoh bahaya:

```java
packages("com.company");
```

Di monorepo enterprise, ini bisa menarik terlalu banyak class.

### 15.2 Scanning Root yang Baik

Pola yang baik:

```java
packages("com.company.product.caseapi.boundary.rest");
```

Atau:

```java
packages(
    ResourceMarker.class.getPackageName(),
    ProviderMarker.class.getPackageName()
);
```

Dengan marker:

```java
package com.company.product.caseapi.boundary.rest;

public final class ResourceMarker {
    private ResourceMarker() {
    }
}
```

Keuntungan marker:

- refactor-safe,
- tidak raw string di banyak tempat,
- package boundary jelas.

Java 8 belum memiliki `Class::getPackageName`, jadi gunakan:

```java
ResourceMarker.class.getPackage().getName()
```

Untuk Java 9+:

```java
ResourceMarker.class.getPackageName()
```

---

## 16. Registration Ordering

Tidak semua registration order selalu berarti prioritas runtime. Namun ordering tetap penting sebagai readability dan governance.

Pola yang disarankan:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        registerCoreRuntime();
        registerConfiguration();
        registerDependencyInjection();
        registerSerialization();
        registerSecurity();
        registerObservability();
        registerErrorHandling();
        registerResources();
    }

    private void registerCoreRuntime() {
        // base properties
    }

    private void registerDependencyInjection() {
        register(new ApiBinder());
    }

    private void registerSerialization() {
        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);
    }

    private void registerSecurity() {
        register(AuthenticationFilter.class);
        register(AuthorizationFilter.class);
    }

    private void registerObservability() {
        register(CorrelationIdFilter.class);
        register(AccessLogFilter.class);
    }

    private void registerErrorHandling() {
        register(GlobalExceptionMapper.class);
        register(ValidationExceptionMapper.class);
    }

    private void registerResources() {
        register(HealthResource.class);
        register(UserResource.class);
    }
}
```

Ini bukan karena Jersey selalu butuh order tersebut, tetapi karena manusia butuh membaca niat deployment dengan jelas.

---

## 17. Priority dan Filter Ordering

Untuk filter, ordering bisa diatur dengan priority.

Contoh:

```java
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        // authenticate
    }
}
```

Authorization:

```java
@Priority(Priorities.AUTHORIZATION)
public class AuthorizationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        // authorize
    }
}
```

Mental model:

```text
Container-level filter chain
  -> Jersey receives request
  -> Jersey container request filters by priority
  -> resource matching / method invocation
  -> response filters
```

Jangan mencampur urutan filter servlet dan filter Jersey tanpa diagram.

Deployment filter order:

```text
Servlet Filter A
Servlet Filter B
Jersey ServletContainer
  Jersey ContainerRequestFilter X
  Jersey ContainerRequestFilter Y
  Resource Method
  Jersey ContainerResponseFilter Z
Servlet Filter B response side
Servlet Filter A response side
```

---

## 18. `ResourceConfig` dalam WAR Deployment

Dalam WAR deployment, `ResourceConfig` biasanya ditemukan melalui:

1. `@ApplicationPath`,
2. `web.xml` init-param,
3. servlet container scanning,
4. explicit servlet initialization.

Contoh:

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api.resource");
        register(GlobalExceptionMapper.class);
        register(JacksonFeature.class);
    }
}
```

Container-level concern tetap di luar `ResourceConfig`:

```text
context path
servlet mapping
filter chain
session config
security constraints
listener lifecycle
container classloader
```

Jangan salah kaprah:

```text
ResourceConfig tidak menentukan context path WAR.
ResourceConfig tidak menentukan port Tomcat.
ResourceConfig tidak menentukan TLS connector.
ResourceConfig tidak menentukan ALB path rule.
```

Ia hanya menentukan Jersey application model.

---

## 19. `ResourceConfig` dalam Embedded Deployment

Embedded deployment biasanya punya bootstrap code:

```java
public final class Main {
    public static void main(String[] args) throws Exception {
        ApiRuntimeConfig runtimeConfig = ApiRuntimeConfigLoader.load(args);
        ResourceConfig resourceConfig = ApiApplications.production(runtimeConfig);

        HttpServer server = GrizzlyHttpServerFactory.createHttpServer(
            runtimeConfig.baseUri(),
            resourceConfig,
            false
        );

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.shutdownNow();
        }));

        server.start();
        Thread.currentThread().join();
    }
}
```

Dalam embedded deployment, aplikasi memegang kendali lebih besar:

- port,
- bind address,
- TLS,
- HTTP server lifecycle,
- shutdown hook,
- config loading,
- metrics startup,
- health readiness,
- dependency lifecycle.

Karena itu `ResourceConfig` perlu menjadi bagian dari bootstrap pipeline yang lebih besar.

```text
load config
  -> validate config
  -> create dependencies
  -> create ResourceConfig
  -> create HTTP server
  -> start server
  -> mark readiness
  -> handle shutdown
```

---

## 20. `ResourceConfig` dan Jakarta EE Managed Runtime

Dalam Jakarta EE server, sebagian behavior bisa disediakan oleh container:

- CDI,
- transactions,
- security,
- validation,
- JNDI resources,
- data source,
- managed executor,
- application lifecycle.

Di sini `ResourceConfig` tidak boleh merebut semua ownership secara sembarangan.

Pertanyaan penting:

```text
Apakah resource class CDI-managed atau Jersey-managed?
Apakah transaction boundary dari container atau manual service layer?
Apakah security principal dari container atau custom JWT filter?
Apakah object mapper disediakan app atau server?
```

Pola buruk:

```text
Jakarta EE server menyediakan CDI,
tetapi aplikasi register HK2 binder yang membuat service duplikat,
sementara transaction annotation ada di CDI bean.
```

Pola baik:

```text
ResourceConfig hanya register REST-specific provider,
sementara dependency/service/transaction mengikuti container-managed CDI.
```

Atau:

```text
ResourceConfig mengelola semua service via Jersey/HK2,
dan aplikasi tidak mengandalkan CDI transaction/security.
```

Yang penting: ownership jelas.

---

## 21. Java 8 sampai Java 25: Perbedaan Praktis untuk `ResourceConfig`

### 21.1 Java 8

Biasanya berpasangan dengan:

- Jersey 2.x,
- `javax.ws.rs.*`,
- Servlet 3.x/4.x,
- `javax.servlet.*`,
- `javax.inject.*`.

Keterbatasan:

- tidak ada module system,
- tidak ada `Set.of`,
- tidak ada `var`,
- tidak ada records,
- tidak ada virtual threads,
- TLS/JDK behavior lebih lama,
- library modern banyak yang sudah drop Java 8.

Contoh Java 8-compatible:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(HealthResource.class);
        register(UserResource.class);
        register(GlobalExceptionMapper.class);
    }
}
```

Hindari:

```java
Set.of(...)
```

Gunakan:

```java
new HashSet<Class<?>>(Arrays.asList(...))
```

jika memakai standard `Application#getClasses()`.

### 21.2 Java 11

Umum untuk Jersey 3.x baseline awal.

Perubahan penting:

- Java EE modules sudah tidak bundled di JDK,
- harus explicit dependency untuk APIs,
- TLS/JVM/container ergonomics lebih baik,
- module path mulai relevan walau banyak app tetap classpath.

### 21.3 Java 17

Baseline modern penting untuk Jakarta EE 11/Jakarta REST 4.0 world.

Keuntungan:

- records bisa dipakai untuk DTO/config,
- sealed classes bisa membantu error model,
- performance/runtime maturity baik,
- LTS widely adopted.

Contoh config:

```java
public record ApiRuntimeConfig(
    String appName,
    URI baseUri,
    boolean detailedErrorsEnabled
) {
}
```

### 21.4 Java 21

Menarik karena virtual threads tersedia sebagai fitur final.

Namun `ResourceConfig` sendiri bukan tempat mengaktifkan virtual threads. Threading biasanya milik host runtime:

- servlet container connector/executor,
- Grizzly thread pool,
- Jetty thread pool,
- Netty event loop/offload executor,
- custom executor.

Jangan berpikir:

```text
Saya pakai ResourceConfig maka otomatis virtual threads.
```

Tidak.

### 21.5 Java 25

Java 25 sebagai LTS modern relevan untuk deployment jangka panjang. Tetapi compatibility tetap harus dilihat dari:

- Jersey major version,
- Jakarta REST version,
- Servlet container support,
- bytecode target,
- dependencies,
- build plugin,
- testing toolchain,
- native image/tooling jika dipakai.

Prinsip:

```text
Java runtime boleh modern,
tetapi dependency graph dan container harus kompatibel.
```

---

## 22. Namespace Boundary: `javax.*` vs `jakarta.*`

Ini invariant paling penting.

### 22.1 Jersey 2.x

Biasanya:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.core.Response;
```

Servlet:

```java
import javax.servlet.*;
```

### 22.2 Jersey 3.x/4.x

Biasanya:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.Response;
```

Servlet:

```java
import jakarta.servlet.*;
```

### 22.3 Yang Tidak Boleh Terjadi

Jangan mencampur:

```java
jakarta.ws.rs.Path
```

dengan Jersey/container yang mencari:

```java
javax.ws.rs.Path
```

Atau sebaliknya.

Gejala:

- resource tidak ditemukan,
- provider tidak aktif,
- annotation tampak benar di source code tetapi runtime mengabaikan,
- 404 semua endpoint,
- startup warning aneh,
- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- `LinkageError`.

Mental model:

```text
javax annotation and jakarta annotation are different types.
Same concept, different binary identity.
```

Runtime yang mencari `jakarta.ws.rs.Path` tidak akan menganggap `javax.ws.rs.Path` sebagai annotation yang sama.

---

## 23. Designing a Production `ResourceConfig`

Pola desain yang disarankan:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        this(ApiRuntimeConfig.fromEnvironment());
    }

    public ApiApplication(ApiRuntimeConfig config) {
        validate(config);

        registerRuntimeProperties(config);
        registerInjection(config);
        registerSerialization(config);
        registerSecurity(config);
        registerObservability(config);
        registerErrorHandling(config);
        registerResources(config);
    }

    private void registerRuntimeProperties(ApiRuntimeConfig config) {
        property("app.name", config.appName());
        property("app.environment", config.environment());
    }

    private void registerInjection(ApiRuntimeConfig config) {
        register(new ApiBinder(config));
    }

    private void registerSerialization(ApiRuntimeConfig config) {
        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);
    }

    private void registerSecurity(ApiRuntimeConfig config) {
        register(AuthenticationFilter.class);
        register(AuthorizationFilter.class);
        register(SecurityHeadersFilter.class);
    }

    private void registerObservability(ApiRuntimeConfig config) {
        register(CorrelationIdFilter.class);
        register(RequestLoggingFilter.class);
    }

    private void registerErrorHandling(ApiRuntimeConfig config) {
        register(GlobalExceptionMapper.class);
        register(ValidationExceptionMapper.class);
    }

    private void registerResources(ApiRuntimeConfig config) {
        register(HealthResource.class);
        register(UserResource.class);
        register(OrderResource.class);
    }

    private static void validate(ApiRuntimeConfig config) {
        Objects.requireNonNull(config, "config");
    }
}
```

Catatan:

- default constructor berguna untuk container,
- config constructor berguna untuk test/embedded,
- method kecil membuat intent jelas,
- critical providers eksplisit,
- resource eksplisit atau scanning sempit.

---

## 24. Health Resource: Jangan Campur Readiness dan Liveness

Dengan `ResourceConfig`, kita bisa register health resource:

```java
@Path("/health")
public class HealthResource {
    @GET
    @Path("/live")
    public Response live() {
        return Response.ok("LIVE").build();
    }

    @GET
    @Path("/ready")
    public Response ready() {
        return Response.ok("READY").build();
    }
}
```

Namun readiness tidak boleh asal `200`.

Readiness harus menjawab:

```text
Apakah instance ini siap menerima traffic production?
```

Bisa mencakup:

- config valid,
- dependency penting tersedia,
- DB reachable jika mandatory,
- cache optional boleh degraded,
- migration status aman,
- app sudah selesai startup,
- shutdown belum dimulai.

Liveness harus lebih sederhana:

```text
Apakah proses masih hidup dan tidak deadlocked fatal?
```

Jangan membuat liveness tergantung DB. Kalau DB down, semua pod bisa restart storm.

---

## 25. Startup Validation

`ResourceConfig` constructor sering menjadi tempat terlalu banyak logic. Hati-hati.

Tujuan startup validation:

- fail fast jika config fatal tidak valid,
- memastikan provider penting terdaftar,
- memastikan dependency injection binding tersedia,
- memastikan tidak ada namespace mismatch,
- memastikan object mapper deterministik,
- memastikan endpoint health aktif.

Tetapi jangan melakukan operasi berat di constructor:

- jangan query DB besar,
- jangan call external service lama,
- jangan download secret remote tanpa timeout,
- jangan menjalankan migration berat,
- jangan blocking tak terbatas.

Pola lebih baik:

```text
Bootstrap phase
  -> load config with timeout
  -> validate config
  -> initialize dependencies with timeout
  -> build ResourceConfig
  -> start HTTP server/container
  -> readiness true
```

---

## 26. Avoiding Hidden Global State

Anti-pattern:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        GlobalConfig.load();
        StaticClients.init();
        register(UserResource.class);
    }
}
```

Masalah:

- test saling bocor,
- redeploy memory leak,
- shutdown sulit,
- dependency lifecycle tidak jelas,
- parallel test gagal random,
- classloader lama tertahan static reference.

Pola lebih baik:

```java
ApiRuntimeConfig config = ApiRuntimeConfigLoader.load();
ExternalClients clients = ExternalClients.create(config);
ResourceConfig app = ApiApplications.production(config, clients);
```

ResourceConfig sebaiknya menerima dependency yang sudah jelas lifecycle-nya.

---

## 27. Multi-Module Jersey Application

Dalam aplikasi enterprise, resource/provider sering tersebar di beberapa module:

```text
case-api-rest
case-api-resource
case-api-provider
case-api-security
case-api-observability
case-domain
case-application-service
case-infrastructure
```

Pola registration:

```java
register(new PlatformFeature());
register(new CaseModuleFeature());
register(new DocumentModuleFeature());
register(new AppealModuleFeature());
```

Masing-masing module feature:

```java
public class CaseModuleFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CaseResource.class);
        context.register(CaseExceptionMapper.class);
        context.register(CaseAuditFilter.class);
        return true;
    }
}
```

Keuntungan:

- modular,
- tiap module punya deployment manifest sendiri,
- top-level app tetap ringkas,
- module bisa diuji terpisah.

Risiko:

- feature ordering harus jelas,
- duplicate provider bisa muncul,
- security provider jangan tersebar liar,
- module feature jangan membaca config global sembarangan.

---

## 28. Testability dengan `ResourceConfig`

`ResourceConfig` membuat testing lebih sehat.

### 28.1 Unit-ish Jersey Test

```java
@Override
protected Application configure() {
    return new ResourceConfig()
        .register(UserResource.class)
        .register(GlobalExceptionMapper.class)
        .register(new TestBinder());
}
```

Tujuan:

- test resource method,
- test serialization,
- test exception mapping,
- test filter behavior,
- test auth bypass/mock.

### 28.2 Production Config Smoke Test

Buat test yang membangun production `ResourceConfig`:

```java
@Test
void productionResourceConfigCanBeBuilt() {
    ApiRuntimeConfig config = ApiRuntimeConfig.testDefaults();
    ResourceConfig app = new ApiApplication(config);
    assertNotNull(app);
}
```

Lebih baik lagi, inspect registered classes jika memungkinkan:

```java
assertTrue(app.getClasses().contains(HealthResource.class));
assertTrue(app.getClasses().contains(GlobalExceptionMapper.class));
```

### 28.3 Contract Test untuk Provider Penting

Pastikan error mapper aktif:

```java
Response response = target("/users/invalid").request().get();
assertEquals(400, response.getStatus());
assertEquals("VALIDATION_ERROR", response.readEntity(ErrorResponse.class).code());
```

Pastikan JSON mapper sama:

```java
String json = target("/users/1").request().get(String.class);
assertTrue(json.contains("createdAt"));
```

---

## 29. Observability Registration

Cross-cutting observability bisa diregister via `ResourceConfig`:

```java
register(CorrelationIdFilter.class);
register(RequestTimingFilter.class);
register(AccessLogFilter.class);
```

Request filter:

```java
public class CorrelationIdFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        String correlationId = ctx.getHeaderString("X-Correlation-ID");
        if (correlationId == null || correlationId.isBlank()) {
            correlationId = UUID.randomUUID().toString();
        }
        ctx.setProperty("correlationId", correlationId);
    }
}
```

Response filter:

```java
public class CorrelationIdResponseFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        Object id = request.getProperty("correlationId");
        if (id != null) {
            response.getHeaders().putSingle("X-Correlation-ID", id.toString());
        }
    }
}
```

Production invariant:

```text
Every response should be traceable to request id / correlation id.
```

Jangan hanya mengandalkan reverse proxy. Application-level correlation tetap penting untuk resource/provider error.

---

## 30. Security Registration

Jersey-level security filter sering dipakai untuk JWT, API key, tenant context, atau custom authorization.

```java
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        String authorization = ctx.getHeaderString("Authorization");
        if (authorization == null) {
            ctx.abortWith(Response.status(Response.Status.UNAUTHORIZED).build());
            return;
        }
        // validate token
    }
}
```

Register:

```java
register(AuthenticationFilter.class);
```

Security boundary harus jelas:

```text
TLS termination: proxy/container?
Authentication: proxy/container/Jersey?
Authorization: container/Jersey/service layer?
Principal propagation: request context/security context?
Audit: filter/resource/service?
```

Jangan menyembunyikan policy penting di package scanning tidak eksplisit.

Security filter sebaiknya eksplisit.

---

## 31. Error Handling Registration

Exception mapper menentukan external contract.

Contoh:

```java
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {
    @Override
    public Response toResponse(DomainException exception) {
        ErrorResponse error = new ErrorResponse(
            exception.code(),
            exception.publicMessage()
        );
        return Response.status(exception.httpStatus()).entity(error).build();
    }
}
```

Register:

```java
register(DomainExceptionMapper.class);
```

Production rule:

```text
No raw stack trace in client response.
No silent 500 without correlation id.
No domain exception mapped as generic 500.
No validation error shape varying by deployment.
```

`ResourceConfig` adalah tempat memastikan mapper-map penting aktif.

---

## 32. Serialization Registration

Serialization adalah deployment-sensitive.

Contoh:

```java
register(JacksonFeature.class);
register(ObjectMapperProvider.class);
```

Config object mapper:

```java
@Provider
public final class ObjectMapperProvider implements ContextResolver<ObjectMapper> {
    private final ObjectMapper objectMapper;

    public ObjectMapperProvider() {
        this.objectMapper = new ObjectMapper()
            .findAndRegisterModules()
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    @Override
    public ObjectMapper getContext(Class<?> type) {
        return objectMapper;
    }
}
```

Hal yang harus diputuskan:

- date/time format,
- unknown property handling,
- enum handling,
- null field inclusion,
- BigDecimal serialization,
- binary payload,
- polymorphic typing,
- timezone,
- locale,
- error DTO format.

Jangan biarkan object mapper default berubah karena dependency order.

---

## 33. `ResourceConfig` and Service Loader / Auto Discovery

Jersey punya mekanisme discovery untuk feature/provider tertentu, tergantung modul dan konfigurasi.

Auto-discovery berguna tetapi harus dikontrol.

Masalah umum:

```text
Menambahkan dependency baru tanpa sadar mengaktifkan provider baru.
```

Contoh:

- JSON-B provider aktif padahal ingin Jackson,
- MOXy aktif padahal tidak diinginkan,
- multipart provider tidak ada di satu env,
- metainf services berbeda karena shading.

Prinsip:

```text
For critical behavior, prefer explicit registration over accidental discovery.
```

Jika memakai auto-discovery, dokumentasikan:

- dependency apa yang sengaja mengaktifkan feature,
- provider mana yang expected,
- bagaimana test memverifikasi behavior.

---

## 34. Programmatic Resource Model

Selain class berbasis annotation, Jersey juga punya kemampuan programmatic resource model. Ini advanced dan lebih jarang dipakai.

Konsepnya:

```text
Resource model dibuat lewat API builder,
bukan hanya lewat @Path annotation.
```

Kapan berguna?

- dynamic endpoint generation,
- plugin architecture,
- internal framework,
- compatibility adapter,
- generated API layer,
- DSL-driven routing.

Tetapi ini bukan default choice untuk kebanyakan aplikasi.

Risiko:

- lebih sulit dibaca,
- lebih sulit oleh tim baru,
- lebih mudah membuat routing tidak transparan,
- dokumentasi OpenAPI bisa lebih sulit,
- debugging resource matching lebih kompleks.

Untuk regulated enterprise system, gunakan hanya jika ada alasan kuat.

---

## 35. `ResourceConfig` dan OpenAPI

OpenAPI generation biasanya membutuhkan resource dan model terdaftar konsisten.

Jika resource registration eksplisit, OpenAPI generation lebih predictable.

Jika package scanning terlalu luas, dokumentasi bisa memasukkan endpoint yang tidak dimaksudkan.

Jika package scanning terlalu sempit, endpoint bisa jalan di satu env tapi tidak muncul di doc atau sebaliknya.

Production invariant:

```text
Runtime endpoint set and documented endpoint set must match.
```

Cara enforce:

- generate OpenAPI dari same `ResourceConfig`,
- contract test endpoint critical,
- CI check diff OpenAPI,
- review perubahan resource registration.

---

## 36. Environment-Specific Registration: Hati-Hati

Kadang kita ingin register provider hanya di environment tertentu.

Contoh:

```java
if (config.detailedErrorsEnabled()) {
    register(DebugExceptionMapper.class);
} else {
    register(GlobalExceptionMapper.class);
}
```

Ini berbahaya jika tidak dikontrol.

Lebih baik:

```java
register(GlobalExceptionMapper.class);
property("app.errors.includeDetails", config.detailedErrorsEnabled());
```

Mapper membaca property/config untuk menentukan detail response, tetapi mapper-nya tetap sama.

Mengapa?

Karena endpoint/provider set yang berbeda antar env membuat bug sulit direproduksi.

Rule:

```text
Prefer same registered component set across environments.
Use config to change behavior, not component graph, unless necessary.
```

Exception:

- test-specific fake provider,
- dev-only debug endpoint,
- optional feature benar-benar optional,
- profile-specific integration.

Jika berbeda, dokumentasikan eksplisit.

---

## 37. Multi-Tenant ResourceConfig

Untuk sistem multi-tenant, jangan membuat satu `ResourceConfig` per tenant kecuali benar-benar perlu.

Biasanya lebih baik:

```text
single ResourceConfig
  -> tenant resolved per request
  -> tenant context injected
  -> service layer applies tenant isolation
```

Filter:

```java
public class TenantFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        String tenant = ctx.getHeaderString("X-Tenant-ID");
        ctx.setProperty("tenantId", tenant);
    }
}
```

Per-tenant `ResourceConfig` bisa membuat:

- memory overhead,
- startup overhead,
- classloader complexity,
- provider duplication,
- harder rollout,
- inconsistent behavior.

Gunakan per-tenant runtime hanya untuk architecture plugin yang memang membutuhkan isolation kuat.

---

## 38. Multiple Jersey Applications in One WAR

Bisa ada beberapa Jersey servlet/application dalam satu WAR:

```text
/api/internal/* -> InternalApplication
/api/public/*   -> PublicApplication
/api/admin/*    -> AdminApplication
```

Masing-masing punya `ResourceConfig`:

```java
public class PublicApplication extends ResourceConfig {
    public PublicApplication() {
        register(PublicResource.class);
        register(PublicAuthFilter.class);
    }
}

public class AdminApplication extends ResourceConfig {
    public AdminApplication() {
        register(AdminResource.class);
        register(AdminAuthFilter.class);
    }
}
```

Kapan cocok?

- public API dan admin API punya security boundary berbeda,
- internal API harus dipisahkan,
- versioned API dengan provider berbeda,
- migration path dari legacy ke new API.

Risiko:

- duplicated providers,
- inconsistent error response,
- confusing mapping,
- more startup cost,
- more operational surface.

Pola baik:

```java
public final class CommonJerseyRuntime {
    public static void registerCommon(ResourceConfig config) {
        config.register(JacksonFeature.class);
        config.register(ObjectMapperProvider.class);
        config.register(GlobalExceptionMapper.class);
        config.register(CorrelationIdFilter.class);
    }
}
```

Lalu:

```java
public class PublicApplication extends ResourceConfig {
    public PublicApplication() {
        CommonJerseyRuntime.registerCommon(this);
        register(PublicResource.class);
        register(PublicAuthFilter.class);
    }
}
```

---

## 39. ResourceConfig and Deployment Diagnostics

Saat deployment gagal, diagnosa melalui pertanyaan berikut.

### 39.1 Apakah `ResourceConfig` Terpakai?

Gejala jika tidak:

- semua endpoint 404,
- provider tidak aktif,
- log constructor tidak muncul,
- health endpoint tidak ada.

Cek:

- `@ApplicationPath` ditemukan?
- `web.xml` menunjuk class benar?
- package application class discan container?
- init-param benar untuk Jersey major version?
- servlet mapping benar?

### 39.2 Apakah Resource Terdaftar?

Cek:

- explicit `register(Resource.class)` ada?
- package scanning root benar?
- resource pakai annotation namespace benar?
- class masuk artifact final?
- module dependency masuk WAR/jar?

### 39.3 Apakah Provider Aktif?

Cek:

- mapper/filter/provider diregister eksplisit?
- `@Provider` discan?
- duplicate provider conflict?
- priority benar?
- package provider masuk scanning?

### 39.4 Apakah Namespace Mismatch?

Cek:

- Jersey 2 + `javax`?
- Jersey 3/4 + `jakarta`?
- Servlet container `javax.servlet` atau `jakarta.servlet`?
- dependency API double?

### 39.5 Apakah Dependency Graph Drift?

Cek:

- local berbeda dengan production?
- shaded jar menghapus `META-INF/services`?
- container menyediakan Jersey sendiri?
- app membundel Jersey versi lain?
- JSON provider lebih dari satu?

---

## 40. Common Failure Modes

### 40.1 Semua Endpoint 404

Kemungkinan:

- `ResourceConfig` tidak dimuat,
- servlet mapping salah,
- `@ApplicationPath` salah,
- resource tidak terdaftar,
- namespace annotation salah,
- context path/proxy path salah.

### 40.2 JSON Response 500

Kemungkinan:

- JSON provider tidak aktif,
- object mapper salah,
- DTO tidak serializable,
- circular reference,
- date/time module tidak terdaftar,
- provider conflict.

### 40.3 Exception Mapper Tidak Aktif

Kemungkinan:

- mapper tidak registered,
- package provider tidak discan,
- mapper type terlalu spesifik/salah,
- mapper kalah oleh mapper lain,
- thrown exception dibungkus exception lain.

### 40.4 Auth Filter Tidak Jalan

Kemungkinan:

- filter tidak registered,
- pakai servlet filter padahal register Jersey filter,
- priority/order salah,
- resource pakai name binding tetapi annotation tidak cocok,
- endpoint health sengaja bypass tetapi rule terlalu luas.

### 40.5 Works in Test, Fails in WAR

Kemungkinan:

- test `ResourceConfig` berbeda dari production,
- dependency di test classpath berbeda,
- container menyediakan API versi lain,
- scanning behavior berbeda,
- `web.xml` tidak menunjuk application class yang sama.

---

## 41. Production Checklist untuk `ResourceConfig`

Gunakan checklist ini sebelum deployment.

### 41.1 Application Discovery

- [ ] Application class jelas.
- [ ] `@ApplicationPath` atau `web.xml` tidak konflik.
- [ ] Servlet mapping sesuai public API path.
- [ ] Constructor application dipanggil saat startup.

### 41.2 Namespace

- [ ] Jersey 2.x memakai `javax.*` secara konsisten.
- [ ] Jersey 3.x/4.x memakai `jakarta.*` secara konsisten.
- [ ] Tidak ada dependency API duplikat lintas namespace.

### 41.3 Registration

- [ ] Resource critical terdaftar.
- [ ] Provider critical eksplisit.
- [ ] JSON provider eksplisit.
- [ ] Exception mapper eksplisit.
- [ ] Auth/security filter eksplisit.
- [ ] Correlation/logging filter eksplisit.

### 41.4 Scanning

- [ ] Package scanning sempit.
- [ ] Tidak scanning root terlalu luas seperti `com.company`.
- [ ] Scanning behavior sama di test dan production.

### 41.5 Dependency Injection

- [ ] DI owner jelas.
- [ ] Binder tidak membuat lifecycle resource bocor.
- [ ] Tidak mencampur HK2/CDI/Spring tanpa boundary.
- [ ] Dependency penting bisa ditutup saat shutdown.

### 41.6 Configuration

- [ ] Config divalidasi sebelum startup selesai.
- [ ] Environment-specific behavior terdokumentasi.
- [ ] Provider set tidak berubah liar antar environment.

### 41.7 Observability

- [ ] Correlation ID tersedia.
- [ ] Error response punya trace/correlation id.
- [ ] Startup log mencatat deployment model dan application class.
- [ ] Health endpoint tersedia.

### 41.8 Testing

- [ ] Production `ResourceConfig` bisa dibuild di test.
- [ ] Endpoint critical diuji.
- [ ] Exception mapper diuji.
- [ ] JSON serialization diuji.
- [ ] Auth filter diuji.

---

## 42. Top 1% Mental Model

Engineer biasa melihat `ResourceConfig` sebagai tempat menaruh `register()`.

Engineer kuat melihat `ResourceConfig` sebagai:

```text
runtime manifest + component graph + provider policy + deployment contract
```

Engineer top-tier akan bertanya:

1. Apakah runtime manifest eksplisit?
2. Apakah behavior deterministic antar environment?
3. Apakah provider critical tidak accidental?
4. Apakah DI ownership jelas?
5. Apakah namespace boundary bersih?
6. Apakah startup fail-fast?
7. Apakah health/readiness benar?
8. Apakah observability aktif sejak request pertama?
9. Apakah test memakai manifest yang sama dengan production?
10. Apakah classpath drift bisa dideteksi CI?

`ResourceConfig` bukan sekadar konfigurasi teknis. Ia adalah kontrak bahwa aplikasi REST yang kita deploy memang aplikasi yang kita pikir kita deploy.

---

## 43. Mini Case Study: Dari Implicit ke Deterministic

### 43.1 Kondisi Awal

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {
}
```

Resource dan provider mengandalkan scanning otomatis.

Masalah:

- exception mapper tidak selalu aktif,
- object mapper berbeda di local dan staging,
- auth filter lupa terbawa di satu module,
- endpoint baru tidak terdokumentasi,
- startup tidak memberi sinyal provider apa saja aktif.

### 43.2 Refactor

```java
@ApplicationPath("/api")
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        registerRuntime();
        registerProviders();
        registerSecurity();
        registerObservability();
        registerResources();
    }

    private void registerRuntime() {
        property("app.name", "case-api");
    }

    private void registerProviders() {
        register(JacksonFeature.class);
        register(ObjectMapperProvider.class);
        register(GlobalExceptionMapper.class);
        register(ValidationExceptionMapper.class);
    }

    private void registerSecurity() {
        register(AuthenticationFilter.class);
        register(AuthorizationFilter.class);
    }

    private void registerObservability() {
        register(CorrelationIdFilter.class);
        register(RequestTimingFilter.class);
    }

    private void registerResources() {
        register(HealthResource.class);
        register(CaseResource.class);
        register(DocumentResource.class);
        register(AppealResource.class);
    }
}
```

### 43.3 Hasil

- endpoint set eksplisit,
- provider set eksplisit,
- JSON behavior stabil,
- auth/audit terlihat di manifest,
- test bisa build config yang sama,
- deployment lebih mudah diaudit,
- 404/500 lebih mudah didiagnosis.

---

## 44. Latihan Praktis

### Latihan 1 — Build Minimal `ResourceConfig`

Buat:

- `HealthResource`,
- `GlobalExceptionMapper`,
- `CorrelationIdFilter`,
- `ApiApplication extends ResourceConfig`.

Pastikan `/health/live` mengembalikan 200.

### Latihan 2 — Ubah dari Scanning ke Explicit Registration

Jika sebelumnya memakai:

```java
packages("com.example");
```

ubah menjadi explicit registration untuk provider critical.

### Latihan 3 — Buat Production Manifest Test

Buat test yang memastikan:

- `HealthResource` registered,
- `GlobalExceptionMapper` registered,
- `ObjectMapperProvider` registered,
- `AuthenticationFilter` registered.

### Latihan 4 — Simulasikan Namespace Mismatch

Di branch eksperimen, campur `javax.ws.rs.Path` dengan Jersey 3.x. Amati gejala. Jangan deploy ke production.

Tujuan latihan ini bukan untuk membuat sistem rusak, tetapi agar memahami bahwa namespace mismatch adalah binary identity problem.

### Latihan 5 — Buat Common Feature

Buat `PlatformFeature` yang mendaftarkan:

- correlation ID filter,
- security headers filter,
- global exception mapper,
- object mapper provider.

Lalu register feature itu di dua aplikasi Jersey berbeda.

---

## 45. Ringkasan

Pada part ini kita membahas `ResourceConfig` sebagai pusat programmatic deployment Jersey.

Poin utama:

1. Deployment model menentukan di mana Jersey hidup.
2. `ResourceConfig` menentukan apa isi aplikasi Jersey.
3. `Application` adalah standard abstraction; `ResourceConfig` adalah Jersey-specific configuration API.
4. Explicit registration lebih deterministic daripada scanning luas.
5. Provider critical sebaiknya registered eksplisit.
6. JSON provider, exception mapper, security filter, dan observability filter adalah deployment-critical.
7. DI ownership harus jelas: Jersey/HK2, CDI, Spring, atau lainnya.
8. Environment-specific component graph harus dihindari kecuali sangat perlu.
9. Namespace `javax.*` vs `jakarta.*` adalah binary boundary, bukan sekadar rename kosmetik.
10. `ResourceConfig` yang baik adalah runtime manifest yang bisa diaudit, dites, dan direproduksi.

---

## 46. Koneksi ke Part Berikutnya

Part ini membahas bagaimana membangun aplikasi Jersey secara programmatic.

Part berikutnya akan membahas:

> **Part 9 — Classpath, Module Path, JPMS, dan Split-Package Problem**

Kenapa ini penting?

Karena sebaik apa pun `ResourceConfig`, semua registration tetap bergantung pada class yang benar-benar tersedia di classpath/module path runtime. Banyak bug deployment Jersey bukan bug resource, bukan bug servlet mapping, tetapi bug dependency graph dan classloading.

---

## Status Seri

Seri **belum selesai**.

Progress saat ini:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — berikutnya
...
Part 32 — target akhir seri
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-007.md">⬅️ Servlet Mapping Semantics: `/`, `/*`, `/api/*`, Extension Mapping, dan Edge Cases</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-009.md">Part 9 — Classpath, Module Path, JPMS, dan Split-Package Problem ➡️</a>
</div>
