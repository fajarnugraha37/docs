# Part 18 — Spring Security Application Architecture

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> File: `18-spring-security-application-architecture.md`  
> Status seri: Part 18 dari 35 — **belum selesai**  
> Berikutnya: `19-spring-caching-semantics-consistency-risk.md`

---

## 0. Tujuan Part Ini

Part ini membahas **arsitektur Spring Security di aplikasi Spring**, bukan teori authentication/authorization umum dan bukan tutorial login sederhana.

Setelah menyelesaikan bagian ini, target pemahaman Anda adalah:

1. Bisa membaca Spring Security sebagai **pipeline filter + context + decision engine**.
2. Bisa membedakan authentication, authorization, session, CSRF, CORS, OAuth2, OIDC, JWT, dan method security dari sisi **komponen Spring Security**.
3. Bisa memprediksi mengapa request tertentu lolos, ditolak, redirect, menghasilkan 401, menghasilkan 403, atau tidak melewati filter yang Anda kira.
4. Bisa mendesain security architecture yang cocok untuk:
   - server-rendered web app,
   - REST API stateless,
   - OAuth2/OIDC login,
   - resource server JWT,
   - multi-tenant API,
   - internal enterprise application,
   - regulatory/case-management style system.
5. Bisa menghindari kesalahan umum seperti:
   - rule ordering salah,
   - `permitAll` terlalu luas,
   - CSRF dimatikan tanpa model ancaman,
   - session tercipta pada API yang dikira stateless,
   - authority mapping salah,
   - method security bypass karena self-invocation/proxy,
   - JWT claim dipercaya mentah tanpa policy layer,
   - security logic bocor ke controller/domain secara tidak terkendali.

Bagian ini sengaja fokus pada **application architecture**. Part 32 nanti akan membahas authorization advanced dan policy enforcement lebih dalam: ABAC, row-level authorization, object-level permission, policy decision point, regulatory defensibility, dan authorization matrix yang kompleks.

---

## 1. Mental Model: Spring Security Bukan “Login Library”

Spring Security sering disalahpahami sebagai library untuk membuat login form atau memvalidasi JWT. Itu terlalu sempit.

Secara arsitektural, Spring Security adalah runtime yang menyediakan:

```text
request interception
  -> authentication extraction
  -> authentication verification
  -> security context establishment
  -> authorization decision
  -> exception translation
  -> response shaping
  -> optional session/csrf/logout/remember-me/oauth2 integration
```

Atau dalam bentuk ringkas:

```text
Spring Security = filter pipeline + authentication manager + context holder + authorization manager + exception handling
```

Untuk aplikasi Spring MVC servlet stack, unit paling penting adalah:

```text
Servlet container Filter chain
    |
    v
DelegatingFilterProxy
    |
    v
FilterChainProxy
    |
    v
SecurityFilterChain selected by RequestMatcher
    |
    v
Spring Security Filters
    |
    v
DispatcherServlet / Controller
```

Spring Security tidak langsung “menempel” di controller. Ia berada **sebelum** request mencapai Spring MVC. Karena itu banyak keputusan security terjadi sebelum `@Controller`, `@RestController`, `@ControllerAdvice`, atau interceptor MVC bekerja.

Implikasinya:

1. Jika request ditolak oleh security filter, controller tidak pernah terpanggil.
2. Jika authentication gagal, exception bisa diterjemahkan oleh `AuthenticationEntryPoint`, bukan `@ExceptionHandler` biasa.
3. Jika authorization gagal, response biasanya diproses oleh `AccessDeniedHandler`.
4. Jika CORS preflight salah dikonfigurasi, request bisa gagal sebelum business API.
5. Jika CSRF aktif pada endpoint state-changing, POST/PUT/PATCH/DELETE bisa 403 walaupun user authenticated.

Spring Security harus dibaca sebagai **pipeline boundary**, bukan controller helper.

---

## 2. Authentication vs Authorization di Spring Security

Dua konsep ini harus dipisahkan secara keras.

### 2.1 Authentication

Authentication menjawab:

```text
Siapa subjek ini?
Apakah bukti identitasnya valid?
Apa representasi identity-nya di sistem?
```

Contoh bukti identitas:

- username/password,
- session cookie,
- bearer JWT,
- opaque token,
- client certificate,
- OAuth2 authorization code result,
- SAML assertion,
- API key,
- pre-authenticated identity dari reverse proxy,
- internal service token.

Output authentication di Spring Security umumnya adalah object `Authentication` yang disimpan di `SecurityContext`.

Contoh konseptual:

```java
Authentication authentication = ...;
SecurityContext context = SecurityContextHolder.createEmptyContext();
context.setAuthentication(authentication);
SecurityContextHolder.setContext(context);
```

`Authentication` bukan hanya “user”. Ia memuat:

- principal,
- credentials,
- authorities,
- authenticated flag,
- details.

### 2.2 Authorization

Authorization menjawab:

```text
Apakah subjek ini boleh melakukan aksi ini terhadap resource ini dalam konteks ini?
```

Contoh:

```text
User A sudah login.
Apakah User A boleh melihat case C?
Apakah User A boleh approve application X?
Apakah User A boleh export report untuk agency Y?
Apakah service S boleh memanggil endpoint internal Z?
```

Di Spring Security modern, authorization banyak dibangun di sekitar `AuthorizationManager`.

Decision-nya bukan sekadar role check. Ia bisa mencakup:

- authority,
- role hierarchy,
- tenant,
- ownership,
- workflow state,
- assignment,
- case sensitivity,
- current channel,
- agency boundary,
- temporal rule,
- risk level,
- data classification,
- regulatory policy.

### 2.3 Kesalahan Mental Model Umum

Kesalahan:

```text
User sudah authenticated berarti boleh akses semua endpoint.
```

Yang benar:

```text
Authentication hanya membuktikan identity.
Authorization menentukan izin terhadap aksi/resource tertentu.
```

Kesalahan lain:

```text
JWT valid berarti user boleh melakukan action.
```

Yang benar:

```text
JWT valid hanya berarti token secara kriptografis diterima dan claim dapat dibaca.
Aplikasi tetap harus melakukan authorization berdasarkan authority, tenant, resource, dan policy.
```

---

## 3. Komponen Inti Spring Security Servlet Architecture

### 3.1 DelegatingFilterProxy

Servlet container mengenal `Filter`, bukan Spring bean. Spring Security butuh menjembatani dunia servlet container dengan Spring `ApplicationContext`.

`DelegatingFilterProxy` adalah jembatan itu.

Secara konseptual:

```text
Servlet container receives request
  -> invokes DelegatingFilterProxy
  -> DelegatingFilterProxy looks up Spring bean named springSecurityFilterChain
  -> delegates doFilter to that bean
```

Biasanya bean itu adalah `FilterChainProxy`.

Anda jarang membuat `DelegatingFilterProxy` manual di Spring Boot karena auto-configuration mendaftarkannya untuk Anda. Namun memahami ini penting ketika:

- ada aplikasi legacy WAR,
- ada custom servlet container setup,
- filter order bentrok,
- security filter tidak terpanggil,
- ada multiple servlet contexts,
- ada parent-child context.

### 3.2 FilterChainProxy

`FilterChainProxy` adalah Spring-managed `Filter` yang berisi satu atau lebih `SecurityFilterChain`.

Ia bertugas:

1. Menerima request dari `DelegatingFilterProxy`.
2. Memilih `SecurityFilterChain` yang cocok dengan request.
3. Menjalankan filter-filter Spring Security di chain tersebut.
4. Meneruskan request ke servlet filter chain berikutnya jika tidak dihentikan.

Modelnya:

```text
FilterChainProxy
  SecurityFilterChain #1: /api/admin/**
    - filter A
    - filter B
    - filter C

  SecurityFilterChain #2: /api/**
    - filter A
    - filter D
    - filter E

  SecurityFilterChain #3: /**
    - filter A
    - filter F
```

