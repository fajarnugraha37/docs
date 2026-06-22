# learn-mysql-mastery-for-java-engineers-part-026.md

# Part 026 — Security: Users, Privileges, TLS, Secrets, and Auditability

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `026 / 034`  
> Fokus: keamanan MySQL sebagai sistem production: identity, privilege, TLS, secrets, injection boundary, auditability, dan desain akses untuk aplikasi Java.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas MySQL security dari sudut pandang engineer yang membangun dan mengoperasikan aplikasi Java production.

Kita tidak akan memperlakukan keamanan sebagai checklist kosmetik seperti:

- “pakai password kuat”
- “jangan pakai root”
- “gunakan prepared statement”

Itu benar, tetapi tidak cukup.

Yang ingin kita bangun adalah mental model:

> Security MySQL adalah sistem kontrol atas siapa boleh membuka koneksi, dari mana koneksi datang, operasi apa yang boleh dilakukan, data apa yang boleh dilihat/diubah, bagaimana credential dikelola, bagaimana koneksi dienkripsi, dan bagaimana tindakan penting dapat dibuktikan setelah kejadian.

Untuk Java engineer, keamanan database sangat terkait dengan:

- desain user aplikasi
- desain privilege migration
- connection pool
- secret management
- TLS trust
- SQL injection boundary
- audit trail
- separation of duties
- incident response
- compliance/regulatory defensibility

Sistem bisa memakai MySQL yang sangat cepat dan schema yang bagus, tetapi tetap gagal secara serius bila:

- semua service memakai user `root`
- runtime app punya `DROP`, `ALTER`, atau `GRANT`
- migration user dipakai juga oleh aplikasi
- backup berisi data sensitif tanpa enkripsi
- query audit tidak bisa dikaitkan ke actor aplikasi
- credential tersebar di log, config repo, atau container image
- replica/reporting user punya akses terlalu luas
- TLS aktif tetapi tidak memverifikasi server identity
- aplikasi menggunakan dynamic SQL untuk filter/sort tanpa allowlist

---

## 1. Mental Model: Security Boundary MySQL

Security boundary MySQL dapat dilihat sebagai beberapa lapis.

```text
Client / Application
        |
        | 1. secret / credential
        v
Network Path
        |
        | 2. TLS / encryption / server verification
        v
MySQL Listener
        |
        | 3. account matching: user + host
        v
Authentication Plugin
        |
        | 4. password / auth mechanism / MFA / external auth
        v
Privilege System
        |
        | 5. global / schema / table / column / routine privileges
        v
SQL Execution
        |
        | 6. object-level access, row/data design, dynamic SQL safety
        v
Audit / Logs / Observability
        |
        | 7. accountability and forensics
```

Setiap lapis memiliki failure mode sendiri.

| Lapis | Pertanyaan Utama | Failure Mode Umum |
|---|---|---|
| Secret | Bagaimana aplikasi mendapatkan credential? | secret masuk Git, log, image, CI output |
| Network | Apakah koneksi terenkripsi dan verified? | MITM, credential sniffing, fake endpoint |
| Account | Account mana yang cocok? | wildcard host terlalu luas |
| Auth | Bagaimana identity dibuktikan? | password lemah, plugin mismatch, credential reuse |
| Privilege | Apa yang boleh dilakukan? | runtime app bisa DDL/DROP/GRANT |
| SQL | Apakah query aman secara struktur? | SQL injection via dynamic ORDER BY/filter/table name |
| Audit | Bisa dibuktikan siapa melakukan apa? | DB user shared, actor aplikasi hilang |

Prinsip utamanya:

> Keamanan bukan hanya mencegah akses. Keamanan juga membatasi blast radius saat sesuatu bocor atau salah.

---

## 2. MySQL Account Model: User Bukan Hanya Username

Di MySQL, account bukan sekadar `username`.

Account secara konseptual adalah pasangan:

```sql
'user_name'@'host_name'
```

Contoh:

```sql
'app_runtime'@'10.%'
'app_runtime'@'app01.internal'
'app_runtime'@'%'
'reporting_reader'@'analytics-subnet.%'
```

Artinya, `app_runtime` dari host A dan `app_runtime` dari host B bisa dianggap account berbeda.

Ini berbeda dari banyak sistem aplikasi yang memperlakukan username sebagai identity tunggal.

### 2.1 Kenapa Host Bagian dari Identity?

Karena MySQL melakukan account matching saat client connect. Host menjadi bagian dari boundary.

Hal ini berguna untuk:

- membedakan akses dari aplikasi production vs staging
- membatasi migration tool hanya dari runner tertentu
- membatasi admin user hanya dari bastion host
- membatasi replica user hanya dari host replica
- membatasi reporting user hanya dari subnet BI/reporting

### 2.2 Bahaya `user`@`%`

Account seperti ini umum tetapi sering terlalu luas:

```sql
CREATE USER 'app_runtime'@'%' IDENTIFIED BY '...';
```

`%` berarti account dapat mencoba connect dari banyak host yang cocok secara pattern.

Kadang ini diperlukan di environment dinamis seperti Kubernetes, tetapi secara security ini memperbesar attack surface.

Lebih baik:

- gunakan private network boundary
- gunakan security group/firewall
- gunakan TLS
- gunakan secret rotation
- gunakan privilege minimal
- bila memungkinkan, batasi host/subnet

Jangan menganggap `%` otomatis fatal. Di cloud/Kubernetes, host identity bisa berubah. Tetapi bila memakai `%`, compensating control harus lebih kuat.

---

## 3. Authentication: Membuktikan Siapa yang Connect

Authentication menjawab:

> Apakah client yang mengaku sebagai account tertentu benar-benar berhak memakai account tersebut?

