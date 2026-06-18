# learn-java-deployment-runtime-release-delivery-engineering

# Part 22 — Deployment Verification: Smoke Test, Health Gate, Synthetic Check, Contract Check

> Seri: Java Deployment Runtime Release Delivery Engineering  
> Target: Java 8 sampai Java 25  
> Level: Advanced / production engineering / top 1% software engineer track  
> Fokus: membuktikan deployment benar-benar aman, bukan hanya sukses menjalankan pipeline

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas observability-ready deployment. Namun observability hanya memberi kemampuan melihat sistem. Part ini membahas lapisan berikutnya: **bagaimana menggunakan sinyal tersebut untuk mengambil keputusan deployment**.

Deployment verification adalah proses menjawab pertanyaan:

> “Setelah versi baru masuk environment, apakah sistem benar-benar aman menerima traffic production dan melanjutkan rollout?”

Bukan sekadar:

- container berhasil start;
- pod status `Running`;
- pipeline hijau;
- endpoint `/health` menjawab `UP`;
- tidak ada exception selama 10 detik pertama.

Itu semua sinyal awal, tetapi belum cukup.

Deployment verification yang matang harus memeriksa:

1. apakah process hidup;
2. apakah aplikasi siap menerima traffic;
3. apakah dependency kritikal bisa dipakai;
4. apakah request nyata bisa diproses end-to-end;
5. apakah contract antar service masih kompatibel;
6. apakah metric/error/log setelah deploy masih dalam batas aman;
7. apakah workload asynchronous tetap benar;
8. apakah rollback masih mungkin;
9. apakah bukti deployment bisa diaudit.

Mental model top engineer:

> Deployment sukses bukan saat artifact berhasil dipasang. Deployment sukses saat versi baru terbukti memenuhi invariant production di bawah kondisi nyata.

---

## 1. Masalah Utama: Deployment Pipeline Sering Mengukur Hal yang Salah

Banyak pipeline Java terlihat rapi:

```text
build -> unit test -> package -> push image -> deploy -> check pod running -> done
```

Masalahnya: pipeline seperti ini hanya membuktikan bahwa **sistem orkestrasi menerima instruksi deploy**, bukan bahwa aplikasi business-critical benar-benar sehat.

Contoh nyata failure:

| Pipeline Hijau | Production Gagal Karena |
|---|---|
| Pod Running | readiness terlalu dangkal |
| `/actuator/health` UP | database user salah privilege |
| container started | endpoint utama 500 karena config salah |
| migration success | old app version tidak kompatibel dengan schema baru |
| canary pod ready | async consumer duplicate message |
| smoke test login sukses | role-specific workflow rusak |
| CPU normal | latency P95 naik 3x |
| no error log | silent business failure masuk retry queue |

Di sistem enterprise/regulatory, failure paling berbahaya bukan selalu downtime total. Yang lebih berbahaya adalah **silent incorrectness**:

- case masuk status salah;
- approval workflow skip step;
- email notification tidak terkirim;
- audit trail tidak tercatat;
- SLA timer tidak aktif;
- payment/revenue posting tertunda;
- data mutation partial;
- background job berhenti tetapi UI terlihat normal.

Karena itu, verification harus didesain berdasarkan **business and system invariants**, bukan hanya health endpoint generik.

---

## 2. Vocabulary: Test, Check, Gate, Probe, Verification

Sebelum masuk teknis, bedakan istilahnya.

## 2.1 Test

Test adalah eksekusi terkontrol untuk memvalidasi expected behavior.

Contoh:

- unit test;
- integration test;
- API test;
- contract test;
- smoke test;
- synthetic transaction.

Dalam deployment, test biasanya berjalan sebagai bagian pipeline atau post-deploy job.

## 2.2 Check

Check adalah observasi terhadap kondisi saat ini.

Contoh:

- apakah endpoint menjawab 200;
- apakah pod ready;
- apakah database connection valid;
- apakah error rate naik;
- apakah queue backlog abnormal;
- apakah log mengandung exception baru.

Check bisa aktif atau pasif.

## 2.3 Gate

Gate adalah decision point.

Contoh:

```text
if smoke_test_passed and error_rate < threshold and p95_latency < threshold:
    continue rollout
else:
    stop rollout and rollback
```

Gate harus punya konsekuensi. Kalau tidak ada aksi, itu bukan gate, hanya report.

## 2.4 Probe

Probe adalah mekanisme health checking yang biasanya dijalankan platform runtime seperti Kubernetes.

Tiga probe umum:

- startup probe;
- readiness probe;
- liveness probe.

Probe memengaruhi lifecycle container/pod. Probe bukan pengganti deployment verification penuh.

## 2.5 Verification

Verification adalah gabungan test, check, observability, dan gate untuk membuktikan deployment aman.

Verification harus menjawab:

```text
Apakah versi ini boleh menerima traffic lebih banyak?
Apakah rollout boleh lanjut?
Apakah rollback perlu dilakukan?
Apakah release boleh ditandai sukses?
```

---

## 3. Deployment Verification Ladder

Gunakan ladder berikut untuk menyusun verification maturity.

```text
Level 0: Process exists
Level 1: App endpoint responds
Level 2: App declares readiness correctly
Level 3: Critical dependencies validated
Level 4: Business smoke test passes
Level 5: Contract compatibility passes
Level 6: Synthetic transaction passes continuously
Level 7: Metrics/logs/traces stay within threshold
Level 8: Progressive rollout controlled by analysis
Level 9: Verification evidence auditable and repeatable
```

Penjelasan:

| Level | Membuktikan | Belum Membuktikan |
|---|---|---|
| 0 | process tidak mati langsung | aplikasi bisa melayani request |
| 1 | HTTP server menjawab | dependency siap |
| 2 | platform tahu kapan route traffic | business flow benar |
| 3 | DB/cache/queue reachable | business mutation benar |
| 4 | jalur utama berjalan | kompatibilitas semua consumer |
| 5 | interface tidak pecah | runtime behavior stabil |
| 6 | transaksi nyata terus berjalan | rollout aman di semua traffic |
| 7 | sinyal produksi stabil | semua edge case aman |
| 8 | rollout adaptif | bukti compliance lengkap |
| 9 | bisa diaudit | tetap butuh judgment manusia |

Target top engineer bukan selalu Level 9 untuk semua service. Targetnya adalah mampu menentukan **level minimum yang tepat berdasarkan criticality service**.

---

## 4. Verification Harus Dimulai dari Invariant

Jangan mulai dari tool. Mulai dari invariant.

Invariant adalah kondisi yang harus selalu benar agar sistem dianggap aman.

Contoh invariant untuk Java REST service:

```text
- Service menerima request hanya setelah configuration loaded.
- Service menerima traffic hanya setelah DB migration compatible.
- Semua request mutasi punya correlation id.
- Semua write penting menghasilkan audit trail.
- Semua dependency critical reachable atau service tidak ready.
- Error rate tidak naik melebihi baseline setelah deploy.
- Latency P95 tidak naik drastis setelah deploy.
```

