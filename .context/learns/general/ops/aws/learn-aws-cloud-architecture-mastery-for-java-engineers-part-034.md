# learn-aws-cloud-architecture-mastery-for-java-engineers-part-034.md

# Part 034 — AWS Architecture Review Method: How Top Engineers Evaluate Designs

> Seri: `learn-aws-cloud-architecture-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin mampu mengevaluasi desain AWS secara tajam, defensible, dan production-grade.  
> Fokus: metode review arsitektur AWS; bukan katalog service baru.

---

## 0. Tujuan Bagian Ini

Setelah banyak part sebelumnya membahas building block AWS, bagian ini menjawab pertanyaan yang lebih senior:

> Bagaimana seorang engineer mengevaluasi apakah desain AWS itu benar-benar baik?

Bukan hanya:

- apakah service-nya “best practice”;
- apakah diagramnya terlihat cloud-native;
- apakah semua komponen memakai managed service;
- apakah ada autoscaling;
- apakah ada encryption;
- apakah ada monitoring.

Tetapi:

- apakah desainnya cocok dengan business criticality;
- apakah workload boundary-nya jelas;
- apakah failure mode-nya diketahui;
- apakah data loss scenario-nya dapat dijelaskan;
- apakah operational model-nya realistis;
- apakah security model-nya bisa diaudit;
- apakah cost-nya sebanding dengan value;
- apakah desain bisa berubah tanpa merusak sistem;
- apakah keputusan arsitektur bisa dipertahankan di depan auditor, incident review, engineering review, dan business stakeholder.

AWS Well-Architected Framework menyediakan enam pilar untuk mengevaluasi workload: operational excellence, security, reliability, performance efficiency, cost optimization, dan sustainability. Framework ini bukan checklist dekoratif, tetapi struktur untuk menilai trade-off desain secara konsisten.

Namun top engineer tidak sekadar menjawab pertanyaan Well-Architected secara mekanis. Mereka memakai framework sebagai alat berpikir untuk menemukan risiko, menghubungkan risiko dengan consequence, lalu membuat improvement plan.

---

## 1. Architecture Review Bukan Approval Ceremony

Banyak organisasi membuat architecture review menjadi forum formal yang terasa seperti pengadilan desain.

Gejalanya:

- tim datang membawa diagram;
- reviewer mencari kekurangan;
- diskusi berubah menjadi debat service preference;
- keputusan akhir berupa “approved” atau “rejected”;
- risiko sebenarnya tidak tercatat;
- improvement tidak punya owner;
- setelah production incident, semua orang baru sadar hal penting tidak pernah dibahas.

Architecture review yang sehat bukan ceremony approval.

Architecture review adalah proses untuk:

1. memahami workload;
2. mengidentifikasi assumption;
3. menemukan risiko;
4. mengevaluasi trade-off;
5. membuat keputusan eksplisit;
6. menentukan mitigasi;
7. menyimpan evidence keputusan;
8. membuat sistem lebih mudah dioperasikan.

Review yang baik tidak bertanya:

> Apakah desain ini memakai service yang benar?

Tetapi:

> Untuk requirement, constraint, risk appetite, team maturity, dan expected load ini, apakah desain ini memiliki trade-off yang sadar dan defensible?

---

## 2. Unit Review: Workload, Bukan Diagram

AWS Well-Architected mengevaluasi workload. Ini penting.

Workload bukan sekadar satu aplikasi.

Workload adalah kumpulan komponen yang bersama-sama memberikan business capability.

Contoh workload:

- public case submission API;
- enforcement case management platform;
- document evidence ingestion pipeline;
- tenant billing pipeline;
- regulator reporting subsystem;
- identity and access workflow;
- analytics lake untuk historical case trend;
- notification delivery subsystem.

Satu workload bisa terdiri dari:

- API Gateway;
- ALB;
- ECS;
- Lambda;
- RDS;
- DynamoDB;
- S3;
- SQS;
- Step Functions;
- CloudWatch;
- IAM roles;
- KMS keys;
- deployment pipeline;
- operational runbook.

Review yang salah fokus pada diagram resource.

Review yang benar fokus pada business capability dan user journey.

### Pertanyaan Awal

Sebelum melihat service, tanyakan:

1. Capability apa yang diberikan workload ini?
2. Siapa user-nya?
3. Apa operasi paling kritis?
4. Apa data paling sensitif?
5. Apa akibat jika workload down?
6. Apa akibat jika data hilang?
7. Apa akibat jika data bocor?
8. Apa akibat jika hasilnya lambat?
9. Apa akibat jika biaya naik 10x?
10. Apa bagian yang wajib bisa diaudit?

Tanpa jawaban ini, review service-level tidak bermakna.

---

## 3. Architecture Review Input

Review serius membutuhkan input yang jelas. Minimal:

1. Context summary.
2. Architecture diagram.
3. Data classification.
4. User journey / request flow.
5. Dependency graph.
6. Identity and access model.
7. Failure mode summary.
8. Observability model.
9. Deployment model.
10. Cost model.
11. Operational model.
12. ADR atau keputusan penting.

Jika tim hanya membawa diagram, reviewer harus meminta konteks.

Diagram menunjukkan struktur.

Tetapi tidak selalu menunjukkan:

- why;
- risk;
- behavior under failure;
- data sensitivity;
- ownership;
- operational procedure;
- fallback;
- recovery path;
- cost driver;
- audit evidence.

Top engineer membaca diagram sebagai hipotesis, bukan sebagai kebenaran.

---

## 4. Review Flow: Dari Business ke Failure ke Control

Metode review yang efektif mengikuti urutan ini:

```text
Business capability
        ↓
