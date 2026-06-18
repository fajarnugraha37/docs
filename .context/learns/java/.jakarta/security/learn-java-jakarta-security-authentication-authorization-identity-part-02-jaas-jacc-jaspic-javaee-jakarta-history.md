# Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-02-jaas-jacc-jaspic-javaee-jakarta-history.md`  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Tujuan Part Ini

Part ini menjawab pertanyaan besar:

> Kenapa security di dunia Java/Jakarta enterprise terasa seperti punya banyak nama dan layer: JAAS, JASPIC, JACC, Java EE Security, Jakarta Security, Servlet Security, EJB Security, container realm, identity store, policy provider, dan framework security?

Tujuan kita bukan nostalgia sejarah. Tujuannya adalah membangun **mental model debugging dan architecture review**.

Engineer yang hanya hafal API modern biasanya akan bingung ketika:

- `@RolesAllowed` tidak jalan walaupun user sudah login.
- `SecurityContext#getCallerPrincipal()` ada, tetapi `HttpServletRequest#getUserPrincipal()` null, atau sebaliknya.
- user berhasil authenticate tetapi tidak punya role di container.
- custom filter membuat principal sendiri tetapi container tidak mengenal role-nya.
- aplikasi pindah dari Java EE 8 ke Jakarta EE 10/11 lalu security annotation, package, atau provider behavior berubah.
- aplikasi menggunakan Keycloak/OIDC tetapi masih ada legacy JAAS realm di app server.
- JAX-RS endpoint secured, tetapi method security di CDI/EJB tidak konsisten.
- token JWT valid secara cryptographic tetapi gagal menjadi caller identity di container.
- authorization terlihat benar di service layer tetapi URL constraint masih membocorkan endpoint.

Part ini akan memetakan sejarah sebagai **lapisan kontrak**:

```text
Java SE identity/auth foundation
        ↓
JAAS: Subject, Principal, LoginModule, CallbackHandler
        ↓
Java EE container security: web.xml, @RolesAllowed, realm, role mapping
        ↓
JACC / Jakarta Authorization: container authorization SPI, permission model
        ↓
JASPIC / Jakarta Authentication: portable pluggable authentication SPI
        ↓
Java EE 8 Security API / Jakarta Security: developer-facing API
        ↓
Modern integration: OIDC, JWT, external IdP, MicroProfile, Spring Security, gateway
```

Agar tidak mengulang materi security umum sebelumnya, kita tidak akan membahas kriptografi dasar, TLS dasar, hashing dasar, atau OWASP checklist umum kecuali saat diperlukan untuk memahami kontrak Jakarta security.

---

## 1. Kenapa Sejarah Ini Penting?

Security API enterprise Java tidak lahir sebagai satu framework yang bersih dari awal. Ia tumbuh dari beberapa kebutuhan berbeda:

1. **Java SE butuh konsep subject-based security.**  
   Ini melahirkan JAAS: `Subject`, `Principal`, `LoginContext`, `LoginModule`, dan callback.

2. **Application server butuh cara standar men-secure aplikasi web dan enterprise component.**  
   Ini melahirkan declarative security: `web.xml`, servlet security constraint, EJB security annotation, role mapping, realm.

3. **Vendor app server butuh plug-in authorization provider.**  
   Ini melahirkan JACC, sekarang Jakarta Authorization.

4. **Vendor app server butuh plug-in authentication provider yang portable.**  
   Ini melahirkan JASPIC, sekarang Jakarta Authentication.

5. **Developer butuh API yang lebih mudah dipakai tanpa harus implement SPI low-level.**  
   Ini melahirkan Java EE Security API di Java EE 8, lalu Jakarta Security.

Masalahnya, semua layer ini masih meninggalkan jejak. Bahkan ketika Anda memakai Jakarta Security modern, container di bawahnya masih harus:

- menetapkan caller principal,
- mengisi group/role,
- membuat security context,
- menerjemahkan annotation menjadi policy,
- mengeksekusi authorization decision,
- mempertahankan session identity,
- menghubungkan Servlet/JAX-RS/CDI/EJB security.

Jadi sejarah ini bukan sekadar “legacy”. Ia menjelaskan **kenapa runtime berperilaku seperti itu**.

---

## 2. Peta Besar: Ada Dua Sumbu yang Sering Tercampur

Untuk memahami semua istilah historis ini, gunakan dua sumbu.

### 2.1 Sumbu Pertama: Authentication vs Authorization

```text
Authentication
= membuktikan siapa caller.

Authorization
= menentukan apakah caller boleh melakukan action tertentu terhadap resource tertentu.
```

Di Java/Jakarta enterprise:

```text
Authentication output:
- caller principal
- group principal / role source
- authenticated subject
- session / token-derived identity

Authorization input:
- caller identity
- groups / roles / claims
- requested resource
- requested method/action
- deployment descriptor / annotation / policy
- application domain rules
```

### 2.2 Sumbu Kedua: Application-Facing API vs Container SPI

```text
Application-facing API
= API yang dipakai developer aplikasi sehari-hari.

Container SPI
= kontrak low-level yang dipakai provider/container/framework untuk plug into runtime.
```

Contoh application-facing:

```java
@Inject
SecurityContext securityContext;

boolean allowed = securityContext.isCallerInRole("ADMIN");
```

Contoh container SPI:

```java
public class MyServerAuthModule implements ServerAuthModule {
    // validate incoming message and tell container who the caller is
}
```

Kekacauan sering terjadi saat developer memakai SPI sebagai application API, atau memakai application API tetapi berharap mengontrol behavior low-level container.

---

## 3. Timeline Konseptual

