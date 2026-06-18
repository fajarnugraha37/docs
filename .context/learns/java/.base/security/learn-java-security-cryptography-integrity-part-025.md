# learn-java-security-cryptography-integrity-part-025

# Part 25 — Secure Logging, Audit Trail Integrity, Evidence, and Non-Repudiation

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `25 / 34`  
> Topik: secure logging, audit trail, evidentiary integrity, tamper-evidence, non-repudiation, dan defensibility untuk sistem Java enterprise/regulatory.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas secrets management: bagaimana secret harus diperlakukan sebagai material sensitif dengan lifecycle, akses terbatas, rotasi, dan proteksi terhadap leakage. Sekarang kita masuk ke topik yang sangat dekat dengan sistem regulatory, enforcement, case management, dispute handling, audit, dan compliance: **log dan audit trail sebagai evidence**.

Banyak engineer menganggap logging sebagai urusan observability:

```text
log.info("User updated application {}", applicationId)
```

Itu berguna untuk debugging, tetapi belum tentu berguna sebagai **evidence**. Evidence membutuhkan properti tambahan:

1. Siapa melakukan apa?
2. Kapan dilakukan?
3. Dari mana dilakukan?
4. Atas authority apa dilakukan?
5. Object apa yang berubah?
6. Nilai sebelum dan sesudah apa?
7. Request/correlation mana yang memicu perubahan?
8. Apakah event bisa dipalsukan?
9. Apakah event bisa dihapus diam-diam?
10. Apakah event bisa dipakai untuk investigasi dan pembuktian?

Part ini bertujuan membangun mental model untuk menjawab pertanyaan tersebut secara engineering, bukan hanya compliance wording.

Setelah menyelesaikan part ini, kamu harus mampu:

- membedakan **application log**, **security log**, **audit trail**, **business event**, dan **evidence record**;
- mendesain audit trail yang mendukung **integrity**, **traceability**, **accountability**, dan **forensic readiness**;
- memahami batas praktis dari istilah **non-repudiation**;
- membuat desain **tamper-evident audit log** menggunakan hash chain, MAC, digital signature, append-only storage, dan external anchoring;
- menghindari leakage secret/PII di log;
- mendesain audit event schema yang stabil, canonical, dan reviewable;
- membuat audit trail untuk Java enterprise system dengan domain state transition;
- menilai apakah audit log cukup kuat untuk regulatory defensibility.

---

## 1. Core Mental Model: Log Bukan Satu Jenis Data

Kata “log” sering dipakai terlalu luas. Ini berbahaya karena tiap jenis log punya tujuan, audience, retention, dan security guarantee yang berbeda.

### 1.1 Application Log

Application log dibuat terutama untuk engineer/operator.

Contoh:

```text
2026-06-16T10:12:44.113Z INFO  ApplicationService - Application 12345 submitted
2026-06-16T10:12:44.119Z ERROR EmailClient - Failed to send email to user
```

Tujuannya:

- debugging;
- troubleshooting;
- incident triage;
- performance diagnosis;
- operational monitoring.

Ciri umum:

- banyak noise;
- format kadang berubah;
- sering berisi stack trace;
- tidak selalu lengkap secara business;
- tidak selalu immutable;
- tidak selalu cocok sebagai evidence.

Application log boleh membantu investigasi, tetapi **jangan menjadikannya satu-satunya audit trail**.

### 1.2 Security Log

Security log mencatat event yang relevan dengan security posture.

Contoh:

```text
LOGIN_SUCCESS
LOGIN_FAILURE
MFA_CHALLENGE_FAILED
TOKEN_VALIDATION_FAILED
ACCESS_DENIED
PRIVILEGE_ESCALATION_ATTEMPT
SESSION_TERMINATED
API_RATE_LIMIT_EXCEEDED
CERTIFICATE_VALIDATION_FAILED
```

Tujuannya:

- detection;
- alerting;
- abuse monitoring;
- incident response;
- security investigation.

Security log harus dirancang dengan asumsi attacker mungkin mencoba:

- menyembunyikan jejak;
- menghasilkan noise;
- melakukan log injection;
- memalsukan source identity;
- mengeksfiltrasi data lewat log;
- memicu storage exhaustion.

### 1.3 Audit Trail

Audit trail mencatat aksi penting dari perspektif accountability dan business/legal process.

Contoh:

```text
CASE_ASSIGNED
APPLICATION_SUBMITTED
APPLICATION_APPROVED
APPLICATION_REJECTED
DOCUMENT_UPLOADED
EVIDENCE_ACCEPTED
CASE_ESCALATED
DECISION_PUBLISHED
ENFORCEMENT_ACTION_CREATED
ROLE_GRANTED
ROLE_REVOKED
```

Audit trail bukan sekadar “ada log”. Audit trail harus menjawab:

```text
actor + action + object + time + reason/context + before/after + authority + correlation
```

Audit trail harus dekat dengan domain state transition.

Kalau sistem case management mengubah status case dari `PENDING_REVIEW` ke `APPROVED`, audit trail minimal harus menyimpan:

- case id;
- previous status;
- new status;
- actor id;
- actor role/authority at the time;
- timestamp;
- decision reason;
- request id/correlation id;
- transaction id;
- source channel;
- optional evidence/document reference;
- integrity metadata.

### 1.4 Business Event

Business event adalah event domain yang biasanya dipakai untuk integrasi/asynchronous processing.

Contoh:

```text
ApplicationSubmitted
CaseEscalated
PaymentReceived
LicenceIssued
DocumentVerified
```

Business event tidak otomatis sama dengan audit trail. Ia bisa dipakai sebagai sumber audit, tapi harus hati-hati.

Masalah umum:

- event mungkin di-redrive;
- event mungkin di-deduplicate;
- event mungkin hanya eventual consistent;
- event mungkin tidak menyimpan before/after state;
- event mungkin tidak cocok untuk legal evidence;
- event retention mungkin lebih pendek dari audit retention.

### 1.5 Evidence Record

Evidence record adalah data yang didesain untuk mendukung pembuktian.

Evidence record membutuhkan property tambahan:

- provenance;
- integrity;
- custody;
- retention;
- reproducibility;
- access control;
- tamper detection;
- stable schema;
- reliable timestamp;
- chain of custody.

Audit trail bisa menjadi evidence record jika didesain dengan benar. Tetapi log biasa jarang cukup.

---

## 2. Security Properties untuk Logging dan Audit Trail

Untuk sistem biasa, log cukup berguna jika bisa dibaca saat error. Untuk sistem regulatory atau enforcement, log harus memiliki security properties.

### 2.1 Completeness

Completeness berarti semua event penting tercatat.

Pertanyaan:

- Apakah semua state transition critical tercatat?
- Apakah failure path juga tercatat?
- Apakah approval/rejection/cancellation/escalation dicatat?
- Apakah admin action dicatat?
- Apakah bulk operation dicatat?
- Apakah automated job action dicatat?
- Apakah external callback/action dicatat?

Anti-pattern:

```java
if (success) {
    audit.log("APPROVED", caseId);
}
```

Masalahnya: failure, rejection, override, rollback, retry, compensation, dan partial update mungkin tidak tercatat.

Better mental model:

```text
Audit follows domain transition, not happy-path branch.
```

### 2.2 Accuracy

Accuracy berarti event mewakili realitas yang benar.

Contoh buruk:

```text
APPLICATION_APPROVED
```

padahal transaksi database rollback.

Dalam Java service, ini sering terjadi jika audit ditulis sebelum transaction commit atau dikirim async tanpa commit awareness.

Better pattern:

```text
Domain mutation and audit event must share transactional consistency boundary,
or audit event must be produced from committed state through outbox/CDC.
```

### 2.3 Integrity

Integrity berarti event tidak bisa diubah tanpa terdeteksi.

Integrity bisa dibuat dengan beberapa lapisan:

- database constraints;
- append-only table;
- immutable storage;
- hash chain;
- MAC;
- digital signature;
- external anchoring;
- restricted privileged access;
- separate security account;
- WORM/object lock storage.

Penting: integrity bukan berarti tidak mungkin dihapus oleh superadmin. Dalam sistem nyata, yang dicari sering kali adalah:

```text
tamper-resistant + tamper-evident + independently verifiable
```

### 2.4 Authenticity

Authenticity berarti event benar-benar berasal dari actor/source yang diklaim.

