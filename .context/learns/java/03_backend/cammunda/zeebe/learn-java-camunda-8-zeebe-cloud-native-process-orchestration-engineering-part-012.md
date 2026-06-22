# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-012.md

# Part 012 — Timers, Deadlines, SLA, Escalation, and Time Semantics

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `012`  
> Topik: timer, deadline, SLA, escalation, retry timing, human-task timing, clock semantics, dan desain workflow berbasis waktu di Camunda 8 / Zeebe  
> Target pembaca: Java engineer senior/staff yang sudah memahami Java, distributed systems, BPMN dasar, Camunda 7, dan bagian 000–011 dari seri ini

---

## 0. Posisi Bagian Ini dalam Seri

Pada bagian sebelumnya kita sudah membahas:

- arsitektur Camunda 8 / Zeebe;
- command, event, record, state, dan deterministic progress;
- partition, replication, ordering guarantee;
- BPMN runtime semantics;
- Java client dan worker engineering;
- idempotency, duplicate execution, retry, external side effect;
- variable contract dan payload discipline;
- BPMN modelling untuk distributed execution;
- process instantiation, business key, correlation key, dan message design;
- error handling: BPMN error, job failure, incident, escalation, business rejection.

Bagian ini masuk ke dimensi yang sering diremehkan: **waktu**.

Dalam sistem workflow production-grade, waktu bukan hanya `Thread.sleep`, scheduler, cron, atau timeout HTTP. Waktu adalah bagian dari kontrak bisnis:

- kapan proses boleh menunggu;
- kapan harus follow-up;
- kapan harus escalate;
- kapan SLA dianggap breach;
- kapan retry boleh dilakukan lagi;
- kapan human task overdue;
- kapan deadline statutory/regulatory jatuh tempo;
- kapan external system dianggap tidak responsif;
- kapan proses harus auto-cancel, auto-reject, atau auto-advance.

Di Camunda 8 / Zeebe, timer bukan sekadar fitur BPMN. Timer adalah **durable orchestration state** yang direkam oleh engine, dipicu oleh engine, dan berdampak langsung pada lifecycle process instance.

---

## 1. Mental Model Utama: Time Is a Durable Process Fact

Dalam aplikasi biasa, engineer sering melihat waktu sebagai fungsi runtime:

```java
if (System.currentTimeMillis() > deadline) {
    escalate();
}
```

Atau sebagai scheduler:

```java
@Scheduled(cron = "0 */5 * * * *")
void checkOverdueApplications() {
    // scan DB, find overdue records, escalate
}
```

Dalam orchestration engine, cara berpikirnya berubah.

Timer adalah bagian dari state proses.

Artinya:

1. process instance masuk ke node timer;
2. engine menyimpan fakta bahwa instance itu menunggu sampai waktu tertentu;
3. instance tidak membutuhkan worker aktif untuk tetap menunggu;
4. broker restart tidak menghapus timer;
5. saat due time tercapai, engine melanjutkan proses;
6. hasil trigger timer menjadi bagian dari execution history/projection;
7. timer dapat dilihat, ditriage, dan dijelaskan secara operasional.

Mental model yang benar:

```text
Timer bukan kode yang tidur.
Timer adalah janji durable dari engine:
"process instance ini boleh/harus lanjut setelah kondisi waktu ini terpenuhi."
```

Implikasi untuk Java engineer:

- jangan membuat worker menunggu dengan `sleep`;
- jangan membuat polling scheduler untuk hal yang seharusnya menjadi BPMN timer;
- jangan menyembunyikan deadline bisnis di Java code kalau deadline itu harus terlihat, diaudit, dan dioperasikan;
- gunakan BPMN timer untuk wait state yang merupakan bagian dari proses bisnis;
- gunakan worker timeout/retry backoff untuk technical retry, bukan business SLA;
- bedakan due date UI, timer boundary, retry timeout, HTTP timeout, dan statutory deadline.

---

## 2. Taxonomy: Jenis-Jenis Waktu dalam Workflow

Sebelum membahas Camunda 8, kita harus membedakan beberapa konsep waktu.

| Jenis Waktu | Makna | Contoh | Cocok Dimodelkan dengan |
|---|---|---|---|
| Technical timeout | batas waktu operasi teknis | HTTP call timeout 5 detik | Java client config / HTTP timeout |
| Job timeout | lease job worker | worker punya 5 menit untuk menyelesaikan job | Zeebe job timeout |
| Retry backoff | jeda sebelum job retry | retry lagi setelah 10 menit | fail job dengan retry backoff |
| BPMN timer duration | tunggu relatif dari saat token masuk | tunggu 3 hari | timer event `PT72H` / `P3D` |
| BPMN timer date | tunggu sampai waktu absolut | tunggu sampai 2026-07-01T09:00 | timer date |
| BPMN timer cycle | trigger berulang | setiap hari jam 08:00 | timer cycle |
| Human task due date | deadline penyelesaian task | reviewer harus selesai Jumat | user task due date |
| Human task follow-up date | kapan task perlu mulai/follow-up | follow up setelah 2 hari | user task follow-up date |
| SLA | target layanan | approve dalam 5 working days | timer + analytics + policy |
| Statutory deadline | deadline regulasi/hukum | appeal harus diproses dalam 14 hari | explicit business deadline variable + timer |
| Escalation time | kapan naik level | jika 48 jam belum action, notify supervisor | boundary timer / event subprocess |
| Expiry time | kapan data/request invalid | OTP/message valid 10 menit | message TTL / domain expiry |
| Retention time | berapa lama data disimpan | audit retained 7 years | storage/archive policy |

Kesalahan umum: semua dianggap sama.

Padahal setiap jenis waktu punya semantics, ownership, observability, dan failure mode berbeda.

---

## 3. Timer BPMN di Camunda 8: Apa yang Didukung

Timer event di BPMN dapat digunakan sebagai:

1. timer start event;
2. intermediate timer catch event;
3. timer boundary event;
4. event subprocess trigger;
5. timer dalam event-based gateway scenario.

