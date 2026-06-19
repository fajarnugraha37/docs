# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-018

# Part 18 — Thymeleaf Performance, Caching, and Production Tuning

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Scope Java: Java 8 hingga Java 25  
> Fokus: Thymeleaf sebagai runtime rendering yang berada di latency path aplikasi web/enterprise.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa performa Thymeleaf bukan hanya tentang "template engine cepat atau lambat", tetapi tentang seluruh rendering path.
2. Mendesain konfigurasi cache Thymeleaf untuk development, test, staging, dan production.
3. Menjelaskan perbedaan biaya:
   - template resolution
   - template parsing
   - expression evaluation
   - fragment composition
   - model traversal
   - escaping
   - output writing
4. Menghindari bottleneck umum seperti large table rendering, N+1 query dari view, model terlalu besar, nested fragment berlebihan, dan inline JavaScript yang berat.
5. Menentukan kapan page harus di-render server-side, kapan harus dipaginate, kapan harus dipindahkan ke async/job, dan kapan SSR bukan pilihan tepat.
6. Membuat performance budget untuk halaman Thymeleaf.
7. Membuat observability untuk rendering Thymeleaf:
   - render latency
   - template cache effectiveness
   - page size
   - model size
   - query count per render
   - fragment complexity
8. Menyiapkan strategi load test dan profiling dengan JFR/JMH/observability stack.
9. Menghasilkan checklist production tuning yang bisa dipakai dalam code review dan architecture review.

---

## 2. Mental Model: Thymeleaf Berada di Critical Request Path

Pada aplikasi Spring MVC/Jakarta MVC tradisional, request path sering terlihat seperti ini:

```text
Browser
  -> HTTP request
  -> Filter chain / security
  -> Controller
  -> Service
  -> Repository / external API
  -> Model preparation
  -> Thymeleaf template resolution
  -> Template processing
  -> HTML response
  -> Browser parse/render
```

Thymeleaf hanya satu bagian dari jalur tersebut. Tetapi karena ia berada di ujung request path, semua kesalahan sebelum rendering sering terlihat seolah-olah "Thymeleaf lambat".

Contoh:

```text
Halaman lambat 2.8 detik
```

Belum tentu penyebabnya template. Bisa jadi:

```text
DB query               1800 ms
External API            500 ms
Model mapping           120 ms
Template rendering       80 ms
Network/browser         300 ms
```

Atau bisa sebaliknya:

```text
DB query                 40 ms
Model mapping            20 ms
Template rendering     1200 ms
HTML response huge       800 ms browser cost
```

Engineer yang kuat tidak langsung menyimpulkan. Ia memecah latency.

### 2.1 Rendering bukan hanya engine

Thymeleaf performance dipengaruhi oleh:

| Area | Pertanyaan utama |
|---|---|
| Template resolver | Bagaimana template ditemukan? Classpath? File? Servlet context? Remote? |
| Template cache | Apakah parsed template di-cache? TTL? cache disabled? |
| Expression evaluation | Apakah template banyak mengevaluasi expression kompleks? |
| Fragment composition | Apakah halaman memanggil banyak fragment nested? |
| Model shape | Apakah model sudah siap render, atau template masih menghitung? |
| Data access | Apakah template memicu lazy loading/N+1? |
| Output size | Apakah HTML terlalu besar? |
| Escaping/inlining | Apakah banyak inline JS/CSS/string escaping? |
| Browser cost | Apakah DOM terlalu besar walaupun server cepat? |
| Network | Apakah response besar, compression mati, asset tidak di-cache? |

### 2.2 Prinsip utama

```text
Fast Thymeleaf page = prepared model + cached template + bounded output + cheap expressions + no hidden I/O.
```

Jika disederhanakan:

```text
Performance = cache discipline + model discipline + output discipline
```

---

## 3. Apa yang Sebenarnya Di-cache oleh Thymeleaf?

Thymeleaf memiliki `TemplateEngine`. Di dalamnya terdapat resolver, dialect, processor, expression evaluator, dan cache manager.

Dokumentasi API Thymeleaf menjelaskan bahwa cache manager menyediakan cache object untuk setidaknya parsed templates dan parsed expressions. Secara default Thymeleaf memakai `StandardCacheManager`, dan jika cache manager dibuat `null`, cache tidak digunakan.

Secara mental model:

```text
Request A: render "users/list"
  -> resolve template path
  -> read template file/resource
  -> parse template into internal representation
  -> cache parsed template
  -> evaluate model
  -> output HTML

Request B: render "users/list"
  -> resolve template path
  -> get parsed template from cache
  -> evaluate model
  -> output HTML
```

Yang di-cache bukan HTML final per user, tetapi struktur template yang sudah diproses/diparse.

### 3.1 Template cache bukan page cache

Template cache:

```text
cache template definition / parsed representation
```

Page cache:

```text
cache rendered HTML output
```

Perbedaannya sangat penting.

Template cache aman untuk halaman dinamis karena data user tetap dievaluasi ulang.

Page cache berisiko jika tidak mempertimbangkan:

- user identity
- role
- tenant
- locale
- CSRF token
- personalization
- permission state
- draft/published status

### 3.2 Cache default

Di konfigurasi umum Thymeleaf/Spring, template cache biasanya aktif di production. Spring Boot juga menyediakan properti `spring.thymeleaf.cache` untuk mengaktifkan/menonaktifkan template caching.

Production:

```properties
spring.thymeleaf.cache=true
```

Development:

```properties
spring.thymeleaf.cache=false
```

Tetapi jangan salah paham: `cache=false` di development membantu template reload, bukan strategi production.

---

## 4. Development vs Production Cache Strategy

### 4.1 Development

Di development, prioritasnya feedback cepat.

```properties
spring.thymeleaf.cache=false
spring.thymeleaf.prefix=classpath:/templates/
spring.thymeleaf.suffix=.html
```

Tujuan:

- edit template
- refresh browser
- lihat perubahan tanpa restart penuh

Tetapi konsekuensinya:

- setiap request bisa membaca/parse ulang template
- latency development tidak representatif
- benchmark dengan cache disabled adalah benchmark yang salah untuk production

### 4.2 Production

Di production, prioritasnya stability dan throughput.

```properties
spring.thymeleaf.cache=true
spring.thymeleaf.encoding=UTF-8
```

Tujuan:

- hindari parse template berulang
- minimalkan filesystem/classpath lookup
- stabilkan latency
- mengurangi allocation

### 4.3 Staging/performance test

Staging untuk performance test harus menyerupai production:

```properties
spring.thymeleaf.cache=true
```

Jika staging memakai cache disabled, hasil load test akan bias.

