# Part 28 — Containers, Cloud Runtime, Kubernetes Volumes, and Ephemeral Files

> Series: `learn-java-io-file-filesystem-storage-engineering`  
> Scope: Java 8 hingga Java 25  
> Level: Advanced / production engineering  
> Fokus: memahami bagaimana Java file API berperilaku ketika aplikasi berjalan di container, Kubernetes, cloud runtime, mounted volume, read-only root filesystem, ConfigMap/Secret projection, PVC, dan ephemeral storage.

---

## 0. Tujuan Bagian Ini

Sampai Part 27, kita sudah membangun fondasi filesystem dari sudut Java dan OS:

- path semantics
- existence/type/identity
- creation/open/read/write
- atomic update
- copy/move/delete
- traversal
- symlink/hardlink
- path traversal security
- attributes/permission
- capacity
- watcher
- locking
- mmap
- structured binary file
- WAL/recovery
- checksum/hash
- MIME/charset/content detection
- ZIP filesystem
- pluggable `FileSystemProvider`
- legacy `java.io.File`
- cross-platform behavior Linux/Windows/macOS

Bagian ini membawa semua fondasi tersebut ke runtime modern:

```text
Java process
  -> container filesystem view
  -> writable layer / mounted volume
  -> Kubernetes pod lifecycle
  -> node filesystem pressure
  -> storage class / network volume / projected config
  -> operational recovery model
```

Masalahnya: banyak engineer memahami `Files.write(path, data)` tetapi tidak memahami **path itu sebenarnya berada di mana** ketika aplikasi berjalan di container.

Contoh:

```java
Files.writeString(Path.of("/tmp/report.json"), json);
```

Pertanyaan top engineer bukan hanya:

```text
Apakah kode ini berhasil?
```

Tetapi:

```text
/tmp itu berada di writable layer container atau mounted volume?
Akan hilang saat pod restart?
Akan dihitung sebagai ephemeral storage?
Apakah ada limit?
Apakah bisa memicu eviction?
Apakah aman untuk file besar?
Apakah node punya inode cukup?
Apakah path writable jika root filesystem read-only?
Apakah UID proses punya permission?
Apakah path di-share dengan container lain?
Apakah file watcher akan melihat update ConfigMap?
Apakah rename atomic di volume tersebut?
```

Inilah tujuan Part 28: membuat Anda tidak hanya bisa memakai Java file API, tetapi bisa **mendesain file workflow yang benar di container/cloud/Kubernetes**.

---

## 1. Mental Model Utama: Container Bukan VM Mini, Tetapi Filesystem View

Container sering dijelaskan sebagai “lightweight VM”. Untuk top engineer, model itu terlalu kasar.

Model yang lebih benar:

```text
container process
  sees a filesystem namespace
  with an image root filesystem
  plus writable layer
  plus mounted volumes
  plus kernel-provided pseudo filesystems
```

Di dalam container, Java melihat path seperti biasa:

```java
Path p = Path.of("/app/data/file.txt");
Files.writeString(p, "hello");
```

Tetapi `/app/data/file.txt` bisa berarti beberapa hal berbeda:

```text
1. path di image layer yang read-only
2. path di writable container layer
3. path di bind mount
4. path di Kubernetes emptyDir
5. path di Kubernetes PVC
6. path di ConfigMap/Secret projected volume
7. path di network filesystem
8. path di tmpfs memory-backed volume
```

Java API-nya sama, tetapi semantics-nya berbeda.

### 1.1 File API Portable, Storage Lifecycle Tidak Portable

`java.nio.file.Files` mendefinisikan operasi file portable, dan dokumentasi Java menegaskan bahwa operasi `Files` umumnya didelegasikan ke `FileSystemProvider` terkait. Di runtime container, provider Java umumnya tetap default provider OS (`file:`), tetapi OS view-nya sudah dibentuk oleh container runtime dan Kubernetes mount namespace.

Artinya:

```text
Java tetap melihat default filesystem,
tetapi filesystem tree yang terlihat sudah bukan host root secara langsung.
```

Jangan samakan:

```text
Path.of("/data")
```

dengan:

```text
host /data
```

Di container, `/data` adalah path dalam namespace container.

---

## 2. Layer Filesystem Container

Secara konseptual, container image menyediakan filesystem awal. Saat container berjalan, biasanya ada writable layer tipis di atas image layer.

Mental model:

```text
image layers        read-only
writable layer      per-container, temporary
mounted volumes     override/attach at specific paths
```

Diagram:

```text
Container filesystem view

/
├── app/                  from image layer
│   ├── app.jar
│   └── config-defaults/
├── tmp/                  usually writable container layer or tmpfs depending runtime
├── var/log/              writable layer unless mounted
├── data/                 maybe PVC / emptyDir / bind mount
└── etc/config/           maybe ConfigMap projected volume
```

### 2.1 Image Layer

Image layer berisi file yang dibangun saat image dibuat:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/app.jar /app/app.jar
COPY config/defaults /app/config-defaults
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

File di image layer secara konsep immutable. Container runtime bisa menyajikannya sebagai read-only base dan menulis perubahan ke writable layer.

Implikasi Java:

```java
Path appJar = Path.of("/app/app.jar");
System.out.println(Files.isReadable(appJar));
System.out.println(Files.isWritable(appJar));
```

Jangan desain aplikasi untuk mengubah file bawaan image:

```java
// buruk untuk containerized app
Files.writeString(Path.of("/app/application.properties"), "new config");
```

Karena:

- bisa gagal jika root filesystem dibuat read-only
- perubahan tidak bertahan setelah container diganti
- melanggar prinsip immutable image
- sulit diaudit
- sulit direproduce

### 2.2 Writable Layer

Writable layer adalah tempat perubahan file container ditulis ketika path tidak berada di mounted volume.

Contoh:

```java
Files.writeString(Path.of("/var/app/runtime-cache.json"), json);
```

Jika `/var/app` tidak dimount sebagai volume, file masuk writable layer container.

Konsekuensi:

```text
pod/container restart       mungkin hilang tergantung container recreation
pod reschedule ke node lain hilang
image redeploy              hilang
horizontal replica lain     tidak melihat file
storage limit               bisa memicu eviction
```

Writable layer cocok untuk:

- cache kecil
- scratch temporary file
- file intermediate yang boleh hilang
- local extraction sementara dengan limit

Writable layer tidak cocok untuk:

- dokumen bisnis
- audit trail
- upload final
- checkpoint penting
- queue durability
- report jangka panjang
- file yang harus dibaca replica lain

### 2.3 Mounted Volume

Volume menggantikan atau menambahkan storage pada path tertentu.

Contoh Kubernetes:

```yaml
volumeMounts:
  - name: data
    mountPath: /app/data
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: app-data-pvc
```

Di Java:

```java
Path data = Path.of("/app/data");
Files.writeString(data.resolve("result.json"), json);
```

Kode Java sama, tetapi semantics berubah drastis:

```text
/app/data sekarang bukan writable layer image,
tetapi mount volume dari Kubernetes.
```

---

## 3. Storage Lifecycle Matrix

Top engineer harus selalu mengklasifikasikan file berdasarkan lifecycle.

| Storage location | Bertahan setelah container restart? | Bertahan setelah pod reschedule? | Shared antar pod? | Cocok untuk |
|---|---:|---:|---:|---|
| image layer | ya, tetapi immutable | ya via image | semua container dengan image sama | binary/app default |
| writable layer | tidak reliable | tidak | tidak | scratch/cache kecil |
| `/tmp` default | tidak reliable | tidak | tidak | temporary file |
| `emptyDir` | selama pod hidup | tidak | antar container dalam pod | scratch pod-level |
| `emptyDir` memory | selama pod hidup | tidak | antar container dalam pod | small fast tmp |
| ConfigMap volume | dikelola Kubernetes, read-only | direcreate | bisa di semua pod | config non-secret |
| Secret volume | dikelola Kubernetes, read-only | direcreate | bisa di semua pod | secret material |
| PVC RWO | ya | ya | tergantung access mode | persistent app data |
| PVC RWX | ya | ya | bisa multiple pod | shared file use case |
| object storage mounted as FS | tergantung implementation | ya | biasanya ya | object-style data, caveat besar |

