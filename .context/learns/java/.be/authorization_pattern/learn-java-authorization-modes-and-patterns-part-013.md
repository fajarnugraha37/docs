# learn-java-authorization-modes-and-patterns-part-013

# Part 13 — Spring Security Authorization: Servlet Stack Deep Dive

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Fokus: **request-level authorization pada Spring Security Servlet stack**  
> Target: Java 8–25, Spring Security 5.x–7.x, Spring Boot 2.x–4.x mindset  
> Status: Part 13 dari maksimal 35 part

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 12, kita sudah membangun fondasi authorization secara arsitektural:

1. Authorization sebagai sistem keputusan.
2. Vocabulary: subject, action, resource, context, policy, decision.
3. Primitive Java platform.
4. PEP/PDP/PAP/PIP.
5. RBAC, permission, ABAC, PBAC, ReBAC, ACL.
6. Tenant/data boundary.
7. IDOR/BOLA/object-level authorization.
8. Layered authorization pada Java application.

Part ini masuk ke salah satu implementasi paling umum di Java enterprise: **Spring Security Servlet authorization**.

Namun perlu ditegaskan sejak awal:

> Spring Security request authorization adalah **PEP di HTTP boundary**, bukan pengganti seluruh domain authorization.

Ia sangat kuat untuk menjawab pertanyaan seperti:

```text
Apakah request ini boleh masuk ke endpoint ini?
```

Tetapi ia tidak selalu cukup untuk menjawab:

```text
Apakah user ini boleh membaca case ID 123 milik agency X pada state REVIEW?
Apakah officer ini boleh approve case yang ia submit sendiri?
Apakah report export ini boleh berisi data tenant lain?
```

Pertanyaan kedua, ketiga, dan keempat memerlukan service/domain/data-level authorization yang sudah mulai kita bahas di part sebelumnya dan akan terus diperluas di part berikutnya.

---

## 1. Mental Model: Servlet Authorization Sebagai Gate Pertama

Spring Security Servlet stack bekerja di sekitar `jakarta.servlet.Filter`/`javax.servlet.Filter` chain.

Secara mental, request melewati beberapa lapisan:

```text
Client
  |
  v
Servlet Container
  |
  v
Spring Security Filter Chain
  |
  +-- security context loading
  +-- authentication-related filters
  +-- session/csrf/cors-related filters
  +-- exception translation
  +-- authorization filter
  |
  v
DispatcherServlet
  |
  v
Controller
  |
  v
Service
  |
  v
Repository/DB
```

Pada level Servlet, authorization biasanya terjadi sebelum controller dieksekusi.

Artinya Spring Security Servlet authorization cocok untuk:

1. Menolak anonymous request ke protected endpoint.
2. Membatasi endpoint berdasarkan authority/role/scope.
3. Mengatur endpoint publik.
4. Mengatur admin/actuator endpoint.
5. Mengatur endpoint internal.
6. Menegakkan coarse-grained route policy.
7. Menjadi fail-fast sebelum request masuk ke business layer.

Tetapi ia tidak otomatis tahu:

1. Owner dari object ID di path.
2. Tenant dari record di database.
3. State domain object.
4. Maker-checker invariant.
5. Dynamic assignment.
6. Row-level visibility.
7. Export result content.

Maka prinsipnya:

> Gunakan Servlet authorization untuk **route/function-level gate**, lalu gunakan service/domain/data authorization untuk **object/business/data-level gate**.

---

## 2. Evolusi Spring Security Authorization API

Spring Security mengalami evolusi besar dalam cara authorization dikonfigurasi.

### 2.1 Gaya Lama: `authorizeRequests`

Di Spring Security 5.x, banyak aplikasi memakai bentuk seperti:

```java
http
    .authorizeRequests()
    .antMatchers("/public/**").permitAll()
    .antMatchers("/admin/**").hasRole("ADMIN")
    .anyRequest().authenticated();
```

Model ini historically bekerja dengan:

1. metadata source,
2. config attributes,
3. access decision manager,
4. voters,
5. expression handlers.

Masih penting dipahami saat membaca legacy code, tetapi untuk desain modern bukan titik awal terbaik.

### 2.2 Gaya Modern: `authorizeHttpRequests`

Spring Security modern mendorong konfigurasi berbasis `AuthorizationManager`:

```java
http
    .authorizeHttpRequests(auth -> auth
        .requestMatchers("/public/**").permitAll()
        .requestMatchers("/admin/**").hasAuthority("admin.access")
        .anyRequest().authenticated()
    );
```

Mental model-nya lebih langsung:

```text
Request masuk
  -> pilih matcher yang cocok
  -> jalankan AuthorizationManager terkait
  -> hasil: grant/deny/abstain-ish behavior depending manager
```

Spring Security documentation menjelaskan bahwa `AuthorizationFilter` meneruskan `Supplier<Authentication>` dan `HttpServletRequest` ke `AuthorizationManager`; manager mencocokkan request terhadap rule di `authorizeHttpRequests`, lalu jika denied akan memicu `AccessDeniedException` yang ditangani oleh `ExceptionTranslationFilter`.

### 2.3 Kenapa `AuthorizationManager` Penting

`AuthorizationManager<T>` menyederhanakan konsep authorization menjadi:

```java
AuthorizationDecision check(Supplier<Authentication> authentication, T object);
```

atau pada versi lebih baru:

```java
AuthorizationResult authorize(Supplier<? extends Authentication> authentication, T object);
```

Intinya:

```text
Given authentication + secured object, decide whether access is granted.
```

Untuk Servlet request authorization, secured object-nya adalah `HttpServletRequest`.

Untuk method security, secured object-nya method invocation.

Untuk message security, secured object-nya message.

Ini sejalan dengan model umum yang sudah kita bangun:

```text
subject  = Authentication/principal
resource = request path/endpoint/function
context  = HttpServletRequest + headers + method + servlet data
policy   = AuthorizationManager
result   = granted/denied
```

---

## 3. Core Runtime Objects

### 3.1 `SecurityFilterChain`

`SecurityFilterChain` adalah konfigurasi security untuk subset request tertentu.

Contoh minimal:

```java
@Bean
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .anyRequest().authenticated()
        )
        .build();
}
```

Mental model penting:

```text
securityMatcher menentukan apakah filter chain ini berlaku untuk request.
requestMatchers di dalam authorizeHttpRequests menentukan authorization rule dalam chain tersebut.
```

Banyak bug terjadi karena engineer mencampur dua hal ini.

### 3.2 `FilterChainProxy`

Spring Security memasang satu filter utama ke Servlet container, biasanya bernama:

```text
springSecurityFilterChain
```

Filter ini adalah proxy yang memilih `SecurityFilterChain` yang sesuai dengan request.

Jika ada multiple chain:

```java
@Bean
@Order(1)
SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/actuator/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health").permitAll()
            .anyRequest().hasAuthority("ops.actuator.read")
        )
        .build();
}

@Bean
@Order(2)
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .anyRequest().authenticated()
        )
        .build();
}
```

Maka order matters.

A request hanya diproses oleh chain pertama yang match.

### 3.3 `SecurityContext`

`SecurityContext` menyimpan `Authentication` untuk request saat ini.

```java
Authentication authentication = SecurityContextHolder
    .getContext()
    .getAuthentication();
```

Namun untuk authorization design, jangan biasakan service layer langsung membaca `SecurityContextHolder` secara liar.

Lebih baik:

1. boundary adapter membaca authentication,
2. ubah menjadi application-specific `CurrentUser`, `Subject`, atau `ActorContext`,
3. oper ke service/domain authorization secara eksplisit.

Contoh:

```java
public final class CurrentActor {
    private final String userId;
    private final String tenantId;
    private final Set<String> authorities;

    public CurrentActor(String userId, String tenantId, Set<String> authorities) {
        this.userId = userId;
        this.tenantId = tenantId;
        this.authorities = Set.copyOf(authorities);
    }

    public String userId() {
        return userId;
    }

    public String tenantId() {
        return tenantId;
    }

    public boolean hasAuthority(String authority) {
        return authorities.contains(authority);
    }
}
```

Kenapa?

Karena `SecurityContextHolder` adalah infrastructure context, bukan domain model.

### 3.4 `Authentication`

`Authentication` mengandung:

1. principal,
2. credentials,
3. authorities,
4. authenticated flag,
5. details.

Untuk authorization, bagian yang paling sering dipakai adalah:

```java
Collection<? extends GrantedAuthority> getAuthorities();
Object getPrincipal();
boolean isAuthenticated();
```

Tetapi jangan menganggap semua `Authentication` sama.

Contoh tipe yang bisa muncul:

1. `UsernamePasswordAuthenticationToken`.
2. `JwtAuthenticationToken`.
3. `BearerTokenAuthentication`.
4. `OAuth2AuthenticationToken`.
5. `AnonymousAuthenticationToken`.
6. Custom authentication token.

Akibatnya, kode authorization yang melakukan cast langsung ke satu tipe sering rapuh.

Buruk:

```java
Jwt jwt = (Jwt) authentication.getPrincipal();
String tenantId = jwt.getClaimAsString("tenant_id");
```

Lebih baik:

```java
public interface ActorResolver {
    CurrentActor resolve(Authentication authentication);
}
```

Lalu semua variasi principal ditangani di satu tempat.

### 3.5 `GrantedAuthority`

`GrantedAuthority` adalah string authority.

Contoh:

```text
ROLE_ADMIN
case.read
case.approve
SCOPE_report.export
```

Masalahnya: karena ia string, ia mudah typo, overloaded, dan ambigu.

Maka dalam sistem besar, authority string harus diperlakukan sebagai kontrak.

Contoh lebih aman:

```java
public final class Authorities {
    private Authorities() {}

    public static final String CASE_READ = "case.read";
    public static final String CASE_APPROVE = "case.approve";
    public static final String REPORT_EXPORT = "report.export";
    public static final String ACTUATOR_READ = "ops.actuator.read";
}
```

Untuk Java 17+, kita bisa tambah sealed/value model di domain, tetapi di boundary Spring Security tetap harus menjadi string authority.

---

## 4. Role vs Authority di Spring Security

### 4.1 `hasRole` Menambahkan Prefix

Di Spring Security, `hasRole("ADMIN")` biasanya memeriksa authority:

```text
ROLE_ADMIN
```

Bukan:

```text
ADMIN
```

Sedangkan:

```java
.hasAuthority("admin.access")
```

memeriksa persis string:

```text
admin.access
```

Ini sumber bug umum.

