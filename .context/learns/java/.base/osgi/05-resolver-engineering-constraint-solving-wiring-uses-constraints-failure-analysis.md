# Part 5 — Resolver Engineering: Constraint Solving, Wiring, Uses Constraints, and Failure Analysis

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `05-resolver-engineering-constraint-solving-wiring-uses-constraints-failure-analysis.md`  
Target Java: 8 sampai 25  
Level: Advanced / architecture + runtime engineering

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah melihat bahwa OSGi dependency model bukan sekadar dependency Maven. OSGi runtime tidak berpikir dalam bentuk “JAR A depends on JAR B” saja. OSGi berpikir dalam bentuk:

- resource,
- requirement,
- capability,
- namespace,
- package import/export,
- version range,
- wiring,
- class space consistency,
- lifecycle state.

Part ini membahas pusat dari semua itu: **resolver**.

Resolver adalah bagian OSGi yang menentukan apakah sekumpulan bundle dapat hidup bersama dalam satu framework dan bagaimana bundle-bundle tersebut dihubungkan. Dalam istilah OSGi Core R8, sebuah resource baru bisa menyediakan fungsionalitas setelah di-resolve terhadap environment, dan resolver harus menemukan sekumpulan wires antara requirements dan capabilities sehingga setiap mandatory requirement terpenuhi dan constraint namespace yang terkait juga terpenuhi.

Secara mental model, resolver adalah **constraint solver untuk runtime module graph**.

Setelah selesai membaca part ini, targetnya kamu mampu:

1. Membedakan dependency compile-time, install-time, resolve-time, start-time, dan runtime service dependency.
2. Membaca pesan error resolver dengan mental model yang benar.
3. Memahami kenapa bundle bisa `INSTALLED` tetapi tidak `RESOLVED`.
4. Memahami kenapa bundle bisa `RESOLVED` tetapi tetap gagal `START`.
5. Menjelaskan `uses:=` constraint bukan sebagai “error aneh OSGi”, tetapi sebagai mekanisme menjaga type consistency.
6. Mendiagnosis konflik versi package, duplicate provider, split package, optional import, fragment, dan execution environment.
7. Mendesain dependency graph yang stabil, deterministik, dan mudah di-debug.
8. Membuat playbook troubleshooting untuk production runtime berbasis Felix, Equinox, Karaf, atau bnd-run.

---

## 1. Masalah yang Diselesaikan Resolver

Di aplikasi Java biasa, dependency resolution umumnya selesai sebelum runtime:

```text
Maven/Gradle resolve artifacts
        ↓
classpath dibuat
        ↓
JVM start
        ↓
semua JAR masuk ke satu flat classpath
```

Dalam model classpath tradisional, ketika dua JAR membawa versi package yang berbeda, sering kali JVM tidak tahu bahwa ada konflik desain. Yang terjadi hanya:

- class pertama yang ditemukan menang,
- urutan classpath menentukan nasib,
- error muncul terlambat,
- konflik baru kelihatan saat class tertentu dipakai,
- type inconsistency bisa tersembunyi sampai runtime path tertentu dijalankan.

OSGi mengambil pendekatan berbeda:

```text
Bundle metadata dianalisis
        ↓
requirements dan capabilities dibuat
        ↓
resolver mencari wiring yang valid
        ↓
class space consistency dicek
        ↓
bundle baru boleh RESOLVED
        ↓
bundle bisa START
```

Artinya OSGi mencoba menangkap banyak kegagalan **sebelum kode bisnis berjalan**.

Ini bagus untuk sistem enterprise/plugin jangka panjang, tetapi konsekuensinya: dependency graph harus eksplisit dan konsisten.

---

## 2. Resolver Bukan Maven Resolver

Salah satu kesalahan besar engineer yang baru masuk OSGi adalah menganggap resolver OSGi sama dengan Maven dependency resolver.

Padahal keduanya berada di layer berbeda.

| Aspek | Maven/Gradle Resolver | OSGi Resolver |
|---|---|---|
| Unit utama | artifact / module / coordinate | resource / bundle / capability |
| Waktu kerja | build time | runtime/provisioning time |
| Output | files/JARs di classpath/repository | wires antar requirements/capabilities |
| Granularity | artifact-level | package/capability-level |
| Visibility | flat atau build-module oriented | per-bundle class space |
| Version conflict | mediation/exclusion | explicit constraint satisfaction |
| Lifecycle aware | tidak | iya, terkait resolve state |
| Class identity aware | terbatas | sangat penting |
| Dynamic runtime | tidak | iya |

Contoh sederhana:

```text
Maven says:
  bundle-a.jar needs library-x.jar

OSGi says:
  bundle-a requires package com.example.api version [2.0,3.0)
  bundle-b provides package com.example.api version 2.1.0
  therefore a wire can be made from bundle-a to bundle-b
```

Maven menjawab: “file mana yang dibutuhkan?”  
OSGi menjawab: “class space mana yang valid?”

Itu perbedaan besar.

---

## 3. Vocabulary Resolver: Resource, Requirement, Capability, Wire

Sebelum masuk error analysis, kita harus punya vocabulary yang tepat.

### 3.1 Resource

Dalam OSGi resolver model, resource adalah entitas yang punya:

- requirements,
- capabilities.

Bundle adalah resource, tetapi model resolver bisa lebih generik daripada bundle. Repository juga bisa memodelkan artifact sebagai resource.

### 3.2 Capability

Capability adalah sesuatu yang disediakan resource.

Contoh capability:

```text
Bundle X provides package com.acme.payment.api version 1.4.0
Bundle Y provides extender osgi.component
Bundle Z provides JavaSE execution environment JavaSE-17
```

Dalam manifest, capability bisa berasal dari header seperti:

```text
Export-Package: com.acme.payment.api;version="1.4.0"
Provide-Capability: com.acme.feature;name=payment-v2
```

### 3.3 Requirement

Requirement adalah sesuatu yang dibutuhkan resource.

Contoh:

```text
Bundle A requires package com.acme.payment.api version [1.4,2)
Bundle B requires extender osgi.component
Bundle C requires execution environment JavaSE-17
```

Dalam manifest, requirement bisa berasal dari:

```text
Import-Package: com.acme.payment.api;version="[1.4,2)"
Require-Capability: osgi.extender;filter:="(osgi.extender=osgi.component)"
```

### 3.4 Wire

Wire adalah hasil keputusan resolver: requirement tertentu dipenuhi oleh capability tertentu.

```text
Requirement:
  bundle-order imports com.acme.payment.api [1.4,2)

Capability:
  bundle-payment-api exports com.acme.payment.api 1.5.0

Wire:
  bundle-order → bundle-payment-api for package com.acme.payment.api
```

Wire bukan sekadar dependency list. Wire adalah kontrak classloading aktual.

