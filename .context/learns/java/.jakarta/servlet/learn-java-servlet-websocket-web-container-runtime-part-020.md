# learn-java-servlet-websocket-web-container-runtime — Part 020
# Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `020`  
> Topik: Packaging model Java web runtime — WAR, external container, embedded container, executable JAR/WAR, container image, Kubernetes, graceful shutdown, migration strategy  
> Target pembaca: engineer Java yang sudah memahami Servlet lifecycle, request/response, filters, listeners, sessions, async servlet, non-blocking I/O, threading, dan classloading.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas classloading, deployment, dan redeployment. Sekarang kita naik satu level: **bagaimana aplikasi Servlet/WebSocket dikemas dan dijalankan sebagai runtime produksi**.

Banyak engineer melihat packaging sebagai hal kecil:

```text
mvn package
java -jar app.jar
atau deploy app.war ke Tomcat
```

Padahal untuk sistem production-grade, packaging model menentukan banyak hal penting:

- siapa yang memiliki lifecycle server;
- siapa yang mengatur versi servlet container;
- siapa yang mengatur dependency boundary;
- bagaimana konfigurasi disuntikkan;
- bagaimana startup dan shutdown terjadi;
- bagaimana readiness/liveness dipahami platform;
- bagaimana request lama, upload besar, download besar, async request, dan WebSocket ditangani saat deploy;
- bagaimana observability dikumpulkan;
- bagaimana rollback dilakukan;
- bagaimana migration `javax.*` ke `jakarta.*` dilakukan;
- bagaimana risiko classloader leak, dependency conflict, dan environment drift dikendalikan.

Mental model inti:

```text
Packaging model bukan sekadar format file.
Packaging model adalah kontrak ownership antara application code, server runtime, deployment platform, dan operasi produksi.
```

---

## 1. Packaging Model sebagai Keputusan Arsitektur

Sebelum memilih WAR atau executable JAR, tanyakan:

```text
Siapa yang menjalankan HTTP server?
Siapa yang mengatur port?
Siapa yang mengatur thread pool?
Siapa yang mengatur TLS?
Siapa yang mengatur classpath?
Siapa yang mengatur graceful shutdown?
Siapa yang mengatur metrics/logging?
Siapa yang mengatur patching container?
Siapa yang memutuskan kapan app siap menerima traffic?
```

Jawaban pertanyaan tersebut berubah tergantung packaging model.

---

## 2. Empat Model Besar Java Web Deployment

Secara praktis, Java web application biasanya jatuh ke salah satu model berikut:

```text
1. Traditional WAR on external servlet container
2. WAR/EAR on Jakarta EE application server
3. Embedded servlet container inside executable JAR/WAR
4. Container image / Kubernetes runtime around embedded or external server
```

Ada juga varian modern seperti native image, jlink custom runtime image, buildpack-generated OCI image, dan serverless container runtime. Tetapi semua tetap berputar di pertanyaan fundamental yang sama: **siapa yang memiliki lifecycle server**.

---

## 3. Model 1 — Traditional WAR on External Servlet Container

### 3.1 Apa itu WAR?

WAR adalah **Web Application Archive**. Ini adalah packaging standar untuk web application berbasis Servlet.

Struktur umum:

```text
my-app.war
├── index.html
├── assets/
├── WEB-INF/
│   ├── web.xml
│   ├── classes/
│   │   └── com/example/...
│   └── lib/
│       ├── app-dependency-1.jar
│       └── app-dependency-2.jar
└── META-INF/
```

Maknanya:

| Lokasi | Fungsi |
|---|---|
| Root WAR | Static resource yang bisa diakses client jika tidak dilindungi |
| `WEB-INF/web.xml` | Deployment descriptor Servlet |
| `WEB-INF/classes` | Compiled application classes |
| `WEB-INF/lib` | Dependency JAR application-local |
| `WEB-INF` | Tidak boleh diakses langsung oleh browser |
| `META-INF` | Metadata archive |

WAR bukan hanya ZIP dengan class. WAR adalah struktur yang dimengerti container.

---

### 3.2 Lifecycle WAR di External Container

Pada model ini:

```text
Tomcat/Jetty/Undertow/GlassFish/WildFly/Open Liberty sudah berjalan.
Aplikasi dikemas menjadi WAR.
WAR dideploy ke server tersebut.
Server memuat webapp, membuat ServletContext, scan annotation, init servlet/filter/listener, lalu mulai menerima request.
```

Flow:

```text
Admin/platform starts container
        ↓
Container opens HTTP connector
        ↓
WAR copied/deployed
        ↓
Container creates web application context
        ↓
Classloader webapp dibuat
        ↓
web.xml + annotation scanning
        ↓
ServletContainerInitializer runs
        ↓
Listener contextInitialized
        ↓
Filter/Servlet init as needed
        ↓
Application serves traffic
```

Dalam model ini, application code **tidak memiliki main method**. Ia dijalankan karena container memanggil lifecycle Servlet.

---

### 3.3 Kelebihan Traditional WAR

| Kelebihan | Penjelasan |
|---|---|
| Standardized | WAR dipahami banyak servlet container dan app server |
| Separation of runtime/app | Tim platform dapat mengatur container secara terpisah |
| Multi-app hosting | Satu server bisa menjalankan banyak webapp |
| Container-managed config | Cocok untuk enterprise server lama |
| Operational familiarity | Banyak organisasi lama sudah punya proses deploy WAR |
| Shared server capabilities | Realm, JNDI, datasource, logging, security, clustering bisa dikelola server |

Model ini kuat untuk environment enterprise yang sudah memiliki platform application server matang.

---

### 3.4 Kekurangan Traditional WAR

| Kekurangan | Dampak |
|---|---|
| Environment drift | DEV/UAT/PROD bisa pakai container config berbeda |
| Dependency conflict | Library container vs library app bisa bentrok |
| Slow feedback | Developer harus deploy ke external server |
| Multi-app blast radius | Satu webapp bermasalah bisa memengaruhi server lain |
| Classloader leak risk | Redeploy berulang rawan leak jika cleanup buruk |
| Patch coordination | Update container harus sinkron dengan banyak aplikasi |
| Harder immutable deployment | Server berubah-ubah, app berubah-ubah |

Traditional WAR kuat, tetapi membutuhkan disiplin operasional tinggi.

---

### 3.5 Kapan Traditional WAR Masuk Akal?

Gunakan model ini jika:

- organisasi sudah memiliki standardized application server;
- banyak aplikasi enterprise legacy berbasis Java EE/Jakarta EE;
- dependency seperti JNDI datasource, JMS, transaction manager, security realm dikelola server;
- deployment process sudah matang;
- compliance mengharuskan runtime server dikontrol tim platform;
- aplikasi tidak harus menjadi self-contained service;
- WAR deployment sudah bagian dari release governance.

Hindari model ini jika:

- setiap service harus immutable, isolated, dan independently deployable;
- environment sering berbeda antara developer dan production;
- runtime config sulit direproduksi;
- redeploy leak sering terjadi;
- platform menuju Kubernetes/microservices dengan single-app-per-container.

---

## 4. Model 2 — WAR/EAR on Jakarta EE Application Server

### 4.1 Servlet Container vs Application Server

Servlet container biasanya menyediakan:

```text
Servlet
Filter
Listener
Session
JSP/Jakarta Pages
WebSocket
HTTP connector
```

Application server / Jakarta EE server dapat menyediakan lebih banyak:

```text
CDI
EJB
JTA
JPA integration
JMS
Jakarta Security
Jakarta REST
Jakarta Batch
Jakarta Concurrency
Jakarta Mail
Jakarta Faces
Jakarta WebSocket
```

Contoh:

| Runtime | Kategori kasar |
|---|---|
| Tomcat | Servlet container |
| Jetty | Servlet container / web server framework |
| Undertow standalone | Servlet/web server engine |
| WildFly | Jakarta EE application server |
| GlassFish | Jakarta EE reference implementation lineage |
| Payara | Jakarta EE server distribution |
| Open Liberty | Modular Jakarta EE/MicroProfile server |

---

### 4.2 EAR Packaging

EAR adalah **Enterprise Application Archive**.

Struktur umum:

```text
enterprise-app.ear
├── META-INF/application.xml
├── web-module.war
├── ejb-module.jar
├── shared-lib.jar
└── another-web-module.war
```

EAR berguna saat satu deployment unit memuat beberapa module enterprise.

Tetapi untuk banyak sistem modern, EAR sering terlalu besar sebagai deployment boundary. Ia dapat menyulitkan independent deployability karena banyak module harus dirilis bersama.

---

### 4.3 Kapan Application Server Cocok?

Cocok jika:

- aplikasi sangat bergantung pada Jakarta EE full profile;
- transaction, datasource, JMS, security, dan lifecycle ingin dikelola server;
- deployment governance berbasis enterprise server;
- aplikasi monolith enterprise masih sehat dan stabil;
- operational model sudah terbukti.

Kurang cocok jika:

- service kecil dan independently deployable;
- tim ingin runtime self-contained;
- cloud-native deployment membutuhkan image per service;
- upgrade server berdampak ke banyak aplikasi;
- library dan classloader conflict sering terjadi.

---

## 5. Model 3 — Embedded Servlet Container

### 5.1 Apa itu Embedded Container?

Embedded container berarti aplikasi membawa servlet container di dalam dependency-nya sendiri.

Contoh:

```text
app.jar
├── application classes
├── dependencies
└── embedded Tomcat/Jetty/Undertow classes
```

Aplikasi punya `main()`:

```java
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Atau secara konseptual:

```java
public static void main(String[] args) {
    Server server = new Server(8080);
    ServletContextHandler context = new ServletContextHandler();
    context.addServlet(MyServlet.class, "/hello");
    server.setHandler(context);
    server.start();
    server.join();
}
```

Pada model ini:

```text
Application starts server.
Bukan server starts application.
```

Ini perubahan ownership yang sangat besar.

---

### 5.2 Lifecycle Embedded Container

Flow:

```text
java -jar app.jar
        ↓
main() starts
        ↓
Application framework bootstraps
        ↓
Embedded container object created
        ↓
Connector configured
        ↓
ServletContext created
        ↓
Servlet/filter/listener registered
        ↓
Port opens
        ↓
Application receives traffic
```

Berbeda dari WAR external:

```text
Traditional WAR:
Container owns application lifecycle.

Embedded container:
Application owns container lifecycle.
```

---

### 5.3 Kelebihan Embedded Container

| Kelebihan | Penjelasan |
|---|---|
| Self-contained | Runtime web server ikut app |
| Reproducible | DEV/UAT/PROD lebih mudah sama |
| One process per app | Isolation lebih jelas |
| Easy local run | `java -jar` langsung jalan |
| Cloud-native friendly | Cocok untuk Docker/Kubernetes |
| Independent upgrade | Tiap service bisa upgrade server sendiri |
| Better release ownership | App team mengontrol runtime dependency |

Embedded container sangat cocok untuk microservices dan platform modern.

---

### 5.4 Kekurangan Embedded Container

| Kekurangan | Dampak |
|---|---|
| App team owns server patching | Tomcat/Jetty CVE harus dipatch per app |
| Larger artifact | Server dependency ikut artifact |
| Less centralized governance | Platform tidak otomatis mengontrol semua runtime |
| Config duplication | Thread/timeouts/logging bisa berbeda antar service |
| Need operational discipline | Graceful shutdown/readiness harus dirancang app |
| Multi-app hosting not natural | Biasanya satu process satu app |

Embedded container bukan berarti lebih sederhana secara total. Ia hanya memindahkan responsibility dari platform server ke aplikasi/service.

---

## 6. Model 4 — Executable JAR

### 6.1 Apa itu Executable JAR?

Executable JAR adalah artifact yang dapat dijalankan langsung:

```bash
java -jar my-service.jar
```

Dalam Spring Boot misalnya, artifact berisi:

```text
BOOT-INF/classes/
BOOT-INF/lib/
META-INF/
org/springframework/boot/loader/...
```

Model ini lazim untuk embedded Tomcat/Jetty/Undertow.

---

### 6.2 Executable JAR sebagai Deployment Unit

Dalam model ini, deployment unit biasanya:

```text
source code
   ↓ build
executable JAR
   ↓ package into OCI image
container image
   ↓ deploy
Kubernetes Pod / VM / process manager
```

Aplikasi menjadi unit runtime lengkap.

---

### 6.3 Kenapa Executable JAR Populer?

Karena ia menyederhanakan loop:

```text
Build once.
Run the same artifact everywhere.
```

Dibanding external WAR:

```text
Build WAR.
Deploy into server.
Hope server version/config/classpath matches.
```

Executable JAR mengurangi environment ambiguity.

---

### 6.4 Bukan Berarti Semua Harus JAR

Executable JAR cocok untuk service-oriented architecture. Tetapi WAR masih valid jika:

- ada application server governance;
- legacy enterprise integration kuat;
- deployment process sudah matang;
- server-managed capabilities lebih penting daripada self-contained artifact.

Top-tier engineer tidak fanatik format. Ia memilih berdasarkan operational invariants.

---

## 7. Executable WAR: Hybrid Model

Beberapa framework memungkinkan executable WAR:

```bash
java -jar app.war
```

Sekaligus bisa dideploy ke external container.

Konsepnya:

```text
Jika dijalankan langsung: embedded server aktif.
Jika dideploy ke container: external server menjalankan WAR.
```

Kelebihan:

- fleksibel untuk migration;
- bisa retain WAR compatibility;
- bisa local run lebih mudah;
- bisa transisi dari external container ke embedded runtime.

Kekurangan:

- dependency packaging lebih rumit;
- harus jelas mana dependency `provided`;
- behavior bisa berbeda antara `java -jar` dan external deploy;
- testing matrix bertambah.

Hybrid model bagus sebagai jembatan, bukan selalu target akhir.

---

## 8. Dependency Scope dan Servlet API

### 8.1 Servlet API di External Container

Dalam WAR external container, Servlet API disediakan oleh container.

Maven dependency biasanya:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
    <scope>provided</scope>
</dependency>
```

