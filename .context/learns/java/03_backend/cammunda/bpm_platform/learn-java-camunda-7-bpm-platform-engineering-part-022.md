# learn-java-camunda-7-bpm-platform-engineering-part-022.md

# Part 022 — Jakarta EE / Java EE Runtime Integration: Shared Engine, Container Transactions, JNDI, Classloading

> Seri: **Java Camunda 7 BPM Platform Engineering**  
> Bagian: **022 / 035**  
> Fokus: integrasi Camunda 7 dengan runtime Java EE / Jakarta EE style: shared engine, process application, JTA/container transaction, JNDI, classloading, deployment descriptor, dan operational boundary.  
> Target pembaca: engineer senior/principal yang harus menjalankan, merawat, atau memigrasikan Camunda 7 di enterprise application server / servlet container / legacy Java EE estate.

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas integrasi **Spring Boot embedded engine**. Itu model yang relatif modern: aplikasi membawa engine di dalam runtime-nya sendiri, wiring bean lewat Spring context, configuration lewat properties, deployment BPMN/DMN dari classpath, dan lifecycle engine mengikuti lifecycle aplikasi.

Bagian ini membahas dunia yang berbeda: **Camunda 7 di runtime Java EE / Jakarta EE style**, terutama pola **shared process engine** dan **process application**.

Di dunia enterprise legacy, Camunda 7 sering tidak berdiri sebagai satu Spring Boot service. Ia bisa berjalan di:

- Apache Tomcat pre-packaged distribution.
- WildFly / JBoss EAP.
- WebLogic.
- WebSphere / Liberty pada versi tertentu.
- WAR process application yang deploy ke container.
- Shared engine yang hidup lebih lama dari aplikasi proses.
- Process application yang hanya membawa BPMN, DMN, Java delegates, forms, dan listener.

Masalah utamanya bukan “bagaimana menulis JavaDelegate”. Itu sudah dibahas. Masalah utamanya adalah:

> **Siapa yang memiliki lifecycle engine, transaction, datasource, classloader, deployment, job executor, dan application code yang dipanggil oleh engine?**

Kalau pertanyaan ini tidak dijawab dengan benar, gejala production-nya biasanya seperti ini:

- BPMN berhasil deploy, tetapi delegate class tidak ditemukan.
- Job executor mengambil job dari process application yang classloader-nya sudah undeployed.
- Process lama tiba-tiba memakai Java code baru yang tidak kompatibel.
- Transaction rollback tidak seperti yang dibayangkan karena container transaction dan engine transaction berbeda.
- JNDI datasource salah atau connection pool terpisah tidak sengaja.
- Shared engine dipakai banyak WAR, tetapi security/tenant/version boundary kabur.
- Rolling deployment menyebabkan sebagian node bisa execute process version tertentu, sebagian tidak.
- Manual restart container menyelesaikan gejala, tetapi root cause tidak pernah jelas.

Bagian ini membangun mental model supaya Anda dapat membaca arsitektur Camunda 7 di runtime container secara defensible.

---

## 2. Posisi Camunda 7 dalam Runtime Container

Camunda 7 bisa dipakai dalam beberapa mode besar:

| Mode | Engine hidup di mana? | Application code hidup di mana? | Cocok untuk |
|---|---|---|---|
| Embedded engine | Di dalam aplikasi | Sama dengan aplikasi | Spring Boot / modular monolith / service-owned process |
| Shared engine | Di container/runtime terpisah dari process application | Process application WAR/JAR | App server / banyak process app berbagi engine |
| Remote engine | Engine expose REST; client remote | Di client/service lain | UI/API/client yang tidak embed engine |
| Camunda Run | Standalone distribution | External task / REST client / deployment package | Lightweight standalone ops |

Bagian ini fokus pada **shared/container integration**.

Dalam shared engine, process engine biasanya dikonfigurasi oleh runtime container. Process application kemudian deploy ke container dan mendaftarkan dirinya ke engine. Aplikasi proses bisa membawa:

- BPMN file.
- DMN file.
- CMMN file jika dipakai.
- Embedded forms.
- JavaDelegate class.
- ExecutionListener/TaskListener.
- CDI/Spring beans.
- `processes.xml` deployment descriptor.

Mental modelnya:

```text
+------------------------------------------------------------+
| Runtime Container                                          |
|                                                            |
|  +-----------------------+      +-----------------------+   |
|  | Shared Process Engine |      | Process Application A |   |
|  |                       |<---->| BPMN + Java delegates |   |
|  | Job Executor          |      | processes.xml         |   |
|  | DataSource / JTA      |      +-----------------------+   |
|  | Services              |                                  |
|  +-----------------------+      +-----------------------+   |
|                                 | Process Application B |   |
|                                 | BPMN + Java delegates |   |
|                                 | processes.xml         |   |
|                                 +-----------------------+   |
+------------------------------------------------------------+
                  |
                  v
          Camunda database schema
```

Shared engine berarti engine tidak selalu memiliki semua class delegate di classpath engine. Ia harus tahu **process application mana** yang menyediakan class/bean untuk process definition tertentu.

Inilah alasan konsep **Process Application** sangat penting.

---