Timeline sederhananya:

```text
Java SE 1.4+
  JAAS becomes part of Java SE security model

J2EE / Java EE era
  Servlet and EJB declarative security mature
  App server realm and role mapping become core operational model

JACC era
  Standard contract for authorization provider in containers

JASPIC era
  Standard contract for pluggable authentication modules

Java EE 8
  Security API introduced to simplify authentication mechanisms,
  identity stores, and SecurityContext for app developers

Jakarta EE 8/9+
  Transition from javax.* to jakarta.* namespace

Jakarta EE 10/11
  Jakarta Security, Authentication, Authorization continue evolving;
  OIDC and modern identity concerns become more explicit
```

The important learning: modern Jakarta Security is not a replacement for every old layer. It is a friendlier surface over a runtime that still has container security semantics.

---

## 4. Layer 1 — JAAS: The Java SE Subject-Based Foundation

### 4.1 What JAAS Is

JAAS means **Java Authentication and Authorization Service**.

At its core, JAAS gives Java a way to talk about:

- a subject being authenticated,
- principals associated with that subject,
- public/private credentials,
- pluggable login modules,
- callback handlers for obtaining credentials,
- subject-based authorization.

Official Java documentation describes JAAS as usable for authentication of users and authorization of users, with `LoginContext` providing a way to authenticate subjects independent of the underlying authentication technology.

### 4.2 Core JAAS Objects

```text
Subject
  Represents an entity being authenticated or authorized.

Principal
  Represents an identity name attached to a Subject.

Credential
  Represents proof or material associated with identity.

LoginContext
  Coordinates login using configured LoginModule(s).

LoginModule
  Performs actual authentication logic.

CallbackHandler
  Supplies credentials or interaction data to LoginModule.

Configuration
  Tells LoginContext which LoginModule(s) apply.
```

### 4.3 Minimal Flow

```text
Application creates LoginContext
        ↓
LoginContext reads JAAS Configuration
        ↓
LoginContext creates LoginModule(s)
        ↓
LoginModule asks CallbackHandler for credential input
        ↓
LoginModule validates credential
        ↓
LoginModule commits Principal/Credential into Subject
        ↓
Application/container uses Subject
```

Pseudo-code:

```java
LoginContext context = new LoginContext("myRealm", callbackHandler);
context.login();

Subject subject = context.getSubject();
Set<Principal> principals = subject.getPrincipals();
```

### 4.4 JAAS LoginModule Lifecycle

A `LoginModule` roughly follows this lifecycle:

```text
initialize(...)
        ↓
login()
        ↓
commit() if login succeeds
        ↓
abort() if overall login fails
        ↓
logout() when subject logs out
```

The important point: authentication may involve multiple modules.

Example:

```text
LoginModule A: validate password
LoginModule B: load groups from LDAP
LoginModule C: load enterprise attributes
```

JAAS was designed around pluggability and composition, not web login UX.

### 4.5 JAAS Strengths

JAAS is powerful when you need:

- low-level authentication abstraction,
- integration with operating system identities,
- legacy app server realms,
- subject/principal modelling,
- non-web Java processes,
- custom login module chains,
- old enterprise integration.

### 4.6 JAAS Weaknesses in Web Applications

JAAS does not naturally model modern web concerns:

- redirects,
- browser sessions,
- CSRF,
- OAuth/OIDC flows,
- token refresh,
- SameSite cookies,
- API `401` challenge semantics,
- SPA login lifecycle,
- multi-tenant claim mapping,
- identity federation.

JAAS can be part of a solution, but it is rarely the most ergonomic top-level API for modern Jakarta web apps.

### 4.7 Mental Model

JAAS answers:

```text
How can Java represent and authenticate a subject in a pluggable way?
```

JAAS does **not** fully answer:

```text
How should a Jakarta Servlet container challenge a browser, establish web identity,
map groups to roles, protect URLs, integrate with JAX-RS, and handle OIDC logout?
```

That is why higher-level container security exists.

---

## 5. Layer 2 — Java EE Container Security

### 5.1 What Container Security Means

In Java EE/Jakarta EE, the application server is not just a library host. It is an enforcement environment.

The container can enforce security before your business code runs.

For web applications:

```text
HTTP request
  ↓
web container
  ↓
authentication mechanism
  ↓
security constraint check
  ↓
servlet/filter/JAX-RS dispatch
```

For enterprise components:

```text
method invocation
  ↓
container proxy/interceptor
  ↓
role/method permission check
  ↓
business method
```

### 5.2 Declarative Security

Declarative security means you declare security metadata outside business logic:

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
</security-constraint>
```

or via annotations:

```java
@RolesAllowed("ADMIN")
public void approve() {
    // business logic
}
```

Declarative security gives you a container-enforced boundary.

### 5.3 Container Realm

A container realm is a configured identity source understood by the app server.

Examples:

```text
file realm
LDAP realm
database realm
certificate realm
custom realm
OIDC-integrated realm
```

A realm usually answers:

```text
Given a credential, who is this caller?
What groups does this caller belong to?
```

But each app server historically implemented realms differently.

### 5.4 Role Mapping

A very important Java EE/Jakarta EE idea:

```text
Application role != identity provider group necessarily.
```

Application declares roles:

```java
@DeclareRoles({"ADMIN", "OFFICER", "APPROVER"})
```

Container maps external groups to application roles:

```text
LDAP group cn=aceas-prod-approver
        ↓
container/app mapping
        ↓
