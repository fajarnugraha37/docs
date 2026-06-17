# learn-java-bpmn-camunda-process-orchestration-engineering

# Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior

> Seri: Java BPMN, Camunda, and Process Orchestration Engineering  
> Level: Advanced  
> Target: Java 8 hingga Java 25  
> Fokus: BPMN timers, SLA, timeout, expiry, reminder, escalation, scheduled behavior, business calendar, timezone, production reliability

---

## 0. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- BPMN sebagai execution contract.
- Camunda 7 vs Camunda 8.
- Zeebe runtime internals.
- Java client dan job worker.
- Reliability worker.
- Process variables.
- Error, incident, escalation, compensation.
- Human workflow.
- DMN.
- Message correlation dan event-driven process design.

Sekarang kita masuk ke salah satu aspek yang kelihatannya sederhana tetapi sering menjadi sumber bug production: **waktu**.

Dalam workflow system, waktu bukan hanya `LocalDateTime.now()`.

Waktu bisa berarti:

- kapan task harus mulai dikerjakan;
- kapan task harus selesai;
- kapan reminder dikirim;
- kapan SLA dianggap breach;
- kapan aplikasi expired;
- kapan external response dianggap timeout;
- kapan retry teknis boleh dicoba lagi;
- kapan proses recurring dijalankan;
- kapan compensation otomatis dipicu;
- kapan case harus dinaikkan ke officer lain;
- kapan process instance harus dibatalkan;
- kapan keputusan policy berubah karena effective date;
- kapan dokumen dianggap kadaluarsa;
- kapan timer harus tetap benar walaupun timezone, DST, holiday, deployment, atau migration berubah.

Top engineer tidak melihat timer sebagai “delay node”. Top engineer melihat timer sebagai **business temporal contract**.

---

## 1. Mental Model: Time Is a Business State Transition

Dalam aplikasi CRUD, waktu sering muncul sebagai field:

```text
application.submissionDeadline
application.expiryDate
case.slaDueAt
task.dueAt
payment.expiredAt
```

Lalu ada scheduler atau cron job yang mengecek:

```sql
select *
from application
where status = 'PENDING_PAYMENT'
  and payment_expired_at < now();
```

Itu valid untuk beberapa kebutuhan. Tetapi dalam BPMN/Camunda, waktu bisa menjadi bagian eksplisit dari process flow:

```text
Submit Application
  -> Wait for Payment
       boundary timer 3 days
          -> Mark Application Expired
```

Perbedaan mental model-nya:

```text
CRUD scheduler:
  Time is checked from outside the process.

BPMN timer:
  Time is part of the process execution contract.
```

BPMN timer membuat temporal behavior terlihat dalam model. Orang bisnis, developer, QA, dan auditor bisa melihat bahwa setelah 3 hari pembayaran tidak diterima, proses pindah ke jalur expiry.

Tetapi konsekuensinya juga besar:

- Timer menjadi state runtime yang harus dikelola engine.
- Timer harus dipikirkan saat process versioning.
- Timer harus dipikirkan saat process migration.
- Timer harus dipikirkan saat cluster recovery.
- Timer harus dipikirkan saat volume besar.
- Timer harus dipikirkan saat business calendar tidak sama dengan calendar duration.

Jadi aturan awal:

> Gunakan BPMN timer ketika waktu adalah bagian dari kontrak proses.  
> Gunakan scheduler/query ketika waktu hanya maintenance atau bulk housekeeping.

---

## 2. Timer, Timeout, SLA, Expiry: Jangan Disamakan

Banyak desain workflow menjadi kacau karena semua hal temporal disebut “SLA”. Padahal berbeda.

| Konsep | Makna | Contoh | Efek Process |
|---|---|---|---|
| Timer | BPMN event yang menunggu waktu tertentu | wait 2 days | token lanjut saat waktu tercapai |
| Timeout | batas waktu untuk menunggu aktivitas/event | external response tidak datang dalam 5 hari | jalur alternatif/cancel/escalate |
| SLA | komitmen layanan atau target business performance | officer harus review dalam 3 working days | breach tracking/escalation/reporting |
| Expiry | masa berlaku business object habis | payment link expired | process/entity berubah state |
| Reminder | notifikasi sebelum/selama overdue | email reminder H-1 | biasanya non-interrupting |
| Retry delay | jeda sebelum retry technical failure | retry external API after 10 min | bukan SLA, bukan business timeout |
| Schedule | trigger process secara periodik | nightly reconciliation | timer start / external scheduler |
| Follow-up date | kapan task sebaiknya mulai diperhatikan | start review by tomorrow | task prioritization |
| Due date | kapan task seharusnya selesai | complete by Friday 5 PM | deadline/queue ordering/SLA indicator |

Kesalahan umum:

```text
Semua deadline dimodelkan sebagai interrupting boundary timer.
```

Akibatnya:

- task tiba-tiba hilang dari user;
- process auto-cancel padahal bisnis hanya butuh reminder;
- officer kehilangan konteks kerja;
- audit trail sulit dijelaskan;
- user menganggap sistem “menghapus pekerjaan saya”.

Alternatif yang lebih matang:

```text
Due date:
  untuk prioritas dan reporting.

Non-interrupting timer:
  untuk reminder/escalation tanpa menghentikan task.

Interrupting timer:
  untuk hard timeout yang memang membatalkan aktivitas.
```

---

## 3. Timer Events dalam BPMN

BPMN menyediakan beberapa bentuk timer event:

1. Timer start event.
2. Intermediate timer catch event.
3. Timer boundary event.
4. Event subprocess dengan timer start.

Camunda mendokumentasikan bahwa intermediate timer catch event dapat memakai time duration atau time date, dan timer event membuat proses menunggu sampai titik waktu tertentu atau durasi tertentu berlalu. Boundary event dipakai untuk merespons event saat activity masih aktif; contoh umum adalah menempelkan timer ke user task untuk mengirim reminder ketika task terlalu lama dikerjakan.

### 3.1 Timer Start Event

Timer start event memulai process instance berdasarkan schedule.

Contoh:

```text
Every day at 01:00
  -> Start Daily Reconciliation Process
```

Cocok untuk:

- recurring reconciliation;
- daily report generation;
- scheduled notification campaign;
- periodic compliance check;
- monthly billing cycle;
- certificate expiry scan.

Tidak cocok untuk:

- high-frequency polling setiap beberapa detik;
- batch besar yang lebih cocok memakai scheduler khusus;
- distributed cron dengan hard exactly-once expectation tanpa idempotency;
- logic yang membutuhkan complex business calendar di luar kemampuan timer expression.