Request hanya menggunakan chain pertama yang cocok, bukan semua chain.

### 3.3 SecurityFilterChain

`SecurityFilterChain` adalah pasangan:

```text
RequestMatcher + List<Filter>
```

Contoh konfigurasi konseptual:

```java
@Bean
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt())
        .build();
}
```

`securityMatcher("/api/**")` menentukan apakah seluruh chain ini relevan untuk request.  
`requestMatchers(...)` di dalam `authorizeHttpRequests` menentukan authorization rule di chain tersebut.

Ini perbedaan penting.

```text
securityMatcher  = memilih chain
requestMatchers  = memilih authorization rule dalam chain
```

Kesalahan umum adalah mengira keduanya sama.

### 3.4 Filter Ordering

Spring Security filters memiliki order yang sangat penting.

Contoh urutan konseptual:

```text
DisableEncodeUrlFilter
WebAsyncManagerIntegrationFilter
SecurityContextHolderFilter
HeaderWriterFilter
CorsFilter
CsrfFilter
LogoutFilter
OAuth2AuthorizationRequestRedirectFilter
UsernamePasswordAuthenticationFilter
BearerTokenAuthenticationFilter
RequestCacheAwareFilter
SecurityContextHolderAwareRequestFilter
AnonymousAuthenticationFilter
ExceptionTranslationFilter
AuthorizationFilter
```

Urutan aktual bergantung konfigurasi.

Beberapa prinsip:

1. Context harus tersedia sebelum authorization.
2. Authentication harus terjadi sebelum authorization.
3. Exception translation harus membungkus filter yang bisa melempar authentication/authorization exception.
4. CSRF harus dievaluasi sebelum request state-changing diproses.
5. Logout harus berada pada posisi yang bisa menangkap logout URL.
6. CORS harus ditangani cukup awal agar preflight tidak dianggap unauthenticated request biasa.

Jika Anda menambahkan custom filter, pertanyaannya bukan hanya “filter ini melakukan apa”, tetapi:

```text
Harus berada sebelum/sesudah filter apa?
Apakah filter ini membutuhkan SecurityContext?
Apakah filter ini bisa melakukan authentication?
Apakah filter ini harus berjalan sebelum authorization?
Apakah filter ini boleh menulis response?
Apakah filter ini harus skip preflight/static endpoint?
```

---

## 4. SecurityContext and SecurityContextHolder

### 4.1 SecurityContext

`SecurityContext` menyimpan `Authentication` untuk current execution.

Konseptual:

```text
SecurityContext
  -> Authentication
      -> principal
      -> credentials
      -> authorities
      -> details
      -> authenticated
```

### 4.2 SecurityContextHolder

`SecurityContextHolder` adalah holder global static API untuk mengakses context.

Default historisnya menggunakan `ThreadLocal`.

Implikasi besar:

1. Security context mengikuti thread, bukan otomatis mengikuti request logical flow jika berpindah thread.
2. `@Async`, executor manual, scheduler, reactive flow, dan virtual thread butuh perhatian khusus.
3. MDC/correlation ID dan security context sering harus dipropagasi secara eksplisit.

Contoh bug:

```java
@Async
public void sendNotification() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    // auth bisa null jika context tidak dipropagasi
}
```

### 4.3 SecurityContext Persistence

Pada aplikasi stateful session, context dapat disimpan di HTTP session.

Pada API stateless JWT, context biasanya dibuat ulang per request dari bearer token dan tidak disimpan di session.

Perbedaan ini sangat penting:

```text
Stateful web app:
  login sekali -> SecurityContext disimpan di session -> request berikutnya pakai session cookie

Stateless API:
  setiap request membawa bearer token -> filter memvalidasi token -> context dibuat untuk request itu saja
```

Kesalahan umum:

```text
Mengira konfigurasi JWT otomatis stateless.
```

Belum tentu. Anda tetap perlu mengontrol session management jika ingin benar-benar stateless.

Contoh:

```java
http.sessionManagement(session ->
    session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
);
```

Namun jangan gunakan `STATELESS` secara dogmatis. Untuk browser-based login, session sering justru benar.

---

## 5. Authentication Architecture

### 5.1 Authentication Object

`Authentication` punya dua fase konseptual:

```text
Unauthenticated token
  -> berisi credential/request evidence
  -> dikirim ke AuthenticationManager

Authenticated token
  -> berisi principal dan authority valid
  -> disimpan di SecurityContext
```

Contoh username/password:

```text
UsernamePasswordAuthenticationToken unauthenticated
  principal = username
  credentials = password
  authenticated = false

ProviderManager authenticates

UsernamePasswordAuthenticationToken authenticated
  principal = UserDetails
  credentials = usually erased
  authorities = [...]
  authenticated = true
```

Contoh bearer JWT:

```text
Bearer token extracted from Authorization header
  -> JwtDecoder validates token
  -> JwtAuthenticationToken created
  -> authorities mapped from claims
  -> SecurityContext set
```

### 5.2 AuthenticationManager

`AuthenticationManager` adalah kontrak untuk melakukan authentication.

```java
public interface AuthenticationManager {
    Authentication authenticate(Authentication authentication) throws AuthenticationException;
}
```

Ia menerima authentication request dan mengembalikan authentication result yang sudah valid.

### 5.3 ProviderManager

Implementasi umum adalah `ProviderManager`, yang mendelegasikan ke daftar `AuthenticationProvider`.

Modelnya:

```text
ProviderManager
  -> DaoAuthenticationProvider
  -> JwtAuthenticationProvider
  -> LdapAuthenticationProvider
  -> custom provider
```

Setiap provider menjawab:

```text
Saya bisa authenticate token jenis ini atau tidak?
Kalau bisa, valid atau gagal?
```

### 5.4 AuthenticationProvider

`AuthenticationProvider` cocok untuk custom authentication mechanism.

Contoh situasi:

- API key authentication,
- signed header authentication,
- internal service token,
- legacy SSO token,
- pre-authenticated gateway identity,
- government identity assertion,
- partner integration token.

Skeleton konseptual:

```java
@Component
public class ApiKeyAuthenticationProvider implements AuthenticationProvider {

    private final ApiKeyVerifier verifier;

    public ApiKeyAuthenticationProvider(ApiKeyVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    public Authentication authenticate(Authentication authentication) {
        ApiKeyAuthenticationToken token = (ApiKeyAuthenticationToken) authentication;

        VerifiedClient client = verifier.verify(token.getApiKey());

        return ApiKeyAuthenticationToken.authenticated(
            client,
            AuthorityUtils.createAuthorityList("SCOPE_internal.read")
        );
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return ApiKeyAuthenticationToken.class.isAssignableFrom(authentication);
    }
}
```

Provider harus:

1. menerima token type yang jelas,
2. memvalidasi evidence,
3. tidak menyimpan credential sensitif lebih lama dari perlu,
4. menghasilkan authorities minimal,
5. gagal dengan exception yang tepat,
6. tidak melakukan authorization resource-level.

Authentication provider bukan tempat untuk menjawab “boleh akses case X atau tidak”. Itu authorization.

### 5.5 UserDetailsService

`UserDetailsService` adalah abstraction untuk mengambil user berdasarkan username.

Ia sering digunakan oleh `DaoAuthenticationProvider`.

Kesalahan umum:

```text
UserDetailsService dijadikan repository domain utama user.
```

Lebih baik perlakukan sebagai adapter security:

```text
Security adapter: load identity credential/authority representation
Domain user service: model business user/application actor
```

Dalam sistem enterprise, principal yang dipakai security sering tidak sama 1:1 dengan domain user aggregate.

Contoh:

```text
Security principal:
  subjectId
  loginName
  tenantId
  authorities
  identityProvider

Domain actor:
  officerId
  agency
  assignment group
  active appointments
  delegation
  case permissions
```