User journey
        ↓
Data and state
        ↓
Trust boundaries
        ↓
Dependency graph
        ↓
Failure modes
        ↓
Controls and mitigations
        ↓
Operational readiness
        ↓
Cost and sustainability
        ↓
Decision record
```

Urutan ini penting.

Kalau langsung mulai dari “pakai ECS atau Lambda?”, diskusi akan bias service.

Kalau mulai dari “apa failure yang tidak boleh terjadi?”, pilihan service menjadi lebih rasional.

---

## 5. Workload Context Review

Bagian pertama review adalah memahami konteks.

### 5.1 Business Criticality

Klasifikasikan workload:

| Criticality | Contoh | Review Depth |
|---|---|---|
| Experimental | prototype, internal demo | ringan |
| Internal productivity | admin tool non-critical | sedang |
| Customer-facing non-critical | reporting page | sedang |
| Customer-facing critical | payment, case submission | tinggi |
| Regulated/system-of-record | enforcement lifecycle, evidence | sangat tinggi |

Semakin tinggi criticality, semakin kuat requirement untuk:

- audit trail;
- backup/restore;
- DR;
- separation of duties;
- access review;
- observability;
- runbook;
- explicit approval;
- change evidence.

### 5.2 Risk Appetite

Tidak semua workload membutuhkan multi-region active-active.

Tidak semua workload boleh memakai prototype architecture.

Review harus menghubungkan risk appetite dengan architecture.

Contoh:

```text
Workload: public evidence submission API
Risk appetite: low for data loss, medium for temporary unavailability
Architecture consequence:
- S3 versioning enabled
- object metadata persisted transactionally
- DLQ for async processing
- RTO 4 hours
- RPO near zero for submitted evidence
- no need for active-active if business accepts regional recovery
```

Risk appetite yang tidak eksplisit akan berubah menjadi debat opini.

---

## 6. User Journey Review

User journey adalah cara paling cepat menemukan hidden critical path.

Contoh journey:

1. Officer login.
2. Officer opens case.
3. Officer uploads evidence document.
4. System scans document.
5. System extracts metadata.
6. Supervisor approves escalation.
7. System emits audit event.
8. Citizen receives notification.
9. Report becomes visible to regulator.

Untuk setiap step, tanyakan:

- service apa yang terlibat;
- data apa yang berubah;
- siapa principal-nya;
- apa timeout-nya;
- apa retry behavior-nya;
- apakah operation idempotent;
- apa yang terjadi jika step gagal;
- apakah user menerima status yang benar;
- apakah audit event tetap dicatat;
- apakah partial state bisa terjadi.

Review berbasis journey lebih kuat daripada review berbasis komponen, karena failure nyata dirasakan user pada journey.

---

## 7. Data and State Review

State adalah sumber kompleksitas utama.

Review data harus menjawab:

1. Apa source of truth?
2. Apa projection?
3. Apa cache?
4. Apa derived data?
5. Apa audit log?
6. Apa temporary state?
7. Apa immutable evidence?
8. Apa data yang boleh dihapus?
9. Apa data yang harus dipertahankan?
10. Apa data yang encrypted dengan key berbeda?

### 7.1 Source of Truth vs Projection

Contoh:

| Data | Store | Role |
|---|---|---|
| case aggregate | Aurora/RDS | source of truth |
| document binary | S3 | evidence object store |
| audit event | append-only log/S3/DynamoDB | immutable audit trail |
| search index | OpenSearch | projection |
| dashboard metrics | Athena/Redshift | analytical projection |
| session/cache | ElastiCache | transient acceleration |

Review harus memastikan projection tidak diperlakukan sebagai source of truth.

Anti-pattern:

```text
OpenSearch berisi status case terbaru, lalu sistem lain membaca status final dari OpenSearch.
```

Masalah:

- OpenSearch eventually consistent;
- index bisa rebuild;
- document bisa stale;
- query bisa gagal;
- authorization filtering bisa salah.

Untuk regulated system, source of truth harus jelas.

### 7.2 State Transition

Setiap domain state transition harus punya:

- precondition;
- actor;
- timestamp;
- decision reason;
- previous state;
- next state;
- audit event;
- idempotency key;
- rollback/compensation rule.

Jika state transition tidak bisa dijelaskan, workflow belum siap produksi.

---

## 8. Trust Boundary Review

Security review dimulai dari trust boundary.

Boundary yang perlu dipetakan:

1. Human user boundary.
2. Workload identity boundary.
3. Account boundary.
4. VPC/network boundary.
5. Tenant boundary.
6. Data classification boundary.
7. KMS key boundary.
8. CI/CD boundary.
9. Third-party integration boundary.
10. Admin/break-glass boundary.

### 8.1 Pertanyaan Security Review

Untuk setiap boundary:

- siapa principal yang boleh masuk;
- bagaimana principal diautentikasi;
- bagaimana authorization dilakukan;
- policy mana yang enforce;
- apakah ada explicit deny;
- apakah ada privilege escalation path;
- apakah action terekam CloudTrail;
- apakah data terenkripsi;
- siapa bisa decrypt;
- apakah ada access review;
- bagaimana akses darurat dilakukan.

### 8.2 IAM Review Pattern

Untuk setiap workload role, cek:

```text
Role name:
Purpose:
Trusted principal:
Allowed actions:
Allowed resources:
Condition keys:
Permissions boundary:
SCP impact:
CloudTrail evidence:
Rotation/expiry model:
```

Red flags:

- `Action: *`;
- `Resource: *` tanpa alasan kuat;
- trust policy terlalu luas;
- `iam:PassRole` tidak dibatasi;
- KMS key policy membuka root account tanpa guardrail;
- CI/CD role bisa mengubah security baseline;
- application role bisa membaca secret semua environment;
- tenant boundary hanya di aplikasi tanpa guardrail data-level.

---

## 9. Dependency Graph Review

Setiap workload punya dependency graph.

Contoh Java API:

```text
Client
  → CloudFront
  → WAF
  → ALB
  → ECS service
  → Aurora
  → Redis
  → S3
  → SQS
  → Secrets Manager
  → KMS
  → CloudWatch Logs
