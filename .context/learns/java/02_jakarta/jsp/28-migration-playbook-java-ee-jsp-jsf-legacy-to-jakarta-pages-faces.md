# Part 28 — Migration Playbook: Java EE/JSP/JSF Legacy to Jakarta Pages/Faces

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `28-migration-playbook-java-ee-jsp-jsf-legacy-to-jakarta-pages-faces.md`  
> Fokus: migration strategy dari legacy Java EE/JSP/JSF `javax.*` menuju Jakarta Pages/Faces `jakarta.*`, dengan pendekatan enterprise-grade, testable, rollbackable, dan operationally safe.

---

## 0. Premis Utama

Migration dari Java EE/JSP/JSF legacy ke Jakarta Pages/Faces bukan sekadar mengganti import:

```java
javax.servlet.*  -> jakarta.servlet.*
javax.faces.*    -> jakarta.faces.*
javax.el.*       -> jakarta.el.*
javax.servlet.jsp.* -> jakarta.servlet.jsp.*
```

Secara teknis, namespace rename memang perubahan paling terlihat. Tetapi secara engineering, migration ini adalah perubahan pada **runtime contract**:

- container berubah,
- dependency graph berubah,
- taglib URI bisa berubah,
- generated JSP servlet berubah,
- JSF/Faces implementation berubah,
- lifecycle bug lama bisa muncul,
- library lama bisa tidak kompatibel,
- serialization/state saving bisa pecah,
- deployment packaging berubah,
- test baseline harus dibangun ulang,
- rollback harus realistis.

Top-tier engineer tidak melihat migration sebagai “search-replace”. Ia melihatnya sebagai **controlled system transition** dari satu runtime ecosystem ke ecosystem lain.

---

## 1. Mental Model Besar Migration

Bayangkan aplikasi legacy Java EE/JSP/JSF sebagai tumpukan kontrak:

```text
Browser
  |
  | HTTP request / HTML / JS / CSS / cookies
  v
Web Container
  |
  | Servlet, Filter, Listener, JSP engine, session manager
  v
View Layer
  |
  | JSP / JSTL / custom tags / JSF Facelets / components
  v
Binding Layer
  |
  | EL / CDI / managed beans / converters / validators
  v
Application Layer
  |
  | service / transaction / persistence / integration
  v
Infrastructure
  |
  | database / filesystem / queue / external APIs
```

Migration ke Jakarta menyentuh beberapa layer sekaligus:

```text
Source code imports                  -> javax.* to jakarta.*
Build dependencies                   -> new group/artifact/version coordinates
Container runtime                    -> Tomcat 9 -> 10+, EE 8 server -> EE 10/11 server
JSP/Jakarta Pages engine             -> updated APIs and generated servlet package
EL implementation                    -> jakarta.el.*
JSTL/Jakarta Tags                    -> URI and artifact changes
JSF/Jakarta Faces                    -> implementation/library compatibility
Configuration                        -> web.xml, faces-config.xml, TLD, tag files
Third-party libraries                -> javax-compatible vs jakarta-compatible line
Deployment artifact                  -> WAR compatibility boundary
Operations                          -> logs, metrics, classloading, session behavior
Security                            -> filters, CSRF, headers, view state, cookies
Testing                             -> compile, render, lifecycle, integration, regression
```

Karena itu migration yang aman harus mengikuti prinsip:

> **Inventory first, automate where safe, validate behavior where dangerous, and cut over with rollback.**

---

## 2. Target Migration: Jangan Mulai dari Tool, Mulai dari Target Runtime

Sebelum mengubah satu baris kode, tentukan target runtime.

Contoh target:

```text
Option A — Servlet-only stack
Java 17/21/25
Tomcat 10.1 or 11
Jakarta Servlet + Jakarta Pages + Jakarta Tags
No full Jakarta EE runtime

Option B — Full Jakarta EE 10 stack
Java 17/21
Jakarta EE 10 compatible server
Jakarta Faces 4.0-ish ecosystem

Option C — Full Jakarta EE 11 stack
Java 17/21/25
Jakarta EE 11 compatible server
Jakarta Pages 4.0
Jakarta Faces 4.1
Jakarta EL 6.0
CDI 4.1
Servlet 6.1
```

Target menentukan semuanya:

- dependency version,
- minimum Java runtime,
- library compatibility,
- server choice,
- taglib URI,
- security behavior,
- session serialization,
- CI build image,
- deployment rollback strategy.

### 2.1 Decision Rule

```text
Jika aplikasi hanya JSP/Servlet sederhana:
  target Servlet container modern bisa cukup.

Jika aplikasi memakai JSF/Faces + CDI + Bean Validation + JPA:
  pertimbangkan full Jakarta EE runtime atau stack yang benar-benar kompatibel.

Jika aplikasi mission-critical dan sangat legacy:
  migration bertahap lebih aman daripada big-bang.

Jika dependency pihak ketiga belum ada versi jakarta:
  jangan memaksa upgrade runtime dulu tanpa compatibility plan.
```

---

## 3. Java Version Strategy: Java 8 sampai Java 25

Seri ini mencakup Java 8–25. Untuk migration, yang penting bukan hanya “bisa compile”, tapi **runtime compatibility**.

### 3.1 Java 8 Legacy Zone

Banyak aplikasi Java EE 7/8 masih berada di Java 8.

Ciri umum:

- `javax.servlet.*`,
- `javax.faces.*`,
- `javax.el.*`,
- JSTL 1.2,
- JSF 2.2/2.3,
- JSP 2.x,
- old application server,
- Maven dependency lama,
- classpath-only,
- banyak reflection permissive,
- library lama yang belum modular.

