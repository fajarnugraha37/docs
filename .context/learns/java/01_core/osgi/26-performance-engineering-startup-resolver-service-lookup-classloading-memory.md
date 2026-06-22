# Part 26 — Performance Engineering: Startup, Resolver Cost, Service Lookup, Classloading, Memory

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `26-performance-engineering-startup-resolver-service-lookup-classloading-memory.md`  
Target Java: 8 sampai 25  
Level: Advanced / Platform Engineering

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas observability dan troubleshooting. Sekarang kita masuk ke pertanyaan yang lebih sulit:

> Bagaimana membuat runtime OSGi tetap cepat, stabil, hemat memory, mudah di-update, dan predictable ketika jumlah bundle, service, component, configuration, dan plugin bertambah?

OSGi sering dianggap “lambat” bukan karena framework-nya selalu lambat, tetapi karena sistem OSGi yang buruk biasanya memiliki:

1. Bundle terlalu banyak tanpa boundary yang jelas.
2. Import/export package terlalu longgar.
3. Resolver graph terlalu rumit.
4. Declarative Services component terlalu berat saat activation.
5. Annotation scanning dilakukan saat runtime.
6. Dependency non-OSGi dibungkus sembarangan.
7. Classloader leak setelah update/refresh.
8. Banyak service dynamics tanpa snapshot atau lifecycle discipline.
9. Hot deploy dianggap gratis.
10. Runtime mutable tanpa deployment discipline.

Part ini membangun mental model performance OSGi dari beberapa sudut:

- startup cost
- resolver cost
- bundle granularity
- DS activation cost
- service lookup cost
- classloading cost
- memory overhead
- refresh/update cost
- runtime churn
- Java 8 sampai Java 25 impact
- production measurement dan tuning

Prinsip utamanya:

> Performance OSGi bukan hanya soal membuat kode cepat. Performance OSGi adalah soal membuat runtime graph kecil, eksplisit, stabil, dan tidak melakukan pekerjaan mahal di waktu yang salah.

---

## 2. Performance Model OSGi: Apa yang Sebenarnya Mahal?

Sistem OSGi punya beberapa fase biaya.

```text
Process start
  -> JVM initialization
  -> OSGi framework initialization
  -> framework storage/cache load
  -> install bundle metadata
  -> resolve bundle graph
  -> start bundles according to start level
  -> extenders scan/process metadata
  -> Declarative Services activate satisfied components
  -> Configuration Admin applies configuration
  -> HTTP endpoints/register services/events
  -> application readiness
```

Setiap fase punya cost driver berbeda.

| Fase | Cost utama | Contoh masalah |
|---|---|---|
| JVM init | JVM, class metadata, GC, CDS | cold start lambat |
| framework init | storage, config, system packages | cache corrupt/huge |
| install metadata | manifest parsing, bundle cache | bundle terlalu banyak |
| resolve | constraint solving | version graph rumit |
| start | activator/component startup | blocking IO di activation |
| extender processing | DS/Blueprint/Web/JPA scanning | runtime annotation scanning |
| service dynamics | registration/rebind | service churn tinggi |
| classloading | per-bundle classloader | duplicate libs, split packages |
| memory | class metadata, classloader, service objects | leak setelah refresh |
| update/refresh | stop/start, rewire, reload classes | blast radius besar |

Top-tier engineer tidak men-tune semua hal secara acak. Ia bertanya:

1. Cost terjadi di fase mana?
2. Cost terjadi sekali, per bundle, per component, per request, atau per update?
3. Cost linear, super-linear, atau dipicu oleh graph complexity?
4. Cost bisa dipindah dari runtime ke build-time?
5. Cost bisa dikurangi dengan boundary yang lebih baik?
6. Cost bisa diobservasi secara stabil?

---

## 3. Startup Performance: Jangan Samakan `ACTIVE` dengan Ready

Bundle `ACTIVE` berarti bundle sudah start menurut framework lifecycle. Itu tidak berarti aplikasi siap menerima traffic.

Contoh:

```text
Bundle A ACTIVE
Bundle B ACTIVE
HTTP Whiteboard ACTIVE
JPA Bundle ACTIVE
Rule Plugin ACTIVE

Namun:
- database pool belum warm
- DS component async init belum selesai
- config belum valid
- cache belum loaded
- external connector belum healthy
- endpoint sudah register terlalu awal
```

