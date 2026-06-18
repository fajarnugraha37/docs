# Part 12 — JSP Performance and Operations: Compilation, Buffering, Caching, and Production Diagnostics

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `12-jsp-performance-operations-compilation-buffering-caching-diagnostics.md`  
> Scope Java: Java 8 sampai Java 25  
> Scope platform: Java EE/Jakarta EE, JSP/Jakarta Pages, Servlet/Jakarta Servlet, JSTL/Jakarta Tags, EL/Jakarta EL

---

## 1. Tujuan Bagian Ini

Bagian ini membahas JSP dari sudut pandang **runtime artifact** dan **operational system**, bukan hanya file view.

Setelah bagian ini, target pemahaman kamu:

1. Mengerti apa yang sebenarnya terjadi saat `.jsp` pertama kali diakses.
2. Bisa menjelaskan cost translation, compilation, class loading, initialization, request rendering, buffering, dan flushing.
3. Bisa membedakan bottleneck yang berasal dari:
   - JSP compilation,
   - JSP rendering,
   - EL evaluation,
   - tag execution,
   - session usage,
   - layout/include composition,
   - backend/service call,
   - network/browser payload.
4. Bisa merancang strategi production untuk:
   - precompilation,
   - cache control,
   - fragment caching,
   - static asset caching,
   - compression,
   - observability,
   - safe reload behavior.
5. Bisa mendiagnosis masalah umum:
   - first request lambat,
   - JSP tidak update,
   - response already committed,
   - memory naik karena session,
   - classloader leak,
   - high CPU di rendering,
   - slow page karena nested loop/tag/EL.

Intinya: JSP yang baik bukan hanya “halamannya benar”. JSP yang baik harus **predictable**, **observable**, **safe untuk production**, dan **tidak membuat runtime cost tersembunyi**.

---

## 2. Mental Model Besar: JSP sebagai Runtime Pipeline

Secara konseptual, request ke JSP melewati pipeline seperti ini:

```text
HTTP request
  ↓
Servlet container receives request
  ↓
JSP servlet mapping resolves target .jsp
  ↓
If needed: translate .jsp into generated servlet source
  ↓
If needed: compile generated servlet source into class
  ↓
Load generated servlet class
  ↓
Call jspInit() once
  ↓
For each request: call _jspService(request, response)
  ↓
Evaluate EL, execute tags, write template output
  ↓
Buffer response
  ↓
Commit response headers/body
  ↓
Client receives HTML/CSS/JS references
```

Jadi cost JSP tidak hanya “menulis HTML”. Ada dua kategori cost besar:

| Kategori | Terjadi kapan | Contoh cost |
|---|---:|---|
| Translation/compilation cost | Saat JSP belum dikompilasi atau berubah | parse JSP, generate servlet Java, compile class, load class |
| Request rendering cost | Setiap request | EL, JSTL/custom tags, include, iteration, escaping, output write |

Di development, translation/compilation yang otomatis sangat membantu. Di production, perilaku yang sama bisa menjadi sumber latency spike kalau tidak dikontrol.

---

## 3. JSP Translation dan Compilation Cost

### 3.1 Translation Phase

Translation phase mengubah file JSP menjadi source Java servlet.

Contoh file:

```jsp
<%@ page contentType="text/html;charset=UTF-8" %>
<h1>${pageTitle}</h1>
<c:forEach items="${cases}" var="caseItem">
  <p>${caseItem.referenceNo}</p>
</c:forEach>
```

Secara mental akan menjadi servlet seperti:

```java
public final class caseList_jsp extends HttpJspBase {
    public void _jspService(HttpServletRequest request,
                            HttpServletResponse response)
            throws IOException, ServletException {

        response.setContentType("text/html;charset=UTF-8");
        JspWriter out = pageContext.getOut();

        out.write("<h1>");
        // evaluate EL pageTitle
        out.write(...);
        out.write("</h1>");

        // execute c:forEach tag handler
        // evaluate caseItem.referenceNo repeatedly
    }
}
```

Hal penting:

1. JSP bukan runtime interpreter murni.
2. JSP biasanya diterjemahkan menjadi Java servlet.
3. Setelah itu servlet class dieksekusi seperti servlet biasa.
4. Error translation/compilation bisa muncul dari syntax JSP, taglib, import, directive, atau generated Java.

### 3.2 Compilation Phase

Setelah source servlet dibuat, container/JSP engine mengompilasi source itu menjadi `.class`.

Cost-nya bisa terasa pada:

1. first request setelah deployment,
2. first request setelah JSP berubah,
3. cold start container,
4. deployment dengan banyak JSP yang tidak diprecompile,
5. container yang menjalankan runtime compilation di production.

### 3.3 Request Phase

Setelah class tersedia, request berikutnya masuk ke method generated servlet, biasanya `_jspService()`.

Di sini cost-nya bukan compile lagi, tetapi:

1. membuat/menyiapkan `PageContext`,
2. lookup scope attributes,
3. evaluate EL,
4. execute tag handlers,
5. resolve includes,
6. write output ke `JspWriter`,
7. flush buffer ke response.

### 3.4 Operational Meaning

Kalau first request lambat tetapi request berikutnya cepat, kemungkinan besar masalahnya ada di:

1. lazy JSP compilation,
2. cold classloading,
3. cold service/cache initialization,
4. cold database pool,
5. cold template/tag initialization.

Kalau semua request lambat, kemungkinan bukan compilation, tetapi rendering/data/service path.

---

## 4. Development Mode vs Production Mode

### 4.1 Perbedaan Tujuan

Development mode biasanya mengoptimalkan feedback loop:

```text
ubah JSP → refresh browser → lihat hasil
```

Production mode mengoptimalkan stability:

```text
deploy immutable artifact → serve traffic predictably → avoid runtime recompilation surprise
```

Masalah muncul kalau production masih memakai asumsi development.

### 4.2 Development Mode Behavior

Dalam development, container bisa:

1. mengecek timestamp JSP,
2. mendeteksi perubahan,
3. menerjemahkan ulang JSP,
4. compile ulang,
5. reload generated servlet.

Ini nyaman, tapi ada cost:

1. file stat check,
2. recompilation spike,
3. classloader/object churn,
4. inconsistent behavior kalau JSP berubah saat request aktif,
5. potensi source/class artifact stale.

### 4.3 Production Mode Behavior

Di production, biasanya kamu ingin:

1. JSP tidak berubah di runtime.
2. Artifact immutable.
3. Compilation dilakukan sebelum traffic masuk.
4. Runtime tidak mengecek file terlalu sering.
5. Error JSP terdeteksi saat build/deploy, bukan saat user pertama akses.

