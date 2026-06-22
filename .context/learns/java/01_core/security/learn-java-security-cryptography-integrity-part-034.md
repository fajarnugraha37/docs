# learn-java-security-cryptography-integrity-part-034

# Capstone: Designing a Secure Java Regulatory Case Management Platform

> Seri: `learn-java-security-cryptography-integrity`  
> Bagian: `Part 34` dari `Part 0..34`  
> Status: **bagian terakhir / final capstone**

---

## 0. Tujuan Part Ini

Part ini adalah **capstone**: kita menyatukan seluruh konsep dari Part 0 sampai Part 33 menjadi satu rancangan sistem nyata.

Konteks sistem yang kita gunakan:

> Sebuah **Java-based regulatory case management platform** untuk enforcement lifecycle, application/case processing, evidence management, audit trail, user actions, inter-agency integration, service-to-service communication, document handling, reporting, dan operational investigation.

Targetnya bukan membuat contoh aplikasi kecil, tetapi membangun cara berpikir level senior/principal:

1. bagaimana memetakan **asset dan trust boundary**;
2. bagaimana mendefinisikan **security invariants**;
3. bagaimana menerapkan **cryptography dan integrity controls** dengan benar;
4. bagaimana menjaga **case record, evidence, document, command, event, audit, token, dan artifact integrity**;
5. bagaimana membuat desain yang **operationally defensible** saat diaudit, diserang, atau terjadi incident;
6. bagaimana mengevaluasi desain dengan **failure mode**, bukan hanya checklist.

Part ini sengaja tidak mengulang semua detail API `Cipher`, `Mac`, `Signature`, `KeyStore`, TLS, JWT, OAuth, deserialization, file upload, supply chain, dan runtime hardening. Semua itu sudah dibahas di part sebelumnya. Di sini kita menyusun semuanya menjadi **architecture model**.

---

## 1. Prinsip Utama Capstone

Security design yang matang tidak dimulai dari pertanyaan:

> “Library apa yang harus dipakai?”

Tetapi dari pertanyaan:

> “Guarantee apa yang harus tetap benar walaupun user, client, network, file, dependency, service, clock, database, dan operator tertentu tidak sepenuhnya bisa dipercaya?”

Dalam regulatory platform, security bukan hanya soal mencegah hacker masuk. Security juga mencakup:

1. **correctness of authority** — hanya pihak yang berwenang boleh melakukan tindakan;
2. **integrity of decision record** — riwayat keputusan tidak boleh berubah diam-diam;
3. **evidence defensibility** — evidence harus dapat dipercaya asal-usul dan keutuhannya;
4. **audit traceability** — semua aksi penting harus dapat ditelusuri;
5. **workflow integrity** — state transition harus sah dan tidak bisa dilewati;
6. **identity binding** — aksi harus terikat ke subject yang benar;
7. **time defensibility** — timestamp harus masuk akal dan tidak mudah dimanipulasi;
8. **release integrity** — artifact yang dideploy harus sama dengan yang direview;
9. **operational containment** — saat terjadi kompromi, blast radius harus terbatas;
10. **recoverability** — sistem bisa dipulihkan tanpa menghancurkan chain of evidence.

---

## 2. Platform Model

Kita gunakan model konseptual berikut.

```text
+-----------------------+        +--------------------------+
| Public / External     |        | Internal Agency Users    |
| Users / Entities      |        | Officers / Supervisors   |
+-----------+-----------+        +------------+-------------+
            |                                 |
            v                                 v
+----------------------------------------------------------+
| Edge Layer                                                |
| API Gateway / WAF / TLS / Rate Limit / Request Logging    |
+---------------------------+------------------------------+
                            |
                            v
+----------------------------------------------------------+
| Identity & Access Layer                                   |
| OIDC/OAuth2, SSO, MFA, Session, Token Validation, ABAC     |
+---------------------------+------------------------------+
                            |
                            v
+----------------------------------------------------------+
| Application Services                                      |
| Case, Application, Enforcement, Evidence, Document, Audit  |
| Workflow, Notification, Reporting, Integration            |
+---------------------------+------------------------------+
                            |
          +-----------------+-----------------+
          |                                   |
          v                                   v
+----------------------+           +-------------------------+
| Data Stores           |           | Messaging / Events      |
| RDBMS, Object Store,  |           | Broker, Outbox, Jobs    |
| Search, Cache         |           |                         |
+----------------------+           +-------------------------+
          |                                   |
          v                                   v
+----------------------------------------------------------+
| External Systems                                          |
| Identity Providers, Payment, Maps, Registry, Agencies,    |
| File Transfer, Email/SMS, Data Warehouse                  |
+----------------------------------------------------------+
```

Security design harus menganggap setiap garis panah sebagai potensi **trust boundary**.

---

## 3. Asset Inventory

Sebelum bicara control, kita harus tahu apa yang dilindungi.

### 3.1 Primary Business Assets

| Asset | Mengapa penting | Security property utama |
|---|---|---|
| Case record | Menentukan status enforcement dan keputusan regulator | Integrity, authorization, auditability |
| Investigation note | Bisa berisi reasoning internal dan sensitive fact | Confidentiality, integrity |
| Evidence file | Dasar keputusan dan legal defensibility | Integrity, provenance, chain of custody |
| Decision record | Dasar approval, rejection, sanction, appeal | Integrity, non-repudiation-like accountability |
| Workflow state | Mengatur lifecycle kasus | Integrity, authorization |
| Correspondence | Komunikasi formal dengan entity/public | Integrity, confidentiality |
| User identity | Menentukan siapa melakukan apa | Authenticity, binding |
| Access policy | Menentukan privilege | Integrity |
| Audit trail | Bukti aktivitas | Integrity, completeness, immutability-like behavior |
| Integration payload | Data lintas sistem | Authenticity, integrity, replay resistance |

### 3.2 Technical Security Assets

| Asset | Risiko jika bocor/rusak |
|---|---|
| TLS private key | Impersonation, decryption depending on protocol/context |
| Token signing key | Forged session/access token |
| Encryption key | Data disclosure |
| MAC key | Forged integrity token/request signature |
| Database credential | Data exfiltration/tampering |
| KMS/HSM access policy | Mass key misuse |
| CI/CD signing key | Malicious release trusted as legitimate |
| Admin credential | Full platform compromise |
| JWKS cache/config | Token validation bypass/misrouting |
| Truststore | Trusting wrong CA/system |