MySQL mendukung authentication plugin. Credential ditangani oleh plugin authentication account tersebut. Dokumentasi MySQL menjelaskan bahwa account dapat memiliki credential seperti password, dan credential itu ditangani oleh authentication plugin; MySQL mendukung beberapa plugin, termasuk plugin built-in dan plugin untuk external authentication.

### 3.1 Authentication Plugin yang Perlu Dikenal

Beberapa nama yang sering muncul:

- `caching_sha2_password`
- `mysql_native_password`
- authentication plugin enterprise/external tertentu

Untuk MySQL modern, `caching_sha2_password` adalah default penting yang perlu dipahami dari sisi Connector/J dan TLS.

### 3.2 Java Implication

Aplikasi Java harus memastikan:

- Connector/J versi kompatibel dengan server
- JDBC URL tidak mematikan TLS secara tidak sengaja
- trust store dikonfigurasi bila perlu
- password tidak ditulis di log
- error authentication tidak membuka detail sensitif
- rotation credential tidak membutuhkan redeploy manual yang berisiko

Contoh masalah umum:

```text
Production upgrade MySQL -> auth plugin berubah -> driver lama tidak mendukung -> aplikasi gagal connect.
```

Atau:

```text
TLS required di server -> JDBC URL lama tidak memiliki konfigurasi SSL benar -> connection failure.
```

Security bukan hanya policy. Security harus kompatibel dengan deployment pipeline.

---

## 4. Privilege System: Least Privilege yang Benar-Benar Dipakai

Privilege menjawab:

> Setelah berhasil connect, operasi apa yang boleh dilakukan account ini?

MySQL privilege dapat berada pada beberapa level:

- global
- database/schema
- table
- column
- routine
- proxy/dynamic/admin privilege tertentu

Contoh privilege umum:

- `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`
- `CREATE`
- `ALTER`
- `DROP`
- `INDEX`
- `REFERENCES`
- `EXECUTE`
- `CREATE USER`
- `GRANT OPTION`
- admin/dynamic privileges tertentu

Dokumentasi MySQL menjelaskan bahwa privilege system mengautentikasi user dari host tertentu dan mengasosiasikan user tersebut dengan privilege untuk database, operasi data seperti `SELECT`, `INSERT`, `UPDATE`, `DELETE`, dan operasi administratif lain.

### 4.1 Principle of Least Privilege

Least privilege berarti:

> Account hanya mendapatkan privilege yang diperlukan untuk tugasnya, tidak lebih.

Bukan:

```sql
GRANT ALL PRIVILEGES ON *.* TO 'app_runtime'@'%';
```

Lebih aman:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
ON enforcement_prod.*
TO 'app_runtime'@'app-subnet.%';
```

Tetapi bahkan ini masih perlu dipertajam.

Apakah runtime app benar-benar perlu `DELETE`?

Banyak sistem regulatory/case-management sebaiknya tidak melakukan hard delete untuk entity penting. Jika domain menggunakan soft delete atau state transition, runtime user mungkin tidak perlu `DELETE` pada table utama.

### 4.2 Runtime User Tidak Boleh Menjadi Migration User

Kesalahan besar:

```text
Aplikasi production memakai user yang sama dengan Flyway/Liquibase migration.
```

Akibat:

- bug aplikasi bisa menjalankan DDL bila injection terjadi
- credential leak runtime berarti attacker bisa alter/drop schema
- aplikasi punya privilege lebih besar dari kebutuhan normal
- sulit membuktikan siapa melakukan perubahan schema

Pisahkan:

```text
app_runtime_user
  - SELECT/INSERT/UPDATE/DELETE terbatas
  - tidak punya ALTER/DROP/CREATE/GRANT

schema_migration_user
  - ALTER/CREATE/INDEX/DROP sesuai kebutuhan migration
  - hanya dipakai oleh pipeline migration
  - tidak dipakai service runtime

readonly_reporting_user
  - SELECT tertentu
  - idealnya di replica/reporting schema

admin_breakglass_user
  - privilege tinggi
  - akses terbatas
  - rotasi, approval, audit ketat
```

### 4.3 Privilege untuk Runtime Java App

Baseline sederhana untuk aplikasi OLTP:

```sql
CREATE USER 'case_app_runtime'@'app-subnet.%'
IDENTIFIED BY 'REDACTED';

GRANT SELECT, INSERT, UPDATE
ON enforcement_prod.*
TO 'case_app_runtime'@'app-subnet.%';
```

Tambahkan `DELETE` hanya bila benar-benar diperlukan.

Untuk beberapa table, bisa lebih ketat:

```sql
GRANT SELECT, INSERT, UPDATE
ON enforcement_prod.case_file
TO 'case_app_runtime'@'app-subnet.%';

GRANT SELECT, INSERT
ON enforcement_prod.case_audit_event
TO 'case_app_runtime'@'app-subnet.%';
```

Perhatikan `case_audit_event` hanya `INSERT`, bukan `UPDATE`/`DELETE`, agar audit event append-only di level privilege.

Itu contoh bagus:

> Gunakan privilege untuk mengekspresikan invariant domain, bukan hanya security teknis.

---

## 5. Roles: Mengelola Privilege Set dengan Lebih Tertib

MySQL mendukung role untuk menghindari grant privilege satu per satu ke banyak account. Dokumentasi MySQL menyebut roles sebagai nama untuk privilege set yang dapat diberikan ke user account.

Contoh:

```sql
CREATE ROLE 'role_case_runtime';
CREATE ROLE 'role_case_readonly';
CREATE ROLE 'role_case_migration';

GRANT SELECT, INSERT, UPDATE
ON enforcement_prod.*
TO 'role_case_runtime';

GRANT SELECT
ON enforcement_prod.*
TO 'role_case_readonly';

