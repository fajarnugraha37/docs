# Part 11 — bnd and Bndtools: Build Intelligence for OSGi Engineering

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `11-bnd-bndtools-build-intelligence-osgi-engineering.md`  
Status: Part 11 dari 35

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membangun fondasi OSGi dari sisi runtime:

- bundle lifecycle,
- manifest sebagai kontrak,
- classloader isolation,
- dependency model,
- resolver engineering,
- semantic versioning,
- service registry,
- Declarative Services,
- dynamic topology,
- Configuration Admin.

Sekarang kita masuk ke lapisan yang sering menentukan apakah OSGi project akan menjadi **sistem modular yang sehat** atau menjadi **kumpulan JAR penuh manifest rapuh**: **bnd dan Bndtools**.

bnd adalah tooling engine yang menganalisis bytecode Java, dependency, package reference, annotation, versioning, dan runtime descriptor untuk menghasilkan metadata OSGi yang benar. Bndtools adalah integrasi IDE/workspace yang membuat model ini lebih mudah dipakai secara interaktif.

Tujuan part ini adalah membuat kamu memahami:

1. Kenapa manifest OSGi modern sebaiknya dihasilkan oleh tooling, bukan ditulis manual.
2. Bagaimana bnd berpikir: project, workspace, instruction, macro, package analysis, manifest generation.
3. Bagaimana `bnd.bnd`, `build.bnd`, `cnf`, dan `.bndrun` bekerja.
4. Bagaimana resolver, repository, baseline, test runtime, dan executable distribution dihubungkan.
5. Bagaimana menggunakan bnd bukan sebagai “plugin build”, tetapi sebagai **design feedback system** untuk arsitektur modular.
6. Bagaimana membangun pipeline OSGi yang aman untuk Java 8 sampai Java 25.

Referensi utama:

- OSGi Core Release 8 specification.
- OSGi Compendium Release 8/8.1.
- bnd official documentation.
- Bndtools official documentation.
- Apache Felix Maven Bundle Plugin documentation.
- Apache Felix SCR guidance yang menyarankan OSGi annotations dan bnd-based tooling untuk DS modern.

---

## 1. Mental Model: bnd Bukan Sekadar Manifest Generator

Banyak developer pertama kali mengenal bnd sebagai alat untuk membuat `META-INF/MANIFEST.MF`.

Itu benar, tetapi terlalu sempit.

bnd lebih tepat dipahami sebagai:

> **static analysis and assembly engine for OSGi-based modular Java systems.**

bnd melihat project Java kamu sebagai sekumpulan class, resource, dependency, package, annotation, dan instruction. Dari sana, bnd bisa menghasilkan:

- OSGi manifest,
- Declarative Services XML,
- Metatype XML,
- capability/requirement metadata,
- bundle JAR,
- resolver input,
- runtime descriptor,
- executable runtime,
- baseline compatibility report,
- package import/export analysis,
- warning/error atas boundary modular yang bermasalah.

Jadi bnd bukan hanya build helper. Ia adalah **compiler-like feedback layer** untuk kontrak modular.

Analogi:

| Tool | Yang diperiksa | Feedback |
|---|---|---|
| `javac` | Java source → bytecode | syntax/type error |
| Maven/Gradle | dependency/artifact graph | build dependency error |
| bnd | Java bytecode → OSGi metadata/runtime graph | package boundary, import/export, resolver, baseline, DS metadata |
| OSGi resolver | runtime capability graph | wiring satisfiability |

Top 1% engineer tidak melihat bnd sebagai “tool yang kadang bikin manifest aneh”. Mereka melihat bnd sebagai **observability sebelum runtime**.

---

## 2. Kenapa Manifest Manual Itu Rapuh

Secara teknis kamu bisa menulis manifest seperti ini secara manual:

```text
Bundle-ManifestVersion: 2
Bundle-SymbolicName: com.acme.case.core
Bundle-Version: 1.0.0
Export-Package: com.acme.case.api;version="1.0.0"
Import-Package: org.osgi.framework;version="[1.9,2)",com.fasterxml.jackson.databind;version="[2.15,3)"
Service-Component: OSGI-INF/com.acme.case.core.CaseService.xml
```

Masalahnya bukan pada manifest sederhana. Masalahnya muncul saat:

- class baru mulai memakai package baru,
- dependency transitif berubah,
- library upgrade mengubah package reference,
- DS annotation berubah,
- metatype config berubah,
- API package berubah tetapi version tidak dinaikkan,
- build berjalan di Java 8 tetapi runtime di Java 17/21/25,
- package import harus disesuaikan dengan `uses:=`,
- ada package private yang tidak sengaja diekspor,
- ada implementation package yang bocor ke API,
- ada service annotation yang tidak menghasilkan XML,
- ada package yang harus optional tetapi tertulis mandatory,
- ada library yang seharusnya embedded tetapi tidak masuk `Bundle-ClassPath`.

Manifest manual mengandung masalah klasik:

> **The manifest becomes a stale architectural lie.**

Kode berubah, tetapi manifest tidak ikut berubah. Runtime baru tahu masalahnya saat bundle gagal resolve atau component tidak aktif.

bnd membalik relasinya:

> Source/bytecode menjadi fakta. Manifest dihasilkan dari fakta plus policy.

Contoh:

```properties
Bundle-SymbolicName: com.acme.case.core
Bundle-Version: 1.0.0
Export-Package: com.acme.case.api;version=1.0.0
Private-Package: com.acme.case.internal.*
```

Dari class yang dianalisis, bnd dapat menghitung banyak import yang dibutuhkan.

Kamu tidak perlu menebak semua `Import-Package`. Kamu mendefinisikan boundary dan policy, lalu bnd menghitung detail dependency package-nya.

---

## 3. bnd sebagai Boundary Compiler

Dalam OSGi, boundary utama bukan hanya project/module, tetapi package:

- package mana yang public API,
- package mana yang private implementation,
- package mana yang hanya dipakai internal,
- package mana yang diimpor dari bundle lain,
- package mana yang disediakan untuk konsumen,
- package mana yang harus punya semantic version.

bnd memaksa kita menjawab pertanyaan arsitektur:

```text
Apakah package ini API?
Apakah package ini implementation?
Apakah package ini perlu diekspor?
Apakah version-nya benar?
Apakah dependency ini compile-only, runtime, embedded, atau external capability?
Apakah service component metadata valid?
Apakah bundle ini bisa resolve dalam target runtime?
```

Itulah kenapa bnd penting untuk software engineer senior: ia membuat modularity menjadi **operationally enforceable**, bukan hanya diagram.

---

## 4. Elemen-Elemen Utama bnd

Ada beberapa konsep besar yang harus dipisahkan.

### 4.1 bnd file

File konfigurasi bnd biasanya memiliki ekstensi:

- `.bnd`
- `.bndrun`

Contoh:

```text
bnd.bnd
build.bnd
test.bndrun
app.bndrun
```

### 4.2 bnd instruction

Instruction adalah key-value property yang mengarahkan bnd.

Contoh:

```properties
Bundle-SymbolicName: com.acme.case.core
Bundle-Version: 1.2.0
Export-Package: com.acme.case.api.*
Private-Package: com.acme.case.internal.*
```

Beberapa instruction dimulai dengan dash:

```properties
-buildpath: osgi.annotation, osgi.core
-testpath: org.junit.jupiter.api
-runfw: org.apache.felix.framework
-runrequires: osgi.identity;filter:='(osgi.identity=com.acme.case.app)'
```

