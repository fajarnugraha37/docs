# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-020.md

# Part 020 — Optimize, Process Analytics, Bottleneck Detection, and Feedback Loop Engineering

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `020`  
> Level: Advanced / Production Engineering  
> Fokus: Optimize, process intelligence, bottleneck detection, KPI engineering, continuous improvement loop, analytics correctness, and operational-to-business feedback.

---

## 0. Tujuan Bagian Ini

Pada part sebelumnya kita sudah membahas Tasklist dan human work management at scale. Di sana fokusnya adalah bagaimana pekerjaan manusia dibuat, ditampilkan, diklaim, diselesaikan, dan diaudit.

Bagian ini naik satu level: bukan lagi hanya bertanya:

> “Apakah process instance berjalan?”

Tetapi:

> “Apakah proses bisnis ini sehat, cepat, adil, efisien, defensible, dan membaik dari waktu ke waktu?”

Itulah ruang Optimize dan process analytics.

Setelah bagian ini, target pemahaman Anda:

1. Bisa membedakan **technical observability**, **operational monitoring**, dan **process intelligence**.
2. Bisa membaca Optimize bukan sebagai “dashboard cantik”, tetapi sebagai **feedback loop system**.
3. Bisa merancang KPI yang tidak menipu.
4. Bisa mendeteksi bottleneck yang benar, bukan sekadar node dengan durasi terbesar.
5. Bisa memahami keterbatasan data Optimize karena ia bergantung pada historical/projection/imported data.
6. Bisa mendesain variable dan BPMN supaya analitik di masa depan tetap berguna.
7. Bisa menghubungkan analytics ke engineering change, process redesign, SLA governance, dan compliance review.
8. Bisa tahu kapan Optimize cukup, dan kapan perlu custom data mart / warehouse / event pipeline.

---

## 1. Posisi Optimize dalam Camunda 8

Dalam Camunda 8, komponen besar dapat dipisahkan berdasarkan fungsi:

| Area | Komponen | Fungsi Utama |
|---|---|---|
| Runtime orchestration | Zeebe Broker | Source of truth untuk eksekusi proses |
| Runtime access | Gateway / API | Command/query entry point |
| Operational support | Operate | Debug, incident, process instance inspection |
| Human work | Tasklist | Work queue dan task execution surface |
| Identity/security | Identity/Admin | Access, auth, tenant/user/group management |
| Analytics/improvement | Optimize | Process intelligence, reports, dashboards, bottleneck analysis |

Optimize tidak menggantikan Operate. Operate menjawab pertanyaan seperti:

- process instance mana yang incident?
- job mana yang gagal?
- variable apa yang menyebabkan expression error?
- flow node mana yang aktif sekarang?
- perlu retry atau resolve incident?

Optimize menjawab pertanyaan berbeda:

- proses mana yang paling lambat?
- aktivitas mana yang menjadi bottleneck?
- berapa rata-rata cycle time?
- berapa persentase kasus yang melewati SLA?
- apakah perubahan proses bulan ini memperbaiki throughput?
- reviewer mana atau queue mana yang overload?
- jalur proses mana yang sering menyebabkan rework?
- apakah automation rate membaik?

Mental model-nya:

```text
Zeebe       = execute the process
Operate     = support the running process
Tasklist    = execute human tasks
Optimize    = learn from process execution
```

---

## 2. Optimize Bukan Source of Truth Runtime

Ini sangat penting.

Optimize bekerja dari data historis atau data yang diimpor dari runtime/projection layer. Ia bukan tempat untuk mengambil keputusan command-critical seperti:

- apakah job boleh di-complete?
- apakah instance saat ini sudah di node X?
- apakah message harus dikirim sekarang?
- apakah process state sudah committed?

Untuk decision runtime, sumber kebenaran adalah engine/runtime path.

Optimize cocok untuk:

- analisis historis,
- tren,
- agregasi,
- KPI,
- bottleneck,
- improvement planning,
- business monitoring,
- reporting.

Jadi jangan membuat pola seperti ini:

```text
Worker reads Optimize report -> decides whether to complete job
```

Itu desain yang salah.

Alur yang sehat:

```text
Zeebe execution records
        ↓
Exporter / secondary storage / import pipeline
        ↓
Optimize reports and dashboards
        ↓
Human/process owner/engineering review
        ↓
BPMN redesign / worker tuning / staffing change / policy change
        ↓
New process version / operational action
```

Optimize adalah **feedback loop**, bukan **runtime control loop**.

---

## 3. Technical Observability vs Operational Monitoring vs Process Intelligence

Sering terjadi kebingungan antara Prometheus/Grafana, Operate, Tasklist, dan Optimize. Mereka melihat sistem dari sudut berbeda.

### 3.1 Technical Observability

Contoh tool:

- Prometheus
- Grafana
- OpenTelemetry
- logs
- traces
- JFR
- APM

Pertanyaan yang dijawab:

- broker CPU tinggi?
- worker latency meningkat?
- exporter lag?
- gateway request error rate?
- DB connection pool penuh?
- JVM GC pause?
- HTTP dependency timeout?

Sudut pandang:

```text
software and infrastructure health
```

### 3.2 Operational Monitoring

Contoh tool:

- Operate
- Tasklist
- internal support dashboard

Pertanyaan yang dijawab:

- instance mana yang stuck?
- incident apa yang perlu diperbaiki?
- task apa yang belum dikerjakan?
- reviewer mana yang punya banyak pending work?
- job mana yang gagal karena external system?

Sudut pandang:

```text
current execution and support workload
```

### 3.3 Process Intelligence

Contoh tool:

- Optimize
- process mining platform
- BI dashboard
- process warehouse

Pertanyaan yang dijawab:

- apakah proses membaik?
- bottleneck utama di mana?
- variasi proses mana yang paling mahal?
- apakah SLA compliance meningkat?
- apakah automation berhasil mengurangi manual work?
- apakah policy baru memperpendek cycle time?

Sudut pandang:

```text
business process performance and improvement
```

### 3.4 Diagram Mental Model

```text
┌────────────────────────┐
│ Technical Observability│
│ "Is the system healthy?"│
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Operational Monitoring │
│ "Which work is stuck?" │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Process Intelligence   │
│ "Is the process good?" │
└────────────────────────┘
```

Top 1% engineer tidak mencampur ketiganya. Mereka tahu kapan memakai dashboard teknis, kapan memakai Operate, dan kapan memakai Optimize.

---

## 4. Data Flow: Dari Process Execution ke Analytics

Secara konseptual, data flow analytics Camunda 8 seperti ini:

```text
BPMN process execution
        │
        ▼
Zeebe record stream
        │
        ▼
Exporter / secondary storage
        │
        ▼
Operate / Tasklist / Optimize import/read model
        │
        ▼
Reports / dashboards / analysis
```

Konsekuensinya:

1. Analytics bersifat **event-derived**.
2. Analytics bisa mengalami **lag**.
3. Analytics bergantung pada **data yang diekspor/diimpor**.
4. Analytics tidak selalu real-time secara ketat.
5. Analytics quality bergantung pada model BPMN dan variable design.

Jika proses Anda tidak menyimpan milestone penting sebagai event/variable yang bisa dianalisis, Optimize tidak bisa secara ajaib mengetahui konteks bisnisnya.

Contoh buruk:

```json
{
  "status": "DONE",
  "data": "...giant nested payload..."
}
```

Contoh lebih analitik-friendly:

```json
{
  "caseType": "LICENSE_RENEWAL",
  "riskLevel": "HIGH",
  "channel": "INTERNET",
  "agencyUnit": "ENFORCEMENT",
  "submissionDate": "2026-06-01",
  "slaDueDate": "2026-06-14",
  "decisionOutcome": "APPROVED_WITH_CONDITION",
  "manualReviewRequired": true,
  "reworkCount": 2
}
```

Yang kedua bisa digunakan untuk:

- segmentasi,
- filtering,
- SLA analysis,
- bottleneck analysis,
- automation rate,
- rework analysis,
- trend analysis.

---

## 5. Apa Itu Process Analytics yang Baik?

Process analytics yang baik bukan sekadar menghitung durasi rata-rata.

Process analytics yang baik harus menjawab minimal 5 lapisan pertanyaan.

### 5.1 Volume

Berapa banyak kasus?

Contoh:

- total application submitted,
- total appeal created,
- total enforcement case opened,
- total renewal completed,
- total user task completed,
- total incidents created.

Volume membantu membaca beban sistem.

Tetapi volume saja tidak cukup. Volume naik bisa berarti demand naik, bukan proses memburuk.

### 5.2 Flow

Bagaimana kasus bergerak?

Contoh:

- jalur normal,
- jalur rework,
- jalur escalation,
- jalur rejection,
- jalur manual review,
- jalur timeout.

Flow membantu menemukan variasi proses.

### 5.3 Time

Berapa lama?

Contoh:

- end-to-end cycle time,
- task waiting time,
- task working time,
- queue time,
- external system waiting time,
- rework loop duration,
- escalation delay.

Time membantu menemukan bottleneck.

### 5.4 Quality

Apakah hasilnya benar?

Contoh:

- rejection rate,
- appeal rate,
- rework rate,
- correction rate,
- manual override rate,
- reopened case rate,
- incident recurrence.

Quality membantu menghindari optimasi palsu.

Proses yang cepat tetapi banyak salah bukan proses yang baik.

### 5.5 Compliance

Apakah proses memenuhi aturan?

Contoh:

- SLA compliance,
- statutory deadline compliance,
- maker-checker completion,
- audit evidence completeness,
- mandatory review completed,
- escalation performed before due date,
- segregation of duties honored.

Untuk regulatory workflow, compliance sering lebih penting daripada speed.

---

## 6. KPI Engineering: Jangan Membuat KPI yang Menipu

KPI yang buruk akan merusak perilaku organisasi.

Contoh KPI buruk:

```text
Average completion time must be below 2 days.
```

Masalah:

- rata-rata bisa diseret oleh kasus mudah,
- tidak membedakan low risk vs high risk,
- tidak melihat outlier,
- tidak melihat rework,
- bisa mendorong orang menutup kasus terlalu cepat,
- tidak membaca compliance.

KPI yang lebih baik:

```text
For standard low-risk renewal cases:
- P50 completion time <= 1 day
- P90 completion time <= 3 days
- SLA breach rate <= 2%
- rework rate <= 5%
- reopened case rate <= 1%
- manual override must be auditable
```

Perhatikan perbedaannya:

- ada segmentasi,
- ada percentile,
- ada quality guardrail,
- ada compliance guardrail,
- ada definisi proses spesifik.

### 6.1 KPI Harus Punya Denominator yang Jelas

Contoh salah:

```text
SLA breach count = 100
```

Apakah itu buruk? Belum tentu.

Jika total kasus 100, breach 100 berarti parah.
Jika total kasus 1.000.000, breach 100 mungkin 0.01%.

Gunakan rate:

```text
SLA breach rate = breached cases / eligible completed cases
```

Tetapi denominator juga harus jelas:

- Apakah cancelled cases dihitung?
- Apakah cases yang masih berjalan dihitung?
- Apakah suspended cases dihitung?
- Apakah cases dengan approved extension dihitung breach?
- Apakah clock pause diperhitungkan?

Tanpa definisi denominator, KPI hanya angka kosmetik.

### 6.2 KPI Harus Punya Segmentation

Contoh segmentasi:

- case type,
- risk level,
- channel,
- applicant type,
- region,
- agency unit,
- complexity,
- manual vs automated,
- process version,
- team/queue,
- priority.

Tanpa segmentasi, Anda akan menyalahkan proses yang salah.

Misal:

```text
Average completion time naik dari 3 hari ke 7 hari.
```

Kemungkinan penyebab:

1. proses memburuk,
2. case high-risk meningkat,
3. external agency lambat,
4. staffing turun,
5. policy baru menambah mandatory review,
6. reporting variable berubah,
7. process version baru menambahkan task baru,
8. batch backlog dari migrasi masuk.

Top 1% engineer tidak langsung menyimpulkan “sistem lambat”. Mereka memecah data.

---

## 7. Cycle Time, Lead Time, Waiting Time, Working Time

Banyak dashboard gagal karena semua durasi disebut “processing time”. Padahal durasi proses terdiri dari beberapa jenis waktu.

### 7.1 Lead Time

Waktu dari request masuk sampai outcome final.

```text
lead time = final outcome time - submission time
```

Cocok untuk sudut pandang customer/applicant.

### 7.2 Cycle Time

Waktu dari proses mulai dieksekusi sampai selesai.

```text
cycle time = process completion time - process start time
```

Kadang sama dengan lead time, kadang tidak.

Jika request masuk ke staging queue sebelum process instance dibuat, lead time lebih panjang dari cycle time.

### 7.3 Waiting Time

Waktu menunggu sebelum aktivitas dikerjakan.

Contoh:

- task created at 10:00,
- task claimed at 15:00,
- waiting time = 5 jam.

Waiting time sering menjadi bottleneck utama di human workflow.

### 7.4 Working Time

Waktu dari task mulai dikerjakan sampai selesai.

Contoh:

- task claimed at 15:00,
- task completed at 15:30,
- working time = 30 menit.

Jika waiting time 5 hari dan working time 30 menit, bottleneck bukan skill reviewer, tetapi queue/routing/capacity.

### 7.5 External Waiting Time

Waktu menunggu external system/agency/vendor.

Contoh:

- send verification request,
- wait for callback,
- receive verification result.

Ini harus dipisahkan dari internal team delay.

### 7.6 Rework Time

Waktu yang hilang karena loop balik.