### 4.4 UAT dengan template sering berubah

Kadang UAT ingin template reload tanpa redeploy. Ini harus diputuskan eksplisit:

| Pilihan | Kelebihan | Risiko |
|---|---|---|
| Cache aktif seperti production | hasil lebih realistis | perubahan template perlu redeploy/restart |
| Cache disabled | cepat validasi perubahan | latency tidak realistis |
| External template store + TTL | fleksibel | kompleksitas, invalidation, governance |
| Admin publish + cache eviction | enterprise-grade | perlu sistem template management |

Untuk sistem enterprise, jangan hanya mematikan cache demi kenyamanan. Buat mekanisme publish/invalidate yang jelas.

---

## 5. Template Resolver Performance

Template resolver bertugas mengubah nama template seperti:

```java
return "case/detail";
```

menjadi resource aktual, misalnya:

```text
classpath:/templates/case/detail.html
```

### 5.1 Resolver umum

| Resolver | Cocok untuk | Catatan performa |
|---|---|---|
| ClassLoaderTemplateResolver | packaged templates dalam JAR | stabil, production-friendly |
| FileTemplateResolver | external file templates | baik untuk reload/admin-managed, perlu governance |
| ServletContextTemplateResolver | WAR/servlet context | legacy/container-based deployment |
| StringTemplateResolver | template dari string | default-nya sering tidak cacheable karena string arbitrary |
| Custom resolver | DB/S3/CMS/template repository | harus hati-hati cache, latency, fallback |

### 5.2 Classpath templates

Classpath templates cocok untuk application-owned templates:

```text
src/main/resources/templates/
```

Kelebihan:

- immutable bersama release artifact
- mudah diuji di CI
- mudah rollback via deployment rollback
- aman dari runtime editing liar
- cache efektif

Kekurangan:

- perubahan template perlu redeploy
- kurang cocok untuk business-owned template dinamis

### 5.3 File/database/external template store

Cocok untuk:

- tenant-specific template
- correspondence template
- email/legal document template
- template yang butuh approval workflow

Tetapi performance risk-nya lebih besar:

```text
Request -> template resolver -> DB/S3/filesystem -> parse -> render
```

Jika tidak di-cache, ini berbahaya.

Production pattern:

```text
Template repository
  -> publish version
  -> warm cache
  -> render using published immutable version
```

Jangan membaca template dari DB pada setiap request tanpa cache.

### 5.4 Resolver chain

Kadang aplikasi memakai banyak resolver:

```text
1. tenant override resolver
2. application classpath resolver
3. fallback shared resolver
```

Ini fleksibel, tetapi setiap resolver lookup memiliki biaya. Gunakan pattern dan order yang ketat.

Contoh:

```text
tenant/acme/case/detail.html
shared/case/detail.html
```

Jangan membuat resolver chain ambigu seperti:

```text
try 12 locations for every request
```

### 5.5 Resolver existence checks

Spring Boot memiliki properti seperti `spring.thymeleaf.check-template` dan `spring.thymeleaf.check-template-location`. Ini berguna untuk validasi, tetapi perlu dipahami dampaknya pada startup/rendering tergantung setup.

Production rule:

```text
Validasi template existence lebih baik dilakukan di startup/CI/publish pipeline,
bukan mengandalkan runtime failure di request user.
```

---

## 6. Template Cache Tuning

### 6.1 Apa yang harus di-cache?

Pada production normal:

```text
HTML templates        cacheable
fragments             cacheable
layout templates      cacheable
email templates       cacheable jika application-owned
admin dynamic draft   biasanya tidak cacheable atau cache TTL pendek
published dynamic     cacheable dengan explicit version key
```

### 6.2 Cache TTL

Jika template immutable bersama release artifact, TTL bisa panjang atau tidak perlu TTL pendek.

Jika template eksternal berubah, kamu perlu salah satu:

1. cache TTL
2. explicit cache eviction
3. versioned template names
4. publish event invalidation

Pattern terbaik untuk enterprise:

```text
Template ID: CASE_REJECTION_LETTER
Version: 7
Effective from: 2026-06-01
Resolved cache key: CASE_REJECTION_LETTER:v7:en-SG
```

Dengan ini, kamu tidak perlu menebak TTL. Perubahan template menghasilkan version key baru.

### 6.3 Jangan rely pada timestamp filesystem untuk governance

Timestamp checking cocok untuk development, bukan governance enterprise.

Masalah timestamp:

- clock skew
- container image immutable
- distributed nodes tidak sinkron
- NFS/object storage consistency
- sulit audit siapa mengubah apa

Governance lebih baik:

```text
draft -> reviewed -> approved -> published immutable version
```

### 6.4 Cache invalidation

Cache invalidation harus punya trigger jelas:

```text
TemplatePublishedEvent(templateId, version, locale, tenant)
  -> evict old preview cache
  -> warm published cache
  -> update active version mapping
```

Jangan membuat admin klik "save" langsung mempengaruhi semua request production tanpa status publish.

---

## 7. Expression Evaluation Cost

Thymeleaf template terlihat deklaratif, tetapi setiap ekspresi punya biaya.

Contoh:

```html
<span th:text="${case.applicant.profile.address.city}">City</span>
```

Ini bisa melibatkan:

- variable lookup
- property access
- reflection/accessor/cache
- null/safe navigation handling
- conversion
- escaping
- output write

Satu ekspresi murah. Ribuan ekspresi di table besar bisa mahal.

### 7.1 Ekspresi sederhana vs kompleks

Baik:

```html
<span th:text="${row.displayStatus}">Approved</span>
```

Buruk:

```html
<span th:text="${row.status == 'APPROVED' ? #temporals.format(row.approvedAt, 'dd MMM yyyy') + ' by ' + row.approver.name : row.pendingReason ?: 'N/A'}"></span>
```

Masalah:

- sulit dibaca
- sulit dites
- logic tersembunyi di template
- property traversal banyak
- branch sulit diprofiling

Lebih baik:

```java
record CaseRowView(
    String displayStatus,
    String displayApprovedInfo,
    boolean hasApprovedInfo
) {}
```

Template:

```html
<span th:text="${row.displayStatus}"></span>
<span th:if="${row.hasApprovedInfo}" th:text="${row.displayApprovedInfo}"></span>
```

### 7.2 Utility object tidak gratis

Thymeleaf punya utility objects seperti:

```text
#dates
#temporals
#numbers
#strings
#lists
#maps
```

Ini berguna, tetapi jangan pakai berlebihan untuk transformasi besar.

Contoh buruk:

```html
<tr th:each="row : ${rows}">
  <td th:text="${#strings.toUpperCase(row.name)}"></td>
  <td th:text="${#numbers.formatDecimal(row.amount, 1, 2)}"></td>
  <td th:text="${#temporals.format(row.createdAt, 'dd/MM/yyyy HH:mm')}"></td>
</tr>
```

Jika `rows` berisi 5000 item, formatting dilakukan ribuan kali saat render.

Lebih baik:

```java
record RowView(
    String displayName,
    String displayAmount,
    String displayCreatedAt
) {}
```

Rule:

```text
Formatting kecil boleh di template.
Formatting masif dalam loop besar lebih baik disiapkan di ViewModel.
```

### 7.3 Enable SpringEL compiler?

Spring Boot menyediakan `spring.thymeleaf.enable-spring-el-compiler`. Compiler ini dapat mempercepat ekspresi SpringEL dalam kondisi tertentu, tetapi tidak otomatis menjadi solusi semua bottleneck.

Pertimbangkan jika:

- banyak ekspresi dievaluasi berulang
- aplikasi CPU-bound di expression evaluation
- profiling menunjukkan SpEL overhead signifikan

Jangan aktifkan hanya karena "performance tuning checklist" tanpa profiling.

---

## 8. Fragment Complexity and Layout Cost

Fragment membuat template modular, tetapi fragment juga bisa menciptakan graph komposisi yang rumit.

Contoh sederhana:

```text
page
  -> layout
    -> header
    -> sidebar
    -> content
    -> footer
```

Ini sehat.

Contoh berbahaya:

```text
page
  -> layout
    -> sidebar
      -> menu
        -> permission-button
          -> tooltip
            -> icon
              -> i18n-label
    -> content
      -> card
        -> table
          -> table-row
            -> action-button
              -> modal
                -> form
                  -> field
                    -> error-block
```

Masalah bukan jumlah fragment semata, tetapi:

- dependency tidak terlihat
- parameter fragment terlalu banyak
- fragment memanggil fragment yang memanggil fragment lain
- sulit menemukan sumber output
- sulit melakukan profiling visual
- fragment melakukan authorization/expression kompleks per row

### 8.1 Fragment murah jika statis dan cacheable

Fragment seperti header/footer/layout murah jika template cache aktif.

Yang mahal:

```html
<tr th:each="row : ${rows}">
  <td th:replace="~{fragments/action-button :: button(${row})}"></td>
</tr>
```

Jika 1000 rows, fragment action-button diproses 1000 kali.

### 8.2 Component granularity

Jangan membuat fragment terlalu kecil untuk setiap atom HTML.

Terlalu kecil:

```text
icon fragment
label fragment
input wrapper fragment
help text fragment
error span fragment
```

Lebih sehat:

```text
form-field fragment
pagination fragment
table-actions fragment
empty-state fragment
```

### 8.3 Parameter shape

Buruk:

```html
<div th:replace="~{fragments/card :: card(${title}, ${subtitle}, ${icon}, ${variant}, ${url}, ${enabled}, ${role}, ${count}, ${footer})}"></div>
```

Lebih baik:

```java
record CardView(
    String title,
    String subtitle,
    String icon,
    String variant,
    String url,
    boolean enabled,
    String footer
) {}
```

Template:

```html
<div th:replace="~{fragments/card :: card(${card})}"></div>
```

---

## 9. Large Table Rendering

Large table adalah salah satu sumber performa buruk paling umum di SSR.

Contoh:

```html
<tr th:each="case : ${cases}">
  <td th:text="${case.referenceNo}"></td>
  <td th:text="${case.applicantName}"></td>
  <td th:text="${case.status}"></td>
  <td th:text="${#temporals.format(case.createdAt, 'dd MMM yyyy')}"></td>
  <td th:replace="~{fragments/actions :: caseActions(${case})}"></td>
</tr>
```

Jika `cases` berisi 10.000 row, masalahnya banyak:

- server render berat
- response HTML besar
- browser parse DOM berat
- layout/reflow berat
- memory browser tinggi
- user juga tidak membaca 10.000 row sekaligus

### 9.1 Pagination adalah performance feature

Pagination bukan sekadar UX.

```text
Server-side pagination membatasi:
- DB rows
- model size
- render work
- HTML size
- browser DOM size
```

Prinsip:

```text
Render what the user can consume.
```

Untuk admin portal:

```text
Default page size: 20/25/50
Max page size: 100/200 tergantung kasus
Export: async job, bukan table HTML raksasa
```

### 9.2 Sorting/filtering harus server-side untuk data besar

Untuk data kecil, client-side sorting bisa cukup.

Untuk enterprise case list:

```text
filter -> database query
sort -> indexed order
page -> limit/offset/keyset
render -> current page only
```

Jangan:

```text
load all cases -> render hidden table -> JS filter/sort
```

### 9.3 Keyset pagination

Untuk data besar, offset pagination bisa melambat.

Offset:

```sql
ORDER BY created_at DESC
OFFSET 50000 ROWS FETCH NEXT 50 ROWS ONLY
```

Keyset:

```sql
WHERE created_at < :lastSeenCreatedAt
ORDER BY created_at DESC
FETCH NEXT 50 ROWS ONLY
```

Thymeleaf hanya render view, tetapi keputusan pagination mempengaruhi render cost.

### 9.4 Action buttons per row

Action buttons sering memicu authorization check.

Buruk:

```html
<a th:if="${@permissionService.canApprove(user, case)}">Approve</a>
```

Masalah:

- service call dari template
- bisa memicu DB/API
- sulit diprofiling
- membuat view punya business dependency

Lebih baik:

```java
record CaseRowView(
    String referenceNo,
    String applicantName,
    String displayStatus,
    boolean canApprove,
    boolean canReject,
    boolean canView
) {}
```

Template:

```html
<a th:if="${row.canApprove}">Approve</a>
```

---

## 10. Avoiding N+1 Data Loading from Template Access

Salah satu anti-pattern paling mahal:

```html
<span th:text="${case.applicant.profile.address.postalCode}"></span>
```

Jika `case.applicant` lazy-loaded JPA relation, rendering bisa memicu query.

### 10.1 Kenapa ini berbahaya

Controller tampak sederhana:

```java
model.addAttribute("cases", caseRepository.findOpenCases());
return "case/list";
```

Template:

```html
<tr th:each="case : ${cases}">
  <td th:text="${case.applicant.name}"></td>
  <td th:text="${case.assignedOfficer.name}"></td>
  <td th:text="${case.latestDecision.reason}"></td>
</tr>
```

Yang terjadi:

```text
1 query for cases
+ N queries for applicants
+ N queries for officers
+ N queries for decisions
```

