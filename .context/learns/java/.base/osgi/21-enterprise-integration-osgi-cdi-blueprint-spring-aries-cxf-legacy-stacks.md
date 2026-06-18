# Part 21 — Enterprise Integration in OSGi: CDI, Blueprint, Spring, Aries, CXF, and Legacy Stacks

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
Part: `21 / 35`  
File: `21-enterprise-integration-osgi-cdi-blueprint-spring-aries-cxf-legacy-stacks.md`  
Target Java: `8 → 25`  
Level: Advanced / Platform Engineering

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas OSGi dari sisi core runtime: bundle, classloading, resolver, service registry, Declarative Services, configuration, runtime implementation, web, persistence, messaging, security, JPMS, dan kompatibilitas Java 8 sampai 25.

Part ini membahas satu area yang sering membuat sistem OSGi enterprise menjadi sulit: **integrasi dengan enterprise programming model lain**.

Yang dimaksud enterprise programming model di sini meliputi:

- **Declarative Services (DS)** sebagai model komponen native OSGi modern.
- **Blueprint** sebagai DI container XML/annotation-oriented yang historically dekat dengan Spring Dynamic Modules.
- **CDI integration** sebagai jembatan antara CDI programming model dan OSGi service registry.
- **Apache Aries** sebagai kumpulan implementasi service OSGi enterprise: Blueprint, JPA, Transaction Control, JNDI, Remote Service Admin, SPI-Fly, Subsystems, dan lain-lain.
- **Apache CXF** untuk SOAP/REST/web service stack dalam runtime OSGi/Karaf.
- **Spring / Spring DM / Spring inside OSGi** sebagai realitas legacy enterprise yang banyak ditemui.
- **Legacy Java EE/Jakarta EE style code** yang ingin dimodularisasi ke OSGi atau dijalankan berdampingan.

Tujuan akhirnya bukan supaya kita hafal semua framework, tetapi supaya kita mampu menjawab pertanyaan arsitektural seperti:

1. Kapan cukup memakai DS?
2. Kapan Blueprint masih masuk akal?
3. Bagaimana CDI masuk ke OSGi tanpa menabrak lifecycle OSGi?
4. Bagaimana menghindari dual-container lifecycle conflict?
5. Bagaimana mengintegrasikan JPA/transaction/web service tanpa membuat classloader hell?
6. Bagaimana memigrasikan legacy Spring/XML/JEE code ke OSGi secara bertahap?
7. Bagaimana memilih pola integrasi yang defensible untuk sistem enterprise yang long-lived?

---

## 1. Mental Model Utama: OSGi Bukan “DI Container Lain”

Kesalahan pertama dalam integrasi enterprise OSGi adalah menganggap OSGi sama seperti Spring/CDI/Java EE container.

Padahal OSGi framework memiliki tanggung jawab berbeda.

| Layer | Tanggung jawab utama |
|---|---|
| OSGi Framework | bundle lifecycle, module isolation, class visibility, service registry, dynamic runtime |
| Declarative Services | component lifecycle berbasis OSGi service registry |
| Blueprint | dependency injection container berbasis bundle, XML/config-driven |
| CDI | programming model enterprise berbasis bean discovery, injection, qualifier, scope, event |
| Spring | application context, bean factory, dependency injection, AOP, ecosystem framework |
| Java EE/Jakarta EE server | application deployment, managed components, transactions, security, web container, resource injection |
| Apache Aries | implementasi sejumlah spesifikasi/service enterprise OSGi |
| Apache CXF | web service/REST/SOAP integration stack |

OSGi tidak terutama menjawab:

> “Bagaimana membuat object dan inject dependency?”

OSGi terutama menjawab:

> “Bagaimana sebuah runtime Java dapat terdiri dari banyak module dengan class visibility eksplisit, lifecycle dinamis, versioned dependency, dan service yang bisa muncul/hilang ketika aplikasi sedang hidup?”

Karena itu, ketika kita membawa Spring, CDI, Blueprint, JPA, CXF, atau legacy Java EE ke OSGi, pertanyaan pentingnya bukan hanya:

> “Bisa jalan atau tidak?”

Tetapi:

> “Siapa yang memiliki lifecycle object ini, siapa yang melihat class ini, siapa yang mengontrol dependency ini, dan apa yang terjadi ketika bundle/service/config berubah saat runtime?”

Top 1% engineer harus melihat integrasi enterprise OSGi sebagai **lifecycle composition problem**, bukan sekadar dependency injection problem.

---

## 2. Native Baseline: Declarative Services Sebagai Default Modern

Sebelum bicara Blueprint/CDI/Spring, kita perlu menetapkan baseline.

Untuk OSGi modern, default yang paling aman biasanya adalah:

```text
OSGi bundle + Declarative Services + Configuration Admin + Metatype + bnd
```

Kenapa?

Karena DS dirancang langsung untuk OSGi service dynamics.

DS memahami:

- service reference bisa muncul;
- service reference bisa hilang;
- reference bisa mandatory/optional/multiple;
- reference bisa static/dynamic;
- component bisa satisfied/unsatisfied;
- config bisa berubah;
- component lifecycle harus mengikuti OSGi runtime.

Contoh sederhana:

```java
@Component(service = CaseAssignmentService.class)
public class DefaultCaseAssignmentService implements CaseAssignmentService {

    private final RuleEngine ruleEngine;

    @Activate
    public DefaultCaseAssignmentService(@Reference RuleEngine ruleEngine) {
        this.ruleEngine = ruleEngine;
    }

    @Override
    public AssignmentResult assign(CaseContext context) {
        return ruleEngine.evaluate(context);
    }
}
```

Dalam model DS, `DefaultCaseAssignmentService` tidak dibuat oleh Spring, tidak dibuat oleh CDI, dan tidak dibuat manual oleh `BundleActivator`. Component dibuat oleh Service Component Runtime ketika requirement-nya satisfied.

Itu berarti lifecycle-nya sinkron dengan service graph OSGi.

### 2.1 Kenapa DS Sering Lebih Baik dari Blueprint/Spring untuk OSGi Murni

DS unggul ketika:

- sistem sangat service-registry centric;
- dependency antar bundle harus dinamis;
- module boundary harus jelas;
- configuration ingin mengikuti Configuration Admin;
- metadata ingin dihasilkan dari annotation oleh bnd;
- startup harus ringan;
- runtime perlu hot update atau service replacement;
- plugin topology dinamis;
- dependency graph ingin mudah didiagnosis dengan SCR commands.

DS tidak membawa full application context besar. Ia lebih dekat ke **component model native untuk OSGi**.

### 2.2 Batas DS

DS bukan pengganti semua enterprise framework.

DS tidak menyediakan secara native:

- full AOP programming model seperti Spring;
- rich CDI scope/qualifier/event ecosystem;
- large enterprise integration library ecosystem;
- ORM/persistence management sendiri;
- declarative transaction model sekomprehensif Java EE/Spring;
- application-level convention seperti Spring Boot.

Karena itu integrasi enterprise tetap relevan. Tetapi integrasi harus dimulai dari prinsip:

> Kalau kebutuhan bisa diselesaikan dengan DS + OSGi service + Config Admin secara bersih, jangan langsung membawa container besar.

---

## 3. Blueprint: DI Container Enterprise untuk OSGi

Blueprint adalah spesifikasi OSGi Compendium yang mendefinisikan container dependency injection berbasis bundle. Blueprint muncul sebagai cara membawa model mirip Spring ke OSGi dengan lifecycle yang lebih sesuai.

Secara historis, Blueprint dipengaruhi oleh Spring Dynamic Modules. Banyak runtime enterprise OSGi, terutama Apache Karaf/Fuse-style systems, memakai Blueprint cukup luas.

### 3.1 Mental Model Blueprint

Blueprint bekerja dengan file XML di bundle, biasanya:

```text
OSGI-INF/blueprint/*.xml
```

atau pada beberapa tool/runtime juga bisa berbasis annotation/extension.

Bundle berisi metadata Blueprint. Ketika bundle aktif dan Blueprint extender menemukan metadata itu, Blueprint container dibuat untuk bundle tersebut.

Mental modelnya:

```text
Bundle installed/resolved/started
        ↓
Blueprint extender detects blueprint metadata
        ↓
Blueprint container created for that bundle
        ↓
Beans are created/wired
        ↓
OSGi services may be imported/exported
        ↓
Container destroyed when bundle stops
```

Blueprint bukan global application context untuk seluruh runtime. Ia biasanya **per bundle**.

### 3.2 Contoh Blueprint XML

```xml
<blueprint xmlns="http://www.osgi.org/xmlns/blueprint/v1.0.0">

    <bean id="caseAssignmentService"
          class="com.example.caseassignment.internal.DefaultCaseAssignmentService">
        <argument ref="ruleEngine" />
    </bean>

    <reference id="ruleEngine"
               interface="com.example.rules.api.RuleEngine" />

    <service ref="caseAssignmentService"
             interface="com.example.caseassignment.api.CaseAssignmentService" />

</blueprint>
```

Interpretasi:

- `reference` mengimpor OSGi service dari registry.
- `bean` membuat object internal bundle.
- `service` mengekspor bean sebagai OSGi service.

Blueprint adalah bridge antara bean model dan OSGi service registry.

### 3.3 Blueprint vs DS

| Aspek | DS | Blueprint |
|---|---|---|
| Style | annotation/component metadata | XML-first, sometimes annotation extension |
| Native dynamic service model | sangat kuat | kuat, tapi lebih container-centric |
| Startup overhead | ringan | cenderung lebih berat |
| Tooling modern | sangat baik via bnd | baik di Karaf/Aries ecosystem |
| Legacy XML integration | kurang cocok | sangat cocok |
| Spring-like familiarity | sedang | tinggi |
| Component graph visibility | SCR-centric | Blueprint container-centric |
| Granularity | component/service | bundle container + beans |
| Best for | modern OSGi services | legacy enterprise wiring / Karaf apps |

### 3.4 Kapan Blueprint Masih Masuk Akal

Blueprint masih masuk akal ketika:

1. Sistem sudah berbasis Karaf/Fuse/Aries Blueprint.
2. Ada banyak XML wiring legacy.
3. Tim familiar dengan Spring XML style.
4. Ada library enterprise yang sudah disediakan sebagai Blueprint integration.
5. Kamu perlu bridge JPA/transaction/CXF yang sudah lazim di Aries/Karaf stack.
6. Migrasi langsung ke DS terlalu mahal.

Blueprint tidak salah. Yang salah adalah memakai Blueprint untuk semua hal hanya karena familiar dengan Spring XML, lalu mengabaikan dynamic service lifecycle.

### 3.5 Blueprint Failure Modes

Beberapa failure mode umum:

#### 3.5.1 Blueprint Container Menunggu Reference Mandatory

Jika reference mandatory belum tersedia, container bisa tertahan.

```xml
<reference id="externalConnector"
           interface="com.example.connector.ExternalConnector" />
```

Jika tidak ada service `ExternalConnector`, bean yang bergantung padanya tidak dapat dibuat.

Pertanyaan diagnosis:

- Apakah service provider bundle sudah active?
- Apakah package API wired sama?
- Apakah service interface class identity sama?
- Apakah filter terlalu ketat?
- Apakah service ranking/selection sesuai?

#### 3.5.2 Proxy dan Interface Requirement

Banyak transaction/AOP/proxy mechanism membutuhkan interface. Jika class concrete dipakai langsung, proxy bisa gagal atau membutuhkan bytecode library tambahan.

Design guideline:

```text
Service boundary enterprise sebaiknya interface-first.
```

#### 3.5.3 XML Drift

XML mudah tidak sinkron dengan refactoring Java.

Mitigasi:

- integration tests in-framework;
- CI validation;
- bnd manifest verification;
- minimize XML for new modules;
- migrate high-churn code to DS.

#### 3.5.4 Hidden Global Context Thinking

Spring-style developer sering menganggap semua bean bisa saling inject dalam satu global context. Di OSGi, bundle boundary tetap berlaku.

Jika package tidak di-export/import dengan benar, Blueprint tidak bisa menyelamatkan desain yang salah.

---

## 4. CDI Integration: Membawa CDI ke Dynamic OSGi Runtime

CDI adalah programming model enterprise Java yang menyediakan:

- bean discovery;
- injection;
- qualifiers;
- scopes;
- interceptors;
- decorators;
- events;
- portable extensions.

Dalam Java EE/Jakarta EE, CDI biasanya hidup dalam application server atau CDI container. Dalam OSGi, CDI integration harus menyesuaikan dengan:

- bundle lifecycle;
- service registry;
- classloader isolation;
- Configuration Admin;
- dynamic dependency availability.

OSGi Compendium R8 mendefinisikan CDI Integration Specification. Tujuannya adalah mengintegrasikan CDI programming model dengan OSGi service registry dan configuration model, bukan menghapus OSGi service dynamics.

### 4.1 Mental Model CDI di OSGi

Model konseptual:

```text
Bundle with CDI metadata
        ↓
CDI extender/container detects bundle
        ↓
CDI container component is created
        ↓
CDI beans are discovered in bundle scope
        ↓
OSGi services can be injected/exported
        ↓
CDI components react to OSGi dependency/config lifecycle
```

Perbedaan penting dibanding CDI biasa:

- CDI container hidup dalam konteks bundle/runtime OSGi.
- OSGi services dapat menjadi dependencies CDI beans.
- CDI beans dapat dipublish sebagai OSGi services.
- Dynamic lifecycle OSGi tetap harus dihormati.

### 4.2 CDI vs DS

| Aspek | DS | CDI Integration |
|---|---|---|
| Filosofi | OSGi-native service component | CDI programming model integrated with OSGi |
| Dependency model | OSGi service reference | CDI injection + OSGi service bridge |
| Scope | OSGi component/service scope | CDI scopes + OSGi concepts |
| Ecosystem | OSGi-focused | Jakarta/CDI-focused |
| Complexity | lebih kecil | lebih tinggi |
| Cocok untuk | platform/runtime service | reuse CDI-based code |