Contoh:

```text
Review -> Request Clarification -> Applicant Resubmit -> Review Again
```

Jika rework tinggi, solusi bukan menambah worker thread. Solusi mungkin:

- form validation lebih baik,
- guidance applicant lebih jelas,
- policy clarification,
- pre-check automation,
- reviewer training.

---

## 8. Bottleneck Detection: Lebih Sulit dari Sekadar Durasi Terbesar

Bottleneck adalah titik yang membatasi throughput atau menyebabkan delay signifikan dalam konteks tujuan proses.

Node dengan durasi terbesar belum tentu bottleneck.

Contoh:

```text
Wait for Applicant Response = 14 days
Internal Review = 2 days
```

Apakah bottleneck-nya applicant? Mungkin. Tapi mungkin itu memang allowed response window.

Yang perlu ditanya:

1. Apakah durasi itu expected?
2. Apakah durasi itu controllable?
3. Apakah durasi itu berdampak ke SLA?
4. Apakah banyak instance menumpuk di sana?
5. Apakah node itu punya high variance?
6. Apakah node itu menyebabkan downstream starvation?
7. Apakah node itu muncul di jalur rework?
8. Apakah node itu baru bermasalah setelah process version tertentu?

### 8.1 Bottleneck Types

| Type | Gejala | Contoh | Solusi Umum |
|---|---|---|---|
| Queue bottleneck | banyak task menunggu claim | reviewer queue penuh | staffing, routing, prioritization |
| Skill bottleneck | hanya user tertentu bisa handle | legal review | cross-training, delegation |
| System bottleneck | worker/API lambat | external verification API | cache, async, capacity, contract fix |
| Policy bottleneck | step wajib terlalu berat | all cases need senior approval | risk-based routing |
| Data bottleneck | input sering tidak lengkap | clarification loop | validation/form redesign |
| Authorization bottleneck | approval tertahan | wrong group mapping | IAM/group fix |
| Integration bottleneck | callback lama | external agency | SLA with external party |
| Process design bottleneck | too many handoffs | maker -> checker -> supervisor | simplify decision path |

### 8.2 Bottleneck Detection Workflow

```text
1. Identify slow process variants
2. Segment by case type/risk/channel/version
3. Compare normal path vs exceptional path
4. Find high-duration/high-volume nodes
5. Separate waiting time vs working time
6. Check rework loops
7. Check SLA breach contribution
8. Validate with operational users
9. Form hypothesis
10. Change process or system
11. Measure after deployment
```

### 8.3 Bottleneck Red Flags

- satu task punya queue jauh lebih besar daripada task lain,
- P90 jauh lebih buruk dari P50,
- breach banyak berasal dari satu path,
- incident banyak terjadi pada job type tertentu,
- manual override meningkat,
- rework loop muncul setelah process version baru,
- user task sering unassigned terlalu lama,
- handoff terlalu banyak,
- automated task latency kecil tetapi cycle time tetap tinggi.

---

## 9. Percentile Lebih Berguna daripada Average

Average sering menipu.

Contoh:

```text
Case completion time:
- 90 cases selesai dalam 1 hari
- 10 cases selesai dalam 60 hari
```

Average:

```text
(90*1 + 10*60) / 100 = 6.9 hari
```

Average 6.9 hari tidak menggambarkan dua realita:

- mayoritas kasus sangat cepat,
- minoritas kasus sangat parah.

Gunakan:

```text
P50 = median
P75 = typical upper range
P90 = tail behavior
P95/P99 = extreme operational pain
```

Untuk regulatory/case management, tail behavior sering sangat penting karena kasus yang lama biasanya:

- high risk,
- legally sensitive,
- complaint-prone,
- appeal-prone,
- politically visible,
- audit-sensitive.

### 9.1 Metric Reading Pattern

| Metric | Arti |
|---|---|
| P50 baik, P90 buruk | mayoritas lancar, sebagian case stuck |
| P50 buruk, P90 buruk | proses secara umum lambat |
| P50 baik, breach rate tinggi | SLA mungkin ketat untuk subset tertentu |
| Average baik, P95 buruk | outlier disembunyikan average |
| Volume naik, P90 naik | capacity bottleneck mungkin muncul |
| Rework naik, duration naik | kualitas input/decision memburuk |

---

## 10. Variant Analysis: Jalur Proses Tidak Selalu Sama

Satu BPMN model bisa menghasilkan banyak path.

Contoh process application:

```text
Start
  -> Auto Eligibility Check
  -> Low Risk? yes -> Auto Approve -> End
  -> Low Risk? no  -> Manual Review
                     -> Need Clarification? yes -> Applicant Resubmit -> Manual Review
                     -> Need Legal? yes -> Legal Review
                     -> Decision
```

Variant dapat berupa:

1. auto-approved,
2. manual review only,
3. manual review + clarification,
4. manual review + legal,
5. manual review + clarification + legal,
6. rejected,
7. withdrawn,
8. escalated.

Jika semua variant digabung, insight hilang.

### 10.1 Pertanyaan Variant Analysis

- Variant mana paling sering?
- Variant mana paling lama?
- Variant mana paling banyak breach?
- Variant mana paling banyak rework?
- Variant mana meningkat setelah policy change?
- Variant mana punya outcome buruk?
- Variant mana harus diotomasi?
- Variant mana harus dipisah menjadi proses berbeda?

### 10.2 Variant as Design Signal

Jika satu process model punya terlalu banyak jalur ekstrem, mungkin model terlalu luas.

Contoh smell:

```text
One process handles application, renewal, appeal, enforcement, suspension, reinstatement, and complaint.
```

Mungkin lebih baik:

- application lifecycle process,
- renewal process,
- appeal process,
- enforcement case process,
- suspension/reinstatement subprocess.

Optimize membantu menemukan apakah model terlalu bercampur.

---

## 11. Automation Rate dan Human Workload

Automation rate sering menjadi KPI transformasi digital.

Contoh sederhana:

```text
automation rate = automated completed cases / total completed cases
```

Tetapi definisi ini bisa menipu.

Pertanyaan yang harus dijawab:

1. Apakah auto-approved case memang eligible?
2. Apakah automation meningkatkan error/reopen/appeal?
3. Apakah automation hanya memindahkan kerja ke exception handling?
4. Apakah manual workload turun secara nyata?
5. Apakah automated path punya audit evidence cukup?

### 11.1 Better Automation Metrics

Gunakan kombinasi:

```text
- straight-through processing rate
- manual review rate
- manual override rate
- exception handling rate
- rework rate
- appeal/reopen rate
- SLA breach rate by automated/manual path
- incident rate by automated step
```

### 11.2 Human Workload Metrics

Untuk Tasklist/human workflow:

```text
- task created count
- task completed count
- task backlog
- unassigned task age
- claimed-but-not-completed age
- average waiting time
- average working time
- reassignment count
- return-to-queue count
- escalation count
- overdue task count
```

