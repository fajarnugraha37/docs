# learn-java-servlet-websocket-web-container-runtime-part-019

# Part 019 — Web Application Classloading, Deployment, and Redeployment

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Fokus: Java 8 hingga Java 25, Java EE `javax.*` hingga Jakarta EE `jakarta.*`  
> Posisi: setelah Servlet lifecycle, request/response, session, async, non-blocking I/O, payload, error handling, dan threading model

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas Servlet dari sisi lifecycle, request/response, dispatch, filter, listener, session, async, error, dan threading. Semua itu menjawab pertanyaan:

> “Apa yang terjadi ketika request masuk dan kode aplikasi dijalankan?”

Bagian ini menjawab pertanyaan yang lebih dalam:

> “Dari mana class aplikasi itu berasal, siapa yang memuatnya, kapan ia dibuang, kenapa ia kadang tidak bisa dibuang, dan kenapa redeploy Java web application bisa bocor memory walaupun request sudah selesai?”

Topik ini sering diremehkan karena developer modern terbiasa dengan executable JAR, container image, dan restart pod. Tetapi untuk engineer level tinggi, classloading tetap fundamental karena ia menentukan:

- dependency isolation,
- konflik library,
- `NoClassDefFoundError`,
- `ClassCastException` misterius,
- `LinkageError`,
- `ServiceLoader` behavior,
- annotation scanning,
- Servlet API `provided` dependency,
- hot redeploy,
- Metaspace growth,
- memory leak saat undeploy,
- static state leakage,
- JDBC driver registration leak,
- background thread leak,
- `ThreadLocal` leak,
- logging framework leak,
- dan perbedaan besar antara WAR deployment dan embedded server.

Bagian ini bukan pengulangan JVM classloading umum. Fokus kita adalah **classloading dalam Java web application runtime**.

---

## 1. Mental Model Utama

Servlet application bukan hanya kumpulan class Java. Ia adalah **unit deployment** yang dimuat oleh container ke dalam satu boundary runtime tertentu.

Secara sederhana:

```text
JVM process
  |
  +-- Bootstrap / Platform / System classloader
  |
  +-- Container / Common classloader
  |     |
  |     +-- Servlet container classes
  |     +-- Jakarta Servlet API
  |     +-- optional shared libraries
  |
  +-- WebAppClassLoader for /app-a
  |     |
  |     +-- WEB-INF/classes
  |     +-- WEB-INF/lib/*.jar
  |
  +-- WebAppClassLoader for /app-b
        |
        +-- WEB-INF/classes
        +-- WEB-INF/lib/*.jar
```

Implikasinya:

1. Setiap web application biasanya punya classloader sendiri.
2. Dua web application dalam container yang sama bisa memuat versi library berbeda.
3. Class yang namanya sama tetapi dimuat classloader berbeda adalah **class berbeda** di JVM.
4. Saat redeploy, container mencoba membuang classloader lama.
5. Classloader lama hanya bisa garbage collected jika tidak ada object/thread/static/reference dari luar yang masih menahannya.
6. Banyak memory leak web application bukan leak object business biasa, tetapi **classloader retention leak**.

Kalimat kuncinya:

> Redeploy yang sehat berarti seluruh object graph milik classloader lama harus bisa unreachable.

---

## 2. Kenapa Classloader Penting untuk Servlet Engineer

Dalam aplikasi biasa, classloader sering tidak terasa. Dalam Servlet container, classloader menjadi explicit runtime boundary.

Contoh masalah nyata:

```text
Problem:
  Deploy app versi baru.
  App jalan, tetapi setelah beberapa redeploy memory naik terus.

Bukan karena:
  Semua request menyimpan data ke List global.

Tapi karena:
  App lama membuat background thread.
  Thread itu masih hidup setelah undeploy.
  Thread context classloader menunjuk WebAppClassLoader lama.
  Semua class dan static object milik app lama ikut tertahan.
```

Contoh lain:

```text
Problem:
  java.lang.ClassCastException:
  com.acme.User cannot be cast to com.acme.User

Penyebab:
  Ada dua class bernama com.acme.User,
  tetapi dimuat oleh dua classloader berbeda.
```

Ini terlihat absurd bagi developer yang hanya melihat package/class name. Tapi bagi JVM, identity class adalah:

```text
fully qualified class name + defining classloader
```

Bukan hanya nama class.

---

## 3. Deployment Unit: WAR sebagai Boundary

Dalam Servlet world klasik, unit deployment utama adalah WAR.

Struktur umum:

```text
my-app.war
  |
  +-- index.html
  +-- assets/
  +-- WEB-INF/
       |
       +-- web.xml
       +-- classes/
       |    +-- com/acme/AppServlet.class
       |
       +-- lib/
            +-- app-service.jar
            +-- jackson-databind.jar
            +-- hibernate-validator.jar
```

Konvensi penting:

| Lokasi | Makna |
|---|---|
| `/` root WAR | static resources yang bisa diakses client jika tidak dilindungi |
| `WEB-INF/` | area internal aplikasi, tidak boleh diakses langsung oleh client |
| `WEB-INF/classes` | compiled application classes dan resources |
| `WEB-INF/lib/*.jar` | dependency JAR milik aplikasi |
| `WEB-INF/web.xml` | deployment descriptor legacy/explicit config |

Jakarta Servlet Specification menyatakan bahwa web application classloader harus memuat class dari `WEB-INF/classes` terlebih dahulu, lalu library JAR di `WEB-INF/lib`. Spec juga menyatakan request client ke resource dalam `WEB-INF/` harus menghasilkan 404, kecuali kasus khusus static resources dalam JAR. Ini penting karena `WEB-INF` adalah private deployment area, bukan public document root.

---

## 4. `WEB-INF/classes` vs `WEB-INF/lib`

Order loading yang perlu diingat:

```text
1. WEB-INF/classes
2. WEB-INF/lib/*.jar
3. parent/container classloader, tergantung delegation policy dan container rules
```

Secara praktis:

- Class aplikasi langsung biasanya berada di `WEB-INF/classes`.
- Internal module/dependency berada di `WEB-INF/lib`.
- Jika class yang sama ada di `WEB-INF/classes` dan salah satu JAR di `WEB-INF/lib`, versi di `WEB-INF/classes` menang.

Contoh:

```text
WEB-INF/classes/com/acme/Foo.class
WEB-INF/lib/acme-core.jar!/com/acme/Foo.class
```

Yang digunakan webapp classloader adalah:

```text
WEB-INF/classes/com/acme/Foo.class
```

Ini bisa membantu saat debugging, tetapi juga bisa menjadi sumber shadowing bug.

---

