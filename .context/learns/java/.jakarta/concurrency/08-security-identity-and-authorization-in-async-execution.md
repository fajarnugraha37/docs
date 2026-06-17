# Part 8 — Security, Identity, and Authorization in Async Execution

**Series:** `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
**File:** `08-security-identity-and-authorization-in-async-execution.md`  
**Scope:** Java 8–25, Java EE / Jakarta EE, `javax.*` to `jakarta.*`, Jakarta Concurrency, Jakarta Security, Jakarta Authorization/JACC, Enterprise Beans async behavior, batch/control-plane implications  
**Baseline:** Jakarta EE 11, Jakarta Concurrency 3.1, Jakarta Security 4.0, Jakarta Authorization 3.0  
**Status:** Advanced continuation; assumes prior knowledge of Java concurrency, authentication, authorization, Jakarta Security, CDI, JTA, and Jakarta Concurrency basics.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami perbedaan antara **caller identity**, **execution identity**, **system identity**, dan **audit identity** dalam pekerjaan asynchronous.
2. Mendesain async task yang aman ketika user request sudah selesai, user session sudah expired, atau role user sudah berubah.
3. Menentukan kapan authorization harus dilakukan saat **enqueue**, saat **execution**, atau keduanya.
4. Mencegah privilege escalation akibat propagasi security context yang terlalu naif.
5. Memisahkan security decision dari audit attribution.
6. Mendesain background processing yang defensible untuk sistem enterprise/regulatory.
7. Memahami bagaimana Jakarta Concurrency dan container memperlakukan security context.
8. Membuat pola `AsyncCommand`, `JobRequest`, dan `AuditActor` yang aman untuk production.
9. Menghindari anti-pattern seperti menyimpan `Principal` mentah, mengandalkan session aktif, atau menjalankan background job dengan identitas user tanpa boundary.
10. Menyiapkan fondasi untuk Jakarta Batch control plane, job authorization, dan audit execution di bagian-bagian berikutnya.

---

## 2. Core Problem: Async Execution Memutus Hubungan Natural Antara User dan Work

Pada request synchronous biasa, model security tampak sederhana:

```text
HTTP request arrives
    ↓
Container authenticates user
    ↓
Application checks authorization
    ↓
Business logic executes
    ↓
Response returned
```

Dalam model itu, banyak asumsi terasa natural:

- ada active request;
- ada active caller;
- ada active security context;
- ada active session/token;
- `getCallerPrincipal()` atau `SecurityContext#getCallerPrincipal()` punya arti langsung;
- audit log dapat bilang “Fajar melakukan action X” karena action X terjadi di thread request Fajar.

Tetapi pada async execution, relasinya berubah:

```text
User request arrives
    ↓
User asks system to do work later
    ↓
Request returns
    ↓
Seconds/minutes/hours later, background worker executes work
```

Pertanyaan pentingnya bukan lagi hanya:

> “Siapa caller saat ini?”

Melainkan:

> “Siapa yang meminta pekerjaan ini, siapa yang mengotorisasi pekerjaan ini, dengan otoritas siapa pekerjaan ini dieksekusi, dan bagaimana sistem membuktikan keputusan itu setelah fakta?”

Itulah inti bagian ini.

---

## 3. Mental Model Utama

### 3.1 Synchronous Security Model

Dalam request synchronous:

```text
Caller identity == execution identity == audit actor, biasanya cukup dekat
```

Contoh:

```text
User: compliance.officer1
Action: approve case escalation
Thread: HTTP worker thread
Security context: compliance.officer1
Audit: compliance.officer1 approved escalation
```

Walaupun implementasi internalnya kompleks, secara domain masih mudah dimengerti.

---

### 3.2 Async Security Model

Dalam async execution:

```text
caller identity ≠ execution identity ≠ audit identity
```

Contoh:

```text
User: compliance.officer1
Action requested: bulk regenerate warning letters
Request time: 2026-06-17 10:00
Execution time: 2026-06-17 10:05
Executor thread: managed-executor-worker-7
Actual DB/API credentials: service account
Audit actor: requested by compliance.officer1, executed by system-batch-worker
```

Di sini ada beberapa identitas:

| Identity | Arti | Contoh |
|---|---|---|
| Caller identity | Subjek yang membuat request awal | `compliance.officer1` |
| Initiator identity | Subjek yang meminta pekerjaan asynchronous | `compliance.officer1` |
| Approver identity | Subjek yang menyetujui pekerjaan, jika ada approval | `team.lead1` |
| Execution identity | Identitas runtime yang benar-benar menjalankan task | `system-job-runner` |
| Effective authority | Hak yang digunakan saat mengeksekusi aksi | role/job permission tertentu |
| Audit actor | Representasi bukti siapa melakukan apa dalam record audit | initiatedBy + executedBy + approvedBy |
| Technical identity | Credential teknis untuk DB/API/external system | DB pool user, OAuth client credential |

Software engineer top-tier tidak menyederhanakan semua ini menjadi satu `Principal`.

---

## 4. Prinsip Fundamental

### 4.1 Jangan Menganggap Security Context Selalu Valid Setelah Async Boundary

Security context yang ada saat request dibuat mungkin:

- tidak dipropagasikan;
- dipropagasikan sebagian;
- dipropagasikan tetapi tidak valid secara domain;
- valid secara container tetapi tidak valid secara business;
- tidak lagi merepresentasikan authorization terbaru.

Misalnya:

```text
10:00 user masih punya role APPROVER
10:01 user submit async approval job
10:02 role user dicabut
10:05 job berjalan
```

Pertanyaan desainnya:

> Apakah job masih boleh berjalan dengan role lama?

Tidak ada jawaban universal. Harus ditentukan berdasarkan domain.

Untuk regulatory system, biasanya keputusan harus eksplisit:

- authorization cukup saat enqueue;
- authorization dicek ulang saat execution;
- authorization butuh approval snapshot;
- authorization harus dibatalkan jika role berubah;
- job boleh jalan karena sudah menjadi system obligation setelah diterima.

Yang salah adalah tidak memilih dan membiarkan behavior tergantung implementasi container.

---

### 4.2 Authorization Bukan Sekadar “Apakah User Login?”

Async job sering dibuat oleh user yang sudah login, tetapi execution-nya terjadi ketika user tidak hadir.

Maka authorization perlu menjawab:

1. Apakah user boleh meminta pekerjaan ini?
2. Apakah parameter pekerjaan ini valid untuk scope user?
3. Apakah data target berada dalam jurisdiction/tenant/module user?
4. Apakah pekerjaan ini butuh approval tambahan?
5. Apakah pekerjaan ini boleh tetap dijalankan setelah user logout?
6. Apakah pekerjaan ini boleh tetap dijalankan setelah role user berubah?
7. Apakah pekerjaan ini boleh di-retry otomatis?
8. Apakah operator/admin boleh restart job ini?
9. Apakah restart memakai authority asli, authority operator, atau authority sistem?
10. Bagaimana audit membedakan semuanya?

---

### 4.3 Propagating Identity Is Not the Same as Delegating Authority

Misalnya user A melakukan request:

```java
executor.submit(() -> service.generateLetters(caseIds));
```

Jika security context user A ikut dipropagasikan ke worker thread, bukan berarti semua operasi background boleh dianggap user A melakukan langsung.

Kenapa?

Karena user A mungkin hanya mengotorisasi “request generation”, bukan setiap side effect internal berikutnya:

- membaca case;
- mengambil template;
- membaca profile party;
- generate PDF;
- menyimpan dokumen;
- mengirim email;
- memanggil external registry;
- update status;
- menulis audit trail.

Dalam sistem serius, permission “request bulk generation” dan permission “execute internal system side effects” sering berbeda.

---

### 4.4 Audit Attribution Harus Lebih Kaya dari Principal Name

Audit yang buruk:

```json
{
  "actor": "system",
  "action": "GENERATE_LETTER",
  "caseId": "CASE-001"
}
```

Masalah:

- siapa yang meminta?
- kapan diminta?
- dengan role apa?
- job apa?
- kenapa sistem menjalankan?
- apakah ada approval?
- apakah ini retry?
- apakah ini restart?

Audit yang lebih defensible:

```json
{
  "eventType": "LETTER_GENERATED",
  "caseId": "CASE-001",
  "jobId": "JOB-20260617-000123",
  "requestedBy": "compliance.officer1",
  "requestedAt": "2026-06-17T10:00:00+07:00",
  "requestRoles": ["COMPLIANCE_OFFICER"],
  "requestReason": "Bulk warning letter generation after escalation review",
  "approvedBy": "team.lead1",
  "approvedAt": "2026-06-17T10:02:00+07:00",
  "executedBy": "system-letter-worker",
  "executedAt": "2026-06-17T10:05:12+07:00",
  "executionMode": "ASYNC_MANAGED_EXECUTOR",
  "retryAttempt": 0,
  "correlationId": "corr-abc-123",
  "authorizationSnapshotId": "AUTHZ-SNAP-777"
}
```

Perhatikan: `executedBy` bukan menggantikan `requestedBy`. Keduanya punya arti berbeda.

---

## 5. Security Context dalam Jakarta Concurrency

Jakarta Concurrency menyediakan managed concurrency agar task dapat berjalan dengan konteks container yang benar.

Secara konseptual, konteks yang dapat relevan mencakup:

- naming context;
- classloader;
- security context;
- application/module context;
- vendor-supported additional context;
- contextual proxy melalui `ContextService`;
- context configuration untuk managed executor/resource tertentu.

Tetapi ada dua hal penting:

1. Security propagation adalah fitur container/spec-level, bukan pengganti domain authorization.
2. Application tetap perlu mendesain audit dan business authority sendiri.

### 5.1 ManagedExecutorService dan Security Context

Contoh sederhana:

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

import java.util.concurrent.Future;

@ApplicationScoped
public class AsyncCaseService {

    @Resource
    private ManagedExecutorService executor;

    @Inject
    private SecurityContext securityContext;

    public Future<Void> requestAsyncWork(String caseId) {
        String principalName = securityContext.getCallerPrincipal().getName();

        return executor.submit(() -> {
            // Depending on container configuration/spec behavior,
            // a security context may be available here.
            // But do not build domain correctness solely on this assumption.
            runWork(caseId, principalName);
            return null;
        });
    }

    private void runWork(String caseId, String requestedBy) {
        // business logic
    }
}
```

Kode di atas masih terlalu sederhana. Ia mengambil principal name, tetapi belum menjawab:

- role apa yang dimiliki saat request?
- scope data apa yang boleh diakses?
- apakah job boleh tetap jalan nanti?
- apakah role perlu dicek ulang?
- apakah parameter sudah divalidasi?
- bagaimana audit direkam?

---

## 6. Jangan Menyimpan Principal Mentah Sebagai Domain Contract

### 6.1 Anti-Pattern

```java
public class BackgroundTask implements Callable<Void> {
    private final Principal principal;
    private final List<String> caseIds;

    public BackgroundTask(Principal principal, List<String> caseIds) {
        this.principal = principal;
        this.caseIds = caseIds;
    }