Jika workload tinggi, jangan langsung menambah orang. Bisa jadi:

- routing salah,
- task terlalu granular,
- form buruk,
- data tidak lengkap,
- approval policy terlalu banyak,
- candidate group terlalu sempit,
- task tidak diprioritaskan,
- custom UI sulit digunakan.

---

## 12. SLA Analytics

SLA analytics harus sangat eksplisit.

Contoh buruk:

```text
Process must complete within 14 days.
```

Pertanyaan:

- 14 calendar days atau business days?
- mulai dihitung dari submission atau process start?
- berhenti saat applicant diminta klarifikasi?
- extension legal dihitung bagaimana?
- cancelled case dihitung?
- withdrawn case dihitung?
- external agency delay dihitung sebagai breach internal?
- SLA per risk level sama?
- SLA per case type sama?

### 12.1 SLA Clock Model

Untuk proses regulasi, Anda biasanya butuh explicit SLA model.

Contoh variable:

```json
{
  "sla": {
    "startedAt": "2026-06-01T09:00:00+07:00",
    "dueAt": "2026-06-14T23:59:59+07:00",
    "clockType": "BUSINESS_DAYS",
    "status": "RUNNING",
    "paused": false,
    "pauseReason": null,
    "extensionCount": 1,
    "extensionReason": "AWAITING_EXTERNAL_AGENCY_RESPONSE"
  }
}
```

### 12.2 SLA Reporting Dimensions

SLA dashboard sebaiknya bisa difilter berdasarkan:

- process id,
- process version,
- case type,
- risk level,
- agency unit,
- assigned team,
- channel,
- applicant category,
- external dependency,
- outcome,
- breach reason,
- extension reason.

### 12.3 SLA Breach Classification

Tidak semua breach sama.

| Breach Type | Meaning | Action |
|---|---|---|
| Internal queue breach | task menunggu terlalu lama | capacity/routing |
| External dependency breach | menunggu pihak luar | SLA vendor/agency |
| Applicant response breach | applicant lambat | reminder/closure policy |
| System incident breach | technical failure | reliability fix |
| Policy complexity breach | mandatory review terlalu berat | policy redesign |
| Data quality breach | input sering salah | validation/form improvement |

Tanpa classification, SLA breach dashboard hanya menyalahkan “process”.

---

## 13. Incident Analytics

Incident di Operate adalah objek support. Di Optimize/analytics, incident adalah signal process/system quality.

Pertanyaan incident analytics:

- job type mana paling sering incident?
- process version mana paling banyak incident?
- variable mapping mana sering gagal?
- incident recovery time berapa?
- incident berulang setelah deploy?
- incident menyebabkan SLA breach berapa banyak?
- incident terjadi pada subset case tertentu?

### 13.1 Incident Metrics

```text
incident count
incident rate = incident count / process instance count
mean time to detect incident
mean time to resolve incident
incident recurrence rate
incident by job type
incident by process version
incident by worker version
incident by error code
incident impact on SLA
```

### 13.2 Incident Taxonomy

Agar analitik berguna, error message harus distandardisasi.

Contoh buruk:

```text
Something went wrong
```

Contoh baik:

```text
EXTERNAL_AGENCY_TIMEOUT: agency=ROM, endpoint=/verify-license, timeoutMs=3000
```

Atau:

```text
VARIABLE_SCHEMA_INVALID: missing required field applicant.nricHash
```

Worker harus mengirim error message yang cukup informatif, tapi tidak membocorkan PII/secrets.

---

## 14. Variable Design untuk Analytics

Optimize hanya bisa menganalisis data yang tersedia dan dapat dimengerti.

Jadi variable design bukan hanya runtime concern, tetapi analytics concern.

### 14.1 Analytics-Friendly Variable Principles

1. Gunakan field eksplisit untuk dimensi bisnis.
2. Hindari menyimpan semua konteks dalam nested blob raksasa.
3. Hindari nama variable yang berubah-ubah.
4. Gunakan enum stabil.
5. Simpan timestamps milestone penting.
6. Simpan classification reason.
7. Jangan simpan PII mentah jika tidak perlu.
8. Gunakan reference id untuk data besar.
9. Version-kan schema.
10. Pisahkan operational status dan business outcome.

### 14.2 Useful Variables

Contoh:

```json
{
  "caseType": "APPEAL",
  "riskLevel": "HIGH",
  "submissionChannel": "INTERNET",
  "requiresManualReview": true,
  "requiresLegalReview": true,
  "externalAgency": "ROM",
  "decisionOutcome": "REJECTED",
  "rejectionReasonCode": "MISSING_ELIGIBILITY",
  "appealSubmitted": true,
  "reworkCount": 3,
  "clarificationCount": 2,
  "processSchemaVersion": 4
}
```

### 14.3 Dangerous Variables

```json
{
  "applicantName": "...",
  "fullNRIC": "...",
  "fullAddress": "...",
  "entireUploadedDocumentBase64": "...",
  "rawExternalSystemResponse": "..."
}
```

Masalah:

- PII exposure,
- index bloat,
- slow import,
- poor search/filter quality,
- compliance risk,
- accidental leakage in dashboards.

### 14.4 Analytics Contract Review

Setiap proses production-grade perlu pertanyaan:

```text
What future reports do we need from this process?
```

Jika jawabannya diketahui, desain variable sejak awal.

---

## 15. Dashboard Design: Dari Operational ke Strategic

Dashboard yang baik punya lapisan.

### 15.1 Executive Dashboard

Pertanyaan:

- apakah SLA dipenuhi?
- apakah volume naik?
- apakah backlog sehat?
- apakah proses membaik?
- apakah automation menghasilkan benefit?

Metric:

- total cases,
- completion rate,
- SLA breach rate,
- P50/P90 cycle time,
- backlog age,
- automation rate,
- appeal/rework rate.

### 15.2 Process Owner Dashboard

Pertanyaan:

- bottleneck di mana?
- jalur mana yang bermasalah?
- task mana yang lambat?
- risk level mana yang menyumbang delay?
- process version mana lebih baik?

Metric:

- duration by flow node,
- variant frequency,
- rework loops,
- user task heatmap,
- breach by step,
- outcome by path,
- incident by job type.

### 15.3 Team Lead Dashboard

Pertanyaan:

- queue mana overload?
- user/group mana backlog?
- task mana overdue?
- reassignment tinggi di mana?
- siapa butuh support?

Metric:

- unassigned task count,
- average task age,
- claimed task age,
- completed per user/team,
- escalation count,
- task return count,
- workload by candidate group.

### 15.4 Engineering Dashboard

Pertanyaan:

- worker mana menyebabkan incident?
- process version mana error?
- external dependency mana lambat?
- apakah deploy baru memperburuk metric?

Metric:

- incident by worker/job type,
- retry count,
- BPMN error frequency,
- external API latency category,
- process version comparison,
- variable schema error count,
- exporter/import lag if available.