Jangan campur semua ke `UserDetails` sampai menjadi God Object.

---

## 6. Authorization Architecture

### 6.1 Request-Level Authorization

Request-level authorization terjadi pada HTTP request sebelum controller dipanggil.

Contoh:

```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/actuator/health", "/actuator/info").permitAll()
    .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("case:read")
    .requestMatchers(HttpMethod.POST, "/api/cases/**").hasAuthority("case:create")
    .anyRequest().authenticated()
);
```

Prinsip:

1. Rule paling spesifik di atas.
2. Default deny atau minimal authenticated di akhir.
3. Public endpoint harus eksplisit.
4. Actuator endpoint jangan dibuka luas.
5. Method HTTP harus dipertimbangkan.
6. Jangan mengandalkan controller mapping sebagai security boundary.

### 6.2 AuthorizationManager

`AuthorizationManager<T>` adalah abstraction modern untuk membuat keputusan authorization.

Secara mental:

```text
AuthorizationManager menerima:
  - Authentication supplier
  - protected object/context

Lalu mengembalikan:
  - granted
  - denied
  - abstain/nullable depending version/API usage
```

Untuk request-level authorization, protected object bisa berupa request context. Untuk method security, protected object bisa berupa method invocation.

### 6.3 Authorities and Roles

Spring Security membedakan authority sebagai string umum.

Role secara konvensi adalah authority dengan prefix `ROLE_`.

```text
hasRole("ADMIN")      -> mencari authority ROLE_ADMIN
hasAuthority("ADMIN") -> mencari authority ADMIN
```

Kesalahan klasik:

```java
.hasRole("ROLE_ADMIN")
```

Ini bisa menyebabkan pencarian `ROLE_ROLE_ADMIN` tergantung API yang dipakai.

Lebih eksplisit untuk sistem enterprise:

```text
Authority = permission/action capability
Role      = grouping/assignment concept
```

Contoh authority yang lebih stabil:

```text
case:read
case:create
case:update
case:approve
appeal:review
report:export
admin:user.manage
```

Role bisa dimap ke authority:

```text
ROLE_CASE_OFFICER -> case:read, case:update
ROLE_CASE_MANAGER -> case:read, case:update, case:approve
ROLE_REPORT_VIEWER -> report:export
```

Untuk sistem kompleks, jangan terlalu lama bertahan di model “role langsung dipakai untuk semua authorization”. Role biasanya terlalu coarse-grained.

### 6.4 Method Security

Method security melindungi service method, bukan URL.

Contoh:

```java
@PreAuthorize("hasAuthority('case:approve')")
public ApprovalResult approveCase(ApproveCaseCommand command) {
    ...
}
```

Method security berguna karena:

1. Service bisa dipanggil dari controller, scheduler, message listener, batch, atau internal flow.
2. URL bukan satu-satunya entry point.
3. Authorization business operation lebih dekat ke application service.
4. Ia bisa melindungi operation-level capability.

Namun method security berbasis proxy, sehingga terpengaruh oleh masalah AOP:

```text
Self-invocation bypass.
Final method/class issue.
Private method tidak diproxy.
Internal call tidak melewati security interceptor.
```

Contoh bug:

```java
@Service
public class CaseService {

    public void submit() {
        approve(); // self-invocation: @PreAuthorize pada approve bisa tidak terpanggil
    }

    @PreAuthorize("hasAuthority('case:approve')")
    public void approve() {
        ...
    }
}
```

Solusi desain:

1. Letakkan secured operation pada service boundary yang dipanggil dari luar bean.
2. Jangan taruh annotation security pada helper/private method.
3. Pisahkan orchestration service dan protected action service jika perlu.
4. Untuk authorization kompleks, panggil policy service eksplisit di application service.

### 6.5 Request Authorization vs Method Authorization

Keduanya tidak saling menggantikan.

| Layer | Cocok untuk | Tidak cukup untuk |
|---|---|---|
| Request authorization | Endpoint class, URL group, HTTP method, public/private API | Object-level rule, workflow state, internal method call |
| Method authorization | Operation-level capability, service boundary, non-HTTP entry point | URL exposure, CORS/CSRF/header concerns |
| Domain/policy authorization | Resource ownership, tenant, workflow, assignment, data sensitivity | HTTP/session/JWT mechanics |

Desain kuat biasanya menggunakan kombinasi:

```text
HTTP layer:
  endpoint harus authenticated dan punya coarse capability

Application service:
  operation-level authorization

Policy/domain layer:
  resource-level decision berdasarkan state, tenant, assignment, delegation
```

---

## 7. Exception Translation: 401 vs 403

Spring Security membedakan dua kondisi:

```text
Unauthenticated = belum diketahui/invalid identity -> 401 atau redirect login
Forbidden       = identity valid tapi tidak punya izin -> 403
```

### 7.1 AuthenticationEntryPoint

`AuthenticationEntryPoint` menangani authentication failure atau request unauthenticated ke protected resource.

Output bisa:

- redirect ke login page,
- HTTP 401 JSON,
- WWW-Authenticate header,
- OAuth2 authorization redirect.

Untuk REST API, biasanya ingin response 401 JSON/ProblemDetail, bukan redirect HTML.

### 7.2 AccessDeniedHandler

`AccessDeniedHandler` menangani authenticated user yang tidak punya izin.

Output biasanya 403.

### 7.3 ExceptionTranslationFilter

`ExceptionTranslationFilter` menjembatani exception security menjadi HTTP response.

Modelnya:

```text
downstream filter throws AuthenticationException
  -> AuthenticationEntryPoint

downstream filter throws AccessDeniedException
  -> if anonymous/unauthenticated -> AuthenticationEntryPoint
  -> else -> AccessDeniedHandler
```

Ini menjelaskan kenapa `@ControllerAdvice` Anda kadang tidak menangkap security error. Error terjadi di filter chain sebelum controller.

---

## 8. Session Management

### 8.1 Stateful Session

Stateful session cocok untuk:

- server-rendered web application,
- browser login form,
- admin UI internal,
- OIDC login dengan session cookie,
- aplikasi yang butuh server-side session lifecycle.

Kelebihan:

1. Token tidak perlu dikirim sebagai bearer ke setiap API manual.
2. Logout server-side lebih straightforward.
3. CSRF protection bisa bekerja natural dengan cookie session.
4. Session fixation protection tersedia.

Risiko:

1. Butuh sticky session atau shared session store jika horizontal scaling.
2. CSRF menjadi concern besar.
3. Session timeout harus jelas.
4. Browser cookie policy harus benar.
5. Logout multi-app bisa kompleks.

### 8.2 Stateless API

Stateless cocok untuk:

- REST API untuk SPA/mobile/backend client,
- bearer token resource server,
- service-to-service API,
- high-scale API yang tidak mau server session.

Kelebihan:

1. Scaling lebih mudah.
2. Request self-contained.
3. Tidak bergantung session store.

Risiko:

1. Logout/revocation lebih sulit untuk JWT.
2. Token expiry/refresh design harus benar.
3. Claim staleness.
4. Authority changes tidak langsung tercermin sampai token baru.
5. Token leakage berdampak besar.

### 8.3 SessionCreationPolicy

Pilihan umum:

```text
ALWAYS       : selalu membuat session
IF_REQUIRED  : membuat session jika dibutuhkan
NEVER        : tidak membuat session, tetapi memakai yang ada
STATELESS    : tidak membuat dan tidak memakai session untuk SecurityContext
```

Untuk API bearer token:

```java
http.sessionManagement(session ->
    session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
);
```

Namun periksa juga komponen lain yang mungkin membuat session, misalnya request cache, form login, OAuth2 login, atau custom code.

### 8.4 Session Fixation

Pada login stateful, session fixation protection penting.

Attack model:

```text
Attacker membuat/mengetahui session id
Victim login dengan session itu
Attacker memakai session id yang sama
```

