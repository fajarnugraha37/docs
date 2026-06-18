# learn-java-testing-benchmarking-performance-jvm-part-019

# Macrobenchmark, Load Test, Stress Test, Soak Test, dan Capacity Test

> Seri: `learn-java-testing-benchmarking-performance-jvm`  
> Part: `019` dari `031`  
> Topik utama: macrobenchmark, load test, stress test, spike test, soak test, capacity test, workload modelling, coordinated omission, percentile latency, bottleneck analysis, dan release gate performance untuk sistem Java 8–25.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas JMH dan microbenchmark. JMH berguna untuk menjawab pertanyaan seperti:

- apakah parser A lebih murah daripada parser B?
- apakah allocation per operation turun setelah refactor?
- apakah `HashMap` sizing tertentu mengurangi rehash cost?
- apakah penggunaan `Pattern` yang di-cache lebih cepat daripada compile regex setiap call?
- apakah codec JSON tertentu lebih hemat CPU/allocation?

Namun JMH tidak menjawab pertanyaan sistemik seperti:

- apakah service mampu menahan 500 request per second selama 2 jam?
- apakah p99 latency tetap di bawah 800 ms ketika database mulai saturasi?
- apakah retry policy membuat downstream overload?
- apakah connection pool terlalu kecil atau terlalu besar?
- apakah GC pause naik ketika live set bertambah?
- apakah autoscaling cukup cepat menghadapi traffic spike?
- apakah deployment baru menyebabkan throughput collapse?
- apakah bottleneck ada di JVM, DB, network, thread pool, lock contention, external API, atau load generator?

Part ini bertujuan membangun mental model performance testing pada level aplikasi dan sistem, bukan hanya level method.

Setelah menyelesaikan part ini, kamu harus bisa:

1. membedakan microbenchmark, macrobenchmark, load test, stress test, spike test, soak test, capacity test, scalability test, dan performance regression test;
2. mendesain workload model yang masuk akal;
3. memilih metrik yang tepat: throughput, latency percentile, error rate, saturation, queue depth, allocation rate, GC, DB, pool, dan dependency health;
4. memahami open model vs closed model;
5. menghindari coordinated omission;
6. membuat test plan yang bisa dipakai untuk release decision;
7. membaca hasil performance test tanpa terjebak angka rata-rata;
8. menghubungkan hasil load test dengan diagnosis JVM dan service internals;
9. membuat capacity envelope dan performance runbook;
10. mendesain regression gate yang realistis untuk CI/CD.

---

## 1. Mental Model: Performance Test adalah Eksperimen Sistem

Performance test bukan sekadar menjalankan tool lalu membaca angka `avg latency`.

Performance test yang benar adalah eksperimen sistem yang memiliki:

```text
hypothesis
  -> workload model
  -> controlled environment
  -> measurement plan
  -> execution discipline
  -> correlated telemetry
  -> interpretation
  -> decision
```

Tanpa hypothesis, load test hanya menghasilkan grafik.

Contoh hypothesis yang buruk:

```text
Kita ingin tahu performa aplikasi.
```

Terlalu umum. Tidak bisa diuji dengan jelas.

Contoh hypothesis yang lebih baik:

```text
Dengan 4 pod Java, masing-masing limit 2 vCPU dan 4 GiB memory,
service Application Submission harus mampu menangani 300 successful request/s
selama 30 menit dengan p95 < 500 ms, p99 < 1200 ms, error rate < 0.1%,
DB CPU < 70%, Hikari active connection < 80% pool size, dan tidak ada Full GC.
```

Ini bisa diuji, diperdebatkan, dan dipakai untuk keputusan.

Performance engineering yang matang selalu dimulai dari pertanyaan:

```text
Apa keputusan yang ingin kita ambil dari test ini?
```

Bukan:

```text
Tool apa yang harus dipakai?
```

Tool hanya alat. Yang penting adalah model, measurement, dan interpretasi.

---

## 2. Taxonomy: Jenis-Jenis Performance Test

Istilah performance test sering tercampur. Kita perlu vocabulary yang presisi.

### 2.1 Microbenchmark

Microbenchmark mengukur unit sangat kecil, biasanya method/function/operation isolated.

Contoh:

- membandingkan parser JSON;
- membandingkan loop vs stream;
- mengukur allocation per permission evaluation;
- mengukur cost `DateTimeFormatter`;
- mengukur hashing/canonicalization;
- mengukur serialization payload kecil.

Tool utama: JMH.

Kelebihan:

- isolated;
- relatif cepat;
- bagus untuk validasi low-level optimization;
- bisa menangkap allocation regression.

Keterbatasan:

- sering tidak representatif terhadap aplikasi nyata;
- tidak menangkap DB/network/pool/GC/live traffic;
- mudah misleading jika workload profile salah.

### 2.2 Macrobenchmark

Macrobenchmark mengukur operasi lebih besar, biasanya satu use case lengkap atau komponen service.

Contoh:

- submit application API dengan validation, DB write, audit trail, event publish;
- search case listing dengan filter kompleks;
- generate report dengan query dan serialization;
- import batch 10.000 records;
- process message end-to-end dari queue sampai DB update.

Macrobenchmark menjawab:

```text
Berapa cost satu business operation secara end-to-end dalam batas sistem tertentu?
```

Macrobenchmark masih bisa dijalankan secara controlled, tetapi lebih dekat ke real system.

### 2.3 Load Test

Load test menguji sistem pada expected load.

Pertanyaan utamanya:

```text
Apakah sistem memenuhi SLO pada traffic normal/puncak yang diharapkan?
```

Contoh:

```text
Traffic normal: 100 request/s.
Traffic peak: 300 request/s.
Durasi: 30 menit.
Acceptance: p95 < 500 ms, p99 < 1200 ms, error < 0.1%.
```

Load test bukan untuk menghancurkan sistem. Tujuannya membuktikan sistem memenuhi kebutuhan pada beban yang direncanakan.

### 2.4 Stress Test

Stress test menaikkan beban sampai sistem melewati batas.

Pertanyaan utamanya:

```text
Di mana titik patah sistem, dan bagaimana sistem gagal?
```

Yang dicari bukan hanya kapasitas maksimum, tapi failure behavior:

- apakah error rate naik secara gradual atau tiba-tiba?
- apakah latency naik sebelum error?
- apakah queue menumpuk?
- apakah thread pool penuh?
- apakah DB connection pool exhausted?
- apakah retry memperburuk situasi?
- apakah sistem pulih setelah beban turun?

Stress test yang baik tidak hanya mencari angka maksimum. Ia mencari bentuk kegagalan.

### 2.5 Spike Test

Spike test memberi lonjakan traffic mendadak.

Pertanyaan utamanya:

```text
Apakah sistem tetap stabil saat traffic naik tajam dalam waktu singkat?
```

Contoh:

```text
Baseline: 100 request/s selama 10 menit.
Spike: 800 request/s selama 2 menit.
Recovery: kembali ke 100 request/s selama 10 menit.
```

Spike test penting untuk:

- public campaign;
- batch client yang salah konfigurasi;
- login storm;
- traffic setelah maintenance;
- external integration retry storm;
- autoscaling behavior.

### 2.6 Soak Test / Endurance Test

Soak test menjalankan beban moderat/tinggi dalam durasi panjang.

Pertanyaan utamanya:

```text
Apakah sistem tetap sehat setelah berjalan lama?
```

Contoh:

```text
200 request/s selama 8 jam.
```

Soak test mencari:

- memory leak;
- connection leak;
- thread leak;
- file descriptor leak;
- cache growth tidak terkendali;
- queue backlog gradual;
- GC degradation;
- log volume explosion;
- disk saturation;
- slow resource exhaustion.