Mental model:

```text
Timer start event creates process instances.
It is not merely a sleep inside an existing instance.
```

### 3.2 Intermediate Timer Catch Event

Intermediate timer catch event membuat process instance menunggu.

Contoh:

```text
Send Reminder Email
  -> Wait 2 Days
  -> Send Final Reminder
  -> Wait 1 Day
  -> Expire Application
```

Cocok untuk:

- deliberate waiting;
- cooling-off period;
- grace period;
- wait before escalation;
- wait until effective date;
- staggered notification.

Runtime mental model:

```text
Token arrives at timer event.
Engine registers timer.
Process instance becomes waiting.
When timer fires, token continues.
```

### 3.3 Timer Boundary Event

Timer boundary event ditempelkan pada activity.

Contoh:

```text
User Task: Review Application
  boundary timer after 3 working days
     -> Escalate to Supervisor
```

Boundary timer punya dua jenis utama:

1. Interrupting boundary timer.
2. Non-interrupting boundary timer.

#### Interrupting Boundary Timer

Interrupting timer menghentikan activity yang ditempelinya.

Contoh:

```text
Wait for Payment
  interrupting boundary timer 3 days
     -> Expire Payment
```

Makna:

```text
Kalau payment tidak selesai dalam 3 hari,
aktivitas menunggu payment dihentikan,
dan process pindah ke jalur expiry.
```

Cocok untuk hard timeout:

- payment window habis;
- OTP expired;
- external agency response window ditutup;
- user tidak submit document sampai deadline final;
- application automatically withdrawn setelah grace period.

Risiko:

- activity dibatalkan;
- user task bisa hilang;
- external event yang datang terlambat harus ditangani;
- perlu audit reason yang jelas.

#### Non-interrupting Boundary Timer

Non-interrupting timer tidak menghentikan activity utama. Ia membuat token tambahan.

Contoh:

```text
User Task: Review Application
  non-interrupting boundary timer every 1 day
     -> Send Reminder
```

Makna:

```text
Review task tetap aktif.
Setiap interval tertentu, sistem menjalankan reminder/escalation side path.
```

Cocok untuk:

- reminder;
- escalation notice;
- dashboard alert;
- aging notification;
- supervisor visibility;
- SLA breach tagging.

Risiko:

- token bertambah;
- side path bisa berjalan berkali-kali;
- reminder bisa spam;
- harus ada dedup/rate limit;
- harus ada limit berapa kali reminder dikirim.

### 3.4 Timer Event Subprocess

Event subprocess dapat dipakai untuk menangkap timer dalam scope tertentu.

Contoh:

```text
Application Review Subprocess
  event subprocess timer every 1 day
     -> Recompute SLA Aging
     -> Notify if Required
```

Cocok jika temporal behavior berlaku untuk seluruh scope, bukan hanya satu task.

Tetapi jangan berlebihan. Event subprocess bisa membuat model lebih sulit dibaca jika dipakai untuk hal-hal kecil.

---

## 4. Timer Expression: Date, Duration, Cycle

Secara konseptual timer biasanya punya tiga bentuk:

1. **Date** — waktu absolut.
2. **Duration** — durasi relatif sejak token masuk.
3. **Cycle** — berulang.

### 4.1 Date

Date berarti timer fire pada waktu tertentu.

Contoh:

```text
2026-06-30T17:00:00+07:00
```

Cocok untuk:

- deadline absolut;
- effective date;
- cut-off policy;
- expiry date yang sudah dihitung sebelumnya;
- hearing date;
- scheduled activation.

Pattern:

```text
Compute expiryDate in domain/service layer
Store as process variable
Use timer date = expiryDate
```

Lebih baik menghitung complex business deadline di Java/domain service daripada memaksa semua logika calendar ke BPMN expression.

### 4.2 Duration

Duration berarti timer fire setelah durasi tertentu sejak token sampai.

Contoh konseptual:

```text
PT30M  -> 30 minutes
P3D    -> 3 days
```

Cocok untuk:

- wait 10 minutes before retry business step;
- wait 3 days after request sent;
- cooling-off period;
- short timeout;
- reminder relative to task creation.

Bahaya:

```text
P3D means calendar duration, not necessarily 3 working days.
```

Kalau bisnis berkata “3 working days”, jangan langsung pakai `P3D`.

### 4.3 Cycle

Cycle berarti timer berulang.

Contoh:

```text
Every day until condition is met
Every Monday at 8 AM
Repeat 3 times every 1 day
```

Cocok untuk:

- recurring reminders;
- periodic check;
- repeated poll with business interval;
- scheduled batch process.

Bahaya:

- bisa membuat banyak timer aktif;
- bisa memicu banyak process instance;
- bisa spam external system;
- bisa tetap jalan walaupun kondisi bisnis sudah tidak relevan jika tidak dimodelkan dengan benar.

---

## 5. SLA Modeling: SLA Bukan Hanya Timer

SLA biasanya terdiri dari beberapa dimensi:

```text
SLA = target + start condition + stop condition + calendar + owner + consequence
```

Contoh SLA buruk:

```text
Review must be done in 3 days.
```

Contoh SLA yang bisa dieksekusi:

```text
Initial review SLA:
- starts when application status becomes SUBMITTED
- excludes weekends and public holidays
- stops when officer submits review decision
- target: 3 working days
- owner: Review Team
- breach consequence: supervisor notification and dashboard breach flag
- hard timeout: no automatic cancellation
```

Perhatikan dua hal:

1. SLA breach belum tentu membatalkan task.
2. SLA biasanya butuh reporting, bukan hanya process routing.

### 5.1 SLA Start Condition

SLA bisa mulai dari:

- process instance started;
- user task created;
- document received;
- payment confirmed;
- officer assigned;
- application submitted;
- external agency request sent;
- case reopened.

Jika start condition ambigu, semua dashboard SLA akan diperdebatkan.

### 5.2 SLA Stop Condition

SLA bisa berhenti saat:

- user task completed;
- decision submitted;
- case closed;
- response received;
- payment received;
- application withdrawn;
- task reassigned;
- clock paused.

Harus jelas apakah SLA berhenti saat user klik “save draft” atau hanya saat “submit final decision”. Biasanya bukan save draft.

### 5.3 SLA Pause Condition

Banyak proses regulatory punya “clock stop”:

```text
Officer requests additional documents.
Applicant is waiting to respond.
Agency SLA pauses.
```

Model naive:

```text
Review Task with 3-day timer
```

Masalah:

- jika officer request document di hari kedua, timer tetap jalan;
- SLA breach muncul padahal menunggu applicant;
- audit defensibility lemah.

