# Part 30 — Migration Guide: Java EE `javax` Security to Jakarta `jakarta` Security

> Seri: `learn-java-jakarta-security-authentication-authorization-identity`  
> File: `learn-java-jakarta-security-authentication-authorization-identity-part-30-migration-javax-to-jakarta-security.md`  
> Scope: Java 8 sampai Java 25, Java EE 8 / Jakarta EE 8 sampai Jakarta EE 11+, aplikasi Servlet/JAX-RS/CDI/EJB/Jakarta Security/Jakarta Authentication/Jakarta Authorization, dan sistem enterprise yang membutuhkan behavior-preserving migration.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membangun mental model dari identity, principal, role, permission, Jakarta Security API, Servlet security, Jakarta Authentication/JASPIC, Jakarta Authorization/JACC, OIDC, SAML, mTLS, method security, context propagation, multi-tenancy, domain authorization, gateway boundary, browser security, error handling, audit, dan testing.

Part ini menjawab pertanyaan praktis:

> “Bagaimana memigrasikan aplikasi enterprise Java security dari `javax.*` ke `jakarta.*` tanpa diam-diam mengubah behavior authentication, authorization, session, role mapping, filter chain, descriptor, deployment, dan audit?”

Migrasi `javax` ke `jakarta` sering terlihat seperti pekerjaan rename package. Itu asumsi yang terlalu dangkal.

Untuk aplikasi CRUD sederhana, mungkin cukup mengganti import dan dependency. Untuk aplikasi enterprise yang memakai container security, JAX-RS, Servlet filter, CDI/EJB method security, JAAS/JASPIC/JACC, custom realm, OIDC/SAML gateway, audit trail, dan role mapping, migrasi adalah **security behavior migration**.

Target part ini bukan hanya membuat aplikasi compile, tetapi memastikan:

1. endpoint yang sebelumnya protected tetap protected,
2. endpoint public tetap public hanya jika memang intentional,
3. role mapping tidak berubah diam-diam,
4. `Principal` dan groups tetap sampai ke container,
5. `@RolesAllowed` tetap dievaluasi,
6. session/logout tetap benar,
7. filter/interceptor order tetap aman,
8. token/OIDC/SAML/mTLS integration tetap valid,
9. audit tetap menangkap actor yang sama,
10. deployment baru tidak membuka bypass.

---

## 1. Core Mental Model: Migration Is Not Rename, It Is Contract Preservation

Migrasi namespace terjadi karena Java EE berpindah ke Eclipse Foundation/Jakarta EE. Jakarta EE 8 masih memakai namespace `javax.*`, sedangkan Jakarta EE 9 memperkenalkan namespace `jakarta.*` untuk spesifikasi Jakarta EE. Efeknya besar: kode sumber, dependency, descriptor, container, third-party library, dan generated code bisa ikut terdampak.

Dalam security, yang harus dipertahankan bukan hanya API shape, tetapi kontrak berikut:

```text
incoming request
  -> transport/security headers preserved
  -> authentication mechanism still runs
  -> credential/token/session/cert still recognized
  -> caller principal established
  -> groups/roles established
  -> URL/method/domain authorization still enforced
  -> correct 401/403 behavior
  -> audit event still records actor/action/resource/outcome
```

Jika hanya compile tetapi salah satu kontrak di atas rusak, migrasi gagal secara security.

---

## 2. Java/Jakarta Version Map

### 2.1 High-Level Version Map

| Era | Platform | Namespace | Typical Java Baseline | Security Concern |
|---|---:|---:|---:|---|
| Java EE 7 | Java EE 7 | `javax.*` | Java 7/8 | Legacy container security, JAAS/JASPIC/JACC, Servlet 3.x |
| Java EE 8 | Java EE 8 | `javax.*` | Java 8 | Servlet 4, JAX-RS 2.1, CDI 2, Security API 1.0 |
| Jakarta EE 8 | Jakarta EE 8 | `javax.*` | Java 8 | Same namespace, governance changed |
| Jakarta EE 9 | Jakarta EE 9 | `jakarta.*` | Java 8+ | Big namespace switch |
| Jakarta EE 10 | Jakarta EE 10 | `jakarta.*` | Java 11+ commonly | More modern APIs, Servlet 6.0 |
| Jakarta EE 11 | Jakarta EE 11 | `jakarta.*` | Java 17+ commonly | Jakarta Security 4.0, Servlet 6.1, Authentication 3.1, Authorization 3.0 |

### 2.2 Important Consequence

There are two separate migrations that teams often conflate:

```text
Migration A:
Java EE 8 / Jakarta EE 8 `javax.*`
  -> Jakarta EE 9+ `jakarta.*`

Migration B:
Old Java runtime
  -> newer Java runtime such as 11, 17, 21, 25
```

They are related but not identical.

A codebase can be:

1. Java 8 + `javax.*`,
2. Java 17 + `javax.*`,
3. Java 17 + `jakarta.*`,
4. Java 21/25 + `jakarta.*`.

Security migration must explicitly decide which movement is happening.

---

## 3. Why Security Migration Is Riskier Than Ordinary API Migration

A normal API migration fails visibly:

```text
cannot find symbol
package javax.servlet does not exist
```

Security migration can fail invisibly:

```text
endpoint became public
@RolesAllowed no longer applied
JAX-RS filter order changed
Principal is null
groups are empty
role names changed
session logout no longer invalidates IdP session
gateway identity header is trusted from the public internet
CSRF filter no longer runs
audit records system instead of user
```

A top-tier engineer treats migration as a controlled experiment:

```text
Before:
  observed security behavior matrix

After:
  same behavior matrix, unless intentionally changed
```

---

## 4. Inventory Before Migrating

Before touching imports, build a security inventory.

### 4.1 Source-Level Inventory

Search for:

```text
javax.annotation.security.*
javax.security.enterprise.*
javax.security.auth.*
javax.security.jacc.*
javax.security.auth.message.*
javax.servlet.*
javax.ws.rs.*
javax.ejb.*
javax.interceptor.*
javax.enterprise.*
javax.inject.*
javax.validation.*
```

Security-specific annotation and API examples:

```java
import javax.annotation.security.RolesAllowed;
import javax.annotation.security.PermitAll;
import javax.annotation.security.DenyAll;
import javax.annotation.security.DeclareRoles;
import javax.annotation.security.RunAs;

import javax.security.enterprise.SecurityContext;
import javax.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import javax.security.enterprise.identitystore.IdentityStore;
import javax.security.enterprise.credential.UsernamePasswordCredential;

import javax.servlet.Filter;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.annotation.ServletSecurity;

import javax.ws.rs.container.ContainerRequestFilter;
import javax.ws.rs.core.SecurityContext;
```

