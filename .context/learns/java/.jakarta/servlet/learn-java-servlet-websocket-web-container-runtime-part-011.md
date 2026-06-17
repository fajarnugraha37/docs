# learn-java-servlet-websocket-web-container-runtime — Part 011
# ServletContext and Application Scope

> Seri: **Java Servlet, WebSocket, Web Container & Server-Side Web Runtime**  
> Part: **011 dari 031**  
> Topik: **`ServletContext`, application scope, resource boundary, multi-webapp isolation, classloader interaction, and global state discipline**  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Tujuan Pembelajaran

Di bagian sebelumnya kita sudah membahas listener sebagai observability hook terhadap lifecycle web application. Sekarang kita naik satu lapisan ke object yang menjadi **representasi runtime dari satu web application di dalam servlet container**, yaitu `ServletContext`.

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami `ServletContext` sebagai **application boundary**, bukan sekadar tempat mengambil path atau menyimpan attribute.
2. Membedakan dengan jelas:
   - servlet context,
   - servlet config,
   - request scope,
   - session scope,
   - application scope,
   - CDI/Spring application scope.
3. Memahami bagaimana container memisahkan satu web application dari web application lain.
4. Mendesain penggunaan context attributes tanpa membuat global mutable state yang rapuh.
5. Memahami cara resource web application dibaca melalui `ServletContext`.
6. Memahami interaksi antara `ServletContext`, WAR layout, classloader, dependency isolation, dan redeploy.
7. Menghindari bug produksi seperti:
   - resource path salah,
   - context path salah di balik reverse proxy,
   - shared static state bocor antar redeploy,
   - memory leak karena context attribute,
   - initialization race,
   - multi-webapp coupling,
   - classloader leak.

Referensi utama:

- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet 6.1 API — `ServletContext`: https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/servletcontext
- Apache Tomcat 11 Class Loader How-To: https://tomcat.apache.org/tomcat-11.0-doc/class-loader-howto.html
- Apache Tomcat 11 Loader Configuration: https://tomcat.apache.org/tomcat-11.0-doc/config/loader.html
- Jetty 12.1 documentation: https://jetty.org/docs/jetty/12.1/

---

## 1. Mental Model Utama

`ServletContext` adalah **runtime handle milik container untuk satu web application**.

Bukan request.  
Bukan session.  
Bukan servlet instance.  
Bukan Spring `ApplicationContext`.  
Bukan CDI container itu sendiri.  

Ia adalah object yang disediakan container agar kode aplikasi bisa berinteraksi dengan lingkungan web application-nya.

Secara mental:

```text
Servlet Container
  ├── Web Application Context: /app-a
  │     ├── ServletContext instance A
  │     ├── Servlet/filter/listener registry
  │     ├── WEB-INF/classes
  │     ├── WEB-INF/lib/*.jar
  │     ├── session namespace A
  │     └── static/resource namespace A
  │
  ├── Web Application Context: /app-b
  │     ├── ServletContext instance B
  │     ├── Servlet/filter/listener registry
  │     ├── WEB-INF/classes
  │     ├── WEB-INF/lib/*.jar
  │     ├── session namespace B
  │     └── static/resource namespace B
  │
  └── Container-level runtime
        ├── connectors
        ├── thread pools
        ├── shared libraries
        ├── server config
        └── management/lifecycle system
```

Jadi `ServletContext` adalah **pintu komunikasi aplikasi web ke container**.

Melalui `ServletContext`, aplikasi dapat:

- membaca context path,
- membaca init parameter global aplikasi,
- menyimpan attribute application-wide,
- mendapatkan resource dari web application,
- melakukan dispatch ke resource lain,
- mendaftarkan servlet/filter/listener secara programmatic saat startup,
- menulis log ke logging mechanism container,
- mengetahui informasi container dan versi Servlet API,
- mendapatkan MIME type,
- mendapatkan session timeout default,
- mengakses virtual server name,
- dan beberapa operasi runtime lain.

Namun, kemampuan ini harus dipakai dengan disiplin. `ServletContext` terlalu mudah berubah menjadi “keranjang global” yang isinya apa saja. Engineer yang matang tidak melihat `ServletContext` sebagai map global, tetapi sebagai **boundary object**.

---

## 2. Apa Itu Application Scope?

Dalam Servlet, “application scope” biasanya berarti data yang disimpan sebagai attribute pada `ServletContext`.

Contoh:

```java
ServletContext context = request.getServletContext();
context.setAttribute("featureFlags", featureFlags);

FeatureFlags flags = (FeatureFlags) context.getAttribute("featureFlags");
```

Data itu tersedia untuk seluruh komponen dalam web application yang sama:

- servlet,
- filter,
- listener,
- JSP,
- framework code yang punya akses ke request/context.

Namun application scope **bukan berarti global untuk seluruh JVM**.

Jika container menjalankan dua web application:

```text
/app-a
/app-b
```

maka masing-masing punya `ServletContext` sendiri.

```text
/app-a ServletContext != /app-b ServletContext
```

Application scope juga **bukan berarti cluster-wide**.

Jika aplikasi berjalan pada 4 pod Kubernetes:

```text
pod-1: ServletContext instance local
pod-2: ServletContext instance local
pod-3: ServletContext instance local
pod-4: ServletContext instance local
```

Maka attribute di `ServletContext` pod-1 tidak otomatis ada di pod-2.

Ini sangat penting.

### 2.1 Application Scope Itu Node-Local

`ServletContext` berada di memory process JVM. Artinya:

- hilang saat process restart,
- tidak otomatis replicated,
- tidak visible antar node,
- tidak cocok untuk source of truth bisnis,
- tidak cocok untuk distributed lock,
- tidak cocok untuk global counter lintas cluster,
- tidak cocok untuk session store cluster,
- tidak cocok untuk cache yang harus konsisten lintas node.

Penggunaan yang masuk akal:

- object immutable configuration hasil bootstrap,
- registry lokal untuk resource aplikasi,
- reference ke service/facade yang lifecycle-nya dikontrol saat startup/shutdown,
- application metadata,
- precomputed read-only lookup lokal,
- lightweight shared utilities,
- integration bridge antara Servlet layer dan framework container.

Penggunaan yang berbahaya:

- menyimpan mutable business state,
- menyimpan user-specific state,
- menyimpan transaction context,
- menyimpan request object,
- menyimpan session object,
- menyimpan JDBC connection hidup,
- menyimpan large cache tanpa eviction,
- menyimpan thread/executor tanpa cleanup,
- menyimpan object dari classloader lama setelah redeploy.

---

## 3. `ServletContext` vs `ServletConfig`

Dua object ini sering tertukar.

| Konsep | Scope | Pemilik | Contoh Penggunaan |
|---|---:|---|---|
| `ServletConfig` | satu servlet | servlet tertentu | init param khusus servlet |
| `ServletContext` | satu web application | seluruh aplikasi web | init param global, resource, app attribute |

Contoh `ServletConfig`:

```java
public class ReportServlet extends HttpServlet {
    private String reportMode;

    @Override
    public void init(ServletConfig config) throws ServletException {
        super.init(config);
        this.reportMode = config.getInitParameter("reportMode");
    }
}
```

Contoh `ServletContext`:

```java
public class ReportServlet extends HttpServlet {
    private String appRegion;

    @Override
    public void init() throws ServletException {
        this.appRegion = getServletContext().getInitParameter("app.region");
    }
}
```

Mental model:

```text
ServletConfig
  = configuration untuk satu servlet instance

ServletContext
  = runtime context untuk seluruh web application
```

Kesalahan umum:

```java
// Buruk: config global disalin ke semua servlet tanpa desain jelas
String value = getServletConfig().getInitParameter("global.timeout");
```

Lebih jelas:

```java
String value = getServletContext().getInitParameter("global.timeout");
```

Namun untuk aplikasi modern, konfigurasi biasanya dikelola oleh Spring, CDI, MicroProfile Config, environment variable, Kubernetes ConfigMap/Secret, atau sistem config lain. `ServletContext` init param tetap penting untuk memahami legacy dan container integration.