### 4.3 Kapan CDI Integration Cocok

CDI integration cocok ketika:

1. Ada codebase CDI yang ingin dipakai di OSGi.
2. Tim sudah punya CDI expertise.
3. Kamu ingin memakai qualifier/interceptor/decorator CDI secara konsisten.
4. Runtime OSGi digunakan sebagai modular platform, tapi beberapa module enterprise lebih natural dengan CDI.
5. Kamu butuh bridge antara OSGi service registry dan CDI beans.

### 4.4 Kapan CDI Integration Tidak Perlu

Tidak perlu memakai CDI hanya untuk:

- inject satu atau dua service;
- membuat component sederhana;
- menggantikan DS tanpa alasan;
- meniru Spring Boot di OSGi;
- membuat runtime lebih familiar tapi lebih berat.

Untuk module OSGi baru yang sederhana, DS biasanya lebih direct.

### 4.5 CDI Failure Modes di OSGi

#### 4.5.1 Bean Discovery Tidak Melihat Class

Penyebab:

- class berada di package private yang tidak diakses container;
- metadata CDI tidak benar;
- bundle classpath tidak sesuai;
- annotation package mismatch `javax.*` vs `jakarta.*`;
- Java 9+ strong encapsulation/reflection issue.

#### 4.5.2 Scope Tidak Selaras dengan OSGi Service Dynamics

CDI developer mungkin terbiasa dengan `@ApplicationScoped` object yang stabil sepanjang aplikasi hidup. Di OSGi, dependency service bisa hilang.

Pertanyaan desain:

```text
Apa yang terjadi jika OSGi service dependency unregistered saat CDI bean masih hidup?
```

Jawaban yang defensible:

- dependency harus proxied/dynamic-aware;
- component harus deactivate/recreate;
- operation harus fail fast;
- service availability harus direpresentasikan eksplisit.

#### 4.5.3 Interceptor/AOP Classloading

CDI interceptors/decorators memakai reflection/proxy/bytecode logic. Di OSGi, ini berarti:

- package import harus lengkap;
- proxy class harus dibuat di classloader yang benar;
- TCCL bisa perlu dikontrol;
- Java 17+ reflective access mungkin membutuhkan `--add-opens` untuk library tertentu.

---

## 5. Apache Aries: Enterprise OSGi Toolkit

Apache Aries adalah project penting dalam ekosistem OSGi enterprise. Aries menyediakan implementasi berbagai spesifikasi dan integration modules.

Beberapa area Aries yang sering relevan:

- Blueprint;
- JPA;
- Transaction Control;
- JNDI;
- Remote Service Admin;
- SPI-Fly;
- Subsystems;
- Async Services;
- Push Streams;
- CDI-related modules pada beberapa ekosistem;
- proxy/weaving utilities.

Mental model Aries:

```text
OSGi Core gives the runtime model.
Aries gives many enterprise service implementations and integration bridges.
```

### 5.1 Aries Blueprint

Aries Blueprint adalah implementasi Blueprint yang banyak digunakan di Karaf/Fuse-style runtime.

Ia berguna untuk:

- XML-based wiring;
- service reference/import;
- service export;
- property placeholder;
- transaction integration;
- CXF/JPA-style enterprise stacks.

### 5.2 Aries JPA

Aries JPA membantu penggunaan container-managed persistence di OSGi. Tantangan JPA di OSGi adalah:

- persistence unit discovery;
- provider discovery;
- entity classloader;
- transaction integration;
- DataSource availability;
- enhancement/weaving;
- package visibility.

Aries JPA menyediakan pendekatan yang lebih OSGi-aware dibanding mencoba menjalankan JPA seperti di classpath biasa.

### 5.3 Aries Transaction Control

Transaction Control Service menyediakan model scoped work.

Konsepnya:

```java
transactionControl.required(() -> {
    // work with transactional resource
    repository.save(entity);
    auditRepository.append(audit);
    return result;
});
```

Mental model:

- transaksi bukan magic global;
- scope transaksi dibuat eksplisit;
- resource provider menyediakan JDBC/JPA resource;
- service registry menyediakan `TransactionControl` dan `ResourceProvider`.

Ini cocok dengan OSGi karena dependency resource adalah service.

### 5.4 Aries SPI-Fly

Banyak library Java memakai `ServiceLoader`.

Masalahnya: `ServiceLoader` mengasumsikan classpath dan TCCL tertentu. Di OSGi, provider class bisa berada di bundle lain dan tidak terlihat langsung.

SPI-Fly membantu memediasi Java SPI discovery agar bekerja dalam OSGi.

Contoh problem:

- JDBC driver discovery;
- JAXB provider;
- JSON provider;
- scripting engine;
- XML parser;
- logging provider;
- Jakarta REST provider.

Top-tier rule:

> Jika library memakai `ServiceLoader`, jangan langsung berasumsi akan bekerja di OSGi. Tentukan apakah akan memakai explicit OSGi service bridge, SPI-Fly, atau TCCL bridge terkontrol.

---

## 6. Spring dan OSGi: Realitas Legacy dan Batas Praktis

Spring dan OSGi punya sejarah panjang. Ada Spring Dynamic Modules, SpringSource dm Server, Virgo, dan berbagai attempt untuk membawa Spring application context ke OSGi secara natural.

Tetapi ekosistem modern Spring Boot lebih condong ke:

```text
fat jar / executable app / mostly classpath or JPMS-adjacent model
```

daripada:

```text
dynamic per-bundle modular runtime
```

Artinya, integrasi Spring + OSGi perlu hati-hati.

### 6.1 Problem Dasar Spring di OSGi

Spring sering mengasumsikan:

- application context besar;
- classpath relatif global;
- annotation scanning luas;
- resource scanning lintas packages;
- AOP/proxy dengan visibility cukup luas;
- lifecycle context stabil;
- dependency tidak hilang setelah context dibuat.

OSGi justru mengasumsikan:

- class visibility eksplisit;
- bundle lifecycle dinamis;
- service bisa muncul/hilang;
- package import/export harus contractual;
- runtime graph bisa berubah;
- tidak semua class terlihat dari semua bundle.

Konfliknya bukan karena Spring buruk atau OSGi buruk. Konfliknya karena **asumsi runtime berbeda**.

### 6.2 Pattern Spring Inside OSGi

Ada beberapa pilihan.

#### Pattern A — Spring sebagai internal implementation detail bundle

```text
Bundle A
 ├─ exports API package
 ├─ imports OSGi service dependencies
 ├─ internally creates Spring ApplicationContext
 └─ publishes selected facade as OSGi service
```

Kelebihan:

- legacy Spring code bisa dipakai;
- OSGi boundary tetap service-level;
- Spring tidak bocor ke seluruh runtime.

Kekurangan:

- startup lebih berat;
- lifecycle bridging harus ditulis;
- classpath scanning harus dibatasi;
- shutdown context harus benar.

