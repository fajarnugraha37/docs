# learn-java-reliability-part-000.md

# Part 000 — Orientation, Scope, and Mental Model for Graceful Shutdown, Error Handling, Exceptions, and Reliability

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Target: Java backend engineer / tech lead / architect yang ingin naik level dari sekadar “bisa handle error” menjadi mampu mendesain sistem yang **predictable under failure**, **operationally safe**, dan **production defensible**.

---

## 0. Executive Summary

Bagian 0 ini bukan materi teknis detail seperti `try-catch`, `@ControllerAdvice`, `ExceptionMapper`, atau konfigurasi `server.shutdown=graceful`. Itu akan dibahas di part-part berikutnya.

Bagian ini adalah **peta berpikir** untuk seluruh seri.

Masalah utama yang akan kita kuasai adalah:

> Bagaimana mendesain Java service yang tetap memiliki perilaku jelas saat terjadi error, timeout, partial failure, dependency down, retry, duplicate request, shutdown, rolling deployment, crash, dan incident production.

Dalam sistem nyata, error handling bukan sekadar:

```java
try {
    doSomething();
} catch (Exception e) {
    log.error("error", e);
}
```

Itu terlalu kecil.

Topik ini sebenarnya adalah gabungan dari beberapa disiplin:

1. **Language semantics** — bagaimana Java merepresentasikan dan mempropagasikan exception.
2. **API design** — bagaimana kegagalan dikomunikasikan ke caller.
3. **Domain modeling** — bagaimana business failure dibedakan dari technical failure.
4. **Lifecycle engineering** — bagaimana aplikasi berhenti dengan aman.
5. **Distributed systems** — bagaimana sistem bertahan saat dependency, network, queue, DB, atau pod gagal.
6. **Reliability engineering** — bagaimana sistem didesain agar failure terbatas, terlihat, terukur, dan bisa dipulihkan.
7. **Operational readiness** — bagaimana engineer, SRE, support, QA, security, dan stakeholder memahami apa yang terjadi saat sistem bermasalah.

Kalimat paling penting untuk seri ini:

> Error handling adalah desain perilaku sistem saat realitas tidak sesuai asumsi.

Dan reliability adalah kemampuan sistem untuk tetap memenuhi tujuan pentingnya meskipun sebagian asumsi gagal.

---

## 1. Why This Series Exists

Kamu sudah menyelesaikan seri besar tentang Java, collections/streams, concurrency/reactive, data types, Jakarta/JAX-RS, dan JAX-RS advanced. Itu berarti kita tidak perlu mengulang fondasi seperti:

- apa itu class/object;
- basic Java syntax;
- basic exception syntax;
- HTTP method dasar;
- annotation REST dasar;
- thread dasar;
- future/completable future dasar;
- reactive stream dasar;
- collection dan stream dasar;
- basic controller-service-repository layering.

Seri ini naik level ke pertanyaan yang lebih production-oriented:

- Apa yang terjadi jika service sedang memproses request lalu pod menerima SIGTERM?
- Apa yang terjadi jika request sudah commit ke database tetapi response ke client gagal?
- Apa yang terjadi jika retry membuat command bisnis dieksekusi dua kali?
- Apa yang terjadi jika error di-catch tetapi tidak diobservasi?
- Apa yang terjadi jika dependency lambat, bukan down?
- Apa yang terjadi jika shutdown timeout lebih pendek daripada transaction timeout?
- Apa yang terjadi jika message consumer shutdown setelah side effect tetapi sebelum ack?
- Apa yang terjadi jika fallback mengembalikan data lama yang secara regulasi tidak boleh dipakai?
- Apa yang terjadi jika `500 Internal Server Error` dipakai untuk semua kondisi?
- Apa yang terjadi jika log terlalu banyak tetapi tidak menjelaskan root cause?
- Apa yang terjadi jika sistem “sukses” secara HTTP tetapi gagal secara business outcome?

Di level junior/intermediate, engineer sering melihat error sebagai “exception yang harus ditangkap”.

Di level senior/top-tier, engineer melihat error sebagai:

- signal;
- state transition;
- contract violation;
- invariant breach;
- operational event;
- consistency risk;
- security boundary;
- user-impact event;
- evidence for incident reconstruction.

Seri ini bertujuan membangun cara berpikir kedua.

---

## 2. Source Anchors and Technical Grounding

Seri ini akan mengambil rujukan dari sumber resmi dan praktik production engineering. Beberapa anchor penting:

1. **Java exception model**  
   Dalam Java, `Throwable` adalah superclass dari seluruh error dan exception yang bisa dilempar oleh JVM atau oleh statement `throw`. Hanya `Throwable` atau subclass-nya yang dapat menjadi tipe dalam `catch` clause. Ini penting karena semua mekanisme exception Java berakar dari model ini.

2. **Java checked vs unchecked semantics**  
   `RuntimeException` dan subclass-nya adalah unchecked exception. Unchecked exception tidak wajib dideklarasikan dalam `throws` clause meskipun bisa keluar dari method boundary. Artinya, API design harus sadar bahwa tidak semua failure terlihat dari signature method.

3. **Java Language Specification**  
   Java Language Specification mendefinisikan aturan compile-time dan runtime untuk exception handling, termasuk checked exception, `throw`, `try`, `catch`, `finally`, dan try-with-resources.

4. **Spring Boot graceful shutdown**  
   Spring Boot mendukung graceful shutdown pada web server tertentu. Ketika application context ditutup, graceful shutdown dilakukan sebagai bagian dari lifecycle stop, dengan timeout shutdown phase yang dapat dikonfigurasi.

5. **Kubernetes container lifecycle**  
   Kubernetes memiliki lifecycle termination sendiri. `PreStop` hook harus selesai sebelum `TERM` signal dikirim, dan seluruh proses tetap berada dalam batas `terminationGracePeriodSeconds`. Jika grace period habis, container bisa dipaksa berhenti.

Implikasinya:

> Graceful shutdown tidak bisa hanya dipahami dari sisi Java. Ia harus dipahami sebagai gabungan JVM lifecycle, framework lifecycle, container lifecycle, orchestrator lifecycle, load balancer behavior, request behavior, worker behavior, dan data consistency behavior.

---

## 3. The Core Problem: Failure Is Not One Thing

Salah satu kesalahan terbesar dalam desain backend adalah memperlakukan semua failure sebagai satu kategori bernama “error”.

Padahal failure memiliki banyak dimensi.

### 3.1 Failure by origin

Failure bisa berasal dari:

