# Part 18 — Security Integration: Authentication, Authorization, Principal, Roles, and Context

Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
File: `18-security-integration-authentication-authorization-principal-roles-context.md`

> Tujuan bagian ini: memahami bagaimana security ditempatkan di boundary Jersey secara benar: authentication, authorization, principal, role, `SecurityContext`, filter, annotation authorization, integration JWT/OIDC, object-level authorization, audit, dan failure handling. Fokusnya bukan membuat “login sederhana”, tetapi membangun security boundary yang bisa dipertanggungjawabkan di production enterprise.

---

## 1. Posisi Materi Ini dalam Series

Sampai Part 17, kita sudah membedah Jersey dari sisi:

- runtime model,
- bootstrap,
- resource matching,
- parameter binding,
- entity provider,
- JSON serialization,
- response engineering,
- exception mapping,
- filters/interceptors,
- injection,
- integration dengan DI container,
- Jersey Client,
- resilience outbound,
- async,
- SSE,
- multipart dan payload besar.

Part 18 sekarang masuk ke pertanyaan penting:

> Setelah request berhasil masuk ke resource, bagaimana sistem tahu siapa pemanggilnya, apa otoritasnya, resource apa yang boleh diakses, dan bagaimana keputusan itu dapat diaudit?

Di sistem sederhana, security sering dianggap sebagai satu filter token.

Di sistem enterprise, security adalah kombinasi beberapa lapisan:

```text
Transport security
  -> Authentication
      -> Identity extraction
          -> Principal construction
              -> Role/authority mapping
                  -> Request context propagation
                      -> Resource-level authorization
                          -> Object-level authorization
                              -> Audit trail
                                  -> Safe error response
```

Jersey berada terutama di boundary HTTP/resource layer. Karena itu Jersey sangat cocok untuk:

- membaca credential dari request,
- memvalidasi credential atau menerima hasil validasi dari upstream,
- membuat `SecurityContext`,
- mengekspos principal ke resource layer,
- menjalankan role-based authorization,
- menolak request sebelum service layer dipanggil,
- menghubungkan security decision dengan audit/logging/correlation.

Namun Jersey bukan satu-satunya tempat security hidup. Di aplikasi nyata, security juga bisa berada di:

- API gateway,
- reverse proxy,
- service mesh,
- servlet container,
- Jakarta Security,
- Spring Security,
- CDI interceptor,
- method security,
- database row-level policy,
- domain service authorization,
- audit subsystem.

Skill pentingnya bukan hanya “pakai annotation apa”, tetapi memahami **di lapisan mana keputusan security dibuat**.

---

## 2. Target Kompetensi

Setelah menyelesaikan bagian ini, kamu harus bisa:

1. Menjelaskan perbedaan authentication, authorization, principal, role, scope, permission, dan claim.
2. Mendesain authentication filter Jersey yang membangun `SecurityContext` secara benar.
3. Menggunakan `@Context SecurityContext` tanpa mencampur logic security ke seluruh kode.
4. Memahami kapan memakai `@RolesAllowed`, `@PermitAll`, dan `@DenyAll`.
5. Mengerti peran `RolesAllowedDynamicFeature` di Jersey.
6. Mendesain JWT/OIDC integration pattern tanpa membuat resource layer bergantung penuh ke token raw.
7. Membedakan resource-level authorization dan object-level authorization.
8. Menghindari confused deputy problem.
9. Membuat error response security yang aman dan tidak membocorkan informasi.
10. Menghubungkan security decision ke audit trail, correlation ID, dan observability.
11. Menilai integration boundary antara Jersey, Servlet Security, Jakarta Security, Spring Security, dan API Gateway.
12. Membuat checklist security Jersey untuk production.

---

## 3. Referensi Konseptual

Jakarta REST menyediakan `SecurityContext` sebagai abstraksi untuk mengakses principal, role membership, skema authentication, dan apakah request datang melalui channel aman. API ini adalah contract portable di layer Jakarta REST.

Jersey sebagai implementasi Jakarta REST menyediakan integration point melalui filter, context, dan feature. Dokumentasi Jersey menjelaskan bahwa pada deployment Servlet, Jersey `SecurityContext` dapat membungkus security context yang berasal dari Servlet container. Jersey juga menyediakan fitur untuk mengaktifkan annotation authorization berbasis role seperti `@RolesAllowed` melalui dynamic feature.

Kita akan memakai mental model berikut:

```text
Jakarta REST spec:
  menyediakan abstraction: SecurityContext, annotations, filters

Jersey runtime:
  menjalankan filter, memasang SecurityContext, melakukan dynamic feature binding

Container/framework:
  mungkin sudah melakukan authentication sebelum Jersey

Application/domain layer:
  melakukan authorization yang butuh object/domain state
```

---

## 4. Terminologi Security yang Harus Dibedakan

### 4.1 Authentication

Authentication adalah proses menjawab:

> “Siapa pemanggil request ini?”

Contoh mekanisme:

- Basic authentication,
- session cookie,
- bearer token,
- JWT,
- opaque token introspection,
- mTLS client certificate,
- API key,
- signed request,
- upstream identity header dari gateway.

Output authentication idealnya bukan sekadar boolean, tetapi identitas terstruktur:

```text
AuthenticatedIdentity
  subject: user-123
  username: fajar
  displayName: Fajar Abdi Nugraha
  tenantId: agency-a
  authenticationMethod: bearer-jwt
  issuer: https://idp.example.com
  roles: [case_officer, supervisor]
  permissions: [case.read, case.assign]
  scopes: [openid, profile, case-api]
  assuranceLevel: AAL2
  issuedAt: ...
  expiresAt: ...
```

### 4.2 Authorization

Authorization adalah proses menjawab:

> “Apakah identitas ini boleh melakukan aksi ini terhadap resource ini?”

Authorization punya beberapa level:

```text
Coarse-grained:
  boleh akses endpoint GET /cases?

Role-based:
  apakah punya role case_officer?

Permission-based:
  apakah punya permission case.read?

Object-level:
  apakah user ini boleh membaca case C-1001?

State-based:
  apakah case masih dalam status Draft sehingga boleh diedit?

Relationship-based:
  apakah user assigned officer untuk case ini?

Policy-based:
  apakah user dari agency yang sama, punya delegation aktif, dan action dilakukan dalam business hour?
```

Jersey cocok untuk coarse-grained dan sebagian role-based authorization. Untuk object-level/domain authorization, service/domain layer biasanya lebih tepat.

### 4.3 Principal

`Principal` adalah representasi identitas authenticated user di Java.

Minimal interface-nya hanya:

```java
public interface Principal {
    String getName();
}
```

Karena terlalu minimal, aplikasi production biasanya butuh principal custom:

```java
public final class AppPrincipal implements Principal {
    private final String subject;
    private final String username;
    private final String tenantId;
    private final Set<String> roles;
    private final Set<String> permissions;

    public AppPrincipal(
            String subject,
            String username,
            String tenantId,
            Set<String> roles,
            Set<String> permissions) {
        this.subject = subject;
        this.username = username;
        this.tenantId = tenantId;
        this.roles = Set.copyOf(roles);
        this.permissions = Set.copyOf(permissions);
    }

    @Override
    public String getName() {
        return subject;
    }

    public String subject() {
        return subject;
    }

    public String username() {
        return username;
    }

    public String tenantId() {
        return tenantId;
    }

    public boolean hasRole(String role) {
        return roles.contains(role);
    }

    public boolean hasPermission(String permission) {
        return permissions.contains(permission);
    }

    public Set<String> roles() {
        return roles;
    }

    public Set<String> permissions() {
        return permissions;
    }
}
```

Di Java 16+, ini bisa dibuat sebagai `record`, tetapi kalau aplikasi masih mendukung Java 8, gunakan class immutable biasa.

### 4.4 Role

Role adalah label otoritas yang biasanya cukup coarse-grained.

Contoh:

```text
admin
case_officer
case_supervisor
compliance_manager
read_only_auditor
```

Role cocok untuk:

- membatasi area besar aplikasi,
- menentukan menu/fitur umum,
- endpoint-level guard,
- operasi administratif.

Role kurang cocok untuk:

- object-level access,
- state transition detail,
- delegation temporary,
- per-record ownership,
- field-level access,
- complex approval matrix.

### 4.5 Permission

Permission lebih granular daripada role.

Contoh:

```text
case.read
case.create
case.update
case.assign
case.approve
case.export
appeal.view
appeal.decide
user.manage
```

Dalam sistem matang, role sering dipetakan ke permission:

```text
Role: case_supervisor
  -> case.read
  -> case.assign
  -> case.review
  -> case.escalate
```

Jersey `SecurityContext.isUserInRole()` berbasis role string. Kalau kamu ingin permission-based authorization, jangan memaksakan semua permission menjadi role kecuali memang konsisten. Lebih baik buat abstraction sendiri di service/domain authorization layer.

### 4.6 Scope

Scope sering berasal dari OAuth2/OIDC.

Contoh:

```text
openid
profile
email
case-api.read
case-api.write
```

Scope menjelaskan apa yang client application boleh lakukan, bukan selalu apa yang end-user boleh lakukan.