Untuk Tomcat/Jasper misalnya, dokumentasi Jasper membahas konfigurasi production seperti `development=false` dan precompilation. Detail param bisa berbeda antar versi container, jadi selalu cek dokumentasi container yang dipakai.

### 4.4 Practical Rule

```text
Development:
  optimize edit-refresh cycle.

Production:
  optimize deterministic startup, no surprise compilation, no file mutation.
```

---

## 5. JSP Precompilation

### 5.1 Apa Itu Precompilation

Precompilation berarti JSP diterjemahkan dan dikompilasi sebelum user request nyata masuk.

Ada beberapa model:

1. Precompile saat build.
2. Precompile saat deployment/startup.
3. Warm-up endpoint setelah deploy.
4. Lazy compile saat first request.

### 5.2 Kenapa Precompilation Penting

Tanpa precompilation, error JSP bisa baru muncul ketika page tertentu pertama kali diakses.

Contoh risiko:

```text
Deploy sukses.
Smoke test hanya akses /home.
Tiga jam kemudian user akses /admin/report.jsp.
JSP baru dikompilasi.
Compilation error muncul di production.
```

Untuk enterprise system, ini buruk karena deployment confidence palsu.

### 5.3 Benefit

1. Menemukan syntax/tag/import error lebih awal.
2. Mengurangi first-hit latency.
3. Membuat artifact lebih deterministic.
4. Mengurangi runtime compiler dependency surprise.
5. Mempercepat rollback validation.

### 5.4 Trade-off

1. Build/deploy lebih lama.
2. Generated source/class perlu dikelola dengan benar.
3. Bisa container-specific.
4. Error bisa tergantung environment classpath.
5. Tidak menggantikan integration testing.

### 5.5 Strategi Realistis

Untuk sistem enterprise:

```text
CI:
  compile Java
  run unit tests
  precompile JSP or run container-level JSP validation
  run rendering smoke tests

Deploy:
  deploy immutable artifact
  run startup health
  hit important pages as warm-up
  only then route traffic
```

### 5.6 Warm-up Bukan Pengganti Precompile

Warm-up request bisa membantu, tetapi tidak sama dengan precompile penuh.

Warm-up biasanya hanya menyentuh URL tertentu. JSP yang tidak tersentuh masih bisa gagal nanti.

Precompile lebih luas karena mencoba memvalidasi semua JSP yang terdeteksi.

---

## 6. JSP Reload, Stale Generated Classes, dan “Why My JSP Change Is Not Reflected?”

Masalah klasik:

> “Saya sudah ubah JSP, tapi browser masih menampilkan versi lama.”

Penyebabnya bisa banyak.

### 6.1 Browser Cache

Browser mungkin cache HTML atau static asset.

Gejala:

1. server log menunjukkan request tidak masuk,
2. hard refresh memperbaiki,
3. user tertentu saja melihat versi lama.

Solusi:

1. atur cache header HTML protected page,
2. versioning static assets,
3. hindari cache HTML dinamis kecuali disengaja.

### 6.2 Proxy/CDN Cache

Kalau ada reverse proxy/CDN, HTML atau fragment bisa tersimpan di layer luar.

Gejala:

1. request sampai proxy, tidak sampai app,
2. semua node app sudah benar,
3. cache purge memperbaiki.

Solusi:

1. jelas bedakan cacheable static assets vs non-cacheable protected HTML,
2. gunakan `Cache-Control` yang benar,
3. pakai asset fingerprint.

### 6.3 Container Tidak Mengecek JSP Change

Production config mungkin tidak mengecek perubahan JSP atau mengecek dengan interval panjang.

Ini sebenarnya benar untuk production immutable deployment, tetapi membingungkan di development.

### 6.4 Generated Servlet Stale

Work directory container menyimpan generated source/class. Kadang artifact lama tersisa.

Gejala:

1. clean redeploy memperbaiki,
2. hapus work directory memperbaiki,
3. timestamp file aneh.

Solusi:

1. clean deploy,
2. jangan mutate exploded WAR manual di production,
3. gunakan immutable image/artifact,
4. pastikan deployment pipeline membersihkan old work artifacts jika perlu.

### 6.5 Multiple Nodes

Dalam cluster, node A sudah deploy, node B belum.

Gejala:

1. refresh kadang versi baru, kadang lama,
2. sticky session membuat user tertentu selalu melihat versi lama,
3. load balancer logs menunjukkan node berbeda.

Solusi:

1. rolling deployment yang sehat,
2. version endpoint per node,
3. drain node sebelum replace,
4. health check setelah deployment.

---

## 7. Buffering: `JspWriter`, Response Buffer, dan Commit

### 7.1 Kenapa Buffer Ada

JSP menulis output secara bertahap:

```jsp
<html>
<body>
<h1>${title}</h1>
...
</body>
</html>
```

Tanpa buffer, setiap `out.write()` bisa langsung ke response stream. Itu tidak efisien dan membuat header/status sulit diubah.

Buffer memberi ruang untuk:

1. mengumpulkan output sebelum dikirim,
2. mengubah header sebelum commit,
3. forward ke halaman lain sebelum output terkirim,
4. menampilkan error page sebelum response committed.

### 7.2 Response Commit

Response dianggap committed ketika status/header/body mulai dikirim ke client.

Setelah committed:

1. status code tidak bisa diganti dengan aman,
2. redirect bisa gagal,
3. forward bisa gagal,
4. error page tidak bisa mengganti response penuh,
5. header tambahan mungkin terlambat.

### 7.3 JSP Buffer Directive

JSP punya directive seperti:

```jsp
<%@ page buffer="16kb" autoFlush="true" %>
```

Makna umum:

1. `buffer` menentukan ukuran buffer JSP.
2. `autoFlush="true"` memungkinkan buffer flush otomatis saat penuh.
3. `autoFlush="false"` bisa memunculkan exception jika buffer penuh.

### 7.4 Failure Mode: Response Already Committed

Contoh buruk:

```jsp
<html>
<body>
<%
    out.flush();
    response.sendRedirect("/login");
%>
</body>
</html>
```

Masalah:

1. output sudah dikirim,
2. response committed,
3. redirect terlambat.

### 7.5 Rule Praktis

```text
Decide status, redirect, forward, content type, cache headers, and security headers before rendering body.
```

Jangan biarkan JSP menjadi tempat keputusan response control yang terlambat.

Controller/filter harus mengambil keputusan sebelum forward ke JSP.

---

