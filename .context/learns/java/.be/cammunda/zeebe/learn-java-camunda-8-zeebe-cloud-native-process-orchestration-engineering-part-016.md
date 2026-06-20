# learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-016.md

# Part 016 — Connectors, Integration Patterns, and When Java Workers Are Still Better

> Seri: `learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering`  
> Level: Advanced / Staff+ Engineering  
> Fokus: Camunda 8 Connectors, outbound/inbound integration, Java workers, custom Connector SDK, integration governance, security, reliability, dan decision framework production-grade.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas worker application architecture: worker sebagai adapter, process contract layer, port/adapter boundary, transaction boundary, idempotency service, dan versioning job type.

Bagian ini melangkah ke pertanyaan yang sering muncul di Camunda 8 production project:

> Kalau Camunda 8 sudah punya Connectors, kapan kita memakai Connector, kapan tetap membuat Java worker sendiri?

Pertanyaan ini terlihat sederhana, tetapi sebenarnya menyentuh banyak keputusan arsitektur:

- apakah integrasi cukup declarative atau membutuhkan business control?
- apakah side effect aman jika dijalankan oleh runtime Connector?
- apakah retry/error handling cukup standar?
- apakah kita perlu idempotency store?
- apakah credential dan secret governance sudah jelas?
- apakah integrasi ini reusable across process?
- apakah observability dan audit cukup?
- apakah custom Java worker lebih mudah dioperasikan?
- apakah custom Connector lebih baik karena modeler dapat mengkonfigurasi integrasi tanpa menulis worker baru?

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. Memahami posisi Connectors dalam arsitektur Camunda 8.
2. Membedakan outbound connector, inbound connector, connector runtime, connector template, dan Connector SDK.
3. Menentukan kapan Connector cocok, kapan Java worker lebih aman.
4. Mendesain integration pattern yang tahan terhadap retry, duplicate execution, timeout, partial failure, dan credential leakage.
5. Membuat decision matrix untuk enterprise workflow.
6. Membuat governance agar modeler tidak bebas menaruh integrasi tanpa kontrol engineering.
7. Memahami bagaimana custom Connector Java berbeda dari job worker Java.
8. Menghindari anti-pattern seperti “semua HTTP call dijadikan Connector karena cepat”.

---

## 1. Mental Model: Connector Bukan Pengganti Worker Secara Total

Camunda 8 Connectors dan Java workers sama-sama dapat menjalankan pekerjaan eksternal, tetapi keduanya punya pusat gravitasi berbeda.

**Connector** cocok untuk integrasi yang:

- bentuknya standar,
- konfigurasinya deklaratif,
- reusable antar process,
- tidak terlalu domain-heavy,
- cocok dipakai langsung dari model BPMN,
- tidak membutuhkan transaction boundary kompleks di aplikasi bisnis,
- bisa dieksekusi oleh connector runtime.

**Java worker** cocok untuk pekerjaan yang:

- membutuhkan domain logic kompleks,
- membutuhkan idempotency kuat,
- menyentuh database bisnis,
- memakai transactional outbox/inbox,
- perlu custom retry/error taxonomy,
- perlu complex mapping/validation,
- punya security boundary khusus,
- butuh observability yang sangat spesifik,
- perlu ownership oleh engineering team.

Cara berpikirnya:

```text
Connector = reusable integration capability exposed to process model
Java worker = controlled application adapter owned by engineering team
```

Jadi Connector bukan “lebih modern daripada worker”, dan worker bukan “lebih low-level daripada Connector”. Keduanya adalah alat berbeda untuk masalah berbeda.

---

## 2. Posisi Connector dalam Camunda 8

Dalam Camunda 8, process model dapat memakai task yang dikonfigurasi sebagai Connector task.

Secara konseptual:

```text
BPMN process instance
    |
    | reaches connector task
    v
Zeebe creates job / activation obligation
    |
    v
Connector Runtime picks up the job
    |
    v
Connector implementation performs integration
    |
    v
Connector completes / fails / throws BPMN error
```

Untuk outbound connector, process memanggil sistem luar.

Contoh:

```text
Process -> REST API
Process -> Kafka topic
Process -> AWS service
Process -> email provider
Process -> Slack notification
Process -> database-like integration
Process -> SaaS API
```

Untuk inbound connector, sistem luar memicu process atau mengirim message ke process.

Contoh:

```text
Webhook -> Camunda process
Kafka message -> Camunda process
Timer/scheduled external source -> Camunda process
External event -> message correlation
```

Connector runtime menjadi komponen eksekusi yang menjalankan connector logic. Dalam self-managed deployment, connector runtime perlu dikelola sebagai runtime tersendiri. Dalam SaaS, sebagian pengalaman Connector tersedia sebagai managed capability, tetapi arsitektur enterprise tetap harus memahami credential, network, secret, dan runtime boundary.

---

## 3. Istilah Penting

### 3.1 Connector

Connector adalah reusable integration component yang bisa dipasang di BPMN model untuk berinteraksi dengan sistem eksternal.

Connector terdiri dari:

- metadata/form konfigurasi,
- input fields,
- output mapping,
- secret references,
- runtime execution logic,
- error behaviour,
- documentation/marketplace packaging.

### 3.2 Outbound Connector

Outbound Connector menjalankan aksi dari process ke sistem eksternal.

Contoh:

```text
Send HTTP request
Send email
Produce Kafka message
Upload file to S3
Call CRM API
Call payment gateway
Call notification service
```

Mental model:

```text
Process reaches task -> Connector performs side effect -> Process continues
```

### 3.3 Inbound Connector

Inbound Connector menerima event dari luar dan menghubungkannya ke Camunda.

Contoh:

```text
Webhook receives callback -> start process
Webhook receives callback -> correlate message
Kafka consumer receives event -> publish message
External scheduler fires -> trigger process
```

Mental model:

```text
External event -> Connector receives -> Process starts/correlates
```

### 3.4 Connector Runtime

Connector Runtime adalah runtime yang menjalankan Connector implementation.