Contoh invariant untuk case management/regulatory system:

```text
- Case tidak boleh berpindah status tanpa transition rule valid.
- Approval action harus mencatat actor, timestamp, previous state, next state.
- SLA timer harus tetap aktif setelah deployment.
- Background job tidak boleh memproses case yang sama dua kali secara non-idempotent.
- Notification failure harus tercatat dan retryable.
- Audit trail harus tetap writeable sebelum user action diizinkan.
```

Contoh invariant untuk queue consumer:

```text
- Message tidak di-ack sebelum side effect sukses.
- Redelivery tidak menyebabkan duplicate irreversible action.
- Consumer tidak menerima message saat dependency utama belum siap.
- Shutdown harus berhenti mengambil message baru sebelum proses mati.
```

Verification kemudian diturunkan dari invariant tersebut.

---

## 5. Jenis Verification dalam Deployment Java

Secara praktis, kita akan memakai beberapa jenis verification.

```text
1. Static pre-deploy verification
2. Artifact verification
3. Environment verification
4. Startup verification
5. Readiness verification
6. Smoke test
7. Dependency verification
8. Contract verification
9. Synthetic transaction
10. Metric/log/trace gate
11. Progressive delivery analysis
12. Post-deploy audit evidence
```

Masing-masing punya fungsi berbeda.

---

# Section A — Pre-Deploy Verification

---

## 6. Static Pre-Deploy Verification

Static pre-deploy verification terjadi sebelum artifact dipasang ke runtime.

Tujuannya:

- mencegah artifact buruk masuk environment;
- memastikan manifest deployment valid;
- memastikan config lengkap;
- memastikan dependency version diketahui;
- memastikan security baseline terpenuhi.

Contoh static verification:

```text
- image tag immutable
- digest tersedia
- SBOM tersedia
- deployment manifest valid
- resource request/limit ada
- probe dikonfigurasi
- secret reference valid
- config key wajib tersedia
- JVM flags sesuai baseline
- no latest tag
- no root user
- no debug port exposed
```

Static verification tidak membuktikan aplikasi sehat, tetapi mengurangi failure kasar.

## 6.1 Artifact Identity Verification

Salah satu kesalahan deployment paling fundamental: tidak tahu artifact apa yang sebenarnya berjalan.

Setiap deployment Java harus bisa menjawab:

```text
- Git commit apa?
- Build number apa?
- Artifact version apa?
- Container image digest apa?
- JDK distribution/version apa?
- Dependency set apa?
- Build time kapan?
- Environment apa?
```

Spring Boot bisa mengekspos build info melalui Actuator jika dikonfigurasi. Untuk aplikasi non-Spring, bisa buat endpoint `/version` atau `/info`.

Contoh response ideal:

```json
{
  "service": "case-management-api",
  "version": "2026.06.18.42",
  "gitCommit": "a13f9c2",
  "imageDigest": "sha256:...",
  "javaVersion": "21.0.7",
  "runtimeVendor": "Eclipse Adoptium",
  "buildTime": "2026-06-18T02:14:11Z",
  "environment": "uat"
}
```

Invariant:

> Tidak boleh ada deployment production yang tidak bisa ditelusuri ke source commit dan artifact digest.

## 6.2 Manifest Verification

Untuk Kubernetes, manifest harus divalidasi sebelum apply.

Minimum check:

```text
- apiVersion valid
- resource kind valid
- required labels ada
- image bukan latest
- resource requests/limits ada
- probes ada
- securityContext ada
- config/secret references ada
- rollout strategy jelas
- terminationGracePeriodSeconds cukup
```

Contoh anti-pattern:

```yaml
image: registry/app:latest
resources: {}
livenessProbe:
  httpGet:
    path: /actuator/health
```

Masalah:

- `latest` tidak immutable;
- tanpa resources, scheduling dan QoS tidak jelas;
- liveness memakai health aggregate bisa restart saat dependency sementara down;
- readiness/liveness tidak dipisah;
- tidak ada termination strategy.

---

# Section B — Startup and Readiness Verification

---

## 7. Startup Verification

Startup verification menjawab:

> “Apakah aplikasi berhasil melewati fase bootstrap awal?”

Fase bootstrap Java bisa meliputi:

```text
- JVM start
- classloading
- config loading
- logging initialization
- Spring/ApplicationContext creation
- datasource initialization
- migration check
- cache client creation
- queue client creation
- HTTP server binding
- actuator endpoint registration
```

Kesalahan umum:

- menganggap port terbuka berarti aplikasi siap;
- menganggap application context started berarti dependency siap;
- menganggap readiness sama dengan startup;
- membuat startup terlalu banyak melakukan dependency check blocking.

## 7.1 Startup Probe

Dalam Kubernetes, startup probe berguna untuk aplikasi yang butuh waktu boot lama. Selama startup probe belum sukses, liveness/readiness behavior harus dipahami dengan benar agar aplikasi tidak dibunuh terlalu cepat.

Startup probe cocok untuk Java app yang:

- cold start lambat;
- classpath besar;
- Spring context besar;
- CDS belum optimal;
- migration/check awal berat;
- berjalan di CPU limit kecil;
- pakai app server yang boot kompleks.

Contoh:

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  failureThreshold: 60
  periodSeconds: 5
