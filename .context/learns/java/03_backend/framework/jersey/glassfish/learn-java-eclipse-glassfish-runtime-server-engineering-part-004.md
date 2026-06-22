# learn-java-eclipse-glassfish-runtime-server-engineering-part-004

# Part 4 — `asadmin` Deep Dive: Admin CLI sebagai Automation Surface

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 004 / 034  
> Topik: Eclipse GlassFish Admin CLI, automation, idempotency, environment promotion, dan production-grade administration  
> Target pembaca: Java engineer senior/tech lead yang ingin memahami GlassFish bukan hanya sebagai server yang dijalankan dari IDE, tetapi sebagai runtime enterprise yang bisa diprovision, diaudit, distandardisasi, dan dipulihkan secara repeatable.

---

## 0. Tujuan Part Ini

Di bagian sebelumnya, kita sudah membangun mental model bahwa GlassFish domain bukan hanya folder konfigurasi, tetapi unit runtime yang mengandung:

- Domain Administration Server / DAS,
- server instance,
- node,
- cluster,
- config,
- target,
- application deployment,
- resource binding,
- service configuration.

Sekarang kita masuk ke surface administrasi paling penting: **`asadmin`**.

Banyak engineer mengenal GlassFish dari admin console atau IDE. Itu cukup untuk development awal, tetapi tidak cukup untuk production engineering. Di production, konfigurasi harus:

- repeatable,
- scriptable,
- reviewable,
- auditable,
- environment-aware,
- dapat dijalankan di CI/CD,
- dapat diulang tanpa merusak state,
- memiliki exit code yang jelas,
- tidak bergantung pada klik manual.

Itulah fungsi strategis `asadmin`.

Dalam dokumentasi resmi GlassFish, `asadmin` adalah utility untuk melakukan tugas administrasi sebagai alternatif dari Administration Console. Subcommand `asadmin` bersifat case-sensitive dan dapat berupa local subcommand atau remote subcommand. Ini penting karena sebagian command dapat bekerja langsung pada filesystem domain, sementara sebagian lain membutuhkan DAS berjalan dan menerima request administrasi.

---

## 1. Mental Model: `asadmin` Bukan Sekadar CLI, Tetapi API Operasional

Cara berpikir yang salah:

```text
asadmin = command line untuk start/stop server
```

Cara berpikir yang benar:

```text
asadmin = stable administrative API untuk mengubah, membaca, dan mengotomasi state GlassFish domain
```

Dalam praktik production, `asadmin` adalah boundary antara:

```text
human / pipeline / script
        │
        ▼
asadmin command surface
        │
        ▼
DAS / local domain config
        │
        ▼
domain.xml, deployed app, resource registry, service runtime
```

Artinya, saat kita menjalankan:

```bash
asadmin create-jdbc-resource --connectionpoolid MyPool jdbc/MyDS
```

kita tidak sekadar “menambah datasource”. Kita sedang melakukan perubahan pada **configuration graph** domain. Perubahan ini dapat mempengaruhi:

- aplikasi yang melakukan JNDI lookup,
- cluster/instance target,
- connection pool lifecycle,
- deployment validation,
- transaction behavior,
- runtime monitoring,
- startup berikutnya.

Engineer top-level tidak melihat command sebagai potongan perintah lepas. Ia melihat command sebagai operasi terhadap model domain.

---

## 2. Kenapa `asadmin` Penting untuk Engineer Top 1%

GlassFish bisa diklik dari admin console. Tetapi production engineering tidak boleh bergantung pada klik.

Masalah jika konfigurasi dilakukan manual:

1. Tidak tahu siapa mengubah apa.
2. Tidak tahu kapan perubahan terjadi.
3. Tidak tahu environment mana yang berbeda.
4. Tidak bisa mereproduksi config di server baru.
5. Tidak bisa review perubahan sebelum deploy.
6. Sulit rollback.
7. Sulit audit.
8. Sulit disaster recovery.
9. Sulit onboarding engineer baru.
10. Mudah terjadi configuration drift.

Dengan `asadmin`, konfigurasi dapat dijadikan:

```text
script → version control → code review → pipeline → environment promotion → audit trail
```

Ini sangat penting untuk aplikasi government/regulatory/enterprise, karena konfigurasi runtime bukan sekadar detail teknis. Ia bagian dari **operational control**.

---

## 3. Anatomi Dasar Command `asadmin`

Bentuk umum:

```bash
asadmin [asadmin-options] subcommand [subcommand-options] [operands]
```

Contoh:

```bash
asadmin --host localhost --port 4848 deploy --contextroot aceas target/app.war
```

Strukturnya:

```text
asadmin
  ├── asadmin-options
  │     ├── --host localhost
  │     ├── --port 4848
  │     ├── --user admin
  │     ├── --passwordfile /secure/path/passwordfile
  │     └── --secure true/false
  │
  ├── subcommand
  │     └── deploy
  │
  ├── subcommand-options
  │     └── --contextroot aceas
  │
  └── operand
        └── target/app.war
```

Pemisahan ini penting.

`asadmin-options` menjawab:

```text
Saya berbicara ke admin endpoint mana, sebagai user siapa, dengan credential apa, dalam mode aman atau tidak?
```

`subcommand` menjawab:

```text
Operasi apa yang saya lakukan?
```

`subcommand-options` menjawab:

```text
Bagaimana operasi itu dikustomisasi?
```

`operands` menjawab:

```text
Objek apa yang dioperasikan?
```

---

## 4. Local Command vs Remote Command

Salah satu konsep paling penting: **tidak semua command bekerja dengan cara yang sama**.

Ada dua kategori besar:

1. **Local command**
2. **Remote command**

### 4.1 Local Command

Local command bekerja langsung pada filesystem lokal atau proses lokal. Biasanya tidak membutuhkan DAS sedang running.

Contoh umum:

```bash
asadmin start-domain domain1
asadmin stop-domain domain1
asadmin create-domain mydomain
asadmin delete-domain mydomain
asadmin list-domains
```

Karakteristik:

- beroperasi pada domain directory lokal,
- tidak selalu butuh admin port,
- sering digunakan untuk lifecycle dasar domain,
- bergantung pada akses filesystem,
- cocok untuk provisioning awal.

Contoh mental model:

```text
local command
  └── manipulate local domain files / local process
```

### 4.2 Remote Command

Remote command dikirim ke DAS melalui admin interface.

Contoh:

```bash
asadmin list-applications
asadmin deploy app.war
asadmin create-jdbc-resource jdbc/MyDS
asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=100
```

Karakteristik:

- membutuhkan DAS berjalan,
- memakai admin listener,
- memerlukan authentication jika admin security aktif,
- dapat diarahkan ke remote host,
- perubahan biasanya dimediasi oleh domain administration service,
- cocok untuk konfigurasi runtime dan deployment.

Mental model:

```text
remote command
  └── asadmin client
        └── admin listener / DAS
              └── config model / runtime service
```

### 4.3 Kenapa Perbedaan Ini Penting?

Karena failure mode-nya berbeda.

Jika local command gagal:

- domain directory salah,
- permission filesystem salah,
- Java path salah,
- domain sudah running/stopped,
- port conflict saat startup.

Jika remote command gagal:

- DAS belum running,
- admin port salah,
- secure admin belum benar,
- credential salah,
- target tidak ada,
- command tidak valid untuk target,
- config lock/contention,
- network/firewall problem.

Engineer yang tidak membedakan local vs remote akan salah diagnosis.

---

## 5. Command Discovery: Jangan Hafal Semua, Kuasai Cara Menemukan

GlassFish memiliki banyak subcommand. Tidak realistis menghafal semuanya. Yang penting adalah menguasai pola discovery.

### 5.1 Help Dasar

```bash
asadmin help
```

Untuk command tertentu:

```bash
asadmin help deploy
asadmin help create-jdbc-connection-pool
asadmin help set
```

Atau:

```bash
asadmin deploy --help
```

### 5.2 List Command Berdasarkan Pola Nama

Walaupun tidak semua environment menyediakan search built-in yang nyaman, pola command GlassFish cukup konsisten.

Contoh kelompok:

```text
create-*
delete-*
list-*
get-*
set-*
enable-*
disable-*
start-*
stop-*
restart-*
```

Contoh resource:

```text
create-jdbc-connection-pool
create-jdbc-resource
list-jdbc-connection-pools
list-jdbc-resources
delete-jdbc-resource
delete-jdbc-connection-pool
```

Contoh thread pool:

```text
create-threadpool
list-threadpools
delete-threadpool
```

Contoh deployment:

```text
deploy
undeploy
redeploy
list-applications
enable
_disable
```

Catatan: beberapa command berubah/berbeda antar versi. Karena itu script production sebaiknya diuji terhadap versi GlassFish target, bukan diasumsikan portable sempurna antar semua major version.

---

## 6. Lifecycle Command: Domain Start, Stop, Restart

### 6.1 Start Domain

```bash
asadmin start-domain domain1
```

Atau jika domain directory custom:

```bash
asadmin start-domain --domaindir /opt/glassfish/domains domain1
```

Yang terjadi secara konseptual:

```text
1. asadmin menemukan domain directory
2. membaca domain config
3. menemukan JVM yang akan dipakai
4. membangun command line Java
5. menjalankan DAS process
6. DAS bootstrap service internal
7. listener dibuka
8. aplikasi/resource diinisialisasi
9. command selesai saat domain dianggap started
```

### 6.2 Stop Domain

```bash
asadmin stop-domain domain1
```

Stop bukan sekadar kill process. Idealnya server diberi kesempatan:

- menghentikan listener,
- menghentikan aplikasi,
- melepaskan connection pool,
- menghentikan timer/JMS service,
- menulis state yang diperlukan,
- shutdown JVM secara normal.

Jika stop gagal, jangan langsung `kill -9` kecuali emergency. Ambil thread dump terlebih dahulu jika memungkinkan.

### 6.3 Restart Domain

```bash
asadmin restart-domain domain1
```

Restart berguna setelah perubahan yang membutuhkan restart, misalnya:

- beberapa JVM option,
- secure admin activation,
- port/listener tertentu,
- beberapa service config.

Prinsip production:

```text
Restart harus intentional, scheduled, observable, dan punya rollback plan.
```

---

## 7. Admin Authentication dan Password Handling

### 7.1 Admin User dan Admin Password

GlassFish menggunakan admin credential untuk mengakses:

- admin console,
- remote `asadmin`,
- admin REST API.

Dokumentasi GlassFish Security Guide menyebut admin password digunakan untuk Administration Console dan `asadmin` utility. Ini berarti password admin adalah control-plane credential, bukan credential biasa.

### 7.2 Jangan Menaruh Password di Command Line

Buruk:

```bash
asadmin --user admin --password admin123 list-applications
```

Masalah:

- bisa muncul di shell history,
- bisa terlihat lewat process list,
- bisa bocor di CI log,
- sulit dirotasi,
- tidak audit-friendly.

Lebih baik gunakan password file atau login mechanism yang sesuai.

### 7.3 Password File

GlassFish `asadmin` mendukung `--passwordfile` untuk membaca password dari file. Format umum entry password menggunakan prefix `AS_ADMIN_`.

Contoh file:

```properties
AS_ADMIN_PASSWORD=change-me
```

Pemakaian:

```bash
asadmin --user admin --passwordfile /secure/glassfish/admin.pass list-applications
```

Permission file harus ketat:

```bash
chmod 600 /secure/glassfish/admin.pass
chown glassfish:glassfish /secure/glassfish/admin.pass
```

Untuk Windows, prinsipnya sama: batasi akses ACL hanya ke service account/pipeline identity yang perlu.

### 7.4 Password File untuk Command Tertentu

Beberapa command membutuhkan password lain, misalnya:

- admin password,
- master password,
- keystore password,
- truststore password,
- user password.

Contoh konseptual:

```properties
AS_ADMIN_PASSWORD=admin-secret
AS_ADMIN_MASTERPASSWORD=master-secret
```

Jangan menggunakan satu password file global untuk semua environment. Pisahkan berdasarkan:

```text
environment + domain + purpose
```

Contoh:

```text
/secrets/glassfish/dev/domain1-admin.pass
/secrets/glassfish/uat/domain1-admin.pass
/secrets/glassfish/prod/domain1-admin.pass
```

### 7.5 Login File

`asadmin login` dapat menyimpan credential agar command berikutnya tidak perlu memasukkan password secara interaktif.

Contoh:

```bash
asadmin --host localhost --port 4848 login
```

Ini nyaman untuk admin workstation, tetapi harus hati-hati di server/pipeline karena credential tersimpan di file user. Untuk CI/CD, password file atau secret injection biasanya lebih eksplisit dan auditable.

---

## 8. Secure Admin

### 8.1 Apa Itu Secure Admin?

Secure admin mengamankan komunikasi administrasi antara admin client dan DAS/instances. Untuk remote administration, secure admin penting agar control plane tidak terbuka secara plaintext atau tanpa mekanisme keamanan yang memadai.

Command umum:

```bash
asadmin enable-secure-admin
```