Ini distinction penting:

```text
Client scope:
  aplikasi pemanggil boleh call API apa?

User role/permission:
  user di dalam aplikasi boleh melakukan apa?
```

Kesalahan umum:

> Menganggap OAuth scope sama dengan business authorization.

Scope bisa menjadi salah satu input authorization, tetapi biasanya belum cukup.

### 4.7 Claim

Claim adalah pernyataan dalam token atau identity document.

Contoh JWT claim:

```json
{
  "sub": "user-123",
  "iss": "https://idp.example.com",
  "aud": "case-api",
  "exp": 1760000000,
  "iat": 1759990000,
  "scope": "openid case-api.read",
  "roles": ["case_officer"],
  "tenant_id": "agency-a"
}
```

Claim bukan otomatis trusted kecuali token sudah divalidasi:

- signature valid,
- issuer valid,
- audience valid,
- expiry valid,
- not-before valid,
- algorithm allowed,
- key trusted,
- token type benar,
- replay/nonce/jti policy sesuai kebutuhan.

---

## 5. Jersey SecurityContext Mental Model

`SecurityContext` adalah object yang menjawab empat hal utama:

```java
Principal getUserPrincipal();
boolean isUserInRole(String role);
boolean isSecure();
String getAuthenticationScheme();
```

Mental model-nya:

```text
Request masuk
  -> authentication layer menentukan identity
      -> Jersey SecurityContext dipasang ke request
          -> resource/filter/mapper bisa membaca SecurityContext
              -> role check dan audit bisa dilakukan konsisten
```

Contoh penggunaan di resource:

```java
@Path("/me")
public class MeResource {

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public UserProfileResponse me(@Context SecurityContext securityContext) {
        Principal principal = securityContext.getUserPrincipal();

        if (principal == null) {
            throw new NotAuthorizedException("Bearer");
        }

        return new UserProfileResponse(principal.getName());
    }
}
```

Namun untuk production, jangan menyebarkan logic seperti ini di semua resource. Lebih baik:

- authentication dipusatkan di filter,
- current identity disediakan melalui abstraction,
- authorization penting dipusatkan di policy/service,
- resource hanya menjadi boundary orchestration.

---

## 6. Authentication di Jersey: ContainerRequestFilter

Authentication custom paling umum dilakukan dengan `ContainerRequestFilter`.

```text
ContainerRequestFilter
  -> membaca Authorization header / cookie / certificate / forwarded identity
  -> validasi credential
  -> membangun principal
  -> membuat SecurityContext custom
  -> memasang ke ContainerRequestContext
```

Contoh skeleton:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class BearerAuthenticationFilter implements ContainerRequestFilter {

    private final TokenVerifier tokenVerifier;

    public BearerAuthenticationFilter(TokenVerifier tokenVerifier) {
        this.tokenVerifier = tokenVerifier;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String authorization = requestContext.getHeaderString(HttpHeaders.AUTHORIZATION);

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new NotAuthorizedException("Bearer");
        }

        String token = authorization.substring("Bearer ".length()).trim();
        AuthenticatedIdentity identity = tokenVerifier.verify(token);

        SecurityContext original = requestContext.getSecurityContext();
        SecurityContext securityContext = new AppSecurityContext(identity, original.isSecure());

        requestContext.setSecurityContext(securityContext);
    }
}
```

Custom `SecurityContext`:

```java
public final class AppSecurityContext implements SecurityContext {

    private final AuthenticatedIdentity identity;
    private final boolean secure;

    public AppSecurityContext(AuthenticatedIdentity identity, boolean secure) {
        this.identity = identity;
        this.secure = secure;
    }

    @Override
    public Principal getUserPrincipal() {
        return identity.principal();
    }

    @Override
    public boolean isUserInRole(String role) {
        return identity.roles().contains(role);
    }

    @Override
    public boolean isSecure() {
        return secure;
    }

    @Override
    public String getAuthenticationScheme() {
        return "Bearer";
    }

    public AuthenticatedIdentity identity() {
        return identity;
    }
}
```

Java 8 compatible identity class:

```java
public final class AuthenticatedIdentity {
    private final AppPrincipal principal;
    private final Set<String> roles;
    private final Set<String> permissions;
    private final String issuer;
    private final Instant authenticatedAt;

    public AuthenticatedIdentity(
            AppPrincipal principal,
            Set<String> roles,
            Set<String> permissions,
            String issuer,
            Instant authenticatedAt) {
        this.principal = principal;
        this.roles = Collections.unmodifiableSet(new HashSet<>(roles));
        this.permissions = Collections.unmodifiableSet(new HashSet<>(permissions));
        this.issuer = issuer;
        this.authenticatedAt = authenticatedAt;
    }

    public AppPrincipal principal() {
        return principal;
    }

    public Set<String> roles() {
        return roles;
    }

    public Set<String> permissions() {
        return permissions;
    }

    public String issuer() {
        return issuer;
    }

    public Instant authenticatedAt() {
        return authenticatedAt;
    }
}
```

Java 17+ version could be:

```java
public record AuthenticatedIdentity(
        AppPrincipal principal,
        Set<String> roles,
        Set<String> permissions,
        String issuer,
        Instant authenticatedAt
) {
    public AuthenticatedIdentity {
        roles = Set.copyOf(roles);
        permissions = Set.copyOf(permissions);
    }
}
```

---

## 7. Filter Priority: Authentication Before Authorization

Jersey/Jakarta REST filters support priority.

Authentication should run before authorization.

```java
@Priority(Priorities.AUTHENTICATION)
public final class BearerAuthenticationFilter implements ContainerRequestFilter {
    // validate credential, install SecurityContext
}
```

Authorization filters should run after identity exists:

```java
@Priority(Priorities.AUTHORIZATION)
public final class TenantAuthorizationFilter implements ContainerRequestFilter {
    // check tenant, role, coarse-grained access
}
```

Mental model:

```text
AUTHENTICATION priority
  -> Who are you?

AUTHORIZATION priority
  -> Are you allowed to call this?

USER/application filters
  -> Logging, audit, domain-specific behavior
```

Kesalahan umum:

```text
Authorization filter membaca principal
  tetapi authentication filter belum memasang SecurityContext
    -> principal null
    -> request ditolak salah
    -> atau anonymous dianggap valid
```

---

## 8. Pre-Matching vs Post-Matching Security Filter

Filter bisa pre-matching atau post-matching.

### 8.1 Pre-Matching

Pre-matching berjalan sebelum Jersey menentukan resource method.

```java
@Provider
@PreMatching
@Priority(Priorities.AUTHENTICATION)
public final class EarlyAuthenticationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext requestContext) {
        // runs before resource matching
    }
}
```

Cocok untuk:

- normalisasi header,
- reject request sangat awal,
- method override handling,
- security checks yang tidak butuh method/resource metadata,
- global authentication yang berlaku untuk semua route.

Tidak cocok untuk:

- authorization berdasarkan annotation resource method,
- policy yang butuh tahu method mana yang dipilih,
- name-bound security annotation.

### 8.2 Post-Matching

Default filter berjalan setelah resource matching.

Cocok untuk:

- membaca resource/method annotation,
- dynamic authorization,
- route-specific behavior,
- integration dengan `ResourceInfo`.

Contoh:

```java
@Provider
@Priority(Priorities.AUTHORIZATION)
public final class ResourcePolicyFilter implements ContainerRequestFilter {

    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        Method method = resourceInfo.getResourceMethod();
        Class<?> resourceClass = resourceInfo.getResourceClass();