application role APPROVER
```

This indirection is intentional. It lets the application keep stable role names even if identity infrastructure changes.

### 5.5 Why Container Security Became Hard

Container security solved an important problem but created portability friction:

- different app servers configured realms differently,
- role mapping differed by vendor,
- authentication modules were not always portable,
- authorization policy integration was vendor-specific,
- developers lacked a simple API for custom identity stores.

This led to standard SPIs: JACC and JASPIC.

---

## 6. Layer 3 — JACC / Jakarta Authorization

### 6.1 What JACC Was Trying to Solve

JACC means **Java Authorization Contract for Containers**. In Jakarta, the equivalent specification is **Jakarta Authorization**.

Its goal: define a standard contract between a container and an authorization provider.

Instead of every app server having completely proprietary authorization internals, JACC defines how container security metadata can be translated into permissions and evaluated by a provider.

Jakarta Authorization 3.0 is the Jakarta EE 11 release line and defines the authorization provider contract around policy configuration, policy context, subjects, and permissions.

### 6.2 Key Idea: Container Metadata Becomes Permissions

Application code declares something like:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(String caseId) { }
```

The container transforms deployment metadata into permission rules.

For web:

```text
URL pattern + HTTP method + role constraint
        ↓
WebResourcePermission / WebUserDataPermission-like model
```

For enterprise method calls:

```text
EJB method + role constraint
        ↓
EJBMethodPermission-like model
```

The policy provider evaluates whether the current subject has the needed permission.

### 6.3 Core JACC/Jakarta Authorization Concepts

```text
Policy provider
  Performs authorization decisions.

Policy configuration
  Stores deployment-time authorization metadata.

Policy context
  Identifies which application/module policy applies.

Permission
  Represents access requirement.

Subject
  Represents caller identity and principals.
```

### 6.4 Why This Exists

Without JACC/Jakarta Authorization, a container vendor can enforce security however it wants internally. That works, but enterprise customers sometimes need:

- centralized policy provider,
- externalized authorization engine,
- auditable policy management,
- consistent authorization behavior across modules,
- standard integration point.

### 6.5 Why Most App Developers Rarely Touch It

Most developers use:

```java
@RolesAllowed("ADMIN")
```

not:

```java
PolicyConfigurationFactory factory = PolicyConfigurationFactory.getPolicyConfigurationFactory();
```

Jakarta Authorization is mostly provider/container-level. You study it not because you will implement it every day, but because it explains how container authorization metadata becomes actual decisions.

### 6.6 Mental Model

Jakarta Authorization answers:

```text
How does the container delegate authorization decisions to a standard policy provider?
```

It does **not** primarily answer:

```text
How do I write normal business-level authorization code?
```

For business-level authorization, you usually need application policy logic on top of container authorization.

### 6.7 Where It Still Matters

It matters when:

- you run full Jakarta EE servers,
- you need container-level method and URL authorization,
- you integrate external policy providers,
- you debug why role checks behave differently across modules,
- you migrate from Java EE to Jakarta EE,
- you work in regulated enterprise systems where authorization must be explainable.

---

## 7. Layer 4 — JASPIC / Jakarta Authentication

### 7.1 What JASPIC Was Trying to Solve

JASPIC means **Java Authentication SPI for Containers**. In Jakarta, it is **Jakarta Authentication**.

Its goal: define a portable way to plug authentication mechanisms into containers.

Jakarta Authentication defines low-level SPIs for authentication mechanisms that interact with a caller and the container environment to obtain credentials, validate them, and pass authenticated identity such as name and groups to the container.

### 7.2 Authentication Mechanism as Controller

Think of an authentication mechanism as a controller between caller and container:

```text
caller/browser/client
        ↓
request/message
        ↓
authentication mechanism
        ↓
credential extraction
        ↓
credential validation
        ↓
principal/group established
        ↓
container security context
```

### 7.3 ServerAuthModule

A `ServerAuthModule` is the central low-level component.

Its job includes:

- inspecting request/message,
- extracting credential,
- challenging caller if needed,
- validating credential,
- informing container of caller principal,
- informing container of group principals,
- cleaning up subject on logout/request end.

Pseudo-shape:

```java
public class MyServerAuthModule implements ServerAuthModule {
    @Override
    public AuthStatus validateRequest(
            MessageInfo messageInfo,
            Subject clientSubject,
            Subject serviceSubject) {
        // inspect request
        // validate credential
        // add caller principal and groups via callbacks
        return AuthStatus.SUCCESS;
    }
}
```

### 7.4 Callback-Based Identity Establishment

A low-level auth module does not usually mutate arbitrary container internals directly. It communicates via callbacks.

Important conceptual callbacks:

```text
CallerPrincipalCallback
  Tells runtime the authenticated caller principal.

GroupPrincipalCallback
  Tells runtime the caller's groups.

PasswordValidationCallback
  Asks runtime/realm to validate username/password.

CertStoreCallback / TrustStoreCallback-like concerns
  Support certificate-related validation in some profiles/providers.
```

The key idea:

```text
Authentication mechanism validates identity,
then tells container: “this is the caller; these are the groups.”
```

### 7.5 JASPIC/Jakarta Authentication Is Not Merely “Login Code”

It is lower-level than typical application login.

It must handle:

- whether request proceeds,
- whether response challenge is sent,
- whether authentication failed,
- whether authentication is not applicable,
- how container subject is populated,
- how message/request lifecycle continues.

### 7.6 Why It Was Hard for Normal Developers

JASPIC is powerful but verbose. Common challenges:

- difficult lifecycle,
- app server configuration complexity,
- inconsistent vendor support historically,
- callback semantics not intuitive,
- not aligned with modern OIDC developer ergonomics,
- low-level request/response message handling.

