# learn-java-authentication-modes-and-patterns-part-007

# Part 7 — Spring Security Authentication Architecture

> Series: **Java Authentication Modes and Patterns**  
> Scope: **Java 8 hingga Java 25**  
> Fokus: **arsitektur internal Spring Security authentication, bukan sekadar konfigurasi**  
> Status: **Part 7 dari maksimum 35 part**

---

## 0. Tujuan Part Ini

Setelah Part 0–6, kita sudah punya fondasi:

- authentication sebagai proses pembuktian identity,
- `Subject`, `Principal`, credential, dan context di Java runtime,
- taxonomy authentication mode,
- password authentication,
- session authentication,
- Servlet container authentication,
- Jakarta Security dan Jakarta Authentication.

Part ini masuk ke salah satu ekosistem Java paling dominan di production: **Spring Security**.

Namun tujuan part ini **bukan**:

- menghafal konfigurasi `SecurityFilterChain`,
- membuat login form sederhana,
- copy-paste JWT filter,
- menulis `UserDetailsService` tanpa paham flow.

Tujuan part ini adalah memahami **mesin internal Spring Security**:

1. bagaimana request masuk ke security system,
2. bagaimana Spring memilih filter chain,
3. bagaimana credential dikonversi menjadi `Authentication`,
4. siapa yang melakukan verifikasi,
5. di mana authenticated identity disimpan,
6. kapan context dibersihkan,
7. bagaimana session/stateless mode mengubah lifecycle,
8. di mana titik extension yang benar,
9. failure mode apa yang umum terjadi,
10. bagaimana mendesain custom authentication tanpa membuat lubang security.

Mental model utama:

> **Spring Security adalah request security pipeline yang mengubah incoming proof menjadi `Authentication`, menyimpannya ke `SecurityContext`, lalu menggunakan context tersebut untuk authorization dan downstream application logic.**

---

## 1. Spring Security Bukan “Login Library”

Banyak engineer pertama kali mengenal Spring Security sebagai:

```java
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
    return http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/public/**").permitAll()
            .anyRequest().authenticated())
        .formLogin(Customizer.withDefaults())
        .build();
}
```

Ini memberi kesan bahwa Spring Security hanyalah konfigurasi login.

Padahal secara arsitektur Spring Security adalah:

```text
Servlet Container
  -> DelegatingFilterProxy
    -> FilterChainProxy
      -> SecurityFilterChain
        -> Ordered Security Filters
          -> Authentication Mechanisms
          -> SecurityContext
          -> Authorization
          -> Exception Handling
          -> Context Cleanup
```

Artinya Spring Security bukan satu komponen tunggal, tetapi **pipeline**.

Pipeline tersebut melakukan beberapa tugas berbeda:

| Area | Tanggung Jawab |
|---|---|
| Request matching | Menentukan security chain yang berlaku untuk request tertentu |
| Authentication | Membuktikan caller |
| Context management | Menyimpan identity untuk request berjalan |
| Session integration | Memuat/menyimpan identity antar request bila stateful |
| Authorization | Memutuskan apakah caller boleh mengakses resource |
| Exception handling | Mengubah auth failure menjadi 401/redirect dan authorization failure menjadi 403 |
| Logout | Menghapus continuity identity |
| Header hardening | Menambahkan security headers |
| CSRF | Melindungi state-changing browser request |

Jadi saat debugging Spring Security, pertanyaannya bukan hanya:

> “Kenapa login gagal?”

Tetapi:

> “Di stage pipeline mana request berubah dari anonymous/unauthenticated menjadi authenticated, atau gagal sebelum itu?”

---

## 2. Komponen Besar Spring Security Authentication

Untuk memahami Spring Security, kita perlu mengenali lapisan utamanya.

```text
HTTP Request
   |
   v
Servlet Filter Layer
   |
   +-- DelegatingFilterProxy
   |       bridge Servlet container -> Spring bean
   |
   +-- FilterChainProxy
   |       memilih SecurityFilterChain
   |
   +-- SecurityFilterChain
   |       daftar filter untuk request tertentu
   |
   v
Authentication Mechanism Filter
   |
   +-- membaca credential/proof dari request
   +-- membuat Authentication belum authenticated
   +-- memanggil AuthenticationManager
   |
   v
AuthenticationManager
   |
   +-- delegasi ke satu/lebih AuthenticationProvider
   |
   v
AuthenticationProvider
   |
   +-- verifikasi credential/proof
   +-- load user/client/token metadata bila perlu
   +-- mengembalikan Authentication authenticated
   |
   v
SecurityContextHolder
   |
   +-- menyimpan SecurityContext untuk request berjalan
   |
   v
Application Controller/Service
```

Komponen kunci:

| Komponen | Fungsi |
|---|---|
| `DelegatingFilterProxy` | Jembatan dari Servlet container ke Spring-managed filter bean |
| `FilterChainProxy` | Entry point utama Spring Security Servlet support |
| `SecurityFilterChain` | Kumpulan filter yang berlaku untuk request tertentu |
| `SecurityContextHolder` | Tempat Spring Security menyimpan siapa caller saat ini |
| `SecurityContext` | Container untuk `Authentication` |
| `Authentication` | Representasi principal, credential, authorities, dan status authenticated |
| `AuthenticationManager` | Orchestrator proses authentication |
| `AuthenticationProvider` | Implementasi verifikasi mode authentication tertentu |
| `UserDetailsService` | Loader user data untuk username/password-style authentication |
| `AuthenticationEntryPoint` | Respons saat user belum authenticated |
| `AccessDeniedHandler` | Respons saat user authenticated tetapi tidak authorized |
| `SecurityContextRepository` | Memuat/menyimpan security context antar request |

---

## 3. Request Lifecycle: Dari Servlet Container ke Spring Security

### 3.1 Servlet container hanya tahu filter

Servlet container seperti Tomcat, Jetty, Undertow, atau embedded container Spring Boot memahami konsep:

- servlet,
- filter,
- listener,
- request,
- response,
- session.

Servlet container **tidak otomatis tahu** semua Spring bean.

Karena itu diperlukan bridge.

### 3.2 `DelegatingFilterProxy`

`DelegatingFilterProxy` adalah Servlet filter yang registered ke Servlet container, tetapi delegasi pekerjaannya ke Spring bean.

Mental model:

```text
Servlet Container Filter Registry
  contains DelegatingFilterProxy
        |
        v
Spring ApplicationContext
  contains FilterChainProxy bean
```

`DelegatingFilterProxy` memungkinkan Spring Security filter hidup sebagai Spring bean, sehingga bisa memakai dependency injection, configuration, lifecycle Spring, dan bean ordering.

Tanpa bridge ini, filter harus dibuat langsung oleh Servlet container dan tidak nyaman mengakses Spring-managed dependencies.

### 3.3 `FilterChainProxy`

`FilterChainProxy` adalah filter Spring Security utama.

Tugasnya:

1. menerima request dari `DelegatingFilterProxy`,
2. menentukan `SecurityFilterChain` mana yang match,
3. menjalankan filter-filter security dalam chain tersebut,
4. memastikan cleanup context setelah request selesai.

Poin penting:

> Filter individual Spring Security biasanya bukan didaftarkan langsung ke Servlet container. Mereka berada di dalam `FilterChainProxy`.

Ini penting karena:

- ordering dikelola Spring Security,
- lifecycle security terpusat,
- context cleanup lebih aman,
- multiple chain bisa dikelola konsisten.

---

## 4. `SecurityFilterChain`: Satu Aplikasi Bisa Punya Banyak Chain

Spring Security modern biasanya dikonfigurasi dengan bean:

```java
@Bean
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .build();
}
```