## 8. Buffer Size: Kapan Perlu Dipikirkan

Default buffer sering cukup. Tetapi beberapa kasus butuh perhatian.

### 8.1 Large HTML Page

Jika page sangat besar:

1. table ribuan row,
2. nested layout berat,
3. banyak inline script/style,
4. error summary besar,
5. hidden fields besar,
6. serialized state besar.

Buffer kecil bisa sering flush. Flush terlalu awal bisa commit response sebelum semua decision selesai.

### 8.2 Error Handling

Kalau error terjadi setelah banyak output ditulis dan response sudah committed, error page tidak bisa mengganti response dengan bersih.

### 8.3 Streaming vs HTML Rendering

JSP bukan tool ideal untuk streaming file besar. Untuk file download, gunakan servlet/controller yang menulis binary stream dengan header benar.

### 8.4 Practical Guideline

1. Jangan menaikkan buffer sebagai solusi pertama.
2. Ukur payload HTML.
3. Kurangi page size.
4. Gunakan pagination.
5. Hindari render data ribuan row.
6. Pindahkan binary/download keluar dari JSP.
7. Pastikan redirect/forward terjadi sebelum body render.

---

## 9. EL Performance: Kecil per Ekspresi, Besar Jika Berulang

EL terlihat ringan:

```jsp
${caseItem.assignee.displayName}
```

Tetapi di dalam loop besar, cost bisa berlipat.

### 9.1 Cost yang Terlibat

1. Resolve variable `caseItem`.
2. Resolve property `assignee`.
3. Resolve property `displayName`.
4. Type coercion jika diperlukan.
5. Escaping jika lewat `c:out`.
6. Getter invocation.

Jika ada 1000 row dan 20 expression per row:

```text
1000 x 20 = 20.000 expression evaluations
```

Masing-masing kecil, tetapi total bisa signifikan.

### 9.2 Getter Harus Murah

Anti-pattern:

```java
public String getAssigneeName() {
    return userService.findById(assigneeId).getDisplayName();
}
```

Jika dipanggil dari JSP dalam table, bisa menjadi N+1 call.

Rule:

```text
Getter yang diakses dari JSP harus murah, deterministic, side-effect-free.
```

### 9.3 Prepare View Model

Lebih baik:

```java
public record CaseRowView(
    String referenceNo,
    String assigneeName,
    String statusLabel,
    boolean canApprove,
    String detailUrl
) {}
```

Controller/service menyiapkan semua field display-ready sebelum forward ke JSP.

JSP hanya render:

```jsp
<c:forEach items="${caseRows}" var="row">
  <tr>
    <td><c:out value="${row.referenceNo}" /></td>
    <td><c:out value="${row.assigneeName}" /></td>
    <td><c:out value="${row.statusLabel}" /></td>
  </tr>
</c:forEach>
```

### 9.4 EL Micro-Optimization yang Masuk Akal

Masuk akal:

1. kurangi expression dalam nested loops,
2. precompute expensive formatting,
3. hindari getter yang call database/service,
4. hindari reflection-heavy dynamic resolver untuk hot path,
5. hindari custom resolver global yang terlalu mahal.

Tidak masuk akal:

1. mengganti semua EL dengan scriptlet demi performa,
2. premature caching tanpa measurement,
3. menyimpan semua data di session untuk “biar cepat”,
4. mengorbankan escaping/security.

---

## 10. Tag Performance: JSTL dan Custom Tags

### 10.1 Tag Handler Cost

Setiap tag bisa melibatkan:

1. object allocation atau tag pooling,
2. attribute evaluation,
3. body evaluation,
4. nested tag coordination,
5. output writing,
6. cleanup/reset state.

JSTL core tags biasanya cukup efisien, tetapi misuse tetap bisa mahal.

### 10.2 Nested Tags

Contoh yang harus dicurigai:

```jsp
<c:forEach items="${cases}" var="caseItem">
  <c:forEach items="${caseItem.documents}" var="doc">
    <c:forEach items="${doc.comments}" var="comment">
      ...
    </c:forEach>
  </c:forEach>
</c:forEach>
```

Masalah:

1. HTML besar,
2. EL banyak,
3. getter nested bisa trigger lazy loading,
4. sulit dibaca,
5. page lambat di browser juga.

Solusi:

1. flatten view model,
2. pagination,
3. expand-on-demand,
4. lazy load via separate endpoint,
5. render summary dulu.

### 10.3 Custom Tags dan Tag Pooling

Beberapa container dapat melakukan pooling tag handler. Ini berarti object tag bisa dipakai ulang.

Implikasi:

1. Jangan simpan request-specific state yang tidak di-reset.
2. Jangan menganggap field tag selalu fresh.
3. Cleanup di akhir execution.
4. Gunakan local variable sebanyak mungkin.

Contoh buruk:

```java
public class BadgeTag extends SimpleTagSupport {
    private String cssClass;
    private boolean sensitive;

    public void setCssClass(String cssClass) {
        this.cssClass = cssClass;
    }

    @Override
    public void doTag() throws IOException {
        if (sensitive) {
            getJspContext().getOut().write("...");
        }
    }
}
```

Kalau `sensitive` tidak diset setiap request dan object dipakai ulang, state lama bisa bocor.

Lebih aman:

```java
@Override
public void doTag() throws IOException {
    try {
        // render using current attributes
    } finally {
        cssClass = null;
        sensitive = false;
    }
}
```

Catatan: detail pooling bisa container-specific. Prinsip aman tetap sama: tag handler harus diperlakukan seperti object yang mungkin reused.

---

## 11. Include Performance: Static Include vs Dynamic Include

### 11.1 Static Include

```jsp
<%@ include file="/WEB-INF/views/common/header.jspf" %>
```

Static include terjadi di translation time. Isi file digabung saat JSP diterjemahkan.

Kelebihan:

1. runtime overhead kecil,
2. cocok untuk fragment statis,
3. generated servlet satu kesatuan.

Kekurangan:

1. perubahan include bisa butuh retranslation semua JSP yang memakai,
2. coupling tinggi,
3. error line mapping bisa membingungkan,
4. terlalu banyak static include membuat generated servlet besar.

### 11.2 Dynamic Include

```jsp
<jsp:include page="/WEB-INF/views/common/header.jsp" />
```

Dynamic include terjadi saat request.

Kelebihan:

1. fragment bisa dieksekusi terpisah,
2. parameter bisa diberikan,
3. lebih fleksibel,
4. cocok untuk fragment dinamis.

Kekurangan:

1. runtime dispatch overhead,
2. lebih sulit trace jika nested,
3. buffer/commit interaction perlu hati-hati,
4. include soup bisa membuat performance tidak jelas.

### 11.3 Decision Rule

```text
Static include:
  static/common boilerplate, compile-time composition.

Dynamic include:
  request-dependent fragment, reusable dynamic section.

Tag file/layout tag:
  reusable component-like layout with clearer contract.
```

---

## 12. Session Performance: Sumber Bottleneck yang Sering Diremehkan

JSP sering mengakses session secara natural:

```jsp
${sessionScope.currentUser.name}
```

Masalahnya bukan akses sederhana. Masalahnya ketika session menjadi gudang state.

### 12.1 Session Bloat

Contoh buruk:

```text
session:
  currentUser
  caseSearchResult: 5000 rows
  selectedCaseEntity
  uploadedFileBytes
  workflowDraft
  allDropdownOptions
  reportData
```

Dampak:

1. heap naik,
2. GC pressure naik,
3. session replication lambat,
4. failover mahal,
5. serialization error,
6. stale data,
7. multi-tab conflict.

### 12.2 Session Replication Cost

Dalam cluster, session bisa direplikasi antar node.

Jika satu request mengubah object session besar, container mungkin harus replicate banyak data.

```text
User action
  ↓
mutate session object
  ↓
serialize session delta/full session
  ↓
send to peer nodes/session store
  ↓
latency + memory + network
```

### 12.3 JSP Anti-Pattern

```jsp
<c:forEach items="${sessionScope.caseSearchResult}" var="caseItem">
  ...
</c:forEach>
```

Jika data besar disimpan di session karena “agar balik ke page cepat”, kamu sedang menukar DB/service cost dengan memory/replication/staleness cost.

### 12.4 Better Pattern

1. Simpan search criteria di request/session kecil.
2. Query ulang dengan pagination.
3. Simpan result di cache server-side terkontrol jika benar-benar perlu.
4. Simpan only ID/draft token, bukan full entity graph.
5. Gunakan request scope untuk render result.

---

## 13. HTML Payload Performance

Server rendering selesai bukan berarti page cepat. Browser masih harus:

1. download HTML,
2. parse HTML,
3. download CSS/JS/images/fonts,
4. execute JavaScript,
5. layout/reflow,
6. paint.

### 13.1 JSP Bisa Menghasilkan HTML Terlalu Besar

Contoh penyebab:

1. table ribuan row,
2. nested hidden inputs,
3. inline CSS/JS duplikat,
4. repeated menu markup besar,
5. verbose component fragments,
6. error details berlebihan,
7. unpaginated audit trails.

### 13.2 Ukur Output, Jangan Tebak

Ambil metrik:

1. response body size,
2. compressed size,
3. number of DOM nodes,
4. number of assets,
5. time to first byte,
6. DOMContentLoaded,
7. Largest Contentful Paint untuk public-facing pages,
8. browser main thread time.

### 13.3 Rule Praktis

```text
Jika JSP menghasilkan HTML > beberapa ratus KB secara rutin, tanyakan:
  - apakah user benar-benar butuh semua data sekaligus?
  - apakah table harus dipaginasi?
  - apakah detail bisa expand-on-demand?
  - apakah asset terduplikasi?
  - apakah inline script/style bisa diekstrak?
```

---

## 14. Static Asset Caching

JSP sering menulis link asset:

```jsp
<link rel="stylesheet" href="${pageContext.request.contextPath}/assets/app.css">
<script src="${pageContext.request.contextPath}/assets/app.js"></script>
```

### 14.1 Masalah Tanpa Versioning

Jika `app.css` berubah tetapi URL sama:

1. browser bisa pakai cache lama,
2. user melihat layout rusak,
3. deployment rollback/roll-forward membingungkan.

### 14.2 Asset Fingerprinting

Lebih baik:

```text
/assets/app.7f3a9c1.css
/assets/app.2bb19a4.js
```

Atau query version:

```jsp
<script src="${ctx}/assets/app.js?v=${buildVersion}"></script>
```

Fingerprint di filename lebih kuat untuk CDN/cache.

### 14.3 Cache Header Strategy

| Resource | Cache policy |
|---|---|
| Protected dynamic HTML | `no-store` atau strict private policy sesuai kebutuhan |
| Static versioned CSS/JS/image | long max-age + immutable |
| Static unversioned asset | short max-age atau revalidation |
| Public pages | depends on freshness and personalization |
| Error pages | usually no-store for authenticated context |

### 14.4 JSP Rule

JSP harus memakai helper/tag untuk asset URL agar versioning konsisten.

Contoh custom tag:

```jsp
<app:asset path="/assets/app.css" />
```

Output:

```html
<link rel="stylesheet" href="/myapp/assets/app.7f3a9c1.css">
```

---

## 15. Dynamic HTML Caching dan Fragment Caching

### 15.1 Full Page Cache

Full page cache jarang aman untuk authenticated JSP karena page dipersonalisasi.

Risiko:

1. data user A terlihat user B,
2. authorization menu salah,
3. CSRF token stale,
4. notification count stale,
5. sensitive page tersimpan di proxy.

### 15.2 Fragment Cache

Lebih realistis:

1. cache dropdown options yang jarang berubah,
2. cache static menu metadata,
3. cache localized labels,
4. cache reference data,
5. cache authorization-independent fragments.

### 15.3 Cache Key Harus Benar

Cache fragment harus mempertimbangkan:

1. locale,
2. tenant/agency,
3. role/permission jika output beda,
4. feature flag,
5. theme,
6. version,
7. data freshness.

Contoh cache key:

```text
menu:v3:agency=CEA:locale=en-SG:roleSetHash=8a129f
```

### 15.4 Jangan Cache Ini Sembarangan

1. CSRF token.
2. User profile sensitive data.
3. Per-request validation errors.
4. Flash message.
5. Hidden workflow transition data.
6. Authorization decision yang harus fresh.

---

## 16. Compression

HTML dari JSP biasanya sangat compressible.

### 16.1 Benefit

1. response lebih kecil,
2. network transfer lebih cepat,
3. user di network lambat terbantu.

### 16.2 Cost

1. CPU compression,
2. memory buffer,
3. latency jika compression level terlalu agresif,
4. proxy/container double-compression risk.

### 16.3 Where to Compress

Compression bisa dilakukan oleh:

1. servlet container,
2. reverse proxy,
3. load balancer,
4. CDN.

Untuk enterprise, sering lebih baik compression distandarkan di edge/reverse proxy agar aplikasi tidak mengurusnya satu per satu.

### 16.4 Security Note

