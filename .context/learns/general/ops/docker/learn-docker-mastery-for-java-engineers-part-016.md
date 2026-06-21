# learn-docker-mastery-for-java-engineers-part-016.md

# Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection

> Series: `learn-docker-mastery-for-java-engineers`  
> Part: `016`  
> Topic: Configuration and Secrets in Docker for Java services  
> Audience: Java software engineer / tech lead  
> Goal: memahami konfigurasi dan secret sebagai kontrak runtime, bukan sekadar variabel `.env`.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 015, kita sudah membangun fondasi berikut:

1. container bukan VM kecil;
2. image adalah template immutable;
3. container adalah proses runtime dengan boundary;
4. Dockerfile membentuk filesystem image;
5. Compose mendeskripsikan topology lokal;
6. healthcheck membedakan proses hidup dari aplikasi siap.

Part ini menjawab pertanyaan yang hampir selalu muncul setelah service bisa jalan:

> “Konfigurasi runtime seharusnya masuk dari mana?”  
> “Apa bedanya `ARG`, `ENV`, `.env`, `env_file`, config file, secret file, dan mounted config?”  
> “Bagaimana agar image yang sama bisa dipakai di dev, staging, dan production tanpa rebuild?”  
> “Kenapa secret tidak boleh masuk Dockerfile?”  
> “Bagaimana Java/Spring Boot membaca konfigurasi secara aman di container?”

Ini adalah bagian penting karena banyak sistem containerized gagal bukan karena image atau network, tetapi karena **kontrak konfigurasi tidak jelas**.

---

## 1. Core Mental Model

Docker configuration harus dipahami sebagai pemisahan antara:

```text
source code
  ↓ build
build input
  ↓ Dockerfile / build process
image artifact
  ↓ runtime injection
container instance
  ↓ process startup
application configuration
```

Kesalahan paling berbahaya adalah mencampur semua lapisan ini.

Docker yang sehat biasanya mengikuti prinsip:

> **Build once, configure at runtime, promote the same image across environments.**

Artinya:

- image yang sama harus bisa dipakai untuk dev, staging, production;
- environment-specific value tidak boleh dibake ke image;
- secret tidak boleh masuk layer image;
- konfigurasi runtime harus eksplisit, tervalidasi, dan observable secara aman;
- aplikasi harus fail fast jika config wajib tidak tersedia.

---

## 2. Empat Kategori Input Konfigurasi

Dalam Docker, konfigurasi bisa berasal dari beberapa kategori besar.

| Kategori | Waktu Dipakai | Contoh | Aman untuk Secret? | Persist di Image? |
|---|---:|---|---:|---:|
| `ARG` | build-time | `APP_VERSION`, `BUILD_DATE` | Tidak | Bisa bocor via history/provenance/build logs |
| `ENV` di Dockerfile | build + runtime default | `JAVA_OPTS`, `SERVER_PORT` | Tidak | Ya |
| runtime env | saat container dibuat | `SPRING_PROFILES_ACTIVE` | Kurang ideal untuk secret | Tidak masuk image, tapi inspectable |
| mounted file | runtime | `/config/application.yml`, `/run/secrets/db_password` | Lebih baik | Tidak |

Rule of thumb:

```text
ARG  = input untuk build
ENV  = default runtime non-secret
file = config/secret yang lebih eksplisit dan bisa di-mount
secret mechanism = sensitive runtime value
```

---

## 3. Build-Time vs Runtime Configuration

### 3.1 Build-time configuration

Build-time configuration adalah input yang memengaruhi hasil image.

Contoh valid:

```dockerfile
ARG APP_VERSION
ARG GIT_COMMIT
ARG BUILD_DATE

LABEL org.opencontainers.image.version=$APP_VERSION
LABEL org.opencontainers.image.revision=$GIT_COMMIT
LABEL org.opencontainers.image.created=$BUILD_DATE
```

Ini masuk akal karena metadata image memang bagian dari artifact.

Contoh lain:

```dockerfile
ARG JAR_FILE=target/app.jar
COPY ${JAR_FILE} /app/app.jar
```

Ini juga build-time karena menentukan file mana yang dimasukkan ke image.

### 3.2 Runtime configuration

Runtime configuration adalah input yang baru diketahui ketika container dijalankan.

Contoh:

```text
DATABASE_URL
DATABASE_USERNAME
DATABASE_PASSWORD
SPRING_PROFILES_ACTIVE
SERVER_PORT
LOG_LEVEL
EXTERNAL_API_BASE_URL
FEATURE_X_ENABLED
```

Nilai-nilai ini tidak seharusnya menentukan isi image. Mereka menentukan perilaku container instance.

### 3.3 Kenapa pemisahan ini penting?

Misalnya kamu punya tiga environment:

```text
dev
staging
production
```

Jika kamu membake config ke image, kamu akan punya:

```text
my-service:dev
my-service:staging
my-service:production
```

Secara operasional ini buruk karena:

- artifact yang dites di staging bukan artifact yang sama dengan production;
- rollback menjadi ambigu;
- audit supply chain lebih sulit;
- image bisa mengandung secret lama;
- deployment menjadi rebuild, bukan promote.

Model yang lebih sehat:

```text
my-service@sha256:abc123
  + dev runtime config
  + staging runtime config
  + production runtime config
```

Satu image, banyak runtime configuration.