Jika bundle A wired ke bundle B untuk package `com.acme.payment.api`, maka classloader bundle A akan meminta class package tersebut dari bundle B.

---

## 4. Resolve-Time vs Start-Time

Salah satu miskonsepsi paling umum:

> “Bundle saya tidak start, berarti resolver gagal.”

Belum tentu.

Ada dua tahap berbeda:

```text
INSTALL
  ↓
RESOLVE
  ↓
START
```

### 4.1 Resolve-Time Failure

Resolve-time failure terjadi saat framework belum bisa membuat wiring valid.

Contoh:

```text
missing requirement osgi.wiring.package=com.fasterxml.jackson.databind
```

Artinya package yang dibutuhkan tidak tersedia dari bundle manapun yang cocok.

### 4.2 Start-Time Failure

Start-time failure terjadi setelah bundle sudah resolved, tetapi kode start gagal.

Contoh:

```text
BundleException: Activator start error
Caused by: NullPointerException
```

Atau:

```text
Component unsatisfied reference
```

Ini bukan murni resolver package failure. Ini bisa DS runtime, config admin, activator code, external connection, atau dependency service yang belum tersedia.

### 4.3 Active Tidak Sama Dengan Ready

Bundle `ACTIVE` berarti bundle lifecycle sudah start. Tetapi aplikasi-level readiness belum tentu tercapai.

Misalnya:

- bundle web aktif, tetapi endpoint belum registered,
- DS component aktif, tetapi downstream DB unavailable,
- service registered, tetapi belum warmed up,
- listener aktif, tetapi queue connector belum connected.

OSGi resolver hanya menjawab:

> Apakah class/module requirements bisa dipenuhi secara konsisten?

Resolver tidak menjawab:

> Apakah aplikasi bisnis sudah siap melayani traffic?

Itu harus didesain dengan health check/readiness layer terpisah.

---

## 5. Resolver sebagai Constraint Solver

Mental model terbaik untuk resolver:

```text
Input:
  Installed resources
  Mandatory requirements
  Optional requirements
  Capabilities
  Version ranges
  Namespace rules
  Uses constraints
  Resolve context policy

Process:
  Select candidate capabilities
  Build possible wires
  Check constraints
  Reject inconsistent graphs
  Pick valid graph

Output:
  Resolved wiring graph
```

Ini mirip constraint solving:

```text
Find graph G such that:
  for every mandatory requirement r:
      exists capability c matching r
  for every selected wire:
      namespace rules are satisfied
  for every package space:
      uses constraints are consistent
  for every singleton constraint:
      only one singleton version chosen where required
  for every execution environment requirement:
      environment can satisfy it
```

Kalau tidak ada graph yang memenuhi, resolver gagal.

Ini menjelaskan kenapa error OSGi kadang terasa “tidak intuitif”. Resolver tidak hanya mencari package yang ada. Resolver mencari **kombinasi dependency yang konsisten secara global**.

---

## 6. Package Wiring: Keputusan Paling Penting

OSGi package import/export menghasilkan package wires.

Contoh:

```text
bundle-order
  Import-Package: com.acme.payment.api;version="[1.0,2.0)"

bundle-payment-api
  Export-Package: com.acme.payment.api;version="1.5.0"
```

Jika cocok, wiring menjadi:

```text
bundle-order --com.acme.payment.api--> bundle-payment-api
```

Secara classloading:

```java
// inside bundle-order
PaymentService.class
```

akan diload dari classloader milik `bundle-payment-api`, bukan dari arbitrary classpath.

Ini memberi isolasi dan determinisme.

Namun juga berarti kalau package tidak diekspor, package itu tidak terlihat walaupun JAR-nya ada di repository.

---

## 7. Version Range: Bahasa Kontrak Kompatibilitas

OSGi sangat bergantung pada version range.

Contoh:

```text
Import-Package: com.acme.payment.api;version="[1.2,2)"
```

Artinya:

```text
minimum included: 1.2.0
maximum excluded: 2.0.0
```

### 7.1 Range Umum

| Range | Arti | Risiko |
|---|---|---|
| `[1.2,2)` | kompatibel dengan 1.2 sampai sebelum 2.0 | umum untuk consumer API semver |
| `[1.2,1.3)` | hanya minor line 1.2.x | aman tapi bisa terlalu ketat |
| `[1.2,)` | 1.2 ke atas tanpa batas | berbahaya jika major break |
| `1.2` di beberapa konteks | sering berarti minimum 1.2, bukan exact | bisa disalahpahami |
| `[1.2,1.2]` | exact version | sangat fragile |

### 7.2 Consumer Policy

Untuk package API yang mengikuti semantic versioning, consumer biasanya aman memakai:

```text
[major.minor, major+1)
```

Contoh:

```text
Import-Package: com.acme.case.api;version="[2.3,3)"
```

Artinya consumer dibangun terhadap API 2.3 dan menerima compatible upgrades sampai sebelum 3.0.

### 7.3 Provider Policy

Provider harus export package version sesuai perubahan API.

Contoh:

```text
Export-Package: com.acme.case.api;version="2.4.0"
```

Jika provider menambah method default-compatible atau menambah tipe baru, minor bisa naik. Jika breaking change, major naik.

### 7.4 Version Range Terlalu Luas

```text
Import-Package: com.acme.case.api;version="[1.0,)"
```

Masalah:

- bisa wired ke versi 5.0 yang breaking,
- error muncul sebagai runtime behavior,
- resolver menganggap valid padahal contract bisnis rusak.

### 7.5 Version Range Terlalu Sempit

```text
Import-Package: com.acme.case.api;version="[1.2.3,1.2.3]"
```

Masalah:

- patch upgrade kecil pun gagal,
- deployment terlalu rapuh,
- dependency graph sulit berevolusi.

Top-tier OSGi engineer tidak asal “bikin resolve”. Ia mendesain version range sebagai **policy evolusi**.

---

## 8. Candidate Selection: Kenapa Provider yang Dipilih Bisa Mengejutkan

Misalnya ada provider:

```text
bundle-api-old exports com.acme.rule.api 1.5.0
bundle-api-new exports com.acme.rule.api 1.8.0
```

Consumer:

```text
Import-Package: com.acme.rule.api;version="[1.4,2)"
```

Keduanya cocok.

Pertanyaan: resolver pilih yang mana?

Jawabannya bergantung pada resolve context, framework policy, existing wiring, repository ordering, preferred provider policy, atau resolver implementation detail.

Karena itu production architecture tidak boleh bergantung pada asumsi samar seperti:

> “Pasti resolver pilih versi paling baru.”

Lebih aman:

- pastikan hanya provider yang diinginkan ada di runtime,
- gunakan repository/provisioning yang deterministik,
- gunakan version range jelas,
- hindari duplicate provider untuk package API yang sama jika tidak disengaja,
- gunakan bnd resolver output untuk lock run bundles,
- jangan biarkan runtime mengambil kandidat liar dari deploy folder.