GRANT CREATE, ALTER, DROP, INDEX, REFERENCES
ON enforcement_prod.*
TO 'role_case_migration';
```

Kemudian:

```sql
GRANT 'role_case_runtime'
TO 'case_app_runtime'@'app-subnet.%';

SET DEFAULT ROLE 'role_case_runtime'
TO 'case_app_runtime'@'app-subnet.%';
```

### 5.1 Role sebagai Policy Object

Role membantu bila organisasi punya banyak service:

```text
role_runtime_rw
role_runtime_ro
role_migration
role_reporting
role_reconciliation
role_support_readonly
role_breakglass_admin
```

Namun jangan menjadikan role terlalu general sehingga akhirnya sama berbahaya dengan `GRANT ALL`.

Role yang baik:

- punya nama jelas
- punya scope jelas
- tidak mencampur runtime dan admin
- tidak memberi grant option ke runtime
- direview seperti code

---

## 6. System Accounts dan Admin Privileges

MySQL memiliki konsep privilege administratif yang harus diperlakukan sangat hati-hati.

Contoh penting:

- `CREATE USER`
- `GRANT OPTION`
- `SYSTEM_USER`
- `CONNECTION_ADMIN`
- privilege yang terkait replication/admin/backup

Dokumentasi MySQL menyebut bahwa `SYSTEM_USER` diperlukan untuk memanipulasi system accounts dengan statement account-management seperti `CREATE USER` dan `GRANT`, dan privilege ini juga berdampak pada kemampuan membunuh session milik user dengan `SYSTEM_USER`.

### 6.1 Jangan Beri Admin Privilege ke Runtime

Runtime app tidak seharusnya bisa:

- membuat user
- mengubah password user
- memberikan privilege
- mengubah global variable
- kill session sembarangan
- mengubah replication state
- membaca semua database
- melakukan backup fisik

Bila runtime user punya privilege seperti itu, maka bug aplikasi berubah menjadi kompromi database administratif.

### 6.2 Breakglass Account

Production kadang butuh account darurat.

Karakteristik breakglass account:

- privilege tinggi
- tidak dipakai otomatis
- akses dibatasi network/VPN/bastion
- credential disimpan di vault
- penggunaan memerlukan approval
- semua penggunaan diaudit
- password/secret dirotasi setelah digunakan

Breakglass bukan shortcut harian.

Jika breakglass dipakai sering, berarti proses operasional normal belum matang.

---

## 7. TLS: Encryption Is Necessary, Verification Is the Point

TLS menjawab:

> Apakah koneksi client-server dilindungi dari penyadapan dan apakah client yakin sedang berbicara dengan server yang benar?

MySQL mendukung koneksi terenkripsi SSL/TLS. Dokumentasi security guidelines MySQL menyebut bahwa MySQL memakai ACL untuk connection/query/operation dan mendukung SSL-encrypted connection antara client dan server.

### 7.1 Dua Tujuan TLS

TLS punya dua tujuan besar:

1. Encryption  
   Data dan credential tidak mudah disadap.

2. Authentication/verification  
   Client dapat memverifikasi server identity.

Banyak konfigurasi berhenti di nomor 1 tetapi gagal di nomor 2.

Contoh buruk:

```text
useSSL=true tetapi trust verification dimatikan.
```

Ini dapat membuat koneksi terenkripsi ke endpoint yang salah.

### 7.2 JDBC TLS Considerations

Contoh bentuk JDBC URL konseptual:

```properties
jdbc:mysql://mysql-prod.internal:3306/enforcement_prod?sslMode=VERIFY_IDENTITY
```

Konfigurasi detail bergantung versi Connector/J dan trust store environment.

Yang penting secara mental:

- `DISABLED` berarti tidak memakai TLS
- `REQUIRED` berarti TLS digunakan, tetapi belum tentu verifikasi identity penuh
- mode verification memastikan certificate chain/hostname sesuai

Untuk production regulated system, target yang baik adalah:

```text
TLS aktif + CA/trust store benar + server identity diverifikasi.
```

### 7.3 MySQL Account Dapat Mensyaratkan SSL

Contoh:

```sql
CREATE USER 'case_app_runtime'@'app-subnet.%'
IDENTIFIED BY 'REDACTED'
REQUIRE SSL;
```

Atau dengan requirement lebih spesifik tergantung kebijakan certificate.

Ini berguna agar account tidak bisa dipakai melalui koneksi plaintext.

---

## 8. Secret Management: Password Bukan Config Biasa

Credential database adalah secret, bukan property biasa.

Anti-pattern:

```properties
spring.datasource.username=case_app_runtime
spring.datasource.password=supersecret123
```

Jika file ini masuk Git atau image, credential bocor.

### 8.1 Secret Lifecycle

Secret yang sehat punya lifecycle:

```text
created -> distributed securely -> used -> rotated -> revoked -> audited
```

Pertanyaan desain:

- siapa membuat credential?
- disimpan di mana?
- bagaimana service mengambilnya?
- apakah credential pernah dicetak ke log?
- bagaimana rotasi dilakukan tanpa downtime?
- bagaimana mencabut credential bila bocor?
- siapa tahu credential plain text?

### 8.2 Secret Storage Pattern

Sumber secret umum:

- cloud secret manager
- HashiCorp Vault
- Kubernetes Secret dengan external secret operator
- CI/CD secret store
- environment variable dengan batasan tertentu
- mounted file dengan permission ketat

Yang harus dihindari:

- hardcoded password di source code
- password di Docker image layer
- password di command line process args
- password di log startup
- password di stack trace
- shared credential lintas environment

### 8.3 Rotation dan Connection Pool

Rotasi credential sering gagal karena connection pool.

Skenario:

```text
1. Password database diganti.
2. Existing pooled connections masih hidup.
3. New connections mulai gagal karena aplikasi masih memakai password lama.
4. Saat pool recycle, traffic mulai error.
```

Strategi yang lebih aman:

1. buat credential baru
2. deploy app dengan credential baru
3. pastikan koneksi baru sukses
4. drain/recycle old connections
5. revoke credential lama
6. verifikasi tidak ada connection lama

Model dual credential sering lebih aman daripada mutate password in-place.

---

## 9. SQL Injection: Prepared Statement Penting, Tapi Tidak Menutup Semua Lubang

Prepared statement melindungi nilai data, bukan struktur SQL.

Aman:

```java
PreparedStatement ps = connection.prepareStatement(
    "SELECT * FROM case_file WHERE case_id = ?"
);
ps.setLong(1, caseId);
```

Tidak aman bila struktur SQL dibangun dari input user:

```java
String sql = "SELECT * FROM case_file ORDER BY " + sortBy;
```

Parameter binding tidak bisa menggantikan nama column, arah sort, nama table, atau potongan SQL.

### 9.1 Dynamic ORDER BY Harus Allowlist

Buruk:

```java
String sortBy = request.getParameter("sortBy");
String sql = "SELECT * FROM case_file ORDER BY " + sortBy;
```

Baik:

```java
Map<String, String> allowedSorts = Map.of(
    "createdAt", "created_at",
    "updatedAt", "updated_at",
    "riskScore", "risk_score",
    "status", "status"
);

