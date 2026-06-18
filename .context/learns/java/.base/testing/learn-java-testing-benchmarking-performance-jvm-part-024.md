# learn-java-testing-benchmarking-performance-jvm-part-024.md

# Part 024 — JVM Arguments & Configuration I: Java Launcher, Standard Flags, `-X`, `-XX`

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Bagian: `024 / 031`  
> Topik: JVM arguments, Java launcher, option taxonomy, environment variables, argument files, flag introspection, version compatibility, safe configuration baseline  
> Target Java: Java 8 sampai Java 25

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas model eksekusi JVM, memory, dan garbage collection. Sekarang kita masuk ke lapisan yang sering terlihat sederhana tetapi sebenarnya sangat berisiko: **JVM arguments dan konfigurasi runtime**.

Banyak engineer mengenal JVM option sebagai kumpulan flag seperti:

```bash
java -Xms512m -Xmx2g -XX:+UseG1GC -jar app.jar
```

Namun engineer yang kuat tidak memperlakukan JVM flag sebagai mantra. Ia memperlakukannya sebagai **kontrak runtime** antara aplikasi, JVM, OS, container, observability, deployment pipeline, dan operational runbook.

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Membaca command line Java secara struktural.
2. Membedakan application argument, system property, launcher option, module/classpath option, `-X` option, dan `-XX` option.
3. Mengetahui mana flag yang stabil, non-standard, diagnostic, experimental, deprecated, obsolete, atau removed.
4. Menghindari konfigurasi JVM yang salah versi antara Java 8, 11, 17, 21, dan 25.
5. Memahami environment variable seperti `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, `_JAVA_OPTIONS`, dan `JAVA_OPTS`.
6. Menggunakan argument file `@file` untuk konfigurasi panjang dan reproducible.
7. Menginspeksi konfigurasi runtime dengan `-XX:+PrintFlagsFinal`, `-XshowSettings`, dan `jcmd`.
8. Membuat baseline JVM configuration yang aman untuk development, CI, staging, dan production.
9. Menulis JVM configuration manifest yang bisa direview, diaudit, dan dibandingkan antar rilis.

Bagian ini belum masuk terlalu dalam ke container/Kubernetes profile. Itu akan menjadi fokus Part 025. Di sini kita membangun fondasi: **bagaimana JVM menerima, menginterpretasikan, dan melaporkan konfigurasi**.

---

## 1. Mental Model: JVM Configuration adalah Runtime Contract

JVM configuration bukan sekadar “performance tuning”. Ia adalah kontrak runtime yang mempengaruhi:

- memory budget,
- GC behavior,
- JIT behavior,
- diagnostics,
- logging,
- class loading,
- module access,
- security posture,
- startup behavior,
- container behavior,
- observability,
- failure mode,
- compatibility antar Java version.

Cara berpikir yang benar:

```text
JVM configuration
  = how the application process is launched
  + how the VM sizes itself
  + how the VM observes itself
  + how the VM reacts under pressure
  + how operators can diagnose failure
  + how deployment guarantees repeatability
