# Part 27 — Library Ecosystem: Mojarra, MyFaces, OmniFaces, PrimeFaces, dan Konteks Component Library Jakarta Faces

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> Part: `27-library-ecosystem-mojarra-myfaces-omnifaces-primefaces.md`  
> Fokus: memahami ecosystem Jakarta Faces secara arsitektural, bukan sekadar memilih dependency.

---

## 1. Tujuan Part Ini

Setelah memahami lifecycle, component tree, state management, Ajax, composite component, custom component, security, dan performance, sekarang kita masuk ke layer ecosystem.

Di Jakarta Faces, ecosystem bukan aksesoris kecil. Pilihan implementation dan library dapat memengaruhi:

1. kompatibilitas Java EE/Jakarta EE,
2. namespace `javax.*` vs `jakarta.*`,
3. behavior lifecycle,
4. state saving,
5. Ajax behavior,
6. resource handling,
7. memory footprint,
8. upgrade risk,
9. security posture,
10. maintainability UI selama bertahun-tahun.

Top engineer tidak hanya bertanya:

> “Library mana yang populer?”

Tetapi bertanya:

> “Library mana yang paling cocok dengan lifecycle, state model, deployment model, migration path, dan risk profile sistem saya?”

Part ini akan membahas empat aktor utama:

1. **Mojarra** — reference/compatible implementation Jakarta Faces dari Eclipse EE4J.
2. **Apache MyFaces** — alternative implementation Jakarta Faces dari Apache.
3. **OmniFaces** — utility library yang menutup banyak gap praktis Faces.
4. **PrimeFaces** — component library kaya fitur untuk membangun UI enterprise cepat.

Kita juga akan membahas bagaimana memilih, menggabungkan, menguji, dan memigrasikan semuanya.

---

## 2. Mental Model Ecosystem Jakarta Faces

Jakarta Faces ecosystem dapat dipikirkan sebagai beberapa lapisan.

```text
Application Code
  ├─ XHTML Facelets
  ├─ CDI Backing Beans
  ├─ Validators / Converters
  ├─ Composite Components
  └─ Application Services

Component / Utility Libraries
  ├─ OmniFaces
  ├─ PrimeFaces
  ├─ Internal Component Library
  └─ Other UI Libraries

Faces Implementation
  ├─ Mojarra
  └─ Apache MyFaces

Jakarta EE Runtime / Servlet Container
  ├─ GlassFish / Payara
  ├─ WildFly
  ├─ Open Liberty
  ├─ Tomcat + explicit Faces libs
  └─ Jetty + explicit Faces libs

Java Runtime
  ├─ Java 8 legacy
  ├─ Java 11
  ├─ Java 17
  ├─ Java 21
  └─ Java 25
```

Kesalahan umum adalah mencampur lapisan ini.

Contoh salah:

> “Kita pakai PrimeFaces, berarti kita sudah punya JSF.”

Lebih tepat:

> PrimeFaces adalah component library di atas Jakarta Faces. Ia tetap membutuhkan Faces implementation seperti Mojarra atau MyFaces, dan tetap berjalan di atas Servlet/Jakarta EE runtime.

Contoh salah lain:

> “OmniFaces menggantikan JSF.”

Lebih tepat:

> OmniFaces adalah utility/enhancement library untuk Faces. Ia tidak menggantikan Faces implementation.

---

## 3. Spesifikasi vs Implementasi vs Library

Ada tiga kategori yang harus dipisahkan.

### 3.1 Spesifikasi

Spesifikasi mendefinisikan kontrak API dan behavior.

Contoh:

```text
Jakarta Faces 4.1
Jakarta Expression Language 6.0
Jakarta Servlet 6.1
Jakarta CDI 4.1
Jakarta Validation 3.1
```

Spesifikasi menjawab:

> “Apa yang harus tersedia dan bagaimana seharusnya perilaku standar?”

### 3.2 Implementasi

Implementasi menjalankan spesifikasi.

Contoh Jakarta Faces implementation:

```text
Mojarra
Apache MyFaces
```

Implementasi menjawab:

> “Siapa yang benar-benar menjalankan component tree, lifecycle, state saving, resource handling, dan rendering?”

### 3.3 Library

Library menambahkan komponen, utility, helper, filter, converter, validator, dan feature tambahan.

Contoh:

```text
OmniFaces
PrimeFaces
```

Library menjawab:

> “Apa building block tambahan yang membantu aplikasi?”

---

## 4. Kenapa Pemisahan Ini Penting

Karena saat error production terjadi, sumber masalah bisa berada di lapisan berbeda.

Misalnya:

| Gejala | Kemungkinan Sumber |
|---|---|
| `ViewExpiredException` | Faces implementation, session config, state saving, load balancer |
| Ajax partial update gagal | XHTML id, naming container, PrimeFaces widget, Faces JS resource |
| converter tidak terpanggil | component config, lifecycle, OmniFaces converter, implementation behavior |
| style rusak setelah upgrade | PrimeFaces theme/resource handling |
| `ClassNotFoundException: javax.faces.*` | namespace mismatch |
| memory session membengkak | view scope, server state saving, data table, component library state |
| duplicate component id | Facelets/composite component/internal component design |
| behavior beda di container berbeda | implementation/runtime dependency mismatch |

Top engineer tidak langsung menyalahkan “JSF lambat” atau “PrimeFaces bug”. Ia melacak layer mana yang memiliki tanggung jawab.

---

## 5. Mojarra: Eclipse Implementation Jakarta Faces

Mojarra adalah implementasi Jakarta Faces yang dikelola di Eclipse EE4J. Dalam banyak distribusi Jakarta EE, Mojarra sering menjadi implementation default atau implementation yang paling dekat dengan evolution spesifikasi.

### 5.1 Peran Mojarra

Mojarra menyediakan runtime untuk:

1. `FacesServlet`,
2. component tree,
3. lifecycle execution,
4. state saving,
5. EL integration,
6. converter/validator processing,
7. rendering kit,
8. resource handling,
9. Ajax partial response,
10. Facelets view declaration language.

### 5.2 Kapan Mojarra Umum Dipakai

Mojarra umum dipakai ketika:

1. runtime bawaan sudah menyediakannya,
2. aplikasi berjalan di server Jakarta EE yang bundled dengan Mojarra,
3. tim ingin mengikuti implementation yang dekat dengan reference lineage,
4. compatibility matrix vendor sudah diuji dengan Mojarra.

Contoh runtime yang sering diasosiasikan dengan Mojarra:

```text
GlassFish
Payara
```

Namun dependency final tetap harus dicek per versi server.

### 5.3 Kekuatan Mojarra

1. Umumnya cepat mengikuti spesifikasi baru.
2. Sering menjadi baseline testing untuk banyak aplikasi Jakarta Faces.
3. Dokumentasi dan issue history cukup mudah ditemukan.
4. Banyak behavior legacy JSF/Faces familiar berasal dari Mojarra ecosystem.
5. Cocok untuk aplikasi yang ingin “standard-first”.

### 5.4 Risiko Mojarra

Risiko bukan berarti buruk. Ini area yang harus diuji:

1. behavior bisa berbeda dari MyFaces pada edge case,
2. state saving dan serialization perlu diuji pada workload nyata,
3. bug minor di versi tertentu dapat muncul pada composite/custom component kompleks,
4. container-bundled version kadang lebih lambat di-upgrade daripada kebutuhan aplikasi,
5. override implementation dalam full Jakarta EE server bisa berisiko.

### 5.5 Decision Heuristic Mojarra

Gunakan Mojarra bila:

1. server sudah membundelnya secara resmi,
2. organisasi ingin minim custom runtime dependency,
3. aplikasi tidak membutuhkan behavior spesifik MyFaces,
4. compatibility dengan OmniFaces/PrimeFaces sudah diuji,
5. upgrade server dan Faces berjalan sebagai satu unit.

Hindari mengganti Mojarra manual di server full Jakarta EE tanpa alasan kuat.

---

## 6. Apache MyFaces: Alternative Implementation yang Mature

Apache MyFaces adalah implementasi Jakarta Faces dari Apache Software Foundation.

### 6.1 Peran MyFaces

MyFaces juga menyediakan implementation penuh untuk spesifikasi Faces:

1. lifecycle,
2. component tree,
3. state saving,
4. Facelets,
5. Ajax,
6. rendering,
7. resource handling,
8. configuration processing.

Secara konseptual, aplikasi Faces standar seharusnya bisa berjalan di Mojarra atau MyFaces jika tidak bergantung pada implementation-specific behavior.

### 6.2 Kapan MyFaces Umum Dipakai

MyFaces umum dipakai ketika:

1. aplikasi berjalan di runtime yang membundel MyFaces,
2. tim memilih MyFaces explicit di Servlet container seperti Tomcat,
3. organisasi punya pengalaman operasional lebih baik dengan MyFaces,
4. aplikasi membutuhkan tuning/behavior tertentu yang tersedia di MyFaces,
5. deployment ingin lebih eksplisit mengontrol implementation Faces.

Runtime yang sering diasosiasikan dengan MyFaces:

```text
Apache TomEE
OpenWebBeans stack tertentu
Custom Tomcat deployment
```

Tetapi sekali lagi, cek distribusi dan versinya.

### 6.3 Kekuatan MyFaces

1. Mature dan lama digunakan di enterprise.
2. Cocok untuk deployment eksplisit di Servlet container.
3. Apache governance dan release discipline.
4. Sering dipilih oleh tim yang ingin kontrol dependency lebih granular.
5. Dapat menunjukkan behavior/performance yang berbeda pada beberapa workload.

### 6.4 Risiko MyFaces

1. Edge behavior bisa berbeda dari Mojarra.
2. Beberapa third-party library lebih sering diuji di salah satu implementation terlebih dahulu.
3. Dokumentasi issue bisa tersebar di Apache JIRA/GitHub/Mailing List.
4. Mixing API jar dan implementation jar versi berbeda bisa menyebabkan runtime error.
5. Dalam full Jakarta EE server, mengganti implementation bawaan tidak selalu mudah.

### 6.5 Decision Heuristic MyFaces

Pilih MyFaces bila:

1. runtime resmi Anda menggunakannya,
2. deployment berada di Servlet container yang dependency-nya Anda kontrol penuh,
3. aplikasi butuh explicit dependency hygiene,
4. tim punya automated regression suite untuk membandingkan behavior,
5. component library yang dipakai sudah terbukti kompatibel.

---

## 7. Mojarra vs MyFaces: Cara Membandingkan dengan Dewasa

Jangan membandingkan Mojarra dan MyFaces dengan pertanyaan dangkal:

> “Mana yang lebih cepat?”

Pertanyaan yang lebih tepat:

1. Di versi runtime kita, mana yang officially supported?
2. Mana yang sudah diuji dengan library stack kita?
3. Bagaimana behavior state saving pada workload kita?
4. Bagaimana behavior Ajax partial rendering pada komponen kita?
5. Bagaimana memory footprint session/view state?
6. Bagaimana issue history untuk bug yang mirip dengan sistem kita?
7. Bagaimana upgrade path 2.3 → 3.x → 4.x → 4.1?
8. Apakah kita punya regression tests cukup untuk switching implementation?

### 7.1 Comparison Matrix

| Faktor | Mojarra | MyFaces |
|---|---|---|
| Jenis | Faces implementation | Faces implementation |
| Governance | Eclipse EE4J | Apache Software Foundation |
| Umum di | GlassFish/Payara-like environment | TomEE/custom stack/MyFaces-based runtime |
| Cocok untuk | Standard-first, server-bundled implementation | Explicit dependency control |
| Risiko utama | Container-bundled version lock | API/impl version mismatch |
| Testing wajib | Lifecycle, state, Ajax, component library | Lifecycle, state, Ajax, component library |

### 7.2 Prinsip Top 1%

Aplikasi Faces yang baik tidak boleh bergantung pada implementation-specific behavior kecuali benar-benar disengaja dan didokumentasikan.

Jika aplikasi hanya jalan di Mojarra karena memanfaatkan behavior yang tidak dijamin spesifikasi, itu harus menjadi architectural decision record.

Jika aplikasi hanya jalan di MyFaces karena workaround tertentu, itu juga harus menjadi architectural decision record.

---

## 8. OmniFaces: Utility Library untuk Membuat Faces Lebih Praktis