Dalam audit trail, actor bukan hanya user id.

Actor bisa berupa:

- human user;
- service account;
- scheduled job;
- external agency system;
- integration client;
- migration script;
- admin tool;
- support operator;
- delegated user;
- impersonated session;
- break-glass operator.

Audit event harus bisa membedakan:

```text
who initiated
who executed
on behalf of whom
through which client/session/channel
under which authority
```

### 2.5 Non-Repudiation

Non-repudiation sering disalahpahami.

Secara teori, non-repudiation berarti pihak yang melakukan aksi tidak bisa secara kredibel menyangkal aksi tersebut. Tetapi dalam sistem software biasa, non-repudiation penuh sulit dicapai hanya dengan application log.

Untuk mendekati non-repudiation, dibutuhkan kombinasi:

- strong authentication;
- actor binding;
- session/device/context binding;
- authorization record at time of action;
- reliable timestamp;
- tamper-evident audit trail;
- cryptographic signature untuk event tertentu;
- private key custody yang kuat;
- operational procedure;
- legal/process controls.

Jika private key berada di server aplikasi dan dipakai otomatis untuk menandatangani semua action, signature membuktikan event dibuat oleh sistem, bukan selalu membuktikan human user benar-benar melakukan aksi secara legal. Untuk user-level non-repudiation yang kuat, private key harus dikontrol oleh user atau trusted signing ceremony harus ada.

Jadi wording yang lebih defensible:

```text
The system provides tamper-evident, attributable audit records supporting accountability and investigation.
```

bukan klaim absolut:

```text
The system guarantees non-repudiation for all user actions.
```

### 2.6 Confidentiality

Log bisa menjadi sumber data breach.

Log sering tanpa sengaja menyimpan:

- password;
- token;
- API key;
- session id;
- authorization header;
- refresh token;
- private key material;
- OTP;
- reset token;
- PII;
- NRIC/NIK/passport;
- bank account;
- health/legal info;
- full request payload;
- uploaded document text;
- error detail dari external system.

Security logging harus menyeimbangkan:

```text
forensic usefulness vs data minimization
```

### 2.7 Availability

Logging system bisa menjadi bottleneck atau attack surface.

Jika attacker bisa membuat jutaan failed login dan semua dicatat sinkron ke database utama, maka audit logging bisa menyebabkan DoS.

Pertanyaan:

- Apa yang terjadi jika log sink down?
- Apakah business transaction fail closed atau degrade?
- Apakah queue bisa penuh?
- Apakah log volume bisa menghabiskan disk?
- Apakah attacker bisa membuat high-cardinality event?
- Apakah logging exception menutupi exception asli?

Security-critical audit biasanya perlu fail-closed untuk aksi tertentu, tetapi application logging biasanya tidak boleh menjatuhkan transaksi.

---

## 3. The Evidence Ladder

Tidak semua log punya kekuatan pembuktian yang sama. Gunakan “evidence ladder” berikut.

```text
Level 0 — Debug log
  Useful for troubleshooting only.

Level 1 — Structured application log
  Searchable, correlated, but mutable and not domain-complete.

Level 2 — Security event log
  Captures security-relevant events with normalized schema.

Level 3 — Domain audit trail
  Captures authoritative domain actions and state transitions.

Level 4 — Append-only audit trail
  Harder to modify/delete accidentally.

Level 5 — Tamper-evident audit trail
  Hash/MAC/signature detects mutation, deletion, reorder, or insertion.

Level 6 — Independently anchored evidence
  Anchored to separate system/storage/time authority; stronger forensic defensibility.
```

Untuk regulatory case management, target minimal biasanya:

```text
Critical business action: Level 3 or 4
Privileged/admin/security action: Level 4 or 5
Evidence/legal decision action: Level 5 or 6
```

---

## 4. What Must Be Logged?

OWASP Logging guidance menekankan bahwa security logging harus membantu memahami event security-relevant, memverifikasi sumber, dan mempertimbangkan integrity serta non-repudiation. Dalam sistem Java enterprise, daftar event harus dibuat dari threat model dan domain model.

### 4.1 Authentication Events

Log:

- login success;
- login failure;
- MFA challenge issued;
- MFA failure;
- password reset requested;
- password reset completed;
- account lock/unlock;
- suspicious login;
- session created;
- session expired;
- session revoked;
- logout;
- token refresh;
- token validation failure;
- identity provider error.

Jangan log:

- password;
- OTP;
- full token;
- reset token;
- authorization header.

### 4.2 Authorization Events

Log:

- access denied;
- policy override;
- privileged operation;
- role granted/revoked;
- permission changed;
- tenant boundary violation attempt;
- object-level access denied;
- break-glass access;
- delegation granted/revoked.

Penting: jangan hanya log `403`. Log harus menjawab:

```text
actor tried action X on object Y under authority Z and was denied because reason R
```

### 4.3 Data Mutation Events

Log:

- create/update/delete;
- status transition;
- approval/rejection;
- assignment/reassignment;
- escalation/de-escalation;
- document upload/delete/replacement;
- evidence accepted/rejected;
- decision issued/amended;
- payment/refund adjustment;
- report generation when sensitive;
- export/download of sensitive dataset.

Untuk high-value mutation, simpan before/after.

Namun jangan asal simpan seluruh object JSON karena:

- bisa bocor PII/secrets;
- schema berubah;
- payload terlalu besar;
- diff sulit dibaca;
- retention mahal;
- redaction sulit.

Gunakan selective audited fields.

### 4.4 Administrative Events

Log:

- configuration changed;
- feature flag changed;
- workflow rule changed;
- approval threshold changed;
- security policy changed;
- key/certificate rotated;
- integration endpoint changed;
- batch job manually triggered;
- data correction performed;
- database script executed through app tool;
- maintenance mode enabled/disabled.

Admin action sering lebih berbahaya daripada user action biasa.

### 4.5 Integration Events

Log:

- inbound callback accepted/rejected;
- signature validation failed;
- replay detected;
- stale timestamp;
- schema validation failed;
- external agency response accepted;
- external decision imported;
- file received/transferred;
- checksum mismatch;
- partner certificate expired/changed;
- mTLS failure.

Integration event harus membedakan:

```text
transport accepted != business accepted
```

### 4.6 Security Control Events

Log:

- rate limit triggered;
- WAF rule triggered;
- validation anomaly;
- deserialization filter rejection;
- path traversal attempt;
- XML parser blocked external entity;
- JWT key mismatch;
- TLS certificate validation failure;
- suspicious user agent/IP pattern;
- secret access denied.

### 4.7 Audit Trail Self-Events

Audit system sendiri harus diaudit.

Log:

- audit logging disabled/enabled;
- audit config changed;
- audit verification failed;
- hash chain break detected;
- audit export requested;
- audit record accessed;
- audit retention policy changed;
- audit purge job attempted;
- audit archive generated;
- audit signing key rotated.

Rule:

```text
Audit system changes require stronger audit than normal business actions.
```

---

## 5. What Must Not Be Logged?

### 5.1 Never Log Secrets

Jangan log:

```text
password
passphrase
private key
secret key
API key
OAuth client secret
JWT access token
refresh token
session id
cookie value
Authorization header
OTP
password reset token
magic login link
CSRF token
KMS plaintext data key
```

Bad:

```java
log.info("Calling partner with headers={}", headers);
```

Better:

```java
log.info("Calling partner endpoint={}, correlationId={}, authHeaderPresent={}",
        partnerEndpointName,
        correlationId,
        headers.containsKey("Authorization"));
```

### 5.2 Be Careful with PII

PII may be necessary for audit, but must be minimized.

Bad:

```java
log.info("Applicant update: {}", applicantDto);
```

Better:

```java
audit.record(ApplicantUpdated.builder()
        .applicationId(applicationId)
        .actorId(actorId)
        .changedFields(List.of("residentialAddress", "contactNumber"))
        .piiRedactionMode("FIELD_NAMES_ONLY")
        .build());
```

Jika nilai PII harus disimpan untuk evidence, simpan di audit store dengan akses dan retention khusus, bukan application log umum.

### 5.3 Avoid Full Request/Response Logging by Default

Full payload logging berbahaya karena:

- secrets bisa muncul di nested field;
- PII bocor;
- ukuran besar;
- injection ke log viewer;
- retention tak terkendali;
- compliance deletion menjadi sulit.

Gunakan:

- allowlist field;
- explicit redaction;
- sampling hanya untuk non-sensitive endpoint;
- debug logging guarded by environment and access;
- structured redaction library;
- separate secure payload capture jika benar-benar diperlukan.

### 5.4 Avoid Logging Untrusted Text Without Encoding

Log injection bisa terjadi jika attacker memasukkan newline/control character.

Input:

```text
username = "alice\n2026-06-16 INFO admin logged in"
```

Log naive:

```text
2026-06-16 WARN Login failed for alice
2026-06-16 INFO admin logged in
```

Mitigasi:

- structured logging JSON;
- escape CR/LF/control characters;
- validate field length;
- encode for log sink/viewer;
- never render raw log field as HTML.

---

## 6. Audit Event Schema

Audit event harus stabil dan queryable. Hindari audit message yang hanya free-text.

### 6.1 Minimal Audit Event Fields

```json
{
  "eventId": "01J...",
  "eventType": "CASE_STATUS_CHANGED",
  "eventVersion": 3,
  "occurredAt": "2026-06-16T10:12:44.123Z",
  "recordedAt": "2026-06-16T10:12:44.130Z",
  "actor": {
    "type": "HUMAN_USER",
    "id": "user-123",
    "displayName": "redacted-or-snapshot",
    "roles": ["CASE_OFFICER"],
    "authorityContextId": "authz-snapshot-789"
  },
  "action": "CHANGE_STATUS",
  "object": {
    "type": "CASE",
    "id": "case-456"
  },
  "tenant": {
    "id": "agency-001"
  },
  "source": {
    "channel": "WEB",
    "clientId": "aceas-web",
    "ipHash": "...",
    "userAgentHash": "..."
  },
  "correlation": {
    "requestId": "req-abc",
    "traceId": "trace-def",
    "transactionId": "tx-ghi",
    "idempotencyKey": "idem-jkl"
  },
  "change": {
    "before": {
      "status": "PENDING_REVIEW"
    },
    "after": {
      "status": "APPROVED"
    },
    "reasonCode": "MEETS_REQUIREMENTS"
  },
  "integrity": {
    "canonicalization": "JCS-v1",
    "contentHashAlg": "SHA-256",
    "contentHash": "...",
    "previousHash": "...",
    "chainHash": "...",
    "signatureAlg": "Ed25519",
    "signatureKeyId": "audit-signing-key-2026-01",
    "signature": "..."
  }
}
```

Tidak semua event perlu semua field, tetapi schema harus punya tempat untuk field-field ini.

### 6.2 Event ID

Gunakan event id unik yang sortable atau globally unique.

Pilihan:

- UUIDv7;
- ULID;
- database sequence + shard id;
- Snowflake-like id;
- random UUID dengan timestamp terpisah.

Untuk audit, id harus:

- unik;
- tidak mudah ditebak jika expose ke user;
- queryable;
- tidak berubah;
- bisa dipakai untuk deduplication.

### 6.3 Event Type

Gunakan enum stabil, bukan kalimat bebas.

Bad:

```text
"User approved case"
```

Better:

```text
CASE_APPROVED
CASE_REJECTED
CASE_ESCALATED
ROLE_GRANTED
DOCUMENT_REPLACED
```

Nama event harus mewakili domain fact, bukan implementasi teknis.

### 6.4 Event Version

Audit schema akan berubah. Versioning wajib.

Contoh:

```text
CASE_APPROVED v1: actorId, caseId, timestamp
CASE_APPROVED v2: adds previousStatus, newStatus, reasonCode
CASE_APPROVED v3: adds authorizationSnapshotId, chainHash
```

Rule:

```text
Never mutate old audit records to match new schema unless migration itself is audited and verifiable.
```

### 6.5 Occurred At vs Recorded At

Bedakan:

```text
occurredAt = waktu aksi terjadi dari perspektif business
recordedAt = waktu audit event dicatat oleh sistem audit
receivedAt = waktu central collector menerima event
anchoredAt = waktu hash/signature di-anchor ke storage/time authority
```

Dalam distributed system, ini penting.

### 6.6 Actor Snapshot

Actor role bisa berubah setelah event.

Jika audit hanya menyimpan `actorId`, investigasi 2 tahun kemudian bisa salah karena role saat ini tidak sama dengan role saat aksi.

Simpan snapshot atau reference ke authorization snapshot:

```json
{
  "actorId": "user-123",
  "rolesAtTime": ["CASE_APPROVER"],
  "departmentAtTime": "LICENSING",
  "delegationId": "delegate-456",
  "authzDecisionId": "authz-789"
}
```

### 6.7 Object Snapshot

Sama seperti actor, object bisa berubah.

Audit harus menyimpan cukup konteks:

- object id;
- object type;
- previous state;
- new state;
- selected business identifiers;
- version number;
- optimistic lock version;
- state machine transition id.

### 6.8 Reason and Justification

Untuk regulatory workflow, reason sering lebih penting daripada action.

Contoh:

```json
{
  "eventType": "CASE_REJECTED",
  "reasonCode": "INSUFFICIENT_DOCUMENTATION",
  "reasonTextHash": "...",
  "templateId": "reject-template-v4",
  "officerCommentRedacted": true
}
```

Jangan asal menyimpan free-text reason ke log umum, karena bisa mengandung PII/sensitive legal info.

---

## 7. Java Implementation Model

### 7.1 Jangan Audit dengan `log.info()` Saja

Bad:

```java
log.info("Case {} approved by {}", caseId, userId);
```

Masalah:

- tidak transactional;
- tidak schema-safe;
- tidak immutable;
- sulit query;
- tidak punya before/after;
- tidak punya integrity metadata;
- bisa hilang karena log rotation;
- sulit membuktikan completeness.

Better:

```java
caseService.approve(command);
```

di dalam domain/application service:

```java
@Transactional
public void approve(ApproveCaseCommand command) {
    CaseEntity entity = caseRepository.findForUpdate(command.caseId());

    CaseStatus before = entity.status();
    entity.approve(command.reasonCode(), command.actor());
    CaseStatus after = entity.status();

    auditRepository.append(AuditEvent.caseStatusChanged(
            command.requestContext(),
            command.actor(),
            entity.id(),
            before,
            after,
            command.reasonCode()
    ));
}
```

### 7.2 Audit Event as Domain Side Effect

Audit event harus dibuat dekat dengan mutation.

Pattern:

```text
Command Handler
  -> load aggregate
  -> authorize
  -> validate transition
  -> mutate state
  -> append audit event in same transaction
  -> commit
```

Jika audit dikirim ke external sink, gunakan outbox.

```text
Main transaction:
  update domain table
  insert audit_event table
  insert audit_outbox table

Async publisher:
  read committed outbox
  publish to audit collector/storage
  mark as published
```

### 7.3 Transaction Boundary

Pilihan desain:

#### Option A — Audit in Same DB Transaction

Pros:

- strong consistency;
- sederhana;
- audit tidak tertinggal dari mutation.

Cons:

- DB utama menjadi audit storage;
- audit table bisa sangat besar;
- DBA/admin yang punya akses DB bisa mengubah domain dan audit;
- performance impact.

#### Option B — Transactional Outbox + Central Audit Store

Pros:

- domain mutation tetap konsisten dengan event intent;
- audit bisa diarsipkan ke storage khusus;
- scalable;
- bisa diverifikasi independently.

Cons:

- eventual delivery;
- perlu outbox monitoring;
- perlu duplicate handling;
- perlu chain design hati-hati.

#### Option C — External Audit Service Synchronous

Pros:

- audit store terpisah;
- stronger separation of duty.

Cons:

- audit service outage bisa block business;
- distributed transaction sulit;
- retry bisa duplicate;
- latency.

Untuk high-value regulatory actions, kombinasi A+B sering praktis:

```text
local audit_event committed with business transaction
then replicated/anchored asynchronously to hardened audit store
```

---

## 8. Canonicalization for Audit Integrity

Hash/signature audit event hanya berguna jika data yang ditandatangani stabil.

Masalah JSON biasa:

```json
{"a":1,"b":2}
```

vs

```json
{"b":2,"a":1}
```

Secara semantic sama, byte berbeda.

Jika signature dihitung atas byte JSON tanpa canonicalization, verification bisa gagal setelah reserialization.

### 8.1 Canonical Audit Payload

Rules:

1. Field order deterministic.
2. Encoding UTF-8.
3. Timestamp normalized UTC ISO-8601 with fixed precision.
4. No insignificant whitespace.
5. Numeric representation stable.
6. Null handling explicit.
7. Map keys sorted.
8. Redaction applied before hash/signature.
9. Integrity fields excluded from content hash except intended fields.
10. Schema version included.

### 8.2 Example Canonical String

Instead of signing arbitrary object, sign canonical representation:

```text
eventVersion=3
eventType=CASE_STATUS_CHANGED
eventId=01J...
occurredAt=2026-06-16T10:12:44.123Z
actor.type=HUMAN_USER
actor.id=user-123
object.type=CASE
object.id=case-456
change.before.status=PENDING_REVIEW
change.after.status=APPROVED
reasonCode=MEETS_REQUIREMENTS
previousHash=abc...
```

Atau gunakan canonical JSON scheme yang jelas.

### 8.3 Java Pitfall

Jangan bergantung pada default serialization order dari object/map.

Bad:

```java
byte[] bytes = objectMapper.writeValueAsBytes(event);
byte[] hash = sha256(bytes);
```

Jika `ObjectMapper` config berubah, hash berubah.

Better:

- dedicated canonicalizer;
- fixed ObjectMapper configuration;
- sorted properties/maps;
- versioned canonicalization algorithm;
- test golden vectors.

---

## 9. Tamper-Evident Audit Trail

Tamper-evident berarti perubahan tidak sah bisa dideteksi.

Perubahan yang perlu dideteksi:

- record modified;
- record deleted;
- record inserted in the middle;
- record reordered;
- chain truncated;
- timestamp changed;
- actor changed;
- before/after changed;
- integrity metadata stripped;
- batch archived partially.

### 9.1 Content Hash

Setiap event punya hash atas payload canonical.

```text
contentHash = SHA-256(canonicalEventWithoutIntegrityFields)
```

Ini mendeteksi modifikasi dalam event.

Tapi content hash saja tidak mendeteksi deletion/reordering.

### 9.2 Hash Chain

Tambahkan previous hash.

```text
chainHash[i] = SHA-256(contentHash[i] || chainHash[i-1])
```

Atau:

```text
chainHash[i] = H(eventCanonical[i], chainHash[i-1])
```

Jika event tengah diubah/dihapus, chain setelahnya berubah.

### 9.3 Per-Scope Chain

Satu global chain sederhana tapi bisa menjadi bottleneck.

Alternatif:

```text
chain per tenant
chain per case
chain per module
chain per daily shard
chain per aggregate id
```

Trade-off:

- global chain: stronger total ordering, lower throughput;
- per-case chain: scalable, cocok untuk evidence per case;
- daily shard chain: operationally convenient;
- per-tenant chain: useful for multi-tenant separation.

Untuk case management, per-case chain sangat natural:

```text
case-123 audit chain:
  CASE_CREATED -> DOCUMENT_UPLOADED -> ASSIGNED -> APPROVED -> DECISION_PUBLISHED
```

Namun privileged/security events mungkin butuh separate global/security chain.

### 9.4 MAC-Protected Chain

Jika hanya hash biasa, attacker yang bisa mengubah DB bisa menghitung ulang semua hash.

Tambahkan secret key:

```text
chainMac[i] = HMAC-SHA-256(auditKey, canonicalEvent[i] || chainMac[i-1])
```

Ini mencegah attacker tanpa key menghitung ulang chain valid.

Tapi jika aplikasi atau key compromise, attacker bisa forge event baru.

### 9.5 Signature-Protected Chain

Digital signature memberi verifiability oleh pihak lain tanpa shared secret.

```text
signature[i] = Sign(privateAuditKey, canonicalEvent[i] || previousChainHash)
```

Verifier cukup punya public key.

Pros:

- independent verification;
- cocok untuk export evidence;
- tidak perlu share secret key.

Cons:

- slower than HMAC;
- private key custody critical;
- key rotation lebih kompleks;
- signature hanya sekuat canonicalization dan key custody.

### 9.6 Periodic Anchoring

Hash chain masih bisa dipalsukan jika attacker punya key dan bisa rewrite semua data sebelum detection.

Untuk memperkuat, anchor periodic root hash ke sistem terpisah:

```text
Every hour/day:
  rootHash = hash(lastChainHash per scope)
  store rootHash in immutable storage / external audit service / timestamp authority
```

Anchoring target:

- append-only object storage with lock;
- separate account;
- SIEM;
- external notary service;
- timestamp authority;
- regulator-facing evidence vault;
- write-once storage.

### 9.7 Merkle Tree for Batch Audit

Untuk volume tinggi, audit event harian bisa dibuat Merkle tree.

```text
leaf = hash(canonicalEvent)
parent = hash(left || right)
root = dailyRootHash
```

Kelebihan:

- efficient proof untuk satu event;
- daily root bisa di-anchor;
- tidak perlu global sequential chain semua event.

Kekurangan:

- desain lebih kompleks;
- ordering semantics harus ditangani terpisah;
- deletion detection bergantung pada manifest dan root.

---

## 10. Append-Only Storage Design

### 10.1 Database Table Append-Only

Contoh PostgreSQL/Oracle-like schema concept:

```sql
CREATE TABLE audit_event (
    event_id            VARCHAR(64) PRIMARY KEY,
    event_type          VARCHAR(128) NOT NULL,
    event_version       INTEGER NOT NULL,
    occurred_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    recorded_at         TIMESTAMP WITH TIME ZONE NOT NULL,
    actor_type          VARCHAR(64) NOT NULL,
    actor_id            VARCHAR(128) NOT NULL,
    object_type         VARCHAR(64) NOT NULL,
    object_id           VARCHAR(128) NOT NULL,
    request_id          VARCHAR(128),
    trace_id            VARCHAR(128),
    canonical_payload   CLOB NOT NULL,
    content_hash_alg    VARCHAR(64) NOT NULL,
    content_hash        VARCHAR(128) NOT NULL,
    previous_hash       VARCHAR(128),
    chain_hash          VARCHAR(128) NOT NULL,
    signature_alg       VARCHAR(64),
    signature_key_id    VARCHAR(128),
    signature_value     CLOB,
    created_by_system   VARCHAR(128) NOT NULL,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL
);
```

Append-only controls:

- application has INSERT only;
- no UPDATE/DELETE grant to app user;
- admin updates audited separately;
- database trigger blocks update/delete;
- table partitioned by time/tenant;
- archive job append-only;
- row-level access control for sensitive audit fields.

### 10.2 Trigger Guard

Example concept:

```sql
CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
FOR EACH ROW
BEGIN
    RAISE_APPLICATION_ERROR(-20001, 'audit_event is append-only');
END;
```

Dan delete guard:

```sql
CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
FOR EACH ROW
BEGIN
    RAISE_APPLICATION_ERROR(-20002, 'audit_event cannot be deleted');
END;
```

Catatan: DBA superuser tetap bisa bypass. Karena itu DB trigger bukan security final; ia hanya layer.

### 10.3 Immutable Object Storage

Audit export bisa disimpan sebagai:

```text
s3://audit-vault/year=2026/month=06/day=16/audit-events-0001.jsonl.gz
s3://audit-vault/year=2026/month=06/day=16/audit-manifest.json
s3://audit-vault/year=2026/month=06/day=16/audit-root-signature.sig
```

Dengan:

- object lock/WORM;
- separate account;
- KMS key restricted;
- retention lock;
- lifecycle archive;
- access log enabled;
- write-only role for app/exporter;
- read role separated.

### 10.4 SIEM Is Not Always Audit Trail

SIEM bagus untuk detection, correlation, search, alerting.

Tapi jangan otomatis menganggap SIEM sebagai authoritative audit trail karena:

- event bisa sampling/filter;
- pipeline bisa drop;
- parser bisa normalize field;
- retention berbeda;
- index bisa reprocess;
- admin SIEM bisa delete index;
- SIEM event mungkin tidak transactional dengan domain mutation.

Better:

```text
Authoritative audit trail lives in audit store.
SIEM receives security-relevant copy for monitoring and alerting.
```

---

## 11. Non-Repudiation: Practical and Legal Limits

### 11.1 Server-Signed Audit Event

Jika server menandatangani event:

```text
signature = Sign(serverAuditPrivateKey, canonicalAuditEvent)
```

