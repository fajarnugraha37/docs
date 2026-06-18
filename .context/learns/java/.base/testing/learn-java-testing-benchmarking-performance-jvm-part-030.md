# learn-java-testing-benchmarking-performance-jvm-part-030

# Performance Regression Pipeline: CI Benchmark, Baseline, Threshold, and Release Gate

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `030 / 031`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: menjadikan performance sebagai kontrol engineering yang berulang, terukur, dan bisa dipakai dalam keputusan release.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas:

- bagaimana benchmark mikro dibuat dengan JMH,
- bagaimana benchmark bisa menipu,
- bagaimana load test, stress test, soak test, dan capacity test dilakukan,
- bagaimana JVM bekerja,
- bagaimana memory, GC, profiling, thread pool, connection pool, timeout, retry, dan backpressure memengaruhi performa sistem.

Part ini menjawab pertanyaan yang lebih operasional:

> Bagaimana semua pengetahuan itu dimasukkan ke pipeline engineering agar regression performance tertangkap sebelum production?

Target akhirnya bukan sekadar punya satu benchmark atau satu load test script. Targetnya adalah punya **performance regression pipeline** yang bisa menjawab:

1. Apakah perubahan ini memperlambat hot path penting?
2. Apakah regression tersebut signifikan secara statistik dan signifikan secara bisnis?
3. Apakah perubahan ini menaikkan allocation rate, GC pressure, latency tail, CPU usage, atau downstream saturation?
4. Apakah hasil test cukup stabil untuk menjadi release gate?
5. Artifact apa yang harus disimpan agar investigasi bisa direproduksi?
6. Kapan release harus diblokir, kapan boleh lanjut, dan kapan perlu risk acceptance?

Engineer level tinggi tidak hanya mampu “melakukan tuning”. Mereka mampu membangun sistem feedback agar performance tidak menjadi kejutan menjelang go-live.

---

## 2. Core Mental Model: Performance Regression adalah Bug, tetapi Buktinya Berbeda

Correctness bug biasanya terlihat seperti:

```text
expected: APPROVED
actual:   REJECTED
```

Performance bug jarang sesederhana itu. Ia terlihat seperti:

```text
p95 naik dari 180 ms ke 260 ms
allocation naik 35%
GC pause total naik 2x
CPU per request naik 18%
throughput maksimum turun 12%
Hikari pending connections muncul pada 70% traffic sebelumnya
```

Masalahnya, angka performance selalu mengandung noise.

Noise bisa berasal dari:

- JIT warmup,
- GC timing,
- CPU frequency scaling,
- container throttling,
- noisy neighbor,
- network jitter,
- database cache state,
- test data distribution,
- CI runner yang berubah,
- background process,
- dependency eksternal,
- benchmark yang tidak representatif.

Karena itu performance regression pipeline harus menggabungkan empat hal:

```text
Measurement discipline
  + baseline discipline
  + statistical discipline
  + release decision discipline
```

Tanpa baseline, angka tidak punya konteks.

Tanpa statistik, angka bisa menipu.

Tanpa artifact, hasil tidak bisa diaudit.

Tanpa release policy, semua hasil hanya menjadi grafik yang diabaikan.

---

## 3. Evidence Ladder untuk Performance Regression

Gunakan ladder berikut untuk memahami jenis bukti yang berbeda.

```text
Level 0 — Static review
  Apakah perubahan terlihat risk-prone?
  Contoh: nested loop baru, query baru, regex baru, serialization path baru.

Level 1 — Unit/performance-sensitive test
  Apakah behavior tetap benar dan tidak melakukan side effect berlebihan?

Level 2 — Microbenchmark
  Apakah hot function / algorithm / mapper / serializer berubah cost-nya?

Level 3 — Component benchmark
  Apakah satu component dengan dependency fake/embedded tetap stabil?

Level 4 — Integration performance test
  Apakah service dengan DB/broker/cache nyata tetap stabil?

Level 5 — Load test / macrobenchmark
  Apakah service memenuhi target latency/throughput/error rate di workload realistis?

Level 6 — Soak/capacity test
  Apakah service stabil dalam durasi panjang dan saturasi bertahap?

Level 7 — Canary / production telemetry
  Apakah perubahan aman di real traffic?
```

Tidak semua pull request butuh Level 5. Tetapi perubahan berisiko tinggi harus naik level pembuktiannya.

Contoh:

| Perubahan | Bukti minimum yang masuk akal |
|---|---|
| Refactor kecil tanpa logic path panas | unit + integration test |
| Ganti mapper manual ke reflection mapper | JMH + allocation profile |
| Ubah query listing utama | integration test + explain plan + load slice |
| Ubah retry policy external API | component test + load test untuk retry amplification |
| Ubah JVM GC/heap config | controlled load test + GC/JFR artifact |
| Ganti thread model ke virtual threads | load test + thread/connection pool saturation check |
| Ubah serialization format event | contract test + throughput/allocation benchmark |

---

## 4. Apa Itu Performance Regression Pipeline?

Performance regression pipeline adalah sekumpulan tahap otomatis dan semi-otomatis untuk mendeteksi perubahan performa terhadap baseline.

Ia biasanya terdiri dari:

```text
1. Risk classification
2. Fast PR checks
3. Microbenchmark check
4. Component/integration performance check
5. Nightly macrobenchmark
6. Pre-release load/capacity test
7. Canary verification
8. Artifact retention and report
9. Release decision rule
```

Pipeline ini tidak harus selalu blocking. Beberapa tahap hanya informational, beberapa warning, beberapa menjadi hard gate.

Contoh level gate:

```text
PR fast checks               -> hard gate
JMH quick benchmark          -> warning or soft gate
Critical-path JMH benchmark  -> hard gate for high-risk modules
Nightly macrobenchmark       -> alert + ticket
Pre-release load test        -> hard release gate
Canary telemetry             -> progressive rollout gate
```

---

## 5. Performance Regression Tidak Sama dengan “Lebih Lambat Sedikit”

Tidak semua perlambatan layak memblokir release.

Kita perlu membedakan:

1. **Statistical significance**  
   Apakah perubahan angka cukup kuat dibanding noise?

2. **Practical significance**  
   Apakah perubahan itu cukup besar untuk berdampak pada user/cost/SLO?