    @Override
    public Void call() {
        for (String caseId : caseIds) {
            process(caseId, principal);
        }
        return null;
    }
}
```

Masalah:

1. `Principal` adalah representasi runtime security, bukan snapshot domain authorization.
2. Ia mungkin tidak serializable.
3. Ia mungkin terikat pada container/session/security provider.
4. Ia tidak menjelaskan role, tenant, module scope, approval state, atau reason.
5. Ia tidak stabil untuk restart/retry.
6. Ia sulit diaudit secara defensible.

---

### 6.2 Pattern: Explicit Actor Snapshot

Buat model eksplisit:

```java
import java.time.OffsetDateTime;
import java.util.Set;

public record ActorSnapshot(
        String userId,
        String username,
        Set<String> roles,
        Set<String> permissions,
        String tenantId,
        String agencyId,
        String moduleCode,
        OffsetDateTime capturedAt,
        String captureReason
) {}
```

Lalu gunakan snapshot sebagai bagian dari job request:

```java
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record AsyncJobRequest(
        UUID jobId,
        String jobType,
        ActorSnapshot requestedBy,
        List<String> targetIds,
        String reason,
        OffsetDateTime requestedAt,
        String correlationId
) {}
```

Dengan begini, domain tidak tergantung pada lifecycle `Principal` runtime.

---

## 7. Authorization Timing: Enqueue-Time vs Execution-Time

Salah satu keputusan desain paling penting adalah kapan authorization dilakukan.

### 7.1 Enqueue-Time Authorization

Authorization dilakukan saat user meminta job.

```text
User submits job
    ↓
Validate permission and data scope
    ↓
Persist job request with actor snapshot
    ↓
Return jobId
    ↓
Worker executes later
```

Cocok ketika:

- request user adalah domain event yang sah;
- setelah diterima, sistem punya kewajiban menjalankan;
- job harus tetap berjalan walaupun user logout;
- role user setelah request tidak relevan terhadap pekerjaan yang sudah diterima;
- audit perlu membuktikan user valid saat request dibuat.

Contoh:

- user submit report generation;
- officer request mass recalculation;
- supervisor approve enforcement escalation;
- system schedules correspondence generation from approved decision.

Risiko:

- role dicabut setelah enqueue tetapi job tetap berjalan;
- parameter mungkin stale;
- data target bisa berubah scope;
- perlu snapshot kuat dan audit kuat.

---

### 7.2 Execution-Time Authorization

Authorization dicek ulang saat job benar-benar berjalan.

```text
User submits job
    ↓
Persist job request
    ↓
Worker picks job
    ↓
Re-check current permissions/scope
    ↓
Execute or reject
```

Cocok ketika:

- permission harus selalu current;
- job dapat menunggu lama;
- role/user status bisa berubah signifikan;
- domain mensyaratkan authority aktif saat execution;
- job bersifat “delegated user action”, bukan system obligation.

Contoh:

- async export data sensitif;
- delayed bulk update yang masih mewakili user;
- async action yang bisa melanggar current segregation-of-duty;
- sensitive administrative command.

Risiko:

- job bisa gagal walaupun valid saat dibuat;
- user experience perlu menjelaskan kenapa job ditolak;
- restart/retry perlu aturan jelas.

---

### 7.3 Dual Authorization

Keduanya dilakukan.

```text
At enqueue:
    can user request this job?
    are parameters within user's scope?

At execution:
    is job still allowed?
    is actor still active?
    is target state still valid?
```

Ini biasanya pilihan paling aman untuk sistem enterprise/regulatory.

Namun jangan asal cek ulang role yang sama. Buat jenis check berbeda:

| Moment | Check | Tujuan |
|---|---|---|
| Enqueue | Request permission | Mencegah job ilegal masuk queue |
| Enqueue | Parameter scope | Mencegah user memasukkan target di luar scope |
| Execution | Job state validity | Mencegah eksekusi stale |
| Execution | Actor/account status | Mencegah action dari disabled actor jika domain butuh |
| Execution | Target state | Mencegah side effect pada entity yang sudah berubah |
| Execution | System policy | Mencegah job berjalan saat freeze/maintenance |

---

## 8. Authority Model: User Delegation vs System Obligation

Async work harus diklasifikasikan berdasarkan authority model-nya.

### 8.1 User-Delegated Async Work

Pekerjaan masih dianggap perpanjangan dari aksi user.

Contoh:

- export data milik user;
- generate report sesuai filter user;
- apply bulk update atas pilihan user;
- upload file yang diproses async atas nama user.

Karakteristik:

- `requestedBy` sangat penting;
- scope user harus divalidasi;
- sering perlu execution-time check;
- hasil harus dibatasi sesuai hak user;
- cancellation oleh user mungkin valid.

---

### 8.2 System-Obligation Async Work

Setelah user/system event diterima, pekerjaan menjadi kewajiban sistem.

Contoh:

- generate audit evidence setelah decision approved;
- send notification wajib;
- propagate state to downstream system;
- recalculate SLA after case state transition;
- create enforcement record after final approval.

Karakteristik:

- `requestedBy` tetap diaudit;
- execution boleh memakai system identity;
- retry otomatis lebih natural;
- user logout tidak membatalkan job;
- role user setelah event mungkin tidak relevan;
- idempotency dan durable job jauh lebih penting.

---

### 8.3 Operator-Controlled Async Work

Pekerjaan dikontrol oleh operator/admin.

Contoh:

- restart failed job;
- reprocess dead-letter item;
- rerun nightly reconciliation;
- force stop batch;
- abandon stuck job.

Karakteristik:

- `requestedBy` original tetap ada;
- `operatedBy` harus dicatat;
- authority operator berbeda dari authority original requester;
- perlu reason wajib;
- perlu audit administrative action.

Contoh audit:

```json
{
  "jobId": "JOB-123",
  "eventType": "JOB_RESTARTED",
  "originalRequestedBy": "compliance.officer1",
  "operatedBy": "batch.operator1",
  "operationReason": "Retry after downstream timeout resolved",
  "previousExecutionId": "EXEC-1",
  "newExecutionId": "EXEC-2"
}
```

---

## 9. Session Expiry, Logout, dan Token Expiry

### 9.1 User Session Tidak Boleh Menjadi Dependency Async Job

Jika job berjalan 5 menit setelah request, session user bisa sudah expired.

Jangan desain seperti ini:

```text
Worker needs active HTTP session to know user identity
```

Itu rapuh.

Async job harus punya semua metadata minimum yang dibutuhkan:

- requester id;
- requester display name/username;
- role/permission snapshot jika dibutuhkan;
- tenant/scope snapshot;
- approval metadata;
- reason;
- correlation id;
- job parameters;
- idempotency key.

---

### 9.2 Access Token Tidak Boleh Dipakai Tanpa Pertimbangan

Kadang aplikasi tergoda menyimpan user access token untuk dipakai background worker.

Masalah:

- token bisa expired;
- refresh token mungkin tidak boleh disimpan aplikasi;
- token user memberi authority terlalu luas;
- token leakage sangat berbahaya;
- retry job bisa gagal akibat token lifecycle;
- user revocation/logout tidak jelas pengaruhnya;
- audit teknis menjadi sulit.

Lebih aman:

- gunakan service credential untuk system obligation;
- simpan actor snapshot untuk audit;
- gunakan explicit delegated grant hanya jika domain/security model memang mendukung;
- batasi scope token;
- enkripsi secret/token;
- simpan minimal;
- punya revocation semantics yang jelas.

---

## 10. Pattern: Secure Async Command

### 10.1 Domain Command

```java
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

