# Part 25 — API Gateway, Reverse Proxy, and Container Boundary Security

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-25-api-gateway-reverse-proxy-container-boundary.md`  
> Target: Java 8–25, Java EE/Jakarta EE, Servlet/JAX-RS/Jakarta Security/Jakarta Authentication/Jakarta Authorization, aplikasi enterprise dan regulatory-grade systems.

---

## 0. Posisi Part Ini dalam Seri

Pada bagian sebelumnya kita sudah membangun fondasi:

1. identity, principal, subject, role, permission;
2. Servlet security;
3. Jakarta Security API;
4. IdentityStore;
5. Jakarta Authentication/JASPIC;
6. Jakarta Authorization/JACC;
7. declarative dan programmatic authorization;
8. token/OIDC/SAML/mTLS;
9. context propagation;
10. multi-tenancy dan workflow authorization.

Part ini membahas area yang sering menjadi sumber bug security production: **boundary antara aplikasi Jakarta dan infrastruktur HTTP di depannya**.

Dalam arsitektur modern, aplikasi Java/Jakarta hampir tidak pernah menerima request langsung dari browser atau client. Biasanya ada satu atau lebih komponen di depan aplikasi:

```text
Client
  -> CDN / WAF
  -> Load Balancer
  -> API Gateway
  -> Reverse Proxy / Ingress Controller
  -> Service Mesh Proxy
  -> Servlet Container / Jakarta Application
```

Setiap layer bisa:

- terminate TLS;
- menambah header;
- menghapus header;
- melakukan authentication;
- melakukan token validation;
- melakukan rate limiting;
- melakukan routing;
- melakukan URL rewrite;
- melakukan compression;
- melakukan request buffering;
- melakukan body size enforcement;
- menyisipkan correlation ID;
- meneruskan identity ke aplikasi.

Masalahnya: semakin banyak layer, semakin mudah terjadi **confused trust boundary**.

Aplikasi merasa gateway sudah memvalidasi identity. Gateway merasa aplikasi akan melakukan authorization. Proxy meneruskan header `X-User` dari client tanpa strip. Container melihat request sebagai HTTP karena TLS sudah terminate di load balancer. Redirect URI OIDC menjadi salah karena `X-Forwarded-Proto` tidak dipercaya. Audit log mencatat IP proxy, bukan IP client. CORS dibuka terlalu luas karena dianggap hanya gateway yang exposed. Endpoint internal ternyata bisa diakses dari route publik.

Part ini membangun mental model agar kita bisa mendesain boundary security yang eksplisit, defensible, dan testable.

---

## 1. Core Mental Model: Gateway Is Not Automatically a Security Boundary

API gateway atau reverse proxy sering disebut “security layer”. Itu bisa benar, tetapi hanya jika ada kontrak yang jelas.

Gateway bukan security boundary hanya karena berada di depan aplikasi. Gateway menjadi security boundary jika semua syarat ini terpenuhi:

1. Semua traffic ke aplikasi **harus** melewati gateway.
2. Aplikasi tidak exposed langsung lewat network path lain.
3. Header identity dari luar dibersihkan sebelum gateway menambah header baru.
4. Aplikasi hanya mempercayai identity header dari network peer yang terpercaya.
5. Gateway dan aplikasi punya kontrak issuer/audience/role/scope/tenant yang eksplisit.
6. Authorization business-critical tetap dilakukan di aplikasi atau PDP yang trusted.
7. Semua bypass path diuji secara negatif.
8. Log dan audit bisa membedakan client, proxy, gateway, service account, dan user identity.

Tanpa itu, gateway hanya “komponen routing” yang kebetulan ada di depan aplikasi.

### 1.1 Security boundary vs routing boundary

Routing boundary menjawab:

> Request ini diarahkan ke service mana?

Security boundary menjawab:

> Siapa caller ini? Apakah caller ini boleh melakukan action ini terhadap resource ini, pada tenant ini, dalam state ini, melalui channel ini?

Routing boundary bisa terjadi tanpa security. Security boundary harus punya authentication, authorization, trust contract, observability, dan fail-closed behavior.

### 1.2 Prinsip utama

Gunakan prinsip berikut:

```text
Do not trust the network location alone.
Trust only verified identity, verified channel, verified source, verified policy, and verified context.
```

Dalam sistem Jakarta, berarti:

- jangan percaya `X-User` hanya karena header ada;
- jangan percaya `X-Forwarded-Proto` dari internet langsung;
- jangan percaya `X-Forwarded-For` tanpa daftar trusted proxy;
- jangan menganggap internal route otomatis aman;
- jangan menganggap token sudah valid hanya karena gateway meneruskan request;
- jangan menganggap role dari gateway sama dengan permission domain;
- jangan menghapus authorization di aplikasi hanya karena gateway sudah auth.

---

## 2. Komponen di Depan Aplikasi Jakarta

Mari bedakan komponen umum.

## 2.1 Load balancer

Load balancer membagi traffic ke beberapa backend.

Contoh:

- AWS ALB/NLB;
- Google Cloud Load Balancer;
- Azure Application Gateway;
- HAProxy;
- F5;
- nginx;
- Envoy.

Security-relevant behavior:

- TLS termination;
- client IP forwarding;
- health check;
- path/host routing;
- optional WAF integration;
- optional mTLS;
- header insertion;
- redirect HTTP → HTTPS;
- idle timeout;
- max header/body size;
- WebSocket upgrade handling.

Load balancer biasanya bagus untuk transport/routing, tetapi bukan tempat ideal untuk domain authorization.

## 2.2 Reverse proxy

Reverse proxy menerima request dari client dan meneruskan ke backend.

Fungsi umum:

- TLS termination;
- path rewrite;
- header normalization;
- caching;
- compression;
- static file serving;
- request buffering;
- rate limiting;
- auth request subcall;
- gateway-style policy.

Reverse proxy bisa berada sebagai nginx, Apache httpd, HAProxy, Envoy, Traefik, ingress controller, atau sidecar.

## 2.3 API gateway

API gateway biasanya lebih application-aware.

Fungsi umum:

- route API;
- validate JWT;
- OAuth2/OIDC integration;
- API key validation;
- quota/rate limiting;
- request/response transform;
- developer portal;
- service discovery;
- request authentication;
- sometimes coarse-grained authorization.

Contoh:

- Kong;
- Apigee;
- AWS API Gateway;
- Azure API Management;
- Tyk;
- KrakenD;
- Envoy-based gateway;
- Spring Cloud Gateway.

## 2.4 Ingress controller

Dalam Kubernetes, ingress controller menerapkan rules routing dari Ingress resource.

Security-relevant behavior:

- TLS termination;
- host/path routing;
- annotations for auth;
- ingress class-specific headers;
- backend protocol selection;
- timeout/buffer control;
- WAF integration;
- mTLS sometimes.

Risiko: konfigurasi security sering tersebar di annotation YAML dan tidak terlihat oleh developer aplikasi.

## 2.5 Service mesh proxy

Service mesh seperti Istio/Linkerd/Consul memakai sidecar/proxy layer untuk service-to-service traffic.

Security-relevant behavior:

- mTLS antar service;
- workload identity;
- policy enforcement;
- retry/circuit breaking;
- telemetry;
- traffic splitting.

Service mesh dapat memperkuat channel authentication, tetapi tidak otomatis menggantikan authorization domain di aplikasi.

---

## 3. Boundary Layer dalam Request Lifecycle

Mari lihat request lifecycle sederhana.

```text
[Client]
   |
   | HTTPS
   v
[Public Load Balancer / WAF]
   |
   | maybe HTTP or HTTPS
   v
[API Gateway / Reverse Proxy]
   |
   | internal HTTP/HTTPS
   v
[Servlet Container]
   |
   v
[Jakarta Security / Filters / JAX-RS]
   |
   v
[Application Service]
   |
   v
[Domain Authorization]
   |
   v
[Database / Downstream Services]
```

Ada beberapa pertanyaan kunci:

1. Di layer mana TLS terminate?
2. Di layer mana caller diautentikasi?
3. Di layer mana token divalidasi?
4. Di layer mana identity diterjemahkan menjadi role aplikasi?
5. Di layer mana domain permission dicek?
6. Di layer mana tenant ditentukan?
7. Di layer mana request ditolak?
8. Di layer mana audit dicatat?
9. Di layer mana rate limiting diterapkan?
10. Di layer mana headers dari luar dibersihkan?

Top 1% engineer tidak sekadar berkata “gateway handles auth”. Mereka menulis kontrak eksplisit:

```text
Gateway responsibilities:
- terminate public TLS
- reject unauthenticated request
- validate JWT issuer/audience/signature/time
- strip inbound identity headers
- inject signed internal identity header
- enforce coarse route-level policy
- attach correlation id

