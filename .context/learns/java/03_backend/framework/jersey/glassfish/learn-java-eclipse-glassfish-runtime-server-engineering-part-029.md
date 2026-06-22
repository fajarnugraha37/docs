# learn-java-eclipse-glassfish-runtime-server-engineering-part-029  
# Part 29 — Security Hardening dan Production Baseline

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 29 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **security hardening GlassFish untuk production**: secure admin, admin console, password/master password, password alias, TLS, realms, role mapping, file permissions, deployment hygiene, headers, secrets, audit, patching, dan production baseline

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. memahami security hardening sebagai **pengurangan attack surface** dan **kontrol operasional**, bukan hanya konfigurasi TLS;
2. mengamankan administration plane: admin user, admin password, secure admin, admin console, admin listener, DAS/instance admin communication;
3. mengelola master password, keystore, truststore, dan password alias;
4. menghindari secret leakage di `domain.xml`, scripts, logs, container image, dan CI/CD;
5. mengamankan listener HTTP/HTTPS, TLS, cipher/protocol, reverse proxy, dan headers;
6. mengelola authentication realm, principal, group, role mapping, dan application security;
7. memahami security baseline untuk deployments, libraries, classloading, resource configs, and file permissions;
8. menerapkan audit dan monitoring untuk security events;
9. membuat hardening checklist sebelum production go-live;
10. memahami trade-off antara usability/operations dan hardening.

Part ini bukan pengganti threat modeling atau penetration testing. Fokusnya adalah **GlassFish runtime hardening baseline**.

---

## 1. Mental Model: Hardening adalah Attack Surface Management

GlassFish production runtime memiliki banyak surface:

```text
Client HTTP/HTTPS listener
Admin listener / Admin Console
asadmin / REST admin API
DAS-to-instance communication
JMX/monitoring
Application endpoints
JDBC/JMS/connector resources
Keystore/truststore files
domain.xml / password files
deployment artifacts
logs / heap dumps / thread dumps
OS/container user
Network path to DB/JMS/IAM/external API
```

Hardening berarti:

```text
1. Matikan yang tidak perlu.
2. Batasi yang harus hidup.
3. Autentikasi dan otorisasi akses.
4. Enkripsi data in transit dan secret at rest.
5. Jangan bocorkan informasi.
6. Patch runtime.
7. Monitor dan audit.
8. Buat perubahan reproducible.
```

Top 1% engineer tidak hanya bertanya:

> "Sudah HTTPS belum?"

Tetapi:

> "Siapa bisa akses admin listener, bagaimana credential disimpan, apakah password alias dipakai, apakah logs membocorkan token, apakah TLS/cert lifecycle aman, apakah dependency CVE dipatch, dan apakah hardening bisa direproduksi?"

---

## 2. Threat Model Ringkas

Ancaman umum:

```text
1. Unauthorized admin access.
2. Default/weak password.
3. Admin console exposed publicly.
4. Plaintext secrets in config/scripts.
5. TLS misconfiguration.
6. Vulnerable GlassFish/JDK/library version.
7. Application endpoint auth bypass.
8. Role mapping mistake.
9. Sensitive data in logs/heap dumps.
10. Insecure file permissions.
11. JMX/admin API exposed.
12. SSRF/external call abuse.
13. Deployment of malicious/unknown artifact.
14. Dependency confusion/supply-chain.
15. Excessive DB/JMS credentials.
```

Security baseline harus menutup risiko-risiko ini secara sistematis.

---

## 3. Control Plane vs Data Plane

### Control Plane

Admin/control operations:

```text
Admin Console
asadmin
REST admin API
DAS
domain config
deployment commands
JMX/admin monitoring
```

Jika control plane kompromi, attacker dapat:

- deploy malicious app;
- read/modify resources;
- change credentials;
- disable security;
- access logs/config;
- stop server;
- pivot to DB/JMS.

### Data Plane

User/application traffic:

```text
HTTP/HTTPS app endpoints
JMS consumers
external API calls
DB access
```

Hardening harus memisahkan keduanya.

Principle:

```text
Admin/control plane must never be publicly exposed like user-facing app endpoints.
```

---

## 4. Admin User and Admin Password

GlassFish uses administration credentials for Admin Console and `asadmin`.

Baseline:

```text
- no blank admin password
- no default weak credential
- strong password policy
- password rotation process
- access limited to operators/pipeline
- admin account usage audited
```

Command:

```bash
asadmin change-admin-password
```