---

## 4. `ServletContext` vs Request Scope vs Session Scope

Salah satu skill penting adalah memilih scope yang benar.

| Scope | Lifetime | Visibility | Cocok Untuk | Tidak Cocok Untuk |
|---|---|---|---|---|
| Request | satu request dispatch | satu request | correlation id, parsed body, current user principal snapshot | state antar request |
| Session | banyak request dari user/session yang sama | user/session | login session, wizard state kecil | global app cache, data besar |
| Application / ServletContext | selama webapp hidup | semua request dalam satu webapp satu JVM | immutable app config, registry lokal | user state, business state mutable |
| Static field | selama classloader hidup | tergantung classloader | constants, truly immutable utility | state lifecycle webapp |
| External store | tergantung sistem | lintas node/process | source of truth, distributed session/cache | data transient murah |

Contoh salah scope:

```java
// Sangat buruk: user-specific state disimpan application-wide
context.setAttribute("currentUser", user);
```

Bug yang akan muncul:

- user A bisa terlihat sebagai user B,
- race condition antar request,
- data bocor antar user,
- audit trail kacau,
- security incident.

Scope yang benar:

```java
request.setAttribute("currentUser", user);       // untuk request ini saja
session.setAttribute("currentUserId", userId);   // jika memang session-based auth
```

Atau pada framework modern, user identity biasanya disimpan di security context/request context, bukan manual di `ServletContext`.

---

## 5. `ServletContext` vs CDI/Spring Application Context

Ini titik yang sering membingungkan.

`ServletContext` adalah konsep Servlet container.  
Spring `ApplicationContext` adalah IoC container milik Spring.  
CDI container adalah dependency injection container Jakarta EE.  

Mereka bisa hidup berdampingan.

```text
Servlet Container
  └── ServletContext
        ├── Spring ApplicationContext
        │     ├── beans
        │     └── lifecycle callbacks
        │
        ├── CDI BeanManager
        │     ├── contextual instances
        │     └── scopes
        │
        └── Servlet/filter/listener runtime
```

Dalam aplikasi Spring MVC klasik, biasanya Spring root context disimpan sebagai attribute di `ServletContext` oleh listener/framework bootstrap.

Dalam aplikasi Jakarta EE, CDI container terintegrasi dengan server dan dapat memberikan injection ke komponen tertentu tergantung container/spec support.

Yang penting:

- `ServletContext` bukan dependency injection container.
- Jangan menjadikan `ServletContext` sebagai service locator liar.
- Jangan menyimpan semua service manual di context attribute jika sudah ada CDI/Spring.
- Gunakan `ServletContext` untuk boundary integration, bukan sebagai pengganti architecture container.

Anti-pattern:

```java
public class SomeServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        UserService userService =
            (UserService) getServletContext().getAttribute("userService");
        // ...
    }
}
```

Lebih baik:

- constructor injection jika framework mendukung,
- field injection/container-managed injection jika Jakarta EE style,
- servlet init mengambil satu application facade yang jelas jika benar-benar manual.

Contoh manual yang masih rapi untuk small non-framework servlet app:

```java
public final class ApplicationComponents {
    private final UserService userService;
    private final AuditService auditService;

    public ApplicationComponents(UserService userService, AuditService auditService) {
        this.userService = userService;
        this.auditService = auditService;
    }

    public UserService userService() {
        return userService;
    }

    public AuditService auditService() {
        return auditService;
    }
}
```

Listener:

```java
@WebListener
public class BootstrapListener implements ServletContextListener {
    public static final String COMPONENTS_KEY =
        BootstrapListener.class.getName() + ".components";

    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();

        UserRepository userRepository = new JdbcUserRepository(...);
        AuditRepository auditRepository = new JdbcAuditRepository(...);

        ApplicationComponents components = new ApplicationComponents(
            new UserService(userRepository),
            new AuditService(auditRepository)
        );

        context.setAttribute(COMPONENTS_KEY, components);
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        event.getServletContext().removeAttribute(COMPONENTS_KEY);
    }
}
```

Servlet:

```java
public class UserServlet extends HttpServlet {
    private ApplicationComponents components;

    @Override
    public void init() {
        this.components = (ApplicationComponents) getServletContext()
            .getAttribute(BootstrapListener.COMPONENTS_KEY);
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        UserService userService = components.userService();
        // ...
    }
}
```

Ini masih bukan arsitektur ideal untuk aplikasi besar, tetapi jauh lebih baik daripada menyebarkan string key service satu-satu.

---

## 6. Context Path: Identitas URL Aplikasi

`ServletContext#getContextPath()` mengembalikan context path aplikasi.

Contoh:

```text
URL:         https://example.com/aceas/cases/123
Context:     /aceas
ServletPath: /cases
PathInfo:    /123   // tergantung mapping
```

Context path adalah bagian URL yang memilih web application.

```text
https://host/app-a/...  → ServletContext app-a
https://host/app-b/...  → ServletContext app-b
```

Jika aplikasi dipasang di root context:

```text
https://host/
```

maka context path biasanya string kosong `""`, bukan `/`.

Ini sering menyebabkan bug saat membangun URL manual.

Buruk:

```java
String url = request.getContextPath() + "/login";
```

Ini masih oke untuk banyak kasus, tetapi perlu sadar:

- jika context path kosong, hasil `/login`, benar;
- jika context path `/app`, hasil `/app/login`, benar;
- jika ada reverse proxy yang rewrite path, hasil bisa tidak sesuai public URL;
- jika ada forwarded prefix, container mungkin tidak tahu prefix publik;
- jika hardcode `/app`, aplikasi rusak saat deploy path berubah.

Untuk redirect sederhana:

```java
response.sendRedirect(request.getContextPath() + "/login");
```

Untuk aplikasi di balik reverse proxy/API gateway, URL eksternal mungkin berbeda dari context path internal.

Contoh:

```text
Public URL:   https://portal.example.com/agency/aceas/login
Internal URL: http://app:8080/aceas/login
```

Jika proxy menghapus `/agency`, aplikasi hanya melihat `/aceas`. Jika aplikasi membangun absolute URL tanpa memahami forwarded headers/prefix, redirect bisa salah.

Prinsip:

- Gunakan relative redirect jika cukup.
- Gunakan context path, bukan hardcode path.
- Untuk absolute URL, pahami forwarded headers.
- Jangan mencampur public route dan internal route tanpa kontrak jelas.

---

## 7. Context Init Parameters

Context init parameter adalah konfigurasi global web application yang dideklarasikan di deployment descriptor atau secara programmatic sebelum context initialized.

Contoh `web.xml`:

```xml
<context-param>
    <param-name>app.region</param-name>
    <param-value>sg</param-value>
</context-param>

<context-param>
    <param-name>feature.audit.enabled</param-name>
    <param-value>true</param-value>
</context-param>
```

Membaca dari kode:

```java
String region = getServletContext().getInitParameter("app.region");
```

Mengambil semua nama:

```java
Enumeration<String> names = getServletContext().getInitParameterNames();
while (names.hasMoreElements()) {
    String name = names.nextElement();
    String value = getServletContext().getInitParameter(name);
}
```

### 7.1 Kapan Context Init Param Cocok?

Cocok untuk:

- konfigurasi legacy WAR,
- konfigurasi container-specific kecil,
- bootstrap toggle sederhana,
- integrasi dengan listener/filter/servlet non-framework,
- parameter yang memang milik deployment descriptor.

Kurang cocok untuk:

- secret,
- credential,
- configuration yang sering berubah,
- config kompleks multi-environment,
- dynamic feature flag,
- config yang butuh refresh runtime.

Untuk aplikasi modern di Kubernetes/cloud, biasanya lebih baik menggunakan:

- environment variable,
- config file eksternal,
- secret manager,
- MicroProfile Config,
- Spring Boot configuration,
- Jakarta Config saat tersedia di stack,
- service discovery/config server.

Namun `ServletContext` init param tetap penting untuk memahami kontrak webapp dan legacy migration.

### 7.2 Init Parameter Bukan Mutable Runtime Config

