# learn-java-servlet-websocket-web-container-runtime — Part 010
# Listeners: Observing Web Application Lifecycle

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `010`  
> Topik: Servlet listeners sebagai mekanisme observasi lifecycle web application, request, session, dan attribute changes  
> Target pembaca: engineer Java backend yang ingin memahami web-container runtime sampai level production failure model  
> Rentang platform: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Posisi Part Ini Dalam Seri

Sebelumnya kita sudah membahas:

1. mental model server-side Java web runtime,
2. evolusi `javax.*` ke `jakarta.*`,
3. HTTP fundamentals,
4. servlet container architecture,
5. servlet lifecycle,
6. request object,
7. response object,
8. servlet mapping,
9. request dispatching,
10. filter chain.

Sekarang kita masuk ke **listener**.

Kalau **servlet** adalah component yang menangani request, dan **filter** adalah boundary yang membungkus request/response flow, maka **listener** adalah component yang menerima notifikasi ketika sesuatu terjadi dalam lifecycle web application.

Listener tidak dirancang untuk menjadi controller.  
Listener tidak dirancang untuk menggantikan filter.  
Listener tidak dirancang untuk menjadi tempat business orchestration berat.  
Listener adalah mekanisme observasi dan lifecycle hook.

Mental model singkat:

```text
Servlet container
  |
  |-- creates web application context
  |-- initializes listeners
  |-- initializes filters
  |-- initializes servlets
  |
  |-- receives requests
  |     |-- request lifecycle event
  |     |-- filter chain
  |     |-- servlet/framework
  |     |-- request destroyed event
  |
  |-- creates/invalidates sessions
  |     |-- session lifecycle event
  |
  |-- changes context/request/session attributes
  |     |-- attribute event
  |
  |-- shuts down web application
        |-- context destroyed event
```

Top-tier engineer tidak melihat listener sebagai “fitur minor servlet”. Listener adalah titik penting untuk memahami:

- kapan aplikasi benar-benar hidup,
- kapan resource boleh diinisialisasi,
- kapan resource harus dibersihkan,
- bagaimana request/session lahir dan mati,
- bagaimana attribute berubah,
- bagaimana container memanggil kode aplikasi di luar jalur controller,
- bagaimana memory leak dan shutdown bug terjadi,
- bagaimana observability bisa ditempelkan tanpa mengotori business code.

---

## 1. Apa Itu Servlet Listener?

Dalam Jakarta Servlet, listener adalah class yang mengimplementasikan interface event listener tertentu. Container akan memanggil method listener ketika event tertentu terjadi.

Contoh event:

- web application context mulai,
- web application context berhenti,
- request dibuat,
- request selesai,
- session dibuat,
- session invalidated/expired,
- attribute ditambah,
- attribute diubah,
- attribute dihapus,
- object session akan passivate/activate pada distributed session scenario,
- object bind/unbind ke session.

Secara konseptual:

```text
Event source        Event object                    Listener
------------        ------------                    --------
ServletContext  ->  ServletContextEvent        ->   ServletContextListener
ServletRequest  ->  ServletRequestEvent        ->   ServletRequestListener
HttpSession     ->  HttpSessionEvent           ->   HttpSessionListener
Attribute map   ->  *AttributeEvent            ->   *AttributeListener
Session object  ->  HttpSessionBindingEvent    ->   HttpSessionBindingListener
Session migrate ->  HttpSessionEvent           ->   HttpSessionActivationListener
```

Yang penting: listener dipanggil oleh **container**, bukan oleh application controller secara langsung.

---

## 2. Kenapa Listener Ada?

Listener ada karena web application mempunyai lifecycle yang lebih luas daripada satu request.

Kalau hanya ada servlet/filter, kita hanya mudah bereaksi terhadap request flow. Tetapi aplikasi web juga butuh bereaksi terhadap event seperti:

- aplikasi baru saja dideploy,
- aplikasi akan di-undeploy,
- request baru masuk,
- request sudah selesai,
- session user baru dibuat,
- session user expired,
- attribute session berubah,
- object tertentu masuk/keluar session,
- session dipindah antar node dalam cluster.

Tanpa listener, developer sering melakukan hal buruk seperti:

```java
public class SomeServlet extends HttpServlet {
    private static ExpensiveResource resource = initialize();
}
```

Atau:

```java
public void doGet(HttpServletRequest request, HttpServletResponse response) {
    if (!initialized) {
        initializeGlobalState();
        initialized = true;
    }
}
```

Masalahnya:

- initialization terjadi pada request pertama, bukan saat aplikasi siap,
- request pertama menjadi lambat,
- race condition bisa terjadi,
- failure initialization muncul sebagai request failure,
- cleanup saat undeploy sering tidak dilakukan,
- static state bisa bocor lintas redeploy,
- observability startup/shutdown menjadi buruk.

Listener memberi titik lifecycle yang lebih eksplisit.

---

## 3. Daftar Listener Penting

Servlet listener bisa dikelompokkan menjadi beberapa kategori.

### 3.1 Application Context Lifecycle

```java
jakarta.servlet.ServletContextListener
```

Untuk event:

- web application initialization,
- web application shutdown.

Method utama:

```java
void contextInitialized(ServletContextEvent sce);
void contextDestroyed(ServletContextEvent sce);
```

Ini listener paling umum untuk:

- initialize application-wide resource,
- register global metadata,
- start lightweight background component jika benar-benar perlu,
- shutdown resource,
- close executor,
- close client connection,
- flush metrics,
- cleanup temporary files.

### 3.2 Application Context Attribute Changes

```java
jakarta.servlet.ServletContextAttributeListener
```

Untuk event attribute pada `ServletContext`:

```java
void attributeAdded(ServletContextAttributeEvent event);
void attributeRemoved(ServletContextAttributeEvent event);
void attributeReplaced(ServletContextAttributeEvent event);
```

Digunakan untuk mengamati perubahan application-scope attribute.

### 3.3 Request Lifecycle

```java
jakarta.servlet.ServletRequestListener
```

Untuk event:

- request initialized,
- request destroyed.

Method:

```java
void requestInitialized(ServletRequestEvent sre);
void requestDestroyed(ServletRequestEvent sre);
```

Berguna untuk:

- observability request boundary,
- attach request timing,
- cleanup per-request resource,
- debug request lifecycle.

Namun untuk normal request logging/correlation, filter sering lebih tepat karena filter berada dalam chain dan bisa melihat response status/body lifecycle lebih mudah.

### 3.4 Request Attribute Changes

```java
jakarta.servlet.ServletRequestAttributeListener
```

Untuk event:

```java
void attributeAdded(ServletRequestAttributeEvent srae);
void attributeRemoved(ServletRequestAttributeEvent srae);
void attributeReplaced(ServletRequestAttributeEvent srae);
```

Berguna untuk debugging framework/request attribute, tetapi jarang dipakai dalam business application modern.

### 3.5 HTTP Session Lifecycle

```java
jakarta.servlet.http.HttpSessionListener
```

Untuk event:

```java
void sessionCreated(HttpSessionEvent se);
void sessionDestroyed(HttpSessionEvent se);
```

Berguna untuk:

- session counting,
- login/session lifecycle metrics,
- cleanup session-scoped external resource,
- audit session destruction,
- debugging session expiry.

### 3.6 HTTP Session Attribute Changes

```java
jakarta.servlet.http.HttpSessionAttributeListener
```

Untuk event:

```java
void attributeAdded(HttpSessionBindingEvent event);
void attributeRemoved(HttpSessionBindingEvent event);
void attributeReplaced(HttpSessionBindingEvent event);
```

Berguna untuk mengamati perubahan session attributes.

### 3.7 Object Binding to Session

```java
jakarta.servlet.http.HttpSessionBindingListener
```

Interface ini diimplementasikan oleh object yang ingin diberi tahu saat dirinya di-bind atau unbind dari session.

Method:

```java
void valueBound(HttpSessionBindingEvent event);
void valueUnbound(HttpSessionBindingEvent event);
```

