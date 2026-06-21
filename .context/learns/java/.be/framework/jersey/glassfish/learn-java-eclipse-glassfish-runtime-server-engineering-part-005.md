# learn-java-eclipse-glassfish-runtime-server-engineering-part-005

# Part 5 — Admin Console, REST Admin API, dan Configuration as Code

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: 5 dari 34/35 rencana utama  
> Fokus: memahami semua permukaan administrasi GlassFish dan membentuk disiplin configuration-as-code agar runtime dapat dipromosikan, diaudit, direproduksi, dan dipulihkan secara defensible.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas `asadmin` sebagai automation surface. Part ini memperluas perspektif:

- **Admin Console** adalah visual/interactive surface.
- **REST Admin API** adalah HTTP surface untuk integrasi dan tooling.
- **`asadmin`** adalah CLI surface yang paling umum dipakai untuk script.
- **`domain.xml`** adalah persistent model konfigurasi domain.
- **configuration-as-code** adalah disiplin agar perubahan runtime tidak berubah menjadi snowflake configuration.

Part ini tidak bertujuan membuat kita sekadar bisa klik-klik di console. Targetnya lebih tinggi:

> Kita ingin bisa memperlakukan GlassFish domain seperti sistem yang dapat dijelaskan, direkonstruksi, dibandingkan, diuji, dan dipromosikan antar environment.

Itulah bedanya operator biasa dan engineer yang benar-benar menguasai application server.

---

## 1. Mental Model Utama: GlassFish Punya Beberapa Control Surface

GlassFish tidak hanya punya satu cara administrasi. Ada beberapa pintu masuk ke model konfigurasi yang sama.

```text
                +----------------------+
                |  Human Administrator |
                +----------+-----------+
                           |
        +------------------+------------------+
        |                  |                  |
        v                  v                  v
+---------------+   +---------------+   +---------------+
| Admin Console |   |    asadmin    |   | REST Admin API|
+-------+-------+   +-------+-------+   +-------+-------+
        |                   |                   |
        +-------------------+-------------------+
                            |
                            v
                +----------------------+
                | GlassFish DAS/Admin  |
                +----------+-----------+
                           |
                           v
                +----------------------+
                |  Domain Config Model |
                +----------+-----------+
                           |
                           v
                +----------------------+
                |     domain.xml       |
                +----------------------+
```

Prinsip penting:

1. Console, CLI, dan REST bukan tiga konfigurasi berbeda.
2. Semuanya masuk ke administrative model yang dikelola DAS.
3. Persistent representation utamanya adalah `domain.xml` dan file pendukung lain di domain directory.
4. Karena ada banyak control surface, risiko config drift menjadi nyata.

Config drift terjadi ketika environment berubah karena operasi manual yang tidak tercatat dalam source control atau script provisioning.

Contoh drift:

```text
DEV:
  JDBC pool max = 32

UAT:
  JDBC pool max = 64

PROD:
  JDBC pool max = 96
  validation disabled by emergency fix
  stale JVM option left from incident
```

Masalahnya bukan hanya “beda config”. Masalahnya adalah tidak ada yang tahu:

- siapa yang mengubah,
- kapan berubah,
- mengapa berubah,
- apakah perubahan itu sengaja,
- apakah perubahan itu masih relevan,
- apakah environment berikutnya harus mengikuti,
- apakah rollback masih mungkin.

Engineer senior tidak hanya bertanya:

> “Config-nya apa?”

Tapi juga:

> “Config ini berasal dari mana, dibuktikan oleh apa, dan bagaimana cara mengulanginya secara deterministik?”

---

## 2. Control Surface 1: Admin Console

### 2.1 Apa Itu Admin Console

Admin Console adalah web UI bawaan GlassFish untuk mengelola domain. Secara default console berjalan di admin listener, umumnya port `4848` pada domain default.

Admin Console berguna untuk:

- melihat konfigurasi secara visual,
- mengeksplorasi struktur domain,
- melakukan troubleshooting cepat,
- melihat deployed applications,
- melihat resources,
- memeriksa pool, listeners, JVM options, dan monitoring,
- melakukan operasi manual pada environment non-production,
- onboarding engineer yang belum hafal `asadmin`.

Namun Admin Console berbahaya bila dijadikan satu-satunya cara konfigurasi production.

### 2.2 Kapan Admin Console Cocok Digunakan

Admin Console cocok untuk:

| Situasi | Cocok? | Alasan |
|---|---:|---|
| Local development | Ya | Cepat untuk eksplorasi |
| Training/onboarding | Ya | Visual dan mudah dipahami |
| Inspect current state | Ya | Lebih cepat daripada mencari dotted name |
| Emergency diagnosis | Ya, hati-hati | Bisa melihat state cepat |
| Production configuration change | Umumnya tidak | Sulit direproduksi bila tidak dicatat |
| Automated deployment | Tidak | Harus scriptable |
| Environment promotion | Tidak | Butuh deterministic automation |

### 2.3 Admin Console sebagai “Read Mostly Tool”

Untuk production-grade operation, pola sehatnya:

```text
Admin Console = inspection surface
asadmin/REST/script = mutation surface
Git/source control = declaration/history surface
```

Artinya:

- boleh buka console untuk melihat,
- boleh gunakan console untuk memahami,
- tapi perubahan permanen sebaiknya masuk lewat script yang dikontrol versi.

Mental model ini mengurangi risiko “someone clicked something in prod”.

### 2.4 Kesalahan Umum dengan Admin Console

#### Kesalahan 1 — Console sebagai sumber kebenaran

Tim mengubah setting via console lalu tidak menuliskannya ke script.

Akibat:

- environment baru tidak sama,
- DR restore tidak identik,
- prod hotfix hilang saat rebuild,
- audit trail lemah.

#### Kesalahan 2 — Mengira UI field sama dengan konsep runtime

Misalnya ada field pool size. Engineer junior melihat:

```text
Maximum Pool Size = 64
```

Lalu langsung menaikkannya ke 200.

Engineer senior bertanya dulu:

- DB max session berapa?
- Ada berapa instance GlassFish?
- Ada berapa application pool?
- Berapa concurrent request yang benar-benar melakukan SQL?
- Latency DB saat peak berapa?
- Apakah bottleneck pool atau slow query?
- Apakah increase pool size akan memindahkan bottleneck ke DB?

Console hanya menampilkan knob. Ia tidak memberi reasoning.

#### Kesalahan 3 — Production console dibuka terlalu luas