Walaupun API modern punya method seperti `setInitParameter`, itu hanya boleh digunakan pada fase sebelum context benar-benar initialized. Setelah context initialized, mengubah init parameter bukan model konfigurasi runtime yang baik.

Jangan desain sistem seperti ini:

```java
// Buruk: mencoba menjadikan init parameter sebagai runtime feature flag
context.setInitParameter("feature.x.enabled", "false");
```

Gunakan config provider yang memang dirancang untuk runtime/dynamic config.

---

## 8. Context Attributes

`ServletContext` menyediakan map attribute application-wide.

API konseptual:

```java
Object getAttribute(String name);
Enumeration<String> getAttributeNames();
void setAttribute(String name, Object object);
void removeAttribute(String name);
```

Attribute ini berbeda dari init parameter:

| Aspek | Init Parameter | Attribute |
|---|---|---|
| Tipe | `String` | `Object` |
| Mutability | konfigurasi awal | dapat diubah runtime |
| Sumber | deployment/programmatic startup | aplikasi/container/framework |
| Use case | config sederhana | shared object/reference |

Contoh baik:

```java
public final class ContextKeys {
    private ContextKeys() {}

    public static final String APP_METADATA =
        "com.example.app.APP_METADATA";
}
```

```java
context.setAttribute(ContextKeys.APP_METADATA, new AppMetadata(
    "case-management",
    "1.4.2",
    Instant.now()
));
```

### 8.1 Gunakan Key yang Collision-Resistant

Buruk:

```java
context.setAttribute("config", config);
context.setAttribute("service", service);
context.setAttribute("user", user);
```

Masalah:

- collision dengan library/framework,
- susah grep,
- tidak jelas owner,
- raw string tersebar,
- raw cast rawan.

Lebih baik:

```java
public static final String APP_COMPONENTS_KEY =
    ApplicationComponents.class.getName();
```

atau:

```java
public static final String APP_COMPONENTS_KEY =
    "com.example.caseapp.ApplicationComponents";
```

### 8.2 Context Attribute Harus Thread-Safe

Karena attribute bisa diakses oleh banyak request secara paralel, object yang disimpan harus aman untuk concurrent access.

Aman:

```java
context.setAttribute("app.metadata", new AppMetadata(...)); // immutable
```

Potensial berbahaya:

```java
context.setAttribute("stats", new HashMap<String, Long>());
```

Jika banyak thread melakukan update:

```java
Map<String, Long> stats = (Map<String, Long>) context.getAttribute("stats");
stats.put(module, stats.getOrDefault(module, 0L) + 1L);
```

Bug:

- race condition,
- lost update,
- corrupted internal structure pada koleksi non-thread-safe,
- visibility issue.

Lebih baik:

```java
ConcurrentHashMap<String, LongAdder> stats = new ConcurrentHashMap<>();
context.setAttribute("com.example.stats", stats);
```

Update:

```java
stats.computeIfAbsent(module, ignored -> new LongAdder()).increment();
```

Tetapi tetap tanya: apakah metric sebaiknya disimpan di `ServletContext`? Untuk observability production, biasanya lebih baik pakai metrics registry seperti Micrometer/MicroProfile Metrics/Prometheus exporter.

### 8.3 Jangan Simpan Request/Response/Session dalam ServletContext

Sangat buruk:

```java
context.setAttribute("lastRequest", request);
context.setAttribute("lastResponse", response);
context.setAttribute("lastSession", request.getSession());
```

Masalah:

- object lifecycle salah,
- memory leak,
- data user bocor,
- request body/response state tertahan,
- classloader leak saat redeploy,
- race antar user.

Request object hanya valid pada lifecycle request/async yang sesuai.

---

## 9. Resource Loading via `ServletContext`

Salah satu fungsi penting `ServletContext` adalah membaca resource milik web application.

WAR layout umum:

```text
myapp.war
  ├── index.html
  ├── assets/
  │   └── app.css
  ├── WEB-INF/
  │   ├── web.xml
  │   ├── classes/
  │   │   └── com/example/App.class
  │   └── lib/
  │       └── dependency.jar
  └── META-INF/
```

Resource webapp adalah resource yang berada dalam namespace web application, biasanya di-root oleh document base webapp.

Contoh membaca resource:

```java
try (InputStream in = getServletContext().getResourceAsStream("/WEB-INF/templates/email.html")) {
    if (in == null) {
        throw new IllegalStateException("Template not found");
    }
    String template = new String(in.readAllBytes(), StandardCharsets.UTF_8);
}
```

Catatan Java 8:

```java
byte[] bytes = readAllBytesJava8(in);
```

`InputStream#readAllBytes()` baru tersedia di Java 9.

Helper Java 8:

```java
private static byte[] readAllBytesJava8(InputStream in) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = in.read(buffer)) != -1) {
        out.write(buffer, 0, read);
    }
    return out.toByteArray();
}
```

### 9.1 Path Resource Harus Diawali `/`

Untuk `ServletContext#getResource` dan `getResourceAsStream`, path biasanya absolute terhadap root web application dan diawali `/`.

```java
getServletContext().getResourceAsStream("/WEB-INF/app.properties");
```

Bukan:

```java
getServletContext().getResourceAsStream("WEB-INF/app.properties"); // rawan salah
```

### 9.2 `WEB-INF` Tidak Public, Tapi Bisa Dibaca Server-Side

File di `WEB-INF` tidak dapat diakses langsung oleh browser sebagai static resource.

```text
GET /app/WEB-INF/app.properties → tidak boleh direct served
```

Tapi kode server bisa membaca:

```java
getServletContext().getResourceAsStream("/WEB-INF/app.properties")
```

Karena itu `WEB-INF` cocok untuk:

- template internal,
- config packaging legacy,
- JSP yang tidak boleh direct access,
- resource internal aplikasi.

Namun jangan menyimpan secret sensitif di WAR jika artifact bisa tersebar luas. Secret sebaiknya berasal dari secret manager/environment/volume rahasia.

### 9.3 `ServletContext` Resource vs Classpath Resource

Dua mekanisme resource yang berbeda:

```java
// Web application resource
InputStream a = servletContext.getResourceAsStream("/WEB-INF/app.properties");

// Classpath resource
InputStream b = Thread.currentThread()
    .getContextClassLoader()
    .getResourceAsStream("app.properties");
```

Perbedaannya:

| Aspek | ServletContext Resource | Classpath Resource |
|---|---|---|
| Root | webapp document root | classpath |
| Path contoh | `/WEB-INF/file.txt` | `file.txt` |
| Bisa baca static web resource | ya | belum tentu |
| Bisa baca dependency jar resource | tergantung API/container | ya jika di classpath |
| Cocok untuk | webapp packaged resource | library/application internal resource |

Untuk WAR:

```text
WEB-INF/classes/app.properties
```

biasanya bisa dibaca lewat classloader:

```java
getClass().getClassLoader().getResourceAsStream("app.properties");
```

Sedangkan:

```text
WEB-INF/templates/email.html
```

lebih natural dibaca via `ServletContext`:

```java
servletContext.getResourceAsStream("/WEB-INF/templates/email.html");
```

### 9.4 Jangan Gunakan Real Path sebagai Asumsi Universal

`ServletContext#getRealPath(String)` dapat mengembalikan path filesystem nyata untuk resource webapp jika webapp diexplode ke filesystem. Namun tidak selalu tersedia.

Contoh rawan:

```java
String path = getServletContext().getRealPath("/WEB-INF/templates/email.html");
File file = new File(path);
```

Masalah:

- WAR mungkin tidak diexplode,
- container embedded mungkin menggunakan nested JAR,
- cloud runtime/container image bisa read-only,
- path lokal berbeda antar environment,
- `getRealPath` bisa `null`,
- file dalam JAR tidak selalu menjadi file biasa.

Lebih portable:

```java
try (InputStream in = getServletContext()
        .getResourceAsStream("/WEB-INF/templates/email.html")) {
    // read stream
}
```

Gunakan real filesystem hanya jika memang resource berasal dari mounted volume/config directory eksternal, bukan webapp packaged resource.