Secara kasar:

- header tanpa dash biasanya menjadi manifest header atau metadata bundle,
- instruction dengan dash biasanya mengarahkan proses build/resolution/runtime.

Tidak semua header langsung masuk manifest. Tidak semua instruction menjadi manifest. Ini penting.

### 4.3 bnd workspace

Workspace adalah struktur project yang dikelola bnd/Bndtools.

Biasanya:

```text
workspace/
  cnf/
    build.bnd
    ext/
    localrepo/
  com.acme.case.api/
    bnd.bnd
    src/
    test/
  com.acme.case.core/
    bnd.bnd
    src/
    test/
  com.acme.case.app/
    app.bndrun
```

`cnf` menyimpan konfigurasi bersama. Setiap project punya `bnd.bnd`.

### 4.4 bndrun

`.bndrun` mendeskripsikan runtime OSGi yang ingin dijalankan atau diekspor.

Contoh:

```properties
-runfw: org.apache.felix.framework
-runee: JavaSE-17
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.case.core)',\
    osgi.identity;filter:='(osgi.identity=org.apache.felix.gogo.shell)'
-runproperties: \
    org.osgi.framework.storage.clean=onFirstInit
```

`bndrun` bukan bundle. Ia adalah **runtime assembly descriptor**.

---

## 5. Struktur Workspace bnd yang Sehat

Untuk project enterprise, struktur workspace harus menjelaskan boundary.

Contoh modular enforcement platform:

```text
learn-osgi-platform/
  cnf/
    build.bnd
    ext/
      repositories.bnd
      versions.bnd
      baseline.bnd
  com.acme.platform.api/
    bnd.bnd
    src/main/java/com/acme/platform/api/...
  com.acme.platform.spi/
    bnd.bnd
    src/main/java/com/acme/platform/spi/...
  com.acme.platform.kernel/
    bnd.bnd
    src/main/java/com/acme/platform/kernel/internal/...
  com.acme.platform.validation.api/
    bnd.bnd
  com.acme.platform.validation.core/
    bnd.bnd
  com.acme.platform.validation.rules.basic/
    bnd.bnd
  com.acme.platform.web/
    bnd.bnd
  com.acme.platform.persistence/
    bnd.bnd
  com.acme.platform.runtime/
    app.bndrun
    debug.bndrun
    test.bndrun
```

Prinsip:

1. API punya bundle sendiri.
2. SPI dipisah dari API consumer-facing bila lifecycle-nya berbeda.
3. Implementation bundle tidak mengekspor internal package.
4. Runtime assembly tidak dicampur dengan domain implementation.
5. Version dan repository policy ada di `cnf`, bukan tersebar acak.
6. `.bndrun` dibuat eksplisit untuk dev/debug/test/prod.

---

## 6. `cnf`: Pusat Policy Workspace

`cnf` adalah folder penting dalam bnd workspace.

Contoh:

```text
cnf/
  build.bnd
  ext/
    repositories.bnd
    versions.bnd
    quality.bnd
  localrepo/
```

`build.bnd` dapat berisi policy global:

```properties
# Common Java target
-runee: JavaSE-17

# Workspace repositories
-plugin: \
    aQute.bnd.repository.maven.pom.provider.BndPomRepository; \
        releaseUrls=https://repo1.maven.org/maven2/; \
        name=MavenCentral

# Common compiler options, baseline rules, macros, etc.
```

Namun jangan menaruh semua hal di `build.bnd`. Gunakan prinsip:

| Letak | Isi yang cocok |
|---|---|
| `cnf/build.bnd` | policy global workspace |
| `cnf/ext/*.bnd` | repository, versions, shared macros |
| project `bnd.bnd` | identity dan boundary bundle |
| `.bndrun` | runtime assembly |

Anti-pattern:

```text
Semua instruction global ditaruh di cnf sampai project kehilangan identitas arsitektur.
```

Kamu tetap ingin setiap bundle menjawab:

- siapa dirinya,
- apa API-nya,
- apa private package-nya,
- apa dependency intentional-nya.

---

## 7. `bnd.bnd`: Kontrak Bundle per Project

Contoh API bundle:

```properties
Bundle-SymbolicName: com.acme.enforcement.validation.api
Bundle-Version: 1.3.0
Bundle-Name: ACME Enforcement Validation API

Export-Package: \
    com.acme.enforcement.validation.api;version=1.3.0

Private-Package: \
    com.acme.enforcement.validation.api.internal.*
```

Catatan: API bundle idealnya sangat kecil dan tidak punya banyak dependency.

Contoh implementation bundle:

```properties
Bundle-SymbolicName: com.acme.enforcement.validation.core
Bundle-Version: 1.3.0
Bundle-Name: ACME Enforcement Validation Core

Private-Package: \
    com.acme.enforcement.validation.core.internal.*

-buildpath: \
    com.acme.enforcement.validation.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn
```

Implementation bundle biasanya tidak perlu `Export-Package` kecuali memang menyediakan API tambahan.

Contoh plugin bundle:

```properties
Bundle-SymbolicName: com.acme.enforcement.validation.rules.licensing
Bundle-Version: 1.0.0
Bundle-Name: Licensing Validation Rules

Private-Package: \
    com.acme.enforcement.validation.rules.licensing.internal.*

-buildpath: \
    com.acme.enforcement.validation.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn
```

Jika plugin hanya mendaftarkan service via DS, ia tidak perlu mengekspor package.

---

## 8. Instruction Penting dalam bnd

### 8.1 `Bundle-SymbolicName`

Identitas bundle.

```properties
Bundle-SymbolicName: com.acme.case.core
```

Gunakan nama stabil. Jangan memakai suffix build environment.

Buruk:

```properties
Bundle-SymbolicName: com.acme.case.core.dev
```

Lebih baik environment dibedakan lewat runtime config, bukan identity bundle.

### 8.2 `Bundle-Version`

Versi bundle.

```properties
Bundle-Version: 1.2.3
```

Untuk snapshot/dev:

```properties
Bundle-Version: 1.2.3.${tstamp}
```

Namun untuk release production, gunakan version yang reproducible.

### 8.3 `Export-Package`

Package yang menjadi kontrak publik OSGi.

```properties
Export-Package: \
    com.acme.case.api;version=1.2.0
```

Export harus deliberate.

Jangan:

```properties
Export-Package: *
```

Itu mengubah semua package menjadi public API.

### 8.4 `Private-Package`

Package yang masuk bundle tetapi tidak diekspor.

```properties
Private-Package: \
    com.acme.case.core.internal.*
```

Private package tetap ada di JAR, tetapi tidak visible untuk bundle lain.

### 8.5 `-buildpath`

Dependency compile/build untuk project bnd.

```properties
-buildpath: \
    osgi.core,\
    osgi.cmpn,\
    com.acme.case.api
```

`-buildpath` bukan otomatis `Bundle-ClassPath`. Ia sumber class yang dipakai bnd untuk compile/analyze.

### 8.6 `-testpath`

Dependency test.

```properties
-testpath: \
    org.junit.jupiter.api,\
    org.assertj.core
```

### 8.7 `-includeresource`

Memasukkan resource ke bundle.

```properties
-includeresource: \
    OSGI-INF/config/defaults.json=src/main/resources/defaults.json
```

Bisa juga untuk embedded JAR, tetapi hati-hati.