```

Makna:

```text
Aplikasi diberi window 60 * 5 = 300 detik untuk hidup sebelum dianggap gagal startup.
```

Namun startup probe bukan alasan untuk membiarkan startup tidak terkendali. Kalau startup 5 menit tanpa alasan, itu sinyal desain/dependency problem.

## 7.2 Startup Verification untuk Java

Startup verification minimal:

```text
- JVM process hidup
- HTTP port bound
- application context initialized
- no fatal exception in startup logs
- version endpoint mengembalikan expected version
- health/liveness UP
```

Startup verification advanced:

```text
- startup duration within baseline
- no unexpected classpath warning
- no illegal reflective access fatal issue
- no config fallback ke default berbahaya
- no missing env var warning
- no datasource misconfiguration
- no migration pending unexpectedly
```

Contoh startup log yang baik:

```text
service=case-api version=2026.06.18.42 git=a13f9c2 env=uat
java=21.0.7 vendor=Eclipse Adoptium
config.profile=uat
server.port=8080
management.port=8081
startup.completed duration_ms=18342
```

---

## 8. Readiness Verification

Readiness menjawab:

> “Apakah instance ini boleh menerima traffic sekarang?”

Readiness berbeda dari liveness.

| Konsep | Pertanyaan | Konsekuensi |
|---|---|---|
| Liveness | process masih bisa membuat progress? | restart container jika gagal |
| Readiness | instance boleh menerima traffic? | keluarkan dari endpoint jika gagal |
| Startup | process sudah melewati bootstrap? | beri waktu sebelum liveness aktif |

Readiness harus bersifat dinamis. Service bisa hidup tetapi tidak ready.

Contoh alasan tidak ready:

- config belum loaded;
- DB pool belum tersedia;
- migration belum compatible;
- cache wajib belum reachable;
- queue consumer sedang draining;
- service sedang overloaded;
- app sedang graceful shutdown;
- feature critical dependency down;
- warmup belum selesai.

## 8.1 Readiness Tidak Boleh Terlalu Dangkal

Readiness buruk:

```java
@GetMapping("/ready")
public String ready() {
    return "OK";
}
```

Ini hanya membuktikan controller bisa dipanggil.

Readiness lebih baik:

```text
- application state ACCEPTING_TRAFFIC
- required config loaded
- database connectivity valid
- migration compatibility valid
- mandatory downstream dependency reachable or degraded mode allowed
- local warmup completed
```

Tetapi readiness juga tidak boleh terlalu berat.

Readiness anti-pattern:

```text
- menjalankan query berat setiap 5 detik
- memanggil semua downstream external service setiap probe
- melakukan write test ke database
- memanggil API third party rate-limited
- melakukan full business transaction
```

Readiness harus murah, deterministik, dan aman.

## 8.2 Dependency Classification untuk Readiness

Tidak semua dependency harus masuk readiness.

Klasifikasikan dependency:

| Dependency | Readiness Impact | Contoh |
|---|---|---|
| Hard critical | service tidak boleh menerima traffic jika down | primary database untuk write API |
| Soft critical | sebagian fitur degrade | email provider untuk optional notification |
| Async critical | consumer tidak boleh jalan jika down | DB untuk queue processor |
| Optional | tidak memengaruhi readiness | recommendation engine optional |
| External risky | jangan dicek terlalu sering | third-party rate-limited API |

Contoh:

```text
Case submission API:
- DB: hard critical
- audit trail DB/table: hard critical
- Redis cache: soft critical jika fallback DB ada
- email service: soft critical jika retry queue ada
- reporting service: optional
```

Readiness harus merepresentasikan kemampuan menerima traffic untuk fungsi service tersebut.

## 8.3 Readiness Saat Shutdown

Saat deployment rolling update, instance harus berubah menjadi unready sebelum mati.

Flow yang benar:

```text
SIGTERM received
-> readiness = REFUSING_TRAFFIC
-> stop accepting new requests / consumers
-> wait for load balancer endpoint removal
-> finish in-flight work
-> close resources
-> exit
```

Jika readiness tetap UP selama shutdown, traffic bisa masuk ke instance yang sedang mati.

---

# Section C — Smoke Test

---

## 9. Smoke Test: Definisi yang Benar

Smoke test adalah test kecil setelah deployment untuk membuktikan jalur kritikal dasar berjalan.

Smoke test bukan full regression test.

Smoke test harus:

- cepat;
- deterministic;
- aman dijalankan di environment target;
- punya data yang terkontrol;
- menghasilkan signal pass/fail jelas;
- mencakup jalur business paling kritikal;
- tidak bergantung pada UI manual jika bisa dihindari;
- bisa dijalankan ulang tanpa merusak data.

## 9.1 Smoke Test yang Terlalu Dangkal

Contoh smoke test buruk:

```bash
curl -f https://app.example.com/actuator/health
```

Itu health check, bukan smoke test.

Contoh smoke test lebih berguna:

```text
- call /version and verify deployed version
- login/token acquisition using test client
- create draft case with test data
- fetch created case
- verify audit trail entry exists
- cancel/delete test case or mark as test
```

Untuk sistem regulatory, smoke test harus membuktikan minimal satu business path.

## 9.2 Smoke Test Scope

Smoke test scope harus dibatasi.

Contoh untuk REST API Java:

```text
1. GET /version
2. GET /actuator/health/readiness
3. POST /auth/token using test credential
4. POST /cases using synthetic test payload
5. GET /cases/{id}
6. GET /audit-trail?entityId={id}
7. cleanup or mark synthetic data
```

Contoh untuk queue consumer:

```text
1. publish synthetic message to test routing key
2. wait until consumed
3. verify database side effect
4. verify idempotency key recorded
5. verify no DLQ message
```

Contoh untuk batch job:

```text
1. insert small controlled input dataset
2. trigger job in dry-run/test partition
3. verify output row count
4. verify job status table
5. verify error table empty
```

## 9.3 Smoke Test Data Strategy

Smoke test harus punya strategi data.

Pilihan:

| Strategy | Kelebihan | Risiko |
|---|---|---|
| Dedicated test tenant | aman dan terisolasi | perlu desain multi-tenant/test flag |
| Synthetic marker | mudah difilter | bisa bocor ke laporan jika filter salah |
| Rollback transaction | bersih | tidak cocok lintas async boundary |
| Cleanup after test | realistis | cleanup bisa gagal |
| Read-only smoke | aman | tidak membuktikan write path |
| Dry-run endpoint | aman | bisa beda dari path production |

Untuk enterprise system, sering lebih baik punya synthetic entity dengan marker eksplisit:

```text
source = DEPLOYMENT_SMOKE_TEST
created_by = system-smoke-test
reference_no = SMOKE-20260618-001
```

Lalu reporting/audit bisa mengecualikan sesuai governance.

## 9.4 Smoke Test Idempotency

Smoke test harus aman diulang.

Jangan membuat test yang gagal kalau dijalankan dua kali.

Buruk:

```text
create user username=smoketest
expect success
```

Jika user sudah ada, test gagal palsu.

Lebih baik:

```text
create or reuse synthetic entity by idempotency key
verify final expected state
cleanup if safe
```

Contoh idempotency key:

```text
DEPLOY-SMOKE-{environment}-{service}-{version}-{timestamp-or-run-id}
```

## 9.5 Smoke Test Sebagai Gate

Smoke test harus menjadi gate.

```text
if smoke test fails:
    mark deployment failed
    stop rollout
    optionally rollback
```

Jangan hanya mengirim Slack notification tetapi pipeline tetap sukses.

Failure handling:

| Smoke Failure Type | Aksi |
|---|---|
| version mismatch | stop immediately |
| auth failure | stop, investigate config/IdP |
| DB write failure | stop/rollback |
| audit failure | stop/rollback untuk regulated system |
| optional email failure | degrade or warning, tergantung criticality |
| cleanup failure | warning + manual follow-up |

---

# Section D — Health Gates

---

## 10. Health Gate: Dari Health Endpoint ke Release Decision

Health gate adalah decision rule berbasis health signal.

Contoh sederhana:

```text
Continue rollout only if:
- all new pods ready
- service health readiness UP
- no restart loop
- startup duration within threshold
```

Namun health gate yang matang harus mempertimbangkan:

- instance health;
- service health;
- dependency health;
- traffic health;
- business health.

## 10.1 Layer Health

```text
Process health        : JVM alive
Runtime health        : no OOM/restart loop
Application health    : readiness/liveness correct
Dependency health     : DB/cache/queue reachable
Traffic health        : low 5xx, acceptable latency
Business health       : core action succeeds
Operational health    : logs/traces/metrics flowing
```

Health endpoint biasanya hanya sebagian kecil dari layer ini.

## 10.2 Health Gate Example

Gate untuk Java API service:

```text
Gate A — Startup:
- pod created
- startup probe passed
- no CrashLoopBackOff
- version endpoint matches expected image