Application responsibilities:
- verify request came from trusted gateway/network/mTLS
- reconstruct caller identity from trusted token/header
- enforce method/resource/tenant/state authorization
- audit decision
- propagate safe identity downstream
```

---

## 4. Deployment Patterns

## 4.1 Pattern A — Application owns authentication and authorization

```text
Client -> LB/Proxy -> Jakarta App
                    -> Jakarta Security/OIDC/Session/Authz
```

Gateway/proxy only handles routing and TLS. App handles OIDC login, session, role mapping, domain authorization.

### Cocok untuk

- server-side web app;
- Jakarta app dengan built-in OIDC;
- aplikasi butuh domain-specific session;
- app perlu kontrol penuh atas login/logout/role mapping;
- tidak ada enterprise gateway standard.

### Kelebihan

- auth lifecycle jelas di aplikasi;
- Jakarta Security/Servlet session bekerja natural;
- domain identity mudah dikaitkan dengan session;
- audit lebih lengkap.

### Kekurangan

- setiap aplikasi harus implement OIDC/token validation;
- SSO lintas app perlu konsistensi;
- gateway tidak bisa enforce API policy kuat;
- duplicated security configuration.

### Failure mode

- callback URL salah karena proxy headers;
- app generate redirect `http://` bukan `https://`;
- app menerima request langsung bypass proxy;
- TLS antara proxy dan app tidak encrypted;
- role mapping berbeda antar aplikasi.

## 4.2 Pattern B — Gateway owns authentication, application owns authorization

```text
Client -> Gateway validates identity -> Jakarta App authorizes domain action
```

Gateway melakukan authentication/token validation. Aplikasi menerima identity yang sudah dipastikan, lalu melakukan authorization bisnis.

### Cocok untuk

- banyak service internal;
- centralized IdP integration;
- organisasi punya API gateway standard;
- API traffic high-volume;
- authentication ingin distandardisasi.

### Kelebihan

- token validation konsisten;
- service code lebih sederhana;
- centralized policy untuk route-level access;
- gateway bisa rate limit berdasarkan client/user.

### Kekurangan

- perlu trust contract kuat;
- header identity bisa dipalsukan jika tidak distrip;
- app bisa kehilangan detail token asli;
- debugging auth split antar layer;
- domain authorization tetap harus di app.

### Failure mode

- direct-to-app route bypass gateway;
- gateway menambah `X-User`, tapi tidak menghapus `X-User` inbound;
- app mempercayai `X-Roles` tanpa signature/source validation;
- gateway validate token tapi audience salah;
- app tidak cek tenant/resource permission.

## 4.3 Pattern C — Gateway owns both authentication and coarse authorization

```text
Client -> Gateway validates token + route/scope -> Jakarta App domain auth
```

Gateway mengecek token dan route-level scopes.

Contoh:

```text
GET /cases/** requires scope case.read
POST /cases/** requires scope case.write
DELETE /admin/** requires scope admin
```

Ini baik sebagai defense-in-depth, tetapi masih belum cukup untuk domain authorization.

Misalnya:

```text
POST /cases/123/approve
```

Gateway mungkin tahu scope `case.approve`, tetapi tidak tahu:

- case 123 milik tenant apa;
- user adalah assigned approver atau bukan;
- case state saat ini apa;
- user adalah maker sehingga tidak boleh approve sendiri;
- case sedang locked oleh officer lain;
- emergency override sedang aktif atau tidak.

Jadi gateway-level authorization hanya cocok untuk coarse-grained enforcement.

## 4.4 Pattern D — Zero trust / service mesh identity plus application authorization

```text
Client -> Gateway -> Service A -> Service B
                    mTLS workload identity
                    app-level user identity propagation
```

Service mesh memastikan workload identity dan encrypted channel. Aplikasi tetap harus membawa user identity secara aman.

### Mental model

Ada dua identity berbeda:

```text
workload identity: service-a calling service-b
user identity: Fajar acting through service-a
```

Authorization downstream sering butuh keduanya:

```text
service-a is allowed to call service-b endpoint
AND
user Fajar is allowed to approve case 123
```

Jika hanya memakai service identity, maka semua user yang melewati service-a berpotensi terlihat sama oleh service-b.

---

## 5. TLS Termination and Scheme Confusion

TLS termination adalah titik di mana HTTPS didekripsi.

```text
Client --HTTPS--> LB --HTTP--> App
```

Dari sudut pandang Servlet container, request mungkin terlihat sebagai HTTP, bukan HTTPS, kecuali proxy meneruskan informasi scheme dengan benar dan container dikonfigurasi untuk mempercayainya.

## 5.1 Kenapa scheme penting?

Scheme memengaruhi:

- redirect URL;
- OIDC redirect URI;
- cookie `Secure` behavior;
- absolute URL generation;
- enforcement `CONFIDENTIAL` transport guarantee;
- HSTS;
- CSRF origin/referrer validation;
- mixed-content issue;
- audit log.

Contoh bug:

```text
Browser accesses: https://app.example.com/login
LB forwards to app: http://app:8080/login
App builds callback: http://app.example.com/oidc/callback
IdP registered callback: https://app.example.com/oidc/callback
Result: redirect_uri mismatch
```

## 5.2 Forwarded headers

Ada dua keluarga header umum:

```text
Standard:
Forwarded: for=203.0.113.10;proto=https;host=app.example.com

De-facto:
X-Forwarded-For: 203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: app.example.com
X-Forwarded-Port: 443
```

RFC 7239 mendefinisikan header standar `Forwarded` untuk membawa informasi yang hilang karena proxying seperti original client/proto/host. Dalam praktik, banyak platform masih memakai `X-Forwarded-*` karena sudah lama menjadi de-facto standard.

## 5.3 Jangan langsung percaya forwarded headers

Header ini dikirim melalui HTTP request. Client bisa mengirimnya sendiri.

Jika aplikasi exposed langsung dan mempercayai:

```http
X-Forwarded-Proto: https
X-Forwarded-Host: secure.example.com
X-Forwarded-For: 127.0.0.1
```

maka attacker bisa memanipulasi:

- redirect target;
- audit IP;
- URL generation;
- allowlist berbasis IP;
- security decision yang salah.

### Rule

```text
Forwarded headers are trustworthy only after a trusted proxy has stripped untrusted inbound values and replaced/appended canonical values.
```

## 5.4 Container configuration concern

Servlet container biasanya perlu konfigurasi agar mengenali forwarded headers.

Contoh konsep, bukan konfigurasi vendor-spesifik:

```text
trusted proxies = 10.0.0.0/8, 172.16.0.0/12
use X-Forwarded-Proto to set request.isSecure()
use X-Forwarded-Host to set serverName
use X-Forwarded-Port to set serverPort
```

Tanpa konfigurasi benar:

- `request.isSecure()` salah;
- redirect salah;
- cookie secure mungkin salah;
- OIDC callback salah;
- HSTS logic salah.

Dengan konfigurasi terlalu permisif:

- client bisa spoof scheme/host/IP.

---

## 6. Forwarded Headers and Client IP Trust

Client IP sering dipakai untuk:

- audit;
- rate limiting;
- fraud detection;
- geo restriction;
- allowlist;
- anomaly detection;
- admin troubleshooting.

Namun, `X-Forwarded-For` bisa berisi chain:

```http
X-Forwarded-For: 198.51.100.23, 10.0.1.12, 10.0.2.34
```

Biasanya kiri adalah original client, kanan adalah proxy terbaru. Tetapi ini hanya benar jika proxy chain dikontrol dan semua proxy mengikuti aturan yang sama.

## 6.1 Anti-pattern: first IP wins

```java
String ip = request.getHeader("X-Forwarded-For").split(",")[0].trim();
```

Ini berbahaya jika aplikasi bisa menerima request dari client langsung atau proxy tidak strip inbound header.

Attacker bisa kirim:

```http
X-Forwarded-For: 127.0.0.1
```

Aplikasi melihat attacker sebagai localhost.

## 6.2 Better model: trusted proxy chain

Pseudocode:

```text
remoteAddr = TCP peer address
if remoteAddr not in trustedProxyRanges:
    clientIp = remoteAddr
else:
    parse X-Forwarded-For from right to left
    remove trusted proxy IPs
    first remaining untrusted IP from right = effective client IP
```

Tapi idealnya ini dilakukan oleh gateway/proxy/container, bukan setiap business service.

## 6.3 IP is context, not identity

IP bukan identity kuat.

IP bisa berubah karena:

- NAT;
- mobile network;
- corporate proxy;
- VPN;
- CDN;
- IPv6 privacy address;
- shared office network.

Gunakan IP untuk risk signal dan audit, bukan sebagai satu-satunya authorization factor untuk aksi sensitif.

---

## 7. Trusted Identity Headers

Dalam pattern gateway-auth, gateway sering meneruskan identity ke aplikasi melalui header.

Contoh:

```http
X-Authenticated-User: fajar@example.com
X-Authenticated-Subject: 248289761001
X-Authenticated-Issuer: https://idp.example.gov
X-Authenticated-Groups: CASE_OFFICER,APPROVER
X-Authenticated-Tenant: agency-a
```

Ini sederhana, tetapi sangat berbahaya jika tidak didesain benar.

## 7.1 Header spoofing

Jika client bisa mengirim header yang sama dan gateway tidak menghapusnya, attacker bisa mengirim:

```http
X-Authenticated-User: admin@example.com
X-Authenticated-Groups: SUPER_ADMIN
```

Jika aplikasi mempercayainya, authentication bypass terjadi.

## 7.2 Minimum safe contract

Gateway harus:

1. Strip semua inbound identity headers dari client.
2. Authenticate caller.
3. Validate token/session/client cert.
4. Normalize identity.
5. Inject identity headers baru.
6. Optionally sign identity envelope.
7. Forward only to private app network.
8. Prevent direct app access.

Application harus:

1. Menerima identity header hanya dari trusted network peer atau mTLS-authenticated gateway.
2. Reject request jika required identity header hilang atau malformed.
3. Tidak mempercayai role/scope sebagai final domain permission.
4. Audit source mechanism: `gateway_header`, issuer, subject, auth time.
5. Apply domain authorization.

## 7.3 Prefer signed internal identity envelope

Daripada banyak header longgar:

```http
X-Authenticated-User: ...
X-Authenticated-Groups: ...
X-Authenticated-Tenant: ...
```

lebih aman memakai envelope yang ditandatangani:

```http
X-Internal-Identity: base64url(json)
X-Internal-Identity-Signature: base64url(hmac-or-signature)
```

Envelope:

```json
{
  "iss": "edge-gateway",
  "aud": "case-service",
  "sub": "248289761001",
  "username": "fajar@example.com",
  "tenant": "agency-a",
  "groups": ["case-officer", "approver"],
  "auth_time": 1760000000,
  "iat": 1760000010,
  "exp": 1760000070,
  "jti": "req-identity-123",
  "source": "oidc"
}
```

Aplikasi memvalidasi:

- signature;
- issuer;
- audience;
- expiry;
- nonce/jti if needed;
- source gateway;
- allowed algorithms;
- key rotation.

Ini mirip short-lived internal token. Jika sudah memakai JWT internal, jangan membuat format custom tanpa alasan kuat.

## 7.4 Header naming convention

Gunakan prefix internal yang tidak mudah bentrok:

```text
X-Internal-Authenticated-Subject
X-Internal-Authenticated-Issuer
X-Internal-Authenticated-Groups
X-Internal-Correlation-Id
```

Tapi nama saja tidak cukup. Security berasal dari strip/replace + trusted channel + validation.

---

## 8. Gateway Authentication vs Application Authentication

## 8.1 App-auth flow

```text
1. Browser hits app.
2. App triggers OIDC login.
3. IdP redirects back to app.
4. App validates ID token/state/nonce.
5. App creates session.
6. App enforces authorization.
```

Aplikasi punya full lifecycle.

## 8.2 Gateway-auth flow

```text
1. Browser hits gateway.
2. Gateway handles OIDC login.
3. Gateway creates edge session.
4. Gateway forwards identity to app.
5. App maps identity to domain actor.
6. App enforces authorization.
```

Aplikasi tidak tahu detail login kecuali diteruskan.

## 8.3 Pertanyaan desain

Sebelum memilih, jawab:

1. Siapa owner login/logout?
2. Siapa owner session?
3. Siapa yang refresh token?
4. Siapa yang menyimpan token?
5. Siapa yang tahu auth time?
6. Siapa yang enforce MFA/step-up?
7. Siapa yang map IdP group ke app role?
8. Siapa yang audit login?
9. Siapa yang audit authorization denial?
10. Siapa yang revoke access saat user disabled?
11. Apa yang terjadi jika gateway unavailable?
12. Apa yang terjadi jika app diakses bypass gateway?

## 8.4 Jangan setengah-setengah tanpa kontrak

Bad pattern:

```text
Gateway sometimes validates token.
App sometimes validates token.
Some endpoints trust headers.
Some endpoints parse JWT.
Some endpoints allow anonymous.
Some internal routes bypass gateway.
```

Ini menghasilkan behavior yang sulit diuji.

Better:

```text
All external requests must enter through gateway.
Gateway validates external authentication.
App validates gateway identity contract.
App owns domain authorization.
Internal service-to-service uses mTLS + short-lived token.
Every endpoint has explicit public/authenticated/admin/internal classification.
```

---

## 9. Token Validation Location

Pertanyaan klasik:

> JWT/token divalidasi di gateway atau di aplikasi?

Jawaban matang: tergantung threat model, tetapi pahami trade-off.

## 9.1 Validate only at gateway

```text
Client -> Gateway validates JWT -> App trusts gateway identity
```

### Pros

- single validation config;
- less duplicated code;
- easier key rotation centrally;
- gateway can rate limit per token/client;
- app code simpler.

### Cons

- app depends on gateway correctness;
- direct app bypass catastrophic;
- app may lose raw claims;
- hard to do fine-grained auth if claims omitted;
- debugging split;
- gateway compromise gives broad impact.

## 9.2 Validate in every application

```text
Client -> Gateway routes -> App validates JWT
```

### Pros

- defense-in-depth;
- app can enforce issuer/audience precisely;
- less trust in gateway;
- direct app access still protected;
- easier domain mapping with full claims.

### Cons

- duplicated validation;
- inconsistent config risk;
- more JWKS/introspection traffic;
- harder centralized revocation;
- more libraries/config to patch.

## 9.3 Hybrid validation

```text
Gateway validates token coarsely.
App validates token or internal identity again for domain context.
```

Recommended untuk high-risk systems:

- gateway validates token for early reject/rate limiting;
- app validates token audience/issuer/signature or validates signed internal identity;
- app enforces domain authorization.

## 9.4 Audience-specific validation

Jangan hanya mengecek signature.

Token valid secara cryptographic belum tentu valid untuk service ini.

Aplikasi harus memeriksa:

```text
iss  = expected issuer
aud  = this API/service
exp  = not expired
nbf  = already valid
iat  = acceptable
azp/client_id = expected client if relevant
scope/groups = mapped carefully
```

Failure umum:

```text
Token issued for frontend-app accepted by admin-api.
```

Ini terjadi karena service hanya cek signature dan expiration.

---

## 10. Servlet Container Boundary

Ketika request mencapai aplikasi Jakarta, container memiliki worldview sendiri:

- request scheme;
- server name;
- port;
- remote address;
- path;
- context path;
- servlet path;
- user principal;
- roles;
- session;
- security constraints.

Gateway/proxy bisa membuat worldview ini salah jika tidak dikonfigurasi.

## 10.1 `request.isSecure()`

Jika TLS terminate sebelum app, `request.isSecure()` bisa `false`.

Dampak:

- app generate HTTP link;
- `CONFIDENTIAL` constraint bisa redirect loop;
- cookie logic salah;
- OIDC redirect wrong scheme;
- CSRF origin mismatch.

## 10.2 `getServerName()` and `getServerPort()`

Proxy host rewrite bisa membuat app melihat internal hostname.

Dampak:

```text
Generated URL: http://case-service.default.svc.cluster.local:8080/callback
Expected URL: https://cases.example.gov/callback
```

## 10.3 `getRemoteAddr()`

Tanpa proxy-aware config, remote address adalah IP proxy, bukan client.

Dampak:

- audit misleading;
- rate limiting salah;
- IP allowlist salah;
- fraud detection melemah.

## 10.4 Context path and path rewrite

Proxy bisa expose:

```text
/public/case-api/** -> backend /
```

Aplikasi melihat path `/cases`, client melihat `/public/case-api/cases`.

Dampak:

- redirect path salah;
- CSRF token path/cookie path salah;
- security constraint mismatch;
- JAX-RS base URI salah;
- OpenAPI docs salah;
- HATEOAS link salah.

## 10.5 Security constraints after rewrite

Jika proxy rewrite path sebelum app, security constraint di app bekerja pada path internal, bukan path eksternal.

Ini bisa aman atau berbahaya tergantung desain.

Example:

```text
External: /admin/reports
Proxy rewrites to internal: /reports
App constraint protects /admin/* only
Result: endpoint unprotected internally
```

Karena itu security classification harus dilakukan berdasarkan canonical route yang dipahami bersama.

---

## 11. Trusted Header Anti-Spoofing Design

## 11.1 Strip before set

Gateway harus menghapus inbound headers yang akan dipakai sebagai trusted headers.

Konsep nginx-like:

```nginx
# conceptual only
proxy_set_header X-Internal-User "";
proxy_set_header X-Internal-Roles "";

# after auth success
proxy_set_header X-Internal-User $authenticated_user;
proxy_set_header X-Internal-Roles $authenticated_roles;
```

Lebih baik jika gateway tidak bisa meneruskan header client dengan nama yang sama.

## 11.2 Deny direct app access

Network control:

```text
Only gateway subnet/security group can connect to app port.
```

Kubernetes control:

```text
NetworkPolicy allows ingress to pod only from ingress-controller namespace/service account.
```

Cloud control:

```text
Private target group only.
No public NodePort.
No public service load balancer for app.
```

## 11.3 mTLS between gateway and app

Jika high assurance diperlukan:

```text
Gateway --mTLS--> App
```

App memvalidasi gateway certificate.

Manfaat:

- app tahu request benar dari gateway;
- header identity lebih bisa dipercaya;
- internal network spoof lebih sulit;
- audit gateway identity kuat.

## 11.4 Signed identity token

Jika tidak bisa bergantung penuh pada network boundary, gunakan internal signed token.

```text
Gateway validates external token.
Gateway issues short-lived internal token for app.
App validates internal token.
```

Internal token harus:

- short-lived;
- audience-specific;
- signed with key only gateway controls;
- include original issuer/sub;
- include auth method;
- include tenant context only if verified;
- not include excessive PII;
- have replay-resistance where required.

---

## 12. Identity Propagation to Jakarta Security

Jika gateway sudah authenticate, bagaimana aplikasi Jakarta mengenal caller sebagai `Principal` dan roles?

Ada beberapa opsi.

## 12.1 Plain filter sets request attribute

```java
public class GatewayIdentityFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest http = (HttpServletRequest) req;

        String subject = http.getHeader("X-Internal-Subject");
        String issuer = http.getHeader("X-Internal-Issuer");

        if (subject == null || issuer == null) {
            ((HttpServletResponse) res).sendError(401);
            return;
        }

        Actor actor = Actor.fromGateway(subject, issuer);
        http.setAttribute("actor", actor);
        chain.doFilter(req, res);
    }
}
```

### Kelemahan

- tidak mengisi container principal;
- `request.getUserPrincipal()` tetap null;
- `@RolesAllowed` mungkin tidak bekerja;
- JAX-RS `SecurityContext` tidak otomatis tahu;
- security menjadi custom attribute saja.

Ini cukup untuk aplikasi yang semua authorization-nya custom domain layer, tetapi tidak cukup jika ingin integrasi container.

## 12.2 Request wrapper

Filter membungkus `HttpServletRequest`:

```java
public final class AuthenticatedRequest extends HttpServletRequestWrapper {
    private final Principal principal;
    private final Set<String> roles;

    public AuthenticatedRequest(HttpServletRequest request, Principal principal, Set<String> roles) {
        super(request);
        this.principal = principal;
        this.roles = Set.copyOf(roles);
    }

    @Override
    public Principal getUserPrincipal() {
        return principal;
    }

    @Override
    public boolean isUserInRole(String role) {
        return roles.contains(role);
    }
}
```

### Kelebihan

- code yang memanggil `getUserPrincipal()` melihat identity;
- JAX-RS mungkin bisa mengambil dari request;
- sederhana.

### Kelemahan

- belum tentu menyatu dengan container-managed security;
- `@RolesAllowed` container/EJB/CDI mungkin tetap tidak bekerja;
- role mapping bisa inconsistent;
- behavior vendor/container-dependent.

## 12.3 Jakarta Security `HttpAuthenticationMechanism`

Implement custom mechanism yang membaca trusted gateway identity dan mengembalikan `AuthenticationStatus.SUCCESS` dengan principal/groups.

Konsep:

```java
@ApplicationScoped
public class GatewayHeaderAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    private IdentityStoreHandler identityStoreHandler;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        GatewayIdentity identity = parseAndValidateGatewayIdentity(request);

        if (identity == null) {
            return context.responseUnauthorized();
        }

        CredentialValidationResult result = new CredentialValidationResult(
                new CallerPrincipal(identity.subject()),
                identity.groups()
        );

        return context.notifyContainerAboutLogin(result);
    }
}
```

### Kelebihan

- lebih native Jakarta Security;
- container tahu caller principal/groups;
- `SecurityContext` lebih konsisten;
- bisa dipadukan dengan role checks.

### Kelemahan

- harus hati-hati validasi trusted source;
- behavior tergantung support container;
- multiple auth mechanism harus didesain eksplisit;
- gateway header parsing menjadi authentication mechanism.

## 12.4 Jakarta Authentication/JASPIC

Untuk integrasi container paling low-level, implement JASPIC `ServerAuthModule`.

Cocok jika:

- perlu portability di container tertentu;
- integrasi dengan auth module enterprise;
- gateway identity harus masuk sebagai container caller principal/groups;
- butuh callback seperti `CallerPrincipalCallback`, `GroupPrincipalCallback`.

Lebih kompleks daripada Jakarta Security, tetapi lebih dekat dengan contract container.

---

## 13. Authorization Split: Gateway vs Application

Authorization harus dibagi menurut level abstraksi.

## 13.1 Gateway cocok untuk coarse-grained checks

Gateway bisa enforce:

```text
route requires authenticated user
route requires token audience api://case-service
route requires scope case.read
route requires client type internal
route requires mTLS client certificate
route requires IP range for admin console
rate limit per client_id
block suspicious country/IP
```

## 13.2 Application wajib untuk fine-grained checks

Aplikasi harus enforce:

```text
user can view this exact case
user belongs to active tenant
user is assigned officer
case state allows approval
user is not the maker
delegation still active
document classification allows access
field-level redaction applies
quota/business rule applies
```

## 13.3 PEP/PDP model

```text
PEP = Policy Enforcement Point
PDP = Policy Decision Point
```

Gateway bisa menjadi PEP untuk route-level policy.
Aplikasi bisa menjadi PEP untuk domain-level policy.
PDP bisa berada di aplikasi, central policy service, OPA-like engine, atau rules engine.

Mental model:

```text
Gateway asks: May this caller enter this route?
Application asks: May this actor perform this action on this resource now?
```

## 13.4 Avoid double-negative gaps

Gap sering terjadi jika dua layer masing-masing mengira layer lain bertanggung jawab.

```text
Gateway: I only authenticate.
App: Gateway already handles security.
Result: no one checks resource permission.
```

Solusi: tulis responsibility matrix.

| Concern | Gateway | App | Notes |
|---|---:|---:|---|
| TLS public termination | Yes | No | App may use internal TLS |
| JWT signature validation | Yes | Optional/Yes | Prefer hybrid for high risk |
| Audience check | Yes | Yes | App checks service-specific aud |
| Route scope | Yes | Optional | Defense-in-depth |
| Tenant membership | Maybe | Yes | App needs domain data |
| Case assignment | No | Yes | Domain logic |
| Maker-checker | No | Yes | Domain logic |
| Audit login | Yes | Maybe | Depending owner |
| Audit business authorization | No | Yes | Must be app/PDP |
| Rate limiting | Yes | Maybe | App can add domain quota |

