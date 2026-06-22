# learn-java-eclipse-glassfish-runtime-server-engineering-part-009

# Part 9 — GlassFish-Specific Descriptors dan Vendor Extension

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 9 dari 34  
> Status seri: **belum selesai**  
> Target pembaca: engineer Java enterprise yang sudah memahami Jakarta EE API, tetapi ingin memahami bagaimana aplikasi berkontrak dengan runtime GlassFish secara presisi, aman, portabel, dan production-ready.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas deployment model: WAR, EAR, EJB-JAR, RAR, app client, deployment descriptor standar, target deployment, redeploy, rollback, dan failure taxonomy.

Part ini masuk lebih spesifik ke area yang sering diremehkan tetapi sangat penting di application server enterprise:

**GlassFish-specific deployment descriptors** dan **vendor extension**.

Artinya, kita tidak lagi hanya bertanya:

> “Aplikasi saya valid secara Jakarta EE atau tidak?”

Tetapi juga:

> “Bagaimana aplikasi saya dikawinkan dengan runtime GlassFish tertentu?”

GlassFish mendukung standar Jakarta EE, tetapi ia juga menyediakan descriptor khusus untuk mengatur hal-hal yang tidak selalu diekspresikan oleh descriptor standar. Contoh umum:

- context root web application,
- classloader delegation,
- security role mapping,
- EJB pool/cache behavior,
- JNDI binding,
- resource reference mapping,
- runtime-specific web service binding,
- deployment-time resource definition,
- application-level vendor setting.

Engineer biasa biasanya melihat descriptor vendor sebagai “file XML tambahan”. Engineer senior melihatnya sebagai **adapter contract** antara portable application model dan concrete runtime behavior.

---

## 1. Mental Model Utama: Standard Contract vs Runtime Contract

Dalam Jakarta EE/Java EE application server, ada dua lapis kontrak:

```text
Application source code
        |
        v
Standard Jakarta EE contract
        |
        |  web.xml
        |  application.xml
        |  ejb-jar.xml
        |  persistence.xml
        |  ra.xml
        v
Portable deployment model
        |
        v
GlassFish runtime contract
        |
        |  glassfish-web.xml
        |  glassfish-application.xml
        |  glassfish-ejb-jar.xml
        |  glassfish-resources.xml
        |  glassFish-specific asadmin config
        v
Concrete server behavior
```

Descriptor standar menjawab:

- apa module-nya,
- servlet/filter/listener apa yang ada,
- role apa yang dibutuhkan,
- EJB apa yang dideklarasikan,
- persistence unit apa yang digunakan,
- resource reference apa yang diminta aplikasi.

Descriptor GlassFish menjawab:

- role standar itu dipetakan ke principal/group GlassFish yang mana,
- resource reference portable itu dipetakan ke JNDI resource server yang mana,
- web module ini harus punya context root apa,
- classloader web module harus parent-first atau child-first,
- EJB tertentu perlu pool/cache/timer behavior seperti apa,
- resource apa yang perlu dibuat saat deployment,
- setting runtime apa yang hanya bermakna di GlassFish.

Jadi vendor descriptor bukan sekadar “non-portable config”. Ia adalah tempat di mana keputusan runtime yang tidak cukup portable dinyatakan secara eksplisit.

---

## 2. Kenapa Vendor Descriptor Ada?

Sebelum menyalahkan vendor extension sebagai “tidak portable”, pahami dulu kenapa ia muncul.

Jakarta EE specification sengaja membuat banyak hal tetap abstrak agar aplikasi bisa berjalan di berbagai implementation. Tetapi runtime nyata butuh keputusan konkret:

- Bagaimana nama role aplikasi dipetakan ke principal/group realm?
- Bagaimana JNDI name lokal dipetakan ke resource global?
- Bagaimana web module dalam EAR diberi context root?
- Bagaimana EJB pool dikontrol?
- Bagaimana app client dihubungkan?
- Bagaimana connector/resource dibuat otomatis?
- Bagaimana runtime-specific optimization dinyatakan?

Kalau semua detail runtime dipaksa masuk ke standard descriptor, portability akan menurun karena standar menjadi terlalu vendor-specific. Maka pola yang muncul adalah:

```text
standard descriptor      = semantic intent portable
vendor descriptor        = runtime binding concrete
server/domain config     = infrastructure resource concrete
```

Contoh:

```text
Aplikasi berkata:
"Saya butuh datasource bernama java:comp/env/jdbc/AppDS."

Standard descriptor berkata:
"Ada resource-ref jdbc/AppDS."

GlassFish descriptor berkata:
"jdbc/AppDS dipetakan ke jdbc/prod-orders-ds."

Domain config berkata:
"jdbc/prod-orders-ds adalah pool Oracle dengan host X, user Y, validation Z."
```

Ini pemisahan yang sehat.

---

## 3. Prinsip Besar: Vendor Extension Harus Sadar Risiko

Vendor descriptor tidak buruk. Yang buruk adalah menggunakan vendor descriptor tanpa sadar konsekuensinya.

Gunakan prinsip berikut:

| Prinsip | Makna |
|---|---|
| Prefer standard first | Kalau Jakarta EE standard cukup, jangan pakai extension. |
| Use vendor descriptor for binding | Gunakan extension untuk binding runtime, bukan logika bisnis. |
| Keep environment value outside artifact if possible | Jangan hardcode endpoint, secret, credential, dan env-specific config di artifact. |
| Document non-portable behavior | Setiap vendor extension harus punya alasan. |
| Test migration impact | Descriptor vendor sering menjadi titik patah saat migrasi GlassFish → server lain. |
| Review descriptor like code | Descriptor memengaruhi security, resource, classloading, dan transaction behavior. |

Mental model yang bagus:

> Vendor descriptor adalah konfigurasi executable. Ia memengaruhi runtime behavior sama kuatnya dengan kode Java.

---

## 4. Keluarga Descriptor GlassFish

Dalam konteks GlassFish modern dan legacy, beberapa descriptor penting adalah:

```text
EAR-level:
  META-INF/glassfish-application.xml

WAR-level:
  WEB-INF/glassfish-web.xml

EJB-JAR-level:
  META-INF/glassfish-ejb-jar.xml

Application client:
  META-INF/glassfish-application-client.xml

Resource definition:
  META-INF/glassfish-resources.xml
  WEB-INF/glassfish-resources.xml

Legacy descriptors:
  sun-application.xml
  sun-web.xml
  sun-ejb-jar.xml
  sun-resources.xml
```

Secara historis, nama `sun-*` berasal dari era Sun/Oracle GlassFish. Di GlassFish modern, nama `glassfish-*` adalah bentuk yang lebih tepat.

Prinsip migrasi:

```text
sun-web.xml              -> glassfish-web.xml
sun-application.xml      -> glassfish-application.xml
sun-ejb-jar.xml          -> glassfish-ejb-jar.xml
sun-resources.xml        -> glassfish-resources.xml
```

Dalam project modern, hindari membuat descriptor baru dengan nama `sun-*` kecuali harus mempertahankan compatibility dengan server lama.

---

## 5. Di Mana Descriptor Diletakkan?

Lokasi descriptor penting. Salah tempat berarti descriptor diabaikan.

### 5.1 WAR

```text
my-webapp.war
  WEB-INF/
    web.xml
    glassfish-web.xml
    glassfish-resources.xml   (opsional)
    classes/
    lib/
```

`glassfish-web.xml` berlaku untuk web module tersebut.

### 5.2 EJB-JAR

```text
my-ejb.jar
  META-INF/
    ejb-jar.xml
    glassfish-ejb-jar.xml
```

`glassfish-ejb-jar.xml` berlaku untuk EJB module tersebut.

### 5.3 EAR

```text
my-app.ear
  META-INF/
    application.xml
    glassfish-application.xml
    glassfish-resources.xml   (opsional)
  app-web.war
  app-ejb.jar
  lib/
```

`glassfish-application.xml` berlaku di level enterprise application.

### 5.4 RAR

```text
my-adapter.rar
  META-INF/
    ra.xml
```

Connector/resource adapter punya model descriptor sendiri. GlassFish-specific binding untuk connector biasanya berada pada admin config/resource config, dan beberapa resource dapat didefinisikan lewat `glassfish-resources.xml`.

---

## 6. `glassfish-web.xml`

`glassfish-web.xml` adalah descriptor khusus GlassFish untuk WAR.

Ia biasanya digunakan untuk:

- context root,
- security role mapping,
- servlet principal mapping,
- web service endpoint mapping,
- classloader behavior,
- session manager/runtime behavior,
- cache/web container options,
- resource reference mapping,
- property runtime tertentu.

Contoh minimal:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<glassfish-web-app>
    <context-root>/orders</context-root>
</glassfish-web-app>
```

### 6.1 Context Root

Context root menentukan path awal aplikasi web.

```xml
<glassfish-web-app>
    <context-root>/aceas</context-root>
</glassfish-web-app>
```

Jika WAR bernama `orders.war`, server mungkin memberi context root default `/orders`. Tetapi default berdasarkan nama artifact bisa tidak cukup deterministik untuk production.

Production-grade rule:

> Context root untuk aplikasi penting sebaiknya eksplisit, bukan bergantung pada nama file artifact.

Kenapa?

Karena artifact mungkin diberi version:

```text
orders-1.4.12.war
orders-1.4.13-hotfix.war
orders-2026.06.21.war
```

Jika context root ikut nama artifact, URL production bisa berubah.

Descriptor membuat kontrak lebih stabil:

```text
Artifact name boleh berubah.
Public route tetap /orders.
```

### 6.2 Security Role Mapping

Dalam `web.xml` atau annotation, aplikasi bisa mendeklarasikan role:

```xml
<security-role>
    <role-name>CaseOfficer</role-name>
</security-role>
```

Tetapi server perlu tahu role itu dipetakan ke principal atau group apa.

```xml
<glassfish-web-app>
    <security-role-mapping>
        <role-name>CaseOfficer</role-name>
        <group-name>case-officer-group</group-name>
    </security-role-mapping>
</glassfish-web-app>
```

Mental model:

```text
Application role       = semantic permission concept
Realm group/principal  = identity provider/runtime identity concept
Role mapping           = bridge between both
```

Jangan campur aduk:

- Role aplikasi: `Approver`, `CaseOfficer`, `Admin`
- Group IdP/runtime: `ACEAS_CASE_OFFICER_UAT`, `CN=ACEAS Approver,OU=Groups,...`

Role aplikasi sebaiknya stabil. Group runtime bisa berubah per environment.

### 6.3 Classloader Delegate

GlassFish web module dapat mengatur classloader delegation.

Contoh konseptual:

```xml
<glassfish-web-app>
    <class-loader delegate="true" />
</glassfish-web-app>
```

Default yang aman biasanya parent-first/delegate true.

`delegate="false"` membuat web module mencoba load class dari dirinya dulu sebelum parent untuk banyak class. Ini kadang dipakai untuk menyelesaikan konflik library, tetapi berisiko.

Gunakan `delegate=false` hanya jika benar-benar paham konsekuensinya.

Bahaya:

- API Jakarta/Java EE bisa bentrok,
- class yang sama dimuat oleh classloader berbeda,
- `ClassCastException` meski class name sama,
- library server dan library app berbeda versi,
- EJB/CDI/JPA integration bisa gagal.

Rule:

> Jangan gunakan classloader setting sebagai pengganti dependency hygiene.

Kalau error muncul karena dependency kacau, perbaiki dependency dulu. Classloader override adalah jalan terakhir.

### 6.4 Resource Reference Mapping

Aplikasi portable sering memakai nama resource lokal:

```xml
<resource-ref>
    <res-ref-name>jdbc/AppDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

GlassFish dapat memetakan resource-ref ini ke resource server.

Pola konseptual:

```xml
<glassfish-web-app>
    <resource-ref>
        <res-ref-name>jdbc/AppDS</res-ref-name>
        <jndi-name>jdbc/orders-prod</jndi-name>
    </resource-ref>
</glassfish-web-app>
```

Mental model:

```text
java:comp/env/jdbc/AppDS  -> application-local name
jdbc/orders-prod          -> GlassFish global resource name
JDBC pool                 -> physical DB configuration
```

Keuntungan:

- kode aplikasi tidak tahu nama resource global,
- environment bisa punya mapping berbeda,
- artifact bisa lebih portable.

Namun ada trade-off:

- mapping menjadi GlassFish-specific,
- descriptor harus dijaga per environment atau dibuat generic.

---

## 7. `glassfish-application.xml`

`glassfish-application.xml` adalah descriptor GlassFish di level EAR.

Ia digunakan untuk konfigurasi enterprise application secara keseluruhan, misalnya:

- mapping module,
- security role mapping level aplikasi,
- application-level library/reference,
- runtime behavior yang berlaku untuk EAR,
- resource mapping antar module.

Struktur lokasi:

```text
my-app.ear
  META-INF/
    application.xml
    glassfish-application.xml
```

Contoh konseptual:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<glassfish-application>
    <security-role-mapping>
        <role-name>Admin</role-name>
        <group-name>app-admins</group-name>
    </security-role-mapping>
</glassfish-application>
```

### 7.1 Kapan Mapping di EAR Level?

Gunakan EAR-level mapping jika:

- aplikasi terdiri dari banyak module,
- role yang sama dipakai oleh web dan EJB module,
- ingin role mapping konsisten di seluruh application package.

Jangan gunakan EAR-level mapping jika:

- module independen,
- WAR dideploy sendiri-sendiri,
- mapping harus berbeda per module,
- EAR hanya packaging sementara tanpa boundary domain yang jelas.

### 7.2 EAR sebagai Boundary Deployment

Dalam aplikasi enterprise lama, EAR sering berisi:

```text
case-web.war
case-ejb.jar
case-batch-ejb.jar
case-integration.jar
lib/common-domain.jar
```

Dalam model seperti ini, `glassfish-application.xml` menjadi tempat binding runtime yang berlaku untuk keseluruhan aplikasi.

Namun di arsitektur modern, banyak team meninggalkan EAR dan deploy WAR mandiri. Jika begitu, vendor descriptor level WAR lebih dominan.

---

## 8. `glassfish-ejb-jar.xml`

`glassfish-ejb-jar.xml` adalah descriptor khusus GlassFish untuk EJB module.

Ia bisa digunakan untuk mengatur:

- EJB JNDI name,
- pool stateless session bean,
- cache stateful session bean,
- principal/security mapping,
- resource reference mapping,
- MDB destination mapping,
- transaction/runtime property tertentu,
- commit option/container behavior legacy.

Lokasi:

```text
my-ejb.jar
  META-INF/
    ejb-jar.xml
    glassfish-ejb-jar.xml
```

### 8.1 EJB Pooling

Stateless EJB biasanya menggunakan pool. GlassFish dapat mengatur pool melalui descriptor.

Contoh konseptual:

```xml
<glassfish-ejb-jar>
    <enterprise-beans>
        <ejb>
            <ejb-name>CaseAssignmentService</ejb-name>
            <bean-pool>
                <steady-pool-size>10</steady-pool-size>
                <resize-quantity>5</resize-quantity>
                <max-pool-size>100</max-pool-size>
                <pool-idle-timeout-in-seconds>600</pool-idle-timeout-in-seconds>
            </bean-pool>
        </ejb>
    </enterprise-beans>
</glassfish-ejb-jar>
```

Jangan lihat ini sebagai angka template. Lihat sebagai queue/capacity control.

Mental model:

```text
Incoming invocations
        |
        v
EJB invocation dispatch
        |
        v
Bean pool
        |
        +-- available instance -> execute
        |
        +-- no available instance -> wait/fail depending config/runtime
```

`max-pool-size` terlalu kecil:

- throughput terbatas,
- request menunggu,
- latency naik.

`max-pool-size` terlalu besar:

- DB pool bisa jebol,
- thread contention naik,
- memory meningkat,
- downstream overloaded.

Rule:

> EJB pool harus dikaitkan dengan thread pool, DB pool, transaction timeout, dan downstream capacity.

### 8.2 MDB Mapping

Message-driven bean butuh mapping ke destination fisik.

Aplikasi mendefinisikan semantic consumer. Runtime perlu tahu queue/topic mana yang dipakai.

Contoh konseptual:

```xml
<glassfish-ejb-jar>
    <enterprise-beans>
        <ejb>
            <ejb-name>CaseEventConsumer</ejb-name>
            <mdb-resource-adapter>
                <resource-adapter-mid>jmsra</resource-adapter-mid>
            </mdb-resource-adapter>
            <jndi-name>jms/CaseEventQueue</jndi-name>
        </ejb>
    </enterprise-beans>
</glassfish-ejb-jar>
```

Runtime binding seperti ini menentukan apakah consumer benar-benar membaca queue yang diinginkan.

Failure yang sering terjadi:

- queue belum dibuat,
- JNDI name salah,
- resource adapter tidak tersedia,
- MDB deploy sukses tetapi tidak consume,
- consume queue UAT saat seharusnya SIT,
- concurrency terlalu besar dan downstream overload.

### 8.3 EJB Security Mapping

EJB juga bisa memakai role/security mapping. Jangan asumsikan mapping di web layer otomatis cukup untuk EJB layer dalam semua packaging dan invocation path.

Jika web endpoint memanggil EJB lokal, security context biasanya dipropagasikan. Tetapi jika EJB juga dipanggil remote, timer, MDB, atau app client, boundary security-nya berbeda.

Rule:

> Role mapping harus direview berdasarkan semua entry point, bukan hanya HTTP endpoint.

Entry point EJB bisa berasal dari:

- servlet/JAX-RS,
- remote EJB client,
- timer service,
- MDB,
- application client,
- internal scheduled job.

---

## 9. `glassfish-resources.xml`

`glassfish-resources.xml` memungkinkan definisi resource GlassFish dikemas bersama aplikasi atau digunakan untuk provisioning.

Resource yang sering didefinisikan:

- JDBC connection pool,
- JDBC resource,
- JMS resource,
- connector resource,
- admin object resource,
- mail resource,
- custom resource,
- external JNDI resource.

Contoh konseptual:

```xml
<resources>
    <jdbc-connection-pool
        name="OrdersPool"
        res-type="javax.sql.DataSource"
        datasource-classname="oracle.jdbc.pool.OracleDataSource">
        <property name="URL" value="jdbc:oracle:thin:@//db-host:1521/ORCLPDB1"/>
        <property name="user" value="orders_app"/>
        <property name="password" value="${ALIAS=orders-db-password}"/>
    </jdbc-connection-pool>

    <jdbc-resource
        jndi-name="jdbc/OrdersDS"
        pool-name="OrdersPool" />
