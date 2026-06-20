# learn-java-camunda-7-bpm-platform-engineering-part-014

# Timers, Due Dates, Time Zones, Calendar Semantics, dan SLA Modelling

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `014`  
> Topik: Timer events, due date, time zone, recurrence, SLA/escalation, dan operational correctness di Camunda 7  
> Target: Java engineer yang ingin memahami timer Camunda 7 sebagai durable scheduling mechanism, bukan sekadar ikon jam di BPMN.

---

## 0. Posisi Bagian Ini di Dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- `part-003`: transaction boundary dan wait state.
- `part-004`: async continuation dan job lifecycle.
- `part-005`: job executor internals.
- `part-013`: message correlation dan race condition.

Bagian ini menyambungkan semuanya ke **waktu**.

Di sistem workflow enterprise, waktu bukan detail kecil. Waktu menentukan:

- kapan proses dimulai otomatis,
- kapan user task dianggap overdue,
- kapan reminder dikirim,
- kapan SLA dilanggar,
- kapan case dieskalasi,
- kapan approval window ditutup,
- kapan proses harus auto-close,
- kapan retry berikutnya boleh dilakukan,
- dan kapan regulator/auditor menganggap organisasi gagal memenuhi kewajiban.

Camunda 7 menyediakan timer event, tetapi engineer senior harus memahami satu hal penting:

> Timer Camunda bukan realtime alarm. Timer Camunda adalah **database-backed due job** yang dieksekusi oleh Job Executor setelah eligible untuk diambil.

Kalimat itu akan menjadi mental model utama bagian ini.

---

## 1. Mental Model Utama: Timer = Durable Job dengan Due Date

Timer event di BPMN terlihat seperti event khusus. Namun di runtime Camunda 7, timer direpresentasikan sebagai **job**.

Secara konseptual:

```text
BPMN timer event
    -> engine creates timer job
    -> job row persisted in ACT_RU_JOB
    -> job has DUE_DATE_
    -> Job Executor periodically queries acquirable jobs
    -> if due and unlocked, job is locked
    -> job is executed
    -> process execution continues
```

Artinya, timer tidak “berjalan” di memory thread khusus per process instance. Tidak ada satu Java thread tidur selama 3 hari menunggu SLA. Yang ada adalah row database dengan due date.

Mental model yang benar:

```text
Timer = durable scheduling instruction stored in DB.
Due date = earliest time the job may be acquired.
Job Executor = polling/acquisition/execution mechanism.
Execution time = due date + acquisition delay + queue delay + execution delay.
```

Jadi bila timer due pada `10:00:00`, bukan berarti activity berikutnya pasti mulai tepat `10:00:00.000`. Itu berarti job menjadi eligible pada waktu tersebut. Eksekusi aktual bergantung pada:

- Job Executor aktif atau tidak,
- acquisition cycle,
- database load,
- jumlah job lain,
- priority/order setting,
- thread pool availability,
- lock contention,
- node cluster health,
- clock/timezone consistency,
- transaction commit sebelumnya.

Di production workflow, ini bukan kelemahan. Ini trade-off sengaja: durability dan recoverability lebih penting daripada realtime precision.

---

## 2. Tiga Bentuk Definisi Timer

Camunda 7 mendukung tiga bentuk timer definition pada BPMN timer event:

1. `timeDate`
2. `timeDuration`
3. `timeCycle`

Satu timer definition harus memilih tepat satu dari tiga bentuk tersebut.

---

## 3. `timeDate`: Waktu Absolut

`timeDate` berarti timer akan fire pada tanggal dan waktu tertentu.

Contoh:

```xml
<intermediateCatchEvent id="waitUntilSubmissionDeadline">
  <timerEventDefinition>
    <timeDate>2026-07-01T17:00:00Z</timeDate>
  </timerEventDefinition>
</intermediateCatchEvent>
```

Makna:

```text
Saat execution mencapai event ini, engine membuat timer job dengan due date absolut 2026-07-01 17:00 UTC.
```

Gunakan `timeDate` untuk:

- deadline absolut,
- submission cutoff,
- go-live date,
- embargo date,
- scheduled enforcement date,
- fixed expiry date,
- appointment date,
- regulatory deadline yang sudah dihitung sebelumnya.

Jangan gunakan `timeDate` untuk:

- delay relatif “3 hari setelah task dibuat”,
- recurring schedule,
- reminder berulang,
- SLA yang tergantung business calendar kompleks kecuali due date sudah dihitung external.

### 3.1 `timeDate` Harus Jelas Zona Waktunya

Ini sangat penting.

Lebih aman:

```xml
<timeDate>2026-07-01T17:00:00Z</timeDate>
```

atau:

```xml
<timeDate>2026-07-01T17:00:00+07:00</timeDate>
```

Berisiko:

```xml
<timeDate>2026-07-01T17:00:00</timeDate>
```

Tanpa timezone, interpretasi bergantung pada default timezone JVM yang menjalankan engine. Dalam cluster, ini bisa menjadi bencana bila node berbeda timezone.

Rule praktis:

> Untuk platform enterprise, simpan dan jadwalkan due date internal dalam UTC. Tampilkan ke user dalam timezone lokal di UI.

---

## 4. `timeDuration`: Delay Relatif

`timeDuration` berarti timer akan fire setelah durasi tertentu dari saat execution mencapai timer.

Contoh:

```xml
<intermediateCatchEvent id="waitThreeDays">
  <timerEventDefinition>
    <timeDuration>P3D</timeDuration>
  </timerEventDefinition>
</intermediateCatchEvent>
```

Makna:

```text
Saat token tiba di event ini, engine menghitung due date = now + 3 hari.
```

Contoh lain:

```xml
<timeDuration>PT15M</timeDuration>
<timeDuration>PT2H</timeDuration>
<timeDuration>P10D</timeDuration>
<timeDuration>P2W</timeDuration>
```

