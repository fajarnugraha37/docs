# Part 28 — Auditing, Accountability, Non-Repudiation, and Forensic Readiness

> Series: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-28-auditing-accountability-non-repudiation-forensics.md`  
> Scope: Java 8 sampai Java 25, Java EE / Jakarta EE, `javax.*` sampai `jakarta.*`, Servlet/JAX-RS/CDI/EJB/Jakarta Security/Jakarta Authentication/Jakarta Authorization, enterprise identity, regulatory/case-management systems.

---

## 0. Tujuan Bagian Ini

Bagian ini membahas **audit security** bukan sebagai “menambahkan log”, tetapi sebagai bagian dari **security architecture**.

Di sistem enterprise, terutama sistem regulatory, enforcement, case management, licensing, inspection, investigation, complaint handling, approval workflow, dan public-facing portal, pertanyaan setelah suatu aksi bukan hanya:

```text
Apakah request berhasil?
```

Tetapi:

```text
Siapa actor-nya?
Bertindak sebagai siapa?
Atas tenant/organization apa?
Akses resource apa?
Dengan permission apa?
Berdasarkan policy version apa?
Sebelum dan sesudah nilainya apa?
Apakah aksi itu normal, delegated, escalated, emergency, atau system-generated?
Bisa tidak kita rekonstruksi timeline-nya 6 bulan kemudian?
Bisa tidak bukti ini dipertahankan saat dipertanyakan oleh auditor, regulator, atau investigator?
```

Inilah perbedaan antara **application log** dan **audit trail**.

Part ini akan membangun mental model untuk:

1. membedakan log, audit, metric, trace, dan event;
2. mendesain audit event yang meaningful;
3. mengaitkan audit dengan authentication, authorization, identity mapping, session, token, tenant, dan workflow;
4. mencegah audit menjadi noise;
5. menjaga audit tetap aman dari data leakage;
6. membuat audit defensible untuk forensik dan regulatory review;
7. menghindari common failure seperti “ada log tapi tidak bisa menjawab siapa melakukan apa”.

---

## 1. Core Mental Model

Audit bukan fitur tambahan. Audit adalah **evidence layer**.

Security system memiliki tiga fungsi besar:

```text
Prevent  → mencegah akses/aksi tidak sah
Detect   → mendeteksi akses/aksi mencurigakan atau gagal
Explain  → menjelaskan apa yang terjadi setelah fakta terjadi
```

Authentication dan authorization terutama berada di area **prevent**.

Monitoring dan alerting berada di area **detect**.

Audit trail berada di area **explain**.

Sistem yang hanya punya prevention tanpa audit akan sulit dipertanggungjawabkan. Sistem yang hanya punya log teknis tanpa semantic audit akan sulit dianalisis. Sistem yang punya audit tetapi tidak mengikat identity, tenant, resource, permission, dan state akan tetap lemah.

---

## 2. Log vs Audit vs Trace vs Metric vs Event

### 2.1 Application Log

Application log biasanya ditujukan untuk developer/operator.

Contoh:

```text
INFO  CaseService - case 123 approved
ERROR OidcClient - token validation failed: issuer mismatch
WARN  SessionFilter - missing csrf token
```

Log menjawab:

```text
Apa yang terjadi secara teknis?
```

Log sering bersifat:

- bebas format;
- verbose;
- bisa berubah antar release;
- level-based (`INFO`, `WARN`, `ERROR`);
- dipakai untuk troubleshooting.

### 2.2 Audit Trail

Audit trail ditujukan untuk accountability.

Audit menjawab:

```text
Actor siapa melakukan action apa terhadap resource apa, kapan, dari mana, hasilnya apa, dan berdasarkan otoritas apa?
```

Audit harus lebih stabil dibanding log.

Contoh:

```json
{
  "eventType": "CASE_APPROVED",
  "eventTime": "2026-06-17T09:21:33.142Z",
  "actor": {
    "subjectId": "idp:corp:00u123",
    "displayName": "A. Rahman",
    "actorType": "HUMAN_USER"
  },
  "tenant": {
    "tenantId": "agency-cea",
    "activeOrganizationId": "CEA-DIV-ENF"
  },
  "resource": {
    "type": "CASE",
    "id": "CASE-2026-000123"
  },
  "action": "APPROVE",
  "decision": {
    "allowed": true,
    "policy": "case.approve.v7",
    "matchedRule": "assigned_supervisor_can_approve_pending_case"
  },
  "result": "SUCCESS",
  "correlationId": "req-7f4d...",
  "request": {
    "ip": "203.0.113.10",
    "userAgentHash": "sha256:..."
  }
}
```

Audit bukan hanya string. Audit adalah **structured fact**.

### 2.3 Distributed Trace

Trace menjawab:

```text
Request ini melewati service apa saja dan berapa lama?
```

Trace berguna untuk performance dan causality antar service. Trace ID sering perlu ikut di audit event sebagai correlation key.

### 2.4 Metric

Metric menjawab:

```text
Berapa banyak? Seberapa sering? Seberapa cepat?
```

Contoh:

```text
login.failure.count{reason="invalid_password"}=123
authorization.denied.count{resource="case"}=17
```

Metric tidak cukup untuk audit karena kehilangan detail individual event.

### 2.5 Domain Event

Domain event menjawab:

```text
Apa perubahan bisnis yang terjadi?
```

Contoh:

```text
CaseApproved
ApplicationSubmitted
OfficerAssigned
AppealEscalated
```

Domain event dan audit event bisa berhubungan, tetapi tidak selalu sama.

Domain event biasanya dipakai untuk business workflow/event-driven architecture. Audit event dipakai untuk accountability.

---

## 3. Kenapa Audit Security Sering Gagal

Banyak sistem punya banyak log tetapi gagal menjawab pertanyaan audit.

Penyebab umum:

1. **Log tidak structured.**
2. **Actor tidak jelas.** Yang dicatat hanya username display, bukan stable subject ID.
3. **Tenant tidak dicatat.** Sulit membuktikan cross-tenant isolation.
4. **Resource ID tidak konsisten.** Kadang internal DB ID, kadang public number.
5. **Action terlalu teknis.** Misalnya `POST /api/case/approve`, bukan `CASE_APPROVED`.
6. **Authorization decision tidak dicatat.** Hanya result akhir.
7. **Denied access tidak dicatat.** Padahal denial bisa menjadi indikator attack.
8. **Before/after value tidak lengkap.** Sulit merekonstruksi perubahan.
9. **Sensitive data bocor.** Log menyimpan password/token/NRIC/full document.
10. **Correlation ID tidak ada.** Sulit menghubungkan gateway, app, DB, message queue.
11. **System actor tidak dibedakan dari human actor.** Job malam terlihat seperti user biasa.
12. **Delegation tidak dicatat.** Tidak jelas user bertindak atas nama siapa.
13. **Audit async gagal diam-diam.** Business action sukses tetapi audit hilang.
14. **Audit bisa diubah/delete oleh aplikasi.** Bukti tidak defensible.
15. **Clock tidak sinkron.** Timeline forensik kacau.

---

## 4. Audit sebagai Security Contract

Audit event harus diperlakukan sebagai contract stabil.

Artinya:

```text
Audit event schema adalah bagian dari public internal contract sistem.
```

Ia perlu versioning, review, testing, backward compatibility, retention policy, dan ownership.

### 4.1 Audit Event Minimal

Setiap audit event high-value minimal punya:

| Field | Tujuan |
|---|---|
| `eventId` | Unique identifier audit event |
| `eventType` | Jenis kejadian bisnis/security |
| `eventTime` | Waktu event terjadi |
| `recordedAt` | Waktu audit dicatat |
| `actor` | Siapa pelaku efektif |
| `initiator` | Siapa pemicu awal, jika berbeda |
| `tenant` | Boundary organisasi/tenant |
| `resource` | Objek yang diakses/diubah |
| `action` | Aksi semantik |
| `decision` | Allow/deny dan policy context |
| `result` | Success/failure/partial |
| `reason` | Reason code aman |
| `correlationId` | Link ke request/trace/log |
| `source` | Channel/API/client/service |
| `integrity` | Hash/signature/chain metadata bila perlu |

### 4.2 Audit Event Bukan Debug Dump

Audit event tidak boleh menjadi dump object lengkap.

Buruk:

```json
{
  "eventType": "USER_LOGIN_FAILED",
  "requestBody": "{\"username\":\"fajar\",\"password\":\"Secret123!\"}"
}
```

Lebih baik:

```json
{
  "eventType": "AUTHENTICATION_FAILED",
  "subjectHint": "sha256:normalized-username",
  "reasonCode": "INVALID_CREDENTIAL",
  "credentialType": "PASSWORD",
  "sourceIp": "203.0.113.10",
  "correlationId": "req-..."
}
```

---

## 5. Actor Model untuk Audit

Audit yang baik tidak cukup mencatat `username`.

Sistem enterprise perlu membedakan:

```text
initiator     = siapa yang memulai request/perintah
actor         = siapa yang secara efektif menjalankan aksi
subject       = identity teknis/security principal
account       = local account binding
organization  = konteks organisasi aktif
system actor  = job/service yang menjalankan aksi otomatis
onBehalfOf    = delegasi/impersonation/representasi
```

### 5.1 Human User

Contoh:

```json
"actor": {
  "type": "HUMAN_USER",
  "subjectId": "issuer=https://idp.example.com|sub=248289761001",
  "localAccountId": "USR-10001",
  "displayName": "Fajar Abdi Nugraha"
}
```

`displayName` berguna untuk UI, tetapi bukan identifier utama.

Identifier utama harus stabil dan tidak mudah berubah.

Untuk OIDC, pasangan penting biasanya:

```text
issuer + subject
```

Bukan email saja, karena email bisa berubah dan tidak selalu immutable.

### 5.2 Service Account

Contoh:

```json
"actor": {
  "type": "SERVICE_ACCOUNT",
  "clientId": "case-sync-service",
  "subjectId": "client:case-sync-service"
}
```

Service account tidak boleh terlihat seperti human user.

### 5.3 System Job

Contoh:

```json
"actor": {
  "type": "SYSTEM_JOB",
  "jobName": "AUTO_ESCALATE_OVERDUE_CASES",
  "jobRunId": "JOBRUN-20260617-0100"
}
```

System job tetap perlu audit karena ia bisa mengubah state penting.

### 5.4 Delegated Actor

Contoh:

```json
"initiator": {
  "type": "HUMAN_USER",
  "subjectId": "idp|sub=officer-a"
},
"actor": {
  "type": "DELEGATED_USER",
  "subjectId": "idp|sub=officer-b"
},
"delegation": {
  "delegationId": "DEL-2026-0009",
  "basis": "TEMPORARY_COVERAGE",
  "validFrom": "2026-06-01T00:00:00Z",
  "validUntil": "2026-06-30T23:59:59Z"
}
```

Tanpa field ini, audit akan misleading.

### 5.5 Impersonation / Support Access

Support/admin impersonation harus sangat eksplisit.

```json
"actor": {
  "type": "SUPPORT_IMPERSONATION",
  "supportUserId": "SUP-88",
  "impersonatedUserId": "USR-10001"
},
"impersonation": {
  "ticketId": "SUPPORT-456",
  "approvedBy": "SECURITY-MGR-1",
  "reasonCode": "USER_REPORTED_ISSUE"
}
```

Jangan pernah menyembunyikan impersonation sebagai user asli.

---

## 6. Authentication Audit Events

Authentication adalah salah satu sumber audit paling penting.

### 6.1 Event yang Perlu Dicatat

Minimal:

1. authentication success;
2. authentication failure;
3. logout;
4. session expired;
5. session invalidated;
6. password changed;
7. password reset requested;
8. password reset completed;
9. MFA challenge issued;
10. MFA success/failure;
11. OIDC callback success/failure;
12. token validation failure;
13. account locked/unlocked;
14. credential rotation;
15. suspicious login pattern.

### 6.2 Authentication Success

```json
{
  "eventType": "AUTHENTICATION_SUCCEEDED",
  "actor": {
    "type": "HUMAN_USER",
    "subjectId": "issuer|sub=248289761001",
    "localAccountId": "USR-10001"
  },
  "auth": {
    "mechanism": "OIDC_AUTHORIZATION_CODE",
    "idp": "CORPORATE_IDP",
    "acr": "urn:mfa:phishing-resistant",
    "amr": ["pwd", "otp"],
    "sessionIdHash": "sha256:..."
  },
  "source": {
    "ip": "203.0.113.10",
    "userAgentHash": "sha256:..."
  },
  "result": "SUCCESS"
}
```

Catatan:

- Jangan simpan raw token.
- Jangan simpan full session ID.
- Gunakan hash untuk identifier sensitif yang perlu korelasi.

### 6.3 Authentication Failure

```json
{
  "eventType": "AUTHENTICATION_FAILED",
  "subjectHint": "sha256:normalized-login-id",
  "auth": {
    "mechanism": "PASSWORD",
    "failureReason": "INVALID_CREDENTIAL"
  },
  "source": {
    "ip": "203.0.113.10",
    "userAgentHash": "sha256:..."
  },
  "result": "FAILURE"
}
```

Untuk response ke user, biasanya tetap generic:

```text
Invalid username or password.
```

Tetapi audit internal boleh memiliki reason code lebih jelas, selama tidak bocor ke client.

### 6.4 OIDC Callback Failure

```json
{
  "eventType": "OIDC_CALLBACK_FAILED",
  "auth": {
    "issuer": "https://idp.example.com",
    "clientId": "case-web",
    "failureReason": "NONCE_MISMATCH"
  },
  "correlationId": "req-...",
  "result": "FAILURE"
}
```

Jangan log full authorization code, ID token, access token, atau refresh token.

---

## 7. Authorization Audit Events

Authorization audit sering lebih penting daripada authentication audit.

Authentication hanya menjawab:

```text
User ini berhasil membuktikan identity.
```

Authorization menjawab:

```text
Mengapa user ini boleh/tidak boleh melakukan aksi tertentu terhadap resource tertentu?
```

### 7.1 Audit Denial

Denied access perlu dicatat, terutama untuk high-value resource.

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "actor": {
    "subjectId": "issuer|sub=248289761001",
    "localAccountId": "USR-10001"
  },
  "tenant": {
    "tenantId": "agency-cea"
  },
  "resource": {
    "type": "CASE",
    "id": "CASE-2026-000123"
  },
  "action": "APPROVE",
  "decision": {
    "allowed": false,
    "policy": "case.approve.v7",
    "denyReasonCode": "NOT_ASSIGNED_SUPERVISOR"
  },
  "result": "DENIED"
}
```

