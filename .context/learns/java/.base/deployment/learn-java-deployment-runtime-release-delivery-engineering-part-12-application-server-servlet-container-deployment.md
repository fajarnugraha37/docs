# Learn Java Deployment, Runtime, Release, and Delivery Engineering

## Part 12 — Application Server and Servlet Container Deployment

> Seri: `learn-java-deployment-runtime-release-delivery-engineering`  
> Part: `12 / 35`  
> Topik: deployment Java ke Servlet Container dan Application Server  
> Scope versi Java: Java 8 sampai Java 25  
> Fokus: WAR/EAR lifecycle, container-managed runtime, classloading, datasource/JNDI, hot deploy, clustering, session behavior, automation, rollback, dan production operations.

---

## 0. Tujuan Bagian Ini

Setelah bagian-bagian sebelumnya, kita sudah melihat deployment sebagai perjalanan dari source code menuju proses production yang berjalan. Pada bagian ini, fokus kita menyempit ke salah satu model deployment Java yang paling tua, paling luas dipakai, dan masih sangat relevan di enterprise: **deploy aplikasi ke servlet container atau application server**.

Model ini berbeda secara fundamental dari executable JAR atau containerized Spring Boot JAR.

Pada executable JAR, aplikasi membawa server-nya sendiri. Pada deployment WAR/EAR ke container/server, **server adalah runtime platform** dan aplikasi adalah unit yang dipasang ke dalam runtime tersebut.

Perbedaannya bukan kosmetik. Perbedaannya memengaruhi:

- siapa yang mengontrol lifecycle aplikasi;
- siapa yang menyediakan library runtime;
- siapa yang mengelola datasource, transaction manager, thread pool, security realm, naming service, session manager, dan connector;
- bagaimana classloader disusun;
- bagaimana rollout dan rollback dilakukan;
- bagaimana konfigurasi disuntikkan;
- bagaimana dependency conflict terjadi;
- bagaimana session dan state bertahan saat redeploy;
- bagaimana observability dan troubleshooting dilakukan.

Target bagian ini bukan membuat kamu sekadar tahu cara “copy WAR ke webapps”. Targetnya adalah membangun pemahaman yang cukup dalam untuk menjawab pertanyaan seperti:

- Apakah aplikasi ini sebaiknya dideploy sebagai executable JAR, WAR, atau EAR?
- Apakah dependency harus dibundel di aplikasi atau dipasang sebagai shared/server library?
- Kenapa aplikasi jalan di local Tomcat tapi gagal di UAT WebLogic?
- Kenapa redeploy membuat memory naik terus?
- Kenapa rollback WAR gagal setelah schema database berubah?
- Kenapa hot deploy di DEV aman tapi berbahaya di production?
- Kenapa session user hilang saat rolling restart?
- Kenapa `NoSuchMethodError` muncul hanya di app server?
- Kenapa deployment sukses tetapi endpoint 500 karena datasource belum bound?
- Bagaimana membuat deployment app server bisa diautomasi, repeatable, dan auditable?

---

## 1. Big Picture: Dua Model Besar Java Server Deployment

Dalam Java server-side deployment, secara kasar ada dua model besar.

```text
Model A — Self-contained application runtime

  OS / Container / VM
      |
      +-- JVM
            |
            +-- Application process
                  |
                  +-- Embedded server
                  +-- Business code
                  +-- Framework libraries
                  +-- Runtime configuration

Contoh:
- Spring Boot executable JAR
- Micronaut JAR
- Quarkus JVM mode JAR
- Helidon JAR
```

```text
Model B — Container-managed application runtime

  OS / Container / VM
      |
      +-- JVM
            |
            +-- Servlet Container / Application Server
                  |
                  +-- Shared runtime services
                  |     +-- Servlet engine
                  |     +-- HTTP connector
                  |     +-- Thread pools
                  |     +-- DataSource / JNDI
                  |     +-- Transaction manager
                  |     +-- Security realm
                  |     +-- Session manager
                  |     +-- JMS resource adapter
                  |
                  +-- Deployed Application A.war
                  +-- Deployed Application B.war
                  +-- Deployed Application C.ear

Contoh:
- Tomcat + WAR
- Jetty + WAR
- WildFly + WAR/EAR
- Payara/GlassFish + WAR/EAR
- Open Liberty/WebSphere Liberty + WAR/EAR
- WebLogic + WAR/EAR
- WebSphere traditional + EAR
```

Keduanya valid. Yang sering salah adalah menganggap keduanya hanya berbeda command start.

Sebenarnya, model B memindahkan sebagian tanggung jawab dari aplikasi ke platform runtime. Artinya deployment engineer harus paham **kontrak antara aplikasi dan server**.

---

## 2. Vocabulary: Servlet Container vs Application Server

Istilah ini sering dicampur. Untuk deployment, perbedaan ini penting.

### 2.1 Servlet Container

Servlet container menyediakan runtime untuk Servlet/JSP/WebSocket/HTTP web application.

Contoh:

- Apache Tomcat;
- Eclipse Jetty;
- Undertow standalone atau embedded.

Servlet container biasanya fokus pada:

- HTTP connector;
- servlet lifecycle;
- filter/listener;
- session management;
- WAR deployment;
- basic JNDI resource support;
- TLS connector;
- access logs;
- thread pool;
- classloader hierarchy untuk webapp.

Servlet container **bukan full Jakarta EE application server**. Tomcat, misalnya, tidak menyediakan full CDI, EJB, JTA, JMS, Jakarta Batch, Jakarta Security, Jakarta Persistence provider, dan fitur enterprise lain secara lengkap by default.

Namun servlet container sangat populer karena ringan, predictable, dan cocok untuk aplikasi Spring MVC/Spring Boot WAR, legacy servlet app, atau framework yang membawa sendiri dependency enterprise-nya.

### 2.2 Application Server

Application server menyediakan platform enterprise Java yang lebih luas.

Contoh:

- WildFly / JBoss EAP;
- Payara / GlassFish;
- Open Liberty / WebSphere Liberty;
- WebLogic;
- WebSphere traditional.

Application server biasanya menyediakan:

- Servlet/JSP/WebSocket;
- CDI;
- Jakarta REST/JAX-RS;
- Jakarta Persistence integration;
- JTA transaction manager;
- EJB;
- JMS;
- JCA/resource adapter;
- Jakarta Batch;
- Jakarta Security;
- Jakarta Mail;
- connection pool;
- naming/JNDI;
- distributed session/clustering;
- admin CLI/API;
- deployment repository;
- managed domain/server group;
- central config model.

Dalam application server, aplikasi sering lebih “tipis”: tidak semua library dibawa sendiri. Sebagian API dan implementasi sudah disediakan server.

### 2.3 Web Profile vs Full Platform

Jakarta EE mengenal profil/spec subsets. Dalam praktik deployment, kamu perlu tahu apakah server mendukung fitur yang dibutuhkan aplikasi.

Misalnya aplikasi memakai:

- Servlet saja → Tomcat/Jetty cukup.
- Servlet + JAX-RS + CDI → bisa di servlet container dengan library tambahan, atau server Jakarta EE/Web Profile.
- JTA + JMS + EJB + distributed transaction → cenderung perlu application server full/enterprise runtime.

Deployment failure sering muncul ketika developer mengira “Java web app” sama dengan “semua server Java bisa jalan”, padahal runtime contract-nya berbeda.

---

## 3. Unit Deployment: WAR, EAR, RAR, and Exploded Directory

### 3.1 WAR

WAR adalah **Web Application Archive**. Ia merepresentasikan satu web application.

Struktur umum:

```text
my-app.war
  |
  +-- index.jsp
  +-- static/
  +-- WEB-INF/
        |
        +-- web.xml
        +-- classes/
        |     +-- com/example/...
        |
        +-- lib/
              +-- dependency-a.jar
              +-- dependency-b.jar
```

`WEB-INF/classes` berisi compiled classes aplikasi. `WEB-INF/lib` berisi JAR dependency aplikasi. File di bawah `WEB-INF` tidak dapat diakses langsung oleh browser.

WAR cocok saat:

- aplikasi adalah web application berbasis servlet;
- runtime server disediakan terpisah;
- deployment organization sudah punya standard Tomcat/WebLogic/WildFly/Liberty;
- konfigurasi datasource/security/session dikelola server;
- satu server menjalankan beberapa aplikasi;
- compliance mengharuskan runtime distandardisasi oleh platform team.

WAR kurang cocok saat:

- ingin self-contained immutable application;
- dependency server dan aplikasi sering konflik;
- butuh runtime berbeda per aplikasi;
- release cadence antar aplikasi sangat tinggi;
- ingin container image satu aplikasi satu process secara cloud-native;
- platform app server terlalu berat untuk kebutuhan aplikasi.

### 3.2 EAR

EAR adalah **Enterprise Application Archive**. Ia bisa berisi beberapa module enterprise.

Struktur umum:

```text
my-enterprise-app.ear
  |
  +-- META-INF/
  |     +-- application.xml
  |
  +-- web-module.war
  +-- ejb-module.jar
  +-- shared-lib.jar
  +-- connector-module.rar
```

EAR cocok untuk aplikasi enterprise yang punya banyak module yang harus dideploy sebagai satu logical unit:

- web module;
- EJB module;
- shared library;
- connector/resource adapter;
- application-level deployment descriptor;
- server-specific descriptor.

Dalam sistem modern, EAR lebih jarang dipakai dibanding WAR/JAR, tetapi masih banyak di enterprise lama, terutama WebLogic/WebSphere/JBoss EAP.

### 3.3 RAR

RAR adalah **Resource Adapter Archive**, biasanya untuk Jakarta Connectors/JCA.

Contoh penggunaannya:

- adapter ke legacy EIS;
- message provider connector;
- custom enterprise resource adapter.

Deployment RAR lebih specialized, tapi penting di enterprise integration.

### 3.4 Exploded Deployment