Admin Console adalah high-privilege interface. Kalau terekspos ke network luas, risikonya besar.

Baseline production:

- admin listener hanya accessible dari network administrasi,
- secure admin aktif untuk remote administration,
- credential kuat,
- akses dibatasi lewat firewall/security group,
- audit akses admin,
- tidak expose admin port ke public internet,
- tidak jadikan admin console sebagai dependency aplikasi.

---

## 3. Control Surface 2: `asadmin`

Part 4 sudah membahas detail `asadmin`. Di part ini kita posisikan `asadmin` dalam governance configuration.

### 3.1 Mengapa `asadmin` Biasanya Menjadi Surface Utama

`asadmin` cocok untuk configuration-as-code karena:

- scriptable,
- dapat dijalankan di CI/CD,
- dapat diberi password file,
- punya exit code,
- command-nya eksplisit,
- lebih mudah direview di Git,
- bisa dibuat idempotent,
- bisa dijalankan ulang.

Contoh:

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user='${DB_USER}':password='${DB_PASSWORD}':URL='${DB_URL}' \
  AppPool

asadmin create-jdbc-resource \
  --connectionpoolid AppPool \
  jdbc/AppDS
```

Tetapi contoh di atas belum production-ready karena:

- belum idempotent,
- credential raw muncul di command history/log,
- namespace resource tergantung GlassFish/Java EE/Jakarta EE version,
- belum ada validation config,
- belum ada target,
- belum ada environment separation.

### 3.2 `asadmin` sebagai Desired Mutation, Bukan Dump State

Ada dua gaya automation:

#### Gaya buruk

```bash
# blindly run everything
asadmin create-jdbc-connection-pool AppPool ...
asadmin create-jdbc-resource jdbc/AppDS ...
```

Kalau dijalankan ulang, command gagal karena resource sudah ada.

#### Gaya lebih baik

```bash
if asadmin list-jdbc-connection-pools | grep -q '^AppPool$'; then
  echo 'AppPool exists, updating selected attributes'
  asadmin set resources.jdbc-connection-pool.AppPool.max-pool-size=64
else
  echo 'Creating AppPool'
  asadmin create-jdbc-connection-pool ... AppPool
fi
```

#### Gaya matang

```text
1. Read current state.
2. Compare with desired state.
3. Apply minimal safe mutation.
4. Verify result.
5. Emit audit log.
6. Fail fast on mismatch.
```

Itu pola configuration-as-code yang sehat.

---

## 4. Control Surface 3: REST Admin API

### 4.1 Apa Itu REST Admin API

GlassFish menyediakan REST administration interface untuk mengakses operasi administrasi melalui HTTP. Secara konseptual, REST Admin API memungkinkan tool eksternal berinteraksi dengan DAS tanpa menjalankan CLI lokal.

Surface ini berguna untuk:

- integrasi dengan control plane custom,
- remote administration tooling,
- automation dari sistem non-shell,
- inspeksi configuration/runtime state,
- membangun internal admin dashboard,
- pipeline yang ingin berinteraksi via HTTP.

Namun REST Admin API harus diperlakukan sebagai high-privilege administrative interface, sama seperti Admin Console dan `asadmin` remote.

### 4.2 REST API Bukan Public API Aplikasi

Kesalahan serius:

> Menganggap REST Admin API seperti API bisnis biasa.

REST Admin API tidak boleh:

- dibuka ke end user,
- diekspos ke public internet,
- dipakai frontend aplikasi,
- dimasukkan ke reverse proxy public path,
- dipakai tanpa authentication kuat,
- dicampur dengan traffic bisnis.

REST Admin API adalah control plane endpoint.

Mental model:

```text
Business API  = data plane for users
Admin REST API = control plane for operators/tools
```

Keduanya harus dipisahkan secara network, credential, audit, dan lifecycle.

### 4.3 REST Admin API vs `asadmin`

| Aspek | `asadmin` | REST Admin API |
|---|---|---|
| Interface | CLI | HTTP |
| Human usage | Sangat baik | Kurang nyaman manual |
| Script shell | Sangat baik | Perlu curl/client |
| CI/CD | Sangat baik | Baik |
| Custom dashboard | Kurang cocok | Cocok |
| Remote control | Bisa | Bisa |
| Authentication | Admin credential/password file | Admin credential/session/token depending setup |
| Auditability | Bagus jika script di Git | Bagus jika client request logged |
| Risiko exposure | Tinggi bila remote admin terbuka | Tinggi bila endpoint terbuka |

Rule praktis:

- Gunakan `asadmin` untuk provisioning/deployment script umum.
- Gunakan REST Admin API bila automation memang HTTP-native atau butuh integrasi control plane.
- Jangan expose keduanya secara sembarangan.

### 4.4 REST Admin API dalam Architecture Diagram

```text
+---------------------+       HTTPS/admin network       +----------------+
| CI/CD Pipeline      | ------------------------------> | GlassFish DAS  |
| Internal Tool       |                                 | Admin REST API |
| Ops Dashboard       |                                 +-------+--------+
+---------------------+                                         |
                                                                  v
                                                        +----------------+
                                                        | Domain Config  |
                                                        | Runtime State  |
                                                        +----------------+
```

Security boundary-nya harus jelas:

- hanya internal network,
- TLS,
- admin credential protected,
- least privilege kalau tersedia,
- log akses,
- rate limit bila diletakkan di gateway internal,
- jangan reuse credential aplikasi.

---

## 5. `domain.xml`: Persistent Representation dari Domain Model

### 5.1 Apa Itu `domain.xml`

`domain.xml` adalah file konfigurasi utama domain GlassFish. Di dalamnya tersimpan sebagian besar konfigurasi seperti:

- server instances,
- configs,
- network listeners,
- thread pools,
- JVM options,
- resources,
- applications,
- security services,
- transaction service,
- monitoring service,
- HTTP service,
- connector service,
- JMS service,
- EJB container settings,
- web container settings.

Lokasi umumnya:

```text
${GLASSFISH_HOME}/glassfish/domains/<domain-name>/config/domain.xml
```

Namun secara konseptual jangan terlalu bergantung pada path absolut. Yang penting adalah:

```text
domain directory = mutable state
domain.xml       = central configuration representation
```

### 5.2 `domain.xml` Bukan Sekadar File XML

Banyak engineer melihat `domain.xml` sebagai file biasa. Ini berbahaya.

Mental model yang lebih tepat:

```text
asadmin/Admin Console/REST
        |
        v
