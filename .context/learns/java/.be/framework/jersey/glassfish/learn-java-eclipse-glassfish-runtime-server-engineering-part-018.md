# learn-java-eclipse-glassfish-runtime-server-engineering-part-018  
# Part 18 — Naming, JNDI, Resource References, dan Cross-Module Binding

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 18 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **JNDI/naming sebagai wiring layer runtime GlassFish**, bukan pengulangan konsep injection dasar

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami JNDI bukan sebagai “API lookup lama”, tetapi sebagai **runtime naming/wiring system**;
2. membedakan namespace `java:comp`, `java:module`, `java:app`, `java:global`, dan GlassFish/global JNDI;
3. memahami hubungan antara resource fisik GlassFish dan resource reference aplikasi;
4. memahami bagaimana WAR, EJB-JAR, dan EAR saling terhubung lewat naming;
5. mendiagnosis error `NameNotFoundException`, `NamingException`, wrong resource target, dan binding collision;
6. mendesain naming convention yang aman untuk aplikasi enterprise besar;
7. memahami kapan menggunakan injection, kapan lookup, dan kapan descriptor mapping diperlukan;
8. memahami portabilitas vs vendor-specific binding;
9. membuat checklist deployment/debugging untuk resource dan cross-module binding.

Part ini tidak mengulang materi Jakarta Dependency Injection, CDI, JPA, JAX-RS, Servlet, EJB API, atau JDBC pool secara umum. Fokusnya adalah **bagaimana GlassFish menamai, memetakan, dan mengekspos object runtime ke aplikasi**.

---

## 1. Mental Model: JNDI adalah Runtime Address Space

Banyak engineer modern melihat JNDI sebagai teknologi lama:

```java
new InitialContext().lookup("some/name")
```

Itu benar, tapi terlalu sempit.

Mental model yang lebih kuat:

> JNDI adalah **address space runtime** tempat application server menaruh object yang dikelola container supaya aplikasi bisa menemukan dependency runtime tanpa hard-code object fisiknya.

Object yang bisa muncul di naming space antara lain:

- JDBC DataSource;
- JMS ConnectionFactory;
- JMS Queue/Topic;
- EJB local/remote reference;
- environment entry;
- mail session;
- connector resource;
- transaction/user transaction;
- managed executor;
- application/module/component reference.

Dalam GlassFish:

```text
Application code
  |
  | asks for name/reference
  v
Container naming context
  |
  | resolves reference
  v
GlassFish runtime resource / component
  |
  | actual implementation object
  v
Database / JMS / EJB / connector / service
```

JNDI adalah jembatan antara:

```text
logical dependency declared by application
        and
physical runtime object configured in GlassFish
```

---

## 2. Kenapa JNDI Masih Penting di GlassFish Modern?

Walaupun banyak aplikasi modern memakai CDI injection, MicroProfile Config, Spring-style config, atau direct DI, JNDI tetap penting di application server karena:

1. Jakarta EE resource injection sering berbasis naming;
2. resource seperti JDBC/JMS dikelola container;
3. EAR multi-module membutuhkan binding lintas module;
4. EJB exposure memakai nama portable/global;
5. deployment descriptor memetakan logical reference ke physical resource;
6. troubleshooting production sering berakhir pada “nama apa yang sebenarnya dicari runtime?”;
7. admin GlassFish expose resource dengan JNDI name;
8. migrasi legacy Java EE/Jakarta EE hampir pasti menyentuh JNDI.

Top 1% engineer tidak cukup tahu:

```java
@Resource(lookup = "jdbc/myDS")
DataSource ds;
```

Ia harus tahu:

```text
- nama itu ada di namespace mana?
- siapa yang membuat binding itu?
- target resource-nya server/cluster mana?
- apakah app mencari logical name atau physical JNDI name?
- apakah descriptor override annotation?
- apakah resource tersedia saat deployment?
- apakah nama portable atau GlassFish-specific?
```

---

## 3. Dua Jenis Nama: Logical Reference vs Physical Resource

Ini konsep paling penting.

### 3.1 Physical Resource Name

Physical resource adalah object runtime yang dibuat di GlassFish.

Contoh:

```bash
asadmin create-jdbc-resource \
  --connectionpoolid appPool \
  jdbc/appDS
```

Di sini:

```text
jdbc/appDS
```

adalah JNDI name fisik resource GlassFish.

---

### 3.2 Logical Reference Name

Aplikasi bisa mendeklarasikan dependency logical:

```xml
<resource-ref>
    <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

Atau pada Jakarta namespace modern tetap type Java-nya bisa `javax.sql.DataSource` karena DataSource berasal dari Java SE/JDBC, bukan Jakarta EE.

Aplikasi menyebut:

```text
jdbc/CaseManagementDS
```

Tetapi GlassFish bisa memetakannya ke resource fisik:

```text
jdbc/appDS
```

Mental model:

```text
Application logical name:
  java:comp/env/jdbc/CaseManagementDS

GlassFish physical resource:
  jdbc/appDS

Mapping:
  jdbc/CaseManagementDS -> jdbc/appDS
```

---

### 3.3 Kenapa Harus Ada Dua Level?

Karena ini memungkinkan:

- aplikasi portable antar environment;
- resource fisik berbeda di DEV/UAT/PROD;
- nama internal aplikasi stabil;
- deployment descriptor mengontrol mapping;
- app tidak hard-code nama resource production;
- tim runtime bisa mengganti pool/resource tanpa mengubah kode.

Contoh:

```text
DEV:
  jdbc/CaseManagementDS -> jdbc/devCaseDS

UAT:
  jdbc/CaseManagementDS -> jdbc/uatCaseDS

PROD:
  jdbc/CaseManagementDS -> jdbc/prodCaseDS
```

Application code tetap sama.

---

## 4. Namespace JNDI Jakarta EE

Jakarta EE mendefinisikan beberapa namespace penting.

```text
java:comp
java:module
java:app
java:global
```

Masing-masing punya scope.

---

## 5. `java:comp` dan `java:comp/env`

`java:comp` adalah namespace component.

`java:comp/env` adalah environment naming context untuk komponen tertentu.

Contoh:

```text
java:comp/env/jdbc/CaseManagementDS
java:comp/env/mail/NotificationSession
java:comp/env/ejb/CaseService
```

Scope:

```text
satu component
```

Dalam web application, component bisa berupa servlet/filter/listener/resource class tergantung konteks container.

Karakteristik:

- paling umum untuk resource reference;
- logical name biasanya berada di `java:comp/env`;
- cocok untuk isolasi dependency;
- menghindari collision antar aplikasi;
- sering digunakan oleh descriptor `web.xml`, `ejb-jar.xml`.

Contoh lookup:

```java
DataSource ds = (DataSource) new InitialContext()
    .lookup("java:comp/env/jdbc/CaseManagementDS");
```

Contoh injection:

```java
@Resource(name = "jdbc/CaseManagementDS")
private DataSource dataSource;
```

Secara konseptual, `name` di atas sering mengacu ke environment entry/reference dalam `java:comp/env`.

---

## 6. `java:module`

`java:module` adalah namespace untuk satu module.

Contoh module:

- satu WAR;
- satu EJB-JAR;
- satu module dalam EAR.

Nama dalam `java:module` bisa dipakai untuk berbagi antar komponen dalam module yang sama.

Contoh konseptual:

```text
java:module/env/SomeConfig
java:module/SomeBean
```

Scope:

```text
seluruh module
```

Kapan berguna:

- beberapa komponen dalam WAR/EJB-JAR perlu reference yang sama;
- ingin menghindari global name;
- binding tidak perlu terlihat keluar module.

---

## 7. `java:app`

`java:app` adalah namespace untuk satu application, terutama relevan untuk EAR multi-module.

Contoh:

```text
java:app/ejb/CaseWorkflowService
java:app/env/CommonConfig
```

Scope:

```text
seluruh aplikasi / EAR
```

Kapan berguna:

- WAR dalam EAR perlu memanggil EJB-JAR dalam EAR yang sama;
- beberapa module berbagi dependency logical;
- ingin cross-module binding tanpa global exposure.

Mental model:

```text
EAR: regulatory-suite.ear
  |
  |-- case-web.war
  |-- case-ejb.jar
  |-- common-ejb.jar

java:app namespace visible across modules in the EAR
```

---

## 8. `java:global`

`java:global` adalah namespace portable global untuk aplikasi/module tertentu.

Contoh EJB portable global name secara konseptual:

```text
java:global/regulatory-suite/case-ejb/CaseServiceBean!com.example.CaseService
```

Scope:

```text
global within application server namespace
```

Kapan berguna:

- explicit lookup antar app/module;
- remote/local EJB reference tertentu;
- debugging dan portability;
- ketika nama global dibutuhkan oleh external app di server yang sama.

Risiko:

- nama panjang;
- coupling ke nama app/module/bean/interface;
- refactor nama artifact bisa memutus lookup;
- global exposure lebih rawan collision dibanding scoped reference.

---

## 9. GlassFish / Server Global JNDI Names

Selain namespace portable `java:*`, GlassFish juga punya JNDI names untuk resource runtime.

Contoh:

```text
jdbc/appDS
jms/CaseQueueConnectionFactory
jms/CaseSubmissionQueue
mail/NotificationSession
eis/LegacyAdapter
```

Nama-nama ini biasanya dibuat oleh admin command.

Contoh:

```bash
asadmin create-jdbc-resource --connectionpoolid appPool jdbc/appDS
asadmin create-jms-resource --restype jakarta.jms.Queue jms/CaseSubmissionQueue
```

Catatan:

- global resource name bukan selalu portable antar server;
- application reference sebaiknya memetakan logical name ke physical resource;
- untuk aplikasi kecil, direct lookup ke physical JNDI name sering dilakukan;
- untuk aplikasi besar, mapping logical lebih maintainable.

---

## 10. Resource Reference

Resource reference adalah deklarasi bahwa aplikasi membutuhkan resource tertentu, tetapi resource fisik dapat disediakan oleh runtime.

Contoh di `web.xml`:

```xml
<resource-ref>
    <description>Main application datasource</description>
    <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