Java 8 biasanya cocok sebagai **source baseline lama**, bukan target modern Jakarta EE 11.

### 3.2 Java 11 Transition Zone

Java 11 sering menjadi intermediate upgrade:

- masih relatif kompatibel untuk banyak aplikasi lama,
- tetapi beberapa Java EE APIs yang dulu bundled sudah tidak otomatis tersedia,
- TLS/default crypto behavior bisa berubah,
- GC/default JVM behavior berubah,
- old bytecode instrumentation bisa bermasalah.

### 3.3 Java 17 Modern Baseline

Java 17 adalah baseline penting karena banyak platform modern mensyaratkannya.

Dampak:

- stricter encapsulation dibanding Java 8,
- illegal reflective access bisa gagal,
- library lama perlu upgrade,
- records/sealed/pattern matching mulai bisa dimanfaatkan,
- runtime lebih cocok untuk Jakarta EE 10/11.

### 3.4 Java 21 dan Java 25

Java 21 dan 25 membawa modern runtime posture:

- virtual threads relevan untuk beberapa backend workload,
- GC dan observability lebih matang,
- language/runtime improvements,
- tetapi migration JSP/Faces tidak otomatis menjadi “virtual-thread optimized”.

Untuk JSP/Faces, Java 21/25 impact yang paling nyata:

- container compatibility,
- build plugin compatibility,
- bytecode level,
- annotation processing,
- classloading,
- old libraries yang memakai internal JDK API,
- removal/deprecation impact seperti SecurityManager assumptions.

### 3.5 Practical Upgrade Path

Untuk aplikasi besar, jangan langsung lakukan ini:

```text
Java 8 + Java EE 8 + javax.*
  -> Java 25 + Jakarta EE 11 + jakarta.*
```

Lebih aman:

```text
Stage 1: Stabilkan legacy di Java 8 / existing runtime
Stage 2: Upgrade build, test, dependency hygiene
Stage 3: Upgrade Java runtime ke 11/17 jika memungkinkan
Stage 4: Migrasi namespace javax -> jakarta
Stage 5: Upgrade container/server Jakarta
Stage 6: Upgrade Faces/Pages/Tags ecosystem
Stage 7: Optimasi untuk Java 21/25 bila target runtime mendukung
```

---

## 4. Inventory: Migration Dimulai dari Peta, Bukan Kode

Inventory harus menjawab:

1. File apa saja yang terdampak?
2. Dependency mana yang masih `javax`?
3. Runtime container apa yang sedang dipakai?
4. Fitur JSP/JSF apa yang dipakai?
5. Library UI apa yang dipakai?
6. Scope/state apa yang sensitif?
7. Area mana yang harus dites secara behavior?

### 4.1 Inventory Source Code

Cari pattern berikut:

```bash
# Java imports
rg "import javax\." src
rg "javax\." src

# JSP/tag/Facelets/config
rg "javax\." src/main/webapp
rg "java\.sun\.com|xmlns\.jcp\.org|jakarta\.ee" src/main/webapp
rg "taglib|faces-config|web.xml|tld|\.tag|\.tagx|\.xhtml|\.jsp" src/main/webapp

# Build files
rg "javax|jakarta|jsf|faces|jstl|servlet|jsp|el" pom.xml build.gradle gradle.properties
```

Hal yang perlu dicatat:

```text
Category                  Example
-----------------------------------------------------------------
Servlet API               javax.servlet.Filter
JSP API                   javax.servlet.jsp.tagext.SimpleTagSupport
EL API                    javax.el.ELResolver
JSF/Faces API             javax.faces.component.UIComponent
CDI                       javax.enterprise.context.RequestScoped
Inject                    javax.inject.Inject
Validation                javax.validation.constraints.NotNull
Persistence               javax.persistence.Entity
Annotation                javax.annotation.PostConstruct
JAX-RS                    javax.ws.rs.Path
Mail                      javax.mail.Message
Activation                javax.activation.DataHandler
```

Walaupun seri ini fokus Pages/Faces, migration sering menabrak API Jakarta lain karena UI layer terhubung ke CDI, Validation, Servlet, dan Persistence.

### 4.2 Inventory JSP

Buat daftar:

```text
File JSP
  - direct URL exposed or only under /WEB-INF?
  - uses scriptlet?
  - uses JSTL core/fmt/xml/sql?
  - uses custom taglib?
  - uses jsp:useBean?
  - uses include directive?
  - uses dynamic include?
  - creates session implicitly?
  - renders sensitive data?
  - renders raw HTML?
```

Command contoh:

```bash
find src/main/webapp -name "*.jsp" -o -name "*.jspf" | sort
rg "<%|%>|jsp:useBean|jsp:include|%@ include|taglib|escapeXml|session=|isELIgnored" src/main/webapp
```

### 4.3 Inventory Tag Library

Cari:

```text
/WEB-INF/tags/**/*.tag
/WEB-INF/tags/**/*.tagx
/WEB-INF/**/*.tld
META-INF/**/*.tld inside JARs
custom tag handler classes
```

Hal kritikal:

- custom tag handler import `javax.servlet.jsp.*`,
- TLD references old classes,
- dynamic attributes,
- body content,
- tag pooling assumptions,
- tag file include path.

### 4.4 Inventory Faces/JSF

Cari:

```bash
find src/main/webapp -name "*.xhtml" | sort
rg "javax\.faces|h:|f:|ui:|cc:|p:|o:|faces-config|FacesServlet|ViewScoped|ManagedBean" src
```

