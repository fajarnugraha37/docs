# learn-docker-mastery-for-java-engineers-part-011.md

# Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State

> Seri: `learn-docker-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead  
> Posisi dalam seri: setelah lifecycle, CLI, Dockerfile, BuildKit, multi-stage Java build, JVM runtime, dan `ENTRYPOINT`/`CMD`; sebelum Docker networking dan Compose.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas satu batas konseptual yang sering terlihat sederhana tetapi sering menjadi sumber incident: **filesystem container**.

Setelah bagian ini, kamu harus bisa menjawab dengan tajam:

1. Apa bedanya data di image layer, writable container layer, volume, bind mount, dan tmpfs?
2. Kenapa container harus dianggap disposable, tetapi state aplikasi tetap bisa persisten?
3. Kenapa file yang ada di image bisa “hilang” ketika mount dipasang?
4. Kenapa permission sering gagal ketika aplikasi Java berjalan sebagai non-root user?
5. Kapan memakai named volume, bind mount, tmpfs, atau tidak memakai mount sama sekali?
6. Bagaimana merancang path `/tmp`, logs, uploads, cache, generated reports, heap dump, dan config file untuk service Java dalam container?
7. Bagaimana melakukan backup/restore volume dan debugging storage issue tanpa menjadikan container sebagai mutable server?

Docker secara resmi membedakan beberapa mekanisme storage: writable layer container, volume mounts, bind mounts, dan tmpfs mounts. Volume dan bind mount menyimpan data di luar writable layer, sedangkan tmpfs menyimpan data secara sementara di memory host. Dokumentasi Docker juga menyebut volume sebagai mekanisme yang direkomendasikan untuk persistensi data yang dihasilkan dan digunakan container karena Docker yang mengelola lokasi storage-nya.

---

## 1. Mental Model Utama

Docker filesystem punya tiga zona besar:

```text
IMAGE LAYERS
  immutable, dibangun saat docker build
  berisi OS base, JVM, dependency, app artifact, default config

CONTAINER WRITABLE LAYER
  mutable, dibuat saat container dibuat
  hilang saat container dihapus
  cocok hanya untuk state sementara yang tidak penting

EXTERNAL MOUNTS
  volume / bind mount / tmpfs
  berada di luar writable layer
  lifecycle-nya tidak sama dengan container
```

Prinsip terpenting:

```text
Image harus immutable.
Container harus disposable.
Business state harus hidup di luar container.
```

Container yang benar tidak diperlakukan seperti server kecil yang dipelihara manual. Container adalah instance runtime dari image. Kalau container rusak, mati, atau dihapus, kita seharusnya bisa membuat ulang container dari image dan external state/config tanpa kehilangan data penting.

---

## 2. Image Layer vs Writable Layer

Saat kamu build image:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Docker membuat image yang terdiri dari beberapa layer immutable. Saat image dijalankan:

```bash
docker run my-service:1.0.0
```

Docker membuat container baru dengan writable layer tipis di atas image layers.

Secara mental:

```text
container writable layer    <- perubahan runtime
image layer: app.jar        <- immutable
image layer: JVM            <- immutable
image layer: OS files       <- immutable
```

Kalau aplikasi menulis file ke `/app/output.txt`, file itu tidak masuk ke image. File itu masuk ke writable layer container.

Jika container dihapus:

```bash
docker rm my-container
```

writable layer ikut hilang.

Jika kamu menjalankan container baru dari image yang sama, file runtime tadi tidak ada.

---

## 3. Kenapa Writable Layer Bukan Tempat Persistensi

Writable layer terlihat mudah karena aplikasi bisa langsung menulis file ke filesystem container. Tetapi ada masalah besar:

1. Lifecycle terikat container.
2. Sulit di-backup secara eksplisit.
3. Sulit dipindahkan lintas host.
4. Bisa memperbesar disk usage tanpa terlihat.
5. Tidak cocok untuk data yang harus survive container recreate.
6. Secara performa dan operasional bukan tempat ideal untuk high-write data.

Contoh buruk:

```text
/app/uploads
/app/reports
/app/db
/app/logs
```

Jika semua ditulis ke writable layer, maka saat container dihapus atau diganti, data hilang.

Untuk Java service, writable layer boleh dipakai untuk:

```text
/tmp scratch file yang boleh hilang
cache kecil yang bisa dibuat ulang
file lock sementara
intermediate file yang lifecycle-nya satu proses
```

Tetapi jangan dipakai untuk:

```text
user uploaded file yang penting
business document
database file
audit log yang wajib dipertahankan
keystore runtime yang disuntik manual
migration state
```

---

## 4. External Mounts: Tiga Pilihan Utama

Docker menyediakan tiga tipe mount yang paling penting:

```text
1. volume
2. bind mount
3. tmpfs
```

### 4.1 Named Volume

Volume dikelola Docker.

Contoh:

```bash
docker volume create app-data