Perbedaannya dengan `HttpSessionAttributeListener`:

```text
HttpSessionAttributeListener:
  listener global yang mengamati semua perubahan attribute session.

HttpSessionBindingListener:
  object attribute itu sendiri yang diberi tahu ketika masuk/keluar session.
```

### 3.8 Session Activation/Passivation

```java
jakarta.servlet.http.HttpSessionActivationListener
```

Dipakai ketika session akan dipindahkan, diserialisasi, dipassivate, atau di-activate lagi dalam container yang mendukung distributed/session persistence behavior.

Method:

```java
void sessionWillPassivate(HttpSessionEvent se);
void sessionDidActivate(HttpSessionEvent se);
```

Ini relevan pada:

- clustered session,
- session persistence ke disk,
- failover,
- passivation untuk memory pressure.

Di banyak modern stateless/backend-token architecture, ini jarang dipakai. Tetapi untuk legacy enterprise web app, ini bisa sangat penting.

---

## 4. `javax.*` vs `jakarta.*`

Untuk Java EE / Jakarta EE 8 dan sebelumnya:

```java
import javax.servlet.ServletContextListener;
import javax.servlet.ServletContextEvent;
import javax.servlet.http.HttpSessionListener;
```

Untuk Jakarta EE 9+:

```java
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.http.HttpSessionListener;
```

Perubahan namespace ini bukan cosmetic.

```text
javax.servlet.*  !=  jakarta.servlet.*
```

Artinya:

- class compiled against `javax.servlet.*` tidak otomatis compatible dengan container Jakarta EE 9+,
- Tomcat 9 memakai Java EE/Jakarta EE 8 style `javax.*`,
- Tomcat 10+ memakai Jakarta style `jakarta.*`,
- Spring Boot 2 masih `javax.*`,
- Spring Boot 3 memakai `jakarta.*`,
- listener class dengan import salah tidak akan dikenali oleh runtime yang berbeda namespace.

Mental model migration:

```text
Source compatibility: perlu ubah import/package
Binary compatibility: tidak compatible langsung
Runtime compatibility: harus match container + dependency + framework
```

---

## 5. Cara Mendaftarkan Listener

Ada tiga cara utama.

### 5.1 Dengan Annotation `@WebListener`

```java
package com.example.web;

import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;

@WebListener
public class ApplicationLifecycleListener implements ServletContextListener {

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        System.out.println("Application started: " + sce.getServletContext().getContextPath());
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        System.out.println("Application stopped: " + sce.getServletContext().getContextPath());
    }
}
```

Kelebihan:

- ringkas,
- cocok untuk aplikasi sederhana,
- tidak perlu `web.xml`.

Kekurangan:

- ordering bisa kurang eksplisit,
- scanning annotation bergantung deployment setup,
- dalam enterprise app besar, konfigurasi tersebar.

### 5.2 Dengan `web.xml`

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee
                             https://jakarta.ee/xml/ns/jakartaee/web-app_6_1.xsd"
         version="6.1">

    <listener>
        <listener-class>com.example.web.ApplicationLifecycleListener</listener-class>
    </listener>

</web-app>
```

Kelebihan:

- ordering lebih eksplisit,
- cocok untuk legacy WAR,
- cocok untuk aplikasi dengan deployment descriptor controlled.

Kekurangan:

- verbose,
- raw string class name,
- refactoring lebih rawan jika tooling tidak menjaga XML.

### 5.3 Programmatic Registration

Di Servlet 3.0+ terdapat mekanisme programmatic registration melalui `ServletContext`.

Contoh konseptual:

```java
public class BootstrapListener implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        sce.getServletContext().addListener(new RequestMetricsListener());
    }
}
```

Namun tidak semua listener bebas ditambahkan kapan saja. Container memiliki aturan kapan registration masih diizinkan. Secara umum, registration dinamis harus dilakukan saat startup/configuration phase, bukan setelah aplikasi sudah melayani request normal.

Prinsipnya:

```text
Register web components during startup.
Do not mutate web application topology during steady-state request processing.
```

---

## 6. Ordering Listener

Ordering listener sering dianggap detail kecil, padahal bisa menjadi sumber bug startup/shutdown.

### 6.1 Context Initialization Order

Untuk listener yang dideklarasikan di deployment descriptor, urutan declaration penting. Secara umum listener dipanggil saat initialization sesuai urutan declaration, dan saat destruction dalam urutan sebaliknya.

Mental model:

```text
Startup:
  Listener A contextInitialized
  Listener B contextInitialized
  Listener C contextInitialized

Shutdown:
  Listener C contextDestroyed
  Listener B contextDestroyed
  Listener A contextDestroyed
```

Ini mirip stack resource:

```text
A creates base resource
B depends on A
C depends on B

Shutdown must close C first, then B, then A
```

Contoh:

```text
Startup order:
  1. ConfigLoaderListener
  2. MetricsRegistryListener
  3. ExternalClientListener

Shutdown order:
  1. ExternalClientListener
  2. MetricsRegistryListener
  3. ConfigLoaderListener
```

Kalau dependency antar listener tidak jelas, lebih baik konsolidasikan startup orchestration ke satu listener kecil yang memanggil bootstrap object dengan urutan eksplisit.

---

## 7. ServletContextListener Deep Dive

`ServletContextListener` adalah listener paling penting.

### 7.1 Kapan Dipanggil?

`contextInitialized` dipanggil ketika web application mulai diinisialisasi.

Secara lifecycle konseptual:

```text
Deploy WAR / start embedded app
  ↓
Create ServletContext
  ↓
Call ServletContextListener.contextInitialized
  ↓
Initialize filters
  ↓
Initialize load-on-startup servlets
  ↓
Application ready to serve requests
```

`contextDestroyed` dipanggil ketika web application akan dihentikan.

```text
Stop/undeploy/redeploy/shutdown
  ↓
Stop accepting new requests for webapp
  ↓
Wait/drain active work depending on container/config
  ↓
Destroy servlets/filters/context resources
  ↓
Call lifecycle cleanup callbacks
  ↓
Release classloader
```

Detail urutan destroy bisa berbeda antar container dan konfigurasi, tetapi prinsipnya: cleanup listener harus aman dipanggil saat sistem sedang shutdown dan sebagian component mungkin sudah tidak bisa dipakai.

### 7.2 Use Case yang Tepat

`ServletContextListener` cocok untuk:

- load immutable application metadata,
- initialize metrics registry,
- initialize external client yang memang application-scoped,
- schedule housekeeping ringan jika container policy mengizinkan,
- warm up cache secara hati-hati,
- validate configuration,
- prepare temporary directory,
- register JVM shutdown-aware resource,
- cleanup resource saat shutdown.

Contoh:

```java
package com.example.web;

import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;

import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@WebListener
public class AppContextListener implements ServletContextListener {

    private ExecutorService executor;

    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();

        String appName = context.getInitParameter("appName");
        if (appName == null || appName.isBlank()) {
            appName = "unknown-app";
        }

        this.executor = Executors.newFixedThreadPool(4, runnable -> {
            Thread thread = new Thread(runnable);
            thread.setName("app-worker-" + thread.threadId()); // Java 19+ threadId(); use getId() on Java 8
            thread.setDaemon(false);
            return thread;
        });

        context.setAttribute("app.startedAt", Instant.now());
        context.setAttribute("app.name", appName);
        context.setAttribute("app.executor", this.executor);

        context.log("Application initialized: " + appName);
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        context.log("Application shutdown started");

        ExecutorService executor = this.executor;
        if (executor != null) {
            executor.shutdown();
            try {
                if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                    executor.shutdownNow();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                executor.shutdownNow();
            }
        }