| Origin | Contoh | Implikasi |
|---|---|---|
| User input | field kosong, format salah, state invalid | biasanya client-correctable |
| Business rule | tidak boleh approve case yang belum lengkap | domain-level rejection |
| Authentication | token invalid/expired | security boundary |
| Authorization | user tidak punya permission | fail-closed |
| Data integrity | unique constraint, FK violation | mungkin conflict atau bug |
| Application bug | null dereference, impossible state | developer-correctable |
| Dependency | external API down/slow | transient atau systemic |
| Infrastructure | DNS, network, pod kill, node pressure | operational concern |
| Capacity | pool exhausted, queue backlog, CPU saturated | overload management |
| Concurrency | stale version, lost update, deadlock | coordination issue |
| Shutdown | SIGTERM, rolling deployment, scale down | lifecycle issue |
| Human operation | wrong config, manual rerun, deployment mistake | process/control issue |

Jika semuanya diperlakukan sebagai `500`, sistem kehilangan semantic clarity.

### 3.2 Failure by recoverability

Failure bisa:

| Type | Meaning | Example |
|---|---|---|
| Recoverable immediately | caller bisa memperbaiki dan coba lagi | validation error |
| Recoverable by retry | transient network timeout | external 503 |
| Recoverable by compensation | side effect sudah terjadi sebagian | saga failure |
| Recoverable by operator | config salah, queue stuck | incident response |
| Recoverable by developer | bug/invariant breach | code fix |
| Non-recoverable in current flow | corrupted input, impossible transition | reject and alert |

Akar desain reliability adalah mampu menjawab:

> Siapa yang bisa memperbaiki failure ini, kapan, dengan aksi apa, dan apakah aman untuk retry?

### 3.3 Failure by visibility

Failure juga bisa:

| Visibility | Example | Risk |
|---|---|---|
| Explicit visible failure | API return 400/409/503 | relatif mudah ditangani |
| Logged but response sukses | audit write gagal tapi business success | hidden inconsistency |
| Swallowed exception | catch lalu ignore | evidence hilang |
| Retried until hidden | client tidak tahu sempat gagal | bisa aman atau bisa misleading |
| Partial success | beberapa item batch berhasil, sebagian gagal | membutuhkan model outcome |
| Delayed failure | async processing gagal setelah response sukses | perlu tracking/reconciliation |

Failure yang paling berbahaya sering bukan yang menyebabkan sistem mati, tetapi yang membuat sistem **terlihat sehat padahal outcome-nya salah**.

---

## 4. The Top-Tier Mental Model

Seri ini menggunakan mental model berikut:

```text
Input / Event / Request
        |
        v
Boundary Validation
        |
        v
Domain Decision + Invariant Protection
        |
        v
State Transition / Side Effect
        |
        v
Persistence / External Dependency / Message Publication
        |
        v
Response / Ack / Commit / Observable Signal
```

Failure bisa terjadi di setiap titik.

Engineer yang kuat tidak hanya bertanya:

> Exception apa yang dilempar?

Tetapi bertanya:

1. State apa yang sudah berubah?
2. Side effect apa yang sudah terjadi?
3. Caller melihat apa?
4. Sistem downstream menerima apa?
5. Apakah aman untuk retry?
6. Apakah duplicate execution mungkin terjadi?
7. Apakah error terlihat di log/metric/trace?
8. Apakah operator bisa tahu severity dan blast radius?
9. Apakah data bisa direkonsiliasi?
10. Apakah shutdown bisa memotong flow di tengah?
11. Apakah fallback akan menghasilkan false success?
12. Apakah behavior-nya konsisten dengan domain/regulasi?

Inilah perbedaan besar antara “coding error handling” dan “engineering reliability”.

---

## 5. Reliability Is About Controlled Behavior Under Stress

Reliability bukan berarti sistem tidak pernah gagal.

Reliability berarti:

1. Failure sudah diperkirakan.
2. Failure diklasifikasi.
3. Failure dibatasi dampaknya.
4. Failure dikomunikasikan secara benar.
5. Failure diobservasi.
6. Failure dapat dipulihkan.
7. Failure tidak diam-diam merusak data.
8. Failure tidak menyebabkan cascade.
9. Failure tidak membuat operator buta.
10. Failure tidak membuat user/client mengambil keputusan salah.

Dengan kata lain:

> Reliability adalah kemampuan sistem untuk tetap memiliki perilaku yang dapat diprediksi saat berada di kondisi buruk.

---

## 6. The Four Reliability Questions

Sepanjang seri ini, setiap pattern akan dievaluasi dengan empat pertanyaan inti.

### 6.1 What failed?

Kita harus tahu jenis failure-nya.

Contoh jawaban buruk:

> Something went wrong.

Contoh jawaban lebih baik:

> External identity provider returned 503 after 2 seconds while refreshing token for dependency X. Request was not persisted. Safe to retry with same idempotency key.

### 6.2 What already happened?

Ini lebih penting dari yang terlihat.

Misalnya:

- Apakah DB sudah commit?
- Apakah message sudah terkirim?
- Apakah email sudah dikirim?
- Apakah external API sudah menerima request?
- Apakah lock sudah diambil?
- Apakah audit trail sudah tertulis?
- Apakah response sudah dikirim sebagian?
- Apakah ack queue sudah dilakukan?

Error handling yang tidak tahu “apa yang sudah terjadi” tidak bisa menentukan recovery yang aman.

### 6.3 What should happen next?

Kemungkinan aksi:

- reject;
- retry;
- rollback;
- compensate;
- requeue;
- dead-letter;
- alert;
- degrade;
- fallback;
- mark pending;
- reconcile later;
- stop accepting traffic;
- drain;
- crash fast;
- fail closed;
- fail open;
- require manual intervention.

### 6.4 Who needs to know?

Yang perlu tahu bisa berbeda:

- end user;
- frontend;
- calling service;
- queue consumer;
- operator;
- developer;
- security team;
- compliance/audit team;
- product owner;
- support desk.

Tidak semua pihak butuh detail sama.

Contoh:

- User tidak perlu melihat stack trace.
- Operator perlu correlation ID, dependency name, status, retry exhaustion.
- Developer perlu root cause dan stack trace.
- Security perlu tahu apakah token/PII bocor.
- Compliance perlu bukti apakah audit event berhasil atau gagal.

---

## 7. Important Distinction: Error, Exception, Failure, Fault, Incident

Istilah ini sering tercampur. Untuk seri ini kita akan menggunakan definisi praktis berikut.

### 7.1 Fault

**Fault** adalah penyebab atau kondisi salah yang bisa menghasilkan error.

Contoh:

- bug di kode;
- config salah;
- DB index hilang;
- network partition;
- expired credential;
- schema mismatch;
- dependency overloaded.

Fault bisa ada lama sebelum terlihat.

### 7.2 Error

**Error** adalah state internal yang salah.

Contoh:

- object berada di state yang tidak valid;
- cache berisi data stale;
- request context kehilangan user id;
- deadline sudah lewat tapi task masih berjalan;
- transaction sudah rollback tapi kode masih mengirim event sukses.

### 7.3 Exception

**Exception** adalah mekanisme bahasa/runtime untuk menginterupsi control flow dan membawa informasi failure.

