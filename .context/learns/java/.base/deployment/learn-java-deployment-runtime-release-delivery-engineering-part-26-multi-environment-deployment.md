# learn-java-deployment-runtime-release-delivery-engineering

## Part 26 — Multi-Environment Deployment: DEV, SIT, UAT, Staging, Production, DR

> Seri: Java Deployment, Runtime, Release, and Delivery Engineering  
> Target: Java 8 sampai Java 25  
> Fokus: desain environment, promotion path, parity, drift control, test data, release evidence, production readiness, dan disaster recovery untuk deployment Java enterprise.

---

## 1. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas artifact, runtime, container, Kubernetes, rollout, database migration, stateful workload, secret rotation, observability, verification, CI/CD, supply chain, dan hardening.

Namun semua itu belum cukup jika organisasi memiliki banyak environment:

- local developer machine;
- DEV;
- SIT;
- integration environment;
- QA;
- UAT;
- staging/pre-production;
- performance test;
- production;
- DR;
- sandbox/demo/training;
- hotfix environment;
- temporary feature environment.

Masalah deployment enterprise sering bukan karena satu environment rusak, tetapi karena **environment tidak konsisten**.

Contoh nyata:

- DEV berhasil karena memakai H2, production Oracle.
- SIT berhasil karena queue kosong, production queue penuh.
- UAT berhasil karena satu instance, production rolling update multi-instance.
- Staging berhasil karena memakai fake IdP, production memakai real OIDC/SAML certificate chain.
- Performance test berhasil karena data sedikit, production punya jutaan row dan index berbeda.
- DR dianggap siap, tetapi tidak pernah dites dengan aplikasi Java yang benar-benar start dari secret, truststore, DNS, dan database endpoint DR.

Bagian ini membangun mental model untuk menjawab:

> “Bagaimana mendesain environment deployment Java agar setiap environment punya tujuan jelas, drift terkendali, data aman, promotion dapat dipercaya, dan production/DR tidak menjadi eksperimen pertama?”

---

## 2. Environment Bukan Sekadar Tempat Deploy

Cara berpikir pemula:

> “DEV, SIT, UAT, PROD hanya beda URL dan database.”

Cara berpikir deployment engineer matang:

> “Setiap environment adalah simulasi terbatas dari production dengan tujuan validasi tertentu, risk boundary tertentu, data policy tertentu, dan authority tertentu.”

Artinya environment harus didefinisikan berdasarkan **apa yang divalidasi**, bukan sekadar nama.

### 2.1 Kesalahan Umum

Banyak tim punya environment seperti ini:

| Environment | Realita |
|---|---|
| DEV | Tempat semua orang test random |
| SIT | DEV kedua |
| UAT | Production palsu tapi datanya tidak mirip |
| Staging | Jarang dipakai, sering stale |
| PROD | Satu-satunya environment yang benar-benar lengkap |
| DR | Ada di diagram, belum tentu bisa jalan |

Ini membuat deployment menjadi ritual, bukan engineering.

Environment yang baik harus menjawab:

1. Apa tujuan environment ini?
2. Siapa yang boleh deploy?
3. Artifact dari mana yang boleh masuk?
4. Config mana yang boleh berbeda?
5. Data apa yang boleh ada?
6. External dependency mana yang real/fake?
7. Apakah environment ini blocking sebelum production?
8. Evidence apa yang harus dihasilkan?
9. Berapa lama environment ini boleh drift?
10. Siapa owner operational-nya?

---

## 3. Fundamental Model: Environment as Controlled Projection of Production

Environment non-production bukan copy sempurna production. Copy sempurna sering mahal, berisiko, dan tidak selalu perlu.

Yang benar:

> Setiap environment adalah projection dari production, dengan intentional differences yang terdokumentasi.

### 3.1 Tiga Jenis Perbedaan Environment

Ada tiga jenis perbedaan:

| Jenis Perbedaan | Contoh | Status |
|---|---|---|
| Intentional difference | DEV pakai resource kecil | Diterima jika didokumentasi |
| Risk-based difference | UAT pakai masked prod-like data | Diperlukan untuk keamanan |
| Accidental drift | PROD pakai JDK 21, UAT masih JDK 17 tanpa alasan | Berbahaya |

Top 1% engineer tidak mengejar “semua environment identik” secara membabi buta. Yang dikejar adalah:

- difference diketahui;
- difference punya alasan;
- difference tidak membatalkan validasi;
- difference bisa diaudit;
- difference tidak menjadi surprise saat production.

---

## 4. Environment Taxonomy

### 4.1 Local Development

Tujuan:

- feedback loop cepat;
- unit/integration local;
- debugging developer;
- contract awal.

Karakteristik:

- boleh memakai local database/container;
- boleh memakai stub external service;
- tidak boleh mengandung production secret;
- tidak boleh menjadi bukti production readiness.

Risiko:

- developer terlalu percaya hasil local;
- memakai config berbeda jauh dari runtime production;
- local memakai JDK berbeda dari pipeline/prod;
- local test memakai timezone/locale berbeda.

Prinsip:

> Local environment memaksimalkan kecepatan, bukan fidelity.

Namun kecepatan tidak boleh menghancurkan kontrak dasar:

- Java version harus jelas;
- config key harus sama;
- database schema migration harus sama;
- external dependency contract harus disimulasikan dengan benar.

---

### 4.2 DEV Environment

Tujuan:

- integrasi awal antar komponen;
- validasi deployment pipeline awal;
- validasi config non-sensitive;
- deteksi error kasar sebelum SIT.

DEV biasanya paling tidak stabil. Itu normal.

Namun DEV tetap harus punya batas:

- tidak boleh manual patch permanen tanpa dicatat;
- tidak boleh menjadi tempat config liar;
- tidak boleh menjadi tempat production data mentah;
- tidak boleh menjadi environment dengan artifact yang tidak traceable.

DEV yang buruk membuat bug “hilang” karena semua orang mengubah hal manual.

DEV yang baik tetap messy secara workload, tetapi tetap controlled secara infrastructure contract.

---

### 4.3 SIT — System Integration Testing

Tujuan:

- validasi integrasi antar service;
- validasi database migration lintas module;
- validasi queue/cache/search/email/external connectors;
- validasi API compatibility;
- validasi deployment order multi-service.

SIT bukan sekadar DEV yang lebih stabil.

SIT harus menjawab:

> “Jika semua komponen digabungkan, apakah sistem masih bekerja?”

Contoh validasi SIT:

- Service A memanggil Service B dengan token yang benar.
- Event dari module X diproses consumer module Y.
- Database migration tidak memutus legacy query.
- Email connector memakai template dan SMTP config benar.
- OIDC callback URL sesuai environment.
- Queue retry/dead-letter behavior sesuai.

SIT harus cukup mirip production dalam hal:

- network path;
- service discovery;
- authentication integration;
- database engine;
- message broker;
- cache technology;
- runtime version;
- container base image;
- deployment manifest structure.

---

### 4.4 QA Environment

Tidak semua organisasi membedakan SIT dan QA. Jika ada QA environment, biasanya fokusnya:

- functional testing;
- regression testing;
- exploratory testing;
- defect reproduction;
- test automation execution.

QA environment perlu stabil. Jika terlalu sering berubah, QA tidak bisa membedakan:

- bug aplikasi;
- bug test data;
- bug deployment;
- bug environment.

Prinsip:

> QA environment harus cukup stabil untuk membuat defect reproducible.

---

### 4.5 UAT — User Acceptance Testing

Tujuan:

- validasi business flow oleh user/BA/product owner;
- sign-off fitur;
- validasi wording, approval flow, notification, report, role access;
- validasi operational procedure sebelum production.

UAT bukan tempat ideal untuk menemukan technical integration failure pertama kali. Jika error teknis besar baru muncul di UAT, artinya SIT/QA gagal sebagai gate.

UAT harus fokus pada pertanyaan:

> “Apakah sistem ini memenuhi kebutuhan bisnis/user dan siap dipakai secara proses?”

Untuk sistem regulatory/case management, UAT harus juga menguji:

- role matrix;
- audit trail;
- escalation path;
- deadline/SLA behavior;
- state transition;
- correspondence generation;
- approval hierarchy;
- evidence/document handling;
- report correctness;
- exceptional workflow.

---

### 4.6 Staging / Pre-Production

Staging adalah environment yang paling sering salah dipahami.

Staging bukan:

- DEV tambahan;
- UAT tambahan;
- environment idle;
- tempat demo;
- tempat eksperimen manual.

Staging/pre-production seharusnya menjadi:

> “Last technical rehearsal before production.”

Ciri staging yang baik:

- runtime version sama dengan production;
- deployment mechanism sama;
- artifact promotion sama;
- topology mendekati production;
- secrets berbeda tetapi mekanisme sama;
- database engine sama;
- observability sama;
- ingress/TLS/auth pattern sama;
- rollout strategy sama;
- rollback procedure sama;
- smoke test sama;
- release evidence sama.

Jika staging terlalu berbeda dari production, staging tidak memberi confidence.

### 4.6.1 Staging Tidak Harus Sebesar Production

Staging boleh lebih kecil secara kapasitas:

- replica lebih sedikit;
- CPU/memory lebih kecil;
- data lebih sedikit;
- traffic synthetic;
- external integrations sandbox.

Namun harus sama secara **behavioral contract**:

- same JVM major version;
- same container base family;
- same deployment orchestration;
- same config key names;
- same secret injection mechanism;
- same probe logic;
- same graceful shutdown behavior;
- same migration process;
- same observability agent pattern.

---

### 4.7 Performance Test Environment

Tujuan:

- load test;
- stress test;
- soak test;
- capacity validation;
- GC and heap behavior validation;
- DB pool and connection behavior validation;
- queue throughput validation.

Performance environment harus berbeda dari UAT.

UAT menguji acceptability bisnis. Performance environment menguji batas kapasitas.

Performance environment perlu:

- dataset representatif;
- query plan representatif;
- database statistics representatif;
- network latency representatif;
- CPU/memory limit representatif;
- log/trace sampling realistis;
- downstream dependency simulation realistis;
- controlled load profile.

Performance test yang memakai data kecil sering memberi confidence palsu.

---

### 4.8 Production

Production adalah environment yang melayani user nyata dan data nyata.

Production harus diperlakukan sebagai:

- protected environment;
- auditable environment;
- minimal manual change environment;
- evidence-producing environment;
- rollback-capable environment;
- incident-managed environment.

Production bukan tempat debugging eksperimental.

Production tetap boleh diobservasi dan didiagnosis, tetapi diagnostic action harus memiliki policy:

- siapa boleh mengambil thread dump;
- kapan heap dump boleh diambil;
- bagaimana dump diamankan;
- berapa lama dump disimpan;
- apakah dump mengandung PII/secret;
- apakah JMX/debug port boleh dibuka;
- bagaimana emergency config change dicatat.

---

### 4.9 DR — Disaster Recovery Environment

DR bukan “production cadangan yang ada di diagram”.

DR harus dibuktikan melalui drill.

Tujuan DR:

- mempertahankan layanan saat primary region/site gagal;
- memenuhi RTO/RPO;
- memastikan data, config, secret, certificate, DNS, runtime, dan deployment process bisa berjalan di lokasi alternatif.