public record SecureAsyncCommand(
        UUID commandId,
        String commandType,
        ActorSnapshot requestedBy,
        String authorityMode,
        Map<String, Object> parameters,
        String reason,
        String correlationId,
        OffsetDateTime requestedAt
) {}
```

`authorityMode` bisa berupa:

```text
USER_DELEGATED
SYSTEM_OBLIGATION
OPERATOR_CONTROLLED
SCHEDULED_SYSTEM
```

---

### 10.2 Authorization Service

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class AsyncAuthorizationService {

    public void authorizeEnqueue(ActorSnapshot actor, String commandType, Object target) {
        if (!actor.permissions().contains(requiredPermissionFor(commandType))) {
            throw new ForbiddenException("User cannot request command: " + commandType);
        }

        if (!isTargetInsideScope(actor, target)) {
            throw new ForbiddenException("Target is outside user's authorized scope");
        }
    }

    public void authorizeExecution(SecureAsyncCommand command, CurrentPolicySnapshot policy) {
        switch (command.authorityMode()) {
            case "USER_DELEGATED" -> authorizeUserDelegatedExecution(command, policy);
            case "SYSTEM_OBLIGATION" -> authorizeSystemObligationExecution(command, policy);
            case "OPERATOR_CONTROLLED" -> authorizeOperatorControlledExecution(command, policy);
            default -> throw new IllegalStateException("Unknown authority mode");
        }
    }

    private String requiredPermissionFor(String commandType) {
        return switch (commandType) {
            case "BULK_GENERATE_WARNING_LETTER" -> "case.letter.generate.bulk";
            case "EXPORT_SENSITIVE_REPORT" -> "report.sensitive.export";
            default -> throw new IllegalArgumentException("Unknown command type");
        };
    }

    private boolean isTargetInsideScope(ActorSnapshot actor, Object target) {
        // Domain-specific tenant/module/agency/case ownership check.
        return true;
    }

    private void authorizeUserDelegatedExecution(SecureAsyncCommand command, CurrentPolicySnapshot policy) {
        // Example: actor must still be active, job must still be allowed,
        // target state must still be valid.
    }

    private void authorizeSystemObligationExecution(SecureAsyncCommand command, CurrentPolicySnapshot policy) {
        // Example: original request was valid, job state is valid,
        // system is allowed to fulfill obligation even after logout.
    }

    private void authorizeOperatorControlledExecution(SecureAsyncCommand command, CurrentPolicySnapshot policy) {
        // Operator-specific path.
    }
}
```

---

### 10.3 Submit Flow

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.concurrent.ManagedExecutorService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

@ApplicationScoped
public class SecureAsyncCommandFacade {

    @Resource
    private ManagedExecutorService executor;

    @Inject
    private SecurityContext securityContext;

    @Inject
    private ActorSnapshotFactory actorSnapshotFactory;

    @Inject
    private AsyncAuthorizationService authorizationService;

    @Inject
    private JobRequestRepository jobRequestRepository;

    @Inject
    private SecureCommandWorker worker;

