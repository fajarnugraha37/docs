# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-027.md

# Part 027 — Process Versioning, Deployment Governance, Rollback, and Compatibility

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Part: `027`  
> Topik: Process Versioning, Deployment Governance, Rollback, and Compatibility  
> Target: advanced Java engineer / tech lead / platform engineer yang perlu mengelola perubahan proses Camunda 8 secara aman di production.

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya, kita sudah membahas:

- engine architecture,
- partitions,
- BPMN execution semantics,
- Java/Camunda Client,
- job worker correctness,
- variable contracts,
- modelling pattern,
- instantiation/correlation,
- error handling,
- timers/SLA,
- user task,
- Spring Boot integration,
- worker architecture,
- connectors,
- exporters/read model,
- Operate,
- Tasklist,
- Optimize,
- Identity/security,
- deployment topology,
- performance,
- reliability,
- observability,
- testing.

Sekarang kita masuk ke salah satu area yang sering diremehkan: **versioning dan deployment governance**.

Di Camunda 8, BPMN process bukan file gambar. BPMN adalah **runtime contract**. Begitu proses di-deploy dan ada instance berjalan, Anda tidak lagi hanya mengubah model; Anda mengubah kontrak antara:

- process definition,
- Java worker,
- variable schema,
- form,
- DMN decision,
- connector,
- message name,
- correlation key,
- identity/authorization,
- read model,
- analytics,
- operational support.

Kesalahan versioning sering tidak muncul saat deployment. Kesalahan muncul setelah:

- process baru mulai memakai BPMN versi terbaru,
- worker lama menerima job type baru,
- worker baru menerima variable lama,
- message callback datang ke versi proses yang berbeda,
- user task form berubah tapi running instance masih berada di versi lama,
- incident lama di-retry setelah worker sudah berubah,
- rollback code dilakukan tetapi process definition terbaru masih aktif untuk instance baru,
- running instance dimigrasikan tanpa memahami mapping element.

Tujuan part ini adalah membangun mental model agar Anda bisa menjawab pertanyaan:

> “Bagaimana kita merilis perubahan proses Camunda 8 tanpa merusak instance yang sedang berjalan, tanpa kehilangan auditability, dan tanpa membuat worker contract tidak kompatibel?”

---

## 1. Core Mental Model: Deployment Is Easy, Evolution Is Hard

Deploy BPMN itu mudah. Yang sulit adalah **mengelola evolusi**.

Camunda 8 akan menyimpan versi baru dari process definition ketika process dengan BPMN process ID yang sama di-deploy dan definisinya berubah. Secara umum:

- running instance tetap berjalan berdasarkan version tempat ia dibuat,
- new instance biasanya memakai latest version jika dibuat berdasarkan BPMN process ID,
- process definition version adalah angka yang diberikan orchestration cluster,
- version tag adalah label user-defined,
- Web Modeler version adalah snapshot desain/project, bukan sama dengan runtime process definition version.

Jadi ada beberapa “versi” yang berbeda:

| Jenis Versi | Diberikan Oleh | Makna | Risiko Salah Paham |
|---|---:|---|---|
| BPMN process ID | Modeler/engineer | Identitas logis proses | Dianggap sebagai versi padahal bukan |
| Process definition version | Orchestration cluster | Runtime version numerik hasil deployment | Dianggap sama dengan Git tag |
| Version tag | User/team | Label rilis manusiawi | Dianggap mengontrol routing runtime |
| Git commit/tag | SCM | Source version | Tidak otomatis sama dengan deployed runtime |
| Worker app version | CI/CD artifact | Versi executable Java worker | Bisa tidak kompatibel dengan BPMN terbaru/lama |
| Variable schema version | Team contract | Versi payload contract | Sering tidak ada padahal paling penting |
| Form version | Modeler/app | Versi UI human task | Bisa berubah tanpa sinkron dengan running tasks |
| DMN version | Decision deployment | Versi decision table | Bisa menghasilkan behavior berbeda untuk proses sama |

Senior engineer tidak hanya bertanya:

> “BPMN sudah di-deploy belum?”

Ia bertanya:

> “BPMN version ini compatible dengan worker version mana, variable schema version mana, form version mana, DMN version mana, dan bagaimana running instance lama akan diperlakukan?”

---

## 2. Camunda 8 Versioning Behavior: Apa yang Harus Diingat

Secara konseptual, ketika Anda deploy process definition:

1. Engine membaca BPMN process ID.
2. Jika definition berbeda dan process ID sama, engine dapat membuat process definition version baru.
3. Instance baru yang dibuat dengan BPMN process ID umumnya diarahkan ke latest version.
4. Instance yang sudah berjalan tidak otomatis pindah ke version baru.
5. Instance lama tetap membawa state berdasarkan process version tempat ia dibuat.
6. Migration dapat dilakukan jika Anda memang memutuskan memindahkan instance ke target version lain.

Hal ini terdengar sederhana, tetapi memiliki konsekuensi besar.

Misalnya Anda punya:

```text
processId = license-application
version   = 12
```

Kemudian Anda deploy:

```text
processId = license-application
version   = 13
```

Maka situasinya bisa seperti ini:

```text
Running instances:
- PI-1001 -> license-application:v11
- PI-1002 -> license-application:v12
- PI-1003 -> license-application:v12

New instances after deployment:
- PI-1004 -> license-application:v13
- PI-1005 -> license-application:v13
```

Artinya dalam production, Java worker Anda bisa secara bersamaan menerima job dari beberapa versi proses.

Ini adalah sumber banyak bug.

---

## 3. The Most Important Rule: Worker Must Be Compatible with Multiple Process Versions

Dalam sistem long-running workflow, Anda hampir tidak pernah hanya menjalankan satu process version.

Jika proses bisa berjalan selama:

- beberapa jam,
- beberapa hari,
- beberapa minggu,
- beberapa bulan,
- atau bahkan bertahun-tahun,

maka worker harus siap menghadapi **multi-version runtime**.

Contoh:

```text
BPMN v10 created job type: verify-applicant
Variables:
{
  "applicationId": "APP-001",
  "applicantId": "P-001"
}

BPMN v11 created same job type: verify-applicant
Variables:
{
  "applicationId": "APP-002",
  "applicant": {
    "id": "P-002",
    "type": "INDIVIDUAL"
  }
}
```

Jika worker terbaru hanya memahami struktur v11, job dari running instance v10 dapat gagal.

Karena itu, desain job worker harus menjawab:

1. Apakah job type yang sama mempertahankan variable contract lama?
2. Apakah job type baru harus dibuat untuk contract baru?
3. Apakah worker bisa membaca `schemaVersion`?
4. Apakah mapping layer backward-compatible?
5. Apakah ada fallback/default untuk field yang belum ada?
6. Apakah perubahan bersifat additive atau breaking?

---

## 4. Process Versioning Bukan Hanya BPMN Versioning

Dalam Camunda 8, process versioning harus dilihat sebagai **release graph**.

```text
                   +------------------+
                   | Git Commit / Tag |
                   +--------+---------+
                            |
        +-------------------+-------------------+
        |                   |                   |
+-------v------+   +--------v-------+   +-------v-------+
| BPMN Version |   | Worker Version |   | Form Version  |
+-------+------+   +--------+-------+   +-------+-------+
        |                   |                   |
        +-------------------+-------------------+
                            |
                    +-------v--------+
                    | Runtime Safety |
                    +----------------+
```