Equivalent Jakarta imports:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.DenyAll;
import jakarta.annotation.security.DeclareRoles;
import jakarta.annotation.security.RunAs;

import jakarta.security.enterprise.SecurityContext;
import jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import jakarta.security.enterprise.identitystore.IdentityStore;
import jakarta.security.enterprise.credential.UsernamePasswordCredential;

import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.annotation.ServletSecurity;

import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.SecurityContext;
```

### 4.2 Descriptor Inventory

Check:

```text
web.xml
ejb-jar.xml
application.xml
beans.xml
permissions.xml
server.xml
standalone.xml
domain.xml
glassfish-web.xml
payara-web.xml
jboss-web.xml
weblogic.xml
weblogic-ejb-jar.xml
openliberty server.xml
tomcat context.xml
```

Look for:

```xml
<security-constraint>
<login-config>
<auth-method>
<realm-name>
<security-role>
<role-name>
<security-role-ref>
<run-as>
<transport-guarantee>
```

Also look for vendor-specific realm mappings.

### 4.3 Runtime Inventory

Document:

1. application server/container version,
2. Servlet version,
3. Jakarta Security version,
4. Jakarta Authentication/JASPIC support,
5. Jakarta Authorization/JACC support,
6. Java runtime version,
7. OIDC/SAML integration point,
8. reverse proxy/gateway assumptions,
9. session clustering mechanism,
10. role/group source,
11. audit implementation.

### 4.4 Endpoint Authorization Matrix

Create a matrix like:

| Endpoint | Method | Auth Required | Roles | Public? | CSRF? | Notes |
|---|---:|---:|---:|---:|---:|---|
| `/login` | GET | no | - | yes | no | login page |
| `/j_security_check` | POST | no/container | - | yes | yes/depends | form auth |
| `/admin/users` | GET | yes | `ADMIN` | no | n/a | admin |
| `/api/cases/{id}/approve` | POST | yes | `CASE_APPROVER` + domain rule | no | yes if cookie | maker-checker |
| `/health` | GET | maybe | ops/gateway | controlled | no | beware exposure |

Without this matrix, you cannot prove security migration success.

---

## 5. Namespace Migration: What Changes and What Does Not

### 5.1 What Changes

Most Jakarta EE APIs moved:

```text
javax.servlet      -> jakarta.servlet
javax.ws.rs        -> jakarta.ws.rs
javax.enterprise   -> jakarta.enterprise
javax.inject       -> jakarta.inject
javax.ejb          -> jakarta.ejb
javax.annotation   -> jakarta.annotation
javax.validation   -> jakarta.validation
javax.persistence  -> jakarta.persistence
javax.security.enterprise -> jakarta.security.enterprise
```

For this series, the most important security-related ones:

```text
javax.annotation.security       -> jakarta.annotation.security
javax.security.enterprise       -> jakarta.security.enterprise
javax.security.auth.message     -> jakarta.security.auth.message
javax.security.jacc             -> jakarta.security.jacc
javax.servlet                   -> jakarta.servlet
```

### 5.2 What Does Not Simply Change

Not all `javax` packages disappeared.

Java SE still has many `javax.*` packages, for example:

```java
javax.net.ssl.SSLContext
javax.net.ssl.KeyManagerFactory
javax.net.ssl.TrustManagerFactory
javax.crypto.Cipher
javax.security.auth.Subject
javax.security.auth.login.LoginContext
javax.security.auth.callback.CallbackHandler
```

Do not blindly rename all `javax` imports.

A dangerous migration script might break valid Java SE security imports.

Bad mechanical rule:

```text
replace "javax." with "jakarta."
```

Better rule:

```text
migrate only Jakarta EE specifications that moved namespace;
leave Java SE javax.* packages alone.
```

---

## 6. Dependency Migration

### 6.1 Maven Example: Servlet API

Before:

```xml
<dependency>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
  <version>4.0.1</version>
  <scope>provided</scope>
</dependency>
```

After:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
  <scope>provided</scope>
</dependency>
```

But do not pick versions randomly. Match your runtime container.

If deploying to a Jakarta EE 10 container, Servlet 6.0 may be the appropriate level. If deploying to Jakarta EE 11, Servlet 6.1 is relevant.

### 6.2 Maven Example: Jakarta Security

Before Java EE/Jakarta EE 8 style:

```xml
<dependency>
  <groupId>javax.security.enterprise</groupId>
  <artifactId>javax.security.enterprise-api</artifactId>
  <version>1.0</version>
  <scope>provided</scope>
</dependency>
```

After:

```xml
<dependency>
  <groupId>jakarta.security.enterprise</groupId>
  <artifactId>jakarta.security.enterprise-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

### 6.3 Maven Example: Jakarta Annotations

Before:

```xml
<dependency>
  <groupId>javax.annotation</groupId>
  <artifactId>javax.annotation-api</artifactId>
  <version>1.3.2</version>
</dependency>
```

After:

```xml
<dependency>
  <groupId>jakarta.annotation</groupId>
  <artifactId>jakarta.annotation-api</artifactId>
  <version>3.0.0</version>
</dependency>
```

### 6.4 Avoid Mixed Namespace Dependency Graphs

The most common broken state:

```text
your app imports jakarta.servlet.*
library still implements javax.servlet.Filter
container expects jakarta.servlet.Filter
```

This compiles only if both APIs exist, but the runtime type is incompatible.

The JVM sees these as different types:

```text
javax.servlet.Filter != jakarta.servlet.Filter
javax.ws.rs.container.ContainerRequestFilter != jakarta.ws.rs.container.ContainerRequestFilter
```

So a filter/provider/listener compiled against `javax` will not be recognized by a Jakarta runtime expecting `jakarta`.

---

## 7. Build Strategy: One Big Bang vs Strangler Migration

### 7.1 Big Bang Migration

Good when:

1. codebase is small or modular,
2. test coverage is strong,
3. dependencies already support Jakarta,
4. container upgrade is planned anyway,
5. deployment window allows behavior regression testing.

Bad when:

1. many legacy libraries still use `javax`,
2. custom container integrations exist,
3. app uses JASPIC/JACC/JAAS heavily,
4. security behavior is poorly documented,
5. no endpoint permission matrix exists.

### 7.2 Strangler Migration

Possible patterns:

```text
Pattern A:
old javax app remains stable
new jakarta service created beside it

Pattern B:
gateway routes selected endpoints to new Jakarta service

Pattern C:
shared IdP/SSO remains external
security contract preserved across apps