Bug yang muncul di soak test sering tidak terlihat dalam load test 10 menit.

### 2.7 Capacity Test

Capacity test mencari kapasitas maksimum yang masih memenuhi SLO.

Pertanyaan utamanya:

```text
Berapa traffic maksimum yang bisa dilayani sebelum SLO dilanggar?
```

Capacity test menghasilkan capacity envelope:

```text
2 pod x 2 vCPU x 4 GiB: 180 req/s @ p99 < 1s
4 pod x 2 vCPU x 4 GiB: 340 req/s @ p99 < 1s
6 pod x 2 vCPU x 4 GiB: 470 req/s @ p99 < 1s
```

Capacity test harus memperhatikan shared bottleneck. Scaling pod tidak otomatis menaikkan capacity jika bottleneck ada di database.

### 2.8 Scalability Test

Scalability test menguji apakah kapasitas naik secara proporsional ketika resource ditambah.

Pertanyaan utamanya:

```text
Apakah sistem scale secara horizontal/vertical dengan efisien?
```

Contoh:

```text
2 pod -> 4 pod -> 8 pod
```

Yang diamati:

- throughput increase;
- latency stability;
- DB pressure;
- cache contention;
- lock contention;
- message partition utilization;
- load balancer distribution;
- connection pool total pressure;
- diminishing return.

### 2.9 Performance Regression Test

Performance regression test membandingkan build saat ini dengan baseline.

Pertanyaan utamanya:

```text
Apakah perubahan kode/config membuat performance lebih buruk secara signifikan?
```

Contoh:

- p95 naik > 15%;
- allocation per request naik > 25%;
- CPU per request naik > 20%;
- DB query count naik dari 5 menjadi 50;
- throughput turun dari 300 req/s menjadi 240 req/s.

Regression test tidak harus mencari kapasitas maksimum. Ia mencari perubahan dari baseline.

---

## 3. Jangan Campur Pertanyaan

Satu kesalahan besar adalah menjalankan satu test lalu mencoba menjawab semua pertanyaan.

Contoh test:

```text
Run 1000 users selama 1 jam.
```

Lalu tim mencoba menjawab:

- apakah aplikasi cepat?
- apakah kapasitas cukup?
- apakah ada memory leak?
- apakah scaling bagus?
- apakah release aman?
- apakah DB index sudah benar?
- apakah GC tuning perlu?

Ini terlalu kabur.

Pisahkan pertanyaan:

| Pertanyaan | Jenis Test Lebih Cocok |
|---|---|
| Apakah endpoint memenuhi SLO pada peak traffic? | Load test |
| Di mana titik patah sistem? | Stress/capacity test |
| Apakah sistem pulih setelah overload? | Stress + recovery test |
| Apakah traffic spike aman? | Spike test |
| Apakah ada leak setelah lama berjalan? | Soak test |
| Apakah build baru lebih lambat? | Regression test |
| Apakah method X lebih hemat allocation? | JMH microbenchmark |
| Apakah query menghasilkan N+1? | Integration/performance guard test |
| Apakah autoscaling cukup cepat? | Spike/scalability test |

Prinsipnya:

```text
Satu eksperimen harus punya satu primary question.
```

Boleh ada secondary observations, tetapi acceptance decision harus jelas.

---

## 4. Workload Model: Bagian Paling Penting yang Sering Diremehkan

Performance test hanya sebaik workload model-nya.

Workload model menjawab:

- siapa user/system actor?
- request apa yang dikirim?
- seberapa sering?
- distribusi traffic-nya bagaimana?
- payload size-nya seperti apa?
- data state-nya realistis atau kosong?
- dependency-nya nyata atau stub?
- session/auth flow-nya realistis?
- ada think time atau tidak?
- ada burst atau tidak?
- read/write ratio berapa?
- failure/retry ratio berapa?
- cache hit/miss ratio berapa?

Tanpa workload model, hasil test bisa sangat salah.

### 4.1 Contoh Workload Model Buruk

```text
1000 virtual users hit /api/cases/search.
```

Masalah:

- tidak ada arrival rate;
- tidak ada distribusi endpoint;
- tidak ada payload;
- tidak ada filter variasi;
- tidak jelas user login atau tidak;
- tidak jelas data volume;
- tidak jelas cache warm/cold;
- tidak jelas request berhasil/gagal;
- tidak jelas think time;
- tidak jelas acceptance criteria.

### 4.2 Contoh Workload Model Lebih Baik

```text
Target scenario: Officer peak-hour case management workload.

Duration:
- warmup: 10 minutes
- measurement: 30 minutes
- cooldown: 5 minutes

Traffic model:
- 60% case listing/search
- 15% case detail
- 10% submit decision
- 5% upload document metadata
- 5% audit trail view
- 5% reference data lookup

Arrival rate:
- normal: 80 requests/s
- peak: 250 requests/s

Data:
- 1,000,000 cases
- 5,000,000 audit records
- 200,000 active users/subjects
- realistic status distribution
- realistic module distribution

Acceptance:
- successful request rate >= 99.9%
- p95 latency < 500 ms for read APIs
- p99 latency < 1200 ms for read APIs
- p95 latency < 900 ms for write APIs
- p99 latency < 2000 ms for write APIs
- DB CPU < 75%
- no Full GC
- Hikari active connections < 80% of max pool for steady-state
- queue backlog returns to zero after test
```

Ini jauh lebih bisa dipakai untuk engineering decision.

---

## 5. Open Model vs Closed Model

Ini salah satu konsep paling penting dalam load testing.

### 5.1 Closed Model

Closed model membatasi jumlah virtual users. User berikutnya baru mengirim request setelah request sebelumnya selesai dan think time lewat.

Model sederhana:

```text
N users loop:
  send request
  wait response
  think time
  send next request
```

Karakteristik:

- cocok untuk mensimulasikan user interaktif;
- throughput bergantung pada latency;
- jika sistem lambat, request rate otomatis turun;
- bisa menyembunyikan overload;
- raw percentile bisa terlihat lebih baik daripada kenyataan saat sistem lambat.

Contoh:

```text
100 users, each waits response before next request.
```

Jika latency naik dari 100 ms ke 2 detik, jumlah request/s akan turun drastis karena user tertahan. Ini mungkin realistis untuk sebagian UI behavior, tetapi tidak realistis untuk traffic arrival dari banyak client independen atau queue producer.

### 5.2 Open Model

Open model mengatur arrival rate. Request datang dengan rate tertentu, terlepas dari response request sebelumnya.

Model sederhana:

```text
send 300 requests/s
regardless of whether previous requests completed
```

Karakteristik:

- cocok untuk server-side capacity;
- lebih baik untuk menguji overload;
- queueing terlihat lebih jelas;
- latency bisa naik tajam jika service tidak mampu;
- lebih dekat ke traffic aggregate dari banyak client.

### 5.3 Kapan Pakai yang Mana?

| Situation | Model |
|---|---|
| UI user journey dengan think time realistis | Closed/semi-closed |
| API gateway traffic target 500 req/s | Open |
| Queue consumer arrival rate | Open |
| Login user session flow | Closed/semi-closed |
| Capacity test service | Open |
| Stress test overload | Open |
| User journey E2E | Closed dengan think time |

Prinsip penting:

```text
Closed model menjawab “bagaimana user experience untuk N active users?”
Open model menjawab “apa yang terjadi jika sistem menerima R requests/s?”
```

Keduanya valid, tetapi menjawab pertanyaan berbeda.

---

## 6. Latency: Jangan Pernah Hanya Melihat Average