Akibatnya readiness probe bisa hijau terlalu cepat.

### 3.1 Startup Path yang Sehat

Startup OSGi yang sehat biasanya punya tahapan eksplisit:

```text
1. Framework boot
2. Infrastructure bundles start
3. Config Admin ready
4. DS runtime ready
5. Core service bundles active
6. Required services satisfied
7. External dependency health checked
8. HTTP endpoints exposed
9. Readiness service reports UP
```

Jangan membuat endpoint production tersedia hanya karena servlet sudah registered.

### 3.2 Startup Budget

Untuk runtime serius, buat startup budget:

| Area | Budget contoh | Catatan |
|---|---:|---|
| Framework init | 1–3s | tergantung cache/storage |
| Bundle resolve | 1–5s | tergantung graph |
| DS metadata processing | 1–5s | bisa lebih jika banyak component |
| Persistence init | 2–10s | pool + migrations |
| HTTP init | 1–3s | servlet/filter/context |
| Plugin activation | 1–10s | tergantung plugin |
| Readiness stabilization | 5–30s | external dependency |

Angka ini bukan standar universal, tetapi alat berpikir. Yang penting adalah **diukur**, bukan ditebak.

---

## 4. Resolver Cost: Constraint Solving Tidak Gratis

Resolver harus memilih bundle/package/capability yang memenuhi requirements.

Cost resolver meningkat saat:

1. Banyak bundle candidate.
2. Banyak versi bundle/package tersedia.
3. Banyak optional import.
4. Banyak `Require-Bundle`.
5. Banyak split package.
6. Banyak `uses:=` constraint transitif.
7. Banyak capability/requirement generic.
8. Version range terlalu longgar.
9. Repository terlalu besar dan tidak dipangkas.
10. Banyak bundle dengan metadata buruk.

Resolver bukan sekadar “load dependency”. Resolver adalah constraint solver.

### 4.1 Resolver Graph yang Mahal

Contoh dependency buruk:

```text
case-api imports:
  com.fasterxml.jackson.databind;version="[2.0,3)"
  com.fasterxml.jackson.core;version="[2.0,3)"
  com.fasterxml.jackson.annotation;version="[2.0,3)"

plugin-a embeds jackson 2.13
plugin-b embeds jackson 2.17
web-runtime exports jackson 2.15
legacy-connector imports jackson [2.9,2.14)
```

Masalah:

- candidate banyak
- range konflik
- embedded dependency menciptakan class identity risk
- `uses:=` bisa memaksa konsistensi package graph
- runtime mungkin resolve berbeda antara environment

### 4.2 Resolver Optimization Strategy

Gunakan strategi ini:

1. Kurangi jumlah candidate di runtime repository.
2. Pin runtime distribution, jangan resolve dari repository besar saat startup production.
3. Gunakan bnd resolver saat build/release, bukan saat production boot jika bisa.
4. Gunakan version range yang tepat.
5. Hindari optional imports yang terlalu banyak.
6. Hindari `Require-Bundle` kecuali benar-benar justified.
7. Hindari split package.
8. Pastikan API package export punya `uses:=` yang benar.
9. Jangan bundle banyak versi library yang sama tanpa alasan compatibility.
10. Buat resolver regression test di CI.

### 4.3 Build-Time Resolution vs Runtime Resolution

Production runtime sebaiknya tidak menjadi tempat eksperimen resolver.

Lebih defensible:

```text
CI/build:
  - build bundles
  - run baseline check
  - run resolver
  - produce locked runtime distribution
  - smoke test runtime

Production:
  - start known distribution
  - no arbitrary repository resolution
  - no uncontrolled hot deploy
```

OSGi memang dynamic, tetapi production tidak harus chaotic.

---

## 5. Bundle Granularity: Terlalu Besar Buruk, Terlalu Kecil Juga Buruk

Bundle granularity memengaruhi:

- resolver graph size
- classloader count
- service count
- activation count
- memory overhead
- update blast radius
- team ownership
- API versioning
- deployment complexity

### 5.1 Bundle Terlalu Besar

Gejala:

```text
case-management-all.jar
  exports 120 packages
  imports 400 packages
  contains API, impl, persistence, web, jobs, external connector
```

Masalah:

- update kecil memaksa update besar
- API dan implementation bercampur
- resolver graph sulit dibaca
- service boundary tidak jelas
- plugin tidak bisa bergantung pada API kecil

### 5.2 Bundle Terlalu Kecil

Gejala:

```text
case-api.jar
case-dto.jar
case-exception.jar
case-util.jar
case-validation-api.jar
case-validation-util.jar
case-status-api.jar
case-status-util.jar
```

Masalah:

- terlalu banyak bundle metadata
- banyak classloader
- startup overhead naik
- service dependency granular berlebihan
- developer kehilangan konteks
- deployment list panjang

### 5.3 Heuristik Granularity

Buat bundle ketika ada alasan kuat:

| Alasan | Layak jadi bundle? |
|---|---|
| API contract yang dipakai banyak bundle | Ya |
| Implementation bisa diganti/plugin | Ya |
| Lifecycle berbeda | Ya |
| Deployment/update cadence berbeda | Ya |
| Ownership team berbeda | Mungkin |
| Hanya package util kecil | Biasanya tidak |
| Hanya untuk “rapi” secara folder | Tidak cukup |
| Butuh classloader isolation | Ya |
| Butuh optional feature | Ya |

Heuristik praktis:

```text
Bundle boundary harus punya minimal satu dari:
- API boundary
- lifecycle boundary
- ownership boundary
- deployment boundary
- isolation boundary
- optional capability boundary
```

Kalau tidak punya, kemungkinan hanya “modular theater”.

---

## 6. Declarative Services Activation Cost

Declarative Services sangat membantu, tetapi component activation bisa menjadi sumber startup lambat.

Cost DS berasal dari:

1. Metadata discovery.
2. Component description parsing.
3. Reference satisfaction.
4. Constructor/field/method injection.
5. Activation method.
6. Configuration binding.
7. Service registration.
8. Rebind saat service/config berubah.

### 6.1 Activation Anti-Pattern

Buruk:

```java
@Activate
void activate() {
    loadAllRulesFromDatabase();
    callExternalAgencyApi();
    warmAllCaches();
    startBackgroundThread();
    runSchemaMigration();
}
```

Masalah:

- startup blocking
- failure activation membuat component unavailable
- external dependency memperlambat readiness
- sulit observability
- sulit shutdown bersih

Lebih baik:

```java
@Activate
void activate(Config config) {
    this.config = ConfigSnapshot.from(config);
    this.lifecycle = new AtomicReference<>(State.STARTING);
    this.worker = executor.submit(this::warmUpSafely);
}
```

Namun hati-hati: async warmup berarti service mungkin registered sebelum ready. Maka expose readiness state.

```java
public boolean isReady() {
    return lifecycle.get() == State.READY;
}
```

### 6.2 Activation Harus Ringan

Activation ideal:

- validasi config
- buat immutable snapshot
- prepare local structures
- register minimal lifecycle
- jangan melakukan IO berat kecuali memang required untuk correctness
- jangan block lama tanpa timeout
- jangan start unmanaged thread

### 6.3 Static vs Dynamic Reference Performance

Static reference:

- lebih sederhana
- component deactivate/reactivate saat dependency berubah
- cocok untuk mandatory stable dependency

Dynamic reference:

- menghindari reactivation
- perlu concurrency safety
- cocok untuk plugin list / strategy registry

Dynamic reference buruk kalau setiap perubahan service menyebabkan lock contention atau snapshot rebuild mahal.

Pattern sehat:

```java
private final AtomicReference<List<Rule>> rules =
    new AtomicReference<>(List.of());

@Reference(cardinality = MULTIPLE, policy = DYNAMIC)
void bindRule(Rule rule, Map<String, Object> props) {
    rules.updateAndGet(old -> sortedCopyWith(old, rule, props));
}

void unbindRule(Rule rule) {
    rules.updateAndGet(old -> copyWithout(old, rule));
}
```

Read path bebas lock berat:

```java
public Result validate(Input input) {
    for (Rule rule : rules.get()) {
        // stable snapshot
    }
}
```

---

## 7. Service Lookup Performance

Service registry lookup biasanya bukan bottleneck utama jika digunakan dengan benar. Bottleneck muncul saat:

1. Lookup dilakukan per request secara berlebihan.
2. LDAP filter kompleks dievaluasi terus-menerus.
3. ServiceTracker tidak ditutup.
4. Dynamic registry churn tinggi.
5. Service ranking menyebabkan rebinding sering.
6. Banyak service property besar.
7. Service dipakai sebagai global event bus tanpa discipline.

### 7.1 Jangan Lookup Per Request Jika Bisa Bind

Buruk:

```java
public Response handle(Request request) {
    ServiceReference<RuleEngine> ref = context.getServiceReference(RuleEngine.class);
    RuleEngine engine = context.getService(ref);
    try {
        return engine.execute(request);
    } finally {
        context.ungetService(ref);
    }
}
```

Lebih baik gunakan DS reference:

```java
@Component(service = CaseEndpoint.class)
public class CaseEndpoint {
    private final RuleEngine engine;

    @Activate
    public CaseEndpoint(@Reference RuleEngine engine) {
        this.engine = engine;
    }
}
```

Atau snapshot untuk multiple dynamic services.

### 7.2 Service Property Ringan

Service properties dipakai untuk selection, ranking, routing, dan diagnostics.

Jangan masukkan object besar sebagai property.

Buruk:

```java
props.put("full.schema", hugeJsonSchemaString);
props.put("runtime.object", complexObject);
```

Lebih baik:

```java
props.put("rule.type", "ELIGIBILITY");
props.put("agency", "CEA");
props.put("version", "2.1.0");
props.put("priority", 100);
```

Metadata untuk filtering harus kecil, stable, serializable secara sederhana, dan mudah diobservasi.

---

## 8. Classloading Performance

OSGi classloading cost berasal dari:

- banyak classloader
- banyak imports
- embedded dependency
- TCCL bridging
- reflection
- annotation scanning
- bytecode generation
- proxies
- duplicate packages
- split package

### 8.1 Classloading Cost Bukan Hanya CPU

Classloading menambah:

- Metaspace/class metadata
- verification cost
- linkage cost
- JIT warmup cost
- classloader reachability risk
- memory retention setelah refresh

### 8.2 Annotation Scanning Problem

Banyak Java framework mengasumsikan classpath tunggal dan melakukan scanning:

```text
scan all classes
find annotations
build metadata
register components
```

Dalam OSGi ini mahal dan sering salah karena:

- tidak semua classes visible
- bundle boundary harus dihormati
- scanning banyak bundle mahal
- dynamic install/update memerlukan re-scan
- TCCL sering tidak sesuai

Lebih baik:

- generate metadata at build-time
- gunakan DS XML
- gunakan `Service-Component`
- gunakan extender dengan explicit manifest header
- scan hanya bundle yang opt-in

### 8.3 Embedded Dependencies

Embedding dependency bisa membantu isolation, tetapi terlalu banyak embedded library menyebabkan:

- duplicate classes
- duplicate metadata
- lebih banyak memory
- class identity conflict
- CVE patch sulit
- refresh lebih mahal

Policy sehat:

| Library type | Preferensi |
|---|---|
| API shared stable | export dari dedicated API bundle |
| Implementation internal kecil | private package/embedded boleh |
| Large common library | shared bundle jika version compatible |
| Plugin-specific incompatible lib | embed/shade dengan hati-hati |
| Logging API | shared API bundle |
| JDBC driver | driver service bundle |

---

## 9. Memory Engineering

OSGi memory overhead tidak hanya heap object biasa.

Yang harus dipantau:

1. Heap.
2. Metaspace.
3. Thread count.
4. Direct buffer.
5. Framework cache disk.
6. Classloader count.
7. Service registration count.
8. DS component instance count.
9. Timer/scheduler/worker objects.
10. Native libraries.

### 9.1 Classloader Leak Setelah Bundle Update

Classloader lama bisa tetap hidup jika masih direferensikan oleh:

- static field
- ThreadLocal
- running thread
- executor
- scheduled task
- cache global
- logger context
- MBean
- JDBC driver manager
- TCCL on thread
- service object yang tidak di-unget
- listener yang tidak di-unregister

Contoh buruk:

```java
static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
```

Jika object di cache berasal dari classloader bundle lama, bundle lama tidak bisa GC.

### 9.2 Deactivation Must Release Everything

Checklist deactivation:

```text
- unregister services created manually
- close ServiceTracker
- cancel timers
- shutdown executors
- clear ThreadLocal
- close DB pools
- remove listeners
- unregister MBeans
- stop HTTP clients
- clear caches
- release native resources
- reset TCCL if changed
```