---

## 4. `ARG`: Build Argument

`ARG` hanya tersedia saat build, kecuali disalin ke `ENV` atau digunakan dalam instruction yang meninggalkan jejak.

Contoh:

```dockerfile
ARG APP_VERSION=dev
LABEL app.version=$APP_VERSION
```

Build:

```bash
docker build \
  --build-arg APP_VERSION=1.2.3 \
  -t my-service:1.2.3 .
```

### 4.1 `ARG` scope

`ARG` sebelum `FROM` bisa dipakai di `FROM`:

```dockerfile
ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jre
```

Tetapi setelah `FROM`, jika masih diperlukan, deklarasikan ulang:

```dockerfile
ARG JAVA_VERSION=21
FROM eclipse-temurin:${JAVA_VERSION}-jre
ARG JAVA_VERSION
RUN echo "Java version base: ${JAVA_VERSION}"
```

### 4.2 `ARG` bukan secret

Ini anti-pattern:

```dockerfile
ARG MAVEN_TOKEN
RUN mvn -s settings.xml package
```

Bahkan jika token tidak terlihat di final filesystem, ia bisa bocor melalui:

- build log;
- shell history dalam layer;
- image build metadata;
- cache;
- remote builder;
- CI logs;
- provenance/SBOM metadata depending on build setup.

Docker sendiri memiliki build check `SecretsUsedInArgOrEnv` karena menyimpan secret lewat `ARG` atau `ENV` tidak aman: nilai tersebut dapat bertahan dalam final image metadata/layer/history. Lihat Docker Build checks tentang `SecretsUsedInArgOrEnv`.  
Source: Docker docs — `SecretsUsedInArgOrEnv`.

---

## 5. `ENV`: Default Runtime Environment

`ENV` dalam Dockerfile menetapkan environment variable yang menjadi bagian image config.

Contoh:

```dockerfile
ENV APP_HOME=/app
ENV SERVER_PORT=8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0"
```

`ENV` cocok untuk:

- default non-sensitive;
- path internal image;
- default port;
- default JVM option yang aman;
- locale/timezone default jika memang diperlukan;
- feature default yang bukan environment-specific secret.

`ENV` tidak cocok untuk:

```dockerfile
ENV DB_PASSWORD=supersecret
ENV API_TOKEN=abc123
ENV PRIVATE_KEY=...
```

Kenapa?

Karena nilai `ENV`:

- masuk image config;
- bisa dilihat dengan `docker inspect`;
- bisa muncul di image history/build metadata;
- dapat diwariskan ke process child;
- mudah bocor di crash report/log/debug endpoint.

### 5.1 `ENV` sebagai default, bukan final truth

Contoh sehat:

```dockerfile
ENV SERVER_PORT=8080
ENV LOG_LEVEL=INFO
```

Runtime bisa override:

```bash
docker run \
  -e SERVER_PORT=9090 \
  -e LOG_LEVEL=DEBUG \
  my-service:local
```

Mental model:

```text
Dockerfile ENV = baked default
runtime -e      = container-specific override
application    = resolves final config
```

---

## 6. Runtime Environment Variables

Runtime env adalah cara paling umum untuk memasukkan konfigurasi non-secret.

Contoh `docker run`:

```bash
docker run --rm \
  -e SPRING_PROFILES_ACTIVE=local \
  -e SERVER_PORT=8080 \
  -e LOG_LEVEL=INFO \
  my-service:local
```

Contoh Compose:

```yaml
services:
  app:
    image: my-service:local
    environment:
      SPRING_PROFILES_ACTIVE: local
      SERVER_PORT: "8080"
      LOG_LEVEL: INFO
```

Docker Compose mendukung `environment` dalam bentuk mapping atau list untuk menetapkan environment variable container. Dokumentasi Compose juga menjelaskan `.env`, interpolation, dan `env_file` sebagai mekanisme yang berbeda.  
Source: Docker docs — Compose environment variables and interpolation.

### 6.1 Kelebihan env var

- Mudah dibaca aplikasi;
- mudah override;
- cocok untuk 12-factor app;
- cocok untuk CI/CD injection;
- tidak butuh file path convention;
- terintegrasi baik dengan Spring Boot.

### 6.2 Kekurangan env var

Env var tidak ideal untuk secret karena:

- bisa terlihat via `docker inspect`;
- bisa terlihat dari `/proc/<pid>/environ` dalam konteks tertentu;
- bisa masuk diagnostic dump;
- bisa tercetak oleh framework saat debug;
- sering ikut tersebar dalam pipeline logs;
- tidak punya file permission boundary yang bagus.

Kesimpulan:

```text
env var bagus untuk config biasa
env var kurang ideal untuk secret bernilai tinggi
```

---

## 7. `.env` di Compose: Sering Disalahpahami

Banyak engineer mengira `.env` otomatis menjadi environment variable dalam container. Tidak selalu.

Dalam Compose, `.env` terutama digunakan untuk **variable interpolation** pada file Compose.

Contoh `.env`:

```env
APP_PORT=8080
APP_IMAGE=my-service:local
```

Compose:

```yaml
services:
  app:
    image: ${APP_IMAGE}
    ports:
      - "${APP_PORT}:8080"
```

Di sini `.env` membantu Compose mengganti `${APP_IMAGE}` dan `${APP_PORT}`.