## 3. Process Application: Kontrak antara Engine dan Aplikasi

Process application adalah unit deployment aplikasi proses. Ia menjadi jembatan antara:

- process engine,
- BPMN/DMN deployment,
- Java code,
- CDI/Spring context,
- classloader aplikasi,
- event listener aplikasi,
- resource application.

Dalam shared engine, process application memberi tahu engine:

> “Untuk process definition ini, kalau nanti engine butuh menjalankan delegate/listener/expression, gunakan classloader/context aplikasi saya.”

Tanpa process application awareness, shared engine akan mencoba resolve class dari classloader engine/container. Itu bisa gagal karena delegate class berada di WAR process application, bukan di module engine.

### 3.1 Embedded engine vs shared engine dari perspektif classloading

Embedded engine:

```text
Application classloader
 ├─ Camunda engine library
 ├─ BPMN resources
 ├─ JavaDelegate classes
 ├─ Spring/CDI beans
 └─ Domain/application services
```

Shared engine:

```text
Container/server classloader
 └─ Camunda shared engine

Process application A classloader
 ├─ BPMN resources
 ├─ JavaDelegate A
 └─ libraries A

Process application B classloader
 ├─ BPMN resources
 ├─ JavaDelegate B
 └─ libraries B
```

Konsekuensinya:

- Engine bisa hidup tanpa restart walau process application redeploy.
- Process application bisa membawa versi library berbeda.
- Tetapi job executor harus bisa execute job dengan classloader process application yang benar.
- Deployment cache dan process application registration menjadi critical.

---

## 4. `processes.xml`: Deployment Descriptor yang Sering Diremehkan

Di dunia container integration, `processes.xml` adalah metadata penting. Ia biasanya diletakkan di:

```text
META-INF/processes.xml
```

atau pada struktur WAR yang sesuai.

File ini mendeskripsikan process archive: resources apa yang di-deploy, engine mana yang dipakai, scan behavior, tenant, deployment behavior, dan properties lain.

Contoh konseptual:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<process-application
    xmlns="http://www.camunda.org/schema/1.0/ProcessApplication"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <process-archive name="case-management-processes">
    <process-engine>default</process-engine>

    <properties>
      <property name="isDeleteUponUndeploy">false</property>
      <property name="isScanForProcessDefinitions">true</property>
    </properties>
  </process-archive>

</process-application>
```

Nilai-nilai ini bukan kosmetik. Mereka memengaruhi:

- apakah BPMN/DMN di-deploy otomatis,
- engine mana yang menerima deployment,
- apa yang terjadi saat undeploy,
- apakah process definition dihapus saat aplikasi dilepas,
- apakah deployment duplicate difilter,
- bagaimana process application dihubungkan dengan process definition.

### 4.1 Kenapa `isDeleteUponUndeploy` berbahaya bila tidak dipahami

Kalau process archive dihapus saat undeploy, Anda harus memahami efeknya terhadap:

- repository deployment,
- running process instances,
- process definition availability,
- job executor,
- historic data,
- migration/restart operation.

Untuk enterprise long-running workflow, default policy harus konservatif. Jangan menghapus deployment hanya karena WAR redeploy kecuali Anda benar-benar paham konsekuensinya.

Production stance:

```text
Deployment artifact adalah executable audit artifact.
Jangan diperlakukan seperti temporary cache.
```

---

## 5. Shared Process Engine Lifecycle

Dalam embedded mode, engine start/stop mengikuti aplikasi. Dalam shared engine, lifecycle engine mengikuti container.

Artinya:

- Container start → shared engine start.
- Process applications deploy → register ke engine.
- Process applications undeploy → unregister dari engine.
- Engine bisa tetap hidup saat process application redeploy.
- Job executor bisa tetap berjalan selama engine hidup.

Ini memberi fleksibilitas, tetapi membuka failure mode khusus.

### 5.1 Failure mode: job executor hidup, process application hilang

Bayangkan:

1. Process application A deploy process `enforcement-review`.
2. Ada async job pada service task `notifyApplicant`.
3. WAR A undeploy/redeploy.
4. Job executor mencoba execute job saat classloader A belum registered.
5. Delegate expression/class tidak bisa resolve.
6. Job gagal, retry berkurang, incident bisa muncul.

Ini bukan bug BPMN. Ini lifecycle mismatch.

Solusi desain:

- Gunakan deployment-aware job executor pada heterogeneous cluster.
- Pastikan process application registration sehat sebelum job execution.
- Hindari deployment yang meninggalkan running jobs tanpa executable code.
- Gunakan external task untuk integrasi remote/slow/independent jika classloader coupling terlalu mahal.
- Jangan rolling deploy semua node bersamaan tanpa mempertimbangkan job execution.

---

## 6. Container Transaction dan JTA

Di Java EE/Jakarta EE runtime, transaksi sering dimiliki oleh container melalui **JTA**. Camunda engine dapat diintegrasikan dengan transaction manager container.

Mental model penting:

```text
HTTP request / EJB invocation / CDI bean call
        |
        v
Container-managed transaction begins
        |
        v
Application code calls Camunda API
        |
        v
Camunda command executes within transaction context
        |
        v
Engine flushes DB statements
        |
        v
