# learn-java-deployment-runtime-release-delivery-engineering

## Part 17 — Release Strategy: Rolling, Blue-Green, Canary, Shadow, Ring Deployment

> Seri: Java Deployment, Runtime, Release, and Delivery Engineering  
> Target: Java 8 hingga Java 25  
> Level: Advanced / Staff+ / Principal-oriented  
> Fokus: strategi rilis production-grade untuk aplikasi Java, terutama ketika perubahan software harus masuk ke sistem hidup tanpa merusak traffic, state, data, workflow, atau compliance evidence.

---

## 0. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Membedakan **deployment strategy** dari **release strategy**.
2. Memahami trade-off antara rolling, blue-green, canary, shadow, ring deployment, dark launch, dan feature flag.
3. Mendesain strategi rilis Java service berdasarkan karakteristik sistem: stateless/stateful, database change, message consumer, session, cache, external dependency, dan regulatory risk.
4. Menentukan kapan rollback aman, kapan rollback palsu, dan kapan harus roll-forward.
5. Membuat rollout plan yang punya observability gate, blast-radius control, rollback trigger, dan operational evidence.
6. Menghindari anti-pattern umum: rolling update pada perubahan database incompatible, canary tanpa metric gate, blue-green tanpa data compatibility, shadow traffic yang menulis data, dan rollback yang merusak schema.

---

## 1. Core Mental Model: Deploy vs Release

Banyak engineer mencampuradukkan dua hal:

```text
Deploy  = membuat versi baru tersedia di environment.
Release = membuat versi baru berdampak ke user/traffic/workload.
```

Keduanya bisa terjadi bersamaan, tapi tidak harus.

Contoh:

```text
Deploy tanpa release:
- aplikasi versi baru sudah running di production
- tetapi belum menerima traffic
- feature masih dimatikan dengan feature flag
- route mesh masih 0%

Release tanpa deploy baru:
- feature flag dinyalakan
- config rule berubah
- traffic dialihkan ke versi yang sudah standby
- user cohort diperluas dari 5% ke 50%
```

Untuk engineer senior, ini penting karena risiko sebenarnya sering bukan pada `kubectl apply`, tetapi pada momen ketika **real user, real data, real workflow, dan real external dependency** mulai menyentuh versi baru.

---

## 2. Deployment Strategy vs Release Strategy vs Migration Strategy

Ada tiga sumbu yang harus dipisahkan.

### 2.1 Deployment Strategy

Deployment strategy menjawab:

```text
Bagaimana artifact/version baru dimasukkan ke runtime environment?
```

Contoh:

- rolling update;
- recreate;
- deploy side-by-side;
- deploy inactive green environment;
- deploy new pod replica set;
- deploy new WAR ke app server;
- deploy new systemd release directory.

### 2.2 Release Strategy

Release strategy menjawab:

```text
Bagaimana traffic/user/workload mulai memakai versi baru?
```

Contoh:

- 100% traffic langsung;
- 5% traffic canary;
- user cohort tertentu;
- internal users only;
- tenant tertentu;
- region tertentu;
- endpoint tertentu;
- feature flag per capability.

### 2.3 Migration Strategy

Migration strategy menjawab:

```text
Bagaimana state/data/schema/event/config berubah agar kompatibel dengan versi baru?
```

Contoh:

- expand-contract database migration;
- dual-write;
- backfill;
- schema versioning;
- message schema compatibility;
- cache namespace migration;
- session migration;
- search index rebuild;
- secret/certificate rotation.

### 2.4 Kenapa Pemisahan Ini Penting

Misalnya:

```text
Deployment: rolling update pod Java service.
Release: semua user langsung masuk ke pod baru karena Service selector sama.
Migration: database column lama dihapus sebelum semua pod lama berhenti.
```

Secara kasat mata ini hanya “deploy biasa”. Secara risiko, ini adalah kombinasi berbahaya:

- pod lama masih bisa menerima traffic;
- pod lama masih mengakses schema lama;
- schema lama sudah berubah;
- error muncul hanya pada subset traffic;
- rollback aplikasi tidak mengembalikan schema;
- sistem masuk ke partial failure.

Top 1% deployment engineer tidak hanya bertanya:

```text
Apakah deployment berhasil?
```

Tetapi:

```text
Apakah semua versi yang mungkin berjalan bersamaan tetap kompatibel terhadap traffic, data, config, dan dependency yang sama?
```

---

## 3. Release Safety Invariants

Sebelum memilih strategi, kita butuh invariants.

### 3.1 Invariant 1 — Version Coexistence

Jika dua versi berjalan bersamaan, keduanya harus bisa hidup berdampingan.

```text
v1 and v2 coexist safely if:
- both can read current database schema
- both can tolerate messages produced by each other
- both can share cache namespace or use compatible namespace strategy
- both can tolerate same config/secrets
- both can process same request contract
- both can survive same dependency behavior
```

Rolling dan canary hampir selalu menciptakan coexistence.

Blue-green kadang terlihat tidak coexist, tetapi sebenarnya tetap bisa coexist saat:

- traffic cutover bertahap;
- old environment masih standby;
- async jobs masih jalan;
- session lama belum habis;
- queue consumer lama belum berhenti;
- scheduled jobs belum dipindahkan.

### 3.2 Invariant 2 — Backward and Forward Compatibility

Untuk deployment multi-version, kompatibilitas harus dua arah.

```text
Backward compatible:
- versi baru bisa membaca data/contract lama.

Forward compatible:
- versi lama bisa bertahan saat melihat data/contract baru.
```

Banyak engineer hanya memikirkan backward compatibility.

Contoh:

```text
v2 menambahkan enum status = ESCALATED_FOR_REVIEW.
v2 aman membaca status lama.
v1 tidak aman membaca status baru.
```

Jika rolling update belum selesai dan v1 masih berjalan, maka v1 bisa crash saat melihat status baru.

### 3.3 Invariant 3 — Rollback Does Not Mean Time Travel

Rollback aplikasi tidak menghapus efek samping yang sudah terjadi.

Setelah release, sistem mungkin sudah membuat:

- row database baru;
- value enum baru;
- message queue baru;
- audit record baru;
- external notification baru;
- email terkirim;
- payment/transaction state berubah;
- cache berisi format baru;
- file object storage format baru;
- legal/case workflow state baru.

Karena itu rollback aman hanya jika versi lama bisa menerima dunia yang sudah disentuh versi baru.

```text
Safe rollback requires old version compatibility with new side effects.
```

### 3.4 Invariant 4 — Release Blast Radius Must Be Bounded

Strategi rilis harus membatasi dampak awal.

Blast radius bisa dibatasi berdasarkan:

- persentase traffic;
- user cohort;
- tenant;
- agency;
- region;
- endpoint;
- feature;
- queue partition;
- job type;
- case category;
- internal user group;
- readonly path dahulu sebelum write path.

Canary tanpa blast-radius boundary hanyalah rolling update dengan nama keren.

### 3.5 Invariant 5 — Release Must Have Observable Signals

Tidak ada strategi aman tanpa sinyal.

Minimal:

```text
Golden signals:
- request rate
- error rate
- latency
- saturation

Java-specific:
- heap/RSS
- GC pause/overhead
- thread pool saturation
- DB pool usage
- queue lag
- executor rejected tasks
- OOMKilled / OOME
- startup time
- graceful shutdown duration

Business/domain:
- successful submission count
- case transition success/failure
- payment success/failure
- notification delivery
- duplicate processing
- stuck workflow count
```

Release decision harus berdasarkan metric yang sesuai dengan risiko perubahan, bukan hanya CPU dan HTTP 200.

---

## 4. Strategy Map

Secara sederhana:

```text
Risk low, stateless, compatible      -> rolling update
Need instant cutover/rollback        -> blue-green
Need blast-radius control            -> canary
Need observe with copied traffic     -> shadow/mirroring
Need gradual cohort/tenant/region    -> ring deployment
Need decouple deploy from behavior   -> feature flag / dark launch
Need destructive migration           -> staged migration + freeze/gate
```

Tabel ringkas:

| Strategy | Traffic Control | Infra Cost | Compatibility Need | Rollback Speed | Best For | Dangerous For |
|---|---:|---:|---:|---:|---|---|
| Recreate | none | low | low | medium | maintenance window, batch | high availability services |
| Rolling | coarse | low | high | medium | stateless compatible services | incompatible DB/schema changes |
| Blue-green | strong | high | medium/high | fast traffic rollback | major release, cutover | shared mutable state without compatibility |
| Canary | fine | medium | high | staged | risky service changes | changes without metrics |
| Shadow | no user impact | medium/high | write isolation required | n/a | performance/behavior observation | state-mutating workloads |
| Ring | cohort-based | medium | high | staged | enterprise/users/tenants | uneven tenant data characteristics |
| Feature flag | behavior-level | low/medium | high | very fast | capability rollout | flags without lifecycle governance |

---

## 5. Recreate Deployment

### 5.1 Definisi

Recreate berarti semua versi lama dihentikan, lalu versi baru dijalankan.

```text
v1 running
↓ stop v1
no app running
↓ start v2
v2 running
```

### 5.2 Kapan Masuk Akal

Recreate masuk akal jika:

- downtime diterima;
- sistem internal/non-critical;
- ada maintenance window;
- aplikasi tidak bisa multi-version;
- database migration tidak backward-compatible;
- batch job tidak boleh overlap;
- app server legacy tidak mendukung rolling dengan aman;
- jumlah user kecil;
- recovery manual diterima.

### 5.3 Kelebihan

- sederhana;
- tidak ada coexistence antar versi aplikasi;
- lebih mudah untuk legacy monolith;
- cocok untuk perubahan besar yang tidak kompatibel;
- kapasitas ekstra tidak diperlukan.

### 5.4 Kekurangan

- downtime;
- rollback butuh restart ulang;
- startup Java yang lama memperpanjang outage;
- jika migration gagal di tengah, sistem bisa berada di state tidak siap;
- tidak cocok untuk SLA ketat.

### 5.5 Java-Specific Concern

Java app sering butuh waktu startup karena:

- classloading;
- dependency injection;
- ORM metadata scanning;
- connection pool initialization;
- cache warmup;
- JIT warmup;
- migration validation;
- external dependency check.

Jika recreate dipakai, startup time menjadi bagian dari downtime.

### 5.6 Recreate Checklist

```text
[ ] Downtime window disetujui.
[ ] User notification dikirim.
[ ] Semua ingress/traffic dihentikan atau diarahkan ke maintenance page.
[ ] Scheduled job/consumer dihentikan.
[ ] Database backup/snapshot tersedia jika perlu.
[ ] Migration procedure jelas.
[ ] Startup health check jelas.
[ ] Smoke test tersedia.
[ ] Rollback artifact tersedia.
[ ] Rollback database strategy jelas, atau explicitly not supported.
```

---

## 6. Rolling Deployment

### 6.1 Definisi

Rolling deployment mengganti instance secara bertahap.

```text
Initial:
[v1][v1][v1][v1]

During rollout:
[v1][v1][v2][v2]

End:
[v2][v2][v2][v2]
```

Di Kubernetes, Deployment dengan strategy RollingUpdate melakukan update secara bertahap. Parameter seperti `maxUnavailable` dan `maxSurge` mengatur berapa banyak pod boleh tidak tersedia dan berapa banyak pod ekstra boleh dibuat selama rollout.

### 6.2 Mental Model Rolling

Rolling bukan “zero risk”. Rolling berarti:

```text
For some time, production is multi-version.
```

Karena itu rolling aman hanya jika:

```text
v1 + v2 + shared state + shared dependencies = compatible.
```

### 6.3 Kelebihan

- tidak butuh environment penuh kedua;
- umum di Kubernetes;
- kapasitas tambahan relatif kecil;
- otomatis;
- cocok untuk stateless HTTP services;
- downtime bisa nol jika readiness/graceful shutdown benar.

### 6.4 Kekurangan

- versi lama dan baru berjalan bersamaan;
- rollback tidak selalu instan;
- sulit untuk perubahan database incompatible;
- bug bisa menyebar cepat jika rollout terlalu agresif;
- readiness false positive dapat mengirim traffic ke app yang belum siap;
- session/local cache dapat bermasalah.

### 6.5 Java Use Cases yang Cocok

Rolling cocok untuk:

- stateless REST API;
- backward-compatible endpoint changes;
- additive config change;
- bug fix kecil;
- dependency patch yang behavior-nya rendah risiko;
- JVM flag update yang sudah diuji;
- non-breaking message consumer update;
- service dengan graceful shutdown benar.

### 6.6 Java Use Cases yang Berbahaya

Rolling berbahaya jika:

- v2 menulis data yang tidak bisa dibaca v1;
- v2 mengirim event schema baru yang tidak bisa dibaca consumer lama;
- v2 mengubah cache value format tanpa namespace baru;
- v2 mengubah session serialization format;
- v2 mengubah enum/status workflow yang tidak dikenal v1;
- v2 mengubah database column secara destructive;
- v2 mengubah external API call pattern dan bisa men-trigger rate limit;
- v2 mengaktifkan scheduler yang bisa duplicate dengan v1.

### 6.7 Kubernetes Rolling Update Control

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  replicas: 6
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  minReadySeconds: 20
  progressDeadlineSeconds: 600
```

Makna operasional:

```text
replicas: 6
maxUnavailable: 1 -> minimal 5 pod available selama update
maxSurge: 1       -> maksimal 7 pod total selama update
minReadySeconds   -> pod harus Ready stabil dulu sebelum dianggap available
```

Untuk Java, `minReadySeconds` sering berguna karena readiness bisa true sebelum JIT/cache/pool stabil.

### 6.8 Rolling Update dengan Java Graceful Shutdown

Rolling aman membutuhkan shutdown sequence:

```text
1. Pod menerima SIGTERM.
2. Readiness menjadi false.
3. Endpoint controller menghapus pod dari service endpoints.
4. Load balancer berhenti mengirim request baru.
5. App menyelesaikan in-flight request.
6. Consumer/scheduler berhenti menerima workload baru.
7. Connection pool ditutup setelah workload selesai.
8. JVM exit sebelum terminationGracePeriod habis.
```

Jika aplikasi Java langsung mati saat SIGTERM, rolling update menjadi sumber request drop.

### 6.9 Rolling Update Decision Question

Sebelum rolling, tanyakan:

```text
Jika 30 menit ke depan v1 dan v2 berjalan bersamaan,
apakah keduanya bisa membaca/menulis state yang sama tanpa merusak sistem?
```

Jika jawabannya tidak jelas, rolling belum aman.

---

## 7. Blue-Green Deployment

### 7.1 Definisi

Blue-green memakai dua environment production-like.

```text
Blue  = current live
Green = new version prepared

Before cutover:
Traffic -> Blue
Green running but not live

