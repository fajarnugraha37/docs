# Part 027 — Profiles: Environment-Specific Behavior Without Code Forking

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Part: `027`  
> Topik: Profiles, environment-specific behavior, configuration layering, conditional beans, environment safety, and deployment governance  
> Target: Java 8–25, Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI, MicroProfile Config, application-server and cloud-native runtimes

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu membedakan dengan tajam antara **environment**, **profile**, **configuration**, **feature flag**, **qualifier**, **build variant**, dan **runtime condition**.

Ini penting karena banyak aplikasi enterprise menjadi rapuh bukan karena business logic-nya rumit, tetapi karena perilaku aplikasi tersebar dalam kondisi seperti:

```java
if (env.equals("prod")) { ... }
if (profile.equals("uat")) { ... }
if (System.getenv("LOCAL") != null) { ... }
if (isDev()) { ... }
```

Kode seperti ini terlihat sederhana, tetapi menimbulkan masalah besar:

1. sulit diaudit,
2. sulit dites,
3. sulit diprediksi saat deployment,
4. mudah bocor ke production,
5. membuat environment menjadi implicit dependency,
6. dan sering menjadi sumber incident saat migrasi Java EE → Jakarta EE atau saat pindah app server/container.

Part ini membangun mental model untuk mengelola perbedaan environment tanpa membuat codebase bercabang secara liar.

---

## 1. Masalah yang Ingin Diselesaikan Profile

Aplikasi enterprise biasanya hidup di banyak konteks:

```text
local developer machine
        ↓
unit/integration test
        ↓
DEV
        ↓
SIT
        ↓
UAT
        ↓
staging / pre-prod
        ↓
PROD
        ↓
DR / standby / blue-green slot
```

Setiap konteks dapat berbeda pada banyak hal:

| Aspek | Contoh Perbedaan |
|---|---|
| Database | H2/local, Oracle DEV, Oracle UAT, Oracle PROD |
| External API | mock, sandbox, staging, production endpoint |
| Auth | local stub, Keycloak DEV, Singpass/Corppass sandbox, production IdP |
| Credential | dummy, rotated secret, production secret |
| Logging | verbose local, structured JSON prod |
| Observability | disabled local, enabled prod |
| Rate limit | relaxed local, strict prod |
| Batch schedule | off local, limited UAT, full prod |
| Email/SMS | log only local, sandbox UAT, real prod |
| Feature availability | hidden UAT, enabled for selected agency, fully enabled prod |

Tanpa model yang benar, developer sering memasukkan perbedaan itu langsung ke business code.

Contoh buruk:

```java
public void sendNotification(Notification notification) {
    String env = System.getenv("APP_ENV");

    if ("local".equals(env) || "dev".equals(env)) {
        log.info("Not sending real email in {}", env);
        return;
    }

    smtpClient.send(notification);
}
```

Masalahnya:

1. Business service tahu tentang environment.
2. Behavior produksi dan non-produksi bercampur.
3. Test harus mengubah environment global.
4. Tidak ada kontrak eksplisit.
5. Saat environment baru muncul, misalnya `preprod`, behavior bisa salah.
6. Ada risiko fatal jika string env typo.

Profile hadir untuk menjawab pertanyaan:

> “Dalam konteks deployment tertentu, konfigurasi dan implementasi apa yang harus digunakan?”

Tetapi profile bukan solusi untuk semua hal. Ia harus dibedakan dari configuration dan feature flag.

---

## 2. Vocabulary: Environment, Profile, Config, Feature Flag, Build Variant

Sebelum masuk teknis, kita perlu vocabulary yang presisi.

### 2.1 Environment

**Environment** adalah tempat aplikasi dijalankan secara operasional.

Contoh:

```text
local
DEV
SIT
UAT
staging
PROD
DR
```

Environment adalah realitas deployment.

Ia menjawab:

> “Aplikasi ini sedang berjalan di mana?”

Environment biasanya berkaitan dengan:

- network,
- database,
- endpoint external,
- credential,
- observability,
- scaling,
- access control,
- operational SLA.

### 2.2 Profile

**Profile** adalah nama konfigurasi/perilaku yang dipilih untuk suatu runtime.

Contoh:

```text
local
unit-test
integration-test
dev
uat
prod
dr
migration
readonly
sandbox
```

Profile menjawab:

> “Set konfigurasi/perilaku mana yang aktif?”

Environment dan profile sering sama namanya, tetapi tidak harus.

Contoh:

```text
Environment: UAT
Active profile: uat + singpass-sandbox + email-disabled
```

Atau:

```text
Environment: PROD blue slot
Active profile: prod + blue + migration-readonly
```

### 2.3 Configuration

**Configuration** adalah nilai yang mengubah behavior tanpa mengubah code.

Contoh:

```properties
app.external.onemap.base-url=https://www.onemap.gov.sg
app.external.onemap.rate-limit-per-minute=250
app.email.enabled=false
app.audit.retention-days=365
```

Configuration menjawab:

> “Nilai apa yang dipakai oleh aplikasi?”

### 2.4 Feature Flag

**Feature flag** adalah decision point yang mengaktifkan/mematikan perilaku tertentu, sering bisa berubah tanpa redeploy.

Contoh:

```text
new-renewal-workflow.enabled=true
case-auto-assignment.enabled=false
onemap-token-auth.enabled=true
```

Feature flag menjawab:

> “Fitur atau jalur logic tertentu boleh aktif untuk context ini atau tidak?”

Feature flag bisa berbasis:

- tenant,
- agency,
- user role,
- percentage rollout,
- region,
- waktu,
- operational emergency.

### 2.5 Build Variant

**Build variant** adalah artifact berbeda yang dihasilkan dari build berbeda.

Contoh:

```text
app-prod.war
app-dev.war
app-govcloud.jar
app-commercial.jar
```

Build variant menjawab:

> “Artifact mana yang dibuat?”

Build variant harus digunakan hati-hati karena bisa membuat artifact yang dites berbeda dari artifact yang diproduksi.

### 2.6 Qualifier

**Qualifier** dalam CDI adalah metadata type-safe untuk memilih bean.

