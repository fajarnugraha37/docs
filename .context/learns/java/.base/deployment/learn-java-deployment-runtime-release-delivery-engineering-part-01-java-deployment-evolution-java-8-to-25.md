# learn-java-deployment-runtime-release-delivery-engineering

# Part 1 — Java Deployment Evolution: Java 8 to Java 25

> Seri: Java Deployment, Runtime, Release & Delivery Engineering  
> Part: 01 dari 35  
> Target pembaca: Java engineer yang sudah memahami Java/JVM/Jakarta/Spring/build tools dan ingin naik ke level deployment engineer / platform-aware backend engineer.  
> Fokus: konsekuensi deployment dari evolusi Java 8 sampai Java 25, bukan fitur bahasa per se.

---

## 0. Tujuan Bagian Ini

Setelah Part 0, kita sudah punya mental model bahwa deployment bukan sekadar `java -jar app.jar` atau `kubectl apply`. Deployment adalah proses memindahkan **intent** dari source code menjadi **sistem berjalan** yang:

1. menggunakan artifact yang tepat,
2. berjalan di runtime yang tepat,
3. memakai konfigurasi yang tepat,
4. menerima traffic pada waktu yang tepat,
5. menjaga state dan dependency tetap aman,
6. bisa diobservasi,
7. bisa di-rollback atau di-roll-forward,
8. dan bisa dijelaskan saat audit atau incident review.

Bagian ini menjawab pertanyaan:

> Jika aplikasi Java bisa berjalan di Java 8 sampai Java 25, apa yang berubah dari sisi deployment?

Kita tidak akan membahas fitur bahasa seperti lambda, records, pattern matching, sealed classes, atau string templates sebagai tutorial syntax. Yang kita bahas adalah efeknya terhadap:

- runtime selection,
- artifact shape,
- classpath/module path,
- JVM flags,
- container behavior,
- startup dan memory,
- observability,
- security posture,
- compatibility,
- migration strategy,
- dan operability production.

Java 8, 11, 17, 21, dan 25 adalah LTS penting dalam konteks modern enterprise. Oracle menyatakan Java SE 8, 11, 17, 21, dan 25 sebagai LTS releases, dengan rencana LTS berikutnya setiap dua tahun. OpenJDK mencatat JDK 21 GA pada 19 September 2023, sedangkan JDK 25 adalah release terbaru yang menjadi LTS dari banyak vendor dan sudah tersedia sebagai reference implementation Java SE 25.  

Referensi utama:

- OpenJDK JDK 21 project page: https://openjdk.org/projects/jdk/21/
- OpenJDK JDK 25 project page: https://openjdk.org/projects/jdk/25/
- Oracle Java SE Support Roadmap: https://www.oracle.com/java/technologies/java-se-support-roadmap.html
- Oracle JDK 25 release notes: https://www.oracle.com/java/technologies/javase/25-relnote-issues.html
- JEP 444 Virtual Threads: https://openjdk.org/jeps/444

---

## 1. Core Thesis: Java Version Is a Deployment Decision

Banyak engineer menganggap versi Java sebagai urusan developer atau build pipeline. Dalam production engineering, versi Java adalah keputusan deployment karena mempengaruhi:

```text
Java version
  -> supported JVM flags
  -> default GC behavior
  -> TLS and crypto defaults
  -> module/classpath behavior
  -> container awareness
  -> memory ergonomics
  -> startup behavior
  -> observability features
  -> available diagnostics tools
  -> library compatibility
  -> framework compatibility
  -> OS/container image compatibility
  -> support lifecycle and patch availability
```

Artinya, upgrade Java tidak boleh dipandang sebagai:

```text
Change sourceCompatibility from 8 to 21.
```

Itu hanya bagian kecil. Upgrade Java sebenarnya adalah perubahan pada **runtime contract**.

Runtime contract menjawab:

```text
Aplikasi ini diizinkan berjalan dengan JVM apa?
Dengan flags apa?
Dalam OS image apa?
Dengan memory model apa?
Dengan TLS provider apa?
Dengan classpath/module assumptions apa?
Dengan diagnostics apa?
Dengan rollback path apa?
```

Jika runtime contract tidak eksplisit, deployment akan mengandalkan kebetulan. Kebetulan ini bisa bertahan di DEV, SIT, dan UAT, tetapi biasanya pecah saat:

- traffic production lebih tinggi,
- container memory limit lebih kecil,
- base image berubah,
- JDK minor update mengganti default,
- library transitive dependency berubah,
- TLS endpoint eksternal memperketat cipher,
- framework upgrade menghapus compatibility layer,
- atau aplikasi di-restart setelah lama tidak pernah di-redeploy.

Top 1% engineer tidak hanya bertanya:

> “Kode ini compile di Java berapa?”

Mereka bertanya:

> “Runtime assumption apa yang berubah jika aplikasi ini dipindahkan dari Java 8 ke 17, 21, atau 25?”

---

## 2. Java 8 as the Legacy Deployment Baseline

Java 8 adalah baseline lama enterprise. Banyak aplikasi besar masih berjalan di Java 8 karena:

- framework lama masih kompatibel,
- app server lama certified pada Java 8,
- migration cost tinggi,
- library internal belum siap module-era,
- vendor product belum support Java baru,
- dan risiko regression dianggap terlalu besar.

Namun dari sisi deployment, Java 8 membawa beberapa karakteristik penting.

### 2.1 Classpath-Centric Deployment

Java 8 adalah dunia classpath.

Deployment Java 8 biasanya berbentuk:

```bash
java -cp "lib/*:app.jar" com.company.Main
```

atau:

```bash
java -jar app.jar
```

atau WAR/EAR ke app server.

Mental model-nya:

```text
Semua dependency diletakkan dalam satu classpath linear.
ClassLoader mencari class berdasarkan urutan tertentu.
Jika ada dua versi class yang sama, yang menang adalah yang ditemukan duluan.
```

Konsekuensi deployment:

1. Dependency conflict sering muncul sebagai runtime error, bukan compile error.
2. Duplicate JAR bisa diam-diam menghasilkan class yang salah.
3. App server shared libraries bisa bentrok dengan application libraries.
4. Perbedaan urutan classpath antar environment bisa menyebabkan bug yang tidak reproducible.
5. Fat JAR/shaded JAR menjadi populer untuk mengurangi dependency layout ambiguity.

Contoh failure:

```text
java.lang.NoSuchMethodError
```

Sering berarti:

```text
Kode dikompilasi terhadap versi library A,
tetapi saat runtime classloader memuat versi library B.
```