Catat:

```text
Area                      Yang dicari
------------------------------------------------------------------
faces-config.xml          version, namespace, navigation rules
web.xml                   FacesServlet mapping, context params
XHTML namespace           old/new URI
Managed beans             @ManagedBean vs CDI @Named
Scopes                    @ViewScoped, @SessionScoped, custom scope
Converters                converter-for-class, converter-id
Validators                validator-id, binding
Components                custom components, renderers
Libraries                 PrimeFaces, OmniFaces, RichFaces, BootsFaces
State saving              server/client, partial state saving
Ajax                      f:ajax, p:ajax, update/render targets
```

### 4.5 Inventory Runtime

Catat:

```text
Current runtime:
  - Java version
  - Application server/container
  - Servlet version
  - JSP/JSTL/JSF implementation
  - CDI implementation
  - Bean Validation implementation
  - deployment type WAR/EAR
  - session persistence/clustering
  - SSL termination
  - reverse proxy
  - authentication integration
```

Migration tanpa runtime inventory sering gagal saat deployment, bukan saat compile.

---

## 5. Dependency Graph: Area Paling Sering Menjebak

Namespace migration tidak bisa setengah-setengah dalam satu runtime boundary.

Masalah klasik:

```text
Application imports jakarta.servlet.*
Container provides jakarta.servlet.*
But library still expects javax.servlet.*
```

Atau sebaliknya:

```text
Application imports javax.faces.*
Container provides jakarta.faces.*
```

Hasilnya bisa berupa:

- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- `ClassCastException`,
- tag handler tidak ditemukan,
- Faces component tidak register,
- filter tidak jalan,
- CDI injection gagal,
- EL resolver tidak ditemukan.

### 5.1 Rule: Satu Boundary, Satu Namespace

Dalam satu deployed application boundary, jangan campur dependency API utama `javax` dan `jakarta` untuk spec yang sama.

Buruk:

```xml
<dependency>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
</dependency>

<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
</dependency>
```

Lebih benar:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <scope>provided</scope>
</dependency>
```

Tetapi versi harus cocok dengan target container.

### 5.2 Maven Dependency Audit

Gunakan:

```bash
mvn dependency:tree -Dincludes=javax.*
mvn dependency:tree -Dincludes=jakarta.*
mvn dependency:tree | rg "javax|jakarta|faces|jsf|servlet|jsp|el|jstl|tags"
```

Cari library yang membawa API lama secara transitif.

Contoh red flag:

```text
javax.servlet:javax.servlet-api
javax.faces:javax.faces-api
com.sun.faces:jsf-impl old javax line
javax.el:javax.el-api
javax.servlet:jstl
javax.validation:validation-api
javax.enterprise:cdi-api
```

### 5.3 Gradle Dependency Audit

```bash
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencyInsight --dependency javax.servlet
./gradlew dependencyInsight --dependency jakarta.servlet
```

### 5.4 Provided Scope Discipline

Untuk WAR di container:

```text
Servlet API      usually provided
JSP API          usually provided
EL API           usually provided
Faces API        depends on container; often provided in full EE server
JSTL/Tags        may need application dependency depending on container
CDI              provided in full EE, manually wired in servlet container
```

Jangan asal memasukkan semua API ke `WEB-INF/lib`, karena bisa menyebabkan classloading conflict dengan container.

---

## 6. Configuration Migration

### 6.1 `web.xml`

Legacy Java EE 8 style mungkin seperti:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee
                             http://xmlns.jcp.org/xml/ns/javaee/web-app_4_0.xsd"
         version="4.0">
</web-app>
```

Jakarta style bergantung target Servlet version. Untuk Jakarta Servlet modern, namespace biasanya berubah ke Jakarta schema.

Hal yang harus diperiksa:

- `FacesServlet` class,
- filter class,
- listener class,
- context-param,
- welcome-file,
- error-page,
- session-config,
- security-constraint,
- mime-mapping.

Legacy:

```xml
<servlet-class>javax.faces.webapp.FacesServlet</servlet-class>
```

Jakarta:

```xml
<servlet-class>jakarta.faces.webapp.FacesServlet</servlet-class>
```

### 6.2 `faces-config.xml`

Hal yang perlu dicek:

- XML namespace,
- version,
- managed-bean legacy,
- navigation rules,
- converter/validator declarations,
- component/renderer registration,
- application factories,
- resource bundle,
- lifecycle phase listener,
- exception handler factory.

Legacy managed bean config sebaiknya dipindahkan ke CDI `@Named` bila memungkinkan.

### 6.3 TLD Migration

TLD custom tag lama bisa berisi:

```xml
<tag-class>com.example.web.tags.SecureOutTag</tag-class>
```

Class ini mungkin import:

```java
import javax.servlet.jsp.tagext.SimpleTagSupport;
```

Harus menjadi:

```java
import jakarta.servlet.jsp.tagext.SimpleTagSupport;
```

TLD sendiri mungkin tidak terlihat error sampai JSP translation phase.

### 6.4 JSP Taglib URI

