# 34 — Top 1% OSGi Engineering: Design Reviews, Invariants, Checklists, and Decision Framework

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> Part: 34 dari 35  
> Scope: Java 8 sampai Java 25  
> Fokus: cara berpikir, review, governance, invariants, failure modelling, dan decision framework untuk sistem OSGi production-grade.

---

## 1. Posisi Part Ini dalam Series

Part ini adalah bagian penutup konseptual dari seluruh rangkaian OSGi. Dari Part 0 sampai Part 33, kita sudah membahas:

- mental model OSGi;
- lifecycle framework dan bundle;
- manifest, package import/export, capabilities;
- classloading dan resolver;
- semantic versioning;
- service registry dan Declarative Services;
- configuration, bnd, Felix, Equinox, Karaf;
- web, persistence, messaging, security, JPMS, Java 8–25;
- enterprise integration, extender, fragments, testing, observability, performance;
- provisioning, plugin platform, architecture patterns, anti-patterns, migration, case study, dan runtime customization.

Part ini tidak memperkenalkan terlalu banyak mekanisme baru. Tujuannya adalah mengubah seluruh pengetahuan tersebut menjadi **kerangka kerja engineering**: bagaimana engineer senior/top-tier mengambil keputusan, mereview desain, mendeteksi risiko, dan menjaga sistem tetap evolvable selama bertahun-tahun.

Top 1% engineer dalam konteks OSGi bukan orang yang hafal semua header manifest. Mereka adalah orang yang bisa menjawab:

1. Apakah sistem ini memang butuh OSGi?
2. Di mana boundary modularitas yang benar?
3. Dependency mana yang harus compile-time, resolve-time, start-time, config-time, atau runtime service?
4. Apa yang terjadi jika bundle/service/config hilang saat sistem berjalan?
5. Apa konsekuensi update bundle terhadap class identity, wiring, transaksi, thread, cache, dan observability?
6. Apakah versi package/API/service contract ini masih aman untuk konsumen lama?
7. Bagaimana cara membuktikan bahwa sistem ini aman untuk dioperasikan di production?

OSGi Core R8 sendiri memisahkan framework ke beberapa layer penting: module layer, lifecycle layer, service layer, dan security layer. Module layer mengatur sharing/hiding package, lifecycle layer mengatur bundle, dan service layer menyediakan model komunikasi antar bundle. Dengan kata lain, OSGi adalah runtime architecture, bukan sekadar packaging format.

---

## 2. Prinsip Utama: OSGi Adalah Runtime Evolution Discipline

OSGi sering gagal bukan karena teknologinya salah, tetapi karena tim memperlakukannya seperti classpath biasa.

Classpath biasa berpikir:

```text
Semua JAR ada di satu ruang classpath.
Selama compile dan startup jalan, sistem dianggap benar.
```

OSGi berpikir:

```text
Setiap bundle punya identitas, classloader, lifecycle, wiring, service exposure, dan dependency contract.
Sistem tidak hanya harus bisa start; sistem harus bisa berevolusi saat runtime berubah.
```

Implikasinya besar:

- `ACTIVE` bukan berarti ready.
- service bisa muncul dan hilang.
- package yang sama bisa punya versi berbeda.
- class yang namanya sama bisa berbeda identitas karena classloader berbeda.
- update bundle bisa menyebabkan refresh dan rewire.
- konfigurasi adalah runtime input, bukan compile-time constant.
- API versioning adalah governance, bukan kosmetik.
- plugin adalah kontrak sosial + teknis, bukan hanya JAR tambahan.

Top-tier OSGi engineering berarti mendesain sistem yang tetap benar ketika runtime berubah.

---

## 3. The OSGi Engineering Stack

Untuk review sistem OSGi, pikirkan stack berikut:

```text
┌─────────────────────────────────────────────────────────────┐
│ Business / Domain Evolution                                 │
│ - rule changes, tenant variance, regulatory changes          │
│ - new connectors, new product variants                       │
├─────────────────────────────────────────────────────────────┤
│ Architecture Composition                                    │
│ - kernel, API, SPI, implementation, plugin, feature          │
├─────────────────────────────────────────────────────────────┤
│ Service Runtime                                             │
│ - registry, DS, references, ranking, filters, dynamics       │
├─────────────────────────────────────────────────────────────┤
│ Module Runtime                                              │
│ - bundles, packages, imports, exports, capabilities          │
├─────────────────────────────────────────────────────────────┤
│ Resolver / Wiring                                           │
│ - version ranges, uses constraints, capabilities, refresh    │
├─────────────────────────────────────────────────────────────┤
│ Classloading                                                │
│ - bundle classloaders, TCCL, SPI, reflection, proxies        │
├─────────────────────────────────────────────────────────────┤
│ Provisioning / Operations                                   │
│ - repositories, features, bndrun, p2, Karaf, containers      │
├─────────────────────────────────────────────────────────────┤
│ JVM / Java 8–25                                             │
│ - bytecode, JPMS, strong encapsulation, Security Manager     │
└─────────────────────────────────────────────────────────────┘
```

Banyak bug OSGi terjadi karena engineer hanya melihat satu layer.

Contoh:

- Error muncul sebagai `ClassCastException`, tetapi root cause-nya adalah split package.
- Service tidak muncul, tetapi root cause-nya adalah DS component unsatisfied karena config missing.
- Bundle `ACTIVE`, tetapi endpoint 404 karena HTTP Whiteboard context belum registered.
- Update minor API terlihat aman, tetapi baseline sebenarnya menunjukkan binary breaking change.
- Runtime berhasil start di Java 8, tetapi gagal di Java 17 karena reflective access ke internal JDK package.

Top-tier review selalu menelusuri lintas layer.

---

## 4. OSGi Design Review: Pertanyaan Pertama yang Harus Dijawab

Sebelum menulis bundle, jawab pertanyaan berikut.

### 4.1 Apakah OSGi Benar-Benar Dibutuhkan?

Gunakan OSGi jika sistem membutuhkan salah satu atau beberapa hal berikut:

- in-process modularity dengan isolation yang lebih kuat dari package convention;
- plugin runtime;
- dynamic service registration;
- kemampuan enable/disable module tanpa rebuild full application;
- multiple implementation dari contract yang sama;
- product-line runtime atau customer-specific runtime assembly;
- lifecycle-aware component model;
- dependency versioning yang lebih eksplisit daripada classpath biasa;
- runtime yang panjang umur dan sering berevolusi.

Jangan gunakan OSGi hanya karena:

- ingin terlihat advanced;
- ingin mengganti Spring Boot tanpa alasan;
- ingin memecah semua package menjadi bundle;
- ingin hot deploy tanpa memahami state migration;
- ingin sandbox untrusted code di Java 24/25 dalam JVM yang sama.

Sejak Java Security Manager dideprecate for removal lewat JEP 411 dan pada JDK modern tidak bisa lagi dijadikan dasar sandbox yang kuat, OSGi tidak boleh dijual sebagai isolasi keamanan penuh untuk arbitrary untrusted plugin dalam satu proses JVM. Untuk untrusted code, gunakan process/container isolation.

### 4.2 Apa Axis Modularitasnya?

Ada beberapa axis modularitas:

| Axis | Contoh | Cocok untuk Bundle? |
|---|---|---|
| Domain capability | case, appeal, compliance, document | sering cocok |
| Technical layer | repository, service, controller | sering tidak cocok jika terlalu granular |
| Plugin extension | validation rule, connector, renderer | sangat cocok |
| Product variant | agency-specific module | cocok |
| Shared utility | string helper, date helper | biasanya tidak cocok |
| External integration | payment, identity, map service | cocok jika lifecycle/config berbeda |

Kesalahan umum adalah memecah berdasarkan layer teknis:

```text
case-api bundle
case-dto bundle
case-repository bundle
case-service bundle
case-controller bundle
```

Ini bisa menjadi terlalu granular jika semua bundle selalu harus dipasang bersama.

Lebih sehat:

```text
case.api
case.core
case.web
case.persistence
case.plugin.spi
case.plugins.default-rules
```

Boundary harus mengikuti evolusi, bukan sekadar struktur folder.

---

## 5. Core Invariants yang Harus Dijaga

Invariant adalah aturan yang harus tetap benar meskipun sistem berubah.

### 5.1 Module Invariants

```text
Hanya package API yang diexport.
Package implementation tidak boleh bocor ke konsumen.
Setiap Import-Package punya version range yang sengaja dipilih.
Tidak ada split package kecuali ada alasan khusus dan terdokumentasi.
Tidak ada DynamicImport-Package:* di production bundle.
Require-Bundle hanya dipakai jika ada alasan kuat.
```

Kenapa ini penting?

Karena OSGi resolver bekerja pada dependency contract. Jika semua package diexport atau semua import optional, resolver kehilangan informasi arsitektur. Sistem tampak fleksibel, tetapi sebenarnya fragile.

### 5.2 Service Invariants

```text
Service contract harus stabil.
Service implementation boleh berganti.
Consumer tidak boleh bergantung pada implementation class.
Service reference bisa hilang kapan pun.
Service call harus punya concurrency dan failure contract.
```

Konsekuensi desain:

- Jangan expose entity ORM sebagai service contract lintas bundle.
- Jangan expose implementation-specific exception kecuali bagian dari API package.
- Jangan simpan service reference secara static tanpa lifecycle management.
- Jangan asumsikan service selalu ada kecuali cardinality/reference policy menjaminnya.

### 5.3 Lifecycle Invariants

```text
Activation harus cepat.
Activation harus idempotent.
Deactivate harus membersihkan resource.
Update/refresh tidak boleh meninggalkan thread, classloader, atau service lama.
ACTIVE bukan readiness.
```

Bundle `ACTIVE` hanya berarti bundle sudah dimulai menurut framework. Itu tidak berarti:

- endpoint siap;
- DB migration selesai;
- remote dependency sehat;
- config valid;
- plugin registry siap;
- cache warm;
- service dependency sudah stabil.

### 5.4 Versioning Invariants

```text
Package API punya version.
Breaking change menaikkan major version.
Non-breaking addition menaikkan minor version.
Implementation-only fix menaikkan micro version.
Baseline check berjalan di CI.
Consumer import range tidak terlalu lebar dan tidak terlalu sempit.
```

Bundle version penting untuk deployment identity, tetapi package version penting untuk compatibility.

### 5.5 Configuration Invariants

```text
Config adalah runtime contract.
Config harus tervalidasi.
Secret tidak boleh disimpan sebagai plain operational config jika bisa dihindari.
Config update harus atomic dari perspektif component.
Config schema harus bisa berevolusi.
```