        context.removeAttribute("app.executor");
        context.log("Application shutdown completed");
    }
}
```

Catatan Java 8:

```java
thread.setName("app-worker-" + thread.getId());
```

`Thread.threadId()` adalah API modern; untuk Java 8 pakai `getId()`.

### 7.3 Use Case yang Salah

Hindari melakukan ini di `contextInitialized`:

- migration database berat,
- long-running data repair,
- blocking remote call tanpa timeout,
- infinite loop worker tanpa shutdown,
- start scheduler tanpa lifecycle management,
- load seluruh data besar ke memory tanpa limit,
- call service internal yang belum siap,
- business workflow mutating production state,
- retry selamanya sampai dependency hidup.

Kenapa?

Karena startup listener berada di critical path readiness aplikasi.

Kalau listener menggantung:

```text
container start
  ↓
contextInitialized blocks forever
  ↓
servlet/filter never fully initialized
  ↓
readiness never true / startup timeout / pod killed
```

Dalam Kubernetes atau managed runtime, ini bisa menciptakan restart loop.

---

## 8. Startup Failure Semantics

Top-tier engineer harus bertanya:

> Kalau listener gagal saat startup, apa efeknya?

Contoh:

```java
@Override
public void contextInitialized(ServletContextEvent event) {
    String required = event.getServletContext().getInitParameter("required.config");
    if (required == null) {
        throw new IllegalStateException("required.config is missing");
    }
}
```

Ini bisa benar kalau config tersebut wajib dan aplikasi tidak boleh melayani request tanpa config.

Tapi ini bisa buruk kalau listener gagal karena optional observability dependency.

Decision model:

| Dependency | Jika gagal | Aksi startup |
|---|---:|---|
| Required database schema compatibility | App tidak aman berjalan | fail fast |
| Required signing key/config | App tidak aman berjalan | fail fast |
| Optional metrics exporter | App masih bisa melayani core traffic | degrade gracefully |
| Optional cache warmup | App bisa lazy load | log + continue |
| External notification client | Tergantung domain | fail fast atau degraded mode |

Prinsip:

```text
Fail fast for correctness and safety.
Degrade gracefully for observability/non-critical optimization.
Never silently ignore critical misconfiguration.
```

---

## 9. Shutdown Semantics

Shutdown listener sering lebih penting daripada startup listener.

Masalah umum:

- executor tidak di-shutdown,
- scheduler masih jalan,
- thread custom masih hidup,
- HTTP client connection pool tidak ditutup,
- JDBC driver leak,
- metrics reporter thread leak,
- file watcher thread leak,
- Redis/RabbitMQ/Kafka client tidak ditutup,
- static cache memegang class dari webapp classloader,
- library global registry tidak dibersihkan.

Akibatnya:

```text
redeploy app
  ↓
old webapp classloader should be GC'ed
  ↓
but old thread/static/global registry still references old classes
  ↓
Metaspace grows
  ↓
old code still runs
  ↓
memory leak / duplicate scheduler / weird behavior
```

Checklist cleanup di `contextDestroyed`:

```text
[ ] stop accepting application-owned background work
[ ] shutdown executor/scheduler
[ ] close HTTP clients
[ ] close message broker clients
[ ] close cache clients if application-owned
[ ] remove context attributes that hold large resources
[ ] flush/close telemetry exporters if needed
[ ] clear static registries owned by app
[ ] interrupt or signal custom threads
[ ] avoid starting new work during shutdown
[ ] preserve interrupted flag when InterruptedException occurs
```

Contoh shutdown helper:

```java
public final class Shutdowns {
    private Shutdowns() {
    }

    public static void shutdownExecutor(ExecutorService executor,
                                        long timeout,
                                        TimeUnit unit) {
        if (executor == null) {
            return;
        }

        executor.shutdown();
        try {
            if (!executor.awaitTermination(timeout, unit)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }
}
```

---

## 10. ServletRequestListener Deep Dive

`ServletRequestListener` menerima event saat request masuk dan selesai.

Contoh:

```java
package com.example.web;

import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletRequestEvent;
import jakarta.servlet.ServletRequestListener;
import jakarta.servlet.annotation.WebListener;

import java.time.Duration;
import java.time.Instant;

@WebListener
public class RequestLifecycleListener implements ServletRequestListener {

    private static final String START_TIME = RequestLifecycleListener.class.getName() + ".startTime";

    @Override
    public void requestInitialized(ServletRequestEvent sre) {
        ServletRequest request = sre.getServletRequest();
        request.setAttribute(START_TIME, Instant.now());
    }

    @Override
    public void requestDestroyed(ServletRequestEvent sre) {
        ServletRequest request = sre.getServletRequest();
        Object started = request.getAttribute(START_TIME);

        if (started instanceof Instant start) {
            long millis = Duration.between(start, Instant.now()).toMillis();
            sre.getServletContext().log("Request completed in " + millis + " ms");
        }
    }
}
```

Untuk Java 8, pattern matching `instanceof` belum ada:

```java
if (started instanceof Instant) {
    Instant start = (Instant) started;
    long millis = Duration.between(start, Instant.now()).toMillis();
}
```

### 10.1 Listener vs Filter untuk Request Timing

Pertanyaan penting:

> Kalau ingin log request duration, pakai listener atau filter?

Biasanya **filter lebih tepat**.

Kenapa?

Filter punya akses lebih natural ke:

- before chain,
- after chain,
- exception around chain,
- response wrapper,
- status code,
- header mutation,
- user/correlation context,
- request path/method HTTP,
- async handling jika dirancang benar.

Listener berguna untuk event lifecycle, tetapi tidak membungkus execution flow seperti filter.

Perbandingan:

| Kebutuhan | Lebih cocok |
|---|---|
| Basic request initialized/destroyed metric | Listener bisa |
| Access log dengan status code | Filter lebih cocok |
| Correlation ID | Filter lebih cocok |
| Per-request cleanup setelah semua dispatch | Bisa listener/filter tergantung desain |
| Debug container request lifecycle | Listener cocok |
| Security check | Filter lebih cocok |
| Modify request/response | Filter |

### 10.2 Request Listener dan Async

Async servlet membuat lifecycle request lebih rumit.

Request bisa:

```text
initial request thread
  ↓
startAsync()
  ↓
original thread returns to container
  ↓
async work continues
  ↓
async dispatch/complete
  ↓
request finally destroyed
```

Jangan berasumsi `requestDestroyed` terjadi langsung setelah servlet method return. Dalam async request, request lifecycle bisa bertahan lebih lama.

Konsekuensi:

- resource per-request jangan ditutup terlalu cepat,
- object yang ditaruh di request attribute bisa hidup lebih lama,
- timeout async harus dipertimbangkan,
- ThreadLocal cleanup tetap lebih aman di filter/async listener karena ThreadLocal terikat thread, bukan request object.

---

## 11. HttpSessionListener Deep Dive

`HttpSessionListener` menerima event saat session dibuat dan dihancurkan.

Contoh session counter:

```java
package com.example.web;

import jakarta.servlet.ServletContext;
import jakarta.servlet.annotation.WebListener;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;

import java.util.concurrent.atomic.AtomicInteger;

@WebListener
public class ActiveSessionCounter implements HttpSessionListener {

    private static final String ACTIVE_SESSIONS = "metrics.activeSessions";

    @Override
    public void sessionCreated(HttpSessionEvent event) {
        ServletContext context = event.getSession().getServletContext();
        AtomicInteger counter = getCounter(context);
        int active = counter.incrementAndGet();
        context.log("Session created. Active sessions = " + active);
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        ServletContext context = event.getSession().getServletContext();
        AtomicInteger counter = getCounter(context);
        int active = counter.decrementAndGet();
        context.log("Session destroyed. Active sessions = " + active);
    }

    private AtomicInteger getCounter(ServletContext context) {
        synchronized (context) {
            AtomicInteger counter = (AtomicInteger) context.getAttribute(ACTIVE_SESSIONS);
            if (counter == null) {
                counter = new AtomicInteger();
                context.setAttribute(ACTIVE_SESSIONS, counter);
            }
            return counter;
        }
    }
}
```

Better design: initialize counter in `ServletContextListener`, then session listener just uses it.

```java
@WebListener
public class MetricsBootstrap implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent sce) {
        sce.getServletContext().setAttribute("metrics.activeSessions", new AtomicInteger());
    }
}
```

### 11.1 Session Created Tidak Sama Dengan Login

Ini jebakan besar.

`sessionCreated` berarti `HttpSession` dibuat, bukan user berhasil login.

Session bisa dibuat karena:

- app memanggil `request.getSession(true)`,
- framework membuat session untuk CSRF token,
- view technology butuh session,
- cart anonymous user,
- login flow belum selesai,
- request ke endpoint tertentu memaksa session.

Jadi jangan pakai `sessionCreated` sebagai bukti login.

Salah:

```java
@Override
public void sessionCreated(HttpSessionEvent se) {
    audit("USER_LOGGED_IN", se.getSession().getId());
}
```

Benar:

```text
Login audit belongs to authentication success event,
not generic session creation event.
```

### 11.2 Session Destroyed Tidak Selalu Logout Explicit

`sessionDestroyed` bisa terjadi karena:

- user logout dan app memanggil `session.invalidate()`,
- session timeout,
- application undeploy,
- container shutdown,
- session persistence/passivation behavior,
- cluster failover cleanup.

Jangan otomatis menyimpulkan:

```text
sessionDestroyed == user clicked logout
```

Lebih benar:

```text
sessionDestroyed == session lifecycle ended from container perspective
```

Jika perlu membedakan logout explicit vs timeout:

- saat logout explicit, tulis marker/audit sebelum invalidate,
- gunakan security framework event,
- gunakan last activity timestamp,
- gunakan application-specific session state.

---

## 12. Attribute Listener Deep Dive

Attribute listener mengamati perubahan map attribute pada context/request/session.

### 12.1 ServletContextAttributeListener

Contoh:

```java
@WebListener
public class ContextAttributeAuditListener implements ServletContextAttributeListener {