Ini bukan bug syntax. Ini bug deployment artifact/classpath.

### 2.2 PermGen Sudah Hilang, Tetapi Legacy Assumption Masih Ada

PermGen dihapus di Java 8 dan digantikan Metaspace. Banyak engineer mengingat ini sebagai perubahan JVM memory, tetapi deployment impact-nya besar.

Sebelum Java 8:

```bash
-XX:PermSize=256m
-XX:MaxPermSize=512m
```

Di Java 8, flags ini tidak relevan. Metaspace menggunakan native memory dan bisa tumbuh sampai batas tertentu.

Deployment impact:

- container memory harus memperhitungkan native memory,
- `-Xmx` bukan batas total memory process,
- classloading leak bisa memakan metaspace,
- hot deploy di app server bisa menyebabkan metaspace growth,
- OOM bisa terjadi di luar heap.

Contoh salah kaprah:

```text
Container limit = 1Gi
-Xmx = 1Gi
```

Ini berbahaya karena process juga butuh:

- metaspace,
- code cache,
- thread stacks,
- direct buffers,
- GC native structures,
- JIT/compiler memory,
- libc/native allocations,
- agent memory,
- mmap files,
- TLS/native crypto structures.

Jadi untuk Java 8 legacy di container, deployment harus lebih konservatif.

### 2.3 Container Awareness Java 8 Tidak Sama dengan Java Modern

Java 8 lahir sebelum container menjadi deployment default. Dukungan container awareness masuk bertahap lewat update tertentu dan vendor backport.

Masalah klasik:

```text
Host punya 64 CPU dan 128Gi RAM.
Container hanya diberi 2 CPU dan 2Gi RAM.
JVM lama melihat host, bukan cgroup limit.
```

Akibatnya:

- heap auto-sizing terlalu besar,
- GC thread terlalu banyak,
- ForkJoinPool/common pool terlalu besar,
- application thread pool salah sizing,
- CPU throttling parah,
- OOMKilled tanpa Java OOME yang jelas.

Karena itu pada Java 8 deployment, kita sering harus eksplisit:

```bash
-Xms512m
-Xmx1024m
-XX:ActiveProcessorCount=2
```

atau memakai percent-based flags jika tersedia di update/vendor tertentu.

Prinsipnya:

> Untuk Java 8, jangan asumsikan JVM memahami container seperti Java modern. Verifikasi dengan command dan log runtime.

Contoh verifikasi:

```bash
java -XX:+PrintFlagsFinal -version | grep -E "UseContainerSupport|MaxRAM|ActiveProcessorCount"
```

atau di Java modern:

```bash
java -XshowSettings:system -version
```

### 2.4 TLS, Crypto, and Legacy Endpoints

Java 8 deployment sering bertemu problem TLS:

- endpoint eksternal sudah menolak TLS lama,
- truststore CA bundle outdated,
- cipher suite berbeda antar update,
- internal service masih butuh protocol lama,
- FIPS/security provider berbeda antar environment.

Deployment impact:

```text
Upgrade minor JDK update bisa mengubah daftar disabled algorithms.
```

Akibatnya integrasi yang sebelumnya jalan bisa gagal dengan error seperti:

```text
javax.net.ssl.SSLHandshakeException
PKIX path building failed
Algorithm constraints check failed
No appropriate protocol
```

Top engineer akan memasukkan TLS/truststore sebagai deployment artifact/configuration concern, bukan hanya coding concern.

---

## 3. Java 9–10: Module System and the End of “Classpath Innocence”

Java 9 memperkenalkan Java Platform Module System. Banyak aplikasi enterprise tidak langsung memakai module path, tetapi dampaknya tetap besar.

### 3.1 JDK Internal APIs Mulai Tertutup

Sebelum Java 9, banyak library memakai internal API seperti:

```text
sun.misc.Unsafe
sun.reflect.*
com.sun.*
```

Setelah module system, akses internal semakin dibatasi secara bertahap.

Deployment impact:

- aplikasi bisa compile tetapi warning saat startup,
- reflective access warning muncul,
- pada versi lebih baru bisa berubah menjadi error,
- perlu `--add-opens` atau `--add-exports`,
- library lama harus diupgrade.

Contoh flag:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.lang.reflect=ALL-UNNAMED
--add-opens java.base/java.io=ALL-UNNAMED
```

Tetapi flags seperti ini harus dianggap sebagai **compatibility debt**.

Rule:

```text
Jika deployment butuh --add-opens untuk library tertentu,
catat alasan, owner, library version, dan migration path.
```

Jangan menyebar `--add-opens` secara cargo cult.

### 3.2 JRE Layout Berubah

Di era Java 8, banyak deployment mengandalkan konsep JRE terpisah. Setelah Java 9, layout JDK berubah dan tools modular seperti `jlink` muncul.

Dampak:

- script lama yang mencari `$JAVA_HOME/jre/bin/java` bisa rusak,
- Dockerfile lama bisa salah path,
- monitoring script yang asumsi layout lama bisa gagal,
- installer internal perlu update.

Contoh anti-pattern:

```bash
$JAVA_HOME/jre/bin/java -jar app.jar
```

Lebih baik:

```bash
$JAVA_HOME/bin/java -jar app.jar
```

### 3.3 jlink Mengubah Cara Berpikir Runtime

Sebelum module system, deployment biasanya membawa full JRE/JDK. Dengan `jlink`, kita bisa membuat custom runtime image berisi module yang dibutuhkan.

Mental model:

```text
Sebelum:
  OS image + full JDK/JRE + app artifact

Sesudah:
  OS image + custom runtime image + app artifact
```

Keuntungan:

- image lebih kecil,
- attack surface lebih rendah,
- startup bisa lebih predictable,
- runtime lebih reproducible.

Trade-off:

- butuh dependency/module analysis,
- tidak selalu cocok untuk aplikasi classpath legacy,
- reflective dependency bisa sulit dianalisis,
- custom runtime perlu patch lifecycle sendiri,
- operability tools mungkin hilang jika tidak dimasukkan.

Prinsip:

> jlink bagus jika organisasi mampu memperlakukan runtime image sebagai artifact yang dipatch, diverifikasi, dan diaudit.

---

## 4. Java 11: First Modern LTS After Java 8

Java 11 adalah lompatan besar enterprise dari Java 8.

Deployment impact utamanya:

1. Java EE/JAXB/CORBA modules tidak lagi bundled.
2. Module encapsulation makin terasa.
3. G1 menjadi default GC sejak Java 9, sehingga Java 11 deployment berbeda dari Java 8 Parallel GC baseline.
4. JDK/JRE distribution model berubah.
5. Banyak framework mulai menetapkan Java 11 sebagai baseline modern.

### 4.1 Removed Java EE Modules

Di Java 8, beberapa Java EE-related APIs tersedia di JDK. Di Java 11, banyak yang dihapus dari JDK.

Contoh yang sering berdampak:

```text
javax.xml.bind / JAXB
javax.activation
javax.annotation
JAX-WS
CORBA
```

Deployment impact:

- aplikasi compile di Java 8 tetapi gagal di Java 11,
- perlu menambahkan dependency eksplisit,
- WAR yang dulu mengandalkan JDK-provided classes bisa pecah,
- app server/library boundary harus diperjelas.

Contoh error:

```text
java.lang.NoClassDefFoundError: javax/xml/bind/JAXBException
```

Solusi bukan menurunkan Java secara otomatis, tetapi memperjelas dependency:

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
</dependency>
```