---

## 9. Mandatory vs Optional Requirement

### 9.1 Mandatory Import

```text
Import-Package: com.acme.audit.api;version="[1.0,2)"
```

Jika package tidak tersedia, bundle tidak resolve.

### 9.2 Optional Import

```text
Import-Package: com.acme.audit.api;version="[1.0,2)";resolution:=optional
```

Jika package tidak tersedia, bundle tetap bisa resolve.

Namun optional import bukan berarti aman.

Kode ini tetap bisa gagal:

```java
Class.forName("com.acme.audit.api.AuditClient");
```

atau:

```java
private AuditClient auditClient;
```

jika class benar-benar dibutuhkan di execution path.

### 9.3 Optional Import yang Baik

Optional import cocok jika:

- integrasi benar-benar opsional,
- kode bisa mendeteksi ketersediaan class/service,
- fitur bisa disable gracefully,
- boundary terisolasi,
- tidak ada static reference langsung di class yang selalu diload.

Contoh desain:

```text
core bundle
  tidak import optional library langsung

optional adapter bundle
  import mandatory library optional-feature
  register service only if available

consumer
  reference service optional/dynamic
```

Lebih baik daripada menaruh optional import besar di core bundle.

---

## 10. `uses:=` Constraint: Konsep Paling Sering Membingungkan

`uses:=` adalah salah satu fitur paling penting dan paling sering disalahpahami.

Contoh export:

```text
Export-Package: com.acme.order.api;version="1.0.0";uses:="com.acme.money.api"
```

Artinya:

> Package `com.acme.order.api` menggunakan tipe dari package `com.acme.money.api` dalam signature, inheritance, annotation, generic, atau kontrak publiknya.

Contoh kode:

```java
package com.acme.order.api;

import com.acme.money.api.Money;

public interface Order {
    Money totalAmount();
}
```

Package `com.acme.order.api` “uses” `com.acme.money.api` karena consumer dari `Order` juga harus memahami class `Money` yang sama.

### 10.1 Masalah yang Dicegah `uses:=`

Bayangkan dua provider `Money`:

```text
money-api-v1 exports com.acme.money.api 1.0.0
money-api-v2 exports com.acme.money.api 2.0.0
```

Lalu:

```text
order-api exports com.acme.order.api 1.0.0
          uses com.acme.money.api
          wired to money-api-v1

order-consumer imports com.acme.order.api from order-api
order-consumer imports com.acme.money.api from money-api-v2
```

Secara package name cocok, tetapi class identity tidak cocok.

`Order.totalAmount()` mengembalikan:

```text
com.acme.money.api.Money loaded from money-api-v1 classloader
```

Consumer mengira `Money` adalah:

```text
com.acme.money.api.Money loaded from money-api-v2 classloader
```

Nama sama, class berbeda.

Hasilnya bisa:

```text
ClassCastException
LinkageError
incompatible method signature
mysterious runtime failure
```

`uses:=` memaksa resolver menjaga agar consumer melihat package `Money` dari provider yang konsisten dengan `Order`.

### 10.2 Uses Constraint Bukan Gangguan

Banyak engineer melihat error ini:

```text
Uses constraint violation. Unable to resolve bundle...
```

Lalu berpikir:

> “OSGi terlalu ribet.”

Mental model yang lebih tepat:

> “Resolver menemukan kemungkinan runtime type corruption dan menolak wiring berbahaya.”

`uses:=` adalah safety mechanism.

### 10.3 Uses Constraint Bisa Transitive

Jika:

```text
A uses B
B uses C
C uses D
```

Maka consumer A bisa terdampak keputusan wiring D.

Ini yang membuat uses violation terlihat jauh dari package yang sedang kita pikirkan.

Contoh nyata sering terjadi pada:

- logging API,
- annotation API,
- javax/jakarta packages,
- Jackson packages,
- JAX-RS/CXF/Jersey stacks,
- servlet API,
- OSGi compendium packages,
- Guava/commons types yang bocor ke API.

### 10.4 Prinsip Desain untuk Mengurangi Uses Explosion

Jangan bocorkan tipe library implementation ke API publik.

Buruk:

```java
public interface ReportRenderer {
    com.fasterxml.jackson.databind.JsonNode render(Report report);
}
```

Lebih stabil:

```java
public interface ReportRenderer {
    RenderedReport render(ReportRequest request);
}
```

DTO milik API sendiri lebih aman daripada expose library-specific type.

Buruk:

```java
public interface SearchPlugin {
    org.apache.lucene.search.Query buildQuery(SearchRequest request);
}
```

Lebih aman:

```java
public interface SearchPlugin {
    SearchExpression buildExpression(SearchRequest request);
}
```

Semakin banyak external type masuk public API, semakin kompleks uses constraint graph.

---

## 11. Split Package: Musuh Resolver dan Class Identity

Split package terjadi ketika package yang sama disediakan oleh lebih dari satu bundle.

Contoh:

```text
bundle-a exports com.acme.common
bundle-b exports com.acme.common
```

Atau lebih halus:

```text
bundle-a contains com.acme.common.Strings
bundle-b contains com.acme.common.Dates
```

Dalam classpath tradisional, ini sering “jalan” karena classpath merge semua package.

Dalam OSGi, package adalah unit wiring. Consumer package import tidak bisa setengah mengambil class dari A dan setengah dari B untuk package yang sama.

### 11.1 Kenapa Split Package Buruk

Masalah:

- resolver ambiguous,
- class identity tidak stabil,
- package-private access rusak,
- versioning tidak jelas,
- uses constraint rumit,
- migration ke JPMS makin sulit,
- tooling sulit baseline.

### 11.2 Sumber Split Package

Umum terjadi karena:

- multi-module Maven dengan package sama,
- shaded dependency yang tidak direlokasi,
- library lama yang dibagi beberapa JAR,
- API dan impl berada dalam package yang sama,
- generated code masuk package API,
- fragment dipakai untuk menambah class normal.

### 11.3 Cara Memperbaiki

Pilihan:

1. Gabungkan package ke satu bundle authoritative.
2. Rename package berdasarkan boundary.
3. Pisahkan API dan impl ke package berbeda.
4. Relocate shaded dependency.
5. Hindari export package yang sama dari multiple bundle.
6. Gunakan fragment hanya jika memang patch/resource/platform-specific, bukan normal modularity.

---

## 12. Self-Import dan Substitution

OSGi/bnd sering menghasilkan self-import untuk exported package.

Contoh bundle:

```text
Export-Package: com.acme.audit.api;version="1.2.0"
Import-Package: com.acme.audit.api;version="[1.2,2)"
```

