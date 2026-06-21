# learn-java-eclipse-glassfish-runtime-server-engineering-part-000

# Part 0 — Orientation: GlassFish sebagai Runtime Enterprise, Bukan Sekadar Server Jakarta EE

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Target: Java 8 sampai Java 25  
> Fokus: Eclipse GlassFish sebagai application server/runtime engineering platform  
> Status seri: Part 0 dari 35, belum selesai

---

## 0. Executive Summary

GlassFish sering disalahpahami sebagai “server untuk deploy WAR/EAR”. Pemahaman itu terlalu dangkal. Untuk level engineer senior/principal, GlassFish harus dipahami sebagai **runtime enterprise yang mengkoordinasikan banyak container, service, resource, transaction boundary, security context, thread pool, network listener, deployment lifecycle, dan administrative control plane**.

Kalau Jakarta EE API menjawab pertanyaan:

> “Bagaimana aplikasi menulis kode standar seperti Servlet, CDI, JPA, JAX-RS, EJB, JMS, Security, Validation, Batch, Mail, dan sebagainya?”

Maka GlassFish menjawab pertanyaan yang berbeda:

> “Bagaimana kode standar itu di-host, di-bootstrap, di-wire, diberi resource, diberi thread, diberi transaction manager, diberi security realm, diamati, di-debug, di-scale, di-hardening, dan dioperasikan sebagai sistem hidup?”

Perbedaan ini penting. Banyak engineer bisa menulis endpoint Jakarta REST, entity JPA, atau CDI bean. Namun jauh lebih sedikit yang benar-benar memahami mengapa aplikasi gagal deploy, kenapa pool habis, mengapa class `jakarta.*` bentrok dengan `javax.*`, kenapa redeploy menyebabkan memory leak, mengapa timeout muncul di reverse proxy padahal server masih hidup, atau mengapa cluster terlihat sehat tetapi session failover rusak.

Materi Part 0 ini membangun orientasi besar: apa itu GlassFish, bagaimana posisinya di ekosistem Java, apa bedanya dengan Tomcat/Spring Boot/WildFly/Liberty/Payara/Quarkus, mengapa versi Java 8–25 harus dipetakan hati-hati, serta bagaimana cara berpikir “top 1% engineer” saat menghadapi runtime application server.

---

## 1. Apa Yang Sebenarnya Kita Pelajari di Seri Ini?

Kita **bukan** sedang mengulang Jakarta EE API.

Seri-seri sebelumnya sudah membahas banyak bagian API dan engineering Java enterprise, seperti:

- Servlet dan WebSocket
- JAX-RS / Jersey
- CDI / Dependency Injection
- JPA / Hibernate / EclipseLink
- Jakarta Security
- Jakarta Mail
- Jakarta Batch dan Concurrency
- JSON/XML/Jackson/MapStruct
- Build, deployment, observability, Quarkus, dan lainnya

Maka seri GlassFish ini akan mengambil sudut yang berbeda.

Kita akan mempelajari GlassFish sebagai:

1. **Application server** — host untuk aplikasi Jakarta EE.
2. **Container runtime** — menjalankan web container, EJB container, CDI container, JPA provider integration, JMS service, transaction service, security service, connector service, dan lain-lain.
3. **Administrative domain** — memiliki domain, config, instance, cluster, node, target, admin server, dan command surface.
4. **Resource coordinator** — mengatur JDBC pool, JMS connection factory, JNDI binding, transaction enlistment, thread pool, dan work manager.
5. **Failure boundary** — tempat kegagalan aplikasi, dependency, DB, network, classloading, GC, thread starvation, dan configuration drift saling bertemu.
6. **Production runtime** — harus bisa di-monitor, di-hardening, di-tuning, di-upgrade, di-debug, dan dioperasikan dengan aman.

Kalau digambarkan secara mental:

```text
+---------------------------------------------------------------+
|                       Application Code                         |
|  REST, Servlet, CDI, EJB, JPA, JMS, Security, Batch, Mail       |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                     Jakarta EE API Contract                    |
|  Portable interfaces, annotations, lifecycle contracts          |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|                       Eclipse GlassFish                         |
|  Implementation + runtime + admin + resources + containers      |
+-------------------------------+-------------------------------+
                                |
                                v
+---------------------------------------------------------------+
|               JVM / OS / Network / Database / Broker            |
+---------------------------------------------------------------+
```

Engineer biasa sering berhenti di layer “Application Code”. Engineer kuat memahami “Jakarta EE API Contract”. Engineer top-level memahami bagaimana kontrak itu dijalankan oleh GlassFish, lalu menghubungkannya dengan JVM, OS, database, broker, network, deployment pipeline, dan production operation.

---

## 2. GlassFish Dalam Satu Kalimat

**Eclipse GlassFish adalah application server open-source yang mengimplementasikan Jakarta EE platform dan menyediakan runtime lengkap untuk menjalankan aplikasi enterprise Java berbasis standar.**

Namun satu kalimat itu masih terlalu formal. Secara praktis:

> GlassFish adalah “mesin hidup” yang menerima artifact enterprise Java, membaca metadata dan descriptor-nya, membangun graph container dan resource, membuka network listener, menyediakan thread, transaction, security, naming, pooling, messaging, dan lifecycle, lalu menjaga aplikasi tetap berjalan dalam batas konfigurasi domain.

Jadi GlassFish bukan hanya:

```text
java -jar something.jar
```

GlassFish lebih mirip:

```text
runtime kernel
  + admin control plane
  + web container
  + EJB container
  + CDI integration
  + JPA provider integration
  + transaction manager
  + JDBC pool manager
  + JMS/OpenMQ integration
  + JNDI naming service
  + security realms
  + deployment engine
  + monitoring service
  + logging subsystem
  + clustering model
  + asadmin automation surface
```

Inilah kenapa orientasi awal sangat penting. Kalau GlassFish hanya dianggap “tempat deploy WAR”, maka banyak problem production akan terlihat acak. Kalau GlassFish dipahami sebagai runtime graph, problem mulai punya lokasi, boundary, dan causal chain.

---

## 3. Fakta Ekosistem yang Perlu Dipegang

Bagian ini penting karena Java enterprise punya sejarah panjang: Java EE, Jakarta EE, Oracle, Eclipse Foundation, namespace `javax.*`, namespace `jakarta.*`, Payara, GlassFish, TCK, compatible implementation, dan versi JDK yang berbeda-beda.

### 3.1 Dari Java EE ke Jakarta EE

Sebelum Jakarta EE, platform enterprise Java dikenal sebagai **Java EE**. Setelah proses transfer ke Eclipse Foundation, platform berevolusi menjadi **Jakarta EE**.

Dampak paling besar bagi engineer adalah perubahan namespace:

```java
// Era Java EE / Jakarta EE 8 compatibility style
javax.servlet.http.HttpServlet
javax.persistence.Entity
javax.transaction.Transactional
javax.ws.rs.Path

// Era Jakarta EE 9+
jakarta.servlet.http.HttpServlet
jakarta.persistence.Entity
jakarta.transaction.Transactional
jakarta.ws.rs.Path
```