Ini membuktikan:

- event dibuat/ditandatangani oleh sistem yang memegang key;
- event tidak berubah sejak ditandatangani;
- verification bisa dilakukan dengan public key.

Ini tidak otomatis membuktikan:

- user fisik benar-benar yang klik;
- user tidak terkena session hijack;
- malware di device user tidak melakukan aksi;
- admin tidak melakukan impersonation;
- credential tidak dicuri.

### 11.2 User-Level Non-Repudiation

Lebih kuat jika:

- user melakukan signing dengan private key pribadi;
- private key berada di smart card/HSM/device secure element;
- signing ceremony menunjukkan payload yang jelas;
- user authentication kuat;
- timestamp authority dipakai;
- certificate identity valid;
- revocation status diperiksa;
- legal framework mendukung.

Namun ini jauh lebih kompleks dan tidak selalu perlu.

### 11.3 Better Enterprise Wording

Gunakan klaim yang tepat:

```text
The audit subsystem provides tamper-evident and attributable records for critical actions.
```

```text
The system supports forensic investigation through immutable, integrity-protected audit events.
```

```text
The system records actor, authority, state transition, timestamp, correlation, and integrity metadata for critical decisions.
```

Hindari klaim absolut:

```text
All actions are non-repudiable.
```

---

## 12. Time Integrity

Audit event tanpa waktu yang dapat dipercaya lemah.

### 12.1 Timestamp Types

```text
clientTime      = waktu dari browser/client; untrusted
serviceTime     = waktu server app; moderately trusted
collectorTime   = waktu audit collector menerima event
storageTime     = waktu storage commit
anchorTime      = waktu external anchor/timestamp authority
```

Jangan memakai client time sebagai authoritative audit time.

### 12.2 Clock Drift

Distributed system punya drift.

Mitigasi:

- NTP configured;
- monitor clock skew;
- use UTC;
- store timezone explicitly if local display needed;
- keep sequence/order separate from timestamp;
- record both occurredAt and recordedAt;
- use database commit timestamp if needed;
- avoid relying only on timestamp for ordering.

### 12.3 Ordering

Untuk audit chain, ordering harus explicit:

```text
eventSequence per case
previousEventId per case
previousHash per case
recordedAt
transactionId
```

Timestamp tidak cukup untuk total ordering karena concurrent events bisa punya timestamp sama atau out-of-order.

---

## 13. Correlation and Traceability

Audit trail harus bisa menghubungkan:

```text
user action -> HTTP request -> service command -> DB transaction -> domain state change -> emitted event -> downstream action
```

### 13.1 Correlation Fields

Minimal:

```text
requestId
traceId
spanId
transactionId
sessionIdHash
idempotencyKey
sourceSystem
sourceMessageId
externalReferenceId
```

Jangan simpan raw session id/token. Simpan hash jika perlu korelasi.

### 13.2 Correlation ID Generation

Correlation id harus:

- dibuat di edge/gateway jika belum ada;
- divalidasi jika datang dari client;
- panjang dibatasi;
- karakter allowlist;
- tidak mengandung PII;
- tidak dipercaya sebagai security identity;
- diteruskan ke downstream.

Bad:

```java
String requestId = request.getHeader("X-Request-Id");
MDC.put("requestId", requestId);
```

Better:

```java
String incoming = request.getHeader("X-Request-Id");
String requestId = RequestIds.normalizeOrGenerate(incoming);
MDC.put("requestId", requestId);
```

### 13.3 MDC Discipline

Dalam Java logging framework, MDC berguna tapi bisa bocor antar request jika tidak dibersihkan.

Pattern:

```java
try {
    MDC.put("requestId", requestId);
    MDC.put("actorId", actorIdForLog);
    chain.doFilter(request, response);
} finally {
    MDC.clear();
}
```

Dengan virtual threads atau reactive pipelines, context propagation harus dipahami. Jangan asumsi MDC otomatis aman di semua execution model.

---

## 14. Redaction and Data Minimization

### 14.1 Redaction Strategy

Redaction harus by design, bukan regex panik setelah incident.

Buat taxonomy field:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
PII
SECRET
LEGAL_SENSITIVE
HEALTH_SENSITIVE
FINANCIAL_SENSITIVE
```

Setiap field DTO/domain punya classification.

### 14.2 Redaction Modes

```text
DROP          = field tidak dicatat
MASK          = partial display, e.g. ****1234
HASH          = correlation without value disclosure
TOKENIZE      = replace with reference token
ENCRYPT       = store encrypted, special access required
FIELD_NAME    = only log that field changed
FULL          = allowed only for non-sensitive or secured evidence store
```

### 14.3 Hashing PII for Correlation

Hash PII biasa bisa brute-forced jika value space kecil.

Bad:

```text
hash(email)
hash(postalCode)
hash(nric)
```

Better:

```text
HMAC(auditCorrelationKey, normalizedValue)
```

Dengan HMAC, attacker tanpa key lebih sulit melakukan dictionary correlation.

### 14.4 Structured Redaction Example

```java
public enum Sensitivity {
    PUBLIC,
    INTERNAL,
    PII,
    SECRET,
    LEGAL_SENSITIVE
}

public record AuditField(
        String name,
        Object value,
        Sensitivity sensitivity
) {}

public final class AuditRedactor {
    public Object redact(AuditField field) {
        return switch (field.sensitivity()) {
            case PUBLIC, INTERNAL -> field.value();
            case PII -> "<PII_REDACTED>";
            case SECRET -> "<SECRET_REDACTED>";
            case LEGAL_SENSITIVE -> "<LEGAL_SENSITIVE_REDACTED>";
        };
    }
}
```

Untuk production, redaction harus lebih granular dan tested.

---

## 15. Audit Trail for State Machines

Dalam case management, audit trail harus mengikuti state machine.

### 15.1 State Transition Audit

Setiap transition:

```text
fromState -> action -> toState
```

harus menghasilkan audit event:

```json
{
  "eventType": "CASE_STATE_TRANSITIONED",
  "caseId": "case-123",
  "transition": {
    "from": "PENDING_REVIEW",
    "action": "APPROVE",
    "to": "APPROVED"
  },
  "actor": "officer-456",
  "reasonCode": "MEETS_REQUIREMENTS"
}
```

### 15.2 Invalid Transition Attempt

Invalid attempt juga security-relevant.

```json
{
  "eventType": "CASE_STATE_TRANSITION_DENIED",
  "caseId": "case-123",
  "attemptedTransition": {
    "from": "APPROVED",
    "action": "EDIT_APPLICATION",
    "requestedTo": "DRAFT"
  },
  "actor": "officer-456",
  "denialReason": "TRANSITION_NOT_ALLOWED"
}
```

### 15.3 Automated Transition

Jika job melakukan transition:

```json
{
  "actor": {
    "type": "SCHEDULED_JOB",
    "id": "case-expiry-job",
    "runId": "job-run-20260616-001"
  }
}
```

Jangan pura-pura system action adalah human action.

### 15.4 Delegated/Impersonated Action

```json
{
  "actor": {
    "type": "HUMAN_USER",
    "id": "support-001"
  },
  "onBehalfOf": {
    "type": "HUMAN_USER",
    "id": "applicant-999"
  },
  "delegation": {
    "type": "SUPPORT_IMPERSONATION",
    "approvalId": "breakglass-123",
    "reasonCode": "USER_SUPPORT_REQUEST"
  }
}
```

Impersonation tanpa audit kuat adalah red flag besar.

---

## 16. Java Code: Audit Service Skeleton

### 16.1 Command Context

```java
public record RequestContext(
        String requestId,
        String traceId,
        String sourceIpHash,
        String userAgentHash,
        String channel,
        Instant receivedAt
) {}
```

### 16.2 Actor Context

```java
public record ActorContext(
        ActorType type,
        String actorId,
        List<String> rolesAtTime,
        String authorityContextId,
        Optional<String> onBehalfOfActorId
) {}