Container commits or rolls back transaction
```

Kalau Camunda engine dan domain application menggunakan datasource/transaction manager yang sama, satu transaction bisa mencakup:

- update domain table,
- start/complete process,
- create task/job/event subscription,
- write variables/history.

Tetapi ini bukan berarti semua side-effect ikut transactional. HTTP call, email, message publish, file write, dan external system mutation tetap tidak otomatis rollback.

### 6.1 Local transaction vs JTA transaction

| Aspek | Local transaction | JTA/container transaction |
|---|---|---|
| Dikelola oleh | Engine/framework langsung | Container transaction manager |
| Cocok untuk | Standalone/embedded simple app | App server, multi-resource transaction |
| DataSource | Biasanya direct JDBC/pool | JNDI datasource / managed datasource |
| Boundary | API call / framework transaction | Container-managed method/request boundary |
| Risiko | Salah konfigurasi autocommit/pool | Salah propagation, enlisted resource, timeout |

### 6.2 Transaction propagation trap

Masalah umum:

```java
@Stateless
public class CaseService {

  @Inject
  RuntimeService runtimeService;

  public void submitCase(SubmitCaseCommand command) {
    caseRepository.insert(command);        // domain DB write
    runtimeService.startProcessInstanceByKey("case-review", command.caseId());
  }
}
```

Secara ideal, dua operasi ini satu transaksi. Tetapi validitasnya tergantung konfigurasi:

- Apakah `caseRepository` dan Camunda memakai datasource yang sama?
- Apakah Camunda command ikut JTA transaction yang sama?
- Apakah ada `REQUIRES_NEW` tersembunyi?
- Apakah transaction timeout cukup?
- Apakah engine job executor menggunakan managed transaction?

Kalau tidak dipastikan, Anda bisa mendapat state seperti:

- domain case tersimpan, process tidak start,
- process start, domain case rollback,
- variable/history flush terpisah,
- lock/rollback tidak sesuai ekspektasi.

### 6.3 Rule senior

> Jangan pernah mengasumsikan atomicity lintas Camunda dan domain DB hanya karena mereka berada di server yang sama.

Buktikan dengan integration test berbasis container/DB asli.

---

## 7. JNDI dan Managed DataSource

Dalam app server, datasource biasanya dikonfigurasi di container dan diakses melalui JNDI.

Contoh konseptual nama JNDI:

```text
java:/jdbc/CamundaDS
java:jboss/datasources/CamundaDS
jdbc/CamundaDS
```

Camunda engine configuration kemudian menunjuk ke datasource tersebut.

Kenapa JNDI penting?

- Connection pool dikelola container.
- Credential tidak dibundel di WAR.
- Transaction enlistment bisa dikelola container.
- Monitoring pool berada di app server.
- Resource config bisa berbeda per environment tanpa rebuild artifact.

### 7.1 Anti-pattern: datasource ganda tanpa disadari

Salah satu failure yang mahal:

```text
Domain app memakai DataSource A.
Camunda engine memakai DataSource B.
Keduanya menuju database yang sama, tapi pool/transaction manager berbeda.
```

Gejalanya:

- Transaction tidak atomic.
- Locking aneh.
- Connection pool sizing salah.
- Observability membingungkan.
- DBA melihat session berbeda tanpa konteks aplikasi.

Production checklist:

- Nama JNDI eksplisit.
- Datasource Camunda dan domain disengaja: sama atau beda, bukan kebetulan.
- Transaction manager jelas.
- Pool size dihitung bersama job executor dan request traffic.
- Validation query/connection test sesuai DB vendor.
- Isolation level sesuai rekomendasi engine.
- Autocommit tidak merusak engine transaction semantics.

---

## 8. Classloading: Sumber Banyak Bug Enterprise

Classloading di Java EE/Jakarta EE bukan detail rendah. Untuk Camunda 7 shared engine, ini bagian utama dari architecture.

### 8.1 Tiga classloader yang perlu dipikirkan

```text
1. Container / server classloader
   - app server libraries
   - Camunda engine modules
   - JDBC driver jika dipasang server-wide

2. Shared engine classloader
   - engine runtime
   - engine plugins
   - webapps/admin/cockpit/tasklist

3. Process application classloader
   - application delegates
   - application services
   - app-specific libraries
   - BPMN/DMN resources
```

Jika delegate class berada di process application, engine harus resolve delegate lewat process application context.

### 8.2 `camunda:class` dalam shared engine

```xml
<serviceTask id="ValidateCase"
             camunda:class="com.example.workflow.ValidateCaseDelegate" />
```

Di embedded engine, ini biasanya aman karena class ada di classpath aplikasi.

Di shared engine, ini hanya aman jika:

- process definition terhubung ke process application yang benar,
- classloader aplikasi tersedia,
- process application sedang registered,
- class tidak dipindahkan/dihapus pada deployment baru yang masih dibutuhkan instance lama.

### 8.3 Delegate expression dalam CDI

```xml
<serviceTask id="ValidateCase"
             camunda:delegateExpression="${validateCaseDelegate}" />