Lalu mapping GlassFish-specific:

```xml
<glassfish-web-app>
    <resource-ref>
        <res-ref-name>jdbc/CaseManagementDS</res-ref-name>
        <jndi-name>jdbc/appDS</jndi-name>
    </resource-ref>
</glassfish-web-app>
```

Mental model:

```text
App asks:
  java:comp/env/jdbc/CaseManagementDS

GlassFish maps:
  jdbc/CaseManagementDS -> jdbc/appDS

GlassFish resource:
  jdbc/appDS -> appPool -> DB
```

---

## 11. Kenapa Resource Reference Lebih Baik daripada Direct Global Lookup?

Direct global lookup:

```java
@Resource(lookup = "jdbc/prodAppDS")
DataSource ds;
```

Masalah:

- kode tahu nama resource production;
- sulit ganti nama resource;
- sulit multi-environment;
- kurang portable;
- testing lebih sulit.

Resource reference:

```java
@Resource(name = "jdbc/CaseManagementDS")
DataSource ds;
```

Descriptor mapping:

```text
jdbc/CaseManagementDS -> jdbc/prodAppDS
```

Kelebihan:

- kode stabil;
- mapping environment-specific;
- deployment lebih fleksibel;
- role app/runtime lebih bersih;
- review config lebih jelas.

---

## 12. Resource Injection vs Explicit Lookup

### 12.1 Resource Injection

Contoh:

```java
@Resource(name = "jdbc/CaseManagementDS")
private DataSource dataSource;
```

Kelebihan:

- declarative;
- container-managed;
- lebih bersih;
- mudah dilihat dependency-nya;
- cocok untuk managed component.

Kekurangan:

- hanya bekerja pada container-managed object;
- failure bisa muncul saat deployment/startup;
- tidak cocok untuk object yang dibuat manual dengan `new`;
- kadang opaque saat debugging.

---

### 12.2 Explicit Lookup

Contoh:

```java
InitialContext ctx = new InitialContext();
DataSource ds = (DataSource) ctx.lookup("java:comp/env/jdbc/CaseManagementDS");
```

Kelebihan:

- explicit;
- bisa dilakukan conditional/dynamic;
- berguna untuk library legacy;
- berguna untuk debugging.

Kekurangan:

- stringly-typed;
- error runtime;
- mudah salah namespace;
- sulit refactor;
- cenderung menyebar di kode.

Rekomendasi:

```text
Default: gunakan injection untuk managed component.
Gunakan lookup explicit untuk boundary legacy, factory, atau diagnostic utility.
Jangan sebarkan lookup string di seluruh codebase.
```

---

## 13. Environment Entry

Environment entry adalah value konfigurasi sederhana dari deployment descriptor.

Contoh:

```xml
<env-entry>
    <env-entry-name>feature/maxOpenCases</env-entry-name>
    <env-entry-type>java.lang.Integer</env-entry-type>
    <env-entry-value>50</env-entry-value>
</env-entry>
```

Lookup:

```java
Integer maxOpenCases = (Integer) new InitialContext()
    .lookup("java:comp/env/feature/maxOpenCases");
```

Kapan berguna:

- legacy Jakarta EE config;
- config kecil yang tied to deployment;
- environment-specific descriptor override.

Kapan tidak ideal:

- config sering berubah;
- config banyak;
- secret;
- feature flag dynamic;
- cloud-native config management.

Untuk aplikasi modern, environment entry sering digantikan oleh:

- MicroProfile Config;
- environment variables;
- external config service;
- config map;
- framework config.

Tetapi memahami env-entry penting untuk legacy GlassFish.

---

## 14. EJB Reference dan Cross-Module Binding

Dalam aplikasi EAR, WAR sering memanggil EJB dalam module lain.

Struktur:

```text
regulatory-suite.ear
  |
  |-- web.war
  |-- case-services.jar
```