atau versi `javax` sesuai framework lama.

Lesson:

> Java 11 memaksa aplikasi berhenti menganggap JDK sebagai tempat dependency aplikasi.

### 4.2 G1 as Default Mindset

Java 8 default umumnya Parallel GC untuk server class machine. Java 11 dunia modern lebih dekat ke G1 default.

Deployment impact:

- latency profile berubah,
- memory overhead bisa berubah,
- GC log format berubah,
- tuning flags lama bisa tidak cocok,
- production dashboard perlu update.

Contoh flag lama:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
```

Di Java 9+ unified logging:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
```

Deployment implication:

```text
Upgrade Java berarti update log collection dan parsing rule.
```

Jika log shipper masih mencari format Java 8, observability GC bisa hilang setelah upgrade.

### 4.3 Java 11 as Migration Gate

Banyak organisasi memakai Java 11 sebagai stepping stone:

```text
Java 8 -> Java 11 -> Java 17/21/25
```

Kenapa tidak langsung?

Karena Java 11 menangkap banyak breaking assumption:

- removed bundled modules,
- module warnings,
- GC/logging changes,
- TLS changes,
- dependency compatibility.

Namun saat ini, untuk greenfield atau modernization, Java 17/21/25 biasanya lebih menarik daripada berhenti di 11, kecuali vendor/product support membatasi.

---

## 5. Java 17: Strong Encapsulation and Modern Enterprise Baseline

Java 17 adalah LTS yang sangat penting karena banyak framework modern menjadikannya baseline.

Contoh:

```text
Spring Boot 3.x requires Java 17 baseline.
Jakarta EE 10/11 ecosystem banyak bergerak ke Java 17/21.
Modern libraries increasingly drop Java 8/11 support.
```

Deployment impact utama Java 17:

1. Strong encapsulation makin nyata.
2. Security Manager deprecated for removal.
3. ZGC/Shenandoah maturity meningkat.
4. Banyak library lama mulai tidak kompatibel.
5. Container deployment lebih predictable dibanding Java 8.

### 5.1 Strong Encapsulation as Deployment Risk

Java 17 membuat akses ke internal JDK lebih ketat. Aplikasi/library yang mengandalkan reflective hacks bisa gagal.

Contoh error:

```text
java.lang.reflect.InaccessibleObjectException:
Unable to make field private final byte[] java.lang.String.value accessible:
module java.base does not "opens java.lang" to unnamed module
```

Deployment response yang buruk:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/java.lang.reflect=ALL-UNNAMED
--add-opens java.base/java.text=ALL-UNNAMED
--add-opens java.desktop/java.awt.font=ALL-UNNAMED
... terus tambah sampai jalan
```

Deployment response yang benar:

1. Identifikasi library penyebab.
2. Upgrade library jika versi baru sudah compatible.
3. Tambahkan `--add-opens` hanya jika temporary.
4. Catat sebagai technical debt.
5. Tambahkan test startup dengan Java target.
6. Pastikan container image dan local dev memakai major version yang sama.

### 5.2 Security Manager No Longer a Practical Isolation Boundary

Security Manager sudah deprecated for removal sejak Java 17. Banyak sistem lama memakai asumsi bahwa Security Manager bisa menjadi sandbox.

Deployment implication:

- jangan desain runtime isolation modern berdasarkan Security Manager,
- gunakan OS/container isolation,
- gunakan Kubernetes security context,
- gunakan network policy,
- gunakan least privilege IAM/service account,
- gunakan process/user/file-system restrictions.

Mental shift:

```text
Old thinking:
  Java runtime will sandbox untrusted code.

Modern thinking:
  Platform boundary handles isolation.
  Java app should not run untrusted code unless controlled by architecture.