```

Dependency graph membantu menemukan:

- critical path;
- synchronous dependency;
- hidden availability dependency;
- transitive failure;
- startup dependency;
- deploy-time dependency;
- control-plane dependency;
- cross-AZ/cross-region dependency;
- third-party dependency.

### 9.1 Synchronous vs Asynchronous Dependency

Synchronous dependency mempengaruhi user latency dan availability langsung.

Asynchronous dependency mempengaruhi completion, eventual consistency, dan backlog.

Review harus membedakan keduanya.

Contoh:

```text
CreateCase API synchronously writes Aurora and S3 metadata.
Document indexing is async through SQS and OpenSearch.
Notification is async.
```

Jika OpenSearch down, create case tidak boleh gagal kalau search bukan bagian critical path.

Jika Aurora down, create case gagal karena source of truth tidak tersedia.

### 9.2 Dependency Degradation Matrix

Buat matrix:

| Dependency | Jika Down | User Impact | Mitigation |
|---|---|---|---|
| Aurora | write case gagal | high | Multi-AZ, retry limited, clear error |
| S3 | upload evidence gagal | high | retry multipart, fail before metadata commit |
| OpenSearch | search stale/unavailable | medium | degrade search, async replay |
| SQS | async workflow stuck | medium/high | alarm on send failure, fallback queue not trivial |
| Secrets Manager | startup gagal | high | cache secret, deploy guard |
| CloudWatch Logs | logs missing/delayed | medium | local buffer/agent awareness |

Top engineer tidak hanya bertanya “apakah dependency highly available?” tetapi “apa user-visible behavior saat dependency gagal?”

---

## 10. Failure-Mode Inventory

Failure-mode inventory adalah inti review.

Minimal kategori:

1. Compute failure.
2. Network failure.
3. Dependency failure.
4. Data corruption.
5. Data loss.
6. Authorization failure.
7. Secret failure.
8. Deployment failure.
9. Scaling failure.
10. Quota exhaustion.
11. Cost runaway.
12. Observability blind spot.
13. Human/operator error.
14. Regional impairment.
15. Tenant isolation breach.

### 10.1 Failure Record Template

```text
Failure mode:
Trigger:
Detection signal:
Blast radius:
User impact:
Data impact:
Security impact:
Current mitigation:
Residual risk:
Owner:
Runbook:
Tested? yes/no
```

Jika failure mode tidak punya detection signal, sistem tidak observable.

Jika failure mode tidak punya owner, mitigation kemungkinan tidak terjadi.

Jika failure mode tidak pernah dites, mitigation masih asumsi.

### 10.2 Example: SQS Poison Message

```text
Failure mode: poison message causes repeated processing failure
Trigger: invalid payload or downstream permanent business rule rejection
Detection signal: ApproximateAgeOfOldestMessage rising, DLQ depth > 0
Blast radius: processing pipeline for affected message group / queue
User impact: document processing delayed
Data impact: source evidence remains safe, derived metadata absent
Security impact: none expected
Current mitigation: maxReceiveCount + DLQ + replay tool
Residual risk: DLQ not reviewed during weekend
Owner: platform operations
Runbook: inspect DLQ, classify, replay or mark permanent failure
Tested: yes, quarterly game day
```

Ini jauh lebih berguna daripada sekadar berkata “kami punya DLQ”.

---

## 11. Well-Architected Pillar Review

AWS Well-Architected memiliki enam pilar:

1. Operational Excellence.
2. Security.
3. Reliability.
4. Performance Efficiency.
5. Cost Optimization.
6. Sustainability.

Pillar review bukan checklist pass/fail.

Pillar review adalah cara mengelompokkan risiko.

---

## 12. Operational Excellence Review

Operational excellence menilai apakah tim bisa menjalankan, memahami, memperbaiki, dan mengembangkan workload secara aman.

### 12.1 Pertanyaan Kunci

- Siapa owner workload ini?
- Apa indikator workload healthy?
- Apa indikator business outcome healthy?
- Apa dashboard utama?
- Apa alarm yang membangunkan manusia?
- Apa runbook untuk failure utama?
- Apakah deployment kecil dan reversible?
- Apakah operasi rutin diotomasi?
- Apakah post-incident learning menghasilkan improvement?
- Apakah ada game day?
- Apakah ada versioned operational procedure?

### 12.2 Red Flags

- tidak ada owner jelas;
- dashboard hanya CPU/memory;
- alert tidak membedakan symptom dan cause;
- semua alarm paging;
- runbook tidak pernah dites;
- deployment manual;
- rollback tidak pernah dilakukan;
- incident review mencari siapa yang salah, bukan sistem apa yang lemah;
- tidak ada change record;
- operasi penting hanya diketahui satu orang.

### 12.3 Review Output

Contoh risk:

```text
Risk: Workload memiliki CloudWatch metrics teknis, tetapi tidak memiliki business KPI seperti failed case submission, pending approval age, atau DLQ age. Incident dapat terlambat terdeteksi karena sistem terlihat sehat secara infrastruktur tetapi gagal secara business.
```

Improvement:

```text
Tambahkan business metrics dan alarm untuk case submission failure rate, pending workflow age, DLQ depth, and oldest unprocessed event age. Buat dashboard journey-level.
```

---

## 13. Security Review

Security pillar mengevaluasi kemampuan workload melindungi data, sistem, dan asset.

### 13.1 Pertanyaan Kunci

- Apa data paling sensitif?
- Siapa bisa membaca data itu?
- Siapa bisa mengubah data itu?
- Siapa bisa decrypt data itu?
- Apakah access dapat diaudit?
- Apakah identity memakai temporary credential?
- Apakah workload role least privilege?
- Apakah secret pernah muncul di log?
- Apakah public exposure intentional?
- Apakah egress dibatasi?
- Apakah tenant isolation hanya di aplikasi?
- Apakah break-glass access terekam?
- Apakah CloudTrail organization trail aktif?
- Apakah KMS key policy bisa menyebabkan lockout?

### 13.2 Red Flags

- public S3 bucket tanpa alasan;
- security group inbound `0.0.0.0/0` ke port internal;
- admin role dipakai pipeline;
- production secret dibaca dari laptop developer;
- application role bisa decrypt semua key;
- CloudTrail tidak centralized;
- KMS key deletion tidak dikontrol;
- no data classification;
- tenant ID hanya parameter request tanpa enforcement;
- audit log mutable.

### 13.3 Review Output

Risk:

```text
Risk: ECS task role untuk case service memiliki akses `secretsmanager:GetSecretValue` ke path seluruh environment. Bug atau compromise di service dev berpotensi membaca secret staging/prod jika role trust/policy salah di future deployment.
```

Improvement:

```text
Batasi resource ARN ke `/prod/case-service/*`, tambahkan condition `aws:ResourceTag/Environment=prod`, pisahkan account environment, dan tambahkan IAM Access Analyzer review.
```

---

## 14. Reliability Review

Reliability pillar menilai apakah workload menjalankan fungsi yang diharapkan secara benar dan konsisten sepanjang lifecycle.

### 14.1 Pertanyaan Kunci

- Apa RTO/RPO per capability?
- Apakah semua critical state punya backup?
- Apakah restore pernah dites?
- Apa dependency paling rapuh?
- Apa single point of failure?
- Apa quota yang bisa habis?
- Apakah retry bisa memperburuk outage?
- Apakah idempotency diterapkan pada write path?
- Apakah Multi-AZ benar-benar end-to-end?
- Apakah health check merepresentasikan readiness?
- Apakah sistem bisa degrade gracefully?
- Apakah DR runbook realistis?

### 14.2 Red Flags

- “kami pakai managed service, jadi reliable”;
- backup ada, restore tidak pernah dites;
- retry tanpa jitter;
- all-or-nothing synchronous path;
- DLQ ada tapi tidak dimonitor;
- health check hanya `/ping`;
- RTO/RPO tidak diketahui;
- satu NAT Gateway untuk semua AZ critical workloads;
- quota tidak dipantau;
- migration rollback tidak jelas.

### 14.3 Review Output

Risk:

```text
Risk: Evidence upload metadata disimpan di database setelah S3 upload, tetapi tidak ada reconciliation job untuk object orphan atau metadata missing. Network timeout setelah S3 success dapat menghasilkan uncertain commit state.
```

Improvement:

```text
Gunakan upload session ID, idempotency key, object tagging, metadata transaction, dan scheduled reconciliation untuk object without committed metadata dan metadata without object.
```

---

## 15. Performance Efficiency Review

Performance efficiency menilai apakah workload memakai resource secara efisien untuk memenuhi requirement performance.

### 15.1 Pertanyaan Kunci

- Apa latency budget per journey?
- Apa p95/p99 target?
- Apa throughput target?
- Apa concurrency target?
- Apa bottleneck yang diasumsikan?
- Apakah autoscaling metric cocok?
- Apakah connection pool selaras dengan downstream capacity?
- Apakah cache correctness aman?
- Apakah payload size masuk akal?
- Apakah workload region dekat user?
- Apakah async processing punya backlog SLO?

### 15.2 Red Flags

- hanya mengukur average latency;
- autoscaling berdasarkan CPU padahal bottleneck adalah request queue;
- cache tanpa invalidation model;
- Lambda Java cold start untuk synchronous latency-critical path tanpa mitigasi;
- connection pool terlalu besar dan membunuh database saat scale out;
- N+1 call ke AWS API;
- large payload melewati API Gateway tanpa alasan;
- no load test before production.

### 15.3 Review Output

Risk:

```text
Risk: ECS service autoscaling menggunakan CPU 70%, tetapi latency p99 naik karena thread pool menunggu database connection. CPU tetap rendah sehingga autoscaling tidak bereaksi.
```

Improvement:

```text
Tambahkan custom metric untuk in-flight request, connection pool wait time, ALB target response time, dan request queue depth. Review pool sizing terhadap max database connection.
```

---

## 16. Cost Optimization Review

Cost optimization menilai apakah workload menghasilkan business value dengan biaya yang terukur dan terkendali.

### 16.1 Pertanyaan Kunci

- Apa unit ekonomi workload?
- Cost per tenant?
- Cost per case?
- Cost per document?
- Cost per workflow execution?
- Apa top 5 cost driver?
- Apakah tagging cukup untuk attribution?
- Apakah non-prod environment punya schedule?
- Apakah log retention sesuai kebutuhan?
- Apakah data transfer dipahami?
- Apakah NAT Gateway cost muncul dari arsitektur?
- Apakah scaling bisa runaway?
- Apakah ada budget/alert?

### 16.2 Red Flags

- tidak ada tag ownership;
- semua log disimpan selamanya;
- debug log aktif di production;
- cross-AZ traffic besar tanpa disadari;
- NAT Gateway menjadi top cost karena private workload menarik artifact besar dari internet;
- overprovisioned database;
- no Cost Explorer review;
- tenant mahal tidak teridentifikasi;
- retry storm menaikkan biaya.

### 16.3 Review Output

Risk:

```text
Risk: Document processing pipeline menyimpan raw, intermediate, dan processed files tanpa lifecycle policy. Storage cost akan tumbuh linear tanpa retention boundary.
```

Improvement:

```text
Definisikan retention berdasarkan data classification. Terapkan S3 lifecycle untuk intermediate artifacts, Glacier transition untuk immutable evidence sesuai policy, dan dashboard cost per document.
```

---

## 17. Sustainability Review

Sustainability sering dianggap sekunder, tetapi sebenarnya berhubungan dengan efficiency.

### 17.1 Pertanyaan Kunci

- Apakah resource idle dimatikan?
- Apakah data yang tidak perlu tetap diproses?
- Apakah retention berlebihan?
- Apakah workload right-sized?
- Apakah caching mengurangi repeated computation?
- Apakah batch window bisa dioptimalkan?
- Apakah Graviton layak diuji?
- Apakah environment non-prod always-on tanpa alasan?

### 17.2 Red Flags

- non-prod berjalan 24/7 tanpa kebutuhan;
- pipeline reprocess semua data untuk perubahan kecil;
- query analytics scan seluruh data lake;
- high-cardinality logs disimpan lama;
- overprovisioned compute;
- no lifecycle policy.

Sustainability bukan hanya moral goal. Ia sering menurunkan cost dan meningkatkan operational clarity.

---

## 18. Risk Classification

Setelah review, risiko harus diklasifikasi.

Gunakan kombinasi:

```text
Likelihood × Impact × Detectability × Recoverability
```

### 18.1 Risk Level

| Level | Definisi |
|---|---|
| Critical | dapat menyebabkan data loss, breach, outage besar, compliance failure |
| High | dapat menyebabkan user-impacting incident atau significant operational risk |
| Medium | dapat menyebabkan degradation atau operational friction |
| Low | improvement quality/cost/maintainability |

### 18.2 Jangan Semua Risiko Disebut High

Jika semua risiko high, tidak ada prioritas.

Risk statement yang baik memiliki consequence spesifik.

Buruk:

```text
Security group terlalu terbuka.
```

Baik:

```text
Security group admin interface membuka port internal dari 0.0.0.0/0. Jika credential aplikasi bocor atau endpoint ditemukan, attacker dapat mencoba akses interface admin tanpa melewati private network control. Impact: unauthorized admin access attempt. Mitigation: restrict to VPN/private subnet, WAF not sufficient for non-HTTP admin port.
```

---

## 19. Architecture Decision Record Review

ADR bukan birokrasi. ADR adalah memory sistem.

Setiap keputusan besar harus menjawab:

```text
Decision:
Context:
Options considered:
Chosen option:
Reasoning:
Consequences:
Risks accepted:
Mitigations:
Review date:
Owner:
```

### 19.1 Keputusan yang Wajib Punya ADR

- compute platform utama;
- database utama;
- multi-account strategy;
- tenant isolation model;
- KMS key granularity;
- sync vs async processing;
- DR strategy;
- API exposure pattern;
- migration strategy;
- deployment strategy;
- data retention policy;
- observability standard;
- IaC tool choice.

Tanpa ADR, keputusan akan hilang dan tim berikutnya akan mengulang debat.

---

## 20. Architecture Review Checklist

Checklist ini bukan pengganti reasoning, tetapi guardrail.

### 20.1 Context

- [ ] Workload capability jelas.
- [ ] Business criticality jelas.
- [ ] Owner jelas.
- [ ] User journey kritikal terdokumentasi.
- [ ] Data classification tersedia.
- [ ] Assumption eksplisit.

### 20.2 Security

- [ ] Human access memakai identity federation/SSO.
- [ ] Workload memakai IAM role, bukan static credential.
- [ ] Least privilege diterapkan.
- [ ] KMS key access jelas.
- [ ] Secret tidak hardcoded.
- [ ] Public exposure intentional dan terlindungi.
- [ ] CloudTrail aktif dan centralized.
- [ ] Tenant isolation diuji jika multi-tenant.

### 20.3 Reliability

- [ ] RTO/RPO jelas.
- [ ] Critical state punya backup.
- [ ] Restore pernah diuji.
- [ ] Multi-AZ end-to-end.
- [ ] Retry memiliki timeout, backoff, jitter.
- [ ] Write path idempotent.
- [ ] DLQ dimonitor.
- [ ] Quota kritikal dipantau.
- [ ] Runbook tersedia.

### 20.4 Performance

- [ ] Latency budget tersedia.
- [ ] p95/p99 dimonitor.
- [ ] Autoscaling metric sesuai bottleneck.
- [ ] Connection pool sizing dikontrol.
- [ ] Cache memiliki invalidation/TTL model.
- [ ] Load test dilakukan.

### 20.5 Cost

- [ ] Cost owner jelas.
- [ ] Tagging strategy diterapkan.
- [ ] Budget/alert ada.
- [ ] Top cost driver diketahui.
- [ ] Log retention dikontrol.
- [ ] Data transfer dipahami.
- [ ] Non-prod cost dikontrol.

### 20.6 Operations

- [ ] Deployment automated.
- [ ] Rollback/roll-forward jelas.
- [ ] Dashboard journey-level tersedia.
- [ ] Alarm actionable.
- [ ] On-call owner jelas.
- [ ] Incident review menghasilkan action.

---

## 21. Review Anti-Patterns

### 21.1 Service Checklist Thinking

```text
Kami memakai CloudFront, WAF, ALB, ECS, RDS, Redis, SQS, CloudWatch.
```

Ini belum membuktikan desain baik.

Pertanyaan yang lebih penting:

- apa critical path;
- apa yang terjadi saat Redis down;
- apakah RDS failover diuji;
- apakah SQS DLQ dimonitor;
- apakah WAF rule menyebabkan false positive;
- apakah CloudWatch alarm actionable.

### 21.2 Best Practice Without Context

“Best practice” tanpa konteks bisa salah.

Contoh:

- multi-region active-active untuk workload kecil bisa menambah complexity dan risk;
- Lambda untuk latency-sensitive Java API bisa bermasalah jika cold start tidak dikelola;
- Kubernetes untuk 3 service kecil bisa menjadi operational burden;
- single-table DynamoDB bisa berlebihan untuk domain yang berubah cepat;
- caching bisa merusak correctness jika invalidation tidak jelas.

### 21.3 Diagram-Driven Confidence

Diagram bagus tidak menjamin:

- IAM benar;
- rollback aman;
- data tidak hilang;
- cost terkendali;
- operator tahu apa yang harus dilakukan;
- audit evidence tersedia.

### 21.4 Over-Review

Tidak semua workload perlu review level bank core system.

Over-review membuat tim lambat dan mencari jalan pintas.

Review harus proporsional dengan criticality.

---

## 22. How to Challenge Design Without Becoming Architecture Police

Top engineer menantang desain dengan pertanyaan yang memperjelas risiko.

Bukan:

```text
Kenapa tidak pakai Kubernetes?
```

Tetapi:

```text
Apa requirement yang membuat ECS Fargate tidak cukup? Apakah tim siap mengoperasikan EKS control plane, node lifecycle, ingress, policy, dan upgrade?
```

Bukan:

```text
Ini salah, harus pakai DynamoDB.
```

Tetapi:

```text
Access pattern mana yang membutuhkan low-latency key-value scale? Apa consistency dan query flexibility yang akan hilang jika pindah dari relational model?
```

Bukan:

```text
Harus multi-region.
```

Tetapi:

```text
Apa RTO/RPO bisnis? Apakah warm standby cukup? Apa kompleksitas data consistency jika active-active?
```

Review yang baik meningkatkan clarity, bukan ego reviewer.

---

## 23. Example Review: Java Case Submission API

### 23.1 Design Summary

```text
Client → CloudFront → WAF → ALB → ECS Fargate Java API → Aurora PostgreSQL
                                               ↓
                                              S3 evidence bucket
                                               ↓
                                              SQS document-processing queue
                                               ↓
                                              Lambda/Step Functions processing
                                               ↓
                                              OpenSearch projection