Average latency sering menipu.

Misalnya 100 request:

```text
99 request selesai 100 ms
1 request selesai 10.000 ms
```

Average:

```text
(99 * 100 + 1 * 10000) / 100 = 199 ms
```

Average terlihat masih “oke”, tetapi satu user mengalami 10 detik.

Di sistem enterprise, tail latency sangat penting karena:

- user merasakan request individual, bukan rata-rata;
- timeout biasanya terjadi di tail;
- retry dipicu oleh tail;
- thread/connection tertahan oleh tail;
- p99 sering menjadi sinyal awal saturation;
- downstream bottleneck sering muncul di percentile tinggi.

### 6.1 Percentile yang Harus Dibaca

Minimal:

```text
p50, p90, p95, p99, max, error rate
```

Lebih baik:

```text
p50, p75, p90, p95, p99, p99.9, max, count, error, throughput
```

Tetapi percentile tanpa histogram bisa kurang. Histogram membantu melihat distribusi:

```text
0-100 ms      60%
100-300 ms    25%
300-1000 ms   10%
1-5 s          4%
>5 s           1%
```

Ini lebih informatif daripada average.

### 6.2 Percentile Harus Dipisah per Endpoint

Gabungan semua endpoint bisa misleading.

Misalnya:

- `/reference-data`: 5 ms;
- `/case/search`: 300 ms;
- `/report/generate`: 10 detik.

Jika digabung, satu endpoint lambat bisa tersembunyi atau endpoint cepat mendominasi.

Pisahkan:

```text
latency by endpoint
latency by status code
latency by operation type
latency by payload size
latency by user role
latency by dependency path
```

---

## 7. Coordinated Omission

Coordinated omission terjadi ketika measurement system tidak mengukur delay yang seharusnya dialami request karena load generator menunggu sistem selesai sebelum mengirim request berikutnya.

Akibatnya, percentile latency terlihat lebih baik daripada kenyataan.

Contoh sederhana:

Target arrival seharusnya:

```text
1 request setiap 10 ms
```

Tetapi saat server stall selama 2 detik, generator yang synchronous tidak mengirim request selama stall itu. Setelah server pulih, generator melanjutkan. Delay request yang “seharusnya datang saat stall” tidak tercatat.

Hasilnya:

```text
p99 terlihat rendah, padahal user/traffic nyata akan mengalami backlog besar.
```

### 7.1 Cara Mengurangi Risiko Coordinated Omission

1. Gunakan open workload model untuk capacity/stress.
2. Gunakan tool/scenario yang mendukung constant arrival rate.
3. Catat scheduled start time vs actual completion time jika memungkinkan.
4. Jangan hanya memakai closed-loop virtual users untuk server capacity.
5. Bandingkan load generator metric dengan server-side metric.
6. Lihat queue depth, active request, pending request, dan timeout.
7. Gunakan histogram latency dan time-series, bukan summary saja.

### 7.2 Interpretasi Praktis

Jika test result mengatakan:

```text
p99 = 400 ms
```

Tetapi server metric menunjukkan:

```text
request queue naik besar
thread pool saturated
connection pool exhausted
timeout client meningkat
```

Maka percentile test mungkin tidak mengukur pengalaman nyata secara benar.

---

## 8. Throughput, Concurrency, dan Little’s Law

Little’s Law:

```text
L = λ * W
```

Di mana:

- `L` = jumlah item dalam sistem/concurrency;
- `λ` = arrival rate/throughput;
- `W` = average time in system/latency.

Contoh:

```text
throughput = 200 request/s
average latency = 0.5 s
concurrency ≈ 100 in-flight requests
```

Jika latency naik menjadi 2 detik pada throughput sama:

```text
concurrency ≈ 400 in-flight requests
```

Implikasi:

- thread lebih banyak tertahan;
- connection lebih lama dipakai;
- memory per request naik;
- queue lebih panjang;
- timeout makin mungkin;
- GC pressure bisa naik.

Little’s Law membantu memahami kenapa latency bukan sekadar masalah user experience, tetapi juga masalah kapasitas resource.

---

## 9. Saturation: Sinyal Utama Sebelum Collapse

Sistem biasanya gagal bukan karena satu angka latency, tetapi karena resource saturasi.

Resource yang perlu diamati:

### 9.1 CPU

Pantau:

- CPU usage;
- CPU throttling di container;
- run queue;
- user vs system CPU;
- steal time jika VM;
- load average dengan konteks CPU core.

CPU 90% tidak selalu buruk jika workload CPU-bound dan latency stabil. CPU 50% juga tidak selalu aman jika banyak request blocked pada DB atau lock.

### 9.2 Memory

Pantau:

- heap used;
- live set after GC;
- allocation rate;
- GC pause;
- old gen occupancy;
- metaspace;
- direct memory;
- native memory;
- RSS container;
- OOMKilled;
- swap jika ada.

Memory issue sering muncul sebagai:

- latency spike;
- GC frequency naik;
- Full GC;
- container kill;
- slow degradation di soak test.

### 9.3 Thread Pool

Pantau:

- active threads;
- queue length;
- completed tasks;
- rejected tasks;
- task wait time;
- blocked/waiting threads;
- virtual thread pinning jika Java 21+.

Thread pool yang terlalu besar bisa memperburuk DB saturation. Thread pool yang terlalu kecil bisa membatasi throughput walau CPU masih rendah.

### 9.4 Connection Pool

Pantau:

- active connection;
- idle connection;
- pending acquire;
- acquire latency;
- timeout acquiring connection;
- max lifetime churn;
- DB session count.

Connection pool bukan sekadar knob untuk dinaikkan. Pool terlalu besar bisa menghancurkan DB.

### 9.5 Database

Pantau:

- DB CPU;
- wait event;
- active sessions;
- lock wait;
- buffer/cache hit;
- IO latency;
- slow query;
- execution plan;
- row scanned;
- temp usage;
- connection count;
- transaction duration.

Untuk sistem Java enterprise, bottleneck paling sering ada di DB/query/transaction, bukan JVM flag.

### 9.6 External Dependency

Pantau:

- downstream latency;
- error rate;
- timeout;
- retry count;
- circuit breaker state;
- rate limit;
- connection pool;
- TLS handshake rate;
- DNS issue.

Downstream lambat bisa membuat upstream thread/connection tertahan dan menyebabkan throughput collapse.

### 9.7 Queue/Broker

Pantau:

- queue depth;
- consumer lag;
- publish rate;
- consume rate;
- redelivery;
- DLQ count;
- consumer error;
- partition skew;
- ack latency.

Untuk async system, latency API mungkin normal sementara backlog event makin membesar. Itu bukan sistem sehat.

---

## 10. Anatomy of a Good Load Test

Load test yang baik punya struktur.

```text
1. Define objective
2. Define workload model
3. Define environment
4. Define data state
5. Define dependencies
6. Define acceptance criteria
7. Define telemetry
8. Run warmup
9. Run measurement
10. Run recovery/cooldown
11. Analyze correlated evidence
12. Decide
13. Archive artifacts
```

### 10.1 Objective

Contoh:

```text
Validate that Case Search API can support projected peak traffic after audit table grows to 50M records.
```

Objective harus terkait risiko.

### 10.2 Workload

Contoh:

```text
70% simple search
20% filtered search by status/date/module
10% complex search with text keyword
```

### 10.3 Environment

Dokumentasikan:

- app version;
- Java version;
- JVM args;
- pod count;
- CPU/memory request/limit;
- DB size/type;
- DB parameter/config;
- cache config;
- network path;
- dependency versions;
- load generator size/location.