Biasanya perlu restart agar perubahan berlaku penuh.

### 8.2 Kapan Secure Admin Wajib?

Secure admin harus dianggap baseline untuk environment selain local dev.

Minimal untuk:

- shared dev server,
- SIT/UAT,
- staging,
- production,
- remote admin host,
- cluster/instance administration,
- automation pipeline yang mengakses remote DAS.

### 8.3 Control Plane Harus Diproteksi

Admin listener tidak boleh diperlakukan seperti HTTP endpoint aplikasi.

Prinsip:

```text
Admin port is control plane. Do not expose it publicly.
```

Checklist:

- bind hanya ke interface internal jika memungkinkan,
- batasi firewall/security group,
- gunakan secure admin,
- gunakan password kuat,
- rotasi credential,
- audit akses admin,
- jangan expose admin console ke internet,
- jangan pakai credential default,
- pisahkan admin network dari user traffic.

---

## 9. Exit Code dan Automation Reliability

Dokumentasi reference manual GlassFish menjelaskan exit status umum:

```text
0 = command executed successfully
1 = error in executing the command
```

Ini terdengar sederhana, tetapi sangat penting untuk pipeline.

Contoh script yang buruk:

```bash
asadmin deploy app.war
echo "deployed"
```

Jika deploy gagal, script tetap lanjut.

Script yang lebih baik:

```bash
set -euo pipefail

asadmin --user "$GF_USER" \
  --passwordfile "$GF_PASSFILE" \
  --host "$GF_HOST" \
  --port "$GF_ADMIN_PORT" \
  deploy --force=true "$APP_WAR"

echo "deployment completed"
```

Untuk PowerShell:

```powershell
& $Asadmin --user $User --passwordfile $PasswordFile --host $HostName --port $AdminPort deploy --force=true $WarPath
if ($LASTEXITCODE -ne 0) {
    throw "GlassFish deployment failed with exit code $LASTEXITCODE"
}
```

Production automation harus memperlakukan exit code sebagai kontrak.

---

## 10. Idempotency: Skill Utama untuk `asadmin` Automation

### 10.1 Apa Itu Idempotency?

Sebuah operasi disebut idempotent jika dijalankan berkali-kali menghasilkan state akhir yang sama.

Contoh tidak idempotent:

```bash
asadmin create-jdbc-resource --connectionpoolid AppPool jdbc/AppDS
```

Jika resource sudah ada, command bisa gagal.

Contoh pendekatan idempotent:

```bash
if ! asadmin list-jdbc-resources | grep -q '^jdbc/AppDS$'; then
  asadmin create-jdbc-resource --connectionpoolid AppPool jdbc/AppDS
fi
```

Namun ini hanya dasar. Engineer senior perlu memperhatikan juga apakah resource yang sudah ada memiliki konfigurasi yang benar.

### 10.2 Idempotent Tidak Sama dengan “Tidak Error”

Ada tiga kemungkinan state:

```text
1. resource belum ada
2. resource sudah ada dan benar
3. resource sudah ada tetapi salah
```

Script naive hanya membedakan ada/tidak ada. Script production harus bisa menangani state ke-3.

Contoh:

```text
jdbc/AppDS sudah ada, tapi menunjuk ke connection pool lama.
```

Dalam kasus ini, melewati creation bukan berarti benar. Kita perlu validate.

### 10.3 Pattern Idempotent

Pattern umum:

```text
read current state
compare expected state
if missing: create
if exists and same: no-op
if exists and different: update or fail intentionally
verify final state
```

Pseudocode:

```text
ensure_jdbc_resource(name, expected_pool):
    current = get resource
    if current missing:
        create resource
    else if current.pool != expected_pool:
        fail or update based on policy
    verify current.pool == expected_pool
```

Policy penting:

- Untuk DEV, boleh auto-update.
- Untuk PROD, perubahan destructive sebaiknya fail dan minta approval.

---

## 11. `get`, `set`, dan Configuration Path

Salah satu kekuatan `asadmin` adalah kemampuan membaca dan mengubah atribut konfigurasi.

Contoh:

```bash
asadmin get server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size
```

Set value:

```bash
asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=100
```

### 11.1 Configuration Path sebagai Object Graph

Jangan melihat path ini sebagai string acak.

Lihat sebagai graph:

```text
server
 └── thread-pools
      └── thread-pool[http-thread-pool]
           └── max-thread-pool-size
```

Ini mirip XPath untuk domain config.

### 11.2 Wildcard Discovery

Biasanya kita bisa melakukan eksplorasi dengan wildcard/pola tertentu:

```bash
asadmin get 'server.*'
asadmin get 'server.thread-pools.*'
asadmin get 'configs.config.server-config.*'
```

Tujuannya:

- menemukan path yang benar,
- membandingkan config antar environment,
- menghindari salah atribut,
- membuat inventory.

### 11.3 `set` Harus Dipakai dengan Hati-Hati

`set` adalah command tajam.

Risiko:

- typo path,
- value tidak valid,
- perubahan butuh restart tetapi tidak diketahui,
- perubahan berlaku pada target yang salah,
- perubahan runtime menyebabkan instability.

Praktik aman:

```text
1. get current value
2. record before value
3. set new value
4. get after value
5. restart jika required
6. verify runtime behavior
```

Contoh:

```bash
CURRENT=$(asadmin get server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size)
echo "Before: $CURRENT"

asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=100

AFTER=$(asadmin get server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size)
echo "After: $AFTER"
```

---

## 12. Target-Aware Administration

Banyak command GlassFish memiliki `--target`.

Target bisa berupa:

- `server`,
- standalone instance,
- cluster,
- config,
- domain-level object tergantung command.

Contoh:

```bash
asadmin create-jdbc-resource --target server --connectionpoolid AppPool jdbc/AppDS
```

Atau:

```bash
asadmin create-jdbc-resource --target my-cluster --connectionpoolid AppPool jdbc/AppDS
```

### 12.1 Kesalahan Umum

Kesalahan umum:

```text
resource dibuat di domain, tetapi tidak direferensikan oleh target yang menjalankan aplikasi
```

Akibat:

```text
Aplikasi deploy sukses di satu target, gagal di target lain.
JNDI lookup gagal di runtime.
```

### 12.2 Rule of Thumb

Selalu tanyakan:

```text
Aplikasi berjalan di target mana?
Resource harus tersedia di target mana?
Config yang diubah dipakai target mana?
```

Dalam cluster, jangan asal target `server`.

---

## 13. Deployment Command Deep Dive

### 13.1 Basic Deploy

```bash
asadmin deploy app.war
```

Dengan context root:

```bash
asadmin deploy --contextroot myapp app.war
```

Dengan target:

```bash
asadmin deploy --target my-cluster --contextroot myapp app.war
```

### 13.2 Redeploy / Force

```bash
asadmin deploy --force=true --contextroot myapp app.war
```

`--force=true` sering dipakai untuk mengganti deployment yang sudah ada. Namun ini harus dipakai dengan kesadaran:

- apakah session akan hilang?
- apakah ada request aktif?
- apakah ada background timer?
- apakah ada MDB consumer?
- apakah ada transaction in-flight?
- apakah ada migration DB yang belum kompatibel?

### 13.3 List Applications

```bash
asadmin list-applications
```

Dengan target tertentu:

```bash
asadmin list-applications --target my-cluster
```

### 13.4 Undeploy

```bash
asadmin undeploy myapp
```

Risiko undeploy:

- resource cleanup,
- generated artifacts,
- classloader release,
- active requests,
- timers/listeners.

Untuk production, undeploy harus deliberate.

### 13.5 Deployment Verification

Deploy selesai belum tentu aplikasi sehat.

Minimal verify:

```text
1. command exit code 0
2. app muncul di list-applications
3. context root dapat diakses
4. health endpoint OK
5. log tidak ada deployment warning serius
6. JDBC/JMS resource reachable
7. smoke test endpoint bisnis lolos
```

Contoh:

```bash
asadmin list-applications | grep '^myapp '
curl -fsS http://localhost:8080/myapp/health
```

---

## 14. JDBC Resource Automation Example

Mari buat contoh provisioning JDBC secara lebih serius.

### 14.1 Naive Version

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=app:password=secret:url=jdbc\\:oracle\\:thin\\:@//dbhost:1521/service \
  AppPool

asadmin create-jdbc-resource \
  --connectionpoolid AppPool \
  jdbc/AppDS
```

Masalah:

- password terlihat di command/log,
- tidak idempotent,
- tidak validate existing state,
- tidak target-aware,
- tidak test connection,
- tidak environment-aware,
- berpotensi beda untuk `javax.sql.DataSource` vs `jakarta` context tergantung server/API era.

### 14.2 Better Production Shape

```bash
#!/usr/bin/env bash
set -euo pipefail

GF_HOST="${GF_HOST:-localhost}"
GF_PORT="${GF_PORT:-4848}"
GF_USER="${GF_USER:-admin}"
GF_PASSFILE="${GF_PASSFILE:?GF_PASSFILE is required}"
GF_TARGET="${GF_TARGET:-server}"

POOL_NAME="AppPool"
JNDI_NAME="jdbc/AppDS"
DB_USER="${DB_USER:?DB_USER is required}"
DB_PASSWORD_ALIAS="${DB_PASSWORD_ALIAS:?DB_PASSWORD_ALIAS is required}"
DB_URL="${DB_URL:?DB_URL is required}"

ASADMIN=(asadmin --host "$GF_HOST" --port "$GF_PORT" --user "$GF_USER" --passwordfile "$GF_PASSFILE")

if ! "${ASADMIN[@]}" list-jdbc-connection-pools | grep -qx "$POOL_NAME"; then
  "${ASADMIN[@]}" create-jdbc-connection-pool \
    --datasourceclassname oracle.jdbc.pool.OracleDataSource \
    --restype javax.sql.DataSource \
    --property "user=$DB_USER:password=\${ALIAS=$DB_PASSWORD_ALIAS}:url=$DB_URL" \
    "$POOL_NAME"
fi

if ! "${ASADMIN[@]}" list-jdbc-resources --target "$GF_TARGET" | grep -qx "$JNDI_NAME"; then
  "${ASADMIN[@]}" create-jdbc-resource \
    --target "$GF_TARGET" \
    --connectionpoolid "$POOL_NAME" \
    "$JNDI_NAME"
fi

"${ASADMIN[@]}" ping-connection-pool "$POOL_NAME"
```

Catatan:

- Ini masih perlu disesuaikan dengan versi/server/driver.
- Password alias dan property escaping perlu diuji di environment target.
- Untuk Jakarta EE modern, resource type tetap berkaitan dengan JDBC API Java SE (`javax.sql.DataSource`) karena JDBC masih Java SE package `javax.sql`, bukan Jakarta namespace.

### 14.3 Pelajaran Penting

JDBC automation bukan hanya membuat resource. Ia harus menjawab:

```text
1. apakah pool sudah ada?
2. apakah pool benar?
3. apakah resource sudah ada pada target yang benar?
4. apakah credential aman?
5. apakah koneksi benar-benar bisa dipakai?
6. apakah perubahan butuh restart?
7. apakah aplikasi memakai JNDI name yang sama?
```

---

## 15. Password Alias dan Secret Hygiene

GlassFish mendukung konsep password alias untuk menghindari penyimpanan secret literal di konfigurasi.

Mental model:

```text
config contains alias reference
secure store contains actual secret
runtime resolves alias when needed
```

Ini lebih baik daripada:

```xml
<property name="password" value="plain-text-secret"/>
```

Namun password alias bukan silver bullet.

Hal yang tetap harus dijaga:

- master password,
- file permission,
- backup encryption,
- secret rotation process,
- CI/CD log masking,
- siapa yang bisa menjalankan `asadmin get`,
- siapa yang bisa membaca domain config,
- siapa yang bisa membaca keystore/password store.

Untuk cloud-native environment, sering lebih baik mengintegrasikan secret manager eksternal dan inject pada provisioning/runtime sesuai kebijakan organisasi.

---

## 16. Scripting Pattern: Wrapper Function

Agar script tidak repetitif, buat wrapper.

### 16.1 Bash Wrapper

```bash
#!/usr/bin/env bash
set -euo pipefail

GF_HOME="${GF_HOME:-/opt/glassfish7/glassfish}"
ASADMIN_BIN="$GF_HOME/bin/asadmin"
GF_HOST="${GF_HOST:-localhost}"
GF_PORT="${GF_PORT:-4848}"
GF_USER="${GF_USER:-admin}"
GF_PASSFILE="${GF_PASSFILE:?GF_PASSFILE is required}"

asadmin_cmd() {
  "$ASADMIN_BIN" \
    --host "$GF_HOST" \
    --port "$GF_PORT" \
    --user "$GF_USER" \
    --passwordfile "$GF_PASSFILE" \
    "$@"
}

asadmin_cmd list-applications
```

Keuntungan:

- konsisten,
- credential tidak diulang,
- mudah log command secara aman,
- mudah pindah host/port,
- mudah dipakai untuk environment berbeda.

### 16.2 PowerShell Wrapper

```powershell
$ErrorActionPreference = "Stop"