Ini berguna untuk:

- menemukan privilege probing;
- debugging access complaint;
- membuktikan enforcement berjalan;
- forensic reconstruction.

### 7.2 Audit Allow untuk High-Value Action

Tidak semua allow harus diaudit secara detail. Tetapi high-value action harus.

High-value action:

- approve/reject case;
- issue license;
- suspend account;
- change role;
- export data;
- view confidential document;
- change assignment;
- override policy;
- delete record;
- change payment/refund;
- unlock account;
- impersonate user.

### 7.3 Authorization Decision Snapshot

Audit perlu mencatat basis keputusan.

```json
"decision": {
  "allowed": true,
  "policy": "case.approve.v7",
  "policyVersion": 7,
  "matchedRule": "ASSIGNED_SUPERVISOR_CAN_APPROVE_PENDING_CASE",
  "actorRoles": ["CASE_SUPERVISOR"],
  "actorPermissions": ["case.approve"],
  "resourceState": "PENDING_SUPERVISOR_APPROVAL",
  "assignmentId": "ASSIGN-456"
}
```

Mengapa penting?

Karena 6 bulan kemudian:

- role user mungkin berubah;
- case state mungkin berubah;
- assignment mungkin pindah;
- policy version mungkin berubah.

Jika audit hanya menyimpan `approved by user X`, tidak bisa dijelaskan mengapa waktu itu allowed.