admin model validation
        |
        v
config persistence
        |
        v
domain.xml
```

Artinya:

- `domain.xml` adalah persisted state,
- tapi perubahan idealnya melewati admin model,
- karena admin command dapat melakukan validasi, side effect, reload, restart marker, dan update runtime state.

### 5.3 Kapan Boleh Edit `domain.xml` Manual?

Secara umum:

> Jangan edit `domain.xml` manual jika perubahan yang sama bisa dilakukan dengan `asadmin`.

Namun ada kasus tertentu di mana manual edit bisa masuk akal:

- server tidak bisa start karena config corrupt,
- emergency recovery,
- perubahan massal offline yang sangat hati-hati,
- restore dari backup,
- investigasi diff,
- migration tooling internal,
- lab environment.

Jika manual edit dilakukan, syarat minimal:

1. stop domain dulu,
2. backup `domain.xml`,
3. edit minimal,
4. validasi XML well-formed,
5. start domain,
6. verify via `asadmin get/list`,
7. commit perubahan equivalent ke script/source control,
8. dokumentasikan alasan.

### 5.4 `domain.xml.bak` Bukan Strategy Backup

GlassFish dapat membuat backup config ketika konfigurasi berubah melalui tool admin. Tetapi file backup lokal bukan pengganti backup strategy.

Backup matang harus mencakup:

- `domain.xml`,
- keystore/truststore,
- password alias/master password handling,
- deployed artifacts atau referensinya,
- generated config penting,
- broker data bila memakai embedded JMS broker,
- custom libraries di domain/server lib,
- environment-specific properties,
- script provisioning,
- documented version matrix.

`domain.xml.bak` berguna untuk recovery kecil, bukan untuk DR plan.

---

## 6. Configuration as Code: Apa yang Sebenarnya Kita Inginkan?

### 6.1 Definisi Praktis

Configuration-as-code untuk GlassFish berarti:

> Semua konfigurasi yang penting untuk membuat domain berjalan harus dapat dibuat ulang dari source-controlled artifacts, bukan dari ingatan admin atau klik manual.

Bukan berarti semua hal harus ditulis sebagai XML. Justru sering lebih sehat memakai:

- shell script,
- PowerShell script,
- `asadmin` command list,
- environment template,
- secret injection,
- validation script,
- README/runbook,
- diff policy.

### 6.2 Desired State vs Mutation Script

Ada dua pendekatan besar.

#### Pendekatan A — Mutation Script

Script berisi perintah:

```bash
asadmin create-threadpool ...
asadmin set ...
asadmin create-jdbc-connection-pool ...
asadmin deploy ...
```

Kelebihan:

- mudah dipahami,
- dekat dengan operasi GlassFish,
- cepat dibuat,
- cocok untuk tim kecil.

Kekurangan:

- idempotency harus dibuat manual,
- sulit diff desired state secara murni,
- raw command bisa panjang.

#### Pendekatan B — Desired State Manifest + Reconciler

Manifest:

```yaml
domain:
  name: aceas-prod
  http:
    listener:
      port: 8080
      maxHeaderSize: 32768
  jdbc:
    pools:
      AppPool:
        maxPoolSize: 64
        validation: true
  jvm:
    options:
      - -Xms4g
      - -Xmx4g
```

Tool internal membaca manifest, membandingkan state GlassFish, lalu apply perubahan.

Kelebihan:

- lebih deklaratif,
- mudah review,
- bisa dibuat drift detection,
- cocok enterprise besar.

Kekurangan:

- perlu tooling tambahan,
- kompleksitas reconciler,
- harus mapping manifest ke command GlassFish.

Untuk kebanyakan tim, mulai dari mutation script yang idempotent sudah cukup baik.

---

## 7. Struktur Repository Configuration-as-Code yang Direkomendasikan

Contoh struktur sederhana:

```text
glassfish-runtime/
  README.md
  versions/
    glassfish-8.0.2.md
    java-21.md
  environments/
    dev.env.example
    uat.env.example
    prod.env.example
  scripts/
    common.sh
    00-check-prerequisites.sh
    01-create-domain.sh
    02-secure-admin.sh
    03-configure-jvm.sh
    04-configure-network.sh
    05-configure-thread-pools.sh
    06-configure-jdbc.sh
    07-configure-jms.sh
    08-configure-logging.sh
    09-configure-monitoring.sh
    10-deploy-app.sh
    90-verify-runtime.sh
    99-export-effective-config.sh
  manifests/
    dev.yaml
    uat.yaml
    prod.yaml
  snapshots/
    README.md
  docs/
    runbook.md
    rollback.md
    drift-detection.md
```

Untuk Windows-oriented team:

```text
glassfish-runtime/
  scripts/
    common.ps1
    00-check-prerequisites.ps1
    01-create-domain.ps1
    02-secure-admin.ps1
    ...
```

Prinsip:

- script dipisah berdasarkan responsibility,
- nama urut agar mudah dijalankan,
- semua script bisa re-run atau fail dengan pesan jelas,
- secret tidak commit,
- environment file memakai template,
- hasil final bisa diverifikasi.

---

## 8. Apa Saja yang Harus Masuk Source Control?

### 8.1 Harus Masuk Source Control

| Item | Alasan |
|---|---|
| Script create domain | Reproducibility |
| Script configure JVM | Performance baseline |
| Script configure HTTP/listener | Network behavior |
| Script configure JDBC pool | Capacity and DB safety |
| Script configure JMS | Messaging reliability |
| Script configure security realm | Auth behavior |
| Script configure logging | Troubleshooting consistency |
| Script configure monitoring | Observability baseline |
| Deployment script | Release repeatability |
| Verification script | Automated confidence |
| Version matrix | Upgrade defensibility |
| Runbook | Operational continuity |
| Rollback procedure | Incident readiness |

### 8.2 Tidak Boleh Masuk Source Control Secara Raw

| Item | Alternatif |
|---|---|
| DB password | Secret manager/password alias/env injection |
| Admin password | Password file generated securely |
| Private key | Secret store/KMS/secure vault |
| Keystore password | Secret store/password alias |
| Production certificate private material | Secure certificate management |
| Real user data | Never commit |
| Internal endpoint sensitive | Template + protected env config |

### 8.3 Boleh Masuk Source Control dengan Sanitization

| Item | Catatan |
|---|---|
| `domain.xml` snapshot | Sanitize secrets, treat as evidence not source of truth |
| Log sample | Redact PII/secrets/token |
| Thread dump | Check for secrets in thread names/system props |
| Heap histogram | Usually safer than heap dump |
| Config diff | Redact endpoints/credential |

---

## 9. Environment Promotion Model

### 9.1 Masalah Umum

Banyak tim punya pola seperti ini:

```text
DEV configured manually
UAT copied partially
PROD adjusted during incidents
```

Akibatnya, bug muncul hanya di UAT/PROD karena config tidak sama.

### 9.2 Model yang Lebih Matang

```text
Base config
   |
   +-- dev overlay
   +-- sit overlay
   +-- uat overlay
   +-- prod overlay