$GlassFishHome = $env:GF_HOME
if (-not $GlassFishHome) { $GlassFishHome = "C:\glassfish7\glassfish" }

$Asadmin = Join-Path $GlassFishHome "bin\asadmin.bat"
$HostName = if ($env:GF_HOST) { $env:GF_HOST } else { "localhost" }
$AdminPort = if ($env:GF_PORT) { $env:GF_PORT } else { "4848" }
$User = if ($env:GF_USER) { $env:GF_USER } else { "admin" }
$PasswordFile = $env:GF_PASSFILE

if (-not $PasswordFile) {
    throw "GF_PASSFILE is required"
}

function Invoke-Asadmin {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)

    & $Asadmin --host $HostName --port $AdminPort --user $User --passwordfile $PasswordFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "asadmin failed: $($Arguments -join ' ')"
    }
}

Invoke-Asadmin list-applications
```

---

## 17. Environment Promotion: DEV → SIT → UAT → PROD

### 17.1 Masalah Umum

Konfigurasi GlassFish sering berkembang seperti ini:

```text
DEV: dibuat oleh developer A
SIT: ditambah manual oleh QA support
UAT: disesuaikan oleh infra
PROD: dibuat ulang oleh ops berdasarkan dokumen lama
```

Hasilnya:

```text
DEV != SIT != UAT != PROD
```

Lalu muncul bug:

```text
Works in UAT, fails in PROD.
```

### 17.2 Desired State

Lebih baik:

```text
common baseline script
  + environment variable file
  + secret injection
  + controlled overrides
  + validation
```

Struktur contoh:

```text
glassfish-config/
  common/
    00-admin-security.sh
    10-http-listeners.sh
    20-thread-pools.sh
    30-jdbc.sh
    40-jms.sh
    50-logging.sh
    60-monitoring.sh
  env/
    dev.env
    sit.env
    uat.env
    prod.env
  scripts/
    apply.sh
    validate.sh
    diff.sh
```

### 17.3 Prinsip Promotion

Yang dipromosikan bukan “hasil klik”, tetapi:

```text
artifact + config intent + migration script + validation evidence
```

---

## 18. Reading State: Inventory dan Drift Detection

`asadmin` bukan hanya untuk mengubah state. Ia juga untuk membaca state.

Contoh inventory:

```bash
asadmin list-applications
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
asadmin list-threadpools
asadmin list-http-listeners
asadmin list-network-listeners
asadmin list-jms-resources
asadmin get 'server.*'
```

Drift detection sederhana:

```bash
asadmin get 'server.*' > prod-server-config.snapshot
```

Bandingkan antar waktu:

```bash
diff prod-server-config-2026-06-01.snapshot prod-server-config-2026-06-21.snapshot
```

Namun hati-hati: output bisa mengandung nilai environment-specific atau secret reference. Jangan commit secret ke Git.

### 18.1 Better Drift Strategy

Pisahkan:

```text
expected config declaration
actual config snapshot
comparison report
approved exceptions
```

Contoh:

```text
expected:
  http-thread-pool.max=100
actual:
  http-thread-pool.max=200
status:
  drift / require approval
```

---

## 19. `domain.xml` vs `asadmin`

Pertanyaan klasik:

```text
Boleh edit domain.xml langsung?
```

Jawaban engineering:

```text
Bisa dalam kondisi tertentu, tetapi bukan default operational path.
```

### 19.1 Kenapa Jangan Sembarangan Edit `domain.xml`?

Risiko:

- XML invalid,
- schema/config inconsistency,
- server sedang running dan overwrite state,
- tidak semua perubahan cukup dengan edit file,
- beberapa command melakukan validasi tambahan,
- beberapa object butuh reference/link yang benar,
- restart behavior tidak jelas.

### 19.2 Kapan Edit Manual Masuk Akal?

- disaster recovery saat admin command tidak bisa berjalan,
- offline repair domain config,
- controlled templating sebelum domain pernah dijalankan,
- diff/review configuration,
- investigation.

### 19.3 Rule

```text
Use asadmin for operational mutation.
Use domain.xml for inspection, baseline, backup, and controlled offline recovery.
```

---

## 20. Remote Administration Pattern

Contoh remote command:

```bash
asadmin --host gf-admin.internal \
  --port 4848 \
  --user admin \
  --passwordfile /secure/prod-admin.pass \
  list-applications