Pattern D:
migrate internal modules first, public surface last
```

Useful when you have large enterprise monoliths.

### 7.3 Dual Branch Strategy

A practical approach:

```text
main-javax
  -> production maintenance

main-jakarta
  -> migration branch

shared test suite:
  -> endpoint authorization matrix
  -> domain permission tests
  -> token validation tests
  -> session/logout tests
```

Do not let behavior drift without explicit migration notes.

---

## 8. Source Code Migration Patterns

### 8.1 Security Annotation Migration

Before:

```java
import javax.annotation.security.RolesAllowed;

@RolesAllowed("ADMIN")
public class AdminResource {
}
```

After:

```java
import jakarta.annotation.security.RolesAllowed;

@RolesAllowed("ADMIN")
public class AdminResource {
}
```

The import changed. But verify whether the runtime still applies the annotation on the target component type.

Risk:

```text
annotation exists
but container does not scan/apply it for that class
```

Especially for:

1. plain POJO,
2. CDI bean not discovered,
3. JAX-RS provider/resource registration issue,
4. self-invocation,
5. final/private method,
6. manually constructed object with `new`.

### 8.2 Servlet Filter Migration

Before:

```java
import javax.servlet.*;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class SecurityHeaderFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletResponse response = (HttpServletResponse) res;
        response.setHeader("X-Frame-Options", "DENY");
        chain.doFilter(req, res);
    }
}
```

After:

```java
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class SecurityHeaderFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletResponse response = (HttpServletResponse) res;
        response.setHeader("X-Frame-Options", "DENY");
        chain.doFilter(req, res);
    }
}
```

Check:

1. filter mapping order,
2. async support,
3. dispatcher types,
4. error dispatch behavior,
5. authentication mechanism order,
6. whether filter runs before/after container auth.

### 8.3 HttpServletRequest Security Methods

Before:

```java
import javax.servlet.http.HttpServletRequest;

Principal principal = request.getUserPrincipal();
boolean admin = request.isUserInRole("ADMIN");
request.logout();
```

After:

```java
import jakarta.servlet.http.HttpServletRequest;

Principal principal = request.getUserPrincipal();
boolean admin = request.isUserInRole("ADMIN");
request.logout();
```

Same method names, different package.

But verify behavior:

```text
Does getUserPrincipal return same principal type?
Does isUserInRole still use same role mapping?
Does logout invalidate same session?
Does logout notify OIDC/SAML IdP?
```

### 8.4 Jakarta SecurityContext Migration

Before:

```java
import javax.inject.Inject;
import javax.security.enterprise.SecurityContext;

public class CurrentUser {
    @Inject
    SecurityContext securityContext;
}
```

After:

```java
import jakarta.inject.Inject;
import jakarta.security.enterprise.SecurityContext;

public class CurrentUser {
    @Inject
    SecurityContext securityContext;
}
```

Important: do not confuse:

```java
jakarta.security.enterprise.SecurityContext
```

with:

```java
jakarta.ws.rs.core.SecurityContext
```

They serve related but different layers.

### 8.5 IdentityStore Migration

Before:

```java
import javax.security.enterprise.identitystore.IdentityStore;
import javax.security.enterprise.credential.Credential;
import javax.security.enterprise.identitystore.CredentialValidationResult;

public class DatabaseIdentityStore implements IdentityStore {
    @Override
    public CredentialValidationResult validate(Credential credential) {
        // ...
    }
}
```

After:

```java
import jakarta.security.enterprise.identitystore.IdentityStore;
import jakarta.security.enterprise.credential.Credential;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;

public class DatabaseIdentityStore implements IdentityStore {
    @Override
    public CredentialValidationResult validate(Credential credential) {
        // ...
    }
}
```

Then verify:

1. CDI discovery,
2. bean archive mode,
3. store priority,
4. validation types,
5. group mapping,
6. password hash compatibility,
7. database transaction boundaries.

### 8.6 HttpAuthenticationMechanism Migration

Before:

```java
import javax.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import javax.security.enterprise.authentication.mechanism.http.HttpMessageContext;
import javax.security.enterprise.AuthenticationStatus;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class BearerMechanism implements HttpAuthenticationMechanism {
    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) {
        // ...
    }
}
```

After:

```java
import jakarta.security.enterprise.authentication.mechanism.http.HttpAuthenticationMechanism;
import jakarta.security.enterprise.authentication.mechanism.http.HttpMessageContext;
import jakarta.security.enterprise.AuthenticationStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class BearerMechanism implements HttpAuthenticationMechanism {
    @Override
    public AuthenticationStatus validateRequest(
            HttpServletRequest request,
            HttpServletResponse response,
            HttpMessageContext context) {
        // ...
    }
}
```

Security validation after migration:

```text
invalid token -> 401
missing token on protected endpoint -> 401
valid token insufficient role -> 403
valid token sufficient role -> 200/expected
expired token -> 401
wrong audience -> 401
wrong issuer -> 401
```

---

## 9. Descriptor Migration

### 9.1 `web.xml` Namespace

Old Java EE style:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         version="4.0">
</web-app>
```

Jakarta EE style:

```xml
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee"
         version="6.1">
</web-app>
```

Do not only update Java imports while leaving old descriptors incompatible with the new container expectations.

### 9.2 Security Constraint Example

```xml
<security-constraint>
    <web-resource-collection>
        <web-resource-name>Admin</web-resource-name>
        <url-pattern>/admin/*</url-pattern>
        <http-method>GET</http-method>
        <http-method>POST</http-method>
    </web-resource-collection>
    <auth-constraint>
        <role-name>ADMIN</role-name>
    </auth-constraint>
    <user-data-constraint>
        <transport-guarantee>CONFIDENTIAL</transport-guarantee>
    </user-data-constraint>
</security-constraint>

<login-config>
    <auth-method>FORM</auth-method>
    <realm-name>appRealm</realm-name>
    <form-login-config>
        <form-login-page>/login</form-login-page>
        <form-error-page>/login-error</form-error-page>
    </form-login-config>
</login-config>

<security-role>
    <role-name>ADMIN</role-name>
</security-role>
```

Migration check:

1. Is the descriptor schema valid?
2. Does the container read it?
3. Does the role exist?
4. Does the role map to IdP/realm group?
5. Does URL matching behave the same?
6. Does HTTP method omission behave as expected?
7. Does `CONFIDENTIAL` interact correctly with proxy TLS termination?

### 9.3 Security Role Reference

```xml
<security-role-ref>
    <role-name>Manager</role-name>
    <role-link>CASE_MANAGER</role-link>
</security-role-ref>
```

This can silently break when deployment descriptors are ignored or vendor mappings change.

If application code calls:

```java
request.isUserInRole("Manager")
```

the container may map it to:

```text
CASE_MANAGER
```

depending on role reference configuration.

Migration must test both:

```java
request.isUserInRole("Manager")
request.isUserInRole("CASE_MANAGER")
```

if legacy code uses role refs.

---

## 10. Container Migration

### 10.1 Tomcat

Tomcat 9 is `javax.servlet`.
Tomcat 10+ is `jakarta.servlet`.

A `javax.servlet.Filter` compiled for Tomcat 9 does not run as a `jakarta.servlet.Filter` in Tomcat 10+.

Security-specific checks:

1. realm configuration,
2. form auth behavior,
3. session cookie config,
4. SameSite support/config,
5. `RemoteIpValve`,
6. client certificate auth,
7. JASPIC support limitations,
8. classloader leakage from old `javax` jars.

### 10.2 WildFly / JBoss EAP

Checks:

1. Elytron security domain mapping,
2. application security domain,
3. OIDC adapter or Elytron OIDC client,
4. deployment descriptors,
5. JACC/JASPIC support,
6. annotation scanning,
7. role decoder,
8. principal transformer,
9. legacy `jboss-web.xml` mapping.

### 10.3 Payara / GlassFish

Checks:

1. realm migration,
2. Jakarta Security support,
3. `glassfish-web.xml` role mapping,
4. JASPIC registration,
5. OIDC/JWT integration,
6. CDI discovery,
7. session persistence/clustering.

### 10.4 Open Liberty

Checks:

1. features enabled in `server.xml`,
2. appSecurity version,
3. Jakarta EE level,
4. JWT/OIDC features,
5. role mapping,
6. transport security,
7. multiple authentication mechanisms if using Jakarta Security 4.0.

### 10.5 WebLogic

Checks:

1. Jakarta EE version support,
2. deployment plan,
3. security realm,
4. identity asserters,
5. JASPIC/Jakarta Authentication,
6. JACC/Jakarta Authorization provider,
7. role mapping,
8. web app descriptors,
9. classloader filtering.

### 10.6 TomEE

Checks:

1. Jakarta namespace support,
2. EJB security annotations,
3. JAAS realm,
4. JAX-RS provider scanning,
5. session/form auth compatibility.

---

## 11. Spring Security Coexistence

Many enterprise Java applications mix:

```text
Servlet container
Spring MVC / Spring Boot
Spring Security
JAX-RS or Jakarta APIs
```

Migration traps:

1. Spring Boot 2.x uses `javax` generation.
2. Spring Boot 3.x uses `jakarta`.
3. A Boot 3 app cannot use old `javax.servlet.Filter` libraries.
4. Spring Security filter chain may replace container-managed auth.
5. `@RolesAllowed` may require JSR-250 method security enablement in Spring.
6. `jakarta.annotation.security.RolesAllowed` must be used in Boot 3/Jakarta stack.
7. Role prefix behavior (`ROLE_`) can create mismatch with Jakarta role names.

Example mismatch:

```java
@RolesAllowed("ADMIN")
```

Spring Security might expect:

```text
ROLE_ADMIN
```

depending on configuration.

Jakarta container might expect:

```text
ADMIN
```

Therefore after migration, assert:

```text
token/group ADMIN -> method allowed?
token/group ROLE_ADMIN -> method allowed?
```

Do not assume.

---

## 12. JAX-RS Migration

### 12.1 Package Changes

Before:

```java
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.container.ContainerRequestFilter;
import javax.ws.rs.core.SecurityContext;
```

After:

```java
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.SecurityContext;
```

### 12.2 Provider Registration Risk

A security filter like this:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class BearerTokenFilter implements ContainerRequestFilter {
}
```

may stop running if:

1. wrong namespace,
2. provider package not scanned,
3. application class changed,
4. CDI integration changed,
5. provider priority import mismatch,
6. deployment excludes provider.

Test by adding a controlled endpoint:

```text
GET /api/security-test/whoami
```

Expected response should show:

```json
{
  "principal": "alice",
  "roles": ["CASE_OFFICER"],
  "authType": "bearer"
}
```

Only enable this in test profile.

---

## 13. CDI Migration and Security

### 13.1 `javax.enterprise` to `jakarta.enterprise`

Before:

```java
import javax.enterprise.context.ApplicationScoped;
import javax.inject.Inject;
```

After:

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
```

### 13.2 Bean Discovery Risk

Security components often depend on CDI:

```java
@ApplicationScoped
public class MyIdentityStore implements IdentityStore {
}
```

If CDI does not discover the bean, authentication may fail or fallback to another mechanism.

Check:

1. `beans.xml` version/schema,
2. bean-discovery-mode,
3. module packaging,
4. CDI extension compatibility,
5. producer methods,
6. interceptors enabled.

### 13.3 Interceptor Migration

Before:

```java
import javax.interceptor.Interceptor;
import javax.interceptor.AroundInvoke;
```

After:

```java
import jakarta.interceptor.Interceptor;
import jakarta.interceptor.AroundInvoke;
```

Security impact:

```text
custom @CanApproveCase interceptor not invoked
=> endpoint may rely only on coarse role
=> domain authorization bypass
```

---

## 14. EJB Method Security Migration

### 14.1 Annotation Migration

Before:

```java
import javax.annotation.security.RolesAllowed;
import javax.ejb.Stateless;

@Stateless
public class CaseApprovalService {
    @RolesAllowed("APPROVER")
    public void approve(Long caseId) {
    }
}
```

After:

```java
import jakarta.annotation.security.RolesAllowed;
import jakarta.ejb.Stateless;

@Stateless
public class CaseApprovalService {
    @RolesAllowed("APPROVER")
    public void approve(Long caseId) {
    }
}
```

### 14.2 Security Behavior Checks

Verify:

1. direct call through injected proxy is secured,
2. self-invocation still bypasses as before,
3. `@RunAs` works,
4. `@PermitAll` and `@DenyAll` work,
5. transaction rollback behavior unchanged,
6. security exception type mapped correctly,
7. audit logs failed authorization.

---

## 15. Jakarta Authentication / JASPIC Migration

### 15.1 Package Change

Before:

```java
import javax.security.auth.message.module.ServerAuthModule;
import javax.security.auth.message.AuthStatus;
import javax.security.auth.message.MessageInfo;
import javax.security.auth.message.callback.CallerPrincipalCallback;
import javax.security.auth.message.callback.GroupPrincipalCallback;
```

After:

```java
import jakarta.security.auth.message.module.ServerAuthModule;
import jakarta.security.auth.message.AuthStatus;
import jakarta.security.auth.message.MessageInfo;
import jakarta.security.auth.message.callback.CallerPrincipalCallback;
import jakarta.security.auth.message.callback.GroupPrincipalCallback;
```