### 9.3 Metaspace Growth

Jika setiap update bundle membuat metaspace naik dan tidak turun, curigai classloader leak.

Observasi:

```text
Before update:
  classloader count: 220
  loaded classes: 35k
  metaspace: 180MB

After 10 update cycles:
  classloader count: 420
  loaded classes: 58k
  metaspace: 320MB
```

Ini bukan normal kalau bundle lama seharusnya sudah collectible.

---

## 10. Refresh and Update Cost

Dalam OSGi, update bundle sering memerlukan refresh package wiring.

Refresh bisa menyebabkan:

- bundle stop
- dependent bundle stop
- classloader discard
- re-resolve
- bundle restart
- DS deactivate/activate
- services disappear/reappear
- HTTP endpoints temporarily unavailable
- caches reset
- in-flight request failure

### 10.1 Refresh Blast Radius

Update `case-impl` mungkin kecil. Update `case-api` bisa besar.

```text
case-api updated
  -> case-impl rewired
  -> case-web rewired
  -> plugin-a rewired
  -> plugin-b rewired
  -> report-bundle rewired
  -> validation-bundle rewired
```

API bundle harus sangat stabil karena blast radius besar.

### 10.2 Design for Refresh

Agar refresh aman:

1. Minimize API changes.
2. Separate API and implementation bundles.
3. Make service unregister graceful.
4. Drain in-flight work before deactivate.
5. Use timeout on shutdown.
6. Make activation idempotent.
7. Make config migration safe.
8. Test update/refresh cycle.
9. Avoid global singleton outside bundle lifecycle.
10. Prefer immutable runtime distribution for major changes.

### 10.3 Hot Deploy Is Not Always Performance Friendly

Hot deploy bagus untuk development dan controlled plugin updates.

Tapi production hot deploy bisa berbahaya jika:

- state migration tidak jelas
- in-flight request tidak didrain
- dependency refresh luas
- classloader leak belum diuji
- rollback tidak deterministic
- bundle versioning tidak disiplin

Top-tier position:

> OSGi supports runtime dynamism. Production architecture decides how much dynamism is safe.

---

## 11. Runtime Churn: Dynamic Does Not Mean Constantly Changing

Service dynamics membuat runtime adaptable, tetapi churn tinggi bisa mahal.

Contoh churn:

- service register/unregister per request
- component restart karena config sering berubah
- plugin scanner reinstall bundle setiap file timestamp berubah
- health status service mengganti registration berkali-kali
- ranking berubah terus

Lebih baik:

- service registration untuk lifecycle besar, bukan per operation
- mutable health state di dalam service, bukan unregister/register terus
- config update debounce
- plugin update controlled
- avoid service property mutation as high-frequency signal

### 11.1 Service Churn Anti-Pattern

Buruk:

```java
for (Task task : tasks) {
    ServiceRegistration<?> reg = context.registerService(Task.class, task, props);
    execute(task);
    reg.unregister();
}
```

Service registry bukan queue.

Gunakan queue/worker/executor/broker untuk task churn.

---

## 12. Performance Measurement: Apa yang Harus Diukur?

Jangan mulai dari tuning. Mulai dari measurement.

### 12.1 Startup Metrics

Ukur:

```text
- process start timestamp
- framework initialized timestamp
- bundles installed count
- bundles resolved count
- bundles active count
- DS components enabled/satisfied/active count
- config applied count
- HTTP endpoints registered count
- readiness UP timestamp
```

### 12.2 Runtime Metrics

Ukur:

```text
- bundle count by state
- service registration count
- service churn rate
- DS component state count
- unsatisfied references
- config update count
- classloader count
- loaded class count
- metaspace usage
- heap usage
- thread count
- executor queue size
- endpoint latency
- event queue depth
```

### 12.3 Update Metrics

Ukur:

```text
- bundle update duration
- refresh duration
- affected bundle count
- service downtime window
- endpoint unavailable duration
- component reactivation count
- memory before/after update
- classloader before/after GC
```

### 12.4 Diagnostic Events

Log structured event:

```json
{
  "event": "bundle.refresh.completed",
  "bundle": "com.acme.case.api",
  "oldVersion": "1.4.2",
  "newVersion": "1.5.0",
  "affectedBundles": 12,
  "durationMs": 1843,
  "servicesRebound": 31
}
```