## 5. Parent-First vs Child-First Classloading

JVM classloader normal memakai parent delegation:

```text
child asks parent first
if parent cannot load, child loads itself
```

Tetapi web application perlu dependency isolation. Karena itu Servlet container biasanya memberi webapp classloader kemampuan khusus agar webapp bisa memakai library sendiri.

Konsepnya:

```text
Parent-first:
  parent/container library lebih dulu

Child-first / webapp-first:
  WEB-INF/classes dan WEB-INF/lib lebih dulu untuk sebagian besar class
```

Namun tidak semua class boleh di-override oleh webapp. Contoh yang biasanya harus berasal dari container/JDK:

- Java platform classes,
- Servlet API classes,
- container implementation classes,
- beberapa Jakarta EE API tertentu tergantung server,
- security/module-critical classes.

Kenapa?

Karena container dan aplikasi harus sepakat pada satu kontrak API. Jika aplikasi membawa Servlet API sendiri dan container memakai Servlet API berbeda, bisa terjadi type mismatch.

Contoh dependency salah:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>compile</scope>
</dependency>
```

Untuk WAR pada external servlet container, biasanya harus:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>provided</scope>
</dependency>
```

Maknanya:

```text
compile-time:
  aplikasi butuh API untuk compile

runtime:
  container menyediakan API tersebut
```

---

## 6. `provided` Scope Bukan Formalitas

`provided` scope sering dianggap sekadar trik Maven agar WAR lebih kecil. Itu salah.

`provided` adalah pernyataan arsitektural:

> “Kontrak ini disediakan oleh runtime deployment target, bukan oleh aplikasi.”

Contoh dependency yang sering `provided` untuk WAR eksternal:

| Dependency | Kenapa biasanya `provided` |
|---|---|
| `jakarta.servlet-api` | container menyediakan Servlet API |
| `jakarta.websocket-api` | container menyediakan WebSocket API jika supported |
| `jakarta.annotation-api` | Jakarta runtime/server sering menyediakan |
| `jakarta.enterprise.cdi-api` | full Jakarta EE server menyediakan CDI API |
| `jakarta.ws.rs-api` | Jakarta EE/JAX-RS runtime menyediakan |

Tetapi untuk embedded server/executable JAR, konteksnya berbeda.

Pada embedded Tomcat/Spring Boot:

```text
Aplikasi membawa container ke dalam process-nya sendiri.
```

Maka dependency container bukan `provided`; ia bagian dari aplikasi.

Perbandingan:

| Model | Servlet API/container dependency |
|---|---|
| WAR ke external Tomcat | Servlet API `provided`; Tomcat sudah ada |
| Spring Boot executable JAR | embedded Tomcat/Jetty/Undertow ikut packaged |
| Jakarta EE server WAR | Jakarta APIs biasanya `provided` |
| Plain Java main + embedded Jetty | Jetty libraries compile/runtime dependency |

Top-tier engineer tidak menghafal scope; ia bertanya:

> “Siapa runtime owner dependency ini: aplikasi atau container?”

---

## 7. `javax.*` dan `jakarta.*` sebagai Classloading Boundary

Setelah migration Java EE ke Jakarta EE, namespace berubah dari:

```java
javax.servlet.http.HttpServlet
```

menjadi:

```java
jakarta.servlet.http.HttpServlet
```

Ini bukan rename kosmetik. Ini class berbeda total.

Artinya:

```text
javax.servlet.http.HttpServlet != jakarta.servlet.http.HttpServlet
```

Jika aplikasi dikompilasi dengan `javax.servlet.*`, ia tidak bisa langsung berjalan pada container yang hanya menyediakan `jakarta.servlet.*`, kecuali ada transformation/compatibility layer tertentu.

Contoh problem:

```text
App compiled against javax.servlet.Filter
Container expects jakarta.servlet.Filter
```

Akibat:

- annotation tidak dikenali,
- class tidak dianggap Servlet/Filter,
- startup failure,
- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- framework integration gagal.

Migration `javax` ke `jakarta` harus dilihat sebagai **binary compatibility break**, bukan sekadar import cleanup.

---

## 8. Container-Level Classloader Hierarchy

Setiap container punya detail berbeda, tetapi mental model umumnya mirip.

### 8.1 Tomcat-style mental model

Tomcat menggunakan beberapa classloader untuk memisahkan bootstrap, system, common, dan web application. Dokumentasi Tomcat Class Loader HOW-TO menjelaskan bahwa Tomcat memasang berbagai classloader agar container dan web application punya akses ke repository class/resource yang berbeda.

Secara konseptual:

```text
Bootstrap
  |
System
  |
Common
  |
Webapp1

Common
  |
Webapp2
```

`Common` terlihat oleh container dan semua webapp. `Webapp1` dan `Webapp2` terpisah.

Implikasi:

- Library di `$CATALINA_BASE/lib` terlihat oleh semua webapp.
- Library di `WEB-INF/lib` hanya terlihat oleh webapp tersebut.
- Jika library dimasukkan ke common lib, ia menjadi shared global dependency.

Keuntungan shared lib:

- bisa dipakai banyak aplikasi,
- berguna untuk driver atau extension tertentu,
- menghindari duplicate library besar.

Risiko shared lib:

- versi library harus kompatibel dengan semua aplikasi,
- upgrade satu library bisa memengaruhi banyak aplikasi,
- classloader leak bisa melibatkan boundary container,
- dependency isolation melemah.

### 8.2 Jetty-style mental model

Jetty juga memiliki pemisahan antara server classpath/module dan web application classpath. Jetty 12 memperkenalkan model yang lebih modular dan mendukung environment EE yang berbeda. Dokumentasi Jetty menyebut module `ext` dapat menambahkan library ke server classpath/module-path, misalnya untuk logging server-wide atau JDBC driver.

Mental modelnya:

```text
Jetty server layer
  |
  +-- server modules
  +-- server-wide extensions
  |
  +-- webapp environment/classpath
```

Jetty embedded sering membuat boundary ini terasa berbeda karena developer menyusun server dengan kode Java sendiri.

### 8.3 Full Jakarta EE server

Pada server seperti GlassFish, Payara, WildFly, atau Open Liberty, classloading lebih kompleks karena bukan hanya Servlet.

Ada boundary:

- server modules,
- Jakarta EE APIs,
- application EAR,
- WAR module,
- EJB module,
- shared library,
- deployment-specific classloader,
- module system internal server.

Karena seri ini fokus Servlet/WebSocket, cukup pegang prinsip:

> Semakin lengkap application server, semakin penting memahami owner dependency dan visibility antar module.

---

## 9. Class Visibility

Class visibility menjawab:

> “Class A bisa melihat class B atau tidak?”

Contoh dalam satu WAR:

```text
WEB-INF/classes/com/acme/web/UserServlet.class
WEB-INF/lib/acme-service.jar!/com/acme/service/UserService.class
```

`UserServlet` bisa melihat `UserService`.

Contoh dua WAR:

```text
app-a.war
  WEB-INF/lib/acme-common-1.0.jar

app-b.war
  WEB-INF/lib/acme-common-2.0.jar
```

`app-a` dan `app-b` tidak otomatis saling melihat.

Jika app-a ingin memanggil app-b, gunakan boundary runtime:

- HTTP,
- messaging,
- shared database dengan hati-hati,
- remote interface,
- event stream,
- service call,
- bukan direct Java class reference.

Anti-pattern:

```text
App A mencoba import class dari App B dalam same container.
```

Itu mengikat deployment yang seharusnya independen.

---

## 10. Class Identity: Kenapa `User cannot be cast to User`

Di JVM:

```text
Class identity = class name + defining classloader
```

Maka dua class dengan nama sama bisa berbeda:

```text
Class: com.acme.User
Loaded by: WebAppClassLoader@app-a

Class: com.acme.User
Loaded by: WebAppClassLoader@app-b
```

Bagi JVM:

```text
com.acme.User@app-a != com.acme.User@app-b
```

Ini bisa menyebabkan:

```text
ClassCastException: com.acme.User cannot be cast to com.acme.User
```

Kapan terjadi?

- object dibuat oleh shared/common classloader tapi tipe expected dari webapp classloader,
- library duplikat di parent dan child,
- shared cache menyimpan object aplikasi dari classloader lama,
- static singleton di common lib menerima object webapp,
- JNDI/shared registry membawa object antar aplikasi,
- serialization/deserialization melewati boundary classloader.

Debugging checklist:

```java
System.out.println(obj.getClass());
System.out.println(obj.getClass().getClassLoader());
System.out.println(ExpectedType.class.getClassLoader());
```

Dalam production, jangan print sembarangan; gunakan targeted diagnostic log.

---

## 11. Annotation Scanning dan Startup Cost

Servlet modern mendukung annotation seperti:

```java
@WebServlet
@WebFilter
@WebListener
@ServerEndpoint
```

Agar annotation ini ditemukan, container perlu melakukan scanning classpath webapp.

Yang discan dapat mencakup:

- `WEB-INF/classes`,
- JAR di `WEB-INF/lib`,
- `ServletContainerInitializer`,
- `web-fragment.xml`,
- annotation tertentu,
- service provider metadata.

Masalah:

```text
Semakin banyak JAR, semakin tinggi startup scanning cost.
```

Gejala:

- startup lambat,
- redeploy lambat,
- pod readiness lambat,
- CPU tinggi saat boot,
- memory spike saat scanning,
- classpath conflict saat scanner membaca class incompatible.

Optimisasi konseptual:

1. Jangan membawa dependency yang tidak dipakai.
2. Gunakan explicit config jika scanning terlalu mahal.
3. Pahami container-specific scanning exclusion.
4. Hindari fat WAR yang membawa semua library enterprise tanpa kebutuhan.
5. Jangan mencampur framework era `javax` dan `jakarta` dalam satu app.

---

## 12. `ServletContainerInitializer` dan `web-fragment.xml`

Sejak Servlet 3.x, framework bisa auto-register component melalui `ServletContainerInitializer`.

Mekanismenya biasanya memakai:

```text
META-INF/services/jakarta.servlet.ServletContainerInitializer
```

atau untuk legacy:

```text
META-INF/services/javax.servlet.ServletContainerInitializer
```

Container menemukan initializer melalui scanning/service provider mechanism, lalu memanggil initializer saat startup.

Framework dapat menggunakan ini untuk register:

- servlet,
- filter,
- listener,
- framework dispatcher,
- WebSocket endpoint,
- integration bootstrap.

`web-fragment.xml` memungkinkan JAR berkontribusi pada deployment descriptor.

Mental model:

```text
web.xml              explicit app descriptor
web-fragment.xml     descriptor contribution from library JAR
annotations          code-level component declaration
SCI                  programmatic startup extension point
```

Risiko:

- startup behavior berasal dari library yang tidak terlihat jelas,
- ordering sulit dipahami,
- dependency membawa initializer yang tidak diinginkan,
- migration `javax`/`jakarta` membuat initializer tidak ditemukan.

Top-tier engineer akan mampu menjawab:

> “Servlet/filter ini didaftarkan dari mana: web.xml, annotation, framework code, atau initializer dari dependency?”

---

## 13. Deployment Lifecycle

Lifecycle deployment kira-kira seperti ini:

```text
1. Container detects deployment artifact
2. Creates web application context
3. Creates webapp classloader
4. Scans WEB-INF/classes and WEB-INF/lib
5. Parses web.xml / fragments / annotations
6. Runs ServletContainerInitializer
7. Creates listeners
8. Calls ServletContextListener.contextInitialized
9. Initializes load-on-startup servlets
10. Marks context available
11. Routes requests to app
```

Undeploy lifecycle:

```text
1. Stop accepting new requests for context
2. Let or force active requests finish depending container policy
3. Close sessions / notify listeners as applicable
4. Call ServletContextListener.contextDestroyed
5. Destroy servlets and filters
6. Stop WebSocket endpoints/connections as applicable
7. Release container resources
8. Drop references to WebAppClassLoader
9. JVM GC can reclaim classes if no references remain
```

Redeploy is effectively:

```text
undeploy old app
then deploy new app
```

The hard part is not loading the new app. The hard part is fully releasing the old one.

---

## 14. Redeploy Leak: Core Model

Redeploy leak happens when old classloader remains reachable.

```text
GC roots
  |
  +-- live Thread
       |
       +-- contextClassLoader = WebAppClassLoader(old)
             |
             +-- loaded classes
             +-- static fields
             +-- class metadata
             +-- constant pools
             +-- resources
```

Or:

```text
GC roots
  |
  +-- static singleton in parent/common classloader
       |
       +-- object from webapp old classloader
             |
             +-- Class object
             +-- WebAppClassLoader(old)
```

Or:

```text
GC roots
  |
  +-- DriverManager
       |
       +-- JDBC Driver loaded by WebAppClassLoader(old)
```

Jika old classloader tertahan, maka seluruh loaded class metadata dan reachable static graph ikut tertahan.

Di Java 8+, class metadata berada di Metaspace, bukan PermGen. Maka gejala modern:

```text
Metaspace usage grows after repeated redeploy
```

Bukan:

```text
PermGen space
```

Kecuali membahas legacy Java 7 ke bawah.

---

## 15. Static Field Leak

Static field hidup selama class hidup. Class hidup selama classloader hidup.

Contoh buruk:

```java
public final class GlobalRegistry {
    public static final Map<String, Object> CACHE = new ConcurrentHashMap<>();
}
```

Dalam satu deployment, ini mungkin terlihat normal. Saat redeploy, class `GlobalRegistry` versi lama harus hilang bersama classloader lama.

Masalah terjadi jika static object dari webapp lama direferensikan dari luar webapp classloader, misalnya:

```text
common library singleton -> object webapp -> old classloader
```

Atau static field menjalankan resource yang tidak dihentikan:

```java
public final class BadScheduler {
    static final ScheduledExecutorService EXECUTOR =
        Executors.newSingleThreadScheduledExecutor();
}
```

Jika executor tidak shutdown saat undeploy, thread tetap hidup dan menahan classloader.

Rule:

> Static state dalam webapp harus dianggap milik lifecycle deployment, bukan milik JVM process.

---

## 16. Thread Leak

Thread leak adalah penyebab klasik webapp undeploy leak.

Contoh buruk:

```java
@WebListener
public class BadListener implements ServletContextListener {
    private Thread thread;

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        thread = new Thread(() -> {
            while (true) {
                doWork();
            }
        }, "bad-worker");
        thread.start();
    }
}
```

Masalah:

- thread tidak berhenti,
- loop tidak interrupt-aware,
- context classloader thread kemungkinan menunjuk webapp classloader,
- old deployment tidak bisa dilepas.

Versi lebih benar:

```java
@WebListener
public class ManagedWorkerListener implements ServletContextListener {
    private ExecutorService executor;

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        executor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "app-worker");
            t.setDaemon(false);
            return t;
        });

        executor.submit(this::runLoop);
    }

    private void runLoop() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                doOneUnitOfWork();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (Throwable t) {
                // log and decide whether to continue
            }
        }
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        executor.shutdownNow();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                sce.getServletContext().log("Worker did not terminate cleanly");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

Better in Jakarta EE server:

- use managed executor if available,
- let server own lifecycle,
- avoid raw unmanaged thread creation.

But because we avoid repeating Jakarta Concurrency details, cukup pegang prinsip:

> Thread yang dibuat aplikasi harus dihentikan oleh aplikasi pada lifecycle destroy, atau dikelola runtime yang lifecycle-aware.

---

## 17. `ThreadLocal` Leak

`ThreadLocal` sangat berbahaya di Servlet runtime karena worker thread sering lebih panjang umurnya daripada request.

Contoh:

```java
public final class CurrentUserHolder {
    private static final ThreadLocal<User> CURRENT = new ThreadLocal<>();

    public static void set(User user) {
        CURRENT.set(user);
    }

    public static User get() {
        return CURRENT.get();
    }
}
```

Jika filter lupa cleanup:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {
    CurrentUserHolder.set(resolveUser(req));
    chain.doFilter(req, res);
}
```

Maka user/request state bisa tertinggal di thread pool.

Versi benar:

```java
public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
        throws IOException, ServletException {
    try {
        CurrentUserHolder.set(resolveUser(req));
        chain.doFilter(req, res);
    } finally {
        CurrentUserHolder.clear();
    }
}
```

Dengan:

```java
public static void clear() {
    CURRENT.remove();
}
```

Redeploy leak angle:

```text
container worker thread survives redeploy
  -> ThreadLocalMap contains value from old webapp class
  -> old webapp classloader retained
```

ThreadLocal leak bukan hanya data leak antar request. Ia juga classloader leak.

---

## 18. JDBC Driver Leak

JDBC driver registration sering menjadi sumber leak pada deployment lama.

Mekanisme umum:

```text
JDBC driver class loaded
  -> driver registers with DriverManager
  -> DriverManager is JDK/system-level registry
  -> registry keeps driver reference
  -> driver classloader retained
```

Jika driver berada di `WEB-INF/lib`, driver dimuat oleh webapp classloader. Jika tidak deregister saat undeploy, `DriverManager` bisa menahan reference.

Cleanup pattern:

```java
@WebListener
public class JdbcCleanupListener implements ServletContextListener {
    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        ClassLoader webappClassLoader = Thread.currentThread().getContextClassLoader();

        Enumeration<Driver> drivers = DriverManager.getDrivers();
        while (drivers.hasMoreElements()) {
            Driver driver = drivers.nextElement();
            if (driver.getClass().getClassLoader() == webappClassLoader) {
                try {
                    DriverManager.deregisterDriver(driver);
                } catch (SQLException e) {
                    sce.getServletContext().log("Failed to deregister JDBC driver", e);
                }
            }
        }
    }
}
```

Namun dalam container modern, ada built-in leak detection/prevention. Tetap, engineer harus memahami root cause.

Alternatif deployment:

```text
Put JDBC driver in container common lib
```

Keuntungan:

- driver dimuat oleh common/container classloader,
- tidak ikut webapp redeploy,
- bisa mengurangi driver redeploy leak.

Risiko:

- driver version shared semua aplikasi,
- upgrade driver berdampak global,
- dependency isolation berkurang.

Pilih sesuai ownership model.

---

## 19. Timer, Scheduler, Executor Leak

Sumber leak umum:

- `java.util.Timer`,
- `ScheduledExecutorService`,
- custom thread pool,
- HTTP client dispatcher thread,
- message consumer thread,
- file watcher,
- metrics reporter,
- tracing exporter,
- cache maintenance thread.

Checklist saat `contextDestroyed`:

```text
[ ] stop scheduler
[ ] shutdown executor
[ ] close HTTP client
[ ] close DB pool
[ ] close message consumer
[ ] flush/stop metrics reporter
[ ] close tracing exporter
[ ] stop file watcher
[ ] clear registries
[ ] remove MBeans if registered
[ ] remove ThreadLocals
```

Rule praktis:

> Semua object yang punya method `close`, `shutdown`, `stop`, `destroy`, atau `disconnect` harus punya owner lifecycle yang jelas.

Kalau object dibuat saat startup, ia harus dihentikan saat shutdown.

---

## 20. Logging Framework Leak

Logging terlihat harmless, tetapi bisa melibatkan classloader.

Masalah potensial:

- async appender thread tidak berhenti,
- logger context per webapp tidak distop,
- static logger registry menahan class webapp,
- bridge logging konflik,
- duplicate logging implementation di parent dan webapp,
- appender menahan reference ke classloader/resource.

Contoh:

```text
WEB-INF/lib/logback-classic.jar
container/lib/logback-classic.jar
```