Dan bisa punya chain lain:

```java
@Bean
SecurityFilterChain webSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/web/**")
        .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
        .formLogin(Customizer.withDefaults())
        .build();
}
```

Mental model:

```text
Request /api/orders
  -> match /api/** chain
  -> JWT resource server filters
  -> stateless behavior

Request /web/dashboard
  -> match /web/** chain
  -> form login filters
  -> session behavior
```

### 4.1 Chain selection matters

Kesalahan umum:

```java
@Bean
SecurityFilterChain chain1(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/**")
        .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
        .build();
}

@Bean
SecurityFilterChain chain2(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .oauth2ResourceServer(oauth2 -> oauth2.jwt())
        .build();
}
```

Jika ordering salah, `/**` bisa menangkap request sebelum `/api/**`.

Rule mental:

> **Specific chain harus dievaluasi sebelum generic chain.**

Biasanya gunakan `@Order` bila banyak chain.

```java
@Bean
@Order(1)
SecurityFilterChain apiSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/api/**")
        .build();
}

@Bean
@Order(2)
SecurityFilterChain webSecurity(HttpSecurity http) throws Exception {
    return http
        .securityMatcher("/**")
        .build();
}
```

### 4.2 Chain bukan sekadar authorization rule

`securityMatcher` menentukan apakah seluruh security chain berlaku.

`requestMatchers` di dalam `authorizeHttpRequests` menentukan authorization rule dalam chain tersebut.

Bedanya:

```text
securityMatcher
  -> apakah chain ini dipakai?

requestMatchers inside authorizeHttpRequests
  -> setelah chain dipakai, rule authorization mana yang dipakai?
```

Kesalahan konseptual:

> Mengira `permitAll()` berarti request tidak melewati filter security.

Padahal `permitAll()` hanya berarti authorization mengizinkan request. Request tetap bisa melewati filter chain, CSRF logic, header writing, context handling, dan filter custom.

---

## 5. `SecurityContextHolder`: Tempat Identity Saat Ini Disimpan

Spring Security menyimpan identity saat ini di `SecurityContextHolder`.

Strukturnya:

```text
SecurityContextHolder
   -> SecurityContext
       -> Authentication
           -> principal
           -> credentials
           -> authorities
           -> details
           -> authenticated flag
```

Dalam kode:

```java
Authentication authentication = SecurityContextHolder
    .getContext()
    .getAuthentication();
```

### 5.1 `SecurityContextHolder` bukan database identity

`SecurityContextHolder` hanya menyimpan identity untuk execution context saat ini.

Ia bukan:

- source of truth user,
- session store,
- token store,
- user repository,
- authorization database.

Ia adalah **current request security context holder**.

### 5.2 Default strategy historis: ThreadLocal

Di Servlet stack tradisional, request biasanya diproses oleh satu thread dari pool.

Karena itu Spring Security historis memakai `ThreadLocal` strategy:

```text
Thread request-42
  -> SecurityContext(user = fajar)
```

Setelah request selesai, context harus dibersihkan.

Jika tidak:

```text
Thread request-42 reused for another request
  -> masih membawa context user sebelumnya
  -> identity leak
```

Inilah mengapa cleanup sangat penting.

### 5.3 Pitfall: async execution

Kode seperti ini rawan:

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();

CompletableFuture.runAsync(() -> {
    Authentication inside = SecurityContextHolder.getContext().getAuthentication();
    // sering null atau anonymous, tergantung propagation
});
```

Karena `CompletableFuture.runAsync` biasanya memakai thread lain.

Security context tidak otomatis berpindah ke thread lain kecuali ada mekanisme propagation.

Mental model:

> **Identity yang disimpan di ThreadLocal hanya valid selama execution tetap berada di thread yang sama atau dipropagasi secara eksplisit oleh framework.**

Ini akan dibahas lebih detail di Part 8.

---

## 6. `Authentication`: Objek Kecil, Makna Besar

`Authentication` adalah interface sentral.

Ia menjawab:

1. siapa caller,
2. credential/proof apa yang dipakai,
3. authority apa yang dimiliki,
4. apakah authentication sudah berhasil,
5. detail tambahan apa yang terkait request.

Konsep umum:

```java
public interface Authentication extends Principal, Serializable {
    Collection<? extends GrantedAuthority> getAuthorities();
    Object getCredentials();
    Object getDetails();
    Object getPrincipal();
    boolean isAuthenticated();
    void setAuthenticated(boolean isAuthenticated);
}
```

### 6.1 Dua fase `Authentication`

Spring Security sering memakai objek `Authentication` dalam dua fase:

#### Fase 1 — unauthenticated token

Dibuat dari request.

Contoh username/password:

```java
Authentication requestAuth = UsernamePasswordAuthenticationToken.unauthenticated(
    username,
    rawPassword
);
```

Maknanya:

```text
Caller mengklaim username X dan membawa credential Y.
Belum diverifikasi.
```

#### Fase 2 — authenticated token

Dibuat setelah provider berhasil memverifikasi.

```java
Authentication result = UsernamePasswordAuthenticationToken.authenticated(
    userDetails,
    null,
    userDetails.getAuthorities()
);
```

Maknanya:

```text
System sudah memverifikasi proof.
Principal valid.
Authorities sudah diketahui.
```

### 6.2 Jangan set authenticated sembarangan

Kesalahan fatal:

```java
UsernamePasswordAuthenticationToken token =
    new UsernamePasswordAuthenticationToken(username, password, authorities);

SecurityContextHolder.getContext().setAuthentication(token);
```

Constructor dengan authorities biasanya membuat token dianggap authenticated.

Jika dilakukan sebelum verifikasi credential, berarti aplikasi menerima identity palsu.

Rule:

> **Jangan membangun authenticated `Authentication` sebelum proof benar-benar diverifikasi oleh trusted component.**

### 6.3 Principal bukan selalu user entity

`getPrincipal()` bisa berupa:

- `UserDetails`,
- username string,
- JWT object,
- OIDC user,
- SAML principal,
- certificate subject,
- service account object,
- custom domain principal.

Jangan hard-code assumption:

```java
UserDetails user = (UserDetails) authentication.getPrincipal();
```

Pada sistem multi-mode, ini akan pecah.

Lebih aman desain domain abstraction:

```java
public record CurrentActor(
    String actorId,
    ActorType actorType,
    String tenantId,
    Set<String> authorities,
    String authenticationMode
) {}
```

Lalu buat adapter dari Spring `Authentication` ke domain `CurrentActor`.

---

## 7. `AuthenticationManager`: Orchestrator Authentication

`AuthenticationManager` bertugas menerima `Authentication` belum verified dan mengembalikan `Authentication` verified.

Kontrak mental:

```text
Input:
  Authentication claim/proof belum trusted

Output:
  Authentication trusted atau exception
```

Contoh konseptual:

```java
Authentication result = authenticationManager.authenticate(requestAuth);
```

Jika sukses:

```text
result.isAuthenticated() == true
```

Jika gagal:

```text
throw AuthenticationException
```

### 7.1 `ProviderManager`

Implementasi umum `AuthenticationManager` adalah `ProviderManager`.

Ia punya list `AuthenticationProvider`.

Flow:

```text
ProviderManager
  -> provider 1 supports(authentication class)?
       yes -> try authenticate
       no  -> skip
  -> provider 2 supports(authentication class)?
       yes -> try authenticate
  -> if success, return result
  -> if all fail, throw exception