Tanpa event seperti ini, performance issue akan menjadi folklore.

---

## 13. Profiling OSGi Runtime

Gunakan profiler dengan awareness classloader/lifecycle.

### 13.1 Startup Profiling

Pertanyaan:

- bundle mana paling lama start?
- DS component mana paling lama activate?
- extender mana paling mahal?
- resolver butuh berapa lama?
- classloading paling banyak dari bundle mana?
- annotation scanning terjadi di mana?

### 13.2 CPU Profiling

Cari:

- manifest parsing berulang
- resolver repeated calculation
- reflection scanning
- LDAP filter evaluation berlebihan
- service lookup per request
- lock contention di dynamic reference list
- logger initialization
- XML parser startup
- JPA metamodel build

### 13.3 Memory Profiling

Cari dominator:

- `BundleClassLoader`
- `URLClassLoader`
- DS component manager
- service registration
- `ThreadLocalMap`
- executor thread
- logger context
- JPA metamodel
- cached reflection metadata
- bytecode proxy classes

### 13.4 Thread Profiling

Cari:

- unmanaged threads from bundles
- scheduled executors not stopped
- blocked activation threads
- deadlocks during start/stop
- event delivery backlog
- HTTP worker starvation

---

## 14. Java 8 sampai 25: Performance Considerations

### 14.1 Java 8

Karakteristik:

- PermGen sudah diganti Metaspace sejak Java 8.
- Banyak legacy OSGi stack masih Java 8-compatible.
- Security Manager masih tersedia.
- Java EE modules masih ada di JDK.
- Illegal reflective access belum menjadi masalah JPMS.

Risiko:

- library lama
- TLS/security provider lama
- GC ergonomics lebih terbatas dibanding versi modern
- baseline compatibility sering menahan upgrade

### 14.2 Java 11

Perubahan besar:

- Java EE/CORBA modules removed.
- JPMS sudah ada.
- illegal reflective access warning mulai relevan.
- runtime library harus explicit dependency.

Impact OSGi:

- JAXB/JAX-WS/Activation harus jadi bundle/dependency eksplisit.
- old libraries yang memakai internal JDK API bisa bermasalah.

### 14.3 Java 17

Java 17 banyak dipakai sebagai baseline modern enterprise.

Impact:

- strong encapsulation makin nyata.
- `--add-opens` sering diperlukan untuk legacy reflection.
- GC dan runtime lebih matang.
- banyak library sudah support.

### 14.4 Java 21

Java 21 membawa virtual threads sebagai fitur final.

Virtual threads dapat membantu IO-bound workload, tetapi bukan obat untuk OSGi lifecycle buruk.

Gunakan virtual threads untuk:

- request handling IO-bound
- connector calls
- background jobs yang blocking tapi bounded

Jangan gunakan untuk:

- menutupi activation blocking
- service registry churn
- unbounded task creation
- CPU-bound work
- lifecycle tanpa cancellation

### 14.5 Java 24/25

Security Manager sudah bukan dasar sandbox. Java 25 adalah versi modern terbaru dalam scope materi ini.

Impact:

- plugin sandbox harus berbasis process/container/trust governance, bukan Security Manager.
- reflective access perlu disiplin.
- library bytecode tooling harus up-to-date.
- classfile version compatibility harus diuji.
- old OSGi dependencies bisa gagal jika memakai internal API.

### 14.6 Toolchain Matrix

Contoh matrix:

| Runtime target | Build JDK | `--release` | Notes |
|---|---:|---:|---|
| Java 8 | 17/21 possible | 8 | hati-hati API accidental |
| Java 11 | 17/21 | 11 | explicit Java EE deps |
| Java 17 | 17/21/25 | 17 | strong encapsulation |
| Java 21 | 21/25 | 21 | virtual threads possible |
| Java 25 | 25 | 25 | latest classfile/runtime |

Untuk library/bundle multi-target, jangan hanya “compile success”. Jalankan runtime test di target JDK.

---

## 15. Practical Tuning Playbook

### 15.1 Reduce Startup Cost

Langkah:

1. Ukur startup timeline.
2. Identifikasi bundle/component paling lambat.
3. Pindahkan scanning ke build-time.
4. Kurangi activation IO.
5. Gunakan lazy readiness untuk non-critical warmup.
6. Split critical vs non-critical start level.
7. Kurangi repository resolution saat startup.
8. Lock runtime distribution.
9. Kurangi duplicate library.
10. Gunakan JVM options yang sesuai workload.

### 15.2 Reduce Resolver Cost

Langkah:

1. Hapus bundle candidate yang tidak dipakai.
2. Tighten version range dengan policy jelas.
3. Remove optional imports yang tidak perlu.
4. Hindari split package.
5. Hindari `Require-Bundle` jika package import cukup.
6. Perbaiki `uses:=` consistency.
7. Jalankan resolver test di CI.
8. Freeze resolved distribution.

### 15.3 Reduce Memory

Langkah:

1. Pantau heap + metaspace.
2. Cek classloader count setelah update.
3. Tutup ServiceTracker/listener/executor.
4. Hindari duplicate embedded libs.
5. Hindari static caches cross-bundle.
6. Pastikan deactivation release resources.
7. Gunakan heap dump setelah refresh cycle.

### 15.4 Reduce Runtime Churn

Langkah:

1. Jangan register service per request/task.
2. Debounce config updates.
3. Gunakan internal mutable state untuk health, bukan unregister/register.
4. Stabilkan service ranking.
5. Batch plugin deployment.
6. Monitor service event rate.

---

## 16. Case Study: Enforcement Rule Platform Performance Review

Misal runtime OSGi untuk enforcement case management:

```text
Bundles:
- enforcement-api
- enforcement-domain
- enforcement-persistence
- enforcement-web
- rule-api
- rule-engine
- rule-plugin-fit-and-proper
- rule-plugin-license-renewal
- rule-plugin-disciplinary-history
- notification-api
- notification-email
- audit-api
- audit-impl
```

### 16.1 Masalah Awal

Gejala:

```text
Startup: 95 seconds
Readiness: green at 30 seconds but requests fail until 90 seconds
Bundle count: 180
DS components: 950
Services: 1400
Metaspace: 450MB
After 5 hot updates: metaspace 700MB
```

Root causes:

1. Banyak plugin melakukan DB load di `@Activate`.
2. JPA metamodel dibangun untuk plugin yang tidak critical.
3. Annotation scanner scan semua bundle.
4. Rule service dynamic list memakai synchronized list dengan lock contention.
5. Several executors tidak shutdown saat deactivate.
6. Runtime resolve dari repository besar saat boot.
7. Duplicate Jackson dan JAXB bundle.

### 16.2 Perbaikan

Actions:

```text
- Move annotation metadata generation to build-time
- Make plugin activation lightweight
- Introduce RuleReadiness service
- Use atomic immutable rule snapshot
- Separate critical boot features and optional plugins
- Lock resolved runbundles in distribution
- Remove duplicate embedded libraries
- Add refresh leak test
- Add startup event metrics
- Add DS activation duration logging
```

### 16.3 Hasil yang Diinginkan

```text
Startup: 35 seconds
Readiness: accurate at 38 seconds
Metaspace: 300MB
After 10 hot updates: metaspace stable after GC
Service churn: reduced by 80%
Resolver at production startup: near-zero/unneeded due locked distribution
```

Poin penting: improvement datang dari architecture + lifecycle discipline, bukan hanya JVM flags.

---

## 17. Anti-Patterns Performance OSGi

### 17.1 Export Everything

```text
Export-Package: *
```

Dampak:

- graph besar
- accidental API
- resolver complexity
- versioning impossible

### 17.2 DynamicImport Everywhere

```text
DynamicImport-Package: *
```

Dampak:

- resolve-time visibility discipline hilang
- classloading runtime unpredictable
- performance sulit dianalisis

### 17.3 Blocking Activation

```java
@Activate
void activate() {
    externalApi.callWithoutTimeout();
}
```

Dampak:

- startup hang
- component unavailable
- readiness salah

### 17.4 Service Registry as Queue

Dampak:

- churn tinggi
- service events flood
- registry lock contention
- diagnostics noise

### 17.5 Hot Deploy Without Leak Test

Dampak:

- metaspace leak
- stale threads
- old classloader retained
- degradation after several updates

### 17.6 One Bundle per Class

Dampak:

- classloader overhead
- manifest overhead
- lifecycle overhead
- cognitive overhead