    @Override
    public void attributeAdded(ServletContextAttributeEvent event) {
        event.getServletContext().log("Context attribute added: " + event.getName());
    }

    @Override
    public void attributeRemoved(ServletContextAttributeEvent event) {
        event.getServletContext().log("Context attribute removed: " + event.getName());
    }

    @Override
    public void attributeReplaced(ServletContextAttributeEvent event) {
        event.getServletContext().log("Context attribute replaced: " + event.getName());
    }
}
```

Hati-hati: jangan log value sensitif.

Salah:

```java
log("attribute " + event.getName() + " = " + event.getValue());
```

Karena value bisa berisi:

- user profile,
- token,
- credential,
- PII,
- large object,
- framework internal state.

### 12.2 ServletRequestAttributeListener

Berguna untuk debugging request attribute seperti:

- forward attributes,
- error dispatch attributes,
- framework attributes,
- correlation metadata,
- resolved user/principal.

Tetapi dalam production, listener ini bisa noisy karena request attribute sering berubah.

### 12.3 HttpSessionAttributeListener

Berguna untuk:

- session bloat detection,
- audit sensitive session state changes,
- monitor cart/profile/session-scoped object lifecycle,
- detect unexpected large object stored in session.

Contoh guard sederhana:

```java
@WebListener
public class SessionAttributeGuard implements HttpSessionAttributeListener {

    private static final Set<String> SENSITIVE_NAMES = Set.of(
        "password",
        "accessToken",
        "refreshToken",
        "privateKey"
    );

    @Override
    public void attributeAdded(HttpSessionBindingEvent event) {
        warnIfSuspicious(event);
    }

    @Override
    public void attributeReplaced(HttpSessionBindingEvent event) {
        warnIfSuspicious(event);
    }

    private void warnIfSuspicious(HttpSessionBindingEvent event) {
        String name = event.getName();
        for (String sensitive : SENSITIVE_NAMES) {
            if (name.toLowerCase(Locale.ROOT).contains(sensitive.toLowerCase(Locale.ROOT))) {
                event.getSession()
                     .getServletContext()
                     .log("Suspicious session attribute name: " + name);
            }
        }
    }
}
```

Untuk Java 8, `Set.of` belum ada:

```java
private static final Set<String> SENSITIVE_NAMES = Collections.unmodifiableSet(
    new HashSet<>(Arrays.asList("password", "accessToken", "refreshToken", "privateKey"))
);
```

---

## 13. `HttpSessionBindingListener`: Object-Aware Session Binding

`HttpSessionBindingListener` berbeda karena interface ini diimplementasikan oleh object yang disimpan ke session.

Contoh:

```java
public class UserSessionState implements HttpSessionBindingListener, Serializable {

    private final String userId;

    public UserSessionState(String userId) {
        this.userId = userId;
    }

    @Override
    public void valueBound(HttpSessionBindingEvent event) {
        event.getSession().getServletContext().log(
            "UserSessionState bound for userId=" + userId
        );
    }

    @Override
    public void valueUnbound(HttpSessionBindingEvent event) {
        event.getSession().getServletContext().log(
            "UserSessionState unbound for userId=" + userId
        );
    }
}
```

Dipakai ketika object perlu tahu lifecycle-nya sendiri dalam session.

Namun hati-hati:

- jangan lakukan I/O berat di `valueBound/valueUnbound`,
- jangan mengandalkan ini untuk critical business transaction,
- jangan simpan object non-serializable jika app menggunakan distributed session,
- jangan menyimpan reference ke request/response/container object.

---

## 14. `HttpSessionActivationListener`: Distributed Session Awareness

Dalam cluster/session persistence, session bisa dipassivate dan diactivate.

Mental model:

```text
Session active in memory
  ↓
Container wants to move/store session
  ↓
sessionWillPassivate
  ↓
serialize session
  ↓
store/send session elsewhere
  ↓
deserialize session
  ↓
sessionDidActivate
  ↓
Session active again
```

Contoh:

```java
public class CartState implements HttpSessionActivationListener, Serializable {

    private transient BigDecimal cachedTotal;
    private List<CartItem> items;

    @Override
    public void sessionWillPassivate(HttpSessionEvent se) {
        // Release transient runtime-only state if needed.
        cachedTotal = null;
    }

    @Override
    public void sessionDidActivate(HttpSessionEvent se) {
        // Rebuild transient state after activation.
        cachedTotal = calculateTotal(items);
    }