Tanpa environment detail, hasil tidak reproducible.

### 10.4 Data State

Performance query sangat bergantung pada data.

Dokumentasikan:

- table row count;
- index;
- status distribution;
- date distribution;
- tenant/module distribution;
- LOB size;
- data skew;
- cache warm/cold;
- sequence/id distribution;
- archived vs active data.

### 10.5 Dependencies

Tentukan:

- real dependency;
- mock/stub;
- service virtualization;
- fixed latency fake;
- failure injection.

Jangan diam-diam mock dependency lalu mengklaim kapasitas production.

### 10.6 Acceptance Criteria

Contoh:

```text
Functional:
- success rate >= 99.9%
- no data integrity violation
- no duplicate case number
- audit trail complete

Latency:
- p95 < 500 ms
- p99 < 1200 ms
- max < 10 s except known downstream timeout path

Throughput:
- sustain 250 request/s for 30 minutes

Resource:
- app CPU avg < 75%, p95 < 85%
- no CPU throttling > 5% of test duration
- heap after GC stable
- no Full GC
- DB CPU avg < 70%, p95 < 85%
- Hikari pending acquire near 0 during steady state

Recovery:
- after load stops, queue backlog returns to zero within 5 minutes
- error rate returns to baseline
```

Acceptance criteria harus mencakup resource dan recovery, bukan hanya latency.

---

## 11. Load Test Scenario Patterns

### 11.1 Constant Load

```text
100 request/s for 30 minutes
```

Cocok untuk:

- baseline load;
- regression comparison;
- steady-state behavior;
- release validation.

### 11.2 Step Load

```text
50 req/s  for 10 min
100 req/s for 10 min
200 req/s for 10 min
300 req/s for 10 min
400 req/s for 10 min
```

Cocok untuk:

- melihat capacity curve;
- menemukan knee point;
- membandingkan saturation metrics per level.

### 11.3 Ramp-Up Load

```text
ramp 0 -> 300 req/s over 15 minutes
hold 300 req/s for 30 minutes
```

Cocok untuk:

- menghindari cold shock;
- simulasi traffic naik gradual;
- memberi waktu JIT/cache warmup.

### 11.4 Spike Load

```text
100 req/s 10 min
1000 req/s 2 min
100 req/s 10 min
```

Cocok untuk:

- autoscaling;
- burst protection;
- queue buffering;
- rate limiter behavior.

### 11.5 Stress Until Failure

```text
increase by 100 req/s every 5 minutes until SLO breaks
```

Cocok untuk:

- capacity envelope;
- failure mode;
- bottleneck discovery.

### 11.6 Soak

```text
200 req/s for 8 hours
```

Cocok untuk:

- leak;
- progressive degradation;
- long-lived resource exhaustion.

### 11.7 Mixed Journey

```text
login -> list cases -> view case -> update decision -> upload document -> logout
```

Cocok untuk:

- user journey;
- session behavior;
- auth token refresh;
- cache/session storage;
- end-to-end flow.

---

## 12. Workload Realism: Distribusi Lebih Penting dari Angka Total

Dua test sama-sama 300 req/s bisa sangat berbeda.

### 12.1 Test A

```text
300 req/s all hit /reference-data/countries
```

Hasil mungkin sangat baik karena endpoint cache-heavy dan ringan.

### 12.2 Test B

```text
180 req/s search case
60 req/s case detail
30 req/s submit decision
20 req/s audit trail
10 req/s document metadata
```

Hasil bisa jauh lebih berat karena melibatkan DB, transaction, audit, permission, serialization, dan locks.

### 12.3 Data Distribution

Query terhadap data kosong bukan test performance.

Realistic data harus mempertimbangkan:

- large active table;
- old records;
- skewed status;
- hot tenant/module;
- wide rows;
- LOB fields;
- audit trail growth;
- soft-deleted rows;
- unselective filters;
- null values;
- pagination deep page;
- sorting expensive columns.

### 12.4 Payload Distribution

Jangan hanya test payload kecil.

Contoh distribusi:

```text
70% payload small
25% payload medium
5% payload large
```

Large payload sering memicu:

- serialization cost;
- memory allocation;
- network bandwidth;
- request body buffering;
- file upload temp storage;
- GC pressure.

---

## 13. Load Generator Juga Bisa Jadi Bottleneck

Jika load generator tidak cukup kuat, kamu mengukur load generator, bukan system under test.

Pantau load generator:

- CPU;
- memory;
- network bandwidth;
- open file descriptors;
- connection count;
- TLS cost;
- DNS;
- garbage collection jika tool berbasis JVM;
- event loop saturation jika tool berbasis JS/Go;
- clock/time sync.

Tanda load generator bottleneck:

- target RPS tidak tercapai;
- generator CPU 100%;
- client-side timeout banyak tetapi server tidak menerima traffic;
- network egress saturated;
- latency meningkat di client tetapi server metric normal;
- inconsistent result antar run.

Praktik baik:

- jalankan generator terpisah dari app;
- jangan satu node dengan system under test;
- gunakan beberapa injector jika perlu;
- dokumentasikan generator capacity;
- validasi dengan lightweight endpoint;
- pastikan time sync untuk correlation.

---

## 14. Java-Specific Observability Saat Load Test

Untuk aplikasi Java, load test harus dikaitkan dengan telemetry JVM.

Minimal collect:

```text
process CPU
container CPU throttling
heap used
heap after GC
allocation rate
GC pause
GC count
thread count
blocked thread count
safepoint pause
class loading if relevant
direct buffer usage if relevant
native memory if suspicious
```

Service-level:

```text
request rate
error rate
latency percentile by endpoint
in-flight request
HTTP status code
thread pool active/queue/rejected
connection pool active/idle/pending/acquire time
cache hit/miss
downstream latency/error/retry
queue publish/consume/lag
```

Database-level:

```text
CPU
active sessions
wait events
slow queries
locks
deadlocks
IO latency
execution plan changes
connection count
temp usage
```

Artifacts to archive:

```text
load test script
load test raw result
server metrics dashboard snapshot
GC logs
JFR recording
thread dumps during peak
heap histogram if memory issue
DB AWR/ASH/slow query report when available
app logs with correlation IDs
version/config manifest
```

Performance result tanpa artifacts sulit dipercaya dan sulit diulang.

---

## 15. Correlating Metrics: Jangan Diagnosis dari Satu Grafik

Contoh:

```text
p99 latency naik.
```

Kemungkinan penyebab:

- CPU saturation;
- GC pause;
- DB slow query;
- connection pool wait;
- downstream timeout;
- lock contention;
- thread pool queue;
- network issue;
- load generator bottleneck;
- rate limiter;
- logging sink slow;
- cache miss storm;
- coordinated omission artifact.

Butuh korelasi.

### 15.1 Correlation Example: DB Pool Bottleneck

Gejala:

```text
p95 latency naik
app CPU rendah
DB CPU sedang
Hikari active == max
Hikari pending acquire naik
thread dump banyak waiting getConnection
```

Interpretasi:

```text
Bottleneck ada di DB connection availability atau query duration,
bukan CPU JVM.
```

Possible next step:

- lihat slow query;
- lihat transaction duration;
- kurangi hold time connection;
- periksa N+1 query;
- jangan langsung naikkan pool.

### 15.2 Correlation Example: CPU Saturation

Gejala:

```text
app CPU 95%
no connection pool wait
DB CPU rendah
GC normal
async-profiler shows JSON serialization 40%
```

Interpretasi:

```text
Bottleneck CPU di app, kemungkinan serialization/mapping.
```

Possible next step:

- optimize serialization;
- reduce payload;
- cache computed response;
- tune ObjectMapper usage;
- scale CPU/pod;
- test regression with benchmark.

### 15.3 Correlation Example: GC Pressure

Gejala:

```text
allocation rate naik dari 500 MB/s ke 2 GB/s
GC pause p99 naik
old gen after GC slowly grows
p99 request latency follows GC pause
```

Interpretasi:

```text
Performance issue terkait allocation/live set/retention.
```

Possible next step:

- capture JFR allocation profile;
- heap dump if retention suspected;
- inspect large payload path;
- inspect cache growth;
- review recent code changes.

### 15.4 Correlation Example: Retry Storm

Gejala:

```text
downstream p99 naik
upstream retry count naik
request rate to downstream > incoming user request rate
thread pool active naik
error rate makin besar
```

Interpretasi:

```text
Retry memperbesar load dan memperburuk failure.
```

Possible next step:

- cap retry;
- add jitter;
- circuit breaker;
- timeout budget;
- fallback/load shedding;
- prevent retry on non-retryable error.

---

## 16. Capacity Envelope

Capacity bukan satu angka mutlak.

Salah:

```text
Service capacity adalah 500 request/s.
```

Benar:

```text
Dengan config A, data size B, dependency state C, dan SLO D,
service mampu sustain 500 request/s selama 30 menit.
```

Capacity envelope berisi kondisi.

Contoh:

| Config | Workload | SLO | Capacity | Bottleneck |
|---|---:|---:|---:|---|
| 2 pod, 2 vCPU, 4 GiB | read-heavy | p99 < 1s | 180 rps | app CPU |
| 4 pod, 2 vCPU, 4 GiB | read-heavy | p99 < 1s | 330 rps | DB CPU |
| 4 pod, 2 vCPU, 4 GiB | write-heavy | p99 < 2s | 120 rps | DB lock/log IO |
| 6 pod, 2 vCPU, 4 GiB | read-heavy | p99 < 1s | 360 rps | DB connection/wait |

Insight:

```text
Scaling pod dari 4 ke 6 hanya menaikkan capacity sedikit karena bottleneck pindah ke DB.
```

Capacity envelope membantu:

- sizing infrastructure;
- autoscaling policy;
- release readiness;
- cost tradeoff;
- capacity planning;
- incident response;
- business SLA negotiation.

---

## 17. Knee Point dan Throughput Collapse

Dalam stress/capacity test, perhatikan knee point.

Knee point adalah titik ketika tambahan load kecil menyebabkan latency naik tajam.

Contoh:

| RPS | p95 | p99 | Error | CPU | DB Pool Pending |
|---:|---:|---:|---:|---:|---:|
| 100 | 120ms | 300ms | 0% | 35% | 0 |
| 200 | 180ms | 500ms | 0% | 55% | 0 |
| 300 | 350ms | 900ms | 0% | 75% | 2 |
| 350 | 800ms | 3s | 0.5% | 82% | 50 |
| 400 | 3s | 12s | 8% | 85% | 300 |

Knee point sekitar 300–350 RPS.

Jangan set production target tepat di knee point. Beri headroom.

Praktik:

```text
Jika SLO break di 350 RPS, target safe capacity mungkin 250-280 RPS,
tergantung criticality dan traffic variability.
```

---

## 18. Headroom

Headroom adalah kapasitas cadangan untuk menyerap variasi.

Tanpa headroom, sistem mudah collapse saat:

- traffic naik sedikit;
- downstream melambat;
- satu pod mati;
- GC pause lebih panjang;
- DB plan berubah;
- deployment rolling update;
- cache cold;
- batch job berjalan;
- network latency naik.

Contoh policy:

```text
Normal peak traffic must not exceed 60-70% of measured safe capacity.
```

Atau:

```text
System must survive N-1 pod capacity during rolling deployment.
```

Untuk sistem regulatory/enterprise, headroom bukan pemborosan. Headroom adalah reliability budget.

---

## 19. Performance Test Data Strategy

Data test bisa membuat hasil salah total.

### 19.1 Empty Database Trap

Test dengan database kosong sering menghasilkan:

- query sangat cepat;
- index tidak diuji;
- pagination tidak realistis;
- join cost tidak muncul;
- LOB pressure tidak muncul;
- audit trail growth tidak muncul.

### 19.2 Production Clone Trap

Production-like data bagus, tapi ada risiko:

- PII/security;
- compliance;
- masking;
- data freshness;
- cost;
- reproducibility;
- hidden external references.

### 19.3 Synthetic Data Trap

Synthetic data aman, tapi bisa tidak realistis:

- uniform distribution padahal production skewed;
- string size terlalu kecil;
- no null values;
- no historical records;
- no hot tenant;
- no duplicate-like data;
- no pathological cases.

### 19.4 Recommended Strategy

Gunakan synthetic-but-realistic data:

```text
- realistic row count
- realistic distribution
- realistic payload size
- realistic skew
- realistic status lifecycle
- realistic historical/audit growth
- realistic invalid/edge records where needed
```

Untuk case-management system:

```text
case table: millions of rows
audit trail: many times larger than case table
document metadata: realistic relation count
status distribution: not uniform
recent records: high access probability
old records: still searchable
module distribution: skewed
role/permission data: realistic
```

---

## 20. Environment Strategy

Performance environment harus cukup representatif.

Pertanyaan:

- apakah instance size sama dengan production?
- apakah pod request/limit sama?
- apakah DB class sama?
- apakah DB parameter sama?
- apakah index sama?
- apakah network path sama?
- apakah cache size sama?
- apakah external dependency sama atau stub?
- apakah autoscaling aktif?
- apakah logging level sama?
- apakah TLS aktif?
- apakah WAF/API gateway aktif?
- apakah auth flow sama?

Tidak semua test harus production-identical, tetapi perbedaan harus diketahui.

### 20.1 Environment Manifest

Setiap performance test harus menghasilkan manifest:

```yaml
application:
  version: 1.42.0
  commit: abc123
  java: 21.0.4
  framework: Spring Boot 3.4.x
  jvm_args:
    - -Xms2g
    - -Xmx2g
    - -XX:+UseG1GC

runtime:
  platform: Kubernetes
  replicas: 4
  cpu_request: 1
  cpu_limit: 2
  memory_request: 3Gi
  memory_limit: 4Gi

database:
  engine: Oracle 19c
  size: 2TB
  relevant_table_counts:
    CASE: 1000000
    AUDIT_TRAIL: 50000000

load_test:
  tool: k6
  script: case-search-peak.js
  arrival_rate: 250 rps
  duration: 30m
```

Tanpa manifest, hasil load test tidak bisa dipakai untuk audit teknis.

---

## 21. Tooling Overview

### 21.1 Apache JMeter

JMeter adalah aplikasi Java open-source untuk load testing functional behavior dan performance measurement. Kuat untuk banyak protokol dan sudah lama dipakai di enterprise.

Kelebihan:

- mature;
- GUI untuk test plan;
- banyak protocol support;
- JDBC test support;
- banyak plugin;
- familiar di enterprise QA.

Kelemahan:

- test plan GUI/XML bisa sulit di-review;
- distributed execution perlu disiplin;
- resource generator bisa besar;
- script-as-code experience tidak sebersih tool modern;
- raw result harus dikelola hati-hati.

Cocok untuk:

- organisasi yang sudah punya JMeter skill;
- mixed protocol;
- QA-driven performance testing;
- existing enterprise pipeline.

### 21.2 Gatling

Gatling adalah load testing tool yang berorientasi code-driven scenario. Dokumentasi Gatling menekankan scenario as code dan workflow yang bisa dibaca, versioned, dan dipelihara seperti kode.

