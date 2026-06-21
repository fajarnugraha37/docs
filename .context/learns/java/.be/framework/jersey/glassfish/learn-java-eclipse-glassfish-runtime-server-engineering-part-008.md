# learn-java-eclipse-glassfish-runtime-server-engineering-part-008
# Part 8 — Deployment Model: WAR, EAR, EJB-JAR, RAR, App Client, dan Deployment Descriptor

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: `008 / 034`  
> Status seri: **belum selesai**  
> Fokus: memahami deployment GlassFish sebagai kontrak antara artifact, descriptor, target runtime, classloader, resource, security, transaction, dan operasional release.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas classloading. Itu penting karena setelah aplikasi di-*deploy*, GlassFish tidak hanya “menaruh file WAR/EAR ke folder tertentu”, tetapi:

1. membaca struktur artifact,
2. membaca metadata standar Jakarta EE,
3. membaca extension descriptor GlassFish,
4. melakukan annotation scanning,
5. membangun deployment graph,
6. membuat classloader universe,
7. menghubungkan resource reference ke resource aktual,
8. mengaktifkan container terkait,
9. mendaftarkan endpoint, EJB, listener, timer, JMS endpoint, dan JNDI binding,
10. menyimpan application state di domain,
11. mengaktifkan aplikasi pada target tertentu.

Jadi deployment adalah **proses negosiasi kontrak** antara:

- artifact aplikasi,
- spesifikasi Jakarta EE,
- descriptor,
- GlassFish runtime,
- resource yang tersedia,
- target server/cluster,
- konfigurasi domain,
- dan ekspektasi operasional release.

Top 1% engineer tidak melihat deployment sebagai “upload WAR lalu jalan”. Ia melihat deployment sebagai **state transition**:

```text
artifact built
  -> artifact validated
  -> metadata parsed
  -> dependencies resolved
  -> resources bound
  -> containers initialized
  -> endpoints exposed
  -> app enabled
  -> traffic routed
  -> app monitored
```

Jika salah satu transisi gagal, masalahnya harus bisa dilokalisasi.

---

## 1. Mental Model: Deployment Bukan Copy File

Deployment di GlassFish dapat dipahami sebagai pipeline:

```text
Input:
  WAR / EAR / EJB-JAR / RAR / App Client / directory

Runtime reads:
  - archive structure
  - MANIFEST.MF
  - standard descriptors
  - GlassFish descriptors
  - annotations
  - libraries
  - resource references
  - persistence units
  - security constraints
  - EJB metadata
  - connector metadata
  - web metadata

Runtime creates:
  - application registry entry
  - generated artifacts
  - classloader hierarchy
  - JNDI bindings
  - web context
  - servlet/filter/listener registration
  - EJB component model
  - CDI bean archive graph
  - JPA provider integration
  - connector pools
  - transaction/resource bindings
  - security role mappings
```

Output:

```text
Application is either:
  - deployed and enabled
  - deployed but disabled
  - partially failed
  - rejected before activation
  - redeployed over previous version
  - undeployed and removed from runtime registry
```

Deployment harus dipikirkan sebagai **activation protocol**.

---

## 2. Deployment Artifact yang Didukung

GlassFish secara tradisional mendukung beberapa jenis artifact enterprise.

### 2.1 WAR — Web Application Archive

WAR adalah artifact untuk web module.

Umumnya berisi:

```text
my-web.war
├── index.html
├── WEB-INF/
│   ├── web.xml
│   ├── glassfish-web.xml
│   ├── classes/
│   └── lib/
```

WAR dapat berisi:

- Servlet,
- Filter,
- Listener,
- Jakarta REST endpoint jika runtime membawa JAX-RS/Jersey,
- CDI beans,
- Jakarta Security integration,
- JSP/Facelets,
- static assets,
- web-level descriptor,
- application libraries.

GlassFish akan mengikat WAR ke **context root**.

Contoh:

```text
hello.war -> /hello
admin-console.war -> /admin-console
ROOT.war -> /
```

Namun context root dapat dipengaruhi oleh:

1. nama file artifact,
2. `application.xml` jika WAR berada di EAR,
3. `glassfish-web.xml`,
4. opsi `asadmin deploy --contextroot`,
5. default context path dari spec tertentu,
6. konfigurasi deployment tool.

### 2.2 EAR — Enterprise Application Archive

EAR adalah container untuk beberapa module.

Contoh:

```text
my-enterprise-app.ear
├── META-INF/
│   ├── application.xml
│   ├── glassfish-application.xml
│   └── MANIFEST.MF
├── lib/
│   ├── common-domain.jar
│   └── shared-utils.jar
├── web-module.war
├── service-module.jar
├── scheduler-ejb.jar
└── connector.rar
```

EAR berguna ketika aplikasi memiliki:

- beberapa WAR,
- EJB module,
- shared library internal,
- deployment unit yang harus dikelola bersama,
- cross-module references,
- satu deployment lifecycle untuk banyak module.

EAR sering muncul di aplikasi enterprise lama dan sistem government/regulatory karena:

- separation of module,
- reuse EJB/domain service,
- strict packaging,
- deployment atomicity,
- vendor descriptor,
- centralized security mapping.

Tetapi EAR juga membawa risiko:

- classloader lebih kompleks,
- redeploy lebih berat,
- dependency conflict lebih sulit,
- hotfix satu module bisa memaksa redeploy seluruh EAR,
- migrasi `javax` ke `jakarta` lebih mahal.

### 2.3 EJB-JAR

EJB-JAR adalah module yang berisi Enterprise JavaBeans.

Contoh:

```text
case-workflow-ejb.jar
├── META-INF/
│   ├── ejb-jar.xml
│   └── glassfish-ejb-jar.xml
└── com/example/casework/
    ├── CaseAssignmentBean.class
    ├── EscalationTimerBean.class
    └── ApprovalServiceBean.class
```

Dapat berisi:

- stateless session bean,
- stateful session bean,
- singleton bean,
- message-driven bean,
- timer service,
- interceptors,
- transaction metadata,
- security metadata.

Di GlassFish, EJB-JAR dapat di-deploy:

- standalone,
- sebagai module di dalam EAR.

Untuk sistem modern, EJB-JAR standalone semakin jarang, tetapi masih penting untuk memahami:

- timer behavior,
- transaction boundary,
- remote EJB,
- MDB/JMS integration,
- legacy enterprise integration.

### 2.4 RAR — Resource Adapter Archive

RAR adalah artifact untuk Jakarta Connectors / JCA.

Contoh:

```text
legacy-mainframe-adapter.rar
├── META-INF/
│   └── ra.xml
└── adapter-classes-and-libs
```

RAR digunakan untuk membuat connector ke external enterprise system.

Dapat menyediakan:

- outbound connection,
- inbound message endpoint,
- connection pooling,
- work manager integration,
- transaction integration,
- security contract.

RAR biasanya muncul pada integrasi:

- mainframe,
- ERP,
- messaging system,
- custom protocol,
- legacy transaction system.

RAR bukan sekadar library. Ia adalah **managed integration component**. Runtime ikut mengelola lifecycle, pool, transaction, dan thread contract-nya.

### 2.5 Application Client

Application client adalah artifact untuk client Jakarta EE yang berjalan di luar server tetapi menggunakan service dari server.

Di sistem modern ini jarang digunakan. Namun konsepnya penting untuk memahami sejarah application server:

```text
enterprise client process
  -> application client container
  -> remote EJB / naming / security / transaction support
```

