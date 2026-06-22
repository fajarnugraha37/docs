# learn-java-authentication-modes-and-patterns-part-006  
# Part 6 — Jakarta Security and Jakarta Authentication Deep Dive

> Series: **Java Authentication Modes and Patterns**  
> Range: **Java 8 sampai Java 25**  
> Fokus part ini: **standard Jakarta EE untuk authentication**, khususnya perbedaan antara **Jakarta Security** sebagai API application-level yang lebih nyaman, dan **Jakarta Authentication** sebagai SPI container-level yang lebih rendah untuk mengintegrasikan authentication mechanism ke runtime.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas:

- **Part 0**: authentication sebagai pembuktian identity pada trust boundary.
- **Part 1**: fondasi Java runtime: `Subject`, `Principal`, credential, context.
- **Part 2**: taxonomy authentication mode berdasarkan proof, trust, state, dan delegation.
- **Part 3**: password authentication sebagai lifecycle credential.
- **Part 4**: session-based authentication sebagai distributed state problem.
- **Part 5**: Servlet container authentication: BASIC, FORM, CLIENT-CERT, declarative constraint, principal propagation.

Sekarang kita naik ke lapisan standard Jakarta EE modern:

```text
Jakarta Security
Jakarta Authentication
Jakarta Servlet security
Jakarta Authorization
Jakarta CDI
Jakarta REST/JAX-RS
Jakarta Faces
EJB / business components
```

Topik ini sering membingungkan karena nama spesifikasinya mirip:

| Nama | Fokus |
|---|---|
| Jakarta Servlet Security | security constraint dan container-managed web auth di Servlet layer |
| Jakarta Security | API lebih modern untuk HTTP authentication mechanism, identity store, dan programmatic `SecurityContext` |
| Jakarta Authentication | low-level SPI untuk authentication modules yang berinteraksi dengan container runtime |
| Jakarta Authorization | permission/authorization model berbasis policy |
| Jakarta Enterprise Beans security | method-level role enforcement dan caller propagation di EJB |

Part ini tidak akan mengulang konfigurasi Servlet BASIC/FORM dari Part 5. Fokus kita adalah:

> Bagaimana standard Jakarta EE memisahkan **authentication mechanism**, **identity store**, **caller principal**, **groups**, **container security context**, dan **application access check**.

Tujuan akhirnya bukan sekadar tahu anotasi seperti `@BasicAuthenticationMechanismDefinition`, tetapi mampu menjawab pertanyaan desain:

- Kapan memakai Jakarta Security?
- Kapan cukup Servlet built-in auth?
- Kapan perlu Jakarta Authentication `ServerAuthModule`?
- Kapan lebih baik memakai Spring Security atau gateway/IdP integration?
- Bagaimana mencegah identity mismatch antara container, application, dan downstream service?
- Bagaimana membuat custom authentication yang portable, testable, dan defensible?

---

## 1. Peta Besar: Tiga Level Authentication di Jakarta EE

Untuk memahami Jakarta Security dan Jakarta Authentication, gunakan model tiga level berikut.

```text
+--------------------------------------------------------------+
| Application Code                                             |
| - REST resource                                              |
| - Servlet                                                    |
| - Faces backing bean                                         |
| - CDI bean                                                   |
| - EJB/business service                                       |
|                                                              |
| Uses:                                                        |
| - SecurityContext                                            |
| - request.getUserPrincipal()                                 |
| - isCallerInRole / isUserInRole                              |
+--------------------------^-----------------------------------+
                           |
+--------------------------|-----------------------------------+
| Jakarta Security                                             |
| - HttpAuthenticationMechanism                                |
| - IdentityStore                                              |
| - CredentialValidationResult                                 |
| - SecurityContext                                            |
| - built-in mechanisms                                        |
|                                                              |
| Goal: application-friendly auth API                          |
+--------------------------^-----------------------------------+
                           |
+--------------------------|-----------------------------------+
| Jakarta Authentication                                       |
| - ServerAuthModule                                           |
| - ServerAuthContext                                          |
| - AuthConfigProvider                                         |
| - CallerPrincipalCallback                                    |
| - GroupPrincipalCallback                                     |
|                                                              |
| Goal: low-level container SPI                                |
+--------------------------^-----------------------------------+
                           |
+--------------------------|-----------------------------------+
| Servlet / Jakarta EE Container Runtime                       |
| - request lifecycle                                          |
| - session lifecycle                                          |
| - protected resource decision                                |
| - principal/group propagation                                |
| - role checks                                                |
+--------------------------------------------------------------+
```

### 1.1 Servlet Security: Built-in Web Container Model

Servlet security answers:

```text
Which URL is protected?
Which auth method protects it?
What role is required?
```

It usually uses:

```xml
<security-constraint>
<login-config>
<security-role>
```

or equivalent annotations/container config.

This is old, stable, and container-centric.

### 1.2 Jakarta Security: Developer-Friendly Security API

Jakarta Security answers:

```text
How can application developers define custom HTTP authentication and identity stores portably?
```

It provides a higher-level API around:

- `HttpAuthenticationMechanism`
- `IdentityStore`
- `Credential`
- `CredentialValidationResult`
- injectable `SecurityContext`

It is easier to write than a low-level container SPI.

### 1.3 Jakarta Authentication: Low-Level SPI

Jakarta Authentication answers:

```text
How can third-party or custom authentication modules integrate with the container message processing runtime?
```

It works at lower level through:

- `ServerAuthModule`
- `ServerAuthContext`
- `AuthConfigProvider`
- `MessageInfo`
- callbacks to set caller principal and groups

This is closer to a container plug-in model.

### 1.4 Mental Model

The cleanest mental model:

```text
Servlet Security       = URL/resource protection model
Jakarta Security       = application-level auth API
Jakarta Authentication = container authentication SPI
```

Not all applications need all three.

---

## 2. Why Jakarta Security Exists

Before Jakarta Security, Java EE security had several pain points:

1. Many authentication mechanisms were configured outside application code.
2. Custom authentication often required vendor-specific realm configuration.
3. Programmatic access to caller identity existed, but the authentication mechanism itself was not easy to implement portably.
4. Different containers had different extension points.
5. Identity store integration was not standardized in a developer-friendly way.

Jakarta Security attempts to standardize a more ergonomic model:

```text
HTTP authentication mechanism validates credential
        ↓
Identity store validates caller data
        ↓
CredentialValidationResult carries principal/groups
        ↓
Container establishes caller identity
        ↓
Application reads caller through SecurityContext/request/EJB context
```

### 2.1 The Key Design Move

Instead of forcing every custom login to become container-specific realm code, Jakarta Security gives application developers a way to express:

```java
@ApplicationScoped
public class MyAuthenticationMechanism implements HttpAuthenticationMechanism {
    ...
}
```

and:

```java
@ApplicationScoped
public class MyIdentityStore implements IdentityStore {
    ...
}
```

This separates:

| Concern | Component |
|---|---|
| How credential is obtained from HTTP request | `HttpAuthenticationMechanism` |
| How credential is validated | `IdentityStore` |
| What caller identity and groups are returned | `CredentialValidationResult` |
| How identity becomes container caller | Jakarta Security/container bridge |
| How app checks identity | `SecurityContext`, Servlet request, EJB context |

That separation is the central insight.

---

## 3. Core Abstractions of Jakarta Security

Jakarta Security has three most important developer-facing abstractions:

1. `HttpAuthenticationMechanism`
2. `IdentityStore`
3. `SecurityContext`

Everything else is supporting machinery.

---

## 4. `HttpAuthenticationMechanism`: The Request Boundary

`HttpAuthenticationMechanism` is responsible for the HTTP-side authentication conversation.

It answers:

```text
Given this HTTP request and response,
can I authenticate the caller,
challenge the caller,
or let the request continue unauthenticated?
```

Conceptually:

```java
AuthenticationStatus validateRequest(
    HttpServletRequest request,
    HttpServletResponse response,
    HttpMessageContext httpMessageContext
);
```

### 4.1 What It Should Do

A mechanism can:

1. inspect headers,
2. inspect cookies,
3. inspect form parameters,
4. inspect client certificates,
5. redirect to login page,
6. validate a token,
7. call an identity store,
8. notify the container of authenticated caller,
9. return challenge response,
10. do nothing for public resources.

### 4.2 What It Should Not Do

A good `HttpAuthenticationMechanism` should not become a giant security monolith.

Avoid putting all of this inside one class:

- password hashing logic,
- database query logic,
- user provisioning,
- MFA policy engine,
- role hierarchy expansion,
- session invalidation policy,
- audit persistence,
- fraud detection,
- tenant routing,
- external IdP protocol implementation.

It may orchestrate these, but it should not own all of them.

### 4.3 Good Boundary

```text
HttpAuthenticationMechanism
    extracts credential/proof from request
    performs protocol-level challenge/response
    delegates validation to IdentityStore or domain service
    maps validation result to container identity
```

### 4.4 Example: Header Token Mechanism

Simplified conceptual example:

```java
@ApplicationScoped
public class BearerTokenAuthenticationMechanism implements HttpAuthenticationMechanism {

    @Inject
    private IdentityStoreHandler identityStoreHandler;

    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) throws AuthenticationException {

        String authorization = request.getHeader("Authorization");

        if (authorization == null || !authorization.startsWith("Bearer ")) {
            if (context.isProtected()) {
                response.setHeader("WWW-Authenticate", "Bearer");
                return context.responseUnauthorized();
            }
            return context.doNothing();
        }

        String token = authorization.substring("Bearer ".length());
        CredentialValidationResult result = identityStoreHandler.validate(
                new BearerTokenCredential(token));

        if (result.getStatus() == CredentialValidationResult.Status.VALID) {
            return context.notifyContainerAboutLogin(
                    result.getCallerPrincipal(),
                    result.getCallerGroups());
        }

        return context.responseUnauthorized();
    }
}
```

This example illustrates the flow, not final production code.

### 4.5 Why `HttpMessageContext` Matters

`HttpMessageContext` is where the mechanism interacts with the container/security pipeline.

It provides operations such as:

- checking whether resource is protected,
- telling container login succeeded,
- returning unauthorized response,
- forwarding/redirecting,
- doing nothing.

The important mental model:

```text
Do not merely set your own request attribute and call it authentication.
Notify the container if the caller identity must become container-recognized identity.
```

If you only do:

```java
request.setAttribute("user", user);
```

then:

```java
request.getUserPrincipal()
securityContext.getCallerPrincipal()
@RolesAllowed
isUserInRole(...)
```

may not behave correctly.

---

## 5. `IdentityStore`: The Caller Data Boundary

An `IdentityStore` validates credentials and retrieves caller identity/groups.

It answers:

```text
Is this credential valid?
If yes, who is the caller?
Which groups should the container know about?
```

### 5.1 Identity Store Is Not Always a Database

An identity store can be backed by:

- relational database,
- LDAP,
- Active Directory,
- in-memory users,
- remote IdP,
- token introspection endpoint,
- API key registry,
- certificate registry,
- tenant-specific identity repository,
- legacy mainframe/user directory,
- custom service.

The name “store” can mislead. It is not necessarily a local table.

Better mental model:

```text
IdentityStore = validation and identity lookup adapter
```

### 5.2 Common Identity Store Methods

A store may support:

1. credential validation,
2. group lookup,
3. priority ordering,
4. validation type declaration.

Conceptually:

```java
CredentialValidationResult validate(Credential credential);
Set<String> getCallerGroups(CredentialValidationResult validationResult);
int priority();
Set<ValidationType> validationTypes();
```

### 5.3 Built-In Identity Stores

Jakarta Security standardizes built-in forms such as:

- database identity store,
- LDAP identity store,
- in-memory identity store in newer Jakarta Security versions.

These are useful for standard cases, but top-tier engineering usually treats them as building blocks, not final architecture.

### 5.4 Database Identity Store: Useful but Dangerous if Misused

A database identity store seems simple:

```text
username + password hash in table
roles/groups in table
```

But production design must answer:

1. How is password hash algorithm version stored?
2. How is password rehash migration handled?
3. How are locked/disabled users represented?
4. How are tenant boundaries enforced?
5. How are roles mapped to groups?
6. How are stale sessions invalidated after password reset?
7. How are failed attempts tracked without enabling lockout DoS?
8. How is account enumeration prevented?
9. How is audit generated?
10. How is credential compromise handled?

So do not confuse:

```text
IdentityStore can query database
```

with:

```text
Authentication system is complete
```

### 5.5 LDAP Identity Store

LDAP store is common in enterprise.

It typically involves:

1. binding as service account,
2. searching user DN,
3. binding as user or validating credential,
4. retrieving groups,
5. mapping groups to application roles.

Failure modes:

- LDAP outage blocks login.
- Nested group lookup becomes expensive.
- Group membership is stale due to caching.
- DN search is vulnerable to filter injection if not escaped.
- Login latency spikes under directory pressure.
- Directory identity names do not match application subject IDs.

### 5.6 Remote Identity Store Pattern

For OAuth2 token introspection or external identity validation:

```text
IdentityStore.validate(token)
        ↓
call introspection endpoint
        ↓
validate active/audience/scope/subject
        ↓
map to caller principal and groups
```

This is valid conceptually, but production concerns include:

- cache TTL,
- IdP outage behavior,
- token replay,
- circuit breaker,
- bulkhead,
- timeout,
- fail-closed default,
- clock skew,
- audit correlation,
- tenant-bound issuer validation.

---

## 6. `CredentialValidationResult`: The Identity Handoff Object

`CredentialValidationResult` is the result of validating a credential.

It usually carries:

- validation status,
- caller principal,
- caller unique ID,
- caller groups,
- identity store ID,
- possibly additional context depending on implementation.

### 6.1 The Most Important Question

When validation succeeds, what identity do you return?

Bad example:

```text
Principal name = display name
```

Better:

```text
Principal name = stable immutable subject ID
Display name = attribute
Email = attribute
Groups = authorization input
```

Why?

Because display names change, emails may change, usernames may be recycled, and external IdPs may change identifiers during migration.

### 6.2 Caller Principal vs Caller Groups

A caller principal answers:

```text
Who is this caller?
```

Caller groups answer:

```text
What coarse-grained security groups does the container know about?
```

Do not overload group with all application permissions.

Bad:

```text
GROUP_APPROVE_CASE_123
GROUP_VIEW_CASE_123
GROUP_EDIT_FIELD_A_ON_FORM_B
```

Better:

```text
groups = coarse application roles or enterprise groups
fine-grained permissions = application policy layer
```

### 6.3 Authentication Result Is Not Authorization Result

This is a common mistake.

Authentication result should not say:

```text
User can approve this particular enforcement case.
```

It should say:

```text
User identity is valid.
User belongs to groups X, Y.
User attributes are A, B.
```

Case-level authorization belongs elsewhere.

---

## 7. `SecurityContext`: Programmatic Caller View

Jakarta Security provides an injectable `SecurityContext` for application code.

It answers:

```text
Who is the current caller from the Jakarta container perspective?
Is the caller in a role?
Is access allowed?
```

Conceptually:

```java
@Inject
SecurityContext securityContext;

Principal caller = securityContext.getCallerPrincipal();
boolean admin = securityContext.isCallerInRole("ADMIN");
```

### 7.1 Why This Is Better Than Custom Request Attributes

Custom attribute approach:

```java
User user = (User) request.getAttribute("user");
```

Problems:

- not recognized by container,
- not visible to EJB method security,
- not portable across Jakarta components,
- easy to bypass,
- hard to audit consistently,
- can diverge from `Principal`.

Jakarta `SecurityContext` approach:

```text
Container-recognized caller identity
        ↓
consistent role checks
        ↓
portable application access
```

### 7.2 SecurityContext Is a View, Not the Whole Security Model

Do not store all user profile information in the security context.

It should not become:

```java
UserProfile fullProfile = securityContext.getEverythingAboutUser();
```

Better:

```text
SecurityContext gives stable caller identity
Application service loads domain profile when needed
```

