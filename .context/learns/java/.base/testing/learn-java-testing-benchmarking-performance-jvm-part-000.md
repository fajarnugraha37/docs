# learn-java-testing-benchmarking-performance-jvm-part-000

# Orientation: Testing, Benchmarking, Performance Engineering, dan JVM sebagai Satu Sistem

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `000`  
> Target Java: Java 8 sampai Java 25  
> Fokus: fondasi mental model sebelum masuk ke testing framework, benchmark harness, profiling, GC, dan JVM configuration.

---

## 0. Kenapa Part Ini Penting

Banyak engineer belajar topik ini secara terpisah:

- belajar JUnit sebagai “cara menulis test”;
- belajar Mockito sebagai “cara mock dependency”;
- belajar JMH sebagai “cara mengukur method mana lebih cepat”;
- belajar GC flag sebagai “cara tuning JVM”;
- belajar profiler saat production sudah bermasalah.

Pendekatan seperti itu membuat skill terasa banyak, tetapi mental model-nya lemah. Engineer bisa tahu banyak tool, tetapi salah membaca bukti.

Seri ini memakai premis berbeda:

> Testing, benchmarking, performance engineering, dan JVM configuration adalah satu rantai pembuktian engineering.

Artinya:

- testing menjawab: **apakah behavior benar?**
- benchmark menjawab: **berapa cost operasi tertentu dalam kondisi terkontrol?**
- profiling menjawab: **di mana waktu, CPU, allocation, blocking, atau memory benar-benar habis?**
- load test menjawab: **bagaimana sistem berperilaku saat workload realistis?**
- JVM configuration menjawab: **bagaimana runtime harus dibatasi dan diarahkan agar sesuai dengan workload?**
- observability production menjawab: **apakah asumsi kita tetap benar di dunia nyata?**

Jika salah satu lapisan hilang, keputusan menjadi rapuh.

Contoh sederhana:

```text
Unit test pass
  tetapi query lambat di production.

JMH benchmark cepat
  tetapi p99 latency tetap buruk karena connection pool saturated.

GC flag diubah
  tetapi root cause sebenarnya allocation burst dari JSON serialization.

Load test bagus
  tetapi data test tidak mencerminkan real distribution.

Profiler menunjukkan CPU tinggi di method tertentu
  tetapi bottleneck sebenarnya queueing karena retry storm.
```

Part ini membangun peta berpikir agar bagian-bagian berikutnya tidak dipahami sebagai kumpulan tool acak.

---

## 1. Tujuan Pembelajaran Part 000

Setelah menyelesaikan part ini, kamu harus bisa:

1. membedakan testing, benchmarking, profiling, load testing, dan JVM tuning secara presisi;
2. memahami kapan suatu bukti cukup kuat dan kapan masih misleading;
3. melihat Java application sebagai sistem berlapis: code, runtime, OS, container, dependency, dan workload;
4. menyusun “evidence ladder” untuk investigasi correctness dan performance;
5. menghindari common trap engineer yang hanya mengandalkan coverage, benchmark angka tunggal, atau JVM flag copy-paste;
6. memahami peta besar tool yang akan dipakai di seri ini;
7. memahami kenapa Java 8–25 harus diperlakukan sebagai rentang kompatibilitas, bukan satu versi tunggal;
8. membangun baseline vocabulary untuk semua part berikutnya.

---

## 2. Big Picture: Satu Sistem, Bukan Empat Topik Terpisah

Bayangkan Java service enterprise yang punya karakteristik berikut:

- menerima HTTP request;
- melakukan authorization;
- membaca dan menulis database;
- menerbitkan event;
- menjalankan scheduler;
- memakai cache;
- memanggil external API;
- berjalan di container/Kubernetes;
- punya SLA latency;
- harus menyimpan audit trail;
- harus defensible secara regulatory.

Untuk sistem seperti ini, pertanyaan engineering tidak cukup hanya:

```text
Apakah method ini benar?
```

Pertanyaan yang lebih lengkap:

```text
Apakah behavior benar?
Apakah error semantics benar?
Apakah state transition valid?
Apakah audit trail terbentuk?
Apakah retry aman?
Apakah operasi idempotent?
Apakah concurrency aman?
Apakah query scalable?
Apakah allocation rate masuk akal?
Apakah GC stabil?
Apakah p99 latency memenuhi SLO?
Apakah konfigurasi JVM cocok dengan container limit?
Apakah production telemetry membuktikan asumsi kita?
```

Karena itu, seri ini akan memperlakukan testing dan performance sebagai satu lifecycle:

```text
Requirement / Risk
    ↓
Behavior Model
    ↓
Correctness Test
    ↓
Integration Test
    ↓
Concurrency Correctness Test
    ↓
Microbenchmark / Component Benchmark
    ↓
Profiling
    ↓
Macrobenchmark / Load Test
    ↓
JVM + Runtime Configuration
    ↓
Production Observation
    ↓
Regression Guard
```

Siklus ini tidak selalu linear. Dalam real project, sering terjadi loop:

```text
Production incident
  → telemetry
  → hypothesis
  → reproduce
  → focused test
  → benchmark/profiling
  → fix
  → regression test
  → load verification
  → deploy/canary
```

Top-tier engineer tidak hanya “menulis test” atau “men-tune JVM”. Mereka membangun sistem bukti.

---

## 3. Empat Pertanyaan Fundamental

Semua materi dalam seri ini bisa dikembalikan ke empat pertanyaan:

## 3.1 Apakah sistem benar?

Ini domain testing.

Benar bukan berarti “tidak throw exception”. Benar berarti behavior sesuai contract.

Contoh contract:

```text
Jika application sudah SUBMITTED, user biasa tidak boleh mengubah field tertentu.
Jika officer approve case, audit trail harus mencatat actor, timestamp, previous state, new state, dan reason.
Jika external API timeout, request tidak boleh membuat duplicate side effect.
Jika event diterima dua kali, consumer harus idempotent.
```

Testing harus mengikat behavior seperti ini.

## 3.2 Berapa cost-nya?

Ini domain benchmarking.

Cost bisa berupa:

- waktu eksekusi;
- CPU cycle;
- allocation;
- memory footprint;
- lock contention;
- IO wait;
- serialization overhead;
- context switching;
- startup time;
- warmup time.

Benchmark tidak otomatis menjawab apakah sistem cepat di production. Benchmark hanya menjawab pertanyaan terbatas dalam kondisi tertentu.

Pertanyaan benchmark yang baik:

```text
Dalam JVM yang sudah warm, dengan input size N, apakah implementation A mengalokasikan lebih sedikit object daripada implementation B?
```

Pertanyaan benchmark yang buruk:

```text
Method mana paling cepat secara umum?
```

## 3.3 Di mana bottleneck sebenarnya?

Ini domain profiling dan diagnostics.

Bottleneck bisa berada di:

- CPU;
- allocation;
- GC;
- lock contention;
- database;
- network;
- serialization;
- connection pool;
- thread pool;
- queue;
- logging;
- class loading;
- JIT warmup;
- native memory;
- container CPU throttling.

Profiler dan diagnostic tools membantu membedakan dugaan dari fakta.

## 3.4 Bagaimana runtime harus dikonfigurasi?

Ini domain JVM arguments dan JVM configuration.

Konfigurasi JVM bukan dimulai dari daftar flag. Konfigurasi JVM harus dimulai dari workload dan constraint:

```text
Apakah ini API latency-sensitive?
Apakah ini batch throughput-heavy?
Apakah service berjalan di Kubernetes dengan memory limit ketat?
Apakah allocation rate tinggi?
Apakah live set besar?
Apakah startup time penting?
Apakah tail latency lebih penting daripada throughput rata-rata?
Apakah workload blocking IO atau CPU-bound?
```

Baru setelah itu kita memilih:

- heap size;
- GC collector;
- GC target pause;
- direct memory budget;
- metaspace limit;
- thread stack size;
- container memory percentage;
- JFR settings;
- logging;
- diagnostic flags;
- module/classpath options;
- compatibility flags.

---

## 4. Evidence Ladder: Tangga Bukti Engineering

Salah satu mental model paling penting dalam seri ini adalah **evidence ladder**.

Tidak semua bukti punya kekuatan yang sama. Bukti juga bisa menjawab pertanyaan yang berbeda.

```text
Level 0 — Opinion
Level 1 — Code inspection
Level 2 — Unit test
Level 3 — Integration/component test
Level 4 — Contract/concurrency/property/mutation evidence
Level 5 — Microbenchmark
Level 6 — Profiling/diagnostic evidence
Level 7 — Macrobenchmark/load/stress/soak evidence
Level 8 — Production telemetry
Level 9 — Regression guard + runbook + operational feedback
```

## 4.1 Level 0 — Opinion

Contoh:

```text
Sepertinya lambat karena GC.
Sepertinya stream lebih lambat dari loop.
Sepertinya mock test sudah cukup.
Sepertinya kalau Xmx dinaikkan masalah selesai.
```

Opinion boleh menjadi awal hypothesis, tetapi tidak boleh menjadi final decision.

## 4.2 Level 1 — Code Inspection

Code inspection dapat menemukan:

- bug obvious;
- race obvious;
- query N+1;
- missing timeout;
- retry tanpa limit;
- shared mutable state;
- resource leak;
- inefficient algorithm.

Tetapi code inspection sering gagal mendeteksi:

- real workload distribution;
- JIT effect;
- GC behavior;
- database execution plan;
- lock contention;
- tail latency;
- memory retention;
- production traffic shape.

## 4.3 Level 2 — Unit Test

Unit test membuktikan behavior kecil secara cepat dan deterministik.

Kuat untuk:

- domain logic;
- validation;
- mapping;
- calculation;
- state transition;
- error semantics;
- idempotency logic.

Lemah untuk:

- database behavior nyata;
- serialization compatibility penuh;
- network behavior;
- concurrency race;
- performance;
- GC;
- container constraints.

## 4.4 Level 3 — Integration/Component Test

Integration test membuktikan boundary dengan dependency nyata atau semi-nyata.

Kuat untuk:

- SQL correctness;
- transaction behavior;
- schema constraint;
- REST serialization;
- message publish/consume;
- containerized dependency;
- configuration wiring.

Lemah jika:

- datanya terlalu kecil;
- dependency diganti fake yang tidak representatif;
- test environment terlalu berbeda dari production;
- assertion hanya status code tanpa business verification.

## 4.5 Level 4 — Contract, Property, Mutation, Concurrency Evidence

Ini lapisan untuk risiko yang tidak cukup dibuktikan dengan example-based test biasa.

Contoh:

- consumer-driven contract test membuktikan compatibility antarservice;
- property-based test membuktikan invariant untuk banyak input;
- mutation testing menguji apakah test benar-benar mendeteksi perubahan salah;
- jcstress menguji concurrency behavior yang bergantung pada memory model dan interleaving.

## 4.6 Level 5 — Microbenchmark

Microbenchmark menjawab cost operasi kecil.

Contoh:

```text
Apakah parser A lebih sedikit allocation dari parser B?
Apakah cache key generation ini bottleneck?
Apakah mapper reflection-based jauh lebih mahal dari generated mapper?
Apakah lock-free structure benar-benar lebih baik untuk workload ini?
```

Microbenchmark kuat untuk mengukur komponen kecil. Lemah untuk menyimpulkan behavior sistem penuh.

JMH adalah tool utama di JVM untuk membangun, menjalankan, dan menganalisis benchmark nano/micro/milli/macro di Java dan bahasa lain yang menargetkan JVM.

## 4.7 Level 6 — Profiling/Diagnostic Evidence

Profiling menjawab:

```text
Waktu habis di mana?
CPU habis di mana?
Object dialokasi di mana?
Thread blocked di mana?
Lock contention terjadi di mana?
GC pause dari mana?
Native memory naik karena apa?
```

Tools:

- Java Flight Recorder;
- Java Mission Control;
- async-profiler;
- jcmd;
- jstack;
- jmap;
- jstat;
- GC log;
- heap dump;
- thread dump;
- native memory tracking.

## 4.8 Level 7 — Macrobenchmark, Load, Stress, Soak

Level ini membuktikan behavior sistem dengan workload lebih realistis.

Kuat untuk:

- p95/p99 latency;
- throughput;
- saturation;
- queue growth;
- connection pool exhaustion;
- retry storm;
- memory leak over time;
- GC under load;
- DB bottleneck;
- dependency bottleneck.

Lemah jika workload model salah.

## 4.9 Level 8 — Production Telemetry

Production adalah sumber kebenaran terakhir untuk real-world behavior.

Tetapi production telemetry juga bisa misleading jika:

- sampling terlalu kasar;
- metric cardinality buruk;
- tidak ada correlation id;
- log tidak structured;
- p99 tidak dihitung benar;
- metric tidak dipisah per endpoint/use-case;
- dashboard hanya rata-rata.

## 4.10 Level 9 — Regression Guard + Runbook

Evidence terbaik adalah evidence yang menjadi guard agar bug tidak kembali.

Contoh:

```text
Bug ditemukan di production
  → dibuat regression test
  → dibuat benchmark jika cost-sensitive
  → dibuat alert jika operational symptom berulang
  → dibuat runbook investigasi
  → dibuat dashboard spesifik
  → release pipeline menolak regression kritikal
```

---

## 5. Taxonomy: Istilah yang Harus Dipisahkan

## 5.1 Test vs Check

Dalam praktik sehari-hari, “test” sering dipakai untuk semua hal. Tetapi secara mental model:

- **check** adalah verifikasi otomatis terhadap expected result;
- **test** adalah aktivitas investigasi untuk menemukan informasi tentang sistem.

Unit test di CI biasanya lebih tepat disebut automated checks, tetapi dalam seri ini kita tetap memakai istilah “test” karena umum di ekosistem Java.

Yang penting: jangan mengira automated test bisa membuktikan semua risiko.

## 5.2 Unit Test

Unit test memverifikasi unit kecil behavior.

Unit bukan selalu “satu class”. Unit bisa berupa:

- method;
- class;
- aggregate;
- domain service;
- use-case service;
- small collaboration cluster.

Pertanyaan penting:

```text
Apakah boundary unit dipilih berdasarkan behavior atau berdasarkan struktur class?
```

Unit test yang baik tidak sekadar mengejar class coverage. Ia membuktikan aturan.

## 5.3 Integration Test

Integration test memverifikasi interaksi dengan boundary nyata:

- database;
- message broker;
- filesystem;
- HTTP server/client;
- serialization;
- transaction manager;
- container config.

Integration test lebih lambat, tetapi membuktikan hal yang tidak bisa dibuktikan mock.

## 5.4 Component Test

Component test menjalankan satu service/module lebih utuh, tetapi dependency eksternal bisa diganti test double atau container.

Biasanya cocok untuk:

- REST API resource/controller;
- service + repository + database;
- consumer + broker;
- scheduler + DB lock;
- outbox/inbox flow.

## 5.5 Contract Test

Contract test membuktikan kesepakatan antar boundary.

Contoh:

```text
Consumer mengharapkan field `status` selalu salah satu dari APPROVED/REJECTED/PENDING.
Provider tidak boleh mengubah field tersebut menjadi object tanpa versioning.
```

Contract test sangat penting untuk microservices.

## 5.6 End-to-End Test

E2E test menguji alur penuh dari sisi user/system.

Kuat untuk smoke confidence.

Lemah karena:

- lambat;
- brittle;
- sulit debug;
- banyak false failure;
- coverage behavior per biaya rendah.

E2E sebaiknya sedikit tetapi high-value.

## 5.7 Benchmark

Benchmark mengukur cost.

Benchmark bukan test correctness, walaupun benchmark tetap perlu sanity assertion agar tidak mengukur output yang salah.

Benchmark menjawab:

```text
Dalam kondisi X, cost Y berapa?
```

Bukan:

```text
Mana yang selalu lebih baik?
```

## 5.8 Profiling

Profiling mengobservasi program saat berjalan untuk menemukan distribusi waktu/resource.

Jenis profiling:

- CPU profiling;
- wall-clock profiling;
- allocation profiling;
- lock profiling;
- heap analysis;
- GC analysis;
- IO profiling.

## 5.9 Load Test

Load test menjalankan sistem dengan workload yang merepresentasikan traffic normal/target.

Pertanyaan:

```text
Pada traffic target, apakah latency, error rate, dan resource usage memenuhi SLO?
```

## 5.10 Stress Test

Stress test mendorong sistem melewati kapasitas normal untuk mengetahui breaking point.

Pertanyaan:

```text
Kapan sistem mulai degradasi?
Bagaimana failure mode-nya?
Apakah graceful atau collapse?
```

## 5.11 Soak Test

Soak test menjalankan workload dalam durasi panjang untuk menemukan:

- memory leak;
- native memory growth;
- file descriptor leak;
- connection leak;
- cache growth;
- log growth;
- GC degradation;
- scheduler drift.

## 5.12 Performance Engineering

Performance engineering bukan sekadar optimisasi code.

Performance engineering mencakup:

- workload modeling;
- measurement design;
- bottleneck diagnosis;
- capacity planning;
- configuration;
- regression prevention;
- observability;
- operational feedback.

## 5.13 JVM Tuning

JVM tuning adalah bagian kecil dari performance engineering.

Urutan yang benar:

```text
Understand workload
  → measure symptom
  → profile bottleneck
  → inspect runtime behavior
  → tune code/system/config if needed
  → validate
```

Urutan yang salah:

```text
Production lambat
  → copy JVM flags dari blog
  → restart
  → berharap selesai
```