After cutover:
Traffic -> Green
Blue kept for rollback
```

Dalam formulasi klasik, dua environment harus sedekat mungkin identik, dan traffic dialihkan dari environment lama ke environment baru setelah green siap.

### 7.2 Apa yang Diselesaikan Blue-Green

Blue-green menyelesaikan masalah:

- cutover cepat;
- rollback traffic cepat;
- testing final di production-like environment;
- mengurangi startup risk saat cutover;
- menghindari sebagian risiko rolling karena v2 sudah warm sebelum live.

### 7.3 Apa yang Tidak Diselesaikan Blue-Green

Blue-green tidak otomatis menyelesaikan:

- database compatibility;
- shared queue compatibility;
- shared cache compatibility;
- session migration;
- file/object storage compatibility;
- outbound side effects;
- scheduled job duplication;
- external webhook callback routing;
- DNS/client cache delay.

### 7.4 Blue-Green with Shared Database

Pola umum:

```text
Blue app  -> same DB
Green app -> same DB
```

Ini murah, tetapi berbahaya jika schema/data tidak kompatibel.

Aman jika:

```text
- migration additive
- green can read old data
- blue can tolerate data written by green if rollback traffic occurs
- destructive change ditunda sampai blue tidak mungkin dipakai lagi
```

### 7.5 Blue-Green with Separate Database

```text
Blue app  -> Blue DB
Green app -> Green DB
```

Ini lebih isolated, tetapi sulit karena:

- data replication;
- cutover consistency;
- write freeze;
- rollback data divergence;
- external system synchronization;
- audit continuity.

Untuk enterprise transaction system, separate DB blue-green jarang sederhana.

### 7.6 Blue-Green di Kubernetes

Kubernetes native Deployment tidak menyediakan blue-green penuh sebagai primitive tunggal. Biasanya dilakukan dengan:

```text
- dua Deployment: app-blue dan app-green
- satu Service yang selector-nya diarahkan ke active color
- atau ingress/service mesh traffic switch
- atau controller seperti Argo Rollouts
```

Contoh service selector switch:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: case-service
spec:
  selector:
    app: case-service
    color: blue
  ports:
    - port: 80
      targetPort: 8080
```

Green deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service-green
spec:
  replicas: 6
  selector:
    matchLabels:
      app: case-service
      color: green
  template:
    metadata:
      labels:
        app: case-service
        color: green
    spec:
      containers:
        - name: app
          image: registry.example.com/case-service:2.0.0
```

Cutover dilakukan dengan mengganti selector Service dari `color: blue` ke `color: green`.

### 7.7 Java Blue-Green Concern

Untuk Java, blue-green bagus jika startup lama.

Green bisa di-warm-up:

- classloading selesai;
- Spring context ready;
- Hibernate metadata loaded;
- JIT mulai warm;
- connection pool established;
- caches preloaded jika aman;
- JFR/log/metrics verified;
- actuator health confirmed;
- smoke test dijalankan.

Tetapi jangan menganggap green aman hanya karena `/health` OK.

### 7.8 Blue-Green Checklist

```text
[ ] Green environment menjalankan artifact yang benar.
[ ] Green config/secrets benar.
[ ] Green runtime/JVM flags benar.
[ ] Green connected ke dependency yang benar.
[ ] Green health/readiness OK.
[ ] Green smoke test OK.
[ ] Green tidak menjalankan scheduler/consumer duplicate sebelum cutover, kecuali memang didesain.
[ ] Database migration compatible dengan blue dan green.
[ ] Rollback traffic ke blue masih aman setelah green menerima traffic.
[ ] Monitoring dipisahkan per color/version.
[ ] Cutover mechanism jelas.
[ ] DNS/LB/client cache behavior dipahami.
[ ] Old blue retention window ditentukan.
```

### 7.9 Blue-Green Failure Mode

Failure mode umum:

```text
Green tested OK without real traffic.
Cutover dilakukan.
Green menulis value baru ke DB.
Error muncul.
Traffic dikembalikan ke Blue.
Blue tidak paham value baru.
Rollback memperburuk outage.
```

Solusi:

- expand-contract migration;
- forward-compatible reader;
- feature flag untuk write path baru;
- rollback simulation;
- data side-effect inventory.

---

## 8. Canary Deployment

### 8.1 Definisi

Canary release mengalirkan sebagian kecil traffic/user/workload ke versi baru untuk mendeteksi masalah sebelum berdampak ke seluruh populasi. Istilah ini biasa dipahami sebagai early warning mechanism.

```text
v1 receives 95% traffic
v2 receives 5% traffic

Observe.
If healthy -> increase to 25%, 50%, 100%.
If unhealthy -> stop/rollback.
```

### 8.2 Canary Bukan Sekadar Replica Baru

Canary membutuhkan tiga elemen:

```text
1. Traffic segmentation.
2. Metric-based analysis.
3. Promotion/rollback decision.
```

Tanpa metric gate, canary hanyalah “deploy sebagian dan berharap”.

### 8.3 Segmentasi Canary

Canary bisa berdasarkan:

```text
Percentage-based:
- 1%, 5%, 10%, 25%, 50%, 100%

Cohort-based:
- internal users
- staff users
- beta users
- tenant low-risk
- region tertentu
- agency tertentu

Request-based:
- endpoint tertentu
- header tertentu
- cookie tertentu
- user role tertentu
- request attribute tertentu

Workload-based:
- queue partition tertentu
- event type tertentu
- job type tertentu
```

### 8.4 Canary untuk Java HTTP Service

Contoh service mesh/ingress canary:

```text
95% -> case-service-v1
5%  -> case-service-v2
```

Yang harus diamati:

- HTTP 5xx;
- HTTP 4xx abnormal;
- latency p95/p99;
- DB query time;
- connection pool saturation;
- thread pool queue;
- GC pause;
- heap/RSS trend;
- log error signature;
- business transaction success;
- downstream call error;
- duplicate submission;
- workflow stuck.

### 8.5 Canary Step Plan

Contoh:

```text
Step 0: deploy v2, no traffic
Step 1: internal traffic only for 30 min
Step 2: 1% production traffic for 30 min
Step 3: 5% production traffic for 1 hour
Step 4: 25% production traffic for 2 hours
Step 5: 50% production traffic for 2 hours
Step 6: 100% traffic
Step 7: retain v1 rollback path for N hours/days
```

Step harus disesuaikan dengan traffic volume.

Jika 1% traffic hanya 3 request per jam, canary tidak punya statistical value. Untuk low-volume enterprise systems, cohort-based synthetic/business validation lebih berguna daripada percentage-based canary.

### 8.6 Canary Metrics Gate

Contoh gate:

```text
Promote if all true for 30 minutes:
- HTTP 5xx rate <= baseline + 0.2%
- p95 latency <= baseline + 20%
- DB pool active <= 70%
- no OOMKilled
- no repeated error signature above threshold
- business success rate >= 99.5%
- queue lag does not grow continuously
- no critical audit/write failure
```

Rollback if any true:

```text
- error budget burn rate above threshold
- p99 latency > 2x baseline for 10 minutes
- DB pool exhausted
- JVM OOME/OOMKilled
- message duplicate rate abnormal
- workflow transition failure spike
- data integrity alarm
- external API rejection spike
```

### 8.7 Canary untuk Message Consumers

Canary untuk HTTP lebih mudah karena traffic routing bisa persentase.

Untuk queue/message consumer, canary lebih sulit.

Pilihan:

```text
1. Dedicated canary queue/partition.
2. Consumer group partition assignment controlled.
3. Route only specific event type to v2.
4. Header-based routing by producer.
5. Duplicate-read/shadow consume without ack/write.
6. Separate canary worker with low concurrency.
```

Risiko message consumer canary:

- duplicate processing;
- ordering violation;
- ack semantics salah;
- poison message;
- dead-letter spike;
- partial side effects;
- v2 consumes message that v1 should process;
- retries amplified.

### 8.8 Canary dengan Argo Rollouts

Di Kubernetes, progressive delivery sering memakai controller seperti Argo Rollouts. Argo Rollouts mendukung strategi canary dan blue-green, termasuk traffic shifting dan analysis step.

Contoh konseptual:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: case-service
spec:
  replicas: 6
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 30m }
        - setWeight: 25
        - pause: { duration: 1h }
        - setWeight: 50
        - pause: { duration: 1h }
```