Perubahan ini bukan sekadar rename kosmetik. Ia mempengaruhi:

- source code
- dependency coordinates
- transitive libraries
- deployment descriptors
- generated code
- bytecode references
- annotation scanning
- classloading
- test framework
- vendor integration
- migration strategy

Top-level engineer tidak hanya bertanya “sudah pakai Java berapa?”, tetapi juga:

> “Aplikasi ini masih `javax`, sudah `jakarta`, atau campuran karena transitive dependency?”

Campuran `javax` dan `jakarta` sering menjadi sumber error yang tidak langsung terlihat.

---

### 3.2 GlassFish sebagai Compatible Implementation

GlassFish bukan sekadar server random yang kebetulan bisa menjalankan aplikasi Jakarta EE. GlassFish adalah salah satu runtime penting dalam ekosistem Jakarta EE karena berperan sebagai **compatible implementation** untuk berbagai versi spesifikasi.

Makna praktisnya:

- GlassFish menjalankan TCK/Technology Compatibility Kit untuk membuktikan kesesuaian terhadap spesifikasi.
- GlassFish sering menjadi baseline untuk membuktikan bahwa spesifikasi Jakarta EE bisa diimplementasikan.
- Perilaku GlassFish sering sangat dekat dengan kontrak standar.
- GlassFish berguna untuk memahami “apa yang standar” sebelum membandingkannya dengan runtime lain.

Tetapi jangan salah: compatible implementation bukan berarti otomatis pilihan terbaik untuk semua production workload. Ia berarti runtime tersebut memenuhi kontrak spesifikasi. Untuk production, kita tetap harus menilai:

- support model
- patch cadence
- security response
- operational tooling
- performance behavior
- compatibility kebutuhan organisasi
- team skill
- cloud/container fit
- migration cost

---

### 3.3 GlassFish dan Versi Modern

Secara garis besar:

| GlassFish Line | Platform | Namespace Dominan | JDK Relevan | Catatan Engineering |
|---|---:|---|---|---|
| GlassFish 5.x | Java EE 8 / Jakarta EE 8 compatibility | `javax.*` | Java 8 era | Penting untuk legacy enterprise |
| GlassFish 6.x | Jakarta EE 9 / 9.1 | `jakarta.*` | Java 8/11/17 tergantung minor line | Transisi namespace besar |
| GlassFish 7.x | Jakarta EE 10 | `jakarta.*` | Java 11/17/21, dan line lebih baru menuju Java 25 | Modern Jakarta EE 10 runtime |
| GlassFish 8.x | Jakarta EE 11 | `jakarta.*` | Minimum modern Java, terutama Java 21+ untuk GlassFish 8 release line | Runtime modern Jakarta EE 11 |

Khusus untuk seri ini, kita akan melihat GlassFish dari sudut **Java 8 sampai Java 25**, tetapi bukan berarti satu versi GlassFish akan berjalan optimal di semua Java version. Yang benar adalah:

```text
Java 8  -> relevan untuk aplikasi lama Java EE 8 / GlassFish 4/5 style
Java 11 -> transitional baseline untuk banyak organisasi enterprise
Java 17 -> LTS modern yang luas dipakai
Java 21 -> LTS modern dengan virtual threads dan baseline penting untuk Jakarta EE 11 era
Java 25 -> target modern berikutnya untuk runtime yang sudah kompatibel/teruji
```

Top-level engineer perlu membedakan:

```text
JDK version aplikasi
JDK version server/runtime
Jakarta EE platform version
GlassFish distribution version
library ecosystem compatibility
production certification/support policy
```

Kesalahan umum adalah menggabungkan semuanya dalam satu pertanyaan:

> “Bisa jalan di Java 21 nggak?”

Pertanyaan itu kurang presisi. Yang benar:

> “Aplikasi ini source-nya `javax` atau `jakarta`? Target Jakarta EE version apa? GlassFish line berapa? JDK runtime untuk server berapa? Library transitive-nya sudah compatible? Deployment descriptor-nya sudah migrated? Provider JPA/JDBC/security-nya cocok?”

---

## 4. GlassFish Bukan Jakarta EE API

Ini fondasi paling penting.

### 4.1 Jakarta EE API Adalah Kontrak

Contoh API:

```java
@Path("/cases")
public class CaseResource {
    @GET
    public List<CaseDto> listCases() {
        return service.findAll();
    }
}
```

Kode di atas menyatakan kontrak:

- ada resource REST
- path `/cases`
- method GET
- return object yang akan dikonversi menjadi response
- dependency service mungkin di-inject oleh CDI

Tetapi kode itu tidak menjelaskan:

- siapa membuka port HTTP?
- siapa menerima socket?
- siapa parsing request?
- siapa memilih thread?
- siapa membuat instance resource?
- siapa melakukan injection?
- siapa mengikat security context?
- siapa membuka transaction?
- siapa mengambil connection dari pool?
- siapa mengembalikan response?
- siapa mencatat access log?
- siapa menghentikan aplikasi saat undeploy?

Jawaban runtime-nya ada pada GlassFish dan komponen-komponen di dalamnya.

---

### 4.2 GlassFish Adalah Implementasi + Runtime

GlassFish melakukan hal-hal seperti:

1. Membaca konfigurasi domain.
2. Memulai network listener.
3. Memulai container internal.
4. Memuat aplikasi.
5. Melakukan annotation scanning.
6. Membaca deployment descriptor.
7. Membuat classloader aplikasi.
8. Menginisialisasi CDI.
9. Menginisialisasi JPA persistence unit.
10. Mengikat resource ke JNDI.
11. Mengatur JDBC/JMS pool.
12. Mengatur transaction service.
13. Mengaktifkan security realm.
14. Menyediakan monitoring dan logging.
15. Menjalankan lifecycle aplikasi.

Jadi mental model-nya bukan:

```text
GlassFish = servlet container
```

Melainkan:

```text
GlassFish = enterprise runtime coordinator
```

---

## 5. GlassFish sebagai Control Plane dan Data Plane

Salah satu mental model yang sangat membantu adalah memisahkan **control plane** dan **data plane**.

### 5.1 Control Plane

Control plane adalah bagian yang mengatur runtime.

Dalam GlassFish, control plane mencakup:

- Domain Administration Server / DAS
- `asadmin`
- admin console
- REST admin API
- `domain.xml`
- config object
- deployment management
- resource creation
- target assignment
- cluster/instance management

Control plane menjawab pertanyaan:

```text
Aplikasi apa yang terdeploy?
Resource apa yang tersedia?
Pool mana yang dipakai?
Thread pool berapa ukurannya?
Listener mana yang aktif?
Security realm mana yang dipakai?
Target deployment ke server/cluster mana?
```

---

### 5.2 Data Plane

