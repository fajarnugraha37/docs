# Part 26 — Configuration Engineering: Properties, Environments, Features, and Runtime Flags

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
Status: Part 26 dari 32  
Target pembaca: engineer yang sudah memahami Java, Jakarta REST/JAX-RS, servlet/container runtime, JSON provider, filter/interceptor, client runtime, deployment, observability, dan performance model.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas bagaimana Jersey dijalankan: servlet container, Grizzly embedded, Jakarta EE server, Spring Boot, WAR, fat jar, container image, Kubernetes, health check, dan graceful shutdown.

Part ini masuk ke pertanyaan yang lebih sering menyebabkan production drift:

> Bagaimana kita mengendalikan perilaku Jersey secara eksplisit, konsisten, aman, dan mudah diaudit melalui konfigurasi?

Konfigurasi di Jersey bukan hanya `property("key", value)`. Konfigurasi menentukan:

- resource apa yang aktif,
- provider apa yang menang,
- filter/interceptor apa yang berjalan,
- apakah auto-discovery boleh melakukan registrasi implisit,
- timeout outbound client,
- validation behavior,
- tracing/monitoring behavior,
- ukuran buffer,
- bagaimana environment DEV/UAT/PROD berbeda,
- bagaimana feature flag memengaruhi API surface,
- bagaimana konfigurasi sensitif disuntikkan tanpa bocor,
- bagaimana startup gagal cepat ketika konfigurasi tidak valid.

Engineer biasa melihat konfigurasi sebagai detail deployment. Engineer yang lebih matang melihat konfigurasi sebagai bagian dari **runtime contract**.

---

## 1. Referensi dan Versi yang Menjadi Baseline

Materi ini menggunakan baseline konseptual berikut:

- Jersey 2.x untuk dunia `javax.ws.rs` / Java EE 8 legacy.
- Jersey 3.x untuk dunia `jakarta.ws.rs` / Jakarta EE 9/10.
- Jersey 4.x untuk Jakarta EE 11 dan Jakarta REST 4.0.
- Java 8 sampai Java 25, dengan perhatian khusus pada perbedaan legacy Java 8 dan modern Java 17/21/25.

Beberapa dokumen resmi penting:

- Jersey official site mencantumkan dokumentasi Jersey 4.0.x untuk Jakarta EE 11 dan Jersey 3.1.x untuk Jakarta EE 10.
- Jersey User Guide menjelaskan deployment, auto-discoverable features, `ResourceConfig`, dan runtime environment.
- Jersey configuration properties didokumentasikan melalui `CommonProperties`, `ServerProperties`, dan `ClientProperties`.
- Jakarta REST API menyediakan model `Configurable`, `Configuration`, `Feature`, dan `DynamicFeature`.

Catatan penting: nama package berubah dari `javax.ws.rs.*` ke `jakarta.ws.rs.*` mulai Jersey 3.x. Banyak prinsip konfigurasi tetap sama, tetapi class name dan dependency artifact berubah.

---

## 2. Mental Model: Konfigurasi Jersey Adalah Komposisi Runtime

Jersey runtime pada dasarnya dibangun dari beberapa graph:

```text
Jersey Application Runtime
├── application metadata
│   ├── application path
│   ├── application name
│   └── registered classes/instances
├── resource model
│   ├── root resources
│   ├── sub-resource locators
│   └── resource methods
├── provider model
│   ├── MessageBodyReader
│   ├── MessageBodyWriter
│   ├── ExceptionMapper
│   ├── ParamConverterProvider
│   └── ContextResolver
├── pipeline model
│   ├── request filters
│   ├── response filters
│   ├── reader interceptors
│   └── writer interceptors
├── injection model
│   ├── HK2 binders
│   ├── CDI/Spring bridge
│   └── contextual objects
├── client model
│   ├── connectors
│   ├── timeouts
│   ├── providers
│   └── outbound filters
└── operational model
    ├── logging
    ├── metrics
    ├── tracing
    ├── feature flags
    └── environment-specific values
```

Konfigurasi adalah cara kita menentukan graph tersebut.

Ada dua gaya besar:

```text
Implicit runtime
  "Jersey scan saja classpath dan temukan sendiri."

Explicit runtime
  "Saya register resource, provider, feature, binder, property, dan client config secara sadar."
```

Untuk production enterprise, gaya kedua jauh lebih aman.

---

## 3. Kenapa Configuration Engineering Penting

### 3.1 Konfigurasi Mengubah Behavior Tanpa Mengubah Code

Contoh:

```java
property("jersey.config.disableAutoDiscovery", true);
```

Satu properti seperti ini bisa mengubah apakah Jersey akan otomatis menemukan provider/feature tertentu atau tidak.

Implikasinya:

- JSON provider yang tadinya aktif bisa hilang.
- Multipart feature bisa tidak tersedia.
- Monitoring/tracing auto-feature bisa tidak aktif.
- Resource yang mengandalkan scanning bisa tidak terdaftar.

### 3.2 Drift Antar Environment Sulit Dideteksi

Aplikasi yang sama bisa berbeda behavior di DEV dan PROD karena:

- dependency berbeda,
- classpath berbeda,
- servlet init-param berbeda,
- environment variable berbeda,
- auto-discovery menemukan provider berbeda,
- Spring profile berbeda,
- container image berbeda,
- property default berbeda antara Jersey version.

Masalah paling berbahaya biasanya bukan konfigurasi yang jelas salah, tetapi konfigurasi yang **valid namun berbeda**.

### 3.3 Default Tidak Selalu Production-Safe

Default configuration biasanya dibuat agar mudah mulai, bukan agar paling aman untuk regulated production system.

Contoh default yang perlu ditinjau:

- package scanning terlalu luas,
- auto-discovery aktif,
- logging filter mencatat payload mentah,
- client timeout tidak diset eksplisit,
- entity buffering tidak dikontrol,
- error payload terlalu verbose di non-production lalu terbawa ke production,
- feature baru aktif berdasarkan environment variable tanpa audit.

---

## 4. Sumber Konfigurasi Jersey

Konfigurasi Jersey bisa datang dari beberapa tempat.

```text
Configuration Sources
├── Java code
│   ├── ResourceConfig constructor
│   ├── Application subclass
│   ├── Feature.configure()
│   ├── DynamicFeature.configure()
│   └── Binder registration
├── Servlet deployment
│   ├── web.xml
│   ├── Servlet init-param
│   ├── Filter init-param
│   └── @ApplicationPath
├── Framework integration
│   ├── Spring Boot properties
│   ├── CDI/Jakarta EE server config
│   └── MicroProfile Config
├── Environment
│   ├── environment variables
│   ├── system properties
│   ├── mounted config files
│   ├── Kubernetes ConfigMap
│   └── Kubernetes Secret / external secret source
├── Client runtime
│   ├── ClientBuilder
│   ├── ClientConfig
│   ├── WebTarget properties
│   └── Invocation-level properties
└── Build/dependency graph
    ├── classpath
    ├── module path
    ├── service files
    └── included Jersey modules
```

Konsekuensi: untuk debug configuration bug, jangan hanya cek `ResourceConfig`. Cek juga deployment descriptor, framework bridge, environment, dan dependency graph.

---

## 5. Core API: `Application`, `ResourceConfig`, `Configurable`, `Configuration`, `Feature`

### 5.1 `Application`

`Application` adalah model standar Jakarta REST.

Contoh:

```java
@ApplicationPath("/api")
public class ApiApplication extends Application {

    @Override
    public Set<Class<?>> getClasses() {
        return Set.of(
            CustomerResource.class,
            ProblemExceptionMapper.class,
            JacksonFeature.class
        );
    }
}
```

Kelebihan:

- portable secara spec,
- cocok untuk Jakarta EE server,
- sederhana.

Kekurangan:

- kurang ergonomis untuk konfigurasi Jersey-specific,
- kurang nyaman untuk conditional registration,
- kurang fleksibel dibanding `ResourceConfig`.

### 5.2 `ResourceConfig`

`ResourceConfig` adalah class Jersey untuk membangun konfigurasi aplikasi secara programmatic.

Contoh:

```java
@ApplicationPath("/api")
public final class ApiResourceConfig extends ResourceConfig {

    public ApiResourceConfig() {
        register(CustomerResource.class);
        register(OrderResource.class);
        register(ProblemExceptionMapper.class);
        register(JacksonFeature.class);

        property("jersey.config.server.application.name", "customer-api");
        property("jersey.config.disableAutoDiscovery", true);
    }
}
```

Mental model:

```text
ResourceConfig = explicit construction plan for Jersey runtime
```

### 5.3 `Configurable`

Banyak Jersey/Jakarta REST object mengikuti model `Configurable`:

- `ResourceConfig`,
- `ClientConfig`,
- `FeatureContext`,
- `WebTarget`,
- `Invocation.Builder` pada tingkat tertentu.

Modelnya:

```java
configurable.register(MyProvider.class);
configurable.property("some.key", someValue);
```

Artinya, provider dan property dapat diterapkan pada level berbeda.

### 5.4 `Configuration`

`Configuration` adalah view read-only terhadap konfigurasi yang sudah ada.

Contoh penggunaan di `Feature`:

```java
public final class AuditFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        Boolean enabled = (Boolean) context.getConfiguration()
            .getProperty("app.audit.enabled");

        if (Boolean.TRUE.equals(enabled)) {
            context.register(AuditRequestFilter.class);
            context.register(AuditResponseFilter.class);
        }

        return true;
    }
}
```

### 5.5 `Feature`

`Feature` adalah meta-provider. Ia tidak langsung menangani request, tetapi mendaftarkan komponen lain saat bootstrap.

Contoh:

```java
public final class PlatformApiFeature implements Feature {
    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdFilter.class);
        context.register(ProblemExceptionMapper.class);
        context.register(JsonObjectMapperProvider.class);
        context.property("app.platform.feature.loaded", true);
        return true;
    }
}
```

Feature cocok untuk membuat reusable Jersey platform module.

---

## 6. Kategori Configuration Properties

Secara praktis, property Jersey dapat dibagi menjadi:

```text
Property Categories
├── common properties
│   ├── berlaku client/server
│   ├── auto-discovery
│   ├── provider discovery
│   └── runtime behavior umum
├── server properties
│   ├── resource scanning
│   ├── application name
│   ├── tracing/monitoring
│   ├── validation
│   └── request/response processing
├── client properties
│   ├── connect timeout
│   ├── read timeout
│   ├── connector provider
│   ├── proxy
│   ├── chunked encoding
│   └── redirect/cookie behavior
└── application-defined properties
    ├── feature flag
    ├── environment marker
    ├── API behavior setting
    ├── audit/masking policy
    └── integration endpoint config
```

Jersey menyediakan class seperti:

```java
org.glassfish.jersey.CommonProperties
org.glassfish.jersey.server.ServerProperties
org.glassfish.jersey.client.ClientProperties
```

Lebih aman memakai constant daripada string literal bila tersedia.

Contoh:

```java
import org.glassfish.jersey.CommonProperties;
import org.glassfish.jersey.server.ServerProperties;

public final class ApiResourceConfig extends ResourceConfig {
    public ApiResourceConfig() {
        property(CommonProperties.FEATURE_AUTO_DISCOVERY_DISABLE, true);
        property(ServerProperties.APPLICATION_NAME, "case-api");
    }
}
```

Namun dalam beberapa kasus lintas versi, constant bisa berpindah atau tidak tersedia. Untuk library internal yang mendukung beberapa major version Jersey, string key kadang perlu dibungkus dalam abstraction sendiri.

---

## 7. Prinsip Utama: Explicit Over Magical

### 7.1 Explicit Registration

Lebih baik:

```java
public final class ApiResourceConfig extends ResourceConfig {
    public ApiResourceConfig() {
        register(CaseResource.class);
        register(AppealResource.class);
        register(DocumentResource.class);

        register(ProblemExceptionMapper.class);
        register(ValidationExceptionMapper.class);
        register(SecurityExceptionMapper.class);

        register(CorrelationIdFilter.class);
        register(SecurityContextFilter.class);
        register(AuditFilter.class);

        register(JsonProviderFeature.class);
    }
}
```

Daripada:

```java
packages("com.company");
```

`packages("com.company")` terlihat praktis, tetapi risikonya:

- provider test ikut ter-scan,
- experimental resource aktif tanpa sengaja,
- classpath dependency menambahkan auto-feature,
- startup makin lambat,
- sulit memastikan apa yang benar-benar aktif.

### 7.2 Package Scanning Tetap Boleh, Tapi Batasi

Jika package scanning digunakan:

```java
packages(
    "com.company.caseapi.resources",
    "com.company.caseapi.providers"
);
```

Hindari:

```java
packages("com.company");
```

Apalagi:

```java
packages("com");
```

Rule sederhana:

```text
Scan only the package you would be comfortable listing in a security review.
```

### 7.3 Disable Auto-Discovery Bila Butuh Determinisme

Auto-discovery berguna untuk convenience, tetapi production platform sering lebih baik eksplisit.

Contoh:

```java
property(CommonProperties.FEATURE_AUTO_DISCOVERY_DISABLE, true);
```

Konsekuensi: semua feature yang dibutuhkan harus diregister manual.

Itu bukan kelemahan. Itu membuat runtime lebih mudah diaudit.

---

## 8. Configuration Layering: Dari Build Sampai Runtime

Konfigurasi yang baik biasanya berlapis.

```text
Layer 1 — Code defaults
  Nilai aman yang berlaku untuk semua environment.

Layer 2 — Environment config
  DEV/UAT/PROD-specific value.

Layer 3 — Secret source
  Credential/token/API key, tidak masuk repo.

Layer 4 — Runtime override
  Emergency toggle atau operational override yang terkendali.

Layer 5 — Request-level decision
  Feature behavior berdasarkan tenant, role, API version, atau header.
```

Yang berbahaya adalah ketika layer bercampur tanpa aturan.

Contoh buruk:

```java
String env = System.getenv("APP_ENV");
if ("prod".equals(env)) {
    register(ProdOnlySecurityFilter.class);
} else {
    register(DebugBypassFilter.class);
}
```

Masalah:

- security behavior dikendalikan string environment mentah,
- jika `APP_ENV` kosong, behavior mungkin jatuh ke non-prod,
- audit sulit,
- test bisa tidak menangkap.

Lebih baik:

```java
public enum RuntimeEnvironment {
    LOCAL,
    DEV,
    UAT,
    PROD;

    public boolean isProductionLike() {
        return this == UAT || this == PROD;
    }
}
```

Lalu validasi eksplisit:

```java
public final class AppSettings {
    private final RuntimeEnvironment environment;
    private final boolean debugErrorEnabled;
    private final boolean payloadLoggingEnabled;
    private final boolean auditEnabled;

    public AppSettings(
        RuntimeEnvironment environment,
        boolean debugErrorEnabled,
        boolean payloadLoggingEnabled,
        boolean auditEnabled
    ) {
        this.environment = Objects.requireNonNull(environment);
        this.debugErrorEnabled = debugErrorEnabled;
        this.payloadLoggingEnabled = payloadLoggingEnabled;
        this.auditEnabled = auditEnabled;

        validate();
    }

    private void validate() {
        if (environment == RuntimeEnvironment.PROD && debugErrorEnabled) {
            throw new IllegalStateException("Debug error must not be enabled in PROD");
        }
        if (environment == RuntimeEnvironment.PROD && payloadLoggingEnabled) {
            throw new IllegalStateException("Payload logging must not be enabled in PROD");
        }
        if (environment == RuntimeEnvironment.PROD && !auditEnabled) {
            throw new IllegalStateException("Audit must be enabled in PROD");
        }
    }

    public RuntimeEnvironment environment() {
        return environment;
    }

    public boolean debugErrorEnabled() {
        return debugErrorEnabled;
    }

    public boolean payloadLoggingEnabled() {
        return payloadLoggingEnabled;
    }

    public boolean auditEnabled() {
        return auditEnabled;
    }
}
```

Kemudian inject ke Jersey config:

```java
public final class ApiResourceConfig extends ResourceConfig {

    public ApiResourceConfig(AppSettings settings) {
        property("app.environment", settings.environment().name());
        property("app.debugError.enabled", settings.debugErrorEnabled());
        property("app.payloadLogging.enabled", settings.payloadLoggingEnabled());
        property("app.audit.enabled", settings.auditEnabled());

        register(new PlatformFeature(settings));
    }
}
```

---

## 9. Designing Application-Defined Properties

Jangan sembarangan membuat property key.

Buruk:

```java
property("enabled", true);
property("debug", false);
property("timeout", 1000);
```

Masalah:

- terlalu generik,
- konflik dengan library lain,
- tidak jelas domainnya,
- tidak jelas unit waktunya.

Lebih baik:

```java
property("com.company.caseapi.audit.enabled", true);
property("com.company.caseapi.error.debug-details-enabled", false);
property("com.company.caseapi.client.onemap.connect-timeout-ms", 1000);
property("com.company.caseapi.client.onemap.read-timeout-ms", 3000);
```

Lebih baik lagi: bungkus property key dalam constant.