Dalam arsitektur modern, peran ini sering digantikan oleh:

- REST client,
- gRPC client,
- messaging client,
- CLI tool,
- frontend SPA,
- service-to-service HTTP.

---

## 3. Deployment Input: Archive vs Directory

GlassFish dapat mendeploy archive atau exploded directory.

### 3.1 Archive Deployment

Contoh:

```bash
asadmin deploy target/myapp.war
asadmin deploy target/myapp.ear
```

Kelebihan:

- artifact immutable,
- mudah diberi checksum,
- cocok untuk CI/CD,
- mudah disimpan di artifact repository,
- lebih auditable,
- cocok untuk release promotion.

Kekurangan:

- perlu rebuild/repackage untuk perubahan kecil,
- inspect manual sedikit kurang nyaman.

### 3.2 Directory Deployment

Contoh konseptual:

```bash
asadmin deploy /opt/apps/myapp-expanded
```

Kelebihan:

- mudah untuk development,
- cepat inspect isi artifact,
- bisa cocok untuk local debugging.

Kekurangan:

- rawan drift,
- rawan file berubah tanpa pipeline,
- sulit audit,
- kurang ideal untuk production,
- ownership/permission bisa menyebabkan bug aneh.

Rule production:

```text
Production should deploy immutable archive artifacts, not mutable exploded directories.
```

---

## 4. Deployment sebagai State Machine

Pikirkan aplikasi di GlassFish memiliki state:

```text
NOT_BUILT
  -> BUILT
  -> VALIDATED
  -> DEPLOYING
  -> DEPLOYED_DISABLED
  -> DEPLOYED_ENABLED
  -> FAILED_DEPLOYMENT
  -> UNDEPLOYING
  -> UNDEPLOYED
```

Namun realitasnya lebih detail:

```text
Artifact exists
  -> checksum verified
  -> server reachable
  -> target exists
  -> resources exist
  -> deployment started
  -> metadata parsed
  -> containers prepared
  -> app registered
  -> app enabled
  -> smoke test passed
  -> traffic enabled
```

Kegagalan dapat terjadi di setiap titik.

Top-level diagnosis selalu bertanya:

```text
Gagal sebelum artifact diterima?
Gagal saat metadata dibaca?
Gagal saat dependency/classloader dibuat?
Gagal saat resource binding?
Gagal saat container initialization?
Gagal setelah endpoint expose?
Gagal hanya saat traffic real masuk?
```

---

## 5. Standard Deployment Descriptors

Descriptor adalah file XML yang menyatakan metadata deployment secara eksplisit.

Di Jakarta EE modern, banyak metadata dapat ditulis dengan annotation. Namun descriptor tetap penting untuk:

- override tanpa mengubah source,
- legacy compatibility,
- security mapping,
- portability,
- explicit enterprise governance,
- audit,
- environment-dependent binding,
- large application consistency.

### 5.1 `web.xml`

Lokasi:

```text
WEB-INF/web.xml
```

Fungsi:

- servlet declaration,
- filter declaration,
- listener declaration,
- servlet mapping,
- welcome file,
- error page,
- session config,
- security constraint,
- login config,
- env entry,
- resource reference,
- context param.

Contoh minimal:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.0">
    <display-name>case-web</display-name>

    <session-config>
        <session-timeout>30</session-timeout>
    </session-config>

    <welcome-file-list>
        <welcome-file>index.html</welcome-file>
    </welcome-file-list>
</web-app>
```

Pada aplikasi legacy Java EE 8, namespace masih `http://xmlns.jcp.org/xml/ns/javaee` dan API masih `javax.*`.

### 5.2 `application.xml`

Lokasi:

```text
META-INF/application.xml
```

Fungsi:

- mendefinisikan module dalam EAR,
- menentukan web context root,
- mendefinisikan application-level metadata.

Contoh:

```xml
<application xmlns="https://jakarta.ee/xml/ns/jakartaee"
             version="10">
    <display-name>aceas-case-management</display-name>

    <module>
        <web>
            <web-uri>case-web.war</web-uri>
            <context-root>/case</context-root>
        </web>
    </module>

    <module>
        <ejb>case-service-ejb.jar</ejb>
    </module>
</application>
```

Tanpa `application.xml`, server dapat melakukan auto-discovery, tetapi untuk aplikasi enterprise besar, explicit descriptor sering lebih mudah diaudit.

### 5.3 `ejb-jar.xml`

Lokasi:

```text
META-INF/ejb-jar.xml
```

Fungsi:

- EJB declaration,
- transaction attribute,
- security role,
- interceptor,
- method permission,
- message-driven destination binding abstraction.

Contoh konseptual:

```xml
<ejb-jar xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="4.0">
    <enterprise-beans>
        <session>
            <ejb-name>CaseApprovalService</ejb-name>
            <ejb-class>com.example.caseapp.CaseApprovalServiceBean</ejb-class>
            <session-type>Stateless</session-type>
        </session>
    </enterprise-beans>
</ejb-jar>
```

### 5.4 `persistence.xml`

Lokasi:

```text
META-INF/persistence.xml
```

Atau pada WAR:

```text
WEB-INF/classes/META-INF/persistence.xml
```

Fungsi:

- persistence unit,
- datasource reference,
- transaction type,
- provider,
- entity classes,
- properties.

Contoh:

```xml
<persistence xmlns="https://jakarta.ee/xml/ns/persistence"
             version="3.1">
    <persistence-unit name="casePU" transaction-type="JTA">
        <jta-data-source>jdbc/CaseDS</jta-data-source>
        <properties>
            <property name="jakarta.persistence.schema-generation.database.action" value="none"/>
        </properties>
    </persistence-unit>
</persistence>
```

Catatan penting:

- `persistence.xml` adalah deployment contract dengan JPA provider.
- Jika datasource tidak tersedia di target deployment, aplikasi dapat gagal saat deploy atau saat runtime tergantung timing initialization.
- Untuk production, jangan biarkan schema generation aktif sembarangan.

### 5.5 `ra.xml`

Lokasi:

```text
META-INF/ra.xml
```

Fungsi:

- mendeskripsikan resource adapter,
- connection factory,
- transaction support,
- authentication mechanism,
- inbound/outbound contract,
- admin object.

RAR deployment sangat bergantung pada `ra.xml`.

---

## 6. GlassFish-Specific Deployment Descriptors

Standard descriptor menjelaskan kontrak portable Jakarta EE. GlassFish descriptor menjelaskan kebutuhan runtime GlassFish.

Contoh:

```text
glassfish-web.xml
glassfish-application.xml
glassfish-ejb-jar.xml
glassfish-resources.xml
```

### 6.1 Kapan Vendor Descriptor Diperlukan?

Gunakan vendor descriptor jika butuh:

- mapping role ke group/principal,
- context root override,
- classloader behavior,
- resource mapping,
- JNDI binding,
- EJB-specific runtime setting,
- GlassFish-specific web behavior,
- deployment-time resource creation.

Jangan gunakan vendor descriptor untuk hal yang bisa dilakukan portable dengan baik, kecuali ada alasan operasional yang kuat.

### 6.2 `glassfish-web.xml`

Lokasi:

```text
WEB-INF/glassfish-web.xml
```

Contoh:

```xml
<glassfish-web-app>
    <context-root>/case</context-root>

    <class-loader delegate="true"/>

    <security-role-mapping>
        <role-name>case-officer</role-name>
        <group-name>CASE_OFFICER</group-name>
    </security-role-mapping>
</glassfish-web-app>
```