```

Expression ini akan resolve bean dari context yang sesuai jika integrasi CDI/process application berjalan benar.

Kelebihan:

- Mendukung dependency injection.
- Lebih mudah mock/test.
- Class tidak hardcoded sekuat `camunda:class`.

Risiko:

- Bean name berubah → runtime failure.
- Scope bean salah → concurrency bug.
- Bean resolution ambigu.
- Long-running process instance memakai bean behavior terbaru.

---

## 9. CDI Integration: Contextual Programming Model

Camunda 7 menyediakan integrasi CDI/Java EE style sehingga process execution dapat berinteraksi dengan CDI bean dan event.

Fungsi utamanya:

- resolve CDI beans dari expression,
- inject engine services ke bean,
- expose process variables/context melalui programming model tertentu,
- bridge event engine ke CDI event,
- integrasi dengan JTA.

Contoh konseptual delegate CDI:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class ValidateCaseDelegate implements JavaDelegate {

  @Inject
  CasePolicyService policyService;

  @Override
  public void execute(DelegateExecution execution) throws Exception {
    String caseId = (String) execution.getVariable("caseId");
    ValidationResult result = policyService.validate(caseId);
    execution.setVariable("caseValid", result.valid());
  }
}
```

Catatan compatibility:

- Camunda 7 historisnya lahir di era **Java EE / `javax.*`**.
- Jakarta EE modern memakai **`jakarta.*`** namespace.
- Tidak semua kombinasi Camunda 7 minor version, container, CDI, Spring, dan Java version cocok.
- Jangan mengasumsikan kode `jakarta.*` bisa langsung jalan di stack Camunda 7 lama yang masih berbasis `javax.*`.

Untuk seri ini, pembahasan Java 8–25 dilakukan sebagai compatibility reasoning. Bukan berarti semua kombinasi valid.

---

## 10. Java EE vs Jakarta EE: Namespace dan Reality Check

Perubahan besar dari Java EE ke Jakarta EE adalah perpindahan namespace dari:

```java
javax.servlet.*
javax.enterprise.*
javax.transaction.*
javax.ejb.*
```

menjadi:

```java
jakarta.servlet.*
jakarta.enterprise.*
jakarta.transaction.*
jakarta.ejb.*
```

Di aplikasi enterprise biasa, ini sudah cukup rumit. Di Camunda 7, rumitnya bertambah karena:

- engine punya supported environment matrix sendiri,
- webapps Camunda punya servlet/container dependency,
- Spring Boot 3 memakai Jakarta namespace,
- Spring Boot 2 memakai Javax era,
- application server punya versi berbeda,
- delegate/application code bisa memakai library yang namespace-nya berbeda.

Senior-level stance:

> Jangan menyebut “upgrade ke Java 21/25” tanpa menyebut container, Camunda minor version, Spring/Java EE stack, servlet namespace, JDBC driver, dan plugin compatibility.

Contoh keputusan salah:

```text
“Kita upgrade JVM ke 21 saja.”
```

Pertanyaan yang harus menyusul:

- Camunda 7 minor version mana?
- Distribution apa: Tomcat/WildFly/WebLogic/Spring Boot/Camunda Run?
- App masih `javax.*` atau sudah `jakarta.*`?
- JDBC driver support JVM target?
- App server support Java 21?
- Camunda webapps support container itu?
- Engine plugins compile untuk bytecode berapa?
- Delegate libraries kompatibel?
- Build pipeline menghasilkan class file version berapa?

---

## 11. Shared Engine dan Multiple Process Applications

Shared engine sering dipilih karena satu container dapat melayani banyak process application.

Contoh:

```text
Shared Camunda Engine
 ├─ licensing-process.war
 ├─ enforcement-process.war
 ├─ appeal-process.war
 ├─ inspection-process.war
 └─ notification-process.war
```

Kelebihan:

- Engine centralized.
- Webapps/admin/cockpit satu tempat.
- Database schema satu.
- Operational team punya satu platform.
- Process application bisa deploy terpisah.

Kekurangan:

- Blast radius engine besar.
- Database menjadi shared bottleneck.
- Version compatibility antar process app lebih sulit.
- Tenant/security boundary harus disiplin.
- Classloading dan dependency conflict lebih kompleks.
- Job executor perlu tahu deployment/class availability.
- Upgrade engine memengaruhi semua process app.

### 11.1 Decision matrix

| Pertanyaan | Jika jawabannya “ya” | Implikasi |
|---|---|---|
| Banyak process app harus berbagi Cockpit/Admin? | Shared engine menarik | Governance kuat diperlukan |
| Process app punya release cadence berbeda? | Shared engine bisa membantu | Classloading/versioning harus ketat |
| Tiap domain butuh isolation kuat? | Shared engine mungkin kurang | Pertimbangkan engine/schema terpisah |
| Workload job sangat tinggi? | Shared engine bisa bottleneck | Partitioning/worker topology perlu |
| Tim ops ingin satu runtime? | Shared engine cocok | Upgrade menjadi platform-level event |
| Compliance butuh data isolation kuat? | Hati-hati | Tenant ID saja mungkin tidak cukup |

---

## 12. Job Execution with Managed Resources

Dalam runtime container, thread management sebaiknya mematuhi aturan container. App server umumnya tidak suka aplikasi membuat thread bebas tanpa kontrol container.

