# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-006

# Part 006 — Configuration Architecture: SmallRye Config, Profiles, Secrets, Runtime vs Build-Time Properties

> Seri: **learn-java-quarkus-runtime-cloud-native-native-image-engineering**  
> Level: Advanced / top 1% software engineer track  
> Fokus: Quarkus configuration as architecture, bukan sekadar membaca property  
> Status: Part 006 dari maksimal 35 part

---

## 0. Tujuan Part Ini

Di banyak aplikasi Java, konfigurasi sering diperlakukan sebagai hal kecil:

```properties
server.port=8080
datasource.url=...
feature.enabled=true
```

Di Quarkus, cara berpikir seperti itu kurang cukup.

Quarkus adalah framework yang melakukan banyak keputusan saat **build time**. Artinya, sebagian konfigurasi tidak sekadar dibaca saat aplikasi berjalan, tetapi ikut menentukan bentuk aplikasi yang dibangun: extension mana aktif, bean mana tersedia, resource mana masuk native image, datasource mana dibangun, fitur mana diinisialisasi, dan sebagainya.

Part ini bertujuan membangun mental model configuration architecture Quarkus secara dalam:

1. Memahami konfigurasi sebagai **contract antara source code, build artifact, deployment environment, dan runtime behavior**.
2. Membedakan **build-time fixed config** dan **runtime overridable config**.
3. Memahami SmallRye Config sebagai engine konfigurasi Quarkus.
4. Mendesain profile dev/test/prod tanpa menciptakan environment drift.
5. Menggunakan type-safe configuration via `@ConfigMapping`.
6. Mengelola secret dengan aman.
7. Menghindari anti-pattern konfigurasi yang sering membuat sistem sulit di-debug.
8. Membuat configuration governance untuk sistem enterprise/microservices.

---

## 1. Core Mental Model: Configuration Is Part of the Runtime Contract

Dalam aplikasi biasa, konfigurasi sering dianggap sebagai data eksternal.

Dalam Quarkus, konfigurasi adalah bagian dari **runtime contract**.

Kontrak itu melibatkan empat sisi:

```text
Source Code
   |
   | uses config keys, config mappings, extension config
   v
Build Process
   |
   | locks build-time properties, runs augmentation, generates metadata
   v
Artifact / Image
   |
   | contains decisions already frozen at build time
   v
Runtime Environment
   |
   | supplies runtime-overridable values: URL, credentials, toggles, limits
   v
Application Behavior
```

Konsekuensinya:

- Tidak semua konfigurasi aman diubah setelah artifact dibuat.
- Tidak semua environment variable akan memberi efek jika property tersebut build-time fixed.
- Native image memperkuat batas ini karena aplikasi sudah dikompilasi ahead-of-time.
- CI/CD harus tahu mana konfigurasi yang menjadi bagian dari build dan mana yang boleh diinjeksi saat deploy.

Inilah perbedaan besar dibanding banyak runtime Java klasik.

---

## 2. Quarkus Configuration Stack

Quarkus menggunakan **SmallRye Config**, implementasi dari MicroProfile Config, sebagai fondasi konfigurasi.

Secara konseptual:

```text
Application Code
   |
   | @ConfigProperty / @ConfigMapping / ConfigProvider
   v
Quarkus Config Layer
   |
   | profiles, expressions, converters, interceptors, sources
   v
SmallRye Config
   |
   | resolution, conversion, source priority
   v
Config Sources
   |
   | application.properties
   | application.yaml
   | system properties
   | environment variables
   | .env file
   | Kubernetes ConfigMap/Secret
   | Vault / credentials provider
   | custom source
```

Quarkus sendiri dan extension-nya juga menggunakan mekanisme config yang sama. Jadi config bukan hanya untuk aplikasi kita, tetapi juga untuk framework behavior.

Contoh:

```properties
quarkus.http.port=8080
quarkus.datasource.db-kind=postgresql
quarkus.datasource.jdbc.url=jdbc:postgresql://localhost:5432/app
quarkus.hibernate-orm.database.generation=validate
quarkus.log.console.json=true
```

Config tersebut bukan sekadar variable. Ia mengubah bagaimana Quarkus membangun dan menjalankan subsystem HTTP, datasource, Hibernate ORM, dan logging.

---

## 3. The Most Important Distinction: Build-Time vs Runtime Configuration

Ini fondasi utama part ini.

Quarkus membagi configuration menjadi dua kategori besar:

## 3.1 Build-Time Fixed Configuration

Build-time fixed config adalah config yang nilainya dikunci saat build.

Jika nilainya berubah setelah build, aplikasi tidak otomatis berubah perilakunya. Untuk perubahan berlaku, aplikasi harus di-build ulang.

Contoh jenis konfigurasi yang sering build-time fixed:

- Extension enablement.
- Bean discovery behavior.
- Native image behavior.
- Datasource kind tertentu.
- Hibernate ORM structural configuration.
- Feature yang mempengaruhi augmentation.
- Classloading/build behavior.

Secara mental:

```text
Build-time config = memengaruhi bentuk aplikasi
```

Contoh konseptual:

```properties
quarkus.datasource.db-kind=postgresql
```

`db-kind` bisa mempengaruhi driver, dialect, extension behavior, dan build-time setup. Mengubahnya dari `postgresql` ke `oracle` di runtime bukan sekadar mengganti string. Itu mengubah asumsi aplikasi.

## 3.2 Runtime Overridable Configuration

Runtime config dapat diubah saat aplikasi dijalankan tanpa rebuild.

Contoh umum:

```properties
quarkus.http.port=8080
quarkus.datasource.jdbc.url=jdbc:postgresql://db-prod:5432/app
quarkus.datasource.username=app_user
quarkus.datasource.password=${DB_PASSWORD}
myapp.external-api.timeout=3s
myapp.feature.new-flow-enabled=false
```

Secara mental:

```text
Runtime config = memengaruhi parameter operasi aplikasi
```

## 3.3 Kesalahan Fatal yang Sering Terjadi

Kesalahan umum:

> “Kita ubah environment variable saja di deployment, harusnya behavior berubah.”

Belum tentu.

Kalau property itu build-time fixed, perubahan env var tidak akan memberi efek seperti yang diharapkan.

Akibatnya:

- deployment terlihat sukses,
- env var terlihat benar,
- log config bisa membingungkan,
- tetapi behavior aplikasi tetap lama.

Untuk engineer top-tier, pertanyaan pertama saat config tidak bekerja bukan:

> “Kenapa env var tidak kebaca?”

Tetapi:

> “Property ini runtime-overridable atau build-time fixed?”