3. **Risk significance**  
   Apakah perubahan terjadi di path kritikal?

4. **Trend significance**  
   Apakah ini bagian dari degradasi kumulatif?

Contoh:

```text
Case A:
- p50 mapper naik dari 1.1 us ke 1.2 us
- path hanya dipakai admin bulanan
- no allocation increase
=> mungkin tidak penting.

Case B:
- p99 API listing naik dari 450 ms ke 520 ms
- endpoint dipakai 80% traffic
- DB CPU naik
- GC allocation naik 25%
=> serius.

Case C:
- single PR hanya menaikkan latency 3%
- tetapi 8 PR terakhir masing-masing naik 2-4%
=> serius karena trend.
```

Top-tier engineer tidak hanya melihat satu angka. Mereka membaca konteks sistem.

---

## 6. Jenis Check dalam Pipeline

### 6.1 Static Performance Risk Check

Ini bisa manual di code review atau semi-otomatis.

Contoh red flag:

- loop nested baru pada data besar,
- `stream().filter().collect()` berulang dalam loop,
- regex dibuat ulang per request,
- `ObjectMapper` dibuat ulang per call,
- `DateTimeFormatter` mahal dibuat ulang,
- query baru tanpa index,
- fetch join yang bisa meledakkan result set,
- N+1 query,
- logging string concatenation di hot path,
- exception dipakai sebagai control flow,
- reflection intensif di request path,
- JSON serialization untuk deep object graph,
- retry tanpa budget,
- unbounded queue,
- thread pool baru per request,
- connection pool dinaikkan tanpa capacity DB,
- cache tanpa bound/TTL,
- JVM flag berubah tanpa benchmark.

Output dari tahap ini bukan angka, tetapi risk classification:

```text
LOW    -> normal tests only
MEDIUM -> run targeted benchmark or component perf test
HIGH   -> require JMH/load test artifact before merge/release
```

---

### 6.2 Unit + Integration Test sebagai Guardrail Correctness

Performance test tidak menggantikan correctness test.

Sebelum mengukur performa, pastikan behavior benar.

Misalnya untuk optimization:

```java
public PermissionDecision decide(User user, CaseRecord caseRecord) {
    // optimized implementation
}
```

Wajib ada test behavior:

```java
@Test
void officerCannotApproveCaseOutsideAssignedBranch() {
    User user = userBuilder().role("OFFICER").branch("A").build();
    CaseRecord record = caseBuilder().branch("B").status("UNDER_REVIEW").build();

    PermissionDecision decision = policy.decide(user, record, APPROVE);

    assertThat(decision.allowed()).isFalse();
    assertThat(decision.reason()).isEqualTo("CASE_OUTSIDE_ASSIGNED_BRANCH");
}
```

Baru setelah itu benchmark cost-nya.

Kesalahan umum:

```text
Mengoptimalkan kode yang behavior-nya belum diproteksi test.
```

Kalau benchmark mendorong refactor tetapi tidak ada correctness guardrail, risiko regression functional meningkat.

---

## 7. JMH dalam CI: Bisa, tetapi Harus Disiplin

JMH adalah tool utama untuk benchmark JVM karena ia menangani banyak jebakan umum seperti warmup, fork, measurement iteration, dan dead-code elimination. Tetapi JMH tetap tidak otomatis membuat benchmark valid. Ia mengukur apa yang kita desain untuk diukur.

JMH cocok untuk CI ketika:

- targetnya pure CPU / allocation / algorithm cost,
- dependency eksternal tidak dominan,
- fixture bisa dikontrol,
- benchmark tidak terlalu lama,
- runner cukup stabil,
- baseline tersedia,
- hasil disimpan sebagai artifact.

JMH kurang cocok sebagai PR hard gate ketika:

- CI runner sangat noisy,
- benchmark menyentuh DB/network,
- test terlalu panjang,
- perubahan kecil membuat hasil fluktuatif,
- benchmark tidak punya representative workload,
- threshold terlalu ketat.

### 7.1 Pisahkan JMH dari Unit Test

Jangan jalankan JMH sebagai unit test biasa.

Struktur project yang lebih aman:

```text
repo-root/
  service-core/
  service-api/
  service-benchmark/
    src/jmh/java/...
    pom.xml or build.gradle
```

Atau:

```text
repo-root/
  benchmarks/
    permission-policy-benchmark/
    serialization-benchmark/
    mapper-benchmark/
```

Alasannya:

- benchmark butuh forked JVM,
- benchmark punya dependency dan JVM args khusus,
- benchmark output harus artifact,
- benchmark tidak boleh bercampur dengan unit test report.

### 7.2 JMH Quick Check vs JMH Full Check

Gunakan dua profil.

Quick profile untuk PR:

```bash
java -jar target/benchmarks.jar \
  '.*PermissionPolicyBenchmark.*' \
  -wi 3 \
  -i 5 \
  -f 1 \
  -tu us \
  -rf json \
  -rff target/jmh-result-pr.json
```

Full profile untuk nightly/release:

```bash
java -jar target/benchmarks.jar \
  '.*' \
  -wi 10 \
  -i 15 \
  -f 3 \
  -tu us \
  -prof gc \
  -rf json \
  -rff target/jmh-result-full.json
```

PR check cepat memberi sinyal awal. Full check memberi bukti lebih kuat.

---

## 8. Baseline: Tanpa Baseline, Angka Tidak Bermakna

Benchmark result tunggal seperti ini tidak cukup:

```text
PermissionPolicyBenchmark.decide avgt 2.31 us/op
```

Pertanyaan penting:

```text
Dibanding apa?
Di mesin apa?
Dengan Java versi apa?
Dengan JVM args apa?
Dengan commit apa?
Dengan data apa?
Dengan noise berapa?
```

Baseline minimal harus memuat:

```json
{
  "benchmark": "PermissionPolicyBenchmark.decide",
  "commit": "a1b2c3d",
  "branch": "main",
  "javaVersion": "21.0.7",
  "jvmArgs": ["-Xms1g", "-Xmx1g", "-XX:+UseG1GC"],
  "os": "Linux",
  "cpu": "AMD EPYC ...",
  "containerCpuLimit": "2",
  "containerMemoryLimit": "4Gi",
  "score": 2.10,
  "scoreError": 0.08,
  "unit": "us/op",
  "allocationBytesPerOp": 384,
  "timestamp": "2026-06-16T00:00:00Z"
}
```