---

## 8. Data Access Audit

Tidak semua read perlu detail audit. Tetapi beberapa read harus:

1. membaca PII/sensitive data;
2. membuka confidential document;
3. export data;
4. search mass data;
5. view case not assigned to actor;
6. admin lookup user account;
7. read audit trail itself;
8. download evidence/attachment;
9. access cross-tenant data;
10. access sealed/archived record.

### 8.1 View vs Export

View dan export berbeda.

```text
VIEW_CASE_DETAILS       → user melihat satu case
EXPORT_CASE_LIST        → user mengekspor banyak row
DOWNLOAD_DOCUMENT       → user mengambil file
SEARCH_PERSON_BY_ID     → user melakukan lookup sensitive identity
```

Export biasanya lebih high-risk karena data keluar dari kontrol aplikasi.

### 8.2 Query Audit

Untuk search/listing, audit perlu hati-hati.

Buruk:

```json
{
  "eventType": "SEARCH_PERSON",
  "query": "NRIC=S1234567A AND name=Tan Ah Kow"
}
```

Lebih aman:

```json
{
  "eventType": "SENSITIVE_SEARCH_EXECUTED",
  "searchType": "PERSON_LOOKUP",
  "criteriaSummary": {
    "hasNationalId": true,
    "hasName": true,
    "criteriaHash": "sha256:..."
  },
  "resultCount": 1
}
```

Jangan menyimpan sensitive search term mentah jika tidak perlu.

---

## 9. Change Audit: Before/After Values

Untuk perubahan penting, audit perlu menyimpan perubahan secara structured.

Contoh:

```json
"changes": [
  {
    "field": "case.status",
    "before": "PENDING_SUPERVISOR_APPROVAL",
    "after": "APPROVED"
  },
  {
    "field": "case.approvedBy",
    "before": null,
    "after": "USR-10001"
  }
]
```

### 9.1 Jangan Simpan Semua Field Mentah

Beberapa field harus:

- masked;
- hashed;
- omitted;
- encrypted;
- tokenized;
- referenced only.

Contoh:

```json
{
  "field": "person.nationalId",
  "beforeHash": "sha256:...",
  "afterHash": "sha256:...",
  "classification": "SENSITIVE_IDENTIFIER"
}
```

### 9.2 Audit Patch vs Audit Business Change

Technical patch:

```json
{
  "op": "replace",
  "path": "/status",
  "value": "APPROVED"
}
```

Business audit:

```json
{
  "eventType": "CASE_APPROVED",
  "action": "APPROVE",
  "fromState": "PENDING_SUPERVISOR_APPROVAL",
  "toState": "APPROVED"
}
```

Business audit lebih mudah dipahami auditor.

Technical patch berguna untuk reconstruction.

Dalam sistem serius, keduanya bisa ada:

```text
business audit event + normalized change list
```

---

## 10. Non-Repudiation: Apa yang Bisa dan Tidak Bisa Dijamin

Istilah non-repudiation sering dipakai terlalu longgar.

Secara praktis, aplikasi web biasa jarang bisa membuktikan secara absolut bahwa manusia tertentu melakukan aksi, karena:

- akun bisa compromised;
- device bisa dipinjam;
- session bisa dicuri;
- admin bisa impersonate;
- malware bisa mengirim request.

Yang bisa dibangun adalah **strong accountability evidence**.

Evidence menjadi lebih kuat jika mencatat:

1. strong authentication level;
2. MFA/step-up detail;
3. device/session metadata;
4. source network;
5. explicit confirmation action;
6. digital signature bila applicable;
7. immutable audit storage;
8. approval workflow;
9. correlation dengan IdP logs;
10. tamper-evident chain.

### 10.1 Strong Evidence vs Absolute Proof

Lebih realistis:

```text
Sistem memiliki bukti kuat bahwa aksi dilakukan melalui session authenticated milik subject X, pada waktu Y, dari konteks Z, setelah melewati policy P.
```

Daripada:

```text
Sistem membuktikan secara absolut bahwa orang X secara sadar melakukan aksi itu.
```

### 10.2 Step-Up untuk Non-Repudiation Lebih Kuat

Untuk aksi high-risk:

- re-authentication;
- MFA challenge;
- digital signing;
- explicit confirmation;
- reason mandatory;
- supervisor approval.

Audit event perlu mencatat step-up:

```json
"assurance": {
  "stepUpRequired": true,
  "stepUpCompleted": true,
  "method": "FIDO2",
  "completedAt": "2026-06-17T09:20:55Z"
}
```