---

## 4. Configuration as a Four-Layer Decision

Setiap config harus diklasifikasikan berdasarkan empat pertanyaan.

```text
1. Siapa pemilik nilainya?
2. Kapan nilai itu dibekukan?
3. Apa dampaknya kalau salah?
4. Bagaimana nilai itu diaudit/debug?
```

Mari kita buat modelnya.

| Jenis Config | Contoh | Owner | Waktu Diputuskan | Risiko Salah |
|---|---|---:|---:|---|
| Build structure | extension, db-kind, native setting | Engineering/platform | Build time | artifact salah |
| Runtime connection | DB URL, external API URL | DevOps/platform | Deploy time | tidak bisa connect |
| Secret | password, client secret, token | Security/platform | Deploy/runtime | breach |
| Feature behavior | toggle, limit, timeout | App team/product/platform | Runtime | behavior salah |
| Operational tuning | pool size, timeout, log level | App/platform/SRE | Runtime/deploy | latency/error |
| Domain policy | SLA threshold, escalation day | Business/domain owner | Runtime/config DB | keputusan bisnis salah |

Quarkus config cocok untuk kategori teknis-operasional. Namun untuk domain policy yang sering berubah, perlu hati-hati.

Jangan semua domain rule dipaksa menjadi `application.properties`.

Untuk sistem kompleks seperti enforcement lifecycle, escalation, case management, regulatory workflow, beberapa policy lebih cocok di:

- database reference table,
- rules table,
- workflow definition,
- external policy registry,
- admin-configurable setting dengan audit trail.

---

## 5. Config Sources and Resolution Order

SmallRye Config membaca nilai dari banyak sumber.

Sumber umum:

1. `application.properties`
2. `application.yaml`
3. environment variables
4. Java system properties
5. `.env`
6. profile-specific values
7. Kubernetes ConfigMap/Secret
8. Vault/credentials provider
9. custom config source

Mental model:

```text
Many sources -> one resolved value
```

Yang penting bukan hanya “ada value”, tetapi:

- value datang dari mana,
- source mana yang menang,
- apakah profile aktif mengubah value,
- apakah expression berhasil dievaluasi,
- apakah converter berhasil mengubah tipe,
- apakah property unknown/typo diam-diam tidak dipakai,
- apakah config build-time sudah terkunci.

Contoh problem:

```properties
myapp.external-api.timeout=3s
```

Lalu di Kubernetes:

```yaml
env:
  - name: MYAPP_EXTERNAL_API_TIMOUT
    value: "5s"
```

Ada typo: `TIMOUT`, bukan `TIMEOUT`.

Aplikasi tetap memakai `3s`.

Engineer biasa melihat ini sebagai “config tidak berubah”.

Engineer senior melihatnya sebagai:

- missing config validation,
- lack of startup config report,
- no test for env mapping,
- no deployment contract verification.

---

## 6. Environment Variable Mapping

Quarkus mendukung mapping dari property key ke environment variable.

Contoh property:

```properties
myapp.external-api.base-url=https://api.example.com
```

Environment variable biasanya berbentuk:

```text
MYAPP_EXTERNAL_API_BASE_URL=https://api.example.com
```

Titik dan dash dikonversi menjadi underscore dan uppercase.

Namun ada edge case:

- quoted property name,
- map key dinamis,
- indexed property,
- property dengan karakter khusus,
- datasource named config,
- extension config yang kompleks.

Contoh named datasource:

```properties
quarkus.datasource.orders.db-kind=postgresql
quarkus.datasource.orders.jdbc.url=jdbc:postgresql://localhost/orders
```

Env var bisa menjadi lebih sulit dibaca:

```text
QUARKUS_DATASOURCE_ORDERS_DB_KIND=postgresql
QUARKUS_DATASOURCE_ORDERS_JDBC_URL=jdbc:postgresql://db/orders
```

Untuk deployment enterprise, jangan hanya mengandalkan hafalan mapping. Buat **configuration contract** eksplisit.

Contoh:

```text
Required runtime env:
- QUARKUS_DATASOURCE_JDBC_URL
- QUARKUS_DATASOURCE_USERNAME
- QUARKUS_DATASOURCE_PASSWORD
- MYAPP_EXTERNAL_CASE_API_BASE_URL
- MYAPP_EXTERNAL_CASE_API_TIMEOUT
- MYAPP_SECURITY_ALLOWED_ISSUER
```

---

## 7. `@ConfigProperty`: Simple Injection

Cara paling sederhana:

```java
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Duration;
import java.util.Optional;

@ApplicationScoped
public class ExternalCaseClientConfig {

    @ConfigProperty(name = "case-api.base-url")
    String baseUrl;

    @ConfigProperty(name = "case-api.timeout", defaultValue = "3s")
    Duration timeout;

    @ConfigProperty(name = "case-api.audit-prefix")
    Optional<String> auditPrefix;
}
```

Ini cocok untuk sedikit property.

Kelebihan:

- cepat,
- familiar,
- mudah dipakai.

Kekurangan:

- property tersebar,
- tidak ada grouping kuat,
- sulit melihat contract config satu subsystem,
- rentan typo,
- kurang cocok untuk domain config yang besar.

Rule of thumb:

```text
1-3 property lokal -> @ConfigProperty masih oke
subsystem config -> gunakan @ConfigMapping
```

---

## 8. `@ConfigMapping`: Type-Safe Configuration Contract

Untuk sistem serius, gunakan config mapping.

Contoh:

```java
import io.smallrye.config.ConfigMapping;

import java.net.URI;
import java.time.Duration;
import java.util.Optional;

@ConfigMapping(prefix = "app.case-api")
public interface CaseApiConfig {

    URI baseUrl();

    Duration connectTimeout();

    Duration readTimeout();

    Retry retry();

    Optional<String> auditPrefix();

    interface Retry {
        int maxAttempts();
        Duration initialBackoff();
        Duration maxBackoff();
    }
}
```

Properties:

```properties
app.case-api.base-url=https://case-api.internal
app.case-api.connect-timeout=500ms
app.case-api.read-timeout=3s
app.case-api.retry.max-attempts=3
app.case-api.retry.initial-backoff=250ms
app.case-api.retry.max-backoff=2s
app.case-api.audit-prefix=Internet
```

Usage:

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CaseApiClientFactory {

    private final CaseApiConfig config;

    public CaseApiClientFactory(CaseApiConfig config) {
        this.config = config;
    }

    public String describe() {
        return "Case API at " + config.baseUrl();
    }
}
```

## 8.1 Kenapa `@ConfigMapping` Lebih Baik untuk Architecture

Karena ia membuat konfigurasi menjadi interface kontrak.

```text
Config key scattered across code
        vs