Di Java, exception hanyalah salah satu cara merepresentasikan error/failure. Tidak semua failure muncul sebagai exception.

Contoh failure tanpa exception:

- API return HTTP 200 tapi body berisi status `FAILED`;
- dependency lambat tapi belum timeout;
- message duplicate;
- data stale;
- queue backlog;
- cache miss storm;
- pod masih menerima traffic saat draining;
- background worker stuck;
- metric error rate naik tapi aplikasi tidak throw exception.

### 7.4 Failure

**Failure** adalah ketika sistem tidak memenuhi expected behavior dari perspektif boundary tertentu.

Contoh:

- user gagal submit application;
- service tidak memenuhi SLO latency;
- worker tidak memproses message dalam SLA;
- audit event tidak tercatat;
- payment tereksekusi dua kali;
- approval state lompat ke status yang tidak sah.

### 7.5 Incident

**Incident** adalah failure yang berdampak operasional dan membutuhkan respons manusia atau proses incident management.

Contoh:

- error rate naik 30 menit;
- DB storage penuh;
- consumer lag terus naik;
- external integration gagal massal;
- deployment menyebabkan 5xx spike;
- data corruption terdeteksi;
- regulatory report tidak bisa digenerate.

Pembedaan ini penting karena solusi untuk masing-masing berbeda.

---

## 8. Error Handling Is a Boundary Discipline

Error handling yang baik hampir selalu dimulai dari mengenali boundary.

Boundary adalah tempat sistem berinteraksi dengan dunia luar atau berpindah abstraction layer.

Contoh boundary:

1. HTTP API boundary.
2. Message queue boundary.
3. Scheduler/job boundary.
4. Database boundary.
5. External API boundary.
6. File/object storage boundary.
7. Authentication provider boundary.
8. Domain service boundary.
9. Transaction boundary.
10. Thread/task boundary.
11. Process/container boundary.
12. Deployment/shutdown boundary.

Di setiap boundary, kita perlu menjawab:

- apa input contract-nya?
- apa output contract-nya?
- exception apa yang boleh keluar?
- exception apa yang harus diterjemahkan?
- metadata apa yang harus dipertahankan?
- apakah retry aman?
- apakah caller perlu tahu detail teknis?
- apakah failure ini perlu metric?
- apakah failure ini perlu audit?
- apakah failure ini perlu alert?

### 8.1 Boundary translation

Contoh buruk:

```java
public UserResponse getUser(String id) {
    try {
        return userClient.getUser(id);
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

Masalah:

- semua error kehilangan kategori;
- timeout, 404, 401, 429, 500, DNS error jadi sama;
- caller tidak tahu retryability;
- observability tidak bisa membedakan failure mode;
- API layer mungkin akan mengubah semua jadi 500.

Contoh lebih baik secara konsep:

```java
public UserProfile loadUserProfile(UserId id) {
    try {
        ExternalUserDto dto = userDirectoryClient.fetchUser(id.value());
        return mapper.toDomain(dto);
    } catch (ExternalNotFoundException e) {
        throw new UserProfileNotFoundException(id, e);
    } catch (ExternalRateLimitedException e) {
        throw new UserDirectoryTemporarilyUnavailableException(id, Retryability.RETRY_LATER, e);
    } catch (ExternalTimeoutException e) {
        throw new UserDirectoryTimeoutException(id, Retryability.RETRY_WITH_IDEMPOTENCY, e);
    }
}
```

Yang penting bukan nama class-nya, tetapi semantic preservation-nya.

---

## 9. Failure Semantics Must Survive Layering

Layering sering merusak failure semantics.

Contoh umum:

```text
Database unique constraint violation
        |
        v
DataIntegrityViolationException
        |
        v
RuntimeException
        |
        v
500 Internal Server Error
        |
        v
Frontend shows: "Something went wrong"
```

Padahal mungkin failure aslinya adalah:

```text
Duplicate idempotency key / duplicate business reference
        |
        v
409 Conflict
        |
        v
Client can fetch existing result or show duplicate submission message
```

Atau:

```text
Optimistic lock conflict
        |
        v
409 Conflict / stale state
        |
        v
User must refresh latest data
```

Atau:

```text
Foreign key violation due to missing parent aggregate
        |
        v
Domain invariant breach / bug / bad migration
        |
        v
Alert developer/operator
```

Jadi, part berikutnya akan banyak membahas:

- exception translation;
- error taxonomy;
- domain exception;
- technical exception;
- conflict mapping;
- retryability metadata;
- observability metadata;
- supportability metadata.

---

## 10. Reliability Requires Knowing the State Transition

Sistem bisnis umumnya bukan hanya request-response stateless. Ia mengubah state.

Contoh state machine sederhana:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> PUBLISHED
```

Failure handling harus memperhatikan state transition.

Misalnya user submit application:

```text
1. validate request
2. check current state is DRAFT
3. update state to SUBMITTED
4. insert audit trail
5. publish ApplicationSubmitted event
6. send response 200
```

Pertanyaan failure:

- Kalau step 1 gagal, response apa?
- Kalau step 2 gagal karena state sudah `SUBMITTED`, apakah duplicate submit atau conflict?
- Kalau step 3 commit berhasil tapi step 4 gagal, apakah submit dianggap berhasil?
- Kalau step 4 berhasil tapi step 5 gagal, apakah event harus outbox?
- Kalau step 5 terkirim tapi response 200 gagal karena network disconnect, apakah client akan retry?
- Kalau client retry, apakah submit akan dieksekusi ulang?
- Kalau pod SIGTERM setelah step 3 sebelum step 5, apa yang terjadi?
- Kalau worker membaca outbox lalu mati sebelum mark published, apakah event duplicate?

Ini inti reliability.

Bukan hanya “exception apa”. Tetapi:

> State transition mana yang sudah terjadi, mana yang belum, dan bagaimana sistem membuktikannya?

---

## 11. The Shutdown Problem Is a Consistency Problem

Graceful shutdown sering dipahami terlalu sempit:

> “biarkan request selesai sebelum aplikasi mati.”

Itu benar, tetapi belum cukup.

Shutdown adalah consistency problem karena aplikasi bisa sedang berada di tengah:

- HTTP request;
- DB transaction;
- external API call;
- message handling;
- scheduled job;
- file upload;
- report generation;
- cache refresh;
- token refresh;
- event publication;
- batch import;
- audit writing;
- distributed lock ownership;
- async task execution.

Shutdown memaksa kita menjawab:

1. Kapan kita berhenti menerima work baru?
2. Work yang sedang berjalan diberi waktu berapa lama?
3. Work apa yang boleh dilanjutkan?
4. Work apa yang harus dibatalkan?
5. Work apa yang harus disimpan checkpoint-nya?
6. Work apa yang harus di-requeue?
7. Work apa yang harus di-mark unknown?
8. Apa yang terjadi jika grace period habis?
9. Apa yang terjadi jika OS/container mengirim kill?
10. Apakah readiness berubah sebelum traffic berhenti?
11. Apakah load balancer masih bisa mengirim request?
12. Apakah caller akan retry?
13. Apakah retry aman?