A safe release requires compatibility across all of them.

A process release can include:

- BPMN file,
- DMN file,
- form file,
- Java worker artifact,
- connector template/config,
- environment config,
- secret config,
- authorization policy,
- tenant mapping,
- read model mapping,
- Optimize dashboard assumptions,
- support runbook,
- migration plan.

Jika Anda hanya versioning BPMN tetapi tidak versioning worker contract, Anda belum memiliki governance.

---

## 5. Runtime Compatibility Matrix

Setiap process release sebaiknya memiliki compatibility matrix seperti ini:

```text
Release: licensing-process-2026.06.21-r1

Runtime definition:
- BPMN process ID      : licensing-application
- Expected version tag : 2026.06.21-r1
- Git tag              : licensing-process-2026.06.21-r1

Compatible workers:
- applicant-validation-worker >= 2.4.0 < 3.0.0
- document-check-worker       >= 1.8.0 < 2.0.0
- risk-screening-worker       >= 5.2.0 < 6.0.0

Compatible variable contracts:
- ApplicationSubmittedEvent schema v3
- ApplicantProfile schema v2
- DocumentChecklist schema v4

Compatible forms:
- review-application-form version 7
- request-clarification-form version 3

Compatible DMN:
- risk-score-decision version tag 2026.06
- routing-decision version tag 2026.06

Breaking changes:
- none

Migration required:
- no

Rollback plan:
- stop new starts through process registry
- deploy previous worker version if needed
- keep running v13 instances on v13
- no automatic migration back
```

Tanpa matrix seperti ini, release Camunda menjadi “deploy and pray”.

---

## 6. Deployment Governance Levels

Tidak semua organisasi butuh governance yang sama. Namun untuk production-grade, minimal ada beberapa level.

### 6.1 Level 0 — Manual Upload

Ciri:

- BPMN di-upload manual dari Modeler.
- Tidak ada Git tag.
- Tidak ada worker compatibility matrix.
- Tidak ada release note.
- Tidak ada review.

Ini hanya cocok untuk learning/local/dev.

Risiko:

- tidak tahu versi mana yang deployed,
- tidak bisa reproduce model,
- rollback kacau,
- audit lemah.

### 6.2 Level 1 — Git-Controlled BPMN

Ciri:

- BPMN disimpan di Git.
- Deployment lewat CI/CD.
- Ada environment promotion.

Lebih baik, tetapi belum cukup.

Masalah yang masih ada:

- worker compatibility belum jelas,
- variable schema belum versioned,
- human task form belum sinkron,
- process instance migration belum diatur.

### 6.3 Level 2 — Release Bundle

Ciri:

- BPMN, DMN, forms, worker artifacts, config, dan docs dirilis sebagai bundle.
- Ada release note.
- Ada compatibility matrix.
- Ada automated validation.
- Ada rollback strategy.

Ini level minimum untuk enterprise.

### 6.4 Level 3 — Governed Process Platform

Ciri:

- ada process registry,
- ada deployment approval,
- ada staged rollout,
- ada tenant-aware deployment,
- ada automated contract checks,
- ada instance migration governance,
- ada observability baseline per release,
- ada audit evidence otomatis.

Ini level yang mendekati top-tier engineering.

---

## 7. Process Definition Version vs Business Version

Camunda process definition version adalah runtime number. Contoh:

```text
license-application:v42
```

Tetapi business release mungkin bernama:

```text
Release 2026-Q2-Regulatory-Fee-Update
```

Jangan campur keduanya.

Rekomendasi:

- gunakan process definition version untuk runtime/debugging,
- gunakan version tag/release tag untuk manusia dan governance,
- simpan mapping di deployment ledger.

Contoh deployment ledger:

```sql
CREATE TABLE process_deployment_ledger (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    environment VARCHAR(32) NOT NULL,
    bpmn_process_id VARCHAR(255) NOT NULL,
    process_definition_key VARCHAR(64),
    process_definition_version INTEGER,
    version_tag VARCHAR(128),
    git_commit VARCHAR(64) NOT NULL,
    git_tag VARCHAR(128),
    worker_release VARCHAR(128),
    deployed_by VARCHAR(128) NOT NULL,
    deployed_at TIMESTAMP NOT NULL,
    deployment_reason VARCHAR(1000),
    compatibility_notes CLOB,
    rollback_notes CLOB
);
```

Ledger ini bukan pengganti Operate atau Camunda API. Ledger ini governance layer untuk organisasi.

---

## 8. Breaking vs Non-Breaking BPMN Changes

Tidak semua perubahan BPMN memiliki risiko sama.

### 8.1 Biasanya Non-Breaking

Perubahan yang sering relatif aman untuk new instance dan tidak mengganggu running instance lama:

- menambah path baru setelah gateway yang belum dilewati oleh instance lama,
- menambah service task baru untuk new version,
- menambah optional variable,
- menambah non-critical form field optional,
- menambah monitoring variable,
- memperbaiki label/name element tanpa mengubah ID element penting.

Namun “biasanya” bukan berarti pasti. Anda tetap harus menilai worker contract dan migration effect.

### 8.2 Potentially Breaking

Perubahan berisiko:

- mengganti job type existing,
- menghapus service task active,
- mengubah input/output mapping,
- mengubah variable name,
- mengubah message name,
- mengubah correlation key,
- mengubah timer semantics,
- mengganti linked form binding,
- mengganti called process binding,
- mengganti DMN binding,
- menghapus boundary event,
- mengubah multi-instance collection variable,
- mengubah event subprocess/cancellation path.

### 8.3 Almost Always Breaking

Perubahan yang harus diperlakukan sebagai breaking:

- mengubah meaning dari existing variable tanpa rename/schema version,
- mengubah job type contract tetapi tetap memakai job type lama,
- menghapus flow node yang masih bisa ditempati running instance yang akan dimigrasikan,
- mengubah correlation key untuk callback external yang sudah in-flight,
- mengubah business identifier semantics,
- mengubah authorization/candidate group mapping tanpa migration plan,
- mengganti form required fields untuk running task lama,
- mengubah compensation logic untuk saga yang sudah berjalan.

---

## 9. Job Type Versioning Strategy

Job type adalah kontrak runtime antara BPMN dan worker.

Contoh job type:

```text
validate-application
send-notification
calculate-risk-score
create-license
```

Pertanyaan penting:

> Jika contract berubah, apakah job type harus berubah?

Jawaban: tergantung apakah perubahan backward-compatible.

### 9.1 Additive Compatible Change

Misalnya variable baru optional:

```json
{
  "applicationId": "APP-001",
  "applicantId": "P-001",
  "priority": "NORMAL"
}
```

Jika worker lama mengabaikan `priority`, ini bisa kompatibel.

### 9.2 Breaking Change

Misalnya:

```json
// old
{
  "applicantId": "P-001"
}

// new
{
  "applicant": {
    "id": "P-001",
    "type": "INDIVIDUAL"
  }
}
```

Jika worker lama/new tidak bisa membaca kedua bentuk, ini breaking.

Pilihan:

1. Pertahankan job type, tetapi worker mendukung dua schema.
2. Buat job type baru.
3. Tambahkan `schemaVersion` dan mapper versioned.

Rekomendasi untuk sistem kritikal:

```text
validate-application.v1
validate-application.v2
```

atau:

```text
validate-application
```

plus explicit variable:

```json
{
  "contractVersion": 2,
  "application": {...}
}
```

Pilihan pertama lebih eksplisit di BPMN. Pilihan kedua mengurangi proliferasi job type tetapi membebani mapper.

---

## 10. Variable Schema Versioning

Variable schema sering menjadi sumber breaking change terbesar.

Contoh anti-pattern:

```json
{
  "status": "APPROVED"
}
```

Versi baru:

```json
{
  "status": {
    "code": "APPROVED",
    "reason": "ALL_CHECKS_PASSED"
  }
}
```

Ini bukan perubahan kecil. Ini perubahan semantic contract.

### 10.1 Tambahkan Contract Version

Contoh:

```json
{
  "applicationContractVersion": 3,
  "applicationId": "APP-2026-0001",
  "applicant": {
    "id": "P-123",
    "type": "INDIVIDUAL"
  },
  "submission": {
    "submittedAt": "2026-06-21T10:15:30+07:00",
    "channel": "PORTAL"
  }
}
```

### 10.2 Mapper Harus Version-Aware

Contoh Java style:

```java
public final class ApplicationVariablesMapper {

    public ApplicationCommand toCommand(Map<String, Object> variables) {
        int version = readInt(variables, "applicationContractVersion", 1);

        switch (version) {
            case 1:
                return mapV1(variables);
            case 2:
                return mapV2(variables);
            case 3:
                return mapV3(variables);
            default:
                throw new UnsupportedVariableContractException(
                    "Unsupported applicationContractVersion=" + version
                );
        }
    }
}
```

### 10.3 Jangan Biarkan DTO Internal Menjadi Variable Contract

Jangan langsung serialize domain object internal sebagai process variable.

Buruk:

```java
client.newCreateInstanceCommand()
    .bpmnProcessId("license-application")
    .latestVersion()
    .variables(domainApplicationEntity)
    .send();
```

Lebih baik:

```java
LicenseApplicationStartVariables vars = new LicenseApplicationStartVariables(
    3,
    application.getApplicationId(),
    application.getApplicantId(),
    application.getChannel(),
    application.getSubmittedAt().toString()
);
```

Domain object berubah karena kebutuhan domain. Process contract harus berubah hanya karena kebutuhan orchestration contract.

---

## 11. Worker Deployment Order

Pertanyaan klasik:

> Deploy worker dulu atau deploy BPMN dulu?

Jawabannya tergantung jenis perubahan.

### 11.1 Jika BPMN Menambahkan Job Type Baru

Urutan aman:

```text
1. Deploy worker yang support job type baru.
2. Pastikan worker sehat dan registered/running.
3. Deploy BPMN versi baru.
4. Start new instances ke versi baru.
5. Monitor job activation/completion.
```

Jika BPMN di-deploy dulu, instance baru bisa membuat job yang belum ada worker-nya. Hasilnya job timeout/incident.

### 11.2 Jika Worker Mendukung Backward-Compatible Contract

Urutan aman:

```text
1. Deploy worker baru yang support old + new schema.
2. Deploy BPMN baru.
3. Monitor old and new instances.
4. Setelah old instances habis, hapus old schema support pada major release berikutnya.
```

### 11.3 Jika Worker Breaking terhadap Old Version

Jangan deploy worker breaking secara langsung.

Pilihan:

- jalankan worker lama dan worker baru paralel dengan job type berbeda,
- migrasikan instances lama,
- tunggu instances lama selesai,
- isolate by tenant/environment,
- gunakan feature flag pada worker mapper.

---

## 12. BPMN Deployment Order with Forms and DMN

Jika BPMN menggunakan linked resources seperti:

- called process,
- DMN decision,
- Camunda form,

maka deployment order juga harus mempertimbangkan resource binding.

### 12.1 Resource Binding Problem

Misalnya user task memakai form:

```text
review-application-form
```

Jika form terbaru berubah required fields-nya, running task dari process lama bisa terdampak bila binding diarahkan ke latest.

Karena itu Camunda menyediakan konsep binding type untuk linked resources seperti call activity, business rule task, dan user task form.

Secara mental model, Anda harus menentukan:

- apakah process ingin selalu memakai latest resource?
- apakah process ingin binding ke deployment version?
- apakah process ingin binding ke specific version/tag?

### 12.2 Binding Strategy

| Binding | Cocok Untuk | Risiko |
|---|---|---|
| latest | fast-moving dev/test | running behavior bisa berubah unexpectedly |
| deployment | stable release bundle | butuh deploy resource bersama-sama |
| version tag/specific | governed production | perlu disiplin version tag |

Untuk production regulated workflow, hindari “latest by accident”.

---

## 13. Process Registry Pattern

Camunda dapat start process by BPMN process ID atau key/version mechanism sesuai API/command. Namun dalam enterprise, sering lebih aman menambahkan **Process Registry** di application layer.

### 13.1 Problem Tanpa Registry

Jika semua service langsung start:

```text
bpmnProcessId = license-application
version       = latest
```

maka begitu version baru deployed, semua caller langsung masuk version baru.

Itu bisa berbahaya.

### 13.2 Registry sebagai Routing Layer

Process Registry menyimpan:

```text
business process name: License Application
bpmnProcessId        : license-application
active version mode  : latest / pinned / canary / tenant-based
allowed tenants      : CEA, CPDS, INTERNAL
release tag          : 2026.06.21-r1
rollout percentage   : 10%
```

Caller tidak langsung memutuskan version. Caller bertanya ke registry.

```java
ProcessStartTarget target = processRegistry.resolve("LICENSE_APPLICATION", tenantId);

client.newCreateInstanceCommand()
    .bpmnProcessId(target.bpmnProcessId())
    .version(target.version()) // atau latest jika policy mengizinkan
    .variables(vars)
    .send();
```

### 13.3 Registry Berguna untuk Canary

Contoh rollout:

```text
Tenant CEA:
- 90% new starts -> process v21
- 10% new starts -> process v22

Tenant CPDS:
- 100% new starts -> process v21
```

Camunda engine tidak perlu tahu business rollout policy. Itu aplikasi/platform concern.

---

## 14. Rollback Reality: You Cannot Undeploy Time

Rollback dalam workflow berbeda dari rollback service stateless.

Pada service stateless:

```text
Deploy v2 -> error -> rollback to v1
```

Biasanya cukup.

Pada process engine:

```text
Deploy BPMN v2 -> new process instances started on v2 -> rollback worker to v1
```

Masalah:

- process definition v2 masih ada,
- instances v2 sudah berjalan,
- some jobs may already be created,
- external side effects may already happen,
- user tasks may already be assigned,
- messages may already be waiting,
- timers may already be scheduled.

Jadi rollback Camunda harus dibagi:

1. rollback new starts,
2. rollback worker behavior,
3. handle already-started instances,
4. handle external side effects,
5. handle projections/read model,
6. document audit trail.

---

## 15. Rollback Types

### 15.1 Soft Rollback: Stop New Starts

Ini paling aman.

```text
1. Process v22 bermasalah.
2. Update process registry agar new starts kembali ke v21.
3. Jangan hapus v22.
4. Existing v22 instances dianalisis.
```

Soft rollback cocok jika:

- bug hanya berdampak pada new instances,
- jumlah v22 instances kecil,
- worker masih bisa handle v22,
- tidak ada data corruption berat.

### 15.2 Worker Rollback

Rollback Java artifact.

Risiko:

- worker v1 mungkin tidak bisa handle jobs dari BPMN v2,
- worker v1 mungkin tidak bisa parse variable schema baru,
- job type baru tidak punya handler.

Karena itu, worker rollback harus dicek dengan compatibility matrix.

### 15.3 Forward Fix

Sering lebih aman daripada rollback.

```text
1. Bug ditemukan di worker v3.
2. Deploy worker v3.1 yang backward compatible.
3. Retry incidents.
4. Keep process version as-is.
```

Forward fix cocok jika process instances sudah banyak berjalan di versi baru.

### 15.4 Process Instance Migration Back

Migrasi instance dari v22 ke v21 bisa tampak menarik, tetapi sering tidak aman.

Risiko:

- target process tidak punya matching element,
- variables sudah berubah,
- tasks/timers/messages sudah berbeda,
- external side effects sudah terjadi.

Migrasi balik hanya dilakukan dengan migration plan yang jelas.

---

## 16. Process Instance Migration

Process instance migration memungkinkan instance aktif dipindahkan ke process definition lain/version lain dengan mapping element tertentu.

Gunakan migration untuk:

- memperbaiki model bug yang memblokir banyak active instances,
- memindahkan instance ke versi yang punya path perbaikan,
- menghindari menunggu proses lama selesai dalam kasus tertentu,
- compliance/regulatory change yang harus berlaku untuk in-flight cases.

Jangan gunakan migration sebagai:

- pengganti versioning discipline,
- rollback reflex,
- cara menyembunyikan desain buruk,
- operasi massal tanpa dry-run/review.

### 16.1 Migration Is Not Code Refactoring

Refactoring code bisa mengubah internal structure tanpa mengubah behavior. Migration process instance mengubah runtime state.

Pertanyaan sebelum migration:

1. Instance ada di element mana?
2. Element target mana yang equivalent?
3. Apakah local variables masih valid?
4. Apakah timers masih masuk akal?
5. Apakah user task active masih bisa dipetakan?
6. Apakah message catch event berubah?
7. Apakah compensation boundary berubah?
8. Apakah audit explanation tersedia?
9. Apakah support team tahu dampaknya?

### 16.2 Migration Plan

Migration plan minimal harus berisi:

```text
Source:
- processId: license-application
- version: 21
- selected instances: active only
- filter: tenant=CEA, status=WAITING_REVIEW

Target:
- processId: license-application
- version: 22

Mappings:
- review_application_task -> review_application_task
- wait_for_payment_message -> wait_for_payment_message
- calculate_risk_service_task -> calculate_risk_service_task_v2

Variable assumptions:
- applicationContractVersion v3 supported by target
- riskScore nullable for instances before risk task

Excluded instances:
- instances in compensation path
- instances with active appeal subprocess

Risk:
- low/medium/high

Approval:
- process owner
- tech lead
- operations lead

Rollback:
- not automatic
- restore from backup not used for logical rollback
- forward repair process if migration fails partially
```

### 16.3 Migration and Element IDs

Element IDs matter.

Jika Anda rename label tapi mempertahankan element ID, migration lebih mudah.

Jika Anda mengganti element ID tanpa alasan, Anda mempersulit migration/debugging.

Rekomendasi:

- treat BPMN element IDs as runtime identifiers,
- do not auto-generate random IDs for important elements,
- use stable names:

```text
Task_ReviewApplication
Task_CalculateRiskScore
Event_WaitForPaymentConfirmation
Gateway_IsHighRisk
```

Bukan:

```text
Activity_0x8sd92
Gateway_1a2b3c
```

---

## 17. Process Instance Modification vs Migration

Jangan campur dua konsep ini.

### 17.1 Modification

Process instance modification digunakan untuk memperbaiki flow instance tertentu:

- skip step,
- repeat step,
- move token,
- activate/cancel element.

Ini cocok untuk incident repair spesifik.

### 17.2 Migration

Process instance migration memindahkan instance dari definition/version source ke target.

Ini cocok untuk perubahan model/version yang lebih luas.

### 17.3 Decision Matrix

| Problem | Better Tool |
|---|---|
| Satu instance stuck karena external callback hilang | Modification/manual repair |
| Banyak instance stuck karena bug BPMN v21 | Migration atau forward fix |
| Worker bug menyebabkan incidents | Fix worker + retry |
| Variable salah pada satu case | Variable correction + retry |
| Regulatory rule changed for all active cases | Migration atau compensating subprocess |
| Process model new version hanya untuk new applications | No migration; route new starts |

---

## 18. Deployment Pipeline untuk Camunda 8

Production-grade pipeline tidak hanya “deploy BPMN”.

### 18.1 Pipeline Stages

```text
1. Static validation
2. Contract validation
3. Unit tests
4. Process scenario tests
5. Worker compatibility tests
6. Security validation
7. Package release bundle
8. Deploy to DEV
9. Smoke test
10. Deploy to SIT/UAT
11. Business validation
12. Release approval
13. Deploy worker-compatible artifacts
14. Deploy process resources
15. Enable new starts/canary
16. Monitor
17. Post-release evidence capture
```

### 18.2 Static Validation

Check:

- BPMN XML valid,
- no unsupported BPMN element,
- stable element IDs,
- job types follow convention,
- message names follow convention,
- correlation key expressions valid,
- timers valid,
- no accidental `latest` binding in production resources,
- no secrets hardcoded,
- no huge inline payload examples.

### 18.3 Contract Validation

Check:

- every job type has worker owner,
- every worker has variable contract,
- every variable contract has schema version,
- every message has owner and correlation key,
- every user task has form/assignment rules,
- every call activity binding is intentional,
- every DMN decision binding is intentional.

### 18.4 Scenario Tests

Test process paths:

- happy path,
- business rejection,
- worker failure then retry,
- incident repair,
- timer escalation,
- message callback,
- duplicate callback,
- user task reassignment,
- migration candidate path if relevant.

---

## 19. Release Bundle Structure

Contoh repository:

```text
processes/
  licensing-application/
    bpmn/
      licensing-application.bpmn
    dmn/
      risk-routing.dmn
    forms/
      review-application.form
      clarification-request.form
    contracts/
      variables/
        application-start-v3.schema.json
        review-result-v2.schema.json
      jobs/
        validate-application-v2.md
        calculate-risk-score-v3.md
      messages/
        payment-confirmed-v1.md
    tests/
      scenarios/
        happy-path.feature
        rejection-path.feature
        timeout-escalation.feature
    release/
      compatibility-matrix.yaml
      migration-plan.md
      rollback-plan.md
      runbook.md
```

Contoh `compatibility-matrix.yaml`:

```yaml
release: licensing-application-2026.06.21-r1
process:
  bpmnProcessId: licensing-application
  versionTag: 2026.06.21-r1
workers:
  validate-application:
    jobType: validate-application.v2
    owner: licensing-worker-team
    compatibleWorkerVersions: ">=2.4.0 <3.0.0"
    variableContract: application-validation-v2
  calculate-risk-score:
    jobType: calculate-risk-score.v3
    owner: risk-platform-team
    compatibleWorkerVersions: ">=5.1.0 <6.0.0"
    variableContract: risk-score-request-v3
messages:
  payment-confirmed:
    messageName: payment-confirmed.v1
    correlationKey: applicationId
    ttl: PT24H
forms:
  review-application:
    binding: versionTag
    versionTag: 2026.06.21-r1
migration:
  required: false
rollback:
  newStartsCanBeRoutedBack: true
  workerRollbackCompatible: true
```