Artinya:

```text
Compile pakai API ini.
Jangan package API ini ke WAR.
Runtime container menyediakan implementation/API-nya.
```

Jika `jakarta.servlet-api.jar` ikut masuk `WEB-INF/lib`, bisa terjadi conflict.

---

### 8.2 Servlet API di Embedded Container

Dalam embedded app, dependency server ikut runtime.

Contoh konseptual:

```xml
<dependency>
    <groupId>org.apache.tomcat.embed</groupId>
    <artifactId>tomcat-embed-core</artifactId>
</dependency>
```

Framework seperti Spring Boot mengatur dependency embedded container melalui starter.

---

### 8.3 Dependency Boundary Rule

Rule sederhana:

```text
Jika server disediakan environment, API/server dependency biasanya provided.
Jika server dibawa aplikasi, API/server dependency menjadi runtime dependency aplikasi.
```

Kesalahan dependency scope adalah penyebab umum:

- `ClassNotFoundException`;
- `NoSuchMethodError`;
- `ClassCastException`;
- `LinkageError`;
- app jalan di local tapi gagal di container;
- app jalan di Tomcat 10 tapi gagal di Tomcat 11;
- app `javax.*` dideploy ke runtime `jakarta.*`.

---

## 9. `javax.*` vs `jakarta.*` dalam Packaging

Packaging tidak bisa dipisahkan dari namespace.

| Aplikasi | Runtime cocok | Catatan |
|---|---|---|
| Servlet 3.1/4.0 `javax.servlet.*` | Tomcat 8.5/9, Java EE era | Tidak cocok langsung ke Tomcat 10/11 |
| Servlet 5/6/6.1 `jakarta.servlet.*` | Tomcat 10/11, Jakarta EE 9+ | Tidak cocok langsung ke Tomcat 9 |
| Mixed `javax` + `jakarta` | Berisiko tinggi | Harus dianalisis dependency tree |

Kesalahan umum:

```text
Kode sudah jakarta.servlet.*
Tapi dependency library masih javax.servlet.*
```

atau:

```text
Kode masih javax.servlet.*
Tapi dideploy ke Tomcat 10/11.
```

Hasilnya bisa:

- app tidak start;
- filter tidak terdeteksi;
- listener tidak dipanggil;
- annotation scanning gagal;
- framework gagal bootstrap;
- runtime error saat class dimuat.

Migration namespace harus diperlakukan sebagai migration runtime, bukan sekadar search-and-replace import.

---

## 10. Container Image sebagai Packaging Runtime

Dalam deployment modern, artifact Java sering dibungkus lagi menjadi OCI image.

Contoh:

```text
source code
  ↓
Maven/Gradle build
  ↓
JAR/WAR
  ↓
Docker/OCI image
  ↓
registry
  ↓
Kubernetes/Cloud Run/ECS/Nomad
```

Container image menambahkan boundary baru:

```text
OS base image
JDK/JRE distribution
CA certificates
timezone data
fonts/native libraries
user permissions
filesystem layout
entrypoint
signal handling
healthcheck
```

Packaging Java tidak lagi cukup. Runtime OS layer juga bagian dari artifact.

---

### 10.1 Typical Executable JAR Dockerfile

Contoh sederhana:

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/my-service.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Ini mudah, tetapi belum optimal.

Masalah potensial:

- image besar;
- layer caching kurang baik;
- tidak ada non-root user;
- JVM memory tidak dikontrol;
- signal handling tidak diuji;
- timezone/CA cert tidak dipastikan;
- tidak ada build reproducibility.

---

### 10.2 Better Runtime Image Considerations

Hal yang perlu dipikirkan:

| Area | Pertanyaan |
|---|---|
| Base image | JDK atau JRE? distro apa? patch policy? |
| Java version | 8, 11, 17, 21, 25? apakah runtime kompatibel? |
| Memory | container memory limit sudah dibaca JVM? |
| User | root atau non-root? |
| Filesystem | app menulis ke mana? temp upload ke mana? |
| Signal | SIGTERM ditangani graceful? |
| Logging | stdout/stderr atau file? |
| Timezone | pakai UTC atau local? |
| CA cert | perlu custom truststore? |
| Native lib | perlu font, kerberos, image processing, LDAP? |

---

## 11. Layered JAR dan Image Caching

Untuk build container yang efisien, pisahkan layer yang sering berubah dan jarang berubah.

Contoh layer:

```text
base OS/JRE
third-party dependencies
snapshot/internal dependencies
application classes/resources
```

Tujuannya:

```text
Ketika hanya code berubah, image build tidak perlu upload ulang semua dependency besar.
```

Pada service besar, layered image bisa mempercepat CI/CD dan mengurangi registry/network cost.

---

## 12. jlink Custom Runtime Image

Sejak Java 9, `jlink` dapat membuat custom runtime image berisi modul JDK yang diperlukan.

Konsep:

```text
Full JDK/JRE
  ↓ jlink
Minimal runtime image untuk app
```

Potensi manfaat:

- image lebih kecil;
- attack surface lebih kecil;
- startup bisa lebih predictable;
- runtime lebih terkunci.

Trade-off:

- harus tahu module dependency;
- dynamic reflection/framework bisa membuat analisis lebih rumit;
- patching runtime image menjadi tanggung jawab build pipeline;
- tidak selalu worth it untuk aplikasi enterprise besar.

Gunakan jika ukuran, cold start, atau supply-chain hardening penting.

---

## 13. Native Image / AOT dalam Konteks Servlet

Native image/AOT dapat mengompilasi aplikasi Java menjadi binary native.

Potensi manfaat:

- startup cepat;
- memory footprint bisa lebih kecil;
- cocok untuk scale-to-zero/serverless;
- image lebih ringkas.

Namun untuk Servlet/Jakarta stack, perhatikan:

- reflection;
- annotation scanning;
- dynamic proxies;
- classpath scanning;
- JSP/Jakarta Pages;
- WebSocket endpoint discovery;
- serialization;
- runtime-generated bytecode;
- container-specific integration.

Native image bukan default untuk semua Servlet apps. Ia cocok jika:

- cold start sangat penting;
- framework mendukung AOT dengan baik;
- dependency reflection terkendali;
- operational complexity diterima.

Untuk banyak enterprise web app, JVM normal dengan tuning yang baik masih lebih fleksibel.

---

## 14. Config Injection per Packaging Model