RTO adalah target waktu pemulihan. RPO adalah batas kehilangan data yang dapat diterima.

DR strategy umum:

| Strategy | Cost | RTO | RPO | Kapan Cocok |
|---|---:|---:|---:|---|
| Backup and restore | Rendah | Lama | Bergantung backup | Sistem tidak kritikal |
| Pilot light | Sedang | Sedang | Lebih baik | Core infra standby minimal |
| Warm standby | Tinggi | Cepat | Rendah | Sistem penting |
| Active-active | Sangat tinggi | Sangat cepat | Sangat rendah/kompleks | Sistem mission-critical |

Untuk Java deployment, DR readiness tidak cukup hanya database replication. Aplikasi juga perlu:

- image tersedia di registry DR;
- secret tersedia dan valid;
- truststore/keystore tersedia;
- DNS/ingress siap;
- external callback URL valid;
- license/runtime vendor valid;
- queue/cache/search tersedia;
- scheduled job tidak double-run;
- config endpoint mengarah ke dependency DR;
- observability tetap jalan;
- runbook failover/failback jelas.

---

## 5. Promotion Model: Jangan Rebuild untuk Setiap Environment

Salah satu prinsip paling penting:

> Build once, promote many.

Artifact yang sama harus dipromosikan dari environment ke environment.

Yang boleh berubah antar environment:

- config;
- secrets;
- replica count;
- resource sizing;
- endpoint eksternal;
- feature flag;
- data;
- certificate;
- environment-specific policy.

Yang tidak boleh berubah:

- source code;
- compiled class;
- dependency content;
- container image digest;
- artifact checksum;
- Java runtime baseline tanpa alasan;
- migration file yang sudah dirilis.

### 5.1 Anti-Pattern: Rebuild per Environment

Anti-pattern:

```text
Build DEV artifact
Build SIT artifact
Build UAT artifact
Build PROD artifact
```

Masalah:

- artifact yang diuji bukan artifact yang diproduksi;
- dependency bisa berubah antar build;
- timestamp/random metadata bisa berubah;
- supply chain evidence melemah;
- rollback sulit;
- root cause incident lebih susah.

Pattern yang lebih benar:

```text
Commit
  -> Build artifact once
  -> Scan/sign/SBOM once
  -> Push to artifact repository / image registry
  -> Deploy same artifact to DEV
  -> Promote same artifact to SIT
  -> Promote same artifact to UAT
  -> Promote same artifact to Staging
  -> Promote same artifact to Production
```

Untuk container:

```text
image: registry.example.com/app/case-service@sha256:abc123...
```

Tag seperti `1.8.3` boleh dipakai sebagai label manusia, tetapi deployment evidence harus menyimpan digest.

---

## 6. Environment Parity

Twelve-Factor App menekankan dev/prod parity, termasuk meminimalkan gap waktu, personel, dan tools antara development dan production. Prinsip ini tetap relevan untuk Java modern, terutama karena backing services seperti database, queue, dan cache sering menjadi sumber perbedaan perilaku antar environment.

Namun parity bukan berarti semua environment harus identik 100%.

Parity berarti:

> Perbedaan environment tidak boleh menyembunyikan failure mode yang ingin kita validasi.

### 6.1 Dimensi Parity

| Dimensi | Harus Sama? | Catatan |
|---|---|---|
| Java major version | Ya untuk gate utama | DEV boleh lebih fleksibel, staging/prod harus sama |
| Container base image family | Sebaiknya sama | Alpine vs Debian bisa berbeda native behavior |
| Database engine | Ya untuk SIT+ | H2 tidak mewakili Oracle/PostgreSQL/MySQL |
| Schema migration process | Ya | Migration harus sama |
| Queue/cache technology | Ya untuk SIT+ | Fake queue tidak cukup untuk concurrency semantics |
| Secret injection mechanism | Ya untuk staging/prod | Secret value beda, mekanisme sama |
| OIDC/SAML auth pattern | Ya untuk UAT+ | Sandbox IdP boleh, protocol flow harus sama |
| Observability agent | Ya untuk staging/prod | Agent bisa memengaruhi startup/memory |
| Replica count | Tidak harus | Tapi multi-instance behavior perlu diuji |
| Dataset size | Tidak harus | Perf env perlu representatif |
| Resource size | Tidak harus | Perf/staging perlu cukup realistis |
| Network topology | Sebaiknya mirip | Firewall/DNS/egress sering beda |

---

## 7. Config Drift: Silent Killer Multi-Environment Deployment

Config drift terjadi ketika environment berbeda tanpa kontrol.

Contoh:

- UAT memakai `SPRING_PROFILES_ACTIVE=uat,legacy-fix`, production tidak.
- SIT memakai timeout 60s, production 5s.
- DEV memakai `ddl-auto=update`, production Flyway.
- UAT disable certificate validation.
- Production punya extra JVM `--add-opens`, staging tidak.
- PROD memakai pool size 80, staging 10, tetapi performance claim diambil dari staging.

Drift berbahaya karena membuat hasil test tidak transferable.

### 7.1 Drift yang Paling Berbahaya

Bukan semua drift sama. Drift paling berbahaya adalah drift yang menyentuh:

1. security behavior;
2. database behavior;
3. transaction behavior;
4. concurrency behavior;
5. timeout/retry behavior;
6. serialization/deserialization behavior;
7. classpath/runtime version;
8. external protocol behavior;
9. feature flag behavior;
10. migration behavior.

### 7.2 Environment Difference Register

Setiap project serius sebaiknya punya environment difference register.

Contoh:

| Area | DEV | SIT | UAT | Staging | PROD | Justification | Risk |
|---|---|---|---|---|---|---|---|
| Replica count | 1 | 2 | 2 | 2 | 6 | Cost saving | Multi-replica tested from SIT |
| DB data | synthetic | synthetic | masked prod-like | masked prod-like | real | PII protection | Masking fidelity risk |
| IdP | mock | sandbox | sandbox | prod-like sandbox | real | Safety | Cert chain difference |
| JVM | 21.0.x | 21.0.x | 21.0.x | 21.0.x | 21.0.x | Same | Low |
| Email | fake SMTP | sandbox SMTP | sandbox SMTP | restricted SMTP | real SMTP | Avoid real email | Delivery difference |

Register ini membuat perbedaan eksplisit.

---

## 8. Data Strategy per Environment

Deployment Java sering gagal karena data environment tidak valid.

Data bukan hanya “isi database”. Data mencakup:

- master data;
- reference data;
- user/role data;
- workflow state;
- pending jobs;
- queue messages;
- documents/files;
- search index;
- cache content;
- audit trail;
- report snapshots;
- external system mapping;
- feature flag state.

### 8.1 Jenis Data Environment

| Jenis Data | Cocok Untuk | Risiko |
|---|---|---|
| Synthetic data | DEV/SIT awal | Tidak realistis |
| Seeded test data | QA/UAT regression | Maintenance tinggi |
| Masked production-like data | UAT/staging/perf | Masking fidelity dan compliance |
| Real production data | Production only | PII/security/legal risk |
| Snapshot data | Repro incident/perf | Bisa stale |
| Generated load data | Performance test | Bisa tidak mewakili skew nyata |

### 8.2 Masking Tidak Sama dengan Menghapus Nama

Data masking yang lemah hanya mengganti nama/email tetapi membiarkan:

- NRIC/ID number;
- phone number;
- address;
- attachment content;
- free-text remarks;
- audit metadata;
- serialized JSON/XML;
- email body;
- document filename;
- hidden EXIF/metadata;
- search index copy;
- cache dump.

Untuk aplikasi Java enterprise, data sensitif bisa tersebar ke:

- database CLOB/BLOB;
- audit table;
- object storage;
- message payload;
- dead-letter queue;
- logs;
- trace attributes;
- heap dump;
- test report;
- downloaded artifact.

Maka masking harus diperlakukan sebagai pipeline, bukan script kecil.

### 8.3 Data Fidelity

Data aman tapi tidak realistis juga bermasalah.

Contoh:

- Semua user punya role admin.
- Semua case dalam status `DRAFT`.
- Tidak ada expired deadline.
- Tidak ada large attachment.
- Tidak ada duplicate applicant.
- Tidak ada edge-case Unicode.
- Tidak ada historical audit trail.

UAT/performance test bisa lulus, lalu production gagal karena real data punya distribusi kompleks.

Data fidelity mencakup:

- volume;
- skew;
- state distribution;
- historical depth;
- large object size;
- null/empty/invalid legacy value;
- concurrency scenario;
- archived vs active records;
- role/permission variation;
- cross-entity relationship.

---

## 9. External Dependency Strategy

Java application jarang berdiri sendiri.

Dependencies umum:

- database;
- queue;
- cache;
- object storage;
- email SMTP;
- SMS gateway;
- payment gateway;
- IdP/OIDC/SAML;
- government API;
- map/address API;
- document generation;
- antivirus scanning;
- OCR;
- reporting server;
- LDAP/AD;
- secrets manager;
- observability backend.

Setiap environment harus menentukan dependency mode:

| Mode | Makna | Cocok Untuk |
|---|---|---|
| Mock | Simulasi lokal/test | DEV/unit/local |
| Stub | Response deterministic | CI/contract test |
| Sandbox | Dependency vendor khusus test | SIT/UAT |
| Shared non-prod | Dependency real tapi non-prod | SIT/UAT/staging |
| Production real | Dependency production | PROD saja, kadang staging restricted |

### 9.1 External Dependency Matrix

Contoh matrix:

| Dependency | DEV | SIT | UAT | Staging | PROD |
|---|---|---|---|---|---|
| IdP | mock OIDC | sandbox OIDC | sandbox OIDC | prod-like OIDC tenant | real OIDC |
| SMTP | mailhog | sandbox SMTP | sandbox SMTP | restricted SMTP | real SMTP |
| Payment | stub | sandbox | sandbox | sandbox/prod test merchant | real |
| Map API | mock | sandbox | sandbox | sandbox | real |
| Antivirus | disabled? no | sandbox | sandbox | sandbox | real |

Yang penting bukan semua dependency harus real di semua environment. Yang penting adalah dependency behavior yang diklaim sudah diuji harus benar-benar diuji.

---

## 10. Deployment Order Across Environments

Untuk monolith, deployment order mungkin sederhana.

Untuk multi-service Java system, deployment order bisa kompleks:

1. database expand migration;
2. shared library/API compatibility;
3. backend service deployment;
4. message consumer deployment;
5. scheduled job deployment;
6. frontend deployment;
7. feature flag enablement;
8. contract verification;
9. cleanup/contract migration;
10. database contract migration.

### 10.1 Order Tidak Boleh Berdasarkan Convenience

Deployment order harus berdasarkan compatibility graph.

Contoh:

```text
DB expand migration
  -> deploy service that writes new nullable column
  -> deploy service that reads fallback old/new column
  -> backfill data
  -> enable feature flag
  -> verify no old reader remains
  -> DB contract migration later
```

Bukan:

```text
Deploy frontend first because FE team available
Deploy backend later
Run migration whenever DBA free
```

### 10.2 Environment Promotion Harus Menguji Urutan yang Sama