Ini terlihat aneh: bundle mengimport package yang ia export sendiri.

Kenapa bisa terjadi?

Karena OSGi memungkinkan **substitution**: package yang diexport bundle bisa juga diimport dari provider lain jika ada provider lebih sesuai.

### 12.1 Kapan Self-Import Berguna

- Menghindari duplicate class space.
- Memungkinkan API package dipusatkan pada satu provider authoritative.
- Membantu consistency saat bundle membawa API tetapi runtime sudah punya API bundle terpisah.

### 12.2 Kapan Self-Import Membingungkan

- Engineer mengira semua class internal selalu diload dari bundle sendiri.
- Runtime memilih provider lain dan behavior berubah.
- Package API bercampur dengan implementation.

### 12.3 Rule Praktis

Untuk API murni:

- export package dari API bundle authoritative,
- implementation bundle import package API,
- jangan implementation bundle juga export API yang sama kecuali ada alasan kuat.

---

## 13. Require-Bundle Resolution

`Require-Bundle` membuat dependency pada bundle identity, bukan package.

Contoh:

```text
Require-Bundle: com.acme.payment.api;bundle-version="[1.0,2)"
```

Keuntungan:

- mudah dipahami,
- cocok untuk beberapa ecosystem lama seperti Eclipse plugin,
- bisa re-export dependency.

Kerugian:

- coupling terlalu besar,
- consumer terikat ke bundle tertentu,
- package substitution lebih sulit,
- graph lebih rigid,
- upgrade/repackaging lebih sulit,
- bisa menarik package yang tidak perlu.

Dalam resolver, `Require-Bundle` tetap requirement/capability, tetapi namespace-nya bundle, bukan package.

Top-tier heuristic:

```text
Use Import-Package by default.
Use Require-Bundle only when bundle identity itself is the contract.
```

Contoh valid `Require-Bundle`:

- Eclipse RCP plugin ecosystem,
- plugin harus bergantung pada host bundle tertentu,
- bundle menyediakan extension model berbasis identity,
- tidak cukup hanya package contract.

---

## 14. Capability/Requirement Resolution

Modern OSGi tidak terbatas pada package.

Contoh:

```text
Provide-Capability: com.acme.rule.engine;version:Version="2.0";mode="strict"
```

Consumer:

```text
Require-Capability: com.acme.rule.engine;filter:="(&(version>=2.0)(mode=strict))"
```

Ini memungkinkan resolver memodelkan hal yang bukan Java package.

Contoh use case:

- plugin membutuhkan host feature tertentu,
- bundle membutuhkan extender tertentu,
- component membutuhkan DS runtime,
- adapter membutuhkan protocol version,
- product variant membutuhkan capability domain,
- runtime membutuhkan JavaSE-17,
- security plugin membutuhkan crypto provider.

### 14.1 Extender Capability

Declarative Services bundle biasanya membutuhkan DS extender.

Manifest bisa berisi requirement seperti:

```text
Require-Capability: osgi.extender;filter:="(osgi.extender=osgi.component)"
```

Artinya bundle ini tidak cukup hanya punya class. Ia butuh runtime extender yang memproses `Service-Component` metadata.

Tanpa DS extender, bundle mungkin resolved package-wise tetapi component tidak aktif.

### 14.2 Execution Environment Capability

Bundle bisa membutuhkan Java execution environment:

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

Jika runtime Java hanya Java 11, resolver harus menolak.

Untuk Java 8–25, ini penting karena:

- bytecode level berubah,
- removed modules setelah Java 8,
- strong encapsulation Java 9+,
- library lama mungkin belum cocok,
- bundle built for Java 21/25 tidak bisa dijalankan di Java 8/11.

---

## 15. Resolver Context dan Policy

Resolver tidak bekerja dalam ruang kosong. Ia diberi context.

Context menentukan:

- resources mana yang tersedia,
- bundle mana yang mandatory,
- bundle mana yang optional,
- package mana yang boleh dipilih,
- provider mana yang preferred,
- existing wiring mana yang harus dipertahankan,
- repository mana yang dipakai,
- apakah fragment dipertimbangkan,
- apakah singleton conflict ditolak.

Inilah sebabnya hasil resolving bisa berbeda antara:

- bndrun local,
- Felix runtime manual,
- Karaf features,
- Equinox p2,
- AEM/Sling runtime,
- custom launcher.

Bukan karena OSGi tidak deterministik secara prinsip, tetapi karena resolve context/provisioning policy berbeda.

Top-tier production principle:

> Jangan biarkan production runtime “menemukan sendiri” dependency graph dari folder acak. Buat runtime distribution yang resolved dan reproducible.

---

## 16. Existing Wiring dan Refresh Semantics

OSGi runtime bisa dynamic. Bundle bisa diinstall/update saat framework hidup.

Namun wiring tidak selalu langsung berubah.

Jika bundle A sudah resolved dan wired ke provider B, lalu provider C yang lebih baru diinstall, bundle A tidak otomatis pindah wiring.

Kenapa?

Karena mengubah wiring berarti mengubah class space. Itu bisa membuat class yang sudah diload menjadi inconsistent.

Biasanya butuh:

```text
refresh bundle/package wiring
```

atau restart framework/bundle graph tertentu.

### 16.1 Update Tidak Sama Dengan Refresh

```text
update bundle-x
```

belum tentu semua consumer bundle-x langsung wired ulang.

Flow mental:

```text
install/update bundle
  ↓
new revision exists
  ↓
old wiring may still be used
  ↓
refresh required to rewire dependents
  ↓
affected bundles stop/start
```

### 16.2 Production Consequence

Hot update OSGi bisa powerful, tetapi berbahaya jika tidak punya strategy:

- stateful service harus drain,
- in-flight request harus selesai,
- component deactivate harus idempotent,
- old classloader harus bisa GC,
- references harus dilepas,
- cache static harus dibersihkan,
- refresh impact harus diprediksi.

Jika tidak, update kecil bisa menyebabkan:

- stale service reference,
- memory leak classloader,
- half-updated graph,
- runtime behavior berbeda antara node.

---

## 17. Common Resolver Errors dan Cara Membacanya

### 17.1 Missing Package Requirement

Error:

```text
Unable to resolve bundle X:
  missing requirement osgi.wiring.package=com.acme.foo
```

Artinya:

```text
Bundle X import package com.acme.foo, tetapi tidak ada export yang cocok.
```

Kemungkinan penyebab:

1. Provider bundle belum diinstall.
2. Provider bundle ada tetapi tidak export package.
3. Version range tidak cocok.
4. Package hanya private di provider.
5. Package berada di embedded JAR tetapi tidak diexport.
6. Bundle provider gagal resolve.
7. Package name berubah karena javax/jakarta migration.
8. Java runtime tidak memenuhi execution environment provider.

Debug checklist:

```text
- Cari Import-Package bundle X.
- Cari siapa yang Export-Package com.acme.foo.
- Cek version export.
- Cek version range import.
- Cek provider bundle state.
- Cek apakah package private.
- Cek repository/provisioning.
```

### 17.2 Uses Constraint Violation

Error:

```text
Uses constraint violation. Unable to resolve bundle X because it is exposed to package P from bundle A and bundle B via two dependency chains.
```

Artinya:

```text
Bundle X akan melihat package P dari dua provider berbeda melalui chain dependency berbeda.
```

Ini bukan sekadar missing dependency. Ini type consistency conflict.

Debug checklist:

```text
- Identifikasi package P.
- Identifikasi provider A dan B.
- Cari dependency chain pertama.
- Cari dependency chain kedua.
- Cari package yang uses P.
- Pastikan semua consumer wired ke provider P yang sama.
- Hilangkan duplicate provider jika tidak perlu.
- Sesuaikan version range.
- Jangan expose external library type di API jika bisa dihindari.
```

### 17.3 Execution Environment Missing

Error:

```text
missing requirement osgi.ee; filter:="(&(osgi.ee=JavaSE)(version=17))"
```

Artinya runtime Java tidak memenuhi requirement.

Kemungkinan:

- running di Java 11, bundle butuh Java 17,
- bundle compile target terlalu tinggi,
- manifest EE salah,
- framework tidak advertise EE yang benar,
- launcher menggunakan JRE berbeda dari yang dikira.

Debug:

```text
java -version
bundle manifest
framework properties
container launch script
Docker base image
```

### 17.4 Missing Extender

Error atau gejala:

```text
bundle resolved/active, tetapi DS component tidak muncul
```

Kemungkinan:

- DS extender tidak ada,
- `Service-Component` header salah,
- generated XML tidak masuk bundle,
- Require-Capability extender tidak dipenuhi,
- SCR bundle belum start,
- start level salah.

### 17.5 Singleton Conflict

Beberapa bundle symbolic name bisa marked singleton:

```text
Bundle-SymbolicName: com.acme.platform;singleton:=true
```

Jika dua versi singleton sama-sama harus resolved, resolver bisa gagal.

Use case:

- platform plugin yang hanya boleh satu versi,
- Equinox/Eclipse plugins,
- runtime extension yang tidak boleh duplikat.

Debug:

```text
- Cari Bundle-SymbolicName sama.
- Cek singleton directive.
- Cek feature/provisioning yang menarik dua versi.
- Pilih satu versi authoritative.
```

---

## 18. Diagnostic Strategy: Jangan Mulai dari Trial-and-Error

Saat resolver gagal, banyak engineer langsung:

```text
- tambahkan DynamicImport-Package: *
- export semua package
- embed semua dependency
- hapus version range
- pakai Require-Bundle
```

Ini bisa membuat error hilang sementara tetapi merusak arsitektur.

Diagnosis yang benar dimulai dari graph.

### 18.1 Resolver Failure Algorithm

Gunakan langkah ini:

```text
1. Tentukan bundle target yang gagal resolve.
2. Ambil manifest target.
3. Baca semua mandatory requirements.
4. Untuk package missing, cari provider capability.
5. Untuk provider candidate, cek version compatibility.
6. Jika provider ada tapi tidak dipilih, cari constraint lain.
7. Jika uses violation, gambar dua dependency chain.
8. Tentukan package yang harus satu provider.
9. Hilangkan duplicate provider atau align range.
10. Re-run resolver dalam environment terkendali.
```

### 18.2 Selalu Pisahkan 4 Pertanyaan

```text
Q1: Apakah package/class ada di file JAR?
Q2: Apakah package itu diexport sebagai capability?
Q3: Apakah import range consumer cocok dengan export version provider?
Q4: Apakah wiring graph global tetap konsisten?
```

Banyak orang berhenti di Q1.

Di OSGi, “class ada di JAR” tidak cukup.

---

## 19. Tooling untuk Melihat Resolver dan Wiring

### 19.1 bnd / Bndtools

bnd sangat membantu karena bisa resolve sebelum runtime production.

Konsep penting:

```text
-runrequires
-runbundles
-resolve
```

Workflow:

```text
Define required capabilities
        ↓
Run resolver
        ↓
Inspect selected bundles
        ↓
Lock runtime bundle list
        ↓
Run application
```

bnd resolver baik untuk membuat runtime yang reproducible.

### 19.2 Apache Felix Gogo Shell

Command bergantung distribusi, tetapi biasanya ada command untuk:

```text
lb
headers
inspect capability
inspect requirement
diag
resolve
refresh
services
scr:list
scr:info
```

Mental usage:

```text
lb                         # lihat state bundle
headers <id>               # baca manifest
diag <id>                  # lihat unresolved requirement
inspect capability package # lihat exports
inspect requirement package # lihat imports
```

### 19.3 Apache Karaf

Karaf menyediakan shell lebih kaya:

```text
bundle:list
bundle:headers
bundle:diag
bundle:tree-show
package:exports
package:imports
feature:list
feature:info
service:list
scr:list
scr:info
```

Karaf sangat membantu untuk operational troubleshooting karena punya konsep features/provisioning.

### 19.4 Equinox Console

Equinox punya command untuk bundle state, packages, services, dan diagnosis.

Di Eclipse/RCP world, juga ada p2 tooling yang memengaruhi provisioning.

### 19.5 Programmatic Wiring API

OSGi menyediakan API untuk melihat wiring.

Contoh konseptual:

```java
BundleWiring wiring = bundle.adapt(BundleWiring.class);

List<BundleWire> required = wiring.getRequiredWires(null);
List<BundleWire> provided = wiring.getProvidedWires(null);
```

Dengan ini kamu bisa membangun diagnostic endpoint internal:

```text
/api/osgi/bundles/{id}/wiring
/api/osgi/packages/{name}/providers
/api/osgi/services/{interface}/providers
```

Untuk production regulated platform, diagnostic semacam ini sangat bernilai, tentu dengan security guard yang kuat.

---

## 20. Case Study 1: Missing Jackson Package

### 20.1 Situation

Bundle:

```text
com.acme.audit.impl
```

Manifest:

```text
Import-Package: com.fasterxml.jackson.databind;version="[2.15,3)"
```

Runtime error:

```text
missing requirement osgi.wiring.package=com.fasterxml.jackson.databind
```

### 20.2 Naive Fix

Embed Jackson directly:

```text
Bundle-ClassPath: .,lib/jackson-databind.jar
```

Ini bisa jalan, tetapi berisiko:

- duplicate Jackson di beberapa bundle,
- uses constraint dengan Jackson annotations/core,
- class identity issue jika JsonNode bocor ke API,
- security patch sulit,
- bundle size membesar.

