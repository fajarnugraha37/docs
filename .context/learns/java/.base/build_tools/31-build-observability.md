# Part 31 — Build Observability: Logs, Reports, Build Scan, Metrics, Flakiness, Trend Analysis

> Seri: `learn-java-build-gradle-maven-engineering`  
> File: `31-build-observability.md`  
> Scope: Java 8–25, Maven, Gradle, CI/CD, enterprise build/platform engineering

---

## 0. Tujuan Bagian Ini

Pada part sebelumnya kita sudah membahas Maven advanced, Gradle advanced, performance, CI/CD, release, security, governance, multi-module, code generation, static analysis, dependency conflict, dan troubleshooting.

Bagian ini membahas sesuatu yang sering terlambat dipikirkan oleh tim engineering: **build observability**.

Banyak tim memperlakukan build sebagai command:

```bash
mvn clean verify
./gradlew build
```

Padahal pada sistem besar, build adalah **distributed socio-technical system**:

- berjalan di laptop developer, CI runner, release pipeline, container builder, security scanner;
- bergantung pada JDK, OS, network, repository, cache, test environment, Docker daemon, database test, credentials;
- menghasilkan artifact, report, logs, metadata, dependency tree, SBOM, coverage, test result, scan result;
- menjadi gerbang utama antara source code dan runtime production.

Jika build tidak observable, maka saat gagal kita hanya punya gejala:

- “CI merah”;
- “di lokal jalan”;
- “dependency tiba-tiba berubah”;
- “test flaky”;
- “build makin lama”;
- “cache tidak efektif”;
- “release pipeline stuck”;
- “artifact hash beda”;
- “security scan timeout”.

Top 1% engineer tidak hanya tahu command build. Mereka tahu bagaimana membuat build menjadi **sistem yang bisa dioperasikan**.

Observability build berarti kita bisa menjawab:

1. Apa yang build lakukan?
2. Kenapa build melakukan itu?
3. Berapa lama tiap bagian berjalan?
4. Apa input dan output-nya?
5. Dependency apa yang dipakai?
6. Test mana yang gagal, lambat, atau flaky?
7. Cache mana yang hit/miss?
8. Artifact apa yang diproduksi?
9. Policy gate mana yang gagal?
10. Apakah masalah ini baru, berulang, atau tren memburuk?

---

## 1. Mental Model: Build sebagai Sistem Operasional

### 1.1 Build bukan event tunggal

Build bukan satu event. Build adalah rangkaian event.

Contoh Maven:

```text
checkout
  -> setup JDK
  -> restore cache
  -> resolve plugins
  -> resolve dependencies
  -> validate
  -> compile
  -> test
  -> package
  -> verify
  -> publish reports
  -> upload artifact
```

Contoh Gradle:

```text
checkout
  -> setup JDK
  -> restore Gradle user home
  -> initialize build
  -> configure projects
  -> resolve task graph
  -> execute tasks
  -> produce reports
  -> store cache
  -> publish artifact
```

Setiap tahap punya:

- input;
- output;
- duration;
- failure modes;
- ownership;
- retry semantics;
- artifact/report;
- security boundary.

Build observability membuat tahap-tahap ini terlihat.

---

### 1.2 Build adalah state machine

Model sederhana:

```text
START
  -> CHECKOUT
  -> ENVIRONMENT_SETUP
  -> DEPENDENCY_RESOLUTION
  -> COMPILE
  -> TEST
  -> STATIC_ANALYSIS
  -> PACKAGE
  -> SECURITY_SCAN
  -> PUBLISH_REPORT
  -> PUBLISH_ARTIFACT
  -> END
```

Setiap state bisa:

```text
SUCCESS
FAILURE_RETRYABLE
FAILURE_NON_RETRYABLE
SKIPPED
UNSTABLE
TIMEOUT
CANCELLED
```

Observability yang baik tidak hanya berkata “failed”. Ia berkata:

```text
State: TEST
Module: payment-adapter
Task/Goal: integrationTest
Failure type: flaky external dependency
First failing test: PaymentRetryIT.shouldRetryAfterTimeout
Duration before failure: 11m 32s
Historical failure rate: 7 failures in last 30 runs
Suspected owner: payment-platform team
```

---

### 1.3 Build signal vs noise

Tidak semua output build bernilai.

Noise:

```text
Downloading from central...
[INFO] Compiling 120 source files...
> Task :compileJava
```

Signal:

```text
Dependency resolution changed: jackson-databind 2.15.4 -> 2.17.2
Cache miss reason: task input property 'javaVersion' changed 17 -> 21
Test flakiness: UserSessionIT failed 3/20 runs in last 7 days
Compile warning count increased from 12 -> 47
Build duration p95 increased from 9m -> 18m after PR #812
```

Top 1% engineer mendesain build logs/reports supaya signal mudah ditemukan dan noise bisa ditekan.

---

## 2. Apa yang Perlu Diobservasi?

Build observability harus mencakup beberapa layer.

```text
Layer 1 — Environment
Layer 2 — Build tool
Layer 3 — Dependency resolution
Layer 4 — Compilation
Layer 5 — Tests
Layer 6 — Static analysis
Layer 7 — Packaging
Layer 8 — Security
Layer 9 — Artifact publishing
Layer 10 — Trends and governance
```

