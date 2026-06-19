# learn-java-microservices-patterns-advanced-engineering-32-cost-complexity-architecture-economics

> **Series**: Java Microservices Patterns — Advanced Engineering  
> **Part**: 32 of 35  
> **Topic**: Cost, Complexity, and Architecture Economics  
> **Java Range**: Java 8–25  
> **Goal**: memahami microservices sebagai keputusan ekonomi, bukan hanya keputusan teknis.

---

## 0. Posisi Part Ini di Dalam Series

Sampai part sebelumnya, kita sudah membahas banyak aspek teknis microservices:

- distributed systems reality,
- service boundary,
- domain modeling,
- communication pattern,
- event-driven architecture,
- saga,
- outbox/inbox,
- consistency,
- data ownership,
- query pattern,
- API gateway/BFF,
- discovery/configuration,
- resilience,
- backpressure,
- idempotency,
- workflow,
- state machine,
- security,
- multi-tenancy,
- observability,
- testing,
- compatibility,
- deployment,
- runtime platform,
- performance,
- caching,
- migration,
- governance,
- incident and reliability operations.

Part ini mengikat semua itu dari sudut pandang **cost and complexity economics**.

Microservices tidak gratis. Ia membeli beberapa hal:

- independent deployability,
- team autonomy,
- fault isolation,
- technology/runtime flexibility,
- scaling granularity,
- data ownership clarity,
- evolvability.

Tetapi pembayarannya datang dalam bentuk:

- infrastructure cost,
- operational cost,
- cognitive cost,
- coordination cost,
- observability cost,
- testing cost,
- security cost,
- data duplication cost,
- network and runtime overhead,
- incident complexity,
- governance burden.

Engineer biasa bertanya:

> “Bisa dibuat microservice?”

Engineer lebih matang bertanya:

> “Apakah manfaat pemisahan ini lebih besar daripada premium cost dan risk yang ditambahkan?”

Engineer top-tier bertanya lebih dalam:

> “Pada titik kompleksitas, volume perubahan, ownership, regulatory risk, dan operational maturity seperti apa microservice ini menghasilkan net positive value?”

---

## 1. Core Thesis

Microservices adalah **economic trade-off**.

Bukan semua sistem kompleks perlu microservices. Bukan semua microservice architecture lebih murah. Bukan semua service kecil membuat organisasi lebih cepat.

Ada konsep penting yang sering disebut **microservice premium**: microservices membawa cost dan risk tambahan yang hanya layak dibayar ketika kompleksitas sistem sudah cukup tinggi sehingga benefit modularitas, ownership, dan deployment independence mengalahkan premium tersebut.

Dalam bahasa sederhana:

```text
microservices are not free modularity
microservices are purchased modularity
```

Kita membeli modularity dengan:

```text
network + platform + observability + testing + coordination + governance + operations
```

Jika sistem masih bisa dikelola dengan modular monolith yang sehat, microservices bisa membuat produktivitas turun, bukan naik.

---

## 2. Mental Model: Architecture Has an Income Statement

Bayangkan arsitektur sebagai perusahaan kecil.

Ia punya **revenue** dan **expense**.

### 2.1 Architecture Revenue

Revenue microservices adalah benefit yang dihasilkan:

| Benefit | Meaning |
|---|---|
| Faster independent release | tim bisa deploy tanpa menunggu release besar |
| Fault isolation | kegagalan satu area tidak mematikan semua |
| Scaling granularity | bagian yang berat bisa discale sendiri |
| Team autonomy | ownership lebih jelas |
| Domain clarity | bounded context lebih eksplisit |
| Regulatory segregation | tanggung jawab data, audit, dan authority lebih jelas |
| Technology flexibility | runtime/storage dapat dipilih sesuai kebutuhan |
| Evolution speed | domain tertentu bisa berubah tanpa menyentuh seluruh sistem |

### 2.2 Architecture Expense

Expense microservices adalah biaya yang harus dibayar terus-menerus:

| Cost | Meaning |
|---|---|
| Infra cost | pod, node, DB, broker, cache, ingress, mesh, NAT, log, trace |
| Operational cost | on-call, runbook, incident, patching, certificate, secret rotation |
| Testing cost | contract, integration, component, E2E, test environment |
| Observability cost | logs, metrics, traces, dashboards, cardinality, storage retention |
| Security cost | token, mTLS, policy, service identity, audit, secret management |
| Cognitive cost | engineer harus memahami lebih banyak moving parts |
| Coordination cost | API/event governance, release order, compatibility |
| Latency cost | network hop, serialization, retry, timeout |
| Data cost | duplication, projection, reconciliation, retention |
| Platform cost | CI/CD, Kubernetes, service discovery, config, golden path |

### 2.3 Net Architecture Value

Formula sederhananya:

```text
net value = architecture revenue - architecture expense
```

Microservices layak jika:

```text
benefit of independence + isolation + ownership + evolvability
>
cost of distribution + operation + coordination + complexity
```

---

## 3. Why Cost Discussion Is Usually Poorly Framed

Banyak diskusi cost microservices terlalu dangkal:

```text
“Microservices mahal karena butuh banyak server.”
```

Itu benar, tetapi tidak lengkap.

Cost terbesar sering bukan compute. Cost terbesar sering berupa:

- debugging time,
- incident time,
- release coordination,
- test maintenance,
- schema compatibility work,
- observability storage,
- team cognitive overload,
- repeated platform boilerplate,
- duplicated security plumbing,
- failed decomposition,
- slow onboarding,
- change amplification.

Cost paling berbahaya adalah cost yang **tidak muncul di cloud bill**.

Contoh:

```text
Cloud bill naik 20%, tetapi release cycle turun 60%.
```

Itu mungkin sehat.

Sebaliknya:

```text
Cloud bill hanya naik 5%, tetapi setiap bug butuh 5 tim untuk investigasi.
```

Itu mungkin sangat mahal.

---