### 7.3 SecurityContext and Domain Identity

A strong production design separates:

| Concept | Example |
|---|---|
| Security principal | `sub=01HZY...` |
| Login identifier | `fajar@example.com` |
| Display name | `Fajar Abdi Nugraha` |
| Domain actor | `OfficerId=CEA-12345` |
| Tenant/org | `agency=CEA` |
| Groups | `CASE_OFFICER`, `SUPERVISOR` |
| Fine permissions | loaded by policy engine |

This prevents authentication identity from becoming a messy domain object.

---

## 8. Built-In Authentication Mechanisms in Jakarta Security

Jakarta Security provides or standardizes built-in mechanism definitions such as:

- Basic authentication,
- Form authentication,
- Custom Form authentication,
- OpenID Connect authentication in newer Jakarta Security,
- mechanism handler support for multiple mechanisms in Jakarta Security 4.0.

### 8.1 Basic Authentication

Basic authentication is simple:

```text
Authorization: Basic base64(username:password)
```

Use cases:

- simple internal admin tools,
- local development,
- legacy integration,
- service endpoint protected by TLS and additional network control.

Avoid for:

- public browser login,
- high-risk accounts,
- systems requiring MFA,
- APIs requiring fine token lifecycle,
- passwordless/federated identity.

### 8.2 Form Authentication

Form authentication collects username/password from an HTML form.

Use cases:

- traditional server-rendered web app,
- internal enterprise app,
- Jakarta Faces/JSP style application.

Risks:

- CSRF,
- session fixation,
- password reset bypass,
- account enumeration,
- brute force,
- inconsistent error messages,
- insecure remember-me.

### 8.3 Custom Form Authentication

Custom form auth allows more control over login page and credential submission.

Use cases:

- branded login,
- extra tenant field,
- custom credential type,
- staged login flow,
- integration with identity store.

But avoid turning custom form into a full protocol engine. For OAuth2/OIDC, prefer real OIDC mechanism or dedicated IdP integration.

### 8.4 OIDC Mechanism

OpenID Connect authentication is increasingly relevant in Jakarta Security.

OIDC mechanism shifts password handling away from the application:

```text
Application redirects user to IdP
IdP authenticates user
Application receives identity assertion
Container establishes caller identity
```

This is usually better for enterprise SSO than local password tables.

Design questions:

1. Which issuer is trusted?
2. Which client ID is expected?
3. Which redirect URI is allowed?
4. Which claim becomes caller principal?
5. Which claim/group becomes container group?
6. How is logout handled?
7. How is session timeout aligned with IdP session?
8. How are token refresh and re-authentication handled?
9. What happens if IdP is down?
10. How are first-login and identity linking handled?

### 8.5 Multiple Authentication Mechanisms

A modern application may need more than one mechanism:

```text
Browser pages       -> OIDC/session
Internal API        -> mTLS or bearer token
Health endpoint     -> anonymous or infra-only
Admin endpoint      -> OIDC + step-up
Partner callback    -> HMAC signature
```

Jakarta Security 4.0 includes a handler concept for multiple HTTP authentication mechanisms.

The architectural challenge is not registering multiple mechanisms. The challenge is making their boundaries explicit:

```text
For this request path / host / audience / method,
which mechanism is authoritative?
```

If multiple mechanisms compete, you can get:

- wrong challenge response,
- fallback to weaker mechanism,
- unintended anonymous access,
- token accepted on browser endpoint,
- session accepted on API endpoint,
- confusing audit trail.

---

## 9. Jakarta Authentication: The Low-Level SPI

Jakarta Authentication defines a lower-level SPI for authentication modules.

The central abstraction is usually:

```text
ServerAuthModule
```

It participates in a container message processing model.

### 9.1 What Problem It Solves

It solves:

```text
I need to plug an authentication module into the container runtime itself.
```

Examples:

- third-party auth product integration,
- custom container-level token mechanism,
- protocol integration not covered by Jakarta Security,
- centralized security module across applications,
- enterprise product/runtime integration.

### 9.2 `ServerAuthModule`

A `ServerAuthModule` can:

1. validate inbound request/message,
2. secure outbound response/message,
3. communicate caller principal to container using callbacks,
4. participate in configured auth context.

Conceptual methods:

```java
AuthStatus validateRequest(
    MessageInfo messageInfo,
    Subject clientSubject,
    Subject serviceSubject
);

AuthStatus secureResponse(
    MessageInfo messageInfo,
    Subject serviceSubject
);

void cleanSubject(MessageInfo messageInfo, Subject subject);
```

### 9.3 MessageInfo

`MessageInfo` carries request/response message objects plus metadata.

In Servlet profile, the message is typically HTTP request/response.

Mental model:

```text
MessageInfo = container-specific request/response envelope
```

### 9.4 Subject in Jakarta Authentication

Jakarta Authentication still uses `Subject`-style concepts inherited from Java security heritage.

The module receives a `clientSubject` and may use callbacks to populate caller principal and groups.

But modern Jakarta app code usually consumes identity through:

- `SecurityContext`,
- Servlet request principal,
- EJB context,
- role annotations.

### 9.5 Callbacks

Important callbacks include:

- `CallerPrincipalCallback`
- `GroupPrincipalCallback`
- `PasswordValidationCallback`
- `CertStoreCallback`
- others depending on profile/runtime

The mechanism does not simply return a Java object to application code. It uses callbacks to tell the container:

```text
This is the authenticated caller.
These are the groups.
```

### 9.6 Why This Is Harder Than Jakarta Security

Jakarta Authentication is powerful but low-level.

You need to understand:

- container lifecycle,
- module initialization,
- callback handler,
- message info contract,
- concurrency requirements,
- request/response commit behavior,
- vendor/runtime registration,
- profile support.

For most application teams, Jakarta Security is easier and safer.

---

## 10. Jakarta Security vs Jakarta Authentication

Use this table as decision support.

| Dimension | Jakarta Security | Jakarta Authentication |
|---|---|---|
| Level | Application-friendly API | Container SPI |
| Main type | `HttpAuthenticationMechanism` | `ServerAuthModule` |
| Identity validation | `IdentityStore` | callbacks / module logic |
| Typical developer | application developer | container/security platform developer |
| Portability | high within Jakarta runtimes | standard SPI, but registration/runtime behavior can be more complex |
| Complexity | medium | high |
| Best for | custom HTTP auth in Jakarta EE app | deep integration with container authentication pipeline |
| Danger | mixing app/domain logic into auth mechanism | vendor/runtime complexity and difficult debugging |

### 10.1 Simple Rule

```text
If you are building a Jakarta EE application and need custom HTTP authentication,
start with Jakarta Security.

If you are building a reusable container-level authentication provider or need very low-level integration,
consider Jakarta Authentication.
```

---

## 11. Interaction with Servlet Container Authentication

Jakarta Security does not erase Servlet security. It builds on the web container security model.

The application may still use:

```java
request.getUserPrincipal()
request.isUserInRole("ADMIN")
```

and security constraints may still define protected resources.

### 11.1 Protected Resource Decision

Important distinction:

| Question | Usually answered by |
|---|---|
| Is this URL protected? | Servlet/container security constraint or app/framework routing |
| How to authenticate this request? | Servlet auth method / Jakarta Security mechanism / framework |
| Who is authenticated? | container security context |
| Is caller in role? | container/app authorization layer |
| Can caller perform domain action? | domain authorization/policy engine |

### 11.2 `context.isProtected()`

In a custom `HttpAuthenticationMechanism`, checking whether a resource is protected matters.

Bad pattern:

```text
Every request without credential returns 401, including public resources.
```

Better pattern:

```text
If resource is protected -> challenge/unauthorized
If resource is public and no credential -> do nothing
If credential exists -> attempt authentication
```

This allows optional authentication:

```text
Public page shows anonymous view
Same page shows personalized view if authenticated
```

### 11.3 Optional Authentication Caveat

Optional authentication must be carefully designed.

Danger:

```text
Invalid token on public endpoint is ignored,
request continues as anonymous,
and application accidentally serves data because it expected auth failure.
```