```

Pertanyaan yang harus dijawab sebelum mengizinkan remote admin:

1. Siapa yang boleh akses host admin?
2. Dari network mana?
3. Apakah secure admin aktif?
4. Apakah admin port dibatasi firewall?
5. Apakah credential dirotasi?
6. Apakah command tercatat di audit log/pipeline log?
7. Apakah ada break-glass account?
8. Apakah ada approval untuk prod mutation?

Remote admin yang tidak dikontrol adalah risiko besar karena memberi akses ke control plane.

---

## 21. Command Group yang Wajib Dikuasai

### 21.1 Domain Lifecycle

```text
create-domain
start-domain
stop-domain
restart-domain
delete-domain
list-domains
```

Kegunaan:

- provisioning,
- local runtime,
- repair,
- controlled restart.

### 21.2 Application Lifecycle

```text
deploy
undeploy
redeploy
list-applications
enable
disable
```

Kegunaan:

- release,
- rollback,
- smoke test,
- troubleshooting.

### 21.3 Config Inspection/Mutation

```text
get
set
list
```

Kegunaan:

- inspect state,
- tune runtime,
- drift detection.

### 21.4 JDBC

```text
create-jdbc-connection-pool
list-jdbc-connection-pools
delete-jdbc-connection-pool
create-jdbc-resource
list-jdbc-resources
delete-jdbc-resource
ping-connection-pool
```

Kegunaan:

- database integration,
- connection pool lifecycle,
- deployment dependency.

### 21.5 Network / HTTP

```text
create-network-listener
list-network-listeners
delete-network-listener
create-http-listener
list-http-listeners
create-virtual-server
list-virtual-servers
```

Kegunaan:

- port/listener management,
- reverse proxy integration,
- virtual host routing.

### 21.6 Thread Pool

```text
create-threadpool
list-threadpools
delete-threadpool
```

Kegunaan:

- concurrency tuning,
- isolation of workload.

### 21.7 JMS

```text
create-jms-resource
list-jms-resources
delete-jms-resource
create-jmsdest
list-jmsdest
delete-jmsdest
```

Kegunaan:

- async workload,
- MDB integration,
- message broker setup.

### 21.8 Security

```text
change-admin-password
enable-secure-admin
disable-secure-admin
create-auth-realm
list-auth-realms
create-password-alias
list-password-aliases
delete-password-alias
```

Kegunaan:

- admin security,
- realm config,
- secret hygiene.

### 21.9 Monitoring

```text
enable-monitoring
get configs.config.server-config.monitoring-service.*
```

Kegunaan:

- runtime visibility,
- performance diagnosis.

---

## 22. Failure Mode: Command Sukses Tapi Sistem Tetap Salah

Ini level penting.

Tidak semua kegagalan terlihat sebagai exit code non-zero.

Contoh:

```bash
asadmin create-jdbc-resource --target server --connectionpoolid AppPool jdbc/AppDS
```

Command sukses. Tetapi aplikasi berjalan di cluster `app-cluster`, bukan target `server`.

Akibat:

```text
JNDI lookup gagal saat aplikasi diakses.
```

Contoh lain:

```bash
asadmin deploy --force=true app.war
```

Deploy sukses. Tetapi:

- health endpoint gagal,
- app tidak bisa connect DB,
- background scheduler error,
- JMS consumer tidak consume,
- security realm mismatch,
- classloading warning muncul di log.

Prinsip:

```text
Command success only means administrative operation succeeded.
It does not prove business runtime readiness.
```

Karena itu selalu ada tahap verification.

---

## 23. Verification Pyramid

Untuk setiap automation, gunakan verification pyramid.

```text
Level 5: business smoke test
Level 4: application health endpoint
Level 3: runtime dependency check
Level 2: GlassFish admin state check
Level 1: command exit code
```

Contoh untuk deployment:

```text
L1: asadmin deploy exit code 0
L2: list-applications contains app
L3: ping connection pool OK, JMS resource exists
L4: /health returns UP
L5: login/search/create/read critical business scenario works
```

Engineer biasa berhenti di L1. Engineer kuat minimal sampai L4, untuk prod idealnya L5.

---

## 24. Safe Change Pattern untuk Production

Setiap perubahan GlassFish production sebaiknya mengikuti pola:

```text
1. Capture before state
2. Validate precondition
3. Apply smallest change
4. Capture after state
5. Restart only if required
6. Verify admin state
7. Verify runtime health
8. Verify business smoke test
9. Record evidence
10. Prepare rollback
```

Contoh checklist:

```text
Change: increase http-thread-pool max from 50 to 100

Before:
- current value = 50
- CPU average = 40%
- DB pool max = 60
- request latency p95 = 2s

Risk:
- more concurrent requests may overload DB

Apply:
- set max-thread-pool-size=100

After:
- value = 100
- restart? no/yes depending attribute behavior
- p95 improved or not
- DB pool saturation observed or not

Rollback:
- set value back to 50
```

---

## 25. Anti-Patterns yang Harus Dihindari

### 25.1 Console-Only Production Config

```text
“Sudah saya set di console.”
```

Masalah:

- tidak repeatable,
- tidak reviewable,
- tidak auditable,
- tidak bisa dipromosikan.

### 25.2 Blind `set`

```bash
asadmin set some.path=value
```

tanpa `get` before/after.

### 25.3 Satu Script untuk Semua Environment Tanpa Guard

Bahaya jika prod menjalankan config dev.

Gunakan guard:

```bash
if [[ "$ENV" == "prod" && "$ALLOW_PROD_CHANGE" != "true" ]]; then
  echo "Refusing to mutate production without explicit approval"
  exit 1
fi
```

### 25.4 Password di Log

Jangan echo command penuh jika mengandung secret.

### 25.5 Menganggap Resource Domain-Level Otomatis Tersedia di Semua Target

Selalu cek target.

### 25.6 Deploy Tanpa Smoke Test

Deploy success bukan ready.

### 25.7 Tidak Menyimpan Evidence

Setiap change penting harus punya evidence:

- command run,
- output,
- timestamp,
- operator/pipeline,
- before/after config,
- verification result.

---

## 26. Production-Grade Bootstrap Script Blueprint

Berikut blueprint, bukan script final universal.

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# GlassFish Bootstrap Script
# ============================================================
# Purpose:
# - apply baseline config
# - create required resources
# - validate runtime state
# - avoid manual drift
# ============================================================

ENVIRONMENT="${ENVIRONMENT:?ENVIRONMENT is required}"
GF_HOME="${GF_HOME:?GF_HOME is required}"
GF_HOST="${GF_HOST:-localhost}"
GF_PORT="${GF_PORT:-4848}"
GF_USER="${GF_USER:-admin}"
GF_PASSFILE="${GF_PASSFILE:?GF_PASSFILE is required}"
GF_TARGET="${GF_TARGET:-server}"

ASADMIN_BIN="$GF_HOME/bin/asadmin"

asadmin_cmd() {
  "$ASADMIN_BIN" \
    --host "$GF_HOST" \
    --port "$GF_PORT" \
    --user "$GF_USER" \
    --passwordfile "$GF_PASSFILE" \
    "$@"
}

require_not_empty() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Required value missing: $name" >&2
    exit 1
  fi
}

ensure_jdbc_pool_exists() {
  local pool="$1"
  local datasource_class="$2"
  local restype="$3"
  local properties="$4"

  if asadmin_cmd list-jdbc-connection-pools | grep -qx "$pool"; then
    echo "JDBC pool exists: $pool"
  else
    echo "Creating JDBC pool: $pool"
    asadmin_cmd create-jdbc-connection-pool \
      --datasourceclassname "$datasource_class" \
      --restype "$restype" \
      --property "$properties" \
      "$pool"
  fi
}

ensure_jdbc_resource_exists() {
  local jndi="$1"
  local pool="$2"
  local target="$3"

  if asadmin_cmd list-jdbc-resources --target "$target" | grep -qx "$jndi"; then
    echo "JDBC resource exists on target $target: $jndi"
  else
    echo "Creating JDBC resource: $jndi on $target"
    asadmin_cmd create-jdbc-resource \
      --target "$target" \
      --connectionpoolid "$pool" \
      "$jndi"
  fi
}

capture_state() {
  local output_dir="$1"
  mkdir -p "$output_dir"
  asadmin_cmd list-applications > "$output_dir/applications.txt"
  asadmin_cmd list-jdbc-connection-pools > "$output_dir/jdbc-pools.txt"
  asadmin_cmd list-jdbc-resources --target "$GF_TARGET" > "$output_dir/jdbc-resources.txt"
  asadmin_cmd get 'server.*' > "$output_dir/server-config.txt" || true
}

main() {
  echo "Applying GlassFish baseline for environment: $ENVIRONMENT"

  capture_state "evidence/before"

  # Example only; real values should come from env/secret manager.
  require_not_empty "DB_USER" "${DB_USER:-}"
  require_not_empty "DB_URL" "${DB_URL:-}"
  require_not_empty "DB_PASSWORD_ALIAS" "${DB_PASSWORD_ALIAS:-}"

  ensure_jdbc_pool_exists \
    "AppPool" \
    "oracle.jdbc.pool.OracleDataSource" \
    "javax.sql.DataSource" \
    "user=$DB_USER:password=\${ALIAS=$DB_PASSWORD_ALIAS}:url=$DB_URL"

  ensure_jdbc_resource_exists \
    "jdbc/AppDS" \
    "AppPool" \
    "$GF_TARGET"

  asadmin_cmd ping-connection-pool "AppPool"

  capture_state "evidence/after"

  echo "GlassFish baseline completed"
}

main "$@"
```

