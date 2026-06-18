# learn-java-jakarta-part-017.md

# Bagian 17 — Jakarta Security (`jakarta.security.enterprise`): Authentication, Identity Store, dan Security Boundary

> Target pembaca: Java engineer yang ingin memahami security di Jakarta EE secara production-grade: bukan hanya `@RolesAllowed`, tetapi bagaimana **authentication**, **identity store**, **security context**, **caller principal**, **roles/groups**, **Servlet/JAX-RS/CDI integration**, dan **authorization boundary** bekerja.
>
> Fokus bagian ini: Jakarta Security 4.0 di Jakarta EE 11, `jakarta.security.enterprise.*`, HTTP authentication mechanisms, identity stores, `SecurityContext`, built-in mechanisms, custom mechanism, OpenID Connect/OIDC, role mapping, password hashing, CDI integration, Servlet/JAX-RS integration, threat model, testing, observability, dan production failure modes.

---

## Daftar Isi

1. [Orientasi: Security Bukan Sekadar Login](#1-orientasi-security-bukan-sekadar-login)
2. [Mental Model: Authentication, Identity, Principal, Group, Role, Authorization](#2-mental-model-authentication-identity-principal-group-role-authorization)
3. [Jakarta Security 4.0 dalam Jakarta EE 11](#3-jakarta-security-40-dalam-jakarta-ee-11)
4. [Jakarta Security vs Servlet Security vs Jakarta Authentication vs Jakarta Authorization](#4-jakarta-security-vs-servlet-security-vs-jakarta-authentication-vs-jakarta-authorization)
5. [Dependency, Packaging, dan Runtime](#5-dependency-packaging-dan-runtime)
6. [Peta API `jakarta.security.enterprise`](#6-peta-api-jakartasecurityenterprise)
7. [`SecurityContext`: Programmatic Security Access Point](#7-securitycontext-programmatic-security-access-point)
8. [Caller Principal dan Roles](#8-caller-principal-dan-roles)
9. [HTTP Authentication Mechanism](#9-http-authentication-mechanism)
10. [Built-in Authentication Mechanisms](#10-built-in-authentication-mechanisms)
11. [Multiple Authentication Mechanisms di Jakarta Security 4.0](#11-multiple-authentication-mechanisms-di-jakarta-security-40)
12. [Identity Store](#12-identity-store)
13. [Built-in Identity Stores](#13-built-in-identity-stores)
14. [In-Memory Identity Store](#14-in-memory-identity-store)
15. [Database Identity Store](#15-database-identity-store)
16. [LDAP Identity Store](#16-ldap-identity-store)
17. [Custom Identity Store](#17-custom-identity-store)
18. [Password Hashing](#18-password-hashing)
19. [Authentication Flow: Request → Mechanism → Identity Store → Principal](#19-authentication-flow-request--mechanism--identity-store--principal)
20. [Declarative Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `@DeclareRoles`](#20-declarative-security-rolesallowed-permitall-denyall-declareroles)
21. [Programmatic Authorization](#21-programmatic-authorization)
22. [Jakarta Security dan Servlet Integration](#22-jakarta-security-dan-servlet-integration)
23. [Jakarta Security dan Jakarta REST Integration](#23-jakarta-security-dan-jakarta-rest-integration)
24. [Jakarta Security dan CDI Integration](#24-jakarta-security-dan-cdi-integration)
25. [OpenID Connect / OIDC](#25-openid-connect--oidc)
26. [Keycloak / External IdP Integration Mental Model](#26-keycloak--external-idp-integration-mental-model)
27. [JWT, Session, Cookie, dan Token Boundary](#27-jwt-session-cookie-dan-token-boundary)
28. [Role Mapping dan Group Mapping](#28-role-mapping-dan-group-mapping)
29. [Security Boundary di Layered Architecture](#29-security-boundary-di-layered-architecture)
30. [Authentication vs Authorization vs Domain Policy](#30-authentication-vs-authorization-vs-domain-policy)
31. [Multi-Tenancy dan Data-Level Security](#31-multi-tenancy-dan-data-level-security)
32. [CSRF, CORS, XSS, Session Fixation, dan Header Security](#32-csrf-cors-xss-session-fixation-dan-header-security)
33. [Password, Credential, Secret, dan Account Lifecycle](#33-password-credential-secret-dan-account-lifecycle)
34. [Observability dan Audit Security](#34-observability-dan-audit-security)
35. [Testing Strategy](#35-testing-strategy)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices dan Anti-Patterns](#37-best-practices-dan-anti-patterns)
38. [Checklist Review](#38-checklist-review)
39. [Case Study 1: REST API dengan OIDC dan Role-Based Access](#39-case-study-1-rest-api-dengan-oidc-dan-role-based-access)
40. [Case Study 2: Form Login Legacy ke Jakarta Security](#40-case-study-2-form-login-legacy-ke-jakarta-security)
41. [Case Study 3: Role Ada, Tapi Data Masih Bocor](#41-case-study-3-role-ada-tapi-data-masih-bocor)
42. [Case Study 4: Custom Header Authentication yang Berbahaya](#42-case-study-4-custom-header-authentication-yang-berbahaya)
43. [Latihan Bertahap](#43-latihan-bertahap)
44. [Mini Project: Jakarta Security Lab](#44-mini-project-jakarta-security-lab)
45. [Referensi Resmi](#45-referensi-resmi)

---

# 1. Orientasi: Security Bukan Sekadar Login

Banyak developer menyederhanakan security menjadi:

```text
login berhasil → boleh akses
```

Padahal security production jauh lebih luas.

Pertanyaan yang benar:

1. Siapa caller-nya?
2. Bagaimana caller membuktikan identitas?
3. Credential apa yang dipakai?
4. Di mana identity disimpan?
5. Role/group apa yang dimiliki?
6. Apakah role tersebut cukup untuk endpoint ini?
7. Apakah caller boleh mengakses resource spesifik ini?
8. Apakah tenant/jurisdiction/ownership sesuai?
9. Apakah request bisa dipalsukan?
10. Apakah token/cookie/session aman?
11. Apakah audit mencatat keputusan security?
12. Apakah failure mode aman?
13. Apakah security bisa diuji otomatis?

Jakarta Security membantu menstandarkan beberapa bagian dari pertanyaan tersebut, terutama:

- HTTP authentication mechanism;
- identity store;
- password hashing;
- injectable `SecurityContext`;
- integration dengan Servlet/Jakarta EE environment.

## 1.1 Kenapa Jakarta Security penting?

Sebelum Jakarta Security, banyak aplikasi Jakarta EE mengandalkan kombinasi:

- Servlet security;
- container realm;
- JAAS;
- vendor-specific login module;
- custom filter;
- framework sendiri;
- deployment descriptor;
- proprietary server configuration.

Akibatnya portability rendah.

Jakarta Security memberikan API standard yang lebih modern dan CDI-friendly.

## 1.2 Apa yang diselesaikan Jakarta Security?

Jakarta Security menyediakan standard untuk:

- membuat secure Jakarta EE applications;
- mendefinisikan authentication mechanism portable;
- mendefinisikan identity store portable;
- mengakses caller security information via `SecurityContext`;
- menggunakan built-in authentication mechanisms;
- mengintegrasikan authentication dengan Jakarta EE container.

## 1.3 Apa yang tidak diselesaikan sepenuhnya?

Jakarta Security bukan full IAM platform.

Ia tidak menggantikan:

- identity provider seperti Keycloak/Okta/Auth0/Entra ID;
- authorization policy engine penuh;
- secrets manager;
- SIEM;
- WAF;
- API gateway;
- OAuth/OIDC governance;
- data classification;
- threat modeling;
- secure SDLC.

Ia adalah application security API di Jakarta EE.

---

# 2. Mental Model: Authentication, Identity, Principal, Group, Role, Authorization

Security sering membingungkan karena istilah bercampur.

## 2.1 Authentication

Authentication menjawab:

```text
Who are you, and can you prove it?
```

Contoh bukti:

- username/password;
- client certificate;
- bearer token;
- session cookie;
- OIDC authorization code;
- SAML assertion;
- API key;
- mutual TLS.

## 2.2 Identity

Identity adalah representasi caller.

Contoh:

```text
user: fajar
service account: case-syncer
client app: mobile-app
external agency system: agency-x
```

## 2.3 Principal

Principal adalah object yang merepresentasikan caller dalam Java security context.

```java
Principal principal = securityContext.getCallerPrincipal();
```

atau Servlet:

```java
Principal principal = request.getUserPrincipal();
```

## 2.4 Group

Group biasanya datang dari identity store/IdP.

Contoh:

```text
cea-officer
cea-supervisor
admin
case-reviewer
```

Group adalah membership identity.

## 2.5 Role

Role adalah authorization abstraction dalam application/container.

Contoh:

```text
OFFICER
SUPERVISOR
ADMIN
SYSTEM
```

Group sering dipetakan ke role.

## 2.6 Permission

Permission lebih granular:

```text
case:approve
case:view-sensitive
document:download
profile:update
```

Jakarta role annotation biasanya role-based, bukan permission engine lengkap.

## 2.7 Authorization

Authorization menjawab:

```text
Are you allowed to do this action on this resource?
```

Ada beberapa level:

- endpoint-level authorization;
- method-level authorization;
- resource-level authorization;
- field-level authorization;
- data-level authorization;
- workflow/state authorization.

## 2.8 Domain policy

Domain policy adalah authorization yang membutuhkan business context.

Contoh:

```text
Officer boleh approve case hanya jika:
- role OFFICER;
- officer assigned ke case;
- case status REVIEW_PENDING;
- jurisdiction sama;
- officer bukan applicant;
- approval deadline belum lewat.
```

Ini tidak cukup dengan:

```java
@RolesAllowed("OFFICER")
```

Perlu application/domain policy.

---

# 3. Jakarta Security 4.0 dalam Jakarta EE 11

Jakarta Security 4.0 adalah release untuk Jakarta EE 11.

Jakarta Security mendefinisikan standard untuk membuat secure Jakarta EE applications dalam modern application paradigms.

## 3.1 Fitur baru/enhancement penting 4.0

Jakarta Security 4.0 mencatat fitur seperti:

- basic API/handler untuk multiple authentication mechanisms;
- qualifiers untuk built-in authentication mechanisms;
- in-memory identity store.

## 3.2 Kenapa multiple authentication mechanisms penting?

Aplikasi modern bisa butuh lebih dari satu mekanisme:

- Basic auth untuk internal health/admin tool;
- OIDC untuk user browser;
- bearer token untuk API;
- mTLS untuk service-to-service;
- form login untuk legacy page.

Jakarta Security 4.0 mulai menyediakan model lebih baik untuk hal ini.

## 3.3 Kenapa qualifiers penting?

Jika ada beberapa built-in mechanisms, qualifier membantu membedakan dan memilih mechanism CDI bean yang sesuai.

## 3.4 In-memory identity store

Useful untuk:

- tests;
- examples;
- dev;
- small demos;
- bootstrap.

Tidak cocok untuk production identity management.

## 3.5 Jakarta Security 5.0

Jakarta Security 5.0 under development untuk Jakarta EE 12. Untuk Jakarta EE 11, targetkan Security 4.0.

---

# 4. Jakarta Security vs Servlet Security vs Jakarta Authentication vs Jakarta Authorization

Security di Jakarta EE terdiri dari beberapa spesifikasi/layer.

## 4.1 Jakarta Security

High-level application security API.

Fokus:

- authentication mechanism;
- identity store;
- password hashing;
- security context;
- CDI-friendly integration.

Package:

```java
jakarta.security.enterprise
```

## 4.2 Servlet Security

Security untuk web/Servlet resources.

Fokus:

- `web.xml` security constraints;
- `@ServletSecurity`;
- `HttpServletRequest` programmatic security;
- form/basic auth integration;
- session/security roles.

Package:

```java
jakarta.servlet
jakarta.servlet.http
jakarta.servlet.annotation
```

## 4.3 Jakarta Authentication

Lower-level authentication SPI.

Sebelumnya JASPIC/Jakarta Authentication.

Fokus lebih rendah:

- message authentication;
- server auth modules;
- container integration.

Package:

```java
jakarta.security.auth.message
```

## 4.4 Jakarta Authorization

Authorization provider APIs, lebih dekat ke policy/permission infrastructure.

Package terkait authorization standard.

## 4.5 Jakarta Security sebagai simplifier

Jakarta Security dibangun untuk membuat common application security lebih mudah dan portable dibanding langsung memakai lower-level SPI.

## 4.6 Practical rule

Untuk kebanyakan aplikasi:

- gunakan Jakarta Security untuk authentication/identity store/security context;
- gunakan Jakarta annotations/Servlet/JAX-RS untuk role-based access;
- gunakan application/domain policy untuk resource-level authorization;
- gunakan IdP external untuk enterprise identity.

---

# 5. Dependency, Packaging, dan Runtime

## 5.1 Maven dependency

Individual API:

```xml
<dependency>
  <groupId>jakarta.security.enterprise</groupId>
  <artifactId>jakarta.security.enterprise-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

Dalam Jakarta EE 11 runtime, API biasanya tersedia lewat Platform/Web Profile API.

## 5.2 Runtime implementation

API jar bukan implementation.

Kamu butuh compatible runtime/security implementation.

Contoh implementation historically:

- Eclipse Soteria;
- runtime integration di GlassFish/Payara/Open Liberty/WildFly/vendor lain.

## 5.3 Scope `provided`

Untuk app yang deploy ke Jakarta EE runtime:

```xml
<scope>provided</scope>
```

## 5.4 Embedded/non-Jakarta runtime

Jika memakai custom runtime, pastikan security provider tersedia dan terintegrasi dengan Servlet/CDI.

## 5.5 Security config is runtime-sensitive

Security bukan sekadar dependency.

Perlu:

- HTTPS/TLS config;
- identity store config;
- realm/provider config;
- cookie/session config;
- reverse proxy config;
- trust proxy header config;
- SameSite/secure flag;
- role mapping;
- CORS/CSRF strategy;
- audit logging.

## 5.6 Avoid vendor lock-in accidentally

Jakarta Security memberikan standard API, tetapi runtime config bisa vendor-specific.

Document vendor-specific config in ADR.

---

# 6. Peta API `jakarta.security.enterprise`

Package utama:

```text
jakarta.security.enterprise
jakarta.security.enterprise.authentication.mechanism.http
jakarta.security.enterprise.authentication.mechanism.http.openid
jakarta.security.enterprise.credential
jakarta.security.enterprise.identitystore
```

## 6.1 Core package

Berisi:

- `SecurityContext`;
- authentication status/response concepts;
- caller/credential validation concepts.

## 6.2 HTTP authentication mechanism package

Berisi:

- `HttpAuthenticationMechanism`;
- `HttpMessageContext`;
- built-in mechanism definitions;
- remember-me related annotations;
- login-to-continue support;
- multiple-mechanism support in newer API.

## 6.3 OpenID package

Berisi annotation/config untuk OIDC authentication mechanism.

## 6.4 Credential package

Berisi credential classes, misalnya username/password credential.

## 6.5 Identity store package

Berisi:

- `IdentityStore`;
- `CredentialValidationResult`;
- built-in identity store definitions;
- password hash APIs.

## 6.6 Mental map

```text
HttpAuthenticationMechanism:
  extracts credentials from HTTP request
  asks IdentityStore or validates token
  tells container authentication result

IdentityStore:
  validates credential
  returns caller identity/groups

SecurityContext:
  lets application ask who caller is and what roles they have
```

---

# 7. `SecurityContext`: Programmatic Security Access Point

`SecurityContext` adalah injectable type untuk programmatic security.

## 7.1 Basic usage

```java
@Inject
SecurityContext securityContext;

public String currentUser() {
    Principal principal = securityContext.getCallerPrincipal();
    return principal != null ? principal.getName() : "anonymous";
}
```

## 7.2 Check role

```java
if (securityContext.isCallerInRole("ADMIN")) {
    ...
}
```

## 7.3 Check authenticated

Depending API methods:

```java
boolean authenticated = securityContext.getCallerPrincipal() != null;
```

or use provided methods in target API version.

## 7.4 Why use `SecurityContext`?

Compared to directly using `HttpServletRequest`, `SecurityContext` is more Jakarta Security-oriented and injectable in managed components.

Example application service:

```java
@ApplicationScoped
public class CurrentActorProvider {

    @Inject
    SecurityContext securityContext;

    public Actor currentActor() {
        Principal p = securityContext.getCallerPrincipal();
        if (p == null) {
            throw new UnauthenticatedException();
        }
        return new Actor(p.getName(), roles());
    }
}
```

## 7.5 SecurityContext is not domain policy

`securityContext.isCallerInRole("OFFICER")` answers role membership.

It does not answer:

```text
Can this officer approve this specific case?
```

That needs domain/application policy.

## 7.6 Do not overuse SecurityContext deep in domain

Avoid injecting `SecurityContext` into domain model.

Better:

```java
Actor actor = currentActorProvider.currentActor();
useCase.handle(actor, command);
```

Domain receives actor explicitly.

---

# 8. Caller Principal dan Roles

## 8.1 Caller principal

Principal represents authenticated caller.

```java
Principal p = securityContext.getCallerPrincipal();
```

Principal name may be:

- username;
- subject;
- email;
- OIDC sub;
- service account;
- external ID.

Do not assume email unless configured.

## 8.2 Role

Role is checked by:

```java
securityContext.isCallerInRole("ADMIN")
```

or declarative annotations.

## 8.3 Group to role mapping

Identity store may return groups.

Container maps groups to roles depending configuration/spec/runtime.

## 8.4 Principal stability

Use stable ID for authorization/audit.

Email can change.

OIDC `sub` is usually more stable than email.

## 8.5 Display name vs identity key

Do not use display name as primary identity.

Store:

```text
subject/id
issuer
username/email
display name
groups/roles
```

## 8.6 Service accounts

Not all callers are humans.

Model:

```text
actorType = USER | SERVICE | SYSTEM
```

Audit accordingly.

---

# 9. HTTP Authentication Mechanism

`HttpAuthenticationMechanism` is the Jakarta Security SPI that handles HTTP authentication.

## 9.1 What it does

It processes incoming request and decides:

- credential present?
- authenticate?
- continue unauthenticated?
- challenge?
- redirect?
- fail?
- notify container?

## 9.2 Custom mechanism skeleton

```java
@ApplicationScoped
public class ApiKeyAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    IdentityStoreHandler identityStoreHandler;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        String apiKey = request.getHeader("X-API-Key");

        if (apiKey == null) {
            return context.doNothing();
        }

        CredentialValidationResult result =
            identityStoreHandler.validate(new ApiKeyCredential(apiKey));

        if (result.getStatus() == CredentialValidationResult.Status.VALID) {
            return context.notifyContainerAboutLogin(
                result.getCallerPrincipal(),
                result.getCallerGroups()
            );
        }

        return context.responseUnauthorized();
    }
}
```

Exact credential support may require custom classes/provider.

## 9.3 Built-in mechanisms preferable

Do not write custom mechanism if built-in OIDC/basic/form mechanism fits.

Custom authentication is security-sensitive.

## 9.4 Mechanism must be deterministic

For each request, mechanism should clearly decide:

- authenticated;
- not attempted;
- challenge;
- failure.

Ambiguous behavior creates bypass risk.

## 9.5 Do not trust headers from client

Header auth is dangerous unless header is set by trusted upstream and stripped from external requests.

Example bad:

```http
X-User: admin
```

Anyone can send this unless proxy strips/sets it.

---

# 10. Built-in Authentication Mechanisms

Jakarta Security provides built-in mechanism definitions.

Common categories:

- Basic authentication;
- Form authentication;
- Custom form authentication;
- OpenID Connect authentication;
- Remember-me support depending config.

## 10.1 Basic auth

Good for:

- internal tools;
- simple service endpoints over HTTPS;
- tests.

Not ideal for public user login UX.

## 10.2 Form auth

Good for traditional server-rendered web apps.

Needs CSRF and session security.

## 10.3 Custom form auth

Allows more customized login page/flow.

## 10.4 OIDC

Good for modern enterprise identity integration.

OIDC delegates identity to external provider.

## 10.5 Bearer token APIs

Jakarta Security/OIDC integration may handle token-based flows depending runtime/config.

For REST APIs with JWT bearer, also consider MicroProfile JWT or vendor-specific integration if using MicroProfile stack.

## 10.6 Choose mechanism by client type

| Client | Mechanism |
|---|---|
| Browser enterprise SSO | OIDC |
| Legacy server-rendered app | Form/OIDC |
| Internal script | Basic over TLS or token |
| Service-to-service | mTLS/JWT/client credentials |
| Public SPA/mobile | OIDC/OAuth patterns via gateway/backend |

---

# 11. Multiple Authentication Mechanisms di Jakarta Security 4.0

Jakarta Security 4.0 adds API support for multiple authentication mechanisms.

## 11.1 Why this matters

A single app may have:

```text
/admin/*     → Basic or form
/api/*       → bearer token
/ui/*        → OIDC
/internal/*  → mTLS or API key
```

## 11.2 Danger before multiple support

Without clear multiple mechanism model, teams often write messy custom filter chain.

Risks:

- wrong path matching;
- authentication bypass;
- wrong challenge;
- mechanism conflict;
- session/token confusion.

## 11.3 Design rule

Define clear authentication zones:

```text
UI zone
API zone
Internal zone
Health zone
```

Each zone has:

- allowed mechanism;
- path pattern;
- required auth;
- roles;
- CSRF/CORS policy;
- session/token policy.

## 11.4 Priority/order

If multiple mechanisms can apply, ordering matters.

Example:

- If Authorization header exists, try bearer.
- Else if session exists, use OIDC/form.
- Else challenge appropriate mechanism for endpoint.

## 11.5 Test combinations

Test:

- no credential;
- invalid credential;
- valid basic on OIDC path;
- bearer token on UI path;
- session on API path;
- expired token;
- conflicting credentials.

---

# 12. Identity Store

Identity Store is component that accesses application-specific security data such as users, groups, roles, and permissions.

It can be thought of as security-specific DAO.

## 12.1 What identity store validates

Identity store may validate:

- username/password;
- token;
- certificate identity;
- API key;
- custom credential.

## 12.2 What identity store returns

Typically:

- validation status;
- caller principal;
- groups;
- metadata.

Example conceptual:

```text
credential: username/password
  ↓
identity store validates password
  ↓
returns VALID principal fajar groups [OFFICER, REVIEWER]
```

## 12.3 Identity store is not application repository

Do not mix user identity persistence with business repositories carelessly.

Identity has lifecycle and security requirements:

- password hashing;
- account lockout;
- rotation;
- MFA;
- audit;
- provisioning;
- deprovisioning.

## 12.4 External identity provider

For enterprise apps, identity often comes from:

- LDAP/Active Directory;
- OIDC provider;
- SAML IdP;
- IAM platform;
- government identity provider.

Jakarta Security can integrate, but identity governance is external.

## 12.5 Multiple stores

Apps may use multiple identity sources.

Example:

- database users for admin bootstrap;
- LDAP for employees;
- OIDC for citizens;
- API key store for integrations.

Multiple identity store behavior must be explicit.

---

# 13. Built-in Identity Stores

Jakarta Security has built-in identity store definitions for common cases.

## 13.1 Database identity store

Validates users/groups from database.

## 13.2 LDAP identity store

Validates against LDAP directory.

## 13.3 In-memory identity store

Added in Jakarta Security 4.0.

Good for dev/test/examples.

## 13.4 Built-in vs custom

Use built-in when it fits.

Use custom only when:

- credential model custom;
- identity source custom;
- mapping complex;
- external service integration;
- provider limitation.

## 13.5 Security warning

Built-in does not remove need for secure configuration:

- TLS to LDAP/database;
- least privilege DB user;
- password hash algorithm;
- query parameterization;
- account lockout;
- logging discipline.

---

# 14. In-Memory Identity Store

In-memory store is useful for:

- learning;
- local dev;
- test;
- sample app;
- smoke test.

## 14.1 Example concept

```java
@InMemoryIdentityStoreDefinition({
    @Credentials(
        callerName = "admin",
        password = "secret",
        groups = {"ADMIN"}
    )
})
```

Exact annotation structure should follow Jakarta Security 4.0 API docs/runtime support.

## 14.2 Not for production

Do not ship hardcoded users/passwords.

## 14.3 Good test use

Use in-memory store to test:

- login success;
- role checks;
- forbidden access;
- unauthenticated access.

## 14.4 Avoid committing real secrets

Even for dev, don't use real password.

## 14.5 Password hashing

If in-memory definition stores encoded/hash password, ensure correct hashing config. For simple test, still avoid using production-like secrets.

---

# 15. Database Identity Store

Database identity store validates credentials from relational database.

## 15.1 Concept

Tables:

```text
users(id, username, password_hash, enabled)
groups(user_id, group_name)
```

## 15.2 Required concerns

- password hashing;
- parameterized queries;
- account enabled/locked status;
- failed login count;
- last login;
- password reset;
- password rotation;
- group mapping;
- transaction/read consistency;
- index on username;
- audit.

## 15.3 Example definition concept

```java
@DatabaseIdentityStoreDefinition(
    dataSourceLookup = "java:app/jdbc/SecurityDS",
    callerQuery = "...",
    groupsQuery = "..."
)
```

Exact attributes follow API docs/version.

## 15.4 SQL injection risk

Queries must be parameterized by provider, never string concatenation.

## 15.5 Password hash

Never store plaintext password.

## 15.6 Operational risk

If security database down:

- login fails;
- existing session may still work;
- API token validation may fail;
- availability impact.

Plan monitoring and fail behavior.

---

# 16. LDAP Identity Store

LDAP identity store validates against LDAP directory.

## 16.1 Use cases

- enterprise employee login;
- centralized directory;
- group membership;
- organization hierarchy.

## 16.2 Concerns

- TLS/LDAPS;
- bind DN permissions;
- group search filter;
- nested groups;
- connection pooling;
- timeout;
- directory availability;
- username normalization;
- injection in LDAP filter;
- account disabled/locked status.

## 16.3 Group mapping

LDAP groups may not equal application roles.

Map carefully.

Example:

```text
cn=CEA-Officers,ou=groups,... → OFFICER
cn=CEA-Supervisors,... → SUPERVISOR
```

## 16.4 Performance

Group lookup can be expensive.

Use caching carefully:

- TTL;
- invalidation;
- revocation requirement;
- least stale risk.

## 16.5 Security

Do not log LDAP passwords or full DN with sensitive structure unnecessarily.

---

# 17. Custom Identity Store

Custom identity store implements application-specific validation.

## 17.1 Use cases

- API key validation;
- legacy auth database;
- external IAM REST service;
- custom tenant-aware identity;
- service account registry;
- certificate thumbprint registry.

## 17.2 Skeleton concept

```java
@ApplicationScoped
public class ApiKeyIdentityStore implements IdentityStore {

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof ApiKeyCredential apiKey)) {
            return CredentialValidationResult.NOT_VALIDATED_RESULT;
        }

        ApiKeyRecord record = apiKeyRepository.find(apiKey.value());
        if (record == null || record.revoked()) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        return new CredentialValidationResult(
            record.principalName(),
            record.groups()
        );
    }
}
```

Exact API types depend version.

## 17.3 Ordering among identity stores

If multiple stores exist, understand validation order and `VALID`, `INVALID`, `NOT_VALIDATED`.

## 17.4 Custom store must be hardened

- constant-time compare for secrets;
- hash API keys, don't store raw;
- rotate keys;
- rate limit;
- audit failures;
- do not expose whether username exists;
- timeout external calls;
- cache carefully.

## 17.5 Avoid business DB coupling

Identity store should not load huge business graph.

It should validate identity and groups.

Authorization resource checks happen later.

---

# 18. Password Hashing

Password hashing is critical.

## 18.1 Never plaintext

Never store:

```text
password = "secret"
```

## 18.2 Never fast hash alone

Bad:

```text
SHA-256(password)
```

Too fast for password storage.

## 18.3 Use password hashing algorithms

Use password hashing designed for credentials:

- PBKDF2;
- bcrypt;
- scrypt;
- Argon2 if available/provider-supported.

Jakarta Security includes `PasswordHash` SPI and built-in/default password hash support depending implementation/version.

## 18.4 Salt

Use unique salt per password.

## 18.5 Work factor

Tune iterations/cost.

Balance:

- security;
- login latency;
- CPU capacity;
- DoS risk.

## 18.6 Password migration

If old hashes exist:

```text
on successful login with old hash
  ↓
rehash with new algorithm/cost
  ↓
store upgraded hash
```

## 18.7 Password policy

Good security includes:

- minimum length;
- breached password checking;
- no reuse if required;
- MFA for sensitive accounts;
- reset flow;
- lockout/rate limit;
- audit.

## 18.8 Do not implement crypto casually

Use vetted library/provider.

---

# 19. Authentication Flow: Request → Mechanism → Identity Store → Principal

## 19.1 Basic flow

```text
HTTP request
  ↓
Servlet container
  ↓
Jakarta Security HTTP Authentication Mechanism
  ↓
extract credential
  ↓
IdentityStore validates credential
  ↓
CredentialValidationResult
  ↓
notify container about login
  ↓
SecurityContext populated
  ↓
application checks principal/roles
```

## 19.2 No credential

Mechanism may:

- do nothing;
- challenge;
- redirect to login;
- return unauthorized.

Depends protected resource and mechanism.

## 19.3 Invalid credential

Should result:

```http
401 Unauthorized
```

or login error flow.

Do not leak whether username exists.

## 19.4 Authenticated but forbidden

If authenticated but insufficient role:

```http
403 Forbidden
```

## 19.5 Challenge

For Basic:

```http
WWW-Authenticate: Basic realm="..."
```

For OIDC:

```text
redirect to IdP authorization endpoint
```

## 19.6 Login session

For browser mechanisms, container may establish authenticated session.

## 19.7 API token

For stateless APIs, token may be validated per request.

## 19.8 SecurityContext availability

Once authenticated, managed components can query caller.

---

# 20. Declarative Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `@DeclareRoles`

These annotations are in `jakarta.annotation.security`.

## 20.1 `@RolesAllowed`

```java
@RolesAllowed("ADMIN")
public void deleteUser(...) { ... }
```

## 20.2 `@PermitAll`

```java
@PermitAll
public HealthStatus health() { ... }
```

## 20.3 `@DenyAll`

```java
@DenyAll
public void dangerousInternalMethod() { ... }
```

## 20.4 `@DeclareRoles`

```java
@DeclareRoles({"ADMIN", "OFFICER", "SUPERVISOR"})
public class SecurityConfigMarker {}
```

## 20.5 Works only at managed/security boundary

If method is called directly on unmanaged object, annotation may not apply.

## 20.6 Role annotation is coarse

Good:

```java
@RolesAllowed("OFFICER")
public CaseDto getCase(...) { ... }
```

But still need:

```java
authorization.checkCanView(actor, case);
```

## 20.7 Avoid role explosion

Bad:

```text
ROLE_CASE_APPROVE_IN_REGION_A_FOR_TYPE_X
```

Use role + domain policy.

---

# 21. Programmatic Authorization

Declarative role check is not enough for resource-specific rules.

## 21.1 Example

```java
@ApplicationScoped
public class CaseAuthorization {

    public void checkCanApprove(Actor actor, EnforcementCase c) {
        if (!actor.hasRole("OFFICER")) {
            throw new ForbiddenException("Requires OFFICER");
        }
        if (!c.isAssignedTo(actor.id())) {
            throw new ForbiddenException("Not assigned to case");
        }
        if (!c.isReviewPending()) {
            throw new ForbiddenException("Case not review pending");
        }
    }
}
```

## 21.2 Use SecurityContext at boundary

```java
Actor actor = currentActorProvider.currentActor();
authorization.checkCanApprove(actor, case);
```

## 21.3 Return 404 or 403?

For security-sensitive resources, sometimes return 404 to avoid revealing existence.

Policy decision:

```text
not found because does not exist
not found because caller cannot know it exists
forbidden because caller knows but lacks permission
```

Document.

## 21.4 Field-level authorization

Example:

```text
Officer can view case summary but not applicant sensitive documents.
```

Requires DTO shaping/data masking.

## 21.5 Data-level authorization

For list/search, include security filter in query.

Do not load all then filter in memory for huge datasets.

---

# 22. Jakarta Security dan Servlet Integration

Servlet is main web runtime integration point.

## 22.1 Servlet API security methods

```java
request.getUserPrincipal()
request.isUserInRole("ADMIN")
request.login(username, password)
request.logout()
request.authenticate(response)
```

## 22.2 Security constraints

Use:

```java
@ServletSecurity
```

or `web.xml`.

## 22.3 Jakarta Security mechanisms run in HTTP request context

HTTP authentication mechanisms operate with:

```java
HttpServletRequest
HttpServletResponse
HttpMessageContext
```

## 22.4 Filter ordering

Security may run before application filters depending container.

If you write custom filters, understand ordering.

## 22.5 Session fixation

After successful login, rotate session ID where appropriate.

Servlet API provides:

```java
request.changeSessionId()
```

## 22.6 Logout

Logout should:

- invalidate session;
- clear cookies if needed;
- notify IdP for OIDC if required;
- clear local state;
- redirect safely.

## 22.7 Error handling

Unauthenticated vs forbidden:

- 401 = not authenticated / need credentials;
- 403 = authenticated but not allowed.

---

# 23. Jakarta Security dan Jakarta REST Integration

Jakarta REST resource can use declarative roles and injected security context.

## 23.1 Example

```java
@Path("/cases")
public class CaseResource {

    @Inject
    SecurityContext securityContext;

    @GET
    @Path("/{id}")
    @RolesAllowed({"OFFICER", "SUPERVISOR"})
    public CaseDto get(@PathParam("id") UUID id) {
        ...
    }
}
```

Be careful: there is also JAX-RS `jakarta.ws.rs.core.SecurityContext`.

Fully qualify imports.

## 23.2 Two SecurityContext types

Jakarta Security:

```java
jakarta.security.enterprise.SecurityContext
```

JAX-RS:

```java
jakarta.ws.rs.core.SecurityContext
```

They are different.

## 23.3 Role check

JAX-RS context:

```java
@Context
jakarta.ws.rs.core.SecurityContext rsSecurityContext;
```

Jakarta Security context:

```java
@Inject
jakarta.security.enterprise.SecurityContext securityContext;
```

## 23.4 Exception mapping

Security exceptions should map to:

- 401;
- 403;
- 404 if policy hides existence.

## 23.5 Resource-level authorization

REST method role is not enough.

```java
@RolesAllowed("OFFICER")
public CaseDto getCase(UUID id) {
    EnforcementCase c = getCase(id);
    authorization.checkCanView(actor, c);
    return mapper.toDto(c, actor);
}
```

## 23.6 CORS

CORS is not authentication.

Do not treat CORS as security boundary.

CORS controls browser behavior, not server access for non-browser clients.

---

# 24. Jakarta Security dan CDI Integration

Jakarta Security is CDI-friendly.

## 24.1 Injectable SecurityContext

```java
@Inject
SecurityContext securityContext;
```

## 24.2 Identity store as CDI bean

Custom identity store can be CDI bean.

```java
@ApplicationScoped
public class CustomIdentityStore implements IdentityStore { ... }
```

## 24.3 Authentication mechanism as CDI bean

```java
@ApplicationScoped
public class CustomMechanism implements HttpAuthenticationMechanism { ... }
```

## 24.4 Inject dependencies carefully

Security components may inject:

- user repository;
- password hasher;
- audit logger;
- clock;
- configuration.

Avoid cycles:

```text
Security mechanism → application service → security context → mechanism
```

## 24.5 Scope

Security components should usually be application-scoped/stateless.

Do not store request-specific data in fields.

## 24.6 CDI qualifiers in Security 4.0

Security 4.0 adds qualifiers for built-in authentication mechanisms, helping CDI selection/configuration.

## 24.7 Testing

CDI integration tests should validate:

- mechanism bean discovered;
- identity store invoked;
- roles mapped;
- SecurityContext populated.

---

# 25. OpenID Connect / OIDC

OIDC is identity layer on top of OAuth 2.0.

It lets application delegate login to Identity Provider.

## 25.1 OIDC actors

```text
Resource Owner / User
Client / Application
OpenID Provider / IdP
Authorization Server
Token Endpoint
UserInfo Endpoint
JWKS Endpoint
```

## 25.2 Common flow

For browser app:

```text
user accesses protected page
  ↓
app redirects to IdP
  ↓
user authenticates at IdP
  ↓
IdP redirects back with authorization code
  ↓
app exchanges code for tokens
  ↓
app validates ID token
  ↓
app establishes security context/session
```

## 25.3 Jakarta Security OIDC mechanism

Jakarta Security includes OIDC authentication mechanism support in modern versions.

The API package includes OIDC-related annotations/config.

## 25.4 Token types

- ID token: identity claims for client;
- access token: authorization for resource server;
- refresh token: obtain new tokens.

Do not confuse ID token and access token.

## 25.5 Validate tokens

Token validation requires:

- issuer;
- audience;
- signature;
- expiration;
- nonce/state;
- algorithm;
- JWKS;
- clock skew;
- token type.

## 25.6 State and nonce

For authorization code flow:

- `state` prevents CSRF/login confusion;
- `nonce` helps prevent replay in OIDC.

## 25.7 Logout

OIDC logout can be complex:

- local logout;
- IdP logout;
- back-channel/front-channel logout;
- session cleanup.

## 25.8 Security advice

Prefer using standard OIDC mechanism/provider rather than implementing OIDC manually.

---

# 26. Keycloak / External IdP Integration Mental Model

Keycloak or other IdP handles identity.

Jakarta app consumes identity.

## 26.1 Responsibilities

IdP:

- user authentication;
- MFA;
- password policy;
- federation;
- user sessions;
- claims;
- client config;
- token signing.

Application:

- validate authentication result;
- map claims/groups to roles;
- enforce application authorization;
- protect data;
- audit decisions.

## 26.2 Claims

OIDC token claims may include:

- `sub`;
- `iss`;
- `aud`;
- `exp`;
- `iat`;
- `email`;
- `preferred_username`;
- groups/roles custom claim.

## 26.3 Do not trust claim blindly

Trust only after token validated.

## 26.4 Role mapping

Keycloak realm/client roles may not equal Jakarta roles.

Define mapping:

```text
realm role case-officer → OFFICER
client role case-admin → ADMIN
group /agency/supervisors → SUPERVISOR
```

## 26.5 Token size

Too many groups/roles in JWT can create large headers.

May exceed proxy/server header limit.

## 26.6 Revocation

JWT self-contained tokens are valid until expiry unless introspection/revocation strategy used.

Use short-lived access tokens and session policies.

---

# 27. JWT, Session, Cookie, dan Token Boundary

## 27.1 Session cookie

Browser login often results in server-side session cookie.

Pros:

- server can invalidate;
- less token leakage to JS if HttpOnly;
- smaller cookie.

Cons:

- stateful;
- cluster/session store needed;
- CSRF concern.

## 27.2 JWT bearer

API clients send:

```http
Authorization: Bearer eyJ...
```

Pros:

- stateless validation;
- good for APIs/service-to-service.

Cons:

- revocation harder;
- token leakage risk;
- header size;
- claims staleness.

## 27.3 Cookie security

Set:

- HttpOnly;
- Secure;
- SameSite;
- Path;
- short lifetime where needed.

## 27.4 CSRF

If browser automatically sends cookie, CSRF is relevant.

If API uses Authorization bearer header from JS, CSRF less direct but XSS risk higher.

## 27.5 XSS

If token stored in localStorage, XSS can steal it.

Prefer secure cookie/session patterns for browser where appropriate.

## 27.6 Token boundary

Do not pass user token deep into internal services casually.

Consider token exchange, service identity, and least privilege.

---

# 28. Role Mapping dan Group Mapping

## 28.1 External group

Example:

```text
LDAP group: cn=case-officers,ou=groups,...
OIDC group: /cea/officers
```

## 28.2 Application role

```text
OFFICER
SUPERVISOR
ADMIN
```

## 28.3 Mapping layer

```text
external group/claim → application role
```

## 28.4 Avoid direct coupling

If code checks:

```java
@RolesAllowed("/cea/prod/supervisors")
```

you couple app to IdP group naming.

Prefer app roles.

## 28.5 Role naming convention

Use stable names:

```text
CASE_VIEWER
CASE_OFFICER
CASE_SUPERVISOR
CASE_ADMIN
SYSTEM_INTEGRATION
```

## 28.6 Role explosion

Avoid roles for every resource instance.

Use role + domain policy.

## 28.7 Audit role source

For debugging/audit, record:

- principal;
- roles;
- source claims/groups;
- mapping version.

---

# 29. Security Boundary di Layered Architecture

## 29.1 API boundary

Handles:

- authentication required;
- coarse role;
- request validation;
- CSRF/CORS;
- rate limiting;
- error mapping.

## 29.2 Application boundary

Handles:

- actor extraction;
- use-case authorization;
- transaction;
- audit;
- idempotency;
- command orchestration.

## 29.3 Domain boundary

Handles:

- business invariant;
- state-specific permission;
- aggregate rule.

## 29.4 Data boundary

Handles:

- tenant/jurisdiction filtering;
- row-level security if used;
- DB constraints;
- sensitive column masking/read model.

## 29.5 Example flow

```text
HTTP request
  ↓ authenticate
  ↓ role check @RolesAllowed
  ↓ parse command
  ↓ Actor from SecurityContext
  ↓ application authorization
  ↓ load resource with tenant/jurisdiction filter
  ↓ domain rule
  ↓ save + audit
```

## 29.6 Do not put all security in one annotation

`@RolesAllowed` is one layer, not whole security model.

---

# 30. Authentication vs Authorization vs Domain Policy

## 30.1 Authentication example

```text
Fajar logged in via OIDC.
```

## 30.2 Authorization example

```text
Fajar has role OFFICER.
```

## 30.3 Domain policy example

```text
Fajar can approve Case-123 because:
- he is assigned officer;
- case status is REVIEW_PENDING;
- case jurisdiction matches;
- he has no conflict of interest.
```

## 30.4 Failure mapping

Unauthenticated:

```http
401 Unauthorized
```

Authenticated but lacks role:

```http
403 Forbidden
```

Authenticated with role but resource not allowed:

```http
403 Forbidden
```

or 404 if hiding existence.

Domain state disallows:

```http
409 Conflict
```

or domain-specific 422/400 depending API design.

## 30.5 Avoid vague error

Bad:

```json
{"error":"Access denied"}
```

Good internal log:

```text
actor=fajar action=APPROVE_CASE case=123 decision=DENY reason=NOT_ASSIGNED
```

Client response can be less detailed.

---

# 31. Multi-Tenancy dan Data-Level Security

## 31.1 Tenant isolation

If app is multi-tenant, every data access must respect tenant boundary.

## 31.2 Where to enforce?

Layers:

- token claim tenant;
- application actor tenant;
- repository query includes tenant;
- database row-level security;
- schema-per-tenant;
- database-per-tenant.

## 31.3 Common bug

```java
caseRepository.findById(id)
```

without tenant filter.

Attacker guesses UUID and accesses cross-tenant data.

Better:

```java
caseRepository.findByIdAndTenantId(id, actor.tenantId())
```

## 31.4 Defense in depth

Even if application filters tenant, DB row-level security can provide extra guard.

## 31.5 Tenant from token vs request param

Do not trust tenant request param unless authorized.

```text
actor tenant from validated token/session
```

## 31.6 Admin cross-tenant access

Special roles need explicit audited path.

## 31.7 Testing

Test cross-tenant access denial.

---

# 32. CSRF, CORS, XSS, Session Fixation, dan Header Security

## 32.1 CSRF

Relevant when browser automatically sends credentials, especially cookies.

Mitigations:

- CSRF token;
- SameSite cookie;
- check Origin/Referer;
- avoid unsafe GET;
- use proper framework support.

## 32.2 CORS

CORS controls browser cross-origin access.

It does not secure server from non-browser clients.

Do not use wildcard with credentials:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Invalid/dangerous pattern.

## 32.3 XSS

If attacker runs JS in your origin, they can perform authenticated actions.

Mitigations:

- output encoding;
- CSP;
- HttpOnly cookies;
- sanitize inputs;
- avoid unsafe HTML injection.

## 32.4 Session fixation

After login, rotate session ID.

## 32.5 Security headers

Use:

- HSTS;
- CSP;
- X-Content-Type-Options;
- Referrer-Policy;
- Cache-Control no-store for sensitive;
- Frame-Options/CSP frame-ancestors.

## 32.6 HTTPS

Authentication without HTTPS is broken.

Use TLS everywhere.

## 32.7 Reverse proxy

Ensure app understands original scheme/host only from trusted proxy.

---

# 33. Password, Credential, Secret, dan Account Lifecycle

## 33.1 Account lifecycle

Security requires:

- provisioning;
- deprovisioning;
- role changes;
- password reset;
- MFA enrollment;
- lockout;
- dormant account review;
- break-glass account controls.

## 33.2 Credential storage

Passwords hashed.

API keys hashed.

Tokens encrypted/hashed depending use.

Client secrets stored in secret manager.

## 33.3 Secret rotation

Plan rotation:

- DB password;
- OIDC client secret;
- signing keys;
- API keys.

## 33.4 Failed login

Implement:

- rate limit;
- backoff;
- lockout or risk-based;
- audit;
- generic error.

## 33.5 Generic error

Do not say:

```text
username not found
```

Say:

```text
invalid credentials
```

## 33.6 MFA

Jakarta Security itself does not provide full MFA product.

Use IdP/OIDC provider for MFA.

## 33.7 Break-glass

Emergency admin accounts must be:

- limited;
- audited;
- rotated;
- protected;
- tested.

---

# 34. Observability dan Audit Security

## 34.1 Security events to audit

- login success;
- login failure;
- logout;
- token validation failure;
- role mapping;
- access denied;
- privileged action;
- password change/reset;
- account locked/unlocked;
- API key created/revoked;
- admin role granted/revoked.

## 34.2 Audit fields

- timestamp;
- correlation ID;
- actor principal;
- actor type;
- source IP;
- user agent;
- action;
- resource ID;
- decision;
- reason;
- roles;
- tenant/jurisdiction;
- mechanism;
- IdP issuer/client.

## 34.3 Do not log secrets

Never log:

- password;
- token;
- authorization header;
- cookie value;
- client secret;
- API key;
- full credential.

## 34.4 Metrics

Track:

- authentication failures;
- forbidden count;
- login latency;
- identity store latency;
- token validation error rate;
- lockout count;
- suspicious IP rate.

## 34.5 Alerts

Alert on:

- spike in failed login;
- admin login from unusual location;
- many 403/401;
- identity store down;
- JWT validation errors;
- clock skew issues.

## 34.6 Correlation

Every security decision should include correlation ID.

---

# 35. Testing Strategy

## 35.1 Unit tests

Test policy logic separately:

```java
authorization.checkCanApprove(actor, case)
```

No container needed.

## 35.2 Integration tests

Test Jakarta Security runtime:

- login success;
- invalid credential;
- unauthenticated protected endpoint;
- forbidden wrong role;
- allowed correct role;
- logout;
- session fixation protection;
- OIDC callback if feasible.

## 35.3 Identity store tests

Test:

- valid credential;
- invalid password;
- disabled account;
- locked account;
- group mapping;
- timeout/failure;
- SQL/LDAP injection attempts.

## 35.4 SecurityContext tests

Inject into managed bean and verify principal/roles.

## 35.5 REST tests

Use HTTP-level tests.

Do not only call resource method directly.

## 35.6 Negative tests

Security testing needs negative cases:

- missing token;
- expired token;
- wrong audience;
- wrong issuer;
- tampered signature;
- role absent;
- cross-tenant access;
- CSRF attempt;
- CORS forbidden origin.

## 35.7 Test with real IdP

For OIDC, use:

- Keycloak Testcontainers;
- mock OIDC provider;
- dedicated test realm;
- signed test tokens.

## 35.8 Automated regression

Security tests must run in CI.

---

# 36. Production Failure Modes

## 36.1 401/403 confusion

Returning 403 for unauthenticated request or 401 for authenticated forbidden request confuses clients.

## 36.2 Role mapping wrong

User authenticated but has no role because groups not mapped.

## 36.3 Over-broad role

`ADMIN` assigned too widely.

## 36.4 Header spoofing

App trusts `X-User` from public internet.

## 36.5 Token accepted with wrong issuer/audience

JWT validation incomplete.

## 36.6 Session fixation

Session ID not rotated after login.

## 36.7 CSRF

Cookie-authenticated endpoint mutates state without CSRF protection.

## 36.8 CORS misconfiguration

Allows credentialed access from arbitrary origins.

## 36.9 Password stored weakly

Plaintext or fast hash.

## 36.10 Identity store outage

Login fails globally due DB/LDAP outage.

## 36.11 Stale roles

JWT/session contains old role after role revoked.

## 36.12 Authorization bypass by direct method call

Role annotation not enforced because method invoked outside managed boundary.

## 36.13 Data leak despite correct role

Role allowed endpoint but query lacks tenant/resource filter.

## 36.14 Logging secrets

Authorization header appears in logs.

## 36.15 Clock skew

OIDC/JWT tokens rejected due server time drift.

---

# 37. Best Practices dan Anti-Patterns

## 37.1 Best practices

- Use standard mechanisms before custom auth.
- Use external IdP for enterprise identity.
- Use `SecurityContext` at application boundary.
- Keep domain logic free from Jakarta security API.
- Use role annotations for coarse access only.
- Enforce resource-level authorization explicitly.
- Include tenant/jurisdiction in data queries.
- Hash passwords/API keys.
- Use HTTPS everywhere.
- Configure secure cookies.
- Protect against CSRF for cookie-based flows.
- Test negative security cases.
- Audit security decisions.
- Never log credentials/tokens.
- Document role/group mapping.

## 37.2 Anti-pattern: Security only in UI

Backend must enforce security.

## 37.3 Anti-pattern: Custom auth filter with trusted username header

Bad unless behind trusted proxy that strips external header.

## 37.4 Anti-pattern: Role as domain policy

```java
@RolesAllowed("OFFICER")
```

does not mean officer can access every case.

## 37.5 Anti-pattern: Tokens in localStorage

High XSS impact. Consider secure cookie/session/BFF pattern.

## 37.6 Anti-pattern: Long-lived JWT with many roles

Revocation and stale authorization problem.

## 37.7 Anti-pattern: Swallow auth failures

Do not convert auth failure to anonymous access accidentally.

## 37.8 Anti-pattern: Logging full request headers

May include Authorization/Cookie.

---

# 38. Checklist Review

## 38.1 Authentication

- [ ] Mechanism standard where possible?
- [ ] Multiple mechanisms separated by path/zone?
- [ ] Invalid credentials return safe error?
- [ ] HTTPS enforced?
- [ ] Token/session expiration defined?
- [ ] Logout behavior defined?

## 38.2 Identity store

- [ ] Passwords/API keys hashed?
- [ ] Identity source uses TLS?
- [ ] Queries/filter safe?
- [ ] Account disabled/locked handled?
- [ ] Group mapping tested?
- [ ] Outage behavior understood?

## 38.3 Authorization

- [ ] Role annotations used for coarse boundary?
- [ ] Resource-level authorization explicit?
- [ ] Tenant/jurisdiction included?
- [ ] 401/403/404 policy defined?
- [ ] Domain policy tested?

## 38.4 Tokens/session

- [ ] Issuer/audience/signature validated?
- [ ] Clock synchronized?
- [ ] Session ID rotated after login?
- [ ] Cookies HttpOnly/Secure/SameSite?
- [ ] CSRF handled for cookie auth?
- [ ] CORS allowlist strict?

## 38.5 Observability

- [ ] Security events audited?
- [ ] No credentials in logs?
- [ ] Correlation ID included?
- [ ] Failed login monitored?
- [ ] Access denied monitored?

## 38.6 Testing

- [ ] Positive and negative auth tests?
- [ ] Cross-tenant denial tests?
- [ ] Wrong role tests?
- [ ] Expired/tampered token tests?
- [ ] Real runtime/container tested?

---

# 39. Case Study 1: REST API dengan OIDC dan Role-Based Access

## 39.1 Requirement

REST API protected by OIDC.

Roles:

- `CASE_VIEWER`;
- `CASE_OFFICER`;
- `CASE_ADMIN`.

## 39.2 Resource

```java
@Path("/cases")
@RolesAllowed("CASE_VIEWER")
public class CaseResource {

    @Inject
    CurrentActorProvider actors;

    @Inject
    ViewCaseUseCase viewCase;

    @GET
    @Path("/{id}")
    public CaseDto get(@PathParam("id") UUID id) {
        Actor actor = actors.currentActor();
        return viewCase.handle(actor, new CaseId(id));
    }
}
```

## 39.3 Application authorization

```java
public CaseDto handle(Actor actor, CaseId id) {
    Case c = repository.getByIdAndTenant(id, actor.tenantId());
    authorization.checkCanView(actor, c);
    return mapper.toDto(c, actor);
}
```

## 39.4 Why this is better

- OIDC handles authentication.
- `@RolesAllowed` handles coarse role.
- Application checks tenant/resource.
- DTO controls field exposure.
- Audit records decision.

## 39.5 Failure mode avoided

A user with `CASE_VIEWER` cannot view another tenant's case.

---

# 40. Case Study 2: Form Login Legacy ke Jakarta Security

## 40.1 Legacy

Old app uses custom login servlet:

```java
if (password.equals(dbPassword)) {
    session.setAttribute("user", user);
}
```

Problems:

- plaintext/weak password;
- no standard principal;
- `isUserInRole` does not work;
- session fixation;
- scattered checks.

## 40.2 Migration

Use Jakarta Security:

- form authentication mechanism;
- database identity store;
- password hash;
- container principal;
- role mapping;
- `SecurityContext`.

## 40.3 Benefits

- standard authentication;
- `@RolesAllowed`;
- principal available;
- better testability;
- less custom security code.

## 40.4 Extra fixes

- rotate session ID;
- CSRF protection;
- secure cookie;
- account lockout;
- audit login failures.

---

# 41. Case Study 3: Role Ada, Tapi Data Masih Bocor

## 41.1 Problem

Endpoint:

```java
@RolesAllowed("OFFICER")
@GET
@Path("/cases/{id}")
public CaseDto get(UUID id) {
    return mapper.toDto(repository.findById(id));
}
```

Any officer can access any case.

## 41.2 Root cause

Role check is coarse.

No resource-level authorization.

## 41.3 Fix

```java
public CaseDto get(UUID id) {
    Actor actor = actors.currentActor();
    Case c = repository.findByIdAndJurisdiction(id, actor.jurisdiction())
        .orElseThrow(NotFoundException::new);
    authorization.checkCanView(actor, c);
    return mapper.toDto(c, actor);
}
```

## 41.4 Lesson

Authentication + role does not equal resource authorization.

---

# 42. Case Study 4: Custom Header Authentication yang Berbahaya

## 42.1 Bad design

App trusts:

```http
X-User: admin
X-Roles: ADMIN
```

from request.

## 42.2 Attack

External client sends those headers.

## 42.3 When it can be safe

Only if:

- app is not directly exposed;
- trusted proxy authenticates user;
- proxy strips incoming user headers;
- proxy sets signed/controlled headers;
- network path protected;
- mutual TLS/service identity;
- app validates source;
- documented threat model.

## 42.4 Better

Use OIDC/JWT/mTLS standard mechanism.

## 42.5 Lesson

Headers are attacker-controlled unless proven otherwise.

---

# 43. Latihan Bertahap

## Latihan 1 — Inject SecurityContext

Create managed bean and print caller principal.

Test unauthenticated/authenticated.

## Latihan 2 — Role annotation

Protect endpoint with `@RolesAllowed`.

Test:

- no credential;
- wrong role;
- correct role.

## Latihan 3 — In-memory identity store

Configure in-memory users for test.

## Latihan 4 — Database identity store

Create users/groups table.

Validate login.

## Latihan 5 — Password hashing

Replace plaintext with password hash.

Test valid/invalid password.

## Latihan 6 — Resource-level authorization

Implement `CaseAuthorization`.

Test assigned vs non-assigned officer.

## Latihan 7 — Cross-tenant access

User A tries to access tenant B data.

Ensure denied/404.

## Latihan 8 — CSRF

For form/session endpoint, add CSRF protection.

Test missing/invalid token.

## Latihan 9 — OIDC with Keycloak

Run Keycloak test realm.

Protect REST endpoint.

Map group to role.

## Latihan 10 — Audit security decisions

Record login/access denied/privileged action audit events.

---

# 44. Mini Project: Jakarta Security Lab

## 44.1 Goal

Buat project:

```text
jakarta-security-lab/
```

## 44.2 Modules/features

```text
security-context/
roles-allowed/
in-memory-store/
database-store/
custom-api-key-mechanism/
oidc-keycloak/
resource-authorization/
csrf-session/
audit-security/
negative-tests/
```

## 44.3 Deliverables

```text
README.md
AUTHENTICATION-FLOW.md
IDENTITY-STORE.md
ROLE-MAPPING.md
AUTHORIZATION-POLICY.md
OIDC-KEYCLOAK.md
SESSION-COOKIE-CSRF.md
SECURITY-AUDIT.md
THREAT-MODEL.md
FAILURE-MODES.md
```

## 44.4 Required tests

1. Unauthenticated request returns 401.
2. Wrong role returns 403.
3. Correct role allowed.
4. Cross-tenant access denied.
5. Invalid password rejected.
6. Disabled account rejected.
7. API key invalid/revoked rejected.
8. OIDC wrong issuer/audience rejected.
9. CSRF missing token rejected.
10. Security audit recorded.

## 44.5 Evaluation questions

1. What is authentication?
2. What is authorization?
3. What is principal?
4. What is difference between group and role?
5. What does IdentityStore do?
6. What does HttpAuthenticationMechanism do?
7. Why is `@RolesAllowed` not enough?
8. Why must tenant be included in query?
9. Why should tokens not be logged?
10. Why is custom header authentication dangerous?

---

# 45. Referensi Resmi

Referensi utama:

1. Jakarta Security 4.0  
   https://jakarta.ee/specifications/security/4.0/

2. Jakarta Security 4.0 Specification  
   https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0

3. Jakarta Security 4.0 API Docs  
   https://jakarta.ee/specifications/security/4.0/apidocs/

4. `SecurityContext` API Docs  
   https://jakarta.ee/specifications/security/4.0/apidocs/jakarta.security/jakarta/security/enterprise/securitycontext

5. Jakarta EE Tutorial — Introduction to Security  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-intro/security-intro.html

6. Jakarta EE Specification Guide — Security, Authorization, and Authentication Explained  
   https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/

7. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

8. Jakarta Annotations 3.0 Security Annotations  
   https://jakarta.ee/specifications/annotations/3.0/apidocs/jakarta.annotation/jakarta/annotation/security/package-summary

9. Jakarta Authentication 3.1  
   https://jakarta.ee/specifications/authentication/3.1/

10. Jakarta Authorization 3.0  
    https://jakarta.ee/specifications/authorization/3.0/

---

# Penutup

Jakarta Security membantu menstandarkan security di aplikasi Jakarta EE modern.

Namun security production tidak selesai dengan satu annotation.

Mental model utama:

```text
Authentication proves who the caller is.
Identity Store validates identity/credential.
SecurityContext exposes caller and roles.
Role annotations provide coarse authorization.
Application/domain policy enforces resource-specific authorization.
Data layer must enforce tenant/resource boundaries.
Audit records security decisions.
```

Prinsip paling penting:

```text
@RolesAllowed is not domain authorization.
```

Gunakan Jakarta Security untuk membangun authentication dan identity integration yang portable, tetapi tetap desain security boundary secara menyeluruh:

- endpoint;
- method;
- resource;
- tenant;
- domain state;
- data query;
- audit;
- testing;
- observability.

Engineer top-tier tidak hanya membuat login berhasil. Ia membuktikan bahwa akses yang tidak sah gagal, bahwa data tidak bocor antar tenant, bahwa token divalidasi benar, bahwa role mapping jelas, dan bahwa setiap keputusan security penting dapat diaudit.

Bagian berikutnya akan membahas **Jakarta Authorization dan Jakarta Authentication** sebagai lower-level security specifications: kapan perlu memahami JACC/Jakarta Authorization, Jakarta Authentication/JASPIC, container security SPI, dan bagaimana mereka berhubungan dengan Jakarta Security.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-016.md](./learn-java-jakarta-part-016.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-018.md](./learn-java-jakarta-part-018.md)