Contoh:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface Sandbox {}
```

Qualifier menjawab:

> “Bean mana yang sesuai dengan injection point ini?”

Qualifier bukan profile, tetapi profile dapat memengaruhi bean mana yang diaktifkan.

---

## 3. Tabel Perbedaan Konsep

| Konsep | Pertanyaan Utama | Berubah Kapan | Contoh | Risiko Jika Disalahgunakan |
|---|---|---:|---|---|
| Environment | berjalan di mana? | deployment | DEV/UAT/PROD | logic hardcoded per env |
| Profile | mode config/perilaku apa? | startup/deployment | `prod`, `test`, `migration` | profile explosion |
| Config | nilai apa? | startup/runtime tergantung source | URL, timeout, pool size | config drift |
| Feature flag | fitur aktif? | runtime/deployment | `newFlow=true` | flag debt |
| Build variant | artifact apa? | build time | prod WAR vs dev WAR | artifact mismatch |
| CDI qualifier | bean mana? | compile/runtime resolution | `@PrimaryGateway` | qualifier explosion |

Rule sederhana:

```text
Environment = where it runs
Profile     = which configuration set is active
Config      = what values are used
Flag        = whether a behavior is enabled
Qualifier   = which implementation is selected by DI
Build       = what artifact is produced
```

---

## 4. Mengapa Profile Tidak Boleh Menjadi Business Logic

Profile seharusnya berada di boundary runtime, bukan tersebar di domain logic.

### Buruk

```java
public BigDecimal calculatePenalty(Case c) {
    if (System.getProperty("profile").equals("uat")) {
        return BigDecimal.ZERO;
    }
    return penaltyPolicy.calculate(c);
}
```

Ini buruk karena:

1. policy bisnis tergantung environment,
2. UAT tidak menguji behavior sebenarnya,
3. production behavior tidak tercermin di test,
4. audit sulit menjelaskan kenapa penalty berbeda,
5. environment typo dapat mengubah hasil bisnis.

### Lebih Baik

```java
public interface PenaltyPolicy {
    BigDecimal calculate(Case c);
}
```

```java
@ApplicationScoped
public class RealPenaltyPolicy implements PenaltyPolicy {
    public BigDecimal calculate(Case c) {
        return /* real policy */;
    }
}
```

Untuk test/UAT tertentu, gunakan replacement di layer wiring/test, bukan business code.

Misalnya:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class NoopPenaltyPolicy implements PenaltyPolicy {
    public BigDecimal calculate(Case c) {
        return BigDecimal.ZERO;
    }
}
```

Atau lebih eksplisit lagi:

```properties
app.penalty.mode=real
```

lalu validasi config dan expose keputusan saat startup.

Prinsipnya:

> Business rule tidak boleh diam-diam berubah hanya karena environment berubah, kecuali perbedaan itu memang merupakan requirement yang eksplisit dan terdokumentasi.

---

## 5. Profile sebagai Configuration Layering

Profile paling umum dipakai untuk memilih layer konfigurasi.

Misalnya:

```text
application.properties
application-local.properties
application-dev.properties
application-uat.properties
application-prod.properties
```

Mental model-nya:

```text
base configuration
        ↓ override by active profile
profile-specific configuration
        ↓ override by environment variable / secret / deployment config
runtime deployment override
```

Contoh:

```properties
# application.properties
app.email.enabled=true
app.email.provider=smtp
app.external.case-api.timeout=5s
```

```properties
# application-local.properties
app.email.enabled=false
app.email.provider=log
app.external.case-api.timeout=30s
```

```properties
# application-prod.properties
app.email.enabled=true
app.email.provider=smtp
app.external.case-api.timeout=3s
```

Profile layering berguna karena base config bisa menyimpan default umum, sementara profile-specific config menyimpan override yang masuk akal untuk mode tertentu.

Namun ada jebakan:

> Jangan menyimpan secret production di file profile dalam repository.

Secret harus berasal dari secret manager, environment variable, container secret, Kubernetes Secret, vault, atau mekanisme secure lain.

---

## 6. MicroProfile Config dan Profile: Apa yang Portable, Apa yang Vendor-Specific

MicroProfile Config menyediakan model konfigurasi portable:

- `ConfigSource`,
- ordinal/precedence,
- `ConfigProvider`,
- `@ConfigProperty`,
- converter,
- custom config source.

Spesifikasi MicroProfile Config mendefinisikan unified configuration system yang extensible via SPI dan menggabungkan banyak source menjadi satu view konfigurasi. Namun konsep **profile** sering kali merupakan fitur implementation/runtime di atas MicroProfile Config, bukan selalu bagian portable yang sama di semua vendor.

Artinya:

```text
MicroProfile Config core = portable
Profile mechanism       = often implementation-specific
```

Contoh runtime modern:

- Quarkus menggunakan SmallRye Config dan memiliki profile seperti `dev`, `test`, `prod` serta custom profile.
- Open Liberty menyediakan MicroProfile Config dan integrasi server configuration.
- Helidon MP menggunakan MicroProfile Config dan memiliki model configuration source sendiri.

Implikasi untuk engineer:

1. `@ConfigProperty` relatif portable.
2. Custom `ConfigSource` relatif portable jika mengikuti SPI.
3. File naming/profile activation bisa berbeda antar runtime.
4. Conditional bean by profile sering vendor-specific.
5. Dokumentasikan profile mechanism yang dipakai oleh runtime-mu.

Referensi resmi: MicroProfile Config mendefinisikan sistem konfigurasi fleksibel dan extensible via SPI; Quarkus menyatakan konfigurasinya menggunakan SmallRye Config sebagai implementasi MicroProfile Config; Open Liberty mendeskripsikan MicroProfile Config sebagai API yang menggunakan CDI untuk inject property value; Helidon MP mendukung ConfigSource dan Converter MicroProfile Config.  
Sources: MicroProfile Config specification, Quarkus configuration reference, Open Liberty MicroProfile Config docs, Helidon MP Config docs. [^mp-config] [^quarkus-config] [^openliberty-config] [^helidon-config]

---

## 7. Contoh Layering Konfigurasi yang Aman

Anggap aplikasi case management punya external systems:

- identity provider,
- document service,
- payment gateway,
- notification service,
- GIS/address API,
- audit storage.

Base config:

```properties
app.name=ace-case-runtime
app.audit.enabled=true
app.notification.email.enabled=true
app.notification.sms.enabled=false
app.external.timeout.connect=2s
app.external.timeout.read=5s
app.case.assignment.mode=manual
```

Local profile:

```properties
app.profile=local
app.notification.email.enabled=false
app.notification.provider=log
app.external.identity.base-url=http://localhost:9001/mock-idp
app.external.document.base-url=http://localhost:9002/mock-document
app.external.payment.base-url=http://localhost:9003/mock-payment
app.case.assignment.mode=manual
```

UAT profile:

```properties
app.profile=uat
app.notification.email.enabled=false
app.notification.provider=sandbox
app.external.identity.base-url=https://idp-sandbox.example.gov
app.external.document.base-url=https://document-uat.example.gov
app.external.payment.base-url=https://payment-sandbox.example.gov
app.case.assignment.mode=manual
```

Production profile:

```properties
app.profile=prod
app.notification.email.enabled=true
app.notification.provider=smtp
app.external.identity.base-url=https://idp.example.gov
app.external.document.base-url=https://document.example.gov
app.external.payment.base-url=https://payment.example.gov
app.case.assignment.mode=auto
```

Deployment secret/config override:

```text
APP_EXTERNAL_IDENTITY_CLIENT_SECRET=...
APP_EXTERNAL_PAYMENT_API_KEY=...
APP_DB_PASSWORD=...
```

Yang penting:

1. Semua environment punya explicit profile.
2. Semua config wajib divalidasi saat startup.
3. Production tidak boleh fallback ke local/dev default.
4. Secret tidak disimpan di repository.
5. Perbedaan critical behavior harus terlihat saat startup log/health/config report.

---

## 8. Startup Validation: Profile Harus Fail Fast

Salah satu kebiasaan top engineer: **jangan biarkan aplikasi running dalam profile yang ambigu**.

Buruk:

```java
String profile = Optional.ofNullable(System.getenv("APP_PROFILE"))
        .orElse("dev");
```

Ini berbahaya karena jika production lupa set env var, aplikasi bisa jalan sebagai `dev`.

Lebih baik:

```java
@ApplicationScoped
public class RuntimeProfile {

    private final String value;

    @Inject
    public RuntimeProfile(@ConfigProperty(name = "app.profile") String value) {
        this.value = value;
        validate(value);
    }

    public String value() {
        return value;
    }

    public boolean isProd() {
        return "prod".equals(value);
    }

    private static void validate(String value) {
        Set<String> allowed = Set.of(
                "local", "test", "dev", "sit", "uat", "staging", "prod", "dr", "migration"
        );

        if (!allowed.contains(value)) {
            throw new IllegalStateException("Invalid app.profile: " + value);
        }
    }
}
```

Untuk Java 8, `Set.of` belum ada:

```java
private static final Set<String> ALLOWED = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
                "local", "test", "dev", "sit", "uat", "staging", "prod", "dr", "migration"
        ))
);
```

Validasi minimum:

```text
[ ] profile wajib ada
[ ] profile harus salah satu allowed values
[ ] prod tidak boleh memakai mock endpoint
[ ] prod tidak boleh email disabled kecuali explicit maintenance mode
[ ] prod tidak boleh memakai weak secret/default password
[ ] local/dev tidak boleh mengarah ke prod database
[ ] UAT tidak boleh mengirim email/SMS real tanpa approval
[ ] migration profile harus explicit dan observable
```

---

## 9. Environment-Specific Implementation Selection

Kadang bukan hanya value yang berbeda, tetapi implementasi berbeda.

Contoh:

- local memakai `LogEmailSender`,
- UAT memakai `SandboxEmailSender`,
- prod memakai `SmtpEmailSender`.

### 9.1 Anti-pattern: `if profile` di business service

```java
@ApplicationScoped
public class NotificationService {

    @Inject RuntimeProfile profile;
    @Inject SmtpEmailSender smtp;
    @Inject LogEmailSender log;

    public void send(Email email) {
        if (profile.isProd()) {
            smtp.send(email);
        } else {
            log.send(email);
        }
    }
}
```

Masalah:

- service tahu semua implementasi,
- selection tersebar,
- sulit tambah profile baru,
- test menjadi combinatorial,
- dependency graph membengkak.

### 9.2 Pattern: Strategy Interface + Producer Selection

```java
public interface EmailSender {
    void send(Email email);
}
```

```java
@ApplicationScoped
public class SmtpEmailSender implements EmailSender {
    public void send(Email email) {
        // send via SMTP
    }
}
```

```java
@ApplicationScoped
public class LogEmailSender implements EmailSender {
    public void send(Email email) {
        // log only
    }
}
```

Agar tidak ambiguous, jangan expose semua sebagai injectable `EmailSender` default. Gunakan qualifier internal atau producer.

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface RealEmail {}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface SafeEmail {}
```

```java
@RealEmail
@ApplicationScoped
public class SmtpEmailSender implements EmailSender { ... }
```

```java
@SafeEmail
@ApplicationScoped
public class LogEmailSender implements EmailSender { ... }
```

Producer:

```java
@ApplicationScoped
public class EmailSenderProducer {

    @Inject RuntimeProfile profile;

    @Inject @RealEmail EmailSender realEmail;
    @Inject @SafeEmail EmailSender safeEmail;

    @Produces
    @ApplicationScoped
    public EmailSender emailSender() {
        if (profile.isProd()) {
            return realEmail;
        }
        return safeEmail;
    }
}
```

Consumer tetap bersih:

```java
@ApplicationScoped
public class NotificationService {

    private final EmailSender emailSender;

    @Inject
    public NotificationService(EmailSender emailSender) {
        this.emailSender = emailSender;
    }

    public void send(Email email) {
        emailSender.send(email);
    }
}
```

Kelebihan:

1. business service tidak tahu profile,
2. selection centralized,
3. behavior bisa dilog saat startup,
4. test dapat mengganti `EmailSender`,
5. profile logic berada di wiring boundary.

---

## 10. Profile vs CDI Alternative

CDI `@Alternative` bisa dipakai untuk mengganti implementation.

Contoh:

```java
public interface PaymentGateway {
    PaymentResult charge(PaymentRequest request);
}
```

Production implementation:

```java
@ApplicationScoped
public class RealPaymentGateway implements PaymentGateway {
    public PaymentResult charge(PaymentRequest request) {
        return /* call real payment */;
    }
}
```

Test alternative:

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class FakePaymentGateway implements PaymentGateway {
    public PaymentResult charge(PaymentRequest request) {
        return PaymentResult.approved("fake");
    }
}
```

`@Alternative` cocok untuk:

- test replacement,
- deployment-specific replacement,
- implementation override,
- migration adapter.

Tetapi hati-hati:

- `@Priority` bisa mengaktifkan alternative global,
- terlalu banyak alternative membuat graph sulit dibaca,
- jangan jadikan alternative sebagai profile system liar.

Rule:

```text
Use @Alternative for explicit bean replacement.
Use config/profile for environment-specific values.
Use feature flag for runtime rollout decision.
Use producer/selector when selection depends on config at startup.
```

---

## 11. Profile vs Feature Flag

Ini pembedaan yang sering kacau.

### Profile

Profile biasanya dipilih saat startup/deployment.

Contoh:

```text
app.profile=uat
```

Ia menentukan konfigurasi umum environment.

### Feature Flag

Feature flag bisa berubah saat runtime dan sering spesifik untuk context.

Contoh:

```text
feature.case-auto-assignment.enabled=true
feature.new-appeal-workflow.enabled=false
```

Dengan targeting:

```text
new-appeal-workflow enabled for agency=CEA, role=OFFICER, percentage=10%
```

### Jangan Jadikan Profile Sebagai Feature Flag

Buruk:

```java
if (profile.isUat()) {
    useNewWorkflow();
} else {
    useOldWorkflow();
}
```

Ini salah karena fitur baru bukan properti intrinsik UAT. UAT hanya tempat uji.

Lebih baik:

```java
if (featureFlags.isEnabled("new-appeal-workflow", context)) {
    useNewWorkflow();
} else {
    useOldWorkflow();
}
```

Profile boleh menyediakan default flag value:

```properties
# application-uat.properties
feature.new-appeal-workflow.enabled=true

# application-prod.properties
feature.new-appeal-workflow.enabled=false
```

Tetapi konsepnya tetap berbeda.

---

## 12. Profile vs Tenant / Agency / Customer

Dalam sistem regulator, sering ada variasi per agency, department, region, atau tenant.

Contoh:

```text
agency=CEA
agency=CPDS
agency=ROM
```

Jangan campur tenant dengan profile.

Buruk:

```text
profile=prod-cea
profile=prod-cpds
profile=prod-rom
profile=uat-cea
profile=uat-cpds
profile=uat-rom
```

Ini menyebabkan profile explosion.

Lebih baik:

```text
app.profile=prod
app.tenant=cea
```

Atau:

```text
app.profile=uat
app.agency=cea
```

Kemudian konfigurasi tenant-specific dikelola sebagai config domain sendiri:

```properties
tenant.cea.audit.retention-days=3650
tenant.cea.workflow.appeal.enabled=true
tenant.rom.audit.retention-days=2555
tenant.rom.workflow.appeal.enabled=false
```

Mental model:

```text
profile = environment behavior set
tenant  = business/customer/agency partition
flag    = runtime behavior decision
config  = values
```