```java
public final class CaseApiProperties {
    private CaseApiProperties() {}

    public static final String ENVIRONMENT =
        "com.company.caseapi.environment";

    public static final String AUDIT_ENABLED =
        "com.company.caseapi.audit.enabled";

    public static final String DEBUG_ERROR_DETAILS_ENABLED =
        "com.company.caseapi.error.debug-details-enabled";

    public static final String PAYLOAD_LOGGING_ENABLED =
        "com.company.caseapi.logging.payload-enabled";

    public static final String MAX_REQUEST_BODY_BYTES =
        "com.company.caseapi.http.max-request-body-bytes";
}
```

Kemudian:

```java
property(CaseApiProperties.AUDIT_ENABLED, true);
```

---

## 10. Typed Configuration: Jangan Biarkan Semua Jadi String

Environment variable selalu string, tetapi application config tidak harus string.

Buruk:

```java
String timeout = System.getenv("REMOTE_TIMEOUT");
client.property(ClientProperties.READ_TIMEOUT, timeout);
```

Masalah:

- unit tidak jelas,
- parsing bisa gagal terlambat,
- property mengharapkan integer tetapi diberi string,
- nilai negatif bisa lolos.

Lebih baik:

```java
public record HttpClientTimeouts(
    Duration connectTimeout,
    Duration readTimeout
) {
    public HttpClientTimeouts {
        Objects.requireNonNull(connectTimeout);
        Objects.requireNonNull(readTimeout);

        if (connectTimeout.isNegative() || connectTimeout.isZero()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (readTimeout.isNegative() || readTimeout.isZero()) {
            throw new IllegalArgumentException("readTimeout must be positive");
        }
        if (readTimeout.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException("readTimeout is too large");
        }
    }

    public int connectTimeoutMillis() {
        return Math.toIntExact(connectTimeout.toMillis());
    }

    public int readTimeoutMillis() {
        return Math.toIntExact(readTimeout.toMillis());
    }
}
```

Java 8 version tanpa `record`:

```java
public final class HttpClientTimeouts {
    private final Duration connectTimeout;
    private final Duration readTimeout;

    public HttpClientTimeouts(Duration connectTimeout, Duration readTimeout) {
        this.connectTimeout = Objects.requireNonNull(connectTimeout);
        this.readTimeout = Objects.requireNonNull(readTimeout);
        validate();
    }

    private void validate() {
        if (connectTimeout.isZero() || connectTimeout.isNegative()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (readTimeout.isZero() || readTimeout.isNegative()) {
            throw new IllegalArgumentException("readTimeout must be positive");
        }
    }

    public int connectTimeoutMillis() {
        return Math.toIntExact(connectTimeout.toMillis());
    }

    public int readTimeoutMillis() {
        return Math.toIntExact(readTimeout.toMillis());
    }
}
```

Kemudian dipakai di Jersey Client:

```java
ClientConfig clientConfig = new ClientConfig()
    .property(ClientProperties.CONNECT_TIMEOUT, timeouts.connectTimeoutMillis())
    .property(ClientProperties.READ_TIMEOUT, timeouts.readTimeoutMillis())
    .register(JacksonFeature.class)
    .register(CorrelationPropagationFilter.class);

Client client = ClientBuilder.newClient(clientConfig);
```

---

## 11. Server-Side Configuration Pattern

Contoh `ResourceConfig` production-oriented:

```java
@ApplicationPath("/api")
public final class CaseApiResourceConfig extends ResourceConfig {

    public CaseApiResourceConfig(AppSettings settings) {
        configureJerseyRuntime(settings);
        configureResources();
        configureProviders();
        configureFilters(settings);
        configureFeatures(settings);
        configureInjection(settings);
        validateRuntime(settings);
    }

    private void configureJerseyRuntime(AppSettings settings) {
        property(ServerProperties.APPLICATION_NAME, "case-api");
        property(CommonProperties.FEATURE_AUTO_DISCOVERY_DISABLE, true);

        property(CaseApiProperties.ENVIRONMENT, settings.environment().name());
        property(CaseApiProperties.AUDIT_ENABLED, settings.auditEnabled());
        property(CaseApiProperties.DEBUG_ERROR_DETAILS_ENABLED, settings.debugErrorEnabled());
    }

    private void configureResources() {
        register(CaseResource.class);
        register(AppealResource.class);
        register(DocumentResource.class);
        register(HealthResource.class);
    }

    private void configureProviders() {
        register(JsonProviderFeature.class);
        register(ProblemExceptionMapper.class);
        register(ValidationExceptionMapper.class);
        register(SecurityExceptionMapper.class);
        register(FallbackExceptionMapper.class);
    }

    private void configureFilters(AppSettings settings) {
        register(CorrelationIdFilter.class);
        register(SecurityContextFilter.class);

        if (settings.auditEnabled()) {
            register(AuditFilter.class);
        }

        if (settings.payloadLoggingEnabled()) {
            register(MaskedPayloadLoggingFeature.class);
        }
    }

    private void configureFeatures(AppSettings settings) {
        register(new PlatformFeature(settings));
    }

    private void configureInjection(AppSettings settings) {
        register(new AbstractBinder() {
            @Override
            protected void configure() {
                bind(settings).to(AppSettings.class);
            }
        });
    }

    private void validateRuntime(AppSettings settings) {
        RuntimeConfigurationValidator.validate(settings, this);
    }
}
```

Prinsip yang terlihat:

- runtime property dipusatkan,
- resource eksplisit,
- provider eksplisit,
- feature conditional berdasarkan typed settings,
- object konfigurasi dibind agar bisa diinjeksi,
- validasi startup dilakukan sebelum aplikasi menerima traffic.

---

## 12. Client-Side Configuration Pattern

Jersey Client sering menjadi sumber incident karena config timeout tidak eksplisit.

Contoh factory:

```java
public final class JerseyClientFactory {

    public Client createExternalClient(
        String clientName,
        HttpClientTimeouts timeouts,
        ObjectMapper objectMapper
    ) {
        ClientConfig config = new ClientConfig();

        config.property(ClientProperties.CONNECT_TIMEOUT, timeouts.connectTimeoutMillis());
        config.property(ClientProperties.READ_TIMEOUT, timeouts.readTimeoutMillis());
        config.property("com.company.client.name", clientName);

        config.register(new JacksonJsonProvider(objectMapper));
        config.register(CorrelationPropagationFilter.class);
        config.register(OutboundMetricsFilter.class);
        config.register(OutboundErrorMappingFilter.class);

        return ClientBuilder.newClient(config);
    }
}
```

Lebih matang lagi:

```java
public final class ExternalServiceClientConfig {
    private final String name;
    private final URI baseUri;
    private final HttpClientTimeouts timeouts;
    private final int maxRetries;
    private final Duration retryBackoff;

    public ExternalServiceClientConfig(
        String name,
        URI baseUri,
        HttpClientTimeouts timeouts,
        int maxRetries,
        Duration retryBackoff
    ) {
        this.name = requireText(name, "name");
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
        this.timeouts = Objects.requireNonNull(timeouts, "timeouts");
        this.maxRetries = maxRetries;
        this.retryBackoff = Objects.requireNonNull(retryBackoff, "retryBackoff");
        validate();
    }

    private void validate() {
        if (!"https".equalsIgnoreCase(baseUri.getScheme())) {
            throw new IllegalArgumentException("External service baseUri must use HTTPS");
        }
        if (maxRetries < 0 || maxRetries > 3) {
            throw new IllegalArgumentException("maxRetries must be between 0 and 3");
        }
        if (retryBackoff.isNegative()) {
            throw new IllegalArgumentException("retryBackoff must not be negative");
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    public String name() { return name; }
    public URI baseUri() { return baseUri; }
    public HttpClientTimeouts timeouts() { return timeouts; }
    public int maxRetries() { return maxRetries; }
    public Duration retryBackoff() { return retryBackoff; }
}
```

Manfaat:

- base URI divalidasi,
- timeout tidak implicit,
- retry dibatasi,
- client name bisa dipakai untuk metrics/logging,
- konfigurasi bisa diuji tanpa menjalankan Jersey.

---

## 13. Configuration Scope: Application vs Resource vs Client vs Request

Jersey config bisa berlaku di beberapa level.

```text
Application-level
  ResourceConfig property/register.

Feature-level
  Feature membaca config dan mendaftarkan komponen.

Resource/method-level
  DynamicFeature mengikat filter/interceptor ke method tertentu.

Client-level
  ClientConfig berlaku untuk seluruh Client.

Target-level
  WebTarget property berlaku untuk target tertentu.

Invocation-level
  Property/filter behavior spesifik per request.
```

Contoh client-level:

```java
Client client = ClientBuilder.newClient(
    new ClientConfig()
        .property(ClientProperties.CONNECT_TIMEOUT, 1000)
        .property(ClientProperties.READ_TIMEOUT, 3000)
);
```

