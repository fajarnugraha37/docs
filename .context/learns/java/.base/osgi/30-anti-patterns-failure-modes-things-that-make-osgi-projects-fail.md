# Part 30 — Anti-Patterns and Failure Modes: The Things That Make OSGi Projects Fail

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `30-anti-patterns-failure-modes-things-that-make-osgi-projects-fail.md`  
> Target Java: 8 sampai 25  
> Fokus: mengenali, mencegah, dan memulihkan kegagalan desain/runtime OSGi yang membuat sistem modular berubah menjadi classpath chaos dengan manifest tambahan.

---

## 1. Tujuan Part Ini

OSGi sering gagal bukan karena spesifikasinya lemah, tetapi karena tim memperlakukannya sebagai:

- classpath dengan manifest tambahan,
- plugin loader sederhana,
- DI container alternatif,
- hot deploy magic,
- atau cara “menghindari microservices” tanpa discipline modularity.

Part ini membahas **anti-pattern dan failure mode** yang paling sering membuat proyek OSGi mahal, rapuh, dan sulit dioperasikan.

Target setelah mempelajari bagian ini:

1. Mampu membaca gejala runtime OSGi dan menghubungkannya ke akar desain.
2. Mampu membedakan bug code-level, metadata-level, resolver-level, lifecycle-level, dan architecture-level.
3. Mampu membuat review checklist untuk bundle, service, API, config, deployment, dan operation.
4. Mampu menyelamatkan proyek OSGi yang sudah terlanjur berantakan tanpa rewrite total.
5. Mampu menjelaskan kapan OSGi adalah solusi tepat, dan kapan OSGi hanya menambah kompleksitas.

---

## 2. Mental Model: OSGi Failure Is Usually Contract Failure

Dalam aplikasi Java biasa, banyak kontrak bersifat implisit:

- semua JAR ada di classpath,
- semua class bisa saling melihat,
- dependency diputuskan saat build,
- lifecycle dimulai sekali,
- service jarang hilang saat runtime,
- version conflict sering diselesaikan Maven/Gradle dengan satu pemenang.

Dalam OSGi, kontrak dibuat eksplisit:

- package harus di-import/export,
- service harus diregister dan bisa hilang,
- bundle punya lifecycle,
- resolver memilih wiring,
- version range menentukan compatibility,
- classloader identity memengaruhi tipe object,
- update/refresh punya blast radius.

Karena itu, kegagalan OSGi hampir selalu berasal dari salah satu kontrak ini:

| Jenis kontrak | Contoh kegagalan |
|---|---|
| Package contract | import terlalu luas, export internal package, split package |
| Version contract | package berubah tapi version tidak naik |
| Service contract | service dianggap selalu tersedia |
| Lifecycle contract | activation blocking, cleanup tidak idempotent |
| Configuration contract | config invalid membuat component mati diam-diam |
| Resolver contract | optional import menyembunyikan dependency wajib |
| Operational contract | update bundle tanpa refresh plan |
| Security contract | plugin dianggap isolated padahal tidak |
| Governance contract | tidak ada baseline, certification, repository policy |

Top-tier OSGi engineering berarti **mendesain kontrak runtime yang eksplisit, kecil, stabil, dan dapat diverifikasi**.

---

## 3. Anti-Pattern 1 — Treating OSGi as “Classpath with Extra Steps”

### Gejala

Tim berkata:

> “Kita tinggal jadikan semua JAR sebagai bundle.”

Lalu mereka:

- export hampir semua package,
- embed semua dependency,
- memakai `DynamicImport-Package: *`,
- memakai `Require-Bundle` secara luas,
- tidak versioning package,
- tidak membuat service boundary,
- tidak membuat resolver test.

### Kenapa berbahaya

OSGi bukan format packaging saja. OSGi adalah runtime dengan:

- classloader per bundle,
- explicit package visibility,
- service registry dinamis,
- resolver constraint,
- lifecycle state machine.

Jika semua konsep ini diabaikan, hasilnya bukan modular system, melainkan **classpath chaos yang lebih sulit di-debug**.

### Contoh buruk

```properties
Bundle-SymbolicName: com.example.case
Export-Package: *
Import-Package: *;resolution:=optional
DynamicImport-Package: *
```

Manifest ini terlihat “fleksibel”, tetapi sebenarnya menghancurkan desain:

- tidak jelas API mana yang publik,
- semua dependency tampak optional,
- resolver kehilangan kemampuan mendeteksi kesalahan lebih awal,
- class loading bisa menjadi nondeterministic,
- runtime failure baru muncul saat fitur dipakai.

### Desain yang lebih benar

```properties
Bundle-SymbolicName: com.example.case.service
Export-Package: \
  com.example.case.api;version="1.4.0"
Private-Package: \
  com.example.case.internal.*
Import-Package: \
  com.example.workflow.api;version="[2.1,3)",\
  org.osgi.service.component.annotations;version="[1.5,2)";resolution:=optional,\
  *
```

Prinsip:

- export hanya API yang memang dipakai bundle lain,
- internal tetap private,
- dependency wajib dinyatakan wajib,
- optional hanya untuk integrasi yang benar-benar optional,
- version range eksplisit untuk API penting,
- build tool seperti bnd menghitung import berdasarkan bytecode.

### Recovery

Jika sistem sudah terlanjur seperti classpath:

1. Inventaris semua exported package.
2. Tandai package sebagai `api`, `spi`, `internal`, `legacy`.
3. Stop export internal package secara bertahap.
4. Tambahkan package version.
5. Hilangkan `DynamicImport-Package: *`.
6. Ganti optional import palsu menjadi mandatory import.
7. Tambahkan resolver test di CI.
8. Tambahkan baseline checking.

---

## 4. Anti-Pattern 2 — Exporting Everything

### Gejala

Bundle export semua package karena:

- “biar gampang dipakai bundle lain”,
- “kalau tidak diexport nanti class not found”,
- “daripada bingung mana API”.

Contoh:

```properties
Export-Package: com.example.*
```

### Kenapa berbahaya

Export adalah janji publik. Begitu package diexport, bundle lain bisa mengimport dan bergantung pada tipe di dalamnya.

Konsekuensi:

- internal class menjadi public contract,
- refactoring internal menjadi breaking change,
- versioning jadi kacau,
- bundle lain bisa bypass service boundary,
- implementasi bocor ke API,
- resolver graph menjadi terlalu besar.

### Contoh kegagalan

Misal bundle `case-core` export:

```text
com.example.case.api
com.example.case.internal
com.example.case.internal.jpa
com.example.case.internal.cache
```

Bundle lain lalu memakai:

```java
import com.example.case.internal.jpa.CaseEntity;
```

Awalnya “praktis”. Setelah beberapa bulan:

- entity tidak bisa diubah,
- persistence model bocor,
- plugin bergantung pada internal table mapping,
- migration database mengakibatkan plugin rusak,
- service boundary tidak ada gunanya.

### Rule of thumb

Export hanya package yang memenuhi semua syarat:

1. Namanya menunjukkan contract: `.api`, `.spi`, `.contract`, `.model`.
2. Punya package version.
3. Punya compatibility policy.
4. Tidak expose internal implementation.
5. Tidak expose framework detail yang tidak perlu.
6. Bisa diuji dengan contract test.
7. Bisa dijelaskan di architecture review.

### Recovery

1. Buat daftar import konsumen untuk setiap exported package.
2. Klasifikasikan package menjadi public/private.
3. Untuk internal yang sudah dipakai orang lain:
   - buat API pengganti,
   - deprecated dulu,
   - naikkan major version bila perlu,
   - lakukan migration window.
4. Gunakan bnd baseline untuk menjaga API package.
5. Tambahkan rule CI yang mencegah export wildcard.

---

## 5. Anti-Pattern 3 — Importing Everything Optional

### Gejala

```properties
Import-Package: *;resolution:=optional
```

Alasan umum:

- “Supaya bundle tetap resolve.”
- “Dependency ini kadang ada kadang tidak.”
- “Kalau mandatory nanti deployment gagal.”

### Kenapa berbahaya

Optional import bukan cara untuk menyembunyikan dependency wajib.

Jika sebuah class benar-benar dipakai dalam code path utama, import harus mandatory. Optional import cocok hanya jika:

- fitur memang optional,
- code path dilindungi availability check,
- service/component tidak aktif jika dependency hilang,
- ada fallback yang jelas,
- failure mode terdokumentasi.

Jika semua import optional, resolver tidak bisa lagi menjadi safety gate.

### Contoh buruk

```java
public class PdfRenderer {
    public byte[] render(Document doc) {
        return new com.thirdparty.pdf.Engine().render(doc);
    }
}
```

Manifest:

```properties
Import-Package: com.thirdparty.pdf;resolution:=optional
```

Bundle bisa resolve tanpa library PDF. Tetapi saat method dipanggil:

```text
NoClassDefFoundError: com/thirdparty/pdf/Engine
```

Ini bukan optional feature. Ini dependency wajib yang disamarkan.

### Desain benar

Pisahkan optional integration menjadi bundle tersendiri:

```text
com.example.document.api
com.example.document.core
com.example.document.pdf.spi
com.example.document.pdf.itext
com.example.document.pdf.pdfbox
```

Core tidak bergantung pada PDF implementation. PDF renderer hadir sebagai service:

```java
public interface DocumentRenderer {
    String format();
    byte[] render(DocumentRenderRequest request);
}
```

PDF bundle mengimport dependency PDF secara mandatory.

### Recovery

1. Cari semua `resolution:=optional`.
2. Tanyakan untuk setiap package:
   - apakah code path utama butuh ini?
   - apakah ada fallback?
   - apakah DS component harus unsatisfied jika dependency tidak ada?
3. Ubah dependency wajib menjadi mandatory.
4. Pindahkan optional feature ke bundle/plugin terpisah.
5. Tambahkan integration test untuk “dependency absent”.

---

## 6. Anti-Pattern 4 — `DynamicImport-Package: *`

### Apa itu

`DynamicImport-Package` membuat bundle bisa mengimport package saat class loading terjadi, bukan saat resolve.

Ini kadang berguna untuk:

- scripting engine,
- dynamic plugin expression,
- framework bridge,
- legacy library yang melakukan reflective loading,
- controlled adapter layer.

Tetapi wildcard global adalah bahaya besar.

### Gejala

```properties
DynamicImport-Package: *
```

### Kenapa berbahaya

- Dependency tidak terlihat saat resolve.
- Wiring bisa terjadi saat runtime secara sulit diprediksi.
- Error terlambat muncul.
- Reproducibility turun.
- Security review sulit.
- Package yang tidak diharapkan bisa ter-load.
- Debugging menjadi lebih sulit.

### Contoh failure

Di DEV, dynamic import menemukan provider package A versi 1.2. Di PROD, karena order repository berbeda, ia menemukan A versi 1.5. Bundle resolve sama-sama sukses, tetapi runtime behavior beda.

### Desain lebih aman

Batasi dynamic import:

```properties
DynamicImport-Package: com.example.script.extension.*
```

Atau lebih baik, gunakan service registry:

```java
public interface ScriptFunctionProvider {
    String namespace();
    Map<String, Object> functions();
}
```

### Recovery

1. Hapus wildcard global.
2. Identifikasi library yang memang butuh dynamic loading.
3. Buat adapter bundle khusus.
4. Batasi package pattern.
5. Tambahkan audit log saat dynamic loading terjadi.
6. Tambahkan test yang menjalankan runtime dari clean cache.

---

## 7. Anti-Pattern 5 — `Require-Bundle` Everywhere

### Gejala

```properties
Require-Bundle: com.example.common, com.example.case, com.example.workflow
```

Alasan umum:

- “Lebih mudah daripada import package.”
- “IDE Eclipse biasa begini.”
- “Kita ingin semua exported package bundle itu terlihat.”

### Kenapa berbahaya

`Require-Bundle` mengikat dependency ke bundle identity, bukan package contract.

Konsekuensi:

- substitusi provider sulit,
- bundle menjadi terlalu coupled,
- update bundle besar berdampak luas,
- dependency transitive bisa kabur,
- reusable API package sulit dipindah provider,
- graph menjadi rigid.

Dalam banyak sistem enterprise, `Import-Package` lebih sehat karena konsumen bergantung pada package/API, bukan bundle implementasi tertentu.

### Kapan `Require-Bundle` bisa dipakai

Tidak selalu haram. Bisa masuk akal untuk:

- Eclipse RCP/plugin ecosystem lama,
- host/fragment relation tertentu,
- product runtime dengan bundle identity sebagai contract,
- kasus re-export controlled.

Tetapi default modern OSGi sebaiknya: **pakai `Import-Package`**.

### Recovery

1. Inventaris semua `Require-Bundle`.
2. Untuk setiap requirement, cari package yang sebenarnya dipakai.
3. Ganti dengan `Import-Package`.
4. Jika perlu API bundle, ekstrak API ke bundle kecil.
5. Hindari bundle besar `common` yang menjadi dependency semua orang.

---

## 8. Anti-Pattern 6 — Split Package

### Definisi