Data plane adalah bagian yang melayani traffic dan menjalankan workload.

Dalam GlassFish, data plane mencakup:

- HTTP listener
- Grizzly network layer
- servlet/web container
- EJB invocation path
- CDI managed object graph
- JPA provider runtime
- JDBC pool
- JMS consumers/producers
- transaction manager
- application thread execution
- response path

Data plane menjawab pertanyaan:

```text
Request masuk lewat port mana?
Thread mana yang menjalankan request?
Connection DB dari pool mana yang dipakai?
Transaction timeout berapa?
Security context user siapa?
Message JMS diproses oleh consumer mana?
```

---

### 5.3 Mengapa Pemisahan Ini Penting?

Karena banyak incident production terjadi ketika engineer mencampur keduanya.

Contoh:

> “Admin console bisa dibuka, berarti aplikasi sehat.”

Belum tentu. Admin console adalah control plane. Aplikasi yang melayani user adalah data plane. Control plane bisa hidup, tetapi data plane bisa rusak karena:

- HTTP worker threads habis
- DB pool exhausted
- app stuck di lock
- transaction timeout
- JMS backlog
- classloader leak
- GC pause
- downstream timeout

Contoh lain:

> “Aplikasi masih menerima request, berarti konfigurasi deployment aman.”

Belum tentu. Data plane bisa berjalan dengan konfigurasi lama, sementara control plane sudah drift, deployment partial, atau resource target salah.

Top-level engineer selalu bertanya:

```text
Apakah yang sehat itu control plane, data plane, atau keduanya?
```

---

## 6. Runtime Anatomy: Komponen Besar GlassFish

GlassFish dapat dipahami sebagai gabungan beberapa subsistem.

```text
+-------------------------------------------------------------------+
|                           Eclipse GlassFish                        |
+-------------------------------------------------------------------+
| Admin subsystem     | asadmin, Admin Console, REST Admin API       |
| Config subsystem    | domain.xml, config tree, targets             |
| Deployment engine   | deploy, undeploy, descriptors, scanning       |
| Web container       | Servlet, JSP/Jakarta Pages, HTTP sessions      |
| Network layer       | Grizzly, listeners, protocols, transports      |
| CDI integration     | bean discovery, injection, lifecycle           |
| EJB container       | pooling, timers, transactions, remoting        |
| JPA integration     | persistence unit bootstrap, provider wiring    |
| Transaction service | JTA, XA, recovery, timeout                     |
| JDBC pool service   | pools, validation, leak detection              |
| JMS/OpenMQ service  | broker integration, destinations, MDB          |
| Naming service      | JNDI namespaces and resource references         |
| Security service    | realms, roles, principals, TLS/admin security  |
| Connector service   | JCA resource adapters                           |
| Monitoring/logging  | metrics, JMX, server.log, access log            |
+-------------------------------------------------------------------+
|                          JVM / OS / Network                        |
+-------------------------------------------------------------------+
```

Saat terjadi masalah, jangan langsung melihat aplikasi. Letakkan masalah pada subsistem yang tepat.

Contoh mapping gejala:

| Gejala | Kemungkinan Area |
|---|---|
| `ClassNotFoundException` saat deploy | classloading, dependency placement, namespace mismatch |
| `NoSuchMethodError` runtime | duplicate library, binary incompatible version |
| request 504 dari reverse proxy | HTTP thread, downstream latency, DB pool, proxy timeout |
| server start lambat | deployment scanning, CDI discovery, JPA bootstrap, classloading |
| pool connection habis | JDBC pool sizing, slow SQL, transaction leak, connection leak |
| redeploy makin lama makin boros memory | classloader leak, static cache, ThreadLocal leak, driver leak |
| JMS message diproses ulang | transaction rollback, acknowledgement, redelivery policy |
| role user tidak match | realm/group/principal/role mapping |
| aplikasi deploy sukses tapi resource lookup gagal | JNDI name, target resource, descriptor mapping |

---

## 7. Domain: Unit Administrasi GlassFish

GlassFish menggunakan konsep **domain**.

Domain bukan “domain name DNS”. Domain di sini adalah unit administrasi runtime yang berisi:

- konfigurasi server
- resource
- aplikasi terdeploy
- log
- generated artifacts
- admin identity
- listener configuration
- JVM options
- cluster/instance definitions

Sederhananya:

```text
GlassFish installation
  └── domains
      └── domain1
          ├── config
          │   └── domain.xml
          ├── logs
          ├── applications
          ├── generated
          └── lib
```

Mental model:

```text
GlassFish home = software distribution
Domain dir     = runtime state + configuration
Application    = deployable artifact within a domain target
```

Rule production yang kuat:

> Treat GlassFish installation as immutable, and treat domain configuration as versioned operational state.

Artinya:

- Jangan asal edit manual runtime server.
- Jangan membuat konfigurasi production hanya lewat klik console tanpa dokumentasi.
- Jangan membiarkan `domain.xml` berubah tanpa jejak.
- Jangan mencampur binary distribution, app artifact, dan environment-specific mutable state tanpa strategi.

---

## 8. DAS, Instance, Cluster, Node, Config, Target

Pada awalnya istilah ini membingungkan. Mari kita sederhanakan.

### 8.1 DAS — Domain Administration Server

DAS adalah pusat administrasi domain.

Fungsinya:

- menerima command admin
- menyimpan/menyebarkan konfigurasi
- mengatur deployment
- mengatur resource
- mengelola instance/cluster

DAS bukan berarti selalu melayani user traffic. Dalam setup sederhana, DAS bisa juga menjadi server tempat aplikasi berjalan. Dalam setup lebih serius, kita perlu membedakan peran admin dan traffic-serving instance.

---

### 8.2 Server Instance

Instance adalah proses server yang menjalankan workload.

Jenisnya bisa:

- default server instance
- standalone instance
- clustered instance

Instance memiliki config dan target deployment/resource tertentu.

---

### 8.3 Cluster

Cluster adalah kumpulan instance yang dikonfigurasi untuk bekerja sebagai satu target logis.

Cluster membantu:

- horizontal scaling
- common deployment target
- common configuration
- high availability pattern tertentu

Namun cluster bukan obat semua masalah. Cluster tidak otomatis menyelesaikan:

- session design yang buruk
- non-idempotent operation
- shared state problem
- DB bottleneck
- JMS ordering issue
- bad deployment pipeline
- config drift di luar control plane

---

### 8.4 Node

Node merepresentasikan host atau environment tempat instance dapat berjalan.

Dalam era VM/bare metal, node biasanya mapping ke host. Dalam container/Kubernetes, mental model node GlassFish perlu dikaji ulang karena platform orchestration sudah punya konsep node/pod/service sendiri.

---

### 8.5 Config

Config adalah kumpulan setting yang dapat digunakan oleh server atau cluster.

Contoh isi config:

- network listener
- thread pool
- JVM options
- HTTP service
- EJB container setting
- monitoring level
- security service