Contoh target-level:

```java
WebTarget target = client
    .target(baseUri)
    .property("com.company.remote-service", "onemap");
```

Contoh invocation-level:

```java
Response response = target
    .path("/search")
    .request()
    .property("com.company.audit.operation", "POSTAL_CODE_SEARCH")
    .get();
```

Gunakan scope paling sempit yang masuk akal.

Rule:

```text
If a value applies to all requests, put it on Client/Application.
If it applies to one remote service, put it on WebTarget/client wrapper.
If it applies to one call, put it on Invocation.
```

---

## 14. Feature Flag di Jersey

Feature flag dapat mengubah API behavior. Ini sangat kuat sekaligus berbahaya.

### 14.1 Jenis Feature Flag

```text
Feature Flag Types
├── release flag
│   └── enable new code path gradually
├── ops flag
│   └── disable expensive/non-critical behavior during incident
├── permission flag
│   └── enable feature for certain tenant/user/role
├── experiment flag
│   └── compare behavior, rarely ideal for regulated API
└── migration flag
    └── switch old/new integration during migration
```

### 14.2 Apa yang Boleh Di-flag

Relatif aman:

- provider tambahan non-critical,
- observability verbosity,
- outbound integration path,
- optional validation warning,
- new response field yang backward compatible,
- new resource yang belum dipublikasikan.

Berisiko:

- authorization behavior,
- audit behavior,
- validation invariant,
- error semantics,
- transaction behavior,
- data visibility,
- idempotency behavior.

Untuk sistem regulatory/case management, flag untuk authorization/audit harus diperlakukan seperti change request formal.

### 14.3 Pattern Feature Flag di `Feature`

```java
public final class AuditFeature implements Feature {

    private final AppSettings settings;

    public AuditFeature(AppSettings settings) {
        this.settings = Objects.requireNonNull(settings);
    }

    @Override
    public boolean configure(FeatureContext context) {
        if (!settings.auditEnabled()) {
            if (settings.environment() == RuntimeEnvironment.PROD) {
                throw new IllegalStateException("Audit cannot be disabled in PROD");
            }
            return false;
        }

        context.register(AuditRequestFilter.class);
        context.register(AuditResponseFilter.class);
        return true;
    }
}
```

`return false` berarti feature tidak diaktifkan. Namun jangan mengandalkan return value sebagai audit utama. Log/metrics startup tetap perlu.

---

## 15. Conditional Resource Registration

Kadang endpoint baru hanya aktif untuk environment tertentu.

Contoh:

```java
private void configureResources(AppSettings settings) {
    register(CaseResource.class);
    register(DocumentResource.class);

    if (settings.newBulkApiEnabled()) {
        register(BulkCaseResource.class);
    }
}
```

Risiko:

- OpenAPI docs berbeda antar environment,
- test tidak mencakup semua kombinasi flag,
- client menerima 404 di environment tertentu,
- authorization matrix berbeda.

Pattern yang lebih aman:

```java
@Path("/cases/bulk")
public final class BulkCaseResource {

    private final FeatureFlagService flags;

    public BulkCaseResource(FeatureFlagService flags) {
        this.flags = flags;
    }

    @POST
    public Response submit(BulkCaseRequest request) {
        if (!flags.isEnabled("bulk-case-submit")) {
            throw new FeatureDisabledException("bulk-case-submit");
        }

        // process request
        return Response.accepted().build();
    }
}
```

Trade-off:

```text
Conditional registration
  + endpoint benar-benar tidak ada
  + attack surface lebih kecil
  - docs/test/env drift lebih besar

Runtime feature check
  + API surface stabil
  + easier docs
  - endpoint terlihat tapi dapat mengembalikan 404/403/409/503 tergantung policy
```

Untuk public API, API surface stabil biasanya lebih mudah dikelola.

---

## 16. DynamicFeature untuk Method-Level Configuration

`DynamicFeature` dipakai untuk mengikat filter/interceptor berdasarkan resource method.

Contoh annotation:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface AuditedOperation {
    String value();
}
```

Resource:

```java
@Path("/cases")
public final class CaseResource {

    @POST
    @AuditedOperation("CASE_CREATE")
    public Response create(CreateCaseRequest request) {
        return Response.status(Response.Status.CREATED).build();
    }
}
```

Dynamic feature:

```java
public final class AuditDynamicFeature implements DynamicFeature {

    @Override
    public void configure(ResourceInfo resourceInfo, FeatureContext context) {
        AuditedOperation methodAnnotation = resourceInfo
            .getResourceMethod()
            .getAnnotation(AuditedOperation.class);

        AuditedOperation classAnnotation = resourceInfo
            .getResourceClass()
            .getAnnotation(AuditedOperation.class);

        AuditedOperation annotation = methodAnnotation != null
            ? methodAnnotation
            : classAnnotation;

        if (annotation != null) {
            context.register(new OperationAuditFilter(annotation.value()));
        }
    }
}
```

Filter:

```java
public final class OperationAuditFilter implements ContainerRequestFilter {

    private final String operation;

    public OperationAuditFilter(String operation) {
        this.operation = operation;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty("com.company.audit.operation", operation);
    }
}
```

Ini adalah konfigurasi method-level yang lebih eksplisit dibanding membaca path string secara manual.

---

## 17. Environment Profiles: DEV, UAT, PROD

Environment profile seharusnya tidak hanya label. Ia menentukan guardrail.

```text
LOCAL
  boleh verbose debug
  boleh mock dependency
  boleh payload sample terbatas

DEV
  boleh eksperimen terbatas
  audit bisa aktif ringan
  error detail boleh lebih banyak, tetapi tetap tanpa secret/PII

UAT
  production-like
  audit aktif
  security aktif
  timeout realistic
  no debug bypass

PROD
  fail closed
  audit wajib
  no debug detail
  no raw payload logging
  strict timeout
  strict TLS
  startup validation mandatory
```

Contoh validator:

```java
public final class RuntimeConfigurationValidator {

    public static void validate(AppSettings settings, ResourceConfig config) {
        validateEnvironment(settings);
        validateSecurity(settings);
        validateObservability(settings);
        validateClientTimeouts(settings);
        validateRequiredProviders(config);
    }

    private static void validateEnvironment(AppSettings settings) {
        if (settings.environment() == null) {
            throw new IllegalStateException("Runtime environment must be configured");
        }
    }

    private static void validateSecurity(AppSettings settings) {
        if (settings.environment() == RuntimeEnvironment.PROD && !settings.securityEnabled()) {
            throw new IllegalStateException("Security must be enabled in PROD");
        }
    }

    private static void validateObservability(AppSettings settings) {
        if (settings.environment() == RuntimeEnvironment.PROD && !settings.correlationIdEnabled()) {
            throw new IllegalStateException("Correlation ID must be enabled in PROD");
        }
    }

    private static void validateClientTimeouts(AppSettings settings) {
        for (ExternalServiceClientConfig client : settings.externalClients()) {
            if (client.timeouts().readTimeout().compareTo(Duration.ofSeconds(30)) > 0) {
                throw new IllegalStateException(
                    "Read timeout too high for client " + client.name()
                );
            }
        }
    }

    private static void validateRequiredProviders(ResourceConfig config) {
        Set<Class<?>> classes = config.getClasses();
        if (!classes.contains(ProblemExceptionMapper.class)) {
            throw new IllegalStateException("ProblemExceptionMapper must be registered");
        }
    }
}
```

Catatan: tergantung cara register instance/class, `getClasses()` saja belum tentu cukup. Untuk validasi serius, buat registry internal milik platform config sendiri.

---

## 18. Sensitive Configuration

Sensitive config meliputi:

- API key,
- client secret,
- private key,
- database credential,
- token endpoint credential,
- mTLS key material,
- signing/encryption secret,
- SMTP password,
- proxy credential.

Prinsip:

```text
Sensitive config must be injected, validated, used, and never logged.
```

### 18.1 Jangan Simpan Secret Sebagai Jersey Property Bila Tidak Perlu

Buruk:

```java
property("com.company.remote.client-secret", System.getenv("CLIENT_SECRET"));
```

Masalah:

- bisa muncul di diagnostic dump,
- bisa terbaca provider lain,
- bisa kelog saat config printed.

Lebih baik inject object khusus:

```java
public final class ExternalServiceCredential {
    private final String clientId;
    private final char[] clientSecret;

    public ExternalServiceCredential(String clientId, char[] clientSecret) {
        this.clientId = requireText(clientId, "clientId");
        this.clientSecret = Objects.requireNonNull(clientSecret, "clientSecret");
        if (clientSecret.length == 0) {
            throw new IllegalArgumentException("clientSecret must not be empty");
        }
    }