### 8.8 `-conditionalpackage`

Memasukkan package dependency tertentu jika diperlukan.

```properties
-conditionalpackage: \
    com.acme.embedded.support.*
```

Gunakan dengan hati-hati karena bisa membuat boundary kurang eksplisit.

### 8.9 `-removeheaders`

Membersihkan header build-time yang tidak perlu.

```properties
-removeheaders: \
    Bnd-LastModified,\
    Created-By
```

Penting untuk reproducible build.

### 8.10 `-fixupmessages`

Mengelola warning/error tertentu.

```properties
-fixupmessages: \
    "Classes found in the wrong directory";is:=warning
```

Gunakan sangat hati-hati. Jangan menjadikan ini tempat menyapu masalah arsitektur ke bawah karpet.

### 8.11 `-contract`

Membantu menangani contract namespace.

Misalnya untuk Java/Jakarta API tertentu, contract dapat membantu resolver memahami dependency yang lebih semantik daripada package-by-package.

### 8.12 `-dsannotations`

Memproses Declarative Services annotations.

```properties
-dsannotations: *
```

Dalam banyak setup modern, bnd otomatis memproses annotation tertentu, tetapi eksplisit lebih mudah untuk pembelajaran.

### 8.13 `-metatypeannotations`

Memproses Metatype annotations.

```properties
-metatypeannotations: *
```

Ini menghasilkan metadata konfigurasi untuk Configuration Admin/Metatype.

---

## 9. bnd Package Analysis: Bagaimana Import Dihitung

Misalkan class kamu:

```java
package com.acme.case.core.internal;

import com.acme.case.api.CaseService;
import org.osgi.service.component.annotations.Component;
import com.fasterxml.jackson.databind.ObjectMapper;

@Component(service = CaseService.class)
public class DefaultCaseService implements CaseService {
    private final ObjectMapper mapper = new ObjectMapper();
}
```

bnd akan membaca bytecode dan melihat package reference:

```text
com.acme.case.api
org.osgi.service.component.annotations
com.fasterxml.jackson.databind
java.lang
```

Kemudian bnd menyusun import yang dibutuhkan:

```text
Import-Package: 
  com.acme.case.api,
  com.fasterxml.jackson.databind,
  org.osgi.service.component.annotations;resolution:=optional?,
  ...
```

Namun tidak semua reference harus menjadi runtime import:

- annotation dengan retention class/source mungkin tidak diperlukan runtime,
- package milik bundle sendiri tidak perlu external import kecuali self-import policy,
- Java platform package tidak perlu import OSGi biasa,
- embedded dependency bisa menjadi private package atau `Bundle-ClassPath`.

bnd punya pengetahuan untuk membuat keputusan default yang lebih baik daripada manual guess.

Tetapi engineer tetap harus memeriksa hasilnya.

---

## 10. Export-Package vs Private-Package dalam bnd

Satu kesalahan besar adalah menganggap `Export-Package` adalah “package yang dimasukkan ke JAR”.

Tidak.

Ada dua keputusan berbeda:

1. Package apa yang dimasukkan ke bundle JAR.
2. Package apa yang diekspor sebagai API ke bundle lain.

`Private-Package` memasukkan package ke JAR tanpa mengekspornya.

`Export-Package` memasukkan package ke JAR dan mengekspornya.

Contoh:

```properties
Export-Package: \
    com.acme.validation.api;version=1.0.0

Private-Package: \
    com.acme.validation.core.internal.*
```

Runtime behavior:

```text
Bundle lain bisa import com.acme.validation.api.
Bundle lain tidak bisa import com.acme.validation.core.internal.
```

Inilah encapsulation OSGi.

Top-tier rule:

> A package should be exported only if you are willing to support it as a compatibility contract.

---

## 11. API Bundle Pattern

API bundle sebaiknya:

- kecil,
- stabil,
- dependency minimal,
- versioned dengan disiplin,
- tidak mengandung implementation,
- tidak punya static runtime state,
- tidak bergantung ke framework berat.

Contoh:

```text
com.acme.enforcement.case.api
  CaseId
  CaseStatus
  CaseView
  CaseCommand
  CaseService
  CaseQueryService
```

`bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.enforcement.case.api
Bundle-Version: 2.1.0

Export-Package: \
    com.acme.enforcement.case.api;version=2.1.0
```

Jangan membuat API bundle seperti ini:

```text
com.acme.enforcement.case.api
  CaseService
  CaseRepository
  HibernateCaseEntity
  SpringCaseConfig
  OracleCaseDao
  InternalCaseMapper
```

Itu bukan API. Itu implementation leak.

---

## 12. Implementation Bundle Pattern

Implementation bundle:

- mengimpor API,
- mendaftarkan service,
- menyembunyikan internal package,
- punya DS component,
- punya config jika diperlukan.

Contoh:

```java
package com.acme.enforcement.case.core.internal;

import com.acme.enforcement.case.api.CaseService;
import org.osgi.service.component.annotations.Component;

@Component(service = CaseService.class)
public final class DefaultCaseService implements CaseService {
    @Override
    public void openCase(String caseId) {
        // implementation
    }
}
```

`bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.enforcement.case.core
Bundle-Version: 2.1.0

Private-Package: \
    com.acme.enforcement.case.core.internal.*

-buildpath: \
    com.acme.enforcement.case.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn

-dsannotations: *
```

Generated metadata includes:

```text
Service-Component: OSGI-INF/com.acme.enforcement.case.core.internal.DefaultCaseService.xml
Import-Package: com.acme.enforcement.case.api;version="[2.1,3)", ...
```

Depending on version policy and annotations, bnd can infer or assist import ranges.

---

## 13. Plugin Bundle Pattern

Plugin bundle normally exports nothing.

It contributes behavior through OSGi service registry.

Example plugin contract:

```java
package com.acme.validation.api;

public interface ValidationRule {
    String code();
    ValidationResult validate(ValidationContext context);
}
```

Plugin implementation:

```java
package com.acme.validation.rules.licensing.internal;

import com.acme.validation.api.ValidationRule;
import org.osgi.service.component.annotations.Component;

@Component(
    service = ValidationRule.class,
    property = {
        "rule.code=LICENCE_ACTIVE",
        "rule.category=LICENSING",
        "service.ranking:Integer=100"
    }
)
public final class LicenceActiveRule implements ValidationRule {
    @Override
    public String code() {
        return "LICENCE_ACTIVE";
    }

    @Override
    public ValidationResult validate(ValidationContext context) {
        return ValidationResult.ok();
    }
}
```

`bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.validation.rules.licensing
Bundle-Version: 1.0.0

Private-Package: \
    com.acme.validation.rules.licensing.internal.*

-buildpath: \
    com.acme.validation.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn

-dsannotations: *
```

Boundary:

```text
Contract: com.acme.validation.api
Implementation: private package
Discovery: OSGi Service Registry
Runtime metadata: DS XML generated by bnd
```

This is clean OSGi architecture.

---

## 14. Runtime Assembly with `.bndrun`

A bundle build answers:

```text
What is this bundle?
```

A `.bndrun` answers:

```text
What runtime composition do I want?
```

Example `app.bndrun`:

```properties
-runfw: org.apache.felix.framework
-runee: JavaSE-17

-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.enforcement.case.core)',\
    osgi.identity;filter:='(osgi.identity=com.acme.validation.rules.licensing)',\
    osgi.identity;filter:='(osgi.identity=org.apache.felix.gogo.shell)'

-runproperties: \
    org.osgi.framework.storage.clean=onFirstInit,\
    felix.log.level=4
```