Atau:

```text
jul-to-slf4j + log4j-to-slf4j + slf4j-to-log4j loop
```

Prinsip:

1. Tentukan logging owner: container-level atau app-level.
2. Jangan duplikasi binding logging di parent dan child tanpa sadar.
3. Jika logging context dibuat per app, pastikan dihentikan saat undeploy.
4. Untuk external container multi-app, logging architecture harus eksplisit.
5. Untuk embedded app, logging biasanya lebih sederhana karena process = app.

---

## 21. Resource Leak via `URLClassLoader`/JAR File Handles

Pada beberapa OS/runtime, JAR file bisa tetap locked jika classloader/resource tidak dilepas. Ini lebih sering terasa di Windows atau environment dengan hot replacement.

Gejala:

- WAR tidak bisa diganti,
- JAR locked,
- undeploy gagal membersihkan work directory,
- temp extraction folder menumpuk,
- redeploy butuh process restart.

Penyebab:

- open stream dari `getResourceAsStream` tidak ditutup,
- custom classloader tidak ditutup,
- library membaca resource dan menyimpan handle,
- scanner menahan file reference.

Rule:

```java
try (InputStream in = servletContext.getResourceAsStream("/WEB-INF/app-config.json")) {
    // read fully
}
```

Jangan:

```java
InputStream in = servletContext.getResourceAsStream("/WEB-INF/app-config.json");
// no close
```

---

## 22. MBean/JMX Leak

Aplikasi web kadang register MBean:

```java
ManagementFactory.getPlatformMBeanServer().registerMBean(...)
```

Jika tidak unregister saat undeploy:

```text
platform MBeanServer -> MBean object -> webapp class -> old classloader
```

Cleanup:

```java
@Override
public void contextDestroyed(ServletContextEvent sce) {
    try {
        MBeanServer server = ManagementFactory.getPlatformMBeanServer();
        ObjectName name = new ObjectName("com.acme:type=AppMetrics,name=Main");
        if (server.isRegistered(name)) {
            server.unregisterMBean(name);
        }
    } catch (Exception e) {
        sce.getServletContext().log("Failed to unregister MBean", e);
    }
}
```

Metric libraries, cache libraries, and connection pools can register MBeans automatically. Know your dependencies.

---

## 23. `ServiceLoader` and Context ClassLoader

Banyak library Java memakai `ServiceLoader`. Ia sering menggunakan thread context classloader.

Examples:

- JDBC driver discovery,
- logging provider discovery,
- JSON provider,
- XML parser provider,
- Jakarta provider discovery,
- SPI extension.

Context classloader matters:

```java
Thread.currentThread().getContextClassLoader()
```

Dalam Servlet request, context classloader biasanya diset ke webapp classloader agar library dapat menemukan provider dalam `WEB-INF/lib`.

Masalah:

- background thread mewarisi context classloader webapp,
- provider singleton dibuat oleh wrong classloader,
- static cache di parent menyimpan provider dari child,
- redeploy leak.

Pattern aman untuk thread yang dibuat container/shared library:

```java
ClassLoader old = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(appClassLoader);
    // invoke app code
} finally {
    Thread.currentThread().setContextClassLoader(old);
}
```

Tetapi aplikasi biasa sebaiknya tidak sembarangan mengubah context classloader kecuali benar-benar memahami boundary.

---

## 24. Embedded Server vs External Container

### 24.1 External container

```text
Tomcat process already running
  -> deploy app.war
  -> app has its own webapp classloader
  -> redeploy possible without restarting JVM
```

Keuntungan:

- bisa host multiple apps,
- operational model lama matang,
- container patching terpisah,
- shared libraries possible,
- WAR standard.

Risiko:

- classloader complexity tinggi,
- shared dependency conflict,
- redeploy leak,
- per-app isolation terbatas dalam satu JVM,
- runtime target harus sinkron dengan build dependency.

### 24.2 Embedded server

```text
java -jar app.jar
  -> app starts embedded Tomcat/Jetty/Undertow
  -> process usually owns one app
```

Keuntungan:

- dependency ownership lebih jelas,
- process isolation lebih baik,
- container lifecycle ikut app lifecycle,
- cocok Docker/Kubernetes,
- tidak perlu hot redeploy di JVM yang sama,
- classloader lebih sederhana.

Risiko:

- app membawa container sendiri,
- patch container perlu rebuild/redeploy app,
- image size bisa lebih besar,
- multiple apps berarti multiple processes,
- startup tuning per app,
- masih ada classloader issues jika framework devtools/hot reload/dynamic plugin dipakai.

### 24.3 Mental model modern

Dalam Kubernetes, biasanya redeploy berarti:

```text
start new pod
wait readiness
route traffic to new pod
drain old pod
kill old process
```

Ini mengurangi hot redeploy classloader leak karena JVM lama mati. Tetapi classloader knowledge tetap penting untuk:

- dependency conflict,
- startup scanning,
- provided vs packaged dependency,
- native/classpath/module-path integration,
- agent/instrumentation,
- plugin system,
- app server legacy,
- memory diagnosis.

---

## 25. WAR, EAR, and Multi-Module Deployment

WAR relatif sederhana:

```text
one web application
one ServletContext
one webapp classloader boundary
```

EAR lebih kompleks:

```text
enterprise-app.ear
  |
  +-- app-a.war
  +-- app-b.war
  +-- service-ejb.jar
  +-- lib/common.jar
```

Visibility rules bergantung pada server dan spec. Secara umum:

- EAR-level lib bisa terlihat oleh modules,
- WAR punya isolated webapp classloader,
- EJB module punya classloading sendiri atau shared dalam app,
- server punya module/classloader hierarchy.

Karena user sudah mempelajari Jakarta enterprise runtime lain, di seri ini cukup ambil prinsip:

> Multi-module deployment memperluas graph classloader. Semakin luas sharing, semakin besar risiko coupling dan conflict.

---

## 26. Java Module System dan Servlet Apps

Java 9 memperkenalkan JPMS/module system. Namun banyak Servlet applications tetap berjalan di classpath, bukan module-path.

Kenapa?

- Servlet containers historis berbasis classpath/webapp classloader.
- Banyak framework memakai reflection/dynamic proxies/annotation scanning.
- Jakarta EE deployment model tidak sama dengan JPMS module graph sederhana.
- Split package dan automatic modules bisa rumit.

Tetapi Java 9+ tetap relevan:

- illegal reflective access menjadi isu,
- strong encapsulation makin terasa di Java 17+,
- library lama bisa gagal pada JDK modern,
- agents/instrumentation perlu `--add-opens`,
- container harus mendukung JDK target.