Jika production akan memakai order A → B → C, maka staging juga harus memakai order A → B → C.

Jika SIT/UAT memakai deploy all-at-once, tetapi production memakai rolling service-by-service, maka SIT/UAT tidak menguji production risk.

---

## 11. Environment-Specific Configuration Without Environment-Specific Code

Anti-pattern:

```java
if (env.equals("prod")) {
    useRealSmtp();
} else if (env.equals("uat")) {
    useSandboxSmtp();
}
```

Masalah:

- code tahu terlalu banyak tentang environment;
- environment baru butuh code change;
- testing matrix melebar;
- production behavior tersembunyi dalam conditional;
- deployment menjadi tidak fleksibel.

Pattern yang lebih baik:

```properties
smtp.base-url=${SMTP_BASE_URL}
smtp.enabled=${SMTP_ENABLED:true}
smtp.mode=${SMTP_MODE:send}
```

Aplikasi membaca capability/config, bukan hardcoded environment name.

### 11.1 Rule

> Environment memilih konfigurasi. Code memilih behavior berdasarkan capability eksplisit.

Contoh capability:

- `email.delivery.mode=send|capture|disabled`
- `external.api.mode=real|sandbox|stub`
- `document.storage.mode=s3|minio|filesystem`
- `auth.provider=oidc|mock`
- `scheduler.enabled=true|false`

---

## 12. Feature Flags Across Environments

Feature flag bisa membantu progressive rollout, tetapi juga bisa menjadi sumber drift.

Masalah umum:

- UAT flag on, production flag off;
- production flag on sebagian user, staging tidak pernah menguji kombinasi itu;
- old flag tidak dibersihkan;
- flag memengaruhi database write path;
- flag tidak tercatat dalam release evidence;
- rollback hanya mematikan flag tapi data sudah berubah.

### 12.1 Flag Classification

| Jenis Flag | Tujuan | Risiko |
|---|---|---|
| Release flag | Pisahkan deploy dan release | Flag stale |
| Experiment flag | A/B testing | State divergence |
| Ops kill switch | Emergency disable | Harus sangat reliable |
| Permission flag | Enable per tenant/role | Authorization confusion |
| Migration flag | Dual-read/write | Data inconsistency |

### 12.2 Environment Flag Rule

Setiap release harus punya flag state matrix:

| Flag | DEV | SIT | UAT | Staging | PROD initial | PROD final |
|---|---|---|---|---|---|---|
| new-renewal-flow | on | on | on | on | off | on after approval |
| dual-write-address | on | on | on | on | on | off after contract |
| legacy-report | on | on | on | on | on | off later |

---

## 13. Environment Ownership and Access Control

Environment tanpa ownership akan drift.

Setiap environment harus punya:

- owner;
- deploy authority;
- config authority;
- secret authority;
- data authority;
- incident contact;
- change policy.

### 13.1 Example Ownership Matrix

| Environment | Deploy By | Config By | Secret By | Data By | Approval |
|---|---|---|---|---|---|
| DEV | Dev team | Dev team | DevOps | Dev team | None/lightweight |
| SIT | Dev/DevOps | DevOps | DevOps | QA/Dev | Internal |
| UAT | Release team | DevOps | DevOps | BA/QA | PM/BA |
| Staging | Release/DevOps | DevOps | DevOps/SecOps | DBA | Release manager |
| PROD | Release/DevOps | Controlled | SecOps | DBA | CAB/change approval |
| DR | DevOps/SRE | Controlled | SecOps | DBA | DR procedure |

---

## 14. Environment Drift Detection

Drift tidak bisa hanya dicegah dengan niat baik. Harus ada detection.

### 14.1 What to Compare

Bandingkan antar environment:

- image digest;
- Java version;
- JVM flags;
- environment variables;
- config map keys;
- secret names and versions, not values;
- Kubernetes manifests;
- resource requests/limits;
- replica count;
- ingress routes;
- TLS certificate issuer/expiry;
- database migration version;
- schema checksum;
- feature flag state;
- external endpoint hostnames;
- observability agent version;
- library runtime dependencies;
- app server version.

### 14.2 Drift Report Example

```text
Environment Drift Report: UAT vs PROD

Artifact:
  UAT: case-service@sha256:abc123
  PROD: case-service@sha256:abc123
  Status: OK

Java:
  UAT: Temurin 21.0.6
  PROD: Temurin 21.0.6
  Status: OK

JVM Flags:
  UAT: -XX:MaxRAMPercentage=70 -Duser.timezone=Asia/Singapore
  PROD: -XX:MaxRAMPercentage=65 -Duser.timezone=Asia/Singapore
  Status: Intentional difference: memory headroom

DB Migration:
  UAT: V2026_06_15_01
  PROD: V2026_06_15_01
  Status: OK

Feature Flags:
  UAT: new-renewal-flow=true
  PROD: new-renewal-flow=false
  Status: Expected pre-release difference
```

---

## 15. Infrastructure as Code and GitOps for Environment Consistency

Manual environment setup does not scale.

A mature deployment system keeps environment definition in versioned form:

- Terraform/Pulumi/CloudFormation for infrastructure;
- Helm/Kustomize/plain YAML for Kubernetes;
- Ansible for VM/server configuration;
- Liquibase/Flyway for database migration;
- GitOps repository for desired state;
- policy-as-code for security gates.

### 15.1 One Base, Multiple Overlays

Kustomize-style mental model:

```text
base/
  deployment.yaml
  service.yaml
  config.yaml

overlays/
  dev/
  sit/
  uat/
  staging/
  prod/
  dr/
```

Environment-specific overlays should be small.