Split package terjadi ketika package yang sama disediakan oleh lebih dari satu bundle.

Contoh:

```text
bundle-a exports com.example.common
bundle-b exports com.example.common
```

### Kenapa berbahaya

OSGi wiring bekerja di level package. Satu import package biasanya wired ke satu exporter. Jika package yang sama tersebar di beberapa bundle, class visibility menjadi tidak intuitif.

Masalah yang muncul:

- sebagian class terlihat, sebagian tidak,
- resolver memilih exporter yang tidak diharapkan,
- class identity kacau,
- JPMS migration hampir mustahil,
- baseline sulit,
- package ownership tidak jelas.

### Contoh

`com.example.common.ValidationResult` ada di bundle A.  
`com.example.common.ValidationException` ada di bundle B.

Consumer import `com.example.common` dari bundle A, lalu runtime butuh `ValidationException` yang hanya ada di bundle B.

Hasil:

```text
NoClassDefFoundError: com/example/common/ValidationException
```

### Desain benar

Satu package harus punya satu owner.

```text
com.example.common.api        -> common-api bundle
com.example.common.internal   -> common-impl bundle private
com.example.validation.api    -> validation-api bundle
com.example.validation.impl   -> validation-impl private
```

### Recovery

1. Scan repository untuk duplicate package.
2. Pilih owner canonical.
3. Rename package jika perlu.
4. Pindahkan shared API ke bundle API kecil.
5. Hindari copy-paste class antar bundle.
6. Tambahkan build rule untuk detect split package.

---

## 9. Anti-Pattern 7 — Leaking Implementation Classes Through API

### Contoh buruk

```java
public interface CaseService {
    HibernateCaseEntity find(String id);
}
```

Atau:

```java
public interface ReportService {
    org.apache.poi.xssf.usermodel.XSSFWorkbook generate(...);
}
```

### Kenapa berbahaya

API menjadi bergantung pada implementation library.

Konsekuensi:

- consumer harus import Hibernate/POI,
- classloader boundary melebar,
- provider tidak bisa diganti,
- version conflict menyebar,
- OSGi resolver graph membengkak,
- API compatibility mengikuti library pihak ketiga.

### Desain benar

Gunakan DTO, stream, atau abstraction:

```java
public interface ReportService {
    GeneratedDocument generate(ReportRequest request);
}

public final class GeneratedDocument {
    private final String contentType;
    private final byte[] content;
    private final String filename;
}
```

Atau untuk large content:

```java
public interface ReportService {
    void writeReport(ReportRequest request, OutputStream target) throws ReportException;
}
```

### Rule

API package tidak boleh expose:

- entity internal,
- ORM provider class,
- HTTP framework request/response kecuali memang web API,
- concrete cache class,
- concrete messaging client,
- concrete JSON library type,
- framework-specific implementation type.

---

## 10. Anti-Pattern 8 — Static Singleton Abuse

### Gejala

```java
public final class ServiceLocator {
    public static CaseService caseService;
}
```

Atau:

```java
public class GlobalRegistry {
    private static final Map<String, Object> SERVICES = new HashMap<>();
}
```

### Kenapa berbahaya di OSGi

Static state terikat pada classloader bundle.

Saat bundle di-update/refresh:

- old classloader bisa tetap tertahan,
- service lama tetap direferensikan,
- memory leak muncul,
- behavior campur antara versi lama dan baru,
- hot update menjadi tidak aman.

### Gejala production

- memory/metaspace naik setelah setiap redeploy,
- old implementation masih dipanggil,
- `ClassCastException` setelah update,
- cleanup tidak berjalan,
- service unregister tetapi masih dipakai thread lain.

### Desain benar

Gunakan DS injection dan lifecycle cleanup.

```java
@Component(service = CaseProcessor.class)
public class DefaultCaseProcessor implements CaseProcessor {
    private final AtomicReference<RuleEngine> engine = new AtomicReference<>();

    @Reference
    void bindRuleEngine(RuleEngine next) {
        engine.set(next);
    }

    void unbindRuleEngine(RuleEngine old) {
        engine.compareAndSet(old, null);
    }
}
```

### Recovery

1. Cari static mutable fields.
2. Bedakan constant immutable vs runtime reference.
3. Hilangkan service references dari static state.
4. Tambahkan cleanup di `@Deactivate`.
5. Tambahkan update/refresh leak test.

---

## 11. Anti-Pattern 9 — Caching Service Object Forever

### Contoh buruk

```java
ServiceReference<RuleEngine> ref = context.getServiceReference(RuleEngine.class);
RuleEngine engine = context.getService(ref);
// disimpan selamanya
```

### Kenapa berbahaya

Service OSGi bisa hilang, diganti, atau unregister.

Jika object disimpan tanpa track lifecycle:

- consumer memanggil service yang sudah tidak valid,
- provider classloader tertahan,
- update provider tidak efektif,
- memory leak,
- runtime behavior stale.

### Desain benar

Gunakan Declarative Services atau `ServiceTracker` dengan cleanup.

Untuk multiple service:

```java
private final AtomicReference<List<Rule>> rules = new AtomicReference<>(List.of());

@Reference(cardinality = ReferenceCardinality.MULTIPLE, policy = ReferencePolicy.DYNAMIC)
void addRule(Rule rule, Map<String, Object> props) {
    updateSnapshot();
}

void removeRule(Rule rule, Map<String, Object> props) {
    updateSnapshot();
}
```

Prinsip:

- jangan simpan reference tanpa lifecycle,
- jangan assume service selalu ada,
- gunakan snapshot immutable untuk concurrent read,
- release reference saat deactivate.

---

## 12. Anti-Pattern 10 — Blocking Activation

### Contoh buruk

```java
@Activate
void activate() {
    migrateDatabase();
    callRemoteSystem();
    warmUpAllCaches();
    generateAllReports();
}
```

### Kenapa berbahaya

Activation seharusnya membuat component siap secara cepat dan aman. Jika activation melakukan pekerjaan berat:

- startup lambat,
- SCR thread tertahan,
- dependency lain menunggu,
- failure startup sulit didiagnosis,
- readiness tidak jelas,
- retry kacau.

### Desain benar

Activation:

- validasi config,
- inisialisasi resource lokal,
- register readiness state,
- start background worker bila perlu,
- tidak melakukan blocking remote call panjang.

Contoh:

```java
@Activate
void activate(Config config) {
    this.config = validate(config);
    this.state.set(State.STARTING);
    worker.submit(this::warmUpSafely);
}
```

Readiness harus terpisah dari `ACTIVE`.

```java
public boolean isReady() {
    return state.get() == State.READY;
}
```

### Recovery