Prinsip:

```text
Sebelum memilih Java file pattern, tentukan storage lifecycle dulu.
```

Jangan mulai dari API:

```text
Pakai Files.write atau FileChannel?
```

Mulai dari invariants:

```text
File ini harus bertahan berapa lama?
Siapa yang membaca?
Boleh hilang?
Boleh duplikat?
Boleh partial?
Harus atomic terlihat ke consumer?
Harus recover setelah crash?
```

---

## 4. Java Path di Container: Absolute Path Tetap Relatif terhadap Namespace Container

Misalnya:

```java
Path p = Path.of("/etc/hosts");
```

Di mesin host, `/etc/hosts` adalah file host.

Di container, `/etc/hosts` adalah file yang container lihat. Bisa dibuat oleh runtime, bukan file host yang sama secara literal.

Jadi:

```text
absolute path != host path
absolute path = absolute dalam namespace filesystem proses
```

### 4.1 Hindari Hardcoded Host Path

Buruk:

```java
Path uploadRoot = Path.of("/home/ubuntu/uploads");
```

Masalah:

- path mungkin tidak ada di image
- user container mungkin tidak punya permission
- tidak portable ke Kubernetes
- sulit diubah tanpa rebuild image
- bisa gagal saat read-only root filesystem

Lebih baik:

```java
Path uploadRoot = Path.of(System.getenv().getOrDefault("APP_UPLOAD_DIR", "/app/data/uploads"));
```

Lalu deploy menentukan mount:

```yaml
env:
  - name: APP_UPLOAD_DIR
    value: /app/data/uploads
volumeMounts:
  - name: uploads
    mountPath: /app/data/uploads
```

### 4.2 Jangan Gunakan Current Working Directory sebagai Storage Contract

Buruk:

```java
Path p = Path.of("uploads/file.txt");
```

Masalah:

```text
relative path tergantung working directory process.
```

Dalam container, working directory bisa berubah karena:

- Dockerfile `WORKDIR`
- Kubernetes `workingDir`
- entrypoint script
- test runner
- service wrapper

Lebih baik:

```java
final class AppPaths {
    private final Path dataRoot;

    AppPaths(Path dataRoot) {
        this.dataRoot = dataRoot.toAbsolutePath().normalize();
    }

    Path uploads() {
        return dataRoot.resolve("uploads");
    }
}
```

Storage root adalah explicit configuration, bukan incidental current directory.

---

## 5. Read-Only Root Filesystem

Banyak security baseline menyarankan container root filesystem read-only.

Contoh Kubernetes:

```yaml
securityContext:
  readOnlyRootFilesystem: true
```

Ketika ini aktif, aplikasi tidak boleh menulis sembarang path di root filesystem image.

Kode berikut bisa gagal:

```java
Files.writeString(Path.of("/app/runtime.properties"), "x=y");
Files.createDirectories(Path.of("/app/tmp"));
Files.writeString(Path.of("/var/log/app.log"), "log");
```

Solusi: mount writable location eksplisit.

```yaml
securityContext:
  readOnlyRootFilesystem: true
volumeMounts:
  - name: tmp
    mountPath: /tmp
  - name: work
    mountPath: /app/work
volumes:
  - name: tmp
    emptyDir: {}
  - name: work
    emptyDir: {}
```

Di Java:

```java
Path workDir = Path.of(System.getenv("APP_WORK_DIR"));
Files.createDirectories(workDir);
```

### 5.1 Rule of Thumb

Dalam containerized app, anggap:

```text
/app       read-only application code
/tmp       scratch only, bounded
/app/work  explicit writable working directory
/app/data  explicit persistent or semi-persistent volume
```

Jangan campur:

```text
binary + runtime mutation + user data + cache
```

di satu directory.

---

## 6. `/tmp` di Container: Nyaman, Tetapi Bukan Kontrak Bisnis

Java sering menggunakan temp directory default dari system property:

```java
System.getProperty("java.io.tmpdir")
```

Biasanya `/tmp` di Linux container, tetapi jangan anggap selalu sama.

Contoh:

```java
Path tmp = Files.createTempFile("upload-", ".bin");
```

Ini memakai default temp directory.

Masalah:

- `/tmp` mungkin berada di writable layer
- bisa penuh
- bisa dihitung sebagai ephemeral storage
- bisa hilang saat pod restart
- bisa tidak writable jika root filesystem read-only dan `/tmp` tidak dimount
- bisa dipakai library lain
- bisa jadi tempat archive bomb extraction tak sengaja

### 6.1 Temp Directory Harus Explicit untuk Workload Besar

Untuk temporary file yang besar atau penting, gunakan temp directory khusus:

```java
Path scratchRoot = Path.of(System.getenv().getOrDefault("APP_SCRATCH_DIR", "/app/work/tmp"));
Files.createDirectories(scratchRoot);

Path temp = Files.createTempFile(scratchRoot, "import-", ".tmp");
```

Dengan ini, deployment bisa mengontrol:

```yaml
volumeMounts:
  - name: scratch
    mountPath: /app/work/tmp
volumes:
  - name: scratch
    emptyDir:
      sizeLimit: 2Gi
```

### 6.2 Bersihkan Temp File Secara Deterministik

Jangan mengandalkan `DELETE_ON_CLOSE` untuk semua kasus.

Lebih eksplisit:

```java
Path temp = Files.createTempFile(scratchRoot, "job-", ".tmp");
try {
    // write/process
} finally {
    try {
        Files.deleteIfExists(temp);
    } catch (IOException e) {
        // log and let periodic cleanup handle it
    }
}
```

Untuk service long-running, tambahkan periodic cleanup dengan batas aman:

```text
hapus hanya file dengan prefix milik aplikasi
hapus hanya di scratch root yang terkonfigurasi
hapus hanya file lebih tua dari threshold
jangan follow symlink
log jumlah dan ukuran yang dibersihkan
```

---

## 7. Kubernetes Volume Types dari Sudut Java File Workflow

Kubernetes menyediakan banyak tipe volume. Untuk seri ini, kita fokus pada yang paling relevan untuk Java file engineering.

### 7.1 `emptyDir`

`emptyDir` dibuat saat pod dijadwalkan ke node dan ada selama pod itu hidup.

Contoh:

```yaml
volumes:
  - name: work
    emptyDir: {}
volumeMounts:
  - name: work
    mountPath: /app/work
```

Use case:

- temporary extraction
- intermediate processing
- handoff antar container dalam pod
- cache pod-local
- staging sebelum upload ke object storage

Tidak cocok untuk:

- data final
- audit evidence
- durable queue
- file yang harus bertahan saat pod reschedule

Mental model:

```text
emptyDir = pod-scoped scratch space
```

Bukan:

```text
emptyDir = persistent disk
```

### 7.2 `emptyDir.medium: Memory`

Contoh:

```yaml
volumes:
  - name: memtmp
    emptyDir:
      medium: Memory
      sizeLimit: 256Mi
```

Use case:

- file kecil dan sensitif
- high-speed scratch kecil
- temporary credential material yang tidak ingin masuk disk

Risiko:

- memakai memory node/container accounting
- bisa memicu memory pressure
- tidak cocok untuk file besar
- size limit harus jelas

Java code tidak tahu secara langsung bahwa path memory-backed:

```java
Files.write(Path.of("/app/memtmp/token"), tokenBytes);
```

Karena itu konfigurasi path harus jelas di architecture document.

### 7.3 PersistentVolumeClaim / PVC

PVC adalah cara umum memberi persistent storage ke pod.

Contoh:

```yaml
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: app-data
volumeMounts:
  - name: data
    mountPath: /app/data
```

Use case:

- data yang harus bertahan setelah pod restart/reschedule
- file intake storage
- batch processing area
- generated reports yang tidak langsung diupload

Tetapi PVC bukan berarti semua operasi lokal aman.

Pertanyaan wajib:

```text
Access mode-nya apa? RWO, ROX, RWX?
Volume backend-nya apa? block disk, NFS, EFS, SMB?
Rename atomic?
Lock reliable?
Latency berapa?
Throughput berapa?
Metadata operation mahal?
Apakah multiple pod menulis path sama?
```

### 7.4 ConfigMap Volume

Kubernetes mendokumentasikan ConfigMap dapat digunakan sebagai file dalam read-only volume untuk dibaca aplikasi.

Contoh:

```yaml
volumes:
  - name: app-config
    configMap:
      name: app-config
volumeMounts:
  - name: app-config
    mountPath: /etc/app-config
    readOnly: true
```

Java:

```java
Path config = Path.of("/etc/app-config/application.yaml");
String text = Files.readString(config); // Java 11+
```

Java 8:

```java
String text = new String(Files.readAllBytes(config), StandardCharsets.UTF_8);
```

ConfigMap volume cocok untuk:

- configuration file
- feature flags sederhana
- template kecil
- non-secret metadata

Tidak cocok untuk:

- file yang aplikasi tulis
- high-frequency update config
- file besar
- secret material
- transactional state

### 7.5 Secret Volume

Secret volume mirip ConfigMap tetapi untuk secret data.

Prinsip:

```text
read-only input, not mutable state
```

Java harus memperlakukan secret sebagai:

- dibaca seperlunya
- tidak dilog
- tidak dicopy ke temp file sembarangan
- tidak dibuat world-readable
- tidak dikirim ke exception message

Contoh safe-ish read:

```java
Path secretPath = Path.of("/var/run/secrets/app/db-password");
char[] password = Files.readString(secretPath).trim().toCharArray();
```

Catatan: `String` untuk secret tidak ideal karena immutable dan sulit dihapus dari memory, tetapi banyak Java API masih memerlukan `String`. Untuk filesystem part ini, poin utamanya adalah jangan leak ke file/log.

### 7.6 Projected Volume

Projected volume menggabungkan beberapa sumber, misalnya ConfigMap, Secret, DownwardAPI, service account token.

Use case:

```text
/app/runtime-input/
  config.yaml       from ConfigMap
  token             from Secret/service account
  pod-name          from DownwardAPI
```

Untuk Java, ini tetap terlihat sebagai directory biasa. Tetapi lifecycle-nya dikelola kubelet, bukan aplikasi.

---

## 8. ConfigMap/Secret Projection: Read-Only dan Update Semantics

ConfigMap/Secret volume terlihat seperti file biasa, tetapi jangan perlakukan sebagai file biasa.

Karakter penting:

```text
- biasanya read-only dari sudut container
- dikelola kubelet
- update tidak identik dengan aplikasi menulis file
- implementasi Kubernetes memakai mekanisme projection/symlink-like layout
- update bisa terlihat sebagai perubahan inode/path target
```

Implikasi:

```java
Files.writeString(Path.of("/etc/app-config/application.yaml"), "x: y");
```

Harus dianggap salah. ConfigMap bukan tempat aplikasi menyimpan runtime config hasil edit.

### 8.1 Jangan Mount ConfigMap dengan `subPath` Jika Mengharapkan Update Otomatis

Kubernetes mendokumentasikan bahwa container yang memakai ConfigMap sebagai `subPath` volume mount tidak menerima update ConfigMap.

Konsekuensi desain:

```text
Jika aplikasi perlu hot reload file config dari ConfigMap,
jangan mount key individual via subPath.
Mount directory penuh dan baca file di dalamnya.
```

Buruk untuk hot reload:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/app/application.yaml
    subPath: application.yaml
```

Lebih tepat:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/app-config
```

Lalu Java:

```java
Path config = Path.of("/etc/app-config/application.yaml");
```

### 8.2 WatchService pada ConfigMap/Secret: Jangan Jadikan Truth

Dari Part 17:

```text
WatchService events are hints, not truth.
```

Untuk ConfigMap/Secret, ini lebih penting lagi karena update projection sering terjadi melalui perubahan directory/symlink internal.

Pola yang lebih benar:

```text
1. polling/reconciliation periodik
2. baca file config saat reload trigger
3. validasi seluruh config
4. apply hanya jika valid
5. simpan last-known-good config di memory
6. jangan crash hanya karena transient read gagal
```

Contoh sederhana:

```java
final class ReloadableConfig {
    private final Path configPath;
    private volatile AppConfig current;
    private volatile FileTime lastModified;

    ReloadableConfig(Path configPath, AppConfig initial) {
        this.configPath = configPath;
        this.current = initial;
    }

    void reconcile() {
        try {
            FileTime modified = Files.getLastModifiedTime(configPath);
            if (lastModified != null && modified.equals(lastModified)) {
                return;
            }

            String raw = Files.readString(configPath); // Java 11+
            AppConfig parsed = AppConfig.parse(raw);
            parsed.validate();

            current = parsed;
            lastModified = modified;
        } catch (Exception e) {
            // keep last-known-good config
            // log without leaking secrets
        }
    }
}
```

Java 8 replacement:

```java
String raw = new String(Files.readAllBytes(configPath), StandardCharsets.UTF_8);
```

### 8.3 Config Reload Should Be Atomic at Application Level

Even if Kubernetes projects config atomically, your application reload logic can still be non-atomic.

Buruk:

```java
this.timeout = parsed.timeout();
this.endpoint = parsed.endpoint();
this.retry = parsed.retry();
```

Jika thread lain membaca di tengah, config campur.

Lebih baik:

```java
this.current = parsedImmutableConfig;
```

Gunakan immutable config object.

---

## 9. Ephemeral Storage: Disk Space Adalah Resource Scheduling, Bukan Sekadar `df -h`

Kubernetes memiliki konsep local ephemeral storage. Ini mencakup, tergantung konfigurasi/runtime:

- writable layer container
- container logs
- `emptyDir` berbasis disk
- temporary files

Kubernetes mendokumentasikan bahwa jika usage writable layer/log container melewati storage limit, kubelet dapat menandai pod untuk eviction. Kubernetes juga memiliki node-pressure eviction untuk mencegah resource starvation ketika disk space atau inode node mencapai threshold.

Java implication:

```java
Files.write(tempFile, hugeBytes);
```

Bisa menyebabkan:

```text
1. IOException: No space left on device
2. pod eviction
3. node DiskPressure
4. aplikasi lain terdampak
5. container restart loop
```

### 9.1 Resource Request/Limit untuk Ephemeral Storage

Contoh:

```yaml
resources:
  requests:
    ephemeral-storage: "1Gi"
  limits:
    ephemeral-storage: "4Gi"
```

Ini bukan Java API, tetapi harus memengaruhi desain Java file workflow.

Jika limit 4Gi, jangan desain extraction ZIP 20Gi ke `/tmp`.

### 9.2 `FileStore.getUsableSpace()` Tetap Hanya Hint

Di Java:

```java
FileStore store = Files.getFileStore(Path.of("/app/work"));
long usable = store.getUsableSpace();
```

Ini berguna untuk guardrail, tetapi bukan guarantee.

Alasan:

- proses lain bisa menulis setelah check
- kubelet bisa menghitung usage berbeda
- quota bisa berlaku
- volume backend bisa punya limit sendiri
- file sparse/compression bisa memengaruhi real usage
- inode bisa habis walaupun byte masih ada

Gunakan sebagai **signal**, bukan correctness mechanism.

### 9.3 Guardrail untuk File-Producing Java Service

Buat policy eksplisit:

```text
max single upload size
max decompressed size
max temp directory usage
max files per job
max job concurrency
min free space threshold
cleanup threshold
reject-before-write threshold
```

Contoh:

```java
final class DiskGuard {
    private final Path root;
    private final long minFreeBytes;

    DiskGuard(Path root, long minFreeBytes) {
        this.root = root;
        this.minFreeBytes = minFreeBytes;
    }

    void ensureCanAccept(long estimatedBytes) throws IOException {
        FileStore store = Files.getFileStore(root);
        long usable = store.getUsableSpace();
        if (usable - estimatedBytes < minFreeBytes) {
            throw new InsufficientStorageException(
                    "Not enough local storage for estimated write");
        }
    }
}

final class InsufficientStorageException extends IOException {
    InsufficientStorageException(String message) {
        super(message);
    }
}
```

Tetap perlu handle write failure:

```java
try {
    guard.ensureCanAccept(estimatedBytes);
    writeFile();
} catch (FileSystemException e) {
    // classify ENOSPC-like failure where possible
}
```

---

## 10. Logs in Containers: Prefer stdout/stderr, Not File Logging by Default

Di VM tradisional, aplikasi sering menulis log ke file:

```text
/var/log/myapp/app.log
```

Di container/Kubernetes, default yang lebih baik:

```text
application -> stdout/stderr -> container runtime -> log collector
```

Masalah file logging di container:

- memenuhi writable layer
- memicu ephemeral storage eviction
- log hilang saat pod hilang jika tidak dikumpulkan
- rotasi log internal bentrok dengan log collector
- multi-replica log tersebar
- sidecar/agent perlu konfigurasi ekstra

Java logging config sebaiknya:

```text
console appender by default
structured JSON optional
correlation id
no secret
no large payload
```

File logging masih mungkin bila:

- ada legacy agent yang tail file
- sidecar log collector membaca volume bersama
- compliance butuh local write sementara

Namun harus explicit:

```yaml
volumeMounts:
  - name: app-logs
    mountPath: /app/logs
volumes:
  - name: app-logs
    emptyDir:
      sizeLimit: 1Gi
```

Dan Java/logging framework harus punya rotation limit.

---

## 11. Runtime Identity: UID/GID Lebih Penting daripada Username

Dalam container, proses sering berjalan sebagai UID tertentu, bukan user host biasa.

Kubernetes security context:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
```

Java melihat efeknya sebagai permission behavior.

Contoh failure:

```java
Files.createDirectories(Path.of("/app/data/uploads"));
```

Exception:

```text
java.nio.file.AccessDeniedException: /app/data/uploads
```

Kemungkinan penyebab:

- mount dimiliki root dan tidak writable oleh UID proses
- image directory permission salah
- PVC root ownership belum sesuai
- `fsGroup` tidak diterapkan ke volume type tertentu
- read-only root filesystem
- SecurityContext mismatch

### 11.1 Startup Permission Check

Daripada gagal di tengah request, validasi path saat startup.

```java
final class StorageStartupCheck {
    static void verifyWritableDirectory(Path dir) throws IOException {
        Files.createDirectories(dir);

        if (!Files.isDirectory(dir)) {
            throw new IOException("Not a directory: " + dir);
        }
        if (!Files.isReadable(dir)) {
            throw new IOException("Directory is not readable: " + dir);
        }
        if (!Files.isWritable(dir)) {
            throw new IOException("Directory is not writable: " + dir);
        }

        Path probe = Files.createTempFile(dir, ".write-probe-", ".tmp");
        try {
            Files.write(probe, new byte[] {1, 2, 3});
        } finally {
            Files.deleteIfExists(probe);
        }
    }
}
```

Kenapa perlu create temp probe?

Karena:

```text
Files.isWritable(dir) bisa menjadi hint,
tetapi actual create/write/delete adalah validasi paling nyata.
```

### 11.2 `fsGroupChangePolicy` dan Startup Time

Kubernetes mendokumentasikan bahwa default behavior dapat mengubah ownership/permission volume secara rekursif untuk mencocokkan `fsGroup`, dan untuk volume besar ini bisa memperlambat startup. `fsGroupChangePolicy` dapat mengontrol hal ini.

Konsekuensi bagi Java app:

```text
PVC besar + fsGroup recursive chown = pod startup lambat
```

Jika aplikasi punya banyak file, jangan langsung menyalahkan Java startup. Cek volume permission handling.

---

## 12. Multi-Container Pod dan Shared Volume

Dalam satu pod, beberapa container dapat mount volume yang sama.

Contoh:

```text
main Java container
  writes /app/work/outbox

sidecar container
  reads /app/work/outbox and uploads to object storage
```

Volume:

```yaml
volumes:
  - name: handoff
    emptyDir: {}
```

Java handoff harus memakai pola atomic:

```text
write to staging temp
fsync/close
atomic move to ready directory
sidecar only reads ready directory
```

Directory layout:

```text
/app/work/
  staging/
  ready/
  processing/
  done/
  error/
```

Producer Java:

```java
Path staging = root.resolve("staging");
Path ready = root.resolve("ready");
Files.createDirectories(staging);
Files.createDirectories(ready);

Path temp = Files.createTempFile(staging, "payload-", ".tmp");
Path finalPath = ready.resolve("payload-" + UUID.randomUUID() + ".json");

try {
    Files.writeString(temp, json);
    Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE);
} catch (IOException e) {
    Files.deleteIfExists(temp);
    throw e;
}
```

Sidecar/consumer:

```text
only scan ready/
claim by atomic move ready/file -> processing/file
process
move to done/ or error/
```

Jangan sidecar membaca file yang masih ditulis.

---

## 13. Multi-Pod Shared Volume: Jangan Asumsikan Local Filesystem Semantics

Jika PVC access mode memungkinkan banyak pod menulis, atau backend adalah RWX network filesystem, Anda masuk wilayah distributed filesystem.

Risiko:

```text
- FileChannel.lock tidak selalu cukup reliable
- WatchService tidak reliable lintas node
- metadata latency tinggi
- directory listing stale/mahal
- rename semantics bisa backend-dependent
- clock/timestamp bisa membingungkan
- concurrent writer race
```

Rule:

```text
Jika lebih dari satu pod menulis directory yang sama,
Anda sedang mendesain distributed coordination problem.
```

Solusi yang lebih kuat:

- database row status
- message queue
- object storage event + idempotency
- lease di database/Redis/ZooKeeper/etcd
- single-writer architecture
- partitioned directory per pod/shard

### 13.1 Partitioned Directory Pattern

Daripada semua pod menulis:

```text
/shared/outbox/
```

Lebih baik:

```text
/shared/outbox/pod-a/
/shared/outbox/pod-b/
/shared/outbox/pod-c/
```

Atau shard:

```text
/shared/outbox/00/
/shared/outbox/01/
...
/shared/outbox/ff/
```

Tetap butuh coordination untuk consumer, tetapi mengurangi contention.

---

## 14. File Watcher di Kubernetes

Dari Part 17, watcher bukan source of truth. Di Kubernetes, lebih rapuh lagi.

### 14.1 Watching Directory dalam Writable Volume

Untuk `emptyDir`/PVC lokal, watcher bisa berguna sebagai trigger:

```text
WatchService wakes processor quickly,
periodic scan guarantees no missed file.
```

Pattern:

```text
1. initial full scan
2. start WatchService
3. on event: schedule scan of affected directory
4. on OVERFLOW: full scan
5. periodic full scan anyway
```

### 14.2 Watching ConfigMap/Secret

Jangan bergantung pada event file individual.

Gunakan reconciliation polling:

```text
read current config file periodically
compare content hash/version
validate
atomic replace in-memory config
```

### 14.3 Watching Network Volume

Anggap unreliable.

Jika correctness penting, gunakan:

- queue
- database state
- manifest polling
- explicit API notification
- object storage eventing

---

## 15. Atomic Rename di Volume Kubernetes

Atomic update pattern dari Part 07 tetap relevan, tetapi syaratnya:

```text
temp file dan final file harus berada di filesystem/mount yang sama
backend harus mendukung atomic rename semantics
consumer harus membaca hanya path final
```

Dalam container:

```java
Path temp = Files.createTempFile(Path.of("/app/work/staging"), "x", ".tmp");
Path finalPath = Path.of("/app/data/ready/x.dat");
Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE);
```

Ini bisa gagal jika:

```text
/app/work/staging dan /app/data/ready berada di mount berbeda
```

Exception:

```text
AtomicMoveNotSupportedException
```

Better:

```text
/app/data/
  staging/
  ready/