### 3.3 Derived Assets

Derived assets sering dilupakan:

1. search index;
2. report snapshot;
3. exported CSV/PDF;
4. cache entries;
5. audit listing view;
6. BI warehouse copy;
7. test/staging masked data;
8. log aggregation copy;
9. object-store thumbnail/preview;
10. message retry payload.

Rule penting:

> Jika data sensitif atau authoritative disalin, maka security property-nya ikut terbawa atau harus sengaja didegradasi dengan alasan eksplisit.

---

## 4. Threat Actor Model

Dalam platform regulatory, threat actor tidak selalu “internet attacker”. Model harus lebih kaya.

| Actor | Capability | Contoh threat |
|---|---|---|
| Anonymous internet user | Kirim request publik | Injection, upload malicious file, brute force |
| Authenticated external user | Punya akun sah | BOLA, unauthorized case access, replay request |
| Internal officer | Punya akses modul tertentu | Horizontal privilege abuse, unauthorized state transition |
| Privileged admin | Bisa konfigurasi sistem | Policy tampering, log deletion, key misuse |
| Compromised service | Service credential bocor | Lateral movement, forged internal calls |
| Compromised dependency | Code execution saat runtime/build | Supply chain compromise |
| Malicious file sender | Kirim archive/document berbahaya | Zip Slip, malware, parser exploit |
| Network attacker | Bisa observe/modify traffic tertentu | MITM, downgrade, replay |
| CI/CD attacker | Bisa ubah pipeline/artifact | Malicious release |
| Database attacker | Bisa modify data langsung | Silent case/audit manipulation |

Security desain yang baik tidak mengasumsikan semua internal actor jujur dan semua internal network aman.

---

## 5. Trust Boundary Map

### 5.1 Boundary 1 — Browser / Client to Edge

Risiko:

1. request tampering;
2. stolen token;
3. CSRF jika cookie-based;
4. replay;
5. malicious file upload;
6. bypass client-side validation;
7. forged headers.

Controls:

1. TLS modern;
2. strict server-side validation;
3. CSRF protection untuk cookie session;
4. token validation;
5. rate limiting;
6. security headers;
7. upload scanning/staging;
8. request correlation ID generated or normalized server-side.

Invariant:

> Tidak ada keputusan authorization, workflow, atau integrity yang bergantung hanya pada client-side state.

### 5.2 Boundary 2 — Edge to Application Service

Risiko:

1. spoofed identity headers;
2. missing internal authentication;
3. gateway bypass;
4. inconsistent TLS termination;
5. header confusion.

Controls:

1. zero-trust service identity;
2. mTLS or workload identity;
3. signed internal headers if needed;
4. reject direct calls that bypass gateway policy;
5. normalize identity context once.

Invariant:

> Application service tidak boleh percaya header identity kecuali berasal dari boundary yang terautentikasi dan terotorisasi.

### 5.3 Boundary 3 — Service to Service

Risiko:

1. lateral movement;
2. confused deputy;
3. over-privileged service account;
4. replayed internal command;
5. schema drift.

Controls:

1. service identity;
2. least privilege;
3. scoped token or mTLS client cert;
4. idempotency key;
5. command/event signature for high-value operations;
6. policy enforcement per resource.

Invariant:

> Service identity membuktikan caller service, bukan membuktikan caller boleh melakukan semua action atas semua object.

### 5.4 Boundary 4 — Application to Database

Risiko:

1. SQL injection;
2. direct data tampering;
3. over-privileged DB user;
4. audit trail modification;
5. data exfiltration via report/query.

Controls:

1. parameterized query;
2. schema-level privilege separation;
3. immutable-ish audit design;
4. append-only audit table pattern;
5. DB activity monitoring;
6. encryption at rest;
7. row/object authorization enforced before query result exposure.

Invariant:

> Database integrity control tidak boleh hanya bergantung pada aplikasi; aplikasi integrity control juga tidak boleh hanya bergantung pada database.

### 5.5 Boundary 5 — Application to Object Store / File Store

Risiko:

1. path traversal;
2. object overwrite;
3. evidence replacement;
4. pre-signed URL leakage;
5. metadata tampering;
6. missing digest/signature.

Controls:

1. content-addressed or immutable object naming for evidence;
2. digest stored separately;
3. versioning/object lock where available;
4. malware scanning pipeline;
5. metadata canonicalization;
6. strict authorization before download;
7. short-lived pre-signed URL only after authorization.

Invariant:

> Evidence object identity harus terikat pada digest dan case/evidence record, bukan hanya filename.

### 5.6 Boundary 6 — Application to Message Broker

Risiko:

1. forged event;
2. replayed event;
3. duplicate command;
4. poison message;
5. unauthorized consumer;
6. lost ordering assumption.

Controls:

1. broker authentication and authorization;
2. producer identity;
3. outbox pattern;
4. idempotent consumer;
5. schema validation;
6. event versioning;
7. optional message MAC/signature for high-value events.

Invariant:

> Consumer tidak boleh menganggap event valid hanya karena event muncul di broker.

### 5.7 Boundary 7 — CI/CD to Runtime

Risiko:

1. artifact substitution;
2. unsigned image/JAR;
3. malicious dependency;
4. compromised runner;
5. leaked deployment secret;
6. unreviewed emergency change.

Controls:

1. signed build artifact;
2. SBOM;
3. SCA;
4. provenance;
5. protected branches;
6. environment separation;
7. release approval;
8. deployment verification.

Invariant:

> Production hanya menjalankan artifact yang traceable ke source, build, approval, and security checks.

---

## 6. Security Invariants

Security invariant adalah pernyataan yang harus selalu benar.

### 6.1 Identity Invariants

1. Setiap user action penting harus terikat pada authenticated subject.
2. Subject external, internal, system, dan service harus dibedakan.
3. Impersonation/delegation harus eksplisit, logged, time-bound, dan reviewable.
4. Session/token tidak boleh diterima tanpa issuer, audience, expiry, signature, dan intended context validation.
5. Identity dari token tidak otomatis berarti authorization atas object.

### 6.2 Authorization Invariants