Camunda 8 mendukung timer definition dalam bentuk:

- **time duration**: waktu relatif, misalnya `PT10M`, `P3D`;
- **time date**: waktu absolut, misalnya tanggal/waktu tertentu;
- **time cycle**: waktu berulang, misalnya interval atau schedule berulang.

Dalam dokumentasi Camunda 8, timer events dapat didefinisikan dengan duration, date, atau cycle, dan timer boundary event dapat dibuat interrupting atau non-interrupting tergantung modelnya.

---

## 4. Timer Duration: Relative Waiting Time

Timer duration berarti:

```text
Tunggu selama durasi tertentu sejak token masuk ke timer tersebut.
```

Contoh:

```text
PT30M  = 30 menit
PT2H   = 2 jam
P1D    = 1 hari
P7D    = 7 hari
```

Contoh use case:

- tunggu 15 menit sebelum retry manual notification;
- beri user 3 hari untuk upload dokumen;
- tunggu 7 hari setelah reminder sebelum close case;
- tunggu cooling-off period 24 jam sebelum final enforcement.

Mental model:

```text
Timer duration dihitung dari waktu flow node timer diaktifkan.
```

Jadi kalau proses masuk ke user task pada Senin 10:00 dan ada boundary timer `P3D`, timer due kira-kira Kamis 10:00, bukan Kamis akhir hari, kecuali Anda secara eksplisit memodelkan begitu.

### 4.1 Kesalahan Umum pada Duration

#### Kesalahan 1 — Menganggap `P1D` berarti “besok pada jam kerja”

`P1D` adalah durasi kalender, bukan business calendar.

Jika masuk Jumat 17:00, `P1D` akan jatuh Sabtu 17:00, bukan Senin pagi.

#### Kesalahan 2 — Menganggap duration otomatis memahami hari libur

Timer duration tidak otomatis tahu public holiday, cuti bersama, agency calendar, atau jam operasional.

#### Kesalahan 3 — Memakai duration untuk statutory deadline yang butuh kalender bisnis kompleks

Jika regulasi menyatakan “14 working days excluding public holidays”, jangan langsung menulis `P14D`.

Anda butuh business calendar calculation yang menghasilkan absolute due date.

---

## 5. Timer Date: Absolute Waiting Time

Timer date berarti:

```text
Tunggu sampai timestamp tertentu.
```

Contoh:

```text
2026-07-01T09:00:00+07:00
```

Use case:

- deadline statutory sudah dihitung oleh domain service;
- hearing date sudah fixed;
- license expiry date sudah diketahui;
- scheduled cutover harus terjadi pada waktu tertentu;
- process harus resume pada tanggal tertentu.

Dalam production-grade design, timer date sering lebih aman daripada duration ketika deadline berasal dari domain rule.

Contoh pattern:

```text
[Calculate Deadline] -> [Wait Until Deadline] -> [Escalate/Close/Auto Decision]
```

Di Java:

```java
public record DeadlineCalculationResult(
    String applicationId,
    OffsetDateTime submissionTime,
    OffsetDateTime statutoryDeadline,
    String calendarVersion,
    String calculationReason
) {}
```

Lalu process variable:

```json
{
  "applicationId": "APP-2026-000123",
  "statutoryDeadline": "2026-07-03T17:00:00+08:00",
  "calendarVersion": "SG-BIZ-CALENDAR-2026-v3",
  "deadlinePolicy": "APPEAL_RESPONSE_14_WORKING_DAYS"
}
```

BPMN timer date dapat mengambil expression dari variable deadline.

### 5.1 Mengapa Absolute Deadline Lebih Defensible

Dalam regulatory workflow, pertanyaan audit bukan hanya:

```text
Apakah sistem escalate setelah 14 hari?
```

Pertanyaan yang lebih penting:

```text
Mengapa deadline case ini jatuh pada tanggal X?
Rule apa yang dipakai?
Calendar version apa?
Apakah hari libur dihitung?
Siapa/apa yang menghitung?
Apakah deadline berubah? Kenapa?
```

Karena itu deadline tidak boleh hanya tersembunyi sebagai `P14D` di BPMN.

Lebih defensible:

1. hitung deadline di domain service;
2. simpan hasil deadline sebagai variable bisnis;
3. simpan metadata calculation;
4. gunakan BPMN timer date untuk menunggu;
5. audit perubahan deadline jika ada;
6. tampilkan deadline di task/case UI;
7. alert sebelum dan saat breach.

---

## 6. Timer Cycle: Repetition and Recurrence

Timer cycle berarti timer dapat berulang.

Use case:

- start process setiap hari;
- reminder setiap 24 jam;
- escalation check berkala;
- periodic synchronization process;
- recurring compliance review.

Namun timer cycle harus dipakai hati-hati.

### 6.1 Kapan Timer Cycle Cocok

Cocok jika:

- proses memang event periodik;
- setiap trigger mewakili batch/window yang jelas;
- duplikasi trigger bisa dikendalikan;
- workload hasil trigger dapat diproses safely;
- observability dan backpressure diperhitungkan.

Contoh:

```text
Every day 08:00 -> Start Daily SLA Scan Process
```

Tetapi untuk orchestration modern, lebih baik tanyakan:

```text
Apakah saya benar-benar butuh scan berkala,
atau bisa memodelkan deadline per case dengan timer per process instance?
```

Jika setiap case punya deadline sendiri, timer per case sering lebih ekspresif daripada satu cron scanner.

### 6.2 Risiko Timer Cycle

Risiko:

- process instance burst di jam tertentu;
- overlap jika run sebelumnya belum selesai;
- duplicate batch;
- unclear idempotency key;
- operational noise;
- timer storm setelah downtime/recovery;
- sulit menjelaskan per-case deadline.

Pattern aman:

```text
Timer cycle starts scheduler process
scheduler process creates deterministic batch window
batch worker uses idempotency key per window
```

Contoh idempotency key:

```text
SLA_SCAN:2026-06-21:REGION-SG:POLICY-APPEAL-14D
```