OmniFaces adalah library yang dibuat untuk “make Faces life easier”. Ia menyediakan utility, component, converter, validator, CDI enhancement, filter, dan helper yang sering dibutuhkan di aplikasi Faces nyata.

### 8.1 Peran OmniFaces

OmniFaces bukan component library visual seperti PrimeFaces. Ia lebih cocok disebut:

```text
Faces utility and productivity library
```

OmniFaces membantu di area seperti:

1. CDI integration,
2. view scope improvement,
3. converters,
4. validators,
5. utility components,
6. exception handling,
7. resource handling,
8. Ajax helpers,
9. request parameter helpers,
10. file/resource utilities.

### 8.2 Contoh Masalah yang Biasanya Dibantu OmniFaces

1. Membuat converter entity yang lebih reusable.
2. Menghindari boilerplate converter sederhana.
3. Menyediakan view scope yang lebih predictable pada stack tertentu.
4. Membantu exception handling Faces.
5. Membuat utility untuk `FacesContext`, `ExternalContext`, request, response, session.
6. Membantu conditional rendering dan component manipulation.
7. Mengurangi kode repetitif di backing bean.

### 8.3 Mental Model OmniFaces

OmniFaces adalah “missing practical layer” antara spesifikasi dan kebutuhan production.

```text
Jakarta Faces Spec
  -> correct but intentionally generic

OmniFaces
  -> pragmatic utilities for common real-world problems
```

Namun karena OmniFaces masuk cukup dekat ke internal Faces, compatibility version sangat penting.

### 8.4 Version Compatibility Mindset

OmniFaces memiliki generasi berbeda untuk era berbeda:

```text
OmniFaces 2.x -> legacy JSF/javax era tertentu
OmniFaces 3.x -> JSF 2.3 / Java EE / Jakarta EE 8 era
OmniFaces 4.x -> Jakarta namespace era, Faces 3/4 line, Java 11 baseline
OmniFaces 5.x -> Jakarta EE 11 alignment, Java 17 baseline, Faces 4.1, EL 6.0, Servlet 6.1, CDI 4.1
```

Intinya:

> Jangan hanya upgrade OmniFaces karena ada versi baru. Cocokkan dengan Java version, Faces version, Servlet version, CDI version, dan namespace aplikasi.

### 8.5 Kapan OmniFaces Sangat Berguna

Gunakan OmniFaces bila:

1. aplikasi Faces Anda sudah cukup besar,
2. banyak boilerplate FacesContext/ExternalContext,
3. banyak converter/validator repetitive,
4. butuh helper CDI/Faces integration,
5. butuh utility components yang tidak ingin Anda tulis sendiri,
6. tim ingin mengurangi custom low-level Faces code.

### 8.6 Risiko OmniFaces

1. Version mismatch dapat menyebabkan runtime error.
2. Menggunakan terlalu banyak utility tanpa memahami lifecycle bisa membuat magic tersembunyi.
3. Beberapa fitur mungkin mengandalkan behavior container/Faces tertentu.
4. Upgrade major dapat menghapus API deprecated.
5. Tim bisa menjadi terlalu bergantung pada shortcut, bukan memahami model Faces.

### 8.7 Prinsip Penggunaan OmniFaces

Gunakan OmniFaces untuk mengurangi boilerplate, bukan untuk menutupi ketidaktahuan lifecycle.

Pattern yang baik:

```java
// Service tetap service.
// Backing bean tetap boundary UI.
// OmniFaces membantu plumbing Faces.
```

Pattern yang buruk:

```java
// Semua logic UI, auth, persistence, dan navigation ditambal dengan utility.
```

---

## 9. PrimeFaces: Rich Component Library

PrimeFaces adalah salah satu component library paling populer untuk JSF/Jakarta Faces. Ia menyediakan banyak komponen UI siap pakai.

### 9.1 Peran PrimeFaces

PrimeFaces menyediakan:

1. data table kaya fitur,
2. dialog,
3. menu,
4. form components,
5. file upload,
6. calendar/date picker,
7. tree/table/tree table,
8. chart,
9. growl/messages,
10. layout components,
11. overlay/panel/tab/wizard,
12. Ajax integration,
13. themes,
14. JavaScript widget model.

PrimeFaces bukan pengganti Faces. PrimeFaces membangun komponen di atas Faces.

### 9.2 Kenapa PrimeFaces Populer

Karena banyak UI enterprise membutuhkan:

1. table dengan pagination/sort/filter,
2. modal dialog,
3. date picker,
4. file upload,
5. dashboard widgets,
6. menu/sidebar,
7. form validation display,
8. Ajax partial update,
9. responsive-ish component set,
10. theme system.

Membangun semua itu sendiri dengan komponen standar Faces akan mahal.

### 9.3 Mental Model PrimeFaces

PrimeFaces menambahkan tiga lapisan di atas Faces:

```text
Jakarta Faces component lifecycle
  + PrimeFaces component model
  + PrimeFaces JavaScript widget model
  + PrimeFaces CSS/theme/resource model
```

Saat memakai PrimeFaces, debugging harus mempertimbangkan server dan browser:

1. apakah component server-side diproses?
2. apakah partial response benar?
3. apakah DOM target ada?
4. apakah widget JavaScript initialized?
5. apakah CSS/theme sesuai?
6. apakah resource loaded?

### 9.4 PrimeFaces DataTable sebagai Contoh Complexity

`p:dataTable` tampak seperti satu komponen, tetapi secara arsitektural menggabungkan:

1. component tree,
2. row state,
3. pagination,
4. sorting,
5. filtering,
6. selection,
7. lazy loading,
8. row key,
9. Ajax events,
10. client-side widget,
11. hidden inputs,
12. server-side decoding,
13. model update,
14. rendering HTML kompleks.

Karena itu, bug data table jarang hanya “table bug”. Bisa jadi:

1. row key tidak stabil,
2. equals/hashCode salah,
3. lazy model tidak deterministik,
4. transaction boundary salah,
5. sorting/filtering dilakukan di memory terlalu besar,
6. selected row tidak cocok dengan current page,
7. view state terlalu besar,
8. Ajax update target salah.

### 9.5 Kapan PrimeFaces Cocok

PrimeFaces cocok bila:

1. tim ingin delivery UI enterprise cepat,
2. aplikasi admin/backoffice/regulatory console,
3. kebutuhan table dan form kompleks,
4. server-side UI acceptable,
5. tim memahami Faces lifecycle,
6. kebutuhan UX tidak harus setara SPA modern,
7. tim ingin meminimalkan JavaScript custom.

### 9.6 Kapan PrimeFaces Kurang Cocok

PrimeFaces kurang cocok bila:

1. aplikasi sangat consumer-facing dengan UX sangat custom,
2. butuh offline-first client behavior,
3. frontend team dominan SPA/TypeScript,
4. perlu microfrontend kompleks,
5. state client-side besar dan interaktif,
6. desain harus sangat unik sehingga component override terlalu banyak,
7. performance browser dengan DOM sangat besar menjadi bottleneck.

### 9.7 Risiko PrimeFaces

1. Upgrade major bisa mengubah markup/CSS/API.
2. Theme compatibility perlu diuji.
3. Komponen kaya fitur bisa menghasilkan DOM besar.
4. DataTable bisa menjadi pusat bottleneck.
5. JavaScript widget lifecycle menambah dimensi debugging.
6. Component state bisa memperbesar view state.
7. Aplikasi bisa terlalu tightly coupled dengan PrimeFaces-specific API.
8. Accessibility perlu diuji, jangan diasumsikan otomatis.

### 9.8 Prinsip Penggunaan PrimeFaces

Gunakan PrimeFaces sebagai component accelerator, bukan architecture substitute.

Pisahkan:

```text
PrimeFaces component
  -> rendering and UI interaction

Backing bean
  -> UI orchestration

Service
  -> business operation

Repository
  -> persistence access
```

Jangan menulis business rules di listener komponen hanya karena mudah.

---

## 10. Component Library Lock-In

Library lock-in terjadi ketika aplikasi terlalu bergantung pada API/markup/behavior spesifik library.

### 10.1 Bentuk Lock-In

1. XHTML penuh dengan `p:*` tanpa abstraction.
2. Backing bean memakai class PrimeFaces di banyak tempat.
3. JavaScript custom bergantung pada widget internals.
4. CSS override bergantung pada struktur DOM internal.
5. Test assertion bergantung pada generated markup library.
6. Navigation dan dialog flow bergantung pada API spesifik.
7. Internal component library hanya wrapper tipis PrimeFaces tanpa design boundary.

### 10.2 Lock-In Tidak Selalu Buruk

Lock-in bukan otomatis salah.

Dalam enterprise, lock-in bisa diterima bila:

1. value delivery besar,
2. library mature,
3. support/community baik,
4. upgrade path jelas,
5. risiko didokumentasikan,
6. migration cost dipahami,
7. test suite melindungi upgrade.

Yang buruk adalah **unconscious lock-in**.

### 10.3 Cara Mengendalikan Lock-In

Gunakan pattern berikut:

1. buat internal composite components untuk UI yang sering berulang,
2. bungkus component library pada domain UI sendiri,
3. hindari direct widget JS internal kecuali perlu,
4. dokumentasikan PrimeFaces-specific behavior,
5. isolasi CSS override,
6. buat visual regression/regression tests,
7. upgrade library secara incremental,
8. jangan campur component library terlalu banyak.

---

## 11. Combining Mojarra/MyFaces + OmniFaces + PrimeFaces

Kombinasi umum:

```text
Faces implementation: Mojarra or MyFaces
Utility: OmniFaces
Component library: PrimeFaces
Application: CDI + Facelets + Services
```

### 11.1 Dependency Compatibility Checklist

Sebelum menggabungkan:

1. Java version cocok?
2. Servlet/Jakarta EE version cocok?
3. Faces spec version cocok?
4. Faces implementation version cocok?
5. OmniFaces major version cocok?
6. PrimeFaces major version cocok?
7. Namespace semua sudah `javax` atau semua sudah `jakarta`?
8. Tidak ada duplicate Faces API jar?
9. Tidak ada duplicate implementation jar?
10. Container sudah menyediakan API/impl atau aplikasi membundel sendiri?

### 11.2 Contoh Dependency Thinking

Untuk full Jakarta EE server:

```text
Server menyediakan:
  - Servlet
  - CDI
  - EL
  - Faces implementation

Aplikasi menambahkan:
  - OmniFaces
  - PrimeFaces
```

Untuk Tomcat:

```text
Tomcat menyediakan:
  - Servlet container

Aplikasi perlu menambahkan:
  - Faces API/implementation
  - EL integration sesuai container
  - CDI bila diperlukan
  - OmniFaces
  - PrimeFaces
```

Tomcat bukan full Jakarta EE server. Jadi dependency explicit jauh lebih penting.

---

## 12. Namespace Compatibility: `javax` vs `jakarta`

Ini salah satu penyebab migrasi gagal paling umum.

### 12.1 Legacy Stack

```text
Java EE 8 / Jakarta EE 8
JSF 2.3
JSP 2.3
Servlet 4.0
CDI 2.x
Bean Validation 2.x
Package: javax.*
```

### 12.2 Modern Jakarta Stack

```text
Jakarta EE 9+
Jakarta Faces 3.x/4.x/4.1
Jakarta Pages 3.x/4.x
Jakarta Servlet 5.x/6.x
Jakarta CDI 3.x/4.x
Jakarta Validation 3.x
Package: jakarta.*
```

### 12.3 Jangan Campur

Contoh buruk:

```text
jakarta.faces-api 4.x
+ PrimeFaces javax classifier/version
+ OmniFaces 3.x
+ custom converter import javax.faces.convert.Converter
```

Hasilnya bisa:

```text
ClassNotFoundException
NoClassDefFoundError
MethodNotFoundException
Taglib resolution error
EL resolution issue
```

### 12.4 Migration Rule

Migrasi harus dilakukan sebagai satu compatibility wave:

```text
Java version
Servlet version
Faces version
CDI version
EL version
Validation version
OmniFaces version
PrimeFaces version
Container version
Imports
XHTML namespaces
faces-config schema
web.xml schema
TLD/taglib XML
```

---

## 13. Java 8 sampai Java 25: Dampak ke Ecosystem

### 13.1 Java 8

Java 8 biasanya berarti legacy stack:

```text
JSF 2.x
JSP 2.x
Servlet 3.x/4.x
javax.*
```