This is one reason Java EE 8 introduced Security API as a simpler layer.

### 7.7 Mental Model

Jakarta Authentication answers:

```text
How can a container use a pluggable authentication module to establish caller identity?
```

It does **not** primarily answer:

```text
How do I conveniently define a database identity store or inject SecurityContext in app code?
```

That is the role of Jakarta Security.

---

## 8. Layer 5 — Java EE 8 Security API / Jakarta Security

### 8.1 Why Java EE Security API Was Introduced

Before Java EE 8, developers had to rely heavily on:

- vendor-specific realm configuration,
- servlet container auth mechanisms,
- JASPIC modules,
- JAAS login modules,
- app-specific filters,
- framework-specific security.

This created portability and usability issues.

Java EE 8 introduced a Security API to provide a more developer-friendly, portable model around:

```text
HTTP Authentication Mechanism
Identity Store
SecurityContext
```

Jakarta Security continues this model under `jakarta.security.enterprise.*`.

### 8.2 Three Core Pieces

```text
HttpAuthenticationMechanism
  Application-facing way to define HTTP authentication behavior.

IdentityStore
  Application-facing way to validate credentials and retrieve groups.

SecurityContext
  Injectable access point for programmatic security in app code.
```

### 8.3 HttpAuthenticationMechanism

This is a higher-level authentication mechanism compared to raw JASPIC.

Example conceptual flow:

```java
@ApplicationScoped
public class MyAuthMechanism implements HttpAuthenticationMechanism {
    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) {
        // extract credential
        // validate via IdentityStoreHandler
        // notify container using context.notifyContainerAboutLogin(...)
    }
}
```

Important: the mechanism is visible through CDI and integrates with the Jakarta EE container.

### 8.4 IdentityStore

An `IdentityStore` validates credentials and/or supplies groups.

Example:

```java
@ApplicationScoped
public class DatabaseIdentityStore implements IdentityStore {
    @Override
    public CredentialValidationResult validate(Credential credential) {
        // validate username/password/token/etc.
        // return caller principal and groups
    }
}
```

This is much more application-friendly than writing full JASPIC modules.

### 8.5 SecurityContext

`SecurityContext` gives application code a portable way to ask:

```text
Who is the caller?
Is the caller in this role?
Is the caller authenticated?
Can I trigger authentication?
```

Example:

```java
@Inject
SecurityContext securityContext;

public void approve() {
    Principal caller = securityContext.getCallerPrincipal();

    if (!securityContext.isCallerInRole("APPROVER")) {
        throw new ForbiddenException();
    }
}
```

### 8.6 Jakarta Security Does Not Remove Container Security

This is critical.

Jakarta Security is not “security outside the container”. It is a developer-facing way to participate in container security.

If you authenticate a user but never notify the container, then:

```text
your app may think user is logged in,
but container role checks may still fail.
```

That is a common failure when developers build custom filters manually.

### 8.7 Jakarta Security 3/4 Direction

Modern Jakarta Security added stronger support for modern authentication concerns, including OIDC support in Jakarta Security 3.0 and enhancements in Jakarta Security 4.0 such as multiple authentication mechanisms, qualifiers for built-in mechanisms, and an in-memory identity store in the Jakarta EE 11 line.

The practical implication: Jakarta Security is moving closer to modern identity provider integration, but the underlying principles remain the same:

```text
credential/input → authentication mechanism → identity store/provider → container identity → roles/groups → authorization
```

---

## 9. How the Layers Relate in One Request

Imagine a browser request to `/admin/cases/123/approve`.

```text
1. HTTP request enters web container
        ↓
2. Container checks whether authentication is required
        ↓
3. Jakarta Security HttpAuthenticationMechanism or built-in mechanism runs
        ↓
4. Mechanism validates credential using IdentityStore or external IdP
        ↓
5. Mechanism tells container caller principal and groups
        ↓
6. Container establishes security context/session
        ↓
7. Container checks URL constraint or method constraint
        ↓
8. JAX-RS/CDI/EJB target is invoked
        ↓
9. Application may perform domain-level authorization
        ↓
10. Audit event records actor/action/resource/result
```

Behind the scenes, depending on the server:

```text
Jakarta Security may delegate to Jakarta Authentication-like mechanisms,
container may translate annotations to Jakarta Authorization/JACC permissions,
legacy JAAS realms may still be used to validate users or groups.
```

A top engineer knows which layer is responsible for which decision.

---

## 10. Key Distinction: Authentication Result vs Authorization Decision

Authentication result:

```text
caller = fajar
principals = [UserPrincipal("fajar"), GroupPrincipal("case-approver")]
session = established
```

Authorization decision:

```text
Can caller fajar approve case 123?
```

That second question may require more than container role check:

```text
role = CASE_APPROVER
case.status = PENDING_APPROVAL
case.assignedTeam = caller.team
caller != case.creator
tenant = caller.activeTenant
currentTime inside approval window
no conflict of interest
```

Container security can answer coarse-grained access:

```text
Can this caller enter the approve endpoint?
```

Domain authorization answers fine-grained access:

```text
Can this caller approve this specific case in this specific state?
```

Do not force Jakarta container roles to carry all business authorization semantics. That creates role explosion and brittle systems.

---

## 11. Why `javax.*` vs `jakarta.*` Matters Historically

### 11.1 Namespace Split

Java EE APIs historically used `javax.*` packages.

Jakarta EE 9 introduced the large namespace transition to `jakarta.*`.

Examples:

```text
javax.servlet.*              → jakarta.servlet.*
javax.annotation.security.*  → jakarta.annotation.security.*
javax.security.enterprise.*  → jakarta.security.enterprise.*
javax.security.auth.message.*→ jakarta.security.auth.message.*
javax.security.jacc.*        → jakarta.security.jacc.*
```

Note: JAAS core Java SE packages remain under `javax.security.auth.*` because they are Java SE APIs, not Jakarta EE APIs.

This creates an important asymmetry:

```text
JAAS Subject / Principal integration may still use javax.security.auth.Subject
while Jakarta EE APIs move to jakarta.* packages.
```

### 11.2 Migration Mental Model

Migration is not just search-and-replace.

You must evaluate:

```text
API package
container version
third-party libraries
app server support
security provider support
OIDC/JWT integration
annotation processing
deployment descriptors
role mapping files
test framework compatibility
```

### 11.3 Common Migration Failure

```text
Application compiles after package rename
but security behavior changes because container runtime and provider are not aligned.
```

Example failure:

```text
- code uses jakarta.annotation.security.RolesAllowed
- runtime only supports older javax annotation path
- annotation not recognized as method security metadata
- endpoint accidentally becomes unprotected or always denied
```

This is why migration must include negative security tests.

---

## 12. Java 8 to Java 25 Compatibility Perspective

### 12.1 Java Version Does Not Equal Jakarta EE Version

Do not confuse:

```text
Java SE version
with
Jakarta EE platform version
with
application server version
```

Example:

```text
You can run Java 17 or 21 JVM,
but your app server may only support a certain Jakarta EE level.
```

### 12.2 Java 8 Era

Typical combination:

```text
Java 8
Java EE 7/8
javax.* namespace
JAAS/JASPIC/JACC names
Servlet 3.x/4.x
older app server security realm model
```

### 12.3 Java 11/17 Era

Typical shifts:

```text
modular JDK concerns
newer TLS defaults
Jakarta transition pressure
container modernization
OIDC/JWT integration outside old adapters
```

### 12.4 Java 21/25 Era

Relevant security-context concerns:

```text
virtual threads
structured concurrency patterns
context propagation hazards
SecurityManager removed/deprecated path impact
newer app server compatibility
OIDC/JWT modern defaults
cloud-native deployments
```

Important: Jakarta EE security is mostly about container/application security, not Java `SecurityManager`. Modern Java has moved away from SecurityManager as the general sandboxing solution. Do not design modern Jakarta app authorization around `SecurityManager`.

---

## 13. Application Server Reality

Different servers expose different configuration styles:

```text
WildFly / JBoss EAP
  Elytron, security domains, realms, role decoders, permission mappers

Payara / GlassFish
  realms, Jakarta Security support, deployment descriptors

Open Liberty
  feature-based enablement, appSecurity, JWT/OIDC integration

TomEE
  Java EE/Jakarta profile style integration

WebLogic
  enterprise security providers, realms, policies, legacy support

Jetty/Tomcat
  servlet container focus, Jakarta Authentication bridge/support varies
```

The specification defines contracts, but production engineering still requires reading your runtime's security model.

A top engineer asks:

```text
Which layer is spec-defined?
Which layer is server-specific?
Which layer is application-specific?
Which behavior is portable?
Which behavior must be tested on the target runtime?
```

---

## 14. The Most Important Responsibility Boundaries

### 14.1 JAAS

```text
Responsible for:
- subject/principal/credential model
- login module authentication
- Java SE-level identity representation

Not ideal for:
- browser auth UX
- OIDC flow orchestration
- Jakarta app-level convenience
```

### 14.2 Jakarta Authentication

```text
Responsible for:
- low-level authentication SPI for containers
- message/request authentication
- establishing caller principal and groups in container

Not ideal for:
- normal application code unless you need low-level custom mechanism
```

### 14.3 Jakarta Authorization

```text
Responsible for:
- container authorization provider contract
- translating deployment security metadata into policy/permission decisions

Not ideal for:
- all domain authorization rules by itself
```

### 14.4 Jakarta Security

```text
Responsible for:
- developer-facing security API
- HTTP authentication mechanisms
- identity stores
- SecurityContext
- portable app-level integration with container security

Not ideal for:
- replacing all domain policy modelling
- replacing external IdP lifecycle management
- solving gateway/browser security alone
```

### 14.5 Framework Security

Example: Spring Security.

```text
Responsible for:
- framework-level security filter chain
- application-level auth/authz model
- integrations with OAuth2/OIDC/resource server

Potential issue:
- may overlap/conflict with container-managed Jakarta security if boundaries are unclear
```

---

## 15. Common Anti-Patterns Caused by Historical Confusion

### Anti-Pattern 1 — Custom Login Filter That Does Not Inform Container

```java
public void doFilter(...) {
    User user = validateToken(request);
    request.setAttribute("user", user);
    chain.doFilter(request, response);
}
```

Problem:

```text
Application sees user attribute,
but container does not know caller principal or roles.
```

Symptoms:

```text
@RolesAllowed fails
isUserInRole returns false
getUserPrincipal returns null
JAX-RS security inconsistent
```

Better:

```text
Use Jakarta Security HttpAuthenticationMechanism,
container-native auth,
or framework security consistently.
```

### Anti-Pattern 2 — Treating IdP Group as Direct Business Permission

```java
if (token.getClaim("groups").contains("sg-gov-aceas-prod-division-approval-team-v2")) {
    approve(caseId);
}
```

Problem:

```text
External identity infrastructure naming leaks into domain logic.
```

Better:

```text
IdP group → app role → domain permission decision
```

### Anti-Pattern 3 — Assuming Authentication Means Authorization

```java
if (securityContext.getCallerPrincipal() != null) {
    approveCase(caseId);
}
```