```

### 5.3 Java 17 as Container Baseline

Java 17 lebih cocok untuk container production dibanding Java 8 karena:

- container memory awareness lebih matang,
- unified logging tersedia,
- JFR lebih usable,
- G1/ZGC lebih matang,
- framework modern mendukungnya,
- base image vendor lebih aktif.

Tetapi bukan berarti auto-safe.

Tetap harus mengatur:

```bash
-XX:MaxRAMPercentage=70
-XX:InitialRAMPercentage=50
-XX:MinRAMPercentage=50
-XX:+ExitOnOutOfMemoryError
-Xlog:gc*:stdout:time,uptime,level,tags
```

Angka harus disesuaikan, bukan dicopy.

---

## 6. Java 21: Virtual Threads and New Deployment Math

Java 21 adalah LTS besar karena virtual threads menjadi final melalui JEP 444. JEP 444 mendeskripsikan virtual threads sebagai lightweight threads yang membantu menulis, memelihara, dan mengobservasi aplikasi concurrent throughput tinggi.

Dari sisi deployment, virtual threads bukan sekadar fitur coding. Ia mengubah cara kita sizing dan membaca observability.

### 6.1 Virtual Threads Do Not Remove Capacity Planning

Kesalahan umum:

```text
Pakai virtual threads berarti bisa handle request tak terbatas.
```

Salah.

Virtual threads mengurangi biaya thread blocking, tetapi tidak menghilangkan bottleneck:

- CPU,
- database connection pool,
- downstream API limit,
- queue throughput,
- memory per request,
- lock contention,
- synchronized pinning,
- file descriptor limit,
- rate limit,
- transaction contention.

Deployment model berubah dari:

```text
platform threads are expensive, so thread pool limits concurrency
```

menjadi:

```text
virtual threads are cheap, so other resources must explicitly limit concurrency
```

Implikasi:

Jika dulu Tomcat max threads 200 secara tidak langsung membatasi pressure ke DB, setelah virtual threads bottleneck bisa pindah ke DB pool.

Contoh:

```text
Incoming requests: 5,000 concurrent
Virtual threads: okay
DB pool: 50 connections
Downstream API: 300 RPM
Result: massive waiting, timeout, queueing, cascading failure
```

Jadi deployment dengan virtual threads harus punya explicit bulkhead:

```text
HTTP concurrency limit
DB pool limit
Downstream client semaphore
Queue consumer concurrency
Rate limiter
Timeout budget
Circuit breaker
```

### 6.2 Thread Dumps Become Larger and Need Different Interpretation

Dengan virtual threads, jumlah thread bisa jauh lebih besar. Thread dump tradisional yang dipakai untuk platform threads mungkin menjadi sangat besar.

Deployment implication:

- observability tools harus support virtual thread awareness,
- runbook thread dump harus diupdate,
- jangan panik hanya karena thread count besar,
- fokus pada carrier thread, pinned virtual thread, lock contention, blocking points.

Yang dicari bukan hanya:

```text
Berapa jumlah thread?
```

Tetapi:

```text
Apa virtual threads sedang park/wait normal?
Apakah ada pinned sections?
Apakah carrier threads blocked?
Apakah bottleneck ada di DB/downstream?
```

### 6.3 Kubernetes Sizing with Virtual Threads

Virtual threads bisa membuat aplikasi tampak mampu menerima concurrency sangat tinggi. Tetapi pod resource tetap terbatas.

Deployment rule:

```text
Virtual threads increase concurrency expression,
not physical capacity.
```

Untuk Kubernetes:

- CPU request/limit tetap harus realistis,
- heap/non-heap tetap harus diukur,
- timeout harus lebih ketat,
- readiness harus mencerminkan dependency health,
- HPA metric tidak boleh hanya CPU jika bottleneck ada di DB/downstream,
- connection pool harus menjadi deliberate throttle.

Contoh deployment design:

```text
Pod:
  CPU request: 1
  CPU limit: 2
  Memory limit: 2Gi
  MaxRAMPercentage: 65
  DB pool: 30
  Downstream payment semaphore: 20
  HTTP request timeout: 3s
  Downstream timeout: 1s
  Queue consumer concurrency: 10
```

Di sini virtual threads boleh banyak, tetapi scarce resources tetap dikontrol.

---

## 7. Java 25: Latest LTS and Long-Horizon Deployment Baseline

JDK 25 adalah release penting karena menjadi LTS terbaru dari banyak vendor. OpenJDK menandai JDK 25 sebagai release yang banyak vendor jadikan LTS. Oracle juga menyebut JDK 25 sebagai latest LTS release di halaman download Java, sementara JDK 21 adalah previous LTS.

Deployment implication:

```text
Java 25 adalah kandidat baseline modern untuk sistem yang baru mulai modernization besar setelah 2025.
```

Namun enterprise adoption biasanya tidak langsung.

### 7.1 Why Java 25 Matters for Deployment

Java 25 penting karena:

1. LTS baru setelah Java 21.
2. Menjadi target patch/security lifecycle lebih panjang.
3. Mengandung akumulasi improvement dari Java 22–25.
4. Bisa menjadi baseline untuk platform baru yang ingin menghindari upgrade besar terlalu cepat.
5. Vendor images dan distributions mulai menyediakan channel JDK 25.

Tetapi:

```text
Latest LTS does not automatically mean best immediate production baseline.
```

Kriteria adoption:

- framework support,
- app server certification,
- APM/agent compatibility,
- container base image availability,
- security scanning support,
- internal platform support,
- production support contract,
- performance regression test,
- operational tooling compatibility.

### 7.2 Java 25 Upgrade Risk Surface

Saat pindah ke Java 25, risiko bukan hanya source compatibility.

Checklist risiko:

```text
Build:
  - Maven/Gradle version support?
  - compiler plugin support?
  - annotation processor support?
  - bytecode enhancement tools support?

Framework:
  - Spring/Jakarta/Hibernate support?
  - app server certified?
  - logging framework support?
  - test framework support?

Runtime:
  - JVM flags still valid?
  - GC behavior acceptable?
  - container memory detected correctly?
  - TLS/default crypto compatible?
  - timezone/locale behavior stable?

Instrumentation:
  - APM agent supports Java 25?
  - OpenTelemetry agent supports Java 25?
  - profiler supports Java 25?
  - bytecode instrumentation library supports Java 25?

Deployment:
  - base image available?
  - scanner recognizes JDK 25 CVEs?
  - SBOM tool identifies packages correctly?
  - production OS supports it?

Operations:
  - thread dump tools work?
  - heap dump analysis tool supports it?
  - JFR pipeline works?
  - alert rules still meaningful?
