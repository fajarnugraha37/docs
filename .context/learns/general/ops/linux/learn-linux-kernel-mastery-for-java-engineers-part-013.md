# learn-linux-kernel-mastery-for-java-engineers-part-013.md

# Part 013 — Time, Clocks, Timers, and Latency Measurement

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `013`  
> Topik: Linux timekeeping, clocks, timers, sleep, timeout, scheduler delay, dan latency measurement untuk Java/backend service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 011 dan Part 012, kita membahas CPU scheduling:

- task runnable
- run queue
- CFS
- CPU quota
- cgroup throttling
- container CPU limit
- dampaknya ke JVM, GC, executor, event loop

Part 013 membahas konsep yang sering terlihat sederhana tetapi sangat sering menyebabkan bug production:

> waktu.

Dalam aplikasi backend, waktu muncul di banyak tempat:

- timeout HTTP client
- socket read timeout
- database query timeout
- retry backoff
- circuit breaker
- scheduler job
- cache TTL
- lock lease
- distributed coordination
- rate limit window
- token expiry
- idempotency window
- SLA/SLO latency
- GC pause measurement
- event loop lag
- metrics timestamp
- log correlation
- profiling
- benchmark

Banyak engineer memakai “waktu” seolah-olah hanya satu konsep.

Di Linux dan JVM, waktu tidak sesederhana itu.

Ada beberapa jenis clock:

- wall clock
- monotonic clock
- boot time clock
- process CPU clock
- thread CPU clock
- coarse clock
- high-resolution clock

Ada juga beberapa jenis delay:

- aplikasi sengaja sleep
- aplikasi blocked I/O
- aplikasi menunggu lock
- thread runnable tapi belum dijadwalkan
- cgroup throttled
- GC safepoint
- timer callback terlambat
- clock adjustment oleh NTP
- virtualization pause
- host overload

Jika semua itu disebut “latency”, diagnosis akan kacau.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Membedakan wall clock dan monotonic clock.
2. Menjelaskan kenapa timeout sebaiknya memakai deadline berbasis monotonic time.
3. Menjelaskan efek clock jump terhadap scheduler, cache TTL, token expiry, dan retry.
4. Memahami clock Linux yang umum:
   - `CLOCK_REALTIME`
   - `CLOCK_MONOTONIC`
   - `CLOCK_MONOTONIC_RAW`
   - `CLOCK_BOOTTIME`
   - `CLOCK_PROCESS_CPUTIME_ID`
   - `CLOCK_THREAD_CPUTIME_ID`
5. Menghubungkan clock Linux dengan API Java:
   - `System.currentTimeMillis()`
   - `System.nanoTime()`
   - `Instant.now()`
   - `Clock`
   - `ScheduledExecutorService`
6. Memahami timer, sleep, wakeup, dan scheduler delay.
7. Menjelaskan kenapa `Thread.sleep(10)` tidak berarti thread pasti lanjut tepat setelah 10 ms.
8. Memahami event loop lag dan timer drift.
9. Menjelaskan coordinated omission dalam latency measurement.
10. Mendesain timeout, retry, dan deadline propagation yang benar.
11. Membuat checklist debugging untuk latency yang berhubungan dengan waktu.

---

## 2. Kenapa Waktu Sulit?

Secara intuitif kita berpikir:

```text
now = waktu saat ini
elapsed = now - start
timeout = 5 detik
sleep(100 ms) = tidur 100 ms
```

Di production, model itu terlalu sederhana.

Masalahnya:

1. Wall clock bisa berubah.
2. Monotonic clock tidak sama dengan wall clock.
3. Sleep minimal duration, bukan exact duration.
4. Timer callback butuh thread yang dijadwalkan.
5. Thread runnable belum tentu running.
6. Container CPU throttling bisa membuat timer telat.
7. GC pause bisa membuat aplikasi tidak menjalankan timer.
8. NTP bisa menyesuaikan clock.
9. VM/container host bisa pause.
10. Measurement tool bisa menyembunyikan delay.
11. Latency percentile bisa salah jika sampling salah.
12. Timeout per hop bisa lebih besar dari total user deadline.

Waktu dalam sistem adalah resource observability dan correctness, bukan sekadar angka.

---

## 3. Mental Model: Ada Tiga Pertanyaan Berbeda

Ketika bicara waktu, pisahkan tiga pertanyaan:

### 3.1 Jam berapa sekarang?

Ini wall clock.

Contoh:

```text
2026-06-21T10:30:00+07:00
```

Dipakai untuk:

- log timestamp
- audit trail
- token expiry
- certificate validity
- calendar
- scheduled human event
- business cutoff

### 3.2 Berapa lama sesuatu berlangsung?

Ini elapsed time.

Contoh:

```text
request took 37 ms
```

Harus memakai monotonic clock.

Dipakai untuk:

- latency
- timeout
- benchmark
- retry delay
- rate limiting internal
- profiling
- performance measurement

### 3.3 Berapa banyak CPU time dikonsumsi?

Ini CPU time.

Contoh:

```text
thread consumed 120 ms CPU
```

Dipakai untuk:

- profiling CPU
- distinguishing waiting vs computing
- process accounting
- scheduler analysis

Ketiga pertanyaan ini tidak boleh dicampur.

---

## 4. Wall Clock

Wall clock adalah waktu kalender.

Di Linux, biasanya direpresentasikan oleh:

```text
CLOCK_REALTIME
```

Karakteristik:

- menunjukkan waktu dunia nyata
- bisa maju
- bisa mundur
- bisa di-adjust oleh NTP/admin
- dipengaruhi timezone saat diformat
- penting untuk timestamp dan business time
- buruk untuk mengukur durasi

Contoh penggunaan benar:

```text
"Order created at 2026-06-21T10:30:00+07:00"
```

Contoh penggunaan salah:

```java
long start = System.currentTimeMillis();
// do work
long elapsed = System.currentTimeMillis() - start;
```

Kenapa salah?

Karena wall clock bisa berubah di tengah pengukuran.

Jika clock mundur, elapsed bisa negatif.

Jika clock maju, elapsed bisa terlihat terlalu besar.

---

## 5. Monotonic Clock

Monotonic clock adalah clock yang tidak mundur untuk mengukur elapsed time.

Di Linux, umum:

```text
CLOCK_MONOTONIC
```

Karakteristik:

- tidak mundur
- cocok untuk durasi
- cocok untuk timeout
- cocok untuk benchmark
- tidak merepresentasikan tanggal kalender
- bisa dipengaruhi adjustment bertahap tergantung clock type
- tidak boleh dipakai untuk audit timestamp

Di Java, API yang relevan:

```java
System.nanoTime()
```

`System.nanoTime()` bukan “nano timestamp sejak epoch”.

Ini hanya sumber monotonic-ish time untuk menghitung selisih.

Penggunaan benar:

```java
long start = System.nanoTime();

doWork();

long elapsedNanos = System.nanoTime() - start;
```

Penggunaan salah:

```java
long timestamp = System.nanoTime(); // jangan simpan sebagai waktu kalender
```

---

## 6. `System.currentTimeMillis()` vs `System.nanoTime()`

### 6.1 `System.currentTimeMillis()`

Makna:

```text
current wall-clock time in milliseconds since Unix epoch
```

Cocok untuk:

- log timestamp sederhana
- human-readable time
- epoch milliseconds
- business event time

Tidak cocok untuk:

- latency measurement
- timeout deadline
- benchmark
- elapsed time

### 6.2 `System.nanoTime()`

Makna:

```text
monotonic time source for elapsed measurement
```

Cocok untuk:

- latency
- timeout
- benchmark
- measuring elapsed duration
- comparing deadline

Tidak cocok untuk:

- timestamp
- persistence
- distributed comparison antar host
- log event time

### 6.3 Rule praktis

```text
Need human/calendar time?      Use Instant.now()/Clock/currentTimeMillis.
Need elapsed duration?         Use System.nanoTime.
Need timeout/deadline?         Use System.nanoTime-based deadline.
Need cross-host ordering?      Be careful; clocks are not perfectly synchronized.
```

---

## 7. Linux Clock Types

Linux menyediakan beberapa clock melalui `clock_gettime`.

### 7.1 `CLOCK_REALTIME`

Wall-clock time.

Bisa berubah karena:

- admin set time
- NTP step
- system time correction
- VM restore

Gunakan untuk:

- timestamp
- business time
- absolute date-time

Jangan gunakan untuk elapsed duration.

### 7.2 `CLOCK_MONOTONIC`

Monotonic time sejak titik tertentu, tidak mundur.

Gunakan untuk:

- timeout
- elapsed duration
- timer internal
- scheduling interval

### 7.3 `CLOCK_MONOTONIC_RAW`

Monotonic hardware-based clock yang tidak disesuaikan oleh NTP frequency adjustments dengan cara yang sama seperti monotonic biasa.

Gunakan untuk:

- low-level measurement
- performance tooling tertentu
- clock discipline analysis

Untuk aplikasi Java biasa, jarang perlu langsung.

### 7.4 `CLOCK_BOOTTIME`

Mirip monotonic, tetapi juga memasukkan waktu saat sistem suspend.

Berguna untuk:

- timer yang harus memperhitungkan suspend/resume
- embedded/mobile/system-level scheduling

### 7.5 `CLOCK_PROCESS_CPUTIME_ID`

CPU time yang dikonsumsi process.

Bukan wall time.

Jika process sleep 10 detik, CPU time hampir tidak bertambah.

### 7.6 `CLOCK_THREAD_CPUTIME_ID`

CPU time yang dikonsumsi thread.

Berguna untuk profiling dan accounting.

---

## 8. Wall Time vs CPU Time

Misalnya request memakan wall time 100 ms.

Apa artinya?

Belum tentu CPU bekerja 100 ms.

Breakdown bisa seperti:

```text
total wall time: 100 ms

CPU execution:        8 ms
waiting DB:          40 ms
waiting lock:        10 ms
scheduler delay:     20 ms
cgroup throttled:    15 ms
serialization:        7 ms
```

Jika kamu hanya melihat “request latency 100 ms”, kamu belum tahu penyebabnya.

CPU time membantu membedakan:

```text
slow because computing
vs
slow because waiting
vs
slow because not scheduled
```

Tool terkait:

- profiler CPU
- async-profiler
- JFR
- `perf`
- `pidstat`
- `/proc/<pid>/sched`
- eBPF off-CPU profiling

---

## 9. Timer dan Sleep: Bukan Jaminan Tepat Waktu

Ketika Java memanggil:

```java
Thread.sleep(100);
```

Engineer pemula sering berpikir:

```text
thread tidur tepat 100 ms, lalu langsung lanjut
```

Lebih benar:

```text
thread tidak akan runnable sebelum sekitar 100 ms berlalu,
lalu kernel/JVM membuatnya eligible untuk berjalan,
tetapi kapan benar-benar running tergantung scheduler, CPU availability,
cgroup quota, GC/safepoint, dan contention.
```

Sleep adalah minimum-ish delay, bukan exact schedule.

Kemungkinan:

```text
requested sleep: 100 ms
actual wake and run: 103 ms
under load: 150 ms
under CPU throttling: 300 ms
under GC pause: 700 ms
```

Untuk latency-sensitive code, ini sangat penting.

---

## 10. Timer Lifecycle di Linux/JVM secara Konseptual

Simplified path:

```text
Java code schedules timer
        |
JVM records deadline
        |
OS timer / park / futex / epoll timeout / condition wait
        |
kernel tracks time
        |
deadline expires
        |
waiting thread becomes runnable
        |
scheduler must pick the thread
        |
thread actually runs
        |
Java callback executes
```

Ada gap antara:

```text
timer expired
```

dan:

```text
callback executed
```

Gap ini bisa disebabkan:

- CPU saturation
- cgroup throttling
- higher priority tasks
- JVM safepoint
- GC pause
- lock contention
- event loop blocked
- kernel scheduling delay

Itu sebabnya timer drift/event loop lag adalah metric penting.

---

## 11. High-Resolution Timers

Linux modern mendukung high-resolution timers pada banyak konfigurasi.

Namun high-resolution timer tidak berarti:

```text
callback pasti presisi mikrodetik
```

Ia hanya berarti kernel bisa mengatur expiry timer lebih presisi dibanding tick tradisional.

Tetap ada:

- scheduling delay
- CPU contention
- cgroup quota
- interrupt handling
- power management
- virtualization overhead
- JVM overhead

Untuk Java backend, high-resolution timer membantu, tapi bukan pengganti capacity planning.

---

## 12. Timer Tick, Tickless Kernel, dan Praktisnya untuk Backend

Dulu kernel banyak bergantung pada periodic timer tick.

Linux modern mendukung konfigurasi tickless untuk mengurangi overhead saat idle.

Untuk Java engineer, detail konfigurasi kernel ini biasanya bukan hal pertama yang di-debug.

Yang perlu dipahami:

1. Kernel punya mekanisme timekeeping dan timer expiry.
2. Timer expiry tidak sama dengan aplikasi langsung berjalan.
3. Delay setelah timer expiry sering lebih penting untuk latency.
4. Power management dan virtualization bisa memengaruhi timing.

---

## 13. Deadline vs Timeout

Timeout sering ditulis begini:

```java
callA(timeout = 1000ms);
callB(timeout = 1000ms);
callC(timeout = 1000ms);
```

Jika semuanya serial, total bisa menjadi 3000 ms.

Padahal user deadline mungkin 1000 ms total.

Lebih benar:

```text
deadline = now + 1000ms

callA(remaining(deadline))
callB(remaining(deadline))
callC(remaining(deadline))
```

Deadline adalah absolute target waktu internal berdasarkan monotonic time.

Timeout adalah durasi maksimum untuk satu operasi.

### 13.1 Bug umum

```java
long timeoutMs = 1000;

callDatabase(timeoutMs);
callCache(timeoutMs);
callPayment(timeoutMs);
```

Ini menyebabkan budget meledak.

### 13.2 Model lebih benar

```java
final class Deadline {
    private final long deadlineNanos;

    private Deadline(long deadlineNanos) {
        this.deadlineNanos = deadlineNanos;
    }

    static Deadline afterMillis(long millis) {
        return new Deadline(System.nanoTime() + millis * 1_000_000L);
    }

    long remainingMillis() {
        long remaining = deadlineNanos - System.nanoTime();
        return Math.max(0, remaining / 1_000_000L);
    }

    boolean expired() {
        return System.nanoTime() >= deadlineNanos;
    }
}
```

Gunakan:

```java
Deadline deadline = Deadline.afterMillis(1000);

callA(deadline.remainingMillis());
callB(deadline.remainingMillis());
callC(deadline.remainingMillis());
```

Ini lebih sesuai dengan user-perceived latency.

---

## 14. Kenapa Deadline Harus Monotonic?

Jika deadline memakai wall clock:

```java
long deadline = System.currentTimeMillis() + 1000;
```

Lalu clock mundur 5 detik, request bisa menunggu lebih lama.

Jika clock maju 5 detik, request bisa timeout terlalu cepat.

Deadline internal harus memakai monotonic source:

```java
long deadline = System.nanoTime() + timeoutNanos;
```

Wall clock boleh dipakai untuk log:

```java
Instant receivedAt = Instant.now();
```

Tetapi budget runtime sebaiknya monotonic.

---

## 15. Clock Jump

Clock jump berarti wall clock berubah secara tiba-tiba.

Penyebab:

- NTP step adjustment
- admin menjalankan `date -s`
- VM resume
- host time correction
- container host clock changed
- leap second handling
- snapshot restore

Efek pada aplikasi:

- log timestamp meloncat
- token/certificate dianggap expired atau not yet valid
- scheduled task bisa jalan terlalu cepat/terlambat
- cache TTL berbasis wall clock bisa salah
- distributed lock lease bisa berbahaya jika salah clock
- metrics ordering kacau
- “elapsed time” berbasis wall clock negatif

---

## 16. NTP: Slew vs Step

Secara konseptual, time synchronization bisa dilakukan dengan:

### 16.1 Slew

Clock disesuaikan perlahan.

Efek:

- wall clock tidak meloncat besar
- rate clock sedikit dipercepat/diperlambat
- lebih aman untuk banyak aplikasi

### 16.2 Step

Clock diubah tiba-tiba.

Efek:

- waktu bisa lompat maju/mundur
- timestamp bisa tidak monotonic
- elapsed berbasis wall clock rusak

Aplikasi tidak boleh mengasumsikan wall clock selalu naik.

---

## 17. Java Time API: Penggunaan yang Tepat

### 17.1 `Instant.now()`

Cocok untuk:

- timestamp event
- audit
- persistence time
- logs
- integration with external systems

Tidak cocok untuk:

- elapsed duration yang butuh presisi/stabilitas

### 17.2 `Clock`

Cocok untuk:

- dependency injection waktu
- testability
- business logic
- deterministic tests

Contoh:

```java
public final class TokenService {
    private final Clock clock;

    public TokenService(Clock clock) {
        this.clock = clock;
    }

    public boolean expired(Instant expiresAt) {
        return !Instant.now(clock).isBefore(expiresAt);
    }
}
```

### 17.3 `System.nanoTime()`

Cocok untuk:

- latency
- timeout internal
- measuring elapsed duration
- deadline

### 17.4 `Duration`

Cocok untuk representasi durasi.

Tetapi sumber waktunya tetap harus benar.

---

## 18. ScheduledExecutorService dan Realitas Scheduling

Contoh:

```java
ScheduledExecutorService scheduler =
    Executors.newScheduledThreadPool(1);

scheduler.scheduleAtFixedRate(
    () -> doWork(),
    0,
    100,
    TimeUnit.MILLISECONDS
);
```

Ekspektasi naif:

```text
doWork berjalan setiap 100ms tepat
```

Realitas:

- Jika `doWork()` memakan waktu 150ms, jadwal terganggu.
- Jika scheduler thread tidak mendapat CPU, callback telat.
- Jika GC pause, callback telat.
- Jika cgroup throttled, callback telat.
- Jika task melempar exception, jadwal periodic bisa berhenti tergantung API.
- Jika pool terlalu kecil, task saling menahan.

### 18.1 fixed rate vs fixed delay

`fixed rate`:

```text
target berdasarkan jadwal periodik
```

`fixed delay`:

```text
delay dihitung setelah task selesai
```

Fixed rate bisa “mengejar” jika terlambat.

Fixed delay menjaga jarak setelah eksekusi selesai.

Pilih berdasarkan semantics:

- monitoring heartbeat mungkin fixed rate
- cleanup job biasanya fixed delay
- polling dependency perlu hati-hati agar tidak storm

---

## 19. Timer Drift

Timer drift adalah perbedaan antara jadwal ideal dan eksekusi aktual.

Contoh:

```text
expected: run every 100ms
actual:
  t=100ms
  t=202ms
  t=306ms
  t=510ms
```

Drift dapat muncul karena:

- CPU contention
- cgroup throttling
- GC
- event loop blocking
- long task in scheduler
- host overload
- VM pause

Timer drift adalah gejala penting.

Jika timer drift naik bersamaan dengan latency, kemungkinan masalah bukan dependency eksternal, tetapi runtime scheduling/resource pressure.

---

## 20. Event Loop Lag

Event loop lag adalah bentuk khusus timer drift.

Pada event-loop based system:

```text
event loop schedules timer for now+X
timer should fire at T
actual callback runs at T+delay
delay = event loop lag
```

Penyebab:

- event loop menjalankan task CPU-heavy
- blocking I/O di event loop
- GC pause
- CPU throttling
- terlalu banyak callback
- lock contention
- kernel scheduling delay

Untuk Netty/WebFlux/gRPC async service, event loop lag adalah sinyal emas.

Jika event loop lag tinggi:

- timeout bisa diproses terlambat
- socket read/write terlambat
- accept terlambat
- heartbeat terlambat
- p99 latency naik

---

## 21. Measuring Event Loop Lag secara Sederhana

Konsep:

```java
long intervalNanos = TimeUnit.MILLISECONDS.toNanos(100);
long expected = System.nanoTime() + intervalNanos;

scheduler.scheduleAtFixedRate(() -> {
    long now = System.nanoTime();
    long lagNanos = now - expected;
    expected += intervalNanos;
    record(lagNanos);
}, 100, 100, TimeUnit.MILLISECONDS);
```