String column = allowedSorts.get(sortBy);
if (column == null) {
    throw new BadRequestException("Unsupported sort field");
}

String direction = sortDirection.equalsIgnoreCase("desc") ? "DESC" : "ASC";
String sql = "SELECT * FROM case_file ORDER BY " + column + " " + direction + " LIMIT ?";
```

Nilai seperti `LIMIT ?` bisa diparameterisasi, tetapi identifier harus allowlist.

### 9.2 Dynamic Filter Builder

Filter UI sering menghasilkan query dinamis.

Pattern yang sehat:

```text
input filter -> validate semantic field -> map to known column/expression -> bind value -> execute
```

Jangan:

```text
input filter -> concatenate into SQL
```

### 9.3 ORM Tidak Otomatis Aman

JPA/Criteria/QueryDSL dapat membantu, tetapi injection masih mungkin jika:

- native query digabung string
- JPQL digabung string
- dynamic sort tidak allowlist
- dynamic table/column name dari request
- filter expression language diterjemahkan terlalu bebas

ORM mengurangi risiko, bukan menghapus tanggung jawab desain.

---

## 10. Data Access Segmentation untuk Sistem Java

Bayangkan platform enforcement lifecycle:

- case service
- subject service
- document service
- notification service
- reporting service
- migration pipeline
- reconciliation job
- support tool
- audit/export tool

Jangan semuanya memakai account sama.

### 10.1 Segmentasi Berdasarkan Fungsi

```text
case_service_runtime
  SELECT/INSERT/UPDATE pada table case utama
  INSERT pada audit event

reporting_service_readonly
  SELECT pada replica/reporting schema

migration_pipeline
  CREATE/ALTER/DROP/INDEX pada schema tertentu

reconciliation_job
  SELECT luas + UPDATE terbatas pada reconciliation status

support_tool_readonly
  SELECT terbatas / view tertentu

export_job
  SELECT pada subset data + audit ketat
```

### 10.2 View sebagai Security Boundary Terbatas

View bisa digunakan untuk membatasi column exposure.

Contoh:

```sql
CREATE VIEW support_case_view AS
SELECT
    case_id,
    case_number,
    status,
    created_at,
    assigned_unit
FROM case_file;

GRANT SELECT ON enforcement_prod.support_case_view
TO 'support_readonly'@'support-subnet.%';
```

Namun view bukan pengganti security architecture lengkap.

Pertanyaan penting:

- apakah user juga punya akses table dasar?
- apakah view menggunakan definer/invoker semantics yang sesuai?
- apakah sensitive column benar-benar tidak bocor via join lain?
- apakah audit query tetap tersedia?

---

## 11. Sensitive Data: Masking, Tokenization, Encryption

MySQL access control menentukan siapa boleh query. Tetapi setelah data keluar dari DB, kontrol DB tidak lagi cukup.

Jenis data sensitif:

- personal identity data
- legal names
- address
- phone/email
- document number
- investigation notes
- sanction/enforcement status
- attachment metadata
- financial values
- credential/token/API key

### 11.1 Encryption at Rest vs Application-Level Encryption

Encryption at rest melindungi storage media/backups dari akses fisik/logical tertentu, tetapi DB engine tetap bisa membaca data.

Application-level encryption/tokenization berguna bila:

- DBA/operator tidak boleh melihat plaintext
- data perlu diproteksi per field
- compliance mewajibkan separation of duties
- breach impact harus dibatasi

Trade-off:

| Approach | Kelebihan | Biaya |
|---|---|---|
| TLS in transit | melindungi jaringan | tidak melindungi data saat tersimpan |
| Storage encryption | melindungi disk/snapshot | DB tetap melihat plaintext |
| Column/application encryption | membatasi exposure | query/filter/index menjadi sulit |
| Tokenization | mengurangi data sensitif di DB utama | butuh token vault/service |
| Masking | mengurangi exposure UI/report | bukan kontrol kuat jika raw data masih accessible |

### 11.2 Jangan Simpan Secret di MySQL Bila Tidak Perlu

Jika aplikasi menyimpan external API tokens, private keys, atau credential downstream di MySQL, tanyakan:

- apakah harus ada di database aplikasi?
- apakah bisa disimpan di secret manager?
- apakah terenkripsi dengan key terpisah?
- siapa bisa membaca column itu?
- apakah backup ikut membawa secret?
- bagaimana rotation/revocation?

---

## 12. Auditability: Bisa Membuktikan Apa yang Terjadi

Auditability menjawab:

> Setelah kejadian, bisakah kita membuktikan siapa melakukan apa, kapan, dari mana, terhadap data apa, dan melalui jalur apa?

MySQL Enterprise Audit menyediakan monitoring/logging/blocking policy-based untuk connection dan query activity melalui audit API; ini adalah fitur Enterprise/commercial. Dokumentasi MySQL menjelaskan bahwa Enterprise Audit memakai plugin/component audit untuk mencatat aktivitas connection dan query tertentu, dengan filter dan policy.

Tetapi audit DB bukan satu-satunya audit.

Ada tiga level audit:

```text
1. Application audit
   Actor bisnis: user manusia, service, workflow, case, request id.