### 14.1 Traditional External Container

Config bisa berasal dari:

```text
web.xml init-param
context-param
JNDI resource
server.xml/context.xml
system property
environment variable
external config file
application server admin console
```

Kelebihan:

- platform bisa mengelola config;
- secret bisa dikelola server;
- datasource bisa didefinisikan di container.

Risiko:

- config tersebar;
- sulit direproduksi lokal;
- drift antar environment;
- perubahan config tidak versioned bersama app.

---

### 14.2 Embedded Container / Executable JAR

Config biasanya dari:

```text
application.yaml/properties
environment variable
command-line args
system property
config server
Kubernetes ConfigMap/Secret
mounted file
cloud secret manager
```

Kelebihan:

- config model dekat dengan app;
- cocok immutable deployment;
- mudah test local;
- mudah inject via platform.

Risiko:

- secret bisa bocor ke env/log;
- config terlalu banyak di app;
- inconsistent naming antar service;
- platform governance melemah jika tidak distandardisasi.

---

## 15. Port, Context Path, and Routing Ownership

Packaging model memengaruhi siapa yang menentukan URL publik.

### 15.1 External WAR

Biasanya:

```text
WAR filename / context config menentukan context path.
```

Contoh:

```text
aceas.war  → /aceas
ROOT.war   → /
```

Tapi server-specific config bisa override.

---

### 15.2 Executable JAR

Biasanya app listen di internal port:

```text
0.0.0.0:8080
```

Lalu reverse proxy/ingress menentukan public route:

```text
https://example.com/aceas → service:8080
```

Dalam Kubernetes:

```text
Pod port → Service → Ingress/ALB → public URL
```

---

### 15.3 Context Path Pitfall

Bug umum:

```text
App memiliki context path /aceas
Ingress juga rewrite /aceas
Framework juga generate link dengan /aceas
Hasil: /aceas/aceas/...
```

Atau kebalikannya:

```text
Proxy strip /aceas
App pikir root /
Redirect balik ke /
Client kehilangan prefix /aceas
```

Rule:

```text
Hanya satu layer yang boleh menjadi source of truth untuk public path.
Layer lain harus konsisten mengikuti kontrak itu.
```

---

## 16. Readiness, Liveness, and Startup

Dalam container/Kubernetes, app harus memberi sinyal health.

### 16.1 Liveness

Liveness menjawab:

```text
Apakah process ini masih hidup atau perlu dibunuh/restart?
```

Jika liveness gagal, platform dapat restart container.

Jangan jadikan dependency eksternal seperti DB sebagai liveness hard requirement kecuali process memang tidak bisa recover tanpa restart.

Buruk:

```text
DB timeout → liveness fail → semua pod restart → outage makin parah
```

---

### 16.2 Readiness

Readiness menjawab:

```text
Apakah instance ini siap menerima traffic baru?
```

Readiness boleh gagal jika:

- startup belum selesai;
- dependency kritikal belum siap;
- app sedang draining;
- warmup belum lengkap;
- thread pool saturated parah;
- config invalid;
- migration required belum selesai.

Jika readiness gagal, instance seharusnya tidak menerima traffic baru.

---

### 16.3 Startup Probe

Startup probe berguna untuk aplikasi yang startup lama.

Tanpa startup probe, liveness bisa membunuh app sebelum startup selesai.

---

### 16.4 Health Endpoint Design

Minimal:

```text
/live   → process alive
/ready  → can receive traffic
/startup or startup probe → boot still ongoing
```

Untuk Servlet app tanpa framework:

```java
@WebServlet("/health/ready")
public class ReadinessServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (ReadinessState.isReady()) {
            resp.setStatus(200);
            resp.getWriter().write("READY");
        } else {
            resp.setStatus(503);
            resp.getWriter().write("NOT_READY");
        }
    }
}
```

---

## 17. Graceful Shutdown

Graceful shutdown adalah kemampuan berhenti tanpa memutus request secara brutal.

Mental model:

```text
SIGTERM received
        ↓
Mark instance not ready
        ↓
Stop accepting new traffic
        ↓
Drain in-flight requests
        ↓
Close/finish WebSocket sessions politely where possible
        ↓
Stop background workers
        ↓
Close DB/HTTP/message resources
        ↓
Exit before grace period expires
```

---

### 17.1 Shutdown dalam External Container

Pada WAR external:

```text
Container receives shutdown/undeploy command.
Container stops webapp context.
Listeners get contextDestroyed.
Servlets/filters destroyed.
Container releases classloader if no leak.
```

Application cleanup biasanya di:

```java
public class AppLifecycleListener implements ServletContextListener {
    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        // stop executors, close clients, release resources
    }
}
```

---

### 17.2 Shutdown dalam Executable JAR

Pada executable JAR:

```text
OS/platform sends SIGTERM to process.
JVM shutdown hook/framework lifecycle runs.
Embedded server stops accepting new requests.
App drains and exits.
```

Framework dapat menyediakan graceful shutdown support, tetapi engineer tetap harus memastikan:

- background executor dihentikan;
- scheduled job tidak menerima kerja baru;
- HTTP clients ditutup;
- DB pool ditutup;
- WebSocket sessions ditangani;
- message consumers berhenti polling;
- temp upload file dibersihkan.

---

### 17.3 Graceful Shutdown dan Kubernetes

Kubernetes termination secara konseptual:

```text
Pod marked terminating
        ↓
Endpoint removal begins
        ↓
preStop hook may run
        ↓
SIGTERM sent
        ↓
terminationGracePeriodSeconds countdown
        ↓
SIGKILL if process still alive
```

Masalah umum:

```text
Pod menerima SIGTERM tetapi masih menerima traffic beberapa detik karena endpoint/LB propagation delay.
```

Mitigasi:

- readiness berubah menjadi false segera;
- optional preStop delay untuk memberi waktu load balancer berhenti routing;
- app berhenti menerima request baru;
- grace period cukup panjang untuk request normal;
- long-running jobs tidak bergantung pada HTTP request lifecycle;
- WebSocket reconnect strategy disiapkan.

---

## 18. Rolling Update dengan Servlet Request

Rolling update aman jika invariant ini terpenuhi:

```text
Saat instance lama diganti, request baru diarahkan ke instance baru,
sementara request lama di instance lama diberi waktu selesai.
```

Risiko berdasarkan jenis request:

| Jenis traffic | Risiko saat rolling update |
|---|---|
| Short HTTP request | Relatif aman jika readiness/drain benar |
| Upload besar | Bisa putus jika grace period pendek |
| Download besar | Bisa broken pipe jika pod mati |
| Async request | Bisa timeout atau response hilang |
| SSE | Koneksi harus reconnect |
| WebSocket | Koneksi pasti node-local dan perlu reconnect/drain |
| Long transaction | Ambiguous completion jika client disconnect |

---

### 18.1 Design Rule untuk Long Request