---

## 6. Java 8–25: Kenapa Versi Java Sangat Penting

Seri ini mencakup Java 8 sampai Java 25. Ini bukan sekadar rentang angka. Banyak hal berubah drastis.

## 6.1 Java 8: Legacy Enterprise Baseline

Java 8 masih banyak dipakai di enterprise legacy.

Ciri penting:

- PermGen sudah diganti Metaspace sejak Java 8;
- default GC landscape berbeda dari Java modern;
- tidak ada module system;
- tidak ada unified logging seperti Java 9+;
- tidak ada var, records, sealed classes, virtual threads;
- JUnit 5 masih bisa menjalankan test untuk Java 8 pada generasi tertentu;
- banyak library modern sudah mulai meninggalkan Java 8.

Implikasi testing/performance:

- GC logging syntax berbeda;
- tooling modern mungkin tidak kompatibel;
- container awareness lebih terbatas dibanding Java modern;
- codebase cenderung memakai JUnit 4/Mockito lama;
- migration test matrix penting.

## 6.2 Java 11: Migration Baseline

Java 11 banyak menjadi target migrasi dari Java 8.

Ciri penting:

- LTS populer;
- unified logging sudah tersedia sejak Java 9;
- G1 menjadi default sejak Java 9;
- removal/deprecation beberapa opsi lama mulai terasa;
- HTTP Client standar tersedia;
- banyak organisasi memindahkan baseline ke Java 11 sebelum Java 17.

Implikasi:

- GC logs mulai pakai `-Xlog`;
- perlu menguji behavior library saat migrasi;
- performance bisa berubah karena JIT/GC/runtime berbeda.

## 6.3 Java 17: Modern Enterprise Baseline

Java 17 menjadi baseline besar untuk stack modern seperti Spring Framework 6/Spring Boot 3.

Ciri penting:

- records tersedia;
- sealed classes;
- pattern matching mulai berkembang;
- strong encapsulation module JDK lebih terasa;
- library modern banyak menjadikannya minimum baseline.

Implikasi:

- JUnit 6 membutuhkan Java 17+ pada runtime;
- testing code legacy yang dikompilasi dengan versi lama tetap mungkin, tetapi test runtime modern punya constraint;
- reflection-heavy framework perlu memperhatikan module access.

## 6.4 Java 21: Virtual Thread Era

Java 21 membawa virtual threads sebagai fitur final.

Implikasi besar:

- blocking IO bisa diskalakan lebih baik pada model tertentu;
- thread dump berubah maknanya;
- pool sizing perlu dipikir ulang;
- pinning menjadi isu;
- load test harus membedakan concurrency model;
- benchmark thread tradisional tidak otomatis berlaku.

## 6.5 Java 25: Baseline Modern Terbaru dalam Seri Ini

Java 25 adalah target akhir seri ini.

Implikasi:

- dokumentasi `java` command, GC tuning, troubleshooting, dan toolchain perlu dilihat untuk Java 25;
- banyak default JVM berbeda dari Java 8;
- beberapa flag lama sudah deprecated/removed;
- library testing modern cenderung menjadikan Java 17+ sebagai baseline;
- seri ini akan menekankan version-aware configuration.

---

## 7. Compatibility Matrix Awal

Matrix ini bukan daftar final semua detail, tetapi orientasi awal.

| Area | Java 8 | Java 11 | Java 17 | Java 21 | Java 25 |
|---|---:|---:|---:|---:|---:|
| JUnit 4 | Umum | Bisa | Bisa | Bisa | Bisa tapi legacy |
| JUnit 5 | Bisa pada versi yang mendukung Java 8 | Bisa | Bisa | Bisa | Bisa |
| JUnit 6 | Tidak untuk runtime | Tidak untuk runtime | Ya | Ya | Ya |
| Unified JVM Logging `-Xlog` | Tidak | Ya | Ya | Ya | Ya |
| G1 as default | Tidak pada umumnya | Ya | Ya | Ya | Ya |
| Virtual Threads | Tidak | Tidak | Tidak | Ya | Ya |
| Records | Tidak | Tidak | Ya | Ya | Ya |
| Module system | Tidak | Ya | Ya | Ya | Ya |
| Strong encapsulation impact | Rendah | Sedang | Tinggi | Tinggi | Tinggi |
| Container ergonomics modern | Terbatas | Lebih baik | Baik | Baik | Baik |

Catatan penting:

- “Bisa” tidak berarti “ideal”.
- Library ecosystem bisa membatasi versi Java lebih ketat daripada JDK itu sendiri.
- Test runtime version dan application target version bisa berbeda, tetapi harus dikelola hati-hati.

---

## 8. Mental Model: Java Application sebagai Sistem Berlapis

Untuk testing dan performance, jangan melihat Java app hanya sebagai code.

Lihat sebagai stack:

```text
Business behavior
  ↓
Application code
  ↓
Framework/library
  ↓
JVM runtime
  ↓
JIT compiler
  ↓
Garbage collector
  ↓
OS scheduler / kernel
  ↓
Container / cgroup
  ↓
Node / VM / hardware
  ↓
Network / storage / external dependency
  ↓
Real workload
```

Bug dan bottleneck bisa muncul di layer mana saja.

## 8.1 Business Behavior Layer

Contoh risiko:

- state transition salah;
- authorization salah;
- audit trail hilang;
- validation tidak konsisten;
- idempotency gagal;
- SLA escalation salah.

Tool utama:

- unit test;
- parameterized test;
- property-based test;
- mutation testing;
- domain-specific assertion.

## 8.2 Application Code Layer

Contoh risiko:

- algorithm tidak efisien;
- excessive allocation;
- wrong collection choice;
- thread unsafe cache;
- blocking call di path sensitif;
- exception dipakai untuk control flow;
- serialization terlalu mahal.

Tool utama:

- unit test;
- benchmark;
- profiler;
- static analysis;
- code review.

## 8.3 Framework/Library Layer

Contoh risiko:

- Spring proxy behavior tidak sesuai asumsi;
- transaction boundary salah;
- lazy loading menyebabkan N+1;
- Jackson serialization berubah;
- connection pool config salah;
- HTTP client timeout default terlalu longgar.

Tool utama:

- integration test;
- component test;
- contract test;
- Testcontainers;
- profiling;
- configuration inspection.

## 8.4 JVM Runtime Layer

Contoh risiko:

- warmup lambat;
- JIT compilation spike;
- code cache penuh;
- deoptimization;
- GC pause;
- metaspace growth;
- direct memory leak;
- native thread exhaustion.

Tool utama:

- JFR;
- JMC;
- jcmd;
- GC logs;
- Native Memory Tracking;
- async-profiler;
- JVM flags inspection.

## 8.5 OS/Container Layer

Contoh risiko:

- CPU throttling;
- memory limit terlalu ketat;
- OOMKilled;
- file descriptor limit;
- DNS latency;
- network packet loss;
- disk IO wait;
- noisy neighbor.

Tool utama:

- container metrics;
- Kubernetes metrics;
- cgroup inspection;
- OS tools;
- eBPF/perf jika tersedia;
- production telemetry.

## 8.6 Workload Layer

Contoh risiko:

- traffic burst;
- high-cardinality tenant;
- large payload;
- unusual search filters;
- skewed data distribution;
- retry storm;
- batch job overlap;
- end-of-month spike.

Tool utama:

- load test;
- traffic replay;
- production analytics;
- logs/traces/metrics;
- capacity planning.

---

## 9. Correctness vs Performance: Dua Dimensi yang Tidak Bisa Saling Menggantikan

Sebuah implementation bisa berada di salah satu dari empat kuadran:

| | Fast | Slow |
|---|---|---|
| Correct | Ideal atau acceptable | Perlu optimisasi |
| Incorrect | Dangerous | Useless |

Jebakan umum:

```text
Implementation cepat tetapi salah.
```

Ini lebih berbahaya daripada lambat, karena bisa merusak data dengan cepat.

Urutan engineering yang sehat:

```text
Correct first.
Then measurable.
Then fast enough.
Then maintainable.
Then continuously guarded.
```

Tetapi ada nuansa:

- “Correct first” bukan berarti mengabaikan complexity total.
- Kadang desain correctness yang buruk membuat performance mustahil diperbaiki.
- Contoh: model data yang tidak mendukung query utama akan sulit diselamatkan dengan JVM tuning.

Jadi yang benar:

```text
Design for correctness and observability first,
while preserving performance-relevant invariants.
```

Contoh performance-relevant invariant:

```text
Satu request approval tidak boleh melakukan query per attachment.
Satu event consumer harus idempotent dalam satu transaction boundary.
Search endpoint harus selalu punya bounded pagination.
Cache key harus stable dan collision-safe.
Retry harus punya max attempt dan timeout budget.
```

---

## 10. Determinism: Sifat Terpenting Test yang Sering Diabaikan