Jangan treat Config Admin sebagai tempat dumping string properties. Config adalah bagian dari API operasional.

### 5.6 Operations Invariants

```text
Runtime assembly harus reproducible.
Bundle source harus traceable.
Wiring graph harus bisa diperiksa.
Service graph harus bisa diperiksa.
Rollback path harus ada.
```

OSGi tanpa operational evidence akan sulit dipertahankan di production.

---

## 6. Bundle Boundary Checklist

Gunakan checklist ini saat membuat bundle baru.

### 6.1 Pertanyaan Boundary

1. Apakah bundle ini punya lifecycle berbeda dari bundle lain?
2. Apakah bundle ini bisa diupdate secara independen?
3. Apakah bundle ini punya dependency yang berbeda secara signifikan?
4. Apakah bundle ini mewakili API, SPI, implementation, atau plugin?
5. Apakah bundle ini punya owner jelas?
6. Apakah bundle ini memiliki config sendiri?
7. Apakah bundle ini punya observability sendiri?
8. Apakah bundle ini akan selalu dipasang bersama bundle lain?
9. Jika ya, kenapa dipisah?
10. Jika digabung, apa risiko evolusinya?

### 6.2 Bundle Type Taxonomy

| Type | Tujuan | Export? | Register Service? |
|---|---|---:|---:|
| API bundle | contract publik | ya | biasanya tidak |
| SPI bundle | extension contract | ya | kadang |
| Implementation bundle | implementasi internal | tidak/terbatas | ya |
| Plugin bundle | kontribusi extension | tidak/terbatas | ya |
| Adapter bundle | bridge external lib/system | terbatas | ya |
| Web bundle | endpoint HTTP | jarang | ya/register servlet |
| Persistence bundle | repository/transaction boundary | jarang | ya |
| Distribution bundle | assembly/helper | tidak | tidak |

### 6.3 Smell Boundary

Red flags:

- bundle bernama `common`, `core`, `util`, `shared` terlalu besar;
- bundle mengekspor lebih dari 20 package tanpa alasan;
- bundle punya banyak dependency optional;
- bundle hanya berisi satu class trivial;
- semua bundle selalu harus restart bersama;
- implementation package diimport oleh banyak bundle;
- bundle API bergantung pada bundle implementation;
- domain API bundle bergantung pada persistence provider;
- plugin bundle perlu akses internal host package.

---

## 7. Package Export / Import Review

### 7.1 Export Review

Untuk setiap exported package, tanyakan:

1. Siapa konsumennya?
2. Apakah package ini API, SPI, atau accidental export?
3. Apakah version-nya benar?
4. Apakah ada `uses:=` yang harus muncul?
5. Apakah package ini membawa type dari package lain?
6. Apakah DTO/exception/annotation dalam contract stabil?
7. Apakah package ini punya deprecation policy?

Contoh buruk:

```text
Export-Package: com.acme.case.*
```

Ini mengekspor semua, termasuk internal.

Contoh lebih sehat:

```text
Export-Package: \
  com.acme.case.api;version="2.1.0",\
  com.acme.case.spi;version="1.4.0"
Private-Package: \
  com.acme.case.internal.*
```

### 7.2 Import Review

Untuk setiap import penting:

1. Apakah range-nya disengaja?
2. Apakah dependency ini mandatory atau optional?
3. Jika optional, apakah kode punya fallback path?
4. Apakah import berasal dari API package atau implementation package?
5. Apakah ada risiko duplicate provider?
6. Apakah ada risiko `uses:=` conflict?

Contoh buruk:

```text
Import-Package: *;resolution:=optional
```

Ini membuat runtime tampak bisa resolve tetapi gagal saat class dipakai.

Contoh lebih sehat:

```text
Import-Package: \
  com.acme.case.api;version="[2.1,3)",\
  org.osgi.service.component.annotations;version="[1.5,2)";resolution:=optional,\
  *
```

Dalam praktik bnd, banyak import dihitung otomatis. Tapi engineer tetap harus mereview hasilnya.

---

## 8. Service Contract Checklist

Untuk setiap service interface yang dipublish ke registry:

### 8.1 Contract Surface

Pastikan jelas:

- package version;
- thread-safety expectation;
- exception model;
- blocking/non-blocking behavior;
- transaction expectation;
- idempotency;
- input validation responsibility;
- lifecycle expectation;
- compatibility policy;
- observability expectation.

Contoh service contract yang buruk:

```java
public interface RuleEngine {
    Object execute(Object input);
}
```

Masalah:

- tidak ada type contract;
- tidak ada error model;
- tidak ada versioning data;
- tidak ada context;
- tidak jelas sync/async;
- sulit audit.

Contoh lebih baik:

```java
public interface CaseValidationRule {
    RuleId id();

    RuleEvaluationResult evaluate(CaseEvaluationRequest request)
            throws RuleEvaluationException;
}
```

Dengan DTO:

```java
public final class CaseEvaluationRequest {
    private final String caseId;
    private final String caseType;
    private final String workflowState;
    private final Map<String, String> attributes;
    private final Instant evaluatedAt;

    // immutable constructor + getters
}
```

### 8.2 Dynamic Availability

Tanyakan:

1. Apa yang terjadi jika service tidak ada?
2. Apa yang terjadi jika service diganti saat request berjalan?
3. Apakah consumer perlu snapshot daftar service?
4. Apakah service ranking memengaruhi routing?
5. Apakah service properties menjadi bagian kontrak?
6. Apakah service bisa di-disable karena config?
7. Apakah service punya health state?