---

## 10. MIME Type and Static Resource Metadata

`ServletContext#getMimeType(String file)` dapat digunakan untuk meminta MIME type berdasarkan nama file.

Contoh:

```java
String mime = getServletContext().getMimeType("report.pdf");
if (mime == null) {
    mime = "application/octet-stream";
}
response.setContentType(mime);
```

Ini berguna pada file download sederhana. Tetapi jangan menganggap MIME type dari ekstensi file sebagai verifikasi keamanan.

Buruk:

```java
if (context.getMimeType(fileName).equals("image/png")) {
    // trusted image
}
```

Kenapa buruk:

- filename bisa dipalsukan,
- content type bisa salah,
- file extension bukan bukti isi file,
- upload perlu validasi konten dan policy tersendiri.

MIME type di `ServletContext` adalah helper presentasi/response, bukan security scanner.

---

## 11. Programmatic Registration via `ServletContext`

Sejak Servlet 3.0, web application dapat mendaftarkan servlet/filter/listener secara programmatic saat startup.

Contoh:

```java
public class AppInitializer implements ServletContainerInitializer {
    @Override
    public void onStartup(Set<Class<?>> classes, ServletContext context)
            throws ServletException {

        ServletRegistration.Dynamic servlet =
            context.addServlet("healthServlet", new HealthServlet());

        servlet.addMapping("/health");
        servlet.setLoadOnStartup(1);

        FilterRegistration.Dynamic filter =
            context.addFilter("correlationFilter", new CorrelationIdFilter());

        filter.addMappingForUrlPatterns(
            EnumSet.of(DispatcherType.REQUEST, DispatcherType.ERROR),
            false,
            "/*"
        );
    }
}
```

Atau via `ServletContextListener` pada fase awal tertentu, tergantung aturan container/spec.

Gunanya:

- framework bootstrap,
- library auto-registration,
- conditional registration,
- menghindari `web.xml` besar,
- membuat aplikasi lebih modular.

Namun ada batas penting:

- registration harus dilakukan pada fase startup yang diizinkan,
- setelah context initialized, sebagian registration tidak boleh diubah,
- ordering dapat menjadi kompleks,
- debugging lebih sulit daripada deklarasi eksplisit.

Untuk engineer top-tier, penting memahami bahwa annotation seperti `@WebServlet`, `@WebFilter`, dan framework auto-configuration pada akhirnya harus menghasilkan registry runtime di container.

---

## 12. Multi-Webapp Isolation

Dalam external servlet container tradisional, satu JVM bisa menjalankan banyak webapp.

```text
Tomcat JVM
  ├── /aceas
  ├── /cpds
  ├── /admin
  └── /legacy-report
```

Setiap webapp punya:

- context path,
- ServletContext,
- servlet registry,
- filter registry,
- listener registry,
- session namespace,
- classloader webapp,
- resource namespace.

### 12.1 Isolation Tidak Selalu Sempurna

Walaupun konsepnya isolated, tetap ada shared layer:

- JVM process,
- heap,
- metaspace,
- GC,
- CPU,
- container thread pool tertentu,
- connector,
- shared libraries,
- system properties,
- environment variables,
- logging system tertentu,
- JNDI/global resource tertentu,
- native library.

Artinya, satu webapp bisa memengaruhi webapp lain melalui:

- memory leak,
- CPU starvation,
- too many threads,
- logging flood,
- classpath conflict jika shared libs salah,
- deadlock pada shared resource,
- JDBC driver/global DriverManager issue,
- system property mutation.

Contoh buruk:

```java
System.setProperty("user.timezone", "Asia/Jakarta");
```

Di multi-webapp JVM, ini bisa memengaruhi seluruh process.

Prinsip:

- Hindari mutasi global JVM dari aplikasi web.
- Treat `ServletContext` as webapp-local state.
- Treat static mutable state as classloader-local but lifecycle-dangerous.
- Treat system properties/environment/native state as process-global and hazardous.

### 12.2 Cross-Context Access

Servlet API memiliki konsep mendapatkan context lain melalui path tertentu jika container mengizinkan cross-context. Namun ini jarang direkomendasikan dalam arsitektur modern.

Contoh konseptual:

```java
ServletContext other = context.getContext("/other-app");
```

Masalah:

- coupling antar webapp,
- security boundary kabur,
- lifecycle dependency sulit,
- deployment order problem,
- classloader boundary problem,
- cloud/Kubernetes model tidak cocok,
- scale-out sulit.

Lebih baik gunakan explicit integration boundary:

- HTTP API,
- message broker,
- database contract yang jelas,
- event stream,
- shared identity provider,
- service mesh/internal gateway.

Cross-context direct access adalah fitur container-era lama, bukan pattern utama untuk sistem modern.

---

## 13. Classloader Interaction

`ServletContext` tidak bisa dipahami penuh tanpa classloader.

Dalam WAR tradisional:

```text
WEB-INF/classes
WEB-INF/lib/*.jar
```

akan dimuat oleh web application classloader.

Container juga punya classloader sendiri untuk:

- Servlet API,
- container implementation,
- connector,
- shared libraries,
- server-level classes.

Tomcat documentation menjelaskan bahwa Tomcat menggunakan beberapa classloader agar bagian container dan web application memiliki akses ke repository classes/resources yang berbeda. Tomcat Loader configuration juga menyatakan loader web application harus mengikuti requirement Servlet Specification dan memuat class/resource dari lokasi web application yang sesuai.

Mental model:

```text
Bootstrap / Platform classloader
  ↓
System / Application classloader
  ↓
Container common classloader
  ↓
Webapp classloader for /app-a
  ├── WEB-INF/classes
  └── WEB-INF/lib/*.jar

Container common classloader
  ↓
Webapp classloader for /app-b
  ├── WEB-INF/classes
  └── WEB-INF/lib/*.jar
```

Detail parent-first/child-first dapat berbeda antar container/konfigurasi, tetapi prinsip isolasi webapp tetap penting.

### 13.1 Kenapa Classloader Penting untuk ServletContext Attribute?

Object yang disimpan ke `ServletContext` dimuat oleh classloader tertentu.

Contoh:

```java
context.setAttribute("components", new ApplicationComponents(...));
```

`ApplicationComponents` dimuat oleh webapp classloader.

Saat redeploy:

```text
old webapp classloader harus bisa garbage collected
new webapp classloader dibuat
```

Jika ada reference dari luar ke object lama:

```text
container/shared/static/thread → old ApplicationComponents → old classloader
```

maka old classloader tertahan. Ini menyebabkan metaspace leak.

### 13.2 Static Field vs ServletContext Attribute

Static field sering dianggap global. Dalam webapp, static field sebenarnya global **untuk classloader yang memuat class itu**.

```java
public final class GlobalRegistry {
    public static final Map<String, Object> OBJECTS = new ConcurrentHashMap<>();
}
```

Jika `GlobalRegistry` berada di `WEB-INF/classes`, static field ini milik webapp classloader.

Saat redeploy, classloader lama harus hilang. Tapi jika ada thread lama yang masih berjalan, static map bisa ikut tertahan.

Jika `GlobalRegistry` berada di shared container library, maka static field bisa menjadi benar-benar shared antar webapp. Ini lebih berbahaya.

Prinsip:

- Constants immutable: aman.
- Static mutable state di webapp: perlu sangat hati-hati.
- Static mutable state di shared classloader: hampir selalu red flag.
- ServletContext attribute lebih lifecycle-aware daripada static, tetapi tetap harus dibersihkan.

---

## 14. Lifecycle Discipline for Context Attributes

Jika kamu membuat object application-wide, harus jelas:

1. dibuat kapan,
2. siap digunakan kapan,
3. siapa pemiliknya,
4. thread-safe atau tidak,
5. ditutup kapan,
6. apa yang terjadi jika startup gagal,
7. apa yang terjadi saat shutdown/redeploy.

Contoh lifecycle rapi:

```java
@WebListener
public class AppLifecycle implements ServletContextListener {
    public static final String APP_KEY = AppLifecycle.class.getName() + ".app";

    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        AppRuntime runtime = null;

        try {
            runtime = AppRuntime.start(AppConfig.from(context));
            context.setAttribute(APP_KEY, runtime);
            context.log("Application runtime started");
        } catch (RuntimeException ex) {
            if (runtime != null) {
                try {
                    runtime.close();
                } catch (Exception closeEx) {
                    ex.addSuppressed(closeEx);
                }
            }
            throw ex;
        }
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        AppRuntime runtime = (AppRuntime) context.getAttribute(APP_KEY);
        context.removeAttribute(APP_KEY);

        if (runtime != null) {
            try {
                runtime.close();
                context.log("Application runtime stopped");
            } catch (Exception ex) {
                context.log("Failed to stop application runtime", ex);
            }
        }
    }
}
```

`AppRuntime`:

```java
public final class AppRuntime implements AutoCloseable {
    private final ExecutorService executor;
    private final SomeClient client;

    private AppRuntime(ExecutorService executor, SomeClient client) {
        this.executor = executor;
        this.client = client;
    }

    public static AppRuntime start(AppConfig config) {
        ExecutorService executor = Executors.newFixedThreadPool(config.workerThreads());
        SomeClient client = SomeClient.connect(config.endpoint());
        return new AppRuntime(executor, client);
    }

    @Override
    public void close() {
        client.close();
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }
}
```

Ini jauh lebih baik daripada:

```java
@WebListener
public class BadLifecycle implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent event) {
        ExecutorService executor = Executors.newCachedThreadPool();
        event.getServletContext().setAttribute("executor", executor);
    }

    // Tidak ada contextDestroyed
}
```

Bug dari versi buruk:

- thread leak,
- redeploy leak,
- request masih menjalankan task lama,
- classloader tertahan,
- shutdown lambat,
- container warning.

---

## 15. ServletContext Logging

`ServletContext#log` menyediakan cara aplikasi menulis log melalui mechanism container.

Contoh:

```java
getServletContext().log("Report module initialized");
getServletContext().log("Failed to load report template", exception);
```

Ini berguna pada aplikasi servlet sederhana/legacy. Namun pada aplikasi modern, biasanya logging menggunakan SLF4J/Logback/Log4j2/JUL bridge dan observability pipeline.

Prinsip:

- Gunakan logging framework utama aplikasi untuk structured logs.
- `ServletContext#log` cocok untuk bootstrap/container-adjacent events.
- Jangan mengandalkan `ServletContext#log` untuk semua observability production.
- Pastikan log memiliki correlation id pada request flow; `ServletContext` log startup/shutdown biasanya tidak punya request id.

---

## 16. Server Info and Capability Discovery

`ServletContext` juga menyediakan informasi seperti:

```java
String serverInfo = context.getServerInfo();
int major = context.getMajorVersion();
int minor = context.getMinorVersion();
String virtualServerName = context.getVirtualServerName();
```

Contoh output konseptual:

```text
Apache Tomcat/11.0.x
Servlet API: 6.1
Virtual server: default-host
```

Gunanya:

- diagnostics,
- startup log,
- compatibility check,
- support dump,
- health endpoint internal.

Namun jangan membuat business logic bergantung secara agresif pada string server info.

Buruk:

```java
if (context.getServerInfo().contains("Tomcat")) {
    // behave differently
}
```

Lebih baik:

- gunakan feature detection,
- gunakan explicit config,
- isolate container-specific adapter,
- dokumentasikan supported runtime.

---

## 17. Dynamic Registration and Framework Bootstrap

Framework seperti Spring MVC, Jersey, JSF, Wicket, Vaadin, dan banyak library web lain menggunakan Servlet runtime sebagai bootstrap surface.

Mekanisme umum:

1. Container scan annotation atau `web.xml`.
2. Container menemukan listener/initializer.
3. Framework mendaftarkan servlet/filter/listener.
4. Framework menyimpan root context/registry di `ServletContext`.
5. Request masuk ke front controller servlet/filter.
6. Framework routing berjalan di dalam servlet/filter tersebut.

Mental model:

```text
ServletContext startup
  ↓
Framework initializer
  ↓
Register DispatcherServlet / Jersey Servlet / FacesServlet / etc.
  ↓
Register filters
  ↓
Store framework context attribute
  ↓
Container marks webapp ready
```

Karena itu, saat framework error startup, root cause sering berada di:

- listener initialization,
- servlet registration conflict,
- classpath mismatch,
- duplicate API jar,
- namespace mismatch `javax` vs `jakarta`,
- missing container capability,
- classloader conflict.

---

## 18. Example: Minimal Servlet App with Clean Context Boundary

Struktur:

```text
src/main/java/com/example/web/
  AppBootstrap.java
  AppRuntime.java
  HealthServlet.java
  ReportServlet.java
  ContextKeys.java

src/main/webapp/
  WEB-INF/
    templates/
      report.html
```

`ContextKeys`:

```java
package com.example.web;

public final class ContextKeys {
    private ContextKeys() {}

    public static final String APP_RUNTIME =
        "com.example.web.APP_RUNTIME";
}
```

`AppRuntime`:

```java
package com.example.web;

import java.time.Instant;

public final class AppRuntime implements AutoCloseable {
    private final Instant startedAt;
    private final ReportRenderer reportRenderer;

    public AppRuntime(ReportRenderer reportRenderer) {
        this.startedAt = Instant.now();
        this.reportRenderer = reportRenderer;
    }

    public Instant startedAt() {
        return startedAt;
    }

    public ReportRenderer reportRenderer() {
        return reportRenderer;
    }

    @Override
    public void close() {
        // close resources if any
    }
}
```

`ReportRenderer`:

```java
package com.example.web;

public final class ReportRenderer {
    private final String template;

    public ReportRenderer(String template) {
        this.template = template;
    }

    public String render(String title) {
        return template.replace("${title}", escapeHtml(title));
    }

    private static String escapeHtml(String value) {
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#x27;");
    }
}
```

`AppBootstrap`:

```java
package com.example.web;

import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@WebListener
public final class AppBootstrap implements ServletContextListener {
    @Override
    public void contextInitialized(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        AppRuntime runtime = null;

        try {
            String template = readRequiredResource(
                context,
                "/WEB-INF/templates/report.html"
            );

            runtime = new AppRuntime(new ReportRenderer(template));
            context.setAttribute(ContextKeys.APP_RUNTIME, runtime);
            context.log("AppRuntime initialized");
        } catch (Exception ex) {
            if (runtime != null) {
                try {
                    runtime.close();
                } catch (Exception closeEx) {
                    ex.addSuppressed(closeEx);
                }
            }
            throw new IllegalStateException("Failed to initialize application", ex);
        }
    }

    @Override
    public void contextDestroyed(ServletContextEvent event) {
        ServletContext context = event.getServletContext();
        AppRuntime runtime = (AppRuntime) context.getAttribute(ContextKeys.APP_RUNTIME);
        context.removeAttribute(ContextKeys.APP_RUNTIME);

        if (runtime != null) {
            try {
                runtime.close();
                context.log("AppRuntime destroyed");
            } catch (Exception ex) {
                context.log("Failed to destroy AppRuntime", ex);
            }
        }
    }

    private static String readRequiredResource(ServletContext context, String path)
            throws IOException {
        try (InputStream in = context.getResourceAsStream(path)) {
            if (in == null) {
                throw new IOException("Resource not found: " + path);
            }
            return new String(readAllBytes(in), StandardCharsets.UTF_8);
        }
    }

    private static byte[] readAllBytes(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }
}
```

`HealthServlet`:

```java
package com.example.web;

import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

@WebServlet(urlPatterns = "/health", loadOnStartup = 1)
public final class HealthServlet extends HttpServlet {
    private AppRuntime runtime;

    @Override
    public void init() {
        this.runtime = (AppRuntime) getServletContext()
            .getAttribute(ContextKeys.APP_RUNTIME);

        if (this.runtime == null) {
            throw new IllegalStateException("AppRuntime is not initialized");
        }
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"status\":\"UP\",\"startedAt\":\""
            + runtime.startedAt()
            + "\"}");
    }
}
```