Test yang bagus harus deterministic.

Artinya:

```text
Dengan input, state, dependency, waktu, dan environment yang sama,
hasil test harus sama.
```

Sumber non-determinism:

- waktu sistem (`Instant.now()` langsung);
- random tanpa seed;
- thread scheduling;
- test order;
- shared database state;
- external API;
- network;
- DNS;
- file system;
- locale/timezone;
- floating point tolerance;
- async event;
- container startup race;
- CI resource contention.

Strategi mengontrol determinism:

- inject `Clock`;
- inject ID generator;
- seed random;
- isolate database;
- avoid global mutable state;
- use Awaitility-style bounded wait instead of sleep;
- run tests in random order periodically;
- use container readiness checks;
- separate slow/flaky tests;
- avoid hidden dependency on local timezone;
- assert eventual condition with timeout.

Determinism tidak berarti semua test harus synchronous. Async test bisa deterministic jika event dan waiting condition dirancang benar.

---

## 11. Observability: Syarat Agar Performance Engineering Mungkin Dilakukan

Tanpa observability, performance engineering berubah menjadi tebak-tebakan.

Minimal observability untuk Java service:

```text
Metrics:
  - request count
  - error count
  - latency histogram
  - p50/p90/p95/p99
  - JVM heap/non-heap
  - GC pause/count
  - thread count
  - connection pool active/idle/pending
  - executor queue size
  - CPU usage
  - container throttling

Logs:
  - structured JSON if possible
  - correlation id
  - request id
  - actor/user context where safe
  - error code
  - latency fields
  - dependency latency

Traces:
  - inbound request
  - DB call
  - external HTTP call
  - messaging publish/consume
  - retry attempts
  - queue time if possible
```

Yang sering salah:

- hanya melihat average latency;
- tidak punya histogram;
- semua endpoint digabung;
- tidak membedakan success vs error latency;
- tidak punya correlation id;
- tidak mengukur queue time;
- tidak mengukur dependency latency;
- GC log tidak aktif saat incident;
- tidak tahu JVM flags aktual yang berjalan.

---

## 12. Latency: Jangan Pernah Hanya Melihat Average

Average latency sering menipu.

Misal:

```text
Request latency:
10 ms, 10 ms, 10 ms, 10 ms, 2000 ms
```

Average:

```text
408 ms
```

Average tidak menjelaskan bahwa mayoritas cepat tetapi satu request sangat buruk.

Untuk user experience dan SLO, percentile lebih penting:

- p50: median;
- p90: 90% request lebih cepat dari angka ini;
- p95;
- p99;
- p999.

Tail latency penting karena:

- user sering merasakan request lambat, bukan rata-rata;
- service chain memperbesar tail;
- retry memperparah tail;
- queueing bisa membuat collapse;
- p99 sering menunjukkan saturation lebih awal daripada average.

Contoh chain:

```text
Frontend → API Gateway → Service A → Service B → DB → External API
```

Jika setiap hop punya p99 buruk, end-to-end p99 bisa jauh lebih buruk.

---

## 13. Throughput, Latency, dan Saturation

Tiga konsep ini harus dipahami bersama.

## 13.1 Throughput

Throughput adalah jumlah work per unit waktu.

Contoh:

```text
requests/second
messages/second
transactions/minute
rows processed/second
```

Throughput tinggi tidak selalu berarti latency rendah.

## 13.2 Latency

Latency adalah durasi satu unit work.

Contoh:

```text
HTTP request duration
DB query duration
message processing duration
batch item duration
```

## 13.3 Saturation

Saturation terjadi saat resource mendekati kapasitas.

Resource:

- CPU;
- memory;
- GC;
- thread pool;
- connection pool;
- DB connection;
- DB CPU/IO;
- network;
- disk;
- queue;
- external service quota.

Saat saturation naik, latency biasanya naik non-linear.

Contoh sederhana:

```text
CPU 40% → latency p99 80 ms
CPU 70% → latency p99 150 ms
CPU 90% → latency p99 1500 ms
CPU throttled → timeout spike
```

Performance engineering harus mencari titik saturation, bukan hanya angka throughput maksimum.

---

## 14. Little's Law sebagai Fondasi Intuisi

Little's Law:

```text
L = λ × W
```

Di mana:

- `L` = jumlah work in progress/concurrency;
- `λ` = arrival rate/throughput;
- `W` = waktu rata-rata di sistem.

Contoh:

```text
Throughput = 100 request/second
Average latency = 200 ms = 0.2 second

Concurrency rata-rata ≈ 100 × 0.2 = 20 request in-flight
```

Jika latency naik menjadi 2 detik pada throughput sama:

```text
Concurrency ≈ 100 × 2 = 200 request in-flight
```

Akibat:

- thread lebih banyak terpakai;
- memory per request bertambah total;
- connection pool bisa penuh;
- queue tumbuh;
- retry bisa memperparah load.

Little's Law membantu memahami kenapa timeout, pool size, dan latency saling terkait.

---

## 15. Queueing: Penyebab Banyak p99 Incident

Banyak incident performance bukan karena satu method lambat, tetapi karena antrian.

Antrian bisa ada di:

- HTTP server accept queue;
- servlet thread pool;
- executor queue;
- message broker queue;
- database connection pool wait queue;
- DB lock wait;
- OS run queue;
- GC safepoint;
- external API rate limit queue.

Gejala queueing:

- CPU tidak selalu 100%;
- average masih terlihat normal;
- p99 naik tajam;
- timeout meningkat;
- retry meningkat;
- thread dump banyak WAITING/BLOCKED;
- connection pool pending naik;
- queue depth naik.

Solusi queueing tidak selalu “tambah thread”. Kadang tambah thread memperburuk:

```text
More threads
  → more concurrent DB queries
  → DB saturated
  → queries slower
  → threads held longer
  → queue grows
  → timeout/retry storm
```

Engineering yang benar:

```text
Find bottleneck resource.
Control concurrency before the bottleneck.
Set timeout budget.
Apply backpressure/load shedding.
Tune pool based on resource capacity.
```

---

## 16. Workload Modeling: Tanpa Ini Benchmark dan Load Test Bisa Bohong

Workload adalah bentuk pekerjaan nyata yang dilakukan sistem.

Parameter workload:

- request mix;
- endpoint distribution;
- payload size;
- data size;
- tenant distribution;
- read/write ratio;
- cache hit ratio;
- auth/role distribution;
- burstiness;
- think time;
- concurrency;
- arrival rate;
- dependency latency;
- error rate;
- retry behavior;
- batch overlap;
- time-of-day pattern.

Contoh workload model buruk:

```text
Load test 100 RPS hanya endpoint health check.
```

Contoh workload model lebih baik:

```text
100 RPS total:
  40% search applications, p95 result size 20 rows
  20% view detail, p95 attachment count 8
  15% update draft, payload 20 KB
  10% submit application, writes DB + audit + event
  10% officer review list, role-specific filter
  5% approval action, transaction + event + notification
```

Untuk benchmark kecil pun workload penting.

Contoh:

```text
Menguji HashMap lookup dengan 10 key tidak mewakili cache 500k key.
Menguji JSON 1 KB tidak mewakili payload 2 MB.
Menguji all cache hit tidak mewakili 70% hit / 30% miss.
```

---

## 17. Performance sebagai Constraint, Bukan Fitur Tambahan

Banyak tim memperlakukan performance sebagai hal yang dicek di akhir. Ini berbahaya.

Performance harus masuk sejak desain:

```text
Apakah query utama punya index path?
Apakah API punya pagination?
Apakah bulk operation bounded?
Apakah external dependency punya timeout?
Apakah retry punya budget?
Apakah message consumer idempotent?
Apakah audit logging asynchronous atau synchronous?
Apakah payload size dibatasi?
Apakah cache punya eviction?
Apakah long-running job punya checkpoint?
```

Performance bukan berarti semua harus cepat maksimum. Performance berarti memenuhi constraint dengan trade-off yang jelas.

Contoh trade-off:

| Keputusan | Benefit | Cost/Risk |
|---|---|---|
| Cache local | latency turun | staleness, memory pressure |
| Async processing | request cepat | eventual consistency, retry complexity |
| Larger heap | GC frequency turun | pause/live-set risk, container memory pressure |
| More threads | concurrency naik | context switch, DB saturation |
| More DB connections | wait turun | DB overload |
| Compression | bandwidth turun | CPU naik |
| Batch write | throughput naik | latency per item naik |

Top-tier engineer tidak mencari setting “tercepat”, tetapi konfigurasi yang sesuai constraint sistem.

---

## 18. Testing sebagai Risk Management

Testing bukan aktivitas ritual. Testing adalah risk management.

Pertanyaan awal bukan:

```text
Test apa yang harus ditulis?
```

Tetapi:

```text
Risiko apa yang paling mahal jika salah?
```