```

### 23.2 Review Findings

#### Finding 1 — Idempotency Gap

```text
Risk: SubmitCase API can be retried by client after timeout. If API already committed Aurora transaction but response was lost, retry may create duplicate case.
Impact: duplicate regulatory case, user confusion, audit complication.
Recommendation: require client-generated idempotency key, store key with result, return previous result on duplicate submission.
```

#### Finding 2 — Evidence Orphan Risk

```text
Risk: Evidence object upload and database metadata commit are separate operations. Partial failure can create orphan S3 object or missing evidence metadata.
Impact: evidence may be inaccessible or untracked.
Recommendation: use upload session, object tag pending/committed, metadata transaction, and reconciliation job.
```

#### Finding 3 — Search Projection Misuse

```text
Risk: Workflow approval screen reads latest case status from OpenSearch. OpenSearch is projection and may lag.
Impact: supervisor may approve stale state.
Recommendation: use Aurora source of truth for command decision screens; use OpenSearch only for discovery/search.
```

#### Finding 4 — DLQ Missing Operational Owner

```text
Risk: SQS DLQ exists but no owner/runbook/age alarm.
Impact: failed document processing can remain invisible until user complains.
Recommendation: add DLQ depth and age alarm, weekly operational review, replay/quarantine tool, and permanent failure classification.
```

#### Finding 5 — Cost Blind Spot

```text
Risk: CloudWatch debug logs include full request payload during document processing.
Impact: high log ingestion cost and potential sensitive data exposure.
Recommendation: redact sensitive fields, reduce log verbosity, define retention, and add cost allocation tag.
```

This is architecture review as risk discovery.

---

## 24. Review Output Format

A useful review result should include:

```text
Workload:
Review date:
Participants:
Scope:
Out of scope:
Business criticality:
Data classification:
Assumptions:
Summary judgment:
Top risks:
Accepted risks:
Required actions before production:
Recommended actions after production:
ADR updates needed:
Next review date:
```

### 24.1 Example Summary Judgment

```text
The workload design is directionally sound for production pilot with moderate traffic, but it is not ready for regulated production launch until idempotency, evidence reconciliation, DLQ operations, and CloudTrail/KMS evidence controls are completed. Multi-region active-active is not required for initial launch based on stated RTO/RPO, but restore testing must be completed before go-live.
```

This is more useful than:

```text
Approved with comments.
```

---

## 25. Maturity Model

### Level 1 — Service Awareness

Engineer knows AWS services and can assemble diagrams.

Weakness:

- service-oriented thinking;
- little failure modelling;
- security by defaults;
- cost surprise.

### Level 2 — Production Awareness

Engineer understands deployment, monitoring, IAM, backup, and scaling.

Weakness:

- still reactive;
- runbooks incomplete;
- risk not consistently documented.

### Level 3 — Failure-Mode Thinking

Engineer designs around failure, idempotency, blast radius, and recovery.

Strength:

- systems survive dependency issues;
- operational readiness improves;
- incidents become learning loops.

### Level 4 — Business-Aligned Architecture

Engineer maps architecture decisions to business criticality, compliance, cost, and user journey.

Strength:

- trade-offs are explicit;
- design can be defended;
- platform supports growth.

### Level 5 — Strategic Architecture Reviewer

Engineer can review unfamiliar workloads, identify hidden risks, guide teams, and improve organization-wide architecture standards.

Strength:

- asks clarifying questions;
- avoids service dogma;
- builds reusable review methods;
- converts risk into actionable improvement.

Target seri ini adalah membawa Anda ke Level 4–5.

---

## 26. Practical Review Worksheet

Gunakan worksheet ini saat review desain AWS.

```text
# AWS Architecture Review Worksheet

