# Part 024 — Naming, JNDI, Environment Entries, and Externalized Resources

Series: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-024.md`  
Status: Part 024 of 035  
Target Java: 8 hingga 25  
Target Enterprise Runtime: Java EE `javax.*`, Jakarta EE `jakarta.*`, CDI/EJB/Web container, modern cloud/container runtime

---

## 0. Tujuan Bagian Ini

Bagian sebelumnya membahas **Jakarta Common Annotations dan Resource Injection**: `@Resource`, lifecycle annotation, security annotation, dan bagaimana container dapat menyuntik resource seperti `DataSource`, JMS connection factory, executor, mail session, atau environment entry.

Bagian ini masuk satu lapisan lebih dalam: **naming model**.

Kita akan membahas:

1. Mengapa enterprise runtime punya naming system.
2. Apa itu JNDI secara mental model.
3. Apa arti `java:comp/env`, `java:module`, `java:app`, dan `java:global`.
4. Apa bedanya physical resource dan logical resource reference.
5. Apa itu environment entry.
6. Bagaimana deployment descriptor dan annotation berinteraksi.
7. Bagaimana JNDI digunakan di Java EE/Jakarta EE klasik.
8. Bagaimana pendekatan ini berubah di runtime modern seperti MicroProfile, Quarkus, Spring Boot, Kubernetes, dan cloud-native deployment.
9. Bagaimana menghubungkan JNDI resource ke CDI producer agar business code tidak bergantung pada lookup string.
10. Bagaimana mendiagnosis error seperti `NameNotFoundException`, wrong namespace, resource not bound, dan mismatch server configuration.

Fokus utama bukan menghafal nama JNDI, tetapi memahami **resource indirection**:

> aplikasi sebaiknya bergantung pada logical name dan contract, bukan pada physical resource location.

Itulah ide yang membuat aplikasi enterprise bisa dipindah dari DEV ke UAT ke PROD tanpa compile ulang.

---

## 1. Masalah yang Diselesaikan oleh Naming System

Bayangkan service Java sederhana:

```java
public class CaseRepository {
    private final Connection connection;

    public CaseRepository() throws SQLException {
        this.connection = DriverManager.getConnection(
            "jdbc:oracle:thin:@prod-db-host:1521/PROD",
            "aceas_user",
            "secret"
        );
    }
}
```

Kode ini terlihat langsung dan mudah. Tetapi untuk enterprise system, ini desain yang buruk.

Masalahnya:

1. **Physical location hardcoded**  
   Host, port, service name, username, dan password masuk ke source code.

2. **Environment tidak bisa dipisahkan**  
   DEV, UAT, PROD butuh value berbeda. Kalau value masuk source code, deployment menjadi berbahaya.

3. **Resource ownership salah**  
   Aplikasi membuka koneksi sendiri. Container tidak bisa mengatur pooling, transaction enlistment, timeout, monitoring, dan cleanup dengan baik.

4. **Security buruk**  
   Secret bisa bocor lewat Git, log, artifact, atau decompile.

5. **Operasional sulit**  
   DBA/infra ingin mengganti endpoint database, pool size, credential rotation, atau driver config tanpa mengubah source code.

6. **Testing sulit**  
   Test tidak mudah mengganti DB resource tanpa mengubah kode.

Enterprise runtime menyelesaikan ini dengan membedakan dua hal:

```text
application code needs a logical resource
runtime environment binds that logical resource to a physical resource
```

Contoh:

```text
Application logical name:
  java:comp/env/jdbc/CaseManagementDS

Server physical resource:
  Oracle RDS DEV/UAT/PROD datasource
  host, port, service name, username, password, driver, pool size
```

Kode aplikasi cukup tahu logical name. Server/runtime tahu physical resource.

---

## 2. Mental Model: Naming Service sebagai Directory Runtime

JNDI adalah singkatan dari **Java Naming and Directory Interface**.

Secara mental, JNDI adalah seperti directory/map runtime:

```text
name  ->  object/resource/reference
```

Contoh:

```text
java:comp/env/jdbc/CaseManagementDS  ->  DataSource
java:comp/env/mail/NotificationMail  ->  Mail Session
java:comp/env/concurrency/AppExecutor -> ManagedExecutorService
java:global/my-app/my-ejb/CaseService -> EJB reference
```

JNDI bukan database konfigurasi biasa. Ia adalah abstraction untuk lookup named object dalam environment runtime.

Sederhananya:

```java
Context ctx = new InitialContext();
DataSource ds = (DataSource) ctx.lookup("java:comp/env/jdbc/CaseManagementDS");
```

Tetapi modern Jakarta code biasanya tidak melakukan direct lookup di semua tempat. Lebih umum:

```java
@Resource(lookup = "java:comp/env/jdbc/CaseManagementDS")
private DataSource dataSource;
```

atau lebih baik lagi, bridge ke CDI:

```java
@Produces
@ApplicationScoped
@CaseManagementDatabase
public DataSource caseManagementDataSource() throws NamingException {
    return InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
}
```

lalu business code cukup:

```java
@Inject
public CaseRepository(@CaseManagementDatabase DataSource dataSource) {
    this.dataSource = dataSource;
}
```

Dengan begini, JNDI tetap dipakai sebagai boundary runtime, tetapi tidak menyebar ke business logic.

---

## 3. Naming Bukan Dependency Injection, tetapi Sering Bertemu

Penting membedakan:

| Konsep | Pertanyaan yang Dijawab |
|---|---|
| Dependency Injection | Object apa yang dibutuhkan class ini? |
| CDI resolution | Bean mana yang cocok berdasarkan type + qualifier? |
| Resource injection | Resource container apa yang harus disediakan? |
| JNDI naming | Nama runtime mana yang menunjuk ke object/resource itu? |
| Externalized configuration | Value environment apa yang dipakai saat deploy/run? |

`@Inject` biasanya memilih bean dari CDI container.

`@Resource` biasanya menyatakan resource reference yang dikelola container.

JNDI adalah naming layer yang menyimpan binding.

Contoh:

```java
@Inject
private CasePolicyService policyService;
```

Artinya:

```text
resolve CDI bean by type CasePolicyService and qualifiers
```

Sedangkan:

```java
@Resource(name = "jdbc/CaseManagementDS")
private DataSource dataSource;
```

Artinya kira-kira:

```text
inject resource from component environment naming context
usually under java:comp/env/jdbc/CaseManagementDS
```

Keduanya bisa terlihat mirip karena sama-sama “injection”, tetapi runtime semantics-nya berbeda.

---

## 4. Kenapa `java:comp/env` Penting

Salah satu namespace paling penting di Java EE/Jakarta EE adalah:

```text
java:comp/env
```

Secara mental:

```text
java:comp/env = private environment namespace milik komponen aplikasi
```

Artinya, sebuah komponen dapat memakai logical name seperti:

```text
java:comp/env/jdbc/MainDS
```

Nama ini bukan berarti physical datasource di server pasti bernama sama. Ini adalah logical reference milik aplikasi/komponen.

Container kemudian menghubungkan logical reference tersebut ke physical resource yang dikonfigurasi di server.

Diagram:

```text
Application code
  |
  | lookup/inject logical resource
  v
java:comp/env/jdbc/MainDS
  |
  | mapped by deployment/runtime configuration
  v
Server resource: jdbc/oracle/aceas/dev/MainDS
  |
  v
Oracle RDS DEV/UAT/PROD
```

Kenapa tidak langsung pakai physical name?

Karena logical name memberi indirection:

```text
same application artifact
  DEV  -> logical jdbc/MainDS maps to DEV Oracle
  UAT  -> logical jdbc/MainDS maps to UAT Oracle
  PROD -> logical jdbc/MainDS maps to PROD Oracle