Yang penting dari blueprint ini bukan command spesifik, tetapi struktur:

```text
validate input → wrap asadmin → ensure resource → verify → capture evidence
```

---

## 27. Windows/PowerShell Automation Blueprint

Karena banyak enterprise Java team menggunakan Windows untuk development dan Linux untuk server, PowerShell wrapper berguna untuk local/dev/admin workstation.

```powershell
$ErrorActionPreference = "Stop"

$Environment = $env:ENVIRONMENT
if (-not $Environment) { throw "ENVIRONMENT is required" }

$GlassFishHome = $env:GF_HOME
if (-not $GlassFishHome) { throw "GF_HOME is required" }

$Asadmin = Join-Path $GlassFishHome "bin\asadmin.bat"
$HostName = if ($env:GF_HOST) { $env:GF_HOST } else { "localhost" }
$AdminPort = if ($env:GF_PORT) { $env:GF_PORT } else { "4848" }
$User = if ($env:GF_USER) { $env:GF_USER } else { "admin" }
$PasswordFile = $env:GF_PASSFILE
$Target = if ($env:GF_TARGET) { $env:GF_TARGET } else { "server" }

if (-not $PasswordFile) { throw "GF_PASSFILE is required" }

function Invoke-Asadmin {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)

    & $Asadmin --host $HostName --port $AdminPort --user $User --passwordfile $PasswordFile @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "asadmin failed: $($Arguments -join ' ')"
    }
}

function Test-AsadminListContains {
    param(
        [string[]]$CommandArgs,
        [string]$Expected
    )

    $output = & $Asadmin --host $HostName --port $AdminPort --user $User --passwordfile $PasswordFile @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        throw "asadmin list command failed: $($CommandArgs -join ' ')"
    }
    return $output -contains $Expected
}

Write-Host "Applying GlassFish config for $Environment"

Invoke-Asadmin list-applications

if (-not (Test-AsadminListContains -CommandArgs @("list-jdbc-resources", "--target", $Target) -Expected "jdbc/AppDS")) {
    Invoke-Asadmin create-jdbc-resource --target $Target --connectionpoolid AppPool jdbc/AppDS
}

Invoke-Asadmin ping-connection-pool AppPool

Write-Host "Completed"
```

---

## 28. Operational Runbook Template untuk `asadmin`

Setiap organisasi yang menjalankan GlassFish production sebaiknya punya runbook command.

Contoh template:

```markdown
# GlassFish Runbook: Deploy Application

## Scope
Deploy `myapp.war` to `app-cluster`.

## Preconditions
- Change ticket approved.
- Artifact checksum verified.
- DB migration completed or not required.
- Admin password file available to pipeline only.
- DAS reachable from deployment runner.

## Before State
```bash
asadmin list-applications --target app-cluster
asadmin get 'configs.config.server-config.*'
```

## Command
```bash
asadmin --host gf-admin.internal \
  --port 4848 \
  --user admin \
  --passwordfile /secure/prod-admin.pass \
  deploy --target app-cluster --force=true --contextroot myapp myapp.war
```

## Verification
```bash
asadmin list-applications --target app-cluster
curl -fsS https://app.example.com/myapp/health
```

## Rollback
```bash
asadmin deploy --target app-cluster --force=true --contextroot myapp previous/myapp.war
```

## Evidence
- Pipeline run ID:
- Operator:
- Timestamp:
- Artifact checksum:
- Health result:
```

Runbook seperti ini membantu regulatory defensibility.

---

## 29. Troubleshooting `asadmin` Failure

### 29.1 `Command ... failed`

Langkah:

```text
1. baca full output command
2. cek exit code
3. cek server.log
4. cek apakah command local/remote
5. cek apakah DAS running
6. cek credential
7. cek target
8. cek apakah object sudah ada/belum ada
9. cek apakah command didukung versi tersebut
```

### 29.2 Tidak Bisa Connect ke Admin Port

Kemungkinan:

- DAS belum start,
- port salah,
- host salah,
- firewall/security group,
- secure admin mismatch,
- listener bind ke interface berbeda,
- DNS salah.

Command diagnosis:

```bash
asadmin list-domains
netstat -an | grep 4848
curl -k https://host:4848
```

### 29.3 Authentication Failed

Kemungkinan:

- password file salah,
- user salah,
- password sudah dirotasi,
- login file stale,
- environment variable conflict,
- admin realm berubah.

### 29.4 Object Already Exists

Ini biasanya tanda script tidak idempotent.

Solusi:

- check existence sebelum create,
- compare config,
- decide update/fail/no-op.

### 29.5 Object Not Found

Kemungkinan:

- target salah,
- nama berbeda,
- resource belum direferensikan ke target,
- case-sensitive mismatch,
- environment drift.

### 29.6 Command Sukses Tapi Tidak Berefek

Kemungkinan:

- mengubah config yang tidak dipakai target,
- butuh restart,
- aplikasi punya override descriptor,
- ada config inheritance yang berbeda,
- command mengubah domain-level object tetapi bukan reference target.

---

## 30. Case Study: Mengubah HTTP Thread Pool Secara Aman

Misal ada masalah:

```text
Saat traffic naik, request mulai timeout. Dugaan awal: HTTP thread pool habis.
```

Engineer junior mungkin langsung:

```bash
asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=300
```

Engineer senior bertanya:

```text
Apakah benar thread pool habis?
Apakah CPU masih tersedia?
Apakah DB pool cukup?
Apakah bottleneck sebenarnya DB?
Apakah menaikkan thread akan memperburuk queue di downstream?
```

Langkah lebih baik:

```bash
asadmin get server.thread-pools.thread-pool.http-thread-pool.*
```

Capture:

```text
current max thread
current queue size config
current request latency
JDBC pool utilization
CPU utilization
GC pause
thread dump sample
```