### 17.7 One Bundle for Everything

Dampak:

- update blast radius besar
- no plugin isolation
- no API discipline
- slow release cycle

---

## 18. Performance Design Review Checklist

### 18.1 Startup

- [ ] Apakah startup timeline diukur?
- [ ] Apakah readiness berbeda dari ACTIVE?
- [ ] Apakah activation method ringan?
- [ ] Apakah external IO punya timeout?
- [ ] Apakah warmup non-critical bisa async?
- [ ] Apakah endpoint tidak expose sebelum dependency ready?

### 18.2 Resolver

- [ ] Apakah runtime distribution locked?
- [ ] Apakah resolver test ada di CI?
- [ ] Apakah version range wajar?
- [ ] Apakah optional import justified?
- [ ] Apakah split package dicegah?
- [ ] Apakah duplicate library dikendalikan?

### 18.3 Services

- [ ] Apakah service lookup tidak dilakukan per request tanpa alasan?
- [ ] Apakah dynamic references thread-safe?
- [ ] Apakah service property ringan?
- [ ] Apakah service churn dimonitor?
- [ ] Apakah service unregister graceful?

### 18.4 Classloading

- [ ] Apakah annotation scanning runtime diminimalkan?
- [ ] Apakah embedded dependency punya alasan?
- [ ] Apakah TCCL bridging controlled?
- [ ] Apakah classloader leak diuji?
- [ ] Apakah refresh cycle diuji?

### 18.5 Memory

- [ ] Apakah heap dan metaspace dipantau?
- [ ] Apakah executor ditutup saat deactivate?
- [ ] Apakah ThreadLocal dibersihkan?
- [ ] Apakah MBean/listener di-unregister?
- [ ] Apakah cache tidak menahan classloader lama?

### 18.6 Java 8–25

- [ ] Apakah target bytecode eksplisit?
- [ ] Apakah runtime diuji di semua target JDK?
- [ ] Apakah removed Java EE deps eksplisit?
- [ ] Apakah strong encapsulation issue dipetakan?
- [ ] Apakah Security Manager tidak dijadikan sandbox untuk Java 24/25?
- [ ] Apakah bytecode tooling kompatibel dengan classfile target?

---

## 19. Mental Model Final

Performance OSGi harus dipahami sebagai performa dari **runtime composition graph**.

Formula kasarnya:

```text
OSGi performance =
  JVM cost
+ framework lifecycle cost
+ resolver graph cost
+ classloading cost
+ component activation cost
+ service dynamics cost
+ configuration churn cost
+ update/refresh cost
+ operational observability quality
```

Engineer biasa menanyakan:

> Kenapa startup OSGi lambat?

Engineer top-tier menanyakan:

> Fase mana yang lambat, graph mana yang terlalu besar, lifecycle mana yang melakukan pekerjaan di waktu salah, bundle mana yang memperbesar blast radius, dan measurement apa yang membuktikannya?

OSGi memberi kemampuan runtime yang sangat kuat. Tetapi semua kemampuan itu punya biaya. Keahlian advanced bukan memakai semua fitur OSGi, melainkan memilih dinamika runtime yang benar-benar bernilai dan menjaga sisanya tetap sederhana, eksplisit, dan terukur.

---

## 20. Ringkasan

Di part ini kita mempelajari:

- performance model OSGi dari startup sampai runtime update
- startup lifecycle dan readiness yang benar
- resolver cost sebagai constraint solving problem
- bundle granularity trade-off
- DS activation cost dan anti-pattern
- service lookup dan service churn
- classloading performance
- memory/metaspace/classloader leak
- refresh/update blast radius
- Java 8 sampai 25 performance implications
- profiling dan measurement
- tuning playbook
- case study enforcement rule platform
- checklist design review

Part berikutnya akan membahas **Provisioning and Deployment: Repositories, Features, p2, Karaf, Containers, and Rollback**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./25-observability-troubleshooting-wiring-service-graphs-memory-leaks-startup-failures.md">⬅️ Part 25 — Observability and Troubleshooting: Wiring Graphs, Service Graphs, Memory Leaks, Startup Failures</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./27-provisioning-deployment-repositories-features-p2-karaf-containers-rollback.md">Part 27 — Provisioning and Deployment: Repositories, Features, p2, Karaf, Containers, and Rollback ➡️</a>
</div>