Baseline bisa berupa:

1. baseline dari `main` terbaru,
2. rolling baseline 7 hari,
3. last release baseline,
4. environment-specific baseline,
5. Java-version-specific baseline.

Untuk release gate, biasanya baseline paling relevan adalah:

```text
last known good release
```

Untuk PR gate, baseline paling relevan adalah:

```text
current target branch / main
```

---

## 9. Threshold: Jangan Terlalu Ketat, Jangan Terlalu Longgar

Threshold adalah aturan untuk memutuskan apakah hasil dianggap regression.

Contoh threshold sederhana:

```text
Fail if average time worsens by > 10%
Fail if allocation bytes/op worsens by > 20%
Fail if p99 latency worsens by > 15%
Fail if error rate > 0.1%
Fail if CPU/request worsens by > 10%
Fail if GC pause total > 2x baseline
```

Tetapi threshold harus mempertimbangkan:

- noise benchmark,
- path criticality,
- business SLO,
- baseline variance,
- test duration,
- environment stability,
- historical trend.

### 9.1 Threshold Berdasarkan Severity

Contoh:

| Area | Warning | Fail |
|---|---:|---:|
| JMH average time hot path | +5% | +10% |
| JMH allocation bytes/op | +10% | +25% |
| API p95 latency | +10% | +20% |
| API p99 latency | +10% | +15% |
| Error rate | >0.05% | >0.1% |
| CPU/request | +10% | +20% |
| DB query count/request | +1 query | +3 queries |
| GC pause p99 | +20% | +50% |
| Hikari pending connections | any sustained | sustained > 30s |

### 9.2 Threshold Berdasarkan Criticality

Endpoint critical harus lebih ketat.

```yaml
criticality:
  tier_0:
    description: "login, submit application, approve case, payment callback"
    p99_regression_fail: 10
    error_rate_fail: 0.05
  tier_1:
    description: "case listing, search, dashboard"
    p99_regression_fail: 15
    error_rate_fail: 0.1
  tier_2:
    description: "admin report, low-frequency batch"
    p99_regression_fail: 25
    error_rate_fail: 0.5
```

### 9.3 Absolute Threshold vs Relative Threshold

Relative threshold:

```text
Fail if p99 worsens by > 15% from baseline
```

Absolute threshold:

```text
Fail if p99 > 800 ms
```

Keduanya dibutuhkan.

Relative threshold menangkap regression walaupun masih dalam SLO.

Absolute threshold menjaga user-facing SLO.

Contoh:

```text
Baseline p99: 200 ms
Current p99: 260 ms
SLO: 800 ms
```

Secara SLO masih aman. Tetapi regression +30% harus dilihat karena bisa menjadi trend buruk.

---

## 10. Statistical Discipline

Performance pipeline harus sadar noise.

### 10.1 Jangan Bandingkan Satu Run dengan Satu Run

Buruk:

```text
Run 1 baseline: 100 ms
Run 1 current: 110 ms
=> regression 10%
```

Lebih baik:

```text
baseline runs: 98, 101, 99, 100, 102
current runs: 109, 111, 110, 108, 112
=> regression likely real
```

### 10.2 Gunakan Confidence / Variance

Untuk JMH, perhatikan:

- score,
- error,
- standard deviation,
- number of forks,
- iteration count.

Contoh interpretasi:

```text
Baseline: 100 ± 15 ns/op
Current: 108 ± 18 ns/op
```

Ini belum kuat. Rentang overlap besar.

```text
Baseline: 100 ± 2 ns/op
Current: 114 ± 3 ns/op
```

Ini lebih kuat.

### 10.3 Practical Significance Tetap Penting

Jika benchmark naik 3 ns/op, tetapi method dipanggil miliaran kali per hari, bisa penting.

Jika API admin naik 20 ms tetapi dipakai 5 kali per bulan, mungkin tidak prioritas.

Pipeline tidak boleh menggantikan judgment engineering.

---

## 11. Noise Control di CI

### 11.1 Dedicated Runner

Idealnya performance check dijalankan di runner khusus:

- instance type tetap,
- CPU governor stabil,
- tidak berbagi workload berat,
- thermal throttling rendah,
- OS image stabil,
- JDK version pinned,
- Docker image pinned,
- cgroup limit jelas.

Jika memakai shared CI runner, jangan jadikan JMH sebagai hard gate terlalu ketat.

### 11.2 Pin Java Version

Java version memengaruhi:

- JIT behavior,
- GC behavior,
- default JVM ergonomics,
- class library performance,
- virtual thread behavior,
- container awareness,
- TLS/crypto performance.

Pipeline harus mencatat:

```bash
java -version
java -XshowSettings:vm -version
java -XX:+PrintFlagsFinal -version
```

### 11.3 Pin JVM Args

Benchmark baseline tidak valid jika JVM args berubah diam-diam.

Simpan manifest:

```text
JDK: Eclipse Temurin 21.0.7+6
GC: G1
Heap: -Xms1g -Xmx1g
Container CPU: 2
Container memory: 4Gi
TieredCompilation: enabled
CompressedOops: enabled
```

### 11.4 Warmup dan Cache State

Untuk benchmark macro/load test, tentukan:

- apakah DB cache dingin atau panas,
- apakah application cache pre-warmed,
- apakah JIT warmup dilakukan,
- apakah connection pool sudah warm,
- apakah classloading sudah terjadi,
- apakah TLS handshake dipisah dari steady-state measurement.

---

## 12. Artifact Retention: Hasil Test Harus Bisa Diaudit

Setiap performance run penting harus menyimpan artifact.

Minimal untuk JMH:

```text
jmh-result.json
jmh-result.txt
java-version.txt
jvm-flags.txt
git-commit.txt
benchmark-manifest.json
```

Untuk load test:

```text
load-test-summary.json
latency-percentiles.csv
throughput-timeseries.csv
error-rate-timeseries.csv
jfr-recording.jfr
gc.log
thread-dumps/
heap-histo-before.txt
heap-histo-after.txt
container-metrics.csv
db-metrics.csv
app-logs-sampled.log
```