```

Base config berisi hal yang harus sama:

- server version,
- Java baseline,
- major JVM strategy,
- listener structure,
- resource names,
- JNDI names,
- logging pattern,
- monitoring baseline,
- security posture,
- deployment shape.

Overlay environment berisi hal yang memang boleh beda:

- port,
- hostname,
- DB URL,
- credential reference,
- pool size berdasarkan capacity,
- heap size berdasarkan node size,
- log retention,
- target cluster/instance,
- external integration endpoints.

### 9.3 Contoh Environment Overlay

```text
base:
  jdbc/AppDS exists
  AppPool validation enabled
  request access log enabled
  secure admin required
  health endpoint required

DEV:
  max pool size = 16
  heap = 2g
  DB = dev-db

UAT:
  max pool size = 32
  heap = 4g
  DB = uat-db

PROD:
  max pool size = 64
  heap = 8g
  DB = prod-db
```

Yang penting bukan menyamakan semua angka, tapi menyamakan **struktur dan policy**.

---

## 10. Drift Detection

### 10.1 Apa Itu Drift Detection

Drift detection adalah proses membandingkan expected configuration dengan actual runtime configuration.

```text
Expected config in Git
        |
        v
Compare ---- actual config from GlassFish
        |
        v
Report drift
```

### 10.2 Sumber Actual Config

Actual state bisa diambil dari:

- `asadmin get/list`,
- REST Admin API,
- exported `domain.xml`,
- filesystem snapshot,
- admin console manual inspection.

Untuk automation, pilih:

```text
asadmin/REST for structured queries
sanitized domain.xml snapshot for forensic diff
```

### 10.3 Drift yang Penting Dideteksi

Tidak semua perbedaan sama pentingnya.

High-risk drift:

- secure admin disabled,
- admin password changed outside process,
- debug port enabled,
- JDBC validation disabled,
- JDBC pool size changed massively,
- JVM heap changed,
- GC option changed,
- application version mismatch,
- resource target changed,
- TLS config changed,
- classpath/server library changed,
- monitoring disabled,
- access log disabled.

Low-risk drift:

- timestamp,
- generated internal ID,
- runtime cache,
- non-functional ordering noise,
- temporary deployment marker.

### 10.4 Drift Detection Script Concept

Pseudo-flow:

```text
1. Read expected config manifest.
2. Query GlassFish runtime.
3. Normalize actual state.
4. Compare selected keys only.
5. Classify drift severity.
6. Fail pipeline on critical drift.
7. Generate report.
```

Example selected keys:

```text
configs.server-config.java-config.jvm-options
configs.server-config.network-config.network-listeners
resources.jdbc-connection-pool.*.max-pool-size
resources.jdbc-resource.*.pool-name
servers.server.*.application-ref
servers.server.*.resource-ref
```

---

## 11. Effective Configuration Export

### 11.1 Mengapa Export Dibutuhkan

Setelah script dijalankan, kita perlu membuktikan hasilnya.

Jangan hanya percaya:

```text
script completed successfully
```

Tapi ambil evidence:

```text
runtime actual config after provisioning
```

### 11.2 Bentuk Export

Export dapat berupa:

- output `asadmin get` selected keys,
- output `asadmin list-*`,
- sanitized copy `domain.xml`,
- generated markdown report,
- JSON/YAML normalized state.

Contoh report:

```text
GlassFish Runtime Effective Config
Environment: UAT
Domain: aceas-uat
GlassFish: 8.0.2
Java: 21.0.x
Generated at: 2026-06-21T10:00:00+07:00

JVM:
  Xms: 4g
  Xmx: 4g
  GC: G1GC

HTTP:
  http-listener-1: 8080
  admin-listener: 4848 internal only

JDBC:
  jdbc/AppDS -> AppPool
  AppPool max: 32
  validation: enabled

Security:
  secure admin: enabled

Applications:
  aceas.war version: 2026.06.21-1
```

Ini sangat berguna untuk audit, incident review, dan environment comparison.

---

## 12. Secrets Handling dalam Configuration-as-Code

### 12.1 Prinsip

Configuration-as-code bukan berarti secret-as-code.

Pisahkan:

```text
Non-secret config -> Git
Secret material    -> secret manager / protected injection
```

### 12.2 Cara yang Umum Dipakai

Pilihan:

1. GlassFish password alias.
2. Environment variable injection.
3. External secret manager.
4. Kubernetes Secret.
5. CI/CD protected secret variable.
6. Mounted secret file.

### 12.3 Password File untuk `asadmin`

Untuk automation, hindari interactive password.

Contoh konsep password file:

```text
AS_ADMIN_PASSWORD=...
AS_ADMIN_MASTERPASSWORD=...
```

Namun password file harus:

- dibuat saat runtime pipeline,
- permission ketat,
- tidak dicetak ke log,
- dihapus setelah selesai,
- tidak masuk repository.

### 12.4 Secret Reference Pattern

Daripada menyimpan password raw:

```yaml
jdbc:
  AppPool:
    user: ${DB_USER}
    password: ${DB_PASSWORD}
```

Atau:

```yaml
jdbc:
  AppPool:
    passwordAlias: prod-db-password
```

Tujuannya adalah script tahu **referensi**, bukan nilai rahasia.

---

## 13. Designing Idempotent GlassFish Configuration Scripts

### 13.1 Idempotency

Script idempotent dapat dijalankan berkali-kali dan menghasilkan state yang sama.

Contoh tidak idempotent:

```bash
asadmin create-jdbc-resource --connectionpoolid AppPool jdbc/AppDS
```

Jalan pertama sukses. Jalan kedua gagal karena resource sudah ada.

### 13.2 Idempotent Create-or-Update Pattern

Pseudo:

```bash
if resource_exists jdbc/AppDS; then
  ensure jdbc/AppDS points to AppPool
else
  create jdbc/AppDS