Ia mirip worker application dalam arti ia mengaktifkan work dan mengeksekusi side effect. Namun bedanya, Connector Runtime biasanya general-purpose untuk banyak connector, bukan domain-specific service.

### 3.5 Connector Template

Connector Template mendefinisikan bagaimana Connector muncul di Modeler:

- label,
- input fields,
- validation,
- default value,
- secret reference,
- binding ke BPMN element,
- documentation untuk modeler.

Template adalah UX/contract layer antara modeler dan runtime connector.

### 3.6 Connector SDK

Connector SDK memungkinkan kita membuat custom Connector menggunakan Java code. Ia menyembunyikan sebagian detail internal Zeebe/job worker sehingga developer fokus pada logic Connector.

Tetapi jangan salah paham: custom Connector tetap harus didesain dengan reliability mindset yang sama dengan worker, terutama jika melakukan side effect.

---

## 4. Diagram Konseptual: Worker vs Connector

### 4.1 Java Worker Path

```text
+-------------------+       +-------------------+       +-----------------------+
| BPMN Service Task | ----> | Zeebe Job         | ----> | Java Worker App       |
+-------------------+       +-------------------+       +-----------------------+
                                                           |
                                                           v
                                                +-----------------------+
                                                | Domain/Application    |
                                                | Service               |
                                                +-----------------------+
                                                           |
                                                           v
                                                +-----------------------+
                                                | DB / External API     |
                                                +-----------------------+
```

Karakter:

- domain logic kuat,
- aplikasi worker punya ownership jelas,
- idempotency dapat disimpan di DB sendiri,
- cocok untuk complex business transaction,
- butuh deployment dan coding lebih banyak.

### 4.2 Connector Path

```text
+-------------------+       +-------------------+       +-----------------------+
| BPMN Connector    | ----> | Zeebe Job         | ----> | Connector Runtime     |
| Task              |       |                   |       |                       |
+-------------------+       +-------------------+       +-----------------------+
                                                           |
                                                           v
                                                +-----------------------+
                                                | External System       |
                                                +-----------------------+
```

Karakter:

- integrasi lebih reusable,
- konfigurasi lebih dekat ke model,
- cocok untuk simple/standard integration,
- lebih mudah dipakai oleh process modeler,
- riskan jika dipakai untuk logic yang seharusnya dikontrol aplikasi.

---

## 5. Pembedaan Fundamental: Integration Capability vs Business Capability

Salah satu kesalahan arsitektur paling umum adalah menyamakan “call external API” dengan “business capability”.

Misalnya:

```text
Task: Verify Applicant Eligibility
```

Di dalamnya mungkin ada:

- baca application record,
- validasi status,
- panggil government registry,
- simpan verification attempt,
- interpret response,
- apply business rule,
- update case state,
- publish audit event,
- return decision ke process.

Jika task ini dibuat sebagai HTTP Connector langsung ke registry, mungkin terlihat cepat. Tetapi domain semantics hilang.

Lebih tepat:

```text
BPMN Service Task: Verify Applicant Eligibility
    -> Java worker: eligibility-verification-worker
        -> Application DB
        -> Registry API
        -> Idempotency store
        -> Audit log
        -> Domain rule engine
```

Sebaliknya, task seperti ini mungkin cocok sebagai Connector:

```text
BPMN Service Task: Send Slack notification
BPMN Service Task: Send generic email notification
BPMN Service Task: Call webhook with configured payload
BPMN Service Task: Upload generated report to object storage
```

Kuncinya:

```text
Jika task merepresentasikan business capability, gunakan worker/domain service.
Jika task merepresentasikan reusable integration capability, Connector mungkin cocok.
```

---

## 6. Outbound Connector Deep Dive

Outbound Connector memungkinkan process melakukan call ke sistem luar.

Contoh tipe outbound connector:

- REST connector,
- Kafka producer connector,
- email connector,
- cloud storage connector,
- SaaS API connector,
- custom Java connector.

### 6.1 Runtime Flow Outbound Connector

```text
1. Process instance reaches connector task.
2. Zeebe creates job for connector task.
3. Connector runtime activates job.
4. Connector runtime reads input variables and connector configuration.
5. Connector resolves secrets.
6. Connector performs external call.
7. Connector maps response to output variables.
8. Connector completes job or fails/throws error.
9. Process continues or enters error/incident path.
```

### 6.2 What Makes Outbound Connector Attractive

Connector menarik karena:

- modeler dapat mengkonfigurasi integration step,
- tidak perlu membuat worker app untuk setiap HTTP call,
- reusable across process,
- bisa standardize authentication pattern,
- bisa mempercepat prototype,
- cocok untuk low-domain integration.

### 6.3 What Makes Outbound Connector Dangerous

Connector berbahaya jika:

- memanggil endpoint yang non-idempotent,
- error mapping tidak jelas,
- secret tersebar di BPMN/config,
- payload mapping terlalu kompleks,
- business rule tersembunyi di expression/model,
- observability tidak memadai,
- retry menyebabkan duplicate external side effect,
- tidak ada ownership engineering,
- tidak ada contract test.

---

## 7. Inbound Connector Deep Dive

Inbound Connector menerima event dari luar dan menghubungkannya ke process.

Contoh:

```text
External payment callback -> webhook inbound connector -> correlate message
External system event -> Kafka inbound connector -> start/correlate process
External request -> inbound connector -> create process instance
```

### 7.1 Runtime Flow Inbound Connector

```text
1. Connector runtime exposes/monitors inbound source.
2. External system sends event.
3. Connector validates event.
4. Connector maps payload.
5. Connector starts process or publishes/correlates message.
6. Process instance continues.
```

### 7.2 Inbound Connector Design Questions

Sebelum memakai inbound connector, tanyakan:

1. Siapa yang mengautentikasi caller?
2. Bagaimana request signature diverifikasi?
3. Bagaimana replay attack dicegah?
4. Bagaimana duplicate callback ditangani?
5. Bagaimana event ordering dijamin atau diabaikan?
6. Bagaimana payload schema divalidasi?
7. Bagaimana error response ke caller?
8. Apakah inbound endpoint exposed public atau internal?
9. Apakah event harus disimpan dulu sebelum publish ke Camunda?
10. Apakah kita butuh audit raw event?

Jika jawabannya rumit, custom API service + Java worker/message publisher sering lebih aman daripada inbound connector langsung.

---

## 8. Java Worker vs Connector: Decision Matrix

Gunakan matrix berikut sebagai baseline.

| Kriteria | Connector Lebih Cocok | Java Worker Lebih Cocok |
|---|---|---|
| Logic | simple integration | domain-heavy operation |
| Ownership | platform/integration team | product/domain engineering team |
| Reusability | high across processes | specific to domain process |
| Configuration | declarative | code/config driven |
| Idempotency | simple or provided by target | complex, custom, DB-backed |
| Transaction | no local business DB transaction | needs local DB transaction |
| Error taxonomy | generic | business-specific |
| Payload mapping | simple | complex DTO/domain mapping |
| Observability | generic metrics/logs enough | custom trace/audit required |
| Security | standard secret/auth | custom IAM/tenant/ABAC/security logic |
| Change frequency | integration config changes often | business logic changes with code release |
| Testing | connector config test enough | unit/integration/contract test needed |
| Performance | moderate/simple throughput | high throughput/tuned concurrency |
| Compliance | low/medium criticality | high audit defensibility |

Rule of thumb:

```text
Jika failure dari integrasi bisa menyebabkan financial/legal/regulatory damage,
anggap default-nya Java worker sampai terbukti Connector cukup aman.
```

---

## 9. Pattern 1 — Simple Notification Connector

### 9.1 Use Case

Setelah application approved, kirim notifikasi ke channel internal.

```text
Application Approved -> Send Notification -> Continue
```

### 9.2 Kenapa Connector Cocok

- side effect tidak critical terhadap main transaction,
- payload sederhana,
- retry dapat diterima,
- duplicate notification tidak fatal atau bisa ditoleransi,
- reusable across process,
- tidak perlu domain computation berat.

### 9.3 BPMN Shape

```text
[Application Approved]
        |
        v
[Send Notification Connector]
        |
        v
[End]
```

### 9.4 Engineering Guardrails

Tetap perlu:

- correlation id,
- message template version,
- recipient validation,
- duplicate tolerance,
- max retry,
- fallback to incident atau non-blocking boundary path.

### 9.5 Anti-Pattern

Jangan menjadikan notification connector sebagai tempat menentukan approval rule.

Buruk:

```text
Connector decides whether applicant is approved
```

Baik:

```text
Domain service decides approval
Connector only sends notification
```

---

## 10. Pattern 2 — HTTP REST Connector for Low-Risk Integration

### 10.1 Use Case

Process perlu memanggil endpoint internal untuk mengambil reference data non-critical.

```text
Fetch Branch Metadata
Fetch Public Code Table
Fetch Non-sensitive Reference Info
```

### 10.2 Connector Cocok Jika

- endpoint idempotent,
- method GET atau safe POST,
- data tidak sensitive,
- timeout/retry sederhana,
- response mapping sederhana,
- failure bisa diarahkan ke incident/manual repair,
- tidak perlu write transaction lokal.

### 10.3 Connector Tidak Cocok Jika

- endpoint melakukan irreversible side effect,
- perlu request signing custom,
- perlu outbox,
- perlu deduplication store,
- response perlu rule interpretation kompleks,
- error code mapping domain-specific,
- compliance tinggi.

---

## 11. Pattern 3 — Java Worker as Anti-Corruption Layer

### 11.1 Use Case

Process perlu memanggil legacy system yang tidak stabil:

- error code tidak konsisten,
- response schema berubah,
- timeout sering,
- duplicate call berbahaya,
- credential per tenant,
- audit wajib.

### 11.2 Architecture

```text
BPMN Service Task: Submit To Legacy Registry
        |
        v
Java Worker
        |
        +--> Idempotency Store
        +--> Domain Validation
        +--> Legacy API Adapter
        +--> Response Normalizer
        +--> Audit Log
        +--> Result Mapping
```

### 11.3 Kenapa Worker Lebih Baik

Karena worker dapat menjadi anti-corruption layer:

- menormalkan error,
- menyembunyikan quirks legacy,
- menjaga idempotency,
- menyimpan raw/normalized response,
- memberikan domain result yang bersih ke process.

Connector langsung ke legacy API biasanya membuat BPMN model bocor oleh detail teknis legacy.

---

## 12. Pattern 4 — Custom Connector for Reusable Enterprise Integration

### 12.1 Use Case

Organisasi punya banyak process yang perlu memanggil sistem enterprise yang sama.

Contoh:

```text
Send SMS via Corporate Gateway
Create Ticket in Enterprise ITSM
Query Organization Directory
Upload Document to Enterprise DMS
Produce Event to Standard Event Gateway
```

Jika setiap team membuat worker sendiri, hasilnya:

- duplicate implementation,
- inconsistent auth,
- inconsistent retry,
- inconsistent logging,
- inconsistent error mapping.

Custom Connector bisa cocok.

### 12.2 Architecture

```text
BPMN Modeler
    |
    | configures Enterprise SMS Connector
    v
Connector Runtime
    |
    v
Corporate SMS Gateway
```

### 12.3 Syarat Custom Connector yang Baik

Custom Connector harus punya:

- stable template,
- input validation,
- secret reference,
- versioning,
- documented error codes,
- test suite,
- observability,
- ownership team,
- release process,
- backward compatibility policy.

Custom Connector tanpa governance hanya memindahkan kekacauan dari worker ke connector runtime.

---

## 13. Pattern 5 — Hybrid: Connector for Edge Integration, Worker for Domain Decision

Sering kali desain terbaik bukan memilih 100% Connector atau 100% worker, tetapi memisahkan boundary.

Contoh:

```text
[Receive Application]
        |
        v
[Java Worker: Evaluate Eligibility]
        |
        v
[Connector: Send Notification]
        |
        v
[User Task: Officer Review]
        |
        v
[Java Worker: Persist Final Decision]
        |
        v
[Connector: Publish Event to Integration Gateway]
```

Worker dipakai untuk:

- domain decision,
- persistence,
- audit,
- idempotency,
- critical state change.

Connector dipakai untuk:

- notification,
- generic event publication,
- non-critical integration,
- standardized outbound calls.

---

## 14. Pattern 6 — Connector Runtime as Shared Platform Component

Dalam enterprise, connector runtime sebaiknya diperlakukan sebagai platform component, bukan aplikasi sembarangan.

### 14.1 Operational Responsibilities

Connector runtime perlu:

- deployment ownership,
- version control,
- capacity planning,
- log/metric/tracing,
- secret access policy,
- network policy,
- runtime upgrade plan,
- incident response,
- connector allowlist,
- template registry.

### 14.2 Failure Surface

Jika connector runtime down:

```text
Connector jobs tidak diproses
Process berhenti di connector tasks
Operate dapat menunjukkan incidents/timeouts/failures
```

Jika connector runtime overloaded:

```text
activation delay naik
job timeout meningkat
external API pressure naik
backpressure dapat muncul
```

Jika connector runtime salah config secret:

```text
connector fails
incident muncul
process stuck until fixed
```

Connector runtime adalah production workload.

---

## 15. Secret Management

Secret adalah salah satu alasan Connector bisa menjadi berisiko jika governance lemah.

### 15.1 Prinsip

Jangan menaruh credential plain text di BPMN XML.

Gunakan secret reference.

Contoh konseptual:

```text
Bearer token: {{secrets.CORPORATE_API_TOKEN}}
OAuth endpoint: {{secrets.OAUTH_TOKEN_ENDPOINT}}
Client secret: {{secrets.PAYMENT_CLIENT_SECRET}}
```

### 15.2 Secret Scope

Hal yang harus diputuskan:

- secret berlaku per cluster atau per environment?
- siapa boleh membuat secret?
- siapa boleh memakai secret dalam connector?
- bagaimana secret rotation?
- bagaimana audit akses secret?
- bagaimana secret di self-managed disuplai?
- apakah secret sama untuk dev/sit/uat/prod?

### 15.3 Self-Managed Concern

Dalam self-managed environment, secret handling sering terkait Kubernetes Secret, external secret manager, Vault, AWS Secrets Manager, Azure Key Vault, atau mekanisme platform lain.

Jangan menganggap pengalaman secret SaaS otomatis sama dengan self-managed.

### 15.4 Secret Anti-Patterns

Buruk:

```text
- token ditulis di BPMN XML
- token disimpan sebagai normal process variable
- secret dikirim ke worker sebagai visible variable
- semua connector memakai satu super-token
- no rotation plan
- no environment separation
```

Baik:

```text
- secret reference only
- least privilege token
- per integration credential
- environment-specific secret
- rotation tested
- missing secret produces visible incident
- ownership documented
```

---

## 16. Error Handling untuk Connector

Connector error harus dipetakan secara eksplisit.

### 16.1 Error Categories

| Error | Contoh | Handling |
|---|---|---|
| transient technical | timeout, 503, network reset | retry/fail job |
| rate limit | HTTP 429 | backoff/rate control |
| auth/config | 401, missing secret | incident/manual repair |
| business rejection | invalid applicant, duplicate request | BPMN error/domain path |
| schema mismatch | unexpected response | incident + fix mapping |
| poison request | always invalid due to data | BPMN error/manual correction |

### 16.2 Retry Danger

Connector yang melakukan retry terhadap non-idempotent endpoint dapat menyebabkan duplicate side effect.

Contoh berbahaya:

```text
POST /payments
POST /licenses/issue
POST /documents/sign
POST /orders/submit
```

Jika connector timeout setelah endpoint sukses, retry dapat mengirim ulang request.

Solusi:

- target endpoint harus support idempotency key,
- connector harus mengirim idempotency key,
- atau gunakan Java worker dengan dedup store,
- atau gunakan outbox ke integration service.

### 16.3 BPMN Error vs Job Failure

Connector sebaiknya membedakan:

```text
business condition -> BPMN error / modelled alternative flow
technical failure -> job failure / retry / incident
```

Jangan melempar technical timeout sebagai BPMN error “FAILED”. Itu akan membuat BPMN memproses outage sebagai business decision.

---

## 17. Idempotency untuk Connector

Connector sering terlihat declarative, tetapi side effect tetap side effect.

### 17.1 Idempotency Sources

Idempotency key dapat berasal dari:

```text
businessKey
processInstanceKey
elementInstanceKey
jobKey
externalReferenceId
requestHash
```

Namun hati-hati:

- `jobKey` berubah jika job baru dibuat pada model/version path tertentu,
- `processInstanceKey` stabil untuk instance,
- `businessKey` lebih cocok untuk external system,
- `requestHash` membantu mendeteksi payload berubah,
- `elementInstanceKey` cocok untuk task execution occurrence.

### 17.2 Minimal Connector Idempotency Pattern

Untuk outbound side effect:

```text
idempotencyKey = businessOperation + ':' + businessId + ':' + stepName
```

Contoh:

```text
LICENSE_ISSUANCE:APP-2026-000123:ISSUE_LICENSE
```

Request header:

```text
Idempotency-Key: LICENSE_ISSUANCE:APP-2026-000123:ISSUE_LICENSE
```

External system harus:

- detect duplicate,
- return same result,
- reject conflicting request body,
- expose lookup by idempotency key.

Jika target system tidak support ini, Connector untuk critical side effect menjadi lemah.

---

## 18. Rate Limiting dan Backpressure

Connector dapat menjadi sumber traffic besar ke external system.

### 18.1 Masalah

Process modeler bisa membuat banyak instance yang mencapai Connector task bersamaan.

```text
10,000 process instances -> REST Connector -> external API
```

Jika tidak ada rate control:

- external API terkena spike,
- connector runtime thread pool penuh,
- jobs timeout,
- retries memperparah traffic,
- incident storm terjadi.

### 18.2 Mitigation

Gunakan:

- rate limit per connector type,
- max concurrency,
- backoff untuk 429,
- queueing gateway service,
- Java worker dengan custom throttling,
- bulkhead per external system,
- circuit breaker,
- retry budget.

### 18.3 When Worker Is Better

Jika external API punya strict limit seperti:

```text
300 request/minute per tenant
10 concurrent requests max
daily quota
burst limit
```

Java worker sering lebih baik karena kita dapat membuat:

- distributed rate limiter,
- Redis/token bucket,
- tenant-aware throttling,
- adaptive backoff,
- circuit breaker,
- integration-specific metrics.

---

## 19. Connector dan Transaction Boundary

Connector runtime biasanya tidak berada dalam transaction boundary domain database kamu.

Jika task harus melakukan:

```text
1. update local business table
2. call external system
3. write audit record
4. publish domain event
5. complete process step
```

Maka Connector bukan tempat natural untuk logic itu.

Lebih baik Java worker:

```text
Worker transaction:
    - validate command
    - insert idempotency row
    - update business state
    - insert outbox event
    - commit
Outbox publisher:
    - call external system / publish event
Worker/process continuation:
    - complete job when safe
```

Atau:

```text
Worker calls domain service API
Domain service owns transaction/outbox
Worker maps result to process
```

Connector cocok jika process step tidak perlu local business transaction.

---

## 20. Observability untuk Connector

Connector harus observable seperti worker.

Minimal log fields:

```text
processDefinitionId
processInstanceKey
elementId
elementInstanceKey
jobKey
connectorType
connectorVersion
correlationId
businessKey
tenantId
externalSystem
externalRequestId
status
latencyMs
errorCategory
```

Minimal metrics:

```text
connector_requests_total{connectorType,status}
connector_latency_seconds{connectorType}
connector_failures_total{connectorType,errorCategory}
connector_retries_total{connectorType}
connector_rate_limited_total{connectorType}
connector_active_jobs{connectorType}
connector_timeout_total{connectorType}
```

Minimal tracing:

```text
Process step span
Connector execution span
External HTTP/Kafka/SaaS span
```

Jika Connector bawaan tidak memberikan observability detail yang kamu butuhkan untuk audit/regulatory production support, pertimbangkan custom Connector atau Java worker.

---

## 21. Governance: Jangan Biarkan BPMN Menjadi Shadow Integration Platform

Tanpa governance, Connector dapat membuat BPMN model menjadi tempat tersembunyi untuk:

- endpoint URL,
- token,
- transformation logic,
- business routing,
- retry behaviour,
- data leakage,
- uncontrolled integration.

### 21.1 Connector Governance Checklist

Setiap Connector harus punya:

1. Owner.
2. Purpose.
3. Allowed environments.
4. Allowed endpoints.
5. Secret policy.
6. Error policy.
7. Retry policy.
8. Idempotency policy.
9. Observability policy.
10. Versioning policy.
11. Security review.
12. Performance limits.
13. Test plan.
14. Operational runbook.
15. Deprecation plan.

### 21.2 Connector Allowlist

Untuk enterprise, gunakan allowlist:

```text
Allowed:
- corporate-notification-connector
- corporate-email-connector
- corporate-event-publisher-connector
- reference-data-rest-connector

Restricted:
- generic REST connector to arbitrary URL
- arbitrary webhook connector exposed publicly
- direct database connector
- connector with inline credential
```

Generic REST Connector sangat powerful, tetapi juga berisiko menjadi escape hatch yang melewati architecture review.

---

## 22. Custom Connector vs Shared Java Worker Library

Kadang kita ingin reuse integration logic. Ada dua opsi:

```text
Option A: Custom Connector
Option B: Shared Java library used by workers
```

### 22.1 Custom Connector Cocok Jika

- dipakai langsung oleh process modeler,
- konfigurasi perlu muncul di Modeler UI,
- integrasi reusable lintas team,
- logic relatif generic,
- platform team punya ownership,
- runtime connector dikelola baik.

### 22.2 Shared Worker Library Cocok Jika

- integrasi tetap butuh domain-specific worker,
- logic perlu digabung dengan DB transaction,
- worker app punya domain ownership,
- konfigurasi tidak perlu di Modeler,
- setiap domain punya error mapping berbeda,
- testing domain lebih penting daripada configurability.

### 22.3 Decision

```text
Need modeler-level reusable integration? -> Custom Connector
Need domain-level reusable technical client? -> Shared Java library
```

---

## 23. Custom Connector SDK: Mental Model

Custom Connector SDK memungkinkan kamu menulis Java code untuk Connector.

Namun custom Connector bukan berarti “worker biasa dengan nama berbeda”.

Perbedaannya:

| Aspek | Custom Connector | Java Worker |
|---|---|---|
| Exposed to Modeler | yes | usually no |
| Configured in BPMN | yes | job type + variables |
| Runtime | connector runtime | worker app |
| Ownership | platform/integration | domain/application |
| Reuse | broad | domain-specific |
| Logic style | integration operation | business capability |
| Template | important | optional/no |

### 23.1 Custom Connector Structure Conceptually

```text
connector/
  src/main/java/
    CorporateSmsConnector.java
    CorporateSmsRequest.java
    CorporateSmsResponse.java
    CorporateSmsProperties.java
    CorporateSmsErrorMapper.java
  src/main/resources/
    element-templates/
      corporate-sms-connector.json
  tests/
    CorporateSmsConnectorTest.java
```

### 23.2 Template Responsibilities

Template should define:

- name,
- icon/category,
- input fields,
- required fields,
- secret fields,
- validation patterns,
- output mapping hints,
- version,
- documentation.

### 23.3 Connector Implementation Responsibilities

Implementation should handle:

- input validation,
- secret resolution,
- external call,
- timeout,
- error mapping,
- response mapping,
- logging,
- metrics,
- testability.