Problem:

```text
Authenticated user may not be allowed to perform this action.
```

Better:

```text
Check role + domain permission + resource state + tenant boundary.
```

### Anti-Pattern 4 — Mixing Container Security and Framework Security Accidentally

Example:

```text
Servlet container handles form login
Spring Security filter handles token auth
JAX-RS uses container role
business service uses custom ThreadLocal user
```

Problem:

```text
There are multiple sources of truth for identity.
```

Better:

```text
Define one canonical identity establishment path.
Bridge to others intentionally if needed.
```

### Anti-Pattern 5 — Authorization Only in UI

```text
Button hidden in Vue/React/JSF page
but backend endpoint accepts request directly.
```

Problem:

```text
UI is not an enforcement boundary.
```

Better:

```text
Enforce at backend boundary and domain service boundary.
```

---

## 16. A Practical Decision Tree

### 16.1 I Need Simple Form/Login in Jakarta EE

Use:

```text
Jakarta Security built-in form mechanism or container form login
IdentityStore for DB/LDAP/custom validation
SecurityContext for programmatic checks
```

Avoid starting with raw JASPIC unless needed.

### 16.2 I Need Custom HTTP Authentication in Jakarta EE

Use:

```text
HttpAuthenticationMechanism
IdentityStore / IdentityStoreHandler
notify container about login
```

Use Jakarta Authentication directly only if:

```text
you need lower-level container SPI,
portable auth module across containers,
or message-level behavior not covered by Jakarta Security.
```

### 16.3 I Need OIDC Login

Use one of:

```text
Jakarta Security OIDC mechanism, if supported and sufficient
container-native OIDC integration
framework security such as Spring Security OAuth2 client
reverse proxy / gateway OIDC with careful trust boundary
```

Decision depends on runtime, portability, logout needs, role mapping, and operational ownership.

### 16.4 I Need JWT Bearer Token API

Use one of:

```text
MicroProfile JWT
Jakarta Security custom mechanism
JAX-RS filter + SecurityContext bridge
Spring Security Resource Server
API gateway validation + app-level validation
```

But ensure:

```text
issuer/audience/signature/expiry validation
principal mapping
role/scope mapping
401/403 semantics
audit
```

### 16.5 I Need Complex Domain Authorization

Do not rely only on container roles.

Use layered authorization:

```text
container level:
  coarse route/method protection

application level:
  domain permission service

database level:
  tenant/data constraints if applicable

audit level:
  decision logging
```

---

## 17. Deep Mental Model: Identity Establishment vs Identity Consumption

Separate two halves:

```text
Identity establishment
  How does the system determine who the caller is?

Identity consumption
  How do application and container use that identity for authorization and audit?
```

### 17.1 Identity Establishment Stack

```text
credential source:
  password / token / certificate / assertion / session cookie
        ↓
mechanism:
  form / basic / OIDC / bearer / client-cert / custom
        ↓
validator:
  identity store / IdP / realm / token verifier / introspection endpoint
        ↓
identity result:
  principal + groups + claims + session/token state
        ↓
container notification:
  caller principal and groups established
```

### 17.2 Identity Consumption Stack

```text
container security:
  URL constraints, method constraints, role checks
        ↓
framework/application security:
  service-level role/permission checks
        ↓
domain authorization:
  action-resource-state-tenant relationship
        ↓
audit:
  actor, action, resource, outcome, reason
```

A mature architecture keeps these separate but connected.

---

## 18. Why There Is No Single “Best” Java Security Layer

Because use cases differ.

### 18.1 Full Jakarta EE Application

Preferred abstraction:

```text
Jakarta Security + container security annotations + domain authorization service
```

### 18.2 Spring Boot Application

Preferred abstraction often:

```text
Spring Security + OAuth2/OIDC/JWT modules
```

But if deployed to Jakarta server, boundary must be explicit.

### 18.3 Legacy App Server With Enterprise Realm

You may need:

```text
JAAS realm integration
container role mapping
JACC/JASPIC understanding
```

### 18.4 Regulated Case Management Platform

You need layered model:

```text
IdP authentication
container route/method protection
role mapping
case/domain authorization
state-machine permission
segregation of duties
auditability
```

### 18.5 Microservices

You need:

```text
JWT validation
token exchange/propagation
service identity
end-user identity propagation
audience validation
zero trust boundary
```

Jakarta Security may be one piece, not the whole platform.

---

## 19. Failure Modelling Across Layers

### 19.1 Authentication Layer Failure

```text
credential valid but mapped to wrong principal
credential expired but accepted due to clock skew
token signature valid but wrong issuer accepted
certificate valid but wrong subject mapped
session reused after logout
```

### 19.2 Container Establishment Failure

```text
app validates user but does not notify container
container principal exists but groups missing
role mapping not configured
wrong realm selected
annotation package mismatch javax/jakarta
```

### 19.3 Authorization Layer Failure

```text
URL protected but method not protected
method protected but internal self-invocation bypasses proxy
role too coarse
permission cache stale
policy provider not loaded
```

### 19.4 Domain Layer Failure

```text
approver can approve own case
user can access another tenant's case
old assignment still permits action
state changed after authorization check
emergency override not audited
```

### 19.5 Operational Failure

```text
IdP unavailable
JWKS rotation breaks token validation
LDAP group renamed
app server realm misconfigured
clock skew causes login outage
migration from javax to jakarta silently disables annotation
```

A top engineer does not ask only “is login working?”

They ask:

```text
Where is identity established?
Where is it mapped?
Where is it enforced?
Where is it cached?
Where is it audited?
Where can it become stale?
Where can it be bypassed?
```