---

## 13. Profile Explosion: Gejala dan Pencegahan

Profile explosion terjadi ketika setiap kombinasi kondisi dibuat menjadi profile baru.

Contoh buruk:

```text
local
local-mock-email
local-real-email
local-real-email-fake-payment
dev
dev-new-workflow
dev-new-workflow-email-disabled
uat
uat-new-workflow
uat-old-workflow
prod
prod-readonly
prod-readonly-new-workflow
prod-migration
prod-migration-email-off
```

Masalah:

1. Tidak jelas profile mana valid.
2. Test matrix meledak.
3. Deployment script rumit.
4. Dokumentasi selalu tertinggal.
5. Kombinasi behavior sulit diaudit.

Pencegahan:

```text
Keep profiles few and coarse-grained.
Use config values for values.
Use flags for feature decisions.
Use explicit operational modes for exceptional states.
Use tenant config for tenant differences.
```

Profile yang sehat biasanya sedikit:

```text
local
test
dev
sit
uat
staging
prod
dr
migration
```

Mode seperti `readonly`, `maintenance`, `migration`, `degraded` sebaiknya dipertimbangkan apakah ia profile, flag, atau operational mode.

---

## 14. Operational Mode: Readonly, Maintenance, Migration, Degraded

Selain profile, aplikasi enterprise sering punya **operational mode**.

Contoh:

```properties
app.operation.mode=normal
```

Allowed values:

```text
normal
readonly
maintenance
migration
degraded
```

Operational mode berbeda dari profile.

| Mode | Makna |
|---|---|
| `normal` | aplikasi melayani read/write normal |
| `readonly` | hanya read, write ditolak/ditahan |
| `maintenance` | akses dibatasi |
| `migration` | proses migrasi data/config aktif |
| `degraded` | external dependency tertentu tidak tersedia |

Contoh enforcement:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({ TYPE, METHOD })
public @interface RequiresWriteMode {}
```

```java
@RequiresWriteMode
@Interceptor
@Priority(Interceptor.Priority.APPLICATION)
public class WriteModeInterceptor {

    @Inject OperationalMode mode;

    @AroundInvoke
    public Object guard(InvocationContext ctx) throws Exception {
        if (!mode.allowsWrite()) {
            throw new ServiceUnavailableException("Application is not accepting write operations");
        }
        return ctx.proceed();
    }
}
```

Ini lebih baik daripada menyebar:

```java
if (profile.equals("prod-readonly")) { ... }
```

---

## 15. Profile Activation Mechanisms

Karena profile mechanism tidak selalu sama antar runtime, kamu harus eksplisit mendokumentasikannya.

Beberapa pattern umum:

### 15.1 System Property

```bash
-Dapp.profile=uat
```

Kelebihan:

- sederhana,
- cocok untuk app server JVM arg,
- mudah dibaca saat startup.

Kekurangan:

- perlu kontrol script deployment,
- bisa tersembunyi di server config.

### 15.2 Environment Variable

```bash
APP_PROFILE=uat
```

Kelebihan:

- cocok container/Kubernetes,
- sesuai externalized config,
- mudah inject via deployment manifest.

Kekurangan:

- semua value string,
- mapping env var ke property bisa berbeda,
- raw env bisa terekspos di diagnostic tertentu.

### 15.3 Profile-specific File

```text
application-uat.properties
```

Kelebihan:

- jelas,
- familiar,
- mudah versioning untuk non-secret.

Kekurangan:

- jangan simpan secret,
- bisa membuat config tersebar,
- file selection mechanism vendor-specific.

### 15.4 Server/Application Server Config

Misalnya:

- `server.xml`,
- domain config,
- deployment descriptor,
- JNDI env-entry,
- admin console.

Kelebihan:

- cocok legacy Jakarta EE server,
- resource binding bisa dikelola ops.

Kekurangan:

- tidak selalu terlihat di repository,
- drift antar server node,
- audit perlu proses ops.

### 15.5 Kubernetes / Container Config

```yaml
env:
  - name: APP_PROFILE
    value: "uat"
```

Atau:

```yaml
envFrom:
  - configMapRef:
      name: case-app-config
  - secretRef:
      name: case-app-secrets
```

Kelebihan:

- cocok cloud-native,
- declarative,
- bisa dikelola GitOps.

Kekurangan:

- ConfigMap/Secret drift,
- rolling restart behavior harus jelas,
- secret lifecycle harus aman.

---

## 16. Profile Activation: Fail-Safe Rules

Profile activation harus punya aturan keamanan.

### Rule 1: No Implicit Production

Jangan jadikan `prod` sebagai default.

```java
// dangerous
String profile = config.getOptionalValue("app.profile", String.class).orElse("prod");
```

Jika config hilang, aplikasi bisa masuk production mode tanpa sengaja.

### Rule 2: No Implicit Development in Production Artifact

Jangan jadikan `dev` sebagai fallback untuk semua missing config.

```java
// dangerous
String profile = config.getOptionalValue("app.profile", String.class).orElse("dev");
```

Jika deployment production lupa config, aplikasi bisa memakai mock/relaxed security.

### Rule 3: Require Explicit Profile

```java
String profile = config.getValue("app.profile", String.class);
```

Missing value harus fail startup.

### Rule 4: Validate Cross-Config Invariants

Contoh:

```text
if app.profile=prod:
  email.provider must not be log
  payment.gateway.mode must be real
  database.host must not contain dev/uat/local
  security.mock-login.enabled must be false
  audit.enabled must be true
```

### Rule 5: Emit Startup Summary

Startup log harus menyatakan keputusan penting, tanpa secret.

Contoh:

```text
Runtime profile: prod
Operational mode: normal
Email provider: smtp
Payment gateway mode: real
Audit enabled: true
Mock login enabled: false
Feature source: database-config-source
```

Jangan log secret.

---

## 17. Profile and Build-Time vs Runtime-Time Configuration

Modern runtime seperti Quarkus membedakan sebagian konfigurasi build-time dan runtime-time. Jakarta EE server tradisional juga punya efek serupa walaupun istilahnya berbeda: beberapa keputusan terjadi saat build/package/deploy/startup, bukan saat request.

Pembedaan penting:

| Waktu | Contoh | Apakah Bisa Diubah Tanpa Restart? |
|---|---|---:|
| Build-time | include extension, remove unused bean, native image config | tidak |
| Deploy-time | resource binding, WAR deployment descriptor | biasanya tidak |
| Startup-time | selected profile, datasource URL, pool size | biasanya perlu restart |
| Runtime-time | feature flag, dynamic timeout, routing policy | tergantung source |

Kesalahan umum:

> Menganggap semua config bisa berubah runtime.

Padahal beberapa config sudah dibaca saat container bootstrap.

Contoh:

```java
@ApplicationScoped
public class ExternalClientProducer {