Jangan membuat operasi bisnis kritikal bergantung sepenuhnya pada satu koneksi HTTP panjang.

Lebih baik:

```text
Client submit job
        ↓
Server persist job state
        ↓
Background worker process job
        ↓
Client poll/SSE/WebSocket for progress
        ↓
Client download result when ready
```

Daripada:

```text
Client POST request waits 15 minutes
        ↓
Pod rolling update kills request
        ↓
Client tidak tahu job committed atau tidak
```

---

## 19. WebSocket dalam Packaging dan Deployment

WebSocket berbeda dari HTTP biasa karena koneksinya long-lived dan node-local.

### 19.1 WebSocket dan External WAR

Pada external container:

- WebSocket endpoint hidup dalam webapp context;
- saat undeploy, endpoint dihancurkan;
- connection harus ditutup;
- reconnect ditangani client;
- session registry harus dibersihkan.

---

### 19.2 WebSocket dan Kubernetes Rolling Update

Saat pod lama diganti:

```text
WebSocket connection to old pod remains until closed/drained/killed.
New connections go to new pod.
Old pod exits after grace period.
```

Jika grace period habis:

```text
Koneksi WebSocket diputus secara brutal.
```

Client harus punya:

- reconnect dengan exponential backoff + jitter;
- resubscribe logic;
- message sequence/ack jika ada delivery guarantee;
- duplicate handling;
- stale presence cleanup.

Server harus punya:

- close frame reason jika shutdown terencana;
- stop accepting new WebSocket connections saat draining;
- session registry cleanup;
- external state jika cluster-wide presence dibutuhkan.

---

## 20. Immutable Deployment vs Mutable Server

### 20.1 Mutable Server Model

Traditional model sering seperti ini:

```text
Server sudah ada.
Deploy WAR baru ke server yang sama.
Server config mungkin berubah manual.
Library global mungkin berubah manual.
```

Risiko:

- environment drift;
- sulit rollback server config;
- sulit audit perubahan;
- deploy bersifat snowflake.

---

### 20.2 Immutable Artifact Model

Modern model:

```text
Build image once.
Promote same image DEV → UAT → PROD.
Runtime config injected externally.
Never mutate running container manually.
Rollback by deploying previous image.
```

Kelebihan:

- reproducibility;
- auditability;
- easier rollback;
- lower drift;
- better CI/CD automation.

Trade-off:

- butuh pipeline matang;
- config/secret management harus benar;
- image scanning/patching wajib;
- observability harus built-in.

---

## 21. Build Once, Configure per Environment

Ideal:

```text
Same binary/image across environments.
Only config changes.
```

Buruk:

```text
Build DEV artifact.
Build UAT artifact.
Build PROD artifact.
Masing-masing beda config dan mungkin beda dependency.
```

Kenapa buruk?

```text
Yang dites di UAT bukan artifact yang sama dengan PROD.
```

Rule:

```text
Promote artifact, not source code.
```

Environment-specific values sebaiknya masuk lewat:

- environment variable;
- secret manager;
- mounted config;
- platform config;
- command-line arg;
- external config service.

Bukan hardcoded di artifact.

---

## 22. Observability per Packaging Model

### 22.1 External Container

Observability bisa terbagi:

```text
container access log
container metrics
application log
application metrics
JVM metrics
OS metrics
```

Masalah umum:

- access log di server, app log di tempat lain;
- correlation ID tidak masuk access log;
- metrics container tidak dikaitkan ke app version;
- multi-app server membuat attribution sulit.

---

### 22.2 Executable JAR / Container Image

Observability biasanya per process/pod:

```text
stdout/stderr logs
app metrics endpoint
JVM metrics
container metrics
pod labels/version
trace ID/correlation ID
```

Lebih mudah mengaitkan:

```text
request → pod → app version → container image digest → log/metric/trace
```

Tetapi harus distandardisasi antar service.

---

## 23. Access Log Ownership

Access log adalah boundary penting untuk HTTP diagnostics.

Dalam external container:

```text
Tomcat/Jetty/Apache/Nginx bisa menulis access log.
```

Dalam embedded app:

```text
Embedded server/framework harus dikonfigurasi untuk access log,
atau reverse proxy/ingress menjadi source of truth.
```

Idealnya access log punya:

```text
timestamp
method
path/query normalized
status
bytes sent
duration
remote IP / forwarded client IP
user agent
correlation ID
upstream time
pod/app version
```

Tanpa access log, debugging 404/405/413/431/499/502/503/504 menjadi jauh lebih lambat.

---

## 24. Security and Patching Responsibility

### 24.1 External Container

Responsibility:

```text
Platform team patches Tomcat/Jetty/app server.
App team patches application dependencies.
```

Masalah:

- patch container berdampak ke banyak app;
- app mungkin tidak kompatibel dengan runtime baru;
- jadwal patching kompleks.

---

### 24.2 Embedded Container

Responsibility:

```text
App team patches embedded container dependency.
Each service rebuilds/redeploys.
```

Masalah:

- banyak service harus update dependency;
- dependency management harus otomatis;
- CVE scanning harus enforced;
- old services bisa tertinggal.

Kelebihan:

- patch bisa dilakukan per service;
- blast radius lebih kecil;
- rollback lebih spesifik.

---

## 25. Choosing Tomcat vs Jetty vs Undertow in Embedded Model

Pemilihan container tidak boleh hanya berdasarkan default framework.

Pertimbangkan:

| Aspek | Pertanyaan |
|---|---|
| Servlet version | Mendukung Servlet/Jakarta version target? |
| HTTP/2 | Stabil dan sesuai kebutuhan? |
| WebSocket | Behavior dan timeout cocok? |
| Async/non-blocking | Model I/O sesuai traffic? |
| Operational familiarity | Tim tahu tuning/metrics/log? |
| Ecosystem | Framework support matang? |
| Upgrade cadence | Patch dan release aktif? |
| Memory/thread model | Cocok dengan workload? |
| Kubernetes | Graceful shutdown/readiness mudah? |

Untuk banyak aplikasi, default framework cukup. Tetapi top engineer tahu bahwa default bukan magic; ia tetap harus memahami connector, thread pool, timeout, dan resource limit.

---

## 26. Migration: Traditional WAR ke Executable JAR

### 26.1 Motivasi Migration

Alasan umum:

- ingin containerized deployment;
- ingin independent release;
- mengurangi environment drift;
- mempercepat local development;
- menghindari shared app server blast radius;
- menyederhanakan CI/CD;
- memodernisasi Java/Jakarta version.

---

### 26.2 Step-by-Step Migration Plan

#### Step 1 — Inventory runtime dependency

Catat:

```text
Servlet version
JSP usage
WebSocket usage
JNDI datasource
JMS
container-managed security
server.xml/context.xml config
shared libraries
logging config
session replication
static resource serving
file upload temp path
access log
TLS termination
```

#### Step 2 — Identify server-owned capabilities