</resources>
```

### 9.1 Keuntungan `glassfish-resources.xml`

- Resource definition dekat dengan aplikasi.
- Local/dev environment mudah diprovision.
- Deployment bisa self-describing.
- Mengurangi langkah manual admin console.

### 9.2 Risiko `glassfish-resources.xml`

- Environment-specific value bisa masuk artifact.
- Secret bisa bocor jika tidak hati-hati.
- Resource lifecycle bercampur dengan app lifecycle.
- Production admin mungkin tidak ingin aplikasi membuat resource sendiri.
- Drift bisa terjadi jika resource diubah manual setelah deployment.

### 9.3 Rule Production

Gunakan `glassfish-resources.xml` untuk:

- local development,
- integration test,
- ephemeral environment,
- baseline resource template,
- resource yang memang application-scoped.

Lebih hati-hati untuk production:

- credential,
- database endpoint,
- pool size,
- transaction setting,
- JMS broker config,
- external integration endpoint.

Untuk production, sering lebih aman:

```text
Provision infrastructure resource via asadmin/GitOps/IaC
Deploy application that references resource by stable JNDI name
```

---

## 10. Descriptor vs Annotation vs Admin Config

Tiga tempat konfigurasi sering tumpang tindih:

1. annotation di kode,
2. descriptor XML,
3. server/domain configuration.

Contoh:

```java
@Resource(name = "jdbc/AppDS")
private DataSource dataSource;
```

```xml
<!-- web.xml / ejb-jar.xml -->
<resource-ref>
    <res-ref-name>jdbc/AppDS</res-ref-name>
    <res-type>javax.sql.DataSource</res-type>
</resource-ref>
```

```xml
<!-- glassfish-web.xml / glassfish-ejb-jar.xml -->
<resource-ref>
    <res-ref-name>jdbc/AppDS</res-ref-name>
    <jndi-name>jdbc/OrdersDS</jndi-name>
</resource-ref>
```

```text
GlassFish domain config:
  jdbc-resource jdbc/OrdersDS
  jdbc-connection-pool OrdersPool
```

### 10.1 Precedence Mental Model

Jangan hafalkan urutan precedence secara buta. Pahami lapisannya:

```text
Annotation       = default declaration near code
Standard XML     = portable override/declaration
Vendor XML       = server-specific binding/override
Domain config    = concrete infrastructure object
asadmin deploy   = deployment-time override/target
```

Jika ada konflik, engineer harus bertanya:

1. Apakah nama yang dipakai kode adalah nama lokal atau global?
2. Apakah standard descriptor mengubah declaration?
3. Apakah GlassFish descriptor memetakan nama itu?
4. Apakah resource target tersedia di server/cluster target?
5. Apakah deploy command memberi override?
6. Apakah aplikasi membaca config dari luar descriptor?

---

## 11. Portable Name vs Global JNDI Name

Salah satu jebakan utama adalah mencampur nama portable dengan nama global.

### 11.1 Nama Lokal Portable

Contoh:

```text
java:comp/env/jdbc/AppDS
```

Ini nama lokal component. Ia bagus karena aplikasi tidak perlu tahu resource global.

### 11.2 Nama Global Server

Contoh:

```text
jdbc/OrdersDS
jms/CaseQueue
mail/AppMailSession
```

Ini resource yang dibuat di GlassFish domain.

### 11.3 Mapping

```text
java:comp/env/jdbc/AppDS
        |
        v
resource-ref mapping
        |
        v
jdbc/OrdersDS
        |
        v
JDBC pool OrdersPool
        |
        v
physical DB
```

Top 1% habit:

> Selalu gambar mapping resource dari kode sampai physical infrastructure.

Jangan berhenti di “DataSource injection failed”. Telusuri boundary:

```text
injection point -> local name -> descriptor -> vendor mapping -> JNDI resource -> pool -> driver -> DB
```

---

## 12. Descriptor dan Environment Promotion

Descriptor bisa menjadi penyebab deployment berhasil di DEV tetapi gagal di UAT/PROD.

### 12.1 Masalah Umum

```text
DEV:
  context-root = /app-dev
  jndi-name    = jdbc/AppDevDS

UAT:
  context-root = /app
  jndi-name    = jdbc/AppUatDS

PROD:
  context-root = /app
  jndi-name    = jdbc/AppProdDS
