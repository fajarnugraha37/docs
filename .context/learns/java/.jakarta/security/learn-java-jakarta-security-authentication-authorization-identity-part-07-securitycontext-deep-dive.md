# Part 07 — SecurityContext Deep Dive

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-07-securitycontext-deep-dive.md`  
> Target pembaca: Java/Jakarta engineer yang ingin memahami security context bukan hanya sebagai API untuk mengambil username, tetapi sebagai titik observasi dan enforcement identity di aplikasi enterprise.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. **Part 00** membangun mental model enterprise security.
2. **Part 01** membedakan identity, principal, subject, caller, group, role, dan permission.
3. **Part 02** menjelaskan lapisan historis JAAS, JASPIC/Jakarta Authentication, JACC/Jakarta Authorization, dan Jakarta Security.
4. **Part 03** menjelaskan container security architecture.
5. **Part 04** membedah Servlet Security sebagai enforcement web-tier.
6. **Part 05** membahas authentication mechanism.
7. **Part 06** membahas core API Jakarta Security.

Sekarang kita fokus pada satu komponen yang sangat sering dipakai tetapi sering kurang dipahami:

```text
jakarta.security.enterprise.SecurityContext
```

Di banyak aplikasi, `SecurityContext` hanya dipakai seperti ini:

```java
String username = securityContext.getCallerPrincipal().getName();
boolean admin = securityContext.isCallerInRole("ADMIN");
```

Itu valid, tetapi pemahaman seperti itu terlalu sempit.

`SecurityContext` adalah **jendela application code ke hasil keputusan container security**. Ia bukan identity provider, bukan session store, bukan policy engine lengkap, bukan domain authorization engine, dan bukan pengganti audit model. Ia adalah API untuk bertanya kepada runtime:

```text
Dalam konteks eksekusi saat ini, siapa caller-nya?
Apakah caller ini berada dalam logical application role tertentu?
Apakah caller ini bisa mengakses web resource tertentu?
Bisakah saya meminta container melakukan authentication flow?
```

Kalau kita salah memahami boundary ini, aplikasi mudah jatuh ke bug seperti:

- authorization hanya dicek di controller tetapi tidak di service,
- role dari token dianggap langsung sama dengan permission domain,
- async task kehilangan user identity,
- background job memakai identity user terakhir,
- `null` principal dianggap anonymous padahal endpoint seharusnya protected,
- JAX-RS `SecurityContext` dikira sama dengan Jakarta Security `SecurityContext`,
- custom JWT filter mengisi JAX-RS context tetapi method security container tetap tidak tahu user tersebut.

Part ini akan membangun pemahaman dari API sampai mental model production.

---

## 1. Definisi Inti

`jakarta.security.enterprise.SecurityContext` adalah API Jakarta Security yang menyediakan akses programmatic ke informasi security caller dan operasi security tertentu dari dalam application code.

Secara konseptual:

```text
SecurityContext = current execution security view exposed to application code
```

Bukan:

```text
SecurityContext != user table
SecurityContext != identity provider
SecurityContext != full permission engine
SecurityContext != JWT parser
SecurityContext != domain actor object
SecurityContext != audit event model
SecurityContext != global singleton identity state
```

API utamanya mencakup:

```java
Principal getCallerPrincipal();

<T extends Principal> Set<T> getPrincipalsByType(Class<T> pType);

boolean isCallerInRole(String role);

boolean hasAccessToWebResource(String resource, String... methods);

AuthenticationStatus authenticate(
    HttpServletRequest request,
    HttpServletResponse response,
    AuthenticationParameters parameters
);
```

Dokumentasi resmi Jakarta Security menjelaskan bahwa `SecurityContext` menyediakan akses point untuk programmatic security, termasuk `getCallerPrincipal`, `isCallerInRole`, `hasAccessToWebResource`, dan `authenticate`. Method `hasAccessToWebResource` mengecek akses caller terhadap web resource menggunakan aturan Servlet security constraint. Referensi resmi: Jakarta Security 4.0 API.

---

## 2. Mental Model Utama: SecurityContext Adalah View, Bukan Source of Truth

Hal pertama yang perlu ditanamkan:

```text
SecurityContext tidak menciptakan identity.
SecurityContext menampilkan identity yang sudah ditetapkan oleh container.
```

Flow-nya kira-kira:

```text
HTTP request
  ↓
Container menerima request
  ↓
Authentication mechanism berjalan
  ↓
Credential divalidasi oleh identity store / IdP / module
  ↓
Caller principal dan groups/roles diregistrasikan ke container
  ↓
Container membuat security context untuk current execution
  ↓
Application code membaca lewat SecurityContext
```

Jadi kalau `SecurityContext.getCallerPrincipal()` mengembalikan user, itu bukan karena `SecurityContext` login sendiri. Itu karena sebelum kode aplikasi dijalankan, container sudah menetapkan caller identity.

Sebaliknya, kalau `SecurityContext` mengembalikan `null`, akar masalahnya mungkin di:

- endpoint memang tidak authenticated,
- authentication mechanism tidak berjalan,
- credential tidak dikirim,
- session expired,
- token invalid,
- custom mechanism gagal memanggil `notifyContainerAboutLogin`,
- filter custom hanya menyimpan identity di request attribute tetapi tidak mendaftarkan ke container,
- context hilang karena async/thread switch,
- kode berjalan di luar request scope.

Maka debugging `SecurityContext` harus dimulai dari upstream establishment, bukan hanya dari baris `getCallerPrincipal()`.

---

## 3. Dua Jenis SecurityContext Yang Sering Tercampur

Dalam Jakarta ecosystem, minimal ada dua interface dengan nama mirip:

```text
jakarta.security.enterprise.SecurityContext
jakarta.ws.rs.core.SecurityContext
```

Keduanya berbeda.

### 3.1 Jakarta Security SecurityContext

Package:

```java
jakarta.security.enterprise.SecurityContext
```

Biasanya dipakai via CDI injection:

```java
@Inject
SecurityContext securityContext;
```

Fokusnya:

- caller principal,
- logical application role,
- access check terhadap web resource,
- trigger authentication.

### 3.2 JAX-RS SecurityContext

Package:

```java
jakarta.ws.rs.core.SecurityContext
```

Biasanya dipakai di resource JAX-RS:

```java
@Context
jakarta.ws.rs.core.SecurityContext securityContext;
```

Fokusnya:

- user principal,
- role check,
- secure channel check,
- authentication scheme.

Contoh:

```java
@Path("/profile")
public class ProfileResource {

    @Context
    jakarta.ws.rs.core.SecurityContext jaxrsSecurityContext;

    @GET
    public Response profile() {
        Principal principal = jaxrsSecurityContext.getUserPrincipal();
        return Response.ok(principal == null ? "anonymous" : principal.getName()).build();
    }
}
```

### 3.3 Hubungan Keduanya

Dalam container yang terintegrasi baik, keduanya akan merefleksikan caller yang sama:

```text
Container caller principal
  ├── visible via jakarta.security.enterprise.SecurityContext
  ├── visible via HttpServletRequest.getUserPrincipal()
  └── visible via jakarta.ws.rs.core.SecurityContext.getUserPrincipal()