## 1. Workload Context
- Workload name:
- Business capability:
- Critical user journeys:
- Business criticality:
- Data classification:
- Owner:
- Expected traffic:
- RTO/RPO:
- Compliance constraints:

## 2. Architecture Summary
- Entry point:
- Compute:
- Data stores:
- Async integration:
- External dependencies:
- CI/CD:
- Observability:
- Security controls:

## 3. Critical Path
- Request path:
- Write path:
- Read path:
- Async path:
- Admin path:

## 4. Trust Boundaries
- Human access:
- Workload role:
- Account boundary:
- Network boundary:
- Tenant boundary:
- KMS boundary:

## 5. Failure Modes
- Top 10 failure modes:
- Detection signal:
- User impact:
- Data impact:
- Mitigation:
- Runbook:

## 6. Well-Architected Risks
- Operational excellence:
- Security:
- Reliability:
- Performance efficiency:
- Cost optimization:
- Sustainability:

## 7. Decision Records
- ADRs required:
- Risks accepted:
- Review date:
- Revisit condition:
```

---

## 27. Latihan Praktis

### Latihan 1 — Review Existing Architecture

Ambil satu sistem Java yang pernah Anda bangun.

Buat:

1. user journey utama;
2. dependency graph;
3. source of truth vs projection map;
4. top 10 failure modes;
5. IAM role inventory;
6. cost driver list;
7. operational dashboard outline.

Kemudian tulis 5 risiko paling penting.

### Latihan 2 — Review Multi-Tenant Design

Desain SaaS case management dengan pooled tenant model.

Jawab:

1. bagaimana tenant context disebarkan;
2. bagaimana tenant isolation diuji;
3. bagaimana data tenant dihapus;
4. bagaimana noisy tenant dibatasi;
5. bagaimana cost per tenant dihitung;
6. apa risiko terbesar dari pooled model.

### Latihan 3 — Review Event-Driven Workflow

Ambil workflow document processing:

```text
S3 upload → SQS → Lambda → Textract/processor → DynamoDB/Aurora update → notification
```

Tentukan:

1. idempotency key;
2. DLQ policy;
3. partial failure behavior;
4. retry/catch handling;
5. audit event;
6. replay strategy;
7. poison message runbook.

### Latihan 4 — Write Architecture Review Summary

Tulis summary review 1 halaman dengan format:

```text
The design is acceptable/not acceptable for production because...
Top 3 risks are...
Required before go-live...
Accepted risk...
Next review trigger...
```

---

## 28. Ringkasan

Architecture review yang matang bukan tentang menghafal AWS services.

Ia adalah kemampuan untuk:

- memahami workload;
- membaca user journey;
- menemukan state yang kritikal;
- memetakan trust boundary;
- menilai dependency graph;
- menginventarisasi failure mode;
- mengelompokkan risiko berdasarkan Well-Architected pillars;
- membuat trade-off eksplisit;
- mendokumentasikan keputusan;
- mengubah risiko menjadi action yang bisa dikerjakan.

Top engineer tidak hanya bertanya:

> Apakah desain ini menggunakan AWS dengan benar?

Mereka bertanya:

> Apakah desain ini dapat menjalankan business capability secara aman, reliable, observable, cost-aware, dan defensible ketika dunia nyata gagal?

Itulah inti AWS architecture review.

---

## 29. Referensi Resmi

- AWS Well-Architected Framework — pillars: operational excellence, security, reliability, performance efficiency, cost optimization, sustainability.
- AWS Well-Architected Tool — workload, lens, improvement plan.
- AWS Well-Architected Operational Excellence Pillar.
- AWS Well-Architected Security Pillar.
- AWS Well-Architected Reliability Pillar.
- AWS Well-Architected Performance Efficiency Pillar.
- AWS Well-Architected Cost Optimization Pillar.
- AWS Well-Architected Sustainability Pillar.
- AWS Architecture Center.
- AWS Prescriptive Guidance.

---

## 30. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
learn-aws-cloud-architecture-mastery-for-java-engineers-part-035.md
```

Judul:

```text
AWS Mastery Capstone: Design, Build, Operate, Break, and Defend a Production Workload
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-033.md">⬅️ Part 033 — AWS Architecture Case Studies: Production-Grade Java Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-aws-cloud-architecture-mastery-for-java-engineers-part-035.md">Part 035 — AWS Mastery Capstone: Design, Build, Operate, Break, and Defend a Production Workload ➡️</a>
</div>