Fungsi umum:

- context root,
- classloader delegate,
- security role mapping,
- session manager detail,
- JSP config tertentu,
- resource mapping.

### 6.3 `glassfish-application.xml`

Lokasi:

```text
META-INF/glassfish-application.xml
```

Fungsi:

- application-level runtime config,
- classloader/library behavior,
- security role mapping,
- resource binding.

### 6.4 `glassfish-ejb-jar.xml`

Lokasi:

```text
META-INF/glassfish-ejb-jar.xml
```

Fungsi:

- EJB runtime mapping,
- JNDI name,
- resource reference mapping,
- MDB destination binding,
- pool/cache/runtime behavior tertentu.

### 6.5 `glassfish-resources.xml`

Lokasi umum:

```text
WEB-INF/glassfish-resources.xml
META-INF/glassfish-resources.xml
```

Fungsi:

- mendefinisikan resource yang akan dibuat saat deployment,
- JDBC resource,
- connection pool,
- JMS resource,
- mail resource,
- custom resource.

Contoh konseptual:

```xml
<resources>
    <jdbc-connection-pool name="CasePool"
                          datasource-classname="oracle.jdbc.pool.OracleDataSource"
                          res-type="javax.sql.DataSource">
        <property name="URL" value="jdbc:oracle:thin:@//dbhost:1521/CASEDB"/>
        <property name="User" value="case_user"/>
        <property name="Password" value="${ALIAS=case.db.password}"/>
    </jdbc-connection-pool>

    <jdbc-resource pool-name="CasePool"
                   jndi-name="jdbc/CaseDS"/>
</resources>
```

Catatan production:

```text
Resource embedded dalam artifact bisa convenient, tetapi untuk production environment besar sering lebih aman resource dikelola terpisah oleh platform/infrastructure pipeline.
```

Jika artifact membuat resource sendiri, boundary ownership harus jelas.

---

## 7. Annotation Scanning vs Descriptor Explicitness

Jakarta EE modern mengandalkan annotation.

Contoh:

```java
@WebServlet("/cases")
public class CaseServlet extends HttpServlet {
}
```

```java
@Stateless
public class CaseApprovalService {
}
```

```java
@MessageDriven
public class CaseEventConsumer implements MessageListener {
}
```

Ini membuat development cepat, tetapi deployment runtime harus melakukan scanning.

### 7.1 Apa yang Di-scan?

GlassFish dapat perlu memeriksa:

- class di `WEB-INF/classes`,
- jar di `WEB-INF/lib`,
- EJB classes,
- CDI bean archives,
- entity classes,
- REST resources,
- Servlet annotations,
- interceptors,
- listeners,
- provider classes.

Pada aplikasi besar, scanning dapat mempengaruhi:

- startup time,
- redeploy time,
- memory,
- failure surface,
- classloading behavior.

### 7.2 Descriptor Explicitness

Descriptor explicit berguna jika:

- aplikasi sangat besar,
- startup time penting,
- compliance butuh audit,
- mapping harus terlihat tanpa membaca source,
- metadata perlu diubah tanpa compile ulang,
- tim berbeda mengelola source dan deployment.

Namun terlalu banyak XML juga berisiko:

- config source terpecah,
- annotation dan descriptor konflik,
- maintenance berat,
- developer tidak melihat runtime behavior dari code.

### 7.3 Mental Model

Gunakan prinsip:

```text
Annotation = local intent dekat source code.
Descriptor = deployment governance dan runtime override.
GlassFish descriptor = vendor-specific operational binding.
```

---

## 8. `metadata-complete`

Pada beberapa descriptor, ada konsep `metadata-complete`.

Contoh pada `web.xml`:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.0"
         metadata-complete="true">
</web-app>
```

Makna sederhananya:

```text
Runtime tidak perlu memakai annotation tertentu untuk melengkapi metadata module ini.
```

Keuntungan:

- scanning lebih terkendali,
- behavior lebih explicit,
- cocok untuk legacy/regulated apps.

Risiko:

- annotation yang developer kira aktif ternyata diabaikan,
- servlet/filter/listener tidak terdaftar,
- security annotation tidak berlaku sesuai ekspektasi,
- deployment behavior berbeda antara local dan server.

Rule:

```text
metadata-complete=true hanya aman jika descriptor benar-benar lengkap dan menjadi source of truth.
```

---

## 9. Deployment Target

Deployment tidak hanya menentukan “apa artifact-nya”, tetapi juga “ke mana artifact aktif”.

Target dapat berupa:

```text
server
instance
cluster
domain-level target tertentu
```

Contoh:

```bash
asadmin deploy --target server target/case.war
asadmin deploy --target case-cluster target/case.ear
```

### 9.1 Mengapa Target Penting?

Karena resource, application, dan config bisa berbeda per target.

Misalnya:

```text
case-app deployed to cluster A
jdbc/CaseDS only created on server
=> app fails on cluster target
```

Atau:

```text
app deployed to case-cluster
new instance added to cluster
resource target missing or config drift
=> instance fails to serve app correctly
```

### 9.2 Targeting Anti-Pattern

Anti-pattern umum:

```text
Deploy app to cluster, but create JDBC resource only on DAS/default server.
```

Atau:

```text
Deploy to one instance manually during emergency, forget cluster-level deployment.
```

Atau:

```text
Resource exists in DEV globally, but in UAT only on server target.
```

Top-level deployment script harus memvalidasi:

- target exists,
- target type correct,
- resource exists on same target,
- app not already deployed with conflicting name,
- context root not already used,
- virtual server available,
- ports/listeners active.

---

## 10. Naming: Application Name, Module Name, Context Root

GlassFish deployment melibatkan beberapa nama.

### 10.1 Artifact File Name

```text
target/case-management-1.4.2.war
```

### 10.2 Application Name

Nama deployment di runtime.

Contoh:

```bash
asadmin deploy --name case-management target/case-management-1.4.2.war
```

Jika tidak disetel, nama sering diturunkan dari artifact.

### 10.3 Context Root

URL path untuk web module.

Contoh:

```bash
asadmin deploy --name case-management --contextroot /case target/case.war
```

### 10.4 Module Name

Dalam EAR, module bisa memiliki nama sendiri.

```text
case-web.war
case-ejb.jar
case-batch.jar
```

### 10.5 Kenapa Harus Disiplin?

Karena nama dipakai oleh:

- deployment registry,
- undeploy command,
- monitoring,
- logs,
- JNDI,
- context root,
- CI/CD,
- rollback,
- support runbook.

Gunakan pola stabil:

```text
Application name: case-management
Artifact name:    case-management-1.4.2+build.78.war
Context root:     /case
```

Jangan biarkan runtime name berubah setiap versi:

```text
case-management-1.4.1
case-management-1.4.2
case-management-1.4.3
```

Kecuali memang memakai versioned parallel deployment dengan strategi jelas.

---

## 11. Command Deployment Dasar

### 11.1 Deploy WAR

```bash
asadmin deploy target/case.war
```

Dengan nama dan context root explicit:

```bash
asadmin deploy \
  --name case-management \
  --contextroot /case \
  target/case.war
```

### 11.2 Deploy EAR

```bash
asadmin deploy \
  --name case-suite \
  target/case-suite.ear
```

### 11.3 Deploy ke Cluster

```bash
asadmin deploy \
  --target case-cluster \
  --name case-suite \
  target/case-suite.ear