docker run \
  --mount type=volume,source=app-data,target=/data \
  my-service:1.0.0
```

Atau Compose:

```yaml
services:
  app:
    image: my-service:1.0.0
    volumes:
      - app-data:/data

volumes:
  app-data:
```

Karakteristik:

```text
managed by Docker
persist setelah container dihapus
lebih portable daripada bind mount
lokasi host tidak perlu diketahui aplikasi
bagus untuk data container-managed
```

Cocok untuk:

```text
local database data
broker state untuk local dev
persistent generated files
cache besar yang ingin dipertahankan
storage local single-host
```

### 4.2 Bind Mount

Bind mount menghubungkan path host ke path container.

Contoh:

```bash
docker run \
  --mount type=bind,source="$PWD/config",target=/config,readonly \
  my-service:1.0.0
```

Atau Compose:

```yaml
services:
  app:
    image: my-service:1.0.0
    volumes:
      - ./config:/config:ro
```

Karakteristik:

```text
bergantung pada path host
bergantung pada OS dan filesystem host
sangat berguna untuk development
lebih mudah terkena permission mismatch
bisa memberi container akses langsung ke file host
```

Cocok untuk:

```text
source code hot reload
config file lokal
certificate lokal
mount test fixture
export hasil debugging
```

Kurang cocok untuk:

```text
portable production deployment
state bisnis yang harus independent dari layout host
container yang harus jalan konsisten di banyak mesin
```

### 4.3 tmpfs Mount

tmpfs adalah mount memory-backed. Data tidak persisten di container layer maupun host disk.

Contoh:

```bash
docker run \
  --mount type=tmpfs,target=/tmp \
  my-service:1.0.0
```

Karakteristik:

```text
volatile
berada di memory host
hilang saat container stop
berguna untuk data sementara atau sensitif
mengurangi write ke disk
```

Cocok untuk:

```text
/tmp
scratch file sensitif
runtime token sementara
intermediate processing file
```

Harus hati-hati karena tmpfs tetap memakai memory host. Untuk aplikasi Java, ini berarti tmpfs dapat berkompetisi dengan heap dan native memory.

---

## 5. Decision Matrix

| Kebutuhan | Pilihan utama | Alasan |
|---|---|---|
| Persistensi data container-managed | Named volume | Lifecycle terpisah dari container dan dikelola Docker |
| Mount source code lokal untuk dev | Bind mount | Perubahan host langsung terlihat di container |
| Config lokal read-only | Bind mount read-only | Eksplisit dari host, mudah dilihat |
| Data sementara sensitif | tmpfs | Tidak ditulis ke image layer atau disk container |
| Log aplikasi production | stdout/stderr | Diambil logging driver/platform |
| Upload user production | Object storage / external storage | Jangan bergantung pada single container host |
| Database production | Managed DB / dedicated storage | Container app tidak boleh memegang state DB bisnis |
| Local DB development | Named volume | Bisa reset/persist sesuai kebutuhan |
| Heap dump debugging | Bind mount atau volume khusus | Perlu diekspor dan tidak memenuhi writable layer |
| Read-only runtime rootfs | read-only + tmpfs untuk writable path | Hardening security |

---

## 6. Mounting Over Existing Data

Ini jebakan klasik.

Misal image punya file:

```text
/app/config/default.yml
```

Lalu container dijalankan dengan mount:

```bash
docker run \
  --mount type=bind,source="$PWD/config",target=/app/config \
  my-service:1.0.0