Gunakan `timeDuration` untuk:

- wait for 15 minutes,
- reminder 2 jam setelah assignment,
- timeout 3 hari setelah submission,
- grace period 14 hari setelah notice,
- auto-escalation setelah activity tertentu.

Kelebihan:

- natural untuk SLA relatif,
- mudah dimengerti,
- tidak membutuhkan external due date computation bila aturan sederhana.

Kekurangan:

- bukan business calendar-aware secara otomatis,
- `P3D` berarti 3 calendar days, bukan 3 business days,
- DST/timezone bisa memengaruhi interpretasi bila tidak disiplin timezone,
- sulit untuk aturan seperti “3 working days excluding public holiday”.

---

## 5. `timeCycle`: Recurrence

`timeCycle` berarti timer berulang.

Ada dua bentuk umum:

1. ISO 8601 repeating interval.
2. Cron expression.

Contoh ISO repeating interval:

```xml
<timerEventDefinition>
  <timeCycle>R3/PT10H</timeCycle>
</timerEventDefinition>
```

Makna umum:

```text
Repeat 3 times, every 10 hours.
```

Contoh cron style:

```xml
<timerEventDefinition>
  <timeCycle>0 0/5 * * * ?</timeCycle>
</timerEventDefinition>
```

Makna:

```text
Fire every 5 minutes, at second 0.
```

Perhatikan: cron Camunda/Spring-style memiliki field detik di depan, sehingga simbol pertama adalah **seconds**, bukan minutes seperti Unix cron biasa.

Gunakan `timeCycle` untuk:

- recurring process start,
- scheduled batch process,
- periodic reminder,
- repeated escalation,
- polling-like workflow yang memang dimodelkan sebagai process.

Namun gunakan dengan hati-hati. Timer cycle yang salah bisa menciptakan ribuan process instance/job.

---

## 6. Timer Start Event

Timer start event membuat process instance secara otomatis pada waktu tertentu.

Contoh sekali jalan:

```xml
<startEvent id="startAtFixedDate">
  <timerEventDefinition>
    <timeDate>2026-07-01T00:00:00Z</timeDate>
  </timerEventDefinition>
</startEvent>
```

Contoh berulang:

```xml
<startEvent id="startEveryDay">
  <timerEventDefinition>
    <timeCycle>0 0 0 * * ?</timeCycle>
  </timerEventDefinition>
</startEvent>
```

Mental model:

```text
Deploy process definition
    -> timer start job is scheduled
    -> Job Executor fires due timer
    -> engine creates process instance
```

Timer start event bukan dipanggil oleh `runtimeService.startProcessInstanceByKey()`. Timer start event dijadwalkan saat deployment.

Konsekuensi penting:

- Deploy process definition baru bisa membuat timer start baru.
- Jika ada banyak version active, perlu paham bagaimana start timer dari definition lama dan baru dikelola.
- Process manual start tetap bisa dilakukan via API bila process punya timer start event; itu akan membuat instance tambahan.
- Jangan deploy ulang process timer start tanpa memahami duplicate schedule risk.

### 6.1 Timer Start untuk Batch

Timer start sering dipakai untuk batch process.

Contoh:

```text
Every day at 01:00 UTC:
  start archival candidate scan
  fetch eligible cases
  create batch command or child process per case
```

Pertanyaan desain:

- Apakah satu process instance mewakili satu batch run?
- Apakah satu process instance mewakili satu business entity?
- Bagaimana mencegah overlapping run bila run sebelumnya belum selesai?
- Apakah schedule boleh skip bila sistem down?
- Apakah missed run harus dikejar?
- Apakah multiple cluster node bisa memulai duplicate run?

Untuk batch serius, timer start biasanya perlu dikombinasikan dengan:

- idempotency key berbasis schedule window,
- unique business key,
- database lock/application lock,
- detection of active previous run,
- operational dashboard.

---

## 7. Timer Intermediate Catch Event

Timer intermediate catch event adalah wait state yang menunda flow.

Contoh:

```xml
<intermediateCatchEvent id="waitBeforeReminder">
  <timerEventDefinition>
    <timeDuration>PT24H</timeDuration>
  </timerEventDefinition>
</intermediateCatchEvent>
```

Makna:

```text
Execution berhenti di event ini.
Engine membuat timer job.
Saat job due dan dieksekusi, sequence flow keluar dilanjutkan.
```

Gunakan untuk:

- deliberate delay,
- wait until cooling period ends,
- wait before retrying manual step,
- scheduled follow-up,
- staged notification.

Jangan gunakan untuk:

- retry teknis service call; gunakan failed job retry atau explicit retry design,
- polling remote service tanpa batas; gunakan external task/message/event-driven integration,
- long business wait yang sebenarnya lebih tepat menjadi user task deadline atau receive task.

---

## 8. Timer Boundary Event

Timer boundary event melekat pada activity.

Contoh interrupting timer:

```xml
<userTask id="submitClarification" name="Submit Clarification" />

<boundaryEvent id="clarificationTimeout" attachedToRef="submitClarification">
  <timerEventDefinition>
    <timeDuration>P7D</timeDuration>
  </timerEventDefinition>
</boundaryEvent>
```

Makna:

```text
Saat user task dibuat, timer job dibuat.
Jika user menyelesaikan task sebelum timer fire, timer job dibatalkan.
Jika timer fire lebih dulu, user task diinterrupt dan flow keluar dari boundary event.
```

### 8.1 Interrupting Boundary Timer

Default boundary timer adalah interrupting.

Artinya:

- activity utama dihentikan,
- execution activity utama dibatalkan,
- outgoing flow dari boundary timer dijalankan.

Cocok untuk:

- hard deadline,
- no-response closure,
- auto-escalate and stop waiting,
- revoke pending activity,
- terminate approval window.

Contoh business meaning:

```text
User diberi 14 hari untuk submit clarification.
Jika tidak submit, case masuk enforcement review.
Clarification task tidak lagi valid.
```