---

## 3. Environment Observability

Environment sering menjadi sumber masalah build yang paling licin.

Minimal metadata yang harus tercatat:

```text
Git commit
Git branch
Pull request id
Build id
CI runner id
OS
CPU architecture
Container image
JDK vendor
JDK version
Maven/Gradle version
Maven/Gradle wrapper checksum
Timezone
Locale
Network/proxy mode
Repository mirror
Cache key
```

Contoh output yang sehat di awal pipeline:

```bash
echo "Commit: $GIT_COMMIT"
echo "Branch: $BRANCH_NAME"
echo "Java: $(java -version 2>&1 | head -n 1)"
echo "Maven: $(./mvnw -version | head -n 1)"
echo "Gradle: $(./gradlew --version | grep Gradle | head -n 1)"
echo "OS: $(uname -a)"
echo "Timezone: $(date +%Z)"
```

Untuk Java 8–25, metadata JDK sangat penting karena error bisa muncul dari:

- class file version mismatch;
- toolchain berbeda;
- annotation processor tidak kompatibel;
- test berjalan di JDK berbeda dari compile;
- TLS/cert behavior berbeda;
- default GC/runtime behavior berbeda;
- module encapsulation lebih ketat pada JDK modern.

---

## 4. Build Tool Observability

### 4.1 Maven observability dasar

Command berguna:

```bash
./mvnw -version
./mvnw help:effective-pom
./mvnw help:effective-settings
./mvnw dependency:tree
./mvnw dependency:resolve
./mvnw -X clean verify
./mvnw -e clean verify
./mvnw -T 1C clean verify
```

Makna:

| Command | Tujuan |
|---|---|
| `-version` | validasi Maven/JDK/runtime |
| `help:effective-pom` | melihat model akhir setelah parent/profile/plugin management |
| `help:effective-settings` | melihat mirror, proxy, server, repository config efektif |
| `dependency:tree` | melihat graph dependency |
| `dependency:resolve` | melihat dependency yang benar-benar di-resolve |
| `-X` | debug sangat detail |
| `-e` | full stack trace |
| `-T` | parallel reactor behavior |

Maven report penting:

```text
target/surefire-reports/
target/failsafe-reports/
target/site/
target/checkstyle-result.xml
target/pmd.xml
target/spotbugsXml.xml
target/jacoco.exec
target/site/jacoco/
```

---

### 4.2 Gradle observability dasar

Command berguna:

```bash
./gradlew --version
./gradlew tasks
./gradlew projects
./gradlew properties
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
./gradlew build --info
./gradlew build --debug
./gradlew build --scan
./gradlew help --scan
./gradlew build --profile
```

Makna:

| Command | Tujuan |
|---|---|
| `--version` | validasi Gradle/JDK/runtime |
| `tasks` | melihat task yang tersedia |
| `projects` | melihat struktur multi-project |
| `properties` | melihat property project |
| `dependencies` | melihat graph dependency per configuration |
| `dependencyInsight` | melihat kenapa dependency tertentu terpilih |
| `--info` | log detail moderat |
| `--debug` | log sangat detail |
| `--scan` | metadata observability komprehensif |
| `--profile` | HTML profile report lokal |

Gradle report penting:

```text
build/reports/tests/test/index.html
build/test-results/test/*.xml
build/reports/jacoco/test/html/index.html
build/reports/problems/problems-report.html
build/reports/profile/profile-*.html
```

---

## 5. Logs: Dari Text Dump ke Diagnostic Asset

### 5.1 Log build harus menjawab pertanyaan, bukan hanya mencetak output

Log yang buruk:

```text
Build failed.
```

Log yang baik:

```text
Build failed at stage: integration-test
Module: billing-integration
JDK: Eclipse Temurin 21.0.5
Maven: 3.9.9
Failure category: test container startup timeout
First failing test: BillingWebhookIT
Artifact under test: billing-service-1.8.2-SNAPSHOT.jar
Duration: 14m 22s
Report: target/failsafe-reports/BillingWebhookIT.txt
```

---

### 5.2 Prinsip build logging

1. **Print environment once** di awal.
2. **Print tool version once** di awal.
3. **Group logs by stage**.
4. **Fail fast for invalid environment**.
5. **Archive raw logs** untuk forensic.
6. **Archive structured reports** untuk trend.
7. **Do not leak secrets**.
8. **Show first meaningful failure**, bukan hanya last line.
9. **Suppress noisy downloads** bila tidak dibutuhkan.
10. **Record changed inputs** untuk cache/debugging.

---

### 5.3 CI log grouping

Banyak CI mendukung log grouping:

```bash
echo "::group::Environment"
java -version
./mvnw -version
echo "::endgroup::"

echo "::group::Build"
./mvnw -B -ntp clean verify
echo "::endgroup::"
```

Atau GitLab-style:

```bash
echo -e "section_start:$(date +%s):env[collapsed=true]\r\e[0KEnvironment"
java -version
./gradlew --version
echo -e "section_end:$(date +%s):env\r\e[0K"
```

Tujuannya bukan kosmetik, tetapi mempercepat navigasi saat incident.

---

