# learn-java-authentication-modes-and-patterns-part-026

# Part 26 — Multi-Tenant Authentication Architecture

> Series: **Java Authentication Modes and Patterns**  
> Scope: **Java 8–25, Servlet/Jakarta, Spring Security, OAuth2/OIDC, SAML, mTLS, API gateways, distributed systems**  
> Level: **Advanced / architecture-grade / production-grade**

---

## 0. Executive Summary

Multi-tenant authentication is not merely “add `tenant_id` to the user table”. It is the discipline of ensuring that every authenticated identity is interpreted, validated, scoped, routed, audited, and authorized inside the correct tenant boundary.

A single-tenant authentication system answers:

> “Is this caller authentic?”

A multi-tenant authentication system must answer a stricter set of questions:

> “Is this caller authentic, according to which issuer, for which tenant, using which client, under which organization boundary, with which claim mapping, and for which resource audience?”

The hard part is not parsing a token. The hard part is avoiding **cross-tenant identity confusion**.

In Java systems, this topic appears in many shapes:

- one Spring Boot resource server accepting JWTs from multiple issuers;
- one SaaS application integrating one OIDC/SAML IdP per customer;
- one Keycloak deployment with realm-per-tenant or organization-per-tenant;
- one government/regulatory platform serving multiple agencies;
- one internal platform where the same human user can belong to multiple departments;
- one API gateway authenticating at the edge and propagating tenant context downstream;
- one microservice receiving events created under a tenant context;
- one admin console supporting tenant admins, platform admins, support engineers, and impersonation.

The core invariant is:

> **Authentication must never produce an identity detached from tenant context.**

A principal like `alice@example.com` is incomplete in a multi-tenant system. A safer identity model is closer to:

```text
principal = {
  global_subject_id,
  issuer,
  tenant_id,
  organization_id,
  client_id,
  audience,
  authentication_method,
  assurance_level,
  session_id,
  correlation_id
}
```

This part builds the mental model, architecture options, design trade-offs, Java implementation patterns, failure modes, and production checklist for multi-tenant authentication.

---

## 1. Problem yang Diselesaikan

### 1.1 Single-tenant assumption yang sering tidak disadari

Banyak aplikasi awalnya dibuat dengan asumsi implisit:

```text
one app
one login page
one user table
one issuer
one role namespace
one database context
one admin model
```

Begitu aplikasi menjadi multi-tenant, asumsi ini runtuh.

Contoh perubahan:

```text
Single tenant:
  username = "fajar"
  role = "ADMIN"
  token issuer = "https://idp.company.com"

Multi tenant:
  username = "fajar"
  role = "ADMIN"
  tenant = "agency-a"
  issuer = "https://idp.agency-a.gov"

  username = "fajar"
  role = "ADMIN"
  tenant = "agency-b"
  issuer = "https://idp.agency-b.gov"
```

String `fajar` dan role `ADMIN` tidak lagi cukup. Bahkan `sub` dalam JWT juga belum tentu cukup jika beberapa issuer berbeda dapat mengeluarkan subject yang sama.

### 1.2 Authentication yang benar tapi tenant-nya salah tetap berbahaya

Token dapat valid secara cryptographic tetapi salah secara tenancy.

Contoh:

```text
Token A:
  iss = https://idp.customer-a.com
  sub = user-123
  aud = billing-api
  tenant = customer-a

Request:
  GET /tenants/customer-b/invoices/INV-001
  Authorization: Bearer TokenA
```

Signature token bisa valid. Expiry bisa valid. Audience bisa valid. Namun request tetap harus ditolak karena token berasal dari tenant A tetapi mencoba mengakses tenant B.

Authentication multi-tenant tidak berhenti pada:

```text
verify JWT signature
```

Ia harus lanjut ke:

```text
verify issuer
verify audience
verify tenant binding
verify client binding
verify subject membership in tenant
verify requested resource belongs to tenant
verify role/scope valid inside tenant
```

### 1.3 Masalah utama yang ingin diselesaikan

Part ini menyelesaikan pertanyaan berikut:

1. Bagaimana menemukan tenant saat login dan request API?
2. Apakah tenant harus berasal dari subdomain, path, header, token claim, session, atau database?
3. Apakah lebih baik realm-per-tenant, client-per-tenant, issuer-per-tenant, atau shared issuer?
4. Bagaimana resource server Java menerima token dari banyak issuer?
5. Bagaimana mencegah token tenant A dipakai untuk tenant B?
6. Bagaimana membedakan platform admin, tenant admin, support admin, dan end user?
7. Bagaimana memodelkan user yang menjadi anggota beberapa tenant?
8. Bagaimana menjaga audit defensibility di sistem regulasi/enterprise?
9. Bagaimana propagasi tenant context ke downstream service, database, cache, queue, dan job?
10. Bagaimana memigrasi sistem single-tenant menjadi multi-tenant tanpa rewrite total?

---

## 2. Mental Model

### 2.1 Authentication multi-tenant adalah dua proses, bukan satu

Secara sederhana:

```text
Authentication = prove identity
Tenant resolution = determine identity boundary
```

Dalam sistem multi-tenant, kedua proses ini saling mengunci.

```text
request
  -> resolve tenant candidate
  -> select authentication strategy for tenant
  -> validate credential/token using tenant-specific trust config
  -> produce authenticated principal bound to tenant
  -> enforce authorization/resource isolation
```

Tanpa tenant resolution, aplikasi tidak tahu:

- issuer mana yang dipercaya;
- JWKS mana yang dipakai;
- SAML metadata mana yang valid;
- LDAP directory mana yang digunakan;
- login policy mana yang berlaku;
- MFA policy mana yang berlaku;
- role mapping mana yang diterapkan;
- session namespace mana yang dipakai;
- database/schema/cache namespace mana yang aman.

### 2.2 Tenant bukan sekadar kolom database

Tenant dapat muncul di banyak layer:

```text
DNS:        agency-a.example.com
URL path:   /t/agency-a/cases
Header:     X-Tenant-Id: agency-a
Token:      claim tenant_id = agency-a
Session:    session.tenant = agency-a
DB:         case.tenant_id = agency-a
Cache:      agency-a:user:123
Queue:      event.tenant_id = agency-a
Audit:      actor_tenant_id = agency-a
```

Jika layer-layer ini tidak konsisten, risiko cross-tenant breach meningkat.

### 2.3 Tenant context harus immutable per request

Setelah request masuk dan tenant berhasil ditentukan, tenant context tidak boleh berubah secara diam-diam di tengah request.

Bad pattern:

```java
TenantContext.setTenantId(request.getHeader("X-Tenant-Id"));
// later...
TenantContext.setTenantId(jwt.getClaim("tenant_id"));
// later...
TenantContext.setTenantId(pathTenant);
```

Ini menciptakan identitas cair. Sistem tidak punya satu sumber kebenaran.

Better pattern:

```text
Resolve all tenant signals
Compare consistency
Reject if conflict
Create immutable AuthenticatedTenantContext
Propagate explicitly
```

Model konseptual:

```java
public record AuthenticatedTenantContext(
    String tenantId,
    String issuer,
    String subject,
    String clientId,
    String audience,
    Set<String> tenantRoles,
    Set<String> scopes,
    String authenticationMethod,
    Instant authenticatedAt
) {}
```

### 2.4 Multi-tenant auth is a binding problem

Setiap elemen harus terikat:

```text
subject -> tenant
issuer -> tenant
client -> tenant
token -> audience
role -> tenant
session -> tenant
resource -> tenant
operation -> tenant policy
```

Jika satu binding hilang, celah muncul.

Contoh celah:

```text
User authenticated: yes
User role: ADMIN
Tenant requested: B
Role namespace: global, not tenant-bound
Result: admin tenant A may access tenant B
```

### 2.5 Tidak semua multi-tenancy sama

Ada beberapa bentuk multi-tenancy:

#### 2.5.1 B2C multi-tenancy

Banyak user, satu aplikasi, segmentasi tenant mungkin rendah.

```text
consumer app
many accounts
same issuer
tenant mostly equals account/workspace
```

#### 2.5.2 B2B SaaS multi-tenancy

Setiap customer enterprise punya org, domain, IdP, policy, dan admin sendiri.

```text
customer-a uses Entra ID
customer-b uses Okta
customer-c uses Keycloak
customer-d uses local password + MFA
```

#### 2.5.3 Government/agency multi-tenancy

Tenant biasanya punya konsekuensi compliance, data isolation, audit, legal defensibility.

```text
agency
division
case type
jurisdiction
officer role
legal authority
```

#### 2.5.4 Internal enterprise multi-tenancy

Tenant bisa berarti business unit, department, region, project, atau legal entity.

#### 2.5.5 Platform multi-tenancy

Platform admin mengelola banyak tenant, tetapi tidak boleh otomatis punya akses ke data tenant tanpa break-glass policy.

---

## 3. Core Concepts

## 3.1 Tenant

Tenant adalah boundary administratif, konfigurasi, data, policy, atau trust.

Tenant bukan selalu customer. Tenant bisa berupa:

- organization;
- agency;
- department;
- workspace;
- realm;
- legal entity;
- environment;
- jurisdiction;
- partner;
- domain;
- business unit.

Definisi production-grade:

```text
Tenant is the smallest unit for which identity trust, data access,
configuration, policy, audit, and operational ownership may differ.
```

