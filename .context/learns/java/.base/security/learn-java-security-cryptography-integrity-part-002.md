# learn-java-security-cryptography-integrity-part-002

# Part 2 — Threat Modeling for Java Systems

> Seri: `learn-java-security-cryptography-integrity`  
> Posisi: Part 2 dari 35  
> Status seri: belum selesai  
> Fokus: cara membangun threat model yang benar-benar bisa dipakai engineer Java untuk desain, review, testing, dan operasi production.

---

## 0. Tujuan Part Ini

Part ini membahas **threat modeling** sebagai teknik berpikir untuk memahami ancaman, trust boundary, abuse case, kelemahan desain, dan kontrol keamanan sebelum sistem telanjur dibangun.

Setelah menyelesaikan bagian ini, kamu diharapkan bisa:

1. Membaca sistem Java dari sudut pandang attacker, bukan hanya dari sudut pandang developer.
2. Mengubah requirement security yang abstrak menjadi threat, invariant, control, test, dan operational guardrail.
3. Membuat threat model untuk REST API, async worker, file ingestion, scheduler, internal admin UI, service-to-service call, dan distributed workflow.
4. Membedakan asset, actor, trust boundary, entry point, data flow, security property, threat, vulnerability, exploit, mitigation, dan residual risk.
5. Menggunakan STRIDE, attack tree, abuse case, data-centric threat modeling, dan risk register secara praktis.
6. Menghasilkan output threat modeling yang berguna untuk architecture decision, PR review, security testing, audit, dan incident response.

Threat modeling bukan ritual dokumentasi. Threat modeling adalah cara agar engineer tidak membangun sistem dengan asumsi diam-diam seperti:

- “request ini pasti dari service internal”;
- “user tidak akan mengganti `caseId` di payload”;
- “message broker sudah trusted”;
- “file ini pasti hasil export dari sistem kita sendiri”;
- “token sudah divalidasi di gateway”;
- “kalau API return 200 berarti aman”;
- “karena database transaction commit, berarti bisnis invariant aman”.

Dalam sistem serius, asumsi seperti itu sering menjadi akar vulnerability.

---

## 1. Core Mental Model: Threat Modeling Adalah Security Design Debugging

Kalau unit test mencari bug pada function, threat modeling mencari bug pada **asumsi desain**.

Threat modeling bertanya:

```text
Apa yang kita lindungi?
Dari siapa?
Lewat jalur mana?
Dengan asumsi trust apa?
Apa yang terjadi kalau asumsi itu salah?
Kontrol apa yang menutup threat itu?
Bagaimana kita tahu kontrol itu benar-benar bekerja?
Apa risiko yang masih tersisa?
```

Threat modeling yang baik selalu menghasilkan keputusan engineering, bukan hanya diagram.

Contoh output yang berguna:

- endpoint tertentu wajib object-level authorization;
- event tertentu wajib idempotency key dan replay window;
- file upload wajib content validation, AV scan, size limit, hash manifest, dan quarantine state;
- service-to-service call wajib mTLS atau signed request;
- background job tidak boleh memproses data tenant tanpa explicit tenant scope;
- audit event harus immutable dan punya tamper-evident chain;
- token verification harus dilakukan ulang di service boundary, bukan hanya di API gateway;
- secret tidak boleh masuk log, metric label, exception message, heap dump, atau thread dump;
- key rotation harus punya versioned payload format.

OWASP mendeskripsikan threat modeling sebagai proses untuk mengidentifikasi, mengomunikasikan, dan memahami threats serta mitigations dalam konteks melindungi sesuatu yang bernilai. NIST SP 800-154 juga memosisikan threat modeling sebagai bentuk risk assessment yang memodelkan sisi attack dan defense terhadap logical entity seperti data, aplikasi, host, sistem, atau environment.

---

## 2. Vocabulary yang Harus Presisi

Security sering kacau karena istilahnya dipakai longgar. Dalam threat modeling, vocabulary harus tajam.

### 2.1 Asset

**Asset** adalah sesuatu yang perlu dilindungi.

Contoh di Java enterprise system:

- identity record;
- access token;
- refresh token;
- session cookie;
- case record;
- evidence document;
- audit trail;
- signing key;
- encryption key;
- database credential;
- uploaded file;
- generated report;
- workflow state;
- approval decision;
- notification recipient list;
- user role mapping;
- tenant boundary;
- integration payload;
- scheduler execution privilege.

Asset tidak selalu data. Asset bisa berupa **authority**, **decision**, **workflow transition**, atau **trust relationship**.

Contoh:

```text
Bukan hanya "case data" yang asset.
Hak untuk mengubah status case dari UNDER_REVIEW ke APPROVED juga asset.
```

### 2.2 Actor

**Actor** adalah entitas yang berinteraksi dengan sistem.

Jenis actor:

| Actor | Contoh | Catatan Security |
|---|---|---|
| Human user | officer, admin, applicant | bisa legitimate tapi malicious/compromised |
| External system | payment gateway, government registry, identity provider | perlu authenticity dan contract validation |
| Internal service | case-service, document-service, notification-service | internal tidak otomatis trusted |
| Background process | scheduler, batch worker, migration job | sering punya privilege besar |
| Operator | DevOps, DBA, support | perlu audit dan least privilege |
| Attacker | internet attacker, insider, compromised service | tidak selalu punya akun |
| Dependency | library, plugin, agent | supply-chain actor implisit |

Actor bukan hanya “role”. Actor adalah entitas dengan capability.

### 2.3 Entry Point

**Entry point** adalah titik masuk interaksi.

Contoh:

- REST endpoint;
- GraphQL endpoint;
- message queue consumer;
- file upload;
- SFTP drop folder;
- webhook callback;
- scheduled job trigger;
- admin console;
- database migration script;
- JMX port;
- actuator endpoint;
- OAuth redirect URI;
- callback URL;
- report download URL;
- serialized payload;
- CI/CD pipeline input;
- dependency repository;
- Kubernetes secret mount.

Banyak threat model gagal karena hanya melihat HTTP API, padahal entry point paling berbahaya sering ada di async worker, admin function, file import, migration script, atau operational endpoint.

### 2.4 Trust Boundary

**Trust boundary** adalah garis di mana level trust berubah.

Contoh:

```text
Browser -> API Gateway
API Gateway -> Java service
Java service -> database
Java service -> message broker
Message broker -> async worker
Java service -> external API
CI/CD -> artifact repository
Kubernetes secret -> application memory
```

Setiap crossing trust boundary harus menjawab:

1. Siapa pengirimnya?
2. Bagaimana authenticity diverifikasi?
3. Apakah payload masih utuh?
4. Apakah payload fresh atau replay?
5. Apakah caller punya authority?
6. Apakah data sudah dicanonicalize?
7. Apakah error behavior aman?
8. Apakah observability tidak membocorkan secret/PII?

### 2.5 Threat

**Threat** adalah kemungkinan hal buruk terjadi terhadap asset.

Contoh:

- user membaca case milik user lain;
- officer melakukan approval tanpa privilege;
- attacker mengganti amount di callback;
- worker memproses event replay;
- file upload menulis ke path di luar directory;
- audit log diubah setelah incident;
- token signature tidak diverifikasi benar;
- service menerima message palsu dari broker;
- secret bocor lewat log;
- dependency berbahaya masuk build.

Threat bukan vulnerability. Threat adalah skenario bahaya. Vulnerability adalah kelemahan yang memungkinkan threat terjadi.

### 2.6 Vulnerability

**Vulnerability** adalah kelemahan desain, implementasi, konfigurasi, atau operasi.

Contoh:

```text
Threat:
User bisa membaca dokumen case milik user lain.

Vulnerability:
Endpoint /documents/{documentId} hanya memeriksa authenticated user,
tetapi tidak memeriksa apakah documentId terkait dengan case yang boleh diakses user.
```