---

## 11. Audit Trail Architecture

Ada beberapa pattern.

### 11.1 Synchronous Inline Audit

Business transaction menulis audit dalam transaksi yang sama.

```text
begin transaction
  update case status
  insert audit event
commit
```

Kelebihan:

- atomic;
- audit tidak hilang jika business action sukses;
- mudah reasoning.

Kekurangan:

- audit table bisa menjadi bottleneck;
- schema coupling;
- sulit push ke SIEM secara langsung.

Cocok untuk:

- case state change;
- role change;
- high-value mutation;
- regulatory audit.

### 11.2 Outbox Pattern

Business transaction menulis business state + audit/outbox event dalam DB yang sama.

```text
begin transaction
  update case
  insert audit_outbox
commit

background publisher:
  publish audit_outbox to log pipeline/SIEM
  mark published
```

Kelebihan:

- atomic capture;
- async delivery;
- reliable retry;
- decoupled from SIEM availability.

Kekurangan:

- perlu outbox processor;
- duplicate delivery possible;
- perlu idempotency.

### 11.3 Fully Async Fire-and-Forget

Business logic mengirim audit event ke queue tanpa transactional guarantee.

```text
update case
send audit event async
```

Bahaya:

- audit bisa hilang;
- ordering bisa kacau;
- business success tanpa audit;
- network failure sulit ditangani.

Boleh untuk low-value telemetry, bukan critical audit.

### 11.4 Database Trigger Audit

Database trigger mencatat row-level change.

Kelebihan:

- menangkap semua DB changes termasuk bypass aplikasi;
- berguna untuk data integrity.

Kekurangan:

- sulit tahu business actor jika tidak dipropagasi;
- sulit tahu action semantic;
- bisa noisy;
- tidak menangkap denied access.

Pattern yang baik:

```text
application semantic audit + DB technical audit for critical tables
```

### 11.5 Central Audit Service

Service terpusat menerima audit event dari banyak aplikasi.

Kelebihan:

- schema governance;
- retention konsisten;
- SIEM integration;
- search centralized.

Kekurangan:

- availability dependency;
- multi-tenant isolation harus kuat;
- schema versioning lebih kompleks.

Untuk critical event, jangan biarkan central audit service outage membuat audit hilang. Gunakan local outbox.

---

## 12. Transaction Boundary dan Audit Integrity

Pertanyaan penting:

```text
Jika business transaction rollback, apakah audit tetap dicatat?
```

Jawabannya tergantung event type.

### 12.1 Attempt Audit

Untuk security attempt, meski business rollback, audit mungkin tetap perlu ada.

Contoh:

- failed login;
- authorization denied;
- CSRF failure;
- invalid token;
- rejected approval attempt.

Ini sebaiknya dicatat walaupun tidak ada business state change.

### 12.2 Success Audit

Untuk successful business change, audit harus konsisten dengan commit.

Jika case approval rollback, jangan ada audit `CASE_APPROVED SUCCESS` yang final.

Pattern:

```text
Audit attempt outside business transaction
Audit success after/inside committed transaction
```

Atau:

```text
Audit event status = ATTEMPTED / SUCCEEDED / FAILED
```

### 12.3 Audit dalam `finally` Block Tidak Cukup

Buruk:

```java
try {
    approveCase(command);
    audit("CASE_APPROVED");
} catch (Exception e) {
    audit("CASE_APPROVAL_FAILED");
    throw e;
}
```

Masalah:

- audit bisa sukses meskipun transaction kemudian rollback;
- audit bisa gagal dan menutupi original exception;
- audit tidak punya detail authorization decision;
- audit tersebar di banyak tempat.

Lebih baik:

```java
AuthorizationDecision decision = authz.check(actor, APPROVE, caseRef);
auditAttempt(command, decision);

if (!decision.allowed()) {
    throw forbidden(decision.safeReason());
}

CaseApprovalResult result = transaction.execute(() -> {
    CaseAggregate c = caseRepository.lock(command.caseId());
    c.approve(actor, command.reason());
    caseRepository.save(c);
    auditRepository.append(AuditEvent.caseApproved(actor, c, decision));
    return CaseApprovalResult.from(c);
});
```

---

## 13. Correlation ID, Trace ID, Request ID

Audit event harus bisa dikaitkan dengan logs, traces, gateway logs, IdP logs, DB logs, dan queue messages.

Minimal gunakan:

```text
correlationId  = business/request correlation across components
traceId        = distributed tracing id
requestId      = HTTP request id, often gateway-generated
eventId        = unique audit event id
causationId    = event/request that caused this event
```

### 13.1 Propagation

HTTP inbound:

```text
X-Correlation-ID: req-abc
traceparent: 00-...
```

Internal event:

```json
{
  "eventId": "evt-2",
  "correlationId": "req-abc",
  "causationId": "evt-1"
}
```

### 13.2 Jangan Percaya Blindly dari Client

Jika client boleh mengirim `X-Correlation-ID`, validasi format dan panjang.

Jangan biarkan attacker memasukkan payload log injection.

```java
String correlationId = sanitizeOrGenerate(request.getHeader("X-Correlation-ID"));
```

---

## 14. Audit Event Schema Design

### 14.1 Canonical Event Envelope

Contoh Java record:

```java
public record AuditEvent(
        String eventId,
        String eventType,
        int schemaVersion,
        Instant eventTime,
        Instant recordedAt,
        ActorRef actor,
        ActorRef initiator,
        TenantRef tenant,
        ResourceRef resource,
        String action,
        AuthorizationSnapshot authorization,
        EventResult result,
        String reasonCode,
        SourceContext source,
        CorrelationContext correlation,
        List<FieldChange> changes,
        Map<String, String> attributes
) {}
```

### 14.2 ActorRef

```java
public record ActorRef(
        ActorType type,
        String subjectId,
        String issuer,
        String localAccountId,
        String displayName,
        String clientId,
        String jobName
) {}
```

### 14.3 ResourceRef

```java
public record ResourceRef(
        String type,
        String id,
        String publicRef,
        String classification,
        String ownerTenantId
) {}
```

### 14.4 AuthorizationSnapshot

```java
public record AuthorizationSnapshot(
        boolean allowed,
        String policyName,
        int policyVersion,
        String matchedRule,
        String denyReasonCode,
        List<String> roles,
        List<String> permissions,
        String resourceState,
        String assignmentId
) {}
```

### 14.5 FieldChange

```java
public record FieldChange(
        String field,
        String beforeValue,
        String afterValue,
        String beforeHash,
        String afterHash,
        String classification
) {}
```

---

## 15. Event Type Taxonomy

Audit event type harus semantik, stabil, dan mudah dicari.

### 15.1 Authentication