Untuk multiple dynamic services, pattern yang sering aman adalah immutable snapshot:

```java
@Component(service = RuleRegistry.class)
public class RuleRegistry {
    private volatile List<CaseValidationRule> rules = List.of();

    @Reference(
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(CaseValidationRule rule, Map<String, Object> props) {
        List<CaseValidationRule> next = new ArrayList<>(rules);
        next.add(rule);
        next.sort(Comparator.comparing(CaseValidationRule::id));
        rules = List.copyOf(next);
    }

    void unbindRule(CaseValidationRule rule) {
        List<CaseValidationRule> next = new ArrayList<>(rules);
        next.remove(rule);
        rules = List.copyOf(next);
    }

    public List<CaseValidationRule> snapshot() {
        return rules;
    }
}
```

Tujuannya bukan supaya semua sistem memakai pattern ini, tetapi supaya dynamic reference tidak menyebabkan concurrent modification atau half-updated view.

---

## 9. Declarative Services Review Checklist

Untuk setiap DS component:

### 9.1 Activation

- Apakah `@Activate` cepat?
- Apakah tidak melakukan network call berat?
- Apakah tidak melakukan DB migration panjang?
- Apakah idempotent?
- Apakah failure activation jelas?
- Apakah resource cleanup terjadi di `@Deactivate`?

### 9.2 Reference

- Mandatory reference benar-benar mandatory?
- Optional reference punya fallback?
- Multiple reference memakai snapshot/list yang thread-safe?
- Static policy dipakai ketika replacement harus restart component?
- Dynamic policy dipakai ketika component aman menerima perubahan live?
- Greedy policy dipakai hanya jika replacement segera memang diinginkan?
- Target filter terdokumentasi?

### 9.3 Configuration

- Configuration PID jelas?
- Config policy benar?
- Config type strongly typed?
- Invalid config fail-fast atau degraded mode?
- `@Modified` tidak meninggalkan state setengah berubah?

### 9.4 Service Exposure

- Component expose interface, bukan implementation class?
- Service properties stabil?
- Ranking disengaja?
- Tidak ada circular dependency?
- Component tidak publish service sebelum siap secara logis?

---

## 10. Resolver Design Review

Resolver errors sering terlihat rumit, tetapi biasanya berasal dari beberapa kategori.

### 10.1 Pertanyaan Resolver

1. Apa requirement bundle ini?
2. Capability mana yang memenuhinya?
3. Apakah ada lebih dari satu candidate?
4. Apakah version range terlalu longgar?
5. Apakah version range terlalu sempit?
6. Apakah ada uses constraint?
7. Apakah ada split package?
8. Apakah ada duplicate API bundle?
9. Apakah optional import menyembunyikan dependency nyata?
10. Apakah repository metadata lengkap?

### 10.2 Resolver Failure Pattern

| Symptom | Kemungkinan Root Cause |
|---|---|
| Bundle `INSTALLED` | missing import/capability |
| `uses constraint violation` | inconsistent transitive package provider |
| `ClassCastException` same FQCN | different classloader/provider |
| Works locally, fails in prod | repository/provisioning drift |
| Works after clean cache only | stale framework cache/wiring state |
| Optional class fails at runtime | optional import tanpa fallback |
| Random provider selected | ambiguous candidates/range terlalu lebar |

### 10.3 Resolver Hygiene Rules

```text
Prefer Import-Package over Require-Bundle.
Avoid split package.
Avoid optional import unless code path benar-benar optional.
Use bnd resolver before deployment.
Pin runtime assembly through repository/lock/release manifest.
Review uses constraints for exported API packages.
```

---

## 11. Versioning Decision Framework

### 11.1 Apa yang Harus Dinaikkan?

| Change | Package Version |
|---|---|
| Fix implementation only | micro |
| Add method to provider-implemented interface | major, unless safe by design |
| Add method to consumer-implemented interface | major |
| Add new class to API | minor |
| Add optional method via new sub-interface | minor/major depending contract |
| Remove class/method | major |
| Change method signature | major |
| Change checked exception | major |
| Change semantic behavior significantly | likely major |
| Add enum value | depends consumer switch behavior; often minor but risky |
| Change DTO field requiredness | depends compatibility; often major if stricter |

### 11.2 Provider vs Consumer Type

OSGi API design harus membedakan:

- provider-implemented interface;
- consumer-implemented interface;
- DTO/value object;
- callback/listener;
- annotation;
- exception.

Jika konsumen mengimplementasikan interface, menambah method bisa breaking. Jika hanya provider yang mengimplementasikan dan konsumen hanya memanggil, risikonya berbeda.

### 11.3 Import Range Policy

Contoh umum:

```text
Consumer of API 2.3.0 imports [2.3,3)
Provider implementing API 2.3.0 may import [2.3,2.4)
```

Kenapa provider lebih sempit?

Karena provider yang mengimplementasikan contract lebih sensitif terhadap minor API additions, terutama jika interface berubah.

### 11.4 Baseline as Governance

Baseline bukan formalitas CI. Baseline adalah guardrail agar perubahan API tidak diam-diam merusak downstream.

Build harus gagal jika:

- breaking API change tidak menaikkan major;
- added API tidak menaikkan minor;
- package version tidak berubah padahal API berubah;
- exported package accidental berubah.

---

## 12. Configuration Decision Framework

### 12.1 Config Classification

| Type | Contoh | Handling |
|---|---|---|
| Static runtime config | port, base path | startup/config admin |
| Dynamic config | threshold, feature toggle | `@Modified` safe update |
| Secret reference | secret key name | resolve via vault/parameter store |
| Business policy | SLA threshold | versioned policy config |
| Plugin config | rule-specific setting | factory PID |
| Environment config | region, URL | externalized, audited |

### 12.2 Config Update Safety

Untuk setiap config update:

1. Apakah validasi dilakukan sebelum state lama diganti?
2. Apakah update atomic dari sisi pembaca?
3. Apakah partial config bisa terjadi?
4. Apakah config lama bisa rollback?
5. Apakah config change tercatat?
6. Apakah secret rotation aman?
7. Apakah component restart diperlukan?

Pattern yang sehat:

```java
@Modified
void modified(MyConfig config) {
    RuntimeSettings next = RuntimeSettings.from(config); // validate first
    this.settings = next; // volatile atomic swap
}
```

Hindari:

```java
@Modified
void modified(MyConfig config) {
    this.timeout = config.timeout();
    this.url = URI.create(config.url());
    this.client.close();
    this.client = newClient(url, timeout);
}
```

Jika `URI.create` gagal setelah timeout berubah, state bisa setengah berubah.

---

## 13. Production Readiness Checklist

### 13.1 Runtime Assembly

- Semua bundle berasal dari repository yang diketahui.
- Ada release manifest.
- Ada SBOM.
- Ada checksum/signature verification.
- Runtime assembly reproducible.
- Tidak ada bundle lokal manual yang tidak tercatat.
- Framework cache policy jelas.
- Start level policy terdokumentasi.

### 13.2 Observability

- Bundle state terlihat.
- DS component state terlihat.
- Service registry terlihat.
- Config state terlihat tanpa membuka secret.
- Resolver/wiring graph bisa diperiksa.
- HTTP endpoints punya readiness/health.
- Event/messaging flow punya correlation ID.
- Plugin health terlihat.
- Startup timeline tercatat.
- Refresh/update events tercatat.

### 13.3 Operations

- Ada runbook untuk bundle stuck `INSTALLED`.
- Ada runbook untuk component unsatisfied.
- Ada runbook untuk `uses constraint violation`.
- Ada runbook untuk `ClassCastException` across bundles.
- Ada runbook untuk config rollback.
- Ada runbook untuk plugin disable/quarantine.
- Ada rollback deployment path.
- Ada smoke test setelah deployment.
- Ada canary atau blue/green bila runtime critical.

### 13.4 Security

- Management shell protected.
- Web console protected/disabled di production.
- Bundle source trusted.
- Plugin admission controlled.
- Secrets tidak muncul di diagnostics/log.
- Service spoofing risk ditangani.
- Bundle signing/repository governance jika diperlukan.
- Tidak mengandalkan Security Manager untuk Java 24/25 sandboxing.

---

## 14. Failure Mode Modelling

Top-tier engineer tidak hanya bertanya “apakah jalan?”, tetapi “bagaimana rusaknya?”

### 14.1 Bundle Failure

| Failure | Pertanyaan |
|---|---|
| Bundle missing | Apakah runtime gagal start atau degrade? |
| Bundle not resolved | Apakah error cukup jelas? |
| Bundle active but unhealthy | Apakah readiness menangkapnya? |
| Bundle update | Apakah refresh blast radius diketahui? |
| Bundle uninstall | Apakah services dibersihkan? |

### 14.2 Service Failure

| Failure | Pertanyaan |
|---|---|
| Mandatory service missing | Component unsatisfied atau fallback? |
| Optional service missing | Apakah code path aman? |
| Service replaced | Apakah consumer thread-safe? |
| Service ranking changed | Apakah routing berubah terdeteksi? |
| Service throws exception | Apakah caller punya containment? |

### 14.3 Config Failure

| Failure | Pertanyaan |
|---|---|
| Missing config | Component disabled atau default? |
| Invalid config | Fail-fast atau last-known-good? |
| Partial config | Apakah atomicity dijamin? |
| Secret expired | Apakah reload aman? |
| Config drift | Apakah terdeteksi? |

### 14.4 Classloading Failure

| Failure | Pertanyaan |
|---|---|
| Class not found | Missing import atau dynamic load? |
| NoClassDefFoundError | Dependency runtime hilang? |
| ClassCastException | Different classloader/provider? |
| LinkageError | Version mismatch? |
| Reflective access fail | Java 9+ encapsulation? |

### 14.5 Update Failure

| Failure | Pertanyaan |
|---|---|
| Update partially applied | Apakah distribution atomic? |
| Resolver selects new provider | Apakah graph locked? |
| Old service still referenced | Apakah references cleaned? |
| Thread leaks old classloader | Apakah deactivate stops executor? |
| Rollback fails | Apakah old config/schema still compatible? |

---

## 15. ADR Templates untuk OSGi

Architecture Decision Record penting karena banyak keputusan OSGi adalah trade-off.

### 15.1 ADR: Why OSGi?