Config contract grouped by subsystem
```

Manfaat:

- Lebih mudah direview.
- Lebih mudah dites.
- Lebih mudah didokumentasikan.
- Startup fail-fast jika required value tidak ada.
- Tipe jelas: `Duration`, `URI`, `int`, `boolean`, enum.
- Mengurangi typo.
- Cocok untuk platform governance.

## 8.2 Required vs Optional

Dalam `@ConfigMapping`, method non-optional biasanya required.

```java
URI baseUrl(); // required
Optional<String> auditPrefix(); // optional
```

Ini bagus untuk fail-fast.

Jangan terlalu banyak memberi default.

Default yang salah sering lebih berbahaya daripada startup failure.

Contoh buruk:

```java
@WithDefault("http://localhost:8080")
URI baseUrl();
```

Di production, jika env var lupa diset, aplikasi diam-diam call localhost.

Lebih baik fail saat startup.

---

## 9. Default Values: Useful but Dangerous

Default value berguna untuk:

- dev mode,
- optional local feature,
- safe operational default,
- bounded numeric value,
- fallback yang tidak merusak data.

Default value berbahaya untuk:

- external API URL,
- database URL,
- credentials,
- issuer/audience security,
- feature yang mengubah data,
- production behavior sensitif.

Contoh default yang relatif aman:

```properties
app.case-api.connect-timeout=500ms
app.case-api.read-timeout=3s
app.case-api.retry.max-attempts=3
```

Contoh default yang berbahaya:

```properties
app.payment.enabled=true
app.oidc.issuer=https://dev-idp.local
app.case-api.base-url=http://localhost:8080
```

Prinsip:

```text
Default boleh untuk tuning yang aman.
Default jangan untuk identity, secret, endpoint kritis, atau behavior irreversible.
```

---

## 10. Profiles: `%dev`, `%test`, `%prod`, and Custom Profiles

Quarkus mendukung profile-specific configuration.

Contoh:

```properties
app.case-api.read-timeout=3s

%dev.app.case-api.base-url=http://localhost:9001
%test.app.case-api.base-url=http://localhost:19001
%prod.app.case-api.base-url=https://case-api.internal
```

Mental model:

```text
Base config = common invariant
Profile config = environment-specific override
```

## 10.1 Jangan Jadikan Profile Sebagai Tempat Menyembunyikan Arsitektur

Profile bagus untuk perbedaan environment.

Profile buruk jika dipakai untuk menyembunyikan perbedaan desain.

Contoh buruk:

```properties
%dev.app.persistence.mode=in-memory
%test.app.persistence.mode=h2
%prod.app.persistence.mode=oracle
```

Ini bisa membuat dev/test tidak merepresentasikan production.

Lebih baik:

```properties
# all env use same database family if possible
app.persistence.mode=relational

%dev.quarkus.datasource.db-kind=postgresql
%test.quarkus.datasource.db-kind=postgresql
%prod.quarkus.datasource.db-kind=postgresql
```

Kalau production Oracle, test serius juga harus punya Oracle-compatible path, minimal integration test profile khusus.

## 10.2 Profile Explosion

Anti-pattern:

```properties
%dev...
%test...
%uat...
%sit...
%staging...
%prod...
%prod-dr...
%client-a...
%client-b...
%client-c...
```

Semakin banyak profile, semakin sulit memastikan behavior.

Gunakan profile untuk kategori runtime besar:

- dev,
- test,
- prod,
- native-test bila perlu.

Untuk variasi tenant/client/environment, lebih baik gunakan:

- env var,
- ConfigMap,
- deployment overlay,
- Helm/Kustomize,
- external config service,
- database configuration dengan audit.

---

## 11. Profile Parent and Profile Composition

Dalam sistem besar, kadang ada common production-like config.

Misal:

```properties
%prod.quarkus.log.console.json=true
%prod.quarkus.hibernate-orm.database.generation=validate

%uat.quarkus.log.console.json=true
%uat.quarkus.hibernate-orm.database.generation=validate
```

Duplikasi seperti ini bisa membesar.

Strategi yang lebih baik:

```text
Base config: production-safe defaults
Dev profile: relax only what must be relaxed
Test profile: deterministic overrides
Prod env: inject endpoint/secret/pool/tuning externally
```

Dengan kata lain:

```text
Jangan jadikan prod profile sebagai satu-satunya tempat safety.
Jadikan base config production-safe, lalu dev yang override untuk kenyamanan lokal.
```

Contoh:

```properties
# base: safe for production
quarkus.hibernate-orm.database.generation=validate
quarkus.log.console.json=true
app.dangerous-reset-enabled=false

# dev: relaxed for local
%dev.quarkus.hibernate-orm.database.generation=drop-and-create
%dev.quarkus.log.console.json=false
%dev.app.dangerous-reset-enabled=true
```

Ini jauh lebih aman daripada:

```properties
# dangerous base
quarkus.hibernate-orm.database.generation=drop-and-create

# only prod fixes it
%prod.quarkus.hibernate-orm.database.generation=validate
```

Karena jika profile production lupa aktif, data bisa rusak.

---

## 12. Build-Time Config and Profiles: Hidden Trap

Build-time config plus profile bisa membingungkan.

Contoh:

```properties
%dev.quarkus.datasource.db-kind=h2
%prod.quarkus.datasource.db-kind=postgresql
```

Jika `db-kind` termasuk build-time significant untuk scenario tersebut, maka artifact yang dibangun dengan satu profile tidak otomatis menjadi artifact profile lain.

Dalam CI/CD, harus jelas:

```text
Build profile apa?
Runtime profile apa?
Artifact dipakai ulang lintas environment atau per environment?
```

Dua strategi:

## 12.1 Build Once, Deploy Many

Artifact sama dipakai untuk dev/staging/prod.

Konsekuensi:

- build-time config harus environment-neutral,
- runtime env menyuplai URL/credential/tuning,
- tidak boleh ada build-time property yang berbeda antar environment.

Cocok untuk governance kuat.

## 12.2 Build Per Environment

Artifact dibangun berbeda untuk environment berbeda.

Konsekuensi:

- lebih fleksibel,
- tetapi traceability lebih rumit,
- binary yang dites di staging tidak identik dengan production,
- perlu artifact provenance kuat.

Untuk enterprise regulated systems, biasanya lebih defensible:

```text
Build once -> promote same artifact -> inject runtime config per environment
```

Namun ini hanya aman jika build-time config tidak environment-specific.

---

## 13. Configuration Expressions

Quarkus/SmallRye Config mendukung ekspresi property.

Contoh:

```properties
app.host=case-api.internal
app.scheme=https
app.case-api.base-url=${app.scheme}://${app.host}
```

Atau dengan fallback:

```properties
app.case-api.timeout=${CASE_API_TIMEOUT:3s}
```

Manfaat:

- mengurangi duplikasi,
- membuat derived values,
- fallback sederhana.

Risiko:

- resolusi jadi tidak transparan,
- nested expression sulit dilacak,
- fallback bisa menyembunyikan misconfiguration,
- secret bisa tidak sengaja tercetak jika diekspansi di log.

Prinsip:

```text
Gunakan expression untuk composition sederhana.
Jangan gunakan expression sebagai mini programming language.
```

---

## 14. Type Conversion

SmallRye Config dapat mengubah string menjadi tipe Java.

Contoh tipe:

- `String`
- `int`, `long`, `boolean`
- `Duration`
- `URI`, `URL`
- `Optional<T>`
- enum
- list/set/map dalam bentuk tertentu
- custom converter

Contoh:

```java
@ConfigMapping(prefix = "app.worker")
public interface WorkerConfig {
    int poolSize();
    Duration leaseTimeout();
    Mode mode();