Exploded deployment berarti artifact tidak dalam bentuk archive `.war`/`.ear`, tetapi direktori yang sudah diekstrak.

Contoh:

```text
webapps/my-app/
  WEB-INF/
  static/
  index.jsp
```

Kelebihan:

- cepat untuk development;
- file static/JSP bisa diganti langsung;
- mudah inspect isi aplikasi.

Kekurangan:

- rawan partial update;
- sulit menjamin atomicity;
- timestamp/file watcher dapat memicu redeploy tidak sengaja;
- susah membuktikan artifact integrity;
- tidak ideal untuk production jika dilakukan manual.

Prinsip production:

> Archive deployment lebih auditable. Exploded deployment hanya aman jika dihasilkan secara deterministic dan dipromosikan sebagai satu release unit, bukan diedit manual di server.

---

## 4. Lifecycle Deployment di Server

Deployment ke server bukan sekadar copy file. Server menjalankan lifecycle.

```text
1. Artifact arrives
2. Server detects or receives deployment request
3. Server validates archive structure
4. Server builds deployment metadata
5. Server creates classloader(s)
6. Server resolves descriptors and annotations
7. Server binds resources
8. Server initializes application context
9. Server starts listeners, filters, servlets, endpoints
10. Server exposes traffic route/context path
11. Application serves traffic
12. Server stops application on undeploy/redeploy/shutdown
13. Server releases classloaders/resources
```

Mari bedah.

### 4.1 Artifact Arrival

Artifact bisa datang melalui:

- copy ke deployment directory;
- admin console upload;
- CLI command;
- REST/management API;
- Maven/Gradle plugin;
- CI/CD pipeline;
- container image build;
- shared filesystem;
- vendor deployment manager.

Production-grade deployment sebaiknya tidak bergantung pada manual copy tanpa kontrol.

### 4.2 Detection or Explicit Deployment

Ada dua pola:

```text
Implicit deployment:
  copy file ke folder -> server scanner mendeteksi -> deploy

Explicit deployment:
  call CLI/API -> server deploys exact artifact -> result known
```

Implicit deployment mudah, tapi rawan:

- partial file copy terbaca scanner;
- scanner interval race;
- file lock problem;
- tidak jelas status failure;
- sulit audit;
- server bereaksi terhadap perubahan file yang tidak disengaja.

Explicit deployment lebih baik untuk production karena pipeline bisa membaca result secara deterministik.

### 4.3 Metadata Build

Server membaca:

- `web.xml`;
- annotations;
- servlet container initializer;
- `ServletContainerInitializer`;
- `META-INF/services`;
- server-specific descriptors;
- Jakarta descriptors;
- CDI beans discovery;
- JPA persistence unit;
- EJB descriptors;
- resource references;
- security constraints;
- context path.

Di sinilah deployment bisa lambat. Banyak framework melakukan scanning classpath besar.

### 4.4 Classloader Creation

Server membuat classloader untuk aplikasi. Ini bagian yang sangat penting.

Satu deployment biasanya punya classloader sendiri agar library aplikasi A tidak bocor ke aplikasi B.

Namun server juga punya classloader global/common. Dependency bisa datang dari:

- JDK modules/classes;
- server runtime libraries;
- shared/common libraries;
- application `WEB-INF/lib`;
- application classes;
- module-specific libraries.

Konflik classloader adalah salah satu failure mode terbesar app server deployment.

### 4.5 Resource Binding

Aplikasi bisa mereferensikan resource:

- datasource;
- JMS queue/topic;
- mail session;
- executor/thread pool;
- transaction manager;
- security realm;
- environment entry;
- resource adapter;
- JNDI binding.

Deployment bisa sukses secara archive, tetapi runtime request gagal jika resource binding salah.

Contoh:

```text
java:comp/env/jdbc/AppDS expected by app
but server defines only java:/jdbc/appDS
```

Kesalahan case, namespace, atau descriptor bisa menyebabkan failure.

### 4.6 Context Initialization

Framework di dalam aplikasi mulai hidup:

- Spring context;
- CDI container;
- JPA entity manager factory;
- Hibernate metadata;
- connection pool lookup;
- REST endpoints;
- scheduled jobs;
- cache initialization;
- message listeners;
- application listeners.

Bahaya production: aplikasi bisa melakukan pekerjaan berat saat startup:

- connect semua dependency;
- run migration;
- warm cache besar;
- preload data;
- start scheduler;
- consume queue sebelum ready;
- call external API.

Deployment engineer harus tahu apa yang terjadi pada startup, bukan hanya apakah server menerima WAR.

### 4.7 Traffic Exposure

Aplikasi baru dianggap deployed setelah server memetakan context path dan connector menerima request.

Contoh:

```text
https://host:8443/aceas
https://host:8443/cpds
https://host:8443/api
```

Pada reverse proxy/load balancer, traffic exposure juga tergantung:

- backend pool registration;
- health check;
- context path;
- TLS termination;
- header forwarding;
- sticky session;
- route weight;
- firewall/security group;
- DNS/cache.

### 4.8 Undeploy/Redeploy

Pada undeploy, server harus:

- stop accepting traffic;
- stop servlet/filter/listener;
- stop background threads;
- close JPA/session factory;
- release datasource references;
- unregister MBeans;
- stop schedulers;
- close caches;
- stop message consumers;
- release classloader.

Jika aplikasi meninggalkan thread, timer, static reference, ThreadLocal, JDBC driver, or MBean yang masih mengacu ke classloader lama, redeploy bisa menyebabkan memory leak.

---

## 5. Deployment Topologies

### 5.1 Single Server, Single Application

```text
VM-1
  Tomcat
    my-app.war
```

Sederhana dan mudah debug. Cocok untuk kecil/legacy/dev.

Risiko:

- single point of failure;
- downtime saat restart;
- scaling terbatas;
- upgrade manual sering berbahaya.

### 5.2 Single Server, Multiple Applications

```text
VM-1
  Tomcat
    app-a.war
    app-b.war
    app-c.war
```

Kelebihan:

- resource sharing;
- runtime centralized;
- operasi sederhana untuk footprint kecil.

Risiko:

- noisy neighbor;
- satu JVM crash mematikan semua aplikasi;
- shared library conflict;
- port/thread pool shared;
- GC pressure bersama;
- maintenance window saling terkait;
- restart satu aplikasi kadang mengganggu aplikasi lain.

### 5.3 Multiple Servers Behind Load Balancer

```text
              Load Balancer
                   |
        +----------+----------+
        |                     |
      VM-1                  VM-2
      Tomcat                Tomcat
      app.war               app.war
```

Ini baseline HA klasik.

Deployment strategy:

1. remove VM-1 from LB;
2. drain traffic;
3. deploy app to VM-1;
4. verify health;
5. add VM-1 back;
6. repeat for VM-2.

Risiko:

- session affinity;
- DB migration compatibility;
- version skew;
- cache inconsistency;
- manual step drift.

### 5.4 Application Server Cluster

```text
Domain Controller / Admin Server
       |
       +-- Server Group / Cluster
              |
              +-- Node-1: server-a
              +-- Node-2: server-b
              +-- Node-3: server-c
```

Beberapa app server punya domain/cluster management.

Contoh konsep:

- WebLogic Admin Server + Managed Servers;
- WildFly domain mode + server groups;
- WebSphere cell/node/server;
- Payara domain/instances;
- Liberty collective atau external orchestration.

Kelebihan:

- central deployment;
- coordinated rollout;
- shared configuration;
- cluster-aware resources;
- enterprise admin model.

Risiko:

- lebih kompleks;
- admin server menjadi control-plane dependency;
- domain config drift;
- deployment ke cluster bisa memengaruhi banyak node sekaligus;
- rollback harus paham repository dan version state.

### 5.5 App Server Inside Container

```text
Kubernetes Pod
  Container image
    App Server
      app.war
```

Ini hybrid: app server model di dalam container/cloud-native runtime.

Valid untuk:

- legacy WAR/EAR yang ingin dimigrasi ke Kubernetes;
- enterprise server still required;
- standard runtime image disediakan platform team;
- aplikasi belum bisa diubah menjadi executable JAR.

Namun ada tension:

- app server sering didesain untuk mutable deployment repository;
- Kubernetes menginginkan immutable image;
- app server cluster manager bisa overlap dengan Kubernetes orchestration;
- hot deploy tidak cocok dengan immutable container;
- session clustering harus disejajarkan dengan pod lifecycle.

Prinsip modern:

> Jika app server berjalan di container, treat image sebagai release artifact. Jangan deploy WAR mutable ke running container kecuali untuk emergency/debug non-standard yang terdokumentasi.

---

## 6. Deployment Mechanisms per Platform

Bagian ini bukan dokumentasi vendor lengkap. Tujuannya memberi mental model.

### 6.1 Tomcat

Tomcat mendukung deployment WAR melalui beberapa cara:

- copy WAR ke `webapps`;
- exploded directory;
- context descriptor;
- Manager web application;
- deployer/Ant tasks;
- automation via Manager API.

Contoh layout:

```text
$CATALINA_BASE/
  conf/
  logs/
  temp/
  webapps/
    ROOT.war
    app.war
  work/
```

Konsep penting:

- `$CATALINA_HOME` = instalasi Tomcat;
- `$CATALINA_BASE` = instance-specific config/runtime;
- `webapps` = default app base;
- `conf/Catalina/localhost/*.xml` = context descriptors;
- `lib/` = common classloader libraries;
- `WEB-INF/lib` = app-specific libraries.

Best practice:

- pisahkan `CATALINA_HOME` dan `CATALINA_BASE`;
- jangan taruh semua dependency aplikasi di `tomcat/lib`;
- gunakan context descriptor untuk resource/context path yang eksplisit;
- hindari autoDeploy production kecuali benar-benar dikontrol;
- gunakan immutable release directory atau image;
- pastikan Manager app tidak terbuka publik;
- automation harus membaca HTTP status/result deploy, bukan hanya copy file.

### 6.2 Jetty