### 15.2 Security Behavior Risk

Custom JASPIC modules are often deployed through vendor-specific registration.

Migration risks:

1. module class not loaded,
2. registration file ignored,
3. callback handler incompatible,
4. group callback not accepted,
5. request/response type cast fails,
6. module invoked in different order,
7. challenge/redirect behavior changes,
8. concurrency bug exposed by newer container.

### 15.3 Validation Test

For a custom JASPIC module, test:

| Scenario | Expected |
|---|---|
| no credential | `SEND_CONTINUE` or 401/redirect |
| invalid credential | `SEND_FAILURE` |
| valid credential | `SUCCESS` |
| valid credential with groups | `isUserInRole` true |
| logout | identity removed |
| async dispatch | identity not leaked |
| concurrent requests | no shared mutable state leakage |

---

## 16. Jakarta Authorization / JACC Migration

### 16.1 Package Change

Before:

```java
import javax.security.jacc.PolicyContext;
import javax.security.jacc.WebResourcePermission;
import javax.security.jacc.WebUserDataPermission;
import javax.security.jacc.EJBMethodPermission;
```

After:

```java
import jakarta.security.jacc.PolicyContext;
import jakarta.security.jacc.WebResourcePermission;
import jakarta.security.jacc.WebUserDataPermission;
import jakarta.security.jacc.EJBMethodPermission;
```

### 16.2 Security Behavior Risk

JACC/Jakarta Authorization sits below common application code. If this breaks, symptoms can be confusing:

```text
@RolesAllowed ignored
web.xml constraints ignored
policy provider not initialized
role reference mapping wrong
permission repository empty
everything denied
everything allowed
```

### 16.3 Migration Checks

1. Is the authorization provider compatible with Jakarta namespace?
2. Are permission classes now `jakarta.security.jacc.*`?
3. Is container configured to use provider?
4. Are policy contexts loaded per application?
5. Are role mappings preserved?
6. Are denial logs emitted?
7. Are deployment-time constraints converted into permissions?

---

## 17. JAAS and Java SE `javax.security.auth`

JAAS remains in Java SE namespace:

```java
javax.security.auth.Subject
javax.security.auth.login.LoginContext
javax.security.auth.spi.LoginModule
javax.security.auth.callback.CallbackHandler
```

Do not rename these to `jakarta`.

### 17.1 JAAS Bridge Concern

Legacy enterprise systems may use JAAS for:

1. custom login modules,
2. LDAP login,
3. Kerberos/SPNEGO,
4. container realm integration,
5. subject/principal population.

Migrating Jakarta EE APIs does not automatically migrate JAAS.

Check:

1. login module class still loads on Java 17/21/25,
2. module uses removed/encapsulated JDK internals,
3. subject principal still maps to container principal,
4. groups still map to roles,
5. callback handler still receives expected callbacks.

---

## 18. SecurityManager Removal/Deprecation Context

Older JACC/permission discussions sometimes assumed Java SecurityManager/Policy.

Modern Java has moved away from SecurityManager as a general sandbox mechanism. Do not design new application authorization around Java SE SecurityManager checks.

For Jakarta Authorization/JACC migration, think in terms of:

```text
container authorization contract
not application sandboxing
```

Application authorization should be explicit:

```text
subject + action + resource + context -> decision
```

not accidental reliance on old JVM-level security.

---

## 19. Role Mapping Migration

### 19.1 Identify Every Role Name

Collect from:

1. annotations,
2. descriptors,
3. code constants,
4. database tables,
5. IdP group config,
6. Keycloak/client roles,
7. SAML attributes,
8. API gateway claims,
9. test users,
10. audit reports.

Example command:

```bash
grep -R "RolesAllowed\|isUserInRole\|security-role\|role-name\|DeclareRoles\|RunAs" src main webapp
```

### 19.2 Normalize Role Contract

Bad:

```java
@RolesAllowed("CN=ACEAS-PROD-APPROVER,OU=Groups,DC=example,DC=com")
```

Better:

```java
@RolesAllowed("CASE_APPROVER")
```

Then map external IdP group to application role outside business logic.

### 19.3 Migration Matrix

| External Group/Claim | Old App Role | New App Role | Used In | Test User |
|---|---|---|---|---|
| `kc_client:case-approver` | `APPROVER` | `CASE_APPROVER` | approval | alice |
| `ldap:AdminGroup` | `ADMIN` | `ADMIN` | admin endpoints | bob |
| `saml:agencyOfficer` | `OFFICER` | `CASE_OFFICER` | case queue | chandra |

Never migrate security without this table.

---

## 20. Session and Cookie Migration

### 20.1 Session Cookie Name

Legacy:

```text
JSESSIONID
```

Usually still:

```text
JSESSIONID
```

But container/proxy/session manager may change:

1. cookie path,
2. cookie domain,
3. SameSite,
4. Secure,
5. HttpOnly,
6. max age,
7. session route suffix,
8. clustering behavior.

### 20.2 Security Tests

Test:

1. login rotates session ID,
2. authenticated endpoint requires session,
3. logout invalidates session,
4. old session ID cannot be reused,
5. role change mid-session behavior is intentional,
6. idle timeout works,
7. absolute timeout works if implemented,
8. SameSite behavior works with OIDC callback,
9. Secure cookie set behind TLS-terminating proxy,
10. session not shared across wrong domain.

### 20.3 Proxy TLS Concern

After migration, app server may think request is HTTP if forwarded headers are not configured. That can break:

1. Secure cookie generation,
2. redirect URI scheme,
3. transport guarantee,
4. OIDC callback URI,
5. HSTS logic.

Validate:

```text
external URL: https://app.example.com
application sees scheme: https
redirect generated: https://app.example.com/...
cookie Secure: true
```

---

## 21. OIDC Migration

### 21.1 OIDC Integration Types

You may have:

1. Jakarta Security built-in OIDC mechanism,
2. vendor OIDC adapter,
3. Keycloak adapter,
4. custom Servlet filter,
5. gateway-authenticated OIDC,
6. Spring Security OIDC,
7. SAML-to-OIDC broker.

Each has different migration impact.

### 21.2 Jakarta Security OIDC Check

For Jakarta Security 4.0:

```java
@OpenIdAuthenticationMechanismDefinition(
    providerURI = "${oidc.provider.uri}",
    clientId = "${oidc.client.id}",
    clientSecret = "${oidc.client.secret}",
    redirectURI = "${baseURL}/callback"
)
```

Check:

1. annotation package,
2. config expression support,
3. callback path,
4. state/nonce handling,
5. session cookie SameSite,
6. claim mapping,
7. logout behavior,
8. JWKS cache,
9. clock skew,
10. multi-env redirect URI.