Contoh salah:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/admin/**").hasRole("ROLE_ADMIN")
)
```

Karena bisa berarti Spring mencari:

```text
ROLE_ROLE_ADMIN
```

Tergantung versi/configuration.

Lebih jelas:

```java
.requestMatchers("/admin/**").hasAuthority("admin.access")
```

### 4.2 Kapan Pakai Role

Pakai role jika:

1. sistem kecil,
2. role stabil,
3. authorization coarse-grained,
4. tidak butuh scope kompleks,
5. tidak butuh permission-level audit.

Contoh:

```java
.requestMatchers("/admin/**").hasRole("ADMIN")
```

### 4.3 Kapan Pakai Authority/Permission

Pakai authority/permission jika:

1. sistem enterprise,
2. banyak modul,
3. role berubah tapi capability relatif stabil,
4. perlu audit permission,
5. perlu role-permission mapping,
6. perlu migrasi RBAC ke ABAC/PBAC di masa depan.

Contoh:

```java
.requestMatchers(HttpMethod.GET, "/api/cases/**")
    .hasAuthority(Authorities.CASE_READ)

.requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
    .hasAuthority(Authorities.CASE_APPROVE)
```

Namun ingat: ini masih route-level. `case.approve` di route belum memastikan user boleh approve **case tertentu**.

---

## 5. `authorizeHttpRequests` Rule Ordering

Rule authorization dievaluasi berdasarkan urutan.

Contoh berbahaya:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/**").authenticated()
    .requestMatchers("/api/admin/**").hasAuthority("admin.access")
    .anyRequest().denyAll()
)
```

Masalah:

```text
/api/admin/** sudah match oleh /api/** lebih dulu.
```

Maka admin endpoint hanya butuh authenticated, bukan `admin.access`.

Benar:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/admin/**").hasAuthority("admin.access")
    .requestMatchers("/api/**").authenticated()
    .anyRequest().denyAll()
)
```

Prinsip:

```text
Specific before general.
Deny-all fallback.
No implicit leftovers.
```

---

## 6. `anyRequest`: `authenticated`, `permitAll`, atau `denyAll`?

### 6.1 `anyRequest().authenticated()`

Banyak contoh menggunakan:

```java
.anyRequest().authenticated()
```

Ini cukup baik untuk aplikasi sederhana.

Tetapi untuk sistem enterprise, ini sering terlalu longgar karena endpoint baru otomatis boleh diakses semua authenticated user.

### 6.2 `anyRequest().denyAll()`

Untuk sistem ketat, gunakan:

```java
.anyRequest().denyAll()
```

Artinya endpoint baru harus secara eksplisit diberi rule.

Ini lebih aman untuk:

1. regulatory systems,
2. admin systems,
3. internal APIs,
4. multi-tenant systems,
5. high-risk systems.

### 6.3 Hybrid Pattern

Kadang kita ingin semua `/api/**` harus authenticated, tapi endpoint sensitif perlu authority eksplisit.

Contoh:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/admin/**").hasAuthority("admin.access")
    .requestMatchers("/api/reports/export/**").hasAuthority("report.export")
    .requestMatchers("/api/**").authenticated()
    .anyRequest().denyAll()
)
```

Ini dapat diterima, tetapi harus sadar konsekuensinya:

```text
Endpoint baru di /api/** otomatis accessible oleh semua authenticated user.
```

Untuk sistem yang sangat defensif, lebih baik:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("case.read")
    .requestMatchers(HttpMethod.POST, "/api/cases/**").hasAuthority("case.write")
    .requestMatchers("/api/reports/export/**").hasAuthority("report.export")
    .anyRequest().denyAll()
)
```

---

## 7. Matcher Semantics: Path, Method, MVC, Regex

### 7.1 Path Matcher

Contoh:

```java
.requestMatchers("/api/cases/**").hasAuthority("case.read")
```

Perhatikan:

```text
/api/cases/**
```

bisa mencakup:

```text
/api/cases/123
/api/cases/123/approve
/api/cases/export
/api/cases/internal/reindex
```

Jika semua diberi authority yang sama, kemungkinan terlalu longgar.

### 7.2 Method-Specific Matcher

Lebih baik gunakan HTTP method jika makna action berbeda:

```java
.requestMatchers(HttpMethod.GET, "/api/cases/**")
    .hasAuthority("case.read")

.requestMatchers(HttpMethod.POST, "/api/cases")
    .hasAuthority("case.create")

.requestMatchers(HttpMethod.PUT, "/api/cases/*")
    .hasAuthority("case.update")

.requestMatchers(HttpMethod.DELETE, "/api/cases/*")
    .hasAuthority("case.delete")
```

Namun jangan terlalu CRUD-minded. Untuk command penting, pakai endpoint dan permission spesifik:

```java
.requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
    .hasAuthority("case.approve")

.requestMatchers(HttpMethod.POST, "/api/cases/*/reassign")
    .hasAuthority("case.reassign")
```

### 7.3 MVC Matcher vs Ant Matcher

Dalam Spring MVC application, path matching behavior dapat dipengaruhi oleh MVC path matching rules.

Top 1% mindset:

> Jangan hanya bertanya “apakah pattern terlihat benar”, tetapi “apakah matcher menggunakan semantik yang sama dengan routing MVC?”

Mismatch antara security matcher dan controller mapping dapat menyebabkan endpoint tidak terlindungi sebagaimana diasumsikan.

### 7.4 Regex Matcher

Regex matcher berguna untuk kasus tertentu, tetapi jangan jadikan default.

Contoh:

```java
.requestMatchers(RegexRequestMatcher.regexMatcher("/api/v[0-9]+/admin/.*"))
    .hasAuthority("admin.access")