If overlay is huge, environment drift is likely.

### 15.2 What Belongs in Overlay

Good overlay candidates:

- replica count;
- resource request/limit;
- hostnames;
- secret references;
- external endpoint URLs;
- feature flags initial state;
- environment labels;
- node affinity;
- logging level, carefully;
- autoscaling threshold.

Bad overlay candidates:

- different container command for no reason;
- different port for no reason;
- different probe path for no reason;
- disabling TLS validation;
- skipping migration;
- changing classpath;
- changing app startup mode;
- adding debug flags permanently.

---

## 16. Java-Specific Multi-Environment Pitfalls

### 16.1 Different JDK Patch Version

JDK patch differences can affect:

- TLS behavior;
- certificate validation;
- default disabled algorithms;
- timezone database;
- GC bug fixes;
- container detection;
- JFR/JMX behavior;
- crypto provider behavior.

Staging and production should use the same JDK distribution and patch level unless exception is documented.

### 16.2 Different Timezone

Java apps are sensitive to timezone:

- scheduled jobs;
- due dates;
- SLA calculations;
- report grouping;
- audit timestamp;
- database timestamp conversion;
- JSON serialization;
- cron expression behavior.

Set timezone explicitly:

```bash
-Duser.timezone=Asia/Jakarta
```

or a project-approved timezone, often UTC for backend systems.

But be consistent and intentional.

### 16.3 Different Locale/Encoding

Problems:

- CSV export differs;
- decimal separator differs;
- date formatting differs;
- report text differs;
- Unicode handling differs.

Set:

```bash
-Dfile.encoding=UTF-8
-Duser.language=en
-Duser.country=US
```

or chosen locale explicitly if needed.

### 16.4 Different JVM Flags

Common drift:

```text
UAT:  -Xmx2g
PROD: -Xmx8g
```

This may hide:

- GC pause behavior;
- memory leak rate;
- direct memory exhaustion;
- thread stack pressure;
- startup warmup behavior.

Not all environments need same heap, but the sizing model should be equivalent.

### 16.5 Different Database Driver

If artifact is rebuilt per environment, driver version can drift.

Symptoms:

- connection pool error only in production;
- SSL negotiation difference;
- timestamp mapping difference;
- LOB streaming behavior difference;
- fetch size behavior difference.

Build once, promote many reduces this risk.

### 16.6 Different Truststore

Classic problem:

```text
UAT works because certificate imported manually.
PROD fails because truststore missing intermediate CA.
```

Truststore content should be managed as deployment asset with versioning and expiry evidence.

### 16.7 Different App Server Patch

For WAR/EAR deployments:

- Tomcat/WildFly/WebLogic patch level can change behavior;
- shared library can differ;
- server-level datasource config can differ;
- classloader hierarchy can differ.

App server version is part of environment parity.

---

## 17. Production Readiness Gate

Before production deployment, answer:

### 17.1 Artifact Readiness

- Is artifact built once and promoted?
- Is artifact signed/scanned?
- Is SBOM available?
- Is image digest recorded?
- Is Java runtime version recorded?
- Is rollback artifact available?

### 17.2 Config Readiness

- Are all required config keys present?
- Are secret references valid?
- Are certificates valid beyond release window?
- Are environment differences documented?
- Are feature flags initial/final states documented?

### 17.3 Data Readiness

- Is migration tested?
- Is rollback/roll-forward plan known?
- Is backup/snapshot completed if needed?
- Is data backfill plan tested?
- Is production data impact assessed?

### 17.4 Operational Readiness

- Are dashboards ready?
- Are alerts active?
- Are logs searchable?
- Is smoke test prepared?
- Is runbook available?
- Is rollback command known?
- Are support contacts available?

### 17.5 User/Business Readiness

- Is UAT signed off?
- Are release notes approved?
- Are user communications prepared?
- Is maintenance window confirmed?
- Are known limitations documented?

---

## 18. Release Evidence Per Environment

For enterprise/regulatory deployment, evidence matters.

Each environment promotion should record:

- release version;
- artifact digest/checksum;
- commit SHA;
- build number;
- deployment timestamp;
- deployer/pipeline identity;
- target environment;
- migration version before/after;
- config version;
- secret/cert version references;
- smoke test result;
- health check result;
- approval reference;
- rollback candidate;
- known issues.

Example:

```yaml
release: 2026.06.18.3
service: enforcement-case-service
artifact:
  image: registry.example.com/enforcement/case-service
  digest: sha256:abc123...
  gitSha: 9f43ad1
runtime:
  java: Temurin 21.0.6
  baseImage: debian-12
migration:
  before: V2026_06_10_02
  after: V2026_06_18_01
verification:
  smoke: passed
  synthetic: passed
  errorRate5m: 0.02%
approval:
  changeRequest: CR-2026-0618-045
  approver: release-manager
rollback:
  previousDigest: sha256:def456...
```

---

## 19. DR Readiness for Java Applications

DR must be tested as application behavior, not infrastructure assumption.

### 19.1 DR Deployment Checklist

- Can Java app start in DR without manual secret copy?
- Is image available in DR registry/replica?
- Is JDK/base image available?
- Are truststore and keystore valid in DR?
- Are DNS names resolvable?
- Are outbound firewall rules correct?
- Can app connect to DR database?
- Are DB migrations compatible with replicated DB?
- Are queue consumers safe during failover?
- Are schedulers disabled/enabled correctly?
- Are OAuth/SAML callback URLs registered?
- Are external vendors aware of DR IP/domain?
- Are logs/metrics/traces sent to DR-capable observability backend?
- Are alert routes updated?
- Is failback tested?

### 19.2 Scheduler and Job Risk in DR