---

## 14. Internal Endpoints and Bypass Risk

A common production incident:

```text
/admin/reindex
/internal/sync
/actuator/env
/metrics
/debug/session
```

Endpoint dianggap internal karena “tidak ada link di UI” atau “hanya dipanggil cron”. Tetapi route publik atau gateway misconfiguration membuatnya accessible.

## 14.1 Classify every endpoint

Gunakan classification:

```text
PUBLIC_ANONYMOUS
PUBLIC_AUTHENTICATED
PUBLIC_ADMIN
INTERNAL_SERVICE
INTERNAL_OPERATOR
HEALTH_PUBLIC
HEALTH_PRIVATE
```

Setiap endpoint harus punya classification eksplisit.

Contoh:

| Endpoint | Classification | Required Controls |
|---|---|---|
| `/login` | PUBLIC_ANONYMOUS | CSRF/open redirect protection |
| `/api/cases/{id}` | PUBLIC_AUTHENTICATED | token/session + domain auth |
| `/api/admin/users` | PUBLIC_ADMIN | admin role + MFA/step-up |
| `/internal/jobs/retry` | INTERNAL_OPERATOR | private network + mTLS + admin/service identity |
| `/actuator/health/liveness` | HEALTH_PUBLIC | no sensitive detail |
| `/actuator/env` | INTERNAL_OPERATOR | usually disable or protect strongly |

## 14.2 Internal endpoint should not rely only on path name

`/internal/**` is not internal unless:

- gateway blocks it from public;
- network policy blocks it;
- app requires service identity;
- app validates mTLS/token;
- audit logs access.

## 14.3 Health endpoint nuance

Health endpoint design:

```text
/livez  -> public/minimal, no dependency detail
/readyz -> maybe internal, minimal
/health/details -> internal only, authenticated
```

Do not expose:

- database host;
- version with vulnerable dependencies;
- environment variables;
- config values;
- feature flags;
- secret names;
- downstream topology.

---

## 15. Host Header and Redirect Security

Host header matters for:

- absolute URL generation;
- password reset links;
- OIDC redirect URI;
- email links;
- canonical redirects;
- tenant resolution by subdomain;
- CORS origin matching.

## 15.1 Host header poisoning

If app builds absolute URL from unvalidated Host:

```java
String baseUrl = request.getScheme() + "://" + request.getHeader("Host");
String resetLink = baseUrl + "/reset?token=" + token;
```

Attacker sends:

```http
Host: attacker.example
```

Victim receives reset link pointing to attacker domain.

## 15.2 Mitigation

Use configured public base URL:

```text
APP_PUBLIC_BASE_URL=https://cases.example.gov
```

or strict host allowlist:

```text
allowed hosts:
- cases.example.gov
- admin-cases.example.gov
```

Gateway should reject unknown host.
Application should reject unknown host for security-sensitive flows.

## 15.3 Tenant by host

If tenant resolved by subdomain:

```text
agency-a.cases.example.gov -> tenant agency-a
```

Then Host header becomes security input. It must be canonicalized and validated.

Never let arbitrary Host determine tenant without allowlist.

---

## 16. Path Rewriting and Authorization Confusion

Proxy rewrite can break security assumptions.

## 16.1 Example

External:

```text
/admin/users
```

Internal:

```text
/users
```

App security constraint:

```xml
<url-pattern>/admin/*</url-pattern>
```

If app only sees `/users`, the constraint never fires.

## 16.2 Better designs

Option A: no rewrite for security-relevant prefix.

```text
External /admin/users -> Internal /admin/users
```

Option B: app constraints match internal canonical path.

```text
External /admin/users -> Internal /users
App protects /users based on route metadata, not /admin prefix.
```

Option C: gateway and app both have explicit route classification registry.

```yaml
routes:
  usersAdmin:
    external: /admin/users
    internal: /users
    classification: PUBLIC_ADMIN
```

## 16.3 Security review question

For every protected endpoint, ask:

```text
What path does the client call?
What path does the gateway see?
What path does the app see?
What path do Servlet constraints use?
What path do JAX-RS resources use?
What path do logs show?
```

If the answers differ, document the mapping.

---

## 17. CORS at Gateway vs Application

CORS often implemented at gateway for consistency. But CORS is not authentication and not authorization.

## 17.1 CORS responsibility split

Gateway can:

- reject disallowed origins;
- handle preflight;
- standardize headers;
- prevent duplicated CORS headers;
- enforce allowed methods.

Application should:

- not assume CORS protects APIs;
- still authenticate every request;
- still authorize every action;
- avoid exposing credentials to broad origins;
- align session cookie SameSite behavior.

## 17.2 CORS anti-patterns

Bad:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Bad:

```text
Reflect any Origin header as allowed origin.
```

Bad:

```text
Allow all headers including Authorization from arbitrary origins.
```

Bad:

```text
Assume no CORS means no attack. Non-browser clients ignore CORS.
```

## 17.3 Gateway/app duplication

If both gateway and app add CORS headers, browser behavior may become unpredictable.

Choose single owner:

```text
CORS owner = gateway
App does not emit CORS headers except in local/dev profile
```

or:

```text
CORS owner = app
Gateway passes through and does not override
```

---

## 18. Security Response Headers at Proxy Boundary

Security headers can be set at gateway or app.