Then resolver computes `-runbundles`.

Conceptually:

```text
You declare root requirements.
Resolver computes closure.
Runtime launches exact bundles.
```

This is much better than manually maintaining a giant list of runtime JARs.

---

## 15. `-runrequires` vs `-runbundles`

### 15.1 `-runrequires`

High-level desired capabilities.

```properties
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.app)'
```

It says: “I want something that satisfies this requirement.”

### 15.2 `-runbundles`

Concrete resolved bundle list.

```properties
-runbundles: \
    org.apache.felix.framework;version='[7.0.5,7.0.5]',\
    org.apache.felix.scr;version='[2.2.12,2.2.12]',\
    com.acme.app;version='[1.0.0,1.0.0]'
```

It says: “Launch exactly these bundles.”

Good workflow:

1. Maintain `-runrequires` manually.
2. Let resolver generate/update `-runbundles`.
3. Commit resolved `-runbundles` when you want reproducibility.
4. Re-resolve intentionally when dependency/runtime changes.

Anti-pattern:

```text
Developers manually edit massive -runbundles until runtime accidentally works.
```

That bypasses resolver intelligence.

---

## 16. Resolver in Bndtools

Bndtools gives interactive resolver support.

The workflow:

```text
Open .bndrun
Declare -runrequires
Click Resolve
Inspect candidates
Resolve
Save
Launch OSGi
```

The important part is not the button. The important part is the mental model.

Resolver needs repositories that contain resources with metadata:

- identity capability,
- package capabilities,
- service capabilities,
- extender capabilities,
- execution environment requirements,
- bundle requirements.

If repository metadata is weak, resolver result is weak.

This is why wrapping random Maven libraries without good OSGi metadata can create poor runtime behavior.

---

## 17. Repositories in bnd

bnd can consume multiple repository types:

- workspace repository,
- local indexed repository,
- Maven repository,
- OSGi repository,
- p2 repository,
- file-system repository.

Conceptual layout:

```text
Workspace bundles        -> current project outputs
Maven Central            -> third-party libraries
OSGi repository index    -> metadata-rich bundle catalog
Local release repository -> internal released bundles
```

Example repository instruction varies by plugin, but conceptually:

```properties
-plugin: \
    aQute.bnd.repository.maven.pom.provider.BndPomRepository; \
        name=MavenCentral; \
        releaseUrls=https://repo1.maven.org/maven2/
```

For enterprise, avoid uncontrolled “everything from Maven Central” runtime resolution.

Better:

```text
Maven Central -> curated internal repository/index -> bnd resolution -> runtime distribution
```

Reason:

- supply-chain control,
- reproducibility,
- approved versions,
- vulnerability scanning,
- license review,
- predictable resolver candidates.

---

## 18. Maven, Gradle, and bnd Workspace: Three Integration Models

There are multiple ways to use bnd.

### 18.1 Native bnd workspace

Best for OSGi-first projects.

Pros:

- clean OSGi mental model,
- strong Bndtools integration,
- `.bndrun` native,
- fast feedback,
- package boundary-first.

Cons:

- less familiar to Maven-only teams,
- requires learning bnd workspace conventions,
- enterprise CI may need adjustment.

### 18.2 Maven with bnd plugin

Good when organization standardizes on Maven.

Possible tools:

- `bnd-maven-plugin`,
- `maven-bundle-plugin` based on bnd.

Pros:

- fits Maven lifecycle,
- easier for existing enterprise builds,
- can generate OSGi manifest.

Cons:

- Maven dependency graph is artifact-centric, not package/capability-centric,
- runtime resolution may become secondary,
- developers may overuse embedded dependencies.

### 18.3 Gradle with bnd

Good for flexible builds.

Pros:

- programmable,
- supports multi-project structure,
- can integrate bnd tasks,
- suitable for custom release pipelines.

Cons:

- custom Gradle logic can hide OSGi semantics,
- reproducibility depends on discipline.

Decision rule:

| Situation | Prefer |
|---|---|
| New OSGi platform | bnd workspace/Bndtools |
| Existing Maven enterprise app | Maven + bnd plugin initially |
| Existing Gradle multi-project | Gradle + bnd integration |
| Team learning OSGi deeply | bnd workspace first |
| Library just needs OSGi metadata | Maven/Gradle bnd plugin |

---

## 19. Maven Bundle Plugin vs bnd Maven Plugin

Historically, many projects used Apache Felix Maven Bundle Plugin.

It is based on bnd and integrates with Maven project structure.

Example:

```xml
<plugin>
  <groupId>org.apache.felix</groupId>
  <artifactId>maven-bundle-plugin</artifactId>
  <extensions>true</extensions>
  <configuration>
    <instructions>
      <Bundle-SymbolicName>com.acme.case.core</Bundle-SymbolicName>
      <Export-Package>com.acme.case.api</Export-Package>
      <Private-Package>com.acme.case.core.internal.*</Private-Package>
    </instructions>
  </configuration>
</plugin>
```

bnd Maven Plugin is more directly aligned with bnd tooling.

Example conceptual configuration:

```xml
<plugin>
  <groupId>biz.aQute.bnd</groupId>
  <artifactId>bnd-maven-plugin</artifactId>
  <executions>
    <execution>
      <goals>
        <goal>bnd-process</goal>
      </goals>
    </execution>
  </executions>
</plugin>
```

Use official docs for exact current configuration because plugin versions and goals evolve.

Architectural point:

> The plugin choice matters less than whether your build enforces OSGi boundaries, baseline, and resolver correctness.

A Maven project with bnd but no baseline and no runtime resolve test is still weak.

---

## 20. Build-Time Classpath vs Runtime Wiring

This is one of the most important distinctions.

Maven/Gradle compile classpath says:

```text
Can javac compile the code?
```

OSGi runtime wiring says:

```text
Can this bundle resolve and load packages from compatible providers at runtime?
```

These are not the same.