Spring Security menyediakan proteksi session fixation dengan mengganti session id setelah authentication.

---

## 9. CSRF

### 9.1 Apa Masalah yang Diselesaikan CSRF?

CSRF menyerang browser yang otomatis mengirim cookie ke domain target.

Model:

```text
Victim login di app.example.com
Browser menyimpan session cookie
Victim membuka attacker.com
attacker.com membuat form POST ke app.example.com/transfer
Browser otomatis mengirim cookie app.example.com
Server mengira request berasal dari victim
```

CSRF relevan ketika:

1. authentication memakai cookie otomatis,
2. browser terlibat,
3. endpoint melakukan state-changing operation,
4. server hanya mengandalkan cookie/session untuk identity.

### 9.2 Kapan CSRF Bisa Dimatikan?

CSRF biasanya bisa dimatikan untuk API yang:

1. tidak menggunakan cookie untuk authentication,
2. menggunakan bearer token di Authorization header,
3. token tidak otomatis dikirim browser,
4. client bukan browser atau token disimpan/dikirim secara eksplisit.

Namun hati-hati untuk SPA.

Jika SPA memakai cookie session atau cookie token otomatis, CSRF tetap relevan.

### 9.3 Kesalahan Umum

```java
http.csrf(csrf -> csrf.disable());
```

Lalu tidak ada model ancaman.

Pertanyaan yang harus dijawab sebelum disable:

```text
Apakah client browser?
Apakah authentication berbasis cookie?
Apakah cookie SameSite cukup?
Apakah ada endpoint state-changing?
Apakah API dipanggil cross-site?
Apakah ada legacy browser constraint?
Apakah ada form login?
Apakah logout endpoint terlindungi?
```

### 9.4 CSRF untuk REST API Browser

Untuk browser app dengan cookie auth, pola umum:

1. Server mengirim CSRF token.
2. Client membaca token dari cookie/header/meta.
3. Client mengirim token di header state-changing request.
4. Server memverifikasi token cocok.

Contoh konseptual:

```java
http.csrf(csrf -> csrf
    .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
);
```

`HttpOnlyFalse` berarti JavaScript bisa membaca token cookie untuk dikirim sebagai header. Ini trade-off. Jangan campur dengan token credential utama.

---

## 10. CORS

### 10.1 CORS Bukan Authentication

CORS adalah browser security mechanism untuk mengontrol apakah JavaScript dari origin A boleh membaca response dari origin B.

CORS bukan authN/authZ.

Server tetap harus melakukan authentication dan authorization.

### 10.2 Preflight

Request tertentu memicu preflight `OPTIONS`.

Jika Spring Security menangani `OPTIONS` sebagai request biasa dan menuntut authentication, browser akan gagal sebelum request asli dikirim.

Karena itu CORS harus terintegrasi dengan Spring Security.

Contoh:

```java
http.cors(Customizer.withDefaults());
```

Lalu sediakan `CorsConfigurationSource`.

### 10.3 CORS Failure Model

Masalah umum:

1. Preflight 401.
2. Preflight 403.
3. Missing `Access-Control-Allow-Origin`.
4. Wildcard origin dengan credentials.
5. Allowed headers tidak mencakup `Authorization`.
6. Allowed methods tidak mencakup `PATCH`/`DELETE`.
7. Environment-specific origin salah.
8. CORS diselesaikan di gateway dan app sekaligus dengan konfigurasi konflik.

### 10.4 CORS with Credentials

Jika memakai cookies/credentials:

```text
Access-Control-Allow-Credentials: true
Access-Control-Allow-Origin: tidak boleh *
```

Origin harus eksplisit.

---

## 11. OAuth2 Login, OIDC Login, and Resource Server

### 11.1 OAuth2/OIDC Login

OAuth2/OIDC login digunakan ketika aplikasi Anda bertindak sebagai client yang mengarahkan user ke identity provider.

Flow ringkas:

```text
Browser -> App
App -> redirect to IdP authorization endpoint
User authenticates at IdP
IdP -> redirect back with authorization code
App exchanges code for tokens
App establishes local authenticated session
```

Pada Spring Security:

```java
http.oauth2Login(Customizer.withDefaults());
```

Biasanya menghasilkan session-based login pada aplikasi web.

### 11.2 Resource Server JWT

Resource server memvalidasi bearer token pada setiap request.

Flow:

```text
Client sends Authorization: Bearer <jwt>
BearerTokenAuthenticationFilter extracts token
JwtDecoder validates signature/issuer/audience/expiry
JwtAuthenticationConverter maps claims to authorities
SecurityContext is populated
Authorization runs
```

Konfigurasi konseptual:

```java
http.oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt
    .jwtAuthenticationConverter(customJwtAuthenticationConverter())
));
```

### 11.3 JWT Claim Mapping

JWT claims bukan authority Spring secara otomatis sesuai kebutuhan Anda.

Anda harus mendesain mapping:

```text
JWT claim             -> Spring authority
scope: case.read      -> SCOPE_case.read
roles: CASE_OFFICER   -> ROLE_CASE_OFFICER
permissions: [...]    -> case:read, case:update
agency: CEA           -> tenant/context attribute, bukan selalu authority
```

Kesalahan umum:

1. Menganggap semua claim bisa dipercaya untuk authorization domain.
2. Tidak memvalidasi issuer/audience.
3. Tidak membatasi algorithm.
4. Tidak memeriksa expiry/clock skew dengan benar.
5. Tidak memetakan authority secara eksplisit.
6. Menaruh tenant sebagai string global tanpa validasi resource.
7. Memakai `sub` sebagai internal user id tanpa mapping lifecycle.

### 11.4 Opaque Token

Opaque token divalidasi lewat introspection endpoint.

Trade-off:

| JWT | Opaque Token |
|---|---|
| Validasi lokal cepat | Butuh call introspection |
| Sulit revoke cepat tanpa blacklist | Revocation lebih mudah dikontrol IdP |
| Claim tersedia di token | Claim dari introspection response |
| Risiko claim stale | Lebih real-time tergantung IdP |

Pilih berdasarkan threat model dan operational constraints.

---

## 12. Custom Authentication Filter

Kadang built-in mechanism tidak cukup.

Contoh kebutuhan:

- API key header,
- HMAC signed request,
- mutual TLS principal mapping,
- gateway-provided identity,
- legacy SSO cookie,
- internal service token.

### 12.1 Filter Responsibility

Custom authentication filter sebaiknya hanya melakukan:

1. Deteksi apakah request memakai mechanism ini.
2. Ekstrak credential/evidence.
3. Buat unauthenticated `Authentication` token.
4. Panggil `AuthenticationManager`.
5. Jika sukses, set `SecurityContext`.
6. Jika gagal, clear context dan trigger failure handling.

Jangan jadikan filter tempat business authorization.

### 12.2 OncePerRequestFilter Skeleton

```java
public class ApiKeyAuthenticationFilter extends OncePerRequestFilter {

    private final AuthenticationManager authenticationManager;

    public ApiKeyAuthenticationFilter(AuthenticationManager authenticationManager) {
        this.authenticationManager = authenticationManager;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String apiKey = request.getHeader("X-API-Key");

        if (apiKey == null || apiKey.isBlank()) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            Authentication requestAuth = ApiKeyAuthenticationToken.unauthenticated(apiKey);
            Authentication result = authenticationManager.authenticate(requestAuth);

            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(result);
            SecurityContextHolder.setContext(context);

            filterChain.doFilter(request, response);
        }
        catch (AuthenticationException ex) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        }
    }
}
```

Production implementation perlu:

- proper `AuthenticationEntryPoint`,
- no raw credential logging,
- rate limiting atau abuse detection,
- audit event,
- metrics,
- correlation id,
- constant-time comparison untuk secret,
- secret rotation,
- replay protection jika signed request.

### 12.3 Filter Placement