```

### 11.4 Deploy Disabled

```bash
asadmin deploy \
  --enabled=false \
  --name case-management \
  target/case.war
```

Pola ini berguna untuk:

```text
deploy first
validate registry/resources
enable later during release window
```

### 11.5 Enable / Disable

```bash
asadmin disable case-management
asadmin enable case-management
```

Dengan target:

```bash
asadmin disable --target case-cluster case-management
asadmin enable  --target case-cluster case-management
```

### 11.6 Undeploy

```bash
asadmin undeploy case-management
```

Dengan target:

```bash
asadmin undeploy --target case-cluster case-management
```

### 11.7 List Applications

```bash
asadmin list-applications
asadmin list-applications --type web
```

Gunakan ini di pipeline untuk state inspection.

---

## 12. Redeploy, Force Deploy, dan Risiko State Loss

### 12.1 Force Deploy

```bash
asadmin deploy --force=true target/case.war
```

Makna:

```text
Jika aplikasi dengan nama sama sudah ada, deploy ulang.
```

Ini convenient, tetapi berisiko jika digunakan sembarangan.

Risiko:

- session hilang,
- in-flight request gagal,
- classloader lama belum bersih,
- resource re-binding,
- timer restart,
- background job duplicate,
- temporary 503/500,
- app state berubah tanpa precheck.

### 12.2 Redeploy sebagai State Transition

Redeploy bukan sekadar replace file:

```text
old app active
  -> stop/disable old components
  -> unload old classloader
  -> remove old bindings
  -> parse new artifact
  -> create new classloader
  -> bind resources
  -> initialize containers
  -> enable new app
```

Jika ada leak di static reference, ThreadLocal, JDBC driver, custom thread, atau third-party library, classloader lama bisa tertahan.

### 12.3 Production Rule

Untuk production, hindari deployment script seperti:

```bash
asadmin deploy --force=true target/app.war
```

tanpa:

- checksum,
- version record,
- precheck,
- backup/rollback artifact,
- smoke test,
- access log validation,
- health check,
- traffic control.

Lebih baik:

```text
1. validate target
2. validate resource
3. deploy disabled or deploy to inactive target
4. enable/switch traffic
5. smoke test
6. monitor
7. rollback if needed
```

---

## 13. Versioned Deployment

Beberapa application server mendukung bentuk versioned application deployment. Secara konsep:

```text
case-management:v1
case-management:v2
```

atau:

```text
case-management#1.4.1
case-management#1.4.2
```

Tujuan:

- parallel version availability,
- controlled switch,
- rollback lebih cepat,
- reduce downtime.

Namun pada aplikasi web dengan context root sama, tetap perlu mengatur:

- context root collision,
- session compatibility,
- database schema compatibility,
- background jobs,
- timer duplication,
- JMS consumer duplication,
- cache key compatibility.

Top-level rule:

```text
Parallel deployment aman hanya jika aplikasi benar-benar didesain untuk coexist.
```

Jika dua versi mengonsumsi queue yang sama atau menjalankan timer yang sama, Anda bisa menciptakan duplicate processing.

---

## 14. Deployment Order dalam EAR

EAR dapat berisi banyak module. Deployment order penting karena:

- shared library harus tersedia,
- EJB reference harus resolvable,
- persistence unit harus valid,
- resource reference harus bound,
- web module mungkin depend ke EJB module,
- CDI bean discovery lintas module punya boundary tertentu.

Contoh:

```text
case-suite.ear
├── lib/domain.jar
├── case-ejb.jar
├── case-web.war
└── notification-ejb.jar
```

Deployment runtime akan membangun application graph, bukan sekadar deploy berurutan seperti shell script.

Namun failure sering terlihat seperti:

```text
web module failed
```

padahal root cause:

```text
EJB module failed because datasource not found
```

atau:

```text
CDI ambiguity in shared EAR lib
```

atau:

```text
JPA persistence unit failed to bootstrap
```

Saat membaca log deployment EAR, cari **first meaningful cause**, bukan exception terakhir.

---

## 15. Library Placement dalam Deployment

Ini menghubungkan Part 7 dengan Part 8.

### 15.1 WAR Library

```text
WEB-INF/lib
```

Library hanya untuk WAR tersebut.

### 15.2 EAR Library

```text
EAR/lib
```

Library shared oleh module dalam EAR.

### 15.3 Server/Domain Library

Dikelola di luar artifact.

Digunakan untuk:

- JDBC driver,
- shared platform library tertentu,
- custom realm/extension,
- resource adapter dependency.

### 15.4 Rule

```text
Business/application libraries should travel with the application artifact.
Platform/runtime libraries should be managed by the server/domain.
Jakarta EE API jars should usually not be bundled inside app artifacts.
```

### 15.5 Common Mistake

Bundling these inside WAR/EAR:

```text
jakarta.servlet-api.jar
jakarta.ejb-api.jar
jakarta.transaction-api.jar
jakarta.persistence-api.jar
```

Risiko:

- class collision,
- LinkageError,
- provider mismatch,
- server API override attempt,
- subtle annotation scanning issue.

---

## 16. Resource Binding dalam Deployment

Aplikasi sering tidak langsung menggunakan resource aktual. Ia menggunakan reference.

Contoh code:

```java
@Resource(lookup = "jdbc/CaseDS")
DataSource dataSource;
```

Atau `persistence.xml`:

```xml
<jta-data-source>jdbc/CaseDS</jta-data-source>
```

Atau descriptor:

```xml
<resource-ref>
    <res-ref-name>jdbc/CaseDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

Runtime harus memastikan:

```text
reference name -> actual GlassFish resource -> pool -> driver -> database
```

Jika binding gagal, error dapat muncul:

- saat deployment,
- saat first request,
- saat JPA persistence unit initialization,
- saat EJB invocation,
- saat scheduled/timer job berjalan.

### 16.1 Resource Precheck

Sebelum deploy:

```bash
asadmin list-jdbc-resources
asadmin list-jdbc-connection-pools
asadmin ping-connection-pool CasePool
```

Untuk JMS:

```bash
asadmin list-jms-resources
```

Untuk JNDI:

```bash
asadmin list-jndi-entries
```

### 16.2 Deployment Resource Contract

Setiap aplikasi production seharusnya punya manifest operasional:

```yaml
application: case-management
requires:
  jdbc:
    - jdbc/CaseDS
  jms:
    - jms/CaseEventQueue
    - jms/CaseConnectionFactory
  mail:
    - mail/NotificationSession
  security:
    - realm: corp-realm
  env:
    - CASE_FEATURE_X_ENABLED
  ports:
    - contextRoot: /case
```

Ini bukan harus YAML literal, tapi harus ada sebagai kontrak eksplisit.

---

## 17. Security Mapping dalam Deployment

Deployment juga menghubungkan role aplikasi dengan principal/group runtime.

Application code/spec mungkin punya:

```java
@RolesAllowed("case-officer")
```

Atau `web.xml`:

```xml
<security-role>
    <role-name>case-officer</role-name>
</security-role>
```

GlassFish perlu tahu:

```text
role "case-officer" maps to which group/principal?
```

Vendor descriptor dapat melakukan mapping:

```xml
<security-role-mapping>
    <role-name>case-officer</role-name>
    <group-name>CASE_OFFICER</group-name>
</security-role-mapping>
```

Failure mode:

```text
Login success, but user gets 403.
```

Root cause bisa:

- role declared but not mapped,
- external IdP group name mismatch,
- case-sensitive group mismatch,
- default principal-to-role mapping disabled,
- wrong realm,
- stale session after deployment,
- descriptor not included,
- app deployed to target with different security realm config.

Deployment checklist harus mencakup security mapping.

---

## 18. Context Root dan URL Exposure

Context root adalah bagian public contract aplikasi.

Contoh:

```text
https://example.gov.sg/aceas/case
```

Di GlassFish, context root bisa berasal dari beberapa tempat. Untuk WAR standalone, sering dari nama WAR. Untuk EAR, bisa dari `application.xml`. Bisa juga di-override.

### 18.1 Context Root Collision

Jika dua web app memakai context root sama:

```text
/case
/case
```

server harus menolak atau conflict.

Dalam cluster/release, collision juga bisa terjadi karena:

- app lama belum undeploy,
- app baru memakai context root sama,
- versioned deployment tidak disiapkan,
- context root otomatis berubah dari nama artifact.

### 18.2 Reverse Proxy Caveat

Jika GlassFish di belakang nginx/ALB/API gateway:

```text
External: /aceas/case
Internal: /case
```

Maka deployment context root harus sinkron dengan proxy rewrite rule.

Masalah umum:

- redirect salah path,
- cookie path salah,
- generated absolute URL salah,
- login callback salah,
- static asset 404,
- CORS/callback mismatch.

Deployment bukan hanya server internal. Ia harus cocok dengan exposure topology.

---

## 19. Virtual Server

GlassFish dapat memiliki virtual server. Web app dapat ditargetkan ke virtual server tertentu.

Mental model:

```text
network listener
  -> HTTP service
  -> virtual server
  -> web app context root
```

Virtual server berguna untuk:

- multi-host deployment,
- admin/user separation,
- internal/external app separation,
- different access logs,
- different web properties.

Failure mode:

```text
App deployed successfully but URL returns 404.
```

Penyebab:

- app deployed to different virtual server,
- request Host header maps to virtual server without app,
- reverse proxy Host header berubah,
- listener/virtual-server mapping salah.

Checklist:

```text
Is the app deployed?
Is it enabled?
On which target?
On which virtual server?
What host/header reaches GlassFish?
What context root?
```

---

## 20. Deployment Generated Artifacts

GlassFish dapat menghasilkan artifact internal saat deployment.

Contoh area:

```text
domains/domain1/generated/
domains/domain1/applications/
```

Generated artifacts dapat terkait:

- compiled JSP,
- generated stubs,
- enhanced classes,
- deployment metadata,
- temporary files,
- expanded archive.

Masalah:

- stale generated artifact,
- permission error,
- disk full,
- failed cleanup after failed deploy,
- old generated class survives redeploy,
- corrupted domain state.

Production diagnosis:

```text
If deployment behaves impossibly, inspect domain applications/generated/cache directories carefully — but do not manually mutate production state without backup and clear reasoning.
```

---

## 21. Deployment Failure Taxonomy

### 21.1 Artifact-Level Failure

Contoh:

- file missing,
- corrupt WAR/EAR,
- invalid ZIP,
- wrong permission,
- unsupported Java bytecode,
- built with Java 25 but server runs Java 17,
- missing manifest/classpath dependency.

Symptoms:

```text
Invalid archive
Unsupported class file major version
Class format error
```

### 21.2 Descriptor-Level Failure

Contoh:

- malformed XML,
- wrong namespace,
- schema mismatch,
- wrong descriptor version,
- conflicting metadata,
- old `javax` descriptor on Jakarta EE runtime,
- invalid element.

Symptoms:

```text
Deployment descriptor parsing error
Invalid deployment descriptor
```

### 21.3 Classloading Failure

Contoh:

- missing class,
- duplicate class,
- API jar bundled,
- `javax`/`jakarta` mismatch,
- provider mismatch.

Symptoms:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
LinkageError
ClassCastException between same class name
```

### 21.4 Resource Binding Failure

Contoh:

- datasource not found,
- pool not found,
- JMS destination missing,
- mail resource missing,
- JNDI mismatch.

Symptoms:

```text
NameNotFoundException
Resource not found
Failed to look up JNDI
Persistence unit failed
```

### 21.5 Container Initialization Failure

Contoh:

- CDI unsatisfied dependency,
- ambiguous bean,
- EJB deployment failure,
- JPA entity mapping error,
- Servlet listener throws exception,
- startup singleton fails,
- timer initialization fails.

Symptoms:

```text
Exception during lifecycle processing
CDI deployment failure
EJB container initialization error
PersistenceException
```

### 21.6 Environment Failure

Contoh:

- DB unavailable,
- DNS issue,
- external service unavailable,
- keystore missing,
- file path missing,
- insufficient permission,
- disk full.

Symptoms:

```text
Connection refused
Timeout
SSLHandshakeException
AccessDeniedException
No space left on device
```

### 21.7 Activation Failure

Contoh:

- context root conflict,
- port/listener unavailable,
- virtual server mismatch,
- app disabled,
- target mismatch.

Symptoms:

```text
Deployment command succeeded but app not reachable
404 after deployment
503 behind proxy
```

---

## 22. Reading Deployment Logs

Deployment logs often contain a long stack trace. Engineer harus mencari urutan:

```text
1. What command was executed?
2. Which target?
3. Which app name?
4. Which module failed?
5. What was the first error?
6. Is later exception only wrapper?
7. Is it deployment-time or runtime-time?
8. Does error mention class/resource/descriptor/container?
```

### 22.1 Wrapper Exception Pattern

Sering terlihat:

```text
DeploymentException
  caused by MultiException
    caused by UnsatisfiedResolutionException
```

Root cause biasanya paling dalam atau first meaningful cause, bukan wrapper paling luar.

### 22.2 Module-Specific Failure

Pada EAR, log bisa menyebut:

```text
Exception while loading the app : CDI deployment failure: ...
```

Tetapi harus dicari module:

```text
case-web.war?
case-ejb.jar?
shared lib?
```

### 22.3 First Meaningful Cause

Contoh:

```text
java.lang.NoClassDefFoundError: jakarta/servlet/http/HttpServlet
```

Jangan langsung perbaiki deployment command. Itu classpath/version mismatch.

Contoh:

```text
javax.persistence.PersistenceException: Exception [EclipseLink-4002]
```

Jangan langsung perbaiki JPA mapping. Bisa jadi datasource/DB unavailable.

---

## 23. Deployment Precheck Framework

Sebelum deploy, validasi:

### 23.1 Artifact

```text
- exists?
- correct extension?
- correct version?
- checksum matches?
- built from expected commit?
- built with compatible Java target?
- no forbidden API jars?
- SBOM available?
```

### 23.2 Server

```text
- domain running?
- target exists?
- admin reachable?
- disk sufficient?
- heap/metaspace sufficient?
- ports/listeners healthy?
- secure admin configured?
```

### 23.3 Resources

```text
- JDBC resources exist?
- pools exist?
- ping connection pool success?
- JMS resources exist?
- mail resource exists?
- custom resource exists?
- realm exists?
- keystore/truststore exists?
```

### 23.4 Existing App State

```text
- app already deployed?
- enabled or disabled?
- same context root in use?
- old version running?
- target same as intended?
```

### 23.5 External Dependencies

```text
- DB reachable?
- DNS resolved?
- external API reachable?
- message broker reachable?
- storage path mounted?
```

### 23.6 Release Control

```text
- rollback artifact available?
- DB migration compatibility confirmed?
- traffic control available?
- smoke test available?
- monitoring dashboard ready?
- on-call/support notified?
```

---

## 24. Deployment Script Skeleton

Contoh Bash-style pseudo script.

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="case-management"
ARTIFACT="target/case-management.war"
TARGET="case-cluster"
CONTEXT_ROOT="/case"
POOL="CasePool"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -f "$ARTIFACT" ] || fail "Artifact not found: $ARTIFACT"

asadmin list-clusters | grep -q "^${TARGET}" \
  || fail "Target cluster does not exist: $TARGET"

asadmin list-jdbc-connection-pools | grep -q "^${POOL}" \
  || fail "JDBC pool does not exist: $POOL"

asadmin ping-connection-pool "$POOL" \
  || fail "JDBC pool ping failed: $POOL"

if asadmin list-applications --target "$TARGET" | grep -q "^${APP_NAME}[[:space:]]"; then
  echo "Application already deployed: $APP_NAME"
  echo "Use controlled redeploy path"
  exit 2
fi

asadmin deploy \
  --target "$TARGET" \
  --name "$APP_NAME" \
  --contextroot "$CONTEXT_ROOT" \
  --enabled=false \
  "$ARTIFACT"

asadmin enable --target "$TARGET" "$APP_NAME"

echo "Deployment completed: $APP_NAME"
```