Operational notes:

- change default password immediately;
- store credential in secret manager/pipeline vault;
- do not put password in shell history;
- use password files carefully;
- restart if required by command/instructions.

---

## 5. Secure Admin

Secure admin enables secure administration communication for remote admin operations.

Command:

```bash
asadmin enable-secure-admin
asadmin restart-domain
```

Disable if needed:

```bash
asadmin disable-secure-admin
```

Secure admin matters because:

- remote admin traffic must be protected;
- admin operations are privileged;
- DAS/instance admin communication should not be plaintext/untrusted.

But secure admin is not enough alone.

You still need:

- network restriction;
- strong credentials;
- cert/trust management;
- admin port not public;
- audit;
- patching.

---

## 6. Admin Console Exposure

Production recommendation:

```text
Disable Admin Console if not needed.
Use command-line/asadmin through controlled admin network.
```

If Admin Console must remain enabled:

```text
- enable secure admin
- strong authentication
- restrict network access
- no public internet exposure
- use VPN/bastion/private subnet
- monitor login failures
- patch promptly
```

Admin Console is a high-value target because it can control deployment and runtime configuration.

---

## 7. Admin Listener Network Control

Hardening:

```text
Bind admin listener to private interface if possible.
Restrict security group/firewall.
Allow only CI/CD runner, bastion, ops subnet.
Deny public access.
Monitor connection attempts.
```

Bad:

```text
0.0.0.0:4848 open to internet
```

Better:

```text
admin port only internal/VPN/bastion
```

In Kubernetes:

- do not expose admin port via public Ingress;
- if needed, ClusterIP only;
- NetworkPolicy;
- port-forward for break-glass;
- short-lived access.

---

## 8. Password Files

`asadmin` automation often uses password files.

Example:

```text
AS_ADMIN_PASSWORD=...
AS_ADMIN_MASTERPASSWORD=...
AS_ADMIN_ALIASPASSWORD=...
```

Hardening:

```text
chmod 600 passwordfile
owned by deploy user
not committed to git
not printed in logs
created temporarily if possible
deleted after use
stored in secret manager
```

Never:

```text
echo password in CI logs
commit passwordfile
use world-readable file
```

---

## 9. Master Password

Master password protects keystore/truststore and encrypted items in domain.

Important files:

```text
domain-dir/master-password
domain-dir/config/keystore.*
domain-dir/config/cacerts.*
```

Hardening:

- change default master password if appropriate;
- protect master-password file;
- avoid sharing it broadly;
- understand DAS/instance synchronization behavior;
- document recovery process;
- backup securely.

Command:

```bash
asadmin change-master-password
```

Changing master password has operational impact. Test carefully.

---

## 10. Keystore and Truststore

GlassFish uses keystore/truststore for TLS and secure admin.

Files may include:

```text
keystore.p12 / keystore.jks
cacerts.p12 / cacerts.jks
domain-dir/config/*
```

Hardening:

```text
- use strong private key protection
- restrict file permissions
- rotate certificates before expiry
- remove unused certificates
- use trusted CA chain
- avoid default self-signed certs for production traffic
- monitor expiry
```

For internal mTLS:

- client cert verification;
- truststore management;
- revocation/rotation process;
- hostname/SAN validation.

---

## 11. Password Alias

Password alias avoids storing cleartext secrets directly in config.

Concept:

```text
create alias:
  dbPassword

domain.xml/resource property:
  ${ALIAS=dbPassword}
```

Commands:

```bash
asadmin create-password-alias dbPassword
asadmin list-password-aliases
asadmin update-password-alias dbPassword
asadmin delete-password-alias dbPassword
```

Benefits:

- avoids cleartext in `domain.xml`;
- centralizes secret reference;
- supports `asadmin` automation.

Caveats:

- alias store/domain files still sensitive;
- master password protection matters;
- CI/CD secret injection must be secure;
- logs must not print alias input.

---

## 12. Secrets in `domain.xml`

Bad:

```xml
<property name="password" value="ProdPlainTextPassword"/>
```

Better:

```xml
<property name="password" value="${ALIAS=dbPassword}"/>
```

Also avoid:

- secrets in system properties;
- secrets in JVM options;
- secrets in Docker image layers;
- secrets in ConfigMap;
- secrets in Git;
- secrets in logs or deployment output.

Use:

- password alias;
- secret manager;
- Kubernetes Secret with encryption/RBAC;
- external secret operator;
- secure runtime injection.

---

## 13. File Permissions