`ReportServlet`:

```java
package com.example.web;

import jakarta.servlet.annotation.WebServlet;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

@WebServlet(urlPatterns = "/reports/preview")
public final class ReportServlet extends HttpServlet {
    private ReportRenderer renderer;

    @Override
    public void init() {
        AppRuntime runtime = (AppRuntime) getServletContext()
            .getAttribute(ContextKeys.APP_RUNTIME);

        if (runtime == null) {
            throw new IllegalStateException("AppRuntime is not initialized");
        }

        this.renderer = runtime.reportRenderer();
    }

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws IOException {
        String title = request.getParameter("title");
        if (title == null || title.isBlank()) {
            title = "Untitled Report";
        }

        response.setContentType("text/html;charset=UTF-8");
        response.getWriter().write(renderer.render(title));
    }
}
```

Catatan Java 8:

- `String#isBlank()` belum ada di Java 8.
- Untuk Java 8 gunakan:

```java
if (title == null || title.trim().isEmpty()) {
    title = "Untitled Report";
}
```

Pelajaran dari contoh:

- context attribute hanya menyimpan satu root object yang jelas,
- key collision-resistant,
- startup membaca resource via `ServletContext`,
- servlet mengambil dependency saat `init`, bukan setiap request,
- resource lifecycle ditutup saat `contextDestroyed`,
- tidak ada user state di application scope,
- tidak ada `getRealPath`,
- tidak ada static mutable registry.

---

## 19. Context Attribute Concurrency Pattern

Jika benar-benar perlu menyimpan shared state application-wide, pilih struktur concurrency yang tepat.

### 19.1 Immutable Snapshot Pattern

Cocok untuk config/lookup yang di-refresh atomically.

```java
public final class FeatureFlagSnapshot {
    private final Map<String, Boolean> flags;
    private final Instant loadedAt;

    public FeatureFlagSnapshot(Map<String, Boolean> flags, Instant loadedAt) {
        this.flags = Collections.unmodifiableMap(new HashMap<>(flags));
        this.loadedAt = loadedAt;
    }

    public boolean enabled(String name) {
        return flags.getOrDefault(name, false);
    }

    public Instant loadedAt() {
        return loadedAt;
    }
}
```

Store:

```java
AtomicReference<FeatureFlagSnapshot> ref = new AtomicReference<>(initialSnapshot);
context.setAttribute("com.example.flags", ref);
```

Read:

```java
AtomicReference<FeatureFlagSnapshot> ref =
    (AtomicReference<FeatureFlagSnapshot>) context.getAttribute("com.example.flags");

boolean enabled = ref.get().enabled("new-flow");
```

Refresh:

```java
ref.set(newSnapshot);
```

Keunggulan:

- readers tidak perlu lock,
- snapshot konsisten,
- update atomic,
- object immutable.

### 19.2 Concurrent Registry Pattern

Cocok untuk registry lokal yang memang mutable.

```java
public final class LocalConnectionRegistry {
    private final ConcurrentHashMap<String, ConnectionInfo> byId = new ConcurrentHashMap<>();

    public void add(ConnectionInfo connection) {
        byId.put(connection.id(), connection);
    }

    public void remove(String id) {
        byId.remove(id);
    }

    public int size() {
        return byId.size();
    }
}
```

Namun untuk WebSocket/session registry cluster-wide, local registry hanya mewakili satu node. Jangan overclaim.

### 19.3 Avoid Compound Unsynchronized Mutations

Buruk:

```java
List<String> activeUsers = (List<String>) context.getAttribute("activeUsers");
if (!activeUsers.contains(userId)) {
    activeUsers.add(userId);
}
```

Masalah:

- `contains` + `add` bukan atomic,
- `ArrayList` tidak thread-safe,
- race condition.

Lebih baik:

```java
Set<String> activeUsers = ConcurrentHashMap.newKeySet();
activeUsers.add(userId);
```

Tetapi untuk active user lintas node, gunakan distributed presence strategy, bukan `ServletContext`.

---

## 20. Failure Model: ServletContext

### 20.1 Startup Partial Failure

Skenario:

1. Listener membuat object A.
2. Listener membuat executor B.
3. Listener gagal membuat client C.
4. Context initialization gagal.
5. A dan B tidak dibersihkan.

Dampak:

- thread leak,
- socket leak,
- startup retry makin buruk,
- redeploy gagal bersih.

Mitigasi:

- gunakan try/catch startup,
- close resource yang sudah dibuat,
- set attribute hanya setelah runtime siap,
- jika set lebih awal, remove saat gagal.

### 20.2 Attribute Race

Skenario:

- Servlet `init()` membaca context attribute.
- Listener belum selesai membuat attribute.
- Servlet load order salah.

Mitigasi:

- gunakan listener startup ordering yang jelas,
- gunakan `loadOnStartup`,
- fail fast jika dependency belum ada,
- hindari lazy global initialization yang tidak synchronized.

### 20.3 Redeploy Leak

Skenario:

- Context attribute menyimpan executor.
- Executor thread menjalankan task dengan context classloader webapp.
- `contextDestroyed` tidak shutdown executor.
- Redeploy membuat classloader baru.
- Classloader lama tertahan.

Mitigasi:

- shutdown executor,
- cancel scheduled tasks,
- close clients,
- deregister drivers/listeners jika manual,
- remove context attributes,
- avoid static mutable global.

### 20.4 Cross-User State Leak

Skenario:

- Developer menyimpan current user di `ServletContext`.
- Request user B overwrite user A.
- Request user A melanjutkan proses dan membaca user B.

Mitigasi:

- user-specific state hanya di request/session/security context,
- application scope hanya untuk shared app state,
- audit semua `context.setAttribute`.

### 20.5 Cluster Inconsistency

Skenario:

- Feature flag disimpan di `ServletContext`.
- Pod A sudah update, pod B belum.
- User mengalami behavior berbeda tergantung load balancer.

Mitigasi:

- external config store,
- polling refresh dengan version,
- distributed cache jika tepat,
- publish/subscribe invalidation,
- rollout strategy jelas.

### 20.6 Resource Path Failure

Skenario:

- Kode menggunakan `getRealPath`.
- Di local Tomcat exploded WAR berhasil.
- Di production executable JAR/nested WAR hasil `null`.

Mitigasi:

- gunakan stream API,
- jangan asumsikan file system,
- test packaging mode production.

---

## 21. Design Rules for Top-Tier Engineers

### Rule 1 — Treat `ServletContext` as Boundary, Not Bucket

Jangan simpan apa saja di context. Setiap attribute harus punya:

- owner,
- key konstan,
- tipe jelas,
- lifecycle jelas,
- cleanup jelas,
- concurrency story jelas.

### Rule 2 — Application Scope Is Not Distributed Scope

`ServletContext` hanya local terhadap webapp instance di JVM itu.

Jika butuh lintas pod/node:

- database,
- Redis,
- message broker,
- distributed config,
- service registry,
- external session store.

### Rule 3 — Avoid User State in Application Scope

User state belongs to:

- request,
- session,
- security context,
- external state store,
- domain database.

Tidak di `ServletContext`.

### Rule 4 — Prefer Immutable Objects

Jika object application-wide bisa immutable, buat immutable.

Buruk:

```java
context.setAttribute("config", mutableMap);
```

Baik:

```java
context.setAttribute("config", new ImmutableAppConfig(...));
```

### Rule 5 — Close What You Open

Jika listener membuka:

- executor,
- scheduler,
- HTTP client,
- DB client manual,
- file watcher,
- message consumer,
- metrics reporter,
- background worker,

maka `contextDestroyed` harus menutupnya.

### Rule 6 — Avoid `getRealPath` for Packaged Resources

Gunakan stream-based resource loading.

### Rule 7 — Understand Classloader Ownership

Sebelum menyimpan object long-lived, tanya:

```text
Classloader mana yang memuat object ini?
Siapa yang mereferensikan object ini?
Apakah reference itu bisa hidup melewati redeploy?
```