```

Tetapi ini bukan jaminan universal kalau kita membangun security sendiri secara custom.

Anti-pattern penting:

```java
@Provider
public class JwtFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        ctx.setSecurityContext(new SecurityContext() {
            // custom JAX-RS context only
        });
    }
}
```

Kode di atas mungkin membuat JAX-RS resource bisa membaca user, tetapi belum tentu membuat:

- `@RolesAllowed` container bekerja,
- Servlet `getUserPrincipal()` bekerja,
- EJB/CDI method security bekerja,
- Jakarta Security `SecurityContext` tahu caller-nya,
- audit container melihat caller.

Untuk sistem enterprise, ini perbedaan besar.

---

## 4. API Surface: Method-by-Method Deep Dive

### 4.1 `getCallerPrincipal()`

Signature:

```java
Principal getCallerPrincipal();
```

Makna:

```text
Berikan principal utama dari caller yang sedang authenticated dalam current security context.
```

Contoh:

```java
@Inject
SecurityContext securityContext;

public String currentCallerName() {
    Principal principal = securityContext.getCallerPrincipal();
    if (principal == null) {
        return "anonymous";
    }
    return principal.getName();
}
```

Hal penting:

1. Return `null` berarti tidak ada authenticated caller dalam context tersebut.
2. `principal.getName()` adalah identifier yang dipilih authentication mechanism/container.
3. Nama principal belum tentu username login.
4. Nama principal belum tentu database primary key.
5. Nama principal belum tentu email.
6. Nama principal belum tentu immutable.

Contoh variasi principal name:

```text
alice
alice@example.com
8f7f6f82-7e80-4b21-a1bb-...
S1234567A
CN=service-a,O=Example,L=Singapore,C=SG
keycloak-user-id-uuid
```

### 4.1.1 Jangan Jadikan Principal Name Sebagai Domain Key Tanpa Kontrak

Anti-pattern:

```java
User user = userRepository.findByUsername(
    securityContext.getCallerPrincipal().getName()
);
```

Ini terlihat wajar, tetapi berbahaya kalau principal name bisa berubah.

Lebih baik buat mapping eksplisit:

```text
external_subject / principal_name / idp_user_id
  ↓ mapping table
internal_user_id
  ↓
domain actor
```

Contoh:

```java
public record CallerIdentity(
    String externalSubject,
    String issuer,
    Long internalUserId,
    String displayName
) {}
```

Service:

```java
@ApplicationScoped
public class CallerIdentityResolver {

    @Inject
    SecurityContext securityContext;

    @Inject
    UserLinkRepository userLinkRepository;

    public Optional<CallerIdentity> resolve() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            return Optional.empty();
        }

        String subject = principal.getName();
        return userLinkRepository.findByExternalSubject(subject)
            .map(link -> new CallerIdentity(
                subject,
                link.issuer(),
                link.internalUserId(),
                link.displayName()
            ));
    }
}
```

Mental model:

```text
Principal = security runtime identity representation
Domain user = application business entity
Actor = domain-level capability-bearing identity
```

Jangan campur ketiganya tanpa kontrak.

---

### 4.2 `getPrincipalsByType(Class<T> pType)`

Signature:

```java
<T extends Principal> Set<T> getPrincipalsByType(Class<T> pType);
```

Makna:

```text
Ambil semua principal di context yang bertipe tertentu.
```

Ini berguna kalau mechanism memasukkan principal tambahan selain principal utama.

Misalnya:

```java
public final class TenantPrincipal implements Principal {
    private final String tenantId;

    public TenantPrincipal(String tenantId) {
        this.tenantId = tenantId;
    }

    @Override
    public String getName() {
        return tenantId;
    }