Implementasi nyata perlu hati-hati terhadap concurrency dan fixed-rate semantics, tetapi mental modelnya:

```text
scheduled expected time vs actual run time
```

Untuk Netty, bisa schedule task pada event loop dan ukur delay.

---

## 22. Latency Measurement: Apa yang Diukur?

Saat mengatakan:

```text
latency = 120ms
```

Tanya:

1. Dari mana start timestamp diambil?
2. Dari mana end timestamp diambil?
3. Clock apa yang dipakai?
4. Apakah measurement mencakup queue time?
5. Apakah measurement mencakup client-side wait?
6. Apakah measurement mencakup retry?
7. Apakah measurement mencakup time spent before accepted by server?
8. Apakah measurement dilakukan hanya saat request dikirim?
9. Apakah tool mengalami coordinated omission?
10. Apakah percentile dihitung dari raw sample yang benar?

Tanpa jawaban ini, angka latency bisa misleading.

---

## 23. Server-Side Latency vs Client-Side Latency

### 23.1 Server-side latency

Diukur dari server menerima request sampai response selesai diproses/dikirim.

Kelebihan:

- dekat dengan aplikasi
- mudah diberi label route/status
- baik untuk diagnosis internal

Kekurangan:

- tidak mencakup client queue
- tidak mencakup DNS client
- tidak mencakup load balancer queue sebelum request masuk
- mungkin tidak mencakup network transit
- mungkin tidak mencakup retry

### 23.2 Client-side latency

Diukur dari client mulai request sampai menerima response/error.

Kelebihan:

- mendekati user experience
- mencakup network/dependency
- melihat timeout nyata

Kekurangan:

- lebih sulit diatribusi
- bisa mencampur banyak layer
- clock client/server berbeda jika dibandingkan timestamp

Untuk SLO, client-side atau edge-side sering lebih representatif.

Untuk root cause, server-side breakdown diperlukan.

---

## 24. Queue Time: Latency yang Sering Hilang

Request latency sering diukur saat handler mulai.

Tetapi sebelum handler mulai, request bisa sudah menunggu:

- accept queue
- load balancer queue
- servlet container queue
- executor queue
- event loop pending tasks
- connection pool wait
- rate limiter queue
- kernel socket buffer

Jika measurement start terlalu dalam, kamu kehilangan queue latency.

Contoh salah:

```text
metric starts inside business method
```

Padahal request sudah menunggu 200 ms di executor queue.

Lebih baik:

- catat timestamp sedekat mungkin dengan ingress
- catat queue wait sebagai metric sendiri
- bounded queue
- expose rejection/load shedding

---

## 25. Coordinated Omission

Coordinated omission adalah masalah measurement ketika load generator atau measurement tool berhenti mengirim request saat system under test lambat, sehingga tidak mencatat delay yang seharusnya dialami request yang “seharusnya” datang.

Contoh:

- Load generator mengirim request.
- Menunggu response.
- Baru mengirim request berikutnya.
- Server hang 1 detik.
- Selama 1 detik itu tidak ada request baru dikirim.
- Histogram hanya mencatat satu request 1 detik, bukan banyak request yang harusnya menunggu.

Akibat:

```text
latency percentile terlihat terlalu bagus
```

Untuk benchmark backend, coordinated omission bisa membuat sistem buruk terlihat sehat.

Solusi:

- gunakan load generator dengan fixed arrival rate
- record intended start time
- koreksi histogram
- pakai tool yang sadar coordinated omission
- ukur queueing delay

---

## 26. Percentile: p50, p95, p99, p999

Average latency hampir selalu tidak cukup.

Contoh:

```text
99 request = 10ms
1 request = 5000ms

average = ~59.9ms
p99 maybe near 10ms or 5000ms depending sample/distribution definition
max = 5000ms
```

Untuk user experience:

- p50 = typical
- p95 = degraded minority
- p99 = tail
- p999 = rare but often business-critical at scale
- max = useful but noisy

Tail latency penting karena:

- satu user action bisa memanggil banyak service
- fan-out memperbesar peluang kena tail
- retry bisa memperparah tail
- CPU throttling/GC/network loss sering muncul di tail

---

## 27. Fan-out dan Tail Amplification

Jika satu request memanggil 20 dependency secara paralel, dan masing-masing punya 1% chance lambat, peluang minimal satu lambat:

```text
1 - 0.99^20 ≈ 18.2%
```

Jadi p99 setiap dependency bisa menjadi masalah p80 di aggregator.

Implication:

- timeout harus per-hop dan total deadline-aware
- hedging/retry harus hati-hati
- tail latency harus dipantau per dependency
- fan-out design memengaruhi SLO

---

## 28. Timeout Design

Timeout bukan angka dekoratif.

Timeout adalah kontrak:

```text
berapa lama caller bersedia mengikat resource untuk operasi ini
```

Timeout terlalu pendek:

- false timeout
- retry storm
- wasted work
- partial failure
- poor user experience

Timeout terlalu panjang:

- thread/socket/resource tertahan
- queue menumpuk
- failure detection lambat
- cascading failure

### 28.1 Timeout harus punya budget

Contoh user deadline:

```text
Total budget: 1000 ms
```

Breakdown:

```text
ingress + auth:        50 ms
service logic:        100 ms
DB:                   300 ms
cache:                 50 ms
external service:     300 ms
serialization:         50 ms
buffer:               150 ms
```

Jangan setiap dependency diberi 1000 ms.

### 28.2 Timeout harus dikaitkan dengan retry

Jika timeout 1s dan retry 3 kali:

```text
worst case = 3s+ overhead
```

Jika user deadline 1s, ini salah.

---

## 29. Retry Backoff dan Jitter

Retry tanpa backoff bisa memperparah overload.

Buruk:

```text
retry immediately
```

Lebih baik:

```text
exponential backoff + jitter + deadline cap
```

Contoh konsep:

```java
long remaining = deadline.remainingMillis();
long delay = Math.min(computedBackoffWithJitter(), remaining);
```

Tetapi jika remaining sudah habis, jangan retry.

Rule:

```text
retry only if there is enough remaining deadline
and failure is retryable
and retry does not violate idempotency
```

---

## 30. Timeouts and Cancellation

Timeout tanpa cancellation sering hanya memindahkan masalah.

Contoh:

- Caller timeout setelah 500ms.
- Callee tetap bekerja 5 detik.
- Retry dikirim.
- Callee mengerjakan duplicate work.
- CPU/DB makin berat.

Desain lebih baik:

- propagate deadline
- propagate cancellation jika protokol mendukung
- idempotency key
- bounded worker queue
- server-side timeout
- stop work when caller no longer cares

Java stack modern perlu memperhatikan:

- HTTP client timeout
- server request timeout
- DB query timeout
- executor task cancellation
- reactive cancellation
- virtual thread interruption semantics
- blocking API yang tidak responsif interrupt

---

## 31. Clock in Distributed Systems

Dalam distributed system, clock antar host tidak sempurna sinkron.

Akibat:

- timestamp dari service A dan B bisa tampak terbalik
- log ordering bisa salah
- lease berbasis clock bisa berbahaya
- token validation bisa butuh skew tolerance
- distributed tracing butuh hati-hati membaca timestamp
- audit harus menyimpan source dan timezone/offset dengan benar

Untuk ordering distributed events, wall clock bukan sumber kebenaran absolut.

Alternatif:

- logical clock
- version
- sequence number
- database transaction order
- message offset
- monotonic per-node counter
- causality metadata

---

## 32. Cache TTL dan Clock

Cache TTL bisa berbasis:

1. wall-clock expiry timestamp
2. monotonic elapsed duration
3. external store TTL

### 32.1 In-memory TTL

Untuk in-memory cache dalam satu process, monotonic time lebih aman untuk elapsed expiration.

### 32.2 Distributed cache TTL

Redis/database TTL biasanya dikelola oleh server cache.

Aplikasi perlu memahami:

- TTL dihitung di server atau client?
- Clock siapa yang dipakai?
- Apa efek clock skew?
- Apa efek replication lag?
- Apa semantics expire?

### 32.3 Bug umum

```java
if (System.currentTimeMillis() > expiresAtMillis) {
    evict();
}
```

Untuk token/business expiry, wall time memang sesuai.

Untuk internal timeout/cache duration, monotonic lebih stabil.

---

## 33. Rate Limiting Window dan Time

Rate limiter sering memakai waktu.

Jenis:

- fixed window
- sliding window
- token bucket
- leaky bucket

Masalah waktu:

- wall clock jump bisa membuka/menutup window salah
- distributed limiter butuh clock consistency
- local limiter sebaiknya monotonic untuk refill
- refill harus mempertimbangkan elapsed monotonic duration
- long pause bisa menyebabkan burst refill besar jika tidak dibatasi

Token bucket local:

```text
tokens += elapsed_monotonic_time * refill_rate
tokens = min(tokens, capacity)
```

---

## 34. Lock Lease dan Time

Lock lease berbasis waktu sangat sensitif.

Contoh:

```text
lock valid for 10 seconds
```

Masalah:

- process pause 30 detik karena GC/host pause
- process masih berpikir lock valid jika clock logic salah
- dua owner bisa bekerja bersamaan
- clock skew antar node

Untuk distributed lock, perlu:

- fencing token
- monotonically increasing version
- server-side lease authority
- idempotency
- avoid relying only on client wall clock
- design for pause

Rule penting:

> Lease timeout saja tidak cukup untuk correctness jika side effect eksternal tidak memakai fencing/version check.

---

## 35. Measuring Scheduler Delay

Scheduler delay adalah waktu antara:

```text
thread becomes runnable
```

dan:

```text
thread actually runs
```

Ini berbeda dari sleep duration.

Jika thread selesai sleep pada T, lalu baru running pada T+50ms, scheduler delay sekitar 50ms.

Penyebab:

- CPU saturation
- cgroup throttling
- priority
- run queue panjang
- CPU affinity/cpuset sempit
- IRQ/softirq pressure
- host noisy neighbor

Tool:

- `perf sched`
- eBPF run queue latency tools
- `/proc/<pid>/sched`
- `pidstat`
- `top -H`
- application timer drift

Untuk Java service, scheduler delay sering terlihat sebagai:

- event loop lag
- scheduled job late
- request processing gap
- GC pause wall-clock inflation

---

## 36. Cgroup Throttling and Time

Dari Part 012:

```text
Thread runnable != thread executing
```

Cgroup throttling membuat time behavior berubah.

Contoh:

```java
long start = System.nanoTime();
cpuHeavyWork();
long elapsed = System.nanoTime() - start;
```

Jika `cpuHeavyWork()` butuh 20ms CPU, tetapi container throttled 80ms, maka elapsed wall time bisa 100ms.

CPU profiler mungkin menunjukkan 20ms CPU.

Latency metric menunjukkan 100ms.

Keduanya benar, menjawab pertanyaan berbeda.

---

## 37. GC Pause and Time

GC pause diukur sebagai wall-clock pause.

Tetapi penyebab wall-clock pause bisa mencakup:

- actual GC CPU work
- waiting for application threads to reach safepoint
- CPU throttling during GC
- OS scheduling delay
- memory pressure
- page fault
- host steal time dalam VM
- logging during GC

Saat GC pause naik, jangan langsung menyimpulkan heap terlalu kecil.

Korelasikan:

- GC logs
- CPU throttling
- CPU usage
- safepoint logs/JFR
- allocation rate
- page faults
- host CPU steal
- container limit

---

## 38. Safepoint Time

JVM safepoint adalah titik di mana semua thread Java harus mencapai state aman untuk operasi tertentu.

Safepoint delay bisa muncul jika:

- thread lama tidak mencapai safepoint
- native code
- long-running counted loop
- CPU starvation
- OS scheduling delay
- cgroup throttling

Dari sudut aplikasi, ini bisa terlihat sebagai global pause.

Observability:

- JFR
- GC logs with safepoint info
- JVM logging flags
- async-profiler/JFR events

---

## 39. Page Fault and Time

Page fault bisa menambah latency.

Minor page fault:

- page sudah di memory tetapi mapping belum ada
- relatif murah

Major page fault:

- perlu I/O dari disk
- bisa mahal

Untuk Java:

- memory-mapped file
- class loading
- JIT/code cache
- large heap behavior
- container memory pressure
- page cache reclaim

Tool:

```bash
pidstat -r -p <pid> 1
cat /proc/<pid>/stat
perf stat -e page-faults,major-faults -p <pid>
```

Page fault spike bisa membuat latency spike.

---

## 40. VM Steal Time

Jika berjalan di VM/cloud, CPU bisa “dicuri” oleh hypervisor untuk workload lain.

Linux dapat melaporkan steal time pada `/proc/stat`/tools.

Gejala:

- aplikasi runnable tapi tidak mendapat CPU
- host VM oversubscribed
- latency naik
- CPU usage dalam guest tampak aneh

Cek:

```bash
top
vmstat 1
cat /proc/stat | head
```

Kolom `st` di `top` menunjukkan steal time.

Dalam Kubernetes managed environment, ini mungkin tidak selalu mudah dilihat dari pod.

---

## 41. Time Zones

Time zone adalah masalah representasi, bukan durasi.

Untuk backend:

- simpan timestamp sebagai `Instant`/UTC bila memungkinkan
- representasikan local business time dengan timezone eksplisit
- jangan simpan local time tanpa zone untuk event global
- hati-hati DST
- jangan pakai default timezone diam-diam dalam business logic