Untuk Java 8 hingga 25, strategi realistis:

```text
Servlet webapp mostly classpath-based
JDK runtime increasingly module-aware
Container/framework bridges the gap
```

Top-tier engineer tidak memaksakan JPMS ke semua webapp. Ia memahami boundary dan trade-off.

---

## 27. Common Error Types

### 27.1 `ClassNotFoundException`

Makna:

```text
Class dicari secara dynamic, tetapi tidak ditemukan oleh classloader yang digunakan.
```

Contoh:

- reflection `Class.forName`,
- ServiceLoader,
- XML config references,
- annotation scanner,
- JDBC driver discovery.

Diagnosis:

```text
[ ] dependency ada di WEB-INF/lib?
[ ] dependency scope salah jadi provided?
[ ] class pakai javax tapi runtime jakarta?
[ ] class hanya ada di container common lib?
[ ] wrong classloader used by reflection?
```

### 27.2 `NoClassDefFoundError`

Makna:

```text
Class pernah tersedia saat compile/link attempt, tetapi gagal tersedia saat runtime initialization/linking.
```

Atau dependency transitif class tersebut hilang.

Diagnosis:

```text
[ ] class utama ada, dependency transitif hilang?
[ ] version mismatch?
[ ] optional dependency sebenarnya dibutuhkan?
[ ] shading/relocation rusak?
[ ] javax/jakarta mismatch?
```

### 27.3 `NoSuchMethodError`

Makna:

```text
Code dikompilasi melawan versi library yang punya method,
runtime memakai versi library lain yang tidak punya method.
```

Sangat sering akibat dependency conflict.

Diagnosis:

```text
[ ] dependency tree compile vs runtime
[ ] duplicate JAR in WEB-INF/lib and container/lib
[ ] transitive dependency overrides
[ ] old library in application server module
```

### 27.4 `LinkageError`

Makna umum:

```text
Class linking gagal karena binary incompatibility, duplicate definition, loader constraint violation, etc.
```

Ini sering classloader/dependency problem.

### 27.5 `ClassCastException: X cannot be cast to X`

Makna:

```text
Same class name, different classloader.
```

Diagnosis classloader identity.

---

## 28. Dependency Conflict Debugging

Checklist Maven:

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
mvn dependency:tree -Dverbose
```

Checklist Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jackson-databind
./gradlew dependencyInsight --dependency jakarta.servlet-api
```

Checklist WAR:

```bash
jar tf target/my-app.war | sort
jar tf target/my-app.war | grep 'WEB-INF/lib'
jar tf target/my-app.war | grep 'jakarta.servlet'
jar tf target/my-app.war | grep 'javax.servlet'
```

Red flags:

```text
WEB-INF/lib/javax.servlet-api-*.jar
WEB-INF/lib/jakarta.servlet-api-*.jar in external container WAR
both javax.* and jakarta.* framework variants
multiple versions of same library
container API jar packaged inside WAR
old JAXB/JAX-WS libraries on modern JDK without explicit compatibility
```

---

## 29. Classloader Logging and Diagnostics

Sometimes you need to know where a class was loaded from.

Utility:

```java
public final class ClassOrigin {
    public static String originOf(Class<?> type) {
        CodeSource source = type.getProtectionDomain().getCodeSource();
        String location = source == null ? "<unknown>" : String.valueOf(source.getLocation());
        return type.getName()
                + " loaded by " + type.getClassLoader()
                + " from " + location;
    }
}
```

Usage:

```java
log.info(ClassOrigin.originOf(jakarta.servlet.http.HttpServlet.class));
log.info(ClassOrigin.originOf(com.fasterxml.jackson.databind.ObjectMapper.class));
log.info(ClassOrigin.originOf(org.slf4j.LoggerFactory.class));
```

Use carefully:

- good for startup diagnostics,
- avoid logging too much per request,
- do not expose filesystem path to users,
- useful in non-production first.

---

## 30. Metaspace Growth Diagnosis

In Java 8+, class metadata lives in Metaspace.

Symptoms of classloader leak:

```text
Metaspace usage grows after every redeploy
old WebAppClassLoader instances remain in heap dump
number of loaded classes keeps increasing
Full GC does not reclaim old deployment metadata
```

Useful tools:

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
jcmd <pid> VM.native_memory summary
jcmd <pid> Thread.print
jmap -dump:live,format=b,file=heap.hprof <pid>
```

For Java 8, commands vary slightly by update/version.

What to inspect in heap dump:

```text
[ ] instances of WebAppClassLoader old deployments
[ ] GC roots retaining classloader
[ ] live Thread with contextClassLoader old app
[ ] ThreadLocalMap values from old app
[ ] DriverManager registered drivers
[ ] MBeanServer references
[ ] static maps in common libraries
[ ] logging contexts
[ ] executor queues
[ ] Timer threads
```

Root cause analysis pattern:

```text
Find old WebAppClassLoader
  -> find path to GC root
  -> identify owner
  -> map owner to lifecycle cleanup gap
  -> fix cleanup or dependency placement
  -> test repeated redeploy