Example Maven compiles:

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.17.0</version>
</dependency>
```

But runtime may fail if:

- no bundle exports `com.fasterxml.jackson.databind`,
- version range does not match,
- Jackson dependencies are missing,
- packages are embedded incorrectly,
- there is a `uses:=` conflict,
- a different Jackson provider is selected.

bnd helps bridge compile-time dependency and runtime metadata, but you still need resolver tests.

Top-tier rule:

> A green Maven build does not prove an OSGi runtime is valid.

---

## 21. Baseline Checking: API Evolution Enforcement

Baseline checking compares current bundle/package API against previous released version.

It asks:

```text
Did public API change?
If yes, did version increase correctly?
```

Example API change:

```java
public interface CaseService {
    CaseView getCase(String id);
}
```

New version:

```java
public interface CaseService {
    CaseView getCase(String id);
    void closeCase(String id);
}
```

Adding a method to an interface can break implementers. In OSGi semantic versioning, this likely requires a major version bump for provider-facing contracts depending on type annotation and role.

bnd baseline can detect such changes.

Conceptual baseline config:

```properties
-baseline: *
```

Or CI-specific setup that compares against a repository containing last release.

Baseline output might say conceptually:

```text
Package com.acme.case.api has a binary incompatible change.
Version is 1.2.0 but should be 2.0.0.
```

Do not treat baseline as annoying.

Treat baseline as:

> A compatibility regression test for your modular platform.

---

## 22. Package Version Source: `packageinfo` vs Annotations

OSGi package version can be declared via:

### 22.1 `packageinfo`

File:

```text
src/main/java/com/acme/case/api/packageinfo
```

Content:

```text
version 1.2.0
```

### 22.2 `package-info.java`

```java
@org.osgi.annotation.versioning.Version("1.2.0")
package com.acme.case.api;
```

Prefer `package-info.java` for modern Java because it is visible in source and integrates with annotation tooling.

You can also use role annotations:

```java
@org.osgi.annotation.versioning.ProviderType
public interface CaseRepositoryProvider {
    // provider implemented by bundle providers
}
```

```java
@org.osgi.annotation.versioning.ConsumerType
public interface CaseEventListener {
    // consumer implemented by clients
}
```

The distinction matters for baseline interpretation.

---

## 23. bnd and Declarative Services Metadata

In old OSGi, service components often required XML.

Modern OSGi commonly uses annotations:

```java
@Component(service = CaseService.class)
public final class DefaultCaseService implements CaseService {
    @Activate
    void activate() {}
}
```

bnd processes this and generates component XML:

```text
OSGI-INF/com.acme.case.core.internal.DefaultCaseService.xml
```

And adds manifest header:

```text
Service-Component: OSGI-INF/com.acme.case.core.internal.DefaultCaseService.xml
```

Without this, SCR will not know your component exists.

Common failure:

```text
The code has @Component but runtime shows no component.
```

Possible causes:

- bnd did not process DS annotations,
- wrong annotation package,
- generated XML not included,
- `Service-Component` header missing,
- SCR bundle missing from runtime,
- component disabled or unsatisfied.

bnd solves metadata generation, not runtime satisfaction.

---

## 24. bnd and Metatype Metadata

Config interface:

```java
@ObjectClassDefinition(
    name = "Case Service Configuration",
    description = "Controls case service runtime behavior"
)
public @interface CaseServiceConfig {
    int maxOpenCases() default 1000;
    boolean strictMode() default true;
}
```

Component:

```java
@Component(configurationPid = "com.acme.case.core")
@Designate(ocd = CaseServiceConfig.class)
public final class DefaultCaseService {
    @Activate
    void activate(CaseServiceConfig config) {
        // use config
    }
}
```

bnd generates metatype XML and includes relevant metadata.

This supports:

- config UI,
- validation metadata,
- documentation,
- operational config visibility.

In a serious platform, configuration schema is not tribal knowledge; it is metadata.

---

## 25. bnd Macro System

bnd supports macros for reuse and computed values.

Example:

```properties
Bundle-Version: ${version;==;${@}}
```

Common macro uses:

- timestamp,
- version extraction,
- property substitution,
- conditional values,
- file references,
- Git/build metadata,
- shared package list,
- environment-specific config.

Example:

```properties
project.version: 1.4.0
Bundle-Version: ${project.version}
```

Shared file:

```properties
# cnf/ext/versions.bnd
jackson.version: 2.17.2
osgi.annotation.version: 8.1.0
```

Project:

```properties
-buildpath: \
    com.fasterxml.jackson.core.jackson-databind;version=${jackson.version}
```

Macro power can become dangerous.

Bad:

```properties
Export-Package: ${allpackages}
```

If macros hide architectural boundary, they reduce readability.

Rule:

> Use macros for shared values, not for hiding design decisions.

---

## 26. Reproducible Builds

In regulated or enterprise environments, reproducibility matters.

Questions:

```text
Can we rebuild the same release artifact from source?
Can we prove which bundle versions were deployed?
Can we compare manifest differences?
Can we trace package version changes?
```

bnd can help, but you need policy.

Checklist:

- Pin dependency versions.
- Avoid dynamic Maven ranges for release builds.
- Remove volatile headers where appropriate.
- Commit resolved runtime descriptor or lock file equivalent.
- Store built artifacts in immutable repository.
- Baseline against released artifact.
- Generate SBOM if required.
- Archive `.bndrun` used for runtime.
- Capture framework version, SCR version, Config Admin version.

Potential volatile headers:

```text
Bnd-LastModified
Created-By
Build-Jdk
Tool
```

Use `-removeheaders` carefully.

But do not remove useful audit metadata unless another mechanism captures it.

---

## 27. Embedding Dependencies: When and When Not

OSGi gives two broad options for third-party libraries:

### 27.1 Install dependency as separate bundle

```text
jackson-core bundle
jackson-annotations bundle
jackson-databind bundle
my-app bundle imports Jackson packages
```

Pros:

- shared library,
- visible dependency graph,
- resolver can manage versions,
- security patch can update shared dependency.

Cons:

- version conflict if multiple consumers need different versions,
- library must have good OSGi metadata or be wrapped.

### 27.2 Embed dependency inside your bundle

```text
my-app bundle contains lib/jackson-databind.jar on Bundle-ClassPath
```

Pros:

- isolation,
- easier for non-OSGi libraries,
- avoids shared version conflict.

Cons:

- duplicate memory,
- hidden dependency,
- harder patching,
- class identity issues if types leak across service boundary,
- bigger bundles.

Decision rule:

| Library role | Prefer |
|---|---|
| API types appear in service contract | Separate exported bundle/API bundle |
| Internal implementation only | Embed or private package possible |
| Shared infrastructure library | Separate bundle |
| Library with bad OSGi metadata but internal only | Embed carefully |
| Security-sensitive shared lib | Separate bundle with controlled update |
| Multiple incompatible versions needed | Embed or isolate by plugin boundary |

Golden rule:

> Never expose embedded library types in exported packages or service contracts unless you intend consumers to wire to the same package source.

---

## 28. Wrapping Non-OSGi Libraries

Many Java libraries are plain JARs.

Options:

1. Use as-is if it already has usable manifest or automatic metadata from repository.
2. Wrap as OSGi bundle.
3. Embed inside another bundle.
4. Replace with OSGi-friendly alternative.

Wrapping example:

```properties
Bundle-SymbolicName: com.acme.thirdparty.somelegacy
Bundle-Version: 1.0.0

-includeresource: @somelegacy-1.0.0.jar

Export-Package: \
    com.legacy.api.*;version=1.0.0

Private-Package: \
    com.legacy.internal.*
```

But wrapping requires analysis:

- Does the library use reflection?
- Does it use `ServiceLoader`?
- Does it use TCCL?
- Does it scan classpath?
- Does it load resources by fixed path?
- Does it expect all dependencies in one classloader?
- Does it use native code?
- Does it access JDK internals?

A wrapped library can resolve but still fail at runtime.

bnd can generate metadata. It cannot magically make non-modular assumptions disappear.

---

## 29. Managing Import Ranges with bnd

Import ranges are central to OSGi compatibility.

Example generated import:

```text
Import-Package: com.acme.case.api;version="[1.2,2)"
```

This means:

```text
Compatible with 1.2.x and later minor versions, but not 2.x.
```

bnd can apply version policies.

Conceptual policies:

```text
Provider import policy: [major.minor, major+1)
Consumer import policy: [major.minor, major+1)
Micro usually not part of lower bound unless needed.
```

You want consistency.

Bad:

```text
Bundle A imports [1.0,2)
Bundle B imports [1.4,1.5)
Bundle C imports [1.0,999)
Bundle D imports no version
```

That creates unpredictable runtime compatibility.

Good:

```text
All workspace bundles use consistent import range policy generated/enforced by bnd.
```

But range policy is a business/architecture decision:

- tight range = safer but more upgrade friction,
- wide range = flexible but more runtime risk.

For regulated systems, prefer explicit and tested compatibility rather than overly wide ranges.

---

## 30. `uses:=` and bnd

When a package export contains types from another package, `uses:=` helps preserve class space consistency.

Example:

```java
package com.acme.validation.api;