```

Konfigurasi JVM yang buruk sering menyebabkan masalah yang tampak seperti bug aplikasi:

- API lambat karena heap terlalu kecil atau GC terlalu sering.
- Pod restart karena `-Xmx` terlalu dekat dengan container memory limit.
- Thread tidak bisa dibuat karena `-Xss` terlalu besar.
- JFR tidak aktif saat insiden karena tidak ada default recording.
- Log GC tidak tersedia karena flag Java 8 dipakai di Java 17 atau sebaliknya.
- Application crash saat upgrade karena flag lama sudah removed.
- CI lambat karena forked test JVM terlalu banyak memory.
- Production tidak reproducible karena flag tersebar di Dockerfile, Helm values, environment variable, script, dan service manager.

Top-tier engineer tidak bertanya:

> “Flag apa yang paling cepat?”

Ia bertanya:

> “Runtime contract apa yang ingin kita jamin, bagaimana mengukurnya, dan konfigurasi apa yang minimal untuk mendukungnya?”

---

## 2. Bentuk Dasar Java Command

Bentuk paling sederhana:

```bash
java [launcher-options] <main-class> [application-args]
```

atau:

```bash
java [launcher-options] -jar app.jar [application-args]
```

atau untuk module:

```bash
java [launcher-options] --module-path mods -m module.name/package.Main [application-args]
```

atau source-file mode Java modern:

```bash
java Hello.java [application-args]
```

Secara konseptual:

```text
java
  [options consumed by launcher/JVM]
  [class/module/jar/source target]
  [arguments passed to application's main(String[] args)]
```

Contoh:

```bash
java \
  -Xms512m \
  -Xmx2g \
  -Dspring.profiles.active=prod \
  -Duser.timezone=UTC \
  -XX:+UseG1GC \
  -Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m \
  -jar aceas-case-service.jar \
  --server.port=8080 \
  --app.worker.enabled=true
```

Yang dikonsumsi JVM/launcher:

```text
-Xms512m
-Xmx2g
-Dspring.profiles.active=prod
-Duser.timezone=UTC
-XX:+UseG1GC
-Xlog:gc*:file=...
-jar aceas-case-service.jar
```

Yang diterima aplikasi sebagai application arguments:

```text
--server.port=8080
--app.worker.enabled=true
```

Perbedaan ini penting. `-Dserver.port=8080` dan `--server.port=8080` sama-sama mungkin dibaca Spring Boot, tetapi jalurnya berbeda:

```text
-Dserver.port=8080
  -> JVM system property
  -> visible via System.getProperty("server.port")

--server.port=8080
  -> application argument
  -> visible via main(String[] args)
  -> framework may parse it as config property
```

Dalam sistem enterprise, kebingungan antara JVM option dan application option sering membuat konfigurasi tidak konsisten antar environment.

---

## 3. Taxonomy JVM/Java Options

Kita butuh taxonomy karena tidak semua option punya stabilitas, risiko, dan lifecycle yang sama.

Secara praktis, option bisa dikelompokkan menjadi:

```text
1. Standard launcher options
2. Classpath/module options
3. System properties
4. Application arguments
5. Extra/non-standard -X options
6. Advanced -XX options
7. Diagnostic options
8. Experimental options
9. Deprecated/obsolete/removed options
10. Environment-injected options
11. Argument-file options
```

Mari kita bedah satu per satu.

---

## 4. Standard Launcher Options

Standard launcher options adalah opsi umum yang relatif stabil dan didokumentasikan oleh Java launcher.

Contoh umum:

```bash
java -version
java --version
java --help
java --show-version
java -jar app.jar
java -cp "lib/*:classes" com.example.Main
java --class-path "lib/*:classes" com.example.Main
java --module-path mods -m com.example.app/com.example.Main
```

### 4.1 `-version` / `--version`

Digunakan untuk memastikan runtime Java yang benar.

```bash
java -version
java --version
```

Dalam CI/CD, jangan hanya berasumsi image memakai versi Java yang benar. Validasi explicit:

```bash
java -version
```

Contoh output modern:

```text
java 25 2025-09-16
Java(TM) SE Runtime Environment ...
Java HotSpot(TM) 64-Bit Server VM ...
```

Checklist:

```text
[ ] Runtime major version sesuai target?
[ ] Vendor/distribution sesuai policy?
[ ] Architecture sesuai? x64/aarch64?
[ ] JVM implementation HotSpot/OpenJ9/GraalVM sesuai expectation?
```

### 4.2 `-jar`

```bash
java -jar app.jar
```

Saat memakai `-jar`, main class dibaca dari manifest `Main-Class`. Satu hal penting: classpath dari `-cp` biasanya tidak dipakai seperti yang diharapkan bila bersamaan dengan `-jar`. Untuk executable Spring Boot fat jar, dependency sudah dikemas oleh launcher internal Spring Boot.

Anti-pattern:

```bash
java -cp "lib/*" -jar app.jar
```

Dalam banyak kasus, ini menunjukkan kebingungan. Tentukan strategi packaging:

```text
Executable fat jar:
  java -jar app.jar

Thin jar + external libs:
  java -cp "app.jar:lib/*" com.example.Main

Module:
  java --module-path mods -m module.name/com.example.Main
```

### 4.3 `-cp` / `--class-path`

```bash
java -cp "target/classes:target/dependency/*" com.example.Main
```

Classpath adalah daftar lokasi class/resource. Urutan classpath bisa mempengaruhi dependency resolution.

Risiko:

- duplicate classes,
- dependency shadowing,
- versi library berbeda antar environment,
- classpath terlalu panjang,
- wildcard expansion berbeda antar shell/platform,
- Windows path separator `;` vs Unix `:`.

Contoh Unix:

```bash
java -cp "classes:lib/*" com.example.Main
```

Contoh Windows:

```powershell
java -cp "classes;lib/*" com.example.Main
```

Top-tier habit:

```text
Classpath harus reproducible dan berasal dari build artifact, bukan dirangkai manual di production.
```

### 4.4 Module Options

Mulai Java 9, module system memperkenalkan opsi seperti:

```bash
--module-path
--module
-m
--add-modules
--add-exports
--add-opens
--add-reads
--patch-module
```

Contoh:

```bash
java --module-path mods -m com.example.app/com.example.Main
```

Untuk banyak aplikasi enterprise Spring/Jakarta, classpath masih dominan. Namun module-related flags sering muncul untuk mengatasi reflective access.

Contoh:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
```

Makna:

```text
Buka package internal module tertentu untuk reflection oleh classpath unnamed module.
```

Ini sering dipakai saat framework/library lama butuh akses reflective ke JDK internals. Tetapi ini harus diperlakukan sebagai **technical debt**, bukan konfigurasi permanen tanpa owner.

Checklist untuk `--add-opens`:

```text
[ ] Library apa yang membutuhkan ini?
[ ] Versi library sudah terbaru?
[ ] Apakah flag masih diperlukan di Java target terbaru?
[ ] Apakah bisa dibatasi ke module tertentu, bukan ALL-UNNAMED?
[ ] Apakah ada test yang fail bila flag dihapus?
[ ] Apakah tercatat dalam migration notes?
```

---

## 5. System Properties: `-Dkey=value`

System property adalah konfigurasi JVM-level yang tersedia via:

```java
System.getProperty("key")
```

Contoh:

```bash
java \
  -Duser.timezone=UTC \
  -Dfile.encoding=UTF-8 \
  -Dspring.profiles.active=prod \
  -Djavax.net.ssl.trustStore=/opt/app/truststore.p12 \
  -Djavax.net.ssl.trustStorePassword=changeit \
  -jar app.jar
```

### 5.1 Use Case Umum

System properties sering dipakai untuk:

- timezone,
- file encoding,
- framework profile,
- logging config,
- SSL truststore/keystore,
- proxy config,
- feature flag sederhana,
- diagnostics,
- app-specific config.

Contoh SSL:

```bash
-Djavax.net.ssl.trustStore=/opt/app/truststore.p12
-Djavax.net.ssl.trustStoreType=PKCS12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
```

### 5.2 Risiko System Properties

System properties mudah dipakai tetapi punya risiko:

```text
1. Global untuk seluruh JVM process.
2. Bisa dibaca library mana pun.
3. Bisa terekam di process command line.
4. Sulit dilacak bila tersebar di script/env/build tool.
5. Dapat menyebabkan test saling mengganggu bila dimutasi saat runtime.
```

Jangan sembarangan melakukan ini dalam test:

```java
System.setProperty("user.timezone", "Asia/Jakarta");
```

Kalau harus, restore:

```java
String old = System.getProperty("user.timezone");
try {
    System.setProperty("user.timezone", "UTC");
    // test behavior
} finally {
    if (old == null) {
        System.clearProperty("user.timezone");
    } else {
        System.setProperty("user.timezone", old);
    }
}
```

### 5.3 Sensitive Values

Hindari secret di command line:

```bash
-Ddb.password=super-secret
```

Alasan:

- bisa terlihat di process list,
- bisa masuk crash report,
- bisa masuk observability metadata,
- bisa tercatat di deployment manifest,
- bisa bocor lewat debug endpoint.

Lebih baik gunakan secret manager, mounted file, environment variable dengan policy ketat, atau runtime credential provider.

Jika harus memakai property untuk truststore password, pastikan threat model dan platform restriction jelas.

---

## 6. Application Arguments

Application arguments adalah argumen setelah target class/jar/module.

```bash
java -jar app.jar --server.port=8080 --worker.enabled=true
```

Dalam `public static void main(String[] args)`, aplikasi menerima:

```text
--server.port=8080
--worker.enabled=true
```

Perbedaan dengan JVM options:

```bash
java -Xmx1g -jar app.jar --server.port=8080
```

```text
-Xmx1g             -> JVM
-jar app.jar       -> launcher target
--server.port=8080 -> application
```

Jika kamu menaruh JVM option setelah `-jar app.jar`, option itu biasanya tidak lagi diproses sebagai JVM option:

```bash
java -jar app.jar -Xmx1g
```

Di sini `-Xmx1g` menjadi application argument, bukan heap setting.

Ini bug konfigurasi yang sangat umum.

Rule:

```text
Semua JVM options harus muncul sebelum -jar / main class / -m target.
Semua application args muncul setelah target.
```

---

## 7. `-X` Options: Non-Standard tetapi Umum Dipakai

`-X` options adalah extra options. Mereka bukan bagian dari Java SE standard yang sekuat opsi standard, tetapi banyak yang sangat umum di HotSpot.

Contoh:

```bash
-Xms512m
-Xmx2g
-Xss512k
-XshowSettings:vm
-Xlog:gc*
-Xint
-Xcomp
-Xbatch
```

Tidak semua tersedia di semua JVM/version/vendor.

### 7.1 `-Xms` dan `-Xmx`

```bash
-Xms512m
-Xmx2g
```

Makna:

```text
-Xms -> initial heap size
-Xmx -> maximum heap size
```

Contoh:

```bash
java -Xms1g -Xmx1g -jar app.jar
```

Mengapa banyak production service menyamakan `-Xms` dan `-Xmx`?

- Mengurangi heap resizing saat runtime.
- Membuat memory behavior lebih predictable.
- Memudahkan capacity planning.
- Mengurangi latency spike dari heap expansion.

Namun dalam container, `-Xmx` tidak boleh mendekati total memory limit karena JVM juga memakai non-heap/native memory.

Bad:

```bash
# Container limit 2Gi
-Xmx2g
```

Better:

```bash
# Container limit 2Gi
-Xmx1200m
-XX:MaxDirectMemorySize=256m
-Xss512k
# plus budget for metaspace, code cache, native, thread, libc, agent, etc.
```

Detail container budgeting akan dibahas di Part 025.

### 7.2 `-Xss`

```bash
-Xss512k
```

Makna:

```text
Set native stack size per platform thread.
```

Trade-off:

```text
Larger stack:
  + tolerates deeper recursion
  - fewer threads before native memory pressure

Smaller stack:
  + more threads possible
  - risk StackOverflowError for deep call stack
```

Dalam aplikasi platform-thread-heavy, `-Xss` sangat mempengaruhi native memory.

Approximation:

```text
native stack budget ~= number_of_platform_threads × Xss
```

Contoh:

```text
800 platform threads × 1MiB stack = ~800MiB native stack budget
800 platform threads × 512KiB stack = ~400MiB native stack budget
```

Virtual threads berbeda karena virtual thread stack tidak sama dengan native platform thread stack, tetapi carrier/platform thread tetap punya native stack.

### 7.3 `-XshowSettings`

Useful untuk introspeksi cepat:

```bash
java -XshowSettings:vm -version
java -XshowSettings:properties -version
java -XshowSettings:locale -version
java -XshowSettings:system -version
java -XshowSettings:all -version
```

Gunakan di container startup diagnostics:

```bash
java -XshowSettings:vm -version
```

Output berguna untuk melihat estimated heap, ergonomics, dan beberapa setting runtime.

### 7.4 `-Xlog` Java 9+

Mulai Java 9, JVM punya unified logging:

```bash
-Xlog:<selector>:<output>:<decorators>:<output-options>
```

Contoh GC log modern:

```bash
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
```

Contoh console:

```bash
-Xlog:gc*:stdout:time,uptime,level,tags
```

Contoh class loading:

```bash
-Xlog:class+load=info
```

Contoh safepoint:

```bash
-Xlog:safepoint=info
```

Unified logging punya konsep:

```text
tag       -> kategori log, misalnya gc, safepoint, class, os, thread
level     -> error, warning, info, debug, trace
decorator -> time, uptime, pid, tid, level, tags
output    -> stdout, stderr, file
```

Java 8 tidak memakai `-Xlog:gc*`. Java 8 memakai flag lama seperti:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/app/gc.log
```

Compatibility rule:

```text
Java 8  -> legacy GC logging flags
Java 9+ -> unified logging -Xlog
```

### 7.5 `-Xint`, `-Xcomp`, `-Xbatch`

Ini biasanya bukan production default.

```bash
-Xint
```

Menjalankan dengan interpreter saja. Berguna untuk debugging/JIT comparison, tetapi lambat.

```bash
-Xcomp
```

Mencoba compile method saat pertama dipanggil. Bisa membuat startup buruk dan bukan representasi normal.

```bash
-Xbatch
```

Disable background compilation. Berguna untuk eksperimen benchmark/JIT diagnosis tertentu, bukan default production.

Rule:

```text
Jangan pakai flag JIT eksperimental/diagnostik di production kecuali ada hipotesis, measurement, dan rollback plan.
```

---

## 8. `-XX` Options: Advanced HotSpot Options

`-XX` options adalah opsi advanced untuk HotSpot VM.

Ada beberapa bentuk:

```bash
-XX:+BooleanFlag
-XX:-BooleanFlag
-XX:NumericFlag=value
-XX:StringFlag=value
```

Contoh:

```bash
-XX:+UseG1GC
-XX:-UseBiasedLocking
-XX:MaxGCPauseMillis=200
-XX:MaxRAMPercentage=75
-XX:InitialRAMPercentage=50
-XX:ReservedCodeCacheSize=256m
-XX:MaxDirectMemorySize=256m
```

### 8.1 Boolean Flag

Enable:

```bash
-XX:+UseG1GC
```

Disable:

```bash
-XX:-UseG1GC
```

### 8.2 Numeric Flag

```bash
-XX:MaxGCPauseMillis=200
```

### 8.3 Memory Size Suffix

Umum:

```text
k / K -> kilobytes
m / M -> megabytes
g / G -> gigabytes
```

Contoh:

```bash
-Xmx2g
-XX:ReservedCodeCacheSize=256m
-XX:MaxDirectMemorySize=512m
```

### 8.4 Flag Categories

Secara konseptual, `-XX` flags bisa berupa:

```text
product       -> production-supported flag
diagnostic    -> diagnostic flag, perlu unlock
experimental  -> experimental flag, perlu unlock
develop       -> development/debug build only
notproduct    -> non-product build
manageable    -> bisa diubah via management interface pada runtime tertentu
```

Diagnostic flags sering perlu:

```bash
-XX:+UnlockDiagnosticVMOptions
```

Experimental flags sering perlu:

```bash
-XX:+UnlockExperimentalVMOptions
```

Rule:

```text
Production baseline sebaiknya memakai product flags saja, kecuali diagnostic/experimental flag punya alasan jelas dan disetujui.
```

### 8.5 Contoh `-XX` Product Flags Umum

Heap/container:

```bash
-XX:InitialRAMPercentage=50
-XX:MaxRAMPercentage=75
-XX:MinRAMPercentage=50
```

GC:

```bash
-XX:+UseG1GC
-XX:+UseZGC
-XX:MaxGCPauseMillis=200
-XX:InitiatingHeapOccupancyPercent=30
```

Code cache:

```bash
-XX:ReservedCodeCacheSize=256m
```

Direct memory:

```bash
-XX:MaxDirectMemorySize=256m
```

OutOfMemory behavior:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+ExitOnOutOfMemoryError
```

JFR:

```bash
-XX:StartFlightRecording=filename=/var/log/app/startup.jfr,settings=profile,dumponexit=true,maxage=1h,maxsize=256m
```

---

## 9. Diagnostic dan Experimental Options

### 9.1 Diagnostic Options

Diagnostic options membuka visibility ke JVM internals.

Contoh:

```bash
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintFlagsFinal
```

Atau untuk JIT investigation:

```bash
-XX:+UnlockDiagnosticVMOptions
-XX:+PrintCompilation
-XX:+PrintInlining
```

Catatan:

- `PrintCompilation` bisa verbose.
- `PrintInlining` sangat verbose.
- Output bisa mempengaruhi performance dan log volume.
- Jangan aktifkan tanpa tujuan.

### 9.2 Experimental Options

Experimental options harus lebih hati-hati:

```bash
-XX:+UnlockExperimentalVMOptions
```

Jika kamu perlu experimental flag, catat:

```text
[ ] Flag apa?
[ ] Java version mana?
[ ] Vendor mana?
[ ] Kenapa dibutuhkan?
[ ] Alternatifnya apa?
[ ] Bagaimana rollback?
[ ] Bagaimana validasi?
```

Dalam production regulated system, experimental flags harus dianggap sebagai exception, bukan default.

---

## 10. Deprecated, Obsolete, dan Removed Flags

Java upgrade sering gagal karena flag lama.

Contoh kategori:

```text
deprecated -> masih ada, warning, akan dihapus nanti
obsolete   -> tidak punya efek atau digantikan
removed    -> JVM gagal start jika flag dipakai
```

Contoh nyata lintas versi:

- CMS GC tersedia di Java 8, deprecated/removed di versi modern.
- `PermSize`/`MaxPermSize` relevan sebelum Java 8, tidak valid untuk Java 8+ karena PermGen diganti Metaspace.
- Java 8 GC logging flags berbeda dari Java 9+ unified logging.
- Beberapa flags yang dulu default berubah makna karena collector/default ergonomics berubah.
- Biased locking mengalami perubahan lifecycle di Java modern.

Upgrade trap:

```bash
java -XX:+UseConcMarkSweepGC -jar app.jar
```

Di Java modern, ini bisa gagal karena CMS sudah tidak ada.

Upgrade habit:

```bash
java $JAVA_OPTS -version
```

Jalankan ini dalam image Java baru sebelum deploy.

Lebih baik lagi:

```bash
java $JAVA_OPTS -XX:+PrintFlagsFinal -version > flags-final.txt
```

Lalu bandingkan dengan baseline.

---

## 11. Environment Variables yang Mempengaruhi JVM

JVM options sering tidak hanya berasal dari command line. Mereka bisa masuk lewat environment variable.

Yang penting:

```text
JAVA_TOOL_OPTIONS
JDK_JAVA_OPTIONS
_JAVA_OPTIONS
JAVA_OPTS
JVM_OPTS
MAVEN_OPTS
GRADLE_OPTS
```

Tidak semuanya dibaca oleh Java launcher secara native.

---

## 12. `JAVA_TOOL_OPTIONS`

`JAVA_TOOL_OPTIONS` dibaca oleh JVM launcher mechanism untuk menyisipkan option.

Contoh:

```bash
export JAVA_TOOL_OPTIONS="-Duser.timezone=UTC -Dfile.encoding=UTF-8"
java -jar app.jar
```

Biasanya output akan menunjukkan sesuatu seperti:

```text
Picked up JAVA_TOOL_OPTIONS: ...
```

Use case:

- agent injection,
- common diagnostics,
- timezone/encoding policy,
- environment-wide settings.

Risiko:

```text
1. Bisa mempengaruhi semua Java tools, bukan hanya aplikasi.
2. Bisa membuat javac/jar/test process ikut terkena flag yang tidak cocok.
3. Hidden config: tidak terlihat di startup script utama.
4. Bisa menyebabkan build/test gagal dengan cara membingungkan.
```

Jangan menaruh flag yang hanya valid untuk `java` application process jika tool lain juga terkena.

Bad:

```bash
export JAVA_TOOL_OPTIONS="-jar app.jar"
```

Bad:

```bash
export JAVA_TOOL_OPTIONS="-XX:+UseZGC"
# Bisa mengganggu tool Java lain yang tidak seharusnya memakai collector config ini.
```

Better:

```text
Gunakan untuk agent/system property yang benar-benar global dan kompatibel.
```

---

## 13. `JDK_JAVA_OPTIONS`

`JDK_JAVA_OPTIONS` diperkenalkan untuk Java launcher modern. Ia dipakai oleh `java` launcher untuk prepend options ke command line.

Contoh:

```bash
export JDK_JAVA_OPTIONS="-Duser.timezone=UTC -Xlog:gc*:stdout:time,uptime,level,tags"
java -jar app.jar
```

Kelebihan:

- Lebih spesifik ke `java` launcher dibanding environment variable yang bisa mempengaruhi tools lain.
- Berguna untuk runtime application process.

Catatan compatibility:

```text
Java 8 tidak mendukung JDK_JAVA_OPTIONS.
Java 9+ mendukungnya.
```

Untuk fleet mixed Java 8 dan Java 17+, jangan bergantung hanya pada `JDK_JAVA_OPTIONS` jika runtime Java 8 masih ada.

---

## 14. `_JAVA_OPTIONS`

`_JAVA_OPTIONS` juga bisa mempengaruhi JVM invocation. Ia sering dianggap lebih “memaksa” dan dapat membingungkan karena tersembunyi.

Contoh:

```bash
export _JAVA_OPTIONS="-Xmx512m"
java -jar app.jar
```

Risiko besar:

- hidden override,
- sulit dilacak,
- bisa mempengaruhi build tool,
- bisa berbeda antar host,
- bisa menimpa expectation deployment.

Production rule:

```text
Hindari _JAVA_OPTIONS untuk production application config kecuali platform policy sangat jelas.
```

Jika ada masalah JVM config aneh, selalu cek:

```bash
env | grep -E 'JAVA|JDK|JVM|MAVEN|GRADLE'
```

---

## 15. `JAVA_OPTS`, `JVM_OPTS`, `MAVEN_OPTS`, `GRADLE_OPTS`

`JAVA_OPTS` bukan environment variable yang secara otomatis dibaca oleh JVM standard launcher. Ia adalah convention yang sering dibaca oleh script, application server, atau Docker entrypoint.

Contoh script:

```bash
java ${JAVA_OPTS} -jar app.jar
```

Kalau script tidak memakai `${JAVA_OPTS}`, variable itu tidak ada efek.

`MAVEN_OPTS` dipakai Maven untuk JVM yang menjalankan Maven:

```bash
export MAVEN_OPTS="-Xmx2g"
mvn test
```

`GRADLE_OPTS` dan `org.gradle.jvmargs` mempengaruhi Gradle daemon/build JVM, bukan selalu test JVM.

Penting untuk test runtime:

```text
Build JVM != Test JVM != Application JVM
```

Contoh Gradle:

```gradle
// JVM for test worker, not Gradle daemon
tasks.test {
    jvmArgs '-Xmx1g', '-XX:+HeapDumpOnOutOfMemoryError'
}
```

---

## 16. Precedence dan Hidden Configuration

Masalah terbesar JVM config di enterprise bukan tidak tahu flag, tetapi tidak tahu **dari mana flag berasal**.

Sources:

```text
1. Dockerfile ENTRYPOINT
2. Kubernetes command/args
3. Helm values
4. ConfigMap
5. Secret
6. JAVA_TOOL_OPTIONS
7. JDK_JAVA_OPTIONS
8. _JAVA_OPTIONS
9. startup script
10. service manager/systemd
11. application server script
12. build plugin
13. CI variable
14. local IDE run config
```

Praktik buruk:

```text
-Xmx diset di Dockerfile
MaxRAMPercentage diset di Helm
JAVA_TOOL_OPTIONS menambah agent
_JAVA_OPTIONS dari base image menimpa heap
Script menambah -Dspring.profiles.active
```

Hasilnya:

```text
Tidak ada satu orang pun yang tahu konfigurasi JVM final.
```

Solution:

```text
Selalu capture effective runtime config saat startup.
```

Minimal:

```bash
java -XshowSettings:vm -version
```

Saat aplikasi berjalan:

```bash
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

---

## 17. Argument Files: `@file`

Argument file berguna untuk command line panjang dan reproducible.

Contoh `jvm.args`:

```text
-Xms512m
-Xmx2g
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
-XX:+UseG1GC
-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
```

Jalankan:

```bash
java @jvm.args -jar app.jar
```

Bisa juga pisahkan:

```bash
java @jvm-common.args @jvm-prod.args -jar app.jar
```

Keuntungan:

- lebih readable,
- bisa version-controlled,
- bisa direview,
- mengurangi shell quoting issues,
- membuat konfigurasi mudah dibandingkan antar environment.

Risiko:

- file tidak ikut artifact,
- file berbeda antar host,
- secret tidak sengaja masuk git,
- order antar arg file membingungkan.

Rule:

```text
Argument file boleh dipakai untuk JVM flags non-secret.
Secret tetap harus lewat mekanisme secret management.
```

---

## 18. Inspecting JVM Flags: Jangan Menebak Effective Config

### 18.1 `-XX:+PrintFlagsFinal`

```bash
java -XX:+PrintFlagsFinal -version
```

Ini mencetak banyak HotSpot flags beserta value finalnya.

Contoh filter Unix:

```bash
java -XX:+PrintFlagsFinal -version 2>&1 | grep -E 'MaxHeapSize|UseG1GC|UseZGC|MaxRAMPercentage|ReservedCodeCacheSize'
```

Contoh PowerShell:

```powershell
java -XX:+PrintFlagsFinal -version 2>&1 | Select-String "MaxHeapSize|UseG1GC|UseZGC|MaxRAMPercentage|ReservedCodeCacheSize"
```

Output sering punya marker seperti:

```text
{product}
{manageable}
{ergonomic}
{command line}
```

Interpretasi:

```text
command line -> diset eksplisit
ergonomic    -> dipilih JVM ergonomics
default       -> default
manageable    -> bisa dikelola via management interface tertentu
```

### 18.2 `-XX:+PrintCommandLineFlags`

```bash
java -XX:+PrintCommandLineFlags -version
```

Mencetak flags penting yang dipilih/dipakai saat startup, termasuk ergonomics tertentu.

Useful untuk melihat collector default, heap sizing, compressed oops, dan sebagainya.

### 18.3 `-XshowSettings`

```bash
java -XshowSettings:vm -version
java -XshowSettings:properties -version
java -XshowSettings:system -version
```

Useful untuk startup diagnostics.

### 18.4 `jcmd VM.command_line`

Untuk proses berjalan:

```bash
jcmd <pid> VM.command_line
```

Menunjukkan command line.

### 18.5 `jcmd VM.flags`

```bash
jcmd <pid> VM.flags
```

Menunjukkan flags yang digunakan proses berjalan.

### 18.6 `jcmd VM.system_properties`

```bash
jcmd <pid> VM.system_properties
```

Hati-hati: bisa berisi sensitive values.

### 18.7 `jcmd VM.native_memory`

Jika NMT aktif:

```bash
jcmd <pid> VM.native_memory summary
```

Butuh startup:

```bash
-XX:NativeMemoryTracking=summary
```

atau:

```bash
-XX:NativeMemoryTracking=detail
```

NMT punya overhead. `summary` lebih ringan dari `detail`.

---

## 19. Java 8 vs Java 9+ Logging: Compatibility Table

| Concern | Java 8 | Java 9+ / 11 / 17 / 21 / 25 |
|---|---|---|
| GC log main style | legacy flags | unified logging `-Xlog` |
| GC details | `-XX:+PrintGCDetails` | `-Xlog:gc*` |
| GC timestamp | `-XX:+PrintGCDateStamps` | decorators `time,uptime` |
| GC file | `-Xloggc:file` | `file=...` output |
| log rotation | `-XX:+UseGCLogFileRotation` etc. | `filecount`, `filesize` |
| class loading log | `-XX:+TraceClassLoading` | `-Xlog:class+load=info` |
| module options | not applicable | `--add-opens`, `--add-exports`, etc. |
| `JDK_JAVA_OPTIONS` | unavailable | available |

Java 8 example:

```bash
java \
  -Xms1g -Xmx1g \
  -XX:+UseG1GC \
  -XX:+PrintGCDetails \
  -XX:+PrintGCDateStamps \
  -XX:+PrintTenuringDistribution \
  -Xloggc:/var/log/app/gc.log \
  -XX:+UseGCLogFileRotation \
  -XX:NumberOfGCLogFiles=10 \
  -XX:GCLogFileSize=50M \
  -jar app.jar
```

Java 17/21/25 example:

```bash
java \
  -Xms1g -Xmx1g \
  -XX:+UseG1GC \
  -Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m \
  -jar app.jar
```

Do not mix blindly.

---

## 20. JVM Flags untuk Diagnostics yang Sebaiknya Ada di Production Baseline

Production JVM config bukan hanya heap dan GC. Ia harus mempersiapkan bukti saat failure terjadi.

Baseline modern Java 17+ / 21+ / 25+:

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+ExitOnOutOfMemoryError
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Optional JFR continuous recording:

```bash
-XX:StartFlightRecording=filename=/var/log/app/app.jfr,settings=profile,dumponexit=true,maxage=1h,maxsize=256m
```

Java 8 baseline equivalent needs legacy GC logging and JFR availability depends on distribution/update/license history. For modern OpenJDK/JDK versions, JFR is a standard tool.

### 20.1 `HeapDumpOnOutOfMemoryError`

```bash
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
```

Benefits:

- evidence for memory leak/retention,
- post-mortem analysis,
- dominator tree inspection,
- object retention path.

Risk:

- heap dump can be huge,
- may contain sensitive data,
- storage may fill,
- dump writing can delay process death.

Operational requirement:

```text
[ ] Heap dump path has enough space.
[ ] Access is restricted.
[ ] Retention policy exists.
[ ] PII/security policy exists.
```

### 20.2 `ExitOnOutOfMemoryError`

```bash
-XX:+ExitOnOutOfMemoryError
```

When JVM encounters OOM, exit instead of limping in corrupted/unknown state.

Why useful in container/orchestrated service:

```text
OOM after severe memory pressure often leaves service unreliable.
Fast exit lets orchestrator restart cleanly.
```

But be careful for batch jobs where you want post-failure hooks. Use a runbook.

### 20.3 `ErrorFile`

```bash
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

HotSpot fatal error logs are extremely useful for crash diagnosis:

- SIGSEGV,
- JVM crash,
- native library crash,
- compiler crash,
- container/native memory issue.

### 20.4 GC + Safepoint Log

```bash
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
```

Why safepoint?

- JVM pauses are not only GC.
- Thread dump, biased lock revocation in old versions, deoptimization, class redefinition, code cache cleanup, and other VM operations may cause safepoints.

---

## 21. Safe Baseline by Environment

### 21.1 Local Development

Goals:

- fast feedback,
- reasonable memory,
- readable diagnostics,
- no excessive log volume.

Example:

```bash
-Xms256m
-Xmx1g
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=./tmp/heapdump.hprof
```

Optional:

```bash
-Xlog:gc*:stdout:uptime,level,tags
```

### 21.2 CI Test JVM

Goals:

- predictable memory,
- fail fast,
- capture diagnostics on OOM,
- avoid starving CI worker.

Example:

```bash
-Xms256m
-Xmx1g
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=build/diagnostics
-XX:+ExitOnOutOfMemoryError
```

For integration tests with Testcontainers, remember Docker/container memory is outside test JVM heap.

### 21.3 Staging

Goals:

- similar to production,
- more diagnostics,
- enough observability for load test.

Example Java 17+:

```bash
-Xms1g
-Xmx1g
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
-XX:+UseG1GC
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+ExitOnOutOfMemoryError
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
-XX:StartFlightRecording=filename=/var/log/app/staging.jfr,settings=profile,dumponexit=true,maxage=2h,maxsize=512m
```

### 21.4 Production

Goals:

- predictable resource usage,
- diagnostics on failure,
- bounded log/dump size,
- explicit collector choice when needed,
- minimal experimental flags,
- compatible with orchestrator.

Example Java 21/25 non-container bare VM:

```bash
-Xms2g
-Xmx2g
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/var/log/app/heapdump.hprof
-XX:+ExitOnOutOfMemoryError
-XX:ErrorFile=/var/log/app/hs_err_pid%p.log
```

Container-specific sizing will be refined in Part 025.

---

## 22. Common JVM Flag Anti-Patterns

### Anti-Pattern 1 — Copy-Paste Tuning

Bad:

```bash
-XX:NewRatio=2
-XX:SurvivorRatio=8
-XX:MaxTenuringThreshold=15
-XX:InitiatingHeapOccupancyPercent=20
-XX:G1HeapRegionSize=32m
```

Without evidence, these are just random perturbations.

Better:

```text
Start with simple baseline.
Collect GC logs/JFR/load-test metrics.
Tune one variable at a time.
Compare before/after.
Keep rollback plan.
```

### Anti-Pattern 2 — Mixing Collector Flags

Bad:

```bash
-XX:+UseG1GC -XX:+UseZGC
```

Only one collector should be selected. Conflicting collector flags indicate configuration assembly failure.

### Anti-Pattern 3 — Using Java 8 Flags on Java 17+

Bad:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/gc.log
```

On modern Java, use unified logging:

```bash
-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
```

### Anti-Pattern 4 — Heap Equals Machine Memory

Bad:

```bash
# Machine/container memory 4g
-Xmx4g
```

JVM needs non-heap/native memory:

- metaspace,
- code cache,
- direct buffers,
- thread stacks,
- GC structures,
- JIT compiler memory,
- native libs,
- agents,
- libc malloc,
- mapped files.

### Anti-Pattern 5 — Hidden `_JAVA_OPTIONS`

Bad:

```bash
export _JAVA_OPTIONS="-Xmx256m"
```

Then production app unexpectedly has small heap.

Better:

```text
Use explicit startup config and print effective settings.
```

### Anti-Pattern 6 — Diagnostic Flag Always On Without Budget

Bad:

```bash
-XX:NativeMemoryTracking=detail
-Xlog:class+load=trace
```

This may create overhead/log volume.

Better:

```text
Enable high-volume diagnostics temporarily or in staging, not by default production unless budgeted.
```

### Anti-Pattern 7 — Secret in JVM Command Line

Bad:

```bash
-Ddb.password=ProdPassword123
```

Better:

```text
Use secret manager / mounted secret / credential provider.
```

### Anti-Pattern 8 — Wrong Option Position

Bad:

```bash
java -jar app.jar -Xmx2g
```

`-Xmx2g` becomes application argument.

Correct:

```bash
java -Xmx2g -jar app.jar
```

---

## 23. JVM Configuration Manifest

A strong team should version-control a JVM configuration manifest.

Example:

```yaml
service: case-management-service
java:
  supported_versions:
    - 17
    - 21
    - 25
  runtime_vendor: "Temurin/Oracle/GraalVM - define explicitly"
  launcher_mode: "executable-jar"
  artifact: "case-management-service.jar"

jvm:
  memory:
    xms: "1024m"
    xmx: "1024m"
    xss: "512k"
    max_direct_memory: "256m"
  gc:
    collector: "G1GC"
    max_gc_pause_millis: 200
    logging:
      java_8: "legacy-gc-log-profile"
      java_17_plus: "unified-gc-log-profile"
  diagnostics:
    heap_dump_on_oom: true
    heap_dump_path: "/var/log/app/heapdump.hprof"
    exit_on_oom: true
    error_file: "/var/log/app/hs_err_pid%p.log"
    jfr_default_recording: false
  system_properties:
    user.timezone: "UTC"
    file.encoding: "UTF-8"
  module_opens:
    required: []
    review_policy: "No --add-opens without owner and removal plan"

operational_policy:
  no_secrets_in_command_line: true
  print_effective_flags_on_startup: true
  capture_jcmd_on_incident: true
  flag_change_requires_load_test: true
```

Why useful:

- config review,
- upgrade planning,
- incident investigation,
- drift detection,
- auditability,
- onboarding.

---

## 24. Step-by-Step: Validating JVM Configuration Before Deployment

### Step 1 — Identify Java Runtime

```bash
java -version
```

Check:

```text
[ ] major version
[ ] vendor
[ ] VM type
[ ] architecture
```

### Step 2 — Validate JVM Options Parse

```bash
java $JAVA_OPTS -version
```

If JVM fails here, deployment should fail before app starts.

### Step 3 — Print Important Flags

```bash
java $JAVA_OPTS -XX:+PrintCommandLineFlags -version
```

### Step 4 — Capture Final Flags

```bash
java $JAVA_OPTS -XX:+PrintFlagsFinal -version > flags-final.txt 2>&1
```

### Step 5 — Filter Critical Flags

```bash
grep -E 'MaxHeapSize|InitialHeapSize|UseG1GC|UseZGC|MaxRAMPercentage|InitialRAMPercentage|ReservedCodeCacheSize|MaxDirectMemorySize|ThreadStackSize' flags-final.txt
```

PowerShell:

```powershell
Select-String -Path flags-final.txt -Pattern "MaxHeapSize|InitialHeapSize|UseG1GC|UseZGC|MaxRAMPercentage|InitialRAMPercentage|ReservedCodeCacheSize|MaxDirectMemorySize|ThreadStackSize"
```

### Step 6 — Check Environment Injection

```bash
env | grep -E 'JAVA|JDK|JVM|MAVEN|GRADLE'
```

PowerShell:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match 'JAVA|JDK|JVM|MAVEN|GRADLE' }
```

### Step 7 — Start App and Capture Runtime Command

```bash
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
```

### Step 8 — Store Diagnostics Artifact

For every release candidate, store:

```text
java-version.txt
jvm-command-line.txt
jvm-flags.txt
jvm-system-properties-redacted.txt
gc-log-sample.log
jfr-startup-sample.jfr, if enabled
```

---

## 25. Build Tool Integration

### 25.1 Maven Surefire

Unit test JVM options:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-surefire-plugin</artifactId>
  <version>3.5.4</version>
  <configuration>
    <argLine>
      -Xms256m -Xmx1g
      -Duser.timezone=UTC
      -Dfile.encoding=UTF-8
      -XX:+HeapDumpOnOutOfMemoryError
      -XX:HeapDumpPath=${project.build.directory}/diagnostics
    </argLine>
  </configuration>
</plugin>
```

Integration test JVM options:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-failsafe-plugin</artifactId>
  <version>3.5.4</version>
  <configuration>
    <argLine>
      -Xms512m -Xmx1536m
      -Duser.timezone=UTC
      -Dfile.encoding=UTF-8
      -XX:+HeapDumpOnOutOfMemoryError
      -XX:HeapDumpPath=${project.build.directory}/diagnostics
    </argLine>
  </configuration>
</plugin>
```

Remember:

```text
Maven JVM options via MAVEN_OPTS are not the same as test fork JVM argLine.
```

### 25.2 Gradle

```gradle
tasks.test {
    useJUnitPlatform()
    minHeapSize = "256m"
    maxHeapSize = "1g"
    jvmArgs(
        "-Duser.timezone=UTC",
        "-Dfile.encoding=UTF-8",
        "-XX:+HeapDumpOnOutOfMemoryError",
        "-XX:HeapDumpPath=${layout.buildDirectory.get().asFile}/diagnostics"
    )
}
```

Gradle daemon JVM config can be set in `gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
```

But test worker JVM config belongs in `tasks.test.jvmArgs`, `minHeapSize`, and `maxHeapSize`.

---

## 26. IDE Runtime Config

Local bugs often happen because IDE runtime differs from CLI runtime.

Checklist:

```text
[ ] IDE uses same Java major version as build.
[ ] IDE test runner uses same timezone/encoding.
[ ] IDE run config includes required --add-opens if still needed.
[ ] IDE does not hide extra VM options.
[ ] CLI test and IDE test produce same result.
```

Recommended local VM options:

```text
-Duser.timezone=UTC
-Dfile.encoding=UTF-8
-Xmx1g
```

For JUnit tests involving locale/timezone, do not rely on machine default.

---

## 27. Runtime Configuration Review Checklist

Before accepting JVM config changes:

```text
[ ] What problem does this flag solve?
[ ] Which Java versions support it?
[ ] Is it product, diagnostic, or experimental?
[ ] Is it vendor-specific?
[ ] Is it compatible with container limits?
[ ] Does it affect startup, throughput, latency, memory, or diagnostics?
[ ] Is there a before/after measurement?
[ ] Is there a rollback plan?
[ ] Is it documented in the JVM manifest?
[ ] Is it tested in staging/load test?
[ ] Does it expose secrets?
[ ] Does it generate logs/dumps within storage budget?
[ ] Does it conflict with another flag?
[ ] Does it rely on removed/deprecated behavior?
```

---

## 28. Practical Patterns

### Pattern 1 — Minimal Production Baseline

```bash
JAVA_OPTS="
  -Duser.timezone=UTC
  -Dfile.encoding=UTF-8
  -XX:+HeapDumpOnOutOfMemoryError
  -XX:HeapDumpPath=/var/log/app/heapdump.hprof
  -XX:+ExitOnOutOfMemoryError
  -XX:ErrorFile=/var/log/app/hs_err_pid%p.log
  -Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m
"

java ${JAVA_OPTS} -jar app.jar
```

### Pattern 2 — Version-Specific GC Logging

```bash
JAVA_MAJOR=$(java -version 2>&1 | awk -F[\".] '/version/ {print $2}')

if [ "$JAVA_MAJOR" = "1" ]; then
  # Java 8 version string starts with 1.8
  GC_LOG_OPTS="-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/var/log/app/gc.log"
else
  GC_LOG_OPTS="-Xlog:gc*:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=50m"
fi

java ${GC_LOG_OPTS} -jar app.jar
```

A real production script should parse versions more robustly, but the idea is: **do not use one GC logging syntax blindly across Java 8 and modern Java**.

### Pattern 3 — Print Effective Config on Startup

Startup script:

```bash
echo "=== Java Version ==="
java -version

echo "=== JVM Settings ==="
java ${JAVA_OPTS} -XshowSettings:vm -version

echo "=== Command Line Flags ==="
java ${JAVA_OPTS} -XX:+PrintCommandLineFlags -version

exec java ${JAVA_OPTS} -jar app.jar
```

Avoid printing sensitive system properties.

### Pattern 4 — Runtime Incident Snapshot

```bash
PID=$(pgrep -f 'app.jar')
mkdir -p /tmp/jvm-snapshot

jcmd $PID VM.version > /tmp/jvm-snapshot/vm-version.txt
jcmd $PID VM.command_line > /tmp/jvm-snapshot/vm-command-line.txt
jcmd $PID VM.flags > /tmp/jvm-snapshot/vm-flags.txt
jcmd $PID Thread.print > /tmp/jvm-snapshot/thread-dump.txt
jcmd $PID GC.class_histogram > /tmp/jvm-snapshot/class-histogram.txt
```

Add NMT if enabled:

```bash
jcmd $PID VM.native_memory summary > /tmp/jvm-snapshot/native-memory.txt
```

---

## 29. Case Study: “JVM Flag Upgrade Broke Production Startup”

### Situation

A service previously ran on Java 8:

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:+UseConcMarkSweepGC \
  -XX:+PrintGCDetails \
  -XX:+PrintGCDateStamps \
  -Xloggc:/var/log/app/gc.log \
  -jar app.jar
```

Team upgrades base image to Java 17.

Deployment fails at startup.

### Weak Diagnosis

> “Java 17 is unstable.”

### Correct Diagnosis

The config contains Java 8-era flags:

```text
-XX:+UseConcMarkSweepGC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc
```

Some may be ignored/warned/removed depending version, but the config is not migration-safe.

### Correct Migration

```bash
java \
  -Xms2g \
  -Xmx2g \
  -XX:+UseG1GC \
  -Xlog:gc*,safepoint:file=/var/log/app/gc.log:time,uptime,level,tags:filecount=10,filesize=100m \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/var/log/app/heapdump.hprof \
  -XX:+ExitOnOutOfMemoryError \
  -jar app.jar
```

### Lessons

```text
1. JVM flags are versioned runtime API.
2. Upgrade requires flag audit, not only code compilation.
3. Effective config should be tested with `java $JAVA_OPTS -version`.
4. GC logging syntax changed significantly from Java 8 to Java 9+.
5. Deprecated/removed collectors must be replaced with supported collectors.
```

---

## 30. Case Study: “Heap Looks Fine but Pod Gets OOMKilled”

### Situation

Kubernetes pod limit:

```text
memory limit: 2Gi
```

JVM config:

```bash
-Xmx1800m
```

Heap usage in metrics:

```text
used heap: 1.2Gi
max heap: 1.8Gi
```

But pod gets OOMKilled.

### Weak Diagnosis

> “The JVM leaks heap.”

### Better Diagnosis

Container memory includes:

```text
heap
+ metaspace
+ code cache
+ direct buffers
+ thread stacks
+ GC native structures
+ JIT/compiler memory
+ native libraries
+ agents
+ libc malloc
+ mapped files
```

`-Xmx1800m` in 2Gi container leaves too little native/non-heap headroom.

### Investigation

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.native_memory summary   # if NMT enabled
jcmd <pid> GC.heap_info
jcmd <pid> Thread.print | grep nid | wc -l
```

Check:

```text
[ ] direct buffer usage
[ ] thread count
[ ] metaspace
[ ] code cache
[ ] agent overhead
[ ] malloc arenas
[ ] container memory working set
```

### Correct Direction

Do not just reduce GC pause target. Re-budget memory.

Example:

```bash
-Xmx1200m
-XX:MaxDirectMemorySize=256m
-Xss512k
```

And set container request/limit based on observed RSS, not heap alone.

Part 025 will go deeper into this.

---

## 31. Case Study: “Flag Works Locally but Not in CI”

### Situation

Developer adds:

```bash
JDK_JAVA_OPTIONS="--add-opens java.base/java.lang=ALL-UNNAMED"
```

Local Java 21 works. CI job using Java 8 ignores `JDK_JAVA_OPTIONS`, and tests fail.

### Root Cause

`JDK_JAVA_OPTIONS` is Java 9+ launcher feature. Java 8 does not process it.

### Fix

For mixed Java 8/17 fleet:

- Do not hide critical test flags only in `JDK_JAVA_OPTIONS`.
- Configure build tool test JVM explicitly.
- Split Java 8 and Java 17+ profiles.

Maven example:

```xml
<profiles>
  <profile>
    <id>java17plus</id>
    <activation>
      <jdk>[17,)</jdk>
    </activation>
    <properties>
      <test.jvm.args>--add-opens java.base/java.lang=ALL-UNNAMED</test.jvm.args>
    </properties>
  </profile>
</profiles>
```

---

## 32. Java 8–25 Compatibility Notes

### Java 8

Key points:

- No module system.
- No `--add-opens`.
- No `JDK_JAVA_OPTIONS`.
- Legacy GC logging.
- PermGen already removed; Metaspace exists.
- CMS may exist depending update/distribution.
- G1 available but not same maturity as later versions.
- JFR availability depends on distribution/update history.

### Java 11

Key points:

- Module system exists.
- Unified logging exists.
- G1 is default in common HotSpot distributions.
- ZGC available as experimental in early versions.
- Many Java EE/JAXB modules removed from JDK, requiring external dependencies.
- Stronger migration pressure for reflective access.

### Java 17

Key points:

- Strong encapsulation is much more visible.
- `--add-opens` often appears in legacy framework migration.
- JFR/JMC ecosystem mature.
- ZGC/Shenandoah more mature depending distribution.
- Many old flags/collectors removed.
- JUnit 6 requires Java 17+.

### Java 21

Key points:

- Virtual threads are production feature.
- Thread-stack and thread-count mental model changes for app-level concurrency, but carrier/platform thread/native memory still matter.
- Generational ZGC introduced as a major low-latency direction.
- JVM configuration must account for virtual-thread-heavy observability and diagnostics.

### Java 25

Key points:

- Treat JDK 25 docs/release notes as source of truth for current options.
- Generational ZGC direction continues; non-generational ZGC was removed by JEP 490.
- Upgrade from Java 8/11/17/21 requires flag audit.
- Do not assume every flag from older tuning guide remains valid.

---

## 33. Top 1% Engineer Notes

### 33.1 JVM Flag is a Change to Runtime Semantics

Every JVM flag change is a runtime behavior change. It can affect:

- performance,
- failure mode,
- observability,
- startup,
- memory pressure,
- GC behavior,
- compatibility.

Treat it like code change.

### 33.2 Prefer Fewer Flags with Better Evidence

A clean JVM config with 8 intentional flags is better than 40 cargo-cult flags.

Bad sign:

```text
Nobody knows why this flag exists.
```

Good sign:

```text
Every non-default flag has owner, reason, measurement, and removal condition.
```

### 33.3 Effective Config Matters More Than Intended Config

What matters is not Helm value, Dockerfile, or startup script individually.

What matters is:

```text
What JVM actually received and used.
```

Always inspect runtime:

```bash
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
```

### 33.4 Version Compatibility is Part of Runtime Engineering

Java 8 to 25 spans a huge runtime evolution:

- logging changed,
- collectors changed,
- module system appeared,
- defaults changed,
- removed flags accumulated,
- container ergonomics improved,
- virtual threads changed concurrency assumptions.

Do not maintain one giant universal `JAVA_OPTS` without version gates.

### 33.5 JVM Config Must Support Incidents

A production JVM config that has no GC log, no heap dump, no fatal error file, and no way to inspect flags is operationally weak.

When incident happens, you need evidence, not guesses.

---

## 34. Practical Exercises

### Exercise 1 — Inspect Your Current JVM

Run:

```bash
java -version
java -XshowSettings:vm -version
java -XX:+PrintCommandLineFlags -version
java -XX:+PrintFlagsFinal -version > flags-final.txt 2>&1
```

Answer:

```text
1. What Java version are you running?
2. What is max heap ergonomically selected?
3. What GC is selected by default?
4. Is compressed oops enabled?
5. What is reserved code cache size?
```

### Exercise 2 — Find Hidden Java Options

Run:

```bash
env | grep -E 'JAVA|JDK|JVM|MAVEN|GRADLE'
```

PowerShell:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match 'JAVA|JDK|JVM|MAVEN|GRADLE' }
```

Answer:

```text
1. Are any options injected implicitly?
2. Do they affect only application JVM or also tools?
3. Are there secrets in env options?
```

### Exercise 3 — Build a JVM Manifest

Create:

```text
jvm-runtime-manifest.yaml
```

Include:

```text
Java version
Runtime vendor
Heap settings
GC collector
GC logging
OOM behavior
JFR policy
System properties
Module opens
Container memory budget
Owner/reason for each non-default flag
```

### Exercise 4 — Java 8 to Java 21 Flag Audit

Given:

```bash
-Xms2g
-Xmx2g
-XX:+UseConcMarkSweepGC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:/var/log/gc.log
-XX:MaxPermSize=256m
```

Classify each flag:

```text
[ ] still valid
[ ] legacy but replaceable
[ ] removed/invalid
[ ] wrong for Java 21
[ ] needs migration
```

Rewrite for Java 21/25.

---

## 35. Summary

JVM arguments are not a random bag of tuning tricks. They are the startup contract of the Java process.

Key takeaways:

1. Put JVM options before `-jar`, main class, or module target.
2. Separate JVM options, system properties, and application arguments.
3. Treat `-X` and `-XX` options as version-sensitive runtime controls.
4. Do not copy-paste tuning flags without evidence.
5. Java 8 and Java 9+ differ significantly in GC logging and launcher features.
6. Environment variables can secretly inject JVM options.
7. Always inspect effective runtime config with `PrintFlagsFinal`, `XshowSettings`, and `jcmd`.
8. Production baseline should include diagnostics for OOM, crash, GC, and safepoints.
9. Avoid secrets in command line/system properties.
10. Maintain a JVM configuration manifest and review it like code.

Mental model akhir:

```text
Good JVM configuration is not the one with the most flags.
Good JVM configuration is the one whose behavior is intentional, measurable, reproducible, version-compatible, and diagnosable under failure.
```

---

## 36. Referensi

- Oracle Java SE 25 Documentation — `java` command and JDK docs: https://docs.oracle.com/en/java/javase/25/
- Oracle Java SE 25 `java` command manual: https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html
- Oracle Java SE 17 `java` command manual: https://docs.oracle.com/en/java/javase/17/docs/specs/man/java.html
- Oracle Java 8 Troubleshooting Guide — `JAVA_TOOL_OPTIONS`: https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/envvars002.html
- Oracle Java 8 Troubleshooting Guide — `jcmd`: https://docs.oracle.com/javase/8/docs/technotes/guides/troubleshoot/tooldescr006.html
- Oracle Java HotSpot VM Options: https://www.oracle.com/java/technologies/javase/vmoptions-jsp.html
- OpenJDK JEP 158 — Unified JVM Logging: https://openjdk.org/jeps/158
- OpenJDK JEP 271 — Unified GC Logging: https://openjdk.org/jeps/271
- OpenJDK JDK 25 Project: https://openjdk.org/projects/jdk/25/

---

## 37. Status Seri

```text
Seri belum selesai.
Progress saat ini: Part 024 dari 031 selesai.
Berikutnya: Part 025 — JVM Arguments & Configuration II: Production Profiles for Containers, Kubernetes, and Cloud.
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-023](./learn-java-testing-benchmarking-performance-jvm-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-025](./learn-java-testing-benchmarking-performance-jvm-part-025.md)

</div>