1. Profiling activation time per component.
2. Pindahkan pekerjaan berat ke background task.
3. Tambahkan timeout.
4. Tambahkan health/readiness service.
5. Pastikan deactivate bisa menghentikan task.

---

## 13. Anti-Pattern 11 — Circular Declarative Services Dependencies

### Contoh

```text
CaseService -> RuleService -> NotificationService -> CaseService
```

Dengan mandatory static references, SCR tidak bisa satisfy graph.

### Gejala

- component unsatisfied,
- activation tidak pernah terjadi,
- startup order tampak random,
- developer menaikkan start level untuk “memperbaiki”, tetapi masalah tetap ada.

### Penyebab desain

Circular dependency biasanya menunjukkan boundary salah:

- service terlalu besar,
- command/query tercampur,
- event seharusnya digunakan,
- dependency direction tidak jelas,
- orchestration logic tersebar.

### Cara memecah

Pilihan 1 — extract API kecil:

```text
CaseQueryService <- RuleService
CaseCommandService -> RuleService
```

Pilihan 2 — gunakan event untuk notification:

```text
CaseService publishes CaseSubmittedEvent
NotificationService handles event
```

Pilihan 3 — gunakan orchestrator:

```text
CaseWorkflowOrchestrator -> CaseService
CaseWorkflowOrchestrator -> RuleService
CaseWorkflowOrchestrator -> NotificationService
```

### Rule

Jangan menyelesaikan circular dependency dengan optional reference palsu. Itu hanya memindahkan masalah dari resolve-time ke runtime.

---

## 14. Anti-Pattern 12 — Overusing Service Registry as Service Locator

### Gejala

```java
Object service = context.getService(context.getServiceReference(name));
```

Dipakai di mana-mana.

### Kenapa berbahaya

Service registry memang registry, tetapi aplikasi tidak boleh berubah menjadi lookup soup.

Masalah:

- dependency tersembunyi,
- test sulit,
- contract tidak jelas,
- lifecycle tidak terkendali,
- concurrency sulit,
- resolver tidak membantu.

### Desain lebih baik

- Gunakan DS untuk dependency utama.
- Gunakan service lookup manual hanya untuk infrastructure khusus.
- Gunakan typed service interface.
- Gunakan target filter untuk selection.
- Gunakan registry pattern yang controlled untuk plugin list.

---

## 15. Anti-Pattern 13 — Bundle Granularity Salah

### Terlalu besar

Satu bundle berisi:

- API,
- implementation,
- web,
- persistence,
- scheduler,
- migration,
- plugin host,
- connector eksternal.

Akibat:

- update kecil refresh besar,
- API/internal boundary tidak jelas,
- testing sulit,
- dependency graph besar,
- modularity palsu.

### Terlalu kecil

Setiap class dibuat bundle.

Akibat:

- resolver graph besar,
- startup lambat,
- service churn tinggi,
- operational noise,
- build/deploy overhead,
- debugging sulit.

### Heuristik granularity

Buat bundle jika ada perbedaan nyata dalam:

- lifecycle,
- versioning,
- ownership,
- deployment cadence,
- dependency set,
- public contract,
- optionality,
- security/trust level.

Jangan buat bundle hanya karena package berbeda.

---

## 16. Anti-Pattern 14 — “Common Bundle” Menjadi God Bundle

### Gejala

```text
com.example.common
```

Berisi:

- DTO,
- utility,
- exception,
- constants,
- validation,
- JPA helper,
- JSON mapper,
- security helper,
- HTTP helper,
- date helper,
- random static singleton.

Semua bundle bergantung padanya.

### Kenapa berbahaya

God common bundle membuat modularity collapse.

- semua dependency menjadi transitive secara konseptual,
- update common berdampak semua runtime,
- internal detail menyebar,
- versioning sulit,
- boundary domain kabur.

### Desain lebih sehat

Pecah berdasarkan contract:

```text
com.example.base.types
com.example.error.api
com.example.validation.api
com.example.security.api
com.example.json.support
com.example.time.support
```

Utility internal tetap private di bundle masing-masing.

Rule:

> Shared code harus lebih stabil daripada konsumennya. Jika tidak stabil, jangan jadikan common.

---

## 17. Anti-Pattern 15 — Version Range Terlalu Luas

### Contoh buruk

```properties
Import-Package: com.example.case.api;version="[1.0,999)"
```

Atau tidak ada version range sama sekali.

### Risiko

- consumer bisa wired ke major version incompatible,
- bug muncul setelah deployment repository berubah,
- rollback tidak deterministic,
- resolver memilih provider yang tidak diuji.

### Desain lebih baik

Untuk consumer API biasa:

```properties
Import-Package: com.example.case.api;version="[1.4,2)"
```

Artinya:

- minimal butuh 1.4,
- compatible dengan minor/micro berikutnya,
- tidak menerima major 2 karena diasumsikan breaking.

---

## 18. Anti-Pattern 16 — Version Range Terlalu Sempit

### Contoh buruk

```properties
Import-Package: com.example.case.api;version="[1.4.2,1.4.2]"
```

### Risiko

- patch compatible tidak bisa dipakai,
- resolver gagal tanpa alasan bisnis,
- deployment terlalu fragile,
- upgrade kecil butuh rebuild banyak bundle.

### Prinsip

Gunakan range berdasarkan semantic compatibility, bukan exact artifact version.

Exact range hanya untuk:

- bug workaround sangat spesifik,
- native integration sensitif,
- generated protocol yang harus lockstep,
- temporary containment.

---

## 19. Anti-Pattern 17 — Tidak Ada Baseline Checking

### Gejala

Developer mengubah API:

```java
public interface Rule {
    boolean applies(Case c);
}
```

Menjadi:

```java
public interface Rule {
    Decision applies(Case c);
}
```

Tetapi package version tetap:

```properties
Export-Package: com.example.rule.api;version="1.2.0"
```

### Akibat

Consumer lama masih menganggap compatible. Runtime bisa gagal dengan:

- linkage error,
- `NoSuchMethodError`,
- behavior mismatch,
- plugin crash.

### Baseline sebagai safety gate

bnd baseline membandingkan bundle baru dengan baseline lama untuk mendeteksi perubahan API yang tidak sesuai semantic version.

Baseline bukan formalitas. Di OSGi, baseline adalah **runtime compatibility firewall**.

### Policy CI

- API breaking change tanpa major bump = fail.
- API additive change tanpa minor bump = fail/warn sesuai policy.
- Implementation-only change dengan micro bump = OK.
- Export package tanpa version = fail.
- Wildcard export = fail.

---

## 20. Anti-Pattern 18 — Ignoring `uses:=` Constraint