```

---

## 31. Redeploy Test Strategy

A simple but powerful test:

```text
1. Start container
2. Deploy app v1
3. Hit app with representative traffic
4. Undeploy app
5. Force GC for diagnostic only
6. Deploy app v2
7. Repeat 10-50 times
8. Monitor Metaspace, thread count, classloader count
```

Expected healthy behavior:

```text
Metaspace rises and falls within stable band
thread count returns near baseline
old webapp classloader count returns to zero
no old app threads remain
no old JDBC drivers remain
```

Bad behavior:

```text
Metaspace stair-step increase
thread count increases per redeploy
old classloaders retained
container logs leak warnings
shutdown takes longer over time
```

In Kubernetes/executable JAR world, redeploy usually restarts JVM, but a similar lifecycle test still matters for:

- graceful shutdown,
- resource cleanup,
- testcontainers/integration tests,
- devtools restart,
- plugin architectures,
- long-lived app process.

---

## 32. Classloader Leak Prevention Checklist

At application startup:

```text
[ ] Know whether app is WAR external, WAR app server, or embedded JAR
[ ] Verify Servlet/WebSocket API dependency scope
[ ] Verify no mixed javax/jakarta runtime
[ ] Inspect dependency tree
[ ] Avoid duplicate logging bindings
[ ] Avoid unnecessary scanning-heavy dependencies
[ ] Identify lifecycle owners for pools/clients/schedulers
```

At runtime:

```text
[ ] Do not store request/session objects in static fields
[ ] Do not store app objects in container/shared static registry
[ ] Clean ThreadLocal in finally
[ ] Use bounded executors/queues
[ ] Name application-created threads
[ ] Avoid unmanaged background threads where possible
[ ] Close streams/resources
```

At shutdown:

```text
[ ] Stop schedulers
[ ] Shutdown executors
[ ] Close HTTP clients
[ ] Close DB pools
[ ] Close message consumers
[ ] Deregister JDBC drivers if needed
[ ] Unregister MBeans
[ ] Stop metrics/logging appenders if app-owned
[ ] Clear caches/registries if they cross classloader boundaries
[ ] Ensure no non-daemon app threads remain
```

At diagnostics:

```text
[ ] Check thread dump
[ ] Check classloader stats
[ ] Check Metaspace trend
[ ] Check heap dump GC roots
[ ] Check container leak warnings
[ ] Check duplicate JARs
[ ] Check class origins
```

---

## 33. Production Failure Scenarios

### Scenario A — Redeploy increases memory every time

Likely causes:

- old thread still running,
- ThreadLocal value not removed,
- JDBC driver not deregistered,
- MBean not unregistered,
- logging context not stopped,
- shared static registry holding app object.

First diagnostics:

```text
jcmd <pid> VM.classloader_stats
jcmd <pid> Thread.print
heap dump -> path to GC root from old WebAppClassLoader
```

### Scenario B — Works locally, fails in external Tomcat

Likely causes:

- dependency scope differs,
- local embedded server includes libraries not present in external server,
- WAR packages wrong API,
- Tomcat version does not match Jakarta namespace,
- container has older shared library.

First diagnostics:

```text
inspect WAR
inspect CATALINA_BASE/lib
log class origins
compare dependency tree
```

### Scenario C — `NoSuchMethodError` after deployment

Likely causes:

- runtime library version older than compile-time,
- transitive dependency conflict,
- shared container library shadows app library,
- mixed framework versions.

First diagnostics:

```text
mvn dependency:tree / gradle dependencyInsight
jar tf WAR
class origin logging
container common lib inspection
```

### Scenario D — WebSocket endpoint not detected

Likely causes:

- `javax.websocket` vs `jakarta.websocket` mismatch,
- container does not provide matching WebSocket API/runtime,
- annotation scanning excluded JAR/classes,
- endpoint packaged outside scanned location,
- wrong deployment model.

First diagnostics:

```text
verify imports
verify container version
verify WAR content
verify startup scanning logs
```

### Scenario E — `ClassCastException: User cannot be cast to User`

Likely causes:

- same class loaded by different classloaders,
- shared object crosses webapp boundary,
- static cache in common lib stores app object,
- serialization boundary mismatch.

First diagnostics:

```text
log object classloader
log expected class classloader
find shared registry/cache
```

---

## 34. Design Principles for Top-Tier Engineers

### Principle 1 — Deployment has ownership

Every class, resource, thread, pool, and cache belongs to an owner:

```text
JDK
container
server-wide library
web application
framework
request
session
connection
```

If ownership is unclear, lifecycle bugs follow.

### Principle 2 — Classpath is architecture

Dependency placement is not mechanical.

```text
WEB-INF/lib     app-owned dependency
container/lib   server-owned dependency
provided scope  runtime-owned contract
embedded JAR    app owns runtime
```

### Principle 3 — Redeploy safety requires release symmetry

If startup does:

```text
create / register / start / open / subscribe
```

shutdown must do:

```text
destroy / unregister / stop / close / unsubscribe
```

### Principle 4 — Do not cross classloader boundaries with rich objects

Use stable boundaries:

- primitives,
- strings,
- DTO serialized form,
- HTTP,
- message broker,
- database records,
- well-owned shared API.

Avoid:

- passing webapp objects to container singleton,
- app-to-app direct object sharing,
- global registries storing app-specific instances.

### Principle 5 — Restarting the process hides some leaks, not all design problems

Kubernetes rolling restart can hide hot redeploy leak, but it does not fix:

- dependency conflict,
- startup cost,
- bad shutdown,
- incomplete graceful drain,
- wrong API scope,
- memory bloat during normal runtime.

---

## 35. Small Reference Implementation: Lifecycle-Owned Resources

A simple lifecycle registry can make ownership explicit.

```java
package com.acme.web.lifecycle;

import jakarta.servlet.ServletContext;
import java.util.ArrayList;
import java.util.List;
import java.util.ListIterator;

public final class AppResources implements AutoCloseable {
    private final ServletContext context;
    private final List<AutoCloseable> closeables = new ArrayList<>();

    public AppResources(ServletContext context) {
        this.context = context;
    }

    public <T extends AutoCloseable> T manage(T resource) {
        closeables.add(resource);
        return resource;
    }

    @Override
    public void close() {
        ListIterator<AutoCloseable> it = closeables.listIterator(closeables.size());
        while (it.hasPrevious()) {
            AutoCloseable closeable = it.previous();
            try {
                closeable.close();
            } catch (Exception e) {
                context.log("Failed to close resource: " + closeable, e);
            }
        }
        closeables.clear();
    }
}
```

Listener:

```java
package com.acme.web.lifecycle;

import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@WebListener
public class AppLifecycleListener implements ServletContextListener {
    private AppResources resources;

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        resources = new AppResources(sce.getServletContext());

        ExecutorService executor = Executors.newFixedThreadPool(4, runnable -> {
            Thread thread = new Thread(runnable, "acme-worker");
            thread.setDaemon(false);
            return thread;
        });