### 15.5 Compliance Dashboard

Pertanyaan:

- apakah statutory deadline dipenuhi?
- apakah mandatory review dilakukan?
- apakah maker-checker dipatuhi?
- apakah extension/override punya alasan?
- apakah audit evidence lengkap?

Metric:

- breach classification,
- extension count/reason,
- skipped mandatory step count,
- override count,
- decision reason completeness,
- audit evidence missing count,
- segregation-of-duty violation count.

---

## 16. Feedback Loop Engineering

Optimize seharusnya menghasilkan perubahan, bukan hanya laporan.

### 16.1 The Loop

```text
Observe
  -> Analyze
  -> Hypothesize
  -> Change
  -> Deploy
  -> Measure
  -> Institutionalize
```

### 16.2 Observe

Kumpulkan signal:

- dashboard Optimize,
- Operate incident,
- Tasklist backlog,
- worker logs,
- user complaint,
- support ticket,
- SLA breach.

### 16.3 Analyze

Pisahkan:

- process issue,
- technical issue,
- staffing issue,
- policy issue,
- data quality issue,
- external dependency issue.

### 16.4 Hypothesize

Contoh hypothesis:

```text
High-risk cases breach SLA because legal review is triggered too late.
```

Atau:

```text
Clarification loops are high because initial application form does not validate supporting document completeness.
```

Atau:

```text
External verification worker causes delay because it retries transient API timeout too aggressively and creates incident storms.
```

### 16.5 Change

Perubahan bisa berupa:

- BPMN redesign,
- worker tuning,
- retry policy update,
- form validation improvement,
- candidate group change,
- SLA rule change,
- task priority logic,
- external API contract change,
- staffing adjustment,
- policy clarification.

### 16.6 Measure

Bandingkan before/after:

- process version A vs B,
- month-over-month,
- high-risk only,
- affected team only,
- automation path only,
- pilot group vs control group.

### 16.7 Institutionalize

Jika berhasil:

- update modelling guideline,
- update worker template,
- update variable contract,
- update dashboard baseline,
- update runbook,
- update SLA policy,
- update training.

Tanpa institutionalization, improvement akan hilang di project berikutnya.

---

## 17. Process Version Comparison

Setelah process model berubah, Anda harus membuktikan apakah lebih baik.

Contoh:

```text
Version 12:
- P50 cycle time: 3.2 days
- P90 cycle time: 14.7 days
- breach rate: 11%
- rework rate: 19%

Version 13:
- P50 cycle time: 2.1 days
- P90 cycle time: 8.4 days
- breach rate: 5%
- rework rate: 7%
```

Kelihatannya version 13 lebih baik.

Tapi cek dulu:

- Apakah case mix sama?
- Apakah volume sama?
- Apakah high-risk percentage turun?
- Apakah period ada holiday?
- Apakah staffing naik?
- Apakah external system berubah?
- Apakah cancelled cases dikecualikan?
- Apakah variable definition berubah?

Jika tidak dikontrol, process version comparison bisa misleading.

### 17.1 Safe Version Comparison Checklist

```text
[ ] Same case type segment
[ ] Same risk segment
[ ] Similar volume
[ ] Similar calendar context
[ ] Same SLA definition
[ ] Same completion definition
[ ] Same exclusion rules
[ ] Same variable schema or mapped compatibility
[ ] Same user group/capacity context or explicitly adjusted
[ ] External dependency changes noted
```

---

## 18. Cohort Analysis

Cohort analysis berarti membandingkan group berdasarkan waktu masuk atau karakteristik tertentu.

Contoh:

```text
Cases submitted in week 1 after policy change
vs
cases submitted in week 2 after policy change
vs
cases submitted in week 3 after policy change
```

Atau:

```text
Cases created before new worker deployment
vs
cases created after new worker deployment
```

Cohort analysis berguna untuk:

- rollout policy,
- new BPMN version,
- new worker version,
- staffing change,
- new form validation,
- new external integration,
- migration from Camunda 7.

### 18.1 Cohort Dimensions

- process start date,
- process version,
- business policy version,
- worker app version,
- deployment date,
- channel,
- region,
- team,
- applicant type.

Untuk mendukung ini, simpan variable seperti:

```json
{
  "policyVersion": "2026-Q2",
  "workerContractVersion": "verification-v3",
  "formVersion": "application-form-v12"
}
```

---

## 19. Process Mining vs Optimize

Optimize menyediakan process intelligence yang terintegrasi dengan Camunda.

Process mining secara umum biasanya berfokus pada:

- event log extraction,
- discovered process model,
- conformance checking,
- variant analysis,
- bottleneck analysis,
- deviation detection.

Optimize lebih dekat ke process analytics/reporting yang native untuk Camunda. Process mining platform mungkin lebih kuat untuk discovery/conformance terhadap multi-system event logs.

### 19.1 Kapan Optimize Cukup?

Optimize cukup jika:

- proses utama dieksekusi di Camunda,
- analytics yang dibutuhkan berbasis BPMN/process instance/user task/variables,
- business user butuh dashboard cepat,
- improvement loop masih dalam scope process orchestration,
- tidak butuh advanced multi-system mining.

### 19.2 Kapan Butuh Custom Warehouse atau Process Mining?

Butuh tambahan jika:

- proses tersebar di banyak sistem non-Camunda,
- butuh join dengan data finansial/customer/ERP besar,
- butuh long-term historical warehouse,
- butuh advanced conformance checking,
- butuh predictive analytics,
- butuh regulatory reporting kompleks,
- butuh data model yang tidak cocok dengan Optimize,
- butuh strict data lineage dan reconciliation.

### 19.3 Hybrid Architecture

```text
Zeebe records / Optimize data / business DB / external system logs
        ↓
Data pipeline
        ↓
Process warehouse / lakehouse
        ↓
BI / process mining / ML / compliance reporting
```

Optimize tetap berguna sebagai fast operational process intelligence layer.

---

## 20. Analytics Correctness: Common Traps

### 20.1 Trap: Average Duration Only

Masalah:

- menyembunyikan tail latency,
- tidak membedakan case complexity,
- mudah dimanipulasi.

Solusi:

- gunakan percentile,
- segmentasi,
- breach rate,
- rework rate.

### 20.2 Trap: Completed Cases Only

Jika hanya melihat completed cases, Anda kehilangan kasus yang stuck.

Contoh:

```text
Average completed case time improved
```

Tapi mungkin karena kasus sulit belum selesai dan masih backlog.

Solusi:

- lihat active case age,
- backlog age,
- overdue active instances,
- open case WIP.

### 20.3 Trap: No Process Version Filter

Jika version lama dan baru digabung, insight kabur.

Solusi:

- filter by process version,
- compare cohort,
- document release date.

### 20.4 Trap: No Business Segment

Low-risk dan high-risk digabung.