Kelebihan:

- scenario-as-code;
- baik untuk developer workflow;
- report bagus;
- cocok untuk CI;
- DSL expressive.

Kelemahan:

- learning curve DSL;
- advanced enterprise feature sebagian ada di paid ecosystem;
- perlu disiplin workload modelling.

Cocok untuk:

- engineering-led performance test;
- versioned scenarios;
- API performance testing;
- CI regression performance.

### 21.3 k6

k6 adalah open-source load testing tool dengan script JavaScript dan integrasi observability Grafana ecosystem. Dokumentasinya mendukung scenarios untuk memodelkan workload dan thresholds untuk automation/release gate.

Kelebihan:

- simple developer experience;
- JS scripting;
- strong threshold model;
- good for CI/CD;
- scenario model fleksibel;
- integrasi Grafana/Prometheus ecosystem.

Kelemahan:

- bukan browser penuh secara default;
- JS runtime environment berbeda dari Node.js penuh;
- protocol support tergantung module;
- distributed/cloud setup perlu keputusan tambahan.

Cocok untuk:

- API load testing;
- threshold-based release gate;
- engineering teams;
- observability-driven workflow.

### 21.4 wrk / wrk2 / vegeta

Tools ringan untuk HTTP benchmark/load generation.

Kelebihan:

- cepat;
- sederhana;
- bagus untuk smoke performance;
- berguna untuk latency/throughput quick check.

Kelemahan:

- kurang cocok untuk complex user journey;
- scripting terbatas;
- auth/session kompleks lebih sulit;
- hasil bisa misleading jika model salah.

wrk2 relevan karena mencoba mempertahankan constant throughput dan mendiskusikan coordinated omission.

### 21.5 Pilihan Tool Berdasarkan Kebutuhan

| Kebutuhan | Tool yang Cocok |
|---|---|
| Enterprise QA existing | JMeter |
| Code-driven scenario JVM/Scala/Java/Kotlin | Gatling |
| Developer-friendly API test + thresholds | k6 |
| Quick HTTP throughput check | wrk/vegeta |
| Browser/user journey full UI | Playwright-based/load platform khusus |
| Microbenchmark Java code | JMH |

Tool terbaik adalah tool yang tim bisa jalankan secara reproducible, reviewable, dan correlated dengan telemetry.

---

## 22. Example: k6 Load Test untuk API

Contoh sederhana untuk open-ish constant arrival rate.

```javascript
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    case_search_peak: {
      executor: 'constant-arrival-rate',
      rate: 250,
      timeUnit: '1s',
      duration: '30m',
      preAllocatedVUs: 300,
      maxVUs: 1000,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{endpoint:case_search}': ['p(95)<500', 'p(99)<1200'],
  },
};

const BASE_URL = __ENV.BASE_URL;
const TOKEN = __ENV.TOKEN;

export default function () {
  const params = {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    tags: {
      endpoint: 'case_search',
    },
  };

  const status = randomStatus();
  const page = Math.floor(Math.random() * 10);

  const res = http.get(
    `${BASE_URL}/api/cases?status=${status}&page=${page}&size=20`,
    params
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
    'has body': (r) => r.body && r.body.length > 0,
  });
}

function randomStatus() {
  const statuses = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];
  return statuses[Math.floor(Math.random() * statuses.length)];
}
```

Catatan penting:

- token statis mungkin tidak realistis untuk auth-heavy workload;
- random uniform status mungkin tidak realistis;
- harus tag endpoint agar percentile tidak tergabung;
- harus punya server-side telemetry;
- harus archive raw result;
- jangan hanya percaya summary output.

---

## 23. Example: Gatling Scenario Concept

Pseudo-style Java DSL concept:

```java
public class CaseSearchSimulation extends Simulation {

    HttpProtocolBuilder httpProtocol = http
        .baseUrl(System.getProperty("baseUrl"))
        .acceptHeader("application/json")
        .authorizationHeader("Bearer " + System.getProperty("token"));

    ScenarioBuilder scn = scenario("Case Search Peak")
        .exec(http("case_search")
            .get("/api/cases")
            .queryParam("status", "UNDER_REVIEW")
            .queryParam("page", "0")
            .queryParam("size", "20")
            .check(status().is(200))
        );

    {
        setUp(
            scn.injectOpen(
                constantUsersPerSec(250).during(Duration.ofMinutes(30))
            )
        ).protocols(httpProtocol)
         .assertions(
             global().failedRequests().percent().lt(0.1),
             details("case_search").responseTime().percentile3().lt(1200)
         );
    }
}
```

Intinya bukan syntax spesifik, tetapi konsep:

- scenario as code;
- open injection profile;
- named request;
- assertion/release gate;
- parameterized environment.

---

## 24. Example: JMeter Test Plan Structure

JMeter test plan biasanya terdiri dari:

```text
Test Plan
  Thread Group / Open Model plugin if used
    HTTP Header Manager
    HTTP Cookie Manager
    CSV Data Set Config
    HTTP Request: login/token if needed
    HTTP Request: case search
    HTTP Request: case detail
    HTTP Request: decision submit
    Assertions
    Listeners / Backend Listener
```

JMeter kuat, tetapi test plan harus diperlakukan seperti source code:

- disimpan di version control;
- review change diff;
- parameterize environment;
- hindari hardcoded credentials;
- output raw result ke artifact;
- jangan jalankan GUI mode untuk heavy load;
- monitor generator resource.

---

## 25. Performance Acceptance Criteria Template

Gunakan template berikut untuk setiap test.

```markdown
# Performance Test Acceptance Criteria

## Objective
Validate <system/use-case> under <traffic/load condition> for <release/risk>.

## Workload
- Scenario mix:
  - <endpoint/use-case>: <percentage>
- Arrival rate/concurrency:
- Duration:
- Ramp-up:
- Data size:
- Payload distribution:

## Functional correctness
- Success rate:
- Data integrity:
- Duplicate prevention:
- Audit/event consistency:

## Latency
- p50:
- p95:
- p99:
- p99.9 if needed:
- max/timeout behavior:

## Throughput
- Target request/s:
- Successful request/s:

## Error
- HTTP 5xx:
- HTTP 4xx expected/unexpected:
- timeout:
- downstream error:

## JVM/App Resource
- CPU:
- CPU throttling:
- Heap after GC:
- GC pause:
- Thread pool queue:
- Connection pool pending:

## Database/Dependency
- DB CPU:
- DB wait:
- slow query:
- lock/deadlock:
- downstream latency:

## Recovery
- backlog drain:
- latency returns to baseline:
- no stuck thread:
- no leak signal:

## Artifacts
- raw load result:
- dashboard snapshot:
- GC log:
- JFR:
- thread dump:
- DB report:
- config manifest:
```

---

## 26. Failure Mode Catalogue

Saat performance test gagal, jangan langsung tuning. Klasifikasikan failure mode.

### 26.1 CPU-Bound App

Signals:

```text
app CPU high
DB healthy
GC acceptable
thread dump mostly runnable
profiler shows hot CPU path
```

Actions:

- profile CPU;
- optimize hot path;
- reduce serialization/mapping;
- cache carefully;
- scale CPU;
- reduce logging;
- review algorithm complexity.

### 26.2 DB-Bound

Signals:

```text
DB CPU/wait high
connection pool active high
query latency high
app CPU moderate/low
```

Actions:

- inspect slow queries;
- execution plan;
- indexes;
- reduce N+1;
- shorten transactions;
- tune query pagination;
- archive/partition if relevant;
- avoid increasing app concurrency blindly.