### 8.2 Non-Interrupting Boundary Timer

Non-interrupting boundary timer memakai `cancelActivity="false"`.

Contoh:

```xml
<boundaryEvent id="sendReminder" attachedToRef="submitClarification" cancelActivity="false">
  <timerEventDefinition>
    <timeDuration>P3D</timeDuration>
  </timerEventDefinition>
</boundaryEvent>
```

Makna:

```text
Saat timer fire, activity utama tetap aktif.
Engine membuat execution tambahan untuk flow reminder.
```

Cocok untuk:

- reminder,
- warning,
- soft escalation,
- notification supervisor,
- SLA amber alert.

Bahaya:

- Bisa menciptakan parallel execution.
- Jika reminder flow punya side effect, harus idempotent.
- Jika timeCycle digunakan untuk repeated reminder, bisa menghasilkan banyak execution.
- Variable update dari branch reminder bisa konflik dengan activity utama.

Rule praktis:

> Gunakan interrupting timer untuk deadline yang mengubah lifecycle. Gunakan non-interrupting timer untuk observasi/reminder yang tidak mengambil alih lifecycle utama.

---

## 9. Timer dan User Task Due Date: Jangan Disamakan

Dalam workflow human task, ada dua konsep yang sering tertukar:

1. BPMN timer boundary event.
2. User task due date/follow-up date.

User task due date adalah metadata task. Ia membantu query, UI, filtering, dan prioritization.

Timer boundary event adalah executable process behavior. Ia membuat job yang akan mengubah process state saat fire.

Perbandingan:

| Aspek | User Task Due Date | BPMN Timer Boundary |
|---|---|---|
| Tujuan | Metadata/visibility | Executable deadline behavior |
| Mengubah process? | Tidak otomatis | Ya |
| Membuat job? | Tidak sebagai boundary behavior | Ya |
| Cocok untuk | Sorting, task inbox, overdue report | Timeout, escalation, auto-close |
| Failure behavior | Tidak ada execution | Job retry/incident |

Contoh desain buruk:

```text
Set due date task = 7 hari.
Berharap proses otomatis escalate setelah due date.
```

Itu salah. Due date tidak otomatis menggerakkan proses.

Desain benar:

```text
User task dueDate = visible SLA date.
Boundary timer = executable SLA action.
```

---

## 10. SLA Modelling: Jangan Mulai dari Timer, Mulai dari State

Kesalahan umum adalah langsung menggambar timer sebelum mendefinisikan state SLA.

Untuk SLA serius, mulai dari pertanyaan:

- SLA apa yang diukur?
- Kapan SLA mulai?
- Kapan SLA berhenti?
- Apakah SLA pause?
- Apakah SLA reset setelah rework?
- Apakah SLA dihitung calendar day atau business day?
- Apakah public holiday dihitung?
- Apakah deadline visible ke user?
- Apa aksi saat SLA warning?
- Apa aksi saat SLA breached?
- Apakah breach mengubah process lifecycle atau hanya audit marker?

### 10.1 SLA Sebagai State Machine

Contoh state SLA:

```text
NOT_STARTED
RUNNING
PAUSED
WARNING
BREACHED
SATISFIED
CANCELLED
```

Timer hanya mekanisme untuk transisi tertentu:

```text
RUNNING --warning timer--> WARNING
WARNING --breach timer--> BREACHED
RUNNING --task completed--> SATISFIED
RUNNING --case cancelled--> CANCELLED
RUNNING --waiting external party--> PAUSED
PAUSED --resume--> RUNNING
```

Jika SLA punya pause/resume, satu boundary timer sederhana sering tidak cukup. Anda mungkin butuh:

- external SLA service,
- computed due date variable,
- process modification/message to reschedule,
- cancel/recreate timer path,
- explicit SLA subprocess,
- separate process instance for SLA tracking.

---

## 11. Pattern: Simple Deadline on User Task

### 11.1 Problem

Officer harus review application dalam 5 hari. Bila tidak selesai, task dieskalasi ke supervisor.

### 11.2 Model

```text
User Task: Officer Review
  Boundary Timer: P5D interrupting
    -> Create Supervisor Review Task
```

### 11.3 Meaning

```text
Officer Review active.
Timer job due in 5 days.
If officer completes task first, timer removed.
If timer fires first, officer task cancelled and supervisor path starts.
```

### 11.4 Production Concern

- Apakah `P5D` calendar day atau working day?
- Apakah due date juga tampil di tasklist?
- Apakah officer task harus benar-benar hilang atau tetap visible as overdue?
- Apakah supervisor butuh melihat original assignee?
- Apakah breach harus tercatat di audit variable/history?

Untuk regulatory system, biasanya perlu record eksplisit:

```java
execution.setVariable("reviewSlaStatus", "BREACHED");
execution.setVariable("reviewSlaBreachedAt", Instant.now().toString());
execution.setVariable("reviewSlaPolicyVersion", "REVIEW_SLA_V3");
```

Jangan hanya mengandalkan fakta bahwa boundary timer path pernah dilewati.

---

## 12. Pattern: Reminder Without Interrupting Work

### 12.1 Problem

Applicant harus submit clarification dalam 14 hari. Reminder dikirim pada hari ke-7, tetapi task tetap aktif.

### 12.2 Model

```text
User Task: Submit Clarification
  Non-interrupting Boundary Timer: P7D
    -> Send Reminder
  Interrupting Boundary Timer: P14D
    -> Mark No Response
```

### 12.3 Meaning

```text
Day 7: send reminder, user task remains active.
Day 14: if task still active, cancel task and continue timeout path.
```

### 12.4 Failure Concern

Send Reminder adalah side effect. Jika reminder flow gagal dan timer job retry, email bisa terkirim dua kali bila tidak idempotent.

Gunakan idempotency key:

```text
caseId + reminderType + timerEventId + reminderSequence
```