WAR bisa butuh EJB:

```java
@EJB
private CaseWorkflowService caseWorkflowService;
```

Atau descriptor:

```xml
<ejb-ref>
    <ejb-ref-name>ejb/CaseWorkflowService</ejb-ref-name>
    <ejb-ref-type>Session</ejb-ref-type>
    <remote>com.example.CaseWorkflowService</remote>
</ejb-ref>
```

GlassFish perlu resolve EJB reference ke actual EJB.

Ada beberapa cara:

1. by type/interface jika tidak ambigu;
2. by bean name;
3. explicit mapped name / lookup;
4. descriptor mapping.

Failure umum:

```text
More than one EJB matches interface.
EJB not found.
Interface mismatch.
Local vs remote mismatch.
Module not packaged in EAR.
EJB name changed after refactor.
```

---

## 15. Portable EJB Global Names

Untuk EJB, Jakarta EE mendefinisikan portable JNDI naming.

Pola umum:

```text
java:global[/<app-name>]/<module-name>/<bean-name>[!<fully-qualified-interface-name>]
java:app/<module-name>/<bean-name>[!<fully-qualified-interface-name>]
java:module/<bean-name>[!<fully-qualified-interface-name>]
```

Contoh:

```text
java:global/regulatory-suite/case-services/CaseWorkflowBean!com.example.CaseWorkflowService
java:app/case-services/CaseWorkflowBean!com.example.CaseWorkflowService
java:module/CaseWorkflowBean!com.example.CaseWorkflowService
```

Gunakan yang paling sempit scope-nya:

```text
same bean/module:
  java:module

same EAR:
  java:app

outside app/server global:
  java:global
```

Prinsip:

> Semakin global nama, semakin besar coupling dan collision surface.

---

## 16. EAR Cross-Module Mental Model

EAR adalah application boundary.

```text
EAR
  |
  |-- application.xml
  |-- lib/
  |-- web.war
  |-- services.jar
  |-- batch.jar
```

Namespace:

```text
java:comp
  per component

java:module
  per WAR/EJB-JAR

java:app
  shared within EAR

java:global
  visible globally
```

Dependency ideal:

```text
web.war
  -> java:app/services/CaseServiceBean

batch.jar
  -> java:app/services/CaseServiceBean

outside app
  -> avoid if possible, or java:global carefully
```

---

## 17. Naming Collision

Collision bisa terjadi ketika:

- dua resource memakai nama JNDI sama;
- dua aplikasi expose global name sama;
- EJB bean name sama dalam scope yang sama;
- descriptor mapping salah target;
- app lama dan baru deploy bersamaan dengan nama sama;
- versioned deployment tidak mengubah app/module name;
- library mencoba bind name sendiri.

Contoh:

```text
App A expects jdbc/appDS -> DB_A
App B expects jdbc/appDS -> DB_B
```

Jika keduanya pakai global resource name yang sama, salah satu bisa salah resource atau deployment gagal.

Solusi:

```text
Gunakan naming convention:
  jdbc/<system>/<bounded-context>/<purpose>

Contoh:
  jdbc/aceas/case/main
  jdbc/aceas/audit/main
  jdbc/cpds/case/main
```

---

## 18. Resource Target dan Naming

Di GlassFish, resource bisa ditargetkan ke:

- server;
- instance;
- cluster;
- config.

JNDI name bisa ada di config, tetapi resource harus tersedia untuk target tempat aplikasi berjalan.

Failure:

```text
Resource jdbc/appDS exists on server target.
Application deployed to cluster1.
cluster1 instances cannot resolve jdbc/appDS.
```

Gejala:

```text
NameNotFoundException
Resource not found
Deployment failed
Injection failed
```

Diagnosis:

```bash
asadmin list-jdbc-resources
asadmin list-jdbc-resources --target cluster1
asadmin list-resources --target cluster1
asadmin get resources.jdbc-resource.jdbc/appDS.*
```

Mental model:

```text
Resource existence is not enough.
Resource must exist in the target namespace where the application runs.
```

---

## 19. `glassfish-resources.xml`

`glassfish-resources.xml` bisa digunakan untuk mendeklarasikan resources bersama aplikasi.

Contoh konseptual:

```xml
<resources>
    <jdbc-connection-pool
        name="appPool"
        res-type="javax.sql.DataSource"
        datasource-classname="oracle.jdbc.pool.OracleDataSource">
        <property name="user" value="APP_USER"/>
        <property name="password" value="${ALIAS=appDbPassword}"/>
        <property name="URL" value="jdbc:oracle:thin:@//db:1521/service"/>
    </jdbc-connection-pool>

    <jdbc-resource
        jndi-name="jdbc/appDS"
        pool-name="appPool"/>
</resources>
```