Gate B — Readiness:
- readiness probe passed for all desired pods
- service endpoints updated
- no readiness flapping for 2 minutes

Gate C — Smoke:
- auth smoke passed
- create/read smoke passed
- audit smoke passed

Gate D — Observability:
- error rate < 1%
- p95 latency < baseline * 1.5
- no new critical exception pattern
- traces emitted for smoke transaction

Gate E — Rollout:
- continue canary/rolling only if A-D pass
```

## 10.3 Readiness Flapping

Readiness flapping adalah pod bolak-balik ready/unready.

Penyebab umum:

- dependency check terlalu sensitif;
- DB pool exhausted;
- startup belum warm;
- GC pause panjang;
- CPU throttling;
- health endpoint ikut dependency intermittent;
- readiness timeout terlalu pendek;
- application thread pool penuh sehingga health endpoint tidak terlayani.

Verification harus mendeteksi flapping.

Contoh rule:

```text
Pod dianggap stabil hanya jika readiness tetap true selama minimal 120 detik.
```

## 10.4 Health Endpoint Harus Punya Semantic yang Jelas

Endpoint health sebaiknya dipisah:

```text
/live       -> process liveness only
/ready      -> traffic readiness
/health     -> aggregate diagnostic, tidak selalu untuk liveness
/version    -> artifact identity
/deps       -> dependency diagnostic internal only
```

Spring Boot Actuator menyediakan konsep liveness/readiness health group pada versi modern, tetapi engineer tetap harus memastikan indikator yang masuk masing-masing group sesuai semantic aplikasi.

---

# Section E — Dependency Verification

---

## 11. Dependency Verification

Dependency verification memastikan service baru bisa berinteraksi dengan dependency kritikal.

Dependency Java production biasanya meliputi:

```text
- database
- cache
- message broker
- object storage
- identity provider
- downstream REST/gRPC services
- email/SMS gateway
- search engine
- external government/partner API
- filesystem/shared volume
```

## 11.1 Dependency Verification Bukan Sekadar Ping

Ping tidak cukup.

| Dependency | Ping Membuktikan | Belum Membuktikan |
|---|---|---|
| DB | host reachable | credential, schema, privilege, query works |
| Redis | port open | auth, db index, key command allowed |
| RabbitMQ | broker reachable | exchange/queue binding, permission, ack works |
| IdP | URL reachable | token flow, client secret, redirect URI, JWKS valid |
| S3/object storage | endpoint reachable | bucket permission, encryption policy, object write/read |
| SMTP | port open | auth, sender policy, relay allowed |

## 11.2 Database Verification

Database verification untuk deployment Java:

```text
- can connect using configured datasource
- schema version expected
- migration history valid
- current app compatible with schema
- required table/view/index exists
- required privilege exists
- simple read query works
- optional lightweight write/read/rollback check for critical write service
```

Contoh SQL check:

```sql
select version from schema_version order by installed_rank desc fetch first 1 row only;
```

Untuk Oracle:

```sql
select 1 from dual;
```

Tetapi `select 1 from dual` hanya membuktikan koneksi, bukan readiness business.

Advanced check:

```text
- required package/procedure accessible
- sequence accessible
- synonym resolves
- app user can insert into required audit table
- DB timezone/session settings expected
```

## 11.3 Message Broker Verification

Untuk RabbitMQ/Kafka-like systems, verification harus memastikan:

```text
- broker reachable
- authentication works
- exchange/topic exists
- queue/subscription exists
- binding/routing correct
- consumer group/id correct
- DLQ configured
- ack semantics correct
- consumer not active before app ready
```

Smoke message bisa dipakai, tetapi hati-hati di production. Gunakan routing key/topic test khusus atau metadata synthetic.

## 11.4 Identity Provider Verification

Untuk Java backend yang bergantung pada OIDC/SAML:

```text
- issuer reachable
- JWKS endpoint reachable
- client credentials valid if backend token flow used
- token signature verification works
- expected audience/client id matches
- clock skew acceptable
- role/group claim mapping works
```

Failure umum setelah deployment:

- wrong client secret;
- wrong redirect URI;
- stale JWKS cache;
- cert rotation belum masuk truststore;
- audience mismatch;
- environment issuer tertukar;
- clock skew membuat token dianggap expired/not yet valid.

## 11.5 Dependency Gate Harus Berbasis Criticality

Jangan semua dependency failure membuat service unready.

Contoh:

```text
If DB down -> not ready
If email gateway down -> ready but notification degraded, only if retry queue works
If analytics service down -> ready
If audit trail down -> not ready for regulated mutation service
```

Top engineer akan menulis dependency policy, bukan sekadar membuat semua health indicator fatal.

---

# Section F — Contract Verification

---

## 12. Contract Check

Contract check membuktikan bahwa interface antar service masih kompatibel.

Dalam deployment distributed Java, service baru mungkin:

- mengubah request/response JSON;
- mengubah enum value;
- mengubah required field;
- mengubah HTTP status;
- mengubah event schema;
- mengubah database-facing assumptions;
- mengubah error payload;
- mengubah security claims;
- mengubah timeout behavior.

Contract verification menjawab:

> “Apakah consumer lama dan provider baru masih bisa bicara? Apakah provider lama dan consumer baru masih kompatibel?”

## 12.1 API Contract

Untuk REST API:

```text
- endpoint path stable
- method stable
- required headers stable
- request schema backward compatible
- response schema backward compatible
- enum additions handled
- error format stable
- auth requirement compatible
- pagination/sorting semantics stable
```

Breaking change contoh:

```json
// old response
{
  "status": "APPROVED"
}
```

```json
// new response
{
  "caseStatus": "APPROVED"
}
```

Jika consumer lama membaca `status`, deployment provider baru akan merusak consumer.

Backward-compatible change:

```json
{
  "status": "APPROVED",
  "caseStatus": "APPROVED"
}
```

Lalu contract bisa diubah bertahap.

## 12.2 Event Contract

Untuk message/event:

```text
- topic/exchange name stable
- routing key stable
- schema version jelas
- required field tidak dihapus
- new field optional untuk old consumer
- enum extension aman
- timestamp format stabil
- idempotency key tersedia
```

Event contract lebih sulit dari REST karena event bisa tersimpan lama dan diproses ulang.

Invariant:

> Consumer baru harus bisa membaca event lama. Consumer lama harus tidak rusak oleh event baru selama rolling deployment.

## 12.3 Consumer-Driven Contract

Consumer-driven contract berguna ketika banyak service memakai provider yang sama.

Model:

```text
Consumer mendefinisikan expectation -> provider menjalankan verification terhadap expectation tersebut
```

Contoh expectation:

```text
When GET /cases/{id}
Then response must contain:
- id: string
- status: one of known values
- applicant.name: string
- createdDateTime: ISO-8601 string
```

Contract test bukan replacement integration test, tetapi guard terhadap breaking interface.

## 12.4 Contract Gate dalam Deployment

Contract gate bisa berjalan:

```text
- pre-merge
- pre-build
- pre-deploy
- post-deploy against canary endpoint
- before traffic shift
```

Untuk high-risk deployment, contract check terhadap canary endpoint sangat berguna:

```text
Deploy provider v2 to canary
Run consumer contract suite against v2 endpoint
Only then shift traffic
```

---

# Section G — Synthetic Transaction

---

## 13. Synthetic Transaction

Synthetic transaction adalah transaksi buatan yang menyerupai aktivitas user/sistem nyata dan dijalankan secara otomatis untuk menguji end-to-end behavior.

Berbeda dengan smoke test:

| Smoke Test | Synthetic Transaction |
|---|---|
| biasanya post-deploy | bisa terus-menerus |
| scope kecil | bisa end-to-end lebih realistis |
| gate deployment | monitoring production health |
| sering dijalankan sekali | dijalankan periodik |

Contoh synthetic transaction untuk case management:

```text
1. login as synthetic officer
2. create synthetic application/case
3. submit case
4. verify state = SUBMITTED
5. verify audit trail exists
6. verify notification queued
7. cancel/close synthetic case
```

## 13.1 Synthetic Transaction Design Rules

Synthetic transaction harus:

- menggunakan data synthetic yang jelas;
- tidak mencemari laporan business;
- tidak mengirim email/SMS ke user nyata;
- tidak memicu payment/financial side effect nyata;
- bisa dibersihkan atau diarsipkan;
- punya correlation id;
- punya dashboard sendiri;
- fail fast jika invariant penting rusak.

## 13.2 Synthetic User / Tenant

Gunakan synthetic principal:

```text
username: synthetic-deployment-checker
role: SMOKE_TEST_OFFICER
tenant: SYNTHETIC
permissions: minimal required
```

Jangan pakai user admin manusia.

Alasan:

- audit trail jelas;
- least privilege;
- mudah difilter;
- tidak bergantung password personal;
- bisa rotate credential sendiri.

## 13.3 Synthetic Correlation ID

Setiap synthetic transaction harus punya correlation id.

Contoh:

```text
X-Correlation-ID: syn-deploy-20260618-case-api-v42-0001
```

Ini membuat logs/traces/metrics bisa dihubungkan.

Verification lanjutan:

```text
- trace exists for correlation id
- all expected spans exist
- no error span
- DB write span success
- message publish span success
```

## 13.4 Synthetic Transaction sebagai Canary Gate

Dalam canary deployment:

```text
1. deploy v2 to 5% traffic
2. route synthetic transaction specifically to v2
3. verify end-to-end success
4. observe metrics for window N minutes
5. increase traffic if pass
```

Synthetic route bisa memakai:

- header-based routing;
- canary host;
- dedicated ingress;
- service mesh routing;
- test user affinity;
- feature flag targeting.

---

# Section H — Metrics, Logs, and Trace Gates

---

## 14. Metric Gate

Metric gate memakai telemetry untuk membuat keputusan rollout.

Metric penting untuk Java service:

```text
- HTTP request rate
- HTTP error rate
- HTTP latency P50/P95/P99
- JVM memory used/committed
- GC pause time
- CPU usage/throttling
- thread count
- connection pool active/idle/pending
- queue consumer lag/backlog
- DB query latency
- downstream call error/latency
- restart count
```

## 14.1 Golden Signals

Empat golden signals umum:

```text
- latency
- traffic
- errors
- saturation
```

Untuk Java deployment, tambahkan:

```text
- GC pressure
- connection pool pressure
- thread pool queue depth
- queue backlog
- OOM/restart signal
```

## 14.2 Threshold vs Baseline

Threshold statis mudah tetapi sering salah.

Contoh:

```text
error_rate < 1%
p95_latency < 500ms
```

Masalah:

- service tertentu normalnya latency 800ms;
- traffic rendah membuat error rate flappy;
- deploy saat off-peak beda baseline;
- cold cache membuat latency sementara naik.

Lebih baik gabungkan:

```text
absolute threshold + relative baseline + minimum sample count
```

Contoh:

```text
Pass if:
- request_count >= 100 selama 5 menit
- 5xx_rate < 1%
- p95_latency < min(1000ms, baseline_p95 * 1.5)
- restart_count == 0
```

## 14.3 Minimum Sample Problem

Jika canary hanya menerima 3 request dan 1 gagal, error rate 33%. Jika 3 request semua sukses, belum tentu aman.

Gate harus punya minimum sample:

```text
if request_count < 100:
    continue observing, do not promote yet