Catatan:

- Ini skeleton, bukan final production script.
- Production script perlu logging, timeout, retry policy terbatas, credential handling, audit record, smoke test, rollback.

---

## 25. Safe Redeploy Skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_NAME="case-management"
NEW_ARTIFACT="target/case-management-1.4.2.war"
OLD_ARTIFACT="/release-store/case-management-1.4.1.war"
TARGET="case-cluster"
CONTEXT_ROOT="/case"

echo "Precheck current deployment"
asadmin list-applications --target "$TARGET" | grep -q "^${APP_NAME}[[:space:]]" \
  || { echo "App not currently deployed"; exit 1; }

echo "Deploying new version with force"
asadmin deploy \
  --target "$TARGET" \
  --name "$APP_NAME" \
  --contextroot "$CONTEXT_ROOT" \
  --force=true \
  "$NEW_ARTIFACT"

echo "Run smoke test here"

# if smoke fails:
# asadmin deploy --target "$TARGET" --name "$APP_NAME" --contextroot "$CONTEXT_ROOT" --force=true "$OLD_ARTIFACT"
```

Namun untuk zero-downtime, force redeploy ke target aktif belum tentu cukup. Lebih aman:

- blue-green,
- canary,
- rolling cluster instance,
- drain traffic,
- external load balancer switch,
- versioned app if safe.

---

## 26. Rollback Model

Rollback bukan “deploy file lama” saja.

Rollback harus mempertimbangkan:

```text
code version
database schema
data migration
JMS message schema
cache schema
session compatibility
external API contract
scheduled jobs
feature flags
configuration
```

### 26.1 Rollback Aman Jika

```text
new code is backward-compatible with old DB
old code is forward-compatible with new DB
messages remain compatible
cache entries are compatible or flushable
no irreversible side effect occurred
```

### 26.2 Rollback Sulit Jika

```text
DB migration destructive
message schema changed incompatibly
new app processed business events differently
new version triggered external side effects
security/session format changed
```

### 26.3 Deployment Decision

Sebelum deploy, jawab:

```text
If this fails after 10 minutes of real traffic, can we rollback?
If yes, how?
If no, what mitigation path exists?
```

---

## 27. Blue-Green dengan GlassFish

Konsep:

```text
Blue  = current active environment
Green = new candidate environment
```

Di GlassFish dapat dilakukan dengan:

- dua domain,
- dua cluster,
- dua node group,
- dua deployment target,
- external load balancer switch.

Flow:

```text
1. Blue serving traffic
2. Deploy new app to Green
3. Run smoke test on Green
4. Switch load balancer to Green
5. Monitor
6. Keep Blue for rollback window
7. Retire Blue
```

Kelebihan:

- rollback cepat,
- deployment tidak mengganggu active traffic,
- safer for large EAR.

Kekurangan:

- butuh resource lebih,
- DB migration harus compatible,
- background job duplication harus dicegah,
- JMS consumers harus dikontrol,
- scheduled timers harus hanya aktif di satu side.

---

## 28. Rolling Deployment di Cluster

Flow:

```text
1. Remove instance A from load balancer
2. Deploy/restart/update instance A
3. Smoke test instance A
4. Add instance A back
5. Repeat for B, C, D
```

Caveat GlassFish:

- app deployment command ke cluster bisa memengaruhi semua instance,
- session replication harus compatible,
- EJB timer/JMS/MDB behavior harus dipahami,
- config synchronization harus konsisten.

Rolling deployment aman jika:

- app stateless,
- DB compatible,
- no duplicate scheduler,
- no incompatible session,
- load balancer supports draining.

---

## 29. Deployment dengan Database Migration

Urutan rilis aplikasi enterprise sering:

```text
1. backup
2. pre-migration validation
3. DB migration backward-compatible
4. deploy app
5. smoke test
6. enable feature
7. cleanup later
```

Hindari:

```text
drop column
deploy app
hope nothing breaks
```

Gunakan expand-contract pattern:

```text
Release N:
  - add nullable column/new table
  - app writes both old and new if needed

Release N+1:
  - app reads new structure

Release N+2:
  - remove old structure