```

Top engineer memperlakukan Java 25 migration sebagai **runtime platform migration**, bukan version bump.

---

## 8. Release Cadence and LTS Strategy

Sejak Java 9, Java memakai cadence rilis yang lebih cepat. Enterprise tidak harus upgrade setiap 6 bulan, tetapi harus memahami implikasinya.

LTS yang relevan untuk series ini:

```text
Java 8   - legacy long-lived baseline
Java 11  - first post-8 LTS
Java 17  - strong modern enterprise baseline
Java 21  - virtual threads LTS, modern cloud-native baseline
Java 25  - latest LTS baseline after 2025
```

### 8.1 Three Deployment Strategies

#### Strategy A — Conservative LTS Lag

```text
Production baseline: Java 17
Evaluate: Java 21
Watch: Java 25
```

Cocok untuk:

- regulated enterprise,
- vendor-heavy systems,
- app server dependencies,
- low appetite for runtime risk.

Risiko:

- tertinggal dari library ecosystem,
- upgrade gap makin besar,
- delayed security/platform improvements.

#### Strategy B — Current Previous LTS

```text
Production baseline: Java 21
Evaluate: Java 25
```

Cocok untuk:

- modern Spring Boot services,
- Kubernetes platform,
- good CI/CD maturity,
- observability mature,
- automated regression testing.

Risiko:

- beberapa enterprise tools mungkin lambat support.

#### Strategy C — Latest LTS Early Adoption

```text
Production baseline: Java 25
```

Cocok untuk:

- new platform,
- internal services dengan strong test coverage,
- low legacy coupling,
- team punya runtime expertise,
- vendor support jelas.

Risiko:

- agent/tooling compatibility,
- app server certification,
- library corner cases,
- organizational unfamiliarity.

### 8.2 Rule of Thumb

Untuk sistem enterprise kompleks:

```text
Java 8  -> migrate away unless blocked by vendor/legacy constraints.
Java 11 -> acceptable but increasingly transitional.
Java 17 -> safe modern baseline.
Java 21 -> strong modern baseline for cloud-native Java.
Java 25 -> strategic new LTS baseline, adopt with compatibility validation.
```

---

## 9. Artifact Evolution Across Java Versions

Deployment Java berevolusi dari:

```text
classpath + external lib directory
```

menjadi banyak bentuk:

```text
thin JAR
fat JAR
shaded JAR
Spring Boot executable JAR
layered JAR
WAR
EAR
modular JAR
custom runtime image
native image
container image
```

### 9.1 Java 8 Artifact Mindset

Biasanya:

```text
app.jar + lib/*.jar
WAR/EAR
fat JAR
```

Kelebihan:

- familiar,
- banyak tools support,
- cocok untuk legacy app server.

Kelemahan:

- classpath conflict,
- dependency drift,
- runtime environment sering tidak reproducible,
- shared app server libraries sulit diaudit.

### 9.2 Java 11/17 Artifact Mindset

Mulai muncul:

```text
executable JAR + container image
layered JAR
jlink runtime image
```

Kelebihan:

- reproducibility lebih tinggi,
- container build lebih efisien,
- dependency lebih eksplisit,
- runtime bisa dikunci.

Kelemahan:

- build/deploy pipeline lebih kompleks,
- observability tools harus ikut image strategy,
- custom runtime harus dipatch.

### 9.3 Java 21/25 Artifact Mindset

Modern deployment makin mengarah ke:

```text
container image as deployable unit
SBOM attached
signed image
runtime base pinned
JDK version explicit
configuration externalized
observability agent explicit
rollout strategy automated
```

Dengan kata lain:

```text
Artifact bukan hanya JAR.
Artifact production adalah kombinasi JAR + runtime + OS image + metadata + config contract.
```

---

## 10. JVM Flags Evolution

JVM flags adalah deployment contract. Masalahnya, flags berubah antar versi.

### 10.1 Java 8 Style

Contoh:

```bash
-server
-Xms1024m
-Xmx1024m
-XX:+UseG1GC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
```

### 10.2 Java 11+ Style

```bash
-Xms1024m
-Xmx1024m
-XX:+UseG1GC
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=5,filesize=20M
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+ExitOnOutOfMemoryError
```

### 10.3 Container-Aware Style

```bash
-XX:InitialRAMPercentage=50
-XX:MaxRAMPercentage=70
-XX:MinRAMPercentage=50
-XX:ActiveProcessorCount=2
-Xlog:gc*:stdout:time,uptime,level,tags
-XX:+ExitOnOutOfMemoryError
```

### 10.4 Compatibility Principle

Every Java upgrade must include:

```bash
java -XX:+PrintFlagsFinal -version
```

and startup validation:

```text
Are all JVM flags recognized?
Are deprecated flags still accepted?
Are removed flags causing startup failure?
Are GC logs still emitted?
Are heap dumps still writable?
Does OOM terminate process as expected?
```

Anti-pattern:

```text
Copy JVM flags from a Java 8 VM to a Java 21 Kubernetes pod.
```

Why dangerous:

- some flags obsolete,
- logging syntax changed,
- memory model changed,
- container assumptions changed,
- GC defaults changed,
- output paths may be read-only,
- pod restart behavior differs from VM service restart.

---

## 11. Container Awareness Evolution

Container deployment forces JVM to answer:

```text
How many CPUs do I have?
How much memory can I use?
What happens if I exceed memory?
How many GC/compiler threads should I create?
How should heap be sized?
```

### 11.1 The Old Problem

Without container awareness:

```text
JVM sees host resources.
Container has smaller cgroup resources.
JVM oversizes itself.
Linux OOM killer kills process.
Application logs may not show Java OutOfMemoryError.
```

### 11.2 The Modern Problem

With container awareness:

```text
JVM sees container limit,
but application still needs non-heap memory and platform resources.
```

So modern Java does not eliminate sizing. It makes sizing more accurate.

### 11.3 The Real Formula

For Java container:

```text
Container memory limit
  >= Java heap
   + metaspace
   + code cache
   + thread stacks
   + direct memory
   + GC native overhead
   + JIT/compiler overhead
   + native libraries
   + agents
   + OS/process overhead
   + safety margin
```

If using virtual threads, thread stack overhead differs, but memory per request still matters.

### 11.4 Deployment Rule

Do not deploy with only:

```bash
-Xmx=container limit
```

Use either:

```bash
-Xmx explicit below limit
```

or:

```bash
-XX:MaxRAMPercentage=N
```

with measured headroom.

---

## 12. Observability Evolution

Deployment maturity depends heavily on observability.

### 12.1 Java 8 Observability

Common tools:

```text
jstack
jmap
jstat
GC logs old format
JMX
external APM agent
application logs
```

Weakness:

- GC log format old,
- JFR historically less available/open in old setups,
- container correlation less natural,
- thread dump mostly platform-thread assumption.

### 12.2 Java 11/17 Observability

Improvement:

```text
JFR more accessible
unified logging
better container info
modern JDK tooling
better GC logs
```

Deployment should include:

```bash
-Xlog:gc*,safepoint:file=/logs/jvm.log:time,uptime,level,tags:filecount=5,filesize=50M
-XX:StartFlightRecording=filename=/logs/startup.jfr,dumponexit=true,settings=profile
```

But be careful:

- JFR files can grow,
- writable path must exist,
- container may have read-only filesystem,
- production security may restrict dump extraction.

### 12.3 Java 21/25 Observability

With virtual threads, modern JFR, OpenTelemetry agents, and cloud-native deployment, observability should include:

```text
startup timeline
readiness transition time
GC pause and allocation rate
heap/non-heap/RSS
thread and virtual thread signals
DB pool metrics
HTTP server metrics
client timeout/error metrics
queue lag
pod restart reason
OOMKilled vs Java OOME
JFR capture strategy
```

Top engineer designs deployment so that incident answers are available without redeploying debug builds.

---

## 13. Security Posture Evolution

Java version impacts security posture.

### 13.1 JDK Patch Level Is Part of Security

Deployment must track not just major version:

```text
Java 17
```

but exact build:

```text
Eclipse Temurin 17.0.13+11
Amazon Corretto 21.0.x
Oracle JDK 25.0.x
```

Why?

- CVEs are patched in update releases,
- TLS algorithms change,
- root CA bundle changes,
- JIT/compiler bugs fixed,
- container bugs fixed,
- platform-specific issues fixed.

A deployment inventory must answer:

```text
Which services run which JDK build?
Which images include which JDK?
Which CVEs affect them?
Which patch version is approved?
Which services failed to roll patch?
```

### 13.2 Base Image Is Part of Java Security

A Java service deployed as container image contains:

```text
OS packages
JDK/JRE files
application artifact
CA certificates
native libraries
shell/tools
user/group config
```

So Java security is not only dependency scanning Maven/Gradle.

It includes:

- base image CVEs,
- JDK CVEs,
- OS package CVEs,
- openssl/libc/zlib CVEs,
- app dependencies,
- container runtime configuration.

### 13.3 Security Manager Decline Changes Isolation Strategy

As discussed, modern Java should rely on platform-level isolation rather than Security Manager.

Deployment hardening becomes central:

```text
non-root user
read-only filesystem
drop capabilities
network policy
secret mount isolation
no debug port exposed
no public actuator admin endpoints
JMX secured or disabled
container image minimized
SBOM and signing
```

---

## 14. Compatibility Matrix: The Artifact Is Not Enough

A serious Java deployment needs compatibility matrix.

Example:

| Layer | Compatibility Question |
|---|---|
| Source | Does code compile with target Java? |
| Bytecode | Is bytecode target supported by runtime? |
| Libraries | Are dependencies compatible with Java version? |
| Framework | Does Spring/Jakarta/Hibernate support this Java? |
| App Server | Is app server certified/supporting this Java? |
| Build Tool | Does Maven/Gradle/plugin support this Java? |
| Agent | Does APM/OpenTelemetry/profiler support this Java? |
| Container | Is base image available and patched? |
| OS | Does runtime support OS/glibc/architecture? |
| Security | Are TLS/crypto/truststore assumptions valid? |
| Ops | Do dumps/logs/metrics still work? |

### 14.1 Bytecode Version Failure

Classic error:

```text
UnsupportedClassVersionError
```

Meaning:

```text
Class compiled for newer Java than runtime supports.
```

Example:

```text
Compiled with Java 21, deployed on Java 17 runtime.
```

This is a release pipeline failure. Prevent with:

- build metadata,
- image labels,
- startup check,
- CI validation,
- artifact repository policy.

### 14.2 Runtime Too New Failure

Opposite case:

```text
Code compiled for Java 8,
run on Java 21,
but library uses illegal reflective access and fails.
```

So older bytecode does not guarantee compatibility with newer JVM.

Rule:

```text
Backward bytecode compatibility is not equivalent to full runtime compatibility.
```

---

## 15. Deployment Migration Patterns Across Java Versions

### 15.1 Big Bang Upgrade

```text
Java 8 -> Java 21 in one release
```

Pros:

- faster end state,
- less intermediate work,
- avoids spending time on transitional Java 11/17.

Cons:

- larger risk surface,
- harder RCA,
- many changes at once,
- rollback harder,
- library/framework upgrade coupled with runtime upgrade.

Suitable when:

- app is small,
- test coverage strong,
- team understands runtime,
- dependencies modern,
- deployment automation mature.

### 15.2 Stepwise LTS Upgrade

```text
Java 8 -> Java 11 -> Java 17 -> Java 21/25
```

Pros:

- isolates issues,
- easier debugging,
- safer for enterprise,
- each step validates assumptions.

Cons:

- longer timeline,
- multiple compatibility phases,
- may require repeated pipeline changes.

Suitable for:

- large monolith,
- app server deployments,
- regulatory systems,
- many integrations,
- low downtime tolerance.

### 15.3 Runtime-First Upgrade

```text
Keep source target old,
run on newer JVM first.
```

Example:

```text
Compile target Java 8,
run on Java 17.
```

Pros:

- separates runtime compatibility from source modernization,
- can reveal reflective access/TLS/GC/container issues first.

Cons:

- not always supported by framework/vendor,
- may still hit runtime incompatibility.

### 15.4 Service-by-Service Upgrade

For microservices:

```text
Upgrade low-risk services first.
Build matrix and baseline.
Then upgrade critical services.
```

Pros:

- learning compounds,
- platform improves gradually,
- rollback localized.

Cons:

- version sprawl,
- more inventory complexity,
- shared library compatibility matrix expands.

---

## 16. Java Version and Rollback Reality

Rollback is not always simple.

### 16.1 Artifact Rollback

Easy case:

```text
Deploy app version 1.2.4
Rollback to app version 1.2.3
Same Java runtime
Same DB schema
Same config contract
```

### 16.2 Runtime Rollback

Harder:

```text
App version same,
runtime changed Java 17 -> Java 21,
then rollback runtime.
```

Risks:

- artifact compiled with newer bytecode,
- config flags incompatible,
- generated files incompatible,
- framework behavior changed,
- DB migration already applied,
- metrics/log format changed.

### 16.3 Runtime + Schema Change

Very risky:

```text
Java 8 -> Java 21
Spring 2 -> Spring 3
javax -> jakarta
DB schema migration
container base image change
```

This is not one deployment. This is a platform migration.

Rule:

```text
The more layers changed in one release,
the less meaningful simple rollback becomes.
```

Better:

```text
1. deploy same app on new base image
2. deploy same app on new Java runtime
3. upgrade framework
4. migrate namespace/library
5. migrate DB schema with expand-contract
6. enable new feature behavior
```

---

## 17. Java 8–25 Deployment Decision Table

| Version | Deployment Character | Primary Risk | Best Use Today |
|---|---|---|---|
| Java 8 | Legacy baseline, classpath-centric | container ergonomics, old TLS, old libs, support lifecycle | existing legacy systems only if migration blocked |
| Java 11 | transitional modern LTS | removed Java EE modules, partial modernization | stepping stone or vendor-constrained systems |
| Java 17 | strong modern baseline | strong encapsulation breaks old reflection | stable enterprise modernization baseline |
| Java 21 | modern cloud-native LTS | virtual thread mis-sizing, new concurrency assumptions | strong default for new Java services |
| Java 25 | latest LTS baseline | tooling/framework/agent readiness | strategic baseline for new platforms after validation |

---

## 18. Practical Deployment Invariants Across All Versions

No matter Java version, these invariants hold.

### 18.1 Runtime Must Be Explicit

Bad:

```text
Use whatever Java is installed on server.
```

Good:

```text
Service X runs on Eclipse Temurin 21.0.x,
container image digest sha256:...,
with JVM flags versioned in deployment manifest.
```

### 18.2 Artifact Must Declare Compatibility

Artifact metadata should reveal:

```text
app version
git commit
build timestamp
build JDK
target bytecode version
framework version
dependency BOM version
container image digest
SBOM reference
```

### 18.3 Deployment Must Validate Runtime at Startup

Application startup should log:

```text
Java version
JVM vendor
JVM runtime name
OS
architecture
timezone
file encoding
active profiles
heap settings
available processors
container memory if available
app version/git commit
```

Example Java snippet:

```java
public final class RuntimeFingerprint {
    public static void log() {
        Runtime runtime = Runtime.getRuntime();
        System.out.println("java.version=" + System.getProperty("java.version"));
        System.out.println("java.vendor=" + System.getProperty("java.vendor"));
        System.out.println("java.vm.name=" + System.getProperty("java.vm.name"));
        System.out.println("os.name=" + System.getProperty("os.name"));
        System.out.println("os.arch=" + System.getProperty("os.arch"));
        System.out.println("file.encoding=" + System.getProperty("file.encoding"));
        System.out.println("user.timezone=" + System.getProperty("user.timezone"));
        System.out.println("availableProcessors=" + runtime.availableProcessors());
        System.out.println("maxMemory=" + runtime.maxMemory());
    }
}
```

Do not expose sensitive config. But runtime fingerprint helps incident investigation.

### 18.4 Deployment Must Own JVM Flags

Flags should live in versioned deployment config, not tribal knowledge.

Bad:

```text
Ops server has random JAVA_OPTS.
```

Good:

```yaml
env:
  - name: JAVA_TOOL_OPTIONS
    value: >-
      -XX:MaxRAMPercentage=70
      -XX:+ExitOnOutOfMemoryError
      -Xlog:gc*:stdout:time,uptime,level,tags
```

### 18.5 Deployment Must Separate Compatibility Flags from Tuning Flags

Example:

```text
Compatibility flags:
  --add-opens java.base/java.lang=ALL-UNNAMED

Tuning/operability flags:
  -XX:MaxRAMPercentage=70
  -Xlog:gc*:stdout:time,uptime,level,tags
```

Why separate?

- compatibility flags indicate library debt,
- tuning flags indicate runtime policy,
- operability flags indicate diagnostics policy.

---

## 19. Example: Java 8 to Java 21 Deployment Assessment

Imagine service:

```text
Name: case-management-api
Current: Java 8, Spring Boot 2.3, executable JAR
Runtime: VM with systemd
Target: Java 21, Spring Boot 3.x, Kubernetes
DB: Oracle
Integrations: OAuth, SMTP, S3-like storage, internal REST services
```

### 19.1 Wrong Assessment

```text
Just upgrade pom.xml and Dockerize.
```

### 19.2 Correct Assessment

#### Source and dependency

```text
- Can code compile on Java 21?
- Are annotation processors compatible?
- Are bytecode enhancement plugins compatible?
- Are javax packages migrated if framework requires jakarta?
```

#### Runtime

```text
- Which JDK vendor?
- Which exact version?
- Is Java 21 supported by framework/app server/APM agent?
- Which JVM flags are required?
- Any --add-opens needed?
```

#### Container

```text
- Base image Debian/Ubuntu/distroless?
- Non-root user?
- CA certificates included?
- Timezone behavior?
- Writable temp and dump paths?
```

#### Memory/CPU

```text
- Old VM memory was 8Gi.
- New pod limit maybe 2Gi.
- What is heap target?
- What is thread stack/native memory budget?
- Are DB pool and HTTP thread/concurrency limits adjusted?
```

#### Observability

```text
- Are GC logs emitted in new format?
- Does log shipper parse JSON/logback output?
- Does APM agent support Java 21?
- Are health/readiness endpoints correct?
```

#### Deployment strategy

```text
- Run Java 8 app in container first?
- Upgrade to Java 17/21 separately?
- Canary low traffic?
- Rollback compatible with DB schema?
```

#### Verification

```text
- Startup smoke test
- TLS handshake to all external dependencies
- DB connection and migration check
- OAuth/token flow
- SMTP test
- File upload/download test
- Long-running transaction test
- Load test with production-like concurrency
```

This is deployment engineering.

---

## 20. The Java Version Upgrade Pyramid

Think of Java upgrade as pyramid layers.

```text
                 Business behavior
              API contracts / workflows
          Framework and library compatibility
       Application runtime behavior and config
    JVM flags / GC / memory / TLS / observability
 OS / container image / architecture / filesystem
        Support lifecycle / patching / governance
```

Most teams only test top layers:

```text
Does API still return correct response?
```

Top deployment engineers test lower layers too:

```text
Does it start correctly in target container?
Does it handle SIGTERM?
Does it emit GC logs?
Does it respect memory limit?
Does truststore contain required CA?
Does APM work?
Does rollback work?
Does runtime build have known CVEs?
```

---

## 21. Common Anti-Patterns

### Anti-Pattern 1 — “It Runs Locally on Java 21”

Local Java version says little about production.

Missing questions:

```text
Same vendor?
Same patch version?
Same flags?
Same container limit?
Same base image?
Same CA truststore?
Same timezone?
Same CPU architecture?
Same APM agent?
```

### Anti-Pattern 2 — Treating `--add-opens` as Normal Tuning

`--add-opens` is usually a compatibility workaround. It should not be invisible.

### Anti-Pattern 3 — Copying Java 8 GC Flags to Java 21

This can break startup or create bad observability.

### Anti-Pattern 4 — Assuming Fat JAR Solves Dependency Problems

Fat JAR reduces deployment file count, but can hide shading conflicts and duplicate classes.

### Anti-Pattern 5 — Using Latest JDK Without Agent Validation

APM agents often use bytecode instrumentation. New Java versions can break or require updated agents.

### Anti-Pattern 6 — Setting `Xmx` Equal to Container Limit

This invites OOMKilled because heap is not RSS.

### Anti-Pattern 7 — Upgrading Runtime, Framework, Namespace, DB Schema, and Platform in One Release

This destroys diagnosability and rollback clarity.

---

## 22. Version-Specific Deployment Checklists

### 22.1 Java 8 Checklist

```text
[ ] Is JDK 8 still supported by chosen vendor?
[ ] Is the update level patched?
[ ] Does JVM correctly detect container cgroup limit?
[ ] Are heap and CPU explicitly configured?
[ ] Are TLS protocols/ciphers compatible with dependencies?
[ ] Is truststore updated?
[ ] Are GC logs collected in old format?
[ ] Are PermGen flags removed from scripts?
[ ] Are app server shared libs documented?
[ ] Is migration path to 17/21/25 documented?
```

### 22.2 Java 11 Checklist

```text
[ ] Are removed Java EE modules added as explicit dependencies?
[ ] Are old GC logging flags updated?
[ ] Are reflective access warnings reviewed?
[ ] Is G1 behavior understood?
[ ] Are build plugins Java 11 compatible?
[ ] Is framework support confirmed?
[ ] Are Docker images using correct JDK layout?
```

### 22.3 Java 17 Checklist

```text
[ ] Are InaccessibleObjectException risks tested?
[ ] Are --add-opens flags minimized and documented?
[ ] Is Security Manager dependency removed/replaced?
[ ] Is framework baseline compatible?
[ ] Is APM/agent support confirmed?
[ ] Is container memory sized with non-heap headroom?
[ ] Are JFR/GC logs enabled in supported format?
```

### 22.4 Java 21 Checklist

```text
[ ] Is virtual thread usage deliberate or framework-driven?
[ ] Are DB/downstream bulkheads explicit?
[ ] Are thread dump/runbook procedures updated?
[ ] Are HPA metrics appropriate beyond CPU?
[ ] Is APM/OpenTelemetry agent compatible?
[ ] Are structured concurrency/virtual thread preview/final assumptions clear?
[ ] Are readiness and graceful shutdown tested under load?
```

### 22.5 Java 25 Checklist

```text
[ ] Is chosen JDK 25 distribution production-supported?
[ ] Are framework/app server/tooling certified or tested?
[ ] Are build tools and plugins compatible?
[ ] Are APM/profiler/OpenTelemetry agents compatible?
[ ] Is base image patched and scanner-supported?
[ ] Are JVM flags validated against JDK 25?
[ ] Is rollback to Java 21/17 possible if needed?
[ ] Is performance baseline compared to previous LTS?
```

---

## 23. Recommended Enterprise Baseline Policy

For a serious Java organization, define policy like this:

```text
1. No production service may run on an undocumented JDK vendor/version.
2. Every service must declare supported runtime versions.
3. Every container image must pin base image by digest or controlled tag policy.
4. JDK patch updates must be tracked as security work, not optional maintenance.
5. Java major upgrades require compatibility matrix review.
6. Runtime flags must be versioned with deployment manifests.
7. Observability must be validated after Java major upgrade.
8. Rollback strategy must be explicitly stated.
9. --add-opens and similar compatibility flags require owner and expiry plan.
10. Java 8 services require migration exception if still production-critical.
```

This is how Java version management becomes platform governance.

---

## 24. Mental Model Summary

Java 8 to Java 25 is not a straight line of “newer is faster”. It is an evolution of runtime assumptions.

```text
Java 8:
  classpath world, legacy enterprise, container caution

Java 11:
  post-8 cleanup, removed bundled modules, modern transition

Java 17:
  strong encapsulation, modern baseline, framework reset point

Java 21:
  virtual threads, modern concurrency, cloud-native maturity

Java 25:
  latest LTS, strategic baseline, validate ecosystem readiness
```

The deployment engineer's job is not to memorize every JDK feature. The job is to understand what changes in the operational contract:

```text
Can it start?
Can it find classes?
Can it access required modules?
Can it fit memory?
Can it use CPU fairly?
Can it connect securely?
Can it emit diagnostics?
Can it be patched?
Can it be rolled back?
Can it be supported for years?
```

---

## 25. Practical Exercise

Take one real Java service and fill this matrix.

```text
Service name:
Current Java version:
Target Java version:
JDK vendor:
Current artifact type:
Target artifact type:
Current deployment platform:
Target deployment platform:
Framework version:
App server/container:
APM/agent:
JVM flags:
Heap/memory settings:
GC logging:
TLS/truststore dependencies:
Database migration coupling:
Rollback path:
Known compatibility flags:
Known unsupported libraries:
```

Then answer:

```text
1. What is the biggest runtime risk?
2. What is the biggest dependency risk?
3. What is the biggest observability risk?
4. What is the biggest rollback risk?
5. What can be split into a separate release?
```

If you can answer these clearly, you are already thinking beyond normal application developer level.

---

## 26. What Comes Next

Part 1 gives us the historical/runtime map from Java 8 to Java 25.

Next, we will go one level deeper into the shape of what we deploy:

> **Part 2 — Artifact Taxonomy: JAR, WAR, EAR, Thin JAR, Fat JAR, Layered JAR, Native Image**

There we will dissect deployment artifacts as operational objects, not just build outputs.

---

## Status Series

```text
[x] Part 0  - Deployment Mental Model
[x] Part 1  - Java Deployment Evolution: Java 8 to Java 25
[ ] Part 2  - Artifact Taxonomy
[ ] Part 3  - Runtime Selection Engineering
[ ] Part 4  - Java Runtime Layout
[ ] Part 5  - Configuration Deployment
[ ] Part 6  - JVM Options as Deployment Contract
[ ] Part 7  - Packaging for Linux Servers
[ ] Part 8  - Containerizing Java Applications Correctly
[ ] Part 9  - Dockerfile Patterns for Java 8–25
[ ] Part 10 - jlink, jdeps, jpackage, and Custom Runtime Images
[ ] Part 11 - Classpath, Module Path, ClassLoader, and Deployment Failure Modes
[ ] Part 12 - Application Server and Servlet Container Deployment
[ ] Part 13 - Spring Boot Deployment Deep Dive
[ ] Part 14 - Kubernetes Deployment for Java Applications
[ ] Part 15 - Kubernetes Probes, Graceful Shutdown, and Traffic Draining
[ ] Part 16 - Resource Sizing
[ ] Part 17 - Release Strategy
[ ] Part 18 - Database-Aware Deployment and Schema Migration
[ ] Part 19 - Stateful Java Deployment
[ ] Part 20 - Configuration, Secret Rotation, Certificate Rotation, and Truststore Deployment
[ ] Part 21 - Observability-Ready Deployment
[ ] Part 22 - Deployment Verification
[ ] Part 23 - CI/CD Pipeline for Java Deployment
[ ] Part 24 - Supply Chain Security for Java Deployment
[ ] Part 25 - Deployment Security Hardening
[ ] Part 26 - Multi-Environment Deployment
[ ] Part 27 - Multi-Service and Distributed Java Deployment
[ ] Part 28 - Legacy Java Deployment
[ ] Part 29 - Modern Java Deployment
[ ] Part 30 - Failure Modeling
[ ] Part 31 - Runbook Engineering
[ ] Part 32 - Enterprise Governance
[ ] Part 33 - Deployment Architecture Decision Records and Checklists
[ ] Part 34 - Capstone
[ ] Part 35 - Final Mastery Review
```

Series belum selesai.