Legacy JSTL sering memakai:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
```

Jakarta Tags modern memakai URI baru, misalnya pola:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

Migration harus memastikan runtime Jakarta Tags yang dipakai memang menyediakan URI tersebut.

### 6.5 Facelets Namespace

Legacy JSF/Facelets bisa memakai URI lama:

```xml
xmlns:h="http://xmlns.jcp.org/jsf/html"
xmlns:f="http://xmlns.jcp.org/jsf/core"
xmlns:ui="http://xmlns.jcp.org/jsf/facelets"
```

Faces modern memperkenalkan namespace Jakarta-style. Migration perlu konsisten dengan implementasi dan library version.

Penting: jangan mengubah namespace XHTML secara mekanis tanpa test render, karena component library pihak ketiga punya namespace sendiri.

---

## 7. JSP-Specific Migration Playbook

### 7.1 Compile-Time Checks Tidak Cukup

JSP sering gagal bukan saat Java compile, tetapi saat:

- translation phase,
- first request,
- JSP precompile,
- tag handler instantiation,
- EL evaluation,
- generated servlet compilation.

Karena itu migration harus punya test:

```text
1. Java compile
2. JSP precompile / smoke render
3. HTTP integration render
4. Security rendering test
5. Regression comparison for critical pages
```

### 7.2 Scriptlet Legacy

Scriptlet tidak selalu harus langsung dihapus saat migration namespace, karena itu memperbesar risiko.

Lebih aman:

```text
Phase A: migrate namespace/runtime with minimal behavior change
Phase B: add tests around critical JSP
Phase C: refactor scriptlet into controller/view model/tag library
```

Jangan gabungkan migration dan refactor besar tanpa coverage.

### 7.3 Custom Tags

Migration steps:

```text
1. Update imports javax.servlet.jsp.* -> jakarta.servlet.jsp.*
2. Update TLD if class names/packages berubah
3. Check body-content semantics
4. Check dynamic attributes
5. Check tag pooling safety
6. Run JSP precompile
7. Run HTML render tests
```

Thread-safety tetap harus ditinjau. Migration adalah momen bagus untuk menemukan tag handler yang menyimpan request-specific state di field tanpa reset.

### 7.4 JSTL/Jakarta Tags

Migration steps:

```text
1. Replace old JSTL dependency with Jakarta Tags-compatible dependency
2. Update taglib URIs if target version requires it
3. Test c:out escaping
4. Test fmt locale/timezone
5. Remove sql tags if possible
6. Test XML tags if used
```

### 7.5 JSP Include/Layout

Static include bisa menimbulkan efek domino saat translation.

Checklist:

```text
- Does included fragment depend on variables declared by parent JSP?
- Does fragment contain taglib declarations?
- Does fragment define duplicate methods/declarations?
- Does dynamic include rely on request attributes?
- Are paths relative or absolute?
- Are fragments under /WEB-INF?
```

Migration bisa mengubah error surface karena generated servlet berbeda.

---

## 8. Faces-Specific Migration Playbook

### 8.1 JSF to Jakarta Faces Is More Than Imports

Legacy JSF code bisa punya:

```java
import javax.faces.view.ViewScoped;
import javax.faces.component.UIComponent;
import javax.faces.context.FacesContext;
import javax.faces.convert.Converter;
```

Jakarta:

```java
import jakarta.faces.view.ViewScoped;
import jakarta.faces.component.UIComponent;
import jakarta.faces.context.FacesContext;
import jakarta.faces.convert.Converter;
```

Tetapi masih ada area lain:

- implementation line: Mojarra/MyFaces,
- component library line: PrimeFaces/OmniFaces/etc,
- CDI integration,
- view scope serialization,
- `faces-config.xml`,
- Facelets namespaces,
- custom renderers,
- converters/validators,
- exception handlers,
- resource handlers,
- client-side JS generated by library.

### 8.2 Managed Bean Modernization

Legacy:

```java
@ManagedBean
@ViewScoped
public class CaseBean implements Serializable {
}
```

Modern CDI style:

```java
import jakarta.inject.Named;
import jakarta.faces.view.ViewScoped;

@Named
@ViewScoped
public class CaseBean implements Serializable {
}
```

Tetapi migration harus hati-hati:

```text
@ManagedBean lifecycle != CDI lifecycle in all details
injection model changes
proxy/passivation behavior changes
scope annotations can come from different packages
serialization requirement still matters
```

### 8.3 View Scope Trap

Ada beberapa annotation dengan nama mirip:

```text
javax.faces.view.ViewScoped
jakarta.faces.view.ViewScoped
org.omnifaces.cdi.ViewScoped
```

Masing-masing punya semantics dan compatibility berbeda. Saat migration, pastikan:

- import benar,
- bean serializable,
- dependencies passivation-capable,
- state tidak terlalu besar,
- multi-tab behavior diuji.

### 8.4 Faces Lifecycle Regression Tests

Migration bisa mengubah timing error.

Test minimal untuk critical page:

```text
Initial GET:
  - view renders
  - metadata/viewParam works
  - required data loaded

Postback valid:
  - converter runs
  - validator runs
  - model updates
  - action called
  - navigation correct

Postback invalid:
  - action not called if validation fails
  - messages rendered
  - submitted value preserved

Ajax:
  - execute target correct
  - render target correct
  - partial response valid