```

### 7.2 `supports()` sangat penting

Setiap provider menyatakan token type yang bisa diproses:

```java
@Override
public boolean supports(Class<?> authentication) {
    return UsernamePasswordAuthenticationToken.class.isAssignableFrom(authentication);
}
```

Kesalahan umum:

```java
@Override
public boolean supports(Class<?> authentication) {
    return true;
}
```

Ini buruk karena provider bisa menangkap token yang bukan urusannya.

Rule:

> **Provider harus sempit dan eksplisit terhadap tipe authentication yang didukung.**

---

## 8. `AuthenticationProvider`: Tempat Proof Diverifikasi

`AuthenticationProvider` adalah komponen yang benar-benar tahu cara memverifikasi mode authentication tertentu.

Contoh provider:

| Provider | Mode |
|---|---|
| `DaoAuthenticationProvider` | username/password dengan `UserDetailsService` |
| JWT authentication provider | bearer JWT |
| Opaque token introspection provider | opaque bearer token |
| LDAP authentication provider | LDAP bind/search |
| Pre-auth provider | identity sudah diverifikasi upstream |
| Custom API key provider | API key |
| Custom HMAC provider | signed request |

### 8.1 Provider pattern

Pseudo-code:

```java
public final class ApiKeyAuthenticationProvider
        implements AuthenticationProvider {

    private final ApiKeyVerifier verifier;

    @Override
    public Authentication authenticate(Authentication authentication) {
        ApiKeyAuthenticationToken token =
            (ApiKeyAuthenticationToken) authentication;

        VerifiedApiKey verified = verifier.verify(token.rawApiKey());

        return ApiKeyAuthenticationToken.authenticated(
            new ApiClientPrincipal(
                verified.clientId(),
                verified.tenantId(),
                verified.keyId()
            ),
            AuthorityUtils.createAuthorityList(verified.scopes())
        );
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return ApiKeyAuthenticationToken.class.isAssignableFrom(authentication);
    }
}
```

### 8.2 Provider harus bebas dari HTTP detail bila memungkinkan

Provider sebaiknya tidak terlalu bergantung pada `HttpServletRequest`.

Lebih baik:

```text
Filter:
  baca request HTTP
  extract credential/proof
  buat Authentication token

Provider:
  verify proof
  return authenticated principal
```

Dengan begitu provider bisa dites tanpa servlet container.

### 8.3 Provider harus jelas membedakan failure

Authentication failure bukan satu jenis.

Contoh:

| Failure | Makna |
|---|---|
| credential missing | request tidak membawa proof |
| credential malformed | proof tidak bisa diparse |
| credential invalid | proof bisa diparse tapi salah |
| credential expired | proof valid tapi sudah expired |
| principal disabled | user/client valid tapi tidak boleh login |
| principal locked | account terkunci |
| upstream unavailable | verifier dependency down |
| replay detected | proof pernah dipakai |

Namun response ke client tidak selalu boleh detail.

Internal event boleh detail, external response harus hati-hati.

---

## 9. Authentication Mechanism Filter

Filter adalah komponen yang membaca request.

Contoh:

| Filter | Proof yang dibaca |
|---|---|
| `UsernamePasswordAuthenticationFilter` | form username/password |
| `BasicAuthenticationFilter` | HTTP Basic header |
| Bearer token filter | `Authorization: Bearer ...` |
| Pre-auth filter | header upstream/proxy |
| Custom API key filter | `X-API-Key` atau header lain |
| Custom HMAC filter | signature headers |

Flow umum:

```text
1. Request masuk
2. Filter mengecek apakah request perlu diproses
3. Filter membaca credential/proof
4. Filter membuat unauthenticated Authentication
5. Filter memanggil AuthenticationManager
6. Jika sukses:
     - set SecurityContext
     - call success handler / continue chain
7. Jika gagal:
     - clear context
     - call failure handler / entry point
```

### 9.1 Filter harus kecil

Filter buruk:

```text
Filter:
  parse request
  query database
  verify password
  load roles
  write audit
  set context
  decide authorization
```

Filter baik:

```text
Filter:
  parse request
  construct Authentication
  delegate to AuthenticationManager
  set/clear context
```

Alasannya:

- lebih mudah dites,
- separation of concerns,
- menghindari duplikasi logic,
- provider bisa reuse,
- failure handling lebih konsisten.

---

## 10. Authentication Success: Apa yang Terjadi Setelah Valid?

Jika authentication berhasil, minimal ada tiga kemungkinan lifecycle:

### 10.1 Stateful web login

```text
Authentication success
  -> SecurityContextHolder set
  -> SecurityContextRepository saves context to HttpSession
  -> subsequent request loads context from session
```

Cocok untuk:

- server-rendered app,
- browser web app,
- BFF,
- internal admin console.

### 10.2 Stateless API bearer token

```text
Each request:
  -> bearer token parsed
  -> token validated
  -> SecurityContextHolder set for current request only
  -> context cleared after request
  -> no server session persistence
```

Cocok untuk:

- resource server,
- microservice API,
- machine-to-machine token.

### 10.3 Pre-authenticated upstream identity

```text
Gateway/IdP/proxy authenticates caller
  -> app receives trusted header/certificate/context
  -> Spring converts upstream identity to Authentication
```

Cocok hanya jika trust boundary sangat jelas.

---

## 11. `SecurityContextRepository`: Stateful vs Stateless Boundary

`SecurityContextRepository` bertugas memuat dan menyimpan `SecurityContext` antar request.

Dalam stateful session mode:

```text
Request 1 login success
  -> context saved to HttpSession

Request 2
  -> context loaded from HttpSession
```

Dalam stateless mode:

```text
Request N
  -> context derived from token every time
  -> not saved to HttpSession