fi
```

### 13.3 Guardrail Pattern

Kadang script tidak boleh overwrite state tertentu tanpa explicit flag.

Contoh:

```text
If existing JDBC pool points to different DB URL:
  - fail by default
  - require FORCE=true for intentional change
```

Ini penting untuk mencegah script salah environment merusak PROD.

### 13.4 Verify-after-Write Pattern

Setelah `set`, baca ulang.

```text
set max-pool-size=64
get max-pool-size
assert actual == 64
```

Kalau tidak verify, kita tidak tahu apakah command benar-benar menghasilkan state yang diinginkan.

### 13.5 Restart-required Awareness

Tidak semua konfigurasi GlassFish efektif langsung tanpa restart. Ada perubahan yang memerlukan restart atau redeploy.

Script matang harus mengklasifikasikan:

- dynamic change,
- requires restart,
- requires instance restart,
- requires app redeploy,
- requires cluster rolling restart.

Output script sebaiknya menyatakan:

```text
Changed JVM option: restart required
Changed JDBC validation: dynamic or restart depending resource usage
Changed listener port: restart required
```

---

## 14. Configuration Layers

GlassFish runtime configuration biasanya punya beberapa layer:

```text
Layer 0: JDK/JVM installation
Layer 1: GlassFish installation
Layer 2: Domain creation
Layer 3: Domain admin/security
Layer 4: Network listeners and protocols
Layer 5: JVM options
Layer 6: Resources: JDBC/JMS/JCA/mail/etc.
Layer 7: Container services: web/EJB/transaction/security
Layer 8: Logging and monitoring
Layer 9: Application deployment
Layer 10: Runtime verification
```

Kenapa perlu layer?

Karena order matter.

Contoh:

- Tidak bisa deploy app yang butuh `jdbc/AppDS` sebelum resource dibuat.
- Tidak bisa remote admin sebelum secure admin dan credential benar.
- Tidak bisa validate DB pool sebelum secret tersedia.
- Tidak bisa expose health check sebelum aplikasi deploy.

Script harus mengikuti dependency graph, bukan urutan acak.

---

## 15. Configuration Dependency Graph

Contoh graph sederhana:

```text
JDK
 |
GlassFish installation
 |
Domain
 |
Admin user / secure admin
 |
JVM options
 |
Network listeners
 |
Resources
 |       
 |---- JDBC pool ---- JDBC resource ----+
 |---- JMS factory -- destination ------+-- Application deployment
 |---- Mail session --------------------+
                                      |
                                      v
                               Smoke test / verification
```

Jika ada failure, dependency graph membantu diagnosis.

Contoh:

```text
Deployment failed: NameNotFoundException jdbc/AppDS
```

Kemungkinan:

- JDBC resource belum dibuat,
- resource dibuat tapi target salah,
- JNDI name beda,
- app descriptor salah,
- resource tidak enabled,
- deployment target beda dari resource target.

Engineer yang memahami graph tidak hanya “coba redeploy”.

---

## 16. Admin Console, REST, dan Config-as-Code dalam Environment Nyata

### 16.1 Local Development

Prioritas:

- cepat jalan,
- mudah inspect,
- boleh banyak manual,
- script minimal tetap berguna.

Model:

```text
Developer uses:
  - asadmin start-domain
  - Admin Console for exploration
  - simple bootstrap script
```

### 16.2 Shared DEV/SIT

Prioritas:

- environment reproducible,
- shared config tidak random,
- developer tidak saling merusak.

Model:

```text
Team uses:
  - source-controlled bootstrap scripts
  - restricted admin access
  - periodic config snapshot
```

### 16.3 UAT

Prioritas:

- near-production behavior,
- release validation,
- controlled changes,
- evidence for sign-off.

Model:

```text
UAT uses:
  - CI/CD deployment
  - script-only config mutation
  - effective config export
  - drift report before release
```

### 16.4 Production

Prioritas:

- controlled mutation,
- auditability,
- least privilege,
- rollback,
- incident traceability.

Model:

```text
Production uses:
  - no ad-hoc console change except approved emergency
  - admin network only
  - secure admin
  - CI/CD or controlled ops scripts
  - drift detection
  - config snapshot after every release
  - runbook and rollback plan
```

---

## 17. Handling Emergency Production Changes

Reality: kadang production perlu emergency change.

Contoh:

- JDBC pool exhausted,
- admin needs to disable broken app,
- listener config needs urgent fix,
- JVM option workaround,
- logging level temporarily raised,
- failed deployment must be rolled back.

Emergency bukan alasan menghapus disiplin. Gunakan model:

```text
1. Declare incident/change reason.
2. Capture current config snapshot.
3. Apply minimal change.
4. Verify effect.
5. Capture post-change snapshot.
6. Create follow-up ticket to codify change.
7. Reconcile Git/script with production if change remains.
8. Revert temporary setting if no longer needed.
```

### 17.1 Temporary Logging Change Example

Misalnya menaikkan log level untuk troubleshooting.

Risiko:

- log volume naik,
- disk penuh,
- PII lebih banyak terekam,
- performance turun,
- lupa dikembalikan.

Maka emergency change harus punya expiry:

```text
Change:
  com.example.payment logger -> FINE
Reason:
  diagnose payment callback timeout
Expiry:
  revert within 2 hours
Verification:
  log line appears with correlation id
Rollback:
  set logger back to INFO