---

## 24. Connector Template Design

Connector template adalah contract untuk user/modeler.

Buruk:

```text
Field: URL
Field: Body
Field: Headers
Field: Token
```

Ini hanya generic HTTP client di BPMN.

Baik:

```text
Corporate SMS Connector
- recipientNumber
- messageTemplateId
- templateVariables
- priority
- idempotencyKey
- tenantCode
- callbackExpected
```

Kenapa lebih baik?

Karena template mengangkat domain integrasi ke level yang aman dan reusable, bukan membiarkan semua orang memasukkan raw URL dan token.

### 24.1 Template Validation

Template harus memvalidasi:

- required fields,
- allowed enum,
- pattern format,
- max length,
- secret reference field,
- environment-specific restriction,
- output mapping structure.

### 24.2 Template Versioning

Jangan mengubah template field sembarangan.

Gunakan versioning:

```text
corporate-sms-connector:v1
corporate-sms-connector:v2
```

Support backward compatibility untuk process lama.

---

## 25. Connector Security Model

Security Connector mencakup:

- authentication ke external system,
- authorization siapa boleh memakai Connector,
- secret handling,
- input validation,
- output masking,
- network egress control,
- tenant isolation,
- audit log.

### 25.1 Threats

| Threat | Contoh |
|---|---|
| credential leakage | token ditaruh di BPMN XML |
| SSRF-like misuse | REST connector call arbitrary internal URL |
| data exfiltration | connector kirim PII ke endpoint tidak sah |
| privilege escalation | low-privilege modeler memakai high-privilege connector |
| replay | inbound webhook dipanggil ulang |
| injection | expression/payload tidak divalidasi |
| tenant bleed | secret tenant A dipakai process tenant B |

### 25.2 Controls

Gunakan:

- connector allowlist,
- endpoint allowlist,
- secret reference only,
- per-tenant credentials,
- network policy,
- mTLS/private egress,
- payload validation,
- output masking,
- audit trail,
- approval workflow untuk connector usage.

---

## 26. Testing Connectors

Testing Connector tidak cukup dengan “model deploy berhasil”.

### 26.1 Test Layers

```text
1. Template validation test
2. Connector unit test
3. External API contract test
4. Runtime integration test
5. BPMN process test
6. Failure mode test
7. Security test
8. Load/rate-limit test
```

### 26.2 Test Cases

Untuk REST-like connector:

- success response,
- timeout,
- 400 business error,
- 401 auth error,
- 403 forbidden,
- 404 semantic handling,
- 409 duplicate/conflict,
- 429 rate limit,
- 500 retryable,
- malformed JSON,
- missing field,
- huge response,
- invalid secret,
- duplicate request with same idempotency key,
- duplicate request with different body.

### 26.3 BPMN-level Test

Test process path:

```text
Connector success -> process continues
Connector business error -> boundary error path
Connector technical failure -> incident/retry
Connector timeout -> retry/backoff
```

---

## 27. Integration Patterns Catalog

### 27.1 Fire-and-Forget Notification

```text
Process -> Connector -> notification system
```

Use when duplicate is tolerable.

### 27.2 Request/Response Read

```text
Process -> Connector GET/reference API -> variables
```

Use when idempotent and low-risk.

### 27.3 Command with Idempotency

```text
Process -> Java worker -> external command API with idempotency
```

Use when side effect matters.

### 27.4 Async Callback

```text
Process -> Java worker sends request
Process waits message
Callback API/inbound connector publishes message
```

Use when external system is asynchronous.

### 27.5 Event Publication

```text
Process -> Connector/worker -> event gateway/Kafka
```

Use Connector if generic event publication is standardized. Use worker if event is domain transaction output.

### 27.6 Integration Gateway

```text
Process -> Worker -> Internal Integration Gateway -> External Systems
```

Use when enterprise wants central policy, rate limiting, credential isolation, and audit.

### 27.7 Polling External System

Usually avoid direct BPMN polling loops. Prefer:

```text
External event/callback -> message correlation
```

or controlled worker with rate limit.

---

## 28. When Generic REST Connector Is Good

Generic REST Connector is good for:

- internal prototype,
- low-risk reference calls,
- non-sensitive notification,
- temporary proof-of-concept,
- controlled endpoint allowlist,
- process owned by technical team,
- stable API with idempotency,
- clear timeout and error handling.

## 29. When Generic REST Connector Is Dangerous

Generic REST Connector is dangerous for:

- payment,
- license issuance,
- enforcement action,
- regulatory decision,
- user identity mutation,
- irreversible update,
- external API with weak idempotency,
- PII-heavy payload,
- tenant-specific security,
- complex error mapping,
- high throughput.

In those cases, use Java worker or custom Connector with strong governance.

---

## 30. Regulatory Workflow Perspective

Dalam regulatory/case management system, Connector usage harus lebih konservatif.

Contoh workflow:

```text
Application Submitted
    -> Validate Completeness
    -> Query External Registry
    -> Officer Review
    -> Issue License
    -> Notify Applicant
    -> Publish Audit Event
```

Potential design:

| Step | Recommended Implementation | Reason |
|---|---|---|
| Validate Completeness | Java worker/domain service | domain rule, audit |
| Query External Registry | Java worker or custom connector | depends on idempotency/security |
| Officer Review | User task/custom UI | human decision |
| Issue License | Java worker | critical side effect |
| Notify Applicant | Connector | notification integration |
| Publish Audit Event | worker/outbox or governed connector | audit criticality |

Regulatory rule:

```text
Any step that changes legal/regulatory state should not be hidden inside a generic Connector.
```

---

## 31. Modelling Implications

Connector usage affects BPMN readability.

### 31.1 Bad Model

```text
[REST Call]
[REST Call]
[REST Call]
[REST Call]
[REST Call]
```

This model says nothing about business meaning.

### 31.2 Better Model

```text
[Verify Applicant Identity]
[Check Regulatory Eligibility]
[Request Missing Information]
[Issue Approval Letter]
[Notify Applicant]
```