```

Path `/app/config` dari image akan tertutup oleh mount. File `default.yml` yang ada di image tidak terhapus, tetapi tidak terlihat selama mount aktif.

Mental model:

```text
mount menutupi path target
bukan merge otomatis
bukan overlay semantic untuk user
```

Akibat umum:

```text
file yang ada di image tampak hilang
aplikasi gagal start karena default config tidak terlihat
folder target berubah ownership/permission
```

Praktik aman:

```text
jangan mount ke path yang berisi file penting dari image kecuali memang sengaja override
pisahkan /app untuk artifact dan /config untuk external config
pisahkan /app untuk read-only code dan /data untuk mutable state
```

Layout yang lebih sehat:

```text
/app/app.jar              immutable artifact
/config/application.yml   mounted config, optional read-only
/data                     volume for local persistent data
/tmp                      tmpfs or writable scratch
```

---

## 7. Permission, UID, dan GID

Saat aplikasi berjalan sebagai root, banyak permission issue tersembunyi. Saat kamu mengubah ke non-root user, issue itu muncul. Itu bagus: masalahnya jadi terlihat.

Contoh Dockerfile:

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
USER app:app
```

Jika container menulis ke `/data`, maka `/data` harus writable oleh UID/GID user tersebut.

Masalah umum:

```text
volume dibuat dengan owner root
bind mount dari host dimiliki user host yang UID-nya tidak cocok
container user tidak punya akses tulis
aplikasi butuh /tmp tapi root filesystem read-only
heap dump path tidak writable
```

Diagnosis:

```bash
docker inspect my-container

docker exec my-container id

docker exec my-container ls -ld /data /tmp /app
```

Jika image minimal tidak punya shell atau `ls`, gunakan debug container atau image debug khusus.

Compose contoh:

```yaml
services:
  app:
    image: my-service:1.0.0
    user: "10001:10001"
    volumes:
      - app-data:/data
```

Tetapi `user:` saja tidak otomatis memperbaiki ownership volume. Kamu tetap perlu strategi ownership.

Strategi yang umum:

1. Buat directory dan ownership saat build untuk path di image.
2. Untuk named volume, gunakan init container/persiapan host/chown one-time jika perlu.
3. Untuk bind mount, samakan UID/GID dengan host developer atau dokumentasikan setup.
4. Jangan memberi permission `777` sebagai default engineering habit.

---

## 8. Java Application Path Design

Java service yang baik punya pembagian path jelas.

Contoh layout:

```text
/app
  app.jar
/config
  application.yml
/data
  local persistent state if needed
/tmp
  temporary files
/dumps
  heap/thread/JFR dumps if enabled
```

### 8.1 `/app`

Harus dianggap immutable.

Isi:

```text
JAR
library runtime
startup script jika benar-benar perlu
```

Aplikasi tidak boleh menulis ke `/app`.

### 8.2 `/config`

Untuk config runtime yang diinject dari luar.

Biasanya read-only:

```yaml
volumes:
  - ./config:/config:ro
```

Spring Boot bisa diarahkan membaca lokasi external config, misalnya lewat env:

```yaml
environment:
  SPRING_CONFIG_ADDITIONAL_LOCATION: file:/config/
```

### 8.3 `/data`

Untuk state lokal yang memang dirancang persist.

Contoh local dev:

```yaml
volumes:
  - app-data:/data
```

Production app service biasanya tidak menyimpan business state penting di `/data`, kecuali desain deployment memang single-host dan sudah ada backup/restore eksplisit.

### 8.4 `/tmp`

Java sering menulis ke temporary directory:

```text
multipart upload temporary file
template rendering scratch
native library extraction
compression/decompression intermediate file
```

Kamu bisa pakai:

```yaml
tmpfs:
  - /tmp
```

Tetapi perhitungkan memory.

### 8.5 `/dumps`

Jika mengaktifkan heap dump:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Pastikan `/dumps` mounted dan cukup besar. Heap dump bisa sangat besar dan dapat memenuhi disk.