import com.acme.case.api.CaseView;

public interface ValidationRule {
    ValidationResult validate(CaseView caseView);
}
```

Exporting `com.acme.validation.api` should express that it uses `com.acme.case.api`.

Manifest may include:

```text
Export-Package: com.acme.validation.api;version="1.0.0";uses:="com.acme.case.api"
```

bnd can calculate `uses:=` from bytecode.

Do not casually remove `uses:=` because it seems to cause resolver errors.

A `uses:=` error often reveals a real class consistency problem.

Wrong response:

```text
Remove uses directive to make resolver pass.
```

Right response:

```text
Fix dependency graph so all related API packages are wired consistently.
```

---

## 31. Workspace Naming and Package Naming Strategy

Good naming makes resolver and diagnostics easier.

Bundle symbolic name:

```text
com.acme.enforcement.case.api
com.acme.enforcement.case.core
com.acme.enforcement.case.web
com.acme.enforcement.case.persistence
com.acme.enforcement.validation.rules.licensing
```

Package name:

```text
com.acme.enforcement.case.api
com.acme.enforcement.case.core.internal
com.acme.enforcement.case.persistence.internal
```

Avoid:

```text
com.acme.common
com.acme.util
com.acme.shared
com.acme.framework
```

These become dumping grounds.

For bnd, broad wildcard exports become dangerous:

```properties
Export-Package: com.acme.*
```

Better:

```properties
Export-Package: \
    com.acme.enforcement.case.api;version=2.1.0
```

---

## 32. Java 8 to Java 25: bnd Toolchain Concerns

OSGi systems may target multiple Java versions.

Important dimensions:

1. Build JDK.
2. Bytecode target.
3. Runtime JDK.
4. Bundle execution environment.
5. Library compatibility.
6. JPMS strong encapsulation.
7. Removed Java EE modules after Java 8.
8. Tooling support for classfile versions.

Example: build on JDK 25, target Java 8.

Risks:

- accidental Java 9+ API use,
- bytecode level too new,
- dependency compiled for Java 11+,
- bnd/ASM version must understand new classfile versions,
- runtime EE mismatch.

Policy example:

```properties
-runee: JavaSE-17
```

For multi-runtime support:

```text
Java 8 line: older dependencies, javax APIs, lower classfile target
Java 17/21/25 line: modern dependencies, jakarta APIs, stronger encapsulation handling
```

Do not pretend one artifact automatically supports Java 8–25 unless tested.

A serious compatibility matrix includes:

| Dimension | Example |
|---|---|
| Compile release | `--release 8`, `--release 17`, `--release 21` |
| Runtime JDK | 8, 11, 17, 21, 25 |
| Framework | Felix/Equinox versions |
| SCR | Felix SCR/equivalent version |
| Libraries | ASM, ByteBuddy, Jackson, Hibernate, etc. |
| JPMS flags | `--add-opens`, `--add-exports` if needed |
| EE metadata | JavaSE-1.8/11/17/21/25 style capability |

bnd can help express metadata. It does not replace actual runtime testing.

---

## 33. bnd Warnings: How to Treat Them

bnd warnings are often architecture smells.

Examples:

```text
Importing packages that are never used.
Exporting packages with no version.
Private package overlaps with exported package.
Split package detected.
Classes found in wrong directory.
Unresolved references.
DS annotation issue.
Version mismatch.
```

Bad team habit:

```text
Add -fixupmessages until build is green.
```

Good team habit:

```text
Classify warning:
1. Real architecture problem -> fix design.
2. Tool limitation -> suppress narrowly with comment.
3. Transitional migration issue -> suppress temporarily with ticket and expiry.
```

Suppression should be documented:

```properties
# Temporary: legacy library references optional com.sun package not needed at runtime.
# Remove after replacing legacy parser. Ticket: ARCH-1234.
-fixupmessages: \
    "Unused Import-Package instructions: com.sun.*";is:=warning
```

---

## 34. Example: Building a Small OSGi Platform with bnd

### 34.1 API bundle

`com.acme.rules.api/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.rules.api
Bundle-Version: 1.0.0

Export-Package: \
    com.acme.rules.api;version=1.0.0
```

Source:

```java
@org.osgi.annotation.versioning.Version("1.0.0")
package com.acme.rules.api;
```

```java
package com.acme.rules.api;

public interface Rule {
    String code();
    RuleResult evaluate(RuleContext context);
}
```

### 34.2 Core bundle

`com.acme.rules.core/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.rules.core
Bundle-Version: 1.0.0

Private-Package: \
    com.acme.rules.core.internal.*

-buildpath: \
    com.acme.rules.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn

-dsannotations: *
-metatypeannotations: *
```

Core service:

```java
package com.acme.rules.core.internal;

import com.acme.rules.api.Rule;
import org.osgi.service.component.annotations.Component;
import org.osgi.service.component.annotations.Reference;
import org.osgi.service.component.annotations.ReferenceCardinality;
import org.osgi.service.component.annotations.ReferencePolicy;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

@Component(service = RuleEngine.class)
public final class RuleEngine {
    private final List<Rule> rules = new CopyOnWriteArrayList<>();

    @Reference(
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(Rule rule) {
        rules.add(rule);
    }

    void unbindRule(Rule rule) {
        rules.remove(rule);
    }

    public List<RuleResult> evaluate(RuleContext context) {
        return rules.stream()
            .map(rule -> rule.evaluate(context))
            .toList();
    }
}
```

### 34.3 Plugin bundle

`com.acme.rules.licensing/bnd.bnd`:

```properties
Bundle-SymbolicName: com.acme.rules.licensing
Bundle-Version: 1.0.0

Private-Package: \
    com.acme.rules.licensing.internal.*

-buildpath: \
    com.acme.rules.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn

-dsannotations: *
```

Rule implementation:

```java
@Component(
    service = Rule.class,
    property = {
        "rule.code=LICENCE_ACTIVE",
        "rule.category=LICENSING",
        "service.ranking:Integer=100"
    }
)
public final class LicenceActiveRule implements Rule {
    @Override
    public String code() {
        return "LICENCE_ACTIVE";
    }

    @Override
    public RuleResult evaluate(RuleContext context) {
        return RuleResult.pass(code());
    }
}
```

### 34.4 Runtime

`com.acme.runtime/app.bndrun`:

```properties
-runfw: org.apache.felix.framework
-runee: JavaSE-17

-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.rules.core)',\
    osgi.identity;filter:='(osgi.identity=com.acme.rules.licensing)',\
    osgi.identity;filter:='(osgi.identity=org.apache.felix.scr)',\
    osgi.identity;filter:='(osgi.identity=org.apache.felix.gogo.shell)'

-runproperties: \
    org.osgi.framework.storage.clean=onFirstInit,\
    felix.log.level=4