    public String clientId() {
        return clientId;
    }

    public char[] copyClientSecret() {
        return Arrays.copyOf(clientSecret, clientSecret.length);
    }

    @Override
    public String toString() {
        return "ExternalServiceCredential{clientId='" + clientId + "', clientSecret='***'}";
    }

    private static String requireText(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
```

Bind object ke DI container:

```java
register(new AbstractBinder() {
    @Override
    protected void configure() {
        bind(credential).to(ExternalServiceCredential.class);
    }
});
```

### 18.2 Jangan Log Full Configuration

Buruk:

```java
log.info("Settings: {}", settings);
```

Lebih baik:

```java
log.info(
    "Runtime config loaded: env={}, auditEnabled={}, payloadLoggingEnabled={}, clients={}",
    settings.environment(),
    settings.auditEnabled(),
    settings.payloadLoggingEnabled(),
    settings.externalClientNames()
);
```

---

## 19. Configuration Drift Detection

Drift adalah kondisi ketika environment berbeda tanpa disadari.

Contoh:

```text
DEV
  auto-discovery enabled
  Jackson provider v2.17
  payload logging enabled
  timeout 10s

PROD
  auto-discovery disabled
  JSON-B provider selected
  payload logging disabled
  timeout unset
```

Aplikasi bisa lolos test di DEV tetapi gagal di PROD.

### 19.1 Generate Runtime Configuration Summary

Buat summary yang aman:

```java
public final class RuntimeConfigSummary {
    private final String applicationName;
    private final String environment;
    private final boolean autoDiscoveryDisabled;
    private final List<String> registeredResources;
    private final List<String> registeredProviders;
    private final List<String> enabledPlatformFeatures;

    // constructor/getters omitted
}
```

Expose di internal actuator/admin endpoint yang aman:

```java
@Path("/internal/runtime-config")
public final class RuntimeConfigResource {

    private final RuntimeConfigSummary summary;

    public RuntimeConfigResource(RuntimeConfigSummary summary) {
        this.summary = summary;
    }

    @GET
    public RuntimeConfigSummary get() {
        return summary;
    }
}
```

Catatan: endpoint ini harus dilindungi ketat atau hanya aktif internal.

### 19.2 Config Fingerprint

Untuk membandingkan antar environment, buat fingerprint dari config non-secret.

```java
public final class ConfigFingerprint {

    public static String sha256Of(Map<String, Object> safeConfig) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String canonical = safeConfig.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(e -> e.getKey() + "=" + String.valueOf(e.getValue()))
                .collect(Collectors.joining("\n"));

            byte[] hash = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
            return toHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            builder.append(String.format("%02x", b));
        }
        return builder.toString();
    }
}
```

Manfaat:

- bisa dibandingkan saat deployment,
- membantu incident investigation,
- tidak perlu membocorkan detail config.

---

## 20. Startup Validation: Fail Fast, Not Fail at First Request

Kesalahan konfigurasi harus ditemukan saat startup, bukan saat traffic pertama.

Validasi minimal:

```text
Startup Validation Checklist
├── environment known
├── application name set
├── required resources registered
├── required exception mapper registered
├── JSON provider selected explicitly
├── security filter enabled in production-like env
├── audit enabled in production
├── outbound client base URI valid
├── outbound client timeout valid
├── secret present but not logged
├── feature flag combination valid
├── no debug endpoint in production
├── no payload raw logging in production
└── no javax/jakarta dependency mismatch
```

Contoh fail-fast:

```java
public final class StartupValidatorFeature implements Feature {

    private final AppSettings settings;

    public StartupValidatorFeature(AppSettings settings) {
        this.settings = Objects.requireNonNull(settings);
    }

    @Override
    public boolean configure(FeatureContext context) {
        if (settings.environment() == RuntimeEnvironment.PROD
            && settings.debugErrorEnabled()) {
            throw new IllegalStateException("Invalid production config: debug error enabled");
        }

        if (settings.externalClients().isEmpty()) {
            throw new IllegalStateException("At least one external client must be configured");
        }

        return true;
    }
}
```

Register:

```java
register(new StartupValidatorFeature(settings));
```

---

## 21. Auto-Discovery, ServiceLoader, and Classpath Surprises

Jersey dapat menemukan beberapa feature/provider melalui mekanisme auto-discovery/service loading.

Ini nyaman, tetapi ada efek samping:

- dependency baru bisa mengubah runtime behavior,
- JSON provider yang berbeda bisa terpilih,
- monitoring/tracing feature bisa aktif tanpa sadar,
- startup scan cost meningkat,
- perbedaan classpath antar environment memunculkan behavior berbeda.

### 21.1 Production Strategy

Untuk aplikasi enterprise:

```text
Recommended:
  Disable broad auto-discovery where determinism matters.
  Register required features explicitly.
  Keep dependency graph minimal.
  Generate runtime summary of selected providers.
```

Contoh:

```java
property(CommonProperties.FEATURE_AUTO_DISCOVERY_DISABLE, true);
```

Jika butuh service lookup disable tertentu, gunakan property Jersey yang sesuai untuk versi yang dipakai. Pastikan dicek terhadap dokumentasi versi Jersey target karena nama constant dan dukungan bisa berbeda antar major version.

---

## 22. Config untuk JSON Provider

Part 7 sudah membahas JSON detail. Di sini fokusnya configuration engineering.

Jangan biarkan JSON provider dipilih secara kebetulan.

Buruk:

```java
// relying on whichever JSON provider exists on classpath
```

Lebih baik:

```java
public final class JsonProviderFeature implements Feature {

    private final ObjectMapper objectMapper;

    public JsonProviderFeature(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper);
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(new JacksonJsonProvider(objectMapper));
        return true;
    }
}
```

ObjectMapper config sebaiknya juga typed dan explicit:

```java
public final class ObjectMapperFactory {

    public ObjectMapper create(ApiJsonSettings settings) {
        ObjectMapper mapper = new ObjectMapper();

        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
            settings.failOnUnknownProperties());
        mapper.setSerializationInclusion(JsonInclude.Include.NON_NULL);

        return mapper;
    }
}
```

`failOnUnknownProperties` adalah API compatibility decision, bukan sekadar Jackson setting.

---

## 23. Config untuk Exception Mapping

Error behavior harus beda antara local/dev dan prod, tetapi contract tidak boleh berubah liar.

Contoh settings:

```java
public final class ErrorSettings {
    private final boolean includeDebugId;
    private final boolean includeExceptionClass;
    private final boolean includeStackTrace;

    public ErrorSettings(
        boolean includeDebugId,
        boolean includeExceptionClass,
        boolean includeStackTrace,
        RuntimeEnvironment environment
    ) {
        this.includeDebugId = includeDebugId;
        this.includeExceptionClass = includeExceptionClass;
        this.includeStackTrace = includeStackTrace;

        if (environment == RuntimeEnvironment.PROD && includeStackTrace) {
            throw new IllegalArgumentException("Stack trace must not be included in PROD error response");
        }
        if (environment == RuntimeEnvironment.PROD && includeExceptionClass) {
            throw new IllegalArgumentException("Exception class must not be included in PROD error response");
        }
    }

    public boolean includeDebugId() { return includeDebugId; }
    public boolean includeExceptionClass() { return includeExceptionClass; }
    public boolean includeStackTrace() { return includeStackTrace; }
}
```

Mapper:

```java
@Provider
public final class FallbackExceptionMapper implements ExceptionMapper<Throwable> {

    private final ErrorSettings settings;

    public FallbackExceptionMapper(ErrorSettings settings) {
        this.settings = settings;
    }

    @Override
    public Response toResponse(Throwable exception) {
        ProblemResponse problem = ProblemResponse.internalServerError();

        if (settings.includeDebugId()) {
            problem = problem.withDebugId(UUID.randomUUID().toString());
        }

        return Response
            .status(Response.Status.INTERNAL_SERVER_ERROR)
            .type("application/problem+json")
            .entity(problem)
            .build();
    }
}
```

---

## 24. Config untuk Logging dan Payload Masking

Payload logging harus default-off, terutama untuk production.

Configuration model:

```java
public final class PayloadLoggingSettings {
    private final boolean enabled;
    private final int maxBytes;
    private final Set<String> maskedFields;

    public PayloadLoggingSettings(boolean enabled, int maxBytes, Set<String> maskedFields) {
        this.enabled = enabled;
        this.maxBytes = maxBytes;
        this.maskedFields = Set.copyOf(maskedFields);

        if (enabled && maxBytes <= 0) {
            throw new IllegalArgumentException("maxBytes must be positive when payload logging enabled");
        }
        if (maxBytes > 16 * 1024) {
            throw new IllegalArgumentException("Payload logging maxBytes too high");
        }
    }