---

## 7. Intermediate Timer Catch Event

Intermediate timer catch event adalah wait state eksplisit.

Model:

```text
[Submit Request] -> [Wait 3 Days] -> [Send Reminder]
```

Semantics:

1. token masuk ke timer event;
2. timer dijadwalkan;
3. process instance berhenti di sana;
4. tidak ada job aktif;
5. saat timer due, token lanjut.

Ini sangat berbeda dari worker yang menunggu.

Worker salah:

```java
void handle(JobClient client, ActivatedJob job) {
    Thread.sleep(Duration.ofDays(3).toMillis());
    client.newCompleteCommand(job).send().join();
}
```

Kenapa salah:

- thread tertahan;
- worker lease timeout;
- worker restart mengacaukan state;
- tidak observable sebagai process waiting point;
- tidak scalable;
- tidak defensible.

BPMN benar:

```text
Service Task -> Timer Catch Event -> Service Task
```

---

## 8. Timer Boundary Event: Deadline Attached to Activity

Boundary timer event ditempel pada activity, misalnya user task atau service task.

Ada dua jenis:

1. interrupting boundary timer;
2. non-interrupting boundary timer.

### 8.1 Interrupting Boundary Timer

Interrupting berarti:

```text
Jika timer fire, activity utama dibatalkan dan flow pindah ke path timer.
```

Contoh:

```text
[Review Application]
   boundary timer: P5D -> [Escalate to Supervisor]
```

Jika reviewer tidak menyelesaikan dalam 5 hari, user task dibatalkan dan proses lanjut ke escalation path.

Use case:

- approval timeout;
- applicant tidak submit dokumen;
- external system tidak merespons;
- manual review melewati batas absolut;
- auto-close case.

Risiko:

- user sedang mengerjakan task ketika timer fire;
- partial work hilang jika tidak disimpan di domain store;
- task cancellation harus dikomunikasikan ke UI/user;
- escalation path harus idempotent.

### 8.2 Non-Interrupting Boundary Timer

Non-interrupting berarti:

```text
Jika timer fire, activity utama tetap berjalan, dan path tambahan dimulai.
```

Contoh:

```text
[Review Application]
   non-interrupting timer P2D -> [Send Reminder]
```

Review task tetap aktif, tetapi reminder dikirim.

Use case:

- reminder;
- notify supervisor;
- create follow-up task;
- log SLA warning;
- send applicant reminder while still waiting.

Risiko:

- timer dapat membuat path tambahan lebih dari sekali jika cycle;
- reminder duplicate harus dikendalikan;
- supervisor notification jangan mengubah ownership tanpa aturan jelas;
- perlu idempotency untuk side effect notification.

---

## 9. Event Subprocess with Timer

Timer event subprocess memungkinkan flow tambahan dipicu dari dalam scope tertentu.

Mental model:

```text
Selama scope ini aktif, timer event subprocess dapat dipicu.
```

Contoh:

```text
Main process:
  Investigation Phase

Event subprocess:
  Every 7 days while investigation active -> Send progress reminder
```

Keunggulan:

- cocok untuk cross-cutting deadline dalam scope;
- tidak perlu menempel boundary timer di banyak node;
- bisa memisahkan main path dan monitoring path;
- baik untuk reminder/escalation yang berlaku selama fase tertentu.

Kapan dipakai:

- selama case masih active, kirim reminder berkala;
- selama appeal review berjalan, cek SLA warning;
- selama external agency response pending, notify setiap X hari;
- selama investigation open, generate periodic progress report.

Hati-hati:

- scope harus jelas;
- non-interrupting event subprocess dapat membuat banyak parallel flow;
- side effect harus idempotent;
- jangan menjadikan event subprocess sebagai “hidden process” yang sulit dibaca.

---

## 10. Timer Start Event

Timer start event memulai process instance berdasarkan schedule.

Use case:

- daily batch orchestration;
- monthly compliance review;
- scheduled report generation;
- periodic cleanup orchestration;
- nightly external reconciliation.

Pertanyaan desain:

1. Apakah proses periodik perlu dibuat sebagai BPMN process?
2. Apakah workload-nya business visible?
3. Apakah perlu Operate visibility?
4. Apakah retry/incident-nya harus dikelola sebagai workflow?
5. Apakah batch idempotency jelas?
6. Apakah run bisa overlap?

Jika jawabannya ya, timer start event cocok.

Jika hanya technical cleanup sederhana, mungkin cukup Kubernetes CronJob atau scheduler biasa.

### 10.1 Timer Start vs External Scheduler

| Aspek | Timer Start Event | External Scheduler |
|---|---|---|
| Visibility | terlihat sebagai process | biasanya di infra/app logs |
| Business meaning | kuat | tergantung implementasi |
| Incident handling | Camunda path | custom |
| Backpressure | engine-aware sebagian | custom |
| Operational ownership | process/platform team | app/infra team |
| Fine-grained batch logic | perlu worker/process | bebas di code |
| Cocok untuk | business periodic process | technical job |

Rule sederhana:

```text
Jika schedule adalah bagian dari lifecycle bisnis, modelkan di BPMN.
Jika schedule hanya housekeeping teknis, gunakan scheduler teknis.
```

---

## 11. Human Task Due Date and Follow-Up Date

User task timing punya semantics berbeda dari BPMN timer.

Camunda 8 user task dapat memiliki scheduling metadata seperti:

- `dueDate`: kapan task seharusnya selesai;
- `followUpDate`: kapan task seharusnya mulai diperhatikan/follow-up.

Ini berguna untuk Tasklist/custom inbox filtering.

Namun due date tidak selalu berarti process otomatis escalate.

Penting:

```text
Due date adalah metadata task.
Boundary timer adalah executable process behavior.
```

Jadi kalau Anda hanya set due date:

```text
Task terlihat overdue, tetapi proses belum tentu berubah jalur.
```

Kalau Anda butuh otomatis escalate:

```text
Tambahkan boundary timer atau event subprocess.
```

### 11.1 Pattern: Due Date + Boundary Timer