1. User tidak boleh membaca case yang tidak berada dalam scope-nya.
2. User tidak boleh mengubah workflow state tanpa permission dan valid transition.
3. Supervisor approval tidak boleh dilakukan oleh maker yang sama jika separation of duties diwajibkan.
4. System job hanya boleh melakukan action yang sesuai purpose-nya.
5. Admin teknis tidak otomatis punya hak business decision.

### 6.3 Case Record Integrity Invariants

1. Case ID tidak boleh dimanipulasi untuk akses case lain.
2. Case state transition harus melalui transition function, bukan update field bebas.
3. Critical fields harus memiliki change history.
4. Decision record tidak boleh diubah tanpa explicit revision record.
5. Case closure/reopen harus meninggalkan audit trail lengkap.

### 6.4 Evidence Integrity Invariants

1. Evidence file tidak boleh diganti tanpa menghasilkan evidence version baru.
2. Digest evidence harus dihitung saat intake dan diverifikasi saat retrieval/high-value use.
3. Evidence metadata tidak boleh bertentangan dengan object digest/version.
4. Evidence deletion harus soft-delete/legal-hold aware.
5. Evidence export harus menyertakan integrity manifest.

### 6.5 Audit Trail Invariants

1. High-value action harus menghasilkan audit event.
2. Audit event harus memuat actor, action, target, timestamp, source, result, dan correlation ID.
3. Audit record tidak boleh diubah in-place oleh normal application flow.
4. Audit deletion harus tidak tersedia untuk aplikasi biasa.
5. Audit trail harus cukup untuk reconstruct decision path.

### 6.6 Cryptographic Invariants

1. Key tidak boleh hardcoded.
2. IV/nonce untuk mode yang mensyaratkan uniqueness tidak boleh reuse dengan key yang sama.
3. Password tidak boleh reversible encrypted.
4. MAC/signature verification harus dilakukan sebelum trust terhadap payload.
5. Key usage harus dipisah: encryption key, signing key, MAC key, token key.
6. Crypto payload harus versioned.
7. Algorithm agility harus dirancang tanpa membuka downgrade attack.

### 6.7 Supply Chain Invariants

1. Dependency baru harus diketahui, direview, dan discan.
2. Production artifact harus traceable ke source commit.
3. Build tidak boleh resolve dependency dari repository tidak dipercaya.
4. Vulnerability critical harus punya response path.
5. CI secret tidak boleh tersedia untuk untrusted fork/branch/job.

---

## 7. Reference Security Architecture

```text
[Client]
   |
   | TLS, CSRF/token, rate limit
   v
[Gateway/WAF]
   |
   | authenticated internal channel
   v
[Identity Context Normalizer]
   |
   | canonical subject + session context
   v
[Application Service Boundary]
   |
   +--> [Authorization Guard]
   |        - object scope
   |        - role/attribute policy
   |        - workflow policy
   |
   +--> [Validation + Canonicalization]
   |        - DTO validation
   |        - domain invariant validation
   |        - parser hardening
   |
   +--> [Command Handler]
   |        - idempotency
   |        - transition function
   |        - transaction boundary
   |
   +--> [Audit Event Builder]
   |        - canonical event
   |        - hash chain/signature optional
   |
   +--> [Outbox]
   |        - durable event emission
   |
   +--> [Evidence Service]
   |        - staging
   |        - scanning
   |        - digest
   |        - immutable object write
   |
   +--> [Crypto Service]
            - KMS/HSM integration
            - envelope encryption
            - signing/MAC
            - key versioning
```

Desain ini punya satu karakter penting:

> Security decision dibuat di boundary yang eksplisit, bukan tersebar secara kebetulan di controller, repository, scheduler, dan frontend.

---

## 8. Identity and Access Design

### 8.1 Identity Context

Buat canonical internal identity model.

```java
public record SecuritySubject(
    String subjectId,
    SubjectType subjectType,
    String issuer,
    Set<String> roles,
    Map<String, String> attributes,
    String sessionId,
    String authenticationLevel,
    Instant authenticatedAt
) {}

enum SubjectType {
    EXTERNAL_USER,
    INTERNAL_OFFICER,
    SYSTEM_JOB,
    SERVICE,
    SUPPORT_IMPERSONATION
}
```

Tujuannya bukan class ini secara literal, tetapi separation of meaning:

1. external user bukan internal officer;
2. service bukan human user;
3. system job bukan admin;
4. impersonation bukan identity asli;
5. role bukan object permission.

### 8.2 Token Validation Boundary

Token validation harus dilakukan sekali di boundary yang jelas.

Minimum validation untuk access token/JWT:

1. signature valid;
2. allowed algorithm explicitly configured;
3. issuer trusted;
4. audience matches service;
5. expiry/not-before valid dengan clock skew terbatas;
6. key selected dari trusted JWKS;
7. `kid` tidak boleh menjadi file path/URL injection;
8. token type/use sesuai context;
9. subject mapped ke internal identity;
10. authorization tetap dilakukan setelah token valid.

Anti-pattern:

```text
JWT valid => user may access any object referenced in request
```

Correct model:

```text
JWT valid => subject authenticated
subject + object + action + context => authorization decision
```

### 8.3 Authorization Guard

Authorization check harus dekat dengan business operation.

```java
public interface CaseAuthorizationService {
    void requireCanView(SecuritySubject subject, CaseId caseId);
    void requireCanUpdate(SecuritySubject subject, CaseId caseId, CaseUpdate update);
    void requireCanTransition(SecuritySubject subject, CaseId caseId, CaseTransition transition);
    void requireCanApprove(SecuritySubject subject, CaseId caseId, ApprovalCommand command);
}
```

Jangan hanya menaruh annotation di controller jika operasi bisa dipanggil dari:

1. REST endpoint;
2. batch job;
3. message consumer;
4. internal service;
5. admin action;
6. retry processor.

Rule:

> Authorization harus menjadi domain/application service concern, bukan hanya transport concern.

---

## 9. Workflow Integrity Design

Regulatory system biasanya lifecycle-heavy.

Contoh state:

```text
DRAFT
 -> SUBMITTED
 -> SCREENING
 -> UNDER_REVIEW
 -> PENDING_INFORMATION
 -> RECOMMENDED
 -> APPROVED
 -> REJECTED
 -> APPEALED
 -> CLOSED
```