### 11.1 Shutdown is not one layer

```text
Kubernetes rolling update / scale down / delete pod
        |
        v
Pod marked terminating
        |
        v
Endpoint removal / readiness behavior / load balancer delay
        |
        v
preStop hook
        |
        v
SIGTERM to process
        |
        v
JVM shutdown
        |
        v
Spring context closing
        |
        v
Web server stops accepting new work
        |
        v
Executors, schedulers, consumers, pools stop
        |
        v
Application exits
        |
        v
Kubernetes observes container stopped
```

Jika satu layer salah konfigurasi, graceful shutdown bisa gagal.

Contoh:

- Spring Boot graceful shutdown aktif, tetapi Kubernetes grace period terlalu pendek.
- Kubernetes grace period cukup panjang, tetapi app tidak merespons SIGTERM.
- App berhenti menerima request, tetapi readiness belum false sehingga load balancer masih mengirim traffic.
- HTTP request drain aman, tetapi queue consumer masih mengambil message baru.
- Worker berhenti polling, tetapi task yang sudah berjalan tidak punya cancellation/deadline.
- Grace period habis lalu SIGKILL memotong transaction/external call.

---

## 12. Error Handling and Reliability Are About Contracts

Ada beberapa contract yang harus konsisten.

### 12.1 Method contract

Method harus jelas:

- input valid apa;
- output valid apa;
- exception apa yang bisa muncul;
- apakah exception menunjukkan caller error atau system error;
- apakah method punya side effect;
- apakah method idempotent;
- apakah method bisa blocking lama;
- apakah method menghormati cancellation/deadline.

### 12.2 API contract

API harus jelas:

- status code;
- error code;
- error message;
- validation detail;
- retryability;
- idempotency behavior;
- conflict behavior;
- correlation id;
- stable schema.

### 12.3 Data contract

Data layer harus jelas:

- constraint apa yang enforce invariant;
- unique key mana yang enforce idempotency;
- transaction boundary mana;
- isolation level apa;
- partial write bagaimana dicegah;
- conflict bagaimana dideteksi;
- rollback/commit uncertainty bagaimana ditangani.

### 12.4 Operational contract

Production behavior harus jelas:

- kapan alert muncul;
- metric apa yang naik;
- log apa yang tersedia;
- runbook apa yang dipakai;
- siapa yang responsible;
- apakah ada safe manual retry;
- apakah ada reconciliation job;
- bagaimana menentukan impact.

### 12.5 Shutdown contract

Lifecycle harus jelas:

- kapan readiness false;
- kapan stop accepting traffic;
- kapan stop polling queue;
- berapa drain timeout;
- apakah long-running job checkpoint;
- apa exit code;
- apa yang terjadi jika forced kill.

---

## 13. “Handled” Does Not Mean “Caught”

Ini prinsip penting.

Exception yang di-catch belum tentu handled.

Contoh:

```java
try {
    auditService.writeAudit(event);
} catch (Exception e) {
    log.warn("Failed to write audit", e);
}
```

Apakah ini handled?

Belum tentu.

Pertanyaan:

- Apakah audit wajib untuk compliance?
- Jika audit gagal, apakah business operation boleh sukses?
- Apakah ada retry/outbox?
- Apakah ada alert?
- Apakah ada reconciliation?
- Apakah user/client perlu tahu?
- Apakah failure ini harus fail-closed?
- Apakah log warn cukup?

Kalau audit wajib, maka code di atas adalah reliability/security bug.

Handled berarti:

> Sistem sudah menentukan outcome yang benar, evidence yang benar, recovery path yang benar, dan blast radius yang dapat diterima.

Bukan sekadar catch.

---

## 14. “Logged” Does Not Mean “Observable”

Log error bukan otomatis observability.

Contoh log buruk:

```text
ERROR Something went wrong
java.lang.RuntimeException: failed
```

Masalah:

- tidak ada correlation id;
- tidak ada request id;
- tidak ada user/context aman;
- tidak ada dependency name;
- tidak ada business operation;
- tidak ada retry attempt;
- tidak ada duration;
- tidak ada error code;
- tidak ada state;
- tidak ada safe remediation hint;
- terlalu generic.

Log lebih berguna:

```text
level=ERROR
operation=SubmitApplication
applicationId=APP-123
correlationId=...
traceId=...
stateBefore=DRAFT
stateAfter=UNKNOWN
failureStage=OUTBOX_PUBLISH
exceptionClass=ExternalMessageBrokerTimeoutException
retryable=true
attempt=3
maxAttempts=3
outcome=PENDING_RECONCILIATION
```

Bahkan ini pun harus hati-hati agar tidak membocorkan PII/token/secret.

Observability berarti:

- log menjelaskan event penting;
- metric mengukur kesehatan;
- trace menunjukkan alur lintas service;
- alert memanggil manusia saat perlu;
- dashboard menunjukkan trend;
- runbook menjelaskan aksi;
- evidence cukup untuk rekonstruksi incident.

---

## 15. “Retry” Does Not Mean “Reliable”

Retry sering dianggap solusi universal. Padahal retry bisa memperburuk masalah.

Retry berbahaya jika:

- operation tidak idempotent;
- dependency sedang overload;
- banyak client retry bersamaan;
- tidak ada backoff/jitter;
- timeout terlalu panjang;
- retry dilakukan di banyak layer;
- error sebenarnya non-retriable;
- retry menyembunyikan incident;
- retry menambah duplicate side effect;
- retry membuat user menunggu terlalu lama;
- retry melanggar rate limit provider.

Retry hanya reliable jika dikombinasikan dengan:

- failure classification;
- idempotency;
- timeout budget;
- max attempts;
- backoff;
- jitter;
- circuit breaker;
- observability;
- retry budget;
- safe outcome.

Prinsip:

> Retry without idempotency is a data corruption amplifier.

---

## 16. “Transaction” Does Not Mean “Consistent”

Database transaction kuat, tetapi bukan jawaban untuk semua failure.

Transaction hanya menjamin hal tertentu dalam boundary tertentu.

Contoh:

```text
BEGIN
  update application status
  insert audit row
COMMIT
send email
publish event
return response
```

DB transaction bisa menjamin update status + audit row atomic jika keduanya di DB yang sama dan transaction boundary benar.

Tapi transaction tidak menjamin:

- email terkirim atomic dengan DB commit;
- event broker publish atomic dengan DB commit;
- external API call atomic dengan DB commit;
- response ke client atomic dengan DB commit;
- retry tidak duplicate;
- consumer downstream tidak gagal;
- read replica langsung konsisten;
- caller tahu apakah commit terjadi saat connection drop.

Maka kita perlu pattern seperti:

- outbox;
- inbox;
- idempotency key;
- reconciliation;
- compensation;
- state machine repair;
- pending/unknown state;
- manual recovery path.

---

## 17. “Graceful Shutdown” Does Not Mean “No Lost Work”

Graceful shutdown meningkatkan peluang work selesai dengan aman, tetapi tidak menjamin tidak ada lost work.

Kenapa?

Karena:

- process bisa menerima SIGKILL;
- node bisa mati;
- JVM bisa crash;
- OOM bisa terjadi;
- DB bisa disconnect;
- dependency bisa hang;
- grace period bisa habis;
- readiness propagation bisa delay;
- load balancer masih mengirim request;
- worker sudah mengambil message tapi belum ack;
- scheduler sedang di tengah batch;
- external API call status unknown;
- network disconnect setelah commit.

Maka shutdown-safe design membutuhkan:

- idempotency;
- checkpointing;
- ack-after-commit;
- outbox;
- deadline;
- cancellation;
- state marker;
- requeue/dead-letter;
- reconciliation;
- observability;
- readiness/draining state;
- tested SIGTERM behavior.

---

## 18. The Reliability Stack

Kita akan mempelajari reliability sebagai stack berlapis.

```text
┌───────────────────────────────────────────────┐
│ Human / Incident / Runbook / Postmortem        │
├───────────────────────────────────────────────┤
│ Observability: Logs / Metrics / Traces / Alert │
├───────────────────────────────────────────────┤
│ Recovery: Retry / Fallback / Compensation      │
├───────────────────────────────────────────────┤
│ Containment: Circuit Breaker / Bulkhead        │
├───────────────────────────────────────────────┤
│ Time Control: Timeout / Deadline / Cancel      │
├───────────────────────────────────────────────┤
│ Consistency: Transaction / Outbox / Idempotency│
├───────────────────────────────────────────────┤
│ Error Contracts: API / Domain / Exception      │
├───────────────────────────────────────────────┤
│ Language: Throwable / Exception / Error        │
├───────────────────────────────────────────────┤
│ Lifecycle: JVM / Spring / Container / K8s      │
└───────────────────────────────────────────────┘
```

Engineer yang hanya fokus di satu layer akan kehilangan gambaran.

Contoh:

- Mengerti Java exception tapi tidak mengerti transaction uncertainty → masih bisa corrupt data.
- Mengerti retry tapi tidak mengerti idempotency → duplicate side effect.
- Mengerti Spring graceful shutdown tapi tidak mengerti Kubernetes termination → request masih bisa terpotong.
- Mengerti logging tapi tidak mengerti alerting → incident terlambat diketahui.
- Mengerti circuit breaker tapi tidak mengerti fallback semantics → false success.

---

## 19. Scope of This Series

Seri ini akan mencakup:

### 19.1 Java exception engineering

- `Throwable`, `Exception`, `RuntimeException`, `Error`.
- Checked vs unchecked.
- Exception hierarchy design.
- Cause chain.
- Suppressed exceptions.
- Stack trace preservation.
- Exception translation.
- Domain exception.
- Technical exception.
- Retryable exception.
- Fatal exception.
- Boundary-specific exception.

### 19.2 Error contract engineering

- HTTP error response.
- Problem details style response.
- Stable error code.
- Field validation errors.
- Business conflict.
- Security-safe error.
- Supportability metadata.
- Correlation ID.
- Backward-compatible error schema.

### 19.3 Graceful shutdown engineering

- JVM shutdown.
- Shutdown hook.
- Daemon/non-daemon thread.
- Spring lifecycle.
- Embedded server graceful shutdown.
- Executor shutdown.
- Scheduler shutdown.
- Queue consumer shutdown.
- Kubernetes termination.
- Readiness/draining.
- Shutdown budget.
- Forced termination.

### 19.4 Reliability patterns

- Timeout.
- Deadline.
- Cancellation.
- Retry.
- Backoff.
- Jitter.
- Circuit breaker.
- Bulkhead.
- Rate limiter.
- Time limiter.
- Fallback.
- Degradation.
- Kill switch.
- Feature flag.

### 19.5 Consistency and recovery

- Transaction boundary.
- Commit uncertainty.
- Outbox.
- Inbox.
- Idempotency.
- Duplicate message.
- Saga.
- Compensation.
- Reconciliation.
- Unknown state.
- Manual recovery.

### 19.6 Observability and operations

- Structured logging.
- Metrics.
- Tracing.
- Alerting.
- Runbook.
- Incident reconstruction.
- Reliability review.
- Failure drills.
- Chaos experiment basics.

### 19.7 Testing reliability

- Exception tests.
- Contract tests.
- Fault injection.
- Timeout tests.
- Retry tests.
- Shutdown tests.
- Queue tests.
- Idempotency tests.
- Chaos/game day.

---

## 20. Non-Scope: What We Will Not Re-Teach

Agar efisien, seri ini tidak akan mengulang:

- syntax Java dasar;
- konsep class/interface/record dasar;
- collections/streams dasar;
- concurrency dasar;
- virtual thread dasar;
- reactive programming dasar;
- REST annotation dasar;
- Spring Boot starter dasar;
- JAX-RS annotation dasar;
- basic SQL CRUD;
- basic Docker/Kubernetes introduction;
- basic HTTP explanation.

Jika ada topik yang muncul, ia akan dibahas dari sudut:

> Apa failure mode-nya dan bagaimana membuatnya reliable?

Contoh:

- Kita tidak akan mengulang “apa itu thread”.
- Tapi kita akan membahas “apa yang terjadi jika executor masih punya task saat shutdown”.

- Kita tidak akan mengulang “apa itu transaction”.
- Tapi kita akan membahas “apa yang terjadi jika connection putus saat commit outcome belum diketahui”.

- Kita tidak akan mengulang “apa itu HTTP 400/500”.
- Tapi kita akan membahas “bagaimana error response menjadi machine-readable contract yang aman dan supportable”.

---

## 21. Learning Method for This Series

Cara membaca seri ini:

1. Jangan hafalkan pattern sebagai template.
2. Selalu mulai dari failure mode.
3. Tanyakan state apa yang berubah.
4. Tanyakan siapa caller-nya.
5. Tanyakan apakah retry aman.
6. Tanyakan apakah failure visible.
7. Tanyakan apakah shutdown bisa memotong flow.
8. Tanyakan apakah ada recovery path.
9. Tanyakan apakah behavior bisa dites.
10. Tanyakan apakah operator bisa memahami incident.

Setiap part akan menggunakan pola:

```text
Problem -> Mental Model -> Failure Mode -> Design Principle -> Java/Spring Implementation -> Anti-pattern -> Checklist
```

Tujuannya agar kamu tidak hanya tahu “cara pakai library”, tetapi bisa mendesain solusi ketika konteks berubah.

---

## 22. A Running Example Used Across the Series