### 2.7 Exploit

**Exploit** adalah cara konkret memanfaatkan vulnerability.

Contoh:

```http
GET /documents/910002
Authorization: Bearer token-of-normal-user
```

Jika service hanya memvalidasi login dan tidak object ownership, attacker bisa enumerate `documentId`.

### 2.8 Mitigation / Control

**Mitigation** adalah kontrol untuk menurunkan likelihood atau impact threat.

Jenis kontrol:

| Control Type | Contoh |
|---|---|
| Preventive | authorization check, input validation, mTLS, CSRF token |
| Detective | audit log, anomaly detection, alert |
| Corrective | token revocation, key rotation, restore backup |
| Compensating | manual review untuk high-risk action |
| Deterrent | legal banner, admin action audit |

Security control yang baik harus bisa diuji.

### 2.9 Residual Risk

**Residual risk** adalah risiko setelah kontrol diterapkan.

Threat modeling dewasa tidak berpura-pura semua risiko hilang. Ia menjelaskan:

```text
Threat: insider admin exports all records.
Control: RBAC, approval workflow, audit log, rate limit, export watermark.
Residual risk: privileged insider with valid approval can still exfiltrate data.
Decision: accepted with quarterly access review and DLP monitoring.
```

---

## 3. Mengapa Java System Butuh Threat Modeling Khusus

Java banyak dipakai untuk sistem enterprise yang:

- long-lived;
- heavily integrated;
- punya banyak role dan permission;
- memakai database besar;
- punya batch dan scheduler;
- menerima file;
- mengirim event;
- memakai identity provider;
- beroperasi di container/cloud;
- punya compliance/audit requirement;
- memakai dependency tree sangat besar.

Karena itu threat model Java tidak cukup dengan “OWASP Top 10”. OWASP Top 10 adalah awareness baseline, bukan model lengkap untuk sistemmu.

Threat modeling Java harus memperhatikan:

1. **Framework magic**  
   Annotation, proxy, interceptor, filter chain, auto-configuration, reflection, serialization, object mapping.

2. **Layered authorization gap**  
   Controller aman, service method tidak aman. Gateway aman, worker tidak aman. UI menyembunyikan button, API tetap menerima command.

3. **Async boundary**  
   Security context hilang saat request berubah menjadi event/job.

4. **Object-level data access**  
   Banyak sistem enterprise gagal bukan karena tidak punya login, tetapi karena object ownership/tenant/role relationship salah.

5. **Cryptography misuse**  
   Salah mode, salah key reuse, salah nonce, salah signature verification, salah token validation.

6. **Operational leakage**  
   Java stack trace, actuator, JMX, heap dump, thread dump, GC log, application log, metric label.

7. **Supply chain**  
   Maven/Gradle transitive dependencies, plugins, annotation processors, build scripts, container base image.

8. **Runtime trust**  
   Container, service account, metadata service, secret mount, DNS, service mesh, TLS truststore.

---

## 4. Empat Pertanyaan Minimum Threat Modeling

Gunakan empat pertanyaan ini untuk semua desain:

```text
1. What are we building?
2. What can go wrong?
3. What are we going to do about it?
4. Did we do a good enough job?
```

Dalam konteks Java system:

### 4.1 What Are We Building?

Harus jelas:

- component;
- actor;
- data flow;
- entry point;
- trust boundary;
- asset;
- state transition;
- external dependency;
- deployment boundary;
- privilege boundary.

Kalau tidak bisa digambar, biasanya belum cukup dipahami.

### 4.2 What Can Go Wrong?

Gunakan beberapa lensa:

- STRIDE;
- abuse case;
- attack tree;
- data-centric model;
- past incidents;
- bug bounty/CVE class;
- operational failure mode;
- malicious insider;
- compromised dependency;
- compromised identity provider;
- replayed event;
- stale cache;
- clock skew;
- partial failure.

### 4.3 What Are We Going To Do About It?

Kontrol harus konkret:

```text
Buruk:
- secure the API
- validate access
- encrypt data

Baik:
- enforce object-level authorization in CaseAccessPolicy.canView(user, caseId)
- verify JWS signature using pinned issuer JWKS and validate iss/aud/exp/nbf
- reject message when idempotency key already processed within replay window
- store evidence SHA-256 digest and verify before download
```

### 4.4 Did We Do a Good Enough Job?

Harus ada bukti:

- unit test;
- integration test;
- negative test;
- property test;
- security regression test;
- log/audit verification;
- monitoring rule;
- code review checklist;
- penetration test finding closure;
- runbook;
- residual risk sign-off.

---

## 5. Security Invariant: Output Paling Penting dari Threat Modeling

Threat model yang baik menghasilkan **security invariant**.

Invariant adalah aturan yang harus selalu benar.

Contoh invariant:

```text
A user must never read a case unless they are assigned to the case,
belong to a permitted unit, or have an explicit delegated permission.
```

```text
A case decision must never transition to APPROVED unless the actor has approval authority,
the case is in REVIEW_COMPLETED state, and all mandatory checks have passed.
```

```text
An uploaded evidence file must never become AVAILABLE until its content hash is recorded,
its storage object is immutable, malware scanning passes, and metadata is bound to the case.
```

```text
An audit record must never be deleted or modified without producing a separate privileged audit event.
```

```text
A service must never trust a userId from request body when an authenticated subject exists.
```

Security invariant lebih kuat daripada “requirement”. Requirement sering ambigu. Invariant bisa dites.

### 5.1 Invariant Template

```text
[Subject] must never [security-sensitive action]
unless [authorization/authenticity/integrity/freshness/state conditions]
and [evidence/audit condition].
```

Contoh:

```text
A background worker must never execute a case-state transition from a queue message
unless the message comes from an authenticated producer,
the message signature is valid,
the event id has not been processed,
the referenced case is in an allowed previous state,
and the transition is recorded in audit trail.
```

### 5.2 Dari Invariant ke Test

Invariant harus berubah menjadi test:

```java
@Test
void cannotApproveCaseWhenUserLacksApprovalPermission() {
    var user = userWithoutPermission();
    var caseId = existingCaseInReviewCompletedState();

    assertThrows(AccessDeniedException.class, () ->
        caseDecisionService.approve(user, caseId, decisionPayload())
    );
}
```

Dan negative test untuk object-level access:

```java
@Test
void cannotReadDocumentFromAnotherCase() {
    var alice = applicantForCase("CASE-A");
    var documentFromCaseB = documentForCase("CASE-B");

    assertThrows(AccessDeniedException.class, () ->
        documentService.download(alice, documentFromCaseB.id())
    );
}
```

Threat modeling tanpa test mudah membusuk.

---

## 6. Diagram Minimum yang Harus Dibuat

Tidak perlu diagram kompleks. Minimal gunakan empat diagram.

### 6.1 Context Diagram

```text
+----------------+        +------------------+        +----------------+
| External User  | -----> | API Gateway / WAF | -----> | Java API       |
+----------------+        +------------------+        +----------------+
                                                           |
                                                           v
                                                     +------------+
                                                     | Database   |
                                                     +------------+

+----------------+        +------------------+        +----------------+
| Identity Prov. | <----> | Java API         | -----> | Message Broker |
+----------------+        +------------------+        +----------------+
                                                           |
                                                           v
                                                     +--------------+
                                                     | Java Worker  |
                                                     +--------------+
```

Purpose:

- siapa berinteraksi dengan siapa;
- komponen besar;
- external dependency;
- trust zone.

### 6.2 Data Flow Diagram