Config memungkinkan beberapa instance berbagi konfigurasi yang sama.

---

### 8.6 Target

Target adalah tujuan penerapan resource atau aplikasi.

Target bisa berupa:

- server
- cluster
- instance

Kesalahan target sering menyebabkan bug membingungkan:

```text
Resource sudah dibuat, tapi aplikasi bilang JNDI not found.
```

Kemungkinan: resource dibuat di domain, tetapi tidak ditargetkan ke server/cluster tempat aplikasi berjalan.

---

## 9. GlassFish vs Servlet Container vs Embedded Runtime

Untuk memahami posisi GlassFish, kita perlu membandingkannya dengan model runtime lain.

### 9.1 Tomcat

Tomcat terutama adalah servlet container.

Ia kuat untuk:

- Servlet
- JSP/Jakarta Pages
- HTTP web application

Namun Tomcat bukan full Jakarta EE application server. Banyak fitur enterprise perlu ditambahkan sendiri atau melalui framework/library eksternal:

- CDI full integration
- EJB
- JTA full server-managed transaction
- JMS integration
- JCA
- full Jakarta EE platform services

Jika aplikasi Anda Spring Boot MVC + JDBC + external transaction handling, Tomcat cukup. Jika aplikasi Anda EAR besar dengan EJB, JTA, JMS, JNDI, declarative security, dan resource adapter, GlassFish/WildFly/Liberty/Payara lebih dekat ke model enterprise server.

---

### 9.2 Spring Boot Embedded

Spring Boot embedded runtime membalik model deployment.

Model classic application server:

```text
server first
  -> deploy application artifact into server
```

Model Spring Boot embedded:

```text
application first
  -> application embeds server library
  -> run as executable jar
```

Keduanya punya trade-off.

Application server model:

- server mengelola banyak app
- resource bisa centralized
- admin control plane kuat
- enterprise standard lengkap
- cocok untuk legacy enterprise dan standards-heavy org

Embedded model:

- artifact self-contained
- lebih cocok untuk container/cloud-native microservice
- konfigurasi biasanya per service
- lebih sederhana untuk CI/CD modern
- lebih mudah horizontal scale per app

Top-level engineer tidak fanatik. Ia memilih berdasarkan constraint:

```text
Apakah app perlu full Jakarta EE?
Apakah ada legacy EAR/EJB/JMS/JTA?
Apakah organisasi butuh standard portability?
Apakah deployment model central server masih required?
Apakah tim operasi mengerti app server?
Apakah cloud-native container lebih penting?
```

---

### 9.3 WildFly

WildFly adalah full Jakarta EE application server dari ekosistem Red Hat/JBoss.

Kuat di:

- enterprise runtime
- management model
- modules/classloading
- clustering
- production usage ecosystem

Dibanding GlassFish, WildFly sering lebih umum ditemukan dalam production enterprise Linux/Red Hat ecosystem. GlassFish lebih dekat ke compatible/reference implementation heritage dan spesifikasi.

---

### 9.4 Open Liberty

Open Liberty adalah runtime dari IBM ecosystem yang modular, cloud-friendly, dan kuat untuk Jakarta EE/MicroProfile.

Kuat di:

- modular features
- startup behavior
- cloud-native config
- enterprise support path via WebSphere Liberty

---

### 9.5 Payara

Payara adalah fork historis dari GlassFish dengan commercial support dan enterprise features tambahan.

Bagi engineer, penting memahami perbedaan:

```text
GlassFish = Eclipse open-source Jakarta EE compatible implementation
Payara    = fork/derived ecosystem dengan support dan features enterprise tambahan
```

Banyak pengetahuan GlassFish berguna untuk Payara, tetapi tidak semua behavior identik.

---

### 9.6 Quarkus

Quarkus adalah framework/runtime modern untuk cloud-native Java, build-time augmentation, fast startup, GraalVM native image, dan microservice workloads.

Quarkus bukan “GlassFish yang lebih baru”. Paradigmanya berbeda.

GlassFish:

```text
runtime container discovers/deploys/manages enterprise app
```

Quarkus:

```text
build-time optimized app runtime, mostly app-centric
```

Keduanya valid untuk masalah yang berbeda.

---

## 10. Kapan GlassFish Masuk Akal?

GlassFish masuk akal ketika:

1. Anda ingin memahami Jakarta EE dari runtime yang sangat dekat dengan spesifikasi.
2. Anda mengelola aplikasi enterprise berbasis WAR/EAR/Jakarta EE standard.
3. Anda punya aplikasi legacy Java EE/Jakarta EE yang perlu dipertahankan atau dimigrasi.
4. Anda butuh full platform services: JTA, JMS, EJB, CDI, JPA, JNDI, Security, Connector.
5. Anda ingin belajar application server internals secara mendalam.
6. Anda butuh compatible implementation untuk eksperimen spesifikasi Jakarta EE.
7. Organisasi Anda standards-heavy dan memerlukan portability story.

GlassFish kurang ideal jika:

1. Anda hanya membuat REST microservice sederhana.
2. Anda tidak butuh full Jakarta EE platform.
3. Anda menginginkan ecosystem commercial support tertentu yang lebih kuat dari vendor lain.
4. Anda butuh runtime yang didesain khusus untuk native image/cloud-first deployment.
5. Tim operasi tidak siap mengelola application server state/config.
6. Anda ingin setiap service menjadi self-contained executable artifact.

Tapi “kurang ideal” bukan berarti “buruk”. Ini soal fit.

Top-level engineer memilih runtime berdasarkan:

```text
technical fit + operational fit + organization fit + migration fit + failure model
```

Bukan berdasarkan hype.

---

## 11. Cara Berpikir Top 1% Saat Melihat GlassFish

Engineer biasa melihat GlassFish seperti ini:

```text
Deploy WAR -> buka URL -> kalau error lihat stacktrace
```

Engineer senior melihat:

```text
Artifact -> deployment engine -> classloader -> descriptor -> container -> resource -> transaction -> thread -> network -> logs
```

Engineer top-level melihat:

```text
System boundary:
  user request
  reverse proxy
  network listener
  HTTP worker
  application invocation
  CDI/EJB boundary
  transaction boundary
  JDBC/JMS resource boundary
  downstream dependency
  response boundary
  logging/metrics boundary
  operational control plane
```

Ia bertanya:

- Di boundary mana kegagalan terjadi?
- Apakah ini config issue, runtime issue, app issue, dependency issue, atau platform issue?
- Apakah gejala terlihat di control plane atau data plane?
- Apakah queue terbentuk di HTTP thread, JDBC pool, JMS broker, OS socket, DB lock, atau reverse proxy?
- Apakah timeout berasal dari caller, proxy, server, transaction manager, DB driver, atau downstream service?
- Apakah class yang dipakai berasal dari server lib, domain lib, app lib, atau transitive duplicate?
- Apakah failure deterministic, load-dependent, time-dependent, deployment-dependent, atau data-dependent?