Jetty sering dipakai sebagai servlet container fleksibel, embedded maupun standalone.

Konsep deployment:

- `webapps/`;
- XML deployment descriptors;
- modules;
- start.ini/start.d;
- base/home separation;
- context path config.

Jetty cocok untuk:

- lightweight servlet runtime;
- embedded advanced customization;
- HTTP/2/TLS use case;
- custom server composition.

Deployment engineer harus memperhatikan:

- module enablement;
- classpath constructed by Jetty start mechanism;
- shared libs vs webapp libs;
- base directory immutability;
- logging and access log config;
- graceful shutdown.

### 6.3 WildFly / JBoss EAP

WildFly/JBoss EAP menyediakan deployment via:

- deployment scanner di standalone mode;
- management CLI;
- management API;
- admin console;
- domain mode server groups.

Contoh CLI mental model:

```bash
# connect
jboss-cli.sh --connect

# deploy to standalone
deploy /path/app.war --force

# undeploy
undeploy app.war

# deploy to server group in domain mode
deploy /path/app.ear --server-groups=main-server-group
```

Konsep penting:

- standalone vs domain mode;
- deployment content repository;
- server groups;
- subsystems;
- modules;
- datasources;
- resource adapters;
- CLI management model;
- deployments can be enabled/disabled;
- marker files for scanner deployments.

Best practice:

- gunakan CLI/API untuk production, bukan scanner directory sebagai mekanisme utama;
- version control server config/subsystem changes;
- avoid ad-hoc module install without documentation;
- treat datasource/JMS/security config as deployment prerequisites;
- domain mode rollout harus punya rollback strategy per server group.

### 6.4 Payara / GlassFish

Payara/GlassFish menyediakan `asadmin` untuk deploy/undeploy/config.

Mental model:

```bash
asadmin deploy --target server app.war
asadmin undeploy app
asadmin list-applications
asadmin create-jdbc-connection-pool ...
asadmin create-jdbc-resource ...
```

Konsep penting:

- domain;
- server instance;
- cluster;
- DAS/domain administration server;
- deployment target;
- resources;
- deployment descriptors;
- classloader delegation settings;
- autodeploy directory.

Best practice:

- prefer `asadmin` scripted deployment untuk production;
- hindari autodeploy mutable di production;
- pastikan deployment target eksplisit;
- externalize resource config;
- validate JDBC/JMS resources sebelum application deploy;
- capture `asadmin` output as deployment evidence.

### 6.5 Open Liberty / WebSphere Liberty

Open Liberty punya model yang lebih configuration-as-code friendly dibanding traditional app server.

Konsep utama:

```text
server.xml
  featureManager
  application config
  datasource config
  library config
  variable config
apps/
  app.war
```

Contoh konseptual:

```xml
<server>
    <featureManager>
        <feature>servlet-6.0</feature>
        <feature>jdbc-4.3</feature>
    </featureManager>

    <httpEndpoint id="defaultHttpEndpoint"
                  httpPort="9080"
                  httpsPort="9443" />

    <webApplication location="app.war" contextRoot="/app" />
</server>
```

Keunggulan deployment Liberty:

- explicit features;
- server.xml bisa version-controlled;
- server package bisa dibuat konsisten;
- cocok untuk container image;
- small runtime footprint relatif terhadap app server tradisional;
- good fit untuk Jakarta EE/MicroProfile workloads.

Risiko:

- feature mismatch;
- server config drift;
- shared library config salah;
- app deploy tapi feature belum enabled;
- dynamic config reload tidak selalu berarti safe production rollout.

### 6.6 WebLogic

WebLogic banyak dipakai di enterprise/regulatory/financial environments.

Konsep deployment:

- Admin Server;
- Managed Servers;
- clusters;
- domains;
- deployment plans;
- WLST scripting;
- console deployment;
- staged/non-staged/external stage mode;
- application versioning;
- shared libraries;
- JDBC data sources;
- JMS servers/modules;
- security realm;
- work managers.

Best practice:

- gunakan WLST atau automation tool, bukan console manual sebagai default;
- simpan deployment plan di version control;
- pahami staging mode;
- jangan deploy langsung ke semua managed server tanpa drain/verification;
- pastikan datasource/JMS/security realm sudah konsisten;
- gunakan application versioning jika tersedia dan sesuai;
- capture deployment task ID/status untuk audit.

### 6.7 WebSphere Traditional

WebSphere traditional punya model enterprise yang kuat tetapi kompleks.

Konsep:

- cell;
- node;
- node agent;
- deployment manager;
- application server;
- cluster;
- virtual host;
- shared libraries;
- classloader mode;
- resource references;
- wsadmin scripting;
- application install/update;
- node sync.

Deployment failure sering berkaitan dengan:

- node synchronization;
- classloader order;
- virtual host mapping;
- context root mismatch;
- resource reference binding;
- shared library scope;
- cluster rollout order;
- old Java/Jakarta/Java EE API level.

Best practice:

- automate via wsadmin/Jython;
- validate node sync;
- make resource bindings explicit;
- document classloader mode;
- avoid manual console-only changes;
- test rollback on same topology, not only local server.

---

## 7. The Central Mental Model: Server Owns the Runtime Boundary

Pada executable JAR, dependency boundary biasanya seperti ini:

```text
app.jar owns:
  - web server
  - framework runtime
  - dependency graph
  - config loading
  - thread pools mostly
  - startup/shutdown hooks
```

Pada app server deployment:

```text
server owns:
  - HTTP connector
  - servlet engine
  - base classloader
  - resource registry
  - transaction manager
  - connection pool
  - security realm
  - session manager
  - deployment lifecycle
  - admin operations

application owns:
  - business classes
  - web descriptors/annotations
  - app-specific dependencies
  - resource references
  - framework bootstrapping
```

Implikasi:

1. Deployment bukan hanya artifact.
2. Deployment juga harus mencakup server configuration.
3. Aplikasi bisa gagal karena resource server salah walau artifact benar.
4. Server bisa gagal karena aplikasi membawa dependency yang konflik.
5. Rollback aplikasi tidak selalu mengembalikan server state.
6. Upgrade server bisa memecahkan aplikasi lama.
7. Upgrade aplikasi bisa memerlukan config server baru.

Top engineer tidak bertanya hanya:

> “WAR-nya sudah deploy?”

Ia bertanya:

> “Apakah artifact, server config, runtime libraries, resource bindings, traffic route, session model, database compatibility, dan observability semuanya berada di versi yang konsisten?”

---

## 8. Deployment Descriptors and Annotations

Java web/enterprise deployment historically menggunakan XML descriptors. Modern Java banyak memakai annotations. Keduanya masih relevan.

### 8.1 `web.xml`

`web.xml` mendefinisikan:

- servlets;
- filters;
- listeners;
- servlet mappings;
- session config;
- error pages;
- welcome files;
- security constraints;
- resource references;
- context params.

Contoh:

```xml
<web-app>
    <display-name>my-app</display-name>

    <context-param>
        <param-name>app.environment</param-name>
        <param-value>uat</param-value>
    </context-param>

    <resource-ref>
        <description>Application datasource</description>
        <res-ref-name>jdbc/AppDS</res-ref-name>
        <res-type>javax.sql.DataSource</res-type>
        <res-auth>Container</res-auth>
    </resource-ref>

    <session-config>
        <session-timeout>30</session-timeout>
    </session-config>
</web-app>
```

Pada Jakarta EE modern, namespace/package berubah dari `javax.*` ke `jakarta.*`, tetapi deployment descriptor tetap menjadi kontrak penting, terutama untuk aplikasi legacy.

### 8.2 Server-Specific Descriptors

Setiap vendor bisa punya descriptor tambahan.

Contoh konseptual:

```text
Tomcat:
  META-INF/context.xml
  conf/Catalina/localhost/app.xml

WildFly/JBoss:
  jboss-web.xml
  jboss-deployment-structure.xml

WebLogic:
  weblogic.xml
  weblogic-application.xml
  deployment plan

WebSphere:
  ibm-web-bnd.xml
  ibm-application-bnd.xml

Payara/GlassFish:
  glassfish-web.xml
  glassfish-application.xml
```

Descriptor ini bisa mengatur:

- context root;
- resource binding;
- classloader behavior;
- session cookie;
- security role mapping;
- shared library;
- module exclusions;
- virtual host;
- EJB/JMS mapping.

Prinsip:

> Server-specific descriptor adalah bagian dari deployment contract, bukan file sampingan yang boleh tidak diketahui pipeline.

### 8.3 Annotation Scanning

Modern apps memakai annotations:

- `@WebServlet`;
- `@WebFilter`;
- `@WebListener`;
- `@ApplicationPath`;
- `@Path`;
- `@Inject`;
- `@PersistenceUnit`;
- `@Resource`;
- `@RolesAllowed`.

Annotation scanning membuat konfigurasi lebih ringkas, tapi deployment startup bisa lebih berat dan failure bisa lebih implicit.

Failure mode:

- annotation tidak discan karena JAR tidak masuk scan path;
- dependency tidak punya index yang diharapkan;
- duplicate initializer;
- framework scanning seluruh classpath dan startup lambat;
- package mismatch `javax` vs `jakarta`;
- class scanning gagal karena optional dependency missing.

Deployment engineer perlu tahu cara membaca startup log untuk melihat apa yang didaftarkan server.

---

## 9. Classloading in App Server Deployment

Part 11 sudah membahas classpath/module/classloader failure modes. Di sini kita fokus pada app server.

### 9.1 Typical Webapp Classloader Hierarchy

Secara konseptual:

```text
Bootstrap / Platform ClassLoader
        |
        +-- Server/Common ClassLoader
                |
                +-- WebApp ClassLoader: app-a.war
                |
                +-- WebApp ClassLoader: app-b.war
```

Di Tomcat, misalnya, library di `WEB-INF/classes` dan `WEB-INF/lib` visible untuk webapp itu sendiri, sedangkan `tomcat/lib` visible sebagai common library.