Guideline:

> Spring boleh menjadi implementation detail, tetapi jangan jadikan seluruh OSGi runtime sebagai satu Spring context besar.

#### Pattern B — OSGi sebagai plugin island dalam Spring Boot

```text
Spring Boot host process
        ↓
Embedded OSGi framework
        ↓
Plugin bundles expose services
        ↓
Bridge service adapts plugin to Spring bean
```

Cocok ketika:

- sistem utama sudah Spring Boot;
- hanya butuh plugin subsystem;
- plugin lifecycle perlu dinamis;
- ingin membatasi OSGi ke area extensibility.

Risiko:

- dua lifecycle: Spring lifecycle dan OSGi lifecycle;
- classloader boundary makin kompleks;
- memory leak saat plugin reload;
- service bridge harus jelas.

#### Pattern C — Spring Boot separate process, OSGi as separate runtime

```text
Spring Boot service  ←HTTP/gRPC/message→  OSGi plugin platform
```

Cocok ketika:

- isolation lebih penting;
- plugin security risk tinggi;
- operational team lebih nyaman service separation;
- dynamic in-process integration tidak wajib.

Trade-off:

- network boundary;
- distributed failure modes;
- latency;
- deployment complexity.

### 6.3 Spring Anti-Patterns di OSGi

#### Anti-pattern 1 — Satu Global Spring Context untuk Semua Bundle

Ini menghapus nilai OSGi.

Masalah:

- bundle boundary blur;
- package visibility dibypass;
- lifecycle tidak selaras;
- hot update sulit;
- dependency graph tersembunyi.

#### Anti-pattern 2 — Annotation Scanning Lintas Runtime

Misalnya Spring diminta scan `com.company` seluruhnya.

Di OSGi, ini rawan karena:

- class tidak terlihat;
- resource tidak tersedia;
- scanning lambat;
- dynamic update tidak predictable.

Lebih baik scan terbatas di bundle sendiri.

#### Anti-pattern 3 — Spring Bean Diexpose Langsung sebagai OSGi Contract Tanpa Boundary

Jangan expose internal Spring implementation class sebagai API OSGi.

Lebih baik:

```text
api bundle: CaseAssignmentService interface
impl bundle: Spring-managed DefaultCaseAssignmentService
OSGi export: service interface only
```

#### Anti-pattern 4 — Mengandalkan Static ApplicationContext Holder

Ini menyebabkan:

- hidden global state;
- classloader leak;
- stale bundle reference;
- reload failure.

---

## 7. Apache CXF dalam OSGi

Apache CXF sering digunakan untuk:

- SOAP web services;
- JAX-WS;
- JAX-RS;
- REST endpoints;
- WS-Security;
- enterprise integration;
- Karaf/Fuse stack.

Dalam OSGi, CXF biasanya berjalan sebagai bundle stack dan terintegrasi dengan Blueprint/Karaf features.

### 7.1 Mental Model CXF di OSGi

```text
API bundle
  ↓
service implementation bundle
  ↓
Blueprint/DS registration
  ↓
CXF extender/runtime detects endpoint metadata
  ↓
HTTP service / servlet transport exposes endpoint
```

CXF membawa banyak dependency dan banyak mekanisme runtime:

- annotation scanning;
- JAXB/Jakarta XML binding;
- providers/interceptors;
- servlet transport;
- security interceptors;
- bus configuration;
- WSDL generation;
- client proxy generation.

Setiap item itu punya implikasi classloading.

### 7.2 CXF dengan Blueprint

Banyak contoh Karaf/CXF memakai Blueprint XML.

Contoh konseptual:

```xml
<blueprint xmlns="http://www.osgi.org/xmlns/blueprint/v1.0.0"
           xmlns:jaxrs="http://cxf.apache.org/blueprint/jaxrs">

    <bean id="caseResource"
          class="com.example.caseapi.internal.CaseResource" />

    <jaxrs:server id="caseServer" address="/cases">
        <jaxrs:serviceBeans>
            <ref component-id="caseResource" />
        </jaxrs:serviceBeans>
    </jaxrs:server>

</blueprint>
```

Ini nyaman di Karaf stack, tetapi tetap harus hati-hati:

- resource class harus visible;
- provider class harus visible;
- API DTO package harus versioned;
- JAXB/Jackson provider harus wired benar;
- javax/jakarta namespace harus konsisten.

### 7.3 CXF Failure Modes

#### 7.3.1 JAXB / Jakarta XML Binding Provider Tidak Ketemu

Penyebab:

- Java 11+ tidak lagi menyertakan JAXB module bawaan;
- provider dependency tidak dibundle/import;
- ServiceLoader tidak bekerja karena OSGi classloader;
- SPI-Fly/TCCL bridge tidak dikonfigurasi.

#### 7.3.2 Provider JSON Tidak Terpakai

Penyebab:

- Jackson provider package tidak visible;
- JAX-RS runtime memakai classloader berbeda;
- provider registration tidak masuk endpoint;
- javax/jakarta mismatch.

#### 7.3.3 Endpoint Active Tapi Service Dependency Missing

Endpoint bisa terekspos tetapi dependency bisnis belum ready jika lifecycle bridge salah.

Design rule:

```text
Endpoint readiness harus mengikuti service readiness, bukan sekadar HTTP servlet registration.
```

#### 7.3.4 javax vs jakarta Stack Campur

Ini salah satu problem besar di Java 11+ dan Jakarta EE 9+.

Jangan campur:

```text
javax.ws.rs.*
```

dengan:

```text
jakarta.ws.rs.*
```

dalam endpoint/provider yang sama kecuali ada compatibility bridge eksplisit.

---

## 8. Dual Lifecycle Conflict

Ini bagian paling penting.

Ketika OSGi diintegrasikan dengan Spring/CDI/Blueprint/JPA/CXF, sering ada lebih dari satu lifecycle manager.

Contoh:

```text
OSGi Framework
  controls bundle lifecycle

Declarative Services
  controls DS component lifecycle

Blueprint Container
  controls bean lifecycle inside bundle

CDI Container
  controls CDI bean lifecycle

Spring ApplicationContext
  controls Spring bean lifecycle

JPA Provider
  controls EntityManagerFactory lifecycle

CXF Runtime
  controls endpoint lifecycle
```

Pertanyaan arsitektur yang harus dijawab:

1. Siapa yang membuat object?
2. Siapa yang menghancurkan object?
3. Siapa yang memiliki thread/resource?
4. Siapa yang memegang reference ke siapa?
5. Apa yang terjadi saat dependency hilang?
6. Apa yang terjadi saat config berubah?
7. Apa yang terjadi saat bundle update/refresh?
8. Apa yang terjadi saat runtime shutdown?

### 8.1 Ownership Rule

Gunakan aturan ini:

```text
Setiap object/resource harus punya satu lifecycle owner yang jelas.
```

Contoh buruk:

```text
Spring membuat service object.
DS juga mencoba inject/register object yang sama.
Blueprint juga memegang bean tersebut.
```

Contoh baik:

```text
Spring owns internal beans.
Bridge component owns OSGi service registration.
OSGi consumers only see API service.
```

### 8.2 Boundary Rule

```text
Jangan biarkan object dari container A bocor sebagai implementation detail ke container B.
```

Lebih baik expose interface/DTO yang stabil.

### 8.3 Shutdown Rule

Saat bundle stop:

- unregister OSGi service;
- stop endpoint;
- close application context;
- close EntityManagerFactory;
- close DataSource/pool if owned;
- stop executor;
- remove listeners;
- clear ThreadLocal;
- restore TCCL if changed.

Jika tidak, classloader leak hampir pasti muncul pada hot update.

---

## 9. Integration Pattern Catalog

### 9.1 DS-First Pattern

Ini default modern.

```text
API bundle
  ↓
DS implementation bundle
  ↓
OSGi services
  ↓
Config Admin
```

Cocok untuk:

- new OSGi module;
- service-oriented platform;
- plugin system;
- dynamic runtime;
- low overhead.

Contoh:

```java
@Component(service = RiskScorer.class)
public class DefaultRiskScorer implements RiskScorer {
    private final List<RiskRule> rules;

    @Activate
    public DefaultRiskScorer(@Reference(cardinality = ReferenceCardinality.MULTIPLE)
                             List<RiskRule> rules) {
        this.rules = List.copyOf(rules);
    }
}
```

### 9.2 Blueprint Legacy Bridge Pattern

```text
Legacy XML/Blueprint bundle
  imports OSGi services
  creates internal beans
  exports facade service
```

Cocok untuk:

- Karaf legacy systems;
- XML-heavy integration;
- CXF/SOAP/JPA stacks.

Guideline:

- keep Blueprint boundary small;
- export service interface only;
- avoid global bean graph;
- add in-framework tests.

### 9.3 CDI Island Pattern

```text
CDI-enabled bundle
  CDI owns internal beans
  OSGi CDI integration bridges services/config
  selected service exported
```

Cocok untuk:

- reuse CDI domain/application services;
- qualifier/interceptor-heavy code;
- Jakarta-oriented teams.

Guideline:

- be explicit about OSGi service dynamics;
- avoid assuming stable app-wide context;
- define scopes carefully.

### 9.4 Spring Internal Context Pattern

```text
OSGi bundle
  starts private Spring ApplicationContext
  imports OSGi dependencies through bridge
  exports stable OSGi facade
```

Cocok untuk:

- legacy Spring code;
- gradual migration;
- complex internal Spring wiring.

Guideline:

- scan only local packages;
- close context on bundle stop;
- expose API interface only;
- avoid Spring types in OSGi API;
- test bundle reload.

### 9.5 External Process Pattern

```text
OSGi runtime  ←network→  Spring Boot/Jakarta service
```

Cocok untuk:

- strong isolation;
- different operational lifecycle;
- high security risk;
- cloud-native services;
- heavy framework stack not worth embedding.

Trade-off:

- latency;
- network failure;
- distributed transaction concerns;
- observability correlation.

### 9.6 Adapter Bundle Pattern

```text
OSGi API service
  ↓
Adapter bundle
  ↓
Legacy library/framework
```

Cocok untuk:

- non-OSGi library;
- ServiceLoader-based library;
- legacy SDK;
- vendor connector.

The adapter hides classloading complexity.

### 9.7 Extender Integration Pattern

```text
Bundles declare metadata
  ↓
Extender scans metadata
  ↓
Extender registers services/endpoints/resources
```

Examples:

- DS extender;
- Blueprint extender;
- Web Whiteboard extender;
- JPA extender;
- CXF endpoint extender;
- custom regulatory rule extender.

Cocok ketika runtime behavior harus ditambahkan berdasarkan metadata bundle.

---

## 10. Transaction Integration Strategy

Enterprise integration hampir selalu menyentuh transaksi.

Di OSGi, transaksi harus dipikirkan sebagai service/runtime boundary, bukan asumsi magic annotation saja.

### 10.1 Annotation Transaction vs Explicit Transaction Scope

Spring/Java EE style:

```java
@Transactional
public void approveCase(String caseId) {
    repository.updateStatus(caseId, APPROVED);
    audit.append(...);
}
```

OSGi Transaction Control style:

```java
transactionControl.required(() -> {
    repository.updateStatus(caseId, APPROVED);
    audit.append(...);
    return null;
});
```

Trade-off:

| Model | Kelebihan | Risiko |
|---|---|---|
| Annotation | familiar, declarative, concise | proxy/classloading/lifecycle complexity |
| Explicit scope | clear, testable, OSGi-service-friendly | more verbose |

Top-tier approach:

- untuk DS-first module, explicit transaction scope sering lebih predictable;
- untuk Blueprint/Spring legacy, annotation bisa diterima bila proxy model jelas;
- jangan campur model transaksi tanpa ownership boundary.

### 10.2 Transaction Boundary Tidak Boleh Melintasi Dynamic Service Tanpa Kontrak

Contoh risk:

```text
Service A starts transaction
  calls dynamic Service B
    Service B may disappear/update
```

Pertanyaan:

- Apakah Service B mandatory dan statically bound?
- Apa yang terjadi jika Service B unregistered saat call?
- Apakah Service B memakai database sama?
- Apakah transaksi lokal atau XA?
- Apakah rollback semantics jelas?

Jika tidak jelas, gunakan boundary yang lebih eksplisit.

### 10.3 Distributed Transaction Warning

OSGi in-process tidak menghapus masalah distributed transaction jika resource berbeda:

- database A;
- database B;
- JMS broker;
- external HTTP API;
- file storage.

Jangan menjadikan OSGi sebagai alasan memakai XA sembarangan. Untuk banyak sistem modern, outbox/idempotency/saga lebih defensible.

---

## 11. Persistence Integration Revisited: DS vs Blueprint vs Aries JPA

Kita sudah membahas persistence di Part 16. Di sini fokusnya pada pilihan integration model.

### 11.1 DS + Transaction Control + Repository Service

```text
DataSource/ResourceProvider service
  ↓
TransactionControl service
  ↓
Repository DS component
  ↓
Domain service DS component
```

Kelebihan:

- explicit;
- service-registry native;
- easier to test;
- less XML;
- lifecycle predictable.

Kekurangan:

- lebih banyak plumbing;
- tidak seperti Java EE/Spring idiom.

### 11.2 Blueprint + JPA/Transaction

```text
Blueprint container
  ↓
EntityManager/Transaction integration
  ↓
Bean wiring
  ↓
Service export
```

Kelebihan:

- familiar untuk Karaf/Fuse stack;
- XML wiring bisa jelas;
- legacy enterprise integration mature.

Kekurangan:

- proxy/classloading issues;
- XML drift;
- lifecycle debugging lebih kompleks.

### 11.3 Spring Internal JPA Context

```text
Private Spring context
  owns EntityManagerFactory/Repositories
  exports OSGi facade
```

Kelebihan:

- reuse Spring Data/JPA code;
- migration cepat.

Kekurangan:

- dependency berat;
- scanning/proxy/TCCL issues;
- hot reload risk;
- OSGi boundary harus sangat disiplin.

### 11.4 Rule of Thumb

```text
New OSGi-native module → DS + explicit service/resource model.
Karaf legacy module → Blueprint/Aries acceptable.
Existing Spring Data module → Spring internal context or external service.
High-risk persistence plugin → separate process or restricted adapter.
```

---

## 12. JNDI in OSGi

Java EE applications sering memakai JNDI untuk lookup resources.

OSGi lebih natural memakai service registry.

| Java EE style | OSGi style |
|---|---|
| lookup DataSource dari JNDI | get DataSource service |
| `@Resource` injection | DS/Blueprint/CDI service injection |
| app server manages resource globally | resource provider bundle registers service |

Apache Aries menyediakan JNDI integration untuk OSGi, tetapi secara desain baru, service registry biasanya lebih sesuai.

Gunakan JNDI bridge jika:

- legacy library hardcoded JNDI;
- migration cost tinggi;
- app server style code perlu dijalankan sementara.

Jangan gunakan JNDI hanya karena familiar.

---

## 13. Remote Service Admin dan Distributed Integration

OSGi Remote Service Admin memungkinkan service OSGi diekspor/diimpor secara remote.

Konsep:

```text
Local OSGi service
  ↓ export metadata
Remote Service Admin
  ↓ transport/discovery
Remote OSGi service proxy
```

Ini menarik, tetapi harus hati-hati.

Masalah utama:

- local call semantics berubah menjadi network call;
- latency;
- partial failure;
- serialization compatibility;
- security;
- versioning;
- service disappearance;
- retry/idempotency.

Top-tier rule:

> Jangan membuat remote service terlihat terlalu mirip local service jika failure semantics-nya berbeda.

Jika memakai Remote Service Admin, kontrak service harus didesain seperti distributed API:

- timeout;
- retry policy;
- idempotency;
- DTO versioning;
- error taxonomy;
- correlation ID;
- security context propagation.

---

## 14. ServiceLoader, SPI, dan Legacy Library

Banyak legacy Java library memakai SPI:

```text
META-INF/services/com.example.Provider
```

Di classpath biasa:

```java
ServiceLoader.load(Provider.class)
```

Di OSGi, provider mungkin ada di bundle lain dan tidak terlihat.

### 14.1 Pilihan Integrasi SPI

#### Option A — Convert Provider to OSGi Service

Best untuk code yang bisa dikontrol.

```java
@Component(service = DocumentRenderer.class)
public class PdfDocumentRenderer implements DocumentRenderer { }
```

#### Option B — Adapter Bundle

Untuk library yang tidak bisa diubah.

```text
Adapter bundle sees provider library
Adapter registers provider as OSGi service
Consumers use OSGi service
```

#### Option C — SPI-Fly

Untuk library yang sangat bergantung pada ServiceLoader dan sulit diubah.

#### Option D — Controlled TCCL Bridge

Terakhir, jika harus.

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(providerClassLoader);
    legacyLibrary.call();
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Gunakan dengan sangat hati-hati.

### 14.2 SPI Integration Checklist

- Library memakai `ServiceLoader`?
- Provider class ada di bundle mana?
- Consumer bisa melihat provider interface?
- Provider implementation harus terlihat oleh siapa?
- Apakah provider discovery terjadi saat startup atau lazy?
- Apakah provider bisa berubah runtime?
- Apakah ada static cache provider?
- Bagaimana cleanup saat bundle stop?

---

## 15. javax ke jakarta dalam Enterprise OSGi

Enterprise OSGi sering terkena transisi:

```text
javax.* → jakarta.*
```

Contoh:

- `javax.ws.rs` → `jakarta.ws.rs`
- `javax.persistence` → `jakarta.persistence`
- `javax.transaction` → `jakarta.transaction`
- `javax.annotation` → `jakarta.annotation`
- `javax.xml.bind` → `jakarta.xml.bind`
- `javax.servlet` → `jakarta.servlet`

Masalah OSGi:

- package name berbeda berarti package identity berbeda total;
- service interface berbeda berarti class identity berbeda;
- provider javax tidak bisa satisfy consumer jakarta;
- endpoint annotation javax tidak dibaca runtime jakarta;
- JPA provider version harus cocok;
- CXF/Jersey/Pax Web stack harus satu generasi.

### 15.1 Strategy Matrix

| Situation | Strategy |
|---|---|
| Runtime lama Java 8/11 + javax stack | pertahankan javax secara konsisten |
| Runtime baru Jakarta stack | migrasi seluruh web/JPA/transaction provider ke jakarta |
| Mixed third-party dependency | isolate via adapter/process |
| API bundle exposed ke plugin | pilih satu namespace dan version policy jelas |
| Long migration | support two API generations as separate packages/services |

### 15.2 Jangan Campur Stack Diam-Diam

Buruk:

```text
Servlet jakarta
JAX-RS javax
Jackson provider jakarta
JPA javax
Transaction jakarta
```

Ini menghasilkan error yang sulit:

- provider tidak ditemukan;
- annotation ignored;
- class cast;
- resolver conflict;
- uses constraint violation;
- runtime endpoint active tapi broken.

Lebih defensible:

```text
Runtime profile: javax enterprise stack
```

atau:

```text
Runtime profile: jakarta enterprise stack
```

Jangan “campur karena kebetulan compile”.

---

## 16. Java 8 sampai 25: Enterprise Integration Impact

### 16.1 Java 8

Karakter:

- banyak enterprise library lama masih cocok;
- Java EE modules masih tersedia di JDK;
- Security Manager masih ada;
- reflection lebih longgar;
- JPMS belum ada.

Risiko:

- library tua;
- TLS/security provider lama;
- bytecode compatibility;
- upgrade gap besar.

### 16.2 Java 11

Impact:

- Java EE/CORBA modules dihapus dari JDK;
- JAXB/JAX-WS/Activation harus dependency eksplisit;
- reflection warnings mulai relevan;
- banyak library enterprise perlu update.

### 16.3 Java 17

Impact:

- strong encapsulation lebih tegas;
- old bytecode/proxy libraries sering bermasalah;
- Security Manager deprecated for removal;
- baseline modern LTS enterprise.

### 16.4 Java 21

Impact:

- virtual threads available;
- structured concurrency preview/incubator path;
- runtime performance improved;
- legacy bytecode tools harus kompatibel.

### 16.5 Java 24/25

Impact:

- Security Manager tidak bisa dijadikan sandbox;
- semakin banyak internal API tidak boleh diasumsikan;
- dependency harus modern;
- OSGi plugin trust model harus governance/process isolation.

### 16.6 Compatibility Checklist

Untuk setiap enterprise integration bundle:

- bytecode target apa?
- memakai `javax` atau `jakarta`?
- butuh reflection deep access?
- memakai CGLIB/ByteBuddy/ASM versi berapa?
- memakai JAXB/JAX-WS/Activation?
- memakai ServiceLoader?
- memakai JNDI?
- memakai dynamic proxy interface atau class proxy?
- butuh TCCL?
- punya thread/executor sendiri?
- cleanup saat bundle stop?
- baseline test di Java 8/11/17/21/25?