```

Risiko:

1. regex sulit dibaca,
2. raw pattern sulit diaudit,
3. mismatch mudah terjadi,
4. performance biasanya bukan masalah utama, tetapi complexity iya.

Gunakan regex hanya jika path grammar memang membutuhkan regex.

---

## 8. `securityMatcher` vs `requestMatchers`

Ini salah satu area paling sering membingungkan.

### 8.1 `securityMatcher`

`securityMatcher` menentukan **apakah SecurityFilterChain ini berlaku**.

Contoh:

```java
http.securityMatcher("/api/**")
```

Artinya chain ini hanya dipakai untuk request `/api/**`.

### 8.2 `requestMatchers`

`requestMatchers` di dalam `authorizeHttpRequests` menentukan **authorization rule dalam chain tersebut**.

Contoh:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/admin/**").hasAuthority("admin.access")
    .anyRequest().authenticated()
)
```

### 8.3 Bug Umum

Misalnya:

```java
@Bean
@Order(1)
SecurityFilterChain api(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/admin/**").hasAuthority("admin.access")
            .anyRequest().authenticated()
        )
        .build();
}
```

Maksud developer mungkin ingin protect `/api/admin/**`, tetapi rule `/admin/**` tidak match karena request path masih `/api/admin/**`.

Benar:

```java
.requestMatchers("/api/admin/**").hasAuthority("admin.access")
```

atau gunakan chain khusus:

```java
.securityMatcher("/api/admin/**")
.authorizeHttpRequests(auth -> auth
    .anyRequest().hasAuthority("admin.access")
)
```

---

## 9. Multiple Security Filter Chains

Multiple chains berguna ketika endpoint berbeda memerlukan mode security berbeda.

Contoh:

1. `/actuator/**` untuk ops.
2. `/api/**` untuk user API.
3. `/internal/**` untuk service-to-service.
4. `/webhook/**` untuk external callback.
5. `/public/**` untuk public endpoint.

Contoh konfigurasi:

```java
@Configuration
@EnableWebSecurity
class SecurityConfiguration {

    @Bean
    @Order(1)
    SecurityFilterChain actuator(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/actuator/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                .anyRequest().hasAuthority("ops.actuator.read")
            )
            .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain internal(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/internal/**")
            .authorizeHttpRequests(auth -> auth
                .anyRequest().hasAuthority("system.internal.call")
            )
            .build();
    }

    @Bean
    @Order(3)
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/cases/**")
                    .hasAuthority("case.read")
                .requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
                    .hasAuthority("case.approve")
                .anyRequest().denyAll()
            )
            .build();
    }
}
```

### 9.1 Multiple Chain Failure Modes

| Failure | Penyebab | Dampak |
|---|---|---|
| Chain terlalu general ditempatkan di order awal | `/api/**` sebelum `/api/admin/**` | Admin rule tidak pernah dipakai |
| Chain tidak punya fallback deny | endpoint baru otomatis lolos | accidental exposure |
| Public chain terlalu luas | `/public/**` mengandung file sensitif | data leakage |
| Internal chain hanya pakai path | endpoint internal bisa dipanggil dari luar jika routing salah | privilege bypass |
| Actuator chain terlupa | actuator ikut default chain | ops endpoint exposed atau unusable |

### 9.2 Design Rule

```text
Each SecurityFilterChain should answer:
1. Which requests does this chain own?
2. What identity mechanism applies?
3. What authorization rules apply?
4. What is the fallback?
5. What tests prove it?
```

---

## 10. Custom `AuthorizationManager` untuk Servlet Request

Built-in rule cukup untuk banyak kasus, tetapi sistem besar sering butuh custom logic.

Contoh kebutuhan:

1. Tenant di header harus sama dengan tenant subject.
2. Endpoint hanya boleh dipanggil dari internal network.
3. Specific API version perlu capability tertentu.
4. Request attribute perlu divalidasi.
5. Maintenance mode deny kecuali ops.
6. Feature flag authorization.

### 10.1 Custom Manager Sederhana

```java
public final class TenantHeaderAuthorizationManager
        implements AuthorizationManager<HttpServletRequest> {

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authenticationSupplier,
            HttpServletRequest request
    ) {
        Authentication authentication = authenticationSupplier.get();

        if (authentication == null || !authentication.isAuthenticated()) {
            return new AuthorizationDecision(false);
        }

        String requestedTenant = request.getHeader("X-Tenant-Id");
        if (requestedTenant == null || requestedTenant.isBlank()) {
            return new AuthorizationDecision(false);
        }

        String actorTenant = resolveTenant(authentication);
        boolean allowed = requestedTenant.equals(actorTenant);

        return new AuthorizationDecision(allowed);
    }

    private String resolveTenant(Authentication authentication) {
        Object principal = authentication.getPrincipal();

        if (principal instanceof CustomUserPrincipal user) {
            return user.tenantId();
        }

        throw new IllegalStateException("Unsupported principal type: " + principal.getClass());
    }
}
```

Pemakaian:

```java
@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    AuthorizationManager<HttpServletRequest> tenantGuard =
        new TenantHeaderAuthorizationManager();

    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/**").access(tenantGuard)
            .anyRequest().denyAll()
        )
        .build();
}
```

### 10.2 Masalah Dengan Contoh Di Atas

Contoh di atas berguna untuk belajar, tetapi belum production-grade.

Masalah:

1. Logic tenant bercampur di web layer.
2. Tidak ada reason code.
3. Tidak ada audit decision.
4. Tidak ada observability.
5. Error unsupported principal bisa jadi 500.
6. Header tenant dari client tidak boleh dipercaya begitu saja.
7. Tidak ada normalization.
8. Tidak ada mapping untuk JWT/resource server principal.

Lebih baik custom manager menjadi adapter ke authorization service:

```java
public final class HttpAuthorizationManager
        implements AuthorizationManager<HttpServletRequest> {

    private final ActorResolver actorResolver;
    private final RouteAuthorizationService authorizationService;

    public HttpAuthorizationManager(
            ActorResolver actorResolver,
            RouteAuthorizationService authorizationService
    ) {
        this.actorResolver = actorResolver;
        this.authorizationService = authorizationService;
    }

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authenticationSupplier,
            HttpServletRequest request
    ) {
        Authentication authentication = authenticationSupplier.get();
        CurrentActor actor = actorResolver.resolve(authentication);
        RouteAccessRequest accessRequest = RouteAccessRequest.from(request);

        PolicyDecision decision = authorizationService.decide(actor, accessRequest);

        return new AuthorizationDecision(decision.isAllowed());
    }
}
```

Kemudian `RouteAuthorizationService` bisa mencatat reason/evidence/audit secara internal.

---

## 11. Route Authorization vs Domain Authorization

Misalnya:

```java
.requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
    .hasAuthority("case.approve")
```

Ini hanya menjawab:

```text
Apakah user punya capability approve case secara umum?
```

Belum menjawab:

```text
Apakah user boleh approve case ID 123?
```

Maka controller/service tetap perlu:

```java
@PostMapping("/api/cases/{caseId}/approve")
public ResponseEntity<Void> approve(@PathVariable UUID caseId) {
    CurrentActor actor = actorProvider.currentActor();
    caseApprovalService.approve(actor, caseId);
    return ResponseEntity.noContent().build();
}
```

Service:

```java
@Transactional
public void approve(CurrentActor actor, UUID caseId) {
    CaseRecord caseRecord = caseRepository.findByIdForUpdate(caseId)
        .orElseThrow(() -> new NotFoundException("Case not found"));

    PolicyDecision decision = caseAuthorization.canApprove(actor, caseRecord);

    if (!decision.isAllowed()) {
        throw new AccessDeniedException(decision.safeMessage());
    }

    caseRecord.approveBy(actor.userId());
}
```

Prinsip:

```text
Route-level authority is necessary but not sufficient.
```

---

## 12. Static Assets and Public Endpoints

### 12.1 Public Endpoint Harus Eksplisit

Contoh:

```java
.requestMatchers(
    "/",
    "/index.html",
    "/assets/**",
    "/favicon.ico"
).permitAll()
```

Hindari:

```java
.requestMatchers("/**").permitAll()
```

atau public matcher terlalu luas:

```java
.requestMatchers("/static/**", "/files/**").permitAll()
```

Jika `/files/**` berisi upload user atau generated document, itu bukan static asset.

### 12.2 SPA Consideration

Untuk SPA:

```text
/index.html boleh publik
/assets/*.js boleh publik
/api/** tetap protected
```

Contoh:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/", "/index.html", "/assets/**", "/favicon.ico").permitAll()
    .requestMatchers("/api/**").authenticated()
    .anyRequest().denyAll()
)
```

Jika SPA routing butuh fallback ke `index.html`, jangan membuat seluruh backend `permitAll`.

---

## 13. Actuator Authorization

Spring Boot Actuator sering menjadi sumber risiko.

Endpoint seperti:

1. `/actuator/health`,
2. `/actuator/info`,
3. `/actuator/metrics`,
4. `/actuator/env`,
5. `/actuator/beans`,
6. `/actuator/threaddump`,
7. `/actuator/heapdump`,
8. `/actuator/prometheus`,

punya sensitivitas berbeda.

Pattern:

```java
@Bean
@Order(1)
SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/actuator/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/health", "/actuator/info").permitAll()
            .requestMatchers("/actuator/prometheus").hasAuthority("ops.metrics.read")
            .anyRequest().hasAuthority("ops.actuator.admin")
        )
        .build();
}
```

Design consideration:

| Endpoint | Typical Exposure | Notes |
|---|---|---|
| health liveness | public/internal LB | keep minimal details |
| health readiness | internal | may expose dependency status |
| info | public/internal | avoid secrets/build metadata overexposure |
| metrics/prometheus | internal monitoring | may expose path names, status, cardinality |
| env/configprops | highly restricted | can leak config/secrets |
| heapdump/threaddump | highly restricted | sensitive memory/runtime data |

Top 1% rule:

> Do not treat all actuator endpoints as equally safe.

---

## 14. CORS, CSRF, and Authorization Boundary

CORS and CSRF are not authorization, but they interact with authorization boundary.

### 14.1 CORS Is Browser Access Control, Not Server Authorization

CORS answers:

```text
Should browser JavaScript from origin A be allowed to read response from origin B?
```

It does not answer:

```text
Is user allowed to perform action X?
```

Server-side authorization must still happen.

Bad assumption:

```text
CORS restricts frontend origin, therefore endpoint is protected.
```

Wrong. Non-browser clients can call endpoint directly.

### 14.2 CSRF Is Request Forgery Defense

CSRF matters when browser automatically sends credentials such as cookies.

For stateless bearer-token APIs, CSRF handling differs from cookie-session web apps.

But never say:

```text
CSRF disabled = authorization disabled.
```

They are separate controls.

### 14.3 Production Mental Model

```text
CORS: browser read permission boundary.
CSRF: protects authenticated browser session from forged state-changing request.
Authorization: decides whether subject may perform action on resource.
```

---

## 15. Exception Flow: `401`, `403`, and `AccessDeniedException`

### 15.1 Authentication Failure vs Authorization Denial

Typical HTTP mapping:

| Situation | Response |
|---|---:|
| No/invalid authentication | 401 |
| Authenticated but insufficient authority | 403 |
| Resource hidden intentionally | 404 |

Spring Security uses exception translation to map security exceptions.

### 15.2 Custom Access Denied Handler

Example:

```java
@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .anyRequest().authenticated()
        )
        .exceptionHandling(ex -> ex
            .accessDeniedHandler((request, response, accessDeniedException) -> {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType("application/json");
                response.getWriter().write("""
                    {"error":"access_denied"}
                    """);
            })
        )
        .build();
}
```

Production version should include:

1. correlation ID,
2. safe error code,
3. no sensitive policy detail,
4. consistent JSON structure,
5. audit/metric emission.

Example response:

```json
{
  "error": "access_denied",
  "code": "AUTHZ_ROUTE_DENIED",
  "correlationId": "7a1c0d7e"
}
```

Do not expose:

```json
{
  "error": "You are denied because role CASE_REVIEWER_AGENCY_12 is missing and case belongs to agency 13"
}
```

That leaks internal structure.

---

## 16. Authorization Events and Observability

Spring Security can publish authorization-related events. Even if not using built-in events directly, production systems should observe authorization.

Useful metrics:

1. authorization decisions by endpoint,
2. denied count by reason code,
3. denied count by authority,
4. public endpoint hits,
5. admin endpoint hits,
6. internal endpoint denied,
7. actuator denied,
8. anonymous denied,
9. suspicious path denied,
10. matcher fallback denied.

Useful logs:

```json
{
  "event": "authorization_denied",
  "layer": "servlet",
  "subject": "user:12345",
  "path": "/api/cases/789/approve",
  "method": "POST",
  "required": "case.approve",
  "reasonCode": "MISSING_AUTHORITY",
  "correlationId": "..."
}
```

But do not log:

1. raw access tokens,
2. passwords,
3. full PII payload,
4. sensitive claims without masking,
5. secrets in headers.

---

## 17. Request-Level Authorization Matrix

For large systems, `SecurityFilterChain` should be derived from an explicit matrix, not grown organically.

Example:

| Method | Path | Public? | Required Authority | Additional Domain Check |
|---|---|---:|---|---|
| GET | `/api/cases` | no | `case.search` | query scoping |
| GET | `/api/cases/{id}` | no | `case.read` | can view case object |
| POST | `/api/cases` | no | `case.create` | tenant/category validation |
| POST | `/api/cases/{id}/submit` | no | `case.submit` | owner/state check |
| POST | `/api/cases/{id}/approve` | no | `case.approve` | maker-checker/state/assignment |
| POST | `/api/cases/{id}/reassign` | no | `case.reassign` | supervisor/team boundary |
| GET | `/api/reports/export` | no | `report.export` | dataset scoping/export policy |
| GET | `/actuator/health` | yes | none | details restricted |
| GET | `/actuator/prometheus` | no | `ops.metrics.read` | network boundary |

Then config becomes an implementation of matrix, not source of truth by accident.

---

## 18. Example: Production-Oriented API Security Configuration

```java
@Configuration
@EnableWebSecurity
public class ApiSecurityConfiguration {

    @Bean
    @Order(1)
    SecurityFilterChain actuatorSecurity(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/actuator/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                .requestMatchers("/actuator/prometheus").hasAuthority("ops.metrics.read")
                .anyRequest().hasAuthority("ops.actuator.admin")
            )
            .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain publicSecurity(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/", "/index.html", "/assets/**", "/favicon.ico")
            .authorizeHttpRequests(auth -> auth
                .anyRequest().permitAll()
            )
            .build();
    }

    @Bean
    @Order(3)
    SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/cases")
                    .hasAuthority("case.search")
                .requestMatchers(HttpMethod.GET, "/api/cases/*")
                    .hasAuthority("case.read")
                .requestMatchers(HttpMethod.POST, "/api/cases")
                    .hasAuthority("case.create")
                .requestMatchers(HttpMethod.POST, "/api/cases/*/submit")
                    .hasAuthority("case.submit")
                .requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
                    .hasAuthority("case.approve")
                .requestMatchers(HttpMethod.POST, "/api/cases/*/reassign")
                    .hasAuthority("case.reassign")
                .requestMatchers(HttpMethod.GET, "/api/reports/export")
                    .hasAuthority("report.export")
                .anyRequest().denyAll()
            )
            .exceptionHandling(ex -> ex
                .accessDeniedHandler(new JsonAccessDeniedHandler())
                .authenticationEntryPoint(new JsonAuthenticationEntryPoint())
            )
            .build();
    }
}
```

Important:

1. The chain has explicit ownership.
2. The API chain uses deny-all fallback.
3. Sensitive commands have explicit permissions.
4. Actuator is separate.
5. Static assets are separate.
6. Domain authorization still happens in services.

---

## 19. Java 8–25 Compatibility Notes

### 19.1 Java 8

Java 8 constraints:

1. no records,
2. no sealed types,
3. no pattern matching,
4. older Spring Security versions likely,
5. `javax.servlet` era for older stacks.

Use explicit final classes:

```java
public final class RouteAccessRequest {
    private final String method;
    private final String path;