Contoh risiko dalam enterprise/regulatory system:

- approval dilakukan oleh user tidak berwenang;
- status case berubah tanpa audit;
- duplicate event menyebabkan duplicate notification/fine/payment;
- SLA escalation salah tanggal;
- appeal bisa dibuat setelah deadline;
- validation FE/BE tidak konsisten;
- report mengambil data agency yang salah;
- migration mengubah semantic status;
- retry membuat duplicate external submission;
- PII masuk log;
- search endpoint leak data cross-tenant.

Setiap risiko butuh jenis test berbeda.

| Risiko | Test yang cocok |
|---|---|
| State transition salah | parameterized unit/domain test |
| Authorization matrix salah | matrix test + integration security test |
| SQL berbeda dari asumsi | repository integration test dengan DB asli |
| Consumer/provider mismatch | contract test |
| Concurrent update lost | concurrency/integration test + DB lock test |
| Race di lock-free code | jcstress |
| Retry duplicate side effect | failure injection + idempotency test |
| Performance regression mapper | JMH benchmark |
| p99 latency buruk | load test + profiler |
| GC pause naik | GC log + JFR + allocation profiling |

---

## 19. Test Pyramid, Trophy, Honeycomb: Mana yang Dipakai?

Tidak ada satu bentuk yang selalu benar.

## 19.1 Test Pyramid

Pyramid klasik:

```text
Few E2E
Some integration
Many unit
```

Cocok untuk banyak aplikasi karena unit test murah dan cepat.

Masalahnya: sering disalahartikan menjadi “mock semuanya”.

## 19.2 Test Trophy

Test trophy lebih menekankan integration test, populer di frontend/full-stack context.

Intuisi:

```text
Static checks + unit + integration + few E2E
```

## 19.3 Testing Honeycomb

Microservices sering lebih cocok dengan honeycomb:

```text
Many integration/component/contract tests
Fewer unit tests for glue code
Few E2E tests
```

## 19.4 Untuk Java Enterprise Backend

Rekomendasi awal:

```text
Domain-heavy module:
  many unit/domain tests
  property/mutation for critical invariant
  integration for persistence boundary

CRUD-heavy module:
  focused unit tests for rules
  stronger repository/API integration tests
  contract tests for external API

Workflow/case-management module:
  state transition matrix tests
  authorization matrix tests
  audit tests
  persistence integration tests
  event flow tests

Messaging module:
  consumer component tests
  broker integration tests
  idempotency tests
  contract tests

Performance-sensitive module:
  correctness tests
  JMH microbenchmarks for hot code
  profiling under realistic workload
  load regression tests
```

---

## 20. Benchmarking: Apa yang Sering Disalahpahami

Benchmark paling sering disalahgunakan untuk membuktikan preferensi.

Contoh:

```text
Saya suka loop, lalu membuat benchmark loop vs stream dengan input kecil,
sekali run, tanpa warmup, tanpa fork, lalu menyimpulkan stream selalu lambat.
```

Masalahnya:

- JVM butuh warmup;
- JIT bisa menghapus code yang hasilnya tidak dipakai;
- constant folding bisa membuat benchmark palsu;
- input distribution bisa tidak realistis;
- single run tidak cukup;
- OS noise mempengaruhi;
- GC dan allocation perlu diamati;
- benchmark micro tidak mencerminkan system behavior.

JMH membantu banyak hal seperti warmup, fork, measurement, dan blackhole. Tetapi JMH tidak menyelamatkan benchmark yang pertanyaannya salah.

Benchmark yang baik dimulai dari hypothesis:

```text
Hypothesis:
  Implementasi parser baru mengurangi allocation minimal 30%
  untuk payload 10 KB sampai 500 KB,
  tanpa menurunkan throughput.

Measurement:
  JMH throughput + allocation profiler,
  parameter payload size,
  fork minimal 3,
  warmup cukup,
  output JSON disimpan.

Acceptance:
  allocation/op turun >= 30%,
  throughput tidak turun > 5%,
  variance acceptable.
```

---

## 21. Profiling: Mengapa “Feeling” Biasanya Salah

Engineer sering menebak bottleneck dari code yang terlihat kompleks.

Tetapi bottleneck sering berada di tempat yang membosankan:

- JSON serialization;
- logging string construction;
- database connection wait;
- regex;
- date formatting;
- exception stack trace;
- DNS lookup;
- TLS handshake;
- lock contention;
- synchronized cache;
- thread pool queue;
- class loading;
- allocation pressure.

Profiling mengubah pertanyaan dari:

```text
Menurut saya lambat di mana?
```

menjadi:

```text
Resource benar-benar habis di mana?
```

Jenis profile harus sesuai pertanyaan:

| Pertanyaan | Profile/Tool |
|---|---|
| CPU habis di mana? | CPU profile, async-profiler, JFR |
| Request menunggu apa? | wall-clock profile, thread dump, trace |
| Allocation dari mana? | allocation profile, JFR, async-profiler alloc |
| Memory tertahan oleh apa? | heap dump, dominator tree |
| GC kenapa sering? | GC log, JFR GC events |
| Thread blocked di mana? | thread dump, JFR lock events |
| Native memory naik? | Native Memory Tracking |
| Code cache penuh? | jcmd Compiler.CodeHeap_Analytics |

---

## 22. JVM Configuration: Jangan Mulai dari Flag

JVM flags adalah interface ke runtime. Tetapi runtime tuning tanpa diagnosis adalah spekulasi.

Pertanyaan sebelum memilih flag:

```text
Apa workload service?
Apa target SLO?
Apa memory limit container?
Berapa CPU request/limit?
Berapa live set heap?
Berapa allocation rate?
Apa collector saat ini?
Apa GC pause saat ini?
Apa thread count?
Berapa direct memory usage?
Berapa metaspace usage?
Apakah ada CPU throttling?
Apakah ada native OOM?
Apakah startup atau throughput lebih penting?
Apakah latency tail lebih penting daripada max throughput?
```

Contoh keputusan:

```text
Problem: p99 latency naik karena DB pool pending tinggi.
Bad response: ganti GC collector.
Better response: inspect query latency, pool sizing, DB saturation, timeout, retry.
```

Contoh lain:

```text
Problem: frequent young GC karena allocation rate tinggi dari JSON mapping.
Bad response: naikkan Xmx terus.
Better response: profile allocation, reduce allocation, lalu tune heap/GC jika masih perlu.
```

---

## 23. JVM Flag Taxonomy Awal

JVM option bisa dikelompokkan:

## 23.1 Standard Options

Contoh:

```text
-classpath / -cp
--module-path
-Dkey=value
-jar
-version
--enable-preview
```

Relatif stabil dan terdokumentasi.

## 23.2 Extra `-X` Options

Contoh:

```text
-Xms
-Xmx
-Xss
-Xlog
-XshowSettings
```

Tidak semuanya standard lintas semua VM, tetapi umum pada HotSpot/OpenJDK.

## 23.3 Advanced `-XX` Options

Contoh:

```text
-XX:+UseG1GC
-XX:+UseZGC
-XX:MaxGCPauseMillis=200
-XX:MaxRAMPercentage=75
-XX:+HeapDumpOnOutOfMemoryError
-XX:StartFlightRecording=...
```

Perlu hati-hati karena:

- bisa berubah antar versi;
- bisa deprecated/removed;
- default bisa berubah;
- efeknya workload-dependent.

## 23.4 Diagnostic/Experimental Options

Contoh:

```text
-XX:+UnlockDiagnosticVMOptions
-XX:+UnlockExperimentalVMOptions
```

Jangan dipakai sembarangan di production tanpa alasan kuat.

## 23.5 Manageable Flags

Sebagian flag bisa dilihat/diubah saat runtime dengan tool seperti `jcmd`/MBeans, tetapi tidak semua.

---

## 24. Tool Map untuk Seri Ini

## 24.1 Testing Tools

### JUnit 4

Masih relevan untuk legacy Java 8 codebase.

Akan dibahas untuk:

- migration;
- Vintage engine;
- legacy test maintenance;
- compatibility traps.

### JUnit 5/Jupiter

Fondasi modern testing Java sebelum JUnit 6.

Akan dibahas untuk:

- lifecycle;
- parameterized test;
- nested test;
- extension model;
- tags;
- parallel execution.

### JUnit 6

Relevan untuk Java 17+ runtime.

Akan dibahas dengan catatan compatibility untuk Java 8–11 codebase.

### AssertJ

Untuk fluent assertion dan failure diagnostics yang lebih baik.

### Mockito

Untuk test double, tetapi dengan batasan jelas.

### jqwik / property-based testing

Untuk generative tests dan invariant.

### PIT

Untuk mutation testing.

### Testcontainers

Untuk dependency nyata dalam container:

- database;
- Kafka/RabbitMQ;
- Redis;
- localstack jika diperlukan;
- browser/service dependency tertentu.