### 21.3 Keycloak Adapter Warning

Legacy Keycloak Java adapters historically targeted older `javax`-based stacks. Modern migration often requires adapterless OIDC, Elytron OIDC, Spring Security OIDC, Jakarta Security OIDC, or gateway-based integration.

Do not assume old adapter works in Jakarta runtime.

---

## 22. SAML Migration

SAML integration often lives outside the Jakarta API:

1. reverse proxy,
2. IdP gateway,
3. Spring Security SAML,
4. container plugin,
5. custom filter,
6. identity broker.

Migration checks:

1. SAML callback/ACS endpoint still registered,
2. filter/provider still recognized under `jakarta.servlet`,
3. XML parser security unchanged,
4. signature validation unchanged,
5. NameID/attribute mapping unchanged,
6. session establishment unchanged,
7. logout unchanged,
8. RelayState validation unchanged,
9. role mapping unchanged,
10. audit subject unchanged.

---

## 23. mTLS Migration

mTLS depends on:

1. TLS termination layer,
2. container connector,
3. truststore,
4. client certificate auth method,
5. request attribute,
6. proxy forwarding rules.

In Jakarta Servlet, client certificate information is exposed via request attributes such as X.509 certificate arrays. But if TLS terminates at proxy, the app container may never see the certificate unless configured.

Migration checks:

1. app container receives cert if expected,
2. proxy strips spoofable cert headers from external requests,
3. certificate subject/SAN mapping unchanged,
4. truststore loaded under new runtime,
5. TLS protocols/ciphers compatible with new JDK,
6. certificate rotation runbook works.

---

## 24. API Gateway / Reverse Proxy Migration

After container upgrade, review:

1. forwarded header support,
2. trusted proxy list,
3. request scheme detection,
4. path rewrite,
5. context path,
6. host header validation,
7. identity header trust,
8. CORS handling,
9. health endpoint routing,
10. admin endpoint exposure.

A Jakarta migration often changes context path or servlet mapping. That can accidentally expose endpoints:

```text
old protected: /app/admin/*
new route: /admin/*
security constraint still points to /app/admin/*
result: /admin/* public
```

Therefore URL security tests must be end-to-end through the gateway, not only direct container tests.

---

## 25. Static Analysis and Automated Refactoring

Tools can help:

1. OpenRewrite recipes,
2. IDE migration tools,
3. Maven Enforcer,
4. Revapi/japicmp,
5. dependency tree analysis,
6. `jdeps`,
7. grep/ripgrep,
8. OWASP Dependency-Check/Snyk/Trivy,
9. custom banned-import rules.

### 25.1 Banned Import Rule

After migration, fail build on:

```text
javax.servlet.
javax.ws.rs.
javax.enterprise.
javax.inject.
javax.annotation.security.
javax.security.enterprise.
javax.security.auth.message.
javax.security.jacc.
```

But allow Java SE security packages:

```text
javax.net.ssl.
javax.crypto.
javax.security.auth.
```

except old JASPIC/JACC packages if migrated:

```text
javax.security.auth.message.
javax.security.jacc.
```

### 25.2 Maven Enforcer Concept

```xml
<rules>
  <bannedDependencies>
    <excludes>
      <exclude>javax.servlet:javax.servlet-api</exclude>
      <exclude>javax.ws.rs:javax.ws.rs-api</exclude>
      <exclude>javax.security.enterprise:javax.security.enterprise-api</exclude>
    </excludes>
  </bannedDependencies>
</rules>
```

### 25.3 Dependency Tree Inspection

```bash
mvn dependency:tree | grep javax
mvn dependency:tree | grep jakarta
```

But interpret carefully: Java SE `javax` dependencies may still appear indirectly and may be fine.

---

## 26. Testing Strategy for Security Migration

### 26.1 Golden Master Security Matrix

Before migration, capture behavior:

```text
anonymous GET /admin -> 302 login or 401
user without ADMIN GET /admin -> 403
ADMIN GET /admin -> 200
invalid token GET /api/cases -> 401
valid token wrong audience -> 401
valid token insufficient role -> 403
valid token sufficient role -> 200
CSRF missing POST /case/approve -> 403
logout then access protected -> 302/401
```

After migration, the same tests must pass.

### 26.2 Unit Tests

Test pure policy logic:

```java
assertFalse(policy.canApprove(actor, caseAssignedToSameActor));
assertTrue(policy.canApprove(supervisor, submittedCase));
assertFalse(policy.canApprove(officerFromTenantA, caseFromTenantB));
```

### 26.3 Container Tests

Test:

1. `@RolesAllowed`,
2. `@PermitAll`,
3. `@DenyAll`,
4. web.xml constraints,
5. `HttpServletRequest.isUserInRole`,
6. injected `SecurityContext`,
7. JAX-RS `SecurityContext`,
8. filter order,
9. logout,
10. session fixation.

### 26.4 Token Tests

Test:

1. expired token,
2. future `nbf`,
3. wrong `iss`,
4. wrong `aud`,
5. unsigned token,
6. algorithm confusion,
7. unknown `kid`,
8. JWKS rotation,
9. insufficient scope,
10. missing subject.

### 26.5 Browser Security Tests

Test:

1. CSRF token required,
2. SameSite behavior with OIDC,
3. CORS no wildcard with credentials,
4. clickjacking denied,
5. open redirect blocked,
6. Secure/HttpOnly cookies present.

### 26.6 Audit Tests

Every important security event should still be recorded:

1. login success,
2. login failure,
3. logout,
4. denied authorization,
5. privileged action,
6. delegation,
7. break-glass,
8. tenant switch,
9. role mapping failure.

---

## 27. Migration Execution Plan

### Phase 0 — Freeze and Inventory

Deliverables:

1. dependency tree,
2. source import inventory,
3. descriptor inventory,
4. container config inventory,
5. security endpoint matrix,
6. role mapping matrix,
7. test users and credentials,
8. audit baseline.

### Phase 1 — Upgrade Tests First

Before migration:

1. add missing authorization tests,
2. add negative tests,
3. add session/logout tests,
4. add token validation tests,
5. add audit tests,
6. add gateway route tests.

If the old system has no tests, write black-box tests first.

### Phase 2 — Dependency Alignment

Choose target:

```text
Jakarta EE 10?
Jakarta EE 11?
Spring Boot 3?
Tomcat 10.1?
WildFly version?
Open Liberty feature set?
Payara version?
```

Then align dependency versions to runtime.

### Phase 3 — Source Refactoring

Use automated tools, then manual review.

Do not blindly rename Java SE `javax`.