```text
[Browser]
   |
   | HTTPS + Bearer token
   v
[API Gateway]
   |
   | forwarded request + headers
   v
[Case Service]
   |        \
   | SQL     \ publish event
   v          v
[Oracle DB]  [RabbitMQ]
                |
                v
          [Notification Worker]
                |
                v
          [Email Provider]
```

Purpose:

- data bergerak ke mana;
- data berubah bentuk di mana;
- authentication context hilang di mana;
- data disimpan di mana.

### 6.3 Trust Boundary Diagram

```text
             Internet Trust Zone
+------------------------------------------+
| Browser                                  |
+------------------------------------------+
                  |
                  | Boundary: Internet -> Edge
                  v
             Edge Trust Zone
+------------------------------------------+
| API Gateway / WAF / Load Balancer        |
+------------------------------------------+
                  |
                  | Boundary: Edge -> App Runtime
                  v
             App Trust Zone
+------------------------------------------+
| Java Services / Workers                  |
+------------------------------------------+
       |                         |
       | Boundary: App -> Data   | Boundary: App -> External
       v                         v
+-------------+           +-----------------+
| Database    |           | External System |
+-------------+           +-----------------+
```

Purpose:

- semua boundary crossing harus punya control;
- internal boundary tetap perlu explicit trust decision.

### 6.4 State Transition Diagram

Untuk security, state machine sering lebih penting daripada class diagram.

```text
DRAFT
  |
  | submit by applicant
  v
SUBMITTED
  |
  | assign by officer
  v
UNDER_REVIEW
  |
  | complete review by reviewer
  v
REVIEW_COMPLETED
  |
  | approve by approver
  v
APPROVED
```

Untuk setiap transition:

```text
Who can trigger?
From which previous state?
With what validation?
With what evidence?
With what audit event?
Can it be replayed?
Can it be reversed?
What happens on partial failure?
```

---

## 7. STRIDE: Framework Dasar untuk Menemukan Threat

STRIDE adalah mnemonic:

| STRIDE | Meaning | Security Property yang Diserang |
|---|---|---|
| S | Spoofing | authenticity |
| T | Tampering | integrity |
| R | Repudiation | non-repudiation / auditability |
| I | Information Disclosure | confidentiality |
| D | Denial of Service | availability |
| E | Elevation of Privilege | authorization / least privilege |

STRIDE bukan checklist final, tapi alat scanning awal.

### 7.1 Spoofing

Pertanyaan:

```text
Bisakah actor berpura-pura menjadi actor lain?
```

Contoh Java system:

- service menerima `X-User-Id` dari client tanpa validasi gateway;
- worker percaya `createdBy` di message payload;
- webhook tidak memverifikasi signature;
- service-to-service call tanpa mTLS/token;
- test endpoint aktif di production;
- JWT diterima tanpa issuer/audience validation;
- certificate hostname verification dimatikan;
- admin user bisa impersonate tanpa audit.

Mitigation:

- strong authentication;
- token signature validation;
- issuer/audience/expiry validation;
- mTLS;
- signed request;
- trusted header stripping di edge;
- service identity;
- audit impersonation.

### 7.2 Tampering

Pertanyaan:

```text
Bisakah data, command, event, file, config, atau artifact diubah tanpa terdeteksi?
```

Contoh:

- amount di callback diganti;
- case status di request body dimanipulasi;
- message queue payload diubah;
- file upload metadata tidak cocok dengan content;
- audit log bisa diupdate;
- JAR artifact diganti;
- dependency version dimanipulasi;
- report download parameter diganti.

Mitigation:

- server-side recomputation;
- MAC/signature;
- hash manifest;
- object-level authorization;
- immutable storage;
- DB constraint;
- optimistic locking;
- artifact signing;
- tamper-evident audit chain.

### 7.3 Repudiation

Pertanyaan:

```text
Bisakah actor menyangkal action penting karena sistem tidak punya bukti cukup?
```

Contoh:

- approval tidak menyimpan actor, timestamp, reason, source IP, correlation ID;
- admin export tidak diaudit;
- audit event bisa dihapus;
- batch job mengubah status tanpa actor/system identity;
- signature tidak mengikat payload canonical;
- log timestamp tidak konsisten.

Mitigation:

- audit trail immutable;
- append-only log;
- tamper-evident hash chain;
- digital signature untuk high-value action;
- correlation ID;
- time source discipline;
- privileged action audit;
- retention policy.

### 7.4 Information Disclosure

Pertanyaan:

```text
Bisakah informasi sensitif bocor ke actor yang tidak berhak?
```

Contoh:

- stack trace menampilkan SQL/token;
- log menyimpan Authorization header;
- metric label berisi userId/email/NRIC;
- report URL bisa ditebak;
- object-level access hilang;
- cache key tidak tenant-aware;
- exception membocorkan existence of record;
- actuator endpoint expose env;
- heap dump menyimpan secret;
- file temp readable oleh process lain.

Mitigation:

- access control;
- data minimization;
- encryption;
- redaction;
- safe error;
- tenant-aware cache;
- signed URL with expiry;
- actuator hardening;
- secret scanning;
- least privilege.

### 7.5 Denial of Service

Pertanyaan:

```text
Bisakah attacker atau input buruk membuat sistem tidak tersedia?
```

Contoh:

- regex catastrophic backtracking;
- oversized JSON;
- zip bomb;
- XML billion laughs;
- unbounded pagination;
- expensive search query;
- login brute force;
- file upload memenuhi disk;
- message replay memenuhi queue;
- thread pool exhaustion;
- connection pool exhaustion;
- memory leak via large request body.

Mitigation:

- rate limit;
- size limit;
- timeout;
- bulkhead;
- bounded queue;
- pagination limit;
- circuit breaker;
- parser limit;
- upload quota;
- backpressure;
- worker concurrency cap.

### 7.6 Elevation of Privilege

Pertanyaan:

```text
Bisakah actor mendapat privilege lebih tinggi dari yang seharusnya?
```

Contoh:

- role dari request body dipercaya;
- endpoint admin hanya disembunyikan di UI;
- method service tidak punya authorization;
- queue consumer menjalankan command apapun dari payload;
- scheduler punya DB superuser;
- service account terlalu luas;
- dependency bisa execute code saat build;
- deserialization memanggil gadget chain;
- path traversal menulis config.

Mitigation:

- least privilege;
- deny by default;
- central policy enforcement;
- object-level auth;
- command allowlist;
- separate service accounts;
- sandboxing;
- deserialization filter;
- build isolation;
- admin action MFA/approval.

---

## 8. STRIDE per Elemen Sistem

STRIDE lebih efektif jika diterapkan per element.

### 8.1 STRIDE untuk REST Endpoint

Contoh endpoint:

```http
POST /cases/{caseId}/approve
Authorization: Bearer <token>
Content-Type: application/json

{
  "decision": "APPROVED",
  "remarks": "ok"
}
```

Threats:

| STRIDE | Threat |
|---|---|
| Spoofing | token palsu/stolen dipakai approve |
| Tampering | `caseId` diganti ke case lain |
| Repudiation | approval tidak punya audit proof |
| Information Disclosure | error memberi tahu caseId valid/tidak |
| DoS | approval endpoint dipanggil berulang, lock contention |
| EoP | reviewer biasa bisa approve karena role check salah |

Controls:

- validate token signature, issuer, audience, expiry;
- object-level authorization `canApprove(user, caseId)`;
- state transition guard;
- idempotency key untuk command;
- audit event immutable;
- safe error response;
- rate limit untuk high-risk action;
- transaction boundary jelas;
- optimistic locking.

### 8.2 STRIDE untuk Message Consumer

Contoh event:

```json
{
  "eventId": "evt-123",
  "caseId": "CASE-9",
  "action": "APPROVE",
  "actorId": "u-77",
  "timestamp": "2026-06-16T10:00:00Z"
}
```