Custom authentication filter biasanya diletakkan sebelum authorization dan sebelum anonymous authentication.

Contoh:

```java
http.addFilterBefore(apiKeyFilter, UsernamePasswordAuthenticationFilter.class);
```

Namun jangan copy-paste. Tentukan berdasarkan mechanism.

Pertanyaan:

```text
Apakah filter ini mengganti login form?
Apakah filter ini membaca bearer token?
Apakah filter ini harus berjalan sebelum BearerTokenAuthenticationFilter?
Apakah filter ini hanya untuk /internal/**?
Apakah filter ini harus skip OPTIONS preflight?
```

---

## 13. Multiple SecurityFilterChain

Aplikasi enterprise sering punya lebih dari satu security surface:

```text
/api/**          -> stateless JWT resource server
/admin/**        -> OIDC login + session
/internal/**     -> mTLS/API key/service token
/actuator/**     -> restricted operational access
/public/**       -> public docs/health
```

Desain lebih bersih dengan multiple `SecurityFilterChain`.

Contoh:

```java
@Configuration
@EnableWebSecurity
public class SecurityConfiguration {

    @Bean
    @Order(1)
    SecurityFilterChain actuator(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/actuator/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health", "/actuator/info").permitAll()
                .anyRequest().hasAuthority("ops:actuator.read"))
            .httpBasic(Customizer.withDefaults())
            .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/api/**")
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2.jwt())
            .build();
    }

    @Bean
    @Order(3)
    SecurityFilterChain web(HttpSecurity http) throws Exception {
        return http
            .securityMatcher("/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/assets/**").permitAll()
                .anyRequest().authenticated())
            .oauth2Login(Customizer.withDefaults())
            .build();
    }
}
```

Kunci desain:

1. Chain paling spesifik diberi order lebih awal.
2. Catch-all chain terakhir.
3. Jangan ada gap endpoint tidak terlindungi kecuali sengaja.
4. Actuator diperlakukan sebagai surface sendiri.
5. Public endpoint eksplisit.
6. `securityMatcher` antar chain tidak overlap secara membingungkan.

Failure model:

```text
Request /api/foo masuk chain web karena api chain matcher salah.
Request /actuator/env terbuka karena actuator chain tidak match management base path.
Request /internal/** terkena JWT chain padahal harus mTLS.
Catch-all chain permitAll terlalu luas.
```

---

## 14. Security Headers

Spring Security dapat menulis security headers.

Contoh penting:

```text
X-Content-Type-Options
X-Frame-Options / Content-Security-Policy frame-ancestors
Cache-Control
Strict-Transport-Security
Content-Security-Policy
Referrer-Policy
Permissions-Policy
```

Security headers tidak menggantikan authentication/authorization, tetapi mengurangi browser attack surface.

### 14.1 HSTS

HSTS memberitahu browser untuk hanya memakai HTTPS.

Aktifkan hanya jika:

1. domain benar-benar HTTPS-ready,
2. subdomain strategy dipahami,
3. preload implications dipahami.

### 14.2 CSP

Content Security Policy penting untuk browser app.

Namun CSP sering butuh tuning dengan frontend.

Jangan langsung pakai konfigurasi terlalu longgar:

```text
script-src * 'unsafe-inline' 'unsafe-eval'
```

Itu sering hampir tidak memberi perlindungan.

---

## 15. Static Resources and Public Endpoints

Static resources sering dibuat `permitAll`.

Contoh:

```java
.requestMatchers("/assets/**", "/favicon.ico").permitAll()
```

Jangan gunakan bypass filter chain sembarangan kecuali paham konsekuensinya.

Ada perbedaan:

```text
permitAll:
  request tetap melewati security filter chain, tetapi authorization mengizinkan.

ignoring/web.ignoring:
  request tidak melewati Spring Security sama sekali.
```

`permitAll` sering lebih aman karena security headers masih bisa ditulis.

Gunakan ignoring hanya untuk kasus yang benar-benar static dan tidak perlu security behavior.

---

## 16. Actuator Security

Actuator endpoint adalah operational surface.

Beberapa endpoint sensitif:

```text
/actuator/env
/actuator/configprops
/actuator/beans
/actuator/heapdump
/actuator/threaddump
/actuator/logfile
/actuator/loggers
/actuator/metrics
/actuator/prometheus
```

Prinsip:

1. `health` dan `info` boleh public terbatas jika memang perlu.
2. Detail health jangan bocor ke public.
3. Metrics/prometheus biasanya butuh network-level dan app-level protection.
4. Heapdump/env/configprops sangat sensitif.
5. Management port/base path harus dikelola.
6. Jangan mengandalkan obscurity path.

Contoh:

```java
.requestMatchers("/actuator/health", "/actuator/info").permitAll()
.requestMatchers("/actuator/**").hasAuthority("ops:actuator.read")
```

Untuk Kubernetes:

```text
liveness/readiness boleh dibuka untuk kubelet/network internal,
tetapi jangan expose detail dependency ke internet.
```

---

## 17. Security Context Propagation

### 17.1 ThreadLocal Boundary

Karena security context sering berbasis thread-local, berpindah thread berarti context bisa hilang.

Masalah muncul di:

- `@Async`,
- `CompletableFuture`,
- custom `ExecutorService`,
- scheduler,
- message listener,
- reactive pipeline,
- virtual threads,
- task decorator,
- background job.

### 17.2 DelegatingSecurityContext

Spring Security menyediakan wrapper seperti:

- `DelegatingSecurityContextRunnable`,
- `DelegatingSecurityContextCallable`,
- `DelegatingSecurityContextExecutor`,
- `DelegatingSecurityContextAsyncTaskExecutor`.

Tujuannya membawa security context ke execution lain secara eksplisit.

Namun jangan selalu propagate context otomatis.

Pertanyaan desain:

```text
Apakah background task memang harus berjalan sebagai current user?
Atau harus berjalan sebagai system actor?
Apakah audit harus mencatat initiatedBy user tapi executedAs system?
Apakah authority user harus tetap berlaku setelah request selesai?
Apakah task bisa dieksekusi jauh setelah user logout/role berubah?
```

Untuk workflow enterprise, sering lebih benar menyimpan:

```text
initiatorUserId
initiatorTenantId
requestId
business command
```

lalu background worker berjalan sebagai system actor dengan policy eksplisit, bukan membawa full `SecurityContext` lama.

---

## 18. Multi-Tenant Security

Multi-tenancy jangan hanya diletakkan sebagai claim string.

Minimal model:

```text
Authentication:
  subject id
  identity provider
  authorities
  tenant memberships
  selected tenant/current tenant

Request context:
  tenant from path/header/subdomain/token/session

Authorization:
  verify subject belongs to tenant
  verify resource belongs to tenant
  verify action allowed in tenant
```

Contoh endpoint:

```text
GET /tenants/{tenantId}/cases/{caseId}
```

Security check harus memastikan:

1. token valid,
2. user memiliki membership tenant `{tenantId}`,
3. case `{caseId}` memang milik tenant `{tenantId}`,
4. user punya authority `case:read`,
5. user punya assignment/visibility terhadap case tersebut jika berlaku.

Kesalahan umum:

```text
TenantId dari URL dipercaya begitu saja.
TenantId dari JWT dipercaya tanpa resource check.
Tenant filter diterapkan di service tapi repository custom query lupa filter.
Cache key tidak memasukkan tenant.
Method security mengecek authority tapi bukan tenant.
```

Multi-tenancy perlu dijaga di beberapa layer:

```text
request validation
security context
application service policy
repository query constraint
cache key
audit log
metrics tag carefully
```

---

## 19. Security for Case-Management / Regulatory Systems

Untuk sistem enforcement/case-management, authorization jarang cukup dengan role.

Contoh policy:

```text
Officer boleh melihat case jika:
  - berada dalam agency yang sama,
  - punya module permission case:read,
  - case tidak restricted, atau officer termasuk assigned team,
  - case state bukan sealed/archived tanpa elevated permission,
  - conflict-of-interest flag tidak aktif,
  - access terjadi lewat channel yang diperbolehkan,
  - semua access dicatat ke audit trail.
```

Ini tidak cocok ditaruh seluruhnya di annotation:

```java
@PreAuthorize("hasRole('OFFICER')")
```

Itu terlalu dangkal.

Model yang lebih baik:

```java
@Service
public class CaseApplicationService {

    private final CaseAccessPolicy accessPolicy;
    private final CaseRepository caseRepository;
    private final AuditService auditService;

    public CaseView getCase(CaseId caseId, Actor actor) {
        CaseRecord record = caseRepository.getRequired(caseId);
        accessPolicy.assertCanView(actor, record);
        auditService.recordCaseViewed(actor, record);
        return CaseView.from(record);
    }
}
```

Request/method security tetap dipakai untuk coarse gate:

```java
@PreAuthorize("hasAuthority('case:read')")
public CaseView getCase(...) { ... }
```

Lalu policy service melakukan resource-level check.

Prinsip:

```text
Spring Security menjaga entry boundary dan operation capability.
Policy service menjaga business/resource authorization.
Repository/data layer menjaga query isolation.
Audit menjaga defensibility.
```

---

## 20. Testing Spring Security

Testing security harus mencakup beberapa level.

### 20.1 MVC Request-Level Tests

Gunakan `MockMvc` untuk menguji endpoint security.

Contoh konseptual:

```java
mockMvc.perform(get("/api/cases/123"))
    .andExpect(status().isUnauthorized());

mockMvc.perform(get("/api/cases/123").with(jwt().authorities(new SimpleGrantedAuthority("case:read"))))
    .andExpect(status().isOk());

mockMvc.perform(post("/api/cases/123/approve").with(jwt().authorities(new SimpleGrantedAuthority("case:read"))))
    .andExpect(status().isForbidden());
```

### 20.2 Method Security Tests

Test service method dengan security context.

```java
@WithMockUser(authorities = "case:approve")
@Test
void approveAllowed() {
    service.approve(command);
}
```

Namun untuk authorization kompleks, lebih baik test policy service secara langsung dengan domain fixtures.

### 20.3 CSRF Tests

Untuk endpoint state-changing dengan CSRF aktif:

```java
mockMvc.perform(post("/web/profile"))
    .andExpect(status().isForbidden());

mockMvc.perform(post("/web/profile").with(csrf()))
    .andExpect(status().is3xxRedirection());
```

### 20.4 JWT Claim Mapping Tests

Test converter dari claim ke authorities.

```text
given JWT claim scope = "case.read case.write"
expect authorities = SCOPE_case.read, SCOPE_case.write
```

Jangan hanya test endpoint happy path. Test mapping karena banyak incident authorization berasal dari claim mapping salah.

### 20.5 Security Matrix Testing

Untuk sistem kompleks, buat matrix:

```text
role/authority x endpoint x method x resource state x tenant x expected decision
```

Contoh:

| Actor | Tenant | Authority | Resource Tenant | State | Action | Expected |
|---|---|---|---|---|---|---|
| Officer A | T1 | case:read | T1 | OPEN | view | allow |
| Officer A | T1 | case:read | T2 | OPEN | view | deny |
| Officer A | T1 | case:approve | T1 | DRAFT | approve | deny |
| Manager B | T1 | case:approve | T1 | SUBMITTED | approve | allow |

Ini lebih defensible daripada beberapa random unit test.

---

## 21. Observability and Audit for Security

Security observability bukan sekadar login log.

Minimal:

```text
authentication success/failure
authorization denied
token validation failure category
CSRF failure
CORS rejection
session created/destroyed
logout
privileged action
policy decision reason
admin configuration change
```

### 21.1 Logging

Log harus aman.

Jangan log:

- password,
- bearer token,
- refresh token,
- session id penuh,
- client secret,
- private key,
- full JWT,
- sensitive claim.

Boleh log:

- request id,
- subject id hash/stable internal id,
- tenant id,
- authority summary,
- decision code,
- endpoint pattern,
- source IP/proxy-derived IP jika sudah trusted chain,
- user agent hash jika perlu,
- failure category.

### 21.2 Metrics

Metrics berguna:

```text
authentication_success_total
authentication_failure_total{reason}
authorization_denied_total{endpoint,decision}
csrf_denied_total
jwt_validation_failure_total{reason}
session_active_count
security_filter_duration
```

Hati-hati cardinality.

Jangan pakai raw user id, token id, case id sebagai metric tag.

### 21.3 Audit

Audit security harus menjawab:

```text
Siapa melakukan apa, terhadap resource apa, kapan, dari mana, hasilnya apa, dan berdasarkan policy apa?
```

Untuk denial penting, audit juga bisa diperlukan:

```text
Actor attempted unauthorized access to restricted case.
```

Namun audit denial harus didesain agar tidak membuka data sensitif. Misalnya jika user tidak boleh tahu case exists, response 404 bisa lebih tepat daripada 403 dalam beberapa sistem. Audit internal tetap mencatat denial.

---

## 22. Common Misconfigurations and Failure Models

### 22.1 Rule Ordering Salah

```java
.requestMatchers("/api/**").authenticated()
.requestMatchers("/api/public/**").permitAll()
```

Rule kedua tidak pernah efektif jika rule pertama sudah match.

Benar:

```java
.requestMatchers("/api/public/**").permitAll()
.requestMatchers("/api/**").authenticated()
```

### 22.2 `anyRequest().permitAll()` di Akhir

Ini sering muncul saat development lalu lupa.

```java
.anyRequest().permitAll()
```

Untuk production, default lebih aman:

```java
.anyRequest().denyAll()
```

atau minimal:

```java
.anyRequest().authenticated()
```

### 22.3 CSRF Disabled Tanpa Threat Model

Tidak semua aplikasi boleh disable CSRF.

Jika browser + cookie auth, disable CSRF bisa serius.

### 22.4 JWT Valid tapi Authority Kosong

Token valid tetapi converter tidak memetakan authority.

Gejala:

```text
All authenticated requests pass .authenticated()
But hasAuthority rules always 403
```

Atau lebih buruk:

```text
Only .authenticated() digunakan, jadi token tanpa authority tetap bisa akses terlalu luas.
```

### 22.5 Session Tercipta di Stateless API

Gejala:

```text
Response mengandung JSESSIONID
API dianggap stateless tapi session store penuh
Logout behavior membingungkan
```

Periksa:

- session management,
- request cache,
- form login,
- oauth2 login,
- custom code `request.getSession()`.

### 22.6 Method Security Tidak Aktif

Annotation ada, tapi tidak berjalan.

Penyebab:

- belum enable method security,
- method dipanggil self-invocation,
- method private/final,
- bean bukan Spring bean,
- annotation di tempat yang tidak diproxy,
- test tidak memuat security config.

### 22.7 Permit Static Too Broad

```java
.requestMatchers("/**").permitAll()
```

Atau pattern static salah sehingga API ikut public.

### 22.8 Actuator Terbuka

```yaml
management.endpoints.web.exposure.include: '*'
```

Tanpa security/network restriction adalah risiko besar.

### 22.9 CORS Wildcard with Credentials

```text
allowCredentials = true
allowedOrigins = *
```

Ini invalid/berbahaya. Origin harus eksplisit.

### 22.10 Trusting X-Forwarded Headers Blindly

Jika aplikasi berada di balik reverse proxy, header seperti `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` harus diproses hanya dari trusted proxy.

Jangan gunakan IP dari header mentah sebagai security decision tanpa trusted boundary.

---

## 23. Design Recipes

### 23.1 Stateless Resource Server API

Cocok untuk backend API dengan bearer JWT.