### 3.2 Organization

Organization sering lebih user-facing dibanding tenant.

Contoh:

```text
tenant_id = "gov-platform-sg"
organization_id = "cea"
agency_id = "cea"
department_id = "enforcement"
```

Dalam SaaS B2B:

```text
tenant_id = "acme-prod"
organization_id = "acme"
workspace_id = "acme-apac"
```

Kadang tenant dan organization sama. Kadang berbeda.

### 3.3 Issuer

Issuer adalah pihak yang mengeluarkan token/assertion.

Dalam OIDC/JWT:

```json
{
  "iss": "https://idp.customer-a.com",
  "sub": "00u123",
  "aud": "case-api"
}
```

Issuer harus divalidasi. Dalam multi-tenant system, issuer sering menjadi sinyal tenancy.

Namun issuer saja tidak selalu cukup:

```text
Same issuer can serve multiple tenants.
Same tenant can accept multiple issuers during migration.
One customer can have multiple IdPs.
```

### 3.4 Subject

Subject adalah identifier user/entity menurut issuer.

Important invariant:

```text
(issuer, subject) is safer than subject alone
```

Lebih aman lagi:

```text
(tenant_id, issuer, subject)
```

Jangan menyimpan `sub` sebagai global user id tanpa issuer binding.

Bad:

```text
users.external_subject = "12345"
```

Better:

```text
external_identities:
  tenant_id
  issuer
  subject
  identity_provider_type
  linked_user_id
```

### 3.5 Client

Client adalah aplikasi yang meminta token.

Dalam OIDC/OAuth:

```text
client_id = web-app-customer-a
client_id = mobile-app-customer-a
client_id = backend-job-customer-a
```

Client dapat tenant-specific atau shared.

Risk:

```text
Client of tenant A used to authenticate user of tenant B
```

Maka client binding penting.

### 3.6 Audience

Audience adalah penerima token yang dimaksud.

```json
{
  "aud": "case-api"
}
```

Di multi-service architecture, audience harus spesifik.

Weak:

```text
aud = "platform"
```

Better:

```text
aud = "case-api"
aud = "billing-api"
aud = "document-api"
```

Jika semua service menerima token dengan audience yang terlalu luas, token replay antar service menjadi lebih mudah.

### 3.7 Tenant membership

User dapat punya membership ke satu atau banyak tenant.

```text
user: fajar
memberships:
  tenant-a: CASE_OFFICER
  tenant-b: READ_ONLY_REVIEWER
  tenant-c: TENANT_ADMIN
```

Authentication membuktikan user. Authorization menentukan membership dan privilege.

Namun authentication perlu memasukkan tenant context agar downstream authorization benar.

### 3.8 Tenant role namespace

Role harus tenant-scoped kecuali benar-benar platform-level.

Bad:

```text
ROLE_ADMIN
```

Better:

```text
TENANT_ADMIN within tenant-a
PLATFORM_SUPPORT with constrained break-glass
CASE_OFFICER within agency-x
```

### 3.9 Home tenant vs active tenant

User bisa memiliki home tenant dan active tenant.

```text
home_tenant = agency-a
active_tenant = agency-b
```

Contoh:

- consultant bekerja untuk banyak customer;
- regulator mengakses case beberapa agency;
- support engineer masuk ke tenant customer;
- user berpindah workspace.

Active tenant harus eksplisit, tidak boleh ditebak diam-diam jika ambiguity tinggi.

### 3.10 Trust configuration

Setiap tenant bisa punya trust config:

```yaml
tenant: customer-a
issuer: https://login.microsoftonline.com/...
jwks_uri: https://...
allowed_audiences:
  - case-api
allowed_clients:
  - customer-a-web
claim_mapping:
  subject: sub
  email: preferred_username
  groups: groups
mfa_required: true
clock_skew_seconds: 60
```

Trust config adalah security-critical configuration.

---

## 4. Java 8–25 Relevance

### 4.1 Java 8 baseline reality

Banyak enterprise Java authentication masih harus mendukung Java 8.

Java 8 realities:

- Servlet container auth banyak dipakai;
- JAAS/Kerberos/LDAP masih umum;
- Spring Security 4/5 legacy masih ditemui;
- JKS/PKCS12 keystore banyak dipakai;
- `ThreadLocal` security context umum;
- tidak ada virtual thread;
- async propagation manual;
- banyak JWT library generasi lama punya default yang harus diperiksa.

### 4.2 Java 11–17 transition

Java 11/17 banyak menjadi LTS enterprise baseline.

Relevant improvements:

- TLS/runtime modern;
- stronger default crypto posture dibanding legacy;
- modern Spring Boot/Spring Security support;
- better containerization baseline;
- records tersedia mulai Java 16/17 untuk identity context modeling;
- sealed classes dapat membantu model authentication result.

### 4.3 Java 21–25 modern context

Java 21+ membawa perubahan runtime architecture:

- virtual threads;
- structured concurrency;
- scoped values;
- improved crypto/key APIs;
- modern TLS stack;
- better native/cloud runtime posture.

Untuk multi-tenant authentication, dampaknya:

1. Tenant/security context jangan diasumsikan aman hanya karena `ThreadLocal`.
2. Context propagation harus eksplisit dalam async/reactive/virtual-thread boundaries.
3. Immutable identity record menjadi lebih natural.
4. Secret/key handling dapat lebih distandardisasi.
5. Runtime concurrency membuat tenant leakage lebih mudah terjadi jika context salah dibersihkan.

### 4.4 Servlet/Jakarta relevance

Dalam Servlet/Jakarta:

```text
request -> filter -> authentication mechanism -> principal -> roles
```

Multi-tenancy menambahkan:

```text
request -> tenant resolution -> tenant-specific auth mechanism/config -> principal bound to tenant
```

Masalah muncul ketika container hanya tahu principal dan roles, tetapi aplikasi perlu tenant context yang lebih kaya.

### 4.5 Spring Security relevance

Spring Security punya dukungan multi-tenancy resource server, terutama ketika resource server menerima bearer token dari beberapa issuer. Dokumentasi Spring menyatakan resource server dianggap multi-tenant ketika ada beberapa strategi verifikasi bearer token yang dipilih berdasarkan tenant identifier.

Di Spring, multi-tenancy biasanya menyentuh:

- `AuthenticationManagerResolver<HttpServletRequest>`;
- `JwtIssuerAuthenticationManagerResolver`;
- custom `JwtDecoder` per issuer;
- custom `JwtAuthenticationConverter` per tenant;
- `SecurityContextHolder`;
- method security dengan tenant-aware authorization;
- WebFlux `ReactiveAuthenticationManagerResolver`;
- Reactor context propagation.

### 4.6 Jakarta Security relevance

Jakarta Security dapat menyediakan mechanism dan identity store, tetapi multi-tenant design sering membutuhkan custom layer:

- tenant-specific identity store;
- tenant-specific OIDC provider config;
- tenant-specific group mapping;
- active tenant selection;
- custom principal model;
- audit extension.

### 4.7 Keycloak/IdP relevance

Di Keycloak atau IdP lain, tenancy dapat dimodelkan dengan:

- realm per tenant;
- client per tenant;
- group/organization per tenant;
- identity provider per tenant;
- realm shared with organizations;
- brokered IdP per customer.

Tidak ada satu model yang selalu benar. Pilihan tergantung isolation, operability, customization, scaling, dan compliance.

---

## 5. Tenant Resolution

Tenant resolution adalah proses menentukan tenant dari request atau login attempt.

### 5.1 Resolution sources

Common sources:

| Source | Example | Strength | Risk |
|---|---|---:|---|
| Subdomain | `agency-a.example.com` | Strong for browser routing | DNS/domain lifecycle |
| Path | `/t/agency-a/cases` | Explicit | Path tampering |
| Header | `X-Tenant-Id` | Useful internal | Spoofing if public |
| Token claim | `tenant_id` | Cryptographically bound if signed | Claim mapping error |
| Issuer | `iss` | Strong if issuer-per-tenant | Shared issuer ambiguity |
| Client ID | `client_id` | Good for app/tenant binding | Shared client ambiguity |
| Email domain | `@agency.gov` | Useful discovery | Domain ownership changes |
| User choice | workspace switcher | Explicit | UI/session confusion |
| Session | `activeTenant` | Stable after login | fixation/stale session |
| mTLS cert SAN | `tenant=agency-a` | Strong possession binding | cert mapping errors |

### 5.2 Subdomain-based tenant resolution

Example:

```text
https://agency-a.platform.gov/login
https://agency-b.platform.gov/login
```

Advantages:

- clear browser boundary;
- tenant-specific branding;
- easier cookie scoping;
- easier IdP routing;
- useful for B2B SaaS.

Risks:

- wildcard DNS/cert management;
- tenant rename complexity;
- domain takeover risk if custom domains are supported;
- cookies must be scoped carefully;
- same-site behavior must be understood.

Pattern:

```java
String host = request.getServerName();
Tenant tenant = tenantRegistry.findByHost(host)
    .orElseThrow(() -> unauthorized("unknown tenant host"));
```

But do not trust `Host` blindly behind proxies. Use trusted forwarded headers only if gateway is correctly configured.

### 5.3 Path-based tenant resolution

Example:

```text
/t/agency-a/cases/123
/t/agency-b/cases/456
```

Advantages:

- simple local development;
- one domain;
- clear routing;
- explicit REST structure.

Risks:

- easy to tamper;
- every endpoint must enforce tenant consistency;
- cached URLs can leak tenant IDs;
- path tenant must be compared with authenticated tenant.

Invariant:

```text
path tenant must equal active authenticated tenant, unless explicit cross-tenant operation is authorized
```

### 5.4 Header-based tenant resolution

Example:

```http
GET /cases/123
X-Tenant-Id: agency-a
Authorization: Bearer eyJ...
```

Good for:

- internal service calls;
- gateway-to-service propagation;
- background jobs;
- testing.

Dangerous for public APIs unless protected.

Rule:

```text
A public caller must not be able to select tenant only by unsigned header.
```

Header tenant can be used as a candidate, but must be validated against token/session.

### 5.5 Token-claim-based tenant resolution

Example:

```json
{
  "iss": "https://idp.example.com/realms/platform",
  "sub": "user-123",
  "tenant_id": "agency-a",
  "aud": "case-api"
}
```

Advantages:

- cryptographically protected if token validation is correct;
- works for APIs;
- good for service-to-service calls.

Risks:

- claim naming differs per IdP;
- tenant claim may be absent;
- token may contain multiple tenant memberships;
- tenant claim may be user-controlled if IdP mapping is wrong;
- token may be valid but not intended for this resource.

### 5.6 Issuer-based resolution

Example:

```text
iss = https://login.microsoftonline.com/customer-a/v2.0
iss = https://customer-b.okta.com/oauth2/default
```

Advantages:

- strong trust boundary;
- natural with enterprise IdP per customer;
- JWKS/discovery can be issuer-specific.

Risks:

- same tenant may use multiple issuers;
- same issuer may serve multiple tenants;
- migration can require accepting old and new issuers;
- issuer discovery must be allowlisted.

Never resolve arbitrary issuer from token and fetch metadata without allowlist. That pattern can become SSRF or trust injection.

### 5.7 Email-domain discovery

Example:

```text
user enters fajar@agency-a.gov
system routes to agency-a IdP
```

Advantages:

- convenient login discovery;
- common in B2B SaaS.

Risks:

- email domain is not proof of tenant membership;
- users can have aliases;
- domain ownership can change;
- contractors use external emails;
- same domain may map to multiple tenants.

Email-domain discovery is for routing, not final authentication.

### 5.8 User-selected active tenant

After login, user chooses active tenant:

```text
You belong to:
  - Agency A
  - Agency B
  - Platform Support
```

This is often safest when users can belong to many tenants.

Rules:

1. Membership list must come from trusted source.
2. Active tenant must be stored in secure session or signed token.
3. Switching tenant should rotate or update session context.
4. Authorization must still check resource tenant.
5. Audit must record active tenant and original subject.

### 5.9 Resolution consistency matrix

Production-grade systems compare tenant signals.

Example:

```text
host tenant    = agency-a
path tenant    = agency-a
token tenant   = agency-a
session tenant = agency-a
resource tenant= agency-a
```

Accept.

Conflict example:

```text
host tenant    = agency-a
path tenant    = agency-b
token tenant   = agency-a
```

Reject unless explicitly authorized cross-tenant operation.

### 5.10 Tenant resolution algorithm

Conceptual algorithm:

```text
1. Extract tenant candidates from trusted sources.
2. Classify each source by trust strength.
3. Reject unknown tenant IDs.
4. Load tenant trust configuration.
5. Validate authentication credential using that trust config.
6. Extract authenticated tenant claim/membership.
7. Compare request tenant with authenticated tenant.
8. Build immutable tenant context.
9. Attach context to request/security context.
10. Enforce tenant-aware authorization and resource filtering.
```

---

## 6. Architecture Pattern Options

## 6.1 Realm per tenant

Each tenant has its own realm/issuer.

```text
https://idp.example.com/realms/tenant-a
https://idp.example.com/realms/tenant-b
```

### Advantages

- strong isolation;
- separate issuer;
- separate keys;
- separate clients;
- separate policies;
- easier tenant-specific customization;
- easier tenant export/import;
- easier legal/compliance separation.

### Disadvantages

- operational overhead;
- many realm configs to manage;
- duplicated clients/roles/protocol mappers;
- harder global user view;
- scaling admin complexity;
- cross-tenant user membership harder.

### Good for

- high isolation;
- government agencies;
- regulated customers;
- enterprise customers requiring separate IdP trust boundary;
- tenant-specific login policies.

### Bad for

- thousands of small tenants if IdP does not scale admin/config well;
- users frequently belonging to many tenants;
- highly shared consumer experience.

### Java impact

Resource server needs issuer-aware JWT validation:

```text
issuer -> JwtDecoder -> AuthenticationManager -> tenant context
```

Spring Security supports patterns where authentication managers are resolved by request/issuer.

## 6.2 Shared realm, client per tenant

One issuer, many clients.

```text
issuer = https://idp.example.com/realms/platform
client_id = tenant-a-web
client_id = tenant-b-web
```

### Advantages

- fewer realms;
- shared user pool;
- easier cross-tenant membership;
- simpler global admin;
- less duplication.

### Disadvantages

- weaker isolation;
- token issuer same for all tenants;
- client/tenant binding must be strict;
- roles/groups must be tenant-scoped;
- mistakes can expose one tenant to another.

### Required invariant

```text
client_id must be allowed for tenant_id
```

Example validation:

```text
token.client_id = tenant-a-web
token.tenant_id = tenant-b
=> reject
```

## 6.3 Shared realm, organization per tenant

Modern IdPs increasingly support organization constructs.

```text
realm = platform
organization = tenant-a
organization = tenant-b
```

### Advantages

- better B2B tenant modeling;
- tenant admin model;
- tenant members;
- IdP brokering per organization;
- less overhead than realm-per-tenant.

### Risks

- organization feature maturity varies;
- client restriction per organization must be checked;
- role mapping can become complex;
- application still must enforce tenant isolation.

### Key design question

Does the IdP enforce that users of org A cannot authenticate into client/org B, or must the application enforce it?

If application must enforce it, treat IdP organization claim as input, not final authority.

## 6.4 Issuer per tenant via external IdP

Each tenant uses its own external IdP.

```text
tenant-a -> Entra ID
tenant-b -> Okta
tenant-c -> Ping
tenant-d -> Keycloak
```

### Advantages

- customer controls identity lifecycle;
- enterprise SSO;
- customer-specific MFA;
- reduces password handling;
- natural for B2B.

### Disadvantages

- claim normalization complexity;
- different group formats;
- IdP metadata lifecycle;
- customer misconfiguration;
- IdP outage affects tenant;
- support complexity.

### Required capabilities

- tenant-specific discovery metadata;
- tenant-specific JWKS;
- claim mapping configuration;
- group/role mapping;
- login routing;
- fallback/admin access policy;
- audit per external issuer.

## 6.5 Application-managed tenant membership

IdP authenticates user, application decides tenant membership.

```text
OIDC token proves:
  issuer + subject + email

Application DB decides:
  user belongs to tenant-a as CASE_OFFICER
```

### Advantages

- app owns authorization model;
- avoids huge token group claims;
- easier audit and lifecycle;
- works across many IdPs;
- safer for domain-specific roles.

### Disadvantages

- user provisioning required;
- JIT provisioning complexity;
- app must sync/deprovision;
- IdP group changes may not immediately reflect.

This is often the best enterprise pattern:

```text
IdP authenticates identity.
Application authorizes tenant membership.
```

## 6.6 Token contains tenant membership

Token includes roles/groups/tenants.

```json
{
  "sub": "user-123",
  "tenants": [
    {"id": "a", "roles": ["ADMIN"]},
    {"id": "b", "roles": ["VIEWER"]}
  ]
}
```

### Advantages

- fewer DB lookups;
- stateless authorization possible;
- useful for small membership sets.

### Disadvantages

- token bloat;
- stale membership;
- revocation harder;
- many tenants impossible;
- risk of trusting wrong claim shape.

Recommendation:

```text
Token may carry coarse identity and tenant hint.
Application should enforce authoritative membership for sensitive operations.
```

## 6.7 Gateway-authenticated multi-tenancy

Gateway validates auth, injects headers:

```http
X-Authenticated-Subject: user-123
X-Tenant-Id: tenant-a
X-Roles: CASE_OFFICER
```

### Advantages

- central auth;
- consistent edge controls;
- simpler services;
- good for internal platforms.

### Disadvantages

- services may overtrust headers;
- bypass risk if service exposed internally;
- header spoofing;
- tenant context may be lost in async flows;
- complex debugging.

Rule:

```text
If services trust gateway headers, services must only be reachable from trusted gateway or must verify signed/internal token.
```

Better internal propagation:

```text
Gateway validates external token.
Gateway issues internal signed token with tenant context.
Services validate internal token.
```

## 6.8 Service mesh mTLS identity plus app tenant context

Service mesh authenticates workload:

```text
caller workload = case-api
callee workload = document-api
```

Application token carries user/tenant:

```text
end_user = officer-123
tenant = agency-a
```

Do not confuse workload identity with end-user tenant identity.

```text
mTLS says which service called.
Bearer token says on behalf of which subject/tenant.
```