Untuk page dengan secret token dan attacker-controlled reflection, compression side-channel bisa relevan dalam threat model tertentu. Untuk aplikasi regulasi/intranet, tetap perlu security review jika HTML mengandung token sensitif dan response compression aktif.

---

## 17. Database/Service Call dari Render Path

JSP seharusnya tidak memanggil database/service langsung. Tetapi indirect call bisa terjadi lewat getter, custom tag, ELResolver, atau utility.

### 17.1 Contoh Tersembunyi

```jsp
${caseItem.latestOfficerComment}
```

Getter:

```java
public String getLatestOfficerComment() {
    return commentRepository.findLatestByCaseId(id).text();
}
```

Dari luar terlihat hanya EL. Di runtime, ini query.

### 17.2 Custom Tag yang Memanggil Service

```jsp
<app:userName userId="${caseItem.assigneeId}" />
```

Tag:

```java
String name = userService.findDisplayName(userId);
```

Jika dipakai dalam table 1000 row, muncul 1000 service call.

### 17.3 Better Pattern

Controller/service menyiapkan data:

```java
List<CaseRowView> rows = caseQueryService.search(criteria);
request.setAttribute("rows", rows);
```

JSP render tanpa call backend:

```jsp
<c:out value="${row.assigneeName}" />
```

### 17.4 Diagnostic Signal

Jika JSP page lambat dan database query count naik sesuai jumlah row, cari:

1. getter yang melakukan query,
2. lazy JPA association di view,
3. custom tag lookup service,
4. custom ELResolver lookup service,
5. localization/message lookup remote,
6. permission check per row yang tidak dibatch.

---

## 18. Permission Rendering Performance

Enterprise UI sering punya conditional action:

```jsp
<c:if test="${row.canApprove}">
  <button>Approve</button>
</c:if>
```

Ini baik jika `canApprove` sudah diprecompute.

Buruk:

```jsp
<c:if test="${permissionService.canApprove(currentUser, caseItem)}">
  <button>Approve</button>
</c:if>
```

Masalah:

1. service call dari view,
2. policy evaluation berulang,
3. sulit trace,
4. result bisa beda dari backend enforcement,
5. performance tergantung jumlah row.

Better:

```java
record CaseRowView(
    String caseId,
    String referenceNo,
    boolean canView,
    boolean canApprove,
    boolean canAssign,
    boolean canEscalate
) {}
```

Policy dihitung di application layer, dibatch jika perlu, lalu action tetap divalidasi ulang saat submit.

---

## 19. Observability untuk JSP

Tanpa observability, debugging JSP lambat berubah jadi tebak-tebakan.

### 19.1 Minimal Metrics

Kumpulkan:

1. request duration per URL/view,
2. status code,
3. response size,
4. TTFB jika memungkinkan,
5. session size approximation,
6. number of DB queries per request,
7. service call count,
8. error type,
9. template/view name,
10. user role/tenant/agency dimension secara aman.

### 19.2 Log Correlation

Setiap request harus punya correlation id.

```text
request_id=abc123
user=maskedUserId
method=GET
path=/cases
view=/WEB-INF/views/case/list.jsp
duration_ms=842
status=200
response_bytes=326122
query_count=47
```

JSP itself tidak harus logging banyak, tetapi controller/filter bisa mencatat view yang dirender.

### 19.3 Timing Sections

Untuk page kompleks, ukur section:

```text
controller.query=420ms
controller.policy=80ms
controller.viewModel=35ms
jsp.render=160ms
response.write=20ms
```

Kalau semua digabung jadi `request=715ms`, kamu tidak tahu bottleneck.

### 19.4 How to Measure JSP Render Time

Pola sederhana:

```text
Controller start
  ↓
load data
  ↓
set attributes
  ↓
forward to JSP
  ↓
JSP renders
  ↓
filter after chain logs total
```

Untuk memisahkan render time, bisa gunakan:

1. filter wrapping request dispatch,
2. interceptor/controller timing sebelum forward,
3. custom view rendering abstraction,
4. container access logs + app logs correlation,
5. APM instrumentation.

---

## 20. Profiling JSP Rendering

### 20.1 CPU Profiling

Jika CPU tinggi saat page render:

Cari stack seperti:

1. EL property resolution,
2. reflection/introspection,
3. tag handler execution,
4. formatting/date/number,
5. escaping,
6. string concatenation/output writing,
7. regex in custom tags,
8. permission checks,
9. lazy loading.

### 20.2 Allocation Profiling

JSP bisa menghasilkan banyak object kecil:

1. tag handler attributes,
2. iterator objects,
3. formatted string,
4. date/number formatter jika dibuat berulang,
5. temporary collections,
6. wrappers.

### 20.3 Thread Dumps

Jika request menggantung:

Cari thread di:

1. database call dari getter/tag,
2. remote service call,
3. synchronized block custom tag/helper,
4. classloading/compilation,
5. session lock,
6. output write blocked.

### 20.4 Heap Dump

Jika memory naik:

Cari:

1. large session attributes,
2. cached fragments tanpa eviction,
3. generated JSP classloader retention,
4. static references dari custom tags/utilities,
5. large view model accidentally stored in session/application,
6. old webapp classloader retained after redeploy.

---

## 21. Classloader Leaks dan Redeploy Problems

JSP-generated servlets berada dalam webapp classloader. Saat redeploy, classloader lama harus bisa GC.

### 21.1 Penyebab Classloader Leak

1. static field menyimpan object dari webapp classloader,
2. background thread tidak dihentikan,
3. ThreadLocal tidak dibersihkan,
4. JDBC driver/timer/listener tidak deregister,
5. custom tag/helper membuat singleton global,
6. cache library menyimpan reference ke class webapp,
7. logging framework misconfigured.

### 21.2 Kenapa JSP Bisa Terlibat

JSP sendiri jarang penyebab utama, tetapi custom tags, ELResolver, formatter helper, dan static utility yang dipakai JSP bisa menyimpan reference.

Contoh buruk:

```java
public final class ViewHelper {
    private static final Map<String, Object> CACHE = new HashMap<>();
}
```

Jika cache berisi object class webapp dan tidak pernah clear, redeploy bisa retain classloader.

### 21.3 Production Rule

```text
Prefer restart/replace container or pod over hot redeploy for critical production systems.
```

Di containerized deployment, immutable image + rolling replacement lebih predictable daripada hot redeploy berulang dalam JVM yang sama.

---

## 22. Error Handling dan Performance

### 22.1 Expensive Error Pages

Error page sering dianggap sederhana, tetapi bisa menjadi bottleneck saat incident.