Model:

```text
[Review Application]
  dueDate = reviewDueAt
  boundary non-interrupting timer = reminderAt -> Send Reminder
  boundary interrupting timer = escalationAt -> Escalate
```

Variable:

```json
{
  "reviewFollowUpAt": "2026-06-24T09:00:00+08:00",
  "reviewDueAt": "2026-06-26T17:00:00+08:00",
  "reviewEscalationAt": "2026-06-27T09:00:00+08:00"
}
```

Semantics:

- follow-up date membantu inbox;
- due date membantu user prioritize;
- reminder timer memberi notification;
- escalation timer mengubah process path.

---

## 12. SLA Is Not One Thing

SLA sering disebut seolah-olah satu angka.

Contoh:

```text
Application must be processed within 5 days.
```

Tetapi production workflow membutuhkan breakdown:

1. SLA start event: kapan clock mulai?
2. SLA stop event: kapan clock selesai?
3. Pause rule: apakah clock berhenti saat menunggu applicant?
4. Calendar rule: calendar days atau working days?
5. Holiday rule: holiday nasional atau agency-specific?
6. Timezone rule: timezone mana?
7. Extension rule: siapa boleh extend?
8. Breach rule: apa yang terjadi saat breach?
9. Warning rule: kapan alert sebelum breach?
10. Reporting rule: bagaimana SLA dihitung di analytics?

Tanpa definisi ini, timer BPMN hanya memberi ilusi kepastian.

### 12.1 SLA Clock Model

Contoh regulatory application:

```text
SLA starts when application is accepted as complete.
SLA pauses while waiting for applicant clarification.
SLA resumes when applicant submits clarification.
SLA ends when final decision is issued.
```

Model sederhana:

```text
[Receive Application]
 -> [Completeness Check]
 -> if incomplete:
      [Request Clarification] -> [Wait Applicant] -> back
 -> if complete:
      [Start SLA Clock]
      [Review]
      [Decision]
      [Stop SLA Clock]
```

Namun Zeebe tidak otomatis punya konsep “SLA clock pause/resume” untuk analytics bisnis kompleks. Anda perlu modelkan dengan variable/event/domain read model.

### 12.2 SLA sebagai Domain Projection

Untuk SLA kompleks, desain yang matang:

- BPMN timer untuk executable behavior;
- domain SLA table untuk calculation;
- exported records untuk audit/projection;
- analytics layer untuk reporting;
- UI task due/follow-up untuk work management;
- alerting untuk breach warning.

Contoh table:

```sql
create table case_sla_clock (
    case_id varchar(64) primary key,
    policy_code varchar(64) not null,
    clock_status varchar(32) not null,
    started_at timestamp with time zone,
    paused_at timestamp with time zone,
    resumed_at timestamp with time zone,
    due_at timestamp with time zone,
    breached_at timestamp with time zone,
    total_paused_seconds bigint not null default 0,
    calendar_version varchar(64) not null,
    updated_at timestamp with time zone not null
);
```

---

## 13. Business Calendar: The Missing Complexity

Camunda timer expressions can represent dates/durations/cycles, but business calendars are domain rules.

Business calendar questions:

- Apa itu working day?
- Jam kerja mulai dan selesai kapan?
- Timezone mana?
- Apakah Sabtu dihitung?
- Apakah half-day holiday dihitung?
- Apakah agency punya special closure?
- Apakah applicant timezone relevan?
- Jika deadline jatuh hari libur, maju atau mundur?
- Jika submission setelah jam kerja, clock mulai kapan?
- Jika deadline extension diberikan, rule apa?

Jangan menyembunyikan ini di BPMN expression yang panjang.

Lebih baik:

```text
BPMN calls Calculate Deadline worker
Deadline service owns business calendar rules
BPMN waits until calculated absolute timestamp
```

### 13.1 Deadline Calculation Worker

Pseudo-code:

```java
public final class CalculateReviewDeadlineWorker {

    public DeadlineResult calculate(DeadlineRequest request) {
        BusinessCalendar calendar = calendarRepository.load(
            request.jurisdiction(),
            request.calendarVersion()
        );

        OffsetDateTime dueAt = calendar.addWorkingDays(
            request.clockStartAt(),
            request.policy().workingDays()
        );

        OffsetDateTime warningAt = calendar.subtractWorkingHours(dueAt, 8);

        return new DeadlineResult(
            dueAt,
            warningAt,
            request.policy().code(),
            calendar.version(),
            "Calculated from accepted-complete timestamp"
        );
    }
}
```

Variable output:

```json
{
  "sla": {
    "policyCode": "REVIEW_5_WORKING_DAYS",
    "clockStartAt": "2026-06-21T10:15:00+08:00",
    "warningAt": "2026-06-26T09:00:00+08:00",
    "dueAt": "2026-06-26T17:00:00+08:00",
    "calendarVersion": "SG-AGENCY-CALENDAR-2026-v4"
  }
}
```

Then BPMN:

```text
non-interrupting boundary timer = = sla.warningAt
interrupting/non-interrupting boundary timer = = sla.dueAt
```

---

## 14. FEEL Temporal Expressions

Camunda 8 uses FEEL expressions in many modelling contexts, including timer definitions when using dynamic expressions.

Core principle:

```text
Use FEEL for simple expression binding.
Use Java/domain service for complex calendar rules.
```

Good FEEL use:

```text
= reminderDuration
= sla.dueAt
= now() + duration("PT2H")
```

Risky FEEL use:

```text
= if applicant.country = "SG" and day of week(today()) = ... then ... else ...
```

If expression becomes business policy code, move it into domain service.

### 14.1 Expression Governance

Expression should be:

- readable;
- testable;
- versioned;
- reviewable by engineer and BA;
- stable across process versions;
- not dependent on hidden side effects.

Anti-pattern:

```text
One unreadable FEEL expression implementing 50 lines of deadline logic.
```

Better:

```text
CalculateDeadline worker -> variable sla.dueAt -> simple timer expression.
```

---