Untuk investigation:

```text
async-profiler-cpu.html
async-profiler-alloc.html
jcmd-vm-native-memory.txt
jcmd-thread-print.txt
jcmd-gc-heap-info.txt
```

Artifact harus diberi metadata:

```json
{
  "service": "case-management-service",
  "scenario": "case-listing-search-v3",
  "commit": "abc123",
  "branch": "release/2026-06",
  "java": "21.0.7",
  "image": "case-service:abc123",
  "environment": "perf-test",
  "startTime": "2026-06-16T10:00:00Z",
  "duration": "30m",
  "operator": "ci",
  "baseline": "release-2026-05"
}
```

Tanpa artifact, hasil performance test sering tidak bisa dipakai saat incident.

---

## 13. Example: JMH Regression Gate Script

Berikut contoh sederhana untuk membandingkan hasil JMH JSON.

> Ini bukan pengganti tool statistik lengkap, tetapi cukup untuk membangun mental model.

### 13.1 Contoh Struktur JSON Simplified

JMH JSON berisi entry benchmark dengan `primaryMetric`.

Script Python bisa membaca score dan allocation jika tersedia.

```python
#!/usr/bin/env python3
import json
import sys
from pathlib import Path

BASELINE = Path(sys.argv[1])
CURRENT = Path(sys.argv[2])
MAX_TIME_REGRESSION_PERCENT = float(sys.argv[3])


def load_scores(path):
    data = json.loads(path.read_text())
    scores = {}
    for item in data:
        name = item["benchmark"]
        metric = item["primaryMetric"]
        scores[name] = {
            "score": metric["score"],
            "scoreError": metric.get("scoreError"),
            "unit": metric.get("scoreUnit")
        }
    return scores

baseline = load_scores(BASELINE)
current = load_scores(CURRENT)

failed = False

for name, base in baseline.items():
    if name not in current:
        print(f"WARN missing benchmark in current result: {name}")
        continue

    cur = current[name]
    base_score = base["score"]
    cur_score = cur["score"]

    if base_score == 0:
        print(f"WARN baseline score is zero for {name}")
        continue

    change = ((cur_score - base_score) / base_score) * 100.0

    print(f"{name}: baseline={base_score:.4f} current={cur_score:.4f} change={change:+.2f}% {cur['unit']}")

    # For time-based benchmarks, higher is worse.
    if change > MAX_TIME_REGRESSION_PERCENT:
        print(f"FAIL {name}: regression {change:.2f}% > {MAX_TIME_REGRESSION_PERCENT:.2f}%")
        failed = True

if failed:
    sys.exit(1)
```

Usage:

```bash
python3 compare-jmh.py baseline.json current.json 10
```

Kelemahan script sederhana ini:

- belum membedakan benchmark mode,
- belum memperhitungkan `scoreError`,
- belum menangani throughput mode yang arah buruknya kebalik,
- belum memeriksa allocation secondary metrics,
- belum melakukan multiple-run statistics.

Tetapi prinsipnya benar: benchmark harus dibandingkan ke baseline, bukan dibaca sendirian.

---

## 14. CI Pipeline Example: Maven + JMH

Contoh GitHub Actions sederhana:

```yaml
name: performance-regression

on:
  pull_request:
    paths:
      - 'service-core/**'
      - 'benchmarks/**'
      - '.github/workflows/performance-regression.yml'

jobs:
  jmh-pr-check:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven

      - name: Print Java info
        run: |
          java -version
          java -XshowSettings:vm -version

      - name: Build benchmark jar
        run: mvn -pl benchmarks -am clean package -DskipTests

      - name: Run targeted JMH benchmarks
        run: |
          java -jar benchmarks/target/benchmarks.jar \
            '.*PermissionPolicyBenchmark.*' \
            -wi 3 -i 5 -f 1 -tu us \
            -rf json -rff benchmarks/target/jmh-current.json

      - name: Download baseline artifact
        run: |
          ./scripts/download-baseline.sh main benchmarks/jmh-baseline.json

      - name: Compare benchmark
        run: |
          python3 scripts/compare-jmh.py \
            benchmarks/jmh-baseline.json \
            benchmarks/target/jmh-current.json \
            10

      - name: Upload benchmark artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: jmh-result
          path: |
            benchmarks/target/jmh-current.json
            benchmarks/target/*.txt
```

Untuk organisasi serius, gunakan self-hosted runner khusus agar noise lebih rendah.

---

## 15. Gradle JMH Pipeline Pattern

Jika memakai Gradle, pisahkan task benchmark.

Contoh konseptual:

```kotlin
plugins {
    java
    id("me.champeau.jmh") version "0.7.2"
}

jmh {
    warmupIterations.set(3)
    iterations.set(5)
    fork.set(1)
    resultFormat.set("JSON")
    resultsFile.set(project.layout.buildDirectory.file("reports/jmh/results.json"))
}
```

Lalu CI:

```bash
./gradlew clean jmh \
  -PjmhInclude='.*PermissionPolicyBenchmark.*'
```

Namun untuk benchmark yang benar-benar penting, standalone benchmark jar tetap sering lebih mudah dikontrol.

---

## 16. Macrobenchmark / Load Test dalam Pipeline

Tidak semua performance regression terlihat di JMH.

Contoh regression yang tidak tertangkap JMH:

- connection pool saturation,
- DB index regression,
- thread pool queueing,
- retry storm,
- network timeout,
- GC akibat real payload,
- serialization graph terlalu besar,
- N+1 query,
- cache stampede,
- lock contention antar request,
- container CPU throttling.

Karena itu perlu macrobenchmark/load test.

### 16.1 Kategori Load Test Pipeline

```text
PR smoke load test
  Durasi: 2-5 menit
  Scope: endpoint critical kecil
  Gate: basic error/latency threshold

Nightly load test
  Durasi: 15-60 menit
  Scope: scenario utama
  Gate: alert + ticket

Pre-release load test
  Durasi: 30-120 menit
  Scope: workload realistis
  Gate: hard release gate

Soak test
  Durasi: 4-24 jam
  Scope: memory leak, cache growth, resource leak
  Gate: release readiness

Capacity test
  Durasi: bertahap sampai saturation
  Scope: max throughput and knee point
  Gate: capacity planning
```