Namun, agar variable masuk ke container environment, kamu perlu eksplisit:

```yaml
services:
  app:
    image: ${APP_IMAGE}
    environment:
      SERVER_PORT: "8080"
      APP_PORT: ${APP_PORT}
```

Atau gunakan `env_file`.

### 7.1 `.env` bukan secret vault

Ini buruk:

```env
DATABASE_PASSWORD=production-password
JWT_PRIVATE_KEY=...
```

Kenapa buruk?

- `.env` mudah tidak sengaja commit;
- sering dishare lewat Slack/email;
- tidak punya audit trail;
- tidak rotatable secara aman;
- sering masuk bug report.

Untuk local development, `.env` boleh dipakai dengan hati-hati:

```text
.env.example   -> committed
.env           -> ignored
.env.local     -> ignored
```

`.gitignore`:

```gitignore
.env
.env.*
!.env.example
```

---

## 8. `env_file` di Compose

`env_file` memasukkan key-value dari file ke environment container.

```yaml
services:
  app:
    image: my-service:local
    env_file:
      - ./app.env
```

`app.env`:

```env
SPRING_PROFILES_ACTIVE=local
SERVER_PORT=8080
LOG_LEVEL=INFO
```

Gunakan `env_file` untuk config non-secret lokal atau test.

### 8.1 `env_file` vs `.env`

| Mekanisme | Fungsi utama | Masuk container? |
|---|---|---:|
| `.env` default Compose | interpolation Compose file | Tidak otomatis untuk semua variable |
| `env_file` | inject env ke container | Ya |
| `environment` | inject env eksplisit | Ya |

Contoh gabungan:

```yaml
services:
  app:
    image: ${APP_IMAGE}
    env_file:
      - ./app.env
    environment:
      LOG_LEVEL: DEBUG
```

Biasanya `environment` eksplisit mengalahkan nilai dari `env_file` jika variable sama. Jangan mengandalkan precedence secara samar; desain agar tidak ada duplicate key yang membingungkan.

---

## 9. Runtime Config via Mounted Files

Selain environment variable, konfigurasi bisa dipasang sebagai file.

Contoh:

```yaml
services:
  app:
    image: my-service:local
    volumes:
      - ./config/application-local.yml:/config/application.yml:ro
    environment:
      SPRING_CONFIG_ADDITIONAL_LOCATION: file:/config/application.yml
```

Atau:

```bash
docker run --rm \
  -v "$PWD/config/application.yml:/config/application.yml:ro" \
  -e SPRING_CONFIG_ADDITIONAL_LOCATION=file:/config/application.yml \
  my-service:local
```

### 9.1 Kapan pakai config file?

Pakai config file ketika:

- config panjang dan nested;
- ada banyak structured setting;
- butuh YAML/properties hierarchy;
- ingin mount read-only;
- ingin memisahkan environment variable dari config kompleks;
- config dihasilkan oleh deployment system.

Contoh config yang lebih cocok file:

```yaml
external-services:
  payment:
    base-url: https://payment.example.com
    timeout: 2s
    retry:
      max-attempts: 3
      backoff: 200ms
  document:
    base-url: https://document.example.com
    timeout: 5s

features:
  settlement-flow:
    enabled: true
    dry-run: false
```

### 9.2 Risiko config file

- file path salah;
- mount menutupi file dalam image;
- permission mismatch;
- config tidak ikut terlihat di `docker inspect`;
- aplikasi tidak fail fast;
- config lokal berbeda jauh dari production.

Mitigasi:

- gunakan path standar;
- mount read-only;
- validate config saat startup;
- log config source, bukan value sensitif;
- sediakan `.example` config;
- tulis integration test untuk config binding.

---

## 10. Docker Secrets

Docker Compose menyediakan mekanisme secrets untuk memberikan nilai sensitif sebagai file, bukan environment variable. Docker documentation menjelaskan Compose secrets sebagai cara memakai secret tanpa menyimpannya dalam environment variable; service hanya bisa mengakses secret yang secara eksplisit diberikan di bagian `secrets`.  
Source: Docker docs — Secrets in Compose.

Contoh:

```yaml
services:
  app:
    image: my-service:local
    secrets:
      - db_password
    environment:
      DB_PASSWORD_FILE: /run/secrets/db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

Di dalam container:

```text
/run/secrets/db_password
```

Aplikasi membaca isi file tersebut.

### 10.1 Secret sebagai file lebih baik daripada env var

File-based secret memberi beberapa keuntungan:

- tidak otomatis muncul di environment;
- bisa diberi permission tertentu;
- akses eksplisit per service;
- lebih dekat dengan model secret di orchestrator;
- bisa dibaca sebagai config tree oleh framework tertentu.

Tetapi jangan berlebihan: Docker Compose local secrets bukan sama dengan secret manager enterprise. Untuk production yang matang, biasanya ada sistem seperti:

- cloud secret manager;
- Vault;
- Kubernetes Secrets + external secret operator;
- runtime secret injection platform;
- encrypted config pipeline.

Docker secret tetap lebih baik daripada env var untuk banyak kasus local/dev/small deployment, tetapi bukan jawaban lengkap untuk governance secret.

---

## 11. BuildKit Secrets: Secret Saat Build Tanpa Masuk Layer

Kadang build butuh credential.

Contoh:

- Maven private repository;
- Gradle private plugin repo;
- private npm package untuk frontend build;
- private Git dependency;
- internal CA certificate sementara;
- license file untuk build tool.

Jangan gunakan `ARG`:

```dockerfile
# BURUK
ARG MAVEN_TOKEN
RUN mvn -Dtoken=$MAVEN_TOKEN package
```

Gunakan BuildKit secret mount:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY pom.xml .
COPY src ./src

RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    mvn -B -DskipTests package
```