Solusi:

- segment by risk,
- segment by case type,
- segment by channel.

### 20.5 Trap: KPI Without Outcome Quality

Contoh:

```text
Completion time improved by 50%.
```

Tapi appeal rate naik 200%.

Solusi:

- pair speed metric with quality metric.

### 20.6 Trap: Dashboard as Blame Tool

Jika dashboard dipakai untuk menghukum user/team, data akan dimanipulasi.

Solusi:

- gunakan dashboard sebagai improvement tool,
- kombinasikan dengan qualitative review,
- hindari metric yang mendorong gaming.

### 20.7 Trap: Variable Schema Drift

Variable `riskLevel` berubah dari:

```text
LOW, MEDIUM, HIGH
```

Menjadi:

```text
L, M, H, CRITICAL
```

Report lama rusak.

Solusi:

- schema versioning,
- controlled enum,
- compatibility mapping.

---

## 21. Governance: Siapa Pemilik Metric?

Metric tanpa owner akan mati.

Setiap dashboard perlu:

```text
- owner
- audience
- definition
- data source
- refresh/import expectation
- decision it supports
- action threshold
- review cadence
```

Contoh:

```text
Metric: SLA breach rate for high-risk enforcement cases
Owner: Enforcement Process Owner
Audience: Head of Operations, TL, Compliance
Definition: completed high-risk enforcement cases whose final decision timestamp exceeds statutory due date, excluding formally suspended cases
Source: Camunda process variables + process completion event
Threshold: >5% weekly breach triggers root cause review
Cadence: weekly
Action: capacity review, escalation policy review, legal dependency review
```

Tanpa definisi seperti ini, dashboard menjadi pajangan.

---

## 22. Optimize untuk Regulatory / Enforcement Lifecycle

Untuk domain regulatory/case management, Optimize sangat berguna jika proses dimodelkan dengan milestone yang benar.

### 22.1 Common Regulatory Metrics

```text
- application received count
- case opened count
- case accepted/rejected count
- average assessment duration
- P90 investigation duration
- clarification request rate
- appeal rate
- enforcement escalation rate
- statutory deadline breach rate
- manual override rate
- legal review rate
- evidence missing rate
- reopened case rate
- suspended case count
- external agency waiting time
```

### 22.2 Regulatory Bottlenecks

Bottleneck umum:

- assignment delay,
- evidence completeness,
- legal review capacity,
- external agency response,
- approval hierarchy,
- unclear policy interpretation,
- manual document checking,
- back-and-forth clarification.

### 22.3 Defensible Analytics

Regulatory analytics harus bisa menjawab:

```text
Why was this case delayed?
Was the delay justified?
Who held the task?
Was escalation triggered?
Was the applicant waiting window respected?
Was extension approved?
Were mandatory reviews completed?
Was the decision reason captured?
```

Untuk itu, proses harus menyimpan:

- milestone timestamps,
- reason codes,
- extension reasons,
- decision outcomes,
- escalation events,
- assignment ownership,
- evidence references.

---

## 23. Designing BPMN for Future Analytics

BPMN yang terlalu teknis membuat Optimize sulit dibaca.

Contoh buruk:

```text
Task A -> Task B -> Task C -> Task D
```

Tidak jelas secara bisnis.

Contoh lebih baik:

```text
Receive Application
-> Validate Eligibility
-> Assess Risk
-> Conduct Manual Review
-> Request Clarification
-> Make Decision
-> Notify Applicant
```

### 23.1 Naming Matters

Flow node name menjadi bagian dari analisis.

Gunakan nama yang:

- business meaningful,
- stable,
- action-oriented,
- tidak terlalu teknis,
- tidak menyebut implementasi internal.

Hindari:

```text
Call API 1
Transform Payload
Update DB
Send HTTP Request
Worker Step 3
```

Gunakan:

```text
Verify Applicant Identity
Calculate Risk Rating
Record Assessment Outcome
Notify Applicant of Decision
```

### 23.2 Milestone Events

Jika milestone penting, jangan disembunyikan dalam worker internal.

Contoh milestone:

- application accepted,
- risk assessment completed,
- manual review started,
- clarification requested,
- clarification received,
- legal review completed,
- decision made,
- appeal received,
- enforcement escalated.

Milestone ini membantu analytics.

### 23.3 Avoid Over-Modelling

Jangan semua method Java dijadikan task BPMN.

Jika satu aktivitas hanya transformasi internal tanpa makna bisnis atau operational support value, mungkin cukup di dalam worker.

Rule of thumb:

```text
Model what you want to observe, govern, wait for, retry, assign, escalate, audit, or improve.
Do not model every line of code.
```

---

## 24. Combining Optimize with Engineering Telemetry

Optimize menunjukkan proses lambat. Engineering telemetry menunjukkan kenapa secara teknis.

Contoh:

Optimize:

```text
External Verification step P90 duration naik dari 10s ke 2h.
```

Telemetry:

```text
verification-worker HTTP timeout rate naik
external agency API 503
worker retry storm
connection pool exhausted
```

Gabungan insight:

```text
Process delay caused by external API instability and retry policy amplification.
```

Action:

- adjust retry backoff,
- circuit breaker,
- external SLA escalation,
- fallback manual path,
- incident classification,
- dashboard alert.

### 24.1 Correlation Fields

Pastikan log/traces punya:

```text
processInstanceKey
bpmnProcessId
processVersion
jobType
jobKey
businessKey/caseId
correlationKey
tenantId
workerVersion
externalRequestId
```

Ini memungkinkan bridging antara Optimize insight dan technical traces.

---

## 25. Alerting: Optimize Alert vs Technical Alert

Tidak semua alert harus technical.

### 25.1 Technical Alert

Contoh:

```text
worker error rate > 5% for 10 minutes
exporter lag > threshold
broker disk usage > 80%
```

### 25.2 Process Alert

Contoh:

```text
SLA breach rate for high-risk cases > 5% this week
unassigned legal review tasks older than 2 days > 20
clarification loop rate > 15%
```

### 25.3 Alert Quality

Alert yang baik:

- actionable,
- owned,
- threshold jelas,
- punya runbook,
- tidak noisy,
- punya severity,
- punya business context.

Alert buruk:

```text
Average process duration increased.
```

Alert baik:

```text
P90 cycle time for high-risk renewal cases in process version 17 exceeded 10 business days for 3 consecutive days, with 65% delay attributed to Legal Review queue.
```

---

## 26. Data Retention and Historical Analysis

Analytics membutuhkan history. Tetapi history punya biaya:

- storage,
- index size,
- query performance,
- privacy risk,
- retention compliance,
- backup/restore complexity.

Pertanyaan desain:

1. Berapa lama process analytics harus tersedia?
2. Apakah raw event history harus disimpan selamanya?
3. Apakah dashboard butuh 3 bulan, 1 tahun, 7 tahun?
4. Apakah PII harus dihapus/anonymized?
5. Apakah aggregated metrics cukup untuk long-term trend?
6. Apakah compliance membutuhkan immutable audit archive?