```

Same mount:

```java
Path root = Path.of("/app/data");
Path temp = Files.createTempFile(root.resolve("staging"), "x", ".tmp");
Path finalPath = root.resolve("ready/x.dat");
Files.move(temp, finalPath, StandardCopyOption.ATOMIC_MOVE);
```

### 15.1 Mount Boundary Check

Java tidak selalu memberi direct “same mount” API yang portable, tetapi Anda bisa membandingkan `FileStore` sebagai hint:

```java
FileStore a = Files.getFileStore(temp.getParent());
FileStore b = Files.getFileStore(finalPath.getParent());

if (!a.equals(b)) {
    throw new IOException("Staging and ready directories are not on same FileStore");
}
```

Tetap handle `AtomicMoveNotSupportedException`.

---

## 16. Container Image Design untuk Java File Workflow

Filesystem correctness dimulai dari image.

### 16.1 Buat Directory yang Dibutuhkan Saat Build

Dockerfile:

```dockerfile
FROM eclipse-temurin:21-jre

RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 app

WORKDIR /app
COPY target/app.jar /app/app.jar

RUN mkdir -p /app/work /app/data \
    && chown -R 10001:10001 /app/work /app/data

USER 10001:10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Catatan:

- directory runtime dibuat eksplisit
- owner sesuai runtime UID
- aplikasi tidak perlu root
- mount Kubernetes bisa override `/app/data`

### 16.2 Jangan Simpan Runtime Data di Directory Source/Binary

Buruk:

```text
/app/app.jar
/app/uploads
/app/logs
/app/cache
```

Lebih rapi:

```text
/app/app.jar        binary
/app/config-defaults read-only default
/app/work           scratch
/app/data           mounted persistent/semi-persistent
```

### 16.3 Application Startup Should Print Storage Configuration

Saat startup, log non-sensitive:

```text
storage.dataRoot=/app/data
storage.workRoot=/app/work
storage.tmpRoot=/app/work/tmp
storage.configRoot=/etc/app-config
storage.dataRoot.fileStore=...
storage.dataRoot.usableSpace=...
storage.readOnlyRootFilesystem.assumed=true
```

Jangan log secret path content.

---

## 17. Kubernetes Manifest Pattern untuk Java File App

Contoh production-ish:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: file-worker
spec:
  replicas: 2
  selector:
    matchLabels:
      app: file-worker
  template:
    metadata:
      labels:
        app: file-worker
    spec:
      securityContext:
        fsGroup: 10001
        fsGroupChangePolicy: OnRootMismatch
      containers:
        - name: app
          image: example/file-worker:1.0.0
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            runAsGroup: 10001
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
          env:
            - name: APP_DATA_DIR
              value: /app/data
            - name: APP_WORK_DIR
              value: /app/work
            - name: APP_CONFIG_DIR
              value: /etc/app-config
          resources:
            requests:
              memory: 512Mi
              cpu: 250m
              ephemeral-storage: 1Gi
            limits:
              memory: 1Gi
              cpu: "1"
              ephemeral-storage: 4Gi
          volumeMounts:
            - name: work
              mountPath: /app/work
            - name: data
              mountPath: /app/data
            - name: config
              mountPath: /etc/app-config
              readOnly: true
      volumes:
        - name: work
          emptyDir:
            sizeLimit: 2Gi
        - name: data
          persistentVolumeClaim:
            claimName: file-worker-data
        - name: config
          configMap:
            name: file-worker-config
```

Key points:

```text
/app binary read-only
/app/work explicit scratch emptyDir
/app/data persistent PVC
/etc/app-config read-only ConfigMap
non-root UID
fsGroup for volume access
ephemeral-storage request/limit
```

---

## 18. Java Storage Configuration Object

Buat satu abstraction untuk path runtime.

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;

public final class RuntimeStoragePaths {
    private final Path dataRoot;
    private final Path workRoot;
    private final Path tmpRoot;
    private final Path configRoot;

    public RuntimeStoragePaths(Path dataRoot, Path workRoot, Path configRoot) {
        this.dataRoot = normalizeRoot(dataRoot);
        this.workRoot = normalizeRoot(workRoot);
        this.tmpRoot = this.workRoot.resolve("tmp").normalize();
        this.configRoot = normalizeRoot(configRoot);
    }

    public static RuntimeStoragePaths fromEnvironment() {
        return new RuntimeStoragePaths(
                Path.of(requireEnv("APP_DATA_DIR")),
                Path.of(requireEnv("APP_WORK_DIR")),
                Path.of(requireEnv("APP_CONFIG_DIR"))
        );
    }

    private static String requireEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return value;
    }

    private static Path normalizeRoot(Path path) {
        Objects.requireNonNull(path, "path");
        return path.toAbsolutePath().normalize();
    }

    public void initialize() throws IOException {
        ensureWritableDirectory(dataRoot);
        ensureWritableDirectory(workRoot);
        ensureWritableDirectory(tmpRoot);
        ensureReadableDirectory(configRoot);
    }

    private static void ensureWritableDirectory(Path dir) throws IOException {
        Files.createDirectories(dir);
        if (!Files.isDirectory(dir)) {
            throw new IOException("Not a directory: " + dir);
        }
        Path probe = Files.createTempFile(dir, ".probe-", ".tmp");
        try {
            Files.write(probe, new byte[] { 1 });
        } finally {
            Files.deleteIfExists(probe);
        }
    }

    private static void ensureReadableDirectory(Path dir) throws IOException {
        if (!Files.isDirectory(dir)) {
            throw new IOException("Not a directory: " + dir);
        }
        if (!Files.isReadable(dir)) {
            throw new IOException("Not readable: " + dir);
        }
    }

    public Path dataRoot() { return dataRoot; }
    public Path workRoot() { return workRoot; }
    public Path tmpRoot() { return tmpRoot; }
    public Path configRoot() { return configRoot; }
}
```

Java 8 adjustments:

- replace `Path.of(...)` with `Paths.get(...)`
- replace `String.isBlank()` with trim check

```java
Paths.get(requireEnv("APP_DATA_DIR"));
```

---

## 19. Storage Role Classification

Jangan satu root untuk semua file. Buat role jelas.

```text
configRoot   read-only input from ConfigMap/Secret/image
workRoot     temporary processing area
scratchRoot  disposable temp file area
dataRoot     persistent/semi-persistent business data
outboxRoot   handoff files ready for external transfer
archiveRoot  completed immutable files
errorRoot    quarantine for failed files
```

Contoh Java:

```java
public final class FileWorkflowLayout {
    private final Path dataRoot;
    private final Path workRoot;

    public FileWorkflowLayout(Path dataRoot, Path workRoot) {
        this.dataRoot = dataRoot;
        this.workRoot = workRoot;
    }

    public Path staging() { return workRoot.resolve("staging"); }
    public Path ready() { return dataRoot.resolve("ready"); }
    public Path processing() { return workRoot.resolve("processing"); }
    public Path done() { return dataRoot.resolve("done"); }
    public Path error() { return dataRoot.resolve("error"); }
}
```

Invariants:

```text
staging can be lost if job retry is possible
ready must be durable if it represents accepted work
done/error must be durable if audit/recovery needs them
configRoot must never be written by app
```