    public boolean enabled() { return enabled; }
    public int maxBytes() { return maxBytes; }
    public Set<String> maskedFields() { return maskedFields; }
}
```

Feature:

```java
public final class MaskedPayloadLoggingFeature implements Feature {

    private final PayloadLoggingSettings settings;

    public MaskedPayloadLoggingFeature(PayloadLoggingSettings settings) {
        this.settings = settings;
    }

    @Override
    public boolean configure(FeatureContext context) {
        if (!settings.enabled()) {
            return false;
        }
        context.register(new MaskedPayloadLoggingFilter(settings));
        return true;
    }
}
```

Rule:

```text
Never let raw payload logging be enabled by dependency default.
Never allow payload logging in production without explicit risk acceptance.
Never log full body just because troubleshooting is hard.
```

---

## 25. Config untuk Observability

Observability config harus menjawab:

- apakah correlation ID wajib,
- header apa yang dipakai,
- apakah trace propagation aktif,
- apakah metrics aktif,
- label/tag apa yang boleh,
- apakah payload size dicatat,
- apakah error code dicatat,
- cardinality guardrail.

Contoh:

```java
public final class ObservabilitySettings {
    private final boolean correlationEnabled;
    private final String correlationHeaderName;
    private final boolean metricsEnabled;
    private final boolean tracingEnabled;

    public ObservabilitySettings(
        boolean correlationEnabled,
        String correlationHeaderName,
        boolean metricsEnabled,
        boolean tracingEnabled
    ) {
        this.correlationEnabled = correlationEnabled;
        this.correlationHeaderName = requireText(correlationHeaderName, "correlationHeaderName");
        this.metricsEnabled = metricsEnabled;
        this.tracingEnabled = tracingEnabled;
    }

    public boolean correlationEnabled() { return correlationEnabled; }
    public String correlationHeaderName() { return correlationHeaderName; }
    public boolean metricsEnabled() { return metricsEnabled; }
    public boolean tracingEnabled() { return tracingEnabled; }