### WireMock / MockWebServer

Untuk HTTP dependency simulation.

### Awaitility

Untuk async/eventual assertion tanpa `Thread.sleep`.

## 24.2 Benchmarking Tools

### JMH

Tool utama benchmark JVM.

Akan dibahas:

- warmup;
- measurement;
- fork;
- state;
- scope;
- blackhole;
- profilers;
- result interpretation;
- pitfalls.

### jcstress

Untuk concurrency correctness.

Akan dibahas:

- actor;
- outcome;
- acceptable/forbidden result;
- memory model edge cases;
- lock-free code.

## 24.3 Diagnostic/Profiling Tools

### JFR

Java Flight Recorder untuk low-overhead production-grade event recording.

### JMC

Java Mission Control untuk analisis JFR.

### async-profiler

Sampling profiler untuk CPU/allocation/wall/lock/native stack/flame graph.

### jcmd

Swiss army knife diagnostic HotSpot.

Contoh penggunaan:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jcmd <pid> GC.heap_info
jcmd <pid> Thread.print
jcmd <pid> JFR.start
jcmd <pid> JFR.dump
```

### jstack

Thread dump.

### jmap

Heap dump/class histogram.

### jstat

GC/class/compiler statistics.

### GC logs

Untuk analisis GC behavior dari waktu ke waktu.

---

## 25. Anti-Pattern Besar yang Akan Kita Hindari

## 25.1 Coverage Worship

Salah:

```text
Coverage 90%, berarti aman.
```

Benar:

```text
Coverage adalah sinyal lemah.
Yang penting: risiko kritikal punya test yang benar-benar bisa gagal saat behavior salah.
```

Coverage tinggi bisa tetap buruk jika test hanya mengeksekusi code tanpa assertion kuat.

## 25.2 Mock Everything

Salah:

```text
Semua dependency di-mock agar unit test cepat.
```

Masalah:

- test menguji implementation detail;
- refactor kecil memecahkan test;
- contract nyata tidak diuji;
- SQL/serialization/transaction behavior hilang;
- confidence palsu.

Benar:

```text
Mock dependency yang memang boundary behavior-nya ingin dikontrol.
Gunakan fake/container/real dependency saat contract nyata penting.
```

## 25.3 Sleep-Based Async Test

Salah:

```java
Thread.sleep(5000);
assertEquals(...);
```

Masalah:

- lambat;
- flaky;
- tidak membuktikan readiness;
- gagal di CI lambat.

Benar:

```text
Wait sampai condition terpenuhi dengan timeout bounded.
```

## 25.4 One-Run Benchmark

Salah:

```text
Run main method sekali, System.nanoTime, simpulkan A lebih cepat.
```

Benar:

```text
Gunakan JMH, warmup, fork, measurement, parameter, profiler, dan interpretasi variance.
```

## 25.5 Average Latency Dashboard

Salah:

```text
Average latency masih 100 ms, berarti aman.
```

Benar:

```text
Lihat histogram dan percentile per endpoint/status/tenant/use-case.
```

## 25.6 JVM Flag Cargo Cult

Salah:

```text
Tambahkan flag dari blog high performance Java.
```

Benar:

```text
Pahami workload, runtime version, container limit, GC logs, allocation profile, dan validate satu perubahan per eksperimen.
```

## 25.7 Tuning Before Profiling

Salah:

```text
Aplikasi lambat, langsung tuning GC.
```

Benar:

```text
Definisikan symptom, kumpulkan evidence, profile, baru tune.
```

## 25.8 Performance Fix Without Regression Guard

Salah:

```text
Sudah cepat setelah fix, selesai.
```

Benar:

```text
Tambahkan benchmark/load regression/alert agar tidak kembali.
```

---

## 26. Step-by-Step: Cara Berpikir Saat Ada Bug Correctness

Contoh incident:

```text
User melaporkan application status berubah dari UNDER_REVIEW ke APPROVED,
padahal officer belum menekan approve.
```

Langkah berpikir:

## 26.1 Define Symptom

Jangan langsung debug code.

Tentukan:

```text
Entity apa?
Status awal apa?
Status akhir apa?
Kapan berubah?
Actor siapa?
Request id apa?
Audit trail ada/tidak?
Event apa yang terbit?
Apakah perubahan terjadi sekali atau berulang?
```

## 26.2 Build State Timeline

```text
T0: Application submitted by applicant
T1: Officer opened review page
T2: Scheduler ran escalation job
T3: Status changed to APPROVED
T4: Notification sent
```

## 26.3 Identify Invariant Violation

Invariant:

```text
Only officer with APPROVER role can transition UNDER_REVIEW → APPROVED.
Transition must require explicit approve command.
Audit trail must contain approval reason.
```

## 26.4 Locate Boundary

Kemungkinan sumber:

- approval API;
- scheduler;
- event consumer;
- migration script;
- admin tool;
- DB trigger;
- manual DB update.

## 26.5 Add Regression Test

Test yang mungkin:

```text
Given UNDER_REVIEW application
When escalation scheduler runs
Then status must not become APPROVED
And audit trail must not contain approval action
```

## 26.6 Add State Transition Matrix Test

```text
From UNDER_REVIEW:
  APPROVE allowed only via ApproveCommand by APPROVER
  ESCALATE allowed via SchedulerCommand if overdue
  WITHDRAW allowed via ApplicantCommand under rule X
```

## 26.7 Prevent Similar Bug

- centralize transition guard;
- make invalid transition impossible;
- require command type;
- audit generated in same transaction;
- mutation test critical transition;
- alert on impossible transition if production invariant can be monitored.

---

## 27. Step-by-Step: Cara Berpikir Saat Ada Performance Incident

Contoh incident:

```text
p99 latency search endpoint naik dari 400 ms ke 8 detik setelah release.
CPU aplikasi hanya 45%.
GC tampak normal.
DB CPU naik.
Connection pool pending naik.
```

## 27.1 Define Symptom Precisely

```text
Endpoint: GET /applications/search
Started: after release 2026-06-15 14:00
Affected: officer role, agency filter
p50: 300 ms → 500 ms
p95: 900 ms → 4 s
p99: 1.5 s → 8 s
Error: timeout 504 meningkat
```

## 27.2 Avoid Premature Conclusion

Jangan langsung:

```text
Tambah pod.
Tambah DB connection.
Ganti GC.
Naikkan Xmx.
```

## 27.3 Correlate Release Change

Cek:

- query berubah?
- filter baru?
- join baru?
- index hilang?
- serialization field bertambah?
- authorization check per row?
- audit/logging tambahan?
- cache disabled?

## 27.4 Inspect Service Metrics

- request rate;
- latency histogram;
- error rate;
- executor queue;
- JDBC pool active/idle/pending;
- HTTP client pool;
- CPU;
- heap;
- GC pause;
- thread count.

## 27.5 Inspect DB

- slow query;
- execution plan;
- rows scanned;
- lock wait;
- connection count;
- CPU/IO;
- index usage.

## 27.6 Capture Runtime Evidence

- thread dump during spike;
- JFR recording;
- async-profiler wall-clock;
- GC log segment;
- heap histogram if memory suspected.

## 27.7 Build Hypothesis Tree

```text
H1: Query plan regression due to new filter.
H2: N+1 authorization lookup per result row.
H3: JSON serialization of large nested object.
H4: Connection pool too small after request duration increased.
H5: Retry from frontend/API gateway amplifies traffic.
```

## 27.8 Validate Hypothesis

Example:

```text
If H2 true:
  profiler shows repeated permission lookup
  DB shows many small queries per request
  log/traces show N queries for N rows