---

## 20. File Intake di Kubernetes: Correctness Model

Misalnya service menerima upload, memvalidasi, lalu menyimpan file untuk batch processor.

Naive:

```java
Files.copy(requestInputStream, Path.of("/tmp/upload.bin"));
Files.move(Path.of("/tmp/upload.bin"), Path.of("/app/data/inbox/upload.bin"));
```

Masalah:

- `/tmp` dan `/app/data` bisa beda filesystem
- move bisa copy-delete, bukan atomic
- filename collision
- file partial bisa terlihat consumer
- `/tmp` bisa penuh
- tidak ada hash/manifest
- tidak ada idempotency

Better layout:

```text
/app/data/intake/
  staging/
  ready/
  manifest/
  error/
```

Same PVC/mount.

Flow:

```text
1. generate storage id
2. create temp payload in staging
3. stream upload with max size limit
4. compute hash while writing
5. force/close if durability needed
6. write manifest temp in staging
7. atomic move payload to ready
8. atomic move manifest to manifest/ready
9. processor claims manifest, then payload
```

Simplified code:

```java
public final class IntakeWriter {
    private final Path root;

    public IntakeWriter(Path root) {
        this.root = root;
    }

    public void initialize() throws IOException {
        Files.createDirectories(root.resolve("staging"));
        Files.createDirectories(root.resolve("ready"));
        Files.createDirectories(root.resolve("manifests"));
    }

    public Path accept(String id, byte[] payload) throws IOException {
        Path staging = root.resolve("staging");
        Path ready = root.resolve("ready");

        Path temp = Files.createTempFile(staging, id + "-", ".tmp");
        Path finalPath = ready.resolve(id + ".bin");

        try {
            Files.write(temp, payload);
            Files.move(temp, finalPath,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            return finalPath;
        } catch (IOException e) {
            Files.deleteIfExists(temp);
            throw e;
        }
    }
}
```

Untuk file besar, jangan pakai byte array. Gunakan stream + digest.

---

## 21. Object Storage Boundary

Di cloud, sering ada godaan mount object storage seolah filesystem.

Contoh:

```text
S3/GCS/Azure Blob mounted as /app/data
```

Hati-hati: object storage bukan POSIX filesystem.

Kemungkinan mismatch:

```text
rename bukan atomic native operation
append tidak natural
directory hanya prefix illusion
file lock tidak meaningful
mtime/listing semantics berbeda
partial write semantics adapter-dependent
latency tinggi
metadata operation mahal
```

Dari sudut Java:

```java
Files.move(temp, target, ATOMIC_MOVE)
```

mungkin:

- gagal
- diemulasi copy+delete
- lambat sekali
- tidak punya crash semantics seperti local rename

Rule:

```text
Jika backend sebenarnya object storage,
gunakan object storage SDK/pattern,
jangan memaksa filesystem mental model untuk correctness-critical workflow.
```

Pattern lebih baik:

```text
write object with content hash
write metadata row in DB
publish event/message
processor reads object by key
idempotency by key/hash/version
```

Filesystem mount untuk object storage boleh untuk:

- ad-hoc read
- migration sederhana
- non-critical batch
- compatibility sementara

Bukan untuk:

- lock-based coordination
- WAL
- atomic rename transaction
- high-frequency metadata workload

---

## 22. Init Container untuk Preparing Filesystem

Kadang volume butuh inisialisasi sebelum app start.

Use case:

- membuat directory structure
- meng-copy default config ke writable volume
- migrasi layout
- permission bootstrap

Contoh:

```yaml
initContainers:
  - name: init-storage
    image: busybox:1.36
    command: ["sh", "-c"]
    args:
      - |
        mkdir -p /data/ready /data/error /data/archive
        chown -R 10001:10001 /data
    volumeMounts:
      - name: data
        mountPath: /data
```

Caveat:

```text
init container tidak boleh melakukan migration destructive tanpa idempotency.
```

Better:

```text
- create missing directories
- never delete unknown files
- write migration marker
- use versioned layout
- fail fast if incompatible layout
```

Java app tetap harus verify saat startup; jangan percaya init container 100%.

---

## 23. Sidecar Pattern untuk File Transfer

Pattern umum:

```text
Java app writes files to shared volume
sidecar uploads/syncs files elsewhere
```

Keuntungan:

- Java app fokus domain
- transfer retry dipisah
- tool khusus bisa dipakai
- credential terpisah

Risiko:

- sidecar membaca partial file
- duplicate upload
- unclear ownership
- cleanup race
- shared volume penuh

Correct handoff:

```text
producer:
  write staging/file.tmp
  move staging/file.tmp -> ready/file.dat

sidecar:
  claim ready/file.dat -> processing/file.dat
  upload
  move processing/file.dat -> done/file.dat
  or error/file.dat
```

Jangan gunakan:

```text
producer writes directly into ready/
sidecar tails directory and uploads immediately
```

---

## 24. Graceful Shutdown dan File Workflows

Kubernetes menghentikan pod dengan SIGTERM lalu grace period.

Java file workflow harus punya shutdown behavior.

Invariants:

```text
- jangan mulai job besar baru setelah shutdown requested
- job yang sedang write harus selesai atau abort cleanly
- temp file harus bisa direcover/cleanup pada startup berikutnya
- jangan meninggalkan final file partial
```

Pseudo:

```java
public final class ShutdownAwareProcessor {
    private volatile boolean stopping;

    public void requestStop() {
        stopping = true;
    }

    public void processLoop() throws IOException {
        while (!stopping) {
            Path file = claimNextFile();
            if (file == null) {
                sleepBriefly();
                continue;
            }
            processClaimed(file);
        }
    }
}
```

Startup recovery:

```text
- staging/*.tmp older than threshold -> delete or inspect
- processing/* from previous crashed pod -> requeue if ownership stale
- ready/* -> process
- done/* -> leave
- error/* -> leave/quarantine
```

Kubernetes can kill after grace period. So correctness must not rely on shutdown always completing.

---

## 25. Liveness/Readiness untuk File-Dependent App

Jangan liveness probe terlalu agresif karena disk sementara lambat.

### 25.1 Readiness

Readiness menjawab:

```text
Apakah pod siap menerima traffic?
```

Untuk file app, readiness boleh check:

- data root exists
- writable probe succeeds
- config readable and valid
- minimal free space threshold
- dependency storage reachable

### 25.2 Liveness

Liveness menjawab:

```text
Apakah proses perlu direstart?
```

Jangan restart pod hanya karena:

- disk low sementara
- downstream storage temporary unavailable
- one file corrupt

Karena restart bisa memperburuk:

```text
crash loop + repeated recovery + more temp files
```

Better:

```text
readiness false for unable to accept work
liveness true if process event loop healthy
alert on storage issue
```

---

## 26. Metrics untuk File Runtime di Kubernetes

Expose metrics:

```text
file_work_root_usable_bytes
file_data_root_usable_bytes
file_temp_files_count
file_temp_bytes
file_ready_count
file_processing_count
file_error_count
file_oldest_ready_age_seconds
file_write_failures_total{reason="access_denied|no_space|atomic_move_not_supported|..."}
file_cleanup_deleted_total
file_cleanup_failed_total
file_storage_probe_success
```

Contoh classification:

```java
static String classify(IOException e) {
    if (e instanceof java.nio.file.AccessDeniedException) return "access_denied";
    if (e instanceof java.nio.file.NoSuchFileException) return "no_such_file";
    if (e instanceof java.nio.file.FileAlreadyExistsException) return "already_exists";
    if (e instanceof java.nio.file.AtomicMoveNotSupportedException) return "atomic_move_not_supported";
    if (e instanceof java.nio.file.FileSystemException) {
        String reason = ((java.nio.file.FileSystemException) e).getReason();
        if (reason != null && reason.toLowerCase().contains("space")) return "no_space";
    }
    return "io_exception";
}
```