Threats:

| STRIDE | Threat |
|---|---|
| Spoofing | producer palsu publish event |
| Tampering | payload action/caseId diganti |
| Repudiation | tidak bisa tahu producer asli |
| Information Disclosure | queue berisi PII berlebihan |
| DoS | replay event memenuhi worker |
| EoP | worker menjalankan action yang tidak boleh dari async path |

Controls:

- broker ACL;
- producer identity;
- message signature/MAC untuk high-risk event;
- idempotency store;
- replay window;
- schema validation;
- action allowlist;
- no trust in `actorId` without authority context;
- dead-letter policy;
- consumer rate limit.

### 8.3 STRIDE untuk File Upload

Threats:

| STRIDE | Threat |
|---|---|
| Spoofing | user upload atas nama case lain |
| Tampering | metadata tidak cocok dengan content |
| Repudiation | uploader menyangkal file |
| Information Disclosure | file dapat di-download user lain |
| DoS | zip bomb / huge file |
| EoP | path traversal overwrite file server |

Controls:

- case-level authorization;
- generated server-side filename;
- content hash;
- MIME/content validation;
- size limit;
- malware scan;
- quarantine state;
- immutable object storage;
- download authorization;
- audit event.

### 8.4 STRIDE untuk Scheduler/Batch Job

Threats:

| STRIDE | Threat |
|---|---|
| Spoofing | unauthorized trigger |
| Tampering | job parameter diubah |
| Repudiation | perubahan massal tidak bisa ditelusuri |
| Information Disclosure | export batch bocor |
| DoS | batch mengunci table besar |
| EoP | batch service account terlalu powerful |

Controls:

- restricted trigger;
- signed/validated job parameters;
- dry-run preview;
- scoped DB privilege;
- audit per batch run;
- row-level progress checkpoint;
- concurrency lock;
- kill switch;
- bounded batch size.

---

## 9. Attack Tree: Saat STRIDE Terlalu Datar

STRIDE membantu menemukan kategori threat. Attack tree membantu memahami jalur serangan bertingkat.

Contoh goal attacker:

```text
Goal: Download evidence document from another case

OR
├── Guess direct document URL
│   ├── Document IDs are sequential
│   ├── Download endpoint lacks object-level authorization
│   └── Error reveals valid IDs
├── Use legitimate account with different case
│   ├── Login as applicant A
│   ├── Change documentId to applicant B's document
│   └── API only checks authentication
├── Abuse report export
│   ├── Export endpoint accepts arbitrary caseId
│   ├── Export runs as system user
│   └── Result link sent to attacker
└── Compromise internal worker
    ├── Publish fake export message
    ├── Worker trusts queue payload
    └── Generated file placed in accessible bucket
```

Attack tree membuat kita sadar bahwa satu asset bisa diserang dari banyak path, bukan hanya endpoint utama.

### 9.1 Kapan Pakai Attack Tree

Gunakan attack tree untuk:

- high-value asset;
- privilege escalation;
- financial transaction;
- identity flow;
- evidence/document access;
- audit tampering;
- admin export;
- token/key compromise;
- fraud scenario;
- distributed workflow.

### 9.2 Attack Tree Template

```text
Goal: [attacker objective]

OR
├── Path 1: [strategy]
│   ├── Required condition
│   ├── Vulnerability needed
│   └── Missing control
├── Path 2: [strategy]
│   ├── Required condition
│   ├── Vulnerability needed
│   └── Missing control
└── Path 3: [strategy]
    ├── Required condition
    ├── Vulnerability needed
    └── Missing control

Controls:
- preventive:
- detective:
- corrective:

Residual risk:
```

---

## 10. Abuse Case: Membalik User Story

User story:

```text
As an officer, I want to approve a case so that the applicant can receive a decision.
```

Abuse case:

```text
As a malicious officer, I want to approve a case outside my assigned unit
so that I can manipulate a decision without authorization.
```

Abuse case membantu menemukan missing authorization dan workflow invariant.

### 10.1 Contoh Abuse Case untuk Java Enterprise

#### Abuse Case 1 — IDOR

```text
As an authenticated user,
I want to change caseId in the URL
so that I can read another user's case.
```

Controls:

- object-level authorization;
- tenant/case scope enforced in query;
- no direct lookup by ID without policy;
- negative test.

#### Abuse Case 2 — Replay Event

```text
As an attacker with access to old broker messages,
I want to replay an APPROVE event
so that a case transition happens twice or at the wrong time.
```

Controls:

- idempotency key;
- event sequence check;
- state transition guard;
- replay window;
- immutable transition log.

#### Abuse Case 3 — Poisoned File

```text
As an attacker,
I want to upload a crafted archive
so that extraction writes outside the intended directory or exhausts resources.
```

Controls:

- no direct extraction without validation;
- path normalization;
- entry count/size limit;
- compression ratio limit;
- quarantine;
- malware scanning.

#### Abuse Case 4 — Secret Exfiltration via Error

```text
As an attacker,
I want to trigger an exception path
so that stack trace or debug response reveals tokens, SQL, or internal URLs.
```

Controls:

- safe error mapping;
- no raw exception response;
- log redaction;
- correlation ID;
- separate internal diagnostic access.

---

## 11. Data-Centric Threat Modeling

NIST SP 800-154 menekankan data-centric threat modeling: fokus pada tipe data tertentu dan bagaimana data itu diserang/dilindungi di sepanjang sistem.

Ini sangat berguna untuk regulatory/case-management system karena data sensitif sering bergerak melewati banyak komponen.

### 11.1 Pilih Data yang Dilindungi

Contoh:

```text
Evidence document
Case decision
Applicant personal data
Audit record
Access token
Signing key
```

### 11.2 Data Lifecycle

Untuk setiap data, mapping lifecycle:

```text
create -> receive -> validate -> transform -> store -> replicate -> read -> export -> archive -> delete
```

Contoh evidence document:

```text
upload by user
-> receive by API
-> store temporary object
-> malware scan
-> calculate hash
-> bind to case
-> mark AVAILABLE
-> download by authorized officer
-> archive after retention period
```

### 11.3 Threat per Lifecycle Stage

| Stage | Threat |
|---|---|
| Upload | malicious file, oversized file, wrong case binding |
| Temporary storage | unauthorized read, tampering before scan |
| Scan | bypass via parser gap, timeout treated as pass |
| Hashing | hash calculated before final write, mismatch not checked |
| Binding | file linked to wrong case |
| Download | object-level authorization bypass |
| Archive | retention violation, key loss |
| Delete | incomplete deletion, audit missing |

### 11.4 Data-Centric Control Matrix

| Data | Confidentiality | Integrity | Authenticity | Freshness | Auditability |
|---|---|---|---|---|---|
| Evidence file | encrypted storage, access control | content hash, immutable object | uploader identity | upload timestamp | upload/download audit |
| Case decision | role/permission access | state guard, DB constraint | actor identity | command timestamp/idempotency | signed/high-value audit |
| Access token | no log, short TTL | signature validation | issuer validation | exp/nbf | auth event log |
| Audit record | restricted read | append-only/hash chain | service identity | trusted timestamp | immutable retention |

---

## 12. Threat Modeling REST API

REST API threat modeling harus melampaui endpoint list.

### 12.1 API Threat Model Checklist

Untuk setiap endpoint:

```text
Endpoint:
Method:
Actor:
Authentication required:
Authorization policy:
Object-level resource:
Tenant boundary:
Input schema:
State transition:
Side effect:
Sensitive data returned:
Audit event:
Rate limit:
Idempotency requirement:
Replay risk:
Error behavior:
```

### 12.2 Example