Ini bukan rekomendasi tunggal, tetapi contoh bahwa canary sebaiknya memiliki state machine rollout eksplisit.

### 8.9 Canary Anti-Patterns

```text
Anti-pattern 1: Canary hanya 1 pod, tapi traffic random dan tidak termonitor per version.
Anti-pattern 2: Canary hanya cek CPU/memory, bukan business correctness.
Anti-pattern 3: Canary write path baru tanpa forward compatibility.
Anti-pattern 4: Canary terlalu singkat untuk workload periodik.
Anti-pattern 5: Canary dilakukan saat traffic rendah sehingga tidak bermakna.
Anti-pattern 6: Canary tidak punya abort criteria.
Anti-pattern 7: Canary melewati user cohort high-risk tanpa sadar.
Anti-pattern 8: Canary metric dicampur dengan v1 sehingga v2 error tertutup baseline.
```

---

## 9. Shadow Deployment / Traffic Mirroring

### 9.1 Definisi

Shadow deployment atau traffic mirroring mengirim salinan traffic production ke versi baru, tetapi response versi baru tidak dikirim ke user.

```text
User -> v1 -> response to user
       |
       +-> copy request to v2 shadow
```

Istio menyebut mirroring/shadowing sebagai mekanisme mengirim copy live traffic ke mirrored service di luar critical request path utama.

### 9.2 Tujuan Shadow

Shadow cocok untuk:

- menguji performance dengan traffic realistis;
- mengamati error behavior;
- membandingkan response;
- menemukan dependency issue;
- memvalidasi parser/serializer;
- menguji scaling;
- menguji JVM memory under real request distribution;
- menguji endpoint baru sebelum menerima traffic user.

### 9.3 Shadow Bukan Canary

Perbedaannya:

| Aspek | Canary | Shadow |
|---|---|---|
| User menerima response v2? | Ya, sebagian | Tidak |
| v2 boleh menulis data? | Ya, jika aman | Umumnya tidak |
| Fokus | risk-limited release | observation/pre-release validation |
| Rollback | stop traffic/promotion | stop mirroring |
| Cocok untuk correctness? | Ya | Terbatas, karena side effects harus dikontrol |

### 9.4 Golden Rule Shadow Traffic

```text
Shadow traffic must not produce real irreversible side effects.
```

Jangan biarkan shadow service:

- insert real DB row;
- update workflow state;
- send email/SMS;
- call payment API;
- publish production event;
- mutate cache used by live service;
- acknowledge queue message;
- trigger external notification;
- write audit as if real action happened.

### 9.5 Cara Membuat Shadow Aman

Pilihan desain:

```text
1. Read-only mode.
2. Dry-run mode.
3. Separate shadow database.
4. Separate cache namespace.
5. Mock/stub outbound side effects.
6. Disable scheduler/consumer.
7. Disable event publishing.
8. Mark all shadow logs/metrics with shadow=true.
9. Use idempotency keys that cannot collide with production writes.
10. Block dangerous endpoints from mirroring.
```

### 9.6 Shadow Response Comparison

Untuk service deterministik, kamu bisa membandingkan:

- status code;
- selected fields;
- validation decision;
- computed eligibility;
- pricing/fee calculation;
- rules engine output;
- workflow transition proposal;
- generated document metadata.

Tetapi jangan membandingkan field volatile seperti:

- timestamp;
- generated ID;
- request correlation ID;
- randomized ordering;
- latency-sensitive derived value;
- external dependency result yang berubah.

### 9.7 Java Shadow Deployment Concern

Shadow traffic bisa menggandakan load downstream.

Misalnya:

```text
Live traffic: 100 rps
Shadow 100%: v2 receives 100 rps too
If v2 calls DB/external API, total backend load may double
```

Untuk Java system:

- DB pool bisa naik;
- query load naik;
- cache miss naik;
- external API rate limit kena;
- GC pressure naik;
- log volume naik;
- tracing volume naik;
- cost naik.

Shadow tidak aman jika kamu hanya menyalin traffic tanpa mengisolasi dependency impact.

### 9.8 Shadow Checklist

```text
[ ] Shadow service tidak mengirim response ke user.
[ ] Semua side effect real dimatikan atau diarahkan ke sandbox.
[ ] Database/cache/event namespace aman.
[ ] Outbound email/SMS/payment/webhook diblokir.
[ ] Observability punya label version dan shadow=true.
[ ] Traffic mirroring percentage dikontrol.
[ ] Dependency load impact dihitung.
[ ] Comparison rule jelas.
[ ] Sensitive data handling disetujui.
[ ] Shadow logs tidak membocorkan data.
```

---

## 10. Ring Deployment

### 10.1 Definisi

Ring deployment merilis versi baru secara bertahap ke kelompok yang semakin luas.

```text
Ring 0: developer/internal
Ring 1: staff/pilot users
Ring 2: low-risk tenant/agency
Ring 3: medium-risk production users
Ring 4: all users
```

Berbeda dari percentage canary yang sering random, ring deployment biasanya berbasis boundary yang bermakna secara organisasi/domain.

### 10.2 Kenapa Ring Cocok untuk Enterprise

Di enterprise/regulatory systems, traffic percentage sering kurang bermakna.

Contoh:

```text
1% random traffic bisa saja mengenai case high-risk.
5% traffic bisa mengenai tenant dengan workflow sangat kompleks.
Low-volume system tidak punya cukup request untuk canary statistik.
```

Ring lebih cocok karena kamu bisa memilih:

- internal staff dahulu;
- tenant dengan proses sederhana;
- agency dengan volume rendah;
- module non-critical dahulu;
- read-only users dahulu;
- workflow category tertentu dahulu.

### 10.3 Ring Berdasarkan Domain

Contoh untuk case management/enforcement system:

```text
Ring 0: internal QA/support account in production-like mode
Ring 1: read-only reporting users
Ring 2: low-volume case type
Ring 3: one agency/department pilot
Ring 4: all agencies except high-risk process
Ring 5: all users and modules
```

### 10.4 Ring Deployment Requires Routing Identity

Agar ring bisa dilakukan, sistem perlu tahu siapa masuk ring mana.

Routing bisa berdasarkan:

- tenant ID;
- agency ID;
- user group;
- role;
- region;
- header;
- cookie;
- account flag;
- feature flag platform;
- API client ID;
- module ID.

### 10.5 Ring vs Canary

| Aspek | Canary | Ring |
|---|---|---|
| Unit rollout | traffic percentage/request | cohort/domain group |
| Cocok untuk | high-volume services | enterprise/domain systems |
| Risk control | statistical blast radius | business blast radius |
| Observability | metrics per version | metrics per cohort/ring |
| Challenge | sample meaningful | cohort representativeness |

### 10.6 Ring Deployment Risk

Ring bisa misleading jika ring awal tidak representatif.

Contoh:

```text
Ring 1 memakai simple workflow.
Ring 2 memakai complex workflow dengan approval chain, document generation, and notification.
Ring 1 sukses bukan bukti Ring 2 aman.
```

Karena itu ring harus dirancang berdasarkan risk coverage, bukan hanya convenience.

### 10.7 Ring Checklist

```text
[ ] Ring boundary jelas dan deterministic.
[ ] User/tenant tidak berpindah ring secara random.
[ ] Metrics bisa difilter per ring.
[ ] Support team tahu user mana yang masuk ring.
[ ] Rollback per ring bisa dilakukan.
[ ] Data compatibility antar ring aman.
[ ] Ring awal mencakup workflow penting, bukan hanya easy path.
[ ] Promotion criteria per ring jelas.
[ ] Communication plan tersedia.
```