    @Produces
    @ApplicationScoped
    ExternalClient client(@ConfigProperty(name = "external.base-url") String baseUrl) {
        return ExternalClient.create(baseUrl);
    }
}
```

`baseUrl` dipakai saat producer membuat singleton/application-scoped client. Jika config source berubah runtime, client belum tentu berubah.

Jika memang butuh dynamic behavior:

```java
@Inject
@ConfigProperty(name = "external.timeout")
Provider<Duration> timeoutProvider;
```

Tetapi jangan asal memakai dynamic lookup untuk semua hal. Dynamic config membuat behavior request-to-request bisa berubah dan sulit direproduksi.

---

## 18. Profile and CDI Bean Activation

Ada beberapa cara mengaktifkan bean berbeda berdasarkan profile.

### 18.1 Manual Producer

Cocok portable dan eksplisit.

```java
@Produces
@ApplicationScoped
PaymentGateway paymentGateway(
        RuntimeProfile profile,
        @RealGateway PaymentGateway real,
        @SandboxGateway PaymentGateway sandbox) {

    if (profile.isProd()) {
        return real;
    }
    return sandbox;
}
```

Kelebihan:

- portable CDI,
- selection centralized,
- mudah dites.

Kekurangan:

- semua candidate bean tetap ada,
- perlu menjaga ambiguity dengan qualifier.

### 18.2 Alternatives

Cocok untuk replacement explicit.

```java
@Alternative
@Priority(1)
@ApplicationScoped
public class SandboxPaymentGateway implements PaymentGateway { ... }
```

Kelebihan:

- idiom CDI,
- bagus untuk test.

Kekurangan:

- aktivasi per environment bisa sulit jika hanya memakai portable CDI,
- `@Priority` global dapat mengejutkan.

### 18.3 Runtime-Specific Conditional Annotation

Beberapa framework menyediakan annotation seperti:

```java
@IfBuildProfile("prod")
@UnlessBuildProfile("test")
```

atau annotation conditional lain.

Kelebihan:

- ringkas,
- bagus untuk build-time optimization.

Kekurangan:

- vendor-specific,
- portability berkurang,
- perlu paham apakah condition dievaluasi build-time atau runtime.

### 18.4 `Instance<T>` Lookup

```java
@Inject
Instance<PaymentGateway> gateways;
```

Bisa dipakai untuk dynamic selection, tetapi rawan service locator anti-pattern.

Gunakan jika:

- memang butuh memilih dari banyak plugin,
- selection logic centralized,
- observability jelas,
- failure behavior jelas.

Jangan gunakan untuk menyembunyikan dependency.

---

## 19. Configuration Contract Object

Daripada menyebar `@ConfigProperty` di seluruh codebase, buat object contract.

Contoh:

```java
@ApplicationScoped
public class NotificationConfig {

    private final boolean emailEnabled;
    private final String provider;
    private final Duration timeout;

    @Inject
    public NotificationConfig(
            @ConfigProperty(name = "app.notification.email.enabled") boolean emailEnabled,
            @ConfigProperty(name = "app.notification.provider") String provider,
            @ConfigProperty(name = "app.notification.timeout") Duration timeout) {

        this.emailEnabled = emailEnabled;
        this.provider = provider;
        this.timeout = timeout;
        validate();
    }

    private void validate() {
        if (!Set.of("log", "sandbox", "smtp").contains(provider)) {
            throw new IllegalStateException("Invalid email provider: " + provider);
        }
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalStateException("Notification timeout must be positive");
        }
    }

    public boolean emailEnabled() { return emailEnabled; }
    public String provider() { return provider; }
    public Duration timeout() { return timeout; }
}
```

Keuntungan:

1. config punya domain boundary,
2. validasi centralized,
3. consumer tidak tahu nama property string,
4. refactor lebih aman,
5. startup failure lebih jelas.

Untuk Java 8, jika `Duration` converter belum tersedia di runtime, buat custom converter atau simpan sebagai milliseconds:

```properties
app.notification.timeout-ms=5000
```

---

## 20. Profile Safety Matrix

Buat matrix eksplisit.

| Config/Behavior | local | dev | uat | staging | prod |
|---|---:|---:|---:|---:|---:|
| Mock login | allowed | allowed limited | usually no | no | no |
| Real email | no | no | no by default | controlled | yes |
| Real payment | no | no | sandbox | sandbox/real dry-run | yes |
| Audit enabled | yes | yes | yes | yes | yes mandatory |
| SQL logging | yes | limited | no | no | no |
| Debug endpoint | yes | restricted | restricted | no/public denied | no/public denied |
| Data masking | optional | yes | yes | yes | mandatory |
| External API timeout | relaxed | normal | normal | production-like | strict |
| Feature flag source | local file | config file | DB/config service | config service | config service |
| Default admin user | allowed | maybe | no | no | no |

Matrix ini penting untuk:

- onboarding,
- security review,
- production readiness,
- audit,
- incident diagnosis,
- regression testing.

---

## 21. Production Guard: Prevent Dangerous Config Combinations

Buat validator startup.

```java
@ApplicationScoped
public class ProductionSafetyValidator {

    @Inject RuntimeProfile profile;
    @Inject Config config;

    @PostConstruct
    void validate() {
        if (!profile.isProd()) {
            return;
        }

        mustBeFalse("app.security.mock-login.enabled");
        mustBeTrue("app.audit.enabled");
        mustNotContain("app.datasource.url", "dev");
        mustNotContain("app.datasource.url", "uat");
        mustNotEqual("app.notification.provider", "log");
    }

    private void mustBeFalse(String key) {
        boolean value = config.getValue(key, Boolean.class);
        if (value) {
            throw new IllegalStateException("Forbidden production config: " + key + " must be false");
        }
    }

    private void mustBeTrue(String key) {
        boolean value = config.getValue(key, Boolean.class);
        if (!value) {
            throw new IllegalStateException("Forbidden production config: " + key + " must be true");
        }
    }

    private void mustNotContain(String key, String forbidden) {
        String value = config.getValue(key, String.class);
        if (value.toLowerCase(Locale.ROOT).contains(forbidden)) {
            throw new IllegalStateException("Forbidden production config: " + key + " contains " + forbidden);
        }
    }