Pada application server, hierarchy bisa lebih kompleks:

```text
JDK
 |
 +-- Server modules
      |
      +-- Jakarta API modules
      +-- implementation modules
      +-- datasource drivers
      +-- JMS provider
      +-- security modules
      |
      +-- Deployment EAR ClassLoader
            |
            +-- WAR ClassLoader
            +-- EJB Module ClassLoader
```

### 9.2 Parent-First vs Child-First

Classloader bisa memakai strategi:

```text
Parent-first:
  ask parent first, then app

Child-first:
  ask app first, then parent
```

Parent-first umum untuk mencegah aplikasi override server classes.

Child-first kadang dipakai agar aplikasi bisa membawa dependency sendiri.

Keduanya punya risiko:

| Strategy | Risiko |
|---|---|
| Parent-first | aplikasi tidak bisa memakai versi library lebih baru karena server menyediakan versi lama |
| Child-first | aplikasi bisa menimpa API/server library dan merusak contract runtime |

### 9.3 Provided Dependencies

Saat build WAR, dependency bisa diberi scope `provided`.

Contoh Maven:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.0.0</version>
    <scope>provided</scope>
</dependency>
```

Artinya dependency dibutuhkan saat compile, tapi tidak dibundel ke WAR karena server menyediakannya.

Kesalahan umum:

- Servlet API dibundel ke `WEB-INF/lib` sehingga konflik dengan container;
- Jakarta API version tidak cocok dengan server;
- dependency yang seharusnya dibundel malah `provided` sehingga `ClassNotFoundException`;
- library implementation dibundel padahal server sudah punya implementation;
- aplikasi membawa `javax.*` library ke server `jakarta.*`.

### 9.4 Shared Library: Kapan Dipakai?

Shared library di server bisa berguna untuk:

- JDBC driver;
- common enterprise library;
- vendor connector;
- monitoring agent integration;
- shared security provider;
- legacy framework yang harus sama antar app.

Namun shared library juga menciptakan coupling.

Pertanyaan sebelum memakai shared library:

1. Apakah semua aplikasi harus memakai versi yang sama?
2. Apakah upgrade library ini bisa memecahkan banyak aplikasi sekaligus?
3. Apakah library ini bagian dari platform runtime atau bagian dari business app?
4. Siapa owner patching-nya?
5. Apakah rollback aplikasi juga rollback shared library?
6. Apakah dependency transitive-nya diketahui?
7. Apakah library mengandung static global state?

Rule of thumb:

> Dependency business/framework application sebaiknya dibundel di aplikasi. Dependency infrastructure yang benar-benar runtime-provided, seperti JDBC driver dalam server-managed datasource, bisa menjadi shared/server library.

---

## 10. Datasource, JNDI, and Resource Binding

Salah satu alasan memakai app server adalah resource dikelola container.

### 10.1 Application-Managed vs Container-Managed Datasource

Application-managed:

```text
Application creates HikariCP/DataSource itself
  - DB URL in app config
  - credentials in app secrets
  - pool lifecycle in app
```

Container-managed:

```text
Server defines DataSource
  - DB URL in server config
  - credentials in server secret/config
  - pool lifecycle in server
  - app looks up via JNDI/resource-ref
```

Keduanya valid.

Container-managed datasource cocok saat:

- enterprise platform mengelola DB pools centrally;
- datasource reused by multiple apps;
- transaction manager/JTA integration dibutuhkan;
- credentials harus dikelola oleh ops/server team;
- app server menyediakan monitoring pool;
- deployment harus align dengan governance.

Application-managed datasource cocok saat:

- app self-contained;
- satu service satu DB;
- container/Kubernetes secret model digunakan;
- Spring Boot/HikariCP already standardized;
- app team owner penuh konfigurasi.

### 10.2 JNDI Namespaces

JNDI name bisa membingungkan.

Contoh nama:

```text
java:comp/env/jdbc/AppDS
java:/jdbc/AppDS
java:jboss/datasources/AppDS
jdbc/AppDS
```

Konsep:

- `java:comp/env` biasanya environment naming context milik aplikasi/component;
- server global namespace bisa vendor-specific;
- descriptor dapat memetakan resource-ref aplikasi ke actual server resource.

Failure mode:

```text
App expects: java:comp/env/jdbc/AppDS
Server has:   java:/jdbc/AppDS
Binding missing -> NamingException
```

Atau:

```text
App uses direct lookup java:/jdbc/AppDS
Works on WildFly
Fails on Tomcat/WebLogic/Liberty
```

Best practice:

- aplikasi memakai logical resource reference;
- binding ke physical resource dikelola descriptor/server config;
- hindari hardcoded vendor-specific JNDI name dalam business code;
- buat naming convention environment-wide;
- test lookup saat startup dengan error eksplisit.

### 10.3 Datasource Deployment Prerequisites

Sebelum deploy aplikasi, pastikan:

- JDBC driver tersedia di server/module;
- datasource object defined;
- credential valid;
- DB reachable dari server;
- pool min/max size sesuai;
- validation query/test connection benar;
- transaction isolation sesuai;
- timezone/session settings benar;
- schema/user permission benar;
- connection leak detection aktif bila tersedia;
- metrics/logging pool tersedia.

Deployment sequence:

```text
1. Install JDBC driver/module
2. Configure datasource
3. Test connection from server
4. Deploy application
5. Verify app lookup and query
6. Monitor pool metrics
```

Anti-pattern:

```text
Deploy WAR first, then manually create datasource after 500 error appears.
```

---

## 11. Transaction Management and Deployment Coupling

Application server sering menyediakan JTA transaction manager.

Deployment decision:

```text
Local transaction:
  App controls transaction against one DB/resource.

Container-managed/JTA transaction:
  Server manages transaction boundary, possibly across resources.
```

JTA relevan untuk:

- EJB container-managed transactions;
- multiple XA resources;
- JMS + DB atomicity;
- distributed transaction;
- enterprise integration.

Deployment implications:

- datasource must be XA or non-XA according to transaction design;
- transaction timeout server-level bisa memotong request;
- recovery logs harus punya persistent storage;
- transaction manager config bagian dari deployment readiness;
- rollback/upgrade tidak boleh menghapus transaction recovery state sembarangan.

Failure mode:

- app works in local dev with non-XA datasource;
- production uses JTA transaction;
- DB/JMS resource not XA compatible;
- transaction commit fails partially;
- recovery required.

Top engineer selalu menanyakan:

> Apakah aplikasi ini memakai transaksi lokal, container-managed transaction, atau distributed transaction? Deployment config-nya sesuai tidak?

---

## 12. Security Realm and Authentication Binding

Pada app server, authentication/authorization bisa container-managed.

Contoh:

- form login via container;
- BASIC auth;
- client cert auth;
- LDAP realm;
- JAAS realm;
- SAML/OIDC integration via server;
- role mapping descriptor;
- security constraints in `web.xml`.

Deployment-sensitive aspects:

- realm exists;
- users/groups mapping valid;
- app roles mapped to enterprise groups;
- TLS/cert configured;
- session cookie settings correct;
- SameSite/Secure/HttpOnly set;
- reverse proxy headers trusted correctly;
- logout behavior consistent;
- single sign-on session boundary known.

Failure mode:

- role names in app differ from server group names;
- app deploys but every endpoint returns 403;
- login works on one node but fails on another because realm config drift;
- cookie path/domain wrong after context root change;
- TLS termination at LB but server thinks request is HTTP, so secure cookies not issued.

Deployment must include security binding verification, not only app startup.

---

## 13. Context Path, Virtual Host, Reverse Proxy, and URL Contract

WAR deployment exposes a context path.

Examples:

```text
ROOT.war       -> /
app.war        -> /app
aceas.war      -> /aceas
custom config  -> /custom/path
```

But public URL can be different:

```text
Public:
  https://eservice.example.gov/aceas

Load balancer:
  forwards to app-server.internal:8080/aceas

Server:
  context path /aceas
```

Deployment risks:

- context path changes break bookmarks/API clients;
- reverse proxy strips prefix but app expects prefix;
- app generates absolute URLs incorrectly;
- redirect loops due to scheme mismatch;
- SameSite/cookie path wrong;
- WebSocket upgrade path not forwarded;
- actuator/admin path exposed accidentally;
- static resources cached under old path.

Checklist:

- public base URL defined;
- context root defined;
- proxy path rewrite documented;
- `X-Forwarded-*` / `Forwarded` handling configured;
- redirect URL tested;
- cookie path/domain tested;
- WebSocket tested if applicable;
- health endpoint path known;
- error pages do not leak internal path.

---

## 14. Hot Deploy, Auto Deploy, and Why Production Is Different

Hot deploy means server can deploy/redeploy application while running.

Auto deploy means server watches a directory and deploys changes automatically.

These are convenient in development. In production, they are dangerous unless controlled.

### 14.1 Why Hot Deploy Is Attractive

- no full server restart;
- faster developer feedback;
- less downtime for single app server;
- convenient for admin console workflows;
- can update one app among many.

### 14.2 Why Hot Deploy Is Risky

Risk 1 — Classloader leak.

```text
old WebAppClassLoader cannot be GC-ed
because app left thread/static/ThreadLocal/MBean reference
```

Risk 2 — Partial state.

```text
old app stopped halfway
new app starts
background job from old app still running
```

Risk 3 — Resource leakage.

```text
JDBC driver not deregistered
executor not shutdown
timer thread alive
```

Risk 4 — In-flight requests killed.

```text
user submits transaction
redeploy interrupts app
transaction unknown outcome
```

Risk 5 — Scanner race.

```text
large WAR copy begins
scanner detects incomplete file
server attempts deployment
failure or corrupt deploy state
```

Risk 6 — Hidden version skew.

```text
shared server lib changed
app redeployed
other app now sees different behavior
```

### 14.3 Production Principle

> Hot deployment capability does not mean hot deployment is operationally safe.

Safer production pattern:

```text
1. Remove node from load balancer
2. Drain traffic
3. Stop application/server or disable deployment
4. Deploy artifact atomically
5. Start application/server
6. Run smoke checks
7. Rejoin load balancer
8. Repeat node by node
```

In Kubernetes:

```text
1. Build image with server + app
2. Roll out new pods
3. Readiness gates traffic
4. Termination grace drains old pods
5. Rollback to previous image if needed
```

---

## 15. Rolling Restart with Servlet/App Server

Rolling restart is the common zero/minimal downtime approach.

### 15.1 Basic Algorithm

```text
For each node in cluster:
  1. Mark node out-of-service in load balancer
  2. Wait until active requests drain
  3. Stop app/server gracefully
  4. Deploy new artifact/config
  5. Start app/server
  6. Wait for readiness
  7. Run smoke test against node
  8. Return node to load balancer