Jika valid:

```bash
asadmin set server.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=100
```

Lalu verify:

```text
- p95 latency turun?
- DB pool saturation naik?
- CPU masih aman?
- error rate turun?
- GC tidak memburuk?
```

Kesimpulan penting:

```text
asadmin lets you change config.
Engineering tells you whether the change is correct.
```

---

## 31. Case Study: Provisioning Environment Baru

Target:

```text
Provision GlassFish domain untuk aplikasi enterprise baru.
```

Urutan automation:

```text
1. install GlassFish distribution
2. create domain
3. start domain
4. change admin password
5. enable secure admin
6. restart domain
7. create password aliases
8. create JDBC pools
9. create JDBC resources
10. create JMS resources
11. configure logging
12. configure monitoring
13. configure thread pools
14. deploy app
15. run smoke test
16. capture final state
```

Contoh high-level command:

```bash
asadmin create-domain --adminport 4848 --instanceport 8080 app-domain
asadmin start-domain app-domain
asadmin change-admin-password
asadmin enable-secure-admin
asadmin restart-domain app-domain
asadmin create-password-alias db-password
asadmin create-jdbc-connection-pool ... AppPool
asadmin create-jdbc-resource --connectionpoolid AppPool jdbc/AppDS
asadmin deploy --contextroot app app.war
```

Tetapi dalam production script, command interactive seperti `change-admin-password` dan `create-password-alias` harus ditangani dengan mekanisme password file/automation yang aman sesuai versi dan kebijakan security.

---

## 32. Design Principle: Admin CLI sebagai Declarative Intent Layer

Walaupun `asadmin` bersifat imperative command, kita bisa menggunakannya untuk mendekati model deklaratif.

Daripada berpikir:

```text
jalankan command A, B, C
```

Pikirkan:

```text
pastikan state akhir domain adalah X
```

Contoh desired state:

```yaml
domain: app-domain
target: app-cluster
jdbc:
  pools:
    AppPool:
      datasourceClass: oracle.jdbc.pool.OracleDataSource
      restype: javax.sql.DataSource
      maxPoolSize: 50
  resources:
    jdbc/AppDS:
      pool: AppPool
      target: app-cluster
applications:
  myapp:
    artifact: myapp.war
    contextRoot: myapp
    target: app-cluster
```

Script membaca desired state, lalu menerjemahkan ke `asadmin`.

Ini pola yang lebih matang daripada kumpulan command manual.

---

## 33. Checklist: Skill `asadmin` yang Harus Dikuasai

Setelah Part 4, kamu harus mampu:

- membedakan local command dan remote command,
- menjalankan command dengan credential aman,
- memahami admin host/port/user/passwordfile,
- membuat wrapper `asadmin`,
- membaca exit code,
- membuat script idempotent,
- melakukan `get`/`set` config path,
- memahami target-aware command,
- deploy/undeploy app secara aman,
- membuat JDBC resource via CLI,
- membuat evidence before/after,
- melakukan drift detection dasar,
- menulis runbook deployment,
- mendiagnosis command failure,
- menghindari password leakage,
- membedakan command success vs runtime readiness.

---

## 34. Ringkasan Mental Model

`asadmin` adalah:

```text
administrative API + automation surface + operational contract
```

Bukan:

```text
sekadar command line untuk start server
```

Gunakan `asadmin` untuk:

- provisioning,
- deployment,
- configuration mutation,
- runtime inspection,
- drift detection,
- environment promotion,
- production runbook,
- failure diagnosis.

Tetapi jangan lupa:

```text
asadmin confirms administrative operation.
It does not automatically prove application correctness.
```

Karena itu, selalu gabungkan:

```text
asadmin command
  + state verification
  + dependency check
  + health check
  + business smoke test
  + evidence capture
```

Itulah perbedaan antara sekadar bisa menjalankan GlassFish dan benar-benar mampu mengoperasikan GlassFish sebagai runtime enterprise.

---

## 35. Latihan Praktis

### Latihan 1 — Command Anatomy

Ambil command berikut:

```bash
asadmin --host localhost --port 4848 --user admin --passwordfile ./admin.pass deploy --target app-cluster --contextroot aceas aceas.war
```

Pisahkan menjadi:

- asadmin-options,
- subcommand,
- subcommand-options,
- operand.

### Latihan 2 — Local vs Remote

Klasifikasikan command berikut:

```text
start-domain
create-domain
list-applications
create-jdbc-resource
set
stop-domain
deploy
```

Tentukan mana yang local, mana yang remote, dan mana yang tergantung mode/opsi.

### Latihan 3 — Idempotent JDBC Script

Buat script yang memastikan:

```text
connection pool AppPool exists
JNDI resource jdbc/AppDS exists
resource ditargetkan ke server atau cluster yang benar
ping-connection-pool berhasil
```

### Latihan 4 — Drift Detection

Capture konfigurasi DEV dan UAT:

```bash
asadmin get 'server.*' > dev.txt
asadmin get 'server.*' > uat.txt
```

Bandingkan dan kelompokkan perbedaan menjadi:

- expected environment difference,
- suspicious drift,
- security-sensitive difference,
- tuning difference.

### Latihan 5 — Deployment Verification

Buat deployment checklist minimal untuk aplikasi WAR:

```text
command success
list-applications
server.log check
health endpoint
critical endpoint smoke test
rollback command
```

---

## 36. Referensi Resmi yang Relevan

Untuk memperdalam bagian ini, rujuk dokumentasi resmi GlassFish:

- Eclipse GlassFish Reference Manual, terutama halaman `asadmin` dan subcommand reference.
- Eclipse GlassFish Administration Guide.
- Eclipse GlassFish Security Guide, terutama bagian admin password dan secure administration.
- Eclipse GlassFish Quick Start Guide untuk command dasar domain dan deployment.

---

## 37. Status Seri

Part ini adalah **Part 4 dari 35**.

Status:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — berikutnya
```

Seri **belum selesai**.

Part berikutnya:

```text
Part 5 — Admin Console, REST Admin API, dan Configuration as Code
```

Di Part 5, kita akan membahas tiga surface administrasi GlassFish:

1. Admin Console sebagai inspection/manual admin UI.
2. REST Admin API sebagai programmable admin surface.
3. Configuration as Code sebagai pendekatan engineering untuk mencegah drift dan membuat domain configuration repeatable.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-003.md">⬅️ Part 3 — Domain Model: DAS, Instance, Node, Cluster, Config, dan Target</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-005.md">Part 5 — Admin Console, REST Admin API, dan Configuration as Code ➡️</a>
</div>