Java:

```java
Instant now = Instant.now();
ZonedDateTime jakarta = now.atZone(ZoneId.of("Asia/Jakarta"));
```

Untuk durasi:

```java
Duration.ofMinutes(5)
```

Untuk tanggal bisnis:

```java
LocalDate
```

Tetapi harus jelas zone-nya ketika mengubah ke instant.

---

## 42. DST dan Jadwal

Daylight Saving Time bisa membuat:

- hari memiliki 23 jam
- hari memiliki 25 jam
- local time tertentu tidak ada
- local time tertentu muncul dua kali

Asia/Jakarta tidak memakai DST saat ini, tetapi sistem global harus siap.

Bug umum:

```java
nextRun = previousRun.plus(Duration.ofDays(1));
```

Untuk “jalan setiap jam 09:00 local time”, ini mungkin salah di zone DST.

Lebih benar memakai calendar semantics:

```java
LocalTime.of(9, 0)
ZonedDateTime
```

Tergantung kebutuhan.

---

## 43. Leap Seconds

Leap second adalah penyesuaian waktu global yang bisa memengaruhi system time handling.

Banyak platform melakukan smearing atau mekanisme lain.

Untuk Java backend biasa, aturan praktis:

- jangan gunakan wall clock untuk elapsed measurement
- toleransi timestamp ordering
- pakai NTP/time sync yang dikelola platform
- jangan membuat asumsi waktu kalender selalu linear sederhana

---

## 44. Log Timestamp dan Correlation

Untuk log correlation:

- gunakan timestamp dengan timezone/offset atau UTC
- gunakan trace id/request id
- jangan hanya mengandalkan timestamp untuk ordering distributed events
- catat duration dengan monotonic measurement
- catat server receive time dan completion time jika perlu
- sinkronisasi clock host tetap penting

Contoh log baik:

```json
{
  "ts": "2026-06-21T10:30:00.123+07:00",
  "trace_id": "abc",
  "span_id": "def",
  "route": "/orders",
  "duration_ms": 37,
  "deadline_remaining_ms": 412,
  "status": 200
}
```

`ts` untuk observasi kalender.

`duration_ms` dihitung dari monotonic time.

---

## 45. Benchmarking Time

Benchmark Java harus hati-hati.

Masalah umum:

- memakai `currentTimeMillis`
- tidak warm up JIT
- tidak menghindari dead-code elimination
- benchmark terlalu pendek
- tidak mengontrol GC
- tidak jalan dalam container limit sebenarnya
- mengabaikan CPU throttling
- mengabaikan coordinated omission
- mengabaikan percentile
- mengabaikan OS noise

Untuk microbenchmark, gunakan JMH.

Untuk service benchmark:

- gunakan load generator yang fixed arrival rate
- ukur client-side latency
- catat server-side breakdown
- jalankan dalam environment mirip production
- monitor CPU throttling, GC, network, disk
- jangan hanya lihat throughput

---

## 46. Lab 1 — Wall Clock Bisa Berubah, Monotonic untuk Durasi

Program:

```java
public class TimeBasics {
    public static void main(String[] args) throws Exception {
        long wallStart = System.currentTimeMillis();
        long monoStart = System.nanoTime();

        Thread.sleep(1000);

        long wallElapsed = System.currentTimeMillis() - wallStart;
        long monoElapsed = System.nanoTime() - monoStart;

        System.out.println("wall elapsed ms = " + wallElapsed);
        System.out.println("mono elapsed ms = " + monoElapsed / 1_000_000);
    }
}
```

Diskusi:

- Dalam kondisi normal, keduanya mirip.
- Tetapi wall clock bisa berubah.
- Monotonic lebih tepat untuk elapsed time.

Jangan sembarangan mengubah clock production untuk lab.

---

## 47. Lab 2 — Sleep Tidak Tepat Waktu

Program:

```java
public class SleepDrift {
    public static void main(String[] args) throws Exception {
        long requestedMs = 10;
        long maxDriftMs = 0;

        for (int i = 0; i < 10_000; i++) {
            long start = System.nanoTime();
            Thread.sleep(requestedMs);
            long elapsedMs = (System.nanoTime() - start) / 1_000_000;
            long drift = elapsedMs - requestedMs;

            if (drift > maxDriftMs) {
                maxDriftMs = drift;
                System.out.println("new max drift ms = " + maxDriftMs);
            }
        }
    }
}
```

Eksperimen:

1. Jalankan di host idle.
2. Jalankan sambil CPU stress.
3. Jalankan dalam container CPU limit rendah.
4. Jalankan sambil GC pressure.

Observasi:

- sleep actual bisa lebih lama
- drift naik saat CPU pressure
- scheduler delay nyata

---

## 48. Lab 3 — Timer Drift under CPU Throttling

Program:

```java
import java.util.concurrent.*;

public class ScheduledDrift {
    public static void main(String[] args) throws Exception {
        ScheduledExecutorService ses = Executors.newScheduledThreadPool(1);

        long intervalNanos = TimeUnit.MILLISECONDS.toNanos(100);
        final long[] expected = {System.nanoTime() + intervalNanos};

        ses.scheduleAtFixedRate(() -> {
            long now = System.nanoTime();
            long lagMs = (now - expected[0]) / 1_000_000L;
            expected[0] += intervalNanos;

            if (lagMs > 20) {
                System.out.println("scheduler lag ms = " + lagMs);
            }
        }, 100, 100, TimeUnit.MILLISECONDS);

        // CPU burners
        int burners = args.length > 0 ? Integer.parseInt(args[0]) : 4;
        for (int i = 0; i < burners; i++) {
            Thread.ofPlatform().start(() -> {
                long x = 0;
                while (true) {
                    x += System.nanoTime() & 7;
                    if (x == Long.MIN_VALUE) {
                        System.out.println(x);
                    }
                }
            });
        }

        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Run di container:

```bash
docker run --rm -it --cpus=0.5 -v "$PWD":/work -w /work eclipse-temurin:21 bash
javac ScheduledDrift.java
java ScheduledDrift 4
```

Di shell lain:

```bash
cat /sys/fs/cgroup/cpu.stat
```

Ekspektasi:

- scheduler lag naik
- `nr_throttled` naik
- `throttled_usec` naik

---

## 49. Lab 4 — Deadline Propagation

Buat simulasi:

```java
final class Deadline {
    private final long deadlineNanos;

    private Deadline(long deadlineNanos) {
        this.deadlineNanos = deadlineNanos;
    }

    static Deadline afterMillis(long millis) {
        return new Deadline(System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(millis));
    }

    long remainingMillis() {
        return Math.max(0, TimeUnit.NANOSECONDS.toMillis(deadlineNanos - System.nanoTime()));
    }