## 15. Job Timeout vs BPMN Timer

This distinction is critical.

### 15.1 Job Timeout

Job timeout is a lease.

When a worker activates a job, it receives exclusive time to work on it. If it does not complete/fail/throw error before timeout, the job can become available again.

Job timeout answers:

```text
How long may this worker hold this job activation?
```

It does not answer:

```text
How long may the business process wait?
```

### 15.2 BPMN Timer

BPMN timer is process semantics.

It answers:

```text
How long should the process wait before taking another path?
```

### 15.3 Example

External verification:

- HTTP timeout: 10 seconds;
- job timeout: 2 minutes;
- retry backoff: 15 minutes;
- business response deadline: 3 days;
- SLA warning: 2.5 days;
- SLA breach: 3 days.

These should not be collapsed into one timeout.

Model:

```text
[Send Verification Request]
 -> [Wait Verification Response]
      boundary timer at 2.5 days -> [Send Warning]
      boundary timer at 3 days -> [Escalate Missing Response]
```

Worker config:

```text
send-verification-request job timeout: 2 minutes
HTTP timeout: 10 seconds
fail job retry backoff: 15 minutes
```

---

## 16. Retry Backoff vs Timer Event

When a job worker fails a job, it can specify retries and retry backoff. The job is not retryable until the backoff has elapsed. If retries are exhausted, an incident is created.

Retry backoff is good for:

- external system temporarily unavailable;
- rate limit;
- network failure;
- DB deadlock;
- temporary auth/token issue;
- downstream maintenance window.

BPMN timer is good for:

- business waiting;
- SLA warning;
- escalation;
- applicant response deadline;
- review deadline;
- long-running external callback wait.

### 16.1 Wrong Design

```text
Use job retry backoff for 3 days waiting for applicant.
```

Why wrong:

- job remains technical failure concept;
- incident/retry semantics become misleading;
- process model does not show waiting-for-applicant state;
- user/business cannot see correct lifecycle;
- retries may generate noise;
- impossible to distinguish business wait from technical error.

### 16.2 Correct Design

```text
[Request Applicant Clarification]
 -> [Wait for Applicant Message]
      boundary timer P14D -> [Auto Close / Escalate]
```

This makes business waiting explicit.

---

## 17. Escalation Design

Escalation means:

```text
The process is still valid, but attention or responsibility must move upward/outward.
```

Do not confuse escalation with:

- technical failure;
- business rejection;
- cancellation;
- incident;
- compensation.

Escalation examples:

- reviewer did not act before due date;
- external agency did not respond;
- applicant has not submitted documents;
- case is approaching statutory deadline;
- unresolved incident needs operations team;
- high-risk case exceeds threshold.

### 17.1 Escalation Pattern: Warning then Breach

```text
[Review Application]
  non-interrupting timer warningAt -> [Notify Reviewer + Supervisor]
  interrupting timer breachAt -> [Escalate to Senior Officer]
```

This pattern separates:

- warning: task still owned by original actor;
- breach: ownership/flow changes.

### 17.2 Escalation Pattern: Layered Escalation

```text
Day 2: reminder to assignee
Day 4: notify team lead
Day 5: escalate to supervisor
Day 7: escalate to director / compliance queue
```

Model option A: multiple non-interrupting boundary timers.

Model option B: event subprocess with timer cycle and escalation-level variable.

Model option C: external escalation policy service that emits messages.

Choose based on readability.

If escalation policy changes often, avoid hardcoding all layers in BPMN. Use policy service and explicit process events.

---

## 18. Deadline Extension

Real workflow often needs deadline extension:

- applicant requests extension;
- supervisor approves extension;
- agency holiday declared;
- external dependency outage;
- case complexity reclassified.

Question:

```text
What happens to already scheduled timer?
```

In BPMN, timer is scheduled based on current model/variables when activated. If the deadline changes after the timer is already waiting, you need an explicit design.

### 18.1 Pattern: Cancel and Re-enter Wait State

Model:

```text
[Wait Until Deadline]
  message boundary event: DeadlineExtended -> [Recalculate Deadline] -> [Wait Until Deadline]
```

This cancels old wait and creates new timer.

### 18.2 Pattern: Event Subprocess Handles Extension

If extension can happen while task is active:

```text
[Review Task]
  boundary message: ExtensionApproved -> [Update Deadline] -> return/continue
  boundary timer: dueAt -> [Escalate]
```

But updating variable alone may not reschedule an already scheduled boundary timer. You must understand when expression is evaluated and design accordingly.

Safer design:

- move task into a scope that can be re-entered;
- or use explicit wait state recalculation;
- or model extension before timer activation;
- or cancel/recreate user task if required.

### 18.3 Audit Metadata

Deadline extension should record:

```json
{
  "deadlineExtension": {
    "previousDueAt": "2026-06-26T17:00:00+08:00",
    "newDueAt": "2026-07-01T17:00:00+08:00",
    "reasonCode": "APPLICANT_APPROVED_EXTENSION",
    "approvedBy": "SUPERVISOR-123",
    "approvedAt": "2026-06-25T14:30:00+08:00",
    "policyCode": "EXTENSION_MAX_3_WORKING_DAYS"
  }
}
```

---

## 19. Waiting for External Response

A common flow:

```text
Send request to external system -> wait for callback -> timeout if no callback
```

Correct BPMN:

```text
[Send Request]
 -> [Wait for Response Message]
      boundary timer P3D -> [Escalate Missing Response]
```

Design details:

- `Send Request` worker writes outbound request with idempotency key;
- external callback handler publishes message to Camunda;
- message correlation key identifies process instance;
- boundary timer handles missing response;
- duplicate callbacks are deduplicated;
- late callbacks after timeout are handled explicitly.

### 19.1 Late Callback Problem

Scenario:

1. process waits for callback;
2. timer fires after 3 days;
3. process escalates/cancels wait;
4. external callback arrives after 3 days + 5 minutes.

What should happen?

Options:

- ignore late callback;
- attach callback to escalated case;
- reopen case;
- create manual review task;
- send rejection to external system;
- compensate prior action.