### Phase 4 — Descriptor and Container Config

Update:

1. XML schemas,
2. role mappings,
3. realm config,
4. OIDC/SAML config,
5. JASPIC/JACC registration,
6. proxy/forwarded header config,
7. cookie config,
8. TLS/mTLS config.

### Phase 5 — Compile and Dependency Cleanliness

Goals:

```text
No old Jakarta EE javax imports
No incompatible javax servlet/jaxrs/security enterprise jars
No duplicate javax/jakarta API jars unless intentionally isolated
```

### Phase 6 — Behavior Regression

Run:

1. endpoint matrix,
2. role matrix,
3. token matrix,
4. session matrix,
5. browser security matrix,
6. audit matrix,
7. domain workflow matrix.

### Phase 7 — Staging End-to-End

Test through real topology:

```text
browser/client
  -> WAF/gateway/reverse proxy
  -> load balancer
  -> Jakarta container
  -> IdP
  -> database/cache/message broker
```

### Phase 8 — Production Rollout

Recommended controls:

1. canary release,
2. traffic shadow where possible,
3. auth failure monitoring,
4. 401/403 rate dashboard,
5. login success/failure dashboard,
6. audit event completeness monitor,
7. session count monitor,
8. rollback plan.

---

## 28. Common Migration Failures and Root Causes

### 28.1 Application Compiles but Filters Do Not Run

Cause:

```text
filter implements javax.servlet.Filter
container expects jakarta.servlet.Filter
```

Fix:

```text
migrate filter and all dependencies to jakarta.servlet
```

### 28.2 `@RolesAllowed` Ignored

Possible causes:

1. wrong annotation package,
2. method not managed by container,
3. CDI bean not discovered,
4. Spring method security not enabled,
5. self-invocation,
6. final method/class,
7. JAX-RS integration missing,
8. proxy bypass.

### 28.3 Principal Is Null

Possible causes:

1. authentication mechanism not registered,
2. filter order changed,
3. gateway stripped token,
4. session cookie not sent,
5. SameSite misconfiguration,
6. callback path mismatch,
7. HTTPS detection broken,
8. JASPIC module not invoked.

### 28.4 Groups Are Empty

Possible causes:

1. IdentityStore returns no groups,
2. JASPIC `GroupPrincipalCallback` not called,
3. OIDC claim path changed,
4. SAML attribute mapping changed,
5. Keycloak/client role mapper missing,
6. group-to-role mapping missing,
7. tenant-specific mapping missing.

### 28.5 Everything Returns 403

Possible causes:

1. roles renamed,
2. role prefix mismatch,
3. annotation package mismatch,
4. container policy provider not initialized,
5. authorization provider denies by default but no permissions loaded,
6. test user lacks new role mapping.

### 28.6 Everything Becomes Public

Possible causes:

1. security constraints ignored due to descriptor schema issue,
2. URL pattern changed,
3. app context path changed,
4. filter not registered,
5. JAX-RS application not scanned,
6. gateway route bypasses auth,
7. default allow in custom auth code.

### 28.7 OIDC Redirect Loop

Possible causes:

1. wrong external scheme due to proxy config,
2. callback URL mismatch,
3. SameSite cookie prevents session/state cookie,
4. state/nonce not preserved,
5. session not created,
6. IdP redirect URI stale,
7. context path changed.

### 28.8 Logout Does Not Work

Possible causes:

1. local session invalidated but IdP session alive,
2. OIDC logout endpoint not called,
3. cookie path/domain changed,
4. old session cookie remains,
5. front-channel logout endpoint missing,
6. back-channel logout not implemented,
7. cluster session not invalidated.

---

## 29. Migration Checklist

### 29.1 Code Checklist

- [ ] No Jakarta EE `javax.servlet.*` import remains.
- [ ] No `javax.ws.rs.*` import remains.
- [ ] No `javax.security.enterprise.*` import remains.
- [ ] No `javax.annotation.security.*` import remains.
- [ ] No old JASPIC/JACC imports remain if target is Jakarta namespace.
- [ ] Java SE `javax.net.ssl`, `javax.crypto`, `javax.security.auth` intentionally remain.
- [ ] All filters/listeners/providers use `jakarta.*`.
- [ ] All custom annotations/interceptors migrated.
- [ ] All generated sources migrated.
- [ ] All test sources migrated.

### 29.2 Dependency Checklist

- [ ] Servlet API matches container.
- [ ] JAX-RS API matches runtime.
- [ ] Jakarta Security API matches platform.
- [ ] Annotation API matches platform.
- [ ] No incompatible old Java EE API jars.
- [ ] Third-party libraries support Jakarta.
- [ ] Old Keycloak/SAML adapters replaced or verified.
- [ ] Maven/Gradle dependency tree clean.

### 29.3 Descriptor Checklist

- [ ] `web.xml` schema updated.
- [ ] Security constraints preserved.
- [ ] Login config preserved.
- [ ] Security roles preserved.
- [ ] Role references preserved.
- [ ] Vendor role mapping preserved.
- [ ] Transport guarantee preserved.
- [ ] Error pages preserved.
- [ ] Servlet/filter mappings preserved.

### 29.4 Runtime Checklist

- [ ] Realm/security domain configured.
- [ ] OIDC/SAML integration configured.
- [ ] JASPIC module registered if used.
- [ ] JACC provider configured if used.
- [ ] Forwarded headers configured.
- [ ] TLS/mTLS configured.
- [ ] Cookie settings configured.
- [ ] Session clustering configured.
- [ ] Audit sink configured.

### 29.5 Security Behavior Checklist

- [ ] Anonymous access denied where expected.
- [ ] Public endpoints remain intentionally public.
- [ ] Role-based access works.
- [ ] Domain permission works.
- [ ] Tenant isolation works.
- [ ] CSRF protection works.
- [ ] CORS policy works.
- [ ] Logout works.
- [ ] Session fixation protection works.
- [ ] Token validation works.
- [ ] Audit events emitted.
- [ ] 401/403 semantics unchanged.

---

## 30. Example Migration Diff

### Before

```java
package com.example.security;

import javax.enterprise.context.ApplicationScoped;
import javax.security.enterprise.identitystore.IdentityStore;
import javax.security.enterprise.credential.Credential;
import javax.security.enterprise.credential.UsernamePasswordCredential;
import javax.security.enterprise.identitystore.CredentialValidationResult;

@ApplicationScoped
public class AppIdentityStore implements IdentityStore {

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof UsernamePasswordCredential)) {
            return CredentialValidationResult.NOT_VALIDATED_RESULT;
        }

        UsernamePasswordCredential up = (UsernamePasswordCredential) credential;

        if ("alice".equals(up.getCaller()) && up.getPassword().compareTo("secret")) {
            return new CredentialValidationResult("alice", Set.of("CASE_OFFICER"));
        }

        return CredentialValidationResult.INVALID_RESULT;
    }
}
```