2. Database audit
   DB account, host, statement/event, timestamp.

3. Infrastructure audit
   deployment, secret access, admin login, network path, backup restore.
```

### 12.1 Application Audit Tidak Bisa Digantikan DB Audit

Database hanya tahu:

```text
case_app_runtime@10.1.2.3 menjalankan UPDATE case_file ...
```

Database tidak otomatis tahu:

```text
Investigator A menyetujui escalation case C melalui request R setelah policy check P.
```

Karena aplikasi memakai connection pool, banyak user manusia berbagi satu DB account runtime.

Maka sistem regulatory harus punya audit domain sendiri:

```sql
CREATE TABLE case_audit_event (
    audit_event_id     BINARY(16) PRIMARY KEY,
    case_id            BINARY(16) NOT NULL,
    actor_type         VARCHAR(32) NOT NULL,
    actor_id           VARCHAR(128) NOT NULL,
    action             VARCHAR(128) NOT NULL,
    previous_state     VARCHAR(64),
    new_state          VARCHAR(64),
    reason_code        VARCHAR(64),
    request_id         VARCHAR(128) NOT NULL,
    occurred_at        TIMESTAMP(6) NOT NULL,
    metadata_json      JSON NOT NULL
);
```

Dan privilege-nya bisa dibuat append-only:

```sql
GRANT INSERT, SELECT
ON enforcement_prod.case_audit_event
TO 'case_app_runtime'@'app-subnet.%';
```

Lebih ketat lagi, runtime app hanya diberi `INSERT`, sedangkan pembacaan audit menggunakan service/reporting account berbeda.

### 12.2 Correlation ID

Setiap request penting harus membawa correlation/request id.

Di Java:

```text
HTTP request id -> MDC/logging -> DB audit row -> outbox event -> downstream event
```

Tujuannya:

- investigasi incident
- audit trail lintas service
- debugging transaction failure
- membuktikan sequence workflow

### 12.3 DB-Level Audit untuk Admin dan Anomali

DB audit berguna untuk:

- login admin
- failed login spike
- DDL statements
- GRANT/REVOKE
- CREATE/DROP USER
- access ke sensitive table
- query manual production
- data export
- suspicious SELECT besar

Application audit menjawab “apa yang terjadi secara bisnis”.

DB audit menjawab “apa yang terjadi di database”.

Keduanya perlu, karena actor dan perspektifnya berbeda.

---

## 13. Runtime User Design Patterns

### 13.1 Pattern: Single Runtime User per Service

```text
case-service -> case_service_runtime
subject-service -> subject_service_runtime
document-service -> document_service_runtime
```

Kelebihan:

- mudah dikelola
- cocok dengan connection pool
- privilege dapat disesuaikan per service
- observability DB bisa melihat service identity

Kekurangan:

- tidak membedakan user manusia di DB level
- perlu application audit untuk actor manusia

Ini biasanya pattern paling praktis.

### 13.2 Pattern: Per-Tenant DB User

Kadang digunakan untuk multi-tenant isolation.

Kelebihan:

- isolation lebih kuat per tenant
- revoke tenant tertentu lebih mudah

Kekurangan:

- kompleksitas connection pool tinggi
- banyak account
- secret management rumit
- migration lebih sulit

Biasanya tidak layak kecuali kebutuhan compliance kuat.

### 13.3 Pattern: Per-Human DB User

Jarang cocok untuk aplikasi web biasa.

Kelebihan:

- DB-level audit per user manusia

Kekurangan:

- connection pooling sulit
- privilege mapping kompleks
- password lifecycle sulit
- aplikasi kehilangan kontrol domain authorization

Untuk aplikasi Java, actor manusia sebaiknya dikontrol di application authorization layer dan dicatat di audit domain.

---

## 14. Authorization: Database Privilege vs Application Permission

Jangan mencampur dua hal ini.

Database privilege:

```text
Apakah account DB boleh SELECT/UPDATE table ini?
```

Application permission:

```text
Apakah investigator ini boleh approve escalation case ini?
```

Database tidak tahu semua aturan domain seperti:

- unit kerja actor
- conflict of interest
- case assignment
- SLA status
- jurisdiction
- delegation
- approval matrix
- separation of duties

Maka desain yang sehat:

```text
DB privilege membatasi blast radius teknis.
Application authorization menegakkan aturan bisnis.
Audit event membuktikan keputusan.
```

Jangan mengandalkan DB privilege untuk semua authorization domain.

Jangan juga memberi DB privilege terlalu luas karena “authorization sudah di aplikasi”.

Keduanya saling melengkapi.

---

## 15. Stored Procedures, DEFINER, and Security Context

Stored procedure/view/function dapat berjalan dengan security context tertentu.

Risiko umum:

- object dibuat dengan `DEFINER` admin lama
- definer user dihapus sehingga object error
- routine punya privilege lebih besar dari caller
- dynamic SQL dalam procedure tidak aman
- migration lintas environment gagal karena definer berbeda

Praktik sehat:

- review `DEFINER`
- hindari definer personal user
- gunakan service/admin role khusus bila perlu
- dokumentasikan routine yang intentionally privilege-escalating
- jangan sembunyikan business authorization kompleks di stored procedure tanpa audit yang jelas

Untuk Java-heavy architecture, stored procedure bisa berguna, tetapi jangan menjadikannya tempat gelap bagi authorization dan audit.

---

## 16. Backup Security

Backup sering menjadi lubang terbesar.

Backup berisi:

- data production
- data sensitif
- audit trail
- mungkin credential/token jika disimpan di DB
- binary log untuk PITR

Pertanyaan penting:

- apakah backup dienkripsi?
- siapa bisa restore?
- siapa bisa download?
- apakah backup production dipakai di dev?
- apakah data masking dilakukan sebelum non-production?
- apakah backup retention sesuai policy?
- apakah backup deletion benar-benar terjadi?
- apakah object storage bucket public/tidak?
- apakah restore access diaudit?

Security database tidak lengkap tanpa security backup.

### 16.1 Non-Production Data

Anti-pattern:

```text
Copy database production ke staging/dev apa adanya.
```

Risiko:

- developer punya akses data sensitif
- environment non-prod lebih longgar
- logs lebih bebas
- third-party tool tersambung
- backup non-prod tidak seketat prod

Alternatif:

- synthetic data
- masked data
- tokenized data
- subset data dengan irreversible anonymization
- controlled breakglass untuk debugging kasus tertentu

---

## 17. Replication and Reporting Security

Replica bukan berarti aman otomatis.

Jika replica berisi data lengkap, maka compromise replica = compromise data.

Reporting user sering diberi `SELECT` luas.

Risiko:

- data export besar tanpa audit
- sensitive column terbuka ke BI tool
- replica dipakai untuk ad-hoc query bebas
- query reporting overload replica lalu lag meningkat
- user reporting bisa membaca table internal/audit yang tidak seharusnya

Praktik sehat:

- reporting user read-only
- batasi schema/table/view
- masking view untuk sensitive fields
- gunakan dedicated reporting replica
- audit export besar
- limit akses network
- monitor query berat

---

## 18. Network Security and Deployment Topology

MySQL sebaiknya tidak terbuka ke internet publik kecuali benar-benar ada desain khusus yang kuat.

Kontrol umum:

- private subnet
- firewall/security group
- allowlist source
- bastion/VPN untuk admin
- TLS required
- no direct developer laptop access ke prod kecuali controlled path
- separate endpoint untuk primary/replica/admin bila perlu

Layer network tidak menggantikan privilege.

Privilege tidak menggantikan network.

TLS tidak menggantikan secret management.

Semua lapis membentuk defense-in-depth.

---

## 19. Connection Pool dan Security

Connection pool membuat satu DB account dipakai oleh banyak request/user.

Implikasi:

- DB tidak tahu actor manusia
- session state bisa bocor antar request bila tidak hati-hati
- temporary table/session variable bisa menjadi risiko
- credential rotation harus mempertimbangkan existing pooled connections
- leak connection bisa menyebabkan availability/security issue

### 19.1 Session State Hygiene

Hati-hati dengan:

```sql
SET SESSION sql_mode = ...;
SET SESSION time_zone = ...;
SET @current_actor = ...;
CREATE TEMPORARY TABLE ...;
```

Jika connection kembali ke pool tanpa reset memadai, request berikutnya bisa mewarisi state.

Gunakan:

- pool yang reset connection dengan benar
- konfigurasi session init yang konsisten
- hindari session variable untuk authorization penting
- gunakan request context di aplikasi, bukan state tersembunyi di DB session

---

## 20. Error Message and Logging Hygiene

Security juga mencakup apa yang tidak boleh ditampilkan.

Jangan log:

- database password
- full JDBC URL dengan password
- access token
- PII lengkap
- query dengan literal sensitive data bila tidak perlu
- dump result row sensitive

Hati-hati dengan:

```java
log.error("DB error for query {}", sql, ex);
```

Jika `sql` sudah berisi literal hasil string concatenation, log bisa membocorkan data.

Lebih baik:

- log query digest/name
- log request id
- log error code/sql state
- log sanitized parameter
- pisahkan debug log non-prod dan prod

---

## 21. Secure Defaults for Java + MySQL

Contoh baseline mindset.

### 21.1 Runtime Account

```sql
CREATE USER 'case_runtime'@'app-subnet.%'
IDENTIFIED BY 'REDACTED'
REQUIRE SSL;