```

Untuk low-traffic service, gunakan synthetic traffic untuk memberi sample.

## 14.4 Log Gate

Log gate mencari pola berbahaya setelah deploy.

Contoh pattern:

```text
- ERROR
- Exception
- NoClassDefFoundError
- ClassNotFoundException
- NoSuchMethodError
- LinkageError
- SQLSyntaxErrorException
- ORA-
- OutOfMemoryError
- Connection refused
- SSLHandshakeException
- token validation failed
```

Namun log gate harus hati-hati:

- banyak aplikasi log ERROR untuk hal non-fatal;
- beberapa exception normal dalam retry;
- string matching raw bisa noisy;
- structured logging lebih baik.

Log gate lebih kuat jika berbasis structured field:

```json
{
  "level": "ERROR",
  "service": "case-api",
  "version": "2026.06.18.42",
  "error_type": "SQLSyntaxErrorException",
  "correlation_id": "..."
}
```

## 14.5 Trace Gate

Trace gate berguna untuk distributed system.

Check:

```text
- traces emitted by new version
- critical spans exist
- no error span in smoke/synthetic trace
- downstream latency within threshold
- DB span present and successful
- message publish span successful
```

Trace gate bisa menemukan masalah yang metric agregat belum tunjukkan.

Contoh:

```text
Smoke test HTTP 200, tapi trace menunjukkan email publish gagal dan masuk fallback.
```

Business mungkin menganggap itu gagal jika notification critical.

---

# Section I — Progressive Delivery Analysis

---

## 15. Progressive Delivery Gate

Progressive delivery menggunakan verification untuk mengontrol rollout bertahap.

Contoh canary:

```text
0% -> deploy canary
synthetic check
5% traffic -> observe 5 min
20% traffic -> observe 10 min
50% traffic -> observe 10 min
100% traffic -> complete
```

Setiap step punya gate.

## 15.1 Analysis Template Concept

Tools seperti Argo Rollouts mendukung analysis run untuk menentukan apakah rollout lanjut/abort berdasarkan metric provider.

Secara konseptual:

```text
metric query -> threshold -> success/failure -> promote/abort
```

Contoh metric gate:

```text
successCondition: error_rate < 0.01 and p95_latency < 750ms
failureCondition: error_rate > 0.05 or restart_count > 0
```

## 15.2 Canary Analysis untuk Java

Metric yang cocok untuk Java canary:

```text
- HTTP 5xx rate by version
- latency by version
- JVM GC pause by version
- container restart by version
- DB pool pending acquisition by version
- downstream timeout by version
- exception count by version
```

Penting: metric harus bisa difilter berdasarkan version/pod/canary label.

Jika telemetry tidak punya label version, canary analysis sulit dipercaya.

## 15.3 Shadow Analysis

Shadow traffic/mirroring mengirim salinan request ke versi baru tanpa memengaruhi response user.

Cocok untuk:

- read-only endpoint;
- new search/index service;
- scoring/recommendation;
- validation engine;
- transformation service.

Berbahaya untuk:

- mutating endpoint;
- payment;
- email/SMS;
- state transition;
- queue publish;
- external API with side effects.

Untuk Java service, shadow mode sering membutuhkan application-level guard:

```text
if request header X-Shadow-Traffic=true:
    do not commit side effects
    do not publish messages
    do not call external irreversible systems
