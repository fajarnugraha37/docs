# Learn Java Jakarta Security Authentication Authorization Identity

## Part 03 — Container Security Architecture

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-03-container-security-architecture.md`  
> Target: Java 8 sampai Java 25, Java EE / Jakarta EE, `javax.*` sampai `jakarta.*`  
> Fokus: memahami arsitektur container security sebagai enforcement boundary, bukan hanya hafal annotation atau API.

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas sejarah layer security Java/Jakarta: JAAS, JASPIC/Jakarta Authentication, JACC/Jakarta Authorization, Java EE Security, dan Jakarta Security.

Part ini menjawab pertanyaan yang lebih fundamental:

> Ketika sebuah request masuk ke aplikasi Jakarta/Java EE, siapa sebenarnya yang mengamankan request itu?

Jawaban pendeknya: **container**.

Tetapi jawaban itu sering disalahpahami. Banyak developer mengira security hanya berada di:

- filter buatan sendiri,
- interceptor buatan sendiri,
- pengecekan `if (user.hasRole(...))`,
- validasi JWT manual,
- annotation `@RolesAllowed`,
- atau login page.

Padahal dalam aplikasi enterprise Java/Jakarta, security adalah gabungan dari beberapa lapisan:

```text
Client / Browser / API Caller
        |
        v
Network / TLS / Reverse Proxy / Load Balancer
        |
        v
Servlet Container
        |
        +--> Authentication Mechanism
        |        |
        |        +--> Identity Store / IdP / Realm
        |
        +--> Security Context Establishment
        |
        +--> URL / Method / Component Authorization
        |
        v
JAX-RS / Servlet / CDI / EJB / Application Code
        |
        v
Domain Authorization / Database / Downstream Services
```

Part ini akan membangun mental model bahwa **container security bukan sekadar API**, melainkan **runtime contract**: siapa caller saat ini, bagaimana identity dibentuk, bagaimana role diterjemahkan, bagaimana constraint ditegakkan, bagaimana context dipropagasikan, dan bagaimana enforcement bisa gagal.

---

## 1. Apa Itu Container dalam Enterprise Java?

Dalam Java/Jakarta EE, aplikasi tidak berjalan sendirian seperti program `main()` sederhana. Aplikasi berjalan di dalam **container**.

Container adalah runtime yang menyediakan layanan standar untuk aplikasi:

- lifecycle management,
- dependency injection,
- servlet dispatching,
- transaction management,
- security management,
- JNDI/resource injection,
- concurrency management,
- session management,
- deployment descriptor processing,
- annotation scanning,
- policy enforcement,
- integration dengan app server.

Contoh container/server:

- WildFly / JBoss EAP,
- Payara / GlassFish,
- Open Liberty / WebSphere Liberty,
- TomEE,
- WebLogic,
- Tomcat untuk servlet-centric workload,
- Jetty untuk servlet-centric workload,
- embedded container di Spring Boot meskipun model security-nya sering framework-managed.

Dalam konteks security, container adalah pihak yang dapat menjawab:

```java
request.getUserPrincipal();
request.isUserInRole("ADMIN");
securityContext.getCallerPrincipal();
securityContext.isCallerInRole("MANAGER");
```

Artinya, security identity bukan hanya objek yang dibuat oleh business code. Identity harus dikenali oleh runtime yang mengeksekusi aplikasi.

---

## 2. Security sebagai Runtime Contract

Security container adalah kontrak antara:

1. **Application developer**  
   Menulis annotation, descriptor, authentication mechanism, identity store, filter, endpoint, service, policy code.

2. **Application deployer/operator**  
   Mengatur realm, role mapping, keystore/truststore, IdP metadata, app server feature, environment secret, TLS, session, cookie, datasource.

3. **Container**  
   Memproses metadata, memanggil authentication mechanism, menyimpan caller identity, mengevaluasi constraint, meneruskan context ke komponen.

4. **Identity provider / identity store**  
   Menyediakan credential validation, user identity, group, claim, attribute.

5. **Application domain layer**  
   Mengevaluasi authorization yang bergantung pada resource, state, tenant, assignment, dan business rule.

Security yang robust muncul kalau kelima pihak ini punya kontrak yang konsisten.

Security yang rapuh muncul kalau masing-masing layer membuat definisi sendiri tentang “siapa user saat ini” dan “apa yang boleh dilakukan”.

---

## 3. The Core Container Security Pipeline

Untuk aplikasi web Jakarta, pipeline konseptualnya seperti ini:

```text
[1] Request masuk
    |
[2] Container menentukan target aplikasi/context
    |
[3] Container mengevaluasi apakah resource dilindungi
    |
[4] Jika perlu, container memulai authentication
    |
[5] Authentication mechanism memperoleh credential
    |
[6] Credential divalidasi ke identity store / realm / IdP
    |
[7] Caller principal dan group/role dibentuk
    |
[8] Security context disimpan pada request/session/container context
    |
[9] Container mengevaluasi authorization constraint
    |
[10] Request diteruskan ke servlet/filter/JAX-RS/CDI/EJB
    |
[11] Application melakukan domain authorization tambahan
    |
[12] Audit/log/response
```

Hal penting: **authentication dan authorization bukan satu event tunggal**.

Authentication bisa terjadi:

- sebelum resource diakses,
- saat explicit `request.authenticate()` dipanggil,
- saat `request.login()` dipanggil,
- saat OIDC callback diproses,
- saat token bearer divalidasi,
- saat session existing di-resume.

Authorization bisa terjadi:

- di URL constraint,
- di servlet annotation,
- di JAX-RS resource,
- di EJB/CDI method security,
- di custom interceptor,
- di domain service,
- di query/database layer,
- di downstream service.

Top-level engineer tidak bertanya “di mana security check-nya?” saja. Ia bertanya:

> Enforcement boundary mana yang menjamin akses ditolak kalau layer lain lupa melakukan check?

---

## 4. Container-Managed vs Application-Managed Security

Ada dua pendekatan besar.

### 4.1 Container-Managed Security

Container-managed security berarti aplikasi menggunakan kontrak security container.

Contoh:

```java
@RolesAllowed("ADMIN")
public void approveSomething() {
    ...
}
```

atau:

```java
if (securityContext.isCallerInRole("SUPERVISOR")) {
    ...
}
```

atau:

```java
Principal principal = request.getUserPrincipal();
```

Dalam model ini, identity harus terpasang ke container. Bukan sekadar tersimpan di `ThreadLocal` custom.

Keuntungan:

- annotation security bisa bekerja,
- container tahu siapa caller,
- Servlet/JAX-RS/EJB/CDI bisa berbagi security identity,
- audit bisa lebih konsisten,
- aplikasi lebih portable jika mengikuti specification,
- deployment descriptor bisa ikut mengontrol security.

Risiko:

- konfigurasi container berbeda antar vendor,
- debugging bisa lebih sulit,
- role mapping bisa tersembunyi di deployment/server config,
- custom authentication harus benar-benar mengisi caller identity ke container.

### 4.2 Application-Managed Security

Application-managed security berarti aplikasi mengurus sendiri authentication dan authorization.

Contoh:

```java
User user = authService.validateToken(token);
CurrentUserHolder.set(user);
```

atau:

```java
if (!currentUser.hasPermission("CASE_APPROVE")) {
    throw new ForbiddenException();
}
```

Keuntungan:

- fleksibel,
- cocok untuk domain authorization kompleks,
- mudah dipakai di framework non-Jakarta,
- kontrol penuh terhadap policy.

Risiko:

- container tidak tahu caller,
- `@RolesAllowed` bisa tidak bekerja,
- `request.getUserPrincipal()` bisa `null`,
- security context bisa hilang di async/thread switch,
- risk duplikasi logic,
- mudah terjadi bypass bila satu endpoint lupa check.

### 4.3 Model yang Realistis

Dalam enterprise system, biasanya yang paling benar bukan memilih salah satu secara ekstrem, tetapi menggabungkan:

```text
Container-managed authentication + coarse authorization
        +