    private void mustNotEqual(String key, String forbidden) {
        String value = config.getValue(key, String.class);
        if (forbidden.equals(value)) {
            throw new IllegalStateException("Forbidden production config: " + key + " = " + forbidden);
        }
    }
}
```

Catatan:

- Jangan validasi secret dengan mencetak value.
- Jangan terlalu mengandalkan substring host; lebih baik gunakan allowlist/metadata environment jika tersedia.
- Validator harus fail fast sebelum aplikasi menerima traffic.

---

## 22. Profile in Tests

Testing profile bukan sekadar mengganti property.

Kamu perlu memastikan:

1. semua required config tersedia,
2. forbidden combination gagal,
3. implementation selection benar,
4. feature default sesuai,
5. behavior critical production-like dites minimal satu jalur.

### 22.1 Unit Test Pure Config Object

```java
@Test
void rejectsInvalidProvider() {
    assertThrows(IllegalStateException.class, () ->
            new NotificationConfig(true, "unknown", Duration.ofSeconds(5))
    );
}
```

### 22.2 Integration Test Profile Selection

Pseudocode:

```java
@Test
void localProfileUsesLogEmailSender() {
    setConfig("app.profile", "local");
    EmailSender sender = container.select(EmailSender.class).get();
    assertThat(sender).isInstanceOf(LogEmailSender.class);
}
```

### 22.3 Production Safety Test

```java
@Test
void prodRejectsMockLogin() {
    config.put("app.profile", "prod");
    config.put("app.security.mock-login.enabled", "true");

    assertThrows(IllegalStateException.class, () -> startContainer(config));
}
```

### 22.4 Matrix Test

Untuk config critical, buat table-driven test:

```text
profile | email provider | mock login | expected
local   | log            | true       | ok
uat     | sandbox        | false      | ok
prod    | smtp           | false      | ok
prod    | log            | false      | fail
prod    | smtp           | true       | fail
```

Tujuannya bukan coverage angka, tetapi menjaga invariant runtime.

---

## 23. Profile Observability

Aplikasi harus bisa menjawab:

> “Sekarang running dalam profile apa dan keputusan runtime utama apa yang aktif?”

Minimal startup log:

```text
Application runtime summary:
- app.name                 : case-runtime
- app.version              : 1.42.0
- java.version             : 21.0.x
- jakarta.ee.runtime       : wildfly/openliberty/payara/quarkus/etc
- profile                  : uat
- operational.mode         : normal
- datasource.environment   : uat
- email.provider           : sandbox
- audit.enabled            : true
- mock.login.enabled       : false
- feature.source           : config-service
```

Health/readiness endpoint bisa menampilkan non-secret config summary.

Jangan tampilkan:

- password,
- token,
- private key,
- API key,
- full DSN dengan credential,
- personal data.

Untuk audit, simpan runtime fingerprint:

```text
artifact version
commit sha
profile
config source versions
schema version
feature flag snapshot version
startup timestamp
node/pod identity
```

Ini sangat membantu saat incident.

---

## 24. Deployment Drift

Deployment drift terjadi ketika dua node yang seharusnya sama ternyata running dengan config/profile berbeda.

Contoh:

```text
pod-a app.profile=prod, email.provider=smtp
pod-b app.profile=prod, email.provider=log
```

Atau:

```text
server-1 datasource points to PROD
server-2 datasource points to UAT
```

Ini fatal.

Pencegahan:

1. immutable deployment manifest,
2. config checksum annotation,
3. startup config fingerprint,
4. readiness fails if config invalid,
5. compare config summary across nodes,
6. GitOps or deployment automation,
7. avoid manual admin console changes without audit.

Contoh checksum concept:

```text
config.fingerprint = sha256(non-secret-normalized-config)
```

Expose:

```json
{
  "profile": "prod",
  "operationMode": "normal",
  "configFingerprint": "a81f...",
  "featureSnapshot": "2026-06-16T10:15:00Z"
}
```

---

## 25. Profile and Secrets

Profile sering disalahgunakan untuk menyimpan secret.

Buruk:

```properties
# application-prod.properties
app.db.password=RealProdPassword123
```

Lebih baik:

```properties
# application-prod.properties
app.db.host=prod-db.example.gov
app.db.username=case_app
```

Secret dari runtime:

```text
APP_DB_PASSWORD=<from secret manager>
```

Atau:

```text
/app/prod/case-runtime/db/password
```

Prinsip:

```text
Profile file may define non-secret defaults and references.
Secret source provides secret values.
Application validates presence, not prints value.
```

Secret-specific invariant:

```text
[ ] no production secret in repository
[ ] no secret in startup log
[ ] no secret in exception message
[ ] no secret in health endpoint
[ ] no secret in config dump
[ ] secret rotation path exists
[ ] app handles secret source unavailable predictably
```

---

## 26. Profile in Legacy Java EE / Jakarta EE Server

Dalam legacy app server, profile bisa datang dari:

- JVM system property,
- JNDI env-entry,
- deployment descriptor,
- server resource binding,
- custom config table,
- external property file,
- admin console.

Contoh env-entry:

```xml
<env-entry>
    <env-entry-name>app/profile</env-entry-name>
    <env-entry-type>java.lang.String</env-entry-type>
    <env-entry-value>uat</env-entry-value>
</env-entry>
```

Lookup:

```java
InitialContext ctx = new InitialContext();
String profile = (String) ctx.lookup("java:comp/env/app/profile");
```

Namun untuk modern code, lebih baik bridge ke CDI object:

```java
@ApplicationScoped
public class LegacyProfileProducer {

    @Produces
    @ApplicationScoped
    RuntimeProfile runtimeProfile() {
        try {
            InitialContext ctx = new InitialContext();
            String value = (String) ctx.lookup("java:comp/env/app/profile");
            return new RuntimeProfile(value);
        } catch (NamingException e) {
            throw new IllegalStateException("Cannot resolve app profile from JNDI", e);
        }
    }
}
```

Kemudian consumer tidak perlu tahu JNDI.

Lebih baik lagi jika runtime mendukung MicroProfile Config:

```java
@Inject
@ConfigProperty(name = "app.profile")
String profile;
```

---

## 27. Profile in Cloud-Native Runtime

Dalam container/Kubernetes, profile biasanya externalized.

Deployment manifest:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-runtime
spec:
  template:
    spec:
      containers:
        - name: app
          image: registry.example.gov/case-runtime:1.42.0
          env:
            - name: APP_PROFILE
              value: "uat"
            - name: APP_OPERATION_MODE
              value: "normal"
            - name: APP_NOTIFICATION_PROVIDER
              value: "sandbox"
            - name: APP_AUDIT_ENABLED
              value: "true"
```

Secret:

```yaml
env:
  - name: APP_DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: case-runtime-db
        key: password
```

Prinsip cloud-native:

```text
Same artifact, different configuration.
Config outside image.
Secrets outside image.
Profile explicit in deployment manifest.
Startup validation before readiness.
```

Readiness probe harus gagal jika config invalid, agar pod tidak menerima traffic.

---

## 28. Same Artifact Principle

Ideal enterprise deployment:

```text
Build once, promote same artifact through environments.
```

Contoh:

```text
case-runtime-1.42.0.war
        ↓ deploy to DEV with dev profile
        ↓ deploy to UAT with uat profile
        ↓ deploy to PROD with prod profile
```

Keuntungan:

1. artifact yang diuji sama dengan yang diproduksi,
2. mengurangi “works in UAT but not prod because artifact differs”,
3. audit lebih kuat,
4. rollback lebih jelas.

Yang boleh berbeda:

- configuration,
- secrets,
- resource binding,
- scaling,
- feature flag state.

Yang sebaiknya tidak berbeda:

- compiled code,
- dependency versions,
- packaged classes,
- migration scripts tanpa versioning.

Build variant masih bisa dipakai untuk special case, tetapi harus punya justifikasi kuat.

---

## 29. Case Study: One External API, Banyak Environment

Misalkan ada Address API.

Requirement:

- Local: pakai fake server.
- DEV: pakai sandbox API.
- UAT: pakai sandbox API dengan credential UAT.
- PROD: pakai production API.
- Jika API down, fallback cache boleh dipakai untuk read-only address lookup.

Jangan lakukan:

```java
if (profile.equals("prod")) {
    url = "https://api.real";
} else {
    url = "https://api.sandbox";
}
```

Lakukan:

```properties
app.address.base-url=https://address-sandbox.example.gov
app.address.token-source=secret-manager
app.address.cache.enabled=true
app.address.fallback.enabled=true
```

Profile-specific values:

```properties
# local
app.address.base-url=http://localhost:9080/fake-address
app.address.token-source=none
app.address.cache.enabled=false
app.address.fallback.enabled=false
```