```

## 15.4 Rollback vs Abort vs Pause

Progressive deployment punya beberapa aksi:

| Aksi | Makna |
|---|---|
| Pause | berhenti sementara untuk observasi/manual approval |
| Abort | hentikan rollout, jangan tambah traffic |
| Rollback | kembali ke versi sebelumnya |
| Roll-forward | deploy fix baru |
| Degrade | matikan fitur tertentu via flag |

Tidak semua failure harus rollback otomatis.

Contoh:

```text
- version mismatch: abort immediately
- critical smoke fail: rollback
- optional dependency warning: pause/degrade
- low sample metric: continue observing
- high 5xx: rollback or route traffic away
- DB migration already applied incompatible: rollback app mungkin tidak cukup
```

---

# Section J — Java-Specific Verification Patterns

---

## 16. Verify JVM and Runtime Identity

Karena series ini mencakup Java 8–25, runtime identity penting.

Check:

```bash
java -version
```

Namun di container production, lebih baik expose runtime info via endpoint/log:

```text
java.version=21.0.7
java.vendor=Eclipse Adoptium
java.vm.name=OpenJDK 64-Bit Server VM
java.runtime.version=21.0.7+6-LTS
```

Kenapa penting?

- Java 8 vs 17 vs 21 punya behavior TLS/default GC/container berbeda;
- wrong runtime bisa membuat flags ignored/fatal;
- container image bisa tidak sesuai expectation;
- patch CVE harus dibuktikan runtime version-nya.

## 16.1 Verify JVM Flags Actually Applied

Jangan hanya percaya manifest.

Aplikasi bisa log important JVM flags saat startup:

```text
- MaxHeapSize
- MaxRAMPercentage
- ActiveProcessorCount
- timezone
- file.encoding
- user.language/user.country
- java.security properties if relevant
```

Untuk debug advanced:

```bash
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.command_line
```

Di production container, akses `jcmd` mungkin tidak tersedia jika image distroless/minimal. Maka startup log menjadi lebih penting.

## 16.2 Verify Classpath/Module Failure Early

Beberapa classpath issue baru muncul saat endpoint tertentu dipanggil.

Smoke test harus mengeksekusi code path yang memicu:

- JSON serialization/deserialization;
- database access;
- template rendering;
- security token parsing;
- reflection/proxy framework;
- optional module/library;
- generated mapper;
- mail/attachment code path jika critical.

Contoh:

```text
App start sukses, tetapi endpoint export PDF gagal karena font/native library tidak ada di image.
```

Startup health tidak akan menangkap ini.

## 16.3 Verify Thread/Pool Saturation

Java apps sering gagal bukan karena process mati, tetapi pool habis.

Verification metric:

```text
- Tomcat/Jetty active threads
- executor queue size
- HikariCP active/idle/pending
- RabbitMQ consumer unacked
- Kafka consumer lag
- ForkJoinPool saturation if used
- virtual thread carrier pressure if observable
```

Smoke traffic kecil tidak cukup untuk melihat saturation, tetapi post-deploy metric gate bisa menangkap anomaly awal.

## 16.4 Verify Timezone and Clock

Deployment issue sering muncul dari timezone/clock.

Check:

```text
- JVM timezone expected
- database session timezone expected
- container OS timezone expected if used
- NTP/clock skew acceptable
- token validation not failing due to clock
- scheduled job next fire time expected
```

Untuk regulatory/case system, timestamp/audit/SLA sangat sensitif terhadap timezone.

---

# Section K — Pipeline Implementation Pattern

---

## 17. Recommended Deployment Verification Pipeline

Contoh high-level pipeline:

```text
1. Build artifact
2. Run unit/integration tests
3. Generate SBOM/sign artifact
4. Push immutable image
5. Validate deployment manifest
6. Deploy to target environment
7. Wait for startup gate
8. Wait for readiness gate
9. Verify version endpoint
10. Run smoke test
11. Run dependency check
12. Run contract check
13. Run synthetic transaction
14. Observe metrics/logs/traces for window
15. Promote rollout or rollback/abort
16. Store deployment evidence
```

## 17.1 Example Shell-Oriented Verification Flow

Simplified example:

```bash
set -euo pipefail

EXPECTED_VERSION="2026.06.18.42"
BASE_URL="https://case-api.uat.example.com"

curl -fsS "$BASE_URL/version" | tee version.json
jq -e --arg v "$EXPECTED_VERSION" '.version == $v' version.json

curl -fsS "$BASE_URL/actuator/health/readiness" | jq -e '.status == "UP"'

TOKEN=$(curl -fsS -X POST "$BASE_URL/oauth/test-token" \
  -H 'Content-Type: application/json' \
  -d '{"client":"smoke"}' | jq -r '.access_token')