---

## 9. Logs: File atau stdout/stderr?

Untuk containerized service, default sehat adalah:

```text
application logs -> stdout/stderr
platform/driver -> collect/rotate/ship logs
```

Jangan default ke:

```text
/app/logs/app.log di writable layer
```

Masalah file log di writable layer:

```text
hilang saat container dihapus
sulit diambil oleh logging platform
bisa memenuhi disk host
rotasi sering lupa
mendorong pola SSH/exec ke container
```

Untuk Java:

```text
Logback/Log4j2 console appender sebagai default
structured JSON jika platform mendukung
file appender hanya untuk kebutuhan khusus dan path harus mounted
```

Jika harus menulis file log karena legacy/library:

```text
mount volume khusus
atur rotation
pastikan ownership
pastikan retention
```

---

## 10. Uploads, Reports, dan Business Documents

Aplikasi Java enterprise sering punya fitur:

```text
upload dokumen
generate PDF/report
export CSV
temporary attachment
case evidence file
audit attachment
```

Pertanyaan desain utama:

```text
Apakah file ini business state?
Apakah harus survive redeploy?
Apakah perlu audit trail?
Apakah perlu backup?
Apakah perlu encryption?
Apakah perlu lifecycle retention?
Apakah perlu diakses lintas instance?
```

Jika jawabannya ya, jangan bergantung pada container filesystem.

Opsi production yang lebih tepat:

```text
object storage
network storage yang dikelola
database BLOB hanya jika justified
external document management system
```

Volume lokal bisa diterima untuk:

```text
single-node internal tool
local dev
temporary report cache
controlled batch job dengan backup eksplisit
```

Tetapi untuk sistem regulatori, audit, enforcement lifecycle, atau case management, file bisnis harus punya durability, retention, auditability, dan access model yang jelas. Docker volume bukan model governance dokumen.

---

## 11. Read-Only Root Filesystem

Security hardening yang bagus adalah membuat root filesystem read-only.

Compose contoh:

```yaml
services:
  app:
    image: my-service:1.0.0
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - app-dumps:/dumps
```

Manfaat:

```text
mengurangi dampak exploit yang mencoba menulis ke filesystem
memaksa aplikasi eksplisit tentang writable path
mendeteksi assumption buruk sejak awal
```

Tantangan Java:

```text
/tmp harus writable
heap dump path harus writable jika enabled
JFR output path harus writable
embedded server/library mungkin menulis temp file
native library extraction mungkin perlu temp dir
```

Checklist sebelum mengaktifkan `read_only`:

```text
[ ] app tidak menulis ke /app
[ ] /tmp tersedia sebagai tmpfs
[ ] dump path mounted jika diperlukan
[ ] config mount read-only
[ ] log ke stdout/stderr
[ ] semua writable path disengaja dan terdokumentasi
```

---

## 12. Backup dan Restore Volume

Named volume bisa di-backup dengan menjalankan container sementara yang mount volume tersebut.

Contoh backup:

```bash
docker run --rm \
  -v app-data:/data:ro \
  -v "$PWD/backups":/backup \
  alpine \
  tar czf /backup/app-data.tar.gz -C /data .
```

Restore:

```bash
docker run --rm \
  -v app-data:/data \
  -v "$PWD/backups":/backup \
  alpine \
  sh -c 'cd /data && tar xzf /backup/app-data.tar.gz'
```

Prinsip backup:

```text
backup harus diuji restore-nya
backup harus konsisten secara aplikasi
jangan backup database aktif sembarangan tanpa mekanisme konsistensi
volume backup bukan pengganti database backup strategy
```

Untuk database container local dev, backup volume cukup untuk convenience. Untuk production database, gunakan mekanisme backup database yang benar.

---

## 13. Inspecting Volumes and Mounts

Command penting:

```bash
docker volume ls

docker volume inspect app-data

docker inspect my-container
```

Bagian `Mounts` pada `docker inspect` memberi fakta runtime:

```json
"Mounts": [
  {
    "Type": "volume",
    "Name": "app-data",
    "Source": "/var/lib/docker/volumes/app-data/_data",
    "Destination": "/data",
    "Mode": "",
    "RW": true,
    "Propagation": ""
  }
]
```

Yang perlu dicek:

```text
Type: volume/bind/tmpfs
Source: dari mana data berasal
Destination: path dalam container
RW: read-write atau read-only
Mode: opsi tambahan
```

Jangan menebak mount dari Dockerfile. Dockerfile tidak menentukan semua fakta runtime. Runtime command/Compose/orchestrator bisa mengubah mount.

---

## 14. Debugging Storage Failure

### 14.1 `permission denied`

Kemungkinan:

```text
container user tidak punya permission
volume dimiliki root
bind mount host UID/GID mismatch
read-only mount
read-only root filesystem
SELinux/AppArmor policy
```

Langkah:

```bash
docker inspect my-container

docker exec my-container id

docker exec my-container sh -c 'pwd; ls -ld /data /tmp /app /config'
```

### 14.2 File “hilang” setelah mount

Kemungkinan:

```text
mount menutupi directory yang sudah ada di image
bind mount source kosong
volume baru menutupi target path
```

Langkah:

```bash
docker inspect my-container --format '{{json .Mounts}}'
```

Cek apakah target mount sama dengan path file yang hilang.

### 14.3 `no space left on device`

Kemungkinan:

```text
writable layer membesar
log file membesar
volume penuh
Docker host disk penuh
image/cache terlalu banyak
heap dump memenuhi disk
```

Langkah:

```bash
docker system df

docker ps -s

docker volume ls
```

Hati-hati dengan cleanup agresif:

```bash
docker system prune --volumes
```

Command itu bisa menghapus volume yang tidak sedang dipakai container. Jangan jalankan tanpa memahami konsekuensinya.

### 14.4 Container restart dan data berubah

Kemungkinan:

```text
data ditulis ke writable layer lalu container direcreate
developer mengira volume aktif padahal tidak
Compose project name berbeda sehingga volume berbeda
mount target salah
```

Cek:

```bash
docker compose ps

docker volume ls

docker inspect <container>
```

Compose volume sering diberi prefix project name:

```text
myproject_app-data
```

Jika project name berubah, volume efektif bisa berubah.

---

## 15. Compose Patterns

### 15.1 Named Volume untuk DB Local

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Ini cocok untuk local dev yang ingin database survive `docker compose down`.

Reset total:

```bash
docker compose down -v
```

### 15.2 Bind Mount Config Read-Only

```yaml
services:
  app:
    image: my-service:dev
    volumes:
      - ./config:/config:ro
    environment:
      SPRING_CONFIG_ADDITIONAL_LOCATION: file:/config/
```

### 15.3 tmpfs untuk `/tmp`

```yaml
services:
  app:
    image: my-service:dev
    tmpfs:
      - /tmp
```

### 15.4 Read-Only Root + Explicit Writable Paths

```yaml
services:
  app:
    image: my-service:prod-like
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - app-dumps:/dumps

volumes:
  app-dumps:
```

---

## 16. Anti-Patterns

### Anti-pattern 1: Menyimpan business state di writable layer

```text
/app/uploads
```

tanpa volume/external storage.

Dampak:

```text
data hilang saat recreate
backup tidak jelas
scale-out mustahil tanpa shared state
```

### Anti-pattern 2: Mount seluruh project ke `/app` dan menimpa artifact image

```yaml
volumes:
  - .:/app
```

Dampak:

```text
artifact image tertutup
runtime berbeda dari image production
permission dan performance issue
```

Lebih baik pisahkan dev workflow dengan jelas.

### Anti-pattern 3: File log di container layer

```text
/app/logs/app.log
```

Dampak:

```text
log hilang, disk penuh, tidak masuk logging driver
```

### Anti-pattern 4: `chmod -R 777`

Ini bukan solusi desain permission. Ini menyembunyikan boundary yang salah.

### Anti-pattern 5: Volume anonim tanpa sadar

```bash
docker run -v /data my-service
```

Ini membuat anonymous volume yang sulit dilacak.