```text
AUTHENTICATION_SUCCEEDED
AUTHENTICATION_FAILED
AUTHENTICATION_STEP_UP_REQUIRED
AUTHENTICATION_STEP_UP_SUCCEEDED
AUTHENTICATION_STEP_UP_FAILED
LOGOUT_SUCCEEDED
SESSION_EXPIRED
SESSION_REVOKED
PASSWORD_CHANGED
PASSWORD_RESET_REQUESTED
PASSWORD_RESET_COMPLETED
ACCOUNT_LOCKED
ACCOUNT_UNLOCKED
```

### 15.2 Authorization

```text
AUTHORIZATION_ALLOWED
AUTHORIZATION_DENIED
ROLE_ASSIGNED
ROLE_REMOVED
PERMISSION_POLICY_CHANGED
DELEGATION_CREATED
DELEGATION_REVOKED
BREAK_GLASS_USED
IMPERSONATION_STARTED
IMPERSONATION_ENDED
```

### 15.3 Case/Workflow

```text
CASE_CREATED
CASE_ASSIGNED
CASE_REASSIGNED
CASE_APPROVED
CASE_REJECTED
CASE_ESCALATED
CASE_REOPENED
CASE_CLOSED
CASE_STATUS_CHANGED
CASE_DOCUMENT_VIEWED
CASE_DOCUMENT_DOWNLOADED
```

### 15.4 Data Access

```text
SENSITIVE_RECORD_VIEWED
SENSITIVE_SEARCH_EXECUTED
DATA_EXPORTED
REPORT_GENERATED
AUDIT_TRAIL_VIEWED
```

### 15.5 Administration

```text
USER_CREATED
USER_DISABLED
USER_ENABLED
USER_ROLE_CHANGED
TENANT_CREATED
TENANT_CONFIG_CHANGED
IDP_CONFIG_CHANGED
CLIENT_SECRET_ROTATED
SECURITY_POLICY_UPDATED
```

---

## 16. Safe Reason Codes

Reason code perlu aman untuk audit dan UI.

Internal reason:

```text
NOT_ASSIGNED_SUPERVISOR
TENANT_MISMATCH
CASE_NOT_IN_APPROVABLE_STATE
MISSING_PERMISSION
SESSION_EXPIRED
TOKEN_AUDIENCE_MISMATCH
CSRF_TOKEN_MISSING
```

Client-facing message:

```text
You are not allowed to perform this action.
```

Audit-facing reason:

```text
DENIED because actor is not the assigned supervisor for the case in current state.
```

Jangan expose detail sensitif ke user, tetapi jangan terlalu generic di audit internal.

---

## 17. Sensitive Data Handling in Audit

Audit sering menjadi tempat kebocoran data terbesar karena developer menganggap log/audit “internal”.

### 17.1 Jangan Pernah Audit Mentah

Jangan simpan:

- password;
- OTP;
- recovery code;
- access token;
- refresh token;
- ID token;
- session ID;
- authorization code;
- client secret;
- private key;
- full cookie header;
- full request/response body;
- raw document content;
- full national ID jika tidak wajib.

### 17.2 Redaction

Contoh redaction:

```java
public final class AuditRedactor {
    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) return "<invalid>";
        String[] parts = email.split("@", 2);
        return parts[0].charAt(0) + "***@" + parts[1];
    }

    public static String tokenFingerprint(String token) {
        return "sha256:" + sha256(token);
    }
}
```

### 17.3 Hashing for Correlation

Hash berguna jika perlu menghubungkan event tanpa menyimpan value mentah.

```text
sessionIdHash
userAgentHash
criteriaHash
tokenFingerprint
nationalIdHash
```

Gunakan keyed hash/HMAC jika attacker bisa brute-force value kecil.

Contoh: national ID, postal code, phone number, atau email mudah ditebak. Hash biasa bisa di-rainbow table. HMAC dengan secret server-side lebih aman untuk korelasi.

---

## 18. Tamper Resistance dan Immutability

Audit yang bisa diubah oleh aplikasi biasa tidak terlalu defensible.

### 18.1 Level Perlindungan

| Level | Mekanisme | Kekuatan |
|---|---|---|
| Basic | Insert-only table, no update/delete in app role | Baik untuk internal app |
| Stronger | Append-only storage + restricted DB privilege | Lebih defensible |
| Stronger | WORM/object lock storage | Baik untuk regulatory retention |
| Stronger | Hash chain per event | Tamper-evident |
| Strongest | External secure logging/SIEM + signing | Lebih sulit dimanipulasi oleh compromised app |

### 18.2 Insert-Only Audit Table

Aplikasi sebaiknya hanya punya privilege:

```sql
INSERT ON audit_event
SELECT ON audit_event -- jika perlu read audit
```

Bukan:

```sql
UPDATE audit_event
DELETE FROM audit_event
```

### 18.3 Hash Chain

Konsep:

```text
eventHash[n] = hash(canonicalEvent[n] + eventHash[n-1])
```

Jika event lama diubah, chain berikutnya rusak.

Contoh schema:

```sql
CREATE TABLE audit_event (
    event_id           VARCHAR2(64) PRIMARY KEY,
    event_time         TIMESTAMP WITH TIME ZONE NOT NULL,
    event_type         VARCHAR2(128) NOT NULL,
    tenant_id          VARCHAR2(128),
    actor_subject_id   VARCHAR2(512),
    resource_type      VARCHAR2(128),
    resource_id        VARCHAR2(256),
    action             VARCHAR2(128),
    result             VARCHAR2(32),
    payload_json       CLOB NOT NULL,
    previous_hash      VARCHAR2(128),
    event_hash         VARCHAR2(128) NOT NULL,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);
```

Catatan:

- Hash chain bukan magic. Jika attacker bisa rewrite seluruh table dan secret/signing key, masih bisa dimanipulasi.
- Untuk lebih kuat, anchor hash periodik ke storage eksternal.

---

## 19. Audit Query and Access Control

Audit trail sendiri adalah data sensitif.

Siapa pun yang bisa membaca audit bisa melihat:

- siapa mengakses apa;
- pola investigasi;
- resource sensitif;
- failure reason;
- internal policy name;
- tenant activity.

Maka audit viewer perlu authorization kuat.

### 19.1 Audit Viewer Role

Jangan berikan audit read ke semua admin.

Pisahkan:

```text
SYSTEM_ADMIN       = manage system config
SECURITY_AUDITOR   = read security audit
CASE_AUDITOR       = read case audit for tenant
PRIVACY_OFFICER    = read sensitive access audit
```

### 19.2 Audit Access Must Be Audited

Ketika seseorang melihat audit:

```json
{
  "eventType": "AUDIT_TRAIL_VIEWED",
  "actor": { "subjectId": "..." },
  "resource": {
    "type": "AUDIT_QUERY",
    "id": "AQ-20260617-00001"
  },
  "queryScope": {
    "tenantId": "agency-cea",
    "dateFrom": "2026-06-01",
    "dateTo": "2026-06-17",
    "eventTypes": ["CASE_APPROVED"]
  },
  "resultCount": 42
}
```