This must be business-defined.

Do not let late callbacks become accidental unhandled messages with no operational meaning.

### 19.2 Pattern: Late Message Handler

Design domain callback handler:

```text
if process is waiting:
    publish message to Camunda
else if case is escalated:
    store callback and notify case owner
else if case is closed:
    store as late external response audit event
else:
    reject/park for reconciliation
```

This requires case/process status read model outside raw Camunda command path.

---

## 20. Timer and Message Race Conditions

Important race:

```text
A message and timer become ready at almost the same time.
```

Example:

- external response arrives at 10:00:00;
- timeout timer due at 10:00:00;
- which wins?

In distributed systems, never rely on intuitive wall-clock ordering unless engine semantics guarantee it for that specific scope/partition. Model business outcome to tolerate either order.

### 20.1 Robust Design

Use idempotent domain state transition:

```sql
case_external_wait_status:
  WAITING
  RESPONSE_RECEIVED
  TIMED_OUT
  ESCALATED
```

Transition rules:

```text
WAITING -> RESPONSE_RECEIVED
WAITING -> TIMED_OUT
TIMED_OUT -> LATE_RESPONSE_RECEIVED
RESPONSE_RECEIVED -> ignore timeout side effect if already processed
```

Even if BPMN path triggers one branch, domain layer protects side effects.

### 20.2 Event-Based Gateway Caution

Event-based gateway can model race between message and timer:

```text
Wait for either:
  - response message
  - timeout timer
```

This is readable and semantically clear.

But you still need late message policy outside the happy path.

---

## 21. Clock Assumptions in Distributed Workflow

Time in distributed systems is subtle.

Questions:

- Which clock schedules timers?
- Which timezone do users see?
- What if cluster node clock drifts?
- What if deployment spans regions?
- What if daylight saving time changes?
- What if due date was calculated in one timezone but displayed in another?

### 21.1 Store Instants, Display Local Meaning

General rule:

```text
Store absolute instant with offset/timezone metadata.
Display in user/business timezone.
Preserve the business timezone used for calculation.
```

For Java:

- use `Instant` for machine timestamp;
- use `OffsetDateTime` for timestamp with offset;
- use `ZonedDateTime` if timezone rules matter;
- avoid `LocalDateTime` for cross-system deadlines unless timezone is separately explicit.

Do not store:

```json
{"dueAt": "2026-07-01T09:00:00"}
```

without timezone/offset.

Better:

```json
{
  "dueAt": "2026-07-01T09:00:00+08:00",
  "dueAtZone": "Asia/Singapore"
}
```

or:

```json
{
  "dueAtInstant": "2026-07-01T01:00:00Z",
  "businessZone": "Asia/Singapore",
  "businessLocalDeadline": "2026-07-01T09:00:00"
}
```

### 21.2 Daylight Saving Time

Some regions have DST. Indonesia and Singapore generally do not, but enterprise systems may cover jurisdictions that do.

If using duration `P1D`, ask:

```text
Does this mean 24 hours or next business day same local time?
```

During DST transition, these can differ.

Business calendar service should own this.

---

## 22. Timer Precision and Expectation Management

Engine timers should not be treated as hard real-time scheduling.

Workflow timers are for business/process timing, not nanosecond/millisecond precision.

Expect:

- trigger after due time, not necessarily exactly at due millisecond;
- some delay under load;
- projection visibility lag;
- worker activation delay after timer continues to service task;
- downstream system delay.

For business SLA, this is usually acceptable.

For hard real-time trading/control systems, BPMN workflow engine is usually wrong tool.

### 22.1 SLA Measurement Should Use Domain Events

If SLA says:

```text
Decision issued before 17:00.
```

Measure using domain event timestamp:

```text
DecisionIssuedAt
```

not simply timer trigger timestamp.

Timer is enforcement mechanism; SLA reporting should be explicit and auditable.

---

## 23. Timer Incidents and Operational Debugging

Timer itself usually waits silently. Problems appear around:

- invalid timer expression;
- missing variable for dynamic timer;
- malformed date/duration;
- timer fires but next service task fails;
- process model migration changes timer;
- unexpected due date calculation;
- timer path creates duplicate side effect;
- projection delay makes timer seem stuck;
- worker unavailable after timer fires.

### 23.1 Debug Checklist

When user says:

```text
The SLA timer did not work.
```

Ask:

1. Did token reach the timer node?
2. Was timer definition static or expression?
3. Was expression evaluated successfully?
4. What value did the timer use?
5. What timezone/offset was used?
6. Did timer due time already pass?
7. Did timer fire but next job is waiting for worker?
8. Is Operate projection current?
9. Is there an incident after timer path?
10. Was process instance migrated/versioned?
11. Was boundary timer interrupting or non-interrupting?
12. Was the activity already completed before timer fired?
13. Did a message/event race with timer?
14. Was the expected behavior actually modelled?

### 23.2 Common Root Cause

Many “timer issue” tickets are not timer issues.

They are:

- wrong variable;
- wrong timezone;
- wrong assumption about working days;
- task completed before timer;
- boundary timer interrupting when expected non-interrupting;
- non-interrupting timer sent reminder but user expected escalation;
- due date set in task but no BPMN timer exists;
- process entered different path;
- worker after timer unavailable.

---

## 24. Timer and Process Instance Migration

When migrating running process instances, timers require special care.

Important questions:

- Is the timer node identical in source and target model?
- Has duration/date/cycle changed?
- Should already elapsed waiting time be preserved?
- Should timer be rescheduled?
- Can timer fire during migration window?
- What happens to active user task with boundary timer?

Migration is risky if timers may fire during the operation. Camunda migration tooling documentation notes timer-related limitations and recommends ensuring timers do not fire during migration windows.

### 24.1 Example

Source model:

```text
Review Task + boundary timer P7D
```

Instance has waited 5 days.

Target model:

```text
Review Task + boundary timer P10D
```

Question:

```text
Should the remaining time be 2 days, 5 days, or recalculated?
```