### Rule 8 — Do Not Use ServletContext as Service Locator if DI Exists

Jika Spring/CDI tersedia, gunakan DI. `ServletContext` boleh menjadi integration bridge, bukan primary dependency mechanism.

### Rule 9 — Log Context Metadata at Startup

Startup log minimal:

- context path,
- server info,
- Servlet API version,
- app version,
- active profile/environment,
- relevant feature flags,
- resource availability.

Jangan log secret.

### Rule 10 — Make Failure Explicit

Jika required context resource/attribute tidak ada, fail fast.

Buruk:

```java
Object obj = context.getAttribute("runtime");
// later NullPointerException
```

Baik:

```java
AppRuntime runtime = (AppRuntime) context.getAttribute(ContextKeys.APP_RUNTIME);
if (runtime == null) {
    throw new IllegalStateException("Missing AppRuntime in ServletContext");
}
```

---

## 22. Production Checklist

Gunakan checklist ini saat review aplikasi servlet/container.

### 22.1 ServletContext Attributes

- [ ] Semua attribute key collision-resistant.
- [ ] Tidak ada key generic seperti `config`, `service`, `user`, `data`.
- [ ] Tidak ada request/response/session disimpan di context.
- [ ] Object mutable punya concurrency strategy.
- [ ] Object besar punya eviction/limit atau tidak disimpan di context.
- [ ] Object resource punya cleanup di shutdown.
- [ ] Attribute di-remove saat `contextDestroyed` jika appropriate.

### 22.2 Init Parameters

- [ ] Init parameter hanya untuk config startup sederhana.
- [ ] Tidak ada secret hardcoded di `web.xml`.
- [ ] Tidak ada asumsi init parameter bisa berubah runtime.
- [ ] Config modern dikelola sistem config yang tepat.

### 22.3 Resource Loading

- [ ] Tidak ada penggunaan `getRealPath` untuk resource packaged kecuali benar-benar perlu.
- [ ] Resource dibaca via stream.
- [ ] Missing resource fail fast.
- [ ] Path resource diawali `/` untuk `ServletContext` resource.
- [ ] Secret tidak dipaketkan sembarangan ke WAR.

### 22.4 Classloader and Redeploy

- [ ] Tidak ada thread custom tanpa shutdown.
- [ ] Tidak ada scheduler custom tanpa shutdown.
- [ ] Tidak ada static mutable registry tanpa lifecycle control.
- [ ] Tidak ada library aplikasi diletakkan di shared container lib tanpa alasan kuat.
- [ ] Tidak ada API jar Servlet/Jakarta EE yang bentrok di `WEB-INF/lib` jika container menyediakan.

### 22.5 Multi-Node Runtime

- [ ] Tidak ada asumsi context attribute tersebar antar pod.
- [ ] Feature flag/cache yang harus konsisten punya external source/invalidation.
- [ ] Local registry diberi nama local, bukan global.
- [ ] Health/readiness tidak bergantung pada state yang bisa stale tanpa validasi.

### 22.6 Reverse Proxy Context

- [ ] Redirect tidak hardcode context path.
- [ ] Absolute URL memahami forwarded headers.
- [ ] Public prefix dan internal context path terdokumentasi.
- [ ] SPA fallback tidak merusak static resource/API mapping.

---

## 23. Debugging Playbook

### Problem: Resource Not Found di Production

Gejala:

```text
Template not found: /WEB-INF/templates/email.html
```

Cek:

1. Apakah file benar masuk artifact WAR/JAR?
2. Apakah path diawali `/`?
3. Apakah case-sensitive path berbeda antara Windows local dan Linux production?
4. Apakah resource berada di `WEB-INF/classes` tapi dibaca via `ServletContext` path salah?
5. Apakah packaging embedded mengubah layout?
6. Apakah kode memakai `getRealPath` dan hasilnya `null`?

Solusi:

- inspect artifact,
- gunakan `getResourceAsStream`,
- fail fast startup,
- tambahkan test packaging.

### Problem: Attribute Null Saat Servlet Init

Gejala:

```text
IllegalStateException: Missing AppRuntime in ServletContext
```

Cek:

1. Listener terdaftar atau tidak?
2. Listener startup gagal sebelumnya?
3. Urutan initialization salah?
4. Servlet `loadOnStartup` terlalu awal?
5. Attribute key typo?
6. Namespace `javax`/`jakarta` mismatch sehingga listener tidak dikenali?

Solusi:

- gunakan constant key,
- log startup listener,
- fail fast dengan pesan jelas,
- cek deployment descriptor/annotation scanning.

### Problem: Memory Naik Setelah Redeploy

Cek:

1. Thread dump: ada thread dari webapp lama?
2. Scheduled executor belum berhenti?
3. JDBC driver/manual resource belum deregister?
4. Static map di shared library?
5. Context attribute besar tidak dihapus?
6. Logging/MBean/listener external masih refer object webapp?

Solusi:

- implement cleanup,
- avoid static mutable state,
- close resource,
- remove attributes,
- gunakan profiler/classloader leak detection.

### Problem: Behavior Berbeda Antar Pod

Cek:

1. Apakah state disimpan di `ServletContext`?
2. Apakah config refresh hanya terjadi di satu pod?
3. Apakah load balancer sticky?
4. Apakah pod menjalankan app version berbeda?
5. Apakah cache local invalidation hilang?

Solusi:

- pindahkan source of truth ke external store,
- tambahkan versioned config,
- expose diagnostics endpoint internal,
- gunakan rollout strategy konsisten.

---

## 24. Common Anti-Patterns

### 24.1 The Global Garbage Bag

```java
context.setAttribute("a", a);
context.setAttribute("b", b);
context.setAttribute("c", c);
context.setAttribute("temp", temp);
context.setAttribute("currentUser", user);
```

Masalah:

- tidak ada ownership,
- tidak ada lifecycle,
- tidak ada concurrency model,
- raw cast tersebar,
- mudah bocor.

### 24.2 ServletContext as Database

```java
Map<Long, CaseRecord> cases = new HashMap<>();
context.setAttribute("cases", cases);
```

Masalah:

- data hilang saat restart,
- tidak cluster-safe,
- tidak durable,
- race condition,
- memory leak.

### 24.3 ServletContext as Session Store

```java
context.setAttribute("cart:" + userId, cart);
```

Masalah:

- user data application-wide,
- tidak timeout per session,
- tidak invalidated saat logout,
- tidak cluster-safe,
- memory leak.

### 24.4 `getRealPath` Everywhere

```java
File file = new File(context.getRealPath("/WEB-INF/config.yml"));
```

Masalah:

- tidak portable,
- null di packaging tertentu,
- read-only filesystem,
- cloud/container mismatch.

### 24.5 Shared Library Overuse

Meletakkan business jar di container shared lib agar banyak WAR bisa pakai.

Masalah:

- version conflict,
- deployment coupling,
- classloader leak,
- upgrade sulit,
- rollback sulit.

Lebih baik:

- package dependency per WAR,
- atau jadikan shared capability sebagai service dengan API jelas.

---

## 25. Advanced Mental Model: Context as Runtime State Machine

Satu web application dapat dilihat sebagai state machine:

```text
NEW
  ↓
DISCOVERING
  - scan descriptors
  - scan annotations
  - find initializers/listeners
  ↓
INITIALIZING
  - create ServletContext
  - apply context params
  - call initializers
  - call context listeners
  - register servlets/filters/listeners
  - load-on-startup servlets
  ↓
AVAILABLE
  - accept requests
  - dispatch to filters/servlets
  - manage sessions
  - serve resources
  ↓
STOPPING
  - stop accepting new work for context
  - destroy servlets/filters
  - call contextDestroyed
  - cleanup sessions/resources
  ↓
DESTROYED
  - release classloader references
  - eligible for GC
```

`ServletContext` exists mainly from initialization to destruction.

Kesalahan desain sering terjadi ketika aplikasi memperlakukan state `AVAILABLE` seolah-olah abadi dan lupa bahwa `STOPPING`/`DESTROYED` harus bersih.