Model lebih baik:

```text
Review Application
  -> Need More Documents?
       yes -> Request Additional Documents
              -> Wait Applicant Submission
              -> Resume Review with recalculated SLA
       no  -> Complete Review
```

SLA state disimpan eksplisit:

```json
{
  "sla": {
    "reviewStartedAt": "2026-06-17T09:00:00+07:00",
    "pausedAt": "2026-06-18T15:00:00+07:00",
    "remainingWorkingMinutes": 720,
    "dueAt": "2026-06-22T17:00:00+07:00",
    "calendar": "SG_BUSINESS_CALENDAR_V2026"
  }
}
```

Top engineer tidak hanya membuat timer. Ia membuat **SLA accounting model**.

---

## 6. Due Date dan Follow-up Date pada User Task

Dalam Camunda Tasklist, task dapat memakai due date dan follow-up date untuk membantu user memprioritaskan pekerjaan. Dokumentasi Camunda menjelaskan follow-up date sebagai waktu paling lambat task sebaiknya mulai dikerjakan, sedangkan due date adalah deadline kapan task seharusnya selesai.

Perbedaan:

| Field | Makna | Efek |
|---|---|---|
| Follow-up date | mulai diperhatikan | queue visibility/prioritization |
| Due date | deadline selesai | sorting, reporting, SLA indicator |
| Boundary timer | process transition | reminder/escalation/cancel |

Kesalahan umum:

```text
Karena sudah ada due date, tidak perlu timer.
```

Belum tentu. Due date hanya metadata task. Kalau setelah due date harus ada aksi otomatis, tetap perlu BPMN timer atau external SLA monitor.

Kesalahan lain:

```text
Karena ada timer, tidak perlu due date.
```

Belum tentu. Timer membuat transition, tetapi user tetap butuh queue ordering dan deadline visibility.

Pattern yang baik:

```text
User Task: Review Application
  followUpDate = when officer should start
  dueDate      = business deadline
  non-interrupting boundary timer at dueDate - 1 day -> Send Reminder
  non-interrupting boundary timer at dueDate         -> Escalate Breach
```

---

## 7. Timeout Pattern

Timeout adalah batas waktu untuk menunggu sesuatu.

Ada beberapa jenis timeout.

### 7.1 Human Task Timeout

Contoh:

```text
Review Application
  non-interrupting timer after 2 days -> Reminder
  non-interrupting timer after 3 days -> Escalate
  interrupting timer after 10 days -> Reassign to Supervisor Queue
```

Di sini:

- 2 hari: reminder;
- 3 hari: breach/escalation;
- 10 hari: hard transition.

Jangan langsung membatalkan task pada SLA breach pertama.

### 7.2 External Response Timeout

Contoh:

```text
Send Request to External Agency
  -> Wait for External Response
       interrupting boundary timer 14 days
          -> Mark External Response Timeout
          -> Manual Review
```

Di sini timer adalah hard timeout karena proses tidak boleh menunggu selamanya.

Tetapi harus ada late message handling:

```text
If response arrives after timeout:
  - reject as stale?
  - attach to case as late response?
  - reopen manual review?
  - ignore but audit?
```

Jangan biarkan late message menjadi incident misterius.

### 7.3 Payment Timeout

Contoh:

```text
Create Payment Request
  -> Wait for Payment Confirmation
       interrupting boundary timer paymentExpiredAt
          -> Expire Payment
          -> Notify Applicant
```

Late payment confirmation harus ditangani:

```text
If payment received after expiry:
  - check payment provider settlement status
  - refund?
  - mark exception?
  - manual finance review?
```

### 7.4 Technical Call Timeout

Ini berbeda dari BPMN timer.

Contoh:

```java
httpClient.callExternalApi(timeout = 5 seconds)
```

Kalau call timeout, worker bisa `failJob` dengan retry backoff.

Jangan modelkan HTTP socket timeout sebagai BPMN boundary timer kecuali memang proses bisnis perlu melihatnya sebagai langkah eksplisit.

```text
Technical timeout:
  worker-level timeout + retry backoff

Business timeout:
  BPMN timer / SLA model
```

---

## 8. Retry Backoff vs Timer Event

Camunda job worker dapat gagal dan menentukan retry/backoff. Camunda menjelaskan bahwa retry backoff menunda retry job agar external system punya waktu untuk recovery; jika retry habis, incident dapat dibuat.

Ini berbeda dari BPMN timer.

| Aspek | Job Retry Backoff | BPMN Timer |
|---|---|---|
| Tujuan | technical recovery | business temporal behavior |
| Terlihat di diagram | biasanya tidak | ya |
| Aktor | worker/engine job retry | process model |
| Contoh | external API down, retry in 10 min | applicant has 7 days to respond |
| Jika gagal terus | incident | alternate process path |

Contoh salah:

```text
External API down -> BPMN timer 10 min -> retry service task -> timer -> retry service task
```

Ini membuat BPMN penuh retry teknis.

Lebih baik:

```text
Service Task: Send to External API
  worker failJob(retries = 5, retryBackoff = 10 minutes)
  if retries exhausted -> incident
```

Contoh saat BPMN timer memang tepat:

```text
Send request to agency
  -> Wait for response up to 14 calendar days
```

Itu business timeout, bukan technical retry.

---

## 9. Business Calendar Problem

Salah satu jebakan terbesar:

```text
P3D != 3 working days
```

Business calendar bisa melibatkan:

- weekend;
- public holiday;
- agency-specific holiday;
- half-day;
- office hours;
- cut-off time;
- timezone;
- emergency closure;
- region-specific calendar;
- policy effective date;
- daylight saving time di negara tertentu.

Untuk Indonesia mungkin DST tidak umum, tetapi sistem enterprise/regulatory sering berinteraksi dengan negara lain, cloud region lain, atau user timezone lain.

### 9.1 Calendar Duration vs Working Duration

Calendar duration:

```text
Submitted Monday 10:00 + P3D = Thursday 10:00
```

Working duration:

```text
Submitted Friday 16:00 + 3 working days
= Wednesday 16:00 if weekend excluded
```

Jika ada public holiday Selasa:

```text
= Thursday 16:00
```

### 9.2 Jangan Masukkan Semua Business Calendar ke BPMN

BPMN expression bukan tempat terbaik untuk complex calendar logic.

Pattern lebih baik:

```text
Java Domain Service:
  calculateDueAt(startAt, slaPolicy, calendarId)

Process Variable:
  reviewDueAt

BPMN Timer:
  wait until reviewDueAt
```

Keuntungan:

- logic testable di Java;
- policy versioning jelas;
- calendar table bisa dikelola;
- audit bisa menyimpan `calendarId` dan `policyVersion`;
- BPMN tetap readable.

### 9.3 Calendar Versioning

Jangan hanya simpan:

```json
{
  "dueAt": "2026-06-22T17:00:00+07:00"
}
```

Untuk audit, simpan juga:

```json
{
  "slaPolicyCode": "INITIAL_REVIEW_3_WORKING_DAYS",
  "slaPolicyVersion": "2026.1",
  "calendarId": "ID_BUSINESS_CALENDAR_2026",
  "calculatedAt": "2026-06-17T09:05:00+07:00",
  "dueAt": "2026-06-22T17:00:00+07:00"
}
```

Jika nanti ada sengketa, sistem bisa menjawab:

```text
Kenapa due date-nya tanggal itu?
```

---

## 10. Timezone Engineering

Dalam Java modern, gunakan tipe waktu secara disiplin.

### 10.1 Tipe Java yang Relevan

| Type | Gunakan Untuk | Catatan |
|---|---|---|
| `Instant` | titik waktu universal | bagus untuk storage/event timestamp |
| `OffsetDateTime` | timestamp dengan offset | bagus untuk API contract |
| `ZonedDateTime` | waktu dengan timezone region | bagus untuk business calendar |
| `LocalDate` | tanggal tanpa waktu | bagus untuk effective date/hari kerja |
| `LocalDateTime` | tanggal+waktu tanpa zone | berbahaya untuk distributed system jika tidak ada konteks zone |
| `Duration` | durasi machine time | 5 minutes, 24 hours |
| `Period` | durasi calendar date | 3 days, 1 month |

Rule praktis:

```text
Persist event timestamp as Instant.
Expose API deadline as OffsetDateTime.
Calculate business calendar with ZonedDateTime + ZoneId.
Avoid storing ambiguous LocalDateTime without zone context.
```

### 10.2 Deadline dengan Zone

Deadline seperti ini ambigu:

```text
2026-06-30T17:00:00
```

Lebih baik:

```text
2026-06-30T17:00:00+07:00
```

atau simpan:

```json
{
  "dueAt": "2026-06-30T10:00:00Z",
  "businessZone": "Asia/Jakarta",
  "displayDueAt": "2026-06-30T17:00:00+07:00"
}
```

### 10.3 DST dan Region Zone

Walaupun Indonesia tidak memakai DST, jangan biasakan hanya memakai offset tetap jika sistem bisa lintas region.

```text
+07:00 is offset.
Asia/Jakarta is zone.
```

Zone membawa aturan calendar/time historis dan masa depan.

Untuk business calendar, `ZoneId` lebih defensible daripada offset mentah.

---

## 11. Timer Explosion Anti-pattern

Timer explosion terjadi saat terlalu banyak timer aktif atau terlalu banyak timer firing hampir bersamaan.

Contoh:

```text
100,000 active user tasks
Each has:
- reminder timer every day
- escalation timer every day
- SLA breach timer
- final timeout timer
```

Hasil:

```text
400,000+ timer subscriptions
Large daily firing burst
Many notification jobs
Worker spike
Email provider spike
Operate noise
```

### 11.1 Penyebab Timer Explosion

- recurring timer per process instance;
- non-interrupting boundary timer tanpa stop condition;
- process per row untuk bulk data;
- reminder every hour untuk ribuan case;
- timer start event terlalu sering;
- all deadlines at same time, e.g. midnight;
- migration/redeployment restart timer behavior yang tidak dipahami;
- no batching.

### 11.2 Mitigasi

#### Spread Deadline / Jitter

Daripada semua reminder jam 00:00:

```text
distribute reminder between 08:00-10:00 based on hash(caseId)
```

#### Use Due Date for Queue, Not Timer for Everything

Jika hanya untuk sorting, due date cukup.

#### Central SLA Monitor

Untuk beberapa reporting/escalation massal, external SLA monitor bisa lebih efisien:

```text
Scheduler queries task_due table
  -> sends batched reminder
  -> publishes escalation command if needed
```

BPMN timer tetap dipakai untuk hard process transition.

#### Limit Reminder Count

Simpan:

```json
{
  "reminderCount": 2,
  "maxReminderCount": 3,
  "lastReminderSentAt": "..."
}
```

#### Avoid Per-Minute Process Timers

Jika butuh high-frequency scheduling, gunakan scheduler khusus, queue delay, atau stream processing. BPMN engine bukan general-purpose timer wheel untuk semua micro-delay.

---

## 12. Reminder Pattern

Reminder biasanya tidak boleh mengganggu activity utama.

Pattern:

```text
User Task: Submit Additional Documents
  non-interrupting boundary timer after 3 days
     -> Send Reminder #1
  non-interrupting boundary timer after 6 days
     -> Send Reminder #2
  interrupting boundary timer after 10 days
     -> Mark as No Response
```

Atau:

```text
Request Additional Documents
  -> Wait for Applicant Submission
       non-interrupting timer cycle every 2 days up to 3 times
          -> Send Reminder
       interrupting timer at finalDeadline
          -> Withdraw Application
```

Poin penting:

- reminder harus idempotent;
- reminder harus punya dedup key;
- reminder harus menyimpan audit;
- reminder tidak boleh dikirim setelah task selesai;
- reminder tidak boleh spam jika process migration/retry terjadi;
- reminder content harus menjelaskan deadline.

Idempotency key contoh:

```text
REMINDER:{processInstanceKey}:{elementInstanceKey}:{reminderType}:{reminderNo}
```

---

## 13. Escalation Pattern

Escalation bisa berarti:

1. Memberi tahu supervisor.
2. Memindahkan task ke queue lain.
3. Menambah candidate group.
4. Membuat task tambahan untuk supervisor.
5. Mencatat SLA breach.
6. Menaikkan priority.
7. Mengubah owner.
8. Mengubah process path.

Jangan langsung menganggap escalation harus interrupting.

### 13.1 Soft Escalation

```text
Review Task active
  non-interrupting boundary timer at dueAt
     -> Notify Supervisor
     -> Mark SLA Breached
```

Task tetap aktif.

### 13.2 Ownership Escalation

```text
Review Task active
  timer after 5 days
     -> Add Supervisor Candidate Group
     -> Increase Priority
```

Task tetap sama tetapi visibilitas berubah.

### 13.3 Hard Escalation

```text
Review Task active
  interrupting timer after 10 days
     -> Cancel Officer Task
     -> Create Supervisor Review Task
```

Ini mengubah ownership secara keras. Harus ada audit reason.

---

## 14. Expiry Pattern