```text
Endpoint: POST /cases/{caseId}/documents
Actor: applicant/officer
Authentication: required
Authorization: canUploadDocument(user, caseId)
Object-level resource: caseId
Input: multipart file + documentType
State transition: document PENDING_SCAN -> AVAILABLE
Side effect: object storage write, scan job publish
Sensitive data: filename, metadata
Audit: DOCUMENT_UPLOADED
Rate limit: per user/case
Idempotency: upload token or content hash optional
Replay risk: duplicate upload
Error behavior: no filesystem path leak
```

Threats:

```text
- user uploads document to another case
- huge file consumes disk/memory
- crafted filename causes path traversal
- file marked AVAILABLE before scan
- object storage key predictable
- duplicate upload creates inconsistent evidence list
- metadata says PDF but content is executable/archive
```

Controls:

```text
- authorize case access before accepting bytes
- server-generated object key
- stream upload with size cap
- content sniffing and allowlist
- quarantine state
- scan result required before AVAILABLE
- content hash recorded
- audit with uploader, caseId, documentType, hash
```

---

## 13. Threat Modeling Async Worker dan Message Broker

Async boundary sering merusak security context.

Dalam synchronous HTTP:

```text
User -> API -> Service -> DB
```

Dalam async system:

```text
User -> API -> Event -> Broker -> Worker -> DB/External System
```

Masalahnya: worker sering tidak tahu siapa user asli, authority apa yang sudah dicek, dan apakah event masih valid.

### 13.1 Threat Questions untuk Message

```text
Who is allowed to publish this message?
Can the message be forged?
Can the message be modified?
Can the message be replayed?
Can the message be reordered?
Can the message be duplicated?
Can the message reference an object the producer should not control?
Does the worker re-check state and authorization-relevant invariants?
What happens if processing partially succeeds?
```

### 13.2 Jangan Percaya Message Karena “Internal”

Bad pattern:

```java
public void handle(CaseApprovalMessage msg) {
    caseRepository.updateStatus(msg.caseId(), APPROVED);
}
```

Better pattern:

```java
public void handle(CaseApprovalMessage msg) {
    messageVerifier.verify(msg);
    idempotencyGuard.ensureNotProcessed(msg.eventId());

    CaseRecord record = caseRepository.getForUpdate(msg.caseId());

    transitionPolicy.ensureAllowed(
        record.status(),
        CaseAction.APPROVE,
        msg.actorContext(),
        msg.commandContext()
    );

    record.approve(msg.actorContext().actorId(), msg.reason());
    auditTrail.record(CASE_APPROVED, record.id(), msg.actorContext(), msg.eventId());
}
```

### 13.3 Message Security Envelope

Untuk high-risk event, gunakan envelope:

```json
{
  "messageId": "01J...",
  "type": "CASE_APPROVAL_REQUESTED",
  "schemaVersion": 3,
  "producer": "case-api",
  "issuedAt": "2026-06-16T10:00:00Z",
  "expiresAt": "2026-06-16T10:05:00Z",
  "correlationId": "corr-...",
  "payloadHash": "base64url(...) ",
  "payload": { },
  "signature": "base64url(...)"
}
```

Tidak semua message butuh signature cryptographic. Tetapi semua high-value command/event harus punya authenticity, integrity, replay handling, dan idempotency story.

---

## 14. Threat Modeling File Ingestion

File ingestion adalah attack surface kompleks karena file membawa bytes, metadata, parser behavior, storage semantics, dan downstream processing.

### 14.1 File Threat Model

```text
Actor -> upload endpoint -> temp storage -> scanner -> parser -> permanent storage -> business binding -> download
```

Threats:

- path traversal;
- zip slip;
- archive bomb;
- parser exploit;
- polyglot file;
- wrong MIME;
- extension spoofing;
- filename injection;
- malware;
- content tampering between upload and scan;
- object key prediction;
- unauthorized download;
- stale pre-signed URL;
- retention violation.

### 14.2 Secure File State Machine

```text
RECEIVED
  -> STORED_TEMPORARY
  -> HASHED
  -> SCAN_PENDING
  -> SCAN_PASSED
  -> BOUND_TO_BUSINESS_OBJECT
  -> AVAILABLE

Failure states:
  -> REJECTED_SIZE
  -> REJECTED_TYPE
  -> REJECTED_MALWARE
  -> REJECTED_HASH_MISMATCH
  -> QUARANTINED
```

Invariant:

```text
A file must never become AVAILABLE unless it has passed validation,
its content hash is recorded,
its storage object is immutable or versioned,
and it is bound to an authorized business object.
```

### 14.3 Java-Specific Concerns

- Jangan baca seluruh file ke memory untuk validasi besar.
- Jangan percaya `MultipartFile.getOriginalFilename()`.
- Jangan extract archive tanpa canonical path check.
- Jangan memproses XML/office/pdf tanpa parser hardening.
- Jangan simpan file dengan extension dari user sebagai trust signal.
- Jangan return path internal di error.
- Jangan generate object key dari filename asli.

---

## 15. Threat Modeling Internal Admin UI

Admin UI sering lebih berbahaya daripada public API karena privilege-nya tinggi dan testing-nya lebih lemah.

### 15.1 Admin Threats

- admin action tanpa MFA;
- role terlalu broad;
- no dual control untuk destructive action;
- export semua data tanpa approval;
- search endpoint bisa enumerate sensitive data;
- impersonation tanpa audit;
- feature flag bisa mengubah security behavior;
- bulk update tanpa dry-run;
- support user bisa reset identity orang lain;
- admin API callable dari non-admin client.

### 15.2 Admin Invariants

```text
A privileged action must always produce an audit event with actor, target, reason,
source, timestamp, and correlation id.
```

```text
A destructive bulk action must never execute unless scope is explicitly previewed,
approved, and bounded.
```

```text
An impersonation session must never perform privileged action as the target user
without retaining the original admin identity in audit trail.
```

### 15.3 Controls

- least privilege role model;
- step-up authentication;
- approval workflow;
- dry-run;
- export limits;
- watermark;
- immutable audit;
- admin session separation;
- reason capture;
- alerting for unusual action.

---

## 16. Threat Modeling Service-to-Service Calls

Internal service call sering diasumsikan aman. Ini lemah.

### 16.1 Pertanyaan Kunci

```text
How does callee know caller identity?
Can caller identity be spoofed?
Is user context propagated safely?
Is authorization checked at callee?
Can request be replayed?
Can request body be tampered?
Is TLS terminated before reaching callee?
Are internal headers stripped at trust boundary?
```

### 16.2 Common Bad Pattern

```text
Gateway validates user token.
Gateway forwards X-User-Id and X-Roles.
Downstream trusts X-User-Id from any request.
```

Jika attacker bisa memanggil downstream langsung atau melewati gateway, header bisa dipalsukan.

### 16.3 Better Pattern

- edge strips inbound internal headers;
- gateway signs internal identity context;
- downstream verifies gateway/service identity;
- service-to-service uses mTLS or service token;
- callee still enforces object-level policy;
- high-risk request uses idempotency/replay controls;
- audit records original user and calling service.

---

## 17. Threat Modeling Scheduled Jobs dan Maintenance Scripts

Scheduler dan scripts sering luput dari review, padahal bisa mengubah data massal.

### 17.1 Threats

- job berjalan di environment salah;
- job parameter salah;
- job dipicu dua kali;
- job partial success tanpa checkpoint;
- job memakai DB account terlalu powerful;
- script hardcode secret;
- script menulis log berisi PII;
- cleanup menghapus data aktif;
- retry menyebabkan duplicate side effect;
- operator tidak punya audit trail.

### 17.2 Controls

- environment guard;
- dry-run mode;
- explicit confirmation token;
- bounded scope;
- checkpoint;
- idempotency;
- DB least privilege;
- run audit;
- approval before production;
- rollback plan;
- kill switch.