---

## 20. Comparison Table

| Layer | Old Name | Jakarta Name | Main Purpose | Used By | Normal App Developer Touches? |
|---|---:|---:|---|---|---|
| JAAS | JAAS | still Java SE `javax.security.auth.*` | Subject/principal/login module model | Java SE, app servers, legacy realms | sometimes |
| Container security | Java EE security | Jakarta EE security | Declarative auth/authz for web/EJB | app server | yes |
| JACC | JACC | Jakarta Authorization | Authorization provider SPI | container/provider | rarely |
| JASPIC | JASPIC | Jakarta Authentication | Authentication mechanism SPI | container/provider | rarely/directly |
| Security API | Java EE Security API | Jakarta Security | Developer-facing auth/identity/security context | application | yes |
| Framework security | Spring Security etc. | framework-specific | App/framework auth/authz | application/framework | yes if using framework |

---

## 21. Reference Architecture View

```text
+-------------------------------------------------------------+
| Browser / API Client / Service Caller                       |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Network / Gateway / Reverse Proxy                           |
| - TLS termination                                            |
| - optional OIDC/JWT validation                               |
| - forwarded headers                                          |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Jakarta Web Container                                       |
| - Servlet security                                           |
| - session/cookie                                             |
| - authentication challenge                                   |
| - request dispatch                                           |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Authentication Layer                                         |
| - Jakarta Security HttpAuthenticationMechanism               |
| - Jakarta Authentication ServerAuthModule                    |
| - container realm / JAAS login module                        |
| - OIDC/JWT/cert/basic/form mechanism                         |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Identity Resolution Layer                                    |
| - IdentityStore                                              |
| - external IdP                                               |
| - LDAP/database                                              |
| - group/claim mapping                                        |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Container Identity                                           |
| - caller principal                                           |
| - groups/roles                                               |
| - Subject/security context                                   |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Authorization Layer                                          |
| - URL constraints                                            |
| - @RolesAllowed                                              |
| - Jakarta Authorization/JACC policy provider                 |
| - application/domain permission service                      |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| Business Operation                                           |
| - case approval                                              |
| - data access                                                |
| - state transition                                           |
| - audit event                                                |
+-------------------------------------------------------------+
```

---

## 22. Practical Example: Why A Valid Login Still Fails `@RolesAllowed`

Scenario:

```text
User logs in successfully using custom JWT filter.
Endpoint with @RolesAllowed("ADMIN") returns 403.
```

Likely causes:

1. Filter validates JWT but does not establish container principal.
2. Principal exists but group/role not passed to container.
3. Token claim is `admin` but app role expects `ADMIN`.
4. Role mapping is missing in container/server config.
5. `@RolesAllowed` imported from wrong package for runtime generation.
6. Method security not enabled or not supported in that component type.
7. Self-invocation bypasses interceptor/proxy.
8. JAX-RS runtime does not bridge to container security as expected.

Debugging sequence:

```text
1. Check request.getUserPrincipal()
2. Check request.isUserInRole("ADMIN")
3. Check SecurityContext.getCallerPrincipal()
4. Check SecurityContext.isCallerInRole("ADMIN")
5. Check token/group claims
6. Check mapping from external group to app role
7. Check annotation package and runtime support
8. Check whether endpoint invocation passes through security interceptor
9. Check server-specific security logs
```

This is exactly why historical layer understanding matters.

---

## 23. Practical Example: JAAS Realm + Jakarta Security App

A legacy server may validate users through JAAS/LoginModule, while application code uses Jakarta Security's `SecurityContext`.

Conceptually:

```text
JAAS LoginModule validates credential
        ↓
container realm establishes Subject/principals
        ↓
container maps groups to roles
        ↓
Jakarta SecurityContext exposes caller/role checks to app code
```

This can work well. But be careful:

```text
JAAS principal names may not match application caller names.
JAAS group principals may not map automatically to roles.
Logout/session behavior may be container-specific.
Testing with mocks may not reproduce app server mapping.
```

---

## 24. Practical Example: Jakarta Authentication Module vs Jakarta Security Mechanism

### Low-Level Jakarta Authentication Style

```text
You implement ServerAuthModule.
You inspect request/message directly.
You call callbacks to establish principal/groups.
You handle AuthStatus and message lifecycle.
```

Use when:

```text
You are building a reusable container authentication provider.
You need low-level portability across compliant servers.
You need message-level control.
```

### Higher-Level Jakarta Security Style

```text
You implement HttpAuthenticationMechanism.
You validate credential via IdentityStore.
You call HttpMessageContext to notify container.
```

Use when:

```text
You are building authentication for a Jakarta web application.
You want CDI integration.
You want a simpler programming model.
```

Rule of thumb:

```text
Application team → Jakarta Security first.
Container/platform team → Jakarta Authentication if needed.
```

---

## 25. Relationship With OIDC and JWT

OIDC/JWT did not originate from Java EE. They come from modern web identity standards.

Jakarta security layers must integrate them into container identity:

```text
OIDC authorization code flow
        ↓
ID token / UserInfo / claims
        ↓
claim mapping
        ↓
caller principal
        ↓
groups / roles
        ↓
container SecurityContext
        ↓
application/domain authorization
```

For JWT resource server:

```text
Authorization: Bearer <access_token>
        ↓
signature/issuer/audience/expiry validation
        ↓
subject/client identity extraction
        ↓
scope/role/claim mapping
        ↓
container/app security context
        ↓
authorization decision
```

Never stop at “JWT signature valid”. Valid token is only an input to security context establishment.

---