Contoh:

```text
CASE-123:CLARIFICATION_REMINDER:DAY_7:1
```

---

## 13. Pattern: Repeated Reminder

### 13.1 Model Naif

```xml
<boundaryEvent id="repeatedReminder" attachedToRef="waitForSubmission" cancelActivity="false">
  <timerEventDefinition>
    <timeCycle>R5/P1D</timeCycle>
  </timerEventDefinition>
</boundaryEvent>
```

Makna:

```text
Kirim reminder harian sampai 5 kali selama task masih aktif.
```

### 13.2 Risiko

- Jika task aktif lama, reminder job bisa berulang.
- Jika reminder flow lambat, branch bisa overlap.
- Jika email service down, failed job bisa retry dan bercampur dengan cycle berikutnya.
- Jika process instance migrated, timer behavior harus dipastikan kompatibel.

### 13.3 Desain Lebih Terkontrol

Untuk reminder enterprise, sering lebih aman:

```text
User Task active
  Boundary timer P1D non-interrupting
    -> Evaluate reminder policy
    -> If should remind: send reminder idempotently
    -> If reminder count < max and task still active: schedule next reminder via loop/wait
```

Atau gunakan dedicated notification scheduler service bila reminder policy kompleks.

---

## 14. Business Calendar: Gap Antara BPMN Timer dan Real-World SLA

Camunda timer native memahami waktu teknis:

- fixed date,
- duration,
- cycle.

Tetapi real SLA sering berbunyi:

```text
3 working days, excluding weekends and Singapore/Indonesia public holidays,
counting starts after payment confirmation,
if submitted after 5pm then count starts next working day,
if agency requests clarification then SLA pauses,
if applicant responds then SLA resumes.
```

Timer native tidak otomatis menyelesaikan semua ini.

### 14.1 Strategi 1: Precompute Due Date

Application service menghitung due date memakai business calendar, lalu menyimpan hasil sebagai variable.

```java
Instant dueAt = slaCalendar.computeDueAt(
    submittedAt,
    DurationPolicy.ofBusinessDays(3),
    ZoneId.of("Asia/Singapore"),
    holidayCalendarVersion
);

runtimeService.startProcessInstanceByKey(
    "caseReview",
    businessKey,
    Map.of(
        "reviewDueAt", dueAt.toString(),
        "slaPolicyVersion", "REVIEW_SLA_2026_01"
    )
);
```

BPMN:

```xml
<boundaryEvent id="reviewDueTimer" attachedToRef="reviewTask">
  <timerEventDefinition>
    <timeDate>${reviewDueAt}</timeDate>
  </timerEventDefinition>
</boundaryEvent>
```

Kelebihan:

- BPMN tetap sederhana.
- SLA calculation bisa dites sebagai pure business logic.
- Calendar version bisa diaudit.
- Cocok untuk regulatory defensibility.

Kekurangan:

- Perubahan calendar setelah timer dibuat tidak otomatis mengubah timer.
- Perlu reschedule mechanism.

### 14.2 Strategi 2: SLA Service sebagai Source of Truth

Untuk SLA sangat kompleks, Camunda menyimpan state proses, tetapi SLA engine/service menghitung dan memonitor deadline.

```text
Camunda process emits SLA_STARTED event
SLA service computes due/warning dates
SLA service emits SLA_WARNING/SLA_BREACHED message
Camunda correlates message to process instance
```

Cocok bila:

- SLA policy sering berubah,
- banyak workflow berbagi SLA rules,
- calendar rules kompleks,
- perlu SLA dashboard lintas proses,
- perlu audit yang kuat.

Kekurangan:

- Arsitektur lebih kompleks.
- Butuh inbox/outbox.
- Message correlation harus aman.

### 14.3 Strategi 3: Custom Business Calendar di Engine

Camunda engine memiliki konsep business calendar internal, tetapi meng-custom engine-level calendar adalah keputusan platform, bukan aplikasi ringan.

Gunakan hanya bila:

- semua proses memakai policy calendar yang konsisten,
- tim memahami engine internals,
- upgrade compatibility diuji,
- ada test regression kuat,
- perubahan calendar dikelola sebagai platform capability.

Untuk kebanyakan enterprise app, precompute due date di application/SLA layer lebih mudah diaudit dan lebih aman.

---

## 15. Time Zone Discipline

Time zone adalah sumber bug timer paling sunyi.

### 15.1 Prinsip Utama

- Simpan timestamp internal dalam UTC.
- Sertakan timezone/offset pada `timeDate`.
- Pastikan semua node cluster memakai timezone JVM yang sama.
- Hindari local timestamp tanpa offset.
- UI boleh menampilkan local time, tetapi engine schedule sebaiknya UTC.
- Business calendar harus eksplisit memakai `ZoneId`, bukan default JVM.

### 15.2 Java API Discipline

Di Java modern:

```java
Instant dueAt = Instant.parse("2026-07-01T10:00:00Z");
```

Untuk local policy:

```java
ZoneId businessZone = ZoneId.of("Asia/Singapore");
ZonedDateTime localDeadline = LocalDate.of(2026, 7, 1)
    .atTime(17, 0)
    .atZone(businessZone);
Instant dueAt = localDeadline.toInstant();
```

Lalu variable ke Camunda sebagai ISO instant:

```java
variables.put("dueAt", dueAt.toString());
```

### 15.3 Jangan Gunakan Default Timezone Diam-Diam

Buruk:

```java
LocalDateTime due = LocalDateTime.now().plusDays(3);
variables.put("dueAt", due.toString());
```

Masalah:

- Tidak ada timezone.
- Interpretasi bergantung JVM.
- Cluster behavior bisa tidak konsisten.
- DST bisa ambiguous.

Lebih baik:

```java
Instant dueAt = ZonedDateTime.now(ZoneId.of("Asia/Singapore"))
    .plusDays(3)
    .toInstant();
variables.put("dueAt", dueAt.toString());
```