        // inspect annotations, apply policy
    }
}
```

Prinsip:

```text
Authentication global biasanya bisa pre/post matching.
Authorization berbasis resource method biasanya post-matching.
```

---

## 9. Public Endpoint, Optional Authentication, dan Anonymous Context

Tidak semua endpoint harus authenticated.

Contoh public endpoint:

- `/health/live`,
- `/health/ready`,
- `/openapi`,
- `/login/callback`,
- `/public/config`,
- `/assets/*`.

Ada dua strategi:

### 9.1 Skip Authentication untuk Public Path

```java
private boolean isPublicPath(ContainerRequestContext requestContext) {
    String path = requestContext.getUriInfo().getPath();
    return path.equals("health/live")
            || path.equals("health/ready")
            || path.startsWith("public/");
}
```

Filter:

```java
@Override
public void filter(ContainerRequestContext requestContext) {
    if (isPublicPath(requestContext)) {
        return;
    }

    // require bearer token
}
```

Kelemahan:

- raw path matching bisa drift dari resource mapping,
- rentan salah ketika base path/proxy berubah,
- public/private policy tersebar di filter.

### 9.2 Annotation-Based Public Endpoint

Buat annotation:

```java
@NameBinding
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface PublicEndpoint {
}
```

Tetapi name binding biasanya mengikat filter ke resource, bukan otomatis exclude dari global filter. Untuk optional authentication berdasarkan annotation, gunakan `ResourceInfo` di post-matching filter.

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class AuthenticationFilter implements ContainerRequestFilter {

    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        if (isPublic(resourceInfo)) {
            authenticateIfPresent(requestContext);
            return;
        }

        authenticateRequired(requestContext);
    }

    private boolean isPublic(ResourceInfo info) {
        Method method = info.getResourceMethod();
        Class<?> clazz = info.getResourceClass();

        return method.isAnnotationPresent(PublicEndpoint.class)
                || clazz.isAnnotationPresent(PublicEndpoint.class);
    }
}
```

Catatan:

- Ini membutuhkan post-matching filter.
- Jika authentication harus terjadi sangat awal, perlu desain lain.

### 9.3 Anonymous SecurityContext

Untuk endpoint public, kamu bisa memasang anonymous context:

```java
public final class AnonymousSecurityContext implements SecurityContext {
    @Override
    public Principal getUserPrincipal() {
        return null;
    }

    @Override
    public boolean isUserInRole(String role) {
        return false;
    }

    @Override
    public boolean isSecure() {
        return false;
    }

    @Override
    public String getAuthenticationScheme() {
        return null;
    }
}
```

Namun jangan membuat anonymous principal palsu kecuali ada alasan kuat. Principal null lebih jelas untuk unauthenticated request.

---

## 10. Role-Based Authorization dengan `@RolesAllowed`

Jakarta/Jakarta EE ecosystem mengenal annotations:

```java
@RolesAllowed("admin")
@PermitAll
@DenyAll
```

Contoh:

```java
@Path("/admin/users")
@Produces(MediaType.APPLICATION_JSON)
public class AdminUserResource {

    @GET
    @RolesAllowed("admin")
    public List<UserResponse> listUsers() {
        return List.of();
    }
}
```

Agar role annotation diproses oleh Jersey, di banyak setup Jersey kamu perlu register feature terkait:

```java
public class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        packages("com.example.api");
        register(RolesAllowedDynamicFeature.class);
    }
}
```

Mental model:

```text
@RolesAllowed tidak melakukan magic sendiri.
Jersey perlu feature/filter yang membaca annotation itu.
Feature akan memasang authorization behavior pada resource method terkait.
Authorization tetap bergantung pada SecurityContext.isUserInRole(role).
```

Jadi chain-nya:

```text
BearerAuthenticationFilter
  -> set SecurityContext
      -> RolesAllowedDynamicFeature checks @RolesAllowed
          -> calls securityContext.isUserInRole("admin")
              -> allow/deny
```

Jika `SecurityContext` tidak dipasang, role check bisa gagal.

---

## 11. `@PermitAll`, `@DenyAll`, dan Default Policy

### 11.1 `@PermitAll`

`@PermitAll` berarti endpoint boleh diakses semua caller menurut model authorization annotation.

Namun hati-hati:

```text
PermitAll tidak selalu berarti unauthenticated boleh masuk.
```

Tergantung authentication layer kamu:

- Jika global auth filter mewajibkan token untuk semua endpoint, `@PermitAll` hanya berarti authenticated user mana pun boleh.
- Jika auth filter menghormati public annotation, baru bisa berarti anonymous allowed.

### 11.2 `@DenyAll`

`@DenyAll` berarti endpoint tidak boleh diakses.

Cocok untuk:

- endpoint disabled,
- method internal yang tidak seharusnya exposed,
- class-level block dengan method-level override.

Namun jangan bergantung pada `@DenyAll` untuk menyembunyikan route sensitif yang tidak sengaja terdaftar. Lebih baik jangan register resource tersebut.

### 11.3 Default-Deny vs Default-Allow

Production API sebaiknya berpikir default-deny.

```text
Default-allow:
  endpoint baru otomatis terbuka jika developer lupa annotation

Default-deny:
  endpoint baru otomatis tertolak kecuali diberi policy eksplisit
```

Contoh custom policy filter:

```java
@Provider
@Priority(Priorities.AUTHORIZATION)
public final class ExplicitSecurityPolicyFilter implements ContainerRequestFilter {

    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        Method method = resourceInfo.getResourceMethod();
        Class<?> clazz = resourceInfo.getResourceClass();

        boolean hasPolicy = hasSecurityAnnotation(method) || hasSecurityAnnotation(clazz);

        if (!hasPolicy) {
            throw new ForbiddenException("Missing security policy");
        }
    }

    private boolean hasSecurityAnnotation(AnnotatedElement element) {
        return element.isAnnotationPresent(RolesAllowed.class)
                || element.isAnnotationPresent(PermitAll.class)
                || element.isAnnotationPresent(DenyAll.class)
                || element.isAnnotationPresent(PublicEndpoint.class);
    }
}
```

Dalam production, jangan expose message `Missing security policy` ke client. Message itu untuk log internal.

---

## 12. JWT Authentication Pattern

JWT populer karena self-contained, tetapi mudah salah.

### 12.1 JWT Validation Checklist

Validasi JWT minimal:

```text
1. Parse token secara aman.
2. Pastikan algorithm allowed.
3. Ambil signing key dari trusted JWKS.
4. Verifikasi signature.
5. Verifikasi issuer.
6. Verifikasi audience.
7. Verifikasi expiry.
8. Verifikasi not-before bila ada.
9. Verifikasi token type/use bila ada.
10. Validasi clock skew secara terbatas.
11. Extract subject.
12. Extract roles/scopes/tenant.
13. Map claim ke internal identity.
```

Jangan hanya decode Base64 payload.

Salah:

```java
String[] parts = token.split("\\.");
String payload = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8);
// BAD: decoded is not validated
```

Benar secara prinsip:

```text
JWT string
  -> cryptographic verification
      -> semantic validation
          -> claim mapping
              -> principal creation
```

### 12.2 TokenVerifier Abstraction

Resource/filter tidak perlu tahu detail library JWT.

```java
public interface TokenVerifier {
    AuthenticatedIdentity verify(String token);
}
```

Implementasi bisa pakai library pilihan:

```java
public final class JwtTokenVerifier implements TokenVerifier {

    private final JwtDecoder decoder;
    private final IdentityMapper identityMapper;

    public JwtTokenVerifier(JwtDecoder decoder, IdentityMapper identityMapper) {
        this.decoder = decoder;
        this.identityMapper = identityMapper;
    }

    @Override
    public AuthenticatedIdentity verify(String token) {
        VerifiedJwt jwt = decoder.decodeAndVerify(token);
        return identityMapper.toIdentity(jwt);
    }
}
```

Pola ini menjaga Jersey layer bersih.

### 12.3 Claim Mapping

Jangan biarkan seluruh application layer membaca raw claim bebas.

Salah:

```java
String role = jwt.getClaim("realm_access").get("roles").get(0);
```

Lebih baik:

```java
AuthenticatedIdentity identity = identityMapper.toIdentity(jwt);
```

Mapping layer bertugas menormalisasi variasi IdP:

```text
Keycloak roles
Azure AD groups
Cognito groups
Custom claim permissions
OIDC standard claims
```

Menjadi bentuk internal stabil:

```text
subject
username
tenantId
roles
permissions
scopes
```

---

## 13. OIDC Integration Pattern

OIDC biasanya melibatkan:

- authorization code flow,
- ID token,
- access token,
- refresh token,
- userinfo endpoint,
- JWKS endpoint,
- issuer metadata.

Dalam API resource server, Jersey biasanya memvalidasi **access token**, bukan ID token.

Mental model:

```text
Browser/user login ke IdP
  -> client receives tokens
      -> client calls API with access token
          -> Jersey authentication filter validates access token
              -> SecurityContext installed
                  -> resource uses principal/policy
```

### 13.1 API Gateway Validates Token

Kadang token sudah divalidasi oleh gateway.

Gateway mengirim header internal:

```text
X-Authenticated-Subject: user-123
X-Authenticated-Tenant: agency-a
X-Authenticated-Roles: case_officer,case_supervisor
```

Ini bisa valid hanya kalau:

```text
API hanya menerima traffic dari trusted gateway
Header spoofing dicegah
mTLS/internal network policy aktif
Gateway identity contract jelas
Header canonicalization aman
```

Jika service bisa diakses langsung dari luar, jangan percaya header identity.

### 13.2 Jersey Filter for Upstream Identity

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class GatewayIdentityFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String subject = requestContext.getHeaderString("X-Authenticated-Subject");
        String tenant = requestContext.getHeaderString("X-Authenticated-Tenant");
        String rolesHeader = requestContext.getHeaderString("X-Authenticated-Roles");

        if (subject == null || tenant == null) {
            throw new NotAuthorizedException("Gateway");
        }

        Set<String> roles = parseRoles(rolesHeader);
        AppPrincipal principal = new AppPrincipal(subject, subject, tenant, roles, Set.of());
        AuthenticatedIdentity identity = new AuthenticatedIdentity(
                principal,
                roles,
                Set.of(),
                "trusted-gateway",
                Instant.now()
        );

        requestContext.setSecurityContext(new AppSecurityContext(identity, requestContext.getSecurityContext().isSecure()));
    }

    private Set<String> parseRoles(String rolesHeader) {
        if (rolesHeader == null || rolesHeader.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(rolesHeader.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toSet());
    }
}
```

Untuk Java 8, ganti `Set.of()` dan `isBlank()` dengan equivalent:

```java
Collections.emptySet();
rolesHeader.trim().isEmpty();
```

---

## 14. API Key Authentication

API key sering dipakai untuk service-to-service atau integration partner.

Contoh header:

```text
X-API-Key: abcdef
```

Atau:

```text
Authorization: ApiKey abcdef
```

Pola production:

```text
API key diterima
  -> hash key
      -> lookup key record
          -> check active/revoked/expired
              -> check allowed client/application
                  -> build service principal
```

Jangan simpan API key plaintext di database. Simpan hash.

Contoh identity:

```text
Principal:
  subject: service:partner-reporting
  type: machine
  roles: integration_partner
  permissions: report.submit
```

API key tidak otomatis mewakili user. Jika API key melakukan action atas nama user, harus ada explicit delegation/on-behalf-of model.

---

## 15. mTLS dan Client Certificate

mTLS bisa digunakan untuk service authentication.

Dalam Servlet container, client certificate bisa tersedia sebagai request attribute. Jersey dapat membaca melalui injected servlet request jika integration tersedia.

Contoh konseptual:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class ClientCertificateFilter implements ContainerRequestFilter {

    @Context
    private HttpServletRequest servletRequest;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        X509Certificate[] certs = (X509Certificate[]) servletRequest.getAttribute(
                "jakarta.servlet.request.X509Certificate"
        );

        if (certs == null || certs.length == 0) {
            throw new NotAuthorizedException("Client certificate required");
        }

        X509Certificate clientCert = certs[0];
        // validate subject/issuer/fingerprint/policy
    }
}
```

Catatan namespace:

- Servlet older stack bisa memakai `javax.servlet.request.X509Certificate`.
- Jakarta stack memakai `jakarta.servlet.request.X509Certificate`.

mTLS kuat untuk service identity, tetapi tidak menggantikan user authorization bila endpoint melakukan aksi user-level.

---

## 16. SecurityContext vs Custom CurrentUser Service

Resource bisa langsung pakai `SecurityContext`, tetapi untuk aplikasi besar lebih baik punya abstraction:

```java
public interface CurrentIdentity {
    AppPrincipal principal();
    String subject();
    String tenantId();
    boolean hasRole(String role);
    boolean hasPermission(String permission);
}
```

Implementasi Jersey:

```java
@RequestScoped
public final class JerseyCurrentIdentity implements CurrentIdentity {

    @Context
    private SecurityContext securityContext;

    @Override
    public AppPrincipal principal() {
        Principal principal = securityContext.getUserPrincipal();
        if (principal instanceof AppPrincipal) {
            return (AppPrincipal) principal;
        }
        throw new IllegalStateException("Authenticated AppPrincipal is required");
    }

    @Override
    public String subject() {
        return principal().subject();
    }

    @Override
    public String tenantId() {
        return principal().tenantId();
    }

    @Override
    public boolean hasRole(String role) {
        return securityContext.isUserInRole(role);
    }

    @Override
    public boolean hasPermission(String permission) {
        return principal().hasPermission(permission);
    }
}
```

Service layer tidak perlu tahu Jersey:

```java
public final class CaseCommandService {

    private final CurrentIdentity currentIdentity;
    private final CaseAuthorizationPolicy authorizationPolicy;

    public CaseCommandService(CurrentIdentity currentIdentity,
                              CaseAuthorizationPolicy authorizationPolicy) {
        this.currentIdentity = currentIdentity;
        this.authorizationPolicy = authorizationPolicy;
    }

    public void assignCase(String caseId, String assigneeId) {
        AppPrincipal actor = currentIdentity.principal();
        authorizationPolicy.requireCanAssign(actor, caseId);
        // perform command
    }
}
```

Manfaat:

- Jersey tidak bocor ke domain/service layer.
- Test lebih mudah.
- Authorization lebih eksplisit.
- Migration ke Spring Security/CDI/Jakarta Security lebih mudah.

---

## 17. Resource-Level Authorization vs Object-Level Authorization

### 17.1 Resource-Level Authorization

Contoh:

```java
@GET
@Path("/cases")
@RolesAllowed({"case_officer", "case_supervisor"})
public List<CaseSummary> searchCases() {
    return service.searchCases();
}
```

Ini menjawab:

```text
Apakah user punya akses umum ke endpoint search cases?
```

### 17.2 Object-Level Authorization

Contoh:

```java
@GET
@Path("/cases/{caseId}")
@RolesAllowed({"case_officer", "case_supervisor"})
public CaseDetail getCase(@PathParam("caseId") String caseId) {
    return service.getCase(caseId);
}
```

Di service:

```java
public CaseDetail getCase(String caseId) {
    AppPrincipal actor = currentIdentity.principal();
    CaseRecord record = caseRepository.findRequired(caseId);

    authorizationPolicy.requireCanView(actor, record);

    return mapper.toDetail(record);
}
```

Policy:

```java
public final class CaseAuthorizationPolicy {

    public void requireCanView(AppPrincipal actor, CaseRecord record) {
        if (actor.hasRole("case_supervisor") && sameTenant(actor, record)) {
            return;
        }

        if (actor.hasRole("case_officer")
                && sameTenant(actor, record)
                && record.assignedOfficerId().equals(actor.subject())) {
            return;
        }

        throw new ForbiddenException("Access denied");
    }

    private boolean sameTenant(AppPrincipal actor, CaseRecord record) {
        return actor.tenantId().equals(record.tenantId());
    }
}
```

Kenapa object-level authorization tidak ideal di Jersey filter?

Karena filter biasanya belum punya domain object. Kalau filter harus query database untuk semua policy, resource layer menjadi terlalu berat dan coupling meningkat.

Pattern yang sehat:

```text
Jersey annotation/filter:
  coarse gate

Service/domain policy:
  object/state/relationship gate
```

---

## 18. Tenant Context dan Multi-Tenancy

Multi-tenant system tidak cukup dengan role.

User bisa punya role `case_officer`, tetapi hanya untuk tenant tertentu.

Identity:

```text
subject: user-123
tenantId: agency-a
roles: [case_officer]
```

Request:

```http
GET /tenants/agency-b/cases/C-1001
```

Harus ditolak jika actor tenant `agency-a`.

Jangan hanya check:

```java
@RolesAllowed("case_officer")
```

Tambahkan tenant authorization:

```java
public void requireTenantAccess(AppPrincipal actor, String requestedTenantId) {
    if (!actor.tenantId().equals(requestedTenantId)) {
        throw new ForbiddenException("Access denied");
    }
}
```

Lebih baik lagi, hindari tenant ID dari path jika tenant sudah implicit dari identity, kecuali API memang cross-tenant/admin.

```text
Safer:
  GET /cases/{caseId}
  tenant resolved from current identity

Riskier:
  GET /tenants/{tenantId}/cases/{caseId}
  tenant parameter can be tampered
```

Jika harus ada `{tenantId}`, validate against identity.

---

## 19. Confused Deputy Problem

Confused deputy terjadi ketika service dengan privilege lebih tinggi dipakai oleh caller yang tidak berhak untuk melakukan aksi.

Contoh:

```text
User A tidak boleh baca Case X.
API endpoint /reports/export menerima caseId.
Report service punya akses database luas.
Endpoint lupa check object-level permission.
User A berhasil export Case X melalui report service.
```

Di sini report service menjadi “deputy” yang confused.

Prevention:

```text
1. Semua command/query sensitif menerima actor identity.
2. Policy check berada dekat dengan domain operation.
3. Service internal tidak otomatis bypass authorization.
4. Background/system actor eksplisit, bukan null user.
5. Audit mencatat actor asli dan delegated/system actor.
```

Contoh service method buruk:

```java
public CaseDetail getCase(String caseId) {
    return repository.findRequired(caseId);
}
```

Lebih baik:

```java
public CaseDetail getCase(AppPrincipal actor, String caseId) {
    CaseRecord record = repository.findRequired(caseId);
    authorizationPolicy.requireCanView(actor, record);
    return mapper.toDetail(record);
}
```

Atau jika memakai `CurrentIdentity`, tetap pastikan policy dipanggil di dalam service.

---

## 20. Delegation, On-Behalf-Of, dan System Actor

Enterprise system sering punya aksi yang dilakukan:

- oleh user langsung,
- oleh admin atas nama user,
- oleh scheduled job,
- oleh integration partner,
- oleh workflow engine,
- oleh service account.

Jangan menyamakan semua dengan user biasa.

Model actor yang lebih jelas:

```text
Actor
  type: USER | SERVICE | SYSTEM | DELEGATED
  subject: user-123
  tenant: agency-a
  actingFor: user-456?       // optional
  serviceName: mse-syncer?   // optional
  reason: scheduled-job?     // optional
```

Audit trail harus bisa menjawab:

```text
Who initiated the action?
Who technically executed it?
Was it delegated?
Under what authority?
What policy allowed it?
```

Contoh:

```java
public final class ActorContext {
    private final ActorType type;
    private final String subject;
    private final String tenantId;
    private final String actingFor;
    private final String authority;

    // immutable fields, getters
}
```

Untuk Jersey boundary, principal bisa tetap `AppPrincipal`, tetapi service layer bisa membangun `ActorContext` yang lebih kaya.

---

## 21. Security Error Semantics: 401 vs 403

### 21.1 401 Unauthorized

Meskipun namanya “Unauthorized”, HTTP 401 berarti authentication diperlukan atau gagal.

Gunakan 401 untuk:

```text
No credential
Invalid credential
Expired token
Malformed token
Unsupported authentication scheme
```

JAX-RS/Jakarta REST exception:

```java
throw new NotAuthorizedException("Bearer");
```

Response sebaiknya menyertakan `WWW-Authenticate` header bila relevan.

### 21.2 403 Forbidden

403 berarti identity sudah diketahui, tetapi tidak boleh melakukan aksi.

Gunakan 403 untuk:

```text
Authenticated but missing role
Authenticated but missing permission
Authenticated but wrong tenant
Authenticated but not assigned owner
Authenticated but object state disallows action
```

Exception:

```java
throw new ForbiddenException("Access denied");
```

### 21.3 404 untuk Hide Existence?

Kadang sistem sengaja mengembalikan 404 untuk object yang ada tetapi tidak boleh diketahui keberadaannya.

Contoh:

```text
GET /cases/C-SECRET
```

Jika 403 diberikan, attacker tahu case exists. Jika 404 diberikan, existence disembunyikan.

Trade-off:

```text
403:
  lebih jujur untuk legitimate user dan audit/debugging

404:
  mengurangi information disclosure untuk resource sensitif
```

Pattern:

- public-facing sensitive resource: boleh return 404 untuk unauthorized object.
- internal/admin API: 403 lebih mudah dioperasikan.
- audit internal tetap mencatat reason sebenarnya.

---

## 22. Exception Mapping untuk Security

Jangan biarkan error security bocor stack trace atau detail token.

Mapper:

```java
@Provider
public final class NotAuthorizedExceptionMapper implements ExceptionMapper<NotAuthorizedException> {

    @Context
    private HttpHeaders headers;

    @Override
    public Response toResponse(NotAuthorizedException exception) {
        ErrorResponse body = new ErrorResponse(
                "AUTHENTICATION_REQUIRED",
                "Authentication is required."
        );

        return Response.status(Response.Status.UNAUTHORIZED)
                .header(HttpHeaders.WWW_AUTHENTICATE, "Bearer")
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(body)
                .build();
    }
}
```

Forbidden mapper:

```java
@Provider
public final class ForbiddenExceptionMapper implements ExceptionMapper<ForbiddenException> {

    @Override
    public Response toResponse(ForbiddenException exception) {
        ErrorResponse body = new ErrorResponse(
                "ACCESS_DENIED",
                "You are not allowed to perform this action."
        );

        return Response.status(Response.Status.FORBIDDEN)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .entity(body)
                .build();
    }
}
```

Jangan expose:

```text
JWT expired at exact timestamp
Signature verification failed with kid abc
User lacks role internal.super.admin
Tenant mismatch: user agency-a tried agency-b
SQL row policy denied on table CASE_MASTER
```

Detail itu boleh masuk log/audit internal dengan masking yang tepat, bukan response publik.

---

## 23. Security Logging dan Audit

Security event tidak sama dengan application log biasa.

Minimal security event:

```text
eventType
correlationId
requestId
actorSubject
actorType
tenantId
clientId
sourceIp
userAgent
method
path
decision: ALLOW | DENY
reasonCode
resourceType
resourceId
timestamp
```

Contoh event:

```json
{
  "eventType": "AUTHORIZATION_DECISION",
  "correlationId": "corr-123",
  "actorSubject": "user-123",
  "tenantId": "agency-a",
  "method": "POST",
  "path": "/cases/C-1001/assign",
  "decision": "DENY",
  "reasonCode": "CASE_NOT_IN_TENANT",
  "resourceType": "CASE",
  "resourceId": "C-1001"
}
```

Security log harus:

- tidak menyimpan raw token,
- tidak menyimpan password/API key,
- tidak menyimpan full PII jika tidak perlu,
- punya retention policy,
- bisa dikorelasikan dengan request log,
- tidak mudah dimodifikasi oleh application user,
- cukup detail untuk investigasi.

### 23.1 Filter untuk Audit Start/End

```java
@Provider
@Priority(Priorities.AUTHORIZATION + 100)
public final class SecurityAuditFilter implements ContainerRequestFilter, ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty("security.audit.start", System.nanoTime());
    }

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        SecurityContext sc = requestContext.getSecurityContext();
        Principal principal = sc == null ? null : sc.getUserPrincipal();

        int status = responseContext.getStatus();
        boolean denied = status == 401 || status == 403;

        // emit structured audit event
        // never log Authorization header
    }
}
```

Namun untuk object-level authorization, audit sebaiknya dilakukan di policy/service layer karena filter tidak tahu domain reason detail.

---

## 24. CORS, CSRF, dan Browser Security Boundary

Jersey API sering dipanggil oleh browser SPA.

Security concern berbeda tergantung credential:

```text
Bearer token in Authorization header:
  CSRF risk lebih rendah, XSS risk tinggi jika token accessible by JS

Session cookie:
  CSRF risk tinggi, mitigasi SameSite/CSRF token/origin check

HttpOnly secure cookie:
  XSS token theft lebih rendah, tetap perlu CSRF handling
```

CORS bukan authentication.

CORS hanya browser enforcement untuk cross-origin request. Non-browser client tidak peduli CORS.

Jangan menganggap:

```text
Origin allowed == user authenticated
```

CORS filter harus hati-hati:

```java
@Provider
public final class CorsResponseFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {
        String origin = requestContext.getHeaderString("Origin");

        if (isAllowedOrigin(origin)) {
            responseContext.getHeaders().putSingle("Access-Control-Allow-Origin", origin);
            responseContext.getHeaders().putSingle("Vary", "Origin");
            responseContext.getHeaders().putSingle("Access-Control-Allow-Credentials", "true");
        }
    }

    private boolean isAllowedOrigin(String origin) {
        return origin != null && origin.equals("https://app.example.com");
    }
}
```

Jangan:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Browser akan menolak kombinasi itu, dan secara desain itu juga buruk.

---

## 25. Method-Level Security vs Resource-Level Security

Resource-level security:

```java
@Path("/cases")
@RolesAllowed("case_user")
public class CaseResource {
    // all methods require case_user unless overridden
}
```

Method-level security:

```java
@POST
@Path("/{caseId}/approve")
@RolesAllowed("case_approver")
public Response approve(@PathParam("caseId") String caseId) {
    service.approve(caseId);
    return Response.noContent().build();
}
```

Class-level annotation bagus untuk baseline.

Method-level annotation bagus untuk action spesifik.

Tapi jangan terlalu percaya annotation kalau aksi memiliki domain rule kompleks:

```text
@RolesAllowed("case_approver")
```

belum menjawab:

```text
Apakah approver boleh approve case miliknya sendiri?
Apakah case masih dalam state PendingApproval?
Apakah approval limit sesuai amount?
Apakah approver masih aktif?
Apakah ada conflict of interest?
```

Itu harus di policy/domain layer.

---

## 26. Authorization Policy Object

Untuk sistem kompleks, buat policy object eksplisit.

```java
public final class CaseAuthorizationPolicy {

    public void requireCanApprove(AppPrincipal actor, CaseRecord record) {
        if (!actor.hasPermission("case.approve")) {
            throw deny("MISSING_PERMISSION");
        }

        if (!actor.tenantId().equals(record.tenantId())) {
            throw deny("TENANT_MISMATCH");
        }

        if (!record.status().equals(CaseStatus.PENDING_APPROVAL)) {
            throw deny("INVALID_STATE");
        }

        if (record.createdBy().equals(actor.subject())) {
            throw deny("SELF_APPROVAL_NOT_ALLOWED");
        }
    }

    private ForbiddenException deny(String reasonCode) {
        // internally log reason code; expose generic message
        return new ForbiddenException("Access denied");
    }
}
```

Policy object membantu:

- reusable,
- testable,
- auditable,
- tidak tersebar di resource,
- mudah dibahas dengan BA/security/compliance,
- mendukung regulatory defensibility.

Test policy:

```java
@Test
void officerCannotApproveOwnCase() {
    AppPrincipal actor = principal("user-1", "agency-a", "case.approve");
    CaseRecord record = caseRecord("C-1", "agency-a", "user-1", PENDING_APPROVAL);

    assertThrows(ForbiddenException.class, () -> policy.requireCanApprove(actor, record));
}
```

---

## 27. SecurityContext Propagation ke Async Code

Jika memakai async Jersey dari Part 15, hati-hati:

```java
@GET
@Path("/async")
public void async(@Suspended AsyncResponse response,
                  @Context SecurityContext securityContext) {
    executor.submit(() -> {
        // SecurityContext may not be safe to use here depending on implementation/lifecycle
        Principal principal = securityContext.getUserPrincipal();
        response.resume(service.doWork(principal.getName()));
    });
}
```

Lebih aman capture immutable identity:

```java
@GET
@Path("/async")
public void async(@Suspended AsyncResponse response,
                  @Context SecurityContext securityContext) {
    AppPrincipal actor = (AppPrincipal) securityContext.getUserPrincipal();

    executor.submit(() -> {
        try {
            Result result = service.doWork(actor);
            response.resume(result);
        } catch (Exception e) {
            response.resume(e);
        }
    });
}
```

Jangan bergantung pada request-scoped proxy setelah request thread pindah, kecuali framework/container menjamin context propagation.

Untuk Java 21/25 dengan virtual threads, problem context masih relevan:

- `ThreadLocal` tidak otomatis menjadi request model yang benar,
- MDC perlu propagation,
- security context harus immutable/captured,
- executor boundary tetap boundary.

---

## 28. SecurityContext dan Outbound Calls

Sering API harus call downstream service.

Pertanyaan:

```text
Apakah downstream call memakai user token asli?
Apakah memakai service token?
Apakah on-behalf-of token?
Apakah perlu propagate correlation ID dan actor ID?
```

### 28.1 Token Relay

```text
Incoming user token
  -> forwarded to downstream
```

Pro:

- downstream bisa authorize user langsung.

Kontra:

- token audience mungkin salah,
- token leak risk,
- downstream coupling ke external IdP,
- privilege unclear.

### 28.2 Service Token

```text
Service authenticates as service account
```

Pro:

- clear service-to-service identity,
- audience tepat,
- easier rotation.

Kontra:

- downstream tidak tahu user asli kecuali dikirim sebagai audited context,
- confused deputy risk jika tidak ada actor propagation.

### 28.3 On-Behalf-Of

```text
Service exchanges user token for downstream audience token
```

Pro:

- audience tepat,
- user context preserved.

Kontra:

- lebih kompleks,
- butuh IdP support,
- caching/expiry handling.

Jersey Client filter bisa menambahkan header:

```java
public final class ActorPropagationClientFilter implements ClientRequestFilter {

    private final CurrentIdentity currentIdentity;

    public ActorPropagationClientFilter(CurrentIdentity currentIdentity) {
        this.currentIdentity = currentIdentity;
    }

    @Override
    public void filter(ClientRequestContext requestContext) {
        AppPrincipal principal = currentIdentity.principal();
        requestContext.getHeaders().putSingle("X-Actor-Subject", principal.subject());
        requestContext.getHeaders().putSingle("X-Actor-Tenant", principal.tenantId());
    }
}
```

Hanya lakukan ini untuk trusted internal calls dan jangan jadikan header sebagai sole authentication tanpa channel trust.

---

## 29. Integration dengan Servlet Security

Jika Jersey berjalan di Servlet container, authentication bisa sudah dilakukan container.

Jersey `SecurityContext` dapat mengambil informasi dari container security context.

Contoh resource:

```java
@GET
@Path("/me")
public Response me(@Context SecurityContext securityContext) {
    Principal principal = securityContext.getUserPrincipal();
    return Response.ok(Map.of("name", principal.getName())).build();
}
```

Servlet container mungkin dikonfigurasi dengan:

- BASIC,
- FORM,
- CLIENT-CERT,
- container-managed security realm,
- Jakarta Security.

Keputusan desain:

```text
Jika container sudah authenticate:
  Jersey filter tidak perlu ulang validasi credential.
  Tetapi Jersey/resource layer mungkin tetap perlu mapping identity ke AppPrincipal.
```

Bridge pattern:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public final class ServletPrincipalBridgeFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext requestContext) {
        SecurityContext original = requestContext.getSecurityContext();
        Principal principal = original.getUserPrincipal();

        if (principal == null) {
            throw new NotAuthorizedException("Container");
        }

        AppPrincipal appPrincipal = mapPrincipal(principal, original);
        requestContext.setSecurityContext(new AppSecurityContext(
                new AuthenticatedIdentity(
                        appPrincipal,
                        appPrincipal.roles(),
                        appPrincipal.permissions(),
                        "servlet-container",
                        Instant.now()
                ),
                original.isSecure()
        ));
    }

    private AppPrincipal mapPrincipal(Principal principal, SecurityContext original) {
        Set<String> roles = new HashSet<>();
        if (original.isUserInRole("admin")) {
            roles.add("admin");
        }
        if (original.isUserInRole("case_officer")) {
            roles.add("case_officer");
        }
        return new AppPrincipal(principal.getName(), principal.getName(), "default", roles, Set.of());
    }
}
```

---

## 30. Integration dengan Spring Security

Jika Jersey berjalan di Spring Boot application, Spring Security mungkin sudah menjadi primary security framework.

Mental model sehat:

```text
Spring Security owns authentication/session/token filter chain.
Jersey owns JAX-RS resource dispatch.
Bridge SecurityContext from Spring into Jersey/application abstraction.
```

Masalah umum:

```text
Spring SecurityContextHolder punya Authentication
Jersey SecurityContext berbeda
Resource memakai @Context SecurityContext tetapi kosong/tidak sesuai
```

Pattern:

- Gunakan Spring Security sebagai primary auth.
- Buat bridge ke `CurrentIdentity` atau Jersey `SecurityContext` jika diperlukan.
- Jangan validasi JWT dua kali kecuali ada alasan.
- Pastikan filter ordering benar antara Servlet/Spring filter chain dan Jersey servlet.

Pseudo-code bridge:

```java
public final class SpringCurrentIdentity implements CurrentIdentity {

    @Override
    public AppPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new NotAuthorizedException("Bearer");
        }
        return map(authentication);
    }

    private AppPrincipal map(Authentication authentication) {
        // map Spring authorities to AppPrincipal roles/permissions
    }
}
```

Catatan: class ini bergantung Spring Security, sehingga jangan letakkan di domain module murni.

---

## 31. Integration dengan Jakarta Security/CDI

Di Jakarta EE server, security bisa dikelola oleh Jakarta Security dan CDI.

Dalam model ini:

```text
Container authenticates request
Jersey sees container principal/security context
CDI beans can inject security-related context depending server support
Jersey resources/services may be CDI-managed
```

Prinsip:

- jangan campur HK2/CDI ownership tanpa sadar,
- pastikan resource/provider dibuat oleh container yang benar,
- pastikan security annotation yang dipakai diproses oleh runtime yang tepat,
- test di container target karena behavior bisa berbeda antar server.

Untuk production Jakarta EE, sering lebih baik mengikuti security model server daripada membuat authentication filter custom untuk semua hal.

---

## 32. Secure Header Handling

Security filter sering membaca header. Header tidak boleh dipercaya sembarangan.

### 32.1 Authorization Header

```text
Authorization: Bearer <token>
```

Rules:

- reject multiple conflicting credentials,
- trim whitespace dengan hati-hati,
- jangan log value,
- size limit header,
- only accept allowed scheme,
- do not accept token from query parameter unless unavoidable.

### 32.2 Forwarded Headers

Headers seperti:

```text
X-Forwarded-For
X-Forwarded-Proto
Forwarded
X-Real-IP
X-Forwarded-Host
```

berbahaya jika service langsung accessible dari client.

Hanya percaya forwarded headers jika:

- request datang dari trusted proxy,
- proxy menghapus incoming spoofed header,
- network policy menutup direct access,
- application/container dikonfigurasi untuk trusted proxy.

`SecurityContext.isSecure()` bisa salah jika TLS terminated di load balancer dan application tidak memahami `X-Forwarded-Proto`/proxy config.

Dampak:

- redirect URL salah,
- secure cookie logic salah,
- audit channel salah,
- enforcement HTTPS salah.

---

## 33. Securing Multipart/File Endpoints

Dari Part 17, file endpoint punya risiko ekstra.

Authorization harus menjawab:

```text
Boleh upload document untuk case ini?
Boleh download document ini?
Boleh lihat metadata document?
Boleh delete document?
Boleh replace document?
```

Pattern:

```java
@POST
@Path("/cases/{caseId}/documents")
@RolesAllowed({"case_officer", "case_supervisor"})
@Consumes(MediaType.MULTIPART_FORM_DATA)
public Response upload(@PathParam("caseId") String caseId,
                       @FormDataParam("file") InputStream input,
                       @FormDataParam("file") FormDataContentDisposition disposition) {
    AppPrincipal actor = currentIdentity.principal();
    documentService.upload(actor, caseId, input, disposition.getFileName());
    return Response.status(Response.Status.CREATED).build();
}
```

Service:

```java
public void upload(AppPrincipal actor, String caseId, InputStream input, String filename) {
    CaseRecord record = caseRepository.findRequired(caseId);
    authorizationPolicy.requireCanUploadDocument(actor, record);
    fileSecurityPolicy.validateFilename(filename);
    fileStorage.store(input);
}
```

Jangan membiarkan file endpoint hanya protected oleh generic role.

---

## 34. Securing Streaming/SSE Endpoints

SSE endpoint long-lived. Security challenge:

- token bisa expire saat connection masih terbuka,
- user role bisa berubah saat stream aktif,
- client disconnect harus cleanup,
- event broadcast bisa bocor antar tenant,
- per-user subscription harus difilter.

Pattern:

```text
At connection open:
  authenticate
  authorize subscription
  capture immutable actor/tenant

For every event:
  ensure event tenant/resource allowed for subscriber
  do not broadcast raw global event to all clients

On disconnect:
  remove sink/subscription
```

Jangan:

```text
single broadcaster sends all case events to all authenticated users
```

Lebih baik:

```text
per-tenant channel
per-user subscription registry
policy-filtered event delivery
```

---

## 35. CSRF Pattern for Cookie-Based Jersey APIs

Jika API memakai cookie session, CSRF harus diperhatikan.

CSRF filter konseptual:

```java
@Provider
@Priority(Priorities.AUTHORIZATION)
public final class CsrfFilter implements ContainerRequestFilter {

    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    @Override
    public void filter(ContainerRequestContext requestContext) {
        if (SAFE_METHODS.contains(requestContext.getMethod())) {
            return;
        }

        String csrfHeader = requestContext.getHeaderString("X-CSRF-Token");
        String csrfCookie = getCookieValue(requestContext, "CSRF-TOKEN");

        if (csrfHeader == null || csrfCookie == null || !constantTimeEquals(csrfHeader, csrfCookie)) {
            throw new ForbiddenException("Access denied");
        }
    }
}
```

Untuk Java 8, `Set.of` diganti.

Jangan aktifkan CSRF untuk bearer-token-only API tanpa analisis; mungkin tidak perlu dan menambah complexity.

---

## 36. Field-Level Authorization dan Response Shaping

Kadang user boleh melihat object tetapi tidak semua field.

Contoh:

```text
Case officer boleh melihat summary.
Supervisor boleh melihat investigation notes.
Auditor boleh melihat immutable audit fields.
External party tidak boleh melihat internal remarks.
```

Jangan mengandalkan Jackson annotation statis untuk semua field-level policy.

Lebih baik mapping DTO berdasarkan actor:

```java
public CaseDetailResponse toDetail(AppPrincipal actor, CaseRecord record) {
    CaseDetailResponse response = new CaseDetailResponse();
    response.setId(record.id());
    response.setStatus(record.status());

    if (actor.hasPermission("case.internal_notes.read")) {
        response.setInternalNotes(record.internalNotes());
    }

    return response;
}
```

Atau buat view model terpisah:

```text
CasePublicDetail
CaseOfficerDetail
CaseSupervisorDetail
CaseAuditDetail
```

Field-level authorization harus testable karena bug-nya sering silent data leak.

---

## 37. Input Validation vs Authorization Ordering

Urutan umum:

```text
Parse request
  -> authenticate
      -> coarse authorization
          -> validate request shape
              -> load domain object
                  -> object-level authorization
                      -> domain validation
                          -> execute
```

Tetapi urutan ini bisa berubah.

Trade-off:

### Validate Before Authorization

Pro:

- request buruk ditolak cepat,
- error input lebih jelas.

Kontra:

- unauthenticated/unauthorized caller bisa belajar validation rule,
- bisa consume CPU untuk attacker.

### Authorization Before Validation

Pro:

- mengurangi information disclosure,
- lebih aman untuk sensitive endpoint.

Kontra:

- authorization mungkin butuh parsed input,
- error client kurang spesifik.

Pragmatic rule:

```text
Always authenticate early.
Do cheap syntactic validation early.
Do sensitive domain lookup/validation only after authorization where possible.
```

---

## 38. Status Code Strategy untuk Security

| Kondisi | Status | Catatan |
|---|---:|---|
| Tidak ada token | 401 | Sertakan `WWW-Authenticate` jika relevan |
| Token malformed | 401 | Jangan expose parser detail |
| Token expired | 401 | Public message generik; client bisa refresh |
| Token valid tapi role kurang | 403 | Jangan expose role internal |
| Token valid tapi tenant salah | 403 atau 404 | 404 jika ingin hide existence |
| Resource tidak ada | 404 | Jangan bocorkan apakah caller punya akses |
| CSRF gagal | 403 | Jangan sebut token mismatch detail |
| Rate limit security | 429 | Bisa disertai retry header |
| Account locked | 403 atau 423 | Tergantung API contract |
| mTLS missing | 401/403 | Tergantung authentication model |
```

---

## 39. Common Failure Modes

### 39.1 `@RolesAllowed` Tidak Berefek

Kemungkinan:

```text
RolesAllowedDynamicFeature belum diregister
Resource tidak dikelola Jersey sesuai ekspektasi
SecurityContext tidak punya role
Annotation package salah: javax vs jakarta
Filter ordering salah
```

### 39.2 Principal Null di Resource

Kemungkinan:

```text
Authentication filter tidak jalan
Path public ter-skip
Filter tidak ter-register
Exception sebelum setSecurityContext
Container security tidak aktif
```

### 39.3 Semua Role Check Gagal

Kemungkinan:

```text
isUserInRole mapping salah
Role prefix mismatch, misalnya ROLE_ADMIN vs admin
Claim path salah
Case sensitivity mismatch
Role di token bukan role aplikasi
```

### 39.4 User Bisa Akses Data Tenant Lain

Kemungkinan:

```text
Hanya cek role, tidak cek tenant
Tenant ID dari path tidak divalidasi
Repository query tidak scoped tenant
Policy lupa dipanggil di alternate endpoint
Export/report endpoint bypass service policy
```

### 39.5 Token Valid Tapi Audience Salah

Kemungkinan:

```text
JWT verifier hanya cek signature/issuer/expiry
Tidak cek aud
Token untuk service A diterima service B
```

### 39.6 Header Identity Spoofing

Kemungkinan:

```text
Service percaya X-Authenticated-User dari public request
Gateway tidak strip incoming header
Service exposed langsung ke internet
```

### 39.7 Security Log Membocorkan Token

Kemungkinan:

```text
Generic request logging mencatat semua header
Exception log mencetak raw Authorization
Debug log JWT payload lengkap
```

### 39.8 Async Task Kehilangan Identity

Kemungkinan:

```text
SecurityContext request-scoped dipakai di executor lain
ThreadLocal tidak propagated
Principal tidak dicapture sebagai immutable object
```

---

## 40. Jersey 2.x vs 3.x vs 4.x Security Namespace

Perubahan utama:

```text
Jersey 2.x:
  javax.ws.rs.*
  javax.annotation.security.*
  javax.servlet.*

Jersey 3.x:
  jakarta.ws.rs.*
  jakarta.annotation.security.*
  jakarta.servlet.*

Jersey 4.x:
  Jakarta EE 11 alignment
  Jakarta REST 4.0 baseline
```

Saat migrasi:

- jangan mencampur `javax.ws.rs.core.SecurityContext` dan `jakarta.ws.rs.core.SecurityContext`,
- jangan mencampur `javax.annotation.security.RolesAllowed` dengan `jakarta.annotation.security.RolesAllowed`,
- pastikan `RolesAllowedDynamicFeature` versi Jersey sesuai namespace,
- pastikan Servlet request attribute namespace sesuai container,
- pastikan dependency tree tidak membawa Jersey 2 dan 3/4 bersamaan.

Contoh bug:

```java
import javax.annotation.security.RolesAllowed;
```

Di aplikasi Jakarta/Jersey 3/4 seharusnya:

```java
import jakarta.annotation.security.RolesAllowed;
```

Kalau salah namespace, annotation mungkin tidak dibaca oleh runtime yang diharapkan.

---

## 41. Java 8 hingga 25 Considerations

### Java 8

- Tidak ada records.
- Tidak ada `Set.of`.
- Tidak ada modern pattern matching.
- Banyak legacy Jersey 2.x app masih di Java 8.
- Biasanya namespace `javax`.
- TLS/JWT library version perlu dipilih hati-hati.

### Java 11

- Runtime modern lebih stabil.
- Banyak library mulai menjadikan Java 11 baseline.
- HTTP client built-in tersedia, tetapi Jersey Client tetap punya ekosistem provider sendiri.

### Java 17

- Baseline banyak Jakarta EE modern.
- Sealed classes/records bisa membantu model security immutable.
- Strong encapsulation bisa memunculkan issue reflective access di library lama.

### Java 21

- Virtual threads tersedia.
- Security context propagation tetap harus eksplisit.
- ThreadLocal/MDC perlu perhatian.
- Blocking auth/token introspection bisa lebih scalable dengan virtual thread jika container mendukung.

### Java 25

- Sebagai LTS baru, cocok untuk long lifecycle platform.
- Fokus migration bukan hanya compile, tetapi compatibility Jersey/container/security library.
- Pastikan dependency mendukung Java 25 runtime.

---

## 42. Production Design Pattern: Secure Jersey Boundary

Desain yang sehat:

```text
[API Gateway / LB]
  - TLS termination
  - optional WAF/rate limit
  - optional token pre-validation
  - strip spoofable headers

[Jersey Application]
  - correlation filter
  - authentication filter
  - SecurityContext installation
  - coarse authorization annotation/filter
  - request validation
  - resource method

[Service Layer]
  - object-level authorization
  - domain invariant
  - transaction boundary
  - audit event

[Repository]
  - tenant-scoped query
  - data access constraints
```

Example call flow:

```text
POST /cases/C-1001/assign

1. CorrelationIdFilter assigns correlation id.
2. BearerAuthenticationFilter validates token.
3. SecurityContext installed with AppPrincipal.
4. @RolesAllowed("case_supervisor") checked.
5. Resource parses caseId and request body.
6. Service loads case.
7. CaseAuthorizationPolicy checks:
   - same tenant
   - supervisor role/permission
   - case state assignable
   - assignee valid
8. Domain command executed.
9. Audit event emitted.
10. Response returned.
```

---

## 43. Minimal Production-Grade Example

### 43.1 ResourceConfig

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(BearerAuthenticationFilter.class);
        register(RolesAllowedDynamicFeature.class);
        register(NotAuthorizedExceptionMapper.class);
        register(ForbiddenExceptionMapper.class);
        register(SecurityAuditFilter.class);

        packages("com.example.caseapi.resources");
    }
}
```

### 43.2 Resource

```java
@Path("/cases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public final class CaseResource {

    private final CaseCommandService commandService;
    private final CurrentIdentity currentIdentity;

    public CaseResource(CaseCommandService commandService,
                        CurrentIdentity currentIdentity) {
        this.commandService = commandService;
        this.currentIdentity = currentIdentity;
    }

    @POST
    @Path("/{caseId}/assign")
    @RolesAllowed("case_supervisor")
    public Response assign(@PathParam("caseId") String caseId,
                           AssignCaseRequest request,
                           @Context UriInfo uriInfo) {
        AppPrincipal actor = currentIdentity.principal();
        commandService.assign(actor, caseId, request.assigneeId());
        return Response.noContent().build();
    }
}
```

### 43.3 Service

```java
public final class CaseCommandService {

    private final CaseRepository caseRepository;
    private final CaseAuthorizationPolicy authorizationPolicy;
    private final AuditService auditService;

    public CaseCommandService(CaseRepository caseRepository,
                              CaseAuthorizationPolicy authorizationPolicy,
                              AuditService auditService) {
        this.caseRepository = caseRepository;
        this.authorizationPolicy = authorizationPolicy;
        this.auditService = auditService;
    }

    public void assign(AppPrincipal actor, String caseId, String assigneeId) {
        CaseRecord record = caseRepository.findRequired(caseId);

        authorizationPolicy.requireCanAssign(actor, record);

        record.assignTo(assigneeId);
        caseRepository.save(record);

        auditService.record(AuditEvent.caseAssigned(actor.subject(), caseId, assigneeId));
    }
}
```

This structure prevents the resource annotation from becoming the only security gate.

---

## 44. Testing Security in Jersey

Test layers:

### 44.1 Filter Unit Test

Test token missing/invalid/valid behavior.

```java
@Test
void missingBearerTokenReturnsNotAuthorized() {
    ContainerRequestContext ctx = mock(ContainerRequestContext.class);
    when(ctx.getHeaderString(HttpHeaders.AUTHORIZATION)).thenReturn(null);

    assertThrows(NotAuthorizedException.class, () -> filter.filter(ctx));
}
```

### 44.2 Resource Integration Test

Use Jersey Test Framework or container test to verify:

```text
GET /admin/users without token -> 401
GET /admin/users with non-admin token -> 403
GET /admin/users with admin token -> 200
```

### 44.3 Policy Unit Test

Most important for domain authorization:

```text
officer cannot view other officer case
supervisor can view same tenant case
supervisor cannot view other tenant case
creator cannot approve own case
expired delegation cannot act
```

### 44.4 Contract/Security Regression Test

Test that every resource method has explicit security policy.

Pseudo-test:

```java
@Test
void everyResourceMethodHasSecurityAnnotation() {
    // scan resource package
    // fail if public HTTP method lacks @RolesAllowed/@PermitAll/@DenyAll/@PublicEndpoint
}
```

This prevents accidental open endpoint.

---

## 45. Security Checklist for Jersey Production

### Authentication

```text
[ ] Credential source defined: bearer/cookie/API key/mTLS/gateway header.
[ ] Token validation checks signature, issuer, audience, expiry.
[ ] Raw token never logged.
[ ] Authentication filter priority correct.
[ ] Public endpoint policy explicit.
[ ] SecurityContext installed for authenticated request.
[ ] Principal immutable.
```

### Authorization

```text
[ ] RolesAllowedDynamicFeature registered if using @RolesAllowed.
[ ] Default policy is explicit, preferably default-deny.
[ ] Role names normalized.
[ ] Permission model separated from role model if needed.
[ ] Tenant access checked.
[ ] Object-level authorization implemented in service/domain layer.
[ ] Export/report/file/stream endpoints checked separately.
[ ] Confused deputy paths reviewed.
```

### Error Handling

```text
[ ] 401 and 403 mapped consistently.
[ ] Error body does not expose internals.
[ ] WWW-Authenticate header handled where relevant.
[ ] Sensitive existence-hiding policy decided.
```

### Audit/Observability

```text
[ ] Correlation ID present.
[ ] Security allow/deny events logged structurally.
[ ] Actor, tenant, decision, reason code captured.
[ ] Raw credential and PII masked.
[ ] Object-level denial reason stored internally.
```

### Integration

```text
[ ] Jersey/Servlet/Spring/Jakarta Security ownership clear.
[ ] No duplicate token validation unless intentional.
[ ] javax/jakarta namespace consistent.
[ ] Forwarded identity headers trusted only behind secure gateway.
[ ] Direct service access blocked if relying on gateway auth.
```

### Runtime

```text
[ ] Async captures immutable identity.
[ ] SSE subscriptions authorized and cleaned up.
[ ] Multipart/file endpoints check object-level permission.
[ ] CORS not treated as authentication.
[ ] CSRF handled for cookie-based APIs.
```

---

## 46. Mental Model Final

Jersey security yang matang bukan berarti semua logic security ada di Jersey.

Model yang benar:

```text
Jersey boundary:
  authenticate request
  establish identity
  apply coarse route authorization
  expose identity safely
  normalize error response
  connect to audit/correlation

Service/domain boundary:
  enforce object-level authorization
  enforce state-based authorization
  prevent confused deputy
  produce audit-relevant decision

Infrastructure boundary:
  enforce TLS, gateway trust, token issuer, network access
```

Kalau semua authorization hanya diletakkan di annotation resource, sistem akan rapuh.

Kalau semua authorization hanya diletakkan di service tanpa coarse Jersey guard, endpoint terlalu mudah dipanggil dan observability security menjadi kabur.

Top-tier engineering approach adalah layered security:

```text
early reject where possible,
precise domain policy where necessary,
auditable decision everywhere.
```

---

## 47. Mini Exercises

1. Buat authentication filter yang menerima bearer token dan memasang `SecurityContext` custom.
2. Tambahkan `@RolesAllowed` pada resource dan register `RolesAllowedDynamicFeature`.
3. Buat policy object `CaseAuthorizationPolicy` dengan rule tenant + assigned officer.
4. Buat test untuk memastikan user tenant A tidak bisa membaca case tenant B.
5. Buat exception mapper untuk 401 dan 403 dengan response body konsisten.
6. Buat audit event untuk authorization denial tanpa mengekspos token.
7. Review resource endpoint kamu dan tandai mana yang public, authenticated, role-based, object-level protected.
8. Simulasikan confused deputy path: endpoint export yang lupa object-level policy.
9. Buat checklist migration dari `javax.annotation.security.RolesAllowed` ke `jakarta.annotation.security.RolesAllowed`.
10. Desain actor model untuk user, service account, scheduled job, dan delegated action.

---

## 48. Ringkasan

Di bagian ini kita membahas security integration Jersey secara menyeluruh:

- `SecurityContext` sebagai identity abstraction.
- `ContainerRequestFilter` untuk authentication.
- `RolesAllowedDynamicFeature` dan annotation security untuk coarse authorization.
- JWT/OIDC/API key/mTLS/gateway identity sebagai credential patterns.
- Principal dan current identity abstraction.
- Role, permission, scope, claim, dan tenant context.
- Object-level authorization di service/domain layer.
- Confused deputy prevention.
- Security error mapping 401/403/404.
- Audit dan observability security.
- Integration dengan Servlet Security, Spring Security, dan Jakarta Security.
- Namespace migration Jersey 2/3/4.
- Java 8–25 considerations.
- Production checklist.

Security di Jersey bukan hanya “filter token”. Ia adalah boundary engineering untuk memastikan setiap request punya identitas, otoritas, konteks, auditability, dan failure behavior yang benar.

---

## 49. Status Series

Progress saat ini:

```text
Part 0  — selesai
Part 1  — selesai
Part 2  — selesai
Part 3  — selesai
Part 4  — selesai
Part 5  — selesai
Part 6  — selesai
Part 7  — selesai
Part 8  — selesai
Part 9  — selesai
Part 10 — selesai
Part 11 — selesai
Part 12 — selesai
Part 13 — selesai
Part 14 — selesai
Part 15 — selesai
Part 16 — selesai
Part 17 — selesai
Part 18 — selesai
Part 19 — berikutnya
...
Part 32 — target akhir / capstone
```

Seri **belum selesai**. Bagian berikutnya:

> **Part 19 — Validation Strategy: Bean Validation, Request Contract, Group, and Error Shape**