Under the hood:

- some tasks use workers,
- some use connectors,
- some are human tasks,
- some are message waits.

BPMN should communicate business process, not HTTP plumbing.

---

## 32. Versioning and Change Management

Connector changes can break running process instances.

### 32.1 What Can Break

- field renamed,
- secret name changed,
- response mapping changed,
- error code changed,
- connector runtime upgraded,
- external API changed,
- template version changed,
- old process version still uses old config.

### 32.2 Strategy

Use:

- versioned connector templates,
- backward-compatible fields,
- deprecation period,
- release note,
- process compatibility testing,
- canary deployment,
- rollback plan,
- support for old connector version while old process instances run.

In Camunda 8.9, inbound connector activation improvements allow inbound connectors to remain active for older process versions with running instances, which matters because old process instances may still depend on previous integration behaviour.

---

## 33. Performance Considerations

### 33.1 Connector Runtime Capacity

Evaluate:

- number of active connector jobs,
- external call latency,
- runtime thread model,
- memory pressure,
- payload size,
- response size,
- retry burst,
- outbound connection pool,
- DNS/TLS overhead,
- rate limit.

### 33.2 Virtual Threads Context

Camunda 8.9 release notes mention Connector runtime adopting virtual threads by default for better scalability. This can improve scalability for blocking IO-heavy connector workloads, but it does not remove external system limits, idempotency requirements, retry storms, or memory/payload discipline.

Virtual threads help with concurrency economics, not with correctness.

### 33.3 External System Is Usually the Bottleneck

Even if Connector runtime can run many concurrent operations, the target may not handle it.

So capacity planning should include:

```text
Camunda job production rate
Connector activation rate
Connector runtime concurrency
External API capacity
Retry/backoff behaviour
Failure storm scenario
```

---

## 34. Anti-Patterns

### 34.1 Everything as REST Connector

Symptoms:

- BPMN full of technical REST tasks,
- domain service bypassed,
- no idempotency,
- credentials scattered,
- error mapping inconsistent.

### 34.2 Connector Holds Business Logic

Symptoms:

- template has business rules,
- Connector maps many domain decisions,
- changes require template/runtime updates,
- modeler accidentally changes legal behaviour.

### 34.3 Inline Secrets

Symptoms:

- tokens in BPMN XML,
- environment values committed to Git,
- secrets visible in model history.

### 34.4 Retry Everything

Symptoms:

- duplicate side effects,
- retry storm,
- rate limit amplified,
- incidents delayed.

### 34.5 Generic Connector Without Ownership

Symptoms:

- nobody owns failure,
- platform says “process team configured it”,
- process team says “platform connector failed”,
- production support stuck.

### 34.6 Projection-Driven Integration

Bad:

```text
Connector queries Operate/Tasklist projection to decide command
```

Reason:

- projection can lag,
- not command source of truth,
- can cause stale decision.

---

## 35. Practical Decision Framework

Before choosing Connector or Java worker, answer these questions.

### 35.1 Business Criticality

```text
Does this step change business/legal/financial/regulatory state?
```

If yes, prefer Java worker/domain service unless Connector is highly governed and idempotent.

### 35.2 Idempotency

```text
Can the operation be retried safely after unknown outcome?
```

If no, prefer Java worker with idempotency store or outbox.

### 35.3 Error Semantics

```text
Are errors generic technical failures or domain-specific decisions?
```

Domain-specific means worker/custom code.

### 35.4 Security

```text
Does this integration require tenant-specific credentials, ABAC, signing, or payload masking?
```

If yes, generic connector may be insufficient.

### 35.5 Observability

```text
Can we debug production incident with available connector logs/metrics?
```

If no, build custom Connector or worker.

### 35.6 Reuse

```text
Will many process teams use this integration in the same way?
```

If yes, custom Connector may be better than many custom workers.

### 35.7 Governance

```text
Can we control who configures this connector and where it can send data?
```

If no, avoid generic Connector in production.

---

## 36. Reference Architecture: Governed Connector Platform

```text
+-----------------------------+
| BPMN Models                 |
| - approved templates only   |
+-------------+---------------+
              |
              v
+-----------------------------+
| Camunda 8 / Zeebe           |
| - process execution         |
| - connector jobs            |
+-------------+---------------+
              |
              v
+-----------------------------+
| Connector Runtime           |
| - allowed connector set     |
| - metrics/logs/traces       |
| - secret resolution         |
+-------------+---------------+
              |
              v
+-----------------------------+
| Integration Control Layer   |
| - egress policy             |
| - API gateway               |
| - rate limit                |
| - mTLS                      |
+-------------+---------------+
              |
              v
+-----------------------------+
| External Systems            |
| - SaaS                      |
| - internal APIs             |
| - event brokers             |
+-----------------------------+
```

For critical domain operations:

```text
+-----------------------------+
| BPMN Service Task           |
+-------------+---------------+
              |
              v
+-----------------------------+
| Java Worker App             |
| - domain adapter            |
| - idempotency               |
| - audit                     |
| - transaction boundary      |
+-------------+---------------+
              |
              v
+-----------------------------+
| Domain Service / DB / API   |
+-----------------------------+
```

---

## 37. Sample Decision Examples

### 37.1 Send Email to Applicant

Decision: Connector likely okay.

Reason:

- reusable,
- side effect tolerates duplicate with message id,
- simple payload,
- no complex domain transaction.

Guardrails:

- template id,
- recipient validation,
- idempotency key,
- audit event.

### 37.2 Issue License Number

Decision: Java worker.

Reason:

- legal/regulatory state change,
- must be idempotent,
- must update DB/audit,
- must handle duplicate/unknown outcome,
- likely needs domain transaction.

### 37.3 Query Static Reference Data

Decision: REST Connector or worker depending on sensitivity.

Connector if:

- GET/idempotent,
- low risk,
- simple mapping.

Worker if:

- response affects legal decision,
- needs audit,
- needs fallback/cache.

### 37.4 Publish Domain Event to Kafka