```

### 11.1 Kesalahan umum: mengira JWT otomatis stateless

Aplikasi bisa saja menerima JWT tapi tetap membuat session jika konfigurasi tidak tepat.

Untuk API stateless, biasanya perlu memastikan:

```java
.sessionManagement(session -> session
    .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
```

Namun ini bukan satu-satunya faktor. Perlu juga memeriksa:

- apakah form login aktif,
- apakah request cache aktif,
- apakah CSRF behavior sesuai,
- apakah custom filter menyimpan context ke session,
- apakah `SecurityContextRepository` custom digunakan.

### 11.2 Stateless bukan berarti tidak punya state sama sekali

JWT validation tetap butuh state dalam bentuk:

- signing key/JWKS cache,
- issuer metadata cache,
- revoked token list bila ada,
- user/client disabled status bila dicek real-time,
- clock synchronization,
- tenant configuration.

Stateless artinya:

> **resource server tidak menyimpan per-session state untuk setiap caller request.**

Bukan berarti seluruh sistem bebas state.

---

## 12. Anonymous Authentication

Spring Security bisa mengisi context dengan anonymous authentication.

Maknanya:

```text
Caller belum login, tetapi system tetap merepresentasikan caller sebagai anonymous principal.
```

Ini membantu karena application code bisa menghindari null check ekstrem.

Namun perlu hati-hati:

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
if (auth != null && auth.isAuthenticated()) {
    // bisa true untuk anonymous dalam beberapa konteks
}
```

Lebih baik gunakan utility atau cek tipe/authority:

```java
boolean anonymous = auth instanceof AnonymousAuthenticationToken;
```

Atau gunakan ekspresi authorization Spring:

```java
.isAuthenticated()
.isAnonymous()
.isFullyAuthenticated()
```

Mental model:

> `isAuthenticated()` tidak selalu berarti “real user sudah login dengan strong proof”.

---

## 13. Remember-Me Authentication

Remember-me adalah mode continuity yang berbeda dari normal session.

Biasanya:

```text
User login
  -> remember-me cookie diterbitkan
Session hilang
  -> remember-me cookie dipakai untuk membuat Authentication baru
```

Risiko:

- cookie theft,
- long-lived bearer credential,
- logout mismatch,
- weak token storage,
- device compromise.

Rule production:

1. Jangan samakan remember-me dengan full authentication.
2. Gunakan step-up untuk operasi sensitif.
3. Rotate token.
4. Simpan token server-side dalam bentuk hash bila persistent remember-me.
5. Audit remember-me login sebagai event berbeda.

---

## 14. Exception Flow: 401, Redirect, dan 403

Spring Security membedakan dua jenis masalah:

### 14.1 Belum authenticated

Contoh:

```text
Request /dashboard tanpa login
```

Respons tergantung mode:

| Mode | Response |
|---|---|
| form login | redirect ke login page |
| HTTP Basic | 401 + `WWW-Authenticate` |
| bearer token API | 401 |
| custom API | 401 custom JSON |

Komponen utama:

```text
AuthenticationEntryPoint
```

### 14.2 Sudah authenticated tapi tidak authorized

Contoh:

```text
User login sebagai ROLE_USER mengakses /admin
```

Response biasanya:

```text
403 Forbidden
```

Komponen utama:

```text
AccessDeniedHandler
```

### 14.3 Kesalahan umum API

Banyak aplikasi mengembalikan 403 untuk token invalid.

Lebih tepat:

| Kondisi | Response umum |
|---|---|
| tidak ada credential | 401 |
| credential invalid/expired | 401 |
| credential valid tapi kurang permission | 403 |

Rule:

> **401 = authentication belum valid. 403 = authentication valid tetapi authorization ditolak.**

---

## 15. Form Login Flow Internal

Form login adalah contoh bagus untuk memahami authentication flow klasik.

```text
GET /login
  -> render login page

POST /login
  -> UsernamePasswordAuthenticationFilter
      - extract username/password
      - create UsernamePasswordAuthenticationToken unauthenticated
      - call AuthenticationManager
          -> DaoAuthenticationProvider
              - load UserDetails
              - verify password
              - check account status
              - return authenticated token
      - set SecurityContext
      - save context to session
      - success handler redirect
```

### 15.1 `UserDetailsService` bukan authenticator

`UserDetailsService` hanya load user data:

```java
UserDetails loadUserByUsername(String username)
```

Ia tidak seharusnya:

- memverifikasi raw password sendiri,
- mengatur session,
- menulis response HTTP,
- menentukan redirect,
- melakukan authorization kompleks.

Password verification dilakukan oleh `PasswordEncoder` di provider.

### 15.2 Account status checks

Username/password authentication bukan hanya hash match.

Biasanya provider juga cek:

- account non-expired,
- account non-locked,
- credentials non-expired,
- enabled.

Dalam domain enterprise, bisa ditambah:

- tenant active,
- employment status,
- agency membership,
- user lifecycle state,
- password must change,
- MFA required,
- risk score.

Namun hati-hati: tidak semua domain state harus dipaksa masuk ke `UserDetails`. Kadang lebih baik gunakan custom principal dan separate policy service.

---

## 16. HTTP Basic Flow Internal

HTTP Basic membaca header:

```http
Authorization: Basic base64(username:password)
```

Flow:

```text
BasicAuthenticationFilter
  -> parse Authorization header
  -> create UsernamePasswordAuthenticationToken unauthenticated
  -> AuthenticationManager
  -> AuthenticationProvider
  -> set context for current request
```

Basic sering dipakai untuk:

- legacy API,
- internal tool sederhana,
- actuator endpoint lama,
- transitional migration.

Tetapi production risk tinggi bila:

- tidak memakai TLS,
- credential long-lived,
- dipakai oleh browser tanpa CSRF consideration,
- tidak ada rate limit,
- tidak ada rotation,
- password user dipakai untuk API integration.

Untuk machine-to-machine, sering lebih baik:

- client credentials OAuth2,
- mTLS,
- HMAC signing,
- API key dengan lifecycle kuat.

---

## 17. Bearer Token / Resource Server Flow

Bearer token flow:

```http
Authorization: Bearer eyJhbGciOi...
```

Flow konseptual:

```text
BearerTokenAuthenticationFilter
  -> extract bearer token
  -> AuthenticationManager
  -> JWT decoder or opaque introspector
  -> validate token
  -> map claims/scopes to authorities
  -> set SecurityContext for current request
```

Hal penting:

1. token extraction harus strict,
2. token validation harus cek issuer,
3. audience harus benar,
4. expiry dan not-before harus dicek,
5. signature harus valid,
6. algorithm harus allowed,
7. authorities mapping harus eksplisit,
8. tenant binding harus jelas.

Kesalahan umum:

```text
Valid signature dianggap cukup.
```

Padahal token valid secara cryptographic belum tentu valid secara business/security context.

Harus cek:

- issuer,
- audience,
- authorized party/client,
- tenant,
- subject lifecycle,
- token type,
- scope/role mapping,
- trust relationship.

---

## 18. Pre-Authenticated Authentication

Pre-auth berarti aplikasi tidak memverifikasi credential langsung.

Contoh:

```text
Reverse proxy / gateway / SSO appliance / mTLS terminator
  authenticates caller
  forwards identity to app
```

App menerima:

```http
X-Authenticated-User: fajar
X-Authenticated-Groups: admin,case-officer
```

Spring mengubah header itu menjadi `Authentication`.

### 18.1 Ini sangat berbahaya jika trust boundary salah

Jika client publik bisa mengirim header tersebut langsung:

```http
X-Authenticated-User: admin
```

maka authentication bypass terjadi.

Pre-auth hanya aman jika:

1. app hanya menerima traffic dari trusted proxy,
2. proxy menghapus incoming spoofed headers,
3. network boundary enforced,
4. TLS/mTLS antara proxy dan app dipakai bila perlu,
5. header identity ditandatangani atau protected,
6. audit mencatat upstream authenticator.

Rule:

> **Pre-auth bukan berarti tidak ada authentication; authentication dipindahkan ke upstream trust boundary.**

---

## 19. Custom Authentication Pattern yang Benar

Misal kita ingin membuat API key authentication.

### 19.1 Jangan langsung set context di filter tanpa manager

Bad pattern:

```java
public class ApiKeyFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) {
        String apiKey = request.getHeader("X-API-Key");
        ApiClient client = repository.findByRawKey(apiKey);
        Authentication auth = new UsernamePasswordAuthenticationToken(
            client,
            null,
            authorities
        );
        SecurityContextHolder.getContext().setAuthentication(auth);
        chain.doFilter(request, response);
    }
}
```

Masalah:

- filter terlalu pintar,
- raw key lookup mungkin insecure,
- no provider abstraction,
- no consistent failure handling,
- sulit dites,
- bisa bypass authentication manager,
- context cleanup bergantung framework order,
- sulit support multi-provider.

### 19.2 Pattern yang lebih baik

```text
ApiKeyAuthenticationFilter
  -> extract X-API-Key
  -> create ApiKeyAuthenticationToken unauthenticated
  -> call AuthenticationManager

ApiKeyAuthenticationProvider
  -> hash API key
  -> lookup key id/prefix
  -> verify constant-time
  -> check status/expiry/scope/tenant
  -> return authenticated ApiKeyAuthenticationToken
```

### 19.3 Token class

```java
public final class ApiKeyAuthenticationToken extends AbstractAuthenticationToken {

    private final Object principal;
    private final String rawApiKey;

    private ApiKeyAuthenticationToken(
            Object principal,
            String rawApiKey,
            Collection<? extends GrantedAuthority> authorities,
            boolean authenticated) {
        super(authorities);
        this.principal = principal;
        this.rawApiKey = rawApiKey;
        super.setAuthenticated(authenticated);
    }

    public static ApiKeyAuthenticationToken unauthenticated(String rawApiKey) {
        return new ApiKeyAuthenticationToken(null, rawApiKey, List.of(), false);
    }

    public static ApiKeyAuthenticationToken authenticated(
            ApiClientPrincipal principal,
            Collection<? extends GrantedAuthority> authorities) {
        return new ApiKeyAuthenticationToken(principal, null, authorities, true);
    }

    @Override
    public Object getCredentials() {
        return rawApiKey;
    }

    @Override
    public Object getPrincipal() {
        return principal;
    }
}
```

Important:

- raw API key hanya ada pada unauthenticated phase,
- setelah authenticated, credential bisa dibuang,
- principal berisi metadata aman,
- authority berasal dari verified source.

---

## 20. `OncePerRequestFilter`: Berguna tapi Sering Disalahgunakan

`OncePerRequestFilter` sering dipakai untuk custom authentication.

Ia memastikan filter dipanggil sekali per request dispatch tertentu.

Namun `OncePerRequestFilter` bukan authentication framework lengkap.

Ia hanya convenience base class.

Rule:

1. Pakai untuk extract credential dari request.
2. Jangan taruh semua authentication business logic di sana.
3. Delegasikan ke `AuthenticationManager`.
4. Pastikan behavior untuk missing credential jelas.
5. Pastikan exception ditangani oleh Spring Security chain.
6. Pastikan filter order benar.

### 20.1 Missing credential: continue atau fail?

Untuk optional auth:

```text
No API key
  -> continue chain
  -> later authorization decides if anonymous allowed
```

Untuk endpoint yang harus API key:

```text
No API key
  -> authentication entry point 401
```

Namun lebih sering desain yang rapi:

- filter hanya attempt jika credential ada,
- authorization rule menentukan endpoint mana wajib authenticated.

---

## 21. Filter Ordering

Spring Security filter order sangat penting.

Jika custom JWT/API key filter diletakkan setelah authorization filter, maka authorization terjadi sebelum authentication.

Akibat:

```text
Request membawa token valid
  -> authorization melihat anonymous
  -> ditolak 401/403
```

Rule umum:

```java
http.addFilterBefore(customFilter, UsernamePasswordAuthenticationFilter.class);
```

atau bergantung mode:

```java
http.addFilterBefore(customFilter, BasicAuthenticationFilter.class);
```

Tapi jangan hafal anchor filter secara buta.

Tanyakan:

> “Filter saya harus berjalan sebelum komponen mana yang membutuhkan `Authentication`?”

Biasanya authentication filter harus berjalan sebelum authorization filter.

---

## 22. Authentication vs Authorization di Spring Security

Authentication menghasilkan:

```text
Authentication(principal, authorities, authenticated=true)
```

Authorization menggunakan:

```text
Authentication + Request/Method/Resource
  -> allow/deny
```

Kesalahan umum:

```java
if (user.isAdmin()) {
    auth.setAuthenticated(true);
}
```

Admin status bukan bukti authentication.

Authentication menjawab:

> “Apakah caller ini benar-benar siapa yang diklaim?”

Authorization menjawab:

> “Apakah caller yang sudah diketahui ini boleh melakukan aksi ini?”

Spring Security memang menyimpan authorities di `Authentication`, tetapi authority bukan pengganti authentication proof.

---

## 23. Authorities, Roles, Scopes, Permissions

Spring Security memakai `GrantedAuthority` sebagai unit authority.

Contoh:

```text
ROLE_ADMIN
SCOPE_case.read
PERM_CASE_APPROVE
TENANT_cea
```

### 23.1 Role prefix

Secara historis Spring memakai convention:

```text
ROLE_ADMIN
```

`hasRole("ADMIN")` biasanya mencari authority:

```text
ROLE_ADMIN
```

Sedangkan:

```java
hasAuthority("ADMIN")
```

mencari exact authority `ADMIN`.

Kesalahan umum:

```java
.hasRole("ROLE_ADMIN")
```

yang bisa menjadi `ROLE_ROLE_ADMIN` tergantung konfigurasi.

### 23.2 Scope mapping

OAuth2 resource server sering map scope ke authority:

```text
scope: "case.read case.write"
```

menjadi:

```text
SCOPE_case.read
SCOPE_case.write
```

Jangan campur tanpa keputusan eksplisit:

```text
ROLE_ADMIN
SCOPE_admin
admin
PERMISSION_ADMIN
```

Buat authority taxonomy sejak awal.

### 23.3 Authority bukan policy lengkap

Untuk sistem regulatory/case management, authorization sering bergantung pada:

- role,
- tenant,
- case assignment,
- case status,
- escalation stage,
- conflict of interest,
- jurisdiction,
- time window,
- delegation,
- acting capacity.

Jangan paksakan semua ke `GrantedAuthority`.

Lebih baik:

```text
Authentication:
  who is caller?
  what coarse authorities/scopes are granted?

Domain policy:
  can this caller perform this action on this resource now?
```

---

## 24. Method Security: Authentication Beyond HTTP Layer

Spring Security juga bisa mengamankan method:

```java
@PreAuthorize("hasAuthority('SCOPE_case.read')")
public CaseDetails getCase(String caseId) {
    ...
}
```

Method security membaca `Authentication` dari `SecurityContextHolder`.

Artinya jika context propagation salah, method security juga salah.

### 24.1 Jangan hanya mengandalkan controller security

Controller-level security bagus, tapi service-level method security berguna untuk:

- shared service dipanggil dari banyak controller,
- command handlers,
- scheduled jobs dengan system actor,
- async handlers,
- internal APIs,
- defense in depth.

Namun jangan jadikan annotation expression terlalu kompleks.

Bad:

```java
@PreAuthorize("hasRole('A') and #case.status == 'OPEN' and @policy.check(authentication, #case, 'APPROVE') and ...")
```

Lebih baik:

```java
@PreAuthorize("@casePolicy.canApprove(authentication, #caseId)")
```

---

## 25. Authentication in Spring MVC Controllers

Ada beberapa cara mengakses principal.

```java
@GetMapping("/me")
public MeResponse me(Authentication authentication) {
    return mapper.toResponse(authentication);
}
```

Atau:

```java
@GetMapping("/me")
public MeResponse me(@AuthenticationPrincipal CustomUser user) {
    return mapper.toResponse(user);
}
```

Atau:

```java
SecurityContextHolder.getContext().getAuthentication();
```

Rule:

- Di controller, prefer parameter injection.
- Di service domain, jangan terlalu bergantung langsung ke Spring Security bila ingin clean boundary.
- Untuk domain service, pertimbangkan `CurrentActorProvider` abstraction.

Contoh:

```java
public interface CurrentActorProvider {
    CurrentActor currentActor();
}
```

Implementation Spring:

```java
@Component
public final class SpringSecurityCurrentActorProvider implements CurrentActorProvider {
    @Override
    public CurrentActor currentActor() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return CurrentActorMapper.from(auth);
    }
}
```

---

## 26. Stateful Spring Security Architecture

Stateful architecture:

```text
Browser
  -> POST /login credentials
  -> server validates
  -> server creates session
  -> browser stores session cookie
  -> subsequent request sends cookie
  -> server loads SecurityContext from session
```

Characteristics:

| Aspect | Stateful Session |
|---|---|
| Credential sent every request | No, only session id |
| Server keeps per-user state | Yes |
| Logout immediate | Easier |
| Horizontal scale | Needs sticky/session store/replication |
| Browser friendly | Yes |
| CSRF concern | Yes for cookie-based auth |
| Token revocation | Session invalidation |

Spring components:

- `SecurityContextRepository`,
- `HttpSessionSecurityContextRepository`,
- session fixation protection,
- concurrent session control,
- logout handlers,
- CSRF protection.

---

## 27. Stateless Spring Security Architecture

Stateless architecture:

```text
Client
  -> sends token each request
  -> server validates token each request
  -> context exists only for request duration
```

Characteristics:

| Aspect | Stateless Token |
|---|---|
| Credential/proof sent every request | Yes |
| Server keeps per-session state | No |
| Logout immediate | Harder unless revocation/introspection |
| Horizontal scale | Easier |
| Browser CSRF | Depends storage mechanism |
| Token leak impact | Until expiry/revocation |
| Key lifecycle | Critical |

Spring configuration often includes:

```java
http
  .sessionManagement(session -> session
      .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
  .oauth2ResourceServer(oauth2 -> oauth2.jwt());
```

But again: statelessness is a design property, not just one line of config.

---

## 28. CSRF and Authentication Mode Interaction

CSRF matters when browser automatically attaches credential.

Examples automatically attached by browser:

- session cookie,
- remember-me cookie,
- Basic auth cached credential,
- client certificate.

If authentication credential is automatically sent by browser, malicious site can cause browser to send request.

For bearer token stored in JS memory and manually attached header, CSRF risk is different, but XSS risk increases.

Spring Security enables CSRF protection by default for browser-relevant state-changing requests.

Rule:

> **Do not disable CSRF because “API”. Disable or customize it only after deciding credential transport model.**

Examples:

| Authentication | CSRF Concern |
|---|---|
| Cookie session web app | High |
| SPA with HttpOnly cookie BFF | High, must handle CSRF |
| Mobile app bearer header | Low CSRF, other risks |
| Server-to-server bearer header | Low CSRF |
| Browser Basic auth | CSRF possible |

---

## 29. Logout Semantics in Spring Security

Logout is easy only when authentication continuity is server-side.

### 29.1 Stateful logout

```text
/logout
  -> invalidate session
  -> clear SecurityContext
  -> delete cookies
  -> redirect or return success
```

### 29.2 Stateless logout

If client has JWT:

```text
/logout
  -> client deletes token
```

But stolen token may still work until expiry unless:

- token is short-lived,
- revocation list exists,
- introspection is used,
- refresh token rotation detects compromise,
- signing key rotated as emergency.

### 29.3 Federated logout

If OIDC/SAML involved, logout may need:

- local app logout,
- IdP logout,
- RP-initiated logout,
- front-channel logout,
- back-channel logout,
- session state sync.

Spring Security can help, but architecture decision remains yours.

---

## 30. Common Failure Modes

### 30.1 Filter not invoked

Symptoms:

```text
Custom authentication never happens
```

Possible causes:

- wrong chain matcher,
- filter added to wrong chain,
- chain ordering wrong,
- endpoint excluded from security,
- request path different because context path/proxy rewrite.

### 30.2 Filter invoked after authorization

Symptoms:

```text
Token valid but request rejected as anonymous
```

Cause:

- wrong filter order.

### 30.3 Context set but not persisted

Symptoms:

```text
Login success, next request anonymous
```

Possible causes:

- stateless session policy,
- custom filter only sets holder but not repository,
- session not created,
- cookie not stored,
- domain/path/SameSite/Secure cookie issue,
- context cleared before save.

### 30.4 Authentication object wrong type

Symptoms:

```text
ClassCastException in controller/service
```

Cause:

- assuming principal type fixed,
- multiple authentication modes introduced,
- anonymous principal not handled.

### 30.5 Authorities missing

Symptoms:

```text
Login success but 403
```

Possible causes:

- scope mapping mismatch,
- role prefix mismatch,
- custom provider returns empty authorities,
- authorities loaded but erased,
- JWT claim path wrong,
- case sensitivity.

### 30.6 Credentials leaked in logs

Symptoms:

```text
Authorization header/API key/password appears in logs
```

Cause:

- logging raw request headers,
- `toString()` includes credentials,
- exception message includes token,
- audit event stores secret.

Rule:

> Credentials must be treated as toxic data.

### 30.7 Authentication bypass by trusted header

Symptoms:

```text
Client can set X-User header and become someone else
```

Cause:

- pre-auth header trusted without network/header sanitization boundary.

### 30.8 Session created in stateless API

Symptoms:

```text
API emits JSESSIONID unexpectedly
```

Possible causes:

- session policy not stateless,
- request cache,
- CSRF token repository using session,
- form login enabled,
- exception handling creates session,
- custom code calls `request.getSession()`.

---

## 31. Debugging Spring Security Authentication

### 31.1 Ask pipeline questions

Saat request gagal, jangan langsung ubah konfigurasi.

Tanya berurutan:

1. Request masuk ke chain mana?
2. Filter authentication yang diharapkan jalan atau tidak?
3. Credential/proof terbaca atau tidak?
4. `AuthenticationManager` dipanggil atau tidak?
5. Provider mana yang `supports()` token?
6. Provider gagal karena apa?
7. `SecurityContext` diset atau tidak?
8. Context dipersist atau tidak?
9. Authorization melihat principal apa?
10. Exception diterjemahkan oleh entry point atau access denied handler?

### 31.2 Enable debug carefully

Spring Security punya debug logging, tetapi hati-hati di environment non-local karena bisa memperlihatkan detail sensitif.

Gunakan debug untuk:

- filter chain matching,
- authorization decision,
- authentication provider flow,
- exception handling.

Jangan log:

- raw password,
- token,
- cookie,
- API key,
- secret header.

### 31.3 Minimal diagnostic log yang aman

Contoh audit-safe log:

```text
auth_attempt mode=api_key key_prefix=ak_live_1234 tenant=cea result=failed reason=expired correlation_id=...
```

Bukan:

```text
auth_attempt api_key=ak_live_123456789abcdef...
```

---

## 32. Design Pattern: Authentication Adapter Layer

Untuk aplikasi enterprise besar, jangan biarkan seluruh domain code bergantung langsung ke `Authentication` Spring.

Buat adapter:

```text
Spring Security Authentication
  -> CurrentActor
  -> Domain Policy / Audit / Use Case
```

Contoh model:

```java
public record CurrentActor(
    String actorId,
    ActorKind actorKind,
    String tenantId,
    String displayName,
    Set<String> authorities,
    AuthenticationMode authenticationMode,
    Instant authenticatedAt,
    Optional<String> sessionId,
    Optional<String> clientId
) {}
```

Manfaat:

- domain code tidak tahu detail Spring,
- multi-mode authentication lebih mudah,
- audit lebih konsisten,
- testing lebih sederhana,
- migration Spring/Jakarta/custom lebih murah.

### 32.1 Actor kind

```java
enum ActorKind {
    HUMAN_USER,
    SERVICE_ACCOUNT,
    BATCH_JOB,
    SYSTEM,
    EXTERNAL_PARTNER,
    ANONYMOUS
}
```

### 32.2 Authentication mode

```java
enum AuthenticationMode {
    PASSWORD_SESSION,
    OIDC_SESSION,
    JWT_BEARER,
    OPAQUE_TOKEN,
    API_KEY,
    HMAC_SIGNATURE,
    MTLS,
    PRE_AUTHENTICATED,
    REMEMBER_ME
}
```

Dengan ini audit event bisa berkata:

```text
actor=U123 actor_kind=HUMAN_USER auth_mode=OIDC_SESSION tenant=CEA action=CASE_APPROVE case_id=C456
```

Jauh lebih defensible daripada:

```text
user=fajar action=approve
```

---

## 33. Design Pattern: Multi-Mode Authentication Without Chaos

Aplikasi besar sering butuh beberapa mode:

- web admin pakai OIDC session,
- public API pakai bearer JWT,
- partner API pakai mTLS + signed request,
- internal scheduler pakai service account,
- legacy integration pakai Basic sementara.

Jangan campur semuanya di satu chain tanpa batas.

Lebih baik:

```text
/api/public/**
  -> no auth / limited auth

/api/mobile/**
  -> bearer token

/api/partner/**
  -> mTLS or HMAC/API key

/admin/**
  -> OIDC login session

/internal/**
  -> network restricted + service token
```

Spring structure:

```java
@Bean
@Order(1)
SecurityFilterChain partnerApi(HttpSecurity http) { ... }

@Bean
@Order(2)
SecurityFilterChain resourceApi(HttpSecurity http) { ... }

@Bean
@Order(3)
SecurityFilterChain adminWeb(HttpSecurity http) { ... }
```

Rule:

> **Authentication mode boundary sebaiknya terlihat di URL boundary, network boundary, atau protocol boundary.**

Jika tidak, debugging dan audit akan kacau.

---

## 34. Design Pattern: Fail Closed by Default

Authentication pipeline harus fail closed.

Bad:

```java
try {
    verifyToken(token);
} catch (Exception e) {
    log.warn("Token verification failed, continuing as fallback user");
    setFallbackUser();
}
```

Good:

```java
try {
    verifyToken(token);
} catch (AuthenticationException e) {
    clearContext();
    commence401();
}
```

Namun fail closed harus dibedakan dari anonymous access.

Jika endpoint memang public:

```text
No credential
  -> anonymous allowed
```

Jika endpoint protected:

```text
No/invalid credential
  -> reject
```

Jangan jadikan dependency outage sebagai anonymous fallback untuk protected endpoint.

---

## 35. Design Pattern: Authentication Event Model

Authentication bukan hanya runtime decision. Ia harus menghasilkan event.

Minimal event:

| Event | Kapan |
|---|---|
| `AUTH_ATTEMPTED` | credential/proof diterima |
| `AUTH_SUCCEEDED` | proof valid |
| `AUTH_FAILED` | proof invalid |
| `AUTH_REJECTED` | principal disabled/locked/expired |
| `SESSION_CREATED` | stateful session dibuat |
| `SESSION_ROTATED` | session id diganti |
| `SESSION_TERMINATED` | logout/invalidation |
| `TOKEN_ACCEPTED` | bearer token valid |
| `TOKEN_REJECTED` | bearer token invalid/expired/wrong audience |
| `PREAUTH_ACCEPTED` | upstream identity diterima |
| `PREAUTH_REJECTED` | upstream trust invalid |

Event harus mencatat:

- correlation ID,
- request ID,
- actor ID bila diketahui,
- attempted username/client ID bila aman,
- tenant,
- auth mode,
- result,
- reason category,
- source IP / proxy chain yang sudah dinormalisasi,
- user agent/device metadata bila relevan,
- upstream IdP/client.

Event tidak boleh mencatat:

- raw password,
- raw token,
- raw API key,
- full session ID,
- private key,
- OTP value.

---

## 36. Java 8 hingga 25: Relevansi Versi

Spring Security versi modern bergerak bersama ekosistem Spring Framework dan Java baseline.

Namun dari sisi konsep authentication architecture, pola utamanya stabil:

- filter chain,
- authentication object,
- manager/provider,
- security context,
- authority,
- exception handling.

Yang berubah dari waktu ke waktu:

| Area | Java 8 era | Java 17/21/25 era |
|---|---|---|
| Config style | `WebSecurityConfigurerAdapter` umum | `SecurityFilterChain` bean style |
| Runtime | thread-per-request dominan | virtual thread mulai relevan |
| Context propagation | ThreadLocal assumptions kuat | perlu lebih hati-hati dengan async/virtual/reactive |
| Password encoding | BCrypt/PBKDF2 umum | Argon2/scrypt support via libs lebih umum |
| TLS/key handling | JKS legacy masih banyak | PKCS12/PEM/KMS lebih umum |
| OAuth2/OIDC | sering custom/manual | first-class resource server/client support lebih matang |
| Jakarta namespace | Java EE `javax.*` | Jakarta `jakarta.*` di Spring Boot 3+ |

### 36.1 Migration mindset

Jika legacy Java 8/Spring Security lama:

- jangan hanya mechanically migrate config,
- petakan authentication modes dulu,
- identifikasi custom filters,
- identifikasi manual `SecurityContextHolder` writes,
- identifikasi session assumptions,
- identifikasi role prefix assumptions,
- identifikasi CSRF disablement lama,
- identifikasi password encoder lama,
- identifikasi remember-me/token storage.

---

## 37. Production Checklist

### 37.1 Chain design

- [ ] Setiap URL boundary punya chain yang jelas.
- [ ] Specific chain ordered sebelum generic chain.
- [ ] Tidak ada accidental unprotected endpoint.
- [ ] Public endpoint tetap dipahami apakah melewati security filters.
- [ ] Actuator/admin/internal endpoint punya boundary sendiri.

### 37.2 Authentication provider design

- [ ] Provider `supports()` sempit dan benar.
- [ ] Provider tidak menerima token type yang bukan urusannya.
- [ ] Credential diverifikasi constant-time bila relevan.
- [ ] Credential tidak disimpan setelah authentication success.
- [ ] Disabled/locked/expired principal dicek.
- [ ] Failure reason dicatat internal tanpa membocorkan ke client.

### 37.3 Context design

- [ ] Context dibersihkan setelah request.
- [ ] Async execution punya propagation policy.
- [ ] Domain service tidak hard-cast principal sembarangan.
- [ ] Anonymous authentication dipahami.
- [ ] Stateless endpoint tidak membuat session tidak sengaja.

### 37.4 Session/token design

- [ ] Stateful session punya session fixation protection.
- [ ] Stateless API tidak menghasilkan `JSESSIONID` tanpa alasan.
- [ ] JWT validation cek issuer, audience, expiry, signature, algorithm.
- [ ] Token authorities mapping eksplisit.
- [ ] Logout semantics jelas.

### 37.5 Browser security

- [ ] CSRF decision sesuai credential transport.
- [ ] Cookie flags benar.
- [ ] Login success/failure handler aman.
- [ ] Redirect target divalidasi.
- [ ] Remember-me diperlakukan sebagai weaker auth.

### 37.6 Observability

- [ ] Auth success/failure event ada.
- [ ] Correlation ID terhubung ke audit.
- [ ] Secret tidak masuk log.
- [ ] 401/403 metrics dipisah.
- [ ] Provider latency dimonitor.
- [ ] IdP/introspection/JWKS failure dimonitor.

---

## 38. Common Anti-Patterns

### Anti-pattern 1 — JWT filter copy-paste

Ciri:

- filter parse token sendiri,
- tidak cek audience,
- tidak cek issuer,
- tidak handle key rotation,
- langsung set `UsernamePasswordAuthenticationToken`,
- role mapping hardcoded.

Dampak:

- token dari issuer lain diterima,
- tenant confusion,
- revocation impossible,
- security bugs tersembunyi.

### Anti-pattern 2 — Semua mode authentication dalam satu filter

Ciri:

```text
if header Basic -> do basic
else if Bearer -> do JWT
else if X-API-Key -> do API key
else if cookie -> do session
```

Dampak:

- impossible to reason,
- hard to audit,
- wrong priority,
- bypass risk,
- fragile tests.

Lebih baik gunakan multiple filters/providers/chain boundaries.

### Anti-pattern 3 — Domain code membaca Spring principal langsung di mana-mana

Ciri:

```java
((UserDetails) SecurityContextHolder.getContext()
    .getAuthentication()
    .getPrincipal()).getUsername()
```

Dampak:

- sulit test,
- gagal saat mode auth berubah,
- anonymous crash,
- service layer coupling tinggi.

### Anti-pattern 4 — Menganggap `permitAll` berarti tidak ada security

Dampak:

- custom filter tetap jalan di endpoint public,
- token invalid bisa membuat public endpoint gagal,
- CSRF/header/session behavior tetap berlaku.

### Anti-pattern 5 — `isAuthenticated()` dianggap cukup

Dampak:

- anonymous/remember-me dianggap full login,
- step-up bypass,
- operasi sensitif tidak cukup kuat.

---

## 39. Mental Model Final

Spring Security authentication bisa diringkas sebagai transformasi:

```text
HTTP request membawa proof
        |
        v
Authentication filter membaca proof
        |
        v
Unauthenticated Authentication dibuat
        |
        v
AuthenticationManager memilih provider
        |
        v
AuthenticationProvider memverifikasi proof
        |
        v
Authenticated Authentication dibuat
        |
        v
SecurityContextHolder menyimpan identity untuk eksekusi saat ini
        |
        v
Authorization dan application logic memakai context
        |
        v
Context disimpan ke session atau dibuang setelah request
```

Kalau ingin menjadi engineer yang kuat di Spring Security, jangan mulai dari:

```text
Config apa yang harus saya copy?
```

Mulai dari:

```text
Proof apa yang masuk?
Siapa yang memverifikasi?
Apa bentuk principal setelah verified?
Di mana identity disimpan?
Berapa lama identity berlaku?
Bagaimana context berpindah antar request/thread/service?
Apa yang terjadi saat gagal?
Apa yang bisa diaudit?
```

---

## 40. Design Questions

Gunakan pertanyaan ini saat review authentication architecture Spring:

1. Apa saja authentication mode yang didukung aplikasi ini?
2. Apakah setiap mode punya boundary URL/protocol/network yang jelas?
3. Filter mana yang membaca credential?
4. Provider mana yang memverifikasi credential?
5. Apakah provider `supports()` token type secara sempit?
6. Apa principal object setelah authentication sukses?
7. Apakah principal cukup stabil untuk audit?
8. Apakah authorities berasal dari trusted source?
9. Apakah token/session lifecycle jelas?
10. Apakah stateless endpoint benar-benar tidak membuat session?
11. Apakah CSRF decision sesuai browser credential model?
12. Apakah 401 dan 403 dibedakan?
13. Apakah custom filter berjalan sebelum authorization?
14. Apakah context propagation aman untuk async?
15. Apakah secret pernah masuk log?
16. Apakah event authentication cukup untuk forensic reconstruction?
17. Apakah logout semantics jelas untuk local dan federated session?
18. Apakah role/scope mapping terdokumentasi?
19. Apakah anonymous/remember-me/full auth dibedakan?
20. Apakah migration dari legacy config punya regression test?

---

## 41. Mini Case Study: Regulatory Case Management App

Misal aplikasi regulatory case management punya kebutuhan:

- officer login via OIDC,
- internal API dipanggil SPA/BFF,
- partner agency mengirim data via API key + HMAC,
- batch job membuat enforcement reminder,
- admin punya step-up MFA untuk operasi sensitif,
- audit harus bisa membuktikan siapa melakukan apa.

Spring Security design:

```text
/admin/**
  mode: OIDC login session
  chain: web stateful
  csrf: enabled
  session: enabled
  step-up: required for sensitive action

/api/app/**
  mode: BFF session or bearer token depending architecture
  chain: app API
  csrf: depends cookie/header model

/api/partner/**
  mode: API key + HMAC or mTLS
  chain: partner stateless
  session: stateless
  provider: PartnerAuthenticationProvider

/internal/batch/**
  mode: service token or network + mTLS
  chain: internal stateless
  actor kind: BATCH_JOB / SERVICE_ACCOUNT
```

Domain actor model:

```text
CurrentActor
  actorId
  actorKind
  tenantId/agencyId
  authenticationMode
  authorities
  sessionId/clientId
  assuranceLevel
```

Audit event:

```text
case_action
  actor_id=U123
  actor_kind=HUMAN_USER
  auth_mode=OIDC_SESSION
  assurance_level=MFA
  tenant=CEA
  action=APPROVE_ENFORCEMENT
  case_id=C456
  correlation_id=...
```

Ini jauh lebih kuat daripada sekadar:

```text
ROLE_ADMIN allowed /case/approve
```

Karena authentication architecture harus mendukung:

- legal defensibility,
- operational debugging,
- incident investigation,
- least privilege,
- future migration.

---

## 42. Summary

Dalam Part 7, kita mempelajari bahwa Spring Security authentication architecture adalah pipeline, bukan satu konfigurasi.

Poin utama:

1. `DelegatingFilterProxy` menjembatani Servlet container ke Spring bean.
2. `FilterChainProxy` adalah entry point utama Spring Security Servlet support.
3. `SecurityFilterChain` memungkinkan banyak mode authentication dalam satu aplikasi dengan boundary jelas.
4. `SecurityContextHolder` menyimpan identity saat ini, historisnya berbasis ThreadLocal di Servlet stack.
5. `Authentication` punya dua fase: unauthenticated claim/proof dan authenticated verified identity.
6. `AuthenticationManager` mengorkestrasi authentication.
7. `AuthenticationProvider` memverifikasi proof untuk mode tertentu.
8. Filter sebaiknya membaca request dan delegasi, bukan menampung semua logic.
9. Stateful dan stateless authentication berbeda pada lifecycle context, bukan hanya config line.
10. Anonymous, remember-me, full auth, MFA, dan pre-auth harus dibedakan.
11. Custom authentication harus didesain dengan provider/token/filter separation.
12. Production-grade Spring Security membutuhkan audit, metrics, context cleanup, failure modeling, dan migration awareness.

Mental model akhir:

> **Spring Security adalah mesin transformasi proof menjadi authenticated context. Engineer top-level tidak hanya tahu konfigurasi, tetapi tahu siapa yang membaca proof, siapa yang memverifikasi, siapa yang menyimpan identity, kapan identity dibersihkan, dan bagaimana failure bisa dibuktikan.**

---

## 43. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

1. Spring Security Reference — Servlet Authentication Architecture  
   `https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html`

2. Spring Security Reference — Servlet Architecture  
   `https://docs.spring.io/spring-security/reference/servlet/architecture.html`

3. Spring Security Reference — Username/Password Authentication  
   `https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/index.html`

4. Spring Security Reference — OAuth2 Resource Server  
   `https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html`

5. Spring Security Reference — Authorization  
   `https://docs.spring.io/spring-security/reference/servlet/authorization/index.html`

6. OWASP Session Management Cheat Sheet  
   `https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html`

7. OWASP Authentication Cheat Sheet  
   `https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html`

8. RFC 6750 — OAuth 2.0 Bearer Token Usage  
   `https://www.rfc-editor.org/rfc/rfc6750`

---

## 44. Status Series

Part selesai:

- Part 0 — Orientation: Mental Model of Authentication in Java Systems
- Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
- Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
- Part 3 — Password Authentication Done Properly
- Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
- Part 5 — Servlet Container Authentication
- Part 6 — Jakarta Security and Jakarta Authentication Deep Dive
- Part 7 — Spring Security Authentication Architecture

Series **belum selesai**.

Part berikutnya:

> **Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-006.md">⬅️ Part 6 — Jakarta Security and Jakarta Authentication Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-008.md">Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads ➡️</a>
</div>