CASE_ID=$(curl -fsS -X POST "$BASE_URL/cases" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Correlation-ID: smoke-${EXPECTED_VERSION}" \
  -H 'Content-Type: application/json' \
  -d @smoke-case.json | jq -r '.id')

curl -fsS "$BASE_URL/cases/$CASE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -e '.status == "DRAFT" or .status == "SUBMITTED"'

curl -fsS "$BASE_URL/audit-trail?entityId=$CASE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -e '.items | length >= 1'
```

Catatan:

- Ini contoh konseptual, bukan template final.
- Di production, token endpoint test harus aman.
- Synthetic data harus diberi marker.
- Cleanup harus dipikirkan.

## 17.2 Kubernetes Wait Gate

Contoh:

```bash
kubectl rollout status deployment/case-api -n aceas --timeout=300s
kubectl wait --for=condition=available deployment/case-api -n aceas --timeout=300s
```

Ini berguna, tetapi belum cukup. Setelah itu tetap perlu version/smoke/metric gate.

## 17.3 Version Verification dengan Pod Label

Idealnya deployment punya label:

```yaml
metadata:
  labels:
    app.kubernetes.io/name: case-api
    app.kubernetes.io/version: "2026.06.18.42"
    app.kubernetes.io/part-of: aceas
    git.commit: "a13f9c2"
```

Dan endpoint `/version` mengembalikan value yang sama.

Gate:

```text
manifest version == pod label version == endpoint version == image digest expected
```

Jika tidak sama, ada drift.

---

# Section L — Environment-Specific Verification

---

## 18. DEV Verification

DEV verification boleh lebih ringan, tetapi harus menangkap issue kasar.

Minimum:

```text
- deploy succeeds
- app starts
- readiness UP
- version correct
- basic smoke path
- no obvious startup exception
```

DEV jangan terlalu longgar sampai error dasar baru ketemu di UAT.

## 18.1 SIT/UAT Verification

SIT/UAT harus lebih business-oriented.

Tambahkan:

```text
- integration with real-like dependencies
- role-based smoke test
- critical workflow test
- migration compatibility check
- test user journey
- report/audit validation
- queue/job verification
```

Untuk UAT enterprise, verification evidence sering diperlukan untuk release sign-off.

## 18.2 Production Verification

Production verification harus aman dan minim side effect.

Contoh:

```text
- version check
- readiness check
- synthetic transaction with production-safe test tenant
- metric/log gate
- canary/ring analysis
- dashboard observation window
- audit evidence storage
```

Jangan menjalankan destructive test di production.

## 18.3 DR Verification

DR environment sering dilupakan.

Verification DR:

```text
- artifact version parity
- config parity where needed
- secret/cert valid
- DB replication status
- read/write mode expected
- DNS/failover route known
- synthetic transaction after failover drill
```

---

# Section M — Failure Classification and Decision

---

## 19. Failure Classification

Saat verification gagal, jangan langsung “fix random”. Klasifikasikan.

```text
Class A: Artifact identity failure
Class B: Runtime startup failure
Class C: Readiness failure
Class D: Dependency failure
Class E: Contract failure
Class F: Business smoke failure
Class G: Telemetry/metric regression
Class H: Data/schema incompatibility
Class I: Security/auth/cert failure
Class J: Verification tool false positive
```

## 19.1 Decision Matrix

| Failure | Typical Action |
|---|---|
| wrong version deployed | stop/rollback, investigate pipeline |
| CrashLoopBackOff | rollback unless quick config fix safe |
| readiness never UP | stop rollout, inspect readiness/deps |
| DB migration incompatible | pause, assess schema rollback/forward fix |
| smoke business write fails | rollback/abort |
| optional dependency down | degrade/pause depending policy |
| error rate spike | rollback or traffic shift away |
| latency mild increase | observe/pause/canary hold |
| contract failure | abort before traffic shift |
| verification script bug | fix script, rerun, do not ignore blindly |

## 19.2 Rollback Is Not Always Safe

Deployment verification must know rollback constraints.

Rollback unsafe if:

- irreversible DB migration applied;
- new app wrote data old app cannot read;
- event schema changed and old consumer cannot parse;
- external side effects already triggered;
- cache format incompatible;
- session serialization changed;
- old artifact no longer compatible with rotated secret/cert.

Karena itu, pre-deploy verification harus menilai rollback plan sebelum deploy.

---

# Section N — Verification Evidence and Auditability

---

## 20. Deployment Evidence

Untuk enterprise/regulatory environment, deployment sukses harus punya evidence.

Evidence minimal:

```text
- release id
- service name
- environment
- deployment time
- deployed version
- image digest/artifact checksum
- approver if required
- smoke test result
- health gate result
- migration result
- metric observation window
- rollback status/plan
- known issue/deviation
```

## 20.1 Evidence Format

Contoh:

```json
{
  "releaseId": "REL-2026-06-18-ACEAS-42",
  "service": "case-api",
  "environment": "production",
  "version": "2026.06.18.42",
  "imageDigest": "sha256:abc...",
  "startedAt": "2026-06-18T14:00:00+08:00",
  "completedAt": "2026-06-18T14:18:00+08:00",
  "gates": {
    "rolloutStatus": "PASS",
    "readiness": "PASS",
    "versionCheck": "PASS",
    "smokeTest": "PASS",
    "contractCheck": "PASS",
    "metricGate": "PASS"
  },
  "metricsWindow": "10m",
  "rollbackAvailable": true,
  "operator": "release-bot"
}
```

## 20.2 Why Evidence Matters

Evidence membantu:

- audit;
- incident RCA;
- release governance;
- compliance;
- knowledge transfer;
- membuktikan deployment bukan manual guesswork;
- membandingkan release yang sehat vs bermasalah.

Top engineer tidak hanya membuat deployment berhasil, tetapi membuat deployment **explainable**.

---

# Section O — Anti-Patterns

---

## 21. Anti-Pattern Catalog

## 21.1 “Pod Running Means Success”

Salah. Pod running hanya berarti container process belum mati.

## 21.2 “Health UP Means Business OK”

Salah. Health endpoint bisa terlalu dangkal.

## 21.3 “Smoke Test Only Opens Homepage”

Untuk backend/API, homepage check hampir tidak bernilai.

## 21.4 “All Dependencies Must Be UP or Service Down”

Ini membuat service terlalu fragile. Dependency harus diklasifikasikan.

## 21.5 “Ignore Low Traffic Canary”

Canary tanpa sample cukup tidak membuktikan apa-apa.

## 21.6 “Rollback Always Works”

Salah besar, terutama jika ada DB migration/event schema/cache format change.

## 21.7 “Verification Script Has No Owner”

Verification script adalah production code. Harus dirawat, versioned, reviewed.

## 21.8 “Manual QA is Deployment Gate”

Manual QA penting, tetapi deployment gate harus sebisa mungkin otomatis, cepat, repeatable, dan evidence-based.

## 21.9 “Readiness Calls Every Downstream Service”

Ini bisa menyebabkan cascading failure dan rate limit issue.

## 21.10 “Production Smoke Test Uses Real User/Admin”

Berbahaya untuk audit, security, dan repeatability.

---

# Section P — Practical Design Templates

---

## 22. Verification Checklist for Java REST Service

```text
Artifact Identity
[ ] version endpoint exists
[ ] git commit exposed
[ ] image digest recorded
[ ] Java version logged

Startup
[ ] startup probe configured if needed
[ ] startup duration tracked
[ ] no fatal startup warnings

Readiness
[ ] readiness separate from liveness
[ ] DB critical check present
[ ] dependency classification documented
[ ] readiness false during shutdown

Smoke
[ ] auth/token path tested
[ ] one critical read path tested
[ ] one critical write path tested if safe
[ ] audit/log side effect verified if required
[ ] synthetic data marked
[ ] idempotent rerun possible

Contract
[ ] provider contract tests pass
[ ] consumer compatibility checked
[ ] event schema compatibility checked if applicable

Telemetry Gate
[ ] 5xx rate monitored
[ ] latency monitored
[ ] JVM memory/GC monitored
[ ] DB pool monitored
[ ] exception logs checked
[ ] traces emitted

Decision
[ ] rollback criteria defined
[ ] pause/abort criteria defined
[ ] evidence stored
```

## 22.1 Verification Checklist for Java Queue Consumer

```text
Artifact Identity
[ ] version visible in logs/metrics
[ ] consumer group/version label available

Startup
[ ] app starts without consuming before ready
[ ] broker connection established
[ ] queue/topic exists

Readiness
[ ] consumer ready only after DB/deps ready
[ ] readiness false during drain/shutdown

Smoke
[ ] synthetic message can be consumed
[ ] side effect verified
[ ] ack only after success
[ ] DLQ remains clean
[ ] duplicate synthetic message safe

Telemetry
[ ] consumer lag/backlog monitored
[ ] unacked messages monitored
[ ] processing error rate monitored
[ ] retry/DLQ count monitored

Shutdown
[ ] stop polling/consuming before exit
[ ] in-flight messages completed or safely requeued
```

## 22.2 Verification Checklist for Java Batch Job

```text
Artifact Identity
[ ] job version logged
[ ] parameters logged
[ ] Java version logged

Pre-run
[ ] input dataset exists
[ ] lock/leader ownership clear
[ ] previous run status checked

Execution
[ ] job starts
[ ] progress metric emitted
[ ] chunk/step status visible
[ ] errors captured with reason

Post-run
[ ] output count expected
[ ] reconciliation passes
[ ] no duplicate processing
[ ] job status persisted
[ ] retry policy known
```

---

# Section Q — Worked Example: Case Management API Deployment Verification

---

## 23. Scenario

Service:

```text
case-management-api
```

Critical functions:

```text
- officer login/token validation
- create case
- submit case
- state transition
- audit trail
- notification queue
```

Dependencies:

```text
- Oracle/PostgreSQL database
- Redis cache
- RabbitMQ notification queue
- OIDC identity provider
- audit trail table/service
```

## 23.1 Invariants

```text
I1: App must not accept mutation traffic unless DB and audit trail are writable.
I2: Created case must have audit trail entry.
I3: Submitted case must publish notification event or durable retry record.
I4: Deployment must expose correct version and git commit.
I5: Error rate after deploy must not exceed threshold.
I6: Rollback must be possible unless migration explicitly marked irreversible.
```

## 23.2 Verification Plan

```text
Pre-deploy:
- validate manifest
- validate image digest
- validate migration compatibility
- validate rollback plan

Deploy:
- apply deployment
- wait rollout status
- wait readiness stable 2 minutes

Post-deploy smoke:
- GET /version
- GET /actuator/health/readiness
- token validation using synthetic officer
- create synthetic case
- submit synthetic case
- verify audit trail entry
- verify notification event queued

Metrics:
- observe 5xx rate 10 minutes
- observe p95 latency 10 minutes
- observe DB pool pending
- observe queue publish error
- scan critical exception logs

Decision:
- promote if all gates pass
- rollback if smoke/audit fail
- pause if optional notification delay but retry record exists
```

## 23.3 Example Gate Table

| Gate | Pass Criteria | Failure Action |
|---|---|---|
| version | endpoint version equals release | abort |
| readiness | all pods ready stable 2 min | pause/rollback |
| DB | schema compatible, connection ok | rollback/pause |
| smoke create | case created | rollback |
| audit | audit row exists | rollback |
| notification | queue event or retry record exists | pause/degrade depending policy |
| metric | 5xx < 1%, p95 < baseline*1.5 | rollback/pause |
| log | no critical new exception | investigate/pause |

---

# Section R — Mental Model Summary

---

## 24. Deployment Verification as Control System

Think of deployment as a control system:

```text
Change introduced -> observe system -> compare with expected invariants -> decide next action
```

```text
artifact/version
      |
      v
runtime startup
      |
      v
readiness
      |
      v
smoke/synthetic/contract
      |
      v
metrics/logs/traces
      |
      v
promote / pause / abort / rollback / roll-forward
```

Weak engineers stop at “deployed”.

Strong engineers ask:

```text
- What exactly did we deploy?
- What invariant did we verify?
- What evidence proves it?
- What can still be wrong?
- What is the rollback boundary?
- What signal would make us stop?
```

Top 1% engineers design systems where the answer is not based on feeling.

---

## 25. Final Checklist for This Part

Setelah memahami Part 22, kamu harus bisa:

```text
[ ] membedakan probe, health check, smoke test, synthetic transaction, dan gate
[ ] mendesain verification berdasarkan invariant, bukan tool
[ ] menentukan dependency mana yang fatal untuk readiness
[ ] membuat smoke test yang aman, idempotent, dan business-relevant
[ ] memakai metric/log/trace sebagai rollout gate
[ ] memahami minimum sample problem pada canary
[ ] membedakan rollback, abort, pause, degrade, dan roll-forward
[ ] membuat evidence deployment yang auditable
[ ] mendesain verification untuk REST service, queue consumer, dan batch job
[ ] menghindari anti-pattern “pod running berarti sukses”
```

---

## 26. Hubungan dengan Part Sebelumnya dan Berikutnya

Part ini bergantung pada:

- Part 14: Kubernetes deployment;
- Part 15: probes dan graceful shutdown;
- Part 16: resource sizing;
- Part 17: release strategy;
- Part 18: database-aware deployment;
- Part 19: stateful deployment;
- Part 21: observability-ready deployment.

Part berikutnya akan membahas:

> **Part 23 — CI/CD Pipeline for Java Deployment**

Di sana kita akan menyusun pipeline end-to-end dari commit sampai production, termasuk artifact promotion, environment promotion, approval gate, GitOps, Helm/Kustomize, Argo CD/Flux, Jenkins/GitHub Actions/GitLab/Azure DevOps, rollback automation, dan bagaimana verification dari Part 22 ditempatkan sebagai bagian pipeline.

---

# Referensi Utama

- Kubernetes documentation — Liveness, Readiness, and Startup Probes.
- Kubernetes documentation — Configure Liveness, Readiness and Startup Probes.
- Spring Boot Actuator documentation and Spring blog guidance on liveness/readiness probes.
- Argo Rollouts documentation — Analysis and Progressive Delivery.
- OpenTelemetry documentation — HTTP semantic conventions and metrics conventions.
- General production engineering practice around smoke tests, synthetic transactions, deployment gates, and progressive delivery.

---

# Status Series

Selesai: **Part 22 dari 35**.

Belum selesai. Lanjut ke:

**Part 23 — CI/CD Pipeline for Java Deployment**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-21-observability-ready-deployment.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-deployment-runtime-release-delivery-engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-23-cicd-pipeline-for-java-deployment.md)