Kelebihan:

- resource dekat dengan aplikasi;
- repeatable deployment;
- useful untuk dev/test;
- artifact bisa self-describing.

Risiko:

- secret masuk artifact jika tidak hati-hati;
- production resource lifecycle bercampur dengan app lifecycle;
- resource deletion/redeploy bisa berbahaya;
- ops governance bisa lemah;
- per-environment override perlu jelas.

Rekomendasi:

```text
DEV/test:
  glassfish-resources.xml bisa sangat membantu.

PROD:
  lebih sering resource dibuat via controlled provisioning/asadmin/IaC,
  lalu app hanya memetakan logical ref ke existing resource.
```

---

## 20. Naming untuk JDBC

Recommended pattern:

```text
Logical app reference:
  jdbc/<bounded-context>/<purpose>

Physical GlassFish resource:
  jdbc/<system>/<env>/<bounded-context>/<purpose>
```

Contoh:

```text
App logical:
  jdbc/case/main
  jdbc/audit/main
  jdbc/reporting/read

Physical:
  jdbc/aceas/prod/case/main
  jdbc/aceas/prod/audit/main
  jdbc/aceas/prod/reporting/read
```

Mapping:

```text
jdbc/case/main -> jdbc/aceas/prod/case/main
```

Kenapa tidak cukup `jdbc/appDS`?

Karena pada sistem enterprise besar:

- banyak aplikasi;
- banyak schema;
- banyak module;
- banyak environment;
- banyak pool read/write;
- ada audit/reporting/batch;
- ada migration/blue-green.

Nama terlalu generik akan menjadi utang operasional.

---

## 21. Naming untuk JMS

Contoh logical reference:

```text
jms/case/submissionQueue
jms/case/escalationQueue
jms/notification/emailQueue
jms/case/connectionFactory
```

Physical resource:

```text
jms/aceas/prod/case/submissionQueue
jms/aceas/prod/case/connectionFactory
```

JMS punya dua jenis umum:

- connection factory;
- destination queue/topic.

Jangan campur:

```text
jms/case/connectionFactory
  -> factory untuk membuat koneksi

jms/case/submissionQueue
  -> destination queue
```

Failure umum:

```text
lookup queue name tapi mapping ke connection factory
lookup factory tapi expected destination
destination ada tapi connection factory salah broker
target resource tidak sama dengan app target
```

---

## 22. Naming untuk Mail Session

Contoh:

```text
mail/notification
mail/no-reply
mail/support
```

Mail session biasanya menyimpan:

- host;
- port;
- auth;
- username/password;
- TLS property;
- from address convention.

Jangan menyimpan password plaintext. Gunakan alias/secret flow.

---

## 23. Naming untuk Connector Resource

Contoh:

```text
eis/mainframe/customer
eis/erp/payment
eis/legacy/case-sync
```

Connector resource penting pada integrasi enterprise karena:

- resource adapter bisa memiliki banyak connection factory;
- ada admin object;
- ada transaction mode;
- ada security credential;
- ada work manager.

Nama harus mencerminkan:

```text
system / capability / purpose
```

Bukan hanya:

```text
eis/adapter1
```

---

## 24. JNDI Debugging dengan `asadmin`

Beberapa command berguna:

```bash
asadmin list-jndi-entries
asadmin list-jndi-entries --context java:global
asadmin list-jdbc-resources
asadmin list-jms-resources
asadmin list-resources
asadmin get resources.*
```

Catatan:

- command dan opsi bisa berbeda antar versi;
- selalu cek target;
- output JNDI bisa panjang;
- beberapa binding hanya muncul saat app deployed/enabled.

Diagnosis umum:

```bash
# Apakah resource ada?
asadmin list-jdbc-resources

# Apakah resource ada pada target?
asadmin list-jdbc-resources --target server

# Apakah pool terkait ada?
asadmin list-jdbc-connection-pools

# Apakah app deployed?
asadmin list-applications

# Apakah resource JNDI terlihat?
asadmin list-jndi-entries
```

---

## 25. Diagnosing `NameNotFoundException`

Error:

```text
javax.naming.NameNotFoundException: No object bound to name java:comp/env/jdbc/CaseManagementDS
```

Atau pada Jakarta-era code tetap exception class bisa dari `javax.naming` karena JNDI adalah Java SE package.

Checklist:

```text
1. Apakah nama lookup benar?
2. Apakah memakai prefix java:comp/env yang benar?
3. Apakah resource-ref dideklarasikan?
4. Apakah mapping descriptor ada?
5. Apakah physical JNDI resource ada?
6. Apakah resource ditargetkan ke server/cluster tempat app berjalan?
7. Apakah app redeployed setelah descriptor change?
8. Apakah descriptor berada di lokasi benar?
9. Apakah case-sensitive mismatch?
10. Apakah resource disabled?
```