Common headers:

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: ...
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: ...
Cache-Control: no-store
```

OWASP maintains guidance on security response headers. The important architectural point: ownership must be explicit.

## 18.1 Gateway-owned headers

Good for:

- HSTS;
- X-Content-Type-Options;
- default frame policy;
- removing server banners;
- common cache policy for sensitive routes.

## 18.2 App-owned headers

Good for:

- route-specific CSP;
- file download content disposition;
- cache behavior for data-specific response;
- iframe allowance for specific flows;
- login-specific no-store.

## 18.3 Avoid header conflict

Example conflict:

```text
Gateway: X-Frame-Options: DENY
App: CSP frame-ancestors https://partner.example
```

Result can break legitimate embedding or create ambiguous policy.

Create a header responsibility matrix.

---

## 19. Rate Limiting and Abuse Control

Gateway is usually best place for generic rate limiting:

- per IP;
- per client ID;
- per user;
- per token subject;
- per route;
- per API key;
- per tenant.

Application is better for domain-specific limits:

- max approval attempts;
- max failed OTP attempts;
- max password reset requests per account;
- max case search result size;
- max export per day;
- max delegated action;
- workflow-specific throttling.

## 19.1 Wrong key problem

If gateway rate limits by IP behind corporate NAT, many users share one limit.

If gateway rate limits by token subject, unauthenticated endpoints still need IP/device/risk-based limits.

If app rate limits by username before normalization, attacker bypasses via case/space variations.

## 19.2 Trusting client IP

Rate limiting based on `X-Forwarded-For` is only as strong as your proxy trust configuration.

## 19.3 Body size and resource exhaustion

Gateway/proxy should enforce:

- max body size;
- max header size;
- max URL length;
- upload limits;
- request timeout;
- connection timeout;
- slowloris mitigation;
- compression bomb controls.

Application should still validate:

- DTO sizes;
- list limits;
- pagination max;
- upload type;
- decompressed size;
- JSON/XML nesting depth where relevant.

---

## 20. Service-to-Service Calls Through Gateway or Direct?

There are two patterns.

## 20.1 Internal calls through gateway

```text
Service A -> Internal Gateway -> Service B
```

Pros:

- centralized policy;
- observability;
- consistent token validation;
- rate limiting;
- easier routing.

Cons:

- latency;
- gateway bottleneck;
- coupling;
- possible header identity confusion;
- gateway must handle internal auth semantics.

## 20.2 Direct service-to-service

```text
Service A -> Service B
```

Security requires:

- mTLS or workload identity;
- service token;
- user identity propagation if on-behalf-of;
- audience-specific token;
- downstream authorization;
- trace/audit.

## 20.3 User identity vs service identity

Downstream call should preserve distinction:

```json
{
  "service": "case-service",
  "actor": "user:248289761001",
  "tenant": "agency-a",
  "on_behalf_of": true,
  "request_id": "req-123"
}
```

Never collapse everything into service account unless the action is truly system-owned.

---

## 21. App Switcher and Cross-Application SSO Boundary

Dalam enterprise, user sering pindah antar aplikasi:

```text
App A -> App Switcher -> App B
```

Boundary concern:

- apakah App B authenticate ulang melalui IdP?
- apakah App A meneruskan token ke App B?
- apakah ada token exchange?
- apakah session App A dipercaya oleh App B?
- apakah logout global?
- apakah role App A sama dengan role App B?

## 21.1 Safer model

```text
App B should authenticate user with IdP or trusted gateway, not blindly trust App A session.
```

If token handoff exists, use:

- authorization code flow / OIDC redirect;
- token exchange;
- short-lived one-time handoff token;
- strict audience;
- nonce/state;
- replay prevention.

## 21.2 Dangerous model

```text
App A redirects to App B with ?user=fajar&roles=admin
```

or:

```text
App A sets shared cookie for App B without proper domain/session isolation.
```

This creates privilege escalation and session confusion.

---

## 22. Gateway and Jakarta Security Integration Patterns

## 22.1 Pattern: Gateway passes JWT, app validates JWT

```text
Authorization: Bearer <access_token>
```

App implements:

- Servlet Filter;
- JAX-RS filter;
- Jakarta Security mechanism;
- MicroProfile JWT if available.

Best for APIs.

## 22.2 Pattern: Gateway validates JWT, app validates internal JWT

```text
External JWT -> Gateway -> Internal JWT -> App
```

Internal JWT claims:

```json
{
  "iss": "gateway",
  "aud": "case-service",
  "sub": "external-issuer|external-sub",
  "external_iss": "https://idp.example",
  "external_sub": "248289761001",
  "tenant": "agency-a",
  "groups": ["case-officer"],
  "exp": 1760000070
}
```

Best for centralized auth with app-side validation.

## 22.3 Pattern: Gateway session, app session

Gateway authenticates browser and forwards identity. App creates its own session.

Pros:

- app can store local authorization snapshot;
- app can use Servlet session;
- app can implement local timeout.

Cons:

- logout coordination difficult;
- role changes need refresh/revalidation;
- session fixation and stale session concerns.

## 22.4 Pattern: Gateway session only, app stateless

Gateway manages session cookie. App receives identity every request.

Pros:

- app stateless;
- horizontal scaling easier;
- single session owner.

Cons:

- app depends heavily on gateway;
- per-request identity validation required;
- app local step-up harder;
- domain permission cache must be external or request-scoped.

---

## 23. Practical Java/Jakarta Implementation: Gateway Header Authentication Mechanism

Below is a conceptual example. Production code must include stricter validation, metrics, logging, key management, and container-specific testing.

```java
package com.example.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.security.enterprise.AuthenticationException;
import jakarta.security.enterprise.CallerPrincipal;
import jakarta.security.enterprise.authentication.mechanism.http.AuthenticationStatus;
import jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import jakarta.security.enterprise.authentication.mechanism.http.HttpMessageContext;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.util.Set;