        resources.manage(() -> {
            executor.shutdownNow();
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                sce.getServletContext().log("Executor did not terminate cleanly");
            }
        });

        sce.getServletContext().setAttribute(AppResources.class.getName(), resources);
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        try {
            if (resources != null) {
                resources.close();
            }
        } finally {
            sce.getServletContext().removeAttribute(AppResources.class.getName());
        }
    }
}
```

Ini bukan replacement untuk framework lifecycle management, tetapi mental modelnya benar:

```text
resources created at startup are closed at shutdown in reverse order
```

---

## 36. Anti-Pattern Catalog

### Anti-pattern 1 — “Just put it in container lib”

Problem:

```text
Dependency conflict hilang untuk satu app,
tetapi menjadi global risk untuk semua app.
```

Use only when:

- dependency benar-benar server-owned,
- version compatibility dikelola,
- semua app siap memakai versi sama,
- operational process jelas.

### Anti-pattern 2 — “Static cache for convenience”

Problem:

- lifecycle tidak jelas,
- memory tidak terkendali,
- redeploy retention,
- stale configuration,
- classloader leak.

Better:

- app-scoped managed cache,
- lifecycle cleanup,
- bounded size,
- external cache jika perlu shared.

### Anti-pattern 3 — “Raw thread from servlet/listener”

Problem:

- thread survives undeploy,
- no shutdown,
- no observability,
- no backpressure,
- classloader leak.

Better:

- managed executor,
- explicit shutdown,
- named threads,
- bounded queues,
- lifecycle ownership.

### Anti-pattern 4 — “WAR contains every API jar”

Problem:

- Servlet/Jakarta API duplicated,
- runtime API mismatch,
- type incompatibility,
- container behavior undefined/confusing.

Better:

- use `provided` for runtime-provided APIs in external container.

### Anti-pattern 5 — “Ignore container startup logs”

Startup logs often reveal:

- duplicate fragment,
- skipped scanning,
- wrong namespace,
- failed listener,
- leak prevention warning,
- unsupported class version,
- annotation scanning failure.

Top-tier engineer reads startup logs carefully.

---

## 37. Java 8 to Java 25 Considerations

### Java 8

- Metaspace replaces PermGen.
- Many legacy Java EE apps still target `javax.*`.
- Containers like Tomcat 8.5/9 commonly used for `javax.servlet` era.

### Java 11

- Java EE modules removed from JDK become explicit dependencies if needed.
- Legacy JAXB/JAX-WS assumptions can break.
- Long-term server runtime baseline for many systems.

### Java 17

- Strong encapsulation more relevant.
- Jakarta EE 10/Spring Boot 3 era commonly uses Java 17 baseline.
- Reflection-heavy libraries must be modern.

### Java 21

- Virtual threads become final.
- Embedded/modern servlet runtimes may integrate virtual-thread request execution.
- Classloading still mostly classpath-based for webapps.

### Java 25

- Modern LTS-era planning point.
- More libraries/containers expected to align with post-Java-17 assumptions.
- Legacy bytecode/library assumptions become more visible.

Key idea:

> Upgrading Java version is not only bytecode compatibility. It also affects reflective access, removed modules, container support matrix, dependency versions, and instrumentation behavior.

---

## 38. Practical Review Questions

Use these to test whether you really understand this part.

1. Why can two classes with the same fully qualified name be incompatible?
2. Why should `jakarta.servlet-api` usually be `provided` in a WAR deployed to external Tomcat?
3. Why can redeploy leak memory even after all HTTP requests finish?
4. How does a live thread retain an old webapp classloader?
5. Why is `ThreadLocal.remove()` important in servlet filters?
6. What is the difference between putting a JAR in `WEB-INF/lib` and container common lib?
7. Why can `NoSuchMethodError` indicate dependency version conflict?
8. Why is `javax.*` to `jakarta.*` not binary compatible?
9. What should happen in `contextDestroyed` for resources created in `contextInitialized`?
10. How would you diagnose Metaspace growth after repeated redeploy?
11. Why does embedded server reduce some classloader problems but not eliminate dependency problems?
12. What startup log warnings would you care about during deployment?

---

## 39. Summary

Web application classloading is the hidden architecture beneath Servlet deployment.

You should now understand:

- WAR as a deployment boundary.
- `WEB-INF/classes` and `WEB-INF/lib` as webapp classpath.
- Why Servlet/Jakarta APIs are often `provided` in external container deployments.
- How `javax.*` and `jakarta.*` create hard runtime boundaries.
- Why class identity includes classloader.
- How container/common/webapp classloaders interact.
- How annotation scanning and `ServletContainerInitializer` affect startup.
- Why redeploy leaks happen.
- How static fields, threads, ThreadLocals, JDBC drivers, logging, MBeans, and resource handles can retain old classloaders.
- How to diagnose Metaspace growth and old WebAppClassLoader retention.
- Why embedded server changes the operational model but does not remove the need for dependency discipline.

Core mental model:

```text
A Java web application is not only code.
It is code + dependencies + classloader + lifecycle + resource ownership.

A clean deployment loads all of them.
A clean undeployment releases all of them.
```

---

## 40. Referensi

- Jakarta Servlet 6.1 Specification — Web application structure, classloading, lifecycle, deployment semantics.  
  https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1

- Jakarta Servlet 6.1 overview — Servlet API for handling HTTP requests and responses; Servlet 6.1 release for Jakarta EE 11.  
  https://jakarta.ee/specifications/servlet/6.1/

- Apache Tomcat Class Loader HOW-TO — Tomcat classloader hierarchy and webapp isolation.  
  https://tomcat.apache.org/tomcat-10.1-doc/class-loader-howto.html

- Apache Tomcat Servlet API documentation — `ServletContext`, `HttpSession`, and Servlet-related runtime contracts.  
  https://tomcat.apache.org/tomcat-11.0-doc/servletapi/

- Jetty 12 Operations/Programming Documentation — Jetty deployment, modules, server classpath, and webapp runtime model.  
  https://jetty.org/docs/jetty/12.1/

- Payara Enterprise Documentation — Class loader behavior in Jakarta EE application server context.  
  https://docs.payara.fish/enterprise/docs/Technical%20Documentation/Application%20Development/Class%20Loaders.html

- OpenJDK documentation/tools — `jcmd`, classloader stats, native memory tracking, and runtime diagnostics.  
  https://docs.oracle.com/en/java/javase/

---

## 41. Status Seri

Seri belum selesai.

Part yang sudah dibuat:

- Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
- Part 001 — Evolution: Java EE `javax.*` ke Jakarta EE `jakarta.*`
- Part 002 — HTTP Fundamentals for Servlet Engineers
- Part 003 — Servlet Container Architecture
- Part 004 — Servlet Lifecycle Deep Dive
- Part 005 — Request Object Internals: `HttpServletRequest`
- Part 006 — Response Object Internals: `HttpServletResponse`
- Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
- Part 008 — Request Dispatching: Forward, Include, Async, Error
- Part 009 — Filters: Cross-Cutting Boundary Before Frameworks
- Part 010 — Listeners: Observing Web Application Lifecycle
- Part 011 — ServletContext and Application Scope
- Part 012 — Session Management: `HttpSession` Deep Dive
- Part 013 — Cookies, Headers, SameSite, and Browser Boundary
- Part 014 — Async Servlet: Non-Blocking Request Lifecycle
- Part 015 — Servlet Non-Blocking I/O
- Part 016 — Multipart Upload, File Download, and Large Payload Handling
- Part 017 — Error Handling and Failure Semantics in Servlet Apps
- Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads
- Part 019 — Web Application Classloading, Deployment, and Redeployment

Berikutnya:

- Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-servlet-websocket-web-container-runtime-part-018.md">⬅️ Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-servlet-websocket-web-container-runtime-part-020.md">Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments ➡️</a>
</div>