public enum ActorType {
    HUMAN_USER,
    SERVICE_ACCOUNT,
    SCHEDULED_JOB,
    EXTERNAL_SYSTEM,
    ADMIN_TOOL
}
```

### 16.3 Audit Event

```java
public record AuditEvent(
        String eventId,
        String eventType,
        int eventVersion,
        Instant occurredAt,
        Instant recordedAt,
        ActorContext actor,
        String objectType,
        String objectId,
        RequestContext requestContext,
        Map<String, Object> change,
        IntegrityMetadata integrity
) {}
```

### 16.4 Integrity Metadata

```java
public record IntegrityMetadata(
        String canonicalization,
        String contentHashAlgorithm,
        String contentHash,
        String previousHash,
        String chainHash,
        String signatureAlgorithm,
        String signatureKeyId,
        String signature
) {}
```

### 16.5 Canonicalizer Interface

```java
public interface AuditCanonicalizer {
    byte[] canonicalize(AuditEventWithoutIntegrity event);
    String algorithmId();
}
```

### 16.6 Audit Signer Interface

```java
public interface AuditSigner {
    SignedAuditPayload sign(byte[] canonicalPayload, String previousChainHash);
    boolean verify(byte[] canonicalPayload, String previousChainHash, SignedAuditPayload signature);
}
```

### 16.7 Append Service

```java
public final class AuditAppender {
    private final AuditRepository repository;
    private final AuditCanonicalizer canonicalizer;
    private final AuditSigner signer;
    private final Clock clock;

    public AuditAppender(
            AuditRepository repository,
            AuditCanonicalizer canonicalizer,
            AuditSigner signer,
            Clock clock
    ) {
        this.repository = Objects.requireNonNull(repository);
        this.canonicalizer = Objects.requireNonNull(canonicalizer);
        this.signer = Objects.requireNonNull(signer);
        this.clock = Objects.requireNonNull(clock);
    }

    public AuditEvent append(AuditEventDraft draft) {
        Instant recordedAt = clock.instant();

        String previousHash = repository.findLastChainHashForScope(draft.chainScope())
                .orElse("GENESIS");

        AuditEventWithoutIntegrity unsigned = draft.toUnsigned(recordedAt);
        byte[] canonical = canonicalizer.canonicalize(unsigned);

        SignedAuditPayload signed = signer.sign(canonical, previousHash);

        AuditEvent event = unsigned.withIntegrity(new IntegrityMetadata(
                canonicalizer.algorithmId(),
                "SHA-256",
                signed.contentHash(),
                previousHash,
                signed.chainHash(),
                signed.signatureAlgorithm(),
                signed.signatureKeyId(),
                signed.signature()
        ));

        repository.insert(event);
        return event;
    }
}
```

Catatan: contoh ini skeleton konseptual. Production implementation harus memperhatikan locking/sequence agar chain tidak race.

---

## 17. Concurrency and Chain Race Conditions

Hash chain butuh ordering. Jika dua thread append event untuk scope yang sama secara bersamaan, bisa terjadi race.

### 17.1 Race Example

```text
Last hash = H10
Thread A reads H10
Thread B reads H10
A writes event 11 with previous H10
B writes event 12 with previous H10
```

Sekarang chain bercabang.

### 17.2 Mitigation Options

#### Option A — Database Lock per Scope

```sql
SELECT last_hash FROM audit_chain_state WHERE scope_id = ? FOR UPDATE;
```

Lalu update state dalam transaksi yang sama.

Pros:

- simple;
- strong ordering per scope.

Cons:

- contention for hot scope.

#### Option B — Sequence per Scope

Gunakan sequence/order number dan optimistic check.

```sql
INSERT ... previous_sequence = current_sequence
```

Jika conflict, retry.

#### Option C — Merkle Batch

Tidak perlu per-event sequential chain; batch events dalam window lalu buat root.

Pros:

- high throughput.

Cons:

- weaker immediate per-event ordering;
- operational complexity.

#### Option D — Single Audit Writer per Scope Partition

Kirim event ke partition berdasarkan caseId/tenantId, lalu satu consumer menjaga ordering.

Pros:

- cocok untuk Kafka-like pipeline.

Cons:

- eventual;
- operational dependency.

---

## 18. Audit Verification

Membuat audit chain tidak cukup. Harus ada verification process.

### 18.1 Verification Types

```text
on-write verification
scheduled background verification
on-read verification
export verification
incident verification
external audit verification
```

### 18.2 Verification Algorithm

For each scope:

```text
previous = GENESIS
for event in orderedEvents(scope):
    canonical = canonicalize(event without integrity)
    expectedContentHash = hash(canonical)
    expectedChainHash = hash(expectedContentHash || previous)
    verify contentHash == expectedContentHash
    verify previousHash == previous
    verify chainHash == expectedChainHash
    verify signature if present
    previous = chainHash
```

### 18.3 Verification Result

Record result:

```json
{
  "verificationRunId": "ver-20260616-001",
  "scope": "case-123",
  "fromEvent": "...",
  "toEvent": "...",
  "result": "PASSED",
  "checkedEvents": 421,
  "rootHash": "...",
  "verifiedAt": "2026-06-16T11:00:00Z"
}
```

Verification run itself should be audited.

### 18.4 What If Verification Fails?

Failing verification is a security incident.

Response:

1. Stop destructive maintenance jobs.
2. Preserve affected audit data.
3. Compare DB, archive, SIEM, object storage copies.
4. Identify first broken event.
5. Check access logs for audit table/storage.
6. Rotate audit signing/MAC keys if key compromise suspected.
7. Notify security/compliance stakeholders.
8. Document findings.
9. Rebuild chain only as a new audited remediation artifact, never silently overwrite.

---

## 19. Audit Key Management

Audit integrity depends on key custody.

### 19.1 Key Types

```text
Audit MAC key
Audit signing private key
Audit signing public key
Audit correlation HMAC key
Audit export encryption key
Audit archive KMS key
```

### 19.2 Key Separation

Do not reuse:

- JWT signing key for audit signing;
- data encryption key for audit MAC;
- password pepper for audit correlation;
- TLS private key for audit evidence.

Each key has distinct purpose.

### 19.3 Key Rotation

Audit key rotation must preserve verifiability.

Event stores:

```text
signatureKeyId
auditKeyVersion
signatureAlgorithm
validFrom/validTo metadata
certificate chain if public verification needed
```

Old public keys must remain available for verification.

### 19.4 Compromise Response

If audit signing key compromised:

- mark key as compromised;
- record compromise time estimate;
- rotate immediately;
- verify chain anchored before compromise;
- treat events after suspected compromise as lower trust unless externally anchored;
- preserve incident evidence;
- publish key status internally.

---

## 20. Log Injection and Viewer Security

Audit data may contain untrusted values.

### 20.1 Newline Injection

Mitigate with structured logs and escaping.

### 20.2 HTML Injection in Log Viewer

If log viewer renders raw message:

```html
<script>alert(1)</script>
```

can become stored XSS.

Mitigate:

- output encode in UI;
- CSP;
- never trust log field;
- treat logs as hostile input;
- sanitize display, not stored evidence.

### 20.3 Query Injection in Log Search

If audit search builds SQL/Lucene query from user input, it can have injection risks.

Use parameterization/query builders.

### 20.4 ANSI Escape Injection

Terminal logs can include escape codes to hide/overwrite output.

Escape control characters for CLI display.

---

## 21. Failure Modes

### 21.1 Audit Written Before Commit

Symptom:

```text
Audit says approved, DB says pending.
```

Cause:

- audit emitted before transaction commit;
- transaction rolled back;
- async event not transaction-aware.

Mitigation:

- write local audit in same transaction;
- use transactional outbox;
- publish after commit hook carefully.

### 21.2 Missing Negative Events

Only successful actions logged.

Impact:

- attack attempts invisible;
- abuse detection weak;
- authorization bypass investigation incomplete.

Mitigation:

- log denied critical attempts;
- log validation anomalies;
- log replay/signature failures.

### 21.3 Logging Too Much Sensitive Data

Impact:

- log system becomes breach source;
- wider access than production DB;
- retention harder;
- backups leak secrets.

Mitigation:

- field classification;
- redaction;
- separate evidence vault;
- access control.

### 21.4 No Actor Snapshot

Impact:

- cannot prove actor had role at time;
- later role changes distort investigation.

Mitigation:

- snapshot authority context;
- store authorization decision id.

### 21.5 Mutable Audit Records

Impact:

- insider can alter history;
- accidental correction overwrites evidence.

Mitigation:

- append-only;
- correction event pattern;
- hash chain/signature.

### 21.6 Silent Logging Failure

Impact:

- critical action occurs with no audit.

Mitigation:

- fail closed for critical audited actions;
- health check audit sink;
- local durable buffer;
- outbox monitoring;
- alert on audit failure.

### 21.7 Chain Recalculation by Privileged Insider

Impact:

- hash-only chain gives false confidence.

Mitigation:

- HMAC/signature with protected key;
- external anchoring;
- separate custody.

### 21.8 Poor Retention Policy

Impact:

- evidence deleted before dispute/investigation;
- data kept longer than allowed;
- privacy/compliance issue.

Mitigation:

- retention by event class;
- legal hold;
- archive manifest;
- purge audit event as an auditable event where legally allowed.

---

## 22. Audit Correction Pattern

Never update old audit event to “fix typo”. Append correction.

Bad:

```sql
UPDATE audit_event SET reason_code = 'CORRECTED' WHERE event_id = '...';
```

Better:

```json
{
  "eventType": "AUDIT_RECORD_CORRECTION_APPENDED",
  "targetEventId": "evt-123",
  "correctionReason": "Original reason code mapping bug",
  "correctedFields": {
    "reasonCode": {
      "from": "DOC_MISSING",
      "to": "INSUFFICIENT_DOCUMENTATION"
    }
  },
  "approvedBy": "audit-admin-001"
}
```

Original remains unchanged.

---

## 23. Audit for Bulk Operations

Bulk operation can affect thousands of records.

Bad:

```text
BULK_UPDATE_DONE count=5000
```

Not enough.

Better:

```text
BULK_OPERATION_STARTED
BULK_OPERATION_ITEM_APPLIED per object or manifest item
BULK_OPERATION_COMPLETED
BULK_OPERATION_FAILED/PARTIAL
```

Use manifest:

```json
{
  "bulkOperationId": "bulk-123",
  "operationType": "CASE_REASSIGNMENT",
  "inputManifestHash": "...",
  "affectedObjectCount": 5000,
  "successCount": 4998,
  "failureCount": 2,
  "resultManifestHash": "..."
}
```

For high-volume operations, per-record audit can be stored in compressed JSONL/Parquet with signed manifest.

---

## 24. Audit Export as Evidence Package

When auditor/regulator asks for evidence, export must be verifiable.

### 24.1 Evidence Package Contents

```text
README.txt
manifest.json
audit-events.jsonl
attachments-manifest.json
verification-report.json
public-keys/
  audit-signing-key-2026-01.pem