```

Jika descriptor berbeda per environment, artifact tidak lagi immutable.

### 12.2 Strategi 1: Descriptor Generic, Resource Name Stable

Gunakan nama resource yang sama di semua environment:

```text
jdbc/AppDS
```

Tetapi domain config berbeda:

```text
DEV jdbc/AppDS -> DEV DB
UAT jdbc/AppDS -> UAT DB
PROD jdbc/AppDS -> PROD DB
```

Keuntungan:

- artifact sama,
- descriptor sama,
- deployment sederhana.

Risiko:

- perlu disiplin kuat agar resource dengan nama sama tidak salah pointing,
- inspeksi environment harus jelas.

### 12.3 Strategi 2: Build-Time Filtering

Descriptor diproses saat build:

```xml
<jndi-name>${app.datasource.jndi}</jndi-name>
```

Lalu build menghasilkan artifact berbeda per environment.

Keuntungan:

- eksplisit per environment.

Risiko:

- artifact tidak immutable across environment,
- sulit rollback/promote,
- build ulang untuk prod meningkatkan risiko.

### 12.4 Strategi 3: Deploy-Time Override

Beberapa hal bisa diberikan via `asadmin deploy` atau admin config.

Keuntungan:

- artifact tetap sama,
- environment config dipisah.

Risiko:

- pipeline harus rapi,
- command deploy harus terdokumentasi,
- config drift mudah terjadi bila manual.

### 12.5 Rekomendasi Umum

Untuk enterprise/regulatory system:

```text
Prefer same artifact across environments.
Prefer environment resource binding in server/domain config.
Keep vendor descriptor stable and minimal.
Version all asadmin provisioning scripts.
```

---

## 13. Vendor Descriptor sebagai Bagian dari Security Surface

Descriptor dapat mengubah security behavior.

Contoh area risiko:

- role mapping salah,
- group terlalu luas,
- principal hardcoded,
- default principal-to-role mapping aktif tanpa review,
- admin/dev role terbawa ke production,
- servlet principal mapping salah,
- realm berbeda antar environment,
- web layer aman tetapi EJB layer terbuka.

### 13.1 Role Mapping Review

Checklist:

```text
[ ] Semua role aplikasi terdaftar?
[ ] Semua role punya mapping group/principal yang benar?
[ ] Tidak ada role dev/test di production?
[ ] Group production sesuai IdP/realm?
[ ] Tidak ada wildcard/overbroad group?
[ ] EJB dan web mapping konsisten?
[ ] Remote EJB entry point direview?
[ ] Timer/MDB execution identity dipahami?
```

### 13.2 Anti-Pattern: Menyamakan Role dengan Group

Buruk:

```text
Role aplikasi: CN=ACEAS_PROD_CASE_OFFICER,OU=Groups,DC=corp,...
```

Lebih baik:

```text
Role aplikasi: CaseOfficer
Group runtime: CN=ACEAS_PROD_CASE_OFFICER,OU=Groups,DC=corp,...
```

Kenapa?

Karena role adalah konsep aplikasi, group adalah detail identity infrastructure.

---

## 14. Descriptor sebagai Bagian dari Classloading Surface

`glassfish-web.xml` dapat mengubah classloader delegation. Ini sangat berbahaya jika dipakai sembarangan.

### 14.1 Kasus Nyata

Aplikasi memasukkan library Jakarta/JAX-RS/JPA sendiri di `WEB-INF/lib`.

Lalu muncul error:

```text
NoSuchMethodError
ClassCastException
LinkageError
NoClassDefFoundError
```

Engineer panik dan mencoba:

```xml
<class-loader delegate="false" />
```

Kadang error berubah atau hilang di satu tempat, tapi muncul di tempat lain.

### 14.2 Cara Berpikir yang Benar

Tanya dulu:

```text
[ ] Apakah aplikasi membawa API jar yang seharusnya disediakan server?
[ ] Apakah versi Jakarta/Java EE API cocok dengan GlassFish version?
[ ] Apakah ada javax dan jakarta campur?
[ ] Apakah library sama ada di domain/lib dan WEB-INF/lib?
[ ] Apakah EAR/lib memuat library yang juga ada di WAR/lib?
[ ] Apakah driver/logging/provider ditempatkan di level yang benar?
```

Classloader descriptor sebaiknya dipakai sebagai surgical tool, bukan hammer.

---

## 15. Descriptor sebagai Bagian dari Resource Lifecycle

`glassfish-resources.xml` bisa membuat resource saat deploy. Ini nyaman, tetapi harus dipahami sebagai lifecycle coupling.

```text
Deploy app
  -> create/update resource
  -> bind JNDI
  -> app starts
```

Jika undeploy:

- apakah resource ikut hilang?
- apakah resource masih dipakai aplikasi lain?
- apakah pool sedang aktif?
- apakah credential terhapus?

Untuk shared resource, jangan sembarangan mengemas resource definition bersama aplikasi.

### 15.1 Resource Ownership Model

Tentukan ownership:

| Resource | Owner yang sehat |
|---|---|
| Dedicated app datasource | App/platform team |
| Shared datasource | Platform/DBA/runtime team |
| JMS queue khusus aplikasi | App/platform team |
| Shared broker/global queue | Messaging/platform team |
| Mail session shared | Platform team |
| External JNDI global | Platform team |

Rule:

> Semakin shared sebuah resource, semakin tidak cocok lifecycle-nya ditempel ke artifact aplikasi.

---

## 16. Descriptor dan Portability

Vendor descriptor mengurangi portability, tetapi tidak semua non-portability buruk.

### 16.1 Portability Spectrum

```text
Fully portable:
  Jakarta EE annotations and standard descriptors only

Mostly portable:
  Standard descriptors + minimal vendor resource mapping

Moderately vendor-specific:
  GlassFish role mapping, classloader settings, EJB pool settings

Strongly vendor-specific:
  GlassFish-specific resource provisioning, internal properties, admin-dependent behavior

Non-portable operational coupling:
  app assumes exact GlassFish domain layout, path, generated files, server internals