```

GlassFish deployment harus masuk ke release choreography ini.

---

## 30. Deployment dan Background Workload

Aplikasi enterprise tidak hanya HTTP.

Saat deploy/redeploy, perhatikan:

- EJB timers,
- scheduled jobs,
- batch jobs,
- JMS MDB consumers,
- async tasks,
- startup singleton,
- application lifecycle listener,
- custom threads.

Risiko:

```text
Redeploy starts new timer while old timer not fully stopped.
Both old and new consumers process queue briefly.
Startup listener triggers side effect.
Batch job starts during release.
```

Checklist:

```text
Can background work be paused?
Can consumers be disabled?
Can timers be controlled?
Can startup side effects be idempotent?
```

---

## 31. Deployment dan HTTP Session

Jika aplikasi memakai HTTP session:

- redeploy bisa invalidate session,
- rolling deploy bisa memecah session compatibility,
- session serialization dapat gagal,
- class version mismatch dapat merusak replicated session,
- sticky session dapat menyembunyikan masalah.

Rule:

```text
For serious HA deployment, design session data as small, serializable, version-tolerant, and non-critical.
```

Lebih baik:

- stateless where possible,
- externalize state,
- short-lived session,
- explicit re-login behavior,
- avoid storing entity graphs in session.

---

## 32. Deployment dan CDI/JPA Startup Timing

Beberapa error baru terlihat saat deployment karena container eagerly validates metadata.

Contoh:

```java
@Inject
PaymentGateway gateway;
```

Jika ada dua bean candidate:

```text
CDI ambiguous dependency -> deployment failure
```

Contoh JPA:

```xml
<persistence-unit name="casePU">
```

Jika entity mapping invalid:

```text
deployment failure or first EntityManager usage failure
```

Startup timing bisa berbeda tergantung:

- lazy/eager initialization,
- app server version,
- CDI bean discovery mode,
- JPA provider,
- startup singleton,
- validation config,
- annotation scanning.

Top-level rule:

```text
A successful compile does not imply a deployable Jakarta EE application.
A successful deploy does not imply a production-ready application.
```

---

## 33. Deployment Descriptor Conflict Resolution

Konflik dapat terjadi antara:

```text
annotation vs web.xml
annotation vs ejb-jar.xml
standard descriptor vs GlassFish descriptor
application.xml vs asadmin --contextroot
library manifest vs EAR lib
resource-ref vs actual resource
```

Prinsip:

1. Standard spec metadata membentuk contract portable.
2. Vendor descriptor dapat override/melengkapi runtime-specific binding.
3. Deploy command dapat override sebagian deployment-time property.
4. Actual server resource/config tetap menentukan runtime binding final.

Jika behavior tidak sesuai ekspektasi, cari sumber metadata:

```text
Where is this value defined?
- annotation?
- web.xml?
- application.xml?
- glassfish-web.xml?
- glassfish-application.xml?
- asadmin deploy option?
- domain.xml?
- admin console change?
```

---

## 34. Deployment Descriptor dan Namespace Migration

Untuk Java EE 8 / GlassFish 5:

```text
javax.*
http://xmlns.jcp.org/xml/ns/javaee
```

Untuk Jakarta EE modern:

```text
jakarta.*
https://jakarta.ee/xml/ns/jakartaee
```

Masalah umum migrasi:

- source code sudah `jakarta`, descriptor masih `javaee`,
- descriptor version tidak cocok,
- dependency masih membawa `javax`,
- generated classes masih lama,
- third-party library belum migrated,
- old deployment descriptor GlassFish masih mengacu schema/DTD lama.

Checklist migrasi:

```text
scan source imports
scan descriptors
scan generated code
scan dependency tree
scan shaded jars
scan META-INF/services
scan persistence provider config
scan web fragments
```

---

## 35. Deployment Plan dan Environment-Specific Override

Beberapa environment membutuhkan perbedaan:

- context root,
- resource JNDI,
- security group,
- virtual server,
- feature flag,
- endpoint URL.

Tapi artifact sebaiknya tetap sama.

Pattern:

```text
same artifact
different deployment config
```

Cara:

- `asadmin` option,
- GlassFish descriptor,
- resource config per domain,
- environment variables/system properties,
- external config service,
- deployment plan jika digunakan,
- CI/CD parameterization.

Anti-pattern:

```text
Build WAR khusus DEV
Build WAR khusus UAT
Build WAR khusus PROD
```

Kecuali artifact memang berbeda karena branding/module compile-time. Untuk enterprise governance, lebih baik:

```text
One build, many deploys.
```

---

## 36. Application Lifecycle Events

Aplikasi dapat menjalankan logic saat startup/shutdown melalui:

- ServletContextListener,
- CDI observer,
- EJB startup singleton,
- application scoped bean initialization,
- custom framework bootstrap,
- JPA initialization,
- scheduled/timer creation.

Danger zone:

```text
deployment triggers business side effects
```

Contoh buruk:

```text
on startup:
  - send notification
  - run reconciliation
  - create external ticket
  - consume all pending events
```

Startup harus:

- deterministic,
- idempotent,
- bounded time,
- fail-fast jika critical,
- not silently degraded,
- visible in logs,
- not perform irreversible work unless explicitly designed.

---

## 37. Deployment Time vs Runtime Time

Bedakan:

```text
Deployment-time failure:
  app cannot be activated.

Runtime-time failure:
  app activates but fails when used.
```

Contoh deployment-time:

- invalid descriptor,
- CDI ambiguous dependency,
- missing class during scanning,
- context root collision,
- persistence unit eager failure.

Contoh runtime-time:

- datasource password expired discovered at first query,
- external API timeout,
- endpoint bug,
- lazy bean failure,
- specific code path class missing,
- SQL syntax error.

CI/CD smoke test harus menutup gap:

```text
deploy success != release success
```

Minimal smoke test:

- health endpoint,
- DB ping through app,
- login/auth if relevant,
- one read endpoint,
- one write transaction in test mode if possible,
- JMS publish/consume if relevant,
- access log confirms request path.

---

## 38. Deployment Audit Trail

Untuk production/regulatory system, setiap deployment harus menjawab:

```text
What was deployed?
When?
By whom?
From which source commit?
Built by which pipeline?
With which JDK?
With which dependencies?
To which target?
With which config?
What changed from previous release?
What validation passed?
What rollback artifact exists?
```

Ideal metadata:

```yaml
application: case-management
version: 1.4.2
build: 78
commit: a1b2c3d
jdk: 21.0.x
glassfish: 8.0.x
jakarta-ee: 11
artifact:
  file: case-management-1.4.2.war
  sha256: ...
target:
  domain: prod-domain
  cluster: case-cluster
deployment:
  time: 2026-06-21T20:30:00+08:00
  operator: cicd
  method: asadmin deploy
validation:
  smoke: passed
  db-ping: passed
  health: passed
rollback:
  previous-artifact: case-management-1.4.1.war
```

---

## 39. Common Deployment Anti-Patterns

### 39.1 Manual Admin Console Deployment in Production

Masalah:

- tidak repeatable,
- sulit audit,
- rawan salah target,
- config tidak masuk repo,
- rollback tidak jelas.

Admin Console boleh untuk inspection. Production deployment harus scripted.

### 39.2 Artifact Mengandung Semua Library Termasuk API Server

Masalah:

- classloader conflict,
- namespace mismatch,
- `NoSuchMethodError`,
- unpredictable behavior.

### 39.3 `--force=true` sebagai Satu-satunya Release Strategy

Masalah:

- downtime tidak dipahami,
- rollback reaktif,
- session/background job risk,
- no precheck.

### 39.4 Resource Dibuat Manual Per Environment

Masalah:

- DEV jalan, UAT gagal,
- prod config drift,
- resource target salah,
- password alias beda.

### 39.5 Context Root Mengikuti Nama Artifact Versi

Contoh:

```text
case-1.4.2.war -> /case-1.4.2
```

Jika tidak disengaja, public URL berubah setiap release.

### 39.6 Deployment Sukses Dianggap Selesai

Deployment hanya satu step dalam release. Release selesai setelah:

- app reachable,
- smoke test pass,
- metrics normal,
- logs clean,
- business critical path verified.

---

## 40. Top 1% Deployment Review Checklist

### 40.1 Artifact Checklist

```text
[ ] WAR/EAR/RAR built by CI
[ ] source commit known
[ ] dependency tree reviewed
[ ] no forbidden Jakarta EE API jars bundled
[ ] Java bytecode compatible with server JDK
[ ] checksum recorded
[ ] SBOM available
```

### 40.2 Descriptor Checklist

```text
[ ] web.xml/application.xml/ejb-jar.xml valid
[ ] GlassFish descriptors reviewed
[ ] descriptor namespace matches runtime generation
[ ] context root explicit
[ ] role mapping explicit
[ ] resource references explicit
[ ] no stale javax descriptor in jakarta app
```

### 40.3 Target Checklist

```text
[ ] target exists
[ ] correct target type
[ ] app deployed to cluster/server intentionally
[ ] resource target matches app target
[ ] virtual server correct
[ ] context root no collision
```

### 40.4 Resource Checklist

```text
[ ] JDBC pool exists
[ ] JDBC pool ping works
[ ] JMS destination exists
[ ] Mail/session resource exists
[ ] realm exists
[ ] password aliases valid
[ ] external service reachable
```

### 40.5 Runtime Checklist

```text
[ ] heap/metaspace sufficient
[ ] disk sufficient
[ ] generated/applications dirs writable
[ ] logs writable
[ ] ports available
[ ] no old failed deployment state
```

### 40.6 Release Checklist

```text
[ ] rollback artifact exists
[ ] DB migration compatible
[ ] smoke test scripted
[ ] monitoring dashboard ready
[ ] alert suppression/awareness handled
[ ] support/on-call aware
[ ] deployment record stored
```

---

## 41. Practical Exercise 1 — WAR Deployment Contract

Buat sebuah aplikasi WAR sederhana dan definisikan kontraknya:

```text
name: learning-web
contextRoot: /learning
requires:
  jdbc: none
  jms: none
  security: none