```

Flow:

```text
bnd builds bundles
bnd generates DS metadata
bnd resolver computes runtime closure
OSGi framework launches bundles
SCR activates components
RuleEngine tracks Rule services dynamically
Plugin can be added/removed without recompiling core
```

---

## 35. Testing with bnd

Testing OSGi has layers.

### 35.1 Plain unit test

Good for pure logic.

```java
@Test
void evaluatesRule() {
    Rule rule = new LicenceActiveRule();
    assertThat(rule.evaluate(context)).isPass();
}
```

Does not test:

- manifest,
- DS metadata,
- resolver,
- service registry,
- classloader isolation.

### 35.2 Bundle build validation

Checks generated manifest.

```text
Does bundle export correct package?
Does it import correct package range?
Is Service-Component header generated?
```

### 35.3 Resolver test

A `.bndrun` can validate that runtime resolves.

```text
Resolve app.bndrun in CI.
Fail build if required runtime cannot resolve.
```

### 35.4 In-framework test

Launch OSGi framework and test service behavior.

```text
Install bundles
Wait for DS components
Lookup service
Assert behavior
Stop plugin bundle
Assert dynamic behavior
```

Bndtools provides integrated OSGi test support; exact setup depends on current bnd/Bndtools version and chosen build tool.

---

## 36. CI Pipeline for OSGi with bnd

A serious pipeline should include more than `mvn test`.

Suggested pipeline:

```text
1. Compile Java
2. Run unit tests
3. Build bundles with bnd
4. Fail on serious bnd warnings
5. Validate generated manifests
6. Run baseline compatibility check
7. Resolve bndrun runtime descriptors
8. Run in-framework OSGi integration tests
9. Export runtime distribution
10. Scan artifacts/SBOM
11. Archive bundles, bndrun, resolved runtime list
12. Deploy immutable distribution
```

For PR validation:

```text
Fast path:
- compile
- unit test
- bundle build
- baseline
- resolver test

