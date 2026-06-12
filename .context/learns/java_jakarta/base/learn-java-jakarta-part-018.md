# learn-java-jakarta-part-018.md

# Bagian 18 — Jakarta Authentication dan Jakarta Authorization: Low-Level Security SPI

> Target pembaca: Java engineer yang sudah memahami Jakarta Security dan ingin naik satu level lebih dalam: memahami **Jakarta Authentication** dan **Jakarta Authorization** sebagai low-level SPI yang dipakai container/runtime/security provider.
>
> Fokus bagian ini: kapan perlu memahami `jakarta.security.auth.message.*` dan `jakarta.security.jacc.*`, apa bedanya dengan Jakarta Security, bagaimana authentication module berinteraksi dengan container, bagaimana policy/permission authorization model bekerja, apa yang berubah di Jakarta EE 11, dan kenapa sebagian besar aplikasi tidak perlu langsung memakai API ini kecuali membuat runtime/security integration/provider.

---

## Daftar Isi

1. [Orientasi: Kenapa Ada Layer Security Rendah?](#1-orientasi-kenapa-ada-layer-security-rendah)
2. [Mental Model: Application Security API vs Container Security SPI](#2-mental-model-application-security-api-vs-container-security-spi)
3. [Jakarta Authentication 3.1 dalam Jakarta EE 11](#3-jakarta-authentication-31-dalam-jakarta-ee-11)
4. [Jakarta Authorization 3.0 dalam Jakarta EE 11](#4-jakarta-authorization-30-dalam-jakarta-ee-11)
5. [Jakarta Security vs Jakarta Authentication vs Jakarta Authorization](#5-jakarta-security-vs-jakarta-authentication-vs-jakarta-authorization)
6. [Dependency dan Packaging](#6-dependency-dan-packaging)
7. [Bagian A — Jakarta Authentication Overview](#7-bagian-a--jakarta-authentication-overview)
8. [JASPIC/Jakarta Authentication Mental Model](#8-jaspicjakarta-authentication-mental-model)
9. [Message Layer dan Application Context](#9-message-layer-dan-application-context)
10. [`AuthConfigFactory` dan `AuthConfigProvider`](#10-authconfigfactory-dan-authconfigprovider)
11. [`ServerAuthConfig` dan `ServerAuthContext`](#11-serverauthconfig-dan-serverauthcontext)
12. [`ServerAuthModule`: Validasi Request dan Secure Response](#12-serverauthmodule-validasi-request-dan-secure-response)
13. [`MessageInfo`: Request/Response Wrapper](#13-messageinfo-requestresponse-wrapper)
14. [`CallbackHandler` dan Callback Security Identity](#14-callbackhandler-dan-callback-security-identity)
15. [`AuthStatus`: Return Value yang Mengontrol Flow](#15-authstatus-return-value-yang-mengontrol-flow)
16. [Request Flow Jakarta Authentication](#16-request-flow-jakarta-authentication)
17. [Concurrency dan State di Authentication Module](#17-concurrency-dan-state-di-authentication-module)
18. [Dynamic Registration dan Provider Configuration](#18-dynamic-registration-dan-provider-configuration)
19. [Kapan Menulis `ServerAuthModule`?](#19-kapan-menulis-serverauthmodule)
20. [Kenapa Kebanyakan Aplikasi Tidak Perlu Langsung Memakai Jakarta Authentication](#20-kenapa-kebanyakan-aplikasi-tidak-perlu-langsung-memakai-jakarta-authentication)
21. [Bagian B — Jakarta Authorization Overview](#21-bagian-b--jakarta-authorization-overview)
22. [JACC/Jakarta Authorization Mental Model](#22-jaccjakarta-authorization-mental-model)
23. [Permission-Based Authorization Model](#23-permission-based-authorization-model)
24. [`Policy`, `PolicyFactory`, dan Perubahan Jakarta Authorization 3.0](#24-policy-policyfactory-dan-perubahan-jakarta-authorization-30)
25. [`PolicyConfigurationFactory` dan `PolicyConfiguration`](#25-policyconfigurationfactory-dan-policyconfiguration)
26. [`PolicyContext` dan Context ID](#26-policycontext-dan-context-id)
27. [Container Constraints → Permissions](#27-container-constraints--permissions)
28. [Servlet Security Constraint dan Authorization Provider](#28-servlet-security-constraint-dan-authorization-provider)
29. [Role as Named Collection of Permissions](#29-role-as-named-collection-of-permissions)
30. [Kapan Menulis Authorization Provider?](#30-kapan-menulis-authorization-provider)
31. [Kenapa Kebanyakan Aplikasi Tidak Perlu Langsung Memakai Jakarta Authorization](#31-kenapa-kebanyakan-aplikasi-tidak-perlu-langsung-memakai-jakarta-authorization)
32. [Authentication vs Authorization Flow End-to-End](#32-authentication-vs-authorization-flow-end-to-end)
33. [Integration dengan Jakarta Security](#33-integration-dengan-jakarta-security)
34. [Integration dengan Servlet, EJB, CDI, dan JAX-RS](#34-integration-dengan-servlet-ejb-cdi-dan-jax-rs)
35. [Cloud-Native dan SecurityManager Removal](#35-cloud-native-dan-securitymanager-removal)
36. [Provider/Runtime Engineering Considerations](#36-providerruntime-engineering-considerations)
37. [Security Boundary untuk Application Engineer](#37-security-boundary-untuk-application-engineer)
38. [Testing Strategy](#38-testing-strategy)
39. [Observability dan Audit](#39-observability-dan-audit)
40. [Production Failure Modes](#40-production-failure-modes)
41. [Best Practices dan Anti-Patterns](#41-best-practices-dan-anti-patterns)
42. [Checklist Review](#42-checklist-review)
43. [Case Study 1: Custom Authentication Module untuk Legacy SSO](#43-case-study-1-custom-authentication-module-untuk-legacy-sso)
44. [Case Study 2: Container Authorization Provider untuk Multi-App Runtime](#44-case-study-2-container-authorization-provider-untuk-multi-app-runtime)
45. [Case Study 3: Salah Pakai Low-Level SPI untuk Business Authorization](#45-case-study-3-salah-pakai-low-level-spi-untuk-business-authorization)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Low-Level Jakarta Security SPI Lab](#47-mini-project-low-level-jakarta-security-spi-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Kenapa Ada Layer Security Rendah?

Di bagian sebelumnya, kita membahas Jakarta Security:

```java
@Inject
SecurityContext securityContext;
```

dan:

```java
@RolesAllowed("ADMIN")
```

Itu nyaman untuk application developer.

Namun container/runtime perlu mekanisme lebih rendah untuk menjawab:

- bagaimana authentication module dipasang ke container?
- bagaimana module menerima request/response raw?
- bagaimana module memberi tahu container bahwa caller sudah login?
- bagaimana container mengubah security constraints menjadi permission checks?
- bagaimana authorization provider menentukan subject boleh melakukan operation tertentu?
- bagaimana vendor bisa mengganti authentication/authorization engine tanpa mengubah application code?

Itulah ruang Jakarta Authentication dan Jakarta Authorization.

## 1.1 Dua layer rendah

Jakarta Authentication:

```text
low-level SPI for authentication mechanisms
```

Jakarta Authorization:

```text
low-level SPI for authorization modules/policy providers
```

## 1.2 Kenapa application engineer tetap perlu tahu?

Walaupun jarang menulis API ini langsung, kamu perlu mental model-nya untuk:

- debugging security container;
- memahami kenapa `@RolesAllowed` bekerja/tidak;
- memahami custom auth integration lama;
- audit security runtime;
- migrate aplikasi legacy Java EE/JASPIC/JACC;
- evaluate vendor/runtime behavior;
- desain security architecture enterprise;
- menghindari salah pakai low-level SPI untuk domain authorization.

## 1.3 Rule of thumb

Untuk aplikasi biasa:

```text
Start with Jakarta Security.
Use Servlet/JAX-RS/CDI annotations.
Use application/domain authorization policy.
```

Untuk runtime/provider/integration tingkat rendah:

```text
Understand Jakarta Authentication and Authorization.
```

---

# 2. Mental Model: Application Security API vs Container Security SPI

## 2.1 Application API

Application API adalah API yang dipakai developer aplikasi.

Contoh:

```java
@Inject
SecurityContext securityContext;
```

```java
@RolesAllowed("OFFICER")
```

```java
@OpenIdAuthenticationMechanismDefinition(...)
```

Fokus:

- express security requirement;
- access current caller;
- validate identity;
- map roles;
- protect resource.

## 2.2 Container SPI

SPI adalah kontrak untuk provider/container integration.

Contoh:

```java
ServerAuthModule
AuthConfigProvider
Policy
PolicyConfiguration
```

Fokus:

- plug custom authentication module;
- integrate with container message processing;
- transform deployment constraints to permissions;
- evaluate subject permission;
- support runtime/vendor security model.

## 2.3 Analogi

Application API:

```text
Saya butuh login OIDC dan role ADMIN.
```

Container SPI:

```text
Bagaimana request HTTP diproses, token divalidasi, principal diset ke Subject/container, dan role check dievaluasi?
```

## 2.4 Why not use SPI directly?

Karena SPI:

- low-level;
- verbose;
- container-specific integration heavy;
- easier to get wrong;
- less portable in practice unless carefully tested;
- not intended for business authorization;
- needs deep knowledge of container lifecycle.

## 2.5 Where it sits

```text
HTTP request
  ↓
Servlet container
  ↓
Jakarta Authentication SPI
  ↓
Container establishes caller identity
  ↓
Jakarta Authorization SPI / container policy
  ↓
Application-level SecurityContext / role annotations
  ↓
Application/domain policy
```

---

# 3. Jakarta Authentication 3.1 dalam Jakarta EE 11

Jakarta Authentication 3.1 adalah release untuk Jakarta EE 11.

Spesifikasi ini mendefinisikan general low-level SPI untuk authentication mechanisms. Mechanisms tersebut berinteraksi dengan caller dan environment container untuk memperoleh credential caller, memvalidasinya, dan meneruskan authenticated identity seperti name dan groups ke container.

## 3.1 Formerly JASPIC

Jakarta Authentication berasal dari JASPIC / JASPI / JSR 196.

Nama package modern:

```java
jakarta.security.auth.message
```

## 3.2 What changed in 3.1?

Jakarta Authentication 3.1 adalah update kecil untuk mendukung kebutuhan Jakarta Security dan menghapus referensi ke `SecurityManager`.

## 3.3 What does it define?

It defines:

- authentication message model;
- client/server auth module SPI;
- auth config provider;
- auth context;
- message info;
- callback mechanism;
- status codes;
- server profile integration.

## 3.4 Not a user management API

Jakarta Authentication bukan:

- user table API;
- password hashing API;
- OIDC client API;
- role policy DSL;
- domain authorization API.

It is low-level authentication SPI.

## 3.5 Why still relevant?

Karena container/runtimes dan third-party auth integrations bisa memakai Jakarta Authentication untuk memasang authentication module ke web/container message layer.

---

# 4. Jakarta Authorization 3.0 dalam Jakarta EE 11

Jakarta Authorization 3.0 adalah release untuk Jakarta EE 11.

Jakarta Authorization mendefinisikan low-level SPI untuk authorization modules, yaitu repositories of permissions yang memfasilitasi subject-based security dengan menentukan apakah subject memiliki permission tertentu, dan algoritma untuk mentransformasi security constraints dari container seperti Servlet atau Enterprise Beans menjadi permissions.

## 4.1 Formerly JACC

Jakarta Authorization berasal dari Java Authorization Contract for Containers / JACC.

Package modern:

```java
jakarta.security.jacc
```

## 4.2 What changed in 3.0?

Tujuan utama release 3.0 adalah membuat Jakarta Authorization future-proof dengan replacement untuk `Policy` lama dan penghapusan reliance pada SecurityManager.

3.0 memperkenalkan API baru seperti:

```java
jakarta.security.jacc.Policy
jakarta.security.jacc.PolicyFactory
```

untuk menggantikan ketergantungan ke `java.security.Policy`.

## 4.3 Why this matters?

Java SecurityManager sudah deprecated dan moving away dari model lama.

Jakarta Authorization harus tetap bisa menyediakan authorization contract untuk container modern/cloud deployments tanpa bergantung pada SecurityManager global.

## 4.4 Audience

Jakarta Authorization terutama relevan untuk:

- container implementors;
- security provider implementors;
- runtime vendors;
- advanced platform engineers;
- legacy JACC integration.

Bukan untuk business use case authorization biasa.

---

# 5. Jakarta Security vs Jakarta Authentication vs Jakarta Authorization

## 5.1 Jakarta Security

High-level application security API.

Use for:

- `SecurityContext`;
- HTTP authentication mechanisms at application level;
- identity stores;
- built-in OIDC/form/basic;
- password hashing;
- portable app security.

## 5.2 Jakarta Authentication

Low-level authentication SPI.

Use for:

- custom container authentication module;
- pluggable message authentication;
- `ServerAuthModule`;
- `AuthConfigProvider`;
- runtime integration.

## 5.3 Jakarta Authorization

Low-level authorization SPI.

Use for:

- container permission provider;
- transform constraints to permissions;
- subject-permission policy evaluation;
- custom container authorization module.

## 5.4 Relationship

```text
Jakarta Security:
  application-friendly abstraction

Jakarta Authentication:
  lower-level mechanism SPI below/alongside Security

Jakarta Authorization:
  lower-level permission/policy SPI used by container authorization
```

## 5.5 Practical decision

| Need | Prefer |
|---|---|
| Login user with OIDC | Jakarta Security |
| Inject current user | Jakarta Security `SecurityContext` |
| Protect method by role | `@RolesAllowed` / Jakarta Security integration |
| Validate username/password against DB | Jakarta Security Identity Store |
| Custom low-level HTTP auth module for container | Jakarta Authentication |
| Replace container policy provider | Jakarta Authorization |
| Check if officer can approve specific case | Application/domain policy |
| Tenant data filtering | Application/data layer policy |
| Enterprise IAM | External IdP/IAM + Jakarta integration |

---

# 6. Dependency dan Packaging

## 6.1 Jakarta Authentication API

Maven coordinate commonly:

```xml
<dependency>
  <groupId>jakarta.authentication</groupId>
  <artifactId>jakarta.authentication-api</artifactId>
  <version>3.1.0</version>
  <scope>provided</scope>
</dependency>
```

Some older coordinates/packages may mention `jakarta.security.auth.message`. Always align with Jakarta EE 11 runtime.

## 6.2 Jakarta Authorization API

Maven coordinate:

```xml
<dependency>
  <groupId>jakarta.authorization</groupId>
  <artifactId>jakarta.authorization-api</artifactId>
  <version>3.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 6.3 Provided scope

For Jakarta EE runtime:

```xml
<scope>provided</scope>
```

because container provides APIs.

## 6.4 API jar not implementation

Adding API jar does not install security provider.

You need runtime support/configuration.

## 6.5 Beware old namespace

Old Java EE/Jakarta EE 8 code may use:

```java
javax.security.auth.message
javax.security.jacc
```

Modern Jakarta namespace:

```java
jakarta.security.auth.message
jakarta.security.jacc
```

## 6.6 Runtime-specific setup

Low-level security SPI often requires server-specific setup:

- provider registration;
- classloader placement;
- application-level registration;
- server configuration;
- realm/security domain setup.

Always test on target runtime.

---

# 7. Bagian A — Jakarta Authentication Overview

Jakarta Authentication is about **how caller credentials become authenticated identity inside container**.

## 7.1 Message authentication

The term “message” is broader than HTTP.

But in web apps, the message is typically:

```text
HTTP request and HTTP response
```

## 7.2 Controller role

Authentication mechanisms are controllers that:

- interact with caller;
- obtain credentials;
- validate credentials;
- pass identity to container.

## 7.3 Server side

For server-side HTTP app, the key types include:

- `ServerAuthModule`;
- `ServerAuthContext`;
- `ServerAuthConfig`;
- `AuthConfigProvider`;
- `MessageInfo`;
- `CallbackHandler`;
- `AuthStatus`.

## 7.4 Low-level nature

You deal with:

- request/response objects;
- callback to container;
- subject/principal/group;
- message policies;
- auth status flow.

Jakarta Security wraps many common scenarios in higher-level API.

---

# 8. JASPIC/Jakarta Authentication Mental Model

## 8.1 Core chain

```text
Container receives request
  ↓
Container obtains auth config provider
  ↓
Provider gives server auth config
  ↓
Server auth config gives server auth context
  ↓
Server auth context invokes server auth module(s)
  ↓
Module validates request
  ↓
Module uses callback handler to set caller principal/groups
  ↓
Container continues request as authenticated or challenges/fails
```

## 8.2 Authentication module

The module is pluggable.

It can implement:

- header-based auth;
- token auth;
- custom SSO;
- legacy session integration;
- certificate mapping;
- proprietary gateway integration.

## 8.3 MessageInfo carries request/response

`MessageInfo` lets module access request and response objects in a generic way.

## 8.4 Callback establishes identity

Module does not directly mutate all container internals.

It uses callbacks to tell container:

```text
caller principal = ...
groups = ...
```

## 8.5 Status controls next step

Module returns `AuthStatus` to indicate success, failure, send continue/challenge, etc.

---

# 9. Message Layer dan Application Context

## 9.1 Message layer

Authentication can be defined per message layer.

For Servlet HTTP, message layer often corresponds to:

```text
HttpServlet
```

or similar layer identifier.

## 9.2 Application context

Application context identifies which application/context the auth config applies to.

This allows different apps to have different auth configs.

## 9.3 Why it matters

In a server with multiple deployed apps:

```text
app A uses OIDC
app B uses legacy SSO
app C uses mTLS
```

Auth config must be scoped.

## 9.4 Misconfiguration risk

If auth provider registered globally when intended per-app, it can affect unrelated apps.

## 9.5 Cloud runtime

Per-application registration is friendlier for cloud deployments where apps should not mutate global runtime policy.

---

# 10. `AuthConfigFactory` dan `AuthConfigProvider`

## 10.1 AuthConfigFactory

`AuthConfigFactory` is registry/catalog for authentication context providers.

Container can use it to get provider for message layer/application context.

## 10.2 AuthConfigProvider

`AuthConfigProvider` supplies authentication context configuration objects.

Server side:

```java
ServerAuthConfig
```

Client side:

```java
ClientAuthConfig
```

## 10.3 Provider registration

Provider can be registered:

- statically by runtime/server config;
- dynamically via API;
- application-level depending container support.

## 10.4 Why provider exists

It separates:

```text
container runtime
```

from:

```text
pluggable authentication mechanism implementation
```

## 10.5 Common bug

Provider not registered or not visible to classloader.

Symptoms:

- module never called;
- container falls back to default auth;
- all requests unauthenticated;
- class not found.

## 10.6 Runtime-specific config

Different servers expose different ways to register/configure provider.

Portable API exists, but operational config often differs.

---

# 11. `ServerAuthConfig` dan `ServerAuthContext`

## 11.1 ServerAuthConfig

Provides `ServerAuthContext` objects for server-side message processing.

It is configuration source for authentication contexts.

## 11.2 ServerAuthContext

Encapsulates module invocation sufficient to satisfy security policy for application message.

It usually coordinates one or more `ServerAuthModule`s.

## 11.3 Where it is used

At server processing points:

- validate request;
- secure response.

## 11.4 Multiple modules

A context may coordinate multiple modules.

Example:

```text
try bearer token
else try session cookie
else challenge
```

But many modern app-level cases are easier with Jakarta Security 4.0 multiple mechanism support.

## 11.5 Don't put business logic here

Auth context is authentication infrastructure.

Business access policy belongs later.

---

# 12. `ServerAuthModule`: Validasi Request dan Secure Response

`ServerAuthModule` validates client requests and secures responses to the client.

## 12.1 Key methods

Conceptual methods include:

- `initialize(...)`;
- `validateRequest(...)`;
- `secureResponse(...)`;
- `cleanSubject(...)`;
- `getSupportedMessageTypes()`.

## 12.2 `validateRequest`

Core method.

It inspects request, validates credentials, sets caller identity via callbacks, and returns auth status.

Pseudo-code:

```java
public AuthStatus validateRequest(
        MessageInfo messageInfo,
        Subject clientSubject,
        Subject serviceSubject) throws AuthException {

    HttpServletRequest request = (HttpServletRequest) messageInfo.getRequestMessage();
    String token = extractToken(request);

    if (token == null) {
        return AuthStatus.SEND_CONTINUE;
    }

    Identity identity = validateToken(token);

    callbackHandler.handle(new Callback[] {
        new CallerPrincipalCallback(clientSubject, identity.principal()),
        new GroupPrincipalCallback(clientSubject, identity.groups())
    });

    return AuthStatus.SUCCESS;
}
```

Exact constructors and callback usage should follow API version/docs.

## 12.3 `secureResponse`

Can secure response before sending.

Use cases:

- attach response token;
- sign/encrypt response;
- cleanup protocol state.

For typical bearer/header auth, may be simple.

## 12.4 `cleanSubject`

Removes principals/credentials associated with subject.

Important for logout/cleanup.

## 12.5 Public zero-argument constructor

API docs state every `ServerAuthModule` implementation must provide public zero-argument constructor.

## 12.6 Concurrency

API docs indicate module can be used concurrently by multiple callers, and module implementation is responsible for saving/restoring state if needed.

Therefore keep module stateless or thread-safe.

## 12.7 Don't store request state in fields

Bad:

```java
private HttpServletRequest currentRequest;
```

Use local variables.

---

# 13. `MessageInfo`: Request/Response Wrapper

`MessageInfo` contains request/response message objects and map properties.

## 13.1 In HTTP server

Request message:

```java
HttpServletRequest
```

Response message:

```java
HttpServletResponse
```

## 13.2 Access

Pseudo-code:

```java
HttpServletRequest request =
    (HttpServletRequest) messageInfo.getRequestMessage();

HttpServletResponse response =
    (HttpServletResponse) messageInfo.getResponseMessage();
```

## 13.3 Map properties

MessageInfo map can carry flags/properties.

Container/runtime may use properties for authentication behavior.

## 13.4 Careful mutation

If wrapping request/response, ensure container and downstream code can handle it.

## 13.5 MessageInfo vs Servlet filter

Authentication module is deeper security SPI than normal application filter.

Use Servlet filter for app-level cross-cutting concerns, not container authentication replacement unless deliberate.

---

# 14. `CallbackHandler` dan Callback Security Identity

`CallbackHandler` is how authentication module communicates identity and credential validation needs to container.

## 14.1 Common callbacks

Examples include:

- `CallerPrincipalCallback`;
- `GroupPrincipalCallback`;
- `PasswordValidationCallback`;
- certificate/key/trust callbacks.

## 14.2 CallerPrincipalCallback

Tells container who caller is.

## 14.3 GroupPrincipalCallback

Tells container caller groups.

Container may map groups to roles.

## 14.4 PasswordValidationCallback

Can ask container to validate username/password against configured realm/store.

## 14.5 Callback failure

If callback fails, authentication should fail securely.

## 14.6 Avoid leaking secret

Do not log callback credential contents.

---

# 15. `AuthStatus`: Return Value yang Mengontrol Flow

`AuthStatus` indicates result of authentication processing.

Common statuses conceptually include:

- `SUCCESS`;
- `SEND_SUCCESS`;
- `SEND_FAILURE`;
- `SEND_CONTINUE`;
- `FAILURE`.

## 15.1 SUCCESS

Authentication succeeded and processing can continue.

## 15.2 SEND_CONTINUE

Module sent challenge/redirect/continue response and request processing should not continue to protected resource yet.

Example:

- redirect to login;
- send 401 challenge.

## 15.3 SEND_FAILURE / FAILURE

Authentication failed.

## 15.4 Misusing status

Returning success without setting principal/groups can create inconsistent auth state.

Returning continue without writing response challenge can hang/confuse client.

## 15.5 HTTP semantics

Map properly:

- unauthenticated → 401/challenge or redirect;
- invalid credential → 401;
- authenticated but forbidden → later authorization 403.

Authentication module should not decide all business authorization.

---

# 16. Request Flow Jakarta Authentication

## 16.1 Unauthenticated request to protected resource

```text
request arrives
  ↓
module sees no credential
  ↓
sends challenge/redirect
  ↓
returns SEND_CONTINUE
  ↓
container stops resource invocation
```

## 16.2 Request with credential

```text
request arrives
  ↓
module extracts credential
  ↓
validates credential
  ↓
sets principal/groups with callback
  ↓
returns SUCCESS
  ↓
container invokes resource
```

## 16.3 Invalid credential

```text
request arrives
  ↓
credential invalid
  ↓
module sends unauthorized/failure
  ↓
returns failure status
```

## 16.4 Secure response

```text
resource produces response
  ↓
container calls secureResponse
  ↓
module may attach token/cleanup
  ↓
response sent
```

## 16.5 Logout/cleanup

`cleanSubject` may be used to remove identity.

## 16.6 State machine thinking

Authentication is stateful protocol even if request is stateless.

Think in states:

```text
no credential
challenge sent
credential received
authenticated
failed
logout
```

---

# 17. Concurrency dan State di Authentication Module

## 17.1 Module can be shared

`ServerAuthModule` can be used concurrently.

Therefore:

- no mutable request state fields;
- use local variables;
- immutable config;
- thread-safe caches;
- bounded caches;
- safe token validators.

## 17.2 Config state

Configuration loaded in `initialize` should be immutable or thread-safe.

```java
private volatile AuthConfig config;
```

Better:

```java
private AuthConfig config; // assigned once before use
```

depending lifecycle guarantee.

## 17.3 Caches

If caching JWKS/token introspection results:

- TTL;
- max size;
- eviction;
- refresh on key rotation;
- failure behavior;
- thread-safety.

## 17.4 Callback handler thread safety

Treat callback handler as container-provided and use per-call.

## 17.5 Avoid blocking indefinitely

Authentication path is request critical.

Set timeouts for external validation.

## 17.6 DoS concern

Authentication endpoint is exposed.

Add rate limiting/backoff at appropriate layer.

---

# 18. Dynamic Registration dan Provider Configuration

## 18.1 Dynamic registration

Jakarta Authentication supports dynamic registration of auth config providers.

This is useful for application-scoped registration.

## 18.2 Static registration

Runtime/server config can register provider globally.

## 18.3 App-level registration

Useful for cloud apps where app should carry its own auth integration.

## 18.4 Classloader issue

If provider class not visible to container at expected layer, registration fails.

## 18.5 Config source

Provider config may come from:

- deployment descriptor;
- server config;
- environment variables;
- CDI config;
- MicroProfile Config if runtime supports;
- application init.

## 18.6 Avoid secret in config files

Credentials/secrets should use secret manager/environment, not committed file.

## 18.7 Operational checklist

- provider registered?
- correct app context?
- correct message layer?
- classloader visible?
- config loaded?
- failure logged safely?
- fallback behavior secure?

---

# 19. Kapan Menulis `ServerAuthModule`?

## 19.1 Good reasons

- writing runtime/security provider;
- integrating legacy SSO protocol not supported by Jakarta Security;
- implementing proprietary gateway auth at container level;
- building vendor-neutral auth module for multiple apps;
- needing pre-Servlet container authentication behavior;
- supporting a custom message layer.

## 19.2 Bad reasons

- you just need OIDC login;
- you just need username/password database login;
- you just need role checks;
- you just need API key for one app;
- you want domain authorization;
- you want request logging.

For these, use Jakarta Security/filter/application policy.

## 19.3 Complexity warning

Authentication module bugs are severe:

- auth bypass;
- privilege escalation;
- session fixation;
- token acceptance bug;
- replay vulnerability;
- header spoofing.

Use standard mechanism if available.

## 19.4 Review requirement

Custom module should have:

- threat model;
- code review by security-aware engineer;
- negative tests;
- fuzz/malformed input tests;
- observability;
- fail-closed behavior.

---

# 20. Kenapa Kebanyakan Aplikasi Tidak Perlu Langsung Memakai Jakarta Authentication

Because Jakarta Security exists.

## 20.1 Jakarta Security wraps common use cases

- form login;
- basic login;
- OIDC;
- identity store;
- security context.

## 20.2 Less code, fewer vulnerabilities

High-level standard APIs reduce custom security code.

## 20.3 Better readability

Application engineer understands:

```java
@OpenIdAuthenticationMechanismDefinition(...)
```

more easily than a full `ServerAuthModule`.

## 20.4 Better portability

Low-level provider registration/config can be runtime-specific.

## 20.5 Start high-level

Only go low-level after proving high-level cannot meet requirement.

---

# 21. Bagian B — Jakarta Authorization Overview

Jakarta Authorization is about **how container authorization decisions are represented as permission checks**.

## 21.1 Subject-based security

A subject has principals/groups.

A policy checks whether subject has permission.

```text
Subject + Permission → allow/deny
```

## 21.2 Container constraints

Servlet/EJB constraints such as roles and method permissions can be transformed into permission objects.

## 21.3 Authorization provider

Policy provider stores/evaluates permissions.

## 21.4 Low-level nature

Most applications do not call `Policy` directly.

Container uses it.

## 21.5 Important distinction

Jakarta Authorization is not your business rules engine.

It is container authorization contract.

---

# 22. JACC/Jakarta Authorization Mental Model

## 22.1 Deployment phase

At deployment:

```text
container reads security constraints
  ↓
transforms constraints into permissions
  ↓
stores permission statements in policy configuration
  ↓
puts policy context in service
```

## 22.2 Runtime phase

At request/method invocation:

```text
container identifies subject
  ↓
container identifies requested permission
  ↓
policy provider checks subject permission
  ↓
allow or deny
```

## 22.3 Policy context

Each application/deployment has policy context.

## 22.4 Role as permission collection

Roles can be represented as named collections of permissions.

## 22.5 Why this exists

To standardize interaction between Jakarta EE containers and authorization providers.

---

# 23. Permission-Based Authorization Model

## 23.1 Permission

Permission represents an operation/resource.

Examples:

- access servlet URL/method;
- invoke EJB method;
- access web resource;
- unchecked permission;
- excluded permission.

## 23.2 Subject

Subject represents caller with principals.

## 23.3 Decision

```java
boolean allowed = policy.implies(subject, permission);
```

Exact API depends Jakarta Authorization 3.0.

## 23.4 Container maps resource to permission

For Servlet:

```text
GET /admin/users
```

can map to web resource permission.

## 23.5 Not equivalent to full RBAC

Spec historically states it is not intended to extend/modify Jakarta EE authorization model to be equivalent to standard RBAC models.

Application-specific ABAC/RBAC/domain policy remains your job.

---

# 24. `Policy`, `PolicyFactory`, dan Perubahan Jakarta Authorization 3.0

## 24.1 Old model

Historically, JACC tied to Java SE `java.security.Policy` and SecurityManager era.

## 24.2 New model in 3.0

Jakarta Authorization 3.0 adds:

```java
jakarta.security.jacc.Policy
jakarta.security.jacc.PolicyFactory
```

as replacement path for deprecated/removed Java SE security policy dependencies.

## 24.3 Per-policy-context model

Instead of one global Java `Policy`, newer model supports policy per policy context/application.

This is more suitable for cloud and multi-application environments.

## 24.4 Why important for cloud

Cloud deployments want app isolation.

Global mutable security policy is problematic.

## 24.5 Application engineer impact

Usually indirect.

But when debugging runtime authorization provider, know that Authorization 3.0 changed internal API model.

---

# 25. `PolicyConfigurationFactory` dan `PolicyConfiguration`

## 25.1 PolicyConfigurationFactory

Factory for obtaining provider-specific `PolicyConfiguration`.

## 25.2 PolicyConfiguration

Holds/manages policy statements for identified policy context.

At deployment, container uses it to add permissions.

## 25.3 Lifecycle states

Policy context lifecycle historically includes states such as:

- open;
- inService;
- deleted.

Container transitions during deployment/undeployment.

## 25.4 Thread safety

API docs mention factory retrieval may need thread safety to preserve invariant of one `PolicyConfiguration` per context.

## 25.5 Deployment-time role

Application code usually does not interact with this.

Container/deployment tool does.

## 25.6 Failure impact

If policy config fails at deployment, app security may be broken or deployment fails.

Fail closed.

---

# 26. `PolicyContext` dan Context ID

## 26.1 Policy context

Policy context identifies current application/security context.

## 26.2 Context ID

At runtime, container associates thread/request with context ID.

Policy provider uses it to find correct policy.

## 26.3 Why context ID matters

Without correct context:

- app A permissions may be applied to app B;
- authorization decision wrong;
- security isolation broken.

## 26.4 Context handlers

Policy context can expose additional objects through handlers depending container/profile.

Example historically:

- HTTP request;
- EJB arguments;
- SOAP message.

## 26.5 Cloud/multi-app concern

Per-app context is essential for multi-tenant runtime.

---

# 27. Container Constraints → Permissions

## 27.1 Servlet constraint example

```xml
<security-constraint>
  <web-resource-collection>
    <url-pattern>/admin/*</url-pattern>
    <http-method>GET</http-method>
  </web-resource-collection>
  <auth-constraint>
    <role-name>ADMIN</role-name>
  </auth-constraint>
</security-constraint>
```

Container transforms this into permission model.

## 27.2 Annotation example

```java
@ServletSecurity(@HttpConstraint(rolesAllowed = "ADMIN"))
@WebServlet("/admin/*")
public class AdminServlet extends HttpServlet {}
```

Also becomes constraints/permissions.

## 27.3 Method-level annotation

```java
@RolesAllowed("ADMIN")
```

Container/interceptor/security integration can map this to authorization decision.

## 27.4 Unchecked vs excluded

Conceptually:

- unchecked = allowed without role check;
- excluded = denied.

## 27.5 Priority of constraints

Container specification defines how constraints combine.

Do not assume.

Test.

---

# 28. Servlet Security Constraint dan Authorization Provider

## 28.1 Request arrives

```text
GET /admin/users
```

## 28.2 Authentication already done

Container knows subject/principal/groups.

## 28.3 Authorization check

Container asks policy whether subject implies permission to access resource.

## 28.4 Allow

Request proceeds.

## 28.5 Deny

Container returns 403 or appropriate failure.

## 28.6 Interaction with `@RolesAllowed`

Role-based annotations are high-level, but ultimately container must enforce access decision.

## 28.7 Not resource-instance aware

Container URL permission can say caller can access `/cases/*`.

It does not know whether caller can access case `123`.

That is application/domain policy.

---

# 29. Role as Named Collection of Permissions

## 29.1 Role in container model

Role groups permissions.

Example:

```text
ADMIN role includes permission to access /admin/*
```

## 29.2 Role mapping

External groups may map to roles.

## 29.3 Named collection

Role is not necessarily same as IdP group.

## 29.4 Application role design

Keep roles stable and application-centric:

```text
CASE_VIEWER
CASE_OFFICER
CASE_ADMIN
```

## 29.5 Permission granularity

Container permissions are often coarse:

- URL pattern;
- HTTP method;
- EJB method.

Domain permissions can be finer.

## 29.6 Avoid role explosion

Do not create roles for every business object.

Use domain policy.

---

# 30. Kapan Menulis Authorization Provider?

## 30.1 Good reasons

- building Jakarta EE runtime/container;
- integrating enterprise authorization engine at container level;
- replacing default policy provider across apps;
- auditing/evaluating container permission decisions;
- multi-application platform security provider;
- legacy JACC integration.

## 30.2 Bad reasons

- checking if officer owns case;
- checking if user can approve workflow step;
- filtering data by tenant;
- implementing feature flags;
- defining business permissions.

Those belong application/domain/security policy service.

## 30.3 Complexity

Authorization provider bugs can:

- allow unauthorized access;
- block valid users;
- break all deployed apps;
- mix app contexts;
- fail open.

## 30.4 Governance

Changing authorization provider is platform-level change.

Needs:

- threat model;
- compatibility test;
- container integration test;
- formal release process;
- audit.

---

# 31. Kenapa Kebanyakan Aplikasi Tidak Perlu Langsung Memakai Jakarta Authorization

Because application security needs are usually above container permission layer.

## 31.1 Role annotations are enough for coarse access

Use:

```java
@RolesAllowed("ADMIN")
```

## 31.2 Domain policy handles resource rules

Use application service:

```java
authorization.checkCanApprove(actor, case);
```

## 31.3 Data layer handles tenant filtering

Use repository query:

```java
findByIdAndTenantId(id, tenantId)
```

## 31.4 Authorization SPI is too low-level for business rules

Business rules need:

- resource state;
- actor assignment;
- jurisdiction;
- workflow;
- time;
- delegation;
- conflict of interest;
- domain events.

Container policy does not know all this by default.

## 31.5 Start at the right layer

If you are writing app code, do not jump to JACC.

---

# 32. Authentication vs Authorization Flow End-to-End

## 32.1 Full flow

```text
1. HTTP request arrives.
2. Authentication mechanism validates caller.
3. Container establishes principal/groups.
4. Authorization provider/container checks coarse access.
5. Servlet/JAX-RS/CDI resource invoked.
6. Application extracts actor.
7. Application/domain policy checks resource-specific permission.
8. Repository enforces tenant/data filters.
9. Audit records decision.
```

## 32.2 Failure mapping

Authentication failure:

```http
401 Unauthorized
```

Authorization coarse failure:

```http
403 Forbidden
```

Domain state conflict:

```http
409 Conflict
```

Resource hidden/not found:

```http
404 Not Found
```

## 32.3 Defense in depth

Each layer has job:

- auth module: identity proof;
- authorization provider: container-level permission;
- application policy: resource-level permission;
- database: constraints/isolation;
- audit: accountability.

## 32.4 Avoid single-layer thinking

Security failure often happens when team assumes one layer covers all.

---

# 33. Integration dengan Jakarta Security

Jakarta Security sits above and simplifies common Authentication/Authorization use cases.

## 33.1 HttpAuthenticationMechanism vs ServerAuthModule

Jakarta Security:

```java
HttpAuthenticationMechanism
```

Jakarta Authentication:

```java
ServerAuthModule
```

`HttpAuthenticationMechanism` is more application-friendly.

`ServerAuthModule` is lower-level container SPI.

## 33.2 IdentityStore vs CallbackHandler

Jakarta Security:

```java
IdentityStore
```

Jakarta Authentication:

```java
CallbackHandler` and callbacks
```

## 33.3 SecurityContext

Jakarta Security exposes:

```java
SecurityContext
```

after container establishes caller.

## 33.4 Use Jakarta Security first

If Jakarta Security can model your auth, prefer it.

## 33.5 Jakarta Security implementation may build on lower layers

Runtime may implement Jakarta Security by using Authentication/Authorization internals.

Application does not need to know unless debugging.

---

# 34. Integration dengan Servlet, EJB, CDI, dan JAX-RS

## 34.1 Servlet

Authentication modules often handle HTTP Servlet request/response messages.

Servlet security constraints map to authorization permissions.

## 34.2 EJB / Enterprise Beans

Jakarta Authorization historically covers Enterprise Beans method permissions.

Modern apps may use fewer EJBs, but legacy systems still relevant.

## 34.3 CDI

CDI provides managed beans and interceptors where role annotations can be enforced by runtime.

Security components can be CDI beans at higher Jakarta Security layer.

## 34.4 JAX-RS

JAX-RS resources often run inside Servlet/Jakarta EE container and rely on established principal/roles.

## 34.5 Important boundary

JAX-RS exception mapper may not catch authentication module/container auth failures before resource invocation.

Design error contract accordingly.

---

# 35. Cloud-Native dan SecurityManager Removal

## 35.1 SecurityManager deprecation/removal direction

Java moved away from SecurityManager.

Jakarta Authentication 3.1 removed SecurityManager references.

Jakarta Authorization 3.0 introduced new policy APIs to avoid dependency on `java.security.Policy`.

## 35.2 Why cloud cares

Cloud deployments prefer:

- per-application isolation;
- container orchestration;
- least privilege OS/container;
- no global mutable JVM policy;
- external IAM;
- sidecar/gateway integration;
- zero trust.

## 35.3 New model

Per-application policy provider and programmatic provider registration fit cloud better than JVM-global policy.

## 35.4 Application impact

For normal apps, this is mostly runtime/vendor concern.

But if you maintain platform/security integration, it is critical.

## 35.5 Migration impact

Legacy JACC/JASPIC code tied to Java SecurityManager or `java.security.Policy` may need update for Jakarta EE 11.

---

# 36. Provider/Runtime Engineering Considerations

## 36.1 Classloading

Security providers may need to be visible to container classloader.

App-level providers may live in `WEB-INF/lib`.

Server-level providers may require server lib/config.

## 36.2 Initialization order

Security provider must be registered before request handling.

## 36.3 Fail closed

If provider fails, protected resources should not become public.

## 36.4 Hot reload

Dynamic provider changes can be dangerous.

Ensure old contexts cleaned up.

## 36.5 Multi-app isolation

Provider must not leak identity/policy across apps.

## 36.6 Concurrency

Provider and modules must be thread-safe.

## 36.7 Performance

Authentication/authorization run on every protected request.

Optimize:

- token validation cache;
- JWKS cache;
- group lookup cache;
- policy decision cache with invalidation;
- avoid blocking external calls without timeout.

## 36.8 Observability

Expose safe metrics/logs:

- auth module invoked;
- success/failure;
- policy deny;
- provider latency;
- configuration errors.

## 36.9 Secrets

Do not put secrets in provider logs/config.

---

# 37. Security Boundary untuk Application Engineer

## 37.1 Use these layers

For most apps:

```text
Jakarta Security for authentication
@RolesAllowed for coarse access
Application policy for resource authorization
Repository/database for tenant/data filtering
Audit for accountability
```

## 37.2 Don't use low-level SPI for business rule

Bad:

```text
Use Jakarta Authorization provider to decide if officer can approve case 123
```

Better:

```java
caseAuthorization.checkCanApprove(actor, case);
```

## 37.3 Keep domain pure

Domain should not import:

```java
jakarta.security.*
```

Pass actor/permissions explicitly.

## 37.4 Define actor model

```java
public record Actor(
    UserId id,
    Set<Role> roles,
    TenantId tenantId,
    JurisdictionId jurisdictionId
) {}
```

## 37.5 Define policy service

```java
public final class CaseAuthorization {
    public void checkCanView(Actor actor, EnforcementCase c) { ... }
}
```

## 37.6 Test policy thoroughly

This is where most app-specific security bugs happen.

---

# 38. Testing Strategy

## 38.1 Jakarta Authentication module tests

Test:

- no credential;
- valid credential;
- invalid credential;
- malformed credential;
- expired token;
- wrong issuer/audience;
- callback failure;
- secure response;
- clean subject;
- concurrency.

## 38.2 Integration with container

Unit test alone is insufficient.

Need container-level test proving module is invoked.

## 38.3 Jakarta Authorization provider tests

Test:

- permission allowed;
- permission denied;
- role mapping;
- policy context isolation;
- deployment config;
- app undeploy cleanup;
- concurrent requests.

## 38.4 Application security tests

Even if low-level works, test app policy:

- wrong role;
- wrong tenant;
- wrong resource owner;
- state not allowed;
- cross-jurisdiction access.

## 38.5 Negative tests are mandatory

Security tests without negative cases are weak.

## 38.6 Fuzz/malformed input

For auth modules, test:

- huge headers;
- invalid base64;
- malformed JWT;
- duplicate headers;
- CRLF injection;
- unicode tricks;
- path normalization.

## 38.7 Performance tests

Auth modules and policy providers run often.

Measure latency under load.

---

# 39. Observability dan Audit

## 39.1 Authentication observability

Record:

- mechanism/module name;
- result status;
- principal if authenticated;
- failure reason category;
- latency;
- source IP;
- user agent;
- correlation ID.

Never log secret/token.

## 39.2 Authorization observability

Record:

- subject principal;
- permission;
- context ID;
- decision;
- roles;
- policy provider;
- latency;
- resource pattern;
- correlation ID.

## 39.3 Audit vs debug log

Audit is durable/security-relevant.

Debug log is operational.

Do not rely on debug log as audit record.

## 39.4 Sensitive data

Mask:

- Authorization header;
- Cookie;
- API key;
- password;
- token claims with PII if not needed.

## 39.5 Alerting

Alert on:

- authentication failure spike;
- policy provider error;
- fail-open detection;
- unusual admin access;
- cross-tenant deny spike;
- token validation failures.

---

# 40. Production Failure Modes

## 40.1 Auth module not invoked

Causes:

- provider not registered;
- wrong message layer;
- wrong app context;
- classloader issue;
- server config missing.

## 40.2 All requests denied

Causes:

- module returns failure/continue incorrectly;
- callback failure;
- policy context missing;
- role mapping broken.

## 40.3 Auth bypass

Causes:

- module returns success without validating;
- trusts spoofed header;
- fail-open on exception;
- path mismatch;
- wrong provider scope.

## 40.4 Identity leakage across requests

Cause:

- module stores principal in field;
- ThreadLocal not cleared;
- subject not cleaned.

## 40.5 Group/role missing

Cause:

- callback not setting groups;
- container role mapping missing;
- external groups not mapped.

## 40.6 Wrong policy context

Cause:

- context ID incorrect;
- global policy applied to wrong app;
- undeploy cleanup missing.

## 40.7 SecurityManager migration bug

Legacy code still assumes Java SecurityManager/`java.security.Policy`.

## 40.8 Performance collapse

Cause:

- auth module calls IdP/database every request without cache/timeout;
- policy provider slow;
- group lookup expensive.

## 40.9 Token validation stale key

Cause:

- JWKS cache not refreshed;
- key rotation not handled.

## 40.10 Secrets logged

Cause:

- debug logging request headers/callback credentials.

---

# 41. Best Practices dan Anti-Patterns

## 41.1 Best practices

- Prefer Jakarta Security for app-level security.
- Use low-level SPI only for provider/runtime integration.
- Keep authentication modules stateless/thread-safe.
- Fail closed.
- Do not trust headers unless controlled by trusted proxy.
- Use timeouts for external validation.
- Use callback handler correctly.
- Set principal and groups explicitly.
- Test with real container.
- Audit decisions safely.
- Isolate policy per application context.
- Document provider registration and classloading.
- Avoid using Authorization SPI for domain policy.

## 41.2 Anti-pattern: Custom SAM for normal OIDC login

Use Jakarta Security OIDC mechanism unless requirement proves otherwise.

## 41.3 Anti-pattern: Fail open

Bad:

```java
catch (Exception e) {
    return AuthStatus.SUCCESS;
}
```

Catastrophic.

## 41.4 Anti-pattern: Mutable module field per request

Bad in concurrent server.

## 41.5 Anti-pattern: Business authorization in JACC provider

Hard to maintain, hard to test, wrong abstraction.

## 41.6 Anti-pattern: No negative tests

Security happy-path tests are insufficient.

## 41.7 Anti-pattern: Logging tokens

Never log Authorization/Cookie raw.

---

# 42. Checklist Review

## 42.1 Jakarta Authentication

- [ ] Is low-level SPI actually needed?
- [ ] Could Jakarta Security solve it?
- [ ] Provider registered correctly?
- [ ] Message layer correct?
- [ ] App context correct?
- [ ] Module stateless/thread-safe?
- [ ] Public zero-arg constructor?
- [ ] Timeouts configured?
- [ ] Callback sets principal/groups?
- [ ] AuthStatus correct?
- [ ] Fail closed?
- [ ] Secrets not logged?
- [ ] Container integration tested?

## 42.2 Jakarta Authorization

- [ ] Is custom provider actually needed?
- [ ] Could role/app policy solve it?
- [ ] Policy context isolated?
- [ ] Policy configuration lifecycle correct?
- [ ] Deployment constraints transformed correctly?
- [ ] Permission decisions tested?
- [ ] Concurrent access safe?
- [ ] Undeploy cleanup?
- [ ] Java SecurityManager dependency removed?
- [ ] Fail closed?

## 42.3 Application security

- [ ] Authentication distinct from authorization?
- [ ] Role check distinct from domain policy?
- [ ] Tenant/resource filtering enforced?
- [ ] Audit decisions recorded?
- [ ] Negative tests in CI?

---

# 43. Case Study 1: Custom Authentication Module untuk Legacy SSO

## 43.1 Context

Legacy enterprise SSO sends signed header from trusted gateway:

```http
X-SSO-User: fajar
X-SSO-Groups: officer,reviewer
X-SSO-Signature: ...
```

## 43.2 Wrong approach

App filter trusts headers directly.

Risk:

- external spoofing;
- proxy misconfig;
- no container principal;
- role annotations don't work.

## 43.3 Low-level approach

Use `ServerAuthModule` if gateway integration must happen at container auth layer.

Module:

- verifies request comes from trusted gateway;
- verifies signature;
- validates timestamp/nonce;
- maps groups;
- calls callbacks for principal/groups;
- fails closed.

## 43.4 Better if possible

Use OIDC/SAML standard instead of proprietary headers.

## 43.5 Tests

- spoofed header external;
- invalid signature;
- replay;
- expired timestamp;
- missing groups;
- gateway IP mismatch;
- valid request.

---

# 44. Case Study 2: Container Authorization Provider untuk Multi-App Runtime

## 44.1 Context

Organization has custom central policy provider for many Jakarta apps.

Need container-level authorization decisions logged centrally.

## 44.2 Jakarta Authorization role

Implement policy provider that receives subject/permission.

## 44.3 Key concern

Policy context isolation.

App A policy must not affect app B.

## 44.4 Audit

Record:

- app context;
- subject;
- permission;
- decision;
- role mapping;
- correlation ID.

## 44.5 Risk

If provider unavailable, do not allow protected access by default.

## 44.6 Governance

This is platform change, not app feature.

---

# 45. Case Study 3: Salah Pakai Low-Level SPI untuk Business Authorization

## 45.1 Problem

Team wants to decide:

```text
Can officer approve case 123?
```

inside Jakarta Authorization provider.

## 45.2 Why bad?

Provider needs business data:

- case assignment;
- status;
- jurisdiction;
- conflict of interest;
- deadline.

This creates:

- DB calls in container policy;
- coupling provider to business schema;
- hard tests;
- performance risk;
- cross-app complexity.

## 45.3 Better design

Use:

```java
@RolesAllowed("OFFICER")
public ApproveResult approve(...) {
    Actor actor = actors.current();
    Case c = cases.get(...);
    authorization.checkCanApprove(actor, c);
    ...
}
```

## 45.4 Lesson

Container authorization is coarse. Domain authorization belongs in application/domain.

---

# 46. Latihan Bertahap

## Latihan 1 — Security layer mapping

Draw flow:

```text
Jakarta Security
Jakarta Authentication
Jakarta Authorization
Servlet Security
Application Policy
```

Explain each responsibility.

## Latihan 2 — AuthStatus state machine

For a Basic-like module, define return status for:

- no header;
- invalid header;
- valid header;
- internal error.

## Latihan 3 — Thread-safety review

Given a `ServerAuthModule` with mutable fields, identify bugs.

## Latihan 4 — Header spoofing threat model

Design trusted gateway header auth.

List requirements to make it safe.

## Latihan 5 — Role vs domain policy

Write example where `@RolesAllowed("OFFICER")` is insufficient.

## Latihan 6 — Policy context

Explain why per-app policy context is needed in server with 10 apps.

## Latihan 7 — Migration

Identify old `javax.security.auth.message` / `javax.security.jacc` imports and migrate to `jakarta.*`.

## Latihan 8 — Negative auth tests

Write test cases for malformed JWT/API key/header.

## Latihan 9 — Observability

Define metrics/log fields for auth module and authorization provider.

## Latihan 10 — Choose layer

For 10 requirements, decide whether to implement with Jakarta Security, Authentication SPI, Authorization SPI, or application policy.

---

# 47. Mini Project: Low-Level Jakarta Security SPI Lab

## 47.1 Goal

Create:

```text
jakarta-low-level-security-spi-lab/
```

## 47.2 Modules

```text
security-layer-map/
mock-server-auth-module/
auth-status-flow/
callback-principal-groups/
policy-context-demo/
permission-decision-demo/
app-policy-comparison/
negative-tests/
observability/
```

## 47.3 Deliverables

```text
README.md
AUTHENTICATION-SPI.md
AUTHORIZATION-SPI.md
SECURITY-LAYERING.md
SERVER-AUTH-MODULE.md
POLICY-PROVIDER.md
APP-DOMAIN-POLICY.md
THREAT-MODEL.md
FAILURE-MODES.md
TEST-PLAN.md
```

## 47.4 Required experiments

1. Implement mock auth module conceptually.
2. Validate principal/group callback flow.
3. Simulate auth statuses.
4. Demonstrate stateless module.
5. Simulate policy context per app.
6. Show role permission decision.
7. Compare domain authorization outside provider.
8. Add negative tests.
9. Add audit logs.
10. Document why Jakarta Security is preferred for app-level use.

## 47.5 Evaluation questions

1. What does Jakarta Authentication define?
2. What does Jakarta Authorization define?
3. What is `ServerAuthModule`?
4. Why must auth modules be thread-safe?
5. What is `AuthConfigProvider`?
6. What is `PolicyConfiguration`?
7. Why did Authorization 3.0 add new `Policy` APIs?
8. Why is `@RolesAllowed` not domain authorization?
9. When is low-level SPI justified?
10. Why should most apps start with Jakarta Security?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta Authentication 3.1  
   https://jakarta.ee/specifications/authentication/3.1/

2. Jakarta Authentication 3.1 Specification  
   https://jakarta.ee/specifications/authentication/3.1/jakarta-authentication-spec-3.1

3. Jakarta Authentication API — `ServerAuthModule`  
   https://jakarta.ee/specifications/authentication/2.0/apidocs/jakarta/security/auth/message/module/serverauthmodule

4. Jakarta Authorization 3.0  
   https://jakarta.ee/specifications/authorization/3.0/

5. Jakarta Authorization 3.0 Specification  
   https://jakarta.ee/specifications/authorization/3.0/jakarta-authorization-spec-3.0

6. Jakarta Authorization API — `PolicyConfigurationFactory`  
   https://jakarta.ee/specifications/authorization/3.0/apidocs/jakarta.security.jacc/jakarta/security/jacc/policyconfigurationfactory

7. Jakarta Security 4.0  
   https://jakarta.ee/specifications/security/4.0/

8. Jakarta Security, Jakarta Authorization, and Jakarta Authentication Explained  
   https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/

9. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

10. Jakarta EE 11 Release  
    https://jakarta.ee/release/11/

---

# Penutup

Jakarta Authentication dan Jakarta Authorization adalah layer security rendah.

Mental model ringkas:

```text
Jakarta Authentication:
  how credentials become authenticated identity in the container

Jakarta Authorization:
  how container constraints become permission checks against a subject

Jakarta Security:
  application-friendly API above common authentication/security needs

Application/domain policy:
  resource-specific business authorization
```

Untuk kebanyakan aplikasi, jangan mulai dari `ServerAuthModule` atau custom `Policy`.

Mulai dari:

```text
Jakarta Security
OIDC/Form/Basic mechanisms
IdentityStore
SecurityContext
@RolesAllowed
application authorization service
tenant-aware repository
audit
```

Gunakan low-level SPI ketika kamu benar-benar membangun:

- container integration;
- custom auth provider;
- legacy SSO bridge;
- platform authorization provider;
- vendor/runtime extension.

Engineer top-tier tahu perbedaan antara **authenticating a caller**, **checking a container permission**, dan **deciding a business action on a specific resource**. Salah menaruh logic di layer yang salah adalah sumber banyak security bug enterprise.

Bagian berikutnya akan membahas **Jakarta Messaging (`jakarta.jms`)**: queue/topic, producer/consumer, durable subscription, transaction, acknowledgment, redelivery, DLQ, ordering, idempotency, and event-driven reliability.