Contoh:

```text
JNDI datasource → app config / pool dependency
server realm → app/framework security config
container session replication → external session store or sticky session
server access log → embedded access log / ingress log
server TLS → ingress/proxy TLS
```

#### Step 3 — Build embedded runtime equivalent

Pastikan:

- same context path behavior;
- same servlet/filter/listener registration;
- same multipart limit;
- same session cookie config;
- same error page behavior;
- same forwarded header handling;
- same timeout behavior;
- same access log fields.

#### Step 4 — Run compatibility tests

Test:

```text
GET/POST routing
static resources
file upload/download
session login/logout
cookie flags
CORS
redirect URL
error pages
async request
WebSocket handshake
large header/body limit
client abort
shutdown drain
```

#### Step 5 — Deploy behind same proxy path

Jangan langsung ubah public URL behavior. Pertahankan kontrak client.

#### Step 6 — Gradual cutover

Gunakan:

- blue/green;
- canary;
- shadow traffic jika memungkinkan;
- quick rollback;
- metrics comparison.

---

## 27. Migration: External Container Version Upgrade

Contoh:

```text
Tomcat 9 → Tomcat 10/11
javax.servlet.* → jakarta.servlet.*
```

Ini bukan sekadar upgrade server.

Checklist:

```text
[ ] source imports migrated
[ ] web.xml namespace updated
[ ] dependencies support jakarta.*
[ ] filters/listeners compile
[ ] JSP taglibs compatible
[ ] WebSocket endpoint compatible
[ ] Spring/Framework version compatible
[ ] third-party servlet filters compatible
[ ] test classpath not mixing javax/jakarta
[ ] runtime container version supports target Servlet version
```

Jika satu dependency masih `javax.servlet.Filter`, ia tidak bisa begitu saja menjadi `jakarta.servlet.Filter`.

---

## 28. Migration: Monolith WAR ke Modular Services

Kadang packaging migration bercampur dengan architecture migration. Ini berbahaya jika dilakukan sekaligus tanpa boundary.

Buruk:

```text
WAR monolith → microservices + Kubernetes + Jakarta migration + DB split + auth rewrite sekaligus
```

Lebih aman:

```text
Phase 1: make runtime reproducible
Phase 2: containerize without changing business behavior
Phase 3: improve health/shutdown/observability
Phase 4: modularize selected boundaries
Phase 5: split services only where domain/operational reason strong
```

Top engineer memisahkan:

```text
packaging migration
runtime migration
namespace migration
architecture decomposition
business behavior change
```

Jika semua dicampur, root cause saat gagal hampir tidak bisa diisolasi.

---

## 29. Packaging and Session Strategy

Packaging menentukan session assumptions.

### 29.1 External Multi-App Server

Session mungkin:

- node-local;
- sticky via LB;
- replicated by container;
- persisted by container plugin.

### 29.2 Kubernetes Embedded App

Session biasanya:

- sticky session via ingress/LB;
- external session store;
- stateless token-based auth;
- hybrid.

Jika app sebelumnya mengandalkan session replication container, migrasi ke Kubernetes harus menjawab:

```text
Apa yang terjadi ketika pod mati?
Apa user logout?
Apa session hilang?
Apa request berikutnya diarahkan ke pod lain?
Apa session attribute serializable?
Apa session terlalu besar untuk external store?
```

---

## 30. Packaging and File Storage

Dalam external server lama, aplikasi kadang menulis ke local disk server:

```text
/opt/app/uploads
/var/tmp/app
Tomcat temp directory
shared NFS mount
```

Dalam container/Kubernetes, local filesystem pod ephemeral.

Rule:

```text
Jangan perlakukan filesystem container sebagai durable storage.
```

Gunakan:

- object storage;
- persistent volume jika benar-benar perlu;
- database metadata + object storage blob;
- temp directory hanya untuk temporary processing;
- cleanup deterministic.

Untuk multipart upload:

```text
Temp file location harus punya cukup disk.
Disk full harus diperlakukan sebagai failure mode normal.
```

---

## 31. Packaging and Background Work

Servlet app sering punya background tasks:

- scheduled cleanup;
- email sender;
- report generator;
- retry worker;
- message consumer;
- cache refresher;
- session cleanup;
- external sync job.

Packaging menentukan lifecycle background worker.

External WAR:

```text
Start in ServletContextListener.
Stop in contextDestroyed.
Risk: thread leak after redeploy.
```

Executable JAR:

```text
Framework lifecycle starts/stops beans.
Process shutdown stops workers.
Risk: no drain/cancel logic.
```

Kubernetes:

```text
Multiple replicas may run same scheduler unless leader election/locking exists.
```

Critical invariant:

```text
A webapp replica count > 1 means background jobs may run > 1 times unless explicitly coordinated.
```

---

## 32. Packaging and Database Migration

A common anti-pattern:

```text
App starts.
Each replica runs DB migration.
Multiple replicas race.
Startup fails halfway.
Readiness becomes ambiguous.
```

Better patterns:

1. Run migration as separate pipeline/job before app rollout.
2. Use migration tool with locking.
3. Make schema changes backward compatible.
4. Deploy app version that can work with old and new schema during rollout.
5. Avoid destructive schema changes during same rollout.

Packaging model matters because in Kubernetes rolling update, old and new app versions may run at the same time.

---

## 33. Packaging and Static Resources

Static resources can be served by:

```text
Servlet container default servlet
application framework
reverse proxy
CDN/object storage
```

Traditional WAR often includes static resources inside WAR.

Modern deployment may externalize:

```text
SPA assets → CDN/object storage
API service → executable JAR
```

Trade-off:

| Model | Pros | Cons |
|---|---|---|
| Static in WAR/JAR | Versioned with backend | Less CDN-friendly |
| Static via reverse proxy | Fast | More deployment coordination |
| Static via CDN | Scalable | Cache invalidation/versioning needed |
| SPA separate artifact | Independent frontend deploy | API/version compatibility needed |

For servlet apps serving static files, make sure:

- cache headers correct;
- immutable hashed assets used;
- HTML entrypoint not overcached;
- SPA fallback does not swallow API 404;
- default servlet mapping is correct.

---

## 34. Packaging and TLS

TLS can terminate at:

```text
application server
reverse proxy
load balancer
ingress controller
service mesh sidecar
```

External container era sometimes terminates TLS at Tomcat/Jetty.

Cloud/Kubernetes often terminates TLS at ALB/Ingress/API Gateway.

If TLS terminates before app, app may see:

```text
request.getScheme() == "http"
request.isSecure() == false
```

unless forwarded headers are configured.

Impact:

- wrong redirect URL;
- cookie `Secure` confusion;
- generated absolute links use HTTP;
- OAuth/OIDC redirect URI mismatch;
- HSTS/header mismatch.

Rule:

```text
When app is behind TLS offload, forwarded header handling is part of packaging/runtime config, not optional detail.
```

