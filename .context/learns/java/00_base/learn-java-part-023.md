# learn-java-part-023.md

# Bagian 23 — Migration: Java 8 → 11 → 17 → 21 → 25

> Target pembaca: software engineer / tech lead yang perlu memigrasikan aplikasi Java lama ke Java modern dengan risiko terkontrol.
>
> Target hasil: kamu mampu merancang, menjalankan, men-debug, dan mengawal migrasi Java dari 8 ke 25 secara sistematis: bukan hanya “compile berhasil”, tetapi source compatibility, binary compatibility, behavioral compatibility, dependency compatibility, framework compatibility, runtime behavior, observability, deployment, dan rollback readiness.

---

## Daftar Isi

1. [Orientasi: Migrasi Java Bukan Sekadar Ganti JDK](#1-orientasi-migrasi-java-bukan-sekadar-ganti-jdk)
2. [Mental Model Compatibility](#2-mental-model-compatibility)
3. [Strategi Migrasi Besar: Big Bang vs Bertahap](#3-strategi-migrasi-besar-big-bang-vs-bertahap)
4. [Inventory Awal: Apa yang Harus Dipetakan](#4-inventory-awal-apa-yang-harus-dipetakan)
5. [Tooling Wajib Migrasi](#5-tooling-wajib-migrasi)
6. [Baseline Build dan Test Strategy](#6-baseline-build-dan-test-strategy)
7. [Java 8 → Java 11](#7-java-8--java-11)
8. [Java 11 → Java 17](#8-java-11--java-17)
9. [Java 17 → Java 21](#9-java-17--java-21)
10. [Java 21 → Java 25](#10-java-21--java-25)
11. [Migrasi Source Code](#11-migrasi-source-code)
12. [Migrasi Dependency](#12-migrasi-dependency)
13. [Migrasi Build Tool: Maven dan Gradle](#13-migrasi-build-tool-maven-dan-gradle)
14. [Migrasi Framework: Spring, Jakarta, Hibernate, Jackson, Testing](#14-migrasi-framework-spring-jakarta-hibernate-jackson-testing)
15. [Migrasi JPMS, Classpath, Module Path, dan Strong Encapsulation](#15-migrasi-jpms-classpath-module-path-dan-strong-encapsulation)
16. [Migrasi Internal API dan Reflection](#16-migrasi-internal-api-dan-reflection)
17. [Migrasi Runtime Flags, GC, Memory, dan Container](#17-migrasi-runtime-flags-gc-memory-dan-container)
18. [Migrasi Security dan Cryptography](#18-migrasi-security-dan-cryptography)
19. [Migrasi Internationalization, Locale, Charset, dan Timezone](#19-migrasi-internationalization-locale-charset-dan-timezone)
20. [Migrasi Serialization dan Data Compatibility](#20-migrasi-serialization-dan-data-compatibility)
21. [Migrasi Concurrency: Platform Thread, CompletableFuture, Virtual Thread](#21-migrasi-concurrency-platform-thread-completablefuture-virtual-thread)
22. [Migrasi Observability dan Diagnostics](#22-migrasi-observability-dan-diagnostics)
23. [Performance Regression Strategy](#23-performance-regression-strategy)
24. [CI/CD dan Release Strategy](#24-cicd-dan-release-strategy)
25. [Rollback dan Dual Runtime Strategy](#25-rollback-dan-dual-runtime-strategy)
26. [Checklist Migrasi per Tahap](#26-checklist-migrasi-per-tahap)
27. [Common Failure Modes](#27-common-failure-modes)
28. [Template Migration Plan](#28-template-migration-plan)
29. [Latihan Bertahap](#29-latihan-bertahap)
30. [Mini Project: Java 8 Legacy Service ke Java 25](#30-mini-project-java-8-legacy-service-ke-java-25)
31. [Referensi Resmi](#31-referensi-resmi)

---

# 1. Orientasi: Migrasi Java Bukan Sekadar Ganti JDK

Migrasi Java sering terlihat sederhana:

```text
ubah JAVA_HOME
ubah sourceCompatibility
run mvn test
deploy
```

Untuk aplikasi kecil, ini bisa berhasil. Untuk sistem enterprise, terutama yang punya:

- Spring Boot lama;
- Hibernate/JPA lama;
- JAXB/JAX-WS;
- reflection-heavy framework;
- Java agent/APM;
- custom classloader;
- internal JDK API;
- old GC flags;
- old TLS/certificate assumption;
- locale/date formatting;
- serialization compatibility;
- app server legacy;
- Java EE `javax.*`;
- Docker image lama;
- CI/CD lama;
- banyak microservices;

migrasi Java adalah perubahan lintas layer.

Migrasi yang benar tidak hanya bertanya:

```text
Apakah aplikasi compile?
```

Tetapi:

```text
Apakah behavior sama?
Apakah dependency kompatibel?
Apakah framework mendukung JDK target?
Apakah startup berubah?
Apakah GC berubah?
Apakah reflection masih bisa?
Apakah TLS/cert masih valid?
Apakah date/currency/locale output berubah?
Apakah serialization backward-compatible?
Apakah observability masih jalan?
Apakah container memory sizing masih benar?
Apakah rollback bisa?
```

## 1.1 Kenapa Java 8 ke Java 25 besar?

Java 8 dirilis sebelum beberapa perubahan besar:

```text
Java 9   → module system, modular runtime image
Java 11  → Java EE/CORBA modules removed, first major LTS after 8
Java 17  → strong encapsulation by default, sealed classes, records mature
Java 21  → virtual threads, sequenced collections, pattern matching maturity
Java 25  → new LTS, AOT cache direction, JFR enhancements, compact object headers, more removals/deprecations
```

Masalah utama dari Java 8 ke 25 bukan syntax. Masalah utamanya adalah:

```text
ecosystem assumptions from Java 8 are no longer always true
```

Contoh assumption Java 8:

```text
rt.jar exists
tools.jar exists
application class loader is URLClassLoader
JDK contains JAXB
default charset follows OS locale
illegal reflection into JDK internals may work
old GC flags accepted
Security Manager can be used as sandbox
Java EE javax APIs available in JDK
old locale data available
```

Banyak assumption ini berubah.

## 1.2 Migration goal yang benar

Goal buruk:

```text
Upgrade ke Java 25.
```

Goal baik:

```text
Upgrade service A dari Java 8 ke Java 25 dengan:
- all tests passing;
- no unsupported internal JDK API;
- no illegal reflective access workaround left without owner;
- same API contract;
- same serialization compatibility;
- no p95/p99 regression beyond 10%;
- memory within existing pod limit or new sizing documented;
- observability intact;
- rollback possible within one deployment;
- production rollout staged.
```

## 1.3 Migration sebagai engineering project

Migrasi harus punya:

- inventory;
- compatibility analysis;
- dependency upgrade plan;
- build pipeline update;
- source changes;
- runtime changes;
- testing matrix;
- performance baseline;
- rollout strategy;
- rollback plan;
- ownership;
- risk register.

---

# 2. Mental Model Compatibility

Oracle/OpenJDK membedakan compatibility issue dalam tiga kategori besar:

```text
source compatibility
binary compatibility
behavioral compatibility
```

Untuk migrasi enterprise, tambahkan beberapa kategori praktis:

```text
source compatibility
binary compatibility
behavioral compatibility
dependency compatibility
toolchain compatibility
framework compatibility
runtime compatibility
operational compatibility
data compatibility
security compatibility
```

## 2.1 Source compatibility

Source compatibility berarti source code lama masih bisa dikompilasi dengan compiler baru.

Contoh source incompatibility:

```java
static Object _ = new Object();
```

Sejak Java 9, `_` tidak boleh digunakan sebagai identifier.

Contoh lain:

- memakai API yang sudah removed;
- memakai internal package yang tidak accessible;
- source level lama tidak didukung;
- annotation processor tidak kompatibel;
- generated source memakai syntax/API lama.

## 2.2 Binary compatibility

Binary compatibility berarti `.class` lama masih bisa dilink/run di runtime baru.

Contoh binary issue:

```text
NoClassDefFoundError: javax/xml/bind/JAXBContext
```

Source lama mungkin compile di Java 8 karena JAXB ada di JDK. Binary lama gagal di Java 11+ karena module tersebut removed dari JDK.

Contoh lain:

```text
NoSuchMethodError
NoSuchFieldError
IncompatibleClassChangeError
UnsupportedClassVersionError
```

## 2.3 Behavioral compatibility

Behavioral compatibility berarti program masih berperilaku sama saat runtime.

Ini paling sulit.

Contoh behavioral issue:

- date/currency formatting berubah karena CLDR;
- default charset menjadi UTF-8;
- TLS algorithm disabled;
- GC behavior berubah;
- reflection access gagal;
- classloader type berubah;
- timeout behavior berubah karena library baru;
- serialization field order/format berubah;
- regex behavior berubah;
- file path handling berubah;
- performance berubah.

## 2.4 Dependency compatibility

Dependency compatibility berarti library/framework/plugin yang dipakai mendukung JDK target.

Contoh:

- Spring Boot versi lama tidak support Java 25;
- Maven plugin lama gagal dengan JDK 25;
- Mockito/Byte Buddy lama gagal karena class file version baru;
- Lombok lama gagal karena compiler internal berubah;
- Hibernate lama gagal karena Jakarta/JPA mismatch;
- old JDBC driver tidak support TLS/security default baru.

## 2.5 Toolchain compatibility

Toolchain:

- Maven/Gradle;
- compiler plugin;
- test plugin;
- JaCoCo;
- Checkstyle/SpotBugs/PMD;
- Sonar scanner;
- Docker base image;
- IDE;
- CI agent;
- deployment scripts.

Jangan hanya upgrade runtime. Build pipeline juga harus support JDK target.

## 2.6 Operational compatibility

Aplikasi bisa jalan lokal tapi gagal production karena:

- Docker base image berubah;
- memory sizing berubah;
- GC flag obsolete;
- APM agent incompatible;
- Kubernetes probe timing berubah karena startup;
- TLS truststore berbeda;
- container CPU detection berbeda;
- time zone data berubah.

## 2.7 Data compatibility

Data compatibility:

- serialized Java object;
- JSON schema;
- XML schema;
- database encoding;
- date/time format;
- message event schema;
- enum string names;
- BigDecimal precision;
- binary protocol.

Migrasi JDK tidak boleh diam-diam mengubah kontrak data.

---

# 3. Strategi Migrasi Besar: Big Bang vs Bertahap

## 3.1 Big bang

Big bang:

```text
Java 8 → Java 25 langsung
```

Kelebihan:

- cepat jika codebase kecil;
- tidak perlu intermediate releases;
- langsung target akhir;
- mengurangi effort temporary support.

Risiko:

- terlalu banyak perubahan sekaligus;
- root cause sulit diisolasi;
- dependency upgrade besar;
- framework migration menumpuk;
- production regression sulit dianalisis.

Cocok jika:

- service kecil;
- test coverage bagus;
- dependency sedikit;
- no legacy Java EE/CORBA/JAXB;
- no deep reflection/internal API;
- team migration-experienced.

## 3.2 Bertahap via LTS

Strategi umum:

```text
Java 8 → 11 → 17 → 21 → 25
```

Kelebihan:

- isolate breaking changes;
- dependency ecosystem lebih mudah;
- setiap step punya target jelas;
- troubleshooting lebih terarah;
- cocok untuk banyak service.

Risiko:

- effort lebih panjang;
- bisa ada intermediate code changes;
- perlu maintain temporary compatibility;
- pipeline harus support beberapa JDK.

## 3.3 Dua dimensi migrasi

Jangan campur semua sekaligus.

Pisahkan:

```text
Runtime JDK upgrade
Source language level upgrade
Framework upgrade
Dependency upgrade
Container/runtime tuning
Code modernization
```

Contoh strategi aman:

1. Upgrade dependency agar bisa jalan di Java 8 dan Java 11.
2. Jalankan aplikasi Java 8 bytecode di Java 11.
3. Compile dengan Java 11.
4. Upgrade framework major.
5. Jalankan di Java 17.
6. Compile Java 17.
7. Jalankan di Java 21.
8. Adopsi fitur Java 21 secara selektif.
9. Jalankan di Java 25.
10. Compile Java 25.
11. Adopsi fitur Java 25 hanya jika ada value dan stabil.

## 3.4 Jangan langsung modernisasi semua code

Migrasi dan modernisasi berbeda.

Migrasi:

```text
make it run correctly on new JDK
```

Modernisasi:

```text
use new language/library/runtime features
```

Urutan aman:

```text
migrate first
stabilize
measure
then modernize
```

Jangan ubah:

- Java version;
- Spring major version;
- persistence model;
- async model;
- container resource;
- domain refactor;
- API contract;

semua dalam satu release.

---

# 4. Inventory Awal: Apa yang Harus Dipetakan

## 4.1 Inventory aplikasi

Untuk setiap service/module:

```text
name
owner
runtime Java version
compile Java version
framework version
build tool version
deployment type
traffic criticality
SLA/SLO
dependencies
external integrations
database
message broker
batch/worker/REST
APM agents
container image
resource limits
test coverage
```

## 4.2 Inventory dependency

Generate dependency tree:

Maven:

```bash
mvn -q dependency:tree > dependency-tree.txt
```

Gradle:

```bash
./gradlew dependencies > dependencies.txt
./gradlew dependencyInsight --dependency <name>
```

Track:

- direct dependency;
- transitive dependency;
- version conflict;
- abandoned library;
- internal API usage;
- `javax.*` vs `jakarta.*`;
- bytecode manipulation library;
- logging bridge;
- JDBC driver;
- JAXB/JAX-WS;
- security/crypto provider;
- APM agent;
- annotation processor.

## 4.3 Inventory JDK internal API usage

Search:

```bash
grep -R "sun\." src/
grep -R "com.sun\." src/
grep -R "jdk\." src/
grep -R "setAccessible" src/
grep -R "Unsafe" src/
```

But static grep not enough. Use `jdeps`.

## 4.4 Inventory runtime flags

Collect:

```text
JAVA_OPTS
JAVA_TOOL_OPTIONS
MAVEN_OPTS
Gradle org.gradle.jvmargs
Docker ENTRYPOINT
Kubernetes env
systemd service
Helm values
Terraform/ECS config
```

Look for:

- removed GC flags;
- old PermGen flags;
- `-XX:+UseConcMarkSweepGC`;
- `-XX:MaxPermSize`;
- `-Xbootclasspath`;
- `--illegal-access`;
- `-Dfile.encoding`;
- `-Djava.locale.providers`;
- `-Djavax.net.ssl.trustStore`;
- `-Djava.security.manager`;
- old logging flags;
- old debug flags.

## 4.5 Inventory Java EE/Jakarta usage

Search:

```text
javax.xml.bind
javax.xml.ws
javax.annotation
javax.activation
javax.transaction
javax.persistence
javax.servlet
javax.validation
```

Important distinction:

- Java SE removed some Java EE/CORBA modules from JDK 11.
- Jakarta EE ecosystem changed package namespace from `javax.*` to `jakarta.*` for many enterprise APIs.
- Not all `javax.*` disappeared from Java SE. Example: `javax.crypto`, `javax.net`, `javax.sql` are still Java SE packages.

Do not do blind global replace `javax` → `jakarta`.

## 4.6 Inventory test and quality gates

List:

- unit tests;
- integration tests;
- contract tests;
- e2e tests;
- performance tests;
- mutation tests;
- static analysis;
- dependency scanning;
- container scanning;
- SAST;
- DAST;
- smoke tests.

Migration without test coverage is risk multiplication.

---

# 5. Tooling Wajib Migrasi

## 5.1 `java -version` and `javac -version`

Obvious but essential.

```bash
java -version
javac -version
```

Check in:

- local;
- CI;
- Docker build;
- runtime container;
- production node if relevant.

## 5.2 `jdeps`

`jdeps` analyzes class dependencies.

Useful commands:

```bash
jdeps --multi-release 25 --jdk-internals target/app.jar
```

Shows JDK internal API usage.

```bash
jdeps --multi-release 25 --recursive --summary target/app.jar
```

Summarize module/package dependencies.

```bash
jdeps --generate-module-info generated-modules target/libs/*.jar
```

For module migration exploration.

## 5.3 `jdeprscan`

`jdeprscan` detects use of deprecated APIs.

```bash
jdeprscan --release 25 --for-removal target/app.jar
```

Or for classes:

```bash
jdeprscan --release 25 --for-removal --class-path target/classes com.example.Main
```

Use it to prioritize APIs marked for removal.

## 5.4 Build tool enforcer

Maven Enforcer:

- require Java version;
- ban duplicate classes;
- dependency convergence;
- require Maven version;
- ban snapshots.

Gradle:

- toolchains;
- dependency locking;
- version catalogs;
- constraints;
- resolution strategy;
- dependency verification.

## 5.5 Revapi / japicmp

For libraries, check binary compatibility.

Use if you publish internal libraries consumed by many services.

## 5.6 OpenRewrite

OpenRewrite can automate many source migrations:

- Java version modernization;
- Spring Boot migration;
- Jakarta namespace migration;
- deprecated API replacement;
- build file updates.

Use automation, but review diffs.

## 5.7 Error Prone / SpotBugs / Sonar

Static analysis helps catch:

- risky APIs;
- concurrency bugs;
- nullness;
- deprecated use;
- resource leaks;
- security issues.

## 5.8 JFR and GC logs

Performance migration needs runtime evidence.

Enable:

```bash
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

JFR:

```bash
-XX:StartFlightRecording=filename=app.jfr,settings=profile,dumponexit=true,maxsize=256m
```

## 5.9 Dependency vulnerability scanner

Use:

- OWASP Dependency-Check;
- Snyk;
- GitHub Dependabot;
- Maven/Gradle dependency verification;
- vendor-specific scanner.

Migrasi JDK sering bersamaan dengan dependency upgrade, jadi security scan penting.

---

# 6. Baseline Build dan Test Strategy

## 6.1 Baseline sebelum upgrade

Sebelum menyentuh versi Java, capture baseline.

```text
current Java version
current dependency tree
current build time
current test result
current startup time
current memory usage
current p95/p99 latency
current throughput
current GC logs
current container resource
current error rate
```

Tanpa baseline, kamu tidak tahu apakah migrasi memperbaiki atau merusak.

## 6.2 Test matrix

Minimal:

| Stage | Runtime JDK | Compile JDK | Source target |
|---|---:|---:|---:|
| baseline | 8 | 8 | 8 |
| run-on-new | 11 | 8/11 | 8 |
| compile-new | 11 | 11 | 11 or 8 via `--release` |
| next | 17 | 17 | 17 |
| next | 21 | 21 | 21 |
| final | 25 | 25 | 25 |

Not all projects need all combinations, but the mental model matters:

```text
running on JDK X
compiling with JDK X
using language level X
are different decisions
```

## 6.3 Compile with `--release`

Prefer:

```bash
javac --release 17
```

over:

```bash
-source 17 -target 17
```

Why? `--release` configures the compiler to use the correct platform API for that release.

Maven:

```xml
<properties>
  <maven.compiler.release>25</maven.compiler.release>
</properties>
```

Gradle:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}
```

## 6.4 Test categories

Migration should run:

- unit tests;
- integration tests;
- database migration tests;
- serialization compatibility tests;
- API contract tests;
- message schema tests;
- security tests;
- performance smoke tests;
- startup/shutdown tests;
- container smoke tests;
- rollback smoke tests.

## 6.5 Golden output tests

For behavior-sensitive areas:

- date formatting;
- currency formatting;
- sorting/collation;
- JSON/XML output;
- error response shape;
- event schema;
- serialized object;
- report output;
- PDF/CSV generation;
- regex matching.

Save golden outputs from Java 8 and compare on Java 25.

## 6.6 Migration branch strategy

Options:

### Long-lived migration branch

Pros:

- isolated work.

Cons:

- drift from main;
- painful merge;
- delayed feedback.

### Trunk-based incremental

Pros:

- small safe changes;
- continuous integration;
- less drift.

Cons:

- needs feature flags/compatibility;
- discipline required.

For large microservice estates, prefer:

```text
small incremental PRs + compatibility changes merged continuously
```

---

# 7. Java 8 → Java 11

Java 11 is often the hardest first jump from Java 8 because Java 9 modularization changes are included.

## 7.1 Key changes

Major concerns:

- Java Platform Module System introduced in Java 9;
- modular runtime image;
- `rt.jar` and `tools.jar` removed;
- JRE image layout changed;
- Java EE and CORBA modules removed in Java 11;
- application classloader no longer `URLClassLoader`;
- extension/endorsed mechanisms removed;
- Nashorn still present in 11 but deprecated for removal later;
- old internal APIs more restricted;
- new version string scheme;
- GC defaults differ;
- TLS/security changes;
- `var` available from Java 10;
- HTTP Client standardized in Java 11.

## 7.2 Java EE and CORBA modules removed

If Java 8 code uses:

```java
javax.xml.bind.JAXBContext
javax.xml.ws.Service
javax.annotation.Generated
javax.activation.DataHandler
org.omg.CORBA.*
```

it may fail on Java 11 because modules such as JAXB/JAX-WS/CORBA were removed from the JDK.

Typical error:

```text
java.lang.NoClassDefFoundError: javax/xml/bind/JAXBContext
```

Fix options:

- add explicit dependencies from Maven Central;
- replace with standard Java SE alternatives;
- remove obsolete usage;
- migrate to Jakarta libraries if framework version requires it.

Example JAXB dependency direction depends on project generation:

For old `javax` stack:

```xml
<dependency>
  <groupId>javax.xml.bind</groupId>
  <artifactId>jaxb-api</artifactId>
  <version>2.x.x</version>
</dependency>
```

For Jakarta stack:

```xml
<dependency>
  <groupId>jakarta.xml.bind</groupId>
  <artifactId>jakarta.xml.bind-api</artifactId>
  <version>4.x.x</version>
</dependency>
```

Do not mix randomly. Match framework ecosystem.

## 7.3 `rt.jar` and `tools.jar` removal

Old code/tooling may do:

```java
System.getProperty("java.home") + "/lib/rt.jar"
```

or depend on:

```text
tools.jar
```

This is broken in modular JDK.

Fix:

- use supported APIs;
- update tools/plugins;
- use `ToolProvider` or compiler APIs correctly;
- do not enumerate JDK classes through `rt.jar`;
- use `jrt:/` filesystem/resource handling if needed.

## 7.4 ClassLoader no longer URLClassLoader

Old code:

```java
URLClassLoader cl = (URLClassLoader) ClassLoader.getSystemClassLoader();
```

may fail.

Fix:

- avoid casting system classloader;
- use classpath from system property if truly needed;
- use proper plugin classloader;
- use resource APIs;
- use ServiceLoader.

## 7.5 Extension and endorsed mechanism removed

Old:

```text
$JAVA_HOME/lib/ext
-Djava.ext.dirs
$JAVA_HOME/lib/endorsed
-Djava.endorsed.dirs
```

No longer supported.

Fix:

```text
put dependencies explicitly on classpath/module path
```

## 7.6 Source issue: underscore identifier

Code like:

```java
Object _ = something;
```

must be renamed.

## 7.7 Build tool changes

Ensure:

- Maven version supports Java 11;
- Gradle version supports Java 11;
- Surefire/Failsafe supports Java 11;
- JaCoCo supports Java 11 bytecode;
- Lombok supports Java 11 compiler internals;
- Byte Buddy/Mockito supports Java 11.

## 7.8 GC migration

Java 8 default GC often Parallel GC. Java 9+ default became G1 in many server configurations.

If you see latency/throughput shift, check GC logs.

Don't immediately force old GC. First measure.

## 7.9 Java 8 → 11 checklist

- [ ] Remove dependency on JDK-provided JAXB/JAX-WS/CORBA.
- [ ] Remove `rt.jar`/`tools.jar` assumption.
- [ ] Remove `URLClassLoader` system classloader cast.
- [ ] Remove extension/endorsed mechanism.
- [ ] Rename `_` identifiers.
- [ ] Update build tool/plugins.
- [ ] Run `jdeps --jdk-internals`.
- [ ] Add missing dependencies explicitly.
- [ ] Run behavior tests for date/locale/security.
- [ ] Capture GC/performance baseline.

---

# 8. Java 11 → Java 17

Java 17 is a major LTS and a common target for Spring Boot 3 / Jakarta-era applications.

## 8.1 Key changes

Important concerns:

- strong encapsulation of JDK internals by default;
- `--illegal-access` obsolete/no longer opens internals;
- records finalized in Java 16;
- sealed classes finalized in Java 17;
- pattern matching for `instanceof` finalized in Java 16;
- text blocks finalized in Java 15;
- Nashorn removed in Java 15;
- RMI Activation removed in Java 17;
- Applet API deprecated for removal;
- finalization deprecated for removal in Java 18, but plan early;
- old crypto/root certificates/elliptic curves changes;
- CMS GC removed in Java 14.

## 8.2 Strong encapsulation

This is often the biggest 11 → 17 issue.

Error:

```text
java.lang.reflect.InaccessibleObjectException:
Unable to make field private ... accessible:
module java.base does not "opens java.lang" to unnamed module
```

Root cause:

- library/framework reflects into JDK internals;
- old versions of mocking, serialization, ORM, APM, reflection utilities.

Fix order:

1. Upgrade library/tool first.
2. Remove internal API usage.
3. Use standard replacement.
4. Only as temporary workaround, add `--add-opens`/`--add-exports`.
5. Track every workaround with owner/removal date.

Example temporary workaround:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
```

Do not scatter this blindly into production without understanding why.

## 8.3 `--illegal-access` no longer solves it

In JDK 9–16, `--illegal-access` helped migration by relaxing illegal reflection. In JDK 17, it no longer provides the same escape hatch.

If your migration plan says:

```bash
--illegal-access=permit
```

it is outdated.

## 8.4 Removed Nashorn

If Java 11 app uses Nashorn:

```java
new ScriptEngineManager().getEngineByName("nashorn")
```

it fails on Java 15+.

Fix:

- GraalJS as dependency/runtime;
- another JS engine;
- remove scripting;
- externalize script execution.

## 8.5 Removed CMS GC

If runtime flags include:

```bash
-XX:+UseConcMarkSweepGC
```

Java 14+ will fail.

Replace strategy:

- use G1 default;
- consider ZGC/Shenandoah for low pause;
- re-baseline GC performance;
- remove obsolete CMS tuning flags.

## 8.6 Modern language features available

Java 17 gives stable:

- records;
- sealed classes;
- text blocks;
- pattern matching for `instanceof`;
- switch expressions.

But migration should not immediately rewrite all code.

Modernize selectively:

- DTO/value objects to records;
- domain state/errors to sealed types;
- multiline SQL/JSON tests to text blocks;
- type checks to pattern matching.

## 8.7 Spring Boot concern

Common enterprise path:

```text
Java 8 + Spring Boot 2.x
  → Java 11/17 + Spring Boot 2.7
  → Java 17 + Spring Boot 3.x
```

Spring Boot 3 requires Jakarta namespace migration and Java 17 baseline. Do not mix this with JDK migration casually.

## 8.8 Java 11 → 17 checklist

- [ ] Upgrade reflection-heavy libraries.
- [ ] Remove/track `--add-opens` workarounds.
- [ ] Remove `--illegal-access`.
- [ ] Replace Nashorn if used.
- [ ] Remove CMS GC flags.
- [ ] Update test libraries and APM agent.
- [ ] Run strong encapsulation tests.
- [ ] Run serialization tests.
- [ ] Consider records/sealed only after stable migration.

---

# 9. Java 17 → Java 21

Java 21 is a major LTS with huge language/runtime improvements.

## 9.1 Key changes

Important additions:

- virtual threads finalized;
- sequenced collections;
- record patterns;
- pattern matching for switch;
- generational ZGC available;
- string templates preview in 21 but later withdrawn, so do not adopt as stable;
- unnamed patterns/variables preview;
- structured concurrency preview;
- scoped values preview;
- foreign function & memory preview.

## 9.2 Virtual threads

Virtual threads are stable in Java 21.

They are useful for blocking I/O concurrency, but not automatic performance magic.

Migration strategy:

1. Do not convert everything at once.
2. Identify blocking I/O thread pools.
3. Check framework support.
4. Add concurrency limits for downstream resources.
5. Test ThreadLocal usage.
6. Monitor virtual thread pinning/parking with JFR.
7. Keep database pool bounded.

Bad migration:

```java
Executors.newVirtualThreadPerTaskExecutor()
```

with unbounded DB calls and no bulkhead.

Good migration:

```java
virtual threads + bounded DB pool + semaphore/rate limit + timeout
```

## 9.3 Sequenced collections

Java 21 adds a uniform API for collections with encounter order:

- `SequencedCollection`;
- `SequencedSet`;
- `SequencedMap`.

Migration opportunity:

- replace ad-hoc first/last handling;
- use reversed views where appropriate;
- simplify ordered maps/sets.

But check API compatibility if your library supports older Java versions.

## 9.4 Pattern matching and records

Java 21 gives more expressive domain modeling.

Good modernization targets:

- command/event sealed hierarchy;
- domain errors;
- lifecycle states;
- DTO deconstruction;
- switch exhaustiveness.

Avoid turning every branch into complex nested pattern matching if readability suffers.

## 9.5 Security Manager

By the Java 21 era, Security Manager is already deprecated for removal. If your application still depends on Security Manager sandboxing, design a replacement architecture:

- OS/container sandbox;
- process isolation;
- Kubernetes security policy;
- classloader isolation is not sufficient;
- seccomp/AppArmor where needed;
- separate worker process.

In JDK 24+, Security Manager is permanently disabled.

## 9.6 Java 17 → 21 checklist

- [ ] Upgrade framework/library to Java 21-supported versions.
- [ ] Test virtual thread support before adoption.
- [ ] Review ThreadLocal usage.
- [ ] Review DB/downstream concurrency limits.
- [ ] Do not adopt preview features in production unless policy permits.
- [ ] Avoid string templates because they were preview and later withdrawn.
- [ ] Use language features for targeted refactors only.
- [ ] Update performance baseline.

---

# 10. Java 21 → Java 25

Java 25 is the next LTS after Java 21 for most vendors.

## 10.1 Key changes from JDK 21 to JDK 25

Important areas:

- JFR improvements: cooperative sampling, CPU-time profiling experimental, method timing/tracing;
- GC/runtime improvements: generational Shenandoah, compact object headers, ZGC non-generational mode removed earlier in 24;
- AOT cache direction: class loading/linking, method profiling, command-line ergonomics;
- language features: module import declarations, compact source files/instance main methods, flexible constructor bodies;
- Class-File API;
- Foreign Function & Memory API finalized in JDK 22;
- KDF API finalized in Java 25;
- PEM encodings preview;
- Vector API still incubator;
- structured concurrency still preview;
- scoped values final in Java 25;
- primitive patterns preview;
- removal of experimental Graal JIT in JDK 25;
- old JMX properties and some APIs/options removed/deprecated;
- continued warnings/deprecation around unsafe/native access.

## 10.2 Do not confuse JDK 25 with Java 26

Pada 12 Juni 2026, Java 26 sudah ada, tetapi target materi ini Java 25. Untuk migrasi enterprise, Java 25 tetap penting karena merupakan LTS target dari banyak vendor.

## 10.3 Java 25 removals/deprecations to review

Review:

- removed experimental Graal JIT;
- removed/changed old JMX system properties;
- socket constructors behavior for datagram case;
- deprecated VFORK launch mechanism;
- deprecated `UseCompressedClassPointers`;
- removed old root certificates;
- SunPKCS11 PBE-related SecretKeyFactory implementations removed;
- deprecated permission classes due to Security Manager removal;
- old options from earlier releases already removed/deprecated.

If your system uses:

- JMX compatibility hacks;
- custom security policy;
- old crypto provider behavior;
- Graal JIT experimental flag;
- old process launch mechanism;
- custom JDK build assumptions;

test carefully.

## 10.4 Scoped Values

Scoped values are finalized in Java 25 and can replace some `ThreadLocal` context patterns, especially with virtual threads.

Migration candidate:

- request context;
- trace/correlation context;
- security context;
- tenant context.

But use carefully:

- immutable context;
- lexical scope;
- avoid hiding domain dependencies;
- integrate with framework support.

## 10.5 AOT cache features

JDK 25 has AOT-related improvements.

Migration implication:

- possible startup improvements;
- useful for services with startup/cold start pressure;
- requires careful build/run pipeline;
- does not replace GraalVM native image;
- benchmark before adopting.

## 10.6 JFR enhancements

Java 25 improves observability. Migration opportunity:

- better profiling;
- method timing/tracing;
- CPU-time profiling;
- cooperative sampling.

Add JFR to migration acceptance:

```text
Can we profile service on Java 25 in staging/prod-like load?
Can we capture GC/allocation/thread events?
Can APM and JFR coexist?
```

## 10.7 Java 21 → 25 checklist

- [ ] Review JDK 25 release notes.
- [ ] Review removed/deprecated APIs/options.
- [ ] Update build/test tools for Java 25 class file version.
- [ ] Update Byte Buddy/Mockito/Lombok/APM agents.
- [ ] Re-test reflection/agents.
- [ ] Re-baseline GC/performance.
- [ ] Review Security Manager/permission usage.
- [ ] Review old crypto/root certificate assumptions.
- [ ] Remove experimental Graal JIT flags.
- [ ] Adopt Java 25 features selectively.

---

# 11. Migrasi Source Code

## 11.1 First rule: compile clean before modernizing

Goal awal:

```text
same code, new JDK, minimal changes
```

Do not simultaneously refactor architecture.

## 11.2 Replace removed/deprecated API

Use `jdeprscan`.

Example:

```bash
jdeprscan --release 25 --for-removal target/app.jar
```

Common replacements:

| Old | Replace |
|---|---|
| `javax.xml.bind.DatatypeConverter` for Base64 | `java.util.Base64` |
| `Thread.stop/suspend/resume` | interruption/cancellation/cooperative control |
| `finalize()` | `Cleaner`, try-with-resources, explicit close |
| `Runtime.runFinalizersOnExit` | remove |
| old `SecurityManager` sandbox | OS/container/process isolation |
| `sun.misc.Unsafe` memory access | VarHandle / FFM API |
| `new URL(...)` as validation | `URI` then convert carefully |

## 11.3 Internal API replacement

Common internal APIs:

```text
sun.misc.BASE64Encoder
sun.misc.Unsafe
sun.reflect.Reflection
com.sun.*
jdk.internal.*
```

Strategy:

1. identify usage;
2. find standard API;
3. update library if transitive;
4. add temporary `--add-exports/--add-opens` only if unavoidable;
5. remove workaround later.

## 11.4 Language modernization targets

After migration stable:

### Java 11+

- `var` local variable;
- `String.isBlank`, `strip`, `lines`;
- `Files.readString/writeString`;
- `HttpClient`.

### Java 17+

- records;
- sealed classes;
- pattern matching for `instanceof`;
- switch expressions;
- text blocks.

### Java 21+

- virtual threads;
- sequenced collections;
- record patterns;
- pattern matching switch.

### Java 25+

- module import declarations;
- flexible constructor bodies;
- compact source files for education/tools/scripts;
- scoped values;
- JFR enhancements;
- AOT cache experiments.

## 11.5 Modernization decision rule

Modernize if it:

- improves correctness;
- improves domain clarity;
- removes bug class;
- reduces boilerplate safely;
- improves testability;
- improves performance with evidence;
- aligns with team skill.

Do not modernize just because feature exists.

---

# 12. Migrasi Dependency

## 12.1 Dependency upgrade is often the real migration

Most Java 8 → 25 failures come from old dependencies.

Key classes of dependency:

- framework;
- bytecode manipulation;
- annotation processor;
- logging;
- JSON/XML;
- ORM;
- JDBC driver;
- test framework;
- APM agent;
- crypto provider;
- native library wrapper.

## 12.2 Bytecode manipulation libraries

Update:

- Byte Buddy;
- ASM;
- CGLIB;
- Javassist;
- Mockito;
- Hibernate;
- Spring;
- APM agents.

These libraries must understand new class file versions.

Symptoms if old:

```text
Unsupported class file major version
IllegalArgumentException: Unsupported class file major version 69
VerifyError
ClassFormatError
```

Java 25 class file major version is newer than Java 21/17/11. Tools must support it.

## 12.3 Annotation processors

Update:

- Lombok;
- MapStruct;
- QueryDSL;
- Immutables;
- AutoService;
- Dagger;
- custom processors.

Symptoms:

- compiler crash;
- internal compiler API error;
- generated source invalid;
- incremental build failure;
- annotation processor not discovered.

## 12.4 Logging

Ensure compatible:

- SLF4J 1.x vs 2.x;
- Logback version;
- Log4j2 version;
- bridges: jul-to-slf4j, jcl-over-slf4j, log4j-over-slf4j;
- avoid logging binding conflict.

## 12.5 JAXB/JAX-WS

If needed, add explicit dependency and choose namespace:

- legacy `javax.*`;
- Jakarta `jakarta.*`.

Match framework version.

## 12.6 JDBC drivers

Upgrade drivers for:

- TLS support;
- Java 25 support;
- database version;
- timezone/encoding;
- authentication mechanism;
- cloud IAM auth.

## 12.7 Dependency locking

After upgrade:

- lock versions;
- generate SBOM;
- scan vulnerabilities;
- document exceptions;
- avoid dynamic version ranges.

---

# 13. Migrasi Build Tool: Maven dan Gradle

## 13.1 Maven migration

Update:

- Maven runtime version;
- Maven Compiler Plugin;
- Surefire/Failsafe;
- Enforcer;
- JaCoCo;
- Shade plugin;
- Spring Boot plugin;
- dependency plugin;
- container plugin;
- SpotBugs/Checkstyle/PMD.

Example:

```xml
<properties>
  <java.version>25</java.version>
  <maven.compiler.release>25</maven.compiler.release>
</properties>
```

Compiler plugin:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <release>${java.version}</release>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

## 13.2 Maven toolchains

Use Maven Toolchains if CI has multiple JDKs.

```xml
<toolchain>
  <type>jdk</type>
  <provides>
    <version>25</version>
  </provides>
  <configuration>
    <jdkHome>/path/to/jdk-25</jdkHome>
  </configuration>
</toolchain>
```

## 13.3 Gradle migration

Use Java toolchains:

```kotlin
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}
```

Set release:

```kotlin
tasks.withType<JavaCompile>().configureEach {
    options.release.set(25)
    options.compilerArgs.add("-parameters")
}
```

## 13.4 Build cache issues

After JDK upgrade:

- clear CI cache once;
- clear Gradle daemon;
- clear annotation processor cache;
- rebuild Docker base layer;
- check generated sources.

## 13.5 Multi-module builds

Upgrade order:

1. parent/BOM/build plugins;
2. internal libraries;
3. shared test fixtures;
4. leaf services;
5. integration apps.

Avoid circular upgrade dependencies.

---

# 14. Migrasi Framework: Spring, Jakarta, Hibernate, Jackson, Testing

## 14.1 Spring Boot path

Common path:

```text
Spring Boot 1.x/2.0/2.1 + Java 8
  → Spring Boot 2.7 on Java 8/11/17
  → Spring Boot 3.x/4.x on Java 17+
  → Java 21/25 runtime after framework supports it
```

Do not attempt:

```text
Spring Boot 1.x directly to Java 25
```

unless service is very small and dependencies are manually controlled.

## 14.2 Spring Boot 3 and Jakarta

Spring Boot 3 moved to Jakarta EE namespaces for many APIs.

Example:

```java
javax.servlet.http.HttpServletRequest
```

becomes:

```java
jakarta.servlet.http.HttpServletRequest
```

But do not replace all `javax`.

Still Java SE:

```java
javax.crypto
javax.net.ssl
javax.sql
javax.management
```

## 14.3 Hibernate/JPA

Hibernate 5 vs 6/7 can change:

- query parsing;
- type mapping;
- dialect;
- naming strategy;
- lazy loading behavior;
- sequence allocation;
- date/time mapping;
- pagination SQL;
- bytecode enhancement;
- Jakarta persistence namespace.

Run integration tests with real database.

## 14.4 Jackson

Upgrade Jackson for:

- Java records;
- Java time module;
- sealed/polymorphic support;
- security fixes;
- class file/runtime compatibility.

Test:

- JSON shape;
- unknown fields;
- date/time format;
- enum format;
- polymorphism;
- null handling.

## 14.5 Testing stack

Upgrade:

- JUnit;
- Mockito;
- AssertJ;
- Testcontainers;
- WireMock;
- Awaitility;
- JaCoCo.

Mockito/Byte Buddy must support target JDK class file version.

## 14.6 APM agent

Upgrade APM/OpenTelemetry agent and test:

- app startup;
- instrumentation compatibility;
- overhead;
- context propagation;
- virtual threads if adopted;
- module access.

---

# 15. Migrasi JPMS, Classpath, Module Path, dan Strong Encapsulation

## 15.1 You do not need to modularize immediately

A Java 8 classpath application can run on Java 25 classpath.

JPMS migration is optional unless:

- you want strong module boundaries;
- you build custom runtime with `jlink`;
- library consumers need modules;
- security/encapsulation policy requires it.

## 15.2 Classpath first strategy

For many enterprise apps:

```text
keep classpath
remove internal JDK dependencies
upgrade libraries
make runtime work
only later consider module-info.java
```

## 15.3 Module path pitfalls

- split packages;
- automatic module names;
- reflection requires opens;
- service loader config;
- resource loading differences;
- test framework module access;
- annotation processing.

## 15.4 Strong encapsulation issue

If code reflects into JDK internals:

```text
InaccessibleObjectException
```

Don't immediately add broad:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
```

Instead:

1. identify owner library;
2. upgrade it;
3. replace usage;
4. add narrow workaround if necessary.

## 15.5 Temporary flags register

If you must use flags:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
--add-exports java.base/jdk.internal.misc=ALL-UNNAMED
```

Create register:

| Flag | Why needed | Owner | Library | Removal plan | Deadline |
|---|---|---|---|---|---|

No owner = no flag.

---

# 16. Migrasi Internal API dan Reflection

## 16.1 `sun.misc.Unsafe`

`Unsafe` is still present, but many memory-access methods are unsupported and deprecated/warned in recent JDKs.

Replacement:

| Unsafe use | Replacement |
|---|---|
| atomic/volatile field access | VarHandle |
| memory fence | VarHandle/fence APIs |
| off-heap memory | Foreign Function & Memory API |
| object allocation hacks | redesign / framework update |
| park/unpark | LockSupport |

Usually the fix is not in your code but in old libraries. Upgrade first.

## 16.2 Reflection into JDK classes

Old libraries may access:

```text
java.lang.String.value
java.lang.ClassLoader.defineClass
java.util.Collections internals
```

Modern JDK blocks this by default.

Upgrade library. Temporary `--add-opens` only if unavoidable.

## 16.3 Reflection into your own modules

If you modularize, open packages intentionally:

```java
opens com.example.dto to com.fasterxml.jackson.databind;
opens com.example.entity to org.hibernate.orm.core;
```

Do not open everything globally unless you accept the trade-off.

## 16.4 Agents and attach

Dynamic agent loading has become more restricted/warned in modern JDKs. Ensure:

- approved agents;
- startup `-javaagent` preferred for production;
- dynamic attach policy understood;
- observability agent compatible.

---

# 17. Migrasi Runtime Flags, GC, Memory, dan Container

## 17.1 Remove obsolete flags

Common obsolete/removed flags:

```text
-XX:MaxPermSize
-XX:PermSize
-XX:+UseConcMarkSweepGC
-XX:+CMSClassUnloadingEnabled
-Xincgc
-XX:+UseParNewGC
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-XX:+PrintGCTimeStamps
```

Use unified logging:

```bash
-Xlog:gc*:file=gc.log:time,uptime,level,tags
```

## 17.2 GC default differences

Migration can change:

- default collector;
- pause behavior;
- heap ergonomics;
- container awareness;
- string dedup behavior;
- region size;
- ZGC/Shenandoah availability.

Do not assume same heap setting yields same behavior.

## 17.3 Container memory

Modern JVM is container-aware, but still size explicitly.

Review:

```text
heap
metaspace
direct memory
thread stacks
code cache
JIT/GC native
APM agent
```

If old service had:

```bash
-Xmx1024m
```

and container limit:

```text
1024Mi
```

it was already risky. Java 25 won't fix that automatically.

## 17.4 CPU detection

JVM uses available processors for:

- GC threads;
- ForkJoin common pool;
- JIT;
- parallel streams;
- virtual thread scheduler.

In Kubernetes CPU quota/limit, consider:

```bash
-XX:ActiveProcessorCount=...
```

if ergonomics don't match desired behavior.

## 17.5 Performance rebaseline

For each migration stage capture:

- startup time;
- RSS;
- heap used;
- allocation rate;
- GC pause;
- CPU;
- p95/p99 latency;
- throughput;
- error rate;
- DB pool;
- thread count;
- container throttling.

---

# 18. Migrasi Security dan Cryptography

## 18.1 TLS/certificate changes

New JDKs update:

- root certificates;
- disabled algorithms;
- TLS defaults;
- crypto provider behavior;
- signature algorithms.

Test:

- outbound HTTPS;
- mTLS;
- LDAP/LDAPS;
- database TLS;
- SFTP/FTPS;
- signed XML/JAR;
- old partner endpoints.

## 18.2 Security Manager

If application uses:

```java
System.setSecurityManager(...)
-Djava.security.manager
policy files
```

you need redesign. In modern JDKs, Security Manager is deprecated/disabled/removed path. JDK 24+ permanently disables it.

Use:

- process isolation;
- container sandbox;
- OS permissions;
- Kubernetes security context;
- network policy;
- classloader separation only as helper, not security boundary.

## 18.3 Crypto provider changes

If using:

- BouncyCastle;
- SunPKCS11;
- HSM;
- FIPS mode;
- custom provider;
- old PBE algorithms;
- XML signature;

test thoroughly.

## 18.4 Java 25 crypto opportunity

Java 25 includes KDF API finalization and PEM preview. Adopt only if needed and policy permits preview features.

---

# 19. Migrasi Internationalization, Locale, Charset, dan Timezone

## 19.1 Default charset UTF-8

JDK 18+ default charset is UTF-8 for standard Java APIs.

If Java 8/11 app relied on Windows codepage:

```text
windows-1252
windows-31j
```

behavior may change.

Risk areas:

- file read/write without charset;
- CSV;
- fixed-width files;
- email;
- legacy integration;
- database import/export;
- report generation.

Fix:

```java
Files.readString(path, StandardCharsets.UTF_8);
new InputStreamReader(input, StandardCharsets.ISO_8859_1);
```

Be explicit.

## 19.2 CLDR locale data

From JDK 9+, CLDR locale data is default. Legacy locale data was removed in JDK 23.

Risk areas:

- date format;
- month names;
- currency symbol/name;
- number formatting;
- language/country names;
- collation/sorting;
- report output;
- golden tests.

Use explicit patterns for machine contracts:

```java
DateTimeFormatter.ISO_OFFSET_DATE_TIME
```

Do not rely on locale default for API payload.

## 19.3 Timezone data

JDK updates IANA timezone data.

Risk areas:

- schedule;
- cut-off time;
- regulatory deadlines;
- report periods;
- historical timezone conversion.

Test timezone-sensitive cases.

## 19.4 Indonesian locale detail

If your app cares about Indonesian language code, be aware old/new ISO code behavior has changed over releases. Avoid relying on deprecated old ISO code switches. Use standard locale handling and tests.

---

# 20. Migrasi Serialization dan Data Compatibility

## 20.1 Java native serialization

If you serialize Java objects across versions:

```java
Serializable
serialVersionUID
```

Migration risk:

- class shape changes;
- JDK class serialization changes;
- security filters;
- removed classes;
- classloader changes.

Prefer external schema-based formats for long-lived data:

- JSON with schema/version;
- Avro;
- Protobuf;
- database schema;
- event versioning.

## 20.2 JSON

Test:

- field names;
- null inclusion;
- unknown fields;
- enum names;
- date/time;
- BigDecimal;
- polymorphic type;
- record serialization;
- Java time module.

## 20.3 XML

Risk:

- JAXB removed from JDK 11;
- XML security updates;
- namespace handling;
- schema validation;
- XXE protection;
- signed XML algorithms.

## 20.4 Message event schema

For Kafka/event migration:

- don't change event schema silently;
- include schema version;
- maintain consumer compatibility;
- test old producer/new consumer and new producer/old consumer;
- handle enum additions;
- preserve idempotency keys.

## 20.5 Database compatibility

Migration may change:

- timestamp precision;
- timezone handling;
- driver behavior;
- LOB handling;
- Boolean/UUID mapping;
- SQL dialect;
- transaction isolation behavior in framework update.

Run integration tests on real DB version.

---

# 21. Migrasi Concurrency: Platform Thread, CompletableFuture, Virtual Thread

## 21.1 Keep old concurrency first

Do not rewrite concurrency during baseline migration.

First:

```text
make old behavior correct on new JDK
```

Then modernize.

## 21.2 CompletableFuture traps

Check:

- common pool usage;
- blocking in common pool;
- exception handling;
- timeout;
- cancellation;
- executor sizing.

JDK upgrade may change scheduler/CPU ergonomics enough to expose existing issues.

## 21.3 Virtual threads adoption

Migration candidate:

- blocking REST controllers;
- blocking HTTP clients;
- blocking DB calls;
- per-request tasks;
- high concurrency wait-heavy services.

Not candidate:

- CPU-bound processing;
- unbounded fan-out;
- tight low-level loops;
- code with heavy ThreadLocal per task;
- code blocking under synchronized in problematic patterns.

## 21.4 ThreadLocal audit

Search:

```bash
grep -R "ThreadLocal" src/
```

Review:

- security context;
- tenant context;
- trace context;
- transaction context;
- formatter caches;
- large per-thread buffers.

For Java 25, consider scoped values for immutable request context if framework stack supports it.

## 21.5 Structured concurrency

Still preview in Java 25. Do not use in production unless preview policy is explicit.

---

# 22. Migrasi Observability dan Diagnostics

## 22.1 Logging

Test:

- logging framework compatibility;
- MDC propagation;
- JSON encoder;
- logback/log4j config;
- async appender;
- file path;
- stdout in container.

## 22.2 Metrics

Check:

- Micrometer version;
- JVM metrics names;
- GC metrics;
- virtual thread metrics if relevant;
- pool metrics;
- Prometheus endpoint.

## 22.3 Tracing

Check:

- OpenTelemetry/agent compatibility;
- context propagation;
- executor instrumentation;
- virtual thread instrumentation;
- HTTP client/server instrumentation;
- Kafka/JDBC instrumentation.

## 22.4 JFR

Add JFR to migration toolkit:

```bash
jcmd <pid> JFR.start name=migration settings=profile duration=120s filename=migration.jfr
```

Check:

- startup profile;
- allocation;
- GC;
- lock contention;
- socket I/O;
- method profiling in Java 25.

## 22.5 Diagnostic tools in container

If production image is distroless/JRE-only, you may lack:

- `jcmd`;
- `jstack`;
- `jmap`;
- shell.

Decide:

- debug image variant;
- ephemeral container;
- sidecar tooling;
- JFR startup recording;
- remote diagnostics policy.

---

# 23. Performance Regression Strategy

## 23.1 Compare same workload

Before/after must use:

- same dataset;
- same traffic shape;
- same DB;
- same container limits;
- same downstream latency;
- same warmup;
- same JVM flags unless intentionally changed.

## 23.2 Migration performance metrics

Measure:

- startup time;
- steady-state p50/p95/p99;
- max latency;
- throughput;
- CPU;
- RSS;
- heap max/used/committed;
- allocation rate;
- GC pause;
- GC CPU;
- thread count;
- DB pool active/pending;
- error rate.

## 23.3 Warmup matters

JDK upgrade may change JIT/warmup behavior.

Run:

- cold test;
- warmed test;
- rollout simulation;
- pod age latency comparison.

## 23.4 Compare GC logs

Look for:

- collector changes;
- pause frequency;
- humongous allocations;
- promotion;
- old gen occupancy;
- allocation rate;
- concurrent cycle.

## 23.5 Performance acceptance

Define before:

```text
p95 may not regress more than 10%
p99 may not regress more than 15%
RSS must remain under 80% of container limit
startup must remain under readiness budget
error rate unchanged
```

---

# 24. CI/CD dan Release Strategy

## 24.1 CI JDK matrix

During migration:

```yaml
JDK 8  - baseline branch
JDK 11 - migration stage
JDK 17 - framework stage
JDK 21 - modernization stage
JDK 25 - final target
```

Eventually remove old JDK jobs to reduce maintenance.

## 24.2 Build image

Update:

- Docker base image;
- buildpack builder;
- Maven/Gradle image;
- CI agent;
- scanner image;
- deployment runtime image.

## 24.3 Artifact versioning

Do not overwrite old artifacts.

Use:

```text
service:1.2.3-java8
service:1.2.3-java25
```

or metadata labels.

## 24.4 Deployment strategy

Use:

- canary;
- blue/green;
- rolling with low maxUnavailable;
- shadow traffic if possible;
- internal beta environment;
- production subset.

## 24.5 Observability gates

Before promoting:

- startup success;
- health checks;
- p95/p99;
- error rate;
- GC;
- memory;
- logs;
- tracing;
- DB pool;
- message lag.

## 24.6 Rollback

Rollback must include:

- image rollback;
- config rollback;
- JVM flags rollback;
- DB migration rollback or forward-compatible schema;
- message schema compatibility;
- feature flags.

---

# 25. Rollback dan Dual Runtime Strategy

## 25.1 Rollback can be blocked by data/schema

If new version writes data old version can't read, rollback fails.

Examples:

- new enum value;
- new JSON field interpreted strictly;
- changed timestamp format;
- new DB column not nullable;
- event schema incompatible;
- serialized Java object class change.

## 25.2 Expand-contract database migration

Use:

1. expand schema compatible with old and new;
2. deploy new app writing both if needed;
3. backfill;
4. switch reads;
5. remove old columns later.

## 25.3 Dual runtime

For critical systems:

```text
Java 8 service and Java 25 service run side-by-side
```

Possible strategies:

- canary by percentage;
- route by tenant;
- route by endpoint;
- shadow read-only traffic;
- compare outputs.

## 25.4 Feature flags

Use flags for:

- new virtual thread executor;
- new serialization path;
- new HTTP client;
- new GC flags;
- new domain path;
- new integration endpoint.

Feature flag must not become permanent technical debt.

---

# 26. Checklist Migrasi per Tahap

## 26.1 Before migration

- [ ] Inventory services.
- [ ] Dependency tree captured.
- [ ] Runtime flags captured.
- [ ] Test baseline green.
- [ ] Performance baseline captured.
- [ ] `jdeps` run.
- [ ] `jdeprscan` run.
- [ ] Java EE/Jakarta usage mapped.
- [ ] Internal API usage mapped.
- [ ] APM/test/tool support checked.
- [ ] Rollback strategy drafted.

## 26.2 Java 8 → 11

- [ ] Add removed Java EE dependencies explicitly.
- [ ] Remove `rt.jar/tools.jar` assumptions.
- [ ] Fix `URLClassLoader` assumptions.
- [ ] Remove extension/endorsed mechanisms.
- [ ] Update Maven/Gradle/plugins.
- [ ] Fix underscore identifiers.
- [ ] Check GC behavior.
- [ ] Run full test suite.

## 26.3 Java 11 → 17

- [ ] Resolve strong encapsulation issues.
- [ ] Remove `--illegal-access`.
- [ ] Upgrade reflection-heavy libraries.
- [ ] Replace Nashorn if used.
- [ ] Remove CMS flags.
- [ ] Prepare Spring Boot 3/Jakarta if needed.
- [ ] Rebaseline performance.

## 26.4 Java 17 → 21

- [ ] Upgrade to Java 21-supported framework versions.
- [ ] Test virtual thread only if adopting.
- [ ] Test sequenced collection impact if used.
- [ ] Avoid preview features unless policy allows.
- [ ] Rebaseline performance.
- [ ] Review Security Manager assumptions.

## 26.5 Java 21 → 25

- [ ] Review JDK 25 release notes.
- [ ] Update build/test/agent tools for Java 25.
- [ ] Review removals/deprecations.
- [ ] Test JFR/APM compatibility.
- [ ] Review Security Manager/permission deprecation.
- [ ] Remove Graal JIT experimental flags.
- [ ] Rebaseline GC/performance.
- [ ] Adopt Java 25 features selectively.

## 26.6 Final readiness

- [ ] No unexplained `--add-opens`.
- [ ] No unsupported internal API.
- [ ] No obsolete JVM flags.
- [ ] Tests green.
- [ ] Performance accepted.
- [ ] Security scan passed.
- [ ] Observability working.
- [ ] Rollback tested.
- [ ] Runbook updated.
- [ ] Team trained.

---

# 27. Common Failure Modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `NoClassDefFoundError: javax/xml/bind/...` | JAXB removed from JDK | add dependency/migrate Jakarta |
| `InaccessibleObjectException` | strong encapsulation | upgrade library or add narrow opens temporarily |
| `Unsupported class file major version` | old ASM/Byte Buddy/plugin | upgrade tool/library |
| VM fails on startup due to GC flag | removed GC option | remove/replace flags |
| `ClassCastException URLClassLoader` | system classloader changed | remove cast |
| date format changed | CLDR/default locale | explicit pattern/test |
| file encoding changed | UTF-8 default | explicit charset |
| TLS connection fails | disabled algorithm/cert | update cert/protocol/provider |
| tests fail with Mockito | old Byte Buddy/Mockito | upgrade testing stack |
| Lombok compile error | old Lombok | upgrade Lombok |
| app works locally, fails in Docker | base image/JDK mismatch | align build/runtime image |
| APM breaks startup | incompatible agent | upgrade/disable instrumentation |
| performance regression | GC/JIT/container/default changes | profile/rebaseline |
| rollback fails | data/schema incompatibility | expand-contract/schema compatibility |

---

# 28. Template Migration Plan

```markdown
# Java Migration Plan — <service-name>

## 1. Scope

Current:
- Runtime JDK:
- Compile JDK:
- Source level:
- Framework:
- Build tool:
- Deployment:

Target:
- Runtime JDK:
- Compile JDK:
- Source level:
- Framework:
- Deployment:

## 2. Owners

- Tech owner:
- QA owner:
- DevOps owner:
- Security owner:
- Product owner:

## 3. Inventory

- Dependency tree:
- JDK internal APIs:
- Removed/deprecated APIs:
- Runtime flags:
- Java EE/Jakarta usage:
- APM agents:
- Native libraries:
- Serialization formats:
- External integrations:

## 4. Risk Register

| Risk | Impact | Probability | Mitigation | Owner |
|---|---|---:|---|---|

## 5. Migration Stages

### Stage 1 — Dependency preparation
### Stage 2 — Run on JDK 11
### Stage 3 — Compile on JDK 11
### Stage 4 — Run/compile on JDK 17
### Stage 5 — Framework migration
### Stage 6 — Run/compile on JDK 21
### Stage 7 — Run/compile on JDK 25
### Stage 8 — Cleanup and modernization

## 6. Test Plan

- Unit:
- Integration:
- Contract:
- E2E:
- Performance:
- Security:
- Serialization:
- Rollback:

## 7. Performance Baseline

| Metric | Current | Target | Result |
|---|---:|---:|---:|

## 8. Rollout Plan

- Environment order:
- Canary strategy:
- Monitoring:
- Alert threshold:
- Rollback condition:

## 9. Rollback Plan

- Image rollback:
- Config rollback:
- DB rollback/compatibility:
- Message schema compatibility:
- Owner:

## 10. Completion Criteria

- [ ] Tests green
- [ ] Performance accepted
- [ ] No critical security issue
- [ ] Observability verified
- [ ] Rollback tested
- [ ] Documentation updated
```

---

# 29. Latihan Bertahap

## Latihan 1 — Analyze old JAR

Ambil aplikasi Java 8. Jalankan:

```bash
jdeps --jdk-internals app.jar
jdeprscan --release 25 --for-removal app.jar
```

Buat report:

- internal API;
- deprecated-for-removal API;
- removed module risk;
- dependency owner.

## Latihan 2 — JAXB removal

Buat Java 8 code memakai:

```java
javax.xml.bind.DatatypeConverter
```

Migrasikan ke:

```java
java.util.Base64
```

Lalu buat test untuk memastikan output sama.

## Latihan 3 — Strong encapsulation

Buat code reflection ke private field JDK class. Jalankan di Java 11 dan 17/25. Amati perbedaan.

Lalu perbaiki dengan API resmi.

## Latihan 4 — Charset migration

Buat file encoded Windows-1252 atau Windows-31J. Baca tanpa charset di Java 8 dan Java 25. Bandingkan.

Perbaiki dengan explicit charset.

## Latihan 5 — Locale migration

Format date/currency dengan locale tertentu. Bandingkan Java 8 vs 25.

Buat golden output test dengan explicit formatter.

## Latihan 6 — GC flag cleanup

Ambil old JVM flags dan klasifikasikan:

- still valid;
- deprecated;
- removed;
- should replace with unified logging;
- should remove.

## Latihan 7 — Spring Boot migration simulation

Ambil Spring Boot 2.7 app:

1. run Java 11;
2. run Java 17;
3. upgrade to Boot 3;
4. migrate `javax` → `jakarta` selectively;
5. run Java 21/25.

Document every failure.

## Latihan 8 — Performance rebaseline

Run load test on Java 17, 21, 25 with same workload.

Compare:

- p95/p99;
- CPU;
- memory;
- GC;
- startup.

## Latihan 9 — Agent compatibility

Run app with and without OpenTelemetry/APM agent on Java 25.

Compare:

- startup;
- errors;
- traces;
- overhead.

---

# 30. Mini Project: Java 8 Legacy Service ke Java 25

## 30.1 Goal

Bangun atau ambil service legacy kecil:

```text
legacy-case-service
```

Kondisi awal:

- Java 8;
- Maven old;
- Spring Boot 2.x or plain servlet;
- JAXB usage;
- old date formatting;
- reflection utility;
- old GC flags;
- JUnit 4;
- old Dockerfile.

Target:

- Java 25 runtime and compile;
- modern build tool;
- tests green;
- explicit dependencies;
- no unsupported internal JDK API;
- no obsolete flags;
- behavior compatibility documented;
- performance baseline done.

## 30.2 Features

Endpoint:

```text
POST /cases
GET /cases/{id}
POST /cases/{id}/close
```

Use:

- JSON serialization;
- date formatting;
- one XML/JAXB utility;
- one reflection utility;
- database or in-memory repository;
- logging;
- tests.

## 30.3 Migration tasks

1. Capture baseline on Java 8.
2. Run on Java 11.
3. Fix removed JAXB.
4. Update build plugins.
5. Run on Java 17.
6. Fix strong encapsulation.
7. Remove old flags.
8. Upgrade test stack.
9. Run on Java 21.
10. Run on Java 25.
11. Compile with `--release 25`.
12. Run load test.
13. Document differences.

## 30.4 Deliverables

```text
MIGRATION_PLAN.md
MIGRATION_REPORT.md
DEPENDENCY_TREE_BEFORE.txt
DEPENDENCY_TREE_AFTER.txt
JDEPS_REPORT.txt
JDEPRSCAN_REPORT.txt
GC_BASELINE_BEFORE.log
GC_BASELINE_AFTER.log
PERFORMANCE_REPORT.md
ROLLBACK_PLAN.md
```

## 30.5 Acceptance criteria

- all tests pass;
- no missing Java EE module;
- no illegal reflective access workaround without owner;
- no obsolete JVM flag;
- same API contract;
- no serialization breaking change;
- p95/p99 within accepted threshold;
- Docker image uses JDK/JRE 25;
- rollback documented.

---

# 31. Referensi Resmi

Referensi utama:

1. Oracle JDK Migration Guide, Release 25  
   https://docs.oracle.com/en/java/javase/25/migrate/index.html

2. Oracle JDK 25 Migration Guide — Preparing for Migration  
   https://docs.oracle.com/en/java/javase/25/migrate/preparing-migration.html

3. Oracle JDK 25 Migration Guide — Migrating from JDK 8 to Later JDK Releases  
   https://docs.oracle.com/en/java/javase/25/migrate/migrating-jdk-8-later-jdk-releases.html

4. Oracle JDK 25 Migration Guide — Removed APIs  
   https://docs.oracle.com/en/java/javase/25/migrate/removed-apis.html

5. Oracle JDK 25 Migration Guide — Removed Tools and Components  
   https://docs.oracle.com/en/java/javase/25/migrate/removed-tools-and-components.html

6. Oracle JDK 25 Release Notes  
   https://www.oracle.com/java/technologies/javase/25-relnote-issues.html

7. OpenJDK JDK 25 Project  
   https://openjdk.org/projects/jdk/25/

8. OpenJDK JEPs in JDK 25 integrated since JDK 21  
   https://openjdk.org/projects/jdk/25/jeps-since-jdk-21

9. Oracle Java SE 25 Language Changes Summary  
   https://docs.oracle.com/en/java/javase/25/language/java-language-changes-summary.html

10. JEP 320 — Remove the Java EE and CORBA Modules  
    https://openjdk.org/jeps/320

11. JEP 400 — UTF-8 by Default  
    https://openjdk.org/jeps/400

12. JEP 403 — Strongly Encapsulate JDK Internals  
    https://openjdk.org/jeps/403

13. JEP 431 — Sequenced Collections  
    https://openjdk.org/jeps/431

14. JEP 444 — Virtual Threads  
    https://openjdk.org/jeps/444

15. JEP 421 — Deprecate Finalization for Removal  
    https://openjdk.org/jeps/421

16. JEP 411 — Deprecate the Security Manager for Removal  
    https://openjdk.org/jeps/411

17. JEP 486 — Permanently Disable the Security Manager  
    https://openjdk.org/jeps/486

18. JEP 498 — Warn upon Use of Memory-Access Methods in sun.misc.Unsafe  
    https://openjdk.org/jeps/498

19. JEP 471 — Deprecate the Memory-Access Methods in sun.misc.Unsafe for Removal  
    https://openjdk.org/jeps/471

20. Oracle Java SE 25 Tool Specifications: `jdeps`, `jdeprscan`, `javac`, `java`  
    https://docs.oracle.com/en/java/javase/25/docs/specs/man/index.html

---

# Penutup

Migrasi Java dari 8 ke 25 bukan sekadar upgrade teknis. Ia adalah proses membongkar asumsi lama yang tersembunyi di codebase, dependency, build pipeline, runtime flags, framework, observability, dan deployment.

Strategi yang kuat adalah:

```text
inventory
  → baseline
  → run on newer JDK
  → update dependencies
  → compile with newer JDK
  → fix source/runtime issues
  → test behavior
  → rebaseline performance
  → rollout gradually
  → clean up workarounds
  → modernize selectively
```

Engineer yang matang tidak hanya bertanya:

```text
Apakah Java 25 lebih cepat?
```

Ia bertanya:

```text
Apakah sistem kita benar, stabil, terukur, rollbackable, dan siap menghadapi perubahan runtime Java modern?
```

Migrasi berhasil bukan saat `mvn test` hijau. Migrasi berhasil saat aplikasi berjalan di production dengan behavior yang dipahami, risiko yang dikendalikan, observability yang memadai, dan tidak ada workaround gelap yang akan meledak di upgrade berikutnya.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-part-022.md">⬅️ Bagian 22 — Design Principles dan Domain Modeling dengan Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-part-024.md">Bagian 24 — Capstone: Java Engineering Mastery dan Production-Grade Decision Making ➡️</a>
</div>