```

### 8.5 Component Library Compatibility

PrimeFaces/OmniFaces/RichFaces/BootsFaces-like libraries are the hardest migration blockers.

Checklist:

```text
- Is there a Jakarta-compatible version?
- Does it require Faces 4.x?
- Does it require Java 11/17?
- Does it require Servlet 5/6?
- Are theme artifacts compatible?
- Are deprecated components removed?
- Did JavaScript API change?
- Did file upload behavior change?
- Did DataTable filtering/sorting API change?
```

If no Jakarta-compatible line exists, options:

```text
1. Replace library
2. Transform library binary/source
3. Freeze legacy app and isolate it
4. Rewrite affected screens
5. Use strangler migration
```

---

## 9. Tooling Strategy

Tools help, but they do not replace analysis.

### 9.1 OpenRewrite

OpenRewrite can automate many source-level migrations.

Typical use:

```text
- update Java imports
- update dependencies
- update build plugins
- apply composite recipes for Jakarta EE migration
```

Strength:

- source-aware,
- repeatable,
- reviewable diffs,
- CI-friendly.

Weakness:

- not every JSP/tag/Facelets/config edge case is solved,
- custom libraries may need manual work,
- behavior still needs tests.

### 9.2 Apache Tomcat Migration Tool

Tomcat migration tooling is useful for Java EE 8 to Jakarta EE 9 style transformation, especially for WAR artifacts and Tomcat migration.

Strength:

- transforms classes/resources/artifacts,
- useful for quick compatibility experiment,
- can convert at deployment time in some Tomcat workflows.

Weakness:

- artifact transformation can hide source truth,
- better as bridge/experiment than long-term code ownership strategy,
- still needs validation.

### 9.3 Eclipse Transformer

Eclipse Transformer is a generic resource/archive transformer based on property rules.

Strength:

- can transform binaries/resources,
- useful when source not available,
- can handle non-Java resources depending on config.

Weakness:

- transformed artifact must be traceable,
- debugging can be harder,
- long-term maintainability prefers source migration.

### 9.4 Recommended Tooling Pattern

```text
For owned source code:
  Prefer source migration using OpenRewrite/manual review.

For third-party binary with no Jakarta version:
  Consider Eclipse Transformer or Tomcat migration tool as temporary bridge.

For Tomcat-only deployment experiment:
  Tomcat migration tool can help validate feasibility quickly.

For production long-term:
  Prefer native Jakarta-compatible dependencies.
```

---

## 10. Migration Phases

## Phase 0 — Stabilize Existing Legacy Baseline

Goal: know current behavior before changing runtime.

Tasks:

```text
- Freeze dependency versions
- Capture Java/container versions
- Capture startup logs
- Capture critical user journeys
- Add smoke tests
- Add JSP render smoke tests
- Add Faces postback tests for critical forms
- Add security rendering tests
- Add baseline performance metrics
```

Deliverables:

```text
legacy-runtime-inventory.md
legacy-dependency-tree.txt
critical-page-list.md
critical-journey-test-plan.md
rollback-plan.md
```

Do not migrate before you can answer:

> “How do we know the migrated app behaves the same?”

---

## Phase 1 — Dependency Hygiene

Goal: remove unnecessary chaos before namespace migration.

Tasks:

```text
- Remove duplicate APIs
- Remove unused web libraries
- Resolve dependency conflicts
- Separate provided/runtime dependencies
- Identify libraries without Jakarta-compatible version
- Upgrade test framework if needed
- Upgrade build plugins
```

Good signs:

```text
mvn dependency:tree is explainable
no duplicate servlet/faces APIs
no ancient transitive libraries hidden in WEB-INF/lib
build reproducible in CI
```

---

## Phase 2 — Container Compatibility Lab

Goal: test target runtime without committing production migration.

Tasks:

```text
- Create isolated branch
- Deploy minimal transformed WAR to target server
- Validate startup
- Validate one JSP page
- Validate one Faces page
- Validate one form postback
- Validate login/session
- Validate static resources
- Capture errors
```

This phase answers:

```text
Is target runtime feasible?
What fails first?
Are blockers source-level, dependency-level, or runtime-level?
```

---

## Phase 3 — Namespace Migration

Goal: move source/config/resources to Jakarta namespace.

Tasks:

```text
- Run automated migration recipe
- Update imports
- Update build dependencies
- Update web.xml/faces-config.xml/TLDs
- Update JSP taglib URIs
- Update Facelets namespaces where required
- Update tests
- Compile
- Run JSP precompile/smoke render
```

Review diffs carefully:

```text
- Did tool change generated sources only?
- Did tool miss JSP/tag/Facelets files?
- Did tool modify unrelated string literals?
- Did tool change comments only/noisy diffs?
- Did tool break custom reflection references?
```

---

## Phase 4 — Library Migration

Goal: align ecosystem.

Tasks:

```text
- Upgrade Faces implementation
- Upgrade component libraries
- Upgrade OmniFaces/PrimeFaces-like dependencies
- Upgrade Jakarta Tags
- Upgrade CDI/Validation integration dependencies
- Replace unsupported libraries
- Validate themes/resources
```

Risk:

```text
A source-compiling app may still fail because component library behavior changed.
```

Run UI regression tests.

---

## Phase 5 — Behavior Validation

Goal: prove critical behavior.

Test areas:

```text
Authentication and session:
  - login
  - logout
  - session timeout
  - concurrent tabs

JSP pages:
  - render
  - forms
  - escaping
  - includes/layout
  - custom tags

Faces pages:
  - initial GET
  - postback
  - validation failure
  - Ajax update
  - data table
  - navigation
  - view expiry

Security:
  - CSRF
  - XSS regression
  - hidden field tampering
  - unauthorized action

Operations:
  - startup time
  - memory
  - session size
  - logs
  - error pages