Top-tier engineer selalu memikirkan:

```text
Apa yang terjadi saat startup gagal?
Apa yang terjadi saat rolling restart?
Apa yang terjadi saat redeploy?
Apa yang terjadi saat node menerima SIGTERM?
Apa yang terjadi saat request masih berjalan saat context stopping?
Apa yang terjadi pada background thread?
Apa yang terjadi pada context attributes?
Apa yang terjadi pada classloader lama?
```

---

## 26. Relation to ServletContextListener

Part sebelumnya membahas listener. Sekarang kita hubungkan:

```text
ServletContextListener
  = lifecycle callback

ServletContext
  = runtime object yang diamati/dimodifikasi pada callback tersebut
```

Contoh:

```java
@Override
public void contextInitialized(ServletContextEvent event) {
    ServletContext context = event.getServletContext();
    // initialize application-wide resources
}
```

Listener tanpa pemahaman `ServletContext` akan menjadi tempat random startup code. `ServletContext` tanpa lifecycle discipline akan menjadi global bucket.

Keduanya harus dipakai bersama sebagai:

```text
explicit application lifecycle management boundary
```

---

## 27. Relation to Filters and Servlets

Servlet dan filter dapat mengakses `ServletContext`.

Dari servlet:

```java
ServletContext context = getServletContext();
```

Dari request:

```java
ServletContext context = request.getServletContext();
```

Dari filter config:

```java
public void init(FilterConfig filterConfig) {
    ServletContext context = filterConfig.getServletContext();
}
```

Pola baik:

- filter membaca app-level immutable config saat `init`,
- servlet membaca app runtime facade saat `init`,
- request handling tidak berulang kali mencari/cast global object jika tidak perlu,
- shared object thread-safe.

Pola buruk:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    MutableConfig config = (MutableConfig) req.getServletContext().getAttribute("config");
    config.setLastAccessedBy(req.getParameter("user"));
}
```

---

## 28. Legacy Java EE `javax.*` vs Jakarta `jakarta.*`

Konsep `ServletContext` sama, tetapi package berubah.

Java EE / Servlet 3.x/4.x:

```java
import javax.servlet.ServletContext;
import javax.servlet.ServletContextEvent;
import javax.servlet.ServletContextListener;
import javax.servlet.annotation.WebListener;
```

Jakarta EE / Servlet 5+:

```java
import jakarta.servlet.ServletContext;
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;
```

Migration caveat:

- Jangan campur `javax.servlet.*` dan `jakarta.servlet.*` dalam satu aplikasi modern Jakarta runtime.
- Tomcat 9 = Java EE/`javax` generation.
- Tomcat 10+ = Jakarta/`jakarta` generation.
- Spring Boot 2 = mostly `javax` generation.
- Spring Boot 3 = Jakarta baseline.

Jika listener/servlet tidak terpanggil setelah migration, salah satu root cause umum adalah package mismatch atau dependency Servlet API yang salah.

---

## 29. Java 8 sampai Java 25 Relevance

`ServletContext` sendiri adalah API Servlet/Jakarta, bukan fitur Java language. Namun runtime Java memengaruhi cara kita menulis resource/lifecycle code.

### Java 8

- Tidak ada `InputStream#readAllBytes`.
- Tidak ada `String#isBlank`.
- Banyak legacy Java EE app masih Java 8.
- WAR external container sangat umum.

### Java 9+

- Module system hadir, tetapi kebanyakan servlet app tetap classpath/WAR-based.
- `InputStream#readAllBytes` tersedia.

### Java 11+

- Banyak baseline server modern pindah ke Java 11.
- HTTP client standar tersedia, tetapi bukan fokus `ServletContext`.

### Java 17+

- Banyak Jakarta EE 10/Spring Boot 3 deployment memakai Java 17 baseline.
- Records bisa dipakai untuk immutable app metadata/config jika baseline mengizinkan.

Contoh Java 17+:

```java
public record AppMetadata(String name, String version, Instant startedAt) {}
```

Untuk Java 8:

```java
public final class AppMetadata {
    private final String name;
    private final String version;
    private final Instant startedAt;

    public AppMetadata(String name, String version, Instant startedAt) {
        this.name = name;
        this.version = version;
        this.startedAt = startedAt;
    }

    public String name() { return name; }
    public String version() { return version; }
    public Instant startedAt() { return startedAt; }
}
```

### Java 21+

- Virtual threads dapat mengubah strategy executor/background work.
- Namun lifecycle tetap harus ditutup.
- Jangan membuat virtual thread executor di context tanpa shutdown.

Contoh:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
context.setAttribute("com.example.executor", executor);
```

Tetap harus:

```java
executor.shutdown();
```

### Java 25 Context

- Server-side Java modern makin condong ke explicit lifecycle, observability, structured concurrency, dan virtual-thread-aware runtime.
- Tetapi ServletContext tetap application boundary webapp, bukan distributed state manager.

---

## 30. Practice Exercise

### Exercise 1 — Audit Context Attribute Usage

Cari semua penggunaan:

```text
getServletContext().setAttribute
getServletContext().getAttribute
ServletContext#setAttribute
ServletContext#getAttribute
```

Untuk tiap attribute, tulis:

| Key | Type | Owner | Mutable? | Thread-safe? | Cleanup? | User-specific? | Cluster-safe assumption? |
|---|---|---|---|---|---|---|---|

Jika ada user-specific attribute di context, itu bug serius.

### Exercise 2 — Replace `getRealPath`

Cari semua:

```text
getRealPath
```

Kategorikan:

| Usage | Packaged resource? | External filesystem? | Can be stream? | Risk |
|---|---|---|---|---|

Ubah packaged resource menjadi `getResourceAsStream`.

### Exercise 3 — Startup/Shutdown Failure Model

Untuk setiap listener:

1. Apa resource yang dibuat?
2. Apa yang terjadi jika resource ke-3 gagal dibuat?
3. Apakah resource ke-1 dan ke-2 ditutup?
4. Apakah `contextDestroyed` idempotent?
5. Apakah thread custom berhenti?
6. Apakah attribute dihapus?

### Exercise 4 — Multi-Pod Reality Check

Untuk setiap state application-wide:

1. Apakah harus sama di semua pod?
2. Jika ya, mengapa disimpan di local memory?
3. Apa source of truth-nya?
4. Bagaimana invalidation/refresh?
5. Apa yang terjadi saat rolling update?

---

## 31. Ringkasan

`ServletContext` adalah object penting yang sering disepelekan.

Ia adalah:

- representasi runtime dari satu web application,
- boundary antara application code dan servlet container,
- tempat membaca context path/init parameter/resource,
- tempat menyimpan application-wide attribute secara terbatas,
- surface untuk dynamic registration,
- bagian penting dari lifecycle startup/shutdown,
- titik rawan classloader leak dan global state misuse.

Mental model yang harus tertanam:

```text
ServletContext bukan global variable.
ServletContext adalah application boundary milik satu webapp di satu runtime container.
```

Gunakan untuk:

- metadata aplikasi,
- immutable config snapshot,
- runtime facade yang lifecycle-nya jelas,
- resource loading webapp,
- container/framework integration.

Jangan gunakan untuk:

- user state,
- request state,
- distributed state,
- database sementara,
- service locator liar,
- mutable global map tanpa concurrency control,
- resource yang tidak pernah ditutup.

Engineer yang kuat tidak hanya tahu cara memanggil `getServletContext()`. Ia tahu konsekuensi dari setiap object yang disimpan di dalamnya terhadap concurrency, lifecycle, deployment, classloading, memory, observability, dan cluster behavior.

---

## 32. Apa Selanjutnya?

Part berikutnya:

```text
Part 012 — Session Management: HttpSession Deep Dive
```

Kita akan membahas `HttpSession`, `JSESSIONID`, session tracking, timeout, invalidation, session fixation, sticky session, replicated session, external session store, session bloat, concurrency antar request dalam session yang sama, logout race, dan production failure model.

Seri belum selesai. Ini adalah Part 011 dari 031.