```

### 15.2 Key Questions

- Does load balancer support drain?
- How long can requests run?
- Are sessions sticky?
- Are sessions replicated?
- Does app have background jobs?
- Is DB schema backward-compatible?
- Can old and new versions run at the same time?
- Are cache keys compatible?
- Are message formats compatible?
- Is there a batch process that must be paused?

### 15.3 Version Skew

During rolling deployment:

```text
Time T:
  Node-1 runs v2
  Node-2 runs v1
  Node-3 runs v1
```

This temporary version skew is safe only if:

- API contracts backward compatible;
- DB schema compatible with both v1 and v2;
- session serialization compatible;
- cache values compatible;
- message/event schema compatible;
- feature flags handle partial rollout;
- shared resources not changed incompatibly.

If not safe, use blue-green or maintenance window.

---

## 16. Session Management During Deployment

Servlet apps often use HTTP sessions. Deployment can break user continuity.

### 16.1 Session Storage Models

| Model | Description | Deployment impact |
|---|---|---|
| In-memory local session | Session stored in one JVM | restart loses session |
| Sticky session | LB routes user to same node | node restart loses session unless drain/relogin acceptable |
| Replicated session | session copied among cluster nodes | serialization/version compatibility needed |
| External session store | Redis/DB/session service | app version compatibility still needed |
| Stateless token | state mostly client-side/token | less session deployment risk, but token compatibility matters |

### 16.2 Session Serialization

If session replication or persistence is used, session attributes must be serializable and version-compatible.

Failure mode:

```text
v1 stores com.app.UserSession with field A
v2 expects field B or changed serialVersionUID
session deserialization fails after node switch
```

Best practice:

- keep session small;
- avoid storing entity objects;
- avoid storing framework objects;
- use stable DTOs;
- define serialization strategy;
- test session compatibility across versions;
- prefer external identity + small server state;
- consider forced relogin for breaking changes with user communication.

### 16.3 Session During Rolling Deployment

Scenario:

```text
User session starts on Node-1 v1
Node-1 removed for deployment
LB routes user to Node-2 v1 or v2
Session may be missing/incompatible
```

Options:

1. Sticky drain until session idle.
2. Session replication.
3. External session store.
4. Stateless auth token.
5. Maintenance window with logout warning.
6. Blue-green with session stickiness to color.

There is no universal best answer. The right answer depends on business tolerance.

For regulatory/case management systems, session loss might be acceptable if draft state is persisted safely. But transaction interruption during submission is not acceptable.

---

## 17. Background Jobs, Schedulers, and Message Consumers

WAR/EAR deployments often include background behavior:

- scheduled jobs;
- Quartz;
- EJB timers;
- JMS listeners;
- Kafka/RabbitMQ consumers;
- batch jobs;
- cache refreshers;
- polling loops;
- async executors.

Deployment risk:

```text
HTTP traffic drained, but background consumer still processes messages.
```

Or:

```text
Two nodes start same scheduler after deployment and duplicate work.
```

Checklist:

- Are jobs enabled on every node?
- Is there leader election?
- Is there a DB lock/distributed lock?
- Are jobs idempotent?
- Does undeploy stop jobs?
- Does redeploy cancel timers?
- Are message consumers paused before deployment?
- Is preStop/shutdown hook long enough?
- Is duplicate processing acceptable?
- Are old and new consumer versions compatible with queue messages?

Deployment strategy for stateful/background apps:

```text
1. Pause scheduler/consumer
2. Drain in-flight work
3. Deploy app
4. Verify app readiness
5. Resume scheduler/consumer
6. Monitor duplicate/error metrics
```

If using app server-managed JMS/EJB timers, server-specific tooling may be needed to pause/resume or inspect state.

---

## 18. Shared Server Configuration as a Deployable Artifact

A WAR alone is not enough. Server config is part of release.

Server config includes:

- ports/connectors;
- thread pools;
- datasource;
- JMS resources;
- mail session;
- security realm;
- SSL certificates;
- virtual hosts;
- context roots;
- shared libraries;
- work managers;
- transaction timeouts;
- session manager;
- logging config;
- access log config;
- classloader settings;
- deployment descriptors/plans.

Maturity levels:

### Level 0 — Manual Console

Admin clicks through console. No script. No reproducibility.

Risk: high.

### Level 1 — Manual with Checklist

Human follows documented steps.

Risk: still high, but better.

### Level 2 — Scripted CLI

`asadmin`, `jboss-cli`, `wsadmin`, `wlst`, shell scripts.

Risk: medium; reproducibility improves.

### Level 3 — Version-Controlled Config

Server config files/scripts stored in Git. Artifact and config versions linked.

Risk: lower.

### Level 4 — Immutable Runtime Image

Server + app + config built into image/package. Runtime mutation minimized.

Risk: lower; cloud-native friendly.

### Level 5 — Declarative Platform

Deployment state defined declaratively and reconciled by platform.

Risk: lowest if governance and rollback are mature.

Top 1% engineer pushes app server deployment from Level 0/1 toward Level 3/4/5.

---

## 19. Deployment Plans and Environment Overrides

Application server deployment often needs environment-specific values:

- datasource JNDI target;
- context root;
- virtual host;
- security role mapping;
- external endpoint;
- mail session;
- timeout;
- classloader setting.

Bad approach:

```text
Edit WAR contents per environment.
```

Why bad:

- artifact differs between UAT and PROD;
- checksum cannot prove promotion;
- emergency fix becomes untraceable;
- rollback artifact uncertain.

Better approach:

```text
Same artifact promoted across environments.
Environment-specific binding lives in deployment plan/server config.
```

Example conceptual matrix:

| Item | DEV | UAT | PROD |
|---|---|---|---|
| Artifact | same build promoted | same | same |
| DB binding | jdbc/AppDS -> DEV DB | jdbc/AppDS -> UAT DB | jdbc/AppDS -> PROD DB |
| Context root | /app | /app | /app |
| External API | sandbox | staging | prod |
| Credentials | environment secret | environment secret | environment secret |
| Logging | verbose | normal | normal/audited |

Invariant:

> Build once. Promote the same artifact. Bind differently per environment through controlled config.

---

## 20. WAR/EAR Versioning and Release Identity

A WAR file name like `app.war` is not enough.

You need release identity.

Recommended metadata:

- application name;
- version;
- build number;
- Git commit SHA;
- build timestamp;
- Java target version;
- dependency BOM/version;
- server compatibility;
- schema migration version;
- config version;
- SBOM reference;
- checksum.

Possible places:

- `META-INF/MANIFEST.MF`;
- `/actuator/info` or custom `/version` endpoint;
- startup log;
- deployment descriptor;
- CI/CD metadata;
- artifact repository metadata;
- container image labels;
- release note.

Example manifest:

```text
Implementation-Title: aceas-case-management
Implementation-Version: 2.14.7
Build-Commit: abc123def456
Build-Time: 2026-06-18T10:15:00Z
Built-By: ci
Java-Target: 21
Deployment-Profile: war-tomcat
```

Deployment verification should answer:

```text
What exact version is running on node-1?
What exact version is running on node-2?
Does it match the approved release?
```

---

## 21. Artifact Promotion Model

Bad model:

```text
Build separately for DEV
Build separately for UAT
Build separately for PROD
```

Better model:

```text
Build once -> artifact repository -> promote artifact
```

Flow:

```text
Source commit
  -> CI build
  -> unit/integration tests
  -> package WAR/EAR
  -> generate checksum/SBOM
  -> publish to artifact repository
  -> deploy to DEV
  -> promote same artifact to SIT/UAT
  -> approve release
  -> deploy same artifact to PROD
```

Why it matters:

- UAT tests the same binary that will go PROD;
- checksum validates no tampering;
- rollback uses known artifact;
- audit trail is clear;
- environment-specific config is separated.

App server deployments often violate this by manually exporting EAR from IDE or rebuilding per environment. That is not production-grade.

---

## 22. Deployment Automation Patterns

### 22.1 CLI-Based Deployment

Pattern:

```bash
set -euo pipefail

APP_NAME="my-app"
WAR="/artifacts/my-app-2.3.1.war"

# 1. Check server reachable
# 2. Check prerequisites
# 3. Disable app or remove from traffic
# 4. Deploy artifact
# 5. Verify status
# 6. Smoke test
# 7. Record evidence
```

Good automation characteristics:

- idempotent where possible;
- fails fast;
- logs commands and outputs;
- avoids printing secrets;
- validates artifact checksum;
- checks current version;
- can rollback;
- captures deployment status;
- separates dry-run/plan/apply;
- records evidence.

### 22.2 Immutable Image Deployment

Pattern:

```Dockerfile
FROM appserver-runtime:version
COPY app.war /opt/server/apps/app.war
COPY server.xml /opt/server/server.xml
USER nonroot
ENTRYPOINT ["/opt/server/bin/start"]
```

This works well for:

- Open Liberty;
- Tomcat;
- Jetty;
- WildFly bootable JAR/server image variants;
- custom standardized app server images.

Pros:

- artifact and server config versioned together;
- no mutable runtime deployment;
- Kubernetes-friendly;
- rollback by image tag/digest;
- reproducible.

Cons:

- image rebuild required for app change;
- secrets must not be baked;
- app server mutable features may not fit;
- admin console deployment becomes anti-pattern.

### 22.3 Blue-Green with App Server

```text
Blue cluster: current version
Green cluster: new version