Buruk:

```jsp
<%@ page isErrorPage="true" %>
<app:renderFullMenu />
<app:loadUserNotifications />
<app:renderAuditContext />
```

Saat sistem sedang error, error page malah memanggil service yang sama-sama bermasalah.

### 22.2 Safe Error Page

Error page harus:

1. minimal,
2. tidak memanggil DB/service berat,
3. tidak membuka stack trace ke user,
4. tetap punya correlation id,
5. punya cache header aman,
6. tidak bergantung pada session besar.

Contoh:

```jsp
<h1>Something went wrong</h1>
<p>Reference ID: <c:out value="${requestScope.correlationId}" /></p>
```

### 22.3 Error Storm

Jika ada bug di JSP yang sering diakses, error page bisa dipanggil terus. Pastikan:

1. logging rate limit,
2. alert berdasarkan error rate,
3. no expensive fallback,
4. no recursive error page failure.

---

## 23. Caching Header untuk Protected JSP

Protected server-rendered page biasanya tidak boleh disimpan sembarangan.

### 23.1 Common Header

Untuk sensitive authenticated pages:

```http
Cache-Control: no-store
Pragma: no-cache
Expires: 0
```

`no-store` adalah instruksi kuat agar cache tidak menyimpan response.

### 23.2 Trade-off

`no-store` aman, tetapi bisa mengurangi browser back/forward caching dan membuat page reload penuh.

Untuk intranet/admin/regulatory system, keamanan biasanya lebih penting daripada back button caching.

### 23.3 Public Page

Untuk public page tanpa personal data, cache bisa lebih longgar:

```http
Cache-Control: public, max-age=300
```

### 23.4 Personalized But Non-Sensitive

Bisa memakai:

```http
Cache-Control: private, max-age=60
```

Tetapi untuk sistem enforcement/regulatory, hati-hati. Banyak data tampak “non-sensitive” tetapi tetap operationally sensitive.

---

## 24. Pagination dan Large Table Rendering

JSP sering dipakai untuk list/table. Ini area performance besar.

### 24.1 Anti-Pattern

```java
List<Case> cases = caseRepository.findAll();
request.setAttribute("cases", cases);
```

```jsp
<c:forEach items="${cases}" var="c">
  <tr>...</tr>
</c:forEach>
```

Masalah:

1. query besar,
2. memory besar,
3. HTML besar,
4. browser lambat,
5. export expectation salah,
6. timeout.

### 24.2 Better Pattern

```text
Search criteria
  ↓
validated query object
  ↓
page request: page, size, sort
  ↓
service returns Page<CaseRowView>
  ↓
JSP renders only current page
```

### 24.3 Display vs Export

UI display dan export harus dipisah.

| Use case | Strategy |
|---|---|
| User browse results | paginated JSP table |
| User export many rows | async export job/download |
| User audit inspect | filtered/paginated audit view |
| User dashboard summary | aggregated query |

Jangan render 50.000 row ke JSP karena user ingin export.

---

## 25. Formatting Cost: Date, Number, Locale

Formatting bisa mahal jika dilakukan berulang tanpa kontrol.

Contoh:

```jsp
<fmt:formatDate value="${row.createdAt}" pattern="dd/MM/yyyy HH:mm:ss" />
```

Untuk 50 row, aman. Untuk 5000 row, cost terasa.

### 25.1 Strategy

1. Untuk table besar, paginate.
2. Untuk hot path, precompute display string di view model.
3. Untuk locale-sensitive page, pastikan locale/timezone jelas.
4. Hindari membuat formatter custom baru per expression jika bisa.
5. Cache reference data/message bundle di layer yang tepat.

### 25.2 Jangan Mengorbankan Correctness

Jangan mengganti formatting dengan string manual yang salah timezone/locale hanya demi micro-performance.

Correctness untuk tanggal/waktu di enterprise jauh lebih penting.

---

## 26. Internationalization dan Message Bundle Performance

Message lookup biasanya cukup cepat, tetapi masalah muncul jika:

1. bundle terlalu banyak,
2. lookup key dinamis berlebihan,
3. missing key terjadi masif,
4. reload bundle aktif di production,
5. remote/config service dipakai untuk setiap label.

### 26.1 Best Practice

1. Bundle lokal di classpath untuk label stabil.
2. Versioned deployment untuk message changes.
3. Missing key logging dengan rate limit.
4. Pre-validate keys untuk important views.
5. Jangan remote-call per label dari JSP.

---

## 27. JSP dan Virtual Threads: Apa Relevansinya?

Java 21+ membawa virtual threads sebagai fitur penting, dan Java 25 meneruskan era modern Java. Namun JSP sendiri tidak otomatis menjadi “lebih cepat” hanya karena virtual threads.

### 27.1 Yang Perlu Dipahami

Virtual threads membantu model request-per-thread jika bottleneck utamanya blocking I/O dan stack/container mendukungnya.

Tetapi JSP rendering cost bisa tetap:

1. CPU-bound,
2. allocation-heavy,
3. EL/tag reflection-heavy,
4. session lock-bound,
5. browser payload-bound.

Virtual threads tidak memperbaiki:

1. HTML terlalu besar,
2. N+1 query dari getter,
3. session bloat,
4. bad cache header,
5. XSS escaping salah,
6. component/tag misuse.

### 27.2 Rule

```text
Virtual threads can improve concurrency under blocking I/O.
They do not replace view-layer design discipline.
```

---

## 28. Java 8 sampai Java 25: Operational Implications

### 28.1 Java 8 Era

Umum untuk legacy JSP/JSF:

1. Java EE 7/8,
2. `javax.*`,
3. JSP 2.x,
4. JSTL 1.2,
5. JSF 2.x,
6. app server older,
7. hot deployment lebih umum.

Operational concern:

1. older GC behavior,
2. PermGen sudah hilang sejak Java 8, tetapi Metaspace tetap bisa naik karena classloader leak,
3. weak observability in old apps,
4. large session in monolith.

### 28.2 Java 11/17 Era

1. stronger module encapsulation concerns,
2. modern TLS/security defaults,
3. newer containers,
4. Jakarta transition planning,
5. better GC options.

### 28.3 Java 21/25 Era

1. virtual threads relevance,
2. modern LTS baseline,
3. records useful for immutable view models,
4. better runtime diagnostics,
5. Jakarta EE 11 baseline requires Java SE 17+,
6. old `javax.*` stack may block upgrade.

### 28.4 Performance Migration Trap

Migrasi Java/container bisa mengubah:

1. JSP compiler behavior,
2. tag pooling behavior,
3. EL implementation behavior,
4. classloader behavior,
5. default encoding,
6. cache/reload configuration,
7. session serialization behavior.

Jadi migration test harus mencakup rendering/performance, bukan hanya compile success.

---

## 29. Production Diagnostics Playbook

Bagian ini praktis: gejala → kemungkinan penyebab → langkah diagnosis.

### 29.1 First Request Lambat Setelah Deploy

Kemungkinan:

1. JSP lazy compilation,
2. classloading,
3. cold database pool,
4. cold cache,
5. JIT warm-up,
6. first message bundle load.

Diagnosis:

1. cek log JSP compilation,
2. bandingkan first request vs second request,
3. lakukan warm-up endpoint,
4. precompile JSP,
5. ukur startup readiness.

Solusi:

1. precompilation,
2. deployment warm-up,
3. readiness gate setelah warm-up,
4. avoid routing traffic before app ready.

### 29.2 Semua Request ke Page Tertentu Lambat

Kemungkinan:

1. query/service lambat,
2. large table,
3. N+1 getter,
4. custom tag service call,
5. ELResolver mahal,
6. layout include berat,
7. payload terlalu besar.

Diagnosis:

1. measure controller data time vs render time,
2. log query count,
3. profile CPU,
4. capture response size,
5. check DB/service traces,
6. reduce data set and compare.

Solusi:

1. pagination,
2. view model precompute,
3. batch permission/reference lookup,
4. reduce nested tags,
5. cache reference data,
6. split page.

### 29.3 Response Already Committed

Kemungkinan:

1. output flush terlalu awal,
2. buffer penuh,
3. redirect/forward dari JSP,
4. error setelah body besar ditulis,
5. include melakukan flush.

Diagnosis:

1. cari `flush`, `out.flush`, `response.flushBuffer`,
2. cek JSP buffer directive,
3. lihat stack trace,
4. cek output sebelum redirect/forward.

Solusi:

1. pindahkan redirect/forward ke controller/filter,
2. jangan flush manual,
3. kurangi output sebelum decision,
4. perbaiki error handling.

### 29.4 Memory Naik Setelah Banyak User

Kemungkinan:

1. session bloat,
2. session tidak invalidated,
3. application cache tanpa eviction,
4. classloader leak,
5. large uploaded files in session,
6. huge view model stored in session.

Diagnosis:

1. heap dump,
2. inspect session attributes,
3. session count/size metrics,
4. GC logs,
5. redeploy leak check,
6. cache size metrics.

Solusi:

1. shrink session,
2. store IDs not graphs,
3. TTL/eviction cache,
4. clean ThreadLocal/static references,
5. move files to object storage/temp store,
6. session timeout policy.

### 29.5 CPU Tinggi di App Server

Kemungkinan:

1. rendering huge HTML,
2. EL/tag loops,
3. formatting thousands of values,
4. regex/helper in custom tag,
5. compression CPU,
6. JSON/string building in JSP,
7. JSP recompilation loop.

Diagnosis:

1. CPU profiler,
2. thread dump,
3. check compilation logs,
4. compare compressed/uncompressed,
5. measure rows rendered.

Solusi:

1. pagination,
2. precompute display values,
3. optimize custom tags,
4. move compression to proxy/tune level,
5. disable runtime dev reload in production,
6. reduce payload.

### 29.6 JSP Tidak Update Setelah Deploy

Kemungkinan:

1. browser/proxy cache,
2. old node still serving,
3. stale work directory,
4. wrong artifact deployed,
5. container development/reload config,
6. static asset cache.

Diagnosis:

1. add build/version marker,
2. check response header,
3. hit each node,
4. inspect deployed artifact,
5. clear work dir in non-prod,
6. verify asset fingerprint.

Solusi:

1. immutable deployment,
2. rolling deploy with drain,
3. asset versioning,
4. clean deploy pipeline,
5. node version endpoint.

---

## 30. Production Readiness Checklist untuk JSP

### 30.1 Build/Deploy

- [ ] JSP syntax/translation checked before production traffic.
- [ ] No manual mutation of JSP files in production.
- [ ] Artifact immutable.
- [ ] Build version visible in diagnostics.
- [ ] Runtime development reload disabled or controlled.
- [ ] Warm-up strategy exists for critical pages.

### 30.2 Rendering

- [ ] Page uses request-scoped display-ready view model.
- [ ] No database/service calls from JSP, getter, custom tag, or ELResolver hot path.
- [ ] Large lists paginated.
- [ ] No huge object graph in session.
- [ ] Layout includes are understandable and bounded.
- [ ] Custom tags reset request-specific state.

### 30.3 Buffer/Response

- [ ] Redirect/forward decided before body rendering.
- [ ] No manual flush in normal JSP.
- [ ] Error pages are minimal.
- [ ] Cache headers set before rendering.
- [ ] Content type and encoding explicit.

### 30.4 Security

- [ ] Context-aware escaping used.
- [ ] Protected HTML uses safe cache policy.
- [ ] CSRF token not cached incorrectly.
- [ ] Hidden fields not trusted.
- [ ] View visibility is not treated as authorization enforcement.
- [ ] Error page does not leak stack traces/sensitive data.

### 30.5 Static Assets

- [ ] CSS/JS/images versioned or fingerprinted.
- [ ] Long cache only for versioned assets.
- [ ] Dynamic HTML not accidentally cached publicly.
- [ ] Asset URLs generated centrally.

### 30.6 Observability

- [ ] Request duration per URL/view captured.
- [ ] Response size captured or sampled.
- [ ] Query count/service timing available.
- [ ] Correlation id visible in logs and error pages.
- [ ] Session count/size approximations monitored.
- [ ] Error rate alert configured.

---

## 31. Design Heuristics: Cara Berpikir Engineer Senior

### 31.1 JSP Is a Rendering Layer, Not a Computation Layer

JSP boleh melakukan display control sederhana, tetapi tidak boleh menjadi tempat computation berat.

```text
Good JSP:
  render display-ready model.

Bad JSP:
  query, authorize, aggregate, transform, compute workflow.
```

### 31.2 Make Runtime Cost Visible

Kalau sebuah JSP page penting, harus bisa dijawab:

1. Berapa query yang terjadi?
2. Berapa response size?
3. Berapa render time?
4. Berapa row dirender?
5. Berapa session size impact?
6. Apakah page cacheable?
7. Apakah first request compile?

Jika tidak bisa dijawab, page itu belum operationally mature.

### 31.3 Optimize Boundaries Before Micro-Optimizing Tags