## 6. Reports: Artifact Diagnostik yang Harus Diarsipkan

### 6.1 Test reports

Test report adalah observability primitive terpenting setelah log.

Maven Surefire:

```text
target/surefire-reports/TEST-*.xml
target/surefire-reports/*.txt
```

Maven Failsafe:

```text
target/failsafe-reports/TEST-*.xml
target/failsafe-reports/*.txt
```

Gradle:

```text
build/test-results/test/*.xml
build/reports/tests/test/index.html
```

JUnit XML harus di-upload ke CI supaya UI bisa menampilkan:

- test count;
- failure count;
- skipped count;
- duration;
- failed test name;
- failure message;
- stack trace;
- trend.

---

### 6.2 Coverage reports

Coverage observability bukan hanya angka total.

Yang perlu diamati:

```text
line coverage
branch coverage
method coverage
class coverage
coverage delta per PR
new code coverage
module-level coverage
coverage of critical packages
coverage trend over time
```

Contoh struktur report:

```text
target/site/jacoco/index.html
build/reports/jacoco/test/html/index.html
```

Coverage anti-pattern:

```text
Global coverage 80%, tetapi module payment-core turun dari 75% ke 42%.
```

Coverage gate yang sehat lebih granular:

```text
Global line coverage >= 70%
New code line coverage >= 80%
Critical package branch coverage >= 75%
No drop > 3% per module without waiver
```

---

### 6.3 Static analysis reports

Static analysis report perlu diarsipkan sebagai machine-readable artifact.

Contoh:

```text
Checkstyle XML
PMD XML
SpotBugs XML
Error Prone compiler output
ArchUnit test result
Revapi/japicmp compatibility report
OWASP Dependency-Check report
CycloneDX SBOM
```

Kualitas observability meningkat jika report punya:

- stable file path;
- machine-readable format;
- severity;
- rule id;
- affected file/class;
- baseline status;
- owner/team mapping;
- waiver reference.

---

### 6.4 Dependency reports

Dependency graph harus bisa dibandingkan antar build.

Maven:

```bash
./mvnw dependency:tree -DoutputFile=target/dependency-tree.txt
./mvnw dependency:list -DoutputFile=target/dependency-list.txt
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath > build/reports/runtimeClasspath.txt
./gradlew dependencyInsight --dependency jackson-databind --configuration runtimeClasspath
```

Untuk enterprise, simpan snapshot dependency graph pada:

```text
main branch nightly
release candidate
release final
major security remediation
Java baseline migration
BOM/platform upgrade
```

---

## 7. Build Scan dan Build Telemetry

### 7.1 Apa itu build scan?

Build scan adalah representasi metadata build yang bisa dianalisis, dibagikan, dan dibandingkan. Pada Gradle ecosystem, Build Scan/Develocity menyediakan timeline build, task execution, dependency resolution, test result, environment, cache behavior, dan performance breakdown.

Build scan berguna karena banyak informasi hilang jika kita hanya melihat console log.

Console log biasanya menjawab:

```text
Apa error terakhir?
```

Build scan bisa menjawab:

```text
Task mana paling lama?
Task mana cache miss?
Kenapa task tidak up-to-date?
Dependency apa yang berubah?
Test mana flaky?
Berapa waktu configuration phase?
Build ini lebih lambat dari baseline di bagian mana?
```

---

### 7.2 Gradle build scan

Command:

```bash
./gradlew build --scan
```

Hal yang perlu diperhatikan:

- data apa yang dikirim;
- apakah source path, environment variable, hostname, username aman dikirim;
- apakah memakai public scan service atau self-hosted Develocity;
- apakah scan wajib di CI;
- retention policy;
- link scan harus dicetak di log CI.

Untuk enterprise/regulatory environment, biasanya lebih aman memakai self-hosted atau controlled observability backend.

---

### 7.3 Maven build scan

Maven juga bisa diobservasi melalui Develocity Maven extension atau pendekatan CI/report custom.

Konsepnya sama:

- capture lifecycle duration;
- capture dependency resolution;
- capture test result;
- capture environment;
- capture build cache bila digunakan;
- link report ke CI.

Jika organisasi tidak memakai Develocity, Maven observability tetap bisa dibuat dari:

```text
Maven event spy
CI stage duration
JUnit XML
Surefire/Failsafe report
JaCoCo XML
Dependency tree snapshot
SBOM
Custom script metadata
```

---

## 8. Metrics yang Benar-benar Berguna

### 8.1 Build duration metrics

Jangan hanya ukur average.

Gunakan:

```text
p50 build duration
p75 build duration
p90 build duration
p95 build duration
p99 build duration
max duration
queue time
agent provisioning time
checkout time
dependency resolution time
compile time
test time
static analysis time
package time
publish time
```

Kenapa p95 penting?

Karena developer biasanya merasakan pain dari worst common case, bukan average.

Contoh:

```text
Average build: 8 minutes
p95 build: 34 minutes
```

Ini berarti mayoritas diskusi “build kita 8 menit” menipu. Ada tail latency besar yang mengganggu flow engineer.

---

### 8.2 Failure metrics

Track:

```text
build success rate
failure rate by stage
failure rate by module
failure rate by branch type
failure rate by runner type
failure rate by JDK version
failure rate by test category
retry success rate
time to green
mean time to diagnose
mean time to recover
```