    enum Mode {
        STRICT,
        BEST_EFFORT
    }
}
```

Properties:

```properties
app.worker.pool-size=16
app.worker.lease-timeout=30s
app.worker.mode=STRICT
```

Fail-fast conversion sangat berharga.

Jika property salah:

```properties
app.worker.pool-size=sixteen
```

Aplikasi gagal start.

Ini bagus.

Aplikasi yang gagal start karena config invalid lebih baik daripada aplikasi yang berjalan dengan asumsi salah.

---

## 15. Custom Converter

Kadang config domain-specific butuh tipe sendiri.

Contoh value:

```properties
app.case-priority.threshold=P1:5m,P2:30m,P3:2h
```

Bisa dibuat converter, tetapi hati-hati.

Custom converter cocok untuk:

- value format stabil,
- dipakai berulang,
- validasi kuat,
- bukan domain rule yang sering berubah.

Contoh sederhana:

```java
public record RateLimit(int permits, java.time.Duration window) {
}
```

Property:

```properties
app.api.rate-limit=300/1m
```

Converter konseptual:

```java
import org.eclipse.microprofile.config.spi.Converter;

import java.time.Duration;

public class RateLimitConverter implements Converter<RateLimit> {
    @Override
    public RateLimit convert(String value) {
        String[] parts = value.split("/");
        if (parts.length != 2) {
            throw new IllegalArgumentException("Invalid rate limit: " + value);
        }
        return new RateLimit(Integer.parseInt(parts[0]), parseDuration(parts[1]));
    }

    private Duration parseDuration(String text) {
        if (text.endsWith("m")) {
            return Duration.ofMinutes(Long.parseLong(text.substring(0, text.length() - 1)));
        }
        if (text.endsWith("s")) {
            return Duration.ofSeconds(Long.parseLong(text.substring(0, text.length() - 1)));
        }
        throw new IllegalArgumentException("Unsupported duration: " + text);
    }
}
```

Tapi jangan berlebihan.

Jika format makin kompleks, mungkin config seharusnya menjadi structured database/rules table, bukan property string.

---

## 16. Secrets: Jangan Samakan Secret dengan Config Biasa

Secret adalah konfigurasi dengan risiko keamanan.

Contoh:

- database password,
- OIDC client secret,
- private key,
- API token,
- signing secret,
- encryption key,
- webhook secret.

Secret punya lifecycle berbeda:

```text
create -> distribute -> consume -> rotate -> revoke -> audit
```

Bukan sekadar:

```text
put in application.properties
```

## 16.1 Anti-Pattern Secret

Anti-pattern serius:

```properties
quarkus.datasource.password=prod-password-123
```

Masalah:

- masuk Git history,
- masuk artifact,
- bisa muncul di logs/config dump,
- sulit rotate,
- melanggar governance.

## 16.2 Better Secret Sources

Pilihan lebih baik:

- environment variable dari secret manager,
- Kubernetes Secret,
- Vault,
- AWS Secrets Manager,
- AWS SSM Parameter Store SecureString,
- Quarkus credentials provider,
- encrypted config value via secret handler.

Contoh env var:

```text
QUARKUS_DATASOURCE_PASSWORD=...
QUARKUS_OIDC_CREDENTIALS_SECRET=...
```

Contoh property reference:

```properties
quarkus.datasource.password=${DB_PASSWORD}
```

Ini masih harus hati-hati: nilai akhirnya tetap secret. Jangan log resolved config.

## 16.3 Secret Rotation

Pertanyaan penting:

```text
Jika secret berubah, apakah aplikasi perlu restart?
```

Banyak aplikasi membaca secret saat startup. Jika password DB berubah, connection pool lama bisa gagal.

Strategi:

- restart rolling deployment setelah secret update,
- dual credential period,
- database user rotation dengan overlap,
- token refresh mechanism,
- external API credential provider,
- connection pool recycle.

Untuk production, secret rotation harus didesain, bukan diasumsikan.

---

## 17. Encrypted Configuration Values

Quarkus menyediakan mekanisme secret keys handler untuk encrypted config value.

Contoh bentuk konseptual:

```properties
my.secret=${aes-gcm-nopadding::encrypted-value-here}
```

Manfaat:

- secret tidak plaintext di config file,
- bisa berguna untuk deployment tertentu.

Tetapi ini bukan silver bullet.

Pertanyaan tetap:

- key decrypt disimpan di mana?
- siapa punya akses?
- bagaimana rotasi?
- apakah value resolved pernah tercetak?
- apakah lebih baik memakai secret manager?

Prinsip:

```text
Encrypted config mengurangi exposure plaintext config.
Secret manager tetap lebih baik untuk lifecycle secret serius.
```

---

## 18. Credentials Provider

Quarkus punya konsep credentials provider untuk beberapa integration.

Mental model:

```text
Application asks for credentials by name
Provider resolves credentials from secure backend
```

Ini membantu memisahkan:

- config non-secret,
- secret retrieval,
- rotation behavior,
- backend-specific integration.

Contoh use case:

```properties
quarkus.datasource.credentials-provider=my-db-credentials
```

Lalu provider mengambil username/password dari Vault atau sumber lain.

Keuntungan:

- secret tidak tersebar di config biasa,
- retrieval bisa distandardisasi,
- extension bisa terintegrasi dengan source secret.

Risiko:

- provider failure saat startup,
- latency secret backend,
- retry behavior,
- fallback yang tidak aman,
- permission backend terlalu luas.

---

## 19. Kubernetes ConfigMap and Secret Integration

Di Kubernetes, config biasanya masuk melalui:

1. env var,
2. mounted files,
3. ConfigMap,
4. Secret,
5. external secret operator,
6. cloud secret manager integration.

Quarkus juga memiliki extension `kubernetes-config` yang dapat menjadikan Kubernetes ConfigMap/Secret sebagai config source.

Namun keputusan desainnya harus hati-hati.

## 19.1 Env Var Approach

Contoh:

```yaml
env:
  - name: APP_CASE_API_BASE_URL
    valueFrom:
      configMapKeyRef:
        name: case-service-config
        key: caseApiBaseUrl
  - name: QUARKUS_DATASOURCE_PASSWORD
    valueFrom:
      secretKeyRef:
        name: case-service-secret
        key: dbPassword