Build:

```bash
docker build \
  --secret id=maven_settings,src=$HOME/.m2/settings.xml \
  -t my-service:local .
```

Docker BuildKit secrets membuat secret tersedia sementara untuk instruksi `RUN` tertentu, biasanya di `/run/secrets/<id>` atau path yang ditentukan, tanpa membake secret sebagai layer image.  
Source: Docker docs — Build secrets.

### 11.1 Prinsip BuildKit secret

```text
secret mount lives only during that RUN step
secret should not be copied into image
secret should not be printed
secret should not affect reproducibility more than needed
```

Ini tetap buruk:

```dockerfile
RUN --mount=type=secret,id=token \
    cp /run/secrets/token /app/token.txt
```

Karena kamu akhirnya memasukkan secret ke filesystem layer.

Ini juga buruk:

```dockerfile
RUN --mount=type=secret,id=token \
    echo "Token is $(cat /run/secrets/token)"
```

Karena secret masuk build log.

---

## 12. Secret Leakage Vectors

Secret bisa bocor dari banyak tempat.

### 12.1 Dockerfile

```dockerfile
ENV API_KEY=abc123
ARG DB_PASSWORD
RUN echo $DB_PASSWORD
```

Bocor lewat:

- image config;
- history;
- build logs;
- cache;
- registry metadata;
- CI artifacts.

### 12.2 Compose file

```yaml
services:
  app:
    environment:
      DATABASE_PASSWORD: production-secret
```

Bocor lewat:

- repository;
- review diff;
- screenshot;
- bug report;
- `docker inspect`.

### 12.3 Logs

```java
log.info("Config: {}", environment.getSystemEnvironment());
```

Bocor lewat:

- application logs;
- centralized logging;
- support bundle;
- incident report.

### 12.4 Error pages / actuator / debug endpoint

Spring Boot dan framework lain bisa mengekspos property/environment jika endpoint debug tidak diamankan.

Jangan pernah expose environment endpoint tanpa proteksi kuat.

### 12.5 Heap dump / thread dump / crash dump

Secret bisa tersimpan dalam memory sebagai `String`.

Jika kamu mengirim heap dump ke pihak lain, treat sebagai sensitive artifact.

### 12.6 Shell history dan terminal

```bash
docker run -e DB_PASSWORD=secret my-service
```

Bisa tersimpan di shell history.

Gunakan file, secret manager, atau minimal env file lokal yang tidak dicommit.

---

## 13. Spring Boot Externalized Configuration dalam Container

Spring Boot punya sistem externalized configuration yang kuat. Docker dapat memasukkan config melalui:

- environment variables;
- command-line arguments;
- config files;
- config tree;
- mounted secrets.

Spring Boot documentation menyebut configuration trees dapat digunakan untuk Docker secrets, karena secret yang diberikan ke service dapat dimount sebagai file dan dibaca oleh aplikasi.  
Source: Spring Boot docs — Externalized Configuration.

### 13.1 Env var binding

Spring Boot bisa bind environment variable ke property.

Contoh property:

```properties
spring.datasource.url=jdbc:postgresql://db:5432/app
spring.datasource.username=app
spring.datasource.password=secret
```

Bisa diinject sebagai env:

```yaml
services:
  app:
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/app
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: local-password
```

Mapping umum:

```text
spring.datasource.url      -> SPRING_DATASOURCE_URL
external.payment.base-url  -> EXTERNAL_PAYMENT_BASE_URL
feature.foo.enabled        -> FEATURE_FOO_ENABLED
```

### 13.2 Config tree untuk secret file

Misalnya secret file ada di:

```text
/run/secrets/db_password
```

Kamu bisa menggunakan pattern config tree jika struktur property disiapkan.

Contoh Compose:

```yaml
services:
  app:
    image: my-service:local
    secrets:
      - spring_datasource_password
    environment:
      SPRING_CONFIG_IMPORT: optional:configtree:/run/secrets/

secrets:
  spring_datasource_password:
    file: ./secrets/spring.datasource.password
```

Dalam config tree, nama file bisa menjadi property key. Pola ini bagus jika kamu ingin secret masuk sebagai file, bukan env var.

Catatan penting: format dan nama file harus cocok dengan mekanisme binding aplikasi. Uji dengan integration test, jangan berasumsi.

---

## 14. Java Non-Spring Applications

Tidak semua Java service memakai Spring Boot.

Untuk aplikasi plain Java, Micronaut, Quarkus, Jakarta EE, Dropwizard, atau framework internal, gunakan prinsip yang sama:

1. baca config dari env untuk value sederhana;
2. baca secret dari file path;
3. fail fast jika required config tidak ada;
4. jangan log secret;
5. validasi config sebelum menerima traffic.