---

## 35. Packaging and Resource Limits

Packaging controls resource envelopes.

### 35.1 VM/External Server

Limits may be:

```text
OS memory
JVM -Xmx
Tomcat maxThreads
DB pool size
ulimit
file descriptors
server shared with many apps
```

### 35.2 Container/Kubernetes

Limits may be:

```text
container memory request/limit
CPU request/limit
JVM container ergonomics
pod ephemeral storage
HPA scaling
connection pool per replica
thread pool per replica
```

Important relation:

```text
replicas × DB pool size = maximum DB connections demanded by app tier
```

Example:

```text
10 pods × 50 DB connections = 500 possible DB connections
```

If DB only supports 200 safely, deployment can overload DB even if each pod looks healthy.

---

## 36. Capacity Formula for Packaging Decisions

Simple mental model:

```text
concurrency ≈ arrival_rate × service_time
```

If service receives:

```text
100 requests/sec
average service time 200ms
```

Expected in-flight:

```text
100 × 0.2 = 20 concurrent requests
```

But p95/p99 matters.

Packaging impacts capacity because it determines:

- number of replicas;
- worker threads per replica;
- DB pool per replica;
- HTTP client pool per replica;
- memory per process;
- startup time;
- shutdown drain time;
- load balancer distribution.

---

## 37. Failure Model by Packaging Type

### 37.1 External WAR Failure Modes

| Failure | Symptom | Root Cause |
|---|---|---|
| Class conflict | `NoSuchMethodError` | Container/shared lib mismatch |
| Redeploy leak | Metaspace grows | Static/thread/JDBC leak |
| App affects other app | server-wide slowdown | Shared JVM/container |
| Config drift | works in UAT not PROD | server config differs |
| Wrong context path | 404/redirect loop | WAR name/context mismatch |
| Container patch breakage | app fails after server upgrade | API behavior/dependency mismatch |

---

### 37.2 Executable JAR Failure Modes

| Failure | Symptom | Root Cause |
|---|---|---|
| Missing server config | timeout/header/body mismatch | Embedded defaults differ |
| No graceful shutdown | 502/connection reset during deploy | SIGTERM not drained |
| Health endpoint bad | restart loop/outage | liveness checks dependency |
| Config mistake | app starts with wrong endpoint | env var/config injection issue |
| CVE drift | old embedded Tomcat in app | dependency not upgraded |
| Memory kill | pod OOMKilled | JVM/container limit mismatch |

---

### 37.3 Kubernetes/Container Failure Modes

| Failure | Symptom | Root Cause |
|---|---|---|
| Readiness too early | traffic before warmup | readiness endpoint shallow |
| Readiness too strict | no pods ready | dependency hard check unstable |
| Grace too short | aborted requests | termination window insufficient |
| DB overload after scale | DB max connections reached | pool × replicas too high |
| WebSocket drops | clients reconnect storm | rolling update/drain not designed |
| Ephemeral file loss | missing upload/result | writing durable data to pod disk |

---

## 38. Decision Matrix

| Criterion | External WAR | Jakarta EE Server | Embedded JAR | Container Image/K8s |
|---|---:|---:|---:|---:|
| Legacy compatibility | High | High | Medium | Medium |
| Local simplicity | Medium | Low/Medium | High | Medium |
| Runtime reproducibility | Medium | Medium | High | High |
| Platform central control | High | High | Low/Medium | Medium/High |
| Independent deployability | Medium | Low/Medium | High | High |
| Multi-app hosting | High | High | Low | Low |
| Cloud-native fit | Medium | Medium | High | High |
| Classloader isolation | Medium | Medium | High per process | High per pod |
| Patch centralization | High | High | Low | Medium via image policy |
| Operational complexity | Medium | High | Medium | High |

No model wins universally.

The best model depends on organizational maturity, runtime needs, team ownership, and failure tolerance.

---

## 39. Practical Recommendation for Modern Java 8–25 Journey

### 39.1 Java 8 Legacy Enterprise

Likely:

```text
javax.servlet.*
Tomcat 8.5/9 or Java EE server
WAR/EAR deployment
JSP/legacy session use
```

Good strategy:

- stabilize deployment documentation;
- inventory container config;
- eliminate redeploy leaks;
- externalize config carefully;
- prepare `javax` → `jakarta` dependency inventory;
- do not jump directly to latest runtime without compatibility proof.

---

### 39.2 Java 11/17 Transitional Systems

Likely:

```text
Spring Boot 2.x or early 3.x
Tomcat 9/10
mixed legacy and modern libraries
```

Good strategy:

- move toward reproducible build;
- prefer executable JAR for new services;
- use WAR only where app server dependency exists;
- standardize health/shutdown/metrics;
- plan namespace migration explicitly.

---

### 39.3 Java 21+ Modern Systems

Likely:

```text
jakarta.*
Spring Boot 3.x / Jakarta EE 10/11
embedded container or modern app server
container image
Kubernetes/cloud runtime
```

Good strategy:

- use immutable image deployment;
- design readiness/liveness properly;
- use graceful shutdown;
- align proxy/app timeouts;
- treat WebSocket/SSE as long-lived connection lifecycle;
- evaluate virtual threads but do not ignore downstream pools;
- standardize observability.

---

### 39.4 Java 25+ Forward-Looking Runtime

Java 25 gives a modern platform baseline, but packaging concerns remain:

- Servlet API compatibility still matters;
- container support matrix still matters;
- `jakarta.*` namespace still matters;
- deployment platform still sends SIGTERM;
- load balancer still has timeout;
- DB still has max connections;
- WebSocket still reconnects;
- artifact still needs patching.

A newer JDK does not remove web runtime discipline.

---

## 40. Example: Same Servlet App in Three Packaging Styles

### 40.1 Plain Servlet

```java
package com.example.web;

import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

@WebServlet("/hello")
public class HelloServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setContentType("text/plain;charset=UTF-8");
        resp.getWriter().write("hello");
    }
}
```

---

### 40.2 WAR Deployment

Maven dependency:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
    <scope>provided</scope>
</dependency>
```

Package:

```bash
mvn clean package
```

Deploy:

```text
target/myapp.war → external Tomcat/Jetty/Jakarta EE server
```

Server owns connector and lifecycle.

---

### 40.3 Embedded Container Conceptual Deployment

App has main method that starts server.

Package:

```bash
mvn clean package
java -jar target/myapp.jar
```

Application owns server lifecycle.

---

### 40.4 Container Image Deployment

```dockerfile
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY target/myapp.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Deploy:

```text
image registry → Kubernetes Deployment → Service → Ingress/ALB
```

Platform owns process orchestration and traffic routing.

---

## 41. Production Checklist

### 41.1 Packaging Checklist