```markdown
# ADR: Use OSGi for Runtime Modular Platform

## Status
Accepted / Proposed / Superseded

## Context
We need dynamic in-process modules for ...
The system requires ...
Alternatives considered: classpath modular monolith, JPMS, microservices, Spring plugin mechanism.

## Decision
Use OSGi with ...
Framework: Felix / Equinox / Karaf
Component model: Declarative Services
Build tooling: bnd / Maven / Gradle

## Consequences
Positive:
- explicit package visibility
- dynamic service model
- runtime composition

Negative:
- higher operational complexity
- versioning discipline required
- classloading troubleshooting required

## Guardrails
- no DynamicImport-Package:* in production
- baseline checks mandatory
- API/SPI/internal bundle separation
- runtime assembly reproducible
```

### 15.2 ADR: Import-Package over Require-Bundle

```markdown
# ADR: Prefer Import-Package over Require-Bundle

## Context
OSGi can express dependencies at package level or bundle level.

## Decision
Default to Import-Package. Require-Bundle requires architecture approval.

## Rationale
Package import allows substitution, precise versioning, and lower coupling.
Require-Bundle couples consumers to a specific bundle identity.

## Exceptions
- legacy Equinox/Eclipse plugin integration
- tightly coupled product feature where bundle identity is intentional
```

### 15.3 ADR: Immutable Runtime Distribution

```markdown
# ADR: Use Immutable Runtime Distribution for Production

## Context
Hot deployment is possible but production requires reproducibility and rollback.

## Decision
Production runtime is assembled as immutable distribution/image.
Runtime mutation is limited to approved plugin/config channels.

## Consequences
- easier rollback
- lower drift
- slower ad-hoc patching
- stronger release evidence
```

---

## 16. Decision Framework: Felix vs Equinox vs Karaf

| Situation | Likely Choice | Reason |
|---|---|---|
| Minimal embedded runtime | Felix | lightweight, embeddable |
| Eclipse/RCP/product platform | Equinox | ecosystem alignment |
| Operational container with shell/features | Karaf | provisioning and ops tooling |
| Custom plugin island inside host app | Embedded Felix/Equinox | controlled host integration |
| Existing Eclipse extension registry | Equinox | native model |
| Enterprise integration with features | Karaf + Aries/CXF | mature distribution model |

No choice is universally best.

Top-tier decision considers:

- operational model;
- team skill;
- provisioning model;
- diagnostics;
- integration requirements;
- release governance;
- long-term maintenance.

---

## 17. Decision Framework: DS vs Blueprint vs CDI vs Spring

| Need | Preferred Direction |
|---|---|
| Modern OSGi components | Declarative Services |
| Legacy XML OSGi enterprise apps | Blueprint |
| CDI-centric environment | OSGi CDI integration if available and justified |
| Spring Boot app with plugin island | Keep Spring outside, bridge via OSGi service boundary |
| Simple services with dynamic references | DS |
| Complex object graph but low dynamics | Spring/CDI may be okay outside OSGi core |

Rule of thumb:

```text
Use one lifecycle owner per object.
```

Avoid objects that are simultaneously owned by Spring and DS unless the integration boundary is deliberate and tested.

---

## 18. Decision Framework: Bundle vs Service vs Config vs Event

### 18.1 When to Create a Bundle

Create a bundle when:

- lifecycle differs;
- dependency graph differs;
- deployment/update differs;
- API boundary matters;
- plugin/extensibility boundary exists;
- product variant needs independent assembly.

Do not create a bundle for:

- every package;
- every class;
- every repository;
- every small utility;
- artificial layer separation.

### 18.2 When to Create a Service

Create a service when:

- implementation can vary;
- lifecycle matters;
- consumer should not know provider;
- multiple providers may exist;
- dynamic replacement is useful;
- plugin contribution is needed.

Do not create a service when:

- object is just a DTO/helper;
- no variation exists;
- synchronous call hides remote/unbounded cost;
- dependency should be a normal private class.

### 18.3 When to Use Config

Use config when:

- value changes per environment;
- value changes per tenant;
- operator controls behavior;
- runtime update is useful;
- secrets can be referenced externally.

Do not use config for:

- changing code behavior without testing;
- replacing versioned business rule contract;
- hidden feature logic nobody audits.

### 18.4 When to Use Event

Use event when:

- producer should not know consumers;
- multiple consumers may react;
- eventual consistency is acceptable;
- event is observable and versioned.

Do not use event when:

- caller needs immediate deterministic result;
- ordering is critical but not modeled;
- errors must be returned synchronously;
- event bus becomes hidden control flow.

---

## 19. Java 8–25 Final Checklist

For any OSGi runtime targeting Java 8–25 compatibility:

### 19.1 Build and Bytecode

- Use explicit toolchain.
- Use `--release` where applicable.
- Do not accidentally compile Java 21 bytecode for Java 8 runtime.
- Test on every supported JDK.
- Check framework version compatibility.

### 19.2 Removed Java EE Modules

After Java 8, do not assume built-in:

- JAXB;
- JAX-WS;
- Activation;
- CORBA;
- old Java EE APIs.

Provide explicit bundles/dependencies.

### 19.3 Strong Encapsulation

For Java 9+:

- avoid internal JDK APIs;
- audit reflection;
- document any `--add-opens`;
- reduce deep reflection;
- update old bytecode libraries.

### 19.4 Security Manager

- Java 8-era permission assumptions need review.
- Java 17+ Security Manager path is legacy/risky.
- Java 24/25 cannot rely on it for sandboxing.
- Use process/container isolation for untrusted code.