### 16.2 k6 Threshold Example

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    steady_load: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/cases?status=UNDER_REVIEW`);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}
```

Threshold di sini bukan hanya laporan. Ia adalah pass/fail criteria.

### 16.3 Gatling Conceptual Scenario

```scala
class CaseListingSimulation extends Simulation {
  val httpProtocol = http
    .baseUrl(System.getProperty("baseUrl"))
    .acceptHeader("application/json")

  val scn = scenario("Case Listing")
    .exec(
      http("list under review cases")
        .get("/api/cases?status=UNDER_REVIEW")
        .check(status.is(200))
    )

  setUp(
    scn.inject(
      rampUsersPerSec(10).to(100).during(5.minutes),
      constantUsersPerSec(100).during(20.minutes)
    )
  ).protocols(httpProtocol)
   .assertions(
      global.responseTime.percentile3.lt(500),
      global.failedRequests.percent.lt(0.1)
   )
}
```

---

## 17. Performance Report yang Berguna

Report yang buruk:

```text
Load test pass.
```

Report yang baik:

```text
Scenario: case listing steady 100 RPS, 10 minutes
Baseline: release-2026.05
Current: commit abc123

Result:
- Throughput: 100 RPS target achieved
- Error rate: 0.00% PASS
- p50: 120 ms vs baseline 115 ms (+4.3%) PASS
- p95: 310 ms vs baseline 280 ms (+10.7%) WARN
- p99: 690 ms vs baseline 520 ms (+32.7%) FAIL
- CPU avg: 68% vs baseline 52% (+30.8%) FAIL
- GC pause p99: 18 ms vs baseline 12 ms (+50%) WARN
- Allocation rate: 820 MB/s vs baseline 530 MB/s (+54.7%) FAIL
- Hikari pending: sustained > 0 for 4m FAIL

Likely bottleneck:
- New DTO mapping allocates large nested response object.
- DB query count/request increased from 3 to 9.

Artifacts:
- JFR: jfr/case-listing-abc123.jfr
- GC log: gc/gc-abc123.log
- k6 summary: k6/summary-abc123.json
- async-profiler alloc: profiler/alloc-abc123.html

Decision:
- Block release until query count and allocation regression are addressed.
```

Report harus menjawab:

```text
What changed?
How much?
Compared to what?
Is it significant?
Why likely happened?
What artifact supports it?
What decision is recommended?
```

---

## 18. PR Comment Template

Gunakan format ringkas agar reviewer cepat paham.

```md
## Performance Regression Check

Commit: `abc123`
Baseline: `main@def456`
Java: `21.0.7`
Runner: `perf-runner-01`

### Summary

| Check | Result |
|---|---|
| JMH hot-path benchmark | FAIL |
| Allocation regression | FAIL |
| API smoke load test | PASS |
| Artifact uploaded | YES |

### JMH Result

| Benchmark | Baseline | Current | Change | Status |
|---|---:|---:|---:|---|
| PermissionPolicy.decide | 2.10 us/op | 2.46 us/op | +17.1% | FAIL |
| PermissionPolicy.decide:alloc | 384 B/op | 672 B/op | +75.0% | FAIL |

### Load Smoke Result

| Metric | Baseline | Current | Status |
|---|---:|---:|---|
| p95 | 280 ms | 295 ms | PASS |
| p99 | 510 ms | 540 ms | PASS |
| error rate | 0.00% | 0.00% | PASS |

### Suggested Action

Investigate allocation increase in `PermissionPolicy`. See attached JFR and JMH GC profiler output.
```

---

## 19. Release Gate Decision Model

Performance gate harus punya decision rule eksplisit.

Contoh:

```text
BLOCK release if:
- any tier-0 endpoint violates absolute SLO,
- any tier-0 endpoint p99 worsens > 10% without approved exception,
- error rate exceeds threshold,
- throughput capacity drops > 15%,
- sustained pool saturation appears below target load,
- OOM, Full GC storm, or uncontrolled memory growth occurs,
- retry amplification exceeds defined budget,
- performance artifact missing for high-risk change.

WARN but allow if:
- non-critical endpoint worsens < threshold,
- JMH regression is below practical significance,
- environment noise invalidates one run but rerun passes,
- regression has documented risk acceptance.

ALLOW if:
- metrics within threshold,
- artifact complete,
- no negative trend,
- canary plan exists for risky area.
```

### 19.1 Risk Acceptance Format

Kadang regression diterima karena ada tradeoff.

Misalnya:

- security fix menambah CPU,
- audit completeness menambah write overhead,
- stricter validation menambah latency kecil,
- encryption/compression menambah CPU tetapi mengurangi network.

Dokumentasikan:

```md
# Performance Risk Acceptance

Change: Enable field-level audit hash verification
Regression: Submit Application p95 +8%, CPU/request +6%
Reason: Security/compliance requirement
SLO Impact: Still below p95 target 800 ms
Mitigation: Monitor CPU/request and p99 for 7 days after release
Rollback: feature flag `audit.hashVerification.enabled=false`
Approver: Engineering Lead + Product Owner
Expiry: Revisit after release + 30 days
```

Risk acceptance harus eksplisit, bukan diam-diam.

---

## 20. Canary Feedback Loop

CI tidak pernah sempurna. Production traffic tetap sumber kebenaran paling kaya.

Canary release harus memantau:

- request rate,
- error rate,
- p50/p95/p99 latency,
- CPU per pod,
- memory RSS,
- heap usage,
- GC pause,
- allocation rate jika tersedia,
- thread count,
- virtual thread pinned events jika relevan,
- Hikari active/idle/pending,
- HTTP client pending/acquire time,
- retry count,
- timeout count,
- queue depth,
- DB CPU/IO/wait,
- cache hit rate,
- external API latency.

Canary gate:

```text
5% traffic for 30 minutes
  if healthy -> 25% traffic for 30 minutes
    if healthy -> 50% traffic for 30 minutes
      if healthy -> 100%
```

Rollback rule harus otomatis atau sangat jelas:

```text
Rollback if:
- p99 > baseline + 20% for 10 minutes
- error rate > 0.1% for 5 minutes
- pod restart count increases
- Hikari pending sustained > 0 for 5 minutes
- CPU throttling sustained > 20%
```