Akhirnya:

```text
1 + 3N queries
```

Jika N=100:

```text
301 queries
```

Template bukan tempat untuk membuka lazy graph.

### 10.2 Projection pattern

Gunakan projection/query DTO:

```java
public record CaseListRow(
    Long id,
    String referenceNo,
    String applicantName,
    String assignedOfficerName,
    String latestDecisionReason,
    String displayStatus,
    boolean canView,
    boolean canApprove
) {}
```

Repository:

```java
@Query("""
    select new com.example.caseui.CaseListRow(
        c.id,
        c.referenceNo,
        a.name,
        o.name,
        d.reason,
        c.status,
        false,
        false
    )
    from CaseEntity c
    join c.applicant a
    left join c.assignedOfficer o
    left join c.latestDecision d
    where c.status in :statuses
    order by c.createdAt desc
""")
Page<CaseListRow> findCaseListRows(...);
```

Lalu enrich permission di service:

```java
List<CaseListRowView> rows = rowsFromDb.stream()
    .map(row -> row.withPermissions(permissionPolicy.evaluate(user, row)))
    .toList();
```

Template hanya membaca field siap-render.

### 10.3 Open Session in View

Jika Open Session in View aktif, lazy loading dari template mungkin "berhasil", tetapi performanya buruk dan boundary-nya kabur.

Rule untuk sistem serius:

```text
A template must not depend on an open persistence context to complete rendering.
```

---

## 11. Model Shaping Before Rendering

Model shaping adalah proses mengubah domain data menjadi presentation data.

Domain object:

```java
class EnforcementCase {
    CaseStatus status;
    Applicant applicant;
    List<Decision> decisions;
    Instant createdAt;
}
```

View model:

```java
record CaseDetailView(
    String referenceNo,
    String displayStatus,
    String applicantName,
    String displayCreatedAt,
    List<TimelineItemView> timeline,
    ActionPanelView actions
) {}
```

### 11.1 Kenapa ViewModel meningkatkan performance

ViewModel:

- mengurangi property traversal
- mencegah lazy loading
- menyiapkan formatted values
- mengurangi branch di template
- mempermudah cache/serialization/debug
- memudahkan contract test

### 11.2 Preformatted vs raw value

Ada trade-off.

Raw value:

```java
Instant createdAt
BigDecimal amount
```

Template formatting:

```html
<span th:text="${#temporals.format(view.createdAt, 'dd MMM yyyy')}"></span>
```

Preformatted:

```java
String displayCreatedAt
String displayAmount
```

Template:

```html
<span th:text="${view.displayCreatedAt}"></span>
```

Pilihannya:

| Kondisi | Pilihan |
|---|---|
| Sedikit field, sederhana | formatting di template boleh |
| Banyak row/loop besar | preformat di Java |
| Regulatory document | preformat + record locale/timezone |
| Butuh sorting numeric/date di client | kirim raw + display value terpisah |

### 11.3 Model size budget

Buat batas model.

Contoh budget:

```text
Case list page:
- rows <= 50 default
- total fields per row <= 20
- no entity graph
- no binary/blob/base64
- no long audit text
- no nested collection except small action list
```

Case detail:

```text
- summary object
- timeline page <= 50 items
- attachments metadata only
- lazy tab for heavy sections
```

Jangan memasukkan semua domain aggregate ke model.

---

## 12. Output Size and Browser Cost

Server render selesai cepat bukan berarti page cepat.

Jika Thymeleaf menghasilkan HTML 5 MB, browser tetap harus:

- download
- decompress
- parse HTML
- build DOM
- load CSS/JS
- compute style
- layout
- paint
- attach event listeners

### 12.1 HTML size budget

Contoh budget praktis:

| Page type | HTML size target |
|---|---:|
| Simple form | < 100 KB |
| Admin list | < 300 KB |
| Complex dashboard | < 500 KB |
| Document preview | tergantung, tetapi harus lazy/print-aware |
| 2 MB+ HTML | warning besar |

Angka ini bukan hukum absolut, tetapi alarm.

### 12.2 Avoid hidden huge DOM

Buruk:

```html
<div th:each="modal : ${rowModals}" class="modal hidden">
  ...large form...
</div>
```

Jika 100 rows dan setiap row punya modal besar, DOM meledak.

Lebih baik:

```text
- render one generic modal
- fetch row detail on demand
- navigate to detail page
- use progressive enhancement
```

### 12.3 Inline data JSON

Buruk:

```html
<script th:inline="javascript">
  const allCases = [[${allCases}]];
</script>
```

Masalah:

- HTML besar
- escaping kompleks
- data leak risk
- duplicate data: table HTML + JSON
- parsing JS cost

Lebih baik:

```text
SSR current visible page only
API endpoint for additional interaction
```

---

## 13. Static Assets, CDN, and Cache Headers

Thymeleaf sering disalahkan untuk page lambat, padahal penyebabnya asset.

### 13.1 Jangan inline semua CSS/JS

Inline kecil boleh untuk critical CSS tertentu, tetapi jangan membuat template besar dengan script/style panjang.

Production pattern:

```text
HTML rendered by Thymeleaf
CSS/JS/images served as static assets
assets fingerprinted/versioned
browser cache long-lived
```

Contoh:

```html
<link rel="stylesheet" th:href="@{/assets/app.css}">
<script defer th:src="@{/assets/app.js}"></script>
```

Dengan build pipeline:

```text
app.4f3a91.css
app.88c12d.js
```

### 13.2 Cache headers

Static assets:

```text
Cache-Control: public, max-age=31536000, immutable
```

HTML dynamic:

```text
Cache-Control: no-store
```

atau untuk public page:

```text
Cache-Control: public, max-age=60
```

Jangan samakan cache policy HTML personal dengan static asset.

### 13.3 Compression

Aktifkan gzip/brotli di reverse proxy/CDN untuk HTML/CSS/JS.

Tetapi compression bukan alasan untuk render HTML raksasa.

---

## 14. SSR Latency Budget

Tanpa budget, performa menjadi opini.

Contoh budget untuk admin list page:

```text
Total server time P95: <= 300 ms
  security/filter:      <= 20 ms
  controller:           <= 10 ms
  DB query:             <= 120 ms
  model mapping:        <= 30 ms
  Thymeleaf rendering:  <= 60 ms
  serialization/write:  <= 20 ms
  margin:               <= 40 ms
```

Untuk page kompleks:

```text
Total server time P95: <= 700 ms
Thymeleaf rendering:   <= 150 ms
HTML size:             <= 500 KB
DB queries:            <= 10
```

Untuk regulatory document preview:

```text
Initial preview: <= 1500 ms P95
Generated PDF: async if > 2 seconds
```

### 14.1 P50, P95, P99

Jangan hanya lihat rata-rata.

```text
P50 = pengalaman normal
P95 = pengalaman mayoritas buruk
P99 = tail latency, sering muncul saat traffic/GC/DB spike
```

Template yang "biasanya cepat" tetapi P99 buruk bisa mengganggu operation.

### 14.2 Separate cold and warm performance

Cold:

```text
first render after startup/cache clear
```

Warm:

```text
render setelah template cache terisi
```

Production user biasanya mengalami warm path, tetapi startup/warmup juga penting untuk deployment.

---

## 15. Metrics yang Perlu Dikumpulkan

### 15.1 Render latency

Minimal:

```text
thymeleaf.render.duration
tags:
  template=case/list
  outcome=success|error
  locale=en_SG
  tenant=default|agencyA
```

Hati-hati cardinality. Jangan tag dengan user ID, case ID, atau template dynamic version yang terlalu banyak tanpa kontrol.

### 15.2 Template cache metrics

Ideal:

```text
template_cache_hit
usually via custom cache manager/instrumentation
```

Jika tidak mudah mendapatkan metrics internal, gunakan proxy metrics:

```text
cold render latency vs warm render latency
startup warmup result
number of template resolutions
```

### 15.3 Model metrics

Sangat berguna:

```text
model.row_count
model.approx_size
model.fragment_count maybe through convention
```

Contoh log structured:

```json
{
  "event": "view.rendered",
  "template": "case/list",
  "durationMs": 42,
  "rowCount": 50,
  "htmlBytes": 128430,
  "queryCount": 4,
  "locale": "en-SG"
}
```

### 15.4 Query count per render

Ini penting untuk mendeteksi N+1.

Dengan Hibernate statistics/P6Spy/datasource proxy, ukur:

```text
queries_per_request{template="case/list"}
```

Target:

```text
Case list page <= 5 query normal
Case detail page <= 10-20 depending complexity
```

### 15.5 HTML size

Tambahkan filter untuk mengukur response bytes.

```text
http.response.size{route="/cases"}
```

HTML size naik drastis sering berarti:

- loop terlalu besar
- hidden DOM
- inline JSON besar
- duplicated fragment
- unbounded text

---

## 16. Instrumentasi Rendering Service

Jika memakai Spring MVC ViewResolver langsung, instrumentation bisa lebih sulit. Untuk non-web render/email/document, buat service wrapper.

```java
public final class ThymeleafRenderingService {

    private final SpringTemplateEngine templateEngine;
    private final MeterRegistry meterRegistry;

    public ThymeleafRenderingService(
            SpringTemplateEngine templateEngine,
            MeterRegistry meterRegistry
    ) {
        this.templateEngine = templateEngine;
        this.meterRegistry = meterRegistry;
    }

    public String render(String templateName, Map<String, Object> model, Locale locale) {
        long start = System.nanoTime();
        String outcome = "success";

        try {
            Context context = new Context(locale);
            context.setVariables(model);
            return templateEngine.process(templateName, context);
        } catch (RuntimeException ex) {
            outcome = "error";
            throw ex;
        } finally {
            long durationNanos = System.nanoTime() - start;
            meterRegistry.timer(
                    "thymeleaf.render.duration",
                    "template", safeTemplateTag(templateName),
                    "outcome", outcome
            ).record(durationNanos, TimeUnit.NANOSECONDS);
        }
    }

    private static String safeTemplateTag(String templateName) {
        return templateName.replaceAll("[^a-zA-Z0-9/_-]", "_");
    }
}
```

Catatan:

- Jangan tag dengan nilai user input arbitrary.
- Jangan log full model.
- Jangan log PII.
- Untuk web MVC view rendering, bisa gunakan interceptor/filter dan route/template naming convention.

---

## 17. Startup Warmup

Jika halaman penting lambat pada request pertama karena template parsing/cache warmup, lakukan warmup.

Pattern:

```text
ApplicationReadyEvent
  -> render selected templates with sample model
  -> validate no missing template
  -> populate template cache
```

Contoh:

```java
@Component
class TemplateWarmup {

    private final ThymeleafRenderingService renderer;

    TemplateWarmup(ThymeleafRenderingService renderer) {
        this.renderer = renderer;
    }

    @EventListener(ApplicationReadyEvent.class)
    void warmUp() {
        renderer.render("case/list", SampleModels.caseList(), Locale.ENGLISH);
        renderer.render("case/detail", SampleModels.caseDetail(), Locale.ENGLISH);
        renderer.render("error/500", SampleModels.errorPage(), Locale.ENGLISH);
    }
}
```

Kapan warmup berguna:

- low-latency admin portal
- autoscaling sering membuat node baru
- template besar/kompleks
- serverless/container cold start

Kapan hati-hati:

- warmup terlalu banyak template memperlambat startup
- sample model tidak valid
- warmup memanggil DB/external service

Warmup harus memakai static sample model, bukan query production data.

---

## 18. Error Pages and Performance

Error page harus ringan.

Buruk:

```text
500 page
  -> full layout
  -> sidebar
  -> notifications count
  -> user profile
  -> recent cases
  -> dynamic menu permission
```

Saat sistem sedang error, error page tidak boleh menambah failure.

Baik:

```text
error/500.html
  -> minimal HTML
  -> static CSS only
  -> correlation ID
  -> no DB call
  -> no complex fragment
```

Rule:

```text
Error template must not depend on failing subsystems.
```

---

## 19. Async and Batch Rendering

Thymeleaf bisa dipakai untuk email/document generation, tetapi rendering besar tidak selalu cocok dilakukan inline di HTTP request.

### 19.1 Inline render cocok jika

- output kecil
- latency rendah
- user menunggu hasil langsung
- failure bisa langsung ditampilkan

Contoh:

```text
case detail page
small confirmation page
email preview small
```

### 19.2 Async render cocok jika

- PDF besar
- banyak email
- report panjang
- document bundle
- perlu retry
- output perlu disimpan/audit

Pattern:

```text
User action
  -> create render job
  -> commit transaction
  -> outbox/message
  -> worker renders Thymeleaf HTML
  -> PDF/email/file generation
  -> store artifact
  -> notify user
```

### 19.3 Virtual threads Java 21+

Untuk batch rendering yang I/O-heavy, virtual threads bisa membantu concurrency. Tetapi rendering template itu sering CPU/allocation-heavy, bukan hanya blocking I/O.

Gunakan mental model:

| Workload | Virtual thread benefit |
|---|---|
| render + SMTP/API blocking | bisa membantu |
| pure CPU rendering heavy | tidak menambah CPU |
| render + DB fetch per job | bisa membantu blocking, tapi DB pool tetap limit |
| huge output allocation | tidak menyelesaikan memory pressure |

Rule:

```text
Virtual threads improve blocking concurrency, not CPU throughput beyond available cores.
```

---

## 20. Memory Allocation and GC

Rendering HTML biasanya menghasilkan banyak object sementara:

- strings
- buffers
- escaped output fragments
- expression evaluation objects
- formatted date/number strings
- collection iterators
- context objects

### 20.1 Avoid unnecessary full String accumulation

Untuk MVC response, engine/view layer biasanya menulis ke response writer.

Untuk manual rendering:

```java
String html = templateEngine.process("template", context);
```

Ini membuat seluruh output menjadi `String`.

Untuk email kecil, ini OK.

Untuk output besar, pertimbangkan:

- streaming ke writer jika API/path mendukung
- chunked generation
- async document job
- output size limit

### 20.2 Beware huge StringBuilder/StringWriter

Jika menghasilkan HTML 20 MB:

```text
char[]/byte[] besar
copy berkali-kali
GC pressure
possible humongous allocation under G1
```

Production rule:

```text
No unbounded rendering output.
```

### 20.3 Java 8–25 considerations

| Java version area | Dampak umum |
|---|---|
| Java 8 | baseline lama, GC pilihan lebih terbatas, no compact strings until Java 9 |
| Java 9+ | compact strings membantu Latin-1 string memory |
| Java 17/21 LTS | runtime modern, JFR kuat, GC modern stabil |
| Java 21+ | virtual threads tersedia untuk orchestration/blocking tasks |
| Java 25 | modern platform target; tetap perlu benchmark di runtime aktual |

Jangan klaim "Java versi baru otomatis membuat template cepat". Upgrade membantu runtime, tetapi bottleneck desain tetap harus diperbaiki.

---

## 21. Profiling Thymeleaf Rendering

### 21.1 Mulai dari request trace

Sebelum JFR mendalam, pecah request:

```text
Controller time
Service time
DB time
Model mapping time
Template rendering time
Response write time
```

Jika template rendering hanya 30 ms dari total 2 detik, jangan optimasi Thymeleaf dulu.

### 21.2 JFR

Gunakan Java Flight Recorder untuk melihat:

- allocation hotspot
- CPU hotspot
- lock contention
- file I/O
- socket I/O
- GC pause
- method profiling

Pertanyaan yang dicari:

```text
Apakah CPU banyak di expression evaluation?
Apakah banyak allocation string/formatter?
Apakah render memicu DB/network I/O?
Apakah GC pressure tinggi saat output besar?
```

### 21.3 Allocation profiling

Jika allocation tinggi, cek:

- loops besar
- formatting dalam loop
- inline JS serialization
- repeated fragment calls
- model mapping menghasilkan duplicate strings
- HTML output terlalu besar

### 21.4 Thread dump

Jika request stuck:

- apakah thread blocking DB?
- apakah blocking filesystem/template loader?
- apakah lock di cache manager?
- apakah external template store lambat?

---

## 22. Benchmarking Thymeleaf dengan Benar

### 22.1 Jangan benchmark request penuh tanpa breakdown

Full HTTP load test penting, tetapi tidak memberi isolasi.

Butuh dua level:

```text
1. Micro-ish benchmark rendering only
2. End-to-end HTTP load test
```

### 22.2 Rendering benchmark skeleton

Dengan JMH:

```java
@State(Scope.Benchmark)
public class ThymeleafRenderBenchmark {

    private SpringTemplateEngine engine;
    private Context context;

    @Setup(Level.Trial)
    public void setup() {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCacheable(true);

        engine = new SpringTemplateEngine();
        engine.setTemplateResolver(resolver);

        context = new Context(Locale.ENGLISH);
        context.setVariable("view", SampleViews.caseList(50));

        // warm cache intentionally
        engine.process("case/list", context);
    }

    @Benchmark
    public String renderCaseList() {
        return engine.process("case/list", context);
    }
}
```

Catatan:

- warm cache jika ingin mengukur production warm path
- buat benchmark cold path terpisah
- jangan mencampur DB/API dalam benchmark rendering only
- gunakan model realistis
- ukur allocation, bukan hanya ops/sec

### 22.3 Cold vs warm benchmark

Cold:

```text
cache disabled or cleared
measures parse/resolution cost
```

Warm:

```text
cache enabled and warmed
measures runtime evaluation/output cost
```

Keduanya berguna untuk pertanyaan berbeda.

### 22.4 Load test HTTP

Gunakan Gatling/k6/JMeter sesuai stack.

Skenario:

```text
- login
- open dashboard
- search case
- open case detail
- submit validation error form
- open list page with pagination
```

Metrics:

```text
P50/P95/P99 latency
error rate
throughput
CPU
memory
GC
DB query count
response size
```

---

## 23. Production Configuration Baseline

Spring Boot baseline:

```properties
spring.thymeleaf.enabled=true
spring.thymeleaf.prefix=classpath:/templates/
spring.thymeleaf.suffix=.html
spring.thymeleaf.mode=HTML
spring.thymeleaf.encoding=UTF-8
spring.thymeleaf.cache=true
spring.thymeleaf.check-template=true
spring.thymeleaf.check-template-location=true
```

Development override:

```properties
spring.thymeleaf.cache=false
```

Possible tuning:

```properties
spring.thymeleaf.enable-spring-el-compiler=true
```

Tapi aktifkan setelah profiling atau testing.

### 23.1 Resolver bean explicit configuration

```java
@Configuration
class ThymeleafConfig {

    @Bean
    SpringResourceTemplateResolver templateResolver(ApplicationContext applicationContext) {
        SpringResourceTemplateResolver resolver = new SpringResourceTemplateResolver();
        resolver.setApplicationContext(applicationContext);
        resolver.setPrefix("classpath:/templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setCacheable(true);
        return resolver;
    }

    @Bean
    SpringTemplateEngine templateEngine(SpringResourceTemplateResolver templateResolver) {
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(templateResolver);
        engine.setEnableSpringELCompiler(false);
        return engine;
    }
}
```

Jika memakai Spring Boot auto-config, jangan override kecuali perlu. Overriding manual bisa membuat konfigurasi Boot lain tidak terpakai.

---

## 24. Production Anti-Patterns

### 24.1 Cache disabled in production

```properties
spring.thymeleaf.cache=false
```

Kecuali ada alasan sangat spesifik dan terukur, ini red flag.

### 24.2 Entity graph passed directly to template