GRANT SELECT, INSERT, UPDATE
ON enforcement_prod.case_file
TO 'case_runtime'@'app-subnet.%';

GRANT SELECT, INSERT, UPDATE
ON enforcement_prod.case_assignment
TO 'case_runtime'@'app-subnet.%';

GRANT INSERT
ON enforcement_prod.case_audit_event
TO 'case_runtime'@'app-subnet.%';

GRANT SELECT, INSERT
ON enforcement_prod.outbox_event
TO 'case_runtime'@'app-subnet.%';
```

Notice:

- tidak ada `DROP`
- tidak ada `ALTER`
- tidak ada `CREATE USER`
- tidak ada `GRANT OPTION`
- audit event tidak bisa di-update/delete oleh runtime

### 21.2 Migration Account

```sql
CREATE USER 'case_migration'@'ci-runner-subnet.%'
IDENTIFIED BY 'REDACTED'
REQUIRE SSL;

GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, ALTER, DROP, INDEX, REFERENCES
ON enforcement_prod.*
TO 'case_migration'@'ci-runner-subnet.%';
```

Migration account hanya dipakai pipeline migration.

### 21.3 Readonly Account

```sql
CREATE USER 'case_readonly'@'reporting-subnet.%'
IDENTIFIED BY 'REDACTED'
REQUIRE SSL;