Urutan optimasi yang benar:

```text
1. Fix data volume.
2. Fix query/service path.
3. Fix session usage.
4. Fix payload size.
5. Fix layout/include complexity.
6. Fix EL/tag hot spots.
7. Tune buffer/compression/container.
```

Jangan mulai dari micro-optimizing `<c:out>` jika page masih render 10.000 row.

### 31.4 Prefer Immutable View Models

Java records sangat cocok untuk modern view model di Java 16+:

```java
public record CaseListPageView(
    String pageTitle,
    List<CaseRowView> rows,
    PaginationView pagination,
    List<AlertView> alerts
) {}
```

Benefit:

1. clear contract,
2. less accidental mutation,
3. easier testing,
4. smaller session risk if kept request-scoped,
5. more readable JSP.

Untuk Java 8, gunakan immutable class biasa.

### 31.5 Treat JSP as Compiled Code

Karena JSP menjadi servlet, maka harus diperlakukan seperti code:

1. versioned,
2. reviewed,
3. tested,
4. precompiled/validated,
5. monitored,
6. deployed immutably.

JSP bukan file “template kecil” yang boleh diedit langsung di server.

---

## 32. Mini Case Study: Slow Case Listing Page

### 32.1 Gejala

User melaporkan:

```text
/cases/search lambat, kadang 8–12 detik.
```

### 32.2 JSP Awal

```jsp
<c:forEach items="${sessionScope.searchResults}" var="c">
  <tr>
    <td>${c.referenceNo}</td>
    <td>${c.applicant.name}</td>
    <td>${c.assignee.displayName}</td>
    <td><fmt:formatDate value="${c.createdAt}" pattern="dd/MM/yyyy" /></td>
    <td>
      <c:if test="${permissionService.canApprove(user, c)}">
        <button>Approve</button>
      </c:if>
    </td>
  </tr>
</c:forEach>
```

### 32.3 Masalah

1. `searchResults` disimpan di session.
2. Result bisa ribuan row.
3. `applicant` dan `assignee` mungkin lazy association.
4. Permission service dipanggil per row.
5. Date formatting dilakukan untuk semua row.
6. HTML payload besar.
7. Session replication mahal.

### 32.4 Refactor

Controller/service:

```java
Page<CaseRowView> page = caseSearchService.search(criteria, pageRequest);
request.setAttribute("caseList", new CaseListPageView(
    "Case Search",
    page.rows(),
    PaginationView.from(page),
    alerts
));
```

View model:

```java
public record CaseRowView(
    String id,
    String referenceNo,
    String applicantName,
    String assigneeName,
    String createdDateLabel,
    boolean canApprove,
    String detailUrl
) {}
```

JSP:

```jsp
<c:forEach items="${caseList.rows}" var="row">
  <tr>
    <td><a href="${row.detailUrl}"><c:out value="${row.referenceNo}" /></a></td>
    <td><c:out value="${row.applicantName}" /></td>
    <td><c:out value="${row.assigneeName}" /></td>
    <td><c:out value="${row.createdDateLabel}" /></td>
    <td>
      <c:if test="${row.canApprove}">
        <button type="submit" name="caseId" value="${row.id}">Approve</button>
      </c:if>
    </td>
  </tr>
</c:forEach>
```

### 32.5 Improvement

1. Data paginated.
2. No session result bloat.
3. No service call from JSP.
4. Permission batched/precomputed.
5. Date label precomputed.
6. Smaller HTML.
7. Easier test.
8. Cleaner operational metrics.

---

## 33. What Top 1% Engineers Notice

Engineer biasa melihat JSP sebagai “view file”. Engineer kuat melihatnya sebagai:

```text
compiled servlet + expression resolver + tag execution engine + response buffer + session boundary + generated HTML payload + operational artifact
```

Mereka bertanya:

1. Apakah page compile sebelum traffic?
2. Apakah render path melakukan I/O tersembunyi?
3. Apakah response bisa committed terlalu awal?
4. Apakah session menyimpan data yang tidak perlu?
5. Apakah output size masuk akal?
6. Apakah cache headers sesuai sensitivity?
7. Apakah static assets versioned?
8. Apakah error page aman saat dependency down?
9. Apakah custom tags stateless/thread-safe?
10. Apakah migration `javax` ke `jakarta` mengubah behavior runtime?

Ini level berpikir yang membedakan “bisa membuat JSP” dari “bisa mengoperasikan sistem JSP enterprise”.

---

## 34. Ringkasan

JSP performance dan operations harus dipahami dari pipeline lengkap:

```text
JSP source
  ↓
translation
  ↓
compilation
  ↓
classloading
  ↓
request rendering
  ↓
EL/tag execution
  ↓
response buffering
  ↓
commit
  ↓
HTML/browser/runtime operation
```

Prinsip utama:

1. Precompile atau validate JSP sebelum production traffic.
2. Jangan jadikan JSP tempat query/service/computation berat.
3. Gunakan display-ready view model.
4. Pagination lebih penting daripada micro-optimizing tags.
5. Session adalah resource mahal, bukan tempat sampah state.
6. Buffer/commit harus dipahami agar redirect/error handling aman.
7. Static asset harus versioned.
8. Protected dynamic HTML harus punya cache policy aman.
9. Observability harus bisa membedakan data time vs render time.
10. Treat JSP as compiled production code.

---

## 35. Referensi

1. Jakarta Pages 4.0 Specification — https://jakarta.ee/specifications/pages/4.0/jakarta-server-pages-spec-4.0
2. Jakarta Pages Specification Index — https://jakarta.ee/specifications/pages/
3. Jakarta Servlet `ServletResponse` API — https://jakarta.ee/specifications/servlet/6.0/apidocs/jakarta.servlet/jakarta/servlet/servletresponse
4. Apache Tomcat Jasper JSP Engine How-To — https://tomcat.apache.org/tomcat-9.0-doc/jasper-howto.html
5. Jakarta EE Platform 11 Specification — https://jakarta.ee/specifications/platform/11/
6. Jakarta Expression Language 6.0 Specification — https://jakarta.ee/specifications/expression-language/6.0/
7. Jakarta Standard Tag Library 3.0 Specification — https://jakarta.ee/specifications/tags/3.0/
8. OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
9. OWASP CSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

---

## 36. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
13-testing-jsp-and-tag-libraries.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 11 — JSP Security: XSS, CSRF, Output Encoding, Session, and Headers](./11-jsp-security-xss-csrf-output-encoding-session-headers.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 13 — Testing JSP and Tag Libraries](./13-testing-jsp-and-tag-libraries.md)