```properties
# prod
app.address.base-url=https://address.example.gov
app.address.token-source=secret-manager
app.address.cache.enabled=true
app.address.fallback.enabled=true
```

Typed config:

```java
@ApplicationScoped
public class AddressApiConfig {
    private final URI baseUrl;
    private final String tokenSource;
    private final boolean cacheEnabled;
    private final boolean fallbackEnabled;

    @Inject
    public AddressApiConfig(
            @ConfigProperty(name = "app.address.base-url") URI baseUrl,
            @ConfigProperty(name = "app.address.token-source") String tokenSource,
            @ConfigProperty(name = "app.address.cache.enabled") boolean cacheEnabled,
            @ConfigProperty(name = "app.address.fallback.enabled") boolean fallbackEnabled) {
        this.baseUrl = baseUrl;
        this.tokenSource = tokenSource;
        this.cacheEnabled = cacheEnabled;
        this.fallbackEnabled = fallbackEnabled;
        validate();
    }

    private void validate() {
        if (!List.of("none", "secret-manager", "static-test-token").contains(tokenSource)) {
            throw new IllegalStateException("Invalid address token source: " + tokenSource);
        }
    }
}
```

For Java 8, replace `List.of` with `Arrays.asList`.

---

## 30. Case Study: Regulatory Workflow Profile Model

Bayangkan sistem case management regulator.

Ada workflow:

```text
Draft → Submitted → Screening → Review → Investigation → Decision → Appeal → Closed
```

Profile tidak boleh mengubah state machine secara diam-diam.

Buruk:

```java
if (profile.isUat()) {
    skipInvestigationStep();
}
```

Lebih defensible:

```properties
workflow.investigation.required=true
workflow.test.shortcut.enabled=false
```

Jika UAT perlu shortcut untuk testing:

```properties
app.profile=uat
workflow.test.shortcut.enabled=true
```

Tetapi enforcement harus eksplisit:

```java
if (workflowConfig.testShortcutEnabled()) {
    audit.record("TEST_WORKFLOW_SHORTCUT_USED", caseId);
}
```

Dan production validator:

```text
if profile=prod:
  workflow.test.shortcut.enabled must be false
```

Untuk regulatory defensibility:

1. profile tidak boleh menjadi hidden exception,
2. setiap shortcut harus audit-able,
3. production invariant harus fail-fast,
4. UAT shortcut tidak boleh masuk production tanpa deteksi,
5. state transition rule harus tetap eksplisit.

---

## 31. Profile and Database Migrations

Profile sering dipakai untuk migration mode.

Contoh:

```properties
app.profile=prod
app.operation.mode=migration
app.db.migration.enabled=true
app.scheduler.enabled=false
```

Tetapi migration mode harus dirancang ketat.

Risiko:

- migration jalan di wrong DB,
- scheduler tetap aktif saat migration,
- application menerima write saat schema berubah,
- multiple node menjalankan migration bersamaan,
- migration profile tertinggal setelah deploy.

Checklist:

```text
[ ] migration target database validated
[ ] migration lock exists
[ ] migration idempotent where possible
[ ] scheduler disabled if required
[ ] write endpoints disabled if required
[ ] only one migration runner active
[ ] migration result audited
[ ] app returns to normal mode explicitly
```

Jangan gunakan profile `prod-migration-v2-final-retry`. Gunakan:

```properties
app.profile=prod
app.operation.mode=migration
migration.plan-id=2026-06-case-index-backfill
```

---

## 32. Anti-Patterns

### 32.1 Hidden Dev Default

```properties
app.profile=dev
```

di base config yang ikut production.

Lebih baik: base config tidak punya default profile. Profile wajib disupply runtime.

### 32.2 Environment String Everywhere

```java
if (env.equals("uat")) { ... }
```

Sebaiknya centralized di `RuntimeProfile`, `OperationalMode`, config object, producer, atau feature service.

### 32.3 Profile as Authorization

```java
if (profile.isProd()) {
    requireAdmin();
}
```

Authorization harus berdasarkan security identity/role/policy, bukan profile.

### 32.4 Profile as Tenant

```text
profile=prod-agency-a
profile=prod-agency-b
```

Pisahkan tenant/agency dari profile.

### 32.5 Profile as Feature Rollout

```text
profile=prod-new-dashboard
```

Gunakan feature flag.

### 32.6 Secret in Profile File

Production secret di repository adalah masalah security dan audit.

### 32.7 Config Without Ownership

Tidak jelas siapa owner property:

```properties
enableNewThing=true
```

Lebih baik:

```properties
feature.case.auto-assignment.enabled=true
```

### 32.8 Profile-Specific Code Branch in Domain Model

Domain model harus stabil. Profile logic berada di boundary runtime, adapter, wiring, atau test harness.

---

## 33. Design Heuristics

Gunakan pertanyaan berikut saat mendesain variasi behavior.

### 33.1 Apakah ini value?

Jika ya, gunakan config.

Contoh:

```text
timeout
base URL
pool size
retention days
```

### 33.2 Apakah ini memilih implementation saat startup?

Gunakan producer, alternative, qualifier, atau runtime-specific conditional bean.

Contoh:

```text
SMTP vs log email sender
real payment vs sandbox payment
real IdP vs mock IdP
```

### 33.3 Apakah ini rollout runtime?

Gunakan feature flag.

Contoh:

```text
new workflow enabled for 10% users
new UI enabled for one agency
kill switch external connector
```

### 33.4 Apakah ini mode operasional?

Gunakan operational mode.

Contoh:

```text
readonly
maintenance
migration
degraded
```

### 33.5 Apakah ini tenant/business variation?

Gunakan tenant config/policy, bukan profile.

### 33.6 Apakah ini benar-benar membutuhkan artifact berbeda?

Gunakan build variant hanya jika ada alasan kuat:

- native image target berbeda,
- platform incompatible,
- legal/compliance packaging berbeda,
- dependency tidak boleh masuk artifact tertentu.

---

## 34. Reference Architecture: Profile Boundary

Struktur yang sehat:

```text
src/main/java
└── com.example.caseapp
    ├── runtime
    │   ├── RuntimeProfile.java
    │   ├── OperationalMode.java
    │   ├── RuntimeSummary.java
    │   └── ProductionSafetyValidator.java
    │
    ├── config
    │   ├── NotificationConfig.java
    │   ├── AddressApiConfig.java
    │   ├── WorkflowConfig.java
    │   └── PersistenceConfig.java
    │
    ├── wiring
    │   ├── EmailSenderProducer.java
    │   ├── PaymentGatewayProducer.java
    │   └── ExternalClientProducer.java
    │
    ├── feature
    │   ├── FeatureFlagService.java
    │   ├── ConfigFeatureFlagService.java
    │   └── FeatureEvaluationContext.java
    │
    ├── application
    │   └── business services without profile branching
    │
    └── domain
        └── pure business model without runtime profile knowledge
```

Dependency direction:

```text
domain           knows nothing about profile
application      depends on abstractions/config contracts
wiring/runtime   knows profile and selects implementations
infrastructure   implements adapters
```

This is the critical mental model:

```text
Profile belongs near the composition/runtime boundary.
It should not leak into core domain logic.
```

---

## 35. Example: Clean Profile-Aware Wiring