Policy must decide:

| Condition | Recommended behavior |
|---|---|
| no credential on public endpoint | allow anonymous |
| invalid credential on public endpoint | usually reject, because caller attempted authentication |
| no credential on protected endpoint | challenge/401/redirect |
| invalid credential on protected endpoint | reject |

---

## 12. Groups, Roles, and Permissions

Jakarta security models often talk about groups and roles.

This is a frequent source of architectural mistakes.

### 12.1 Group

A group is often identity-provider-side or enterprise-directory-side membership:

```text
CEA_CASE_OFFICER
CEA_SUPERVISOR
FINANCE_APPROVER
```

### 12.2 Role

A role is application-side coarse responsibility:

```text
CASE_VIEWER
CASE_HANDLER
CASE_APPROVER
SYSTEM_ADMIN
```

### 12.3 Permission

A permission is fine-grained ability:

```text
approve case 123
view document 456
edit applicant address field
reopen closed appeal
export report for tenant X
```

### 12.4 Common Mapping

```text
External groups
        ↓
application role mapping
        ↓
fine-grained policy evaluation
```

### 12.5 Bad Design

```text
OIDC group claim has 500 groups
Jakarta caller groups contain all groups
Every domain permission is represented as a group
```

Problems:

- token bloat,
- stale authorization,
- group explosion,
- poor auditability,
- impossible least privilege,
- hard migration.

### 12.6 Better Design

```text
Authentication result:
  principal = stable subject
  groups = coarse groups needed by container

Domain authorization:
  loads roles/permissions from application policy source
  evaluates resource/action/context
```

### 12.7 Jakarta Role Check Is Coarse

Use Jakarta role checks for broad access:

```java
@RolesAllowed("ADMIN")
public void adminOperation() { ... }
```

Do not use it as the only control for complex business operations:

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(String caseId) {
    // still check case ownership, status, segregation of duties, assignment, tenant, etc.
}
```

---

## 13. Caller Principal Design

The caller principal is the canonical identity recognized by the container.

### 13.1 Good Principal Properties

A good principal name should be:

- stable,
- unique,
- non-recycled,
- not display-oriented,
- safe to log,
- tenant-aware if needed,
- mappable to external subject,
- independent from mutable email/name.

### 13.2 Poor Principal Choices

Avoid:

```text
email address if email can change
username if usernames can be recycled
display name
NRIC/passport/plain personal identifier
random session ID
role name
```

### 13.3 Better Principal Format

Examples:

```text
local:user:01J2ZK...
tenant:cea:user:01J2ZK...
oidc:https://idp.example.com:sub:abc123
ad:domain:objectGuid:...
cert:sha256-fingerprint:...
```

The exact format depends on system requirements.

### 13.4 Principal vs Domain Actor

In regulatory systems, authenticated principal may not equal domain actor.

Example:

```text
Authenticated principal:
  oidc:agency-idp:sub:abc123

Domain actor:
  enforcementOfficerId = OFF-90210

Authority context:
  actingAgency = CEA
  assignedTeam = Compliance-A
  delegatedRole = Investigation Lead
```

This separation matters for audit and defensibility.

---

## 14. Implementing a Custom `IdentityStore` Properly

A production-quality custom identity store should be boring, deterministic, and explicit.

### 14.1 Skeleton

```java
@ApplicationScoped
public class ApplicationIdentityStore implements IdentityStore {

    @Inject
    UserCredentialRepository credentials;

    @Inject
    PasswordVerifier passwordVerifier;

    @Inject
    GroupResolver groupResolver;

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof UsernamePasswordCredential up)) {
            return CredentialValidationResult.NOT_VALIDATED_RESULT;
        }

        String username = normalizeUsername(up.getCaller());
        Optional<UserCredentialRecord> record = credentials.findByUsername(username);

        if (record.isEmpty()) {
            passwordVerifier.verifyAgainstDummyHash(up.getPasswordAsString());
            return CredentialValidationResult.INVALID_RESULT;
        }

        UserCredentialRecord user = record.get();

        if (!user.isLoginAllowed()) {
            passwordVerifier.verifyAgainstDummyHash(up.getPasswordAsString());
            return CredentialValidationResult.INVALID_RESULT;
        }

        boolean valid = passwordVerifier.verify(
                up.getPasswordAsString(),
                user.passwordHash());

        if (!valid) {
            return CredentialValidationResult.INVALID_RESULT;
        }

        Set<String> groups = groupResolver.resolveContainerGroups(user.userId());

        return new CredentialValidationResult(
                new CallerPrincipal(user.stablePrincipalName()),
                groups);
    }
}
```

### 14.2 Design Notes

Important points:

1. Unknown user path performs dummy verification to reduce timing enumeration.
2. Disabled user returns generic invalid result.
3. Principal uses stable ID, not display name.
4. Groups are coarse container groups.
5. Password verification is delegated.
6. Repository is delegated.
7. Group resolution is delegated.
8. Audit should be handled consistently, not scattered.

### 14.3 Do Not Leak Validation Reason

Authentication result visible to caller should not reveal:

```text
user does not exist
user disabled
password expired
MFA disabled
account locked due to admin action
```

Internally, audit can record reason codes.

Externally, use generic response:

```text
Invalid username or password.
```

### 14.4 Reason Codes for Audit

Internally store:

```text
AUTH_SUCCESS
AUTH_FAILED_UNKNOWN_USER
AUTH_FAILED_BAD_PASSWORD
AUTH_FAILED_DISABLED_USER
AUTH_FAILED_LOCKED_USER
AUTH_FAILED_PASSWORD_EXPIRED
AUTH_FAILED_MFA_REQUIRED
AUTH_FAILED_MFA_INVALID
AUTH_FAILED_TENANT_DISABLED
```

This is useful for investigation, but must not become user-facing enumeration.

---

## 15. Implementing a Custom `HttpAuthenticationMechanism` Properly

A mechanism should be a protocol boundary.

### 15.1 Responsibilities

It should:

1. extract credential from request,
2. validate format,
3. call identity validation,
4. handle challenge/redirect/401,
5. notify container on success,
6. avoid application-specific domain decisions.

### 15.2 Form Login Mechanism Flow

```text
GET /protected
        ↓
no session/principal
        ↓
redirect to /login
        ↓
POST /login with username/password
        ↓
validate credential
        ↓
rotate session
        ↓
notify container login
        ↓
redirect to original URL
```

### 15.3 Bearer Token Mechanism Flow

```text
GET /api/cases
Authorization: Bearer token
        ↓
parse token
        ↓
validate token signature/introspection/audience/issuer/expiry
        ↓
map subject/groups
        ↓
notify container login
        ↓
resource method executes
```

### 15.4 Client Certificate Mechanism Flow

```text
TLS handshake authenticates client certificate
        ↓
container exposes certificate
        ↓
mechanism maps certificate fingerprint/SAN to principal
        ↓
notify container login
        ↓