```

Kelebihan:

- eksplisit,
- mudah dilihat di deployment manifest,
- umum dipakai,
- predictable.

Kekurangan:

- banyak env var,
- perubahan biasanya butuh restart pod,
- secret bisa terlihat oleh pihak yang punya akses inspect pod spec.

## 19.2 Mounted File Approach

Kelebihan:

- cocok untuk certificate/key file,
- bisa update volume oleh Kubernetes,
- struktur lebih natural untuk banyak file.

Kekurangan:

- aplikasi harus membaca file,
- reload tidak otomatis kecuali didesain,
- path management.

## 19.3 Kubernetes Config Source Extension

Kelebihan:

- Quarkus bisa membaca ConfigMap/Secret sebagai config source,
- tidak perlu semua dimount sebagai env var,
- lebih terintegrasi.

Kekurangan:

- aplikasi perlu akses Kubernetes API,
- RBAC harus hati-hati,
- startup bergantung API server,
- potensi coupling lebih kuat ke Kubernetes.

Untuk banyak enterprise deployment, env var + Secret/ConfigMap masih paling predictable.

---

## 20. `.env` File: Useful for Local, Dangerous for Discipline

Quarkus dapat membaca `.env` untuk local development.

Contoh:

```text
APP_CASE_API_BASE_URL=http://localhost:9001
DB_PASSWORD=local-password
```

Kelebihan:

- mudah untuk developer,
- tidak perlu export env manual,
- local setup cepat.

Risiko:

- `.env` tidak sengaja commit,
- local behavior terlalu berbeda dari dev/test/prod,
- developer punya value stale,
- secret tersebar di laptop.

Prinsip:

```text
.env boleh untuk local convenience.
.env bukan governance mechanism.
```

Tambahkan ke `.gitignore`:

```gitignore
.env
.env.*
!.env.example
```

Buat `.env.example` tanpa secret:

```text
APP_CASE_API_BASE_URL=http://localhost:9001
DB_PASSWORD=<set-locally>
```

---

## 21. YAML vs Properties

Quarkus mendukung `application.properties` dan `application.yaml` melalui extension config YAML.

Properties:

```properties
app.case-api.base-url=https://case-api.internal
app.case-api.retry.max-attempts=3
```

YAML:

```yaml
app:
  case-api:
    base-url: https://case-api.internal
    retry:
      max-attempts: 3
```

## 21.1 Properties Kelebihan

- simple,
- dekat dengan dokumentasi Quarkus,
- mudah override,
- mudah grep,
- cocok untuk flat config.

## 21.2 YAML Kelebihan

- lebih rapi untuk nested config,
- cocok untuk config mapping yang kompleks,
- familiar di Kubernetes ecosystem.

## 21.3 YAML Risiko

- indentation error,
- quoting issue,
- boolean/string ambiguity,
- harder line-based diff untuk beberapa kasus.

Prinsip:

```text
Gunakan properties untuk Quarkus core config yang umum.
Gunakan YAML hanya jika struktur nested besar benar-benar lebih terbaca.
Jangan campur tanpa alasan kuat.
```

---

## 22. Feature Flags vs Configuration

Feature flag sering diletakkan di config.

Contoh:

```properties
app.feature.new-case-routing-enabled=false
```

Ini baik untuk toggle sederhana.

Namun feature flag production-grade memiliki masalah tambahan:

- per user,
- per role,
- per tenant,
- gradual rollout,
- kill switch,
- audit,
- expiry date,
- owner,
- dependency antar flag,
- consistency across nodes.

Jika kebutuhan hanya:

```text
Enable/disable feature globally per deployment
```

Quarkus config cukup.

Jika kebutuhan:

```text
Enable for 5% users, tenant A only, rollback instantly, audited
```

Maka gunakan feature flag service atau database-backed feature management.

Anti-pattern:

```properties
app.feature.temporary-fix-enabled=true
```

lalu lupa bertahun-tahun.

Setiap flag perlu metadata:

```text
name: new-case-routing-enabled
owner: case-platform-team
created: 2026-06-20
expiry: 2026-08-01
safe default: false
rollback behavior: disable routing v2
observability: metric case.routing.version
```

---

## 23. Operational Tuning Config

Config seperti ini sering berubah:

```properties
app.worker.pool-size=16
app.worker.queue-capacity=1000
app.external-api.timeout=3s
app.external-api.retry.max-attempts=3
app.rate-limit.permits-per-minute=300
```

Tuning config harus punya batas aman.

Contoh validasi manual:

```java
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class WorkerConfigValidator {

    private final WorkerConfig config;

    public WorkerConfigValidator(WorkerConfig config) {
        this.config = config;
    }

    @PostConstruct
    void validate() {
        if (config.poolSize() < 1 || config.poolSize() > 128) {
            throw new IllegalStateException("app.worker.pool-size must be between 1 and 128");
        }
        if (config.queueCapacity() < config.poolSize()) {
            throw new IllegalStateException("queue capacity must be >= pool size");
        }
    }
}
```

Top-tier thinking:

```text
Config is input. Input must be validated.
```

Jangan percaya karena config datang dari internal deployment.

Internal misconfiguration tetap bisa menjatuhkan sistem.

---

## 24. Config Validation Strategy

Ada tiga level validasi.

## 24.1 Type Validation

Dilakukan oleh converter.

```properties
app.timeout=abc
```

Jika field `Duration`, aplikasi gagal start.

## 24.2 Structural Validation

Dilakukan oleh required config mapping.

```java
URI baseUrl(); // missing -> startup failure
```

## 24.3 Semantic Validation

Harus dibuat oleh aplikasi.

Contoh:

```text
readTimeout must be greater than connectTimeout
maxAttempts must be >= 1 and <= 5
rateLimit must be below vendor limit
cacheTtl must be less than token expiry
```

Contoh:

```java
@PostConstruct
void validate() {
    if (config.readTimeout().compareTo(config.connectTimeout()) < 0) {
        throw new IllegalStateException("read timeout must be >= connect timeout");
    }
    if (config.retry().maxAttempts() > 5) {
        throw new IllegalStateException("retry max attempts too high");
    }
}
```

Inilah perbedaan antara config yang “bisa dibaca” dan config yang “aman dipakai”.

---

## 25. Startup Configuration Report

Untuk production, aplikasi sebaiknya memberi startup report yang aman.

Contoh log:

```text
Configuration summary:
- app.profile=prod
- app.case-api.base-url=https://case-api.internal
- app.case-api.connect-timeout=500ms
- app.case-api.read-timeout=3s
- app.case-api.retry.max-attempts=3
- app.feature.new-routing=false
- quarkus.datasource.db-kind=postgresql
- quarkus.datasource.jdbc.url=<masked host=db-prod:5432/db>
- quarkus.datasource.password=<masked>
```

Jangan log secret.

Jangan log full token.

Masking strategy:

```text
password -> <masked>
token -> <masked sha256-prefix=... optional>
URL -> mask username/password, maybe show host/db
client secret -> <masked>
private key -> never log
```

Startup report membantu incident response.

Saat terjadi issue, tim bisa cepat menjawab:

- profile apa aktif,
- endpoint mana dipakai,
- timeout berapa,
- retry berapa,
- feature flag mana aktif,
- datasource mana aktif.

---

## 26. Config Drift

Config drift terjadi saat environment berbeda tanpa disengaja.

Contoh:

| Config | DEV | UAT | PROD |
|---|---:|---:|---:|
| `app.retry.max-attempts` | 1 | 3 | 5 |
| `app.timeout` | 10s | 3s | 1s |
| `app.feature.v2` | true | true | false |
| `quarkus.hibernate-orm.database.generation` | drop-and-create | update | validate |

Beberapa perbedaan wajar.

Namun drift berbahaya jika:

- tidak terdokumentasi,
- tidak diaudit,
- tidak dites,
- tidak diketahui saat incident.

## 26.1 Config Drift Control

Praktik baik:

1. Buat config inventory.
2. Klasifikasikan build-time/runtime/secret/domain/ops.
3. Buat default production-safe.
4. Buat env overlay minimal.
5. Diff config antar environment.
6. Validasi required config di startup.
7. Mask secret saat reporting.
8. Review config saat release.
9. Buat ownership per config group.

---

## 27. Configuration Inventory Template

Untuk service serius, buat file seperti:

```markdown
# Configuration Inventory — case-service