There is no universal answer. Business must decide.

### 24.2 Migration Strategy

For deadline-sensitive workflows:

1. avoid changing timer semantics casually;
2. keep old running instances on old version if possible;
3. deploy new version for new instances;
4. migrate only if required;
5. freeze timer-sensitive windows;
6. export active timer inventory;
7. define per-process migration rule;
8. validate after migration;
9. document deadline impact.

---

## 25. Timer Testing Strategy

Timer-heavy processes must be tested differently from simple service-task flows.

Test categories:

1. static timer expression validation;
2. dynamic timer variable availability;
3. duration semantics;
4. absolute date semantics;
5. timezone conversion;
6. boundary interrupting behavior;
7. boundary non-interrupting behavior;
8. event-based race between message and timer;
9. deadline extension;
10. late callback;
11. escalation side effects;
12. SLA projection;
13. process migration with active timer;
14. worker after timer fires;
15. incident after timer path.

### 25.1 Avoid Slow Tests

Do not wait real days/hours in test.

Use engine test utilities where possible, or design timer values injected by test variables.

Example test variable:

```json
{
  "reviewTimeout": "PT1S"
}
```

Production variable:

```json
{
  "reviewTimeout": "P5D"
}
```

But beware: if production uses business calendar absolute date, testing only `PT1S` may miss calculation bugs.

### 25.2 Test the Calendar Service Separately

Business calendar calculation deserves its own test suite:

- weekends;
- holidays;
- half-days;
- timezone;
- leap year;
- DST region if applicable;
- extension rule;
- submission after office hours;
- pause/resume;
- policy version changes.

---

## 26. Java Implementation: Deadline Calculator Boundary

A production-grade Java worker should not embed timer calculation casually inside handler code.

Recommended structure:

```text
worker adapter
  -> command parser / variable mapper
  -> application service
  -> domain deadline policy
  -> calendar repository
  -> result mapper
```

Example package:

```text
com.example.caseworkflow.worker.deadline
  CalculateReviewDeadlineWorker.java
  CalculateReviewDeadlineVariables.java
  CalculateReviewDeadlineResult.java

com.example.caseworkflow.domain.deadline
  DeadlinePolicy.java
  DeadlinePolicyCode.java
  BusinessCalendar.java
  DeadlineCalculator.java
  DeadlineCalculationAudit.java

com.example.caseworkflow.infrastructure.calendar
  DatabaseBusinessCalendarRepository.java
```

### 26.1 Example Java 17+ Record Style

```java
public record CalculateReviewDeadlineVariables(
    String caseId,
    String jurisdiction,
    String policyCode,
    OffsetDateTime clockStartAt
) {}

public record CalculateReviewDeadlineResult(
    SlaVariables sla
) {}

public record SlaVariables(
    String policyCode,
    OffsetDateTime clockStartAt,
    OffsetDateTime warningAt,
    OffsetDateTime dueAt,
    String calendarVersion,
    String calculationReason
) {}
```

### 26.2 Java 8 Compatible Style

```java
public final class CalculateReviewDeadlineVariables {
    private final String caseId;
    private final String jurisdiction;
    private final String policyCode;
    private final OffsetDateTime clockStartAt;

    public CalculateReviewDeadlineVariables(
            String caseId,
            String jurisdiction,
            String policyCode,
            OffsetDateTime clockStartAt) {
        this.caseId = Objects.requireNonNull(caseId, "caseId");
        this.jurisdiction = Objects.requireNonNull(jurisdiction, "jurisdiction");
        this.policyCode = Objects.requireNonNull(policyCode, "policyCode");
        this.clockStartAt = Objects.requireNonNull(clockStartAt, "clockStartAt");
    }

    public String getCaseId() { return caseId; }
    public String getJurisdiction() { return jurisdiction; }
    public String getPolicyCode() { return policyCode; }
    public OffsetDateTime getClockStartAt() { return clockStartAt; }
}
```

### 26.3 Worker Pseudo-Code

```java
public final class CalculateReviewDeadlineWorker {

    private final ObjectMapper objectMapper;
    private final DeadlineCalculator deadlineCalculator;

    public Map<String, Object> handle(Map<String, Object> variables) {
        CalculateReviewDeadlineVariables input = objectMapper.convertValue(
            variables,
            CalculateReviewDeadlineVariables.class
        );

        DeadlineCalculation calculation = deadlineCalculator.calculate(
            input.getJurisdiction(),
            input.getPolicyCode(),
            input.getClockStartAt()
        );

        Map<String, Object> output = new LinkedHashMap<>();
        output.put("sla", toSlaVariable(calculation));
        return output;
    }
}
```

Important:

- return only needed variables;
- include policy/calendar metadata;
- validate missing input as BPMN/business error if caller can fix;
- fail job only for technical/transient failure;
- do not compute deadline differently in multiple workers.

---

## 27. Regulatory Workflow Example

Scenario:

```text
A license renewal application must be reviewed within 5 working days after completeness check.
If no reviewer starts within 2 working days, notify lead.
If no decision by 5 working days, escalate to senior officer.
If applicant clarification is needed, SLA pauses until applicant responds.
If applicant does not respond within 14 calendar days, auto-close unless officer extends.
```

### 27.1 Process Model

```text
[Receive Renewal]
 -> [Completeness Check]
 -> if incomplete:
      [Request Clarification]
      [Wait Applicant Response]
          boundary timer P14D -> [Auto Close / Extension Review]
      -> [Completeness Check]
 -> if complete:
      [Calculate Review SLA]
      [Review Renewal User Task]
          dueDate = sla.dueAt
          followUpDate = sla.followUpAt
          non-interrupting boundary timer = sla.warningAt -> [Notify Lead]
          interrupting boundary timer = sla.dueAt -> [Escalate to Senior Officer]
      -> [Decision]
```

### 27.2 Why This Is Defensible