### 20.3 Better Analysis

Pertanyaan:

```text
- Apakah Jackson harus shared service/library runtime?
- Apakah Jackson type bocor ke public API?
- Apakah semua bundle butuh versi sama?
- Apakah provider Jackson OSGi-ready tersedia?
- Apakah package import range benar?
```

### 20.4 Better Design

Jika Jackson internal implementation detail:

```text
audit-api bundle
  exports com.acme.audit.api
  no Jackson type in API

audit-impl bundle
  imports Jackson packages
  private implementation
```

Runtime menyediakan Jackson provider bundle yang authoritative.

Atau untuk isolasi plugin:

```text
plugin bundle embeds relocated Jackson
plugin API does not expose Jackson types
```

Relocation/shading bisa diterima jika benar-benar private dan tidak diexport.

---

## 21. Case Study 2: `javax.annotation` vs Framework Export

Di Java 8, banyak `javax.*` package bisa datang dari JDK atau framework/system bundle. Di Java 9+, banyak Java EE modules dihapus/berubah status, dan package harus disediakan library eksternal.

Error umum:

```text
Uses constraint violation because bundle is exposed to package javax.annotation from framework bundle and javax.annotation-api bundle via two dependency chains.
```

Maknanya:

```text
Ada dua provider javax.annotation.
Sebagian graph melihat provider A.
Sebagian graph melihat provider B.
Consumer tertentu harus melihat satu class identity, tetapi resolver menemukan dua chain.
```

### 21.1 Cara Berpikir

Jangan langsung exclude random.

Tanyakan:

```text
- Siapa provider javax.annotation yang authoritative untuk runtime ini?
- Apakah framework system bundle export package tersebut?
- Apakah dependency eksternal juga export package sama?
- Apakah version range consumer align?
- Apakah Java version mengubah availability package?
```

### 21.2 Fix Pattern

- Pilih satu provider authoritative.
- Hindari system bundle dan external bundle sama-sama export package yang sama jika tidak perlu.
- Align boot delegation/system packages secara hati-hati.
- Di Java 11+, sediakan API bundle eksplisit untuk Java EE APIs yang removed.
- Hindari mixed javax/jakarta tanpa boundary jelas.

---

## 22. Case Study 3: Servlet API Conflict

Sistem OSGi web sering punya servlet API dari:

- framework/container,
- embedded Jetty,
- web extender,
- application bundle,
- transitive Maven dependency.

Jika application bundle embed `javax.servlet-api.jar` dan web runtime juga menyediakan servlet API, consumer bisa terkena class identity issue.

### 22.1 Bad Manifest

```text
Bundle-ClassPath: .,lib/javax.servlet-api.jar
Export-Package: javax.servlet.*
```

Ini sangat berbahaya.

### 22.2 Better Manifest

```text
Import-Package: javax.servlet;version="[3.1,5)"
```

Dan runtime web layer menyediakan servlet API.

Untuk Jakarta:

```text
Import-Package: jakarta.servlet;version="[5.0,7)"
```

Jangan campur `javax.servlet` dan `jakarta.servlet` seolah-olah kompatibel. Itu package berbeda.

---

## 23. Case Study 4: Plugin API Bocor Implementation Library

### 23.1 Bad API

```java
package com.acme.plugin.api;

import org.hibernate.Session;
import com.fasterxml.jackson.databind.ObjectMapper;

public interface CasePlugin {
    void execute(Session session, ObjectMapper mapper);
}
```

Akibat:

- plugin API uses Hibernate,
- plugin API uses Jackson,
- semua plugin harus align ke provider Hibernate/Jackson yang sama,
- upgrade Hibernate/Jackson menjadi breaking platform event,
- resolver graph meledak.

### 23.2 Better API

```java
package com.acme.plugin.api;

public interface CasePlugin {
    PluginResult execute(PluginContext context);
}
```

Lalu:

```java
public interface PluginContext {
    CaseView caseView();
    RuleData ruleData();
    PluginLogger logger();
    PluginOutput output();
}
```

Implementation detail seperti Hibernate/Jackson tetap di host implementation bundle.

### 23.3 Resolver Impact

API bundle export:

```text
Export-Package: com.acme.plugin.api;version="1.0.0"
```

Tidak perlu `uses:=org.hibernate` atau `uses:=com.fasterxml.jackson.databind`.

Graph jauh lebih stabil.

---

## 24. Runtime Graph Hygiene

OSGi runtime sehat biasanya punya pola:

```text
api bundles
  export stable API packages
  minimal external type leakage

impl bundles
  import API
  keep implementation private

adapter bundles
  isolate external libraries
  expose stable internal service

feature bundles
  require capabilities, not concrete internals

plugin bundles
  import stable SPI/API
  register services dynamically
```

Runtime tidak sehat biasanya:

```text
all bundles export everything
all imports optional
many embedded duplicate libs
Require-Bundle everywhere
DynamicImport-Package: *
split packages
unclear API ownership
mixed javax/jakarta
random deploy folder state
```

---

## 25. Designing for Deterministic Resolution

### 25.1 Control Provider Count

Untuk setiap API package penting, idealnya ada satu authoritative provider per runtime.

```text
com.acme.case.api → case-api bundle
com.acme.rule.api → rule-api bundle
com.acme.audit.api → audit-api bundle
```

Jangan biarkan implementation bundle juga export API package yang sama.

### 25.2 Use Explicit Version Ranges

Consumer import harus punya range masuk akal.

```text
Import-Package: com.acme.case.api;version="[2.1,3)"
```

Jangan:

```text
Import-Package: com.acme.case.api
```

untuk API yang penting.

### 25.3 Avoid Optional Import for Architecture Dependency

Jika dependency adalah requirement arsitektur, jangan optional.

Buruk:

```text
Import-Package: com.acme.security.api;resolution:=optional
```

Padahal bundle tidak bisa berfungsi tanpa security.

### 25.4 Avoid External Types in Public API

Ini mengurangi uses graph complexity.

### 25.5 Use Resolver Tests

Jangan tunggu production.

Buat test/provisioning check:

```text
- minimal runtime resolves
- full runtime resolves
- each feature resolves
- each plugin pack resolves
- Java 8/11/17/21/25 profile resolves where intended
```

---

## 26. Resolver dan Java 8–25

OSGi dari Java 8 sampai 25 menghadapi beberapa perubahan platform besar.

### 26.1 Java 8

Karakteristik:

- Java EE APIs masih banyak tersedia di JDK,
- classpath assumptions masih umum,
- Security Manager masih relevan,
- banyak legacy OSGi runtime berasal dari era ini.

Risiko:

- system bundle export package yang nanti hilang,
- dependency tidak eksplisit,
- javax packages diasumsikan selalu ada.

### 26.2 Java 9–11

Perubahan besar:

- JPMS muncul,
- strong encapsulation mulai relevan,
- beberapa Java EE/CORBA modules deprecated/removed,
- reflective access mulai bermasalah.

Resolver impact:

- package yang dulu dari JDK harus disediakan bundle eksplisit,
- execution environment harus benar,
- old libraries bisa gagal bukan karena resolver, tetapi karena illegal reflective access atau missing module.

### 26.3 Java 17

Java 17 menjadi baseline modern enterprise.

Risiko:

- old bytecode tools gagal,
- old ASM/ByteBuddy/CGLIB tidak support classfile modern,
- old frameworks yang memakai internal JDK API bermasalah.

Resolver bisa sukses, tetapi start/runtime gagal.

### 26.4 Java 21

Relevant concerns:

- virtual threads bisa dipakai di implementation bundle,
- lifecycle shutdown harus memperhatikan executor/thread cleanup,
- libraries harus support Java 21 classfile jika compile target naik.

Resolver impact mostly via execution environment dan bytecode compatibility.

### 26.5 Java 25

Java 25 sebagai release modern pasca Java 21 membuat compatibility discipline makin penting:

- jangan compile bundle ke Java 25 jika runtime target masih Java 17/21,
- toolchain harus eksplisit,
- EE requirement harus benar,
- testing matrix harus nyata.

Rule praktis:

```text
Build target lowest runtime you support.
Declare execution environment accurately.
Do not use new JDK APIs in shared API bundle unless versioned as new major/minor contract.
```

---

## 27. Resolver Error Classification Matrix

| Symptom | Layer | Most likely cause | First diagnostic |
|---|---|---|---|
| Bundle remains INSTALLED | resolve-time | missing requirement | `diag`, manifest imports |
| Missing `osgi.wiring.package` | resolver/package | no matching export | inspect exports/import range |
| Uses constraint violation | resolver/class space | two providers for used package | trace dependency chains |
| Bundle RESOLVED but not ACTIVE | lifecycle/start | activator or start failure | framework logs |
| DS component unsatisfied | service/component | missing service/config | SCR diagnostics |
| ClassNotFoundException | classloading | package not wired or dynamic load | wiring + TCCL check |
| ClassCastException same FQCN | class identity | duplicate classloaders/provider | package wiring graph |
| Works local, fails prod | provisioning | different runtime graph | compare bundle list/wiring |
| Fails after hot update | refresh/lifecycle | old wiring/stale refs | refresh impact graph |
| Fails only Java 17+ | platform | strong encapsulation/removed APIs | JDK flags/libs |

---

## 28. Practical Debug Playbook

### 28.1 When Bundle Is INSTALLED

```text
1. Run diagnostic command for bundle.
2. Copy exact missing requirement.
3. Identify namespace:
   - osgi.wiring.package
   - osgi.wiring.bundle
   - osgi.ee
   - osgi.extender
   - custom capability
4. Search providers for that namespace.
5. Validate version/filter match.
6. Validate provider state.
7. Resolve provider first if needed.
8. Re-run resolve.
```

### 28.2 When Uses Constraint Violation Happens

```text
1. Do not suppress with DynamicImport.
2. Identify duplicated package provider.
3. Identify both dependency chains.
4. Pick authoritative provider.
5. Align import ranges.
6. Remove duplicate export/embed.
7. Move external type out of API if possible.
8. Rebuild manifest with bnd.
9. Verify wiring graph.
```

### 28.3 When Bundle Starts Locally But Not in Container

```text
1. Compare Java version.
2. Compare framework version.
3. Compare installed bundles.
4. Compare boot/system packages.
5. Compare features/provisioning.
6. Compare generated manifests.
7. Compare config admin files.
8. Compare start levels.
9. Compare bundle cache cleanliness.
```

### 28.4 When Hot Deploy Makes Runtime Inconsistent

```text
1. Stop deploying random bundles manually.
2. Capture bundle list and versions.
3. Capture wiring before/after.
4. Identify stale revisions.
5. Run controlled refresh.
6. Restart affected bundles.
7. Check service registry.
8. Check classloader leak.
9. Move to immutable distribution if repeated.
```

---

## 29. Build-Time Defense: Baseline, Resolve, and Manifest Review

A strong OSGi build pipeline should fail early.

Suggested checks:

```text
- manifest generated by bnd, not manually guessed
- no accidental Export-Package
- no DynamicImport-Package:* unless justified
- no Require-Bundle unless justified
- no split package
- package versions present for exported API
- baseline check passes
- bnd resolve passes for runtime
- Java execution environment is correct
- no private implementation type exposed in API
- no duplicate provider in runtime distribution
```

CI pipeline concept:

```text
compile
  ↓
unit test
  ↓
manifest inspection
  ↓
baseline check
  ↓
resolver test minimal runtime
  ↓
resolver test full runtime
  ↓
in-framework integration test
  ↓
package immutable distribution
```

---

## 30. Runtime Distribution Strategy

### 30.1 Bad Strategy

```text
Copy bundles into deploy folder until it works.
```

Problems:

- non-reproducible,
- hidden dependency graph,
- works on one node, fails on another,
- old bundle remains in cache,
- duplicate versions accumulate,
- no rollback clarity.

### 30.2 Better Strategy

```text
Define runtime requirements
Resolve using repository
Lock selected bundles
Build distribution artifact
Deploy immutable distribution
Keep config external but versioned
```

### 30.3 Production Rule

For production, prefer:

```text
immutable OSGi runtime image
```

over:

```text
mutable hot-deploy runtime
```

Hot deploy is useful for development, plugin operations, controlled extension marketplace, or specific long-running platform needs. But without governance, it becomes runtime entropy.

---

## 31. Architectural Heuristics

### 31.1 Export Only What You Are Willing to Support

Every exported package is a contract.

If you export it, consumers can wire to it.

If consumers wire to it, you now own compatibility.

### 31.2 Imports Describe Your Real Coupling

Generated `Import-Package` is architecture evidence.

Review it.

If an implementation bundle unexpectedly imports 80 packages, ask why.

### 31.3 `uses:=` Reveals API Leakage

If exported package has massive `uses:=`, your API may be too coupled to external types.

### 31.4 Resolver Errors Are Design Feedback

A resolver failure often means:

- boundary unclear,
- version policy wrong,
- dependency duplicated,
- API leaks implementation,
- provisioning not deterministic,
- Java target inconsistent.

Treat it as design feedback, not just build annoyance.

### 31.5 Prefer Boring, Explicit Runtime Graphs

Top-tier modular systems are not clever. They are boringly explicit.

---

## 32. Example: Designing a Clean Enforcement Plugin Graph

Imagine regulatory enforcement lifecycle platform with plugins:

- escalation rule plugin,
- document renderer plugin,
- notification channel plugin,
- external agency connector plugin.