Caveat: reason string OS-dependent.

---

## 27. Common Failure Modes

### 27.1 `AccessDeniedException` on Mounted Volume

Symptoms:

```text
java.nio.file.AccessDeniedException: /app/data/...
```

Likely causes:

- UID/GID mismatch
- missing `fsGroup`
- volume mounted read-only
- root filesystem read-only and path not mounted
- directory ownership wrong in image
- SELinux/AppArmor constraints

Action:

```text
check pod securityContext
check volumeMount readOnly
exec id inside container
ls -l path
try write probe
check init container/chown strategy
```

### 27.2 `No space left on device`

Symptoms:

```text
FileSystemException: ... No space left on device
pod evicted
node DiskPressure
```

Likely causes:

- temp files not cleaned
- logs written to file/writable layer
- archive extraction too large
- too many concurrent jobs
- emptyDir size limit
- ephemeral-storage limit
- inode exhaustion

Action:

```text
check emptyDir usage
check container writable layer
check logs
check file count
check cleanup metrics
reduce concurrency
increase limit only after fixing growth pattern
```

### 27.3 Config Not Updating

Likely causes:

- mounted via `subPath`
- app caches config forever
- watcher watching wrong symlink/file
- kubelet sync delay
- invalid new config rejected but not logged clearly

Action:

```text
mount full config directory
use reconciliation polling
log config version/hash, not secret
keep last-known-good
```

### 27.4 Atomic Move Fails

Likely causes:

- temp and target are different mounts
- backend does not support atomic move
- target filesystem/provider limitation

Action:

```text
keep staging and ready under same mount
compare FileStore as startup hint
handle AtomicMoveNotSupportedException
fallback only if correctness permits
```

### 27.5 File Lost After Restart

Likely causes:

- written to writable layer
- written to emptyDir but pod recreated
- expected PVC but mount missing/misconfigured
- path typo caused write outside mount

Action:

```text
log resolved storage roots
verify mount with startup probe
write marker and inspect FileStore
use explicit env path
```

---

## 28. Anti-Patterns

### 28.1 Writing Business Data to `/tmp`

```java
Files.writeString(Path.of("/tmp/invoice-123.json"), json);
```

Wrong if invoice must survive restart.

### 28.2 Writing Runtime State into Image Directory

```java
Files.writeString(Path.of("/app/state.json"), state);
```

Breaks with read-only root filesystem and immutable image principle.

### 28.3 Relying on WatchService for ConfigMap Correctness

```text
watch event = config definitely changed and no event missed
```

False.

### 28.4 Multiple Pods Sharing Directory without Coordination

```text
replica-1 and replica-2 both scan /shared/inbox and process files
```

Race-prone unless claim/idempotency is designed.

### 28.5 Using File Lock on Network Volume as Distributed Lock

Maybe works in one environment, fails in another.

### 28.6 Assuming `Files.move(..., ATOMIC_MOVE)` Always Works

It can throw `AtomicMoveNotSupportedException`.

### 28.7 Ignoring Ephemeral Storage Limits

Memory/CPU limits are not enough. File-heavy apps need ephemeral storage design.

---

## 29. Production Design Recipes

### 29.1 Stateless Web App with File Upload to Object Storage

Recommended:

```text
request stream
  -> bounded temp file in /app/work/upload
  -> validate/hash
  -> upload to object storage
  -> persist DB metadata
  -> delete temp
```

Storage:

```text
/app/work = emptyDir size-limited
final data = object storage
metadata = database
```

Do not store final upload in container filesystem.

### 29.2 Batch Processor with PVC

```text
/app/data/inbox      PVC
/app/data/ready      PVC
/app/work/processing emptyDir or PVC depending recovery
/app/data/done       PVC
/app/data/error      PVC
```

If processing is expensive and must recover after pod death, claimed files should be on PVC with stale-claim recovery.

### 29.3 Config-Driven Service

```text
/etc/app-config      ConfigMap volume read-only
/var/run/secrets/app Secret volume read-only
/app/work            emptyDir
```

Reload:

```text
periodic reconcile
validate complete config
atomic replace in-memory immutable config
keep last-known-good
```

### 29.4 Secure Read-Only Runtime

```yaml
readOnlyRootFilesystem: true
runAsNonRoot: true
runAsUser: 10001
runAsGroup: 10001
fsGroup: 10001
```

Mount only required writable paths:

```text
/tmp or /app/work as emptyDir
/app/data as PVC if needed
```

---

## 30. Java 8 hingga Java 25 Compatibility Notes

### 30.1 `Path.of` vs `Paths.get`

Java 11+:

```java
Path p = Path.of("/app/data");
```

Java 8:

```java
Path p = Paths.get("/app/data");
```

Dalam library reusable, lebih baik terima `Path` dari caller daripada membangun dari string global.

### 30.2 `Files.readString` / `writeString`

Java 11+:

```java
String s = Files.readString(path, StandardCharsets.UTF_8);
Files.writeString(path, s, StandardCharsets.UTF_8);
```

Java 8:

```java
String s = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
Files.write(path, s.getBytes(StandardCharsets.UTF_8));
```

Untuk file besar, gunakan stream di semua versi.

### 30.3 Security Manager

Di era Java modern, jangan desain sandbox file security mengandalkan Java Security Manager. Di Java 24+, Security Manager sudah dinonaktifkan permanen. Boundary security untuk container harus datang dari:

- OS permissions
- container user
- Kubernetes securityContext
- read-only root filesystem
- mount boundary
- admission policy
- path validation aplikasi

---

## 31. Checklist Desain File di Container/Kubernetes

Gunakan checklist ini sebelum membuat file workflow.

### 31.1 Lifecycle

```text
[ ] File boleh hilang saat container restart?
[ ] File boleh hilang saat pod reschedule?
[ ] File harus survive redeploy?
[ ] File perlu dibaca pod lain?
[ ] File final atau intermediate?
```

### 31.2 Storage Location

```text
[ ] Path dikonfigurasi via env/config, bukan hardcoded?
[ ] Path berada di mount yang benar?
[ ] Staging dan final berada di FileStore sama jika butuh atomic move?
[ ] /tmp tidak dipakai untuk data bisnis?
[ ] ConfigMap/Secret diperlakukan read-only?
```

### 31.3 Permission

```text
[ ] Container berjalan non-root?
[ ] UID/GID jelas?
[ ] fsGroup diperlukan?
[ ] Startup write probe ada?
[ ] readOnlyRootFilesystem kompatibel?
```

### 31.4 Capacity

```text
[ ] ephemeral-storage request/limit diset?
[ ] emptyDir sizeLimit diset untuk scratch besar?
[ ] max upload/extract size ada?
[ ] cleanup deterministic ada?
[ ] metrics disk/free/temp count ada?
```

### 31.5 Correctness

```text
[ ] Producer tidak expose partial file?
[ ] Atomic move digunakan saat sesuai?
[ ] Fallback non-atomic tidak diam-diam merusak invariant?
[ ] Multi-pod writer punya coordination?
[ ] Watcher dipasangkan dengan reconciliation?
[ ] Startup recovery untuk staging/processing file ada?
```

### 31.6 Security

```text
[ ] Path traversal dicegah?
[ ] Symlink handling jelas?
[ ] Secret tidak dicopy/log?
[ ] Upload filename tidak dipercaya?
[ ] Archive extraction dibatasi?
[ ] File permission default aman?
```

---

## 32. Mini Case Study: Upload Service di Kubernetes

### 32.1 Requirement

```text
- menerima file upload maksimal 200 MiB
- scan dan validasi
- simpan final ke object storage
- metadata ke DB
- app berjalan di Kubernetes
- root filesystem read-only
- pod bisa autoscale
```

### 32.2 Wrong Design

```text
- simpan upload ke /tmp
- setelah validasi, simpan final di /app/uploads
- pakai local file list sebagai queue
- log ke /var/log/app.log
```