    private BigDecimal calculateTotal(List<CartItem> items) {
        return items.stream()
                    .map(CartItem::subtotal)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

Modern architecture sering menghindari heavy distributed session dengan:

- stateless token,
- server-side session store external,
- sticky session,
- explicit application state in database/cache,
- frontend local state for non-sensitive transient data.

Tetapi ketika mempertahankan legacy enterprise app, activation listener tetap penting untuk memahami session failover.

---

## 15. Listener dan Thread-Safety

Listener object juga container-managed. Jangan asumsikan method listener hanya dipanggil single-threaded.

Beberapa event bisa terjadi concurrent:

- banyak request initialized/destroyed bersamaan,
- banyak session created/destroyed bersamaan,
- session attribute changed dari parallel requests,
- request attribute changes dari framework internals.

Contoh salah:

```java
@WebListener
public class UnsafeSessionCounter implements HttpSessionListener {
    private int activeSessions;

    @Override
    public void sessionCreated(HttpSessionEvent se) {
        activeSessions++; // race condition
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        activeSessions--; // race condition
    }
}
```

Benar:

```java
@WebListener
public class SafeSessionCounter implements HttpSessionListener {
    private final AtomicInteger activeSessions = new AtomicInteger();

    @Override
    public void sessionCreated(HttpSessionEvent se) {
        activeSessions.incrementAndGet();
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        activeSessions.decrementAndGet();
    }
}
```

Namun dalam cluster, counter lokal hanya menghitung session di node tersebut, bukan seluruh cluster.

```text
AtomicInteger in listener = per JVM/node metric
Distributed active session count = needs external aggregation
```

---

## 16. Listener dan Dependency Injection

Dalam Jakarta EE full/web profile environment, listener dapat berinteraksi dengan injection mechanism tergantung container/spec support. Dalam Spring Boot embedded servlet world, listener bisa didaftarkan sebagai bean atau registration bean.

Namun secara mental model, listener adalah **container-managed web component**. Jangan asal membuat sendiri instance listener yang membutuhkan dependency injection jika container tidak mengelolanya.

### 16.1 Plain Servlet Container

Di plain Tomcat tanpa CDI/Spring:

```java
@WebListener
public class MyListener implements ServletContextListener {
    private final SomeService service = new SomeService();
}
```

Ini manual. Tidak ada injection otomatis dari Spring/CDI kecuali integrasi dipasang.

### 16.2 Spring Boot

Dalam Spring Boot, pola umum:

```java
@Configuration
public class WebListenerConfig {

    @Bean
    public ServletListenerRegistrationBean<AppListener> appListener(SomeService service) {
        return new ServletListenerRegistrationBean<>(new AppListener(service));
    }
}
```

```java
public class AppListener implements ServletContextListener {

    private final SomeService service;

    public AppListener(SomeService service) {
        this.service = service;
    }

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        service.onWebAppStarted();
    }
}
```

Ini lebih jelas daripada berharap `@WebListener` otomatis mendapat dependency Spring.

Catatan: detail Spring bukan fokus seri ini, tetapi penting untuk menghindari salah mental model.

---

## 17. Listener vs Filter vs Servlet vs Framework Events

Banyak bug desain terjadi karena salah memilih extension point.

| Kebutuhan | Pilihan terbaik | Alasan |
|---|---|---|
| Intercept setiap request sebelum controller | Filter | Ada chain dan response handling |
| Logging request dengan status response | Filter | Bisa wrap response |
| Initialize app resource saat startup | ServletContextListener | Lifecycle app-level |
| Cleanup app resource saat shutdown | ServletContextListener | Lifecycle app-level |
| Hitung session created/destroyed | HttpSessionListener | Session lifecycle |
| Audit login success | Security framework event | Login bukan session create |
| Modify request body | Filter/wrapper | Listener tidak membungkus stream flow |
| Observe request attribute debug | ServletRequestAttributeListener | Attribute event |
| Start business process scheduled | Scheduler framework/container managed executor | Listener hanya bootstrap jika perlu |
| Publish domain event | Domain service/framework event | Listener servlet terlalu infrastructural |
| Handle application readiness | Framework/application lifecycle + health check | Listener hanya salah satu titik startup |

Rule of thumb:

```text
Use listener for lifecycle observation.
Use filter for request/response flow control.
Use servlet/framework controller for business request handling.
Use domain/framework event for business events.
```

---

## 18. Listener Sebagai State Machine

Aplikasi web bisa dimodelkan sebagai state machine.

```text
UNDEPLOYED
  ↓ deploy
CONTEXT_CREATING
  ↓ contextInitialized success
CONTEXT_INITIALIZED
  ↓ filters/servlets init success
READY
  ↓ stop/redeploy
STOPPING
  ↓ contextDestroyed complete
DESTROYED
```

Listener berada di transition:

```text
CONTEXT_CREATING -> CONTEXT_INITIALIZED
STOPPING -> DESTROYED
```

Request lifecycle:

```text
REQUEST_ALLOCATED
  ↓ requestInitialized
REQUEST_IN_CHAIN
  ↓ dispatch/filter/servlet/framework
REQUEST_ASYNC_WAIT?        (optional)
  ↓ complete/error/timeout
REQUEST_DESTROYING
  ↓ requestDestroyed
REQUEST_RELEASED
```

Session lifecycle:

```text
NO_SESSION
  ↓ getSession(true)
SESSION_CREATED
  ↓ request(s)
SESSION_ACTIVE
  ↓ timeout/logout/invalidate/shutdown
SESSION_DESTROYED
```

Attribute lifecycle:

```text
ABSENT
  ↓ setAttribute(name, value)
PRESENT
  ↓ setAttribute(name, newValue)
REPLACED
  ↓ removeAttribute(name)
ABSENT
```

Dengan state machine ini, kita bisa bertanya:

- event mana yang guaranteed?
- event mana yang optional tergantung container/session config?
- apa yang terjadi jika exception dilempar di event?
- apakah event bisa terjadi concurrent?
- apakah event terjadi saat shutdown tidak normal?
- apakah listener dipanggil lagi saat async dispatch?
- apakah listener dipanggil untuk internal forward/error dispatch?

---

## 19. Production Failure Model

### 19.1 Startup Listener Menggantung

Gejala:

- deployment stuck,
- Kubernetes pod tidak ready,
- startup probe gagal,
- Tomcat start lama,
- no request served,
- thread dump menunjukkan startup thread blocked.

Penyebab:

- remote call tanpa timeout,
- database migration berat,
- DNS lookup hanging,
- infinite retry,
- deadlock initialization,
- waiting on executor yang belum started.

Mitigasi:

```text
[ ] semua I/O startup punya timeout
[ ] startup retry dibatasi
[ ] optional dependency degrade gracefully
[ ] critical dependency fail fast
[ ] startup logs jelas
[ ] health/readiness terpisah dari sekadar process alive
```

### 19.2 Shutdown Listener Menggantung

Gejala:

- redeploy lama,
- container shutdown timeout,
- pod termination melewati grace period,
- old process killed paksa,
- request kehilangan graceful drain.

Penyebab:

- executor await tanpa timeout,
- close client blocking,
- background job tidak bisa diinterrupt,
- synchronized deadlock,
- listener menunggu resource yang sudah dihentikan.

Mitigasi:

```text
[ ] shutdown punya deadline
[ ] executor shutdownNow fallback
[ ] preserve interrupted flag
[ ] background worker check cancellation
[ ] no new work during shutdown
[ ] close order sesuai dependency
```

### 19.3 Duplicate Listener Registration

Gejala:

- log startup dobel,
- metrics dobel,
- scheduler jalan dua kali,
- event processed dua kali,
- session counter aneh.

Penyebab:

- listener didaftarkan di `web.xml` dan `@WebListener`,
- Spring registration bean plus annotation scanning,
- library web-fragment auto-register,
- redeploy leak membuat old listener masih aktif.

Mitigasi:

```text
[ ] satu sumber registration
[ ] audit startup logs
[ ] hindari mixed annotation + XML tanpa alasan
[ ] gunakan idempotent initialization guard bila perlu
[ ] pahami web fragments dari dependency
```

### 19.4 Session Counter Salah di Cluster

Gejala:

- active session count beda antar node,
- dashboard menunjukkan angka rendah/tinggi,
- user dianggap masih online setelah pindah node,
- sessionDestroyed tidak terjadi sesuai ekspektasi.

Penyebab:

- listener menghitung per JVM,
- sticky session/failover,
- session timeout event delay,
- app shutdown destroys many sessions,
- distributed session replication semantics berbeda.

Mitigasi:

```text
[ ] label metric per node
[ ] aggregate via metrics backend
[ ] jangan jadikan listener lokal sebagai source of truth global
[ ] untuk presence gunakan heartbeat/last-seen external store
```

### 19.5 Attribute Listener Membocorkan Data Sensitif

Gejala:

- token/password/PII muncul di log,
- log volume membesar,
- compliance issue,
- sensitive object serialized by logger.

Penyebab:

- logging `event.getValue()` sembarangan,
- toString object mengandung data rahasia,
- debug listener lupa dimatikan.

Mitigasi:

```text
[ ] log name/type, bukan value
[ ] mask sensitive attribute name
[ ] disable verbose listener di production
[ ] review logs as data exposure surface
```

### 19.6 Listener Membuat Classloader Leak

Gejala:

- Metaspace naik setiap redeploy,
- old class version masih terlihat di thread dump,
- duplicate background job,
- memory leak warning dari container,
- `WebappClassLoaderBase` cannot be garbage collected.

Penyebab:

- listener membuat thread dan tidak menutupnya,
- static registry global memegang object app,
- JDBC driver tidak deregister,
- logging/metrics library global memegang classloader,
- Timer non-daemon tidak cancel.

Mitigasi:

```text
[ ] close semua app-owned threads
[ ] deregister global callbacks
[ ] cancel timers
[ ] clear static holders
[ ] avoid storing webapp class in container-global singleton
[ ] test repeated redeploy in non-prod
```

---

## 20. Listener dan Observability

Listener bisa mendukung observability, tapi harus dipakai hati-hati.

### 20.1 Startup/Shutdown Logs

Minimal startup log:

```text
app_name
version/build
context_path
profile/environment
java_version
container_info
startup_started_at
startup_completed_at
duration_ms
critical config status without secret value
```

Minimal shutdown log:

```text
shutdown_started_at
active_requests if available
active_sessions if available
active_websocket_connections if available
background_workers_stopped
resource_close_result
shutdown_duration_ms
```

### 20.2 Metrics Dari Listener

Candidate metrics:

```text
webapp_start_total
webapp_shutdown_total
webapp_start_duration_seconds
webapp_start_failure_total
servlet_request_initialized_total
servlet_request_destroyed_total
http_session_created_total
http_session_destroyed_total
http_session_active_current
servlet_context_attribute_change_total
http_session_attribute_change_total
```

Tetapi jangan membuat high-cardinality metric seperti:

```text
session_attribute_change_total{sessionId="..."}
request_attribute_change_total{uri="/user/123456"}
```

High-cardinality metrics bisa membunuh observability backend.

### 20.3 Listener Untuk Request ID?

Bisa, tetapi filter lebih cocok.

Listener tidak bisa mengontrol response dengan nyaman. Untuk correlation ID yang perlu masuk response header:

```text
Use Filter.
```

Listener bisa membantu cleanup jika ada request attribute tertentu, tetapi ThreadLocal cleanup tetap harus hati-hati karena request listener event tidak selalu terjadi pada thread yang sama dengan semua async work.

---

## 21. Listener Dalam Embedded Server / Spring Boot / Framework Modern

Dalam aplikasi modern, banyak developer tidak pernah menulis `web.xml`. Tetapi listener tetap ada.

### 21.1 Embedded Servlet Container

Spring Boot dengan embedded Tomcat/Jetty/Undertow tetap memakai Servlet API. Listener bisa didaftarkan secara programmatic.

Contoh Spring Boot style:

```java
@Bean
ServletListenerRegistrationBean<HttpSessionListener> sessionListener() {
    return new ServletListenerRegistrationBean<>(new ActiveSessionCounter());
}
```

Tetapi jangan lupa bahwa Spring sendiri juga punya lifecycle event:

- `ApplicationStartingEvent`,
- `ApplicationReadyEvent`,
- `ContextClosedEvent`,
- `SmartLifecycle`,
- `DisposableBean`,
- `@PreDestroy`.

Jadi pilih lifecycle hook yang benar.

Perbedaan mental model:

```text
ServletContextListener:
  web application / servlet context lifecycle

Spring ApplicationEvent:
  Spring application context lifecycle

Kubernetes readiness/liveness:
  runtime orchestration lifecycle
```

Ketiganya tidak selalu sama persis.

### 21.2 WAR di External Container

Untuk WAR di external container:

- listener lifecycle mengikuti webapp deploy/undeploy,
- container bisa menjalankan banyak webapp dalam satu JVM,
- classloader isolation penting,
- static/global state lebih berbahaya,
- redeploy leak lebih sering terlihat.

### 21.3 Executable JAR

Untuk executable JAR:

- satu aplikasi biasanya satu JVM,
- redeploy biasanya process restart, bukan hot redeploy,
- classloader leak saat redeploy lebih jarang terlihat,
- tetapi shutdown graceful tetap penting.

---

## 22. Anti-Patterns

### 22.1 Listener Sebagai God Bootstrapper

Salah:

```java
public void contextInitialized(ServletContextEvent event) {
    migrateDatabase();
    callExternalSystemA();
    callExternalSystemB();
    loadMillionRowsIntoMemory();
    startScheduler();
    startMessageConsumer();
    preGenerateReports();
    warmUpEveryCache();
}
```

Masalah:

- startup lambat,
- sulit debug,
- no clear dependency graph,
- failure policy campur,
- shutdown sulit,
- testing sulit,
- readiness ambigu.

Lebih baik:

```text
ServletContextListener
  ↓
Small bootstrap orchestrator
  ↓
Explicit startup tasks with timeout, dependency, criticality, and cleanup handle
```

### 22.2 Listener Menelan Exception

Salah:

```java
try {
    loadCriticalConfig();
} catch (Exception e) {
    log.warn("failed", e);
}
```

Kalau config critical, aplikasi harus fail fast.

Benar:

```java
try {
    loadCriticalConfig();
} catch (Exception e) {
    throw new IllegalStateException("Cannot start without critical config", e);
}
```

### 22.3 Listener Membuat Thread Tanpa Lifecycle

Salah:

```java
new Thread(() -> {
    while (true) {
        doWork();
    }
}).start();
```

Benar:

```text
Use managed executor if available.
If you create executor manually, store it and shut it down in contextDestroyed.
Loop must support cancellation/interruption.
```

### 22.4 Listener Mengakses Request/Session Dari Static Holder

Salah:

```java
public static HttpSession currentSession;
```

Masalah:

- thread unsafe,
- memory leak,
- wrong user/session,
- security risk.

### 22.5 Listener Untuk Business Domain Event

Salah:

```text
sessionDestroyed -> cancel unpaid order
```

Kenapa berbahaya?

Session timeout bukan reliable business scheduler. User bisa pakai device lain, session bisa hilang saat redeploy, timeout bisa delayed, sessionDestroyed bisa tidak mewakili domain intent.

Business process harus punya state machine sendiri, bukan menumpang session lifecycle.

---

## 23. Design Pattern: Lifecycle Resource Registry

Untuk aplikasi yang punya beberapa resource application-scoped, listener bisa menggunakan registry kecil.

```java
public interface LifecycleResource {
    void start() throws Exception;
    void stop() throws Exception;
}
```

```java
public final class LifecycleRegistry {

    private final List<LifecycleResource> started = new ArrayList<>();

    public void start(LifecycleResource resource) throws Exception {
        resource.start();
        started.add(resource);
    }

    public void stopAll(ServletContext context) {
        ListIterator<LifecycleResource> iterator = started.listIterator(started.size());
        while (iterator.hasPrevious()) {
            LifecycleResource resource = iterator.previous();
            try {
                resource.stop();
            } catch (Exception e) {
                context.log("Failed to stop resource: " + resource.getClass().getName(), e);
            }
        }
        started.clear();
    }
}
```

```java
@WebListener
public class ApplicationBootstrapListener implements ServletContextListener {

    private LifecycleRegistry registry;

    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        LifecycleRegistry registry = new LifecycleRegistry();

        try {
            registry.start(new MetricsResource());
            registry.start(new ExternalClientResource());
            registry.start(new HousekeepingResource());
            this.registry = registry;
        } catch (Exception e) {
            registry.stopAll(context);
            throw new IllegalStateException("Application bootstrap failed", e);
        }
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        LifecycleRegistry registry = this.registry;
        if (registry != null) {
            registry.stopAll(event.getServletContext());
        }
    }
}
```

Keuntungan:

- startup order eksplisit,
- shutdown reverse order,
- partial startup failure bisa cleanup,
- resource lifecycle terlihat,
- tidak menaruh semua logic di listener.

---

## 24. Design Pattern: Request Lifecycle Probe

Untuk debugging environment tertentu, request listener bisa dipakai sebagai probe.

```java
@WebListener
public class RequestProbeListener implements ServletRequestListener {

    private static final String REQUEST_ID = RequestProbeListener.class.getName() + ".requestId";

    @Override
    public void requestInitialized(ServletRequestEvent sre) {
        String id = UUID.randomUUID().toString();
        sre.getServletRequest().setAttribute(REQUEST_ID, id);
        sre.getServletContext().log("requestInitialized id=" + id);
    }

    @Override
    public void requestDestroyed(ServletRequestEvent sre) {
        Object id = sre.getServletRequest().getAttribute(REQUEST_ID);
        sre.getServletContext().log("requestDestroyed id=" + id);
    }
}
```

Ini membantu menjawab:

- apakah request benar-benar mencapai webapp?
- apakah async request destroy terlambat?
- apakah error dispatch tetap dalam request yang sama?
- apakah filter tidak dipanggil karena mapping salah?

Untuk production access logging, tetap gunakan filter/access log container.

---

## 25. Design Pattern: Session Lifecycle Metrics

Session listener bisa memberi metric per node.

```java
@WebListener
public class SessionMetricsListener implements HttpSessionListener {

    private final AtomicInteger active = new AtomicInteger();

    @Override
    public void sessionCreated(HttpSessionEvent se) {
        active.incrementAndGet();
        publishGauge(se);
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        active.updateAndGet(value -> Math.max(0, value - 1));
        publishGauge(se);
    }

    private void publishGauge(HttpSessionEvent event) {
        event.getSession().getServletContext().setAttribute("metrics.activeSessions", active.get());
    }
}
```

Catatan:

- `Math.max(0, value - 1)` defensive agar counter tidak negatif jika event sequence aneh saat shutdown/redeploy.
- Jangan anggap angka ini global cluster.
- Untuk real metrics, publish ke Micrometer/Prometheus/dropwizard/etc sesuai stack.

---

## 26. Listener dan Security/Compliance

Listener sering menyentuh data sensitif secara tidak sengaja.

Risk surface:

- session attributes berisi principal/user profile,
- request attributes berisi auth result,
- context attributes berisi config,
- listener logs saat startup bisa membocorkan secrets,
- `toString()` object bisa membuka data,
- session event bisa dipakai untuk tracking user tanpa policy jelas.

Guideline:

```text
[ ] log key/status, bukan secret value
[ ] mask token/session id jika harus muncul
[ ] jangan log full cookie/header dari listener
[ ] jangan audit login berdasarkan sessionCreated
[ ] jangan simpan PII di ServletContext
[ ] session listener metrics harus avoid user identifier label
[ ] attribute listener production harus minimal/no value logging
```

Contoh masking session id:

```java
public static String maskSessionId(String sessionId) {
    if (sessionId == null || sessionId.length() <= 8) {
        return "***";
    }
    return sessionId.substring(0, 4) + "..." + sessionId.substring(sessionId.length() - 4);
}
```

---

## 27. Listener dan Performance

Listener dipanggil pada lifecycle path. Jangan menaruh operasi lambat sembarangan.

### 27.1 Request Listener Cost

Jika `ServletRequestListener` melakukan pekerjaan 1 ms per request, pada 1000 RPS:

```text
1 ms/request * 1000 request/second = 1000 ms CPU-wall equivalent per second
```

Artinya satu core-equivalent bisa habis hanya untuk listener overhead, tergantung workload.

Jangan lakukan:

- synchronous remote call per request,
- heavy JSON serialization,
- stack trace generation,
- excessive logging,
- expensive reflection,
- lock global panjang.

### 27.2 Session Attribute Listener Cost

Session attribute listener bisa dipanggil berkali-kali dalam satu request.

Misal framework menaruh banyak attribute:

```text
attributeAdded x 20 per request
```

Kalau setiap event log sync ke disk, performance bisa turun drastis.

### 27.3 Context Listener Startup Cost

Startup time penting untuk:

- autoscaling,
- rolling deployment,
- recovery after crash,
- Kubernetes readiness,
- blue/green deploy,
- CI smoke test.

Prinsip:

```text
Make startup deterministic.
Make critical validation explicit.
Make optional warmup bounded.
```

---

## 28. Listener dan Testing

Walaupun seri testing sudah terpisah, untuk listener ada pola khusus.

### 28.1 Unit Test Logic, Bukan Container

Jangan masukkan banyak logic langsung di listener. Extract ke service.

```java
public class AppBootstrapper {
    public void start(ServletContext context) {
        // testable logic
    }

    public void stop(ServletContext context) {
        // testable logic
    }
}
```

Listener hanya adapter:

```java
@WebListener
public class BootstrapListener implements ServletContextListener {

    private final AppBootstrapper bootstrapper = new AppBootstrapper();

    @Override
    public void contextInitialized(ServletContextEvent sce) {
        bootstrapper.start(sce.getServletContext());
    }

    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        bootstrapper.stop(sce.getServletContext());
    }
}
```

### 28.2 Integration Test Dengan Embedded Container

Untuk memastikan listener benar-benar terdaftar:

- deploy WAR ke embedded/container test,
- assert context attribute exists,
- assert startup log/metric,
- send request,
- invalidate session,
- stop container,
- assert cleanup called.

### 28.3 Redeploy Test

Untuk app external container legacy, test repeated redeploy:

```text
for i in 1..N:
  deploy app
  hit endpoint
  undeploy app
  capture thread count / metaspace / warnings
```

Tujuan:

- detect classloader leak,
- detect duplicate scheduler,
- detect thread leak,
- detect non-closed clients.

---

## 29. Java 8 sampai Java 25: Relevansi Untuk Listener

Listener API sendiri tidak berubah drastis karena ini kontrak Servlet. Tetapi Java runtime berubah banyak.

### 29.1 Java 8 Baseline

Java 8 umum untuk legacy Java EE app:

- anonymous classes/lambda available,
- `CompletableFuture` ada,
- no virtual threads,
- no `var`, no records, no pattern matching,
- thread management manual harus ekstra hati-hati.

### 29.2 Java 11/17

Banyak enterprise app pindah ke Java 11/17:

- stronger module/classpath awareness,
- modern TLS/cert behavior,
- better GC options,
- container awareness improved,
- common baseline untuk Jakarta EE 10/Spring Boot 3 era adalah Java 17.

### 29.3 Java 21+

Java 21 membawa virtual threads sebagai final feature.

Listener implication:

- Jangan membuat virtual thread scheduler sembarangan di listener tanpa shutdown.
- Virtual thread tetap perlu lifecycle ownership.
- Virtual thread tidak menghilangkan kebutuhan timeout/cancellation.
- ThreadLocal/MDC behavior tetap harus dipahami.

Contoh:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

Tetap harus:

```java
executor.close(); // AutoCloseable in modern Java ExecutorService semantics
```

Untuk compatibility Java 8, jangan gunakan API ini.

### 29.4 Java 25 Context

Pada Java 25, platform modern makin mendorong structured concurrency/scoped context style. Tetapi Servlet API tetap berbasis container callback. Jika memakai fitur modern, pastikan:

- runtime container support jelas,
- deployment baseline sesuai,
- cancellation/shutdown terintegrasi,
- tidak mencampur ThreadLocal lama dengan model concurrency baru tanpa desain.

Rule:

```text
Modern Java features help implementation quality,
but do not change Servlet listener lifecycle contract.
```

---

## 30. Practical Checklist: Kapan Membuat Listener?

Sebelum membuat listener, jawab pertanyaan ini:

```text
1. Event lifecycle apa yang ingin saya observasi?
2. Apakah ini benar-benar lifecycle concern, bukan request-flow concern?
3. Apakah filter lebih cocok?
4. Apakah framework lifecycle event lebih cocok?
5. Apakah business domain event lebih cocok?
6. Apakah logic listener deterministic dan bounded?
7. Apakah semua I/O punya timeout?
8. Apakah failure policy jelas: fail fast atau degrade?
9. Apakah cleanup tersedia dan reverse-order?
10. Apakah thread-safe?
11. Apakah aman untuk redeploy?
12. Apakah aman dalam cluster?
13. Apakah log tidak membocorkan secret/PII?
14. Apakah metrics tidak high-cardinality?
15. Apakah listener tidak terdaftar dobel?
```

Kalau banyak jawaban tidak jelas, jangan langsung implement listener. Desain lifecycle ownership dulu.

---

## 31. Debugging Checklist

### 31.1 Listener Tidak Dipanggil

Periksa:

```text
[ ] package import benar: javax vs jakarta
[ ] container version sesuai
[ ] @WebListener scanning aktif
[ ] web.xml benar
[ ] listener class ada di WEB-INF/classes atau WEB-INF/lib
[ ] dependency scope Servlet API tidak bentrok
[ ] app benar-benar deployed
[ ] logs startup container
[ ] annotation scanning disabled?
[ ] web-fragment absolute-ordering mempengaruhi discovery?
```

### 31.2 Listener Dipanggil Dua Kali

Periksa:

```text
[ ] @WebListener + web.xml duplicate
[ ] programmatic registration duplicate
[ ] Spring registration bean + annotation duplicate
[ ] dependency web-fragment duplicate
[ ] old app instance belum mati setelah redeploy
```

### 31.3 Shutdown Tidak Bersih

Periksa:

```text
[ ] custom executor shutdown?
[ ] scheduler shutdown?
[ ] Timer cancel?
[ ] message broker consumer close?
[ ] HTTP client close?
[ ] file watcher close?
[ ] ThreadLocal/global registry clear?
[ ] non-daemon threads still running?
[ ] thread dump after undeploy?
```

### 31.4 Session Event Tidak Sesuai Ekspektasi

Periksa:

```text
[ ] session benar-benar dibuat?
[ ] request.getSession(false) atau true?
[ ] session timeout berapa?
[ ] invalidate dipanggil?
[ ] sticky session?
[ ] distributed session replication?
[ ] container shutdown destroys session?
[ ] user login disamakan dengan session create?
```

---

## 32. Mini Capstone: Production-Grade Listener Set

Bayangkan aplikasi web regulatory case management berjalan di servlet container. Kita ingin:

- log startup/shutdown,
- validate required config,
- expose active session count,
- detect suspicious session attributes,
- avoid classloader leak.

Desain:

```text
ServletContextListener
  - validate config
  - initialize metrics holders
  - initialize resource registry
  - shutdown registry

HttpSessionListener
  - increment/decrement node-local active session count
  - no login audit

HttpSessionAttributeListener
  - detect suspicious attribute names/types
  - no value logging
  - low overhead

Filter
  - correlation ID
  - request logging
  - response status
  - MDC cleanup
```

Ini lebih sehat daripada menaruh semuanya di satu listener.

### 32.1 Combined Example

```java
@WebListener
public class WebAppLifecycleListener implements ServletContextListener {

    public static final String ACTIVE_SESSIONS = "metrics.activeSessions";

    private ExecutorService executor;

    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();

        String appName = context.getInitParameter("appName");
        if (appName == null || appName.isBlank()) {
            throw new IllegalStateException("Missing required context-param: appName");
        }

        context.setAttribute(ACTIVE_SESSIONS, new AtomicInteger());

        executor = Executors.newFixedThreadPool(2);
        context.setAttribute("app.executor", executor);

        context.log("Started appName=" + appName + ", contextPath=" + context.getContextPath());
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        ServletContext context = event.getServletContext();

        ExecutorService executor = this.executor;
        if (executor != null) {
            executor.shutdown();
            try {
                if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                    executor.shutdownNow();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                executor.shutdownNow();
            }
        }

        context.removeAttribute("app.executor");
        context.removeAttribute(ACTIVE_SESSIONS);
        context.log("Stopped contextPath=" + context.getContextPath());
    }
}
```

```java
@WebListener
public class NodeLocalSessionListener implements HttpSessionListener {

    @Override
    public void sessionCreated(HttpSessionEvent event) {
        counter(event).incrementAndGet();
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent event) {
        counter(event).updateAndGet(value -> Math.max(0, value - 1));
    }

    private AtomicInteger counter(HttpSessionEvent event) {
        ServletContext context = event.getSession().getServletContext();
        Object value = context.getAttribute(WebAppLifecycleListener.ACTIVE_SESSIONS);
        if (!(value instanceof AtomicInteger)) {
            throw new IllegalStateException("Active session counter not initialized");
        }
        return (AtomicInteger) value;
    }
}
```

```java
@WebListener
public class SafeSessionAttributeListener implements HttpSessionAttributeListener {

    @Override
    public void attributeAdded(HttpSessionBindingEvent event) {
        inspect(event);
    }

    @Override
    public void attributeReplaced(HttpSessionBindingEvent event) {
        inspect(event);
    }

    private void inspect(HttpSessionBindingEvent event) {
        String name = event.getName();
        if (name == null) {
            return;
        }

        String normalized = name.toLowerCase(Locale.ROOT);
        if (normalized.contains("password") ||
            normalized.contains("token") ||
            normalized.contains("secret") ||
            normalized.contains("privatekey")) {

            event.getSession().getServletContext().log(
                "Potentially sensitive session attribute name detected: " + name
            );
        }
    }
}
```

Perhatikan batasnya:

- listener tidak membaca full value,
- listener tidak mengirim remote audit synchronous,
- listener tidak menyimpulkan login/logout,
- listener tidak mengelola correlation ID,
- listener tidak mengganti filter.

---

## 33. Mental Model Akhir

Listener adalah callback lifecycle dari container.

Pahami empat level ini:

```text
Application lifecycle:
  contextInitialized / contextDestroyed

Request lifecycle:
  requestInitialized / requestDestroyed

Session lifecycle:
  sessionCreated / sessionDestroyed / passivate / activate

Attribute lifecycle:
  added / replaced / removed / bound / unbound
```

Engineer biasa bertanya:

> “Listener dipakai buat apa?”

Engineer senior bertanya:

> “Lifecycle event mana yang saya butuhkan, siapa owner resource ini, bagaimana failure policy-nya, bagaimana shutdown-nya, apakah aman terhadap concurrency, redeploy, cluster, dan observability?”

Top-tier engineer melihat listener sebagai bagian dari web runtime state machine.

Listener yang baik:

- kecil,
- deterministic,
- thread-safe,
- bounded,
- lifecycle-aware,
- cleanup-aware,
- tidak bocor data,
- tidak mengandung business transaction berat,
- tidak menggantikan filter/framework/domain event,
- aman saat redeploy dan shutdown.

---

## 34. Referensi

- Jakarta Servlet Specification 6.1 — https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta EE Tutorial — Servlets and Lifecycle Events — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/servlets/servlets.html
- Jakarta Servlet API — `ServletContextListener` — https://tomcat.apache.org/tomcat-11.0-doc/servletapi/jakarta/servlet/ServletContextListener.html
- Eclipse Servlet API source — `ServletContextListener` lifecycle ordering notes — https://github.com/eclipse-ee4j/servlet-api/blob/master/api/src/main/java/jakarta/servlet/ServletContextListener.java
- Apache Tomcat 11 Servlet API Documentation — https://tomcat.apache.org/tomcat-11.0-doc/servletapi/

---

## 35. Ringkasan Eksekutif

- Listener adalah mekanisme callback lifecycle dari servlet container.
- Listener berbeda dari filter: listener mengamati event, filter membungkus request/response flow.
- `ServletContextListener` cocok untuk startup/shutdown application-scoped resource.
- `ServletRequestListener` cocok untuk observasi lifecycle request, tetapi request logging umum biasanya lebih cocok di filter.
- `HttpSessionListener` mengamati session lifecycle, bukan login/logout business event.
- Attribute listener bisa berguna, tetapi rawan noisy dan rawan data leakage.
- Listener harus thread-safe karena event request/session bisa concurrent.
- Listener harus punya startup failure policy yang jelas: fail fast atau degrade gracefully.
- Listener harus cleanup resource agar tidak terjadi classloader leak saat redeploy.
- Dalam cluster, listener lokal hanya melihat event lokal node, bukan global truth.
- Di Java 8 sampai Java 25, kontrak listener relatif stabil; yang berubah adalah runtime, framework integration, dan concurrency tools.

---

## 36. Status Seri

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

Berikutnya:

- Part 011 — ServletContext and Application Scope

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-009](./learn-java-servlet-websocket-web-container-runtime-part-009.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime — Part 011](./learn-java-servlet-websocket-web-container-runtime-part-011.md)