Masalah:

1. banyak library modern sudah meninggalkan Java 8,
2. namespace masih `javax.*`,
3. server lama mungkin stuck,
4. security update dan TLS/runtime policy perlu perhatian,
5. upgrade langsung ke Jakarta EE 10/11 biasanya besar.

### 13.2 Java 11

Java 11 sering menjadi intermediate migration step.

Kelebihan:

1. lebih modern daripada Java 8,
2. masih bisa menjalankan beberapa stack transition,
3. banyak library mendukung Java 11.

Risiko:

1. Jakarta EE 11 baseline sudah Java 17+,
2. beberapa library terbaru tidak mendukung Java 11 lagi,
3. bisa menjadi stopgap terlalu lama.

### 13.3 Java 17

Java 17 adalah baseline penting untuk Jakarta EE 11.

Kelebihan:

1. LTS,
2. banyak server modern mendukung,
3. cocok untuk Jakarta EE 11,
4. record/sealed class bisa membantu view model DTO tertentu,
5. library modern lebih aman.

### 13.4 Java 21

Java 21 membawa runtime modern dan virtual threads.

Untuk Faces:

1. virtual threads tidak menghapus biaya component tree/state,
2. render path tetap harus efisien,
3. blocking service call mungkin lebih scalable bila runtime mendukung,
4. session memory tetap bottleneck,
5. database bottleneck tetap bottleneck.

### 13.5 Java 25

Java 25 sebagai LTS terbaru setelah Java 21 dapat menjadi target enterprise jangka panjang, tetapi compatibility ecosystem harus dicek:

1. server support,
2. build plugin support,
3. bytecode compatibility,
4. annotation processing,
5. test framework,
6. container certification,
7. third-party component library.

Rule:

> Jangan upgrade Java runtime tanpa compatibility matrix server + Faces + library + build tools + monitoring agent.

---

## 14. Internal Component Library Strategy

Pada aplikasi enterprise besar, jangan langsung menyebar komponen library eksternal di seluruh halaman tanpa aturan.

Buat internal layer:

```text
/resources/acme/inputText.xhtml
/resources/acme/dateField.xhtml
/resources/acme/actionButton.xhtml
/resources/acme/statusBadge.xhtml
/resources/acme/dataTable.xhtml
/resources/acme/errorSummary.xhtml
```

Layer ini bisa membungkus:

1. standard Faces component,
2. PrimeFaces component,
3. OmniFaces utility,
4. accessibility convention,
5. authorization rendering,
6. error message layout,
7. CSS class convention,
8. audit/data attribute.

### 14.1 Contoh Internal Field Component

```xml
<cc:interface>
    <cc:attribute name="id" required="true" />
    <cc:attribute name="label" required="true" />
    <cc:attribute name="value" required="true" />
    <cc:attribute name="required" default="false" />
</cc:interface>

<cc:implementation>
    <div class="form-field">
        <h:outputLabel for="input" value="#{cc.attrs.label}" />
        <h:inputText id="input"
                     value="#{cc.attrs.value}"
                     required="#{cc.attrs.required}" />
        <h:message for="input" />
    </div>
</cc:implementation>
```

Jika nanti diganti ke PrimeFaces:

```xml
<p:inputText id="input"
             value="#{cc.attrs.value}"
             required="#{cc.attrs.required}" />
```

Halaman pemakai tidak perlu berubah banyak.

### 14.2 Manfaat Internal Component Layer

1. Mengurangi duplikasi.
2. Menjaga consistency.
3. Memudahkan accessibility fix global.
4. Memudahkan theme migration.
5. Mengurangi library lock-in.
6. Memudahkan security hardening.
7. Membuat code review lebih mudah.

### 14.3 Risiko Internal Component Layer

1. Over-abstraction.
2. Wrapper terlalu tipis tanpa value.
3. Wrapper terlalu kaku.
4. Sulit mengekspos semua fitur library.
5. Debugging lebih sulit bila layer terlalu banyak.
6. Versioning internal component harus disiplin.

Prinsip:

> Wrap only what has policy, repetition, risk, or design-system value.

---

## 15. Theming Strategy

Component library biasanya membawa theme system. Ini harus dikelola seperti dependency, bukan file CSS acak.

### 15.1 Theme Risk

1. Markup internal berubah antar versi.
2. CSS class berubah.
3. Custom override pecah.
4. Contrast/accessibility buruk.
5. Component state visual tidak jelas.
6. Mobile layout rusak.
7. Print layout terabaikan.

### 15.2 Theme Governance

Buat aturan:

1. satu theme baseline,
2. satu custom override layer,
3. naming convention CSS internal,
4. tidak override selector internal terlalu dalam kecuali perlu,
5. visual regression untuk halaman kritikal,
6. accessibility test,
7. documented design tokens,
8. release note review saat upgrade.

### 15.3 CSS Override Smell

Buruk:

```css
.ui-datatable table tbody tr td div span:nth-child(2) {
    margin-left: -3px;
}
```

Lebih baik:

```xml
<p:column styleClass="case-status-column">
    ...
</p:column>
```

```css
.case-status-column {
    ...
}
```

Selector yang terlalu bergantung pada DOM internal library adalah upgrade hazard.

---

## 16. Accessibility Concern

Jangan menganggap component library otomatis accessible.

Review:

1. label association,
2. keyboard navigation,
3. focus management,
4. dialog focus trap,
5. ARIA attribute,
6. error summary,
7. screen reader behavior,
8. color contrast,
9. table header semantics,
10. pagination controls,
11. dynamic Ajax update announcement,
12. required field indication.

Component library dapat membantu, tetapi accountability tetap pada application team.

---

## 17. Security Concern in Ecosystem

### 17.1 Faces Implementation

Cek:

1. view state protection,
2. CSRF handling,
3. resource handling,
4. error handling,
5. deserialization/security advisories,
6. default config.

### 17.2 OmniFaces

Cek:

1. filter behavior,
2. utility yang menulis response,
3. exception handler,
4. resource handler,
5. converter yang mengambil entity by id,
6. scope utilities.

### 17.3 PrimeFaces

Cek:

1. raw HTML support,
2. file upload,
3. editor/rich text,
4. remote command,
5. dynamic content,
6. data exporter,
7. dialog rendering,
8. client-side validation,
9. widget JavaScript customization.