```text
[ ] Packaging model explicitly chosen: WAR / EAR / executable JAR / image
[ ] Servlet API scope correct
[ ] javax/jakarta namespace compatible with runtime
[ ] Container version documented
[ ] Java version documented
[ ] Build artifact reproducible
[ ] Same artifact promoted across environments
[ ] Dependency tree scanned for conflicting servlet APIs
[ ] Static resources strategy defined
[ ] Context path and proxy route contract defined
```

---

### 41.2 Runtime Checklist

```text
[ ] Port configured
[ ] Context path configured
[ ] Forwarded headers configured
[ ] Thread pool configured
[ ] Connection timeout configured
[ ] Keep-alive timeout configured
[ ] Header/body/multipart limits configured
[ ] Access log enabled
[ ] Error response behavior tested
[ ] Session cookie flags configured
[ ] Temp directory configured
```

---

### 41.3 Container/Kubernetes Checklist

```text
[ ] Readiness endpoint exists
[ ] Liveness endpoint does not cause cascading restarts
[ ] Startup probe used if startup can be slow
[ ] Graceful shutdown enabled/tested
[ ] terminationGracePeriodSeconds sufficient
[ ] preStop/LB drain behavior considered
[ ] Resource requests/limits configured
[ ] JVM memory respects container limit
[ ] DB pool × replicas checked
[ ] Logs go to stdout/stderr or approved sink
[ ] Image runs as non-root if possible
[ ] Image scanned for CVEs
```

---

### 41.4 WebSocket/SSE Checklist

```text
[ ] Proxy supports upgrade/streaming
[ ] Idle timeout aligned across app/proxy/LB
[ ] Server stops accepting new connections during drain
[ ] Client reconnect strategy exists
[ ] Duplicate reconnect handled
[ ] Presence/session registry cleanup exists
[ ] Message replay/ack considered if required
[ ] Rolling update tested with active connections
```

---

## 42. Anti-Patterns

### Anti-Pattern 1 — “It works on my Tomcat”

Problem:

```text
Local Tomcat differs from UAT/PROD Tomcat.
```

Fix:

```text
Pin runtime version. Automate environment. Use container image or documented server build.
```

---

### Anti-Pattern 2 — Packaging Servlet API into WAR

Problem:

```text
WEB-INF/lib contains servlet-api.jar.
```

Fix:

```text
Use provided scope for external container.
```

---

### Anti-Pattern 3 — Liveness Checks DB

Problem:

```text
DB hiccup causes pod restarts and outage amplification.
```

Fix:

```text
Use readiness for dependency availability. Liveness should indicate process irrecoverability.
```

---

### Anti-Pattern 4 — No Shutdown Drain

Problem:

```text
Rolling update causes 502/connection reset.
```

Fix:

```text
Mark not ready, stop accepting new traffic, drain in-flight, close resources.
```

---

### Anti-Pattern 5 — Local Disk as Durable Storage

Problem:

```text
Pod restart loses uploaded/generated files.
```

Fix:

```text
Use object storage, DB metadata, or persistent volume with explicit semantics.
```

---

### Anti-Pattern 6 — Migrating Packaging and Architecture Simultaneously

Problem:

```text
Runtime migration + microservice split + namespace migration + DB split all at once.
```

Fix:

```text
Separate migration dimensions. Make each change observable and reversible.
```

---

## 43. Mental Model: Deployment as State Machine

A production web app instance moves through states:

```text
Built
  ↓
Packaged
  ↓
Image created
  ↓
Scheduled
  ↓
Starting
  ↓
Initialized
  ↓
Ready
  ↓
Serving
  ↓
Draining
  ↓
Stopping
  ↓
Stopped
```

Each state has allowed operations:

| State | Should accept traffic? | Should start background work? | Should pass readiness? |
|---|---:|---:|---:|
| Starting | No | Maybe limited | No |
| Initialized | Maybe | Maybe | Maybe |
| Ready | Yes | Yes | Yes |
| Serving | Yes | Yes | Yes |
| Draining | No new traffic | Finish/stop | No |
| Stopping | No | No | No |
| Stopped | No | No | No |

If these states are not explicit, production behavior becomes accidental.

---

## 44. Top 1% Engineering Perspective

A strong engineer can package and run Java web apps.

A top-tier engineer understands the deeper invariants:

```text
Artifact identity:
What exact code and dependencies are running?

Runtime identity:
What server, JVM, OS, and config are running it?

Traffic identity:
What path, host, scheme, and headers does the app believe it serves?

Lifecycle identity:
When is the app starting, ready, serving, draining, and stopped?

Failure identity:
What happens to in-flight HTTP, async, upload, download, SSE, and WebSocket traffic during failure or deploy?

Ownership identity:
Who patches, configures, observes, and rolls back each layer?
```

This is why packaging is not a junior topic. Packaging is where source code becomes a living system.

---

## 45. Summary

Di part ini kita mempelajari:

- WAR sebagai standard Servlet web archive;
- external servlet container lifecycle;
- Jakarta EE application server dan EAR;
- embedded servlet container;
- executable JAR dan executable WAR;
- container image sebagai runtime artifact;
- dependency scope untuk Servlet API;
- `javax.*` vs `jakarta.*` compatibility;
- config injection;
- context path dan routing ownership;
- readiness, liveness, startup probe;
- graceful shutdown;
- rolling update untuk HTTP, async, SSE, WebSocket;
- immutable deployment;
- observability dan access log ownership;
- patching responsibility;
- migration strategy;
- session, file storage, background jobs, DB migration implications;
- production checklist dan anti-pattern.

Key takeaway:

```text
Packaging model menentukan lifecycle, ownership, isolation, compatibility, observability, dan failure semantics aplikasi web Java.
```

---

## 46. Referensi

- Jakarta Servlet 6.1 Specification — https://jakarta.ee/specifications/servlet/6.1/
- Jakarta EE Tutorial: Getting Started with Web Applications — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/webapp/webapp.html
- Jakarta Servlet API Documentation — https://jakarta.ee/specifications/platform/11/apidocs/
- Apache Tomcat Documentation — https://tomcat.apache.org/
- Spring Boot Embedded Web Servers Documentation — https://docs.spring.io/spring-boot/how-to/webserver.html
- Spring Boot Traditional Deployment Documentation — https://docs.spring.io/spring-boot/how-to/deployment/traditional-deployment.html
- Spring Boot Servlet Web Applications Documentation — https://docs.spring.io/spring-boot/reference/web/servlet.html
- Kubernetes Probes Documentation — https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes Configure Liveness, Readiness and Startup Probes — https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

---

## 47. Posisi dalam Seri

Part selesai:

```text
Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments
```

Seri belum selesai. Lanjut ke:

```text
Part 021 — WebSocket Protocol Fundamentals
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 019 — Web Application Classloading, Deployment, and Redeployment](./learn-java-servlet-websocket-web-container-runtime-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 021 — WebSocket Protocol Fundamentals](./learn-java-servlet-websocket-web-container-runtime-part-021.md)