### After

```java
package com.example.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.security.enterprise.identitystore.IdentityStore;
import jakarta.security.enterprise.credential.Credential;
import jakarta.security.enterprise.credential.UsernamePasswordCredential;
import jakarta.security.enterprise.identitystore.CredentialValidationResult;

import java.util.Set;

@ApplicationScoped
public class AppIdentityStore implements IdentityStore {

    @Override
    public CredentialValidationResult validate(Credential credential) {
        if (!(credential instanceof UsernamePasswordCredential)) {
            return CredentialValidationResult.NOT_VALIDATED_RESULT;
        }

        UsernamePasswordCredential up = (UsernamePasswordCredential) credential;

        if ("alice".equals(up.getCaller()) && up.getPassword().compareTo("secret")) {
            return new CredentialValidationResult("alice", Set.of("CASE_OFFICER"));
        }

        return CredentialValidationResult.INVALID_RESULT;
    }
}
```

But a production migration should also fix the hardcoded password example. That code is only pedagogical.

---

## 31. Reference Architecture for Migration Validation

```text
                    +---------------------+
Browser / API Client | session/token/cert  |
                    +----------+----------+
                               |
                               v
                    +---------------------+
                    | Gateway / Proxy     |
                    | TLS, headers, WAF   |
                    +----------+----------+
                               |
                               v
                    +---------------------+
                    | Jakarta Container   |
                    | Servlet/JAX-RS/CDI  |
                    +----------+----------+
                               |
       +-----------------------+----------------------+
       |                       |                      |
       v                       v                      v
+-------------+        +----------------+      +----------------+
| Authn layer |        | Authz layer    |      | Audit layer    |
| OIDC/SAML/  |        | role/domain/   |      | actor/action/  |
| session/mTLS|        | tenant/state   |      | outcome        |
+------+------+        +-------+--------+      +-------+--------+
       |                       |                       |
       v                       v                       v
+-------------+        +----------------+      +----------------+
| IdP/Realm   |        | DB/Policy      |      | Audit Store    |
+-------------+        +----------------+      +----------------+
```

Migration success means each arrow still carries the same security meaning.

---

## 32. Migration Review Questions

Ask these in architecture review:

1. Which authentication mechanisms exist before and after migration?
2. Where is identity established?
3. Where are groups mapped to roles?
4. Which container evaluates `@RolesAllowed`?
5. Which endpoints are protected by URL constraints?
6. Which endpoints depend only on filters?
7. Which endpoints require domain authorization?
8. What happens if the IdP is unavailable?
9. What happens if role mapping is empty?
10. What happens if token validation fails?
11. What happens if session cookie is missing?
12. What happens if forwarded scheme is wrong?
13. What is the expected behavior for anonymous access?
14. What is the expected behavior for authenticated but unauthorized access?
15. Which audit events prove enforcement occurred?
16. Which tests prove there is no tenant leakage?
17. Which old `javax` dependencies remain and why?
18. Which Java SE `javax` imports are intentionally kept?
19. Which vendor-specific security configs changed?
20. What is the rollback plan?

---

## 33. Top 1% Engineer Heuristics

A shallow engineer says:

> “We migrated from `javax` to `jakarta`; it compiles.”

A strong engineer says:

> “We migrated platform namespace and proved security behavior equivalence with endpoint, role, token, session, tenant, and audit regression tests.”

A top-tier engineer says:

> “We separated namespace migration from runtime migration, removed mixed dependency hazards, preserved container-managed identity and authorization contracts, verified gateway/container trust boundaries, tested negative authorization paths, and documented intentional behavior changes.”

The difference is not syntax. The difference is **security invariants**.

---

## 34. Practical Mini-Runbook

### 34.1 Before Deployment

```bash
mvn clean verify
mvn dependency:tree > dependency-tree.txt
grep -R "javax.servlet\|javax.ws.rs\|javax.security.enterprise\|javax.annotation.security" src || true
```

Then run:

```text
security-regression-suite
oidc-regression-suite
role-mapping-suite
tenant-isolation-suite
audit-event-suite
```

### 34.2 During Deployment

Monitor:

1. login success rate,
2. login failure rate,
3. 401 rate,
4. 403 rate,
5. 5xx rate from auth endpoints,
6. OIDC callback errors,
7. session creation rate,
8. logout events,
9. audit event volume,
10. gateway route mismatch,
11. token validation failure reasons.

### 34.3 After Deployment

Sample real transactions:

1. public user,
2. normal authenticated user,
3. admin user,
4. tenant A user,
5. tenant B user,
6. user with revoked role,
7. expired token,
8. logout/relogin,
9. OIDC callback,
10. privileged workflow action.

---

## 35. Summary

Migrating Java EE `javax` security to Jakarta `jakarta` security is not just a package rename. It is a behavior-preserving migration across source code, dependencies, descriptors, container configuration, identity provider integration, gateway boundaries, session/cookie behavior, method security, authorization policy, and audit evidence.

The most important rules:

1. Do not blindly replace all `javax` packages.
2. Keep Java SE `javax` security packages when appropriate.
3. Align dependencies with runtime container.
4. Remove mixed `javax`/`jakarta` Jakarta EE APIs.
5. Treat security descriptors as first-class migration artifacts.
6. Verify `Principal`, groups, roles, and permissions after migration.
7. Test negative paths more aggressively than happy paths.
8. Validate through the real gateway/proxy topology.
9. Preserve audit semantics.
10. Document intentional security behavior changes.

If the application compiles but the authorization matrix is not proven, the migration is not complete.

---

## References

- Jakarta Security 4.0 specification and API documentation.
- Jakarta Authentication 3.1 specification.
- Jakarta Authorization 3.0 specification.
- Jakarta Servlet specification.
- Jakarta EE namespace migration notes.
- OpenRewrite Jakarta migration recipes.
- Container-specific migration guides for Tomcat, WildFly, Payara, Open Liberty, WebLogic, and TomEE.
- OWASP authorization, authentication, CSRF, CORS, logging, and security testing guidance.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 29 — Testing Security: Unit, Integration, Container, Attack Simulation](./learn-java-jakarta-security-authentication-authorization-identity-part-29-testing-security.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 31 — Interoperability with Spring Security, Keycloak, MicroProfile JWT, and Modern IdPs](./learn-java-jakarta-security-authentication-authorization-identity-part-31-interoperability-spring-security-keycloak.md)