```

Inilah salah satu ide dasar enterprise deployment.

---

## 5. JNDI Namespace Utama di Jakarta EE

Modern Jakarta EE mengenal beberapa namespace standar.

### 5.1 `java:comp`

`java:comp` adalah namespace komponen.

Digunakan untuk resource yang scoped ke component instance atau component environment.

Yang paling sering:

```text
java:comp/env
```

Contoh:

```text
java:comp/env/jdbc/CaseDS
java:comp/env/mail/AppMail
java:comp/env/app/maxRetry
```

Karakteristik:

- private untuk component environment;
- cocok untuk logical reference;
- menghindari tabrakan nama antar komponen;
- lazim dipakai dalam `web.xml`, `ejb-jar.xml`, annotation, atau vendor deployment descriptor.

### 5.2 `java:module`

`java:module` adalah namespace untuk module.

Contoh module:

- satu WAR;
- satu EJB-JAR;
- satu module di dalam EAR.

Resource/object di sini visible untuk module tersebut.

Contoh:

```text
java:module/env/someName
```

atau EJB lookup tertentu tergantung server/spec.

### 5.3 `java:app`

`java:app` adalah namespace untuk satu application.

Dalam EAR, beberapa module bisa berada dalam satu application. `java:app` bisa dipakai untuk sharing di boundary application.

Contoh mental:

```text
EAR application
  - web.war
  - business.jar
  - batch.jar

java:app/SomeSharedReference visible inside same app
```

### 5.4 `java:global`

`java:global` adalah namespace global aplikasi di server.

Biasanya terlihat pada EJB portable global JNDI name.

Contoh pola umum EJB:

```text
java:global[/<app-name>]/<module-name>/<bean-name>[!<fully-qualified-interface-name>]
```

Contoh:

```text
java:global/aceas-case/business/CaseCommandService!com.example.CaseCommand
```

Karakteristik:

- lebih luas visible;
- berguna untuk remote/local lookup tertentu;
- lebih rawan coupling jika digunakan sembarangan;
- sebaiknya tidak dipakai sebagai default untuk resource internal yang bisa di-inject.

---

## 6. Naming Context: Bukan Sekadar String

Salah satu kesalahan umum adalah menganggap JNDI name hanya string bebas.

JNDI name adalah string, tetapi string itu berada dalam **naming context**.

Contoh:

```text
java:comp/env/jdbc/MainDS
```

Dapat dipecah:

```text
java:        namespace root
comp:        component namespace
env:         component environment
jdbc:        convention subcontext for JDBC resources
MainDS:      logical name
```

Subcontext seperti `jdbc`, `mail`, `jms`, `ejb`, `url` sering dipakai sebagai konvensi agar nama mudah dibaca.

Contoh:

```text
java:comp/env/jdbc/AceasDS
java:comp/env/jms/CaseEventQueue
java:comp/env/mail/NotificationSession
java:comp/env/url/OneMapEndpoint
java:comp/env/config/FeatureFlagBaseUrl
```

Top engineer tidak hanya melihat string-nya, tetapi bertanya:

```text
Namespace mana?
Visible dari komponen mana?
Dibinding oleh siapa?
Object type apa?
Apakah logical atau physical?
Apakah portable atau vendor-specific?
Apakah environment-specific?
```

---

## 7. Logical Resource Reference vs Physical Resource

Ini konsep inti.

### 7.1 Physical Resource

Physical resource adalah resource nyata yang disediakan server/runtime.

Contoh:

```text
Oracle datasource:
  host: aceas-dev.xxx.ap-southeast-1.rds.amazonaws.com
  port: 1521
  service: ACEASDEV
  username: ACEAS_APP
  password: from secret store
  pool min/max
  validation query
  transaction integration
```

atau:

```text
JMS queue:
  provider: ActiveMQ Artemis
  address: case.events
  connection factory: jms/CaseConnectionFactory
```

atau:

```text
Mail session:
  host: smtp.internal
  port: 587
  tls: true
```

### 7.2 Logical Reference

Logical reference adalah nama yang dipakai aplikasi.

Contoh:

```text
jdbc/CaseManagementDS
mail/NotificationMail
jms/CaseEventQueue
```

Aplikasi berkata:

```text
Saya butuh DataSource bernama jdbc/CaseManagementDS.
```

Server berkata:

```text
Di DEV, logical name itu saya bind ke datasource DEV.
Di UAT, logical name itu saya bind ke datasource UAT.
Di PROD, logical name itu saya bind ke datasource PROD.
```

### 7.3 Kenapa Indirection Ini Penting

Tanpa indirection:

```text
code -> prod physical datasource
```

Dengan indirection:

```text
code -> logical name -> environment mapping -> physical datasource
```

Keuntungannya:

- artifact sama untuk semua environment;
- konfigurasi bisa dikontrol infra/platform;
- secret tidak masuk artifact;
- resource bisa diganti tanpa recompile;
- deployment descriptor bisa mengikat reference;
- server bisa menyediakan pooling, monitoring, transaction integration;
- audit environment lebih jelas.

---

## 8. Environment Entry: Value Konfigurasi Klasik dalam Jakarta EE

Selain resource seperti `DataSource`, Jakarta EE juga punya konsep **environment entry**.

Environment entry adalah value konfigurasi sederhana yang bisa diakses lewat component environment.

Contoh value:

```text
maxRetry = 3
featureXEnabled = true
externalSystemCode = SLA_DCP
supportEmail = support@example.com
```

Dalam deployment descriptor klasik:

```xml
<env-entry>
    <env-entry-name>app/maxRetry</env-entry-name>
    <env-entry-type>java.lang.Integer</env-entry-type>
    <env-entry-value>3</env-entry-value>
</env-entry>
```

Kemudian bisa di-inject:

```java
@Resource(name = "app/maxRetry")
private Integer maxRetry;
```

Atau lookup:

```java
Integer maxRetry = (Integer) new InitialContext()
    .lookup("java:comp/env/app/maxRetry");
```

### 8.1 Environment Entry vs MicroProfile Config

Environment entry adalah model klasik Jakarta EE.

MicroProfile Config adalah model konfigurasi modern yang lebih fleksibel.

| Aspek | Env Entry | MicroProfile Config |
|---|---|---|
| Era | Java EE/Jakarta EE klasik | Cloud-native Jakarta/MicroProfile |
| Access | JNDI / `@Resource` | `@ConfigProperty`, `Config` |
| Source | deployment descriptor/server config | env var, system property, file, custom source |
| Type conversion | terbatas | lebih kaya dan extensible |
| Dynamic source | kurang natural | bisa via provider/source tertentu |
| Cloud/Kubernetes fit | kurang ergonomis | lebih cocok |

Tetapi dalam sistem enterprise legacy, environment entry masih penting. Banyak app server dan aplikasi lama menggunakannya untuk config sederhana.

---

## 9. Resource References

Resource reference adalah deklarasi bahwa aplikasi membutuhkan resource tertentu.

Contoh `web.xml`:

```xml
<resource-ref>
    <description>Case management datasource</description>
    <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

Dalam Jakarta namespace modern, type Java-nya tetap sering `javax.sql.DataSource` karena JDBC masih Java SE/Jakarta integration, bukan package `jakarta.sql`.

Kemudian server-specific descriptor bisa mengikat logical reference ke physical resource.

Contoh konseptual:

```xml
<resource-ref>
    <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
    <jndi-name>jdbc/OracleAceasDevDS</jndi-name>
</resource-ref>
```

Nama elemen vendor-specific berbeda antar server:

- GlassFish/Payara punya `glassfish-web.xml` / `glassfish-resources.xml`;
- WildFly punya subsystem dan deployment structure;
- WebLogic punya `weblogic.xml`;
- WebSphere/Open Liberty punya server config;
- Tomcat punya `context.xml` dan resource config.

Konsepnya sama:

```text
logical app reference -> server physical resource
```

---

## 10. Resource Environment References

Ada juga resource environment reference untuk resource administered object tertentu, misalnya JMS destination.

Contoh konseptual:

```xml
<resource-env-ref>
    <resource-env-ref-name>jms/CaseEventQueue</resource-env-ref-name>
    <resource-env-ref-type>jakarta.jms.Queue</resource-env-ref-type>
</resource-env-ref>
```

Atau injection:

```java
@Resource(lookup = "java:comp/env/jms/CaseEventQueue")
private Queue caseEventQueue;
```

Biasanya dipakai untuk:

- JMS queue;
- JMS topic;
- administered objects dari resource adapter;
- connector resource object.

---

## 11. EJB References

Dalam Java EE/Jakarta EE klasik, EJB reference juga bisa dideklarasikan dalam component environment.

Contoh logical EJB reference:

```xml
<ejb-ref>
    <ejb-ref-name>ejb/CaseCommandService</ejb-ref-name>
    <ejb-ref-type>Session</ejb-ref-type>
    <remote>com.example.CaseCommandRemote</remote>
</ejb-ref>
```

Kemudian kode bisa lookup:

```java
CaseCommandRemote service = (CaseCommandRemote) new InitialContext()
    .lookup("java:comp/env/ejb/CaseCommandService");
```

Namun dalam aplikasi modern, injection lebih umum:

```java
@EJB
private CaseCommandService service;
```

atau jika sudah dimodernisasi ke CDI:

```java
@Inject
private CaseCommandService service;
```

Tetap penting memahami EJB references karena legacy enterprise apps sering memiliki banyak lookup string, deployment descriptor, dan remote interface binding.

---

## 12. Persistence Unit dan Persistence Context References

JPA integration juga punya naming/resource reference model.

Contoh:

```java
@PersistenceContext(unitName = "casePU")
private EntityManager em;
```

Atau descriptor:

```xml
<persistence-context-ref>
    <persistence-context-ref-name>persistence/CaseEntityManager</persistence-context-ref-name>
    <persistence-unit-name>casePU</persistence-unit-name>
</persistence-context-ref>
```

Lookup dapat dilakukan pada konteks tertentu:

```java
EntityManager em = (EntityManager) new InitialContext()
    .lookup("java:comp/env/persistence/CaseEntityManager");
```

Namun, direct lookup `EntityManager` jarang menjadi pilihan bersih untuk aplikasi modern. Biasanya gunakan:

```java
@PersistenceContext
EntityManager em;
```

atau abstraction repository/application service.

Di bagian ini kita tidak mengulang detail JPA. Yang penting adalah memahami bahwa `EntityManager`, `DataSource`, JMS, mail, executor, dan EJB reference semua bisa tampil sebagai resource/reference di component environment.

---

## 13. `@Resource`: Name vs Lookup

`@Resource` punya beberapa atribut penting. Dua yang sering membingungkan:

```java
@Resource(name = "jdbc/CaseManagementDS")
private DataSource ds;
```

vs

```java
@Resource(lookup = "java:global/jdbc/PhysicalDS")
private DataSource ds;
```

Secara mental:

### 13.1 `name`

`name` biasanya mendeklarasikan atau mereferensikan resource dalam component environment.

Jika nama tidak diawali `java:`, default namespace sering diarahkan ke `java:comp/env`.

Contoh:

```java
@Resource(name = "jdbc/CaseManagementDS")
private DataSource ds;
```

Bisa dipahami sebagai:

```text
resource reference logical name:
  java:comp/env/jdbc/CaseManagementDS
```

### 13.2 `lookup`

`lookup` biasanya menunjuk langsung ke nama JNDI resource yang ingin dilookup.

Contoh:

```java
@Resource(lookup = "java:global/jdbc/CaseManagementDS")
private DataSource ds;
```

Atau vendor resource:

```java
@Resource(lookup = "jdbc/OracleAceasDS")
private DataSource ds;
```

Tapi hati-hati: `lookup` direct ke physical/vendor name dapat mengurangi portabilitas dan membuat code lebih environment-coupled.

### 13.3 Rule of Thumb

Gunakan logical `name`/component environment jika ingin portabilitas:

```java
@Resource(name = "jdbc/CaseManagementDS")
DataSource ds;
```

Gunakan `lookup` direct hanya jika:

- server convention mengharuskan;
- resource memang global dan stabil;
- portability bukan target;
- mapping descriptor tidak tersedia;
- Anda sengaja membuat platform-specific integration boundary.

---

## 14. Deployment Descriptor vs Annotation

Enterprise Java punya dua cara besar menyatakan metadata:

1. Annotation di source code.
2. Deployment descriptor XML.

Contoh annotation:

```java
@Resource(name = "jdbc/CaseManagementDS")
private DataSource ds;
```

Contoh descriptor:

```xml
<resource-ref>
    <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

### 14.1 Mana yang Lebih Baik?

Tidak selalu satu lebih baik.

Annotation baik untuk:

- metadata dekat dengan code;
- dependency jelas saat membaca class;
- lebih sedikit XML;
- cocok untuk resource reference yang stabil.

Descriptor baik untuk:

- override tanpa mengubah source;
- legacy compatibility;
- environment-specific mapping;
- centralized deployment governance;
- server/vendor-specific binding;
- memisahkan code dari operational deployment detail.

### 14.2 Prinsip Top Engineer

Pisahkan tiga layer:

```text
Source code:
  Saya butuh logical resource jdbc/CaseManagementDS

Portable descriptor/annotation:
  Resource itu bertipe DataSource dan di-auth oleh container

Server/runtime config:
  Di environment ini, logical resource itu dibind ke physical Oracle DS tertentu
```

Jika semua dicampur di source code, aplikasi menjadi sulit dipindah, dites, dan diaudit.

---

## 15. Contoh End-to-End: DataSource Resource Reference

### 15.1 Application Code

```java
package com.example.caseapp.infrastructure.db;

import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import javax.sql.DataSource;

@ApplicationScoped
public class JdbcHealthProbe {

    @Resource(name = "jdbc/CaseManagementDS")
    private DataSource dataSource;

    public boolean canConnect() {
        try (var connection = dataSource.getConnection()) {
            return connection.isValid(2);
        } catch (Exception ex) {
            return false;
        }
    }
}
```

Logical name:

```text
jdbc/CaseManagementDS
```

Likely full component environment name:

```text
java:comp/env/jdbc/CaseManagementDS
```

### 15.2 Portable Descriptor

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.1">

    <resource-ref>
        <description>Datasource for case management database</description>
        <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
        <res-type>javax.sql.DataSource</res-type>
        <res-auth>Container</res-auth>
    </resource-ref>

</web-app>
```

### 15.3 Server Binding

Conceptual server config:

```text
logical:  java:comp/env/jdbc/CaseManagementDS
physical: jdbc/aceas/oracle/dev/CaseManagementDS
```

DEV:

```text
physical datasource -> Oracle DEV
```

UAT:

```text
physical datasource -> Oracle UAT
```

PROD:

```text
physical datasource -> Oracle PROD
```

Same WAR. Different binding.

---

## 16. Contoh End-to-End: Environment Entry

### 16.1 Descriptor

```xml
<env-entry>
    <env-entry-name>app/case/maxAutoAssignment</env-entry-name>
    <env-entry-type>java.lang.Integer</env-entry-type>
    <env-entry-value>50</env-entry-value>
</env-entry>

<env-entry>
    <env-entry-name>app/case/enableStrictRouting</env-entry-name>
    <env-entry-type>java.lang.Boolean</env-entry-type>
    <env-entry-value>true</env-entry-value>
</env-entry>
```

### 16.2 Injection

```java
@Resource(name = "app/case/maxAutoAssignment")
private Integer maxAutoAssignment;

@Resource(name = "app/case/enableStrictRouting")
private Boolean enableStrictRouting;
```

### 16.3 Problem

This works, but it is awkward for rich configuration.

If you have many config values:

```java
@Resource(name = "app/case/maxAutoAssignment")
Integer maxAutoAssignment;

@Resource(name = "app/case/enableStrictRouting")
Boolean enableStrictRouting;

@Resource(name = "app/case/escalationWindowDays")
Integer escalationWindowDays;

@Resource(name = "app/case/defaultAgencyCode")
String defaultAgencyCode;
```

It becomes noisy.

Modern pattern:

```java
@ApplicationScoped
public class CaseRoutingConfig {
    private final int maxAutoAssignment;
    private final boolean strictRouting;
    private final int escalationWindowDays;
    private final String defaultAgencyCode;

    // loaded via MicroProfile Config, typed config, or producer
}
```