Both are needed for sensitive systems.

---

## 7. Identity Model for Multi-Tenant Java Systems

### 7.1 Bad model: username is identity

```java
class User {
    Long id;
    String username;
    String role;
}
```

Problems:

- username not globally unique;
- role not tenant-scoped;
- no issuer;
- no external identity mapping;
- no membership lifecycle;
- no audit defensibility.

### 7.2 Better model: global user plus external identities plus memberships

```text
users
  id
  display_name
  primary_email
  status
  created_at

external_identities
  id
  user_id
  tenant_id nullable
  issuer
  subject
  provider_type
  email_at_link_time
  linked_at
  last_seen_at

memberships
  id
  user_id
  tenant_id
  status
  roles
  source
  valid_from
  valid_until

sessions
  id
  user_id
  active_tenant_id
  issuer
  subject
  auth_time
  mfa_level
```

This separates:

```text
human/person account
external login identity
tenant membership
active session
```

### 7.3 External identity uniqueness

Recommended unique constraint:

```sql
unique (issuer, subject)
```

or, when same issuer serves many tenants and subject may not be globally stable:

```sql
unique (tenant_id, issuer, subject)
```

Be careful with email uniqueness:

```text
email is a contact attribute, not always identity key
```

### 7.4 Tenant membership lifecycle

Membership has lifecycle:

```text
INVITED -> ACTIVE -> SUSPENDED -> REMOVED
```

Authentication should reject or restrict suspended/removed membership.

### 7.5 Active tenant session model

For browser apps:

```text
session.user_id = 123
session.active_tenant_id = agency-a
session.available_tenants = [agency-a, agency-b]
```

When switching tenant:

1. validate membership;
2. update active tenant;
3. rotate session or record tenant switch event;
4. clear tenant-specific caches;
5. redirect to tenant-specific context;
6. audit switch.

### 7.6 Principal model

A Java principal should not only be username.

Example:

```java
public final class TenantPrincipal implements java.security.Principal {
    private final String userId;
    private final String tenantId;
    private final String issuer;
    private final String subject;
    private final String displayName;

    @Override
    public String getName() {
        return userId;
    }

    public String tenantId() { return tenantId; }
    public String issuer() { return issuer; }
    public String subject() { return subject; }
}
```

For modern Java:

```java
public record TenantPrincipal(
    String userId,
    String tenantId,
    String issuer,
    String subject,
    String displayName
) implements java.security.Principal {
    @Override
    public String getName() {
        return userId;
    }
}
```

### 7.7 Authentication object model in Spring

Spring `Authentication` can carry tenant-aware principal:

```java
public record AuthenticatedActor(
    String userId,
    String tenantId,
    String issuer,
    String subject,
    Set<String> roles,
    Set<String> scopes
) {}
```

Then:

```java
Authentication auth = new UsernamePasswordAuthenticationToken(
    actor,
    "N/A",
    authorities
);
```

But authorities should be tenant-aware.

Bad:

```text
ROLE_ADMIN
```

Better:

```text
TENANT_agency-a_ROLE_CASE_OFFICER
```

or avoid encoding tenant into authority string and use policy methods:

```java
@PreAuthorize("@tenantAuthz.canReadCase(authentication, #tenantId, #caseId)")
```

---

## 8. Token Validation in Multi-Tenant Resource Servers

### 8.1 Single issuer validation

Single-tenant resource server:

```yaml
spring.security.oauth2.resourceserver.jwt.issuer-uri: https://idp.example.com/realms/main
```

This is simple but insufficient for many tenant issuers.

### 8.2 Multi-issuer validation

Multi-tenant resource server:

```text
issuer A -> decoder A -> rules A
issuer B -> decoder B -> rules B
issuer C -> decoder C -> rules C
```

Core logic:

```text
extract issuer candidate
ensure issuer is allowlisted
select decoder/config
validate token
map claims
build tenant context
```

### 8.3 Never trust unregistered issuer

Dangerous anti-pattern:

```java
String issuer = parseJwtWithoutValidation(token).getIssuer();
JwtDecoder decoder = JwtDecoders.fromIssuerLocation(issuer);
return decoder.decode(token);
```

Problem:

- attacker controls `iss`;
- server may fetch attacker metadata;
- trust is injected by token;
- possible SSRF if metadata URL is fetched;
- arbitrary issuer accepted.

Safer:

```java
String issuer = parseIssuerUntrusted(token);
TenantTrustConfig config = trustRegistry.findByIssuer(issuer)
    .orElseThrow(() -> unauthorized("unknown issuer"));
JwtDecoder decoder = decoderFactory.forConfig(config);
Jwt jwt = decoder.decode(token);
validateTenantBinding(jwt, config);
```

Parsing issuer before validation is acceptable only as an untrusted routing hint.

### 8.4 Audience validation

Every tenant config should define allowed audiences:

```yaml
allowedAudiences:
  - case-api
```

Reject:

```text
audit-api token used against case-api
```

### 8.5 Client validation

For user-facing tokens:

```text
azp/client_id must be allowed for tenant
```

Example:

```text
tenant-a allows clients:
  - tenant-a-web
  - tenant-a-mobile

token client_id = tenant-b-web
requested tenant = tenant-a
=> reject
```

### 8.6 Claim mapping per tenant

Different IdPs emit different claims:

```text
Keycloak: realm_access.roles, resource_access
Entra ID: oid, tid, roles, groups, preferred_username
Okta: groups, email, sub
Custom: departmentCode, agencyCode
```

Do not hardcode one claim shape globally.

Pattern:

```yaml
tenants:
  agency-a:
    subjectClaim: sub
    emailClaim: preferred_username
    groupClaim: groups
    tenantClaim: agency_code
  agency-b:
    subjectClaim: oid
    emailClaim: email
    groupClaim: roles
    tenantClaim: tenant_id
```

### 8.7 Token tenant claim must be verified against registry

Bad:

```java
String tenantId = jwt.getClaimAsString("tenant_id");
```

Better:

```java
String tenantId = jwt.getClaimAsString(config.tenantClaim());
if (!config.tenantId().equals(tenantId)) {
    throw unauthorized("token tenant mismatch");
}
```

### 8.8 Multi-tenant JWT decoder cache

Decoder creation can be expensive. Cache decoders by issuer/config version.

```text
key = issuer + jwks_uri + config_version
value = JwtDecoder
```

But cache invalidation matters:

- tenant disabled;
- issuer changed;
- JWKS URI changed;
- key rotation;
- emergency block.

### 8.9 Fail closed on unknown tenant or issuer

Default behavior:

```text
unknown tenant -> 401/404 depending information disclosure policy
unknown issuer -> 401
tenant mismatch -> 403 or 401 depending semantics
```

Do not create tenant automatically from token claims.

---

## 9. Java/Spring Implementation Patterns

### 9.1 Tenant trust registry

A central registry is needed.

```java
public interface TenantTrustRegistry {
    Optional<TenantTrustConfig> findByTenantId(String tenantId);
    Optional<TenantTrustConfig> findByIssuer(String issuer);
    Optional<TenantTrustConfig> findByHost(String host);
}
```

Config:

```java
public record TenantTrustConfig(
    String tenantId,
    String issuer,
    URI jwksUri,
    Set<String> allowedAudiences,
    Set<String> allowedClientIds,
    String tenantClaim,
    String subjectClaim,
    String groupsClaim,
    Duration clockSkew,
    long version
) {}
```

### 9.2 Tenant resolver

```java
public interface TenantResolver {
    TenantCandidate resolve(HttpServletRequest request);
}

public record TenantCandidate(
    Optional<String> hostTenant,
    Optional<String> pathTenant,
    Optional<String> headerTenant,
    Optional<String> tokenIssuerHint
) {}
```

### 9.3 AuthenticationManagerResolver pattern

Conceptual Spring Security pattern:

```java
AuthenticationManagerResolver<HttpServletRequest> resolver = request -> {
    TenantCandidate candidate = tenantResolver.resolve(request);
    TenantTrustConfig config = trustConfigSelector.select(candidate);
    return authenticationManagerFactory.forTenant(config);
};
```

This supports tenant-specific validation.

### 9.4 Tenant-aware JWT authentication converter

```java
public final class TenantJwtAuthenticationConverter
        implements Converter<Jwt, AbstractAuthenticationToken> {

    private final TenantTrustConfig config;
    private final MembershipService membershipService;

    public AbstractAuthenticationToken convert(Jwt jwt) {
        validateIssuer(jwt, config);
        validateAudience(jwt, config);
        validateClient(jwt, config);
        String tenantId = requireClaim(jwt, config.tenantClaim());
        if (!tenantId.equals(config.tenantId())) {
            throw new BadCredentialsException("Tenant mismatch");
        }

        String subject = requireClaim(jwt, config.subjectClaim());
        Membership membership = membershipService.requireActiveMembership(
            config.tenantId(),
            config.issuer(),
            subject
        );

        AuthenticatedActor actor = new AuthenticatedActor(
            membership.userId(),
            config.tenantId(),
            config.issuer(),
            subject,
            membership.roles(),
            jwt.getClaimAsStringList("scope") == null ? Set.of() : Set.copyOf(jwt.getClaimAsStringList("scope"))
        );

        return new JwtAuthenticationToken(jwt, toAuthorities(actor), actor.userId());
    }
}
```