## 4. Cost Taxonomy for Microservices

Kita butuh taxonomy agar cost bisa dianalisis, bukan dirasakan secara emosional.

---

## 4.1 Infrastructure Cost

Infrastructure cost adalah biaya resource fisik/logis.

Contoh:

- Kubernetes nodes,
- container CPU/memory,
- load balancer,
- API gateway,
- service mesh sidecar,
- database instance,
- read replica,
- message broker,
- distributed cache,
- object storage,
- search cluster,
- NAT gateway,
- data transfer,
- secrets manager,
- log storage,
- trace storage,
- metric storage,
- backup,
- disaster recovery environment.

### Microservices effect

Monolith:

```text
1 app
1 DB
1 deployment pipeline
1 log stream
1 health model
```

Microservices:

```text
N apps
N deployment units
N DB/schema ownership areas
N dashboards
N alerts
N runbooks
N dependency graphs
N security relationships
```

Even if each service is small, the platform footprint multiplies.

### Hidden infra multiplier

Jika setiap service butuh:

```text
minimum 200m CPU
minimum 512Mi memory
2 replicas
sidecar
log ingestion
metrics scraping
tracing
```

Maka 40 service menghasilkan baseline cost bahkan saat traffic rendah.

Microservices punya **idle tax**.

### Rule of thumb

Microservices economically weak jika:

```text
service count grows faster than business capability count
```

Artinya service dibuat karena technical enthusiasm, bukan karena boundary bisnis yang jelas.

---

## 4.2 Operational Cost

Operational cost adalah biaya untuk menjaga sistem tetap berjalan.

Termasuk:

- deployment operation,
- incident response,
- patching,
- certificate rotation,
- secret rotation,
- dependency upgrades,
- vulnerability response,
- database maintenance,
- message backlog handling,
- cache incident handling,
- disaster recovery testing,
- compliance evidence collection.

### Operational surface area

Setiap service menambah:

```text
runtime unit
configuration unit
failure unit
deployment unit
ownership unit
observability unit
security unit
```

Semakin banyak unit, semakin besar permukaan operasi.

### Service count is not free

Membuat service baru berarti membuat:

- repository/module,
- CI pipeline,
- deployment manifest,
- config set,
- secret set,
- database migration flow,
- dashboard,
- alert rule,
- log parser,
- runbook,
- ownership record,
- dependency record,
- API/event contract,
- security policy,
- test strategy.

Jika organisasi belum punya golden path/platform automation, setiap service baru menjadi operasi manual baru.

---

## 4.3 Cognitive Cost

Cognitive cost adalah biaya mental untuk memahami, mengubah, dan mengoperasikan sistem.

Ini sering lebih mahal daripada compute.

### Sources of cognitive load

- banyak repository,
- banyak service boundary,
- banyak contract,
- banyak framework,
- banyak deployment pattern,
- banyak error mode,
- banyak dependency,
- banyak dashboard,
- banyak alert,
- banyak environment,
- banyak ownership ambiguity.

### Symptoms

Cognitive cost terlalu tinggi jika:

- engineer takut mengubah sistem,
- debugging selalu butuh senior tertentu,
- onboarding sangat lama,
- dokumentasi selalu tertinggal,
- tim tidak tahu siapa owner service,
- perubahan kecil butuh banyak meeting,
- incident triage lambat karena dependency graph tidak dipahami,
- semua orang hanya mengerti “bagian kecil” tanpa mental model end-to-end.

### Principle

```text
Architecture should reduce local cognitive load without exploding global cognitive load.
```

Microservices yang bagus membuat tim lebih fokus.

Microservices yang buruk membuat semua tim harus memahami seluruh distributed mess.

---

## 4.4 Coordination Cost

Coordination cost muncul ketika banyak pihak harus sinkron agar perubahan aman.

Contoh:

- service A mengubah API,
- service B harus update client,
- service C bergantung pada event lama,
- BFF harus ubah response shape,
- QA harus menyiapkan E2E test,
- release manager harus mengatur urutan deployment,
- DBA harus menyiapkan migration,
- platform team harus update config.

Jika setiap perubahan kecil butuh koordinasi banyak service, architecture tidak benar-benar loosely coupled.

### Change amplification

Definisi:

```text
change amplification = jumlah komponen/tim yang harus disentuh untuk satu business change
```

Microservices sehat jika:

```text
most business changes stay within one service/team boundary
```

Microservices buruk jika:

```text
every business change touches gateway + BFF + 5 services + shared library + shared DB + event schema
```

---

## 4.5 Testing Cost

Microservices membuat testing lebih mahal karena correctness tidak lagi bisa dibuktikan hanya dengan unit test lokal.

Tambahan testing yang muncul:

- API contract test,
- event contract test,
- provider verification,
- consumer verification,
- component test,
- integration test with real dependencies,
- ephemeral environment,
- E2E test,
- replay test,
- migration compatibility test,
- resilience test,
- multi-tenant isolation test,
- observability validation,
- security propagation test.

### E2E tax

Jika organisasi tidak punya contract testing yang kuat, E2E test menjadi safety net utama.

Akibatnya:

- E2E lambat,
- flaky,
- mahal dijaga,
- environment rebutan,
- debugging sulit,
- release bottleneck.

Testing cost naik secara non-linear terhadap jumlah service dan dependency.

---

## 4.6 Observability Cost

Distributed systems butuh observability serius.

Tetapi observability juga punya cost:

- log ingestion,
- metric cardinality,
- trace volume,
- dashboard maintenance,
- alert tuning,
- retention storage,
- query cost,
- engineering time,
- privacy/security review.

### Cardinality trap

Contoh label berbahaya:

```text
user_id
email
request_id
case_id
full_url_with_query
raw_error_message
tenant_id with huge cardinality
```

Jika salah desain, metric cost dan query performance bisa hancur.

### Trace sampling trade-off