Contoh helper sederhana:

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public final class Config {
    public static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required env: " + name);
        }
        return value;
    }

    public static String optionalEnv(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    public static String requiredSecretFile(String envNameContainingPath) {
        String path = requiredEnv(envNameContainingPath);
        try {
            String value = Files.readString(Path.of(path)).trim();
            if (value.isBlank()) {
                throw new IllegalStateException("Secret file is empty: " + envNameContainingPath);
            }
            return value;
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read secret file from env: " + envNameContainingPath, e);
        }
    }
}
```

Usage:

```java
String jdbcUrl = Config.requiredEnv("JDBC_URL");
String username = Config.requiredEnv("JDBC_USERNAME");
String password = Config.requiredSecretFile("JDBC_PASSWORD_FILE");
```

Compose:

```yaml
services:
  app:
    image: my-service:local
    environment:
      JDBC_URL: jdbc:postgresql://db:5432/app
      JDBC_USERNAME: app
      JDBC_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

---

## 15. Designing Configuration Contract

A serious Java service should have a clear config contract.

Jangan hanya mendokumentasikan “set env ini”. Buat kategori.

### 15.1 Example config contract

```markdown
## Required runtime configuration

| Name | Source | Type | Secret | Example | Description |
|---|---|---:|---:|---|---|
| `SPRING_DATASOURCE_URL` | env | string | no | `jdbc:postgresql://db:5432/app` | JDBC URL |
| `SPRING_DATASOURCE_USERNAME` | env | string | no | `app` | DB username |
| `SPRING_DATASOURCE_PASSWORD_FILE` | env -> file | path | yes | `/run/secrets/db_password` | Path to DB password secret file |
| `SERVER_PORT` | env | int | no | `8080` | HTTP listen port |
| `LOG_LEVEL` | env | enum | no | `INFO` | Root application log level |
| `PAYMENT_BASE_URL` | env | URL | no | `https://payment.local` | Payment service endpoint |
| `JWT_PUBLIC_KEY_FILE` | env -> file | path | yes-ish | `/run/secrets/jwt_public_key` | JWT public key file |
```

### 15.2 Contract invariants

Setiap config penting harus punya:

- nama;
- source;
- tipe;
- default;
- apakah required;
- apakah secret;
- validation rule;
- contoh nilai;
- failure behavior jika hilang;
- apakah boleh berubah tanpa restart.

### 15.3 Dynamic vs static configuration

Sebagian config hanya dibaca saat startup:

```text
server.port
datasource.url
keystore.path
thread pool size
```

Sebagian config mungkin bisa berubah runtime:

```text
feature flag
rate limit
routing rule
business threshold
```

Docker env/file injection biasanya cocok untuk **startup configuration**, bukan dynamic control plane.

Jika butuh dynamic config, gunakan platform terpisah:

- feature flag system;
- config service;
- database-backed admin config;
- service discovery/config registry;
- orchestrator config reload pattern.

Jangan memaksakan Docker untuk menjadi dynamic configuration management.

---

## 16. Environment-Specific Image Anti-Pattern

Anti-pattern klasik:

```dockerfile
COPY application-production.yml /app/application.yml
```

Atau:

```dockerfile
RUN sed -i 's/ENV/dev/prod/g' /app/application.yml
```

Atau:

```bash
docker build -t my-service:prod --build-arg PROFILE=prod .
```

Masalahnya:

- image berbeda per environment;
- staging test tidak membuktikan production image;
- secret mungkin masuk image;
- rollback butuh tahu config baked;
- audit lebih rumit;
- supply chain scanning harus per environment image.

Better:

```dockerfile
COPY app.jar /app/app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Runtime:

```yaml
services:
  app:
    image: registry.example.com/my-service@sha256:abc123
    environment:
      SPRING_PROFILES_ACTIVE: production
      SPRING_CONFIG_ADDITIONAL_LOCATION: file:/config/application-production.yml
    volumes:
      - /etc/my-service/application-production.yml:/config/application-production.yml:ro
    secrets:
      - db_password
```

Satu image. Runtime yang berbeda.

---

## 17. Profiles: Useful, But Dangerous If Overused

Spring profile atau framework profile bisa membantu:

```yaml
SPRING_PROFILES_ACTIVE: local
```

Namun profile sering disalahgunakan menjadi branching environment besar:

```text
if prod do X
if staging do Y
if dev do Z
```

Jika terlalu banyak profile-specific behavior, aplikasi menjadi sulit diprediksi.

Profile sebaiknya dipakai untuk:

- memilih config group;
- mengaktifkan adapter lokal;
- membedakan dev/test/prod defaults;
- bukan untuk mengubah core behavior yang seharusnya sama.

Core business behavior harus sama di semua environment.

---

## 18. Certificate, Truststore, Keystore, and TLS Config

Java service sering butuh:

- custom CA certificate;
- client certificate;
- keystore;
- truststore;
- private key;
- mutual TLS config.

### 18.1 Jangan bake private key ke image

Buruk:

```dockerfile
COPY client-keystore.p12 /app/client-keystore.p12
ENV KEYSTORE_PASSWORD=secret
```

Lebih baik:

```yaml
services:
  app:
    image: my-service:local
    volumes:
      - ./certs/truststore.p12:/certs/truststore.p12:ro
    secrets:
      - keystore_password
    environment:
      JAVA_TOOL_OPTIONS: >-
        -Djavax.net.ssl.trustStore=/certs/truststore.p12
        -Djavax.net.ssl.trustStoreType=PKCS12
      KEYSTORE_PASSWORD_FILE: /run/secrets/keystore_password

secrets:
  keystore_password:
    file: ./secrets/keystore_password.txt
```