```

### 16.2 Kapan Vendor Lock-in Bisa Diterima?

Vendor lock-in bisa diterima jika:

- manfaat operasional nyata,
- risiko migrasi dipahami,
- konfigurasi terdokumentasi,
- ada test untuk behavior tersebut,
- tidak menyentuh domain logic,
- ada strategi bila migrasi runtime.

Tidak sehat jika:

- logika bisnis tergantung pada behavior vendor,
- aplikasi sulit dites di luar server,
- deployment hanya bisa dilakukan manual,
- config tersebar di console tanpa versioning,
- descriptor tidak ada owner-nya.

---

## 17. Migration: `sun-*` ke `glassfish-*`

Aplikasi legacy sering punya:

```text
sun-web.xml
sun-ejb-jar.xml
sun-application.xml
sun-resources.xml
```

Saat modernisasi, inventory descriptor ini.

### 17.1 Migration Checklist

```text
[ ] Cari semua file sun-*.xml
[ ] Cari semua file glassfish-*.xml
[ ] Identifikasi descriptor aktif per module
[ ] Bandingkan dengan dokumentasi versi target
[ ] Rename jika didukung dan diperlukan
[ ] Validasi namespace/DTD/schema
[ ] Review element yang deprecated/legacy
[ ] Test deploy di GlassFish target
[ ] Test behavior, bukan hanya deploy success
```

### 17.2 Jangan Hanya Rename

Rename file bisa tidak cukup.

Perlu cek:

- element masih valid?
- schema berubah?
- behavior berubah?
- `javax` type masih ada?
- GlassFish target Jakarta EE 10/11 sudah memakai `jakarta`?
- resource type masih benar?
- descriptor menunjuk class yang package-nya sudah berubah?

Contoh risiko:

```xml
<res-type>javax.sql.DataSource</res-type>
```

`javax.sql.DataSource` tetap Java SE, bukan Jakarta namespace, jadi tidak otomatis berubah. Tetapi tipe lain seperti Jakarta Mail, Servlet API, Validation, JPA bisa berubah dari `javax.*` ke `jakarta.*` tergantung konteks.

Rule:

> Jangan menjalankan migration script namespace secara buta ke semua string `javax`.

---

## 18. Descriptor Review sebagai Engineering Practice

Descriptor harus direview seperti source code.

### 18.1 Review Checklist Umum

```text
[ ] Apakah descriptor masih diperlukan?
[ ] Apakah ada setting yang bisa diganti standard descriptor/annotation?
[ ] Apakah ada hardcoded environment value?
[ ] Apakah ada secret?
[ ] Apakah JNDI name konsisten dengan provisioning script?
[ ] Apakah context-root eksplisit dan benar?
[ ] Apakah security role mapping minimal dan benar?
[ ] Apakah classloader setting aman?
[ ] Apakah resource lifecycle tidak mengganggu app lain?
[ ] Apakah descriptor cocok dengan GlassFish target version?
[ ] Apakah ada legacy sun-* descriptor?
[ ] Apakah perubahan descriptor punya test/deployment verification?
```

### 18.2 Review Checklist untuk Production Release

```text
[ ] Artifact yang sama dipromosikan DEV -> UAT -> PROD?
[ ] Descriptor tidak mengandung DEV/UAT endpoint?
[ ] Resource binding production sudah diverifikasi?
[ ] Role mapping production sudah diverifikasi dengan security/IdP?
[ ] Context root tidak berubah karena nama artifact?
[ ] Tidak ada classloader workaround tanpa catatan?
[ ] Tidak ada pool setting ekstrem tanpa capacity analysis?
[ ] glassfish-resources.xml tidak membuat resource shared tanpa approval?
[ ] Rollback artifact punya descriptor yang kompatibel dengan existing resource?
```

---

## 19. Failure Taxonomy Terkait Descriptor

Descriptor salah biasanya muncul sebagai error yang tidak langsung terlihat sebagai descriptor problem.

### 19.1 Deployment Failure

Gejala:

```text
Deployment failed
Invalid deployment descriptor
Element not allowed
Cannot resolve reference
```

Kemungkinan:

- XML invalid,
- schema/DTD mismatch,
- lokasi descriptor salah,
- element tidak didukung versi GlassFish target,
- descriptor lama dipakai di server baru.

### 19.2 Runtime Resource Failure

Gejala:

```text
NameNotFoundException
Resource not found
Cannot acquire DataSource
JNDI lookup failed
```

Kemungkinan:

- `res-ref-name` salah,
- `jndi-name` salah,
- resource belum dibuat,
- resource dibuat tapi target salah,
- pool disabled,
- descriptor tidak terbaca.

### 19.3 Security Failure

Gejala:

```text
403 Forbidden
Access denied
User authenticated but has no role
EJBAccessException
```

Kemungkinan:

- role mapping salah,
- group dari realm tidak sama,
- mapping ada di WAR tapi EJB invocation butuh mapping lain,
- default principal-role mapping tidak sesuai ekspektasi,
- environment IdP group berbeda.

### 19.4 Classloading Failure

Gejala:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
ClassCastException
LinkageError
```

Kemungkinan:

- classloader `delegate=false`,
- duplicate library,
- API jar dibawa aplikasi,
- `javax`/`jakarta` mixed,
- EAR lib dan WAR lib konflik,
- domain lib konflik.

### 19.5 Behavior Drift

Gejala:

```text
Works in DEV but fails in UAT
Works after console change but not after redeploy
Works in one node but not another
```

Kemungkinan:

- descriptor berbeda antar build,
- domain config drift,
- resource target tidak sama,
- manual console hotfix,
- cluster config belum sinkron,
- artifact tidak immutable.

---

## 20. Debugging Method: Dari Error ke Descriptor

Saat ada error runtime, gunakan path tracing.

### 20.1 Resource Error Trace

```text
Injection/lookup error
  -> identify requested name
  -> check annotation/standard descriptor
  -> check GlassFish descriptor mapping
  -> check global JNDI resource exists
  -> check resource target
  -> check pool exists/enabled
  -> check physical connection property
```

Command yang biasanya berguna:

```bash
asadmin list-applications
asadmin list-jndi-entries
asadmin list-jdbc-resources
asadmin list-jdbc-connection-pools
asadmin get resources.jdbc-resource.jdbc/OrdersDS.*
asadmin get resources.jdbc-connection-pool.OrdersPool.*
```

### 20.2 Security Error Trace

```text
403/EJBAccessException
  -> identify authenticated principal
  -> identify groups from realm
  -> identify app role required
  -> check standard security role declaration
  -> check glassfish-* security-role-mapping
  -> check default principal-role mapping config
  -> check invocation path web/EJB/timer/MDB
```

### 20.3 Classloading Error Trace

```text
Linkage/class error
  -> find class full name
  -> find all jars containing class
  -> identify server-provided API
  -> identify app-provided duplicate
  -> check EAR/lib and WAR/WEB-INF/lib
  -> check domain/lib
  -> check class-loader delegate setting
  -> remove duplicate before forcing delegate=false
```

---

## 21. Good Descriptor Design

### 21.1 Minimal Descriptor

Gunakan descriptor hanya untuk hal yang perlu.

Buruk:

```xml
<glassfish-web-app>
    <!-- banyak setting copy-paste dari project lama tanpa alasan -->
</glassfish-web-app>
```

Baik:

```xml
<glassfish-web-app>
    <context-root>/orders</context-root>
    <security-role-mapping>
        <role-name>CaseOfficer</role-name>
        <group-name>case-officer-group</group-name>
    </security-role-mapping>
</glassfish-web-app>
```

### 21.2 Stable Names

Gunakan nama semantic yang stabil:

```text
jdbc/AppDS
jms/CaseEventQueue
mail/AppMailSession
```

Hindari:

```text
jdbc/dev-db-10-21-5-12
jdbc/uat-temp-v2
jdbc/prod-new-final
```

Physical endpoint bukan nama semantic resource.

### 21.3 No Secret in Descriptor

Jangan taruh password plain text.

Buruk:

```xml
<property name="password" value="SuperSecret123"/>
```

Lebih baik gunakan secret mechanism runtime, password alias, atau provisioning eksternal sesuai baseline environment.

### 21.4 Descriptor Versioning

Descriptor harus masuk source control.

Jangan biarkan config penting hanya hidup di:

- Admin Console,
- file hasil edit manual di server,
- catatan chat,
- memory engineer.

---

## 22. Anti-Patterns

### 22.1 Descriptor sebagai Tempat Sampah Config

Semua setting dimasukkan ke descriptor karena “mudah”.

Akibat:

- artifact penuh env-specific value,
- deployment sulit dipromote,
- secret risk,
- rollback sulit.

### 22.2 Copy-Paste dari Aplikasi Lama

Descriptor lama dipakai tanpa paham.

Akibat:

- classloader override tidak perlu,
- role mapping stale,
- pool setting tidak sesuai workload,
- context root salah.

### 22.3 Manual Console Override

Descriptor menyatakan A, console diubah menjadi B.

Akibat:

- redeploy mengubah behavior,
- node satu beda dengan node lain,
- root cause sulit.

### 22.4 Resource Created by App, Used by Everyone

Aplikasi membuat resource shared via `glassfish-resources.xml`.

Akibat:

- undeploy/rollback bisa mengganggu aplikasi lain,
- ownership tidak jelas.

### 22.5 Classloader Workaround Permanen

`delegate=false` dipasang untuk menutup masalah dependency.

Akibat:

- error migrasi makin sulit,
- hidden coupling,
- server upgrade risk.

---

## 23. Practical Example: WAR dengan Context Root, Role Mapping, dan Resource Mapping

Struktur:

```text
case-management.war
  WEB-INF/
    web.xml
    glassfish-web.xml
    classes/
    lib/
```

`web.xml`:

```xml
<web-app>
    <resource-ref>
        <res-ref-name>jdbc/CaseDS</res-ref-name>
        <res-type>javax.sql.DataSource</res-type>
        <res-auth>Container</res-auth>
    </resource-ref>

    <security-role>
        <role-name>CaseOfficer</role-name>
    </security-role>
</web-app>
```

`glassfish-web.xml`:

```xml
<glassfish-web-app>
    <context-root>/case</context-root>

    <resource-ref>
        <res-ref-name>jdbc/CaseDS</res-ref-name>
        <jndi-name>jdbc/CaseManagementDS</jndi-name>
    </resource-ref>

    <security-role-mapping>
        <role-name>CaseOfficer</role-name>
        <group-name>case-officers</group-name>
    </security-role-mapping>
</glassfish-web-app>
```

Server provisioning:

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=case_app:URL=jdbc\\:oracle\\:thin\\:@//db-host\\:1521/CASEPDB \
  CaseManagementPool

asadmin create-jdbc-resource \
  --connectionpoolid CaseManagementPool \
  jdbc/CaseManagementDS
```

Runtime mapping:

```text
Code @Resource jdbc/CaseDS
  -> web.xml resource-ref jdbc/CaseDS
  -> glassfish-web.xml maps to jdbc/CaseManagementDS
  -> GlassFish jdbc-resource jdbc/CaseManagementDS
  -> JDBC pool CaseManagementPool
  -> Oracle DB
```

This is the kind of mapping top-level engineers keep explicit.

---

## 24. Practical Example: EAR-Level Role Mapping

Struktur:

```text
regulatory-app.ear
  META-INF/
    application.xml
    glassfish-application.xml
  regulatory-web.war
  regulatory-ejb.jar
```

`glassfish-application.xml`:

```xml
<glassfish-application>
    <security-role-mapping>
        <role-name>Supervisor</role-name>
        <group-name>regulatory-supervisors</group-name>
    </security-role-mapping>

    <security-role-mapping>
        <role-name>CaseOfficer</role-name>
        <group-name>regulatory-case-officers</group-name>
    </security-role-mapping>
</glassfish-application>
```

Gunakan jika role tersebut benar-benar application-wide.

Kalau role hanya untuk web module tertentu, pertimbangkan mapping di `glassfish-web.xml`.

---

## 25. Practical Example: EJB Pool Tuning Descriptor

```xml
<glassfish-ejb-jar>
    <enterprise-beans>
        <ejb>
            <ejb-name>CaseScoringService</ejb-name>
            <bean-pool>
                <steady-pool-size>20</steady-pool-size>
                <resize-quantity>10</resize-quantity>
                <max-pool-size>80</max-pool-size>
                <pool-idle-timeout-in-seconds>300</pool-idle-timeout-in-seconds>
            </bean-pool>
        </ejb>
    </enterprise-beans>
</glassfish-ejb-jar>
```

Jangan menentukan angka ini sendirian. Kaitkan dengan:

```text
HTTP worker threads
EJB invocation rate
DB pool size
average DB latency
CPU capacity
transaction timeout
downstream service capacity
```

Contoh reasoning:

```text
If max EJB pool = 80
and each invocation can hold 1 DB connection
then DB pool must tolerate up to 80 concurrent DB-using EJB invocations
or EJB pool must be smaller than DB capacity
or DB access must be controlled elsewhere.
```

Top 1% engineer tidak bertanya “berapa angka best practice?”. Ia bertanya:

> “Pool ini melindungi boundary mana, dan jika penuh, sistem gagal seperti apa?”

---

## 26. Descriptor Diff sebagai Deployment Gate

Salah satu praktik bagus di enterprise adalah menjadikan descriptor diff sebagai bagian dari release review.

Contoh gate:

```bash
git diff --name-only origin/main...HEAD | grep -E 'glassfish-.*\.xml|sun-.*\.xml|web\.xml|ejb-jar\.xml|application\.xml'
```

Jika descriptor berubah, reviewer wajib mengecek:

- apakah route berubah?
- apakah security mapping berubah?
- apakah resource binding berubah?
- apakah pool/concurrency berubah?
- apakah classloader berubah?
- apakah resource baru dibuat?
- apakah rollback aman?

Descriptor change sering lebih berisiko daripada perubahan kode biasa karena ia bisa mengubah runtime binding tanpa compile error.

---

## 27. How to Document Vendor Extension

Setiap descriptor vendor penting sebaiknya punya catatan kecil di repository.

Contoh `docs/runtime/glassfish-descriptor-decisions.md`:

```markdown
# GlassFish Descriptor Decisions