### Apa masalahnya

`uses:=` menjaga agar tipe yang dipakai dalam API berasal dari package provider yang konsisten.

Contoh:

```java
package com.example.report.api;

import com.example.document.api.Document;

public interface ReportService {
    Report generate(Document document);
}
```

Jika `report.api` export memakai `document.api`, resolver harus memastikan consumer melihat `document.api` yang sama.

### Anti-pattern

Developer melihat error `uses constraint violation`, lalu mencoba:

- optional import,
- dynamic import,
- embed dependency,
- remove metadata,
- force start order.

Ini salah. `uses` violation adalah sinyal bahwa type universe tidak konsisten.

### Cara berpikir

Jika dua bundle berkomunikasi memakai tipe yang sama, mereka harus wired ke exporter package yang sama.

### Recovery

1. Identifikasi package API yang muncul di signature.
2. Pastikan semua provider/consumer memakai version range compatible.
3. Hilangkan duplicate exporter.
4. Hindari embedding API package di implementation bundle.
5. Pisahkan API bundle canonical.

---

## 21. Anti-Pattern 19 — Embedding Dependencies Blindly

### Gejala

Setiap bundle membawa dependency sendiri:

```text
case-service.jar embeds jackson-2.13
report-service.jar embeds jackson-2.15
plugin-a.jar embeds jackson-2.12
plugin-b.jar embeds jackson-2.17
```

### Kapan embed masuk akal

Embedding bisa benar jika:

- library benar-benar private,
- tidak muncul di API signature,
- tidak perlu sharing service/provider,
- tidak melakukan global registration,
- tidak punya static singleton cross-bundle,
- tidak perlu discovery dari bundle lain.

### Kapan berbahaya

Embedding buruk jika library:

- expose tipe di API,
- punya SPI/ServiceLoader,
- punya global cache,
- melakukan annotation scanning,
- perlu shared provider,
- punya native library,
- berinteraksi dengan framework global.

### Rule

Jika tipe library muncul di exported package, library itu bukan private dependency.

---

## 22. Anti-Pattern 20 — TCCL Hacks Everywhere

### Gejala

```java
Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
```

Dipakai di banyak tempat untuk memperbaiki:

- JAXB,
- JPA,
- JSON provider,
- ServiceLoader,
- scripting,
- logging,
- annotation scanning.

### Kenapa berbahaya

TCCL adalah global-ish per-thread state. Jika tidak dipulihkan:

- classloader leak,
- library memuat class dari bundle salah,
- thread pool membawa TCCL lama,
- update/refresh tidak bersih.

### Pola aman

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(target);
    return operation.call();
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Gunakan di adapter layer, bukan menyebar ke domain code.

### Recovery

1. Cari semua `setContextClassLoader`.
2. Bungkus dengan utility safe scope.
3. Pindahkan ke integration adapter.
4. Tambahkan test update/refresh dan thread pool cleanup.

---

## 23. Anti-Pattern 21 — Annotation Scanning Without OSGi Awareness

### Masalah

Banyak framework Java mengasumsikan:

- semua class ada di classpath,
- bisa scan semua package,
- bisa load class secara bebas,
- bisa pakai TCCL.

Di OSGi asumsi ini salah.

### Gejala

- JAX-RS resource tidak ditemukan,
- entity JPA tidak discan,
- JSON provider tidak terdaftar,
- validation annotation tidak aktif,
- CDI bean tidak muncul,
- startup lambat karena scan gagal berulang.

### Desain benar

- Gunakan whiteboard/extender metadata.
- Register service secara eksplisit.
- Gunakan generated metadata saat build.
- Hindari classpath scanning global.
- Buat adapter bundle untuk framework yang butuh scanning.

---

## 24. Anti-Pattern 22 — Hot Deploy Tanpa State Strategy

### Gejala

Tim bangga:

> “OSGi bisa update bundle tanpa restart.”

Tetapi tidak punya jawaban untuk:

- thread lama masih jalan atau tidak,
- request in-flight dikuras atau tidak,
- service lama sudah unregister atau belum,
- classloader lama masih direferensikan atau tidak,
- config migration terjadi kapan,
- transaction in-flight bagaimana,
- rollback bagaimana.

### Realita

Hot update adalah operasi stateful.

Jika bundle stateless kecil, update bisa mudah. Jika bundle punya:

- thread,
- cache,
- DB transaction,
- scheduler,
- messaging consumer,
- web endpoint,
- native resource,
- file handle,
- service references,

maka update harus punya drain/stop/rebind strategy.

### Pola aman

1. Mark component as draining.
2. Stop accepting new work.
3. Wait bounded time for in-flight work.
4. Unregister service.
5. Stop worker/thread.
6. Close resources.
7. Release service references.
8. Update bundle.
9. Refresh affected wiring.
10. Activate new version.
11. Run readiness check.

---

## 25. Anti-Pattern 23 — Misusing Start Level as Dependency Management

### Gejala

Bundle gagal karena service belum ada. Solusi tim:

```text
Naikkan start level dependency dulu.
```

### Kenapa salah

Start level mengontrol urutan start, bukan dependency correctness.

OSGi service adalah dynamic. Bahkan jika service start lebih dulu, service bisa hilang setelah itu.

Jika component membutuhkan service, gunakan:

- DS mandatory reference,
- capability requirement,
- readiness check,
- lifecycle-aware binding.

Start level cocok untuk coarse boot phases, bukan dependency injection manual.

---

## 26. Anti-Pattern 24 — Assuming `ACTIVE` Means Ready

### Gejala

Monitoring hanya cek:

```text
bundle state = ACTIVE
```

Lalu menyatakan aplikasi sehat.

### Kenapa salah

Bundle bisa `ACTIVE` tetapi:

- DS component unsatisfied,
- config invalid,
- service belum registered,
- DB disconnected,
- HTTP endpoint tidak terdaftar,
- background worker gagal,
- cache belum warm,
- plugin mandatory tidak ada.

### Readiness yang benar

Readiness harus berbasis capability nyata:

```text
Can this runtime serve this operation now?
```

Indikator:

- critical bundles resolved/active,
- critical DS components active,
- required services registered,
- config valid,
- DB/broker reachable jika wajib,
- HTTP endpoints registered,
- no unresolved mandatory plugins,
- migration complete.

---

## 27. Anti-Pattern 25 — Configuration as Untyped String Bag

### Gejala

```java
String timeout = (String) props.get("timeout");
String enabled = (String) props.get("enabled");
```

Tidak ada schema, default, validation, atau versioning.

### Risiko