### 9.1 Transition Function

Jangan update state langsung:

```sql
UPDATE case SET status = 'APPROVED' WHERE id = ?
```

Gunakan transition function:

```java
public Case transition(
    SecuritySubject actor,
    CaseId caseId,
    CaseTransition transition,
    TransitionReason reason,
    IdempotencyKey idempotencyKey
) {
    Case current = repository.getForUpdate(caseId);

    authorization.requireCanTransition(actor, caseId, transition);
    transitionPolicy.requireAllowed(current.status(), transition, actor, reason);
    separationOfDuties.requireSatisfied(current, actor, transition);

    Case updated = current.apply(transition, reason, clock.instant());
    repository.save(updated);

    audit.record(CaseAuditEvent.transitioned(actor, current, updated, reason));
    outbox.add(CaseEvent.transitioned(updated));

    return updated;
}
```

Security properties:

1. authorization checked;
2. legal transition checked;
3. maker-checker checked;
4. locked row/optimistic version prevents race;
5. audit emitted inside transaction;
6. outbox ensures event consistency;
7. idempotency prevents duplicate transition.

### 9.2 State Machine Invariants

| Invariant | Failure if missing |
|---|---|
| Cannot approve without required review | Premature decision |
| Cannot close with pending appeal | Legal/process violation |
| Cannot self-approve high-risk case | Separation of duties failure |
| Cannot edit final decision silently | Audit/legal defensibility failure |
| Cannot skip payment/fee verification if required | Financial/control failure |

---

## 10. Case Record Integrity

### 10.1 Versioned Case Aggregate

For critical aggregate, use explicit version.

```text
CASE
- id
- status
- version
- riskLevel
- assignedOfficer
- createdAt
- updatedAt

CASE_REVISION
- caseId
- revisionNo
- changedBy
- changedAt
- changeReason
- canonicalBeforeHash
- canonicalAfterHash
```

This enables:

1. optimistic locking;
2. change traceability;
3. tamper detection if combined with digest/hash chain;
4. reconstruction of historical state;
5. approval based on exact version.

### 10.2 Approval Must Bind to Version

Bad:

```text
Supervisor approved case 123
```

Better:

```text
Supervisor approved case 123 at version 17 with decision package hash H
```

Why?

If case content changes after review but before approval, approval becomes ambiguous.

Design:

```text
DecisionPackage
- caseId
- caseVersion
- evidenceManifestHash
- recommendationHash
- policySnapshotVersion
- generatedAt
```

Approval signs or records decision against this package.

Invariant:

> Approval is approval of a specific decision package, not a vague approval of mutable case ID.

---

## 11. Evidence File Integrity

### 11.1 Secure Intake Pipeline

```text
Upload received
  -> store in quarantine/staging
  -> assign random internal object ID
  -> enforce size/type limits
  -> compute SHA-256/SHA-512 digest
  -> archive/path traversal validation if archive
  -> malware scanning
  -> content metadata extraction in sandbox
  -> create evidence record
  -> immutable/object-versioned storage
  -> emit evidence accepted/rejected event
```

### 11.2 Evidence Object Model

```text
EVIDENCE
- evidenceId
- caseId
- originalFilename
- normalizedMediaType
- sizeBytes
- digestAlgorithm
- digestValue
- storageObjectId
- storageVersionId
- uploadedBy
- uploadedAt
- scanStatus
- evidenceStatus

EVIDENCE_CHAIN_EVENT
- evidenceId
- eventType
- actor
- timestamp
- detailsHash
- previousEventHash
- eventHash
```

### 11.3 Why Digest Alone Is Not Enough

A digest tells you whether bytes changed. It does not tell you:

1. who uploaded it;
2. whether upload was authorized;
3. whether it belongs to this case;
4. whether it was accepted or rejected;
5. whether malware scan passed;
6. whether metadata was tampered;
7. whether the digest itself was modified in DB.

Therefore evidence integrity needs:

1. object digest;
2. metadata integrity;
3. chain-of-custody event;
4. authorization;
5. immutable/versioned storage;
6. audit trail;
7. export manifest.

### 11.4 Evidence Export Manifest

When exporting case package:

```json
{
  "manifestVersion": 1,
  "caseId": "CASE-2026-000123",
  "caseVersion": 17,
  "generatedAt": "2026-06-16T00:00:00Z",
  "generatedBy": "user-123",
  "files": [
    {
      "evidenceId": "EV-001",
      "filename": "photo.jpg",
      "digestAlgorithm": "SHA-256",
      "digest": "...",
      "sizeBytes": 123456
    }
  ],
  "manifestDigestAlgorithm": "SHA-256",
  "signature": "optional-base64-signature"
}
```

Signing the manifest can provide stronger authenticity if the package will be used outside the system.

---

## 12. Audit Trail Integrity

### 12.1 Audit Event Model

```json
{
  "eventId": "uuid",
  "eventType": "CASE_TRANSITIONED",
  "actorType": "INTERNAL_OFFICER",
  "actorId": "officer-123",
  "effectiveActorId": null,
  "targetType": "CASE",
  "targetId": "CASE-2026-000123",
  "action": "APPROVE",
  "result": "SUCCESS",
  "timestamp": "2026-06-16T00:00:00Z",
  "sourceIp": "...",
  "userAgentHash": "...",
  "correlationId": "...",
  "requestId": "...",
  "businessReasonHash": "...",
  "previousAuditHash": "...",
  "eventHash": "..."
}
```

### 12.2 Hash Chain Pattern

For each partitioned audit stream:

```text
H0 = stream genesis hash
Hn = SHA-256(canonical(event_n_without_eventHash) || Hn-1)
```

Benefits:

1. detecting deletion in the middle;
2. detecting modification;
3. strengthening tamper evidence;
4. enabling periodic anchoring.

Limitations:

1. if attacker can rewrite entire chain and all anchors, detection fails;
2. chain integrity does not prove business correctness;
3. canonicalization must be stable;
4. concurrency requires careful stream partitioning.

### 12.3 Audit Stream Partitioning

Avoid one global chain if throughput is high. Possible streams:

1. per case;
2. per module;
3. per day + module;
4. per tenant/agency;
5. per critical entity.