---

## 26. Diagnosing Wrong Resource

Lebih berbahaya dari not found adalah salah resource.

Contoh:

```text
App berhasil connect,
tetapi ke DB UAT, bukan PROD.
```

Gejala:

- data tidak sesuai;
- audit masuk schema salah;
- batch memproses data environment lain;
- prod app mengakses non-prod DB;
- compliance incident.

Checklist:

```text
1. Print/log datasource metadata secara aman saat startup? 
2. Cek JDBC URL di pool config.
3. Cek mapping logical -> physical resource.
4. Cek target resource.
5. Cek secret alias menunjuk credential mana.
6. Cek DNS/tnsnames/connection string.
7. Cek environment promotion script.
```

Pattern aman:

```text
Startup validation:
  - environment name
  - DB service name
  - schema/user
  - non-sensitive connection metadata
```

Jangan log password.

---

## 27. Descriptor Precedence dan Drift

Sumber konfigurasi naming bisa berasal dari:

- annotation;
- standard descriptor;
- GlassFish descriptor;
- server resource config;
- `glassfish-resources.xml`;
- `asadmin` command;
- admin console manual change.

Masalah:

```text
Annotation says A.
web.xml says B.
glassfish-web.xml maps B to C.
Server has C and D.
Admin console changed C last week.
CI/CD assumes D.
```

Top engineer harus membuat konfigurasi menjadi eksplisit dan audit-able.

Prinsip:

```text
One logical dependency should have one documented mapping path.
```

Untuk aplikasi besar, buat table:

| Logical Name | Type | Physical JNDI | Pool/Target | Owner | Env |
|---|---|---|---|---|---|
| jdbc/case/main | DataSource | jdbc/aceas/prod/case/main | appPoolCase | Platform | PROD |
| jms/case/submissionQueue | Queue | jms/aceas/prod/case/submissionQueue | OpenMQ | Platform | PROD |

---

## 28. JNDI dan Classloading

JNDI lookup bisa berhasil, tapi cast gagal.

Contoh:

```text
ClassCastException: com.sun.gjc.spi.jdbc40.DataSource40 cannot be cast to javax.sql.DataSource
```

Atau:

```text
ClassCastException because same interface loaded by different classloader
```

Kemungkinan:

- duplicate API jar di `WEB-INF/lib`;
- aplikasi membawa Jakarta/Java EE API yang seharusnya provided;
- driver/resource class ditempatkan di lokasi salah;
- `javax`/`jakarta` mismatch;
- custom resource adapter punya classloading issue.

Prinsip:

```text
Naming resolution and type compatibility are two different problems.
```

JNDI menjawab:

```text
Can I find object by name?
```

Classloading menjawab:

```text
Can my application type system use this object?
```

---

## 29. JNDI dan Transaction Context

Resource yang didapat dari JNDI biasanya container-managed.

Contoh:

```java
@Resource(name = "jdbc/case/main")
DataSource ds;
```

Jika digunakan dalam transaction container:

```text
EJB @TransactionAttribute(REQUIRED)
  |
  | uses DataSource from GlassFish
  |
  | connection enlisted into transaction
```

Jika menggunakan driver manual:

```java
DriverManager.getConnection(...)
```

Maka kamu bypass banyak layanan container:

- pooling GlassFish;
- transaction enlistment;
- monitoring pool;
- validation/leak detection;
- centralized credential;
- target resource config.

Prinsip:

> Untuk aplikasi GlassFish, resource external utama sebaiknya diperoleh dari container-managed resource, bukan dibuat manual sembarangan.

---

## 30. Naming dan Testability

Masalah aplikasi enterprise lama:

```java
new InitialContext().lookup("java:comp/env/jdbc/app")
```

tersebar di banyak class.

Ini sulit dites.

Pattern lebih baik:

```java
public class CaseRepository {
    private final DataSource dataSource;

    public CaseRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }
}
```

Boundary container:

```java
@ApplicationScoped
public class DataSourceProducer {
    @Resource(name = "jdbc/case/main")
    private DataSource dataSource;

    @Produces
    public DataSource dataSource() {
        return dataSource;
    }
}
```

Dengan ini:

```text
JNDI/injection hanya di boundary.
Business code menerima dependency biasa.
Testing mudah.
Naming tidak bocor ke domain logic.
```

---

## 31. Naming Convention Enterprise

Naming convention harus menjawab:

```text
Resource ini milik sistem apa?
Environment apa?
Bounded context apa?
Purpose apa?
Read/write?
Internal/external?
```