    void throwIfExpired() {
        if (System.nanoTime() >= deadlineNanos) {
            throw new RuntimeException("deadline expired");
        }
    }
}
```

Gunakan dalam pipeline:

```java
Deadline d = Deadline.afterMillis(1000);

call("auth", 100, d);
call("db", 500, d);
call("external", 700, d);
```

Setiap call harus menerima remaining budget, bukan timeout penuh.

Tujuan:

- memahami total user budget
- menghindari nested timeout explosion
- menghindari retry melewati deadline

---

## 50. Failure Mode 1 — Timeout Pakai Wall Clock

### Gejala

- Request timeout terlalu cepat atau terlalu lama.
- Log menunjukkan elapsed negatif.
- Retry behavior aneh setelah NTP adjustment.
- Scheduled task meloncat.

### Penyebab

Elapsed time dihitung memakai wall clock.

### Fix

- Gunakan monotonic time untuk duration/deadline.
- Gunakan wall clock hanya untuk timestamp/business time.
- Inject `Clock` untuk business time agar testable.

---

## 51. Failure Mode 2 — Scheduled Job Menumpuk

### Gejala

- CPU spike periodik.
- Job yang harusnya tiap 1 menit berjalan bertumpuk.
- Latency naik saat job aktif.
- Thread pool scheduler penuh.

### Penyebab

- Fixed-rate job lebih lambat dari period.
- Job tidak punya lock/skip policy.
- Scheduler pool terlalu kecil.
- CPU throttling membuat job telat lalu mengejar.
- Job tidak idempotent.

### Fix

- Gunakan fixed-delay jika lebih sesuai.
- Tambahkan skip-if-running.
- Bounded execution.
- Deadline per job.
- Pisahkan scheduler dari request critical path.
- Monitor job duration dan lag.

---

## 52. Failure Mode 3 — Event Loop Lag Tertukar dengan Network Issue

### Gejala

- Timeout socket meningkat.
- Dependency metrics normal.
- Event loop pending task naik.
- CPU throttling naik.
- GC tidak dominan.

### Penyebab

Event loop tidak sempat menjalankan read/write/timer karena:

- CPU limit
- blocking task
- CPU-heavy callback
- GC/safepoint

### Fix

- Ukur event loop lag.
- Hapus blocking work dari event loop.
- Pisahkan executor CPU-heavy.
- Tambahkan CPU headroom.
- Monitor throttling.

---

## 53. Failure Mode 4 — Retry Melebihi User Deadline

### Gejala

- User timeout 2 detik.
- Backend masih bekerja 10 detik.
- Dependency menerima request duplicate.
- Error meningkat saat incident.

### Penyebab

- Timeout per dependency tidak aware total deadline.
- Retry tidak capped by remaining time.
- Cancellation tidak dipropagasi.
- Server-side work tetap berjalan setelah caller timeout.

### Fix

- Propagate deadline.
- Check remaining before retry.
- Cancel work if no longer needed.
- Use idempotency key.
- Bound queues.
- Add load shedding.

---

## 54. Failure Mode 5 — Benchmark Terlihat Bagus tapi Production Buruk

### Gejala

- Load test p99 baik.
- Production p99 buruk.
- Under incident, latency collapse lebih parah dari benchmark.

### Penyebab

- Coordinated omission.
- Load generator closed-loop.
- Tidak mengukur queue time.
- Tidak jalan dalam CPU limit production.
- Tidak memonitor throttling/GC.
- Dataset/cache tidak realistis.

### Fix

- Gunakan fixed arrival rate.
- Record intended schedule time.
- Monitor server-side dan client-side.
- Jalankan dengan container limit sama.
- Pantau cgroup CPU, GC, queues, network.

---

## 55. Production Checklist: Time and Latency

Untuk service Java production:

```text
[ ] Latency diukur dengan monotonic time.
[ ] Timestamp log memakai wall clock/Instant dengan timezone jelas.
[ ] Timeout internal memakai deadline, bukan nested fixed timeout.
[ ] Retry memperhatikan remaining deadline.
[ ] Cancellation dipropagasi bila memungkinkan.
[ ] Event loop lag dimonitor untuk async service.
[ ] Scheduler/job lag dimonitor.
[ ] GC pause dikorelasikan dengan CPU throttling.
[ ] Cgroup throttling dimonitor.
[ ] Queue time diukur, bukan hanya handler time.
[ ] Load test menghindari coordinated omission.
[ ] p95/p99/p999 dipantau, bukan hanya average.
[ ] Clock sync host dikelola platform.
[ ] Business time menggunakan `Clock` agar testable.
[ ] Distributed ordering tidak bergantung buta pada wall clock.
```

---

## 56. Debugging Checklist: Latency Spike

Saat latency naik:

### 56.1 Pertanyaan awal

```text
Apakah latency naik di client-side, server-side, atau keduanya?
Apakah queue time ikut naik?
Apakah event loop lag naik?
Apakah scheduler/job lag naik?
Apakah GC pause naik?
Apakah CPU throttling naik?
Apakah dependency latency naik?
Apakah retry rate naik?
Apakah clock jump terjadi?
```

### 56.2 Command OS

```bash
date --iso-8601=ns
timedatectl status

cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.max

vmstat 1
pidstat -t -p <pid> 1
top -H -p <pid>
```

### 56.3 JVM

```bash
jcmd <pid> VM.info
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> JFR.check
```

### 56.4 Metrics

- request latency p50/p95/p99
- in-flight requests
- queue length
- executor active/queued
- event loop lag
- GC pause
- CPU throttling
- dependency latency
- timeout/retry rate

---

## 57. Design Pattern: Deadline Object

Daripada menyebarkan `timeoutMs`, gunakan object deadline.

```java
public final class RequestDeadline {
    private final long deadlineNanos;

    private RequestDeadline(long deadlineNanos) {
        this.deadlineNanos = deadlineNanos;
    }

    public static RequestDeadline after(Duration duration) {
        long nanos = duration.toNanos();
        return new RequestDeadline(System.nanoTime() + nanos);
    }

    public Duration remaining() {
        long rem = deadlineNanos - System.nanoTime();
        return Duration.ofNanos(Math.max(0, rem));
    }

    public boolean expired() {
        return System.nanoTime() >= deadlineNanos;
    }

    public void check() {
        if (expired()) {
            throw new RuntimeException("deadline expired");
        }
    }
}
```

Kemudian:

```java
RequestDeadline deadline = RequestDeadline.after(Duration.ofSeconds(1));

serviceA.call(deadline);
serviceB.call(deadline);
serviceC.call(deadline);
```

Setiap service mengambil remaining budget.

Ini membuat budget eksplisit.

---

## 58. Design Pattern: Measure Queue + Execution Separately

Untuk executor:

```java
long submittedAt = System.nanoTime();