---

## 20. Forensic Readiness

Forensic readiness berarti sistem sudah siap menjawab pertanyaan investigasi **sebelum incident terjadi**.

### 20.1 Pertanyaan Forensik Umum

1. Siapa login pada waktu tertentu?
2. Dari IP/device mana?
3. Apa saja resource yang dia akses?
4. Apa saja data yang dia export/download?
5. Permission apa yang dia punya saat itu?
6. Role siapa yang mengubah?
7. Apakah dia bertindak sebagai dirinya atau delegate/impersonation?
8. Apakah ada failed access sebelum success?
9. Apakah ada token/session reuse?
10. Apakah event berasal dari UI, API, gateway, job, atau integration?
11. Apakah ada cross-tenant access?
12. Apakah policy berubah sebelum/selama incident?
13. Apakah audit trail lengkap dan belum dimanipulasi?

### 20.2 Timeline Reconstruction

Agar timeline bisa direkonstruksi, audit perlu:

- timestamp UTC;
- clock sync;
- correlation ID;
- stable actor ID;
- resource ID;
- event ordering;
- result status;
- source/channel;
- causation ID;
- policy snapshot.

### 20.3 Clock Discipline

Gunakan UTC untuk audit.

Simpan timezone display hanya untuk UI.

```java
Instant eventTime = clock.instant();
```

Jangan simpan audit dengan `LocalDateTime` tanpa timezone untuk event lintas service/region.

---

## 21. Jakarta Security Integration

Jakarta Security memberikan access point seperti `SecurityContext` untuk membaca caller dan role. Audit layer dapat menggunakan ini, tetapi jangan mencampur domain actor langsung dengan `Principal` mentah.

### 21.1 Actor Resolver

Pattern:

```java
@ApplicationScoped
public class ActorResolver {
    @Inject
    SecurityContext securityContext;

    public ActorRef currentActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            return ActorRef.anonymous();
        }

        return ActorRef.human(
                normalizeSubject(principal),
                resolveLocalAccountId(principal),
                principal.getName()
        );
    }
}
```

Tetapi untuk OIDC/token, `principal.getName()` mungkin bukan enough. Anda perlu claim/subject canonical yang stabil.

### 21.2 Authorization Snapshot

Jangan hanya audit `isCallerInRole("ADMIN")`.

Buat authorization service mengembalikan decision object.

```java
public record AuthorizationDecision(
        boolean allowed,
        String policyName,
        int policyVersion,
        String matchedRule,
        String denyReasonCode,
        Set<String> roles,
        Set<String> permissions
) {}
```

Lalu audit decision itu.

### 21.3 JAX-RS Filter for Request Context

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class RequestContextFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        String correlationId = sanitizeOrGenerate(
                requestContext.getHeaderString("X-Correlation-ID")
        );
        RequestContextHolder.setCorrelationId(correlationId);
    }
}
```

Pastikan context dibersihkan setelah request untuk mencegah leakage.

---

## 22. Audit in Servlet/JAX-RS/CDI/EJB Layers

### 22.1 Servlet Filter

Cocok untuk:

- request start/end;
- correlation ID;
- authentication failure edge;
- suspicious request;
- gateway headers;
- CSRF/CORS/security header failures.

Tidak cocok sebagai satu-satunya tempat audit business action karena Servlet filter tidak tahu semantik domain.

### 22.2 JAX-RS Filter

Cocok untuk:

- API endpoint access;
- token validation outcome;
- method/path/resource matching;
- 401/403 mapping.

Tetap tidak cukup untuk domain action detail.

### 22.3 CDI/EJB Interceptor

Cocok untuk method-level annotation.

Contoh:

```java
@AuditedAction("CASE_APPROVE")
@CanApproveCase
public void approveCase(ApproveCaseCommand command) { ... }
```

Interceptor bisa mencatat attempt/success/failure, tetapi perlu hati-hati dengan transaction ordering.

### 22.4 Domain Service

Tempat terbaik untuk semantic audit adalah domain/application service karena ia tahu:

- action bisnis;
- aggregate/resource;
- state before/after;
- authorization decision;
- command reason;
- transaction result.

---

## 23. Audit dan Event-Driven Architecture

Dalam sistem asynchronous, audit perlu menangkap causality.

### 23.1 Command → Event → Handler

```text
User submits command
  → Audit COMMAND_ACCEPTED
  → Domain event emitted
  → Worker processes event
  → Audit SYSTEM_ACTION_COMPLETED