```

## 27.9 Fix at Right Layer

Possible fixes:

- add index;
- rewrite query;
- reduce result projection;
- batch authorization lookup;
- cache permission matrix;
- cap page size;
- tune connection pool only after query fixed;
- add performance regression test.

## 27.10 Add Guard

- repository integration test for query semantics;
- explain plan check if feasible;
- load test scenario;
- p95/p99 alert per endpoint;
- dashboard for pool pending;
- benchmark if mapper/serialization hot.

---

## 28. Measurement Discipline

Measurement harus punya struktur.

## 28.1 Define Question

Buruk:

```text
Apakah service cepat?
```

Baik:

```text
Pada 200 RPS dengan request mix production-like,
apakah endpoint submit application menjaga p95 < 800 ms dan p99 < 2 s,
dengan error rate < 0.1%, selama 30 menit?
```

## 28.2 Define Environment

Catat:

- Java version;
- JVM vendor;
- OS;
- container image;
- CPU/memory limit;
- heap flags;
- GC collector;
- number of pods;
- DB size;
- dataset;
- dependency simulation;
- network topology.

## 28.3 Define Workload

Catat:

- endpoint mix;
- payload size;
- data distribution;
- users/roles;
- concurrency;
- arrival rate;
- duration;
- ramp-up;
- cache warm/cold;
- retry behavior.

## 28.4 Collect Multi-Layer Metrics

Jangan hanya test tool output.

Collect:

- client-side latency;
- server-side latency;
- application metrics;
- JVM metrics;
- GC logs;
- DB metrics;
- container metrics;
- traces;
- logs.

## 28.5 Change One Variable

Jika mengubah banyak hal sekaligus:

```text
Xmx naik
GC berubah
pod count naik
connection pool naik
query index ditambah
```

maka sulit tahu mana yang menyelesaikan masalah.

## 28.6 Keep Artifacts

Simpan:

- JMH JSON;
- load test report;
- JFR file;
- flame graph;
- GC log;
- heap dump jika aman;
- thread dump;
- JVM flags;
- deployment manifest;
- git commit hash.

Artifacts membuat investigasi repeatable.

---

## 29. Failure Model: Apa Saja yang Bisa Salah

Top-tier engineer berpikir dengan failure model.

## 29.1 Correctness Failure

- wrong output;
- missing validation;
- invalid state transition;
- wrong authorization;
- lost update;
- duplicate side effect;
- inconsistent read;
- stale cache;
- wrong error mapping;
- missing audit.

## 29.2 Test Failure

- flaky test;
- false positive;
- false negative;
- overspecified mock;
- hidden shared state;
- non-deterministic time;
- environment-specific failure;
- slow test suite;
- ignored test;
- weak assertion.

## 29.3 Benchmark Failure

- dead code elimination;
- constant folding;
- insufficient warmup;
- no fork;
- unrealistic input;
- measuring setup not operation;
- benchmark method too coarse;
- wrong mode;
- ignoring allocation;
- ignoring variance.

## 29.4 Runtime Failure

- OOM heap;
- OOM metaspace;
- direct memory OOM;
- native thread exhaustion;
- long GC pause;
- CPU throttling;
- code cache full;
- classloader leak;
- safepoint storm;
- lock contention.

## 29.5 Distributed/System Failure

- timeout cascade;
- retry storm;
- connection pool exhaustion;
- broker backlog;
- DB lock contention;
- external rate limit;
- DNS issue;
- slow dependency;
- partial failure;
- inconsistent configuration.

---

## 30. Baseline Checklist untuk Java Service

Checklist awal sebelum masuk detail seri.

## 30.1 Correctness Baseline

```text
[ ] Critical domain rules punya unit/domain tests.
[ ] State transition punya matrix tests.
[ ] Authorization behavior punya matrix tests.
[ ] Error response contract diuji.
[ ] Idempotency behavior diuji.
[ ] Retry behavior diuji.
[ ] Audit side effect diuji.
[ ] Persistence behavior diuji dengan DB representatif.
[ ] External API contract diuji.
[ ] Messaging consumer idempotency diuji.
```

## 30.2 Test Suite Baseline

```text
[ ] Unit tests cepat dan deterministic.
[ ] Integration tests dipisah dari unit tests.
[ ] Tidak bergantung pada test order.
[ ] Tidak bergantung pada local timezone.
[ ] Tidak memakai Thread.sleep sembarangan.
[ ] Test data isolated.
[ ] Flaky tests dilacak.
[ ] CI report jelas.
[ ] Test tags/grouping jelas.
```

## 30.3 Benchmark Baseline

```text
[ ] Benchmark punya hypothesis jelas.
[ ] Menggunakan JMH untuk JVM microbenchmark.
[ ] Warmup/fork/measurement diset benar.
[ ] Input parameter realistis.
[ ] Output benchmark disimpan.
[ ] Allocation diamati jika relevan.
[ ] Result dibandingkan dengan baseline.
```

## 30.4 Runtime Diagnostic Baseline

```text
[ ] Bisa melihat JVM command line aktual.
[ ] Bisa melihat JVM flags aktual.
[ ] GC logging tersedia untuk troubleshooting.
[ ] JFR bisa diaktifkan/didump.
[ ] Thread dump bisa diambil.
[ ] Heap dump policy jelas.
[ ] Native memory tracking dipahami jika diperlukan.
[ ] Container CPU/memory metrics tersedia.
```

## 30.5 Production Performance Baseline

```text
[ ] Latency histogram tersedia.
[ ] p95/p99 per endpoint tersedia.
[ ] Error rate per endpoint tersedia.
[ ] Connection pool metrics tersedia.
[ ] Executor/thread pool metrics tersedia.
[ ] DB latency metrics tersedia.
[ ] External dependency latency tersedia.
[ ] Correlation id tersedia.
[ ] Dashboard tidak hanya average.
[ ] Alert berbasis SLO/symptom, bukan hanya CPU.
```

---

## 31. Reference Architecture: Evidence Pipeline

Berikut gambaran pipeline yang akan menjadi fondasi seri:

```text
Developer Laptop
  ├─ Unit/domain tests
  ├─ Mutation tests for selected critical logic
  ├─ JMH microbenchmarks for hot code
  └─ Local profiling for suspicious bottleneck

CI Pipeline
  ├─ Compile across target Java version if needed
  ├─ Unit tests
  ├─ Integration tests with Testcontainers
  ├─ Contract tests
  ├─ Static analysis
  ├─ Selected mutation testing
  └─ Optional benchmark smoke / performance regression check

Pre-Release Environment
  ├─ Full component tests
  ├─ Load tests with production-like workload
  ├─ JFR/GC log capture
  ├─ DB query analysis
  └─ Capacity validation

Production
  ├─ Metrics
  ├─ Logs
  ├─ Traces
  ├─ JFR on demand / continuous profile if allowed
  ├─ GC logs / runtime diagnostics
  ├─ Alerting
  └─ Incident feedback into tests/benchmarks/runbooks
```

Tujuan akhirnya:

```text
Every critical assumption has a guard.
Every incident produces a stronger guard.
Every optimization has evidence.
Every JVM config has a reason.
```

---

## 32. Mini Case Study: “Unit Test Pass, Production Lambat”

## 32.1 Situation

Sebuah endpoint:

```text
GET /cases?status=UNDER_REVIEW&agency=A&page=1&size=50
```

Unit test pass. Integration test pass. Tetapi production p99 naik drastis.

## 32.2 Test yang Ada

```text
- service returns cases for status
- repository method returns expected rows using 10-row dataset
- controller returns 200
```

## 32.3 Yang Tidak Terbukti

```text
- query dengan 10 juta row
- agency distribution skew
- index selectivity
- authorization filter per row
- JSON payload size
- DB connection wait
- p99 under concurrent traffic
```

## 32.4 Investigation

Evidence:

```text
- p99 endpoint 8s
- JDBC pool pending high
- DB CPU high
- slow query shows full table scan
- new filter uses function on indexed column
```

Root cause:

```text
Query changed from:
  WHERE created_date >= ?

to:
  WHERE TRUNC(created_date) >= ?

Index on created_date not used.
```

## 32.5 Fix

```text
Use range predicate without function on column:
  WHERE created_date >= ? AND created_date < ?
```

## 32.6 Regression Guard

Add:

```text
- repository integration test for boundary date semantics
- query review checklist
- load scenario for search endpoint
- DB slow query alert
- p99 endpoint dashboard
```

Lesson:

```text
Correctness tests proved behavior on small data.
They did not prove access path scalability.
Performance evidence needed different tools.
```

---

## 33. Mini Case Study: “JMH Cepat, Service Tetap Lambat”

## 33.1 Situation

Team mengganti mapper reflection-based dengan generated mapper.

JMH result:

```text
mapper throughput +300%
allocation/op turun 60%
```

Tetapi production latency hampir tidak berubah.

## 33.2 Why?

Profiling menunjukkan:

```text
Request time:
  2% mapper
  75% DB wait
  15% external API
  5% JSON serialization
  3% other
```

Mapper memang lebih cepat, tetapi bukan bottleneck utama.

## 33.3 Lesson

Microbenchmark membuktikan local improvement.

Tetapi system performance mengikuti bottleneck dominan.

Rule:

```text
Optimize hot path proven by profile,
not code path that merely looks inefficient.
```

---

## 34. Mini Case Study: “GC Tuning Tidak Menyelesaikan Memory Leak”

## 34.1 Situation

Service OOM setiap 2 hari.

Team mencoba:

```text
-Xmx naik dari 2g ke 4g
G1 pause target diubah
pod memory limit dinaikkan
```

OOM tetap terjadi, hanya lebih lambat.

## 34.2 Evidence

Heap dump menunjukkan:

```text
ConcurrentHashMap tenantCache
  retained size grows continuously
  key includes requestId
  no eviction
```

Root cause:

```text
Cache key salah dan unbounded cache.
```

## 34.3 Lesson

GC tuning tidak memperbaiki memory retention bug.

Correct approach:

```text
heap dump
  → dominator tree
  → retention path
  → fix cache key/eviction
  → add metric cache size
  → add test for key stability
  → add soak test