GRANT SELECT
ON enforcement_prod.support_case_view
TO 'case_readonly'@'reporting-subnet.%';
```

Readonly tidak selalu berarti semua table boleh dibaca.

---

## 22. Security Review Checklist

### 22.1 Account Checklist

- Apakah runtime user berbeda dari migration user?
- Apakah admin user berbeda dari application user?
- Apakah reporting user berbeda dari runtime user?
- Apakah account dibatasi host/subnet bila memungkinkan?
- Apakah account lama direvoke?
- Apakah account personal dipakai sebagai definer object?
- Apakah shared human account masih ada?

### 22.2 Privilege Checklist

- Apakah runtime user punya `DROP`, `ALTER`, `CREATE`, atau `GRANT OPTION`?
- Apakah runtime user butuh `DELETE`?
- Apakah audit table append-only secara privilege?
- Apakah reporting user membaca sensitive table langsung?
- Apakah privilege diberikan di `*.*` tanpa alasan kuat?
- Apakah role terlalu luas?
- Apakah privilege direview saat schema berubah?

### 22.3 TLS Checklist

- Apakah koneksi production memakai TLS?
- Apakah server identity diverifikasi?
- Apakah certificate rotation diuji?
- Apakah account mensyaratkan SSL?
- Apakah driver/JDBC URL sesuai versi Connector/J?

### 22.4 Secret Checklist

- Apakah secret tidak ada di Git?
- Apakah secret tidak ada di image layer?
- Apakah secret tidak keluar di log?
- Apakah ada proses rotation?
- Apakah credential lama direvoke?
- Apakah environment dev/staging/prod memakai credential berbeda?

### 22.5 Audit Checklist

- Apakah domain audit mencatat actor manusia/service?
- Apakah request id tercatat sampai DB audit/outbox?
- Apakah DDL/admin access diaudit?
- Apakah export data sensitif diaudit?
- Apakah audit event bisa diubah runtime user?
- Apakah retention audit sesuai policy?

### 22.6 Backup/Replica Checklist

- Apakah backup dienkripsi?
- Apakah restore access diaudit?
- Apakah non-prod data dimasking?
- Apakah reporting replica punya privilege terbatas?
- Apakah binary log/backup punya protection setara database utama?

---

## 23. Failure Scenarios

### 23.1 Runtime Credential Bocor

Jika runtime user minimal:

```text
Attacker bisa membaca/mengubah subset data sesuai privilege.
Tidak bisa DROP schema.
Tidak bisa CREATE USER.
Tidak bisa GRANT privilege baru.
Tidak bisa ALTER table.
```

Jika runtime user `GRANT ALL ON *.*`:

```text
Attacker menjadi hampir admin database.
```

Least privilege adalah blast-radius control.

### 23.2 SQL Injection di Endpoint Search

Jika query builder allowlist buruk:

```text
Input sort/filter menjadi struktur SQL.
Prepared statement tidak membantu.
```

Mitigasi:

- allowlist field
- bind value
- limit result
- runtime privilege minimal
- logging sanitized
- WAF bukan pengganti desain query aman

### 23.3 Developer Copy Production Backup ke Laptop

Risiko:

- data sensitif keluar dari boundary production
- laptop tidak punya kontrol sama
- backup mungkin tersinkron ke cloud personal
- sulit audit akses

Mitigasi:

- synthetic/masked data
- controlled restore environment
- approval dan audit
- data minimization

### 23.4 Migration User Dipakai Runtime

Risiko:

- injection/bug bisa DDL
- aplikasi bisa drop/alter object
- metadata lock incident lebih parah
- audit tidak membedakan schema change vs runtime traffic

Mitigasi:

- credential terpisah
- pipeline-only access
- short-lived credential bila memungkinkan
- network restriction

---

## 24. Regulatory Defensibility Perspective

Untuk sistem enforcement/case-management, security bukan hanya “mencegah hacker”.

Ia juga harus menjawab:

- siapa yang melihat data kasus?
- siapa yang mengubah status?
- apakah perubahan sesuai kewenangan?
- apakah alasan perubahan tercatat?
- apakah data sensitif tidak diekspos ke pihak tidak berwenang?
- apakah audit event immutable secara praktis?
- apakah akses admin dapat dijelaskan?
- apakah backup dan export terkendali?
- apakah privilege mencerminkan separation of duties?

Database privilege membantu membatasi operasi teknis.

Application authorization membantu menegakkan aturan domain.

Audit trail membantu membuktikan keputusan.

Secret/TLS/network membantu mencegah akses tidak sah.

Backup/replica security membantu mencegah bypass melalui salinan data.

Semuanya harus koheren.

---

## 25. Practical Design: Security Blueprint untuk Java Service

Contoh blueprint ringkas:

```text
Service: case-service
Database: enforcement_prod
Runtime DB user: case_runtime@app-subnet
Migration DB user: case_migration@ci-subnet
Readonly support user: case_support_ro@support-subnet
Reporting user: case_reporting_ro@reporting-subnet
TLS: required + verify identity
Secret source: vault/external secret manager
Rotation: dual credential rollout
Audit: application domain audit + DB admin audit
Backup: encrypted + restore audited + non-prod masked
```

Privilege:

```text
case_runtime:
  case_file: SELECT, INSERT, UPDATE
  case_assignment: SELECT, INSERT, UPDATE
  case_audit_event: INSERT
  outbox_event: SELECT, INSERT, UPDATE
  schema DDL: none
  admin privilege: none

case_migration:
  schema DDL: yes, pipeline only
  runtime traffic: no