---

## 21. Java 8–25 Compatibility Notes

### Java 8

- JMH tetap bisa dipakai, tetapi pastikan versi dependency kompatibel.
- GC logging memakai legacy flags:

```bash
-XX:+PrintGCDetails
-XX:+PrintGCDateStamps
-Xloggc:gc.log
```

- JFR pada Java 8 tersedia tergantung distribusi/update dan licensing historis; jangan asumsikan sama seperti Java 11+.
- Container awareness lebih terbatas dibanding Java modern.
- Banyak project legacy masih memakai JUnit 4 atau JUnit 5 versi yang mendukung Java 8.

### Java 11

- Unified logging sudah tersedia:

```bash
-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags
```

- JFR menjadi lebih umum dipakai.
- G1 menjadi baseline umum untuk service.
- Container support lebih baik daripada Java 8.

### Java 17

- Baseline modern enterprise.
- JUnit 6 mensyaratkan Java 17+.
- Banyak library modern menjadikan 17 sebagai minimum.
- JFR/JMC workflow lebih matang.

### Java 21

- Virtual threads production-ready.
- Performance regression pipeline perlu menambahkan check untuk:
  - carrier thread saturation,
  - pinning,
  - connection pool bottleneck,
  - blocking IO behavior,
  - thread dump interpretasi baru.

### Java 25

- Treat sebagai modern/current line dalam seri ini.
- Pastikan semua benchmark dan load test mencatat Java 25-specific behavior.
- Jangan membandingkan hasil Java 17 vs Java 25 tanpa menyatakan bahwa runtime berubah.

Prinsip utama:

```text
Baseline harus per Java version.
```

Tidak valid membandingkan:

```text
baseline Java 17
current Java 25
```

tanpa menyatakan bahwa runtime upgrade adalah bagian dari perubahan yang sedang diuji.

---

## 22. Performance Regression untuk Database-heavy Java Service

Banyak service Java bottleneck-nya bukan di CPU Java, tetapi di DB.

Pipeline harus memantau:

- query count per request,
- query latency percentile,
- connection acquisition time,
- Hikari active/idle/pending,
- transaction duration,
- lock wait,
- deadlock count,
- DB CPU,
- DB IO,
- slow query log,
- explain plan change,
- result set size,
- pagination correctness.

### 22.1 Query Count Gate

Tambahkan test atau instrumentation untuk endpoint critical.

Contoh threshold:

```text
GET /api/cases/search
  baseline query count: 4
  warning: > 5
  fail: > 7
```

Karena N+1 sering terlihat sebagai:

```text
small data test: pass
JMH: not relevant
load test: p99 explodes
DB CPU: high
```

### 22.2 Connection Pool Gate

Hikari metrics yang penting:

```text
hikaricp.connections.active
hikaricp.connections.idle
hikaricp.connections.pending
hikaricp.connections.timeout
hikaricp.connections.acquire
hikaricp.connections.usage
```

Fail condition:

```text
pending connections sustained > 0 under expected load
```

Bukan berarti pending tidak pernah boleh muncul, tetapi sustained pending di load target sering menandakan bottleneck.

---

## 23. Performance Regression untuk Event-driven Service

Untuk consumer/worker, metrik berbeda.

Monitor:

- consume rate,
- produce rate,
- lag,
- queue depth,
- processing latency,
- retry count,
- DLQ count,
- batch size,
- commit latency,
- duplicate handling,
- idempotency table growth,
- DB writes per message,
- memory growth,
- GC under backlog.

Gate example:

```text
Under 10k messages backlog:
- lag must drain within 15 minutes
- DLQ count must be 0
- p95 processing latency < 250 ms
- DB connection pending must not be sustained
- heap after drain must return near baseline
```

Event-driven performance regression sering muncul sebagai backlog, bukan API latency.

---

## 24. Performance Regression untuk Batch Job

Batch job tidak selalu butuh p99 latency, tetapi butuh:

- completion time,
- throughput records/sec,
- memory high-water mark,
- GC overhead,
- DB batch size,
- retry count,
- failure recovery time,
- checkpoint correctness,
- restartability.

Gate example:

```text
Nightly archival job:
- 1M records must complete < 45 minutes
- memory RSS must stay < 3 GiB
- no Full GC storm
- restart from checkpoint must not duplicate records
- DB CPU must stay below agreed threshold
```

Batch performance regression bisa mengganggu operational window walaupun user-facing API sehat.

---

## 25. Performance Regression untuk Regulatory / Case Management Platform

Untuk sistem case management, test performance harus mengikuti journey bisnis.

Scenario penting:

```text
1. Officer opens dashboard
2. Search cases by status/branch/SLA
3. Open case detail
4. Upload/review documents
5. Add minute/note
6. Submit recommendation
7. Approver reviews
8. Decision issued
9. Audit trail viewed
10. Correspondence generated
```

Metrik per journey:

| Step | Metric penting |
|---|---|
| Dashboard | p95/p99, query count, cache hit |
| Search/listing | p99, DB CPU, index usage, result size |
| Case detail | payload size, serialization cost, document metadata query |
| Submit decision | transaction time, lock wait, audit insert, event publish |
| Audit trail | pagination, LOB access, query plan |
| Report | completion time, memory, DB IO |

Jangan hanya load test homepage atau health endpoint. Itu tidak membuktikan platform mampu memproses workflow nyata.

---

## 26. Observability as Regression Data

Performance pipeline sebaiknya menggunakan metric yang sama dengan production.

Minimal app metrics:

```text
http.server.requests count/latency/error
jvm.memory.used
jvm.gc.pause
jvm.threads.live
jvm.buffer.memory.used
process.cpu.usage
system.cpu.usage
executor.active
executor.queued
hikaricp.connections.active
hikaricp.connections.pending
resilience4j.retry.calls
resilience4j.circuitbreaker.state
```

Jika metric CI dan production berbeda, hasil CI sulit dikorelasikan.

### 26.1 Trace-based Regression

Distributed tracing bisa mendeteksi:

- span baru yang mahal,
- query count bertambah,
- downstream call bertambah,
- retry bertambah,
- serialization/deserialization hotspot,
- lock wait.