```java
@Bean
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()
            .requestMatchers(HttpMethod.GET, "/api/cases/**").hasAuthority("case:read")
            .requestMatchers(HttpMethod.POST, "/api/cases/**").hasAuthority("case:create")
            .anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt
            .jwtAuthenticationConverter(jwtAuthenticationConverter())))
        .build();
}
```

Checklist:

- issuer/audience validated,
- authority converter explicit,
- session stateless,
- CSRF disabled only because bearer header model,
- CORS explicit,
- public endpoint limited,
- actuator separate,
- error response consistent.

### 23.2 Browser Web App with OIDC Login

```java
@Bean
SecurityFilterChain webSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/", "/assets/**", "/login/**").permitAll()
            .anyRequest().authenticated())
        .csrf(Customizer.withDefaults())
        .oauth2Login(Customizer.withDefaults())
        .logout(logout -> logout.logoutSuccessUrl("/"))
        .build();
}
```

Checklist:

- CSRF aktif,
- session timeout jelas,
- SameSite/Secure cookie benar,
- logout behavior jelas,
- OIDC authority mapping jelas,
- UI route dan API route tidak tercampur,
- CSP/security headers dipertimbangkan.

### 23.3 Internal Service API with API Key

```java
@Bean
SecurityFilterChain internalSecurity(HttpSecurity http, ApiKeyAuthenticationFilter apiKeyFilter) throws Exception {
    return http
        .securityMatcher("/internal/**")
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .csrf(csrf -> csrf.disable())
        .addFilterBefore(apiKeyFilter, UsernamePasswordAuthenticationFilter.class)
        .authorizeHttpRequests(auth -> auth
            .anyRequest().hasAuthority("internal:access"))
        .build();
}
```

Checklist:

- API key hashed at rest,
- rotation supported,
- no logging raw key,
- rate limiting,
- network restriction,
- mTLS preferred for higher trust,
- service identity mapped to least privilege.

### 23.4 Multi-Chain Enterprise App

```text
/actuator/**   -> ops chain
/internal/**   -> service auth chain
/api/**        -> JWT stateless chain
/**            -> OIDC web login chain
```

Checklist:

- explicit `@Order`,
- no matcher overlap ambiguity,
- catch-all last,
- actuator not swallowed by web chain,
- public endpoint explicit,
- error behavior per surface.

---

## 24. Security Review Checklist

Gunakan checklist ini ketika review PR/security config.

### 24.1 Chain and Matcher

- [ ] Berapa banyak `SecurityFilterChain`?
- [ ] Apakah chain order eksplisit?
- [ ] Apakah `securityMatcher` benar?
- [ ] Apakah catch-all chain terakhir?
- [ ] Apakah ada endpoint yang tidak match chain mana pun?
- [ ] Apakah public endpoint disengaja dan terdokumentasi?

### 24.2 Authentication

- [ ] Mechanism apa yang dipakai: session, JWT, opaque, API key, mTLS, OIDC?
- [ ] Apakah issuer/audience/token expiry divalidasi?
- [ ] Apakah credential tidak dilog?
- [ ] Apakah authority mapping eksplisit?
- [ ] Apakah disabled user/locked user ditangani?
- [ ] Apakah token revocation/staleness dipahami?

### 24.3 Authorization

- [ ] Apakah endpoint punya coarse authorization?
- [ ] Apakah service operation punya capability check?
- [ ] Apakah resource-level authorization ada?
- [ ] Apakah tenant isolation dicek?
- [ ] Apakah workflow state dicek?
- [ ] Apakah method security tidak bergantung pada self-invocation?
- [ ] Apakah default rule aman?

### 24.4 Browser-Specific

- [ ] Apakah CSRF sesuai threat model?
- [ ] Apakah CORS origin eksplisit?
- [ ] Apakah cookies `Secure`, `HttpOnly`, `SameSite` benar?
- [ ] Apakah CSP/security headers dipertimbangkan?
- [ ] Apakah logout benar?

### 24.5 Operations

- [ ] Apakah actuator aman?
- [ ] Apakah security events diaudit?
- [ ] Apakah denial log tidak bocor data?
- [ ] Apakah metrics tidak high-cardinality?
- [ ] Apakah incident investigation bisa menjawab siapa/apa/kapan/kenapa?

### 24.6 Testing

- [ ] Ada test unauthenticated?
- [ ] Ada test unauthorized?
- [ ] Ada test authorized?
- [ ] Ada test CSRF jika browser cookie auth?
- [ ] Ada test JWT authority mapping?
- [ ] Ada test tenant/resource-level denial?
- [ ] Ada security matrix untuk operation penting?

---

## 25. Java 8 sampai Java 25 Considerations

### 25.1 Java 8 / Spring Security 5 Era

Banyak sistem legacy masih memakai:

```text
Spring Security 5.x
Spring Boot 2.x
Spring Framework 5.3.x
javax.*
Java 8/11
WebSecurityConfigurerAdapter legacy style
```

Legacy config sering terlihat seperti:

```java
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {
    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .antMatchers("/public/**").permitAll()
            .anyRequest().authenticated();
    }
}
```

Modern style menggunakan bean `SecurityFilterChain`.

Migrasi bukan hanya syntax. Anda harus review:

- matcher semantics,
- authorization API,
- method security enablement,
- CSRF default behavior,
- JWT converter,
- test utilities,
- `javax` ke `jakarta` jika naik ke Spring 6+.

### 25.2 Java 17+ / Spring Security 6+ Era

Modern baseline:

```text
Spring Framework 6+
Spring Boot 3+
Spring Security 6+
Java 17+
jakarta.*
SecurityFilterChain bean style
AuthorizationManager model
```

Perubahan penting:

1. Tidak lagi memakai `WebSecurityConfigurerAdapter`.
2. Lambda DSL menjadi gaya umum.
3. `authorizeHttpRequests` menggantikan gaya lama `authorizeRequests`.
4. Method security modern memakai `@EnableMethodSecurity`.
5. Jakarta namespace.
6. Stronger integration dengan observability/modern Boot.

### 25.3 Java 21–25, Virtual Threads, and Security Context

Virtual threads mengurangi biaya blocking thread, tetapi tidak menghapus isu context.

Perhatikan:

1. SecurityContext masih perlu dipahami sebagai context propagation problem.
2. ThreadLocal pada virtual thread punya karakteristik berbeda dari pool platform thread, tetapi context tetap harus jelas lifecycle-nya.
3. Jangan menyimpan security context dalam long-lived static/global state.
4. Untuk async/background, tentukan actor model secara eksplisit.
5. JDBC/resource bottleneck tetap ada meskipun virtual thread murah.

---

## 26. Architecture Heuristics for Top-Tier Spring Security

### 26.1 Treat Security as a Boundary System

Security bukan fitur controller.

Desain boundary:

```text
Network/Gateway boundary
  -> TLS/mTLS/WAF/rate limit

Spring Security HTTP boundary
  -> authentication, request authorization, CSRF/CORS/session/security headers

Application service boundary
  -> operation authorization

Domain/policy boundary
  -> resource-level decision

Data boundary
  -> tenant constraint/query constraint

Audit boundary
  -> defensibility
```

### 26.2 Prefer Explicit Authority Model

Jangan hanya:

```text
ROLE_ADMIN
ROLE_USER
```

Gunakan capability yang stabil:

```text
case:read
case:update
case:approve
appeal:review
report:export
admin:user.manage
```

Role boleh menjadi grouping, tetapi authority adalah permission runtime.

### 26.3 Separate Identity from Domain Actor

Identity provider subject bukan selalu domain actor.

```text
IdP subject -> authenticated identity
Application actor -> domain participant with agency, appointment, delegation, assignment
```

Mapping harus eksplisit.

### 26.4 Do Not Put All Authorization in Annotations

Annotation bagus untuk coarse-grained dan operation-level check.

Tapi untuk resource-level policy, gunakan policy service eksplisit.