    public UUID submitBulkLetterGeneration(BulkLetterRequest request) {
        ActorSnapshot actor = actorSnapshotFactory.captureFrom(securityContext, "BULK_LETTER_REQUEST");

        authorizationService.authorizeEnqueue(actor, "BULK_GENERATE_WARNING_LETTER", request.caseIds());

        UUID jobId = UUID.randomUUID();

        SecureAsyncCommand command = new SecureAsyncCommand(
                jobId,
                "BULK_GENERATE_WARNING_LETTER",
                actor,
                "SYSTEM_OBLIGATION",
                Map.of("caseIds", request.caseIds()),
                request.reason(),
                request.correlationId(),
                OffsetDateTime.now()
        );

        jobRequestRepository.insert(command);

        executor.submit(() -> worker.execute(jobId));

        return jobId;
    }
}
```

Catatan penting:

- job request dipersist sebelum worker dijalankan;
- worker menerima `jobId`, bukan object transient besar;
- worker membaca state terbaru dari repository;
- audit dapat direkonstruksi;
- retry/restart lebih aman.

---

### 10.4 Worker Flow

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.UUID;

@ApplicationScoped
public class SecureCommandWorker {

    @Inject
    private JobRequestRepository repository;

    @Inject
    private AsyncAuthorizationService authorizationService;

    @Inject
    private AuditService auditService;

    @Inject
    private LetterGenerationService letterGenerationService;

    public void execute(UUID jobId) {
        SecureAsyncCommand command = repository.findForExecution(jobId)
                .orElseThrow(() -> new IllegalStateException("Job not found: " + jobId));

        auditService.recordJobExecutionStarted(command);

        try {
            CurrentPolicySnapshot policy = CurrentPolicySnapshot.load();
            authorizationService.authorizeExecution(command, policy);

            letterGenerationService.generate(command);

            repository.markSucceeded(jobId);
            auditService.recordJobExecutionSucceeded(command);
        } catch (ForbiddenException ex) {
            repository.markRejected(jobId, ex.getMessage());
            auditService.recordJobExecutionRejected(command, ex);
        } catch (Exception ex) {
            repository.markFailed(jobId, ex);
            auditService.recordJobExecutionFailed(command, ex);
            throw ex;
        }
    }
}
```

---

## 11. Privilege Escalation Risks

### 11.1 Risk: User Can Enqueue More Than They Can Execute

Contoh:

```text
User has permission to view Case A
User manipulates request body to include Case B
Async job later processes Case B as system
```

Mitigasi:

- validate all target IDs at enqueue time;
- do not trust UI;
- use server-side scope resolution;
- store resolved target list, not raw filter only;
- store filter + snapshot if target list may be too large;
- validate again before side effect for sensitive operations.

---

### 11.2 Risk: Role Snapshot Too Broad

Jika snapshot menyimpan semua roles user, task bisa memakai role yang tidak relevan.

Lebih baik simpan:

```json
{
  "requestedBy": "officer1",
  "grantedPurpose": "BULK_GENERATE_WARNING_LETTER",
  "grantedPermissions": ["case.letter.generate.bulk"],
  "scope": {
    "agencyId": "CEA",
    "module": "COMPLIANCE",
    "caseIds": ["CASE-1", "CASE-2"]
  }
}
```

Ini adalah **purpose-bound authorization snapshot**.

---

### 11.3 Risk: System Identity Becomes Superuser Escape Hatch

Background worker sering berjalan sebagai system identity. Jika semua worker punya akses semua hal, bug kecil menjadi privilege escalation besar.

Mitigasi:

- system identity dibagi per capability;
- permission internal dibatasi;
- worker mengecek command type;
- worker mengecek allowed transition;
- semua side effect harus membawa job id;
- audit wajib;
- admin operation butuh reason;
- sensitive job butuh approval.

Contoh system identity yang lebih granular:

```text
system-letter-worker
system-escalation-evaluator
system-report-exporter
system-registry-sync
system-batch-operator
```

Bukan:

```text
system-admin
```

---

### 11.4 Risk: Confused Deputy

Confused deputy terjadi ketika komponen privileged dipakai untuk melakukan sesuatu atas nama user yang sebenarnya tidak berhak.

Contoh:

```text
User cannot access Case B directly.
But user can call async endpoint with caseId=CaseB.
Worker runs as system and updates Case B.
```

Mitigasi:

- worker tidak boleh menerima authority implicit dari fakta “job exists” saja;
- job creation harus melewati authorization;
- job parameters harus immutable setelah authorized;
- target scope harus tersimpan;
- worker harus verify command integrity;
- gunakan signed/hash command payload bila perlu;
- audit rejection untuk unauthorized target.

---

## 12. Authorization Snapshot Design

### 12.1 Apa yang Disimpan?

Minimum:

```text
userId
username/display name
roles/permissions relevant to requested action
tenant/agency/module scope
target entity scope
request timestamp
request channel
correlation id
reason
```

Untuk sistem compliance/regulatory:

```text
approval id
approval actor
approval timestamp
policy version
decision basis
case state at request time
data classification
legal basis / processing purpose
```

---

### 12.2 Snapshot vs Current Policy

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| Use only snapshot | Repeatable, audit-friendly | Bisa menjalankan authority yang sudah dicabut |
| Use only current policy | Selalu fresh | Job lama bisa tidak repeatable/restartable |
| Snapshot + current validity check | Balance | Lebih kompleks |

Rekomendasi enterprise:

```text
Use snapshot for audit and original authorization.
Use current policy for safety gates at execution time.
```

---

### 12.3 Policy Versioning

Jika authorization rule berubah, job lama bisa ambigu.

Contoh:

```text
Policy v1: officer can bulk generate letters for all active cases.
Policy v2: officer can only generate for assigned cases.
```

Jika job dibuat di v1 dan dieksekusi setelah v2, apa yang terjadi?

Pilihan:

1. Jalankan berdasarkan policy saat request dibuat.
2. Revalidate berdasarkan policy terbaru.
3. Require approval/review jika policy berubah.
4. Fail job dan minta user resubmit.

Untuk domain regulatory, simpan `policyVersion` atau minimal `authorizationDecisionId`.