### 19.5 Virtual Threads

Virtual threads can help blocking workload, but:

- service contract must state blocking behavior;
- ThreadLocal leaks still matter;
- TCCL assumptions still matter;
- lifecycle cancellation still matters.

---

## 20. Top 1% Review Questions

Use these in architecture review.

### 20.1 Architecture

1. What is the smallest stable kernel?
2. Which bundles are product features?
3. Which bundles are plugin extensions?
4. Which packages are public API?
5. Which packages are SPI?
6. Which packages are internal?
7. What is allowed to depend on what?
8. What must never depend on what?

### 20.2 Runtime

1. What can appear/disappear at runtime?
2. What happens if it disappears mid-request?
3. What is the readiness model?
4. What is the update model?
5. What is the rollback model?
6. What is the config reload model?

### 20.3 Compatibility

1. Which APIs are versioned?
2. Is baseline enforced?
3. What is the import range policy?
4. Can two major versions coexist?
5. How is deprecation handled?
6. How are plugins certified?

### 20.4 Operations

1. Can we dump bundle state?
2. Can we dump wiring graph?
3. Can we dump service graph?
4. Can we see unsatisfied DS references?
5. Can we detect config drift?
6. Can we explain every bundle in the runtime?
7. Can we rebuild the exact runtime from source/repository?

### 20.5 Security

1. Who can install bundles?
2. Who can change config?
3. Who can access management shell?
4. Are plugins trusted, certified, or isolated?
5. Are service properties spoofable?
6. Are secrets protected in logs/diagnostics?

---

## 21. Example: OSGi Design Review for Enforcement Rule Platform

Imagine platform regulatory case management dengan dynamic validation rules.

### 21.1 Proposed Bundle Layout

```text
com.acme.enforcement.case.api
com.acme.enforcement.case.core
com.acme.enforcement.case.persistence
com.acme.enforcement.case.web
com.acme.enforcement.rule.spi
com.acme.enforcement.rule.registry
com.acme.enforcement.rule.default
com.acme.enforcement.rule.agency-a
com.acme.enforcement.audit.api
com.acme.enforcement.audit.core
com.acme.enforcement.runtime.diagnostics
```

### 21.2 Review

Good signs:

- API separated from implementation.
- Rule SPI separated from rule implementations.
- Agency-specific rules can be assembled independently.
- Diagnostics bundle exists.
- Persistence hidden behind service boundary.

Risks:

- Rule SPI must be stable.
- Rule result DTO must be versioned carefully.
- Agency plugin must not access case core internals.
- Dynamic removal of rule must not break in-flight case evaluation.
- Audit must record which rule version evaluated case.

### 21.3 Required Invariants

```text
Every rule has stable RuleId and semantic version.
Every evaluation records rule bundle symbolic name and version.
Rule plugins only import rule SPI and approved case API.
Rule registry uses immutable snapshot for evaluation.
Rule config update is audited.
Rule failure is contained per rule.
```

### 21.4 Failure Model

| Failure | Expected Behavior |
|---|---|
| Rule plugin missing | case evaluation degrades or blocks based on policy |
| Rule plugin throws | result includes rule failure, audit records it |
| Rule plugin updated | new evaluations use new snapshot; in-flight continues |
| Rule config invalid | plugin remains disabled or last-known-good used |
| Rule API incompatible | bundle does not resolve; deployment rejected |

This is the difference between “plugin system works” and “plugin system is defensible”.

---

## 22. Maturity Model

### Level 0 — Accidental OSGi

- bundles are just JARs;
- manifest barely understood;
- exports everything;
- no versioning discipline;
- no runtime diagnostics.

### Level 1 — Basic OSGi

- bundles resolve;
- some services registered;
- DS used;
- basic config works.

### Level 2 — Managed OSGi

- API/internal separation;
- version ranges reviewed;
- baseline check exists;
- runtime assembly reproducible;
- diagnostics available.

### Level 3 — Production OSGi

- service dynamics tested;
- update/refresh model defined;
- config audit/rollback exists;
- plugin governance exists;
- observability complete;
- Java upgrade path tested.

### Level 4 — Platform-Grade OSGi

- extension contracts certified;
- multiple product variants assembled;
- failure modes modelled;
- compatibility policy enforced;
- repository trust controlled;
- runtime evolution is routine.

### Level 5 — Top 1% OSGi Engineering

- decisions are invariant-driven;
- resolver/classloading failures can be diagnosed from first principles;
- API evolution is governed;
- operations and architecture are unified;
- runtime changes are safe, observable, reversible, and auditable.

---

## 23. Final Top 1% Heuristics

### 23.1 Prefer Explicitness

In OSGi, implicit dependency is future incident.

Make explicit:

- package imports;
- package exports;
- service contracts;
- config schemas;
- plugin capabilities;
- runtime assembly;
- version ranges.

### 23.2 Prefer Stable Contracts over Clever Dynamics

Dynamic runtime is powerful, but not every component needs dynamic behavior.

Use dynamic service patterns where they add value. Use static dependencies where stability matters.

### 23.3 Prefer API Bundles That Are Boring

A good API bundle should be boring:

- few dependencies;
- immutable DTOs;
- clear exceptions;
- stable package version;
- no implementation leak;
- no framework-specific type unless intentional.

### 23.4 Prefer Operationally Boring Deployments