---

## 11. Feature Flag and Dark Launch

### 11.1 Definisi Feature Flag

Feature flag adalah mekanisme mengubah behavior tanpa deploy ulang.

```text
if featureFlag.isEnabled("new-case-assignment"):
    useNewAssignmentEngine()
else:
    useOldAssignmentEngine()
```

### 11.2 Definisi Dark Launch

Dark launch berarti capability sudah dideploy, mungkin sudah berjalan sebagian, tetapi belum terlihat/aktif penuh untuk user.

Contoh:

- endpoint baru sudah ada tapi tidak dipanggil UI;
- new engine menghitung hasil tapi tidak menyimpan;
- new UI tersembunyi untuk user umum;
- background indexer jalan tanpa mengganti search utama;
- v2 service menerima shadow traffic.

### 11.3 Feature Flag Sebagai Release Strategy

Feature flag memisahkan:

```text
Deploy code now.
Release behavior later.
```

Ini sangat kuat untuk Java service karena memungkinkan:

- deploy low-risk dulu;
- enable per cohort;
- instant disable jika error;
- combine dengan canary/ring;
- rollback behavior tanpa restart.

### 11.4 Jenis Feature Flag

```text
Release flag:
- enable fitur baru bertahap

Ops flag:
- disable expensive integration saat incident

Permission flag:
- enable untuk role/tenant tertentu

Experiment flag:
- A/B test behavior

Kill switch:
- matikan capability berisiko dengan cepat

Migration flag:
- switch old/new read path, write path, engine path
```

### 11.5 Feature Flag Risk

Feature flag bisa menjadi technical debt besar.

Risiko:

- combinatorial behavior explosion;
- branch tidak pernah dihapus;
- flag default beda antar environment;
- flag change tidak diaudit;
- flag dianggap config biasa padahal mengubah business behavior;
- rollback flag tidak kompatibel dengan data yang sudah ditulis;
- test matrix membengkak;
- security permission bypass karena flag salah.

### 11.6 Feature Flag Governance

Untuk production-grade:

```text
Each flag should have:
- owner
- purpose
- type
- default value
- allowed values
- target cohort
- creation date
- expected removal date
- audit trail
- emergency disable procedure
- metrics linked to flag state
```

### 11.7 Java Implementation Concern

Flag lookup harus didesain hati-hati.

Pertanyaan:

```text
- Apakah flag local cached?
- Berapa TTL-nya?
- Apa default jika flag service down?
- Apakah perubahan flag atomic?
- Apakah flag dievaluasi per request atau per session?
- Apakah flag value masuk audit log?
- Apakah flag snapshot disimpan untuk long-running workflow?
```

Untuk workflow/case management, flag per request bisa berbahaya.

Contoh:

```text
Case dibuat saat flag=false.
Case diproses approval saat flag=true.
Case ditutup saat flag=false lagi.
```

Jika behavior harus konsisten sepanjang lifecycle, simpan decision snapshot di entity/workflow context.

---

## 12. Rollback vs Roll-Forward

### 12.1 Rollback

Rollback berarti mengembalikan traffic/runtime behavior ke versi sebelumnya.

```text
v2 bad -> return to v1
```

Rollback cocok jika:

- v2 belum menulis state incompatible;
- perubahan hanya code/config;
- database migration backward-compatible;
- side effects minimal;
- v1 masih bisa membaca data saat ini;
- rollback path sudah diuji.

### 12.2 Roll-Forward

Roll-forward berarti memperbaiki masalah dengan versi baru berikutnya.

```text
v2 bad -> deploy v2.1 fix
```

Roll-forward sering lebih aman jika:

- database sudah berubah;
- v2 sudah menulis data baru;
- external side effects sudah terjadi;
- rollback akan membuat v1 crash;
- migration tidak reversible;
- audit/state transition tidak boleh dihapus;
- user sudah melihat behavior baru.

### 12.3 Rollback Decision Matrix

| Kondisi | Rollback Aman? | Catatan |
|---|---:|---|
| Pure UI bug, no state change | biasanya ya | jika asset/cache bisa invalidated |
| JVM flag causing memory issue | biasanya ya | restart ke old flags |
| Additive DB column only | biasanya ya | v1 ignore column |
| New enum/status already written | mungkin tidak | v1 harus tolerate |
| Destructive DB migration | tidak | butuh restore atau forward fix |
| External notification sent | tidak penuh | efek tidak bisa ditarik |
| Queue messages new schema published | tergantung | consumer lama harus compatible |
| Cache format changed | tergantung | flush/namespace mungkin perlu |
| Security rule changed | hati-hati | rollback bisa reopen vulnerability |

### 12.4 Rollback Must Be Tested

Jangan menganggap rollback otomatis aman.

Test sequence:

```text
1. Deploy v1.
2. Migrate compatible schema.
3. Deploy v2.
4. Send real-like write traffic to v2.
5. Rollback to v1.
6. Verify v1 can read/process data written by v2.
7. Verify jobs/consumers work.
8. Verify metrics/logs healthy.
```

Jika step 6 gagal, rollback bukan strategi valid.

---

## 13. Database-Aware Release Strategy

Walau database migration dibahas detail di Part 18, release strategy tidak bisa dipisahkan dari database.

### 13.1 Expand-Contract Pattern

Pola aman:

```text
Release A: expand schema
- add nullable column
- add new table
- add new index safely
- app v1 still works

Release B: deploy app v2
- app v2 starts writing/reading new structure
- app v1 still tolerates

Release C: backfill/verify
- data migrated gradually
- monitor consistency

Release D: contract
- remove old column/path only after no rollback to v1 needed
```

### 13.2 Deployment Strategy Compatibility

| DB Change | Rolling | Blue-Green | Canary | Ring |
|---|---:|---:|---:|---:|
| Add nullable column | safe | safe | safe | safe |
| Add table only | safe | safe | safe | safe |
| Rename column directly | unsafe | unsafe if shared DB | unsafe | unsafe |
| Drop column used by v1 | unsafe | unsafe if rollback to v1 | unsafe | unsafe |
| Add enum value | unsafe unless v1 tolerant | risky | risky | risky |
| Change semantic constraint | risky | risky | risky | risky |
| Add index concurrently/online | usually safe | safe | safe | safe |
| Long locking migration | risky | risky | risky | risky |

### 13.3 Canary and DB Writes

Canary yang menulis database bukan hanya “5% risk”. Jika v2 menulis data format baru, v1 95% traffic bisa terdampak.

```text
v2 writes incompatible data at 5% traffic.
v1 reads same data later.
v1 fails.
Blast radius leaks beyond 5%.
```

Jadi canary hanya membatasi risiko jika side effect-nya juga terbatas.

---

## 14. Stateful Release Concerns for Java Systems

### 14.1 HTTP Session

Jika aplikasi menggunakan server-side session:

- rolling update bisa memindahkan user ke instance dengan version berbeda;
- serialized session class bisa incompatible;
- sticky session bisa menunda traffic ke v2;
- session replication bisa gagal jika class serialVersionUID berubah;
- blue-green cutover bisa memaksa relogin.

Strategi:

```text
- externalize session with compatible format
- avoid Java native serialization for session
- use stable JSON/session schema
- version session payload
- drain old sessions
- force logout during major incompatible release if acceptable
```

### 14.2 Local Cache

Local cache saat rolling:

```text
v1 cache contains old interpretation
v2 cache contains new interpretation
```

Risiko:

- inconsistent response;
- stale authorization;
- stale config;
- wrong business rule.

Strategi:

- versioned cache key;
- cache invalidation at deploy;
- short TTL during rollout;
- distributed cache with schema version;
- avoid caching mutable policy too long.

### 14.3 Distributed Cache

Jika Redis/cache value format berubah:

```text
case:123 -> old JSON shape
case:124 -> new JSON shape
```

v1 dan v2 harus bisa membaca keduanya, atau gunakan namespace:

```text
v1: case:v1:123
v2: case:v2:123
```

### 14.4 Scheduled Jobs

Saat rolling/blue-green, scheduled job bisa duplicate.

Contoh:

```text
v1 and v2 both run nightly escalation job.
```

Strategi:

- leader election;
- distributed lock;
- scheduler disabled except active version;
- idempotent job design;
- job ownership per version;
- separate worker deployment;
- manual pause during cutover.

### 14.5 Message Consumers

Release consumer harus memperhatikan:

- schema compatibility;
- idempotency;
- ordering;
- retry behavior;
- DLQ policy;
- concurrency;
- poison message;
- ack transaction boundary.

Rolling consumer lebih berisiko daripada rolling HTTP service karena message consumption mengubah queue state.

---

## 15. Release Strategy for Different Java Application Types

### 15.1 Stateless REST API

Recommended default:

```text
Rolling update + readiness/liveness/startup probes + graceful shutdown
```

Upgrade to canary if:

- behavior risk tinggi;
- dependency call pattern berubah;
- performance uncertain;
- expensive database query changes;
- auth/authorization change;
- major framework/runtime upgrade.

### 15.2 Spring Boot Service with DB Writes

Recommended:

```text
Expand-contract DB migration
Rolling/canary release
Feature flag for new write path
Metric gate around business writes
```

Avoid:

```text
Rolling v2 that writes state unreadable by v1.
```

### 15.3 Servlet WAR on Shared Tomcat

Recommended:

```text
Blue-green server pool or rolling node drain
Avoid hot deploy for critical systems
Drain traffic before undeploy/redeploy
Verify classloader cleanup
```

Concern:

- memory leak after redeploy;
- stuck threads;
- JDBC driver leak;
- old webapp classloader retained;
- session serialization mismatch.

### 15.4 Jakarta EE / Application Server EAR

Recommended:

```text
Blue-green domain/server group
Controlled datasource/JNDI config
Cluster/session strategy
Admin CLI automated deployment
```

Concern:

- shared libraries;
- server-level config drift;
- domain mode propagation;
- transaction recovery;
- JMS resource compatibility.

### 15.5 Batch / Scheduler Application

Recommended:

```text
Recreate or controlled singleton rollout
No overlap unless idempotent
Explicit job pause/resume
Checkpoint compatibility
```

Canary for batch means processing subset of workload, not random percentage of HTTP traffic.

### 15.6 Message Consumer Worker

Recommended:

```text
Low-concurrency canary worker
Partition-based rollout
Idempotency and DLQ monitoring
Schema compatibility check
```

### 15.7 Monolith

Recommended:

```text
Blue-green if capacity allows
Recreate with maintenance if not
Feature flags for internal capability rollout
DB expand-contract mandatory for zero downtime
```

Rolling monolith is only safe if truly multi-instance compatible.

---

## 16. Traffic Routing Mechanisms

### 16.1 Load Balancer

Can switch traffic by:

- target group;
- backend pool;
- weight;
- health check;
- listener rule;
- DNS weighted record.

Concern:

- connection draining;
- sticky session;
- DNS TTL;
- client-side DNS cache;
- HTTP keep-alive;
- TLS certificate;
- health check path.

### 16.2 Kubernetes Service

Service selector routes to pods matching labels.

Good for:

- simple blue-green switch;
- stable service name;
- internal routing.

Less ideal for:

- fine percentage traffic;
- header/cookie based routing;
- cohort routing.

### 16.3 Ingress Controller

Can support:

- canary annotations;
- header routing;
- path routing;
- weight routing depending controller.

Concern:

- controller-specific behavior;
- reload delay;
- sticky session;
- TLS termination;
- observability per backend.

### 16.4 Service Mesh

Can support:

- percentage split;
- mirroring;
- retries;
- timeout;
- circuit breaking;
- mTLS;
- per-route telemetry.

Concern:

- added complexity;
- sidecar resource overhead;
- config drift;
- retry amplification;
- hidden latency;
- debugging complexity.

### 16.5 Feature Flag Platform

Routes behavior inside app based on user/request context.

Good for:

- feature-level release;
- cohort/ring;
- kill switch.

Concern:

- runtime dependency on flag service;
- inconsistent evaluation;
- lack of audit;
- stale cache;
- complex test matrix.

---

## 17. Observability Requirements Per Strategy

### 17.1 Rolling

Need:

```text
- metrics by version/pod
- readiness transition tracking
- pod restart count
- error rate by version
- deployment event timeline
- old/new pod overlap window
```

### 17.2 Blue-Green

Need:

```text
- metrics by color
- green pre-cutover smoke test
- dependency connectivity per color
- active traffic marker
- post-cutover comparison
- blue standby health
```

### 17.3 Canary

Need:

```text
- metrics by version and canary weight
- baseline comparison
- analysis window
- abort threshold
- promotion history
- cohort/traffic attribution
```

### 17.4 Shadow

Need:

```text
- shadow=true label
- response comparison output
- side-effect block evidence
- dependency load impact
- mirrored traffic percentage
```

### 17.5 Ring

Need:

```text
- ring ID label
- tenant/user cohort metrics
- support ticket correlation
- business transaction metrics per ring
- promotion evidence per ring
```

---

## 18. Version Labeling and Traceability

Setiap rilis harus traceable.

Minimal label:

```text
app.name
app.version
git.sha
build.number
build.time
java.version
runtime.vendor
image.digest
config.version
migration.version
release.id
deployment.id
environment
region/zone
pod/node/host
```

Untuk Java app, expose melalui:

- `/actuator/info`;
- startup log;
- structured log MDC;
- metrics label;
- tracing resource attributes;
- deployment manifest annotations;
- image labels;
- release evidence document.

Contoh Kubernetes annotation:

```yaml
metadata:
  annotations:
    app.example.com/version: "2.3.1"
    app.example.com/git-sha: "abc1234"
    app.example.com/release-id: "REL-2026-06-18-001"
    app.example.com/java-version: "21.0.7"
```

---

## 19. Release Plan Template

Gunakan template ini untuk rilis serius.

```text
# Release Plan

## 1. Release Identity
- Release ID:
- Application/service:
- Version:
- Git SHA:
- Artifact/image digest:
- Runtime Java version:
- Owner:

## 2. Change Summary
- What changed:
- Why:
- User-visible impact:
- Internal/system impact:

## 3. Risk Classification
- Code risk:
- Data risk:
- Dependency risk:
- Security risk:
- Operational risk:
- Compliance/audit risk:

## 4. Compatibility
- Backward compatibility:
- Forward compatibility:
- Database compatibility:
- Message compatibility:
- Cache/session compatibility:
- Config/secret compatibility:

## 5. Strategy
- Deployment strategy:
- Release strategy:
- Migration strategy:
- Blast-radius boundary:
- Promotion steps:

## 6. Pre-Deployment Checks
- Artifact verified:
- Image scanned:
- Config verified:
- Secrets verified:
- DB migration dry-run:
- Capacity verified:
- Observability dashboard ready:

## 7. Deployment Steps
1.
2.
3.

## 8. Verification
- Technical smoke tests:
- Business smoke tests:
- Metrics to watch:
- Logs to watch:
- Synthetic checks:

## 9. Promotion Gates
- Gate 1:
- Gate 2:
- Gate 3:

## 10. Rollback / Roll-Forward
- Rollback condition:
- Rollback steps:
- Roll-forward condition:
- Data cleanup needed:
- Who approves:

## 11. Communication
- Stakeholders:
- Support team notice:
- User notice if needed:

## 12. Evidence
- Deployment timestamp:
- Approver:
- Dashboard snapshot:
- Smoke test result:
- Post-release status:
```