### 17.3 Production Script Header Template

```text
Script name:
Purpose:
Environment allowed:
Data scope:
Expected row count:
Dry-run query:
Rollback strategy:
Required approval:
Operator:
Start time:
End time:
Audit reference:
```

---

## 18. Risk Scoring: Jangan Terjebak Angka Palsu

Risk scoring berguna, tapi sering memberi ilusi presisi.

Gunakan scoring sederhana:

```text
Risk = Likelihood x Impact
```

Tetapi selalu jelaskan alasan.

### 18.1 Likelihood Factors

- exposed to internet;
- requires authentication or not;
- requires privilege or not;
- exploit complexity;
- known exploit class;
- reachable code path;
- frequency of operation;
- attacker incentive;
- detection probability;
- existing controls.

### 18.2 Impact Factors

- data sensitivity;
- number of records;
- financial/legal impact;
- integrity of business decision;
- privilege gained;
- audit/legal defensibility;
- operational downtime;
- reputational damage;
- blast radius;
- recovery cost.

### 18.3 Practical Matrix

| Likelihood \ Impact | Low | Medium | High | Critical |
|---|---:|---:|---:|---:|
| Low | Low | Low | Medium | High |
| Medium | Low | Medium | High | Critical |
| High | Medium | High | Critical | Critical |
| Very High | High | Critical | Critical | Critical |

### 18.4 Risk Register Entry

```text
Risk ID: SEC-CASE-001
Threat: User can read case documents outside assigned scope.
Asset: Evidence document, case data.
Affected flow: GET /documents/{documentId}
Likelihood: High, because authenticated users can control documentId.
Impact: Critical, because evidence documents may contain sensitive personal/legal data.
Existing control: authentication only.
Missing control: object-level authorization.
Mitigation: enforce DocumentAccessPolicy.canDownload(user, documentId), tenant-aware query, negative tests.
Residual risk: low after mitigation, assuming policy data is correct.
Owner: case-service team.
Due: before UAT.
Evidence: test class DocumentAccessPolicyTest, PR #1234.
```

---

## 19. Security Control Mapping

Setiap threat harus dipetakan ke control. Control yang tidak memetakan threat sering menjadi “security theater”.

### 19.1 Control Mapping Table

| Threat | Preventive | Detective | Corrective | Test Evidence |
|---|---|---|---|---|
| Object access bypass | object-level auth | audit denied access | revoke access/session | negative auth test |
| Replay event | idempotency/replay window | duplicate event alert | mark event rejected | replay integration test |
| Audit tampering | append-only/hash chain | integrity verification job | incident runbook | tamper detection test |
| Secret leakage | redaction/no logging | secret scanner | rotate secret | log assertion test |
| File malware | quarantine/scan | scan failure alert | delete/quarantine | malicious sample test |

### 19.2 Control Quality Questions

```text
Is this control close enough to the asset?
Can it be bypassed through another path?
Does it fail closed?
Is it tested negatively?
Is it observable?
Does it create new operational risk?
Who owns it?
What happens when dependency/control is down?
```

---

## 20. Fail-Open vs Fail-Closed

Salah satu keputusan paling penting di security design adalah bagaimana sistem gagal.

### 20.1 Fail-Open

Fail-open berarti ketika kontrol gagal, operasi tetap dilanjutkan.

Contoh buruk:

```java
try {
    authorizationService.check(user, action, resource);
} catch (Exception ex) {
    log.warn("Authorization service error, allowing request", ex);
}
```

Ini berbahaya.

### 20.2 Fail-Closed

Fail-closed berarti ketika kontrol gagal, operasi ditolak.

```java
try {
    authorizationService.check(user, action, resource);
} catch (Exception ex) {
    log.error("Authorization service error", ex);
    throw new AccessDeniedException("Unable to verify authorization");
}
```

Tetapi fail-closed juga punya availability risk. Karena itu perlu desain:

- local policy cache dengan expiry;
- degraded mode eksplisit;
- circuit breaker;
- emergency access process;
- audit untuk override;
- clear user-facing error.

### 20.3 Fail Behavior Matrix

| Control | Failure | Preferred Behavior |
|---|---|---|
| Authentication | IdP unavailable | deny login, allow existing valid session until expiry if policy allows |
| Authorization | policy service unavailable | deny high-risk action, maybe allow low-risk cached read |
| Malware scan | scanner timeout | keep file quarantined |
| Audit logging | audit store unavailable | block high-risk action or write durable local buffer |
| Token verification | JWKS unavailable | use cached key until TTL, do not accept unknown key |
| Secret retrieval | secret manager unavailable | fail startup or use short-lived cached secret carefully |

---

## 21. Common Threat Modeling Mistakes

### 21.1 Hanya Membahas Login

Security bukan hanya authentication. Banyak breach terjadi pada authorized user yang melakukan unauthorized action.

### 21.2 Menganggap Internal Network Trusted

Internal service, queue, DNS, metadata service, and database are still attack surfaces.

### 21.3 Tidak Memodelkan Async Flow

Kalau action berubah menjadi event/job, authorization dan integrity harus tetap ada.

### 21.4 Tidak Memodelkan State

Security bug sering muncul saat state transition tidak dijaga.

Contoh:

```text
User bisa call approve endpoint langsung walaupun case masih DRAFT.
```

### 21.5 Tidak Memodelkan Operational Tools

Admin UI, scripts, scheduler, migration, actuator, JMX, CI/CD sering punya privilege besar.

### 21.6 Kontrol Terlalu Jauh dari Asset

Gateway validation bagus, tapi object-level authorization tetap harus dekat dengan data/action.

### 21.7 Tidak Ada Negative Test

Kalau tidak ada test yang membuktikan akses ditolak, kontrol mudah rusak.

### 21.8 Risk Acceptance Tanpa Owner

Risk yang “accepted” tanpa owner dan expiry sebenarnya cuma diabaikan.

### 21.9 Menggunakan Crypto untuk Menutup Desain Buruk

Encryption tidak memperbaiki authorization salah. Signature tidak memperbaiki business invariant salah. Hash tidak membuktikan user berhak.

### 21.10 Threat Model Tidak Diupdate

Threat model harus berubah saat ada:

- endpoint baru;
- role baru;
- integration baru;
- queue baru;
- file type baru;
- deployment topology baru;
- dependency besar baru;
- key/certificate change;
- incident/finding baru.

---

## 22. Java Security Design Review Template

Gunakan template ini untuk setiap feature penting.

```text
# Security Design Review

## 1. Feature Summary
What is being built?

## 2. Assets
What data/authority/decision/state are protected?

## 3. Actors
Who interacts with the feature?
Which actors are trusted, partially trusted, or untrusted?

## 4. Entry Points
HTTP endpoints, messages, files, jobs, admin actions, callbacks.

## 5. Trust Boundaries
Where does data/authority cross trust zones?

## 6. Data Flow
How does data move, transform, persist, and leave the system?

## 7. Security Invariants
What must never happen?

## 8. Threats
STRIDE, abuse cases, attack trees.

## 9. Controls
Preventive, detective, corrective.

## 10. Failure Behavior
Fail-open or fail-closed?
What happens when dependency is unavailable?

## 11. Tests
Positive tests, negative tests, replay tests, boundary tests.

## 12. Observability
Audit, logs, metrics, alerts.

## 13. Residual Risk
What remains? Who accepts it? Until when?

## 14. Review Decision
Approved / approved with conditions / rejected.
```

---

## 23. PR Review Checklist untuk Threat Modeling

Saat review PR Java, tanyakan:

```text
Authentication:
- Does this code assume user identity from request body/header?
- Is token/session validation done at the right boundary?

Authorization:
- Is object-level authorization enforced?
- Is authorization close to the business action/data access?
- Are async paths protected too?

Input:
- Is input schema validated?
- Is canonicalization needed before validation?
- Are size limits enforced?

State:
- Are state transitions guarded?
- Is concurrent update handled?
- Can this command be replayed?

Data:
- Is sensitive data minimized?
- Is data returned only to authorized actors?
- Are cache keys tenant/user aware?

Crypto/Integrity:
- Is crypto used for the right security property?
- Are keys/nonces/tokens generated and stored safely?
- Is payload canonical before signing/hashing?

Logging/Audit:
- Are secrets/PII excluded from logs?
- Is high-risk action audited?
- Is correlation ID preserved?

Failure:
- Does security failure deny safely?
- What happens when dependency is down?

Testing:
- Are there negative tests?
- Are unauthorized cases tested?
- Are replay/tamper cases tested?
```

---

## 24. Mini Case Study: Case Approval API

### 24.1 Initial Design

```http
POST /api/cases/{caseId}/approve
```

Controller:

```java
@PostMapping("/cases/{caseId}/approve")
public void approve(@PathVariable String caseId, @RequestBody ApprovalRequest request) {
    caseService.approve(caseId, request);
}
```

Service:

```java
@Transactional
public void approve(String caseId, ApprovalRequest request) {
    CaseRecord record = caseRepository.findById(caseId).orElseThrow();
    record.setStatus(APPROVED);
    record.setDecisionRemarks(request.remarks());
    caseRepository.save(record);
}
```

### 24.2 Threat Model

Assets:

- case decision;
- case state;
- applicant data;
- audit evidence;
- approval authority.

Actors:

- approver;
- reviewer;
- officer;
- applicant;
- admin;
- attacker with stolen token.

Security invariants:

```text
A case must never be approved unless the actor has approval authority for that case.
```

```text
A case must never be approved unless it is in REVIEW_COMPLETED state.
```

```text
A case approval must always produce immutable audit evidence.
```

Threats:

| STRIDE | Threat |
|---|---|
| Spoofing | stolen token used to approve |
| Tampering | caseId changed |
| Repudiation | no audit trail |
| Information Disclosure | error reveals case existence |
| DoS | repeated approval causes lock/conflict |
| EoP | reviewer approves without approver role |

### 24.3 Improved Design

```java
@Transactional
public ApprovalResult approve(AuthenticatedUser user, String caseId, ApprovalCommand command) {
    idempotencyGuard.check(command.idempotencyKey(), user.id(), caseId, "APPROVE_CASE");

    CaseRecord record = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(() -> new NotFoundOrNotAccessibleException());

    caseAccessPolicy.ensureCanApprove(user, record);
    caseTransitionPolicy.ensureCanTransition(record.status(), CaseAction.APPROVE);

    record.approve(user.id(), command.remarks(), clock.instant());

    auditTrail.append(AuditEvent.caseApproved(
        record.id(),
        user.id(),
        command.correlationId(),
        command.remarks(),
        clock.instant()
    ));

    idempotencyGuard.markProcessed(command.idempotencyKey());

    return ApprovalResult.success(record.id(), record.version());
}
```

### 24.4 Negative Tests

```java
@Test
void reviewerCannotApproveCase() {}

@Test
void approverCannotApproveCaseOutsideUnit() {}

@Test
void cannotApproveDraftCase() {}

@Test
void duplicateApprovalCommandIsIdempotent() {}

@Test
void approvalCreatesAuditEvent() {}

@Test
void notFoundAndNotAccessibleUseSameExternalError() {}
```

### 24.5 Review Decision

```text
Approved with conditions:
- Add object-level authorization negative tests.
- Add audit event assertion.
- Add idempotency behavior for repeated submit.
- Confirm caseRepository query is tenant/unit scoped.
```

---

## 25. Mini Case Study: Service-to-Service Internal Header

### 25.1 Bad Design

```text
Gateway validates user.
Gateway forwards X-User-Id.
Downstream trusts X-User-Id.
```

Risk:

```text
If downstream is reachable directly or internal header is not stripped,
attacker can spoof X-User-Id.
```

### 25.2 Threat Model

Threats:

- spoofing internal identity;
- elevation of privilege;
- repudiation because original caller not proven;
- tampering of role header;
- information disclosure from downstream direct call.

### 25.3 Better Design

```text
External request headers are stripped at edge.
Gateway validates token.
Gateway creates signed internal identity context.
Downstream verifies gateway identity and signature.
Downstream enforces local authorization.
Audit stores original subject and gateway/service identity.
```

Example internal context:

```json
{
  "subject": "user-123",
  "roles": ["OFFICER"],
  "issuer": "api-gateway",
  "issuedAt": "2026-06-16T10:00:00Z",
  "expiresAt": "2026-06-16T10:01:00Z",
  "correlationId": "corr-abc"
}
```

Controls:

- mTLS between gateway and service;
- signed internal context;
- short expiry;
- deny direct ingress;
- local authz;
- audit.

---

## 26. Mini Case Study: Audit Trail Integrity

### 26.1 Requirement

```text
System must keep audit trail for critical case actions.
```

Ini masih lemah. Ubah menjadi invariant.

### 26.2 Invariants

```text
A critical action must never commit business data unless its audit event is durably recorded.
```

```text
An audit record must never be updated or deleted by normal application flows.
```

```text
Audit integrity verification must detect missing, reordered, or modified records.
```

### 26.3 Threats

- application bug skips audit;
- malicious admin deletes audit;
- DB update changes actor/time;
- log sink outage causes missing audit;
- clock manipulation changes sequence;
- audit event lacks enough context;
- correlation ID missing across async flow.

### 26.4 Controls

- append-only table or immutable store;
- write audit in same transaction for local DB decision;
- outbox for external audit sink;
- hash chain for tamper evidence;
- privileged DB account separation;
- periodic integrity verification;
- audit read access control;
- alert on audit write failure;
- explicit incident runbook.

---

## 27. From Threat Model to Architecture Decision Record

Threat modeling harus masuk ADR.

```text
# ADR: Protect Case Approval Commands Against Replay and Unauthorized Execution

## Context
Case approval is a high-risk state transition with legal and operational impact.

## Threats
- Unauthorized actor approves case.
- Valid approval command is replayed.
- Approval happens from invalid previous state.
- Approval commits without audit record.

## Decision
- Approval is enforced through CaseAccessPolicy and CaseTransitionPolicy.
- Approval command requires idempotency key.
- Approval and audit write occur in one transaction.
- External error does not reveal whether case exists or is inaccessible.

## Consequences
- Slightly higher implementation complexity.
- Requires idempotency table.
- Easier security testing and audit evidence.

## Residual Risk
- Compromised approver account can still approve assigned cases.
- Mitigated by MFA, audit monitoring, and periodic access review.
```

---

## 28. Threat Model Artifact yang Baik

Threat model artifact tidak perlu panjang, tapi harus actionable.

Minimal berisi:

```text
1. Scope
2. Diagram
3. Assets
4. Actors
5. Entry points
6. Trust boundaries
7. Security invariants
8. Threat list
9. Control mapping
10. Tests/evidence
11. Residual risk
12. Open questions
```

### 28.1 Open Questions Sangat Penting

Contoh open questions:

```text
- Is document-service reachable only through gateway?
- Are internal headers stripped at edge?
- Who can publish to case.approval.requested queue?
- Is audit DB account separate from application DB account?
- What happens if malware scanner times out?
- Is caseId globally unique or tenant-scoped?
- Can support admin impersonate applicant?
- Are old signing keys kept for token validation after rotation?
```

Open question lebih baik daripada asumsi palsu.

---

## 29. Lightweight Threat Modeling Workshop untuk Team