Decision: depends.

Connector if:

- event is generic notification after process milestone,
- duplicate acceptable or broker-level idempotency configured.

Worker/outbox if:

- event must be transactionally coupled to domain DB update.

### 37.5 Receive Payment Callback

Decision: usually custom API/inbound handling + message correlation, not naive inbound connector.

Reason:

- signature verification,
- replay protection,
- duplicate callback,
- raw payload audit,
- payment state reconciliation.

---

## 38. Production Readiness Checklist

A Connector is production-ready if:

- [ ] purpose is clear,
- [ ] owner is defined,
- [ ] template is versioned,
- [ ] secret policy exists,
- [ ] endpoint allowlist exists,
- [ ] network egress controlled,
- [ ] input validation defined,
- [ ] output mapping defined,
- [ ] error taxonomy defined,
- [ ] retry/backoff defined,
- [ ] idempotency story defined,
- [ ] observability fields defined,
- [ ] metrics dashboards exist,
- [ ] incident runbook exists,
- [ ] old process versions considered,
- [ ] load test completed,
- [ ] security review completed,
- [ ] audit requirements satisfied,
- [ ] rollback plan exists.

A Java worker is better if any of these are missing for a critical operation.

---

## 39. Staff-Level Heuristics

1. Do not use Connector just because it avoids writing code.
2. Do not use worker just because engineering distrusts modelers.
3. Connector is best for standardized integration capability.
4. Worker is best for domain capability.
5. Generic REST Connector should be restricted in production.
6. Secret reference is mandatory, not optional.
7. Retry without idempotency is a bug waiting to happen.
8. Connector runtime must be operated like a production service.
9. Critical side effects need deduplication or reconciliation.
10. BPMN should show business meaning, not raw transport calls.
11. If an integration needs a runbook, owner, dashboard, and security review, treat it as a product capability.
12. If modeler-level configurability can break compliance, restrict it.
13. Custom Connector is platform product engineering.
14. Java worker is application/domain engineering.
15. The best architecture often uses both.

---

## 40. Mini Case Study: Bad vs Good Design

### 40.1 Bad Design

```text
[Receive Application]
  -> [REST Connector: POST /validate]
  -> [REST Connector: POST /registry/check]
  -> [REST Connector: POST /license/issue]
  -> [REST Connector: POST /email/send]
```

Problems:

- no domain boundary,
- no idempotency for license issuance,
- endpoint details leak into BPMN,
- process readability low,
- generic retry can duplicate side effects,
- security governance unclear,
- audit scattered.

### 40.2 Better Design

```text
[Receive Application]
  -> [Worker: Validate Application]
  -> [Worker: Check Registry Eligibility]
  -> [User Task: Officer Review]
  -> [Worker: Issue License]
  -> [Connector: Send Applicant Notification]
```

Worker responsibilities:

- domain validation,
- transaction boundary,
- idempotency,
- audit,
- error mapping.

Connector responsibility:

- reusable notification integration.

### 40.3 Best Enterprise Design

```text
[Receive Application]
  -> [Worker: Validate Application]
  -> [Worker: Check Registry Eligibility]
  -> [User Task: Officer Review]
  -> [Worker: Issue License]
  -> [Corporate Notification Connector]
  -> [Corporate Event Publisher Connector]
```

Here, Connectors are not generic arbitrary integrations. They are governed enterprise capabilities.

---

## 41. How This Connects to Previous Parts

From Part 006:

- worker lifecycle matters.
- Connector runtime also has lifecycle and capacity concerns.

From Part 007:

- idempotency matters.
- Connector side effect also needs idempotency.

From Part 008:

- variable discipline matters.
- Connector input/output mapping must not become payload dumping ground.

From Part 009:

- BPMN should model business process.
- Connector should not turn BPMN into technical call graph.

From Part 010:

- message and correlation design matters.
- inbound connector must respect correlation safety.

From Part 011:

- error semantics matter.
- Connector must distinguish business error and technical failure.

From Part 012:

- timer/deadline semantics matter.
- connector timeout is not business deadline.

From Part 013:

- human workflow needs audit and assignment control.
- Connector should not bypass human decision governance.

From Part 014–015:

- Spring/worker architecture gives domain control.
- Connector gives reusable integration control.

---

## 42. Summary

Connector is a powerful Camunda 8 capability, but it must be treated as part of architecture, not convenience tooling.

The core distinction:

```text
Connector = integration capability
Worker = domain execution capability
```

Use Connector when:

- integration is simple,
- reusable,
- declarative,
- low/medium risk,
- governed,
- secret-safe,
- idempotent or duplicate-tolerant.

Use Java worker when:

- operation is business-critical,
- side effect is irreversible,
- transaction boundary matters,
- domain error semantics matter,
- idempotency is complex,
- compliance/audit is strict,
- custom observability is required.

The top engineering mistake is asking:

```text
Can this be done with Connector?
```

The better question is:

```text
Where should this integration responsibility live so that correctness, ownership,
security, observability, and change control remain defensible in production?
```

That question separates API usage from architecture.

---

## 43. Apa yang Akan Dibahas Berikutnya

Part berikutnya:

```text
learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-017.md
```

Judul:

```text
Part 017 — Exporters, Elasticsearch/OpenSearch, Operate, Tasklist, and Read-Side Architecture
```

Kita akan membahas read-side architecture Camunda 8:

- exporter mental model,
- record export,
- Elasticsearch/OpenSearch projection,
- Operate as operational projection,
- Tasklist as task projection,
- Optimize as analytics projection,
- projection lag,
- read-your-writes illusion,
- custom exporter,
- audit trail architecture,
- compliance read model.

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-015.md">⬅️ Part 015 — Worker Application Architecture: Hexagonal Boundaries, Ports, Adapters, and Contract Isolation</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-8-zeebe-cloud-native-process-orchestration-engineering-part-017.md">Part 017 — Exporters, Elasticsearch/OpenSearch, Operate, Tasklist, and Read-Side Architecture ➡️</a>
</div>