1. Deploy to green
2. Verify green internally
3. Switch traffic
4. Monitor
5. Keep blue for rollback window
6. Decommission blue
```

Good for:

- non-compatible rolling changes;
- high-risk release;
- session cutover controlled;
- need fast rollback.

Challenge:

- DB schema must support both or migration must be coordinated;
- external callbacks/webhooks may need routing;
- background jobs must not run in both colors unless designed;
- cache/session separation may be needed.

---

## 23. App Server Deployment and Database Migration

App server deployment rarely stands alone. It often goes with schema/data changes.

Important principle:

> Rolling application deployment requires backward-compatible database migration.

If old and new app versions overlap, DB must support both.

Safe sequence example:

```text
Release N:
  1. Add nullable column/new table
  2. Deploy app version that can write/read both old/new shape
  3. Backfill data
  4. Switch reads to new shape

Release N+1:
  5. Remove old code path
  6. Drop old column only after no old app version remains
```

Unsafe sequence:

```text
1. Drop column used by v1
2. Rolling deploy v2
3. Some nodes still v1 -> runtime SQL error
```

With app server cluster, version skew can last longer than expected because:

- node restart slow;
- deployment failed on one node;
- manual rollback partial;
- stuck session on old node;
- background job still running old code.

Database-aware deployment must include a version compatibility matrix.

---

## 24. Production Readiness Checks Before Deploying WAR/EAR

Before deployment, verify:

### 24.1 Artifact Checks

- artifact exists in repository;
- checksum matches approved release;
- version metadata present;
- no environment-specific hardcoding;
- dependencies scoped correctly;
- no duplicate server APIs bundled;
- Jakarta/Javax compatibility confirmed;
- manifest has build identity;
- SBOM generated if required.

### 24.2 Server Checks

- target server version compatible;
- Java version compatible;
- required features/subsystems enabled;
- datasource configured;
- JMS resources configured;
- security realm configured;
- shared libraries installed;
- ports/connectors healthy;
- disk space enough;
- heap/native memory enough;
- logs writable;
- temp/work dirs writable;
- admin API reachable;
- backup/rollback artifact available.

### 24.3 Environment Checks

- DB migration state correct;
- external APIs reachable;
- certificates valid;
- secrets valid;
- DNS/load balancer route correct;
- firewall/security group open;
- monitoring active;
- alert suppression/escalation plan known;
- maintenance window approved if needed.

### 24.4 Application Checks

- startup time known;
- health endpoint exists;
- smoke test defined;
- session behavior understood;
- background jobs controlled;
- feature flags set;
- cache compatibility known;
- rollback compatibility known.

---

## 25. Deployment Verification After WAR/EAR Deployment

Deployment is not complete when CLI says success.

Verification layers:

```text
Layer 1: Server accepted artifact
Layer 2: Application context started
Layer 3: Resource lookup succeeded
Layer 4: Health endpoint returns OK
Layer 5: Business smoke test passes
Layer 6: Logs show no startup errors
Layer 7: Metrics stable
Layer 8: Traffic successfully served
Layer 9: No hidden background failures
```

### 25.1 Example Smoke Test

For a case management app:

```text
1. GET /health
2. GET /version
3. Login through configured auth path
4. Open dashboard
5. Search known non-sensitive test record
6. Create draft/test transaction in test mode
7. Verify DB write/read
8. Verify audit log produced
9. Verify email/queue action disabled or mocked in UAT if needed
```

### 25.2 Logs to Check

- deployment start/complete;
- classloading warnings;
- missing resource warnings;
- datasource pool creation;
- JPA/Hibernate startup;
- CDI/Spring context startup;
- servlet mapping;
- security realm mapping;
- background job start;
- error stack traces;
- memory leak warnings on redeploy;
- thread leak warnings;
- failed listener startup;
- failed filter init;
- failed JNDI lookup.

### 25.3 Metrics to Check

- request rate;
- error rate;
- response time;
- active threads;
- DB pool active/idle/wait;
- heap/non-heap usage;
- GC pause;
- CPU;
- session count;
- queue consumer lag;
- job failure count;
- connection errors;
- login failure rate.

---

## 26. Rollback Engineering

Rollback in app server deployment is deceptively hard.

### 26.1 Simple Rollback

Simple if:

- only WAR changed;
- no DB migration breaking old version;
- no server config changed;
- no shared library changed;
- no session serialization changed;
- no external API contract changed.

Flow:

```text
1. Remove node from traffic
2. Undeploy v2
3. Deploy v1
4. Verify
5. Return to traffic
```

### 26.2 Complex Rollback

Complex if release changed:

- DB schema;
- data shape;
- server config;
- datasource;
- shared library;
- security realm;
- cache format;
- session object;
- message schema;
- external integration.

In this case, rollback may be impossible or unsafe. You may need roll-forward fix.

### 26.3 Rollback Checklist

Before production release, answer:

- What exact artifact is previous version?
- Is previous artifact still available?
- Can previous version run with current DB schema?
- Can previous version read new data written by new version?
- Can sessions created by new version be read by old version?
- Did server config change?
- Did shared library change?
- Did migration run? Is it reversible?
- Are background jobs idempotent?
- How long does rollback take per node?
- What is rollback trigger threshold?

### 26.4 Rollback Trigger

Define measurable triggers:

```text
Rollback if within 15 minutes:
  - 5xx rate > baseline + threshold
  - login failures spike
  - DB pool waiters > threshold
  - core transaction smoke test fails
  - error logs contain known fatal deployment exception
  - startup fails on more than one node
```

Avoid vague trigger:

```text
Rollback if things look bad.
```

---

## 27. Memory Leaks on Redeploy

Servlet/app server redeploy leaks are classic.

### 27.1 Why Redeploy Leaks Happen

Each deployment has a classloader. On redeploy:

```text
old classloader should become unreachable -> GC removes it
```

But if something still references old classes/classloader, it remains.

Common sources:

- non-daemon thread started by app;
- scheduled executor not shutdown;
- Timer thread;
- ThreadLocal values;
- JDBC driver registered globally;
- logging framework static reference;
- MBean registered but not unregistered;
- shutdown hook;
- static cache;
- classloader stored in global registry;
- third-party library background thread;
- old webapp object referenced by server/global class.

### 27.2 Symptoms

- metaspace grows after every redeploy;
- old app version classes remain in heap dump;
- server eventually OOMs;
- redeploy works a few times then fails;
- logs warn about threads not stopped;
- duplicate scheduled jobs run.

### 27.3 Prevention

- implement lifecycle cleanup;
- close application context;
- shutdown executors;
- remove ThreadLocal;
- deregister JDBC drivers if needed;
- unregister MBeans;
- stop schedulers;
- avoid custom static global registries;
- prefer full process restart for production rollout if leak risk unknown.

### 27.4 Production Rule

> If redeploy leak behavior is not tested, prefer process restart or immutable pod replacement over repeated hot redeploy.

---

## 28. Java 8 to Java 25 Compatibility in App Server Deployment

### 28.1 Java 8 Era

Common characteristics:

- Java EE `javax.*` APIs;
- PermGen already removed in Java 8, but legacy memory assumptions remain;
- older TLS defaults may exist;
- app servers often older;
- classpath-centric deployment;
- reflection access less restricted;
- many apps rely on old libraries.

Deployment concerns:

- old app server support for modern JDK limited;
- TLS/cipher changes when upgrading JDK;
- illegal reflective access warnings not present like later versions;
- dependency upgrades can be large jumps;
- old XML descriptors and vendor bindings.

### 28.2 Java 9–16 Transition

Major impact:

- module system introduced;
- internal JDK APIs encapsulation begins;
- classpath still works but illegal reflective access warnings appear;
- jlink becomes possible;
- app server compatibility with newer JDK becomes vendor-specific.

Deployment concerns:

- app server startup scripts may need module opens/exports;
- frameworks using reflection may need updates;
- old libraries using internal APIs fail.

### 28.3 Java 17 LTS

Java 17 became a common modern baseline.

Deployment impact:

- stronger encapsulation;
- many old Java EE servers not compatible;
- modern Jakarta/Spring versions align better;
- container awareness mature;
- TLS/security defaults changed compared with Java 8.

### 28.4 Java 21 LTS

Java 21 introduced virtual threads as stable, but app server support depends on server/framework.

Deployment impact:

- not every app server automatically benefits from virtual threads;
- server thread pools still matter;
- libraries must be virtual-thread-friendly to benefit;
- Java 21 often pairs with modern Jakarta EE 11/Spring Boot 3.x-era stacks.

### 28.5 Java 25

Java 25 is a modern LTS-era target. Deployment concerns:

- server compatibility must be confirmed explicitly;
- startup scripts/options must be revalidated;
- old `--add-opens` hacks should be reviewed;
- monitoring agents must support JDK 25;
- bytecode target and server runtime must match;
- Jakarta version compatibility matters.

### 28.6 `javax` vs `jakarta`

This is one of the most important deployment compatibility boundaries.

```text
Java EE / older Jakarta EE 8:
  javax.servlet.*
  javax.persistence.*
  javax.inject.*

Jakarta EE 9+:
  jakarta.servlet.*
  jakarta.persistence.*
  jakarta.inject.*
```

You cannot deploy a `jakarta.servlet.*` app to an old `javax.servlet.*` server and expect it to work.

Likewise, a `javax.*` app may not run on a pure Jakarta EE 10/11 server unless compatibility/migration support exists.

Deployment checklist:

- app package namespace;
- server Jakarta/Java EE level;
- dependency scopes;
- descriptors namespace versions;
- framework version;
- test on same server family/version as production.

---

## 29. App Server in Kubernetes: Special Considerations

Many teams put Tomcat/WildFly/Liberty/WebLogic inside Kubernetes.

### 29.1 What Kubernetes Owns vs App Server Owns

```text
Kubernetes owns:
  - pod scheduling
  - restart
  - service discovery
  - readiness/liveness routing
  - rollout
  - config/secret injection
  - resource limits