```java
public record AuthorizationDecisionSnapshot(
        String decisionId,
        String policyVersion,
        String permission,
        String targetScopeHash,
        String decision,
        String reason
) {}
```

---

## 13. Audit Model untuk Async Execution

### 13.1 Audit Events yang Harus Ada

Untuk async job yang penting, audit bukan hanya saat selesai.

Rekomendasi event:

```text
JOB_REQUESTED
JOB_AUTHORIZED_AT_ENQUEUE
JOB_REJECTED_AT_ENQUEUE
JOB_ACCEPTED
JOB_EXECUTION_STARTED
JOB_AUTHORIZED_AT_EXECUTION
JOB_REJECTED_AT_EXECUTION
JOB_SIDE_EFFECT_STARTED
JOB_SIDE_EFFECT_COMPLETED
JOB_RETRY_SCHEDULED
JOB_CANCEL_REQUESTED
JOB_CANCELLED
JOB_FAILED
JOB_SUCCEEDED
JOB_RESTART_REQUESTED
JOB_ABANDONED
```

---

### 13.2 Audit Actor Fields

Gunakan field berbeda:

```json
{
  "requestedBy": "user-a",
  "executedBy": "system-worker-x",
  "operatedBy": "operator-y",
  "approvedBy": "supervisor-z"
}
```

Jangan menaruh semuanya di satu field `actor`.

---

### 13.3 Audit untuk Retry

Retry tidak boleh terlihat seperti aksi user baru.

Audit retry:

```json
{
  "eventType": "JOB_RETRY_SCHEDULED",
  "jobId": "JOB-123",
  "attempt": 2,
  "originalRequestedBy": "officer1",
  "executedBy": "system-letter-worker",
  "retryReason": "HTTP_503_FROM_TEMPLATE_SERVICE",
  "nextAttemptAt": "2026-06-17T10:15:00+07:00"
}
```

---

## 14. Secure State Machine untuk Async Job

Security lebih mudah jika job punya state machine eksplisit.

```text
REQUESTED
    ↓ authorize enqueue
ACCEPTED
    ↓ worker picks job
RUNNING
    ↓ success
SUCCEEDED
```

Dengan failure paths:

```text
REQUESTED → REJECTED
ACCEPTED → CANCELLED
RUNNING → FAILED_RETRYABLE → ACCEPTED
RUNNING → FAILED_TERMINAL
RUNNING → REJECTED_AT_EXECUTION
FAILED_TERMINAL → RESTART_REQUESTED → ACCEPTED
FAILED_TERMINAL → ABANDONED
```

Setiap transition punya authorization rule.

| Transition | Required Authority |
|---|---|
| REQUESTED → ACCEPTED | requester can create job |
| ACCEPTED → RUNNING | system worker can execute job type |
| RUNNING → CANCELLED | requester/operator can cancel |
| FAILED_TERMINAL → RESTART_REQUESTED | operator can restart |
| FAILED_TERMINAL → ABANDONED | operator/admin can abandon |

---

## 15. Practical Example: Bulk Case Escalation Evaluation

### 15.1 Scenario

Seorang compliance officer meminta sistem mengevaluasi ulang 10.000 case untuk menentukan apakah case perlu escalation.

Workload:

- membaca case;
- mengevaluasi rule;
- membuat recommendation;
- menulis audit;
- mungkin memicu notification;
- berjalan async karena terlalu berat untuk request thread.

---

### 15.2 Naive Design

```java
@PostMapping("/cases/escalation/recalculate")
public ResponseEntity<?> recalculate(@RequestBody Request request) {
    executor.submit(() -> escalationService.recalculate(request.caseIds()));
    return ResponseEntity.accepted().build();
}
```

Masalah:

- tidak jelas siapa requester;
- tidak ada authorization target scope;
- tidak durable;
- tidak ada job id;
- tidak ada audit;
- tidak ada cancellation;
- tidak ada retry semantics;
- worker mungkin proses case yang user tidak berhak;
- jika app restart, job hilang.

---

### 15.3 Better Design

```text
POST /case-escalation-recalculation-jobs
    ↓
Authenticate user
    ↓
Validate permission: case.escalation.recalculate.request
    ↓
Resolve target cases server-side
    ↓
Check target scope
    ↓
Create ActorSnapshot
    ↓
Create AuthorizationDecisionSnapshot
    ↓
Persist JobRequest
    ↓
Return 202 Accepted + jobId
    ↓
Managed executor triggers worker or scheduler picks durable job
```

Execution:

```text
Worker loads job
    ↓
Checks job state and authority mode
    ↓
Checks current system policy
    ↓
Processes cases in bounded chunks
    ↓
Writes result with idempotency key
    ↓
Writes audit per material side effect
    ↓
Marks job completed/failed
```

---

## 16. Code Sketch: ActorSnapshotFactory

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.security.enterprise.SecurityContext;

import java.time.OffsetDateTime;
import java.util.Set;

@ApplicationScoped
public class ActorSnapshotFactory {

    public ActorSnapshot captureFrom(SecurityContext securityContext, String captureReason) {
        if (securityContext.getCallerPrincipal() == null) {
            throw new UnauthenticatedException("No caller principal available");
        }

        String username = securityContext.getCallerPrincipal().getName();

        Set<String> relevantRoles = resolveRelevantRoles(securityContext);
        Set<String> permissions = resolvePermissions(username, relevantRoles);

        return new ActorSnapshot(
                resolveUserId(username),
                username,
                relevantRoles,
                permissions,
                resolveTenantId(username),
                resolveAgencyId(username),
                resolveModuleCode(),
                OffsetDateTime.now(),
                captureReason
        );
    }