Inilah perbedaan antara “bisa menjalankan GlassFish” dan “menguasai GlassFish”.

---

## 12. The Runtime Boundary Model

Salah satu model paling penting untuk GlassFish adalah **runtime boundary model**.

Setiap request melewati beberapa boundary:

```text
Client
  -> DNS / network
  -> reverse proxy / load balancer
  -> GlassFish listener
  -> Grizzly transport
  -> HTTP service
  -> web container
  -> filter chain
  -> servlet / JAX-RS resource
  -> CDI / EJB service
  -> transaction interceptor
  -> JDBC / JMS / external client
  -> database / broker / downstream
  -> response commit
  -> access log / metrics
```

Setiap boundary punya:

- ownership
- timeout
- thread model
- queue
- error translation
- logging behavior
- retry behavior
- security context
- resource lifecycle

Contoh: request 504.

Engineer junior:

```text
504 berarti GlassFish error.
```

Engineer top-level:

```text
504 biasanya dari gateway/proxy. Perlu cek apakah GlassFish tidak merespons sebelum proxy timeout, apakah HTTP worker stuck, apakah DB pool exhausted, apakah transaction menunggu lock, apakah downstream call blocking, apakah response sudah commit, apakah proxy timeout lebih pendek dari server timeout.
```

Contoh: `JNDI lookup failed`.

Engineer junior:

```text
Nama resource salah.
```

Engineer top-level:

```text
Kemungkinan nama salah, resource belum dibuat, resource tidak ditargetkan ke instance/cluster, app descriptor mapping salah, lookup namespace salah, deployment order salah, atau resource berada di domain berbeda.
```

---

## 13. GlassFish sebagai Resource Coordinator

Aplikasi enterprise jarang berdiri sendiri. Ia memakai resource:

- database connection
- JMS broker
- transaction manager
- security realm
- mail session
- connector adapter
- executor service
- timer service
- JNDI binding

GlassFish bertindak sebagai coordinator.

Misalnya aplikasi menggunakan database:

```java
@Resource(lookup = "jdbc/AppDS")
private DataSource dataSource;
```

Kode ini terlihat sederhana. Tetapi runtime path-nya:

```text
Deployment descriptor / annotation
  -> resource reference resolution
  -> JNDI lookup
  -> JDBC resource
  -> connection pool
  -> datasource implementation
  -> driver classloader
  -> physical DB connection
  -> transaction enlistment
  -> validation / timeout / leak tracking
```

Kalau terjadi error, kemungkinan bukan hanya “DB down”. Bisa juga:

- pool belum dibuat
- JNDI name salah
- target resource salah
- driver tidak ada di classpath server/domain
- datasource class salah
- credentials salah
- validation query salah
- max pool terlalu kecil
- connection leak
- DB session limit habis
- transaction timeout
- firewall idle timeout
- stale connection

Resource coordinator model membuat kita lebih presisi.

---

## 14. GlassFish sebagai Deployment Engine

Deploy bukan sekadar copy file.

Saat deploy, GlassFish melakukan banyak langkah:

```text
receive artifact
  -> validate archive
  -> determine type: WAR/EAR/EJB-JAR/RAR
  -> create deployment context
  -> build classloader hierarchy
  -> scan annotations
  -> read standard descriptors
  -> read GlassFish descriptors
  -> resolve resources
  -> initialize containers
  -> initialize CDI
  -> initialize persistence units
  -> register servlets/endpoints
  -> bind JNDI names
  -> generate artifacts if needed
  -> enable application on target
```

Karena itu deployment failure bisa berasal dari banyak tempat:

- invalid archive
- duplicate classes
- incompatible bytecode
- wrong Java version
- missing dependency
- duplicate API jar
- CDI ambiguous injection
- JPA provider failure
- missing JDBC resource
- invalid descriptor
- security role mapping failure
- namespace mismatch

Top-level engineer tidak membaca deployment error sebagai satu stacktrace panjang. Ia mencari fase mana yang gagal.

Pertanyaan diagnosis:

```text
Apakah gagal sebelum classloading?
Apakah gagal saat annotation scanning?
Apakah gagal saat CDI bootstrap?
Apakah gagal saat persistence unit init?
Apakah gagal saat resource reference resolution?
Apakah gagal saat endpoint registration?
Apakah gagal setelah app enabled?
```

---

## 15. GlassFish sebagai Classloading Environment

Classloading adalah salah satu area paling kritis.

Dalam aplikasi standalone sederhana:

```text
classpath relatif mudah dikontrol
```

Dalam application server:

```text
server punya library sendiri
runtime punya module sendiri
domain bisa punya library
application punya library
WAR/EAR punya struktur sendiri
third-party dependency bisa overlap
```

Masalah umum:

- aplikasi membawa API jar yang seharusnya disediakan server
- server punya versi library berbeda dari aplikasi
- dua module membawa package yang sama
- `javax` dan `jakarta` tercampur
- JDBC driver ditempatkan di lokasi salah
- logging framework konflik
- JAXB/JAX-WS dependency hilang pada JDK modern

Contoh error:

```text
java.lang.NoSuchMethodError
```

Ini sering berarti:

```text
Kode dikompilasi terhadap versi library A,
tetapi runtime memuat versi library B.
```

Contoh:

```text
ClassNotFoundException
```

Bisa berarti:

- library tidak ada
- library ada tapi di classloader yang salah
- dependency optional tidak ikut terpackage
- server module tidak visible ke app
- app lib tidak visible ke module lain dalam EAR

Top-level engineer memahami classloader sebagai graph visibility, bukan sekadar “tambahkan jar”.

---

## 16. GlassFish sebagai Transaction Boundary

Transaction adalah area yang sering terlihat mudah tetapi runtime-nya kompleks.

Aplikasi mungkin menulis:

```java
@Transactional
public void approveCase(CaseId id) {
    caseRepository.approve(id);
    auditRepository.insert(...);
    messagePublisher.publish(...);
}
```

Pertanyaan runtime:

- Siapa membuka transaction?
- Kapan transaction dimulai?
- Resource apa saja yang enlisted?
- Apakah DB connection XA atau non-XA?
- Apakah JMS publish ikut transaction?
- Apa timeout transaction?
- Apa yang terjadi kalau JMS berhasil tapi DB rollback?
- Apa yang terjadi kalau prepare phase gagal?
- Di mana recovery log disimpan?
- Apakah operasi idempotent?

GlassFish transaction service bukan detail kecil. Ia menentukan reliability semantics.

Top-level engineer tidak hanya bertanya:

```text
Apakah ada @Transactional?
```

Ia bertanya:

```text
Apa boundary transaksi?
Apa side effect di dalamnya?
Apa yang terjadi pada partial failure?
Apa strategi recovery?
Apa timeout-nya lebih kecil/besar dari DB/proxy/client timeout?
```

---

## 17. GlassFish sebagai Thread dan Queue System

Setiap runtime server pada akhirnya adalah sistem antrian.