### 18.2 Truststore public vs private distinction

CA certificate publik/internal bukan selalu secret, tetapi tetap security-sensitive.

Private key dan keystore password adalah secret.

### 18.3 Common TLS config failures

- file mounted ke path salah;
- permission denied;
- password env salah;
- truststore type salah;
- image minimal tidak punya CA certificates;
- timezone/clock mismatch menyebabkan certificate “not yet valid”;
- Java app membaca config sebelum file tersedia;
- line ending certificate rusak.

---

## 19. File Permissions and UID/GID

Jika container berjalan sebagai non-root, mounted config/secret harus readable oleh UID proses.

Contoh Dockerfile:

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
USER app
```

Jika secret dimount dengan permission terlalu ketat dan owner root, aplikasi bisa gagal membaca.

Diagnosis:

```bash
docker exec app id
docker exec app ls -l /run/secrets
docker exec app cat /run/secrets/db_password
```

Jika image minimal tidak punya shell, gunakan debug image/network namespace pattern dari Part 022 nanti.

Rule:

```text
security hardening must be tested with actual runtime UID
```

Jangan hanya menambahkan `USER app` tanpa menguji file access.

---

## 20. Runtime Config Validation

Aplikasi yang baik tidak boleh start “setengah benar”.

Buruk:

```text
service starts
first request arrives
then NullPointerException because PAYMENT_BASE_URL missing
```

Baik:

```text
service starts
config validation runs
missing PAYMENT_BASE_URL detected
process exits with clear error
container fails fast
```

### 20.1 Spring Boot validation

Gunakan `@ConfigurationProperties` + validation.

```java
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "payment")
public record PaymentProperties(
    @NotBlank String baseUrl,
    @NotNull Integer timeoutMillis
) {}
```

Enable:

```java
@EnableConfigurationProperties(PaymentProperties.class)
@SpringBootApplication
public class Application {}
```

Jika config hilang, aplikasi gagal startup.

### 20.2 Validate semantic constraints

Tidak cukup hanya `not blank`.

Validasi juga:

- URL valid;
- timeout masuk akal;
- pool size tidak nol;
- feature flag combination legal;
- file path exists;
- secret file readable;
- port dalam range;
- enum value valid.

---

## 21. Logging Configuration Safely

Saat startup, service sebaiknya log konfigurasi non-sensitive untuk observability.

Contoh aman:

```text
Application config:
- profile: local
- server.port: 8080
- datasource.host: db
- datasource.database: app
- payment.baseUrl: http://payment-mock:8080
- datasource.password: <redacted>
- jwt.privateKey: <redacted:file-present>
```

Jangan log:

```text
DATABASE_PASSWORD=...
JWT_PRIVATE_KEY=...
API_TOKEN=...
SESSION_SECRET=...
```

### 21.1 Redaction policy

Redact by key pattern:

```text
password
secret
token
key
credential
private
client-secret
```

Tapi hati-hati: `publicKey` mungkin tidak secret, `privateKey` pasti secret. Redaction by pattern harus conservative.

---

## 22. Configuration Drift

Configuration drift terjadi ketika environment berbeda tanpa disadari.

Contoh:

```text
local:    FEATURE_X_ENABLED=true
staging:  FEATURE_X_ENABLED=false
prod:     FEATURE_X_ENABLED=true
```

Atau:

```text
local uses file config
staging uses env
prod uses secret manager
```

Drift membuat bug sulit direproduce.

### 22.1 Mitigasi drift

- satu config contract;
- `.env.example` selalu update;
- schema validation;
- integration test untuk config;
- config diff tool;
- deployment template reviewed;
- avoid manual server edits;
- promote image by digest;
- config source logged.

---

## 23. Compose Example: Local Java Service with DB Secret

Struktur project:

```text
my-service/
  Dockerfile
  compose.yaml
  .env.example
  .gitignore
  secrets/
    db_password.txt      # ignored
  config/
    application-local.yml