---

## 17. Enterprise Integration Architecture Decision Framework

Gunakan decision framework berikut saat memilih integrasi.

### 17.1 Pertanyaan 1 — Apakah Module Baru atau Legacy?

```text
New module → prefer DS-first.
Legacy Blueprint/Karaf → keep Blueprint initially.
Legacy CDI → consider CDI integration or adapter.
Legacy Spring → internal Spring context or external process.
```

### 17.2 Pertanyaan 2 — Apakah Butuh Dynamic Runtime?

Jika iya:

- DS biasanya paling natural;
- Blueprint bisa, tapi perhatikan container lifecycle;
- Spring/CDI harus bridge carefully.

Jika tidak:

- mungkin OSGi bukan boundary yang tepat;
- bisa gunakan external service;
- jangan pakai OSGi hanya untuk fashion.

### 17.3 Pertanyaan 3 — Apakah Framework Membawa Banyak Reflection/Scanning?

Jika iya:

- isolate;
- minimize scanning scope;
- add imports explicitly;
- test on Java 17/21/25;
- watch TCCL.

### 17.4 Pertanyaan 4 — Siapa Pemilik Lifecycle?

Harus ada jawaban eksplisit.

Contoh:

```text
OSGi owns bundle lifecycle.
DS owns bridge component.
Spring owns internal beans.
Bridge closes Spring context on deactivate.
Only OSGi service interface is exported.
```

Jika tidak bisa menjawab ini, desain belum siap.

### 17.5 Pertanyaan 5 — Apakah Ada Namespace Migration?

Jika ada javax/jakarta migration:

- jangan campur sembarangan;
- buat runtime profile;
- test resolver;
- version API explicitly;
- support bridge only when necessary.

---

## 18. Example Architecture: Enforcement Platform with Mixed Enterprise Integration

Bayangkan regulatory enforcement platform berbasis OSGi.

Kebutuhan:

- rule plugins dinamis;
- case lifecycle service;
- document rendering;
- external agency connector;
- audit trail;
- REST API;
- legacy SOAP connector;
- legacy Spring library untuk report generation;
- persistence dengan database enterprise.

### 18.1 Suggested Module Layout

```text
com.acme.enforcement.api.case
com.acme.enforcement.api.rule
com.acme.enforcement.api.audit
com.acme.enforcement.api.document

com.acme.enforcement.core.case.ds
com.acme.enforcement.core.rule.ds
com.acme.enforcement.core.audit.ds

com.acme.enforcement.persistence.ds
com.acme.enforcement.web.jaxrs

com.acme.enforcement.connector.soap.cxf.blueprint
com.acme.enforcement.report.spring.adapter
com.acme.enforcement.plugin.rules.sample
```

### 18.2 Integration Choices

| Area | Choice | Reason |
|---|---|---|
| Rule plugins | DS whiteboard | dynamic service plugins |
| Case service | DS | core OSGi-native service |
| Audit | DS + explicit transaction/outbox | predictable lifecycle |
| REST API | HTTP/JAX-RS Whiteboard | dynamic endpoint registration |
| SOAP connector | CXF + Blueprint | legacy SOAP stack |
| Report generator | Spring internal context adapter | reuse existing Spring code |
| Persistence | DS + Transaction Control or Aries JPA | service-oriented resource management |
| Config | Config Admin + Metatype | runtime config contract |

### 18.3 Runtime Boundary Diagram

```text
[REST Bundle]
    ↓ OSGi service
[Case API]
    ↓
[Case DS Component]
    ↓             ↓
[Rule Service Registry]   [Audit Service]
    ↓                         ↓
[Rule Plugin Bundles]     [Persistence Bundle]

[SOAP CXF Blueprint Bundle]
    ↓ OSGi service
[External Agency Connector API]

[Spring Report Adapter Bundle]
    owns private Spring context
    exports DocumentRenderer service
```

### 18.4 Why This Is Defensible

Karena setiap integration island punya boundary jelas:

- DS untuk dynamic OSGi-native services;
- Blueprint untuk legacy CXF SOAP;
- Spring hanya internal adapter;
- API packages stabil;
- service contracts tidak expose framework-specific types;
- config dikelola via Config Admin;
- lifecycle owner jelas.

---

## 19. Production Checklist for Enterprise Integration

### 19.1 Bundle Boundary

- Apakah API package terpisah dari implementation package?
- Apakah framework-specific class tidak bocor ke API?
- Apakah package version benar?
- Apakah `uses:=` dianalisis?
- Apakah import range reasonable?

### 19.2 Lifecycle

- Siapa lifecycle owner object/resource?
- Apakah context/container ditutup saat bundle stop?
- Apakah executor/thread dihentikan?
- Apakah service unregistered sebelum resource close?
- Apakah config update ditangani?

### 19.3 Classloading

- Apakah scanning scope dibatasi?
- Apakah ServiceLoader butuh bridge?
- Apakah TCCL dipakai?
- Apakah proxy library compatible Java target?
- Apakah javax/jakarta konsisten?

### 19.4 Transaction

- Apakah transaction manager service tersedia?
- Apakah boundary transaksi jelas?
- Apakah dynamic service call dalam transaksi aman?
- Apakah rollback behavior jelas?
- Apakah external side effect idempotent?

### 19.5 Operations

- Apakah ada shell command untuk inspect component/container?
- Apakah health/readiness benar?
- Apakah logs punya bundle/component context?
- Apakah error resolver terlihat di CI?
- Apakah hot update diuji?
- Apakah rollback diuji?

### 19.6 Security

- Apakah management shell protected?
- Apakah plugin bundle trusted?
- Apakah signing/repository governance ada?
- Apakah secrets tidak masuk config plain text?
- Apakah external connector credentials rotated?

---

## 20. Troubleshooting Playbook

### 20.1 Blueprint Container Tidak Start

Check:

1. Bundle state active?
2. Blueprint extender active?
3. Blueprint XML path benar?
4. XML namespace/schema benar?
5. Mandatory service reference tersedia?
6. Interface package wired sama?
7. Proxy dependency tersedia?
8. Config placeholder resolved?

### 20.2 CDI Bean Tidak Terdiscover

Check:

1. CDI extender/container active?
2. Bean discovery mode benar?
3. Annotation namespace javax/jakarta cocok?
4. Class package visible?
5. Bundle classpath benar?
6. Reflection/proxy dependency tersedia?

### 20.3 Spring Context Gagal Start

Check:

1. Scanning terlalu luas?
2. Missing import package?
3. Resource pattern tidak terlihat?
4. AOP/proxy library kompatibel?
5. TCCL expectation?
6. Circular dependency?
7. `javax`/`jakarta` mismatch?

### 20.4 CXF Endpoint Tidak Muncul

Check:

1. CXF feature/bundles installed?
2. HTTP transport active?
3. Blueprint/DS endpoint registration active?
4. Address/context path benar?
5. Provider visible?
6. JAXB/Jackson provider loaded?
7. Servlet/JAX-RS namespace cocok?

### 20.5 Transaction Tidak Aktif

Check:

1. TransactionControl/JTA service available?
2. Proxy configured?
3. Method dipanggil melalui proxy atau self-invocation?
4. Interface proxy tersedia?
5. Resource enlisted?
6. Exception rollback rules benar?

### 20.6 Memory Leak Setelah Bundle Update

Check:

1. Spring/CDI/Blueprint context closed?
2. Threads stopped?
3. ThreadLocal cleared?
4. Static cache cleared?
5. TCCL restored?
6. JPA provider closed?
7. CXF Bus shutdown?
8. Service trackers closed?
9. Listeners unregistered?

---

## 21. Anti-Patterns

### 21.1 “Everything Spring” di Dalam OSGi

Jika semua bundle hanya menjadi wrapper untuk satu Spring context besar, OSGi tidak memberi banyak nilai.

### 21.2 “Everything Blueprint” untuk Module Baru

Blueprint masih valid, tetapi untuk module baru yang service-oriented, DS biasanya lebih sederhana dan lebih native.

### 21.3 Exposing Framework Types in API Bundle

Buruk:

```java
public interface CaseService {
    org.springframework.context.ApplicationContext context();
}
```

atau:

```java
public interface ReportService {
    javax.persistence.EntityManager entityManager();
}
```

API OSGi sebaiknya stabil dan framework-neutral.

### 21.4 Static Service Locator

Buruk:

```java
public final class Services {
    public static BundleContext context;
}
```

Ini menyebabkan hidden dependency dan leak.

### 21.5 Ignoring Dynamic Availability

Buruk:

```java
private ExternalService service;
// assume never disappears
```

Service dynamics harus dipikirkan.

### 21.6 Mixed javax/jakarta Runtime

Ini akan menghasilkan error yang mahal didiagnosis.

### 21.7 Hot Deploy Without Lifecycle Tests

Jika memakai Spring/CDI/JPA/CXF, wajib test:

```text
install → start → use → stop → update → refresh → start → use
```

Tanpa ini, leak dan stale reference baru muncul di production.

---

## 22. Design Heuristics

### 22.1 Pilih DS Jika

- module baru;
- dynamic service registry penting;
- lifecycle harus ringan;
- config runtime penting;
- plugin topology penting;
- ingin minimal framework assumptions.

### 22.2 Pilih Blueprint Jika

- Karaf legacy;
- XML wiring sudah banyak;
- CXF/JPA/transaction integration sudah tersedia;
- migration ke DS tidak cost-effective saat ini.

### 22.3 Pilih CDI Integration Jika

- ada CDI codebase besar;
- qualifier/interceptor/decorator model penting;
- tim punya CDI standardization;
- integration implementation tersedia dan stabil untuk runtime target.

### 22.4 Pilih Spring Internal Adapter Jika

- ada Spring library besar;
- rewrite terlalu mahal;
- Spring tidak perlu menjadi global runtime;
- API boundary bisa dijaga.

### 22.5 Pilih External Process Jika

- security isolation penting;
- framework stack terlalu berat;
- lifecycle berbeda;
- failure harus isolated;
- scaling berbeda;
- OSGi hanya butuh integrate via stable network API.

---

## 23. Summary Mental Model

Enterprise integration di OSGi adalah tentang menggabungkan beberapa runtime model tanpa kehilangan invariants OSGi.

Ingat lima prinsip utama:

1. **OSGi adalah dynamic module/service runtime, bukan sekadar DI container.**
2. **DS adalah default modern untuk OSGi-native component.**
3. **Blueprint/CDI/Spring boleh dipakai sebagai integration island, bukan sebagai alasan menghapus bundle boundary.**
4. **Setiap object/resource harus punya lifecycle owner yang jelas.**
5. **Classloading, transaction, scanning, proxy, ServiceLoader, javax/jakarta, dan Java version harus diperlakukan sebagai desain, bukan troubleshooting belakangan.**

Jika part-part sebelumnya mengajarkan bagaimana OSGi bekerja, part ini mengajarkan bagaimana membawa realitas enterprise ke OSGi tanpa membuat runtime menjadi tumpukan container yang saling tidak paham.

---

## 24. Latihan dan Review Questions

### 24.1 Conceptual Questions

1. Apa perbedaan utama DS, Blueprint, CDI, dan Spring dalam konteks lifecycle OSGi?
2. Kenapa Spring application context global sering bertentangan dengan OSGi boundary?
3. Apa yang dimaksud dual lifecycle conflict?
4. Kenapa ServiceLoader sering bermasalah di OSGi?
5. Kenapa javax/jakarta mismatch lebih berbahaya di OSGi dibanding classpath biasa?

### 24.2 Design Exercise

Desain runtime OSGi untuk platform berikut:

- core service baru ditulis dari nol;
- ada legacy SOAP connector berbasis CXF;
- ada legacy Spring report generator;
- ada JPA persistence;
- rule plugin harus bisa hot deploy;
- target Java 17 sekarang, Java 25 dalam 12 bulan.

Tentukan:

- bundle layout;
- integration model per area;
- lifecycle owner;
- config model;
- test strategy;
- migration risk.

### 24.3 Failure Analysis Exercise

Sebuah CXF endpoint di Karaf terlihat aktif, tetapi request gagal dengan error provider JSON tidak ditemukan.

Analisis kemungkinan:

- namespace javax/jakarta mismatch;
- provider bundle belum installed;
- provider package tidak imported;
- ServiceLoader tidak menemukan provider;
- TCCL salah;
- endpoint runtime memakai classloader berbeda;
- feature dependency belum lengkap.

Tuliskan urutan diagnosis dari paling murah ke paling mahal.

---

## 25. Referensi

Referensi yang relevan untuk part ini:

- OSGi Compendium R8 — CDI Integration Specification.
- OSGi Compendium — Blueprint Container Specification.
- OSGi Core R8 — Service Layer, Module Layer, Lifecycle Layer.
- Apache Aries documentation — Blueprint, JPA, Transaction Control, JNDI, SPI-Fly, Remote Service Admin.
- Apache CXF documentation — OSGi/Karaf integration and Blueprint examples.
- Apache Karaf documentation — features, Blueprint, CXF deployment patterns.
- bnd/Bndtools documentation — OSGi build, manifest, resolver, DS metadata.
- Java migration guides for Java 8 → 11 → 17 → 21 → 25.

---

## 26. Status Series

Part ini adalah:

```text
Part 21 dari 35
```

Series belum selesai.

Part berikutnya:

```text
Part 22 — Extender Pattern Internals: How OSGi Frameworks Add Runtime Semantics
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 20 — Java 8 to 25 Compatibility Engineering for OSGi Systems](./20-java-8-to-25-compatibility-engineering-osgi-systems.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 22 — Extender Pattern Internals: How OSGi Frameworks Add Runtime Semantics](./22-extender-pattern-internals-runtime-semantics.md)