### 17.4 Dependency Security

Minimal process:

1. SBOM,
2. dependency scanning,
3. CVE monitoring,
4. pinned versions,
5. release note review,
6. test upgrade branch,
7. rollback plan.

---

## 18. Performance Concern in Ecosystem

### 18.1 Implementation Layer

Measure:

1. restore view time,
2. apply request values time,
3. validation time,
4. update model time,
5. render response time,
6. view state size,
7. component count,
8. session size.

### 18.2 OmniFaces Layer

Measure:

1. filters,
2. converters,
3. validators,
4. utility components,
5. resource handlers,
6. CDI view scope/session effects.

### 18.3 PrimeFaces Layer

Measure:

1. data table render time,
2. row count,
3. DOM size,
4. JavaScript execution,
5. CSS/theme payload,
6. Ajax response size,
7. partial update target size,
8. file upload/download throughput.

### 18.4 Top 1% Rule

Do not discuss JSF/Faces performance abstractly. Measure by page, component count, state size, DB call count, DOM size, and lifecycle phase timing.

---

## 19. Upgrade Strategy

### 19.1 Never Upgrade Blindly

A Faces ecosystem upgrade may affect:

1. Java version,
2. container version,
3. Servlet version,
4. CDI version,
5. EL version,
6. Faces implementation,
7. OmniFaces,
8. PrimeFaces,
9. theme,
10. custom components,
11. XHTML namespace,
12. generated resource paths,
13. JavaScript integration,
14. automated tests.

### 19.2 Recommended Upgrade Flow

```text
1. Inventory current stack
2. Read release notes
3. Build compatibility matrix
4. Create branch
5. Upgrade Java/container first if required
6. Upgrade Faces implementation
7. Upgrade OmniFaces
8. Upgrade PrimeFaces
9. Fix compile errors
10. Fix XHTML/schema/taglib errors
11. Run JSP/Faces compilation smoke test
12. Run integration tests
13. Run visual regression
14. Run security regression
15. Run load/performance tests
16. Deploy to staging
17. Monitor logs and metrics
18. Release with rollback plan
```

### 19.3 Compatibility Matrix Template

```text
Java Runtime        : 17 / 21 / 25
Server              : <name + version>
Servlet             : <version>
Faces Spec          : <version>
Faces Implementation: Mojarra/MyFaces <version>
EL                  : <version>
CDI                 : <version>
Validation          : <version>
OmniFaces           : <version>
PrimeFaces          : <version>
Theme               : <name + version>
Build Tool          : Maven/Gradle <version>
Testing             : JUnit/Arquillian/Selenium/Playwright/etc
Namespace           : javax / jakarta
```

---

## 20. Migration from Legacy JSF 2.x / Java EE 8

### 20.1 Legacy Typical Stack

```text
Java 8
JSF 2.2/2.3
JSP/Facelets
Servlet 3.x/4.x
CDI 1.x/2.x
Bean Validation 1.x/2.x
OmniFaces 2.x/3.x
PrimeFaces older versions
javax.*
```

### 20.2 Modern Target Stack Example

```text
Java 17/21/25
Jakarta EE 10/11
Jakarta Faces 4.x/4.1
Jakarta Servlet 6.x
Jakarta CDI 4.x
Jakarta Validation 3.x
OmniFaces 4.x/5.x depending target
PrimeFaces Jakarta-compatible version
jakarta.*
```

### 20.3 Migration Hazards

1. imports,
2. XML namespaces,
3. taglib URIs,
4. removed deprecated APIs,
5. managed bean legacy removal/behavior,
6. CDI ambiguity,
7. EL behavior,
8. resource naming change,
9. JavaScript resource name change,
10. PrimeFaces theme changes,
11. OmniFaces major version removals,
12. build plugin incompatibility.

### 20.4 Migration Approach

Best approach:

```text
Stabilize legacy app
  -> Add tests
  -> Inventory dependencies
  -> Migrate namespace with tools
  -> Upgrade server/runtime
  -> Upgrade implementation/libs
  -> Fix behavior regressions
  -> Harden security/performance
```

Worst approach:

```text
Change all versions at once
  -> Deploy
  -> Hope
```

---

## 21. Testing Ecosystem Compatibility

### 21.1 Test Categories

1. application startup,
2. Faces config parsing,
3. XHTML compilation/building,
4. page render smoke test,
5. form postback,
6. conversion/validation,
7. Ajax partial update,
8. data table lazy loading,
9. file upload/download,
10. view expired/session timeout,
11. authorization rendering,
12. XSS escaping,
13. theme/resource loading,
14. browser interaction,
15. load test.

### 21.2 Minimal Upgrade Test Set

For each critical page:

```text
GET page
POST valid form
POST invalid form
Ajax update one field
Ajax submit action
Open dialog
Submit dialog
Render data table
Sort/filter/page table
Session timeout then postback
Unauthorized role view
```

### 21.3 What to Log During Compatibility Test

1. Faces implementation and version,
2. OmniFaces version,
3. PrimeFaces version,
4. server version,
5. Java version,
6. state saving mode,
7. project stage,
8. component count per page,
9. view state size,
10. render time.

---

## 22. Operational Diagnostics

At startup, log ecosystem versions.

Example conceptual log:

```text
Java Runtime        : 21.0.x
Server              : Payara/WildFly/Tomcat/etc
Jakarta Faces Impl  : Mojarra 4.1.x / MyFaces 4.1.x
Jakarta Faces Spec  : 4.1
OmniFaces           : 5.x
PrimeFaces          : 15.x
State Saving        : server/client
Project Stage       : Production
```

Why?

Because production incident triage often starts with:

> “What exact stack is this environment running?”

Without this, teams waste hours guessing.

---

## 23. Common Failure Modes

### 23.1 `ClassNotFoundException: javax.faces.*`

Likely cause:

1. Jakarta runtime with legacy library,
2. old custom code import,
3. old component library,
4. old TLD/config.

Fix:

1. align all dependencies to Jakarta namespace,
2. inspect transitive dependencies,
3. run dependency tree,
4. rewrite imports/config.

### 23.2 `NoClassDefFoundError: jakarta.faces.*`

Likely cause:

1. legacy Java EE server,
2. missing Faces API/impl in Servlet container,
3. wrong dependency scope.

Fix:

1. upgrade server,
2. include correct Faces implementation if using Tomcat,
3. check dependency scope.

### 23.3 Ajax Works Locally but Not Production

Possible causes:

1. minified resource/cache issue,
2. missing `faces.js`,
3. CSP blocks script,
4. load balancer/session stickiness,
5. view state invalid,
6. mixed PrimeFaces/Faces JS resources.

### 23.4 PrimeFaces DataTable Slow

Possible causes:

1. no lazy loading,
2. large row count in memory,
3. expensive getters,
4. huge component tree,
5. too many columns,
6. complex converters,
7. N+1 DB calls,
8. view state too large,
9. excessive Ajax render target.

### 23.5 OmniFaces Feature Fails After Upgrade

Possible causes:

1. incompatible OmniFaces major version,
2. Java baseline mismatch,
3. Faces version mismatch,
4. removed deprecated API,
5. CDI behavior change.

---

## 24. Enterprise Decision Framework

When choosing stack, answer these questions.

### 24.1 Runtime

1. Are we on full Jakarta EE server or Servlet-only container?
2. Does the server bundle Faces?
3. Which implementation is supported by vendor?
4. Can we override implementation safely?
5. What Java version is certified/supported?

### 24.2 Library

1. Which OmniFaces version matches our platform?
2. Which PrimeFaces version matches our platform?
3. Are all dependencies `javax` or `jakarta` consistently?
4. Is there a migration guide?
5. Is there active maintenance?

### 24.3 Architecture

1. Do we need rich server-side components?
2. Are pages mostly admin/backoffice?
3. Are data tables central?
4. Do we need custom design system?
5. Can we tolerate server-side state?
6. How large are sessions?

### 24.4 Team

1. Does the team understand Faces lifecycle?
2. Can they debug component tree/Ajax/view state?
3. Are frontend expectations closer to SPA or admin console?
4. Is there test automation?
5. Is there operational monitoring?

### 24.5 Risk

1. What is upgrade frequency?
2. What is CVE response process?
3. What is rollback strategy?
4. What are pages most likely to break?
5. What is vendor/community support?

---

## 25. Recommended Stack Patterns

### 25.1 Legacy Maintenance Stack

```text
Java 8/11
JSF 2.3
javax.*
OmniFaces 3.x
PrimeFaces legacy javax-compatible version
Server: Java EE/Jakarta EE 8 compatible
```

Use when:

1. system is stable,
2. migration budget limited,
3. security support still acceptable,
4. no major new feature investment.

Risk:

1. aging dependency,
2. Java 8 limitations,
3. future migration cost grows.

### 25.2 Modern Jakarta EE 10 Stack

```text
Java 17/21
Jakarta EE 10
Jakarta Faces 4.0
OmniFaces 4.x
PrimeFaces Jakarta-compatible version
jakarta.*
```

Use when:

1. container support is stronger for EE 10,
2. library compatibility proven,
3. team wants modern namespace but not necessarily EE 11.

### 25.3 Modern Jakarta EE 11 Stack

```text
Java 17/21/25 depending support
Jakarta EE 11
Jakarta Faces 4.1
OmniFaces 5.x or compatible line
PrimeFaces modern Jakarta-compatible version
jakarta.*
```

Use when:

1. new project,
2. modernization program,
3. runtime officially supports EE 11,
4. Java 17+ baseline acceptable,
5. testing/observability mature.

---

## 26. Architecture Anti-Patterns

### 26.1 “PrimeFaces Everywhere” Without View Model

Bad:

```xml
<p:dataTable value="#{caseService.findAll()}" var="case">
```

Why bad:

1. service call in getter/render path,
2. no paging boundary,
3. no authorization shaping,
4. no stable view model,
5. hard to test.

Better:

```xml
<p:dataTable value="#{caseListBean.rows}" var="row">
```

```java
public List<CaseRowVm> getRows() {
    return rows;
}
```

### 26.2 Component Library as Business Workflow Engine

Bad:

```java
public void onTabChange(TabChangeEvent event) {
    if (event.getTab().getTitle().equals("Approve")) {
        caseService.approve(caseId);
    }
}
```

UI tab change should not execute irreversible business action.

### 26.3 CSS Fragility

Bad:

```css
.ui-dialog .ui-widget-content div table tr td:nth-child(3) {
    display: none;
}
```

This is brittle and security-dangerous if used to hide sensitive data.

### 26.4 Library Mix Without Governance

Bad:

```text
PrimeFaces + another component library + custom JS framework + random jQuery plugins
```

Risks:

1. conflicting CSS,
2. duplicate JS,
3. lifecycle mismatch,
4. accessibility chaos,
5. upgrade nightmare.

---

## 27. Code Review Checklist

When reviewing a Faces ecosystem PR, ask:

1. Is the component standard Faces, PrimeFaces, OmniFaces, or custom?
2. Is the dependency compatible with current namespace?
3. Is business logic outside component event handler?
4. Is data table lazy/paginated for large data?
5. Are converters safe and not leaking authorization?
6. Are Ajax `execute` and `render` minimal?
7. Is state size controlled?
8. Is CSS override stable?
9. Are labels/accessibility handled?
10. Is sensitive data not merely hidden by UI?
11. Is raw HTML escaped/sanitized?
12. Are file upload/download components configured securely?
13. Are version upgrades documented?
14. Are tests updated?

---

## 28. Practical Dependency Hygiene

### 28.1 Use Dependency Tree

For Maven:

```bash
mvn dependency:tree
```

Look for:

```text
javax.faces
jakarta.faces
javax.servlet
jakarta.servlet
javax.el
jakarta.el
javax.validation
jakarta.validation
```

Mixed namespace is a red flag.

### 28.2 Avoid Duplicate API/Implementation

Bad:

```text
server provides Faces implementation
WAR also bundles different Faces implementation
```

Unless container explicitly supports override, this can create classloading issues.

### 28.3 Pin Versions

Do not rely on accidental transitive versions for core UI libraries.

Use explicit dependency management:

```xml
<dependencyManagement>
    <dependencies>
        <!-- pin core UI ecosystem versions here -->
    </dependencies>
</dependencyManagement>
```