Gunakan named volume jika data penting:

```bash
docker run -v app-data:/data my-service
```

### Anti-pattern 6: Menganggap bind mount portable

Bind mount bergantung pada path host dan OS. Cocok untuk dev, kurang ideal untuk production portable.

---

## 17. Design Checklist untuk Java Service

Sebelum image dianggap production-ready:

```text
[ ] App artifact berada di path immutable, misalnya /app/app.jar
[ ] App tidak perlu menulis ke /app
[ ] Config runtime datang dari env/file mount, bukan rebuild image
[ ] Secret tidak disimpan di image
[ ] Logs keluar ke stdout/stderr
[ ] /tmp tersedia dan ukurannya dipahami
[ ] Jika read-only rootfs, semua writable path eksplisit
[ ] Upload/business document tidak bergantung pada container layer
[ ] Heap dump/JFR path jika enabled sudah mounted dan dibatasi
[ ] Container berjalan sebagai non-root user
[ ] Volume ownership sudah diuji
[ ] Compose reset strategy terdokumentasi
[ ] Backup/restore volume sudah diuji jika volume menyimpan data penting
```

---

## 18. Latihan Praktik

### Latihan 1 — Buktikan writable layer hilang

```bash
docker run --name fs-test alpine sh -c 'echo hello > /tmp/hello.txt && cat /tmp/hello.txt'
docker rm fs-test

docker run --name fs-test-2 alpine sh -c 'ls /tmp/hello.txt || true'
docker rm fs-test-2
```

Expected:

```text
file tidak ada di container baru
```

### Latihan 2 — Buktikan named volume persisten

```bash
docker volume create fs-demo

docker run --rm -v fs-demo:/data alpine sh -c 'echo hello > /data/hello.txt'

docker run --rm -v fs-demo:/data alpine cat /data/hello.txt
```

Expected:

```text
hello
```

### Latihan 3 — Buktikan mount menutupi file image

Buat Dockerfile:

```dockerfile
FROM alpine
RUN mkdir /config && echo default > /config/app.conf
CMD ["cat", "/config/app.conf"]
```

Build:

```bash
docker build -t mount-shadow-demo .
```

Run tanpa mount:

```bash
docker run --rm mount-shadow-demo
```

Run dengan bind mount kosong:

```bash
mkdir -p empty-config

docker run --rm \
  -v "$PWD/empty-config:/config" \
  mount-shadow-demo
```

Expected:

```text
cat: can't open '/config/app.conf': No such file or directory
```

Itu bukan karena file image terhapus. File tertutup oleh mount.

---

## 19. Ringkasan Mental Model

Docker filesystem bukan satu tempat tunggal. Ia adalah kombinasi dari:

```text
immutable image layers
+ mutable writable container layer
+ optional external mounts
```

Keputusan storage yang salah sering berubah menjadi incident:

```text
file hilang setelah redeploy
container tidak bisa start karena permission
disk host penuh
secret tertinggal di layer
log tidak terkumpul
upload hilang
heap dump gagal dibuat
production berbeda dari local dev
```

Untuk Java engineer, prinsip desainnya:

```text
/app      immutable artifact
/config   external runtime config, usually read-only
/data     explicit persistent state only when justified
/tmp      temporary writable scratch, possibly tmpfs
/dumps    explicit diagnostic output path
stdout    normal application logs
```

Jika path writable tidak bisa dijelaskan, kemungkinan desain container belum matang.

---

## 20. Hubungan ke Part Berikutnya

Filesystem dan volume menjawab pertanyaan:

```text
Di mana data berada?
Berapa lama data hidup?
Siapa yang memiliki data?
Apa yang terjadi saat container diganti?
```

Part berikutnya akan menjawab boundary lain:

```text
Bagaimana container berkomunikasi?
Apa arti localhost di dalam container?
Apa bedanya container port dan host port?
Bagaimana Docker DNS bekerja?
Kenapa service Java running tetapi tidak reachable?
```

Lanjut ke:

```text
learn-docker-mastery-for-java-engineers-part-012.md
```



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-012.md">Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing ➡️</a>
</div>