- typo silently ignored,
- invalid config membuat component crash,
- update config partial,
- rollback sulit,
- audit tidak jelas,
- secret value masuk log.

### Desain benar

Gunakan Metatype/typed config:

```java
@ObjectClassDefinition
@interface RuleEngineConfig {
    int timeoutMillis() default 2000;
    boolean enabled() default true;
    String policyVersion();
}
```

Validasi saat activation/modified.

Config adalah contract, bukan map bebas.

---

## 28. Anti-Pattern 26 — Secret as Plain Configuration

### Gejala

Config Admin berisi:

```properties
password=SuperSecret123
clientSecret=abc
```

Lalu:

- muncul di file,
- muncul di log,
- muncul di console,
- ikut backup,
- bisa dibaca operator yang tidak perlu.

### Desain lebih aman

Config menyimpan reference:

```properties
credentialRef=ssm:/prod/payment/client-secret
```

Secret resolver service mengambil secret dari vault/parameter store.

API:

```java
public interface SecretResolver {
    SecretValue resolve(String reference);
}
```

Rule:

- secret tidak diexport sebagai service property,
- secret tidak muncul di exception message,
- secret tidak disimpan di DTO/log,
- rotation didukung.

---

## 29. Anti-Pattern 27 — Event Admin as Everything Bus

### Gejala

Semua komunikasi antar module lewat Event Admin:

- command,
- query,
- transaction,
- audit,
- validation,
- notification,
- integration event.

### Kenapa berbahaya

Event Admin in-process bukan message broker enterprise.

Risiko:

- no durable delivery by default,
- backpressure terbatas,
- ordering tidak selalu sesuai asumsi,
- error handling sulit,
- transaction boundary kabur,
- event storm,
- debugging causal chain sulit.

### Desain benar

Gunakan:

- service call untuk synchronous command/query,
- Event Admin untuk in-process notification ringan,
- external broker untuk durable integration,
- outbox untuk DB transaction + event publishing.

---

## 30. Anti-Pattern 28 — Framework-Specific Lock-In Accidentally

### Gejala

Kode domain bergantung langsung pada:

- Felix classes,
- Equinox internal API,
- Karaf shell API,
- p2 internal model,
- SCR implementation detail.

### Kenapa berbahaya

OSGi memberi portability, tetapi implementation-specific dependency merusaknya.

Lock-in bisa disengaja dan valid jika ada ADR. Yang buruk adalah lock-in tidak sadar.

### Rule

- Domain bundle hanya bergantung pada OSGi standard API atau domain API.
- Runtime adapter boleh bergantung pada Felix/Karaf/Equinox.
- Semua implementation-specific dependency harus berada di bundle `*.runtime.*` atau `*.adapter.*`.
- Buat ADR jika memilih vendor-specific feature.

---

## 31. Anti-Pattern 29 — No Runtime Diagnostics Contract

### Gejala

Saat incident, tim hanya punya:

- log umum,
- stack trace,
- shell manual,
- restart runtime.

Tidak ada endpoint/command untuk:

- bundle state,
- DS state,
- service registry,
- config status,
- plugin health,
- resolver graph,
- startup timeline,
- failed activations.

### Dampak

MTTR tinggi. Tim menyalahkan OSGi karena “sulit”, padahal runtime tidak punya observability.

### Desain benar

Setiap platform OSGi production harus punya diagnostics contract:

```text
/health/live
/health/ready
/diagnostics/bundles
/diagnostics/components
/diagnostics/services
/diagnostics/plugins
/diagnostics/config
/diagnostics/wiring
```

Untuk environment sensitif, akses dibatasi dan output disanitasi.

---

## 32. Anti-Pattern 30 — No Ownership of API Bundles

### Gejala

API bundle dimiliki “semua orang”. Semua tim bisa mengubah.

Akibat:

- breaking change sembarangan,
- version bump tidak konsisten,
- package bercampur,
- deprecation tidak jelas,
- plugin vendor bingung.

### Policy sehat

Setiap API package punya:

- owner,
- semantic version policy,
- baseline check,
- deprecation policy,
- compatibility test,
- changelog,
- review gate.

Top-tier modular engineering sangat dekat dengan governance. Tanpa governance, modularity membusuk.

---

## 33. Anti-Pattern 31 — Plugin API Terlalu Dekat ke Domain Internal

### Contoh buruk

```java
public interface EnforcementPlugin {
    void execute(CaseEntity entity, EntityManager em, InternalWorkflowContext ctx);
}
```

Plugin langsung menerima:

- JPA entity,
- EntityManager,
- internal workflow context.

### Risiko

- plugin bisa corrupt state,
- transaction boundary kacau,
- internal model tidak bisa berubah,
- security review sulit,
- replay/audit sulit,
- plugin tidak portable.

### Desain lebih baik

```java
public interface EnforcementRulePlugin {
    RuleDecision evaluate(RuleEvaluationContext context);
}

public interface RuleEvaluationContext {
    CaseSnapshot caseSnapshot();
    ApplicantSnapshot applicant();
    List<PriorActionSnapshot> priorActions();
}
```

Plugin menerima snapshot immutable dan mengembalikan decision.

Host tetap mengontrol:

- persistence,
- transaction,
- audit,
- escalation,
- side effect.

---

## 34. Anti-Pattern 32 — Trusting OSGi as Strong Sandbox on Modern Java

### Masalah

Pada Java 8, banyak desain sandbox OSGi historis bergantung pada Java Security Manager. Pada Java modern, terutama Java 24/25, Security Manager tidak bisa lagi dijadikan basis sandbox kuat.

### Anti-pattern

Mengizinkan arbitrary third-party bundle masuk runtime yang sama dan berkata:

> “Aman, ini OSGi.”

Itu salah.

OSGi memberi modularity dan metadata. Itu bukan isolasi proses.

### Desain defensible

Untuk untrusted plugin:

- jalankan di process/container terpisah,
- gunakan gRPC/HTTP boundary,
- sandbox OS/container,
- resource quota,
- network policy,
- signature verification,
- certification test,
- repository admission,
- audit.

Untuk trusted plugin internal:

- OSGi in-process bisa sangat efektif,
- tetap butuh signing/governance,
- tetap butuh API boundary.

---

## 35. Anti-Pattern 33 — Ignoring Java 8 to 25 Runtime Differences

### Gejala

Bundle lama Java 8 langsung dijalankan di Java 21/25 tanpa audit.

Masalah umum:

- removed Java EE modules,
- strong encapsulation,
- illegal reflective access,
- old ASM/ByteBuddy/CGLIB,
- old JAXB/JAX-WS/Activation,
- `sun.misc.Unsafe`,
- Security Manager removal,
- TLS/security provider behavior,
- old OSGi framework version.