Request datang lebih cepat daripada resource selesai? Akan ada queue.

Queue bisa terjadi di:

```text
TCP backlog
reverse proxy queue
GlassFish listener
HTTP worker thread pool
application executor
EJB pool
JDBC pool wait queue
DB lock wait
JMS broker queue
transaction wait
OS scheduler
GC safepoint
```

Kesalahan umum:

> “Tambah thread pool biar lebih cepat.”

Belum tentu. Jika bottleneck ada di DB, menambah thread hanya menambah tekanan DB, memperbesar latency, dan memperparah timeout.

Model yang benar:

```text
Throughput = concurrency / latency
```

Jika latency DB 200 ms dan Anda butuh 500 request/s yang masing-masing butuh satu DB connection, kebutuhan kasar concurrency DB:

```text
500 rps * 0.2 s = 100 concurrent DB operations
```

Namun kalau DB hanya mampu menangani 40 concurrent query secara sehat, pool 100 justru bisa membuat DB collapse.

GlassFish tuning bukan “angka magic”. Ia adalah balancing:

- HTTP worker
- JDBC pool
- DB capacity
- downstream timeout
- CPU core
- heap/GC
- transaction timeout
- proxy timeout

Top-level engineer mencari **queue paling awal yang jenuh**.

---

## 18. GlassFish sebagai Security Boundary

GlassFish security bukan hanya login.

GlassFish mengelola:

- admin user
- secure admin
- realms
- groups
- principals
- role mapping
- TLS keystore/truststore
- certificate authentication
- JDBC/LDAP/file realm
- app role mapping
- transport security
- JASPIC/Jakarta Authentication integration
- Jakarta Security integration

Masalah security sering muncul sebagai mismatch antar layer:

```text
Identity provider bilang user punya group A.
GlassFish realm membaca group B.
Application role butuh role C.
Descriptor mapping tidak menghubungkan A/B ke C.
```

Akibatnya user authenticated tetapi unauthorized.

Mental model:

```text
Authentication -> principal/group -> role mapping -> authorization decision
```

Di GlassFish, role mapping bisa dipengaruhi oleh:

- standard descriptor
- GlassFish-specific descriptor
- default principal-to-role mapping
- realm implementation
- app security constraints
- method security annotation

Top-level engineer tidak hanya melihat “login sukses/gagal”. Ia melihat identity propagation sampai authorization decision.

---

## 19. GlassFish sebagai Observability Source

GlassFish menyediakan banyak sinyal:

- server log
- access log
- monitoring service
- JMX
- admin commands
- JDBC pool stats
- thread pool stats
- transaction stats
- JVM metrics
- GC logs
- HTTP metrics
- application logs

Tapi sinyal tidak berguna jika tidak dihubungkan dengan failure model.

Contoh dashboard yang buruk:

```text
CPU, memory, request count
```

Contoh dashboard yang lebih berguna:

```text
HTTP request latency p95/p99
HTTP active threads
HTTP queued requests / saturation indicator
JDBC pool used/free/wait count
DB latency
transaction timeout count
JMS queue depth
GC pause time
heap after GC
error rate by status
deployment/restart event marker
```

Top-level engineer mendesain observability berdasarkan pertanyaan:

```text
Kalau user bilang aplikasi lambat, sinyal apa yang membedakan DB bottleneck, thread starvation, GC pause, proxy issue, atau downstream timeout?
```

---

## 20. GlassFish dalam Konteks Java 8 sampai Java 25

### 20.1 Java 8 Era

Java 8 adalah era besar Java EE 7/8 dan banyak aplikasi enterprise legacy.

Ciri umum:

- namespace `javax.*`
- WAR/EAR tradisional
- EJB masih umum
- XML descriptors masih sering dipakai
- application server deployment model kuat
- SecurityManager masih ada dalam diskusi lama
- PermGen sudah digantikan Metaspace sejak Java 8
- GC umum: Parallel GC, CMS, G1 mulai relevan

Untuk GlassFish, Java 8 relevan terutama dalam konteks aplikasi legacy dan migrasi.

---

### 20.2 Java 11 Era

Java 11 menjadi LTS transisi.

Perubahan penting:

- modul Java mulai berdampak dari Java 9+
- beberapa Java EE-related modules dihapus dari JDK modern
- JAXB/JAX-WS tidak lagi bisa diasumsikan ada di JDK
- reflective access warning mulai sering muncul
- container awareness lebih matang dibanding Java 8

Untuk application server, Java 11 menuntut dependency hygiene lebih baik.

---

### 20.3 Java 17 Era

Java 17 menjadi baseline modern yang banyak dipakai enterprise.

Perubahan penting:

- strong encapsulation makin terasa
- SecurityManager deprecated untuk removal
- GC modern lebih matang
- records/sealed classes tersedia sebagai language features
- ecosystem library lebih modern

GlassFish 7.x dan Jakarta EE 10 sangat relevan di area ini.

---

### 20.4 Java 21 Era

Java 21 adalah LTS besar dengan virtual threads.

Bagi application server, virtual threads menimbulkan pertanyaan besar:

- Apakah HTTP request bisa dijalankan dengan virtual thread?
- Apakah JDBC blocking call cocok?
- Apakah transaction context aman?
- Apakah ThreadLocal-heavy framework aman?
- Apakah pinning terjadi?
- Apakah container lifecycle mendukung model ini?

Jakarta EE 11 juga mulai membawa dukungan yang lebih sadar terhadap virtual threads pada level platform.

Tetapi jangan naif:

> Virtual threads bukan pengganti capacity planning.

Virtual threads membantu concurrency blocking workload tertentu, tetapi bottleneck DB, lock, downstream, transaction timeout, dan pool tetap nyata.

---

### 20.5 Java 25 Era

Java 25 adalah target modern berikutnya dalam seri ini. Untuk GlassFish, pembahasan Java 25 akan relevan pada:

- compatibility testing
- JPMS/bootstrap modernization
- virtual thread maturity
- GC behavior
- removed/deprecated APIs
- library ecosystem readiness
- production certification policy

Top-level engineer tidak langsung mengejar versi terbaru tanpa menilai:

```text
runtime support
library compatibility
observability tooling
security baseline
deployment pipeline
rollback path
```

---

## 21. Apa yang Tidak Akan Kita Ulang?

Agar efisien, seri ini tidak akan mengulang detail API yang sudah dipelajari.

Kita tidak akan mengulang dari awal:

- cara menulis servlet sederhana
- cara membuat endpoint JAX-RS dasar
- cara membuat entity JPA dasar
- cara kerja CDI injection dasar
- dasar Bean Validation
- dasar Jakarta Security API
- dasar Java concurrency
- dasar JDBC
- dasar logging Java
- dasar Docker/Kubernetes umum
- dasar Maven/Gradle umum

Namun kita akan membahas bagaimana semua itu **berperilaku di dalam GlassFish runtime**.

Contoh perbedaan:

| Topik | Tidak Diulang | Fokus di Seri GlassFish |
|---|---|---|
| Servlet | membuat servlet dasar | request path, listener, thread, session, proxy behavior |
| CDI | `@Inject` dasar | deployment bootstrap, bean discovery, failure diagnosis |
| JPA | mapping entity | persistence unit bootstrap, provider integration, transaction/resource boundary |
| JDBC | SQL dasar | GlassFish JDBC pool, validation, leak, sizing, target resource |
| Security | login dasar | realm, principal, group, role mapping, admin security |
| Logging | logger API | server.log, access log, correlation, centralization |
| Kubernetes | pod/service dasar | GlassFish domain/containerization/state/readiness/shutdown |

---

## 22. Mental Model Utama untuk Seluruh Seri

Ada tujuh mental model yang akan dipakai terus.

### 22.1 GlassFish sebagai Runtime Graph

Aplikasi tidak “berjalan sendiri”. Ia menjadi node dalam graph runtime:

```text
application
  depends on classloader
  depends on resources
  depends on containers
  depends on thread pools
  depends on transaction service
  depends on security service
  depends on naming service
  depends on network listeners
```

Perubahan satu node bisa mempengaruhi node lain.

---

### 22.2 GlassFish sebagai Boundary Translator

GlassFish menerjemahkan boundary:

```text
HTTP request -> Java invocation
Java exception -> HTTP response / server log
JNDI name -> resource object
security principal -> application role
annotation -> runtime component
transaction annotation -> transaction manager behavior
deployment descriptor -> runtime config
```

Banyak bug muncul karena terjemahan ini salah atau tidak lengkap.

---

### 22.3 GlassFish sebagai Queue Network

Setiap subsystem punya kapasitas dan queue.

```text
listener -> thread pool -> app -> JDBC pool -> DB
```

Jika DB lambat, queue bisa muncul di JDBC pool, lalu HTTP thread tertahan, lalu proxy timeout.

---

### 22.4 GlassFish sebagai Lifecycle Manager

GlassFish mengelola lifecycle:

- domain start/stop
- server start/stop
- app deploy/undeploy/redeploy
- CDI bean lifecycle
- servlet lifecycle
- EJB lifecycle
- connection lifecycle
- transaction lifecycle
- JMS consumer lifecycle

Bug sering muncul saat lifecycle berubah:

- startup
- redeploy
- shutdown
- failover
- connection recycle
- classloader unload

---

### 22.5 GlassFish sebagai Compatibility Boundary

GlassFish berada di persimpangan:

```text
Java version
Jakarta EE version
library version
JDBC driver version
application bytecode version
server module version
OS/container version
```

Compatibility harus dipetakan eksplisit.

---

### 22.6 GlassFish sebagai Operational State Machine

Runtime production punya state:

```text
created -> configured -> started -> deployed -> serving -> degraded -> draining -> stopped
```

Aplikasi juga punya state:

```text
artifact available -> deployment started -> validated -> initialized -> enabled -> serving -> disabled -> undeployed
```

Incident sering terjadi ketika state yang diasumsikan berbeda dari state aktual.

---

### 22.7 GlassFish sebagai Failure Amplifier atau Failure Isolator

Konfigurasi yang buruk membuat GlassFish menjadi failure amplifier:

- DB lambat membuat semua HTTP thread habis
- satu aplikasi leak memory mempengaruhi aplikasi lain
- satu pool terlalu besar menjatuhkan DB
- satu bad deployment mengubah shared library
- admin port terbuka menjadi security risk

Konfigurasi yang baik membuat GlassFish menjadi failure isolator:

- pool dibatasi
- timeout selaras
- app dipisahkan
- logs cukup jelas
- health check akurat
- deployment rollbackable
- resource target eksplisit

---

## 23. Contoh Cara Membaca Problem Dengan Mental Model GlassFish

### 23.1 Problem: Aplikasi Lambat Setelah Deployment Baru

Pertanyaan dangkal:

```text
Kode baru lambat?
```

Pertanyaan top-level:

```text
Apakah deployment baru mengubah dependency?
Apakah classloading jadi lebih berat?
Apakah CDI scanning bertambah?
Apakah JPA persistence unit bootstrap berubah?
Apakah endpoint baru memakai DB query lambat?
Apakah JDBC pool usage naik?
Apakah transaction duration naik?
Apakah HTTP worker thread aktif meningkat?
Apakah GC pause berubah?
Apakah access log menunjukkan latency naik di semua endpoint atau endpoint tertentu?
Apakah reverse proxy timeout terjadi sebelum GlassFish selesai?
```

---

### 23.2 Problem: Deploy Sukses di Local, Gagal di Server

Pertanyaan dangkal:

```text
Environment beda.
```

Pertanyaan top-level:

```text
JDK version beda?
GlassFish version beda?
Namespace javax/jakarta beda?
Server sudah punya API jar yang bentrok?
Domain lib berbeda?
JDBC driver tersedia?
Resource target benar?
Security realm ada?
Descriptor environment-specific?
Maven profile menghasilkan artifact berbeda?
Class file version terlalu baru?
```

---

### 23.3 Problem: Pool Habis

Pertanyaan dangkal:

```text
Naikkan max pool.
```

Pertanyaan top-level:

```text
Apakah pool habis karena traffic naik, SQL lambat, connection leak, transaction tidak selesai, DB lock, downstream wait, atau max wait terlalu pendek?
Berapa active connection?
Berapa wait count?
Berapa average borrow time?
Berapa DB session active?
Apakah thread dump menunjukkan banyak thread menunggu getConnection?
Apakah access log latency naik sebelum error?
Apakah ada query lock wait di DB?
Apakah transaction timeout selaras dengan pool wait timeout?
```

---

### 23.4 Problem: Unauthorized Padahal Login Sukses

Pertanyaan dangkal:

```text
Role user kurang.
```

Pertanyaan top-level:

```text
Authentication realm mana yang dipakai?
Principal yang terbentuk apa?
Group dari realm apa?
Role app apa?
Mapping group ke role ada di mana?
Default principal-to-role mapping aktif?
Descriptor GlassFish override standard descriptor?
Endpoint memakai annotation atau web.xml constraint?
Apakah ada case sensitivity?
Apakah user authenticated di proxy tetapi tidak sampai ke GlassFish?
```

---

## 24. Skill yang Harus Dimiliki Setelah Seri Ini

Setelah seluruh seri selesai, target kemampuan bukan sekadar “bisa deploy”. Targetnya:

### 24.1 Runtime Understanding

Anda mampu menjelaskan:

- bagaimana GlassFish start
- bagaimana domain bekerja
- bagaimana app dideploy
- bagaimana request masuk
- bagaimana resource di-resolve
- bagaimana transaction dimulai/selesai
- bagaimana security context terbentuk
- bagaimana classloader memuat dependency
- bagaimana monitoring dibaca

---

### 24.2 Operational Competence

Anda mampu:

- membuat domain yang repeatable
- mengotomasi `asadmin`
- membuat JDBC/JMS resource dengan benar
- men-deploy aplikasi ke target yang benar
- melakukan rollback
- membaca server log
- mengambil thread dump/heap dump
- menganalisis pool exhaustion
- mengatur logging/monitoring
- hardening admin/security

---

### 24.3 Failure Diagnosis

Anda mampu membedakan:

- app bug
- server config bug
- resource bug
- classpath bug
- version compatibility bug
- DB bottleneck
- proxy/network issue
- JVM/GC issue
- transaction failure
- security mapping failure

---

### 24.4 Architecture Judgment

Anda mampu menentukan:

- kapan GlassFish cocok
- kapan GlassFish tidak cocok
- kapan migrasi ke Payara/WildFly/Liberty masuk akal
- kapan pindah ke Spring Boot/Quarkus lebih tepat
- kapan mempertahankan EAR monolith lebih rasional daripada rewrite
- kapan cluster GlassFish membantu atau malah menambah kompleksitas

---

## 25. Peta Seri Setelah Part 0

Setelah orientasi ini, urutan pembelajaran akan masuk ke detail teknis.

```text
Part 1  -> Version Matrix, Compatibility, Migration Map Java 8-25
Part 2  -> Installation, Distribution Layout, Runtime Anatomy
Part 3  -> Domain Model: DAS, Instance, Node, Cluster, Config, Target
Part 4  -> asadmin Deep Dive
Part 5  -> Admin Console, REST Admin API, Configuration as Code
Part 6  -> Bootstrap Lifecycle
Part 7  -> Classloading Architecture
Part 8  -> Deployment Model
Part 9  -> GlassFish-Specific Descriptors
Part 10 -> HTTP Stack and Grizzly
...
Part 34 -> Top 1% GlassFish Engineer Playbook
```

Part 0 adalah fondasi konseptual. Part 1 akan lebih konkret: kita akan menyusun matrix compatibility Java 8–25, GlassFish 5–8/9 line, Java EE/Jakarta EE, namespace migration, dan strategi upgrade yang defensible.

---

## 26. Checklist Pemahaman Part 0

Gunakan checklist ini untuk memastikan fondasi sudah kuat.

Anda seharusnya bisa menjawab:

1. Apa bedanya Jakarta EE API dan GlassFish runtime?
2. Mengapa GlassFish bukan sekadar servlet container?
3. Apa perbedaan control plane dan data plane dalam GlassFish?
4. Apa itu domain dalam konteks GlassFish?
5. Apa peran DAS?
6. Apa bedanya server instance, cluster, config, node, dan target?
7. Mengapa `javax.*` ke `jakarta.*` adalah migration boundary besar?
8. Mengapa deployment failure bisa berasal dari CDI, JPA, classloading, descriptor, resource, atau server config?
9. Mengapa pool exhaustion tidak otomatis diselesaikan dengan menaikkan pool size?
10. Mengapa request 504 belum tentu berarti GlassFish mati?
11. Bagaimana GlassFish bertindak sebagai resource coordinator?
12. Bagaimana GlassFish bertindak sebagai transaction boundary?
13. Mengapa classloading application server lebih sulit dari standalone app?
14. Kapan GlassFish cocok dibanding Spring Boot embedded?
15. Kapan GlassFish kurang ideal untuk microservice sederhana?
16. Apa yang harus diamati saat aplikasi lambat?
17. Mengapa admin console hidup tidak membuktikan data plane sehat?
18. Apa skill akhir yang diharapkan dari seri ini?

Jika jawaban atas pertanyaan ini sudah terasa natural, Anda siap masuk ke Part 1.

---

## 27. Mini Glossary

### Application Server

Runtime yang menyediakan container dan service enterprise untuk menjalankan aplikasi Java/Jakarta EE.

### Jakarta EE

Platform spesifikasi enterprise Java modern di bawah Eclipse Foundation, penerus Java EE.

### Compatible Implementation

Implementasi yang lulus TCK untuk spesifikasi tertentu sehingga dapat diklaim kompatibel.

### TCK

Technology Compatibility Kit. Suite test untuk memverifikasi implementasi terhadap spesifikasi.

### Domain

Unit administrasi GlassFish yang menyimpan konfigurasi, resource, deployed apps, logs, dan runtime state.

### DAS

Domain Administration Server. Server administrasi pusat dalam sebuah domain.

### Instance

Server process yang menjalankan workload aplikasi.

### Cluster

Kumpulan instance yang dikelola sebagai target logis.

### Config

Kumpulan konfigurasi yang dapat diasosiasikan ke server/cluster.

### Target

Tujuan penerapan resource atau aplikasi: server, cluster, atau instance.

### JNDI

Naming service yang menghubungkan nama logis dengan resource/object runtime.

### Grizzly

Network/HTTP layer yang digunakan GlassFish.

### HK2

Service locator/internal dependency injection framework yang digunakan di GlassFish internals.

### OpenMQ

Messaging broker yang historically terintegrasi dengan GlassFish untuk JMS/Jakarta Messaging.

### Control Plane

Layer administrasi dan konfigurasi.

### Data Plane

Layer yang menjalankan traffic dan workload user.

---

## 28. Referensi Resmi dan Bacaan Lanjutan

Referensi ini digunakan sebagai anchor faktual untuk orientasi versi dan ekosistem. Detail teknis mendalam akan terus ditambahkan pada part berikutnya.

1. Eclipse GlassFish website/downloads — `https://glassfish.org/download`
2. Eclipse GlassFish GitHub repository — `https://github.com/eclipse-ee4j/glassfish`
3. Eclipse GlassFish compatibility/TCK results — `https://glassfish.org/compatibility`
4. Jakarta EE Platform 11 specification page — `https://jakarta.ee/specifications/platform/11/`
5. Java EE 8 GlassFish historical download page — `https://javaee.github.io/glassfish/download`
6. Eclipse GlassFish project releases — `https://projects.eclipse.org/projects/ee4j.glassfish`

---

## 29. Penutup Part 0

Part 0 membangun orientasi bahwa GlassFish harus dipahami sebagai **enterprise runtime**, bukan hanya tempat deploy aplikasi. Ia adalah kombinasi dari control plane, data plane, container graph, resource coordinator, transaction boundary, security boundary, deployment engine, classloading environment, dan observability source.

Kemampuan top-level dalam GlassFish bukan hafalan command atau descriptor. Kemampuan top-level adalah bisa melihat hubungan sebab-akibat antara:

```text
configuration -> runtime behavior -> resource pressure -> failure mode -> observability signal -> remediation
```

Seri belum selesai. Ini baru Part 0 dari 35.

Part berikutnya:

> **Part 1 — Version Matrix, Compatibility, dan Migration Map dari Java 8 sampai Java 25**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-MANIFEST.md">⬅️ Complete Bundle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-001.md">Part 1 — Version Matrix, Compatibility, dan Migration Map dari Java 8 sampai Java 25 ➡️</a>
</div>