Application-managed domain authorization
```

Contoh:

- Container memastikan hanya authenticated officer yang bisa masuk `/case/*`.
- `@RolesAllowed("CASE_OFFICER")` memastikan hanya officer role yang bisa invoke service tertentu.
- Domain authorization memastikan officer tersebut memang assigned ke case tersebut, berada dalam tenant yang benar, dan state case mengizinkan action.

---

## 5. Container sebagai Enforcement Boundary

**Enforcement boundary** adalah titik di mana sistem benar-benar bisa menghentikan akses.

Tidak semua security check adalah enforcement boundary yang kuat.

Contoh lemah:

```text
Frontend menyembunyikan tombol Approve
```

Ini bukan enforcement boundary. Caller masih bisa memanggil API langsung.

Contoh lebih kuat:

```text
Backend endpoint /cases/{id}/approve mengecek permission sebelum state berubah
```

Ini enforcement boundary.

Contoh lebih kuat lagi:

```text
Backend service mengecek permission, database query juga membatasi tenant_id, audit merekam actor, dan transaction menjamin state tidak berubah bila authorization gagal
```

Dalam Jakarta application, container bisa menjadi enforcement boundary untuk:

- URL access,
- HTTP method access,
- transport guarantee,
- servlet dispatch,
- method invocation,
- EJB invocation,
- application role checks,
- integration ke policy provider.

Tetapi container **tidak otomatis memahami business resource** seperti:

- case assigned officer,
- tenant ownership,
- current workflow state,
- maker-checker conflict,
- conflict of interest,
- delegation window,
- emergency override reason.

Maka container security adalah fondasi, bukan akhir.

---

## 6. Web Container Security

Web container bertanggung jawab atas HTTP request/response lifecycle.

Dalam Servlet/Jakarta Servlet, web container menangani:

- servlet mapping,
- filter chain,
- session,
- security constraint,
- login mechanism,
- role check,
- request principal,
- async dispatch,
- error dispatch.

Security web container bisa dikonfigurasi lewat:

- `web.xml`,
- annotation seperti `@ServletSecurity`,
- Jakarta Security annotation seperti `@BasicAuthenticationMechanismDefinition`, `@FormAuthenticationMechanismDefinition`, `@OpenIdAuthenticationMechanismDefinition`,
- app server realm config,
- deployment-specific role mapping.

### 6.1 URL-Level Constraint

Contoh `web.xml` konseptual:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin Area</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
        <http-method>GET</http-method>
        <http-method>POST</http-method>
    </web-resource-collection>

    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>

    <user-data-constraint>
        <transport-guarantee>CONFIDENTIAL</transport-guarantee>
    </user-data-constraint>
</security-constraint>
```

Maknanya:

- URL `/admin/*` dilindungi,
- hanya caller dengan role `ADMIN` boleh akses,
- transport harus confidential, biasanya HTTPS.

### 6.2 Annotation-Level Constraint

Contoh:

```java
@ServletSecurity(
    value = @HttpConstraint(
        rolesAllowed = {"ADMIN"},
        transportGuarantee = TransportGuarantee.CONFIDENTIAL
    )
)
public class AdminServlet extends HttpServlet {
    ...
}
```

Annotation ini bukan hanya dokumentasi. Container membaca annotation dan membentuk security metadata.

### 6.3 Default Semantics yang Sering Dilupakan

Dalam web security, default bisa berbahaya.

Beberapa prinsip:

1. Resource yang tidak diberi constraint bisa saja public.
2. Constraint tanpa role bisa bermakna deny-all untuk constrained request.
3. Method tertentu bisa tidak terlindungi kalau constraint hanya mendefinisikan method tertentu.
4. Pattern matching URL bisa menghasilkan gap.
5. Error page dan static resources sering lupa diklasifikasikan.

Design rule:

> Jangan asumsikan endpoint aman karena berada di aplikasi yang “sudah login”. Definisikan public/private/admin boundary secara eksplisit.

---

## 7. Authentication Mechanism sebagai Bridge Caller ↔ Container

Authentication mechanism adalah komponen yang menjawab:

> Bagaimana credential dari caller diterjemahkan menjadi caller identity yang diakui container?

Di Jakarta Security, konsep ini muncul sebagai `HttpAuthenticationMechanism`.

Authentication mechanism bisa menangani:

- Basic auth,
- form login,
- custom form login,
- OpenID Connect,
- bearer token,
- client certificate,
- custom enterprise SSO,
- gateway-authenticated caller.

Secara konseptual:

```text
HTTP request
    |
    v
HttpAuthenticationMechanism
    |
    +--> baca Authorization header / cookie / form / cert / callback
    |
    +--> validasi credential
    |
    +--> hasilkan caller principal + groups
    |
    v
Container security context
```

### 7.1 Kesalahan Umum

Custom authentication sering gagal karena hanya melakukan ini:

```java
User user = userService.validate(username, password);
session.setAttribute("user", user);
```

Secara aplikasi, ini terlihat berhasil. Tetapi container tidak tahu caller.

Akibat:

```java
request.getUserPrincipal(); // null
request.isUserInRole("ADMIN"); // false
securityContext.getCallerPrincipal(); // null atau tidak konsisten
@RolesAllowed("ADMIN") // tidak bekerja sesuai harapan
```

Kalau ingin container-managed authorization bekerja, authentication mechanism harus mengembalikan identity ke container melalui kontrak yang benar.

---

## 8. Identity Store dan Realm

Container perlu tahu dari mana user divalidasi dan group/role diperoleh.

Ada beberapa istilah yang mirip:

| Istilah | Makna Praktis |
|---|---|
| Identity Store | Komponen Jakarta Security yang memvalidasi credential dan/atau mengambil group |
| Realm | Konfigurasi container/app server untuk security domain/user registry |
| User Registry | Registry user/group di server, LDAP, file, database, dsb |
| IdP | Identity Provider external seperti OIDC/SAML provider |
| Directory | LDAP/AD-style store |
| Policy Store | Penyimpanan authorization policy/permission |

### 8.1 Identity Store dalam Jakarta Security

Identity store dapat dianggap seperti DAO khusus security. Ia dapat mengakses data security aplikasi seperti users, groups, roles, dan permissions.

Contoh konseptual:

```java
@ApplicationScoped
public class DatabaseIdentityStore implements IdentityStore {

    @Override
    public CredentialValidationResult validate(Credential credential) {
        UsernamePasswordCredential up = (UsernamePasswordCredential) credential;

        Optional<UserRecord> user = userRepository.findByUsername(up.getCaller());
        if (user.isEmpty()) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        if (!passwordHasher.verify(up.getPasswordAsString(), user.get().passwordHash())) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        Set<String> groups = groupRepository.findGroups(user.get().id());

        return new CredentialValidationResult(
            new CallerPrincipal(user.get().username()),
            groups
        );
    }
}
```

Catatan penting: contoh di atas adalah bentuk konseptual. Implementasi production perlu memperhatikan password hashing, timing, lockout, audit, rate limiting, dan error handling.

### 8.2 Realm Container

Realm biasanya lebih vendor-specific.

Contoh bentuk konfigurasi yang bisa berbeda:

- file realm,
- JDBC realm,
- LDAP realm,
- OIDC realm,
- custom security realm,
- application security domain.

Masalah portability sering muncul di sini. API Jakarta memberi kontrak umum, tetapi server tetap punya mekanisme konfigurasi sendiri.

---

## 9. Security Context: Hasil Akhir yang Terlihat Application Code

Security context adalah view aplikasi terhadap caller saat ini.

Di Jakarta Security:

```java
@Inject
SecurityContext securityContext;

public void handle() {
    Principal principal = securityContext.getCallerPrincipal();
    boolean admin = securityContext.isCallerInRole("ADMIN");
}
```

Di Servlet:

```java
Principal principal = request.getUserPrincipal();
boolean admin = request.isUserInRole("ADMIN");
```

Mental model:

```text
Authentication mechanism + identity store + container realm
        |
        v
Container establishes caller identity
        |
        v
SecurityContext / HttpServletRequest / EJBContext expose it
```

Security context seharusnya menjawab pertanyaan:

1. Apakah caller sudah authenticated?
2. Siapa caller-nya?
3. Role apa yang dimiliki caller dalam aplikasi ini?
4. Apakah caller boleh melakukan operasi tertentu?

Tetapi SecurityContext bukan pengganti domain model.

Jangan membuat business logic seperti ini untuk semua hal:

```java
if (securityContext.isCallerInRole("OFFICER")) {
    approve(caseId);
}
```

Karena `OFFICER` belum tentu:

- assigned ke case tersebut,
- berada dalam tenant yang sama,
- tidak sedang conflict of interest,
- tidak menjadi maker untuk case yang sama,
- boleh approve pada state saat ini.

SecurityContext memberi identity dan role. Domain authorization tetap harus mengevaluasi resource-specific permission.

---

## 10. Authorization Metadata: Descriptor, Annotation, Policy

Container authorization biasanya berasal dari metadata:

- `web.xml`,
- annotation servlet,
- annotation Jakarta annotations seperti `@RolesAllowed`, `@PermitAll`, `@DenyAll`,
- EJB deployment descriptor,
- vendor-specific role mapping,
- Jakarta Authorization/JACC policy.

### 10.1 Descriptor-Based Security

Descriptor baik untuk:

- environment-specific configuration,
- centralizing URL constraints,
- legacy applications,
- deployer-controlled policy,
- avoiding recompilation for some deployment mappings.

Kelemahan:

- mudah drift dari code,
- sulit dibaca developer bila tersebar,
- bisa berbeda antar environment.

### 10.2 Annotation-Based Security

Annotation baik untuk:

- dekat dengan code,
- jelas di method/class,
- mudah direview saat code review,
- cocok untuk method-level security.

Kelemahan:

- bisa tersebar,
- inheritance/proxy issue,
- self-invocation bisa bypass pada model interceptor,
- role name hardcoded,
- domain permission kompleks sulit direpresentasikan.

### 10.3 Policy-Based Authorization

Policy-based authorization cocok untuk:

- enterprise central policy,
- auditability,
- dynamic permission,
- regulatory rule,
- cross-application consistency,
- need to explain denial reason.

Kelemahan:

- lebih kompleks,
- caching/policy freshness sulit,
- latency ke PDP,
- debugging lebih berat,
- policy language bisa menjadi “program kedua”.

---

## 11. Jakarta Authorization / JACC dalam Container Architecture

Jakarta Authorization mendefinisikan low-level SPI authorization untuk module yang menyimpan permission dan mendukung subject-based security. Ia juga mendefinisikan algoritma transformasi security constraints dari container seperti Servlet atau Enterprise Beans menjadi permission.

Dalam container architecture, alurnya kira-kira:

```text
Deployment metadata
(web.xml, annotations, EJB descriptors)
        |
        v
Container deployment processor
        |
        v
PolicyConfiguration
        |
        v
Permission set
        |
        v
Policy Provider
        |
        v
Runtime access decision
```

Artinya, saat developer menulis:

```java
@RolesAllowed("ADMIN")
public void deleteUser(String id) { ... }
```

Container bisa mengubah metadata itu menjadi representasi permission internal yang dapat dievaluasi terhadap subject/caller.

Kita tidak harus selalu menulis Jakarta Authorization provider sendiri. Tetapi memahami layer ini penting untuk menjawab:

- kenapa annotation tidak bekerja,
- kenapa role mapping salah,
- kenapa deployment descriptor override annotation,
- kenapa vendor punya file mapping tambahan,
- kenapa security decision terjadi sebelum method masuk.

---

## 12. Jakarta Authentication / JASPIC dalam Container Architecture

Jakarta Authentication adalah low-level SPI untuk authentication mechanisms yang berinteraksi dengan caller dan environment container untuk memperoleh credential, memvalidasi credential, lalu meneruskan identity seperti name dan groups ke container.

Konsep utamanya:

```text
Container receives request
        |
        v
ServerAuthModule.validateRequest(...)
        |
        +--> read credential
        +--> validate credential
        +--> call callbacks to set caller/group
        |
        v
Container receives authenticated Subject
```

`ServerAuthModule` bukan sekadar filter. Ia berada dalam contract dengan container.

Perbedaan penting:

| Custom Servlet Filter | Jakarta Authentication Module |
|---|---|
| Aplikasi sendiri membaca token | Container memanggil module sebagai authentication SPI |
| Bisa hanya menyimpan user di request/session | Mengisi identity ke container lewat callback |
| Portable terbatas | Spec-level SPI, walau vendor details tetap ada |
| Mudah dibuat | Lebih kompleks |
| Risk annotation security tidak terhubung | Terhubung ke container security model |

Kapan perlu Jakarta Authentication langsung?

- integrasi SSO legacy,
- custom protocol authentication,
- gateway-authenticated identity dengan header terpercaya,
- non-standard token exchange,
- perlu menghubungkan custom auth ke container principal/role secara resmi,
- app server-level reusable auth provider.

Untuk banyak aplikasi modern, Jakarta Security `HttpAuthenticationMechanism` lebih nyaman. Tetapi Jakarta Authentication tetap penting sebagai fondasi SPI.

---

## 13. CDI Container dan Security

CDI container bertugas melakukan dependency injection, lifecycle bean, interception, event, qualifier, producer, scope, dan context.

Jakarta Security sangat terhubung dengan CDI. Misalnya `HttpAuthenticationMechanism` harus berupa CDI bean agar visible ke container melalui CDI discovery.

Konsekuensi arsitektural:

1. Authentication mechanism bukan objek random.
2. Identity store bisa CDI bean.
3. SecurityContext bisa di-inject.
4. Custom interceptor security bisa menggunakan CDI.
5. Scope penting: request/application/session scope bisa memengaruhi correctness.

### 13.1 Scope Pitfall

Contoh bug:

```java
@ApplicationScoped
public class CurrentUserCache {
    private User currentUser;
}
```

Ini fatal. `@ApplicationScoped` berarti satu instance untuk aplikasi, bukan per request. User A bisa bocor ke User B.

Lebih aman:

- gunakan `SecurityContext` langsung pada request flow,
- gunakan `@RequestScoped` untuk current request identity,
- jangan menyimpan caller mutable di singleton,
- jangan cache authorization decision tanpa key lengkap.

### 13.2 CDI Interceptor untuk Domain Authorization

Contoh konseptual:

```java
@InterceptorBinding
@Retention(RUNTIME)
@Target({TYPE, METHOD})
public @interface RequiresPermission {
    String value();
}
```

```java
@Interceptor
@RequiresPermission("")
public class PermissionInterceptor {

    @Inject SecurityContext securityContext;
    @Inject AuthorizationService authorizationService;

    @AroundInvoke
    public Object around(InvocationContext ctx) throws Exception {
        RequiresPermission annotation = findAnnotation(ctx);
        Principal caller = securityContext.getCallerPrincipal();

        if (!authorizationService.isAllowed(caller, annotation.value(), ctx.getParameters())) {
            throw new ForbiddenException();
        }

        return ctx.proceed();
    }
}
```

Namun ini hanya aman kalau:

- semua entry point melewati interceptor,
- self-invocation tidak bypass,
- parameter resource bisa di-resolve dengan benar,
- exception handling tidak mengubah denial menjadi success,
- audit tetap terekam.

---

## 14. EJB Container dan Security

Walaupun banyak aplikasi modern mengurangi penggunaan EJB, security model EJB masih penting karena banyak konsep Jakarta EE berasal dari sana.

EJB container mendukung:

- method-level security,
- role-based invocation,
- `@RolesAllowed`,
- `@PermitAll`,
- `@DenyAll`,
- `@RunAs`,
- transaction + security integration,
- remote invocation security.

Contoh:

```java
@Stateless
public class CaseApprovalService {

    @RolesAllowed("CASE_APPROVER")
    public void approve(long caseId) {
        ...
    }
}
```

Container mengecek role sebelum method dijalankan.

### 14.1 Method Invocation Boundary

EJB method call adalah enforcement point jika invocation melewati container proxy.

Tetapi hati-hati dengan self-invocation:

```java
@Stateless
public class CaseService {

    public void entry() {
        approveInternal(); // bisa tidak melewati security interceptor/proxy
    }

    @RolesAllowed("APPROVER")
    public void approveInternal() {
        ...
    }
}
```

Jika call tidak melewati container proxy, annotation bisa tidak ditegakkan seperti yang diasumsikan.

Rule:

> Method security bekerja pada invocation boundary yang dikenali container, bukan pada semua pemanggilan method Java biasa.

---

## 15. JAX-RS Runtime dan Security

JAX-RS berjalan di atas servlet container pada banyak deployment. Security identity biasanya berasal dari web/container context.

Contoh:

```java
@Path("/cases")
public class CaseResource {

    @Context
    SecurityContext jaxrsSecurityContext;

    @GET
    @Path("/{id}")
    @RolesAllowed("CASE_VIEWER")
    public CaseDto getCase(@PathParam("id") long id) {
        ...
    }
}
```

Catatan: JAX-RS punya `jakarta.ws.rs.core.SecurityContext`, sedangkan Jakarta Security punya `jakarta.security.enterprise.SecurityContext`.

Keduanya mirip secara tujuan, tetapi tidak identik.

```text
jakarta.ws.rs.core.SecurityContext
    -> JAX-RS view terhadap request security

jakarta.security.enterprise.SecurityContext
    -> Jakarta Security application-facing programmatic security context
```

### 15.1 JAX-RS Filter vs Container Security

JAX-RS request filter bisa melakukan token validation:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerTokenFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        ...
    }
}
```

Tetapi kalau filter hanya menyimpan user sendiri, container-level role checks belum tentu tahu.

Pilihan desain:

| Pendekatan | Cocok Untuk | Risiko |
|---|---|---|
| JAX-RS filter manual | API sederhana/framework-specific | Tidak otomatis menyatu dengan container roles |
| Servlet filter manual | Cross-JAX-RS/Servlet filtering | Harus hati-hati context propagation |
| Jakarta Security auth mechanism | Jakarta EE portable app security | Butuh pemahaman container contract |
| Jakarta Authentication module | Low-level/custom container auth | Kompleks |

---

## 16. Deployment Descriptor vs Annotation: Siapa Menang?

Enterprise Java mendukung metadata dari banyak sumber.

Sumber security metadata:

```text
Code annotation
Deployment descriptor
App server config
Vendor deployment descriptor
Runtime policy provider
```

Dalam sistem nyata, bug sering muncul karena developer hanya melihat annotation di code, tetapi deployer/server punya mapping berbeda.

Contoh masalah:

```java
@RolesAllowed("ADMIN")
public void dangerousAction() { ... }
```

Tetapi di server:

```text
ADMIN -> mapped to group: all-authenticated-users
```

Maka secara code terlihat aman, tetapi deployment mapping menjadikannya terlalu longgar.

Sebaliknya:

```text
ADMIN -> tidak dimapping ke group mana pun
```

Maka semua user ditolak meskipun token punya claim `admin`.

Design rule:

> Security review tidak cukup membaca source code. Harus membaca deployment descriptor, app server security domain, IdP group mapping, dan runtime config.

---

## 17. Role Declaration dan Role Mapping

Dalam Jakarta/Java EE, role sering perlu dideklarasikan dan dipetakan.

Role di code:

```java
@DeclareRoles({"ADMIN", "CASE_OFFICER", "CASE_APPROVER"})
```

Role di annotation:

```java
@RolesAllowed("CASE_APPROVER")
```

Group dari IdP:

```text
/agency/cea/enforcement/approval-team
```

Mapping:

```text
IdP group /agency/cea/enforcement/approval-team
        -> application role CASE_APPROVER
```

Kesalahan umum:

1. Business code mengecek raw IdP group.
2. Role name berbeda antar environment.
3. Composite role tidak terdokumentasi.
4. Group rename di IdP membuat app authorization rusak.
5. Role mapping dilakukan di banyak tempat sekaligus.
6. Role dianggap permission final.

Role mapping harus diperlakukan sebagai kontrak.

```text
External identity attribute is unstable.
Application role contract should be stable.
Domain permission is contextual.
```

---

## 18. Thread Context dan Security Context

Container sering menyimpan context request/security terkait dengan thread yang sedang memproses request.

Mental model sederhana:

```text
HTTP request assigned to thread T1
        |
        v
Container associates caller identity with T1/request
        |
        v
Application code reads SecurityContext
```

Masalah muncul ketika execution berpindah thread:

- `CompletableFuture.supplyAsync(...)`,
- unmanaged executor,
- servlet async,
- reactive pipeline,
- scheduled job,
- virtual threads,
- callback downstream,
- message listener.

Contoh bahaya:

```java
CompletableFuture.runAsync(() -> {
    securityContext.getCallerPrincipal(); // belum tentu valid
});
```

Kenapa?

Karena async task mungkin berjalan di thread lain yang tidak punya request context/security context.

### 18.1 Identity Lost

User melakukan request sebagai `alice`, lalu async task berjalan tanpa identity.

Akibat:

- audit mencatat `SYSTEM`,
- authorization gagal karena unauthenticated,
- atau lebih buruk, code fallback ke admin/system.

### 18.2 Identity Leak

Thread pool reuse menyebabkan data identity custom `ThreadLocal` tidak dibersihkan.

Akibat:

- request Bob melihat identity Alice,
- audit salah actor,
- authorization bisa bocor.

### 18.3 Rule

> Jangan membuat custom `ThreadLocal` security context kecuali lifecycle capture/restore/clear sangat disiplin dan dites untuk thread reuse.

Dalam Jakarta EE, gunakan managed executor/context propagation mechanism yang sesuai dengan container bila tersedia. Untuk domain job, bedakan jelas antara:

- user-initiated action,
- system-initiated action,
- delegated action,
- on-behalf-of action.

---

## 19. Request Context vs Session Context vs Application Context

Security state bisa hidup di beberapa horizon waktu.

| Context | Lifetime | Cocok untuk | Bahaya |
|---|---:|---|---|
| Request | satu request | current caller, correlation id | hilang di async jika tidak dipropagasi |
| Session | antar request satu login session | login state, CSRF token | stale role, fixation, logout issue |
| Application | sepanjang aplikasi | config, public keys cache | user data leak jika salah scope |
| Transaction | satu unit kerja | authorization snapshot | TOCTOU jika state berubah |
| Token | sampai expiry/revocation | stateless API auth | stale claims, replay |

Rule:

> Semakin panjang lifetime context, semakin besar risiko stale identity/permission.

Contoh:

- Role user dicabut di IdP.
- Session aplikasi masih hidup 8 jam.
- Aplikasi hanya membaca role saat login.
- User tetap punya akses sampai session expire.

Apakah ini bug? Tergantung requirement. Untuk sistem regulasi, sering perlu strategi:

- short session,
- re-check role periodically,
- token expiry pendek,
- back-channel logout,
- role versioning,
- policy cache invalidation,
- step-up auth untuk aksi sensitif.

---

## 20. Filters, Interceptors, Valves, Handlers: Jangan Campur Mental Model

Dalam sistem Java web, ada banyak mekanisme interception.

| Mechanism | Layer | Umum Dipakai Untuk |
|---|---|---|
| Servlet Filter | HTTP before servlet/JAX-RS | CORS, logging, token parse, request wrapping |
| JAX-RS Filter | JAX-RS resource pipeline | API auth, request/response metadata |
| CDI Interceptor | Bean method invocation | domain authorization, audit, transaction-ish cross-cutting |
| EJB Interceptor | EJB invocation | method-level behavior/security |
| Container Valve/Handler | Server-specific lower layer | proxy headers, SSO integration, server auth |
| Jakarta Authentication Module | Container authentication SPI | pluggable authentication |
| Jakarta Security HAM | App-facing HTTP auth mechanism | portable app authentication |

Kesalahan umum adalah menganggap semua interceptor sama.

Contoh:

- Servlet filter tidak otomatis melindungi EJB remote invocation.
- JAX-RS filter tidak melindungi servlet lain.
- CDI interceptor tidak jalan untuk object yang dibuat manual dengan `new`.
- Method annotation tidak jalan jika call tidak melewati proxy/container.
- Valve server-specific tidak portable.

Design rule:

> Pilih enforcement mechanism berdasarkan boundary yang ingin diamankan, bukan berdasarkan API yang paling mudah ditulis.

---

## 21. Transport Security dan Container

Container juga berhubungan dengan transport security.

Dalam descriptor/annotation, bisa ada `transport-guarantee`:

- `NONE`,
- `INTEGRAL`,
- `CONFIDENTIAL`.

Di dunia modern, ini biasanya berarti HTTPS/TLS.

Tetapi deployment cloud sering punya TLS termination di:

- load balancer,
- reverse proxy,
- ingress controller,
- API gateway.

Maka container mungkin menerima HTTP internal, sementara original client memakai HTTPS.

Masalah:

```text
Client --HTTPS--> ALB --HTTP--> App Container
```

Jika container tidak memahami forwarded headers, aplikasi bisa mengira request tidak secure.

Dampak:

- redirect loop HTTP↔HTTPS,
- Secure cookie tidak diset benar,
- generated URL salah scheme,
- OIDC redirect URI mismatch,
- transport guarantee dianggap gagal.

Butuh konfigurasi trust terhadap proxy headers:

- `Forwarded`,
- `X-Forwarded-Proto`,
- `X-Forwarded-Host`,
- `X-Forwarded-Port`.

Namun header ini hanya boleh dipercaya dari proxy terpercaya. Jika internet client bisa mengirim `X-Forwarded-Proto: https` langsung ke app, itu spoofing.

---

## 22. Security Realm dan Environment Boundary

Security realm sering berbeda antar environment:

```text
DEV realm
UAT realm
PROD realm
```

Atau:

```text
internal realm
external realm
admin realm
service-account realm
```

Setiap realm bisa punya:

- user registry berbeda,
- group berbeda,
- role mapping berbeda,
- password policy berbeda,
- certificate trust berbeda,
- IdP client berbeda,
- issuer/audience berbeda.

Kesalahan produksi yang umum:

1. UAT memakai IdP PROD.
2. PROD app menerima token dari DEV issuer.
3. Audience tidak diverifikasi sehingga token untuk app lain diterima.
4. Role mapping UAT berbeda dari PROD.
5. Service account DEV punya akses PROD.
6. Keystore/truststore tertukar.

Rule:

> Security environment harus diperlakukan seperti data boundary, bukan sekadar config profile.

---

## 23. App Server Feature Flags dan Security yang “Diam-diam Mati”

Beberapa app server memerlukan feature tertentu untuk mengaktifkan security.

Contoh mental model:

```text
Servlet API enabled != application security enabled
```

Jika security feature tidak diaktifkan, ada container yang bisa mengabaikan constraint atau tidak memproses security seperti yang diharapkan.

Hal yang perlu dicek saat deployment:

- Apakah Servlet feature aktif?
- Apakah Jakarta Security feature aktif?
- Apakah Jakarta Authentication feature aktif jika custom module dipakai?
- Apakah Jakarta Authorization/JACC feature aktif jika policy provider dipakai?
- Apakah app security feature aktif?
- Apakah realm terhubung?
- Apakah role mapping terdaftar?
- Apakah CDI bean discovery menemukan authentication mechanism?

Production checklist harus mencakup runtime feature, bukan hanya dependency Maven/Gradle.

---

## 24. Classloader Boundary dan Provider Loading

Enterprise Java server punya classloader hierarchy.

Security provider, authentication module, identity store, dan library JWT/OIDC bisa berada di:

- application classloader,
- server/shared library,
- module classloader,
- bootstrap/platform classloader,
- isolated deployment classloader.

Masalah yang bisa muncul:

1. Class tidak ditemukan.
2. Duplicate API jar.
3. `javax.*` dan `jakarta.*` tercampur.
4. Provider didaftarkan di server classloader tetapi dependency ada di app classloader.
5. Version conflict JWT library.
6. CDI tidak menemukan bean karena archive tidak ter-discover.
7. App server menyediakan API, aplikasi juga membundel API versi lain.

Rule praktis:

> Pada Jakarta EE server penuh, biasanya API spec disediakan oleh server. Aplikasi membawa implementation/library aplikatif, tetapi jangan sembarang membundel API container yang konflik.

Untuk migration Java EE 8 ke Jakarta EE 9+, classloader issue sering muncul karena namespace berubah dari `javax.*` ke `jakarta.*`.

---

## 25. Java 8 sampai Java 25: Apa yang Berubah untuk Container Security?

Security architecture Jakarta tidak hanya dipengaruhi versi Jakarta EE, tetapi juga versi Java runtime.

### 25.1 Java 8 Era

Karakter umum:

- Java EE 7/8 banyak masih `javax.*`,
- JAAS/JACC/JASPIC relevan di app server,
- SecurityManager masih ada secara historis,
- TLS/library crypto lebih lama,
- banyak aplikasi menggunakan container session + form login,
- OIDC sering via vendor adapter atau filter/framework.

### 25.2 Java 11/17 Era

Karakter umum:

- Java modularity mulai terasa,
- banyak app server modern baseline Java 11/17,
- Jakarta namespace migration mulai dominan,
- Spring Boot/Jakarta hybrid umum,
- OIDC/JWT makin standar,
- TLS defaults lebih modern.

### 25.3 Java 21 Era

Karakter umum:

- virtual threads tersedia sebagai fitur final,
- concurrency model berubah untuk beberapa workload,
- context propagation semakin penting,
- ThreadLocal assumptions perlu direview,
- structured concurrency/scoped values secara konseptual memengaruhi cara berpikir context.

### 25.4 Java 25 Era

Karakter umum:

- LTS generasi baru setelah Java 21,
- Jakarta EE 11/12 ecosystem bergerak,
- SecurityManager sudah bukan fondasi yang layak untuk application security modern,
- container/provider harus selaras dengan perubahan Java SE security model.

### 25.5 Kesimpulan Versi

Untuk top-level engineer, pertanyaan penting bukan “API apa yang ada di versi X?” saja, tetapi:

1. Apakah container mendukung Java runtime tersebut?
2. Apakah app menggunakan `javax.*` atau `jakarta.*`?
3. Apakah security provider kompatibel?
4. Apakah ThreadLocal/context propagation aman dengan concurrency model baru?
5. Apakah TLS/JWT/OIDC library masih supported?
6. Apakah SecurityManager-dependent legacy code masih berjalan?

---

## 26. Request Lifecycle Detail: Dari Socket sampai Domain Service

Mari susun request lifecycle secara lebih konkret.

### 26.1 Request Masuk dari Client

```text
Browser/API Client
    |
    | HTTPS request
    v
Load Balancer / Reverse Proxy
    |
    | forwarded request
    v
App Server / Servlet Container
```

Security question:

- Apakah TLS valid?
- Apakah client certificate diperlukan?
- Apakah proxy trusted?
- Apakah forwarded headers aman?
- Apakah host header divalidasi?

### 26.2 Container Menentukan Context

Container menentukan:

- aplikasi mana,
- context path mana,
- servlet/filter mapping mana,
- resource static atau dynamic,
- dispatch type.

Security question:

- Apakah URL ini public?
- Apakah static resource sensitif?
- Apakah error page bocor?
- Apakah actuator/admin endpoint ikut terlindungi?

### 26.3 Authentication Trigger

Authentication bisa dipicu oleh:

- security constraint,
- explicit login,
- OIDC callback,
- bearer token presence,
- protected resource access,
- custom mechanism.

Security question:

- Credential diambil dari mana?
- Challenge apa yang dikirim?
- Apakah login endpoint CSRF-safe?
- Apakah redirect URI aman?
- Apakah token divalidasi lengkap?

### 26.4 Identity Establishment

Container menerima:

- caller principal,
- groups,
- maybe subject,
- auth status,
- session info.

Security question:

- Principal stable atau display name?
- Group external langsung dipakai?
- Duplicate identity ditangani?
- Account linking aman?
- Role mapping environment-specific?

### 26.5 Coarse Authorization

Container mengecek:

- URL role,
- method role,
- transport guarantee,
- deny all,
- permit all.

Security question:

- 401 atau 403?
- Default deny?
- Apakah method HTTP semua terlindungi?
- Apakah role mapping benar?

### 26.6 Application Entry

Masuk ke:

- Servlet,
- JAX-RS resource,
- CDI bean,
- EJB bean.

Security question:

- Apakah code mengambil identity dari source yang benar?
- Apakah ada fallback insecure?
- Apakah annotation enforcement benar-benar aktif?

### 26.7 Domain Authorization

Domain service mengecek:

```text
actor + action + resource + tenant + state + relationship + time + delegation
```

Security question:

- Apakah user boleh terhadap resource ini?
- Apakah state mengizinkan?
- Apakah maker-checker dilanggar?
- Apakah tenant isolation dijamin?
- Apakah authorization dilakukan dalam transaction yang aman?

### 26.8 Persistence/Downstream

Security question:

- Query membatasi tenant?
- Downstream menerima identity apa?
- Token propagated atau service account?
- Audit actor tetap jelas?

### 26.9 Response

Security question:

- Error tidak bocor?
- Cookie flags benar?
- Headers aman?
- Cache-control benar untuk sensitive data?
- Audit event terekam?

---

## 27. Trust Boundary Map

Top 1% engineer selalu menggambar trust boundary.

Contoh:

```text
[Untrusted Browser]
        |
        | Internet
        v
[Trusted Edge? ALB/API Gateway]
        |
        | Private network, but not automatically trusted
        v
[Servlet Container]
        |
        | In-process trusted boundary
        v
[Application Domain Services]
        |
        | DB credentials / service calls
        v
[Database / Downstream Systems]
```

Pertanyaan boundary:

1. Siapa boleh mengirim header identity?
2. Di mana TLS berhenti?
3. Di mana token divalidasi?
4. Di mana role mapping dilakukan?
5. Di mana permission final diputuskan?
6. Di mana audit actor ditetapkan?
7. Di mana tenant isolation ditegakkan?
8. Apa yang terjadi jika proxy salah konfigurasi?
9. Apa yang terjadi jika IdP unavailable?
10. Apa yang terjadi jika session/cache stale?

---

## 28. Public, Authenticated, Privileged, System, Internal

Salah satu kesalahan desain adalah hanya punya dua kategori:

```text
public vs logged in
```

Sistem enterprise butuh kategori lebih granular:

| Category | Makna | Contoh |
|---|---|---|
| Public | tidak perlu auth | login page, public metadata |
| Anonymous-sensitive | belum login tapi security-critical | login submit, password reset, OIDC callback |
| Authenticated | user valid tapi belum tentu punya privilege | profile sendiri |
| Role-protected | butuh role aplikasi | admin dashboard |
| Domain-protected | butuh permission resource-specific | approve case tertentu |
| System | dijalankan sistem | scheduler, batch archival |
| Service-to-service | caller adalah service | event syncer, internal API |
| Break-glass | emergency privileged access | override produksi |

Container security biasanya kuat untuk kategori public/authenticated/role-protected. Domain layer harus menangani domain-protected/system/delegation/break-glass.

---

## 29. Security Invariants dalam Container-Based System

Invariant adalah aturan yang harus selalu benar.

Contoh invariants:

1. Tidak ada state-changing endpoint yang bisa diakses anonymous.
2. Semua endpoint admin harus melewati container authorization dan domain audit.
3. Caller identity yang dipakai audit harus berasal dari container/security mechanism resmi, bukan request parameter.
4. External group tidak boleh langsung menjadi permission domain tanpa mapping.
5. Tenant ID dari request tidak boleh dipercaya tanpa verifikasi membership.
6. Authorization harus dilakukan sebelum state mutation.
7. Authorization decision untuk approval harus berada dalam transaction yang membaca state terbaru.
8. Logout harus menghapus local session dan, bila relevan, menyinkronkan IdP logout/revocation strategy.
9. Async task harus memiliki actor semantics eksplisit: user, system, atau delegated.
10. Deny harus fail-closed, bukan fail-open.

Security architecture yang baik dimulai dari invariant, baru turun ke API.

---

## 30. Failure Model Container Security

Sekarang kita pecah kegagalan berdasarkan layer.

### 30.1 Authentication Mechanism Tidak Terdaftar

Gejala:

- login tidak pernah terpanggil,
- request dianggap anonymous,
- protected resource redirect terus,
- `SecurityContext` kosong.

Penyebab:

- CDI bean discovery gagal,
- feature Jakarta Security tidak aktif,
- dependency salah namespace,
- annotation tidak terbaca,
- server tidak mendukung spec versi tersebut.

### 30.2 Identity Store Tidak Dipanggil

Gejala:

- credential selalu invalid,
- group kosong,
- user berhasil login tapi role tidak ada.

Penyebab:

- identity store priority salah,
- credential type tidak cocok,
- bean tidak terdiscover,
- realm berbeda,
- custom mechanism tidak memanggil identity store.

### 30.3 Principal Ada, Role Tidak Ada

Gejala:

```java
getUserPrincipal() != null
isUserInRole("ADMIN") == false
```

Penyebab:

- group tidak dipetakan ke role,
- role name mismatch case-sensitive,
- external claim berbeda,
- deployer mapping salah,
- group prefix tidak sesuai,
- `@DeclareRoles`/descriptor tidak sinkron.

### 30.4 Annotation Tidak Bekerja

Gejala:

- method dengan `@RolesAllowed` bisa dipanggil siapa saja,
- atau selalu ditolak.

Penyebab:

- class bukan managed bean,
- object dibuat dengan `new`,
- self-invocation,
- interceptor tidak aktif,
- EJB/CDI feature tidak aktif,
- annotation di interface tidak diproses sesuai asumsi,
- package `javax.annotation.security` vs `jakarta.annotation.security` mismatch.

### 30.5 Thread Context Hilang

Gejala:

- async code melihat caller null,
- audit actor system,
- authorization random gagal.

Penyebab:

- unmanaged executor,
- ThreadLocal custom tidak dipropagasi,
- request context sudah selesai,
- reactive/virtual thread model tidak compatible dengan asumsi lama.

### 30.6 Header Identity Spoofing

Gejala:

- user bisa menjadi admin dengan mengirim header tertentu.

Penyebab:

- aplikasi percaya `X-User` dari request internet,
- proxy tidak menghapus header inbound,
- app tidak membatasi source IP/internal proxy,
- gateway-auth model tidak punya shared trust boundary.

### 30.7 Policy Drift

Gejala:

- DEV aman, PROD berbeda,
- UAT role lolos, PROD ditolak,
- role removal tidak langsung efektif.

Penyebab:

- role mapping beda environment,
- cache policy stale,
- IdP group renamed,
- session menyimpan old groups,
- deployment descriptor tidak sama.

---

## 31. Debugging Checklist

Saat security Jakarta app bermasalah, jangan langsung edit code. Ikuti urutan diagnosis.

### 31.1 Pertanyaan Layer 1 — Request dan Boundary

- Apakah request sampai ke app yang benar?
- Apakah path/context benar?
- Apakah HTTP method benar?
- Apakah TLS/proxy header benar?
- Apakah cookie terkirim?
- Apakah Authorization header terkirim?

### 31.2 Pertanyaan Layer 2 — Container Feature

- Apakah Servlet/Jakarta Security feature aktif?
- Apakah CDI aktif?
- Apakah Jakarta Authentication/Authorization feature diperlukan dan aktif?
- Apakah app server version mendukung API yang dipakai?
- Apakah `javax`/`jakarta` package cocok?

### 31.3 Pertanyaan Layer 3 — Authentication

- Authentication mechanism terdaftar?
- Mechanism dipanggil?
- Credential dibaca?
- Identity store dipanggil?
- Principal dihasilkan?
- Group dihasilkan?
- Session dibuat?

### 31.4 Pertanyaan Layer 4 — Authorization

- Resource constrained?
- Role yang dicek apa?
- Caller punya group apa?
- Group-to-role mapping benar?
- Descriptor override annotation?
- `@RolesAllowed` berjalan pada managed object?

### 31.5 Pertanyaan Layer 5 — Domain

- Resource tenant benar?
- Actor assigned?
- State mengizinkan?
- Authorization check sebelum mutation?
- Data query membatasi akses?
- Audit mencatat denial?

---

## 32. Design Pattern: Layered Security Architecture

Model yang direkomendasikan untuk aplikasi enterprise Jakarta:

```text
1. Edge Layer
   - TLS
   - trusted proxy config
   - WAF/rate limit if needed
   - remove spoofable identity headers

2. Container Authentication Layer
   - Jakarta Security / Authentication / app server realm
   - OIDC/form/basic/client-cert/token mechanism
   - establish principal and groups

3. Container Coarse Authorization Layer
   - URL constraints
   - method-level roles
   - admin/public/private boundary

4. Application Role Mapping Layer
   - external groups/claims -> stable app roles
   - environment-specific mapping controlled

5. Domain Authorization Layer
   - actor/action/resource/tenant/state/relationship
   - permission service
   - transaction-aware checks

6. Data Access Enforcement Layer
   - tenant filter
   - row-level constraints
   - query-level restrictions

7. Audit Layer
   - authentication events
   - authorization decisions
   - state changes
   - delegated/system actor

8. Operational Layer
   - key rotation
   - session expiry
   - cache invalidation
   - monitoring
   - incident response
```

Prinsipnya:

> Container decides who the caller is and enforces coarse application boundary. Domain layer decides what this caller may do to this specific resource in this specific state.

---

## 33. Anti-Patterns

### 33.1 User Object in Session as Only Security

```java
session.setAttribute("user", user);
```

Masalah:

- container tidak tahu,
- annotation tidak bekerja,
- stale role,
- fixation/logout issue,
- sulit audit.

### 33.2 Frontend-Only Authorization

```text
Hide button if not admin
```

Masalah:

- API tetap bisa dipanggil,
- attacker bisa bypass UI.

### 33.3 Raw Claim as Permission

```java
if (jwt.getClaim("department").equals("enforcement")) approve();
```

Masalah:

- claim bukan permission,
- department bukan action authorization,
- tidak cek resource/state/tenant.

### 33.4 Filter Auth Without Container Identity

```java
request.setAttribute("user", user);
chain.doFilter(request, response);
```

Masalah:

- `isUserInRole` tidak tahu,
- `@RolesAllowed` tidak tahu,
- inconsistent context.

### 33.5 Admin Role for Everything

```java
@RolesAllowed("ADMIN")
```

Masalah:

- privilege terlalu luas,
- audit tidak granular,
- sulit segregation of duties,
- sulit least privilege.

### 33.6 Fail Open on IdP/Policy Failure

```java
try {
    return policy.check(...);
} catch (Exception e) {
    return true;
}
```

Masalah:

- outage menjadi privilege escalation.

Rule:

> Security dependency failure should normally deny privileged action, with explicit break-glass process if business requires emergency continuity.

---

## 34. Practical Architecture Example

Bayangkan aplikasi regulatory case management.

### 34.1 Requirements

- User login via OIDC.
- User punya agency/organization.
- User bisa melihat case yang assigned atau dalam team queue.
- Supervisor bisa approve hanya jika bukan maker.
- Admin bisa manage user mapping, tetapi tidak otomatis boleh approve case.
- Semua denial dan approval harus diaudit.

### 34.2 Layered Design

```text
OIDC IdP
    -> claims: sub, email, groups, agency

Jakarta Security OIDC Mechanism
    -> authenticates user
    -> creates caller principal
    -> maps claims/groups

Container Security
    -> /internal/* requires authenticated
    -> /admin/* requires ADMIN
    -> CaseApprovalService.approve requires CASE_APPROVER

Domain Authorization Service
    -> checks tenant
    -> checks assignment
    -> checks state == PENDING_APPROVAL
    -> checks maker != approver
    -> checks delegation validity

Database Query Layer
    -> all case queries include tenant constraint

Audit Layer
    -> login success/failure
    -> authorization denial
    -> approval action
    -> before/after state
```

### 34.3 Why This Is Better

Karena tidak ada satu layer yang memikul semua tanggung jawab.

- IdP membuktikan identity.
- Container membentuk caller dan coarse role.
- Domain service memutuskan resource-specific permission.
- Database membatasi data leakage.
- Audit membuat sistem defensible.

---

## 35. Mental Model Akhir Part 03

Simpan model ini:

```text
Container security is the runtime bridge between external identity and application enforcement.
```

Lebih lengkap:

```text
Credential enters through HTTP/protocol boundary.
Authentication mechanism validates it.
Identity store/realm/IdP supplies identity data.
Container establishes caller principal and groups.
Role mapping translates identity attributes into app roles.
Container enforces coarse constraints.
Application enforces domain permission.
Audit records actor, decision, and effect.
```

Jika ada bug security, cari layer mana yang gagal:

```text
credential acquisition?
credential validation?
principal establishment?
group retrieval?
role mapping?
constraint matching?
method interception?
context propagation?
domain permission?
data filtering?
audit?
```

Top 1% engineer tidak hanya tahu cara menulis:

```java
@RolesAllowed("ADMIN")
```

Ia tahu kapan annotation itu bekerja, kapan tidak, layer mana yang menegakkannya, context apa yang dibutuhkan, bagaimana mapping role terjadi, bagaimana deployment bisa mengubah hasilnya, bagaimana async bisa merusaknya, dan bagaimana membuktikan sistem tetap aman saat gagal.

---

## 36. Checklist Ringkas Part 03

Gunakan checklist ini saat mendesain atau mereview Jakarta security architecture.

### Authentication

- [ ] Authentication mechanism resmi terdaftar ke container.
- [ ] Identity store/realm/IdP jelas.
- [ ] Principal stabil dan bukan display name.
- [ ] Group/claim tidak langsung dianggap permission.
- [ ] Failure credential tidak bocor detail.

### Authorization

- [ ] URL public/private/admin boundary eksplisit.
- [ ] Method-level security aktif pada managed bean.
- [ ] Role mapping terdokumentasi.
- [ ] Domain authorization ada untuk resource-specific action.
- [ ] Default untuk privileged action adalah deny.

### Context

- [ ] SecurityContext berasal dari container.
- [ ] Tidak menyimpan current user di singleton/application scope.
- [ ] Async/thread execution punya actor semantics eksplisit.
- [ ] ThreadLocal custom dibersihkan bila dipakai.

### Deployment

- [ ] App server security feature aktif.
- [ ] Namespace `javax`/`jakarta` konsisten.
- [ ] Descriptor dan annotation tidak konflik tanpa disadari.
- [ ] Realm dan role mapping environment-specific sudah dicek.
- [ ] Proxy/TLS forwarded headers aman.

### Audit

- [ ] Login/logout dicatat.
- [ ] Authorization denial dicatat.
- [ ] Privileged action dicatat.
- [ ] Actor vs on-behalf-of jelas.
- [ ] Correlation ID tersedia.

---

## 37. Hubungan dengan Part Berikutnya

Part ini memberi arsitektur container security secara menyeluruh. Setelah ini, kita bisa masuk lebih spesifik ke **Servlet Security Foundation**.

Part berikutnya akan membedah:

- `web.xml` security constraints,
- `@ServletSecurity`,
- `HttpServletRequest` security methods,
- login/logout/authenticate,
- transport guarantee,
- URL pattern matching,
- HTTP method constraints,
- form/basic/client-cert auth di web tier,
- dan failure model servlet security.

---

## 38. Status Seri

Selesai sampai:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
```

Belum selesai. Masih lanjut ke:

```text
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security](./learn-java-jakarta-security-authentication-authorization-identity-part-02-jaas-jacc-jaspic-javaee-jakarta-history.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization](./learn-java-jakarta-security-authentication-authorization-identity-part-04-servlet-security-foundation.md)