App server owns:
  - servlet/app lifecycle
  - internal resources
  - classloading
  - session manager
  - connection pools
  - transaction manager
```

Avoid double-control conflicts.

Example conflict:

```text
App server cluster tries to manage node membership
Kubernetes also kills/replaces pods dynamically
Session replication assumes stable nodes
```

### 29.2 Immutable Deployment

Recommended:

```text
image digest = app server + app artifact + baseline config
runtime config = injected via env/volume/secret
```

Avoid:

```text
kubectl exec into pod and deploy WAR through admin console
```

Why:

- pod can disappear;
- deployment not reproducible;
- rollout state unknown;
- rollback impossible by image;
- audit weak.

### 29.3 Probes

Probe design must reflect app server lifecycle.

Bad readiness:

```text
GET / returns 200 from server default page
```

This can pass even when app failed to deploy.

Better readiness:

```text
GET /app/health/ready
```

It should verify:

- application context started;
- datasource reachable if required;
- critical resources bound;
- not currently draining;
- background startup completed if required.

### 29.4 Termination

Kubernetes sends SIGTERM to the process. App server must shut down gracefully.

Need:

- proper ENTRYPOINT not swallowing signals;
- terminationGracePeriodSeconds enough;
- preStop hook if needed;
- readiness false before shutdown;
- app server graceful shutdown support;
- HTTP connector drain;
- background consumers pause.

---

## 30. Deployment Anti-Patterns

### Anti-Pattern 1 — Copy WAR Directly to Production Folder Manually

Problem:

- no checksum;
- no audit;
- partial copy risk;
- no rollback certainty;
- human error.

Better:

- deploy via controlled CLI/API or immutable package/image;
- validate artifact checksum;
- record evidence.

### Anti-Pattern 2 — Build Per Environment

Problem:

- UAT artifact not equal PROD artifact;
- bugs hidden;
- audit weak.

Better:

- build once, promote same artifact.

### Anti-Pattern 3 — Put All Dependencies in Server Lib

Problem:

- apps coupled;
- upgrades break unrelated apps;
- classpath conflicts global.

Better:

- app-specific dependencies in app;
- shared only true platform resources.

### Anti-Pattern 4 — Bundle Server APIs in WAR

Problem:

- Servlet/Jakarta API conflicts;
- classloading errors;
- weird behavior across servers.

Better:

- mark container-provided APIs as `provided`.

### Anti-Pattern 5 — Hot Deploy Repeatedly in Production

Problem:

- classloader leak;
- partial state;
- in-flight request risk.

Better:

- drain/restart/roll node by node;
- immutable deployment.

### Anti-Pattern 6 — No Version Endpoint

Problem:

- cannot prove what runs;
- rollback/debug slow.

Better:

- expose version/build metadata safely.

### Anti-Pattern 7 — Deploy App Before Resources

Problem:

- app fails at runtime;
- obscure JNDI errors.

Better:

- provision server resources first;
- validate resource lookup.

### Anti-Pattern 8 — Assume Rolling Is Always Safe

Problem:

- DB/schema/session/message incompatibility.

Better:

- prove version skew compatibility;
- use blue-green/maintenance if not safe.

### Anti-Pattern 9 — Manual Console Changes Not Reflected in Code

Problem:

- config drift;
- disaster recovery impossible;
- environment mismatch.

Better:

- script/config-as-code;
- reconcile actual vs desired config.

### Anti-Pattern 10 — Health Check Only Tests Server, Not App

Problem:

- server alive but application dead.

Better:

- app-level readiness and smoke checks.

---

## 31. Troubleshooting Deployment Failures

### 31.1 Failure: Deployment Rejected Immediately

Possible causes:

- invalid WAR/EAR structure;
- unsupported descriptor version;
- unsupported Java bytecode version;
- missing required module/subsystem;
- duplicate context path;
- insufficient permission/disk space;
- corrupted artifact.

Diagnostics:

- server deployment log;
- artifact checksum;
- `jar tf app.war`;
- Java target version;
- server compatibility matrix;
- descriptor validation.

### 31.2 Failure: Deployment Succeeds, App Returns 500

Possible causes:

- missing datasource/JNDI binding;
- DB credential wrong;
- app context partially initialized;
- missing external service config;
- classloading conflict appears only on request;
- security principal/role missing.

Diagnostics:

- first request stack trace;
- startup log warnings;
- JNDI resource list;
- datasource test;
- dependency tree;
- server classloader logs if available.

### 31.3 Failure: App Starts But Login Fails

Possible causes:

- security realm mismatch;
- LDAP/OIDC config wrong;
- proxy header/scheme issue;
- cookie Secure/SameSite/path issue;
- session replication issue;
- role mapping mismatch.

Diagnostics:

- auth logs;
- browser cookie inspection;
- redirect URL;
- role/group mapping;
- server security config;
- proxy forwarding config.

### 31.4 Failure: Only One Node Fails

Possible causes:

- config drift;
- different server library;
- node not synced;
- stale work/temp directory;
- different Java version;
- different env var;
- file permission;
- datasource not configured on that node.

Diagnostics:

- compare server config;
- compare Java version;
- compare artifact checksum;
- compare shared libs;
- clear temp/work only with procedure;
- validate node sync.

### 31.5 Failure: Redeploy Works But Memory Grows

Possible causes:

- classloader leak;
- thread leak;
- ThreadLocal leak;
- MBean leak;
- JDBC driver leak;
- static cache.

Diagnostics:

- heap dump;
- class histogram;
- metaspace trend;
- thread dump;
- app server leak warnings;
- old classloader references.

### 31.6 Failure: Rollback Deploys But App Still Broken

Possible causes:

- DB migration not rolled back;
- shared library still new;
- server config changed;
- cache contains new format;
- session contains new object shape;
- external system now points to new URL/contract.

Diagnostics:

- release diff across artifact/config/db/cache;
- version endpoint;
- schema version;
- server library list;
- cache/session invalidation plan.

---

## 32. Production Deployment Checklist

### 32.1 Pre-Deployment

```text
[ ] Release approved
[ ] Artifact checksum verified
[ ] Artifact version metadata present
[ ] Same artifact promoted from lower env
[ ] Server version compatible
[ ] Java version compatible
[ ] Jakarta/Javax namespace compatible
[ ] Required server features/subsystems enabled
[ ] Datasource configured and tested
[ ] JMS/resources configured and tested
[ ] Security realm/role mapping verified
[ ] Certificates/secrets valid
[ ] DB migration plan approved
[ ] Rollback plan approved
[ ] Background jobs/consumers plan defined
[ ] Session strategy understood
[ ] Load balancer drain procedure ready
[ ] Smoke tests ready
[ ] Monitoring dashboard ready
[ ] Logs accessible
[ ] Previous artifact available
```

### 32.2 Deployment Execution

```text
[ ] Announce/start window if required
[ ] Disable scheduler/consumer if required
[ ] Remove first node from traffic
[ ] Drain active requests
[ ] Stop app/server or disable deployment
[ ] Deploy new artifact/config
[ ] Start app/server
[ ] Verify deployment status
[ ] Verify version endpoint
[ ] Run node-level smoke test
[ ] Check logs for fatal errors
[ ] Return node to traffic
[ ] Repeat for remaining nodes
[ ] Re-enable scheduler/consumer if required
```

### 32.3 Post-Deployment

```text
[ ] Global smoke test passed
[ ] Error rate normal
[ ] Latency normal
[ ] DB pool normal
[ ] CPU/memory normal
[ ] Session/login normal
[ ] Background jobs normal
[ ] Queue lag normal
[ ] No unexpected classloading warnings
[ ] No memory leak warnings
[ ] Deployment evidence captured
[ ] Release note updated
[ ] Monitoring window completed
```

---

## 33. Decision Framework: WAR/EAR App Server vs Executable JAR

Use app server deployment when:

- enterprise platform standard already exists;
- app requires full Jakarta EE services;
- JTA/JMS/EJB/resource adapter integration is central;
- centralized datasource/security governance is required;
- multiple apps share managed runtime intentionally;
- vendor support/compliance requires it;
- legacy apps cannot be migrated yet;
- operations team has mature app server automation.

Use executable JAR/containerized service when:

- one app = one process is desired;
- app team owns runtime/dependency lifecycle;
- cloud-native deployment is primary;
- independent release cadence matters;
- app does not need heavy container-managed enterprise features;
- runtime isolation per service is important;
- Kubernetes handles orchestration;
- Spring Boot/Micronaut/Quarkus model fits.

Use hybrid app server-in-container when:

- legacy WAR/EAR must move to Kubernetes;
- app server services still needed;
- immutable image can be built;
- app server clustering is simplified or replaced by platform orchestration;
- team has clear boundary between Kubernetes and app server responsibilities.

---

## 34. Worked Example: Deploying a WAR to a Tomcat Cluster Safely

Scenario:

```text
App: case-management.war
Runtime: Tomcat on 2 VMs
LB: HTTPS reverse proxy
DB: Oracle datasource configured via JNDI
Session: sticky session, no replication
Deployment target: UAT
```

### 34.1 Pre-Deployment Plan

```text
Artifact:
  case-management-3.8.2.war
  checksum: approved
  Java target: 17
  Servlet API: provided

Server:
  Tomcat version compatible
  JDK 17 installed
  jdbc/CaseDS configured
  context path /case

Traffic:
  drain node before deployment
  sticky session enabled
  active users notified if needed

Rollback:
  case-management-3.8.1.war available
  DB migration backward compatible
```

### 34.2 Execution

```text
Node 1:
  1. Remove from LB
  2. Wait active connections = 0 or timeout
  3. Stop Tomcat
  4. Move old WAR to backup/release dir
  5. Copy new WAR atomically
  6. Start Tomcat
  7. Verify /case/health
  8. Verify /case/version shows 3.8.2
  9. Run login/search smoke test
  10. Add back to LB