Camunda job executor pada integrasi container dapat menggunakan managed resources sesuai distribution/container.

Mengapa penting?

- Thread pool perlu observable oleh container.
- Transaction context harus benar.
- Naming/monitoring thread lebih jelas.
- Resource shutdown mengikuti lifecycle server.
- Security context dan classloader handling lebih terkendali.

Failure mode kalau salah:

- Thread leak saat redeploy.
- Job executor masih memegang old classloader.
- Transaction tidak enlisted dengan benar.
- Container shutdown lambat/hang.
- Memory leak karena worker thread menahan reference ke WAR lama.

Production rule:

```text
Di app server, thread/job executor bukan hanya tuning performa.
Ia bagian dari lifecycle dan classloader hygiene.
```

---

## 13. Packaging Model: WAR, EAR, Module, Library

### 13.1 WAR process application

Pola umum:

```text
case-process.war
 ├─ WEB-INF/classes/
 │   ├─ META-INF/processes.xml
 │   ├─ processes/case-review.bpmn
 │   ├─ decisions/case-risk.dmn
 │   └─ com/example/workflow/*.class
 ├─ WEB-INF/lib/
 │   └─ app-specific libs
 └─ forms/
```

Cocok untuk:

- process application web/module,
- CDI/Spring context lokal,
- process-specific dependencies.

### 13.2 EAR enterprise application

Pola lama:

```text
case-platform.ear
 ├─ case-process.war
 ├─ case-services.jar
 ├─ case-domain.jar
 └─ lib/shared-libs.jar
```

Kelebihan:

- Modul enterprise satu release.
- EJB/CDI/JPA integration kuat.
- Resource sharing lebih mudah.

Kekurangan:

- Classloader hierarchy lebih kompleks.
- Redeploy lebih berat.
- Dependency conflict lebih sulit.
- Modern cloud/container deployment kurang ergonomis.

### 13.3 Server module

Di WildFly/JBoss style, library tertentu bisa dipasang sebagai server module.

Gunakan untuk:

- JDBC driver,
- engine modules,
- truly shared infrastructure library.

Jangan sembarang taruh business delegate library ke server module karena:

- mengaburkan ownership,
- menyulitkan versioning,
- membuat semua app tergantung library yang sama,
- memperbesar risiko incompatible deployment.

---

## 14. Deployment Awareness dan Heterogeneous Cluster

Cluster shared engine bisa homogeneous atau heterogeneous.

Homogeneous:

```text
Node 1: process app A, B, C
Node 2: process app A, B, C
Node 3: process app A, B, C
```

Heterogeneous:

```text
Node 1: process app A
Node 2: process app B
Node 3: process app C
```

Dalam heterogeneous cluster, job executor tanpa awareness bisa mengambil job dari deployment yang class/code-nya tidak tersedia di node tersebut.

Gejala:

- `ClassNotFoundException`.
- Cannot resolve delegate expression.
- Incident hanya terjadi di node tertentu.
- Retry sukses jika kebetulan diambil node lain.

Mitigasi:

- Aktifkan deployment-aware job executor jika sesuai topology.
- Gunakan homogeneous deployment untuk process app yang punya async job internal.
- Pindahkan remote work ke external task bila worker bisa independent.
- Jangan biarkan job executor semua node mengambil semua deployment tanpa desain.
- Pastikan rolling deployment tidak menciptakan window tanpa executable class.

---

## 15. Process Application Event Listener

Process application dapat menerima event dari process engine. Ini berguna untuk:

- audit enrichment,
- technical logging,
- platform policy,
- monitoring hook,
- integration bridge.

Tetapi listener juga bisa menjadi sumber hidden business logic.

Rule:

```text
Listener boleh memperkaya lifecycle.
Listener tidak boleh menyembunyikan business transition utama.
```

Contoh buruk:

```text
User task complete listener diam-diam approve license,
update billing,
kirim email,
dan trigger external system.
```

Masalah:

- BPMN tidak menunjukkan side effect.
- Retry/rollback behavior tidak jelas.
- Testing sulit.
- Audit trail sulit dijelaskan.
- Migration berisiko.

Contoh sehat:

- set correlation id,
- emit technical event to monitoring,
- normalize audit metadata,
- validate modelling convention,
- record process application lifecycle event.

---

## 16. Remote Engine vs Shared Engine

Shared engine bukan satu-satunya pola non-embedded. Ada juga remote engine via REST.

| Aspek | Shared engine | Remote engine |
|---|---|---|
| Java delegate local | Ya, via process app | Tidak langsung |
| Client coupling | Classloader/process app | HTTP API contract |
| Transaction local dengan app | Bisa | Tidak lintas HTTP |
| Operational boundary | Container/shared DB | Service/API boundary |
| Scaling | App server cluster | Engine service + clients |
| Security | Internal container + webapps | API authz/API gateway penting |
| Good fit | Legacy Java EE process apps | UI/client/service remote |

Remote engine cocok jika:

- aplikasi tidak ingin membawa engine libraries,
- frontend/backend hanya butuh start/query/complete task via API,
- integration dilakukan lewat external task/message,
- Camunda dikelola sebagai platform service.

