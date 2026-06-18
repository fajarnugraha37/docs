# learn-jaxrs-advanced-part-018.md

# Bagian 018 — Security in JAX-RS: Authentication, Authorization, `SecurityContext`, Principal, Roles, Scopes, JWT/OIDC, Jakarta Security, Tenant/Data Authorization, dan Production Hardening

> Target pembaca: Java/Jakarta engineer yang ingin memahami **security boundary** dalam JAX-RS/Jakarta REST secara production-grade. Fokus bagian ini bukan hanya “pakai `@RolesAllowed`” atau “cek token di filter”, tetapi membangun mental model lengkap: authentication vs authorization, principal mapping, role/scope mapping, `SecurityContext`, Jakarta Security, MicroProfile JWT/OIDC, filters, method-level security, tenant/data authorization, error handling, token hardening, gateway trust boundary, observability, dan testing.
>
> Namespace utama: `jakarta.ws.rs.core.SecurityContext`, `jakarta.ws.rs.container.ContainerRequestFilter`, `jakarta.annotation.security.*`, `jakarta.security.enterprise.*`, MicroProfile JWT (`org.eclipse.microprofile.jwt.*`) jika digunakan.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Security Bukan Satu Layer](#2-mental-model-security-bukan-satu-layer)
3. [Authentication vs Authorization](#3-authentication-vs-authorization)
4. [Identity, Principal, Subject, Actor, User, Service Account](#4-identity-principal-subject-actor-user-service-account)
5. [Roles, Groups, Scopes, Permissions, Claims](#5-roles-groups-scopes-permissions-claims)
6. [`SecurityContext` di JAX-RS](#6-securitycontext-di-jax-rs)
7. [`getUserPrincipal()`](#7-getuserprincipal)
8. [`isUserInRole(String role)`](#8-isuserinrolestring-role)
9. [`isSecure()`](#9-issecure)
10. [`getAuthenticationScheme()`](#10-getauthenticationscheme)
11. [Mapping `SecurityContext` ke `CurrentUser`](#11-mapping-securitycontext-ke-currentuser)
12. [Jangan Bawa `SecurityContext` ke Domain Layer](#12-jangan-bawa-securitycontext-ke-domain-layer)
13. [Authentication Mechanisms: Basic, Bearer, Cookie, mTLS, API Key](#13-authentication-mechanisms-basic-bearer-cookie-mtls-api-key)
14. [Bearer Token dan JWT](#14-bearer-token-dan-jwt)
15. [JWT Validation Checklist](#15-jwt-validation-checklist)
16. [OIDC/OAuth2 dalam REST API](#16-oidcoauth2-dalam-rest-api)
17. [MicroProfile JWT Mental Model](#17-microprofile-jwt-mental-model)
18. [Jakarta Security Mental Model](#18-jakarta-security-mental-model)
19. [Container-Managed Security vs Application-Managed Filter](#19-container-managed-security-vs-application-managed-filter)
20. [Authentication Filter dengan `ContainerRequestFilter`](#20-authentication-filter-dengan-containerrequestfilter)
21. [Custom `SecurityContext` Implementation](#21-custom-securitycontext-implementation)
22. [401 vs 403 vs 404](#22-401-vs-403-vs-404)
23. [`WWW-Authenticate` dan Auth Error Contract](#23-www-authenticate-dan-auth-error-contract)
24. [Method-Level Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`](#24-method-level-security-rolesallowed-permitall-denyall)
25. [Role-Based Access Control/RBAC](#25-role-based-access-controlrbac)
26. [Scope-Based Access Control](#26-scope-based-access-control)
27. [Permission-Based Access Control](#27-permission-based-access-control)
28. [Attribute-Based Access Control/ABAC](#28-attribute-based-access-controlabac)
29. [Resource/Data Authorization](#29-resourcedata-authorization)
30. [Tenant Authorization](#30-tenant-authorization)
31. [Ownership, Assignment, Delegation](#31-ownership-assignment-delegation)
32. [Authorization Service/Policy Pattern](#32-authorization-servicepolicy-pattern)
33. [Coarse-Grained vs Fine-Grained Authorization](#33-coarse-grained-vs-fine-grained-authorization)
34. [SecurityContext vs Domain Policy](#34-securitycontext-vs-domain-policy)
35. [Path Tenant vs Token Tenant vs Header Tenant](#35-path-tenant-vs-token-tenant-vs-header-tenant)
36. [Trusted Gateway Headers](#36-trusted-gateway-headers)
37. [TLS Termination dan `isSecure()`](#37-tls-termination-dan-issecure)
38. [CORS Bukan Authentication/Authorization](#38-cors-bukan-authenticationauthorization)
39. [CSRF untuk Cookie-Based REST API](#39-csrf-untuk-cookie-based-rest-api)
40. [Session/Cookie Security](#40-sessioncookie-security)
41. [API Key Security](#41-api-key-security)
42. [mTLS / Client Certificate](#42-mtls--client-certificate)
43. [Service-to-Service Security](#43-service-to-service-security)
44. [Token Propagation](#44-token-propagation)
45. [User Delegation vs Service Acting as Itself](#45-user-delegation-vs-service-acting-as-itself)
46. [Idempotency, Replay Protection, Nonce, Timestamp](#46-idempotency-replay-protection-nonce-timestamp)
47. [Input Validation sebagai Security Boundary](#47-input-validation-sebagai-security-boundary)
48. [Output Security: Data Minimization and Field-Level Authorization](#48-output-security-data-minimization-and-field-level-authorization)
49. [Error Handling Security](#49-error-handling-security)
50. [Security Logging](#50-security-logging)
51. [Security Metrics and Alerts](#51-security-metrics-and-alerts)
52. [Testing Authentication](#52-testing-authentication)
53. [Testing Authorization](#53-testing-authorization)
54. [Testing Tenant/Data Authorization](#54-testing-tenantdata-authorization)
55. [Threat Modeling JAX-RS APIs](#55-threat-modeling-jax-rs-apis)
56. [Runtime Differences: Jakarta EE Servers, Quarkus, RESTEasy, Jersey, Liberty](#56-runtime-differences-jakarta-ee-servers-quarkus-resteasy-jersey-liberty)
57. [Migration: `javax.ws.rs` to `jakarta.ws.rs` Security Code](#57-migration-javaxxwrs-to-jakartawrs-security-code)
58. [Common Failure Modes](#58-common-failure-modes)
59. [Best Practices](#59-best-practices)
60. [Anti-Patterns](#60-anti-patterns)
61. [Production Checklist](#61-production-checklist)
62. [Latihan](#62-latihan)
63. [Referensi Resmi](#63-referensi-resmi)
64. [Penutup](#64-penutup)

---

# 1. Tujuan Part Ini

Security di JAX-RS sering dimulai dari sesuatu seperti:

```java
@GET
@RolesAllowed("ADMIN")
public Response adminOnly() {
    ...
}
```

atau:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class JwtAuthenticationFilter implements ContainerRequestFilter {
    ...
}
```

Namun production-grade security bukan cuma “cek role”.

Security REST API harus menjawab:

```text
Siapa caller-nya?
Bagaimana identitasnya diverifikasi?
Apa permission/scope/role yang dimiliki?
Apakah caller boleh mengakses resource spesifik ini?
Apakah tenant cocok?
Apakah data yang dikembalikan boleh terlihat?
Apakah token masih valid?
Apakah request berasal dari trusted path?
Apakah error response bocor informasi?
Apakah logs aman?
Apakah service-to-service call membawa user identity atau service identity?
```

## 1.1 Security adalah layered

```text
transport security
  ↓
authentication
  ↓
coarse authorization
  ↓
tenant/resource authorization
  ↓
field-level/data minimization
  ↓
auditing/observability
  ↓
secure error handling
```

## 1.2 Target akhir

Setelah part ini, kamu bisa:

- memakai `SecurityContext` dengan benar;
- membedakan principal, role, scope, permission, claim;
- mendesain filter authentication;
- membuat `CurrentUser` application object;
- membedakan 401/403/404;
- memahami Jakarta Security dan MicroProfile JWT;
- membangun authorization policy service;
- menghindari tenant bypass;
- mengamankan cookie/session/API key/mTLS/token;
- menulis security tests yang realistis.

---

# 2. Mental Model: Security Bukan Satu Layer

Security bukan satu annotation dan bukan satu filter.

## 2.1 Bad mental model

```text
JWT valid → user allowed
```

Salah.

JWT valid hanya berarti token lolos verifikasi.

Belum berarti caller boleh mengakses resource tertentu.

## 2.2 Better mental model

```text
JWT valid
  ↓
identity established
  ↓
scopes/roles extracted
  ↓
tenant resolved
  ↓
resource loaded with access policy
  ↓
domain authorization checked
  ↓
response minimized based on permission
```

## 2.3 Example

User punya role:

```text
OFFICER
```

Tetapi apakah ia boleh melihat case `CASE-001`?

Harus cek:

- tenant;
- assignment;
- case status;
- team membership;
- delegation;
- confidentiality;
- legal hold;
- ownership.

## 2.4 Top-tier rule

```text
Authentication proves who.
Authorization proves whether this actor may do this action on this resource now.
```

---

# 3. Authentication vs Authorization

## 3.1 Authentication

Menjawab:

```text
Who are you?
```

Contoh:

- verify username/password;
- verify JWT signature;
- validate session cookie;
- verify mTLS client certificate;
- validate API key.

Output:

```text
authenticated principal / actor identity
```

## 3.2 Authorization

Menjawab:

```text
Are you allowed to do this?
```

Contoh:

- role ADMIN may access admin endpoint;
- user may view only assigned case;
- tenant A user cannot access tenant B resource;
- service account may call internal import endpoint;
- scope `customer:write` required.

## 3.3 Common mistake

Authentication success dianggap authorization success.

```java
if (principal != null) {
    return service.getCase(caseId);
}
```

Ini salah.

## 3.4 Correct

```java
CurrentUser user = currentUserResolver.resolve(securityContext);
CaseDetail detail = caseService.getAccessibleCase(caseId, user);
```

Service/policy checks resource-specific authorization.

## 3.5 Rule

Authentication should happen early. Authorization must happen at every protected operation.

---

# 4. Identity, Principal, Subject, Actor, User, Service Account

## 4.1 Principal

In JAX-RS:

```java
Principal principal = securityContext.getUserPrincipal();
```

A principal is identity representation from security layer.

## 4.2 Subject

In JWT/OIDC, `sub` is subject identifier.

It might be user ID, client ID, or pairwise subject.

## 4.3 Actor

Application concept:

```java
CurrentUser
CurrentService
CurrentActor
```

It can represent human user or service account.

## 4.4 User

Human identity in your domain/application.

## 4.5 Service account

Non-human caller.

Examples:

- report-service;
- notification-service;
- integration-connector.

## 4.6 Why distinguish?

Authorization differs:

```text
human user may approve case
service account may sync data
```

## 4.7 Rule

Do not assume every authenticated principal is a human user.

---

# 5. Roles, Groups, Scopes, Permissions, Claims

These terms are often mixed.

## 5.1 Role

Coarse job/function grouping.

Examples:

```text
ADMIN
OFFICER
SUPERVISOR
```

## 5.2 Group

Identity provider grouping.

Examples:

```text
cea-licensing-team
finance-approvers
```

Groups may map to roles.

## 5.3 Scope

OAuth2-style delegated capability.

Examples:

```text
customer:read
customer:write
case:approve
```

## 5.4 Permission

Fine-grained action allowed.

Examples:

```text
CASE_VIEW
CASE_UPDATE
CASE_APPROVE
```

## 5.5 Claim

Assertion in token.

Examples:

```text
sub
iss
aud
exp
scope
groups
tenant_id
email
```

## 5.6 Mapping

Token claims should be mapped into application roles/scopes/permissions deliberately.

## 5.7 Rule

Do not treat roles, groups, scopes, and permissions as interchangeable without an explicit mapping model.

---

# 6. `SecurityContext` di JAX-RS

`jakarta.ws.rs.core.SecurityContext` is injectable interface that provides access to security-related information.

## 6.1 Injection

```java
@GET
public Response me(@Context SecurityContext securityContext) {
    Principal principal = securityContext.getUserPrincipal();
    ...
}
```

## 6.2 Methods

```java
getUserPrincipal()
isUserInRole(String role)
isSecure()
getAuthenticationScheme()
```

## 6.3 Request-scoped

Its methods throw `IllegalStateException` if called outside request scope.

## 6.4 Source

SecurityContext may be provided by:

- container security;
- Jakarta Security;
- MicroProfile JWT integration;
- custom JAX-RS filter using `setSecurityContext`;
- servlet security bridge.

## 6.5 Rule

`SecurityContext` is an HTTP/security boundary abstraction, not your domain authorization engine.

---

# 7. `getUserPrincipal()`

## 7.1 Method

```java
Principal getUserPrincipal()
```

Returns principal containing current authenticated user name, or null if unauthenticated.

## 7.2 Example

```java
Principal principal = securityContext.getUserPrincipal();
if (principal == null) {
    throw new NotAuthorizedException("Bearer");
}
```

## 7.3 Principal name

```java
principal.getName()
```

Could be:

- username;
- `sub`;
- email;
- client ID;
- runtime-specific identifier.

## 7.4 Do not assume email

Email can change and may not be unique.

Prefer immutable subject/user ID.

## 7.5 Mapping

```java
CurrentActor actor = currentActorResolver.resolve(principal, claims);
```

## 7.6 Rule

Principal is raw security identity; map it to application actor explicitly.

---

# 8. `isUserInRole(String role)`

## 8.1 Method

```java
boolean isUserInRole(String role)
```

Returns true if authenticated user belongs to logical role, false if unauthenticated.

## 8.2 Example

```java
if (!securityContext.isUserInRole("ADMIN")) {
    throw new ForbiddenException();
}
```

## 8.3 Logical role

Role is not necessarily raw identity provider group.

Container/runtime may map groups/scopes/claims to roles.

## 8.4 Role limitations

Role does not answer:

```text
Can user access this customer/case/document?
```

Only:

```text
Does user have this coarse role?
```

## 8.5 Rule

Use role checks for coarse endpoint gates, not fine-grained data access.

---

# 9. `isSecure()`

## 9.1 Method

```java
boolean isSecure()
```

Returns whether request was made through secure channel such as HTTPS.

## 9.2 TLS termination issue

If TLS terminates at gateway/load balancer and app receives internal HTTP, `isSecure()` may be false unless forwarded headers are trusted/configured.

## 9.3 Use cases

- generating secure links;
- cookie `Secure` decision;
- audit/debug;
- rejecting insecure direct traffic.

## 9.4 Do not blindly trust forwarded headers

Only trust if they are sanitized by known proxy.

## 9.5 Rule

Test `isSecure()` in actual deployment topology.

---

# 10. `getAuthenticationScheme()`

## 10.1 Method

```java
String getAuthenticationScheme()
```

Returns authentication scheme, such as:

```text
BASIC
FORM
CLIENT_CERT
DIGEST
```

or container-specific value.

## 10.2 Bearer

For JWT/Bearer, value may be runtime-specific or custom.

## 10.3 Use cases

- audit;
- metrics;
- debugging;
- conditional policy.

## 10.4 Do not depend on exact string too broadly

Normalize:

```java
AuthScheme.BEARER
AuthScheme.MTLS
AuthScheme.API_KEY
```

## 10.5 Rule

Authentication scheme is metadata, not permission.

---

# 11. Mapping `SecurityContext` ke `CurrentUser`

Do not pass `SecurityContext` everywhere.

Create application-level identity.

## 11.1 Current actor model

```java
public sealed interface CurrentActor permits CurrentUser, CurrentService {
    ActorId id();
    TenantId tenantId();
    Set<String> roles();
    Set<String> scopes();
}
```

## 11.2 Current user

```java
public record CurrentUser(
    UserId id,
    TenantId tenantId,
    Set<String> roles,
    Set<String> scopes,
    String subject
) implements CurrentActor {}
```

## 11.3 Resolver

```java
@ApplicationScoped
public class CurrentActorResolver {

    public CurrentActor resolve(SecurityContext securityContext) {
        Principal principal = securityContext.getUserPrincipal();
        if (principal == null) {
            throw new NotAuthorizedException("Bearer");
        }

        return mapPrincipal(principal, securityContext);
    }
}
```

## 11.4 With JWT claims

If runtime exposes `JsonWebToken`, map claims explicitly.

## 11.5 Rule

REST boundary reads security context; application layer receives `CurrentActor`.

---

# 12. Jangan Bawa `SecurityContext` ke Domain Layer

## 12.1 Bad

```java
public CaseDetail getCase(CaseId id, SecurityContext securityContext) {
    if (securityContext.isUserInRole("OFFICER")) { ... }
}
```

## 12.2 Problems

- domain tied to JAX-RS;
- impossible to reuse from batch/messaging;
- difficult unit tests;
- HTTP request scope leak;
- business policy hidden in transport object.

## 12.3 Better

```java
public CaseDetail getCase(CaseId id, CurrentActor actor) {
    authorizationPolicy.assertCanViewCase(actor, id);
    ...
}
```

## 12.4 Domain policy

```java
caseAuthorizationPolicy.assertCanView(actor, caseAggregate);
```

## 12.5 Rule

SecurityContext stops at API/application boundary.

---

# 13. Authentication Mechanisms: Basic, Bearer, Cookie, mTLS, API Key

## 13.1 Basic

Username/password encoded in header.

Use only over TLS.

Mostly for internal/simple cases.

## 13.2 Bearer

```http
Authorization: Bearer <token>
```

Common for OAuth2/OIDC/JWT APIs.

## 13.3 Cookie/session

Browser apps often use secure cookies.

Requires CSRF protection if state-changing endpoints.

## 13.4 mTLS

Client certificate authenticates caller/service.

Strong for service-to-service when managed properly.

## 13.5 API key

Simple credential for service/client.

Needs hashing, rotation, scoping, rate limiting.

## 13.6 Rule

Authentication mechanism should match client type and threat model.

---

# 14. Bearer Token dan JWT

JWT is a signed/encrypted token format commonly used with OAuth2/OIDC.

## 14.1 JWT contains claims

Common claims:

```text
iss  issuer
sub  subject
aud  audience
exp  expiration time
nbf  not before
iat  issued at
scope
groups
roles
tenant_id
```

## 14.2 Signature verification

Server verifies token was issued by trusted issuer.

## 14.3 Do not decode only

Bad:

```java
Base64 decode JWT and trust claims
```

Need signature/issuer/audience/time validation.

## 14.4 JWT is bearer

Whoever has token can use it.

Protect transport/logging/storage.

## 14.5 Rule

JWT validation is cryptographic and semantic, not just parsing JSON.

---

# 15. JWT Validation Checklist

## 15.1 Must validate

- signature;
- algorithm allowlist;
- issuer `iss`;
- audience `aud`;
- expiration `exp`;
- not-before `nbf`;
- issued-at/token age if policy;
- clock skew;
- key ID and JWK resolution;
- token type/use;
- scopes/roles claims;
- tenant claim if used.

## 15.2 Algorithm confusion

Do not accept arbitrary token algorithm.

Allowlist expected algorithms.

## 15.3 Key rotation

Support JWKS refresh/rotation.

Cache safely.

## 15.4 Time validation

Use clock skew policy.

## 15.5 Audience

A token for service A should not be accepted by service B.

## 15.6 Rule

A JWT is valid only if all relevant cryptographic and contextual checks pass.

---

# 16. OIDC/OAuth2 dalam REST API

## 16.1 OAuth2

Authorization framework for delegated access.

REST API often acts as resource server.

## 16.2 OIDC

Authentication layer on top of OAuth2.

Provides identity claims.

## 16.3 Access token vs ID token

APIs generally consume access tokens, not ID tokens.

## 16.4 Scopes

Access token scopes represent delegated permissions.

## 16.5 Claims

Use claims to map identity, tenant, roles.

## 16.6 Rule

A REST API should know whether it validates access token, ID token, or opaque token introspection.

---

# 17. MicroProfile JWT Mental Model

MicroProfile JWT defines JWT-based RBAC for microservice endpoints.

## 17.1 It validates signed JWTs

Tokens issued by OIDC/OAuth2 or trusted providers can be verified.

## 17.2 RBAC

Claims can be used for role-based access control.

## 17.3 Integration

Commonly exposes:

```java
@Inject JsonWebToken jwt;
```

and maps groups/roles to security roles.

## 17.4 Config

Uses MicroProfile Config properties for issuer/public key/etc.

## 17.5 When useful

MicroProfile runtimes like Open Liberty, Payara, Quarkus, WildFly/Helidon variants.

## 17.6 Rule

If using MicroProfile JWT, do not implement parallel ad-hoc JWT validation unless needed.

---

# 18. Jakarta Security Mental Model

Jakarta Security defines a standard for secure Jakarta EE applications.

## 18.1 Concepts

- HTTP authentication mechanisms;
- identity stores;
- caller principal;
- groups;
- security context API.

## 18.2 Jakarta Security `SecurityContext`

Different type:

```java
jakarta.security.enterprise.SecurityContext
```

not same as:

```java
jakarta.ws.rs.core.SecurityContext
```

## 18.3 Integration

Jakarta Security can integrate with Servlet/Jakarta EE security, which can surface into JAX-RS `SecurityContext`.

## 18.4 Jakarta Security 4.0

Jakarta Security 4.0 is for Jakarta EE 11 and includes enhancements such as API support for multiple authentication mechanisms and built-in mechanism qualifiers.

## 18.5 Rule

Distinguish Jakarta Security API from JAX-RS `SecurityContext`, even if concepts overlap.

---

# 19. Container-Managed Security vs Application-Managed Filter

## 19.1 Container-managed

Runtime/container handles auth.

Examples:

- Jakarta Security;
- MicroProfile JWT;
- Servlet security;
- application server security.

Pros:

- standard integration;
- central config;
- roles/security context populated;
- less custom crypto.

Cons:

- container-specific config;
- less custom control;
- debugging can be harder.

## 19.2 Application-managed filter

You write `ContainerRequestFilter`.

Pros:

- full control;
- portable across non-EE runtimes;
- custom token/API key logic.

Cons:

- easy to make security mistakes;
- you own verification/rotation/errors;
- more code to test.

## 19.3 Recommendation

Use container/runtime security when it fits.

Use custom filter for special integration or lightweight framework needs.

## 19.4 Rule

Do not hand-roll crypto/security mechanisms unless necessary and reviewed.

---

# 20. Authentication Filter dengan `ContainerRequestFilter`

## 20.1 Skeleton

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerAuthenticationFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        String authorization = ctx.getHeaderString(HttpHeaders.AUTHORIZATION);

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            ctx.abortWith(unauthorized("AUTHENTICATION_REQUIRED"));
            return;
        }

        String token = authorization.substring("Bearer ".length());
        AuthenticatedPrincipal principal = tokenVerifier.verify(token);

        SecurityContext original = ctx.getSecurityContext();
        ctx.setSecurityContext(new BearerSecurityContext(principal, original.isSecure()));

        ctx.setProperty("currentActor", mapActor(principal));
    }
}
```

## 20.2 Do not log token

Never log Authorization header.

## 20.3 Error

Missing/invalid token:

```text
401
```

with `WWW-Authenticate`.

## 20.4 Order

Authentication before authorization.

## 20.5 Rule

Auth filter establishes identity and security context, not domain access.

---

# 21. Custom `SecurityContext` Implementation

## 21.1 Example

```java
public final class BearerSecurityContext implements SecurityContext {
    private final Principal principal;
    private final Set<String> roles;
    private final boolean secure;

    public BearerSecurityContext(Principal principal, Set<String> roles, boolean secure) {
        this.principal = principal;
        this.roles = Set.copyOf(roles);
        this.secure = secure;
    }

    @Override
    public Principal getUserPrincipal() {
        return principal;
    }

    @Override
    public boolean isUserInRole(String role) {
        return roles.contains(role);
    }

    @Override
    public boolean isSecure() {
        return secure;
    }

    @Override
    public String getAuthenticationScheme() {
        return "Bearer";
    }
}
```

## 21.2 Immutable

Make it immutable and per-request.

## 21.3 Preserve secure

Use original `ctx.getSecurityContext().isSecure()` unless you have correct proxy-aware logic.

## 21.4 Roles mapping

Roles should be mapped from trusted claims/groups/scopes.

## 21.5 Rule

Custom SecurityContext must be simple, immutable, and reflect verified identity only.

---

# 22. 401 vs 403 vs 404

## 22.1 401 Unauthorized

Caller is not authenticated or credentials invalid.

Examples:

- missing token;
- expired token;
- invalid signature.

## 22.2 403 Forbidden

Caller authenticated but not allowed.

Examples:

- missing role/scope;
- tenant mismatch;
- insufficient permission.

## 22.3 404 Not Found

Resource does not exist.

Sometimes used to hide existence of forbidden resource.

## 22.4 Hidden resource policy

If exposing existence is sensitive:

```text
not found or not accessible → 404
```

But use consistently.

## 22.5 Rule

401 = identity problem. 403 = permission problem. 404 = absence or deliberately hidden existence.

---

# 23. `WWW-Authenticate` dan Auth Error Contract

For 401, response should include `WWW-Authenticate` header when using HTTP auth schemes.

## 23.1 Bearer example

```http
WWW-Authenticate: Bearer realm="api", error="invalid_token"
```

## 23.2 Problem Details body

```json
{
  "type": "https://api.example.com/problems/authentication-required",
  "title": "Authentication required",
  "status": 401,
  "code": "AUTHENTICATION_REQUIRED",
  "correlationId": "..."
}
```

## 23.3 Avoid leaking details

Do not reveal too much about token validity to attackers.

## 23.4 Expired token

Can return:

```text
TOKEN_EXPIRED
```

depending policy.

## 23.5 Rule

401 response should be machine-readable and compatible with HTTP auth clients.

---

# 24. Method-Level Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`

Jakarta Annotations provides:

```java
@RolesAllowed
@PermitAll
@DenyAll
```

## 24.1 Example

```java
@RolesAllowed("ADMIN")
@DELETE
@Path("/customers/{id}")
public Response delete(...) { ... }
```

## 24.2 Runtime support

Enforcement depends on container/framework integration.

Test it.

## 24.3 Scope

Works for coarse role-based access.

## 24.4 Does not replace domain authorization

`@RolesAllowed("OFFICER")` does not check officer assignment to a specific case.

## 24.5 `@PermitAll`

Explicitly open endpoint.

## 24.6 `@DenyAll`

Block endpoint/method.

## 24.7 Rule

Use method-level security for coarse gates, not resource-specific rules.

---

# 25. Role-Based Access Control/RBAC

## 25.1 Role examples

```text
ADMIN
OFFICER
SUPERVISOR
APPLICANT
SYSTEM
```

## 25.2 Pros

- simple;
- easy to understand;
- container-supported;
- good for coarse endpoint gates.

## 25.3 Cons

- role explosion;
- not enough for resource ownership;
- hard to express tenant/data rules;
- often confused with IdP groups.

## 25.4 Good use

```java
@RolesAllowed("ADMIN")
```

for admin endpoint.

## 25.5 Bad use

```java
if (role == OFFICER) view any case
```

without assignment/tenant check.

## 25.6 Rule

RBAC is coarse-grained. Pair it with resource/data authorization.

---

# 26. Scope-Based Access Control

Scopes represent delegated capabilities.

## 26.1 Examples

```text
customer:read
customer:write
case:approve
document:upload
```

## 26.2 Token claim

Often:

```json
{
  "scope": "customer:read customer:write"
}
```

or array depending issuer.

## 26.3 Use case

Service/API clients with OAuth2 access tokens.

## 26.4 Annotation-driven scope

```java
@RequiresScope("case:approve")
```

with DynamicFeature.

## 26.5 Scopes still coarse

Scope says caller may perform category of operation.

Still check resource-specific authorization.

## 26.6 Rule

Scopes are good for API capability gates, not complete data access policy.

---

# 27. Permission-Based Access Control

Permissions are more precise than roles.

## 27.1 Examples

```text
CASE_VIEW
CASE_EDIT
CASE_APPROVE
LICENCE_RENEW
DOCUMENT_DOWNLOAD
```

## 27.2 Mapping

Role/group/scope can map to permissions.

```text
SUPERVISOR → CASE_VIEW, CASE_APPROVE
```

## 27.3 In app

```java
authorizationPolicy.require(actor, Permission.CASE_APPROVE, caseResource);
```

## 27.4 Pros

- clearer action model;
- easier to reason than broad roles.

## 27.5 Cons

- more policy infrastructure;
- mapping complexity.

## 27.6 Rule

Permissions are often a better internal model than raw roles.

---

# 28. Attribute-Based Access Control/ABAC

ABAC uses attributes of actor, resource, action, environment.

## 28.1 Example

```text
actor.department == resource.department
AND actor.role == SUPERVISOR
AND resource.status != CLOSED
```

## 28.2 Attributes

- actor tenant;
- actor department;
- resource owner;
- resource confidentiality;
- case status;
- time;
- network zone;
- action.

## 28.3 Use case

Enterprise/government systems with rich access rules.

## 28.4 Implementation

Policy service or rule engine.

## 28.5 Rule

ABAC belongs in authorization policy layer, not random resource if/else.

---

# 29. Resource/Data Authorization

Resource authorization checks action on specific resource.

## 29.1 Example

```java
public CaseDetail getCase(CaseId caseId, CurrentActor actor) {
    Case caseAggregate = caseRepository.find(caseId)
        .orElseThrow(CaseNotFoundException::new);

    authorizationPolicy.assertCanView(actor, caseAggregate);

    return mapper.toDetail(caseAggregate);
}
```

## 29.2 Why after load?

Need resource attributes:

- tenant;
- owner;
- status;
- assignment;
- confidentiality.

## 29.3 Avoid data leak

If actor cannot access, choose 403 or hidden 404.

## 29.4 Query-level authorization

For list/search, filter data by actor permission at query level.

## 29.5 Rule

Data authorization must happen for every read/write path, including list/export/background operations.

---

# 30. Tenant Authorization

Multi-tenant API must prevent cross-tenant access.

## 30.1 Tenant sources

- token claim;
- path parameter;
- subdomain;
- trusted gateway header;
- database membership.

## 30.2 Path tenant example

```text
GET /tenants/T1/customers/C1
```

Must verify actor can access `T1`.

## 30.3 Token tenant

```json
{"tenant_id": "T1"}
```

Must match resource tenant.

## 30.4 Header tenant

```http
X-Tenant-ID: T1
```

Only trust if gateway-set.

## 30.5 Query enforcement

Every repository query must include tenant boundary.

## 30.6 Rule

Tenant ID is a security boundary, not just a filter parameter.

---

# 31. Ownership, Assignment, Delegation

## 31.1 Ownership

User owns resource.

```text
applicant owns application
```

## 31.2 Assignment

User assigned to case/task.

```text
officer assigned to case
```

## 31.3 Delegation

User acts on behalf of another user/team.

```text
supervisor delegates approval
```

## 31.4 Authorization must model these explicitly

Avoid role-only shortcuts.

## 31.5 Audit

Delegation/impersonation must be audit logged.

## 31.6 Rule

Enterprise authorization often depends on relationship, not just role.

---

# 32. Authorization Service/Policy Pattern

## 32.1 Interface

```java
public interface CaseAuthorizationPolicy {
    void assertCanView(CurrentActor actor, Case caseAggregate);
    void assertCanUpdate(CurrentActor actor, Case caseAggregate);
    void assertCanApprove(CurrentActor actor, Case caseAggregate);
}
```

## 32.2 Implementation

```java
@ApplicationScoped
public class DefaultCaseAuthorizationPolicy implements CaseAuthorizationPolicy {

    @Override
    public void assertCanView(CurrentActor actor, Case c) {
        if (!sameTenant(actor, c)) {
            throw new AccessDeniedException("CASE_ACCESS_DENIED");
        }
        if (actor.hasPermission("CASE_VIEW_ALL")) {
            return;
        }
        if (c.isAssignedTo(actor.id())) {
            return;
        }
        throw new AccessDeniedException("CASE_ACCESS_DENIED");
    }
}
```

## 32.3 Service usage

```java
Case c = repository.get(caseId);
policy.assertCanView(actor, c);
return mapper.toResponse(c);
```

## 32.4 Benefits

- centralized;
- testable;
- reusable;
- auditable;
- explicit.

## 32.5 Rule

Authorization policy should be first-class code, not scattered if-statements.

---

# 33. Coarse-Grained vs Fine-Grained Authorization

## 33.1 Coarse-grained

Endpoint-level.

```java
@RolesAllowed("OFFICER")
```

or filter:

```java
@RequiresScope("case:read")
```

## 33.2 Fine-grained

Resource/data-level.

```java
policy.assertCanView(actor, case)
```

## 33.3 Both needed

Coarse gate prevents obviously wrong callers.

Fine gate prevents data leakage.

## 33.4 Example

```text
Scope case:read required
AND actor must be assigned to case or have CASE_VIEW_ALL permission
```

## 33.5 Rule

Endpoint security is necessary but insufficient.

---

# 34. SecurityContext vs Domain Policy

## 34.1 SecurityContext tells

- principal;
- role;
- scheme;
- secure.

## 34.2 Domain policy needs

- actor;
- tenant;
- resource;
- action;
- business state;
- relationships.

## 34.3 Mapping flow

```text
SecurityContext/JWT claims
  ↓
CurrentActor
  ↓
AuthorizationPolicy
  ↓
Allow/Deny
```

## 34.4 Rule

SecurityContext is input to policy, not policy itself.

---

# 35. Path Tenant vs Token Tenant vs Header Tenant

## 35.1 Path tenant

Visible and explicit:

```text
/tenants/{tenantId}/...
```

Good for admin/multi-tenant APIs.

## 35.2 Token tenant

Derived from identity:

```json
tenant_id
```

Good for tenant-scoped APIs.

## 35.3 Header tenant

Convenient but dangerous if untrusted.

Use only from gateway or internal clients.

## 35.4 Conflict policy

If multiple tenant sources exist, define:

```text
path tenant must equal token tenant unless actor has cross-tenant permission
```

## 35.5 Rule

Never silently choose one tenant source when sources disagree.

---

# 36. Trusted Gateway Headers

Common headers:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Request-ID
X-User-ID
X-Tenant-ID
X-Scopes
```

## 36.1 Trust only from gateway

Public clients can spoof headers.

## 36.2 Strip at edge

Gateway should remove incoming client-supplied privileged headers and set its own.

## 36.3 App config

App should trust forwarded identity headers only when request comes from trusted network/proxy and architecture says so.

## 36.4 Prefer signed tokens over raw identity headers

Raw identity headers are fragile unless strongly controlled.

## 36.5 Rule

Headers are user input unless a trusted component overwrote them.

---

# 37. TLS Termination dan `isSecure()`

## 37.1 App behind gateway

Client:

```text
HTTPS → Gateway
```

Gateway to app:

```text
HTTP internal
```

## 37.2 `isSecure()`

May return false unless server honors forwarded proto.

## 37.3 Consequences

- secure cookie flag logic;
- absolute link generation;
- redirect logic;
- audit.

## 37.4 Solution

Configure runtime/server/gateway to handle forwarded headers safely.

## 37.5 Rule

Transport assumptions must be tested in deployed topology, not localhost.

---

# 38. CORS Bukan Authentication/Authorization

CORS controls browser access to responses.

## 38.1 It does not stop non-browser clients

curl/Postman/backend clients ignore CORS.

## 38.2 Bad assumption

```text
If Origin not allowed, API is secure.
```

Wrong.

## 38.3 Still need auth

Every protected endpoint needs authentication/authorization.

## 38.4 Credentials

If using cookies:

```http
Access-Control-Allow-Credentials: true
```

requires specific origin, not wildcard.

## 38.5 Rule

CORS is browser policy, not API authorization.

---

# 39. CSRF untuk Cookie-Based REST API

If browser automatically sends cookies, state-changing endpoints can be CSRF targets.

## 39.1 Risk

Attacker site triggers:

```http
POST https://api.example.com/payments
```

Browser sends session cookie.

## 39.2 Mitigations

- SameSite cookies;
- CSRF token;
- Origin/Referer checks;
- double-submit cookie;
- custom header requiring preflight;
- not using cookie auth for API.

## 39.3 Bearer token in Authorization header

Less CSRF-prone if not automatically attached by browser.

But vulnerable to XSS storage issues if stored badly.

## 39.4 Rule

Cookie-authenticated REST APIs need CSRF strategy.

---

# 40. Session/Cookie Security

## 40.1 Cookie flags

```http
Secure
HttpOnly
SameSite=Lax/Strict/None
Path
Domain
Max-Age
```

## 40.2 Secure

Only over HTTPS.

## 40.3 HttpOnly

Not accessible from JavaScript.

## 40.4 SameSite

Reduces CSRF depending mode.

## 40.5 Session fixation

Rotate session after login.

## 40.6 Logout

Invalidate server session/token.

## 40.7 Rule

Cookie auth is stateful security architecture, not just setting a cookie.

---

# 41. API Key Security

## 41.1 Use cases

- service integration;
- partner API;
- simple machine authentication.

## 41.2 Store securely

Do not store plaintext API keys.

Store hash.

## 41.3 Rotate

Support key rotation and revocation.

## 41.4 Scope

API keys should have permissions/scopes.

## 41.5 Rate limit

API keys should be rate-limited.

## 41.6 Header

Use dedicated header:

```http
X-API-Key
```

or standard Authorization scheme if defined.

## 41.7 Rule

API key is a password. Treat it as secret.

---

# 42. mTLS / Client Certificate

## 42.1 What it proves

Client possesses private key corresponding to trusted certificate.

## 42.2 Use cases

- service-to-service;
- high-security partner integrations;
- internal APIs.

## 42.3 Mapping

Map certificate subject/SAN to service identity.

## 42.4 Rotation

Certificate lifecycle must be managed.

## 42.5 Combining with JWT

mTLS authenticates client channel; JWT can carry user delegation/claims.

## 42.6 Rule

mTLS proves machine/client identity, not necessarily end-user identity.

---

# 43. Service-to-Service Security

## 43.1 Patterns

- mTLS;
- OAuth2 client credentials;
- signed JWT;
- API key;
- service mesh identity;
- gateway-issued internal token.

## 43.2 Identity

Service identity should be explicit:

```text
report-service
email-service
case-worker
```

## 43.3 Least privilege

Service should get only scopes it needs.

## 43.4 Audit

Record service actor and optionally end-user delegation.

## 43.5 Rule

Internal network is not a security boundary by itself.

---

# 44. Token Propagation

When service A calls service B, should it pass user's token?

## 44.1 Propagate user token

Pros:

- B sees original user.
- consistent user authorization.

Cons:

- token audience may be wrong;
- token scope may not include B;
- token leaks further;
- confused deputy risk.

## 44.2 Token exchange

A exchanges token for token intended for B.

Better in OAuth2 architectures.

## 44.3 Service token

A calls B as itself.

Needs audit of initiating user separately.

## 44.4 Rule

Do not blindly forward inbound token to downstream services.

---

# 45. User Delegation vs Service Acting as Itself

## 45.1 User delegation

Service performs action on behalf of user.

Audit:

```text
actor=user123
via=case-service
```

## 45.2 Service acting as itself

Service performs internal operation.

Audit:

```text
actor=report-service
```

## 45.3 Impersonation

Very sensitive.

Requires:

- explicit permission;
- audit;
- limited scope;
- UI indicator if human.

## 45.4 Rule

Always distinguish “who authenticated” and “on whose behalf action occurs”.

---

# 46. Idempotency, Replay Protection, Nonce, Timestamp

Security-sensitive APIs may need replay protection.

## 46.1 Idempotency

Prevents duplicate unsafe operations.

```http
Idempotency-Key
```

## 46.2 Timestamp

Reject old signed requests.

## 46.3 Nonce

Reject reused request signatures.

## 46.4 Body hash

Bind signature/idempotency to body.

## 46.5 Rule

For payment/webhook/security-sensitive write APIs, design replay protection explicitly.

---

# 47. Input Validation sebagai Security Boundary

Validation helps reduce attack surface.

## 47.1 Validate

- path IDs;
- query params;
- headers;
- JSON body;
- multipart metadata;
- file size/type;
- sort/filter fields.

## 47.2 But validation is not enough

Still need:

- authentication;
- authorization;
- rate limiting;
- output control;
- data access constraints.

## 47.3 Rule

Validation says “input shape is acceptable”; it does not say “operation is allowed”.

---

# 48. Output Security: Data Minimization and Field-Level Authorization

## 48.1 Do not over-return

Response DTO should include only fields client is allowed to see.

## 48.2 Field-level authorization

Example:

```text
case detail has confidential notes
only supervisor can see notes
```

## 48.3 Strategies

- separate DTO per view;
- projection based on permission;
- resource-specific response mapper;
- explicit field redaction.

## 48.4 Avoid lazy entity serialization

It leaks fields accidentally.

## 48.5 Rule

Authorization applies to output fields too, not only endpoint access.

---

# 49. Error Handling Security

## 49.1 Do not leak

- whether username exists;
- internal token validation details;
- stack traces;
- SQL;
- resource existence if hidden policy;
- secrets;
- raw token.

## 49.2 Standard errors

Use Problem Details.

## 49.3 Auth errors

Be careful with detail.

```text
invalid_token
```

is often enough.

## 49.4 Correlation ID

Include for support.

## 49.5 Rule

Security errors should be useful but not revealing.

---

# 50. Security Logging

## 50.1 Log security events

- login/auth success/failure;
- token verification failure category;
- forbidden access;
- tenant mismatch;
- admin action;
- sensitive export/download;
- impersonation/delegation;
- key rotation/revocation.

## 50.2 Do not log

- tokens;
- passwords;
- API keys;
- cookies;
- full PII payload;
- private certificates/keys.

## 50.3 Include

- correlation ID;
- actor ID;
- tenant ID;
- route template;
- action;
- decision;
- reason code;
- client IP if trusted.

## 50.4 Tamper-resistant logs

For high-security systems, audit logs need integrity and retention controls.

## 50.5 Rule

Security logs are evidence; design them deliberately.

---

# 51. Security Metrics and Alerts

## 51.1 Metrics

```text
auth_failures_total{reason}
authorization_denials_total{code,route}
tenant_mismatch_total{route}
token_expired_total
invalid_signature_total
rate_limit_denied_total
```

## 51.2 Alerts

- spike in invalid tokens;
- repeated tenant mismatch;
- forbidden spike after deploy;
- API key abuse;
- mTLS failures;
- suspicious admin actions.

## 51.3 Avoid high cardinality

Do not label by token, email, user ID, raw IP unless carefully controlled.

## 51.4 Rule

Security metrics should detect attack patterns and config regressions.

---

# 52. Testing Authentication

## 52.1 Cases

- missing credential;
- malformed credential;
- expired token;
- wrong issuer;
- wrong audience;
- invalid signature;
- revoked token/key;
- unsupported algorithm;
- valid token.

## 52.2 Expected statuses

- missing/invalid → 401;
- valid → proceeds.

## 52.3 Headers

Assert `WWW-Authenticate` where relevant.

## 52.4 Logs

Ensure tokens are not logged.

## 52.5 Rule

Authentication tests must include cryptographic/contextual failures, not just happy path.

---

# 53. Testing Authorization

## 53.1 Coarse tests

- missing role;
- missing scope;
- correct role/scope.

## 53.2 Fine tests

- user assigned to resource;
- user not assigned;
- supervisor override;
- cross-tenant access;
- service account access;
- admin access.

## 53.3 Error policy

Assert 403 or hidden 404.

## 53.4 Negative tests

Every protected endpoint should have negative authorization test.

## 53.5 Rule

Authorization tests are more important than authentication happy path.

---

# 54. Testing Tenant/Data Authorization

## 54.1 Cross-tenant read

User tenant T1 requests T2 resource.

Should fail.

## 54.2 Cross-tenant list

User tenant T1 list endpoint must not include T2 data.

## 54.3 Export

Exports must apply tenant/permission filters too.

## 54.4 Background jobs

Jobs created by user must preserve authorization context or re-check on execution.

## 54.5 Rule

List/export/report endpoints are common data leak sources. Test them hard.

---

# 55. Threat Modeling JAX-RS APIs

Ask:

## 55.1 Identity

- How is caller authenticated?
- Can token be forged/replayed?
- Is token audience correct?

## 55.2 Authorization

- Can caller access other tenant?
- Can caller access unassigned resource?
- Can caller escalate role/scope?

## 55.3 Input

- Can request body cause DoS?
- Can query bypass filters?
- Can sort/filter inject unsafe field?

## 55.4 Output

- Does response expose hidden fields?
- Are errors leaking existence/details?

## 55.5 Infrastructure

- Are forwarded headers trusted safely?
- Is TLS/mTLS configured?
- Are secrets logged?

## 55.6 Rule

Threat model per endpoint category, especially write/export/admin endpoints.

---

# 56. Runtime Differences: Jakarta EE Servers, Quarkus, RESTEasy, Jersey, Liberty

## 56.1 Jakarta EE servers

May provide Jakarta Security and container-managed security.

## 56.2 MicroProfile runtimes

May provide MicroProfile JWT integration.

## 56.3 Quarkus

Offers security extensions and RESTEasy Reactive/JAX-RS style integration.

## 56.4 Jersey standalone

May need custom filters/security integration.

## 56.5 Open Liberty/Payara/WildFly

Have their own config for JWT/OIDC/security features.

## 56.6 Rule

Security behavior is runtime/configuration dependent. Test deployed runtime, not only resource code.

---

# 57. Migration: `javax.ws.rs` to `jakarta.ws.rs` Security Code

## 57.1 Old imports

```java
javax.ws.rs.core.SecurityContext
javax.ws.rs.container.ContainerRequestFilter
javax.annotation.security.RolesAllowed
```

## 57.2 New imports

```java
jakarta.ws.rs.core.SecurityContext
jakarta.ws.rs.container.ContainerRequestFilter
jakarta.annotation.security.RolesAllowed
```

## 57.3 Trap

A filter implementing `javax.ws.rs.container.ContainerRequestFilter` is not a Jakarta REST provider.

## 57.4 Jakarta Security namespace

```java
jakarta.security.enterprise.SecurityContext
```

## 57.5 Rule

Migration must update security annotations, filters, context types, providers, and tests.

---

# 58. Common Failure Modes

## 58.1 JWT decoded but not verified

Critical vulnerability.

## 58.2 Audience not checked

Token for another API accepted.

## 58.3 Role used as data authorization

User sees all resources.

## 58.4 Tenant header trusted from client

Cross-tenant access.

## 58.5 `isSecure()` false behind gateway

Secure cookie/link logic wrong.

## 58.6 `@RolesAllowed` assumed active but runtime not enforcing

Endpoint unprotected.

## 58.7 API key stored plaintext

Secret leak impact severe.

## 58.8 Tokens logged

Incident.

## 58.9 CORS treated as API security

Non-browser bypass.

## 58.10 Cookie auth without CSRF

State-changing attack.

## 58.11 Service blindly forwards user token

Confused deputy/token audience issue.

## 58.12 List/export endpoint misses authorization filter

Data leak.

---

# 59. Best Practices

## 59.1 Use runtime security when appropriate

Jakarta Security/MicroProfile JWT/OIDC extension.

## 59.2 Validate JWT fully

Signature, issuer, audience, time, algorithm, key.

## 59.3 Map principal to application actor

Use `CurrentActor`.

## 59.4 Separate coarse and fine authorization

Role/scope + resource policy.

## 59.5 Treat tenant as security boundary

Enforce in queries and services.

## 59.6 Do not trust forwarded headers from clients

Trust only edge-sanitized headers.

## 59.7 Standardize 401/403/404 policy

Document hidden resource behavior.

## 59.8 Use Problem Details

Safe error body.

## 59.9 Log security events safely

No tokens/secrets.

## 59.10 Test negative cases

Especially cross-tenant/data access.

---

# 60. Anti-Patterns

## 60.1 `if (principal != null) allow`

Authentication mistaken as authorization.

## 60.2 Domain service accepts `SecurityContext`

Layer leak.

## 60.3 `@RolesAllowed("USER")` on everything

No meaningful policy.

## 60.4 Tenant ID from body trusted

Cross-tenant vulnerability.

## 60.5 Returning entity directly

Field/data leak.

## 60.6 Auth filter does database-heavy authorization per request for every endpoint

Performance and coupling problem.

## 60.7 Hiding auth errors inconsistently

Client confusion/security ambiguity.

## 60.8 Security headers only in some responses

Aborted/error responses missing headers.

## 60.9 No service-to-service identity model

Internal calls untraceable.

## 60.10 No audit for admin actions

Operational blind spot.

---

# 61. Production Checklist

## 61.1 Authentication

- [ ] Authentication mechanism chosen deliberately.
- [ ] JWT signature validated.
- [ ] Issuer/audience/time checked.
- [ ] Algorithms allowlisted.
- [ ] JWKS rotation handled.
- [ ] Tokens not logged.
- [ ] 401 includes correct auth header if applicable.

## 61.2 SecurityContext

- [ ] `SecurityContext` populated correctly.
- [ ] `CurrentActor` mapping exists.
- [ ] Domain does not depend on JAX-RS `SecurityContext`.
- [ ] `isSecure()` tested behind gateway.
- [ ] authentication scheme normalized.

## 61.3 Authorization

- [ ] Coarse endpoint gates in place.
- [ ] Fine-grained resource policy exists.
- [ ] Tenant boundary enforced.
- [ ] List/export endpoints filtered.
- [ ] Field-level authorization handled.
- [ ] Hidden 404 policy documented.

## 61.4 Headers/gateway

- [ ] Forwarded headers trusted only from gateway.
- [ ] Privileged identity headers stripped/recreated at edge.
- [ ] CORS allowlist correct.
- [ ] CSRF strategy if cookie auth.
- [ ] Security headers on success/error/abort.

## 61.5 Service-to-service

- [ ] Service identity model exists.
- [ ] Token propagation policy documented.
- [ ] mTLS/API key/OAuth2 client credential configured.
- [ ] Delegation audited.

## 61.6 Observability

- [ ] Security events logged safely.
- [ ] Auth failures metrics.
- [ ] Authorization denial metrics.
- [ ] Tenant mismatch alerts.
- [ ] Admin actions audited.
- [ ] No high-cardinality sensitive labels.

## 61.7 Testing

- [ ] Missing/invalid/expired token tests.
- [ ] Wrong issuer/audience tests.
- [ ] Role/scope negative tests.
- [ ] Cross-tenant tests.
- [ ] Data authorization tests.
- [ ] Export/list authorization tests.
- [ ] CSRF/CORS tests if browser.
- [ ] Runtime method security tests.

---

# 62. Latihan

## Latihan 1 — Custom SecurityContext

Buat `BearerSecurityContext` immutable.

Test:

- principal;
- roles;
- scheme;
- secure flag.

## Latihan 2 — Authentication Filter

Implement filter:

- missing token → 401;
- invalid token → 401;
- valid token → set security context.

Pastikan token tidak pernah masuk log.

## Latihan 3 — CurrentActor Resolver

Map `SecurityContext` dan JWT claims ke:

```java
CurrentUser
CurrentService
```

## Latihan 4 — Scope Annotation

Buat:

```java
@RequiresScope("case:read")
```

dengan `DynamicFeature`.

## Latihan 5 — Domain Authorization Policy

Buat `CaseAuthorizationPolicy`.

Rules:

- same tenant required;
- assigned officer can view;
- supervisor can view all cases in tenant;
- cross-tenant denied.

## Latihan 6 — Hidden 404 Policy

Implement policy:

```text
if resource exists but user cannot access → 404
```

Test difference with admin.

## Latihan 7 — Tenant Mismatch

Path tenant `T1`, token tenant `T2`.

Return 403 or 404 according policy.

## Latihan 8 — Cookie Auth CSRF

For cookie-auth endpoint, implement CSRF token check.

Test same-site and cross-site scenario.

## Latihan 9 — Service-to-Service Token

Simulate service account token.

Ensure service can call internal endpoint but cannot act as arbitrary user.

---

# 63. Referensi Resmi

Referensi utama:

1. Jakarta RESTful Web Services 4.0 — `SecurityContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/securitycontext

2. Jakarta RESTful Web Services 4.0 — `ContainerRequestContext` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerrequestcontext

3. Jakarta RESTful Web Services 4.0 — `ContainerRequestFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerrequestfilter

4. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

5. Jakarta Security 4.0  
   https://jakarta.ee/specifications/security/4.0/

6. Jakarta Security 4.0 Specification  
   https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0

7. Jakarta Security 4.0 API Docs  
   https://jakarta.ee/specifications/security/4.0/apidocs/

8. MicroProfile JWT 2.1  
   https://microprofile.io/specifications/jwt/2-1/

9. MicroProfile JWT Auth 2.1 Specification  
   https://download.eclipse.org/microprofile/microprofile-jwt-auth-2.1/microprofile-jwt-auth-spec-2.1.html

10. RFC 9110 — HTTP Semantics  
    https://www.rfc-editor.org/rfc/rfc9110.html

11. RFC 6750 — OAuth 2.0 Bearer Token Usage  
    https://www.rfc-editor.org/rfc/rfc6750.html

12. OpenID Connect Core 1.0  
    https://openid.net/specs/openid-connect-core-1_0.html

13. OWASP API Security Top 10  
    https://owasp.org/API-Security/

---

# 64. Penutup

Security di JAX-RS bukan hanya `@RolesAllowed` dan bukan hanya JWT filter.

Mental model final:

```text
authenticate caller
  ↓
map principal/claims to CurrentActor
  ↓
coarse endpoint authorization
  ↓
tenant/resource/data authorization
  ↓
field-level response minimization
  ↓
secure error/log/metrics/audit
```

Prinsip final:

```text
Authentication proves identity.
Authorization proves permission.
Tenant boundary protects data isolation.
SecurityContext is boundary metadata.
Domain policy owns business access rules.
```

Top-tier JAX-RS engineer memastikan:

- token benar-benar diverifikasi;
- principal tidak langsung dianggap user domain;
- role/scope tidak menggantikan data authorization;
- tenant tidak diambil dari input tak dipercaya;
- service-to-service identity jelas;
- cookie/API key/mTLS punya threat model;
- errors dan logs tidak bocor;
- negative tests lebih banyak daripada happy path tests.

Part berikutnya:

```text
Bagian 019 — CORS, CSRF, Cookies, Browser Security, and REST APIs
```

Kita akan membahas browser-facing REST security secara mendalam: CORS protocol, preflight, credentials, cookies, SameSite, CSRF patterns, token storage, XSS interaction, security headers, and gateway/browser behavior.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-017.md](./learn-jaxrs-advanced-part-017.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-019.md](./learn-jaxrs-advanced-part-019.md)

</div>