### 26.3 Connection Pool Starvation

Signals:

```text
pending acquire high
active == max
many threads waiting for connection
DB may or may not be saturated
```

Actions:

- inspect connection hold time;
- check transaction boundaries;
- check slow queries;
- check leaks;
- tune pool only after understanding DB capacity.

### 26.4 GC/Allocation Pressure

Signals:

```text
allocation rate high
GC frequency high
pause correlates with latency
heap after GC growing
```

Actions:

- JFR allocation profile;
- inspect large object allocation;
- reduce per-request allocation;
- fix retention/leak;
- tune heap/GC after code/data issue understood.

### 26.5 Lock Contention

Signals:

```text
CPU not maxed
thread dump blocked
JFR monitor blocked events
p99 latency high
throughput flat
```

Actions:

- identify lock;
- reduce synchronized region;
- use concurrent data structure;
- shard lock;
- remove global mutex;
- review cache loading.

### 26.6 Thread Pool Queueing

Signals:

```text
executor queue grows
active threads == max
latency increases
CPU may be low if tasks blocked
```

Actions:

- classify task blocking vs CPU;
- separate pools;
- add backpressure;
- adjust pool size;
- remove blocking call from event-loop;
- use virtual threads only when suitable.

### 26.7 Downstream Timeout/Retry Storm

Signals:

```text
downstream latency/error increases
retry count increases
traffic amplification
thread/connection held longer
```

Actions:

- timeout budget;
- retry cap;
- jitter;
- circuit breaker;
- bulkhead;
- fail fast;
- cache fallback if safe.

### 26.8 Load Generator Bottleneck

Signals:

```text
generator CPU high
target rate not reached
server underutilized
client-side latency inconsistent
```

Actions:

- scale generators;
- move generator closer/farther depending goal;
- reduce client overhead;
- validate with simple endpoint;
- inspect network.

---

## 27. Java 8–25 Compatibility Notes

### 27.1 Java 8

Common characteristics:

- CMS/Parallel/G1 availability depending config;
- old GC logging flags;
- no built-in container ergonomics as mature as newer JDKs;
- no JFR in same open availability model as modern JDK distributions;
- legacy frameworks common;
- JUnit 4/JUnit 5 mix likely;
- async-profiler still useful but setup differs.

Performance test implications:

- be explicit with `-Xms/-Xmx`;
- use Java 8 GC logging syntax;
- carefully validate container memory behavior;
- use external profilers/tools where needed.

### 27.2 Java 11

Common characteristics:

- G1 default;
- unified logging available;
- JFR available in OpenJDK ecosystem;
- better container support;
- common enterprise LTS migration target.

Performance test implications:

- collect JFR;
- use `-Xlog:gc*`;
- validate `MaxRAMPercentage` if containerized.

### 27.3 Java 17

Common characteristics:

- strong modern LTS baseline;
- many frameworks moved here;
- JUnit 6 requires Java 17+;
- improved GC/runtime.

Performance test implications:

- good baseline for modern CI matrix;
- use JFR/JMC workflow;
- compare with Java 11 during migration.

### 27.4 Java 21

Common characteristics:

- virtual threads are production feature;
- generational ZGC available;
- modern low-latency options improved.

Performance test implications:

- thread count interpretation changes with virtual threads;
- test pinning/blocking behavior;
- connection pool and downstream constraints remain real;
- virtual threads do not remove DB capacity limits.

### 27.5 Java 25

Common characteristics:

- next modern release line after Java 21;
- use official JDK 25 docs/release notes for option changes;
- validate removed/deprecated flags before migration.

Performance test implications:

- run compatibility performance suite;
- compare JVM ergonomics;
- validate GC behavior;
- verify observability tooling supports JDK 25;
- do not assume Java 21 tuning flags remain ideal.

---

## 28. Performance Test Workflow for Java Service

Step-by-step recommended workflow:

### Step 1: Define Decision

```text
We need to decide whether release 1.42 can go to production with expected peak load.
```

### Step 2: Define SLO

```text
p95 < 500 ms
p99 < 1200 ms
error < 0.1%
```

### Step 3: Define Workload

```text
60% search
20% detail
10% update
10% audit view
```

### Step 4: Prepare Data

```text
1M cases
50M audit records
realistic status/date/module distribution
```

### Step 5: Freeze Environment Manifest

```text
app version
JDK version
JVM args
pod count
DB config
cache config
```

### Step 6: Enable Telemetry

```text
app metrics
JVM metrics
GC logs
JFR on demand
DB metrics
load generator metrics
```

### Step 7: Warmup

Warmup matters because:

- JIT compilation;
- cache warmup;
- DB buffer cache;
- connection pool initialization;
- class loading;
- TLS/session setup.

But do not hide cold-start requirement if cold-start is part of risk.

### Step 8: Measurement

Run stable period long enough:

```text
at least 15-30 minutes for normal load validation
longer for soak
```

### Step 9: Capture Incidents During Run

If p99 spikes:

- mark timestamp;
- capture thread dump;
- note DB event;
- capture JFR window;
- correlate with GC.

### Step 10: Recovery

After load stops:

- latency returns normal;
- queue backlog drains;
- CPU drops;
- heap after GC stabilizes;
- no stuck thread;
- no connection leak.

### Step 11: Analyze

Do not only read summary.

Analyze:

- time series;
- endpoint percentile;
- error classification;
- resource saturation;
- bottleneck path;
- artifact evidence.

### Step 12: Decide

Possible decision:

```text
PASS: release accepted.
PASS WITH RISK: release accepted with monitoring/runbook.
FAIL: must fix bottleneck before release.
INCONCLUSIVE: rerun due to invalid test setup/noise/tool bottleneck.
```

Inconclusive is valid. Better than false confidence.

---

## 29. Performance Report Template

```markdown
# Performance Test Report

## 1. Executive Summary
- Result: PASS / FAIL / INCONCLUSIVE
- Primary finding:
- Main bottleneck:
- Release recommendation:

## 2. Objective

## 3. Environment Manifest
- App version:
- Java version:
- JVM args:
- Infrastructure:
- DB:
- Dependencies:

## 4. Workload Model
- Scenario mix:
- Arrival/concurrency model:
- Duration:
- Data size:
- Payload distribution:

## 5. Acceptance Criteria

## 6. Result Summary
- Throughput:
- Success rate:
- Error rate:
- Latency p50/p95/p99:
- Resource usage:

## 7. Endpoint Breakdown

## 8. Saturation Analysis
- App CPU:
- JVM/GC:
- Thread pools:
- Connection pools:
- DB:
- Downstream:
- Queue:

## 9. Timeline of Events

## 10. Bottleneck Analysis

## 11. Risk and Limitations

## 12. Recommendation

## 13. Artifacts
- raw result:
- dashboard:
- GC logs:
- JFR:
- thread dumps:
- DB reports:
```

---

## 30. Practical Case Study: Case Search API

### 30.1 Scenario

A case-management system has a search endpoint:

```text
GET /api/cases?status=UNDER_REVIEW&from=2025-01-01&to=2025-12-31&page=0&size=20
```

Production concern:

- audit trail table is growing;
- search joins module/user/status tables;
- p99 latency occasionally high;
- release adds new filter;
- projected peak traffic increases.

### 30.2 Objective

```text
Validate case search performance with realistic data volume after adding new filter.
```

### 30.3 Workload

```text
80% first page search
10% page 2-5
5% deep page
5% keyword search

arrival rate:
- 100 rps baseline
- 250 rps peak
- 350 rps stress
```

### 30.4 Acceptance

```text
p95 < 500 ms
p99 < 1200 ms
error < 0.1%
DB CPU < 75%
no connection pool pending during steady state
no Full GC
```