executor.execute(() -> {
    long startedAt = System.nanoTime();
    long queueMs = (startedAt - submittedAt) / 1_000_000;

    try {
        doWork();
    } finally {
        long doneAt = System.nanoTime();
        long execMs = (doneAt - startedAt) / 1_000_000;

        metrics.record("queue_ms", queueMs);
        metrics.record("execution_ms", execMs);
    }
});
```

Manfaat:

- tahu apakah lambat karena queue
- tahu apakah lambat karena execution
- membantu sizing executor
- membantu melihat CPU throttling/saturation
- membantu backpressure design

---

## 59. Design Pattern: Event Loop Lag Monitor

Konsep untuk event loop:

```java
long interval = TimeUnit.MILLISECONDS.toNanos(100);
long[] expected = {System.nanoTime() + interval};

eventLoop.scheduleAtFixedRate(() -> {
    long now = System.nanoTime();
    long lag = now - expected[0];
    expected[0] += interval;
    recordLag(lag);
}, 100, 100, TimeUnit.MILLISECONDS);
```

Untuk implementasi nyata:

- jangan membuat monitor terlalu berat
- record histogram
- alert saat lag tinggi dan latency naik
- korelasikan dengan CPU throttling dan GC

---

## 60. Invariant yang Harus Diingat

1. Wall clock untuk timestamp, bukan elapsed duration.
2. Monotonic clock untuk duration, timeout, deadline.
3. `System.nanoTime()` tidak boleh dipakai sebagai timestamp.
4. `System.currentTimeMillis()` tidak aman untuk latency measurement.
5. Sleep/timer adalah minimum/target delay, bukan guarantee.
6. Timer expired tidak berarti callback langsung jalan.
7. Runnable thread belum tentu running.
8. CPU throttling memperpanjang wall-clock latency tanpa menambah CPU work.
9. GC pause wall-clock bisa dipengaruhi CPU starvation.
10. Timeout harus dipikirkan sebagai budget, bukan angka lokal.
11. Deadline propagation lebih aman daripada nested timeout.
12. Retry harus dibatasi remaining deadline.
13. Coordinated omission bisa membuat benchmark menipu.
14. Queue time harus diukur eksplisit.
15. Distributed ordering tidak boleh bergantung buta pada wall clock.
16. Clock jump bisa merusak logic yang salah memakai wall time.
17. Event loop lag adalah sinyal scheduling/runtime pressure.
18. Average latency bukan representasi tail.
19. Time zone adalah representasi kalender, bukan durasi.
20. Business time sebaiknya testable dengan `Clock`.

---

## 61. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa `System.currentTimeMillis()` buruk untuk mengukur latency?

Jawaban:

- Itu wall clock.
- Wall clock bisa maju/mundur karena NTP/admin/host adjustment.
- Elapsed bisa negatif atau terlalu besar.
- Latency harus memakai monotonic time seperti `System.nanoTime()`.

### Q2

Jika `Thread.sleep(100)` kadang baru lanjut setelah 500 ms, apa kemungkinan penyebab?

Jawaban:

- CPU saturation.
- Cgroup throttling.
- GC pause.
- Scheduler delay.
- Host/VM pause.
- Thread priority/affinity.
- Event loop/scheduler thread blocked.

### Q3

Apa bedanya timeout dan deadline?

Jawaban:

- Timeout adalah durasi maksimum operasi lokal.
- Deadline adalah batas waktu total/absolute untuk pekerjaan.
- Deadline memungkinkan remaining budget dipropagasi antar call.
- Nested fixed timeout bisa membuat total latency melebihi user budget.

### Q4

Kenapa GC pause bisa naik saat CPU throttling?

Jawaban:

- GC worker butuh CPU.
- Saat cgroup throttled, GC tidak berjalan walau perlu.
- Wall-clock pause memanjang.
- CPU work GC mungkin tidak naik sebesar wall-clock pause.

### Q5

Apa itu coordinated omission?

Jawaban:

- Bias measurement ketika load generator tidak mengirim request saat sistem lambat.
- Delay yang seharusnya dialami request yang datang selama pause tidak tercatat.
- Percentile terlihat terlalu bagus.
- Solusi: fixed arrival rate/intended timestamp/corrected histogram.

### Q6

Kapan memakai `Instant.now()`?

Jawaban:

- Untuk timestamp kalender/audit/log/business event.
- Bukan untuk elapsed latency internal.
- Untuk testable business logic, inject `Clock`.

---

## 62. Ringkasan

Waktu adalah salah satu fondasi correctness dan observability.

Untuk Java engineer, pemahaman ini penting karena:

- JVM berjalan di atas Linux scheduler.
- Timer dan sleep bergantung pada kernel/JVM scheduling.
- Container CPU limit bisa memperlambat timer tanpa error.
- Wall clock bisa berubah.
- Timeout dan retry bisa memperparah overload.
- Latency measurement bisa menipu bila salah clock atau coordinated omission.
- Distributed systems tidak punya perfect global clock.

Mental model utama:

```text
Timestamp != duration
Wall clock != monotonic clock
Timer expiry != callback execution
Runnable != running
Timeout local != user deadline
Average latency != tail behavior
```

Jika kamu membawa mental model ini ke desain service, kamu akan lebih mampu:

- membuat timeout yang benar
- menghindari retry storm
- membaca latency spike
- memisahkan CPU work dari waiting
- mengukur queueing
- memahami event loop lag
- menghindari benchmark palsu
- mendesain sistem yang lebih defensible di production

---

## 63. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `clock_gettime(2)`  
   `https://man7.org/linux/man-pages/man2/clock_gettime.2.html`

2. Linux man-pages — `time(7)`  
   `https://man7.org/linux/man-pages/man7/time.7.html`

3. Linux man-pages — `nanosleep(2)`  
   `https://man7.org/linux/man-pages/man2/nanosleep.2.html`

4. Linux man-pages — `timerfd_create(2)`  
   `https://man7.org/linux/man-pages/man2/timerfd_create.2.html`

5. Java Platform Documentation — `System.nanoTime()` and `System.currentTimeMillis()`  
   `https://docs.oracle.com/en/java/javase/`

6. Java Platform Documentation — `java.time.Clock`, `Instant`, `Duration`, `ZonedDateTime`  
   `https://docs.oracle.com/en/java/javase/`

7. Linux Kernel Documentation — Timers and timekeeping  
   `https://docs.kernel.org/timers/`

8. Gil Tene / HdrHistogram materials on coordinated omission  
   Gunakan sebagai bacaan lanjutan untuk latency histogram dan benchmark methodology.

---

## 64. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 013 — Time, Clocks, Timers, and Latency Measurement
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-014.md
Part 014 — Signals, Process Control, and Graceful Shutdown
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — CPU Scheduling II: Cgroups, Quotas, Throttling, and Containers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-014.md">Part 014 — Signals, Process Control, and Graceful Shutdown ➡️</a>
</div>