---

## 20. Process Start Governance

A major source of unsafe rollout adalah semua caller selalu memakai latest process.

### 20.1 Anti-Pattern

```java
client.newCreateInstanceCommand()
    .bpmnProcessId("license-application")
    .latestVersion()
    .variables(vars)
    .send();
```

Ini boleh untuk dev/simple use case. Untuk production governed process, ini bisa terlalu agresif.

### 20.2 Safer Pattern

```java
ProcessStartPolicy policy = processRegistry.resolve(
    "LICENSE_APPLICATION",
    tenantId,
    channel,
    applicantType
);

CreateProcessInstanceCommandStep1 command = client.newCreateInstanceCommand();

if (policy.isPinnedVersion()) {
    command.processDefinitionKey(policy.processDefinitionKey())
           .variables(vars)
           .send();
} else {
    command.bpmnProcessId(policy.bpmnProcessId())
           .latestVersion()
           .variables(vars)
           .send();
}
```

### 20.3 Feature Flag Integration

Process version rollout bisa dikontrol:

```text
Feature flag: licensing.application.process.v22.enabled
Tenant: CEA
Channel: PORTAL
Percentage: 10%
```

Namun hati-hati: process version rollout bukan hanya traffic routing. Ia menciptakan durable process instances.

Jika flag dimatikan, instance yang sudah dibuat tetap ada.

---

## 21. Canary Deployment untuk Process Definition

Canary process berbeda dari canary stateless service.

Dalam service stateless:

```text
10% traffic -> v2
if bad -> route all traffic back to v1
```

Dalam workflow:

```text
10% new instances -> process v2
if bad -> new starts back to v1
but existing v2 instances remain
```

Jadi canary plan harus mencakup:

1. selection criteria,
2. max number of canary instances,
3. monitoring window,
4. kill switch for new starts,
5. repair plan for canary instances,
6. forward fix plan,
7. rollback compatibility.

Contoh:

```text
Canary policy:
- 20 first instances only
- tenant: internal pilot
- exclude high-risk case type
- monitor for 48 hours
- success criteria:
  - no incidents
  - p95 worker latency < 2s for validation jobs
  - no task assignment complaint
  - no message correlation failure
- rollback:
  - route new starts to v21
  - keep v22 instances under manual watch
```

---

## 22. Blue/Green Deployment untuk Worker

Worker deployment bisa blue/green atau rolling.

### 22.1 Rolling Worker Deployment

Cocok jika worker baru backward-compatible.

```text
worker v2 pods gradually replace worker v1 pods
```

Risiko:

- selama rollout, v1 dan v2 sama-sama mengambil jobs,
- jika behavior berbeda, hasil bisa inconsistent.

### 22.2 Blue/Green Worker Deployment

Cocok untuk higher control.

```text
blue: worker v1 active
green: worker v2 deployed but not consuming / or consuming new job type only
switch: enable green for job type v2
```

Masalah: Camunda workers activate by job type. Jika blue dan green sama-sama subscribe job type sama, butuh mekanisme internal untuk route/compatibility.

### 22.3 Versioned Job Type Makes Blue/Green Easier

```text
BPMN v21 -> validate-application.v1 -> worker v1
BPMN v22 -> validate-application.v2 -> worker v2
```

Ini lebih eksplisit.

Trade-off:

- lebih banyak job type,
- BPMN lebih eksplisit,
- migration lebih mudah dimengerti,
- backward compatibility lebih mudah dikontrol.

---

## 23. Versioned Message Names

Message name juga contract.

Contoh:

```text
payment-confirmed
```

Jika payload/correlation berubah, pertimbangkan:

```text
payment-confirmed.v2
```

Namun jangan versioning message name berlebihan jika hanya additive field.

### 23.1 Breaking Message Change

Breaking jika:

- correlation key berubah,
- payload required berubah,
- meaning event berubah,
- sender system berubah semantics,
- duplicate detection berubah,
- TTL expectation berubah.

### 23.2 Callback Compatibility

External systems mungkin masih mengirim callback lama selama transisi.

Pattern:

```text
External callback API:
POST /callbacks/payment-confirmed

Application layer:
- validate sender
- normalize payload
- decide target message name/version
- publish message to Camunda
```

Jangan biarkan external system langsung bergantung pada internal BPMN message version tanpa adapter.

---

## 24. User Task Form Versioning

Human task versioning sering tricky.

Bayangkan task dibuat pada BPMN v10 dengan form v3. Saat user membuka task 3 hari kemudian, form latest sudah v4.

Pertanyaan:

- Haruskah task lama memakai form lama?
- Apakah form baru compatible dengan variable lama?
- Apakah required fields baru harus berlaku untuk task lama?
- Apakah audit menyebut user melihat form versi apa?

Rekomendasi:

1. Untuk regulated workflow, pin form version/tag pada process release.
2. Simpan `formVersion` pada task completion audit.
3. Jangan ubah meaning field existing tanpa versioning.
4. Gunakan additive optional changes jika ingin backward-compatible.
5. Jangan mengandalkan frontend latest untuk running tasks lama tanpa compatibility layer.

---

## 25. DMN Versioning

Jika process menggunakan business rule task/DMN, versioning decision sama pentingnya.

Contoh:

```text
risk-routing-decision
```

Versi lama:

```text
if amount > 10000 -> SENIOR_REVIEW
```

Versi baru:

```text
if amount > 5000 -> SENIOR_REVIEW
```

Ini bisa mengubah business outcome.

Pertanyaan governance:

- Apakah running process lama harus memakai decision lama atau latest?
- Apakah rule change berlaku retroaktif?
- Apakah decision result disimpan sebagai variable/audit?
- Apakah explanation/rule matched disimpan?

Untuk defensibility:

```json
{
  "riskDecision": {
    "decisionId": "risk-routing",
    "decisionVersionTag": "2026.06",
    "evaluatedAt": "2026-06-21T10:15:30+07:00",
    "result": "SENIOR_REVIEW",
    "matchedRule": "R-004"
  }
}
```

---

## 26. Call Activity Versioning

Call activity menghubungkan parent process ke child process.

Risiko:

- parent process v10 memanggil child latest,
- child latest berubah contract,
- parent lama tidak compatible.

### 26.1 Stable Subprocess Contract

Child process harus diperlakukan seperti API.

Contract:

```text
Called process: document-verification
Input:
- applicationId
- documentSetId
- verificationMode

Output:
- verificationStatus
- failedDocumentCodes
```

Jika output berubah breaking, buat versioning.

### 26.2 Binding Decision

Untuk production:

- bind to deployment/version tag jika parent-child dirilis bersama,
- use latest hanya jika child process dijamin backward-compatible,
- document compatibility matrix.

---

## 27. Versioning and Incidents

Incident bisa hidup lebih lama dari deployment.

Contoh:

```text
Day 1:
- BPMN v10 running
- worker v10 throws incident due invalid variable

Day 2:
- worker v11 deployed
- BPMN v11 deployed

Day 3:
- Support retries incident from v10
```

Worker v11 sekarang menangani job dari process v10.

Jika v11 tidak compatible dengan v10 variables, retry gagal.

Karena itu:

1. incident retry harus mempertimbangkan original process version,
2. worker harus log process definition key/version/tag jika tersedia,
3. support runbook harus mencatat compatible worker version,
4. old mapper jangan dihapus sebelum old incidents resolved.

---

## 28. Deployment Ledger and Runtime Evidence

Dalam environment regulated, setiap deployment harus menghasilkan evidence.

Minimal evidence:

```text
Deployment Evidence
- Environment
- Date/time
- Deployed by
- Approval reference
- Git commit
- BPMN checksum
- DMN checksum
- Form checksum
- Worker image digest
- Process definition key/version after deployment
- Version tag
- Compatibility matrix
- Test result link
- Migration plan
- Rollback plan
- Monitoring dashboard link
```

Container image tag saja tidak cukup. Gunakan image digest.

```text
registry.example.com/licensing-worker@sha256:...
```

BPMN checksum contoh:

```bash
sha256sum licensing-application.bpmn
```

Tujuannya bukan bureaucracy. Tujuannya agar ketika incident terjadi 3 bulan kemudian, Anda bisa menjawab:

> “Instance ini berjalan pada model apa, worker apa, rule apa, form apa, dan data contract apa?”

---

## 29. Process Version Readiness Checklist

Sebelum deploy process version baru:

```text
[ ] BPMN XML valid.
[ ] BPMN element IDs stable and meaningful.
[ ] Unsupported BPMN elements tidak ada.
[ ] Job types documented.
[ ] Worker owners assigned.
[ ] Worker versions compatible.
[ ] Variable schemas documented.
[ ] Breaking changes identified.
[ ] Message names/correlation keys reviewed.
[ ] Timer/SLA changes reviewed.
[ ] User task assignment reviewed.
[ ] Form binding reviewed.
[ ] DMN binding reviewed.
[ ] Call activity binding reviewed.
[ ] Multi-instance variables reviewed.
[ ] Error boundary and incident paths tested.
[ ] Migration needed? yes/no documented.
[ ] Rollback/new-start routing plan exists.
[ ] Observability dashboard updated.
[ ] Support runbook updated.
[ ] Release approved.
```

---

## 30. Worker Compatibility Checklist

Sebelum deploy worker:

```text
[ ] Worker supports all active process versions it may receive.
[ ] Worker supports old variable schemas still present in active instances.
[ ] Worker handles unknown optional fields.
[ ] Worker rejects unsupported contract versions explicitly.
[ ] Worker uses idempotency keys stable across versions.
[ ] Worker logs processInstanceKey/jobKey/jobType/bpmnProcessId/tenantId.
[ ] Worker can safely retry incidents from old versions.
[ ] Worker timeout compatible with process model.
[ ] Worker exception mapping reviewed.
[ ] Worker outbound side effects deduplicated.
[ ] Worker metrics tagged safely without cardinality explosion.
```

---

## 31. Rollback Checklist

Sebelum release, jawab:

```text
[ ] Jika BPMN baru bermasalah, bagaimana stop new starts?
[ ] Jika worker baru bermasalah, apakah worker lama compatible dengan jobs baru?
[ ] Jika process instances sudah dibuat di version baru, apa treatment-nya?
[ ] Jika external side effect sudah terjadi, apakah ada compensation/reconciliation?
[ ] Jika message callback sudah in-flight, apakah adapter masih menerima versi lama?
[ ] Jika form baru bermasalah, apakah task lama bisa tetap dikerjakan?
[ ] Jika DMN rule salah, apakah decision result bisa diidentifikasi dan diperbaiki?
[ ] Jika migration gagal sebagian, apa repair plan?
[ ] Siapa yang approve rollback?
[ ] Apa evidence yang disimpan?
```

Rollback tanpa jawaban ini bukan rollback plan. Itu harapan.

---

## 32. Anti-Patterns

### 32.1 Always Latest Everywhere

```text
process start -> latest
call activity -> latest
form -> latest
DMN -> latest
worker -> latest only schema
```

Ini mempercepat dev, tetapi berbahaya untuk production.

### 32.2 Same Job Type, Different Meaning

```text
calculate-risk
```

v1: calculates score 0-100  
v2: returns risk category LOW/MEDIUM/HIGH

Job type sama, meaning berubah. Ini breaking hidden contract.

### 32.3 No Variable Schema

Worker langsung membaca `Map<String,Object>` tanpa contract.

Akibat:

- null bug,
- ClassCastException,
- incident storm,
- migration impossible,
- audit lemah.

### 32.4 Delete Old Worker Logic Too Early

Old process instances masih berjalan tetapi old mapper dihapus.

Akibat:

- retry incident lama gagal,
- old user task completion gagal,
- compensation path gagal.

### 32.5 Rollback Worker Without Checking BPMN Version

Worker v1 tidak tahu job type v2.

Akibat:

- jobs never completed,
- timeout,
- incidents.

### 32.6 Migration as Routine Release Step

Jika setiap release butuh mass migration, mungkin process boundary/versioning buruk.

Migration seharusnya controlled exception, bukan default habit.

---

## 33. Example: Safe Additive Release

### 33.1 Current

```text
BPMN v10:
- Task_ValidateApplication -> jobType validate-application.v1
Variables:
- applicationId
- applicantId
```

### 33.2 Change

Tambahkan optional `priority`.

```json
{
  "applicationId": "APP-001",
  "applicantId": "P-001",
  "priority": "NORMAL"
}
```

### 33.3 Safe Plan

```text
1. Update worker to default priority=NORMAL when missing.
2. Deploy worker.
3. Test worker with old and new payload.
4. Deploy BPMN v11.
5. Start canary instances.
6. Monitor.
```

No migration needed.

---

## 34. Example: Breaking Release with Versioned Job Type

### 34.1 Current

```text
BPMN v10:
Task_CalculateRisk -> calculate-risk.v1
```

Payload:

```json
{
  "applicationId": "APP-001",
  "amount": 10000
}
```

### 34.2 New Requirement

Risk calculation now needs applicant type and historical flags.

New payload:

```json
{
  "applicationId": "APP-001",
  "riskInput": {
    "amount": 10000,
    "applicantType": "CORPORATE",
    "historicalFlags": ["LATE_PAYMENT"]
  }
}
```

### 34.3 Plan

```text
1. Keep calculate-risk.v1 worker alive.
2. Implement calculate-risk.v2 worker.
3. Deploy worker v2.
4. Deploy BPMN v11 using calculate-risk.v2.
5. Route only new starts to v11.
6. Let v10 instances finish naturally.
7. After v10 active count reaches zero and incidents resolved, retire v1.
```

This is clean.

---

## 35. Example: Bad Rollback Scenario

### 35.1 Situation

```text
09:00 deploy BPMN v20
09:05 500 instances started
09:20 worker incidents spike
09:30 rollback worker image to previous version
```

### 35.2 What Goes Wrong

Previous worker does not support:

```text
jobType = validate-application.v2
```

Result:

- jobs remain unhandled,
- timeouts occur,
- incidents increase,
- support team retries but no compatible worker exists.

### 35.3 Better Rollback

```text
1. Stop new starts to v20 through registry.
2. Deploy forward fix worker supporting v2.
3. Retry incidents after fix.
4. Analyze 500 v20 instances.
5. Decide: continue, modify, or migrate.
6. Record incident evidence.
```

Lesson:

> Workflow rollback is often forward repair plus routing rollback, not binary artifact rollback.

---

## 36. Versioning Strategy by Process Duration