Untuk membuat materi lebih konkret, kita akan sering memakai contoh domain:

> Case/Application Management Service

Service ini kira-kira punya operasi:

- create application;
- submit application;
- assign case officer;
- approve/reject application;
- upload document;
- write audit trail;
- publish domain event;
- call external profile service;
- send notification;
- process queued background task;
- generate report;
- expose REST API;
- run on Spring Boot inside Kubernetes.

Kenapa contoh ini bagus?

Karena ia punya hampir semua reliability concern:

- state machine;
- validation;
- authorization;
- audit;
- external dependency;
- database transaction;
- async event;
- duplicate submission;
- approval conflict;
- queue processing;
- shutdown behavior;
- compliance concern;
- incident reconstruction.

### 22.1 Example flow

```text
POST /applications/{id}/submit
        |
        v
Authenticate user
        |
        v
Authorize action
        |
        v
Validate command
        |
        v
Load application
        |
        v
Check current state == DRAFT
        |
        v
Change state to SUBMITTED
        |
        v
Persist application
        |
        v
Write audit trail
        |
        v
Create outbox event
        |
        v
Commit transaction
        |
        v
Return success
        |
        v
Async publisher publishes ApplicationSubmitted
        |
        v
Notification worker sends email
```

Failure scenarios:

| Stage | Failure | Key question |
|---|---|---|
| Authentication | token expired | should client refresh or login? |
| Authorization | insufficient role | fail closed? |
| Validation | missing required doc | 400 or domain 422? |
| State check | already submitted | idempotent success or 409? |
| Persist | optimistic lock conflict | refresh/retry? |
| Audit | insert failed | fail whole operation? |
| Outbox | insert failed | rollback operation? |
| Commit | connection lost | did commit happen? |
| Response | client disconnected | will client retry? |
| Publisher | broker timeout | retry/backoff/dead-letter? |
| Notification | email provider down | degrade or retry later? |
| Shutdown | SIGTERM mid-flow | what is safe outcome? |

Inilah jenis reasoning yang akan kita bangun.

---

## 23. The Error Handling Decision Matrix

Saat menghadapi failure, gunakan matrix ini.

### 23.1 Classification

| Question | Possible answers |
|---|---|
| Who caused it? | client, user, domain state, dependency, infra, bug, operator |
| Is it expected? | expected, exceptional, impossible |
| Is it recoverable? | by caller, by retry, by compensation, by operator, by developer |
| Is it retryable? | yes, no, later, only with idempotency, unknown |
| Did side effect happen? | no, yes, partially, unknown |
| Is data consistent? | yes, no, unknown, eventually |
| Should user know? | yes detail, yes generic, no immediate, async status |
| Should operator know? | no, metric only, alert, incident |
| Should system continue? | yes, degrade, stop local flow, stop accepting traffic, crash |
| Is security involved? | no, fail closed, redact, alert security |

### 23.2 Outcome mapping

| Failure type | Typical outcome |
|---|---|
| Invalid input | reject with validation detail |
| Invalid state transition | conflict/domain rejection |
| Unauthorized action | fail closed |
| Dependency timeout | retry if safe; otherwise unavailable |
| Rate limited | backoff/retry later |
| Duplicate command | return existing result or conflict |
| DB deadlock | retry bounded if operation idempotent/safe |
| Invariant breach | stop flow, alert, investigate |
| Audit failure | depends on compliance criticality; often fail/queue/reconcile |
| Queue consumer crash | re-deliver if ack not committed |
| Shutdown in progress | reject new work, drain existing work |
| Unknown commit | reconcile by business key/idempotency key |

---

## 24. Reliability Vocabulary We Will Use

### 24.1 Retriable

A failure is retriable if repeating the operation later has a reasonable chance to succeed **and** repeating it will not violate correctness.

Important:

> Retriable does not only mean “temporary”. It also requires “safe to repeat”.

### 24.2 Idempotent

An operation is idempotent if applying it multiple times has the same intended effect as applying it once.

But beware:

- HTTP method idempotency is not enough.
- Business idempotency needs business key/result semantics.
- Implementation idempotency needs storage/enforcement.

### 24.3 Deadline

A deadline is the maximum time budget by which an operation must complete.

Deadline is stronger than isolated timeout because it applies to the entire chain.

### 24.4 Timeout

Timeout is a local waiting limit.

Common mistake:

- Service A timeout = 30s.
- Service B timeout = 30s.
- DB timeout = 30s.
- HTTP gateway timeout = 30s.

This creates poor failure behavior because each layer waits too long.

### 24.5 Backpressure

Backpressure is the ability to slow down or reject input when the system cannot safely process more.

In reliability terms:

> Rejecting work early can be more reliable than accepting work that will fail later after consuming resources.

### 24.6 Bulkhead

Bulkhead isolates failure so one dependency or workload does not consume all resources.

Example:

- external profile service calls use separate pool;
- report generation does not starve login requests;
- slow notification provider does not block case submission.

### 24.7 Circuit breaker

Circuit breaker stops calling a dependency temporarily when recent behavior indicates likely failure.

Purpose:

- reduce latency waste;
- prevent overload amplification;
- give dependency time to recover;
- fail fast with controlled outcome.

### 24.8 Fallback

Fallback is an alternative behavior when primary path fails.

Fallback can be good:

- return cached public reference data;
- show “status pending”;
- queue notification for later.

Fallback can be dangerous:

- pretending approval succeeded;
- using stale compliance data;
- silently skipping audit;
- returning default permission as allowed.

### 24.9 Compensation

Compensation is a corrective action after a side effect already happened.

Example:

- reverse reservation;
- cancel previously created external record;
- mark application as pending manual review;
- emit correction event.

### 24.10 Reconciliation

Reconciliation is a process to compare expected state and actual state, then repair or escalate differences.

This is critical when distributed operations have unknown/partial outcome.

---

## 25. Production Failure Timeline Thinking

Every serious failure should be understandable as timeline.

Example:

```text
T0  User submits application
T1  API validates command
T2  DB transaction begins
T3  Application status updated to SUBMITTED
T4  Audit row inserted
T5  Outbox event inserted
T6  DB commit started
T7  Network disconnect occurs
T8  Server does not know if commit succeeded
T9  Client times out
T10 Client retries with same idempotency key
T11 Server detects existing committed result
T12 Server returns previous result
T13 Outbox publisher emits ApplicationSubmitted
T14 Notification worker sends email
```

Good design produces safe outcome.

Bad design:

```text
T10 Client retries
T11 Server submits again
T12 Duplicate audit
T13 Duplicate event
T14 Duplicate email
T15 Downstream creates duplicate case
```

The difference is not syntax. The difference is architecture.

---

## 26. Error Handling Anti-Patterns Preview

Kita akan membahas detailnya nanti, tetapi berikut preview anti-pattern yang akan sering muncul.

### 26.1 Catch and ignore