- sampling terlalu rendah: incident sulit dianalisis,
- sampling terlalu tinggi: cost storage tinggi,
- tail-based sampling lebih berguna tetapi lebih kompleks.

### Observability economic principle

```text
Instrument what supports operational decisions.
Do not collect everything just because it is possible.
```

---

## 4.7 Security Cost

Monolith biasanya punya security boundary yang lebih sedikit.

Microservices menambah:

- service identity,
- mTLS,
- token relay,
- token exchange,
- audience restriction,
- service-to-service authorization,
- secret rotation,
- certificate rotation,
- policy governance,
- audit propagation,
- tenant isolation,
- data minimization per service,
- vulnerability management per artifact.

### Security multiplication

Jika ada 40 services, maka ada banyak kombinasi trust relationship.

Tanpa standard platform:

```text
each team reinvents security differently
```

Itu mahal dan berbahaya.

### Security platform ROI

Security platform/golden path biasanya mahal di awal, tetapi menurunkan cost berulang:

- standard token validation,
- standard service identity,
- standard secret loading,
- standard audit logging,
- standard outbound client,
- standard policy enforcement hook.

---

## 4.8 Data Cost

Microservices mendorong database-per-service dan data ownership.

Konsekuensinya:

- data duplication,
- projection storage,
- event retention,
- CDC infrastructure,
- reconciliation jobs,
- reporting database,
- search index,
- audit store,
- archival pipeline.

### Data duplication is not automatically waste

Data duplication bisa sehat jika:

- ownership jelas,
- freshness SLA jelas,
- projection purpose jelas,
- reconciliation jelas,
- retention jelas,
- privacy boundary jelas.

Data duplication buruk jika:

- tidak tahu source of truth,
- cache dianggap authority,
- projection diedit manual,
- tidak ada replay,
- tidak ada freshness metric,
- tidak ada schema compatibility.

---

## 4.9 Network and Latency Cost

Setiap service boundary menambah:

- serialization,
- deserialization,
- network hop,
- TLS/mTLS overhead,
- load balancer hop,
- service mesh sidecar hop,
- timeout handling,
- retry logic,
- observability propagation,
- error handling complexity.

### Fan-out economics

Jika satu request memanggil 8 services secara serial:

```text
latency ~= sum of all dependency latency + orchestration overhead
```

Jika parallel:

```text
latency ~= max dependency latency + coordination overhead
```

Tetapi availability bisa turun karena request sukses bergantung pada banyak dependency.

### Tail latency cost

Jika setiap dependency punya p99 latency buruk, fan-out memperbesar kemungkinan request end-to-end terkena tail.

---

## 4.10 Platform Cost

Microservices butuh platform agar scale secara organisasi.

Platform meliputi:

- service template,
- build pipeline,
- deployment pipeline,
- config management,
- secret management,
- service discovery,
- observability starter,
- API/event contract tooling,
- local dev environment,
- test environment provisioning,
- security defaults,
- runtime baseline,
- rollback/roll-forward support,
- cost visibility,
- service catalog.

Tanpa platform, microservices menghasilkan boilerplate dan variasi liar.

Dengan platform terlalu rigid, tim kehilangan autonomy.

Kunci:

```text
platform should standardize non-differentiating complexity
without preventing domain-level autonomy
```

---

## 5. Complexity Taxonomy

Cost adalah uang/waktu/effort. Complexity adalah struktur sebab-akibat yang membuat sistem sulit dipahami atau diubah.

---

## 5.1 Essential Complexity

Essential complexity berasal dari domain bisnis.

Contoh regulatory system:

- application lifecycle,
- appeal,
- case investigation,
- compliance action,
- enforcement escalation,
- legal review,
- correspondence,
- audit trail,
- SLA,
- role-based approval,
- cross-agency integration,
- retention policy.

Essential complexity tidak bisa dihapus. Ia hanya bisa dimodelkan dengan baik atau buruk.

---

## 5.2 Accidental Complexity

Accidental complexity berasal dari pilihan implementasi.

Contoh:

- terlalu banyak service,
- shared library yang memaksa lockstep release,
- service mesh retry yang bertabrakan dengan app retry,
- API gateway berisi business orchestration,
- event tanpa owner,
- config tersebar tanpa effective config visibility,
- observability tanpa naming standard,
- database ownership ambigu,
- CI/CD manual,
- no local dev story,
- no contract testing.

Architecture bagus meminimalkan accidental complexity.

---

## 5.3 Inherent Distributed Complexity

Microservices menambah complexity yang tidak ada di monolith:

- partial failure,
- network latency,
- distributed consistency,
- version skew,
- clock skew,
- duplicate message,
- out-of-order event,
- retry storm,
- cascading failure,
- distributed tracing,
- dependency graph explosion.

Ini bukan “bug”. Ini sifat sistem terdistribusi.

---

## 5.4 Organizational Complexity

Microservices sering gagal bukan karena Java atau Kubernetes, tetapi karena organisasi.

Contoh:

- service tidak punya owner,
- platform team overload,
- stream-aligned team terlalu banyak dependency,
- release governance terlalu berat,
- security review menjadi bottleneck,
- QA hanya bisa test end-to-end,
- incident ownership tidak jelas,
- domain ownership dan code ownership tidak sejajar.

Architecture harus align dengan ownership.

---

## 6. The Microservice Premium Curve

Bayangkan dua pendekatan:

1. modular monolith,
2. microservices.

Pada kompleksitas rendah sampai sedang, modular monolith biasanya lebih murah:

```text
lower infrastructure cost
lower operational surface
simpler debugging
simpler deployment
simpler testing
simpler transaction model
```

Microservices mulai unggul ketika:

```text
domain complexity high
team count high
change streams independent
deployment bottleneck expensive
failure isolation needed
scaling profile uneven
data ownership must be separated
regulatory/accountability boundaries clear
```

### Conceptual curve