| Process Duration | Recommended Strategy |
|---|---|
| Seconds/minutes | latest may be acceptable if worker compatible |
| Hours/days | compatibility matrix required |
| Weeks/months | versioned contracts strongly recommended |
| Years/regulatory cases | release bundle, pinned resources, migration governance required |

Long-running process membutuhkan lebih banyak discipline karena active instances dari banyak versi akan coexist.

---

## 37. Versioning Strategy by Criticality

| Criticality | Governance |
|---|---|
| Internal automation low risk | Git + tests may be enough |
| Customer-facing process | compatibility matrix + staged rollout |
| Financial/legal/regulatory | pinned versions + approval + audit evidence + migration plan |
| Safety/security critical | formal release gates + DR/rollback drill |

---

## 38. Advanced Pattern: Process Adapter Layer

Untuk mengurangi coupling antara business app dan Camunda versioning, buat adapter layer.

```text
Business API
   |
   v
Process Application Service
   |
   v
Process Registry + Contract Mapper
   |
   v
Camunda Client
```

Business code tidak tahu:

- BPMN version,
- process definition key,
- message version,
- variable schema details,
- tenant-specific rollout.

Ia hanya tahu:

```java
licenseApplicationWorkflow.startApplication(command);
licenseApplicationWorkflow.publishPaymentConfirmed(event);
licenseApplicationWorkflow.cancelApplication(command);
```

Adapter layer menjaga versioning.

---

## 39. Advanced Pattern: Dual Contract Mapper

Saat transisi schema, worker bisa memakai dual mapper.

```java
public final class RiskInputMapper {

    public RiskInput map(Map<String, Object> variables) {
        int version = detectVersion(variables);

        if (version == 1) {
            return mapLegacyV1(variables);
        }

        if (version == 2) {
            return mapV2(variables);
        }

        throw new UnsupportedContractVersionException(version);
    }
}
```

Policy:

```text
- Support v1 and v2 for 90 days.
- Alert if v1 jobs still appear after retirement date.
- Remove v1 only after zero active instances and zero incidents.
```

---

## 40. Advanced Pattern: Release Guard Worker

Untuk high-risk release, worker bisa validate process/job contract before executing.

```java
if (!compatibilityPolicy.isAllowed(job.getBpmnProcessId(), job.getType(), contractVersion)) {
    throw new NonRetryableContractException("Unsupported process/job contract");
}
```

Namun jangan gunakan ini untuk membuat incident storm. Lebih baik fail fast dengan clear error jika benar-benar incompatible, dan gunakan deployment gate agar kondisi itu tidak terjadi.

---

## 41. Advanced Pattern: Process Version Observability

Dashboard harus bisa menjawab:

- berapa active instances per process version?
- incident count per process version?
- worker failures per job type and process version?
- user task backlog per version?
- average duration per version?
- message correlation failures per version?
- canary version status?

Contoh metrics labels hati-hati:

```text
camunda_worker_jobs_completed_total{
  job_type="validate-application.v2",
  process_id="license-application",
  process_release="2026.06.21-r1"
}
```

Jangan pakai high-cardinality label seperti processInstanceKey untuk metrics. Gunakan logs/traces untuk key granular.

---

## 42. Migration from Camunda 7 Mindset

Camunda 7 sering membuat engineer berpikir:

```text
process engine + JavaDelegate + DB transaction = satu deployment-ish boundary
```

Camunda 8 memaksa boundary berbeda:

```text
BPMN runtime state in Zeebe
business execution in external workers
visibility in projections
contracts across network boundary
```

Konsekuensi migration mindset:

| Camunda 7 Habit | Camunda 8 Governance Shift |
|---|---|
| JavaDelegate changes with app | Worker may need support old process versions |
| DB history query | Projection/read model version awareness |
| Engine embedded in app | Remote cluster deployment coordination |
| Rollback app artifact | Rollback new starts + repair running instances |
| Serialized Java object variable | JSON contract/schema version |
| Listener-based logic | Explicit worker/process modelling |
| Engine transaction with delegate | Side-effect/idempotency governance |

---

## 43. Production Release Template

Gunakan template ini untuk setiap release process.

```markdown
# Process Release Note

## Release Identity
- Process name:
- BPMN process ID:
- Release tag:
- Git commit:
- Target environment:
- Release date:

## Change Summary
- Added:
- Changed:
- Removed:
- Fixed:

## Runtime Artifacts
- BPMN files:
- DMN files:
- Forms:
- Worker images:
- Connector templates/config:

## Compatibility
- Worker compatibility:
- Variable schema compatibility:
- Message compatibility:
- Form compatibility:
- DMN compatibility:
- Call activity compatibility:

## Breaking Changes
- Yes/No
- Details:

## Running Instance Strategy
- Existing instances stay on old version: yes/no
- Migration required: yes/no
- Migration plan link:

## Rollout Strategy
- all-at-once / canary / tenant-based / feature-flagged
- canary criteria:
- success criteria:

## Rollback Strategy
- new-start rollback:
- worker rollback:
- forward fix:
- active instance treatment:

## Test Evidence
- unit tests:
- process scenario tests:
- contract tests:
- performance tests:
- security tests:

## Observability
- dashboard:
- alerts:
- logs/traces:

## Approval
- Process owner:
- Tech lead:
- QA:
- Operations:
- Security/compliance if needed:
```

---

## 44. Staff-Level Heuristics

Beberapa heuristik praktis:

1. **Treat BPMN as executable code.**  
   Review, test, version, and release it like code.

2. **Treat job type as API endpoint.**  
   If input/output contract breaks, version it.

3. **Treat variables as public contracts.**  
   Do not leak domain entity internals.

4. **Treat process version coexistence as normal.**  
   Old and new instances will run together.

5. **Treat rollback as a workflow operation, not just CI/CD operation.**  
   Running instances have durable state.

6. **Prefer forward-compatible workers.**  
   Support old and new schema during transition.

7. **Avoid accidental latest binding in production.**  
   Latest is convenient, not governance.

8. **Do not migrate instances casually.**  
   Migration changes runtime state and needs evidence.

9. **Keep old compatibility until active count and incident count reach zero.**  
   Not until “release is done”.

10. **Every production process release needs an owner.**  
    Or it becomes nobody’s problem during incident.

---

## 45. Design Review Questions

Saat review process release, tanyakan:

1. Apa yang berubah di BPMN?
2. Apakah element IDs stabil?
3. Apakah ada job type baru?
4. Apakah ada job type lama yang berubah meaning?
5. Apakah worker sudah deployed sebelum BPMN?
6. Apakah worker baru compatible dengan old process instances?
7. Apakah variable schema berubah?
8. Apakah old variables masih bisa diproses?
9. Apakah message name/correlation key berubah?
10. Apakah external callbacks in-flight terdampak?
11. Apakah user task form berubah?
12. Apakah running tasks lama terdampak?
13. Apakah DMN/call activity binding disengaja?
14. Apakah migration diperlukan?
15. Apakah rollback realistic?
16. Bagaimana stop new starts jika release buruk?
17. Bagaimana monitor canary?
18. Siapa support owner saat incident?
19. Apa audit evidence deployment?
20. Kapan old worker logic boleh dihapus?

---

## 46. Common Interview / Staff Engineer Questions

### 46.1 “Apa yang terjadi jika Anda deploy BPMN baru dengan process ID sama?”

Jawaban baik:

- engine membuat process definition version baru jika definition berubah,
- new instances generally use latest jika start by BPMN process ID/latest,
- running instances tetap pada version mereka,
- worker harus compatible dengan multiple process versions,
- governance harus melacak mapping Git release to runtime version.

### 46.2 “Bagaimana rollback process release?”

Jawaban baik:

- rollback tidak sama dengan rollback stateless service,
- stop new starts atau route ke previous version,
- cek worker compatibility,
- existing new-version instances harus dianalisis,
- mungkin forward fix lebih aman,
- migration/modification hanya dengan plan,
- external side effects perlu reconciliation/compensation.

### 46.3 “Kapan Anda version job type?”

Jawaban baik:

- jika input/output/semantic contract breaking,
- jika old and new workers perlu hidup paralel,
- jika migration/observability butuh explicit separation,
- additive optional field mungkin tidak perlu job type baru.

### 46.4 “Mengapa latest binding berbahaya?”

Jawaban baik:

- karena linked resource seperti form/DMN/called process bisa berubah behavior untuk runtime yang tidak diantisipasi,
- production workflow butuh deterministic/reproducible release,
- latest cocok untuk dev/simple use case, bukan default regulated process.

### 46.5 “Bagaimana menghapus support old variable schema?”

Jawaban baik:

- cek active instances old version,
- cek unresolved incidents,
- cek support replay/retry needs,
- pastikan no old jobs appear for retirement window,
- remove in planned major worker release,
- document retirement evidence.

---

## 47. Mini Case Study: Regulatory Application Release

### 47.1 Context

Sebuah agency memiliki process:

```text
license-application
```

Durasi rata-rata: 20 hari.  
Ada human review, external screening, payment, appeal path.

### 47.2 Change

Regulasi baru mengharuskan:

- screening tambahan untuk corporate applicant,
- new user task form field `beneficialOwnerDeclaration`,
- risk decision rule berubah,
- SLA untuk corporate review menjadi 10 hari.

### 47.3 Bad Plan

```text
1. Edit BPMN.
2. Deploy to prod.
3. Deploy worker.
4. Hope.
```

### 47.4 Good Plan

```text
1. Create release tag 2026-Q3-corporate-screening.
2. Add new BPMN path for corporate applicants.
3. Add calculate-corporate-risk.v1 job type.
4. Keep individual path unchanged.
5. Add form version tag for corporate review form.
6. Bind DMN risk decision to release tag.
7. Deploy worker first.
8. Deploy BPMN/DMN/forms as release bundle.
9. Route only new corporate applications to new version.
10. Keep existing applications on old version unless regulation says active cases must comply.
11. If active cases must comply, create migration plan for cases before screening milestone only.
12. Monitor incidents, SLA timer, task backlog.
13. Capture deployment evidence.
```

### 47.5 Why This Is Better

Karena ia membedakan:

- new cases,
- active cases before milestone,
- active cases after milestone,
- individual vs corporate,
- worker compatibility,
- form compatibility,
- DMN rule defensibility,
- operational monitoring.

Ini adalah cara pikir engineering, bukan sekadar modelling.

---

## 48. Practical Rules for Java Teams

1. Simpan BPMN/DMN/forms di repository yang sama atau release bundle yang bisa dilacak.
2. Jangan deploy BPMN manual ke production tanpa evidence.
3. Worker harus punya package contract terpisah.
4. Variable mapper harus version-aware.
5. Gunakan schema version untuk payload penting.
6. Version job type jika semantic contract berubah.
7. Deploy worker compatible sebelum BPMN yang membutuhkannya.
8. Jangan hapus old contract support sebelum old active instances habis.
9. Gunakan process registry untuk controlling new starts.
10. Treat process instance migration as production operation requiring approval.
11. Observability harus include process release/version dimension.
12. Release note harus menjawab rollback, migration, compatibility.

---

## 49. What to Avoid in Code

### 49.1 Avoid Raw Map Everywhere

Buruk:

```java
String applicantId = (String) job.getVariablesAsMap().get("applicantId");
```

Lebih baik:

```java
ApplicationValidationInput input = applicationValidationMapper.from(job);
```

### 49.2 Avoid Hidden Latest Start

Buruk:

```java
startLatest("license-application", vars);
```

Lebih baik:

```java
workflowStarter.startLicenseApplication(command, StartPolicy.controlledByRegistry());
```

### 49.3 Avoid Worker That Assumes One Process Version

Buruk:

```java
// assumes all jobs are from latest process model
```

Lebih baik:

```java
// supports declared active contracts, rejects unsupported contracts explicitly
```

---

## 50. Summary

Bagian ini bisa diringkas dalam beberapa prinsip:

1. **Camunda process definition version adalah runtime reality, bukan hanya metadata.**
2. **Running instances tidak otomatis mengikuti process version baru.**
3. **Worker harus siap menghadapi multi-version process runtime.**
4. **Job type, variables, messages, forms, DMN, and call activities are contracts.**
5. **Rollback workflow bukan sekadar rollback artifact.**
6. **Process instance migration adalah operasi runtime serius, bukan refactoring.**
7. **Release governance harus mencakup BPMN, Java worker, variables, forms, decisions, operations, and audit.**
8. **Production-grade Camunda team membutuhkan compatibility matrix, release ledger, and process registry.**

Jika part ini dipahami dengan benar, Anda akan mulai melihat Camunda 8 bukan hanya sebagai workflow engine, tetapi sebagai **durable distributed runtime contract** yang harus dikelola seperti platform mission-critical.

---

## 51. References

- Camunda 8 Docs — Versioning process definitions: https://docs.camunda.io/docs/components/best-practices/operations/versioning-process-definitions/
- Camunda 8 Docs — Process instance migration: https://docs.camunda.io/docs/components/concepts/process-instance-migration/
- Camunda 8 Docs — Migrate process instances in Operate: https://docs.camunda.io/docs/components/operate/userguide/process-instance-migration/
- Camunda 8 Docs — Process instance modification: https://docs.camunda.io/docs/components/concepts/process-instance-modification/
- Camunda 8 Docs — Choosing the resource binding type: https://docs.camunda.io/docs/components/best-practices/modeling/choosing-the-resource-binding-type/
- Camunda 8 Docs — Process application versioning: https://docs.camunda.io/docs/components/modeler/web-modeler/process-applications/process-application-versioning/
- Camunda 8 Docs — Process application development lifecycle: https://docs.camunda.io/docs/components/modeler/web-modeler/process-applications/process-application-pipeline/
- Camunda 8 Docs — Deploy resources API: https://docs.camunda.io/docs/apis-tools/orchestration-cluster-api-rest/specifications/create-deployment/
- Camunda 8 Docs — Java Client: https://docs.camunda.io/docs/apis-tools/java-client/getting-started/
- Camunda 8 Docs — Migrating from Camunda 7: https://docs.camunda.io/docs/guides/migrating-from-camunda-7/

---

## 52. Status Seri

Seri belum selesai.

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-028.md
```

Judul:

```text
Part 028 — Migration from Camunda 7 to Camunda 8: Strategy, Gaps, Refactoring, and Risk Control
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-026.md">⬅️ Part 026 — Testing Strategy: BPMN, Workers, Integration Tests, Testcontainers, and Contract Tests</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-028.md">Part 028 — Migration from Camunda 7 to Camunda 8: Strategy, Gaps, Refactoring, and Risk Control ➡️</a>
</div>