```java
catch (Exception ignored) {
}
```

Ini hampir selalu buruk kecuali ada justifikasi kuat dan observability lain.

### 26.2 Catch and log only

```java
catch (Exception e) {
    log.error("failed", e);
}
```

Bisa buruk jika flow lanjut seolah sukses.

### 26.3 Wrap everything as RuntimeException

```java
throw new RuntimeException(e);
```

Menghapus domain semantics jika dilakukan sembarangan.

### 26.4 Return null on failure

```java
catch (Exception e) {
    return null;
}
```

Mengubah explicit failure menjadi latent failure.

### 26.5 Boolean success flag without context

```java
return false;
```

Caller tidak tahu kenapa gagal, apakah retryable, apakah partial.

### 26.6 Generic 500

Semua error jadi `500 Internal Server Error`.

Menghilangkan client actionability.

### 26.7 Generic 200 with failed body

```json
{
  "success": false,
  "message": "failed"
}
```

Bisa merusak caching, monitoring, gateway behavior, client error handling.

### 26.8 Infinite retry

Retry tanpa batas bisa menyebabkan retry storm.

### 26.9 Retry non-idempotent command

Bisa membuat duplicate data/side effect.

### 26.10 Fallback fake success

Sistem terlihat sukses tetapi sebenarnya outcome bisnis salah.

### 26.11 Shutdown hook doing too much

Shutdown hook bukan tempat menjalankan logic kompleks tanpa deadline.

### 26.12 No shutdown test

Graceful shutdown yang tidak pernah dites biasanya hanya asumsi.

---

## 27. The Reliability Design Loop

Setiap kali mendesain fitur, gunakan loop ini.

```text
1. Define intended behavior
2. Identify state transitions
3. Identify side effects
4. Identify failure points
5. Classify failures
6. Define safe outcomes
7. Define error contract
8. Define retry/idempotency behavior
9. Define timeout/deadline behavior
10. Define shutdown behavior
11. Define observability
12. Define tests
13. Define operational runbook
```

### 27.1 Example: Submit Application

#### Intended behavior

Application berpindah dari `DRAFT` ke `SUBMITTED` satu kali.

#### State transition

```text
DRAFT -> SUBMITTED
```

#### Side effects

- DB update;
- audit write;
- outbox event;
- notification later.

#### Failure points

- validation failure;
- concurrent submit;
- DB conflict;
- audit failure;
- commit unknown;
- outbox publish failure;
- notification failure;
- shutdown mid-request.

#### Safe outcomes

- invalid command rejected;
- duplicate submit returns existing result or 409;
- DB conflict returns 409;
- audit failure fails operation or persists retryable audit event depending policy;
- outbox failure rolls back operation;
- commit unknown resolved by idempotency key;
- notification failure retried asynchronously;
- shutdown rejects new requests and drains in-flight request.

---

## 28. How This Series Will Treat Frameworks and Libraries

Frameworks are tools, not strategy.

Kita akan membahas Spring Boot, JAX-RS, Kubernetes, Resilience4j, logging, metrics, dan testing tools. Tetapi urutannya selalu:

```text
Failure mode first
Design decision second
Library configuration third
```

Bukan:

```text
Library feature first
Copy-paste config second
Hope it works third
```

Contoh:

- Jangan mulai dari “cara pakai circuit breaker”.
- Mulai dari “dependency failure mode apa yang ingin dibatasi?”

- Jangan mulai dari “cara set graceful shutdown”.
- Mulai dari “work apa yang sedang berjalan dan boleh dipotong kapan?”

- Jangan mulai dari “cara bikin global exception handler”.
- Mulai dari “error taxonomy apa yang ingin diekspos ke caller?”

---

## 29. A Note on Checked vs Unchecked Exceptions

Kita akan membahas ini detail di part 2 dan 3, tetapi perlu preview karena sering menjadi debat.

Checked exception bukan otomatis bagus.
Unchecked exception bukan otomatis buruk.

Yang penting:

- apakah caller bisa melakukan recovery bermakna?
- apakah exception bagian dari contract method?
- apakah exception menunjukkan environmental failure atau programming error?
- apakah menambahkan `throws` membuat API lebih jujur atau hanya noisy?
- apakah unchecked exception membuat failure tersembunyi?
- apakah wrapping menghilangkan cause?
- apakah domain semantics tetap terlihat?

Contoh:

- `InvalidStateTransitionException` mungkin unchecked tetapi domain-significant.
- `IOException` mungkin checked tetapi di boundary tertentu harus diterjemahkan menjadi `DocumentStorageUnavailableException`.
- `SQLException` biasanya tidak boleh bocor ke API/domain layer.
- `NullPointerException` biasanya bug/invariant breach, bukan business failure.

Prinsip:

> Pilihan checked vs unchecked adalah keputusan API contract, bukan preferensi gaya semata.

---

## 30. A Note on Fatal Errors

Java memiliki `Error` untuk kondisi serius yang biasanya tidak ditangani aplikasi biasa. Contoh umum termasuk error level VM/resource seperti `OutOfMemoryError` atau `StackOverflowError`.

Prinsip praktis:

- Jangan `catch (Throwable)` sembarangan.
- Jangan menelan `Error`.
- Jangan mencoba melanjutkan aplikasi setelah fatal corruption kecuali framework/container punya mekanisme khusus dan benar-benar aman.
- Gunakan top-level handler untuk logging/observability jika perlu, tetapi jangan pura-pura recovery bila proses sudah tidak trustworthy.

Akan dibahas detail nanti:

- apa yang boleh di-catch;
- apa yang harus dibiarkan crash;
- bagaimana crash bisa menjadi pilihan yang lebih reliable daripada continuing corrupted process;
- bagaimana orchestrator restart berperan;
- bagaimana membedakan crash-only design dan graceful degradation.

---

## 31. A Note on Regulatory and Audit-Sensitive Systems

Dalam sistem biasa, beberapa failure mungkin boleh degrade.

Dalam sistem regulatory/case management, failure tertentu tidak boleh disembunyikan.

Contoh:

- audit trail gagal;
- approval state berubah tanpa evidence;
- authorization check gagal ambiguous;
- external identity verification timeout;
- case assignment duplicate;
- document integrity check gagal;
- notification legal deadline gagal;
- report generation memakai data stale;
- manual override tidak tercatat.

Untuk sistem seperti ini, error handling harus mempertimbangkan:

- defensibility;
- traceability;
- non-repudiation;
- audit completeness;
- least privilege;
- fail-closed behavior;
- evidence preservation;
- manual recovery path;
- reconciliation report.

Prinsip:

> Dalam sistem regulatory, false success sering lebih buruk daripada visible failure.

---

## 32. The Three Planes of Reliability

Kita akan memakai tiga plane.

### 32.1 Code plane

Pertanyaan:

- exception apa yang dilempar?
- catch di mana?
- transaction boundary di mana?
- timeout di mana?
- retry di mana?
- resource close di mana?