```

---

## 18. Configuration Review Checklist

Sebelum konfigurasi GlassFish dipromosikan ke UAT/PROD, review ini:

### 18.1 Version Review

- GlassFish version jelas.
- JDK version jelas.
- Jakarta EE/Java EE namespace jelas.
- JDBC driver version jelas.
- Application artifact version jelas.

### 18.2 Admin Security Review

- Admin password bukan default.
- Secure admin aktif bila remote admin digunakan.
- Admin port tidak public.
- Admin access dibatasi.
- Password file tidak tersimpan di repository.
- Audit admin access tersedia.

### 18.3 Resource Review

- JDBC resource names konsisten.
- Pool size sesuai DB capacity.
- Validation enabled.
- Leak detection dipertimbangkan.
- JMS destination target benar.
- Mail/session/resource adapter tidak pakai secret raw.

### 18.4 Runtime Review

- Heap sizing sesuai node/container.
- GC strategy eksplisit.
- Thread pool tidak asal besar.
- HTTP listener/proxy settings benar.
- Access log policy jelas.
- Monitoring enabled.

### 18.5 Deployment Review

- App deployed to correct target.
- Resource target matches app target.
- Context root benar.
- Rollback artifact tersedia.
- Smoke test jelas.
- Health check jelas.

### 18.6 Drift Review

- Actual config dibanding dengan expected.
- Perbedaan high-risk diselesaikan.
- Snapshot disimpan.
- Emergency manual change sudah dikodifikasi atau direvert.

---

## 19. Anti-Patterns yang Harus Dihindari

### Anti-pattern 1 — Console-driven Production

Semua perubahan via UI, tidak ada script.

Akibat:

- tidak reproducible,
- audit lemah,
- environment drift,
- knowledge hilang saat admin resign.

### Anti-pattern 2 — `domain.xml` Copy-Paste antar Environment

Menyalin `domain.xml` dari DEV ke PROD.

Risiko:

- port salah,
- host salah,
- password alias tidak cocok,
- target instance/cluster beda,
- resource reference rusak,
- hidden legacy config ikut terbawa.

Better:

```text
Use script/manifest + environment overlay
```

### Anti-pattern 3 — Semua Config Disimpan sebagai Secret

Kadang tim terlalu takut lalu semua config disimpan di secret manager.

Akibat:

- susah review,
- susah diff,
- tidak transparan,
- audit buruk.

Yang benar:

```text
Secret value -> secret manager
Non-secret desired config -> Git
```

### Anti-pattern 4 — One Big Script

Satu script 2000 baris untuk semua.

Masalah:

- susah debug,
- susah reuse,
- susah rollback parsial,
- tidak jelas dependency.

Better:

```text
small ordered scripts + common functions + verification
```

### Anti-pattern 5 — Tidak Ada Verification

Script sukses dianggap cukup.

Padahal:

- command bisa no-op,
- target salah,
- value tidak efektif sampai restart,
- app deploy tapi disabled,
- resource dibuat tapi tidak referenced.

Always verify.

### Anti-pattern 6 — Treating Admin REST as Public Integration API

REST Admin API dipanggil dari aplikasi bisnis atau frontend.

Ini pelanggaran boundary.

Admin API adalah control plane, bukan business plane.

---

## 20. Practical Blueprint: Minimal Production-Grade Admin Model

### 20.1 Minimal Tools

Minimal production setup:

```text
- Git repository for GlassFish runtime config
- asadmin bootstrap scripts
- environment templates
- secret injection mechanism
- effective config export script
- drift detection script
- restricted admin network
- secure admin
- runbook
```

### 20.2 Minimal Script Flow

```text
00-check-prerequisites
01-create-or-validate-domain
02-configure-admin-security
03-configure-jvm
04-configure-network
05-configure-resources
06-configure-logging
07-configure-monitoring
08-deploy-application
09-run-smoke-test
10-export-effective-config
```

### 20.3 Minimal Governance Flow

```text
Pull Request:
  - config change reviewed
  - reason documented
  - impact assessed

Pipeline:
  - apply config
  - verify runtime
  - export effective config

Release:
  - snapshot saved
  - rollback known
  - drift report clean
```

---

## 21. Example: Idempotent Configuration Pattern in Bash

> Ini pseudo-production pattern. Sesuaikan command detail dengan versi GlassFish dan environment.

```bash
#!/usr/bin/env bash
set -euo pipefail

ASADMIN="${GLASSFISH_HOME}/bin/asadmin"
PASSWORD_FILE="${PASSWORD_FILE:?PASSWORD_FILE is required}"
TARGET="${TARGET:-server}"
POOL_NAME="AppPool"
JDBC_RESOURCE="jdbc/AppDS"

run_asadmin() {
  "$ASADMIN" --user admin --passwordfile "$PASSWORD_FILE" "$@"
}

exists_jdbc_pool() {
  run_asadmin list-jdbc-connection-pools | grep -qx "$POOL_NAME"
}

exists_jdbc_resource() {
  run_asadmin list-jdbc-resources | grep -qx "$JDBC_RESOURCE"
}

ensure_pool() {
  if exists_jdbc_pool; then
    echo "JDBC pool exists: $POOL_NAME"
    run_asadmin set "resources.jdbc-connection-pool.${POOL_NAME}.max-pool-size=64"
    run_asadmin set "resources.jdbc-connection-pool.${POOL_NAME}.is-connection-validation-required=true"
  else
    echo "Creating JDBC pool: $POOL_NAME"
    run_asadmin create-jdbc-connection-pool \
      --datasourceclassname oracle.jdbc.pool.OracleDataSource \
      --restype javax.sql.DataSource \
      --property "user=${DB_USER}:password=${DB_PASSWORD}:URL=${DB_URL}" \
      "$POOL_NAME"
  fi
}

ensure_resource() {
  if exists_jdbc_resource; then
    echo "JDBC resource exists: $JDBC_RESOURCE"
  else
    echo "Creating JDBC resource: $JDBC_RESOURCE"
    run_asadmin create-jdbc-resource \
      --connectionpoolid "$POOL_NAME" \
      --target "$TARGET" \
      "$JDBC_RESOURCE"
  fi
}

verify() {
  echo "Verifying JDBC resource and pool"
  run_asadmin list-jdbc-connection-pools | grep -qx "$POOL_NAME"
  run_asadmin list-jdbc-resources | grep -qx "$JDBC_RESOURCE"
  run_asadmin get "resources.jdbc-connection-pool.${POOL_NAME}.max-pool-size"
}

ensure_pool
ensure_resource
verify
```

Catatan:

- Script di atas menunjukkan pattern, bukan final universal script.
- Untuk GlassFish modern/Jakarta namespace, sesuaikan `restype`/driver config.
- Hindari menaruh secret literal di command jika command akan masuk shell history/log.
- Untuk production, tambahkan logging, redaction, target validation, dan environment guard.

---

## 22. Example: Environment Guard

Salah satu kegagalan paling mahal adalah menjalankan script environment yang salah.

Tambahkan guard:

```bash
EXPECTED_ENV="prod"
ACTUAL_ENV="${ENVIRONMENT:?ENVIRONMENT is required}"

if [[ "$ACTUAL_ENV" != "$EXPECTED_ENV" ]]; then
  echo "Refusing to run: expected $EXPECTED_ENV but got $ACTUAL_ENV" >&2
  exit 20
fi

if [[ "${CONFIRM_PROD:-}" != "I_UNDERSTAND_THIS_IS_PROD" ]]; then
  echo "Refusing to run production mutation without explicit confirmation" >&2
  exit 21