    private Set<String> resolveRelevantRoles(SecurityContext securityContext) {
        // In real systems, roles may come from application authorization service,
        // not just securityContext.isCallerInRole checks.
        return Set.of();
    }

    private Set<String> resolvePermissions(String username, Set<String> roles) {
        return Set.of();
    }

    private String resolveUserId(String username) {
        return username;
    }

    private String resolveTenantId(String username) {
        return "default-tenant";
    }

    private String resolveAgencyId(String username) {
        return "default-agency";
    }

    private String resolveModuleCode() {
        return "CASE";
    }
}
```

---

## 17. Testing Security in Async Work

### 17.1 Unit Tests

Test pure authorization rules:

```text
Given actor without permission
When submit job
Then enqueue rejected

Given actor with permission but target outside scope
When submit job
Then enqueue rejected

Given actor valid at request but disabled at execution
When authorityMode = USER_DELEGATED
Then execution rejected

Given actor valid at request but disabled at execution
When authorityMode = SYSTEM_OBLIGATION
Then execution allowed if policy permits
```

---

### 17.2 Integration Tests

Test with container/runtime:

```text
security context visible in request
managed executor receives expected context
ContextService proxy preserves expected context
job audit contains requestedBy and executedBy
logout does not erase persisted actor snapshot
role change behavior follows explicit rule
```

---

### 17.3 Failure Tests

Simulate:

- app restart after job accepted;
- user disabled before execution;
- role revoked before execution;
- operator restarts failed job;
- duplicate submit;
- malicious target IDs;
- expired token;
- missing correlation id;
- worker executes job type it is not allowed to execute.

---

## 18. Checklist Desain Async Security

Sebelum membuat async job, jawab:

1. Siapa yang boleh request job ini?
2. Apa permission spesifiknya?
3. Apa target scope-nya?
4. Apakah target list resolved server-side?
5. Apakah job durable?
6. Apakah identity requester disimpan sebagai snapshot?
7. Apakah role/permission snapshot perlu disimpan?
8. Apakah execution memakai user identity atau system identity?
9. Apakah user logout membatalkan job?
10. Apakah role revocation membatalkan job?
11. Apakah job bisa di-cancel? Oleh siapa?
12. Apakah job bisa di-restart? Oleh siapa?
13. Apakah retry dianggap aksi user baru atau system retry?
14. Apakah side effect idempotent?
15. Apakah audit membedakan requestedBy/executedBy/operatedBy/approvedBy?
16. Apakah job parameters bisa dimanipulasi setelah authorized?
17. Apakah sensitive data masuk log/job parameter?
18. Apakah worker punya permission internal minimal?
19. Apakah system identity terlalu broad?
20. Apakah behavior portable antar container?

---

## 19. Anti-Patterns

### 19.1 Mengandalkan Active HTTP Session

```text
Worker reads user from HTTP session.
```

Salah karena worker tidak berada dalam request lifecycle.

---

### 19.2 Menyimpan Raw Access Token Tanpa Model Delegation

```text
Store user's access token and reuse it later.
```

Berbahaya kecuali memang ada delegated authorization design yang jelas.

---

### 19.3 Semua Job Dieksekusi sebagai `admin`

```text
executedBy = admin
```

Ini menghancurkan least privilege dan audit.

---

### 19.4 Audit Hanya Menulis `system`

```text
actor = system
```

Ini tidak cukup untuk menjawab siapa yang meminta dan kenapa sistem bertindak.

---

### 19.5 Authorization Hanya di UI

```text
Button hidden, therefore user cannot request job.
```

UI bukan boundary security.

---

### 19.6 Worker Percaya Semua Parameter

```text
Worker processes whatever case IDs are in payload.
```

Harus ada authorization dan integrity check.

---

### 19.7 Propagated Security Context Dianggap Sama Dengan Domain Validity

Security context di worker thread tidak otomatis berarti job sah secara bisnis.

---

## 20. Best Practices

1. Treat async boundary as a security boundary.
2. Persist job request before execution.
3. Capture actor snapshot explicitly.
4. Separate `requestedBy`, `executedBy`, `operatedBy`, and `approvedBy`.
5. Use purpose-bound authorization snapshot.
6. Validate target scope server-side.
7. Choose authority mode explicitly.
8. Re-check current policy when domain requires it.
9. Use least-privilege system identities.
10. Make retries and restarts auditable.
11. Avoid raw token persistence unless justified by a formal delegated authorization model.
12. Prefer durable job state over transient in-memory task for critical work.
13. Make worker execution idempotent.
14. Design cancellation and restart authorization explicitly.
15. Test role revocation, logout, and disabled-user scenarios.

---

## 21. Decision Matrix

| Workload | Suggested Authority Model | Authorization Timing | Execution Identity | Audit Focus |
|---|---|---|---|---|
| User report export | User-delegated | Enqueue + execution | User or constrained service | requestedBy, filters, data scope |
| Bulk letter generation after approval | System obligation | Enqueue + state check | Service identity | requestedBy, approvedBy, executedBy |
| External registry sync | Scheduled system | System policy | Service identity | schedule, source, executedBy |
| Reprocess failed item | Operator-controlled | Operator action + job policy | Service identity | operatedBy, reason, original job |
| Async file import | User-delegated/system obligation hybrid | Enqueue + per-record validation | Service identity | uploader, file manifest, row errors |
| SLA recalculation | System obligation | System state policy | Service identity | trigger event, executedBy |
| Sensitive data export | User-delegated | Enqueue + execution current permission | User-bound/delegated service | current permission, data classification |

---

## 22. Advanced Regulatory-System Perspective

Dalam sistem enforcement lifecycle/case management, async security bukan fitur teknis tambahan. Ia adalah bagian dari defensibility.

Pertanyaan auditor biasanya bukan:

> “Apakah executor-nya managed?”

Tetapi:

> “Siapa yang menyebabkan action ini terjadi, apakah ia berwenang saat itu, apakah sistem menjalankan sesuai approval, dan apakah hasilnya bisa dibuktikan?”

Karena itu, desain async harus mendukung chain of evidence:

```text
Policy
  ↓