### 32.2 System plane

Pertanyaan:

- dependency apa yang bisa gagal?
- queue backlog bagaimana?
- pod shutdown bagaimana?
- load balancer routing bagaimana?
- database pool saturation bagaimana?
- duplicate request bagaimana?
- distributed state bagaimana?

### 32.3 Operations plane

Pertanyaan:

- metric apa yang naik?
- alert apa yang muncul?
- log cukup tidak?
- runbook tersedia tidak?
- manual retry aman tidak?
- reconciliation ada tidak?
- user impact bisa dihitung tidak?

Top-tier engineer berpikir di tiga plane sekaligus.

---

## 33. Minimal Reliability Principles for the Whole Series

Ini prinsip yang akan berulang di seluruh part.

### Principle 1 — Preserve meaning

Jangan ubah semua failure menjadi generic exception.

### Principle 2 — Preserve cause

Jangan hilangkan root cause chain.

### Principle 3 — Preserve outcome

Pastikan caller tahu apakah operasi berhasil, gagal, pending, partial, duplicate, atau unknown.

### Principle 4 — Preserve evidence

Pastikan failure penting punya log/metric/trace/audit yang cukup.

### Principle 5 — Bound waiting

Semua operasi remote/blocking harus punya timeout/deadline.

### Principle 6 — Bound retry

Retry harus bounded, classified, observed, dan idempotent.

### Principle 7 — Bound concurrency

Lindungi sistem dari overload dengan bulkhead, pool, queue limit, dan rate limit.

### Principle 8 — Bound blast radius

Satu dependency lambat tidak boleh menjatuhkan seluruh service.

### Principle 9 — Do not fake success

Fallback tidak boleh menghasilkan outcome palsu yang melanggar domain.

### Principle 10 — Shutdown is part of correctness

Deployment, scale down, dan termination adalah bagian dari normal operation, bukan edge case langka.

### Principle 11 — Unknown is a valid state

Kadang sistem tidak tahu apakah commit/external side effect terjadi. Modelkan `UNKNOWN`/`PENDING_RECONCILIATION`, jangan mengarang certainty.

### Principle 12 — Test the bad path

Happy path tidak membuktikan reliability.

---

## 34. How to Think Like a Top 1% Engineer in This Topic

Top-tier engineer tidak hanya bertanya:

> Bagaimana membuat kode ini jalan?

Mereka bertanya:

1. Bagaimana kode ini gagal?
2. Bagaimana kegagalan ini terlihat?
3. Bagaimana kegagalan ini menyebar?
4. Bagaimana kegagalan ini berhenti?
5. Bagaimana sistem pulih?
6. Bagaimana data tetap benar?
7. Bagaimana user/client tahu aksi berikutnya?
8. Bagaimana operator tahu apa yang terjadi?
9. Bagaimana kita membuktikan behavior ini lewat test?
10. Bagaimana behavior ini bertahan saat deployment/scale down/restart?

Mereka juga sadar bahwa reliability adalah trade-off.

Contoh trade-off:

| Decision | Benefit | Risk |
|---|---|---|
| Fail fast | menghemat resource, cepat terlihat | bisa menurunkan availability |
| Retry | mengatasi transient failure | bisa memperparah overload/duplicate |
| Fallback | meningkatkan availability | bisa menghasilkan stale/incorrect data |
| Fail closed | aman untuk security/compliance | bisa menghambat user legitimate |
| Fail open | menjaga availability | bisa melanggar security/domain |
| Long timeout | memberi dependency waktu | mengikat thread/connection lebih lama |
| Short timeout | cepat fail/recover | bisa false timeout |
| Async processing | respons cepat | outcome delayed/partial |
| Strong transaction | consistency lokal | tidak menyelesaikan side effect eksternal |

Top-tier bukan berarti selalu memilih opsi paling strict.

Top-tier berarti memilih opsi yang sesuai dengan:

- domain criticality;
- user impact;
- data correctness;
- security;
- latency;
- operability;
- cost;
- complexity;
- recovery capability.

---

## 35. Part 000 Checklist

Sebelum lanjut ke part 001, pastikan kamu bisa menjawab ini:

1. Apa bedanya exception, error, failure, fault, dan incident?
2. Kenapa `catch` tidak sama dengan handled?
3. Kenapa log tidak otomatis berarti observable?
4. Kenapa retry bisa berbahaya?
5. Kenapa transaction tidak otomatis menjamin distributed consistency?
6. Kenapa graceful shutdown tidak otomatis menjamin no lost work?
7. Apa empat pertanyaan utama saat failure terjadi?
8. Apa hubungan antara side effect dan retry safety?
9. Kenapa failure semantics harus survive antar-layer?
10. Kenapa shutdown adalah consistency problem?
11. Apa bedanya code plane, system plane, dan operations plane?
12. Apa arti “unknown outcome” dan kenapa harus dimodelkan?
13. Kenapa false success bisa lebih buruk daripada visible failure?
14. Apa yang harus dipikirkan sebelum memilih fallback?
15. Apa yang harus dipikirkan sebelum memilih fail-open/fail-closed?

Jika jawabanmu sudah masuk akal, kamu siap masuk ke Part 001.

---

## 36. What Comes Next

Part berikutnya:

# Part 001 — Mental Model of Failure: Dari Bug ke Reliability Engineering

Kita akan membahas lebih dalam:

- fault vs error vs failure;
- active failure vs latent failure;
- local failure vs systemic failure;
- failure propagation;
- blast radius;
- graceful degradation;
- reliability as stateful design;
- why “works on my machine” tidak relevan untuk production reliability;
- bagaimana membangun failure model untuk satu fitur sebelum coding.

---

## 37. Series Progress

Status seri:

```text
Part 000 / 030 completed
```

Seri belum selesai. Ini adalah bagian orientasi awal.

---

## 38. References

Rujukan utama yang menjadi anchor seri:

1. Oracle Java SE 25 API — `Throwable`, `Exception`, `RuntimeException`, dan exception hierarchy.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Throwable.html

2. Oracle Java SE 25 API — `RuntimeException` sebagai unchecked exception.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/RuntimeException.html

3. The Java Language Specification, Java SE 25 Edition — Chapter 11 Exceptions dan language-level exception rules.  
   https://docs.oracle.com/javase/specs/jls/se25/html/index.html

4. Spring Boot Reference Documentation — Graceful Shutdown.  
   https://docs.spring.io/spring-boot/reference/web/graceful-shutdown.html

5. Kubernetes Documentation — Container Lifecycle Hooks, `PreStop`, `TERM`, dan `terminationGracePeriodSeconds`.  
   https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dsa-part-030 — Capstone: Designing a Production-Grade Rule, Workflow, and Case Indexing Engine](../dsa/learn-java-dsa-part-030.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-001.md](./learn-java-reliability-part-001.md)