Atau bila SLA calendar kompleks, pakai service khusus.

---

## 16. Daylight Saving Time dan Ambiguous Timestamp

Indonesia tidak memakai DST, tetapi enterprise system sering melayani wilayah lain, atau berjalan di cloud image yang default timezone-nya berubah.

DST problem:

- Ada jam yang “hilang” saat spring forward.
- Ada jam yang “terulang” saat fall back.
- Timestamp lokal seperti `2026-11-01T01:30` di zona tertentu bisa ambiguous.

Untuk Camunda 7, hindari ambiguity dengan:

- UTC JVM timezone untuk engine nodes,
- timestamp dengan `Z` atau offset,
- business date calculation di service yang memakai `ZoneId` eksplisit,
- audit record menyimpan both `instant` dan `business zone/policy` bila perlu.

Contoh audit field:

```json
{
  "slaDueAtInstant": "2026-07-01T09:00:00Z",
  "slaDueAtLocal": "2026-07-01T17:00:00+08:00",
  "slaZoneId": "Asia/Singapore",
  "slaPolicyVersion": "REVIEW_SLA_2026_01",
  "holidayCalendarVersion": "SG_PUBLIC_HOLIDAY_2026_V1"
}
```

---

## 17. Timer Modification dan Rescheduling

Kadang timer perlu diubah setelah dibuat:

- applicant diberi extension,
- SLA pause/resume,
- agency holiday ditambahkan,
- due date direvisi,
- appeal reopened,
- supervisor grants extra time.

Camunda menyediakan API untuk mengubah due date job:

```java
managementService.setJobDuedate(jobId, newDate);
```

Untuk recurring timer, ada juga konsep cascade untuk memengaruhi subsequent timers.

Namun rescheduling bukan sekadar update tanggal. Pertanyaan desain:

- Siapa boleh mengubah deadline?
- Apakah perubahan harus diaudit?
- Apakah old due date disimpan?
- Apakah change reason wajib?
- Apakah reminder yang sudah terkirim tetap valid?
- Apakah breach yang sudah terjadi bisa dibatalkan?
- Apakah due date UI dan timer job selalu sinkron?

### 17.1 Deadline Extension Pattern

```text
User requests extension
Officer approves extension
System computes new due date
System updates business variable
System updates timer job due date
System writes audit event
System notifies applicant
```

Data audit:

```json
{
  "caseId": "CASE-123",
  "oldDueAt": "2026-07-01T09:00:00Z",
  "newDueAt": "2026-07-08T09:00:00Z",
  "reason": "Extension approved due to requested evidence delay",
  "approvedBy": "officer-778",
  "changedAt": "2026-06-25T04:12:33Z"
}
```

### 17.2 Avoid Hidden Timer Mutation

Jangan diam-diam mutate timer job tanpa business audit. `ACT_RU_JOB.DUE_DATE_` adalah technical schedule, bukan complete business history.

Rule:

> Timer job due date boleh diubah lewat ManagementService, tetapi business reason dan policy effect harus disimpan di domain/audit layer.

---

## 18. Timer dan Transaction Boundary

Saat execution mencapai timer catch/boundary/start scheduling point, engine membuat job dan commit state.

Contoh intermediate timer:

```text
Service Task A
Intermediate Timer P1D
Service Task B
```

Execution:

```text
1. Execute Service Task A.
2. Arrive at timer.
3. Create timer job.
4. Commit transaction.
5. Process is waiting.
6. Later, Job Executor executes timer job.
7. Continue to Service Task B.
```

Jika transaction sebelum timer rollback, timer job tidak ada.

Jika job executor mengeksekusi timer dan Service Task B gagal:

- timer job execution transaction rollback,
- retry behavior mengikuti job failure semantics,
- process tetap pada timer-related job/failure state sampai retry/incident.

### 18.1 Timer Fire Tidak Berarti Side Effect Aman

Misalnya boundary timer mengirim email reminder.

```text
Timer fires
Send email
Set variable reminderSent=true
Commit
```

Jika email berhasil tetapi commit gagal, job retry bisa mengirim email lagi.

Solusi:

- idempotency key,
- outbox notification,
- external notification service with dedup,
- record-before-send pattern dengan status transition hati-hati.

---

## 19. Timer dan Job Executor Load

Timer heavy system bisa menciptakan job spike.

Contoh:

```text
100,000 user tasks created at 09:00
Each has P3D reminder timer
Three days later at 09:00, 100,000 timer jobs become due
```

Akibat:

- `ACT_RU_JOB` spike,
- acquisition query berat,
- job executor backlog,
- reminder terlambat,
- unrelated async jobs ikut terlambat,
- DB CPU naik,
- lock contention naik.

### 19.1 Mitigasi Spike

- Jitter due date.
- Spread schedule window.
- Use job priority carefully.
- Separate job executor nodes by priority range jika perlu.
- Externalize mass notification scheduler.
- Avoid one timer per entity untuk massive low-value reminders.
- Batch reminder query outside BPMN bila process-level execution tidak diperlukan.

Contoh jitter:

```java
int jitterMinutes = ThreadLocalRandom.current().nextInt(0, 120);
Instant dueAt = baseDueAt.plus(Duration.ofMinutes(jitterMinutes));
```

Namun untuk regulatory deadline, jangan jitter deadline resmi. Jitter hanya untuk side-effect reminder, bukan legal breach time.

---

## 20. Timer Start Event dan Overlapping Execution

Recurring timer start bisa menciptakan overlapping process instance.

Contoh:

```text
Timer start every 5 minutes.
Process execution sometimes takes 20 minutes.
```

Akibat:

```text
Run 10:00 still active
Run 10:05 starts
Run 10:10 starts
Run 10:15 starts
```

Ini bisa benar atau salah tergantung desain.

### 20.1 Non-Overlapping Batch Pattern

Pada start:

```java
String scheduleWindow = computeScheduleWindow();
String businessKey = "DAILY_SCAN:" + scheduleWindow;

try {
  runtimeService.startProcessInstanceByKey("dailyScan", businessKey, variables);
} catch (ProcessEngineException duplicate) {
  // or use domain lock/unique constraint before starting
}
```

Tetapi timer start event sendiri yang membuat instance tidak otomatis menjamin uniqueness business key per schedule window kecuali model/delegate awal mengaturnya.

Alternatif:

```text
Timer starts scheduler process
Scheduler process tries to acquire application lock
If lock acquired: run batch
If lock not acquired: end as skipped
```

Audit:

```text
RUN_STARTED
RUN_SKIPPED_PREVIOUS_ACTIVE
RUN_COMPLETED
RUN_FAILED
```

---

## 21. Regulatory SLA Design Example

### 21.1 Problem

Sebuah enforcement case memiliki tahap `Agency Review`.

Rules:

- Review SLA: 10 working days.
- Warning: 2 working days before due date.
- If agency requests clarification, SLA pauses.
- When applicant responds, SLA resumes with remaining time.
- If due date breached, supervisor gets escalation task.
- Breach must be auditable.

### 21.2 Naive BPMN

```text
User Task Agency Review
  Boundary Timer P10D -> Escalate
```

Ini tidak cukup karena:

- working days bukan calendar days,
- warning butuh separate path,
- pause/resume tidak tertangani,
- remaining time tidak dihitung,
- breach audit tidak eksplisit,
- public holiday tidak dipertimbangkan.

### 21.3 Better Architecture

```text
Camunda Process
  Agency Review Task
  Boundary Timer timeDate=${reviewWarningAt} non-interrupting -> warning notification
  Boundary Timer timeDate=${reviewDueAt} interrupting -> escalation

SLA Service / Domain Service
  compute reviewWarningAt
  compute reviewDueAt
  handle pause/resume
  store SLA ledger
  expose audit timeline
```

Variables:

```json
{
  "reviewSlaId": "SLA-CASE-123-REVIEW-1",
  "reviewDueAt": "2026-07-14T09:00:00Z",
  "reviewWarningAt": "2026-07-10T09:00:00Z",
  "reviewSlaPolicyVersion": "AGENCY_REVIEW_10WD_V4",
  "reviewSlaCalendarVersion": "SG_2026_V2"
}
```

SLA ledger:

```text
2026-07-01T02:00Z SLA_STARTED remaining=10WD
2026-07-03T08:12Z SLA_PAUSED reason=CLARIFICATION_REQUEST remaining=8WD
2026-07-06T01:20Z SLA_RESUMED remaining=8WD newDueAt=2026-07-16T09:00Z
2026-07-14T09:00Z SLA_WARNING_SENT
2026-07-16T09:00Z SLA_BREACHED
```

### 21.4 Why This Is Better

Camunda controls process lifecycle. SLA service controls calendar semantics. Audit ledger explains why due date moved. Timer events execute the next process actions.

This separation is more defensible than burying SLA math inside BPMN expressions.

---

## 22. Timer Expressions: Powerful but Dangerous

Camunda allows expressions inside timer definitions.

Example:

```xml
<timerEventDefinition>
  <timeDuration>${duration}</timeDuration>
</timerEventDefinition>
```

Where `duration` is a process variable like:

```text
P7D
```

Or:

```xml
<timeCycle>#{slaPolicyBean.reviewReminderCycle()}</timeCycle>
```

### 22.1 Good Use

- parameterized process model,
- test/prod duration differences via variable,
- tenant-specific SLA policy resolved at start,
- due date computed by service then injected.

### 22.2 Bad Use

- complex business calendar math in expression,
- bean method with hidden database calls,
- expression depending on mutable global config without audit,
- expression returning local timezone date string,
- expression whose result changes unpredictably across deployments.

Rule:

> Timer expression should resolve a schedule value, not hide business policy.

---

## 23. Re-evaluating Time Cycle

Recurring timer expression can be re-evaluated when due if engine configuration enables it.

This matters when timer cycle is produced by a bean/config and the config changes.

But the important nuance:

```text
Changing the expression/config does not necessarily change the already scheduled current timer firing time.
The new cycle affects subsequent jobs after re-evaluation.
```

If immediate change is needed, you typically also need to update current job due date.

Operationally:

- changing schedule policy must be treated like production change,
- active timers need migration/reschedule plan,
- audit should record old/new policy,
- test both current due job and subsequent recurrence.

---

## 24. Timer Testing Strategy

Timer testing should avoid sleeping real time.

Bad test:

```java
Thread.sleep(Duration.ofDays(1).toMillis());
```

Better strategy:

- query timer job,
- verify due date,
- manually execute job via `ManagementService.executeJob(jobId)`,
- or manipulate clock/test time if test framework supports it,
- assert process moved to expected activity,
- assert side effects use fake/idempotent adapter.

Conceptual example:

```java
Job timer = managementService.createJobQuery()
    .processInstanceId(processInstance.getId())
    .singleResult();

assertThat(timer.getDuedate()).isEqualTo(expectedDueDate);

managementService.executeJob(timer.getId());

assertThat(runtimeService.createProcessInstanceQuery()
    .processInstanceId(processInstance.getId())
    .singleResult()).isNotNull();
```

For boundary timer:

```text
Start process
Assert user task active
Find timer job
Execute timer job
Assert user task cancelled or still active depending on interrupting/non-interrupting
Assert escalation/reminder path active
```

For timezone test:

```text
Given business zone Asia/Singapore
Given submittedAt instant
When compute due date for 3 working days
Then dueAt instant equals expected UTC value
And BPMN timer variable contains offset/UTC date string
```

---

## 25. SQL Diagnostics for Timers

Timer jobs live in `ACT_RU_JOB`.

Useful columns vary by version/database, but common diagnostic fields include:

```text
ID_
TYPE_
PROCESS_INSTANCE_ID_
EXECUTION_ID_
PROC_DEF_ID_
DUE_DATE_
LOCK_OWNER_
LOCK_EXP_TIME_
RETRIES_
EXCEPTION_MSG_
HANDLER_TYPE_
HANDLER_CFG_
DEPLOYMENT_ID_
PRIORITY_
SUSPENSION_STATE_
```

Example diagnostic query:

```sql
SELECT
  ID_,
  TYPE_,
  PROCESS_INSTANCE_ID_,
  EXECUTION_ID_,
  DUE_DATE_,
  LOCK_OWNER_,
  LOCK_EXP_TIME_,
  RETRIES_,
  EXCEPTION_MSG_,
  PRIORITY_,
  SUSPENSION_STATE_
FROM ACT_RU_JOB
WHERE TYPE_ = 'timer'
ORDER BY DUE_DATE_ ASC;
```

Check overdue timer backlog:

```sql
SELECT COUNT(*) AS overdue_timers
FROM ACT_RU_JOB
WHERE TYPE_ = 'timer'
  AND DUE_DATE_ < CURRENT_TIMESTAMP
  AND RETRIES_ > 0
  AND LOCK_OWNER_ IS NULL;
```

Check failed timers:

```sql
SELECT
  ID_, PROCESS_INSTANCE_ID_, DUE_DATE_, RETRIES_, EXCEPTION_MSG_
FROM ACT_RU_JOB
WHERE TYPE_ = 'timer'
  AND RETRIES_ = 0;
```

Important warning:

> Use SQL for diagnosis. Use Camunda API for mutation.

Do not manually update `ACT_RU_JOB.DUE_DATE_` in production unless you are performing a controlled emergency operation with vendor/team approval and full backup/recovery plan. Prefer `ManagementService.setJobDuedate`.

---

## 26. Common Failure Modes

### 26.1 Timer Did Not Fire

Possible causes:

- Job Executor disabled.
- Due date is still in future.
- Job has no retries left.
- Job is locked by another node.
- Lock expired but acquisition delayed.
- Process definition/job suspended.
- Deployment-aware job executor cannot find responsible deployment.
- DB clock/JVM timezone mismatch caused unexpected due date.
- Job executor overloaded.

Diagnostic:

```text
Check ACT_RU_JOB.DUE_DATE_
Check RETRIES_
Check LOCK_OWNER_ and LOCK_EXP_TIME_
Check job executor logs
Check process/job suspension state
Check node timezone
Check job acquisition metrics
```

### 26.2 Timer Fired Late

Possible causes:

- Acquisition interval/backoff.
- Job executor queue saturated.
- Thread pool too small.
- DB slow query.
- High volume due at same time.
- Priority ordering starving timer.
- Node down during due window.

Key point:

```text
Due date is earliest eligibility time, not guaranteed exact execution time.
```

### 26.3 Timer Fired Twice

Possible causes:

- Job execution committed ambiguously after side effect.
- Lock expired while worker/thread still processing long transaction.
- Node crash/retry.
- Non-idempotent side effect repeated after retry.
- Process model has multiple timers.
- Duplicate process deployment/timer start.

Mitigation:

- idempotency keys,
- shorter transaction,
- avoid long blocking external calls in timer path,
- async/outbox notification,
- verify process definitions deployed.

### 26.4 Timer Was Cancelled Unexpectedly

Possible causes:

- Attached activity completed before boundary fired.
- Interrupting boundary event elsewhere cancelled scope.
- Process instance cancelled/deleted.
- Event subprocess interrupted parent scope.
- Migration/modification affected execution tree.

Diagnostic:

- inspect history activity instance,
- inspect task history,
- inspect user operation log,
- inspect process instance modification/audit.

### 26.5 Deadline Variable Changed but Timer Did Not

Cause:

```text
Changing process variable after timer job is created does not automatically update existing job due date.
```

Fix:

- update job due date explicitly,
- cancel/recreate timer path via process design,
- use message-based reschedule design,
- maintain SLA ledger.

---

## 27. Design Decision Matrix

| Requirement | Recommended Mechanism |
|---|---|
| Wait 5 minutes then continue | Intermediate timer `timeDuration` |
| Start process every day at midnight | Timer start `timeCycle` |
| User task overdue visible in inbox | Task due date |
| User task auto-escalates when overdue | Boundary timer |
| Send reminder but keep task active | Non-interrupting boundary timer |
| Cancel task at deadline | Interrupting boundary timer |
| Deadline is exact fixed date | `timeDate` with UTC/offset |
| Deadline is N calendar days | `timeDuration` |
| Deadline is N business days | Precompute `timeDate` via business calendar |
| SLA can pause/resume | SLA state/service + rescheduling/message |
| Reminder to thousands of cases | Consider batch scheduler/jitter/outbox |
| Legal/regulatory deadline | Explicit SLA ledger + auditable policy version |
| Schedule changes dynamically | ManagementService reschedule + audit |

---

## 28. Architecture Smells

### Smell 1: Timer Used as Poor Man's Queue

```text
Loop every 1 minute -> check remote system -> wait 1 minute -> repeat
```

Better:

- external event/message,
- webhook ingestion,
- external task worker,
- polling service outside process engine.

### Smell 2: SLA Hidden in BPMN Duration Literals

```xml
<timeDuration>P14D</timeDuration>
```

No policy version. No calendar version. No audit explanation.

Better:

```text
SLA policy service computes dueAt.
BPMN uses dueAt.
Audit stores policy version.
```

### Smell 3: Non-Interrupting Timer Updates Parent Variables Carelessly

Reminder branch updates shared variables while user task completion also updates same variables.

Risk:

- optimistic locking,
- inconsistent state,
- hidden race.

Better:

- local variables in reminder branch,
- idempotent notification record outside process variable,
- append-only audit event.

### Smell 4: All Timers Due at Same Clock Time