```text
Productivity
^
|                         microservices
|                       /
|                     /
|                   /
|      monolith    /
|       _________ /
|      /         X
|_____/_________/________________> System/Org Complexity
          microservice premium threshold
```

Sebelum titik X, microservices membayar premium tetapi belum mendapat return.

Setelah titik X, monolith mulai terlalu mahal untuk diubah, dideploy, dan dioperasikan.

---

## 7. Economic Decision: Split, Merge, or Stay Modular Monolith?

Keputusan microservices harus bisa menjawab:

```text
Apakah boundary ini menghasilkan autonomy yang cukup untuk membayar cost distribusi?
```

---

## 7.1 Split When

Split masuk akal jika:

1. **Different change cadence**
   - Modul berubah cepat dan sering mengganggu area lain.

2. **Different owner/team**
   - Ada tim yang bisa benar-benar own service end-to-end.

3. **Different data authority**
   - Data punya source of truth jelas dan lifecycle berbeda.

4. **Different scaling profile**
   - Beban area ini jauh berbeda dari sistem lain.

5. **Different reliability requirement**
   - Area ini harus isolated dari failure area lain.

6. **Different security/compliance boundary**
   - Data atau action butuh isolasi akses/audit khusus.

7. **Different release risk**
   - Perubahan area ini perlu bisa dirilis independen.

8. **Clear contract**
   - API/event boundary stabil dan bisa diuji.

9. **Operational maturity exists**
   - Tim punya CI/CD, observability, on-call, runbook, testing.

---

## 7.2 Do Not Split When

Jangan split jika:

1. Boundary belum jelas.
2. Data masih sangat transactional dengan modul lain.
3. Tim owner belum ada.
4. Semua perubahan tetap harus lockstep.
5. API akan sangat chatty.
6. Tidak ada platform support.
7. Tidak ada contract testing.
8. Tidak ada observability distributed.
9. Service hanya wrapper CRUD table.
10. Split hanya karena “microservices best practice”.

---

## 7.3 Merge When

Service sebaiknya digabung jika:

- selalu deploy bersama,
- selalu berubah bersama,
- ownership sama,
- data sangat cohesive,
- API sangat chatty,
- incident selalu melibatkan keduanya,
- contract tidak stabil,
- service kecil tetapi overhead tinggi,
- tidak ada autonomy nyata.

Microservices yang baik bukan berarti tidak pernah merge.

Top-tier architecture berani melakukan **service consolidation** jika economics-nya buruk.

---

## 8. Architecture Economics Metrics

Agar diskusi tidak subjektif, pakai metric.

---

## 8.1 Service-Level Cost Metrics

Untuk setiap service:

| Metric | Meaning |
|---|---|
| Monthly runtime cost | compute, memory, storage, network |
| Observability cost | logs, traces, metrics |
| Build/deploy cost | CI minutes, artifact storage, deployment frequency |
| Operational events | incidents, alerts, pages |
| Change frequency | commits, PRs, deployments |
| Defect rate | bugs per release/change |
| Dependency count | inbound/outbound dependencies |
| Owner clarity | named team/on-call exists or not |
| Onboarding complexity | time to productive contribution |
| Cognitive load score | subjective but trackable |

---

## 8.2 Flow Metrics

Microservices harus meningkatkan flow.

Gunakan:

- lead time for change,
- deployment frequency,
- change failure rate,
- mean time to recovery,
- cycle time,
- queue time,
- review time,
- release waiting time.

Jika setelah microservices:

```text
service count naik
cloud bill naik
lead time tetap lambat
change failure rate naik
MTTR memburuk
```

maka architecture tidak memberikan economic return.

---

## 8.3 Coupling Metrics

Ukuran coupling:

- number of synchronous outbound calls,
- number of required upstream dependencies,
- number of consumers per API/event,
- number of services touched per business change,
- cross-service transaction/saga count,
- shared database access count,
- shared library lockstep release count,
- cyclic dependency count,
- fan-out width,
- deployment ordering dependencies.

Microservices sehat jika coupling turun secara meaningful.

---

## 8.4 Operational Load Metrics

- alerts per service per week,
- pages per service per month,
- false positive alert rate,
- runbook coverage,
- incident count,
- MTTA,
- MTTR,
- repeated incident count,
- manual intervention count,
- certificate/secret expiry incidents,
- config-related incidents.

---

## 8.5 Cost per Business Capability

Daripada hanya melihat cost per service, lihat:

```text
cost per business capability
cost per transaction
cost per case processed
cost per application submitted
cost per approval completed
cost per user journey
cost per tenant
cost per agency
```

Ini lebih sehat karena menghubungkan engineering cost dengan business value.

---

## 9. Complexity Budget

Salah satu mental model terpenting:

```text
Every architecture has a finite complexity budget.
```

Jika budget habis untuk infrastructure complexity, domain modeling menderita.

Jika budget habis untuk framework variation, reliability menderita.

Jika budget habis untuk release coordination, product speed menderita.

### 9.1 Complexity Budget Categories

| Category | Examples |
|---|---|
| Domain complexity | state machine, policy, lifecycle, legal rules |
| Distributed complexity | async messaging, saga, eventual consistency |
| Platform complexity | Kubernetes, mesh, CI/CD, config, secrets |
| Data complexity | projections, CDC, reconciliation |
| Security complexity | mTLS, token exchange, PDP/PEP |
| Observability complexity | tracing, metrics, logs, SLO |
| Organizational complexity | ownership, governance, team coordination |

### 9.2 Principle

```text
Spend complexity where business differentiation or risk reduction justifies it.
Do not spend complexity on accidental infrastructure ceremony.
```

---

## 10. The Cost of “Small Services”

Small service is not automatically good.

Too-small services create:

- more network calls,
- more repositories,
- more deployment units,
- more data fragmentation,
- more ownership ambiguity,
- more operational overhead,
- more contract management,
- more distributed transactions.

### Nano-service smell

A service is suspiciously too small if:

- it owns no meaningful business capability,
- it owns no data/invariant,
- it only wraps a table,
- it only delegates to another service,
- it cannot be reasoned about independently,
- it always changes with another service,
- it has no independent operational lifecycle.

### Better heuristic

A service should usually own at least one of:

```text
business capability
state lifecycle
policy authority
data authority
workflow responsibility
external integration boundary
operational isolation boundary
```

---

## 11. The Cost of Shared Libraries

Shared libraries look cheap but can become hidden coupling.

### Healthy shared libraries

Good candidates:

- logging/tracing utilities,
- common security adapters,
- HTTP client wrapper,
- error envelope model,
- test utilities,
- platform SDK,
- generated client from contract,
- low-level technical helper.

### Dangerous shared libraries

Bad candidates:

- shared domain entity,
- shared JPA model,
- shared business rule,
- shared workflow state enum,
- shared internal DTO,
- shared repository abstraction,
- shared “common service logic” that changes frequently.

### Hidden cost

Shared library can create:

```text
lockstep upgrades
version conflicts
slow rollout
accidental domain coupling
ownership ambiguity
binary compatibility risk
```

### Rule

```text
Share technical primitives carefully.
Do not share volatile domain model across bounded contexts.
```

---

## 12. Cloud Cost Model for Java Microservices

Java services have specific cost characteristics.

---

## 12.1 Baseline Memory Cost

Each JVM has:

- heap,
- metaspace,
- code cache,
- thread stacks,
- direct buffers,
- GC structures,
- JIT overhead,
- library overhead,
- framework overhead.

A service with low traffic still consumes baseline memory.

If there are many low-traffic Java services, idle memory cost can dominate.

### Java version effect

- Java 8: older container ergonomics, more careful tuning needed.
- Java 11: better modern baseline.
- Java 17: strong LTS baseline, mature GC/runtime.
- Java 21: virtual threads, modern ZGC, strong container runtime story.
- Java 25: latest platform horizon, but adoption depends on ecosystem support and organization upgrade policy.

---

## 12.2 CPU Cost

CPU cost comes from:

- request handling,
- serialization/deserialization,
- TLS/mTLS,
- compression,
- GC,
- JIT compilation,
- sidecar proxy,
- logging/tracing,
- JSON mapping,
- validation,
- encryption,
- retries.

### CPU throttling danger

In Kubernetes, CPU limits can introduce throttling. Java latency-sensitive services can suffer if CPU limit is too tight.

Cost optimization by reducing CPU blindly can increase tail latency and incident risk.

---

## 12.3 Startup Cost

Startup cost matters for:

- autoscaling,
- crash recovery,
- rolling deployment speed,
- scale-to-zero,
- serverless/container cold start.

JVM services may need:

- class loading,
- dependency injection initialization,
- JIT warmup,
- connection pool initialization,
- cache warmup,
- schema validation.

Native image or AOT can reduce startup but adds build complexity and compatibility constraints.

---

## 12.4 Threading Cost

Classic Java request-per-thread model:

- simple mental model,
- but platform threads are expensive at large blocking concurrency.

Reactive model:

- efficient for IO concurrency,
- but higher cognitive complexity.

Virtual threads:

- simpler blocking style,
- high concurrency potential,
- but not magic for CPU, database pool, downstream capacity, or distributed backpressure.

Economic takeaway:

```text
Virtual threads can reduce complexity cost compared to reactive code for many blocking workloads,
but they do not remove capacity planning.
```

---

## 13. Cost of Runtime Diversity

Microservices allow technology diversity.

But diversity has cost.

### Useful diversity

Accept diversity when:

- domain workload truly differs,
- team has expertise,
- operational support exists,
- benefit is measurable,
- integration contract is stable.

Example:

- Java for core transactional services,
- Go for lightweight network proxy,
- Node.js for BFF,
- Python for data science workflow,
- Rust for low-level high-performance component.

### Harmful diversity

Diversity becomes harmful when every service picks arbitrary:

- framework,
- logging library,
- tracing setup,
- error model,
- config pattern,
- deployment pattern,
- authentication method,
- test style.

This increases platform and cognitive cost.

### Standardize the boring things

Standardize:

- telemetry,
- security,
- config,
- deployment,
- error envelope,
- health checks,
- build pipeline,
- dependency scanning,
- logging format,
- API/event governance.

Allow autonomy in:

- domain model,
- storage choice where justified,
- scaling profile,
- internal implementation,
- optimization strategy.

---

## 14. FinOps for Microservices

FinOps is not “cut cost at all costs”.

FinOps is about aligning cloud spend with business value and creating shared accountability between engineering, product, finance, and operations.

### 14.1 Cost Visibility

Every service should expose:

- owner,
- environment,
- business capability,
- team,
- tenant/agency if relevant,
- criticality,
- cost center,
- runtime class,
- SLA/SLO tier.

Use tags/labels consistently.

Example Kubernetes labels:

```yaml
app.kubernetes.io/name: case-service
app.kubernetes.io/part-of: regulatory-platform
app.kubernetes.io/component: domain-service
owner.team: case-management
business.capability: enforcement-case
criticality: tier-1
environment: prod
cost-center: aceas-platform
```

### 14.2 Unit Economics

Track:

```text
cost per application submitted
cost per case opened
cost per approval completed
cost per document generated
cost per notification sent
cost per report generated
cost per tenant/month
```

This prevents bad optimization.

Example:

```text
Reducing cost per pod by 20% is not useful if approval latency increases and officers process fewer cases.
```

### 14.3 Showback and Chargeback

- **Showback**: teams see their cost but are not directly charged.
- **Chargeback**: cost is allocated to team/business unit.

Start with showback first. Chargeback too early can create bad incentives.

### 14.4 Budget Guardrails

Useful guardrails:

- cost anomaly detection,
- environment auto-shutdown for non-prod,
- max replica guardrail,
- log volume guardrail,
- trace sampling policy,
- unused resource cleanup,
- stale environment cleanup,
- storage lifecycle policy,
- oversized DB detection.