Protect:

```text
domain-dir/config
domain-dir/master-password
keystore/truststore
password files
deployment artifacts
logs
heap dumps
JFR files
backups
```

Baseline Linux:

```bash
chown -R glassfish:glassfish /opt/glassfish
chmod 700 domain-dir/config
chmod 600 sensitive files
```

Do not run GlassFish as root.

Use dedicated OS user:

```text
glassfish
```

Principle:

```text
If attacker gets low-privilege shell, file permissions should still limit secret access.
```

---

## 14. Run as Non-Root

Hardening:

```text
- dedicated OS user
- no root runtime
- no unnecessary sudo
- least privilege filesystem access
- bind to high ports or use proxy for 80/443
```

In containers:

```yaml
securityContext:
  runAsNonRoot: true
  allowPrivilegeEscalation: false
```

GlassFish should not need root to serve internal port 8080/8181 behind proxy.

---

## 15. Patch Management

Production baseline:

```text
- run supported GlassFish version
- track GlassFish security releases
- patch JDK regularly
- patch base OS/container image
- patch dependencies
- scan artifacts/images
- maintain SBOM
```

Do not freeze on old app server for years without compensating controls.

Patch planning must include:

- compatibility test;
- rollback;
- maintenance window;
- release notes review;
- CVE risk assessment;
- smoke/regression tests.

---

## 16. JDK Security Baseline

Use current supported JDK update.

JDK affects:

- TLS protocols/ciphers;
- certificate validation;
- disabled algorithms;
- XML parser security;
- serialization behavior;
- crypto providers;
- security patches;
- container memory/CPU behavior.

Hardening:

```text
- use vendor-supported JDK
- patch CPU releases
- disable weak TLS protocols
- avoid old crypto algorithms
- review java.security if customized
```

---

## 17. TLS Listener Hardening

For HTTPS listener:

```text
- disable SSLv2/SSLv3/TLS 1.0/TLS 1.1
- prefer TLS 1.2/1.3 depending environment
- use strong cipher suites
- use valid certificate
- enable HSTS at proxy/app if appropriate
- monitor certificate expiry
```

If TLS terminates at reverse proxy:

```text
Client -> HTTPS Proxy -> HTTP GlassFish internal
```

Then secure internal network:

- private subnet;
- network policy/firewall;
- optionally mTLS proxy-to-backend;
- do not trust forwarded headers from arbitrary clients.

---

## 18. Reverse Proxy Security

GlassFish often sits behind Nginx/ALB/Apache/HAProxy.

Proxy must handle:

- TLS termination;
- WAF/rate limit if used;
- request size limit;
- header normalization;
- forwarded headers;
- timeout;
- access logging.

Application must only trust:

```text
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
```

from trusted proxy.

Do not let clients spoof forwarded headers.

---

## 19. HTTP Security Headers

Set at proxy or app:

```text
Strict-Transport-Security
Content-Security-Policy
X-Content-Type-Options: nosniff
X-Frame-Options or CSP frame-ancestors
Referrer-Policy
Permissions-Policy
Cache-Control for sensitive pages
```

Caveat:

- CSP can break old JSF/JSP inline scripts;
- test UI thoroughly;
- do not add headers blindly without understanding app.

---

## 20. Request Limits

Set limits:

```text
max header size
max request body/upload size
max parameter count
timeout
keep-alive timeout
connection limit
rate limit at proxy
```

Purpose:

- prevent memory exhaustion;
- reduce DoS surface;
- avoid huge multipart uploads;
- prevent slowloris-like behavior;
- protect thread pools.

Coordinate with app requirements.

---

## 21. Application Authentication

Jakarta EE app security may use:

- BASIC;
- FORM;
- CLIENT-CERT;
- OIDC;
- custom authentication mechanisms;
- Jakarta Security;
- Jakarta Authentication;
- external IAM/SSO.

Production baseline:

```text
- centralize identity provider where possible
- avoid custom auth unless justified
- password hashing strong if local credentials
- session timeout configured
- logout invalidates session
- MFA where required
- auth errors do not leak details
```

---

## 22. Authorization and Role Mapping

Authentication answers:

```text
Who are you?
```

Authorization answers:

```text
Are you allowed?
```

GlassFish/Jakarta EE authorization uses:

- users/principals;
- groups;
- roles;
- role mapping;
- annotations;
- descriptors;
- realm/group mapping.

Hardening:

```text
- least privilege roles
- explicit role mapping
- deny by default
- test negative cases
- avoid broad admin/superuser role
- audit privileged actions
```

---

## 23. Security Realms

GlassFish realms may include:

- file realm;
- LDAP realm;
- JDBC realm;
- certificate realm;
- custom realm.

Baseline:

```text
- use enterprise IAM/LDAP/OIDC where possible
- avoid file realm for large production user base
- protect realm config/secrets
- test group mapping
- test account lockout/disabled user
- monitor auth failures
```

Custom realm risk:

- internal API dependency;
- upgrade compatibility;
- classloading;
- credential handling;
- logging secrets.

---

## 24. Admin vs Application Identity

Separate:

```text
GlassFish admin identity
Application user identity
Database technical account
JMS technical account
External API credential
CI/CD deploy identity
```

Do not reuse:

```text
same password/account for admin and app DB
```

Least privilege:

```text
App DB account:
  only app schema permissions

Deploy account:
  can deploy/configure, not read unrelated secrets if possible

Admin account:
  tightly restricted and audited
```

---

## 25. Database Credential Hardening

For JDBC pools:

```text
- use password alias
- least privilege DB account
- no DBA/system account for app
- rotate password
- monitor failed login
- use TLS if required
- restrict network access
- separate accounts per app/env
```

Do not:

```text
Use same DB account for all apps/environments.
```

---

## 26. JMS/Connector Credential Hardening

For JMS/connector/EIS:

```text
- least privilege technical user
- per-environment credentials
- password alias/secret manager
- TLS/mTLS if supported
- restrict broker/EIS network
- audit producer/consumer operations
```

Resource adapter configs can hide secrets. Review `domain.xml` and adapter property logs.

---

## 27. Deployment Artifact Security

Only deploy trusted artifacts.

Controls:

```text
- CI-built artifacts only
- artifact checksum/signature
- artifact repository access control
- SBOM and vulnerability scan
- no manual unknown WAR upload
- deploy audit log
```

Admin compromise + deploy malicious WAR = server compromise.

---

## 28. Library and Classpath Hardening

Avoid:

- duplicate server APIs in WAR/EAR;
- old vulnerable libraries;
- unknown vendor jars;
- libraries downloaded manually;
- `WEB-INF/lib` dumping ground;
- classpath from writable directories.

Review:

```text
mvn dependency:tree
SBOM
CVE scan
license scan
provided scope
Jakarta compatibility
```

---

## 29. Disable Unused Services/Listeners

Disable what is not used:

- unused HTTP listeners;
- unused admin console exposure;
- unused IIOP/ORB if app does not need remote EJB;
- unused JMS broker integration if external/not used;
- sample apps;
- default/demo resources;
- debug ports;
- remote JMX if not needed.

Principle:

```text
Every open port is a promise to secure and patch it.
```

---

## 30. Debug Port Hardening

Never expose JDWP/debug port in production.

Bad:

```text
-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

JDWP can allow arbitrary code execution if exposed.

If break-glass debugging is required:

- require approval;
- bind to localhost/private;
- use SSH tunnel;
- short duration;
- monitor;
- remove after use.

---

## 31. JMX Hardening

If remote JMX enabled:

```text
- authenticate
- TLS
- firewall/private network
- no public exposure
- least privilege
- monitor access
```

Prefer:

- JMX exporter as local Java agent;
- no remote JMX port;
- metrics endpoint internal only.

---

## 32. Logging and Sensitive Data

Never log:

```text
password
token
Authorization header
session cookie
API key
private key
full JWT
SAML assertion
PII beyond need
full request/response body by default
```

Hardening:

- redaction helper;
- logging filters;
- code review;
- production log level INFO/WARN;
- restrict log access;
- secure heap dumps/JFR;
- retention policy.

Logs are a data store. Treat them accordingly.

---

## 33. Error Handling

Do not expose:

- stack trace;
- server version;
- internal path;
- SQL error detail;
- full class names;
- config values;
- dependency hostnames if sensitive.

User-facing error:

```text
Unexpected error.
Reference ID: ERR-20260621-ABC123
```

Server log:

```text
errorId=ERR-20260621-ABC123 correlationId=... exception=...
```

---

## 34. XML Security

Enterprise apps often parse XML/SOAP.

Hardening:

- disable external entity expansion where applicable;
- prevent XXE;
- limit entity expansion;
- limit document size;
- use secure parser settings;
- avoid untrusted XSLT external access;
- validate input.

JDK and libraries have secure processing features. Confirm actual parser configuration.

---

## 35. Serialization Security

Avoid Java native serialization for untrusted input.

Risks:

- gadget chains;
- RCE;
- memory bombs;
- classloading attacks.

If legacy uses serialization:

- restrict input source;
- use serialization filters;
- avoid exposing deserialization endpoints;
- prefer JSON/protobuf/etc. with validation.

Session replication/passivation also serializes internal state; ensure objects are safe and minimal.

---

## 36. CORS

Do not use:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Hardening:

- allowlist origins;
- restrict methods/headers;
- separate public/private APIs;
- test preflight;
- avoid reflecting arbitrary Origin.

---

## 37. CSRF

For browser session-based apps:

- CSRF token;
- SameSite cookies;
- secure cookies;
- origin/referer checks where appropriate;
- no state-changing GET;
- framework CSRF support.

For token-based APIs, CSRF risk depends on how token is stored/sent.

---

## 38. Cookie Hardening

Set:

```text
Secure
HttpOnly
SameSite
Path
Domain carefully
Max-Age/Expires
```

Session cookies should be:

```text
Secure over HTTPS
HttpOnly
SameSite=Lax/Strict depending app
```

If behind proxy, ensure app knows request is secure or proxy sets cookie attributes.

---

## 39. Session Hardening

Controls:

```text
session timeout
invalidate on logout
regenerate session ID after login
limit concurrent sessions if required
avoid large/sensitive session data
protect session cookie
clear session after privilege change
```

Session fixation and stale privileges are common enterprise risks.

---

## 40. Admin Audit and Security Monitoring

Monitor:

```text
admin login success/failure
asadmin deployment/config changes
secure admin changes
password alias changes
realm changes
application deployment
server stop/start
security exceptions
auth failures
403 spikes
TLS/cert errors
unexpected admin port access
```

Alert:

```text
admin login from unusual source
multiple failed admin logins
deployment outside window
admin console public scan
secure admin disabled
debug port opened
```

---

## 41. File/Backup/Dump Security

Sensitive artifacts:

- domain backup;
- `domain.xml`;
- keystores;
- password alias store;
- heap dumps;
- JFR;
- thread dumps;
- logs;
- DB export;
- deployment artifacts.

Hardening:

```text
encrypt backups
restrict access
retention policy
secure transfer
do not attach to public tickets
scrub secrets where possible
```

Heap dump especially can contain passwords/tokens/PII.

---

## 42. Container/Kubernetes Security Baseline

If containerized:

```text
- non-root
- read-only root filesystem where feasible
- no privileged container
- drop capabilities
- resource limits
- NetworkPolicy
- secrets via Secret/external secret
- image scanning
- admission policy
- no admin port public
- probes not exposing internals
```

Kubernetes Secret is not enough without RBAC/encryption/access control.

---

## 43. Supply Chain Baseline

```text
- build in CI
- dependency lock
- artifact repository
- checksum/signature
- SBOM
- vulnerability scanning
- base image scanning
- no manual jar copying
- provenance if available
```

Supply chain failures are production security failures.

---

## 44. Production Hardening Script Skeleton

Example conceptual script:

```bash
#!/usr/bin/env bash
set -euo pipefail

TARGET="${TARGET:-server-config}"

echo "Set secure admin"
asadmin enable-secure-admin || true

echo "Set log levels baseline"
asadmin set-log-levels com.example=INFO

echo "Create password aliases if missing"
if ! asadmin list-password-aliases | grep -q '^dbPassword$'; then
  asadmin create-password-alias dbPassword
fi
```

Do not run skeleton blindly. Build environment-specific, tested, idempotent scripts.

---

## 45. Production Security Baseline Checklist

```text
[Admin]
- admin password changed
- secure admin enabled if remote admin used
- admin console disabled or restricted
- admin port not public
- admin access audited
- no blank/default credentials

[Secrets]
- no cleartext secrets in domain.xml
- password aliases used
- password files protected
- master password file protected
- secrets not in image/git/logs

[TLS]
- valid certs
- weak protocols disabled
- cert expiry monitored
- truststore controlled
- proxy/backend TLS model documented

[Runtime]
- supported GlassFish version
- supported patched JDK
- no debug port
- JMX restricted
- unused listeners/services disabled
- run as non-root/dedicated user

[Application]
- authn/authz tested
- role mapping verified
- security headers configured
- CSRF/cookie/session hardening
- request limits
- safe error pages