```

Deploy:

```bash
asadmin deploy \
  --name learning-web \
  --contextroot /learning \
  target/learning-web.war
```

Validasi:

```bash
asadmin list-applications
curl http://localhost:8080/learning
```

Undeploy:

```bash
asadmin undeploy learning-web
```

Pertanyaan analisis:

```text
Apa nama artifact?
Apa nama deployment?
Apa context root?
Apa target?
Bagaimana cara tahu aplikasi enabled?
Bagaimana cara rollback?
```

---

## 42. Practical Exercise 2 — EAR Deployment Reasoning

Bayangkan EAR:

```text
regulatory-case.ear
├── META-INF/application.xml
├── lib/domain-model.jar
├── case-web.war
├── case-ejb.jar
└── notification-ejb.jar
```

`case-web.war` menggunakan EJB dari `case-ejb.jar`.

Analisis:

```text
Jika case-web gagal deploy karena EJB reference not found, di mana Anda cek?
Jika domain-model.jar ada juga di WEB-INF/lib, risiko apa?
Jika application.xml salah context-root, efeknya apa?
Jika notification-ejb memiliki startup singleton gagal, apakah seluruh EAR gagal?
Jika hanya case-web ingin di-hotfix, apakah EAR packaging membantu atau menyulitkan?
```

Jawaban senior:

- cek `application.xml`,
- cek module names,
- cek EJB global JNDI naming,
- cek classloader duplication,
- cek first meaningful deployment error,
- evaluasi apakah modularity packaging masih cocok.

---

## 43. Practical Exercise 3 — Deployment Failure Classification

Klasifikasikan error berikut:

### Error A

```text
java.lang.UnsupportedClassVersionError:
class file version 65.0, this runtime only recognizes up to 61.0
```

Kategori:

```text
Artifact/JDK compatibility failure.
```

Solusi:

```text
Run server with newer JDK or compile target lower.
```

### Error B

```text
javax.naming.NameNotFoundException: jdbc/CaseDS
```

Kategori:

```text
Resource/JNDI binding failure.
```

Solusi:

```text
Create/target JDBC resource correctly or fix reference name.
```

### Error C

```text
org.jboss.weld.exceptions.DeploymentException:
WELD-001409 Ambiguous dependencies
```

Kategori:

```text
CDI container initialization failure.
```

Solusi:

```text
Resolve bean ambiguity using qualifiers, alternatives, exclusions, or discovery config.
```

### Error D

```text
java.lang.NoSuchMethodError: jakarta.ws.rs.core.Response.status(...)
```

Kategori:

```text
Classloading/dependency version conflict.
```

Solusi:

```text
Remove incompatible bundled API/provider jar; align with GlassFish runtime.
```

### Error E

```text
Application deployed successfully but URL returns 404.
```

Kategori:

```text
Activation/exposure failure.
```

Possible causes:

```text
wrong context root
wrong virtual server
wrong target
app disabled
reverse proxy route mismatch
request hitting different instance
```

---

## 44. Decision Framework: WAR vs EAR vs Split Services

### 44.1 WAR Cocok Jika

```text
- aplikasi web/API relatif mandiri
- deployment ingin sederhana
- service boundary jelas
- tidak butuh banyak EJB module
- modern CI/CD dan container deployment
```

### 44.2 EAR Cocok Jika

```text
- beberapa module harus dirilis atomik
- shared EJB/domain layer kuat
- legacy architecture sudah EAR
- procurement/enterprise standard meminta full app server packaging
- cross-module transaction/security perlu dikelola bersama
```

### 44.3 RAR Cocok Jika

```text
- integrasi enterprise butuh managed connector
- butuh transaction/security/thread contract dengan server
- sistem eksternal legacy/proprietary
```

### 44.4 Split Service Lebih Cocok Jika

```text
- module punya lifecycle berbeda
- scaling needs berbeda
- team ownership berbeda
- downtime isolation penting
- komunikasi bisa via API/event
```

Rule:

```text
Packaging should reflect operational lifecycle, not just code organization.
```

---

## 45. Key Takeaways

1. Deployment GlassFish adalah **activation pipeline**, bukan copy file.
2. WAR, EAR, EJB-JAR, RAR, dan App Client punya lifecycle dan runtime implication berbeda.
3. Descriptor adalah kontrak metadata; annotation adalah local source intent; vendor descriptor adalah runtime-specific binding.
4. Deployment target sangat penting karena app, resource, dan config harus berada pada boundary yang sama.
5. Context root, application name, module name, dan artifact name harus dikelola eksplisit.
6. `--force=true` bukan deployment strategy; itu hanya command option.
7. Deployment success bukan release success.
8. Rollback harus dipikirkan sebelum deploy, bukan setelah insiden.
9. Banyak error deployment sebenarnya adalah classloading, resource binding, namespace migration, atau target mismatch.
10. Top-level engineer mendesain deployment sebagai state machine yang repeatable, observable, auditable, dan reversible.

---

## 46. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

- Eclipse GlassFish Application Deployment Guide, Release 8  
  https://glassfish.org/docs/latest/application-deployment-guide.html

- Eclipse GlassFish User Guides / Documentation Index  
  https://glassfish.org/docs/

- GlassFish Reference Manual — `deploy` command  
  https://glassfish.org/docs/5.1.0/reference-manual/deploy.html

- GlassFish Application Deployment Guide — Deploying Applications  
  https://glassfish.org/docs/5.1.0/application-deployment-guide/deploying-applications.html

- GlassFish Application Deployment Guide — Deployment Descriptor Files  
  https://glassfish.org/docs/5.1.0/application-deployment-guide/dd-files.html

- GlassFish Application Deployment Guide — asadmin Deployment Subcommands  
  https://glassfish.org/docs/5.1.0/application-deployment-guide/asadmin-deployment-subcommands.html

---

## 47. Status Seri

Part ini selesai.

Progress:

```text
[x] Part 0  — Orientation
[x] Part 1  — Version Matrix, Compatibility, Migration Map
[x] Part 2  — Installation, Distribution Layout, Runtime Anatomy
[x] Part 3  — Domain Model
[x] Part 4  — asadmin Deep Dive
[x] Part 5  — Admin Console, REST Admin API, Configuration as Code
[x] Part 6  — Bootstrap Lifecycle
[x] Part 7  — Classloading Architecture
[x] Part 8  — Deployment Model
[ ] Part 9  — GlassFish-Specific Descriptors dan Vendor Extension
```

Seri **belum selesai**. Bagian berikutnya adalah:

```text
Part 9 — GlassFish-Specific Descriptors dan Vendor Extension
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-007.md">⬅️ Part 7 — Classloading Architecture: Parent Delegation, Isolation, Libraries, dan Konflik Dependency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-009.md">Part 9 — GlassFish-Specific Descriptors dan Vendor Extension ➡️</a>
</div>