Format contoh:

```text
<type>/<system>/<env>/<context>/<purpose>
```

Contoh:

```text
jdbc/aceas/prod/case/write
jdbc/aceas/prod/case/read
jdbc/aceas/prod/audit/write
jms/aceas/prod/case/submissionQueue
jms/aceas/prod/notification/emailQueue
mail/aceas/prod/no-reply
eis/aceas/prod/mainframe/customer
```

Logical app name bisa lebih environment-neutral:

```text
jdbc/case/write
jdbc/case/read
jms/case/submissionQueue
mail/no-reply
```

Mapping environment:

```text
jdbc/case/write -> jdbc/aceas/prod/case/write
```

---

## 32. Naming Anti-Patterns

### Anti-pattern 1 — Nama Terlalu Generik

```text
jdbc/app
jdbc/main
jdbc/db
jms/queue
```

Masalah:

- collision;
- tidak jelas owner;
- sulit audit;
- salah mapping mudah terjadi.

---

### Anti-pattern 2 — Environment Hardcoded di Code

```java
@Resource(lookup = "jdbc/aceas/prod/case/write")
```

Masalah:

- artifact tidak portable;
- test environment berbahaya;
- deployment salah bisa fatal.

---

### Anti-pattern 3 — Direct Global Name untuk Semua Hal

```text
Semua app lookup java:global/...
```

Masalah:

- coupling besar;
- refactor sulit;
- collision surface besar;
- tidak jelas boundary.

---

### Anti-pattern 4 — Lookup Tersebar

```java
new InitialContext().lookup(...)
```

di puluhan class.

Masalah:

- sulit test;
- sulit refactor;
- string duplication;
- debugging susah.

---

### Anti-pattern 5 — Resource Ada Tapi Salah Target

Resource dibuat di `server`, app deploy ke `cluster1`.

Masalah:

- works in DEV single server;
- fails in UAT/PROD cluster.

---

### Anti-pattern 6 — Descriptor Mapping Tidak Direview

Descriptor dianggap file teknis, padahal bisa menentukan resource production mana yang dipakai.

---

## 33. Production Readiness Checklist untuk Naming/JNDI

```text
[Resource Inventory]
- Semua resource JNDI terdokumentasi.
- Semua pool/resource punya owner.
- Semua logical app reference dipetakan ke physical resource.
- Nama resource mengikuti convention.

[Target]
- Resource tersedia pada target yang sama dengan app.
- Cluster/instance target sudah dicek.
- No orphan resource.

[Descriptor]
- web.xml / ejb-jar.xml / application.xml valid.
- glassfish-web.xml / glassfish-ejb-jar.xml / glassfish-application.xml valid.
- Descriptor tidak mengandung secret plaintext.
- Mapping environment-specific jelas.

[Classloading]
- Tidak ada duplicate Jakarta/Java EE API jar.
- JDBC driver ditempatkan benar.
- Resource adapter class tersedia di scope benar.

[Security]
- Resource credential memakai alias/secret flow.
- Naming tidak expose sensitive info.
- Admin access untuk ubah resource dibatasi.

[Testing]
- Smoke test lookup resource.
- Smoke test DB metadata non-sensitive.
- Smoke test JMS destination send/receive jika perlu.
- Negative test missing/wrong role/resource.
```

---

## 34. Incident Playbook: Application Fails Deploy karena Resource Not Found

Symptom:

```text
Deployment failed.
Resource reference jdbc/CaseManagementDS not found.
```

Langkah:

```text
1. Cek exact name dari error.
2. Tentukan apakah itu logical name atau physical JNDI name.
3. Cek descriptor standard.
4. Cek GlassFish descriptor mapping.
5. Cek apakah physical resource ada.
6. Cek target resource.
7. Cek app target.
8. Cek typo/case sensitivity.
9. Cek apakah resource dibuat setelah deployment.
10. Redeploy setelah mapping diperbaiki.
```

Command:

```bash
asadmin list-applications
asadmin list-jdbc-resources
asadmin list-jdbc-resources --target <target>
asadmin list-jdbc-connection-pools
asadmin get resources.jdbc-resource.*
```

---

## 35. Incident Playbook: Works in DEV, Fails in UAT

Kemungkinan:

```text
DEV standalone server.
UAT cluster.
Resource hanya dibuat di server default.
App deployed to cluster.
```

Atau:

```text
DEV direct lookup jdbc/appDS.
UAT resource name jdbc/uat/appDS.
Descriptor mapping tidak sesuai.
```

Atau:

```text
DEV includes driver jar in app.
UAT expects driver in server lib.
Classloading differs.
```

Diagnosis:

```text
Compare:
- app artifact hash
- descriptor content
- resource list
- target list
- pool config
- driver placement
- GlassFish version
- JDK version
```

---

## 36. Incident Playbook: Lookup Sukses, Tapi DB Salah

Langkah:

```text
1. Cek JDBC URL di pool config.
2. Cek password alias/credential user.
3. Cek DB session current schema/user.
4. Cek service name/SID.
5. Cek DNS resolution dari server.
6. Cek environment-specific deployment script.
7. Cek apakah app memakai direct lookup yang bypass mapping.
8. Cek whether old resource still exists with same name.
```

Tambahkan startup check aman:

```java
try (Connection c = dataSource.getConnection();
     PreparedStatement ps = c.prepareStatement(
         "select sys_context('USERENV','CURRENT_SCHEMA') from dual")) {
    ...
}
```

Untuk Oracle, jangan log detail sensitif. Untuk DB lain, gunakan query metadata yang aman.

---

## 37. Deep Mental Model: Binding Graph

Jangan lihat JNDI sebagai string. Lihat sebagai graph:

```text
Application Component
  |
  | requires logical ref
  v
java:comp/env/jdbc/case/main
  |
  | mapped by descriptor/runtime
  v
jdbc/aceas/prod/case/main
  |
  | points to
  v
JDBC Connection Pool appCasePool
  |
  | uses
  v
Driver class + URL + credential alias
  |
  | connects to
  v
Database service/schema
```

Jika ada incident, cari edge mana yang salah:

```text
component -> logical ref
logical ref -> physical JNDI
physical JNDI -> pool
pool -> driver/config
driver/config -> external system
```

---

## 38. Mini Exercise

Desain naming untuk sistem berikut:

```text
Sistem: ACEAS
Environment: PROD
Modules:
- application-web.war
- case-ejb.jar
- audit-ejb.jar
- notification-ejb.jar

Resources:
- Oracle main case DB, read/write
- Oracle audit DB, write-heavy
- Reporting read replica
- JMS queue for case submission
- JMS queue for email notification
- SMTP mail session no-reply
```

Tentukan:

1. logical resource names di aplikasi;
2. physical GlassFish JNDI names;
3. mapping logical -> physical;
4. target resource jika aplikasi deploy ke cluster;
5. mana yang boleh ada di `glassfish-resources.xml`;
6. mana yang harus diprovision via `asadmin`/IaC;
7. startup validation apa yang perlu dibuat;
8. failure apa yang paling berbahaya.

Contoh jawaban awal:

```text
Logical:
  jdbc/case/write
  jdbc/audit/write
  jdbc/reporting/read
  jms/case/submissionQueue
  jms/notification/emailQueue
  mail/no-reply

Physical:
  jdbc/aceas/prod/case/write
  jdbc/aceas/prod/audit/write
  jdbc/aceas/prod/reporting/read
  jms/aceas/prod/case/submissionQueue
  jms/aceas/prod/notification/emailQueue
  mail/aceas/prod/no-reply
```

---

## 39. Top 1% Takeaways

1. **JNDI adalah runtime address space**, bukan sekadar API lookup lama.
2. **Logical reference dan physical resource harus dipisahkan.**
3. **`java:comp/env` cocok untuk dependency logical component.**
4. **`java:app` berguna untuk cross-module EAR binding.**
5. **`java:global` powerful tapi meningkatkan coupling.**
6. **Resource existence tidak cukup; resource harus tersedia pada target yang benar.**
7. **Naming issue sering terlihat sebagai deployment failure, 500 runtime, atau wrong environment access.**
8. **Wrong resource lebih berbahaya daripada missing resource.**
9. **Injection lebih baik dari lookup tersebar, tapi lookup tetap berguna di boundary legacy/diagnostic.**
10. **JNDI harus direview sebagai graph: logical ref → physical name → pool/resource → external system.**

---

## 40. Referensi

Referensi utama:

- Eclipse GlassFish Application Development Guide, Release 8  
  https://glassfish.org/docs/latest/application-development-guide.html

- Eclipse GlassFish Application Deployment Guide, Release 8  
  https://glassfish.org/docs/latest/application-deployment-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Jakarta EE Platform Specification  
  https://jakarta.ee/specifications/platform/

- Jakarta Enterprise Beans Specification  
  https://jakarta.ee/specifications/enterprise-beans/

- Jakarta Annotations Specification  
  https://jakarta.ee/specifications/annotations/

---

## 41. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 19 — Resource Adapter / JCA Engineering
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-017.md">⬅️ Part 17 — Security Runtime: Realm, Principal, Role Mapping, TLS, Admin Security, dan Secret Handling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-019.md">Part 19 — Resource Adapter / JCA Engineering ➡️</a>
</div>