```java
model.addAttribute("case", caseEntity);
```

Risiko:

- lazy loading
- data leakage
- template coupling ke domain model
- sulit versioning
- sulit performance bound

### 24.3 Service calls from template

```html
<span th:text="${@caseService.calculateSomething(case)}"></span>
```

Risiko:

- hidden I/O
- hidden CPU cost
- sulit test
- template jadi orchestration layer

### 24.4 Huge unpaginated list

```java
model.addAttribute("cases", caseRepository.findAll());
```

Risiko:

- DB berat
- memory berat
- render berat
- browser berat

### 24.5 Over-fragmentation

Semua elemen HTML menjadi fragment kecil.

Akibat:

- sulit debug
- banyak parameter
- runtime graph rumit
- developer takut mengubah

### 24.6 Inline everything

```html
<style>...</style>
<script>...</script>
<script th:inline="javascript">large serialized object</script>
```

Risiko:

- HTML besar
- CSP lebih sulit
- cache asset tidak optimal
- XSS risk meningkat

---

## 25. Performance-Oriented Controller Pattern

Buruk:

```java
@GetMapping("/cases")
public String list(Model model) {
    model.addAttribute("cases", caseRepository.findAll());
    return "case/list";
}
```

Lebih baik:

```java
@GetMapping("/cases")
public String list(
        @RequestParam(defaultValue = "0") int page,
        @RequestParam(defaultValue = "25") int size,
        CaseSearchCriteria criteria,
        Model model,
        Locale locale
) {
    int boundedSize = Math.min(size, 100);

    Page<CaseListRowView> result = caseListQueryService.search(
            criteria,
            PageRequest.of(page, boundedSize),
            locale
    );

    model.addAttribute("view", new CaseListPageView(
            criteria,
            result.getContent(),
            PaginationView.from(result),
            CaseListActions.forCurrentUser()
    ));

    return "case/list";
}
```

Template:

```html
<tr th:each="row : ${view.rows}">
  <td th:text="${row.referenceNo}"></td>
  <td th:text="${row.applicantName}"></td>
  <td th:text="${row.displayStatus}"></td>
  <td th:text="${row.displayCreatedAt}"></td>
</tr>
```

Kelebihan:

- bounded data
- no entity graph
- no hidden lazy loading
- clean template
- easier metrics
- easier testing

---

## 26. Case Study: Lambatnya Case List Page

### 26.1 Gejala

```text
/cases P95 = 4.2 s
CPU naik
DB connection pool penuh
HTML response 3.8 MB
```

### 26.2 Investigasi

Temuan:

```text
- template cache aktif
- rendering time 900 ms
- DB time 2.4 s
- query count/request 321
- rows rendered 500
- each row has hidden modal
- each row checks permission through service in template
```

### 26.3 Root causes

Bukan satu masalah:

1. no pagination
2. JPA lazy loading dari template
3. hidden modal per row
4. authorization check dari template
5. HTML terlalu besar
6. fragment action per row terlalu kompleks

### 26.4 Fix

```text
- default page size 25, max 100
- projection query DTO
- permission precomputed in service
- one generic modal, load detail on demand
- simplify row action fragment
- add query count metric
- add response size metric
```

### 26.5 Hasil

```text
P95: 4.2 s -> 350 ms
DB queries: 321 -> 5
HTML size: 3.8 MB -> 180 KB
render time: 900 ms -> 45 ms
```

Pelajaran:

```text
Thymeleaf performance sering membaik drastis setelah data/model/output dibatasi.
```

---

## 27. Case Study: Template Cache Disabled Accidentally

### 27.1 Gejala

```text
After deployment, CPU doubled.
No DB increase.
P95 page render worsened.
```

### 27.2 Temuan

```properties
spring.thymeleaf.cache=false
```

Terbawa dari development profile ke production.

### 27.3 Fix

```properties
# application-prod.properties
spring.thymeleaf.cache=true
```

Tambahkan startup guard:

```java
@Component
@Profile("prod")
class ThymeleafProductionGuard {

    ThymeleafProductionGuard(ThymeleafProperties properties) {
        if (!properties.isCache()) {
            throw new IllegalStateException("Thymeleaf cache must be enabled in prod");
        }
    }
}
```

Atau pakai environment validation/architecture test.

---

## 28. Case Study: Dynamic Template Repository

### 28.1 Requirement

Business ingin mengubah email/correspondence template tanpa redeploy.

### 28.2 Naive design

```text
Every render:
  -> query DB template by code
  -> parse template string
  -> render
```

Masalah:

- DB load tinggi
- parsing berulang
- draft bisa muncul di production
- tidak ada immutable version
- tidak ada audit render version

### 28.3 Better design

```text
TemplateRepository
  - templateId
  - version
  - locale
  - tenant
  - status: DRAFT/APPROVED/PUBLISHED/RETIRED
  - contentHash
  - effectiveFrom

PublishedTemplateResolver
  -> resolve active version
  -> cache by templateId:version:locale:tenant
  -> render immutable content
```

Render record:

```text
templateId=CASE_APPROVAL_NOTICE
templateVersion=12
contentHash=sha256:...
locale=en-SG
renderedAt=2026-06-19T...
dataSnapshotId=...
```

Performance dan audit selesai bersama.

---

## 29. Checklist Production Tuning

### 29.1 Configuration

- [ ] `spring.thymeleaf.cache=true` di production.
- [ ] Encoding UTF-8 eksplisit.
- [ ] Template mode sesuai output.
- [ ] Template location valid.
- [ ] Development override tidak bocor ke production.
- [ ] Dynamic template resolver punya cache/versioning.
- [ ] Template cache invalidation jelas.

### 29.2 Template design

- [ ] Tidak ada service/repository call dari template.
- [ ] Tidak ada entity graph besar langsung di model.
- [ ] Fragment tidak over-nested.
- [ ] Loop besar dibatasi.
- [ ] Tidak ada hidden huge DOM.
- [ ] Inline JS/CSS minim.
- [ ] `th:utext` sangat terbatas dan justified.

### 29.3 Data/model

- [ ] ViewModel/projection digunakan untuk list/detail besar.
- [ ] Pagination default dan max size jelas.
- [ ] Permission flags dihitung sebelum rendering.
- [ ] Formatting masif dilakukan sebelum template.
- [ ] Model tidak membawa blob/base64/long text tanpa batas.
- [ ] No lazy loading needed during render.

### 29.4 Observability

- [ ] Render latency metric.
- [ ] Query count per request.
- [ ] Response size metric.
- [ ] Error rate per template.
- [ ] P50/P95/P99 dashboard.
- [ ] Slow render logging tanpa PII.
- [ ] Load test untuk halaman kritikal.