Shared engine cocok jika:

- Anda perlu JavaDelegate/CDI/EJB dekat dengan process app,
- process app deploy ke container yang sama,
- lifecycle process app dikelola sebagai WAR/EAR,
- enterprise estate masih app-server centric.

---

## 17. Domain Service Boundary di Java EE Runtime

Dalam Java EE style, temptation-nya adalah memasukkan semua domain service ke delegate dan membiarkan BPMN memanggil EJB/CDI bean langsung.

Contoh:

```xml
<serviceTask id="Approve" camunda:delegateExpression="${approveLicenseDelegate}" />
```

```java
@ApplicationScoped
public class ApproveLicenseDelegate implements JavaDelegate {
  @Inject
  LicenseApprovalService approvalService;

  public void execute(DelegateExecution execution) {
    approvalService.approve((String) execution.getVariable("caseId"));
  }
}
```

Ini bisa sehat jika delegate adalah adapter tipis.

Batas yang disarankan:

```text
BPMN/Delegate layer
  - read variables
  - map to command
  - call application service
  - map result to variables/event
  - throw BpmnError or technical exception intentionally

Application service layer
  - validate business invariant
  - enforce authorization if needed
  - mutate domain state
  - write domain audit
  - emit outbox command/event

Domain layer
  - business rules
  - state transitions
  - invariants
```

Jangan biarkan domain service bergantung pada `DelegateExecution`.

Buruk:

```java
public class LicenseApprovalService {
  public void approve(DelegateExecution execution) { ... }
}
```

Baik:

```java
public class LicenseApprovalService {
  public ApprovalResult approve(ApproveLicenseCommand command) { ... }
}
```

---

## 18. Container-Managed Persistence dan Camunda

Java EE apps sering memakai JPA dengan container-managed persistence context.

Pertanyaan yang wajib dijawab:

- Apakah JPA domain DB sama dengan Camunda DB?
- Apakah transaction sama?
- Apakah entity manager flush terjadi sebelum/bersamaan/setelah Camunda command?
- Apakah optimistic locking domain dan Camunda bisa konflik?
- Apakah lazy loading terjadi di delegate setelah transaction boundary?

### 18.1 Hidden flush problem

```java
@Transactional
public void completeReview(String taskId, ReviewCommand command) {
  Review review = reviewRepository.find(command.reviewId());
  review.approve();

  taskService.complete(taskId, Map.of("decision", "APPROVED"));
}
```

Saat `taskService.complete()` dipanggil, Camunda bisa melanjutkan process dan memanggil delegate downstream dalam transaction yang sama. Jika delegate downstream membaca domain DB, apakah ia melihat perubahan `review.approve()`?

Tergantung:

- persistence context flush mode,
- transaction manager,
- datasource sama atau tidak,
- order flush JPA vs Camunda,
- query yang menyebabkan auto-flush.

Desain aman:

- Pisahkan domain mutation dan process progression dengan boundary yang jelas.
- Gunakan outbox atau application service orchestration.
- Jangan mengandalkan side effect flush implisit.
- Buat integration test untuk skenario exact.

---

## 19. Servlet Container vs Full Java EE Container

Apache Tomcat bukan full Java EE/Jakarta EE container. Ia servlet container. WildFly/JBoss/WebLogic lebih lengkap untuk JTA/CDI/EJB/JNDI server resource.

| Capability | Tomcat | WildFly/JBoss/WebLogic style |
|---|---|---|
| Servlet | Ya | Ya |
| JNDI datasource | Ya, terbatas/container-specific | Ya, lebih native |
| JTA full | Tidak native seperti full EE | Ya |
| CDI | Perlu tambahan | Native/managed |
| EJB | Tidak | Ya |
| Server modules | Terbatas | Kuat |
| Managed executor | Terbatas | Native |

Implikasinya:

- Jangan menyebut semua “Java EE deployment” sama.
- Tomcat shared engine berbeda operational behavior dari WildFly subsystem.
- Transaction dan thread management tergantung container.
- Support matrix Camunda harus dicek per versi.

---

## 20. Security Surface di Shared Runtime

Shared container berarti banyak surface:

- Camunda REST API.
- Camunda webapps: Admin, Cockpit, Tasklist.
- Process application web endpoints.
- JNDI resources.
- Container admin console.
- Deployment mechanism.
- Engine plugins.
- BPMN/DMN model files.
- Embedded forms.

Security principle:

```text
Camunda shared engine adalah privileged runtime.
Process deployment adalah executable change.
REST/admin access adalah operational control plane.
```

Hardening checklist:

- Aktifkan authentication untuk REST/webapps.
- Batasi admin users.
- Jangan expose engine REST langsung ke public internet.
- Gunakan reverse proxy/API gateway bila remote access dibutuhkan.
- Pisahkan operator role dan business user role.
- Audit deployment operation.
- Review BPMN/DMN sebagai code.
- Batasi variable sensitive data.
- Batasi classpath/plugin access.
- Jangan simpan credential di BPMN field injection.
- Gunakan managed secrets/JNDI/resource injection.

---

## 21. Operational Playbook: Redeploy Process Application