```

---

## Phase 6 — Performance and State Validation

Goal: ensure migration is not only functionally correct, but operationally safe.

Measure:

```text
- cold startup
- first JSP render
- average render latency
- p95/p99 page latency
- session count
- average session size
- view state size
- heap usage
- GC behavior
- generated HTML payload size
- Ajax response size
- static resource caching
```

Faces-specific:

```text
- component tree size
- restore view time
- render response time
- ViewExpiredException rate
- state serialization errors
```

---

## Phase 7 — Production Cutover

Goal: deploy safely.

Cutover plan should include:

```text
- deployment artifact version
- database compatibility statement
- config diff
- environment variables/secrets diff
- rollback artifact
- rollback container/runtime compatibility
- session handling decision
- monitoring dashboard
- smoke test checklist
- business validation checklist
- incident escalation contacts
```

Migration with session incompatibility may require:

```text
- planned maintenance window
- force logout
- session invalidation
- blue/green with no session sharing
```

Do not assume old serialized sessions can be read by new runtime.

---

## 11. Big-Bang vs Strangler Migration

### 11.1 Big-Bang

Useful when:

```text
- app is small
- good tests exist
- dependencies all have Jakarta versions
- runtime behavior is simple
- rollback is easy
```

Risk:

```text
- many failures at once
- difficult root cause analysis
- long stabilization period
```

### 11.2 Strangler

Useful when:

```text
- app is large
- many legacy JSP/JSF screens
- unsupported libraries exist
- business risk is high
- teams can split flows
```

Patterns:

```text
- route new screens to new app
- keep legacy screens in old runtime
- share authentication via SSO
- share backend APIs
- migrate module by module
- expose navigation bridge
```

Risk:

```text
- temporary duplication
- session/account context bridging
- inconsistent UI
- operational overhead
```

### 11.3 Hybrid Pattern

Often best:

```text
1. Source-migrate whole app to Jakarta in branch
2. Identify blockers
3. Extract hardest blockers into legacy island if needed
4. Migrate majority to modern runtime
5. Retire legacy island gradually
```

---

## 12. Rollback Design

Rollback is not simply “redeploy old WAR”.

Check:

```text
- Did DB schema change?
- Did session format change?
- Did cache keys change?
- Did file upload path change?
- Did external callback URL change?
- Did static asset version change?
- Did authentication cookie/session cookie change?
- Did serialized view state become incompatible?
```

### 12.1 Safe Rollback Pattern

```text
Before deploy:
  - keep old artifact
  - keep old config
  - keep old container image
  - keep old routing rule
  - define data compatibility

During deploy:
  - monitor startup
  - run smoke tests
  - monitor error spikes
  - monitor login/session
  - monitor page render errors

Rollback trigger:
  - critical login failure
  - high 5xx rate
  - critical page render failure
  - data corruption risk
  - unacceptable latency

Rollback action:
  - route back to old runtime
  - invalidate sessions if needed
  - restore config
  - announce user impact