```

Jangan hanya audit worker result. Simpan hubungan dengan original actor.

### 23.2 Actor Propagation in Message

Message metadata:

```json
{
  "messageId": "msg-1",
  "correlationId": "req-abc",
  "causationId": "evt-previous",
  "initiator": {
    "subjectId": "issuer|sub=user-1",
    "tenantId": "agency-cea"
  },
  "executor": {
    "type": "SYSTEM_SERVICE",
    "service": "case-worker"
  }
}
```

Audit worker event:

```json
"initiator": { "subjectId": "issuer|sub=user-1" },
"actor": { "type": "SYSTEM_SERVICE", "clientId": "case-worker" }
```

Ini membedakan:

```text
who caused it vs who executed it
```

---

## 24. Audit Retention, Archival, and Purging

Audit perlu retention policy.

Pertanyaan:

1. Berapa lama audit disimpan online?
2. Berapa lama disimpan archive?
3. Siapa boleh purge?
4. Bagaimana legal hold?
5. Bagaimana menghapus/meminimalkan data personal sesuai regulasi?
6. Bagaimana menjaga audit tetap searchable?
7. Bagaimana menjaga integrity setelah archival?

### 24.1 Online vs Archive

```text
Online audit store   → searchable cepat, 3–12 bulan
Archive/WORM store   → murah, immutable, beberapa tahun
SIEM                 → detection/alerting, retention sesuai security ops
```

### 24.2 Legal Hold

Audit tertentu mungkin tidak boleh dipurge jika terkait investigation/legal hold.

Field:

```json
"retention": {
  "retentionClass": "REGULATORY_7_YEARS",
  "legalHold": false
}
```

---

## 25. Audit Performance

Audit bisa menjadi bottleneck jika tidak didesain.

### 25.1 Common Bottleneck

- CLOB/JSON besar tanpa partition;
- index terlalu banyak;
- insert hot block;
- synchronous call ke SIEM;
- audit dalam transaction panjang;
- query audit tanpa date/tenant filter;
- full-text search di table OLTP;
- compression salah tempat.

### 25.2 Table Design

Pisahkan:

```text
audit_event_core      → searchable fields
audit_event_payload   → JSON/CLOB detail
audit_event_hash      → integrity chain
audit_outbox          → delivery pipeline
```

Contoh searchable columns:

```sql
CREATE TABLE audit_event_core (
    event_id          VARCHAR2(64) PRIMARY KEY,
    event_time        TIMESTAMP WITH TIME ZONE NOT NULL,
    event_type        VARCHAR2(128) NOT NULL,
    actor_subject_id  VARCHAR2(512),
    tenant_id         VARCHAR2(128),
    resource_type     VARCHAR2(128),
    resource_id       VARCHAR2(256),
    action            VARCHAR2(128),
    result            VARCHAR2(32),
    correlation_id    VARCHAR2(128),
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);
```

Index umum:

```sql
CREATE INDEX idx_audit_time_type ON audit_event_core(event_time, event_type);
CREATE INDEX idx_audit_actor_time ON audit_event_core(actor_subject_id, event_time);
CREATE INDEX idx_audit_resource_time ON audit_event_core(resource_type, resource_id, event_time);
CREATE INDEX idx_audit_tenant_time ON audit_event_core(tenant_id, event_time);
CREATE INDEX idx_audit_corr ON audit_event_core(correlation_id);
```

Untuk volume besar, gunakan partition by time.

---

## 26. Observability vs Audit

Audit bukan pengganti observability.

Gunakan keduanya:

```text
log      → technical troubleshooting
metric   → volume/rate/SLO/alert
trace    → distributed causality/performance
audit    → accountability/evidence
```

Contoh satu denial event:

Audit:

```json
{
  "eventType": "AUTHORIZATION_DENIED",
  "actor": "USR-1",
  "action": "APPROVE",
  "resource": "CASE-1",
  "reasonCode": "NOT_ASSIGNED_SUPERVISOR"
}
```

Metric:

```text
authorization_denied_total{action="APPROVE",reason="NOT_ASSIGNED_SUPERVISOR"} 1
```

Log:

```text
WARN authz denied actor=USR-1 action=APPROVE resource=CASE-1 corr=req-abc
```

Trace:

```text
span: POST /cases/{id}/approve
attribute: authz.decision=denied
```

---

## 27. Alerting from Audit Events

Audit event bisa menjadi sumber alert.

Contoh rule:

1. banyak failed login dari IP sama;
2. banyak failed login untuk account sama;
3. banyak authorization denied untuk user sama;
4. export data besar di luar jam kerja;
5. admin role assigned lalu data export;
6. break-glass used;
7. impersonation started;
8. user role changed by unusual admin;
9. token validation failures spike;
10. cross-tenant denied attempts.

### 27.1 Jangan Alert Semua

Jika semua audit menjadi alert, alert fatigue.

Pisahkan:

```text
audit event      = evidence
security signal  = candidate suspicious pattern
alert            = actionable event requiring response
incident         = confirmed/triaged security issue
```

---

## 28. Testing Audit

Audit harus diuji seperti fitur inti.

### 28.1 Unit Test

Test audit event builder.

```java
@Test
void caseApprovalAuditContainsActorTenantResourceAndPolicy() {
    AuditEvent event = AuditEventFactory.caseApproved(actor, tenant, caseRef, decision);

    assertThat(event.eventType()).isEqualTo("CASE_APPROVED");
    assertThat(event.actor().subjectId()).isEqualTo("issuer|sub=123");
    assertThat(event.tenant().tenantId()).isEqualTo("agency-cea");
    assertThat(event.authorization().policyName()).isEqualTo("case.approve");
}
```

### 28.2 Integration Test

Test business action writes audit in same transaction.

```text
Given user can approve case
When approve endpoint is called
Then case status becomes APPROVED
And audit event CASE_APPROVED exists
And audit event contains authorization snapshot
```

### 28.3 Negative Test

```text
Given user is not assigned supervisor
When approve endpoint is called
Then response is 403
And audit event AUTHORIZATION_DENIED exists
And no CASE_APPROVED event exists
```

### 28.4 Redaction Test

```text
When login fails
Then audit event does not contain password
And does not contain raw token
And does not contain full cookie
```

### 28.5 Tamper Test

```text
When existing audit row is modified manually
Then hash verification detects mismatch
```

---

## 29. Common Anti-Patterns

### 29.1 “We Log Everything”

Logging everything usually means:

- too noisy;
- not searchable;
- sensitive data leak;
- no semantic event;
- expensive storage;
- still cannot answer audit question.

### 29.2 Only Audit Success

Denied/failed attempts are security signals.

If only success is audited, probing disappears.

### 29.3 Only Store Username

Username/email can change.

Store stable subject ID.

### 29.4 No Tenant in Audit

For multi-tenant systems, audit without tenant is incomplete.

### 29.5 No Policy Version

Authorization audit without policy version cannot explain historical decision.

### 29.6 Audit in UI Only

UI audit can be bypassed by direct API calls.

Audit must happen server-side.

### 29.7 Audit After Async Without Guarantee

If audit event is fire-and-forget, audit can disappear.

Use transaction/outbox for critical events.

### 29.8 Store Raw Tokens

Raw tokens in logs/audit can become credentials.

Store fingerprint only.

### 29.9 Audit Table Mutable by App Admin

If same admin can perform action and delete audit, evidence weak.

### 29.10 Audit Without Access Control

Audit viewer can become privacy breach.

---

## 30. Java 8–25 Considerations

### 30.1 Java 8

- Use immutable POJOs/builders if records unavailable.
- Time API `java.time` is available and should be used.
- Avoid `Date`/`Calendar` for audit event time.

### 30.2 Java 11/17

- Good baseline for modern enterprise.
- Better TLS/provider support than old Java 8 deployments.
- Records not available until Java 16, so Java 11 still uses classes/builders.

### 30.3 Java 17+

- Records useful for audit event DTOs.
- Sealed classes useful for actor type hierarchy.

Example:

```java
public sealed interface AuditActor permits HumanActor, ServiceActor, SystemJobActor {}

public record HumanActor(String subjectId, String accountId) implements AuditActor {}
public record ServiceActor(String clientId) implements AuditActor {}
public record SystemJobActor(String jobName, String jobRunId) implements AuditActor {}
```

### 30.4 Java 21+

Virtual threads make request concurrency cheaper, but do not remove need for explicit context propagation.

Avoid assuming thread-local audit context always propagates across async boundaries.

### 30.5 Java 25

Treat Java 25 mostly as runtime/language evolution from the perspective of audit design. The core audit principles remain:

- structured event;
- stable identity;
- explicit context;
- safe redaction;
- integrity;
- testability.

---

## 31. Example End-to-End: Case Approval Audit

### 31.1 Flow

```text
1. User sends POST /cases/{id}/approve
2. Gateway assigns request ID
3. App creates correlation context
4. Jakarta Security establishes caller principal
5. ActorResolver maps principal to domain actor
6. Case is loaded with tenant and state
7. AuthorizationService checks policy
8. Audit AUTHORIZATION_ALLOWED or AUTHORIZATION_DENIED
9. Domain service changes case state
10. Audit CASE_APPROVED with before/after and policy snapshot
11. Outbox publishes audit event to central pipeline
12. SIEM indexes security event
```

### 31.2 Code Sketch

```java
@ApplicationScoped
public class ApproveCaseUseCase {
    @Inject ActorResolver actorResolver;
    @Inject AuthorizationService authorizationService;
    @Inject CaseRepository caseRepository;
    @Inject AuditRepository auditRepository;
    @Inject TransactionRunner tx;