```text
@PreAuthorize -> can call operation generally
Policy service -> can act on this resource in this state
```

### 26.5 Make Denial Explainable Internally

Untuk user, error bisa singkat:

```json
{
  "type": "https://example.com/problems/forbidden",
  "title": "Forbidden",
  "status": 403,
  "detail": "You are not allowed to perform this action."
}
```

Untuk audit/internal:

```text
DENIED: actor=U123 tenant=T1 action=case.approve case=C99 reason=CASE_STATE_NOT_SUBMITTED policy=CASE_APPROVAL_POLICY_V3
```

Security yang defensible harus bisa menjelaskan keputusan tanpa membocorkan detail ke pihak yang tidak berhak.

---

## 27. Mini Case Study: Case Approval API

Requirement:

```text
Officer can submit a case.
Manager can approve a submitted case.
Manager cannot approve own submitted case.
Manager can only approve within same tenant/agency.
Restricted case requires elevated authority.
All approvals and denials must be auditable.
```

### 27.1 HTTP Layer

```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers(HttpMethod.POST, "/api/cases/*/approve")
        .hasAuthority("case:approve")
    .anyRequest().authenticated()
);
```

Ini hanya coarse gate.

### 27.2 Application Service

```java
@Service
public class CaseApprovalService {

    private final CaseRepository caseRepository;
    private final CaseApprovalPolicy approvalPolicy;
    private final AuditService auditService;

    @PreAuthorize("hasAuthority('case:approve')")
    @Transactional
    public ApprovalResult approve(ApproveCaseCommand command, Actor actor) {
        CaseRecord record = caseRepository.getForUpdate(command.caseId());

        ApprovalDecision decision = approvalPolicy.canApprove(actor, record);
        if (decision.denied()) {
            auditService.recordDenied(actor, record, decision.reason());
            throw new AccessDeniedException("Approval denied");
        }

        record.approve(actor.id(), command.comment());
        auditService.recordApproved(actor, record);

        return ApprovalResult.approved(record.id());
    }
}
```

### 27.3 Policy

```java
@Component
public class CaseApprovalPolicy {

    public ApprovalDecision canApprove(Actor actor, CaseRecord record) {
        if (!actor.tenantId().equals(record.tenantId())) {
            return ApprovalDecision.denied("TENANT_MISMATCH");
        }
        if (!record.status().equals(CaseStatus.SUBMITTED)) {
            return ApprovalDecision.denied("INVALID_CASE_STATE");
        }
        if (record.submittedBy().equals(actor.id())) {
            return ApprovalDecision.denied("FOUR_EYES_RULE");
        }
        if (record.restricted() && !actor.hasAuthority("case:restricted.approve")) {
            return ApprovalDecision.denied("RESTRICTED_CASE_REQUIRES_ELEVATION");
        }
        return ApprovalDecision.granted();
    }
}
```

### 27.4 Why This Design Is Better

Karena:

1. URL security mencegah anonymous/wrong capability.
2. Method security menjaga operation jika dipanggil non-HTTP.
3. Policy service menjaga resource-level rule.
4. Transaction boundary membungkus state mutation.
5. Audit mencatat allow/deny.
6. Rule reason bisa diuji.
7. Policy tidak tersembunyi dalam SpEL panjang.

---

## 28. Ringkasan Mental Model

Ingat struktur ini:

```text
DelegatingFilterProxy
  -> FilterChainProxy
      -> selected SecurityFilterChain
          -> security filters
              -> authentication extraction
              -> authentication verification
              -> security context establishment
              -> authorization decision
              -> exception translation
              -> controller/application
```

Dan untuk desain enterprise:

```text
Authentication proves identity.
Authorization grants action.
Policy decides resource-specific permission.
Audit makes decision defensible.
```

Jangan desain security hanya dengan:

```text
role + endpoint pattern
```

Untuk sistem serius, desainlah dengan:

```text
identity + authority + tenant + resource + state + channel + audit + failure semantics
```

---

## 29. Referensi Resmi yang Direkomendasikan

Baca referensi resmi berikut ketika ingin memverifikasi detail implementasi:

1. Spring Security Reference — Servlet Architecture  
   `https://docs.spring.io/spring-security/reference/servlet/architecture.html`

2. Spring Security Reference — Servlet Authentication Architecture  
   `https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html`

3. Spring Security Reference — Authorize HTTP Requests  
   `https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html`

4. Spring Security API — AuthorizationManager  
   `https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authorization/AuthorizationManager.html`

5. Spring Security Reference — What's New  
   `https://docs.spring.io/spring-security/reference/whats-new.html`

---

## 30. Latihan Pemahaman

Jawab tanpa melihat catatan:

1. Apa beda `securityMatcher` dan `requestMatchers`?
2. Kenapa request bisa menghasilkan 401 bukan 403?
3. Kenapa `@PreAuthorize` bisa tidak berjalan walaupun annotation ada?
4. Kapan CSRF boleh dimatikan?
5. Kenapa JWT valid tidak berarti user boleh akses resource?
6. Kenapa authority lebih baik daripada role langsung untuk permission kompleks?
7. Apa risiko `anyRequest().permitAll()`?
8. Kenapa actuator harus dianggap security surface?
9. Apa beda authentication provider dan authorization manager?
10. Dalam sistem multi-tenant, layer mana saja yang harus sadar tenant?
11. Kenapa background job sebaiknya tidak selalu membawa full user `SecurityContext`?
12. Apa yang harus diaudit saat authorization denial?

---

## 31. Checklist Praktis Saat Membuat Security Config Baru

```text
1. Tentukan surface:
   - web UI?
   - REST API?
   - internal API?
   - actuator?
   - public endpoint?

2. Tentukan authentication mechanism:
   - session/OIDC login?
   - JWT resource server?
   - opaque token?
   - API key?
   - mTLS?

3. Tentukan session model:
   - stateful?
   - stateless?
   - hybrid per chain?

4. Tentukan CSRF model:
   - browser cookie auth -> usually enabled
   - bearer header API -> often disabled with reason

5. Tentukan CORS model:
   - allowed origins
   - allowed methods
   - allowed headers
   - credentials

6. Tentukan authority model:
   - roles as groups
   - authorities as capabilities

7. Tentukan authorization placement:
   - request-level
   - method-level
   - policy/resource-level
   - data-level

8. Tentukan error response:
   - 401 entry point
   - 403 access denied
   - Problem Details if API

9. Tentukan observability:
   - auth success/failure
   - denied decisions
   - token failures
   - suspicious access

10. Tulis tests:
   - unauthenticated
   - unauthorized
   - authorized
   - CSRF/CORS if relevant
   - tenant/resource denial
```

---

## 32. Penutup Part 18

Part ini memberikan fondasi arsitektur Spring Security di aplikasi Spring. Yang perlu dibawa ke part berikutnya:

1. Spring Security adalah filter pipeline dan decision framework.
2. Authentication, authorization, session, CSRF, CORS, OAuth2, dan method security adalah komponen berbeda.
3. Security config harus dibaca sebagai ordered chain, bukan kumpulan rule acak.
4. Method security bergantung pada proxy, sehingga semua pelajaran AOP dari Part 9 tetap berlaku.
5. Untuk sistem enterprise, authorization harus dipisahkan menjadi coarse endpoint gate, operation gate, resource policy, data isolation, dan audit defensibility.

Part berikutnya akan membahas caching:

```text
19-spring-caching-semantics-consistency-risk.md
```

Caching terlihat sederhana, tetapi di sistem enterprise ia bisa merusak correctness, authorization, tenant isolation, transaction semantics, dan audit jika tidak didesain dengan benar.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./17-error-handling-problem-details-failure-semantics.md">⬅️ Error Handling, Problem Details, and Failure Semantics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./19-spring-caching-semantics-consistency-risk.md">Part 19 — Spring Caching Semantics and Consistency Risk ➡️</a>
</div>