Every process has deadline at `00:00`. At midnight, job executor melts.

Better:

- use actual per-case due times,
- spread non-legal jobs,
- separate reminder scheduler,
- tune job executor and indexes.

### Smell 5: Local Time Without Zone

```xml
<timeDate>2026-07-01T17:00:00</timeDate>
```

Better:

```xml
<timeDate>2026-07-01T09:00:00Z</timeDate>
```

or:

```xml
<timeDate>2026-07-01T17:00:00+08:00</timeDate>
```

---

## 29. Java 8–25 Considerations

Camunda 7 estates may run across old and modern Java versions. Timer correctness should not depend on fragile date/time practices.

### 29.1 Java 8 Baseline

Java 8 already has `java.time`:

- `Instant`
- `Duration`
- `LocalDate`
- `LocalDateTime`
- `ZonedDateTime`
- `ZoneId`
- `OffsetDateTime`

Use `java.time`, not `java.util.Date` as domain model. Convert to `Date` only at Camunda API boundary if needed.

```java
Date dateForCamunda = Date.from(dueAtInstant);
```

### 29.2 Java 11/17/21/25

The same domain principle remains:

- use immutable temporal types,
- inject `Clock` for testability,
- avoid `now()` scattered everywhere,
- avoid system default zone,
- represent business zone explicitly,
- serialize instants in ISO-8601.

Example service:

```java
public final class ReviewSlaCalculator {
  private final Clock clock;
  private final ZoneId businessZone;
  private final HolidayCalendar holidayCalendar;

  public ReviewSlaCalculator(
      Clock clock,
      ZoneId businessZone,
      HolidayCalendar holidayCalendar
  ) {
    this.clock = clock;
    this.businessZone = businessZone;
    this.holidayCalendar = holidayCalendar;
  }

  public Instant computeDueAt(Instant startedAt, int workingDays) {
    ZonedDateTime local = startedAt.atZone(businessZone);
    LocalDate date = local.toLocalDate();

    int remaining = workingDays;
    while (remaining > 0) {
      date = date.plusDays(1);
      if (holidayCalendar.isWorkingDay(date)) {
        remaining--;
      }
    }

    return date.atTime(17, 0).atZone(businessZone).toInstant();
  }
}
```

For production, refine this to handle cutoff time, partial days, pauses, and versioned calendar.

---

## 30. Production Checklist

Before shipping timer-heavy Camunda process, verify:

```text
[ ] Every timer has clear business meaning.
[ ] Timer definition uses UTC/offset where applicable.
[ ] Business calendar rules are not hidden in random expressions.
[ ] Task due date and executable timer are intentionally separated.
[ ] Reminder side effects are idempotent.
[ ] Timer paths have retry/failure strategy.
[ ] Timer job volume has been estimated.
[ ] Job Executor capacity is sized for due date spikes.
[ ] Timezone is consistent across cluster nodes.
[ ] DB timezone/session behavior is understood.
[ ] SLA breach is explicitly auditable.
[ ] Deadline extension/reschedule is audited.
[ ] Tests execute timer jobs without real sleeps.
[ ] Operations team knows how to inspect timer jobs.
[ ] Manual recovery path exists for failed timer jobs.
```

---

## 31. Key Takeaways

1. Timer Camunda 7 adalah job dengan due date, bukan realtime alarm.
2. Timer hanya fire jika Job Executor aktif dan job berhasil di-acquire/execute.
3. `timeDate` cocok untuk absolute deadline.
4. `timeDuration` cocok untuk relative delay.
5. `timeCycle` cocok untuk recurrence, tetapi bisa menimbulkan job flood.
6. Timer start event dijadwalkan saat deployment.
7. Timer intermediate catch event adalah wait state.
8. Boundary timer bisa interrupting atau non-interrupting.
9. User task due date tidak otomatis mengubah process state.
10. SLA harus dimodelkan sebagai state/policy, bukan sekadar duration literal.
11. Business calendar kompleks sebaiknya dihitung di domain/SLA service.
12. Gunakan UTC/offset dan hindari default JVM timezone diam-diam.
13. Changing variable tidak otomatis mengubah existing timer job.
14. Reschedule timer harus disertai business audit.
15. Side effect dari timer path harus idempotent.

---

## 32. Latihan Mental Model

Jawab pertanyaan ini sebelum lanjut:

1. Apa bedanya due date user task dan boundary timer?
2. Kenapa timer bisa terlambat walaupun due date sudah lewat?
3. Apa yang terjadi jika timer path mengirim email lalu transaction commit gagal?
4. Kenapa `P3D` tidak sama dengan 3 business days?
5. Kenapa local date tanpa timezone berbahaya di cluster?
6. Bagaimana cara mengubah due date timer yang sudah dibuat?
7. Apa risiko non-interrupting boundary timer?
8. Apa strategi terbaik untuk SLA pause/resume?
9. Bagaimana mencegah recurring timer start membuat overlapping batch run?
10. Apa saja field audit minimum untuk regulatory SLA breach?

---

## 33. Referensi

- Camunda 7.24 Documentation — Timer Events.
- Camunda 7.24 Documentation — Job Executor.
- Camunda 7.24 Documentation — Time zones.
- Camunda 7.24 Documentation — Transactions in Processes.
- Camunda 7.24 Javadocs — ManagementService timer/job operations.

---

## 34. Status

`part-014` selesai.

Seri belum selesai. Lanjut ke:

`learn-java-camunda-7-bpm-platform-engineering-part-015.md` — Human Task Engineering: Task Lifecycle, Assignment, Candidate Groups, Authorization, Forms.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-013.md">⬅️ Part 013 — Message Correlation, Signal, Event, Business Key, dan Race Condition Control</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-015.md">Part 015 — Human Task Engineering: Task Lifecycle, Assignment, Candidate Groups, Authorization, and Work Queue Design ➡️</a>
</div>