Contoh regression:

```text
Before:
GET /cases/{id}
  DB case: 20 ms
  DB documents: 15 ms
  DB audit summary: 10 ms

After:
GET /cases/{id}
  DB case: 20 ms
  DB documents: 15 ms
  DB audit summary: 10 ms
  DB full audit trail: 180 ms
```

Functional output mungkin sama, tetapi trace menunjukkan regression jelas.

---

## 27. Anti-Patterns

### 27.1 Benchmark sebagai Dekorasi

Benchmark ada, tetapi:

- tidak dijalankan CI,
- tidak punya baseline,
- tidak punya threshold,
- tidak ada owner,
- tidak pernah dibaca.

Ini bukan performance engineering. Ini dokumentasi mati.

### 27.2 Threshold Copy-paste

Threshold dari internet tidak tahu:

- workload kamu,
- SLO kamu,
- hardware kamu,
- noise kamu,
- criticality kamu.

Threshold harus dikalibrasi.

### 27.3 Satu Load Test untuk Semua Keputusan

Satu test “100 users for 10 minutes” tidak menjawab semua hal.

Perlu scenario berbeda untuk:

- smoke,
- steady load,
- stress,
- spike,
- soak,
- capacity,
- failover,
- backlog drain.

### 27.4 Membandingkan Environment Berbeda

Buruk:

```text
baseline run di laptop
current run di CI
```

Atau:

```text
baseline Java 17
current Java 25
```

Atau:

```text
baseline DB warm cache
current DB cold cache
```

### 27.5 Mengabaikan Allocation

Latency mungkin belum naik, tetapi allocation naik 2x.

Ini bisa menjadi future GC problem ketika traffic naik.

### 27.6 Mengabaikan Tail Latency

Rata-rata latency bisa stabil sementara p99 rusak.

User biasanya merasakan tail latency, bukan average.

### 27.7 Load Test Tanpa Downstream Constraint

Jika downstream fake terlalu cepat, test tidak realistis.

Jika downstream nyata tetapi tidak dikontrol, test tidak reproducible.

### 27.8 Hard Gate Terlalu Noisy

Jika gate sering fail karena noise, tim akan mengabaikannya.

Lebih baik:

```text
soft gate + trend + manual review
```

daripada hard gate palsu.

---

## 28. Step-by-Step: Membangun Performance Regression Pipeline dari Nol

### Step 1 — Pilih Critical Path

Jangan mulai dari semua endpoint.

Pilih 3-5 path:

```text
- Login / token exchange
- Case search/listing
- Case detail
- Submit decision
- Audit trail listing
```

### Step 2 — Definisikan SLO / Performance Expectation

Contoh:

```yaml
GET /api/cases:
  p95: 500ms
  p99: 1000ms
  errorRate: <0.1%
  expectedThroughput: 100rps
```

### Step 3 — Tambahkan Observability

Pastikan metric tersedia:

```text
latency
error rate
throughput
CPU
heap
GC
DB pool
query count
retry count
```

### Step 4 — Buat Benchmark Targeted

Untuk hot code:

```text
PermissionPolicyBenchmark
CaseSearchMapperBenchmark
AuditTrailSerializationBenchmark
```

### Step 5 — Buat Load Test Smoke

Durasi singkat, target endpoint penting.

### Step 6 — Buat Nightly Full Test

Scenario lebih realistis, artifact lengkap.

### Step 7 — Buat Baseline Store

Simpan per:

```text
service
scenario
branch/release
Java version
environment
```

### Step 8 — Buat Comparator

Bandingkan:

```text
current vs baseline
current vs rolling average
current vs SLO
```

### Step 9 — Definisikan Gate

Pisahkan:

```text
warning
fail
manual review
risk acceptance
```

### Step 10 — Integrasikan ke Release Process

Release checklist:

```text
[ ] All critical scenario below SLO
[ ] No tier-0 regression above threshold
[ ] JFR/GC artifacts retained
[ ] Capacity headroom documented
[ ] Canary rollback rule ready
```

---

## 29. Minimal Repository Layout

Contoh struktur praktis:

```text
repo-root/
  service-core/
  service-api/
  benchmarks/
    pom.xml
    src/jmh/java/
      com/acme/benchmark/PermissionPolicyBenchmark.java
      com/acme/benchmark/CaseSearchMapperBenchmark.java
  performance/
    load/
      k6/
        case-listing.js
        submit-decision.js
      gatling/
    baselines/
      README.md
    thresholds/
      performance-thresholds.yml
    scripts/
      compare-jmh.py
      compare-k6.js
      collect-jvm-artifacts.sh
      download-baseline.sh
      upload-baseline.sh
    reports/
      README.md
  .github/workflows/
    pr-performance-smoke.yml
    nightly-performance.yml
    release-performance-gate.yml
```

---

## 30. Threshold Configuration Example

```yaml
service: case-management-service
javaVersions:
  - 17
  - 21
  - 25

benchmarks:
  PermissionPolicyBenchmark.decide:
    mode: average_time
    unit: us/op
    criticality: tier_0
    warningRegressionPercent: 5
    failRegressionPercent: 10
    allocationWarningPercent: 10
    allocationFailPercent: 25

  CaseSearchMapperBenchmark.mapPage:
    mode: average_time
    unit: us/op
    criticality: tier_1
    warningRegressionPercent: 10
    failRegressionPercent: 20
    allocationWarningPercent: 20
    allocationFailPercent: 40

loadScenarios:
  case_listing:
    endpoint: GET /api/cases
    criticality: tier_1
    targetRps: 100
    duration: 10m
    absolute:
      p95Ms: 500
      p99Ms: 1000
      errorRatePercent: 0.1
    relative:
      p95RegressionPercent: 15
      p99RegressionPercent: 15
    resources:
      maxCpuPercent: 75
      maxHeapUsedPercent: 70
      sustainedHikariPendingAllowed: false

  submit_decision:
    endpoint: POST /api/cases/{id}/decision
    criticality: tier_0
    targetRps: 30
    duration: 10m
    absolute:
      p95Ms: 700
      p99Ms: 1200
      errorRatePercent: 0.05
    relative:
      p95RegressionPercent: 10
      p99RegressionPercent: 10
    resources:
      maxCpuPercent: 70
      sustainedHikariPendingAllowed: false
```