### Recovery playbook

1. Audit bytecode level.
2. Audit dependency versions.
3. Scan internal JDK API usage.
4. Replace removed Java EE modules with explicit dependencies.
5. Add needed `--add-opens` only as transitional workaround.
6. Upgrade OSGi framework/runtime.
7. Run resolver test on each target JDK.
8. Run in-framework smoke test.
9. Remove illegal reflective access progressively.
10. Document compatibility matrix.

---

## 36. Failure Mode Taxonomy

OSGi incidents lebih mudah di-debug jika diklasifikasi.

### 36.1 Build-time failure

Contoh:

- manifest salah,
- import tidak sesuai,
- DS XML tidak generated,
- baseline fail,
- duplicate package.

Solusi:

- bnd analysis,
- baseline check,
- split package check,
- manifest inspection.

### 36.2 Resolve-time failure

Contoh:

- missing package,
- incompatible version,
- missing capability,
- uses constraint violation.

Solusi:

- resolver report,
- wiring graph,
- repository metadata check,
- version range correction.

### 36.3 Start-time failure

Contoh:

- `BundleActivator` exception,
- DS activation exception,
- missing config,
- blocking activation timeout.

Solusi:

- SCR diagnostics,
- activation logs,
- config validation,
- start-level review.

### 36.4 Runtime service failure

Contoh:

- service disappears,
- stale reference,
- ranking changed,
- target filter no longer matches.

Solusi:

- service event log,
- DS component state,
- snapshot reference pattern,
- health-aware service selection.

### 36.5 Classloading failure

Contoh:

- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- `ClassCastException`,
- duplicate class,
- TCCL issue.

Solusi:

- inspect importing/exporting bundles,
- check class identity,
- remove split package,
- fix TCCL bridge.

### 36.6 Update/refresh failure

Contoh:

- old classes still used,
- memory leak,
- service stuck,
- refresh cascades unexpectedly.

Solusi:

- identify importers of exported package,
- drain services,
- release references,
- restart affected region/runtime if needed.

### 36.7 Architecture failure

Contoh:

- god common bundle,
- circular service dependency,
- plugin API exposes internals,
- all modules depend on all modules.

Solusi:

- API extraction,
- boundary redesign,
- dependency direction enforcement,
- migration roadmap.

---

## 37. OSGi Project Smell Catalog

Gunakan daftar ini saat review.

### Manifest smell

- `Export-Package: *`
- `Import-Package: *;resolution:=optional`
- `DynamicImport-Package: *`
- no package versions
- huge `Require-Bundle` list
- exported `.internal` package
- embedded API packages
- missing `uses:=` metadata due to manual manifest

### Bundle smell

- bundle terlalu besar
- bundle terlalu kecil
- bundle punya terlalu banyak responsibilities
- API dan impl bercampur
- domain code bergantung ke Felix/Karaf internal
- common bundle dipakai semua orang
- duplicate package antar bundle

### Service smell

- manual lookup tersebar
- static service reference
- no unget/cleanup
- circular mandatory references
- blocking activation
- dynamic reference tanpa thread safety
- service contract expose implementation type
- service ranking dipakai untuk business priority tanpa deterministic policy

### Configuration smell

- stringly typed config
- secret plain text
- no validation
- no config version
- config update restart semua component
- config changed tanpa audit

### Runtime smell

- readiness hanya bundle ACTIVE
- tidak ada diagnostics endpoint
- tidak ada resolver test
- hot deploy tanpa drain
- refresh dilakukan manual saat incident tanpa impact analysis
- framework cache tidak dipahami

### Governance smell

- no API owner
- no baseline
- no plugin certification
- no repository admission
- no compatibility matrix
- no deprecation policy
- no rollback plan

---

## 38. How to Recover a Failing OSGi Project

Jangan mulai dengan rewrite. Mulai dengan membuat runtime bisa dipahami.

### Phase 1 — Stabilize visibility

1. Dump bundle list.
2. Dump exported packages.
3. Dump unresolved bundles.
4. Dump DS unsatisfied components.
5. Dump service registry.
6. Dump framework wiring.
7. Dokumentasikan runtime topology.

Output phase ini:

```text
Kami tahu apa yang terinstall, apa yang resolved, siapa export apa, siapa import apa, service mana yang hidup, dan component mana yang gagal.
```

### Phase 2 — Stop the bleeding

1. Freeze wildcard export baru.
2. Freeze dynamic import wildcard baru.
3. Freeze optional import palsu baru.
4. Require baseline untuk API bundle.
5. Require resolver test untuk release.
6. Require owner untuk exported package baru.

Output:

```text
Kebusukan baru tidak bertambah.
```

### Phase 3 — Classify bundle boundary

Untuk setiap bundle:

- purpose,
- owner,
- exported packages,
- private packages,
- services provided,
- services consumed,
- lifecycle resources,
- config PID,
- deployment criticality.

Output:

```text
Bundle bukan lagi JAR random. Bundle punya peran.
```

### Phase 4 — Extract API bundles

Cari dependency paling banyak:

- common,
- case,
- workflow,
- validation,
- security,
- reporting.

Ekstrak API stabil:

```text
com.example.workflow.api
com.example.validation.api
com.example.security.api
```

Implementation pindah ke private package.

### Phase 5 — Fix service dynamics

1. Ganti service locator manual dengan DS.
2. Hilangkan static service reference.
3. Tambahkan deactivate cleanup.
4. Tambahkan snapshot pattern untuk multiple dynamic services.
5. Tambahkan health/readiness.

### Phase 6 — Fix deployment and rollback

1. Buat immutable distribution.
2. Lock repository versions.
3. Buat release manifest.
4. Buat smoke test clean cache.
5. Buat rollback runtime-level.
6. Stop ad-hoc production hot update kecuali ada runbook.

### Phase 7 — Add governance

1. API owner.
2. Versioning policy.
3. Deprecation policy.
4. Plugin certification.
5. Architecture decision records.
6. Operational runbooks.

---

## 39. Design Review Checklist

### Bundle review

- Apa responsibility bundle ini?
- Kenapa ini bundle terpisah?
- Apakah punya lifecycle berbeda?
- Apakah dependency set-nya masuk akal?
- Apakah ada package internal yang diexport?
- Apakah ada split package?
- Apakah ada embedded dependency yang bocor ke API?
- Apakah bundle bisa di-update tanpa restart penuh?

### API review

- Package API punya version?
- Owner jelas?
- DTO immutable?
- Implementation type bocor?
- Exception model stabil?
- Deprecation policy ada?
- Baseline check aktif?
- Consumer import range benar?