Failure:

```text
- /app/uploads hilang saat pod recreated
- autoscale pod tidak share uploads
- /tmp penuh memicu eviction
- read-only root filesystem gagal
- log memenuhi writable layer
```

### 32.3 Better Design

```text
/app/work/upload-temp  emptyDir sizeLimit 1Gi
final file             object storage
metadata               database
logs                   stdout
config                 ConfigMap read-only
secret                 Secret read-only
```

Flow:

```text
1. stream request to temp file with max byte counter
2. compute hash while streaming
3. validate content type/magic/size
4. upload object with key based on generated id/hash
5. write DB metadata transactionally
6. delete temp
7. cleanup old temp on startup
```

Kubernetes:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  readOnlyRootFilesystem: true
resources:
  requests:
    ephemeral-storage: 512Mi
  limits:
    ephemeral-storage: 2Gi
volumeMounts:
  - name: work
    mountPath: /app/work
volumes:
  - name: work
    emptyDir:
      sizeLimit: 1Gi
```

Java invariant:

```text
No accepted upload is considered durable until object storage upload and DB metadata commit succeed.
```

---

## 33. Mini Case Study: File-Based Integration Worker

### 33.1 Requirement

```text
- external system drops files into shared PVC
- Java worker processes files
- multiple replicas possible
- must not process same file twice without idempotency
- failed files must be quarantined
```

### 33.2 Dangerous Design

```java
try (Stream<Path> files = Files.list(inbox)) {
    files.forEach(this::process);
}
```

Issues:

- multiple pods can pick same file
- no claim
- no error quarantine
- no stale recovery
- no partial file protection
- listing is not transaction

### 33.3 Better Design

Directory layout:

```text
/integration/
  incoming/       external write landing
  ready/          complete files only
  processing/     claimed files
  done/           processed
  error/          failed/quarantine
```

Claim:

```java
Path claimed = processing.resolve(file.getFileName().toString() + "." + podName);
try {
    Files.move(file, claimed, StandardCopyOption.ATOMIC_MOVE);
} catch (NoSuchFileException | FileAlreadyExistsException e) {
    // another worker claimed it or collision
    return;
}
```

But if network filesystem semantics are weak, use DB lease:

```text
file_id, path, status, lease_owner, lease_until, hash
```

The file move becomes optimization, not correctness foundation.

---

## 34. What Top 1% Engineers Internalize

Top engineers do not ask:

```text
Can Java write this file?
```

They ask:

```text
What storage layer is this path on?
What is the lifecycle of this file?
What are the failure states?
Who else can observe this file?
Can partial state leak?
What happens on pod restart, node drain, eviction, reschedule?
Is this path writable under non-root + read-only root filesystem?
Is this storage local, network, projected, memory-backed, or object-like?
Is rename atomic here?
Is lock meaningful here?
Is watcher only a hint?
Is capacity bounded and observable?
Can we recover orphaned staging/processing files?
```

The difference between average and top-tier file engineering is not memorizing API names. It is knowing that:

```text
Path correctness is environment correctness.
File correctness is lifecycle correctness.
Filesystem correctness is failure-mode correctness.
Container correctness is mount/permission/capacity correctness.
Kubernetes correctness is restart/reschedule/eviction correctness.
```

---

## 35. Summary

Key takeaways:

1. Java `Path` inside a container is absolute only inside the container filesystem namespace, not the host.
2. Writable layer is temporary and should not hold business-critical data.
3. `/tmp` is scratch, not durable storage.
4. `emptyDir` is pod-lifetime storage, not persistent storage.
5. PVC can be persistent, but backend semantics still matter.
6. ConfigMap and Secret volumes are read-only application inputs, not app state.
7. ConfigMap/Secret hot reload should use reconciliation, not blind watcher trust.
8. Ephemeral storage can trigger Kubernetes eviction.
9. File-heavy apps need explicit storage request/limit, cleanup, and metrics.
10. Read-only root filesystem requires explicit writable mounts.
11. UID/GID/fsGroup are production filesystem concerns, not only DevOps concerns.
12. Atomic move only works if source/target are on compatible same filesystem semantics.
13. Multi-container handoff needs staging/ready/claim patterns.
14. Multi-pod shared file processing is a distributed coordination problem.
15. Object storage mounted as filesystem should not be treated as POSIX for correctness-critical workflows.

---

## 36. Latihan

### Latihan 1 — Storage Classification

Untuk setiap path berikut, klasifikasikan apakah cocok untuk config, scratch, persistent data, secret, atau log:

```text
/app/app.jar
/tmp/export.zip
/app/work/import.tmp
/app/data/archive/report-2026-06.csv
/etc/app-config/application.yaml
/var/run/secrets/app/db-password
/var/log/app.log
```

### Latihan 2 — Read-Only Root Filesystem

Ambil aplikasi Java yang saat ini menulis ke:

```text
/app/logs
/app/tmp
/app/uploads
```

Desain ulang manifest Kubernetes agar:

```text
- root filesystem read-only
- logs ke stdout
- tmp ke emptyDir size-limited
- uploads ke PVC atau object storage
```

### Latihan 3 — Atomic Handoff

Buat directory layout untuk producer/consumer dalam satu pod menggunakan shared `emptyDir`.

Requirement:

```text
- consumer tidak boleh membaca partial file
- file gagal dipindahkan ke error
- file sukses dipindahkan ke done
- startup cleanup staging file lebih tua dari 1 jam
```

### Latihan 4 — Config Reload

Implementasikan config reload yang:

```text
- membaca ConfigMap-mounted file
- menghitung hash content
- validate config
- replace immutable config object secara atomic
- keep last-known-good jika file invalid
```

### Latihan 5 — Eviction Risk Review

Untuk service yang mengekstrak ZIP upload ke `/tmp`, buat risk assessment:

```text
- max compressed size
- max decompressed size
- max file count
- emptyDir sizeLimit
- ephemeral-storage limit
- cleanup strategy
- metrics
```

---

## 37. Referensi

- Oracle Java SE 25 — `java.nio.file.Files`: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html
- Oracle Java SE 25 — `java.nio.file` package summary: https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/package-summary.html
- Oracle Java SE 8 — `FileSystem`: https://docs.oracle.com/javase/8/docs/api/java/nio/file/FileSystem.html
- Oracle Java SE 8 — `Paths`: https://docs.oracle.com/javase/8/docs/api/java/nio/file/Paths.html
- Kubernetes Documentation — ConfigMaps: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes Documentation — Projected Volumes: https://kubernetes.io/docs/concepts/storage/projected-volumes/
- Kubernetes Documentation — Local Ephemeral Storage: https://kubernetes.io/docs/concepts/storage/ephemeral-storage/
- Kubernetes Documentation — Resource Management for Pods and Containers: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Kubernetes Documentation — Node-pressure Eviction: https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/
- Kubernetes Documentation — Configure a Security Context for a Pod or Container: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/

---

## 38. Penutup

Part 28 menempatkan file/filesystem Java dalam runtime modern. Kesimpulan besarnya:

> **Di container dan Kubernetes, pertanyaan “file ini ditulis ke path apa?” tidak cukup. Yang penting adalah “path itu dimount dari mana, lifecycle-nya apa, siapa owner-nya, berapa limit-nya, bagaimana recovery-nya, dan apa yang terjadi saat pod mati?”**

Bagian berikutnya akan masuk ke **Network Filesystems and Distributed Files: NFS, SMB, EFS, Object Storage Boundary**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 27 — Cross-Platform Filesystem Behavior: Linux, Windows, macOS](./learn-java-io-file-filesystem-storage-engineering-part-27-cross-platform-filesystem-behavior.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 29 — Network Filesystems and Distributed Files: NFS, SMB, EFS, Object Storage Boundary](./learn-java-io-file-filesystem-storage-engineering-part-29-network-filesystems-distributed-files.md)

</div>