Expiry berarti business object tidak lagi valid.

Contoh:

- payment link expired;
- application draft expired;
- document request expired;
- temporary approval expired;
- license renewal window expired;
- appeal submission window closed.

Expiry biasanya lebih kuat daripada reminder.

### 14.1 Payment Expiry

```text
Create Payment Request
  -> Wait Payment Confirmation
       interrupting timer at paymentExpiredAt
          -> Expire Payment Request
          -> Notify Applicant
          -> End / Manual Finance Check
```

State domain:

```text
PaymentRequest.status = EXPIRED
Application.status = PENDING_PAYMENT_EXPIRED
```

Process state dan domain state harus sinkron secara idempotent.

### 14.2 Draft Expiry

Untuk draft application, mungkin BPMN tidak selalu cocok.

Jika draft belum masuk formal process, lebih baik scheduler/domain lifecycle:

```text
Draft Application Table
  status = DRAFT
  expired_at < now
```

BPMN process biasanya dimulai setelah submission formal.

Jangan memulai process instance untuk semua draft jika tidak ada process orchestration nyata.

### 14.3 Appeal Window Expiry

Appeal window bisa dihitung dari notification served date.

```text
Decision Issued
  -> Wait Appeal Submission until appealDeadline
       message: Appeal Submitted -> Start Appeal Process
       timer: appealDeadline -> Close Appeal Window
```

Late appeal submission harus punya policy:

- reject automatically;
- allow with justification;
- route to manual assessment;
- create exceptional appeal process.

---

## 15. Scheduled Process Behavior

Scheduled process berarti proses dimulai atau aktivitas dipicu berdasarkan jadwal.

### 15.1 Timer Start Event vs External Scheduler

Gunakan timer start event jika schedule adalah bagian dari process landscape.

Contoh:

```text
Monthly License Expiry Notification Process
```

Gunakan external scheduler jika:

- membutuhkan complex distributed scheduling;
- membutuhkan batch partitioning besar;
- membutuhkan dependency dengan data warehouse;
- membutuhkan backfill/replay besar;
- job lebih data-processing daripada business process.

### 15.2 Scheduled Process Idempotency

Scheduled process harus tetap idempotent.

Contoh risiko:

```text
Daily process started twice.
```

Mitigasi:

```text
business key = processName + businessDate
unique constraint on schedule_run(process_name, business_date)
```

Contoh:

```text
DAILY_RECONCILIATION:2026-06-17
```

### 15.3 Catch-up Behavior

Jika engine down saat schedule seharusnya fire, apa yang terjadi?

Desain bisnis harus menjawab:

- skip missed run?
- run immediately after recovery?
- run all missed intervals?
- run only latest?
- manual trigger?

Jangan hanya berharap engine/scheduler default behavior cocok dengan bisnis.

---

## 16. Modeling SLA for Regulatory Case Management

Contoh domain:

```text
Application submitted.
Officer must perform initial review within 3 working days.
If additional documents required, SLA pauses until applicant responds.
Applicant has 14 calendar days to submit documents.
Reminder sent on day 7 and day 12.
If no response by day 14, application is withdrawn.
If officer misses SLA, supervisor is notified but officer task remains active.
```

### 16.1 Naive BPMN

```text
Submit Application
  -> Review Application
       timer 3 days -> Escalate
  -> Request Documents
       timer 14 days -> Withdraw
```

Masalah:

- 3 working days tidak sama dengan 3 calendar days;
- SLA pause tidak jelas;
- reminder tidak jelas;
- due date tidak terlihat pada task;
- officer SLA dan applicant deadline tercampur;
- escalation interrupting/tidak interrupting tidak jelas;
- late document submission tidak ditangani.

### 16.2 Better Model

```text
Application Submitted
  -> Compute Initial Review SLA
  -> User Task: Initial Review
       dueDate = initialReviewDueAt
       non-interrupting timer at initialReviewDueAt
          -> Mark SLA Breached
          -> Notify Supervisor
  -> Gateway: Need Additional Documents?
       No  -> Continue Assessment
       Yes -> Request Additional Documents
             -> Compute Applicant Response Deadline
             -> Wait Applicant Submission
                  non-interrupting timer at reminder1At -> Send Reminder 1
                  non-interrupting timer at reminder2At -> Send Reminder 2
                  interrupting timer at applicantDeadline -> Withdraw Application
                  message event ApplicantDocumentsSubmitted -> Resume Review
```

### 16.3 Supporting Data Model

```sql
create table case_sla_clock (
  id bigint primary key,
  case_id varchar(64) not null,
  process_instance_key varchar(64),
  sla_type varchar(64) not null,
  policy_code varchar(128) not null,
  policy_version varchar(32) not null,
  calendar_id varchar(64) not null,
  started_at timestamp with time zone not null,
  paused_at timestamp with time zone,
  resumed_at timestamp with time zone,
  due_at timestamp with time zone not null,
  breached_at timestamp with time zone,
  stopped_at timestamp with time zone,
  status varchar(32) not null,
  created_at timestamp with time zone not null,
  updated_at timestamp with time zone not null
);
```

Process variable cukup menyimpan pointer/ringkasan:

```json
{
  "caseId": "CASE-2026-000123",
  "initialReviewDueAt": "2026-06-22T17:00:00+07:00",
  "initialReviewSlaClockId": 88123,
  "applicantResponseDeadline": "2026-07-06T23:59:59+07:00"
}
```

---

## 17. Java Deadline Calculation Pattern

Contoh service untuk menghitung working deadline.

```java
public interface BusinessCalendar {
    ZonedDateTime addWorkingDuration(
            ZonedDateTime start,
            Duration workingDuration,
            String calendarId
    );

    boolean isWorkingTime(ZonedDateTime time, String calendarId);

    ZonedDateTime nextWorkingTime(ZonedDateTime time, String calendarId);
}
```

Policy object:

```java
public final class SlaPolicy {
    private final String code;
    private final String version;
    private final String calendarId;
    private final Duration targetWorkingDuration;
    private final ZoneId zoneId;

    public SlaPolicy(
            String code,
            String version,
            String calendarId,
            Duration targetWorkingDuration,
            ZoneId zoneId
    ) {
        this.code = code;
        this.version = version;
        this.calendarId = calendarId;
        this.targetWorkingDuration = targetWorkingDuration;
        this.zoneId = zoneId;
    }

    public String code() { return code; }
    public String version() { return version; }
    public String calendarId() { return calendarId; }
    public Duration targetWorkingDuration() { return targetWorkingDuration; }
    public ZoneId zoneId() { return zoneId; }
}
```

Calculator:

```java
public final class SlaDeadlineCalculator {
    private final BusinessCalendar businessCalendar;

    public SlaDeadlineCalculator(BusinessCalendar businessCalendar) {
        this.businessCalendar = businessCalendar;
    }

    public SlaDeadline calculateInitialReviewDeadline(
            Instant submittedAt,
            SlaPolicy policy
    ) {
        ZonedDateTime start = submittedAt.atZone(policy.zoneId());
        ZonedDateTime normalizedStart = businessCalendar.nextWorkingTime(
                start,
                policy.calendarId()
        );

        ZonedDateTime dueAt = businessCalendar.addWorkingDuration(
                normalizedStart,
                policy.targetWorkingDuration(),
                policy.calendarId()
        );

        return new SlaDeadline(
                policy.code(),
                policy.version(),
                policy.calendarId(),
                normalizedStart.toInstant(),
                dueAt.toInstant(),
                policy.zoneId().getId()
        );
    }
}
```

DTO:

```java
public final class SlaDeadline {
    private final String policyCode;
    private final String policyVersion;
    private final String calendarId;
    private final Instant startedAt;
    private final Instant dueAt;
    private final String zoneId;

    public SlaDeadline(
            String policyCode,
            String policyVersion,
            String calendarId,
            Instant startedAt,
            Instant dueAt,
            String zoneId
    ) {
        this.policyCode = policyCode;
        this.policyVersion = policyVersion;
        this.calendarId = calendarId;
        this.startedAt = startedAt;
        this.dueAt = dueAt;
        this.zoneId = zoneId;
    }

    public String policyCode() { return policyCode; }
    public String policyVersion() { return policyVersion; }
    public String calendarId() { return calendarId; }
    public Instant startedAt() { return startedAt; }
    public Instant dueAt() { return dueAt; }
    public String zoneId() { return zoneId; }
}
```

Process variable mapping:

```java
Map<String, Object> variables = new HashMap<>();
variables.put("initialReviewDueAt", deadline.dueAt().toString());
variables.put("initialReviewSlaPolicyCode", deadline.policyCode());
variables.put("initialReviewSlaPolicyVersion", deadline.policyVersion());
variables.put("initialReviewCalendarId", deadline.calendarId());
variables.put("initialReviewZoneId", deadline.zoneId());
```

Prinsipnya:

```text
Complex temporal calculation belongs in tested Java code.
BPMN receives the calculated timestamp as execution contract.
```

---

## 18. Java Worker Pattern: Compute Deadline Step

```java
public final class ComputeInitialReviewSlaWorker {

    private final SlaDeadlineCalculator calculator;
    private final SlaPolicyRepository policyRepository;
    private final CaseSlaClockRepository slaClockRepository;

    public ComputeInitialReviewSlaWorker(
            SlaDeadlineCalculator calculator,
            SlaPolicyRepository policyRepository,
            CaseSlaClockRepository slaClockRepository
    ) {
        this.calculator = calculator;
        this.policyRepository = policyRepository;
        this.slaClockRepository = slaClockRepository;
    }

    public Map<String, Object> handle(WorkflowJobView job) {
        String caseId = job.getVariableAsString("caseId");
        Instant submittedAt = Instant.parse(job.getVariableAsString("submittedAt"));

        SlaPolicy policy = policyRepository.findActivePolicy("INITIAL_REVIEW");
        SlaDeadline deadline = calculator.calculateInitialReviewDeadline(submittedAt, policy);

        CaseSlaClock clock = slaClockRepository.createIfAbsent(
                caseId,
                "INITIAL_REVIEW",
                deadline.policyCode(),
                deadline.policyVersion(),
                deadline.calendarId(),
                deadline.startedAt(),
                deadline.dueAt(),
                job.getProcessInstanceKey()
        );

        Map<String, Object> result = new HashMap<>();
        result.put("initialReviewDueAt", deadline.dueAt().toString());
        result.put("initialReviewSlaClockId", clock.id());
        result.put("initialReviewSlaPolicyVersion", deadline.policyVersion());
        result.put("initialReviewCalendarId", deadline.calendarId());
        return result;
    }
}
```

`createIfAbsent` penting untuk idempotency.

Jika worker dieksekusi dua kali, jangan membuat dua SLA clock untuk case yang sama.

Unique constraint:

```sql
unique(case_id, sla_type, process_instance_key)
```

---

## 19. Timer and Process Versioning

Timer menjadi rumit saat BPMN berubah.

Contoh:

```text
Version 1:
  Review task has timer after 5 days.

Version 2:
  Review task has timer after 3 days.
```

Pertanyaan:

- Running instances lama ikut aturan baru atau tetap aturan lama?
- Timer existing reset atau tidak?
- Due date dihitung ulang atau tidak?
- SLA policy version mana yang dipakai untuk audit?
- Jika process migration dilakukan, apa yang terjadi pada active timers?

Camunda docs tentang process instance migration menunjukkan timer boundary event punya konsekuensi saat migration; dalam beberapa skenario timer duration/cycle bisa perlu perhatian khusus agar behavior tidak berubah tak disengaja.

Prinsip:

```text
Process version controls flow.
Policy version controls business deadline calculation.
```

Jangan hanya bergantung pada BPMN duration literal seperti `P3D` jika policy sering berubah.

Lebih defensible:

```text
BPMN: wait until variable reviewDueAt
Java policy service: calculates reviewDueAt with policy version
```

Dengan begitu running instance membawa due date yang sudah dihitung berdasarkan policy saat itu.

---

## 20. Timer and Migration Checklist

Sebelum migrate process instance yang punya timer aktif, tanyakan:

1. Timer mana yang sedang aktif?
2. Timer itu date, duration, atau cycle?
3. Apakah target model punya event yang sama?
4. Apakah timer akan dipertahankan, direset, atau dihitung ulang?
5. Apakah SLA policy berubah?
6. Apakah task due date berubah?
7. Apakah reminder count ikut terbawa?
8. Apakah non-interrupting timer bisa menggandakan side effect?
9. Apakah late event/message masih bisa dikorelasikan?
10. Apakah audit mencatat migration reason?

Migration tanpa temporal analysis sering menghasilkan bug yang baru terlihat beberapa hari/minggu kemudian.

---

## 21. Timer and Incident Handling

Timer sendiri biasanya bukan incident. Tetapi timer bisa memicu path yang menghasilkan job failure.

Contoh:

```text
Timer fires
  -> Send Reminder Email job
       email provider down
       retry exhausted
       incident created
```

Runbook harus menjawab:

- apakah reminder boleh dikirim terlambat?
- apakah reminder boleh di-skip?
- apakah retry akan mengirim duplicate email?
- apakah due date sudah lewat?
- apakah task masih aktif?
- apakah case sudah closed?

Worker reminder harus melakukan guard:

```java
if (!caseService.isStillWaitingForApplicant(caseId)) {
    return Map.of("reminderSkippedReason", "CASE_NO_LONGER_WAITING");
}

if (notificationRepository.alreadySent(reminderKey)) {
    return Map.of("reminderSkippedReason", "DUPLICATE_REMINDER");
}
```

Jangan hanya mengirim email karena timer fire.

Timer fire berarti “waktu tercapai”, bukan berarti side effect masih valid.

---

## 22. Late Event After Timeout

Ini kasus production yang sangat umum.

Scenario:

```text
Process waits for payment confirmation until 23:59.
Timer fires at 23:59 and expires payment.
Payment provider sends confirmation at 00:01.
```

Jika tidak dirancang, hasilnya:

- message correlation fails;
- payment is paid but application expired;
- finance reconciliation mismatch;
- user complains;
- manual database patch;
- audit weak.

Pattern:

```text
Inbound Payment Event Router
  -> check payment request status
       WAITING_PAYMENT -> correlate to process
       EXPIRED         -> create late payment exception
       COMPLETED       -> dedup / ignore
       CANCELLED       -> refund/manual review
```

Late event jangan langsung dianggap error teknis. Ia adalah business event yang perlu policy.

---

## 23. Timer, Message, and Race Conditions

Timer dan message sering race.

Contoh:

```text
At 10:00:00 deadline fires.
At 10:00:00 response message arrives.
```

Mana yang menang?

Engine akan memproses berdasarkan ordering internal, tetapi bisnis harus siap dengan dua kemungkinan.

Pattern:

1. Gunakan authoritative domain state.
2. Gunakan idempotent transition.
3. Simpan event timestamp.
4. Evaluasi policy berdasarkan effective time.
5. Jangan hanya berdasarkan urutan processing.

Contoh:

```text
If applicant submitted before deadline timestamp:
  accept even if message processed after timer.

If applicant submitted after deadline timestamp:
  route to late submission policy.
```

Jadi event payload harus membawa:

```json
{
  "submittedAt": "2026-07-01T16:59:30+07:00",
  "receivedBySystemAt": "2026-07-01T17:00:05+07:00"
}
```

Pertanyaan bisnis:

```text
Deadline based on user submitted time or system received time?
```

Harus dijawab eksplisit.

---

## 24. Observability untuk Timer dan SLA

Timer/SLA perlu observability khusus.

Metrics:

```text
active_timer_count
fired_timer_count
expired_process_count
sla_due_soon_count
sla_breached_count
reminder_sent_count
reminder_skipped_count
late_message_count
scheduled_process_started_count
scheduled_process_duplicate_count
```

Logs harus punya:

```text
caseId
processInstanceKey
elementInstanceKey
timerType
dueAt
firedAt
businessDeadline
policyVersion
calendarId
reminderKey
escalationType
```

Dashboard penting:

- tasks due today;
- tasks overdue;
- SLA breach by team;
- average time to complete task;
- timer fired but side effect failed;
- late event after timeout;
- upcoming deadline volume;
- reminder volume per day;
- process instances waiting by timer type.

Alerting:

```text
If timer-fired jobs fail > threshold -> alert.
If due tasks > capacity -> alert.
If late event count spikes -> investigate integration delay.
If scheduled process duplicate > 0 -> investigate idempotency/scheduler.
```

---

## 25. Testing Timer Behavior

Timer behavior harus dites dengan scenario, bukan hanya unit test biasa.

### 25.1 Unit Test Calendar Logic

Test:

- weekend excluded;
- holiday excluded;
- start outside working hour;
- start near end of day;
- half-day;
- timezone;
- policy version;
- leap year;
- month boundary.

### 25.2 Process Path Test

Test:

- timer fires and moves process;
- message arrives before timer;
- message arrives after timer;
- non-interrupting timer sends reminder but task remains active;
- interrupting timer cancels task;
- recurring timer stops after max reminder;
- SLA breach path does not duplicate notification;
- process migration preserves expected deadline.

### 25.3 Worker Test

Test:

- reminder idempotency;
- side effect skipped if case closed;
- duplicate timer execution;
- email provider failure;
- retry exhaustion;
- late event policy;
- audit record creation.

### 25.4 Clock Control

Dalam Java, jangan panggil `Instant.now()` langsung di mana-mana.

Gunakan `Clock`:

```java
public final class DeadlineService {
    private final Clock clock;

    public DeadlineService(Clock clock) {
        this.clock = clock;
    }

    public Instant now() {
        return Instant.now(clock);
    }
}
```

Test:

```java
Clock fixedClock = Clock.fixed(
    Instant.parse("2026-06-17T02:00:00Z"),
    ZoneId.of("Asia/Jakarta")
);
```

Ini membuat temporal logic deterministic.

---

## 26. Common Design Smells

### Smell 1: Semua SLA Dimodelkan sebagai Interrupting Timer

Gejala:

- task hilang saat due;
- user bingung;
- supervisor tidak bisa melihat pekerjaan lama;
- audit mengatakan task cancelled padahal hanya overdue.

Perbaikan:

```text
Use due date + non-interrupting timer for breach.
Use interrupting timer only for hard timeout.
```

### Smell 2: Working Day Menggunakan P3D

Gejala:

- Jumat submit, Senin breach;
- public holiday tidak dihitung;
- bisnis tidak percaya dashboard.

Perbaikan:

```text
Calculate business due date in Java calendar service.
Use timer date with calculated dueAt.
```

### Smell 3: Reminder Cycle Tanpa Limit

Gejala:

- email spam;
- notification storm;
- active token growth.

Perbaikan:

```text
Limit reminder count.
Check current domain state before sending.
Use dedup key.
```

### Smell 4: Timer Dipakai untuk Technical Retry

Gejala:

- BPMN penuh loop retry;
- error technical terlihat sebagai business path;
- diagram sulit dibaca.

Perbaikan:

```text
Use job retry backoff for technical failures.
Use BPMN timer for business time behavior.
```

### Smell 5: Deadline Tidak Punya Policy Version

Gejala:

- tidak bisa menjelaskan kenapa due date dihitung demikian;
- dispute audit;
- policy berubah dan running case ambigu.

Perbaikan:

```text
Store policyCode, policyVersion, calendarId, calculatedAt, dueAt.
```

### Smell 6: Late Event Tidak Dimodelkan

Gejala:

- message correlation failure;
- finance mismatch;
- manual DB update.