## Build-time properties

| Key | Owner | Default | Allowed Values | Reason | Rebuild Required |
|---|---|---:|---|---|---:|
| quarkus.datasource.db-kind | platform | postgresql | postgresql | JDBC dialect/driver | yes |

## Runtime properties

| Key | Owner | Required | Example | Safe Default | Notes |
|---|---|---:|---|---|---|
| app.case-api.base-url | integration | yes | https://case-api.internal | none | fail-fast if missing |
| app.case-api.read-timeout | app | yes | 3s | 3s | must be >= connect timeout |

## Secrets

| Key | Source | Rotation | Consumer | Notes |
|---|---|---|---|---|
| QUARKUS_DATASOURCE_PASSWORD | Kubernetes Secret | quarterly | datasource | rolling restart required |

## Feature flags

| Key | Owner | Default | Expiry | Rollback |
|---|---|---:|---|---|
| app.feature.new-routing-enabled | case team | false | 2026-08-01 | set false |
```

Ini terlihat administratif, tetapi sangat penting untuk operasi production.

---

## 28. Build Once, Deploy Many: Practical Quarkus Config Layout

Target:

```text
Same artifact promoted across environments.
```

Suggested layout:

```text
src/main/resources/application.properties
src/test/resources/application.properties
.env.example
config/
  README.md
  inventory.md
```

`application.properties`:

```properties
# production-safe defaults
quarkus.hibernate-orm.database.generation=validate
quarkus.log.console.json=true
quarkus.http.access-log.enabled=true

# required runtime config should not have dangerous fake default
app.case-api.connect-timeout=500ms
app.case-api.read-timeout=3s
app.case-api.retry.max-attempts=3
app.case-api.retry.initial-backoff=250ms
app.case-api.retry.max-backoff=2s

# dev-only convenience
%dev.quarkus.log.console.json=false
%dev.quarkus.http.access-log.enabled=false
%dev.app.case-api.base-url=http://localhost:9001

# test-only deterministic config
%test.app.case-api.base-url=http://localhost:19001
%test.app.case-api.retry.max-attempts=1
```

Deployment env supplies:

```text
APP_CASE_API_BASE_URL=https://case-api.uat.internal
QUARKUS_DATASOURCE_JDBC_URL=jdbc:postgresql://db-uat:5432/case
QUARKUS_DATASOURCE_USERNAME=case_user
QUARKUS_DATASOURCE_PASSWORD=<secret>
```

Do not put UAT/PROD URLs in source unless governance permits it.

---

## 29. Multi-Datasource Configuration

Quarkus supports named datasources.

Example:

```properties
quarkus.datasource.db-kind=postgresql
quarkus.datasource.jdbc.url=${APP_DB_URL}
quarkus.datasource.username=${APP_DB_USERNAME}
quarkus.datasource.password=${APP_DB_PASSWORD}

quarkus.datasource.audit.db-kind=postgresql
quarkus.datasource.audit.jdbc.url=${AUDIT_DB_URL}
quarkus.datasource.audit.username=${AUDIT_DB_USERNAME}
quarkus.datasource.audit.password=${AUDIT_DB_PASSWORD}
```

Risiko:

- wrong datasource injected,
- audit writes masuk primary DB,
- transaction boundary tidak jelas,
- migration script salah target,
- pool sizing tidak sesuai.

Best practice:

- name datasource eksplisit,
- prefix secret jelas,
- validate active datasource saat startup,
- startup report menampilkan host/db masked,
- integration test memastikan repository memakai datasource benar.

---

## 30. Config for External Integrations

External API config minimal:

```java
@ConfigMapping(prefix = "app.onemap")
public interface OneMapConfig {
    URI baseUrl();
    Duration connectTimeout();
    Duration readTimeout();
    RateLimit rateLimit();
    Token token();

    interface RateLimit {
        int permitsPerMinute();
        int workerPermitsPerMinute();
    }