Hot deploy is impressive. Reproducible deployment is defensible.

For production:

- immutable distribution;
- controlled config changes;
- plugin certification;
- clear rollback;
- strong diagnostics.

### 23.5 Treat Resolver Errors as Design Feedback

A resolver error is not just an obstacle. Often it is telling you your architecture contract is inconsistent.

Do not silence resolver problems with:

```text
DynamicImport-Package: *
resolution:=optional everywhere
Require-Bundle everything
embedded duplicate dependencies
```

Fix the model.

### 23.6 Treat Classloader Problems as Boundary Problems

`ClassCastException` across same FQCN is rarely “random”. It usually means boundary violation.

Ask:

- which bundle loaded this class?
- which package provider exported it?
- are there duplicate API bundles?
- is there split package?
- is TCCL involved?
- is reflection/SPI loading from wrong loader?

### 23.7 Treat Versioning as Communication

Version numbers communicate compatibility promises. If they lie, your runtime becomes untrustworthy.

### 23.8 Treat Plugin Governance as Product Governance

A plugin is not just code. It is an independently evolving participant in your platform.

Govern:

- API access;
- version compatibility;
- security trust;
- certification;
- config;
- observability;
- rollback;
- ownership.

---

## 24. Final Master Checklist

Before approving an OSGi system for production, require evidence for:

```text
[ ] Bundle boundaries reflect lifecycle/evolution boundaries.
[ ] API/SPI/internal packages are separated.
[ ] Exported packages are versioned.
[ ] Baseline check runs in CI.
[ ] Import ranges are reviewed.
[ ] No accidental split package.
[ ] No DynamicImport-Package:* in production.
[ ] Require-Bundle usage is justified.
[ ] DS components have clear lifecycle and references.
[ ] Activation is fast and safe.
[ ] Deactivation cleans resources.
[ ] Dynamic references are thread-safe.
[ ] Config schema is typed and validated.
[ ] Secret handling is safe.
[ ] Runtime assembly is reproducible.
[ ] Bundle repository/source is trusted.
[ ] Wiring graph can be inspected.
[ ] Service graph can be inspected.
[ ] DS unsatisfied components can be diagnosed.
[ ] Readiness model is separate from bundle ACTIVE.
[ ] Update/refresh blast radius is understood.
[ ] Rollback path exists.
[ ] Java 8–25 compatibility matrix is tested as required.
[ ] JPMS/strong encapsulation issues are handled.
[ ] Security Manager assumptions are removed for Java 24/25.
[ ] Plugin admission/certification exists if plugins are supported.
[ ] Operational runbook exists.
[ ] Failure injection tests exist for missing service/config/bundle.
```

---

## 25. Penutup Series

OSGi adalah teknologi yang menuntut kedewasaan engineering. Ia memberi kemampuan yang jarang dimiliki runtime Java biasa:

- dependency visibility eksplisit;
- modularity di runtime;
- service dynamics;
- versioned package contracts;
- runtime composition;
- plugin/extensibility model;
- controlled long-term evolution.

Tetapi kemampuan itu datang dengan harga:

- classloading lebih kompleks;
- resolver membutuhkan disiplin;
- lifecycle harus dipahami;
- versioning tidak boleh asal;
- observability harus lebih kaya;
- deployment harus lebih terkontrol;
- plugin governance harus matang.

Engineer top-tier tidak memakai OSGi untuk membuat sistem terlihat advanced. Mereka memakainya ketika runtime evolution, modular contracts, dan controlled extensibility benar-benar menjadi kebutuhan bisnis/teknis.

Mental model terakhir:

```text
OSGi is not about splitting Java code into many JARs.
OSGi is about making runtime evolution explicit, bounded, observable, and governable.
```

Jika kamu bisa mempertahankan invariant tersebut, kamu sudah berpikir bukan hanya sebagai Java developer, tetapi sebagai platform engineer.

---

## 26. Referensi Utama

- OSGi Core Release 8 Specification — module layer, lifecycle layer, service layer, resolver/resource model, hooks, security.
- OSGi Compendium Release 8 / 8.1 — Declarative Services, Configuration Admin, Metatype, Event Admin, HTTP Whiteboard, JPA/Transaction-related services.
- bnd / Bndtools Documentation — manifest generation, resolver, bndrun, baseline, testing.
- Apache Felix Documentation — framework usage, embedding, Gogo shell, SCR, FileInstall, Web Console.
- Eclipse Equinox Documentation — framework, launcher, p2, extension registry, execution environments.
- Apache Karaf Documentation — features, provisioning, shell, configuration, operations.
- OpenJDK JEP 261 — Java Platform Module System.
- OpenJDK JEP 411 — Security Manager deprecation for removal.
- Java 8–25 migration documentation — strong encapsulation, removed Java EE modules, runtime compatibility.

---

## 27. Status Series

```text
Part 34 dari 35 selesai.
Series sudah mencapai bagian terakhir dari roadmap 0–34.
```

Catatan: roadmap awal menyebut “35 part” dengan indexing `00` sampai `34`. Jadi **Part 34 adalah bagian terakhir**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 33 — Advanced Runtime Customization: Embedding Frameworks, Launcher Design, Hooks, Connect](./33-advanced-runtime-customization-embedding-frameworks-launcher-hooks-connect.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-000](../reflection/learn-java-oop-functional-reflection-codegen-modules-part-000.md)