Then inject one config object:

```java
@Inject
CaseRoutingConfig config;
```

But if you maintain legacy Jakarta EE, environment entries remain relevant.

---

## 17. Direct Lookup: Kapan Masuk Akal dan Kapan Tidak

Direct JNDI lookup:

```java
DataSource ds = InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
```

### 17.1 Kapan Masuk Akal

Direct lookup masuk akal jika:

- berada di infrastructure boundary;
- sedang membuat bridge ke CDI producer;
- ada legacy helper class yang belum managed;
- sedang menulis migration adapter;
- framework integration membutuhkan manual lookup;
- ingin menunda lookup sampai resource benar-benar dipakai.

### 17.2 Kapan Tidak Masuk Akal

Direct lookup buruk jika tersebar di business logic:

```java
public void approveCase(String caseId) {
    DataSource ds = InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
    // business logic...
}
```

Masalah:

- string literal menyebar;
- sulit dites;
- resource dependency tidak terlihat dari constructor;
- error muncul runtime, bukan wiring validation;
- tidak ada type-safe qualifier;
- business logic tahu naming infrastructure.

Lebih baik:

```java
@ApplicationScoped
public class CaseApprovalService {
    private final CaseRepository repository;

    @Inject
    public CaseApprovalService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

Dan JNDI hanya ada di adapter/producer.

---

## 18. Bridge Pattern: JNDI Resource ke CDI Producer

Salah satu pola terbaik untuk aplikasi modern yang masih memakai app server resources:

```text
JNDI physical/runtime resource
  -> CDI producer
  -> qualifier/type-safe injection
  -> application/infrastructure code
```

### 18.1 Qualifier

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.*;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface CaseDatabase {
}
```

### 18.2 Producer

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

import javax.naming.InitialContext;
import javax.naming.NamingException;
import javax.sql.DataSource;

@ApplicationScoped
public class DataSourceProducer {

    @Produces
    @ApplicationScoped
    @CaseDatabase
    public DataSource caseDatabase() {
        try {
            return InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
        } catch (NamingException ex) {
            throw new IllegalStateException(
                "JNDI resource not found: java:comp/env/jdbc/CaseManagementDS",
                ex
            );
        }
    }
}
```

### 18.3 Consumer

```java
@ApplicationScoped
public class CaseJdbcRepository {
    private final DataSource dataSource;