Perbaikan:

```text
Inbound event router handles WAITING / EXPIRED / CLOSED / DUPLICATE states.
```

### Smell 7: Scheduled Process Tanpa Business Key

Gejala:

- daily process jalan dua kali;
- duplicate report/email/reconciliation.

Perbaikan:

```text
Use businessDate + processName as idempotency key.
```

---

## 27. Decision Matrix: BPMN Timer vs Scheduler vs Due Date vs Retry Backoff

| Kebutuhan | Pilihan Utama | Alasan |
|---|---|---|
| Task perlu deadline terlihat di queue | Due date | metadata prioritas task |
| Task perlu reminder tapi tetap aktif | Non-interrupting boundary timer | side path tanpa cancel task |
| Task harus batal setelah deadline | Interrupting boundary timer | hard timeout |
| External response ditunggu maksimal N hari | Boundary timer pada wait state | business timeout |
| External API down retry 10 menit | Job retry backoff | technical retry |
| Daily reconciliation | Timer start atau scheduler | tergantung business process vs batch |
| Bulk expiry draft | Scheduler/query | draft belum formal process |
| 3 working days SLA | Java calendar service + timer date/due date | calendar logic testable |
| Reminder ke 100k cases | central SLA monitor/batching | hindari timer explosion |
| Appeal window close | BPMN timer date | legal/business deadline eksplisit |

---

## 28. Production Checklist

Sebelum memakai timer/SLA dalam BPMN, jawab ini:

### Business Semantics

- Apa event yang memulai clock?
- Apa event yang menghentikan clock?
- Apakah clock bisa pause?
- Apakah deadline calendar day atau working day?
- Apakah timezone sudah jelas?
- Apakah deadline hard atau soft?
- Apa konsekuensi saat breach?
- Apa konsekuensi saat late message?
- Apakah user action sebelum deadline tapi diproses setelah deadline diterima?

### BPMN Design

- Timer start, intermediate, boundary, atau event subprocess?
- Interrupting atau non-interrupting?
- Date, duration, atau cycle?
- Apakah timer path punya audit reason?
- Apakah reminder path punya dedup?
- Apakah timer bisa menyebabkan token explosion?
- Apakah late event path dimodelkan?

### Java Engineering

- Deadline dihitung dengan `Clock` yang bisa dites?
- Menggunakan `Instant`, `OffsetDateTime`, `ZonedDateTime` dengan benar?
- Business calendar punya version?
- Worker idempotent?
- Reminder dedup key jelas?
- Scheduled process punya business key?
- Retry technical memakai retry backoff, bukan BPMN loop?

### Operations

- Ada dashboard due/overdue?
- Ada alert timer-fired job failure?
- Ada report active timers?
- Ada runbook late event?
- Ada runbook failed reminder?
- Ada strategy migration timer?
- Ada capacity estimate untuk timer volume?

### Audit

- Due date calculation bisa dijelaskan?
- Policy version disimpan?
- Calendar ID disimpan?
- Breach timestamp disimpan?
- Reminder/escalation audit disimpan?
- Manual override reason disimpan?

---

## 29. Mental Model Akhir

Timer dalam BPMN bukan “sleep”.

Timer adalah:

```text
a temporal business commitment encoded into process execution.
```

SLA bukan hanya timer.

SLA adalah:

```text
a measured responsibility with start, stop, calendar, owner, target, and consequence.
```

Timeout bukan selalu SLA.

Timeout adalah:

```text
a limit on waiting.
```

Expiry bukan reminder.

Expiry adalah:

```text
a business state transition caused by time.
```

Retry backoff bukan BPMN timer.

Retry backoff adalah:

```text
technical recovery delay for failed jobs.
```

Top 1% engineer akan mendesain temporal behavior dengan pertanyaan seperti:

```text
What exactly does time mean here?
Who owns the clock?
What starts it?
What stops it?
Can it pause?
Which calendar applies?
What happens if the timer and message race?
What happens if the event is late?
Can this fire 100,000 times at once?
Can we explain this deadline two years later?
```

Kalau pertanyaan-pertanyaan ini dijawab, timer berubah dari sumber bug menjadi bagian kuat dari process contract.

---

## 30. Ringkasan

Dalam Part 13 ini kita mempelajari:

- perbedaan timer, timeout, SLA, expiry, reminder, retry backoff, schedule;
- timer start event;
- intermediate timer catch event;
- timer boundary event;
- interrupting vs non-interrupting timer;
- timer date, duration, cycle;
- due date dan follow-up date;
- SLA start/stop/pause;
- business calendar;
- timezone engineering;
- timer explosion;
- reminder pattern;
- escalation pattern;
- expiry pattern;
- scheduled process behavior;
- regulatory SLA modeling;
- Java deadline calculation;
- process versioning dan timer migration;
- late event after timeout;
- timer/message race condition;
- observability;
- testing temporal behavior;
- design smells;
- production checklist.

Bagian berikutnya akan masuk ke **parallelism dan concurrency di BPMN**: multi-instance, parallel gateway, inclusive gateway, fan-out/fan-in, quorum approval, N-of-M decision, concurrency control, rate limiting, dan cara menghindari thundering herd dalam process orchestration.

---

## 31. Status Seri

Selesai:

- Part 0 — Orientation: Dari CRUD Engineer ke Process Orchestration Engineer
- Part 1 — BPMN 2.0 Deep Semantics: Bukan Diagram, Tapi Execution Contract
- Part 2 — BPMN Core Elements: Events, Tasks, Gateways, Subprocesses
- Part 3 — BPMN Modeling Discipline: Membuat Process Model yang Bisa Hidup di Production
- Part 4 — Camunda Landscape: Camunda 7 vs Camunda 8
- Part 5 — Camunda 8 Runtime Internals: Zeebe Mental Model
- Part 6 — Java Client Engineering: From API Call to Production-grade Worker
- Part 7 — Job Worker Reliability: Idempotency, Retry, Backoff, Poison Jobs
- Part 8 — Process Variables: Data Contract, Scope, Serialization, and Governance
- Part 9 — BPMN Error, Technical Failure, Incident, Escalation, and Compensation
- Part 10 — Human Workflow: User Task, Assignment, Forms, SLA, and Authorization
- Part 11 — DMN and Decision Engineering: Separating Flow from Decision Logic
- Part 12 — Message Correlation and Event-driven Process Design
- Part 13 — Timers, SLA, Timeout, Expiry, and Scheduled Process Behavior

Belum selesai. Berikutnya:

- Part 14 — Multi-instance, Parallelism, Fan-out/Fan-in, and Concurrency Control