---

## 29. Migration Tooling

Automated tools can help with namespace migration.

They can rewrite:

1. Java imports,
2. XHTML namespace references,
3. XML config,
4. dependency coordinates,
5. selected library upgrades.

But tooling does not fully solve behavior migration.

Manual review still needed for:

1. lifecycle behavior,
2. removed deprecated API,
3. component library markup changes,
4. theme changes,
5. Ajax behavior,
6. custom JavaScript,
7. performance regression.

---

## 30. Case Study: Regulatory Case Management UI Stack

Imagine a regulatory case management UI with:

1. case listing,
2. officer assignment,
3. status transition,
4. document upload,
5. audit trail,
6. internal comments,
7. role-based actions,
8. SLA indicators,
9. escalation flags,
10. reporting/export.

### 30.1 Candidate Stack

```text
Jakarta EE 11 runtime
Jakarta Faces 4.1
Mojarra or MyFaces based on server support
OmniFaces for utilities
PrimeFaces for data table/dialog/file upload
Internal composite component library
CDI backing beans
Service-layer workflow enforcement
```

### 30.2 What PrimeFaces Handles

1. case list table,
2. filters,
3. sorting,
4. pagination,
5. dialogs,
6. file upload widget,
7. date picker,
8. status badge rendering.

### 30.3 What OmniFaces Handles

1. helper utilities,
2. converters,
3. selected CDI/Faces integration utilities,
4. exception handling helpers,
5. resource/request utilities.

### 30.4 What Internal Components Handle

1. permissioned action button,
2. error summary,
3. status badge,
4. audit metadata block,
5. officer selector,
6. SLA indicator,
7. document attachment row.

### 30.5 What Service Layer Handles

1. authorization enforcement,
2. status transition validity,
3. assignment rules,
4. audit record creation,
5. optimistic locking,
6. persistence transaction,
7. notification trigger.

### 30.6 Failure Model

| Failure | Likely Control |
|---|---|
| unauthorized approve button hidden but endpoint still callable | service authorization |
| stale case status | optimistic locking |
| double submit | idempotency + UI disable + server token |
| file upload malicious | content validation + scanning + storage policy |
| table slow | lazy loading + projection + indexes |
| session bloat | view state budget + short-lived view scope |
| action not called | lifecycle/debug Ajax execute |
| status badge inconsistent | internal component + display model |

---

## 31. Top 1% Mental Model

A top engineer sees Jakarta Faces ecosystem like this:

```text
Specification defines contract.
Implementation executes lifecycle.
Utility library reduces boilerplate.
Component library accelerates UI.
Internal components encode product/system policy.
Application services enforce business truth.
Tests protect behavior.
Observability protects production.
```

They do not confuse visual rendering with authorization.
They do not confuse component events with business workflow.
They do not confuse library convenience with architectural correctness.
They do not upgrade dependency without compatibility matrix.
They do not tune performance without measuring component tree, view state, DOM size, and lifecycle phase timing.

---

## 32. Practical Heuristics

1. Prefer server-supported Faces implementation unless you have a tested reason to override.
2. Use OmniFaces to reduce boilerplate, not to hide lifecycle ignorance.
3. Use PrimeFaces for rich admin/backoffice UI, but control DataTable and state size aggressively.
4. Build internal composite components for repeated UI policy.
5. Keep business rules in service layer.
6. Keep authorization enforcement outside the view.
7. Treat CSS/theme as versioned architecture.
8. Test Ajax and postback behavior after every library upgrade.
9. Log runtime/library versions at startup.
10. Never mix `javax.*` and `jakarta.*` accidentally.
11. For Java 8 legacy, plan migration deliberately; for Java 17/21/25, validate container/library support.
12. Every component library decision should include migration and rollback thinking.

---

## 33. Summary

Mojarra, MyFaces, OmniFaces, dan PrimeFaces berada pada layer yang berbeda:

```text
Mojarra/MyFaces -> implementation of Jakarta Faces
OmniFaces       -> utility/productivity enhancement for Faces
PrimeFaces      -> rich UI component library
```

Keempatnya dapat bekerja bersama, tetapi harus disejajarkan secara versi, namespace, runtime, Java baseline, dan behavior.

Kunci menjadi engineer level tinggi bukan hanya tahu library mana yang digunakan, tetapi tahu:

1. tanggung jawab tiap layer,
2. dependency compatibility,
3. failure mode,
4. upgrade risk,
5. security implication,
6. performance implication,
7. testing strategy,
8. operational diagnostics.

Di aplikasi enterprise, ecosystem choice adalah architectural decision, bukan sekadar dependency di `pom.xml`.

---

## 34. Checklist Akhir Part 27

Pastikan Anda bisa menjawab:

1. Apa bedanya Faces specification, implementation, dan component library?
2. Apa peran Mojarra?
3. Apa peran MyFaces?
4. Apa peran OmniFaces?
5. Apa peran PrimeFaces?
6. Mengapa `javax.*` dan `jakarta.*` tidak boleh dicampur sembarangan?
7. Bagaimana memilih Mojarra vs MyFaces?
8. Bagaimana mengevaluasi versi OmniFaces?
9. Bagaimana mengevaluasi versi PrimeFaces?
10. Apa risiko component library lock-in?
11. Bagaimana internal composite component mengurangi lock-in?
12. Apa test minimal setelah upgrade ecosystem?
13. Apa metrik performance yang harus dilihat untuk Faces + component library?
14. Bagaimana debugging DataTable lambat?
15. Bagaimana membuat compatibility matrix?

Jika semua bisa dijawab, Anda sudah punya fondasi ecosystem-level yang kuat.

---

## 35. Status Seri

Seri belum selesai.

Bagian berikutnya:

```text
28-migration-playbook-java-ee-jsp-jsf-legacy-to-jakarta-pages-faces.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./26-faces-performance-and-scalability-lifecycle-cost-state-size-component-trees.md">⬅️ Part 26 — Faces Performance and Scalability: Lifecycle Cost, State Size, Component Trees</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./28-migration-playbook-java-ee-jsp-jsf-legacy-to-jakarta-pages-faces.md">Part 28 — Migration Playbook: Java EE/JSP/JSF Legacy to Jakarta Pages/Faces ➡️</a>
</div>