resource executes
```

### 15.5 Challenge Design

Different mechanisms challenge differently:

| Mechanism | Challenge |
|---|---|
| Basic | `WWW-Authenticate: Basic realm=...` |
| Bearer | `WWW-Authenticate: Bearer error=...` |
| Form | redirect to login page |
| OIDC | redirect to authorization endpoint |
| mTLS | TLS-level certificate request |
| HMAC | 401 with signature scheme error |

Do not return the wrong challenge for the endpoint type.

Bad:

```text
Browser user visiting /app gets JSON 401.
API client calling /api gets HTML login page.
```

Better:

```text
/app/** -> browser redirect challenge
/api/** -> 401 JSON / WWW-Authenticate
```

---

## 16. CDI and Authentication Components

Jakarta Security integrates with CDI.

This means security components can be beans:

```java
@ApplicationScoped
public class MyIdentityStore implements IdentityStore { ... }
```

### 16.1 Why CDI Matters

CDI allows injection of:

- repositories,
- password verifiers,
- token validators,
- audit services,
- tenant resolvers,
- configuration,
- metrics,
- clock,
- HTTP clients.

### 16.2 Avoid Heavy Constructor Work

Authentication components may be initialized early.

Avoid:

- network calls in constructor,
- loading huge key material synchronously without lifecycle management,
- starting threads inside beans,
- static global state,
- mutable non-thread-safe fields.

### 16.3 Thread Safety

Authentication mechanisms and identity stores may be used concurrently.

Design as:

```text
stateless or immutable where possible
thread-safe collaborators
no request-specific mutable fields
request data stays in method local variables
```

Bad:

```java
@ApplicationScoped
public class BadMechanism implements HttpAuthenticationMechanism {
    private String currentUser;
}
```

Good:

```java
String currentUser = extractUser(request);
```

### 16.4 Scoped Dependencies

Be careful injecting request-scoped objects into application-scoped authentication beans.

If needed, use proper CDI proxies and understand runtime behavior.

---

## 17. State, Session, and Jakarta Security

Jakarta Security mechanisms may interact with sessions depending on mechanism.

### 17.1 Stateful Mechanisms

Form login usually creates or uses session state:

```text
JSESSIONID -> container authenticated session
```

### 17.2 Stateless Mechanisms

Bearer token validation may avoid server-side session:

```text
Every request authenticates token independently
```

### 17.3 Hybrid Mechanisms

OIDC browser login is often hybrid:

```text
OIDC tokens used during login
        ↓
container/application session established
        ↓
subsequent browser requests use session cookie
```

This is normal.

Do not assume OIDC browser login means every request must carry access token.

### 17.4 Session Fixation

On successful login, rotate session ID.

```text
anonymous session id A
        ↓ login succeeds
authenticated session id B
```

Do not continue using the same session identifier after login.

### 17.5 Logout

Logout must decide:

- local container session invalidation,
- remember-me token invalidation,
- refresh token revocation,
- IdP logout,
- downstream session cleanup,
- audit event,
- browser cookie clearing.

Jakarta Security can participate in local logout, but distributed logout is an architecture topic.

---

## 18. OIDC in Jakarta Security: Design-Level View

OIDC inside Jakarta Security is a bridge between external identity provider and Jakarta container identity.

### 18.1 OIDC Flow in Web App

```text
User requests protected URL
        ↓
Jakarta Security OIDC mechanism redirects to IdP
        ↓
User authenticates at IdP
        ↓
IdP redirects back with authorization code
        ↓
Application exchanges code for tokens
        ↓
ID token validated
        ↓
caller principal/groups established
        ↓
session created
        ↓
user returns to original URL
```

### 18.2 Important Validation

OIDC mechanism must validate:

- issuer,
- audience/client ID,
- signature,
- expiration,
- nonce,
- state,
- redirect URI,
- token endpoint response,
- algorithm,
- key ID and JWKS,
- clock skew.

### 18.3 Claim Mapping

Decide explicitly:

| Container identity field | Candidate OIDC claim |
|---|---|
| principal | `sub` preferred |
| display name | `name` |
| login hint/email | `email` |
| groups | `groups`, `roles`, custom claim |
| tenant | issuer/claim/domain mapping |
| auth strength | `acr`, `amr` |

### 18.4 Avoid Email as Principal

OIDC `email` is useful but usually not ideal as canonical principal.

Reasons:

- email may change,
- email may be unverified,
- email uniqueness depends on issuer,
- same email can exist across tenants/issuers,
- account linking can become ambiguous.

Prefer:

```text
issuer + subject
```

Example:

```text
https://login.example.gov/realms/cea|248289761001
```

### 18.5 First Login Flow

After OIDC authentication, local application may need provisioning:

```text
OIDC subject valid
        ↓
find local account link
        ↓
if none, run first-login policy
        ↓
create/link local domain actor
        ↓
assign default roles or require admin approval
```

This is not merely authentication. It is identity lifecycle management.

---

## 19. Multi-Mechanism Architecture

Jakarta Security 4.0's multiple mechanism support is useful, but multi-mechanism design needs discipline.

### 19.1 Example Application

```text
/app/**
  browser OIDC login

/api/internal/**
  mTLS or internal bearer token

/api/partner/**
  HMAC request signing

/api/public/**
  optional anonymous + optional bearer

/admin/**
  OIDC + MFA/step-up
```

### 19.2 Mechanism Selection Criteria

Select mechanism by:

- path,
- host,
- port,
- scheme,
- request header,
- content type,
- client type,
- tenant,
- deployment zone,
- endpoint sensitivity.

### 19.3 Avoid Weak Fallback

Bad:

```text
If bearer token invalid, try session.
If session invalid, try API key.
If API key missing, allow anonymous.
```

This creates downgrade/fallback risk.

Better:

```text
For each endpoint, define one primary mechanism or a strict ordered policy.
Invalid credential fails hard.
Missing credential may only be anonymous if endpoint explicitly permits anonymous.
```

### 19.4 Challenge Consistency

Each protected endpoint should have predictable challenge behavior.

| Endpoint | Missing credential | Invalid credential |
|---|---|---|
| `/app/**` | redirect to login | redirect/error page |
| `/api/**` | 401 JSON | 401 JSON |
| `/partner/**` | 401 signature challenge | 401/403 with generic error |
| `/admin/**` | redirect to IdP | deny or step-up |

---

## 20. Authentication and JAX-RS

Jakarta Security identity should propagate into JAX-RS resources.

Example:

```java
@Path("/cases")
public class CaseResource {

    @Inject
    SecurityContext jakartaSecurityContext;

    @GET
    public Response list() {
        Principal caller = jakartaSecurityContext.getCallerPrincipal();
        ...
    }
}
```

JAX-RS also has its own `jakarta.ws.rs.core.SecurityContext` injectable through `@Context`.

Be careful not to confuse:

```text
jakarta.security.enterprise.SecurityContext
```

with:

```text
jakarta.ws.rs.core.SecurityContext
```

Both may expose caller information, but they belong to different API layers.

### 20.1 Recommended Rule

Use one canonical security context abstraction in application services.

Example:

```java
public interface CurrentActor {
    ActorId actorId();
    PrincipalName principalName();
    Set<String> groups();
    TenantId tenantId();
}
```

Adapters can read from Jakarta Security/JAX-RS/Servlet, but domain services depend on `CurrentActor`.

### 20.2 Why

This prevents Jakarta API from leaking into all business logic and makes testing easier.

---

## 21. Authentication and EJB / Method Security

Jakarta EE applications may use method-level security:

```java
@RolesAllowed("CASE_OFFICER")
public CaseDetails getCase(...) { ... }
```

### 21.1 Caller Propagation

If authentication is properly established at container level, EJB method security can enforce roles based on caller identity.

If you only use custom request attributes, EJB method security may not work.

### 21.2 Coarse vs Fine Checks

Use method-level role check for coarse boundaries:

```text
Only case officers can enter case service.
```

Then do domain checks:

```text
This officer can view this case because assigned team/agency/status allows it.
```

### 21.3 Audit

For enterprise systems, method-level security failure should be audit-relevant:

```text
principal
method
role required
resource context if available
time
correlation id
request id
```

---

## 22. Authentication and Jakarta Faces / Server-Side UI

For JSF/Jakarta Faces-style applications, Jakarta Security can integrate with form login and server-side sessions.

### 22.1 UI Concerns

Authentication flow must manage:

- login page rendering,
- original URL preservation,
- validation errors,
- CSRF token,
- session rotation,
- flash messages,
- post-login redirect,
- logout redirect,
- session timeout view.

### 22.2 Do Not Put Authentication Logic in Backing Bean Only

Bad:

```java
public String login() {
    if (userService.check(username, password)) {
        session.setAttribute("user", user);
        return "home";
    }
    return "login";
}
```

Problems:

- container not notified,
- roles not propagated,
- security constraints not integrated,
- method security not aware,
- inconsistent logout.

Better:

```text
Faces page collects credential
Jakarta Security mechanism validates and notifies container
Application reads caller from SecurityContext
```

---

## 23. Authentication in Modular/Multi-App Jakarta EE Deployments

Enterprise servers may host multiple applications.

Questions:

1. Does each WAR define its own mechanism?
2. Does an EAR share security components?
3. Are sessions shared or separate?
4. Are roles global or app-specific?
5. Is SSO handled by container, reverse proxy, or IdP?
6. Do apps trust each other's session?
7. Is logout local or global?

### 23.1 Avoid Accidental SSO

If two apps share a domain cookie or container SSO valve/feature, user identity may propagate unexpectedly.

Define:

```text
App A session != App B session unless explicitly designed
```

### 23.2 Principal Consistency

Across applications, use consistent principal mapping.

Bad:

```text
App A principal = email
App B principal = employee number
App C principal = display name
```

Better:

```text
All apps principal = issuer + subject or enterprise immutable ID
```

---

## 24. Deployment Runtime Differences

Jakarta specifications define contracts, but behavior can vary across runtimes.

Common runtimes:

- GlassFish,
- Payara,
- WildFly / JBoss EAP,
- Open Liberty,
- WebLogic,
- TomEE,
- Tomcat + supporting libraries,
- Jetty with Jakarta Authentication support.

### 24.1 Differences to Test

Test these explicitly:

1. When mechanism is invoked.
2. How public vs protected resources behave.
3. Session creation behavior.
4. Role mapping behavior.
5. Programmatic logout behavior.
6. Error page behavior.
7. CDI injection into security components.
8. Multiple mechanisms ordering.
9. OIDC logout behavior.
10. Interaction with reverse proxy headers.

### 24.2 Portable Does Not Mean Identical Operational Behavior

A spec can standardize API but not every operational edge.

For top-tier engineering, write conformance-style tests for your chosen runtime.

---

## 25. Java 8 to Java 25 Relevance

Jakarta Security is part of Jakarta EE evolution, while Java SE versions affect runtime capabilities.

### 25.1 Java 8 Era

Typical environment:

- Java EE 7/8,
- Servlet 3.x/4.x,
- JAAS/container realms,
- vendor-specific security,
- early Java EE Security API in Java EE 8,
- many apps still use custom filters or Spring Security.

### 25.2 Java 11/17 Era

Typical environment:

- Jakarta namespace transition begins after Java EE,
- application servers modernize,
- OIDC/SAML external IdP integration becomes common,
- Spring Boot and Quarkus/MicroProfile grow,
- TLS/key handling moves toward stronger defaults.

### 25.3 Java 21/25 Era

Typical environment:

- Jakarta EE 10/11,
- modern containers,
- virtual threads influence context propagation thinking,
- stronger key management expectations,
- cloud-native deployment,
- external IdP as default enterprise pattern,
- mTLS/workload identity/service mesh integration.

### 25.4 Important Compatibility Point

Java version and Jakarta version are related but not identical.

You can have:

```text
Java 17 runtime + Jakarta EE 10 container
Java 21 runtime + Jakarta EE 10/11 container
Java 8 runtime + older Java EE 8 container
```

Always check:

- application server version,
- supported Jakarta EE version,
- namespace: `javax.*` vs `jakarta.*`,
- Security API version,
- Authentication version,
- CDI version,
- Servlet version.

---

## 26. Common Architecture Patterns

### 26.1 Traditional Jakarta Web App with Local Users

```text
Browser
  ↓ username/password
Jakarta Security Form Mechanism
  ↓
Database IdentityStore
  ↓
Container session
  ↓
SecurityContext / @RolesAllowed
```

Good for:

- internal apps,
- small enterprise apps,
- apps with local user ownership.

Weakness:

- app owns password risk,
- MFA harder,
- SSO absent unless added,
- identity lifecycle burden.

### 26.2 Jakarta Web App with Enterprise LDAP

```text
Browser
  ↓ username/password
Form/Basic mechanism
  ↓
LDAP IdentityStore
  ↓
Groups mapped to roles
  ↓
Container session
```

Good for:

- internal enterprise directory integration.

Weakness:

- directory outage impacts login,
- group complexity,
- password still passes through app unless using federated flow.

### 26.3 Jakarta Web App with OIDC

```text
Browser
  ↓ protected URL
OIDC mechanism
  ↓ redirect
External IdP
  ↓ code callback
OIDC token validation
  ↓
Container caller identity
  ↓
Application session
```

Good for:

- SSO,
- MFA at IdP,
- centralized identity lifecycle,
- modern enterprise login.

Weakness:

- IdP dependency,
- claim mapping complexity,
- logout complexity,
- account linking complexity.

### 26.4 Jakarta REST API with Bearer Token

```text
API Client
  ↓ Authorization: Bearer token
HttpAuthenticationMechanism
  ↓
JWT validator or introspection IdentityStore
  ↓
Container principal/groups
  ↓
JAX-RS resource
```

Good for:

- REST APIs,
- service integration,
- OAuth2 resource server patterns.

Weakness:

- revocation/cache trade-off,
- token audience mistakes,
- role/scope confusion.

### 26.5 Jakarta App Behind Gateway Authentication

```text
Browser/API Client
  ↓
Gateway authenticates
  ↓ injects signed headers / forwards token
Jakarta mechanism validates gateway assertion
  ↓
Container identity
```

Good for:

- centralized enterprise authentication,
- shared SSO,
- edge security.

Weakness:

- header spoofing if network boundary weak,
- gateway becomes trust root,
- downstream apps may skip validation,
- audit depends on propagated identity integrity.

---

## 27. Failure Modes

### 27.1 Identity Not Propagated to Container

Symptom:

```text
Login seems successful, but @RolesAllowed fails.
```

Cause:

```text
Application stored user in session/request but did not notify container.
```

Fix:

```text
Use Jakarta Security mechanism/container login properly.
```

### 27.2 Different Identity Views

Symptom:

```text
request.getUserPrincipal() says Alice
custom CurrentUser says Bob
SecurityContext says anonymous
```

Cause:

```text
multiple security mechanisms or custom filters conflict.
```

Fix:

```text
single source of truth for authenticated caller.
```

### 27.3 Group Explosion

Symptom:

```text
Token/session contains hundreds of groups; authorization becomes slow and brittle.
```

Cause:

```text
all external groups mapped directly into app role checks.
```

Fix:

```text
normalize groups into coarse roles, evaluate fine permissions separately.
```

### 27.4 Optional Auth Bypass

Symptom:

```text
Invalid token treated as anonymous; endpoint returns data.
```

Cause:

```text
mechanism ignores invalid credential on public-ish endpoint.
```

Fix:

```text
missing credential may be anonymous; invalid credential should usually fail.
```

### 27.5 Login Loop

Symptom:

```text
User authenticates but is redirected back to login repeatedly.
```

Causes:

- session not established,
- SameSite cookie issue,
- wrong redirect URI,
- HTTPS/HTTP mismatch,
- reverse proxy header issue,
- container security context not set,
- role constraint fails after login,
- clock skew in OIDC.

### 27.6 Principal Reassignment Bug

Symptom:

```text
Old audit records now appear to belong to a different person.
```

Cause:

```text
principal name uses mutable/recycled username or email.
```

Fix:

```text
use immutable subject ID.
```

### 27.7 Authentication Component Holds Request State

Symptom:

```text
Occasional user mix-up under concurrency.
```

Cause:

```text
@ApplicationScoped mechanism stores request-specific state in fields.
```

Fix:

```text
stateless mechanism; request state only in method locals.
```

### 27.8 Runtime-Specific Behavior Not Tested

Symptom:

```text
Works on Payara, fails on WildFly/Open Liberty/WebLogic.
```

Cause:

```text
assuming every container behaves identically at operational edges.
```

Fix:

```text
container-specific integration tests and deployment documentation.
```

---

## 28. Security Risks

### 28.1 Authentication Confusion

Multiple mechanisms can create confusion:

```text
Did this caller authenticate via session, bearer token, mTLS, or gateway header?
```

Always record mechanism in audit.

```text
auth_mechanism = OIDC_BROWSER_SESSION
```

### 28.2 Downgrade to Weaker Mechanism

A request should not silently fall back from strong to weak authentication.

Example bad path:

```text
mTLS missing -> accept API key
API key missing -> accept session
session missing -> anonymous
```

Define explicit policy.

### 28.3 Header Trust Abuse

If app trusts headers like:

```text
X-User: alice
X-Groups: admin
```

without cryptographic validation or strict network control, attacker can spoof identity.

If gateway-propagated identity is used:

- strip incoming identity headers at edge,
- use mTLS between gateway and app,
- sign identity headers or pass validated token,
- validate issuer/audience,
- audit gateway identity.

### 28.4 Role Injection

If groups come from user-controlled token/header without validation, attacker can add admin role.

Always validate:

- token signature,
- issuer,
- audience,
- claim source,
- trusted mapping,
- tenant boundary.

### 28.5 Account Linking Attack

OIDC first-login flow can accidentally link attacker to existing local account if based only on email.

Safer linking requires:

- verified email when used,
- issuer + subject,
- explicit admin/user confirmation for risky links,
- no automatic link across untrusted issuers,
- audit record.

### 28.6 Misleading Success

Authentication success does not mean user is active in application domain.

Example:

```text
IdP authenticates user successfully,
but local employment/agency membership is revoked.
```

Application should check local entitlement/active status after authentication.

---

## 29. Production Checklist

### 29.1 Mechanism Checklist

- [ ] Each endpoint has explicit authentication policy.
- [ ] Missing credential behavior is defined.
- [ ] Invalid credential behavior is defined.
- [ ] Challenge response matches client type.
- [ ] Mechanism does not store request state in shared fields.
- [ ] Mechanism notifies container on successful login.
- [ ] Authentication mechanism is logged in audit.
- [ ] Public endpoints are intentionally public.
- [ ] Optional auth does not ignore invalid credentials unsafely.
- [ ] Multiple mechanisms have deterministic ordering.

### 29.2 Identity Store Checklist

- [ ] Principal is stable and non-recycled.
- [ ] Credential validation is constant-ish time where relevant.
- [ ] Unknown/disabled/bad password do not leak to caller.
- [ ] Groups are coarse and bounded.
- [ ] Tenant boundary is enforced.
- [ ] Identity store timeouts are configured.
- [ ] Remote store uses circuit breaker/bulkhead.
- [ ] Cache TTL is safe.
- [ ] Audit reason codes are internal only.
- [ ] Password/token/cert validation is delegated to specialized component.

### 29.3 Container Integration Checklist

- [ ] `SecurityContext` returns expected principal.
- [ ] `request.getUserPrincipal()` matches expected principal.
- [ ] `isUserInRole` works.
- [ ] `@RolesAllowed` works where used.
- [ ] logout clears local session.
- [ ] session rotates after login.
- [ ] error pages do not leak sensitive reason.
- [ ] reverse proxy headers are handled correctly.
- [ ] HTTPS scheme is recognized behind proxy.
- [ ] deployment runtime behavior is tested.

### 29.4 OIDC Checklist

- [ ] issuer validated.
- [ ] audience/client ID validated.
- [ ] signature validated.
- [ ] expiration validated.
- [ ] nonce/state validated.
- [ ] redirect URI fixed/allowlisted.
- [ ] principal mapping uses issuer + subject.
- [ ] groups/roles mapping is explicit.
- [ ] first-login flow is safe.
- [ ] logout behavior documented.

### 29.5 Audit Checklist

- [ ] login success recorded.
- [ ] login failure recorded with internal reason.
- [ ] principal ID recorded.
- [ ] mechanism recorded.
- [ ] issuer/client/tenant recorded where relevant.
- [ ] correlation ID recorded.
- [ ] source IP/user-agent recorded safely.
- [ ] no secret/token/password logged.
- [ ] role/group mapping result traceable.
- [ ] admin/account linking events recorded.

---

## 30. Common Mistakes

### Mistake 1 — Treating Jakarta Security as a Full IAM Product

Jakarta Security is not an IAM platform.

It does not replace:

- user lifecycle management,
- enterprise IdP,
- MFA policy,
- risk engine,
- identity governance,
- access review,
- privileged access management.

It is an application/container security API.

### Mistake 2 — Putting Domain Authorization in Identity Store

Bad:

```text
IdentityStore.validate decides whether user can approve case.
```

Better:

```text
IdentityStore validates caller and groups.
Domain policy decides case approval.
```

### Mistake 3 — Returning Display Name as Principal

Bad:

```text
principal = "Fajar Abdi Nugraha"
```

Better:

```text
principal = "oidc:https://idp.example.com:sub:abc123"
```

### Mistake 4 — Trusting Gateway Headers Blindly

Never trust identity headers unless they are protected by deployment architecture and/or cryptographic validation.

### Mistake 5 — Ignoring Logout Semantics

Login is only half of authentication lifecycle.

Logout must handle:

- local session,
- IdP session,
- refresh token,
- remember-me,
- browser cookies,
- server-side caches.

### Mistake 6 — Assuming Role Equals Permission

Container roles are coarse.

Complex business authorization still needs domain policy.

### Mistake 7 — Not Testing the Actual Runtime

Jakarta portability helps, but production behavior depends on chosen runtime.

Test against the actual server.

### Mistake 8 — Multiple Mechanisms Without Explicit Policy

Multiple mechanisms are powerful but dangerous if fallback is unclear.

### Mistake 9 — Logging Token or Password

Authentication debugging often tempts engineers to log secrets.

Never log:

- password,
- bearer token,
- refresh token,
- authorization code,
- client secret,
- private key,
- full session ID.

### Mistake 10 — Treating Successful IdP Login as Local Access Approval

External authentication proves identity. It does not automatically mean the caller is active, entitled, assigned, or approved inside your application.

---

## 31. Design Decision Framework

When designing Jakarta authentication, ask these questions in order.

### 31.1 Actor

```text
Who is authenticating?
```

Options:

- browser human,
- API client,
- service account,
- batch job,
- admin,
- external partner,
- gateway,
- internal service.

### 31.2 Boundary

```text
Where is the trust boundary?
```

Options:

- browser to app,
- app to IdP,
- gateway to app,
- service to service,
- app to directory,
- TLS termination point.

### 31.3 Proof

```text
What proof is presented?
```

Options:

- password,
- session cookie,
- bearer token,
- authorization code,
- client certificate,
- signed request,
- Kerberos ticket,
- passkey assertion.

### 31.4 Mechanism

```text
Which component validates the proof?
```

Options:

- Servlet built-in auth,
- Jakarta Security mechanism,
- Jakarta Authentication module,
- Spring Security filter,
- gateway,
- IdP,
- service mesh.

### 31.5 Identity Store

```text
Where is caller data validated or looked up?
```

Options:

- database,
- LDAP,
- IdP,
- JWKS,
- introspection endpoint,
- certificate registry,
- API key table,
- domain user service.

### 31.6 Principal

```text
What stable identity is established?
```

Avoid mutable identifiers.

### 31.7 Groups/Roles

```text
Which coarse groups are propagated to container?
```

Keep bounded.

### 31.8 Domain Access

```text
Which authorization decisions remain outside authentication?
```

Usually most domain decisions.

### 31.9 State

```text
Is authentication stateful, stateless, or hybrid?
```

Define session/token lifecycle.

### 31.10 Failure

```text
What happens when validation store or IdP is down?
```

Define fail-closed, degraded mode, cache behavior, and incident process.

---

## 32. Reference Architecture: Jakarta EE Regulatory Case System

Imagine a regulatory case management application:

- officers login through enterprise SSO,
- internal APIs are called by batch jobs,
- external partners submit documents,
- admin users need stronger authentication,
- audit must be defensible.

### 32.1 Recommended Authentication Model

```text
Browser officer UI:
  OIDC via Jakarta Security
  principal = issuer + sub
  local domain actor linked by immutable account link
  session cookie after login

Internal service API:
  mTLS or client credentials token
  service principal, not human principal

Partner callback:
  HMAC request signing or mTLS
  partner principal mapped to organization

Admin console:
  OIDC + MFA/step-up claim requirement

Domain authorization:
  application policy engine checks case assignment, agency, status, delegation
```

### 32.2 Audit Model

Every authentication event records:

```text
event_type
timestamp
correlation_id
mechanism
principal
issuer
client_id
tenant/agency
source_ip
user_agent_hash or normalized user agent
result
reason_code_internal
session_id_hash
```

### 32.3 Why This Is Strong

Because it separates:

| Concern | Owner |
|---|---|
| Human authentication | IdP/OIDC |
| Container identity | Jakarta Security |
| Domain actor mapping | application identity service |
| API service identity | mTLS/OAuth client credentials |
| Partner proof | HMAC/mTLS |
| Fine authorization | domain policy |
| Audit | centralized audit service |

This is more defensible than one giant custom login filter.

---

## 33. Testing Strategy

### 33.1 Unit Tests

Test identity store:

- valid credential,
- invalid password,
- unknown user,
- disabled user,
- locked user,
- expired password,
- group mapping,
- tenant boundary,
- timeout behavior.

### 33.2 Integration Tests

Test mechanism/container behavior:

- protected endpoint without credential,
- protected endpoint with valid credential,
- protected endpoint with invalid credential,
- public endpoint without credential,
- public endpoint with invalid credential,
- role allowed,
- role denied,
- logout,
- session rotation,
- challenge response.

### 33.3 Runtime Tests

Run tests on target container:

- Payara/GlassFish,
- WildFly,
- Open Liberty,
- WebLogic,
- Tomcat/Jetty if applicable.

### 33.4 Security Regression Tests

Include:

- session fixation,
- CSRF login path,
- open redirect after login,
- invalid token on optional endpoint,
- wrong issuer token,
- wrong audience token,
- expired token,
- group injection claim,
- missing nonce/state for OIDC,
- spoofed gateway header.

---

## 34. Operational Runbook

### 34.1 Login Failure Spike

Check:

1. IdP health.
2. LDAP/database health.
3. application error rate.
4. recent deployment.
5. certificate/key rotation.
6. clock skew.
7. redirect URI config.
8. session store health.
9. WAF/proxy behavior.
10. audit reason code distribution.

### 34.2 Login Loop

Check:

1. cookie domain/path.
2. SameSite behavior.
3. HTTPS scheme behind proxy.
4. session persistence.
5. container principal set.
6. role constraint after login.
7. OIDC state/nonce validation.
8. callback URL.
9. load balancer stickiness if stateful.
10. clock skew.

### 34.3 Sudden Authorization Denials

Check:

1. group claim changed.
2. role mapping changed.
3. LDAP nested group lookup failed.
4. IdP token scope changed.
5. app deployment changed role names.
6. cache stale/expired.
7. tenant mapping broken.
8. external account disabled.
9. domain actor link missing.
10. case assignment policy changed.

### 34.4 Suspected Account Compromise

Actions:

1. revoke local sessions.
2. revoke refresh tokens if applicable.
3. disable or force reset at IdP/local store.
4. invalidate remember-me credentials.
5. inspect recent authentication events.
6. inspect mechanism and source IP changes.
7. inspect domain actions after login.
8. rotate affected API keys/secrets.
9. preserve forensic logs.
10. document incident timeline.

---

## 35. Summary Mental Model

Jakarta Security and Jakarta Authentication are not interchangeable names.

The clean model:

```text
Servlet Security
  protects web resources and exposes principal/roles.

Jakarta Security
  gives application developers portable authentication mechanisms,
  identity stores, and programmatic security context.

Jakarta Authentication
  gives runtime/security providers a lower-level SPI to integrate
  authentication modules with container message processing.
```

The most important engineering insight:

> Authentication is not complete when credentials are checked. It is complete only when a stable identity is established, safely propagated, consistently visible to the container/application, bounded by explicit trust policy, and auditable under failure and attack.

For Jakarta applications, this means:

1. choose the right layer,
2. keep mechanism and identity validation separate,
3. use stable principal names,
4. keep groups coarse,
5. avoid custom request-only identity,
6. notify the container properly,
7. test the actual runtime,
8. treat OIDC/LDAP/gateway integrations as trust boundaries,
9. record audit-relevant authentication metadata,
10. keep domain authorization separate from authentication.

---

## 36. Self-Assessment Questions

Use these to test whether you really understand this part.

1. What is the difference between Servlet security, Jakarta Security, and Jakarta Authentication?
2. Why is `HttpAuthenticationMechanism` usually easier than `ServerAuthModule`?
3. What should an `IdentityStore` validate?
4. Why should principal not be a display name?
5. What is the difference between group, role, and permission?
6. Why is storing `user` in session not equivalent to container authentication?
7. How can optional authentication become a bypass?
8. What should happen when a public endpoint receives an invalid token?
9. Why is OIDC login not the same as local application access approval?
10. What should be logged for authentication audit without leaking secrets?
11. What runtime-specific behavior should be tested?
12. How would you integrate gateway-authenticated identity safely?
13. When would you use Jakarta Authentication instead of Jakarta Security?
14. How would you design principal mapping for multi-tenant OIDC?
15. What is the danger of mapping all IdP groups directly into container roles?

---

## 37. Practical Exercises

### Exercise 1 — Draw Your Current Application's Authentication Stack

Draw:

```text
client -> proxy/gateway -> container -> framework -> resource -> service
```

Mark where authentication happens and where identity is propagated.

### Exercise 2 — Principal Mapping Table

Create a table:

| Source | Source Identifier | Local Principal | Domain Actor | Risk |
|---|---|---|---|---|
| OIDC | issuer+sub | ? | ? | ? |
| LDAP | objectGUID | ? | ? | ? |
| API key | key ID | ? | ? | ? |
| mTLS | certificate fingerprint | ? | ? | ? |

### Exercise 3 — Optional Authentication Policy

For each endpoint, define:

| Endpoint | Missing Credential | Invalid Credential | Valid Credential |
|---|---|---|---|
| `/public/news` | allow anonymous | reject or anonymous? | personalized |
| `/api/cases` | 401 | 401 | allow |
| `/admin` | redirect | deny | allow if role |

### Exercise 4 — Runtime Conformance Test

Write integration tests proving:

- `SecurityContext` principal exists after login,
- `request.getUserPrincipal()` matches,
- `@RolesAllowed` works,
- logout invalidates session,
- invalid credential fails.

---

## 38. References

- Jakarta Security 4.0 Specification — https://jakarta.ee/specifications/security/4.0/jakarta-security-spec-4.0
- Jakarta Security 4.0 Release Page — https://jakarta.ee/specifications/security/4.0/
- Jakarta Authentication 3.1 Specification — https://jakarta.ee/specifications/authentication/3.1/jakarta-authentication-spec-3.1
- Jakarta Authentication 3.1 Release Page — https://jakarta.ee/specifications/authentication/3.1/
- Jakarta EE Tutorial: Security — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security.html
- Jakarta EE Tutorial: Security API — https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security-api/security-api.html
- Jakarta EE Specification Guide: Security, Authorization, and Authentication Explained — https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/
- Jakarta Security Enterprise API Javadocs — https://javadoc.io/doc/jakarta.security.enterprise/jakarta.security.enterprise-api/latest/
- Jakarta Authentication API Javadocs — https://javadoc.io/doc/jakarta.security.auth.message/jakarta.security.auth.message-api/latest/
- Oracle WebLogic: Using Jakarta Security — https://docs.oracle.com/en/middleware/standalone/weblogic-server/15.1.1/scprg/sec-api.html
- Apache Tomcat Jakarta Authentication / JASPIC Docs — https://tomcat.apache.org/tomcat-11.0-doc/config/jaspic.html

---

## 39. Status Series

- Part 0 — selesai.
- Part 1 — selesai.
- Part 2 — selesai.
- Part 3 — selesai.
- Part 4 — selesai.
- Part 5 — selesai.
- Part 6 — selesai.
- Series belum selesai.

Part berikutnya:

> **Part 7 — Spring Security Authentication Architecture**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-005.md">⬅️ Part 5 — Servlet Container Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-007.md">Part 7 — Spring Security Authentication Architecture ➡️</a>
</div>