---

## 31. Capstone Mini Case: Regression karena Audit Enhancement

### 31.1 Context

Sebuah PR menambahkan audit enhancement:

```text
Setiap kali case detail dibuka, sistem menampilkan latest 20 audit entries.
```

Functional test pass.

### 31.2 Performance Check

PR load smoke result:

```text
GET /api/cases/{id}
Baseline p99: 420 ms
Current p99: 760 ms
Regression: +81%
```

DB metrics:

```text
query count/request: 5 -> 27
DB CPU: 45% -> 78%
Hikari pending: sustained 3 minutes
```

JFR:

```text
High allocation in AuditTrailDtoMapper
Large String/CLOB conversion
```

Trace:

```text
New span: SELECT audit_trail.full_text for each entry
```

### 31.3 Diagnosis

Root cause:

```text
Audit preview fetches CLOB full_text for 20 entries even though UI only displays summary.
```

Contributing factor:

```text
Mapper serializes full nested metadata.
No projection query.
No pagination boundary.
```

### 31.4 Fix

- Use projection query for audit summary.
- Do not fetch CLOB unless user opens audit detail.
- Add index for `(case_id, created_date_time desc)` if needed.
- Add test for query count.
- Add load test threshold for case detail.

### 31.5 Regression Prevention

New gate:

```yaml
GET /api/cases/{id}:
  maxQueryCount: 8
  p99RegressionFail: 15
  sustainedHikariPendingAllowed: false
```

This is performance engineering as lifecycle, not one-time tuning.

---

## 32. Practical Checklist

Before merging performance-sensitive PR:

```text
[ ] Correctness tests cover old and new behavior
[ ] Risk classification assigned
[ ] Hot path identified
[ ] JMH exists or not needed with reason
[ ] Load test needed or not needed with reason
[ ] Baseline selected
[ ] Java version and JVM args recorded
[ ] Allocation checked for hot path
[ ] DB query count checked if relevant
[ ] Pool saturation checked if relevant
[ ] Tail latency checked, not only average
[ ] Artifacts uploaded
[ ] Regression decision documented
```

Before release:

```text
[ ] Critical load scenarios pass absolute SLO
[ ] Critical load scenarios pass relative regression threshold
[ ] No unexplained p99 regression
[ ] No sustained connection pool pending
[ ] No uncontrolled memory growth
[ ] No Full GC storm / severe GC pressure
[ ] No retry amplification
[ ] JFR and GC logs retained
[ ] Canary rollback conditions defined
[ ] Risk acceptance documented if needed
```

---

## 33. Top 1% Engineer Notes

Performance regression pipeline yang matang memiliki ciri-ciri berikut:

1. **Tidak semua hal dijadikan hard gate.**  
   Gate yang terlalu noisy akan dibenci dan diabaikan.

2. **Critical path mendapat perlakuan berbeda.**  
   Submit decision, payment callback, login, and case search tidak boleh disamakan dengan admin export bulanan.

3. **Baseline adalah artifact engineering.**  
   Ia harus versioned, traceable, dan comparable.

4. **JMH dipakai untuk pertanyaan mikro, bukan untuk membuktikan seluruh sistem.**

5. **Load test dipakai untuk pertanyaan sistem, bukan untuk membuktikan cost method kecil.**

6. **CI result harus bisa direproduksi.**  
   Java version, JVM args, container limit, commit, dataset, dan scenario harus tercatat.

7. **Trend lebih penting daripada satu run.**  
   Banyak regression besar berasal dari akumulasi regression kecil.

8. **Performance decision adalah risk decision.**  
   Kadang regression diterima karena security/compliance. Tetapi harus eksplisit.

9. **Production telemetry menutup loop.**  
   CI hanya prediksi. Canary/production membuktikan dampak nyata.

10. **Performance bukan fase akhir.**  
    Ia harus masuk design review, code review, CI, release gate, dan incident learning.

---

## 34. Summary

Part ini membahas bagaimana membangun performance regression pipeline untuk Java service modern.

Inti pembahasannya:

- Performance regression adalah bug, tetapi pembuktiannya probabilistik dan kontekstual.
- JMH berguna untuk microbenchmark hot path, tetapi harus punya baseline, threshold, artifact, dan noise control.
- Load test/macrobenchmark dibutuhkan untuk melihat behavior sistem: pool saturation, DB bottleneck, GC, retry storm, p99 latency, dan capacity envelope.
- Threshold harus menggabungkan absolute SLO dan relative regression.
- CI performance result harus menyimpan artifact: JMH JSON, JFR, GC log, profiler output, metric timeseries, manifest runtime.
- Release gate harus eksplisit: block, warn, allow, atau risk acceptance.
- Java 8–25 compatibility penting karena runtime behavior, JIT, GC, container awareness, JFR, dan virtual threads berbeda.
- Pipeline yang baik tidak hanya mengukur performa; ia menciptakan feedback loop agar regression tidak menjadi kejutan production.

Performance engineering yang matang bukan “optimasi setelah lambat”.

Performance engineering yang matang adalah:

```text
designing evidence loops so the system cannot silently become slow.
```

---

## 35. Referensi

- OpenJDK JMH — Java Microbenchmark Harness.
- OpenJDK JMH GitHub repository and samples.
- Grafana k6 documentation — thresholds and scenarios.
- Gatling documentation — CI/CD performance automation.
- Oracle Java command documentation.
- Oracle Java GC tuning and troubleshooting documentation.
- JDK Flight Recorder documentation.
- Async-profiler documentation.
- HikariCP pool sizing documentation.
- Research on JVM microbenchmark representativeness and performance evolution in Java projects.

---

## Status Seri

Part ini adalah **Part 030 dari 031**.

Seri **belum selesai**.

Sisa berikutnya:

```text
Part 031 — Capstone: Full Performance Investigation from Symptom to JVM Configuration
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Performance Engineering for Services: Thread Pool, Connection Pool, Backpressure, Timeout](./learn-java-testing-benchmarking-performance-jvm-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Full Performance Investigation from Symptom to JVM Configuration](./learn-java-testing-benchmarking-performance-jvm-part-031.md)