### 29.5 Browser/network

- [ ] Static assets fingerprinted.
- [ ] Static assets cache long-lived.
- [ ] HTML cache policy sesuai sensitivity.
- [ ] Compression aktif.
- [ ] DOM size wajar.
- [ ] JS defer/async bila cocok.

---

## 30. Review Heuristics untuk Senior/Tech Lead

Saat review PR Thymeleaf, tanya:

1. Berapa row maksimum yang bisa masuk ke halaman ini?
2. Apakah template membaca entity lazy relation?
3. Apakah ada service bean dipanggil dari template?
4. Apakah setiap row memanggil fragment berat?
5. Apakah ada modal/form besar per row?
6. Apakah output HTML bisa lebih dari 1 MB?
7. Apakah page ini punya pagination?
8. Apakah formatting dilakukan ribuan kali di template?
9. Apakah permission/authorization dihitung di service atau template?
10. Apakah error page aman saat DB down?
11. Apakah template cache aktif di environment target?
12. Apakah ada metric untuk membuktikan performa?

Ini cara berpikir top engineer: bukan mencari syntax yang benar, tetapi boundary yang benar.

---

## 31. Performance Decision Matrix

| Problem | Jangan langsung | Pertimbangkan |
|---|---|---|
| Page lambat | menyalahkan Thymeleaf | trace full latency |
| Render list lambat | ganti engine | paginate + projection |
| CPU tinggi | enable random compiler flag | profile JFR |
| Template berubah lambat di dev | matikan cache prod | profile-specific config |
| Business template dynamic | DB read per request | versioned cached resolver |
| HTML besar | gzip saja | reduce DOM/output |
| Banyak permission check | call service dari template | precompute action flags |
| Banyak date formatting | format di setiap row | preformat ViewModel untuk loop besar |
| First request lambat | ignore | startup warmup selected templates |
| P99 tinggi | lihat average | inspect GC/DB/cache/cold path |

---

## 32. Minimal Production Architecture

```text
Controller
  -> Query/Application Service
     -> bounded query/projection
     -> permission evaluation
     -> formatting/model shaping
  -> ViewModel
  -> Thymeleaf Template
     -> simple expressions
     -> bounded loops
     -> cached fragments
  -> HTML response
     -> compressed
     -> measured size
     -> browser-friendly DOM
```

Dengan observability:

```text
Request trace
  - route
  - controller/service/db/model/render/write duration
  - query count
  - row count
  - html bytes
  - template name
  - outcome
```

Dengan governance:

```text
Template files
  - tested in CI
  - cache enabled in prod
  - reviewed for no service calls
  - view model contract tested
```

---

## 33. Kapan Thymeleaf Bukan Pilihan Terbaik?

Thymeleaf sangat baik untuk:

- admin portal SSR
- form-heavy enterprise app
- simple public pages
- email/document pre-rendering
- server-driven workflow UI
- progressively enhanced pages

Tetapi kurang cocok jika:

- UI sangat interaktif seperti Figma/Google Docs
- client-side state sangat kompleks
- real-time collaborative editing
- ribuan dynamic DOM update per detik
- heavy charting SPA experience
- offline-first app

Dalam kondisi itu, SSR Thymeleaf bisa tetap dipakai untuk shell/login/admin, tetapi UI utama mungkin perlu SPA/client rendering.

Top engineer tidak fanatik engine. Ia memilih rendering model sesuai interaction model.

---

## 34. Rangkuman Mental Model

Thymeleaf performance bukan tentang hafalan properti cache saja.

Intinya:

```text
Template cache mengurangi parse/resolution cost.
ViewModel mengurangi expression/model traversal cost.
Pagination mengurangi DB/render/browser cost.
Fragment discipline mengurangi composition complexity.
Observability mengubah tuning dari opini menjadi bukti.
```

Formula praktis:

```text
Fast page = bounded data + prepared view model + cached template + small DOM + measured latency.
```

Anti-formula:

```text
Slow page = findAll entity graph + lazy loading in template + 1000 rows + fragment per cell + hidden modals + cache disabled.
```

Jika kamu hanya mengingat satu hal dari Part 18:

> Thymeleaf akan terlihat cepat jika kamu memberinya data yang sudah siap-render, jumlah output yang dibatasi, dan cache yang benar. Thymeleaf akan terlihat lambat jika kamu menjadikannya tempat query, authorization, formatting masif, dan DOM generation tanpa batas.

---

## 35. Latihan Praktis

### Latihan 1 — Audit template list page

Ambil satu halaman list Thymeleaf. Catat:

```text
row count max
query count
HTML bytes
render time
number of fragments called inside loop
number of expressions per row
```

Buat improvement plan.

### Latihan 2 — Refactor entity model ke ViewModel

Sebelum:

```java
model.addAttribute("cases", caseRepository.findAll());
```

Sesudah:

```java
model.addAttribute("view", caseListPageAssembler.assemble(criteria, pageable, user, locale));
```

Pastikan template tidak mengakses lazy relation.

### Latihan 3 — Compare cache on/off

Jalankan load test kecil:

```text
spring.thymeleaf.cache=false
vs
spring.thymeleaf.cache=true
```

Bandingkan:

- throughput
- P95 latency
- CPU
- allocation

### Latihan 4 — Detect hidden DOM

Cari pattern:

```text
modal inside th:each
large hidden div
inline JSON huge
```

Ubah menjadi on-demand detail loading atau separate detail page.

### Latihan 5 — Add slow render log

Tambahkan instrumentation agar jika render > 200 ms, log:

```text
template
route
rowCount
htmlBytes
queryCount
correlationId
```

Tanpa PII dan tanpa full model.

---

## 36. Referensi

- Thymeleaf Official Documentation — Using Thymeleaf 3.1.
- Thymeleaf API — `TemplateEngine`, `ICacheManager`, template resolver classes.
- Thymeleaf + Spring Official Documentation.
- Spring Boot Common Application Properties — `spring.thymeleaf.*`.
- Spring Framework MVC View Technologies.
- Java Flight Recorder documentation in modern JDK.
- General web performance principles: response size, caching, compression, DOM size, server latency budgeting.

---

## 37. Status Seri

```text
Part 18 selesai.
Seri belum selesai.
Berikutnya: Part 19 — Email Template Engineering with FreeMarker and Thymeleaf.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-017.md">⬅️ Part 17 — Thymeleaf Security: XSS, CSRF, Authorization Rendering, and Safe HTML</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-019.md">Part 19 — Email Template Engineering with FreeMarker and Thymeleaf ➡️</a>
</div>