The exact API may vary by Spring Security version, but the architecture remains.

### 9.5 Tenant context holder

For Servlet stacks, you may use request attribute plus carefully managed context.

```java
public final class TenantContextHolder {
    private static final ThreadLocal<AuthenticatedTenantContext> CURRENT = new ThreadLocal<>();

    public static void set(AuthenticatedTenantContext context) {
        CURRENT.set(Objects.requireNonNull(context));
    }

    public static AuthenticatedTenantContext getRequired() {
        AuthenticatedTenantContext ctx = CURRENT.get();
        if (ctx == null) throw new IllegalStateException("No tenant context");
        return ctx;
    }

    public static void clear() {
        CURRENT.remove();
    }
}
```

Filter must clear context:

```java
try {
    TenantContextHolder.set(context);
    chain.doFilter(request, response);
} finally {
    TenantContextHolder.clear();
}
```

However, for async/reactive/virtual thread, prefer explicit parameter/context propagation.

### 9.6 Method-level authorization

```java
@PreAuthorize("@tenantPolicy.canAccessCase(authentication, #tenantId, #caseId)")
public CaseDto getCase(String tenantId, String caseId) {
    return caseService.getCase(tenantId, caseId);
}
```

Policy implementation:

```java
public boolean canAccessCase(Authentication authentication, String tenantId, String caseId) {
    AuthenticatedActor actor = (AuthenticatedActor) authentication.getPrincipal();

    if (!actor.tenantId().equals(tenantId)) {
        return false;
    }

    if (!actor.roles().contains("CASE_VIEWER")) {
        return false;
    }

    return caseRepository.existsByTenantIdAndCaseId(tenantId, caseId);
}
```

### 9.7 Repository-level tenant guard

Do not rely only on controller-level tenant checks.

Bad:

```java
caseRepository.findById(caseId)
```

Better:

```java
caseRepository.findByTenantIdAndId(tenantId, caseId)
```

For every tenant-owned entity:

```text
primary query must include tenant_id
```

### 9.8 Cache key tenant prefix

Bad:

```text
user:123
case:456
```

Better:

```text
tenant:agency-a:user:123
tenant:agency-a:case:456
```

For auth cache:

```text
authz:tenant:agency-a:user:123:roles:v7
jwt-decoder:issuer:https://idp-a:config:v3
```

### 9.9 Queue/event tenant context

Every event that affects tenant data must carry tenant context.

```json
{
  "eventId": "evt-123",
  "tenantId": "agency-a",
  "actor": {
    "type": "USER",
    "userId": "u-123",
    "issuer": "https://idp-a",
    "subject": "sub-456"
  },
  "action": "CASE_CREATED"
}
```

Consumers must not infer tenant from payload object ID alone.

### 9.10 Database connection/schema switching

If using schema-per-tenant:

```java
set search_path tenant_schema
```

or Oracle equivalent session context.

Rules:

1. switch schema only after authenticated tenant context exists;
2. reset connection before returning to pool;
3. never use user-controlled tenant string directly in SQL;
4. maintain allowlisted tenant/schema mapping;
5. test connection pool leakage.

---

## 10. Tenant Isolation and Authorization Boundary

### 10.1 Authentication is necessary but not sufficient

Even perfect authentication cannot prevent cross-tenant data access if authorization and data queries are weak.

Broken pattern:

```text
JWT tenant = A
GET /cases/B-123
Repository loads by case ID only
Case belongs to tenant B
Returned to tenant A user
```

Fix:

```text
JWT tenant = A
GET /cases/B-123
Repository loads by tenant A + case ID
No result
```

### 10.2 Tenant isolation layers

Defense-in-depth layers:

```text
1. Edge routing
2. Authentication tenant binding
3. Authorization tenant membership
4. Service method policy
5. Repository tenant filter
6. Database row/schema isolation
7. Cache namespace isolation
8. Event tenant isolation
9. Audit and anomaly detection
```

### 10.3 Tenant should be part of resource identity

Bad API:

```http
GET /cases/123
```

Better:

```http
GET /tenants/agency-a/cases/123
```

or session-bound active tenant:

```http
GET /cases/123
Cookie session activeTenant=agency-a
```

The latter can be acceptable for browser app, but backend still needs tenant-bound lookup.

### 10.4 Object-level authorization

OWASP API Security highlights object-level authorization as a key API risk. In multi-tenant systems, every object-level authorization check must include tenant ownership.

Checklist:

```text
Can user access this object?
  -> Is user authenticated?
  -> Is tenant context valid?
  -> Does object belong to tenant?
  -> Is user member of tenant?
  -> Does user have role/scope for operation?
  -> Is object state compatible with operation?
```

### 10.5 Role-based vs attribute-based access

Tenant systems often outgrow simple RBAC.

RBAC:

```text
CASE_OFFICER can view cases
```

ABAC:

```text
CASE_OFFICER can view cases only within assigned region, case type, agency, and lifecycle state
```

Regulatory systems often require ABAC-like policy.

### 10.6 Platform admin is not tenant admin

Separate:

```text
TENANT_ADMIN: manages users/settings inside one tenant
PLATFORM_ADMIN: manages platform configuration
SUPPORT_AGENT: can assist tenant under controlled workflow
BREAK_GLASS_ADMIN: emergency access with approval/audit
```

Do not let `PLATFORM_ADMIN` bypass tenant isolation silently.

### 10.7 Support impersonation

If support impersonation exists:

Audit must record:

```text
real_actor = support-user-123
impersonated_actor = tenant-user-456
tenant = agency-a
reason = ticket-789
approval = approval-555
start_time
end_time
actions
```

Never overwrite real actor with impersonated actor in audit.

### 10.8 Cross-tenant operations

Some systems legitimately need cross-tenant operations:

- regulator oversight;
- platform reporting;
- migration;
- data archival;
- support diagnostics;
- tenant merge/split.

These should use explicit operation type:

```text
operation_scope = CROSS_TENANT
allowed_by = platform policy
reason_required = true
audit_high_risk = true
```

Not accidental bypass.

---

## 11. Session Design in Multi-Tenant Browser Apps

### 11.1 One session per active tenant

Pattern:

```text
login -> choose tenant -> session bound to active tenant
```

Advantages:

- simple authorization;
- clear audit;
- lower confusion.

Disadvantages:

- switching tenant requires session update;
- multiple tabs with different tenants can conflict.

### 11.2 One session with switchable active tenant

Pattern:

```text
session.user = u123
session.activeTenant = agency-a
```

Switching tenant updates active tenant.

Risk:

- tab A thinks tenant A;
- tab B switches to tenant B;
- tab A submits form to tenant B accidentally.

Mitigations:

- include tenant in URL;
- include tenant version in forms;
- reject stale active tenant mismatch;
- show active tenant prominently;
- use per-tab tenant token if necessary.

### 11.3 Separate session namespace per subdomain

Pattern:

```text
agency-a.example.com -> session cookie A
agency-b.example.com -> session cookie B
```

Advantages:

- strong browser separation;
- multiple tenant tabs safer.

Risks:

- SSO/logout complexity;
- cookie domain mistakes;
- custom domain complexity.

### 11.4 Tenant switch event

Tenant switch should be auditable:

```json
{
  "event": "TENANT_SWITCHED",
  "userId": "u123",
  "fromTenant": "agency-a",
  "toTenant": "agency-b",
  "sessionId": "s789",
  "time": "2026-06-19T00:00:00Z"
}
```

### 11.5 Logout semantics

Logout in multi-tenant can mean:

1. logout from active tenant session only;
2. logout from all tenant sessions in app;
3. logout from upstream IdP;
4. logout from all federated sessions.

Be explicit.

---

## 12. Multi-Tenant IdP Design Decisions

### 12.1 Realm per tenant decision matrix

Use realm-per-tenant when:

- strong isolation is required;
- tenant-specific keys are required;
- tenant-specific IdP config is complex;
- compliance requires separate admin boundary;
- per-tenant backup/export is needed;
- tenant count is manageable.

Avoid when:

- huge tenant count;
- many cross-tenant users;
- centralized user lifecycle is more important;
- IdP operational automation is weak.

### 12.2 Client per tenant decision matrix

Use client-per-tenant when:

- shared issuer is acceptable;
- tenant-specific redirect URIs needed;
- client credentials must be isolated;
- tenant-specific app config needed;
- realm count should be reduced.

Risks:

- client/tenant mismatch;
- shared issuer confusion;
- role namespace complexity.

### 12.3 Organization per tenant decision matrix

Use organization-per-tenant when:

- IdP supports mature organization model;
- B2B membership/admin is needed;
- tenants share same realm;
- external IdPs can be linked per org.

Risks:

- feature maturity;
- vendor-specific behavior;
- application still needs enforcement.

### 12.4 External IdP per tenant decision matrix

Use external IdP per tenant when:

- enterprise customers require SSO;
- customer owns employee lifecycle;
- customer MFA policy should apply;
- you want to avoid password storage.

Risks:

- claim chaos;
- SAML/OIDC metadata lifecycle;
- deprovisioning gaps;
- customer misconfiguration;
- difficult support.

### 12.5 Local fallback users

Many enterprise apps need emergency local admin.

Rules:

- tenant-scoped;
- MFA enforced;
- small number;
- break-glass audit;
- disabled by default if possible;
- separate from normal user path.

---

## 13. Failure Modes

### 13.1 Cross-tenant token confusion

Symptom:

```text
Valid token for tenant A accepted for tenant B
```

Causes:

- issuer validation missing;
- tenant claim not checked;
- audience too broad;
- client ID not tenant-bound;
- path tenant not compared with token tenant.

Mitigation:

```text
validate issuer + audience + client + tenant + membership + resource ownership
```

### 13.2 Subject collision

Two issuers produce same subject:

```text
issuer A, sub 123
issuer B, sub 123
```

If app keys user by `sub` only, accounts merge incorrectly.

Mitigation:

```text
unique identity = issuer + subject, optionally tenant + issuer + subject
```

### 13.3 Email-based account takeover

User from IdP A has same email as user from IdP B.

If auto-linking by email is enabled, attacker may link into victim account.

Mitigation:

- do not auto-link by email unless issuer/domain is verified and policy allows;
- require admin approval or verified linking flow;
- audit linking;
- preserve issuer/sub identity.

### 13.4 Shared role namespace breach

`ADMIN` in tenant A interpreted as platform admin.

Mitigation:

- tenant roles and platform roles separate;
- explicit authority namespace;
- no implicit global role mapping.

### 13.5 Tenant header spoofing

Public client sends:

```http
X-Tenant-Id: victim-tenant
```

Service trusts it.

Mitigation:

- strip tenant headers at gateway;
- only gateway may set internal tenant headers;
- sign internal context or use internal token;
- compare with authenticated token/session.

### 13.6 Misconfigured IdP metadata

Tenant config points to wrong issuer/JWKS.

Mitigation:

- metadata validation workflow;
- config review;
- test login before activation;
- config versioning;
- rollback;
- monitor issuer mismatch.

### 13.7 Stale membership after deprovisioning

User removed from tenant but token/session still valid.

Mitigation options:

- short token TTL;
- introspection;
- membership version check;
- session invalidation;
- event-driven deprovisioning;
- risk-based revalidation.

### 13.8 Tenant switch stale form submission

User opens form in tenant A, switches to tenant B in another tab, submits tenant A form.

Mitigation:

- include tenant in URL/form;
- validate form tenant against active session;
- reject mismatch;
- per-tab tenant context.

### 13.9 Cache namespace leak

Cache key lacks tenant prefix.

```text
cache key = case:123
```

Tenant A gets tenant B result.

Mitigation:

```text
cache key = tenant:agency-a:case:123
```

### 13.10 Connection pool tenant leakage

DB schema/session context not reset before connection returns to pool.

Mitigation:

- reset session state;
- use connection validation;
- wrapper tests;
- avoid dynamic schema if team cannot operate safely.

### 13.11 Queue consumer processes event under wrong tenant

Event lacks tenant context or consumer uses default tenant.

Mitigation:

- tenant required in event envelope;
- consumer rejects missing tenant;
- audit producer identity;
- dead-letter malformed events.

### 13.12 Platform support overreach

Support role can access all tenant data without approval.

Mitigation:

- break-glass workflow;
- reason code;
- time-boxed access;
- strong audit;
- tenant notification if policy requires.

---

## 14. Security Risks and Threat Modeling

### 14.1 Threat: token substitution

Attacker obtains token for tenant A and uses it on tenant B endpoint.

Controls:

- tenant binding;
- audience validation;
- path/session/token consistency;
- resource ownership check.

### 14.2 Threat: IdP mix-up

Login response from one IdP is accepted as if from another tenant.

Controls:

- bind auth request to expected tenant/issuer;
- validate `state` and `nonce`;
- validate exact issuer;
- separate redirect URI per tenant when possible;
- login transaction record.

### 14.3 Threat: malicious tenant admin

Tenant admin attempts to invite users, configure IdP, or manipulate claims to escalate.

Controls:

- tenant admin permissions limited;
- IdP config approval for high-risk changes;
- domain verification;
- role mapping review;
- audit config changes.

### 14.4 Threat: custom domain takeover

Tenant uses `login.customer.com`; DNS later points elsewhere or domain expires.

Controls:

- domain ownership verification;
- periodic verification;
- TLS certificate lifecycle;
- disable stale domains;
- monitor DNS changes.

### 14.5 Threat: SSRF through dynamic OIDC discovery

Attacker supplies issuer URL pointing to internal metadata endpoint.

Controls:

- issuer allowlist;
- no arbitrary discovery;
- network egress restrictions;
- metadata fetch through controlled admin workflow.

### 14.6 Threat: confused deputy

Service A has broad platform privilege and accepts tenant A request to perform tenant B action.

Controls:

- downstream token audience;
- token exchange preserving tenant;
- service authorization checks;
- no broad internal super-token;
- explicit delegation model.

### 14.7 Threat: cross-tenant analytics/reporting leak

Reporting endpoint aggregates data but filter is missing.

Controls:

- query policy layer;
- mandatory tenant filters;
- row-level security if appropriate;
- test datasets with overlapping IDs;
- report authorization.

### 14.8 Threat: AI/retrieval/tool leakage

Modern systems may add agentic features. Tenant context must gate retrieval/tool execution, not only UI display.

Controls:

- server-side tenant enforcement;
- retrieval-time tenant filters;
- tool-level authorization;
- no client-side-only filtering;
- per-tenant memory/context isolation.

---

## 15. Production Architecture Blueprint

### 15.1 Browser B2B SaaS with external IdP per tenant

```text
User enters email/domain
  -> tenant discovery
  -> redirect to tenant IdP
  -> OIDC auth code + PKCE
  -> callback validates state/nonce/issuer
  -> app maps issuer+sub to user
  -> app loads tenant membership
  -> session activeTenant set
  -> requests enforce tenant-bound authorization
```

Key controls:

- domain discovery not final proof;
- issuer allowlist;
- state/nonce tenant binding;
- membership check;
- active tenant session;
- resource tenant filter.

### 15.2 API resource server accepting multiple issuers

```text
Request with bearer token
  -> parse issuer hint
  -> check issuer registry
  -> select JwtDecoder
  -> validate signature/exp/aud/iss
  -> extract tenant claim
  -> compare with route/header/resource tenant
  -> build TenantAuthentication
  -> method/repository checks
```

Key controls:

- no arbitrary issuer;
- audience validation;
- tenant/client binding;
- decoder cache with invalidation;
- clear errors.

### 15.3 Government/regulatory case platform

```text
Agency user authenticates via government IdP
  -> platform maps user to agency, department, role
  -> session active agency
  -> case access filtered by agency + assignment + case status
  -> audit records actor, agency, legal role, case lifecycle state
```

Key controls:

- agency tenant boundary;
- assignment-level authorization;
- case lifecycle authorization;
- immutable audit;
- support impersonation governance;
- cross-agency operation approval.

### 15.4 Platform admin console

```text
Platform admin login
  -> platform role checked
  -> no tenant data access by default
  -> tenant support requires explicit tenant selection + reason
  -> break-glass approval if sensitive
  -> all actions high-risk audited
```

Key controls:

- platform admin not equivalent to tenant admin;
- reason code;
- time-boxing;
- audit;
- review.

### 15.5 Service-to-service with tenant propagation

```text
case-api receives user token tenant A
  -> validates token
  -> calls document-api using token exchange or internal signed context
  -> document-api validates caller workload + tenant context
  -> document-api enforces document tenant A
```

Key controls:

- workload auth via mTLS/service identity;
- end-user tenant context preserved;
- downstream audience;
- no unsigned tenant header over untrusted network.

---

## 16. Data Model Patterns

### 16.1 Tenant table

```sql
create table tenants (
  tenant_id varchar(100) primary key,
  display_name varchar(255) not null,
  status varchar(30) not null,
  created_at timestamp not null,
  updated_at timestamp not null
);
```

### 16.2 Tenant domain table

```sql
create table tenant_domains (
  tenant_id varchar(100) not null,
  domain varchar(255) not null,
  verified boolean not null,
  verification_method varchar(50),
  verified_at timestamp,
  primary key (domain),
  foreign key (tenant_id) references tenants(tenant_id)
);
```

### 16.3 Tenant IdP config

```sql
create table tenant_identity_providers (
  id varchar(100) primary key,
  tenant_id varchar(100) not null,
  provider_type varchar(30) not null,
  issuer varchar(500) not null,
  jwks_uri varchar(1000),
  metadata_url varchar(1000),
  status varchar(30) not null,
  config_version bigint not null,
  created_at timestamp not null,
  updated_at timestamp not null,
  unique (issuer),
  foreign key (tenant_id) references tenants(tenant_id)
);
```

### 16.4 External identities

```sql
create table external_identities (
  id varchar(100) primary key,
  user_id varchar(100) not null,
  tenant_id varchar(100),
  issuer varchar(500) not null,
  subject varchar(500) not null,
  email_at_link_time varchar(255),
  linked_at timestamp not null,
  last_seen_at timestamp,
  unique (issuer, subject)
);
```

If same issuer can reuse subject per tenant, use:

```sql
unique (tenant_id, issuer, subject)
```

### 16.5 Membership table