### Service review

- Service mandatory atau optional?
- Jika optional, fallback-nya apa?
- Thread-safety contract apa?
- Bisa hilang saat runtime?
- Consumer aman terhadap disappearance?
- Service ranking deterministic?
- Circular dependency ada?
- Activation cepat?

### Resolver review

- Import mandatory sudah benar?
- Optional import benar-benar optional?
- Dynamic import dibatasi?
- `uses:=` konsisten?
- Version range terlalu luas/sempit?
- Multiple exporter disengaja?
- Repository metadata lock?

### Operation review

- Readiness bukan sekadar ACTIVE?
- Diagnostics tersedia?
- Update runbook ada?
- Refresh impact diketahui?
- Rollback tested?
- Framework cache strategy jelas?
- Config/secrets aman?
- Logs cukup untuk wiring/service/config issue?

---

## 40. Case Study — Enforcement Plugin Platform yang Gagal

### Situasi awal

Sebuah platform enforcement memakai OSGi untuk plugin rule.

Struktur awal:

```text
common-bundle
case-bundle
workflow-bundle
rule-plugin-a
rule-plugin-b
notification-bundle
```

Masalah:

- `common-bundle` export semua package,
- plugin menerima JPA entity,
- plugin memakai `EntityManager`,
- semua import optional,
- dynamic import wildcard,
- no baseline,
- no plugin certification,
- hot deploy dilakukan langsung di PROD,
- readiness hanya cek ACTIVE,
- plugin old classloader tertahan setelah update.

### Incident

Plugin baru di-deploy. Bundle ACTIVE. Namun saat case tertentu diproses:

```text
ClassCastException: com.example.case.CaseEntity cannot be cast to com.example.case.CaseEntity
```

Penyebab:

- `CaseEntity` ada di dua classloader,
- plugin embed package case lama,
- host export package case baru,
- API bocor entity internal,
- no resolver test mendeteksi duplicate package,
- dynamic import membuat failure terlambat.

### Recovery

Langkah 1 — quarantine plugin.

```text
Disable plugin service registration.
Route case processing to safe fallback.
```

Langkah 2 — define API snapshot.

```java
public interface EnforcementRulePlugin {
    RuleDecision evaluate(RuleEvaluationContext context);
}
```

Langkah 3 — host controls persistence.

Plugin tidak lagi menerima `EntityManager` atau entity.

Langkah 4 — API bundle canonical.

```text
com.example.enforcement.rule.api
```

Langkah 5 — plugin certification.

Test wajib:

- resolve clean runtime,
- no embedded API duplicate,
- no internal package import,
- baseline compatible,
- service registers only with valid metadata,
- deactivate cleanup,
- no static service reference.

Langkah 6 — deployment policy.

Plugin tidak hot deploy langsung ke PROD tanpa:

- resolver report,
- smoke test,
- rollback package,
- impact analysis.

### Hasil desain baru

```text
enforcement-kernel
  exports stable SPI/API

case-service
  private persistence model
  exposes snapshot provider service

rule-plugin-a
  imports rule API only
  registers RulePlugin service

rule-runtime
  tracks plugin services
  validates metadata
  routes evaluation
  owns audit and persistence
```

Pelajaran:

> Plugin harus menerima contract, bukan internal state. OSGi memberi mekanisme modularity, tetapi governance menentukan apakah modularity itu aman.

---

## 41. Top 1% Heuristics

### Heuristic 1 — Every export is a public promise

Jika tidak siap menjaga compatibility, jangan export.

### Heuristic 2 — Optional dependency must have explicit behavior

Optional tanpa fallback adalah bug yang ditunda.

### Heuristic 3 — Dynamic import is a scalpel, not a hammer

Gunakan sempit, audit, dan isolasi.

### Heuristic 4 — `ACTIVE` is not readiness

Runtime sehat jika capability bisnis tersedia, bukan hanya bundle aktif.

### Heuristic 5 — Hot update is a state transition, not file replacement

Harus ada drain, cleanup, refresh, readiness, rollback.

### Heuristic 6 — Static mutable state is enemy of dynamic runtime

Static state membuat classloader lama bertahan.

### Heuristic 7 — Service registry is dynamic

Semua consumer harus tahan terhadap service arrival, departure, replacement.

### Heuristic 8 — API package should be boring

API bagus itu kecil, stabil, explicit, minim dependency, dan mudah diuji.

### Heuristic 9 — Resolver errors are design feedback

Jangan dimatikan dengan optional/dynamic import. Pahami constraint-nya.

### Heuristic 10 — OSGi does not replace architecture governance

Tanpa owner, versioning, review, dan test, OSGi hanya mempercepat kekacauan menjadi eksplisit.

---

## 42. Summary

OSGi project gagal biasanya bukan karena OSGi terlalu rumit, tetapi karena kompleksitas runtime yang sebelumnya tersembunyi menjadi eksplisit.

Anti-pattern paling merusak:

- memperlakukan OSGi seperti classpath,
- export semua package,
- import semua optional,
- dynamic import wildcard,
- require-bundle everywhere,
- split package,
- leaking implementation through API,
- static singleton/service reference,
- blocking activation,
- circular DS dependency,
- hot deploy tanpa state strategy,
- readiness hanya ACTIVE,
- no baseline,
- no diagnostics,
- no plugin governance.

OSGi yang sehat memiliki ciri:

- API kecil dan versioned,
- internal package private,
- import/export eksplisit,
- resolver test aktif,
- DS lifecycle bersih,
- service dynamics aman,
- config typed dan tervalidasi,
- deployment reproducible,
- readiness berbasis capability,
- plugin governance jelas,
- rollback dan diagnostics siap.

Mental model paling penting:

> OSGi bukan membuat sistem otomatis modular. OSGi memberi runtime yang memaksa modularity menjadi nyata. Jika kontraknya buruk, kegagalannya juga menjadi nyata.

---

## 43. Referensi

- OSGi Core Release 8 — Module Layer, Lifecycle Layer, Service Layer, Framework Namespaces.
- OSGi Compendium Release 8 — Declarative Services, Configuration Admin, Metatype, Event Admin.
- bnd/Bndtools documentation — baselining, resolver, bundle generation, testing.
- Apache Felix documentation — framework behavior, classloading FAQ, Gogo shell, SCR, FileInstall.
- Eclipse Equinox documentation — classloading, boot delegation, execution environments, p2 runtime.
- Apache Karaf documentation — features, provisioning, runtime operation, shell diagnostics.
- OpenJDK Java 9–25 migration materials — JPMS, strong encapsulation, Security Manager deprecation/removal, runtime compatibility.