## glassfish-web.xml

### context-root `/case`
Reason: public route must be stable across versioned WAR filenames.

### resource-ref jdbc/CaseDS -> jdbc/CaseManagementDS
Reason: application uses portable local name; server owns physical datasource.

### security-role-mapping CaseOfficer -> case-officers
Reason: maps application role to GlassFish realm group.
Owner: Security/platform team.

## glassfish-ejb-jar.xml

### CaseScoringService max-pool-size=80
Reason: load test showed 80 concurrent invocations saturate CPU before DB pool exhaustion.
Related capacity doc: docs/performance/case-scoring-capacity.md
```

Ini terlihat sederhana, tetapi sangat membantu saat incident, audit, migration, atau handover.

---

## 28. Top 1% Mental Model

Untuk mencapai level tinggi, jangan hafal element XML saja. Hafalkan boundary.

### 28.1 Descriptor adalah Boundary Translator

```text
Portable application intent
        |
        v
Vendor descriptor
        |
        v
Concrete runtime behavior
```

### 28.2 Descriptor adalah Deployment-Time Program

Ia dieksekusi oleh deployer.

Jika salah:

- aplikasi bisa gagal deploy,
- aplikasi bisa deploy tapi salah resource,
- security bisa salah,
- performance bisa berubah,
- classloading bisa kacau.

### 28.3 Descriptor adalah Risk Surface

Descriptor dapat memengaruhi:

```text
URL surface
Security surface
Resource surface
Transaction surface
Classloading surface
Performance surface
Migration surface
```

### 28.4 Descriptor Harus Minimal dan Terjelaskan

Descriptor ideal:

- kecil,
- eksplisit,
- stabil,
- tidak berisi secret,
- tidak env-specific jika artifact dipromosikan,
- punya alasan untuk setiap vendor-specific setting.

---

## 29. Latihan Mandiri

### Latihan 1 — Inventory Descriptor

Ambil satu aplikasi Java EE/Jakarta EE lama.

Cari:

```text
web.xml
ejb-jar.xml
application.xml
glassfish-web.xml
glassfish-ejb-jar.xml
glassfish-application.xml
glassfish-resources.xml
sun-web.xml
sun-ejb-jar.xml
sun-application.xml
sun-resources.xml
```

Buat tabel:

| File | Module | Purpose | Environment-specific? | Risk |
|---|---|---|---|---|

### Latihan 2 — Resource Mapping Trace

Untuk setiap datasource:

```text
Injection point -> local name -> descriptor -> global JNDI -> pool -> physical DB
```

Jika tidak bisa menggambar chain ini, berarti resource model belum cukup dipahami.

### Latihan 3 — Security Mapping Trace

Untuk setiap role:

```text
endpoint/method -> required role -> standard descriptor/annotation -> GlassFish mapping -> realm group/principal
```

### Latihan 4 — Classloader Risk Review

Cari:

```text
<class-loader delegate="false" />
```

Untuk setiap pemakaian, tulis:

- kenapa diperlukan,
- library konflik apa yang diselesaikan,
- apakah ada alternatif dependency cleanup,
- apakah masih diperlukan di versi runtime sekarang.

### Latihan 5 — Descriptor Diff Gate

Tambahkan rule di CI bahwa perubahan descriptor vendor harus ditandai sebagai `runtime-impacting-change`.

---

## 30. Ringkasan

Pada part ini kita mempelajari:

- perbedaan standard descriptor dan GlassFish-specific descriptor,
- kenapa vendor extension ada,
- kapan vendor descriptor sehat digunakan,
- fungsi `glassfish-web.xml`, `glassfish-application.xml`, `glassfish-ejb-jar.xml`, dan `glassfish-resources.xml`,
- hubungan descriptor dengan context root, security mapping, classloading, resource mapping, EJB pool, dan resource lifecycle,
- risiko `sun-*` legacy descriptor,
- strategi environment promotion,
- descriptor sebagai security/resource/classloading/performance surface,
- failure taxonomy akibat descriptor,
- debugging method dari gejala runtime ke descriptor,
- checklist production review.

Core insight:

> GlassFish-specific descriptor bukan sekadar file XML tambahan. Ia adalah kontrak binding antara aplikasi portable dan runtime GlassFish konkret. Jika dipakai disiplin, ia membuat deployment eksplisit dan audit-ready. Jika dipakai sembarangan, ia menciptakan config drift, security bug, classloading chaos, dan migration trap.

---

## 31. Referensi Resmi dan Bacaan Lanjutan

Gunakan referensi resmi berikut saat mengerjakan descriptor nyata:

- Eclipse GlassFish Application Deployment Guide Release 8.
- Eclipse GlassFish Application Development Guide.
- Eclipse GlassFish Reference Manual.
- GlassFish Server 5.1 Application Deployment Guide appendix: GlassFish Server Deployment Descriptor Files.
- Jakarta EE Platform Specification untuk standard deployment descriptor dan portable application model.

Catatan penting:

- Untuk GlassFish modern, prefer `glassfish-*` descriptor.
- Untuk aplikasi legacy, audit `sun-*` descriptor.
- Untuk Jakarta EE 9+, berhati-hati dengan migrasi namespace `javax.*` ke `jakarta.*`; jangan ubah semua string secara buta karena beberapa `javax.*` tetap berasal dari Java SE.

---

# Status Seri

Part 9 selesai.

Seri **belum selesai**.

Part berikutnya:

> **Part 10 — HTTP Stack dan Grizzly Runtime Internals**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-008.md">⬅️ Part 8 — Deployment Model: WAR, EAR, EJB-JAR, RAR, App Client, dan Deployment Descriptor</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-010.md">Part 10 — HTTP Stack dan Grizzly Runtime Internals ➡️</a>
</div>