```sql
create table tenant_memberships (
  id varchar(100) primary key,
  tenant_id varchar(100) not null,
  user_id varchar(100) not null,
  status varchar(30) not null,
  role_set_version bigint not null,
  created_at timestamp not null,
  updated_at timestamp not null,
  unique (tenant_id, user_id)
);
```

### 16.6 Membership roles

```sql
create table tenant_membership_roles (
  membership_id varchar(100) not null,
  role_code varchar(100) not null,
  primary key (membership_id, role_code)
);
```

### 16.7 Audit event

```sql
create table auth_audit_events (
  event_id varchar(100) primary key,
  event_type varchar(100) not null,
  tenant_id varchar(100),
  user_id varchar(100),
  issuer varchar(500),
  subject varchar(500),
  client_id varchar(255),
  session_id_hash varchar(255),
  ip_address varchar(100),
  user_agent_hash varchar(255),
  outcome varchar(30) not null,
  reason_code varchar(100),
  correlation_id varchar(100),
  created_at timestamp not null
);
```

---

## 17. Audit Defensibility

### 17.1 What to audit

Audit events:

- tenant discovery;
- login started;
- login succeeded;
- login failed;
- tenant selected;
- tenant switched;
- token validation failed;
- membership denied;
- IdP config changed;
- role mapping changed;
- user invited;
- user removed;
- support access started;
- support access ended;
- cross-tenant access attempted;
- cross-tenant access approved;
- tenant disabled;
- tenant key/issuer changed.

### 17.2 Audit identity fields

Record:

```text
event_type
actor_user_id
actor_tenant_id
active_tenant_id
issuer
subject
client_id
authentication_method
assurance_level
session_id_hash
correlation_id
request_id
source_ip
user_agent_hash
outcome
reason
```

### 17.3 Avoid display-name-only audit

Bad:

```text
"John viewed case 123"
```

Better:

```text
actor_user_id = u-123
actor_display_name_at_time = John Tan
issuer = https://idp.agency-a.gov
subject = abc-456
tenant_id = agency-a
action = CASE_VIEWED
resource_id = case-123
```

### 17.4 Audit failed tenant mismatches

Failed tenant mismatch is high-signal:

```text
token tenant = A
requested tenant = B
```

This may indicate:

- bug;
- stale browser tab;
- attacker probing;
- integration misconfiguration;
- tenant switch issue.

### 17.5 Regulatory-grade audit invariant

For every sensitive action, you should be able to reconstruct:

```text
who acted,
under which tenant,
authenticated by which issuer,
using which session/client,
with which role/membership,
on which resource,
owned by which tenant,
at what time,
from where,
with what outcome,
and why it was allowed.
```

---

## 18. Testing Strategy

### 18.1 Unit tests

Test:

- tenant resolver;
- issuer allowlist;
- tenant claim mapping;
- audience validation;
- client binding;
- membership lookup;
- role mapping;
- tenant mismatch rejection.

### 18.2 Integration tests

Scenarios:

```text
valid tenant A token -> tenant A resource -> 200
valid tenant A token -> tenant B resource -> 403
unknown issuer token -> 401
valid issuer but wrong audience -> 401
valid token but no membership -> 403
valid membership suspended -> 403
path tenant != token tenant -> 403
header tenant spoofed -> rejected
```

### 18.3 Contract tests for external IdP

For each tenant IdP:

- discovery endpoint reachable;
- issuer exact match;
- JWKS reachable;
- expected claims present;
- group mapping works;
- clock skew tolerated;
- logout behavior known.

### 18.4 Cache isolation tests

Use same object IDs across tenants:

```text
tenant A case id = 123
tenant B case id = 123
```

Ensure cache never crosses.

### 18.5 Repository tenant filter tests

Create test data:

```text
A: case 1
B: case 1
```

Ensure query with tenant A never returns B.

### 18.6 Async/event tests

Test event missing tenant:

```text
consumer rejects event
```

Test wrong tenant event:

```text
event tenant A references resource tenant B -> reject/dead-letter
```

### 18.7 Browser session tests

Test:

- switch tenant;
- stale tab;
- logout active tenant;
- logout all tenants;
- session fixation;
- tenant in URL mismatch;
- CSRF with tenant switch.

---

## 19. Observability and Operations

### 19.1 Metrics

Important metrics:

```text
auth.login.success.count by tenant
auth.login.failure.count by tenant/reason
auth.token.validation.failure by issuer/reason
auth.tenant.mismatch.count
auth.unknown.issuer.count
auth.membership.denied.count
auth.idp.metadata.fetch.failure
auth.jwks.refresh.failure
auth.tenant.config.version
```

### 19.2 Alerts

Alert on:

- spike in tenant mismatch;
- unknown issuer attempts;
- JWKS fetch failure;
- IdP discovery failure;
- login failures for one tenant;
- support access outside business hours;
- platform admin cross-tenant actions;
- sudden role mapping change.

### 19.3 Logs

Log structured fields:

```json
{
  "event": "AUTH_TOKEN_REJECTED",
  "reason": "TENANT_MISMATCH",
  "requestedTenant": "agency-b",
  "tokenTenant": "agency-a",
  "issuer": "https://idp.agency-a.gov",
  "correlationId": "req-123"
}
```

Do not log raw tokens.

### 19.4 Tenant config deployment

Treat tenant auth config as critical infrastructure.

Recommended:

- versioned config;
- approval workflow;
- staging validation;
- automated smoke login;
- rollback;
- audit config changes;
- blast-radius analysis.

### 19.5 Emergency tenant disable

You need kill switches:

```text
disable tenant login
disable tenant tokens
disable issuer
disable client
disable membership
disable support access
```

---

## 20. Migration from Single-Tenant to Multi-Tenant

### 20.1 Phase 1: Introduce tenant model without changing auth

Add tenant tables and tenant ownership.

```text
resources gain tenant_id
users gain membership
queries gain tenant filter
```

### 20.2 Phase 2: Make tenant context explicit

Add request/session tenant context.

```text
TenantContext required for sensitive operations
```

### 20.3 Phase 3: Tenant-aware authorization

Move from global role to tenant membership.

```text
ROLE_ADMIN -> TENANT_ADMIN within tenant
```

### 20.4 Phase 4: Tenant-aware authentication

Introduce tenant-specific issuers/clients/IdPs.

### 20.5 Phase 5: Split trust config

Add registry:

```text
tenant -> issuer -> client -> claim mapping
```

### 20.6 Phase 6: Hardening

Add:

- mismatch rejection;
- audit;
- cache namespace;
- async tenant propagation;
- support governance;
- tests.

### 20.7 Backward compatibility

During migration:

```text
old tokens may lack tenant claim
```

Options:

1. derive tenant from session/user membership if single membership;
2. force tenant selection for multi-membership;
3. issue new token/session with tenant claim;
4. reject old token after cutover date.

---

## 21. Common Mistakes

### Mistake 1: Treating `tenant_id` claim as always trustworthy

It is only trustworthy after:

- signature validation;
- issuer validation;
- audience validation;
- client validation;
- tenant registry match.

### Mistake 2: Using email as unique identity

Email changes. Email can collide. Email can be reused.

Use:

```text
issuer + subject
```

### Mistake 3: Global roles in tenant app

`ADMIN` must not mean admin everywhere.

### Mistake 4: Letting public caller choose tenant by header

Unsigned tenant headers are not authentication.

### Mistake 5: Trusting gateway headers without network enforcement

Internal headers are safe only if spoofing is impossible.

### Mistake 6: No tenant prefix in cache

This causes silent, catastrophic leaks.

### Mistake 7: Repository loads by object ID only

Every tenant-owned query must include tenant.

### Mistake 8: Auto-linking account by email across issuers

This can cause account takeover.

### Mistake 9: Dynamic OIDC discovery from token issuer

This can cause trust injection or SSRF.

### Mistake 10: Platform admin bypass without audit

This destroys defensibility.

---

## 22. Decision Framework

### 22.1 Questions to ask first

1. What is the tenant boundary?
2. Can a user belong to multiple tenants?
3. Does each tenant bring its own IdP?
4. Are roles managed in IdP or application?
5. Is tenant isolation legal/compliance critical?
6. How many tenants are expected?
7. Does each tenant need custom login policy?
8. Do tenants need custom domains?
9. Is cross-tenant support access required?
10. What is the blast radius of tenant config error?

### 22.2 Choose tenant resolution

| Requirement | Recommended resolution |
|---|---|
| B2B custom branding | subdomain/custom domain |
| REST API explicitness | path tenant + token validation |
| Internal service call | signed internal token or trusted header + mTLS |
| User has many workspaces | post-login tenant switcher |
| External IdP routing | email/domain discovery then issuer validation |

### 22.3 Choose IdP tenancy model

| Requirement | Better model |
|---|---|
| Strong isolation | realm per tenant |
| Many small tenants | shared realm + org/client per tenant |
| Customer SSO | external IdP per tenant |
| Shared user pool | shared realm/org model |
| Strict compliance | separate issuer/key/admin boundary |
| Frequent cross-tenant users | app-managed memberships |

### 22.4 Choose role source

| Requirement | Better source |
|---|---|
| Simple SaaS roles | app membership DB |
| Enterprise group sync | IdP groups mapped to app roles |
| Regulatory workflow | app policy engine with tenant/resource state |
| High revocation need | DB/introspection/session revalidation |

### 22.5 Choose propagation model