Pertanyaan kunci:

```text
Apakah build sering gagal karena code defect, atau karena infrastructure?
```

Jika 40% kegagalan CI berasal dari infra/test flake, maka CI tidak lagi menjadi trust signal. Ia menjadi noise generator.

---

### 8.3 Cache metrics

Gradle/Maven/CI cache harus diukur.

Track:

```text
cache restore time
cache save time
cache hit rate
cache miss rate
remote cache hit rate
local cache hit rate
cache upload size
cache download size
cache key churn
cache poisoning incidents
```

Cache tidak selalu baik. Cache buruk bisa memperlambat build.

Contoh:

```text
Cache restore: 3m 20s
Time saved: 40s
Net loss: 2m 40s
```

Atau:

```text
Cache hit rate: 92%
But stale generated sources caused false green build
```

Observability cache harus menjawab:

```text
Apakah cache mempercepat build tanpa mengurangi correctness?
```

---

### 8.4 Dependency metrics

Track:

```text
number of direct dependencies
number of transitive dependencies
dependency graph depth
duplicate classes count
vulnerable dependencies count
outdated dependencies count
dynamic versions count
SNAPSHOT dependencies count
repository source distribution
license policy violations
Java bytecode baseline violations
```

Dependency metrics membantu governance.

Contoh alarm:

```text
runtimeClasspath dependency count increased 312 -> 497 after PR #2041
```

Itu belum tentu salah, tapi harus terlihat.

---

### 8.5 Test metrics

Track:

```text
total test count
unit test count
integration test count
skipped test count
ignored test count
failed test count
slowest tests
flaky tests
failure rate per test
average duration per test
duration p95 per test suite
test retries count
test container startup time
```

Slow test perlu dilihat sebagai performance debt.

Flaky test perlu dilihat sebagai trust debt.

Skipped test perlu dilihat sebagai risk debt.

---

## 9. Flaky Test Observability

### 9.1 Definisi flaky test

Test flaky adalah test yang bisa pass dan fail pada input/source code yang sama.

Penyebab umum:

```text
time dependency
randomness
shared mutable state
test order dependency
external service instability
race condition
port conflict
filesystem conflict
database state leakage
timezone/locale dependency
parallel execution issue
resource exhaustion
network dependency
```

---

### 9.2 Jangan langsung retry tanpa observability

Retry bisa membantu delivery, tetapi berbahaya jika menyembunyikan signal.

Retry yang sehat:

```text
Retry max 1 or 2 times
Record original failure
Record retry success/failure
Mark test as flaky candidate
Create trend dashboard
Fail if flakiness exceeds threshold
```

Retry yang buruk:

```text
Retry 5 times silently until green
```

Itu membuat CI hijau palsu.

---

### 9.3 Flaky test state machine

```text
NEW_FAILURE
  -> REPRODUCED_LOCALLY
  -> SUSPECTED_FLAKY
  -> QUARANTINED_WITH_OWNER
  -> FIXED
  -> MONITORED
  -> CLOSED
```

Aturan penting:

- quarantine harus punya owner;
- quarantine harus punya expiry date;
- quarantine tidak boleh menjadi kuburan test;
- critical path test tidak boleh lama-lama quarantine;
- flaky rate harus menjadi metric engineering health.

---

### 9.4 Flaky report format

```text
Test: UserSessionIT.shouldExpireAfterIdleTimeout
Module: session-service
Failure rate: 6/50 runs
First seen: 2026-06-02
Last seen: 2026-06-17
JDK: 21
Runner: linux-x64-large
Likely category: timing/race
Owner: platform-auth
Quarantine: no
Action: investigate before next release candidate
```

---

## 10. Trend Analysis: Melihat Build sebagai Time Series

### 10.1 Build trend yang perlu dilihat mingguan

```text
Build duration p50/p95
Failure rate by stage
Flaky test count
Slow test top 20
Dependency count
Vulnerability count
Coverage trend
Mutation score trend
Static analysis violation trend
Cache hit rate
Release build duration
Time to green after PR
```

---

### 10.2 Build regression detection

Contoh threshold:

```text
Fail PR if build duration increases > 25% on affected module
Warn if test suite duration increases > 15%
Warn if dependency count increases > 10%
Fail if new dynamic dependency version introduced
Fail if new critical vulnerability introduced
Warn if coverage drops > 2%
Fail if public API compatibility breaks without major version bump
```

Tidak semua regression harus fail build. Beberapa cukup warning + ticket.

Decision matrix:

| Signal | Action |
|---|---|
| Critical vulnerability | fail |
| Secret leak | fail |
| Reproducibility break on release | fail |
| New flaky test | warn or fail depending criticality |
| Build duration +5% | observe |
| Build duration +50% | fail or require approval |
| Coverage drop 1% | warn |
| Coverage drop 10% | fail |

---

## 11. Observability untuk Maven

### 11.1 Maven baseline CI command

```bash
./mvnw -B -ntp -e clean verify
```

Penjelasan:

| Option | Makna |
|---|---|
| `-B` | batch mode untuk CI |
| `-ntp` | no transfer progress, mengurangi noise download |
| `-e` | show stack trace |
| `clean verify` | lifecycle lengkap sampai verification |