fi
```

Untuk production, guard seperti ini bukan paranoid. Ini murah dibanding incident.

---

## 23. Example: Effective Config Report Script Concept

```bash
#!/usr/bin/env bash
set -euo pipefail

REPORT="effective-config-$(date +%Y%m%d-%H%M%S).txt"
ASADMIN="${GLASSFISH_HOME}/bin/asadmin"

{
  echo "GlassFish Effective Config"
  echo "Generated: $(date -Is)"
  echo

  echo "== Version =="
  "$ASADMIN" version || true
  java -version 2>&1 || true
  echo

  echo "== Applications =="
  "$ASADMIN" list-applications --long || true
  echo

  echo "== JDBC Resources =="
  "$ASADMIN" list-jdbc-resources || true
  echo

  echo "== JDBC Pools =="
  "$ASADMIN" list-jdbc-connection-pools || true
  echo

  echo "== Selected JVM Options =="
  "$ASADMIN" list-jvm-options || true
  echo

  echo "== Network Listeners =="
  "$ASADMIN" get 'configs.config.server-config.network-config.network-listeners.*' || true
  echo

} > "$REPORT"

echo "Report written to $REPORT"
```

Production version harus redact secret dan jangan dump semua config mentah tanpa filter.

---

## 24. How Top Engineers Think About GlassFish Configuration

Engineer biasa melihat:

```text
I need to set a value.
```

Engineer senior melihat:

```text
I need to change runtime behavior safely.
```

Engineer principal melihat:

```text
I need a reproducible, reviewable, auditable, reversible change to the runtime control plane, with known effect on data plane behavior.
```

Perbedaannya besar.

### 24.1 Pertanyaan yang Harus Selalu Ditanyakan

Sebelum mengubah config:

1. Apa behavior yang ingin diubah?
2. Apakah ini app-level atau server-level?
3. Apakah perubahan ini dynamic atau butuh restart?
4. Apa target-nya: server, instance, cluster, config?
5. Apakah resource/app berada pada target yang sama?
6. Apa dampak ke capacity?
7. Apa dampak ke security?
8. Apa dampak ke rollback?
9. Bagaimana memverifikasi hasilnya?
10. Bagaimana mencegah drift?

### 24.2 Invariant Penting

Beberapa invariant production:

```text
Every production config change must be explainable.
Every persistent config change must be reproducible.
Every manual emergency change must be reconciled.
Every secret must be separated from normal config.
Every deployment must be verifiable.
Every environment difference must be intentional.
Every admin surface must be protected.
```

---

## 25. Mini Case Study: JDBC Pool Changed via Console

### 25.1 Scenario

Production mengalami timeout. Seorang admin membuka Admin Console dan menaikkan JDBC pool dari 64 ke 200.

Timeout turun sementara.

Besok DB CPU naik, session penuh, aplikasi lain ikut lambat.

### 25.2 Analisis Dangkal

```text
Pool 64 kurang, jadi dinaikkan.
```

### 25.3 Analisis yang Benar

Pertanyaan:

- Apakah timeout karena pool exhaustion atau DB query lambat?
- Berapa active connections saat incident?
- Berapa wait queue?
- Berapa DB max sessions?
- Ada berapa instance GlassFish?
- Pool 200 per instance atau total?
- Apakah semua endpoint memakai pool yang sama?
- Apakah ada connection leak?
- Apakah validation query lambat?
- Apakah transaction timeout terlalu panjang?
- Apakah thread HTTP habis karena menunggu DB?

### 25.4 Config-as-Code Response

Langkah matang:

```text
1. Capture pre-change metrics.
2. Apply temporary increase with explicit expiry.
3. Verify if pool wait decreases.
4. Check DB saturation.
5. Investigate slow/leaking queries.
6. Decide final pool size using capacity model.
7. Commit final config to Git.
8. Revert temporary console change if not approved.
9. Add alert for pool wait time.
```

### 25.5 Lesson

Console change boleh menyelamatkan incident, tapi tidak boleh menjadi arsitektur permanen tanpa governance.

---

## 26. Mini Case Study: `domain.xml` Edited Manually and Server Won’t Start

### 26.1 Scenario

Engineer mengedit `domain.xml` manual untuk menambah JVM option. Setelah restart, domain gagal start.

### 26.2 Kemungkinan Penyebab

- XML tidak well-formed.
- JVM option salah escape.
- Option tidak supported oleh JDK version.
- Duplicate option conflict.
- Urutan option berpengaruh.
- Typo dalam element/attribute.
- File permission berubah.
- Encoding issue.

### 26.3 Recovery

```text
1. Jangan langsung edit lagi secara acak.
2. Ambil copy domain.xml saat ini.
3. Bandingkan dengan domain.xml.bak atau snapshot terakhir.
4. Validasi XML.
5. Revert perubahan minimal.
6. Start domain.
7. Terapkan option via asadmin jika memungkinkan.
8. Commit script perubahan yang benar.
```

### 26.4 Lesson

Manual edit bukan dilarang mutlak, tapi harus diperlakukan seperti surgery.

---

## 27. Practical Commands to Explore Configuration

Beberapa command eksplorasi:

```bash
asadmin list-domains
asadmin start-domain domain1
asadmin stop-domain domain1
asadmin list-applications
asadmin list-jdbc-resources
asadmin list-jdbc-connection-pools
asadmin list-jvm-options
asadmin get '*'
asadmin get 'configs.config.server-config.*'
asadmin get 'resources.*'
asadmin get 'servers.server.*'
```

Hati-hati dengan:

```bash
asadmin get '*'
```

Output bisa sangat besar dan mungkin memuat informasi sensitif tergantung config.

Untuk production, gunakan selected key.

---

## 28. Designing Admin Access Policy

### 28.1 Role Separation

Minimal role separation:

| Role | Permission |
|---|---|
| Developer | Local/dev domain admin only |
| Release engineer | Deploy to UAT/PROD via pipeline |
| Operator | Start/stop/restart, inspect, emergency runbook |
| Platform engineer | Runtime config mutation |
| Security admin | realm/TLS/admin credential/security policy |
| Auditor | read-only evidence/report |

GlassFish built-in admin model mungkin tidak selalu memenuhi granular role yang kita inginkan. Maka enforcement sering dilakukan di luar:

- network boundary,
- CI/CD permission,
- OS account,
- secret manager permission,
- Git branch protection,
- approval workflow.

### 28.2 Do Not Share Admin Credentials Casually

Credential sharing membuat audit sulit.

Better:

- individual access where possible,
- pipeline service account,
- break-glass credential,
- rotation policy,
- access logging,
- emergency access approval.

---

## 29. From ClickOps to Platform Engineering

Tahap kematangan tim:

### Level 0 — Manual ClickOps

- Admin console manual.
- Tidak ada script.
- Config knowledge di kepala orang.

### Level 1 — Scripted Operations

- Ada `asadmin` script.
- Sebagian config repeatable.
- Masih banyak manual adjustment.

### Level 2 — Idempotent Provisioning

- Script bisa rerun.
- Environment template jelas.
- Secret dipisah.
- Verification ada.

### Level 3 — Drift Detection

- Actual vs expected dibanding.
- Snapshot tersimpan.
- Release punya evidence.

### Level 4 — Runtime Platform

- Manifest/desired state.
- Automated reconciliation.
- Policy guardrails.
- Dashboards and alerts.
- Audit-ready by design.

Target top 1% bukan harus langsung Level 4, tapi tahu arah dan trade-off.

---

## 30. Summary Mental Model

Part ini bisa diringkas sebagai berikut:

```text
Admin Console  = visual inspection and manual administration surface
asadmin        = primary scriptable automation surface
REST Admin API = HTTP-based administrative integration surface
domain.xml     = persistent representation of domain configuration
Git/scripts    = desired and repeatable operational truth
```

Runtime yang matang tidak bergantung pada “server sudah pernah disetting”. Runtime yang matang bisa menjawab:

- Bagaimana domain ini dibuat?
- Bagaimana config ini berubah?
- Apa beda UAT dan PROD?
- Apa yang terjadi jika domain hilang dan harus dibuat ulang?
- Apa yang harus dilakukan kalau config corrupt?
- Bagaimana membuktikan resource sudah benar?
- Bagaimana rollback?
- Bagaimana tahu tidak ada drift?

---

## 31. Checklist Part 5

Setelah memahami part ini, Anda seharusnya bisa:

- menjelaskan perbedaan Admin Console, `asadmin`, REST Admin API, dan `domain.xml`,
- menentukan kapan memakai masing-masing control surface,
- menjelaskan kenapa Admin Console sebaiknya read-mostly di production,
- menjelaskan kenapa REST Admin API adalah control plane, bukan public API,
- merancang repository configuration-as-code untuk GlassFish,
- membuat konsep idempotent `asadmin` script,
- membedakan config dan secret,
- mendesain environment overlay,
- melakukan effective config export,
- memahami drift detection,
- menangani emergency manual change secara defensible,
- mereview konfigurasi GlassFish dengan perspektif production engineering.

---

## 32. Latihan Praktis

### Latihan 1 — Inventory Current Domain

Ambil domain local/dev dan buat inventory:

```text
- GlassFish version
- Java version
- domain name
- admin port
- HTTP port
- deployed applications
- JDBC resources
- JDBC pools
- JVM options
- enabled monitoring
```

Outputkan sebagai markdown.

### Latihan 2 — Buat Script Export Effective Config

Buat script yang menghasilkan report:

```text
effective-config-local.md
```

Isi minimal:

- version,
- JVM options,
- applications,
- JDBC resources,
- network listeners.

### Latihan 3 — Manual Change and Reconcile

Di local environment:

1. ubah satu setting via Admin Console,
2. cari perubahan di `domain.xml`,
3. cari command `asadmin` equivalent,
4. tulis script untuk mengulang perubahan itu,
5. revert manual change,
6. jalankan script,
7. verify hasilnya.

Tujuannya bukan perubahan setting-nya, tapi memahami mapping console → config → command.

### Latihan 4 — Drift Report

Buat file expected sederhana:

```text
expected:
  jdbc/AppDS exists
  AppPool max-pool-size = 32
  secure admin = enabled