    public RouteAccessRequest(String method, String path) {
        this.method = method;
        this.path = path;
    }

    public String method() {
        return method;
    }

    public String path() {
        return path;
    }
}
```

### 19.2 Java 17+

Can use records:

```java
public record RouteAccessRequest(
    String method,
    String path,
    Map<String, String> attributes
) {}
```

Can use sealed decision hierarchy:

```java
public sealed interface PolicyDecision permits AllowDecision, DenyDecision {
    boolean allowed();
    String reasonCode();
}

public record AllowDecision(String reasonCode) implements PolicyDecision {
    @Override
    public boolean allowed() {
        return true;
    }
}

public record DenyDecision(String reasonCode) implements PolicyDecision {
    @Override
    public boolean allowed() {
        return false;
    }
}
```

### 19.3 Java 21–25

Virtual threads do not change authorization semantics.

But they affect assumptions around thread-local context.

Spring Security Servlet stack historically relies on thread-bound context. In modern Java, be careful with:

1. async request processing,
2. executor handoff,
3. scheduled jobs,
4. virtual-thread executors,
5. custom thread pools.

Never assume `SecurityContextHolder` magically propagates everywhere.

For explicit domain authorization, prefer passing `CurrentActor` or `AuthorizationContext` explicitly.

---

## 20. Async Servlet and Context Propagation

Servlet async or application async can break naive assumptions.

Bad:

```java
CompletableFuture.runAsync(() -> {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    // may be null or wrong depending context propagation
});
```

Better:

```java
CurrentActor actor = actorProvider.currentActor();