Untuk debug mendalam:

```bash
./mvnw -X -e clean verify
```

Tapi jangan selalu memakai `-X` di CI normal karena terlalu noisy.

---

### 11.2 Maven report archive script

Contoh sederhana:

```bash
mkdir -p ci-artifacts/maven

find . -path "*/target/surefire-reports/*" -type f -print -exec cp --parents {} ci-artifacts/maven/ \;
find . -path "*/target/failsafe-reports/*" -type f -print -exec cp --parents {} ci-artifacts/maven/ \;
find . -path "*/target/site/jacoco/*" -type f -print -exec cp --parents {} ci-artifacts/maven/ \;
find . -path "*/target/*.jar" -type f -print > ci-artifacts/maven/artifacts.txt

./mvnw -B -ntp help:effective-pom -Doutput=ci-artifacts/maven/effective-pom.xml || true
./mvnw -B -ntp help:effective-settings -Doutput=ci-artifacts/maven/effective-settings.xml || true
./mvnw -B -ntp dependency:tree -DoutputFile=ci-artifacts/maven/dependency-tree.txt || true
```

Catatan: hati-hati mengarsipkan `effective-settings.xml` karena bisa mengandung informasi sensitif jika konfigurasi tidak bersih.

---

### 11.3 Maven multi-module observability

Pada Maven reactor, lihat:

```text
module build order
module duration
module failure stage
module skipped because upstream failed
module dependency relation
```

Contoh summary yang ideal:

```text
Reactor Summary:
core-api ......................... SUCCESS [12s]
core-domain ...................... SUCCESS [21s]
payment-adapter .................. FAILURE [2m 18s]
billing-app ...................... SKIPPED
```

Jika CI bisa mengurai summary ini menjadi metric, debugging jauh lebih cepat.

---

## 12. Observability untuk Gradle

### 12.1 Gradle baseline CI command

```bash
./gradlew build --no-daemon --stacktrace --info
```

Untuk build scan:

```bash
./gradlew build --scan
```

Untuk performance lokal:

```bash
./gradlew build --profile
```

Untuk dependency investigation:

```bash
./gradlew :app:dependencyInsight \
  --configuration runtimeClasspath \
  --dependency jackson-databind
```

---

### 12.2 Gradle report archive script

```bash
mkdir -p ci-artifacts/gradle

find . -path "*/build/reports/*" -type f -print -exec cp --parents {} ci-artifacts/gradle/ \;
find . -path "*/build/test-results/*" -type f -print -exec cp --parents {} ci-artifacts/gradle/ \;
find . -path "*/build/libs/*.jar" -type f -print > ci-artifacts/gradle/artifacts.txt

./gradlew projects > ci-artifacts/gradle/projects.txt || true
./gradlew tasks --all > ci-artifacts/gradle/tasks.txt || true
./gradlew dependencies > ci-artifacts/gradle/dependencies.txt || true
```

---

### 12.3 Gradle task observability

Untuk setiap task penting, observability harus bisa menjawab:

```text
Task executed atau skipped?
Jika skipped, kenapa?
Jika executed, berapa lama?
Cache hit/miss?
Up-to-date atau tidak?
Input apa yang berubah?
Output apa yang dibuat?
```

Gradle unggul di area ini karena task input/output bisa dimodelkan eksplisit. Tapi kalau plugin custom tidak mendeklarasikan input/output dengan benar, observability dan cacheability rusak.

---

## 13. Build Observability Dashboard

### 13.1 Dashboard minimum

Dashboard build minimum untuk enterprise Java platform:

```text
Build Health Overview
- success rate last 7/30 days
- p50/p95 duration
- failure by stage
- top failing modules
- top flaky tests
- top slow tests
- cache hit rate
- dependency vulnerability trend
- artifact publish failures
```

---

### 13.2 Dashboard per module

```text
Module: order-service
- build duration p50/p95
- compile duration
- unit test duration
- integration test duration
- coverage trend
- dependency count
- vulnerability count
- flaky tests
- last release version
- last failed build reason
```

---

### 13.3 Dashboard per dependency/platform

```text
Platform BOM version adoption
Java baseline adoption
Gradle/Maven wrapper version adoption
Spring Boot version adoption
Jakarta version adoption
Known vulnerable dependency exposure
Outdated dependency groups
SNAPSHOT dependency usage
Dynamic version usage
```

---

## 14. Observability Data Model

Untuk sistem internal, kita bisa memodelkan build event seperti ini.

```json
{
  "buildId": "ci-20260617-1024",
  "commit": "abc123",
  "branch": "main",
  "tool": "gradle",
  "toolVersion": "9.5.1",
  "jdkVersion": "21.0.7",
  "status": "FAILED",
  "durationSeconds": 842,
  "failedStage": "integration-test",
  "failedModule": "payment-adapter",
  "cacheHitRate": 0.63,
  "testSummary": {
    "total": 2142,
    "failed": 1,
    "skipped": 8,
    "durationSeconds": 512
  },
  "artifactSummary": {
    "produced": 12,
    "published": 0
  }
}
```

Build stage event:

```json
{
  "buildId": "ci-20260617-1024",
  "stage": "compile",
  "module": "order-domain",
  "status": "SUCCESS",
  "durationSeconds": 18,
  "inputsChanged": ["src/main/java/Order.java"],
  "outputs": ["target/classes"]
}
```

Test event:

```json
{
  "buildId": "ci-20260617-1024",
  "module": "payment-adapter",
  "testClass": "PaymentRetryIT",
  "testName": "shouldRetryAfterTimeout",
  "status": "FAILED",
  "durationSeconds": 12.8,
  "failureType": "timeout",
  "retryAttempt": 0
}
```

---

## 15. Build Observability and Security

Observability bisa membocorkan rahasia jika tidak dikontrol.

Jangan log:

```text
repository password
CI token
AWS secret key
database password
private key
OIDC token
signed URL
full environment dump
production endpoint with credentials
```

Hati-hati dengan:

```text
Maven effective settings
Gradle properties
system properties
Docker build args
Testcontainers env
OpenAPI generator config
repository credentials
```

Prinsip:

```text
Observe enough to debug.
Do not observe secrets.
Mask what must be printed.
Archive sensitive reports with restricted access.
```

---

## 16. Observability untuk Reproducibility

Untuk membuktikan reproducibility, capture:

```text
source commit
build tool version
JDK version/vendor
OS/container image
dependency lockfile
resolved dependency graph
plugin versions
generated source versions
artifact checksums
build timestamp policy
locale/timezone
```

Release build harus menghasilkan manifest observability:

```text
artifact: payment-service-1.8.2.jar
sha256: ...
commit: ...
jdk: Temurin 21.0.x
maven: 3.9.x
plugins: ...
dependencies: dependency-tree.txt
sbom: bom.json
build log: link
ci build: link
```

Tanpa metadata ini, incident supply-chain akan sulit ditelusuri.

---

## 17. Observability untuk Dependency Drift

Dependency drift terjadi ketika dependency berubah tanpa intensi jelas.

Signal:

```text
new dependency added
transitive version changed
classifier changed
artifact relocated
snapshot timestamp changed
repository source changed
BOM version changed
plugin version changed
```

Praktik baik:

```bash
# Maven
./mvnw dependency:tree -DoutputFile=dependency-tree.txt

# Gradle
./gradlew dependencies --configuration runtimeClasspath > runtimeClasspath.txt
```

Simpan baseline pada main/release. Bandingkan pada PR besar.

Contoh alert:

```text
PR #812 changes runtime dependency graph:
+ org.bouncycastle:bcprov-jdk18on:1.78
- org.bouncycastle:bcprov-jdk15on:1.70
~ com.fasterxml.jackson.core:jackson-databind:2.15.4 -> 2.17.2
```

---

## 18. Observability untuk Performance Regression

### 18.1 Performance regression classification

```text
configuration regression
dependency resolution regression
compile regression
test regression
static analysis regression
packaging regression
cache regression
CI infrastructure regression
```

### 18.2 Investigation example

Gejala:

```text
Build p95 naik dari 11 menit ke 27 menit.
```

Investigation:

```text
1. Compare stage duration before/after.
2. Find largest delta.
3. Check module duration.
4. Check task/goal duration.
5. Check dependency resolution time.
6. Check cache hit rate.
7. Check test slowest list.
8. Check CI runner changes.
9. Check JDK/tool version changes.
10. Check recent plugin upgrades.
```

Possible root cause:

```text
integrationTest duration naik 4m -> 19m karena Testcontainers image tidak lagi cached.
```

Fix:

```text
pre-pull image
use stable test image tag
cache Docker layers if safe
split integration test suite
add test duration alert
```

---

## 19. Observability untuk Release Pipeline

Release pipeline perlu observability lebih ketat dari PR build.

Capture:

```text
release version
source tag
artifact checksums
signing status
SBOM status
vulnerability scan result
provenance metadata
repository publish URL
promotion status
deployment target
rollback artifact
approval record
```

Release failure harus jelas:

```text
Failed at: publish-artifact
Reason: repository rejected duplicate release version
Version: 1.4.2
Repository: internal-releases
Action: bump version or verify previous publication
```

---

## 20. Observability Anti-Patterns

### 20.1 Only console logs

Masalah:

```text
JUnit XML tidak di-upload.
Coverage tidak diarsipkan.
Dependency graph tidak disimpan.
Build scan tidak ada.
```

Akibat:

```text
Investigation bergantung pada scroll log manual.
```

---

### 20.2 Always debug logging

Masalah:

```text
Semua build memakai Maven -X atau Gradle --debug.
```

Akibat:

```text
Log terlalu besar.
Signal tenggelam.
Secret leakage risk meningkat.
CI storage membengkak.
```

Gunakan debug logging hanya saat diagnosis.

---

### 20.3 Metrics without ownership

Dashboard menunjukkan 47 flaky tests, tapi tidak ada owner.

Metric tanpa owner akan menjadi dekorasi.

---

### 20.4 Retrying everything silently

Retry menyembunyikan problem.

Retry harus menjadi metric.

---

### 20.5 Cache hit rate worship

Cache hit tinggi tidak otomatis baik.

Yang benar:

```text
cache hit rate + correctness + net time saved
```

---

### 20.6 Build reports accessible to everyone without filtering

Report bisa mengandung:

- file path internal;
- hostname;
- username;
- environment variable;
- dependency vulnerability;
- private repository URL;
- generated config.

Atur access control.

---

## 21. Practical Maven Blueprint

### 21.1 POM plugins for observability

Contoh baseline:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-surefire-plugin</artifactId>
      <version>${maven-surefire-plugin.version}</version>
      <configuration>
        <useFile>true</useFile>
        <trimStackTrace>false</trimStackTrace>
      </configuration>
    </plugin>

    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-failsafe-plugin</artifactId>
      <version>${maven-failsafe-plugin.version}</version>
      <executions>
        <execution>
          <goals>
            <goal>integration-test</goal>
            <goal>verify</goal>
          </goals>
        </execution>
      </executions>
      <configuration>
        <trimStackTrace>false</trimStackTrace>
      </configuration>
    </plugin>

    <plugin>
      <groupId>org.jacoco</groupId>
      <artifactId>jacoco-maven-plugin</artifactId>
      <version>${jacoco.version}</version>
      <executions>
        <execution>
          <goals>
            <goal>prepare-agent</goal>
          </goals>
        </execution>
        <execution>
          <id>report</id>
          <phase>verify</phase>
          <goals>
            <goal>report</goal>
          </goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```

### 21.2 CI command

```bash
./mvnw -B -ntp -e clean verify
```

### 21.3 Diagnostic fallback

```bash
./mvnw -X -e -DskipTests clean verify
./mvnw -B -ntp dependency:tree
./mvnw -B -ntp help:effective-pom
```

---

## 22. Practical Gradle Blueprint

### 22.1 Gradle test logging

```kotlin
tasks.withType<Test>().configureEach {
    useJUnitPlatform()

    reports {
        junitXml.required.set(true)
        html.required.set(true)
    }

    testLogging {
        events("failed", "skipped")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
        showExceptions = true
        showCauses = true
        showStackTraces = true
    }
}
```

### 22.2 Build scan command

```bash
./gradlew build --scan
```

### 22.3 Profile command

```bash
./gradlew build --profile
```

### 22.4 Dependency diagnostics

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencyInsight --configuration runtimeClasspath --dependency guava
```

---

## 23. CI Artifact Retention Policy

Tidak semua report perlu disimpan selamanya.

Suggested policy:

| Artifact | PR build | Main build | Release build |
|---|---:|---:|---:|
| Console log | 14–30 days | 30–90 days | 1–7 years |
| JUnit XML | 30–90 days | 90–180 days | 1–7 years |
| Coverage report | 30–90 days | 180 days | 1–7 years |
| Dependency tree | optional | 180 days | 1–7 years |
| SBOM | optional | 180 days | release lifetime |
| Artifact checksum | optional | 1 year | release lifetime |
| Build scan | 30–90 days | 180 days | release lifetime or policy |

Untuk regulatory/enterprise, release build evidence biasanya harus disimpan lebih lama.

---

## 24. Build Observability Review Checklist

### 24.1 Environment

- [ ] Build mencetak JDK vendor/version.
- [ ] Build mencetak Maven/Gradle version.
- [ ] Build mencatat commit/branch/build id.
- [ ] Build mencatat CI runner/container image.
- [ ] Build tidak mencetak secret.

### 24.2 Logs

- [ ] CI log dikelompokkan per stage.
- [ ] Log tidak terlalu noisy.
- [ ] Failure pertama mudah ditemukan.
- [ ] Debug mode tersedia saat investigasi.
- [ ] Log disimpan sesuai retention policy.

### 24.3 Reports

- [ ] JUnit XML di-upload.
- [ ] HTML test report diarsipkan.
- [ ] Coverage report diarsipkan.
- [ ] Static analysis report diarsipkan.
- [ ] Dependency report tersedia untuk release.
- [ ] SBOM tersedia untuk release.

### 24.4 Metrics

- [ ] Build duration p50/p95 dipantau.
- [ ] Failure rate by stage dipantau.
- [ ] Flaky test count dipantau.
- [ ] Slowest tests dipantau.
- [ ] Cache hit/miss dipantau.
- [ ] Dependency vulnerability trend dipantau.

### 24.5 Ownership

- [ ] Failing module punya owner.
- [ ] Flaky test punya owner.
- [ ] Build performance regression punya owner.
- [ ] Quality gate waiver punya owner dan expiry.

### 24.6 Release evidence

- [ ] Release artifact punya checksum.
- [ ] Release punya dependency graph snapshot.
- [ ] Release punya SBOM.
- [ ] Release punya build log/report link.
- [ ] Release punya provenance atau minimal build metadata.

---

## 25. Case Study: CI Sering Merah Tapi Tidak Ada yang Percaya

### 25.1 Gejala

```text
- PR build gagal 25% dari waktu.
- Developer sering re-run tanpa investigasi.
- Banyak test integration timeout.
- Build duration tidak stabil: 8–40 menit.
- Tidak ada trend flaky test.
- Artifact reports tidak diarsipkan konsisten.
```

### 25.2 Diagnosis

Observability awal menunjukkan:

```text
Failure by stage:
- 8% compile
- 12% unit test
- 55% integration test
- 20% dependency resolution
- 5% static analysis

Top integration failures:
- UserSessionIT timeout
- PaymentWebhookIT port conflict
- ReportExportIT filesystem conflict

Cache metrics:
- restore time 4m
- save time 3m
- cache hit useful only 35%
```

### 25.3 Root cause

```text
- Testcontainers image tidak stabil/cache miss.
- Parallel integration test berbagi port dan filesystem.
- CI cache terlalu besar dan sering invalid.
- Tidak ada quarantine policy.
- Dependency repository mirror kadang timeout.
```

### 25.4 Fix

```text
- Pisahkan unit dan integration pipeline.
- Tambahkan owner untuk flaky tests.
- Gunakan dynamic port allocation.
- Bersihkan shared filesystem state.
- Optimalkan cache key dan cache scope.
- Tambahkan dependency proxy mirror health check.
- Upload JUnit XML dan trend dashboard.
```

### 25.5 Result yang diharapkan

```text
- Failure rate turun.
- Retry turun.
- Build p95 turun.
- Developer trust naik.
- CI menjadi signal lagi, bukan noise.
```

---

## 26. Top 1% Mental Model

Engineer biasa bertanya:

```text
Kenapa build gagal?
```

Engineer senior bertanya:

```text
Di stage mana build gagal?
Apakah ini failure baru atau recurring?
Apakah ini deterministic atau flaky?
Input apa yang berubah?
Dependency apa yang berubah?
Environment apa yang berbeda?
Report mana yang membuktikan root cause?
Apakah gate ini benar-benar mencegah risk?
Apakah observability cukup untuk mencegah investigasi manual berikutnya?
```

Build observability bukan sekadar dashboard. Ia adalah kemampuan organisasi untuk:

- memahami build;
- mempercayai build;
- memperbaiki build;
- mengaudit build;
- mempertahankan release integrity.

Pada skala enterprise, build yang tidak observable adalah liability.

---

## 27. Ringkasan

Build observability mencakup:

- environment metadata;
- build tool metadata;
- logs yang terstruktur;
- reports yang diarsipkan;
- metrics p50/p95/p99;
- failure taxonomy;
- flaky test tracking;
- dependency drift monitoring;
- cache hit/miss analysis;
- release evidence;
- ownership dan waiver governance.

Maven dan Gradle punya pendekatan berbeda, tetapi prinsipnya sama:

```text
Build harus bisa dijelaskan.
Build harus bisa diaudit.
Build harus bisa dibandingkan antar waktu.
Build harus bisa dipercaya sebelum artifact dipromosikan.
```

Tanpa observability, build hanya ritual command.

Dengan observability, build menjadi operational control plane untuk engineering quality.

---

## 28. Referensi Resmi dan Lanjutan

- Gradle User Manual — Build Scan basics.
- Develocity Documentation — Build Scan and build cache observability.
- Develocity Maven Extension documentation.
- Maven Surefire Report Plugin documentation.
- Maven Surefire/Failsafe Plugin documentation.
- Gradle Java Testing documentation.
- Gradle Test Report Aggregation Plugin documentation.
- JaCoCo documentation.
- CycloneDX Maven/Gradle plugin documentation.
- SLSA provenance framework.

---

## 29. Status Seri

Selesai:

- Part 0 — Build Engineering Mental Model
- Part 1 — Java Version Strategy: Java 8–25
- Part 2 — Maven Core Mental Model
- Part 3 — Gradle Core Mental Model
- Part 4 — Maven vs Gradle Decision Framework
- Part 5 — Project Layout Engineering
- Part 6 — Dependency Graph Fundamentals
- Part 7 — Dependency Version Management
- Part 8 — Repository Engineering
- Part 9 — Build Reproducibility
- Part 10 — Compiler Engineering
- Part 11 — Testing Build Pipeline
- Part 12 — Packaging Engineering
- Part 13 — Resource Processing, Filtering, Profiles, Properties, Environment Separation
- Part 14 — Plugin System Deep Dive
- Part 15 — Maven Advanced Plugin Engineering
- Part 16 — Gradle Advanced Plugin Engineering
- Part 17 — Performance Engineering
- Part 18 — CI/CD Build Architecture
- Part 19 — Release Engineering
- Part 20 — Security Engineering
- Part 21 — Enterprise Governance
- Part 22 — Multi-Module Architecture for Large Java Systems
- Part 23 — Jakarta/Spring/Enterprise Java Build Integration
- Part 24 — Code Generation Pipelines
- Part 25 — Static Analysis and Quality Gates
- Part 26 — Dependency Conflict Case Studies
- Part 27 — Migration Engineering
- Part 28 — Troubleshooting Build Failures
- Part 29 — Advanced Gradle
- Part 30 — Advanced Maven
- Part 31 — Build Observability

Berikutnya:

- Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 30 — Advanced Maven: Reactor, Effective Model, Resolver, Enforcer, Extensions](./30-advanced-maven-reactor-effective-model-resolver-enforcer-extensions.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 32 — Monorepo, Polyrepo, and Enterprise Build Topologies](./32-monorepo-polyrepo-enterprise-build-topologies.md)

</div>