Redeploy process application bukan sekadar upload WAR baru.

Checklist:

1. Identifikasi process definitions yang dibawa WAR.
2. Identifikasi running instances per definition version.
3. Identifikasi active jobs/external tasks/timers/event subscriptions.
4. Pastikan Java delegates/listeners lama masih compatible untuk instance lama.
5. Cek apakah BPMN ID berubah.
6. Cek migration plan jika diperlukan.
7. Deploy ke staging dengan DB snapshot/synthetic process instances.
8. Test job executor setelah redeploy.
9. Test timer firing setelah redeploy.
10. Test message correlation setelah redeploy.
11. Test Cockpit visibility.
12. Test classloader cleanup / no memory leak if possible.
13. Monitor failed jobs/incidents setelah deploy.
14. Jangan clean old deployment sembarangan.

### 21.1 Rolling deployment pattern

Untuk cluster:

```text
Node 1 drain / stop job acquisition
Deploy process app
Health check
Enable job acquisition
Move to Node 2
...
```

Jika tidak bisa drain job executor, minimal:

- kurangi acquisition sementara,
- pastikan deployment-aware behavior,
- monitor lock/retry/incident,
- pastikan semua node akhirnya punya compatible deployment.

---

## 22. Testing Container Integration

Unit test delegate saja tidak cukup.

Anda perlu test level:

### 22.1 Delegate unit test

- Test mapping variables ke command.
- Test business exception taxonomy.
- Test BpmnError vs technical exception.

### 22.2 Engine integration test

- Deploy BPMN/DMN.
- Start process.
- Complete tasks.
- Execute async jobs.
- Verify runtime/history.

### 22.3 Container integration test

- Deploy WAR/EAR ke container test.
- Verify process application registration.
- Verify CDI/EJB injection.
- Verify JNDI datasource.
- Verify JTA rollback.
- Verify job executor managed execution.
- Verify classloading after redeploy.

### 22.4 Upgrade/redeploy test

- Start instance on old version.
- Deploy new WAR/BPMN.
- Continue old instance.
- Start new instance.
- Execute async job from both versions.
- Verify no class resolution failure.

This is where many teams fail: they test only new process version, not old running instances.

---

## 23. Troubleshooting Guide

### 23.1 Delegate class not found

Possible causes:

- Class not packaged in process application.
- Process definition not linked to process application.
- Job executed on node without process app.
- Old deployment references removed class.
- Classloader leak/stale deployment.

Diagnostics:

- Check process definition deployment id.
- Check process application registration.
- Check node where job failed.
- Check WAR contents.
- Check `processes.xml`.
- Check deployment-aware job executor config.

### 23.2 CDI bean not resolved

Possible causes:

- Bean name changed.
- CDI not enabled / `beans.xml` issue.
- Wrong scope.
- Ambiguous bean.
- Expression evaluated outside process application context.

Diagnostics:

- Verify CDI container startup logs.
- Verify bean discovery mode.
- Test expression in same deployment.
- Check process application classloader.

### 23.3 Transaction rollback unexpected

Possible causes:

- Different datasource/transaction manager.
- `REQUIRES_NEW` or wrong propagation.
- Container timeout.
- Exception swallowed by delegate.
- Side effect outside transaction.

Diagnostics:

- Log transaction id/context if possible.
- Force test exception after domain write and after Camunda call.
- Check DB state after rollback.
- Check app server transaction logs.

### 23.4 Job fails only on one node

Possible causes:

- Heterogeneous deployment.
- Different WAR version.
- Different classpath/module config.
- Node-specific JNDI datasource issue.
- Clock/timezone/config drift.

Diagnostics:

- Compare deployment list per node.
- Compare class/module versions.
- Compare JVM/container versions.
- Check lock owner in `ACT_RU_JOB`.
- Check logs by lock owner/node id.

---

## 24. Architecture Decision Records yang Harus Dibuat

Untuk enterprise Camunda 7 shared/container deployment, buat ADR minimal:

1. Engine topology: embedded/shared/remote.
2. Runtime container/version.
3. Camunda 7 minor version.
4. Java version.
5. `javax`/`jakarta` namespace stance.
6. Datasource ownership and JNDI names.
7. Transaction manager / JTA policy.
8. Process application packaging model.
9. Deployment/versioning policy.
10. Job executor topology and deployment awareness.
11. Classloading/dependency isolation policy.
12. Delegate binding policy.
13. REST/webapps exposure policy.
14. Tenant/security boundary.
15. Migration/upgrade strategy.
16. Old instance compatibility policy.
17. Incident/retry ownership.
18. History/audit/retention policy.

Without these ADRs, the platform becomes tribal knowledge.

---

## 25. Recommended Design Principles

### Principle 1: Treat process application as executable module

BPMN + Java delegates + DMN + forms + listeners are one executable contract.

### Principle 2: Keep delegate adapter thin

Delegate maps process state to application command. Domain logic stays outside Camunda APIs.

### Principle 3: Avoid hidden classloader coupling

If process can run for months/years, do not casually remove/rename delegate classes or bean names.

### Principle 4: Be explicit about transaction boundary

Container-managed transaction is powerful, but only if configuration is verified.