---

## 15. Optimization Is Not Always Reduction

Cost optimization does not always mean lowering spend.

Sometimes best optimization is spending more to reduce bigger risk.

Example:

| Decision | Spend | Benefit |
|---|---:|---|
| Add second replica | higher compute | better availability |
| Add tracing | higher observability cost | faster MTTR |
| Use managed DB | higher service bill | lower operational burden |
| Add platform team | higher staffing cost | lower cognitive load for many teams |
| Use contract testing | higher test investment | fewer integration failures |

Wrong question:

```text
How do we reduce cost?
```

Better question:

```text
Which cost does not produce proportional business value or risk reduction?
```

---

## 16. Architecture Economics Decision Matrix

Use this matrix before creating a new service.

| Question | Low Score | High Score |
|---|---|---|
| Business capability clarity | vague utility | clear capability |
| Data ownership | shared/confused | authoritative owner |
| Change independence | changes with others | changes independently |
| Deployment independence | lockstep | independent deploy |
| Team ownership | no owner | named owner/on-call |
| Runtime difference | same as others | distinct scaling/reliability need |
| Contract stability | unstable | stable enough |
| Failure isolation value | low | high |
| Regulatory/security boundary | same | distinct boundary |
| Platform support | manual | automated golden path |
| Observability readiness | poor | production-ready |
| Testing readiness | E2E-only | contract/component ready |

Interpretation:

```text
Mostly low score  -> keep in modular monolith / module.
Mixed score       -> delay split, improve seams first.
Mostly high score -> microservice may be justified.
```

---

## 17. Service Economic Review Template

Before approving a service, write this.

```markdown
# Service Economic Review

## Service Name

## Business Capability

## Why this must be separate

## Alternatives considered
- module inside existing service
- modular monolith
- library
- database schema split only
- BFF endpoint only
- workflow/process manager responsibility

## Expected Benefits
- deployment independence:
- ownership clarity:
- scaling isolation:
- failure isolation:
- security/regulatory isolation:
- change velocity:

## New Costs
- runtime cost:
- database/storage cost:
- observability cost:
- CI/CD cost:
- testing cost:
- security cost:
- operational/on-call cost:
- coordination cost:

## Dependencies
Inbound:
Outbound:
Events consumed:
Events published:
Shared libraries:

## Data Ownership
Source of truth:
Replicas/projections:
Retention:
Reconciliation:

## Failure Mode
Critical dependencies:
Fallback:
Degradation:
Runbook:

## Exit Criteria
What condition would make us merge this service back?
```

Top-tier engineers define not only why a service should exist, but also when it should stop existing.

---

## 18. Modular Monolith as an Economic Option

Modular monolith is not failure.

It can be the optimal economic choice when:

- one team owns most code,
- transaction consistency is important,
- deployment frequency is manageable,
- scaling needs are similar,
- domain boundaries are still evolving,
- operational maturity is low,
- platform is not ready,
- cost constraints are strong.

### Strong modular monolith characteristics

- clear module boundaries,
- no cyclic dependency,
- internal API boundaries,
- package/module enforcement,
- separate domain models,
- explicit application services,
- event-like internal communication if useful,
- separate migration namespaces,
- readiness for future extraction.

### Microservice-ready modular monolith

A good modular monolith can become microservices later because it has:

```text
clean boundaries before physical distribution
```

Bad microservices often happen when teams distribute code before understanding boundaries.

---

## 19. When Consolidation Is Better

Service consolidation is under-discussed.

Merge services when separation no longer creates value.

### Consolidation signals

- service has no independent roadmap,
- owner team is same,
- deployment always together,
- data always queried together,
- latency cost is high,
- incidents always correlated,
- contract changes always coordinated,
- no unique security/scaling boundary,
- service count overwhelms platform/team.

### Consolidation options

- merge runtime but keep modules,
- merge database but preserve schema boundaries,
- merge repositories,
- merge deployment pipeline,
- keep API facade stable,
- retire event channel,
- replace network call with module call.

Consolidation is not regression. It can be architecture maturity.

---

## 20. Cost of Compliance and Auditability

For regulatory systems, cost must include defensibility.

Cheap architecture that cannot explain decisions is expensive during audit.

### Compliance cost drivers

- audit trail completeness,
- actor identity propagation,
- decision reason capture,
- policy versioning,
- approval chain visibility,
- data retention,
- data deletion,
- access review,
- tenant/agency segregation,
- evidence generation,
- incident reportability.

### Economic trade-off

Sometimes microservices improve compliance economics by isolating:

- legal case data,
- identity authority,
- audit service,
- correspondence service,
- document service,
- enforcement lifecycle.

But they can also worsen auditability if:

- traces are incomplete,
- event meaning unclear,
- ownership fragmented,
- no single case timeline,
- correlation IDs missing,
- projection freshness unknown.

---

## 21. Architecture ROI Patterns

---

## 21.1 High ROI Microservice Pattern

High ROI when service:

- owns meaningful business capability,
- has clear data authority,
- changes independently,
- has distinct scaling/reliability profile,
- has named team ownership,
- has stable contracts,
- reduces change coordination,
- isolates failure,
- has production observability,
- has automated release and rollback.

Example:

```text
Document rendering service that handles heavy CPU/rendering workload,
can scale independently,
has clear API,
and failure can degrade document generation without breaking case editing.
```

---

## 21.2 Low ROI Microservice Pattern

Low ROI when service:

- only wraps a table,
- has no independent owner,
- always changes with another service,
- creates chatty calls,
- relies on shared DB,
- has no stable contract,
- adds operational surface without autonomy.

Example:

```text
StatusLookupService that exposes CRUD for a shared lookup table
and is called synchronously by 20 services on every request.
```

---

## 21.3 Negative ROI Microservice Pattern

Negative ROI when service:

- increases lead time,
- increases incidents,
- increases coupling,
- increases release coordination,
- increases testing bottleneck,
- has ambiguous ownership,
- hides distributed transactions,
- creates more failure modes than it isolates.

---

## 22. Anti-Patterns

---

## 22.1 Resume-Driven Microservices

Microservices chosen because they sound modern.

Symptoms:

- no business reason,
- no cost model,
- no owner model,
- no platform readiness,
- no migration plan,
- no economic review.

---

## 22.2 Service Count as Success Metric

Bad metric:

```text
We have 80 microservices.
```

Better metrics:

```text
lead time decreased
MTTR decreased
team autonomy increased
blast radius decreased
change failure rate decreased
cost per business transaction acceptable
```

---

## 22.3 Cost Blind Observability

Collecting all logs/traces/metrics without purpose.

Symptoms:

- high ingestion bill,
- no useful dashboards,
- noisy alerts,
- high-cardinality explosions,
- difficult incident debugging despite huge telemetry.

---

## 22.4 Platformless Microservices

Every team reinvents:

- Dockerfile,
- health check,
- logging,
- tracing,
- token validation,
- deployment manifest,
- config loading,
- error handling,
- client retry logic.

Result:

```text
local autonomy, global chaos
```

---

## 22.5 Over-Platformed Microservices

Platform controls too much:

- every dependency must be approved,
- every pipeline change centralized,
- every service forced into same shape,
- no domain-specific optimization,
- platform team becomes bottleneck.

Result:

```text
global consistency, local paralysis
```

---

## 22.6 Cloud Bill Optimization That Breaks Reliability

Examples:

- remove replicas from tier-1 service,
- lower CPU until p99 latency breaks,
- reduce log retention below incident analysis needs,
- disable tracing for critical flows,
- use tiny DB instance causing lock contention,
- remove staging environment and increase production defects.

Cost optimization must respect reliability and business impact.

---

## 22.7 Distributed Monolith with Higher Bill

Worst case:

- many services,
- shared DB,
- lockstep deploy,
- synchronous chains,
- no team autonomy,
- no failure isolation,
- high infra cost.

This has the cost of microservices and the coupling of monolith.

---

## 23. Java 8–25 Economic Considerations

---

## 23.1 Java 8

Pros:

- huge legacy ecosystem,
- stable enterprise baseline,
- many old app servers/frameworks.

Cons:

- weaker modern container ergonomics,
- no records/sealed/pattern matching/virtual threads,
- older GC/runtime behavior,
- harder modern library compatibility over time.

Economic impact:

```text
Lower migration disruption short-term,
higher modernization cost long-term.
```

---

## 23.2 Java 11

Pros:

- common modernization baseline,
- better container story,
- LTS history,
- ecosystem broad support.

Cons:

- still lacks many productivity/runtime improvements of 17/21.

Economic impact:

```text
Good stepping stone,
but not ideal final strategic baseline in 2026+.
```

---

## 23.3 Java 17

Pros:

- strong modern LTS,
- records,
- sealed classes,
- improved GC/runtime,
- broad framework support.

Economic impact:

```text
Good baseline for enterprise microservices with mature ecosystem.
```

---

## 23.4 Java 21

Pros:

- virtual threads,
- modern GC/runtime,
- strong LTS,
- better fit for high-concurrency blocking services.

Economic impact:

```text
Can reduce complexity cost compared to reactive implementation for many IO-heavy services.
```

Caution:

```text
Virtual threads reduce thread cost,
not downstream capacity cost.
```

---

## 23.5 Java 25

Pros:

- latest Java SE generation,
- modern language/runtime evolution,
- useful for forward-looking platform standardization.

Economic caution:

- ecosystem support must be verified,
- organization upgrade process matters,
- production support policy matters,
- framework compatibility matters,
- container/base-image strategy matters.

Economic impact:

```text
Adopt when platform/toolchain/support maturity justifies it.
Do not adopt only for novelty.
```

---

## 24. Example: Regulatory Case Management Economics

Suppose system has modules:

- Application,
- Case,
- Compliance,
- Correspondence,
- Document,
- Payment,
- User/Profile,
- Audit,
- Reporting,
- Notification,
- Search,
- Appeal,
- Legal Review.

### Bad decomposition

```text
ApplicationStatusService
ApplicationCommentService
ApplicationAttachmentService
ApplicationAssignmentService
ApplicationApprovalService
ApplicationValidationService
```

Why suspicious:

- all belong to same lifecycle,
- likely change together,
- transaction/invariant highly related,
- network calls become chatty,
- ownership same,
- API fragmentation high.

### Better decomposition candidate

```text
Application Management Service
Case Management Service
Document Service
Correspondence Service
Audit/Event Timeline Service
Search/Worklist Projection Service
Payment Service
Identity/Profile Service
Notification Service
```

Why better:

- each owns meaningful capability,
- data ownership clearer,
- scaling profile may differ,
- failure isolation meaningful,
- compliance/audit responsibility clearer,
- team ownership more realistic.

### Economic review example

Document Service may justify separation because:

- document generation is CPU/memory heavy,
- failure should not block all application editing,
- document templates have distinct lifecycle,
- storage/retention/access rules differ,
- team can optimize rendering independently.

Application Comment Service may not justify separation because:

- comments are part of case/application collaboration,
- low independent value,
- likely needs same authorization and audit context,
- creates chatty calls,
- no distinct scaling profile.

---

## 25. Practical Cost Review Checklist

Before approving new microservice:

```text
[ ] Does it own a real business capability?
[ ] Does it own data or invariant authority?
[ ] Does it have a named owning team?
[ ] Can it be deployed independently without lockstep?
[ ] Does it have stable API/event contracts?
[ ] Does it reduce change amplification?
[ ] Does it isolate meaningful failure?
[ ] Does it have distinct scaling/reliability/security needs?
[ ] Is there a clear testing strategy?
[ ] Is there a clear observability strategy?
[ ] Is there a clear runbook and on-call owner?
[ ] Are infra/runtime costs estimated?
[ ] Are log/metric/trace costs estimated?
[ ] Are data duplication and reconciliation costs understood?
[ ] Are security and audit costs understood?
[ ] Is there a cheaper modular-monolith alternative?
[ ] Is there an exit/merge criterion?
```

---

## 26. Practical Complexity Review Checklist

```text
[ ] How many services are touched by one normal business change?
[ ] How many synchronous calls are in the critical path?
[ ] How many consumers depend on this contract?
[ ] How many teams must coordinate release?
[ ] How many dashboards/runbooks/alerts are needed?
[ ] Can a new engineer understand this service in one week?
[ ] Can an incident be triaged without calling five teams?
[ ] Is ownership obvious from service catalog?
[ ] Are failure modes documented?
[ ] Are data authority and freshness documented?
[ ] Are contracts versioned and tested?
[ ] Are operational controls standardized by platform?
```

---

## 27. Architecture Economics ADR Template

```markdown
# ADR: Split <Capability> into <Service Name>

## Status
Proposed / Accepted / Rejected / Superseded

## Context
What business, technical, organizational, and operational problem exists?

## Decision
We will split / not split / merge / keep modular.

## Economic Benefits Expected
- deployment independence:
- team ownership:
- scaling isolation:
- reliability isolation:
- compliance/security boundary:
- change velocity:

## Costs Accepted
- infrastructure:
- platform:
- observability:
- testing:
- security:
- data duplication:
- operational/on-call:
- coordination:

## Alternatives Considered
- modular monolith module
- shared library
- existing service expansion
- BFF-only change
- projection-only change
- workflow/process-manager-only change

## Success Metrics
- lead time:
- deployment frequency:
- change failure rate:
- MTTR:
- cost per transaction:
- services touched per change:
- incident count:

## Review Date
When will we verify whether this decision paid off?

## Exit Criteria
When should we merge, retire, or redesign this service?
```

---

## 28. Exercises

### Exercise 1 — Service Cost Inventory

Pick 5 existing services and estimate:

- runtime cost,
- database cost,
- observability cost,
- deployment frequency,
- incident count,
- owner clarity,
- dependency count,
- services touched per change.

Then classify:

```text
high ROI
neutral ROI
negative ROI
```

---

### Exercise 2 — Split Decision

Given a `ComplianceManagement` module with:

- case lifecycle,
- inspection scheduling,
- enforcement action,
- document evidence,
- officer assignment,
- audit trail,
- notification,
- reporting,

choose what should be:

- same service,
- separate service,
- projection/read model,
- workflow/process manager,
- shared platform concern.

Justify economically.

---

### Exercise 3 — Complexity Budget

For one system, allocate 100 complexity points across:

- domain,
- distributed systems,
- platform,
- data,
- security,
- observability,
- organization.

Then ask:

```text
Are we spending complexity where it creates business value?
```

---

### Exercise 4 — Consolidation Candidate

Find one service that might be merged.

Evaluate:

- Does it change independently?
- Does it deploy independently?
- Does it own meaningful data?
- Does it have unique scaling needs?
- Does it create more latency/cost than value?

---

## 29. Top 1% Engineer Review Questions

Ask these in architecture review:

1. What economic value does this service create?
2. What cost does it add?
3. What complexity does it remove locally?
4. What complexity does it add globally?
5. What business capability does it own?
6. What invariant does it protect?
7. What data is it authoritative for?
8. Can it deploy independently in practice?
9. Which team owns it end-to-end?
10. What happens if it is down?
11. What happens if it is slow?
12. What happens if its contract changes?
13. How will we test it without full E2E dependency?
14. How will we observe it during incident?
15. What is the cost per business transaction?
16. Is there a simpler modular alternative?
17. What would make us merge it back?
18. Does this reduce or increase change amplification?
19. Does this improve or worsen regulatory defensibility?
20. Are we buying autonomy or just distributing complexity?

---

## 30. Summary

Microservices are not primarily about small services.

They are about buying:

- autonomy,
- isolation,
- ownership,
- evolvability,
- targeted scalability,
- clearer domain responsibility.

But the price is real:

- infrastructure,
- platform,
- operations,
- testing,
- observability,
- security,
- coordination,
- cognitive load,
- data duplication,
- distributed failure modes.

The key question is not:

```text
Should we use microservices?
```

The better question is:

```text
Where does the value of autonomy exceed the premium of distribution?
```

A top-tier engineer can:

- defend a split,
- reject a split,
- delay a split,
- merge services,
- use modular monolith strategically,
- quantify cost,
- reason about complexity,
- connect architecture decisions to business value and reliability risk.

That is the essence of architecture economics.

---

## 31. References

- Martin Fowler — Microservice Premium.
- Martin Fowler — Microservice Trade-Offs.
- AWS Well-Architected Framework — Cost Optimization Pillar.
- AWS Cloud Financial Management Framework.
- FinOps Foundation — FinOps Principles.
- Microsoft Cloud Computing — What is FinOps?
- Team Topologies — Key Concepts, cognitive load, platform teams.
- Google SRE Book — reliability, operational cost, overload, incident economics.
- Microservices.io — Database-per-Service, Saga, Transactional Outbox, API Composition.
- OpenJDK — Java 21 virtual threads and Java 25 platform status.

---

## 32. Status Seri

Seri belum selesai.

Progress saat ini:

```text
Part 32 of 35 completed.
```

Part berikutnya:

```text
Part 33 — Microservices Anti-Patterns and Failure Taxonomy
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-33-antipatterns-failure-taxonomy.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-31-incident-failure-analysis-reliability-operations.md">⬅️ Learn Java Microservices Patterns — Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-33-antipatterns-failure-taxonomy.md">0. Posisi Part Ini Dalam Seri ➡️</a>
</div>