    public void approve(ApproveCaseCommand command) {
        ActorRef actor = actorResolver.currentActor();

        CaseAggregate current = caseRepository.findForAuthorization(command.caseId());

        AuthorizationDecision decision = authorizationService.check(
                actor,
                "case.approve",
                current.toResourceRef()
        );

        if (!decision.allowed()) {
            auditRepository.append(AuditEvents.authorizationDenied(
                    actor,
                    current.toResourceRef(),
                    "APPROVE",
                    decision
            ));
            throw new ForbiddenException(decision.safeMessage());
        }

        tx.required(() -> {
            CaseAggregate locked = caseRepository.lockById(command.caseId());
            CaseSnapshot before = locked.snapshot();

            locked.approve(actor, command.reason());
            caseRepository.save(locked);

            auditRepository.append(AuditEvents.caseApproved(
                    actor,
                    locked.tenantRef(),
                    locked.toResourceRef(),
                    before,
                    locked.snapshot(),
                    decision,
                    command.reasonCode()
            ));
        });
    }
}
```

### 31.3 Key Lesson

Audit event harus lahir dari tempat yang memahami:

- actor;
- tenant;
- resource;
- action;
- authorization decision;
- state transition;
- transaction result.

Itu biasanya bukan filter, bukan controller tipis, dan bukan database trigger saja.

---

## 32. Regulatory Defensibility Checklist

Untuk setiap high-value action, tanyakan:

```text
[ ] Apakah actor stable ID dicatat?
[ ] Apakah actor type dicatat: human/service/system/delegated/impersonated?
[ ] Apakah tenant/organization context dicatat?
[ ] Apakah resource type dan ID dicatat?
[ ] Apakah action semantic dicatat?
[ ] Apakah authorization decision dicatat?
[ ] Apakah policy version/matched rule dicatat?
[ ] Apakah before/after value dicatat dengan redaction benar?
[ ] Apakah reason code dicatat?
[ ] Apakah correlation ID/trace ID dicatat?
[ ] Apakah source channel dicatat?
[ ] Apakah denied attempt dicatat?
[ ] Apakah audit write reliable terhadap transaction?
[ ] Apakah raw credential/token tidak tercatat?
[ ] Apakah audit event immutable/tamper-evident?
[ ] Apakah audit access diaudit?
[ ] Apakah retention policy jelas?
[ ] Apakah query forensic utama bisa dijawab?
```

---

## 33. Mental Model Final

Audit yang baik bukan sekadar:

```text
logger.info("User approved case")
```

Audit yang baik adalah:

```text
structured, stable, semantic, tenant-aware, actor-aware, policy-aware, transaction-aware, redacted, correlated, immutable enough, searchable, and testable evidence.
```

Untuk menjadi engineer yang kuat di security enterprise Java/Jakarta, Anda perlu melihat audit sebagai bagian dari design sejak awal.

Jika authentication menjawab:

```text
Who are you?
```

Authorization menjawab:

```text
Are you allowed to do this?
```

Audit menjawab:

```text
What exactly happened, under whose authority, against what resource, under what policy, with what result, and can we prove the record is trustworthy enough?
```

Itulah bedanya aplikasi yang sekadar punya login dengan sistem enterprise yang bisa dipertanggungjawabkan.

---

## 34. Ringkasan

Di Part 28, kita membangun fondasi audit/security evidence:

1. log berbeda dari audit;
2. audit adalah evidence layer;
3. audit harus structured dan semantic;
4. actor model harus membedakan human, service, system, delegated, impersonated;
5. authentication dan authorization event sama-sama penting;
6. denied access harus diaudit untuk high-value resource;
7. authorization snapshot penting untuk menjelaskan keputusan historis;
8. before/after values perlu redaction;
9. raw credential/token tidak boleh masuk audit;
10. audit perlu correlation ID dan traceability;
11. critical audit sebaiknya transactional/outbox, bukan fire-and-forget;
12. audit storage perlu immutability/tamper resistance sesuai risiko;
13. audit access sendiri harus diaudit;
14. forensic readiness harus dirancang sebelum incident;
15. Java/Jakarta implementation harus mengikat `SecurityContext`, domain actor, policy decision, dan transaction boundary dengan benar.

---

## 35. Status Seri

Selesai:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
Part 06 — Jakarta Security API Core
Part 07 — SecurityContext Deep Dive
Part 08 — IdentityStore Deep Dive
Part 09 — Credentials and Password Handling in Jakarta Applications
Part 10 — Jakarta Authentication / JASPIC Deep Dive
Part 11 — Jakarta Authorization / JACC Deep Dive
Part 12 — Declarative Authorization: URL, Method, Class, Role
Part 13 — Programmatic Authorization and Domain Permission Design
Part 14 — Roles, Groups, Claims, Scopes, Authorities: Mapping Without Losing Meaning
Part 15 — Session Security: Login State, HttpSession, Cookies, Logout
Part 16 — Token-Based Security in Jakarta Applications
Part 17 — OpenID Connect in Jakarta Security
Part 18 — OAuth2 Resource Server Pattern for JAX-RS and Servlet APIs
Part 19 — SAML, Enterprise SSO, and Legacy Federation Integration
Part 20 — mTLS, Client Certificates, and Strong Caller Authentication
Part 21 — Method Security with CDI, EJB, Interceptors, and Proxies
Part 22 — Security Context Propagation: Threads, Executors, Async, Virtual Threads, Reactive
Part 23 — Multi-Tenancy, Organization Boundary, and Cross-Entity Authorization
Part 24 — Domain Authorization for Case Management and Workflow Systems
Part 25 — API Gateway, Reverse Proxy, and Container Boundary Security
Part 26 — CSRF, CORS, Clickjacking, and Browser Security Around Authentication
Part 27 — Secure Error Handling, 401/403 Semantics, and User Experience
Part 28 — Auditing, Accountability, Non-Repudiation, and Forensic Readiness
```

Berikutnya:

```text
Part 29 — Testing Security: Unit, Integration, Container, Attack Simulation
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 27 — Secure Error Handling, 401/403 Semantics, and User Experience](./learn-java-jakarta-security-authentication-authorization-identity-part-27-secure-error-handling-401-403-user-experience.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 29 — Testing Security: Unit, Integration, Container, Attack Simulation](./learn-java-jakarta-security-authentication-authorization-identity-part-29-testing-security.md)