### 30.5 Findings Example

At 250 rps:

```text
p95 = 420 ms
p99 = 980 ms
error = 0%
DB CPU = 68%
Hikari active p95 = 24/50
GC normal
```

At 350 rps:

```text
p95 = 1.2 s
p99 = 6.8 s
error = 2.5%
DB CPU = 92%
Hikari active = 50/50
pending acquire high
slow query shows sort spill
```

### 30.6 Interpretation

Safe capacity is not 350 rps. Knee point is between 250 and 350 rps.

Primary bottleneck:

```text
DB query/sort under higher concurrency.
```

Not primary bottleneck:

```text
JVM heap or GC.
```

### 30.7 Action

- inspect execution plan;
- add/adjust composite index if justified;
- reduce deep pagination cost;
- consider keyset pagination;
- reduce selected columns;
- review query generated by ORM;
- retest 250/350 rps;
- update capacity envelope.

---

## 31. Anti-Patterns

### 31.1 Average Latency Gate

```text
PASS if average latency < 500 ms
```

Bad because tail latency can be terrible.

Prefer:

```text
p95/p99 + error + resource saturation
```

### 31.2 One Endpoint Represents Whole System

Testing only `/health` or one light endpoint says almost nothing about business workload.

### 31.3 Empty Database Performance Test

Fast query on empty DB is not proof.

### 31.4 Load Test Without Telemetry

If test fails and no JVM/DB metrics exist, diagnosis becomes guesswork.

### 31.5 Increasing Thread/Connection Pool Blindly

More concurrency can amplify bottleneck.

### 31.6 Running Load Generator on Same Host/Node

This contaminates result.

### 31.7 Ignoring Error Classification

`error rate 1%` is insufficient. Need classify:

- timeout;
- 500;
- 429;
- validation;
- auth;
- downstream;
- connection acquire timeout.

### 31.8 Ignoring Recovery

A system that handles load but cannot recover cleanly is risky.

### 31.9 Treating Stubs as Production Evidence

Stubbed dependencies can be useful, but claims must be scoped.

### 31.10 No Baseline

Without baseline, you cannot know regression.

### 31.11 One Run Equals Truth

Performance varies. Repeat important tests.

### 31.12 No Artifact Retention

If raw data and config are missing, result is not audit-grade.

---

## 32. Checklist: Designing a Load Test

Use this before running.

```text
[ ] Primary question defined
[ ] Decision to make is clear
[ ] Workload model documented
[ ] Open vs closed model chosen intentionally
[ ] Endpoint/use-case mix realistic
[ ] Payload distribution realistic
[ ] Data volume realistic
[ ] Data distribution realistic
[ ] Environment manifest captured
[ ] JVM args captured
[ ] Java version captured
[ ] App version/commit captured
[ ] DB config and row counts captured
[ ] Dependency behavior documented
[ ] Load generator capacity validated
[ ] Server-side metrics enabled
[ ] JVM metrics enabled
[ ] GC logs/JFR plan ready
[ ] DB metrics enabled
[ ] Acceptance criteria defined
[ ] Error classification defined
[ ] Warmup period defined
[ ] Measurement period defined
[ ] Recovery period defined
[ ] Artifact storage prepared
[ ] Report template ready
```

---

## 33. Checklist: Reading Results

```text
[ ] Did target load actually happen?
[ ] Did load generator saturate?
[ ] Were errors expected or unexpected?
[ ] Are latency percentiles separated by endpoint?
[ ] Is p99 stable or spiky?
[ ] Did throughput plateau?
[ ] Did latency rise before errors?
[ ] Did CPU saturate?
[ ] Was there CPU throttling?
[ ] Did GC pause correlate with latency?
[ ] Did allocation rate change?
[ ] Did heap after GC grow?
[ ] Did thread pool queue grow?
[ ] Did connection pool pending acquire grow?
[ ] Did DB CPU/wait/locks increase?
[ ] Did downstream latency/error increase?
[ ] Did retry amplify traffic?
[ ] Did queue backlog drain after test?
[ ] Did system recover?
[ ] Are there enough artifacts to prove conclusion?
```

---

## 34. Top 1% Engineer Notes

Engineer biasa menjalankan load test dan bertanya:

```text
Berapa RPS-nya?
```

Engineer kuat bertanya:

```text
Dalam kondisi apa RPS itu valid?
Apa workload-nya?
Apa SLO-nya?
Apa bottleneck-nya?
Apa failure mode-nya?
Apa evidence-nya?
Apa headroom-nya?
Apa yang terjadi saat dependency lambat?
Apakah test menghindari coordinated omission?
Apakah load generator valid?
Apakah data representatif?
Apakah hasil bisa diulang?
Apa release decision-nya?
```

Performance testing bukan tentang menghasilkan angka besar. Performance testing adalah tentang mengurangi ketidakpastian sebelum sistem menerima traffic nyata.

Top-tier engineer tidak hanya mengoptimalkan. Ia membangun evidence system.

---

## 35. Ringkasan

Part ini membangun fondasi macro-level performance testing.

Poin utama:

1. Microbenchmark tidak menggantikan load test.
2. Load test, stress test, spike test, soak test, capacity test, dan regression test menjawab pertanyaan berbeda.
3. Workload model menentukan validitas hasil.
4. Open vs closed model harus dipilih dengan sadar.
5. Average latency hampir selalu tidak cukup.
6. p95/p99 harus dilihat per endpoint dan dikorelasikan dengan resource.
7. Coordinated omission bisa membuat percentile terlihat palsu.
8. Throughput, latency, concurrency, dan queueing saling terkait.
9. Saturation metrics sering lebih menjelaskan daripada latency summary.
10. Load generator juga bisa menjadi bottleneck.
11. Java load test harus mengumpulkan JVM telemetry: CPU, heap, GC, threads, pools, JFR.
12. Capacity adalah envelope, bukan angka absolut.
13. Recovery behavior sama pentingnya dengan steady-state behavior.
14. Performance test yang baik menghasilkan keputusan, bukan hanya report.

---

## 36. Referensi

- Apache JMeter User Manual — https://jmeter.apache.org/usermanual/index.html
- Apache JMeter Project — https://jmeter.apache.org/
- Gatling Documentation — https://docs.gatling.io/
- Grafana k6 Scenarios Documentation — https://grafana.com/docs/k6/latest/using-k6/scenarios/
- Grafana k6 Thresholds Documentation — https://grafana.com/docs/k6/latest/using-k6/thresholds/
- k6 Project — https://k6.io/
- Gil Tene wrk2 README and coordinated omission notes — https://github.com/giltene/wrk2
- Mechanical Sympathy discussion on Coordinated Omission — https://groups.google.com/g/mechanical-sympathy/c/icNZJejUHfE/m/BfDekfBEs_sJ
- OpenJDK JMH — https://openjdk.org/projects/code-tools/jmh/
- Oracle Java SE Documentation — https://docs.oracle.com/en/java/javase/

---

## 37. Status Seri

Progress saat ini:

```text
Part 019 dari 031 selesai.
```

Seri belum selesai. Bagian berikutnya:

```text
learn-java-testing-benchmarking-performance-jvm-part-020.md
```

Topik berikutnya:

```text
JVM Execution Model: Interpreter, JIT, Tiered Compilation, Code Cache, Deoptimization
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-testing-benchmarking-performance-jvm-part-018](./learn-java-testing-benchmarking-performance-jvm-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-testing-benchmarking-performance-jvm-part-020](./learn-java-testing-benchmarking-performance-jvm-part-020.md)

</div>