### 26.1 Retention Strategy

```text
Hot analytics:
- recent detailed data
- interactive dashboard
- short query latency

Warm analytics:
- older summarized data
- slower query acceptable

Cold archive:
- audit/compliance evidence
- rarely queried
- immutable/controlled access
```

Optimize mungkin menjadi hot/warm process intelligence layer, tetapi regulated archive sering butuh desain terpisah.

---

## 27. Custom Analytics Architecture

Untuk sistem enterprise, Anda mungkin butuh analytics di luar Optimize.

### 27.1 When

Gunakan custom analytics jika:

- butuh join dengan banyak domain table,
- butuh retention sangat panjang,
- butuh regulatory evidence store,
- butuh custom metric kompleks,
- butuh predictive modelling,
- butuh cross-platform process mining,
- butuh data governance enterprise,
- butuh near-real-time command-independent read model.

### 27.2 Possible Architecture

```text
Zeebe exporter / Elasticsearch / OpenSearch / business outbox
        ↓
Streaming or batch pipeline
        ↓
Process analytics warehouse
        ↓
Semantic metric layer
        ↓
BI dashboard / Optimize / custom report / process mining
```

### 27.3 Event Model

Custom analytics sebaiknya punya normalized event model:

```json
{
  "eventId": "evt-123",
  "processInstanceKey": "2251799813685249",
  "bpmnProcessId": "license-renewal",
  "processVersion": 17,
  "caseId": "CASE-2026-000123",
  "eventType": "USER_TASK_COMPLETED",
  "activityId": "manual-review",
  "activityName": "Conduct Manual Review",
  "timestamp": "2026-06-21T10:15:00+07:00",
  "actorType": "USER",
  "actorGroup": "REVIEWER_LEVEL_2",
  "tenantId": "agency-a",
  "attributes": {
    "riskLevel": "HIGH",
    "outcome": "REQUEST_CLARIFICATION"
  }
}
```

---

## 28. Concrete Example: Renewal Process Improvement

### 28.1 Initial Observation

Optimize dashboard:

```text
Renewal process P90 cycle time increased from 4 days to 12 days.
SLA breach rate increased from 3% to 18%.
```

### 28.2 First Segmentation

By risk level:

```text
LOW risk: P90 2 days, breach 1%
MEDIUM risk: P90 5 days, breach 4%
HIGH risk: P90 21 days, breach 39%
```

Conclusion:

```text
Not all renewal cases are slow. High-risk cases are the problem.
```

### 28.3 Flow Node Duration

High-risk cases:

```text
Manual Review waiting time: P90 8 days
Legal Review waiting time: P90 9 days
External Verification waiting time: P90 3 days
Working time per task: under 1 hour
```

Conclusion:

```text
The issue is queue/waiting, not task complexity during execution.
```

### 28.4 Variant Analysis

High-risk cases with clarification loop:

```text
Clarification rate: 44%
Average loops: 2.3
Clarification path breach contribution: 71%
```

Conclusion:

```text
Input quality is causing rework, and legal review queue worsens tail delay.
```

### 28.5 Hypothesis

```text
High-risk renewal cases breach SLA because required documents are incomplete at submission, causing clarification loops and late legal review.
```

### 28.6 Changes

Engineering/process changes:

1. Add pre-submission document completeness validation.
2. Add risk-based early legal review trigger.
3. Add automatic escalation if legal review unassigned after 2 business days.
4. Add dedicated high-risk review candidate group.
5. Add `clarificationReasonCode` variable.
6. Add `legalReviewRequiredAt` milestone.

### 28.7 After Measurement

Version 18 vs 17:

```text
High-risk P90 cycle time: 21 days -> 9 days
Breach rate: 39% -> 11%
Clarification rate: 44% -> 18%
Legal review waiting P90: 9 days -> 3 days
Appeal rate: unchanged
```

Good result because speed improved without quality degradation.

---

## 29. Java Engineer’s Role in Optimize Success

A Java engineer may think Optimize is a business-user tool. That is only half true.

Engineering decisions determine whether Optimize data is useful.

### 29.1 Worker Error Design

Bad:

```java
throw new RuntimeException("Failed");
```

Better:

```java
throw new ExternalDependencyException(
    "EXTERNAL_VERIFICATION_TIMEOUT",
    "Verification provider timed out after configured threshold"
);
```

Then fail job with meaningful error message/code.

### 29.2 Variable Contract Design

Bad:

```java
variables.put("result", response);
```

Better:

```java
variables.put("verificationOutcome", "MATCHED");
variables.put("verificationProvider", "AGENCY_X");
variables.put("verificationCompletedAt", clock.now().toString());
variables.put("verificationAttemptCount", attemptCount);
```

### 29.3 Milestone Recording

If a milestone matters analytically, expose it as process event/variable, not hidden log line.

### 29.4 Worker Version

Store or log worker version when helpful:

```text
workerVersion=verification-worker-2.4.1
```

This helps compare before/after deployment.

### 29.5 Avoid Analytics-Hostile Design

- random variable names,
- unbounded nested payloads,
- PII-heavy variables,
- no outcome code,
- no reason code,
- no schema version,
- no process version discipline,
- no correlation ID.

---

## 30. Optimize Readiness Checklist

### 30.1 BPMN Model Checklist

```text
[ ] Flow node names are business meaningful
[ ] Major milestones are represented
[ ] Human tasks are not hidden inside service tasks
[ ] Rework loops are explicit
[ ] Escalation paths are explicit
[ ] Exception paths are explicit
[ ] Call activities have clear business boundary
[ ] Process versions are governed
```

### 30.2 Variable Checklist

```text
[ ] caseType exists
[ ] riskLevel exists if relevant
[ ] channel/source exists
[ ] outcome code exists
[ ] rejection/clarification/rework reason code exists
[ ] SLA due date exists if needed
[ ] extension/suspension reason exists if needed
[ ] schema version exists
[ ] PII is minimized
[ ] large documents are referenced, not embedded
```

### 30.3 KPI Checklist

```text
[ ] KPI has owner
[ ] KPI has exact definition
[ ] denominator is clear
[ ] exclusions are clear
[ ] segmentation is clear
[ ] threshold is clear
[ ] action is clear
[ ] review cadence is clear
[ ] paired quality guardrail exists
```

### 30.4 Dashboard Checklist

```text
[ ] Dashboard has audience
[ ] Dashboard answers real decisions
[ ] Dashboard separates active vs completed cases
[ ] Dashboard uses percentiles where needed
[ ] Dashboard has process version filter
[ ] Dashboard has business segment filters
[ ] Dashboard avoids vanity metrics
[ ] Dashboard has runbook/action path
```

### 30.5 Improvement Loop Checklist