    private static String requireText(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
```

Register:

```java
if (observability.correlationEnabled()) {
    register(new CorrelationIdFilter(observability.correlationHeaderName()));
}
if (observability.metricsEnabled()) {
    register(MetricsFilter.class);
}
if (observability.tracingEnabled()) {
    register(TracingFeature.class);
}
```

---

## 26. Config untuk Security

Security config harus fail-closed.

Buruk:

```java
boolean securityEnabled = Boolean.parseBoolean(System.getenv("SECURITY_ENABLED"));
if (securityEnabled) {
    register(SecurityFilter.class);
}
```

Jika env var hilang, `Boolean.parseBoolean(null)` menghasilkan `false`.

Lebih baik:

```java
public final class SecuritySettings {
    private final boolean enabled;
    private final URI issuer;
    private final String audience;
    private final Duration jwksCacheTtl;

    public SecuritySettings(
        boolean enabled,
        URI issuer,
        String audience,
        Duration jwksCacheTtl,
        RuntimeEnvironment environment
    ) {
        this.enabled = enabled;
        this.issuer = issuer;
        this.audience = audience;
        this.jwksCacheTtl = jwksCacheTtl;

        if (environment.isProductionLike() && !enabled) {
            throw new IllegalArgumentException("Security must be enabled in production-like environment");
        }
        if (enabled) {
            Objects.requireNonNull(issuer, "issuer");
            requireText(audience, "audience");
            Objects.requireNonNull(jwksCacheTtl, "jwksCacheTtl");
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
```

---

## 27. Config untuk Multipart dan Large Payload

Large payload harus dikendalikan oleh config.

Settings:

```java
public final class PayloadLimitSettings {
    private final long maxJsonBodyBytes;
    private final long maxMultipartBytes;
    private final Path uploadTempDirectory;

    public PayloadLimitSettings(
        long maxJsonBodyBytes,
        long maxMultipartBytes,
        Path uploadTempDirectory
    ) {
        this.maxJsonBodyBytes = maxJsonBodyBytes;
        this.maxMultipartBytes = maxMultipartBytes;
        this.uploadTempDirectory = Objects.requireNonNull(uploadTempDirectory);

        if (maxJsonBodyBytes <= 0 || maxJsonBodyBytes > 10 * 1024 * 1024) {
            throw new IllegalArgumentException("Invalid maxJsonBodyBytes");
        }
        if (maxMultipartBytes <= 0 || maxMultipartBytes > 200L * 1024 * 1024) {
            throw new IllegalArgumentException("Invalid maxMultipartBytes");
        }
    }
}
```

Filter dapat membaca config ini untuk reject request sebelum body diproses penuh.

```java
@Priority(Priorities.ENTITY_CODER)
public final class ContentLengthLimitFilter implements ContainerRequestFilter {

    private final PayloadLimitSettings settings;

    public ContentLengthLimitFilter(PayloadLimitSettings settings) {
        this.settings = settings;
    }

    @Override
    public void filter(ContainerRequestContext context) {
        String contentLengthHeader = context.getHeaderString(HttpHeaders.CONTENT_LENGTH);
        if (contentLengthHeader == null) {
            return;
        }

        long contentLength;
        try {
            contentLength = Long.parseLong(contentLengthHeader);
        } catch (NumberFormatException e) {
            throw new BadRequestException("Invalid Content-Length");
        }

        MediaType mediaType = context.getMediaType();
        long limit = isMultipart(mediaType)
            ? settings.maxMultipartBytes()
            : settings.maxJsonBodyBytes();

        if (contentLength > limit) {
            throw new PayloadTooLargeException("Request body too large");
        }
    }

    private boolean isMultipart(MediaType mediaType) {
        return mediaType != null && "multipart".equalsIgnoreCase(mediaType.getType());
    }
}
```

---

## 28. Config dan Java 8–25

### 28.1 Java 8

Keterbatasan:

- tidak ada `record`,
- tidak ada modern immutable collection factory seperti `Set.of`,
- dependency modern mungkin tidak support Java 8,
- Jersey 2.x masih relevan untuk `javax.ws.rs`.

Pattern:

- gunakan final class immutable manual,
- validasi constructor,
- gunakan `Collections.unmodifiableList/Set`,
- hati-hati dependency version.

### 28.2 Java 11

Peningkatan:

- runtime lebih modern,
- TLS/HTTP stack lebih baru,
- `var` untuk local variable tetapi jangan mengorbankan readability.

### 28.3 Java 17

Penting karena banyak Jakarta EE modern bergerak ke baseline Java 17.

Gunakan:

- records untuk typed config,
- sealed class untuk config source result bila perlu,
- switch expression untuk env handling.

Contoh:

```java
public record ApiSettings(
    RuntimeEnvironment environment,
    SecuritySettings security,
    ObservabilitySettings observability,
    ErrorSettings error
) {
    public ApiSettings {
        Objects.requireNonNull(environment);
        Objects.requireNonNull(security);
        Objects.requireNonNull(observability);
        Objects.requireNonNull(error);
    }
}
```

### 28.4 Java 21/25

Pertimbangan:

- virtual threads bukan pengganti timeout/config yang benar,
- structured concurrency dapat membantu bootstrap external checks, tetapi jangan membuat startup terlalu lambat,
- modern TLS/security baseline harus divalidasi,
- config object immutable makin penting karena concurrency model makin fleksibel.

---

## 29. Configuration in Spring Boot + Jersey

Dalam Spring Boot, Jersey biasanya dikonfigurasi via `ResourceConfig` bean.

Contoh:

```java
@Configuration
public class JerseyConfiguration {

    @Bean
    ResourceConfig resourceConfig(AppSettings settings) {
        return new CaseApiResourceConfig(settings);
    }
}
```

Spring Boot juga memiliki property sendiri untuk Jersey integration. Namun jangan campur aduk ownership:

```text
Spring owns application settings.
Jersey owns JAX-RS runtime registration.
```

Pattern sehat:

```java
@ConfigurationProperties(prefix = "case-api")
public class CaseApiPropertiesFromSpring {
    private String environment;
    private boolean auditEnabled;
    private boolean payloadLoggingEnabled;

    // getters/setters

    public AppSettings toAppSettings() {
        return new AppSettings(
            RuntimeEnvironment.valueOf(environment),
            auditEnabled,
            payloadLoggingEnabled
        );
    }
}
```

Kemudian:

```java
@Bean
AppSettings appSettings(CaseApiPropertiesFromSpring properties) {
    return properties.toAppSettings();
}
```

Jangan membuat Jersey filter membaca Spring `Environment` secara langsung di banyak tempat. Itu menyebarkan config access dan membuat test sulit.

---

## 30. Configuration in Jakarta EE / CDI / MicroProfile

Dalam Jakarta EE/MicroProfile environment, config sering datang dari MicroProfile Config.

Pattern konseptual:

```java
@ApplicationScoped
public class SettingsProducer {

    @Inject
    @ConfigProperty(name = "case-api.environment")
    String environment;

    @Inject
    @ConfigProperty(name = "case-api.audit.enabled")
    boolean auditEnabled;

    @Produces
    @ApplicationScoped
    public AppSettings appSettings() {
        return new AppSettings(
            RuntimeEnvironment.valueOf(environment),
            auditEnabled,
            false
        );
    }
}
```

Lalu Jersey resource/provider/filter mendapatkan `AppSettings` dari CDI integration jika ownership sudah jelas.

Prinsip tetap sama:

- parse once,
- validate once,
- inject typed object,
- avoid raw config lookup everywhere.

---

## 31. Kubernetes Configuration Pattern

Di Kubernetes, config biasanya datang dari:

- ConfigMap,
- Secret,
- downward API,
- mounted file,
- external secret operator,
- cloud secret manager sync,
- env var.

Jangan langsung menganggap ConfigMap aman. ConfigMap bukan secret.

Pattern:

```text
ConfigMap
  non-sensitive config:
    environment
    feature flags
    timeouts
    base URL without credential
    log level

Secret / secret manager
  sensitive config:
    API key
    client secret
    private key
    password
```

Startup harus gagal bila required config tidak ada.

Readiness sebaiknya tidak `UP` jika critical config invalid.

Namun jangan melakukan remote dependency call berat di startup hanya untuk config kecuali memang perlu. Startup validation harus menyeimbangkan fail-fast dan deployment reliability.

---

## 32. Runtime Flags vs Build-Time Flags

Ada dua jenis keputusan:

```text
Build-time decision
  Dependency/module apa yang masuk artifact.

Runtime decision
  Feature apa yang aktif saat proses berjalan.
```

Contoh build-time:

- memilih Jersey 2 vs 3 vs 4,
- memilih Jackson provider vs JSON-B provider,
- include multipart module,
- include OpenTelemetry agent/library,
- include Spring integration.

Contoh runtime:

- audit enabled,
- payload logging enabled,
- new endpoint enabled,
- retry count,
- timeout,
- outbound base URI.

Jangan menjadikan semua build-time decision sebagai runtime flag. Itu meningkatkan kombinasi test secara drastis.

Rule:

```text
If a decision changes classpath, namespace, provider family, or security model, prefer build-time explicitness.
If a decision changes operational threshold or rollout behavior, runtime flag may be acceptable.
```

---

## 33. Avoiding Configuration Combinatorial Explosion

Feature flags menciptakan kombinasi.

Jika ada 10 boolean flag:

```text
2^10 = 1024 combinations
```

Tidak mungkin semua diuji manual.

Gunakan strategi:

```text
1. Kurangi jumlah flag.
2. Buat flag lifecycle: planned -> active -> deprecated -> removed.
3. Kelompokkan flag ke capability object.
4. Validasi kombinasi ilegal saat startup.
5. Test kombinasi high-risk saja.
6. Jangan biarkan temporary flag hidup bertahun-tahun.
```

Contoh validasi kombinasi:

```java
if (settings.newErrorContractEnabled() && !settings.problemJsonEnabled()) {
    throw new IllegalStateException(
        "newErrorContract requires problemJsonEnabled"
    );
}

if (settings.legacyAuthModeEnabled() && settings.oidcAuthModeEnabled()) {
    throw new IllegalStateException(
        "legacyAuthMode and oidcAuthMode are mutually exclusive"
    );
}
```

---

## 34. Configuration Testing

Configuration harus punya test sendiri.

### 34.1 Test Settings Parsing

```java
class AppSettingsTest {

    @Test
    void rejectsDebugErrorInProd() {
        assertThrows(IllegalStateException.class, () ->
            new AppSettings(
                RuntimeEnvironment.PROD,
                true,
                false,
                true
            )
        );
    }
}
```

### 34.2 Test ResourceConfig Registration

```java
class CaseApiResourceConfigTest {

    @Test
    void registersRequiredProviders() {
        AppSettings settings = TestSettings.productionLike();
        ResourceConfig config = new CaseApiResourceConfig(settings);

        assertTrue(config.getClasses().contains(ProblemExceptionMapper.class));
        assertTrue(config.getClasses().contains(CorrelationIdFilter.class));
    }
}
```

Catatan: jika banyak instance registration, cek `getInstances()` juga.

```java
assertTrue(
    config.getInstances().stream()
        .anyMatch(instance -> instance instanceof PlatformFeature)
);
```

### 34.3 Test Illegal Flag Combination

```java
@Test
void rejectsLegacyAndOidcAuthEnabledTogether() {
    assertThrows(IllegalStateException.class, () ->
        new SecurityModeSettings(true, true)
    );
}
```

### 34.4 Test Client Config

```java
@Test
void clientHasTimeouts() {
    HttpClientTimeouts timeouts = new HttpClientTimeouts(
        Duration.ofMillis(500),
        Duration.ofSeconds(2)
    );

    Client client = factory.createExternalClient(
        "test-service",
        timeouts,
        objectMapper
    );

    Object connectTimeout = client.getConfiguration()
        .getProperty(ClientProperties.CONNECT_TIMEOUT);

    assertEquals(500, connectTimeout);
}
```

---

## 35. Common Failure Modes

### 35.1 Provider Tidak Aktif Karena Auto-Discovery Dimatikan

Gejala:

```text
MessageBodyWriter not found for media type application/json
```

Penyebab:

- auto-discovery disabled,
- JSON provider tidak diregister manual,
- dependency JSON provider tidak ada.

Perbaikan:

```java
register(new JacksonJsonProvider(objectMapper));
```

atau register feature JSON yang sesuai.

### 35.2 Timeout Client Tidak Terset

Gejala:

- thread habis,
- request menggantung,
- dependency lambat memperparah incident.

Perbaikan:

```java
config.property(ClientProperties.CONNECT_TIMEOUT, 1000);
config.property(ClientProperties.READ_TIMEOUT, 3000);
```

### 35.3 Debug Error Bocor di PROD

Gejala:

- response mengandung exception class,
- stack trace muncul,
- path internal bocor.

Perbaikan:

- typed `ErrorSettings`,
- startup validation,
- test production config.

### 35.4 Resource Tidak Terdaftar

Gejala:

- 404 hanya di PROD,
- endpoint ada di DEV karena package scanning,
- PROD explicit registration lupa menambahkan resource.

Perbaikan:

- explicit registration checklist,
- route inventory test,
- runtime config summary.

### 35.5 Environment Variable Typo

Gejala:

- feature default ke false,
- security/audit mati,
- timeout default salah.

Perbaikan:

- required config parser,
- no silent default for critical values,
- fail fast.

### 35.6 ConfigMap Berubah Tapi Pod Tidak Restart

Gejala:

- config baru tidak berlaku,
- operator mengira aplikasi memakai nilai baru.

Perbaikan:

- pahami env var hanya dibaca saat process start,
- gunakan checksum annotation untuk restart deployment,
- expose config fingerprint.

### 35.7 Secret Tercetak di Log

Gejala:

- full settings object dilog,
- exception parsing config mencetak raw value.

Perbaikan:

- redacted `toString`,
- safe summary,
- never log raw config map.

---

## 36. Production Configuration Checklist

```text
Jersey Server Runtime
[ ] Application name set explicitly
[ ] Application path known
[ ] Resource registration explicit or scanning scope narrowly bounded
[ ] Auto-discovery policy consciously chosen
[ ] JSON provider explicitly selected
[ ] Exception mapper hierarchy registered
[ ] Security filter registered in production-like env
[ ] Correlation ID filter registered
[ ] Audit filter registered where required
[ ] Payload logging disabled or masked and limited
[ ] Multipart/body limits configured
[ ] Feature flags typed and validated
[ ] Illegal flag combinations rejected at startup
[ ] Runtime config summary available safely
[ ] Config fingerprint generated

Jersey Client Runtime
[ ] Client is reused, not created per request
[ ] Connect timeout set
[ ] Read timeout set
[ ] Base URI validated
[ ] TLS policy explicit
[ ] Proxy policy explicit if used
[ ] JSON provider consistent with server contract
[ ] Correlation propagation filter registered
[ ] Metrics/tracing filter registered
[ ] Retry/circuit/bulkhead policy configured outside low-level call

Security and Secrets
[ ] Secrets not stored as generic Jersey property unless unavoidable
[ ] Secrets not logged
[ ] Production debug disabled
[ ] Audit cannot be disabled silently
[ ] Token/JWKS/cache config validated

Environment
[ ] DEV/UAT/PROD behavior documented
[ ] UAT production-like for security/audit/timeouts
[ ] ConfigMap/Secret reload semantics understood
[ ] Deployment restart triggered when env config changes
[ ] Drift detection available
```

---

## 37. Design Pattern: Platform Configuration Module

Untuk tim besar, buat module internal:

```text
company-jersey-platform-config
├── AppSettings
├── RuntimeEnvironment
├── JerseyPlatformProperties
├── PlatformFeature
├── JsonProviderFeature
├── ErrorHandlingFeature
├── ObservabilityFeature
├── SecurityFeature
├── AuditFeature
├── StartupValidatorFeature
├── JerseyClientFactory
├── ConfigFingerprint
└── RuntimeConfigSummary
```

Aplikasi tinggal memakai:

```java
public final class CaseApiResourceConfig extends ResourceConfig {
    public CaseApiResourceConfig(AppSettings settings) {
        register(new CompanyJerseyPlatformFeature(settings));

        register(CaseResource.class);
        register(DocumentResource.class);
        register(AppealResource.class);
    }
}
```

Manfaat:

- standardisasi antar service,
- security baseline konsisten,
- observability konsisten,
- error shape konsisten,
- client config konsisten,
- migration lebih mudah.

Risiko:

- platform feature terlalu magical,
- aplikasi sulit override,
- dependency coupling tinggi.

Mitigasi:

- dokumentasikan default,
- expose typed settings,
- berikan escape hatch yang diaudit,
- buat compatibility test.

---

## 38. Mini Case Study: API Case Management Regulatory System

Misal kita punya API untuk case management:

```text
/cases
/cases/{id}
/cases/{id}/documents
/cases/{id}/decisions
/cases/{id}/audit-events
```

Regulatory constraints:

- semua command harus audited,
- semua request harus punya correlation ID,
- authorization object-level wajib,
- error tidak boleh membocorkan detail internal,
- payload bisa mengandung PII,
- outbound call ke identity/document service harus timeout,
- UAT harus production-like.

Config design:

```java
public final class RegulatoryApiSettings {
    private final RuntimeEnvironment environment;
    private final boolean auditEnabled;
    private final boolean objectAuthorizationEnabled;
    private final boolean rawPayloadLoggingEnabled;
    private final boolean debugErrorEnabled;
    private final HttpClientTimeouts identityClientTimeouts;
    private final HttpClientTimeouts documentClientTimeouts;

    public RegulatoryApiSettings(...) {
        // assign fields
        validate();
    }

    private void validate() {
        if (environment.isProductionLike()) {
            require(auditEnabled, "auditEnabled must be true");
            require(objectAuthorizationEnabled, "objectAuthorizationEnabled must be true");
            require(!rawPayloadLoggingEnabled, "rawPayloadLoggingEnabled must be false");
            require(!debugErrorEnabled, "debugErrorEnabled must be false");
        }
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new IllegalStateException(message);
        }
    }
}
```

Jersey config:

```java
public final class RegulatoryApiResourceConfig extends ResourceConfig {

    public RegulatoryApiResourceConfig(RegulatoryApiSettings settings) {
        register(new RegulatoryPlatformFeature(settings));

        register(CaseResource.class);
        register(DocumentResource.class);
        register(DecisionResource.class);
        register(AuditEventResource.class);
    }
}
```

Platform feature:

```java
public final class RegulatoryPlatformFeature implements Feature {

    private final RegulatoryApiSettings settings;

    public RegulatoryPlatformFeature(RegulatoryApiSettings settings) {
        this.settings = Objects.requireNonNull(settings);
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(CorrelationIdFilter.class);
        context.register(ProblemExceptionMapper.class);
        context.register(ValidationExceptionMapper.class);
        context.register(SecurityExceptionMapper.class);

        if (settings.auditEnabled()) {
            context.register(AuditDynamicFeature.class);
        }

        if (settings.objectAuthorizationEnabled()) {
            context.register(ObjectAuthorizationFilter.class);
        }

        if (settings.rawPayloadLoggingEnabled()) {
            context.register(RawPayloadLoggingFilter.class);
        }

        return true;
    }
}
```

Startup rule:

```text
If this service starts in UAT/PROD without audit/object authorization, startup must fail.
```

Itu configuration engineering sebagai regulatory control.

---

## 39. Anti-Patterns

### 39.1 `System.getenv()` Di Mana-Mana

Buruk:

```java
if (Boolean.parseBoolean(System.getenv("AUDIT_ENABLED"))) {
    auditService.write(...);
}
```

Akibat:

- sulit test,
- default diam-diam,
- parsing tersebar,
- policy tidak terpusat.

### 39.2 Semua Config Dalam `Map<String, String>`

Buruk:

```java
Map<String, String> config;
```

Akibat:

- tidak typed,
- unit tidak jelas,
- validasi lemah,
- refactor sulit.

### 39.3 Production Behavior Ditentukan Oleh Profile String Mentah

Buruk:

```java
if (!"prod".equals(profile)) {
    enableDebugEverything();
}
```

Jika profile typo, debug aktif.

### 39.4 Package Scan Terlalu Luas

Buruk:

```java
packages("com.company");
```

Akibat:

- resource/provider tak sengaja aktif,
- startup lambat,
- behavior berubah saat dependency berubah.

### 39.5 Secret Dalam `toString()`

Buruk:

```java
record TokenSettings(String clientId, String clientSecret) {}
```

`record` default `toString()` akan mencetak secret.

Untuk secret, jangan gunakan record default tanpa override `toString()`.

### 39.6 Flag Permanen

Feature flag yang tidak pernah dihapus akan menjadi hidden architecture.

---

## 40. Exercises

### Exercise 1 — Runtime Summary

Buat `RuntimeConfigSummary` untuk aplikasi Jersey kamu yang mencatat:

- application name,
- environment,
- registered resources,
- registered providers,
- enabled platform features,
- safe external client names,
- config fingerprint.

Pastikan tidak ada secret.

### Exercise 2 — Production Guardrail

Buat validator yang menolak startup PROD jika:

- audit disabled,
- debug error enabled,
- payload logging enabled,
- security disabled,
- client timeout > 30 detik,
- JSON provider tidak eksplisit.

### Exercise 3 — Feature Flag Lifecycle

Ambil 5 feature flag dari aplikasi nyata atau bayangan, lalu kategorikan:

```text
release flag / ops flag / permission flag / migration flag
```

Untuk masing-masing, tentukan kapan harus dihapus.

### Exercise 4 — Client Config Test

Buat test yang memastikan semua Jersey Client outbound memiliki:

- connect timeout,
- read timeout,
- base URI HTTPS,
- correlation propagation filter,
- metrics filter.

### Exercise 5 — Drift Detection

Buat safe config fingerprint untuk DEV dan UAT. Jelaskan field mana yang boleh berbeda dan mana yang harus sama.

---

## 41. Ringkasan Part 26

Konfigurasi Jersey bukan detail kecil. Ia adalah mekanisme untuk membentuk runtime graph.

Hal penting:

```text
1. Prefer explicit registration over broad scanning.
2. Treat configuration as typed domain object, not raw string map.
3. Validate critical config during startup.
4. Disable or control auto-discovery where determinism matters.
5. Do not store/log secrets as generic properties.
6. Use Feature/DynamicFeature for reusable and method-level behavior.
7. Make environment profile fail-closed for production-like systems.
8. Give Jersey Client explicit timeout and provider configuration.
9. Detect drift through safe summary/fingerprint.
10. Remove stale feature flags.
```

Untuk aplikasi biasa, konfigurasi membuat app berjalan. Untuk sistem enterprise/regulatory, konfigurasi adalah bagian dari compliance, auditability, operability, dan incident prevention.

---

## 42. Koneksi ke Part Berikutnya

Part ini menyiapkan dasar untuk testing Jersey secara serius.

Setelah konfigurasi menjadi eksplisit dan typed, kita bisa menguji:

- resource registration,
- provider registration,
- filter/interceptor behavior,
- exception mapper,
- JSON contract,
- validation behavior,
- security context,
- Jersey Client config,
- illegal configuration combination,
- runtime behavior tanpa full production deployment.

Berikutnya:

> **Part 27 — Testing Jersey Applications: Unit, In-Memory, Container, Contract, and Failure Tests**

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 25 — Deployment Models: Servlet Container, Grizzly, Embedded, Jakarta EE Server, Spring Boot](./25-deployment-models-servlet-container-grizzly-embedded-jakarta-ee-server-spring-boot.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 27 — Testing Jersey Applications: Unit, In-Memory, Container, Contract, and Failure Tests](./27-testing-jersey-applications-unit-inmemory-container-contract-failure-tests.md)