Node 2:
  Repeat
```

### 34.3 Verification

```text
Global:
  - public URL works
  - login works
  - case search works
  - create draft works
  - audit trail generated
  - logs clean
  - DB pool normal
  - error rate normal
```

### 34.4 Risk Notes

Because session is sticky but not replicated:

- active users on node being drained should finish or be routed carefully;
- if node is stopped while session active, user may need relogin;
- draft/transaction state must be persisted before shutdown.

This is acceptable only if business agrees.

---

## 35. Worked Example: Deploying an EAR to an Application Server Cluster

Scenario:

```text
App: enforcement-suite.ear
Runtime: WildFly/JBoss EAP or WebLogic-like cluster
Modules:
  - web.war
  - service-ejb.jar
  - integration-rar.rar
Resources:
  - XA datasource
  - JMS queue
  - security realm
  - mail session
```

### 35.1 Deployment Preconditions

```text
[ ] XA datasource configured
[ ] Transaction recovery storage configured
[ ] JMS queue/topic exists
[ ] Security roles mapped
[ ] Mail session configured
[ ] Resource adapter deployed if separate
[ ] Server group/cluster target selected
[ ] Old and new app can coexist during rollout or blue-green selected
```

### 35.2 Deployment Risks

- distributed transaction recovery;
- message duplicate processing;
- EJB timer duplication;
- old/new EAR version skew;
- resource adapter version mismatch;
- server group partial deployment;
- domain controller/admin server availability;
- rollback after data migration.

### 35.3 Safer Strategy

For high-risk EAR:

```text
1. Deploy to staging cluster identical to prod
2. Run full smoke + integration test
3. Pause message consumers if needed
4. Deploy to passive/green cluster
5. Verify resources and transactions
6. Switch traffic
7. Resume consumers
8. Monitor transaction/JMS metrics
9. Keep old cluster for rollback window
```

This is often safer than rolling redeploy across active cluster if compatibility is uncertain.

---

## 36. What Top 1% Engineers See That Others Miss

Most engineers see:

```text
I have a WAR.
I deploy it to server.
It works or fails.
```

Strong deployment engineers see:

```text
Artifact version
+ server version
+ Java version
+ API namespace
+ classloader boundary
+ resource binding
+ server config
+ external config
+ traffic route
+ session state
+ background workload
+ database schema
+ migration compatibility
+ observability signal
+ rollback path
+ audit evidence
= deployment safety
```

They ask questions before production:

- What owns the datasource: app or server?
- Is this dependency app-local or server-provided?
- Can old and new versions run together?
- What happens to active sessions?
- What happens to active transactions?
- What happens to background consumers?
- Is this deployment reproducible without the admin console?
- Can we prove which version runs on each node?
- Is rollback actually possible or only assumed?
- What signal tells us deployment is bad within 5 minutes?

This is the difference between “developer who can deploy” and “engineer who can operate a production Java platform”.

---

## 37. Reference Commands and Snippets

### 37.1 Inspect WAR Contents

```bash
jar tf app.war | head -100
jar tf app.war | grep 'WEB-INF/lib'
jar xf app.war META-INF/MANIFEST.MF
cat META-INF/MANIFEST.MF
```

### 37.2 Check Java Target Version of Class

```bash
javap -verbose WEB-INF/classes/com/example/App.class | grep 'major version'
```

Mapping examples:

```text
52 = Java 8
55 = Java 11
61 = Java 17
65 = Java 21
69 = Java 25
```

### 37.3 Find Bundled Servlet/Jakarta API Mistakes

```bash
jar tf app.war | grep -E 'WEB-INF/lib/(servlet|jakarta\.servlet|javax\.servlet|jakarta\.ee|javaee)'
```

### 37.4 Check Duplicate Classes Roughly

```bash
mkdir /tmp/warcheck
cd /tmp/warcheck
jar xf /path/app.war
find WEB-INF/lib -name '*.jar' -print > jars.txt

while read j; do
  jar tf "$j" | grep '\.class$' | sed "s#^#$j:#"
done < jars.txt > classes.txt

cut -d: -f2 classes.txt | sort | uniq -d | head -100
```

### 37.5 Tomcat Basic Version Check

```bash
$CATALINA_HOME/bin/version.sh
java -version
```

### 37.6 Generic Node Deployment Skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail

APP="case-management"
VERSION="3.8.2"
WAR="/repo/${APP}-${VERSION}.war"
SHA256_EXPECTED="..."
DEPLOY_DIR="/opt/tomcat/webapps"
BACKUP_DIR="/opt/releases/${APP}/backup"

sha256sum "$WAR"
# compare with expected in real script

mkdir -p "$BACKUP_DIR"

systemctl stop tomcat

if [ -f "${DEPLOY_DIR}/${APP}.war" ]; then
  cp "${DEPLOY_DIR}/${APP}.war" "${BACKUP_DIR}/${APP}-$(date +%Y%m%d%H%M%S).war"
fi

install -m 0644 "$WAR" "${DEPLOY_DIR}/${APP}.war"

systemctl start tomcat

curl -fsS "http://localhost:8080/${APP}/health"
curl -fsS "http://localhost:8080/${APP}/version"
```

This is illustrative. Production script must include LB drain, rollback, logging, secrets safety, and error handling.

---

## 38. App Server Deployment Maturity Model

### Level 1 — Manual Deployment

- Copy WAR manually.
- Console changes undocumented.
- No checksum.
- Rollback by memory.

Risk: very high.

### Level 2 — Scripted Deployment

- CLI deploy script.
- Basic checklist.
- Artifact from repository.
- Manual approval.

Risk: moderate.

### Level 3 — Controlled Release Pipeline

- Build once promote.
- Server config scripted.
- Smoke test automated.
- Rollback scripted.
- Evidence captured.

Risk: lower.

### Level 4 — Immutable Runtime

- Server + app packaged together.
- Config versioned/injected.
- Image/package promotion.
- Environment parity strong.

Risk: low.

### Level 5 — Progressive Delivery and Policy Gates

- Canary/blue-green.
- Automated metrics gate.
- Declarative desired state.
- SBOM/signature verification.
- Full audit traceability.

Risk: lowest, but requires mature platform.

---

## 39. Summary

Application server and servlet container deployment is not obsolete. It remains critical in enterprise Java, especially for legacy systems, regulatory systems, large case-management platforms, government systems, financial systems, and Jakarta EE workloads.

The key lesson is this:

> In WAR/EAR deployment, the deployed application is only half of the runtime. The server configuration, shared libraries, resource bindings, classloader hierarchy, session model, transaction manager, traffic routing, and operational procedure are also part of the release.

A weak engineer thinks deployment means copying an archive.

A strong engineer understands deployment as a state transition across:

```text
artifact
+ server runtime
+ Java runtime
+ server config
+ environment config
+ resources
+ traffic
+ state
+ observability
+ rollback path
```

That is the mental model needed to operate Java app server workloads safely.

---

## 40. References

- Apache Tomcat 11 — Web Application Deployment: https://tomcat.apache.org/tomcat-11.0-doc/deployer-howto.html
- Apache Tomcat 11 — Application Developer's Guide, Deployment: https://tomcat.apache.org/tomcat-11.0-doc/appdev/deployment.html
- WildFly Admin Guide: https://docs.wildfly.org/35/Admin_Guide.html
- WildFly Application Deployment Documentation: https://docs.jboss.org/author/display/WFLY/Application%20deployment.html
- WildFly Deployment Scanner Configuration: https://docs.jboss.org/author/display/WFLY/Deployment%20Scanner%20configuration.html
- Open Liberty Server Configuration Overview: https://openliberty.io/docs/latest/reference/config/server-configuration-overview.html
- Open Liberty `webApplication` Configuration: https://openliberty.io/docs/latest/reference/config/webApplication.html
- Open Liberty Feature Overview: https://openliberty.io/docs/latest/reference/feature/feature-overview.html
- IBM Documentation — Deploying a web application to Liberty: https://www.ibm.com/docs/en/was-liberty/nd?topic=liberty-deploying-web-application
- Payara Server `deploy` command: https://docs.payara.fish/community/docs/Technical%20Documentation/Payara%20Server%20Documentation/Command%20Reference/deploy.html
- Payara Server `undeploy` command: https://docs.payara.fish/community/docs/Technical%20Documentation/Payara%20Server%20Documentation/Command%20Reference/undeploy.html
- Payara Hot Deploy and Auto Deploy Documentation: https://docs.payara.fish/enterprise/docs/Technical%20Documentation/Ecosystem/IDE%20Integration/Hot%20Deploy%20and%20Auto%20Deploy.html

---

## 41. Posisi dalam Series

Kita sudah menyelesaikan:

- Part 0 — Deployment Mental Model
- Part 1 — Java Deployment Evolution: Java 8 to Java 25
- Part 2 — Artifact Taxonomy
- Part 3 — Runtime Selection Engineering
- Part 4 — Java Runtime Layout
- Part 5 — Configuration Deployment
- Part 6 — JVM Options as Deployment Contract
- Part 7 — Packaging for Linux Servers
- Part 8 — Containerizing Java Applications Correctly
- Part 9 — Dockerfile Patterns for Java 8–25
- Part 10 — jlink, jdeps, jpackage, and Custom Runtime Images
- Part 11 — Classpath, Module Path, ClassLoader, and Deployment Failure Modes
- Part 12 — Application Server and Servlet Container Deployment

Berikutnya:

- Part 13 — Spring Boot Deployment Deep Dive

Status series: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Learn Java Deployment Runtime Release Delivery Engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-11-classpath-modulepath-classloader-deployment-failure-modes.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Deployment Runtime Release Delivery Engineering](./learn-java-deployment-runtime-release-delivery-engineering-part-13-spring-boot-deployment-deep-dive.md)

</div>