@ApplicationScoped
public class GatewayHeaderAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context
    ) throws AuthenticationException {

        // 1. Verify this request really came from a trusted gateway.
        //    In real production, do not rely only on a header.
        //    Use network policy, mTLS, or signed internal token.
        if (!isFromTrustedGateway(request)) {
            return context.responseUnauthorized();
        }

        // 2. Parse trusted identity envelope/header.
        String subject = request.getHeader("X-Internal-Subject");
        String issuer = request.getHeader("X-Internal-Issuer");
        String groupsHeader = request.getHeader("X-Internal-Groups");

        if (isBlank(subject) || isBlank(issuer)) {
            return context.responseUnauthorized();
        }

        // 3. Normalize and validate identity.
        String stableName = issuer + "|" + subject;
        Set<String> groups = parseGroups(groupsHeader);

        // 4. Notify Jakarta container.
        CredentialValidationResult result = new CredentialValidationResult(
                new CallerPrincipal(stableName),
                groups
        );

        return context.notifyContainerAboutLogin(result);
    }

    private boolean isFromTrustedGateway(HttpServletRequest request) {
        // Conceptual only.
        // Real implementation should validate:
        // - remote address is from trusted proxy range, AND/OR
        // - mTLS client certificate identity, AND/OR
        // - signed internal identity token.
        String remote = request.getRemoteAddr();
        return remote != null && (remote.startsWith("10.") || remote.startsWith("172.16."));
    }

    private Set<String> parseGroups(String groupsHeader) {
        if (groupsHeader == null || groupsHeader.isBlank()) {
            return Set.of();
        }
        return Set.of(groupsHeader.split(","));
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
```

### Important caveat

`remoteAddr.startsWith("10.")` is not production-grade. It is only to show where the trust check lives. Production code should use proper CIDR matching or, better, mTLS/signed envelope.

---

## 24. Better Implementation: Signed Internal Identity Token

Conceptual validator:

```java
public final class InternalIdentity {
    private final String issuer;
    private final String audience;
    private final String subject;
    private final String externalIssuer;
    private final String externalSubject;
    private final String tenant;
    private final Set<String> groups;

    // constructor/getters omitted
}
```

Authentication mechanism:

```java
@ApplicationScoped
public class InternalJwtAuthenticationMechanism implements HttpAuthenticationMechanism {

    private final InternalTokenVerifier verifier = new InternalTokenVerifier();

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context
    ) throws AuthenticationException {

        String token = request.getHeader("X-Internal-Identity-Token");
        if (token == null || token.isBlank()) {
            return context.responseUnauthorized();
        }

        InternalIdentity identity;
        try {
            identity = verifier.verify(token, "case-service");
        } catch (InvalidInternalTokenException e) {
            return context.responseUnauthorized();
        }

        CredentialValidationResult result = new CredentialValidationResult(
                new CallerPrincipal(identity.getExternalIssuer() + "|" + identity.getExternalSubject()),
                identity.getGroups()
        );

        request.setAttribute("tenant", identity.getTenant());
        request.setAttribute("externalIssuer", identity.getExternalIssuer());
        request.setAttribute("externalSubject", identity.getExternalSubject());

        return context.notifyContainerAboutLogin(result);
    }
}
```

Verifier must validate:

```text
signature
issuer = gateway
audience = this service
expiration short
not-before
issued-at skew
algorithm allowlist
key id known
required claims
tenant syntax
group syntax
replay if high-risk
```

---

## 25. Observability and Audit Across Gateway Boundary

Security across proxy layers is impossible to debug without correlated logs.

## 25.1 Required IDs

At minimum:

```text
correlation_id / request_id
trace_id
gateway_request_id
application_request_id
external_subject
internal_subject
tenant
client_id
issuer
audience
source_ip_effective
source_ip_chain
route_id
auth_method
authorization_decision
```

## 25.2 Do not log secrets

Never log:

- access token;
- refresh token;
- ID token raw;
- session cookie;
- authorization header;
- internal identity token raw;
- client certificate private key;
- password;
- OTP;
- reset token.

Log token metadata:

```text
issuer, subject hash, audience, client_id, jti, exp, kid
```

## 25.3 Audit actor chain

For downstream actions, log:

```json
{
  "event": "CASE_APPROVED",
  "actor_type": "USER",
  "actor_subject": "hash(issuer|sub)",
  "executing_service": "case-service",
  "gateway": "edge-gateway-a",
  "tenant": "agency-a",
  "resource": "case:123",
  "decision": "ALLOW",
  "policy": "case.approve.v3",
  "request_id": "req-123"
}
```

This makes forensic reconstruction possible.

---

## 26. Failure Modelling

## 26.1 Direct app bypass

### Scenario

Gateway validates auth, app trusts headers. But app service is accidentally exposed through public load balancer.

### Attack

Attacker sends:

```http
GET /api/admin/users
X-Internal-Subject: attacker
X-Internal-Groups: SUPER_ADMIN
```

### Mitigation

- private network only;
- security group restrict source;
- Kubernetes NetworkPolicy;
- app validates mTLS/signed internal token;
- app rejects unsigned header identity;
- external scans for exposed services.

## 26.2 Header spoofing through gateway

### Scenario

Gateway authenticates user but does not strip inbound `X-Internal-Groups`.

### Attack

Client sends:

```http
X-Internal-Groups: ADMIN
```

Gateway appends or forwards. App sees ADMIN.

### Mitigation

- strip all internal headers at edge;
- use denylist plus allowlist;
- inject identity with canonical names;
- sign identity envelope;
- add integration test.

## 26.3 Wrong audience accepted

### Scenario

App validates JWT signature but not audience.

### Attack

Token for low-risk app accepted by high-risk API.

### Mitigation

- app checks `aud` equals service;
- gateway checks route-specific audience;
- token exchange for downstream service;
- contract tests.

## 26.4 Scheme confusion breaks OIDC

### Scenario

TLS terminates at LB; app sees HTTP.

### Symptoms

- redirect_uri mismatch;
- secure cookie not set;
- infinite redirect loop;
- IdP callback rejected.

### Mitigation

- proper forwarded header config;
- trusted proxy ranges;
- configured public base URL;
- integration test behind proxy.

## 26.5 Host header poisoning

### Scenario

App generates password reset link using Host header.

### Attack

Attacker sends Host `evil.example`, app emails reset link with evil domain.

### Mitigation

- configured external base URL;
- host allowlist;
- gateway rejects unknown host;
- do not trust Host for security links.

## 26.6 Internal endpoint exposed

### Scenario

`/internal/retry-failed-events` route accidentally public.

### Impact

- replay jobs;
- mass email resend;
- workflow corruption;
- data export;
- system state mutation.

### Mitigation

- endpoint classification;
- gateway route deny;
- app-level service auth;
- mTLS;
- audit;
- negative tests.

## 26.7 Proxy path rewrite bypass

### Scenario

App protects `/admin/*`, but proxy rewrites `/admin/users` to `/users`.

### Mitigation

- avoid rewrite for protected prefixes;
- align app constraints with internal path;
- route classification registry;
- test external and internal paths.

## 26.8 Stale role at gateway

### Scenario

Gateway caches user groups for 1 hour. User admin role revoked. App trusts gateway groups.

### Mitigation

- short cache TTL;
- role version claim;
- introspection for sensitive actions;
- app rechecks domain permissions;
- revocation event propagation.

---

## 27. Security Review Checklist

Use this during architecture review.

## 27.1 Network and exposure

- [ ] Can application port be reached from internet directly?
- [ ] Are security groups/firewalls restricted to gateway/proxy only?
- [ ] Is Kubernetes NetworkPolicy configured?
- [ ] Are internal endpoints exposed through ingress accidentally?
- [ ] Are admin/actuator endpoints private and authenticated?
- [ ] Are health endpoints minimal?

## 27.2 TLS and scheme

- [ ] Where does public TLS terminate?
- [ ] Is internal hop encrypted if required?
- [ ] Does app know original scheme correctly?
- [ ] Is `request.isSecure()` correct behind proxy?
- [ ] Are secure cookies always secure?
- [ ] Is HSTS configured at correct layer?

## 27.3 Forwarded headers

- [ ] Does proxy strip inbound `Forwarded`/`X-Forwarded-*` headers or append safely?
- [ ] Does app trust forwarded headers only from trusted proxy?
- [ ] Is client IP derivation centralized?
- [ ] Are logs clear about proxy chain?
- [ ] Is Host header validated?

## 27.4 Identity headers

- [ ] Are inbound identity headers stripped at edge?
- [ ] Are internal identity headers injected only after successful auth?
- [ ] Does app validate source gateway?
- [ ] Is identity envelope signed or protected by mTLS/private network?
- [ ] Are issuer/subject/audience included?
- [ ] Are tenant and group claims validated?
- [ ] Are raw external groups mapped before business use?

## 27.5 Token validation

- [ ] Is issuer validated?
- [ ] Is audience validated?
- [ ] Is signature validated?
- [ ] Is algorithm allowlisted?
- [ ] Is `kid` key rotation handled?
- [ ] Are `exp`, `nbf`, `iat` checked with sane skew?
- [ ] Are scopes/roles mapped correctly?
- [ ] Is ID token not used as API access token?
- [ ] Is opaque token introspection cached safely?

## 27.6 Authorization

- [ ] What does gateway authorize?
- [ ] What does app authorize?
- [ ] Are route-level and domain-level policies both present?
- [ ] Is default deny applied?
- [ ] Are tenant/resource/state checks in app?
- [ ] Are admin endpoints step-up/MFA protected where needed?
- [ ] Are negative tests present?

## 27.7 Routing and rewrite

- [ ] Are external paths and internal paths documented?
- [ ] Do security constraints match internal paths?
- [ ] Are rewritten paths logged clearly?
- [ ] Are forbidden paths blocked before rewrite?
- [ ] Are trailing slash/case normalization issues handled?

## 27.8 Observability

- [ ] Is correlation ID propagated?
- [ ] Is gateway request ID logged?
- [ ] Is effective client IP logged safely?
- [ ] Is actor identity logged as stable hash/ID, not PII-heavy data?
- [ ] Are auth failures distinguishable?
- [ ] Are authorization denials audited?
- [ ] Are token/session secrets redacted?

## 27.9 Operational readiness

- [ ] Are gateway config changes reviewed like code?
- [ ] Are security route rules tested in CI/CD?
- [ ] Is there rollback plan for auth config?
- [ ] Are JWKS/key rotation runbooks tested?
- [ ] Are cert rotation runbooks tested?
- [ ] Are WAF/gateway false positives monitored?
- [ ] Is there emergency bypass process with audit?

---

## 28. Testing Strategy

## 28.1 Unit tests

Test app-level parsers:

- signed identity token validation;
- issuer/audience checks;
- group mapping;
- tenant validation;
- Host allowlist;
- path classification.

## 28.2 Integration tests behind proxy

Run app behind a proxy in test environment.

Test:

- original scheme detection;
- redirect URI generation;
- secure cookie;
- forwarded host;
- client IP parsing;
- path rewrite;
- identity header injection;
- stripping spoofed headers.

## 28.3 Negative security tests

Send spoofed headers:

```http
X-Internal-Subject: admin
X-Forwarded-For: 127.0.0.1
X-Forwarded-Proto: https
Host: attacker.example
```

Expected:

- rejected;
- ignored;
- overwritten;
- logged safely.

## 28.4 Bypass tests

Attempt direct access:

```text
curl http://app-service:8080/api/admin/users
```

From:

- internet;
- same VPC;
- same Kubernetes namespace;
- different namespace;
- bastion;
- CI runner.

Expected: blocked unless explicitly allowed.

## 28.5 Contract tests gateway/app

Define expected headers:

```yaml
identityContract:
  required:
    - X-Internal-Identity-Token
  forbiddenFromClient:
    - X-Internal-Subject
    - X-Internal-Groups
  issuer: edge-gateway
  audience: case-service
  maxTokenTtlSeconds: 60
```

Test both gateway and app against this contract.

---

## 29. Java 8–25 Considerations

## 29.1 Java 8 legacy stacks

Java 8 era apps often use:

- Java EE 7/8;
- `javax.servlet.*`;
- older app servers;
- manual filters;
- vendor-specific valves;
- Spring Security older versions;
- custom SSO filters.

Boundary risk:

- insecure defaults;
- legacy TLS settings;
- old JWT libraries;
- manual `X-Forwarded-For` parsing;
- no built-in OIDC mechanism;
- weaker SameSite support depending container.

## 29.2 Java 11/17 transition

Many enterprise apps modernize to:

- Jakarta namespace migration;
- updated Servlet containers;
- better TLS defaults;
- stronger crypto providers;
- modern OIDC/JWT libraries;
- container support for forwarded headers.

Still, proxy trust remains architectural, not language-version-only.

## 29.3 Java 21–25

Java 21+ introduces stronger platform maturity for virtual threads, structured concurrency previews in some versions, and modern runtime behavior. But gateway boundary concerns remain the same.

Potential improvements:

- cheaper per-request blocking validation when using virtual threads;
- better structured request handling;
- better observability integration;
- modern containers aligned with Jakarta EE 11.

Potential new risk:

- context propagation assumptions break if code assumed thread affinity;
- security MDC leaks if not cleared;
- async/virtual-thread boundary loses caller unless explicitly propagated.

## 29.4 `javax` vs `jakarta`

Concepts are stable:

```text
javax.servlet.http.HttpServletRequest
jakarta.servlet.http.HttpServletRequest
```

But package names differ. Migration can break filters, annotations, container integration, and security modules if dependencies are mixed.

Do not mix `javax.servlet` app code with Jakarta EE 10/11 container APIs unless compatibility layer explicitly supports it.

---

## 30. Architecture Decision Framework

When designing gateway/proxy boundary, choose explicitly.

## 30.1 Questions

1. Is this browser app, API, or service-to-service?
2. Is authentication session-based, token-based, mTLS, or hybrid?
3. Who owns login/logout?
4. Who validates token?
5. Who owns role mapping?
6. Who owns domain authorization?
7. How is tenant determined?
8. Can app be reached without gateway?
9. Are identity headers signed or channel-protected?
10. What happens if gateway misconfigures a route?
11. What happens if forwarded headers are spoofed?
12. How do we test bypass?
13. How do we audit actor chain?

## 30.2 Recommended default for enterprise Jakarta APIs

For high-assurance systems:

```text
External client
  -> Gateway validates external authentication/token
  -> Gateway strips inbound trusted headers
  -> Gateway injects signed short-lived internal identity token
  -> App validates internal token issuer/audience/signature/expiry
  -> App reconstructs Principal/Actor
  -> App enforces domain authorization
  -> App audits decision
  -> Downstream call uses audience-specific token or mTLS + on-behalf-of context
```

This gives:

- centralized early rejection;
- app-side assurance;
- strong trust contract;
- domain-level security;
- better auditability.

## 30.3 Recommended default for server-rendered Jakarta app

```text
Gateway/LB handles TLS and routing only
App handles OIDC login via Jakarta Security
App creates Servlet session
App validates domain authorization
Gateway strips dangerous headers and sets secure headers
App configured with public base URL / trusted proxy
```

## 30.4 Recommended default for internal service endpoint

```text
No public ingress
mTLS or service token required
Audience-specific internal token
No user identity inferred from network alone
Domain action includes service actor and original user if applicable
Audit system/user distinction
```

---

## 31. Production Runbook: Debugging Boundary Security

## 31.1 User cannot login after proxy change

Check:

- `X-Forwarded-Proto`;
- trusted proxy config;
- public base URL;
- OIDC redirect URI;
- cookie domain/path/secure;
- SameSite;
- session stickiness;
- callback route;
- gateway path rewrite;
- IdP registered redirect URI.

## 31.2 User gets 401 from app but gateway says auth success

Check:

- identity header missing;
- gateway did not inject for route;
- app expects internal token audience mismatch;
- clock skew;
- app cannot fetch JWKS;
- header stripped by intermediate proxy;
- mTLS between gateway/app failed;
- app direct path not through auth plugin.

## 31.3 User gets 403 but should have access

Check:

- group mapping;
- role normalization;
- tenant context;
- stale role cache;
- gateway route scope;
- app domain permission;
- active organization;
- resource state;
- assignment/delegation validity.

## 31.4 Audit shows proxy IP only

Check:

- forwarded header config;
- trusted proxy ranges;
- app logging effective IP vs remoteAddr;
- gateway log correlation;
- CDN/WAF header chain.

## 31.5 Password reset link has internal hostname

Check:

- app base URL;
- Host header trust;
- forwarded host config;
- proxy rewrite;
- external URL generation utility.

---

## 32. Common Anti-Patterns

## 32.1 “Gateway already authenticates, so app has no security”

Wrong. App still needs authorization and must validate gateway trust.

## 32.2 “Internal network means trusted”

Wrong. Internal networks contain compromised workloads, misrouted traffic, test tools, batch jobs, and humans.

## 32.3 “Header exists, therefore identity is valid”

Wrong. Header is just input unless source and integrity are verified.

## 32.4 “JWT signature valid, therefore access allowed”

Wrong. Need issuer, audience, expiry, token type, scope/role mapping, tenant/resource permission.

## 32.5 “CORS protects API”

Wrong. CORS is browser policy. Non-browser clients ignore it.

## 32.6 “IP allowlist is enough”

Usually wrong. IP is context, not strong identity.

## 32.7 “Path prefix means internal”

Wrong unless routing/network/app policy enforces it.

## 32.8 “Proxy rewrite is transparent”

Not for security constraints, redirects, audit, cookies, OIDC, or routing.

## 32.9 “All services can share one internal token audience”

Dangerous. Audience should be service-specific to prevent token replay across services.

## 32.10 “Gateway config is ops-only, not application security”

Wrong. Gateway config is part of application security architecture and must be reviewed/tested.

---

## 33. Minimal Reference Architecture

```text
                        +------------------+
                        | Identity Provider|
                        +---------+--------+
                                  |
                                  | OIDC/OAuth2/SAML
                                  v
+--------+    HTTPS     +---------+---------+      mTLS/private       +--------------------+
| Client | -----------> | Gateway / WAF /  | ----------------------> | Jakarta Application |
+--------+              | Reverse Proxy    |                         | Servlet/JAX-RS      |
                        +---------+---------+                         +---------+----------+
                                  |                                             |
                                  | logs                                        | domain auth
                                  v                                             v
                           +------+-------+                              +------+-------+
                           | Audit/Logs  | <--------------------------- | Domain/Audit |
                           +--------------+                              +--------------+
```

Security contract:

```text
Gateway:
- terminates public TLS
- validates external token/session
- strips inbound internal headers
- injects signed internal identity token
- enforces coarse route policy
- rate limits
- emits gateway audit

Jakarta App:
- accepts traffic only from gateway
- validates internal identity token or mTLS source
- maps subject to Actor
- enforces domain authorization
- performs tenant/resource/state checks
- emits business audit
- propagates safe identity downstream
```

---

## 34. Mental Model Summary

Boundary security is about making trust explicit.

Bad model:

```text
There is a gateway, so we are safe.
```

Good model:

```text
Every request crosses a boundary.
At each boundary we define what is authenticated, what is authorized, what is transformed, what is trusted, what is stripped, what is logged, and what fails closed.
```

For Jakarta applications, the key is aligning infrastructure-level identity with container/application-level identity:

```text
Gateway identity -> Jakarta caller principal/groups -> domain actor -> authorization decision -> audit event
```

The strongest designs avoid both extremes:

- not everything in gateway;
- not everything in app;
- not blind trust in headers;
- not duplicated inconsistent validation.

Instead:

```text
Gateway handles edge authentication and coarse control.
Application handles verified identity reconstruction and domain authorization.
Infrastructure prevents bypass.
Audit proves what happened.
Tests prove what cannot happen.
```

---

## 35. Key Takeaways

1. API gateway and reverse proxy are not automatically security boundaries.
2. Trust begins only after authentication, source validation, header stripping, and explicit contract.
3. Forwarded headers are dangerous unless handled only from trusted proxy chain.
4. TLS termination affects Servlet `isSecure`, redirect URI, cookie security, and OIDC flows.
5. Gateway-auth requires strong identity propagation design.
6. Plain identity headers are easy to spoof unless stripped and protected.
7. Signed internal identity token or mTLS-backed header contract is safer.
8. Gateway can enforce coarse-grained route/scope policy, but app must enforce domain/resource/tenant/state authorization.
9. Internal endpoints are not internal unless network, gateway, and app all enforce that boundary.
10. Host/path rewriting can break authorization constraints and redirect generation.
11. CORS and security headers need single ownership between gateway and app.
12. Token validation must include issuer, audience, expiry, signature, token type, and mapping.
13. Audit must preserve actor chain across gateway, app, and downstream services.
14. Boundary behavior must be tested with negative cases: spoofed headers, direct access, wrong audience, wrong host, wrong scheme.
15. For high-assurance Jakarta systems, prefer: gateway early validation + signed internal identity + app-side domain authorization.

---

## 36. What Comes Next

Part berikutnya:

```text
Part 26 — CSRF, CORS, Clickjacking, and Browser Security Around Authentication
```

Part 25 menyelesaikan boundary antara app dan gateway/proxy. Part 26 akan masuk ke boundary lain yang sama pentingnya: **browser security model**. Kita akan membahas kenapa cookie/session auth rawan CSRF, kenapa CORS sering disalahpahami sebagai authentication, bagaimana clickjacking bekerja, bagaimana SameSite/CSP/frame-ancestors membantu, dan bagaimana SPA + Jakarta backend harus didesain agar browser tidak menjadi attack surface yang tidak terlihat.