    interface Token {
        Duration refreshSkew();
        int maxRefreshAttempts();
    }
}
```

Properties:

```properties
app.onemap.base-url=https://www.onemap.gov.sg
app.onemap.connect-timeout=500ms
app.onemap.read-timeout=3s
app.onemap.rate-limit.permits-per-minute=300
app.onemap.rate-limit.worker-permits-per-minute=250
app.onemap.token.refresh-skew=60s
app.onemap.token.max-refresh-attempts=3
```

Semantic validation:

```text
worker-permits-per-minute <= permits-per-minute
token.refresh-skew < token ttl
read-timeout >= connect-timeout
max-refresh-attempts between 1 and 5
```

Ini mengubah config menjadi bagian dari resilience design.

---

## 31. Config and Observability

Config harus mempengaruhi observability.

Contoh:

```properties
app.instance.role=internet
app.audit.activity-prefix=Internet
app.telemetry.service-area=case-management
```

Tapi hati-hati.

Jika config audit salah, compliance record salah.

Misal:

```properties
app.audit.activity-prefix=Internet
```

Jika service intranet memakai prefix internet, audit trail misleading.

Maka audit config perlu:

- required,
- validated against allowed values,
- visible in startup report,
- covered by environment test,
- reviewed during release.

Contoh enum:

```java
@ConfigMapping(prefix = "app.audit")
public interface AuditConfig {
    Channel channel();

    enum Channel {
        INTERNET,
        INTRANET,
        SYSTEM
    }
}
```

Lebih baik daripada free-form string.

---

## 32. Config and Security Identity

Security config sering terlihat seperti string biasa, padahal sangat kritis.

Contoh:

```properties
quarkus.oidc.auth-server-url=https://idp.example.com/realms/app
quarkus.oidc.client-id=case-service
quarkus.oidc.credentials.secret=${OIDC_CLIENT_SECRET}
quarkus.oidc.token.issuer=https://idp.example.com/realms/app
```

Risiko:

- issuer mismatch,
- audience salah,
- wrong realm,
- stale JWKS,
- client secret dev kebawa prod,
- token accepted dari environment salah.

Best practice:

- jangan default issuer ke dev,
- jangan fallback ke insecure mode,
- validate expected issuer/audience,
- startup report masked,
- security integration test per profile,
- isolate dev Keycloak config under `%dev` only.

---

## 33. Config and Native Image

Native image memperketat configuration discipline.

Beberapa hal yang perlu diperhatikan:

1. Build-time config makin penting.
2. Reflection/resource config biasanya ditentukan saat build.
3. Class initialization bisa build-time atau runtime.
4. Feature yang membutuhkan dynamic classloading bisa gagal.
5. Resource inclusion harus eksplisit untuk beberapa kasus.
6. Changing runtime env tidak bisa mengubah hal yang sudah dikompilasi.

Mental model:

```text
JVM mode tolerates more runtime dynamism.
Native mode rewards explicit build-time knowledge.
```

Jadi untuk native-ready service:

- config mapping harus jelas,
- dependency harus native-friendly,
- build-time/runtime boundary harus diketahui,
- test native image dengan runtime config sebenarnya,
- jangan mengandalkan scanning/reflection berdasarkan config runtime.

---

## 34. Config and Extension Behavior

Quarkus extension sering punya config root sendiri.

Contoh:

```properties
quarkus.http.port=8080
quarkus.datasource.db-kind=postgresql
quarkus.hibernate-orm.log.sql=false
quarkus.log.console.json=true
quarkus.micrometer.enabled=true
```

Extension bisa membaca config saat:

- build step,
- static init,
- runtime init.

Saat membuat custom extension, config harus dirancang dengan sangat hati-hati:

```text
Does this config affect generated build output?
Does this config only affect runtime behavior?
Can user change it via env var after build?
Should it be fixed at build time?
Is it safe to expose in Dev UI?
Should it be masked?
```

Ini akan dibahas lebih dalam di part custom extension.

---

## 35. Config Anti-Patterns

## 35.1 Dangerous Defaults

```properties
quarkus.hibernate-orm.database.generation=drop-and-create
```

Jika base config seperti ini, sangat berbahaya.

Lebih aman:

```properties
quarkus.hibernate-orm.database.generation=validate
%dev.quarkus.hibernate-orm.database.generation=drop-and-create
```

## 35.2 Secret in Git

```properties
app.client-secret=abc123
```

Jangan.

## 35.3 Profile Explosion

Terlalu banyak profile menyebabkan behavior tidak bisa dipahami.

## 35.4 Runtime Override for Build-Time Property

Mengubah env var tetapi property build-time fixed.

## 35.5 Stringly-Typed Config Everywhere

```java
@ConfigProperty(name = "mode")
String mode;
```

Lebih baik enum.

## 35.6 Config Without Owner

Jika tidak ada owner, tidak ada yang berani menghapus atau mengubah.

## 35.7 Config Without Expiry

Temporary flag jadi permanent complexity.

## 35.8 Config as Business Rule Dump

Semua rule ditaruh di properties.

Ini buruk untuk auditability dan change management.

## 35.9 Logging Resolved Secrets

Startup report bagus, tapi harus masked.

## 35.10 Hidden Environment Drift

Tidak ada diff DEV/UAT/PROD.

---

## 36. Production Configuration Checklist

Sebelum service Quarkus production-ready, cek:

### Build-Time Discipline

- [ ] Semua build-time config diketahui.
- [ ] Build artifact tidak bergantung environment tertentu.
- [ ] Jika build per environment, provenance jelas.
- [ ] Native image config diuji jika native mode dipakai.

### Runtime Config

- [ ] Required runtime config fail-fast jika missing.
- [ ] Config mapping dipakai untuk subsystem penting.
- [ ] Duration/URI/enum/int typed, bukan string mentah.
- [ ] Semantic validation ada.
- [ ] Startup report tersedia dan aman.

### Secret

- [ ] Tidak ada secret di Git.
- [ ] Secret berasal dari secret manager/Kubernetes Secret/env injection.
- [ ] Secret masked di log.
- [ ] Rotation strategy ada.
- [ ] Access control secret source minimal.

### Profiles

- [ ] Base config production-safe.
- [ ] Dev override tidak bisa bocor ke prod.
- [ ] Test config deterministic.
- [ ] Tidak ada profile explosion.
- [ ] Perbedaan environment terdokumentasi.

### Governance

- [ ] Config inventory ada.
- [ ] Owner per config group jelas.
- [ ] Feature flag punya expiry.
- [ ] Config drift bisa dideteksi.
- [ ] Release review mencakup config changes.

---

## 37. Mini Case Study: External Address API Integration

Misal service Quarkus perlu call Address API dengan token, rate limit, retry, dan cache.

Config naive:

```properties
address.url=https://api.address.gov
address.token=secret
address.timeout=10000
```

Masalah:

- token plaintext,
- timeout unit tidak jelas,
- tidak ada retry config,
- tidak ada rate limit,
- tidak ada validation,
- tidak ada owner,
- tidak ada profile distinction,
- tidak ada startup report.

Config better:

```properties
app.address-api.base-url=https://api.address.gov
app.address-api.connect-timeout=500ms
app.address-api.read-timeout=3s
app.address-api.retry.max-attempts=3
app.address-api.retry.initial-backoff=250ms
app.address-api.retry.max-backoff=2s
app.address-api.rate-limit.vendor-permits-per-minute=300
app.address-api.rate-limit.worker-permits-per-minute=250
app.address-api.cache.postal-code-ttl=24h
app.address-api.token.refresh-skew=60s
```

Secret via environment:

```text
APP_ADDRESS_API_CLIENT_ID=...
APP_ADDRESS_API_CLIENT_SECRET=...
```

Config mapping:

```java
@ConfigMapping(prefix = "app.address-api")
public interface AddressApiConfig {
    URI baseUrl();
    Duration connectTimeout();
    Duration readTimeout();
    Retry retry();
    RateLimit rateLimit();
    Cache cache();
    Token token();