---

## 20. Decision Framework

### 20.1 Questions Before Choosing Strategy

```text
1. Is the service stateless or stateful?
2. Can v1 and v2 run at the same time?
3. Can v1 read data written by v2?
4. Can v2 read data written by v1?
5. Are database changes additive or destructive?
6. Are message schemas backward/forward compatible?
7. Are cache/session formats compatible?
8. Does the app run schedulers or consumers?
9. Can traffic be segmented?
10. Can we observe v2 separately?
11. What is the blast radius of a bad release?
12. What is the rollback path after real writes happen?
13. What side effects cannot be undone?
14. Is user communication required?
15. Is audit/change evidence required?
```

### 20.2 Strategy Selection Matrix

```text
Use rolling when:
- stateless or state handled compatibly
- v1/v2 coexistence safe
- DB/message/cache compatible
- standard risk

Use blue-green when:
- startup/warmup expensive
- cutover must be fast
- rollback traffic switch needed
- capacity for parallel environment exists

Use canary when:
- risk uncertain
- traffic can be segmented
- metrics are strong
- side effects are compatible/bounded

Use shadow when:
- want observe under real traffic
- response not sent to user
- side effects can be blocked

Use ring when:
- enterprise/cohort boundaries matter
- low-volume system
- tenant/agency risk differs
- support needs controlled rollout

Use feature flag when:
- behavior can be decoupled from deploy
- instant disable needed
- cohort release needed
- flag lifecycle can be governed

Use recreate/maintenance when:
- multi-version impossible
- destructive migration unavoidable
- downtime accepted
- operational simplicity is safer
```

---

## 21. Worked Examples

### 21.1 Example A — Minor Bug Fix in Stateless Spring Boot API

Change:

```text
Fix null handling in GET /cases/{id}
No DB change.
No message change.
No config change.
```

Recommended:

```text
Rolling update.
```

Why:

- low risk;
- v1/v2 coexistence safe;
- no state format change;
- normal readiness/graceful shutdown enough.

Checks:

```text
- HTTP 5xx
- latency
- pod restart
- endpoint smoke test
```

### 21.2 Example B — New Case Status Added

Change:

```text
Add status ESCALATED_FOR_REVIEW.
v2 can create this status.
v1 does not know this status.
```

Rolling directly is unsafe.

Safer staged plan:

```text
Release 1:
- deploy v1.1 that can read/tolerate ESCALATED_FOR_REVIEW but does not create it
- rolling update to all pods

Release 2:
- deploy v2 with feature flag controlling creation of new status
- canary/ring enable flag

Release 3:
- after rollback window, remove old assumptions if needed
```

### 21.3 Example C — New Search Engine Path

Change:

```text
Old DB query search replaced by Elasticsearch/OpenSearch-backed search.
```

Recommended:

```text
Dark launch + shadow comparison + feature flag + ring rollout.
```

Plan:

```text
1. Deploy indexer disabled from user path.
2. Backfill index.
3. Shadow query: compare DB result vs search result.
4. Enable for internal users.
5. Enable for low-risk tenants.
6. Promote gradually.
7. Keep fallback to DB query until confidence high.
```

### 21.4 Example D — Runtime Upgrade Java 17 to Java 21

Change:

```text
Same app version, new JVM baseline.
```

Recommended:

```text
Canary or blue-green depending criticality.
```

Why not simple rolling blindly:

- GC behavior may differ;
- TLS/default crypto may differ;
- reflection/module warnings/errors may differ;
- container memory ergonomics may differ;
- startup and JIT behavior may differ;
- native libraries/agents may differ.

Metrics:

```text
- startup time
- RSS/heap
- GC pause
- CPU
- latency p95/p99
- error signatures
- agent compatibility
```

### 21.5 Example E — Batch Escalation Job Change

Change:

```text
Nightly escalation rules changed.
```

Recommended:

```text
Do not use normal rolling as primary release strategy.
Use controlled job release.
```

Plan:

```text
1. Deploy code with job disabled.
2. Run dry-run mode on subset.
3. Compare proposed transitions.
4. Enable for one category/ring.
5. Monitor audit and transition output.
6. Promote.
```

---

## 22. Common Failure Patterns

### 22.1 False Readiness

```text
Pod Ready = true
But application not actually ready for real workload
```

Causes:

- readiness only checks process alive;
- DB pool not initialized;
- migration not complete;
- cache not loaded;
- downstream unavailable;
- app accepts HTTP before consumers initialized.

### 22.2 Rollback Incompatible with Data

```text
v2 writes new data.
Rollback to v1.
v1 fails on new data.
```

Prevention:

- forward compatibility;
- feature flag before write;
- expand-contract;
- rollback simulation.

### 22.3 Canary Hidden by Aggregate Metrics

```text
v2 receives 5% traffic.
Overall error rate rises only from 0.1% to 0.3%.
But v2 error rate is 5%.
```

Prevention:

- metric labels by version;
- canary-specific dashboard;
- analysis queries per version.

### 22.4 Blue-Green Scheduler Duplication

```text
Blue live and green standby both run scheduled job.
```

Prevention:

- disable scheduler on inactive color;
- leader election;
- distributed lock;
- job ownership config.

### 22.5 Shadow Side Effects

```text
Mirrored request triggers email or DB write.
```

Prevention:

- dry-run mode;
- side-effect adapter disabled;
- sandbox dependencies;
- test endpoint allowlist;
- production write guard.

### 22.6 Sticky Session Masks Canary

```text
Canary set to 10%, but sticky users continue hitting v1.
Canary receives unrepresentative traffic.
```

Prevention:

- understand LB stickiness;
- route by cohort/header;
- observe actual distribution.

### 22.7 Traffic Shift Faster Than Observability Window

```text
5% -> 50% -> 100% in 5 minutes
But batch/job/error appears after 30 minutes
```

Prevention:

- gate duration based on workload cycle;
- include async metrics;
- wait for queue and scheduled effects.

---

## 23. Advanced Principle: Release Strategy Is a State Machine

A serious release is not a single command. It is a state machine.

```text
Prepared
  -> DeployedInactive
  -> SmokeTesting
  -> LimitedExposure
  -> Observing
  -> Promoting
  -> FullyReleased
  -> Stabilizing
  -> Completed

Failure transitions:
  -> Paused
  -> RolledBack
  -> RolledForward
  -> Mitigated
  -> Aborted
```

Each state needs:

- entry criteria;
- action;
- observation;
- exit criteria;
- failure transition.

Example canary state machine:

```text
DeployedInactive
  entry: v2 pods ready, no traffic
  action: run smoke test
  exit: smoke OK

Canary5
  action: route 5% traffic
  observe: 30 min metrics
  exit: metrics pass
  failure: abort to v1

Canary25
  action: route 25% traffic
  observe: 60 min metrics
  exit: metrics pass
  failure: abort to v1 or pause

Full
  action: route 100%
  observe: post-release window
  exit: release complete
```

Thinking in state machines prevents vague deployment plans.

---

## 24. What Top 1% Engineers Do Differently

### 24.1 They Ask About Side Effects

Average engineer:

```text
Can we rollback the app?
```

Top engineer:

```text
What irreversible side effects can v2 produce before rollback?
Can v1 survive those side effects?
```

### 24.2 They Separate Runtime Health from Business Correctness

Average engineer:

```text
Pods are green. CPU is normal.
```

Top engineer:

```text
Are users completing the business process correctly?
Are workflow transitions valid?
Are audit records complete?
Are downstream effects correct?
```

### 24.3 They Control Blast Radius by Domain

Average engineer:

```text
Canary 10% traffic.
```

Top engineer:

```text
Which 10%? Which tenant? Which module? Which workflow? Which data risk?
```

### 24.4 They Design for Coexistence

Average engineer:

```text
Deploy v2 after migration.
```

Top engineer:

```text
During rollout, v1 and v2 will coexist. Schema and messages must support both.
```

### 24.5 They Treat Rollback as a Tested Feature

Average engineer:

```text
We can rollback if needed.
```

Top engineer:

```text
We tested rollback after v2 wrote data. Here is the evidence.
```

---

## 25. Practical Strategy Recipes

### 25.1 Safe Rolling Recipe

```text
1. Confirm v1/v2 compatibility.
2. Confirm DB migration additive.
3. Set readiness meaningful.
4. Set graceful shutdown.
5. Set maxUnavailable low enough.
6. Label metrics by version.
7. Deploy rolling.
8. Watch error/latency/resource metrics.
9. Verify business smoke test.
10. Keep rollback artifact available.
```

### 25.2 Safe Blue-Green Recipe

```text
1. Deploy green with same config class as blue.
2. Keep green out of user traffic.
3. Disable duplicate jobs if needed.
4. Run smoke and dependency checks.
5. Warm application if needed.
6. Verify DB compatibility.
7. Switch traffic.
8. Observe metrics by color.
9. Keep blue standby.
10. Decommission blue after rollback window.
```

### 25.3 Safe Canary Recipe

```text
1. Deploy v2 inactive.
2. Ensure metrics by version.
3. Define abort/promote thresholds.
4. Start with internal/cohort or low percentage.
5. Observe long enough for workload pattern.
6. Promote gradually.
7. Pause on uncertainty.
8. Abort on threshold breach.
9. Keep rollback compatibility.
10. Record evidence.
```

### 25.4 Safe Shadow Recipe

```text
1. Deploy v2 shadow.
2. Disable real side effects.
3. Mirror limited traffic.
4. Label all telemetry shadow=true.
5. Compare selected outputs.
6. Monitor dependency load.
7. Increase mirror percentage if safe.
8. Use findings to prepare canary/ring.
```

### 25.5 Safe Ring Recipe

```text
1. Define ring boundaries by risk.
2. Deploy capability disabled by default.
3. Enable Ring 0.
4. Validate business workflows.
5. Promote ring by ring.
6. Monitor per ring.
7. Support team tracks ring membership.
8. Rollback/disable per ring if needed.
```

---

## 26. Checklist: Release Strategy Review Board

Sebelum production release, review:

```text
Compatibility
[ ] v1/v2 coexistence aman.
[ ] DB change backward/forward compatible.
[ ] Message schema compatible.
[ ] Cache/session format compatible.
[ ] Config/secrets compatible.

Blast Radius
[ ] Traffic/user/workload boundary jelas.
[ ] Canary/ring/shadow scope jelas.
[ ] Side effects bounded.

Observability
[ ] Metrics by version/color/ring available.
[ ] Dashboard ready.
[ ] Logs searchable by release/version.
[ ] Business metrics included.
[ ] Alert threshold defined.

Execution
[ ] Deployment steps documented.
[ ] Promotion gates defined.
[ ] Abort criteria defined.
[ ] Owner/approver assigned.
[ ] Support communication ready.

Rollback/Roll-forward
[ ] Rollback tested or limitation declared.
[ ] Roll-forward plan available.
[ ] Data cleanup strategy known.
[ ] Old artifact/config available.

Post-release
[ ] Stabilization window defined.
[ ] Evidence captured.
[ ] Old version decommission plan defined.
[ ] Feature flags cleanup tracked.
```

---

## 27. Key Takeaways

1. **Deploy** adalah membuat versi baru tersedia; **release** adalah membuat versi baru berdampak ke user/traffic/workload.
2. Rolling update berarti production berada dalam kondisi multi-version. Aman hanya jika v1 dan v2 compatible terhadap state dan dependency bersama.
3. Blue-green memberi cutover dan traffic rollback cepat, tetapi tidak otomatis menyelesaikan database, session, queue, cache, dan scheduler compatibility.
4. Canary hanya berguna jika punya traffic segmentation, observability per version, dan promotion/abort gate yang jelas.
5. Shadow traffic harus read-only/dry-run atau terisolasi dari side effects production.
6. Ring deployment sering lebih cocok untuk enterprise/regulatory systems daripada percentage canary random.
7. Feature flag sangat kuat, tetapi harus dikelola sebagai production control plane, bukan if-statement sementara yang dilupakan.
8. Rollback bukan time travel. Jika versi baru sudah menulis state baru, versi lama harus bisa hidup di dunia baru itu.
9. Release strategy yang matang adalah state machine dengan entry criteria, observation, exit criteria, dan failure transitions.
10. Top engineer tidak memilih strategi berdasarkan trend, tetapi berdasarkan compatibility, side effects, blast radius, observability, dan rollback reality.

---

## 28. Latihan Pemahaman

### Latihan 1

Sebuah Spring Boot service menambahkan field baru `riskCategory` ke table `case`. v2 mulai mengisi field tersebut. v1 mengabaikan field itu. Strategi apa yang aman?

Pertimbangkan:

- apakah column nullable;
- apakah v1 benar-benar ignore;
- apakah ada constraint baru;
- apakah API response berubah;
- apakah downstream consumer menerima field baru.

### Latihan 2

Sebuah service menambahkan enum `SUSPENDED_PENDING_REVIEW`. v1 tidak tahu enum itu. Apa staged release plan yang aman?

Hint:

- release reader compatibility dulu;
- enable writer belakangan;
- feature flag untuk creation;
- rollback simulation.

### Latihan 3

Sebuah batch job escalation akan mengubah ribuan case state setiap malam. Apakah canary percentage HTTP traffic relevan?

Pikirkan:

- workload unit bukan request HTTP;
- canary bisa berdasarkan case category/agency;
- dry-run comparison;
- idempotency;
- audit verification.

### Latihan 4

Sebuah search feature baru ingin diuji dengan real traffic tetapi tidak boleh mempengaruhi user. Strategi apa yang cocok?

Pikirkan:

- shadow query;
- output comparison;
- no write side effects;
- dependency load;
- feature flag fallback.

---

## 29. Referensi Teknis

- Kubernetes documentation: Deployments and rolling updates.
- Kubernetes documentation: resource, probes, pod lifecycle, and service routing concepts.
- Argo Rollouts documentation: canary and blue-green progressive delivery.
- Istio documentation: traffic shifting and mirroring/shadowing.
- Martin Fowler: Blue-Green Deployment and Canary Release.
- Spring Boot documentation: Actuator, availability states, graceful shutdown, deployment/container behavior.
- Java documentation: runtime behavior, process termination, JDK command options, and diagnostics.

---

## 30. Status Series

Part ini adalah **Part 17 dari 35** dalam series:

```text
learn-java-deployment-runtime-release-delivery-engineering
```

Series **belum selesai**.

Part berikutnya:

```text
Part 18 — Database-Aware Deployment and Schema Migration
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-deployment-runtime-release-delivery-engineering-part-16-resource-sizing-cpu-memory-heap-nonheap-threads-containers.md">⬅️ Part 16 — Resource Sizing: CPU, Memory, Heap, Non-Heap, Threads, and Containers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-deployment-runtime-release-delivery-engineering-part-18-database-aware-deployment-schema-migration.md">Part 18 — Database-Aware Deployment and Schema Migration ➡️</a>
</div>