```text
[ ] Observation captured
[ ] Hypothesis written
[ ] Root cause validated
[ ] Change implemented
[ ] Before/after measured
[ ] Side effects checked
[ ] Learning documented
[ ] Standard updated
```

---

## 31. Anti-Patterns

### 31.1 Dashboard-Driven Panic

Melihat metric naik lalu langsung mengubah proses tanpa segmentasi.

Correct approach:

```text
Segment -> validate -> hypothesize -> change -> measure
```

### 31.2 Vanity Dashboard

Dashboard berisi angka besar tetapi tidak mendukung keputusan.

Contoh:

```text
Total process instances since launch
```

Bisa berguna, tetapi sering tidak actionable.

### 31.3 KPI Without Ownership

Metric tanpa owner tidak akan diperbaiki.

### 31.4 Optimizing for Speed Only

Mempercepat proses tetapi menaikkan appeal/reopen/rework.

### 31.5 Hiding Human Work in Service Task

Jika human decision dilakukan di luar Tasklist/custom task system dan hanya dicatat sebagai service task, analytics kehilangan visibility.

### 31.6 No Process Version Filter

Membandingkan data campur antara version lama dan baru.

### 31.7 No Reason Codes

Outcome ada, tapi alasan tidak ada. Analytics menjadi dangkal.

### 31.8 PII Dumping

Menyimpan data sensitif di variables demi “biar gampang report”. Ini security/compliance smell.

### 31.9 Treating Optimize as Runtime API

Menggunakan Optimize report untuk command decision. Ini salah boundary.

### 31.10 Ignoring Active Backlog

Hanya melihat completed instances, sementara active backlog memburuk.

---

## 32. Staff-Level Heuristics

Gunakan heuristik ini saat design/review.

### 32.1 Metric Pairing

Setiap speed metric harus dipasangkan dengan quality metric.

```text
cycle time + rework rate
completion rate + appeal rate
automation rate + manual override rate
SLA rate + extension reason distribution
```

### 32.2 Segment Before You Optimize

Jangan optimasi aggregate sebelum segmentasi.

```text
Aggregate metric tells you something is happening.
Segmented metric tells you where.
Operational evidence tells you why.
```

### 32.3 Model What You Need to Govern

Jika sebuah aktivitas perlu SLA, assignment, audit, escalation, atau analytics, jadikan ia eksplisit di BPMN atau event model.

### 32.4 Dashboards Must Drive Actions

Dashboard tanpa action path adalah decoration.

### 32.5 Beware of Queue Time

Di human workflow, bottleneck sering bukan working time, tetapi waiting time.

### 32.6 Optimize Is Only as Good as Your Process Contract

Jika BPMN dan variables buruk, Optimize tidak bisa menghasilkan insight dalam.

### 32.7 Compare Versions Carefully

Process version comparison tanpa kontrol case mix bisa salah arah.

### 32.8 Regulatory Analytics Needs Reason Codes

Untuk defensibility, alasan sering lebih penting daripada status.

---

## 33. Mini Architecture: Process Intelligence Stack

```text
┌──────────────────────────────────────────────┐
│                Business Users                 │
│ process owner, team lead, compliance, PM      │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│                  Optimize                     │
│ reports, dashboards, filters, bottlenecks     │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│           Imported / Projected History        │
│ process instances, variables, tasks, incidents│
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│              Zeebe Exported Records           │
│ source events from process execution          │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│                  Zeebe Runtime                │
│ commands, events, state, jobs, timers         │
└──────────────────────────────────────────────┘
```

Boundary:

```text
Runtime correctness ≠ analytics correctness
Analytics insight ≠ immediate process command
Dashboard metric ≠ root cause
```

---

## 34. Practical Exercise

Ambil satu proses yang Anda kenal, misalnya:

```text
Application Review Process
```

Buat tabel berikut:

| Question | Answer |
|---|---|
| Apa outcome final? | Approved / Rejected / Withdrawn |
| Apa SLA utama? | 14 business days |
| Apa segmentation utama? | riskLevel, channel, caseType |
| Apa rework loop? | Request clarification |
| Apa external wait? | External agency verification |
| Apa human bottleneck potensial? | Manual review / legal review |
| Apa quality metric? | appeal rate, reopen rate |
| Apa compliance metric? | mandatory review completed, SLA breach reason |
| Apa variable wajib? | riskLevel, dueAt, outcome, reasonCode, reworkCount |
| Apa dashboard audience? | process owner, team lead, compliance |

Lalu desain 5 report:

1. Cycle time by risk level.
2. SLA breach rate by breach reason.
3. Task waiting time by candidate group.
4. Clarification loop count by case type.
5. Process version comparison before/after improvement.

Jika Anda bisa menjelaskan kenapa 5 report itu actionable, berarti Anda sudah berpikir seperti process intelligence engineer, bukan sekadar dashboard builder.

---

## 35. Kesimpulan

Optimize adalah bagian dari Camunda 8 yang mengubah process orchestration dari sekadar automation menjadi continuous improvement system.

Tetapi Optimize tidak otomatis membuat proses Anda pintar. Insight bergantung pada:

1. BPMN modelling yang business-readable.
2. Variable contract yang analytics-friendly.
3. Error/reason code yang konsisten.
4. Process version governance.
5. KPI definition yang tidak menipu.
6. Dashboard yang punya owner dan action path.
7. Feedback loop yang benar-benar menghasilkan perubahan.
8. Kombinasi antara process analytics, operational evidence, dan technical telemetry.

Mental model paling penting:

```text
Zeebe executes.
Operate supports.
Tasklist enables human work.
Optimize teaches you how the process behaves.
Engineering turns that learning into a better process.
```

Top 1% engineer tidak berhenti di “workflow berhasil jalan”. Mereka bertanya:

```text
Is the workflow observable?
Is it measurable?
Is it fair?
Is it compliant?
Is it improving?
Can we prove why it behaves this way?
```

Itulah nilai Optimize dalam sistem Camunda 8 production-grade.

---

## 36. Referensi Resmi dan Bacaan Lanjutan

Gunakan referensi berikut saat ingin mengecek detail implementasi dan fitur terbaru:

1. Camunda 8 Optimize — What is Optimize
2. Camunda 8 Optimize — Collections, dashboards, and reports
3. Camunda 8 Optimize — Configure reports
4. Camunda 8 Optimize — User task analytics
5. Camunda 8 Self-Managed Optimize system configuration
6. Camunda 8 concepts — exporters and secondary storage
7. Camunda 8 Operate and Tasklist documentation
8. Camunda blog — Performance tuning Camunda 8
9. Camunda process intelligence materials

---

## 37. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-021.md
```

Judul:

```text
Part 021 — Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-019.md">⬅️ Part 019 — Tasklist and Human Work Management at Scale</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-021.md">Part 021 — Identity, Authentication, Authorization, Tenancy, and Secure Access Boundaries ➡️</a>
</div>