During DR, scheduled jobs can double-run if both primary and DR are active.

Mitigation:

- leader election;
- DB lock;
- scheduler enabled flag;
- active-region guard;
- idempotency key;
- externalized job ownership;
- explicit failover procedure.

### 19.3 Message Queue Risk in DR

Questions:

- Are messages replicated?
- Are unacked messages lost?
- Are consumers idempotent?
- Are DLQs replicated?
- Is message ordering required?
- Does replay cause duplicate business action?

Java deployment DR is not ready until these are answered.

---

## 20. Environment Lifecycle Management

Environment itself has lifecycle:

- create;
- configure;
- seed;
- deploy;
- validate;
- refresh;
- patch;
- freeze;
- retire.

### 20.1 Environment Refresh

Non-prod environments often need refresh from production-like source.

Refresh must handle:

- data masking;
- secret replacement;
- external endpoint replacement;
- user account reset;
- scheduler disabled;
- email/SMS disabled or captured;
- queue purge/reseed;
- cache clear;
- search reindex;
- document store sync/mask;
- audit of who accessed data.

### 20.2 Environment Freeze

Before UAT/sign-off, environment may be frozen.

Freeze means:

- no unapproved deploy;
- no random data cleanup;
- no config change;
- only approved defect fixes;
- evidence preserved.

Freeze is useful, but dangerous if too long because environment becomes stale.

---

## 21. Temporary Environments and Preview Environments

Modern teams often create preview environment per PR/branch.

Benefits:

- isolated feature testing;
- faster stakeholder review;
- no shared DEV conflict;
- early deployment validation.

Risks:

- cost explosion;
- secret sprawl;
- stale environments;
- uncontrolled external calls;
- database migration conflict;
- weak data policy.

Preview environment works best for:

- stateless service;
- frontend/backend feature branch;
- synthetic data;
- stubbed external dependencies;
- short lifetime.

Preview environment is not replacement for SIT/UAT/staging.

---

## 22. Anti-Pattern Catalog

### Anti-Pattern 1 — “It Passed UAT, So It Is Production-Ready”

UAT validates business acceptance, not necessarily production behavior.

Need staging/verification/perf/security gates.

### Anti-Pattern 2 — “Production Has Special Config Nobody Else Has”

Production-only config means production-only bugs.

### Anti-Pattern 3 — “Staging Is Always Broken”

Broken staging teaches team to ignore staging.

A staging environment that nobody trusts is worse than no staging because it creates false process.

### Anti-Pattern 4 — “Manual Fix in Environment”

Manual fixes without codification create invisible drift.

### Anti-Pattern 5 — “Use Production Data in Non-Prod Because It Is Easier”

This creates privacy/security/compliance risk and often leaks through logs, dumps, attachments, or queues.

### Anti-Pattern 6 — “DR Exists Because Infrastructure Team Created It”

DR exists only after application-level failover/failback is tested.

### Anti-Pattern 7 — “Same Tag Means Same Artifact”

Mutable tags are not evidence. Digest/checksum is evidence.

### Anti-Pattern 8 — “Different Database Engine for Test”

H2/SQLite/local fake DB can help fast tests, but cannot validate production SQL semantics, locks, indexes, LOBs, isolation, or migration behavior.

### Anti-Pattern 9 — “Disable Security in UAT to Make Testing Easier”

If auth/TLS/cert validation is disabled, UAT does not validate deployment security path.

### Anti-Pattern 10 — “One Shared Non-Prod for Everything”

A single shared environment becomes noisy, unstable, and impossible to reason about.

---

## 23. Practical Multi-Environment Blueprint for Java Enterprise

A strong but realistic setup:

```text
Local
  - fast developer feedback
  - Docker Compose/testcontainers
  - stub external dependencies

DEV
  - continuous integration deployment
  - unstable allowed
  - synthetic data

SIT
  - multi-service integration
  - real DB engine
  - real queue/cache
  - sandbox external systems

QA
  - regression automation
  - seeded test data
  - stable window

UAT
  - business validation
  - masked prod-like data
  - role/workflow/report validation

Staging / Pre-Prod
  - production rehearsal
  - same artifact promotion
  - same runtime/deployment mechanism
  - smoke/synthetic/rollback rehearsal

Performance
  - representative load/data
  - capacity validation
  - may be separate from staging

Production
  - controlled release
  - real users/data
  - evidence and rollback

DR
  - tested failover/failback
  - RTO/RPO evidence
  - application-level readiness
```

---

## 24. Example: Java Case Management System Environment Design

Bayangkan sistem Java untuk enforcement/case management.

Komponen:

- frontend SPA;
- Spring Boot API;
- workflow/case module;
- correspondence module;
- document service;
- audit trail;
- scheduler;
- queue consumer;
- Oracle/PostgreSQL database;
- Redis cache;
- RabbitMQ/Kafka;
- OIDC IdP;
- SMTP;
- object storage;
- reporting.

### 24.1 Environment-Specific Concerns

DEV:

- synthetic case;
- local/minimal object storage;
- email captured;
- scheduler limited;
- mock IdP acceptable.

SIT:

- real DB engine;
- real queue/cache;
- sandbox IdP;
- event flow tested;
- document upload/download tested;
- migration tested.

UAT:

- realistic roles;
- realistic case states;
- approval workflow;
- masked documents;
- correspondence templates;
- report validation;
- audit trail validation.

Staging:

- same deployment process as production;
- same ingress/TLS pattern;
- same artifact digest;
- same runtime;
- rollback rehearsal;
- synthetic smoke test;
- feature flags as production initial state.

Production:

- CAB-approved release;
- monitored rollout;
- evidence collected;
- rollback prepared.

DR:

- replicated DB/object storage;
- scheduler failover policy;
- queue replay/idempotency;
- OIDC callback/domain readiness;
- operational drill.

---

## 25. Decision Framework

When designing or evaluating an environment, ask:

### 25.1 Purpose

- What failure class should this environment catch?
- What failure class is explicitly out of scope?

### 25.2 Fidelity

- Which production behaviors must be represented?
- Which differences are acceptable and documented?

### 25.3 Data

- What data is used?
- Is it safe?
- Is it realistic enough?
- How is it refreshed?

### 25.4 Deployment

- Is artifact promoted or rebuilt?
- Is deployment mechanism same as production?
- Is rollback tested?

### 25.5 Security

- Are secrets real, fake, or sandbox?
- Are certificates valid?
- Is auth path realistic?
- Is access controlled?

### 25.6 Evidence

- What proof does this environment produce?
- Who consumes that proof?
- Is it auditable?

### 25.7 DR

- Can this environment support failover test?
- Is failback tested?
- Are RTO/RPO assumptions verified?

---

## 26. Checklist: Multi-Environment Deployment Readiness

```text
Artifact
[ ] Same artifact promoted across environments
[ ] Image digest/checksum recorded
[ ] Runtime version recorded
[ ] SBOM/signature/scan result available

Configuration
[ ] Config keys consistent
[ ] Environment differences documented
[ ] No production-only hidden config
[ ] Feature flag matrix documented

Runtime
[ ] Java version aligned for gate environments
[ ] JVM flags documented
[ ] Timezone/locale/encoding explicit
[ ] App server/container version documented

Data
[ ] Test data strategy defined
[ ] Production data masked if used
[ ] Data refresh process documented
[ ] Queue/cache/object storage considered

External Dependencies
[ ] Dependency mode matrix defined
[ ] Sandbox/real endpoints documented
[ ] Callback URLs configured
[ ] Email/SMS/payment safety controlled

Deployment Process
[ ] Promotion path defined
[ ] Deployment order documented
[ ] Migration process tested
[ ] Rollback/roll-forward plan exists

Observability
[ ] Logs/metrics/traces enabled
[ ] Dashboards available
[ ] Alerts configured where relevant
[ ] Smoke/synthetic tests ready

Security
[ ] Secrets scoped by environment
[ ] Truststore/keystore versioned
[ ] Access control enforced
[ ] Non-prod production data policy enforced

DR
[ ] DR deployment tested
[ ] RTO/RPO defined
[ ] Failover/failback runbook exists
[ ] Scheduler/queue behavior tested

Evidence
[ ] Release evidence generated per environment
[ ] Approval trail recorded
[ ] Known differences attached to release note
```

---

## 27. Key Takeaways

1. Environment adalah controlled projection dari production, bukan sekadar URL berbeda.
2. Semua environment harus punya tujuan validasi yang jelas.
3. Parity bukan identik 100%, tetapi perbedaan harus intentional, documented, dan tidak membatalkan validasi.
4. Build once, promote many adalah fondasi release evidence dan supply chain integrity.
5. Config drift adalah salah satu penyebab terbesar production-only bugs.
6. Data strategy menentukan apakah UAT/performance test benar-benar bermakna.
7. Staging adalah rehearsal production, bukan tempat eksperimen.
8. DR harus diuji di level aplikasi Java, bukan hanya infrastruktur.
9. Feature flags harus dimasukkan ke release evidence, bukan dianggap detail runtime kecil.
10. Top-tier deployment engineering berarti mampu menjelaskan apa yang divalidasi oleh setiap environment dan apa yang tidak.

---

## 28. Latihan Pemahaman

1. Ambil satu aplikasi Java yang kamu kenal. Buat environment matrix DEV/SIT/UAT/STAGING/PROD/DR.
2. Tulis 10 perbedaan antara UAT dan PROD. Tandai mana intentional difference dan mana accidental drift.
3. Buat artifact promotion flow. Pastikan tidak ada rebuild antara UAT dan PROD.
4. Buat dependency matrix untuk database, queue, cache, SMTP, IdP, object storage, dan external API.
5. Tulis production readiness checklist untuk satu release.
6. Buat DR checklist khusus untuk scheduler dan queue consumer.
7. Identifikasi satu production-only config yang bisa menimbulkan bug dan rancang cara mengujinya di staging.

---

## 29. Penutup

Multi-environment deployment adalah tempat bertemunya engineering, security, QA, operations, compliance, dan business governance.

Engineer yang hanya tahu cara deploy ke satu environment belum cukup. Engineer yang matang bisa menjawab:

- environment mana yang membuktikan apa;
- environment mana yang tidak boleh dipercaya untuk claim tertentu;
- perbedaan mana yang aman;
- drift mana yang berbahaya;
- data mana yang realistis tapi aman;
- release evidence apa yang cukup;
- bagaimana production dan DR tetap recoverable.

Pada bagian berikutnya kita akan naik ke level distributed system deployment:

> **Part 27 — Multi-Service and Distributed Java Deployment**

Di sana kita akan membahas deployment ketika satu release melibatkan banyak service, API contract, event schema, dependency order, partial rollout, backward/forward compatibility, service discovery, dan failure mode lintas service.

---

## Referensi

- The Twelve-Factor App — Dev/Prod Parity dan backing services sebagai attached resources.
- Kubernetes Documentation — Production environment, namespaces, workloads, configuration, and deployment concepts.
- AWS Disaster Recovery Whitepaper — backup/restore, pilot light, warm standby, active-active strategy.
- NIST SP 800-122 — protecting confidentiality of personally identifiable information.
- Kubernetes Documentation — production cluster preparation and workload/environment management.