    @Inject
    public CaseJdbcRepository(@CaseDatabase DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

### 18.4 Keuntungan

- JNDI string hanya di satu tempat.
- Consumer type-safe.
- Test bisa mengganti producer.
- Business logic tidak tahu JNDI.
- Startup failure bisa dibuat fail-fast.
- Qualifier menjelaskan semantic resource.

### 18.5 Catatan Scope

Untuk `DataSource`, biasanya producer `@ApplicationScoped` masuk akal karena `DataSource` adalah thread-safe pooled factory yang dikelola container.

Jangan membuat producer yang membuka `Connection` sebagai `@ApplicationScoped`.

Buruk:

```java
@Produces
@ApplicationScoped
public Connection connection(DataSource ds) throws SQLException {
    return ds.getConnection();
}
```

Ini akan menahan satu connection terlalu lama dan merusak pooling semantics.

Lebih benar:

```java
try (Connection c = dataSource.getConnection()) {
    // use and close, returning to pool
}
```

atau gunakan JPA/JTA boundary.

---

## 19. Naming Design: Cara Memberi Nama Resource yang Waras

Naming resource terlihat sepele, tapi dalam enterprise system besar ini bisa menjadi sumber chaos.

### 19.1 Nama Buruk

```text
jdbc/db
jdbc/test
jdbc/prod
jdbc/oracle
jdbc/main
jdbc/new
jdbc/fajar
```

Masalah:

- tidak menjelaskan domain;
- environment masuk logical name;
- susah dibedakan;
- rawan salah bind;
- tidak audit-friendly.

### 19.2 Nama Lebih Baik

```text
jdbc/CaseManagementDS
jdbc/AuditTrailDS
jdbc/ReportingDS
jms/CaseEventQueue
jms/NotificationTopic
mail/OutboundNotificationMail
concurrency/CaseBackgroundExecutor
url/OneMapApiBaseUrl
```

Prinsip:

```text
resource category / semantic purpose
```

Bukan:

```text
environment / physical vendor / temporary owner
```

### 19.3 Jangan Masukkan Environment ke Logical Name

Hindari:

```text
jdbc/CaseManagementDS_DEV
jdbc/CaseManagementDS_UAT
jdbc/CaseManagementDS_PROD
```

Kenapa?

Karena aplikasi seharusnya memakai logical name yang sama:

```text
jdbc/CaseManagementDS
```

Mapping environment terjadi di deployment/server config.

Jika logical name berbeda per environment, artifact atau config aplikasi harus berubah lebih banyak.

### 19.4 Kapan Environment di Name Masuk Akal?

Hanya untuk admin/server physical resource name, bukan application logical reference.

Contoh physical resource di server:

```text
jdbc/oracle/aceas/dev/CaseManagementDS
jdbc/oracle/aceas/uat/CaseManagementDS
jdbc/oracle/aceas/prod/CaseManagementDS
```

Aplikasi tetap:

```text
java:comp/env/jdbc/CaseManagementDS
```

---

## 20. Namespace Visibility dan Collision

Misalnya dua module dalam satu EAR:

```text
aceas.ear
  case-web.war
  reporting-web.war
```

Keduanya bisa punya:

```text
java:comp/env/jdbc/MainDS
```

Karena `java:comp/env` adalah component environment, nama tersebut tidak harus collision.

Tetapi jika memakai global name:

```text
java:global/jdbc/MainDS
```

maka visibility lebih luas dan collision risk lebih besar.

Top engineer memilih namespace berdasarkan visibility yang dibutuhkan:

| Kebutuhan | Namespace yang Cocok |
|---|---|
| Private component reference | `java:comp/env` |
| Shared dalam module | `java:module` |
| Shared dalam application/EAR | `java:app` |
| Global lookup/server-wide | `java:global` atau vendor global name |

Prinsip umum:

> Use the narrowest namespace that satisfies the requirement.

Semakin luas namespace, semakin besar coupling dan collision risk.

---

## 21. JNDI dan Security

Resource naming juga berhubungan dengan security.

### 21.1 Container Authentication

Dalam resource-ref:

```xml
<res-auth>Container</res-auth>
```

Artinya container mengelola authentication ke resource.

Untuk datasource, credential biasanya disimpan di server secret/config, bukan aplikasi.

Aplikasi hanya meminta `DataSource`.

### 21.2 Application Authentication

Ada juga model di mana aplikasi menyediakan credential sendiri.

Ini lebih jarang direkomendasikan untuk enterprise managed resource karena:

- secret bisa bocor ke aplikasi;
- rotation lebih sulit;
- transaction/pooling integration bisa lebih rumit;
- audit ownership kabur.

### 21.3 Least Privilege Resource

Jangan satu aplikasi memakai satu datasource superuser untuk semua hal.

Desain lebih aman:

```text
jdbc/CaseManagementDS       -> app schema privileges
jdbc/ReportingReadOnlyDS    -> read-only reporting privileges
jdbc/AuditWriteDS           -> append-oriented audit privileges
```

Resource naming bisa merefleksikan capability:

```text
AuditWriteDS
ReportingReadOnlyDS
```

bukan hanya vendor:

```text
OracleDS
```

---

## 22. JNDI dan Transaction Integration

Resource yang disediakan container bukan hanya object biasa. Misalnya `DataSource` dapat terintegrasi dengan JTA.

Dalam managed transaction:

```java
@Stateless
public class CaseCommandBean {
    @Resource(name = "jdbc/CaseManagementDS")
    private DataSource ds;

    public void approve(String caseId) {
        // connection can participate in container-managed transaction
    }
}
```

Jika memakai JTA-aware datasource, container dapat:

- enlist connection ke transaction;
- coordinate commit/rollback;
- manage pooling;
- apply timeout;
- integrate with monitoring.

Jika Anda bypass container dengan `DriverManager.getConnection()`, Anda bisa kehilangan banyak integrasi ini.

Mental model:

```text
JNDI DataSource is not just a connection factory.
It is a managed resource endpoint.
```

---

## 23. JNDI dalam Servlet Container Ringan

Tidak semua runtime adalah full Jakarta EE server.

Tomcat misalnya adalah servlet container, bukan full Jakarta EE platform. Ia tetap mendukung JNDI resources untuk web apps, tetapi tidak menyediakan semua layanan full platform secara default.

Contoh Tomcat `context.xml` konseptual:

```xml
<Context>
    <Resource name="jdbc/CaseManagementDS"
              auth="Container"
              type="javax.sql.DataSource"
              driverClassName="oracle.jdbc.OracleDriver"
              url="jdbc:oracle:thin:@..."
              username="..."
              password="..."
              maxTotal="50" />
</Context>
```

Kode web app:

```java
DataSource ds = InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
```

Tapi fitur seperti EJB, JTA full, CDI full, JMS, dan others bisa membutuhkan tambahan library/container seperti TomEE, WildFly, Payara, Open Liberty, atau integrasi khusus.

Pelajaran:

```text
JNDI name may look similar across runtimes,
but provided services behind the name differ by container capability.
```

---

## 24. JNDI dalam Full Jakarta EE Server

Full Jakarta EE server seperti WildFly, Payara, Open Liberty, GlassFish, atau WebLogic biasanya menyediakan lebih banyak resource integration:

- JDBC datasource;
- JTA transaction manager;
- JMS provider/resource adapter;
- mail session;
- managed executor;
- EJB lookup;
- security integration;
- connector resource adapter;
- deployment descriptor mapping.

Dalam full server, JNDI adalah bagian dari application assembly model.

Aplikasi tidak hanya menjalankan code. Aplikasi dideploy ke environment yang menyediakan named services.

Mental model:

```text
WAR/EAR deployment
  + descriptors/annotations
  + server resources
  + naming bindings
  + security realm
  + transaction manager
  + connection pools
  = running enterprise application
```

---

## 25. Modern Cloud-Native Shift: Dari JNDI ke Config + Injection

Di cloud-native Java, terutama Spring Boot, Quarkus, Micronaut, dan MicroProfile runtime, banyak konfigurasi bergeser dari JNDI ke:

- environment variables;
- system properties;
- config files;
- Kubernetes ConfigMap;
- Kubernetes Secret;
- Vault/secret manager;
- MicroProfile Config;
- Spring configuration properties;
- build-time config;
- runtime config source.

Contoh MicroProfile Config:

```java
@Inject
@ConfigProperty(name = "case.assignment.max-auto-assignment")
int maxAutoAssignment;
```

Atau typed config object di framework tertentu.

### 25.1 Apakah JNDI Mati?

Tidak sepenuhnya.

JNDI masih relevan untuk:

- legacy Java EE/Jakarta EE apps;
- full app server resources;
- managed datasource di server;
- remote EJB lookup;
- connector/resource adapter;
- migration/interop;
- enterprise products yang masih memakai deployment descriptor.

Tetapi untuk konfigurasi sederhana, MicroProfile Config/environment variable biasanya lebih ergonomis.

### 25.2 Rule of Thumb Modern

Gunakan JNDI untuk:

```text
managed resource endpoints
```

Contoh:

- `DataSource`;
- JMS connection factory;
- Queue/Topic;
- mail session;
- managed executor;
- resource adapter.

Gunakan config system untuk:

```text
scalar values and application settings
```

Contoh:

- timeout;
- base URL;
- feature flag;
- retry count;
- mode;
- threshold;
- tenant config;
- environment profile.

---

## 26. Kubernetes dan JNDI: Perubahan Ownership

Dalam Kubernetes, physical runtime config sering datang dari:

```text
ConfigMap -> env var/file
Secret    -> env var/file/volume
Service   -> DNS name
```

Contoh:

```yaml
env:
  - name: CASE_DB_JDBC_URL
    valueFrom:
      secretKeyRef:
        name: case-db-secret
        key: jdbc-url
  - name: CASE_DB_USERNAME
    valueFrom:
      secretKeyRef:
        name: case-db-secret
        key: username
```

Framework modern membuat `DataSource` dari config tersebut.

Dalam app server klasik, server mendefinisikan datasource, lalu aplikasi lookup/inject JNDI.

Perbandingan:

```text
Classic Jakarta EE:
  server config creates DataSource
  app obtains DataSource via JNDI/resource injection

Cloud-native microservice:
  app/framework creates DataSource from env/config/secrets
  app obtains DataSource via DI
```

Keduanya bisa benar. Yang penting adalah ownership-nya jelas.

Pertanyaan desain:

```text
Who owns resource construction?
  app server?
  framework?
  application code?
  platform operator?
```

Jika jawabannya kabur, incident akan sulit dianalisis.

---

## 27. Externalized Resource Contract

Untuk enterprise system, definisikan resource contract secara eksplisit.

Contoh resource contract:

```yaml
resource: jdbc/CaseManagementDS
type: javax.sql.DataSource
purpose: primary OLTP datasource for case management commands and queries
auth: container
transactional: true
pool:
  min: environment-specific
  max: environment-specific
required: true
environments:
  dev: maps to Oracle DEV schema ACEAS_APP
  uat: maps to Oracle UAT schema ACEAS_APP
  prod: maps to Oracle PROD schema ACEAS_APP
failure_policy:
  startup: fail deployment if missing
  runtime: health check reports down
owner:
  application: ACEAS
  platform: TFM/infra equivalent
  database: DBA team
```

Kenapa perlu?

Karena resource bukan hanya technical string. Resource adalah operational contract antara application team, platform team, DBA, security, dan runtime.

---

## 28. Common Failure: `NameNotFoundException`

Error umum:

```text
javax.naming.NameNotFoundException: Name [jdbc/CaseManagementDS] is not bound in this Context
```

atau Jakarta/modern stack dengan message mirip.

### 28.1 Kemungkinan Penyebab

1. Resource belum dibuat di server.
2. Resource dibuat dengan nama berbeda.
3. Aplikasi lookup namespace salah.
4. Resource-ref belum dideklarasikan.
5. Vendor descriptor mapping salah.
6. Deployment module berbeda dari yang diasumsikan.
7. Server profile/subsystem belum aktif.
8. Driver/resource adapter belum tersedia.
9. App menggunakan `javax` descriptor pada runtime `jakarta` atau sebaliknya.
10. Lookup dilakukan terlalu awal sebelum naming context tersedia.

### 28.2 Cara Diagnosis

Checklist:

```text
[ ] Apa exact JNDI name yang dilookup?
[ ] Apakah name diawali java:comp/env, java:module, java:app, java:global, atau vendor global?
[ ] Apakah resource ada di server admin/config?
[ ] Apakah deployment descriptor mendeklarasikan resource-ref?
[ ] Apakah vendor descriptor mengikat logical ref ke physical resource?
[ ] Apakah type resource cocok?
[ ] Apakah module yang melakukan lookup punya akses ke namespace itu?
[ ] Apakah log deployment menunjukkan binding berhasil?
[ ] Apakah server menampilkan portable JNDI names saat deploy?
[ ] Apakah aplikasi berjalan di servlet container ringan atau full Jakarta EE?
```

### 28.3 Cara Membaca Error

Jika error bilang:

```text
Name [jdbc/CaseManagementDS] not found
```

mungkin Anda lookup relative name padahal harus:

```text
java:comp/env/jdbc/CaseManagementDS
```

Jika error bilang:

```text
Name [java:comp/env/jdbc/CaseManagementDS] not found
```

mungkin logical ref belum dideklarasikan atau belum dibind.

Jika error muncul hanya di UAT/PROD:

```text
Environment binding/config drift
```

bukan code issue murni.

---

## 29. Common Failure: Wrong Namespace

Contoh salah:

```java
InitialContext.doLookup("jdbc/CaseManagementDS");
```

Padahal resource berada di:

```text
java:comp/env/jdbc/CaseManagementDS
```

Atau sebaliknya, server resource global ada di:

```text
java:/jdbc/CaseManagementDS
```

tetapi aplikasi lookup:

```text
java:comp/env/jdbc/CaseManagementDS
```

Dalam beberapa server, `java:/` adalah vendor-specific namespace, bukan portable Jakarta namespace.

Top engineer akan bertanya:

```text
Is this a portable application environment name or vendor-specific server name?
```

Jika portable, gunakan `java:comp/env` dan resource-ref mapping.

Jika vendor-specific, isolasi dalam adapter/producer.

---

## 30. Common Failure: Type Mismatch

Resource ditemukan, tetapi type salah.

Contoh:

```text
java.lang.ClassCastException: com.vendor.ConnectionFactory cannot be cast to javax.sql.DataSource
```

Penyebab:

- resource name menunjuk object type salah;
- binding salah di server;
- resource-ref type salah;
- classloader memuat interface berbeda;
- `javax` vs `jakarta` mismatch untuk API tertentu seperti JMS;
- server module conflict.

Contoh JMS migration trap:

```java
@Resource(name = "jms/CaseConnectionFactory")
private javax.jms.ConnectionFactory oldFactory;
```

Pada Jakarta EE modern seharusnya:

```java
@Resource(name = "jms/CaseConnectionFactory")
private jakarta.jms.ConnectionFactory factory;
```

JDBC `DataSource` tetap:

```java
javax.sql.DataSource
```

Karena `javax.sql` adalah Java SE/JDBC package, bukan Java EE/Jakarta EE namespace migration target.

Ini detail kecil tapi penting.

---

## 31. Common Failure: Resource Bound but Unusable

Kadang lookup sukses, tetapi penggunaan gagal.

Contoh:

```text
DataSource injected successfully
but getConnection() fails
```

Kemungkinan:

- DB host unreachable;
- security group/firewall;
- wrong credential;
- expired password;
- missing JDBC driver;
- wrong validation query;
- pool exhausted;
- transaction manager mismatch;
- TLS/certificate issue;
- DNS issue;
- DB service name wrong;
- Oracle wallet/config missing.

Ini bukan JNDI failure. Ini resource operational failure.

Bedakan:

```text
Lookup failure:
  naming/binding problem

Use failure:
  physical resource/connectivity/auth/pool problem
```

Diagnosisnya berbeda.

---

## 32. Common Failure: Lookup Too Early

JNDI context dan resource injection tersedia setelah container melakukan initialization tertentu.

Buruk:

```java
public class StaticHolder {
    static DataSource ds;

    static {
        try {
            ds = InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
        } catch (Exception e) {
            throw new ExceptionInInitializerError(e);
        }
    }
}
```

Masalah:

- static init bisa terjadi sebelum container context siap;
- classloading timing sulit diprediksi;
- test sulit;
- redeploy bisa bocor;
- classloader leak risk.

Lebih baik:

```java
@ApplicationScoped
public class DataSourceProvider {
    private DataSource ds;

    @PostConstruct
    void init() throws NamingException {
        ds = InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS");
    }
}
```

Atau gunakan `@Resource`/producer.

---

## 33. Common Failure: Static Global Resource Holder

Anti-pattern:

```java
public final class Resources {
    public static DataSource caseDs;
    public static Queue queue;
    public static Config config;
}
```

Masalah:

- lifecycle tidak jelas;
- test saling mengotori;
- redeploy leak;
- classloader leak;
- resource tidak dilepas;
- dependency tersembunyi;
- tidak ada injection graph;
- multi-tenant/multi-module sulit.

Lebih baik:

```java
@ApplicationScoped
public class CaseResources {
    private final DataSource dataSource;

    @Inject
    public CaseResources(@CaseDatabase DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

Static holder terasa simpel tetapi merusak runtime model.

---

## 34. Common Failure: Environment Drift

Aplikasi sama, tetapi:

```text
DEV works
UAT fails
PROD unknown
```

Kemungkinan besar bukan code, melainkan environment drift.

Contoh drift:

| Item | DEV | UAT | Impact |
|---|---|---|---|
| JNDI name | `jdbc/CaseDS` | `jdbc/CaseManagementDS` | lookup fail |
| Pool max | 50 | 5 | timeout under load |
| DB schema | app_v2 | app_v1 | SQL fail |
| Driver | 21.x | 19.x | behavior difference |
| Credential | valid | expired | connection fail |
| Transaction | JTA | non-JTA | commit inconsistency |
| Resource-ref mapping | exists | missing | deployment/lookup fail |

Top engineer membuat resource inventory per environment.

Contoh:

```text
Resource Inventory

Name: java:comp/env/jdbc/CaseManagementDS
Type: javax.sql.DataSource
DEV physical: jdbc/oracle/aceas/dev/CaseManagementDS
UAT physical: jdbc/oracle/aceas/uat/CaseManagementDS
PROD physical: jdbc/oracle/aceas/prod/CaseManagementDS
Driver: ojdbc version aligned? yes/no
JTA: yes/no
Pool min/max: ...
Validation: ...
Owner: ...
```

---

## 35. Externalized Resource vs Externalized Configuration

Jangan campur semua menjadi “config”. Ada dua kategori besar.

### 35.1 Externalized Resource

Resource yang berupa object/endpoint managed:

```text
DataSource
JMS ConnectionFactory
Queue
Topic
Mail Session
ManagedExecutorService
Resource Adapter ConnectionFactory
EJB reference
```

Karakteristik:

- punya lifecycle;
- mungkin pooled;
- mungkin transactional;
- punya security credential;
- dikelola container/server;
- direpresentasikan sebagai object, bukan scalar value.

### 35.2 Externalized Configuration

Value sederhana:

```text
timeout=5s
maxRetry=3
feature.enabled=true
endpoint.url=https://...
mode=STRICT
```

Karakteristik:

- scalar/structured value;
- cocok untuk MicroProfile Config/env var;
- bisa divalidasi;
- tidak selalu punya lifecycle;
- bisa reload tergantung source.

### 35.3 Design Rule

```text
Use resource injection/JNDI for managed resources.
Use configuration API for scalar configuration values.
```

Jangan menjadikan JNDI sebagai dumping ground untuk semua config baru jika runtime sudah menyediakan config system modern.

---

## 36. Naming and Feature Flags

Feature flag sebaiknya bukan JNDI resource biasa, kecuali Anda berada di legacy environment tanpa config system.

Buruk:

```java
@Resource(name = "feature/newRoutingEnabled")
private Boolean newRoutingEnabled;
```

Ini bisa bekerja, tetapi sulit untuk dynamic rollout, targeting, audit, TTL, dan per-tenant evaluation.

Lebih baik:

```java
@Inject
FeatureFlagService flags;

if (flags.isEnabled("case.routing.v2", context)) {
    // ...
}
```

Feature flag service bisa membaca:

- remote flag provider;
- database table;
- config source;
- MicroProfile Config;
- cached env config;
- emergency override.

JNDI masih bisa menyediakan endpoint/resource untuk flag client, tetapi flag evaluation jangan tersebar sebagai raw JNDI lookup.

---

## 37. Naming and Multi-Tenancy / Multi-Agency Systems

Dalam sistem regulatory/case management, sering ada multi-agency atau multi-tenant needs.

Contoh buruk:

```text
jdbc/AgencyADS
jdbc/AgencyBDS
jdbc/AgencyCDS
```

lalu business logic:

```java
if (agency.equals("A")) lookup("jdbc/AgencyADS")
else if (agency.equals("B")) lookup("jdbc/AgencyBDS")
```

Masalah:

- JNDI lookup menjadi business routing;
- sulit audit;
- sulit test;
- tenant addition butuh code change;
- resource policy tersebar.

Lebih baik:

```java
public interface TenantDataSourceResolver {
    DataSource resolve(TenantId tenantId);
}
```

Implementation di infrastructure layer:

```java
@ApplicationScoped
public class JndiTenantDataSourceResolver implements TenantDataSourceResolver {
    private final Map<TenantId, DataSource> dataSources;

    @PostConstruct
    void init() {
        // load allowed tenant-resource mapping from config
        // lookup JNDI resources once
        // validate all required resources
    }
}
```

Business code:

```java
DataSource ds = resolver.resolve(caseContext.tenantId());
```

Atau lebih baik lagi, repository abstraction yang menerima tenant context, bukan exposing datasource.

Prinsip:

```text
Tenant routing is domain/application policy.
JNDI is infrastructure lookup.
Do not mix them directly.
```

---

## 38. Naming and Auditability

Resource binding harus audit-friendly.

Pertanyaan audit:

```text
Which database did this application connect to in PROD on this date?
Which credential/schema did it use?
Which queue did it publish to?
Which mail server sent notification?
Who changed the binding?
Was the binding approved?
Was the app artifact changed or only environment config changed?
```

Jika resource naming dan mapping tidak terdokumentasi, incident review menjadi sulit.

Untuk regulated systems, buat baseline:

```text
Resource Binding Register
  - logical name
  - physical name
  - environment
  - owner
  - purpose
  - data classification
  - credential source
  - transaction mode
  - last changed by
  - approval reference
```

Ini bukan birokrasi kosong. Ini membantu traceability.

---

## 39. Naming and Deployment Promotion

Ideal promotion:

```text
same artifact promoted DEV -> UAT -> PROD
```

Yang berubah:

```text
environment binding
secrets
resource endpoints
scaling config
feature flags
```

Yang tidak berubah:

```text
compiled code
application logical resource names
business logic
packaged dependency graph
```

Jika Anda harus rebuild artifact untuk mengganti datasource, ada design smell.

Mungkin acceptable untuk beberapa build-time optimized framework, tetapi harus explicit dan controlled. Dalam Jakarta EE klasik, resource indirection dirancang agar rebuild tidak diperlukan untuk environment mapping.

---

## 40. Naming and Testing

### 40.1 Unit Test

Unit test sebaiknya tidak butuh JNDI.

Buruk:

```java
@Test
void approveCase() {
    CaseService service = new CaseService();
    // internally does JNDI lookup
}
```

Lebih baik:

```java
@Test
void approveCase() {
    CaseRepository repository = new InMemoryCaseRepository();
    CaseService service = new CaseService(repository);
}
```

### 40.2 Integration Test

Integration test boleh memakai JNDI jika memang menguji deployment/runtime binding.

Contoh tujuan test:

```text
Can app resolve jdbc/CaseManagementDS in test container?
Can DataSource connect?
Does transaction rollback work?
Does JMS queue binding exist?
```

### 40.3 Contract Test

Resource contract test bisa memvalidasi:

```text
[ ] all required JNDI names exist
[ ] type is expected
[ ] connection can be opened
[ ] transaction mode expected
[ ] queue/topic can be resolved
[ ] mail session exists
```

Ini berguna sebagai smoke test saat deployment.

---

## 41. Safe Startup Validation

Untuk resource wajib, fail-fast sering lebih baik daripada late failure.

Contoh:

```java
@ApplicationScoped
public class ResourceStartupValidator {

    @Inject
    @CaseDatabase
    DataSource caseDs;

    void onStart(@Observes @Initialized(ApplicationScoped.class) Object init) {
        validateDataSource("CaseDatabase", caseDs);
    }

    private void validateDataSource(String name, DataSource ds) {
        try (var connection = ds.getConnection()) {
            if (!connection.isValid(2)) {
                throw new IllegalStateException(name + " is invalid");
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Required datasource unavailable: " + name, ex);
        }
    }
}
```

Catatan:

- Jangan lakukan query berat saat startup.
- Jangan melakukan migration destructive otomatis tanpa kontrol.
- Validasi hanya resource critical.
- Untuk optional integration, gunakan degraded mode/health status.

---

## 42. Health Check Pattern

Resource lookup sukses saat startup tidak menjamin resource sehat selamanya.

Perlu health check.

Contoh logical health:

```text
/readiness
  database: up/down
  jms: up/down
  config: valid/invalid
  external endpoint: optional/degraded
```

Untuk datasource:

```java
public HealthCheckResponse check() {
    try (Connection c = ds.getConnection()) {
        return c.isValid(2)
            ? up("case-db")
            : down("case-db");
    } catch (Exception ex) {
        return down("case-db", ex);
    }
}
```

Jangan expose secret, full JDBC URL, username, atau internal hostname di public health response.

---

## 43. Observability: Log Binding Tanpa Bocorkan Secret

Saat startup, log resource binding secara aman:

```text
Resolved resource:
  logicalName=java:comp/env/jdbc/CaseManagementDS
  type=javax.sql.DataSource
  qualifier=@CaseDatabase
  required=true
```

Jangan log:

```text
password=...
full credential=...
full token=...
```

Untuk debugging, boleh expose metadata terbatas di admin-only endpoint:

```json
{
  "resources": [
    {
      "logicalName": "jdbc/CaseManagementDS",
      "type": "javax.sql.DataSource",
      "status": "RESOLVED",
      "required": true
    }
  ]
}
```

Di regulated systems, pastikan endpoint ini protected.

---

## 44. Vendor-Specific Naming: Jangan Berpura-pura Portable

Setiap server punya kebiasaan naming.

Contoh konsep:

```text
WildFly/JBoss: java:/jdbc/ExampleDS
Tomcat: java:comp/env/jdbc/ExampleDS via context resource
WebLogic: server JNDI names + weblogic descriptors
Open Liberty: server.xml resource config
Payara/GlassFish: jdbc resource + pool config
```

Jangan menulis kode seolah semua portable jika memakai vendor name.

Buruk:

```java
@Resource(lookup = "java:/jdbc/ExampleDS")
DataSource ds;
```

Ini mungkin bekerja di satu server, tetapi bukan portable untuk semua.

Lebih baik isolasi:

```java
public final class JndiNames {
    public static final String CASE_DS = "java:comp/env/jdbc/CaseManagementDS";
}
```

atau lebih baik lagi hanya di producer:

```java
InitialContext.doLookup(configuredJndiName)
```

Dengan config:

```properties
resources.case-db.jndi-name=java:comp/env/jdbc/CaseManagementDS
```

Tetapi hati-hati: jika JNDI name configurable, validasi saat startup.

---

## 45. Descriptor Namespace: `javax` vs `jakarta`

Saat migrasi Java EE ke Jakarta EE, descriptor XML namespace juga berubah.

Java EE 8 style:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         version="4.0">
</web-app>
```

Jakarta EE modern style:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.1">
</web-app>
```

Masalah:

- source sudah `jakarta.*`, descriptor masih Java EE old namespace;
- server masih Java EE 8, app sudah Jakarta namespace;
- schema version tidak sesuai server;
- resource-ref tidak dibaca sesuai ekspektasi.

Migration checklist:

```text
[ ] Java package imports migrated where needed
[ ] descriptor XML namespace migrated
[ ] descriptor schema version compatible
[ ] server supports target Jakarta EE version
[ ] libraries no longer pull javax EE APIs accidentally
[ ] resource type packages checked individually
```

Ingat: tidak semua `javax.*` hilang. Contoh `javax.sql.DataSource` tetap Java SE.

---

## 46. Practical Naming Convention Template

Gunakan template seperti ini:

```text
<category>/<domain-or-capability><ResourceType>
```

Contoh:

```text
jdbc/CaseManagementDS
jdbc/AuditTrailDS
jdbc/ReportingReadOnlyDS
jms/CaseEventQueue
jms/CaseNotificationTopic
mail/OutboundNotificationMail
concurrency/CaseWorkerExecutor
url/OneMapBaseUrl
config/CaseEscalationMode
```

Untuk physical server resource, boleh lebih detail:

```text
jdbc/oracle/aceas/dev/CaseManagementDS
jdbc/oracle/aceas/uat/CaseManagementDS
jdbc/oracle/aceas/prod/CaseManagementDS
```

Tetapi application logical name tetap environment-neutral:

```text
jdbc/CaseManagementDS
```

---

## 47. Resource Inventory Template

Gunakan inventory seperti ini untuk project besar.

```markdown
# Resource Inventory

## jdbc/CaseManagementDS

- Logical JNDI Name: `java:comp/env/jdbc/CaseManagementDS`
- Resource Type: `javax.sql.DataSource`
- Required: yes
- Purpose: Primary OLTP datasource for case management
- Transactional: yes, JTA-aware
- Auth: Container
- Physical Mapping:
  - DEV: `jdbc/oracle/aceas/dev/CaseManagementDS`
  - UAT: `jdbc/oracle/aceas/uat/CaseManagementDS`
  - PROD: `jdbc/oracle/aceas/prod/CaseManagementDS`
- Credential Source: server secret store / platform secret manager
- Pool Policy:
  - min: environment-specific
  - max: environment-specific
  - validation: enabled
- Owner:
  - App: Case Management Team
  - Platform: Infra Team
  - DB: DBA Team
- Failure Policy:
  - Startup: fail if missing
  - Runtime: readiness down if unavailable
- Notes:
  - Must not be used for reporting batch queries.
```

Ini terlihat administratif, tapi untuk enterprise incident dan audit, ini sangat berguna.

---

## 48. Anti-Pattern Catalog

### 48.1 Hardcoded Physical Endpoint

```java
DriverManager.getConnection("jdbc:oracle:thin:@prod-host:1521/PROD", ...)
```

Menggabungkan code dengan environment.

### 48.2 JNDI Lookup di Semua Tempat

```java
InitialContext.doLookup("java:comp/env/jdbc/CaseManagementDS")
```

tersebar di banyak service.

Solusi: producer/adapter.

### 48.3 Environment-Specific Logical Name

```text
jdbc/CaseDS_DEV
jdbc/CaseDS_UAT
jdbc/CaseDS_PROD
```

Solusi: logical name stabil, mapping environment berbeda.

### 48.4 Vendor Name di Business Code

```java
@Resource(lookup = "java:/jdbc/WildFlySpecificDS")
```

Solusi: isolate vendor lookup.

### 48.5 Static Resource Cache

```java
public static DataSource DS;
```

Solusi: container-managed lifecycle.

### 48.6 Using JNDI for All Config

```text
java:comp/env/feature/flag1
java:comp/env/feature/flag2
java:comp/env/feature/flag3
```

Solusi: config/feature flag service.

### 48.7 No Resource Contract

Aplikasi deploy gagal karena tidak ada yang tahu datasource mana harus dibuat.

Solusi: resource inventory + deployment checklist.

---

## 49. Decision Matrix

### 49.1 Saya Butuh DataSource

| Context | Recommended Pattern |
|---|---|
| Full Jakarta EE server | `@Resource` or JNDI-to-CDI producer |
| CDI-heavy app | CDI producer with qualifier |
| Spring Boot | Spring `DataSource` auto/config properties |
| Quarkus/MicroProfile | config-driven datasource + CDI injection |
| Legacy helper unmanaged | central JNDI lookup adapter |

### 49.2 Saya Butuh Scalar Config

| Context | Recommended Pattern |
|---|---|
| Legacy Java EE | env-entry acceptable |
| Jakarta/MicroProfile | MicroProfile Config |
| Spring | `@ConfigurationProperties` |
| Kubernetes | env/configmap/secret mounted to config system |
| Dynamic flag | feature flag service, not env-entry |

### 49.3 Saya Butuh Queue/Topic

| Context | Recommended Pattern |
|---|---|
| Full Jakarta EE | `@Resource` JMS resource injection |
| CDI abstraction | producer/adapter with qualifier |
| Cloud-native messaging | framework connector/config abstraction |
| Multi-provider | messaging port + provider adapter |

---

## 50. Production Checklist

Sebelum deployment:

```text
[ ] Semua logical resource names terdokumentasi.
[ ] Semua required resources ada di target environment.
[ ] Logical-to-physical mapping sudah jelas.
[ ] Secret tidak masuk artifact.
[ ] Resource type cocok dengan injection point.
[ ] Descriptor namespace cocok dengan runtime Java EE/Jakarta EE target.
[ ] `javax` vs `jakarta` package checked, terutama JMS/Mail/Annotation/EJB.
[ ] `javax.sql.DataSource` tidak salah dimigrasikan.
[ ] Pool size disesuaikan dengan DB capacity.
[ ] Resource validation aktif.
[ ] Startup validation untuk resource critical tersedia.
[ ] Health check tidak membocorkan secret.
[ ] Vendor-specific lookup diisolasi.
[ ] No direct lookup scattered in business code.
[ ] Resource owner jelas.
[ ] Rollback plan tersedia jika binding salah.
```

Saat incident:

```text
[ ] Apakah lookup gagal atau resource use gagal?
[ ] Apakah error terjadi saat deployment, startup, atau runtime request?
[ ] Apakah hanya satu environment?
[ ] Apakah name exact sama dengan yang dikonfigurasi?
[ ] Apakah namespace benar?
[ ] Apakah type benar?
[ ] Apakah server log menunjukkan binding?
[ ] Apakah credential/connection/network valid?
[ ] Apakah pool exhausted?
[ ] Apakah ada recent config change?
```

---

## 51. Mental Model Recap

Naming/JNDI bukan sekadar API lama.

Ia adalah bagian dari enterprise runtime model:

```text
Application declares what it needs.
Runtime environment binds those needs to actual resources.
Container manages lifecycle, security, pooling, and transaction integration.
```

Bedakan:

```text
Logical name:
  java:comp/env/jdbc/CaseManagementDS

Physical resource:
  Oracle datasource configured in server/Kubernetes/platform

Resource object:
  DataSource injected/lookup at runtime

Business dependency:
  CaseRepository depends on persistence capability, not on JNDI string
```

Top engineer tidak hanya bertanya:

```text
What JNDI name should I use?
```

Tetapi bertanya:

```text
Who owns this resource?
What is the logical contract?
Where is it bound?
What namespace controls visibility?
What lifecycle does it have?
Is it transactional?
How is it tested?
How is it observed?
How does it fail?
How is it migrated?
```

---

## 52. Hubungan dengan Part Berikutnya

Bagian ini menutup blok Jakarta annotation/resource/naming.

Part berikutnya masuk ke konfigurasi modern:

```text
Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts
```

Di sana kita akan membahas:

- build-time vs deploy-time vs startup-time vs runtime config;
- environment variables;
- system properties;
- config files;
- secrets;
- config precedence;
- validation;
- config drift;
- immutable deployment;
- 12-factor configuration;
- hubungan Jakarta env-entry dengan MicroProfile Config.

Dengan kata lain:

```text
Part 024: named managed resources
Part 025: configuration values and runtime contracts
```

---

## 53. Referensi Resmi dan Bacaan Lanjutan

- Jakarta EE Platform 11 Specification — naming/resource/environment references and platform rules: https://jakarta.ee/specifications/platform/11/
- Jakarta Annotations 3.0 Specification — `@Resource`, lifecycle callbacks, security annotations: https://jakarta.ee/specifications/annotations/3.0/
- Jakarta EE Tutorial — Overview and JNDI/resource concepts: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/
- Apache Tomcat JNDI Resources HOW-TO — servlet-container JNDI resource configuration: https://tomcat.apache.org/tomcat-11.0-doc/jndi-resources-howto.html
- Eclipse Jetty JNDI documentation — JNDI declarations for Jakarta EE web applications: https://jetty.org/docs/
- Open Liberty documentation — server resource configuration and classloader/resource behavior: https://openliberty.io/docs/
- WildFly documentation — datasource, naming, and module-based deployment behavior: https://docs.wildfly.org/

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 023 — Jakarta Common Annotations and Resource Injection](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-023.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 025 — Configuration Fundamentals: Values, Secrets, Environments, and Runtime Contracts](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-025.md)

</div>