- completeness check defines SLA start;
- clarification wait is explicit;
- applicant timeout is explicit;
- review deadline is calculated by policy;
- due date visible to users;
- warning and escalation are executable behavior;
- audit metadata explains deadline;
- extension can be modelled explicitly;
- analytics can distinguish waiting-for-applicant from internal review delay.

---

## 28. Design Smells Around Time

### Smell 1 — Worker Sleeps

```java
Thread.sleep(Duration.ofDays(1).toMillis())
```

This is almost always wrong in workflow worker.

### Smell 2 — Scheduler Scans Everything Despite Process Timers

If every case has a clear deadline, a per-case timer is often better than global scan.

Scheduler scan may still be needed for reconciliation, but should not be the only source of process behavior.

### Smell 3 — Due Date Without Escalation Path

Task has due date, but nothing happens after due date.

Maybe acceptable for UI prioritization, but not for enforceable SLA.

### Smell 4 — BPMN Timer Without Business Calendar

`P5D` used for “5 working days”.

Wrong unless business explicitly means calendar duration.

### Smell 5 — Retry Backoff Used as Business Waiting

Retries are technical recovery, not business lifecycle.

### Smell 6 — Hidden Deadline Logic in FEEL

Long unreadable FEEL expression becomes untested policy code.

### Smell 7 — No Late Message Policy

Timeout path exists, but late callback not handled.

### Smell 8 — Timer Cycle Starts Unbounded Work

Recurring timer creates process instances faster than workers can process.

### Smell 9 — Timezone Not Explicit

Deadline displayed differently across systems.

### Smell 10 — SLA Reporting Derived from UI Due Date Only

Due date is not enough for SLA analytics; need clock start/stop/pause events.

---

## 29. Production Readiness Checklist

Before deploying timer-heavy process, verify:

### Timer Semantics

- [ ] Every timer has clear business/technical purpose.
- [ ] Duration/date/cycle choice is justified.
- [ ] Timer timezone/offset is explicit where needed.
- [ ] Timer expression variables exist before timer activation.
- [ ] Timer expression is simple enough to review.
- [ ] Complex calendar logic is in domain service, not hidden in BPMN.

### SLA/Deadline

- [ ] SLA start event is explicit.
- [ ] SLA stop event is explicit.
- [ ] Pause/resume rules are explicit.
- [ ] Working-day/calendar-day rules are defined.
- [ ] Holiday/calendar version is recorded.
- [ ] Deadline extension rule is modelled.
- [ ] Breach behavior is modelled.
- [ ] Warning behavior is modelled.

### Human Task

- [ ] Due date is not mistaken for escalation behavior.
- [ ] Follow-up date has UI/work management semantics.
- [ ] Boundary timer exists if process must act after timeout.
- [ ] Task cancellation behavior is understood.
- [ ] Users are notified when task is escalated/cancelled.

### External Waiting

- [ ] Callback wait state is explicit.
- [ ] Timeout path is explicit.
- [ ] Late callback policy exists.
- [ ] Duplicate callback policy exists.
- [ ] Correlation key is stable.
- [ ] Message TTL is intentional.

### Java Worker

- [ ] Worker does not sleep for business waiting.
- [ ] HTTP timeout, job timeout, retry backoff, and SLA are separate.
- [ ] Deadline calculator is tested.
- [ ] Date/time serialization preserves offset/timezone.
- [ ] Idempotency exists for reminder/escalation side effects.

### Operations

- [ ] Operate triage playbook exists.
- [ ] Alerts exist for SLA warning/breach.
- [ ] Dashboard distinguishes waiting, overdue, incident, and worker lag.
- [ ] Migration plan accounts for active timers.
- [ ] Load test includes timer bursts/cycles.

---

## 30. Top 1% Heuristics

A strong engineer does not ask only:

```text
How do I create a timer event?
```

They ask:

```text
What kind of time is this?
Who owns the rule?
Is it technical or business time?
Is it durable process state?
Does it need audit explanation?
What happens if it fires late?
What happens if message arrives at the same time?
What happens if deadline changes?
What happens if process is migrated?
What does user see?
What does operations see?
What does regulator/auditor see?
```

This is the difference between template-level BPMN usage and production-grade orchestration engineering.

---

## 31. Key Takeaways

1. Timer is durable process state, not sleeping code.
2. Job timeout, retry backoff, BPMN timer, due date, SLA, and statutory deadline are different concepts.
3. Use timer duration for simple relative waiting.
4. Use timer date for calculated business deadlines.
5. Use timer cycle carefully; avoid unbounded recurring bursts.
6. Due date helps task management; boundary timer changes process behavior.
7. Business calendar belongs in domain policy/calculation service.
8. Deadline metadata matters for audit and regulatory defensibility.
9. Late messages and timer/message races must be explicitly designed.
10. Timer-heavy process migration is risky and needs dedicated planning.
11. Timezone and offset must be explicit in cross-system workflow.
12. Worker must not sleep for business waiting.
13. SLA is not just a timer; it is a domain clock model plus executable behavior plus reporting.

---

## 32. References

- Camunda 8 Docs — Timer events: timer duration, date, cycle, intermediate and boundary timer semantics.
- Camunda 8 Docs — User tasks: due date, follow-up date, user task lifecycle, and task update APIs.
- Camunda 8 Docs — Job workers: timeout, retries, retry backoff, fail job behavior.
- Camunda 8 Docs — Incidents: incident creation and resolution semantics.
- Camunda 8 Docs — FEEL temporal expressions and expression usage in BPMN attributes.
- Camunda 8 Docs — Process instance migration and timer-related migration considerations.
- Camunda 8 Docs — Workflow patterns and modelling best practices.

---

## 33. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-013.md
```

Judul:

```text
Part 013 — User Tasks, Tasklist, Forms, Assignment, Candidate Groups, and Human Workflow Architecture
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-011.md">⬅️ Part 011 — Error Handling Semantics: BPMN Error, Job Failure, Incident, Escalation, and Business Rejection</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-013.md">Part 013 — User Tasks, Tasklist, Forms, Assignment, Candidate Groups, and Human Workflow Architecture ➡️</a>
</div>