### Principle 5: Prefer external task for independently scalable remote work

If work is remote, slow, polyglot, or operationally independent, external task often reduces container/classloader coupling.

### Principle 6: Use shared engine only with platform governance

Shared engine is a platform, not just a library.

### Principle 7: Never expose operational control plane casually

Camunda REST, Admin, Cockpit, and deployment APIs are powerful and must be protected.

---

## 26. Example: Regulatory Case Platform on Shared Engine

Imagine a regulatory platform with modules:

- licensing,
- inspection,
- enforcement,
- appeal,
- correspondence,
- revenue,
- legal review.

A shared engine deployment may look like:

```text
Camunda Shared Engine Cluster
 ├─ licensing-process.war
 ├─ enforcement-process.war
 ├─ inspection-process.war
 ├─ appeal-process.war
 └─ common-workflow-policy.jar/module
```

Design concerns:

- Each module has different release cadence.
- Enforcement cases can run for months.
- Appeal process may call enforcement process via call activity/message.
- Operators use Cockpit for incidents.
- Business users use custom UI, not raw Tasklist.
- REST API hidden behind internal network.
- Deployment reviewed as regulated executable change.
- Domain audit table stores legal decision trace.
- Camunda history stores technical execution trace.

Recommended stance:

- Use shared engine only if platform team controls governance.
- Use process application per bounded workflow domain.
- Use custom application API for users.
- Keep Camunda admin tools for operators only.
- Use external task for integration with external agency/system.
- Use message/outbox for cross-service integration.
- Keep long-running compatibility checklist per release.

---

## 27. Summary Mental Model

Camunda 7 in Java EE/Jakarta EE runtime is not just “Camunda inside an app server”. It is a multi-layer runtime composed of:

```text
Container lifecycle
  -> shared process engine lifecycle
    -> process application registration
      -> classloader/context resolution
        -> command execution
          -> JTA/local transaction
            -> DB flush/commit
              -> job executor continuation
```

The core senior insight:

> In shared/container mode, correctness depends as much on runtime boundaries as on BPMN modelling.

You must understand:

- who owns the engine,
- who owns the transaction,
- who owns the datasource,
- who owns the classloader,
- who owns deployment,
- who owns job execution,
- who owns retry and recovery,
- who owns old process instances.

If those boundaries are implicit, the system will work in DEV and fail in production during redeploy, cluster scaling, async job execution, version migration, or security audit.

---

## 28. Practical Checklist

Before approving Camunda 7 Java EE/shared engine architecture, verify:

- [ ] Engine mode is explicitly chosen: embedded/shared/remote.
- [ ] Runtime container and Camunda version are supported together.
- [ ] Java version compatibility is verified.
- [ ] `javax` vs `jakarta` namespace stance is known.
- [ ] Process application packaging is documented.
- [ ] `processes.xml` behavior is understood.
- [ ] Datasource and JNDI names are explicit.
- [ ] Transaction manager/JTA behavior is tested.
- [ ] Job executor topology is defined.
- [ ] Deployment-aware behavior is configured if cluster is heterogeneous.
- [ ] Delegate classloading is tested after redeploy.
- [ ] Old process instances can continue after new deployment.
- [ ] Camunda REST/webapps are secured.
- [ ] Process deployment is governed as executable change.
- [ ] Domain authorization is not delegated blindly to Camunda task assignment.
- [ ] Audit/history/retention policy is explicit.
- [ ] Operational runbook exists for incident, failed job, and redeploy.

---

## 29. References

- Camunda 7.24 Manual — Runtime Container Integration: https://docs.camunda.org/manual/7.24/user-guide/runtime-container-integration/
- Camunda 7.24 Manual — Process Applications: https://docs.camunda.org/manual/7.24/user-guide/process-applications/
- Camunda 7.24 Manual — CDI and Java EE Integration: https://docs.camunda.org/manual/7.24/user-guide/cdi-java-ee-integration/
- Camunda 7.24 Manual — JTA Transaction Integration: https://docs.camunda.org/manual/7.24/user-guide/cdi-java-ee-integration/jta-transaction-integration/
- Camunda 7.24 Manual — Transactions in Processes: https://docs.camunda.org/manual/7.24/user-guide/process-engine/transactions-in-processes/
- Camunda 7.24 Manual — Job Executor: https://docs.camunda.org/manual/7.24/user-guide/process-engine/the-job-executor/
- Camunda 7.24 Manual — Deployment Descriptors: https://docs.camunda.org/manual/7.24/reference/deployment-descriptors/
- Camunda 7.24 Manual — Supported Environments: https://docs.camunda.org/manual/7.24/introduction/supported-environments/

---

## 30. Status Seri

- Part ini: **selesai**.
- Seri: **belum selesai**.
- Lanjut ke: `learn-java-camunda-7-bpm-platform-engineering-part-023.md` — **REST API, Client Architecture, OpenAPI, Remote Engine, dan API Governance**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-021.md">⬅️ Part 021 — Spring Boot Integration Advanced: Embedded Engine, Transactions, Beans, Profiles, Testing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-023.md">Part 023 — REST API, Client Architecture, OpenAPI, Remote Engine, dan API Governance ➡️</a>
</div>