Permission assignment
  ↓
User request
  ↓
Authorization decision
  ↓
Job acceptance
  ↓
Execution
  ↓
Side effect
  ↓
Audit event
  ↓
Review / appeal / investigation evidence
```

Jika chain ini putus, sistem mungkin tetap “berfungsi”, tetapi tidak defensible.

---

## 23. Relationship dengan Jakarta Batch

Part ini juga menjadi fondasi untuk Jakarta Batch nanti.

Dalam Jakarta Batch, pertanyaan security muncul di:

- siapa boleh start job;
- siapa boleh stop job;
- siapa boleh restart job;
- parameter job boleh berisi apa;
- apakah job instance mewakili user atau sistem;
- apakah job repository menyimpan enough attribution;
- apakah failed job boleh di-restart oleh operator berbeda;
- apakah skipped record perlu record-level audit;
- apakah partition worker memakai authority sama;
- apakah batch output boleh diakses requester.

Karena itu, jangan menunda security model sampai batch sudah dibuat. Security model harus menjadi bagian dari job contract sejak awal.

---

## 24. Minimal Reference Architecture

```text
[HTTP/API]
    ↓ authenticate
[Command Facade]
    ↓ capture actor snapshot
[Authorization Service]
    ↓ authorize enqueue + target scope
[Job Request Repository]
    ↓ persist durable command
[ManagedExecutorService / Scheduler / Batch Runtime]
    ↓ execute by jobId
[Worker]
    ↓ authorize execution policy
[Domain Service]
    ↓ side effects with idempotency
[Audit Service]
    ↓ requestedBy/executedBy/operatedBy/approvedBy
[Monitoring]
    ↓ metrics/tracing/logs
```

Key invariant:

```text
No important async side effect without durable job identity and audit attribution.
```

---

## 25. Summary

Async execution membuat security lebih sulit karena pekerjaan tidak lagi berjalan dalam lifecycle natural request user.

Mental model yang harus dibawa:

```text
Authentication answers: who is this caller?
Authorization answers: is this action allowed?
Async authority answers: under whose authority does delayed work execute?
Audit answers: how do we prove why this work happened?
```

Dalam Jakarta Concurrency, container dapat membantu propagation security context, tetapi itu tidak menggantikan desain domain-level:

- actor snapshot;
- authority mode;
- enqueue-time authorization;
- execution-time authorization;
- least privilege system identity;
- durable job request;
- idempotency;
- audit attribution.

Engineer yang kuat tidak hanya bertanya:

> “Bagaimana menjalankan task async?”

Tetapi:

> “Bagaimana memastikan task async ini sah, aman, dapat dikendalikan, dapat diulang, dan dapat dipertanggungjawabkan?”

---

## 26. Latihan / Thought Experiment

### Latihan 1

Sebuah endpoint menerima request untuk export semua case closed dalam 3 bulan terakhir. Export berjalan async dan hasilnya bisa di-download 10 menit kemudian.

Tentukan:

- authority mode;
- authorization timing;
- apa yang disimpan dalam actor snapshot;
- apakah role perlu dicek ulang saat download;
- audit event apa saja yang wajib ada.

---

### Latihan 2

User A request bulk update untuk 5.000 records. Setelah job accepted tetapi sebelum execution, User A resign dan account dinonaktifkan.

Tentukan behavior untuk dua domain:

1. bulk update adalah user-delegated action;
2. bulk update adalah system obligation setelah supervisor approval.

---

### Latihan 3

Operator me-restart failed job yang awalnya diminta oleh user lain.

Desain audit record yang bisa menjawab:

- siapa requester asli;
- siapa operator restart;
- kenapa restart dilakukan;
- attempt ke berapa;
- apakah parameter berubah;
- apakah side effect duplicate dicegah.

---

### Latihan 4

Sebuah worker berjalan sebagai `system-admin` dan bisa menjalankan semua job type.

Identifikasi minimal 5 risiko dan desain ulang identity model-nya.

---

## 27. Key Takeaways

- Async boundary adalah security boundary.
- Propagated security context tidak sama dengan domain authority.
- `Principal` bukan audit model yang cukup.
- Simpan actor snapshot eksplisit.
- Bedakan requestedBy, executedBy, approvedBy, dan operatedBy.
- Tentukan authority mode sejak desain awal.
- Authorization bisa terjadi saat enqueue, execution, atau keduanya.
- System identity harus least-privilege.
- Retry/restart/cancel adalah security-sensitive operation.
- Untuk sistem regulatory, audit defensibility adalah bagian dari correctness.

---

## 28. Posisi dalam Series

Kita sudah menyelesaikan:

- Part 0 — Orientation
- Part 1 — Historical Map
- Part 2 — Container Integrity
- Part 3 — ManagedExecutorService
- Part 4 — ManagedScheduledExecutorService
- Part 5 — ManagedThreadFactory
- Part 6 — ContextService and Context Propagation
- Part 7 — Transactions Across Asynchronous Boundaries
- Part 8 — Security, Identity, and Authorization in Async Execution

Berikutnya:

**Part 9 — CDI, Interceptors, Events, and Async Boundaries**