## 26. What A Top 1% Engineer Should Internalize

### 26.1 Security Is A Chain of Contracts

```text
credential contract
identity contract
role/group mapping contract
authorization contract
domain permission contract
audit contract
operational recovery contract
```

If one contract is implicit, production will eventually expose it.

### 26.2 Authentication Is Not A Boolean

Bad model:

```text
loggedIn = true
```

Better model:

```text
actor = identified by issuer + subject + tenant + assurance level
credential = validated through mechanism X at time T
session = established with expiry and logout semantics
groups = resolved from source Y with freshness Z
roles = mapped through versioned mapping table
```

### 26.3 Authorization Is Not A Role Check

Bad model:

```java
if (user.hasRole("APPROVER")) approve(caseId);
```

Better model:

```text
Can actor A perform action APPROVE on resource case C
under tenant T, current state S, relationship R,
time window W, and segregation-of-duty constraints D?
```

### 26.4 Container Security Is A Boundary, Not Decoration

Annotations like `@RolesAllowed` are not documentation. They are runtime enforcement metadata, but only if the runtime recognizes and applies them correctly.

### 26.5 Security Context Must Have One Source of Truth

If your system has:

```text
request attribute user
ThreadLocal user
JWT parser user
container principal
Spring Authentication
Jakarta SecurityContext
session user object
```

then you must explicitly define which one is canonical and how others derive from it.

---

## 27. Checklist: Reading Any Java/Jakarta Security Codebase

When entering a codebase, ask:

### Authentication

```text
What mechanisms are supported?
Where are credentials extracted?
Who validates credentials?
Where is caller principal created?
Where are groups/roles loaded?
How is session established?
How does logout work?
```

### Container Integration

```text
Does authentication notify the container?
Does request.getUserPrincipal() work?
Does SecurityContext get the same identity?
Does isUserInRole() work consistently?
Are annotations recognized by runtime?
```

### Authorization

```text
What is protected at URL level?
What is protected at method level?
What is protected at domain level?
What is default-deny?
Where can authorization be bypassed?
```

### Role Mapping

```text
What are external groups?
What are application roles?
Where is mapping configured?
Who owns mapping changes?
Is mapping environment-specific?
How are changes tested?
```

### Runtime

```text
Which Java version?
Which Jakarta EE version?
Which app server?
Which namespace: javax or jakarta?
Which security provider?
Which IdP?
```

### Operations

```text
How are IdP outages handled?
How are key rotations handled?
How are cert rotations handled?
How is clock sync guaranteed?
How are failed auth events logged?
How are access denials audited?
```

---

## 28. Mini Glossary for This Part

```text
JAAS
  Java SE authentication/authorization framework based on Subject and Principal.

JACC
  Old Java Authorization Contract for Containers; now Jakarta Authorization.

JASPIC
  Old Java Authentication SPI for Containers; now Jakarta Authentication.

Jakarta Security
  Developer-facing security API for Jakarta EE applications.

Realm
  Container-configured identity source or validation domain.

Subject
  Entity with principals and credentials.

Principal
  Identity name attached to a subject or caller.

Group
  Identity-provider/container grouping, often mapped to application role.

Role
  Application-level authorization abstraction recognized by container/app.

Permission
  Lower-level representation of allowed action/resource relation.

Policy Provider
  Component that evaluates authorization permissions.

Authentication Mechanism
  Component that obtains/validates credentials and establishes caller identity.

Identity Store
  Component that validates credentials and/or retrieves groups.
```

---

## 29. Summary

The historical layering of Java/Jakarta security is not accidental. Each layer solved a different problem:

```text
JAAS
  Java SE identity/auth foundation.

Java EE container security
  Declarative web/EJB security and role mapping.

JACC / Jakarta Authorization
  Standard authorization provider contract for containers.

JASPIC / Jakarta Authentication
  Standard authentication mechanism SPI for containers.

Java EE Security API / Jakarta Security
  Developer-facing API for modern application security.
```

The big lesson:

> Do not treat Java/Jakarta security as one API. Treat it as a chain of identity establishment, container integration, authorization enforcement, domain policy, and auditability.

For real enterprise systems, especially regulatory/case-management systems, the mature design is layered:

```text
external identity provider
        ↓
authentication mechanism
        ↓
container caller identity
        ↓
role/group mapping
        ↓
coarse container authorization
        ↓
fine-grained domain authorization
        ↓
audit and forensic record
```

If you know this history, you can reason about why a system breaks. If you do not, security failures look random.

---

## 30. References

- Jakarta Security 4.0 Specification and API, Eclipse Foundation.
- Jakarta Authentication 3.1 Specification, Eclipse Foundation.
- Jakarta Authorization 3.0 Specification, Eclipse Foundation.
- Oracle Java SE JAAS Reference Guide and LoginModule Developer Guide.
- Jakarta EE Tutorial, Security introduction.
- Open Liberty and Jetty documentation for runtime-specific Jakarta Authentication/Security behavior.

---

## 31. Status Seri

Selesai:

```text
Part 00 — Orientation: Enterprise Java Security Mental Model
Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission
Part 02 — Historical Layer: JAAS, JACC, JASPIC, Java EE Security, Jakarta Security
```

Belum selesai. Part berikutnya:

```text
Part 03 — Container Security Architecture
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 01 — Identity, Principal, Subject, Caller, Group, Role, Permission](./learn-java-jakarta-security-authentication-authorization-identity-part-01-identity-principal-subject-role-permission.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Learn Java Jakarta Security Authentication Authorization Identity](./learn-java-jakarta-security-authentication-authorization-identity-part-03-container-security-architecture.md)