    public String tenantId() {
        return tenantId;
    }
}
```

Lalu application code:

```java
Set<TenantPrincipal> tenants = securityContext.getPrincipalsByType(TenantPrincipal.class);
```

Kegunaan:

- mengambil principal custom,
- membaca tenant principal,
- membaca organization principal,
- membaca certificate principal,
- membaca federated identity principal,
- membedakan human user vs service account.

Namun perlu hati-hati: tidak semua container/mechanism akan menyimpan principal custom seperti yang kita harapkan. Untuk portability, jangan terlalu bergantung pada detail internal container kecuali sudah diuji.

---

### 4.3 `isCallerInRole(String role)`

Signature:

```java
boolean isCallerInRole(String role);
```

Makna:

```text
Apakah authenticated caller termasuk dalam logical application role tertentu?
```

Contoh:

```java
public boolean canAccessAdminMenu() {
    return securityContext.isCallerInRole("ADMIN");
}
```

Hal penting:

1. Role di sini adalah **logical application role**.
2. Role bukan selalu sama dengan IdP group.
3. Role bukan selalu sama dengan OAuth scope.
4. Role bukan selalu sama dengan domain permission.
5. Kalau caller tidak authenticated, biasanya hasilnya `false`.

Misalnya user memiliki token claim:

```json
{
  "sub": "user-123",
  "groups": ["agency_ops", "case_reviewer"],
  "scope": "openid profile case:read case:approve"
}
```

Application role mungkin dipetakan menjadi:

```text
agency_ops       → OFFICER
case_reviewer    → REVIEWER
case:approve     → not necessarily role, maybe permission/scope
```

Maka `isCallerInRole("REVIEWER")` hanya benar kalau mapping itu sudah dilakukan ke container role/group model.

### 4.3.1 Role Check Tidak Sama Dengan Domain Authorization

Contoh buruk:

```java
public void approveCase(long caseId) {
    if (!securityContext.isCallerInRole("APPROVER")) {
        throw new ForbiddenException();
    }

    caseRepository.approve(caseId);
}
```

Masalah:

- Apakah case milik tenant user?
- Apakah user assigned ke case itu?
- Apakah user bukan pembuat case tersebut?
- Apakah state case memang `PENDING_APPROVAL`?
- Apakah user sedang dalam delegation period?
- Apakah approval melebihi threshold sehingga perlu senior approver?

Lebih baik:

```java
public void approveCase(long caseId) {
    CallerIdentity actor = callerResolver.requireCaller();
    CaseRecord record = caseRepository.requireById(caseId);

    authorizationService.requireAllowed(
        actor,
        Action.APPROVE_CASE,
        record
    );

    caseWorkflow.approve(record, actor);
}
```

Role check bisa menjadi input:

```text
APPROVER role = coarse-grained capability
Domain authorization = final decision with resource, tenant, state, relationship
```

---

### 4.4 `hasAccessToWebResource(String resource, String... methods)`

Signature:

```java
boolean hasAccessToWebResource(String resource, String... methods);
```

Makna:

```text
Apakah caller saat ini bisa mengakses web resource tertentu berdasarkan Servlet security constraint?
```

Contoh:

```java
boolean canPostAdmin = securityContext.hasAccessToWebResource(
    "/admin/reports",
    "POST"
);
```

Ini mengecek terhadap web resource constraint, bukan domain object permission.

Kegunaan:

- menyesuaikan navigasi/menu berdasarkan security constraint,
- pre-check akses ke halaman tertentu,
- membuat UI server-side yang mengikuti deklarasi web-tier security,
- validasi konsistensi security metadata.

Batasan:

```text
hasAccessToWebResource("/cases/123", "GET")
```

Bisa menjawab:

```text
Apakah role user boleh GET /cases/* ?
```

Tetapi tidak menjawab:

```text
Apakah user boleh melihat case id 123?
```

Itu domain authorization.

### 4.4.1 Menu Rendering Example

```java
@ApplicationScoped
public class NavigationService {

    @Inject
    SecurityContext securityContext;

    public List<MenuItem> visibleMenuItems() {
        List<MenuItem> result = new ArrayList<>();

        if (securityContext.hasAccessToWebResource("/dashboard", "GET")) {
            result.add(new MenuItem("Dashboard", "/dashboard"));
        }

        if (securityContext.hasAccessToWebResource("/admin/users", "GET")) {
            result.add(new MenuItem("User Admin", "/admin/users"));
        }

        if (securityContext.hasAccessToWebResource("/cases", "GET")) {
            result.add(new MenuItem("Cases", "/cases"));
        }

        return result;
    }
}
```

Important invariant:

```text
Hiding menu is not enforcement.
Server endpoint must still enforce access.
```

---

### 4.5 `authenticate(...)`

Signature simplified:

```java
AuthenticationStatus authenticate(
    HttpServletRequest request,
    HttpServletResponse response,
    AuthenticationParameters parameters
);
```

Makna:

```text
Meminta container menjalankan authentication flow untuk request/response saat ini.
```

Contoh konseptual:

```java
AuthenticationStatus status = securityContext.authenticate(
    request,
    response,
    AuthenticationParameters.withParams()
);
```

Return value `AuthenticationStatus` dapat menunjukkan:

```text
SUCCESS
SEND_CONTINUE
SEND_FAILURE
NOT_DONE
```

Kegunaan:

- trigger login programmatically,
- custom login endpoint,
- redirect/challenge flow,
- step-up authentication,
- reauthentication untuk sensitive action.

Tetapi hati-hati: method ini bukan sekadar `login(username, password)`. Ia bekerja dengan mechanism/container. Ia bisa mengubah response, mengirim redirect/challenge, atau menandai flow belum selesai.

Pseudo-flow:

```text
Application asks SecurityContext.authenticate()
  ↓
Container invokes configured HttpAuthenticationMechanism
  ↓
Mechanism inspects request/parameters
  ↓
Mechanism validates credential or starts challenge
  ↓
Mechanism returns AuthenticationStatus
  ↓
Application must respect returned status
```

Contoh handling:

```java
AuthenticationStatus status = securityContext.authenticate(request, response, parameters);

switch (status) {
    case SUCCESS:
        // caller authenticated; proceed or redirect
        break;
    case SEND_CONTINUE:
        // response has been committed/continued, e.g. redirect to login or IdP
        return;
    case SEND_FAILURE:
        // failure response sent
        return;
    case NOT_DONE:
        // mechanism did not authenticate; decide fallback
        break;
}
```

Anti-pattern:

```java
securityContext.authenticate(request, response, params);
// blindly continue business operation
caseService.approve(caseId);
```

Harus menghormati status.

---

## 5. SecurityContext Dalam Request Lifecycle

SecurityContext biasanya bermakna paling jelas dalam request synchronous.

```text
Client request
  ↓
Filter chain starts
  ↓
Container security checks
  ↓
Authentication mechanism
  ↓
Principal established
  ↓
Servlet/JAX-RS/CDI/EJB application code
  ↓
SecurityContext can be queried
  ↓
Response
```

Dalam kode aplikasi:

```java
@Path("/me")
public class MeResource {

    @Inject
    jakarta.security.enterprise.SecurityContext securityContext;

    @GET
    public Response me() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        return Response.ok(Map.of("name", principal.getName())).build();
    }
}
```

Tetapi perhatikan:

```text
SecurityContext meaningful only if runtime has current security context.
```

Kalau method dipanggil dari:

- scheduled job,
- startup event,
- background executor,
- raw thread,
- delayed callback,
- reactive pipeline,
- static utility,

maka current caller bisa tidak ada.

---

## 6. Request Scope, CDI, dan Lifecycle

`SecurityContext` biasanya injectable sebagai CDI bean. Tetapi bukan berarti ia menyimpan user global. Runtime menyediakan proxy/contextual object yang merepresentasikan current execution.

Mental model CDI:

```text
@Inject SecurityContext
  ↓
You receive a contextual proxy / runtime-provided object
  ↓
At method call time, it resolves current caller context
```

Konsekuensi:

```java
@ApplicationScoped
public class MyService {

    @Inject
    SecurityContext securityContext;

    public String currentUser() {
        return securityContext.getCallerPrincipal().getName();
    }
}
```

Ini bisa valid karena injected object dapat menjadi proxy yang resolve current context. Namun jangan cache hasilnya di field application-scoped:

```java
@ApplicationScoped
public class BadService {

    @Inject
    SecurityContext securityContext;

    private String cachedUser;

    @PostConstruct
    void init() {
        Principal p = securityContext.getCallerPrincipal();
        cachedUser = p == null ? null : p.getName();
    }
}
```

Ini salah karena user adalah request/current execution state, bukan application state.

Rule:

```text
Inject SecurityContext boleh.
Cache caller dari SecurityContext sebagai global state tidak boleh.
```

---

## 7. SecurityContext vs HttpServletRequest

Servlet juga menyediakan API security:

```java
request.getUserPrincipal();
request.isUserInRole("ADMIN");
request.authenticate(response);
request.login(username, password);
request.logout();
```

Jakarta Security `SecurityContext` menyediakan API yang lebih general dan CDI-friendly.

Perbandingan:

| Concern | `HttpServletRequest` | Jakarta Security `SecurityContext` |
|---|---|---|
| Scope | Servlet request | Jakarta Security abstraction |
| Injection | Usually method parameter / `@Context` | CDI `@Inject` |
| Caller principal | `getUserPrincipal()` | `getCallerPrincipal()` |
| Role check | `isUserInRole()` | `isCallerInRole()` |
| Programmatic auth | `authenticate`, `login`, `logout` | `authenticate` |
| Web resource access check | not equivalent direct high-level API | `hasAccessToWebResource` |
| Framework neutrality | servlet-centric | Jakarta Security-centric |

Mental model:

```text
HttpServletRequest = web request object
SecurityContext = security abstraction exposed to app code
```

Dalam pure Servlet code, request API cukup. Dalam CDI/service/resource code, `SecurityContext` lebih nyaman.

---

## 8. SecurityContext vs Domain Actor

Ini bagian yang sangat penting untuk aplikasi enterprise.

Banyak aplikasi langsung memakai `SecurityContext` di semua business logic:

```java
if (securityContext.isCallerInRole("SUPERVISOR")) {
    approve();
}
```

Pada aplikasi sederhana ini cukup. Pada aplikasi kompleks, ini membuat business rule tersebar dan sulit diaudit.

Lebih baik buat abstraction domain actor.

### 8.1 Domain Actor Model

```java
public record Actor(
    Long userId,
    String externalSubject,
    String displayName,
    Set<String> roles,
    Set<String> tenantIds,
    boolean systemActor
) {}
```

Resolver:

```java
@ApplicationScoped
public class ActorResolver {

    @Inject
    SecurityContext securityContext;

    @Inject
    UserLinkRepository userLinkRepository;

    @Inject
    RoleProjectionService roleProjectionService;

    public Actor requireActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new UnauthenticatedException();
        }

        UserLink link = userLinkRepository.requireByExternalSubject(principal.getName());

        return new Actor(
            link.internalUserId(),
            principal.getName(),
            link.displayName(),
            roleProjectionService.rolesOf(link.internalUserId()),
            roleProjectionService.tenantsOf(link.internalUserId()),
            false
        );
    }
}
```

Business service:

```java
public void approveCase(long caseId) {
    Actor actor = actorResolver.requireActor();
    CaseRecord record = caseRepository.require(caseId);

    caseAuthorization.requireCanApprove(actor, record);
    caseWorkflow.approve(record, actor);
}
```

Keuntungannya:

- domain rule tidak tergantung langsung pada container API,
- testing lebih mudah,
- audit event bisa memakai actor yang kaya konteks,
- multi-tenant/organization logic bisa dimodelkan eksplisit,
- future migration dari Jakarta Security ke OIDC gateway/Spring Security lebih mudah,
- external subject bisa dipisahkan dari internal user id.

### 8.2 SecurityContext Tetap Dibutuhkan

Domain actor bukan pengganti `SecurityContext`. Ia dibangun dari `SecurityContext`.

```text
SecurityContext → raw caller identity from runtime
ActorResolver   → converts caller into domain actor
Authorization   → decides action on resource
Audit           → records actor/action/resource/outcome
```

---

## 9. Authentication State: Authenticated, Anonymous, System, Impersonated

Aplikasi mature harus membedakan minimal empat state:

```text
1. Anonymous request
2. Authenticated human user
3. Authenticated service account
4. System/internal execution
5. Impersonated/on-behalf-of execution
```

`SecurityContext.getCallerPrincipal() == null` hanya menunjukkan tidak ada authenticated caller dalam current context.

Tetapi aplikasi tetap perlu model eksplisit:

```java
public sealed interface ExecutionActor permits AnonymousActor, HumanActor, ServiceActor, SystemActor, ImpersonatedActor {
    String auditName();
}
```

Contoh:

```java
public record HumanActor(Long userId, String subject, String displayName) implements ExecutionActor {
    @Override
    public String auditName() {
        return "user:" + userId;
    }
}

public record SystemActor(String jobName) implements ExecutionActor {
    @Override
    public String auditName() {
        return "system:" + jobName;
    }
}
```

Mengapa perlu?

Karena kalau semua non-human execution dipaksa memakai fake user seperti `admin` atau `system`, audit dan authorization menjadi kabur.

Bad pattern:

```text
cron job runs as ADMIN
```

Better:

```text
cron job runs as SystemActor("daily-case-escalation")
with explicit allowed system actions
```

---

## 10. Role Check Semantics: Logical Application Role

`isCallerInRole("X")` mengecek logical application role, bukan database role langsung.

Dalam container security, role bisa berasal dari:

- deployment descriptor,
- annotation,
- identity store group,
- IdP claim mapping,
- server realm mapping,
- vendor-specific mapping,
- custom authentication mechanism.

Flow:

```text
External identity attributes
  ↓
Authentication mechanism / identity store
  ↓
Caller principal + groups
  ↓
Container role mapping
  ↓
isCallerInRole("APP_ROLE")
```

### 10.1 Stable Role Contract

Untuk enterprise app, definisikan role contract internal:

```text
CASE_VIEWER
CASE_OFFICER
CASE_REVIEWER
CASE_APPROVER
CASE_SUPERVISOR
USER_ADMIN
SYSTEM_ADMIN
AUDITOR
```

Jangan pakai langsung nama group eksternal:

```text
CN=ACEAS_PROD_CASE_APPROVER,OU=Groups,DC=example,DC=sg
```

Karena group eksternal bisa berubah. Application role harus relatif stabil.

### 10.2 Avoid Role Explosion

Jangan membuat role untuk setiap kombinasi resource/action/state:

```text
CASE_APPROVE_LEVEL_1_REGION_A_TENANT_X_PENDING_REVIEW
```

Itu role explosion.

Lebih baik:

```text
Role: CASE_APPROVER
Attributes: approvalLimit, tenantIds, regionIds
Resource state: PENDING_REVIEW
Policy: evaluate(actor, APPROVE, case)
```

---

## 11. SecurityContext Dalam JAX-RS Resource

Contoh memakai Jakarta Security context:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    jakarta.security.enterprise.SecurityContext securityContext;

    @Inject
    CaseService caseService;

    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") long id) {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }

        CaseDto dto = caseService.getCase(id);
        return Response.ok(dto).build();
    }
}
```

Namun lebih baik jangan resource langsung mengambil terlalu banyak keputusan domain:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {

    @Inject
    CaseApplicationService caseApplicationService;

    @GET
    @Path("/{id}")
    public Response get(@PathParam("id") long id) {
        return Response.ok(caseApplicationService.getCaseForCurrentActor(id)).build();
    }
}
```

Service:

```java
@ApplicationScoped
public class CaseApplicationService {

    @Inject
    ActorResolver actorResolver;

    @Inject
    CaseAuthorization caseAuthorization;

    @Inject
    CaseRepository caseRepository;

    public CaseDto getCaseForCurrentActor(long id) {
        Actor actor = actorResolver.requireActor();
        CaseRecord record = caseRepository.require(id);
        caseAuthorization.requireCanView(actor, record);
        return CaseDto.from(record);
    }
}
```

Tujuan:

```text
Resource layer handles HTTP.
Application service handles use case.
Authorization service handles domain policy.
SecurityContext only provides runtime caller basis.
```

---

## 12. `SecurityContext` Dalam Servlet

Contoh servlet:

```java
@WebServlet("/admin/summary")
public class AdminSummaryServlet extends HttpServlet {

    @Inject
    SecurityContext securityContext;

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
        throws IOException {

        if (!securityContext.isCallerInRole("ADMIN")) {
            resp.sendError(HttpServletResponse.SC_FORBIDDEN);
            return;
        }

        resp.getWriter().println("Admin summary");
    }
}
```

Namun kalau endpoint memang admin-only, sebaiknya juga deklaratif:

```java
@ServletSecurity(@HttpConstraint(rolesAllowed = "ADMIN"))
@WebServlet("/admin/summary")
public class AdminSummaryServlet extends HttpServlet {
    // ...
}
```

Kenapa?

Karena declarative security membuat container dapat enforce sebelum business code.

Pattern:

```text
Declarative security = coarse gate
Programmatic/domain security = precise decision
```

---

## 13. `SecurityContext` dan Method Security

Misalnya:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(long caseId) {
    // ...
}
```

Container method security akan memakai caller identity dari security context internal container.

Dalam method yang sama, kita masih bisa memakai `SecurityContext`:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(long caseId) {
    Principal principal = securityContext.getCallerPrincipal();
    // domain authorization continues
}
```

Tetapi jangan berasumsi `@RolesAllowed` cukup untuk domain-sensitive action.

Lebih baik:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(long caseId) {
    Actor actor = actorResolver.requireActor();
    CaseRecord record = caseRepository.require(caseId);
    caseAuthorization.requireCanApprove(actor, record);
    caseWorkflow.approve(record, actor);
}
```

---

## 14. Threading Problem: SecurityContext Tidak Otomatis Mengikuti Semua Thread

Security context biasanya terikat pada request/execution context. Ketika kita pindah thread, context bisa hilang.

Contoh berbahaya:

```java
public void submitReport(long reportId) {
    CompletableFuture.runAsync(() -> {
        Principal principal = securityContext.getCallerPrincipal();
        // principal may be null or invalid depending on runtime/context
        reportService.generate(reportId, principal.getName());
    });
}
```

Masalah:

- `CompletableFuture.runAsync` memakai common pool.
- Thread bukan managed Jakarta EE thread.
- Request context mungkin sudah selesai.
- Security context tidak dijamin ada.
- Bisa terjadi context lost.

### 14.1 Capture Actor, Not SecurityContext

Better:

```java
public void submitReport(long reportId) {
    Actor actor = actorResolver.requireActor();

    managedExecutor.execute(() -> {
        reportService.generate(reportId, actor);
    });
}
```

Capture domain actor yang immutable, bukan `SecurityContext`.

```text
Do not pass SecurityContext across thread boundary.
Pass explicit actor / authorization snapshot / command metadata.
```

### 14.2 Managed Executor

Dalam Jakarta EE, gunakan managed executor dibanding raw thread.

Bad:

```java
new Thread(() -> doWork()).start();
```

Better:

```java
@Resource
ManagedExecutorService executor;

public void runAsync(Task task) {
    Actor actor = actorResolver.requireActor();
    executor.submit(() -> worker.run(task, actor));
}
```

Tetapi bahkan dengan managed executor, tetap jangan bergantung buta bahwa security context semantics sesuai harapan. Buat actor propagation explicit agar audit dan authorization deterministic.

---

## 15. Virtual Threads Java 21+ dan SecurityContext

Java 21 memperkenalkan virtual threads sebagai fitur final. Dalam konteks Jakarta app, virtual threads bisa dipakai oleh runtime/framework tertentu, tetapi security context propagation tetap harus dipahami.

Virtual threads membuat concurrency lebih murah, tetapi tidak otomatis menyelesaikan masalah identity propagation.

Problem tetap sama:

```text
Apakah current execution memiliki caller context yang benar?
Apakah context disalin, diwariskan, atau dilookup ulang?
Apakah actor yang dipakai masih valid setelah request selesai?
```

Jangan berpikir:

```text
Virtual thread = safe security context propagation
```

Yang benar:

```text
Virtual thread changes execution mechanics, not authorization semantics.
```

Prinsip tetap:

```text
At security boundary, resolve caller → build explicit Actor → pass Actor/Command explicitly.
```

---

## 16. Reactive Pipelines dan Context Loss

Dalam reactive programming, eksekusi bisa berpindah thread berkali-kali.

Pseudo-code berisiko:

```java
public CompletionStage<Response> getCase(long id) {
    return repository.findAsync(id)
        .thenApply(record -> {
            if (!securityContext.isCallerInRole("CASE_VIEWER")) {
                throw new ForbiddenException();
            }
            return Response.ok(record).build();
        });
}
```

Masalah:

- callback bisa berjalan di thread berbeda,
- request context bisa tidak aktif,
- security context bisa tidak tersedia,
- role check dilakukan terlalu lambat.

Better:

```java
public CompletionStage<Response> getCase(long id) {
    Actor actor = actorResolver.requireActor();

    return repository.findAsync(id)
        .thenApply(record -> {
            caseAuthorization.requireCanView(actor, record);
            return Response.ok(record).build();
        });
}
```

Pattern:

```text
Resolve security context at synchronous boundary.
Convert to explicit immutable actor.
Use actor inside async/reactive flow.
```

---

## 17. Time-of-Check vs Time-of-Use

SecurityContext menunjukkan current caller saat dicek. Tetapi authorization bisa berubah antara check dan use.

Contoh:

```java
if (securityContext.isCallerInRole("APPROVER")) {
    // long operation
    caseRepository.approve(caseId);
}
```

Masalah:

- role user dicabut selama long operation,
- case state berubah,
- assignment berubah,
- tenant membership berubah,
- approval already done by someone else.

Untuk operation kritikal:

```text
Authorization must be checked close to state mutation.
Mutation must include concurrency/state invariant.
```

Better:

```java
@Transactional
public void approveCase(long caseId) {
    Actor actor = actorResolver.requireActor();
    CaseRecord record = caseRepository.lockForUpdate(caseId);

    caseAuthorization.requireCanApprove(actor, record);
    record.approveBy(actor.userId());
}
```

Authorization invariant:

```text
Decision = f(actor, action, resource current state, tenant, relationship, time)
```

Not just:

```text
Decision = f(role)
```

---

## 18. `null` Principal Semantics

`getCallerPrincipal()` can return `null` when no user is authenticated. But application interpretation matters.

Possible meanings:

```text
1. Endpoint intentionally public.
2. User not logged in.
3. Authentication mechanism did not run.
4. Session expired.
5. Token missing.
6. Token invalid.
7. Context lost due to async/threading.
8. Code called outside request context.
9. Container integration broken.
```

Do not blindly do:

```java
String user = Optional.ofNullable(securityContext.getCallerPrincipal())
    .map(Principal::getName)
    .orElse("anonymous");
```

This is okay for display, but dangerous for business action.

Better:

```java
public Principal requirePrincipal() {
    Principal principal = securityContext.getCallerPrincipal();
    if (principal == null) {
        throw new UnauthenticatedException("Authenticated caller required");
    }
    return principal;
}
```

Use separate methods:

```java
Optional<Principal> currentPrincipal();
Principal requirePrincipal();
Actor requireActor();
```

This makes intent explicit.

---

## 19. 401 vs 403 With SecurityContext

Common mistake:

```java
if (!securityContext.isCallerInRole("ADMIN")) {
    throw new NotAuthorizedException("Not admin");
}
```

But if user is authenticated and lacks role, response should usually be 403, not 401.

Decision:

```text
No authenticated caller → 401 Unauthorized
Authenticated caller but insufficient permission → 403 Forbidden
```

Helper:

```java
public void requireRole(String role) {
    Principal principal = securityContext.getCallerPrincipal();
    if (principal == null) {
        throw new WebApplicationException(Response.Status.UNAUTHORIZED);
    }
    if (!securityContext.isCallerInRole(role)) {
        throw new WebApplicationException(Response.Status.FORBIDDEN);
    }
}
```

But for domain permission, return carefully:

```text
403 if authenticated but not allowed.
404 sometimes acceptable to avoid leaking resource existence, depending on policy.
```

For regulatory systems, denial reason should be audit-rich but user-safe.

---

## 20. UI Authorization: What SecurityContext Can and Cannot Do

Server-rendered UI can use `SecurityContext` to conditionally render controls:

```java
if (securityContext.isCallerInRole("CASE_APPROVER")) {
    showApproveButton();
}
```

But never treat UI hiding as enforcement.

Rule:

```text
UI visibility = convenience
Server authorization = enforcement
Audit = accountability
```

Example:

```text
Approve button hidden for non-approver
  ↓
Attacker sends POST /cases/123/approve manually
  ↓
Server must still reject
```

SecurityContext helps with UI, but final enforcement belongs in server-side endpoint/service.

---

## 21. Designing a SecurityContext Facade

Rather than injecting `SecurityContext` everywhere, use a small application abstraction.

```java
@ApplicationScoped
public class CurrentCaller {

    @Inject
    SecurityContext securityContext;

    public Optional<String> principalName() {
        return Optional.ofNullable(securityContext.getCallerPrincipal())
            .map(Principal::getName);
    }

    public String requirePrincipalName() {
        return principalName().orElseThrow(UnauthenticatedException::new);
    }

    public boolean hasRole(String role) {
        return securityContext.isCallerInRole(role);
    }

    public void requireRole(String role) {
        if (securityContext.getCallerPrincipal() == null) {
            throw new UnauthenticatedException();
        }
        if (!hasRole(role)) {
            throw new ForbiddenException("Missing role: " + role);
        }
    }
}
```

Then use:

```java
currentCaller.requireRole("CASE_APPROVER");
```

Benefit:

- consistent 401/403 semantics,
- easier testing,
- central logging/audit hook,
- migration flexibility,
- reduces API coupling.

But avoid building a God object. Keep facade small.

---

## 22. Testing SecurityContext Usage

### 22.1 Unit Testing Domain Authorization Without SecurityContext

Domain authorization should not need container.

```java
@Test
void makerCannotApproveOwnCase() {
    Actor maker = new Actor(1L, "sub-1", "Alice", Set.of("CASE_APPROVER"), Set.of("T1"), false);
    CaseRecord record = new CaseRecord(100L, "T1", 1L, CaseState.PENDING_APPROVAL);

    assertThrows(ForbiddenException.class,
        () -> authorization.requireCanApprove(maker, record));
}
```

This is fast and deterministic.

### 22.2 Unit Testing Adapter/Resolver

Mock or fake `SecurityContext` only at boundary.

```java
class FakeSecurityContext implements SecurityContext {
    private final Principal principal;
    private final Set<String> roles;

    FakeSecurityContext(String name, Set<String> roles) {
        this.principal = () -> name;
        this.roles = roles;
    }

    @Override
    public Principal getCallerPrincipal() {
        return principal;
    }

    @Override
    public boolean isCallerInRole(String role) {
        return roles.contains(role);
    }

    // other methods omitted for test brevity
}
```

But for actual container behavior, use integration tests.

### 22.3 Integration Test

SecurityContext behavior depends on container integration, so test:

- protected endpoint unauthenticated → 401/redirect,
- authenticated user sees principal,
- role user can access endpoint,
- non-role user gets 403,
- `hasAccessToWebResource` matches declared constraints,
- logout clears caller,
- session expiry clears caller,
- async path does not leak caller.

Test matrix:

| Scenario | Expected |
|---|---|
| No credential on protected endpoint | 401 or login redirect |
| Valid credential | principal not null |
| Invalid credential | 401/failure |
| Valid user missing role | 403 |
| Valid user correct role | 200 |
| Logout then access | 401/redirect |
| Role removed then new session | role false |
| Async background operation | explicit actor or system actor used |

---

## 23. Observability and Debugging

When `SecurityContext` behaves unexpectedly, use structured debugging.

### 23.1 Debug Questions

Ask:

```text
1. Is endpoint supposed to be authenticated?
2. Which authentication mechanism should run?
3. Did credential arrive?
4. Did mechanism validate credential?
5. Did mechanism notify container about login?
6. What principal name was registered?
7. What groups were registered?
8. How are groups mapped to application roles?
9. Is current code still in request context?
10. Did thread change?
11. Is JAX-RS context different from Jakarta Security context?
12. Is method security using container role or custom filter role?
```

### 23.2 Minimal Diagnostic Endpoint for Non-Production

Only for dev/test:

```java
@Path("/debug/security")
@RolesAllowed("SYSTEM_ADMIN")
public class SecurityDebugResource {

    @Inject
    SecurityContext securityContext;

    @GET
    public Map<String, Object> debug() {
        Principal p = securityContext.getCallerPrincipal();
        return Map.of(
            "principal", p == null ? null : p.getName(),
            "admin", securityContext.isCallerInRole("SYSTEM_ADMIN"),
            "caseViewer", securityContext.isCallerInRole("CASE_VIEWER")
        );
    }
}
```

Do not expose raw tokens, credentials, full group lists, or sensitive claims in production.

### 23.3 Logging

Good:

```text
auth.event=authorization_denied actor=sub:abc action=APPROVE_CASE caseId=123 reason=MAKER_CANNOT_APPROVE_OWN_CASE correlationId=...
```

Bad:

```text
Authorization failed for token eyJhbGciOi...
```

Never log credentials or bearer tokens.

---

## 24. Common Anti-Patterns

### Anti-Pattern 1 — Treating SecurityContext as Domain User

Bad:

```java
String userId = securityContext.getCallerPrincipal().getName();
case.setApproverUserId(Long.parseLong(userId));
```

Problem: principal name might not be internal numeric ID.

Better: resolve actor through mapping.

---

### Anti-Pattern 2 — Role Check Everywhere

Bad:

```java
if (securityContext.isCallerInRole("ADMIN")) { ... }
```

Repeated across controller/service/repository.

Problem:

- inconsistent rules,
- no central audit,
- hard to test,
- role explosion.

Better:

```java
caseAuthorization.requireCanApprove(actor, caseRecord);
```

---

### Anti-Pattern 3 — Passing SecurityContext Into Domain Model

Bad:

```java
caseRecord.approve(securityContext);
```

Problem: domain model now depends on Jakarta runtime.

Better:

```java
caseRecord.approve(actor.userId(), clock.now());
```

---

### Anti-Pattern 4 — Capturing SecurityContext In Async Job

Bad:

```java
executor.submit(() -> report.generate(securityContext));
```

Better:

```java
Actor actor = actorResolver.requireActor();
executor.submit(() -> report.generate(actor));
```

---

### Anti-Pattern 5 — Assuming UI Role Check Is Enforcement

Bad:

```text
Button hidden → operation secure
```

Better:

```text
Button hidden + endpoint protected + domain authorization enforced + audit logged
```

---

### Anti-Pattern 6 — Custom Filter Only Updates Request Attribute

Bad:

```java
request.setAttribute("user", jwtSubject);
```

Problem: container method security does not know.

Better:

Use Jakarta Security/Jakarta Authentication/container-supported integration or ensure all enforcement paths use a consistent security model.

---

## 25. SecurityContext In Layered Architecture

Recommended layering:

```text
HTTP/JAX-RS/Servlet Layer
  - handle request/response
  - coarse auth annotation
  - no complex policy

CurrentCaller / ActorResolver
  - read SecurityContext
  - resolve principal to domain actor
  - fail with 401 if missing

Application Service
  - orchestrate use case
  - load resource
  - call authorization service

Authorization Service
  - evaluate actor/action/resource/tenant/state/relationship
  - produce deterministic allow/deny

Domain Model
  - enforce state invariants
  - no Jakarta dependency

Audit Service
  - record actor/action/resource/outcome/reason
```

Diagram:

```text
SecurityContext
      ↓
CurrentCaller
      ↓
ActorResolver
      ↓
Application Service
      ↓
Domain Authorization
      ↓
Domain Mutation
      ↓
Audit Event
```

This keeps Jakarta API at the boundary while preserving enterprise-grade domain security.

---

## 26. Example: Case Approval End-to-End

### 26.1 Controller/Resource

```java
@Path("/cases/{id}/approve")
@RequestScoped
public class CaseApprovalResource {

    @Inject
    CaseApprovalService approvalService;

    @POST
    @RolesAllowed("CASE_APPROVER")
    public Response approve(@PathParam("id") long id, ApproveCaseRequest request) {
        approvalService.approve(id, request.comment());
        return Response.noContent().build();
    }
}
```

### 26.2 Actor Resolver

```java
@ApplicationScoped
public class ActorResolver {

    @Inject
    SecurityContext securityContext;

    @Inject
    UserRepository userRepository;

    public Actor requireActor() {
        Principal principal = securityContext.getCallerPrincipal();
        if (principal == null) {
            throw new UnauthenticatedException();
        }

        User user = userRepository.requireByExternalSubject(principal.getName());

        return new Actor(
            user.id(),
            principal.getName(),
            user.displayName(),
            user.roles(),
            user.tenantIds(),
            false
        );
    }
}
```

### 26.3 Application Service

```java
@ApplicationScoped
public class CaseApprovalService {

    @Inject
    ActorResolver actorResolver;

    @Inject
    CaseRepository caseRepository;

    @Inject
    CaseAuthorization caseAuthorization;

    @Inject
    AuditService auditService;

    @Transactional
    public void approve(long caseId, String comment) {
        Actor actor = actorResolver.requireActor();
        CaseRecord record = caseRepository.lockForUpdate(caseId);

        try {
            caseAuthorization.requireCanApprove(actor, record);
            record.approve(actor.userId(), comment);
            auditService.success(actor, "APPROVE_CASE", record.id());
        } catch (RuntimeException ex) {
            auditService.failure(actor, "APPROVE_CASE", record.id(), ex.getClass().getSimpleName());
            throw ex;
        }
    }
}
```

### 26.4 Authorization Service

```java
@ApplicationScoped
public class CaseAuthorization {

    public void requireCanApprove(Actor actor, CaseRecord record) {
        if (!actor.roles().contains("CASE_APPROVER")) {
            throw new ForbiddenException("Missing CASE_APPROVER role");
        }

        if (!actor.tenantIds().contains(record.tenantId())) {
            throw new ForbiddenException("Cross-tenant access denied");
        }

        if (record.createdByUserId().equals(actor.userId())) {
            throw new ForbiddenException("Maker cannot approve own case");
        }

        if (record.state() != CaseState.PENDING_APPROVAL) {
            throw new ConflictException("Case is not pending approval");
        }
    }
}
```

Observe the separation:

```text
@RolesAllowed = coarse container gate
SecurityContext = source of current principal
ActorResolver = domain actor mapping
CaseAuthorization = domain decision
CaseRecord = state transition invariant
AuditService = accountability
```

---

## 27. Example: Access-Based Menu Rendering

```java
@ApplicationScoped
public class MenuService {

    @Inject
    SecurityContext securityContext;

    public List<MenuItem> menu() {
        List<MenuItem> items = new ArrayList<>();

        if (securityContext.getCallerPrincipal() == null) {
            items.add(new MenuItem("Login", "/login"));
            return items;
        }

        if (securityContext.hasAccessToWebResource("/dashboard", "GET")) {
            items.add(new MenuItem("Dashboard", "/dashboard"));
        }

        if (securityContext.isCallerInRole("CASE_VIEWER")) {
            items.add(new MenuItem("Cases", "/cases"));
        }

        if (securityContext.isCallerInRole("USER_ADMIN")) {
            items.add(new MenuItem("User Management", "/admin/users"));
        }

        return items;
    }
}
```

This is okay for UX, but still enforce server endpoints.

---

## 28. SecurityContext and Logout

`SecurityContext` itself does not represent logout state permanently. Logout is typically handled through:

- `HttpServletRequest.logout()`;
- session invalidation;
- OIDC RP-initiated/logout endpoint;
- IdP logout;
- token revocation depending on architecture.

After logout, future request should have:

```text
getCallerPrincipal() == null
isCallerInRole(...) == false
```

But beware:

```text
Local session logout does not necessarily revoke access token.
IdP logout does not necessarily clear application session if not integrated.
Browser back button can show cached page.
Distributed session nodes can be stale.
```

So logout testing must verify actual `SecurityContext` result after logout.

---

## 29. SecurityContext and Token-Based Systems

If application validates JWT itself, you must decide how JWT subject becomes container caller.

Bad split model:

```text
JWT filter validates token
  ↓
Stores subject in request attribute
  ↓
Business code reads request attribute
  ↓
@RolesAllowed sees no caller
```

Integrated model:

```text
JWT/auth mechanism validates token
  ↓
Registers caller principal and groups with container
  ↓
SecurityContext sees caller
  ↓
@RolesAllowed/isCallerInRole work consistently
```

This is why simply parsing JWT in filter is often insufficient for Jakarta enterprise security.

---

## 30. SecurityContext and Microservices

In a microservice system:

```text
Service A receives user request
  ↓
Service A has SecurityContext for user
  ↓
Service A calls Service B
```

Question:

```text
What identity does Service B see?
```

Options:

1. Propagate user token.
2. Use service token only.
3. Use token exchange: service acts on behalf of user.
4. Use signed command with actor metadata.
5. Use mTLS service identity + user context header.

SecurityContext in Service A does not magically propagate to Service B. Propagation must be explicitly designed.

For downstream audit:

```text
actor = user:alice
caller_service = service-a
on_behalf_of = alice
request_id = ...
```

Without this, downstream services may only see `service-a`, losing user accountability.

---

## 31. SecurityContext and Multi-Tenancy

SecurityContext usually tells you who the caller is and what roles they have. It does not automatically tell you active tenant semantics unless you model it.

Example:

```text
User Alice belongs to tenants T1 and T2.
Request: GET /tenants/T2/cases/123
```

`isCallerInRole("CASE_VIEWER")` may be true. But final decision needs:

```text
Does Alice belong to T2?
Is case 123 in T2?
Is Alice allowed to view this case state/type?
```

Do not rely on role only.

Better authorization tuple:

```text
subject: Alice
role: CASE_VIEWER
action: VIEW_CASE
resource: Case 123
tenant: T2
relationship: member/reviewer/assigned
state: ACTIVE
```

`SecurityContext` provides subject/role input. Domain authorization resolves the rest.

---

## 32. SecurityContext and Auditing

SecurityContext is useful for audit enrichment, but audit should not merely log principal name.

Weak audit:

```text
user=alice action=approve case=123
```

Better audit:

```text
actor_internal_id=42
actor_external_subject=alice@example.com
issuer=https://idp.example/realms/main
action=APPROVE_CASE
resource_type=CASE
resource_id=123
tenant_id=T1
outcome=DENIED
reason=MAKER_CANNOT_APPROVE_OWN_CASE
request_id=...
session_id_hash=...
ip=...
user_agent_hash=...
timestamp=...
```

SecurityContext provides only part of this picture.

---

## 33. Security Invariants

For systems using `SecurityContext`, define invariants.

### Invariant 1 — Protected Use Cases Must Require Actor

```text
No protected business mutation may execute without resolved Actor.
```

### Invariant 2 — Role Check Is Not Final Domain Permission

```text
Role may grant coarse capability, but resource/state/tenant policy decides final allow/deny.
```

### Invariant 3 — SecurityContext Does Not Cross Async Boundary

```text
Async/background code receives explicit Actor/SystemActor, not raw SecurityContext.
```

### Invariant 4 — Principal Name Must Be Mapped

```text
External principal name must be mapped to internal domain user before business persistence.
```

### Invariant 5 — Denial Must Be Auditable

```text
Important authorization denial must produce audit signal with safe reason.
```

### Invariant 6 — UI Visibility Is Not Enforcement

```text
Every server operation must enforce authorization regardless of UI state.
```

---

## 34. Design Checklist

Before using `SecurityContext` in a feature, ask:

```text
1. Is this endpoint public, authenticated, or role-protected?
2. What happens if getCallerPrincipal() is null?
3. Is principal name stable enough to use? If not, where is mapping?
4. Are roles logical application roles or external IdP groups?
5. Is role check sufficient, or do we need domain permission?
6. Is tenant/org boundary involved?
7. Is resource state involved?
8. Is relationship involved? owner/assignee/reviewer/delegated?
9. Is this code synchronous request code or async/background code?
10. Are we passing SecurityContext across thread boundary? If yes, stop.
11. Should denial return 401, 403, or 404?
12. Is denial audited?
13. Is success audited?
14. Does method security and programmatic security use same caller source?
15. Does testing cover unauthenticated, wrong role, right role, wrong tenant, wrong state?
```

---

## 35. Production Failure Scenarios

### Scenario 1 — Custom JWT Filter Works In Controller But Not In `@RolesAllowed`

Symptoms:

```text
GET /api/me returns user from request attribute.
@RolesAllowed("ADMIN") always denies.
```

Cause:

```text
Filter did not register caller with container.
```

Fix:

```text
Use Jakarta Security/Jakarta Authentication integration or align enforcement around one consistent mechanism.
```

---

### Scenario 2 — Async Job Logs Wrong User

Symptoms:

```text
Generated report audit sometimes shows null or previous user.
```

Cause:

```text
SecurityContext accessed inside thread pool after request context changed/lost.
```

Fix:

```text
Resolve Actor before async boundary. Pass immutable Actor to job.
```

---

### Scenario 3 — User Removed From Role But Still Can Approve

Possible causes:

```text
Session still contains old role.
Role mapping cached.
Token still valid.
Application stores role snapshot.
IdP update not propagated.
```

Fix depends on freshness requirement:

```text
Short token/session TTL.
Role version check.
Critical action reauthorization.
Back-channel session invalidation.
Policy cache invalidation.
```

---

### Scenario 4 — User Can See Other Tenant's Case

Cause:

```text
Endpoint only checked CASE_VIEWER role.
No tenant/resource check.
```

Fix:

```text
Authorization must include tenant and resource ownership/membership.
```

---

### Scenario 5 — Principal Name Changed After IdP Migration

Cause:

```text
Application used email/principal name as internal user key.
```

Fix:

```text
Introduce external identity mapping table and stable internal user id.
```

---

## 36. Java 8–25 Considerations

`SecurityContext` itself is Jakarta API, but runtime concerns differ across Java versions and application servers.

### Java 8

Common with Java EE 8 / early Jakarta EE runtimes.

Concerns:

- older namespace `javax.*`,
- older app server security integrations,
- less modern concurrency primitives,
- thread-local context bugs common in custom frameworks.

### Java 11/17

Common enterprise baseline.

Concerns:

- migration from Java EE to Jakarta EE,
- module/classpath differences,
- app server compatibility,
- security provider changes.

### Java 21+

Modern LTS baseline.

Concerns:

- virtual threads,
- structured concurrency patterns in surrounding frameworks,
- context propagation assumptions,
- modern TLS/security provider defaults.

### Java 25

Modern non-LTS/current release context depending on adoption.

Concerns:

- container support maturity,
- dependency compatibility,
- app server certified runtime support,
- avoiding assuming Jakarta runtime has fully adopted newest JDK features.

Rule:

```text
Jakarta API version, app server version, and Java runtime version must be treated as three different compatibility axes.
```

---

## 37. Practical Implementation Pattern

For serious enterprise apps, use this pattern:

### 37.1 Boundary Adapter

```java
@ApplicationScoped
public class SecurityContextCallerSource {

    @Inject
    SecurityContext securityContext;

    public Optional<String> externalSubject() {
        return Optional.ofNullable(securityContext.getCallerPrincipal())
            .map(Principal::getName);
    }

    public boolean hasRole(String role) {
        return securityContext.isCallerInRole(role);
    }
}
```

### 37.2 Actor Resolver

```java
@ApplicationScoped
public class ActorResolver {

    @Inject
    SecurityContextCallerSource callerSource;

    @Inject
    UserIdentityLinkRepository linkRepository;

    public Actor requireActor() {
        String subject = callerSource.externalSubject()
            .orElseThrow(UnauthenticatedException::new);

        UserIdentityLink link = linkRepository.requireBySubject(subject);

        return new Actor(
            link.userId(),
            subject,
            link.displayName(),
            link.roles(),
            link.tenantIds(),
            false
        );
    }
}
```

### 37.3 Authorization Service

```java
@ApplicationScoped
public class AuthorizationService {

    public void require(Actor actor, Action action, SecuredResource resource) {
        AuthorizationDecision decision = decide(actor, action, resource);
        if (!decision.allowed()) {
            throw new ForbiddenException(decision.safeReason());
        }
    }

    public AuthorizationDecision decide(Actor actor, Action action, SecuredResource resource) {
        // explicit policy logic
    }
}
```

### 37.4 Application Service

```java
@Transactional
public void performUseCase(Command command) {
    Actor actor = actorResolver.requireActor();
    Resource resource = repository.lock(command.resourceId());
    authorizationService.require(actor, command.action(), resource);
    resource.apply(command, actor);
    audit.success(actor, command, resource);
}
```

---

## 38. What A Top 1% Engineer Should Internalize

A strong engineer does not merely know that `SecurityContext.getCallerPrincipal()` returns a principal.

They understand:

```text
1. SecurityContext is a runtime view, not the identity source.
2. Principal is not necessarily domain user.
3. Role is not necessarily permission.
4. Authentication establishment happens before SecurityContext becomes meaningful.
5. Container integration matters for declarative security.
6. JAX-RS SecurityContext and Jakarta Security SecurityContext are different abstractions.
7. Thread/async/reactive boundaries can destroy context assumptions.
8. Domain authorization should be explicit, testable, and auditable.
9. UI checks are convenience, not enforcement.
10. Principal/role mapping is part of architecture, not glue code.
11. Authorization denial must be deterministic and explainable internally.
12. SecurityContext must be adapted into a stable Actor model for complex enterprise systems.
```

---

## 39. Summary

`SecurityContext` is one of the most important APIs in Jakarta Security because it is the direct way application code observes the current caller and checks logical roles.

But its correct use depends on understanding its boundary:

```text
Authentication mechanism establishes caller.
Container stores caller context.
SecurityContext exposes caller context.
Application maps caller to domain actor.
Authorization service decides resource permission.
Audit service records outcome.
```

Do not use `SecurityContext` as a replacement for identity mapping, permission engine, domain actor, or audit model.

Use it as a clean boundary adapter from Jakarta runtime into your application security model.

---

## 40. References

- Jakarta Security 4.0 Specification and API documentation.
- Jakarta Security `SecurityContext` API documentation.
- Jakarta RESTful Web Services `SecurityContext` API documentation.
- Jakarta Servlet security model and `HttpServletRequest` security methods.
- Jakarta Authentication `HttpMessageContext` documentation for registering caller principal and groups.
- Jakarta EE security model documentation from official Jakarta EE resources and compatible runtime documentation.

---

## 41. Status Seri

Selesai sampai bagian ini:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
Part 03 — Container Security Architecture
Part 04 — Servlet Security Foundation Revisited for Authentication/Authorization
Part 05 — Authentication Mechanisms: Basic, Form, Custom Form, Client Cert, OIDC
Part 06 — Jakarta Security API Core
Part 07 — SecurityContext Deep Dive
```

Seri belum selesai.

Berikutnya:

```text
Part 08 — IdentityStore Deep Dive
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 06 — Jakarta Security API Core](./learn-java-jakarta-security-authentication-authorization-identity-part-06-jakarta-security-api-core.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 08 — IdentityStore Deep Dive](./learn-java-jakarta-security-authentication-authorization-identity-part-08-identitystore-deep-dive.md)