[Dependencies]
- SBOM generated
- CVE scan clean/accepted
- no unknown jars
- provided APIs not bundled wrongly

[Logs/Audit]
- no secrets in logs
- admin/security events monitored
- log access restricted
- heap dumps protected
- retention policy

[Network]
- firewall/security groups
- DB/JMS/IAM egress restricted
- admin network separate
- reverse proxy headers trusted only from proxy

[Operations]
- patch process
- secret rotation process
- backup/restore secure
- incident runbook
- penetration/security test results
```

---

## 46. Security Regression Tests

Automate:

```text
unauthenticated access denied
wrong role denied
right role allowed
session timeout
logout invalidates session
CSRF protection
security headers present
admin endpoints inaccessible publicly
health endpoints do not leak secrets
error page no stack trace
TLS certificate valid
```

Security regression prevents hardening from decaying.

---

## 47. Common Hardening Anti-Patterns

### Anti-pattern 1 — Admin Console Public

Critical risk.

### Anti-pattern 2 — Plaintext DB Password in `domain.xml`

Use password alias/secret manager.

### Anti-pattern 3 — Run as Root

Unnecessary privilege.

### Anti-pattern 4 — Debug Port Open

Potential RCE.

### Anti-pattern 5 — Hardening Done Manually Once

Config drift returns.

### Anti-pattern 6 — Logs Full Tokens

Turns log platform into secret breach.

### Anti-pattern 7 — Old GlassFish/JDK Forever

Known vulnerabilities accumulate.

### Anti-pattern 8 — Trust All Forwarded Headers

Client spoofing risk.

### Anti-pattern 9 — Broad Roles

`admin`/`superuser` everywhere.

### Anti-pattern 10 — No Negative Authorization Tests

Only testing happy path misses privilege bugs.

---

## 48. Top 1% Takeaways

1. **Secure the admin/control plane first.**
2. **Admin Console should usually be disabled or tightly restricted in production.**
3. **Use secure admin, strong admin credentials, and network restriction together.**
4. **Password alias reduces cleartext secrets but does not remove need for file/secret protection.**
5. **Master password and keystore/truststore files are sensitive production assets.**
6. **Run GlassFish as non-root/dedicated user.**
7. **Patch GlassFish, JDK, dependencies, and base images regularly.**
8. **Do not expose debug/JMX/admin ports publicly.**
9. **Application role mapping and negative authorization tests are part of runtime hardening.**
10. **Hardening must be automated and audited, not a one-time console checklist.**

---

## 49. Mini Exercise

Create a production hardening plan for:

```text
GlassFish 8
Java 21
4 instances behind Nginx
Admin Console currently accessible internally
Oracle JDBC pool with password in domain.xml
LDAP realm
JMS broker
CI/CD deploys via asadmin
Application has FORM login and role-based pages
```

Answer:

1. What do you change first?
2. How do you protect admin access?
3. How do you migrate DB password to password alias?
4. How do you handle CI/CD password file?
5. What TLS/cert checks are needed?
6. What role mapping tests are needed?
7. What logs/audit events do you monitor?
8. What ports should be closed/restricted?
9. What patching process do you define?
10. What hardening checklist must pass before go-live?

---

## 50. Referensi

Referensi utama:

- Eclipse GlassFish Server Security Guide, Release 8  
  https://glassfish.org/docs/latest/security-guide.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Reference Manual, Release 8  
  https://glassfish.org/docs/latest/reference-manual.html

- Jakarta Security Tutorial  
  https://jakarta.ee/learn/docs/jakartaee-tutorial/current/security/security.html

- Jakarta Security, Authentication, and Authorization Explained  
  https://jakarta.ee/learn/specification-guides/security-authorization-and-authentication-explained/

- Jakarta Authentication Specification  
  https://jakarta.ee/specifications/authentication/

- Jakarta Authorization Specification  
  https://jakarta.ee/specifications/authorization/

- OWASP Cheat Sheet Series  
  https://cheatsheetseries.owasp.org/

---

## 51. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
Part 25 - selesai
Part 26 - selesai
Part 27 - selesai
Part 28 - selesai
Part 29 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 30 — GlassFish Source Code, Modules, Build, dan Contribution-Level Understanding
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-028.md">⬅️ Part 28 — Legacy Modernization: GlassFish 4/5 Java EE ke GlassFish 7/8 Jakarta EE</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-030.md">Part 30 — GlassFish Source Code, Modules, Build, dan Contribution-Level Understanding ➡️</a>
</div>