Untuk feature besar, lakukan sesi 60–90 menit.

### 29.1 Participants

- backend engineer;
- frontend engineer jika ada UI/security interaction;
- QA;
- architect/tech lead;
- security engineer jika tersedia;
- product/BA untuk business abuse case;
- operations jika ada deployment/runtime risk.

### 29.2 Agenda

```text
0-10 min: define scope and feature summary
10-20 min: draw context/data flow
20-35 min: identify assets and trust boundaries
35-60 min: enumerate threats using STRIDE/abuse cases
60-75 min: map controls/tests
75-90 min: assign owners, residual risk, open questions
```

### 29.3 Rules

- Jangan debat solusi terlalu awal.
- Jangan hanya fokus hacker eksternal.
- Jangan abaikan internal actor.
- Jangan abaikan async/batch/file/admin.
- Tulis open questions.
- Setiap high-risk threat harus punya owner.

---

## 30. Threat Modeling Done Definition

Threat modeling dianggap cukup untuk satu feature jika:

```text
- Scope jelas.
- Diagram data flow tersedia.
- Trust boundaries diidentifikasi.
- Assets dan actors jelas.
- Security invariants tertulis.
- Threats utama diidentifikasi.
- Controls dipetakan ke threats.
- Failure behavior diputuskan.
- Negative tests ditentukan.
- Audit/observability ditentukan.
- Residual risks punya owner.
- Open questions dicatat.
```

Tidak perlu sempurna. Threat model harus cukup baik untuk membuat keputusan engineering yang lebih aman.

---

## 31. Practical Templates

### 31.1 One-Page Threat Model

```text
# One-Page Threat Model

Feature:
Owner:
Date:

## Scope

## Diagram

## Assets

## Actors

## Trust Boundaries

## Security Invariants

## Top Threats
1.
2.
3.
4.
5.

## Controls

## Tests

## Residual Risk

## Open Questions
```

### 31.2 Threat Entry Template

```text
Threat ID:
Title:
Asset:
Actor:
Entry point:
Trust boundary:
STRIDE category:
Attack path:
Impact:
Likelihood:
Existing controls:
Missing controls:
Mitigation:
Test evidence:
Owner:
Residual risk:
Status:
```

### 31.3 Security Invariant Template

```text
[Subject] must never [action]
unless [identity/authenticity condition],
[authorization condition],
[state/integrity condition],
[freshness/idempotency condition],
and [audit/evidence condition].
```

### 31.4 Control Test Template

```text
Control:
Threat mitigated:
Expected behavior:
Negative scenario:
Test type:
Test location:
Evidence:
```

---

## 32. Senior-Level Heuristics

### 32.1 Authenticated Is Not Authorized

Authenticated only means “we know who this likely is”. It does not mean “this actor may do this action on this object”.

### 32.2 Internal Is Not Trusted

Internal only means “behind a boundary”. It does not mean “safe”.

### 32.3 Encrypted Is Not Untampered

Encryption without authentication may not give integrity. Even authenticated encryption does not prove business authorization.

### 32.4 Valid JSON Is Not Valid Command

Schema validation does not prove the command is allowed.

### 32.5 Signed Payload Is Not Safe Payload

Signature proves origin/integrity under a key. It does not prove semantic safety.

### 32.6 Audit Log Is Not Evidence Unless It Is Trustworthy

Audit must be complete, durable, tamper-evident enough, and access-controlled.

### 32.7 A Queue Is a Security Boundary

Message broker can decouple execution from user context. That is powerful and dangerous.

### 32.8 State Transition Is a Security Boundary

Every important transition should have explicit guard.

### 32.9 Cache Can Break Authorization

Cache key must include security-relevant dimensions: tenant, user, role, policy version, data scope.

### 32.10 Error Message Is an Information Channel

Different error for “not found” vs “not allowed” can leak existence.

---

## 33. Exercises

### Exercise 1 — Threat Model Endpoint

Endpoint:

```http
GET /api/cases/{caseId}/documents/{documentId}/download
```

Task:

1. Identify assets.
2. Identify actors.
3. Identify trust boundaries.
4. Write three security invariants.
5. Find STRIDE threats.
6. Map controls.
7. Define negative tests.

Expected invariants:

```text
A document must never be downloaded unless the authenticated subject has access to the owning case.
```

```text
A documentId must never be authorized independently from its caseId relationship.
```

```text
A document download must always produce an audit event for sensitive document types.
```

### Exercise 2 — Threat Model Event Replay

Event:

```json
{
  "eventId": "evt-001",
  "type": "CASE_APPROVED",
  "caseId": "CASE-123",
  "approvedBy": "user-9"
}
```

Questions:

1. What happens if this event is replayed?
2. What if it arrives before `REVIEW_COMPLETED` event?
3. What if `approvedBy` is forged?
4. What if event is duplicated by broker retry?
5. What controls are needed?

### Exercise 3 — Threat Model File Upload

Feature:

```text
Applicant uploads supporting document as PDF or ZIP.
```

Questions:

1. What file states are needed?
2. What should happen when scanner times out?
3. How should filename be handled?
4. Where is hash calculated?
5. What audit events are required?
6. Can file become available before scan completes?

### Exercise 4 — Threat Model Admin Export

Feature:

```text
Admin can export all case data for reporting.
```

Questions:

1. Who can export?
2. Is approval required?
3. Is export scoped?
4. How long is generated file available?
5. Is file watermarked?
6. Is export audited?
7. Is unusual export alerted?

---

## 34. Summary

Threat modeling adalah cara membaca sistem dari sudut pandang security sebelum vulnerability menjadi incident.

Inti part ini:

1. Threat modeling adalah debugging terhadap asumsi desain.
2. Output paling penting adalah security invariant, bukan diagram cantik.
3. STRIDE membantu menemukan kategori threat: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege.
4. Attack tree membantu memahami banyak jalur menuju satu tujuan attacker.
5. Abuse case membalik user story menjadi skenario penyalahgunaan.
6. Data-centric threat modeling penting untuk sistem dengan data sensitif dan regulatory impact.
7. Java system perlu memperhatikan REST, async worker, message broker, file ingestion, scheduler, admin UI, service-to-service, dependency, dan runtime.
8. Setiap threat harus punya control, test evidence, owner, dan residual risk.
9. Internal network, queue, scheduler, dan admin UI bukan otomatis trusted.
10. Threat model harus hidup bersama desain, PR review, testing, operasi, dan incident response.

Kalau Part 0 membangun mental model security secara umum, Part 2 ini memberi cara praktis untuk mengubah mental model itu menjadi desain yang bisa direview dan diuji.

---

## 35. Referensi Utama

- OWASP Threat Modeling Cheat Sheet.
- OWASP Threat Modeling Project.
- OWASP Secure by Design Framework.
- NIST SP 800-154, Guide to Data-Centric System Threat Modeling.
- OWASP Application Security Verification Standard.
- OWASP Top 10 Web Application Security Risks.
- Threat Modeling Manifesto.
- Microsoft STRIDE threat modeling tradition.
- Secure design and architecture review practices used in modern SDLC.

---

## 36. Status Seri

Seri belum selesai.

Progress:

```text
[x] Part 0  - Security Mental Model for Senior Java Engineers
[x] Part 1  - Java Security Architecture: JCA, JCE, JAAS, JSSE, JGSS, SASL, CertPath
[x] Part 2  - Threat Modeling for Java Systems
[ ] Part 3  - Cryptography Mental Model: What Crypto Can and Cannot Guarantee
...
[ ] Part 34 - Capstone: Designing a Secure Java Regulatory Case Management Platform
```

Part berikutnya adalah **Part 3 — Cryptography Mental Model: What Crypto Can and Cannot Guarantee**.