```

Lalu buat script yang memeriksa actual state.

---

## 33. Common Interview / Principal-Level Questions

1. Kenapa Anda tidak merekomendasikan Admin Console sebagai cara utama konfigurasi production?
2. Apa bedanya `domain.xml` sebagai persisted config dan script provisioning sebagai desired config?
3. Kapan manual edit `domain.xml` dapat diterima?
4. Bagaimana mencegah config drift antar DEV/UAT/PROD?
5. Apa risiko expose REST Admin API?
6. Bagaimana Anda mendesain GlassFish configuration-as-code?
7. Bagaimana Anda memisahkan secret dari config?
8. Apa yang harus diverifikasi setelah deployment?
9. Apa yang harus dilakukan jika production emergency change dilakukan via console?
10. Bagaimana membuktikan environment UAT cukup representatif terhadap PROD?

---

## 34. Penutup

Part 5 membentuk fondasi governance runtime. Tanpa disiplin ini, GlassFish mudah berubah menjadi snowflake server: berjalan, tapi sulit dijelaskan dan sulit direproduksi.

GlassFish engineer yang kuat tidak hanya tahu cara deploy WAR. Ia tahu bagaimana membangun runtime yang:

- repeatable,
- observable,
- auditable,
- secure,
- recoverable,
- upgradeable,
- dan bisa dipahami oleh engineer lain.

Itu adalah perbedaan besar antara “bisa menjalankan server” dan “bisa menguasai runtime enterprise”.

---

## Referensi Resmi dan Bacaan Lanjutan

- Eclipse GlassFish Documentation — Administration Guide, Release 7/8.
- Eclipse GlassFish Documentation — Reference Manual, Release 8.
- Eclipse GlassFish Documentation — Security Guide, Release 8.
- Eclipse GlassFish Documentation — Application Deployment Guide, Release 8.
- Oracle/GlassFish historical documentation tentang `domain.xml`, admin tools, dan secure administration. Tetap berguna untuk konsep dasar, tetapi selalu verifikasi terhadap versi Eclipse GlassFish modern yang digunakan.

---

## Status Seri

- Part 0: selesai
- Part 1: selesai
- Part 2: selesai
- Part 3: selesai
- Part 4: selesai
- Part 5: selesai
- Part berikutnya: **Part 6 — Bootstrap Lifecycle: Dari JVM Start sampai Aplikasi Ready**

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-004.md">⬅️ Part 4 — `asadmin` Deep Dive: Admin CLI sebagai Automation Surface</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-006.md">Part 6 — Bootstrap Lifecycle: Dari JVM Start sampai Aplikasi Ready ➡️</a>
</div>
