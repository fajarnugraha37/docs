# learn-jaxrs-advanced-part-050.md

# Bagian 050 — JAX-RS and Jakarta Security / OAuth2 / OIDC / JWT: Authentication, Authorization, Token Validation, Scopes, Roles, Claims, SecurityContext, Method Security, Tenant-Aware Authorization, and Production Identity Architecture

> Target pembaca: Java/Jakarta engineer yang ingin memahami dan menerapkan **security identity architecture** untuk Jakarta REST/JAX-RS APIs secara production-grade. Fokus bagian ini bukan sekadar “decode JWT” atau “pakai `@RolesAllowed`”, tetapi bagaimana OAuth2, OpenID Connect, JWT, Jakarta Security, MicroProfile JWT, `SecurityContext`, scopes, roles, claims, tenant context, token propagation, token exchange, authorization policy, dan audit saling terhubung.
>
> Prinsip utama:
>
> ```text
> Authentication proves who the caller is.
> Authorization decides what the caller may do.
> JWT is a token format, not a security architecture by itself.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: AuthN, AuthZ, Identity, Token](#2-mental-model-authn-authz-identity-token)
3. [OAuth2 vs OpenID Connect vs JWT](#3-oauth2-vs-openid-connect-vs-jwt)
4. [Where Jakarta REST Fits](#4-where-jakarta-rest-fits)
5. [Where Jakarta Security Fits](#5-where-jakarta-security-fits)
6. [Where MicroProfile JWT Fits](#6-where-microprofile-jwt-fits)
7. [Identity Provider and Resource Server Model](#7-identity-provider-and-resource-server-model)
8. [OAuth2 Flows for APIs](#8-oauth2-flows-for-apis)
9. [OIDC ID Token vs OAuth2 Access Token](#9-oidc-id-token-vs-oauth2-access-token)
10. [JWT Structure](#10-jwt-structure)
11. [JWT Validation Checklist](#11-jwt-validation-checklist)
12. [Issuer, Audience, Subject](#12-issuer-audience-subject)
13. [Scopes, Roles, Groups, Permissions](#13-scopes-roles-groups-permissions)
14. [Claims Mapping to Application Identity](#14-claims-mapping-to-application-identity)
15. [CurrentActor Pattern](#15-currentactor-pattern)
16. [JAX-RS `SecurityContext`](#16-jax-rs-securitycontext)
17. [Jakarta Security Overview](#17-jakarta-security-overview)
18. [HTTP Authentication Mechanism](#18-http-authentication-mechanism)
19. [IdentityStore and Credential Validation](#19-identitystore-and-credential-validation)
20. [MicroProfile JWT `JsonWebToken`](#20-microprofile-jwt-jsonwebtoken)
21. [Method Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`](#21-method-security-rolesallowed-permitall-denyall)
22. [Why Role Checks Are Not Enough](#22-why-role-checks-are-not-enough)
23. [Object-Level Authorization](#23-object-level-authorization)
24. [Tenant-Aware Authorization](#24-tenant-aware-authorization)
25. [Policy Objects](#25-policy-objects)
26. [Token Propagation](#26-token-propagation)
27. [Token Relay vs Token Exchange](#27-token-relay-vs-token-exchange)
28. [Service Accounts and Client Credentials](#28-service-accounts-and-client-credentials)
29. [Machine-to-Machine APIs](#29-machine-to-machine-apis)
30. [mTLS and Workload Identity](#30-mtls-and-workload-identity)
31. [API Gateway Auth Offload](#31-api-gateway-auth-offload)
32. [Gateway-Injected Identity Headers](#32-gateway-injected-identity-headers)
33. [CORS/CSRF with OAuth/OIDC](#33-corscsrf-with-oauthoidc)
34. [Token Expiration, Refresh, Revocation](#34-token-expiration-refresh-revocation)
35. [JWKS and Key Rotation](#35-jwks-and-key-rotation)
36. [Opaque Tokens and Introspection](#36-opaque-tokens-and-introspection)
37. [Error Handling for Auth](#37-error-handling-for-auth)
38. [Audit Logging](#38-audit-logging)
39. [Observability](#39-observability)
40. [JAX-RS Implementation Sketch: Bearer Token Filter](#40-jax-rs-implementation-sketch-bearer-token-filter)
41. [Implementation Sketch: CurrentActor Injection](#41-implementation-sketch-currentactor-injection)
42. [Implementation Sketch: Authorization Policy](#42-implementation-sketch-authorization-policy)
43. [Implementation Sketch: Problem Details for Security Errors](#43-implementation-sketch-problem-details-for-security-errors)
44. [Testing Security](#44-testing-security)
45. [Threat Modeling](#45-threat-modeling)
46. [Common Failure Modes](#46-common-failure-modes)
47. [Best Practices](#47-best-practices)
48. [Anti-Patterns](#48-anti-patterns)
49. [Production Checklist](#49-production-checklist)
50. [Latihan](#50-latihan)
51. [Referensi Resmi](#51-referensi-resmi)
52. [Penutup](#52-penutup)

---

# 1. Tujuan Part Ini

JAX-RS API sering diamankan dengan kode seperti:

```java
@RolesAllowed("admin")
@GET
@Path("/users/{id}")
public UserResponse getUser(@PathParam("id") String id) { ... }
```

atau filter seperti:

```java
String token = authorization.substring("Bearer ".length());
Jwt jwt = parse(token);
```

Keduanya belum cukup.

Masalah umum:

- OAuth2 dan OIDC dicampur-adukkan;
- ID Token dipakai sebagai Access Token;
- JWT hanya di-decode, tidak divalidasi;
- `aud` tidak dicek;
- role dianggap cukup untuk object-level authorization;
- tenant claim dipercaya dari request body/header;
- token relay ke downstream tanpa audience check;
- `@RolesAllowed` dianggap full domain authorization;
- expired/revoked token tidak dipikirkan;
- JWKS rotation gagal;
- security error terlalu detail;
- audit tidak mencatat actor/tenant/action;
- service-to-service auth tidak jelas.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membedakan OAuth2, OIDC, JWT;
- memahami JAX-RS/Jakarta Security/MicroProfile JWT boundary;
- memvalidasi token dengan benar;
- memetakan claims ke application identity;
- memakai `SecurityContext` dengan tepat;
- menerapkan method security dan domain policy;
- mendesain tenant-aware authorization;
- memilih token relay/token exchange/service account;
- mengamankan gateway-injected identity;
- menguji authentication/authorization secara menyeluruh.

---

# 2. Mental Model: AuthN, AuthZ, Identity, Token

## 2.1 Authentication / AuthN

Menjawab:

```text
Who are you?
```

Contoh:

```text
User Fajar authenticated by OIDC provider.
Service payment-worker authenticated by mTLS/client credentials.
```

## 2.2 Authorization / AuthZ

Menjawab:

```text
Are you allowed to do this action on this resource?
```

Contoh:

```text
Fajar can view Application APP-1 because it belongs to his tenant and role allows application:read.
```

## 2.3 Identity

Application representation of caller:

```text
actorId
tenantId
roles
permissions
clientId
authMethod
```

## 2.4 Token

Portable proof/credential carrying claims or reference.

## 2.5 Rule

Do not confuse token possession with complete authorization.

---

# 3. OAuth2 vs OpenID Connect vs JWT

## 3.1 OAuth2

Authorization framework.

Primary concern:

```text
Delegated access to protected resources.
```

OAuth2 issues access tokens.

## 3.2 OpenID Connect / OIDC

Identity layer on top of OAuth2.

Primary concern:

```text
Authentication and identity claims about end-user.
```

OIDC introduces ID Token and UserInfo.

## 3.3 JWT

Token format: JSON Web Token.

JWT can be used as:

- access token;
- ID token;
- internal token;
- signed message.

## 3.4 Rule

OAuth2 is protocol/framework, OIDC is identity layer, JWT is token format.

---

# 4. Where Jakarta REST Fits

Jakarta REST handles:

- resource methods;
- request filters;
- response filters;
- exception mappers;
- `SecurityContext`;
- method annotations interoperability depending runtime;
- client API.

## 4.1 Common security extension points

```text
ContainerRequestFilter
SecurityContext
ExceptionMapper
DynamicFeature
NameBinding
```

## 4.2 Rule

JAX-RS is where authenticated identity becomes request/application context.

---

# 5. Where Jakarta Security Fits

Jakarta Security defines standards for securing Jakarta EE applications.

It includes concepts such as:

- authentication mechanisms;
- identity stores;
- security context;
- caller principal/groups;
- integration with container security.

## 5.1 Useful for

- standard Jakarta EE authentication integration;
- form/basic/custom authentication;
- identity store;
- container-managed security;
- runtime security context.

## 5.2 Rule

Jakarta Security is the Jakarta EE security foundation; JAX-RS uses the resulting security context at API boundary.

---

# 6. Where MicroProfile JWT Fits

MicroProfile JWT defines how signed JWT tokens from OIDC/OAuth2/trusted providers can be verified and used for RBAC in microservice endpoints.

## 6.1 Provides

- JWT verification contract;
- `JsonWebToken`;
- groups/roles mapping;
- CDI injection;
- role-based access integration.

## 6.2 Limit

It does not replace domain authorization or tenant policy.

## 6.3 Rule

MicroProfile JWT is convenient for bearer JWT validation and role access, not full authorization architecture.

---

# 7. Identity Provider and Resource Server Model

## 7.1 Identity Provider / Authorization Server

Issues tokens.

Examples:

- Keycloak;
- Auth0;
- Okta;
- Azure AD/Entra ID;
- government/enterprise IdP.

## 7.2 Resource Server

Your JAX-RS API.

It validates access token and enforces authorization.

## 7.3 Client

App/service that calls API.

## 7.4 Rule

JAX-RS API should behave as resource server, not identity provider, unless that is its explicit domain.

---

# 8. OAuth2 Flows for APIs

## 8.1 Authorization Code + PKCE

Browser/mobile app user login.

Recommended for public clients.

## 8.2 Client Credentials

Machine-to-machine.

No end-user.

## 8.3 Token Exchange

Exchange one token for another token suited to downstream audience.

## 8.4 Device Code

Device/CLI login.

## 8.5 Avoid legacy flows

Resource Owner Password Credentials is generally discouraged in modern architectures.

## 8.6 Rule

Flow choice depends on client type and trust model.

---

# 9. OIDC ID Token vs OAuth2 Access Token

## 9.1 ID Token

Audience is the client application.

Used by client to verify user authentication.

## 9.2 Access Token

Audience is resource server/API.

Used to access protected resources.

## 9.3 Common mistake

Using ID Token to call API.

## 9.4 Rule

API should validate access tokens intended for that API audience.

---

# 10. JWT Structure

JWT has:

```text
header.payload.signature
```

## 10.1 Header

```json
{
  "alg": "RS256",
  "kid": "key-1",
  "typ": "JWT"
}
```

## 10.2 Payload

Claims:

```json
{
  "iss": "https://idp.example.com",
  "sub": "user-123",
  "aud": "licensing-api",
  "exp": 1710000000,
  "iat": 1709996400,
  "scope": "application:read application:write",
  "tenant_id": "tenant-a"
}
```

## 10.3 Signature

Proves token integrity/authenticity if validated against trusted key.

## 10.4 Rule

Decoded JWT is just data; validated JWT is trusted credential.

---

# 11. JWT Validation Checklist

Validate:

- signature;
- allowed algorithm;
- issuer;
- audience;
- expiration;
- not before;
- issued at/token age if policy;
- subject presence;
- token type/use;
- scopes/roles;
- tenant claim format;
- key ID from trusted JWKS;
- environment separation.

## 11.1 Reject

- `alg=none`;
- unexpected algorithm;
- wrong audience;
- wrong issuer;
- expired token;
- future token beyond skew;
- missing required claims.

## 11.2 Rule

JWT validation must be explicit, not library-default wishful thinking.

---

# 12. Issuer, Audience, Subject

## 12.1 Issuer `iss`

Who issued token.

Must match trusted IdP.

## 12.2 Audience `aud`

Who token is intended for.

Your API must be in audience.

## 12.3 Subject `sub`

Principal identity.

Stable within issuer.

## 12.4 Rule

`aud` prevents token confusion across APIs.

---

# 13. Scopes, Roles, Groups, Permissions

## 13.1 Scope

OAuth2 authorization grant.

Example:

```text
application:read
application:submit
```

## 13.2 Role/group

Organizational grouping.

Example:

```text
officer
admin
applicant
```

## 13.3 Permission

Application-specific capability.

Example:

```text
CAN_APPROVE_APPLICATION
CAN_VIEW_INTERNAL_NOTES
```

## 13.4 Mapping

Token scope/role should be mapped to application permissions.

## 13.5 Rule

Use scopes/roles for coarse access; permissions/policies for domain access.

---

# 14. Claims Mapping to Application Identity

Raw claims are protocol detail.

Map to:

```java
public record CurrentActor(
    ActorId actorId,
    TenantId tenantId,
    Set<Role> roles,
    Set<Permission> permissions,
    String clientId,
    AuthMethod authMethod
) {}
```

## 14.1 Mapping rules

- validate claim existence;
- normalize tenant ID;
- map groups/scopes to permissions;
- reject unknown critical claims;
- record auth method/client.

## 14.2 Rule

Domain should depend on `CurrentActor`, not raw JWT.

---

# 15. CurrentActor Pattern

## 15.1 Resource

```java
@GET
@Path("/{id}")
public ApplicationResponse get(@PathParam("id") ApplicationId id) {
    CurrentActor actor = actorProvider.current();
    return service.get(actor, id);
}
```

## 15.2 Service

```java
public ApplicationResponse get(CurrentActor actor, ApplicationId id) {
    Application app = repo.findByTenantAndId(actor.tenantId(), id)
        .orElseThrow(ResourceNotFoundException::new);

    policy.requireCanView(actor, app);

    return mapper.toResponse(app, actor);
}
```

## 15.3 Rule

Actor should flow explicitly into domain operations.

---

# 16. JAX-RS `SecurityContext`

`SecurityContext` provides request security info:

- principal;
- role checks;
- auth scheme;
- secure channel.

## 16.1 Resource usage

```java
@Context
SecurityContext securityContext;
```

## 16.2 Custom context

Authentication filter can set custom `SecurityContext`.

## 16.3 Limitation

`isUserInRole()` is not enough for object-level and tenant authorization.

## 16.4 Rule

Use `SecurityContext` for HTTP boundary security state; use domain policy for business authorization.

---

# 17. Jakarta Security Overview

Jakarta Security standardizes secure Jakarta EE application patterns.

## 17.1 Concepts

- caller principal;
- groups;
- identity store;
- authentication mechanism;
- security context.

## 17.2 In Jakarta EE runtime

Security integration may populate container identity used by JAX-RS.

## 17.3 Rule

When running on full Jakarta EE runtime, prefer standard Jakarta Security integration over ad hoc filters where it fits.

---

# 18. HTTP Authentication Mechanism

Jakarta Security supports HTTP authentication mechanisms.

## 18.1 Use cases

- Basic auth;
- form auth;
- custom auth mechanism;
- multiple authentication mechanisms in modern Jakarta Security versions.

## 18.2 For bearer JWT

Some runtimes use MicroProfile JWT or vendor/OIDC integration rather than custom HAM.

## 18.3 Rule

Pick the runtime-native standard integration for bearer/OIDC when available.

---

# 19. IdentityStore and Credential Validation

IdentityStore validates credentials and provides groups.

## 19.1 Use case

- username/password;
- LDAP;
- database identity;
- in-memory identity for tests/dev.

## 19.2 API resource server

For OAuth2/OIDC bearer access token, token validation/JWKS often replaces username/password IdentityStore flow.

## 19.3 Rule

Use IdentityStore for credential-based app auth; use JWT/OIDC resource server validation for bearer APIs.

---

# 20. MicroProfile JWT `JsonWebToken`

MicroProfile JWT exposes token claims.

```java
@Inject
JsonWebToken jwt;
```

Examples:

```java
String subject = jwt.getSubject();
Set<String> groups = jwt.getGroups();
String tenant = jwt.getClaim("tenant_id");
```

## 20.1 Rule

Injecting `JsonWebToken` is convenient, but still map to `CurrentActor`.

---

# 21. Method Security: `@RolesAllowed`, `@PermitAll`, `@DenyAll`

## 21.1 Example

```java
@RolesAllowed("officer")
@GET
@Path("/applications/{id}")
public ApplicationResponse get(...) { ... }
```

## 21.2 Good for

- coarse route-level access;
- admin endpoint gate;
- obvious public/private separation.

## 21.3 Rule

Use annotations for coarse gate; not as only authorization.

---

# 22. Why Role Checks Are Not Enough

A user with role `officer` may not access all cases.

Need check:

- assigned department;
- tenant;
- case sensitivity;
- ownership;
- workflow state;
- data classification.

## 22.1 Example

```java
policy.requireCanViewCase(actor, caseAggregate);
```

## 22.2 Rule

Role says “kind of actor”; policy decides “specific action on specific object”.

---

# 23. Object-Level Authorization

Every endpoint with object ID needs object-level check.

## 23.1 Example

```java
Case c = repo.findByTenantAndId(actor.tenantId(), caseId)
    .orElseThrow(ResourceNotFoundException::new);

policy.requireCanView(actor, c);
```

## 23.2 Rule

Never load by ID alone and assume role solves access.

---

# 24. Tenant-Aware Authorization

Tenant claim from validated token becomes tenant context.

## 24.1 Query

```java
findByTenantAndId(actor.tenantId(), id)
```

## 24.2 Admin

Cross-tenant admin must have explicit permission and audit reason.

## 24.3 Rule

Tenant isolation is authorization, not just filtering.

---

# 25. Policy Objects

Policy object example:

```java
@ApplicationScoped
public class ApplicationAuthorizationPolicy {

    public void requireCanSubmit(CurrentActor actor, Application app) {
        requireSameTenant(actor, app);

        if (!actor.permissions().contains(Permission.APPLICATION_SUBMIT)) {
            throw new AccessDeniedException();
        }

        if (!app.isOwnedBy(actor.actorId())) {
            throw new AccessDeniedException();
        }

        if (!app.isSubmittable()) {
            throw new InvalidStateTransitionException();
        }
    }
}
```

## 25.1 Rule

Authorization policy should be explicit, centralized, and unit-tested.

---

# 26. Token Propagation

When service calls downstream:

Options:

- relay incoming access token;
- exchange token for downstream audience;
- use service token;
- mTLS identity;
- signed context header.

## 26.1 Avoid blindly forwarding

Not every downstream should receive user token.

## 26.2 Rule

Token propagation must be designed per downstream contract.

---

# 27. Token Relay vs Token Exchange

## 27.1 Token relay

Forward original token.

Only if:

- downstream trusts same issuer;
- token audience includes downstream;
- scopes appropriate;
- privacy acceptable.

## 27.2 Token exchange

Exchange token to new audience/scope.

Better least privilege.

## 27.3 Rule

Use token exchange when downstream audience/scope differs.

---

# 28. Service Accounts and Client Credentials

Machine-to-machine call often uses client credentials.

## 28.1 Token identity

Subject/client represents service, not user.

## 28.2 Audit

If operation triggered by user, carry actor context separately/safely.

## 28.3 Rule

Service token proves service identity, not necessarily end-user authority.

---

# 29. Machine-to-Machine APIs

For M2M:

- authenticate service;
- authorize client ID/scope;
- rate limit per client;
- audit service identity;
- rotate credentials;
- consider mTLS.

## 29.1 Rule

Machine clients need least privilege just like users.

---

# 30. mTLS and Workload Identity

mTLS can authenticate workload identity.

## 30.1 Use

- internal service identity;
- partner API;
- gateway-to-app trust.

## 30.2 Still need app authorization

mTLS says who connected, not whether action is allowed.

## 30.3 Rule

mTLS complements tokens and authorization policy.

---

# 31. API Gateway Auth Offload

Gateway may validate auth and inject headers.

## 31.1 App risks

- header spoofing;
- direct backend bypass;
- missing object auth;
- stale gateway route config.

## 31.2 App safeguards

- block direct access;
- strip incoming identity headers at edge;
- trust only known proxy;
- optionally verify signed internal token.

## 31.3 Rule

Gateway auth offload does not remove app authorization responsibility.

---

# 32. Gateway-Injected Identity Headers

Headers:

```http
X-User-ID
X-Tenant-ID
X-Groups
X-Scopes
```

## 32.1 Requirements

- allowlist;
- sanitize;
- signed/protected;
- documented;
- not accepted from public internet.

## 32.2 Better

Internal JWT from gateway to backend with signed claims.

## 32.3 Rule

Identity headers are credentials. Treat them accordingly.

---

# 33. CORS/CSRF with OAuth/OIDC

## 33.1 SPA with Authorization Code + PKCE

Access token typically stored client-side/in memory and sent as Authorization header.

CSRF risk lower than cookie auth, but XSS risk high.

## 33.2 Cookie-based session/OIDC

If browser automatically sends cookie, CSRF matters.

Use:

- SameSite;
- CSRF token;
- Origin/Referer checks.

## 33.3 Rule

CSRF depends on credential transport, not just OAuth/OIDC label.

---

# 34. Token Expiration, Refresh, Revocation

## 34.1 Access token

Short-lived.

## 34.2 Refresh token

Used by client to get new access token.

Should not be sent to resource API.

## 34.3 Revocation

JWT is stateless; revocation may need:

- short lifetime;
- introspection;
- denylist;
- session/version claim;
- gateway enforcement.

## 34.4 Rule

Resource APIs should not receive refresh tokens.

---

# 35. JWKS and Key Rotation

JWT verification uses keys from trusted issuer.

## 35.1 Cache

Cache JWKS with TTL.

## 35.2 Unknown kid

Refresh once, then reject if still unknown.

## 35.3 Do not use token-provided URL

JWKS URI is configured/trusted.

## 35.4 Rule

Key rotation failure should not create prolonged auth outage.

---

# 36. Opaque Tokens and Introspection

Not all access tokens are JWTs.

Opaque token requires introspection.

## 36.1 Pros

- revocation easier;
- token contents hidden;
- central control.

## 36.2 Cons

- runtime dependency on introspection endpoint;
- latency;
- caching complexity.

## 36.3 Rule

Token format is IdP/API architecture decision.

---

# 37. Error Handling for Auth

## 37.1 Missing/invalid token

```http
401 Unauthorized
WWW-Authenticate: Bearer
```

## 37.2 Authenticated but forbidden

```http
403 Forbidden
```

## 37.3 Hidden resource

Sometimes return 404 to avoid existence leak.

## 37.4 Problem Details

Use safe details.

Do not reveal token validation internals to public clients.

## 37.5 Rule

Security errors should be actionable but not revealing.

---

# 38. Audit Logging

Audit:

- login/auth success/failure if app handles auth;
- token validation failures aggregated;
- access denied;
- tenant denied;
- admin operation;
- impersonation;
- permission change;
- sensitive data read;
- token exchange/service call.

## 38.1 Fields

```text
actorId
tenantId
clientId
authMethod
action
resource
result
correlationId
sourceIp
```

## 38.2 Rule

Audit logs should show who did what under which identity.

---

# 39. Observability

Metrics:

```text
security.auth.failure.total{reason}
security.authorization.denied.total{operation}
security.token.validation.duration
security.jwks.refresh.total{result}
security.cross_tenant.denied.total
```

Traces:

- auth validation span if significant;
- policy decision events;
- downstream token exchange.

Logs:

- no raw token;
- include correlation ID.

## 39.1 Rule

Security systems must be observable without leaking secrets.

---

# 40. JAX-RS Implementation Sketch: Bearer Token Filter

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerAuthenticationFilter implements ContainerRequestFilter {

    @Inject TokenVerifier tokenVerifier;
    @Inject CurrentActorProvider actorProvider;

    @Override
    public void filter(ContainerRequestContext ctx) {
        String authorization = ctx.getHeaderString(HttpHeaders.AUTHORIZATION);

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new AuthenticationRequiredException();
        }

        String token = authorization.substring("Bearer ".length());

        VerifiedToken verified = tokenVerifier.verify(token);
        CurrentActor actor = CurrentActorMapper.from(verified);

        actorProvider.set(actor);
        ctx.setSecurityContext(new ActorSecurityContext(actor, ctx.getSecurityContext().isSecure()));
    }
}
```

## 40.1 Caveat

Prefer runtime-native MicroProfile JWT/OIDC integration if available and sufficient.

## 40.2 Rule

If writing custom filter, validation must be complete.

---

# 41. Implementation Sketch: CurrentActor Injection

```java
@RequestScoped
public class CurrentActorProvider {
    private CurrentActor actor;

    public void set(CurrentActor actor) {
        this.actor = actor;
    }

    public CurrentActor current() {
        if (actor == null) {
            throw new AuthenticationRequiredException();
        }
        return actor;
    }
}
```

Resource:

```java
@GET
@Path("/applications/{id}")
public ApplicationResponse get(@PathParam("id") ApplicationId id) {
    return service.get(actorProvider.current(), id);
}
```

## 41.1 Rule

Make actor access explicit and request-scoped.

---

# 42. Implementation Sketch: Authorization Policy

```java
@ApplicationScoped
public class CasePolicy {

    public void requireCanAssign(CurrentActor actor, CaseAggregate c) {
        if (!c.tenantId().equals(actor.tenantId())) {
            throw new AccessDeniedException();
        }

        if (!actor.permissions().contains(Permission.CASE_ASSIGN)) {
            throw new AccessDeniedException();
        }

        if (c.isClosed()) {
            throw new InvalidStateTransitionException("CASE_ALREADY_CLOSED");
        }
    }
}
```

## 42.1 Rule

Authorization policy combines tenant, permission, object, and state.

---

# 43. Implementation Sketch: Problem Details for Security Errors

```json
{
  "type": "https://api.example.com/problems/access-denied",
  "title": "Access denied",
  "status": 403,
  "code": "ACCESS_DENIED",
  "correlationId": "..."
}
```

## 43.1 Do not include

```text
requiredRole
tokenReason
resourceOwner
```

unless safe/internal.

## 43.2 Rule

Security error response should not help attackers enumerate permissions/resources.

---

# 44. Testing Security

Test matrix:

- no token;
- malformed token;
- expired token;
- wrong issuer;
- wrong audience;
- wrong algorithm;
- missing required claim;
- insufficient scope;
- wrong role;
- wrong tenant;
- object belongs to another tenant;
- token relay audience wrong;
- service token lacking permission.

## 44.1 Rule

Security test suite must include negative tests.

---

# 45. Threat Modeling

Ask:

```text
Can token from another app call this API?
Can tenant be spoofed?
Can gateway identity header be spoofed?
Can role access another user's object?
Can ID token be accepted as access token?
Can expired token pass due clock skew?
Can algorithm confusion occur?
Can downstream get overprivileged token?
Can logs leak Authorization?
```

## 45.1 Rule

Threat model identity flow end-to-end.

---

# 46. Common Failure Modes

## 46.1 Decode JWT without validation

Critical.

## 46.2 Ignore audience

Token confusion.

## 46.3 Use ID Token as API token

Wrong audience/purpose.

## 46.4 Role-only authorization

BOLA.

## 46.5 Tenant from body/header trusted

Spoofing.

## 46.6 Blind token relay

Overprivilege/leak.

## 46.7 Log raw token

Credential leak.

## 46.8 Gateway auth with direct backend access

Bypass.

## 46.9 JWKS cache never refreshes

Rotation outage.

## 46.10 Too detailed 401 errors

Attacker guidance.

---

# 47. Best Practices

## 47.1 Validate token fully

Signature, issuer, audience, exp, alg.

## 47.2 Map claims to CurrentActor

No raw claims deep in domain.

## 47.3 Use roles/scopes for coarse gate

Policies for object/tenant/domain.

## 47.4 Enforce tenant in repository

Not just filter.

## 47.5 Avoid blind token relay

Prefer token exchange/service token.

## 47.6 Protect identity headers

Strip/spoof-proof.

## 47.7 Audit sensitive actions

Actor/tenant/client/action/result.

## 47.8 Test negative cases

Auth and authz.

## 47.9 Use runtime standard integration

Jakarta Security/MP JWT/OIDC when available.

## 47.10 Keep secrets out of logs

Always.

---

# 48. Anti-Patterns

## 48.1 “JWT is signed, so all claims are enough”

Need audience/scope/domain validation.

## 48.2 `@RolesAllowed("admin")` everywhere

Coarse and brittle.

## 48.3 Service accepts any token from same issuer

Audience bug.

## 48.4 Trust frontend role

Never.

## 48.5 Authorization in UI only

Server must enforce.

## 48.6 Pass JWT to domain entity

Protocol leakage.

## 48.7 One super service token for everything

Overprivilege.

## 48.8 Return token validation reason to attacker

Information leak.

## 48.9 No audit for admin/cross-tenant

Compliance gap.

## 48.10 Auth library config untested

False security.

---

# 49. Production Checklist

## 49.1 Token validation

- [ ] Signature validated.
- [ ] Algorithm allowlist.
- [ ] Issuer validated.
- [ ] Audience validated.
- [ ] Expiration validated.
- [ ] Required claims validated.
- [ ] JWKS trusted and cached.
- [ ] Rotation tested.
- [ ] Raw token never logged.

## 49.2 Identity model

- [ ] Claims mapped to `CurrentActor`.
- [ ] Tenant context validated.
- [ ] Roles/scopes mapped to permissions.
- [ ] Service accounts modeled.
- [ ] Gateway identity headers protected.

## 49.3 Authorization

- [ ] Route-level method security.
- [ ] Object-level policy.
- [ ] Tenant-aware repository.
- [ ] Field-level redaction.
- [ ] Admin/cross-tenant audited.
- [ ] Hidden 404/403 policy.

## 49.4 Service-to-service

- [ ] Token relay/exchange/service token policy.
- [ ] Downstream audience correct.
- [ ] mTLS if required.
- [ ] Signed headers/tokens if gateway offload.
- [ ] Outbound auth tested.

## 49.5 Testing/observability

- [ ] Negative auth tests.
- [ ] BOLA tests.
- [ ] Security metrics.
- [ ] Audit logs.
- [ ] Problem Details safe.
- [ ] Threat model reviewed.

---

# 50. Latihan

## Latihan 1 — JWT Validation Matrix

Buat test untuk:

- expired;
- wrong `aud`;
- wrong `iss`;
- missing `tenant_id`;
- wrong algorithm;
- unknown `kid`.

## Latihan 2 — CurrentActor Mapper

Map JWT claims:

```text
sub, tenant_id, groups, scope, client_id
```

ke `CurrentActor`.

## Latihan 3 — Object Authorization

Endpoint:

```text
GET /applications/{id}
```

Test user role benar tapi tenant salah.

Expected 404/403 sesuai policy.

## Latihan 4 — Token Relay vs Exchange

Ambil 3 downstream services.

Tentukan strategi token masing-masing dan alasannya.

## Latihan 5 — Method + Domain Security

Gunakan `@RolesAllowed("officer")` lalu policy `requireCanViewCase`.

Test role benar tapi case bukan assigned officer.

## Latihan 6 — Gateway Identity Header Spoof

Simulate direct request with:

```http
X-User-ID: admin
X-Tenant-ID: tenant-a
```

Pastikan app/gateway setup tidak mempercayainya.

## Latihan 7 — Audit

Untuk admin cross-tenant access, audit:

```text
actualActor
targetTenant
action
resource
reason
correlationId
```

## Latihan 8 — Security Error Contract

Map:

- missing token → 401;
- invalid token → 401;
- insufficient scope → 403;
- cross-tenant denied → 404/403;
- wrong state → 409.

---

# 51. Referensi Resmi

Referensi utama:

1. Jakarta Security 4.0  
   https://jakarta.ee/specifications/security/4.0/

2. Jakarta Security 4.0 Specification  
   https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0

3. Jakarta RESTful Web Services 4.0  
   https://jakarta.ee/specifications/restful-ws/4.0/

4. MicroProfile JWT 2.1  
   https://microprofile.io/specifications/jwt/2-1/

5. MicroProfile JWT Authentication 2.1 Specification  
   https://download.eclipse.org/microprofile/microprofile-jwt-auth-2.1/microprofile-jwt-auth-spec-2.1.html

6. OpenID Connect Core 1.0  
   https://openid.net/specs/openid-connect-core-1_0-final.html

7. RFC 8725 — JSON Web Token Best Current Practices  
   https://www.rfc-editor.org/rfc/rfc8725.html

8. RFC 6750 — OAuth 2.0 Bearer Token Usage  
   https://www.rfc-editor.org/rfc/rfc6750.html

9. RFC 8693 — OAuth 2.0 Token Exchange  
   https://www.rfc-editor.org/rfc/rfc8693.html

---

# 52. Penutup

Security identity untuk JAX-RS API bukan “decode token lalu cek role”.

Mental model final:

```text
IdP/Auth Server
  ↓
access token
  ↓
resource server validation
  ↓
CurrentActor
  ↓
route-level security
  ↓
domain/object/tenant policy
  ↓
data access and DTO redaction
  ↓
audit + observability
```

Prinsip final:

```text
OAuth2 authorizes access.
OIDC authenticates identity.
JWT is a token format.
Access token audience matters.
Roles are coarse.
Policies enforce domain authorization.
Tenant is security boundary.
Token propagation must be intentional.
Gateway auth does not replace app authz.
```

Top-tier JAX-RS engineer memastikan:

- token validation lengkap;
- ID token tidak dipakai sebagai access token;
- claims dipetakan ke `CurrentActor`;
- `SecurityContext` dipakai di boundary;
- roles/scopes hanya coarse gate;
- object/tenant authorization selalu dilakukan;
- service-to-service token strategy jelas;
- auth errors aman;
- audit dan observability mendukung investigation;
- negative security tests menjadi bagian CI.

Part berikutnya:

```text
Bagian 051 — JAX-RS Runtime Internals and Extension Points
```

Kita akan membahas bagaimana runtime JAX-RS bekerja di dalam: bootstrap, application model, resource scanning, request matching, provider registry, injection, filters/interceptors pipeline, entity provider selection, exception mapper resolution, async internals, and extension design.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-049.md](./learn-jaxrs-advanced-part-049.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-051.md](./learn-jaxrs-advanced-part-051.md)