### 32.1 API Bundles

```text
com.acme.enforcement.case.api
com.acme.enforcement.rule.api
com.acme.enforcement.notification.api
com.acme.enforcement.document.api
```

Each exports stable DTO/service packages.

### 32.2 Implementation Bundles

```text
com.acme.enforcement.case.impl
com.acme.enforcement.rule.engine.impl
com.acme.enforcement.notification.impl
```

These import API packages and keep persistence/framework details private.

### 32.3 Plugin Bundles

```text
com.vendor.escalation.highrisk.plugin
com.vendor.document.pdf.plugin
com.vendor.notification.sms.plugin
```

They import only stable SPI/API:

```text
Import-Package:
  com.acme.enforcement.rule.api;version="[2.0,3)",
  org.osgi.service.component.annotations;version="[1.4,2)"
```

They register services:

```java
@Component(service = EscalationRule.class)
public class HighRiskEscalationRule implements EscalationRule {
    @Override
    public RuleDecision evaluate(RuleContext context) {
        // plugin logic
    }
}
```

### 32.4 Avoid This

```java
public interface EscalationRule {
    RuleDecision evaluate(EntityManager em, ObjectMapper mapper, HttpServletRequest req);
}
```

This creates huge dependency graph coupling:

- JPA provider,
- Jackson,
- Servlet API,
- web runtime,
- transaction context,
- classloader consistency.

### 32.5 Better

```java
public interface EscalationRule {
    RuleDecision evaluate(RuleContext context);
}
```

`RuleContext` exposes platform-owned stable abstractions.

Resolver graph becomes cleaner because plugin only depends on platform API packages.

---

## 33. Deep Mental Model: Resolver Protects Runtime Truth

In many systems, dependency conflict appears as runtime chaos.

In OSGi, resolver makes conflict visible earlier.

This can feel painful because it blocks deployment. But it is also the reason OSGi can support long-lived modular runtimes.

Think this way:

```text
Classpath says:
  I found a class. Good luck.

OSGi resolver says:
  I found a possible class, but accepting it would corrupt type consistency across this graph, so I refuse.
```

That refusal is a feature.

---

## 34. Common Bad Fixes and Why They Are Dangerous

### 34.1 `DynamicImport-Package: *`

Looks like magic fix.

Actually:

- delays failure,
- bypasses explicit dependency reasoning,
- makes classloading nondeterministic,
- can hide package ownership errors.

Use only for very specific dynamic plugin/reflection cases.

### 34.2 Export Everything

```text
Export-Package: *
```

Danger:

- exposes internals,
- creates accidental contracts,
- increases uses graph,
- causes resolver ambiguity.

### 34.3 Embed Everything

Danger:

- duplicate classes,
- security patch nightmare,
- memory overhead,
- class identity conflicts.

Embedding is acceptable when:

- dependency is private,
- package is not exported,
- external types do not cross API boundary,
- version isolation is intentional.

### 34.4 Remove Version Ranges

Danger:

- resolver may select incompatible provider,
- upgrade failures become runtime bugs,
- compatibility policy disappears.

### 34.5 Force Start Order

Start level cannot fix invalid wiring.

If bundle cannot resolve, start order is irrelevant.

If service is dynamic, start order is a weak substitute for proper service dependency design.

---

## 35. Resolver Review Checklist

Gunakan checklist ini saat review PR/bundle/runtime.

### 35.1 Manifest

```text
[ ] Bundle-SymbolicName stable and meaningful
[ ] Bundle-Version correct
[ ] Export-Package only API packages
[ ] Exported packages have versions
[ ] Private implementation packages are not exported
[ ] Import-Package ranges are intentional
[ ] No accidental optional imports
[ ] No DynamicImport-Package:* without architecture note
[ ] No Require-Bundle unless justified
[ ] Provide/Require-Capability used for non-package requirements
[ ] Execution environment accurate
```

### 35.2 Resolver Graph

```text
[ ] Runtime resolves from clean repository
[ ] No duplicate provider for same core API package
[ ] No split packages
[ ] Uses constraints are understood
[ ] Java EE/javax/jakarta providers are authoritative
[ ] DS extender is available if DS components exist
[ ] Web/persistence/messaging extenders available as needed
[ ] Bundle wiring can be inspected
```

### 35.3 API Design

```text
[ ] Public API does not expose implementation library types
[ ] DTOs belong to API package
[ ] API package version reflects compatibility
[ ] Service contracts describe thread/lifecycle assumptions
[ ] Plugin SPI does not expose host internals
```

### 35.4 Production

```text
[ ] Runtime bundle list is reproducible
[ ] Deployment does not rely on random deploy folder state
[ ] Refresh impact is understood
[ ] Rollback plan exists
[ ] Diagnostic commands/endpoints are secured
[ ] Framework cache behavior is understood
[ ] Java runtime version matches declared target
```

---

## 36. Summary

OSGi resolver engineering is the skill of reasoning about runtime module graphs before they become production failures.

Core ideas:

1. Resolver is a constraint solver over requirements and capabilities.
2. Bundle resolution is not Maven dependency resolution.
3. Wiring determines actual class visibility and class identity.
4. `uses:=` protects type consistency across package graphs.
5. Version ranges are compatibility policy, not decoration.
6. Optional import is a runtime design choice, not a shortcut.
7. Split packages and duplicate providers create ambiguity.
8. Hot update requires refresh/state strategy.
9. Resolver errors are architecture feedback.
10. Production OSGi should use deterministic provisioning, not accidental runtime state.

A strong OSGi engineer can read a resolver failure as a graph problem:

```text
Which requirement failed?
Which capability should satisfy it?
Why was the candidate rejected?
Which constraint made the graph invalid?
Which boundary/version/provider policy should change?
```

That is the difference between “making OSGi work” and engineering an evolvable modular runtime.

---

## 37. References

- OSGi Alliance, OSGi Core Release 8 — Resource API, Resolver Service, Bundle Wiring, Framework Namespaces.
- OSGi Core R8 Resource API: resources, capabilities, requirements, resolution, wiring.
- OSGi Core R8 Resolver Service: resolve context, resolver service, standard namespaces, uses constraints.
- bnd/Bndtools documentation on resolving and executable runtime assembly.
- Apache Felix framework documentation and Gogo shell diagnostics.
- Eclipse Equinox documentation on framework/runtime and startup issues.
- Apache Karaf documentation on bundle, package, feature, and diagnostic commands.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./04-dependency-model-import-export-require-bundle-capabilities.md">⬅️ Part 4 — Dependency Model: Import-Package, Export-Package, Require-Bundle, Capabilities</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./06-semantic-versioning-package-versions-bundle-versions-api-evolution.md">Part 6 — Semantic Versioning in OSGi: Package Versions, Bundle Versions, API Evolution ➡️</a>
</div>