    interface Retry {
        int maxAttempts();
        Duration initialBackoff();
        Duration maxBackoff();
    }

    interface RateLimit {
        int vendorPermitsPerMinute();
        int workerPermitsPerMinute();
    }

    interface Cache {
        Duration postalCodeTtl();
    }

    interface Token {
        Duration refreshSkew();
    }
}
```

Validation:

```java
@PostConstruct
void validate() {
    if (config.rateLimit().workerPermitsPerMinute() > config.rateLimit().vendorPermitsPerMinute()) {
        throw new IllegalStateException("worker rate limit must not exceed vendor limit");
    }
    if (config.readTimeout().compareTo(config.connectTimeout()) < 0) {
        throw new IllegalStateException("read timeout must be >= connect timeout");
    }
    if (config.retry().maxAttempts() < 1 || config.retry().maxAttempts() > 5) {
        throw new IllegalStateException("retry max attempts must be 1..5");
    }
}
```

Dengan begitu, config menjadi bagian dari reliability architecture.

---

## 38. Top 1% Engineer Exercises

### Exercise 1 — Classify Config

Ambil 30 config dari service Quarkus kamu dan klasifikasikan:

```text
build-time / runtime / secret / feature / operational / domain policy
```

Untuk masing-masing, jawab:

```text
owner siapa?
required atau optional?
default aman atau tidak?
kalau salah dampaknya apa?
perlu restart atau rebuild?
bagaimana dideteksi saat incident?
```

### Exercise 2 — Remove Dangerous Defaults

Cari default yang bisa membuat production salah jalan.

Contoh:

```properties
app.external.base-url=http://localhost:8080
```

Ubah menjadi required config untuk prod.

### Exercise 3 — Build Once Deploy Many Audit

Pastikan build-time config tidak berbeda antar environment.

Jika berbeda, jelaskan apakah itu acceptable.

### Exercise 4 — Secret Rotation Design

Pilih satu secret:

- DB password,
- OIDC client secret,
- API token.

Desain rotasinya:

```text
who rotates?
how distributed?
restart needed?
dual credential?
how verified?
how rollback?
```

### Exercise 5 — Startup Config Report

Buat startup report yang aman:

- tampilkan non-secret config penting,
- mask secret,
- tampilkan active profile,
- tampilkan external endpoints,
- tampilkan rate limit/timeout/retry.

---

## 39. Core Invariants

Ingat invariants berikut:

1. **Build-time config changes application shape. Runtime config changes application parameters.**
2. **A config that can silently fall back can silently harm production.**
3. **Secrets are not ordinary config; they have lifecycle, rotation, and access-control requirements.**
4. **Base config should be production-safe; dev should override for convenience, not the opposite.**
5. **Config mapping is architecture documentation in code.**
6. **Every important config needs owner, validation, and observability.**
7. **Profile differences are allowed only if intentional, documented, and tested.**
8. **Native image makes implicit runtime dynamism more expensive and often impossible.**
9. **A startup failure due to invalid config is usually better than a running service with wrong assumptions.**
10. **Configuration is part of release governance, not just deployment plumbing.**

---

## 40. What You Should Be Able to Explain After This Part

Setelah part ini, kamu harus bisa menjelaskan:

- Kenapa konfigurasi di Quarkus berbeda dari runtime Java klasik.
- Apa beda build-time fixed dan runtime-overridable config.
- Kenapa perubahan env var kadang tidak memberi efek.
- Kenapa base config harus production-safe.
- Kenapa `@ConfigMapping` lebih baik untuk subsystem serius.
- Kapan default value aman dan kapan berbahaya.
- Bagaimana mendesain secret handling dan rotation.
- Bagaimana mencegah config drift.
- Bagaimana membuat configuration inventory.
- Bagaimana config berhubungan dengan native image, extension, observability, security, dan runtime reliability.

---

## 41. References

Referensi utama:

- Quarkus Configuration Reference: https://quarkus.io/guides/config-reference
- Quarkus Configuring Your Application: https://quarkus.io/guides/config
- Quarkus Mapping Configuration to Objects: https://quarkus.io/guides/config-mappings
- Quarkus Secrets in Configuration: https://quarkus.io/guides/config-secrets
- Quarkus Credentials Provider: https://quarkus.io/guides/credentials-provider
- Quarkus Kubernetes Config: https://quarkus.io/guides/kubernetes-config
- Quarkus YAML Configuration: https://quarkus.io/guides/config-yaml
- Quarkus Datasource Guide: https://quarkus.io/guides/datasource
- Quarkus Extending Configuration Support: https://quarkus.io/guides/config-extending-support

---

## 42. Status

**Part 006 selesai.**

Seri **belum selesai** dan **belum mencapai bagian terakhir**.

Part berikutnya:

**Part 007 — CDI with Arc: Dependency Injection yang Dioptimalkan untuk Build-Time**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-005.md">⬅️ Part 005 — Project Structure, Maven/Gradle, Platform BOM, Extension Governance</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-007.md">Part 007 — CDI with Arc: Dependency Injection yang Dioptimalkan untuk Build-Time ➡️</a>
</div>