CompletableFuture.runAsync(() -> {
    service.performAuthorizedWork(actor, command);
}, executor);
```

For background jobs, do not reuse end-user request context accidentally.

Use explicit workload identity:

```java
CurrentActor systemActor = CurrentActor.system("case-expiry-job");
```

Then authorize as system actor with constrained capabilities.

---

## 21. Testing Servlet Authorization

### 21.1 Test What Matters

You need tests for:

1. public endpoints are public,
2. protected endpoints reject anonymous,
3. insufficient authority returns 403,
4. required authority returns non-403,
5. fallback denies unknown endpoint,
6. matcher order works,
7. method-specific rule works,
8. admin/actuator/internal chain isolation works.

### 21.2 MockMvc Example

```java
@WebMvcTest(CaseController.class)
@Import(ApiSecurityConfiguration.class)
class CaseControllerAuthorizationTest {

    @Autowired
    MockMvc mvc;

    @Test
    void getCase_withoutAuthentication_returnsUnauthorized() throws Exception {
        mvc.perform(get("/api/cases/123"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(authorities = "case.read")
    void getCase_withCaseReadAuthority_passesRouteAuthorization() throws Exception {
        mvc.perform(get("/api/cases/123"))
            .andExpect(status().isOk());
    }

    @Test
    @WithMockUser(authorities = "case.read")
    void approveCase_withoutApproveAuthority_returnsForbidden() throws Exception {
        mvc.perform(post("/api/cases/123/approve"))
            .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(authorities = "case.approve")
    void approveCase_withApproveAuthority_passesRouteAuthorization() throws Exception {
        mvc.perform(post("/api/cases/123/approve"))
            .andExpect(status().isNoContent());
    }

    @Test
    @WithMockUser(authorities = "case.read")
    void unknownApiEndpoint_isDeniedByFallback() throws Exception {
        mvc.perform(get("/api/debug/secret"))
            .andExpect(status().isForbidden());
    }
}
```

Note:

1. These tests verify route authorization.
2. Domain authorization still needs service tests.
3. Controller behavior may need mocks to avoid false failures.

### 21.3 RequestPostProcessor Example

```java
mvc.perform(get("/api/cases/123")
        .with(user("alice").authorities(new SimpleGrantedAuthority("case.read"))))
    .andExpect(status().isOk());
```

Useful when each test needs different authority setup.

### 21.4 JWT Resource Server Test Example

For JWT-based APIs:

```java
mvc.perform(get("/api/cases/123")
        .with(jwt().authorities(new SimpleGrantedAuthority("case.read"))))
    .andExpect(status().isOk());
```

This tests mapping from JWT-style authentication to authorities when configured appropriately.

### 21.5 Test Matrix Pattern

Instead of writing only happy path tests, build matrix:

| Endpoint | Anonymous | Auth no authority | Correct authority | Wrong method |
|---|---:|---:|---:|---:|
| GET `/api/cases/123` | 401 | 403 | OK | n/a |
| POST `/api/cases/123/approve` | 401 | 403 | OK | 403/405 |
| GET `/actuator/prometheus` | 401/403 | 403 | OK | n/a |
| GET `/api/debug/secret` | 401 | 403 | 403 | n/a |

This catches rule ordering and fallback mistakes.

---

## 22. Static Analysis Checklist for Security Config

When reviewing Spring Security config, ask:

1. Is there more than one `SecurityFilterChain`?
2. Are chains ordered from specific to general?
3. Does every chain have a `securityMatcher`?
4. Does every chain have an explicit fallback?
5. Is fallback `denyAll` where appropriate?
6. Are public endpoints minimal?
7. Are actuator endpoints separated?
8. Are internal endpoints protected beyond path?
9. Are method-specific routes protected?
10. Are command endpoints protected by command-specific authority?
11. Is `hasRole` used consistently with role prefix?
12. Are authorities centralized as constants or generated metadata?
13. Are route-level checks backed by domain-level checks?
14. Are tests covering denial paths?
15. Are unknown endpoints denied?
16. Are file/download/export endpoints separately protected?
17. Are OpenAPI docs aligned with security config?
18. Are error responses safe?
19. Are authorization denials logged/observed?
20. Is there a documented owner for each endpoint policy?

---

## 23. Common Anti-Patterns

### 23.1 `anyRequest().permitAll()` During Development

Often introduced temporarily and forgotten.

```java
.anyRequest().permitAll()
```

In serious systems this should be treated as a high-risk finding.

### 23.2 `authenticated()` Everywhere

```java
.anyRequest().authenticated()
```

This does not distinguish:

1. normal user,
2. officer,
3. supervisor,
4. admin,
5. support,
6. auditor.

For many systems, authenticated is not authorization enough.

### 23.3 Role God Mode

```java
.requestMatchers("/**").hasRole("ADMIN")
```

This creates broad privilege and hides missing permission modeling.

### 23.4 Controller Path Drift

Controller changes:

```java
@PostMapping("/api/cases/{id}/approve")
```

Security config still protects:

```java
.requestMatchers("/api/case/*/approve")
```

Singular/plural mismatch = possible unprotected route depending fallback.

### 23.5 Public File Path

```java
.requestMatchers("/files/**").permitAll()
```

But `/files/**` includes user-uploaded documents.

### 23.6 Scope/Authority Mismatch

JWT has:

```text
SCOPE_case.read
```

Config checks:

```java
.hasAuthority("case.read")
```

Result: unexpected 403.

Or config checks:

```java
.hasAuthority("SCOPE_case.read")
```

but internal permission model uses:

```text
case.read
```

Need explicit mapping.

### 23.7 Path-Based Internal Trust

```java
.requestMatchers("/internal/**").permitAll()
```

Assumption:

```text
Only internal network can reach it.
```

This is fragile. Use authentication/authorization for internal APIs too.

---

## 24. Better Pattern: Route Policy Registry

For very large systems, hardcoding all route rules inside `HttpSecurity` can become hard to review.

A route registry can make intent explicit.

```java
public enum RoutePolicy {
    CASE_SEARCH(HttpMethod.GET, "/api/cases", "case.search"),
    CASE_READ(HttpMethod.GET, "/api/cases/*", "case.read"),
    CASE_APPROVE(HttpMethod.POST, "/api/cases/*/approve", "case.approve"),
    REPORT_EXPORT(HttpMethod.GET, "/api/reports/export", "report.export");

    private final HttpMethod method;
    private final String pattern;
    private final String authority;

    RoutePolicy(HttpMethod method, String pattern, String authority) {
        this.method = method;
        this.pattern = pattern;
        this.authority = authority;
    }

    public HttpMethod method() {
        return method;
    }

    public String pattern() {
        return pattern;
    }

    public String authority() {
        return authority;
    }
}
```

Then:

```java
.authorizeHttpRequests(auth -> {
    for (RoutePolicy policy : RoutePolicy.values()) {
        auth.requestMatchers(policy.method(), policy.pattern())
            .hasAuthority(policy.authority());
    }
    auth.anyRequest().denyAll();
})
```

This is not always necessary, but useful when:

1. many endpoints,
2. security review requires matrix,
3. OpenAPI generation needs alignment,
4. permission catalog is maintained separately,
5. route policies need testing/reporting.

---

## 25. Aligning Spring Security with OpenAPI

Route authorization should not be tribal knowledge.

For each endpoint, API documentation should indicate security requirement.

Example conceptual OpenAPI metadata:

```yaml
/api/cases/{id}/approve:
  post:
    x-required-authority: case.approve
    x-domain-authorization: caseAuthorization.canApprove(actor, case)
```

This helps:

1. frontend know required permission for UI affordance,
2. QA build test matrix,
3. security review compare actual config vs contract,
4. auditors understand route access,
5. migration tooling detect drift.

But remember: OpenAPI metadata is not enforcement.

---

## 26. Authorization and UI Feature Flags

A common pattern:

1. backend route protected by authority,
2. frontend hides button if authority missing,
3. service still checks object-level rule.

Example:

```text
User has case.approve authority
  -> frontend may show Approve button
  -> backend route allows POST /approve
  -> service still checks case state, assignment, maker-checker
```

Do not use frontend-only logic as enforcement.

Correct mental model:

```text
Frontend permission = usability hint.
Servlet authorization = route gate.
Service/domain authorization = business invariant.
Data authorization = visibility invariant.
```

---

## 27. Security Config Review Example

Suppose you see:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/auth/**").permitAll()
    .requestMatchers("/api/admin/**").hasRole("ADMIN")
    .requestMatchers("/api/**").authenticated()
    .anyRequest().permitAll()
)
```

Problems:

1. `anyRequest().permitAll()` exposes non-API endpoints.
2. `/api/** authenticated` means new API endpoints are available to all authenticated users.
3. `hasRole("ADMIN")` may be acceptable but coarse.
4. No method-specific distinction.
5. No actuator separation.
6. No internal endpoint model.
7. No explicit deny fallback.
8. No permission catalog.

Better:

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/auth/login", "/api/auth/callback").permitAll()
    .requestMatchers(HttpMethod.GET, "/api/cases").hasAuthority("case.search")
    .requestMatchers(HttpMethod.GET, "/api/cases/*").hasAuthority("case.read")
    .requestMatchers(HttpMethod.POST, "/api/cases/*/approve").hasAuthority("case.approve")
    .requestMatchers("/api/admin/**").hasAuthority("admin.access")
    .anyRequest().denyAll()
)
```

Even better: separate chains for public/API/admin/actuator if semantics differ.

---

## 28. How This Maps to PEP/PDP/PAP/PIP

In Part 3, we discussed PEP/PDP/PAP/PIP.

For Spring Security Servlet:

| Concept | Spring Security Servlet Equivalent |
|---|---|
| PEP | `AuthorizationFilter`, `SecurityFilterChain`, route matcher |
| PDP | `AuthorizationManager` or custom authorization service |
| PAP | security config, permission registry, policy admin UI |
| PIP | `Authentication`, user service, tenant resolver, request metadata |
| Decision | `AuthorizationDecision` / `AuthorizationResult` |
| Enforcement result | continue chain or throw `AccessDeniedException` |

A mature design avoids making `HttpSecurity` itself the only policy source. It is an enforcement adapter and coarse policy layer.

---

## 29. Top 1% Engineering Heuristics

### 29.1 Protect Commands More Specifically Than Queries

Commands mutate state and encode business transitions.

Prefer:

```java
POST /api/cases/{id}/approve -> case.approve
POST /api/cases/{id}/reassign -> case.reassign
POST /api/cases/{id}/reopen -> case.reopen
```

over:

```java
POST /api/cases/** -> case.write
```

### 29.2 Deny Unknown Routes

Unknown route should not become accidental public or authenticated access.

```java
.anyRequest().denyAll()
```

### 29.3 Do Not Trust Path Alone for Internal APIs

Internal path is not identity.

```text
/internal/** requires workload identity + authority + network control.
```

### 29.4 Treat Export/Download as Separate Capabilities

Viewing a page and exporting a dataset are not equivalent.

```text
case.read != case.export
report.view != report.export
file.metadata.read != file.download
```

### 29.5 Make Rule Ordering Testable

If rule ordering is security-critical, write tests that fail when ordering changes.

### 29.6 Avoid Security Config as a Dumping Ground

When config reaches hundreds of lines, extract:

1. route policy registry,
2. authority constants,
3. custom authorization managers,
4. test matrix,
5. generated documentation.

### 29.7 Separate Coarse and Fine Authorization

```text
Servlet: may call endpoint?
Service/domain: may perform business action on this object?
Repository/query: may see these records?
```

Do not collapse all three into controller annotations.

---

## 30. Production Checklist

Before approving a Spring Security Servlet authorization design, verify:

```text
[ ] Every SecurityFilterChain has clear ownership.
[ ] Multiple chains are ordered from specific to general.
[ ] Public endpoints are explicitly enumerated.
[ ] Static assets are not mixed with user files.
[ ] Actuator endpoints have separate policy.
[ ] API routes use method-specific rules where needed.
[ ] Command endpoints have command-specific authorities.
[ ] Export/download endpoints have separate authorities.
[ ] Internal endpoints are not protected by path alone.
[ ] hasRole/hasAuthority usage is consistent.
[ ] ROLE_ prefix behavior is understood.
[ ] anyRequest fallback is intentional.
[ ] Unknown endpoints are denied in sensitive systems.
[ ] Route authorization does not replace object authorization.
[ ] Domain services still enforce business invariants.
[ ] Query/data layer still enforces visibility.
[ ] Authorization denial responses are safe.
[ ] Denials are observable and auditable.
[ ] Tests cover anonymous, wrong authority, right authority, and unknown endpoint.
[ ] OpenAPI/security documentation matches config.
[ ] Permission constants/catalog exist.
[ ] JWT/scope/authority mapping is explicit.
[ ] Async/background execution does not rely blindly on SecurityContextHolder.
```

---

## 31. Summary

Spring Security Servlet authorization is a powerful HTTP boundary enforcement mechanism.

But top-level authorization engineering requires knowing its exact boundary:

```text
It can decide whether a request may reach an endpoint.
It cannot, by itself, fully decide whether the user may operate on a specific domain object or dataset.
```

The main design points:

1. Use `authorizeHttpRequests` and `AuthorizationManager` as the modern mental model.
2. Understand `securityMatcher` vs `requestMatchers`.
3. Keep matcher ordering specific-to-general.
4. Prefer explicit fallback, often `denyAll` for serious systems.
5. Use `hasAuthority` for permission-oriented enterprise systems.
6. Be careful with `hasRole` and `ROLE_` prefix.
7. Separate actuator, public, internal, and API chains when semantics differ.
8. Treat route authorization as PEP, not the whole authorization architecture.
9. Always pair route-level checks with domain/data-level checks.
10. Test denial paths as seriously as success paths.

---

## 32. How This Prepares the Next Part

Part 13 focused on Servlet request-level authorization.

Next, Part 14 will move deeper into:

```text
Spring Method Security: Service-Level Authorization
```

That is where authorization gets closer to business operations:

1. `@PreAuthorize`,
2. `@PostAuthorize`,
3. `@PreFilter`,
4. `@PostFilter`,
5. SpEL risks,
6. custom `PermissionEvaluator`,
7. proxy limitations,
8. transaction ordering,
9. service-level policy design.

Servlet authorization answers:

```text
May this request call this route?
```

Method/domain authorization starts answering:

```text
May this actor perform this business operation?
```

---

## References

1. Spring Security Reference — Authorize HttpServletRequests.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html

2. Spring Security Reference — Authorization Architecture.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

3. Spring Security API — RequestMatcherDelegatingAuthorizationManager.  
   https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/web/access/intercept/RequestMatcherDelegatingAuthorizationManager.html

4. Spring Security Reference — Servlet Architecture.  
   https://docs.spring.io/spring-security/reference/servlet/architecture.html

5. Spring Security Reference — Java Configuration and `springSecurityFilterChain`.  
   https://docs.spring.io/spring-security/reference/servlet/configuration/java.html

6. Spring Security Reference — Testing with MockMvc and Users.  
   https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/authentication.html

7. Spring Security API — `@WithMockUser`.  
   https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/test/context/support/WithMockUser.html

8. OWASP Authorization Cheat Sheet.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

9. OWASP API Security 2023 — Broken Object Level Authorization.  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-012.md">⬅️ Part 12 — Authorization in Layered Java Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-014.md">Part 14 — Spring Method Security: Service-Level Authorization ➡️</a>
</div>