Nightly/full:
- in-framework integration
- dynamic lifecycle tests
- startup performance
- memory leak refresh tests
- Java compatibility matrix
```

Top-tier OSGi pipeline treats resolver and baseline as first-class tests.

---

## 37. Common bnd/Bndtools Failure Modes

### 37.1 Bundle compiles but cannot resolve

Likely causes:

- missing runtime provider,
- wrong import version range,
- repository missing metadata,
- dependency embedded incorrectly,
- EE mismatch,
- `uses:=` conflict.

Fix path:

```text
Inspect Import-Package
Inspect repository providers
Resolve with bndrun
Check uses constraints
Check Java EE requirement
```

### 37.2 DS component annotation exists but component missing

Likely causes:

- DS annotation processor not enabled,
- wrong annotation package,
- generated XML not included,
- missing SCR runtime,
- `Service-Component` header missing.

Fix path:

```text
Open generated JAR
Check OSGI-INF/*.xml
Check MANIFEST.MF Service-Component
Check runtime has SCR bundle
Use scr:list or equivalent runtime command
```

### 37.3 Exported package has no version

Cause:

- no package version declaration,
- wildcard export without version.

Fix:

```java
@Version("1.0.0")
package com.acme.case.api;
```

### 37.4 Baseline fails after API change

Cause:

- public API changed,
- package version not bumped,
- binary compatibility broken.

Fix:

```text
Either revert breaking change, add compatible default/adapter, or bump version correctly.
```

### 37.5 Runtime resolve differs between machines

Cause:

- repository versions differ,
- dynamic version ranges,
- unresolved lock/re-resolve policy,
- local repository pollution.

Fix:

```text
Pin repos.
Use curated repository.
Commit resolved runtime or lock equivalent.
Clean local caches in CI.
```

### 37.6 Split package warning

Cause:

- same package content across bundles or embedded dependencies.

Fix:

```text
Refactor packages.
Avoid embedding package already exported externally.
Do not split API/implementation inside same package.
```

---

## 38. Bndtools as Learning Instrument

Even if your organization uses Maven/Gradle, Bndtools is valuable for learning because it makes OSGi concepts visible:

- package imports,
- package exports,
- resolver candidates,
- generated manifest,
- `.bndrun` runtime,
- service components,
- repository contents,
- launch/debug OSGi framework.

It reduces invisible magic.

A practical learning workflow:

1. Create API bundle.
2. Create implementation bundle.
3. Add DS component.
4. Inspect generated manifest.
5. Inspect generated DS XML.
6. Create `.bndrun`.
7. Resolve runtime.
8. Launch Felix/Equinox.
9. Use shell to inspect bundles/services.
10. Break import range intentionally.
11. Observe resolver failure.
12. Add second service implementation.
13. Observe dynamic binding.
14. Change package version.
15. Run baseline.

This trains intuition faster than reading specs alone.

---

## 39. bnd and IDE Independence

Bndtools is Eclipse-based, but bnd itself is not tied to Eclipse.

You can use:

- bnd CLI,
- Maven plugin,
- Gradle plugin,
- CI pipeline,
- IntelliJ/VS Code with external build,
- Bndtools for interactive OSGi development.

For team environments, avoid making the IDE the source of truth.

Source of truth should be:

```text
bnd files + build tool + repository config + CI validation
```

IDE should consume the same model.

---

## 40. Advanced: bnd as Architecture Documentation

A well-written `bnd.bnd` documents architecture more precisely than many diagrams.

Example:

```properties
Bundle-SymbolicName: com.acme.enforcement.escalation.core
Bundle-Version: 3.4.0

Private-Package: \
    com.acme.enforcement.escalation.core.internal.*

-buildpath: \
    com.acme.enforcement.escalation.api;version=latest,\
    com.acme.enforcement.case.api;version=latest,\
    com.acme.enforcement.audit.api;version=latest,\
    osgi.annotation,\
    osgi.cmpn

-dsannotations: *
-metatypeannotations: *
```

This says:

```text
This bundle implements escalation.
It does not expose implementation packages.
It depends on escalation API, case API, audit API.
It uses Declarative Services.
It has typed configuration metadata.
```

`.bndrun` documents runtime composition:

```properties
-runrequires: \
    osgi.identity;filter:='(osgi.identity=com.acme.enforcement.kernel)',\
    osgi.identity;filter:='(osgi.identity=com.acme.enforcement.escalation.core)',\
    osgi.identity;filter:='(osgi.identity=com.acme.enforcement.escalation.rules.default)'
```

This says:

```text
This product variant includes default escalation rules.
```

In regulated platforms, this can support architectural traceability.

---

## 41. Design Review Checklist for bnd Usage

### 41.1 Bundle identity

- Is `Bundle-SymbolicName` stable?
- Is `Bundle-Version` controlled?
- Is artifact identity aligned with bundle identity?
- Are environment-specific differences outside bundle identity?

### 41.2 Package boundary

- Are only true API packages exported?
- Do exported packages have versions?
- Are internal packages private?
- Are split packages avoided?
- Are embedded dependency packages hidden safely?

### 41.3 Dependency policy

- Are import ranges consistent?
- Are optional imports intentional?
- Are dynamic imports avoided?
- Are `Require-Bundle` usages justified?
- Are repository sources curated?

### 41.4 Metadata generation

- Is DS annotation processing enabled?
- Is Metatype metadata generated where config exists?
- Is generated manifest inspected in CI?
- Are bnd warnings treated seriously?

### 41.5 Runtime descriptor

- Does each runtime have `.bndrun`?
- Are `-runrequires` meaningful?
- Is `-runbundles` reproducible?
- Is resolver run in CI?
- Are dev/debug/prod runtimes separated?

### 41.6 Compatibility

- Is baseline configured?
- Is previous release repository available?
- Are package versions bumped correctly?
- Is Java 8–25 compatibility tested according to support matrix?

### 41.7 Operations

- Can we trace which bundles are in production?
- Can we reproduce runtime distribution?
- Can we roll back to previous resolved runtime?
- Are shell/diagnostic bundles controlled per environment?

---

## 42. Anti-Patterns

### 42.1 `Export-Package: *`

Turns all code into API.

Consequence:

```text
No encapsulation.
Baseline noise.
Consumers depend on internals.
Refactoring becomes breaking change.
```

### 42.2 Manual manifest mixed with generated manifest

Consequence:

```text
Hard to know source of truth.
Generated imports conflict with manual headers.
Metadata drift.
```

### 42.3 Ignoring bnd warnings

Consequence:

```text
Runtime failure delayed.
Resolver errors become mysterious.
Architecture rot accumulates.
```

### 42.4 Embedding everything

Consequence:

```text
Large bundles.
Duplicate libraries.
Security patch pain.
Class identity issues.
```

### 42.5 Resolving only on developer machine

Consequence:

```text
CI misses runtime graph failure.
Production runtime differs.
Local cache hides missing repository metadata.
```

### 42.6 No baseline

Consequence:

```text
API compatibility broken silently.
Consumers fail after upgrade.
Version numbers become decorative.
```

### 42.7 Overusing macros

Consequence:

```text
bnd files become unreadable.
Architecture decisions hidden behind indirection.
Debugging becomes hard.
```

### 42.8 Treating Maven dependencies as OSGi runtime solution

Consequence:

```text
Compile succeeds but runtime fails.
Package imports unresolved.
uses constraint conflicts appear late.
```

---

## 43. Production Strategy: Immutable Runtime vs Hot Resolve

OSGi supports dynamic installation/update, but production strategy must be deliberate.

### 43.1 Immutable runtime

Build distribution once, deploy as unit.

Pros:

- reproducible,
- easier rollback,
- safer for Kubernetes/container deployment,
- easier audit.

Cons:

- less dynamic,
- full deployment for small plugin change.

### 43.2 Mutable hot deploy runtime

Install/update bundles while runtime is running.

Pros:

- dynamic plugin updates,
- no full restart,
- useful for long-running systems.

Cons:

- state migration complexity,
- refresh impact,
- classloader leaks,
- harder rollback,
- harder audit.

bnd supports building both styles, but tooling does not decide your operational risk.

Recommended enterprise default:

```text
Use immutable runtime for core platform.
Allow controlled plugin hot deployment only if plugin lifecycle, compatibility, state, and rollback are fully designed.
```

---

## 44. How bnd Fits with Future Parts

This part is a bridge.

Next parts will use bnd-generated artifacts when discussing:

- Felix runtime,
- Equinox runtime,
- Karaf features,
- HTTP Whiteboard,
- persistence,
- Event Admin,
- security,
- JPMS interop,
- testing,
- deployment,
- plugin platforms.

Mental dependency:

```text
OSGi concepts are runtime truths.
bnd turns those truths into build-time enforceable contracts.
```

Without bnd discipline, advanced OSGi becomes guesswork.

---

## 45. Practical Exercises

### Exercise 1 — Inspect generated manifest

Create a small bundle using DS annotation.

Check:

```text
MANIFEST.MF
OSGI-INF/*.xml
Import-Package
Export-Package
Service-Component
```

Ask:

```text
Which imports did bnd generate?
Which packages did I export intentionally?
Which package references surprised me?
```

### Exercise 2 — Break API version intentionally

1. Create API package version `1.0.0`.
2. Release/baseline it.
3. Add method to interface.
4. Run baseline.
5. Observe required version bump.

Goal:

```text
Feel compatibility as a test, not as theory.
```

### Exercise 3 — Resolve runtime from requirements

1. Create `.bndrun` with root app requirement.
2. Add DS runtime requirement.
3. Resolve.
4. Inspect generated `-runbundles`.
5. Remove one repository/provider.
6. Resolve again.

Goal:

```text
Understand repository metadata and resolver closure.
```

### Exercise 4 — Compare embed vs separate bundle

Use a third-party library in two ways:

1. As separate bundle.
2. Embedded in implementation bundle.

Observe:

- manifest imports,
- bundle size,
- runtime wiring,
- service contract leakage risk.

### Exercise 5 — Java compatibility check

Build same simple bundle for:

- Java 8 target,
- Java 17 target,
- Java 21/25 runtime.

Observe:

- classfile compatibility,
- EE metadata,
- dependency compatibility,
- illegal reflective access if any.

---

## 46. Key Takeaways

1. bnd is not merely a manifest generator; it is a build-time intelligence engine for OSGi modularity.
2. Manual manifests rot because code changes faster than metadata discipline.
3. `bnd.bnd` should express bundle identity, package boundary, and build policy.
4. `.bndrun` expresses runtime composition and resolver input.
5. `-runrequires` declares desired capabilities; `-runbundles` is the concrete resolved closure.
6. Baseline checking turns semantic versioning into enforceable compatibility control.
7. DS and Metatype annotations become runtime metadata through bnd processing.
8. Maven/Gradle compile success is not equivalent to OSGi runtime resolve success.
9. Repository hygiene determines resolver reliability.
10. Embedding dependencies is a design decision, not a convenience default.
11. bnd warnings should be treated as architectural feedback.
12. A top-tier OSGi project runs bundle build, baseline, resolver, and in-framework tests in CI.

---

## 47. Mini Glossary

| Term | Meaning |
|---|---|
| bnd | OSGi tooling engine for bundle metadata, analysis, resolving, baseline, runtime assembly |
| Bndtools | Eclipse-based development environment built around bnd |
| `bnd.bnd` | Project-level bnd configuration for bundle build |
| `build.bnd` | Workspace/global bnd configuration, often under `cnf` |
| `.bndrun` | Runtime descriptor for launching/resolving/exporting OSGi runtime |
| `-buildpath` | Build/compile analysis dependencies for bnd project |
| `Export-Package` | Packages exposed as OSGi API |
| `Private-Package` | Packages included in bundle but not exported |
| `-runrequires` | Root requirements for resolver/runtime assembly |
| `-runbundles` | Concrete resolved bundle list |
| Baseline | Compatibility comparison against previous release |
| Repository | Source of bundles/resources/capabilities used by resolver |
| DS metadata | XML generated from Declarative Services annotations |
| Metatype metadata | XML generated from typed configuration annotations |

---

## 48. What Comes Next

Next part:

```text
12-apache-felix-runtime-lightweight-framework-gogo-scr-fileinstall.md
```

Kita akan masuk ke Apache Felix sebagai runtime OSGi ringan:

- Felix Framework,
- Felix Main,
- Gogo shell,
- SCR runtime,
- Config Admin,
- FileInstall,
- Web Console,
- framework cache,
- embedding Felix,
- diagnostics,
- production layout,
- Felix-specific troubleshooting.

Part 11 selesai. Series belum selesai.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Configuration Admin and Metatype: Runtime Configuration as First-Class Contract](./10-configuration-admin-metatype-runtime-configuration-contract.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Apache Felix Runtime: Lightweight Framework, Gogo Shell, SCR, FileInstall](./12-apache-felix-runtime-lightweight-framework-gogo-scr-fileinstall.md)