Per-case hash chain is often useful for case management because investigation reconstruction is case-centric.

### 12.4 Audit Completeness

Integrity without completeness is weak.

Bad:

```text
Audit records that exist are not modified.
```

Better:

```text
Every high-value action must produce an audit event in the same transaction or through a durable outbox path.
```

---

## 13. Service-to-Service and Event Integrity

### 13.1 Command vs Event

Command:

```text
Please do X
```

Event:

```text
X happened
```

Security difference:

1. command needs authorization of requester;
2. event needs authenticity of producer;
3. both may need replay protection;
4. both need schema validation;
5. both need idempotency handling.

### 13.2 Internal Command Envelope

```json
{
  "envelopeVersion": 1,
  "commandId": "uuid",
  "commandType": "GENERATE_NOTICE",
  "issuerService": "case-service",
  "subject": {
    "type": "INTERNAL_OFFICER",
    "id": "officer-123"
  },
  "issuedAt": "2026-06-16T00:00:00Z",
  "expiresAt": "2026-06-16T00:05:00Z",
  "idempotencyKey": "...",
  "payloadHash": "...",
  "payload": {
    "caseId": "CASE-2026-000123"
  },
  "signatureOrMac": "optional-for-high-value-boundary"
}
```

### 13.3 Replay Protection

Replay-safe command processing requires:

1. command ID uniqueness;
2. expiry;
3. issuer validation;
4. idempotency table;
5. payload hash binding;
6. subject binding;
7. rejection of stale command.

### 13.4 Outbox Integrity

When service updates DB and emits event:

```text
BEGIN TRANSACTION
  update case state
  insert audit event
  insert outbox event
COMMIT

async publisher reads outbox and publishes
consumer deduplicates eventId
```

This protects against:

1. DB update without event;
2. event without DB update;
3. duplicate publish;
4. crash between update and publish.

It does not automatically protect against:

1. malicious event consumer;
2. unauthorized data exposure in event payload;
3. schema confusion;
4. stale event processing.

---

## 14. Cryptographic Architecture

### 14.1 Key Categories

| Key | Purpose | Owner | Rotation pressure |
|---|---|---|---|
| TLS private key | Transport authentication | Infra/platform | Certificate lifecycle |
| Token signing key | JWT/JWS signing | Identity platform | Medium/high |
| Data encryption key | Encrypt sensitive fields/files | App/KMS | Medium |
| Key encryption key | Wrap DEK | KMS/HSM | Managed |
| MAC key | Internal request integrity | Service/security platform | Medium |
| Artifact signing key | Release integrity | CI/security | High protection |
| Audit signing key | Audit/event authenticity | Security/compliance | High protection |

### 14.2 Envelope Encryption

Use pattern:

```text
plaintext
  -> generate DEK
  -> encrypt plaintext with DEK using AEAD
  -> encrypt/wrap DEK with KMS KEK
  -> store ciphertext + encrypted DEK + key version + nonce + tag + AAD context
```

AAD should bind context:

```text
caseId | fieldName | recordVersion | purpose | tenant/agency
```

So ciphertext cannot be silently moved to another context.

### 14.3 Crypto Payload Format

Never store raw ciphertext only.

```json
{
  "formatVersion": 1,
  "algorithm": "AES-256-GCM",
  "keyId": "kms-key-alias/case-data-v3",
  "encryptedDek": "...",
  "nonce": "...",
  "aad": "caseId=...;field=...;version=...",
  "ciphertext": "...",
  "tag": "..."
}
```

Why versioned format matters:

1. rotation;
2. algorithm migration;
3. key migration;
4. backward compatibility;
5. incident response.

### 14.4 Key Rotation Model

Types:

1. **cryptographic rotation** — new encryption/signing key;
2. **credential rotation** — DB/API secret changes;
3. **certificate rotation** — TLS/mTLS cert renewal;
4. **emergency rotation** — suspected compromise;
5. **algorithm migration** — primitive deprecated.

For encryption:

```text
new writes use new key
old reads support old key
background re-encryption optional
retire old key only after no active ciphertext depends on it
```

For signing:

```text
new signatures use new key
verification accepts old key until old signatures expire or archival verification model exists
```

For token signing:

```text
publish new JWKS key
start signing with new key after propagation
continue verifying old key until all old tokens expire
remove old key
```

---

## 15. Database Integrity Design

### 15.1 Privilege Separation

Avoid one mega DB user.

Possible split:

| DB principal | Permission |
|---|---|
| app_case_rw | case tables read/write only |
| app_audit_append | insert audit only, no update/delete |
| app_report_ro | read reporting views only |
| app_migration | DDL, only in deployment window |
| app_job_rw | specific batch tables |

### 15.2 Critical Table Controls

For critical tables:

1. optimistic locking/version column;
2. created/updated metadata;
3. revision/history table;
4. audit event emission;
5. database constraint for invariant where possible;
6. restricted update/delete privilege;
7. periodic integrity reconciliation.

### 15.3 Reconciliation Jobs

Examples:

1. evidence digest in DB matches object metadata;
2. evidence object exists for active evidence record;
3. case current status matches latest state transition event;
4. audit chain verifies;
5. outbox has no stuck critical events;
6. high-value actions have corresponding audit records;
7. case approval references existing decision package hash.

Reconciliation is not a substitute for prevention, but it detects silent drift.

---

## 16. Search, Cache, and Reporting Integrity

### 16.1 Search Index

Search index is derived, not authoritative.

Rules:

1. never authorize only from search index result;
2. re-check object authorization before opening record;
3. index only necessary fields;
4. handle stale index explicitly;
5. do not expose hidden fields via search snippets;
6. include index rebuild procedure.

### 16.2 Cache

Cache risks:

1. stale authorization;
2. cross-user data leak;
3. poisoned cache;
4. token/session cache inconsistency;
5. sensitive value exposed in memory.

Rules:

1. cache by subject/scope when data is authorization-sensitive;
2. short TTL for policy-affecting data;
3. invalidate on role/scope changes;
4. avoid caching secrets unless necessary;
5. encrypt or isolate highly sensitive cached values if threat model requires.

### 16.3 Reports and Exports

Reports become records.

Controls:

1. report generation authorization;
2. report parameter audit;
3. export watermark/classification;
4. PII minimization;
5. digest/signature for official exports;
6. retention policy;
7. no formula injection in CSV exports;
8. secure temporary file handling.

---

## 17. Secure File and Document Flow

### 17.1 Document Generation

Official document generation should bind to:

1. template version;
2. case version;
3. decision package hash;
4. generated by;
5. generated time;
6. output digest.

```text
GeneratedDocument
- documentId
- caseId
- caseVersion
- templateId
- templateVersion
- inputPackageHash
- outputDigest
- generatedBy
- generatedAt
```

### 17.2 Template Integrity

Template changes are security-relevant if templates produce official notices/orders.

Controls:

1. template versioning;
2. approval workflow;
3. change audit;
4. template variable allowlist;
5. no arbitrary expression execution;
6. output comparison for high-risk templates.

---

## 18. Integration Security

### 18.1 External API Calls

For outbound integration:

1. validate TLS certificate and hostname;
2. use mTLS/client credential if required;
3. store external credential in secrets manager;
4. apply timeout/retry/circuit breaker;
5. canonicalize and validate response;
6. log correlation ID, not secret;
7. protect against replay where callback involved;
8. verify signature/MAC if provider supports it.

### 18.2 Callback/Webhook Intake

For inbound callback:

1. authenticate source;
2. verify HMAC/signature;
3. verify timestamp freshness;
4. deduplicate event ID;
5. validate payload schema;
6. bind callback to known transaction;
7. avoid trusting status change blindly;
8. audit accepted/rejected callback.

### 18.3 File Transfer

For file exchange:

1. channel security: SFTP/mTLS/API;
2. file-level digest manifest;
3. optional detached signature;
4. naming convention not trusted as authority;
5. replay detection;
6. duplicate detection;
7. quarantine before processing;
8. reconciliation report.

---

## 19. Runtime Hardening View

Runtime hardening should support application security invariants.

### 19.1 JVM

1. keep JDK patched;
2. manage disabled algorithms intentionally;
3. restrict JMX;
4. protect heap dumps/thread dumps;
5. avoid diagnostic endpoints exposed publicly;
6. set TLS protocols/ciphers according to policy;
7. monitor certificate expiry;
8. avoid verbose security debug in production logs unless controlled.

### 19.2 Container/Kubernetes

1. run as non-root;
2. read-only filesystem where possible;
3. drop Linux capabilities;
4. restrict egress;
5. use network policy;
6. separate service accounts;
7. use workload identity where possible;
8. avoid mounting broad secrets;
9. protect metadata service access;
10. deploy admission/policy checks.

### 19.3 Observability Security

1. logs must not contain secrets;
2. metrics must not expose tenant/user-specific sensitive data;
3. traces must redact tokens/PII;
4. correlation ID must not become authentication token;
5. alert on impossible state transitions;
6. alert on audit chain break;
7. alert on abnormal privilege use;
8. alert on mass export/download.

---

## 20. Secure Build and Release Integrity

### 20.1 Build Pipeline Invariant

```text
source commit
 -> controlled build environment
 -> dependency verification
 -> tests/security scans
 -> SBOM
 -> signed artifact/image
 -> provenance
 -> environment approval
 -> deployment verification
```

### 20.2 Minimum Controls

1. branch protection;
2. mandatory review;
3. dependency lock/verification;
4. SCA;
5. secret scanning;
6. SAST for high-risk patterns;
7. test suite;
8. SBOM generation;
9. artifact signing;
10. deployment approval for production.

### 20.3 Production Verification

At runtime or deploy time, record:

1. artifact digest;
2. source commit;
3. build ID;
4. SBOM ID;
5. signer identity;
6. deployment actor;
7. environment;
8. timestamp.

This supports incident response.

---

## 21. Security Testing Strategy

### 21.1 Test Pyramid for Security

```text
Manual adversarial review
Threat model review
DAST / integration security tests
Property-based / fuzz tests
Security unit tests
Static rules / SCA / secret scan
```

### 21.2 Security Unit Tests

Examples:

1. unauthorized user cannot view case;
2. maker cannot approve own recommendation;
3. invalid state transition rejected;
4. expired token rejected;
5. wrong audience token rejected;
6. file path traversal rejected;
7. duplicate idempotency key does not double-apply command;
8. audit event emitted for high-value action;
9. evidence digest mismatch detected;
10. CSV formula injection neutralized.

### 21.3 Property Tests

Workflow property:

```text
For all generated transition sequences,
case must never reach APPROVED unless required review exists.
```

Authorization property:

```text
For all users outside assigned scope,
case detail access must be denied.
```

Evidence property:

```text
For all file byte modifications,
stored digest verification must fail.
```

### 21.4 Fuzzing Targets

1. file upload metadata parser;
2. archive extraction;
3. XML parser;
4. JSON schema boundary;
5. search query parser;
6. CSV import;
7. integration payload parser;
8. template input.

---

## 22. Incident Response Scenarios

### 22.1 Token Signing Key Compromise

Immediate actions:

1. revoke/disable compromised key;
2. publish new signing key;
3. invalidate active sessions/tokens if needed;
4. check logs for suspicious token use;
5. rotate related secrets;
6. review JWKS exposure and access path;
7. communicate impact based on evidence.

Design requirement:

> Token validation and key rotation must be operationally possible before incident happens.

### 22.2 Evidence Tampering Suspicion

Actions:

1. freeze affected case/evidence;
2. verify object digest against DB;
3. verify storage version history;
4. verify chain-of-custody events;
5. verify audit hash chain;
6. identify actors/service accounts with access;
7. compare backups/replicas;
8. produce incident evidence report.

Design requirement:

> Evidence integrity must be independently verifiable from multiple sources.

### 22.3 Dependency Critical CVE

Actions:

1. determine affected artifact versions;
2. check exploitability in context;
3. patch/upgrade or mitigate;
4. rebuild signed artifact;
5. redeploy;
6. verify runtime version;
7. record exception if not immediately patchable.

Design requirement:

> SBOM and artifact traceability must answer “where is this dependency running?” quickly.

### 22.4 Audit Chain Break

Actions:

1. classify as integrity incident;
2. identify partition/stream affected;
3. compare primary DB, backup, log sink, object archive;
4. check deployment/admin activity;
5. freeze records if legal impact;
6. reconstruct chain from trusted source if possible;
7. document confidence and gap.

Design requirement:

> Audit integrity checks must run continuously, not only after dispute.

---

## 23. End-to-End Example: Approving a High-Risk Case

### 23.1 Flow

```text
Officer opens case
  -> token validated
  -> object authorization checked
  -> case version loaded
  -> evidence manifest verified if needed
  -> officer submits recommendation
  -> audit event recorded
  -> supervisor opens decision package
  -> package hash computed
  -> supervisor approval checks SoD + scope + version
  -> state transition happens in transaction
  -> audit event + outbox event inserted
  -> notification/document generation triggered
  -> generated document digest stored
```

### 23.2 Security Checks

| Step | Check |
|---|---|
| Open case | BOLA prevention, scope check |
| Submit recommendation | workflow permission, version check |
| Evidence review | digest/manifest verification |
| Approval | maker-checker, role, object scope, package hash |
| State update | allowed transition only |
| Audit | actor/action/target/result/correlation |
| Event | outbox, idempotency, consumer auth |
| Document | template version, output digest |

### 23.3 Failure Cases

| Failure | Expected behavior |
|---|---|
| Case version changed after recommendation | Approval requires re-review or explicit confirmation |
| Evidence digest mismatch | Block decision and create incident/exception |
| Supervisor is maker | Reject approval |
| Token expired | Re-authenticate |
| Duplicate approval request | Idempotent response, no double transition |
| Audit insert fails | Transaction fails or durable failure path triggers |
| Notification fails | Case decision remains, notification retry via outbox |

---

## 24. Architecture Decision Records

For security-sensitive decisions, write ADRs.

### 24.1 ADR Template

```markdown
# ADR: <Title>

## Context
What asset, threat, and business requirement does this address?

## Decision
What design/control are we adopting?

## Security Properties
- Confidentiality:
- Integrity:
- Authenticity:
- Availability:
- Auditability:

## Alternatives Considered
1.
2.
3.

## Failure Modes
1.
2.
3.

## Operational Requirements
- rotation:
- monitoring:
- incident response:
- testing:

## Residual Risk
What remains risky after the decision?

## Evidence
Links to threat model, tests, diagrams, references.
```

### 24.2 ADRs This Platform Should Have

1. Token validation and identity mapping.
2. Object-level authorization model.
3. Workflow state machine integrity.
4. Evidence storage and digest model.
5. Audit trail hash chain/signature model.
6. Key management and KMS/HSM use.
7. TLS/mTLS/service identity model.
8. File upload and archive extraction policy.
9. CI/CD artifact signing and provenance.
10. Incident response for key compromise.

---

## 25. Security Review Checklist

### 25.1 Design Review

Ask:

1. What are the assets?
2. Who are the actors?
3. Where are the trust boundaries?
4. What can go wrong?
5. What must never happen?
6. Which controls prevent it?
7. Which controls detect it?
8. Which controls recover from it?
9. What is the residual risk?
10. What evidence proves the control works?

### 25.2 Code Review

Look for:

1. direct object access without authorization;
2. state update without transition validation;
3. file path derived from user input;
4. XML parser without secure settings;
5. JWT decode without full validation;
6. `Cipher` with unsafe mode/default transformation;
7. nonce/IV reuse risk;
8. secret in config/log/exception;
9. missing audit for high-value action;
10. async consumer trusting message blindly.

### 25.3 Operational Review

Check:

1. Can keys rotate without code rewrite?
2. Can cert expiry be detected before outage?
3. Can dependency CVE impact be located quickly?
4. Can audit tampering be detected?
5. Can production artifact be traced to commit?
6. Can support/admin actions be audited?
7. Can evidence integrity be verified offline?
8. Can incident responders revoke tokens quickly?
9. Are logs useful but not leaking secrets?
10. Are backups protected and restorable?

---

## 26. Common Anti-Patterns in Regulatory Java Systems

### 26.1 “Internal Network Is Trusted”

Problem:

```text
Requests from internal subnet bypass authorization.
```

Why dangerous:

1. compromised pod/service can move laterally;
2. SSRF can reach internal endpoint;
3. misconfigured gateway exposes internal path;
4. service identity is lost.

Better:

```text
Every service call has authenticated caller identity and scoped authorization.
```

### 26.2 “Audit Is Just Logging”

Problem:

```text
log.info("case approved")
```

Why dangerous:

1. log may be incomplete;
2. log format unstable;
3. log may not bind target/version;
4. log may be deleted;
5. legal reconstruction weak.

Better:

```text
Structured audit event with actor/action/target/result/version/correlation and integrity control.
```

### 26.3 “Encrypt Everything With One Key”

Problem:

1. no key separation;
2. huge blast radius;
3. impossible rotation;
4. unclear usage policy.

Better:

1. key hierarchy;
2. purpose-specific keys;
3. KMS/HSM;
4. key versioning;
5. envelope encryption.

### 26.4 “Frontend Hides Unauthorized Button”

Problem:

Frontend hiding is UX, not security.

Better:

Backend authorization enforces object/action/context policy.

### 26.5 “Evidence File Name Is Identity”

Problem:

Filename can collide, lie, change encoding, or be malicious.

Better:

Evidence identity is internal ID + digest + storage version + metadata.

### 26.6 “JWT Valid Means Access Granted”

Problem:

JWT validation only authenticates token claims.

Better:

JWT valid -> subject known -> object authorization still required.

### 26.7 “Security Scanner Passed, Therefore Secure”

Problem:

Scanner finds known classes of issues, not business logic violations.

Better:

Combine SAST/SCA/DAST with threat modeling, code review, tests, and operational controls.

---

## 27. Minimum Viable Secure Architecture

If time is limited, prioritize these controls first:

1. object-level authorization for case/evidence/document;
2. workflow transition guard;
3. secure token validation;
4. password/session/SSO hardening;
5. evidence digest + immutable/versioned storage;
6. structured audit trail for high-value action;
7. parameterized DB access and input validation;
8. secure file upload handling;
9. secrets manager + no hardcoded secrets;
10. dependency scanning + artifact traceability;
11. TLS hardening and cert expiry monitoring;
12. incident-ready key/token rotation.