| Architecture | Recommended tenant propagation |
|---|---|
| Monolith | session/security context + repository tenant filters |
| Spring microservices | JWT/internal token with tenant claim + audience |
| Service mesh | mTLS workload + app token tenant context |
| Event-driven | event envelope tenant ID + actor context |
| Batch | job execution tenant scope + audit actor |

---

## 23. Production Checklist

### 23.1 Tenant resolution

- [ ] Tenant source is defined per entry point.
- [ ] Public caller cannot select tenant by unsigned header only.
- [ ] Host/path/token/session tenant conflicts are rejected.
- [ ] Unknown tenant is rejected.
- [ ] Tenant registry is authoritative.

### 23.2 Token validation

- [ ] Issuer is allowlisted.
- [ ] JWKS/discovery is not arbitrary from attacker-controlled issuer.
- [ ] Audience is validated.
- [ ] Client ID is validated.
- [ ] Tenant claim is validated against tenant config.
- [ ] Clock skew is controlled.
- [ ] Decoder cache invalidation exists.

### 23.3 Identity model

- [ ] User identity separates internal user, external identity, membership, session.
- [ ] External identity uniqueness includes issuer and subject.
- [ ] Email is not the only identity key.
- [ ] Membership lifecycle is modeled.
- [ ] Active tenant is explicit.

### 23.4 Authorization

- [ ] Roles are tenant-scoped.
- [ ] Platform roles are separate.
- [ ] Repository queries include tenant filters.
- [ ] Cache keys include tenant namespace.
- [ ] Cross-tenant operations require explicit policy.

### 23.5 Session/browser

- [ ] Tenant switch is audited.
- [ ] Stale tab behavior is handled.
- [ ] Logout semantics are explicit.
- [ ] Session fixation protections exist.
- [ ] Tenant-specific cookie/domain strategy is reviewed.

### 23.6 Async/distributed

- [ ] Tenant context propagates to downstream services.
- [ ] Internal tenant headers are protected or replaced by signed context.
- [ ] Events include tenant context.
- [ ] Consumers reject missing tenant.
- [ ] DB connection tenant state is reset.

### 23.7 Operations

- [ ] Tenant auth config is versioned.
- [ ] Config changes are audited.
- [ ] Tenant disable switch exists.
- [ ] Unknown issuer and tenant mismatch metrics exist.
- [ ] Support/break-glass is governed.

---

## 24. Design Questions

Use these questions in architecture review.

### 24.1 Identity and trust

1. What uniquely identifies a user?
2. Is it `sub`, `email`, `issuer + sub`, or app user ID?
3. Can the same person have multiple external identities?
4. Can multiple persons share an email over time?
5. Who is allowed to link identities?
6. Is identity linking audited?

### 24.2 Tenant boundary

1. What exactly is a tenant?
2. Is tenant equal to organization, customer, agency, workspace, or realm?
3. Can one tenant have multiple organizations?
4. Can one organization have multiple tenants?
5. What data must never cross tenant boundary?

### 24.3 Authentication flow

1. How is tenant discovered before login?
2. How is tenant confirmed after login?
3. What happens if discovery tenant and token tenant differ?
4. Are `state` and `nonce` bound to tenant?
5. Are redirect URIs tenant-specific?

### 24.4 Token validation

1. Which issuers are trusted?
2. How are issuers onboarded?
3. How are JWKS cached?
4. How are keys rotated?
5. How is emergency issuer disable done?

### 24.5 Authorization

1. Are roles tenant-scoped?
2. Are platform roles separated?
3. Does every resource query include tenant?
4. Are cross-tenant operations explicit?
5. Is support access time-boxed and audited?

### 24.6 Operations

1. How do you detect cross-tenant attempts?
2. How do you disable a tenant quickly?
3. How do you rollback IdP config?
4. How do you test each tenant IdP?
5. How do you prove who accessed what under which tenant?

---

## 25. Worked Example: Multi-Tenant Case Management Platform

Imagine a regulatory case management platform.

Tenants:

```text
agency-a
agency-b
agency-c
```

Users:

```text
Alice: agency-a case officer
Bob: agency-b supervisor
Carol: platform support
Dan: agency-a and agency-b reviewer
```

Resources:

```text
case-100 belongs to agency-a
case-200 belongs to agency-b
```

### 25.1 Login

Alice accesses:

```text
https://agency-a.platform.gov/login
```

Resolution:

```text
host tenant = agency-a
```

Platform loads:

```text
tenant agency-a issuer = https://idp.agency-a.gov
client = agency-a-web
```

Alice authenticates. Callback returns token:

```json
{
  "iss": "https://idp.agency-a.gov",
  "sub": "alice-001",
  "aud": "platform-web",
  "azp": "agency-a-web",
  "agency_code": "agency-a"
}
```

Validation:

```text
issuer allowed for agency-a: yes
audience allowed: yes
client allowed: yes
agency_code == agency-a: yes
membership active: yes
```

Session:

```text
user_id = u-alice
active_tenant = agency-a
roles = CASE_OFFICER
```

### 25.2 Valid access

```http
GET /tenants/agency-a/cases/case-100
```

Checks:

```text
path tenant == session tenant
case tenant == agency-a
role CASE_OFFICER can view
```

Allow.

### 25.3 Invalid cross-tenant access

```http
GET /tenants/agency-b/cases/case-200
```

Checks:

```text
path tenant agency-b != session tenant agency-a
```

Reject and audit.

### 25.4 Multi-membership user

Dan belongs to agency-a and agency-b.

Login produces identity but not active tenant.

System shows tenant selector:

```text
Choose active agency:
- agency-a
- agency-b
```

Dan selects agency-b. Session active tenant is agency-b.

### 25.5 Support access

Carol is platform support.

She cannot directly open agency-a case.

She must:

```text
open support ticket
select tenant agency-a
provide reason
request time-boxed access
```

Audit:

```text
real_actor = Carol
support_tenant = platform
target_tenant = agency-a
reason = ticket-123
```

---

## 26. Anti-Pattern Catalog

### 26.1 “JWT valid means request allowed”

Wrong because JWT validity does not prove tenant/resource authorization.

### 26.2 “Tenant is just a UI filter”

Wrong because backend, DB, cache, queue, and audit must enforce tenant.

### 26.3 “Use email domain as tenant proof”

Wrong because email domain is routing hint, not proof.

### 26.4 “One global admin role is simpler”

Simpler, but dangerous. Separate platform and tenant administration.

### 26.5 “All services trust X-Tenant-Id”

Dangerous unless header is protected by network and gateway policy.

### 26.6 “Same issuer means same tenant”

False for shared issuer/organization models.

### 26.7 “Same subject means same user”

False across issuers.

### 26.8 “Token has all roles, no DB check needed”

May be acceptable for low-risk systems, but dangerous for high-revocation/high-compliance systems.

### 26.9 “Support can access everything because they are trusted”

Trust is not control. Use governance and audit.

### 26.10 “We will add tenant isolation later”

Retrofitting tenant isolation is expensive. Design identity/resource models early.

---

## 27. Source Grounding

This part is grounded in the following authoritative or widely used references:

1. Spring Security OAuth2 Resource Server Multi-tenancy documentation  
   https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/multitenancy.html

2. OpenID Connect Core 1.0  
   https://openid.net/specs/openid-connect-core-1_0.html

3. OAuth 2.0 Security Best Current Practice, RFC 9700  
   https://datatracker.ietf.org/doc/rfc9700/

4. OWASP Multi Tenant Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

5. OWASP API Security Top 10 2023 — Broken Object Level Authorization  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

6. Keycloak Organizations announcement and Keycloak documentation  
   https://www.keycloak.org/2024/06/announcement-keycloak-organizations  
   https://www.keycloak.org/documentation

7. Microsoft identity platform OIDC documentation  
   https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc

The main lesson shared across these sources is that multi-tenant resource servers must select validation strategy by tenant/issuer, OIDC tokens must be validated against issuer/audience/client semantics, and multi-tenant systems must enforce tenant isolation beyond authentication itself.

---

## 28. Summary

Multi-tenant authentication is the art of binding identity to the correct trust boundary.

The most important invariants are:

```text
1. Identity without tenant context is incomplete.
2. Subject without issuer is unsafe.
3. Role without tenant scope is dangerous.
4. Token validity does not imply resource access.
5. Tenant resolution must be deterministic and conflict-aware.
6. Public callers must not choose tenant by unsigned header.
7. Issuers and JWKS must be allowlisted, not discovered from attacker-controlled input.
8. Every tenant-owned query/cache/event must include tenant context.
9. Platform admin and tenant admin are different identities.
10. Audit must prove who acted under which tenant and why access was allowed.
```

A top-tier engineer does not ask only:

```text
Can this token be verified?
```

They ask:

```text
Verified by whom?
For which tenant?
For which client?
For which audience?
For which active membership?
Against which resource tenant?
Under which policy?
With what audit evidence?
```

That is the difference between authentication that works in a demo and authentication that survives real enterprise, government, SaaS, and regulatory environments.

---

## 29. Status

```text
Part 26 complete.
Series status: not complete.
Next part: Part 27 — Authentication in Microservices and Distributed Systems.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-025.md">⬅️ Part 25 — Identity Provider Integration Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-027.md">Part 27 — Authentication in Microservices and Distributed Systems ➡️</a>
</div>