```

---

## 13. Common Failure Modes and Diagnosis

## 13.1 `ClassNotFoundException: javax.servlet...`

Likely cause:

```text
A library or config still references javax.servlet.* in Jakarta runtime.
```

Check:

```bash
rg "javax.servlet" src target
jar tf app.war | rg "javax.servlet|web.xml|tld|faces-config"
```

## 13.2 `ClassNotFoundException: jakarta.servlet...`

Likely cause:

```text
Application migrated to jakarta.* but deployed on old Java EE container.
```

Fix:

```text
Deploy to Jakarta-compatible container or revert namespace.
```

## 13.3 JSP Tag Not Found

Likely causes:

```text
- wrong taglib URI
- missing Jakarta Tags dependency
- TLD not discovered
- custom tag class still javax
- classloading conflict
```

Check:

```text
- WEB-INF/lib
- META-INF/*.tld
- JSP generated error
- container startup logs
```

## 13.4 Faces Page Blank or Component Not Rendered

Likely causes:

```text
- Facelets namespace mismatch
- missing FacesServlet mapping
- component library mismatch
- tag not recognized
- rendered condition false due to bean change
```

## 13.5 CDI Injection Null

Likely causes:

```text
- bean still using legacy @ManagedBean
- missing beans.xml depending runtime
- wrong scope annotation package
- CDI not active in servlet-only runtime
- ambiguous/unsatisfied dependency
```

## 13.6 ViewExpiredException Spike

Likely causes:

```text
- state saving changed
- session invalidated during cutover
- cluster replication incompatible
- view state token from old deployment posted to new deployment
- session timeout/config changed
```

Cutover mitigation:

```text
- planned logout
- maintenance banner
- route sticky users consistently
- avoid blue/green mixing incompatible view states
```

## 13.7 Ajax Partial Response Parse Error

Likely causes:

```text
- exception rendered as HTML inside XML partial response
- session timeout redirects to login page
- invalid component update target
- duplicate id
- component library JavaScript mismatch
```

## 13.8 Serialization Error

Likely causes:

```text
- @ViewScoped bean not serializable
- injected dependency not passivation-capable
- component state includes non-serializable object
- old session restored with new class serialVersionUID
```

---

## 14. Migration Testing Matrix

| Area | Test | Why It Matters |
|---|---|---|
| Startup | deploy app and scan logs | catches classloading/config failures |
| JSP compile | precompile or hit all critical JSPs | catches taglib/import/TLD errors |
| HTML render | parse output with jsoup | catches broken layout/form/menu |
| XSS | render malicious data | validates output encoding |
| CSRF | submit without/with token | validates server enforcement |
| Faces initial GET | open page with params | validates metadata/viewParam/load |
| Faces invalid submit | submit invalid form | validates converter/validator/messages |
| Faces valid submit | submit valid form | validates update model/action/navigation |
| Faces Ajax | trigger partial update | validates execute/render/client id |
| View state | postback old/new state | validates session/view state behavior |
| Multi-tab | edit same entity in two tabs | validates stale state strategy |
| Authorization | render and invoke restricted action | validates view + server enforcement |
| Performance | p95/p99 render under load | validates operational safety |
| Rollback | redeploy old artifact | validates recovery path |

---

## 15. CI/CD Pipeline Blueprint

A mature migration pipeline:

```text
1. Checkout
2. Build dependency audit
3. Static search for forbidden javax imports
4. Compile
5. Unit tests
6. JSP precompile/smoke render
7. Faces integration tests
8. Security rendering tests
9. Package WAR
10. Dependency SBOM
11. Container startup test
12. Smoke HTTP tests
13. Publish artifact
```

### 15.1 Forbidden Namespace Gate

After full Jakarta migration, add CI gate:

```bash
rg "javax\.(servlet|faces|el|enterprise|inject|validation|persistence|annotation)" src && exit 1 || exit 0
```

But be careful with:

```text
- comments
- documentation
- migration notes
- intentionally isolated legacy module
```

Prefer precise allowlist.

### 15.2 Runtime Smoke Test

Example smoke endpoints/pages:

```text
/health
/login
/WEB-INF-forwards/page-list
/faces/case/search.xhtml
/faces/case/detail.xhtml?id=test
/static/app.css
```

For JSP under `/WEB-INF`, use controller routes that forward to them.

---

## 16. Refactoring During Migration: What to Do and What Not to Do

### 16.1 Good Refactoring During Migration

Low-risk improvements:

```text
- remove duplicate dependencies
- replace obvious provided/runtime scope errors
- move magic versions to BOM/properties
- add tests
- add logging around startup/render failures
- fix broken imports
- externalize target runtime config
```

### 16.2 Dangerous Refactoring During Migration

High-risk if combined with namespace migration:

```text
- rewrite all JSP to Facelets
- rewrite JSF to SPA
- replace component library
- redesign session model
- change navigation flow
- change persistence lazy loading strategy
- change authentication/session scheme
- change URL structure
```

Sometimes necessary, but should be separate phase unless dependency blocker forces it.

---

## 17. JSP to Faces? Faces to JSP? Or Both to SPA?

Migration to Jakarta namespace is different from UI architecture migration.

### 17.1 JSP Legacy to Jakarta Pages

Good when:

```text
- pages are mostly server-rendered CRUD/list/detail
- team wants minimal behavior change
- custom tags already encapsulate layout
- no need for rich component lifecycle
```

### 17.2 JSP to Faces

Consider only if:

```text
- application benefits from component lifecycle
- validation/conversion/navigation/state are complex
- team understands Faces lifecycle
- component library adoption is strategic
```

Risk:

```text
This is a rewrite, not namespace migration.
```

### 17.3 Faces to SPA

Consider if:

```text
- UX requires heavy client-side interactivity
- APIs already exist
- team has frontend capability
- server-side state is causing scaling pain
```

Risk:

```text
You are replacing rendering architecture, validation boundary, state model, and security surface.
```

### 17.4 Keep Both

A pragmatic enterprise approach:

```text
- JSP/Faces for admin/back-office screens
- REST APIs for integration/mobile/SPA
- SPA for high-interactivity public-facing modules
```

---

## 18. Enterprise Migration Example: Regulatory Case Management UI

Assume legacy app:

```text
Java 8
Java EE 8
Tomcat 9 or legacy app server
JSP + JSTL + custom tags
Some JSF 2.3 screens
PrimeFaces old line
CDI + Bean Validation + JPA
Session-heavy case workflow
```

### 18.1 Inventory Findings

```text
- 420 JSP files
- 38 JSP fragments
- 24 tag files
- 11 TLDs
- 64 JSF XHTML views
- 52 @ManagedBean classes
- 18 @ViewScoped beans
- 9 custom converters
- 6 custom validators
- 1 custom ResourceHandler
- PrimeFaces old javax line
- OmniFaces old javax line
- SQL tags found in 3 legacy reports
```

### 18.2 Risk Ranking

| Risk | Severity | Reason |
|---|---:|---|
| PrimeFaces line incompatible | High | blocks Faces runtime |
| ViewScoped serialization | High | postback/session risk |
| Custom tags javax imports | Medium | compile/translation failure |
| SQL tags | Medium | layering/security risk |
| JSP scriptlets | Medium | hard to test |
| taglib URI mismatch | High | page render failure |
| session size | High | cluster/cutover risk |

### 18.3 Plan

```text
Step 1: Add render smoke tests for top 50 pages
Step 2: Add Faces lifecycle tests for top 10 workflows
Step 3: Upgrade build to Java 17-capable toolchain
Step 4: Clean dependency tree
Step 5: Run OpenRewrite migration in branch
Step 6: Update custom tags manually
Step 7: Upgrade PrimeFaces/OmniFaces to Jakarta-compatible line
Step 8: Deploy to target Jakarta runtime in lab
Step 9: Fix translation/render failures
Step 10: Run security/performance validation
Step 11: Blue/green deploy with forced session reset if state incompatible
```

### 18.4 Cutover Caveat

Faces view state from old deployment should not be expected to survive into new deployment. For a case management platform, that means:

```text
- avoid cutover during active form-heavy work window
- warn users to save drafts
- invalidate old sessions if needed
- redirect stale postbacks to safe recovery page
```

---

## 19. Migration Checklists

## 19.1 Source Checklist

```text
[ ] No unwanted javax.servlet imports
[ ] No unwanted javax.faces imports
[ ] No unwanted javax.el imports
[ ] No unwanted javax.servlet.jsp imports
[ ] CDI imports consistent
[ ] Validation imports consistent
[ ] Persistence imports consistent
[ ] Custom tags migrated
[ ] Converters migrated
[ ] Validators migrated
[ ] Phase listeners migrated
[ ] Exception/resource/view handlers migrated
```

## 19.2 JSP Checklist

```text
[ ] JSP compiles/translates
[ ] Taglib URIs correct
[ ] Jakarta Tags dependency available
[ ] Custom TLDs discovered
[ ] Tag files render
[ ] Includes resolve correctly
[ ] Error pages work
[ ] c:out escaping preserved
[ ] fmt locale/timezone preserved
[ ] No SQL tags in critical path
```

## 19.3 Faces Checklist

```text
[ ] FacesServlet mapping works
[ ] faces-config namespace/version correct
[ ] XHTML namespaces recognized
[ ] CDI @Named beans resolved
[ ] ViewScoped beans serializable
[ ] Converters registered
[ ] Validators registered
[ ] ResourceHandler works
[ ] Component library works
[ ] Ajax partial rendering works
[ ] View state strategy chosen
[ ] ViewExpiredException recovery exists
```

## 19.4 Security Checklist

```text
[ ] CSRF works after migration
[ ] Session cookie flags preserved
[ ] SameSite behavior checked
[ ] Cache-control headers preserved
[ ] CSP compatible with generated UI
[ ] Error pages do not leak stack traces
[ ] Authorization enforced server-side
[ ] Hidden fields validated server-side
[ ] Client-side view state protected if enabled
[ ] File upload/download security preserved
```

## 19.5 Operations Checklist

```text
[ ] Startup logs clean
[ ] Runtime memory acceptable
[ ] Session size acceptable
[ ] JSP first-hit latency acceptable
[ ] Faces p95/p99 acceptable
[ ] Static resources cached/versioned
[ ] Monitoring dashboards updated
[ ] Alerts updated
[ ] Rollback tested
[ ] Support runbook written
```

---

## 20. Heuristics for Top 1% Engineering Judgment

### 20.1 Migration Is Not Success When It Compiles

It succeeds when:

```text
- critical journeys still work,
- security controls still hold,
- state behavior is understood,
- performance is acceptable,
- rollback is possible,
- team can maintain the result.
```

### 20.2 Do Not Hide Runtime Contract Changes

Be explicit:

```text
Old runtime:
  Java 8 + Java EE 8 + javax + old JSF

New runtime:
  Java 17/21/25 + Jakarta EE 10/11 + jakarta + Faces 4.x
```

This is not a patch. This is platform migration.

### 20.3 Test the Seams

Most migration bugs occur at seams:

```text
JSP -> tag library
Facelets -> component library
EL -> bean property
CDI -> backing bean
Faces state -> session
container -> app dependency
security filter -> UI form
view -> persistence lazy loading
```

### 20.4 Avoid Combining Semantic Changes

Bad migration plan:

```text
Upgrade Java + migrate Jakarta + replace JSF + redesign UI + change auth + refactor DB
```

Better:

```text
One runtime dimension at a time where possible.
```

### 20.5 Own the Compatibility Matrix

Never rely on vague claims like:

```text
“It supports Jakarta.”
```

Ask:

```text
Which Jakarta EE version?
Which Servlet version?
Which Faces version?
Which Java minimum?
Which component library line?
Which CDI/EL version?
Which container tested?
```

---

## 21. Minimal Practical Migration Blueprint

For a real project, start with this folder:

```text
docs/migration/java-ee-to-jakarta/
  00-current-state.md
  01-target-runtime.md
  02-dependency-audit.md
  03-source-inventory.md
  04-jsp-inventory.md
  05-faces-inventory.md
  06-library-compatibility.md
  07-test-plan.md
  08-cutover-plan.md
  09-rollback-plan.md
  10-known-risks.md
```

And this branch strategy:

```text
main
  legacy-stabilization
  jakarta-migration-lab
  jakarta-runtime-integration
  jakarta-release-candidate
```

And this acceptance criteria:

```text
[ ] Dependency tree explainable
[ ] No unintended javax references
[ ] All critical JSP render
[ ] All critical Faces flows pass
[ ] Security tests pass
[ ] Performance baseline acceptable
[ ] Rollback tested
[ ] Production runbook ready
```

---

## 22. Final Mental Model

Migration from Java EE/JSP/JSF to Jakarta Pages/Faces is a **system migration** across API namespace, runtime container, view engine, component lifecycle, dependency ecosystem, and operational behavior.

The best engineer does not ask only:

> “How do I replace `javax` with `jakarta`?”

They ask:

```text
What runtime contract changes?
What state survives?
What views compile but fail at render time?
What libraries are truly compatible?
What user journeys prove correctness?
What security assumptions changed?
What operational metrics prove safety?
What rollback path exists?
```

That mindset is what turns a risky namespace migration into a controlled engineering transition.

---

## 23. What Comes Next

Part berikutnya:

```text
29-architecture-patterns-jsp-faces-modern-enterprise-systems.md
```

Fokus berikutnya adalah architecture patterns: bagaimana JSP/Faces ditempatkan dalam modern enterprise systems, termasuk MVC, view model, form object, wizard flow, authorization-aware navigation, audit trail integration, hybrid REST/SPA/server-side UI, dan decision framework memilih JSP/Faces vs SPA.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./27-library-ecosystem-mojarra-myfaces-omnifaces-primefaces.md">⬅️ Part 27 — Library Ecosystem: Mojarra, MyFaces, OmniFaces, PrimeFaces, dan Konteks Component Library Jakarta Faces</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./29-architecture-patterns-jsp-faces-modern-enterprise-systems.md">Part 29 — Architecture Patterns: JSP/Faces in Modern Enterprise Systems ➡️</a>
</div>