This is not complete security, but it protects the core invariants.

---

## 28. Mature Secure Architecture

A mature version adds:

1. audit hash chain or signing;
2. case decision package hash;
3. evidence export signed manifest;
4. mTLS/workload identity service-to-service;
5. event/command integrity envelope for high-value flows;
6. KMS/HSM-backed keys;
7. SBOM + signed artifact + provenance;
8. policy-as-code for runtime/deployment;
9. fuzzing/property-based security tests;
10. continuous reconciliation jobs;
11. privileged admin action approval;
12. automated incident playbooks.

---

## 29. Final Mental Model

A top-level Java security engineer does not think like this:

```text
Use AES.
Use HTTPS.
Use JWT.
Use SAST.
Use KeyStore.
```

They think like this:

```text
What is the asset?
Who can influence it?
Where does trust change?
What must never be false?
What proves the actor, action, target, time, and content?
What happens if this key/token/file/service/database/operator is compromised?
Can we detect tampering?
Can we rotate and recover?
Can we explain the decision months later under audit?
```

Security is therefore not a bag of controls. It is a set of **preserved invariants under hostile conditions**.

---

## 30. Practical Capstone Assignment

To complete this series, take one real or hypothetical Java regulatory module and produce these artifacts:

1. asset inventory;
2. trust boundary diagram;
3. threat model;
4. security invariants;
5. authorization matrix;
6. workflow state transition table;
7. evidence integrity design;
8. audit event schema;
9. key management plan;
10. incident response playbook;
11. security test plan;
12. ADR for one high-risk decision.

If you can produce these clearly, you are no longer just “using security libraries”; you are engineering a defensible security architecture.

---

## 31. References

Primary references used across this capstone:

1. OWASP Application Security Verification Standard: https://owasp.org/www-project-application-security-verification-standard/
2. OWASP Secure by Design Framework: https://owasp.org/www-project-secure-by-design-framework/
3. OWASP Threat Modeling Project: https://owasp.org/www-project-threat-modeling/
4. OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
5. NIST SP 800-218 Secure Software Development Framework: https://csrc.nist.gov/pubs/sp/800/218/final
6. NIST SP 800-204 Security Strategies for Microservices-based Application Systems: https://csrc.nist.gov/pubs/sp/800/204/final
7. NIST SP 800-204C Implementation of DevSecOps for a Microservices-based Application: https://csrc.nist.gov/pubs/sp/800/204/c/final
8. NIST SP 800-57 Key Management: https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
9. NIST SP 800-61 Computer Security Incident Handling Guide: https://csrc.nist.gov/pubs/sp/800/61/r3/final
10. Oracle Java Security Documentation: https://docs.oracle.com/en/java/javase/
11. Oracle Java Cryptography Architecture Reference Guide: https://docs.oracle.com/en/java/javase/26/security/java-cryptography-architecture-jca-reference-guide.html
12. Oracle JSSE Reference Guide: https://docs.oracle.com/en/java/javase/24/security/java-secure-socket-extension-jsse-reference-guide.html
13. RFC 7519 JSON Web Token: https://datatracker.ietf.org/doc/html/rfc7519
14. RFC 8725 JWT Best Current Practices: https://datatracker.ietf.org/doc/html/rfc8725
15. RFC 9700 OAuth 2.0 Security Best Current Practice: https://datatracker.ietf.org/doc/html/rfc9700

---

## 32. Ringkasan

Dalam capstone ini, kita menyatukan Java Security, Cryptography, dan Integrity ke dalam satu rancangan platform regulatory case management.

Poin paling penting:

1. Security dimulai dari asset, actor, trust boundary, dan invariant.
2. Cryptography hanya berguna jika guarantee-nya sesuai threat model.
3. Authorization harus object/action/context-aware.
4. Workflow state harus dijaga dengan transition function.
5. Evidence integrity membutuhkan digest, metadata, storage version, audit, dan chain of custody.
6. Audit trail harus structured, complete, dan tamper-evident untuk high-value action.
7. Service-to-service trust harus explicit, bukan berbasis “internal network”.
8. Key management adalah lifecycle, bukan hanya penyimpanan byte array.
9. Supply chain dan CI/CD adalah bagian dari integrity architecture.
10. Incident response harus didesain sebelum incident terjadi.

---

# Status Seri

Seri **`learn-java-security-cryptography-integrity` selesai**.

Total:

```text
Part 0  - Security Mental Model for Senior Java Engineers
Part 1  - Java Security Architecture
Part 2  - Threat Modeling for Java Systems
Part 3  - Cryptography Mental Model
Part 4  - Randomness, Entropy, Nonce, Salt, IV, Token
Part 5  - Hashing, Digest, Fingerprint, Checksum, Integrity Boundaries
Part 6  - Password Storage and Secret-Derived Keys
Part 7  - Symmetric Encryption in Java
Part 8  - Message Authentication Code
Part 9  - Digital Signature
Part 10 - Asymmetric Encryption and Key Agreement
Part 11 - Key Management
Part 12 - Java KeyStore, TrustStore, Certificates
Part 13 - X.509, PKI, Certificate Path Validation
Part 14 - TLS/JSSE Deep Dive
Part 15 - TLS Hardening and Security Properties
Part 16 - Secure Serialization and Deserialization
Part 17 - Secure File, Archive, and Data Transfer Integrity
Part 18 - XML Security
Part 19 - JSON, JWT, JWS, JWE, JOSE
Part 20 - OAuth2/OIDC Security
Part 21 - Authorization Integrity
Part 22 - Input Validation and Injection Resistance
Part 23 - Secure Coding in Java
Part 24 - Secrets Management
Part 25 - Secure Logging and Audit Trail Integrity
Part 26 - Data Integrity in Distributed Java Systems
Part 27 - Supply Chain Security for Java
Part 28 - Signed JARs and Runtime Trust
Part 29 - Secure Build, CI/CD, Release Integrity
Part 30 - Runtime Hardening
Part 31 - Security Testing
Part 32 - Incident Response
Part 33 - Secure Design Patterns and Anti-Patterns
Part 34 - Capstone Regulatory Case Management Platform
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-security-cryptography-integrity-part-033.md">⬅️ Secure Design Patterns and Anti-Patterns for Java Enterprise Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