```

---

## 35. Cara Membaca Seri Ini

Seri ini akan sangat detail. Cara terbaik membacanya:

1. pahami mental model sebelum API;
2. lihat setiap tool sebagai alat pembuktian;
3. selalu tanya “risiko apa yang sedang dibuktikan?”;
4. jangan copy-paste pattern tanpa memahami failure mode;
5. jalankan contoh kecil;
6. adaptasikan ke sistem nyata;
7. simpan checklist sebagai engineering guard.

Urutan seri sengaja dibuat sebagai progression:

```text
Part 000-015: Testing correctness and confidence
Part 016-019: Benchmarking and workload measurement
Part 020-025: JVM execution, memory, GC, and configuration
Part 026-027: Profiling and diagnostics
Part 028-030: Code/service performance and regression pipeline
Part 031: Capstone investigation
```

---

## 36. Vocabulary Ringkas

| Istilah | Makna |
|---|---|
| Correctness | Behavior sesuai contract |
| Regression | Bug lama muncul kembali atau behavior memburuk |
| Unit test | Test behavior kecil secara cepat/deterministik |
| Integration test | Test boundary nyata/semi-nyata |
| Contract test | Test kesepakatan antar provider-consumer |
| Property-based test | Test invariant dengan banyak input generated |
| Mutation testing | Menguji apakah test suite mendeteksi perubahan salah |
| Benchmark | Pengukuran cost operasi dalam kondisi terkontrol |
| Microbenchmark | Benchmark operasi kecil/terisolasi |
| Macrobenchmark | Benchmark sistem/komponen besar |
| Profiling | Observasi distribusi resource saat runtime |
| Load test | Test workload normal/target |
| Stress test | Test melewati kapasitas normal |
| Soak test | Test durasi panjang untuk leak/degradasi |
| Throughput | Work per waktu |
| Latency | Durasi satu work item |
| Tail latency | Latency percentile tinggi seperti p95/p99 |
| Saturation | Resource mendekati kapasitas |
| Allocation rate | Jumlah memory dialokasikan per waktu/op |
| Live set | Object yang masih reachable setelah GC |
| GC pause | Waktu aplikasi berhenti/terganggu karena GC |
| JIT | Just-In-Time compiler JVM |
| Deoptimization | JVM membatalkan optimisasi karena asumsi runtime invalid |
| Heap | Memory object Java |
| Metaspace | Memory metadata class |
| Direct memory | Memory native untuk buffer langsung |
| Native memory | Memory di luar heap Java |
| JVM ergonomics | Default decision JVM berdasarkan environment |

---

## 37. Practical Starting Point untuk Project Nyata

Jika kamu ingin langsung menerapkan mindset part ini ke project Java nyata, mulai dari baseline berikut.

## 37.1 Buat Inventory Test

```text
List semua test suite:
  - unit
  - integration
  - E2E
  - contract
  - benchmark
  - load test

Untuk setiap suite:
  - running time
  - flakiness
  - owner
  - CI stage
  - risk covered
  - known blind spot
```

## 37.2 Buat Critical Risk Map

Contoh:

```text
Module: Case Management
Critical risks:
  - invalid state transition
  - unauthorized approval
  - missing audit trail
  - duplicate event
  - SLA escalation error
  - search endpoint p99 latency

Current evidence:
  - unit tests for transition: partial
  - authorization tests: weak
  - audit tests: missing
  - event idempotency: missing
  - performance test: missing
```

## 37.3 Buat Runtime Baseline

Ambil dari environment:

```bash
java -version
jcmd <pid> VM.command_line
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> GC.heap_info
jcmd <pid> Thread.print
```

Simpan baseline:

```text
Java version:
JVM vendor:
Container memory limit:
Container CPU limit:
Heap max:
GC collector:
Thread count:
Direct memory setting:
Metaspace usage:
GC log enabled:
JFR enabled/available:
```

## 37.4 Buat Performance Symptom Dashboard

Minimal:

```text
- Request rate per endpoint
- Error rate per endpoint
- p50/p95/p99 latency per endpoint
- JVM heap used/max
- GC pause p95/p99 or max
- Allocation rate if available
- JDBC pool active/idle/pending
- DB query latency
- External HTTP latency
- Container CPU throttling
```

## 37.5 Buat Incident Feedback Loop

Setiap incident harus menghasilkan minimal satu guard:

```text
Incident type → Guard

Wrong state transition → domain regression test
Provider contract break → contract test
Race condition → jcstress/concurrency test
Slow mapper → JMH benchmark
p99 latency regression → load test scenario + alert
Memory leak → heap analysis + soak test + metric
GC pause issue → GC log baseline + tuning doc
```

---

## 38. Prinsip-Prinsip Seri Ini

## 38.1 Evidence Over Preference

Jangan memilih pattern karena populer. Pilih berdasarkan bukti.

```text
Preferensi boleh memulai hypothesis.
Evidence harus menentukan keputusan.
```

## 38.2 Correctness Before Speed, But Design for Measurement

Correctness dulu, tetapi jangan membuat sistem yang tidak bisa diukur.

```text
No metrics, no diagnosis.
No diagnosis, no reliable tuning.
```

## 38.3 Small Fast Tests, Fewer Expensive Tests, Strong Guards

Bukan semua hal harus E2E.

Cari test termurah yang cukup kuat membuktikan risiko.

## 38.4 Benchmark the Question, Not the Tool

JMH bukan tujuan. Pertanyaan engineering adalah tujuan.

## 38.5 Profile Before Optimizing

Optimization tanpa profiling sering memperbaiki bagian yang salah.

## 38.6 Tune JVM Last, But Prepare Diagnostics Early

JVM tuning biasanya bukan langkah pertama. Tetapi diagnostic readiness harus disiapkan dari awal.

## 38.7 Production Reality Wins

Jika benchmark dan production berbeda, jangan langsung menyalahkan production. Cari perbedaan workload, data, environment, dan measurement.

---

## 39. Referensi Utama untuk Part Ini

Referensi berikut menjadi basis orientasi, dan akan dipakai lebih detail di part berikutnya:

- OpenJDK JMH — Java Microbenchmark Harness: `https://openjdk.org/projects/code-tools/jmh/`
- JMH GitHub repository: `https://github.com/openjdk/jmh`
- OpenJDK jcstress: `https://openjdk.org/projects/code-tools/jcstress/`
- jcstress GitHub repository: `https://github.com/openjdk/jcstress`
- JUnit User Guide: `https://docs.junit.org/`
- Oracle Java SE 25 Documentation: `https://docs.oracle.com/en/java/javase/25/`
- Java command documentation for JDK 25: `https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html`
- Oracle Java troubleshooting guide: `https://docs.oracle.com/en/java/javase/25/troubleshoot/`
- Oracle GC tuning guide for JDK 25: `https://docs.oracle.com/en/java/javase/25/gctuning/`
- async-profiler: `https://github.com/async-profiler/async-profiler`
- Testcontainers: `https://testcontainers.com/`
- Mockito: `https://site.mockito.org/`

---

## 40. Ringkasan Part 000

Part ini membangun fondasi bahwa testing, benchmarking, performance engineering, dan JVM configuration bukan topik terpisah.

Inti yang harus diingat:

```text
Testing proves behavior.
Benchmarking measures isolated cost.
Profiling explains where resources go.
Load testing validates system behavior under workload.
JVM configuration aligns runtime with workload and constraints.
Production telemetry validates real-world assumptions.
```

Kesalahan paling mahal adalah memakai tool yang benar untuk menjawab pertanyaan yang salah.

Contoh:

```text
Unit test untuk membuktikan scalability.
JMH untuk membuktikan p99 production latency.
GC tuning untuk memperbaiki query lambat.
Coverage untuk membuktikan test quality.
Average latency untuk membuktikan user experience.
```

Seri ini akan membangun skill dari dasar pembuktian behavior sampai investigasi production dan konfigurasi JVM.

---

## 41. Preview Part Berikutnya

Part berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-001.md
```

Topik:

```text
Test Taxonomy dan Test Strategy untuk Sistem Enterprise Java
```

Kita akan masuk lebih dalam ke:

- unit vs integration vs component vs contract vs E2E;
- test pyramid/trophy/honeycomb;
- risk-based testing;
- strategi test untuk domain, workflow, state machine, API, persistence, messaging, scheduler, dan performance-sensitive path;
- bagaimana menyusun test strategy yang defendable untuk sistem enterprise/regulatory.

---

## Status Seri

```text
Seri belum selesai.
Part 000 dari 031 selesai.
Masih ada 31 part setelah ini.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-testing-benchmarking-performance-jvm-part-001.md">Test Taxonomy dan Test Strategy untuk Sistem Enterprise Java ➡️</a>
</div>