```

`.gitignore`:

```gitignore
.env
secrets/*
!secrets/.gitkeep
```

`.env.example`:

```env
APP_IMAGE=my-service:local
APP_PORT=8080
POSTGRES_PORT=5432
```

`compose.yaml`:

```yaml
services:
  app:
    image: ${APP_IMAGE:-my-service:local}
    build:
      context: .
    ports:
      - "${APP_PORT:-8080}:8080"
    environment:
      SPRING_PROFILES_ACTIVE: local
      SPRING_DATASOURCE_URL: jdbc:postgresql://db:5432/app
      SPRING_DATASOURCE_USERNAME: app
      SPRING_CONFIG_ADDITIONAL_LOCATION: optional:file:/config/application-local.yml
      DB_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - ./config/application-local.yml:/config/application-local.yml:ro
    secrets:
      - db_password
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    secrets:
      - db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  postgres_data:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

Catatan:

- password tidak masuk image;
- password tidak ditulis langsung di Compose;
- app dan db membaca secret yang sama sebagai file;
- config file dimount read-only;
- image bisa sama untuk environment lain.

---

## 24. Dockerfile Example with Safe Defaults

```dockerfile
# syntax=docker/dockerfile:1.7

FROM eclipse-temurin:21-jre AS runtime

ARG APP_VERSION=dev
ARG GIT_COMMIT=unknown

LABEL org.opencontainers.image.title="my-service"
LABEL org.opencontainers.image.version=$APP_VERSION
LABEL org.opencontainers.image.revision=$GIT_COMMIT

WORKDIR /app

RUN groupadd --system app && useradd --system --gid app app

COPY --chown=app:app target/my-service.jar /app/app.jar

ENV SERVER_PORT=8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError"

USER app

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Yang sengaja tidak ada:

```dockerfile
ENV DATABASE_PASSWORD=...
COPY application-prod.yml /app/application.yml
COPY secrets/ /app/secrets/
```

---

## 25. Runtime Override Strategy

### 25.1 Local

```bash
docker compose up --build
```

### 25.2 CI integration test

```bash
docker compose \
  -f compose.yaml \
  -f compose.test.yaml \
  up --build --abort-on-container-exit
```

### 25.3 Production-like VM

```bash
docker run -d \
  --name my-service \
  --restart unless-stopped \
  -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=production \
  -e SPRING_DATASOURCE_URL=jdbc:postgresql://prod-db:5432/app \
  -e SPRING_DATASOURCE_USERNAME=app \
  -e DB_PASSWORD_FILE=/run/secrets/db_password \
  -v /etc/my-service/config.yml:/config/application.yml:ro \
  -v /run/secrets/my-service/db_password:/run/secrets/db_password:ro \
  registry.example.com/my-service@sha256:abc123
```

The exact production mechanism may differ, but the invariant remains:

```text
same image digest + environment-specific runtime config
```

---

## 26. Feature Flags vs Docker Env

Feature flags are often set by env var:

```yaml
FEATURE_NEW_SETTLEMENT_FLOW_ENABLED: "true"
```

This is acceptable for coarse startup flags.

But for operational feature management, env var is limited:

- requires restart;
- not auditable enough;
- not targeted per tenant/user;
- rollback is deployment-like;
- hard to coordinate across fleet.

Use proper feature flag/config platform if you need:

- gradual rollout;
- per-tenant enablement;
- emergency kill switch;
- audit trail;
- non-restart change;
- approval workflow.

Docker is not a feature flag system.

---

## 27. Decision Matrix

| Need | Prefer | Avoid |
|---|---|---|
| Image metadata | `ARG` + `LABEL` | runtime env only |
| Non-secret default | Dockerfile `ENV` | hardcoded app constants |
| Environment-specific non-secret config | runtime env / config file | baking into image |
| Long structured config | mounted config file | hundreds of env vars |
| Local dev variables | `.env.example` + ignored `.env` | committed `.env` with real secret |
| Runtime secret | secret file / secret manager | plain env var if avoidable |
| Build credential | BuildKit secret mount | `ARG`, `ENV`, `COPY secret` |
| Dynamic flag | feature flag system | Docker env var requiring restart |
| Java TLS private key | mounted secret/file | copy into image |
| Production promotion | image digest + runtime config | rebuild per environment |

---

## 28. Common Failure Modes

### 28.1 Application starts with wrong profile

Symptom:

```text
App connects to localhost DB in container
```

Cause:

```text
SPRING_PROFILES_ACTIVE not set or wrong
```

Diagnosis:

```bash
docker inspect app --format '{{json .Config.Env}}'
docker logs app
```

Fix:

```yaml
environment:
  SPRING_PROFILES_ACTIVE: local
```

### 28.2 Secret file path exists in env but file missing

Symptom:

```text
Cannot read /run/secrets/db_password
```

Cause:

- secret not granted to service;
- wrong secret name;
- wrong path;
- permission issue.

Diagnosis:

```bash
docker exec app ls -l /run/secrets
```

Fix:

```yaml
services:
  app:
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

### 28.3 `.env` value not visible inside container

Symptom:

```text
APP_PORT exists in .env but app cannot read APP_PORT
```

Cause:

`.env` used for Compose interpolation, not automatically injected as container env.

Fix:

```yaml
environment:
  APP_PORT: ${APP_PORT}
```

or:

```yaml
env_file:
  - .env
```

### 28.4 Config baked into image accidentally

Symptom:

```text
Changing env does nothing
```

Cause:

application loads packaged `application-prod.yml` first or hardcoded config.

Fix:

- inspect config precedence;
- mount external config;
- use `SPRING_CONFIG_IMPORT` / additional location;
- remove environment-specific config from image.

### 28.5 Secret appears in logs

Symptom:

```text
DATABASE_PASSWORD printed during startup
```

Cause:

- debug config dump;
- exception includes connection URL with password;
- framework logs environment;
- custom startup logging unsafe.

Fix:

- redact;
- avoid logging full env;
- sanitize JDBC URL;
- protect actuator/env endpoints.

### 28.6 Production uses mutable tag and hidden config

Symptom:

```text
Rollback to previous tag does not restore behavior
```

Cause:

- tag overwritten;
- config changed out-of-band;
- image and config not versioned as deployment unit.

Fix:

- deploy by digest;
- record config version;
- audit config changes;
- use release manifest.

---

## 29. Diagnostic Commands

Inspect environment:

```bash
docker inspect app --format '{{range .Config.Env}}{{println .}}{{end}}'
```

Inspect mounts:

```bash
docker inspect app --format '{{json .Mounts}}'
```

Check process env from inside container:

```bash
docker exec app env | sort
```

Check secret files:

```bash
docker exec app ls -l /run/secrets
```

Check config file mount:

```bash
docker exec app ls -l /config
```

Check image history for suspicious values:

```bash
docker history --no-trunc my-service:local
```

Check final image env defaults:

```bash
docker image inspect my-service:local --format '{{json .Config.Env}}'
```

Compose resolved config:

```bash
docker compose config
```

This is extremely useful because it shows what Compose thinks the final interpolated configuration is.

---

## 30. Production Checklist

Before shipping a Dockerized Java service, answer these:

### Build-time

- [ ] Are all build args non-secret?
- [ ] Are build credentials passed with BuildKit secret mount?
- [ ] Does Dockerfile avoid copying `.env`, `secrets/`, local config?
- [ ] Does `.dockerignore` exclude sensitive files?
- [ ] Does image metadata include version/revision without leaking secret?

### Runtime config

- [ ] Can same image digest run in all environments?
- [ ] Are environment-specific values injected at runtime?
- [ ] Are required config values validated at startup?
- [ ] Are config sources documented?
- [ ] Are config defaults safe?

### Secrets

- [ ] Are secrets not in Dockerfile `ARG`/`ENV`?
- [ ] Are secrets not hardcoded in Compose?
- [ ] Are secrets not logged?
- [ ] Are secret files mounted read-only?
- [ ] Are secret files readable by non-root runtime user?
- [ ] Are heap dumps/log bundles treated as sensitive?

### Java app

- [ ] Does config binding fail fast?
- [ ] Are sensitive properties redacted?
- [ ] Are TLS/truststore files externally mounted if environment-specific?
- [ ] Is actuator/env endpoint disabled or protected?
- [ ] Does startup log show config source without exposing secret values?

### Operations

- [ ] Is deployment recorded as image digest + config version?
- [ ] Is rollback procedure clear?
- [ ] Is config drift detectable?
- [ ] Are manual edits avoided?
- [ ] Is secret rotation possible without rebuilding image?

---

## 31. What Top Engineers Internalize

A beginner asks:

> “Where do I put this environment variable?”

A stronger engineer asks:

> “Is this value build-time or runtime?”

A senior engineer asks:

> “Is this configuration part of the artifact identity, runtime deployment identity, or operational control plane?”

A top-tier engineer asks:

> “Can I prove what code, image digest, config version, secret version, and runtime environment produced this behavior?”

That last question is the real goal.

Docker configuration is not just a convenience mechanism. It is part of:

- reproducibility;
- auditability;
- security;
- rollback;
- incident diagnosis;
- environment parity;
- developer productivity;
- production safety.

---

## 32. Key Takeaways

1. `ARG` is for build-time input, not runtime config and not secret.
2. Dockerfile `ENV` is image-level default, not a safe place for secret.
3. Runtime env is convenient for non-secret configuration.
4. `.env` in Compose is primarily interpolation input; do not confuse it with `env_file`.
5. `env_file` injects variables into container environment.
6. Mounted config files are better for structured configuration.
7. File-based secrets are safer than env var secrets in many Docker workflows.
8. BuildKit secret mount is the correct pattern for build-time credentials.
9. Java apps should validate config at startup and fail fast.
10. Same image digest should be promoted across environments with different runtime config.
11. Secret leakage often happens via logs, image history, build args, inspect output, heap dumps, and committed `.env` files.
12. Docker is not a dynamic config platform or enterprise secret manager by itself.

---

## 33. Mini Exercise

Create a small Java service config contract with these values:

```text
SERVER_PORT
SPRING_DATASOURCE_URL
SPRING_DATASOURCE_USERNAME
SPRING_DATASOURCE_PASSWORD_FILE
PAYMENT_BASE_URL
LOG_LEVEL
```

Then write:

1. `.env.example` with non-secret defaults;
2. `compose.yaml` that injects config;
3. `secrets/db_password.txt` ignored by Git;
4. app startup validation;
5. startup log that redacts sensitive values.

Success criteria:

- `docker compose config` shows expected interpolation;
- `docker inspect` does not show actual DB password;
- app fails fast if password file missing;
- app logs config source, not secret values;
- same image runs with different Compose override files.

---

## 34. References

- Docker Docs — Dockerfile reference: `ARG`, `ENV`, `RUN`, `COPY`, `LABEL`.
- Docker Docs — Build secrets and BuildKit secret mounts.
- Docker Docs — Build checks: `SecretsUsedInArgOrEnv`.
- Docker Docs — Compose environment variables, interpolation, and `env_file`.
- Docker Docs — Secrets in Compose.
- Docker Docs — Manage sensitive data with Docker secrets.
- Spring Boot Docs — Externalized Configuration and configuration trees.
- Spring Boot Docs — Type-safe configuration properties and validation.

---

## 35. End of Part 016

Kamu sekarang punya mental model untuk membedakan:

```text
build-time input
image default
runtime env
runtime config file
runtime secret file
application-level config binding
```

Part berikutnya akan masuk ke security boundary Docker:

```text
learn-docker-mastery-for-java-engineers-part-017.md
```

Topik berikutnya:

```text
Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor
```

Status series: belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-017.md">Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor ➡️</a>
</div>