signatures/
  manifest.sig
  audit-events.root.sig
```

### 24.2 Manifest Example

```json
{
  "packageId": "evidence-case-123-20260616",
  "generatedAt": "2026-06-16T12:00:00Z",
  "generatedBy": "audit-export-service",
  "caseId": "case-123",
  "eventCount": 87,
  "fromOccurredAt": "2026-01-01T00:00:00Z",
  "toOccurredAt": "2026-06-16T11:59:59Z",
  "files": [
    {
      "path": "audit-events.jsonl",
      "sha256": "..."
    },
    {
      "path": "verification-report.json",
      "sha256": "..."
    }
  ],
  "signature": {
    "algorithm": "Ed25519",
    "keyId": "audit-export-key-2026-01",
    "value": "..."
  }
}
```

### 24.3 Export Access Control

Audit export should itself be audited:

```text
AUDIT_EXPORT_REQUESTED
AUDIT_EXPORT_APPROVED
AUDIT_EXPORT_GENERATED
AUDIT_EXPORT_DOWNLOADED
AUDIT_EXPORT_EXPIRED
```

Export package may contain sensitive data, so protect it with encryption, expiry, and recipient-specific access.

---

## 25. Observability vs Auditability

Observability answers:

```text
Is the system healthy?
Why is it slow/failing?
What changed operationally?
```

Auditability answers:

```text
Who did what, when, under what authority, to what object, with what effect?
Can we detect tampering?
Can we reconstruct the decision path?
```

Do not mix goals blindly.

### 25.1 Observability Log Example

```json
{
  "level": "INFO",
  "logger": "CaseController",
  "message": "Approve case request completed",
  "durationMs": 183,
  "requestId": "req-123"
}
```

### 25.2 Audit Event Example

```json
{
  "eventType": "CASE_APPROVED",
  "caseId": "case-456",
  "actorId": "officer-789",
  "authorityContextId": "authz-001",
  "previousStatus": "PENDING_REVIEW",
  "newStatus": "APPROVED",
  "reasonCode": "MEETS_REQUIREMENTS",
  "occurredAt": "2026-06-16T10:12:44.123Z",
  "requestId": "req-123",
  "chainHash": "..."
}
```

Both useful. Different purpose.

---

## 26. Regulatory Case Management Example

### 26.1 Scenario

A licensing application goes through:

```text
DRAFT -> SUBMITTED -> SCREENING -> PENDING_REVIEW -> APPROVED -> LICENCE_ISSUED
```

Actors:

- applicant;
- case officer;
- approver;
- scheduled screening job;
- external agency API;
- admin/support.

### 26.2 Critical Events

```text
APPLICATION_SUBMITTED
SCREENING_STARTED
SCREENING_RESULT_RECEIVED
CASE_ASSIGNED
DOCUMENT_REQUESTED
DOCUMENT_UPLOADED
CASE_REVIEWED
CASE_APPROVED
LICENCE_ISSUED
NOTIFICATION_SENT
```

### 26.3 Audit Invariants

1. Every state transition has exactly one authoritative audit event.
2. Every audit event references immutable actor context.
3. Every critical decision has reason code or justification reference.
4. Every document referenced by decision has content hash.
5. Every external result has source system and message id.
6. Every event is append-only.
7. Every event is in per-case hash chain.
8. Daily root hash is anchored to immutable storage.
9. Audit verification job runs daily.
10. Audit export produces signed evidence package.

### 26.4 Decision Evidence

When case approved:

```json
{
  "eventType": "CASE_APPROVED",
  "caseId": "case-123",
  "applicationId": "app-456",
  "actor": {
    "type": "HUMAN_USER",
    "id": "officer-789",
    "rolesAtTime": ["APPROVER"],
    "departmentAtTime": "LICENSING"
  },
  "decision": {
    "reasonCode": "MEETS_REQUIREMENTS",
    "policyVersion": "licensing-policy-2026.3",
    "checklistVersion": "approval-checklist-v5"
  },
  "state": {
    "from": "PENDING_REVIEW",
    "to": "APPROVED"
  },
  "supportingEvidence": [
    {
      "type": "DOCUMENT",
      "documentId": "doc-001",
      "sha256": "..."
    },
    {
      "type": "SCREENING_RESULT",
      "resultId": "screen-001",
      "sourceSystem": "external-agency-x",
      "sourceMessageId": "msg-999"
    }
  ]
}
```

This is much stronger than:

```text
INFO Case approved
```

---

## 27. Testing Secure Audit Logging

### 27.1 Unit Tests

Test:

- required fields;
- redaction;
- canonicalization stability;
- hash generation;
- signature verification;
- sensitive field blocking;
- invalid actor context rejected;
- event version compatibility.

### 27.2 Transaction Tests

Test:

- audit not written if transaction rollback;
- audit written if mutation committed;
- outbox created with audit;
- duplicate command does not duplicate audit incorrectly;
- idempotency recorded.

### 27.3 Security Tests

Test:

- newline injection escaped;
- control characters escaped;
- oversized field rejected/truncated safely;
- token/password not present in logs;
- unauthorized audit access denied;
- update/delete audit record blocked.

### 27.4 Verification Tests

Test:

- modifying event breaks chain;
- deleting event breaks chain;
- reordering event breaks chain;
- wrong key fails signature;
- old key verifies old event;
- rotated key verifies new event.

### 27.5 Golden Vector Tests

Canonicalization must have stable golden tests.

```text
input event -> exact canonical bytes -> expected hash -> expected signature
```

If code/library upgrade changes canonical output, test fails.

---

## 28. Production Checklist

### 28.1 Audit Event Design

- [ ] Event types are enumerated and versioned.
- [ ] Critical domain transitions are covered.
- [ ] Failure/denied/security events are covered.
- [ ] Actor context is snapshotted.
- [ ] Authorization context is recorded.
- [ ] Before/after state is recorded where needed.
- [ ] Reason code/justification is recorded for decisions.
- [ ] Correlation ids are included.
- [ ] Sensitive fields are classified.
- [ ] Redaction policy is explicit.

### 28.2 Storage

- [ ] Audit table/store is append-only.
- [ ] App user has no update/delete permission.
- [ ] Audit storage access is separated.
- [ ] Retention policy is defined.
- [ ] Archive process is audited.
- [ ] Export process is audited.
- [ ] Backup/restore preserves audit integrity.

### 28.3 Integrity

- [ ] Canonicalization algorithm is versioned.
- [ ] Content hash exists.
- [ ] Chain hash or Merkle root exists for critical events.
- [ ] HMAC/signature key is separated from app secrets.
- [ ] Key id is stored.
- [ ] Key rotation is supported.
- [ ] Verification job exists.
- [ ] Verification failures alert security.
- [ ] External anchoring exists for high-value events.

### 28.4 Security

- [ ] Secrets are never logged.
- [ ] PII logging is minimized.
- [ ] Log injection mitigated.
- [ ] Log viewer output encoded.
- [ ] Audit access is authorized and audited.
- [ ] Bulk export requires approval.
- [ ] Break-glass access is audited.
- [ ] Audit system changes are audited.

### 28.5 Operations

- [ ] Audit sink health monitored.
- [ ] Audit backlog monitored.
- [ ] Audit failure mode defined.
- [ ] Log volume limits defined.
- [ ] Storage capacity planned.
- [ ] Clock skew monitored.
- [ ] Retention and legal hold implemented.
- [ ] Incident response playbook exists.

---

## 29. Review Questions

Use these during architecture review or PR review.

1. Is this event an application log, security log, audit trail, or evidence record?
2. What business/security question must this record answer later?
3. Is the event emitted after the authoritative state transition?
4. Can the transaction commit without audit?
5. What happens if audit write fails?
6. Does the audit event include actor, action, object, time, authority, and correlation?
7. Does it include before/after state where needed?
8. Does it avoid secrets and unnecessary PII?
9. Can the record be modified or deleted silently?
10. Can deletion/reordering be detected?
11. Who can access audit records?
12. Who can export audit records?
13. Are audit exports themselves audited?
14. How are audit signing/MAC keys protected?
15. How is key rotation handled?
16. How can an auditor verify the record?
17. How are old schema versions handled?
18. What is the retention requirement?
19. What is the legal hold process?
20. How do we investigate a broken audit chain?

---

## 30. Common Anti-Patterns

### Anti-Pattern 1 — “We Have Logs, So We Have Audit”

Application logs are not audit trail.

### Anti-Pattern 2 — Audit Only in Controller

Controller may not know actual committed mutation.

### Anti-Pattern 3 — Audit Only Success Path

Denied/failed attempts disappear.

### Anti-Pattern 4 — Store Full DTO as Audit

Leaks sensitive data and couples audit to unstable schema.

### Anti-Pattern 5 — Mutable Audit Records

Correction via update destroys evidence value.

### Anti-Pattern 6 — Hash Without Secret or Anchor

Attacker with DB write can recalculate hashes.

### Anti-Pattern 7 — No Actor Snapshot

Later role changes break accountability.

### Anti-Pattern 8 — Audit Key Reused

Key reuse destroys separation of purpose.

### Anti-Pattern 9 — Log Viewer Trusts Logs

Stored XSS/log injection risk.

### Anti-Pattern 10 — No Verification Process

Tamper-evident design without verification is decorative security.

---

## 31. Mini Case Study: Approval Dispute

### 31.1 Problem

A user disputes that they approved a case:

```text
“I never approved case C-123. The system must be wrong.”
```

### 31.2 Weak Logging Situation

Application log:

```text
INFO Case C-123 approved
```

Problems:

- no actor;
- no timestamp precision;
- no authority;
- no before/after;
- no request id;
- no session context;
- no integrity;
- no proof of commit;
- no reason;
- mutable log.

Conclusion: weak evidence.

### 31.3 Strong Audit Situation

Audit trail shows:

- `CASE_APPROVED` event;
- actor id;
- roles at time;
- authorization decision id;
- session id hash;
- mfa level;
- request id;
- case previous/new status;
- reason code;
- supporting document hashes;
- content hash;
- previous hash;
- signature;
- daily anchor hash;
- verification report passed.

Security log also shows:

- login success;
- MFA success;
- same session id hash;
- same IP hash/device fingerprint class;
- no session anomaly;
- no admin impersonation.

Conclusion: stronger accountability, though still not metaphysical proof that the physical person clicked. It supports defensible investigation.

---

## 32. How This Connects to Previous Parts

- From Part 3: audit integrity uses authenticity/integrity/freshness guarantees.
- From Part 5: content hash alone is not enough but is a building block.
- From Part 8: HMAC can protect audit chain against unauthorized recalculation.
- From Part 9: digital signature enables independent verification.
- From Part 11: audit key lifecycle determines evidentiary strength.
- From Part 13–15: certificates/TLS protect transport and signing identity but not domain audit completeness.
- From Part 21: authorization decision must be captured for accountability.
- From Part 22–23: input/log injection and dangerous APIs affect audit reliability.
- From Part 24: secrets must not leak into logs.

---

## 33. Practical Design Recommendation

For a Java regulatory/case management platform, a strong practical design is:

```text
1. Domain service emits structured audit event for every critical state transition.
2. Audit event is inserted in same DB transaction as domain mutation.
3. Audit table is append-only with no UPDATE/DELETE permission for app user.
4. Audit event includes actor snapshot, authority snapshot, before/after, reason, and correlation.
5. Sensitive fields are redacted or stored in separate protected evidence vault.
6. Each case has a per-case hash chain.
7. Privileged/security events have a separate security chain.
8. Audit events are asynchronously exported to immutable object storage.
9. Daily root hashes/manifests are signed and anchored in separate account/system.
10. Verification job runs daily and on evidence export.
11. Audit export creates signed evidence package.
12. Any audit system access/export/configuration change is itself audited.
```

This is more defensible than relying only on SIEM/application logs, and more practical than trying to implement absolute non-repudiation everywhere.

---

## 34. Summary

Secure logging and audit trail design is not about printing more messages. It is about creating reliable, minimally sensitive, attributable, and tamper-evident records of meaningful system behavior.

Key takeaways:

1. Application logs, security logs, audit trails, business events, and evidence records are different artifacts.
2. Audit trails must follow domain state transitions, not controller happy paths.
3. Critical audit events need actor, action, object, time, authority, correlation, and before/after state.
4. Logs are untrusted input and can become attack surfaces.
5. Secrets must never be logged; PII must be minimized and protected.
6. Content hash detects mutation inside a record, but not deletion/reordering.
7. Hash chain detects deletion/reordering, but hash-only chain can be recalculated by privileged attackers.
8. HMAC/signature and external anchoring improve tamper-evidence.
9. Non-repudiation should be claimed carefully; most enterprise systems provide attributable and tamper-evident evidence, not absolute proof.
10. Audit verification is mandatory; tamper-evident design without verification is incomplete.
11. Audit export should be verifiable and itself audited.
12. For regulatory Java systems, audit design is part of domain architecture, not a logging afterthought.

---

## 35. References

- OWASP Logging Cheat Sheet — guidance on security logging, event attributes, untrusted data, integrity, and non-repudiation considerations.
- OWASP Top 10 2021 A09 Security Logging and Monitoring Failures — guidance that high-value transactions should have audit trails with integrity controls.
- OWASP Top 10 2025 A09 Security Logging and Alerting Failures — updated emphasis on audit trail integrity controls and correct encoding of log data.
- NIST SP 800-92, Guide to Computer Security Log Management — practical guidance for log management processes and infrastructure.
- OWASP Proactive Controls C9 Security Logging and Monitoring — secure logging practices including encoding, sensitive data avoidance, and protecting log integrity.
- OWASP Secrets Management Cheat Sheet — relevant for avoiding secret leakage into logs and controlling access to sensitive operational data.
- NIST SP 800-57 Part 1 — key management lifecycle concepts relevant for audit MAC/signature keys.
- RFC 8785 JSON Canonicalization Scheme — useful reference when designing deterministic JSON canonicalization for signatures/hashes.

---

# End of Part 25

Seri belum selesai. Lanjut ke Part 26: **Data Integrity in Distributed Java Systems**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-security-cryptography-integrity-part-024](./learn-java-security-cryptography-integrity-part-024.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-security-cryptography-integrity-part-026](./learn-java-security-cryptography-integrity-part-026.md)