### Interface

```java
public interface DocumentStorage {
    StoredDocument save(DocumentContent content);
}
```

### Implementations

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface RealStorage {}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface LocalStorage {}
```

```java
@RealStorage
@ApplicationScoped
public class S3DocumentStorage implements DocumentStorage {
    public StoredDocument save(DocumentContent content) {
        // real object storage
    }
}
```

```java
@LocalStorage
@ApplicationScoped
public class FileSystemDocumentStorage implements DocumentStorage {
    public StoredDocument save(DocumentContent content) {
        // local filesystem
    }
}
```

### Producer

```java
@ApplicationScoped
public class DocumentStorageProducer {

    @Inject RuntimeProfile profile;
    @Inject @RealStorage DocumentStorage realStorage;
    @Inject @LocalStorage DocumentStorage localStorage;

    @Produces
    @ApplicationScoped
    public DocumentStorage documentStorage() {
        if (profile.isLocal() || profile.isTest()) {
            return localStorage;
        }
        return realStorage;
    }
}
```

### Consumer

```java
@ApplicationScoped
public class DocumentService {

    private final DocumentStorage storage;

    @Inject
    public DocumentService(DocumentStorage storage) {
        this.storage = storage;
    }

    public StoredDocument upload(DocumentContent content) {
        return storage.save(content);
    }
}
```

`DocumentService` tetap bersih. Ia tidak peduli profile.

---

## 36. Example: Bad vs Good Profile Check

### Bad

```java
public class CaseSubmissionService {
    public void submit(CaseSubmission submission) {
        if (System.getenv("APP_PROFILE").equals("uat")) {
            // skip notification
        } else {
            notification.send(submission);
        }
    }
}
```

### Better

```properties
case.submission.notification.enabled=false
```

```java
@ApplicationScoped
public class CaseSubmissionConfig {

    private final boolean notificationEnabled;

    @Inject
    public CaseSubmissionConfig(
            @ConfigProperty(name = "case.submission.notification.enabled") boolean notificationEnabled) {
        this.notificationEnabled = notificationEnabled;
    }

    public boolean notificationEnabled() {
        return notificationEnabled;
    }
}
```

```java
@ApplicationScoped
public class CaseSubmissionService {

    @Inject CaseSubmissionConfig config;
    @Inject NotificationService notification;

    public void submit(CaseSubmission submission) {
        // main submission flow

        if (config.notificationEnabled()) {
            notification.send(submission);
        }
    }
}
```

Even better if notification is mandatory in production:

```java
@ApplicationScoped
public class CaseSubmissionProductionValidator {

    @Inject RuntimeProfile profile;
    @Inject CaseSubmissionConfig config;

    @PostConstruct
    void validate() {
        if (profile.isProd() && !config.notificationEnabled()) {
            throw new IllegalStateException("Production requires case submission notification enabled");
        }
    }
}
```

---

## 37. Version Considerations: Java 8 to 25

### Java 8

- No `List.of`, `Set.of`, records, sealed classes.
- Java EE 8 era uses `javax.*`.
- Many app servers run with traditional deployment model.
- Use explicit POJO config classes.
- Be careful with old CDI versions and MicroProfile version support.

### Java 11

- Common modernization baseline.
- Still many Jakarta EE 8/9/10 apps run here depending on server.
- JPMS exists but many enterprise apps still classpath-based.

### Java 17

- Baseline for Jakarta EE 11.
- Strong modern LTS baseline.
- Records can model immutable config snapshots if supported by framework.

### Java 21

- Common modern LTS for enterprise modernization.
- Virtual threads exist, but container/runtime support must be verified.
- Profile/config model remains the same conceptually.

### Java 25

- Modern long-term platform generation.
- Do not assume every Jakarta runtime supports Java 25 immediately.
- Validate app server/runtime certification/support matrix.

Important:

```text
Java language level does not replace runtime configuration discipline.
```

Even with Java 25, bad profile design still causes production incidents.

---

## 38. Review Checklist

Gunakan checklist ini saat review PR/config/deployment.

### Profile Definition

```text
[ ] Active profile is explicit.
[ ] Allowed profile values are documented.
[ ] Missing profile fails startup.
[ ] Unknown profile fails startup.
[ ] Profile is not used as tenant/customer identity.
[ ] Profile is not used as feature rollout mechanism.
```

### Config Safety

```text
[ ] Required config is validated.
[ ] Production forbidden combinations are rejected.
[ ] Secrets are not stored in repo.
[ ] Secrets are not logged.
[ ] Non-secret runtime summary is visible.
[ ] Config source precedence is documented.
```

### Code Structure

```text
[ ] Domain model does not read environment/profile.
[ ] Business services do not contain scattered env string checks.
[ ] Profile-aware logic is centralized in runtime/wiring/config boundary.
[ ] Implementation selection is testable.
[ ] Feature flag logic is separated from profile logic.
```

### Deployment

```text
[ ] Same artifact can be promoted across environments.
[ ] Profile-specific values come from deployment config.
[ ] Config fingerprint can be compared across nodes.
[ ] Readiness fails on invalid config.
[ ] Operational mode is explicit.
```

### Testing

```text
[ ] Profile matrix tested for critical behavior.
[ ] Production safety validator tested.
[ ] Test replacements do not leak into production.
[ ] UAT shortcuts are impossible in production.
[ ] Migration mode has explicit tests.
```

---

## 39. Mental Model Summary

A good profile system is not about having many profiles. It is about having clear boundaries.

```text
Profile selects a runtime configuration set.
Configuration provides values.
Feature flags control rollout decisions.
Operational mode controls emergency/maintenance behavior.
CDI wiring selects implementations.
Domain logic remains clean.
```

The core invariant:

```text
Environment-specific behavior must be explicit, validated, observable, and centralized.
```

Top-level architecture rule:

```text
Do not let environment names leak into business logic.
```

If environment-specific behavior is necessary, represent it as:

- typed config,
- selected implementation,
- operational mode,
- feature flag,
- or explicit policy.

Do not hide it behind scattered profile string checks.

---

## 40. What Comes Next

Part ini membangun dasar profile dan environment-specific behavior.

Part berikutnya masuk ke:

```text
Part 028 — Feature Flags: Runtime Decisioning, Risk Control, and Progressive Delivery
```

Di part berikutnya kita akan membahas feature flag secara jauh lebih dalam:

- release flag,
- ops flag,
- experiment flag,
- permission flag,
- kill switch,
- targeting,
- rollout,
- flag debt,
- auditability,
- consistency,
- cache/TTL,
- CDI integration,
- interceptor/decorator-based feature gate,
- dan failure-mode design.

---

## References

[^mp-config]: Eclipse MicroProfile Config specification 3.1, which defines a flexible application configuration system and an SPI for extension. See MicroProfile Config specification and Eclipse download page.
[^quarkus-config]: Quarkus Configuration Reference Guide, which describes Quarkus configuration through SmallRye Config, an implementation based on MicroProfile Config.
[^openliberty-config]: Open Liberty MicroProfile Config documentation, which describes MicroProfile Config as an API that uses CDI to inject configuration property values.
[^helidon-config]: Helidon MP Config documentation, which describes support for MicroProfile Config sources, API, custom `ConfigSource`, and converters.