case_reporting_ro:
  SELECT on reporting views only

case_support_ro:
  SELECT on masked/support views only
```

Java configuration principles:

```text
- no password in repo
- no password in logs
- TLS verification enabled
- connection pool sized intentionally
- query timeout configured
- SQL generated through safe builders
- dynamic identifier allowlisted
- request id propagated
- audit event written transactionally with domain change
```

---

## 26. Common MySQL Security Anti-Patterns

| Anti-Pattern | Why Dangerous | Better Pattern |
|---|---|---|
| App uses `root` | Full compromise on app bug/credential leak | dedicated runtime user |
| App user has `ALL PRIVILEGES` | Excessive blast radius | least privilege per schema/table |
| Same user for app and migration | DDL privilege exposed to runtime | separate migration account |
| Password in Git | permanent credential leak | secret manager |
| TLS without verification | possible wrong endpoint/MITM | verify CA + hostname |
| Reporting user reads all tables | broad data exposure | views/masked schema |
| Production copy to dev | data leakage | synthetic/masked data |
| Dynamic SQL identifiers from input | injection still possible | allowlist identifiers |
| Audit only at DB level | actor manusia hilang | application domain audit |
| No backup access control | data bypass via backup | encrypted, restricted, audited backup |

---

## 27. What Top Engineers Internalize

Engineer yang kuat tidak hanya tahu command `GRANT`.

Ia memahami invariant:

1. Runtime account harus cukup untuk menjalankan aplikasi, tetapi tidak cukup untuk menghancurkan schema.
2. Migration account harus kuat, tetapi hanya hidup di pipeline dan boundary terbatas.
3. TLS harus mengenkripsi dan memverifikasi identity.
4. Secret harus punya lifecycle, bukan sekadar disimpan.
5. Prepared statement melindungi values, bukan SQL structure.
6. Application permission dan database privilege berbeda tetapi saling melengkapi.
7. Audit domain harus mencatat actor bisnis, bukan hanya DB account.
8. Backup dan replica adalah salinan data sensitif yang harus dijaga setara production.
9. Security controls harus mengurangi blast radius saat bug, injection, credential leak, atau insider mistake terjadi.
10. Compliance bukan dokumen terpisah; ia harus tertanam di schema, privilege, workflow, audit, dan operasi.

---

## 28. Latihan Praktis

### Latihan 1 — Desain User Matrix

Untuk service berikut:

- case-service
- document-service
- notification-service
- reporting-service
- migration pipeline
- support tool

Buat matrix:

```text
account | host scope | schema/table scope | privileges | secret source | audit requirement
```

Pastikan tidak ada runtime account dengan DDL privilege.

### Latihan 2 — Review Dynamic Query

Ambil endpoint search/filter di aplikasi Java.

Identifikasi:

- field filter yang boleh dipakai
- field sort yang boleh dipakai
- apakah ada raw string concatenation
- apakah semua value dibind
- apakah identifier memakai allowlist
- apakah pagination punya limit maksimum

### Latihan 3 — Audit Trail Review

Pilih satu state transition penting, misalnya:

```text
CASE_UNDER_REVIEW -> ESCALATED
```

Pastikan audit mencatat:

- actor
- role/authority
- previous state
- new state
- reason
- timestamp
- request id
- related evidence/document
- policy/rule version bila relevan

### Latihan 4 — Credential Rotation Simulation

Simulasikan rotasi credential runtime:

1. create user baru
2. grant privilege yang sama
3. deploy app dengan secret baru
4. verify new connections
5. drain old pool
6. revoke old user
7. monitor failed login

---

## 29. Ringkasan

Security MySQL untuk Java production bukan sekadar membuat password dan memakai prepared statement.

Model yang benar mencakup:

- account sebagai `user` + `host`
- authentication plugin dan compatibility driver
- least privilege berbasis fungsi
- pemisahan runtime/migration/admin/reporting
- roles sebagai privilege set
- TLS dengan identity verification
- secret lifecycle dan rotation
- SQL injection boundary untuk dynamic SQL
- audit domain dan audit database
- backup/replica sebagai security surface
- compliance dan forensic readiness

Kalimat kuncinya:

> MySQL security yang baik membatasi operasi normal, membatasi blast radius saat terjadi kegagalan, dan menyediakan bukti yang cukup ketika sistem harus dipertanggungjawabkan.

---

## 30. Referensi Resmi

Referensi utama untuk bagian ini:

- MySQL Reference Manual — Security Guidelines
- MySQL Reference Manual — Access Control and Account Management
- MySQL Reference Manual — Account User Names and Passwords
- MySQL Reference Manual — CREATE USER
- MySQL Reference Manual — Privileges Provided by MySQL
- MySQL Reference Manual — Roles
- MySQL Reference Manual — Account Categories and `SYSTEM_USER`
- MySQL Reference Manual — Encrypted Connections / TLS
- MySQL Reference Manual — MySQL Enterprise Audit

---

## 31. Penutup Part 026

Kita sudah membahas keamanan MySQL dari sudut desain sistem Java production:

- identity
- privilege
- TLS
- secret
- SQL injection
- auditability
- backup/replica security
- compliance

Bagian berikutnya adalah:

```text
learn-mysql-mastery-for-java-engineers-part-027.md
```

Dengan topik:

```text
Observability: Performance Schema, sys Schema, Slow Query Log
```

Di bagian berikutnya kita akan masuk ke kemampuan melihat apa yang benar-benar terjadi di MySQL production: query digest, wait events, slow query, lock inspection, buffer pool metrics, connection metrics, dan dashboard incident.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Metadata Locks and Operational Surprises</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-027.md">Part 027 — Observability: Performance Schema, sys Schema, Slow Query Log ➡️</a>
</div>
